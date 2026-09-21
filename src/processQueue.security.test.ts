import ProcessQueue from './processQueue'
import { controlledWorker, flush, silenceConsoleError } from './testHelpers'

type TestItem = { id: string; value?: string }

describe('ProcessQueue - listener and worker exceptions', () => {
  const consoleError = silenceConsoleError()

  test('a throwing "done" listener does not re-run a successful item', async () => {
    let runs = 0
    const queue: ProcessQueue<TestItem> = new ProcessQueue<TestItem>({
      // stop() bounds the loop so a regression cannot hang the test run
      worker: async () => { if (++runs >= 10) queue.stop() },
      maxRetries: 2
    })
    queue.on('done', () => { throw new Error('listener') })
    queue.queueItem({ id: 'a' })
    await flush()
    expect(runs).toBe(1)
    expect(queue.getDeadLetterQueue()).toEqual([])
  })

  // Jest fails a test that causes an unhandled rejection, so these tests also guard against one
  describe('without unhandled rejections', () => {
    test('a throwing "error" listener does not cause an unhandled rejection', async () => {
      const queue = new ProcessQueue<TestItem>({ worker: async () => { throw new Error('work') } })
      queue.on('error', () => { throw new Error('listener') })
      queue.queueItem({ id: 'a' })
      await flush()
      expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
    })

    test('a throwing retryDelay function moves the item to the dead letter queue', async () => {
      const failed = jest.fn()
      const queue = new ProcessQueue<TestItem>({
        worker: async () => { throw new Error('work') },
        maxRetries: 3,
        retryDelay: () => { throw new Error('delay') }
      })
      queue.on('failed', failed)
      queue.queueItem({ id: 'a' })
      await flush()
      expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
      expect(failed).toHaveBeenCalledWith({ id: 'a' }, expect.objectContaining({ message: 'delay' }))
      expect(queue.busy()).toBe(false)
    })
  })

  test('many failing synchronous items do not overflow the stack', () => {
    const count = 10000
    const queue = new ProcessQueue<TestItem>({
      maxSize: count,
      maxDeadLetterSize: count,
      worker: () => { throw new Error('work') }
    })
    queue.pause()
    for (let i = 0; i < count; i++) queue.queueItem({ id: `i${i}` })
    expect(() => queue.resume()).not.toThrow()
    expect(queue.getDeadLetterQueue().length).toBe(count)
    expect(queue.isEmpty()).toBe(true)
  })

  test('immediate synchronous retries do not overflow the stack', () => {
    const retries = 10000
    let runs = 0
    const queue = new ProcessQueue<TestItem>({
      maxRetries: retries,
      worker: () => { runs++; throw new Error('work') }
    })
    expect(() => queue.queueItem({ id: 'a' })).not.toThrow()
    expect(runs).toBe(retries + 1)
    expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
  })

  test.each([
    ['async success', async (item: TestItem) => { item.id = 'changed' }],
    ['async failure', async (item: TestItem) => { item.id = 'changed'; throw new Error('work') }],
    ['sync success', (item: TestItem) => { item.id = 'changed' }],
  ])('a worker that changes item.id does not strand the item (%s)', async (_label, worker) => {
    const queue = new ProcessQueue<TestItem>({ worker })
    queue.queueItem({ id: 'a' })
    await flush()
    expect(queue.busy()).toBe(false)
    expect(queue.isProcessing('a')).toBe(false)
  })

  test('a throwing "processing" listener does not strand the item in-process', async () => {
    const processed: string[] = []
    const queue = new ProcessQueue<TestItem>({ worker: async item => { processed.push(item.id) } })
    queue.once('processing', () => { throw new Error('listener') })
    expect(() => queue.queueItem({ id: 'a' })).not.toThrow()
    queue.queueItem({ id: 'b' })
    await flush()
    expect(processed).toEqual(['a', 'b'])
    expect(queue.busy()).toBe(false)
  })

  test('listener errors are passed to onListenerError with the event name', () => {
    const onListenerError = jest.fn()
    const queue = new ProcessQueue<TestItem>({ onListenerError })
    const boom = new Error('listener')
    queue.on('added', () => { throw boom })
    expect(queue.queueItem({ id: 'a' })).toBe(true)
    expect(onListenerError).toHaveBeenCalledWith(boom, 'added')
    expect(consoleError.spy).not.toHaveBeenCalled()
  })

  test('listener errors default to console.error', () => {
    const queue = new ProcessQueue<TestItem>()
    queue.on('added', () => { throw new Error('listener') })
    queue.queueItem({ id: 'a' })
    expect(consoleError.spy).toHaveBeenCalledTimes(1)
  })

  test('a "once" listener registered during an emit waits for the next emit', () => {
    const queue = new ProcessQueue<TestItem>()
    const second = jest.fn()
    queue.once('added', () => { queue.once('added', second) })
    queue.queueItem({ id: 'a' })
    expect(second).not.toHaveBeenCalled()
    queue.queueItem({ id: 'b' })
    expect(second).toHaveBeenCalledTimes(1)
  })

  test('a throwing "once" listener still fires only once', () => {
    const queue = new ProcessQueue<TestItem>()
    const handler = jest.fn(() => { throw new Error('listener') })
    queue.once('added', handler)
    queue.queueItem({ id: 'a' })
    queue.queueItem({ id: 'b' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('a throwing onListenerError is contained', () => {
    const queue = new ProcessQueue<TestItem>({ onListenerError: () => { throw new Error('reporter') } })
    queue.on('added', () => { throw new Error('listener') })
    expect(queue.queueItem({ id: 'a' })).toBe(true)
  })
})

describe('ProcessQueue - stale worker runs', () => {
  test('a run that timed out cannot finish the run that replaced it', async () => {
    const { runs, worker } = controlledWorker<TestItem>()
    const done = jest.fn()
    const queue = new ProcessQueue<TestItem>({ worker, processingTimeout: 5 })
    queue.on('done', done)
    queue.queueItem({ id: 't' })
    await flush()
    queue.checkProcessingTimeouts()
    queue.queueItem({ id: 't' })
    expect(runs.length).toBe(2)

    runs[0].resolve()
    await flush(0)
    expect(queue.isProcessing('t')).toBe(true)
    expect(done).not.toHaveBeenCalled()

    runs[1].resolve()
    await flush(0)
    expect(queue.isProcessing('t')).toBe(false)
    expect(done).toHaveBeenCalledTimes(1)
  })

  test('a run that timed out and then fails is not retried or dead-lettered', async () => {
    const { runs, worker } = controlledWorker<TestItem>()
    const error = jest.fn()
    const queue = new ProcessQueue<TestItem>({ worker, processingTimeout: 5, maxRetries: 1 })
    queue.on('error', error)
    queue.queueItem({ id: 't' })
    await flush()
    queue.checkProcessingTimeouts()

    runs[0].reject(new Error('late'))
    await flush()
    expect(runs.length).toBe(1)
    expect(error).not.toHaveBeenCalled()
    expect(queue.getDeadLetterQueue()).toEqual([])
  })

  test('checkProcessingTimeouts starts queued work in the freed slot', async () => {
    const { runs, worker } = controlledWorker<TestItem>()
    const queue = new ProcessQueue<TestItem>({ worker, processingTimeout: 5 })
    queue.queueItem({ id: 'a' })
    queue.queueItem({ id: 'b' })
    expect(runs.map(r => r.id)).toEqual(['a'])
    await flush()
    queue.checkProcessingTimeouts()
    expect(runs.map(r => r.id)).toEqual(['a', 'b'])
  })

  test.each([
    ['clear()', (queue: ProcessQueue<TestItem>) => queue.clear()],
    ['doneProcessing()', (queue: ProcessQueue<TestItem>) => queue.doneProcessing()],
    ['doneProcessing(id)', (queue: ProcessQueue<TestItem>) => queue.doneProcessing('a')],
  ])('a run released by %s cannot finish the run that replaced it', async (_label, release) => {
    const { runs, worker } = controlledWorker<TestItem>()
    const queue = new ProcessQueue<TestItem>({ worker })
    queue.queueItem({ id: 'a' })
    release(queue)
    queue.queueItem({ id: 'a' })
    expect(runs.length).toBe(2)

    runs[0].resolve()
    await flush(0)
    expect(queue.isProcessing('a')).toBe(true)
  })
})

describe('ProcessQueue - pending retries', () => {
  const failOnce = (seen: string[]) => {
    let failed = false
    return async (item: TestItem) => {
      seen.push(item.value ?? item.id)
      if (!failed) { failed = true; throw new Error('work') }
    }
  }

  test('an item awaiting a retry keeps its id reserved', async () => {
    const seen: string[] = []
    const queue = new ProcessQueue<TestItem>({ worker: failOnce(seen), maxRetries: 1, retryDelay: 30, concurrency: 2 })
    queue.queueItem({ id: 'd', value: 'orig' })
    await flush(5)
    expect(queue.queueItem({ id: 'd', value: 'dup' })).toBe(false)
    await flush(60)
    expect(seen).toEqual(['orig', 'orig'])
  })

  test('clear() cancels pending retries', async () => {
    const seen: string[] = []
    const queue = new ProcessQueue<TestItem>({ worker: failOnce(seen), maxRetries: 1, retryDelay: 30 })
    queue.queueItem({ id: 'a' })
    await flush(5)
    queue.clear()
    await flush(60)
    expect(seen).toEqual(['a'])
    expect(queue.isEmpty()).toBe(true)
  })

  test('removeFromQueue cancels a pending retry', async () => {
    const seen: string[] = []
    const removed = jest.fn()
    const queue = new ProcessQueue<TestItem>({ worker: failOnce(seen), maxRetries: 1, retryDelay: 30 })
    queue.on('removed', removed)
    queue.queueItem({ id: 'a' })
    await flush(5)
    expect(queue.removeFromQueue('a')).toBe(true)
    expect(removed).toHaveBeenCalledWith({ id: 'a' }, undefined)
    await flush(60)
    expect(seen).toEqual(['a'])
    expect(queue.queueItem({ id: 'a' })).toBe(true)
  })

  test('serialize includes items awaiting a retry', async () => {
    const queue = new ProcessQueue<TestItem>({ worker: failOnce([]), maxRetries: 1, retryDelay: 30 })
    queue.queueItem({ id: 'a' })
    await flush(5)
    expect(queue.serialize().queue).toEqual([{ id: 'a' }])
    queue.clear()
  })

  test('drain waits for pending retries', async () => {
    const drain = jest.fn()
    const seen: string[] = []
    const failA = failOnce(seen)
    const queue = new ProcessQueue<TestItem>({
      worker: async item => { if (item.id === 'a') await failA(item) },
      maxRetries: 1,
      retryDelay: 30,
      concurrency: 2
    })
    queue.on('drain', drain)
    queue.queueItem({ id: 'a' })
    queue.queueItem({ id: 'b' })
    await flush(10)
    expect(drain).not.toHaveBeenCalled()
    await flush(50)
    expect(drain).toHaveBeenCalledTimes(1)
  })

  test('a retry is re-admitted even when the queue is full', async () => {
    const seen: string[] = []
    const queue = new ProcessQueue<TestItem>({ worker: failOnce(seen), maxRetries: 1, retryDelay: 20, maxSize: 1 })
    // b fills the queue while a is still in flight; a then fails and its retry comes back
    queue.queueItem({ id: 'a' })
    queue.pause()
    queue.queueItem({ id: 'b' })
    await flush(40)
    // The overshoot is at most the number of items in flight
    expect(queue.getQueue().map(i => i.id).sort()).toEqual(['a', 'b'])
  })
})

describe('ProcessQueue - capacity', () => {
  test('re-queuing an in-flight id does not evict a queued item', () => {
    const queue = new ProcessQueue<TestItem>({ maxSize: 2, overflowStrategy: 'drop-oldest' })
    queue.queueItem({ id: 'p' })
    queue.getNextItem()
    queue.queueItem({ id: 'a' })
    queue.queueItem({ id: 'b' })
    expect(queue.queueItem({ id: 'p' })).toBe(false)
    expect(queue.getQueue().map(i => i.id).sort()).toEqual(['a', 'b'])
  })

  describe('drop-oldest evicts the earliest arrival', () => {
    type PItem = { id: string; priority: number }
    const ids = (queue: ProcessQueue<any>) => queue.getQueue().map(i => i.id)

    test('in emplace mode', () => {
      const queue = new ProcessQueue<TestItem>({ maxSize: 2, overflowStrategy: 'drop-oldest', emplace: true })
      queue.queueItem({ id: 'old' })
      queue.queueItem({ id: 'new' })
      queue.queueItem({ id: 'newest' })
      expect(ids(queue)).toEqual(['new', 'newest'])
    })

    test('with a comparator', () => {
      const queue = new ProcessQueue<PItem>({
        maxSize: 2,
        overflowStrategy: 'drop-oldest',
        comparator: (a, b) => b.priority - a.priority
      })
      queue.queueItem({ id: 'first', priority: 5 })
      queue.queueItem({ id: 'second', priority: 1 })
      queue.queueItem({ id: 'third', priority: 3 })
      expect(ids(queue)).toEqual(['third', 'second'])
    })

    test('an emplace replacement keeps its original arrival', () => {
      const queue = new ProcessQueue<TestItem>({ maxSize: 2, overflowStrategy: 'drop-oldest', emplace: true })
      queue.queueItem({ id: 'a' })
      queue.queueItem({ id: 'b' })
      queue.queueItem({ id: 'a', value: 'updated' })
      queue.queueItem({ id: 'c' })
      expect(ids(queue)).toEqual(['b', 'c'])
    })

    test('a default-mode re-queue counts as a new arrival', () => {
      const queue = new ProcessQueue<TestItem>({ maxSize: 2, overflowStrategy: 'drop-oldest' })
      queue.queueItem({ id: 'a' })
      queue.queueItem({ id: 'b' })
      queue.queueItem({ id: 'a', value: 'again' })
      queue.queueItem({ id: 'c' })
      expect(ids(queue).sort()).toEqual(['a', 'c'])
    })

    test('the evicted item is reported with a "removed" event', () => {
      const removed = jest.fn()
      const queue = new ProcessQueue<TestItem>({ maxSize: 1, overflowStrategy: 'drop-oldest' })
      queue.on('removed', removed)
      queue.queueItem({ id: 'a' })
      queue.queueItem({ id: 'b' })
      expect(removed).toHaveBeenCalledWith({ id: 'a' }, undefined)
    })
  })

  test('the dead letter queue keeps the newest maxDeadLetterSize entries', () => {
    const queue = new ProcessQueue<TestItem>({ maxDeadLetterSize: 2, worker: () => { throw new Error('work') } })
    queue.queueMany([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    expect(queue.getDeadLetterQueue().map(i => i.id)).toEqual(['b', 'c'])
  })

  test('the dead letter queue is capped at 1000 by default', () => {
    // emplace mode is FIFO, so failures arrive in id order
    const queue = new ProcessQueue<TestItem>({ emplace: true, maxSize: 1500, worker: () => { throw new Error('work') } })
    queue.pause()
    for (let i = 0; i < 1500; i++) queue.queueItem({ id: `i${i}` })
    queue.resume()
    const dlq = queue.getDeadLetterQueue()
    expect(dlq.length).toBe(1000)
    expect(dlq[0].id).toBe('i500')
  })

  test.each([
    ['reject', false],
    ['reject', true],
    ['drop-newest', false],
    ['drop-newest', true],
    ['drop-oldest', false],
    ['drop-oldest', true],
  ] as const)('updating a queued id in a full queue succeeds (%s, emplace=%p)', (overflowStrategy, emplace) => {
    const queue = new ProcessQueue<TestItem>({ maxSize: 2, overflowStrategy, emplace })
    queue.queueItem({ id: 'a' })
    queue.queueItem({ id: 'b' })
    expect(queue.queueItem({ id: 'a', value: 'updated' })).toBe(true)
    expect(queue.length()).toBe(2)
    expect(queue.getQueue().find(i => i.id === 'a')).toEqual({ id: 'a', value: 'updated' })
    expect(queue.has('b')).toBe(true)
  })
})

describe('ProcessQueue - bookkeeping', () => {
  beforeEach(() => { jest.useFakeTimers() })
  afterEach(() => { jest.useRealTimers() })

  // Every per-item map must be empty once no item is queued, in flight or awaiting a retry
  const internalSizes = (queue: ProcessQueue<TestItem>) => queue._bookkeepingSizes()
  const allZero = {
    enqueuedAt: 0, arrivals: 0, processingStartedAt: 0, activeRuns: 0, retryCount: 0, pendingRetries: 0, inProcess: 0
  }

  test('processBatch skips expired items', () => {
    const expired = jest.fn()
    const queue = new ProcessQueue<TestItem>({ ttl: 100 })
    queue.on('expired', expired)
    queue.queueItem({ id: 'a' })
    jest.advanceTimersByTime(150)
    expect(queue.processBatch(10)).toEqual([])
    expect(expired).toHaveBeenCalledWith({ id: 'a' }, undefined)
  })

  test('processBatch items are subject to the processing timeout', () => {
    const timeout = jest.fn()
    const queue = new ProcessQueue<TestItem>({ processingTimeout: 100 })
    queue.on('timeout', timeout)
    queue.queueItem({ id: 'a' })
    queue.processBatch(10)
    jest.advanceTimersByTime(150)
    queue.checkProcessingTimeouts()
    expect(queue.processSize()).toBe(0)
    expect(timeout).toHaveBeenCalledWith({ id: 'a' }, undefined)
  })

  test('manual lifecycle leaves no bookkeeping behind', () => {
    const queue = new ProcessQueue<TestItem>({ ttl: 1000, processingTimeout: 1000, maxSize: 2, overflowStrategy: 'drop-oldest' })
    queue.queueMany([{ id: 'a' }, { id: 'b' }, { id: 'c' }]) // evicts a
    queue.processBatch(1)
    queue.removeFromQueue(queue.peek()!.id)
    queue.doneProcessing()
    queue.queueMany([{ id: 'd' }, { id: 'e' }])
    queue.doneProcessing(queue.getNextItem()!.id)
    jest.advanceTimersByTime(2000)
    expect(queue.getNextItem()).toBeNull() // e expires
    queue.queueItem({ id: 'f' })
    queue.getNextItem()
    jest.advanceTimersByTime(2000)
    queue.checkProcessingTimeouts() // f times out
    expect(internalSizes(queue)).toEqual(allZero)
  })

  test('worker lifecycle leaves no bookkeeping behind', async () => {
    jest.useRealTimers()
    let calls = 0
    const queue = new ProcessQueue<TestItem>({
      ttl: 1000,
      processingTimeout: 1000,
      maxRetries: 1,
      retryDelay: 5,
      worker: async item => { calls++; if (item.id !== 'ok') throw new Error('work') }
    })
    queue.queueMany([{ id: 'ok' }, { id: 'fails' }])
    await flush(50)
    expect(calls).toBe(3)
    expect(internalSizes(queue)).toEqual(allZero)
  })
})

describe('ProcessQueue - option validation', () => {
  const make = (options: Record<string, unknown>) => () => new ProcessQueue<TestItem>(options as any)

  test.each([
    ['maxSize', [0, -1, 1.5, NaN]],
    ['concurrency', [0, -1, 1.5, NaN]],
    ['maxRetries', [-1, 1.5, NaN, Infinity]],
    ['maxDeadLetterSize', [-1, 1.5, NaN]],
    ['ttl', [-1, NaN, Infinity]],
    ['processingTimeout', [-1, NaN, Infinity]],
    ['retryDelay', [-1, NaN, Infinity]],
  ])('%s rejects invalid numbers', (name, values) => {
    for (const value of values as number[]) {
      expect(make({ [name]: value })).toThrow(RangeError)
    }
  })

  test.each([
    ['maxSize', [1, 50, Infinity]],
    ['concurrency', [1, 4, Infinity]],
    ['maxRetries', [0, 3]],
    ['maxDeadLetterSize', [0, 10, Infinity]],
    ['ttl', [0, 100]],
    ['processingTimeout', [0, 100]],
    ['retryDelay', [0, 100]],
  ])('%s accepts valid numbers', (name, values) => {
    for (const value of values as number[]) {
      expect(make({ [name]: value })).not.toThrow()
    }
  })

  test.each(['worker', 'comparator', 'retryDelay', 'onListenerError'])('%s must be a function when given', name => {
    expect(make({ [name]: 'not a function' })).toThrow(TypeError)
  })

  test('overflowStrategy must be a known strategy', () => {
    expect(make({ overflowStrategy: 'drop-everything' })).toThrow(TypeError)
  })

  test('the positional constructor validates maxSize', () => {
    expect(() => new ProcessQueue<TestItem>(false, NaN)).toThrow(RangeError)
    expect(() => new ProcessQueue<TestItem>(true, 0)).toThrow(RangeError)
    expect(() => new ProcessQueue<TestItem>(true, 5)).not.toThrow()
  })
})

describe('ProcessQueue - item ids', () => {
  test('NaN is rejected as an id', () => {
    const queue = new ProcessQueue<{ id: number }>()
    expect(() => queue.queueItem({ id: NaN })).toThrow('Invalid queue item')
    expect(queue.length()).toBe(0)
  })

  test.each([0, -1, 1.5, Infinity, 'x'])('%p is accepted as an id', id => {
    const queue = new ProcessQueue<{ id: string | number }>()
    expect(queue.queueItem({ id })).toBe(true)
  })

  test.each([null, undefined, 'a', 5])('queueItem(%p) is rejected as an invalid item', item => {
    const queue = new ProcessQueue<any>()
    expect(() => queue.queueItem(item)).toThrow('Invalid queue item')
  })

  test.each([undefined, null, '', {}, true])('%p is rejected as an id', id => {
    const queue = new ProcessQueue<any>()
    expect(() => queue.queueItem({ id })).toThrow('Invalid queue item')
  })
})

describe('ProcessQueue - deserialize', () => {
  const restore = (data: unknown, options?: object) => () => ProcessQueue.deserialize<TestItem>(data as any, options as any)

  test.each([
    ['null data', null],
    ['a string', 'queue'],
    ['a missing queue', {}],
    ['a non-array queue', { queue: {} }],
    ['a non-array inProcess', { queue: [], inProcess: 'x' }],
    ['a non-array deadLetterQueue', { queue: [], deadLetterQueue: {} }],
  ])('rejects %s', (_label, data) => {
    expect(restore(data)).toThrow(TypeError)
  })

  test.each([
    ['queue', { queue: [{ id: 'a' }, {}] }],
    ['inProcess', { queue: [], inProcess: [null] }],
    ['deadLetterQueue', { queue: [], deadLetterQueue: [{ id: NaN }] }],
  ])('rejects an invalid item in %s', (_label, data) => {
    expect(restore(data)).toThrow(TypeError)
  })

  test('rejects duplicate ids in queue', () => {
    expect(restore({ queue: [{ id: 'a' }, { id: 'a' }] })).toThrow(TypeError)
  })

  test('rejects an id that is both queued and in-process', () => {
    expect(restore({ queue: [{ id: 'a' }], inProcess: [{ id: 'a' }] })).toThrow(TypeError)
  })

  test('allows repeated ids in the dead letter queue', () => {
    const queue = restore({ queue: [], deadLetterQueue: [{ id: 'a' }, { id: 'a' }] })()
    expect(queue.getDeadLetterQueue().length).toBe(2)
  })

  test('rejects a queue larger than maxSize', () => {
    const queue = Array.from({ length: 11 }, (_, i) => ({ id: `i${i}` }))
    expect(restore({ queue }, { maxSize: 10 })).toThrow(RangeError)
    expect(restore({ queue: queue.slice(1) }, { maxSize: 10 })).not.toThrow()
  })

  test('keeps only the newest maxDeadLetterSize dead letters', () => {
    const queue = restore({ queue: [], deadLetterQueue: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] }, { maxDeadLetterSize: 2 })()
    expect(queue.getDeadLetterQueue().map(i => i.id)).toEqual(['b', 'c'])
  })

  describe('with fake timers', () => {
    beforeEach(() => { jest.useFakeTimers() })
    afterEach(() => { jest.useRealTimers() })

    test('restored items are subject to the TTL', () => {
      const queue = restore({ queue: [{ id: 'a' }] }, { ttl: 100 })()
      jest.advanceTimersByTime(150)
      expect(queue.getNextItem()).toBeNull()
    })

    test('restored in-process items are subject to the processing timeout', () => {
      const queue = restore({ queue: [], inProcess: [{ id: 'a' }] }, { processingTimeout: 100 })()
      jest.advanceTimersByTime(150)
      queue.checkProcessingTimeouts()
      expect(queue.processSize()).toBe(0)
    })
  })

  test.each([
    ['default mode', {}, ['a', 'c']],
    ['emplace mode', { emplace: true }, ['b', 'c']],
  ])('drop-oldest after a restore evicts the earliest arrival (%s)', (_label, options, expected) => {
    // Default mode queues newest-first, so 'a' is the newest; emplace queues oldest-first
    const queue = restore({ queue: [{ id: 'a' }, { id: 'b' }] }, { ...options, maxSize: 2, overflowStrategy: 'drop-oldest' })()
    queue.queueItem({ id: 'c' })
    expect(queue.getQueue().map(i => i.id).sort()).toEqual(expected)
  })

  describe('with a worker', () => {
    test('interrupted in-process items are queued again at the front and run on start()', async () => {
      const processed: string[] = []
      const queue = restore(
        { queue: [{ id: 'q' }], inProcess: [{ id: 'p' }] },
        { emplace: true, worker: async (item: TestItem) => { processed.push(item.id) } }
      )()
      expect(queue.processSize()).toBe(0)
      expect(queue.getQueue().map(i => i.id)).toEqual(['p', 'q'])
      expect(processed).toEqual([])
      queue.start()
      await flush()
      expect(processed).toEqual(['p', 'q'])
    })

    test('rejects more in-process items than the concurrency allows', () => {
      const data = { queue: [], inProcess: [{ id: 'a' }, { id: 'b' }] }
      expect(restore(data, { worker: () => {}, concurrency: 1 })).toThrow(RangeError)
      expect(restore(data, { worker: () => {}, concurrency: 2 })).not.toThrow()
    })
  })
})

describe('ProcessQueue - review pass 1', () => {
  test.each([
    ['doneProcessing(id)', (queue: ProcessQueue<TestItem>) => queue.doneProcessing('a')],
    ['doneProcessing([id])', (queue: ProcessQueue<TestItem>) => queue.doneProcessing(['a'])],
    ['doneProcessing()', (queue: ProcessQueue<TestItem>) => queue.doneProcessing()],
  ])('%s on a worker run starts the next queued item', (_label, release) => {
    const started: string[] = []
    const queue = new ProcessQueue<TestItem>({ worker: item => new Promise<void>(() => { started.push(item.id) }) })
    queue.queueItem({ id: 'a' })
    queue.queueItem({ id: 'b' })
    expect(started).toEqual(['a'])
    release(queue)
    expect(started).toEqual(['a', 'b'])
  })

  test.each([0, 20])('an "error" listener that re-queues the id does not create a duplicate (retryDelay %p)', async (retryDelay) => {
    const seen: string[] = []
    let failed = false
    const queue = new ProcessQueue<TestItem>({
      worker: async item => { seen.push(item.value ?? item.id); if (!failed) { failed = true; throw new Error('work') } },
      maxRetries: 1,
      retryDelay
    })
    queue.once('error', () => { queue.queueItem({ id: 'a', value: 'requeued' }) })
    queue.queueItem({ id: 'a', value: 'orig' })
    await flush(60)
    expect(seen.length).toBe(2)
    expect(queue.isEmpty()).toBe(true)
  })
})

describe('ProcessQueue - review pass 2', () => {
  silenceConsoleError()

  test('a "removed" listener that queues during a drop-oldest eviction cannot create a duplicate', () => {
    const queue = new ProcessQueue<TestItem>({ maxSize: 1, overflowStrategy: 'drop-oldest' })
    queue.queueItem({ id: 'a' })
    queue.once('removed', () => { queue.queueItem({ id: 'b', value: 'inner' }) })
    queue.queueItem({ id: 'b', value: 'outer' })
    expect(queue.getQueue().filter(i => i.id === 'b').length).toBe(1)
    expect(queue.length()).toBe(1)
  })

  test('pause() from a "done" listener stops a synchronous worker loop', () => {
    const processed: string[] = []
    const queue = new ProcessQueue<TestItem>({ emplace: true, worker: item => { processed.push(item.id) } })
    queue.once('done', () => queue.pause())
    queue.pause()
    queue.queueMany([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    queue.resume()
    expect(processed).toEqual(['a'])
    expect(queue.length()).toBe(2)
  })

  test('pause() from a "processing" listener stops further starts', () => {
    const started: string[] = []
    const queue = new ProcessQueue<TestItem>({ concurrency: 3, worker: item => new Promise<void>(() => { started.push(item.id) }) })
    queue.once('processing', () => queue.pause())
    queue.pause()
    queue.queueMany([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
    queue.resume()
    expect(started.length).toBe(1)
  })

  test('a run released by a "processing" listener does not invoke the worker', () => {
    const started: string[] = []
    const queue = new ProcessQueue<TestItem>({
      concurrency: 2,
      worker: item => new Promise<void>(() => { started.push(item.value ?? item.id) })
    })
    queue.once('processing', item => {
      queue.clear()
      queue.queueItem({ id: (item as TestItem).id, value: 'requeued' })
    })
    queue.queueItem({ id: 'a', value: 'orig' })
    expect(started).toEqual(['requeued'])
    expect(queue.processSize()).toBe(1)
  })

  describe('retry counts end with the item', () => {
    // Leaves item 'a' queued after one failed attempt, with the queue paused
    // Call hang() to make later runs never settle
    const failOnceThenPause = async (options: object = {}) => {
      const attempts: string[] = []
      let hanging = false
      const queue = new ProcessQueue<TestItem>({
        ...options,
        maxRetries: 2,
        worker: item => {
          attempts.push(item.id)
          return hanging ? new Promise<void>(() => {}) : Promise.reject(new Error('work'))
        }
      })
      queue.once('error', () => queue.pause())
      queue.queueItem({ id: 'a' })
      await flush(5)
      expect(queue.has('a')).toBe(true)
      const retryCounts = () => queue._bookkeepingSizes().retryCount
      return { queue, attempts, retryCounts, hang: () => { hanging = true } }
    }

    test('removeFromQueue clears the count, so a fresh item gets its full retry budget', async () => {
      const { queue, attempts, retryCounts } = await failOnceThenPause()
      queue.removeFromQueue('a')
      expect(retryCounts()).toBe(0)
      attempts.length = 0
      queue.queueItem({ id: 'a' })
      queue.resume()
      await flush()
      expect(attempts).toEqual(['a', 'a', 'a'])
    })

    test('a drop-oldest eviction clears the count', async () => {
      const { queue, retryCounts } = await failOnceThenPause({ maxSize: 1, overflowStrategy: 'drop-oldest' })
      queue.queueItem({ id: 'b' })
      expect(retryCounts()).toBe(0)
    })

    test.each([
      ['doneProcessing(id)', (queue: ProcessQueue<TestItem>) => queue.doneProcessing('a')],
      ['doneProcessing()', (queue: ProcessQueue<TestItem>) => queue.doneProcessing()],
    ])('%s on a retried run clears the count', async (_label, release) => {
      const { queue, retryCounts, hang } = await failOnceThenPause()
      hang()
      queue.resume()
      expect(queue.isProcessing('a')).toBe(true)
      release(queue)
      expect(retryCounts()).toBe(0)
    })

    test('a processing timeout on a retried run clears the count', async () => {
      const { queue, retryCounts, hang } = await failOnceThenPause({ processingTimeout: 1 })
      hang()
      queue.resume()
      await flush(5)
      queue.checkProcessingTimeouts()
      expect(retryCounts()).toBe(0)
    })
  })

  describe('retries with a comparator', () => {
    type PItem = { id: string; p: number }
    const byPriority = (a: PItem, b: PItem) => b.p - a.p

    test('a retried item is re-inserted in priority order', async () => {
      const order: string[] = []
      let failedA = false
      const queue = new ProcessQueue<PItem>({
        comparator: byPriority,
        maxRetries: 1,
        worker: async item => {
          order.push(item.id)
          await flush(0)
          if (item.id === 'a' && !failedA) { failedA = true; throw new Error('work') }
        }
      })
      // Wait for the work to finish rather than a fixed time: timer resolution varies by platform
      const drained = new Promise<void>(resolve => queue.once('drain', () => resolve()))
      queue.queueItem({ id: 'a', p: 1 })
      queue.queueMany([{ id: 'b', p: 5 }, { id: 'c', p: 3 }])
      await drained
      expect(order).toEqual(['a', 'b', 'c', 'a'])
    })

    test('a comparator that throws during a retry dead-letters the item', async () => {
      let comparatorFails = false
      const failed = jest.fn()
      const queue = new ProcessQueue<PItem>({
        comparator: (a, b) => { if (comparatorFails) throw new Error('cmp'); return byPriority(a, b) },
        maxRetries: 1,
        retryDelay: 5,
        worker: async () => { throw new Error('work') }
      })
      queue.on('failed', failed)
      queue.queueItem({ id: 'a', p: 1 })
      queue.pause()
      queue.queueItem({ id: 'b', p: 5 })
      comparatorFails = true
      await flush(30)
      expect(failed).toHaveBeenCalledWith({ id: 'a', p: 1 }, expect.objectContaining({ message: 'cmp' }))
      expect(queue.getQueue()).toEqual([{ id: 'b', p: 5 }])
    })
  })

  test.each([2 ** 31, Infinity])('a retryDelay of %p waits instead of retrying almost immediately', async (delay) => {
    let attempts = 0
    const queue = new ProcessQueue<TestItem>({
      maxRetries: 1,
      retryDelay: () => delay,
      worker: async () => { attempts++; throw new Error('work') }
    })
    queue.queueItem({ id: 'a' })
    await flush(30)
    expect(attempts).toBe(1)
    queue.clear() // cancel the long timer
  })

  describe('a throwing comparator leaves the queue unchanged', () => {
    type PItem = { id: string; p: number }
    const setup = (options: object) => {
      let fail = false
      const queue = new ProcessQueue<PItem>({
        ...options,
        comparator: (a, b) => { if (fail) throw new Error('cmp'); return a.p - b.p }
      })
      queue.queueMany([{ id: 'a', p: 1 }, { id: 'b', p: 2 }])
      fail = true
      return queue
    }

    test('when updating a queued item', () => {
      const queue = setup({})
      expect(() => queue.queueItem({ id: 'b', p: 0 })).toThrow('cmp')
      expect(queue.getQueue()).toEqual([{ id: 'a', p: 1 }, { id: 'b', p: 2 }])
    })

    test('when the queue overflows with drop-oldest', () => {
      const removed = jest.fn()
      const queue = setup({ maxSize: 2, overflowStrategy: 'drop-oldest' })
      queue.on('removed', removed)
      expect(() => queue.queueItem({ id: 'c', p: 3 })).toThrow('cmp')
      expect(queue.getQueue()).toEqual([{ id: 'a', p: 1 }, { id: 'b', p: 2 }])
      expect(removed).not.toHaveBeenCalled()
      // arrival order survives: the next overflow still evicts the earliest arrival
      expect(queue._bookkeepingSizes().arrivals).toBe(2)
    })
  })

  test('a worker returning a thenable whose then() throws is treated as a failure', async () => {
    const queue = new ProcessQueue<TestItem>({
      worker: (() => ({ then() { throw new Error('then') } })) as any
    })
    expect(() => queue.queueItem({ id: 'a' })).not.toThrow()
    await flush()
    expect(queue.busy()).toBe(false)
    expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
  })

  describe('with fake timers', () => {
    beforeEach(() => { jest.useFakeTimers() })
    afterEach(() => { jest.useRealTimers() })

    test('an "expired" listener that clears the queue does not crash expiry', () => {
      const queue = new ProcessQueue<TestItem>({ ttl: 10 })
      queue.queueMany([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      jest.advanceTimersByTime(20)
      queue.on('expired', () => queue.clear())
      expect(() => queue.getNextItem()).not.toThrow()
      expect(queue.isEmpty()).toBe(true)
    })

    test('an "expired" listener that queues an item does not make expiry skip items', () => {
      const expired: string[] = []
      const queue = new ProcessQueue<TestItem>({ ttl: 10 })
      queue.queueMany([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      jest.advanceTimersByTime(20)
      queue.on('expired', item => {
        expired.push((item as TestItem).id)
        if (expired.length === 1) queue.queueItem({ id: 'fresh' })
      })
      expect(queue.getNextItem()).toEqual({ id: 'fresh' })
      expect(expired.sort()).toEqual(['a', 'b', 'c'])
    })
  })
})

describe('ProcessQueue - review pass 3', () => {
  silenceConsoleError()

  test.each([0, 1])('doneProcessing(id) from an "error" listener does not reset the retry budget (retryDelay %p)', async (retryDelay) => {
    let runs = 0
    const queue: ProcessQueue<TestItem> = new ProcessQueue<TestItem>({
      maxRetries: 2,
      retryDelay,
      // stop() bounds the loop so a regression cannot hang the test run
      worker: async () => { if (++runs >= 10) queue.stop(); throw new Error('work') }
    })
    queue.on('error', item => queue.doneProcessing((item as TestItem).id))
    // Wait for dead-lettering rather than a fixed time (timer resolution varies); the fallback bounds a regression
    const failed = new Promise<void>(resolve => queue.once('failed', () => resolve()))
    queue.queueItem({ id: 'a' })
    await Promise.race([failed, flush(1000)])
    expect(runs).toBe(3)
    expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
  })

  test.each([
    ['sync', () => { throw new Error('work') }],
    ['async', async () => { throw new Error('work') }],
  ])('a retryDelay returning a non-number dead-letters the item (%s worker)', async (_label, worker) => {
    const queue = new ProcessQueue<TestItem>({ maxRetries: 1, retryDelay: (() => Symbol('delay')) as any, worker })
    expect(() => queue.queueItem({ id: 'a' })).not.toThrow()
    await flush()
    expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
    expect(queue._bookkeepingSizes().retryCount).toBe(0)
  })

  test('a worker result whose then getter throws is treated as a failure', async () => {
    const queue = new ProcessQueue<TestItem>({
      worker: (() => ({ get then() { throw new Error('getter') } })) as any
    })
    expect(() => queue.queueItem({ id: 'a' })).not.toThrow()
    await flush()
    expect(queue.busy()).toBe(false)
    expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
  })

  test('a snapshot taken while a retry is pending round-trips with the same options', async () => {
    const options = { worker: async () => { throw new Error('work') }, maxSize: 2, maxRetries: 1, retryDelay: 1000 }
    const queue = new ProcessQueue<TestItem>(options)
    queue.queueItem({ id: 'a' })
    queue.pause()
    queue.queueMany([{ id: 'b' }, { id: 'c' }])
    await flush()
    const snapshot = queue.serialize()
    queue.clear()
    expect(snapshot.queue.length).toBe(3)
    const restored = ProcessQueue.deserialize<TestItem>(snapshot, options)
    expect(restored.getQueue().map(i => i.id).sort()).toEqual(['a', 'b', 'c'])
  })

  test('deserialize still bounds a worker queue at maxSize plus concurrency', () => {
    const queue = Array.from({ length: 5 }, (_, i) => ({ id: `i${i}` }))
    const options = { worker: () => {}, maxSize: 2, concurrency: 2 }
    expect(() => ProcessQueue.deserialize<TestItem>({ queue: queue.slice(0, 4) }, options)).not.toThrow()
    expect(() => ProcessQueue.deserialize<TestItem>({ queue }, options)).toThrow(RangeError)
  })

  describe('a listener that re-queues the id gets a fresh retry budget', () => {
    test('from the last "error" before dead-lettering', async () => {
      let runs = 0
      const queue: ProcessQueue<TestItem> = new ProcessQueue<TestItem>({
        maxRetries: 1,
        worker: (() => {
          if (++runs >= 10) queue.stop()
          // Two async failures exhaust the budget; the re-queued item then fails synchronously
          if (runs <= 2) return Promise.reject(new Error('work'))
          throw new Error('work')
        }) as any
      })
      queue.on('error', () => { if (runs === 2) queue.queueItem({ id: 'a' }) })
      queue.queueItem({ id: 'a' })
      await flush(30)
      expect(runs).toBe(4)
      expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }, { id: 'a' }])
    })

    test('from "done"', async () => {
      let runs = 0
      const queue: ProcessQueue<TestItem> = new ProcessQueue<TestItem>({
        maxRetries: 1,
        retryDelay: 5,
        worker: (() => {
          if (++runs >= 10) queue.stop()
          if (runs === 1) return Promise.resolve()
          throw new Error('work')
        }) as any
      })
      queue.once('done', () => { queue.queueItem({ id: 'a' }) })
      queue.queueItem({ id: 'a' })
      await flush(50)
      expect(runs).toBe(3)
      expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a' }])
    })
  })
})

describe('ProcessQueue - refactor review pass 2', () => {
  silenceConsoleError()

  test('callback options are called without a this binding', async () => {
    const seen: Record<string, unknown> = {}
    type PItem = { id: string; p: number }
    const queue = new ProcessQueue<PItem>({
      worker: function (this: unknown) { seen.worker = this; throw new Error('work') },
      comparator: function (this: unknown, a, b) { seen.comparator = this; return a.p - b.p },
      retryDelay: function (this: unknown) { seen.retryDelay = this; return 0 },
      onListenerError: function (this: unknown) { seen.onListenerError = this },
      maxRetries: 1
    })
    queue.on('added', () => { throw new Error('listener') })
    queue.pause()
    queue.queueMany([{ id: 'a', p: 1 }, { id: 'b', p: 2 }])
    queue.resume()
    await flush()
    expect(Object.keys(seen).sort()).toEqual(['comparator', 'onListenerError', 'retryDelay', 'worker'])
    expect(seen).toEqual({ worker: undefined, comparator: undefined, retryDelay: undefined, onListenerError: undefined })
  })

  test('a worker-mode snapshot is bounded by maxSize plus concurrency across queue and inProcess', () => {
    const items = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => ({ id: `${prefix}${i}` }))
    const options = { worker: () => {}, maxSize: 1, concurrency: 2 }
    expect(() => ProcessQueue.deserialize<TestItem>({ queue: items('q', 1), inProcess: items('p', 2) }, options)).not.toThrow()
    expect(() => ProcessQueue.deserialize<TestItem>({ queue: items('q', 3), inProcess: items('p', 2) }, options)).toThrow(RangeError)
  })

  test.each([
    ['retries exhausted', { maxRetries: 0 }],
    ['retryDelay throws', { maxRetries: 1, retryDelay: () => { throw new Error('delay') } }],
  ])('the item is in the dead letter queue before "error" fires on its final failure (%s)', async (_label, options) => {
    const snapshots: ReturnType<ProcessQueue<TestItem>['serialize']>[] = []
    const queue: ProcessQueue<TestItem> = new ProcessQueue<TestItem>({ ...options, worker: async () => { throw new Error('work') } })
    queue.on('error', () => { snapshots.push(queue.serialize()) })
    queue.queueItem({ id: 'a' })
    await flush()
    expect(snapshots.map(snapshot => snapshot.deadLetterQueue)).toEqual([[{ id: 'a' }]])
  })
})

describe('ProcessQueue - refactor review pass 3', () => {
  silenceConsoleError()

  test('a delayed retry frees its concurrency slot for the next queued item', async () => {
    const started: string[] = []
    const queue = new ProcessQueue<TestItem>({
      maxRetries: 1,
      retryDelay: 1000,
      worker: async item => { started.push(item.id); if (item.id === 'a') throw new Error('work') }
    })
    queue.queueItem({ id: 'a' })
    queue.queueItem({ id: 'b' })
    await flush()
    expect(started).toEqual(['a', 'b'])
    queue.clear() // cancel the pending retry timer
  })

  describe('pending retries count toward maxSize', () => {
    // Items a and b fail and wait out a long retry delay, filling a queue of size 2
    const fillWithPendingRetries = async (overflowStrategy: 'reject' | 'drop-oldest' | 'drop-newest') => {
      const options = {
        maxSize: 2, maxRetries: 1, retryDelay: 1000, overflowStrategy,
        worker: async (item: TestItem) => { if (item.id !== 'ok') throw new Error('work') }
      }
      const queue = new ProcessQueue<TestItem>(options)
      queue.queueItem({ id: 'a' })
      await flush(5)
      queue.queueItem({ id: 'b' })
      await flush(5)
      expect(queue._bookkeepingSizes().pendingRetries).toBe(2)
      return { queue, options }
    }

    test('reject throws for a new item', async () => {
      const { queue } = await fillWithPendingRetries('reject')
      expect(() => queue.queueItem({ id: 'ok' })).toThrow('Queue size limit reached')
      queue.clear()
    })

    test.each(['drop-newest', 'drop-oldest'] as const)('%s drops the new item when only pending retries fill the queue', async (strategy) => {
      const { queue } = await fillWithPendingRetries(strategy)
      expect(queue.queueItem({ id: 'ok' })).toBe(false)
      expect(queue.serialize().queue.length).toBe(2)
      queue.clear()
    })

    test('a snapshot taken while retries are pending round-trips with the same options', async () => {
      const { queue, options } = await fillWithPendingRetries('drop-newest')
      queue.queueItem({ id: 'ok' })
      expect(() => ProcessQueue.deserialize<TestItem>(queue.serialize(), options)).not.toThrow()
      queue.clear()
    })
  })

  test.each([0, 5])('a failed item whose id the worker changed is dead-lettered, not retried (retryDelay %p)', async (retryDelay) => {
    let runs = 0
    const failed = jest.fn()
    const queue: ProcessQueue<TestItem> = new ProcessQueue<TestItem>({
      maxRetries: 2,
      retryDelay,
      // stop() bounds the loop so a regression cannot hang the test run
      worker: item => { if (++runs >= 10) queue.stop(); item.id += '!'; throw new Error('work') }
    })
    queue.on('failed', failed)
    queue.queueItem({ id: 'a' })
    await flush(30)
    expect(runs).toBe(1)
    expect(queue.getDeadLetterQueue()).toEqual([{ id: 'a!' }])
    expect(failed).toHaveBeenCalledWith({ id: 'a!' }, expect.objectContaining({ message: expect.stringContaining('changed') }))
    expect(queue._bookkeepingSizes().retryCount).toBe(0)
  })
})

describe('ProcessQueue - README review', () => {
  type Typed = { id: number; type?: string }

  test('length(prop, val) filters even when the first item lacks the property', () => {
    const queue = new ProcessQueue<Typed>({ emplace: true })
    queue.queueMany([{ id: 1 }, { id: 2, type: 'a' }, { id: 3, type: 'b' }])
    expect(queue.length('type', 'a')).toBe(1)
    expect(queue.length('type', 'c')).toBe(0)
    expect(queue.length('type')).toBe(3)
    expect(queue.length()).toBe(3)
  })

  describe('"empty" fires only when the queue becomes empty', () => {
    const track = (queue: ProcessQueue<any>) => {
      const empty = jest.fn()
      queue.on('empty', empty)
      return empty
    }

    test('not while the queue stays empty', () => {
      const queue = new ProcessQueue<TestItem>()
      const empty = track(queue)
      queue.doneProcessing()
      queue.doneProcessing('x')
      queue.removeFromQueue('x')
      queue.getNextItem()
      queue.processBatch(5)
      queue.clear()
      expect(empty).not.toHaveBeenCalled()
    })

    test('once each time the queue empties', () => {
      const queue = new ProcessQueue<TestItem>()
      const empty = track(queue)
      queue.queueMany([{ id: 'a' }, { id: 'b' }])
      queue.getNextItem()
      expect(empty).not.toHaveBeenCalled()
      queue.getNextItem()
      queue.doneProcessing()
      expect(empty).toHaveBeenCalledTimes(1)
      queue.queueItem({ id: 'c' })
      queue.removeFromQueue('c')
      expect(empty).toHaveBeenCalledTimes(2)
      queue.queueItem({ id: 'd' })
      queue.clear()
      expect(empty).toHaveBeenCalledTimes(3)
    })

    test('when expiry empties the queue', () => {
      jest.useFakeTimers()
      try {
        const queue = new ProcessQueue<TestItem>({ ttl: 10 })
        const empty = track(queue)
        queue.queueItem({ id: 'a' })
        jest.advanceTimersByTime(20)
        expect(queue.getNextItem()).toBeNull()
        expect(empty).toHaveBeenCalledTimes(1)
      } finally {
        jest.useRealTimers()
      }
    })

    test('when the worker takes the last item, not again when it finishes', () => {
      const { runs, worker } = controlledWorker<TestItem>()
      const queue = new ProcessQueue<TestItem>({ worker })
      const empty = track(queue)
      queue.queueItem({ id: 'a' })
      expect(empty).toHaveBeenCalledTimes(1)
      runs[0].resolve()
      return flush(0).then(() => expect(empty).toHaveBeenCalledTimes(1))
    })

    test('an "empty" listener that calls back into the queue does not cause a second "empty"', () => {
      const queue = new ProcessQueue<TestItem>()
      const empty = jest.fn(() => queue.doneProcessing())
      queue.on('empty', empty)
      queue.queueItem({ id: 'a' })
      queue.getNextItem()
      expect(empty).toHaveBeenCalledTimes(1)
    })

    test('a run released by an "empty" listener does not invoke the worker', () => {
      const started: string[] = []
      const queue = new ProcessQueue<TestItem>({ worker: item => new Promise<void>(() => { started.push(item.id) }) })
      queue.once('empty', () => queue.clear())
      queue.queueItem({ id: 'a' })
      expect(started).toEqual([])
    })

    describe('with fake timers', () => {
      beforeEach(() => { jest.useFakeTimers() })
      afterEach(() => { jest.useRealTimers() })

      test('expiry that leaves the queue idle emits "drain" (manual mode)', () => {
        const events: string[] = []
        const queue = new ProcessQueue<TestItem>({ ttl: 10 })
        ;(['expired', 'empty', 'drain'] as const).forEach(event => queue.on(event, () => events.push(event)))
        queue.queueItem({ id: 'a' })
        jest.advanceTimersByTime(20)
        queue.getNextItem()
        expect(events).toEqual(['expired', 'empty', 'drain'])
      })

      test('expiry that leaves the queue idle emits "drain" (worker mode)', async () => {
        const { runs, worker } = controlledWorker<TestItem>()
        const drain = jest.fn()
        const queue = new ProcessQueue<TestItem>({ ttl: 10, worker })
        queue.queueItem({ id: 'a' })
        queue.queueItem({ id: 'b' })
        queue.on('drain', drain)
        jest.advanceTimersByTime(20)
        runs[0].resolve()
        await Promise.resolve()
        await Promise.resolve()
        expect(queue.length()).toBe(0)
        expect(queue.busy()).toBe(false)
        expect(drain).toHaveBeenCalledTimes(1)
      })
    })

    test('a queue restored with items emits "empty" when it empties', () => {
      const queue = ProcessQueue.deserialize<TestItem>({ queue: [{ id: 'a' }] })
      const empty = jest.fn()
      queue.on('empty', empty)
      queue.getNextItem()
      expect(empty).toHaveBeenCalledTimes(1)
    })

    test('"empty" fires again when a retry is taken', () => {
      const events: string[] = []
      let failures = 0
      const queue = new ProcessQueue<TestItem>({ maxRetries: 1, worker: () => { if (++failures === 1) throw new Error('work') } })
      ;(['processing', 'empty', 'error', 'done', 'drain'] as const).forEach(event => queue.on(event, () => events.push(event)))
      queue.queueItem({ id: 'a' })
      expect(events).toEqual(['processing', 'empty', 'error', 'processing', 'empty', 'done', 'drain'])
    })

    test('removing a pending retry emits "removed" and "drain" but not "empty"', async () => {
      const events: string[] = []
      const queue = new ProcessQueue<TestItem>({ maxRetries: 1, retryDelay: 1000, worker: async () => { throw new Error('work') } })
      queue.queueItem({ id: 'a' })
      await flush(5)
      ;(['removed', 'empty', 'drain'] as const).forEach(event => queue.on(event, () => events.push(event)))
      queue.removeFromQueue('a')
      expect(events).toEqual(['removed', 'drain'])
    })

    test('processBatch and getQueue(true) emit "empty" when they empty the queue', () => {
      const queue = new ProcessQueue<TestItem>()
      const empty = jest.fn()
      queue.on('empty', empty)
      queue.queueMany([{ id: 'a' }, { id: 'b' }])
      queue.processBatch(1)
      expect(empty).not.toHaveBeenCalled()
      queue.processBatch(5)
      expect(empty).toHaveBeenCalledTimes(1)
      queue.queueItem({ id: 'c' })
      queue.getQueue(true)
      expect(empty).toHaveBeenCalledTimes(2)
    })

    test('clear() does not emit "drain" when an "empty" listener refills the queue', () => {
      const queue = new ProcessQueue<TestItem>()
      const drain = jest.fn()
      queue.on('drain', drain)
      queue.queueItem({ id: 'a' })
      queue.once('empty', () => { queue.queueItem({ id: 'b' }) })
      queue.clear()
      expect(queue.length()).toBe(1)
      expect(drain).not.toHaveBeenCalled()
    })
  })
})

describe('ProcessQueue - drain once per idle period', () => {
  const trackDrain = (queue: ProcessQueue<any>) => {
    const drain = jest.fn()
    queue.on('drain', drain)
    return drain
  }

  test('is not emitted by calls on an idle queue', () => {
    const queue = new ProcessQueue<TestItem>({ processingTimeout: 1000 })
    const drain = trackDrain(queue)
    queue.checkProcessingTimeouts()
    queue.checkProcessingTimeouts()
    queue.doneProcessing()
    queue.doneProcessing('missing')
    queue.clear()
    expect(drain).not.toHaveBeenCalled()
  })

  test('is emitted once each time work finishes', () => {
    const queue = new ProcessQueue<TestItem>()
    const drain = trackDrain(queue)
    queue.queueItem({ id: 'a' })
    queue.doneProcessing(queue.getNextItem()!.id)
    queue.doneProcessing()
    expect(drain).toHaveBeenCalledTimes(1)
    queue.queueItem({ id: 'b' })
    queue.clear()
    queue.clear()
    expect(drain).toHaveBeenCalledTimes(2)
  })

  test('is emitted once when a listener refills the queue under a synchronous worker', () => {
    const queue = new ProcessQueue<TestItem>({ worker: () => {} })
    const drain = trackDrain(queue)
    queue.pause()
    queue.queueItem({ id: 'a' })
    queue.once('removed', () => { queue.resume(); queue.queueItem({ id: 'b' }) })
    queue.removeFromQueue('a')
    expect(drain).toHaveBeenCalledTimes(1)
  })

  test('a "drain" listener that calls clear() does not trigger itself again', () => {
    const queue = new ProcessQueue<TestItem>()
    const drain = jest.fn(() => queue.clear())
    queue.on('drain', drain)
    queue.queueItem({ id: 'a' })
    queue.clear()
    expect(drain).toHaveBeenCalledTimes(1)
  })

  test('a restored idle queue stays silent', () => {
    const queue = ProcessQueue.deserialize<TestItem>({ queue: [], deadLetterQueue: [{ id: 'x' }] })
    const drain = trackDrain(queue)
    queue.clear()
    queue.doneProcessing()
    expect(drain).not.toHaveBeenCalled()
  })

  test('a queue restored with in-process items (no worker) drains when they are done', () => {
    const queue = ProcessQueue.deserialize<TestItem>({ queue: [], inProcess: [{ id: 'a' }] })
    const drain = trackDrain(queue)
    queue.doneProcessing('a')
    expect(drain).toHaveBeenCalledTimes(1)
  })
})

describe('ProcessQueue - onIdle', () => {
  const settled = (promise: Promise<void>) => {
    let done = false
    promise.then(() => { done = true })
    return () => done
  }

  test('resolves straight away when the queue is idle', async () => {
    await expect(new ProcessQueue<TestItem>().onIdle()).resolves.toBeUndefined()
  })

  test('with a synchronous worker, waits for queued work and resolves once it runs', async () => {
    const queue = new ProcessQueue<TestItem>({ worker: () => {} })
    queue.pause()
    queue.queueItem({ id: 'a' })
    const idle = settled(queue.onIdle())
    await flush(0)
    expect(idle()).toBe(false)
    queue.resume()
    await flush(0)
    expect(idle()).toBe(true)
  })

  test('does not resolve while a "drain" listener has refilled the queue', async () => {
    const { runs, worker } = controlledWorker<TestItem>()
    const queue = new ProcessQueue<TestItem>({ worker })
    queue.queueItem({ id: 'a' })
    const idle = settled(queue.onIdle())
    let refilled = false
    queue.on('drain', () => { if (!refilled) { refilled = true; queue.queueItem({ id: 'b' }) } })
    runs[0].resolve()
    await flush(0)
    expect(queue.processSize()).toBe(1)
    expect(idle()).toBe(false)
    runs[1].resolve()
    await flush(0)
    expect(idle()).toBe(true)
  })

  test('does not resolve while a "drain" listener registered after it has refilled the queue', async () => {
    const { runs, worker } = controlledWorker<TestItem>()
    const queue = new ProcessQueue<TestItem>({ worker })
    queue.queueItem({ id: 'a' })
    const idle = settled(queue.onIdle())
    queue.once('drain', () => { queue.queueItem({ id: 'b' }) })
    runs[0].resolve()
    await flush(0)
    expect(queue.processSize()).toBe(1)
    expect(idle()).toBe(false)
    runs[1].resolve()
    await flush(0)
    expect(idle()).toBe(true)
  })

  test('callers waiting for the same idle period share one promise', () => {
    const { worker } = controlledWorker<TestItem>()
    const queue = new ProcessQueue<TestItem>({ worker })
    queue.queueItem({ id: 'a' })
    const first = queue.onIdle()
    for (let i = 0; i < 1000; i++) void queue.onIdle()
    expect(queue.onIdle()).toBe(first)
  })

  test('a restored worker queue is not idle until its work has run', async () => {
    const drain = jest.fn()
    const queue = ProcessQueue.deserialize<TestItem>({ queue: [{ id: 'q' }], inProcess: [{ id: 'p' }] }, { worker: () => {} })
    queue.on('drain', drain)
    const idle = settled(queue.onIdle())
    await flush(0)
    expect(idle()).toBe(false)
    queue.start()
    await flush(0)
    expect(idle()).toBe(true)
    expect(drain).toHaveBeenCalledTimes(1)
    queue.clear()
    queue.doneProcessing()
    expect(drain).toHaveBeenCalledTimes(1)
  })

  test('waits for in-process work and resolves all waiters when it finishes', async () => {
    const { runs, worker } = controlledWorker<TestItem>()
    const queue = new ProcessQueue<TestItem>({ worker })
    queue.queueItem({ id: 'a' })
    const first = settled(queue.onIdle())
    const second = settled(queue.onIdle())
    await flush(0)
    expect([first(), second()]).toEqual([false, false])
    runs[0].resolve()
    await flush(0)
    expect([first(), second()]).toEqual([true, true])
  })

  test('waits for pending retries', async () => {
    let attempts = 0
    const queue = new ProcessQueue<TestItem>({
      maxRetries: 1,
      retryDelay: 20,
      worker: async () => { if (++attempts === 1) throw new Error('work') }
    })
    queue.queueItem({ id: 'a' })
    const idle = settled(queue.onIdle())
    await flush(5)
    expect(idle()).toBe(false)
    await flush(40)
    expect(attempts).toBe(2)
    expect(idle()).toBe(true)
  })

  test('on a paused queue with items, waits until they are cleared', async () => {
    const queue = new ProcessQueue<TestItem>({ worker: () => {} })
    queue.pause()
    queue.queueItem({ id: 'a' })
    const idle = settled(queue.onIdle())
    await flush(0)
    expect(idle()).toBe(false)
    queue.clear()
    await flush(0)
    expect(idle()).toBe(true)
  })
})
