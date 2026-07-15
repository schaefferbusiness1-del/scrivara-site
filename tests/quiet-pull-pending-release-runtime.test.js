'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const marker = ' * v2.9.5 QUIET PULL (__mlsQp)';
const markerAt = background.indexOf(marker);
assert(markerAt >= 0, 'quiet-pull marker missing');
const start = background.indexOf('(function ()', markerAt);
const end = background.indexOf('\n})();', start);
assert(start >= 0 && end > start, 'quiet-pull IIFE missing');
let source = background.slice(start, end + '\n})();'.length);
source = source
  .replace('var QP_SERIAL_WAIT_MS = 5000;', 'var QP_SERIAL_WAIT_MS = 30;')
  .replace('var QP_PENDING_RELEASE_MS = 1500;', 'var QP_PENDING_RELEASE_MS = 20;')
  .replace('var QP_RESTORE_WAIT_MS = 8000;', 'var QP_RESTORE_WAIT_MS = 40;');

assert(source.includes('QP.epoch = Number(QP.epoch || 0) + 1;'), 'terminal release does not supersede waiting ensures');
assert(source.includes('qpAwaitBound(pendingAtRelease, QP_PENDING_RELEASE_MS)'), 'pending ensure is still awaited without a bound');
assert(source.includes("qpRelease('late-pending-ensure')"), 'late-settling ensure lacks a cleanup backstop');

let browserActions = 0;
const context = {
  console, Promise, Date, Math, Number, String, Object, Array, RegExp, JSON,
  setTimeout, clearTimeout,
  setInterval() { return 1; }, clearInterval() {},
  mlsReadFocusWouldYank: async () => false,
  self: null,
  chrome: {
    alarms: {
      create() {}, clear() {},
      onAlarm: { addListener() {} }
    },
    storage: {
      session: {
        set() {},
        get(_keys, callback) { callback({}); }
      }
    },
    scripting: {
      executeScript() { browserActions++; return Promise.resolve([{ result: 'visible' }]); }
    },
    tabs: {
      get() { browserActions++; return Promise.resolve({ id: 77, windowId: 1, index: 0, active: false }); },
      update() { browserActions++; return Promise.resolve({}); },
      move() { browserActions++; return Promise.resolve({}); }
    },
    windows: {
      getLastFocused() { browserActions++; return Promise.resolve({ id: 1, state: 'normal', left: 0, top: 0, width: 1200, height: 800, tabs: [] }); },
      get() { browserActions++; return Promise.resolve({ id: 1, state: 'normal', left: 0, top: 0, width: 1200, height: 800, tabs: [] }); },
      update() { browserActions++; return Promise.resolve({}); },
      create() { browserActions++; return Promise.resolve({ id: 2 }); }
    }
  }
};
context.self = context;
vm.runInNewContext(source, context, { filename: 'quiet-pull-pending-release.js', timeout: 1000 });

(async () => {
  const never = new Promise(() => {});
  context.__mlsQp.pending = never;
  context.__mlsQp.active = false;
  context.__mlsQp.hostOrig = null;

  const releaseStart = Date.now();
  await Promise.race([
    context.__mlsQpRelease('test-terminal'),
    new Promise((_, reject) => setTimeout(() => reject(new Error('qpRelease remained blocked by QP.pending')), 250))
  ]);
  assert(Date.now() - releaseStart < 250, 'qpRelease did not honor its pending-operation bound');
  assert.strictEqual(context.__mlsQp.epoch, 1, 'terminal release did not advance the cancellation epoch');

  const beforeEnsureActions = browserActions;
  const ensureStart = Date.now();
  const ensureResult = await Promise.race([
    context.__mlsQpEnsure({ id: 77, windowId: 1, index: 0 }, 4),
    new Promise((_, reject) => setTimeout(() => reject(new Error('qpEnsure remained blocked by stale QP.pending')), 250))
  ]);
  assert.strictEqual(ensureResult, 'limp');
  assert(Date.now() - ensureStart < 250, 'qpEnsure did not honor its serialization bound');
  assert.strictEqual(browserActions, beforeEnsureActions, 'a new ensure touched Chrome while prior window surgery remained unresolved');

  console.log('PASS quiet-pull terminal release bounds stalled setup and suppresses late window surgery');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
