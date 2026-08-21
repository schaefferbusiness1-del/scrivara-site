'use strict';

/* 2026-07-28 LIVE INCIDENT (owner, Thu Jul 30 fast-lane pull): "10 saves not
 * confirmed" returned. Anatomy: a second app tab ran a concurrent engine; the
 * generation rule and pull shield are PER-TAB, and cross-tab arrays fall back
 * to the 12s clock rule - so the second tab's bulk writes could legally
 * remove the first tab's freshly saved rows between save and verify.
 *
 * The law: ONE store, ONE shield. Any running engine, in any tab, renews a
 * shared heartbeat (uns('pullShieldUntil') + owner token); the removal guard
 * treats a live heartbeat as PULL ACTIVE regardless of tab; engines REFUSE to
 * start while another tab owns the shield; hidden tabs never self-start
 * automatic rounds. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

/* ---- 1. the shared shield, EXECUTED (tick / foreign / PtsPullActive) ---- */
{
  const s = app.indexOf('var __mlsPullShieldSelf');
  assert(s > 0, 'shield block missing from ScribeFlow.html');
  const paStart = app.indexOf('function __mlsPtsPullActive()', s);
  assert(paStart > s, 'PtsPullActive must follow the shield helpers');
  const paEnd = app.indexOf('return false;', paStart);
  const block = app.slice(s, paEnd + 'return false;'.length) + '\n}';

  function makeCtx(store) {
    const ctx = vm.createContext({
      uns: k => 'acct::' + k,
      localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } },
      window: {},
      Date, Math, Number, String
    });
    vm.runInContext(block + '\nthis.tick=__mlsPullShieldTick; this.foreign=__mlsPullShieldForeign; this.active=__mlsPtsPullActive;', ctx);
    return ctx;
  }

  const store = {};
  const tabA = makeCtx(store);
  const tabB = makeCtx(store);
  assert.strictEqual(tabA.active(), false, 'no shield -> not active');
  assert.strictEqual(tabB.foreign(), false, 'no shield -> not foreign');
  tabA.tick();
  assert.strictEqual(tabA.active(), true, 'own tick -> pull active in the SAME tab');
  assert.strictEqual(tabB.active(), true, 'own tick -> pull active in the OTHER tab (the whole point)');
  assert.strictEqual(tabA.foreign(), false, 'the ticking tab is never foreign to itself');
  assert.strictEqual(tabB.foreign(), true, 'the other tab sees a FOREIGN shield and must refuse to start');
  store['acct::pullShieldUntil'] = String(Date.now() - 1000);
  assert.strictEqual(tabB.active(), false, 'an expired heartbeat protects nothing (wedged engines over-protect ~45s, never forever)');
  assert.strictEqual(tabB.foreign(), false, 'an expired heartbeat blocks nobody');
}

/* ---- 2. every engine feeds the heartbeat and honors the refusal ---- */
assert((si.match(/__mlsPullShieldTick/g) || []).length >= 3, 'schedimport must renew the shield (batch entry + per patient + post-sweep)');
assert(si.includes('history-batch-busy-other-tab'), 'schedimport must refuse a foreign-shield start through the busy lane');
assert(mc.includes('__mlsPullShieldTick()'), 'the day-strip status stream must renew the shield');
assert(mc.includes('__mlsPullShieldForeign && window.__mlsPullShieldForeign()'), 'startPull must refuse while another tab pulls');
assert(mc.includes('Another tab or device is pulling right now'), 'the refusal must say WHY in the strip');

/* ---- 3. hidden tabs never self-start automatic rounds, EXECUTED ---- */
{
  const s = mc.indexOf('var DS_BODIES_REASON');
  const e = mc.indexOf('function startPull(autoRetry)');
  assert(s > 0 && e > s, 'auto-convergence block or current startPull(autoRetry) boundary missing');
  const block = mc.slice(s, e);
  function run(visibility) {
    let retries = 0;
    const DS = { sessionSerial: 3, pulling: false, retrying: false, lastResult: { reason: 'history-partial', historyReceipt: { reason: 'history-partial', retry: [{ patientId: 'p', reason: 'visit-bodies-incomplete' }] } } };
    const ctx = vm.createContext({
      DS,
      retryItems: src => (src && src.historyReceipt && Array.isArray(src.historyReceipt.retry)) ? src.historyReceipt.retry : [],
      retryFailedHistories: () => { retries++; DS.lastResult = null; },
      $: () => null,
      document: { visibilityState: visibility },
      window: { __mlsBgSleep: () => Promise.resolve() },
      setTimeout, Promise
    });
    vm.runInContext(block + '\nthis.__go = dsAutoConvergeBodies;', ctx);
    ctx.__go(3);
    return new Promise(r => setImmediate(() => setImmediate(() => setImmediate(() => r(retries)))));
  }
  Promise.all([run('visible'), run('hidden')]).then(([vis, hid]) => {
    assert.strictEqual(vis, 1, 'a visible tab still converges');
    assert.strictEqual(hid, 0, 'a hidden tab must NEVER self-start a round');
    console.log('cross-tab-pull-shield: PASS');
  }).catch(err => { console.error(err); process.exit(1); });
}
