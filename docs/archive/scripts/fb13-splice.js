/* fb-1.3 (3.0.56) - the breaker's state survives MV3 suspension.
 *
 * Day 9 on 3.0.55: ZERO recycles fired on a 22-chart day that should have
 * recycled at chart 16 - __mlsHydFatigue lives in a service-worker module
 * variable, MV3 suspends idle SWs mid-run (deep charts leave 60-90s gaps),
 * and suspension resets the counter so it may never reach 15. The reactive
 * streak has the same exposure. Fix: hydrate from chrome.storage.session at
 * SW start (survives suspension, dies with the browser - the right scope)
 * and persist after every mutation cluster. Fire-and-forget writes; the
 * module var stays the read path so no call site changes shape.
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

/* ---- A. hydrate at SW start + the persist helper, right after the state ---- */
const A = "  var __mlsHydFatigue = { streak: 0, lastRefreshAt: 0, hourAt: 0, refreshes: 0, pendingStamp: false, dead: '', chartsSinceRefresh: 0, lifetimeRefreshes: 0 };";
must(A, 'A-state');
const A2 = A + `
  /* fb-1.3: MV3 suspension resets module state - hydrate from session storage
     (async; until it lands the zeroed defaults are simply conservative) and
     persist after every mutation cluster. session scope = survives suspension,
     dies with the browser. */
  try {
    chrome.storage.session.get('hydFatigue', function (got) {
      try { if (got && got.hydFatigue) { var hf = got.hydFatigue; for (var hk in hf) { if (Object.prototype.hasOwnProperty.call(hf, hk)) __mlsHydFatigue[hk] = hf[hk]; } } } catch (eHyG) {}
    });
  } catch (eHyS) {}
  function __mlsHydPersist() {
    try { chrome.storage.session.set({ hydFatigue: __mlsHydFatigue }); } catch (eHyP) {}
  }`;
s = s.slice(0, s.indexOf(A)) + A2 + s.slice(s.indexOf(A) + A.length);

/* ---- B. persist at the classify hop (streak + chart counter mutate here) ---- */
const B = "      __mlsHydFatigue.chartsSinceRefresh = (__mlsHydFatigue.chartsSinceRefresh || 0) + 1;";
must(B, 'B-classify');
s = s.slice(0, s.indexOf(B)) + B + "\n      __mlsHydPersist();" + s.slice(s.indexOf(B) + B.length);

/* ---- C. persist after the reload branch's mutation cluster ---- */
const C = "          __mlsHydFatigue.streak = 0; __mlsHydFatigue.chartsSinceRefresh = 0; __mlsHydFatigue.pendingStamp = fbReactive ? 'fatigue' : 'proactive';";
must(C, 'C-reload-cluster');
s = s.slice(0, s.indexOf(C)) + C + " __mlsHydPersist();" + s.slice(s.indexOf(C) + C.length);

/* ---- D. persist when the dead latch sets (the loud stop must survive too) ---- */
const D = "            __mlsHydFatigue.dead = !fbPostR ? 'no-probe-answer' : (fbPostR.interstitial ? 'interstitial-after-reload' : (fbPostR.signIn ? 'sign-in-form-after-reload' : 'frameset-gone-after-reload'));";
must(D, 'D-dead-latch');
s = s.slice(0, s.indexOf(D)) + D + "\n            __mlsHydPersist();" + s.slice(s.indexOf(D) + D.length);

fs.writeFileSync(F, s, 'latin1');
console.log('SPLICED fb-1.3 bytes ' + before + ' -> ' + s.length);
