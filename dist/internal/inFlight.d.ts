import { Item, ItemID } from '../types.js';
import { Clock } from './clock.js';
/**
 * Items currently being processed, with the bookkeeping that must stay in step with them:
 * when processing started (for the processing timeout) and the current worker run's token.
 * A worker result is only applied if its run is still current; runs released by a timeout,
 * clear() or doneProcessing() are stale.
 */
export declare class InFlight<T extends Item> {
    private readonly processingTimeout;
    private readonly clock;
    private readonly _items;
    private readonly _startedAt;
    private readonly _runs;
    /**
     * @param processingTimeout - Timeout in ms (0 = disabled)
     */
    constructor(processingTimeout: number, clock: Clock);
    get size(): number;
    has: (id: ItemID) => boolean;
    get: (id: ItemID) => T | undefined;
    /** The in-process items, in the order they started */
    items: () => T[];
    /** The in-process ids, in the order they started */
    ids: () => ItemID[];
    /** Marks an item in-process */
    start: (item: T) => void;
    /**
     * Starts tracking a worker run for an in-process item, replacing any earlier run
     * @returns The run's token, for isCurrentRun
     */
    beginRun: (id: ItemID) => symbol;
    /** Whether run is still the one being tracked for id */
    isCurrentRun: (id: ItemID, run: symbol) => boolean;
    /** Forgets an item and its bookkeeping */
    finish: (id: ItemID) => void;
    /** Forgets every item */
    clear: () => void;
    /** Whether an item has been in process for longer than the processing timeout */
    hasTimedOut: (id: ItemID) => boolean;
    /** The ids in process for longer than the processing timeout */
    timedOut: () => ItemID[];
    /** Sizes of the per-item bookkeeping, for leak checks */
    bookkeepingSizes: () => {
        inProcess: number;
        processingStartedAt: number;
        activeRuns: number;
    };
}
