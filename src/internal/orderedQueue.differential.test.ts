// Differential property test: drives OrderedQueue and the 3.1.0 array implementation it replaced
// (orderedQueue.reference.ts) with the same random operations, and checks after every step that
// they agree on everything ProcessQueue can observe.
import fc from 'fast-check'
import { Clock } from './clock'
import { OrderedQueue } from './orderedQueue'
import { ReferenceOrderedQueue } from './orderedQueue.reference'

type T = { id: number; p: number; v: number }

type Config = {
  emplace: boolean
  comparator?: (a: T, b: T) => number
  ttl: number
  maxSize: number
  overflow: 'drop-oldest' | 'drop-newest'
}

/** The operations ProcessQueue performs on its OrderedQueue, in terms of ids */
interface Driven {
  /** Puts as ProcessQueue.queueItem does once it has decided to: evicting the oldest item if evict is set */
  put(item: T, evict: boolean): T | undefined
  insertRetry(item: T): void
  take(count: number): T[]
  remove(id: number): T | undefined
  expire(): T[]
  restore(items: T[], enqueuedAt: Map<number, number>, exempt: Set<number>): void
  clear(): void
  toArray(): T[]
  iterate(): T[]
  peek(): T | undefined
  has(id: number): boolean
  length: number
  oldest(): number | undefined
  enqueuedAt(id: number): number | undefined
  bookkeepingSizes(): { enqueuedAt: number; arrivals: number }
}

const reference = (config: Config, clock: Clock): Driven => {
  const q = new ReferenceOrderedQueue<T>({ ...config, clock })
  return {
    put: (item, evict) => q.put(item, q.indexOf(item.id), evict ? q.findOldestIndex() : -1),
    insertRetry: item => q.insertRetry(item),
    take: count => q.take(count),
    remove: id => q.remove(id),
    expire: () => q.expire(),
    restore: (items, enqueuedAt, exempt) => q.restore(items, enqueuedAt, exempt),
    clear: () => q.clear(),
    toArray: () => q.toArray(),
    iterate: () => [...q],
    peek: () => q.peek(),
    has: id => q.has(id),
    get length() { return q.length },
    oldest: () => q.toArray()[q.findOldestIndex()]?.id,
    enqueuedAt: id => q.enqueuedAt(id),
    bookkeepingSizes: () => q.bookkeepingSizes(),
  }
}

const subject = (config: Config, clock: Clock): Driven => {
  const q = new OrderedQueue<T>({ ...config, clock })
  return {
    put: (item, evict) => q.put(item, evict ? q.oldest() : undefined),
    insertRetry: item => q.insertRetry(item),
    take: count => q.take(count),
    remove: id => q.remove(id),
    expire: () => q.expire(),
    restore: (items, enqueuedAt, exempt) => q.restore(items, enqueuedAt, exempt),
    clear: () => q.clear(),
    toArray: () => q.toArray(),
    iterate: () => [...q],
    peek: () => q.peek(),
    has: id => q.has(id),
    get length() { return q.length },
    oldest: () => q.oldest() as number | undefined,
    enqueuedAt: id => q.enqueuedAt(id),
    bookkeepingSizes: () => q.bookkeepingSizes(),
  }
}

const IDS = 8
const id = fc.integer({ min: 0, max: IDS - 1 })
// A small priority range, so comparator ties are common
const priority = fc.integer({ min: 0, max: 3 })

type Op =
  | { op: 'put'; id: number; p: number }
  | { op: 'retry'; id: number; p: number }
  | { op: 'take'; count: number }
  | { op: 'remove'; id: number }
  | { op: 'advance'; ms: number }
  | { op: 'expire' }
  | { op: 'restore'; items: { id: number; p: number }[]; times: (number | null)[]; exempt: boolean[] }
  | { op: 'clear' }

const ops: fc.Arbitrary<Op> = fc.oneof(
  { arbitrary: fc.record({ op: fc.constant('put' as const), id, p: priority }), weight: 8 },
  { arbitrary: fc.record({ op: fc.constant('retry' as const), id, p: priority }), weight: 2 },
  // take() receives whatever processBatch() was given, which splice() coerced
  { arbitrary: fc.record({ op: fc.constant('take' as const), count: fc.constantFrom(-1, 0, 1, 1, 2, 3, 2.5, NaN, Infinity) }), weight: 3 },
  { arbitrary: fc.record({ op: fc.constant('remove' as const), id }), weight: 2 },
  // The clock may go backwards
  { arbitrary: fc.record({ op: fc.constant('advance' as const), ms: fc.integer({ min: -60, max: 150 }) }), weight: 3 },
  { arbitrary: fc.record({ op: fc.constant('expire' as const) }), weight: 3 },
  {
    arbitrary: fc.record({
      op: fc.constant('restore' as const),
      items: fc.uniqueArray(fc.record({ id, p: priority }), { selector: item => item.id, maxLength: IDS }),
      times: fc.array(fc.option(fc.integer({ min: -300, max: 300 })), { minLength: IDS, maxLength: IDS }),
      exempt: fc.array(fc.boolean(), { minLength: IDS, maxLength: IDS }),
    }),
    weight: 1,
  },
  { arbitrary: fc.record({ op: fc.constant('clear' as const) }), weight: 1 },
)

const comparators = {
  none: undefined,
  ascending: (a: T, b: T) => a.p - b.p,
  descending: (a: T, b: T) => b.p - a.p,
}

const configs: fc.Arbitrary<Config> = fc.record({
  emplace: fc.boolean(),
  comparator: fc.constantFrom(...Object.values(comparators)),
  ttl: fc.constantFrom(0, 100),
  maxSize: fc.constantFrom(1, 2, 4, Infinity),
  overflow: fc.constantFrom('drop-oldest' as const, 'drop-newest' as const),
})

/** Everything ProcessQueue can observe of a queue */
const observe = (q: Driven) => ({
  items: q.toArray(),
  iterated: q.iterate(),
  peek: q.peek(),
  length: q.length,
  has: Array.from({ length: IDS }, (_, i) => q.has(i)),
  oldest: q.oldest(),
  enqueuedAt: q.toArray().map(item => q.enqueuedAt(item.id)),
  sizes: q.bookkeepingSizes(),
})

/** Applies one operation as ProcessQueue would, and returns what it returned */
const apply = (q: Driven, config: Config, op: Op, version: number): unknown => {
  switch (op.op) {
    case 'put': {
      const item = { id: op.id, p: op.p, v: version }
      const full = !q.has(op.id) && q.length >= config.maxSize
      if (full && (config.overflow === 'drop-newest' || q.length === 0)) return 'dropped'
      return q.put(item, full)
    }
    // A retried item is never queued already: its id was in flight until now
    case 'retry':
      if (q.has(op.id)) return 'skipped'
      return q.insertRetry({ id: op.id, p: op.p, v: version })
    case 'take': return q.take(op.count)
    case 'remove': return q.remove(op.id)
    case 'expire': return q.expire()
    // As deserialize does, into a new (empty) queue
    case 'restore': {
      if (q.length > 0) return 'skipped'
      const enqueuedAt = new Map<number, number>()
      const exempt = new Set<number>()
      op.items.forEach(({ id }, i) => {
        if (op.times[i] !== null) enqueuedAt.set(id, op.times[i])
        if (op.exempt[i]) exempt.add(id)
      })
      return q.restore(op.items.map(item => ({ ...item, v: version })), enqueuedAt, exempt)
    }
    case 'clear': return q.clear()
    case 'advance': return undefined
  }
}

const manualClock = () => {
  let time = 0
  const clock: Clock = { now: () => time, setTimeout: vi.fn(), clearTimeout: vi.fn() }
  return { clock, advance: (ms: number) => { time += ms } }
}

describe('OrderedQueue matches the 3.1.0 implementation', () => {
  test('for any sequence of operations, in every mode', () => {
    fc.assert(
      fc.property(configs, fc.array(ops, { maxLength: 80 }), (config, sequence) => {
        const { clock, advance } = manualClock()
        const expected = reference(config, clock)
        const actual = subject(config, clock)
        expect(observe(actual)).toEqual(observe(expected))

        sequence.forEach((op, version) => {
          if (op.op === 'advance') advance(op.ms)
          const want = apply(expected, config, op, version)
          const got = apply(actual, config, op, version)
          expect({ step: version, op, result: got, ...observe(actual) })
            .toEqual({ step: version, op, result: want, ...observe(expected) })
        })
      }),
      { numRuns: 1000 }
    )
  }, 60000)
})
