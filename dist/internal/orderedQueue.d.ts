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
 */
export declare class OrderedQueue<T extends Item> {
    private readonly config;
    private readonly _items;
    private readonly _enqueuedAt;
    private readonly _arrivals;
    private _nextArrival;
    constructor(config: OrderedQueueConfig<T>);
    get length(): number;
    /** A copy of the items, in processing order */
    toArray: () => T[];
    /** The next item to process, without removing it */
    peek: () => T | undefined;
    /**
     * Finds a queued item by id
     * @returns Its index, or -1 if it is not queued
     */
    indexOf: (id: ItemID) => number;
    has: (id: ItemID) => boolean;
    /** Iterates the live queue */
    [Symbol.iterator](): Iterator<T>;
    /**
     * Finds the earliest-arrived item, whatever its position
     * @returns Its index, or -1 if the queue is empty
     */
    findOldestIndex: () => number;
    /**
     * Adds an item, or updates the queued item with the same id
     * @param existingIdx - indexOf(item.id)
     * @param evictIdx - Index of an item to evict to make room, or -1
     * @returns The evicted item, if any
     * @throws Whatever the comparator throws, before anything changes
     */
    put: (item: T, existingIdx: number, evictIdx: number) => T | undefined;
    /**
     * Puts a retried item back: in comparator order when there is a comparator,
     * otherwise at the front. Retried items are exempt from the TTL.
     * @throws Whatever the comparator throws, before anything changes
     */
    insertRetry: (item: T) => void;
    /**
     * Removes items from the front
     * @param count - Maximum number of items to take
     * @returns The items taken, in queue order
     */
    take: (count: number) => T[];
    /**
     * Removes an item by id
     * @returns The removed item, or undefined if the id is not queued
     */
    remove: (id: ItemID) => T | undefined;
    /**
     * Removes every item older than the TTL
     * @returns The expired items
     */
    expire: () => T[];
    /**
     * Loads items from a snapshot, subject to the TTL from now: in comparator order when
     * there is a comparator, otherwise in the given order
     * @throws Whatever the comparator throws, before anything changes
     */
    restore: (items: readonly T[]) => void;
    /** Removes every item */
    clear: () => void;
    /** Sizes of the per-item bookkeeping, for leak checks */
    bookkeepingSizes: () => {
        enqueuedAt: number;
        arrivals: number;
    };
    /**
     * Finds where an item belongs, respecting comparator/priority ordering.
     * If no comparator: emplace mode appends to back, otherwise inserts at front.
     * @param skipIdx - Index of an entry that will be removed before inserting, or -1
     * @returns The insert index in the queue as it will be after skipIdx is removed
     */
    private _findInsertIndex;
    private _markEnqueued;
    private _recordArrival;
    private _forget;
}
