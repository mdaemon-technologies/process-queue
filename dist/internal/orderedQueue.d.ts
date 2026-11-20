import { Item, ItemID } from '../types.js';
import { Clock } from './clock.js';
/** How an OrderedQueue places and ages its items */
export interface OrderedQueueConfig<T extends Item> {
    /** Append new items and replace updated ones in place; otherwise insert at the front */
    emplace: boolean;
    /** Priority order; takes precedence over emplace for placement */
    comparator?: (a: T, b: T) => number;
    /** Time-to-live in ms (0 = disabled) */
    ttl: number;
    clock: Clock;
}
/**
 * The queued items, in processing order, with the per-item bookkeeping that must
 * stay in step with them: arrival order (for drop-oldest) and enqueue time (for the TTL).
 * Every method that removes an item also forgets its bookkeeping.
 * Never emits and never calls user code except the comparator, which always runs
 * before anything changes, so a throwing comparator leaves the queue intact.
 *
 * Finding an item and the oldest arrival is O(1). Adding at the front or back, updating, taking
 * from the front and removing are O(1), or O(log n) with a TTL; expiring k items is O(k log n).
 * Placing an item with a comparator scans the queue, O(n).
 */
export declare class OrderedQueue<T extends Item> {
    private readonly config;
    /** The queue, by id */
    private readonly _entries;
    /** The queue in processing order */
    private _head;
    private _tail;
    /**
     * The queue in arrival order, oldest first. A linked list rather than an insertion-ordered Map:
     * V8 finds a Map's first key by skipping the entries deleted before it, which would make drop-oldest O(n).
     */
    private _oldest;
    private _newest;
    private _arrivals;
    /**
     * A binary min-heap of the entries that have an enqueue time, earliest first. Enqueue times are
     * not in queue order or even in insertion order: an emplace update renews the time in place,
     * restore() takes the snapshot's times, and the system clock can go back.
     */
    private readonly _byEnqueuedAt;
    /** Counts changes to which items are queued, so a comparator that changes the queue mid-scan is caught */
    private _changes;
    constructor(config: OrderedQueueConfig<T>);
    get length(): number;
    /** A copy of the items, in processing order */
    toArray: () => T[];
    /** The next item to process, without removing it */
    peek: () => T | undefined;
    has: (id: ItemID) => boolean;
    /** When a queued item was put, for the TTL; undefined without a TTL, and for retried items */
    enqueuedAt: (id: ItemID) => number | undefined;
    /**
     * Iterates the live queue. Items removed before the iterator reaches them are skipped, and no item
     * is visited twice unless it is re-queued. While the last item visited stays queued, items inserted
     * after it are visited; once it is removed, iteration carries on from the item that followed it then.
     */
    [Symbol.iterator](): Iterator<T>;
    /**
     * Finds the earliest-arrived item, whatever its position
     * @returns Its id, or undefined if the queue is empty
     */
    oldest: () => ItemID | undefined;
    /**
     * Adds an item, or updates the queued item with the same id
     * @param evictId - Id of a queued item to evict to make room, if any; ignored for an update
     * @returns The evicted item, if any
     * @throws Whatever the comparator throws, before anything changes
     */
    put: (item: T, evictId?: ItemID) => T | undefined;
    /**
     * Puts a retried item back: in comparator order when there is a comparator,
     * otherwise at the front. Retried items are exempt from the TTL.
     * ProcessQueue never retries an id that is queued: the id stays reserved, in process or awaiting
     * its retry, until the retry enters the queue. Should a queued copy exist all the same, it is
     * replaced, so an id is never queued twice.
     * @throws Whatever the comparator throws, before anything changes
     */
    insertRetry: (item: T) => void;
    /**
     * Removes items from the front
     * @param count - Maximum number of items to take, coerced as Array.prototype.splice coerces it.
     *                Unlike splice, the length is read after converting it, which may run user code (valueOf).
     * @returns The items taken, in queue order
     * @throws {TypeError} If count cannot be converted to a number (a Symbol or a BigInt)
     */
    take: (count: number) => T[];
    /**
     * Removes an item by id
     * @returns The removed item, or undefined if the id is not queued
     */
    remove: (id: ItemID) => T | undefined;
    /**
     * Removes every item older than the TTL
     * @returns The expired items, in queue order
     */
    expire: () => T[];
    /**
     * Loads items from a snapshot: in comparator order when there is a comparator, otherwise
     * in the given order. Each is subject to the TTL from its given enqueue time, or else from now,
     * unless it is exempt.
     * @param enqueuedAt - Enqueue times (clock time in ms) by id
     * @param exempt - Ids exempt from the TTL, as retried items are
     * @throws Whatever the comparator throws, before anything changes
     */
    restore: (items: readonly T[], enqueuedAt?: ReadonlyMap<ItemID, number>, exempt?: ReadonlySet<ItemID>) => void;
    /** Removes every item */
    clear: () => void;
    /** Sizes of the per-item bookkeeping, for leak checks */
    bookkeepingSizes: () => {
        enqueuedAt: number;
        arrivals: number;
    };
    /**
     * Finds where an item belongs, respecting comparator/priority ordering:
     * before the first entry the comparator puts after it. Without a comparator,
     * emplace mode appends to the back, otherwise the item goes to the front.
     * @param skip - An entry that will be removed before inserting
     * @returns The entry to insert before, or null for the back
     * @throws Whatever the comparator throws, or an Error if the comparator changes the queue,
     *         which would leave the position stale
     */
    private _findInsertPosition;
    /** The entry to insert before to put an item at the front, once `skip` has been removed */
    private _front;
    /**
     * Links a new entry for an item whose id is not queued, before `before` or at the back for null.
     * The caller records its arrival and enqueue time.
     * @returns The new entry
     */
    private _link;
    /**
     * Unlinks an entry from the queue and forgets its bookkeeping
     * @returns Its item
     */
    private _unlink;
    /** Marks an unlinked entry removed and drops everything but its `next` */
    private _retire;
    private _rankBetween;
    private _fitsBetween;
    /** Renumbers the queue 0, 1, 2, … in processing order */
    private _renumber;
    /** Makes a newly linked entry the newest arrival */
    private _recordArrival;
    /** Records when an entry was put, for the TTL; does nothing without a TTL */
    private _markEnqueued;
    private _heapDelete;
    private _siftUp;
    private _siftDown;
}
