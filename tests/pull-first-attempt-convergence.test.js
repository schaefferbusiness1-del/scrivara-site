'use strict';

/* 2026-07-28 owner directive: first-attempt completeness WITHOUT yanking.
 * One-window physics: the occluded athenaOne tab renders deep encounter lists
 * on paused rAF, so pass 1 can time out on exactly the longest charts.
 * Measured live: 10 bodies-class failures converged to 6 after one retry
 * pass. The pull now drives that convergence itself (<=2 automatic rounds of
 * the SAME retryFailedHistories flow), worker-paced so a hidden page keeps
 * pacing; identity/schedule refusals are never ground on automatically.
 * Also pinned: the shared hidden-tab-proof sleep and its routed pull-path
 * call sites (raw setTimeout freezes on this machine when the tab hides). */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const sched = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

/* ---- 1. the shared worker-backed sleep, EXECUTED ---- */
{
  const s = app.indexOf('var __mlsBgSleepWk=null');
  const e = app.indexOf('window.__mlsBgSleep=__mlsBgSleep;');
  assert(s > 0 && e > s, '__mlsBgSleep block missing from ScribeFlow.html');
  const block = app.slice(s, e + 'window.__mlsBgSleep=__mlsBgSleep;'.length);

  // worker path: a fake Worker echoes the id back asynchronously
  const posts = [];
  function FakeWorker() { const self = this; this.postMessage = m => { posts.push(m); setImmediate(() => self.onmessage && self.onmessage({ data: m.id })); }; }
  const ctx1 = vm.createContext({ window: {}, Worker: FakeWorker, Blob: function () {}, URL: { createObjectURL: () => 'blob:x' }, setTimeout, Promise });
  vm.runInContext(block, ctx1, { filename: 'bgSleep-worker' });
  return_check_worker: {
    const p = ctx1.window.__mlsBgSleep(5);
    assert(p && typeof p.then === 'function', 'sleep returns a promise');
  }
  // fallback path: Worker constructor throws -> setTimeout fallback still resolves
  const ctx2 = vm.createContext({ window: {}, Worker: function () { throw new Error('no workers'); }, Blob: function () {}, URL: { createObjectURL: () => { throw new Error('no blob'); } }, setTimeout, Promise });
  vm.runInContext(block, ctx2, { filename: 'bgSleep-fallback' });
  const done = [];
  const pw = ctx1.window.__mlsBgSleep(1).then(() => done.push('worker'));
  const pf = ctx2.window.__mlsBgSleep(1).then(() => done.push('fallback'));
  return Promise.all([pw, pf]).then(() => {
    assert(done.includes('worker') && done.includes('fallback'), 'both sleep paths must resolve');
    assert(posts.length >= 1, 'worker path must post to the worker');
    part2();
    console.log('pull-first-attempt-convergence: PASS');
  }).catch(err => { console.error(err); process.exit(1); });
}

function part2() {
  /* ---- 2. routed pull-path sleeps (source pins) ---- */
  const routedConnect = (connect.match(/__mlsBgSleep/g) || []).length;
  assert(routedConnect >= 5, 'mls-connect must route its raw pull sleeps through __mlsBgSleep (found ' + routedConnect + ')');
  const routedSched = (sched.match(/__mlsBgSleep/g) || []).length;
  assert(routedSched >= 3, 'schedimport settle waits must route through __mlsBgSleep (found ' + routedSched + ')');

  /* ---- 3. auto-convergence, EXECUTED ---- */
  const s = connect.indexOf('var DS_BODIES_REASON');
  const e = connect.indexOf('function startPull(autoRetry)');
  assert(s > 0 && e > s, 'dsAutoConvergeBodies block missing');
  const block = connect.slice(s, e);

  function scenario(reasons, expectRounds, opts) {
    opts = opts || {};
    let retries = 0;
    const DS = { sessionSerial: 7, pulling: false, retrying: false, lastResult: { reason: 'history-partial', historyReceipt: { reason: 'history-partial', presenceRequested: opts.presence === true, retry: reasons.map(r => ({ patientId: 'p', reason: r })) } } };
    const ctx = vm.createContext({
      DS,
      retryItems: src => (src && src.historyReceipt && Array.isArray(src.historyReceipt.retry)) ? src.historyReceipt.retry : [],
      retryFailedHistories: () => { retries++; DS.lastResult = null; /* converged after one round */ },
      $: () => null,
      window: { __mlsBgSleep: () => Promise.resolve() },
      setTimeout, Promise
    });
    if (opts.hidden) ctx.document = { visibilityState: 'hidden' };
    vm.runInContext(block + '\nthis.__go = dsAutoConvergeBodies;', ctx, { filename: 'autoconverge' });
    ctx.__go(7);
    return new Promise(r => setImmediate(() => setImmediate(() => setImmediate(() => r(retries)))));
  }

  Promise.all([
    scenario(['visits-time-budget-exceeded', 'encounter-index-incomplete[x]'], 1),
    scenario(['identity-target-unresolved'], 0),
    scenario(['visit-bodies-incomplete', 'identity-target-unresolved'], 0),
    scenario([], 0),
    /* cv-1.1 (live 2026-08-04): a find-patient-open deadline is retryable -
       it sat waiting for a human click while the proven heal was one
       automatic round away. Only credential/identity/schedule classes stay
       human-first. */
    scenario(['The Athena patient open reached its one absolute deadline during find patient open. No retry or fallback was dispatched'], 1),
    scenario(['athenaOne patient search found no matching patient.'], 1),
    scenario(['Athena signed you out (session expired)'], 0),
    /* cv-1.2 (live 2026-08-04 17:26Z): a presence-assisted batch ends with
       athenaOne front BY DESIGN - the app tab being hidden there is the
       assist's own doing, not a forgotten background tab. 11 stragglers sat
       behind the blanket veto. A hidden tab WITHOUT presence still refuses. */
    scenario(['visit-bodies-incomplete'], 1, { hidden: true, presence: true }),
    scenario(['visit-bodies-incomplete'], 0, { hidden: true, presence: false })
  ]).then(([a, b, c, d, e, f, g, h, i]) => {
    assert.strictEqual(a, 1, 'bodies-only failures must auto-retry (got ' + a + ')');
    assert.strictEqual(b, 0, 'identity refusals must NEVER be ground on automatically');
    assert.strictEqual(c, 0, 'an identity reason vetoes the whole auto round');
    assert.strictEqual(d, 0, 'no failures, no retry');
    assert.strictEqual(e, 1, 'cv-1.1: a chart-open deadline earns the automatic rounds (got ' + e + ')');
    assert.strictEqual(f, 1, 'cv-1.1: a transient search miss earns the automatic rounds (got ' + f + ')');
    assert.strictEqual(g, 0, 'cv-1.1: a dead session is the doctor\'s to see, never ground on');
    assert.strictEqual(h, 1, 'cv-1.2: presence-assisted batches converge even with the app tab hidden (got ' + h + ')');
    assert.strictEqual(i, 0, 'cv-1.2: a hidden tab WITHOUT presence still refuses (forgotten-tab hazard)');

    /* ---- 4. one continuous completion hook is wired ---------------------
       The verdict may be painted early only when convergence is ineligible.
       Eligible work transfers screen ownership before the automatic pass and
       calls done exactly from its settlement callback. */
    const startPull = connect.slice(e, connect.indexOf('function removeDoctorDayControls', e));
    const will = startPull.indexOf('var willConverge = retryCount > 0 && dsConvergeEligible(result);');
    const early = startPull.indexOf('if (!willConverge) {', will);
    const transfer = startPull.indexOf('DS.__autoRetrying = true;', early);
    const converge = startPull.indexOf('dsAutoConvergeBodies(sessionSerial, function (cv) {', transfer);
    const settledDone = startPull.indexOf('done(outcome.ok, outcome.message + cvNote', converge);
    assert(will >= 0 && early > will && transfer > early && converge > transfer && settledDone > converge,
      'continuous convergence no longer gates the early verdict, transfers ownership, and settles through one final done callback');
    assert(/if \(!willConverge\) \{\s*done\(outcome\.ok,[\s\S]{0,180}?return;\s*\}/.test(startPull),
      'an ineligible convergence path no longer ends once without starting a second lane');
    assert(startPull.indexOf('done(outcome.ok', early) < transfer,
      'the non-convergence verdict moved outside its guarded branch');
  }).catch(err => { console.error(err); process.exit(1); });
}
