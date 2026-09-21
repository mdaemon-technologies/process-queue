import { Clock } from './clock'
import { OrderedQueue } from './orderedQueue'

type T = { id: string; p?: number }

const manualClock = () => {
  let time = 0
  const clock: Clock = { now: () => time, setTimeout: jest.fn(), clearTimeout: jest.fn() }
  return { clock, advance: (ms: number) => { time += ms } }
}

const create = (config: { emplace?: boolean; comparator?: (a: T, b: T) => number; ttl?: number } = {}) => {
  const { clock, advance } = manualClock()
  const queue = new OrderedQueue<T>({ emplace: false, ttl: 0, ...config, clock })
  const add = (item: T) => queue.put(item, queue.indexOf(item.id), -1)
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
      expect(() => queue.put({ id: 'c', p: 3 }, -1, queue.findOldestIndex())).toThrow('cmp')
      expect(() => add({ id: 'b', p: 0 })).toThrow('cmp')
      expect(queue.toArray()).toEqual([{ id: 'a', p: 1 }, { id: 'b', p: 2 }])
      expect(queue.bookkeepingSizes().arrivals).toBe(2)
    })
  })

  describe('eviction', () => {
    test('findOldestIndex finds the earliest arrival whatever the mode', () => {
      const { queue, add } = create({ emplace: true })
      add({ id: 'old' }); add({ id: 'new' })
      expect(queue.findOldestIndex()).toBe(0)
      const other = create()
      other.add({ id: 'old' }); other.add({ id: 'new' })
      expect(other.queue.findOldestIndex()).toBe(1)
    })

    test('an emplace replacement keeps its arrival', () => {
      const { queue, add } = create({ emplace: true })
      add({ id: 'a' }); add({ id: 'b' }); add({ id: 'a', p: 1 })
      expect(queue.toArray()[queue.findOldestIndex()].id).toBe('a')
    })

    test('put with an eviction index returns the evicted item and forgets it', () => {
      const { queue, add } = create({ ttl: 100 })
      add({ id: 'a' }); add({ id: 'b' })
      const evicted = queue.put({ id: 'c' }, -1, queue.findOldestIndex())
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
      expect(queue.toArray()[queue.findOldestIndex()].id).toBe(oldest)
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
