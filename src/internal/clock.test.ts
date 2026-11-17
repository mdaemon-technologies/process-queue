import { systemClock } from './clock'

describe('systemClock', () => {
  afterEach(() => { vi.useRealTimers() })

  test('reads the current time and timer functions at call time, so fake timers apply', () => {
    vi.useFakeTimers()
    vi.setSystemTime(1234)
    expect(systemClock.now()).toBe(1234)

    const fired = vi.fn()
    systemClock.setTimeout(fired, 100)
    vi.advanceTimersByTime(100)
    expect(fired).toHaveBeenCalledTimes(1)

    const cancelled = vi.fn()
    const handle = systemClock.setTimeout(cancelled, 100)
    systemClock.clearTimeout(handle)
    vi.advanceTimersByTime(100)
    expect(cancelled).not.toHaveBeenCalled()
  })
})
