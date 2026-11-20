# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.2.0] - 2026-11-20

Queue operations no longer slow down as the queue grows. Adding, finding, updating, taking and removing items, and `drop-oldest` evictions, used to scan or shift the whole queue, so filling or draining a large queue took quadratic time, and with a `ttl` every take scanned the queue twice. They now take constant time, or logarithmic time with a `ttl`. Behavior, events, `serialize()` output and the public types are unchanged, apart from the edge cases listed under Changed and Fixed.

### Changed
- Performance: the queue is a doubly linked list indexed by id instead of an array. Finding, adding at the front or back, updating, taking from the front and removing an item are O(1). `drop-oldest` finds the earliest arrival in O(1) through a second list kept in arrival order. With a `ttl`, each of these also updates a heap of enqueue times, so they are O(log n), and checking for expired items is O(1) when none have expired; k expired items cost O(k log n). Placing an item with a `comparator` still scans the queue (O(n)). Items are now found by the id they had when queued, so if a queued item's id is changed (which the README already says not to do), `has()`, `removeFromQueue()` and `queueItem()` still treat it under its old id; 3.1.0 used the new one. Measured on Node 22 (Windows, `maxSize: Infinity` except for `drop-oldest`), adding n items with `queueItem` and then draining them with `getNextItem()`, 3.1.0 → 3.2.0:

  | Options | n = 10,000 (add / drain) | n = 20,000 (add / drain) | n = 40,000 (add / drain) |
  |---|---|---|---|
  | defaults | 119 / 105 ms → 27 / 15 ms | 580 / 507 ms → 18 / 23 ms | 3,191 / 1,926 ms → 42 / 29 ms |
  | `emplace: true` | 76 / 13 ms → 9 / 21 ms | 455 / 578 ms → 13 / 12 ms | 1,783 / 1,845 ms → 38 / 54 ms |
  | `ttl: 3_600_000` | 99 / 1,985 ms → 17 / 24 ms | 418 / 8,702 ms → 25 / 17 ms | 2,668 / 57,374 ms → 56 / 47 ms |
  | `drop-oldest`, n more items into a full queue of `maxSize: n` | 4,182 ms → 23 ms | 14,304 ms → 22 ms | 63,265 ms → 103 ms |

  The bundles are about 2 KB larger (about 0.7 KB gzipped).
- Iterating the queue while it changes no longer skips or repeats items. An item removed or taken before the loop reaches it is skipped, and no item is visited twice unless it is re-queued. While the item the loop is on stays queued, an item added later in processing order is visited and one added earlier is not; once that item is removed, the loop carries on from the item that followed it at that moment. An iterator left standing on a removed item holds none of the removed items. Previously the iterator worked by index, so taking the current item skipped the next one and adding at the front visited the current item again. Iteration without changes is unchanged.
- A `comparator` that adds, takes or removes items while an item is being placed now makes that placement throw `Error: ProcessQueue: the comparator changed the queue` before the item is queued: `queueItem` throws it, and a retried item is dead-lettered with it, as for a comparator that throws. Previously the item was inserted at a position computed before the change, which could put it in the wrong place or remove the wrong item. The README already said the comparator must not call back into the queue.
- Development: `fast-check` is a new dev dependency. A differential property test drives the new queue and the 3.1.0 array implementation (kept as a test-only copy, excluded from the build) with random operations in every combination of `emplace`, comparator, `ttl`, `maxSize` and overflow strategy, and checks that they agree after every step. Complexity tests count reads of item ids, or time the operations at sizes where 3.1.0 took 25 s or more, against a limit of 10 s that allows for a busy machine.

### Fixed
- A failed item stays in process while a `retryDelay` function decides its delay. Previously the item was already out of process and not yet awaiting its retry, so for the length of that call the queue held it nowhere, with four effects. A `retryDelay` function could queue the failing id, and the retry then queued it a second time; if a worker had started that copy, the id was in process and queued at once, and with a delay `serialize()` listed it twice, so `deserialize` rejected the snapshot. A `serialize()` call left the item out of the snapshot. `drain` could be emitted, and `onIdle()` resolve, although a retry was coming. And a `clear()` was undone when the retry entered the queue. Now, while a `retryDelay` function runs, `isProcessing(id)` is `true`, `queueItem` returns `false` for the id, `serialize()` lists the item in `inProcess`, the queue is not idle, and the failed run keeps its concurrency slot until the function returns. If the function releases the run (`doneProcessing(id)`, `doneProcessing()`, `clear()`, or a `checkProcessingTimeouts()` that times it out), the failure is ignored, as for any released run: no retry, no `error` or `failed` event, and no dead-lettering, even if the function then throws. As a precaution, the queue also never holds an id twice: a retry that finds its id already queued replaces the queued copy.
- `processBatch()` with a batch size whose `valueOf` changes the queue no longer loses items: the queue's length is read after the size is converted. Previously an item queued by `valueOf` could push a queued item out of the queue unseen.

## [3.1.0] - 2026-11-17

Snapshots now carry what a restored queue needs to continue exactly where the original stopped, and the `error` event says whether the item will be retried. Together they let a wrapper keep a durable log of the queue's state and rebuild it after a crash.

### Added
- The `error` event passes a third argument, `retry` (`{ attempt, delay }`), when the item will be retried: `attempt` is the number of failures so far (the value a `retryDelay` function receives) and `delay` is the wait in ms after normalizing, `0` meaning the item is already queued again. It is `undefined` when the item is about to move to the dead letter queue, including when `retryDelay` throws or the comparator throws as the item re-enters the queue. `EventHandler` gains the same optional third parameter.
- `serialize()` returns `itemState`: for queued and in-process items that have any, the failed `attempts`, the `retryAt` of an item awaiting a retry, and the `enqueuedAt` time the TTL counts from (only with a `ttl`). Times are milliseconds since the epoch. Items awaiting a retry are still listed at the front of `queue`, so 3.0's `deserialize` reads the new snapshots as it read its own.
- `RetryInfo` and `ItemState` type exports.

### Changed
- `deserialize` restores `itemState` when the snapshot has it:
  - Restored items keep their failed attempts, so they only get their remaining retries. Previously every restored item started with its full retry budget.
  - Items awaiting a retry stay reserved until their `retryAt` (re-entering on the next timer tick if it has passed), instead of being queued immediately. Until then `serialize()` reports that same `retryAt`, so saving and restoring repeatedly never moves it. Like a new item, one coming due starts processing in a restored worker queue that has not been started, unless the queue is paused.
  - Queued items are subject to the TTL from their `enqueuedAt` rather than from the moment of restore. Retried items (with `attempts` but no `enqueuedAt`, and items awaiting a retry) stay exempt from the TTL, as they are while the queue runs; previously they became subject to it from the moment of restore.
  - Malformed `itemState` throws a `TypeError`: an entry that is not an object with a valid ID, an ID that is not queued or in process or is repeated, `attempts` that is not an integer ≥ 0, a `retryAt` or `enqueuedAt` that is not a finite number, or either one on an in-process item. Unknown fields are ignored.

  Snapshots without `itemState` restore exactly as before.
- `serialize()` is typed `Required<Snapshot<T>>` as before, so its return type now includes `itemState`. Only code that builds a `Required<Snapshot<T>>` object by hand needs to add it.
- Development: the source, tests, type fixtures and smoke tests are linted with ESLint 10 and typescript-eslint's recommended rules (`npm run lint`), and CI and the publish workflow run it before building, as does `npm run pub`. typescript-eslint needs the TypeScript 6 API, so `typescript` is now an alias of `@typescript/typescript6` and TypeScript 7, which still builds the declarations and type-checks, is installed as `@typescript/native`. The bundles and declarations are unchanged by this.
- Development: CI and the publish workflow install npm 11 before `npm ci`. `package-lock.json` is written by npm 11, and Node 22's npm 10 rejected it as out of sync: it tries to fill typescript-eslint's unmet optional peer `@typescript/native` (which wants a TypeScript 7.1 nightly) with that day's nightly, where npm 11 leaves it unfilled.

## [3.0.2] - 2026-11-17

Build and tooling release. The public API, its types and the supported Node versions are unchanged; the bundles are rebuilt with the new toolchain.

### Added
- Consumer type fixtures (`test-types/`), type-checked by `npm test` against the built declarations through the package's `exports` map: as ES module and CommonJS code under `nodenext` resolution, and under `bundler` resolution.
- `recipes.md`, linked from a new Recipes section in the README: production patterns for coalescing webhook bursts, calling a rate-limited API with a dead letter queue, prioritizing interactive work, batching writes with bounded memory, syncing offline edits in the browser, and shutting down gracefully, plus when to use a durable broker instead.

### Changed
- Built with Vite 8 instead of Rollup, and tested with Vitest 5 instead of Jest. The bundles keep their names, formats and exports, and the type declarations are unchanged apart from the TypeScript 7 quote style below.
- Minified with Vite's built-in Oxc minifier instead of terser, which is no longer a dependency. The CommonJS and UMD bundles are fully minified and about 1% smaller. As Vite does for libraries, the ES module bundle (`processQueue.mjs`) keeps its whitespace and its `/* @__PURE__ */` annotations, so bundlers can tree-shake it; it is larger before compression (19.1 KB, was 15.7 KB), and a consumer's bundler minifies it as usual.
- Building and testing the package needs Node 22.12 or later. The package itself still supports Node 20: CI runs the full suite on Node 22, 24 and 26, and a dependency-free `node:test` smoke suite (`npm run test:smoke`) checks the bundles built on Node 24 on Node 20 too. The publish workflow publishes that same tested build, and both workflows pin their actions to commit SHAs.
- `npm test` type-checks the source and tests with `tsc` before running Vitest, which does not type-check.
- The type declarations are built and the source type-checked with TypeScript 7, the native compiler. The declarations are unchanged apart from quote style: `OVERFLOW_STRATEGIES` is declared as `readonly ['reject', 'drop-oldest', 'drop-newest']`, which is the same type.

## [3.0.1] - 2026-09-21

### Changed
- `package.json` declares `"engines": { "node": ">=20" }`, so npm warns when installing on an older Node, and the README's Node badge reads the supported version from it.
- README: the version, license and Node badges read from the npm registry, and a new Usage section shows ES module, CommonJS and browser (UMD) imports.

## [3.0.0] - 2026-09-18

Security and robustness release, plus an internal restructure along DRY and SOLID lines. Several fixes change observable behavior, hence the major version.

### Added
- `maxDeadLetterSize` and `onListenerError` options.
- `onIdle()`: a promise that resolves when nothing is queued, in process or awaiting a retry, immediately if that is already the case. Unlike a `drain` listener, it cannot miss work that finished before it was called.
- `ProcessQueueEvents<T>`: the handler signature of each event, used by `on`, `off` and `once`. For example, a `failed` handler receives `(item: T, error: Error)` rather than `(item?: T | T[], error?: Error)`.
- Named type exports: `Item`, `ItemID`, `OverflowStrategy`, `ProcessQueueEvent`, `ProcessQueueEvents`, `ProcessQueueOptions` and `EventHandler`.
- Item types may be declared as interfaces. `Item` now only requires an `id`; previously its string index signature rejected interfaces, so the README's own Quick Start (`interface Task`) did not compile. `new ProcessQueue()` without a type argument still accepts items with any extra properties.

### Changed
- **BREAKING:** An exception thrown by an event listener no longer propagates to the caller (for example out of `queueItem`). It is passed to the new `onListenerError` option instead, which defaults to `console.error`.
- **BREAKING:** Invalid options now throw when the queue is constructed: `RangeError` for out-of-range numbers (such as `maxSize: NaN`, `concurrency: 0`, `maxRetries: Infinity`, or `ttl`/`processingTimeout` of `Infinity`; use `0` to disable those), `TypeError` for a non-function callback or an unknown `overflowStrategy`.
- **BREAKING:** `ProcessQueue.deserialize` validates the snapshot and throws on malformed data, invalid items, duplicate IDs across `queue` and `inProcess`, or a `queue` larger than `maxSize` (`maxSize + concurrency` with a worker, since pending retries are serialized in `queue`). With a `worker`, restored in-process items are queued again at the front, and may not exceed `concurrency`.
- **BREAKING:** The dead letter queue is capped by the new `maxDeadLetterSize` option (default 1000); the oldest entries are dropped first.
- **BREAKING:** `queueItem` returns `false` for an ID that is awaiting a retry.
- **BREAKING:** Items awaiting a retry count toward `maxSize`. While they fill the queue, a new item is rejected (`reject`) or dropped (`drop-oldest`, `drop-newest`). Previously failed items could accumulate outside the limit without bound.
- **BREAKING:** `NaN` is rejected as an item ID, and `queueItem(null)` throws the library's "Invalid queue item" error.
- **BREAKING:** `drop-oldest` evicts the earliest-arrived item in every mode (previously it removed the item at the back of the queue, which in `emplace` and comparator modes could be the newest) and emits `removed` for the evicted item.
- **BREAKING:** `drain` is emitted once each time the queue becomes idle (nothing queued, in process or awaiting a retry), so not while a retry is pending. Previously it was emitted whenever a check found the queue idle, so `checkProcessingTimeouts()`, `doneProcessing()` and `clear()` emitted it again on an idle queue, one call could emit it twice, and a `drain` listener that called `clear()` triggered itself until the stack overflowed.
- **BREAKING:** `empty` is emitted only when the queue goes from having items to having none. Previously it was emitted by many operations whenever the queue happened to be empty (for example every `doneProcessing()` call, and `clear()` on an already-empty queue). With a worker, it is emitted when the worker takes the last item rather than when that item finishes, and an expiry that empties the queue now emits it.
- **BREAKING:** Event handlers are typed per event (see *Added*). A handler explicitly annotated with a required parameter, such as `(item: Job | Job[]) => …`, no longer compiles for the payload-free events `empty`, `drain`, `paused` and `resumed`. Unannotated handlers, handlers typed as `EventHandler<T>`, and handlers passed with an event name held in a variable still compile.
- **BREAKING:** Callback options (`worker`, `comparator`, `retryDelay`, `onListenerError`) are called as plain functions. Previously a non-arrow callback saw the queue as `this`.
- Internal restructure: `ProcessQueue` now coordinates internal modules (options, event bus, ordered queue, in-flight tracking, retry tracking, dead letter queue, snapshot validation), each with its own unit tests. Runtime behavior is unchanged apart from the entries in this release's other sections.
- `deserialize`:
  - With a comparator, restored items are put in priority order.
  - With a worker, `queue` and `inProcess` together may hold at most `maxSize + concurrency` items.
  - Restored queued items are subject to the TTL from the moment of restore, including items that were awaiting a retry (previously restored items never expired).
  - Without a worker, restored in-process items are subject to `processingTimeout` from the moment of restore (previously they never timed out).
- `Snapshot<T>` is exported and is the return type of `serialize()` and the parameter type of `deserialize()`. `ListenerFor<T, E>`, the handler type `on`, `off` and `once` accept, is exported too.
- Removed the stale `dist/processQueue.js` from the published package; the package contents are now defined by `files` in `package.json`.
- Type declarations use file extensions on relative imports, so they resolve under `node16`/`nodenext` module resolution for ES module consumers. CommonJS TypeScript consumers should use `nodenext` or `bundler` resolution; under `node16`, TypeScript refuses to `require` the package's ESM-flavored declarations (as in 2.0.2).
- The CommonJS and UMD bundles also expose the constructor as `.default`, matching the `export default` in the type declarations. TypeScript code compiled to CommonJS reads `.default`, which was `undefined` at runtime.
- Removed the hand-written `dist/processQueue.{cjs,mjs,umd}.d.ts` files. TypeScript never resolved them, and they declared a named `ProcessQueue` export that no bundle provides.
- The README's Node.js badge says 20+, matching the CI matrix (20.x–26.x).
- The README's install instructions imported `dist/processQueue.cjs` and `dist/processQueue.mjs` directly. The package's `exports` map (since 2.0.1) does not allow those paths, so they failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`; the README now imports the package root.

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

## [2.0.0] - 2026-05-06

### Added
- **Introspection & Batch Operations:**
  - `peek()` — view next item without dequeuing
  - `has(id)` — check if an item exists in the queue by ID
  - `getInProcess()` — retrieve all items currently being processed
  - `queueMany(items)` — add multiple items atomically
  - `doneProcessing(ids[])` — mark multiple items done at once (accepts single ID or array)
  - `Symbol.iterator` support — iterate with `for...of` or spread operator
- **Priority & Ordering:**
  - Options object constructor: `new ProcessQueue({ emplace, maxSize, comparator, ... })`
  - `comparator` option — custom sort function for priority-based ordering
  - Backward-compatible: positional `(emplace, maxSize)` constructor still works
- **Events / Lifecycle:**
  - Built-in zero-dependency event emitter (browser-compatible)
  - `on(event, handler)` — register event listener
  - `off(event, handler)` — remove event listener
  - `once(event, handler)` — one-time listener
  - Events: `added`, `processing`, `done`, `removed`, `empty`, `drain`, `error`, `paused`, `resumed`, `failed`, `expired`, `timeout`
- **Pause / Resume:**
  - `pause()` — prevent dequeuing (getNextItem/processBatch return null/empty)
  - `resume()` — re-enable dequeuing
  - `isPaused()` — check pause state
  - `start()` / `stop()` — aliases for resume/pause (convenient in worker mode)
- **Overflow Strategy:**
  - `overflowStrategy` option: `'reject'` (throw, default), `'drop-oldest'`, `'drop-newest'`
  - Configurable behavior when queue reaches `maxSize`
- **Worker & Concurrency (Auto-Processing):**
  - `worker` option — function that auto-processes items as they're queued
  - `concurrency` option — max parallel worker invocations (default 1)
  - Supports both sync and async worker functions
  - Worker errors emit `error` event
- **Retry & Dead Letter Queue:**
  - `maxRetries` option — retry failed items (default 0 = no retry)
  - `retryDelay` option — fixed ms delay or `(attempt) => ms` backoff function
  - `getDeadLetterQueue()` — retrieve permanently failed items
  - `clearDeadLetterQueue()` — clear the DLQ
  - `failed` event — emitted when item exhausts all retries
- **TTL & Processing Timeout:**
  - `ttl` option — items auto-expire from queue after specified ms
  - `processingTimeout` option — track items that exceed processing duration
  - `checkProcessingTimeouts()` — manually trigger timeout check
  - `expired` event — emitted for TTL-expired items
  - `timeout` event — emitted for processing-timeout items
- **Serialization:**
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

[3.2.0]: https://www.npmjs.com/package/@mdaemon/process-queue/v/3.2.0
[3.1.0]: https://www.npmjs.com/package/@mdaemon/process-queue/v/3.1.0
[3.0.2]: https://www.npmjs.com/package/@mdaemon/process-queue/v/3.0.2
[3.0.1]: https://www.npmjs.com/package/@mdaemon/process-queue/v/3.0.1
[3.0.0]: https://www.npmjs.com/package/@mdaemon/process-queue/v/3.0.0
[2.0.0]: https://www.npmjs.com/package/@mdaemon/process-queue/v/2.0.0
