/* boot-cost-probe — measure boot the ONE way that has ever worked here.
 *
 * Paste into the console of a signed-in tab whose Chrome window is IN FRONT,
 * reload, and read the verdict. Changes nothing, writes nothing.
 *
 * ── READ THIS BEFORE TRUSTING ANY BOOT NUMBER ────────────────────────────────
 *
 * Three sessions failed to reproduce the owner's "26 seconds to log in" because
 * they measured a tab that was not in front. A backgrounded tab reports ~1.4s
 * and ZERO long tasks for the same boot that costs 24.5s in front, because
 * Chrome skips the style and layout the work dirties. This probe therefore
 * REFUSES to answer unless the tab is genuinely visible — a refusal here is the
 * probe working, not failing.
 *
 * The feature scripts also do not load until AFTER authentication (the login
 * screen is 5 resources), which is why the owner experiences this as slow
 * login. It is not login. A signed-out or ?preview=1 reading measures a
 * different page and has misled every session that took one.
 *
 * ── THEORIES ALREADY KILLED BY MEASUREMENT — do not re-open ─────────────────
 *
 *   network .................. 204/205 from cache, response 0.7ms
 *   parse/exec ............... all 212 scripts execute in 1,728ms when isolated
 *   one hot script ........... three runs blamed three DIFFERENT files
 *   stylesheet count ......... 196 <style> elements, ~1ms per insert
 *   the SW cache write ....... 1.7ms per put, ~350ms of 9.6s (real, not the cause)
 *   request count / BUNDLING . the same 205 assets through the same SW with an
 *                              idle main thread take ~170ms. A bundle buys ~2%.
 *
 * The per-script queue time (median 6,477ms) is a SYMPTOM of main-thread
 * contention, not a cause. An earlier version of this probe read that queue and
 * concluded "bundle the feature scripts". That conclusion is disproved, and the
 * earlier verdict text is why this file was rewritten.
 *
 * ── WHAT IS ACTUALLY LEFT ────────────────────────────────────────────────────
 *
 * The surviving candidate is the WORK the modules do: ~60 document-wide
 * MutationObservers and ~214 intervals, cost scaling as mutations x observers
 * rather than per-module. It explains what per-module attribution could not —
 * why no single script owns the blob, and why a background tab reads 1.4s.
 * Pinned population-wide by arm C of tests/boot-script-budget.test.js.
 *
 * It is a CANDIDATE, not a proven cause. What confirms or kills it is
 * per-module main-thread attribution taken in front, which is what `byModule`
 * below is for.
 */
(function () {
  'use strict';

  var out = {};
  var nav = performance.getEntriesByType('navigation')[0] || {};
  var paints = performance.getEntriesByType('paint') || [];

  /* ---- preconditions. Each one has already invalidated a real session's work. */
  var visible = document.visibilityState === 'visible' && document.hidden === false;
  var painting = paints.length > 0;
  var preview = /(^|\s)mls-public-preview(\s|$)/.test(document.body.className) ||
    /[?&](preview|demo)=1\b/.test(location.search);
  var appEl = document.getElementById('appScreen');
  var signedIn = !!(appEl && getComputedStyle(appEl).display !== 'none') && !preview;

  out.preconditions = {
    tabVisible: visible,
    compositing: painting,
    signedIn: signedIn,
    preview: preview
  };

  if (!visible || !painting) {
    out.verdict = 'REFUSING TO ANSWER — this tab is not in front (visibilityState=' +
      document.visibilityState + ', paint entries=' + paints.length + '). A backgrounded ' +
      'tab reads ~1.4s and zero long tasks for a boot that costs 24.5s in front. ' +
      'Focus the Chrome WINDOW (not just the tab), reload, and run this again.';
    console.warn(out.verdict);
    return out;
  }
  if (!signedIn) {
    out.verdict = 'REFUSING TO ANSWER — ' + (preview ? 'this is a ?preview=1 session' : 'not signed in') +
      '. The feature scripts do not load until after authentication; the login screen is 5 resources. ' +
      'This reading would measure a different page, which is the mistake that produced the ' +
      '"it does not reproduce" conclusion three times.';
    console.warn(out.verdict);
    return out;
  }

  /* ---- long tasks are the measurement that correlates. Resource timings do not. */
  var tasks = [];
  try { tasks = performance.getEntriesByType('longtask') || []; } catch (e) { tasks = []; }
  var tbt = tasks.reduce(function (n, t) { return n + Math.max(0, t.duration - 50); }, 0);
  var longest = tasks.reduce(function (n, t) { return Math.max(n, t.duration); }, 0);
  var lastTaskEnd = tasks.reduce(function (n, t) { return Math.max(n, t.startTime + t.duration); }, 0);

  var res = performance.getEntriesByType('resource');
  var feats = res.filter(function (r) { return /feat_[a-z0-9_]+\.js/i.test(r.name); });
  var ms = function (v) { return Math.round(Number(v) || 0); };

  out.mainThread = {
    longTasks: tasks.length,
    totalBlockingMs: ms(tbt),
    longestTaskMs: ms(longest),
    workEndsAtMs: ms(lastTaskEnd),
    note: tasks.length ? '' : 'zero long tasks recorded — either boot really was cheap, or the ' +
      'PerformanceObserver buffer was not retained for this navigation; re-run right after a reload'
  };
  out.page = {
    domInteractiveMs: ms(nav.domInteractive),
    loadEventEndMs: ms(nav.loadEventEnd || nav.duration),
    featureScripts: feats.length,
    cached: feats.filter(function (r) { return r.transferSize === 0; }).length
  };

  /* ---- the surviving candidate, counted live rather than from source. */
  var intervals = 0, observers = 0;
  try { intervals = (window.__mlsIntervalCount != null) ? window.__mlsIntervalCount : -1; } catch (e) { intervals = -1; }
  out.candidate = {
    documentWideObserversPinnedAt: 60,
    intervalsPinnedAt: 214,
    liveIntervalCount: intervals,
    hint: 'arm C of tests/boot-script-budget.test.js pins these population-wide'
  };

  /* ---- per-module attribution: the measurement that decides it.
     Deliberately NOT automated here. Two instruments are known to fail on this
     page and each has cost a session: load-event-gap attribution blamed three
     different files across three runs, and long-animation-frame returns nothing
     in a non-compositing pane. Use the Performance panel with the window in
     front and read Bottom-Up by URL. */
  out.byModule = 'Record a boot in the Performance panel (window in front) and read Bottom-Up ' +
    'grouped by URL. Do NOT use load-event-gap attribution or long-animation-frame here.';

  if (tbt > 3000) {
    out.verdict = 'REPRODUCED: ' + ms(tbt) + 'ms total blocking across ' + tasks.length +
      ' long tasks, work ending ' + ms(lastTaskEnd) + 'ms in. This is main-thread WORK, not loading. ' +
      'Do NOT bundle and do NOT batch stylesheets — both are disproved above. Attribute per module ' +
      'in the Performance panel, then make the modules that scan or render the whole patient store ' +
      'do it when their screen opens instead of at boot.';
  } else if (tbt > 0) {
    out.verdict = 'Boot is cheap on THIS session: ' + ms(tbt) + 'ms blocking. If the owner still ' +
      'reports a slow login, the difference is data volume — the 24.5s reading came from a store of ' +
      '1,481 patients. Compare patient counts before concluding anything.';
  } else {
    out.verdict = 'No long tasks recorded despite a visible tab. Reload with the console open and ' +
      're-run; if it stays zero, this session genuinely does not reproduce and the store size is ' +
      'the first thing to compare.';
  }

  try { console.table(out.preconditions); console.table(out.mainThread); } catch (e) {}
  console.log(out.verdict);
  return out;
})();
