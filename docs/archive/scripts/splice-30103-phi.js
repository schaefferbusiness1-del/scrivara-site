/* splice-30103-phi.js - ext 3.0.103 phi-1.0.0: four privacy/security closes
 * measured by the 2026-09-01 commercial sweep (adversarially verified):
 *  #64 real patient names were pushed into the name-parser shadow samples and
 *      persisted to chrome.storage.local (mlsNameShadowTotals.samples) forever
 *      -> samples carry LENGTHS only; stored samples with names are stripped
 *      at boot.
 *  #67 tokDiag ring persisted into chrome.storage.local (the token machinery
 *      law: session storage only; suite athena-action-token-session-runtime
 *      was red) -> chrome.storage.session; the local copy is removed at boot.
 *  #69 content.js mlsAppAthenaRemoteArmV1 listener had no trusted-origin gate
 *      -> same mlsTrustedOrigin(event.origin) gate as the main router.
 *  #74 a real athena MRN sat in a shipped comment -> neutral digits.
 * Exact-count anchors, latin1 index-splice, fail-closed.
 */
'use strict';
var fs = require('fs');

function splice(file, edits) {
  var s = fs.readFileSync(file, 'latin1');
  edits.forEach(function (e, i) {
    var n = s.split(e.find).length - 1;
    if (n !== e.n) { console.error('ABORT ' + file + ' edit ' + i + ': hits=' + n + ' expected ' + e.n + ' for: ' + e.find.slice(0, 70)); process.exit(1); }
    s = s.split(e.find).join(e.repl);
  });
  fs.writeFileSync(file, s, 'latin1');
  console.log('OK ' + file + ' (' + edits.length + ' edits)');
}

splice('background.js', [
  { n: 1,
    find: "if(N.samples.length<10)N.samples.push({kind:!newName?'canonical-reject':(!oldName?'canonical-add':'rename'),o:oldName,n:newName});",
    repl: "if(N.samples.length<10)N.samples.push({kind:!newName?'canonical-reject':(!oldName?'canonical-add':'rename'),oLen:oldName.length,nLen:newName.length}); /* phi-1.0.0 (3.0.103): lengths only - never a name */" },
  { n: 1,
    find: "(__sh.samples || []).forEach(function (sm) { if (T.samples.length < 40) T.samples.push(sm); });",
    repl: "(__sh.samples || []).forEach(function (sm) { if (T.samples.length < 40 && sm && !('o' in sm) && !('n' in sm)) T.samples.push(sm); }); /* phi-1.0.0: refuse any legacy name-bearing sample */" },
  { n: 1,
    find: "try { chrome.storage.local.set({ mlsTokDiagV1: self.__mlsTokDiag }); } catch (e2) {}",
    repl: "try { chrome.storage.session.set({ mlsTokDiagV1: self.__mlsTokDiag }); } catch (e2) {} /* phi-1.0.0 (3.0.103): session area only - the token law */" },
  { n: 1,
    find: "  var tokDiag = self.tokDiag;\n  try { tokDiag('boot-beacon'); } catch (eB) {}",
    repl: "  var tokDiag = self.tokDiag;\n  try { tokDiag('boot-beacon'); } catch (eB) {}\n  /* phi-1.0.0 (3.0.103): one-time boot purge of the two durable rings that\n     3.0.97-3.0.102 wrote into chrome.storage.local - the tokDiag ring (now\n     session-only) and any name-bearing nameShadow samples. Counts stay. */\n  try { chrome.storage.local.remove('mlsTokDiagV1', function () {}); } catch (ePg1) {}\n  try {\n    chrome.storage.local.get(['mlsNameShadowTotals'], function (st) {\n      try {\n        var T = st && st.mlsNameShadowTotals;\n        if (!T || !Array.isArray(T.samples)) return;\n        var kept = T.samples.filter(function (sm) { return sm && !('o' in sm) && !('n' in sm); });\n        if (kept.length === T.samples.length) return;\n        T.samples = kept; T.phiPurgedAt = Date.now();\n        chrome.storage.local.set({ mlsNameShadowTotals: T }, function () {});\n      } catch (ePg3) {}\n    });\n  } catch (ePg2) {}" },
  { n: 1,
    find: "var tdBag = await chrome.storage.local.get('mlsTokDiagV1');",
    repl: "var tdBag = await chrome.storage.session.get('mlsTokDiagV1');" },
  { n: 1,
    find: "and it VARIES run-to-run ('7833832' vs '#7833832' measured on",
    repl: "and it VARIES run-to-run ('1234567' vs '#1234567' measured on" }
]);

splice('content.js', [
  { n: 1,
    find: "    if (data.type !== 'mlsAppAthenaRemoteArmV1') return;\n",
    repl: "    if (data.type !== 'mlsAppAthenaRemoteArmV1') return;\n    if (!mlsTrustedOrigin(event.origin)) return; /* ra-origin-1.0.0 (3.0.103): the same trusted-origin gate every other bridge verb passes */\n" }
]);

splice('1p-feat_mls_schedimport_exact.js', [
  { n: 1, find: 'what keeps "#7833832" - an MRN, no space - completely untouched. */', repl: 'what keeps "#1234567" - an MRN, no space - completely untouched. */' }
]);
splice('1p-feat_mls_b121_pack.js', [
  { n: 1, find: 'STABLE chart-level athena patient id (banner #7833832 == the findpatient', repl: 'STABLE chart-level athena patient id (banner #1234567 == the findpatient' }
]);
console.log('SPLICE 3.0.103 phi-1.0.0 DONE');
