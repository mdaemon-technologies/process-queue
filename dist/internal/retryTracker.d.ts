import { Item, ItemID } from '../types.js';
import { Clock } from './clock.js';
/**
 * Converts a retryDelay result to a usable timer delay in ms. NaN or a negative value
 * means no delay; values beyond what setTimeout honors are clamped to the maximum.
 * @throws {TypeError} If the value cannot be converted to a number (e.g. a Symbol)
 */
export declare const normalizeDelay: (raw: unknown) => number;
/**
 * Retry state per item: how many attempts have failed, and the items waiting out
 * a retry delay. A pending item's id stays reserved until its retry fires or is cancelled.
 * Never emits and never calls user code; the queue decides what to report.
 */
export declare class RetryTracker<T extends Item> {
    private readonly clock;
    private readonly _attempts;
    private readonly _pending;
    constructor(clock: Clock);
    /** Failed attempts recorded for an id (0 if none) */
    attempts: (id: ItemID) => number;
    setAttempts: (id: ItemID, attempts: number) => void;
    /** Forgets an id's attempt count */
    forget: (id: ItemID) => void;
    /**
     * Holds an item until its retry delay passes
     * @param onFire - Called after the item stops being pending
     */
    schedule: (item: T, id: ItemID, delay: number, onFire: () => void) => void;
    isPending: (id: ItemID) => boolean;
    get pendingCount(): number;
    /** The items awaiting a retry, in the order they were scheduled */
    pendingItems: () => T[];
    /**
     * Cancels a pending retry and forgets the id's attempt count
     * @returns The item, or undefined if no retry is pending for the id
     */
    cancel: (id: ItemID) => T | undefined;
    /** Cancels every pending retry and forgets every attempt count */
    clear: () => void;
    /** Sizes of the per-item bookkeeping, for leak checks */
    bookkeepingSizes: () => {
        retryCount: number;
        pendingRetries: number;
    };
}
