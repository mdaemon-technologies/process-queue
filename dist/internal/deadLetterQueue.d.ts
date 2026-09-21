/**
 * Permanently failed items, capped so it cannot grow without bound
 */
export declare class DeadLetterQueue<T> {
    private readonly maxSize;
    private readonly _items;
    /**
     * @param maxSize - Maximum items kept; the oldest are dropped first
     */
    constructor(maxSize: number);
    /**
     * Appends items, then drops the oldest beyond maxSize.
     * Trims once per call, so adding a large batch stays linear.
     */
    add: (items: readonly T[]) => void;
    /** A copy of the items, oldest first */
    toArray: () => T[];
    /** Removes every item */
    clear: () => void;
}
