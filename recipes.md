# Recipes

Patterns for using `@mdaemon/process-queue` in production. Each recipe is a sketch: names such as `app`, `logger`, `db` and `downstreamApi` stand for your own framework, logger and clients.

- [Coalesce webhook bursts](#coalesce-webhook-bursts)
- [Call a rate-limited API, with a dead letter queue](#call-a-rate-limited-api-with-a-dead-letter-queue)
- [Run interactive work ahead of background work](#run-interactive-work-ahead-of-background-work)
- [Batch writes with bounded memory](#batch-writes-with-bounded-memory)
- [Sync offline edits in the browser](#sync-offline-edits-in-the-browser)
- [Shut down gracefully](#shut-down-gracefully)
- [When to use something else](#when-to-use-something-else)

## Coalesce webhook bursts

A CRM or payment provider sends twenty `customer.updated` webhooks in two seconds, and you want to push the final state downstream once. Queueing an ID that is already queued replaces the old item instead of adding a second job.

```ts
import ProcessQueue from "@mdaemon/process-queue";

interface CustomerSync { id: string; payload: CustomerRecord }

const pendingWhileSyncing = new Map<string, CustomerSync>();

const syncQueue = new ProcessQueue<CustomerSync>({
  emplace: true,            // first in, first out; an update replaces the queued item in place
  concurrency: 4,
  maxRetries: 3,
  retryDelay: (attempt) => 500 * 2 ** attempt,
  worker: async ({ payload }) => {
    await downstreamApi.upsertCustomer(payload);
  },
});

app.post("/webhooks/crm", (req, res) => {
  // Normalize IDs: 1 and "1" are different IDs
  const item = { id: String(req.body.customerId), payload: req.body.data };
  // queueItem() returns false while the ID is in process or awaiting a retry.
  // Keep the newer payload and queue it once the current run settles.
  if (!syncQueue.queueItem(item)) pendingWhileSyncing.set(item.id, item);
  res.sendStatus(202);
});

const queueParkedUpdate = (item?: CustomerSync) => {
  if (!item) return;
  const newer = pendingWhileSyncing.get(item.id);
  if (newer && syncQueue.queueItem(newer)) pendingWhileSyncing.delete(newer.id);
};
syncQueue.on("done", queueParkedUpdate);   // emitted on success only
syncQueue.on("failed", queueParkedUpdate); // the item went to the dead letter queue
```

The queue refuses an ID while it is in process, so without `pendingWhileSyncing` an update that arrives during a sync would be lost.

## Call a rate-limited API, with a dead letter queue

Sending transactional email or SMS through a vendor, or calling a geocoding or LLM API: `concurrency` keeps you under the vendor's limit, failures retry with backoff, and permanent failures are kept for inspection and replay.

```ts
const notifications = new ProcessQueue<Notification>({
  emplace: true,
  maxSize: 10_000,
  overflowStrategy: "reject",     // queueItem throws when full; answer 503 upstream
  concurrency: 5,                 // the vendor allows 5 parallel requests
  maxRetries: 4,
  retryDelay: (n) => Math.min(30_000, 1000 * 2 ** n) + Math.random() * 250, // backoff with jitter
  maxDeadLetterSize: 5_000,
  worker: async (n) => {
    const res = await vendor.send(n);
    if (res.status === 429 || res.status >= 500) throw new Error(`vendor ${res.status}`);
  },
  onListenerError: (err, event) => logger.error({ err, event }, "queue listener threw"),
});

notifications.on("error", () => metrics.increment("notify.attempt_failed"));
notifications.on("failed", (n, err) => {
  logger.error({ id: n.id, err: err.message }, "notification permanently failed");
});

// Admin endpoint: replay the dead letter queue
app.post("/admin/notifications/replay", (_req, res) => {
  const dead = notifications.getDeadLetterQueue();
  notifications.clearDeadLetterQueue();
  notifications.queueMany(dead);
  res.json({ replayed: dead.length });
});
```

## Run interactive work ahead of background work

Rendering thumbnails or reports: a user waiting on screen should not queue behind a nightly backfill.

```ts
import os from "node:os";

type Job = { id: string; assetId: string; priority: number };

const renders = new ProcessQueue<Job>({
  comparator: (a, b) => b.priority - a.priority, // higher priority first
  concurrency: Math.max(1, os.availableParallelism() - 1),
  processingTimeout: 120_000,
  worker: async (job) => renderThumbnail(job.assetId),
});

// Queue the backfill while paused, so it is sorted before any worker starts on it
renders.pause();
renders.queueMany(nightlyAssets.map((a) => ({ id: a.id, assetId: a.id, priority: 1 })));
renders.resume();

// A user's upload is taken ahead of every waiting backfill item
renders.queueItem({ id: upload.id, assetId: upload.id, priority: 100 });

// processingTimeout is enforced only when checkProcessingTimeouts() runs
setInterval(() => renders.checkProcessingTimeouts(), 10_000).unref();
renders.on("timeout", (job) => logger.warn({ id: job.id }, "render timed out"));
```

Releasing a timed-out item does not cancel its worker, which keeps running. If the work must stop, give the worker an `AbortSignal` and abort it from the `timeout` listener.

## Batch writes with bounded memory

Collect analytics or audit events in memory and write them in batches. `drop-oldest` caps memory while the database is unavailable.

```ts
const events = new ProcessQueue<AuditEvent>({
  emplace: true,
  maxSize: 50_000,
  overflowStrategy: "drop-oldest",
});
events.on("removed", () => metrics.increment("audit.dropped")); // emitted for each evicted item

setInterval(async () => {
  const batch = events.processBatch(500); // takes up to 500 items and marks them in process
  if (batch.length === 0) return;
  const ids = batch.map((e) => e.id);
  try {
    await db.auditLog.insertMany(batch);
    events.doneProcessing(ids);
  } catch (err) {
    logger.warn({ err }, "audit flush failed; requeueing");
    events.doneProcessing(ids); // release first: queueItem refuses IDs that are in process
    events.queueMany(batch);
  }
}, 1_000).unref();
```

## Sync offline edits in the browser

A web app records edits while offline. The queue holds one entry per record, with its latest edit, survives a page reload, and drains when the browser is back online.

```ts
import ProcessQueue from "@mdaemon/process-queue";

const STORAGE_KEY = "pendingEdits";

const options = {
  emplace: true,
  maxRetries: 10,
  retryDelay: (n: number) => Math.min(60_000, 1000 * 2 ** n),
  worker: async (edit: Edit) => {
    const r = await fetch(`/api/records/${edit.id}`, { method: "PUT", body: JSON.stringify(edit) });
    if (!r.ok) throw new Error(String(r.status));
  },
};

const saved = localStorage.getItem(STORAGE_KEY);
const edits = saved
  ? ProcessQueue.deserialize<Edit>(JSON.parse(saved), options)
  : new ProcessQueue<Edit>(options);

const persist = () => localStorage.setItem(STORAGE_KEY, JSON.stringify(edits.serialize()));
edits.on("added", persist);
edits.on("done", persist);
window.addEventListener("pagehide", persist);

if (navigator.onLine) edits.start(); else edits.pause();
window.addEventListener("online", () => edits.resume());
window.addEventListener("offline", () => edits.pause());

// In the editor: saving while offline replaces that record's pending edit
edits.queueItem({ id: record.id, fields: record.fields });
```

`deserialize` treats items that were in process when the page closed as interrupted and queues them again at the front; processing restarts on `start()` or `resume()`.

## Shut down gracefully

On `SIGTERM` (a container being stopped, for example), stop taking work, give in-flight jobs a grace period, and save what is left for the next instance.

```ts
import { readFile, writeFile } from "node:fs/promises";

const SNAPSHOT = "/data/queue-snapshot.json";

// At startup
const snapshot = await readFile(SNAPSHOT, "utf-8").then(JSON.parse, () => null);
const queue = snapshot
  ? ProcessQueue.deserialize<Job>(snapshot, options)
  : new ProcessQueue<Job>(options);
queue.start();

process.on("SIGTERM", async () => {
  queue.pause(); // the worker takes no new items

  const deadline = Date.now() + 20_000;
  while (queue.busy() && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
  }

  // Queued items, items awaiting a retry, anything still in process, and the dead letter queue
  await writeFile(SNAPSHOT, JSON.stringify(queue.serialize()));
  process.exit(0);
});
```

Don't wait with `await queue.onIdle()` here: a paused queue that still holds items never becomes idle.

Work still running at the deadline is saved as in process, and `deserialize` queues it again, so it runs a second time after the restart. Make such workers idempotent.

## When to use something else

- **Durability.** The queue lives in memory. A crash, unlike a graceful shutdown, loses everything since the last `serialize()`. For jobs that must never be lost, use a persistent broker such as SQS, RabbitMQ or BullMQ.
- **Several instances.** Deduplication works within one process. With replicas behind a load balancer, the same ID can be processed on two instances at once; route each ID to one instance, or use a shared queue.
- **Both together.** A common setup is a durable broker between services, with a ProcessQueue inside each consumer for deduplication, priority and concurrency control.
