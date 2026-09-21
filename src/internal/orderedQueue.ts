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
export class OrderedQueue<T extends Item> {
  private readonly _items: T[] = [];
  private readonly _enqueuedAt = new Map<ItemID, number>();
  private readonly _arrivals = new Map<ItemID, number>();
  private _nextArrival = 0;

  constructor(private readonly config: OrderedQueueConfig<T>) {}

  get length(): number {
    return this._items.length;
  }

  /** A copy of the items, in processing order */
  toArray = (): T[] => [...this._items];

  /** The next item to process, without removing it */
  peek = (): T | undefined => this._items[0];

  /**
   * Finds a queued item by id
   * @returns Its index, or -1 if it is not queued
   */
  indexOf = (id: ItemID): number => this._items.findIndex(queued => queued.id === id);

  has = (id: ItemID): boolean => this.indexOf(id) >= 0;

  /** Iterates the live queue */
  [Symbol.iterator](): Iterator<T> {
    let index = 0;
    const items = this._items;
    return {
      next(): IteratorResult<T> {
        if (index < items.length) {
          return { value: items[index++], done: false };
        }
        return { value: undefined as unknown as T, done: true };
      }
    };
  }

  /**
   * Finds the earliest-arrived item, whatever its position
   * @returns Its index, or -1 if the queue is empty
   */
  findOldestIndex = (): number => {
    let oldestIdx = -1;
    let oldestArrival = Infinity;
    this._items.forEach((queued, i) => {
      const arrival = this._arrivals.get(queued.id) ?? -1;
      if (arrival < oldestArrival) {
        oldestArrival = arrival;
        oldestIdx = i;
      }
    });
    return oldestIdx;
  };

  /**
   * Adds an item, or updates the queued item with the same id
   * @param existingIdx - indexOf(item.id)
   * @param evictIdx - Index of an item to evict to make room, or -1
   * @returns The evicted item, if any
   * @throws Whatever the comparator throws, before anything changes
   */
  put = (item: T, existingIdx: number, evictIdx: number): T | undefined => {
    let evicted: T | undefined;
    if (this.config.emplace && existingIdx >= 0) {
      // An in-place replacement keeps its original arrival
      this._items.splice(existingIdx, 1, item);
    } else {
      // At most one slot is vacated: the item's old copy (an update) or the evicted item (an overflow).
      // Find the insert position first, so a throwing comparator leaves the queue untouched.
      const vacatedIdx = existingIdx >= 0 ? existingIdx : evictIdx;
      const insertIdx = this._findInsertIndex(item, vacatedIdx);
      if (vacatedIdx >= 0) {
        const [vacated] = this._items.splice(vacatedIdx, 1);
        if (evictIdx >= 0) {
          evicted = vacated;
          this._forget(vacated.id);
        }
      }
      this._items.splice(insertIdx, 0, item);
      this._recordArrival(item.id);
    }
    this._markEnqueued(item.id);
    return evicted;
  };

  /**
   * Puts a retried item back: in comparator order when there is a comparator,
   * otherwise at the front. Retried items are exempt from the TTL.
   * @throws Whatever the comparator throws, before anything changes
   */
  insertRetry = (item: T): void => {
    const insertIdx = this.config.comparator ? this._findInsertIndex(item, -1) : 0;
    this._items.splice(insertIdx, 0, item);
    this._recordArrival(item.id);
  };

  /**
   * Removes items from the front
   * @param count - Maximum number of items to take
   * @returns The items taken, in queue order
   */
  take = (count: number): T[] => {
    const taken = this._items.splice(0, count);
    taken.forEach(item => this._forget(item.id));
    return taken;
  };

  /**
   * Removes an item by id
   * @returns The removed item, or undefined if the id is not queued
   */
  remove = (id: ItemID): T | undefined => {
    const idx = this.indexOf(id);
    if (idx < 0) return undefined;
    const [removed] = this._items.splice(idx, 1);
    this._forget(id);
    return removed;
  };

  /**
   * Removes every item older than the TTL
   * @returns The expired items
   */
  expire = (): T[] => {
    if (this.config.ttl <= 0) return [];

    const now = this.config.clock.now();
    const isExpired = (item: T): boolean => {
      const enqueuedAt = this._enqueuedAt.get(item.id);
      return enqueuedAt !== undefined && now - enqueuedAt > this.config.ttl;
    };
    const expired = this._items.filter(isExpired);
    if (expired.length === 0) return [];

    const kept = this._items.filter(item => !isExpired(item));
    this._items.length = 0;
    kept.forEach(item => this._items.push(item));
    expired.forEach(item => this._forget(item.id));
    return expired;
  };

  /**
   * Loads items from a snapshot, subject to the TTL from now: in comparator order when
   * there is a comparator, otherwise in the given order
   * @throws Whatever the comparator throws, before anything changes
   */
  restore = (items: readonly T[]): void => {
    const { comparator } = this.config;
    const ordered = comparator ? [...items].sort(comparator) : items;
    ordered.forEach(item => {
      this._items.push(item);
      this._markEnqueued(item.id);
    });
    // Default mode keeps the newest arrival at the front; emplace and comparator modes keep the oldest there
    const byArrival = this.config.emplace || this.config.comparator ? items : [...items].reverse();
    byArrival.forEach(item => this._recordArrival(item.id));
  };

  /** Removes every item */
  clear = (): void => {
    this._items.length = 0;
    this._enqueuedAt.clear();
    this._arrivals.clear();
  };

  /** Sizes of the per-item bookkeeping, for leak checks */
  bookkeepingSizes = (): { enqueuedAt: number; arrivals: number } => ({
    enqueuedAt: this._enqueuedAt.size,
    arrivals: this._arrivals.size,
  });

  /**
   * Finds where an item belongs, respecting comparator/priority ordering.
   * If no comparator: emplace mode appends to back, otherwise inserts at front.
   * @param skipIdx - Index of an entry that will be removed before inserting, or -1
   * @returns The insert index in the queue as it will be after skipIdx is removed
   */
  private _findInsertIndex = (item: T, skipIdx: number): number => {
    const { comparator, emplace } = this.config;
    const remaining = this._items.length - (skipIdx >= 0 ? 1 : 0);
    if (!comparator) {
      return emplace ? remaining : 0;
    }

    let position = 0;
    for (let i = 0; i < this._items.length; i++) {
      if (i === skipIdx) continue;
      if (comparator(item, this._items[i]) < 0) return position;
      position++;
    }
    return position;
  };

  private _markEnqueued = (id: ItemID): void => {
    if (this.config.ttl > 0) this._enqueuedAt.set(id, this.config.clock.now());
  };

  private _recordArrival = (id: ItemID): void => {
    this._arrivals.set(id, this._nextArrival++);
  };

  private _forget = (id: ItemID): void => {
    this._enqueuedAt.delete(id);
    this._arrivals.delete(id);
  };
}
