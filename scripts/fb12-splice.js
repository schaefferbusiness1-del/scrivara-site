/* fb-1.2 (3.0.55) - the PROACTIVE tab recycle (supervisor 2026-08-09: "a
 * breaker is a recovery; this failure looks predictable - recycle proactively
 * and the owner never sees a 2-of-22 day at all").
 *
 * CADENCE DERIVATION (not a default): the earliest degradation onset observed
 * across both runs is July4's position-2 day - 5 failures after ~19 charts of
 * prior driving (July5's onset came later, ~54 charts, on a quieter box). The
 * proactive window must keep accumulation strictly below the EARLIEST observed
 * onset, so the recycle fires every 15 charts (19 minus a 4-chart margin).
 * Proactive fires ride the SAME probe -> reload -> assert -> dead-latch
 * discipline as the reactive breaker; a bad landing still stops the run. They
 * do NOT burn the reactive caps (a month run legitimately recycles ~15-20
 * times); their own bound is the 5-min spacing plus the shared dead latch.
 * Latin1, all-or-nothing, count-guarded. */
const fs = require('fs');
const F = 'background.js';
let s = fs.readFileSync(F, 'latin1');
const before = s.length;
function must(anchor, label) {
  const n = s.split(anchor).length - 1;
  if (n !== 1) { console.error('ANCHOR ' + label + ' count=' + n); process.exit(1); }
  return s.indexOf(anchor);
}

/* ---- A. state gains the chart counter ---- */
const A = "  var __mlsHydFatigue = { streak: 0, lastRefreshAt: 0, hourAt: 0, refreshes: 0, pendingStamp: false, dead: '' };";
must(A, 'A-state');
const A2 = "  var __mlsHydFatigue = { streak: 0, lastRefreshAt: 0, hourAt: 0, refreshes: 0, pendingStamp: false, dead: '', chartsSinceRefresh: 0, lifetimeRefreshes: 0 };";
s = s.slice(0, s.indexOf(A)) + A2 + s.slice(s.indexOf(A) + A.length);

/* ---- B. the trigger becomes two-armed ---- */
const B = "      if (__mlsHydFatigue.streak >= 4 && Date.now() - __mlsHydFatigue.lastRefreshAt > 900000 && __mlsHydFatigue.refreshes < 2 && (__mlsHydFatigue.lifetimeRefreshes || 0) < 3) {";
must(B, 'B-trigger');
const B2 =
`      var fbReactive = __mlsHydFatigue.streak >= 4 && Date.now() - __mlsHydFatigue.lastRefreshAt > 900000 && __mlsHydFatigue.refreshes < 2 && (__mlsHydFatigue.lifetimeRefreshes || 0) < 3;
      /* fb-1.2: the proactive recycle - every 15 charts (earliest observed
         degradation onset was ~19 charts of prior driving; 4-chart margin).
         Prevention, between charts, same landing discipline. */
      var fbProactive = !fbReactive && (__mlsHydFatigue.chartsSinceRefresh || 0) >= 15 && Date.now() - __mlsHydFatigue.lastRefreshAt > 300000;
      if (fbReactive || fbProactive) {`;
s = s.slice(0, s.indexOf(B)) + B2 + s.slice(s.indexOf(B) + B.length);

/* ---- C. the healthy-reload branch: kind-aware counting + stamp ---- */
const C = `          __mlsHydFatigue.refreshes++; __mlsHydFatigue.lifetimeRefreshes = (__mlsHydFatigue.lifetimeRefreshes || 0) + 1;
          __mlsHydFatigue.streak = 0; __mlsHydFatigue.pendingStamp = true;
          try { emit(appTabId, frozenRequestId, 'athenaOne is responding poorly - refreshing its tab and cooling down before this chart...', 0, 0); } catch (eFbE) {}`;
must(C, 'C-reload-branch');
const C2 = `          if (fbReactive) { __mlsHydFatigue.refreshes++; __mlsHydFatigue.lifetimeRefreshes = (__mlsHydFatigue.lifetimeRefreshes || 0) + 1; }
          __mlsHydFatigue.streak = 0; __mlsHydFatigue.chartsSinceRefresh = 0; __mlsHydFatigue.pendingStamp = fbReactive ? 'fatigue' : 'proactive';
          try { emit(appTabId, frozenRequestId, fbReactive ? 'athenaOne is responding poorly - refreshing its tab and cooling down before this chart...' : 'Routine athenaOne tab refresh to keep long pulls reliable (15 charts since the last one)...', 0, 0); } catch (eFbE) {}`;
s = s.slice(0, s.indexOf(C)) + C2 + s.slice(s.indexOf(C) + C.length);

/* ---- D. classification: count charts + kind-aware receipt stamp ---- */
const D = "      __mlsHydNote(res.ok === true, String(res.reason || ''));";
must(D, 'D-classify');
const D2 = `      __mlsHydNote(res.ok === true, String(res.reason || ''));
      __mlsHydFatigue.chartsSinceRefresh = (__mlsHydFatigue.chartsSinceRefresh || 0) + 1;`;
s = s.slice(0, s.indexOf(D)) + D2 + s.slice(s.indexOf(D) + D.length);

const E = "      if (__mlsHydFatigue.pendingStamp) { res.receipt.fatigueRefresh = true; __mlsHydFatigue.pendingStamp = false; }";
must(E, 'E-stamp');
const E2 = "      if (__mlsHydFatigue.pendingStamp) { if (__mlsHydFatigue.pendingStamp === 'proactive') res.receipt.proactiveRefresh = true; else res.receipt.fatigueRefresh = true; __mlsHydFatigue.pendingStamp = false; }";
s = s.slice(0, s.indexOf(E)) + E2 + s.slice(s.indexOf(E) + E.length);

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED fb-1.2 bytes ' + before + ' -> ' + s.length);
