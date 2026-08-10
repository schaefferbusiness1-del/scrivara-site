/* qol-1.4 control: FOLLOW'S "NEVER DURING A PULL" GUARD SEES OTHER TABS.
   pullBusy() read only per-tab state (window.__mlsPullBusyAt + the local pull
   button's text) and was blind to a pull running in a second MLS tab — Follow
   could search-open a chart straight into another tab's drive. It now honors
   the cross-tab stamp uns('mlsPullBusyXTabV1'). Non-vacuity executed: the OLD
   predicate (verbatim) returns NOT-busy under a fresh cross-tab stamp. */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ff = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_athena_follow.js'), 'latin1');

const start = ff.indexOf('function pullBusy()');
const end = ff.indexOf('function recording()', start);
assert.ok(start > 0 && end > start, 'pullBusy bounds');
const src = ff.slice(start, end);

function makeBusy(bodySrc, stampAgeMs) {
  const store = {};
  if (stampAgeMs != null) store['sf_u::doc@x::mlsPullBusyXTabV1'] = String(Date.now() - stampAgeMs);
  const env = {
    safe: (fn, fb) => { try { return fn(); } catch (e) { return fb; } },
    window: { uns: s => 'sf_u::doc@x::' + s, __mlsPullBusyAt: 0 },
    localStorage: { getItem: k => (k in store ? store[k] : null) },
    $: () => null,
    S: x => String(x == null ? '' : x),
  };
  return new Function('safe', 'window', 'localStorage', '$', 'S', bodySrc + '\nreturn pullBusy;')(env.safe, env.window, env.localStorage, env.$, env.S);
}

/* fresh cross-tab stamp -> BUSY */
assert.strictEqual(makeBusy(src, 5000)(), true, 'a fresh cross-tab stamp means a pull is running somewhere — Follow must hold');
/* stale stamp -> not busy */
assert.strictEqual(makeBusy(src, 10 * 60 * 1000)(), false, 'a stale stamp does not wedge Follow forever');
/* no stamp -> not busy */
assert.strictEqual(makeBusy(src, null)(), false, 'idle stays idle');

/* non-vacuity: the b1005 predicate, verbatim — blind to the cross-tab stamp */
const OLD = "function pullBusy() {\n    var stampFresh = safe(function () { return (Date.now() - (window.__mlsPullBusyAt || 0)) < 120000; }, false);\n    var btnBusy = safe(function () {\n      var b = $('mlsDsPullBtn');\n      if (!b) return false;\n      var t = S(b.textContent).trim();\n      return !!t && !/^\\u{1F4E5}?\\s*Pull\\b/iu.test(t);\n    }, false);\n    return stampFresh || btnBusy;\n  }\n";
assert.strictEqual(makeBusy(OLD, 5000)(), false,
  'non-vacuity: the OLD guard is blind to a fresh cross-tab stamp — the defect this control fences');

console.log('qol-follow-sees-cross-tab-pulls: OK (cross-tab stamp honored, stale stamp released, old guard blind by name)');
