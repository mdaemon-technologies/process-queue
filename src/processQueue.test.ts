import ProcessQueue from './processQueue'

describe('ProcessQueue', () => {
  let queue: ProcessQueue<{ id: string, value: number }>

  beforeEach(() => {
    queue = new ProcessQueue()
  })

  test('queueItem adds item to empty queue', () => {
    const item = { id: '1', value: 10 }
    expect(queue.queueItem(item)).toBe(true)
    expect(queue.length()).toBe(1)
  })

  test('queueItem does not add item if already processing', () => {
    const item = { id: '1', value: 10 }
    queue.queueItem(item)
    queue.getNextItem()
    expect(queue.queueItem(item)).toBe(false)
    expect(queue.length()).toBe(0)
  })

  test('getNextItem returns and removes item from queue', () => {
    const item = { id: '1', value: 10 }
    queue.queueItem(item)
    expect(queue.getNextItem()).toEqual(item)
    expect(queue.length()).toBe(0)
  })

  test('removeFromQueue removes item from queue', () => {
    const item = { id: '1', value: 10 }
    queue.queueItem(item)
    expect(queue.removeFromQueue('1')).toBe(true)
    expect(queue.length()).toBe(0)
  })

  test('doneProcessing removes item from processing', () => {
    const item = { id: '1', value: 10 }
    queue.queueItem(item)
    queue.getNextItem()
    expect(queue.isProcessing('1')).toBe(true)
    queue.doneProcessing('1')
    expect(queue.isProcessing('1')).toBe(false)
  })

  test('length with property filter', () => {
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    queue.queueItem({ id: '3', value: 10 })
    expect(queue.length('value', 10)).toBe(2)
  })

  test('busy returns true when items are being processed', () => {
    queue.queueItem({ id: '1', value: 10 })
    queue.getNextItem()
    expect(queue.busy()).toBe(true)
  })

  test('processSize returns number of items being processed', () => {
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    queue.getNextItem()
    queue.getNextItem()
    expect(queue.processSize()).toBe(2)
  })

  test('processBatch processes multiple items at once', () => {
      queue.queueItem({ id: '1', value: 10 })
      queue.queueItem({ id: '2', value: 20 })
      queue.queueItem({ id: '3', value: 30 })
      const batch = queue.processBatch(2)
      expect(batch.length).toBe(2)
      expect(queue.length()).toBe(1)
      expect(queue.processSize()).toBe(2)
      expect(queue.isProcessing('3')).toBe(true)
      expect(queue.isProcessing('2')).toBe(true)
      expect(queue.isProcessing('1')).toBe(false)
    })
  
    test('isEmpty returns true when queue is empty', () => {
      expect(queue.isEmpty()).toBe(true)
      queue.queueItem({ id: '1', value: 10 })
      expect(queue.isEmpty()).toBe(false)
      queue.getNextItem()
      expect(queue.isEmpty()).toBe(true)
    })
  
    test('clear removes all items from queue and processing', () => {
      queue.queueItem({ id: '1', value: 10 })
      queue.queueItem({ id: '2', value: 20 })
      queue.getNextItem()
      expect(queue.length()).toBe(1)
      expect(queue.processSize()).toBe(1)
      queue.clear()
      expect(queue.length()).toBe(0)
      expect(queue.processSize()).toBe(0)
      expect(queue.isEmpty()).toBe(true)
      expect(queue.busy()).toBe(false)
    })

    test('peek returns next item without removing it', () => {
      expect(queue.peek()).toBeNull()
      queue.queueItem({ id: '1', value: 10 })
      queue.queueItem({ id: '2', value: 20 })
      expect(queue.peek()).toEqual({ id: '2', value: 20 })
      expect(queue.length()).toBe(2)
    })

    test('has checks if item exists in queue', () => {
      expect(queue.has('1')).toBe(false)
      queue.queueItem({ id: '1', value: 10 })
      expect(queue.has('1')).toBe(true)
      queue.getNextItem()
      expect(queue.has('1')).toBe(false)
    })

    test('getInProcess returns items being processed', () => {
      queue.queueItem({ id: '1', value: 10 })
      queue.queueItem({ id: '2', value: 20 })
      expect(queue.getInProcess()).toEqual([])
      queue.getNextItem()
      expect(queue.getInProcess()).toEqual([{ id: '2', value: 20 }])
      queue.getNextItem()
      expect(queue.getInProcess()).toEqual([{ id: '2', value: 20 }, { id: '1', value: 10 }])
    })

    test('queueMany adds multiple items at once', () => {
      const results = queue.queueMany([
        { id: '1', value: 10 },
        { id: '2', value: 20 },
        { id: '3', value: 30 }
      ])
      expect(results).toEqual([true, true, true])
      expect(queue.length()).toBe(3)
    })

    test('queueMany returns false for items already processing', () => {
      queue.queueItem({ id: '1', value: 10 })
      queue.getNextItem()
      const results = queue.queueMany([
        { id: '1', value: 10 },
        { id: '2', value: 20 }
      ])
      expect(results).toEqual([false, true])
      expect(queue.length()).toBe(1)
    })

    test('doneProcessing accepts array of IDs', () => {
      queue.queueItem({ id: '1', value: 10 })
      queue.queueItem({ id: '2', value: 20 })
      queue.queueItem({ id: '3', value: 30 })
      queue.getNextItem()
      queue.getNextItem()
      queue.getNextItem()
      expect(queue.processSize()).toBe(3)
      queue.doneProcessing(['3', '2'])
      expect(queue.processSize()).toBe(1)
      expect(queue.isProcessing('1')).toBe(true)
      expect(queue.isProcessing('2')).toBe(false)
      expect(queue.isProcessing('3')).toBe(false)
    })

    test('Symbol.iterator allows for...of iteration', () => {
      queue.queueItem({ id: '1', value: 10 })
      queue.queueItem({ id: '2', value: 20 })
      queue.queueItem({ id: '3', value: 30 })
      const items: { id: string, value: number }[] = []
      for (const item of queue) {
        items.push(item)
      }
      expect(items).toEqual([
        { id: '3', value: 30 },
        { id: '2', value: 20 },
        { id: '1', value: 10 }
      ])
      expect(queue.length()).toBe(3)
    })

    test('spread operator works with iterator', () => {
      queue.queueItem({ id: '1', value: 10 })
      queue.queueItem({ id: '2', value: 20 })
      const items = [...queue]
      expect(items.length).toBe(2)
      expect(queue.length()).toBe(2)
    })
  
})

describe('ProcessQueue - Priority / Comparator', () => {
  test('comparator orders items by priority (higher first)', () => {
    const queue = new ProcessQueue<{ id: string; value: number; priority: number }>({
      comparator: (a, b) => b.priority - a.priority
    })
    queue.queueItem({ id: '1', value: 10, priority: 1 })
    queue.queueItem({ id: '2', value: 20, priority: 3 })
    queue.queueItem({ id: '3', value: 30, priority: 2 })
    expect(queue.getNextItem()).toEqual({ id: '2', value: 20, priority: 3 })
    expect(queue.getNextItem()).toEqual({ id: '3', value: 30, priority: 2 })
    expect(queue.getNextItem()).toEqual({ id: '1', value: 10, priority: 1 })
  })

  test('comparator works with emplace mode', () => {
    const queue = new ProcessQueue<{ id: string; value: number; priority: number }>({
      emplace: true,
      comparator: (a, b) => b.priority - a.priority
    })
    queue.queueItem({ id: '1', value: 10, priority: 1 })
    queue.queueItem({ id: '2', value: 20, priority: 3 })
    queue.queueItem({ id: '3', value: 30, priority: 2 })
    // Emplace replaces in-place, so order should still be by priority for new items
    expect(queue.peek()).toEqual({ id: '2', value: 20, priority: 3 })
  })

  test('options object constructor works with emplace and maxSize', () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({
      emplace: true,
      maxSize: 2
    })
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    expect(() => queue.queueItem({ id: '3', value: 30 })).toThrow('Queue size limit reached')
  })

  test('backward-compatible positional constructor still works', () => {
    const queue = new ProcessQueue<{ id: string; value: number }>(true, 5)
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    queue.queueItem({ id: '1', value: 99 })
    // emplace mode: item 1 replaced in position
    expect(queue.getNextItem()).toEqual({ id: '1', value: 99 })
    expect(queue.getNextItem()).toEqual({ id: '2', value: 20 })
  })

  test('custom comparator for alphabetical ordering', () => {
    const queue = new ProcessQueue<{ id: string; value: number; name: string }>({
      comparator: (a, b) => a.name.localeCompare(b.name)
    })
    queue.queueItem({ id: '1', value: 10, name: 'Charlie' })
    queue.queueItem({ id: '2', value: 20, name: 'Alice' })
    queue.queueItem({ id: '3', value: 30, name: 'Bob' })
    expect(queue.getNextItem()!.name).toBe('Alice')
    expect(queue.getNextItem()!.name).toBe('Bob')
    expect(queue.getNextItem()!.name).toBe('Charlie')
  })

  test('queueMany respects comparator ordering', () => {
    const queue = new ProcessQueue<{ id: string; value: number; priority: number }>({
      comparator: (a, b) => b.priority - a.priority
    })
    queue.queueMany([
      { id: '1', value: 10, priority: 1 },
      { id: '2', value: 20, priority: 3 },
      { id: '3', value: 30, priority: 2 }
    ])
    expect(queue.getNextItem()!.priority).toBe(3)
    expect(queue.getNextItem()!.priority).toBe(2)
    expect(queue.getNextItem()!.priority).toBe(1)
  })
})

describe('ProcessQueue - Events', () => {
  let queue: ProcessQueue<{ id: string; value: number }>

  beforeEach(() => {
    queue = new ProcessQueue()
  })

  test('emits "added" event when item is queued', () => {
    const handler = jest.fn()
    queue.on('added', handler)
    queue.queueItem({ id: '1', value: 10 })
    expect(handler).toHaveBeenCalledWith({ id: '1', value: 10 }, undefined)
  })

  test('emits "processing" event when item is dequeued', () => {
    const handler = jest.fn()
    queue.on('processing', handler)
    queue.queueItem({ id: '1', value: 10 })
    queue.getNextItem()
    expect(handler).toHaveBeenCalledWith({ id: '1', value: 10 }, undefined)
  })

  test('emits "processing" event with batch on processBatch', () => {
    const handler = jest.fn()
    queue.on('processing', handler)
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    queue.processBatch(2)
    expect(handler).toHaveBeenCalledWith(
      expect.arrayContaining([{ id: '2', value: 20 }, { id: '1', value: 10 }]),
      undefined
    )
  })

  test('emits "done" event when doneProcessing is called', () => {
    const handler = jest.fn()
    queue.on('done', handler)
    queue.queueItem({ id: '1', value: 10 })
    queue.getNextItem()
    queue.doneProcessing('1')
    expect(handler).toHaveBeenCalledWith({ id: '1', value: 10 }, undefined)
  })

  test('emits "removed" event when item is removed from queue', () => {
    const handler = jest.fn()
    queue.on('removed', handler)
    queue.queueItem({ id: '1', value: 10 })
    queue.removeFromQueue('1')
    expect(handler).toHaveBeenCalledWith({ id: '1', value: 10 }, undefined)
  })

  test('emits "empty" event when queue becomes empty', () => {
    const handler = jest.fn()
    queue.on('empty', handler)
    queue.queueItem({ id: '1', value: 10 })
    queue.getNextItem()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('emits "drain" when queue is empty and nothing processing', () => {
    const handler = jest.fn()
    queue.on('drain', handler)
    queue.queueItem({ id: '1', value: 10 })
    queue.getNextItem()
    expect(handler).not.toHaveBeenCalled()
    queue.doneProcessing('1')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  test('emits "empty" and "drain" on clear()', () => {
    const emptyHandler = jest.fn()
    const drainHandler = jest.fn()
    queue.on('empty', emptyHandler)
    queue.on('drain', drainHandler)
    queue.queueItem({ id: '1', value: 10 })
    queue.clear()
    expect(emptyHandler).toHaveBeenCalledTimes(1)
    expect(drainHandler).toHaveBeenCalledTimes(1)
  })

  test('off removes event listener', () => {
    const handler = jest.fn()
    queue.on('added', handler)
    queue.off('added', handler)
    queue.queueItem({ id: '1', value: 10 })
    expect(handler).not.toHaveBeenCalled()
  })

  test('once fires handler only once', () => {
    const handler = jest.fn()
    queue.once('added', handler)
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ id: '1', value: 10 }, undefined)
  })
})

describe('ProcessQueue - Pause/Resume', () => {
  let queue: ProcessQueue<{ id: string; value: number }>

  beforeEach(() => {
    queue = new ProcessQueue()
  })

  test('pause prevents getNextItem from dequeuing', () => {
    queue.queueItem({ id: '1', value: 10 })
    queue.pause()
    expect(queue.isPaused()).toBe(true)
    expect(queue.getNextItem()).toBeNull()
    expect(queue.length()).toBe(1)
  })

  test('pause prevents processBatch from dequeuing', () => {
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    queue.pause()
    expect(queue.processBatch(2)).toEqual([])
    expect(queue.length()).toBe(2)
  })

  test('resume allows dequeuing again', () => {
    queue.queueItem({ id: '1', value: 10 })
    queue.pause()
    expect(queue.getNextItem()).toBeNull()
    queue.resume()
    expect(queue.isPaused()).toBe(false)
    expect(queue.getNextItem()).toEqual({ id: '1', value: 10 })
  })

  test('pause emits paused event, resume emits resumed event', () => {
    const pausedHandler = jest.fn()
    const resumedHandler = jest.fn()
    queue.on('paused', pausedHandler)
    queue.on('resumed', resumedHandler)
    queue.pause()
    expect(pausedHandler).toHaveBeenCalledTimes(1)
    queue.resume()
    expect(resumedHandler).toHaveBeenCalledTimes(1)
  })

  test('queueItem still works while paused', () => {
    queue.pause()
    expect(queue.queueItem({ id: '1', value: 10 })).toBe(true)
    expect(queue.length()).toBe(1)
  })
})

describe('ProcessQueue - Overflow Strategy', () => {
  test('reject strategy throws when full (default)', () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({ maxSize: 2 })
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    expect(() => queue.queueItem({ id: '3', value: 30 })).toThrow('Queue size limit reached')
  })

  test('drop-oldest strategy removes first item when full', () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({
      maxSize: 2,
      overflowStrategy: 'drop-oldest'
    })
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    queue.queueItem({ id: '3', value: 30 })
    expect(queue.length()).toBe(2)
    expect(queue.has('1')).toBe(false)
    expect(queue.has('3')).toBe(true)
  })

  test('drop-newest strategy rejects new item silently when full', () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({
      maxSize: 2,
      overflowStrategy: 'drop-newest'
    })
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    expect(queue.queueItem({ id: '3', value: 30 })).toBe(false)
    expect(queue.length()).toBe(2)
    expect(queue.has('3')).toBe(false)
  })
})

describe('ProcessQueue - Worker & Concurrency', () => {
  test('synchronous worker auto-processes items', () => {
    const processed: string[] = []
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: (item) => { processed.push(item.id) }
    })
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    expect(processed).toEqual(['1', '2'])
    expect(queue.isEmpty()).toBe(true)
    expect(queue.busy()).toBe(false)
  })

  test('async worker auto-processes items', async () => {
    const processed: string[] = []
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async (item) => { processed.push(item.id) }
    })
    queue.queueItem({ id: '1', value: 10 })
    // Allow microtask to resolve
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(processed).toEqual(['1'])
    expect(queue.busy()).toBe(false)
  })

  test('concurrency limits parallel processing', async () => {
    let active = 0
    let maxActive = 0
    const resolvers: (() => void)[] = []

    const queue = new ProcessQueue<{ id: string; value: number }>({
      concurrency: 2,
      worker: async (item) => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise<void>(resolve => resolvers.push(resolve))
        active--
      }
    })

    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    queue.queueItem({ id: '3', value: 30 })

    // Only 2 should be active (concurrency limit)
    expect(queue.processSize()).toBe(2)
    expect(queue.length()).toBe(1)

    // Resolve first worker
    resolvers[0]()
    await new Promise(resolve => setTimeout(resolve, 10))

    // Third item should now be processing (2 still active: item 2 + item 3)
    expect(queue.processSize()).toBe(2)
    expect(queue.length()).toBe(0)

    // Resolve remaining
    resolvers[1]()
    resolvers[2]()
    await new Promise(resolve => setTimeout(resolve, 10))

    expect(maxActive).toBe(2)
    expect(queue.busy()).toBe(false)
  })

  test('worker error emits error event', async () => {
    const errors: Error[] = []
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async () => { throw new Error('worker failed') }
    })
    queue.on('error', (_item, error) => { if (error) errors.push(error) })
    queue.queueItem({ id: '1', value: 10 })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(errors.length).toBe(1)
    expect(errors[0].message).toBe('worker failed')
    expect(queue.busy()).toBe(false)
  })

  test('synchronous worker error emits error event', () => {
    const errors: Error[] = []
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: () => { throw new Error('sync fail') }
    })
    queue.on('error', (_item, error) => { if (error) errors.push(error) })
    queue.queueItem({ id: '1', value: 10 })
    expect(errors.length).toBe(1)
    expect(errors[0].message).toBe('sync fail')
  })

  test('worker does not process when paused', () => {
    const processed: string[] = []
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: (item) => { processed.push(item.id) }
    })
    queue.pause()
    queue.queueItem({ id: '1', value: 10 })
    expect(processed).toEqual([])
    expect(queue.length()).toBe(1)
    queue.resume()
    expect(processed).toEqual(['1'])
  })

  test('start and stop are aliases for resume and pause', () => {
    const processed: string[] = []
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: (item) => { processed.push(item.id) }
    })
    queue.stop()
    queue.queueItem({ id: '1', value: 10 })
    expect(processed).toEqual([])
    queue.start()
    expect(processed).toEqual(['1'])
  })

  test('drain event fires when worker finishes all items', async () => {
    const drainHandler = jest.fn()
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async () => {}
    })
    queue.on('drain', drainHandler)
    queue.queueItem({ id: '1', value: 10 })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(drainHandler).toHaveBeenCalled()
  })
})

describe('ProcessQueue - Retry & Dead Letter Queue', () => {
  test('retries failed items up to maxRetries', async () => {
    let attempts = 0
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async () => {
        attempts++
        if (attempts < 3) throw new Error('fail')
      },
      maxRetries: 3
    })
    queue.queueItem({ id: '1', value: 10 })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(attempts).toBe(3)
    expect(queue.getDeadLetterQueue().length).toBe(0)
  })

  test('moves to dead letter queue after max retries exhausted', async () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async () => { throw new Error('always fails') },
      maxRetries: 2
    })
    const failedHandler = jest.fn()
    queue.on('failed', failedHandler)
    queue.queueItem({ id: '1', value: 10 })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(queue.getDeadLetterQueue()).toEqual([{ id: '1', value: 10 }])
    expect(failedHandler).toHaveBeenCalled()
  })

  test('retryDelay delays retries', async () => {
    let attempts = 0
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async () => {
        attempts++
        if (attempts < 2) throw new Error('fail')
      },
      maxRetries: 2,
      retryDelay: 50
    })
    queue.queueItem({ id: '1', value: 10 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(attempts).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(attempts).toBe(2)
  })

  test('retryDelay as function supports backoff', async () => {
    let attempts = 0
    const delays: number[] = []
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async () => {
        attempts++
        throw new Error('fail')
      },
      maxRetries: 2,
      retryDelay: (attempt) => {
        delays.push(attempt)
        return 10 * attempt
      }
    })
    queue.queueItem({ id: '1', value: 10 })
    await new Promise(resolve => setTimeout(resolve, 100))
    expect(delays).toEqual([1, 2])
    expect(queue.getDeadLetterQueue().length).toBe(1)
  })

  test('clearDeadLetterQueue empties the DLQ', async () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async () => { throw new Error('fail') },
      maxRetries: 0
    })
    queue.queueItem({ id: '1', value: 10 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(queue.getDeadLetterQueue().length).toBe(1)
    queue.clearDeadLetterQueue()
    expect(queue.getDeadLetterQueue().length).toBe(0)
  })

  test('no retry when maxRetries is 0 (default)', async () => {
    let attempts = 0
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async () => {
        attempts++
        throw new Error('fail')
      }
    })
    queue.queueItem({ id: '1', value: 10 })
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(attempts).toBe(1)
    // With maxRetries=0, items go straight to DLQ on first failure
    expect(queue.getDeadLetterQueue().length).toBe(1)
  })
})

describe('ProcessQueue - TTL & Processing Timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  test('items expire from queue after TTL', () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({ ttl: 100 })
    queue.queueItem({ id: '1', value: 10 })
    expect(queue.length()).toBe(1)

    jest.advanceTimersByTime(150)

    // Lazy expiration: triggered on getNextItem
    const item = queue.getNextItem()
    expect(item).toBeNull()
    expect(queue.length()).toBe(0)
  })

  test('expired event is emitted for TTL-expired items', () => {
    const expiredHandler = jest.fn()
    const queue = new ProcessQueue<{ id: string; value: number }>({ ttl: 100 })
    queue.on('expired', expiredHandler)
    queue.queueItem({ id: '1', value: 10 })

    jest.advanceTimersByTime(150)
    queue.getNextItem()

    expect(expiredHandler).toHaveBeenCalledWith({ id: '1', value: 10 }, undefined)
  })

  test('non-expired items are not removed', () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({ ttl: 100 })
    queue.queueItem({ id: '1', value: 10 })

    jest.advanceTimersByTime(50)
    const item = queue.getNextItem()
    expect(item).toEqual({ id: '1', value: 10 })
  })

  test('checkProcessingTimeouts releases timed-out items', () => {
    const timeoutHandler = jest.fn()
    const queue = new ProcessQueue<{ id: string; value: number }>({ processingTimeout: 100 })
    queue.on('timeout', timeoutHandler)
    queue.queueItem({ id: '1', value: 10 })
    queue.getNextItem()
    expect(queue.processSize()).toBe(1)

    jest.advanceTimersByTime(150)
    queue.checkProcessingTimeouts()

    expect(queue.processSize()).toBe(0)
    expect(timeoutHandler).toHaveBeenCalledWith({ id: '1', value: 10 }, undefined)
  })

  test('checkProcessingTimeouts does not release items within timeout', () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({ processingTimeout: 100 })
    queue.queueItem({ id: '1', value: 10 })
    queue.getNextItem()

    jest.advanceTimersByTime(50)
    queue.checkProcessingTimeouts()

    expect(queue.processSize()).toBe(1)
  })

  test('TTL works with worker auto-processing', () => {
    jest.useRealTimers()
    const expiredHandler = jest.fn()
    const queue = new ProcessQueue<{ id: string; value: number }>({
      ttl: 1,
      worker: (item) => {}
    })
    queue.on('expired', expiredHandler)
    // Items are processed immediately by worker, TTL doesn't apply
    queue.queueItem({ id: '1', value: 10 })
    // Item should be processed before TTL expires
    expect(queue.isEmpty()).toBe(true)
  })
})

describe('ProcessQueue - Serialization', () => {
  test('serialize returns queue state', () => {
    const queue = new ProcessQueue<{ id: string; value: number }>()
    queue.queueItem({ id: '1', value: 10 })
    queue.queueItem({ id: '2', value: 20 })
    queue.getNextItem()

    const snapshot = queue.serialize()
    expect(snapshot.queue).toEqual([{ id: '1', value: 10 }])
    expect(snapshot.inProcess).toEqual([{ id: '2', value: 20 }])
    expect(snapshot.deadLetterQueue).toEqual([])
  })

  test('deserialize restores queue state', () => {
    const data = {
      queue: [{ id: '1', value: 10 }, { id: '2', value: 20 }],
      inProcess: [{ id: '3', value: 30 }],
      deadLetterQueue: [{ id: '4', value: 40 }]
    }

    const queue = ProcessQueue.deserialize(data)
    expect(queue.length()).toBe(2)
    expect(queue.processSize()).toBe(1)
    expect(queue.isProcessing('3')).toBe(true)
    expect(queue.getDeadLetterQueue()).toEqual([{ id: '4', value: 40 }])
  })

  test('round-trip serialization preserves state', () => {
    const original = new ProcessQueue<{ id: string; value: number }>()
    original.queueItem({ id: '1', value: 10 })
    original.queueItem({ id: '2', value: 20 })
    original.queueItem({ id: '3', value: 30 })
    original.getNextItem()

    const snapshot = original.serialize()
    const restored = ProcessQueue.deserialize<{ id: string; value: number }>(snapshot)

    expect(restored.length()).toBe(2)
    expect(restored.processSize()).toBe(1)
    expect(restored.isProcessing('3')).toBe(true)
    expect(restored.getNextItem()).toEqual({ id: '2', value: 20 })
  })

  test('deserialize with options configures new instance', () => {
    const data = {
      queue: [{ id: '1', value: 10 }, { id: '2', value: 20 }],
    }

    const queue = ProcessQueue.deserialize(data, { emplace: true, maxSize: 5 })
    queue.queueItem({ id: '1', value: 99 })
    // emplace: item replaced in position
    expect(queue.peek()).toEqual({ id: '1', value: 99 })
  })

  test('serialize captures dead letter queue', async () => {
    const queue = new ProcessQueue<{ id: string; value: number }>({
      worker: async () => { throw new Error('fail') },
      maxRetries: 0
    })
    queue.queueItem({ id: '1', value: 10 })
    await new Promise(resolve => setTimeout(resolve, 20))

    const snapshot = queue.serialize()
    expect(snapshot.deadLetterQueue).toEqual([{ id: '1', value: 10 }])
  })
})
