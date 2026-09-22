'use strict';
/* qpidle-1.0.0 (MLS Assist 3.0.113): a quiet-work lease whose run has ended is
 * released even when the service worker slept through the 2-minute quiet window.
 *
 * Before: the lease was restored after every worker wake with
 * `QP.lastUse = Date.now()`, and the waking mlsQpWatch alarm was handled before
 * the stored lease was even adopted. Every alarm therefore re-armed a fresh
 * 120 s and the lease was never released: it kept overriding the user's tab pin
 * and binding "explicit" captures to its own Athena tab.
 *
 * This runs the SHIPPED worker block from background.js against a fake chrome:
 * a lease stored 5 minutes after its last use, a worker that wakes on the
 * alarm before storage answers - and requires the release.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const src = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');
const start = src.lastIndexOf('(function () {', src.indexOf('self.__mlsQp = QP;'));
const end = src.indexOf('})();', src.indexOf('adopt state across service-worker restarts', start)) + 5;
assert.ok(start > 0 && end > start, 'the quiet-work lease block was not found in background.js');
const block = src.slice(start, end);

async function wake(storedLease) {
  const alarmListeners = [];
  const sets = [];
  let storageCallback = null;
  const anyApi = () => new Proxy(function () {}, {
    get: (t, k) => (k === 'then' ? undefined : anyApi()),
    apply: () => Promise.resolve({ id: 1, windowId: 1, tabs: [], state: 'normal' }),
  });
  const chrome = {
    tabs: { onRemoved: { addListener() {} }, get: () => Promise.resolve({ id: 7, windowId: 3 }),
      query: () => Promise.resolve([]), move: () => Promise.resolve({}), update: () => Promise.resolve({}) },
    windows: anyApi(),
    scripting: anyApi(),
    alarms: { create() {}, clear() {}, onAlarm: { addListener: (fn) => alarmListeners.push(fn) } },
    storage: { session: {
      get: (keys, cb) => { storageCallback = () => cb({ mlsQpState: storedLease }); },
      set: (o) => { sets.push(o); return Promise.resolve(); },
    } },
  };
  const self = {};
  const ctx = vm.createContext({ self, chrome, console, Date, Promise, Number, String, Math, Object, Array, JSON,
    setTimeout, clearTimeout, setInterval: () => 0 });
  vm.runInContext(block, ctx, { filename: 'background.js#quiet-lease' });
  const QP = self.__mlsQp;
  // The waking event arrives BEFORE storage answers - the ordering that broke.
  alarmListeners.forEach((fn) => fn({ name: 'mlsQpWatch' }));
  await new Promise((r) => setTimeout(r, 5));
  storageCallback();
  await new Promise((r) => setTimeout(r, 50));
  // give qpRelease's bounded restore time to settle
  for (let i = 0; i < 200 && QP.active; i++) await new Promise((r) => setTimeout(r, 50));
  return { QP, sets };
}

(async () => {
  const now = Date.now();
  const ended = await wake({ winId: 3, athenaTabId: 7, orig: null, soloWin: false, lastUse: now - 5 * 60 * 1000, at: now - 6 * 60 * 1000 });
  assert.strictEqual(ended.QP.active, false, 'a lease idle for 5 minutes survived the worker wake - it will never be released');
  assert.ok(ended.sets.some((o) => o && Object.prototype.hasOwnProperty.call(o, 'mlsQpState') && o.mlsQpState === null),
    'the released lease was not cleared from session storage');

  const live = await wake({ winId: 3, athenaTabId: 7, orig: null, soloWin: false, lastUse: now - 20 * 1000, at: now - 60 * 1000 });
  assert.strictEqual(live.QP.active, true, 'a lease in active use (20 s ago) was released early');
  assert.strictEqual(live.QP.lastUse, now - 20 * 1000, 'the adopted lease must keep its own last activity, not the wake time');

  const legacy = await wake({ winId: 3, athenaTabId: 7, orig: null, soloWin: false, at: now - 10 * 60 * 1000 });
  assert.strictEqual(legacy.QP.active, false, 'a lease stored by 3.0.112 (no lastUse) falls back to its store time and is released');

  assert.ok(/lastUse: QP\.lastUse \|\| Date\.now\(\)/.test(block), 'persist() must store lastUse with the lease');
  console.log('PASS extension quiet lease expires after suspension: an idle lease is released on the waking alarm even before storage answers; a live lease keeps its own lastUse; a 3.0.112-shaped lease falls back to its store time');
})().catch((e) => { console.error(e); process.exit(1); });
