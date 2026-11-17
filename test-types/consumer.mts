// An ES module consumer. It imports the package by name, so TypeScript resolves the
// declarations through package.json's "exports" (self-reference), as a consumer's would.
import ProcessQueue from '@mdaemon/process-queue'
import type {
  EventHandler,
  Item,
  ItemID,
  ItemState,
  ListenerFor,
  OverflowStrategy,
  ProcessQueueEvent,
  ProcessQueueEvents,
  ProcessQueueOptions,
  RetryInfo,
  Snapshot,
} from '@mdaemon/process-queue'

interface Job { id: string; n: number }

const options: ProcessQueueOptions<Job> = { maxSize: 10, overflowStrategy: 'drop-oldest', worker: async job => { void job.n } }
const queue = new ProcessQueue<Job>(options)
const positional = new ProcessQueue<Job>(true, 2)
const queued: boolean = queue.queueItem({ id: 'a', n: 1 })
const next: Job | null = positional.getNextItem()
queue.on('failed', (job, error) => { const n: number = job.n; const message: string = error.message; void n; void message })
const idle: Promise<void> = queue.onIdle()

const snapshot: Snapshot<Job> = queue.serialize()
const restored: ProcessQueue<Job> = ProcessQueue.deserialize(snapshot, options)
const states: ItemState[] = queue.serialize().itemState
const durable: Snapshot<Job> = { queue: [{ id: 'a', n: 1 }], itemState: [{ id: 'a', attempts: 1, retryAt: 0, enqueuedAt: 0 }] }
queue.on('error', (job, error, retry) => {
  const info: RetryInfo | undefined = retry
  const delay: number | undefined = retry?.delay
  void job.n; void error.message; void info; void delay
})

const item: Item = { id: 1 }
const id: ItemID = item.id
const strategy: OverflowStrategy = 'reject'
const event: ProcessQueueEvent = 'drain'
const handler: EventHandler<Job> = () => {}
const listener: ListenerFor<Job, 'added'> = job => { void job.n }
const onError: ProcessQueueEvents<Job>['error'] = (job, error) => { void job.n; void error.message }

// These must stay errors, so the declarations cannot silently decay to `any`.
// @ts-expect-error not an overflow strategy
const badStrategy: OverflowStrategy = 'drop-all'
// @ts-expect-error items need an id
queue.queueItem({ n: 1 })
// @ts-expect-error a failed handler's item is a Job, whose n is a number
queue.on('failed', job => { const notNumber: string = job.n; void notNumber })
// @ts-expect-error attempts is a number
const badState: ItemState = { id: 'a', attempts: '1' }
// @ts-expect-error retry is undefined when the item is about to fail permanently
queue.on('error', (_job, _error, retry) => { const attempt: number = retry.attempt; void attempt })

export { queued, next, idle, restored, states, durable, id, strategy, event, handler, listener, onError, badStrategy, badState }
