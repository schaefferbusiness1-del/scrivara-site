'use strict';
/* qol-2.3 control: FOCUS COMES HOME, AND ONLY WHEN IT SHOULD (defect 4 of the
   owner's five: "it keeps pulling me to mls").
   Mechanisms pinned, per the 11-agent audit's focus-debris section:
   F1 the guardian's designed end-of-op verb (mlsAppFocusMlsTab) is finally
      SENT by the site, and the 90s-quiet backstop defers while a read runs;
   F2 the read-focus rail's make-visible branch is REACHABLE (quiet reads in
      an unfocused window run unthrottled) - executed, old shape fails by name;
   F3 the write-probe front restores through the batch-scoped defer;
   F4 model-driven switchtab refuses during reads;
   F5 dayPull arms presence INSIDE the advisory check with an owned disarm;
   F6 the ax fallback route honors the scoped day (read-first date gate). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');
const si = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'latin1');
const content = fs.readFileSync(path.join(__dirname, '..', 'content.js'), 'latin1');

/* ---- F2: mlsReadFocusWouldYank, EXECUTED against a stubbed chrome ---- */
const fnStart = bg.indexOf('async function mlsReadFocusWouldYank(targetTabId) {');
const fnEnd = bg.indexOf('\n}', fnStart);
assert.ok(fnStart > 0 && fnEnd > fnStart, 'rail function located');
const railSrc = bg.slice(fnStart, fnEnd + 2);
function makeRail(focusedWin, tabsById) {
  const chrome = {
    windows: { getLastFocused: async () => focusedWin },
    tabs: { get: async (id) => { if (!(id in tabsById)) throw new Error('no tab'); return tabsById[id]; } }
  };
  return new Function('chrome', railSrc + '\nreturn mlsReadFocusWouldYank;')(chrome);
}
(async () => {
  const focused = { id: 1, focused: true, tabs: [{ id: 10, active: true }, { id: 11, active: false }] };
  const tabs = { 10: { id: 10, windowId: 1 }, 11: { id: 11, windowId: 1 }, 20: { id: 20, windowId: 2 } };

  const rail = makeRail(focused, tabs);
  assert.strictEqual(await rail(20), false, 'F2: athena in an UNFOCUSED other window - make-visible ALLOWED (the previously unreachable case)');
  assert.strictEqual(await rail(11), true, 'F2: same focused window, different active tab - still refuses (selection is sacred)');
  assert.strictEqual(await rail(10), false, 'F2: self-activation stays a no-op');
  const railUnfocused = makeRail({ id: 1, focused: false, tabs: [] }, tabs);
  assert.strictEqual(await railUnfocused(20), true, 'F2: Chrome without OS focus touches nothing');

  /* non-vacuity: the OLD rule refuses the unfocused-other-window case - the
     exact input the fix exists for */
  const oldRail = async (targetTabId) => {
    const w = focused; const cur = (w.tabs || []).find(t => t.active);
    if (!w || w.focused !== true || !cur) return true;
    return !(targetTabId != null && cur.id === targetTabId);
  };
  assert.strictEqual(await oldRail(20), true, 'non-vacuity: the OLD rail refused the background-window select, so the make-visible branch was unreachable');

  /* ---- F1: backstop deferral + stamps + the site finally sends the verb ---- */
  assert.ok(/var fgReadBusy = function/.test(bg) && /if \(fgReadBusy\(\)\) return;/.test(bg), 'F1: the interval backstop defers while a read runs');
  assert.ok(/> 90000 && !fgReadBusy\(\)\) fgFocusApp\(\);/.test(bg), 'F1: the alarm backstop defers too');
  assert.ok(bg.indexOf('self.__mlsChartReadBusyUntil = Math.max(Number(self.__mlsChartReadBusyUntil || 0), chartDeadlineAt)') > 0, 'F1: the chart lane stamps its deadline-bounded busy window');
  assert.ok(/__mlsChartReadBusyUntil[^\n]*msg\.deadlineAt/.test(bg), 'F1: the visits lane stamps too');
  /* qol-2.3d (supervisor Q2 follow-up): the 120s qp quiet sweeper is the same
     silence-detector shape as the F1 watchdog, and the CHART lane never
     advances QP.lastUse - so both sweeper sites must honour the same
     deadline-bounded busy stamp, or a >120s bridge-silent chart read gets its
     tab restored MID-run. The visits/ax lanes advance lastUse every loop
     iteration (touchVisitLease), so they were never exposed. */
  assert.ok(/var qpChartBusy = function/.test(bg), 'Q2: the sweeper has the busy probe');
  assert.ok(/QP_QUIET_MS && !qpChartBusy\(\)\) \{ qpRelease\('quiet'\); \}/.test(bg), 'Q2: the interval sweeper defers while a chart read runs');
  assert.ok(/QP_QUIET_MS && !qpChartBusy\(\)\) qpRelease\('alarm'\);/.test(bg), 'Q2: the alarm sweeper defers too');
  assert.ok(/touchVisitLease\(\)/.test(bg.slice(bg.indexOf('var axRouteRun'), bg.indexOf('var axRouteRun') + 4000)), 'Q2: the ax loop advances the lease (lastUse) per encounter');
  /* qol-2.3c: the end-of-op sender ALREADY EXISTS - runManagedAthenaOperation's
     release path sends the verb once per ACQUIRED op (from:"mls-managed-pull"),
     and schedule-history-pipeline pins that a refused caller never fires it.
     A briefly-added duplicate settle-path sender doubled the signal and is
     GONE; this pins both facts so neither regresses. */
  assert.strictEqual((si.match(/type: "mlsAppFocusMlsTab", from: "mls-managed-pull"/g) || []).length, 1,
    'F1: the managed-release end-of-op sender exists exactly once');
  assert.strictEqual((si.match(/__fgEndOfOp/g) || []).length, 0,
    'F1: no duplicate settle-path sender - release belongs to the lock owner');
  assert.ok(/'mlsAppFocusMlsTab'/.test(content) || /"mlsAppFocusMlsTab"/.test(content), 'F1: the bridge verb is whitelisted in content.js');

  /* ---- F3: the probe restores what it fronted ---- */
  assert.ok(/__probeFg = await self\.__mlsFrontAthenaForRead/.test(bg), 'F3: the probe captures the front state instead of discarding it');
  assert.ok(/self\.__mlsDeferRestoreAfterRead\(__probeFg\)/.test(bg), 'F3: and restores through the batch-scoped defer');
  assert.ok(/self\.__mlsDeferRestoreAfterRead = __mlsDeferRestoreAfterRead/.test(bg), 'F3: the defer is exposed for the probe scope');

  /* ---- F4: switchtab guarded ---- */
  const swIdx = bg.indexOf("if (action.type === 'switchtab') {");
  assert.ok(swIdx > 0 && bg.indexOf('__mlsChartReadBusyUntil', swIdx) - swIdx < 300, 'F4: switchtab refuses while a read op is running');

  /* ---- F5: dayPull arms inside the advisory, owned disarm ---- */
  const dpIdx = si.indexOf('function __dayPullInner(opts, __armPresence)');
  assert.ok(dpIdx > 0, 'F5: the inner receives the arm callback');
  const advisoryIdx = si.indexOf('if (pullRunning || foreignPullLease()) {', dpIdx);
  const armIdx = si.indexOf('if (isFn(__armPresence)) __armPresence(); /* qol-2.3', dpIdx);
  assert.ok(advisoryIdx > 0 && armIdx > advisoryIdx, 'F5: presence arms only AFTER the advisory in-flight check passes');
  assert.ok(/if \(__armedHere\) __historyRetryForeground = false;/.test(si), 'F5: disarm is owned - a refused call cannot strip a running batch');

  /* ---- F6: the ax route is day-scoped ---- */
  const axIdx = bg.indexOf('var axOnlyDate = String((frozenHint && frozenHint.onlyDate) || "");');
  assert.ok(axIdx > 0, 'F6: the ax route reads the scoped-day hint');
  const earlyRead = bg.indexOf('axBodyEarly', axIdx);
  const idPoll = bg.indexOf('var axIdOk = false, axIdent = null;', axIdx);
  assert.ok(earlyRead > 0 && earlyRead < idPoll, 'F6: the body is read and date-gated BEFORE the identity poll');
  assert.ok(bg.indexOf('axDateSkipped++; continue;') > 0, 'F6: out-of-day encounters are dropped, counted, never kept');
  assert.ok(/onlyDate: axOnlyDate, axDateSkipped: axDateSkipped/.test(bg), 'F6: the receipt names the scope and the skips');
  assert.ok(/axOnlyDate && axScannedAll && axRefused === 0 && axShapeUnknown === 0/.test(bg), 'F6: a cleanly-scanned empty day is an honest success, not a refusal');

  /* F6 EXECUTED: the date key the gate compares with, incl. fail-closed junk */
  const dkStart = bg.indexOf('function mlsVisitDateKeyForHint(sv)');
  const dkEnd = bg.indexOf('\n', dkStart);
  const dk = new Function(bg.slice(dkStart, dkEnd) + '\nreturn mlsVisitDateKeyForHint;')();
  assert.strictEqual(dk('7/7/2026'), '2026-07-07', 'header dates in US form map to the day key');
  assert.strictEqual(dk('2026-07-07'), '2026-07-07', 'ISO passes through');
  assert.strictEqual(dk('Discharge Summary'), '', 'junk maps to empty - never equal to a requested day, so the gate fails CLOSED');

  console.log('qol-focus-comes-home: OK (rail executed + old shape refused the fixed case; backstop deferred; managed-release sender singular with zero settle-path duplicates; probe restores; switchtab guarded; dayPull owned-armed; ax route day-scoped, junk dates fail closed)');
})().catch(e => { console.error(e); process.exit(1); });
