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

/** A queued item and its bookkeeping */
interface Entry<T> {
  /** The item's id when it was queued; the entry is found by it */
  readonly id: ItemID;
  item: T;
  /** Neighbors in processing order */
  prev: Entry<T> | null;
  next: Entry<T> | null;
  /** Increases along the processing order, so entries can be sorted into it */
  rank: number;
  /** Neighbors in arrival order, for drop-oldest */
  older: Entry<T> | null;
  newer: Entry<T> | null;
  /** Whether the entry is in the arrival order */
  arrived: boolean;
  /** When the item was put, for the TTL; undefined without a TTL, and for retried items */
  enqueuedAt: number | undefined;
  /** The entry's index in the enqueue-time heap, or -1 if it is not in it */
  heapIndex: number;
  /**
   * Set when the entry leaves the queue. A removed entry keeps only its `next`, so an iterator
   * standing on it can carry on; it drops its item and its other links, so such an iterator holds
   * no items, only the small chain of entries removed after its own. An entry is never linked in
   * again: a moved item gets a new one.
   */
  removed: boolean;
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
export class OrderedQueue<T extends Item> {
  /** The queue, by id */
  private readonly _entries = new Map<ItemID, Entry<T>>();
  /** The queue in processing order */
  private _head: Entry<T> | null = null;
  private _tail: Entry<T> | null = null;
  /**
   * The queue in arrival order, oldest first. A linked list rather than an insertion-ordered Map:
   * V8 finds a Map's first key by skipping the entries deleted before it, which would make drop-oldest O(n).
   */
  private _oldest: Entry<T> | null = null;
  private _newest: Entry<T> | null = null;
  private _arrivals = 0;
  /**
   * A binary min-heap of the entries that have an enqueue time, earliest first. Enqueue times are
   * not in queue order or even in insertion order: an emplace update renews the time in place,
   * restore() takes the snapshot's times, and the system clock can go back.
   */
  private readonly _byEnqueuedAt: Entry<T>[] = [];
  /** Counts changes to which items are queued, so a comparator that changes the queue mid-scan is caught */
  private _changes = 0;

  constructor(private readonly config: OrderedQueueConfig<T>) {}

  get length(): number {
    return this._entries.size;
  }

  /** A copy of the items, in processing order */
  toArray = (): T[] => {
    const items: T[] = [];
    for (let entry = this._head; entry; entry = entry.next) items.push(entry.item);
    return items;
  };

  /** The next item to process, without removing it */
  peek = (): T | undefined => this._head?.item;

  has = (id: ItemID): boolean => this._entries.has(id);

  /** When a queued item was put, for the TTL; undefined without a TTL, and for retried items */
  enqueuedAt = (id: ItemID): number | undefined => this._entries.get(id)?.enqueuedAt;

  /**
   * Iterates the live queue. Items removed before the iterator reaches them are skipped, and no item
   * is visited twice unless it is re-queued. While the last item visited stays queued, items inserted
   * after it are visited; once it is removed, iteration carries on from the item that followed it then.
   */
  [Symbol.iterator](): Iterator<T> {
    // The entry last visited, or null before the first
    let last: Entry<T> | null = null;
    const head = (): Entry<T> | null => this._head;
    return {
      next(): IteratorResult<T> {
        let entry = last ? last.next : head();
        while (entry?.removed) entry = entry.next;
        if (!entry) return { value: undefined as unknown as T, done: true };
        last = entry;
        return { value: entry.item, done: false };
      }
    };
  }

  /**
   * Finds the earliest-arrived item, whatever its position
   * @returns Its id, or undefined if the queue is empty
   */
  oldest = (): ItemID | undefined => this._oldest?.id;

  /**
   * Adds an item, or updates the queued item with the same id
   * @param evictId - Id of a queued item to evict to make room, if any; ignored for an update
   * @returns The evicted item, if any
   * @throws Whatever the comparator throws, before anything changes
   */
  put = (item: T, evictId?: ItemID): T | undefined => {
    const existing = this._entries.get(item.id);
    if (this.config.emplace && existing) {
      // An in-place replacement keeps its position and its original arrival
      existing.item = item;
      this._markEnqueued(existing);
      return undefined;
    }

    // At most one entry is vacated: the item's old copy (an update) or the evicted item (an overflow).
    // Find the insert position first, so a throwing comparator leaves the queue untouched.
    const vacated = existing ?? (evictId === undefined ? undefined : this._entries.get(evictId));
    const before = this._findInsertPosition(item, vacated);
    const vacatedItem = vacated && this._unlink(vacated);
    const entry = this._link(item, before);
    this._recordArrival(entry);
    this._markEnqueued(entry);
    return existing ? undefined : vacatedItem;
  };

  /**
   * Puts a retried item back: in comparator order when there is a comparator,
   * otherwise at the front. Retried items are exempt from the TTL.
   * ProcessQueue never retries an id that is queued: the id stays reserved, in process or awaiting
   * its retry, until the retry enters the queue. Should a queued copy exist all the same, it is
   * replaced, so an id is never queued twice.
   * @throws Whatever the comparator throws, before anything changes
   */
  insertRetry = (item: T): void => {
    const existing = this._entries.get(item.id);
    const before = this.config.comparator ? this._findInsertPosition(item, existing) : this._front(existing);
    if (existing) this._unlink(existing);
    this._recordArrival(this._link(item, before));
  };

  /**
   * Removes items from the front
   * @param count - Maximum number of items to take, coerced as Array.prototype.splice coerces it.
   *                Unlike splice, the length is read after converting it, which may run user code (valueOf).
   * @returns The items taken, in queue order
   * @throws {TypeError} If count cannot be converted to a number (a Symbol or a BigInt)
   */
  take = (count: number): T[] => {
    const wanted = Math.trunc(+count);
    const taking = Number.isNaN(wanted) ? 0 : Math.min(Math.max(wanted, 0), this.length);
    const taken: T[] = [];
    for (let i = 0; i < taking; i++) taken.push(this._unlink(this._head!));
    return taken;
  };

  /**
   * Removes an item by id
   * @returns The removed item, or undefined if the id is not queued
   */
  remove = (id: ItemID): T | undefined => {
    const entry = this._entries.get(id);
    return entry && this._unlink(entry);
  };

  /**
   * Removes every item older than the TTL
   * @returns The expired items, in queue order
   */
  expire = (): T[] => {
    const { ttl, clock } = this.config;
    if (ttl <= 0) return [];

    const now = clock.now();
    const expired: { rank: number; item: T }[] = [];
    // The earliest enqueue time is the oldest item: once it is within the TTL, so is every other
    for (let oldest = this._byEnqueuedAt[0]; oldest && now - oldest.enqueuedAt! > ttl; oldest = this._byEnqueuedAt[0]) {
      expired.push({ rank: oldest.rank, item: this._unlink(oldest) });
    }
    // Nothing is linked in meanwhile, so no renumbering: the ranks still give the queue order
    if (expired.length > 1) expired.sort((a, b) => a.rank - b.rank);
    return expired.map(({ item }) => item);
  };

  /**
   * Loads items from a snapshot: in comparator order when there is a comparator, otherwise
   * in the given order. Each is subject to the TTL from its given enqueue time, or else from now,
   * unless it is exempt.
   * @param enqueuedAt - Enqueue times (clock time in ms) by id
   * @param exempt - Ids exempt from the TTL, as retried items are
   * @throws Whatever the comparator throws, before anything changes
   */
  restore = (
    items: readonly T[],
    enqueuedAt: ReadonlyMap<ItemID, number> = new Map(),
    exempt: ReadonlySet<ItemID> = new Set()
  ): void => {
    const { comparator } = this.config;
    const ordered = comparator ? [...items].sort(comparator) : items;
    ordered.forEach(item => {
      const entry = this._link(item, null);
      if (!exempt.has(item.id)) this._markEnqueued(entry, enqueuedAt.get(item.id));
    });
    // Default mode keeps the newest arrival at the front; emplace and comparator modes keep the oldest there
    const byArrival = this.config.emplace || this.config.comparator ? items : [...items].reverse();
    byArrival.forEach(item => this._recordArrival(this._entries.get(item.id)!));
  };

  /** Removes every item */
  clear = (): void => {
    // Every entry goes at once, so an iterator standing on one has nothing left to visit
    for (let entry = this._head; entry;) {
      const next: Entry<T> | null = entry.next;
      this._retire(entry);
      entry.next = null;
      entry = next;
    }
    this._changes++;
    this._entries.clear();
    this._head = null;
    this._tail = null;
    this._oldest = null;
    this._newest = null;
    this._arrivals = 0;
    this._byEnqueuedAt.length = 0;
  };

  /** Sizes of the per-item bookkeeping, for leak checks */
  bookkeepingSizes = (): { enqueuedAt: number; arrivals: number } => ({
    enqueuedAt: this._byEnqueuedAt.length,
    arrivals: this._arrivals,
  });

  /**
   * Finds where an item belongs, respecting comparator/priority ordering:
   * before the first entry the comparator puts after it. Without a comparator,
   * emplace mode appends to the back, otherwise the item goes to the front.
   * @param skip - An entry that will be removed before inserting
   * @returns The entry to insert before, or null for the back
   * @throws Whatever the comparator throws, or an Error if the comparator changes the queue,
   *         which would leave the position stale
   */
  private _findInsertPosition = (item: T, skip?: Entry<T>): Entry<T> | null => {
    const { comparator, emplace } = this.config;
    if (!comparator) return emplace ? null : this._front(skip);

    const changes = this._changes;
    for (let entry = this._head; entry; entry = entry.next) {
      if (entry === skip) continue;
      const order = comparator(item, entry.item);
      if (this._changes !== changes) throw new Error('ProcessQueue: the comparator changed the queue');
      if (order < 0) return entry;
    }
    return null;
  };

  /** The entry to insert before to put an item at the front, once `skip` has been removed */
  private _front = (skip?: Entry<T>): Entry<T> | null => this._head === skip ? skip!.next : this._head;

  /**
   * Links a new entry for an item whose id is not queued, before `before` or at the back for null.
   * The caller records its arrival and enqueue time.
   * @returns The new entry
   */
  private _link = (item: T, before: Entry<T> | null): Entry<T> => {
    const prev = before ? before.prev : this._tail;
    let rank = this._rankBetween(prev, before);
    if (!this._fitsBetween(rank, prev, before)) {
      // Halving the gap between two neighbors has run out of precision: only a comparator inserts
      // between neighbors, and it has already scanned the queue, so renumbering stays O(n)
      this._renumber();
      rank = this._rankBetween(prev, before);
    }

    const entry: Entry<T> = {
      id: item.id, item, prev, next: before, rank,
      older: null, newer: null, arrived: false, enqueuedAt: undefined, heapIndex: -1, removed: false,
    };
    if (prev) prev.next = entry;
    else this._head = entry;
    if (before) before.prev = entry;
    else this._tail = entry;
    this._entries.set(entry.id, entry);
    this._changes++;
    return entry;
  };

  /**
   * Unlinks an entry from the queue and forgets its bookkeeping
   * @returns Its item
   */
  private _unlink = (entry: Entry<T>): T => {
    if (entry.prev) entry.prev.next = entry.next;
    else this._head = entry.next;
    if (entry.next) entry.next.prev = entry.prev;
    else this._tail = entry.prev;
    this._entries.delete(entry.id);
    this._changes++;

    if (entry.arrived) {
      if (entry.older) entry.older.newer = entry.newer;
      else this._oldest = entry.newer;
      if (entry.newer) entry.newer.older = entry.older;
      else this._newest = entry.older;
      this._arrivals--;
    }

    if (entry.heapIndex >= 0) this._heapDelete(entry);
    const { item } = entry;
    this._retire(entry);
    return item;
  };

  /** Marks an unlinked entry removed and drops everything but its `next` */
  private _retire = (entry: Entry<T>): void => {
    entry.removed = true;
    // Never read again: iterators skip removed entries
    entry.item = undefined as unknown as T;
    entry.prev = null;
    entry.older = null;
    entry.newer = null;
    entry.arrived = false;
    entry.enqueuedAt = undefined;
    entry.heapIndex = -1;
  };

  private _rankBetween = (prev: Entry<T> | null, next: Entry<T> | null): number => {
    if (!prev) return next ? next.rank - 1 : 0;
    if (!next) return prev.rank + 1;
    return (prev.rank + next.rank) / 2;
  };

  private _fitsBetween = (rank: number, prev: Entry<T> | null, next: Entry<T> | null): boolean =>
    (!prev || prev.rank < rank) && (!next || rank < next.rank);

  /** Renumbers the queue 0, 1, 2, … in processing order */
  private _renumber = (): void => {
    let rank = 0;
    for (let entry = this._head; entry; entry = entry.next) entry.rank = rank++;
  };

  /** Makes a newly linked entry the newest arrival */
  private _recordArrival = (entry: Entry<T>): void => {
    entry.older = this._newest;
    if (this._newest) this._newest.newer = entry;
    else this._oldest = entry;
    this._newest = entry;
    entry.arrived = true;
    this._arrivals++;
  };

  /** Records when an entry was put, for the TTL; does nothing without a TTL */
  private _markEnqueued = (entry: Entry<T>, at: number = this.config.clock.now()): void => {
    if (this.config.ttl <= 0) return;
    const previous = entry.enqueuedAt;
    entry.enqueuedAt = at;
    if (entry.heapIndex < 0) {
      entry.heapIndex = this._byEnqueuedAt.push(entry) - 1;
      this._siftUp(entry.heapIndex);
    } else if (at < previous!) {
      this._siftUp(entry.heapIndex);
    } else {
      this._siftDown(entry.heapIndex);
    }
  };

  private _heapDelete = (entry: Entry<T>): void => {
    const heap = this._byEnqueuedAt;
    const index = entry.heapIndex;
    const last = heap.pop()!;
    entry.heapIndex = -1;
    entry.enqueuedAt = undefined;
    if (last === entry) return;
    heap[index] = last;
    last.heapIndex = index;
    this._siftUp(index);
    this._siftDown(last.heapIndex);
  };

  private _siftUp = (index: number): void => {
    const heap = this._byEnqueuedAt;
    const entry = heap[index];
    while (index > 0) {
      const parentIndex = (index - 1) >> 1;
      const parent = heap[parentIndex];
      if (parent.enqueuedAt! <= entry.enqueuedAt!) break;
      heap[index] = parent;
      parent.heapIndex = index;
      index = parentIndex;
    }
    heap[index] = entry;
    entry.heapIndex = index;
  };

  private _siftDown = (index: number): void => {
    const heap = this._byEnqueuedAt;
    const entry = heap[index];
    for (;;) {
      let childIndex = 2 * index + 1;
      if (childIndex >= heap.length) break;
      if (childIndex + 1 < heap.length && heap[childIndex + 1].enqueuedAt! < heap[childIndex].enqueuedAt!) childIndex++;
      const child = heap[childIndex];
      if (entry.enqueuedAt! <= child.enqueuedAt!) break;
      heap[index] = child;
      child.heapIndex = index;
      index = childIndex;
    }
    heap[index] = entry;
    entry.heapIndex = index;
  };
}
