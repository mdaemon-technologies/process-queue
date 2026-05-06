[![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmdaemon-technologies%2Fprocess-queue%2Fmaster%2Fpackage.json&query=%24.version&prefix=v&label=npm&color=blue)](https://www.npmjs.com/package/@mdaemon/process-queue) [![Static Badge](https://img.shields.io/badge/node-v16%2B-blue?style=flat&label=node&color=blue)](https://nodejs.org)
 [![install size](https://packagephobia.com/badge?p=@mdaemon/process-queue)](https://packagephobia.com/result?p=@mdaemon/process-queue) [![Dynamic JSON Badge](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Fmdaemon-technologies%2Fprocess-queue%2Fmaster%2Fpackage.json&query=%24.license&prefix=v&label=license&color=green)](https://github.com/mdaemon-technologies/process-queue/blob/master/LICENSE) [![Node.js CI](https://github.com/mdaemon-technologies/process-queue/actions/workflows/node.js.yml/badge.svg)](https://github.com/mdaemon-technologies/process-queue/actions/workflows/node.js.yml)

# @mdaemon/process-queue

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
| **TTL & timeouts** | Items expire, stuck processing auto-releases |
| **Zero dependencies** | <300 lines, works in Node.js and browsers |
| **Fully typed** | Generic TypeScript with full IntelliSense |

### vs. Bull / BeeQueue / p-queue

Those are excellent tools — but they require Redis, infrastructure, or solve a different scope. ProcessQueue is the **no-infrastructure** option: an in-memory primitive for deduplication and processing-state tracking. Use it when you need a smart queue without the operational overhead.

---

## Install

```bash
npm install @mdaemon/process-queue --save
```

### Node CommonJS
```javascript
const ProcessQueue = require("@mdaemon/process-queue/dist/processQueue.cjs");
```

### Node ES Modules
```javascript
import ProcessQueue from "@mdaemon/process-queue/dist/processQueue.mjs";
```

### Browser
```html
<script type="text/javascript" src="/path_to_modules/dist/processQueue.umd.js"></script>
```

---

## Quick Start

### Basic Queue (Manual Processing)

```typescript
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

const task = queue.getNextItem();
// Process task...
queue.doneProcessing(task!.id);
```

### Auto-Processing with Worker

```typescript
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

queue.on("drain", () => console.log("All done!"));
```

### Priority Queue

```typescript
const queue = new ProcessQueue<Task & { priority: number }>({
  comparator: (a, b) => b.priority - a.priority, // higher priority first
  worker: async (task) => { /* ... */ }
});

queue.queueItem({ id: "low", url: "/bg", priority: 1 });
queue.queueItem({ id: "high", url: "/urgent", priority: 10 }); // processed first
```

### Retry with Backoff

```typescript
const queue = new ProcessQueue<Task>({
  worker: async (task) => { /* might fail */ },
  maxRetries: 3,
  retryDelay: (attempt) => 1000 * Math.pow(2, attempt) // exponential backoff
});

queue.on("failed", (task) => console.log(`Permanently failed: ${task!.id}`));
console.log(queue.getDeadLetterQueue()); // inspect failures
```

---

## Constructor

```typescript
// Options object (recommended)
new ProcessQueue<T>(options?: ProcessQueueOptions<T>)

// Positional args (backward-compatible)
new ProcessQueue<T>(emplace?: boolean, maxSize?: number)
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `emplace` | `boolean` | `false` | Replace items in-place (`true`) or add to front (`false`) |
| `maxSize` | `number` | `1000` | Maximum queue capacity |
| `comparator` | `(a, b) => number` | — | Custom sort (negative = a first) |
| `overflowStrategy` | `'reject' \| 'drop-oldest' \| 'drop-newest'` | `'reject'` | Behavior when full |
| `worker` | `(item) => Promise<void> \| void` | — | Auto-processing function |
| `concurrency` | `number` | `1` | Max parallel worker invocations |
| `maxRetries` | `number` | `0` | Retry attempts on worker failure |
| `retryDelay` | `number \| (attempt) => number` | `0` | Delay between retries (ms) |
| `ttl` | `number` | `0` | Item time-to-live in ms (0 = disabled) |
| `processingTimeout` | `number` | `0` | Max processing duration in ms (0 = disabled) |

---

## API Reference

### Queue Operations

| Method | Returns | Description |
|--------|---------|-------------|
| `queueItem(item)` | `boolean` | Add/update item. Returns `false` if already processing |
| `queueMany(items)` | `boolean[]` | Add multiple items atomically |
| `getNextItem()` | `T \| null` | Dequeue next item, mark as in-process |
| `peek()` | `T \| null` | View next item without removing |
| `removeFromQueue(id)` | `boolean` | Remove item by ID |
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
| `length(prop?, val?)` | `number` | Queue length, optionally filtered by property |
| `isEmpty()` | `boolean` | Queue has no items |
| `clear()` | `void` | Clear queue + in-process + timestamps |

### Flow Control

| Method | Returns | Description |
|--------|---------|-------------|
| `pause()` | `void` | Prevent dequeuing |
| `resume()` | `void` | Re-enable dequeuing + trigger auto-process |
| `start()` | `void` | Alias for `resume()` |
| `stop()` | `void` | Alias for `pause()` |
| `isPaused()` | `boolean` | Check if paused |

### Events

| Method | Description |
|--------|-------------|
| `on(event, handler)` | Register listener |
| `off(event, handler)` | Remove listener |
| `once(event, handler)` | One-time listener |

**Event types:** `added`, `processing`, `done`, `removed`, `empty`, `drain`, `error`, `paused`, `resumed`, `failed`, `expired`, `timeout`

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

```typescript
for (const item of queue) {
  console.log(item.id);
}

const items = [...queue]; // spread operator works
```

---

## License

Published under the [LGPL-2.1 license](https://github.com/mdaemon-technologies/process-queue/blob/main/LICENSE "LGPL-2.1 License").

Published by
**MDaemon Technologies, Ltd.**
**Simple Secure Email**
[https://www.mdaemon.com](https://www.mdaemon.com)
