import {
  Item,
  ItemID,
  ListenerFor,
  OverflowStrategy,
  ProcessQueueEvent,
  ProcessQueueEvents,
  ProcessQueueOptions,
  Snapshot,
} from './types.js';
import { systemClock } from './internal/clock.js';
import { DeadLetterQueue } from './internal/deadLetterQueue.js';
import { EventBus } from './internal/eventBus.js';
import { InFlight } from './internal/inFlight.js';
import { ResolvedOptions, resolveOptions } from './internal/options.js';
import { OrderedQueue } from './internal/orderedQueue.js';
import { normalizeDelay, RetryTracker } from './internal/retryTracker.js';
import { validateSnapshot } from './internal/snapshot.js';
import { isValidItem, toError } from './internal/validation.js';

/**
 * A queue that processes items with unique IDs.
 *
 * This class coordinates the internal modules and is the only place that emits events
 * or calls the worker. Per-item state is always settled before an event is emitted,
 * because a listener may call straight back into the queue.
 * @template QueueItem - Type of items in the queue; must have an id. Without a type argument,
 *                      items may carry any other properties.
 */
class ProcessQueue<QueueItem extends Item = Item & { [key: string]: unknown }> {
  private readonly _options: ResolvedOptions<QueueItem>;
  /** Queued items, in processing order */
  private readonly _queue: OrderedQueue<QueueItem>;
  /** Items being processed */
  private readonly _inFlight: InFlight<QueueItem>;
  /** Retry counts and items waiting out a retry delay */
  private readonly _retries: RetryTracker<QueueItem>;
  /** Permanently failed items */
  private readonly _deadLetters: DeadLetterQueue<QueueItem>;
  private readonly _events: EventBus<ProcessQueueEvents<QueueItem>>;
  /** Whether the queue is paused */
  private _paused: boolean = false;
  /** True once 'empty' has been emitted for the current empty period; the queue starts empty */
  private _emptyReported: boolean = true;
  /** True once 'drain' has been emitted for the current idle period; the queue starts idle */
  private _drainReported: boolean = true;
  /** The promise shared by every onIdle() caller waiting for the queue to become idle */
  private _idleWaiter?: { promise: Promise<void>; resolve: () => void };
  /** True while _autoProcess is running, to prevent re-entrant recursion */
  private _autoProcessing: boolean = false;
  /** Set when _autoProcess was requested while already running */
  private _autoProcessAgain: boolean = false;

  /**
   * What each overflow strategy does when a new item arrives at a full queue:
   * returns the index of the queued item to evict (-1 if none), returns null to drop the new item, or throws
   */
  private readonly _overflowHandlers: Record<OverflowStrategy, () => number | null> = {
    'reject': () => { throw new Error("Queue size limit reached"); },
    'drop-oldest': () => this._queue.findOldestIndex(),
    'drop-newest': () => null,
  };

  /**
   * Creates a new ProcessQueue instance
   * @param optionsOrEmplace - Options object or boolean for emplace mode (backward compat)
   * @param maxSize - Maximum queue size (only used with boolean first arg)
   */
  constructor(optionsOrEmplace?: ProcessQueueOptions<QueueItem> | boolean, maxSize?: number) {
    const options = resolveOptions(optionsOrEmplace, maxSize);
    this._options = options;
    this._queue = new OrderedQueue({
      emplace: options.emplace,
      comparator: options.comparator,
      ttl: options.ttl,
      clock: systemClock,
    });
    this._inFlight = new InFlight(options.processingTimeout, systemClock);
    this._retries = new RetryTracker(systemClock);
    this._deadLetters = new DeadLetterQueue(options.maxDeadLetterSize);
    this._events = new EventBus(options.onListenerError);
  }

  /**
   * Checks if an item with given ID is currently being processed
   * @param id - ID to check
   * @returns True if item is being processed, false otherwise
   */
  public isProcessing = (id: ItemID): boolean => {
    return this._inFlight.has(id);
  };

  /**
   * Adds or updates an item in the queue
   * @param item - Item to add to queue
   * @returns True if item was added/updated, false if its ID is in-process or awaiting a retry,
   *          or the queue is full and overflowStrategy is 'drop-newest'
   * @throws {Error} If item has an invalid ID, or the queue is full and overflowStrategy is 'reject'
   */
  public queueItem = (item: QueueItem): boolean => {
    if (!isValidItem(item)) {
      throw new Error("Invalid queue item: must have an id property");
    }

    if (this.isProcessing(item.id) || this._retries.isPending(item.id)) {
      return false;
    }

    const idx = this._queue.indexOf(item.id);

    // Only a genuinely new item can overflow the queue; updates never change its length.
    // Items awaiting a retry hold their place, so they count toward maxSize.
    let evictIdx = -1;
    if (idx < 0 && this._queue.length + this._retries.pendingCount >= this._options.maxSize) {
      const outcome = this._overflowHandlers[this._options.overflowStrategy]();
      // null, or nothing queued to evict (only pending retries fill the queue): drop the new item
      if (outcome === null || outcome < 0) {
        return false;
      }
      evictIdx = outcome;
    }

    const evicted = this._queue.put(item, idx, evictIdx);
    this._markWorkAdded();
    if (evicted) this._forgetDiscarded([evicted]);

    // Emit only once the queue is consistent, so listeners that call back in see the final state
    if (evicted) this._emit('removed', evicted);
    this._emit('added', item);
    this._autoProcess();

    return true;
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

    const [item] = this._takeForProcessing(1);
    if (!item) {
      return null;
    }

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

    return this._queue.toArray();
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

    this._expireItems();

    const batch = this._takeForProcessing(batchSize);
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
    const removed = this._removeQueued(id) ?? this._retries.cancel(id);
    if (!removed) {
      return false;
    }

    this._emit('removed', removed);
    this._checkDrain();
    return true;
  };

  /**
   * Marks an item as done processing and removes it from the in-process map
   * @param id - Optional ID or array of IDs to mark as done. If not provided, clears all in-process items
   */
  public doneProcessing = (id?: ItemID | ItemID[]): void => {
    if (id !== undefined) {
      if (Array.isArray(id)) {
        id.forEach(i => this._releaseIfInProcess(i));
      } else {
        this._releaseIfInProcess(id);
      }
    } else {
      this._releaseAllInProcess();
      this._emit('done');
    }

    this._checkDrain();
    // A released worker run frees a concurrency slot; its own completion will be ignored
    this._autoProcess();
  };

  /**
   * Gets the length of the queue, optionally filtered by a property value
   * @param prop - Optional property key to filter by
   * @param val - Optional value to match against the property
   * @returns The number of items in the queue matching the criteria
   */
  public length = <K extends keyof QueueItem>(prop?: K, val?: QueueItem[K]): number => {
    if (prop !== undefined && val !== undefined) {
      return this._queue.toArray().filter(q => q[prop] === val).length;
    }
    return this._queue.length;
  };

  /**
   * Clears the queue, in-process items and pending retries
   */
  public clear = (): void => {
    this._queue.clear();
    this._releaseAllInProcess();
    this._retries.clear();
    // Checked rather than emitted outright: an 'empty' listener may refill the queue
    this._checkDrain();
  };

  /**
   * Waits until nothing is queued, in process or awaiting a retry.
   * Unlike a 'drain' listener, it cannot miss work that finished before it was called.
   * Callers waiting at the same time share one promise, so abandoned calls cost nothing.
   * @returns A promise that resolves immediately if the queue is idle, otherwise when it next becomes
   *          idle after every 'drain' listener has run (the queue may have new work by the time awaiting code resumes)
   */
  public onIdle = (): Promise<void> => {
    if (this._isIdle()) {
      return Promise.resolve();
    }
    if (!this._idleWaiter) {
      let resolve!: () => void;
      const promise = new Promise<void>(r => { resolve = r; });
      this._idleWaiter = { promise, resolve };
    }
    return this._idleWaiter.promise;
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
    return this._inFlight.size > 0;
  };

  /**
   * Gets the number of items currently being processed
   * @returns The number of items in the in-process map
   */
  public processSize = (): number => {
    return this._inFlight.size;
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
    return this._queue.peek() ?? null;
  };

  /**
   * Checks if an item with the given ID exists in the queue
   * @param id - ID to check
   * @returns True if item is in the queue, false otherwise
   */
  public has = (id: ItemID): boolean => {
    return this._queue.has(id);
  };

  /**
   * Gets all items currently being processed
   * @returns Array of items in the in-process map
   */
  public getInProcess = (): QueueItem[] => {
    return this._inFlight.items();
  };

  /**
   * Adds multiple items to the queue in order. Not atomic: if an item throws,
   * the items before it remain queued
   * @param items - Array of items to add
   * @returns Array of booleans indicating success for each item
   * @throws {Error} As queueItem, on the first item that throws
   */
  public queueMany = (items: QueueItem[]): boolean[] => {
    return items.map(item => this.queueItem(item));
  };

  /**
   * Registers an event listener
   * @param event - Event name to listen for
   * @param handler - Function to call when event fires
   */
  public on = <E extends ProcessQueueEvent>(event: E, handler: ListenerFor<QueueItem, E>): void => {
    this._events.on(event, handler as ProcessQueueEvents<QueueItem>[E]);
  };

  /**
   * Removes an event listener
   * @param event - Event name to remove listener from
   * @param handler - Function to remove
   */
  public off = <E extends ProcessQueueEvent>(event: E, handler: ListenerFor<QueueItem, E>): void => {
    this._events.off(event, handler as ProcessQueueEvents<QueueItem>[E]);
  };

  /**
   * Registers a one-time event listener that auto-removes after first call
   * @param event - Event name to listen for
   * @param handler - Function to call once when event fires
   */
  public once = <E extends ProcessQueueEvent>(event: E, handler: ListenerFor<QueueItem, E>): void => {
    this._events.once(event, handler as ProcessQueueEvents<QueueItem>[E]);
  };

  /**
   * Checks for items that have exceeded the processing timeout
   * Emits 'timeout' event and removes items from in-process
   */
  public checkProcessingTimeouts = (): void => {
    if (this._options.processingTimeout <= 0) return;

    this._inFlight.timedOut().forEach(id => {
      // Recheck: a 'timeout' listener may have released or restarted this item
      const item = this._inFlight.get(id);
      if (!item || !this._inFlight.hasTimedOut(id)) return;
      this._releaseInProcess(id);
      this._emit('timeout', item);
    });
    this._checkDrain();
    this._autoProcess();
  };

  /**
   * Gets all items in the dead letter queue (permanently failed)
   * @returns Array of failed items
   */
  public getDeadLetterQueue = (): QueueItem[] => {
    return this._deadLetters.toArray();
  };

  /**
   * Clears the dead letter queue
   */
  public clearDeadLetterQueue = (): void => {
    this._deadLetters.clear();
  };

  /**
   * Sizes of the per-item bookkeeping. Every size is 0 once no item is queued,
   * in flight or awaiting a retry. For tests; not part of the public API.
   * @internal
   */
  public _bookkeepingSizes = (): ReturnType<OrderedQueue<QueueItem>['bookkeepingSizes']> &
    ReturnType<InFlight<QueueItem>['bookkeepingSizes']> &
    ReturnType<RetryTracker<QueueItem>['bookkeepingSizes']> => ({
    ...this._queue.bookkeepingSizes(),
    ...this._inFlight.bookkeepingSizes(),
    ...this._retries.bookkeepingSizes(),
  });

  /**
   * Makes the queue iterable with for...of
   */
  public [Symbol.iterator](): Iterator<QueueItem> {
    return this._queue[Symbol.iterator]();
  }

  /**
   * Serializes the queue state to a JSON-compatible object
   * @returns Serializable snapshot of queue state
   */
  public serialize = (): Required<Snapshot<QueueItem>> => {
    return {
      // Items awaiting a retry re-enter at the front, so they serialize there
      queue: [...this._retries.pendingItems(), ...this._queue.toArray()],
      inProcess: this._inFlight.items(),
      deadLetterQueue: this._deadLetters.toArray(),
    };
  };

  /**
   * Restores a ProcessQueue from a serialized snapshot.
   * The snapshot is validated in full before anything is restored. With a worker configured,
   * in-process items are treated as interrupted and queued again at the front; processing
   * does not start until start() or resume() is called, or an item is queued.
   * @param data - Serialized data from serialize()
   * @param options - Options for the new queue instance
   * @returns A new ProcessQueue populated with the serialized state
   * @throws {TypeError} If the snapshot is malformed, contains an invalid item, or repeats an id outside the dead letter queue
   * @throws {RangeError} If the queue exceeds maxSize (maxSize + concurrency with a worker, allowing for retries),
   *                      or (with a worker) in-process items exceed concurrency
   */
  public static deserialize = <T extends Item>(
    data: Snapshot<T>,
    options?: ProcessQueueOptions<T> | boolean
  ): ProcessQueue<T> => {
    const queue = new ProcessQueue<T>(options);
    const { worker, maxSize, concurrency } = queue._options;

    // With a worker, retries may legitimately push the queue past maxSize by up to concurrency items,
    // and interrupted in-process items are queued again, so both lists share that limit
    const workerLimit = maxSize + concurrency;
    const { queued, inProcess, deadLetters } = validateSnapshot<T>(data, worker
      ? { maxQueued: workerLimit, maxInProcess: concurrency, maxTotal: workerLimit }
      : { maxQueued: maxSize, maxInProcess: Infinity, maxTotal: Infinity });

    // A worker run cannot survive serialization, so its item goes back to the front of the queue
    queue._queue.restore(worker ? [...inProcess, ...queued] : queued);
    if (!worker) {
      inProcess.forEach(item => queue._inFlight.start(item));
    }
    queue._emptyReported = queue._queue.length === 0;
    queue._drainReported = queue._isIdle();
    queue._deadLetters.add(deadLetters);
    return queue;
  };

  /**
   * Emits an event. Handlers always receive both arguments (item, error), even when
   * the event has no payload, as they always have.
   */
  private _emit = <E extends ProcessQueueEvent>(event: E, ...args: Parameters<ProcessQueueEvents<QueueItem>[E]>): void => {
    const [item, error] = args as unknown[];
    this._events.emit(event, ...([item, error] as Parameters<ProcessQueueEvents<QueueItem>[E]>));
  };

  /**
   * Takes items from the front of the queue and marks them in-process
   * @param count - Maximum number of items to take
   * @returns The items taken, in queue order
   */
  private _takeForProcessing = (count: number): QueueItem[] => {
    const taken = this._queue.take(count);
    taken.forEach(item => this._inFlight.start(item));
    return taken;
  };

  /**
   * Removes a queued item for good
   * @returns The removed item, or undefined if the id is not queued
   */
  private _removeQueued = (id: ItemID): QueueItem | undefined => {
    const removed = this._queue.remove(id);
    if (removed) this._forgetDiscarded([removed]);
    return removed;
  };

  /**
   * Forgets the retry counts of items that left the queue for good (removed, evicted or expired),
   * so a later item with the same id starts with its full retry budget
   */
  private _forgetDiscarded = (items: QueueItem[]): void => {
    items.forEach(item => this._retries.forget(item.id));
  };

  /**
   * Removes expired items from the queue (lazy TTL check)
   */
  private _expireItems = (): void => {
    const expired = this._queue.expire();
    this._forgetDiscarded(expired);
    expired.forEach(item => this._emit('expired', item));
    if (expired.length > 0) this._checkDrain();
  };

  /**
   * Forgets everything about an in-process item: its in-flight bookkeeping and its retry count
   */
  private _releaseInProcess = (id: ItemID): void => {
    this._inFlight.finish(id);
    this._retries.forget(id);
  };

  /**
   * Releases every in-process item without a worker result, as _releaseInProcess does for one
   */
  private _releaseAllInProcess = (): void => {
    this._inFlight.ids().forEach(id => this._retries.forget(id));
    this._inFlight.clear();
  };

  /**
   * Marks one item done, if it is in-process. IDs that are queued or awaiting
   * a retry are left alone, so their retry budget is not reset.
   */
  private _releaseIfInProcess = (id: ItemID): void => {
    const item = this._inFlight.get(id);
    if (!item) return;
    this._releaseInProcess(id);
    this._emit('done', item);
  };

  /**
   * Emits 'empty' if the queue has become empty since it was last reported empty
   */
  private _checkEmpty = (): void => {
    if (this._queue.length > 0 || this._emptyReported) return;
    // Set before emitting: a listener may call back into the queue and reach this check again
    this._emptyReported = true;
    this._emit('empty');
  };

  /**
   * Records that an item entered the queue, so the next empty and idle periods are reported
   */
  private _markWorkAdded = (): void => {
    this._emptyReported = false;
    this._drainReported = false;
  };

  /** Whether nothing is queued, in process or awaiting a retry */
  private _isIdle = (): boolean =>
    this._queue.length === 0 && this._inFlight.size === 0 && this._retries.pendingCount === 0;

  /**
   * Emits 'empty' if the queue has just become empty, then 'drain' if the queue has just become idle
   */
  private _checkDrain = (): void => {
    this._checkEmpty();
    if (!this._isIdle() || this._drainReported) return;
    // Set before emitting: a listener may call back into the queue and reach this check again
    this._drainReported = true;
    this._emit('drain');
    // Resolve onIdle() only after every 'drain' listener has run, and only if none of them queued more work
    if (this._idleWaiter && this._isIdle()) {
      const waiter = this._idleWaiter;
      this._idleWaiter = undefined;
      waiter.resolve();
    }
  };

  /**
   * Auto-processes items when a worker is configured and concurrency allows.
   * Re-entrant calls (from synchronous workers, retries and listeners) are folded
   * into the outermost call's loop so the call stack never grows with queue length.
   */
  private _autoProcess = (): void => {
    if (this._autoProcessing) {
      this._autoProcessAgain = true;
      return;
    }

    this._autoProcessing = true;
    try {
      do {
        this._autoProcessAgain = false;
        this._startAvailableWork();
      } while (this._autoProcessAgain);
    } finally {
      this._autoProcessing = false;
    }
  };

  /**
   * Starts the worker on queued items until concurrency is exhausted
   */
  private _startAvailableWork = (): void => {
    const worker = this._options.worker;
    if (!worker || this._paused) {
      return;
    }

    this._expireItems();

    // Re-check pause on every iteration: a listener or synchronous worker may pause mid-loop
    while (!this._paused && this._inFlight.size < this._options.concurrency && this._queue.length > 0) {
      const [item] = this._takeForProcessing(1);
      if (!item) break;

      // Capture the id now: the worker may mutate the item
      const id = item.id;
      const run = this._inFlight.beginRun(id);
      this._emit('processing', item);
      this._checkEmpty();
      // A 'processing' or 'empty' listener may have released this run (clear, doneProcessing); don't start it
      if (!this._inFlight.isCurrentRun(id, run)) continue;

      let result: Promise<void> | void;
      let isThenable: boolean;
      try {
        result = worker(item);
        // Inside the try: reading `then` can itself throw (a getter or a revoked Proxy)
        isThenable = !!result && typeof result.then === 'function';
      } catch (err) {
        this._onWorkerFailure(item, id, run, toError(err));
        continue;
      }

      if (isThenable) {
        // Promise.resolve adopts any thenable, turning a throwing then() into a rejection.
        // Two-argument then: an exception in the success path must never be treated as a worker failure.
        Promise.resolve(result).then(
          () => this._onWorkerSuccess(item, id, run),
          (err: unknown) => this._onWorkerFailure(item, id, run, toError(err))
        ).catch(internalError => {
          console.error('ProcessQueue: internal error after worker completion', internalError);
        });
      } else {
        this._onWorkerSuccess(item, id, run);
      }
    }
  };

  /**
   * Completes a successful worker run
   */
  private _onWorkerSuccess = (item: QueueItem, id: ItemID, run: symbol): void => {
    if (!this._inFlight.isCurrentRun(id, run)) return;
    // Settle per-item state before emitting: a listener may re-queue this id
    this._releaseInProcess(id);
    this._emit('done', item);
    this._checkDrain();
    this._autoProcess();
  };

  /**
   * Completes a failed worker run
   */
  private _onWorkerFailure = (item: QueueItem, id: ItemID, run: symbol, err: Error): void => {
    if (!this._inFlight.isCurrentRun(id, run)) return;
    this._inFlight.finish(id);
    this._handleWorkerError(item, id, err);
  };

  /**
   * Handles worker errors with retry logic.
   * The retry is reserved (queued or pending) before 'error' is emitted, so a listener
   * that re-queues the same id updates the retry rather than creating a duplicate.
   */
  private _handleWorkerError = (item: QueueItem, id: ItemID, err: Error): void => {
    // Per-item state is always settled before emitting: a listener may re-queue this id
    const attempts = this._retries.attempts(id) + 1;

    // Retry bookkeeping is keyed by the original id; a retry under a changed id could never end
    if (item.id !== id) {
      this._failPermanently(item, id, new Error(`ProcessQueue: the worker changed the item's id from ${JSON.stringify(id)}; not retrying`), err);
      return;
    }

    if (attempts > this._options.maxRetries) {
      this._failPermanently(item, id, err, err);
      return;
    }

    let delay: number;
    try {
      delay = this._retryDelayFor(attempts);
    } catch (delayError) {
      this._failPermanently(item, id, toError(delayError), err);
      return;
    }

    if (delay > 0) {
      this._retries.setAttempts(id, attempts);
      this._retries.schedule(item, id, delay, () => {
        const requeueError = this._requeueForRetry(item);
        if (requeueError) {
          this._failPermanently(item, id, requeueError);
        } else {
          this._autoProcess();
        }
      });
      this._emit('error', item, err);
      // The failed run's slot is free while the retry waits
      this._autoProcess();
      return;
    }

    const requeueError = this._requeueForRetry(item);
    if (requeueError) {
      this._failPermanently(item, id, requeueError, err);
      return;
    }
    this._retries.setAttempts(id, attempts);
    this._emit('error', item, err);
    this._autoProcess();
  };

  /**
   * The delay before retrying an item, in ms
   * @param attempt - The attempt that just failed, starting at 1
   * @throws If the retryDelay function throws or returns a value that cannot be converted to a number
   */
  private _retryDelayFor = (attempt: number): number => {
    const retryDelay = this._options.retryDelay;
    return normalizeDelay(typeof retryDelay === 'function' ? retryDelay(attempt) : retryDelay);
  };

  /**
   * Puts a failed item back in the queue for another attempt.
   * Retries bypass maxSize: the item was already admitted, so the queue can
   * exceed maxSize by at most the number of items in flight.
   * @returns The comparator's error if it threw (the item is then not queued)
   */
  private _requeueForRetry = (item: QueueItem): Error | undefined => {
    try {
      this._queue.insertRetry(item);
      this._markWorkAdded();
      return undefined;
    } catch (comparatorError) {
      return toError(comparatorError);
    }
  };

  /**
   * Gives up on an item: clears its retry count and dead-letters it, then emits 'error'
   * for the worker's error when there is one to report, and 'failed' with the final cause
   * @param failure - The reason the item is dead-lettered, reported with 'failed'
   * @param workerError - The worker error not yet reported with 'error', if any
   */
  private _failPermanently = (item: QueueItem, id: ItemID, failure: Error, workerError?: Error): void => {
    // Settle state before emitting, so the item is in the dead letter queue when listeners run
    this._retries.forget(id);
    this._deadLetters.add([item]);
    if (workerError) this._emit('error', item, workerError);
    this._emit('failed', item, failure);
    this._checkDrain();
    this._autoProcess();
  };
}

export default ProcessQueue;
export type {
  EventHandler,
  Item,
  ItemID,
  ListenerFor,
  OverflowStrategy,
  ProcessQueueEvent,
  ProcessQueueEvents,
  ProcessQueueOptions,
  Snapshot,
} from './types.js';
