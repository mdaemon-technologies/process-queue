# Changelog

## [3.0.0] - 2026-09-18

Security and robustness release, plus an internal restructure along DRY and SOLID lines. Several fixes change observable behavior, hence the major version.

### Breaking Changes
- An exception thrown by an event listener no longer propagates to the caller (for example out of `queueItem`). It is passed to the new `onListenerError` option instead, which defaults to `console.error`.
- Invalid options now throw when the queue is constructed: `RangeError` for out-of-range numbers (such as `maxSize: NaN`, `concurrency: 0`, `maxRetries: Infinity`, or `ttl`/`processingTimeout` of `Infinity`; use `0` to disable those), `TypeError` for a non-function callback or an unknown `overflowStrategy`.
- `ProcessQueue.deserialize` validates the snapshot and throws on malformed data, invalid items, duplicate IDs across `queue` and `inProcess`, or a `queue` larger than `maxSize` (`maxSize + concurrency` with a worker, since pending retries are serialized in `queue`). With a `worker`, restored in-process items are queued again at the front, and may not exceed `concurrency`.
- The dead letter queue is capped by the new `maxDeadLetterSize` option (default 1000); the oldest entries are dropped first.
- `queueItem` returns `false` for an ID that is awaiting a retry.
- Items awaiting a retry count toward `maxSize`. While they fill the queue, a new item is rejected (`reject`) or dropped (`drop-oldest`, `drop-newest`). Previously failed items could accumulate outside the limit without bound.
- `NaN` is rejected as an item ID, and `queueItem(null)` throws the library's "Invalid queue item" error.
- `drop-oldest` evicts the earliest-arrived item in every mode (previously it removed the item at the back of the queue, which in `emplace` and comparator modes could be the newest) and emits `removed` for the evicted item.
- `drain` is emitted once each time the queue becomes idle (nothing queued, in process or awaiting a retry), so not while a retry is pending. Previously it was emitted whenever a check found the queue idle, so `checkProcessingTimeouts()`, `doneProcessing()` and `clear()` emitted it again on an idle queue, one call could emit it twice, and a `drain` listener that called `clear()` triggered itself until the stack overflowed.
- `empty` is emitted only when the queue goes from having items to having none. Previously it was emitted by many operations whenever the queue happened to be empty (for example every `doneProcessing()` call, and `clear()` on an already-empty queue). With a worker, it is emitted when the worker takes the last item rather than when that item finishes, and an expiry that empties the queue now emits it.
- Event handlers are typed per event (see *Added*). A handler explicitly annotated with a required parameter, such as `(item: Job | Job[]) => …`, no longer compiles for the payload-free events `empty`, `drain`, `paused` and `resumed`. Unannotated handlers, handlers typed as `EventHandler<T>`, and handlers passed with an event name held in a variable still compile.
- Callback options (`worker`, `comparator`, `retryDelay`, `onListenerError`) are called as plain functions. Previously a non-arrow callback saw the queue as `this`.

### Fixed
- A throwing `done` listener made the worker re-run a successful item indefinitely, starving the event loop.
- A throwing `error` listener or `retryDelay` function caused an unhandled promise rejection, which terminates Node.js. A throwing `retryDelay` now moves the item to the dead letter queue.
- A throwing `processing` listener left the item in-process forever, stalling the worker.
- Many failing synchronous items, or many immediate synchronous retries, overflowed the call stack.
- An item could be queued again under the same ID while its retry was pending, so it was processed twice. `clear()` now cancels pending retries, `removeFromQueue` can cancel one, and `serialize()` includes items awaiting a retry.
- After a processing timeout, the timed-out run's late result could complete a newer run of the same ID. Late results from runs released by a timeout, `clear()` or `doneProcessing()` are now ignored, and `checkProcessingTimeouts()` starts queued work in the freed slot.
- Re-queuing an in-flight ID with `drop-oldest` evicted an unrelated item; updating an already-queued item in a full queue threw or was dropped.
- A worker that changed `item.id` left the item in-process forever. If such an item then fails, it is dead-lettered instead of retried (previously it could retry forever under the changed ID).
- A failure with a delayed retry left the worker's concurrency slot idle until the retry timer fired, stalling other queued work.
- An `error` listener that re-queued the failed item's ID created a duplicate alongside the retry. The retry is now reserved before `error` is emitted: with `retryDelay: 0` the re-queue replaces the retry; with a delay, `queueItem` returns `false`.
- `doneProcessing()` on a worker-mode item now starts the next queued item immediately.
- A `removed` listener running during a `drop-oldest` eviction, or an `expired` listener that changed the queue, could create duplicate IDs, skip expiry of an item, or throw a `TypeError` (from a retry timer, an uncaught exception). Events are now emitted only after the queue is consistent.
- A worker returning a thenable whose `then` throws (or whose `then` getter throws) escaped `queueItem` and stranded the item in-process; it is now treated as a worker failure.
- A `retryDelay` function returning a value that cannot be converted to a number threw out of the queue and lost the item; the item now goes to the dead letter queue.
- A listener that re-queued an item's ID from `done`, or from the final `error` before dead-lettering, could give the new run a stale or wiped retry count.
- A throwing comparator could lose the item being updated, the evicted item and the new item; the queue is now left unchanged.
- `pause()` called from a listener or a synchronous worker did not stop the current processing loop.
- A run released by a `processing` listener (for example with `clear()`) still invoked the worker.
- Retry counts leaked when an item left through `removeFromQueue`, eviction, expiry, `doneProcessing()` or a processing timeout, so a later item with the same ID started with a reduced retry budget.
- With a comparator, retried items are re-inserted in priority order rather than at the front. If the comparator throws, the item goes to the dead letter queue.
- A `retryDelay` function returning more than 2^31-1 ms (or `Infinity`) retried after about 1 ms; the delay is now clamped to the maximum timer delay.
- `length(prop, val)` only filtered when the first queued item had `prop`; otherwise it returned the total length.
- When expiry emptied the queue with nothing in process, `drain` was never emitted, so code waiting for `drain` could wait forever.
- `clear()` emitted `drain` even when an `empty` listener had refilled the queue.
- `processBatch` ignored the TTL, never applied the processing timeout, and leaked internal bookkeeping.
- A `once` listener registered during an emit fired immediately in the same emit. Listeners now follow the DOM `EventTarget` rules: a listener added during an emit is first called on the next emit (this also applies to `on`), and a listener removed during an emit is not called again, even later in that emit.
- On an item's final failure, `error` fired before the item was in the dead letter queue, so a listener saving state with `serialize()` lost the item. The item is now dead-lettered before `error` and `failed` are emitted.
- A queue restored with `deserialize` and a worker never processed anything if the snapshot had in-process items.

### Added
- `maxDeadLetterSize` and `onListenerError` options.
- `onIdle()`: a promise that resolves when nothing is queued, in process or awaiting a retry, immediately if that is already the case. Unlike a `drain` listener, it cannot miss work that finished before it was called.
- `ProcessQueueEvents<T>`: the handler signature of each event, used by `on`, `off` and `once`. For example, a `failed` handler receives `(item: T, error: Error)` rather than `(item?: T | T[], error?: Error)`.
- Named type exports: `Item`, `ItemID`, `OverflowStrategy`, `ProcessQueueEvent`, `ProcessQueueEvents`, `ProcessQueueOptions` and `EventHandler`.
- Item types may be declared as interfaces. `Item` now only requires an `id`; previously its string index signature rejected interfaces, so the README's own Quick Start (`interface Task`) did not compile. `new ProcessQueue()` without a type argument still accepts items with any extra properties.

### Changed
- Internal restructure: `ProcessQueue` now coordinates internal modules (options, event bus, ordered queue, in-flight tracking, retry tracking, dead letter queue, snapshot validation), each with its own unit tests. Runtime behavior is unchanged apart from the entries in this release's other sections.
- `deserialize`:
  - With a comparator, restored items are put in priority order.
  - With a worker, `queue` and `inProcess` together may hold at most `maxSize + concurrency` items.
  - Restored queued items are subject to the TTL from the moment of restore, including items that were awaiting a retry (previously restored items never expired).
  - Without a worker, restored in-process items are subject to `processingTimeout` from the moment of restore (previously they never timed out).
- `Snapshot<T>` is exported and is the return type of `serialize()` and the parameter type of `deserialize()`. `ListenerFor<T, E>`, the handler type `on`, `off` and `once` accept, is exported too.

### Packaging
- Removed the stale `dist/processQueue.js` from the published package; the package contents are now defined by `files` in `package.json`.
- Type declarations use file extensions on relative imports, so they resolve under `node16`/`nodenext` module resolution for ES module consumers. CommonJS TypeScript consumers should use `nodenext` or `bundler` resolution; under `node16`, TypeScript refuses to `require` the package's ESM-flavored declarations (as in 2.0.2).
- The CommonJS and UMD bundles also expose the constructor as `.default`, matching the `export default` in the type declarations. TypeScript code compiled to CommonJS reads `.default`, which was `undefined` at runtime.
- Removed the hand-written `dist/processQueue.{cjs,mjs,umd}.d.ts` files. TypeScript never resolved them, and they declared a named `ProcessQueue` export that no bundle provides.

### Documentation
- The README's Node.js badge says 20+, matching the CI matrix (20.x–26.x).
- The README's install instructions imported `dist/processQueue.cjs` and `dist/processQueue.mjs` directly. The package's `exports` map (since 2.0.1) does not allow those paths, so they failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`; the README now imports the package root.

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
