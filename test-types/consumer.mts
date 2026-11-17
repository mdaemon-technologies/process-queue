// An ES module consumer. It imports the package by name, so TypeScript resolves the
// declarations through package.json's "exports" (self-reference), as a consumer's would.
import ProcessQueue from '@mdaemon/process-queue'
import type {
  EventHandler,
  Item,
  ItemID,
  ListenerFor,
  OverflowStrategy,
  ProcessQueueEvent,
  ProcessQueueEvents,
  ProcessQueueOptions,
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

export { queued, next, idle, restored, id, strategy, event, handler, listener, onError, badStrategy }
