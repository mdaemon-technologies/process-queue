/**
 * Permanently failed items, capped so it cannot grow without bound
 */
export class DeadLetterQueue<T> {
  private readonly _items: T[] = [];

  /**
   * @param maxSize - Maximum items kept; the oldest are dropped first
   */
  constructor(private readonly maxSize: number) {}

  /**
   * Appends items, then drops the oldest beyond maxSize.
   * Trims once per call, so adding a large batch stays linear.
   */
  add = (items: readonly T[]): void => {
    items.forEach(item => this._items.push(item));
    const excess = this._items.length - this.maxSize;
    if (excess > 0) {
      this._items.splice(0, excess);
    }
  };

  /** A copy of the items, oldest first */
  toArray = (): T[] => [...this._items];

  /** Removes every item */
  clear = (): void => {
    this._items.length = 0;
  };
}
