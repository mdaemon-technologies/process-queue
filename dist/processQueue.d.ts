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
 * A queue that processes items with unique IDs
 * @template QueueItem - Type of items in the queue, must extend Item interface
 */
declare class ProcessQueue<QueueItem extends Item> {
    /** Array storing queued items */
    private readonly _queue;
    /** Map storing items currently being processed */
    private readonly _inProcess;
    /** If true, new items replace existing ones at their position */
    private _emplace;
    /** Maximum number of items allowed in queue */
    private _maxSize;
    /** Custom comparator for priority ordering */
    private _comparator?;
    /** Overflow strategy */
    private _overflowStrategy;
    /** Whether the queue is paused */
    private _paused;
    /** Worker function for auto-processing */
    private _worker?;
    /** Maximum concurrent worker invocations */
    private _concurrency;
    /** Maximum retry attempts */
    private _maxRetries;
    /** Retry delay config */
    private _retryDelay;
    /** Retry count per item */
    private readonly _retryCount;
    /** Dead letter queue for permanently failed items */
    private readonly _deadLetterQueue;
    /** TTL in ms for queue items */
    private _ttl;
    /** Processing timeout in ms */
    private _processingTimeout;
    /** Timestamps when items were enqueued */
    private readonly _enqueuedAt;
    /** Timestamps when items started processing */
    private readonly _processingStartedAt;
    /** Event listeners map */
    private readonly _listeners;
    /** Once listeners (auto-removed after first call) */
    private readonly _onceListeners;
    /**
     * Creates a new ProcessQueue instance
     * @param optionsOrEmplace - Options object or boolean for emplace mode (backward compat)
     * @param maxSize - Maximum queue size (only used with boolean first arg)
     */
    constructor(optionsOrEmplace?: ProcessQueueOptions<QueueItem> | boolean, maxSize?: number);
    /**
     * Checks if an item with given ID is currently being processed
     * @param id - ID to check
     * @returns True if item is being processed, false otherwise
     */
    isProcessing: (id: ItemID) => boolean;
    /**
     * Adds or updates an item in the queue
     * @param item - Item to add to queue
     * @returns True if item was added/updated successfully, false if item is already being processed
     * @throws {Error} If item has invalid ID or queue size limit is reached
     */
    queueItem: (item: QueueItem) => boolean;
    /**
     * Inserts an item into the queue respecting comparator/priority ordering
     * If no comparator: emplace mode appends to back, otherwise inserts at front
     */
    private _insertItem;
    /**
     * Gets and removes the next item from the queue, marking it as in-process
     * @returns The next queue item, or null if queue is empty
     */
    getNextItem: () => QueueItem | null;
    /**
     * Gets all items in the queue
     * @param processing - If true, moves all items to in-process state and empties the queue
     * @returns Array of queue items
     */
    getQueue: (processing?: boolean) => QueueItem[];
    /**
     * Processes a batch of items from the queue and marks them as in-process
     * @param batchSize - The number of items to process from the front of the queue
     * @returns Array of queue items that were processed
     */
    processBatch: (batchSize: number) => QueueItem[];
    /**
     * Removes an item from the queue by its ID
     * @param id - ID of the item to remove
     * @returns True if item was found and removed, false otherwise
     */
    removeFromQueue: (id: ItemID) => boolean;
    /**
     * Marks an item as done processing and removes it from the in-process map
     * @param id - Optional ID or array of IDs to mark as done. If not provided, clears all in-process items
     */
    doneProcessing: (id?: ItemID | ItemID[]) => void;
    /**
     * Gets the length of the queue, optionally filtered by a property value
     * @param prop - Optional property key to filter by
     * @param val - Optional value to match against the property
     * @returns The number of items in the queue matching the criteria
     */
    length: <K extends keyof QueueItem>(prop?: K, val?: QueueItem[K]) => number;
    /**
     * Clears all items from both the queue and in-process map
     */
    clear: () => void;
    /**
     * Checks if the queue is empty
     * @returns True if the queue has no items, false otherwise
     */
    isEmpty: () => boolean;
    /**
     * Checks if there are any items currently being processed
     * @returns True if there are items being processed, false otherwise
     */
    busy: () => boolean;
    /**
     * Gets the number of items currently being processed
     * @returns The number of items in the in-process map
     */
    processSize: () => number;
    /**
     * Pauses the queue - getNextItem and processBatch will return null/empty
     */
    pause: () => void;
    /**
     * Resumes the queue after being paused
     */
    resume: () => void;
    /**
     * Starts auto-processing (alias for resume, useful in worker mode)
     */
    start: () => void;
    /**
     * Stops auto-processing (alias for pause, useful in worker mode)
     */
    stop: () => void;
    /**
     * Checks if the queue is currently paused
     * @returns True if the queue is paused
     */
    isPaused: () => boolean;
    /**
     * Returns the next item in the queue without removing it
     * @returns The next queue item, or null if queue is empty
     */
    peek: () => QueueItem | null;
    /**
     * Checks if an item with the given ID exists in the queue
     * @param id - ID to check
     * @returns True if item is in the queue, false otherwise
     */
    has: (id: ItemID) => boolean;
    /**
     * Gets all items currently being processed
     * @returns Array of items in the in-process map
     */
    getInProcess: () => QueueItem[];
    /**
     * Adds multiple items to the queue atomically
     * @param items - Array of items to add
     * @returns Array of booleans indicating success for each item
     * @throws {Error} If any item has invalid ID or queue size limit would be exceeded
     */
    queueMany: (items: QueueItem[]) => boolean[];
    /**
     * Registers an event listener
     * @param event - Event name to listen for
     * @param handler - Function to call when event fires
     */
    on: (event: ProcessQueueEvent, handler: EventHandler<QueueItem>) => void;
    /**
     * Removes an event listener
     * @param event - Event name to remove listener from
     * @param handler - Function to remove
     */
    off: (event: ProcessQueueEvent, handler: EventHandler<QueueItem>) => void;
    /**
     * Registers a one-time event listener that auto-removes after first call
     * @param event - Event name to listen for
     * @param handler - Function to call once when event fires
     */
    once: (event: ProcessQueueEvent, handler: EventHandler<QueueItem>) => void;
    /**
     * Emits an event to all registered listeners
     */
    private _emit;
    /**
     * Checks if queue is empty and no items are processing, emits drain/empty as appropriate
     */
    private _checkDrain;
    /**
     * Removes expired items from the queue (lazy TTL check)
     */
    private _expireItems;
    /**
     * Checks for items that have exceeded the processing timeout
     * Emits 'timeout' event and removes items from in-process
     */
    checkProcessingTimeouts: () => void;
    /**
     * Auto-processes items when a worker is configured and concurrency allows
     */
    private _autoProcess;
    /**
     * Handles worker errors with retry logic
     */
    private _handleWorkerError;
    /**
     * Gets all items in the dead letter queue (permanently failed)
     * @returns Array of failed items
     */
    getDeadLetterQueue: () => QueueItem[];
    /**
     * Clears the dead letter queue
     */
    clearDeadLetterQueue: () => void;
    /**
     * Makes the queue iterable with for...of
     */
    [Symbol.iterator](): Iterator<QueueItem>;
    /**
     * Serializes the queue state to a JSON-compatible object
     * @returns Serializable snapshot of queue state
     */
    serialize: () => {
        queue: QueueItem[];
        inProcess: QueueItem[];
        deadLetterQueue: QueueItem[];
    };
    /**
     * Restores a ProcessQueue from a serialized snapshot
     * @param data - Serialized data from serialize()
     * @param options - Options for the new queue instance
     * @returns A new ProcessQueue populated with the serialized state
     */
    static deserialize: <T extends Item>(data: {
        queue: T[];
        inProcess?: T[];
        deadLetterQueue?: T[];
    }, options?: ProcessQueueOptions<T> | boolean) => ProcessQueue<T>;
}
export default ProcessQueue;
