// A consumer that a bundler builds (moduleResolution "bundler").
import ProcessQueue from '@mdaemon/process-queue'
import type { OverflowStrategy, ProcessQueueOptions, Snapshot } from '@mdaemon/process-queue'

interface Job { id: string; n: number }

const options: ProcessQueueOptions<Job> = { concurrency: 2, worker: job => { void job.n } }
const queue = new ProcessQueue<Job>(options)
const queued: boolean = queue.queueItem({ id: 'a', n: 1 })
queue.on('done', job => { void job?.n })
const snapshot: Snapshot<Job> = queue.serialize()

// These must stay errors, so the declarations cannot silently decay to `any`.
// @ts-expect-error not an overflow strategy
const badStrategy: OverflowStrategy = 'drop-all'
// @ts-expect-error items need an id
queue.queueItem({ n: 1 })

export { queued, snapshot, badStrategy }
