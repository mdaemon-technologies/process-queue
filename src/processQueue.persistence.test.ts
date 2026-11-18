// What a durable wrapper needs to rebuild a queue after a crash: retry details on the
// 'error' event, and per-item state (attempts, retry times, enqueue times) in snapshots.
import ProcessQueue, { ItemState, Snapshot } from './processQueue'
import { controlledWorker } from './testHelpers'

type Job = { id: string; n?: number }

const failingWorker = async (): Promise<void> => { throw new Error('work') }

describe('ProcessQueue - retry details on the error event', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('a delayed retry reports its attempt and delay; the final failure reports none', async () => {
    const thirdArgs: unknown[] = []
    const queue = new ProcessQueue<Job>({ worker: failingWorker, maxRetries: 2, retryDelay: 100 })
    queue.on('error', (...args: unknown[]) => { thirdArgs.push(args[2]) })

    queue.queueItem({ id: 'a' })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(100)
    await vi.advanceTimersByTimeAsync(100)

    expect(thirdArgs).toEqual([{ attempt: 1, delay: 100 }, { attempt: 2, delay: 100 }, undefined])
    expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
  })

  test('an immediate retry reports a delay of 0, with the item already queued', async () => {
    const seen: unknown[] = []
    const queue = new ProcessQueue<Job>({ worker: failingWorker, maxRetries: 1 })
    queue.on('error', (item, _error, ...rest: unknown[]) => { seen.push([rest[0], queue.has(item.id)]) })

    queue.queueItem({ id: 'a' })
    await vi.advanceTimersByTimeAsync(0)

    expect(seen).toEqual([[{ attempt: 1, delay: 0 }, true], [undefined, false]])
  })

  describe('reports no retry when the retry cannot be scheduled', () => {
    beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}) })
    afterEach(() => { vi.restoreAllMocks() })

    test('because retryDelay throws', async () => {
      const thirdArgs: unknown[] = []
      const queue = new ProcessQueue<Job>({
        worker: failingWorker,
        maxRetries: 3,
        retryDelay: () => { throw new Error('delay') },
      })
      queue.on('error', (...args: unknown[]) => { thirdArgs.push(args[2]) })

      queue.queueItem({ id: 'a' })
      await vi.advanceTimersByTimeAsync(0)

      expect(thirdArgs).toEqual([undefined])
      expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
    })

    test('because the comparator throws as the item re-enters the queue', async () => {
      let comparatorThrows = false
      const thirdArgs: unknown[] = []
      const queue = new ProcessQueue<Job>({
        worker: async item => { if (item.id === 'a') { comparatorThrows = true; throw new Error('work') } },
        comparator: () => { if (comparatorThrows) throw new Error('compare'); return 0 },
        maxRetries: 1,
      })
      queue.on('error', (...args: unknown[]) => { thirdArgs.push(args[2]) })

      queue.queueItem({ id: 'a' })
      // Queued while 'a' runs, so the retry has an item to be compared with
      queue.queueItem({ id: 'b' })
      await vi.advanceTimersByTimeAsync(0)

      expect(thirdArgs).toEqual([undefined])
      expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
    })
  })

  test('a retryDelay of NaN retries immediately and reports a delay of 0', async () => {
    const thirdArgs: unknown[] = []
    const queue = new ProcessQueue<Job>({ worker: failingWorker, maxRetries: 1, retryDelay: () => NaN })
    queue.on('error', (...args: unknown[]) => { thirdArgs.push(args[2]) })

    queue.queueItem({ id: 'a' })
    await vi.advanceTimersByTimeAsync(0)

    expect(thirdArgs).toEqual([{ attempt: 1, delay: 0 }, undefined])
  })
})

describe('ProcessQueue - serialize records per-item state', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test('attempts, for in-process and queued items', async () => {
    const { runs, worker } = controlledWorker<Job>()
    const queue = new ProcessQueue<Job>({ worker, maxRetries: 3 })
    queue.queueItem({ id: 'a' })
    runs[0].reject(new Error('work'))
    await vi.advanceTimersByTimeAsync(0)

    // Retried immediately and running again
    expect(queue.serialize().inProcess).toEqual([{ id: 'a' }])
    expect(queue.serialize().itemState).toEqual([{ id: 'a', attempts: 1 }])

    queue.queueItem({ id: 'b' })
    queue.pause()
    runs[1].reject(new Error('work'))
    await vi.advanceTimersByTimeAsync(0)

    // Back in the paused queue, ahead of 'b', which has nothing to record
    expect(queue.serialize().queue).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(queue.serialize().itemState).toEqual([{ id: 'a', attempts: 2 }])
  })

  test('attempts, for items awaiting a retry', async () => {
    const queue = new ProcessQueue<Job>({ worker: failingWorker, maxRetries: 3, retryDelay: 1000 })
    queue.queueItem({ id: 'a' })
    await vi.advanceTimersByTimeAsync(0)

    expect(queue.serialize().itemState).toEqual([expect.objectContaining({ id: 'a', attempts: 1 })])
  })

  test('retryAt, for items awaiting a retry, already recorded when "error" is emitted', async () => {
    vi.setSystemTime(50_000)
    const queue = new ProcessQueue<Job>({ worker: failingWorker, maxRetries: 3, retryDelay: 1000 })
    const inListener: unknown[] = []
    queue.on('error', () => { inListener.push(queue.serialize().itemState) })
    queue.queueItem({ id: 'a' })
    await vi.advanceTimersByTimeAsync(0)

    const expected = [{ id: 'a', attempts: 1, retryAt: 51_000 }]
    expect(inListener).toEqual([expected])
    expect(queue.serialize().itemState).toEqual(expected)
  })

  test('enqueuedAt, for queued items when there is a TTL', () => {
    vi.setSystemTime(10_000)
    const queue = new ProcessQueue<Job>({ ttl: 5000 })
    queue.queueItem({ id: 'a' })
    vi.setSystemTime(10_300)
    queue.queueItem({ id: 'b' })

    expect(queue.serialize().itemState).toEqual([
      { id: 'b', enqueuedAt: 10_300 },
      { id: 'a', enqueuedAt: 10_000 },
    ])
    // Taken items no longer count against the TTL
    queue.getNextItem()
    expect(queue.serialize().itemState).toEqual([{ id: 'a', enqueuedAt: 10_000 }])
  })

  test('nothing for items without state', () => {
    const queue = new ProcessQueue<Job>()
    queue.queueItem({ id: 'a' })
    expect(queue.serialize().itemState).toEqual([])
  })
})

describe('ProcessQueue - deserialize restores per-item state', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  test.each([
    ['a queued item', { queue: [{ id: 'a' }] }],
    ['an interrupted in-process item', { queue: [], inProcess: [{ id: 'a' }] }],
  ])('attempts, so %s only gets its remaining retries', async (_label, lists) => {
    const thirdArgs: unknown[] = []
    const queue = ProcessQueue.deserialize<Job>(
      { ...lists, itemState: [{ id: 'a', attempts: 2 }] },
      { worker: failingWorker, maxRetries: 2 }
    )
    queue.on('error', (...args: unknown[]) => { thirdArgs.push(args[2]) })
    queue.start()
    await vi.advanceTimersByTimeAsync(0)

    expect(thirdArgs).toEqual([undefined])
    expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
  })
})

describe('ProcessQueue - deserialize restores enqueue times', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
  })
  afterEach(() => { vi.useRealTimers() })

  test('so the TTL counts from when the item was first queued', () => {
    const queue = ProcessQueue.deserialize<Job>(
      { queue: [{ id: 'a' }, { id: 'b' }], itemState: [{ id: 'a', enqueuedAt: 99_000 }] },
      { ttl: 2000 }
    )
    const expired = vi.fn()
    queue.on('expired', expired)

    vi.setSystemTime(101_001)
    expect(queue.getNextItem()).toEqual({ id: 'b' })
    expect(expired).toHaveBeenCalledWith({ id: 'a' }, undefined)
  })

  test.each([
    ['a queued retried item', { queue: [{ id: 'a' }], itemState: [{ id: 'a', attempts: 1 }] }],
    ['an interrupted retried item', { queue: [], inProcess: [{ id: 'a' }], itemState: [{ id: 'a', attempts: 1 }] }],
    ['an item awaiting a retry', { queue: [{ id: 'a' }], itemState: [{ id: 'a', attempts: 1, retryAt: 100_000 }] }],
  ])('%s stays exempt from the TTL, as retried items are', async (_label, snapshot) => {
    const queue = ProcessQueue.deserialize<Job>(snapshot, { worker: () => {}, ttl: 1000 })
    const expired = vi.fn()
    queue.on('expired', expired)
    queue.pause()

    await vi.advanceTimersByTimeAsync(5000)
    expect(queue.getQueue()).toEqual([{ id: 'a' }])
    queue.resume()
    expect(expired).not.toHaveBeenCalled()
  })
})

describe('ProcessQueue - deserialize restores items awaiting a retry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
  })
  afterEach(() => { vi.useRealTimers() })

  const waiting = { queue: [{ id: 'a' }], itemState: [{ id: 'a', attempts: 1, retryAt: 101_000 }] }

  test('they wait until retryAt, with their id reserved', async () => {
    const worker = vi.fn()
    const queue = ProcessQueue.deserialize<Job>(waiting, { worker, maxRetries: 3 })
    queue.start()

    expect(queue.has('a')).toBe(false)
    expect(queue.queueItem({ id: 'a', n: 2 })).toBe(false)
    expect(queue.serialize()).toMatchObject(waiting)

    await vi.advanceTimersByTimeAsync(999)
    expect(worker).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(worker).toHaveBeenCalledWith({ id: 'a' })
  })

  test('one coming due starts a restored worker queue, as queueing an item does', async () => {
    const worker = vi.fn()
    ProcessQueue.deserialize<Job>({ ...waiting, queue: [{ id: 'a' }, { id: 'b' }] }, { worker })

    await vi.advanceTimersByTimeAsync(999)
    expect(worker).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(worker.mock.calls.map(([item]) => item.id)).toEqual(['a', 'b'])
  })

  test('one coming due does not start a paused queue', async () => {
    const worker = vi.fn()
    const queue = ProcessQueue.deserialize<Job>(waiting, { worker })
    queue.pause()

    await vi.advanceTimersByTimeAsync(1000)
    expect(worker).not.toHaveBeenCalled()
    expect(queue.getQueue()).toEqual([{ id: 'a' }])
  })

  test('removeFromQueue cancels them, and the queue then drains', () => {
    const queue = ProcessQueue.deserialize<Job>(waiting, { worker: vi.fn() })
    const drain = vi.fn()
    queue.on('drain', drain)

    expect(queue.removeFromQueue('a')).toBe(true)
    expect(drain).toHaveBeenCalledTimes(1)
    expect(queue.serialize().queue).toEqual([])
    expect(queue._bookkeepingSizes()).toEqual(expect.objectContaining({ retryCount: 0, pendingRetries: 0 }))
  })

  test('drain and onIdle wait for them', async () => {
    const queue = ProcessQueue.deserialize<Job>(waiting, { worker: vi.fn() })
    const idle = vi.fn()
    void queue.onIdle().then(idle)
    queue.start()

    await vi.advanceTimersByTimeAsync(999)
    expect(idle).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(idle).toHaveBeenCalledTimes(1)
  })

  test('they count toward maxSize', () => {
    const queue = ProcessQueue.deserialize<Job>(waiting, { worker: vi.fn(), maxSize: 1 })
    expect(() => queue.queueItem({ id: 'b' })).toThrow('Queue size limit reached')
  })

  test('a retryAt already past re-enters on the next timer tick', async () => {
    const worker = vi.fn()
    const queue = ProcessQueue.deserialize<Job>(
      { queue: [{ id: 'a' }], itemState: [{ id: 'a', retryAt: 1 }] },
      { worker }
    )
    queue.start()
    expect(worker).not.toHaveBeenCalled()
    expect(queue.serialize().itemState).toEqual([{ id: 'a', retryAt: 1 }])

    await vi.advanceTimersByTimeAsync(0)
    expect(worker).toHaveBeenCalledWith({ id: 'a' })
  })

  test('with a comparator, they re-enter in priority order', async () => {
    const queue = ProcessQueue.deserialize<{ id: string; p: number }>(
      {
        queue: [{ id: 'mid', p: 3 }, { id: 'high', p: 5 }, { id: 'low', p: 1 }],
        itemState: [{ id: 'mid', retryAt: 100_500 }],
      },
      { comparator: (a, b) => b.p - a.p }
    )
    expect(queue.getQueue().map(i => i.id)).toEqual(['high', 'low'])

    await vi.advanceTimersByTimeAsync(500)
    expect(queue.getQueue().map(i => i.id)).toEqual(['high', 'mid', 'low'])
  })
})

describe('ProcessQueue - restoring per-item state safely', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
  })
  afterEach(() => { vi.useRealTimers() })

  // Two ready items, so restoring them in comparator order calls the comparator
  const withRetry = (itemState: ItemState[]): Snapshot<Job> =>
    ({ queue: [{ id: 'r' }, { id: 'q1' }, { id: 'q2' }], itemState: [{ id: 'r', retryAt: 101_000 }, ...itemState] })

  test('a deserialize that throws leaves no timer behind', () => {
    const throwingComparator = () => { throw new Error('compare') }
    expect(() => ProcessQueue.deserialize<Job>(withRetry([]), { comparator: throwingComparator })).toThrow('compare')
    expect(() => ProcessQueue.deserialize<Job>(withRetry([{ id: 'unknown', attempts: 1 }]))).toThrow(TypeError)
    expect(vi.getTimerCount()).toBe(0)
  })

  test('restored state is forgotten once the work is done', async () => {
    const queue = ProcessQueue.deserialize<Job>(
      {
        queue: [{ id: 'r' }, { id: 'q' }],
        inProcess: [{ id: 'p' }],
        itemState: [
          { id: 'r', attempts: 1, retryAt: 101_000 },
          { id: 'q', attempts: 1, enqueuedAt: 99_000 },
          { id: 'p', attempts: 2 },
        ],
      },
      { ttl: 60_000 }
    )
    queue.doneProcessing('p')
    queue.doneProcessing(queue.getNextItem()!.id)
    await vi.advanceTimersByTimeAsync(1000)
    queue.doneProcessing(queue.getNextItem()!.id)

    expect(Object.values(queue._bookkeepingSizes()).every(size => size === 0)).toBe(true)
    expect(queue.serialize().itemState).toEqual([])
  })

  test('restored state is forgotten once a worker finishes the work', async () => {
    const queue = ProcessQueue.deserialize<Job>(
      {
        queue: [{ id: 'r' }, { id: 'q' }],
        inProcess: [{ id: 'p' }],
        itemState: [
          { id: 'r', attempts: 1, retryAt: 101_000 },
          { id: 'q', attempts: 1, enqueuedAt: 99_000 },
          { id: 'p', attempts: 2 },
        ],
      },
      { worker: async () => {}, maxRetries: 3, ttl: 60_000 }
    )
    queue.start()
    await vi.advanceTimersByTimeAsync(1000)

    expect(Object.values(queue._bookkeepingSizes()).every(size => size === 0)).toBe(true)
    expect(queue.serialize()).toEqual({ queue: [], inProcess: [], deadLetterQueue: [], itemState: [] })
  })
})

describe('ProcessQueue - per-item state round-trips', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(100_000)
  })
  afterEach(() => { vi.useRealTimers() })

  test('through JSON, as a durable store would save it', async () => {
    const options = { worker: failingWorker, maxRetries: 3, retryDelay: 5000, ttl: 60_000 }
    const queue = new ProcessQueue<Job>(options)
    queue.queueItem({ id: 'a' })
    await vi.advanceTimersByTimeAsync(0)
    queue.pause()
    queue.queueItem({ id: 'b', n: 1 })
    const snapshot = queue.serialize()
    expect(snapshot.itemState).toEqual([
      { id: 'a', attempts: 1, retryAt: 105_000 },
      { id: 'b', enqueuedAt: 100_000 },
    ])
    queue.clear()

    const restored = ProcessQueue.deserialize<Job>(JSON.parse(JSON.stringify(snapshot)), options)
    expect(restored.serialize()).toEqual(snapshot)
    restored.clear()
  })

  // On a real clock the millisecond can turn between deserialize's reads of the time
  test('with retryAt unchanged when the clock ticks during the restore', () => {
    const snapshot = { queue: [{ id: 'a' }], inProcess: [], deadLetterQueue: [], itemState: [{ id: 'a', attempts: 1, retryAt: 105_000 }] }
    let now = 100_000
    const ticking = vi.spyOn(Date, 'now').mockImplementation(() => now++)

    try {
      const restored = ProcessQueue.deserialize<Job>(snapshot, { maxRetries: 3 })
      expect(restored.serialize()).toEqual(snapshot)
      restored.clear()
    } finally {
      ticking.mockRestore()
    }
  })
})
