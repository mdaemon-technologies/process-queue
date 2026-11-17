'use strict';
// The CommonJS entry, resolved through package.json's "exports" -> "require".
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { exercise } = require('./exercise.cjs');

test('require() loads dist/processQueue.cjs', async () => {
  assert.equal(
    require.resolve('@mdaemon/process-queue'),
    path.resolve(__dirname, '..', 'dist', 'processQueue.cjs')
  );
  const ProcessQueue = require('@mdaemon/process-queue');
  // The type declarations use `export default`, so TypeScript's CommonJS output reads .default
  assert.equal(ProcessQueue.default, ProcessQueue, 'require(...).default is the constructor too');
  await exercise(ProcessQueue);
});
