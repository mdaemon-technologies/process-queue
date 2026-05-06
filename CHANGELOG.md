# Changelog

## [2.0.0] - 2026-05-05

### Added

#### Introspection & Batch Operations
- `peek()` — view next item without dequeuing
- `has(id)` — check if an item exists in the queue by ID
- `getInProcess()` — retrieve all items currently being processed
- `queueMany(items)` — add multiple items atomically
- `doneProcessing(ids[])` — mark multiple items done at once (accepts single ID or array)
- `Symbol.iterator` support — iterate with `for...of` or spread operator

#### Priority & Ordering
- Options object constructor: `new ProcessQueue({ emplace, maxSize, comparator, ... })`
- `comparator` option — custom sort function for priority-based ordering
- Backward-compatible: positional `(emplace, maxSize)` constructor still works

#### Events / Lifecycle
- Built-in zero-dependency event emitter (browser-compatible)
- `on(event, handler)` — register event listener
- `off(event, handler)` — remove event listener
- `once(event, handler)` — one-time listener
- Events: `added`, `processing`, `done`, `removed`, `empty`, `drain`, `error`, `paused`, `resumed`, `failed`, `expired`, `timeout`

#### Pause / Resume
- `pause()` — prevent dequeuing (getNextItem/processBatch return null/empty)
- `resume()` — re-enable dequeuing
- `isPaused()` — check pause state
- `start()` / `stop()` — aliases for resume/pause (convenient in worker mode)

#### Overflow Strategy
- `overflowStrategy` option: `'reject'` (throw, default), `'drop-oldest'`, `'drop-newest'`
- Configurable behavior when queue reaches `maxSize`

#### Worker & Concurrency (Auto-Processing)
- `worker` option — function that auto-processes items as they're queued
- `concurrency` option — max parallel worker invocations (default 1)
- Supports both sync and async worker functions
- Worker errors emit `error` event

#### Retry & Dead Letter Queue
- `maxRetries` option — retry failed items (default 0 = no retry)
- `retryDelay` option — fixed ms delay or `(attempt) => ms` backoff function
- `getDeadLetterQueue()` — retrieve permanently failed items
- `clearDeadLetterQueue()` — clear the DLQ
- `failed` event — emitted when item exhausts all retries

#### TTL & Processing Timeout
- `ttl` option — items auto-expire from queue after specified ms
- `processingTimeout` option — track items that exceed processing duration
- `checkProcessingTimeouts()` — manually trigger timeout check
- `expired` event — emitted for TTL-expired items
- `timeout` event — emitted for processing-timeout items

#### Serialization
- `serialize()` — export queue state as JSON-compatible snapshot
- `ProcessQueue.deserialize(data, options?)` — restore queue from snapshot
- Round-trip safe: preserves queue order, in-process state, and DLQ

### Changed
- Constructor now accepts an options object in addition to positional args
- `doneProcessing()` signature extended to accept `ItemID | ItemID[]`
- Internal architecture refactored for event emission and worker lifecycle
- Upgraded TypeScript from 5.8.3 to 6.0.3
- Upgraded ts-jest from 29.3.2 to 29.4.9 (TS6 peer dependency support)
- Upgraded @rollup/plugin-typescript to 12.3.0
- Upgraded @rollup/plugin-terser to 1.0.0
- Updated `tsconfig.json`:
  - `moduleResolution` changed from `"node"` to `"bundler"`
  - `target` changed from `"es2015"` to `"es2022"`
  - Added `"rootDir": "./src"` (required by TS6 default change)
  - Added `"types": ["node", "jest"]` (required by TS6 default change)
