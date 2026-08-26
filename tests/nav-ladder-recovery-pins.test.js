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
    ['reason-less refusal with NO alive evidence', { ok: false, supported: true, diag: { initFrames: 0, rounds: [] } }],
    /* nvl-1.2.0 (Codex reply 37): supported ABSENT fails closed even with
       reviewed via or positive diag; an ALIEN via poisons the reply even
       beside positive frames evidence. */
    ['missing supported with reviewed via', { ok: false, via: 'weekstrip' }],
    ['missing supported with positive diag', { ok: false, diag: { initFrames: 1 } }],
    ['alien via beside positive diag', { ok: false, supported: true, via: 'jetpack', diag: { initFrames: 5, rounds: [{}] } }]
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

  /* nvl-1.2.0: the ATTEMPTS receipt is monotonic across both sequences -
     the REAL gotoDateSettled + ladder executed with a scripted bridge */
  {
    const aStart = src.indexOf('      var navAttempts = 0;');
    const aEnd = src.indexOf('      /* ===== p1-onetab-nav-1.0.0', aStart);
    const bStart = src.indexOf('      /* nvl-1.1.0 (Codex reply 34): the escape IS the goto handler', aEnd);
    const bEnd = src.indexOf('      return gotoWithRecovery().then(function (nav) {', bStart);
    assert.ok(aStart > 0 && aEnd > aStart && bStart > aEnd && bEnd > bStart, 'the settled-goto/ladder slices moved');
    const makeReal = new Function('safe', 'normDate', 'date', 'p1AthenaBusyRetry', 'bridge', 'onStatus', 'window',
      src.slice(aStart, aEnd) + '\n' + src.slice(bStart, bEnd) +
      '\nreturn { run: gotoWithRecovery, attempts: function () { return navAttempts; }, diag: function (nav) { return navDiagOf(nav, navAttempts); }, navRecovery: navRecovery };');
    const drive = async (replies) => {
      let i = 0, bridgeCalls = 0;
      const real = makeReal(
        (fn, d) => { try { return fn(); } catch (e) { return d; } },
        v => String(v || ''),
        '2026-08-26',
        (fn) => fn(),
        () => { bridgeCalls++; const r = replies[Math.min(i, replies.length - 1)]; i++; return Promise.resolve(r); },
        () => {},
        { __mlsBgSleep: () => Promise.resolve() }
      );
      const nav = await real.run();
      return { nav, total: real.attempts(), bridgeCalls, diag: real.diag(nav), ran: real.navRecovery.ran };
    };
    const BADOK = { ok: false, supported: true, via: 'weekstrip' };
    /* 4 + 1: first sequence exhausts its settle ladder, recovery's first
       attempt lands - the receipt says FIVE, not one */
    let r = await drive([BADOK, BADOK, BADOK, BADOK, GOOD]);
    assert.deepStrictEqual({ ok: r.nav.ok, total: r.total, calls: r.bridgeCalls, seq: r.diag.sequences, ran: r.ran },
      { ok: true, total: 5, calls: 5, seq: 2, ran: true },
      '4+1 did not report the truthful monotonic attempt total: ' + JSON.stringify(r.diag));
    /* 4 + 4: both sequences exhaust - EIGHT attempts, one re-entry only */
    r = await drive([BADOK, BADOK, BADOK, BADOK, BADOK, BADOK, BADOK, BADOK, GOOD]);
    assert.deepStrictEqual({ ok: r.nav.ok, total: r.total, calls: r.bridgeCalls, seq: r.diag.sequences },
      { ok: false, total: 8, calls: 8, seq: 2 },
      '4+4 did not report eight attempts with the one-reentry ceiling: ' + JSON.stringify(r.diag));
    /* a clean first attempt stays 1/1 */
    r = await drive([GOOD]);
    assert.deepStrictEqual({ total: r.total, seq: r.diag.sequences, ran: r.ran }, { total: 1, seq: 1, ran: false });
  }

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

  console.log('PASS nav-ladder recovery (nvl-1.2.0): the escape is the goto handler\'s own guarded ladder; admission requires EXPLICIT supported:true and a closed via vocabulary (weekstrip/input/arrows - alien via poisons even positive diag, absent supported fails closed); fourteen fail-closed replies get zero attempts; the attempts receipt is MONOTONIC across sequences (4+1=5, 4+4=8, sequences counted) with the one-reentry ceiling (real gotoDateSettled + ladder executed from shipped bytes)');
})().catch(e => { console.error(e); process.exit(1); });
