import { Clock, MAX_TIMER_DELAY, TimerHandle } from './clock'
import { normalizeDelay, RetryTracker } from './retryTracker'

type T = { id: string }

// A clock whose timers fire only when the test calls fire()
const manualClock = () => {
  const timers = new Map<number, { callback: () => void; ms: number }>()
  let next = 1
  const clock: Clock = {
    now: () => 0,
    setTimeout: (callback, ms) => { timers.set(next, { callback, ms }); return next++ as unknown as TimerHandle },
    clearTimeout: handle => { timers.delete(handle as unknown as number) },
  }
  const fire = () => { const all = [...timers.values()]; timers.clear(); all.forEach(t => t.callback()) }
  return { clock, timers, fire }
}

describe('RetryTracker', () => {
  test('counts attempts per id until forgotten', () => {
    const tracker = new RetryTracker<T>(manualClock().clock)
    expect(tracker.attempts('a')).toBe(0)
    tracker.setAttempts('a', 2)
    expect(tracker.attempts('a')).toBe(2)
    tracker.forget('a')
    expect(tracker.attempts('a')).toBe(0)
  })

  test('a scheduled retry is pending until its timer fires', () => {
    const { clock, timers, fire } = manualClock()
    const tracker = new RetryTracker<T>(clock)
    const onFire = jest.fn(() => expect(tracker.isPending('a')).toBe(false))
    tracker.schedule({ id: 'a' }, 'a', 100, onFire)
    expect(tracker.isPending('a')).toBe(true)
    expect(tracker.pendingItems()).toEqual([{ id: 'a' }])
    expect(tracker.pendingCount).toBe(1)
    expect([...timers.values()][0].ms).toBe(100)
    fire()
    expect(onFire).toHaveBeenCalledTimes(1)
    expect(tracker.pendingCount).toBe(0)
  })

  test('cancel stops the timer, forgets the count and returns the item', () => {
    const { clock, fire } = manualClock()
    const tracker = new RetryTracker<T>(clock)
    const onFire = jest.fn()
    tracker.setAttempts('a', 1)
    tracker.schedule({ id: 'a' }, 'a', 100, onFire)
    expect(tracker.cancel('missing')).toBeUndefined()
    expect(tracker.cancel('a')).toEqual({ id: 'a' })
    fire()
    expect(onFire).not.toHaveBeenCalled()
    expect(tracker.bookkeepingSizes()).toEqual({ retryCount: 0, pendingRetries: 0 })
  })

  test('clear cancels every timer and forgets every count', () => {
    const { clock, fire } = manualClock()
    const tracker = new RetryTracker<T>(clock)
    const onFire = jest.fn()
    tracker.setAttempts('a', 1)
    tracker.setAttempts('b', 1)
    tracker.schedule({ id: 'a' }, 'a', 100, onFire)
    tracker.clear()
    fire()
    expect(onFire).not.toHaveBeenCalled()
    expect(tracker.bookkeepingSizes()).toEqual({ retryCount: 0, pendingRetries: 0 })
  })
})

describe('normalizeDelay', () => {
  test.each([
    [50, 50], [0, 0], [NaN, 0], [-5, 0], ['20', 20], [undefined, 0],
    [Infinity, MAX_TIMER_DELAY], [2 ** 31, MAX_TIMER_DELAY],
  ])('normalizes %p to %p', (raw, expected) => {
    expect(normalizeDelay(raw)).toBe(expected)
  })

  test('throws for a value that cannot be converted to a number', () => {
    expect(() => normalizeDelay(Symbol('x'))).toThrow(TypeError)
  })
})
