/* fb-1.0 (3.0.55) - the renderer-fatigue breaker.
 *
 * Day 9 (2026-08-09) collapsed 2/22 from its first chart with the session
 * ALIVE (92,314-byte authenticated dashboard fetch, no Re-Login): the driven
 * tab degrades under continuous driving (two-run position curve: July4
 * 1/5/8/6, July5 0/1/0/2/20 with empty days as a breather). The known cure is
 * cool-down-then-converge, never grinding. This breaker: four consecutive
 * hydration-class refusals -> reload OUR OWN work tab once (top frame,
 * same-origin), 12s cool-down, continue. Bounded: >=15min apart, max 2 per
 * rolling hour. Every chart receipt carries the live streak; a refresh stamps
 * the next receipt. Latin1, all-or-nothing, count-guarded.
 */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
const before = s.length;
function must(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}

/* ---- A. module state + classifier before the reader ---- */
const A = "  function runAllVisits(appTabId, hint, cfg, requestId, callerDeadlineAt) {";
must(A, 'A-runAllVisits-def');
const stateBlock =
`  /* fb-1.0: hydration-fatigue tracker. streak counts CONSECUTIVE charts whose
     read refused with a hydration-shaped reason; any proven chart resets it.
     The reasons are surface-starvation shapes, NOT identity refusals - an
     identity mismatch is the product working and never feeds the breaker. */
  var __mlsHydFatigue = { streak: 0, lastRefreshAt: 0, hourAt: 0, refreshes: 0, pendingStamp: false };
  function __mlsHydNote(ok, reason) {
    try {
      if (ok === true) { __mlsHydFatigue.streak = 0; return; }
      if (/^(no-chart-frame-candidate|visit-bodies-incomplete|visits-source-key-unproven|visits-list-still-rendering|visits-total-not-readable|encounter-surface-not-open|stale-encounter-surface-open)/.test(String(reason || ''))) __mlsHydFatigue.streak++;
    } catch (eHyd) {}
  }
${A}`;
s = s.slice(0, s.indexOf(A)) + stateBlock.slice(0, stateBlock.length - A.length) + s.slice(s.indexOf(A));

/* ---- B. the pre-read refresh, after the work tab is resolved ---- */
const B = "      try { __visitGuardByTab.set(Number(emrId), readGuard); } catch (eGuardTab) {}";
must(B, 'B-guard-set');
const refresh =
`${B}
      /* fb-1.0: the breaker fires BEFORE this chart's read, so the refreshed
         surface serves it. Reloading our own driven work tab is the cure for
         the day-9 class (11x no-chart-frame with the session alive); the read
         flow re-establishes everything per chart from the dashboard anyway. */
      if (Date.now() - __mlsHydFatigue.hourAt > 3600000) { __mlsHydFatigue.hourAt = Date.now(); __mlsHydFatigue.refreshes = 0; }
      if (__mlsHydFatigue.streak >= 4 && Date.now() - __mlsHydFatigue.lastRefreshAt > 900000 && __mlsHydFatigue.refreshes < 2) {
        __mlsHydFatigue.lastRefreshAt = Date.now(); __mlsHydFatigue.refreshes++;
        __mlsHydFatigue.streak = 0; __mlsHydFatigue.pendingStamp = true;
        try { emit(appTabId, frozenRequestId, 'athenaOne is responding poorly - refreshing its tab and cooling down before this chart...', 0, 0); } catch (eFbE) {}
        try { await exec(emrId, [0], ['surfaceRefresh', cfg]); } catch (eFbR) {}
        await sleep(12000);
      }`;
s = s.slice(0, s.indexOf(B)) + refresh + s.slice(s.indexOf(B) + B.length);

/* ---- C. classification at the single normalize hop every outcome crosses ---- */
const C = "      res.readerVersion = '2.9.22-visits-r4-two-stage';";
must(C, 'C-normalize-hop');
const classify =
`${C}
      /* fb-1.0: every outcome crosses this hop - the one honest place to
         classify. The receipt carries the live streak (and the refresh stamp
         when one just fired) so the day ledger can see the breaker work. */
      __mlsHydNote(res.ok === true, String(res.reason || ''));
      if (!res.receipt || typeof res.receipt !== 'object') res.receipt = {};
      res.receipt.hydStreak = __mlsHydFatigue.streak;
      if (__mlsHydFatigue.pendingStamp) { res.receipt.fatigueRefresh = true; __mlsHydFatigue.pendingStamp = false; }`;
s = s.slice(0, s.indexOf(C)) + classify + s.slice(s.indexOf(C) + C.length);

/* ---- D. the page-side op: reload THIS tab's top frame (same-origin frameset) ---- */
const D = "    if (op === 'deptGet') {";
must(D, 'D-op-family');
const op =
`    if (op === 'surfaceRefresh') {
      /* fb-1.0: engine-owned reload of the engine's OWN work tab. Injected
         into frame 0 (top). Never navigates anywhere - a reload only. */
      try { top.location.reload(); return { ok: true }; } catch (eSRf) { return { ok: false, reason: 'refresh-blocked' }; }
    }
${D}`;
s = s.slice(0, s.indexOf(D)) + op.slice(0, op.length - D.length) + s.slice(s.indexOf(D));

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED fb-1.0 bytes ' + before + ' -> ' + s.length);
