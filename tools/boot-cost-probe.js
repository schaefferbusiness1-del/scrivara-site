/* boot-cost-probe — the one measurement that must come BEFORE the boot fix.
 *
 * Paste into the console of a SIGNED-IN tab, warm (second load), and read the
 * verdict line. Takes no arguments, changes nothing, writes nothing.
 *
 * WHY THIS EXISTS. The owner reports ~26s before the app is usable and calls it
 * slow login. It is not login: the page is interactive in 164ms. But the 26s has
 * only ever been seen on a signed-in session, and a warm ?preview=1 measurement
 * came back completely different:
 *
 *     domInteractive 293ms · load 3,598ms · script phase 2,919ms
 *     177 feature scripts, 176 cached, 39ms total download
 *     aggregate queue time 299,064ms
 *
 * A 2.9s script phase does not make a 26s load. Something else on the signed-in
 * path — data hydration, a backend call, a retry loop — plausibly owns most of
 * that time, and the loader is then a red herring. Rewriting the loader is the
 * highest-blast-radius change in the product; doing it against the wrong cause
 * would risk every boot to save nothing.
 *
 * So the verdict below is deliberately blunt about which fix the numbers
 * support, including "neither — look elsewhere".
 *
 * Progress is tracked by tests/boot-script-budget.test.js, which measures BOTH
 * bundling (unique feature names) and deferral (loaders appended during parse).
 * A win on either one moves a number there.
 */
(function () {
  'use strict';
  var t = performance.getEntriesByType('navigation')[0] || {};
  var res = performance.getEntriesByType('resource');
  var feats = res.filter(function (r) { return /feat_[a-z0-9_]+\.js/i.test(r.name); });

  function ms(v) { return Math.round(Number(v) || 0); }
  var sum = function (a, f) { return a.reduce(function (n, r) { return n + (Number(f(r)) || 0); }, 0); };

  var cached = feats.filter(function (r) { return r.transferSize === 0; }).length;
  var bytes = sum(feats, function (r) { return r.duration - (r.responseStart ? (r.responseStart - r.requestStart) : 0); });
  var queue = sum(feats, function (r) { return r.startTime && r.fetchStart ? (r.fetchStart - r.startTime) : 0; });
  var download = sum(feats, function (r) { return r.responseEnd - r.responseStart; });

  /* The script PHASE is the part a bundle or a defer can actually move: the
     window between the first feature request and the last one finishing. */
  var first = Math.min.apply(null, feats.map(function (r) { return r.startTime; }).concat([Infinity]));
  var last = Math.max.apply(null, feats.map(function (r) { return r.responseEnd; }).concat([0]));
  var scriptPhase = feats.length ? ms(last - first) : 0;

  var interactive = ms(t.domInteractive);
  var loadEnd = ms(t.loadEventEnd || t.duration);
  var afterScripts = Math.max(0, loadEnd - ms(last));

  /* The app screen is on screen in ?preview=1 too, so testing it alone reports
     "signed in" on the exact session this probe exists to rule out. Verified
     live: the preview reported signedIn:true and would have been read as the
     measurement that was asked for. The preview marks itself on <body>. */
  var appEl = document.getElementById('appScreen');
  var preview = /(^|\s)mls-public-preview(\s|$)/.test(document.body.className) ||
    /[?&](preview|demo)=1\b/.test(location.search);

  var out = {
    signedIn: !!(appEl && getComputedStyle(appEl).display !== 'none') && !preview,
    preview: preview,
    warm: cached > feats.length / 2,
    domInteractive: interactive,
    loadEventEnd: loadEnd,
    featureScripts: feats.length,
    cached: cached,
    totalDownloadMs: ms(download),
    aggregateQueueMs: ms(queue),
    scriptPhaseMs: scriptPhase,
    afterLastScriptMs: afterScripts
  };

  /* The verdict. Three outcomes, and the third is the one worth protecting:
     a loader rewrite that cannot explain the observed wait is not the fix. */
  var verdict;
  if (!out.signedIn) {
    verdict = (preview ? 'PREVIEW SESSION' : 'NOT SIGNED IN') +
      ' — this is the measurement that has already been taken and does not reproduce the report. Run it on the signed-in tab.';
  } else if (loadEnd < 8000) {
    verdict = 'The 26s did not reproduce here (load ' + loadEnd + 'ms). Do not touch the boot path on this evidence; capture a slow one first.';
  } else if (scriptPhase > loadEnd * 0.5) {
    verdict = 'LOADER IS THE CAUSE: the script phase is ' + scriptPhase + 'ms of a ' + loadEnd +
      'ms load. Bundling or deferral will move it. Deferral is the cheaper of the two and ' +
      'tests/boot-script-budget.test.js now measures it.';
  } else {
    verdict = 'LOADER IS A RED HERRING: the script phase is only ' + scriptPhase + 'ms of a ' + loadEnd +
      'ms load, and ' + afterScripts + 'ms elapses AFTER the last script. The cost is downstream of ' +
      'loading — hydration or a backend call. Profile that before rewriting the loader.';
  }

  out.verdict = verdict;
  try { console.table(out); } catch (e) {}
  console.log(verdict);
  return out;
})();
