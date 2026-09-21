import { DeadLetterQueue } from './deadLetterQueue'

describe('DeadLetterQueue', () => {
  test('keeps items in the order they were added', () => {
    const dlq = new DeadLetterQueue<string>(10)
    dlq.add(['a'])
    dlq.add(['b', 'c'])
    expect(dlq.toArray()).toEqual(['a', 'b', 'c'])
  })

  test('keeps only the newest maxSize items', () => {
    const dlq = new DeadLetterQueue<string>(2)
    dlq.add(['a', 'b', 'c'])
    dlq.add(['d'])
    expect(dlq.toArray()).toEqual(['c', 'd'])
  })

  test('a cap of 0 keeps nothing and Infinity keeps everything', () => {
    const none = new DeadLetterQueue<string>(0)
    none.add(['a'])
    expect(none.toArray()).toEqual([])
    const all = new DeadLetterQueue<number>(Infinity)
    all.add(Array.from({ length: 5000 }, (_, i) => i))
    expect(all.toArray().length).toBe(5000)
  })

  test('toArray returns a copy and clear empties the queue', () => {
    const dlq = new DeadLetterQueue<string>(10)
    dlq.add(['a'])
    dlq.toArray().push('mutated')
    expect(dlq.toArray()).toEqual(['a'])
    dlq.clear()
    expect(dlq.toArray()).toEqual([])
  })
})
