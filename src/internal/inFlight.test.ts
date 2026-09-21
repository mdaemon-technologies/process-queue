import { Clock } from './clock'
import { InFlight } from './inFlight'

type T = { id: string }

const create = (processingTimeout = 0) => {
  let time = 0
  const clock: Clock = { now: () => time, setTimeout: jest.fn(), clearTimeout: jest.fn() }
  return { inFlight: new InFlight<T>(processingTimeout, clock), advance: (ms: number) => { time += ms } }
}

describe('InFlight', () => {
  test('tracks started items until they finish', () => {
    const { inFlight } = create()
    inFlight.start({ id: 'a' })
    inFlight.start({ id: 'b' })
    expect(inFlight.size).toBe(2)
    expect(inFlight.get('a')).toEqual({ id: 'a' })
    expect(inFlight.has('b')).toBe(true)
    expect(inFlight.items()).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(inFlight.ids()).toEqual(['a', 'b'])
    inFlight.finish('a')
    expect(inFlight.has('a')).toBe(false)
    expect(inFlight.get('a')).toBeUndefined()
  })

  test('a run token stays current until the item finishes or a new run begins', () => {
    const { inFlight } = create()
    inFlight.start({ id: 'a' })
    const first = inFlight.beginRun('a')
    expect(inFlight.isCurrentRun('a', first)).toBe(true)
    const second = inFlight.beginRun('a')
    expect(inFlight.isCurrentRun('a', first)).toBe(false)
    expect(inFlight.isCurrentRun('a', second)).toBe(true)
    inFlight.finish('a')
    expect(inFlight.isCurrentRun('a', second)).toBe(false)
  })

  test('timedOut lists items in process longer than the timeout', () => {
    const { inFlight, advance } = create(100)
    inFlight.start({ id: 'old' })
    advance(60)
    inFlight.start({ id: 'new' })
    advance(60)
    expect(inFlight.timedOut()).toEqual(['old'])
  })

  test('hasTimedOut rechecks one id, so a restarted item is not timed out', () => {
    const { inFlight, advance } = create(100)
    inFlight.start({ id: 'a' })
    advance(150)
    expect(inFlight.hasTimedOut('a')).toBe(true)
    inFlight.finish('a')
    expect(inFlight.hasTimedOut('a')).toBe(false)
    inFlight.start({ id: 'a' })
    expect(inFlight.hasTimedOut('a')).toBe(false)
  })

  test('timedOut is empty when the timeout is disabled', () => {
    const { inFlight, advance } = create(0)
    inFlight.start({ id: 'a' })
    advance(1e9)
    expect(inFlight.timedOut()).toEqual([])
    expect(inFlight.bookkeepingSizes().processingStartedAt).toBe(0)
  })

  test('finish and clear forget all bookkeeping', () => {
    const { inFlight } = create(100)
    inFlight.start({ id: 'a' }); inFlight.beginRun('a')
    inFlight.start({ id: 'b' }); inFlight.beginRun('b')
    inFlight.finish('a')
    expect(inFlight.bookkeepingSizes()).toEqual({ inProcess: 1, processingStartedAt: 1, activeRuns: 1 })
    inFlight.clear()
    expect(inFlight.bookkeepingSizes()).toEqual({ inProcess: 0, processingStartedAt: 0, activeRuns: 0 })
  })
})
