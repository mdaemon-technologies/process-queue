import { isItemID, isValidItem, toError } from './validation'

describe('isItemID', () => {
  test.each(['a', 0, -1, 1.5, Infinity])('accepts %o', id => {
    expect(isItemID(id)).toBe(true)
  })

  test.each(['', NaN, undefined, null, {}, true])('rejects %o', id => {
    expect(isItemID(id)).toBe(false)
  })
})

describe('isValidItem', () => {
  test('accepts an object with a valid id', () => {
    expect(isValidItem({ id: 'a', extra: 1 })).toBe(true)
  })

  test.each([null, undefined, 'a', 5, {}, { id: '' }, { id: NaN }])('rejects %o', item => {
    expect(isValidItem(item)).toBe(false)
  })
})

describe('toError', () => {
  test('returns Errors unchanged', () => {
    const error = new TypeError('x')
    expect(toError(error)).toBe(error)
  })

  test('wraps other thrown values', () => {
    expect(toError('boom')).toEqual(new Error('boom'))
    expect(toError(42).message).toBe('42')
  })
})
