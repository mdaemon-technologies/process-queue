/**
 * Validates if a value is a valid ItemID
 * @param id - Value to check
 * @returns True if id is a non-empty string or number, false otherwise
 */
const isItemID = (id) => (typeof id === "string" && id.length > 0) || typeof id === "number";
/**
 * A queue that processes items with unique IDs
 * @template QueueItem - Type of items in the queue, must extend Item interface
 */
class ProcessQueue {
    /** Array storing queued items */
    _queue = [];
    /** Map storing items currently being processed */
    _inProcess = new Map();
    /** If true, new items replace existing ones at their position */
    _emplace;
    /** Maximum number of items allowed in queue */
    _maxSize;
    /** Custom comparator for priority ordering */
    _comparator;
    /** Overflow strategy */
    _overflowStrategy;
    /** Whether the queue is paused */
    _paused = false;
    /** Worker function for auto-processing */
    _worker;
    /** Maximum concurrent worker invocations */
    _concurrency;
    /** Maximum retry attempts */
    _maxRetries;
    /** Retry delay config */
    _retryDelay;
    /** Retry count per item */
    _retryCount = new Map();
    /** Dead letter queue for permanently failed items */
    _deadLetterQueue = [];
    /** TTL in ms for queue items */
    _ttl;
    /** Processing timeout in ms */
    _processingTimeout;
    /** Timestamps when items were enqueued */
    _enqueuedAt = new Map();
    /** Timestamps when items started processing */
    _processingStartedAt = new Map();
    /** Event listeners map */
    _listeners = new Map();
    /** Once listeners (auto-removed after first call) */
    _onceListeners = new Map();
    /**
     * Creates a new ProcessQueue instance
     * @param optionsOrEmplace - Options object or boolean for emplace mode (backward compat)
     * @param maxSize - Maximum queue size (only used with boolean first arg)
     */
    constructor(optionsOrEmplace, maxSize) {
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
        }
        else {
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
    isProcessing = (id) => {
        return !!this._inProcess.get(id);
    };
    /**
     * Adds or updates an item in the queue
     * @param item - Item to add to queue
     * @returns True if item was added/updated successfully, false if item is already being processed
     * @throws {Error} If item has invalid ID or queue size limit is reached
     */
    queueItem = (item) => {
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
                if (this._ttl > 0)
                    this._enqueuedAt.set(item.id, Date.now());
                this._emit('added', item);
                this._autoProcess();
                return true;
            }
            this._insertItem(item);
            if (this._ttl > 0)
                this._enqueuedAt.set(item.id, Date.now());
            this._emit('added', item);
            this._autoProcess();
            return true;
        }
        if (idx >= 0) {
            this._queue.splice(idx, 1);
        }
        this._insertItem(item);
        if (this._ttl > 0)
            this._enqueuedAt.set(item.id, Date.now());
        this._emit('added', item);
        this._autoProcess();
        return true;
    };
    /**
     * Inserts an item into the queue respecting comparator/priority ordering
     * If no comparator: emplace mode appends to back, otherwise inserts at front
     */
    _insertItem = (item) => {
        if (this._comparator) {
            const insertIdx = this._queue.findIndex(q => this._comparator(item, q) < 0);
            if (insertIdx === -1) {
                this._queue.push(item);
            }
            else {
                this._queue.splice(insertIdx, 0, item);
            }
        }
        else if (this._emplace) {
            this._queue.push(item);
        }
        else {
            this._queue.unshift(item);
        }
    };
    /**
     * Gets and removes the next item from the queue, marking it as in-process
     * @returns The next queue item, or null if queue is empty
     */
    getNextItem = () => {
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
        if (this._processingTimeout > 0)
            this._processingStartedAt.set(item.id, Date.now());
        this._emit('processing', item);
        this._checkDrain();
        return item;
    };
    /**
     * Gets all items in the queue
     * @param processing - If true, moves all items to in-process state and empties the queue
     * @returns Array of queue items
     */
    getQueue = (processing = false) => {
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
    processBatch = (batchSize) => {
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
    removeFromQueue = (id) => {
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
    doneProcessing = (id) => {
        if (id !== undefined) {
            if (Array.isArray(id)) {
                id.forEach(i => {
                    const item = this._inProcess.get(i);
                    this._inProcess.delete(i);
                    this._processingStartedAt.delete(i);
                    if (item)
                        this._emit('done', item);
                });
                this._checkDrain();
                return;
            }
            const item = this._inProcess.get(id);
            this._inProcess.delete(id);
            this._processingStartedAt.delete(id);
            if (item)
                this._emit('done', item);
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
    length = (prop, val) => {
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
    clear = () => {
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
    isEmpty = () => {
        return this._queue.length === 0;
    };
    /**
     * Checks if there are any items currently being processed
     * @returns True if there are items being processed, false otherwise
     */
    busy = () => {
        return this._inProcess.size > 0;
    };
    /**
     * Gets the number of items currently being processed
     * @returns The number of items in the in-process map
     */
    processSize = () => {
        return this._inProcess.size;
    };
    /**
     * Pauses the queue - getNextItem and processBatch will return null/empty
     */
    pause = () => {
        this._paused = true;
        this._emit('paused');
    };
    /**
     * Resumes the queue after being paused
     */
    resume = () => {
        this._paused = false;
        this._emit('resumed');
        this._autoProcess();
    };
    /**
     * Starts auto-processing (alias for resume, useful in worker mode)
     */
    start = () => {
        this.resume();
    };
    /**
     * Stops auto-processing (alias for pause, useful in worker mode)
     */
    stop = () => {
        this.pause();
    };
    /**
     * Checks if the queue is currently paused
     * @returns True if the queue is paused
     */
    isPaused = () => {
        return this._paused;
    };
    /**
     * Returns the next item in the queue without removing it
     * @returns The next queue item, or null if queue is empty
     */
    peek = () => {
        return this._queue.length > 0 ? this._queue[0] : null;
    };
    /**
     * Checks if an item with the given ID exists in the queue
     * @param id - ID to check
     * @returns True if item is in the queue, false otherwise
     */
    has = (id) => {
        return this._queue.some(item => item.id === id);
    };
    /**
     * Gets all items currently being processed
     * @returns Array of items in the in-process map
     */
    getInProcess = () => {
        return Array.from(this._inProcess.values());
    };
    /**
     * Adds multiple items to the queue atomically
     * @param items - Array of items to add
     * @returns Array of booleans indicating success for each item
     * @throws {Error} If any item has invalid ID or queue size limit would be exceeded
     */
    queueMany = (items) => {
        return items.map(item => this.queueItem(item));
    };
    /**
     * Registers an event listener
     * @param event - Event name to listen for
     * @param handler - Function to call when event fires
     */
    on = (event, handler) => {
        if (!this._listeners.has(event)) {
            this._listeners.set(event, new Set());
        }
        this._listeners.get(event).add(handler);
    };
    /**
     * Removes an event listener
     * @param event - Event name to remove listener from
     * @param handler - Function to remove
     */
    off = (event, handler) => {
        this._listeners.get(event)?.delete(handler);
        this._onceListeners.get(event)?.delete(handler);
    };
    /**
     * Registers a one-time event listener that auto-removes after first call
     * @param event - Event name to listen for
     * @param handler - Function to call once when event fires
     */
    once = (event, handler) => {
        if (!this._onceListeners.has(event)) {
            this._onceListeners.set(event, new Set());
        }
        this._onceListeners.get(event).add(handler);
    };
    /**
     * Emits an event to all registered listeners
     */
    _emit = (event, item, error) => {
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
    _checkDrain = () => {
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
    _expireItems = () => {
        if (this._ttl <= 0)
            return;
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
    checkProcessingTimeouts = () => {
        if (this._processingTimeout <= 0)
            return;
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
    _autoProcess = () => {
        if (!this._worker || this._paused) {
            return;
        }
        this._expireItems();
        while (this._inProcess.size < this._concurrency && this._queue.length > 0) {
            const item = this._queue.shift();
            if (!item)
                break;
            this._enqueuedAt.delete(item.id);
            this._inProcess.set(item.id, item);
            if (this._processingTimeout > 0)
                this._processingStartedAt.set(item.id, Date.now());
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
                    }).catch((err) => {
                        this._inProcess.delete(item.id);
                        this._processingStartedAt.delete(item.id);
                        this._handleWorkerError(item, err);
                    });
                }
                else {
                    this._inProcess.delete(item.id);
                    this._processingStartedAt.delete(item.id);
                    this._retryCount.delete(item.id);
                    this._emit('done', item);
                    this._checkDrain();
                }
            }
            catch (err) {
                this._inProcess.delete(item.id);
                this._processingStartedAt.delete(item.id);
                this._handleWorkerError(item, err instanceof Error ? err : new Error(String(err)));
            }
        }
    };
    /**
     * Handles worker errors with retry logic
     */
    _handleWorkerError = (item, err) => {
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
            }
            else {
                this._queue.unshift(item);
                this._checkDrain();
                this._autoProcess();
            }
        }
        else {
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
    getDeadLetterQueue = () => {
        return [...this._deadLetterQueue];
    };
    /**
     * Clears the dead letter queue
     */
    clearDeadLetterQueue = () => {
        this._deadLetterQueue.splice(0, this._deadLetterQueue.length);
    };
    /**
     * Makes the queue iterable with for...of
     */
    [Symbol.iterator]() {
        let index = 0;
        const queue = this._queue;
        return {
            next() {
                if (index < queue.length) {
                    return { value: queue[index++], done: false };
                }
                return { value: undefined, done: true };
            }
        };
    }
    /**
     * Serializes the queue state to a JSON-compatible object
     * @returns Serializable snapshot of queue state
     */
    serialize = () => {
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
    static deserialize = (data, options) => {
        const queue = new ProcessQueue(options);
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
