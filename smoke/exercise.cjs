'use strict';
/**
 * Smoke checks for the built bundles, shared by the smoke.test.* files.
 *
 * The package supports Node 20 and later. These checks run on every supported
 * Node version with nothing but node:test and node:assert, so they need no
 * install and no TypeScript, and they can run where the toolchain can't.
 * src/moduleLoading.test.ts pins down the bundles' shape in detail; these check
 * that each bundle loads and that every bundled module works.
 *
 * Plain JavaScript on purpose: keep it to syntax and APIs Node 20.0 has.
 *
 * The UMD bundle runs in a vm context, so the arrays, errors and promises it
 * creates belong to another realm. Compare its arrays through ids(), match its
 * errors by name and message, and never use instanceof on what it returns.
 */
const assert = require('node:assert/strict');

/**
 * Runs every check against one loaded constructor.
 *
 * @param {Function} ProcessQueue - The constructor as a consumer receives it.
 * @returns {Promise<void>} Settles once the asynchronous checks have finished.
 */
async function exercise(ProcessQueue) {
  assert.equal(typeof ProcessQueue, 'function', 'the export is the constructor');
  basics(ProcessQueue);
  ordering(ProcessQueue);
  overflow(ProcessQueue);
  events(ProcessQueue);
  optionValidation(ProcessQueue);
  snapshot(ProcessQueue);
  await worker(ProcessQueue);
  await retries(ProcessQueue);
  await expiry(ProcessQueue);
}

/** Queueing, deduplication by id and in-process tracking. */
function basics(ProcessQueue) {
  const queue = new ProcessQueue();
  const first = { id: 'a', n: 1 };
  assert.equal(queue.isEmpty(), true);
  assert.equal(queue.queueItem(first), true);
  assert.equal(queue.queueItem({ id: 'a', n: 2 }), true, 'an update');
  assert.equal(queue.length(), 1, 'an update does not add a second item');
  assert.equal(queue.length('n', 2), 1, 'length filters by property');
  assert.equal(queue.has('a'), true);
  assert.equal(queue.peek().n, 2);
  assert.deepEqual(ids(queue), ['a'], 'the queue is iterable');

  assert.equal(queue.getNextItem().n, 2);
  assert.equal(queue.isProcessing('a'), true);
  assert.equal(queue.busy(), true);
  assert.equal(queue.processSize(), 1);
  assert.equal(queue.queueItem(first), false, 'an id in process is rejected');

  queue.doneProcessing('a');
  assert.equal(queue.busy(), false);
  assert.equal(queue.queueItem(first), true, 'the id can be queued again once done');
  assert.equal(queue.removeFromQueue('a'), true);
  assert.equal(queue.removeFromQueue('a'), false);
  assert.equal(queue.getNextItem(), null);
  assert.throws(() => queue.queueItem({}), { name: 'Error', message: /must have an id/ });
}

/** Default (newest first), emplace (first in, first out) and comparator order. */
function ordering(ProcessQueue) {
  const items = () => [{ id: 1, priority: 1 }, { id: 2, priority: 3 }, { id: 3, priority: 2 }];

  const newestFirst = new ProcessQueue();
  newestFirst.queueMany(items());
  assert.deepEqual(ids(newestFirst.getQueue()), [3, 2, 1]);

  const fifo = new ProcessQueue({ emplace: true });
  fifo.queueMany(items());
  assert.deepEqual(ids(fifo.getQueue()), [1, 2, 3]);
  fifo.queueItem({ id: 1, priority: 9 });
  assert.deepEqual(ids(fifo.getQueue()), [1, 2, 3], 'an emplace update keeps its place');
  assert.equal(fifo.peek().priority, 9);

  const byPriority = new ProcessQueue({ comparator: (a, b) => b.priority - a.priority });
  byPriority.queueMany(items());
  assert.deepEqual(ids(byPriority.getQueue()), [2, 3, 1]);

  assert.deepEqual(ids(byPriority.processBatch(2)), [2, 3]);
  assert.deepEqual(ids(byPriority.getInProcess()), [2, 3]);
  byPriority.doneProcessing();
  assert.equal(byPriority.busy(), false, 'doneProcessing() releases every item');
  assert.deepEqual(ids(byPriority.getQueue(true)), [1], 'getQueue(true) takes the rest');
  assert.equal(byPriority.isEmpty(), true);
}

/** maxSize with each overflow strategy, and the positional constructor form. */
function overflow(ProcessQueue) {
  const fill = queue => { queue.queueItem({ id: 1 }); queue.queueItem({ id: 2 }); return queue; };

  const reject = fill(new ProcessQueue({ maxSize: 2 }));
  assert.throws(() => reject.queueItem({ id: 3 }), { name: 'Error', message: /size limit/ });
  assert.equal(reject.length(), 2);

  const positional = fill(new ProcessQueue(true, 2));
  assert.deepEqual(ids(positional.getQueue()), [1, 2], 'new ProcessQueue(true, 2) is emplace mode');
  assert.throws(() => positional.queueItem({ id: 3 }), { name: 'Error', message: /size limit/ });

  const dropOldest = fill(new ProcessQueue({ maxSize: 2, overflowStrategy: 'drop-oldest' }));
  const removed = [];
  dropOldest.on('removed', item => removed.push(item.id));
  assert.equal(dropOldest.queueItem({ id: 3 }), true);
  assert.deepEqual(ids(dropOldest.getQueue()), [3, 2]);
  assert.deepEqual(removed, [1]);

  const dropNewest = fill(new ProcessQueue({ maxSize: 2, overflowStrategy: 'drop-newest' }));
  assert.equal(dropNewest.queueItem({ id: 3 }), false);
  assert.deepEqual(ids(dropNewest.getQueue()), [2, 1]);
}

/** Event order, once/off, pausing, and a listener that throws. */
function events(ProcessQueue) {
  const queue = new ProcessQueue();
  const log = [];
  for (const event of ['added', 'processing', 'done', 'empty', 'drain', 'paused', 'resumed']) {
    queue.on(event, item => log.push(item === undefined ? event : `${event}:${item.id}`));
  }
  const once = [];
  queue.once('added', item => once.push(item.id));
  const detached = () => log.push('a detached listener ran');
  queue.on('added', detached);
  queue.off('added', detached);

  queue.queueItem({ id: 'x' });
  queue.pause();
  assert.equal(queue.isPaused(), true);
  assert.equal(queue.getNextItem(), null, 'a paused queue hands out nothing');
  queue.resume();
  queue.getNextItem();
  queue.doneProcessing('x');
  queue.queueItem({ id: 'y' });

  assert.deepEqual(log, ['added:x', 'paused', 'resumed', 'processing:x', 'empty', 'done:x', 'drain', 'added:y']);
  assert.deepEqual(once, ['x']);

  const listenerErrors = [];
  const guarded = new ProcessQueue({ onListenerError: (error, event) => listenerErrors.push(`${event}:${error.message}`) });
  guarded.on('added', () => { throw new Error('listener'); });
  assert.equal(guarded.queueItem({ id: 1 }), true, 'a throwing listener does not fail the call');
  assert.equal(guarded.length(), 1);
  assert.deepEqual(listenerErrors, ['added:listener']);
}

/** Out-of-range options are rejected when the queue is constructed. */
function optionValidation(ProcessQueue) {
  assert.throws(() => new ProcessQueue({ maxSize: 0 }), { name: 'RangeError', message: /maxSize/ });
  assert.throws(() => new ProcessQueue({ concurrency: 1.5 }), { name: 'RangeError', message: /concurrency/ });
  assert.throws(() => new ProcessQueue({ overflowStrategy: 'nope' }), { name: 'TypeError', message: /overflowStrategy/ });
  assert.throws(() => new ProcessQueue({ worker: 'nope' }), { name: 'TypeError', message: /worker/ });
}

/** serialize() and the static deserialize() round-trip through JSON. */
function snapshot(ProcessQueue) {
  const queue = new ProcessQueue({ emplace: true });
  queue.queueMany([{ id: 1 }, { id: 2 }]);
  queue.getNextItem();

  const json = JSON.parse(JSON.stringify(queue.serialize()));
  assert.deepEqual(json, { queue: [{ id: 2 }], inProcess: [{ id: 1 }], deadLetterQueue: [], itemState: [] });

  const restored = ProcessQueue.deserialize(json, { emplace: true });
  assert.deepEqual(ids(restored.getQueue()), [2]);
  assert.equal(restored.isProcessing(1), true);
  assert.throws(() => ProcessQueue.deserialize({ queue: 'nope' }), { name: 'TypeError' });

  // A pending retry keeps its attempt count and due time through JSON
  const options = { maxRetries: 2, retryDelay: 60000 };
  const failing = new ProcessQueue({ ...options, worker: () => { throw new Error('work'); } });
  failing.queueItem({ id: 'r' });
  const saved = JSON.parse(JSON.stringify(failing.serialize()));
  failing.clear();
  assert.equal(saved.itemState.length, 1, 'the retry is recorded');
  assert.equal(saved.itemState[0].attempts, 1);
  assert.equal(typeof saved.itemState[0].retryAt, 'number');

  const again = ProcessQueue.deserialize(saved, options);
  assert.equal(again.has('r'), false, 'still awaiting its retry');
  assert.deepEqual(JSON.parse(JSON.stringify(again.serialize())), saved);
  // Cancels the retry timer, so the process can exit
  again.clear();
}

/** An async worker with concurrency, onIdle() and 'drain'. */
async function worker(ProcessQueue) {
  const finished = [];
  const queue = new ProcessQueue({
    emplace: true,
    concurrency: 2,
    worker: async item => { await delay(1); finished.push(item.id); }
  });
  let drains = 0;
  queue.on('drain', () => { drains++; });

  queue.queueMany([{ id: 1 }, { id: 2 }, { id: 3 }]);
  assert.equal(queue.processSize(), 2, 'concurrency limits the runs in flight');
  assert.equal(queue.length(), 1);

  await queue.onIdle();
  assert.deepEqual(finished.sort((a, b) => a - b), [1, 2, 3]);
  assert.equal(drains, 1);
  assert.equal(queue.busy(), false);
}

/** Immediate and delayed retries, and the dead letter queue. */
async function retries(ProcessQueue) {
  const attempts = new Map();
  const count = id => { attempts.set(id, (attempts.get(id) || 0) + 1); return attempts.get(id); };
  const failed = [];
  let errors = 0;
  const queue = new ProcessQueue({
    maxRetries: 2,
    worker: async item => { count(item.id); throw new Error(`fail ${item.id}`); }
  });
  queue.on('error', () => { errors++; });
  queue.on('failed', (item, error) => failed.push(`${item.id}:${error.message}`));

  queue.queueItem({ id: 'bad' });
  await queue.onIdle();
  assert.equal(attempts.get('bad'), 3, 'one attempt plus maxRetries');
  assert.equal(errors, 3);
  // The UMD bundle runs in a vm context, where this realm's Error fails `instanceof Error`,
  // so the queue wraps it: its message then reads "Error: fail bad".
  assert.equal(failed.length, 1);
  assert.match(failed[0], /^bad:(Error: )?fail bad$/);
  assert.deepEqual(ids(queue.getDeadLetterQueue()), ['bad']);
  queue.clearDeadLetterQueue();
  assert.deepEqual(ids(queue.getDeadLetterQueue()), []);

  // A retry delay waits on the bundle's own setTimeout. This item fails only its first attempt.
  const delayed = new ProcessQueue({
    maxRetries: 1,
    retryDelay: 5,
    worker: async item => { if (count(item.id) < 2) throw new Error(`fail ${item.id}`); }
  });
  const done = [];
  delayed.on('done', item => done.push(item.id));
  delayed.queueItem({ id: 'flaky' });
  await delayed.onIdle();
  assert.equal(attempts.get('flaky'), 2);
  assert.deepEqual(done, ['flaky']);
  assert.deepEqual(ids(delayed.getDeadLetterQueue()), []);
}

/**
 * The item TTL and the processing timeout, both read from the clock. Separate
 * queues, so a slow machine can only make each check more certain to pass.
 */
async function expiry(ProcessQueue) {
  const withTtl = new ProcessQueue({ ttl: 5 });
  const expired = [];
  withTtl.on('expired', item => expired.push(item.id));
  withTtl.queueItem({ id: 'stale' });

  const withTimeout = new ProcessQueue({ processingTimeout: 5 });
  const timedOut = [];
  withTimeout.on('timeout', item => timedOut.push(item.id));
  withTimeout.queueItem({ id: 'slow' });
  assert.equal(withTimeout.getNextItem().id, 'slow');

  await delay(20);

  assert.equal(withTtl.getNextItem(), null, 'an expired item is not handed out');
  assert.deepEqual(expired, ['stale']);
  withTimeout.checkProcessingTimeouts();
  assert.deepEqual(timedOut, ['slow']);
  assert.equal(withTimeout.isProcessing('slow'), false);
}

/**
 * The ids of a list of items, as an array of this realm.
 *
 * @param {Iterable<{ id: unknown }>} items - Items from any realm.
 * @returns {unknown[]} Their ids, in order.
 */
function ids(items) {
  return Array.from(items, item => item.id);
}

/**
 * Waits for a number of milliseconds.
 *
 * @param {number} ms - How long to wait.
 * @returns {Promise<void>} Resolves after the delay.
 */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { exercise };
