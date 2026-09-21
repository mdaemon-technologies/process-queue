// Type-level tests: ts-jest type-checks this file, so a wrong type fails the suite.
// Each @ts-expect-error must be an error; an unused one fails too.
import ProcessQueue, {
  EventHandler,
  Item,
  ItemID,
  ListenerFor,
  OverflowStrategy,
  ProcessQueueEvent,
  ProcessQueueEvents,
  ProcessQueueOptions,
  Snapshot,
} from './processQueue'

type Job = { id: string; n: number }

describe('public types', () => {
  test('event handlers are typed per event', () => {
    const queue = new ProcessQueue<Job>()

    queue.on('failed', (item, error) => { const n: number = item.n; const message: string = error.message; void n; void message })
    queue.on('error', (item, error) => { void item.n; void error.message })
    queue.on('added', item => { const n: number = item.n; void n })
    queue.on('removed', item => { void item.n })
    queue.on('expired', item => { void item.n })
    queue.on('timeout', item => { void item.n })
    // 'processing' receives a batch from processBatch
    // @ts-expect-error item may be an array
    queue.on('processing', item => { void item.n })
    // doneProcessing() without an id emits 'done' with no item
    // @ts-expect-error item may be undefined
    queue.on('done', item => { void item.n })
    queue.once('drain', () => {})

    expect(true).toBe(true)
  })

  test('existing handler styles still compile', () => {
    const queue = new ProcessQueue<Job>()
    const legacy: EventHandler<Job> = () => {}
    const events: ProcessQueueEvent[] = ['added', 'processing', 'done', 'removed', 'empty', 'drain', 'error', 'resumed', 'paused', 'failed', 'expired', 'timeout']
    events.forEach(event => {
      queue.on(event, legacy)
      queue.off(event, legacy)
    })
    // An unannotated one-parameter handler on an event without a payload
    queue.on('drain', item => { void item })
    // An event name held in a variable, with an unannotated handler: typed as EventHandler, as before
    const subscribe = (event: ProcessQueueEvent) => queue.on(event, (item, error) => { void item; void error?.message })
    subscribe('failed')
    // Forwarding a generic event name with an EventHandler
    const forward = <E extends ProcessQueueEvent>(event: E, handler: EventHandler<Job>) => queue.once(event, handler)
    forward('added', legacy)

    expect(events.length).toBe(12)
  })

  test('mistakes are type errors', () => {
    const queue = new ProcessQueue<Job>()
    // @ts-expect-error unknown event
    queue.on('finished', () => {})
    // @ts-expect-error 'failed' passes an Error, not a string
    queue.on('failed', (_item: Job, error: string) => { void error })

    expect(true).toBe(true)
  })

  test('item types can be interfaces as well as type aliases', () => {
    interface Task { id: string; url: string }
    const queue = new ProcessQueue<Task>({ worker: async task => { void task.url } })
    queue.on('added', task => { const url: string = task.url; void url })

    expect(queue.queueItem({ id: 'a', url: '/a' })).toBe(true)
  })

  test('serialize and deserialize share the exported Snapshot type', () => {
    const queue = new ProcessQueue<Job>()
    queue.queueItem({ id: 'a', n: 1 })
    const snapshot: Required<Snapshot<Job>> = queue.serialize()
    const partial: Snapshot<Job> = { queue: snapshot.queue }
    expect(ProcessQueue.deserialize(partial).length()).toBe(1)
  })

  test('the option and value types are exported', () => {
    const id: ItemID = 1
    const item: Item = { id }
    const strategy: OverflowStrategy = 'drop-oldest'
    const options: ProcessQueueOptions<Job> = { overflowStrategy: strategy, maxSize: 5 }
    const handlers: Partial<ProcessQueueEvents<Job>> = { failed: (job, error) => { void job.n; void error } }
    const onFailed: ListenerFor<Job, 'failed'> = (job, error) => { void job.n; void error.message }
    const onAny: ListenerFor<Job, ProcessQueueEvent> = (job, error) => { void job; void error }
    void onFailed; void onAny

    expect([item.id, options.maxSize, typeof handlers.failed]).toEqual([1, 5, 'function'])
  })
})
