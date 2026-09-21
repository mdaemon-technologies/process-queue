# @mdaemon/process-queue

[![npm](https://img.shields.io/npm/v/@mdaemon/process-queue?color=blue)](https://www.npmjs.com/package/@mdaemon/process-queue)
[![license](https://img.shields.io/npm/l/@mdaemon/process-queue?color=green)](LICENSE)
[![node](https://img.shields.io/node/v/@mdaemon/process-queue)](https://nodejs.org)
[![install size](https://packagephobia.com/badge?p=@mdaemon/process-queue)](https://packagephobia.com/result?p=@mdaemon/process-queue)
[![CI](https://github.com/mdaemon-technologies/process-queue/actions/workflows/node.js.yml/badge.svg)](https://github.com/mdaemon-technologies/process-queue/actions/workflows/node.js.yml)

A lightweight, zero-dependency queue with ID-based deduplication, in-flight tracking, priority ordering, worker auto-processing, retry/DLQ, and event-driven lifecycle

**Tired of checking if a job is already queued before adding it?** ProcessQueue handles deduplication, in-flight tracking, priority ordering, and auto-processing so you don't have to.

A lightweight, zero-dependency TypeScript queue that replaces the hand-rolled `Set` + `Array` + `Map` combos developers write repeatedly — tested, typed, and ready to use in Node.js or the browser.

## Why ProcessQueue?

| Feature | Description |
|---------|-------------|
| **ID-based deduplication** | Never process the same item twice concurrently |
| **In-flight tracking** | Know what's being processed without external state |
| **Priority ordering** | Custom comparator for priority-based processing |
| **Worker auto-processing** | Optional async worker with configurable concurrency |
| **Retry & dead letter queue** | Automatic retries with backoff, permanent failures tracked |
| **Event-driven** | `added`, `done`, `drain`, `error`, and more |
| **TTL & timeouts** | Items expire (checked when items are taken); stuck processing is released by `checkProcessingTimeouts()` |
| **Zero dependencies** | Works in Node.js and browsers |
| **Fully typed** | Generic TypeScript with full IntelliSense |

### vs. Bull / BeeQueue / p-queue

Those are excellent tools — but they require Redis, infrastructure, or solve a different scope. ProcessQueue is the **no-infrastructure** option: an in-memory primitive for deduplication and processing-state tracking. Use it when you need a smart queue without the operational overhead.

## Install

```bash
npm install @mdaemon/process-queue
```

## Usage

### ES modules

```js
import ProcessQueue from "@mdaemon/process-queue";
```

### CommonJS

```js
const ProcessQueue = require("@mdaemon/process-queue");
```

Import the package root. Deep imports such as `@mdaemon/process-queue/dist/processQueue.cjs` are blocked by the package's `exports` map.

### Browser (UMD)

```html
<script type="text/javascript" src="/path_to_modules/dist/processQueue.umd.js"></script>
```

## Quick Start

### Basic Queue (Manual Processing)

```ts
import ProcessQueue from "@mdaemon/process-queue";

interface Task {
  id: string;
  url: string;
}

const queue = new ProcessQueue<Task>();

queue.queueItem({ id: "req-1", url: "/api/users" });
queue.queueItem({ id: "req-2", url: "/api/posts" });

// Re-queuing same ID updates it (no duplicates)
queue.queueItem({ id: "req-1", url: "/api/users?fresh=true" });

// By default the newest item is taken first: here req-1, which was just re-queued.
// Use { emplace: true } for first-in, first-out order.
const task = queue.getNextItem();
// Process task...
queue.doneProcessing(task!.id);
```

### Auto-Processing with Worker

```ts
const queue = new ProcessQueue<Task>({
  concurrency: 3,
  worker: async (task) => {
    const response = await fetch(task.url);
    // handle response
  }
});

// Items are processed automatically as they're added
queue.queueItem({ id: "req-1", url: "/api/users" });
queue.queueItem({ id: "req-2", url: "/api/posts" });

// Resolves once nothing is queued, in process or awaiting a retry.
// (A "drain" listener only hears about work that finishes after it is registered.)
await queue.onIdle();
console.log("All done!");
```

### Priority Queue

```ts
const queue = new ProcessQueue<Task & { priority: number }>({
  comparator: (a, b) => b.priority - a.priority, // higher priority first
  worker: async (task) => { /* ... */ }
});

// The comparator orders items waiting in the queue. An idle worker starts on an item
// as soon as it is queued, so queue a batch while paused to process it in priority order.
queue.pause();
queue.queueItem({ id: "low", url: "/bg", priority: 1 });
queue.queueItem({ id: "high", url: "/urgent", priority: 10 });
queue.resume(); // "high" is processed first
```

### Retry with Backoff

```ts
const queue = new ProcessQueue<Task>({
  worker: async (task) => { /* might fail */ },
  maxRetries: 3,
  retryDelay: (attempt) => 1000 * Math.pow(2, attempt) // exponential backoff
});

queue.on("failed", (task) => console.log(`Permanently failed: ${task.id}`));
console.log(queue.getDeadLetterQueue()); // inspect failures
```

## Constructor

```ts
// Options object (recommended)
new ProcessQueue<T>(options?: ProcessQueueOptions<T>)

// Positional args (backward-compatible)
new ProcessQueue<T>(emplace?: boolean, maxSize?: number)
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `emplace` | `boolean` | `false` | `false`: new and re-queued items go to the front, so the newest item is taken first. `true`: new items go to the back (first in, first out) and an update replaces the item in place |
| `maxSize` | `number` | `1000` | Maximum queue capacity |
| `comparator` | `(a, b) => number` | — | Custom sort (negative = a first) |
| `overflowStrategy` | `'reject' \| 'drop-oldest' \| 'drop-newest'` | `'reject'` | Behavior when full |
| `worker` | `(item) => Promise<void> \| void` | — | Auto-processing function |
| `concurrency` | `number` | `1` | Max parallel worker invocations |
| `maxRetries` | `number` | `0` | Retry attempts on worker failure |
| `retryDelay` | `number \| (attempt) => number` | `0` | Delay between retries (ms). If the function throws or returns a value that cannot be converted to a number, the item goes to the dead letter queue; `NaN` or a negative result means no delay |
| `maxDeadLetterSize` | `number` | `1000` | Max items kept in the dead letter queue; the oldest are dropped first |
| `ttl` | `number` | `0` | Item time-to-live in ms (0 = disabled) |
| `processingTimeout` | `number` | `0` | Max processing duration in ms (0 = disabled) |
| `onListenerError` | `(error, event) => void` | `console.error` | Receives exceptions thrown by event listeners |

Options are validated when the queue is constructed. `maxSize` and `concurrency` must be integers ≥ 1 (or `Infinity`), `maxRetries` an integer ≥ 0, `maxDeadLetterSize` an integer ≥ 0 (or `Infinity`), and `ttl`, `processingTimeout` and a numeric `retryDelay` finite numbers ≥ 0 (use `0`, not `Infinity`, to disable `ttl` or `processingTimeout`). Out-of-range numbers throw a `RangeError`; a callback that is not a function, or an unknown `overflowStrategy`, throws a `TypeError`.

## API Reference

### Queue Operations

| Method | Returns | Description |
|--------|---------|-------------|
| `queueItem(item)` | `boolean` | Add/update item. Returns `false` if the ID is in-process or awaiting a retry |
| `queueMany(items)` | `boolean[]` | Add multiple items in order. Not atomic: if one throws, the items before it stay queued |
| `getNextItem()` | `T \| null` | Dequeue next item, mark as in-process |
| `peek()` | `T \| null` | View next item without removing |
| `removeFromQueue(id)` | `boolean` | Remove item by ID, including one awaiting a retry |
| `getQueue(processing?)` | `T[]` | Get all queued items (optionally move to processing) |
| `processBatch(size)` | `T[]` | Dequeue multiple items at once |
| `has(id)` | `boolean` | Check if ID exists in queue |

### Processing State

| Method | Returns | Description |
|--------|---------|-------------|
| `isProcessing(id)` | `boolean` | Check if item is in-process |
| `doneProcessing(id?)` | `void` | Mark done (single ID, array, or all) |
| `getInProcess()` | `T[]` | Get all in-process items |
| `busy()` | `boolean` | Any items being processed? |
| `processSize()` | `number` | Count of in-process items |

### Queue Status

| Method | Returns | Description |
|--------|---------|-------------|
| `length(prop?, val?)` | `number` | Queue length; with `prop` and `val`, the number of queued items whose `prop` equals `val` |
| `isEmpty()` | `boolean` | Queue has no items |
| `clear()` | `void` | Clear queue + in-process + pending retries + timestamps |

### Flow Control

| Method | Returns | Description |
|--------|---------|-------------|
| `pause()` | `void` | Prevent dequeuing |
| `resume()` | `void` | Re-enable dequeuing + trigger auto-process |
| `start()` | `void` | Alias for `resume()` |
| `stop()` | `void` | Alias for `pause()` |
| `isPaused()` | `boolean` | Check if paused |
| `onIdle()` | `Promise<void>` | Resolves when nothing is queued, in process or awaiting a retry; immediately if that is already the case |

### Events

| Method | Description |
|--------|-------------|
| `on(event, handler)` | Register listener |
| `off(event, handler)` | Remove listener |
| `once(event, handler)` | One-time listener |

| Event | Handler receives | When |
|-------|------------------|------|
| `added` | `(item)` | An item was queued or updated |
| `processing` | `(item \| items[])` | Processing started; an array from `processBatch` / `getQueue(true)` |
| `done` | `(item?)` | An item finished; no item when `doneProcessing()` releases everything |
| `removed` | `(item)` | An item was removed or evicted |
| `expired` | `(item)` | An item's TTL passed before it was processed |
| `timeout` | `(item)` | `checkProcessingTimeouts()` released an item |
| `error` | `(item, error)` | The worker failed on an item |
| `failed` | `(item, error)` | An item moved to the dead letter queue; `error` is the final cause |
| `empty` | `()` | The queue became empty (once each time it empties; with a worker, when the worker takes the last item) |
| `drain` | `()` | The queue became idle: empty, with nothing in process or awaiting a retry (once each time it becomes idle) |
| `paused` / `resumed` | `()` | `pause()` / `resume()` was called |

In TypeScript, `on`, `off` and `once` type each handler from this table:

```ts
import ProcessQueue, { type ProcessQueueEvents, type ProcessQueueOptions } from "@mdaemon/process-queue";

const options: ProcessQueueOptions<Task> = { worker: async (task) => { /* ... */ } };
const queue = new ProcessQueue<Task>(options);

queue.on("failed", (task, error) => console.error(task.url, error.message)); // task: Task, error: Error

const onAdded: ProcessQueueEvents<Task>["added"] = (task) => console.log(task.id);
queue.on("added", onAdded);
```

The package also exports the `Item`, `ItemID`, `OverflowStrategy`, `ProcessQueueEvent`, `Snapshot` and `EventHandler` types. With an event name held in a variable, `on`, `off` and `once` accept an `EventHandler`.

A listener added during an emit is first called on the next emit; a listener removed during an emit is not called again, even later in that emit.

An exception thrown by a listener never changes queue state and never reaches the code that triggered the event. It is passed to the `onListenerError` option (default: `console.error`).

### Dead Letter Queue

| Method | Returns | Description |
|--------|---------|-------------|
| `getDeadLetterQueue()` | `T[]` | Get permanently failed items |
| `clearDeadLetterQueue()` | `void` | Clear the DLQ |

### TTL & Timeouts

| Method | Returns | Description |
|--------|---------|-------------|
| `checkProcessingTimeouts()` | `void` | Manually trigger timeout check |

### Serialization

| Method | Returns | Description |
|--------|---------|-------------|
| `serialize()` | `{ queue, inProcess, deadLetterQueue }` | Export state |
| `ProcessQueue.deserialize(data, options?)` | `ProcessQueue<T>` | Restore from snapshot |

### Iteration

```ts
for (const item of queue) {
  console.log(item.id);
}

const items = [...queue]; // spread operator works
```

## Behavior Notes

- **Order.** Without a comparator, default mode puts new and re-queued items at the front, so the newest item is taken first; `emplace: true` gives first-in, first-out order. With a comparator, items are taken in comparator order, but only among items that are waiting: an idle worker starts on each item as soon as it is queued.
- **Expiry is checked when items are taken** (`getNextItem()`, `processBatch()`, `getQueue(true)`, and whenever the worker looks for work). Until then, an expired item still counts in `has()`, `peek()`, `length()`, `isEmpty()`, `getQueue()` and iteration, and toward `maxSize`.
- **`empty` and `drain`.** `empty` fires once each time the queue goes from having items to having none, so `clear()` on an already-empty queue does not emit it. A retry re-enters the queue, so `empty` fires again when the retry is taken. If a listener refills the queue before the operation that emptied it finishes (for example from `processing`), that brief empty period is not reported. `drain` fires once each time the queue becomes idle (empty, with nothing in process or awaiting a retry), whether through finished work, `clear()`, removal or expiry, unless a listener has refilled the queue. Calls on an already-idle queue, such as `checkProcessingTimeouts()`, `doneProcessing()` or `clear()`, do not emit it. To wait for idle without missing work that already finished, use `await queue.onIdle()`. It stays pending while a paused queue, or a restored worker queue that has not been started, holds items, and an item past its TTL counts as work until something takes it. It resolves after every `drain` listener has run, so if a listener queues more work, `onIdle()` keeps waiting for that work too. Code after `await queue.onIdle()` runs a moment later, so anything that queues work in between can make the queue busy again by then. Callers waiting at the same time share one promise. Don't await `onIdle()` inside the worker: the worker's own item is in process, so the queue cannot become idle until the worker returns.
- **IDs are compared by type.** `1` and `"1"` are different IDs. If IDs come from mixed sources (JSON bodies, URL parameters), normalize them before queueing. `NaN` and empty strings are rejected.
- **Items are returned by reference.** `getQueue()`, `peek()`, `getNextItem()`, iteration and `serialize()` return the queue's own item objects, not copies. Don't change an item's `id` while the queue holds it.
- **Retries reserve their ID.** While an item waits out `retryDelay`, `queueItem` returns `false` for its ID, `removeFromQueue(id)` cancels the retry, and `serialize()` includes the item in `queue`. `drain` is not emitted until pending retries finish or are cancelled.
- **Retries and `maxSize`.** Items awaiting a retry count toward `maxSize`, so while they fill the queue a new item is rejected (`reject`) or dropped (`drop-oldest` and `drop-newest` alike, since there is no queued item to evict). A retried item was already admitted, so it re-enters the queue even when the queue is full: the overshoot is at most the number of items in flight. Retried items do not expire under the TTL. With a comparator it re-enters in priority order, otherwise at the front. A `retryDelay` longer than 2^31-1 ms is clamped to that.
- **`drop-oldest` evicts the earliest arrival**, in every mode, and emits `removed` with the evicted item. An `emplace` replacement keeps its original arrival; a re-queue in default mode counts as a new arrival. Updating an item that is already queued never triggers the overflow strategy.
- **Callbacks are called as plain functions.** `worker`, `comparator`, `retryDelay` and `onListenerError` are not called with the queue as `this`; use closures or arrow functions.
- **Listeners run synchronously.** A listener that calls back into the queue sees its final state for that operation. The `comparator` must not call back into the queue. With a synchronous worker, a `done` listener that always re-queues the same ID is an infinite loop that never returns control, just as it would be in plain code.
- **Releasing a run does not cancel the worker.** After `checkProcessingTimeouts()`, `clear()` or `doneProcessing()` releases a worker run, the worker keeps running but its eventual result is ignored, and the freed slot is used for the next queued item. The same ID can therefore run again while the released run is still going. In manual mode the queue cannot tell runs apart: a late `doneProcessing(id)` for a released item also completes a newer run of the same ID.
- **`deserialize` validates the whole snapshot** before restoring anything. It throws a `TypeError` for a malformed snapshot, an invalid item, or an ID repeated across `queue` and `inProcess` (the dead letter queue may repeat IDs), and a `RangeError` if `queue` exceeds `maxSize`. With a `worker`, the limit is `maxSize + concurrency` for `queue` and `inProcess` together (pending retries are serialized in `queue`), and `inProcess` may not exceed `concurrency`; in-process items are treated as interrupted and queued again at the front, and processing starts on `start()`, `resume()`, or the next `queueItem`. With a comparator, restored items are put in priority order. Restored queued items are subject to the TTL from the moment of restore, including items that were awaiting a retry. Retry counts are not serialized, so restored items start with their full retry budget. Taking items with `getNextItem()` or `processBatch()` while a worker is running can put more than `concurrency` items in process; a snapshot of that state is rejected with the same options.

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

Published under the [LGPL-2.1](LICENSE) license.

Published by **MDaemon Technologies, Ltd.**  
Simple Secure Email  
[https://www.mdaemon.com](https://www.mdaemon.com)
