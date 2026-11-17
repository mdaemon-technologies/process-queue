'use strict';
// The UMD bundle, as a <script> tag loads it (window.ProcessQueue) and as a
// CommonJS loader such as webpack 4 sees it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { exercise } = require('./exercise.cjs');

const FILE = path.resolve(__dirname, '..', 'dist', 'processQueue.umd.js');

/**
 * Runs the bundle as a classic script in a fresh context. The package is
 * "type": "module", so Node itself would load a .js file as ESM.
 *
 * @param {object} globals - The context's own globals, besides the host APIs.
 * @returns {object} The context's global object.
 */
function runBundle(globals) {
  // A vm context has the language built-ins but none of the host's APIs.
  // The queue calls these at run time; a browser window has all three.
  const context = Object.assign({ setTimeout, clearTimeout, console }, globals);
  vm.runInNewContext(fs.readFileSync(FILE, 'utf8'), context, { filename: FILE });
  return context;
}

test('dist/processQueue.umd.js defines window.ProcessQueue', async () => {
  const window = runBundle({});
  assert.equal(typeof window.ProcessQueue, 'function');
  await exercise(window.ProcessQueue);
});

test('dist/processQueue.umd.js fills module.exports under a CommonJS loader', async () => {
  const module = { exports: {} };
  const context = runBundle({ module, exports: module.exports });
  assert.equal(context.ProcessQueue, undefined, 'no global is defined');
  assert.equal(typeof module.exports, 'function');
  assert.equal(module.exports.default, module.exports, 'module.exports.default is the constructor too');
  await exercise(module.exports);
});
