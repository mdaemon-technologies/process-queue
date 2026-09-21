import { Item, ItemID, ListenerFor, ProcessQueueEvent, ProcessQueueOptions, Snapshot } from './types.js';
/**
 * A queue that processes items with unique IDs.
 *
 * This class coordinates the internal modules and is the only place that emits events
 * or calls the worker. Per-item state is always settled before an event is emitted,
 * because a listener may call straight back into the queue.
 * @template QueueItem - Type of items in the queue; must have an id. Without a type argument,
 *                      items may carry any other properties.
 */
declare class ProcessQueue<QueueItem extends Item = Item & {
    [key: string]: unknown;
}> {
    private readonly _options;
    /** Queued items, in processing order */
    private readonly _queue;
    /** Items being processed */
    private readonly _inFlight;
    /** Retry counts and items waiting out a retry delay */
    private readonly _retries;
    /** Permanently failed items */
    private readonly _deadLetters;
    private readonly _events;
    /** Whether the queue is paused */
    private _paused;
    /** True once 'empty' has been emitted for the current empty period; the queue starts empty */
    private _emptyReported;
    /** True once 'drain' has been emitted for the current idle period; the queue starts idle */
    private _drainReported;
    /** The promise shared by every onIdle() caller waiting for the queue to become idle */
    private _idleWaiter?;
    /** True while _autoProcess is running, to prevent re-entrant recursion */
    private _autoProcessing;
    /** Set when _autoProcess was requested while already running */
    private _autoProcessAgain;
    /**
     * What each overflow strategy does when a new item arrives at a full queue:
     * returns the index of the queued item to evict (-1 if none), returns null to drop the new item, or throws
     */
    private readonly _overflowHandlers;
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
     * @returns True if item was added/updated, false if its ID is in-process or awaiting a retry,
     *          or the queue is full and overflowStrategy is 'drop-newest'
     * @throws {Error} If item has an invalid ID, or the queue is full and overflowStrategy is 'reject'
     */
    queueItem: (item: QueueItem) => boolean;
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
     * Clears the queue, in-process items and pending retries
     */
    clear: () => void;
    /**
     * Waits until nothing is queued, in process or awaiting a retry.
     * Unlike a 'drain' listener, it cannot miss work that finished before it was called.
     * Callers waiting at the same time share one promise, so abandoned calls cost nothing.
     * @returns A promise that resolves immediately if the queue is idle, otherwise when it next becomes
     *          idle after every 'drain' listener has run (the queue may have new work by the time awaiting code resumes)
     */
    onIdle: () => Promise<void>;
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
     * Adds multiple items to the queue in order. Not atomic: if an item throws,
     * the items before it remain queued
     * @param items - Array of items to add
     * @returns Array of booleans indicating success for each item
     * @throws {Error} As queueItem, on the first item that throws
     */
    queueMany: (items: QueueItem[]) => boolean[];
    /**
     * Registers an event listener
     * @param event - Event name to listen for
     * @param handler - Function to call when event fires
     */
    on: <E extends ProcessQueueEvent>(event: E, handler: ListenerFor<QueueItem, E>) => void;
    /**
     * Removes an event listener
     * @param event - Event name to remove listener from
     * @param handler - Function to remove
     */
    off: <E extends ProcessQueueEvent>(event: E, handler: ListenerFor<QueueItem, E>) => void;
    /**
     * Registers a one-time event listener that auto-removes after first call
     * @param event - Event name to listen for
     * @param handler - Function to call once when event fires
     */
    once: <E extends ProcessQueueEvent>(event: E, handler: ListenerFor<QueueItem, E>) => void;
    /**
     * Checks for items that have exceeded the processing timeout
     * Emits 'timeout' event and removes items from in-process
     */
    checkProcessingTimeouts: () => void;
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
    serialize: () => Required<Snapshot<QueueItem>>;
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
    static deserialize: <T extends Item>(data: Snapshot<T>, options?: ProcessQueueOptions<T> | boolean) => ProcessQueue<T>;
    /**
     * Emits an event. Handlers always receive both arguments (item, error), even when
     * the event has no payload, as they always have.
     */
    private _emit;
    /**
     * Takes items from the front of the queue and marks them in-process
     * @param count - Maximum number of items to take
     * @returns The items taken, in queue order
     */
    private _takeForProcessing;
    /**
     * Removes a queued item for good
     * @returns The removed item, or undefined if the id is not queued
     */
    private _removeQueued;
    /**
     * Forgets the retry counts of items that left the queue for good (removed, evicted or expired),
     * so a later item with the same id starts with its full retry budget
     */
    private _forgetDiscarded;
    /**
     * Removes expired items from the queue (lazy TTL check)
     */
    private _expireItems;
    /**
     * Forgets everything about an in-process item: its in-flight bookkeeping and its retry count
     */
    private _releaseInProcess;
    /**
     * Releases every in-process item without a worker result, as _releaseInProcess does for one
     */
    private _releaseAllInProcess;
    /**
     * Marks one item done, if it is in-process. IDs that are queued or awaiting
     * a retry are left alone, so their retry budget is not reset.
     */
    private _releaseIfInProcess;
    /**
     * Emits 'empty' if the queue has become empty since it was last reported empty
     */
    private _checkEmpty;
    /**
     * Records that an item entered the queue, so the next empty and idle periods are reported
     */
    private _markWorkAdded;
    /** Whether nothing is queued, in process or awaiting a retry */
    private _isIdle;
    /**
     * Emits 'empty' if the queue has just become empty, then 'drain' if the queue has just become idle
     */
    private _checkDrain;
    /**
     * Auto-processes items when a worker is configured and concurrency allows.
     * Re-entrant calls (from synchronous workers, retries and listeners) are folded
     * into the outermost call's loop so the call stack never grows with queue length.
     */
    private _autoProcess;
    /**
     * Starts the worker on queued items until concurrency is exhausted
     */
    private _startAvailableWork;
    /**
     * Completes a successful worker run
     */
    private _onWorkerSuccess;
    /**
     * Completes a failed worker run
     */
    private _onWorkerFailure;
    /**
     * Handles worker errors with retry logic.
     * The retry is reserved (queued or pending) before 'error' is emitted, so a listener
     * that re-queues the same id updates the retry rather than creating a duplicate.
     */
    private _handleWorkerError;
    /**
     * The delay before retrying an item, in ms
     * @param attempt - The attempt that just failed, starting at 1
     * @throws If the retryDelay function throws or returns a value that cannot be converted to a number
     */
    private _retryDelayFor;
    /**
     * Puts a failed item back in the queue for another attempt.
     * Retries bypass maxSize: the item was already admitted, so the queue can
     * exceed maxSize by at most the number of items in flight.
     * @returns The comparator's error if it threw (the item is then not queued)
     */
    private _requeueForRetry;
    /**
     * Gives up on an item: clears its retry count and dead-letters it, then emits 'error'
     * for the worker's error when there is one to report, and 'failed' with the final cause
     * @param failure - The reason the item is dead-lettered, reported with 'failed'
     * @param workerError - The worker error not yet reported with 'error', if any
     */
    private _failPermanently;
}
export default ProcessQueue;
export type { EventHandler, Item, ItemID, ListenerFor, OverflowStrategy, ProcessQueueEvent, ProcessQueueEvents, ProcessQueueOptions, Snapshot, } from './types.js';
