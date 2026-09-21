import { systemClock } from './clock'

describe('systemClock', () => {
  afterEach(() => { jest.useRealTimers() })

  test('reads the current time and timer functions at call time, so fake timers apply', () => {
    jest.useFakeTimers()
    jest.setSystemTime(1234)
    expect(systemClock.now()).toBe(1234)

    const fired = jest.fn()
    systemClock.setTimeout(fired, 100)
    jest.advanceTimersByTime(100)
    expect(fired).toHaveBeenCalledTimes(1)

    const cancelled = jest.fn()
    const handle = systemClock.setTimeout(cancelled, 100)
    systemClock.clearTimeout(handle)
    jest.advanceTimersByTime(100)
    expect(cancelled).not.toHaveBeenCalled()
  })
})
