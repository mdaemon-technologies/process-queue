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
})
