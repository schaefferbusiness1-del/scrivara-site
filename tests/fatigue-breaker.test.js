/* fb-1.0 (3.0.55) - the renderer-fatigue breaker.
 *
 * Day 9 (2026-08-09): 2/22 from the first chart, session ALIVE (92,314-byte
 * authenticated dashboard, no Re-Login). Two-run position curve (July4
 * 1/5/8/6; July5 0/1/0/2/20) = the driven tab degrades under continuous
 * driving. Cure: cool-down-then-converge - four consecutive hydration-class
 * refusals reload the engine's OWN work tab once, bounded.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
let checks = 0;
function ok(cond, label) {
  checks++;
  if (!cond) { console.error('FAIL fatigue-breaker: ' + label); process.exit(1); }
}

const SRC = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'latin1');

/* ---- structural pins ---- */
ok(SRC.includes("var __mlsHydFatigue = { streak: 0, lastRefreshAt: 0, hourAt: 0, refreshes: 0, pendingStamp: false, dead: '', chartsSinceRefresh: 0, lifetimeRefreshes: 0 };"),
  'module state exists with the dead latch (fb-1.1) and the chart counter (fb-1.2)');
ok(SRC.includes("var fbReactive = __mlsHydFatigue.streak >= 4 && Date.now() - __mlsHydFatigue.lastRefreshAt > 900000 && __mlsHydFatigue.refreshes < 2 && (__mlsHydFatigue.lifetimeRefreshes || 0) < 3;"),
  'the reactive breaker needs 4 consecutive refusals, >=15min spacing, <2/rolling hour, AND <3 per service-worker lifetime');
/* fb-1.2: the PROACTIVE recycle. Cadence DERIVED, not defaulted: earliest
   observed degradation onset across two runs was ~19 charts of prior driving
   (July4 position-2, 5 failures); the window keeps accumulation strictly
   below it - every 15 charts (19 minus a 4-chart margin). Prevention beats
   recovery: the owner never sees the 2-of-22 day. */
ok(SRC.includes("var fbProactive = !fbReactive && (__mlsHydFatigue.chartsSinceRefresh || 0) >= 15 && Date.now() - __mlsHydFatigue.lastRefreshAt > 300000;"),
  'fb-1.2: the proactive recycle fires every 15 charts (derived from the ~19-chart earliest onset), 5-min spaced, between charts');
ok(SRC.includes('if (fbReactive) { __mlsHydFatigue.refreshes++; __mlsHydFatigue.lifetimeRefreshes = (__mlsHydFatigue.lifetimeRefreshes || 0) + 1; }'),
  'fb-1.2: proactive fires do NOT burn the reactive caps (a month run recycles ~15-20 times by design)');
ok(SRC.includes('__mlsHydFatigue.chartsSinceRefresh = 0;') && SRC.includes("__mlsHydFatigue.chartsSinceRefresh = (__mlsHydFatigue.chartsSinceRefresh || 0) + 1;"),
  'fb-1.2: the chart counter increments at the classify hop and resets on every reload');
ok(SRC.includes("res.receipt.proactiveRefresh = true;") && SRC.includes("__mlsHydFatigue.pendingStamp = fbReactive ? 'fatigue' : 'proactive';"),
  'fb-1.2: receipts distinguish a proactive recycle from a fatigue recovery (acceptance counts them separately)');
ok(SRC.includes('if (fbReactive || fbProactive) {'),
  'fb-1.2: both arms share ONE hardened path - probe, reload, assert, dead latch (wrap once)');
/* fb-1.1 hardening (supervisor 2026-08-09, non-negotiable: a reload during
   interstitial weather killed a healthy frameset on 2026-08-08 and the
   sign-in was the only recovery - unattended, that ends the night). */
ok(SRC.includes("if (op === 'surfaceProbe') {") && SRC.includes("interstitial: /unable to complete the requested action/i.test(spTxt)"),
  'fb-1.1: a read-only probe op recognises the 2026-08-08 interstitial');
ok(SRC.includes('if (fbPreR && fbPreR.interstitial) {'),
  'fb-1.1: the breaker probes BEFORE reloading and skips the reload under interstitial weather');
ok(SRC.includes("if (!fbPostR || fbPostR.interstitial || fbPostR.signIn || Number(fbPostR.frames || 0) < 2) {"),
  'fb-1.1: after a reload the breaker asserts a real frameset came back (no probe answer / interstitial / sign-in / no frames all fail)');
ok(SRC.includes("'sign-in-form-after-reload'") && SRC.includes("if (__mlsHydFatigue.dead) {"),
  'fb-1.1: a bad landing latches dead and every later chart refuses fast - no retry, no root-bounce');
{
  const deadCount = (SRC.match(/reason: 'no-athena-tab', identity: \{\}, visits: \[\], receipt: \{ complete: false, indexComplete: false, bodyComplete: false, fullDetail: false, fatigueDead: __mlsHydFatigue\.dead \}/g) || []).length;
  ok(deadCount === 2, 'fb-1.1: both dead-latch refusals (latched + fresh) carry the fatigueDead receipt and the no-athena-tab reason that routes into sign-in guidance, got ' + deadCount);
}
ok(SRC.includes("await exec(emrId, [0], ['surfaceRefresh', cfg]);"),
  'the refresh targets frame 0 (top) of the engine\'s own resolved work tab');
ok(SRC.includes('await sleep(12000);'), 'a 12s cool-down follows the reload');
ok(SRC.includes("if (op === 'surfaceRefresh') {") && SRC.includes('top.location.reload(); return { ok: true };'),
  'the page-side op reloads only - it never navigates anywhere');
ok(SRC.includes('__mlsHydNote(res.ok === true, String(res.reason || \'\'));'),
  'classification sits at the single normalize hop every outcome crosses');
ok(SRC.includes('res.receipt.hydStreak = __mlsHydFatigue.streak;'),
  'every chart receipt carries the live streak');
ok(SRC.includes("if (__mlsHydFatigue.pendingStamp) { if (__mlsHydFatigue.pendingStamp === 'proactive') res.receipt.proactiveRefresh = true; else res.receipt.fatigueRefresh = true; __mlsHydFatigue.pendingStamp = false; }"),
  'a refresh stamps the NEXT receipt exactly once, kind-aware (fb-1.2)');

/* ---- functional arm: run the real classifier ---- */
const clStart = SRC.indexOf('function __mlsHydNote(ok, reason) {');
ok(clStart > 0, 'classifier extractable');
const clEnd = SRC.indexOf('  function runAllVisits(', clStart);
const ctx = {};
vm.createContext(ctx);
vm.runInContext('var __mlsHydFatigue = { streak: 0, lastRefreshAt: 0, hourAt: 0, refreshes: 0, pendingStamp: false };\n' +
  SRC.slice(clStart, clEnd), ctx);
vm.runInContext("__mlsHydNote(false, 'no-chart-frame-candidate[stm.esp noise-surface]');", ctx);
vm.runInContext("__mlsHydNote(false, 'visit-bodies-incomplete');", ctx);
vm.runInContext("__mlsHydNote(false, 'visits-source-key-unproven');", ctx);
ok(vm.runInContext('__mlsHydFatigue.streak', ctx) === 3, 'vm: hydration-class refusals increment the streak');
vm.runInContext("__mlsHydNote(false, 'identity-mismatch: live chart shows another patient');", ctx);
ok(vm.runInContext('__mlsHydFatigue.streak', ctx) === 3,
  'vm: an identity refusal NEVER feeds the breaker - it is the product working, not the surface degrading');
vm.runInContext("__mlsHydNote(false, 'no-athena-tab');", ctx);
ok(vm.runInContext('__mlsHydFatigue.streak', ctx) === 3, 'vm: a missing-tab refusal does not feed the breaker (no tab to cure)');
vm.runInContext("__mlsHydNote(false, 'visit-bodies-incomplete {no-group\\u00d72}');", ctx);
ok(vm.runInContext('__mlsHydFatigue.streak', ctx) === 4, 'vm: the day-9 signature reaches the threshold');
vm.runInContext('__mlsHydNote(true, "");', ctx);
ok(vm.runInContext('__mlsHydFatigue.streak', ctx) === 0, 'vm: one proven chart resets the streak');

/* ---- boundary: si absorbs the telemetry (a field is not a field until every
   boundary passes it) ---- */
const SI = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_schedimport_exact.js'), 'utf8');
ok(SI.includes('fatigueRefresh: (r.receipt&&r.receipt.fatigueRefresh)===true') && SI.includes('one.fatigueRefresh=savedVisits.fatigueRefresh===true'),
  'si absorbs the refresh stamp on the success path (a refreshed-then-proven chart is the breaker working)');
ok(SI.includes('fatigueRefresh: vr.receipt.fatigueRefresh === true, hydStreak: Number(vr.receipt.hydStreak || 0)'),
  'si absorbs streak + stamp on the failure path (the ledger sees the breaker)');

/* fb-1.3 (3.0.56): MV3 suspends idle service workers and resets module state -
   day 9 on 3.0.55 fired ZERO recycles on a 22-chart day that should have
   recycled at chart 16. State now hydrates from chrome.storage.session at SW
   start and persists after every mutation cluster (classify hop, reload
   cluster, dead latch). Session scope: survives suspension, dies with the
   browser. */
ok(SRC.includes("chrome.storage.session.get('hydFatigue'"),
  'fb-1.3: state hydrates from session storage at SW start');
ok(SRC.includes('function __mlsHydPersist()') && SRC.includes('chrome.storage.session.set({ hydFatigue: __mlsHydFatigue })'),
  'fb-1.3: one persist helper writes the whole state');
{
  const persistCalls = (SRC.match(/__mlsHydPersist\(\);/g) || []).length;
  ok(persistCalls === 3,
    'fb-1.3: persists at exactly the three mutation clusters (classify, reload, dead latch), got ' + persistCalls);
}

console.log('fatigue-breaker: PASS (' + checks + ' checks)');
