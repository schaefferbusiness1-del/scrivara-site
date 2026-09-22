/* splice-30103-phi-b.js - phi-1.0.1: the boot purge (tokDiag local ring +
 * name-bearing nameShadow samples) must live OUTSIDE the token-machinery
 * section - tests/athena-action-token-session-runtime.test.js runs that
 * section under a local/sync tripwire (any durable touch = red), and the
 * purge is not token state. Moved next to the nightly-backup alarm hook.
 * Exact-count anchors, latin1 index-splice, fail-closed.
 */
'use strict';
var fs = require('fs');

var PURGE = "  /* phi-1.0.0 (3.0.103): one-time boot purge of the two durable rings that\n     3.0.97-3.0.102 wrote into chrome.storage.local - the tokDiag ring (now\n     session-only) and any name-bearing nameShadow samples. Counts stay. */\n  try { chrome.storage.local.remove('mlsTokDiagV1', function () {}); } catch (ePg1) {}\n  try {\n    chrome.storage.local.get(['mlsNameShadowTotals'], function (st) {\n      try {\n        var T = st && st.mlsNameShadowTotals;\n        if (!T || !Array.isArray(T.samples)) return;\n        var kept = T.samples.filter(function (sm) { return sm && !('o' in sm) && !('n' in sm); });\n        if (kept.length === T.samples.length) return;\n        T.samples = kept; T.phiPurgedAt = Date.now();\n        chrome.storage.local.set({ mlsNameShadowTotals: T }, function () {});\n      } catch (ePg3) {}\n    });\n  } catch (ePg2) {}";

var TOP = "/* phi-1.0.1 (3.0.103): one-time boot purge of the two durable rings that\n   3.0.97-3.0.102 wrote into chrome.storage.local - the tokDiag ring (now\n   session-only) and any name-bearing nameShadow samples. Counts stay. Lives\n   here, outside the token section, because that section runs under a\n   durable-storage tripwire and this purge is housekeeping, not token state. */\ntry { chrome.storage.local.remove('mlsTokDiagV1', function () {}); } catch (ePg1) {}\ntry {\n  chrome.storage.local.get(['mlsNameShadowTotals'], function (st) {\n    try {\n      var T = st && st.mlsNameShadowTotals;\n      if (!T || !Array.isArray(T.samples)) return;\n      var kept = T.samples.filter(function (sm) { return sm && !('o' in sm) && !('n' in sm); });\n      if (kept.length === T.samples.length) return;\n      T.samples = kept; T.phiPurgedAt = Date.now();\n      chrome.storage.local.set({ mlsNameShadowTotals: T }, function () {});\n    } catch (ePg3) {}\n  });\n} catch (ePg2) {}\n";

var s = fs.readFileSync('background.js', 'latin1');
var find1 = "  try { tokDiag('boot-beacon'); } catch (eB) {}\n" + PURGE;
var n1 = s.split(find1).length - 1;
if (n1 !== 1) { console.error('ABORT: purge-in-token-section anchor hits=' + n1); process.exit(1); }
s = s.split(find1).join("  try { tokDiag('boot-beacon'); } catch (eB) {}");
var find2 = "try { chrome.alarms.onAlarm.addListener(a => { if (a && a.name === 'mlsNightlyBackup') runNightlyBackup('schedule'); }); } catch (e) {}";
var n2 = s.split(find2).length - 1;
if (n2 !== 1) { console.error('ABORT: nightly-backup anchor hits=' + n2); process.exit(1); }
s = s.split(find2).join(TOP + find2);
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK phi-1.0.1: purge moved out of the token section');
