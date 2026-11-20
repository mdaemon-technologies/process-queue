import { Clock } from './clock'
import { OrderedQueue } from './orderedQueue'

type T = { id: string; p?: number }

const manualClock = () => {
  let time = 0
  const clock: Clock = { now: () => time, setTimeout: vi.fn(), clearTimeout: vi.fn() }
  return { clock, advance: (ms: number) => { time += ms } }
}

const create = (config: { emplace?: boolean; comparator?: (a: T, b: T) => number; ttl?: number } = {}) => {
  const { clock, advance } = manualClock()
  const queue = new OrderedQueue<T>({ emplace: false, ttl: 0, ...config, clock })
  const add = (item: T) => queue.put(item)
  return { queue, add, advance }
}

const ids = (queue: OrderedQueue<T>) => queue.toArray().map(i => i.id)

describe('OrderedQueue', () => {
  describe('placement', () => {
    test('default mode inserts at the front', () => {
      const { queue, add } = create()
      add({ id: 'a' }); add({ id: 'b' })
      expect(ids(queue)).toEqual(['b', 'a'])
    })

    test('emplace mode appends, and replaces an existing id in place', () => {
      const { queue, add } = create({ emplace: true })
      add({ id: 'a' }); add({ id: 'b' }); add({ id: 'a', p: 9 })
      expect(queue.toArray()).toEqual([{ id: 'a', p: 9 }, { id: 'b' }])
    })

    test('a comparator decides the position', () => {
      const { queue, add } = create({ comparator: (a, b) => b.p! - a.p! })
      add({ id: 'low', p: 1 }); add({ id: 'high', p: 5 }); add({ id: 'mid', p: 3 })
      expect(ids(queue)).toEqual(['high', 'mid', 'low'])
    })

    test('a default-mode update moves the item to the front', () => {
      const { queue, add } = create()
      add({ id: 'a' }); add({ id: 'b' }); add({ id: 'a', p: 1 })
      expect(queue.toArray()).toEqual([{ id: 'a', p: 1 }, { id: 'b' }])
      expect(queue.length).toBe(2)
    })

    test('a throwing comparator leaves the queue unchanged', () => {
      let fail = false
      const { queue, add } = create({ comparator: (a, b) => { if (fail) throw new Error('cmp'); return a.p! - b.p! } })
      add({ id: 'a', p: 1 }); add({ id: 'b', p: 2 })
      fail = true
      expect(() => queue.put({ id: 'c', p: 3 }, queue.oldest())).toThrow('cmp')
      expect(() => add({ id: 'b', p: 0 })).toThrow('cmp')
      expect(queue.toArray()).toEqual([{ id: 'a', p: 1 }, { id: 'b', p: 2 }])
      expect(queue.bookkeepingSizes().arrivals).toBe(2)
    })
  })

  describe('eviction', () => {
    test('oldest finds the earliest arrival whatever the mode', () => {
      const { queue, add } = create({ emplace: true })
      add({ id: 'old' }); add({ id: 'new' })
      expect(queue.oldest()).toBe('old')
      const other = create()
      other.add({ id: 'old' }); other.add({ id: 'new' })
      // At the back in default mode
      expect(ids(other.queue)).toEqual(['new', 'old'])
      expect(other.queue.oldest()).toBe('old')
    })

    test('an emplace replacement keeps its arrival', () => {
      const { queue, add } = create({ emplace: true })
      add({ id: 'a' }); add({ id: 'b' }); add({ id: 'a', p: 1 })
      expect(queue.oldest()).toBe('a')
    })

    test('put with an eviction id returns the evicted item and forgets it', () => {
      const { queue, add } = create({ ttl: 100 })
      add({ id: 'a' }); add({ id: 'b' })
      const evicted = queue.put({ id: 'c' }, queue.oldest())
      expect(evicted).toEqual({ id: 'a' })
      expect(ids(queue)).toEqual(['c', 'b'])
      expect(queue.bookkeepingSizes()).toEqual({ enqueuedAt: 2, arrivals: 2 })
    })
  })

  describe('removal', () => {
    test('take removes from the front and forgets bookkeeping', () => {
      const { queue, add } = create({ emplace: true, ttl: 100 })
      add({ id: 'a' }); add({ id: 'b' }); add({ id: 'c' })
      expect(queue.take(2)).toEqual([{ id: 'a' }, { id: 'b' }])
      expect(ids(queue)).toEqual(['c'])
      expect(queue.bookkeepingSizes()).toEqual({ enqueuedAt: 1, arrivals: 1 })
    })

    test('remove returns the item, or undefined if the id is not queued', () => {
      const { queue, add } = create()
      add({ id: 'a' })
      expect(queue.remove('missing')).toBeUndefined()
      expect(queue.remove('a')).toEqual({ id: 'a' })
      expect(queue.length).toBe(0)
      expect(queue.bookkeepingSizes()).toEqual({ enqueuedAt: 0, arrivals: 0 })
    })

    test('expire removes and returns items older than the TTL', () => {
      const { queue, add, advance } = create({ emplace: true, ttl: 100 })
      add({ id: 'old' })
      advance(60)
      add({ id: 'new' })
      advance(60)
      expect(queue.expire()).toEqual([{ id: 'old' }])
      expect(ids(queue)).toEqual(['new'])
      expect(queue.bookkeepingSizes()).toEqual({ enqueuedAt: 1, arrivals: 1 })
    })

    test('enqueuedAt reports when a queued item was put, only with a TTL', () => {
      const { queue, add, advance } = create({ ttl: 100 })
      advance(40)
      add({ id: 'a' })
      queue.insertRetry({ id: 'r' })
      expect(queue.enqueuedAt('a')).toBe(40)
      // Retried items are exempt from the TTL
      expect(queue.enqueuedAt('r')).toBeUndefined()

      const { queue: noTtl, add: addNoTtl } = create()
      addNoTtl({ id: 'a' })
      expect(noTtl.enqueuedAt('a')).toBeUndefined()
    })

    test('expire returns items in queue order, whatever order they were put in', () => {
      const { queue, add, advance } = create({ comparator: (a, b) => a.p! - b.p!, ttl: 100 })
      // Not at the front: a gap starting at 0 could be halved about a thousand times
      add({ id: 'zero', p: -1 }); add({ id: 'first', p: 0 }); add({ id: 'last', p: 1 })
      // Each goes just after 'first', halving the same gap again, past a double's precision
      for (let i = 1; i <= 100; i++) add({ id: `x${i}`, p: 2 ** -i })
      advance(150)
      const inOrder = ['zero', 'first', ...Array.from({ length: 100 }, (_, i) => `x${100 - i}`), 'last']
      expect(ids(queue)).toEqual(inOrder)
      expect(queue.expire().map(item => item.id)).toEqual(inOrder)
    })

    test('expire returns items in queue order in emplace mode, where an update renews the time in place', () => {
      const { queue, add, advance } = create({ emplace: true, ttl: 100 })
      add({ id: 'a' }); add({ id: 'b' })
      advance(50)
      add({ id: 'a', p: 1 })
      advance(70)
      expect(queue.expire()).toEqual([{ id: 'b' }])
      advance(50)
      add({ id: 'c' })
      advance(60)
      expect(queue.expire()).toEqual([{ id: 'a', p: 1 }])
    })

    test('expire does nothing without a TTL', () => {
      const { queue, add, advance } = create()
      add({ id: 'a' })
      advance(1e9)
      expect(queue.expire()).toEqual([])
    })

    test('clear forgets everything', () => {
      const { queue, add } = create({ ttl: 100 })
      add({ id: 'a' })
      queue.clear()
      expect(queue.length).toBe(0)
      expect(queue.bookkeepingSizes()).toEqual({ enqueuedAt: 0, arrivals: 0 })
    })
  })

  describe('retries', () => {
    test('insertRetry puts the item at the front, exempt from the TTL', () => {
      const { queue, add, advance } = create({ emplace: true, ttl: 100 })
      add({ id: 'a' })
      queue.insertRetry({ id: 'r' })
      expect(ids(queue)).toEqual(['r', 'a'])
      advance(1000)
      expect(queue.expire()).toEqual([{ id: 'a' }])
    })

    // ProcessQueue never retries a queued id; insertRetry keeps the id unique all the same
    test.each([
      ['default mode', {}, ['r', 'b']],
      ['emplace mode', { emplace: true }, ['r', 'b']],
      ['a comparator', { comparator: (a: T, b: T) => a.p! - b.p! }, ['b', 'r']],
    ])('insertRetry replaces a queued copy of the id rather than queueing it twice (%s)', (_label, config, order) => {
      const { queue, add } = create({ ...config, ttl: 100 })
      add({ id: 'r', p: 0 }); add({ id: 'b', p: 1 })
      queue.insertRetry({ id: 'r', p: 2 })
      expect(ids(queue)).toEqual(order)
      expect([...queue].map(i => i.id)).toEqual(order)
      expect(queue.length).toBe(2)
      expect(queue.toArray().find(i => i.id === 'r')).toEqual({ id: 'r', p: 2 })
      // Retried, so exempt from the TTL
      expect(queue.enqueuedAt('r')).toBeUndefined()
      expect(queue.bookkeepingSizes()).toEqual({ enqueuedAt: 1, arrivals: 2 })
      expect(queue.oldest()).toBe('b')
    })

    test('insertRetry follows the comparator and throws before changing anything', () => {
      let fail = false
      const { queue, add } = create({ comparator: (a, b) => { if (fail) throw new Error('cmp'); return b.p! - a.p! } })
      add({ id: 'high', p: 5 }); add({ id: 'low', p: 1 })
      queue.insertRetry({ id: 'mid', p: 3 })
      expect(ids(queue)).toEqual(['high', 'mid', 'low'])
      fail = true
      expect(() => queue.insertRetry({ id: 'x', p: 0 })).toThrow('cmp')
      expect(queue.length).toBe(3)
    })
  })

  describe('restore', () => {
    test.each([
      ['default mode', {}, 'b'],
      ['emplace mode', { emplace: true }, 'a'],
    ])('keeps order and assigns arrivals to match the mode (%s)', (_label, config, oldest) => {
      const { queue } = create(config)
      queue.restore([{ id: 'a' }, { id: 'b' }])
      expect(ids(queue)).toEqual(['a', 'b'])
      expect(queue.oldest()).toBe(oldest)
    })

    test('with a comparator, restored items are put in priority order', () => {
      const { queue } = create({ comparator: (a, b) => b.p! - a.p! })
      queue.restore([{ id: 'low', p: 1 }, { id: 'high', p: 5 }, { id: 'mid', p: 3 }])
      expect(ids(queue)).toEqual(['high', 'mid', 'low'])
    })

    test('restored items are subject to the TTL', () => {
      const { queue, advance } = create({ ttl: 100 })
      queue.restore([{ id: 'a' }])
      advance(150)
      expect(queue.expire()).toEqual([{ id: 'a' }])
    })

    test('restored items keep a given enqueue time, and the others are enqueued now', () => {
      const { queue, advance } = create({ ttl: 100 })
      advance(1000)
      queue.restore([{ id: 'old' }, { id: 'new' }], new Map([['old', 950]]))
      expect(queue.enqueuedAt('old')).toBe(950)
      expect(queue.enqueuedAt('new')).toBe(1000)
      advance(60)
      expect(queue.expire()).toEqual([{ id: 'old' }])
    })

    test('restored items can be exempt from the TTL, as retried items are', () => {
      const { queue, advance } = create({ ttl: 100 })
      queue.restore([{ id: 'retried' }, { id: 'new' }], new Map(), new Set(['retried']))
      expect(queue.enqueuedAt('retried')).toBeUndefined()
      advance(150)
      expect(queue.expire()).toEqual([{ id: 'new' }])
    })
  })

  // An iterator standing on a removed entry holds it, and through its `next` every entry removed after it.
  // So a removed entry keeps only that link: no item, and no link back into the queue's other structures.
  describe('a removed entry holds no items', () => {
    const entry = (queue: OrderedQueue<T>, id: string) => (queue as any)._entries.get(id)
    const expectRetired = (removed: any) => {
      expect(removed.removed).toBe(true)
      expect(removed.item).toBeUndefined()
      expect(removed.prev).toBeNull()
      expect(removed.older).toBeNull()
      expect(removed.newer).toBeNull()
    }

    test.each([
      ['take', (queue: OrderedQueue<T>) => queue.take(1)],
      ['remove', (queue: OrderedQueue<T>) => queue.remove('a')],
      ['eviction', (queue: OrderedQueue<T>) => queue.put({ id: 'c' }, 'a')],
      ['update', (queue: OrderedQueue<T>) => queue.put({ id: 'a', p: 1 })],
      ['retry of a queued id', (queue: OrderedQueue<T>) => queue.insertRetry({ id: 'a', p: 1 })],
    ])('after %s', (_label, removeA) => {
      const { queue, add } = create({ emplace: false, ttl: 100 })
      add({ id: 'b' }); add({ id: 'a' })
      const a = entry(queue, 'a')
      removeA(queue)
      expectRetired(a)
      expect(a.next).toBe(entry(queue, 'b'))
    })

    test('after expiry', () => {
      const { queue, add, advance } = create({ ttl: 100 })
      add({ id: 'a' })
      const a = entry(queue, 'a')
      advance(150)
      expect(queue.expire()).toEqual([{ id: 'a' }])
      expectRetired(a)
    })

    test('after clear, which also cuts the links onward', () => {
      const { queue, add } = create()
      add({ id: 'b' }); add({ id: 'a' })
      const [a, b] = [entry(queue, 'a'), entry(queue, 'b')]
      queue.clear()
      for (const cleared of [a, b]) {
        expectRetired(cleared)
        expect(cleared.next).toBeNull()
      }
    })
  })

  test('peek, has, and iteration over the live queue', () => {
    const { queue, add } = create({ emplace: true })
    expect(queue.peek()).toBeUndefined()
    add({ id: 'a' }); add({ id: 'b' })
    expect(queue.peek()).toEqual({ id: 'a' })
    expect(queue.has('b')).toBe(true)
    expect(queue.has('z')).toBe(false)
    expect([...queue].map(i => i.id)).toEqual(['a', 'b'])
  })
})
