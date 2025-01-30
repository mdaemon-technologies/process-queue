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
  
})
