'use strict';
/* nvl-1.1.0 regression (Codex reply 34): the escape IS the goto handler's own
 * guarded v1.91 recovery ladder. The app drives NO separate GoHome verb (the
 * unbounded orphanable action is DELETED, not wrapped); its one retry
 * re-enters the guarded goto seam, admitted only on closed alive-surface
 * evidence: the reason-less supported:true failures that carry a located
 * control (via) or executed-frames diag, plus the wrong-day landing. Every
 * coded refusal - sleeping, busy, deadline, picker, extension, ALIEN - and
 * every session-dead/unsupported/malformed reply keeps its first verdict
 * with zero extra attempts. Ladder functions sliced VERBATIM from shipped
 * bytes and executed with injected dependencies. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(path.resolve(__dirname, '..'), '1p-feat_mls_schedimport_exact.js'), 'utf8');
const start = src.indexOf('/* nvl-1.1.0 (Codex reply 34): the escape IS the goto handler');
const end = src.indexOf('return gotoWithRecovery().then(function (nav) {', start);
assert.ok(start > 0 && end > start, 'the nvl-1.1.0 ladder left the goto leg');
const makeLadder = new Function('normDate', 'date', 'navRecovery', 'gotoDateSettled', 'onStatus',
  src.slice(start, end) + '\nreturn gotoWithRecovery;');

function harness(gotoResults) {
  const calls = { goto: 0, status: [] };
  const navRecovery = { ran: false };
  const ladder = makeLadder(
    v => String(v || ''),
    '2026-08-26',
    navRecovery,
    () => { const r = gotoResults[Math.min(calls.goto, gotoResults.length - 1)]; calls.goto++; return Promise.resolve(r); },
    (m) => calls.status.push(String(m))
  );
  return { ladder, calls, navRecovery };
}
const GOOD = { ok: true, supported: true, schedDate: '2026-08-26' };

(async () => {
  /* healthy goto: one call, no recovery */
  let h = harness([GOOD]);
  let nav = await h.ladder();
  assert.deepStrictEqual({ ok: nav.ok, goto: h.calls.goto, ran: h.navRecovery.ran }, { ok: true, goto: 1, ran: false });

  /* THE INTENDED CONTROLS - alive encounter/chart surface (reason-less,
     supported:true, frames executed) recovers exactly once */
  h = harness([{ ok: false, supported: true, diag: { initFrames: 3, rounds: [{}, {}] } }, GOOD]);
  nav = await h.ladder();
  assert.deepStrictEqual({ ok: nav.ok, goto: h.calls.goto, ran: h.navRecovery.ran }, { ok: true, goto: 2, ran: true },
    'the alive encounter-surface shape did not recover');

  /* the measured weekstrip verify-miss (via set, empty reason) recovers */
  h = harness([{ ok: false, supported: true, via: 'weekstrip', schedDate: '2026-08-25', diag: { initFrames: 0, rounds: [] } }, GOOD]);
  nav = await h.ladder();
  assert.deepStrictEqual({ goto: h.calls.goto, ran: h.navRecovery.ran }, { goto: 2, ran: true }, 'the weekstrip verify flake did not recover');

  /* wrong-day landing (ok:true, mismatched day) recovers */
  h = harness([{ ok: true, supported: true, schedDate: '2026-08-25' }, GOOD]);
  nav = await h.ladder();
  assert.deepStrictEqual({ day: nav.schedDate, goto: h.calls.goto }, { day: '2026-08-26', goto: 2 }, 'a wrong-day landing did not recover');

  /* PERMANENT FAIL-CLOSED CONTROLS: every coded/dead/unsupported/malformed
     reply gets ZERO extra attempts */
  const NEVER = [
    ['dead session', { ok: false, supported: true, sessionLikelyExpired: true, diag: { initFrames: 3 } }],
    ['unsupported reply', { ok: false, supported: false, error: 'No athenaOne tab open.' }],
    ['sleeping tab', { ok: false, supported: true, reason: 'athena-tab-sleeping', diag: { initFrames: 1 } }],
    ['navigation busy', { ok: false, supported: true, reason: 'athena-navigation-busy' }],
    ['immutable deadline', { ok: false, supported: true, reason: 'goto-date-deadline-exceeded', diag: { initFrames: 2 } }],
    ['extension error', { ok: false, supported: true, reason: 'extension-error' }],
    ['picker/lease error', { ok: false, supported: true, reason: 'lease-tab-gone' }],
    ['ALIEN coded reason with alive evidence', { ok: false, supported: true, reason: 'a-reason-invented-later', via: 'weekstrip', diag: { initFrames: 4, rounds: [{}] } }],
    ['malformed empty reply', {}],
    ['null reply', null],
    ['reason-less refusal with NO alive evidence', { ok: false, supported: true, diag: { initFrames: 0, rounds: [] } }]
  ];
  for (const [label, reply] of NEVER) {
    h = harness([reply, GOOD]);
    nav = await h.ladder();
    assert.deepStrictEqual({ goto: h.calls.goto, ran: h.navRecovery.ran }, { goto: 1, ran: false },
      label + ' triggered a recovery attempt - the predicate fails open');
  }

  /* bounded: the retry itself failing does NOT buy a third attempt */
  h = harness([{ ok: false, supported: true, via: 'weekstrip', diag: { initFrames: 2 } },
               { ok: false, supported: true, via: 'weekstrip', diag: { initFrames: 2 } }]);
  nav = await h.ladder();
  assert.deepStrictEqual({ ok: nav.ok, goto: h.calls.goto }, { ok: false, goto: 2 }, 'the ladder is not bounded to one re-entry');

  /* byte pins: the GoHome bridge verb is GONE from this leg (nothing to
     orphan); the pull enters through the ladder; navDiag proves the run */
  assert.ok(!src.includes('bridge("mlsAppGoHomeResult", "mlsAppGoHome"'),
    'the app still drives the separate unbounded GoHome verb from the goto leg');
  assert.ok(src.includes('return gotoWithRecovery().then(function (nav) {'), 'the goto leg no longer enters through the ladder');
  assert.ok(src.includes('recoveryRan: navRecovery.ran === true, /* nvl-1.1.0: the guarded seam was re-entered */') &&
    src.includes('recoveryVia: navRecovery.ran === true ? "second-settled-goto" : ""'),
    'navDiag no longer proves whether and how the ladder ran');
  assert.ok(src.includes('if (String(nav.reason || "") !== "") return false;'),
    'the closed reason-less admission gate is gone (coded refusals could recover again)');

  console.log('PASS nav-ladder recovery (nvl-1.1.0): the escape is the goto handler\'s own guarded ladder - the orphanable GoHome verb is deleted from the leg; alive encounter-surface, weekstrip verify-miss, and wrong-day landings recover exactly once on positive evidence; dead/unsupported/sleeping/busy/deadline/extension/picker/ALIEN/malformed/evidence-less replies get zero extra attempts (executed verbatim from shipped bytes)');
})().catch(e => { console.error(e); process.exit(1); });
