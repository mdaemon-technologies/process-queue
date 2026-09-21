import { resolveOptions } from './options'

describe('resolveOptions', () => {
  test('applies defaults when no options are given', () => {
    const options = resolveOptions()
    expect(options).toMatchObject({
      emplace: false,
      maxSize: 1000,
      overflowStrategy: 'reject',
      concurrency: 1,
      maxRetries: 0,
      maxDeadLetterSize: 1000,
      retryDelay: 0,
      ttl: 0,
      processingTimeout: 0,
    })
    expect(options.comparator).toBeUndefined()
    expect(options.worker).toBeUndefined()
    expect(typeof options.onListenerError).toBe('function')
  })

  test('keeps given options', () => {
    const worker = () => {}
    expect(resolveOptions({ maxSize: 5, worker, overflowStrategy: 'drop-newest' })).toMatchObject({
      maxSize: 5,
      worker,
      overflowStrategy: 'drop-newest',
    })
  })

  test('converts the positional form', () => {
    expect(resolveOptions(true, 7)).toMatchObject({ emplace: true, maxSize: 7 })
    expect(resolveOptions(false)).toMatchObject({ emplace: false, maxSize: 1000 })
  })

  test('validates', () => {
    expect(() => resolveOptions({ maxSize: NaN })).toThrow(RangeError)
    expect(() => resolveOptions({ worker: 'nope' as any })).toThrow(TypeError)
    expect(() => resolveOptions(true, 0)).toThrow(RangeError)
  })
})
