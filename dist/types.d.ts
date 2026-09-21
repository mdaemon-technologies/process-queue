/**
 * Type representing valid item IDs - either strings or numbers
 */
export type ItemID = string | number;
/**
 * The shape every queue item must have: an ID. Item types may add any other properties,
 * and may be declared as interfaces or type aliases.
 */
export interface Item {
    /** Unique identifier for the item */
    id: ItemID;
}
/**
 * Queue state as serialize() produces it and deserialize() accepts it
 */
export interface Snapshot<QueueItem extends Item> {
    /** Queued items, including items awaiting a retry, in processing order */
    queue: QueueItem[];
    /** Items being processed */
    inProcess?: QueueItem[];
    /** Permanently failed items, oldest first */
    deadLetterQueue?: QueueItem[];
}
/**
 * Options for configuring a ProcessQueue instance
 */
export interface ProcessQueueOptions<QueueItem extends Item> {
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
    /** Maximum items kept in the dead letter queue; the oldest are dropped first (default 1000) */
    maxDeadLetterSize?: number;
    /** Delay between retries in ms, or function (attempt) => ms for backoff */
    retryDelay?: number | ((attempt: number) => number);
    /** Time-to-live in ms - items expire from queue after this duration */
    ttl?: number;
    /** Processing timeout in ms - items auto-released from in-process if not done */
    processingTimeout?: number;
    /** Called when an event listener throws. Defaults to console.error. Listener errors never affect queue state */
    onListenerError?: (error: unknown, event: ProcessQueueEvent) => void;
}
/**
 * Handler for an event without a payload. The optional parameters let one-parameter
 * handlers written for the general EventHandler type keep compiling.
 */
type NoPayloadHandler = (item?: undefined, error?: undefined) => void;
/**
 * The handler signature of each event ProcessQueue emits
 */
export type ProcessQueueEvents<QueueItem extends Item> = {
    /** An item was queued or updated */
    added: (item: QueueItem) => void;
    /** Items started processing: one item, or an array from processBatch/getQueue(true) */
    processing: (item: QueueItem | QueueItem[]) => void;
    /** An item finished; no item when doneProcessing() released everything */
    done: (item?: QueueItem) => void;
    /** An item was removed or evicted from the queue */
    removed: (item: QueueItem) => void;
    /** An item's TTL passed before it was processed */
    expired: (item: QueueItem) => void;
    /** An item was released by checkProcessingTimeouts() */
    timeout: (item: QueueItem) => void;
    /** The worker failed on an item */
    error: (item: QueueItem, error: Error) => void;
    /** An item was moved to the dead letter queue; error is the final cause */
    failed: (item: QueueItem, error: Error) => void;
    /** The queue became empty */
    empty: NoPayloadHandler;
    /** The queue is empty and nothing is in process or awaiting a retry */
    drain: NoPayloadHandler;
    paused: NoPayloadHandler;
    resumed: NoPayloadHandler;
};
/**
 * Event types emitted by ProcessQueue
 */
export type ProcessQueueEvent = keyof ProcessQueueEvents<Item>;
/** True if T is a union of more than one type */
type IsUnion<T, U = T> = T extends unknown ? ([U] extends [T] ? false : true) : never;
/**
 * The handler type accepted by on/off/once for an event: the event's precise signature for a
 * single event name, or the general EventHandler when the name is a union (a variable)
 */
export type ListenerFor<QueueItem extends Item, E extends ProcessQueueEvent> = IsUnion<E> extends true ? EventHandler<QueueItem> : ProcessQueueEvents<QueueItem>[E];
/**
 * Overflow strategies, in the order they are listed in error messages
 */
export declare const OVERFLOW_STRATEGIES: readonly ["reject", "drop-oldest", "drop-newest"];
/**
 * Overflow strategy when queue is full
 */
export type OverflowStrategy = typeof OVERFLOW_STRATEGIES[number];
/**
 * A handler that accepts any event's arguments. Assignable to every entry of ProcessQueueEvents.
 */
export type EventHandler<QueueItem extends Item> = (item?: QueueItem | QueueItem[], error?: Error) => void;
export {};
