import { Item, ItemID } from '../types.js';
import { Clock } from './clock.js';

/**
 * Items currently being processed, with the bookkeeping that must stay in step with them:
 * when processing started (for the processing timeout) and the current worker run's token.
 * A worker result is only applied if its run is still current; runs released by a timeout,
 * clear() or doneProcessing() are stale.
 */
export class InFlight<T extends Item> {
  private readonly _items = new Map<ItemID, T>();
  private readonly _startedAt = new Map<ItemID, number>();
  private readonly _runs = new Map<ItemID, symbol>();

  /**
   * @param processingTimeout - Timeout in ms (0 = disabled)
   */
  constructor(private readonly processingTimeout: number, private readonly clock: Clock) {}

  get size(): number {
    return this._items.size;
  }

  has = (id: ItemID): boolean => this._items.has(id);

  get = (id: ItemID): T | undefined => this._items.get(id);

  /** The in-process items, in the order they started */
  items = (): T[] => Array.from(this._items.values());

  /** The in-process ids, in the order they started */
  ids = (): ItemID[] => Array.from(this._items.keys());

  /** Marks an item in-process */
  start = (item: T): void => {
    this._items.set(item.id, item);
    if (this.processingTimeout > 0) this._startedAt.set(item.id, this.clock.now());
  };

  /**
   * Starts tracking a worker run for an in-process item, replacing any earlier run
   * @returns The run's token, for isCurrentRun
   */
  beginRun = (id: ItemID): symbol => {
    const run = Symbol();
    this._runs.set(id, run);
    return run;
  };

  /** Whether run is still the one being tracked for id */
  isCurrentRun = (id: ItemID, run: symbol): boolean => this._runs.get(id) === run;

  /** Forgets an item and its bookkeeping */
  finish = (id: ItemID): void => {
    this._items.delete(id);
    this._startedAt.delete(id);
    this._runs.delete(id);
  };

  /** Forgets every item */
  clear = (): void => {
    this._items.clear();
    this._startedAt.clear();
    this._runs.clear();
  };

  /** Whether an item has been in process for longer than the processing timeout */
  hasTimedOut = (id: ItemID): boolean => {
    const startedAt = this._startedAt.get(id);
    return startedAt !== undefined && this.clock.now() - startedAt > this.processingTimeout;
  };

  /** The ids in process for longer than the processing timeout */
  timedOut = (): ItemID[] => Array.from(this._startedAt.keys()).filter(this.hasTimedOut);

  /** Sizes of the per-item bookkeeping, for leak checks */
  bookkeepingSizes = (): { inProcess: number; processingStartedAt: number; activeRuns: number } => ({
    inProcess: this._items.size,
    processingStartedAt: this._startedAt.size,
    activeRuns: this._runs.size,
  });
}
