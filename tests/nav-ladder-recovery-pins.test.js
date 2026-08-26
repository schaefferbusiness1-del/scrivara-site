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
    ['alien via beside positive diag', { ok: false, supported: true, via: 'jetpack', diag: { initFrames: 5, rounds: [{}] } }],
    /* nvl-1.4.0 (Codex reply 42): a wrong-day-shaped reply without an EXACT
       ok:true is malformed - missing/null/string ok admits nothing, even
       beside positive diag or a reviewed via. */
    ['ok-less reply with mismatched day', { schedDate: '2026-08-25' }],
    ['null ok with mismatched day', { ok: null, schedDate: '2026-08-25' }],
    ['string ok with mismatched day', { ok: 'true', schedDate: '2026-08-25' }],
    ['ok-less mismatched day beside reviewed via and diag', { schedDate: '2026-08-25', supported: true, via: 'weekstrip', diag: { initFrames: 3 } }]
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

  /* nvl-1.3.0 (Codex reply 40): the ATTEMPTS receipt counts REAL bridge
     dispatches - the REAL gotoDateSettled + ladder + the REAL
     p1AthenaBusyRetry (its presence-admitted internal re-dispatches are
     attempts too), executed with a scripted bridge */
  {
    const aStart = src.indexOf('      var navAttempts = 0;');
    const aEnd = src.indexOf('      /* ===== p1-onetab-nav-1.0.0', aStart);
    const bStart = src.indexOf('      /* nvl-1.1.0 (Codex reply 34): the escape IS the goto handler', aEnd);
    const bEnd = src.indexOf('      return gotoWithRecovery().then(function (nav) {', bStart);
    assert.ok(aStart > 0 && aEnd > aStart && bStart > aEnd && bEnd > bStart, 'the settled-goto/ladder slices moved');
    const wStart = src.indexOf('  function p1AthenaBusyRetry(runLeg, onStatus, budget) {');
    const wEnd = src.indexOf('  /* THE ONE-TAB SENTENCE', wStart);
    assert.ok(wStart > 0 && wEnd > wStart, 'the real busy-retry helper moved');
    const makeBusyRetry = new Function('isFn', 'p1IsNoAthenaTabAnswer', 'P1_ATHENA_BUSY_MAX', 'p1PresenceProbe', 'p1PresenceSaysAthenaLives', 'p1BusySleep', 'P1_ATHENA_BUSY_WAITS',
      src.slice(wStart, wEnd) + '\nreturn p1AthenaBusyRetry;');
    const makeReal = new Function('safe', 'normDate', 'date', 'p1AthenaBusyRetry', 'bridge', 'onStatus', 'window',
      src.slice(aStart, aEnd) + '\n' + src.slice(bStart, bEnd) +
      '\nreturn { run: gotoWithRecovery, attempts: function () { return navAttempts; }, diag: function (nav) { return navDiagOf(nav, navAttempts); }, navRecovery: navRecovery };');
    const BUSY = { reason: 'stub-athena-busy' }; /* matched by the injected no-tab predicate */
    const drive = async (replies) => {
      let i = 0, bridgeCalls = 0;
      const realBusyRetry = makeBusyRetry(
        f => typeof f === 'function',
        r => !!(r && r.reason === 'stub-athena-busy'),
        3,
        () => Promise.resolve({ ok: true, reason: 'presence-verified' }),
        p => !!(p && p.reason === 'presence-verified'),
        () => Promise.resolve(),
        [0, 0, 0]
      );
      const real = makeReal(
        (fn, d) => { try { return fn(); } catch (e) { return d; } },
        v => String(v || ''),
        '2026-08-26',
        realBusyRetry,
        () => { bridgeCalls++; const r = replies[Math.min(i, replies.length - 1)]; i++; return Promise.resolve(r); },
        () => {},
        { __mlsBgSleep: () => Promise.resolve() }
      );
      const nav = await real.run();
      return { nav, total: real.attempts(), bridgeCalls, diag: real.diag(nav), ran: real.navRecovery.ran };
    };
    const BADOK = { ok: false, supported: true, via: 'weekstrip' };
    /* THE reply-40 case: three presence-admitted busy retries inside ONE
       wrapper call, then success - FOUR real dispatches, four counted */
    let r = await drive([BUSY, BUSY, BUSY, GOOD]);
    assert.deepStrictEqual({ ok: r.nav.ok, total: r.total, calls: r.bridgeCalls, seq: r.diag.sequences, ran: r.ran },
      { ok: true, total: 4, calls: 4, seq: 1, ran: false },
      'three busy retries did not count as four real attempts: ' + JSON.stringify(r.diag));
    /* 4 + 1: first sequence exhausts its settle ladder, recovery's first
       attempt lands - the receipt says FIVE, not one */
    r = await drive([BADOK, BADOK, BADOK, BADOK, GOOD]);
    assert.deepStrictEqual({ ok: r.nav.ok, total: r.total, calls: r.bridgeCalls, seq: r.diag.sequences, ran: r.ran },
      { ok: true, total: 5, calls: 5, seq: 2, ran: true },
      '4+1 did not report the truthful monotonic attempt total: ' + JSON.stringify(r.diag));
    /* 4 + 4: both sequences exhaust - EIGHT attempts, one re-entry only */
    r = await drive([BADOK, BADOK, BADOK, BADOK, BADOK, BADOK, BADOK, BADOK, GOOD]);
    assert.deepStrictEqual({ ok: r.nav.ok, total: r.total, calls: r.bridgeCalls, seq: r.diag.sequences },
      { ok: false, total: 8, calls: 8, seq: 2 },
      '4+4 did not report eight attempts with the one-reentry ceiling: ' + JSON.stringify(r.diag));
    /* COMBINED: settle-ladder exhaustion (4 dispatches) + recovery whose one
       wrapper call spends two busy re-dispatches before landing - SEVEN */
    r = await drive([BADOK, BADOK, BADOK, BADOK, BUSY, BUSY, GOOD]);
    assert.deepStrictEqual({ ok: r.nav.ok, total: r.total, calls: r.bridgeCalls, seq: r.diag.sequences, ran: r.ran },
      { ok: true, total: 7, calls: 7, seq: 2, ran: true },
      'the combined settle+recovery+busy total is untruthful: ' + JSON.stringify(r.diag));
    /* a clean first attempt stays 1/1 */
    r = await drive([GOOD]);
    assert.deepStrictEqual({ total: r.total, seq: r.diag.sequences, ran: r.ran }, { total: 1, seq: 1, ran: false });
    /* nvl-1.3.0: EXACT receipt booleans - a malformed/ok-less reply can never
       mint a successful nav receipt */
    r = await drive([{}]);
    assert.deepStrictEqual({ ok: r.diag.ok, supported: r.diag.supported }, { ok: false, supported: false },
      'a malformed {} reply minted a successful receipt: ' + JSON.stringify(r.diag));
    assert.strictEqual((await drive([GOOD])).diag.ok, true, 'an explicit ok:true no longer reads as success');
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
  /* nvl-1.3.0 byte pins: the counter sits at the REAL dispatch inside the
     wrapper closure; the exact success gate guards the schedule leg */
  const legIdx = src.indexOf('navAttempts += 1;');
  assert.ok(legIdx > 0 && src.indexOf('return bridge("mlsAppGotoDateResult", "mlsAppGotoDate"', legIdx) - legIdx < 80,
    'the attempt counter left the real bridge-dispatch closure');
  assert.strictEqual(src.split('navAttempts += 1;').length - 1, 1, 'a second attempt-counter site appeared');
  assert.ok(src.includes('if (!nav || nav.ok !== true) {'),
    'the exact nav.ok === true success gate is gone - a malformed reply can reach the schedule leg');
  assert.ok(src.includes('ok: !!(nav && nav.ok === true),') && src.includes('supported: !!(nav && nav.supported === true),'),
    'navDiagOf lost its exact fail-closed booleans');
  assert.ok(src.includes('if (nav.ok === true) return !!(d0 && d0 !== date);') &&
    src.includes('if (nav.ok !== false) return false; /* ok-less/malformed: never admit */'),
    'the nvl-1.4.0 exact wrong-day admission is gone (an ok-less mismatched-day reply could buy recovery again)');

  console.log('PASS nav-ladder recovery (nvl-1.3.0): the escape is the goto handler\'s own guarded ladder; admission requires EXPLICIT supported:true and a closed via vocabulary; fourteen fail-closed replies get zero attempts; the attempts receipt counts REAL bridge dispatches through the REAL p1AthenaBusyRetry (3 busy retries = 4 attempts; settle 4 + recovery busy 2 + landing = 7; 4+1=5; 4+4=8) with the one-reentry ceiling; navDiagOf uses exact fail-closed booleans and only nav.ok === true reaches the schedule leg (executed from shipped bytes)');
})().catch(e => { console.error(e); process.exit(1); });
