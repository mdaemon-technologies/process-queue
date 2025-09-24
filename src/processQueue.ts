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

  /**
   * Creates a new ProcessQueue instance
   * @param _emplace - If true, new items replace existing ones at their position, if false items are added to front
   * @param _maxSize - Maximum number of items allowed in queue
   */
  constructor(private _emplace: boolean = false, private _maxSize: number = 1000) {}

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
      throw new Error("Queue size limit reached");
    }

    if (this.isProcessing(item.id)) {
      return false;
    }

    const idx = this._queue.findIndex(t => t.id === item.id);
    if (this._emplace) {
      if (idx >= 0) {
        this._queue.splice(idx, 1, item);
        return true;
      }

      this._queue.push(item);
      return true;
    }

    if (idx >= 0) {
      this._queue.splice(idx, 1);
    }

    this._queue.unshift(item);

    return true;
  };

  /**
   * Gets and removes the next item from the queue, marking it as in-process
   * @returns The next queue item, or null if queue is empty
   */
  public getNextItem = (): QueueItem | null => {
    const item = this._queue.shift();
    if (!item) {
      return null;
    }

    // it's okay to set the item again
    this._inProcess.set(item.id, item);
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
    const batch = this._queue.splice(0, batchSize);
    batch.forEach(item => this._inProcess.set(item.id, item));
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
      this._queue.splice(idx, 1);
      return true;
    }

    return false;
  };

  /**
   * Marks an item as done processing and removes it from the in-process map
   * @param id - Optional ID of the item to mark as done. If not provided, clears all in-process items
   */
  public doneProcessing = (id?: ItemID): void => {
    if (id !== undefined) {
      this._inProcess.delete(id);
      return;
    }

    this._inProcess.clear();
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
}

export default ProcessQueue;
