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
 * A queue that processes items with unique IDs
 * @template QueueItem - Type of items in the queue, must extend Item interface
 */
declare class ProcessQueue<QueueItem extends Item = Item> {
  /**
   * Creates a new ProcessQueue instance
   * @param _emplace - If true, new items replace existing ones at their position, if false items are added to front
   * @param _maxSize - Maximum number of items allowed in queue
   */
  constructor(_emplace?: boolean, _maxSize?: number);

  /**
   * Checks if an item with given ID is currently being processed
   * @param id - ID to check
   * @returns True if item is being processed, false otherwise
   */
  isProcessing(id: ItemID): boolean;

  /**
   * Adds or updates an item in the queue
   * @param item - Item to add to queue
   * @returns True if item was added/updated successfully, false if item is already being processed
   * @throws {Error} If item has invalid ID or queue size limit is reached
   */
  queueItem(item: QueueItem): boolean;

  /**
   * Gets and removes the next item from the queue, marking it as in-process
   * @returns The next queue item, or null if queue is empty
   */
  getNextItem(): QueueItem | null;

  /**
   * Gets all items in the queue
   * @param processing - If true, moves all items to in-process state and empties the queue
   * @returns Array of queue items
   */
  getQueue(processing?: boolean): QueueItem[];

  /**
   * Processes a batch of items from the queue and marks them as in-process
   * @param batchSize - The number of items to process from the front of the queue
   * @returns Array of queue items that were processed
   */
  processBatch(batchSize: number): QueueItem[];

  /**
   * Removes an item from the queue by its ID
   * @param id - ID of the item to remove
   * @returns True if item was found and removed, false otherwise
   */
  removeFromQueue(id: ItemID): boolean;

  /**
   * Marks an item as done processing and removes it from the in-process map
   * @param id - Optional ID of the item to mark as done. If not provided, clears all in-process items
   */
  doneProcessing(id?: ItemID): void;

  /**
   * Gets the length of the queue, optionally filtered by a property value
   * @param prop - Optional property key to filter by
   * @param val - Optional value to match against the property
   * @returns The number of items in the queue matching the criteria
   */
  length<K extends keyof QueueItem>(prop?: K, val?: QueueItem[K]): number;

  /**
   * Clears all items from both the queue and in-process map
   */
  clear(): void;

  /**
   * Checks if the queue is empty
   * @returns True if the queue has no items, false otherwise
   */
  isEmpty(): boolean;

  /**
   * Checks if there are any items currently being processed
   * @returns True if there are items being processed, false otherwise
   */
  busy(): boolean;

  /**
   * Gets the number of items currently being processed
   * @returns The number of items in the in-process map
   */
  processSize(): number;
}

export default ProcessQueue;