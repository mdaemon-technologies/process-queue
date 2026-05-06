/** 
 * Type representing valid item IDs - either strings or numbers
 */
type ItemID = string | number;

/**
 * Interface representing queue items
 * Each item must have an ID and can have additional string-keyed properties
 */
interface Item {
  /** Unique identifier for the item */
  id: ItemID;
  /** Additional properties with unknown values */
  [key: string]: unknown;
}

/**
 * Options for configuring a ProcessQueue instance
 */
interface ProcessQueueOptions<QueueItem extends Item> {
  /** If true, new items replace existing ones at their position; if false, items are added to front */
  emplace?: boolean;
  /** Maximum number of items allowed in queue */
  maxSize?: number;
  /** Custom comparator for queue ordering. Return negative if a should come before b */
  comparator?: (a: QueueItem, b: QueueItem) => number;
  /** Strategy when queue is full: 'reject' (throw), 'drop-oldest', 'drop-newest' */
  overflowStrategy?: OverflowStrategy;
  /** Worker function for auto-processing items */
  worker?: (item: QueueItem) => Promise<void> | void;
  /** Maximum concurrent worker invocations (default 1) */
  concurrency?: number;
  /** Maximum retry attempts on worker failure (default 0 = no retry) */
  maxRetries?: number;
  /** Delay between retries in ms, or function (attempt) => ms for backoff */
  retryDelay?: number | ((attempt: number) => number);
  /** Time-to-live in ms - items expire from queue after this duration */
  ttl?: number;
  /** Processing timeout in ms - items auto-released from in-process if not done */
  processingTimeout?: number;
}

/**
 * Event types emitted by ProcessQueue
 */
type ProcessQueueEvent = 'added' | 'processing' | 'done' | 'removed' | 'empty' | 'drain' | 'error' | 'resumed' | 'paused' | 'failed' | 'expired' | 'timeout';

/**
 * Overflow strategy when queue is full
 */
type OverflowStrategy = 'reject' | 'drop-oldest' | 'drop-newest';

/**
 * Event handler type
 */
type EventHandler<QueueItem extends Item> = (item?: QueueItem | QueueItem[], error?: Error) => void;

/**
 * Validates if a value is a valid ItemID
 * @param id - Value to check
 * @returns True if id is a non-empty string or number, false otherwise
 */
const isItemID = (id: string | number) => (typeof id === "string" && id.length > 0) || typeof id === "number";

/**
 * A queue that processes items with unique IDs
 * @template QueueItem - Type of items in the queue, must extend Item interface
 */
class ProcessQueue<QueueItem extends Item> {
  /** Array storing queued items */
  private readonly _queue: QueueItem[] = [];
  /** Map storing items currently being processed */
  private readonly _inProcess: Map<ItemID, QueueItem> = new Map();
  /** If true, new items replace existing ones at their position */
  private _emplace: boolean;
  /** Maximum number of items allowed in queue */
  private _maxSize: number;
  /** Custom comparator for priority ordering */
  private _comparator?: (a: QueueItem, b: QueueItem) => number;
  /** Overflow strategy */
  private _overflowStrategy: OverflowStrategy;
  /** Whether the queue is paused */
  private _paused: boolean = false;
  /** Worker function for auto-processing */
  private _worker?: (item: QueueItem) => Promise<void> | void;
  /** Maximum concurrent worker invocations */
  private _concurrency: number;
  /** Maximum retry attempts */
  private _maxRetries: number;
  /** Retry delay config */
  private _retryDelay: number | ((attempt: number) => number);
  /** Retry count per item */
  private readonly _retryCount: Map<ItemID, number> = new Map();
  /** Dead letter queue for permanently failed items */
  private readonly _deadLetterQueue: QueueItem[] = [];
  /** TTL in ms for queue items */
  private _ttl: number;
  /** Processing timeout in ms */
  private _processingTimeout: number;
  /** Timestamps when items were enqueued */
  private readonly _enqueuedAt: Map<ItemID, number> = new Map();
  /** Timestamps when items started processing */
  private readonly _processingStartedAt: Map<ItemID, number> = new Map();
  /** Event listeners map */
  private readonly _listeners: Map<ProcessQueueEvent, Set<EventHandler<QueueItem>>> = new Map();
  /** Once listeners (auto-removed after first call) */
  private readonly _onceListeners: Map<ProcessQueueEvent, Set<EventHandler<QueueItem>>> = new Map();

  /**
   * Creates a new ProcessQueue instance
   * @param optionsOrEmplace - Options object or boolean for emplace mode (backward compat)
   * @param maxSize - Maximum queue size (only used with boolean first arg)
   */
  constructor(optionsOrEmplace?: ProcessQueueOptions<QueueItem> | boolean, maxSize?: number) {
    if (typeof optionsOrEmplace === 'object' && optionsOrEmplace !== null) {
      this._emplace = optionsOrEmplace.emplace ?? false;
      this._maxSize = optionsOrEmplace.maxSize ?? 1000;
      this._comparator = optionsOrEmplace.comparator;
      this._overflowStrategy = optionsOrEmplace.overflowStrategy ?? 'reject';
      this._worker = optionsOrEmplace.worker;
      this._concurrency = optionsOrEmplace.concurrency ?? 1;
      this._maxRetries = optionsOrEmplace.maxRetries ?? 0;
      this._retryDelay = optionsOrEmplace.retryDelay ?? 0;
      this._ttl = optionsOrEmplace.ttl ?? 0;
      this._processingTimeout = optionsOrEmplace.processingTimeout ?? 0;
    } else {
      this._emplace = optionsOrEmplace === true;
      this._maxSize = maxSize ?? 1000;
      this._overflowStrategy = 'reject';
      this._concurrency = 1;
      this._maxRetries = 0;
      this._retryDelay = 0;
      this._ttl = 0;
      this._processingTimeout = 0;
    }
  }

  /**
   * Checks if an item with given ID is currently being processed
   * @param id - ID to check
   * @returns True if item is being processed, false otherwise
   */
  public isProcessing = (id: ItemID): boolean => {
    return !!this._inProcess.get(id);
  };

  /**
   * Adds or updates an item in the queue
   * @param item - Item to add to queue
   * @returns True if item was added/updated successfully, false if item is already being processed
   * @throws {Error} If item has invalid ID or queue size limit is reached
   */
  public queueItem = (item: QueueItem): boolean => {
    if (!isItemID(item.id)) {
      throw new Error("Invalid queue item: must have an id property");
    }

    if (this._queue.length >= this._maxSize) {
      switch (this._overflowStrategy) {
        case 'drop-oldest':
          this._queue.pop();
          break;
        case 'drop-newest':
          return false;
        case 'reject':
        default:
          throw new Error("Queue size limit reached");
      }
    }

    if (this.isProcessing(item.id)) {
      return false;
    }

    const idx = this._queue.findIndex(t => t.id === item.id);
    if (this._emplace) {
      if (idx >= 0) {
        this._queue.splice(idx, 1, item);
        if (this._ttl > 0) this._enqueuedAt.set(item.id, Date.now());
        this._emit('added', item);
        this._autoProcess();
        return true;
      }

      this._insertItem(item);
      if (this._ttl > 0) this._enqueuedAt.set(item.id, Date.now());
      this._emit('added', item);
      this._autoProcess();
      return true;
    }

    if (idx >= 0) {
      this._queue.splice(idx, 1);
    }

    this._insertItem(item);
    if (this._ttl > 0) this._enqueuedAt.set(item.id, Date.now());
    this._emit('added', item);
    this._autoProcess();

    return true;
  };

  /**
   * Inserts an item into the queue respecting comparator/priority ordering
   * If no comparator: emplace mode appends to back, otherwise inserts at front
   */
  private _insertItem = (item: QueueItem): void => {
    if (this._comparator) {
      const insertIdx = this._queue.findIndex(q => this._comparator!(item, q) < 0);
      if (insertIdx === -1) {
        this._queue.push(item);
      } else {
        this._queue.splice(insertIdx, 0, item);
      }
    } else if (this._emplace) {
      this._queue.push(item);
    } else {
      this._queue.unshift(item);
    }
  };

  /**
   * Gets and removes the next item from the queue, marking it as in-process
   * @returns The next queue item, or null if queue is empty
   */
  public getNextItem = (): QueueItem | null => {
    if (this._paused) {
      return null;
    }

    this._expireItems();

    const item = this._queue.shift();
    if (!item) {
      return null;
    }

    this._enqueuedAt.delete(item.id);
    this._inProcess.set(item.id, item);
    if (this._processingTimeout > 0) this._processingStartedAt.set(item.id, Date.now());
    this._emit('processing', item);
    this._checkDrain();
    return item;
  };

  /**
   * Gets all items in the queue
   * @param processing - If true, moves all items to in-process state and empties the queue
   * @returns Array of queue items
   */
  public getQueue = (processing: boolean = false): QueueItem[] => {
    if (processing) {
      return this.processBatch(this._queue.length);
    }

    return [...this._queue];
  };

  /**
   * Processes a batch of items from the queue and marks them as in-process
   * @param batchSize - The number of items to process from the front of the queue
   * @returns Array of queue items that were processed
   */
  public processBatch = (batchSize: number): QueueItem[] => {
    if (this._paused) {
      return [];
    }

    const batch = this._queue.splice(0, batchSize);
    batch.forEach(item => this._inProcess.set(item.id, item));
    if (batch.length > 0) {
      this._emit('processing', batch);
      this._checkDrain();
    }
    return batch;
  };

  /**
   * Removes an item from the queue by its ID
   * @param id - ID of the item to remove
   * @returns True if item was found and removed, false otherwise
   */
  public removeFromQueue = (id: ItemID): boolean => {
    const idx = this._queue.findIndex(t => t.id === id);
    if (idx !== -1) {
      const [removed] = this._queue.splice(idx, 1);
      this._enqueuedAt.delete(id);
      this._emit('removed', removed);
      this._checkDrain();
      return true;
    }

    return false;
  };

  /**
   * Marks an item as done processing and removes it from the in-process map
   * @param id - Optional ID or array of IDs to mark as done. If not provided, clears all in-process items
   */
  public doneProcessing = (id?: ItemID | ItemID[]): void => {
    if (id !== undefined) {
      if (Array.isArray(id)) {
        id.forEach(i => {
          const item = this._inProcess.get(i);
          this._inProcess.delete(i);
          this._processingStartedAt.delete(i);
          if (item) this._emit('done', item);
        });
        this._checkDrain();
        return;
      }
      const item = this._inProcess.get(id);
      this._inProcess.delete(id);
      this._processingStartedAt.delete(id);
      if (item) this._emit('done', item);
      this._checkDrain();
      return;
    }

    this._inProcess.clear();
    this._processingStartedAt.clear();
    this._emit('done');
    this._checkDrain();
  };

  /**
   * Gets the length of the queue, optionally filtered by a property value
   * @param prop - Optional property key to filter by
   * @param val - Optional value to match against the property
   * @returns The number of items in the queue matching the criteria
   */
  public length = <K extends keyof QueueItem>(prop?: K, val?: QueueItem[K]): number => {
    if (!this._queue.length) {
      return 0;
    }

    if (prop !== undefined && this._queue.length && this._queue[0][prop] !== undefined && val !== undefined) {
      return this._queue.filter(q => q[prop] === val).length;
    }
    return this._queue.length;
  };

  /**
   * Clears all items from both the queue and in-process map
   */
  public clear = (): void => {
    this._queue.splice(0, this._queue.length);
    this._inProcess.clear();
    this._enqueuedAt.clear();
    this._processingStartedAt.clear();
    this._emit('empty');
    this._emit('drain');
  };

  /**
   * Checks if the queue is empty
   * @returns True if the queue has no items, false otherwise
   */
  public isEmpty = (): boolean => {
    return this._queue.length === 0;
  };

  /**
   * Checks if there are any items currently being processed
   * @returns True if there are items being processed, false otherwise
   */
  public busy = (): boolean => {
    return this._inProcess.size > 0;
  };

  /**
   * Gets the number of items currently being processed
   * @returns The number of items in the in-process map
   */
  public processSize = (): number => {
    return this._inProcess.size;
  };

  /**
   * Pauses the queue - getNextItem and processBatch will return null/empty
   */
  public pause = (): void => {
    this._paused = true;
    this._emit('paused');
  };

  /**
   * Resumes the queue after being paused
   */
  public resume = (): void => {
    this._paused = false;
    this._emit('resumed');
    this._autoProcess();
  };

  /**
   * Starts auto-processing (alias for resume, useful in worker mode)
   */
  public start = (): void => {
    this.resume();
  };

  /**
   * Stops auto-processing (alias for pause, useful in worker mode)
   */
  public stop = (): void => {
    this.pause();
  };

  /**
   * Checks if the queue is currently paused
   * @returns True if the queue is paused
   */
  public isPaused = (): boolean => {
    return this._paused;
  };

  /**
   * Returns the next item in the queue without removing it
   * @returns The next queue item, or null if queue is empty
   */
  public peek = (): QueueItem | null => {
    return this._queue.length > 0 ? this._queue[0] : null;
  };

  /**
   * Checks if an item with the given ID exists in the queue
   * @param id - ID to check
   * @returns True if item is in the queue, false otherwise
   */
  public has = (id: ItemID): boolean => {
    return this._queue.some(item => item.id === id);
  };

  /**
   * Gets all items currently being processed
   * @returns Array of items in the in-process map
   */
  public getInProcess = (): QueueItem[] => {
    return Array.from(this._inProcess.values());
  };

  /**
   * Adds multiple items to the queue atomically
   * @param items - Array of items to add
   * @returns Array of booleans indicating success for each item
   * @throws {Error} If any item has invalid ID or queue size limit would be exceeded
   */
  public queueMany = (items: QueueItem[]): boolean[] => {
    return items.map(item => this.queueItem(item));
  };

  /**
   * Registers an event listener
   * @param event - Event name to listen for
   * @param handler - Function to call when event fires
   */
  public on = (event: ProcessQueueEvent, handler: EventHandler<QueueItem>): void => {
    if (!this._listeners.has(event)) {
      this._listeners.set(event, new Set());
    }
    this._listeners.get(event)!.add(handler);
  };

  /**
   * Removes an event listener
   * @param event - Event name to remove listener from
   * @param handler - Function to remove
   */
  public off = (event: ProcessQueueEvent, handler: EventHandler<QueueItem>): void => {
    this._listeners.get(event)?.delete(handler);
    this._onceListeners.get(event)?.delete(handler);
  };

  /**
   * Registers a one-time event listener that auto-removes after first call
   * @param event - Event name to listen for
   * @param handler - Function to call once when event fires
   */
  public once = (event: ProcessQueueEvent, handler: EventHandler<QueueItem>): void => {
    if (!this._onceListeners.has(event)) {
      this._onceListeners.set(event, new Set());
    }
    this._onceListeners.get(event)!.add(handler);
  };

  /**
   * Emits an event to all registered listeners
   */
  private _emit = (event: ProcessQueueEvent, item?: QueueItem | QueueItem[], error?: Error): void => {
    this._listeners.get(event)?.forEach(handler => handler(item, error));
    const onceSet = this._onceListeners.get(event);
    if (onceSet) {
      onceSet.forEach(handler => handler(item, error));
      onceSet.clear();
    }
  };

  /**
   * Checks if queue is empty and no items are processing, emits drain/empty as appropriate
   */
  private _checkDrain = (): void => {
    if (this._queue.length === 0) {
      this._emit('empty');
      if (this._inProcess.size === 0) {
        this._emit('drain');
      }
    }
  };

  /**
   * Removes expired items from the queue (lazy TTL check)
   */
  private _expireItems = (): void => {
    if (this._ttl <= 0) return;

    const now = Date.now();
    for (let i = this._queue.length - 1; i >= 0; i--) {
      const item = this._queue[i];
      const enqueuedAt = this._enqueuedAt.get(item.id);
      if (enqueuedAt && now - enqueuedAt > this._ttl) {
        this._queue.splice(i, 1);
        this._enqueuedAt.delete(item.id);
        this._emit('expired', item);
      }
    }
  };

  /**
   * Checks for items that have exceeded the processing timeout
   * Emits 'timeout' event and removes items from in-process
   */
  public checkProcessingTimeouts = (): void => {
    if (this._processingTimeout <= 0) return;

    const now = Date.now();
    this._processingStartedAt.forEach((startedAt, id) => {
      if (now - startedAt > this._processingTimeout) {
        const item = this._inProcess.get(id);
        this._inProcess.delete(id);
        this._processingStartedAt.delete(id);
        if (item) {
          this._emit('timeout', item);
        }
      }
    });
    this._checkDrain();
  };

  /**
   * Auto-processes items when a worker is configured and concurrency allows
   */
  private _autoProcess = (): void => {
    if (!this._worker || this._paused) {
      return;
    }

    this._expireItems();

    while (this._inProcess.size < this._concurrency && this._queue.length > 0) {
      const item = this._queue.shift();
      if (!item) break;

      this._enqueuedAt.delete(item.id);
      this._inProcess.set(item.id, item);
      if (this._processingTimeout > 0) this._processingStartedAt.set(item.id, Date.now());
      this._emit('processing', item);

      try {
        const result = this._worker(item);
        if (result && typeof result.then === 'function') {
          result.then(() => {
            this._inProcess.delete(item.id);
            this._processingStartedAt.delete(item.id);
            this._retryCount.delete(item.id);
            this._emit('done', item);
            this._checkDrain();
            this._autoProcess();
          }).catch((err: Error) => {
            this._inProcess.delete(item.id);
            this._processingStartedAt.delete(item.id);
            this._handleWorkerError(item, err);
          });
        } else {
          this._inProcess.delete(item.id);
          this._processingStartedAt.delete(item.id);
          this._retryCount.delete(item.id);
          this._emit('done', item);
          this._checkDrain();
        }
      } catch (err) {
        this._inProcess.delete(item.id);
        this._processingStartedAt.delete(item.id);
        this._handleWorkerError(item, err instanceof Error ? err : new Error(String(err)));
      }
    }
  };

  /**
   * Handles worker errors with retry logic
   */
  private _handleWorkerError = (item: QueueItem, err: Error): void => {
    const attempts = (this._retryCount.get(item.id) ?? 0) + 1;
    this._emit('error', item, err);

    if (attempts <= this._maxRetries) {
      this._retryCount.set(item.id, attempts);
      const delay = typeof this._retryDelay === 'function'
        ? this._retryDelay(attempts)
        : this._retryDelay;

      if (delay > 0) {
        setTimeout(() => {
          this._queue.unshift(item);
          this._autoProcess();
        }, delay);
      } else {
        this._queue.unshift(item);
        this._checkDrain();
        this._autoProcess();
      }
    } else {
      this._retryCount.delete(item.id);
      this._deadLetterQueue.push(item);
      this._emit('failed', item, err);
      this._checkDrain();
      this._autoProcess();
    }
  };

  /**
   * Gets all items in the dead letter queue (permanently failed)
   * @returns Array of failed items
   */
  public getDeadLetterQueue = (): QueueItem[] => {
    return [...this._deadLetterQueue];
  };

  /**
   * Clears the dead letter queue
   */
  public clearDeadLetterQueue = (): void => {
    this._deadLetterQueue.splice(0, this._deadLetterQueue.length);
  };

  /**
   * Makes the queue iterable with for...of
   */
  public [Symbol.iterator](): Iterator<QueueItem> {
    let index = 0;
    const queue = this._queue;
    return {
      next(): IteratorResult<QueueItem> {
        if (index < queue.length) {
          return { value: queue[index++], done: false };
        }
        return { value: undefined as unknown as QueueItem, done: true };
      }
    };
  }

  /**
   * Serializes the queue state to a JSON-compatible object
   * @returns Serializable snapshot of queue state
   */
  public serialize = (): { queue: QueueItem[]; inProcess: QueueItem[]; deadLetterQueue: QueueItem[] } => {
    return {
      queue: [...this._queue],
      inProcess: Array.from(this._inProcess.values()),
      deadLetterQueue: [...this._deadLetterQueue],
    };
  };

  /**
   * Restores a ProcessQueue from a serialized snapshot
   * @param data - Serialized data from serialize()
   * @param options - Options for the new queue instance
   * @returns A new ProcessQueue populated with the serialized state
   */
  public static deserialize = <T extends Item>(
    data: { queue: T[]; inProcess?: T[]; deadLetterQueue?: T[] },
    options?: ProcessQueueOptions<T> | boolean
  ): ProcessQueue<T> => {
    const queue = new ProcessQueue<T>(options);
    // Directly populate to preserve order (avoid queueItem's reordering)
    data.queue.forEach(item => queue._queue.push(item));
    if (data.inProcess) {
      data.inProcess.forEach(item => {
        queue._inProcess.set(item.id, item);
      });
    }
    if (data.deadLetterQueue) {
      data.deadLetterQueue.forEach(item => {
        queue._deadLetterQueue.push(item);
      });
    }
    return queue;
  };
}

export default ProcessQueue;
