import { EventBus } from './eventBus'

type Events = {
  ping: (value: number) => void
  pong: () => void
}

describe('EventBus', () => {
  const create = () => {
    const onListenerError = jest.fn()
    return { bus: new EventBus<Events>(onListenerError), onListenerError }
  }

  test('calls "on" listeners for every emit with the arguments', () => {
    const { bus } = create()
    const handler = jest.fn()
    bus.on('ping', handler)
    bus.emit('ping', 1)
    bus.emit('ping', 2)
    expect(handler.mock.calls).toEqual([[1], [2]])
  })

  test('calls "once" listeners for the next emit only', () => {
    const { bus } = create()
    const handler = jest.fn()
    bus.once('ping', handler)
    bus.emit('ping', 1)
    bus.emit('ping', 2)
    expect(handler.mock.calls).toEqual([[1]])
  })

  test('off removes both kinds of listener', () => {
    const { bus } = create()
    const handler = jest.fn()
    bus.on('ping', handler)
    bus.once('ping', handler)
    bus.off('ping', handler)
    bus.emit('ping', 1)
    expect(handler).not.toHaveBeenCalled()
  })

  test('listeners added during an emit wait for the next emit', () => {
    const { bus } = create()
    const late = jest.fn()
    bus.once('pong', () => { bus.on('pong', late); bus.once('pong', late) })
    bus.emit('pong')
    expect(late).not.toHaveBeenCalled()
    bus.emit('pong')
    expect(late).toHaveBeenCalledTimes(2)
  })

  test('a once listener added by an on listener waits for the next emit', () => {
    const { bus } = create()
    bus.once('pong', () => {})
    bus.emit('pong') // the event's once registry now exists
    const late = jest.fn()
    bus.on('pong', () => bus.once('pong', late))
    bus.emit('pong')
    expect(late).not.toHaveBeenCalled()
  })

  test('a listener removed and added again during an emit counts as added', () => {
    const { bus } = create()
    const target = jest.fn()
    let readded = false
    // Registered before target, so it runs first in the emit
    bus.on('pong', () => {
      if (readded) return
      readded = true
      bus.off('pong', target)
      bus.on('pong', target)
    })
    bus.on('pong', target)
    bus.emit('pong')
    expect(target).not.toHaveBeenCalled()
    bus.emit('pong')
    expect(target).toHaveBeenCalledTimes(1)
  })

  test('listeners removed during an emit are not called later in that emit', () => {
    const { bus } = create()
    const removedOn = jest.fn()
    const removedOnce = jest.fn()
    bus.on('pong', () => { bus.off('pong', removedOn); bus.off('pong', removedOnce) })
    bus.on('pong', removedOn)
    bus.once('pong', removedOnce)
    bus.emit('pong')
    expect(removedOn).not.toHaveBeenCalled()
    expect(removedOnce).not.toHaveBeenCalled()
  })

  test('a once listener can register itself again for the next emit', () => {
    const { bus } = create()
    let calls = 0
    const handler = () => { calls++; if (calls === 1) bus.once('pong', handler) }
    bus.once('pong', handler)
    bus.emit('pong')
    expect(calls).toBe(1)
    bus.emit('pong')
    expect(calls).toBe(2)
    bus.emit('pong')
    expect(calls).toBe(2)
  })

  test('a throwing listener is reported and does not stop the others', () => {
    const { bus, onListenerError } = create()
    const boom = new Error('listener')
    const after = jest.fn()
    bus.on('ping', () => { throw boom })
    bus.on('ping', after)
    expect(() => bus.emit('ping', 1)).not.toThrow()
    expect(onListenerError).toHaveBeenCalledWith(boom, 'ping')
    expect(after).toHaveBeenCalledWith(1)
  })

  test('a throwing error reporter is contained', () => {
    const bus = new EventBus<Events>(() => { throw new Error('reporter') })
    bus.on('pong', () => { throw new Error('listener') })
    expect(() => bus.emit('pong')).not.toThrow()
  })
})
