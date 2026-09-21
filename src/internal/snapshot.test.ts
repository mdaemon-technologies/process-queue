import { validateSnapshot } from './snapshot'

type T = { id: string }
const unlimited = { maxQueued: Infinity, maxInProcess: Infinity, maxTotal: Infinity }

describe('validateSnapshot', () => {
  test('returns the three lists, defaulting the optional ones to empty', () => {
    expect(validateSnapshot<T>({ queue: [{ id: 'a' }] }, unlimited)).toEqual({
      queued: [{ id: 'a' }],
      inProcess: [],
      deadLetters: [],
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
