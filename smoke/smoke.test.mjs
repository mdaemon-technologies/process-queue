// The ES module entry, resolved through package.json's "exports" -> "import".
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import ProcessQueue, * as namespace from '@mdaemon/process-queue';
import smoke from './exercise.cjs';

test('import loads dist/processQueue.mjs', async () => {
  // import.meta.resolve needs a flag before Node 20.6; the import above has
  // already resolved either way, so this only pins down which file it chose.
  if (typeof import.meta.resolve === 'function') {
    assert.equal(
      fileURLToPath(import.meta.resolve('@mdaemon/process-queue')),
      fileURLToPath(new URL('../dist/processQueue.mjs', import.meta.url))
    );
  }
  assert.deepEqual(Object.keys(namespace), ['default'], 'the only export is the default');
  await smoke.exercise(ProcessQueue);
});
