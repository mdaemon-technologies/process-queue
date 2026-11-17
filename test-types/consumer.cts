// A CommonJS consumer. Its require() resolves to dist/processQueue.cjs, whose module.exports
// is the constructor and also carries it as .default, which is what the declarations' default export says.
import processQueue = require('@mdaemon/process-queue')
import type { ItemID, OverflowStrategy, ProcessQueueOptions, Snapshot } from '@mdaemon/process-queue'

const ProcessQueue = processQueue.default

interface Job { id: string; n: number }

const options: ProcessQueueOptions<Job> = { maxSize: 10, overflowStrategy: 'drop-newest' }
const queue = new ProcessQueue<Job>(options)
const queued: boolean = queue.queueItem({ id: 'a', n: 1 })
queue.on('added', job => { const n: number = job.n; void n })
const snapshot: Snapshot<Job> = queue.serialize()
const restored = ProcessQueue.deserialize(snapshot)
const id: ItemID = 'a'

// These must stay errors, so the declarations cannot silently decay to `any`.
// @ts-expect-error not an overflow strategy
const badStrategy: OverflowStrategy = 'drop-all'
// @ts-expect-error items need an id
queue.queueItem({ n: 1 })

export { queued, restored, id, badStrategy }
