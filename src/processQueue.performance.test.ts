// Complexity checks. Where an operation reads the items, they are proxies that count reads of their id,
// so a scan of the queue shows up as a count that grows with its length, without timing anything.
// Where a scan reads nothing of the items, the test is timed instead, with sizes at which 3.1.0's O(n²)
// took 25 s or more and this version takes under 1 s alone. The limit allows for the rest of the suite
// running in parallel on a busy machine, which has slowed these tests about twentyfold.
import ProcessQueue from './processQueue'

const TIME_LIMIT_MS = 10_000

type Counted = { id: number }

/** Items that count how often any of their ids is read */
const countingItems = () => {
  const counter = { reads: 0 }
  const make = (id: number): Counted => new Proxy({ id }, {
    get(target, key, receiver) {
      if (key === 'id') counter.reads++
      return Reflect.get(target, key, receiver)
    },
  })
  return { counter, make }
}

const N = 2000
// Reads per operation that don't depend on the queue's length; a scan costs about N/2 per operation
const PER_OPERATION = 10

describe('ProcessQueue complexity', () => {
  test.each([
    ['default', {}],
    ['emplace', { emplace: true }],
  ])('queueItem, has and removeFromQueue find items without scanning the queue (%s)', (_label, options) => {
    const { counter, make } = countingItems()
    const queue = new ProcessQueue<Counted>({ maxSize: Infinity, ...options })
    for (let i = 0; i < N; i++) queue.queueItem(make(i))
    // Updates of queued ids
    for (let i = 0; i < N; i++) queue.queueItem(make(i))
    for (let i = 0; i < N; i++) expect(queue.has(i)).toBe(true)
    for (let i = 0; i < N; i++) queue.removeFromQueue(i)

    expect(queue.length()).toBe(0)
    expect(counter.reads).toBeLessThan(4 * N * PER_OPERATION)
  })

  // Timed: shifting items along an array reads no ids. 3.1.0 took 26 s (emplace) and 47 s (default) here.
  test.each([
    ['default', {}],
    ['emplace', { emplace: true }],
  ])('adding and taking from the front take constant time (%s)', (_label, options) => {
    const items = 100_000
    const queue = new ProcessQueue<Counted>({ maxSize: Infinity, ...options })
    const start = performance.now()
    for (let i = 0; i < items; i++) queue.queueItem({ id: i })
    let taken = 0
    while (queue.getNextItem()) taken++
    const elapsed = performance.now() - start

    expect(taken).toBe(items)
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS)
  }, 120000)

  // Timed: finding the oldest arrival by scanning reads only the queue's own bookkeeping. 3.1.0 took 63 s here.
  test.each([
    ['default', {}],
    ['emplace', { emplace: true }],
  ])('drop-oldest finds the oldest item in constant time (%s)', (_label, options) => {
    const maxSize = 40_000
    const queue = new ProcessQueue<Counted>({ maxSize, overflowStrategy: 'drop-oldest', ...options })
    for (let i = 0; i < maxSize; i++) queue.queueItem({ id: i })
    const evicted: number[] = []
    queue.on('removed', item => evicted.push(item.id))
    const start = performance.now()
    for (let i = maxSize; i < 2 * maxSize; i++) queue.queueItem({ id: i })
    const elapsed = performance.now() - start

    expect(evicted).toEqual(Array.from({ length: maxSize }, (_, i) => i))
    expect(elapsed).toBeLessThan(TIME_LIMIT_MS)
  }, 120000)

  describe('with a TTL', () => {
    afterEach(() => { vi.useRealTimers() })

    // Timed: every take checks for expired items. 3.1.0 took 77 s (default) and 87 s (emplace) here.
    test.each([
      ['default', {}],
      ['emplace', { emplace: true }],
    ])('taking items costs no more than O(log n) when nothing has expired (%s)', (_label, options) => {
      const items = 50_000
      const queue = new ProcessQueue<Counted>({ maxSize: Infinity, ttl: 3_600_000, ...options })
      const start = performance.now()
      for (let i = 0; i < items; i++) queue.queueItem({ id: i })
      let taken = 0
      while (queue.getNextItem()) taken++
      const elapsed = performance.now() - start

      expect(taken).toBe(items)
      expect(elapsed).toBeLessThan(TIME_LIMIT_MS)
    }, 120000)

    // Half the items have expired when taking starts. Default mode then takes the newest first, so the oldest,
    // at the back, keep expiring one by one; emplace mode expires the first half at once and then takes the rest.
    // 3.1.0 took 5 s (default) and 10 s (emplace) here.
    test.each([
      ['default', {}],
      ['emplace', { emplace: true }],
    ])('taking items costs no more than O(log n) while items expire (%s)', (_label, options) => {
      // Only Date: the test times itself with the real performance.now()
      vi.useFakeTimers({ toFake: ['Date'] })
      const items = 150_000
      const queue = new ProcessQueue<Counted>({ maxSize: Infinity, ttl: items / 2, ...options })
      for (let i = 0; i < items; i++) {
        queue.queueItem({ id: i })
        vi.advanceTimersByTime(1)
      }
      let expired = 0
      queue.on('expired', () => { expired++ })
      let taken = 0
      const start = performance.now()
      for (;;) {
        vi.advanceTimersByTime(1)
        if (!queue.getNextItem()) break
        taken++
      }
      const elapsed = performance.now() - start

      expect(taken + expired).toBe(items)
      expect(expired).toBeGreaterThan(0)
      expect(elapsed).toBeLessThan(TIME_LIMIT_MS)
    }, 120000)
  })
})
