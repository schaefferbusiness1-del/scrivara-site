'use strict';
/* nvl-1.0.0 regression (Codex reply 24 item 4): the day-switch goto gets ONE
 * bounded escape rung - when the settled goto still ends bad (nav refusal or
 * wrong day), the pull runs the batch walker's proven GoHome verb once and
 * re-runs the settled goto; never twice per pull, never on a dead session,
 * and the rung's own result rides navDiag so the receipt proves the ladder
 * ran. The ladder functions are sliced VERBATIM from the shipped 1p bytes
 * and executed with injected dependencies. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), '1p-feat_mls_schedimport_exact.js'), 'utf8');
const start = src.indexOf('/* nvl-1.0.0: the one-rung ladder around the settled goto. */');
const end = src.indexOf('return gotoWithRecovery().then(function (nav) {', start);
assert.ok(start > 0 && end > start, 'the nvl-1.0.0 ladder left the goto leg');
const makeLadder = new Function('normDate', 'date', 'navRecovery', 'gotoDateSettled', 'bridge', 'onStatus',
  src.slice(start, end) + '\nreturn gotoWithRecovery;');

function harness(gotoResults, bridgeImpl) {
  const calls = { goto: 0, bridge: 0, status: [] };
  const navRecovery = { ran: false, homeOk: null };
  const ladder = makeLadder(
    v => String(v || ''),
    '2026-08-26',
    navRecovery,
    () => { const r = gotoResults[Math.min(calls.goto, gotoResults.length - 1)]; calls.goto++; return Promise.resolve(r); },
    (resType, reqType, timeoutMs, payload) => { calls.bridge++; calls.bridgeVerb = reqType; return bridgeImpl(); },
    (m) => calls.status.push(String(m))
  );
  return { ladder, calls, navRecovery };
}

(async () => {
  /* 1: a good first goto never runs the rung */
  let h = harness([{ ok: true, schedDate: '2026-08-26' }], () => Promise.resolve({ ok: true }));
  let nav = await h.ladder();
  assert.deepStrictEqual({ ok: nav.ok, goto: h.calls.goto, bridge: h.calls.bridge, ran: h.navRecovery.ran }, { ok: true, goto: 1, bridge: 0, ran: false },
    'a healthy goto triggered the escape rung');

  /* 2: nav refusal -> GoHome once -> second goto succeeds */
  h = harness([{ ok: false, reason: 'week-strip-empty' }, { ok: true, schedDate: '2026-08-26' }], () => Promise.resolve({ ok: true }));
  nav = await h.ladder();
  assert.deepStrictEqual({ ok: nav.ok, goto: h.calls.goto, bridge: h.calls.bridge, verb: h.calls.bridgeVerb, ran: h.navRecovery.ran, homeOk: h.navRecovery.homeOk },
    { ok: true, goto: 2, bridge: 1, verb: 'mlsAppGoHome', ran: true, homeOk: true },
    'the encounter-surface refusal did not recover through GoHome');

  /* 3: wrong day is ALSO bad - the rung runs for it */
  h = harness([{ ok: true, schedDate: '2026-08-25' }, { ok: true, schedDate: '2026-08-26' }], () => Promise.resolve({ ok: true }));
  nav = await h.ladder();
  assert.deepStrictEqual({ day: nav.schedDate, goto: h.calls.goto, bridge: h.calls.bridge }, { day: '2026-08-26', goto: 2, bridge: 1 },
    'a wrong-day landing did not recover');

  /* 4: a dead session never gets a rung */
  h = harness([{ ok: false, sessionLikelyExpired: true }], () => Promise.resolve({ ok: true }));
  nav = await h.ladder();
  assert.deepStrictEqual({ goto: h.calls.goto, bridge: h.calls.bridge, ran: h.navRecovery.ran }, { goto: 1, bridge: 0, ran: false },
    'the ladder drove a dead session');

  /* 4b: an ABSENT (or ambiguous) athena has no surface to escape - no rung,
     no doubled settle ladder */
  for (const reason of ['no-athena-tab', 'ambiguous-athena-tabs']) {
    h = harness([{ ok: false, reason }], () => Promise.resolve({ ok: true }));
    nav = await h.ladder();
    assert.deepStrictEqual({ goto: h.calls.goto, bridge: h.calls.bridge, ran: h.navRecovery.ran }, { goto: 1, bridge: 0, ran: false },
      'the ladder burned attempts against ' + reason);
  }

  /* 5: a GoHome rejection still retries the goto once, honestly recorded */
  h = harness([{ ok: false, reason: 'x' }, { ok: true, schedDate: '2026-08-26' }], () => Promise.reject(new Error('bridge-deadline-exceeded')));
  nav = await h.ladder();
  assert.deepStrictEqual({ ok: nav.ok, homeOk: h.navRecovery.homeOk, bridge: h.calls.bridge }, { ok: true, homeOk: false, bridge: 1 },
    'a failed GoHome killed the retry or lied about itself');

  /* 6: bounded - a second bad goto returns the bad nav, no second rung */
  h = harness([{ ok: false, reason: 'x' }, { ok: false, reason: 'x' }], () => Promise.resolve({ ok: true }));
  nav = await h.ladder();
  assert.deepStrictEqual({ ok: nav.ok, goto: h.calls.goto, bridge: h.calls.bridge }, { ok: false, goto: 2, bridge: 1 },
    'the ladder is not bounded to one rung');

  /* byte pins: the pull enters through the ladder; the diag carries the rung */
  assert.ok(src.includes('return gotoWithRecovery().then(function (nav) {'), 'the goto leg no longer enters through the ladder');
  assert.strictEqual(src.split('bridge("mlsAppGoHomeResult", "mlsAppGoHome", 30000, {})').length - 1, 1,
    'the escape rung bridge call moved or multiplied');
  assert.ok(src.includes('recoveryRan: navRecovery.ran === true, /* nvl-1.0.0 */') && src.includes('recoveryHomeOk: navRecovery.homeOk === true'),
    'navDiag no longer proves whether the ladder ran');

  console.log('PASS nav-ladder recovery (nvl-1.0.0): one bounded GoHome rung recovers encounter-surface and wrong-day landings, dead sessions and healthy gotos never trigger it, a failed rung is recorded honestly, and navDiag carries the proof (ladder executed verbatim from shipped bytes)');
})().catch(e => { console.error(e); process.exit(1); });
