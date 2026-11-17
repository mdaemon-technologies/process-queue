import { validateSnapshot } from './snapshot'

type T = { id: string }
const unlimited = { maxQueued: Infinity, maxInProcess: Infinity, maxTotal: Infinity }

describe('validateSnapshot', () => {
  test('returns the lists, defaulting the optional ones to empty', () => {
    expect(validateSnapshot<T>({ queue: [{ id: 'a' }] }, unlimited)).toEqual({
      queued: [{ id: 'a' }],
      inProcess: [],
      deadLetters: [],
      itemState: [],
    })
  })

  test.each([
    ['null', null],
    ['a missing queue', {}],
    ['a non-array inProcess', { queue: [], inProcess: 'x' }],
    ['a non-array deadLetterQueue', { queue: [], deadLetterQueue: {} }],
    ['an invalid item', { queue: [{ id: '' }] }],
    ['an invalid dead letter', { queue: [], deadLetterQueue: [null] }],
    ['a duplicate queued id', { queue: [{ id: 'a' }, { id: 'a' }] }],
    ['an id both queued and in-process', { queue: [{ id: 'a' }], inProcess: [{ id: 'a' }] }],
  ])('rejects %s with a TypeError', (_label, data) => {
    expect(() => validateSnapshot<T>(data, unlimited)).toThrow(TypeError)
  })

  describe('itemState', () => {
    test.each([
      ['a non-array itemState', { queue: [], itemState: {} }],
      ['an entry that is not an object', { queue: [{ id: 'a' }], itemState: [null] }],
      ['an entry with an invalid id', { queue: [{ id: 'a' }], itemState: [{ id: '' }] }],
      ['an id that is not queued or in process', { queue: [{ id: 'a' }], itemState: [{ id: 'b', attempts: 1 }] }],
      ['an id only in the dead letter queue', { queue: [], deadLetterQueue: [{ id: 'a' }], itemState: [{ id: 'a', attempts: 1 }] }],
      ['an id of a different type', { queue: [{ id: 1 }], itemState: [{ id: '1', attempts: 1 }] }],
      ['a repeated id', { queue: [{ id: 'a' }], itemState: [{ id: 'a', attempts: 1 }, { id: 'a', attempts: 2 }] }],
    ])('rejects %s with a TypeError', (_label, data) => {
      expect(() => validateSnapshot<T>(data, unlimited)).toThrow(TypeError)
    })

    const show = (value: unknown) => typeof value === 'string' ? JSON.stringify(value) : String(value)
    const withField = (name: string, value: unknown): [string, unknown] =>
      [`${name} of ${show(value)}`, { queue: [{ id: 'a' }], itemState: [{ id: 'a', [name]: value }] }]
    const fieldCases: [string, unknown][] = [
      ...[-1, 1.5, '2', null, NaN, Infinity, 2 ** 53].map(value => withField('attempts', value)),
      ...['retryAt', 'enqueuedAt'].flatMap(name => [NaN, Infinity, '5', null].map(value => withField(name, value))),
      ['retryAt on an in-process item', { queue: [], inProcess: [{ id: 'a' }], itemState: [{ id: 'a', retryAt: 5 }] }],
      ['enqueuedAt on an in-process item', { queue: [], inProcess: [{ id: 'a' }], itemState: [{ id: 'a', enqueuedAt: 5 }] }],
    ]
    test.each(fieldCases)('rejects %s with a TypeError', (_label, data) => {
      expect(() => validateSnapshot<T>(data, unlimited)).toThrow(TypeError)
    })

    test('accepts entries for queued and in-process ids, ignoring unknown keys', () => {
      const itemState = [{ id: 'a', attempts: 1, retryAt: 5, enqueuedAt: 1, addedLater: 'x' }, { id: 'p', attempts: 0 }]
      const data = { queue: [{ id: 'a' }], inProcess: [{ id: 'p' }], itemState }
      expect(validateSnapshot<T>(data, unlimited).itemState).toEqual(itemState)
    })
  })

  test('allows repeated ids in the dead letter queue', () => {
    expect(() => validateSnapshot<T>({ queue: [], deadLetterQueue: [{ id: 'a' }, { id: 'a' }] }, unlimited)).not.toThrow()
  })

  test('enforces the size limits with a RangeError', () => {
    const data = { queue: [{ id: 'a' }, { id: 'b' }], inProcess: [{ id: 'c' }] }
    expect(() => validateSnapshot<T>(data, { maxQueued: 2, maxInProcess: 1, maxTotal: 3 })).not.toThrow()
    expect(() => validateSnapshot<T>(data, { maxQueued: 1, maxInProcess: 1, maxTotal: 3 })).toThrow(RangeError)
    expect(() => validateSnapshot<T>(data, { maxQueued: 2, maxInProcess: 0, maxTotal: 3 })).toThrow(RangeError)
    expect(() => validateSnapshot<T>(data, { maxQueued: 2, maxInProcess: 1, maxTotal: 2 })).toThrow(RangeError)
  })
})
