import { Item, ItemID } from '../types.js';
import { Clock, MAX_TIMER_DELAY, TimerHandle } from './clock.js';

/**
 * Converts a retryDelay result to a usable timer delay in ms. NaN or a negative value
 * means no delay; values beyond what setTimeout honors are clamped to the maximum.
 * @throws {TypeError} If the value cannot be converted to a number (e.g. a Symbol)
 */
export const normalizeDelay = (raw: unknown): number => {
  const delay = Number(raw);
  return delay > 0 ? Math.min(delay, MAX_TIMER_DELAY) : 0;
};

/**
 * Retry state per item: how many attempts have failed, and the items waiting out
 * a retry delay. A pending item's id stays reserved until its retry fires or is cancelled.
 * Never emits and never calls user code; the queue decides what to report.
 */
export class RetryTracker<T extends Item> {
  private readonly _attempts = new Map<ItemID, number>();
  private readonly _pending = new Map<ItemID, { item: T; timer: TimerHandle }>();

  constructor(private readonly clock: Clock) {}

  /** Failed attempts recorded for an id (0 if none) */
  attempts = (id: ItemID): number => this._attempts.get(id) ?? 0;

  setAttempts = (id: ItemID, attempts: number): void => {
    this._attempts.set(id, attempts);
  };

  /** Forgets an id's attempt count */
  forget = (id: ItemID): void => {
    this._attempts.delete(id);
  };

  /**
   * Holds an item until its retry delay passes
   * @param onFire - Called after the item stops being pending
   */
  schedule = (item: T, id: ItemID, delay: number, onFire: () => void): void => {
    const timer = this.clock.setTimeout(() => {
      this._pending.delete(id);
      onFire();
    }, delay);
    this._pending.set(id, { item, timer });
  };

  isPending = (id: ItemID): boolean => this._pending.has(id);

  get pendingCount(): number {
    return this._pending.size;
  }

  /** The items awaiting a retry, in the order they were scheduled */
  pendingItems = (): T[] => Array.from(this._pending.values(), ({ item }) => item);

  /**
   * Cancels a pending retry and forgets the id's attempt count
   * @returns The item, or undefined if no retry is pending for the id
   */
  cancel = (id: ItemID): T | undefined => {
    const pending = this._pending.get(id);
    if (!pending) return undefined;
    this.clock.clearTimeout(pending.timer);
    this._pending.delete(id);
    this._attempts.delete(id);
    return pending.item;
  };

  /** Cancels every pending retry and forgets every attempt count */
  clear = (): void => {
    this._pending.forEach(({ timer }) => this.clock.clearTimeout(timer));
    this._pending.clear();
    this._attempts.clear();
  };

  /** Sizes of the per-item bookkeeping, for leak checks */
  bookkeepingSizes = (): { retryCount: number; pendingRetries: number } => ({
    retryCount: this._attempts.size,
    pendingRetries: this._pending.size,
  });
}
