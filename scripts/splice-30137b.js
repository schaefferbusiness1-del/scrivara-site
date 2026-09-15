'use strict';
/* MLS Assist 3.0.137 - navaccept-1.0.0 (Fable, 2026-09-14). Measured twice on the 3.0.136 live pull (tab
 * visible), identical signature on both schedule-route rows: apptIdBound, one row matched the exact
 * appointment id, the click changed TWO frames' URLs (neither carrying the appointment id, so the URL
 * delta proved nothing), and the encounter-acceptance leg then rejected one frame for not being
 * banner-grade and the OTHER - banner-grade, exact name AND DOB, encounter-ish surface - only because the
 * surface did not print the bound schedule date (eaRejDate 1). That frame is the patient's chart opened
 * by our own click; the date rule was written for a checked-in row landing on its encounter. Cure: a frame
 * whose URL CHANGED on our click, printing banner-grade exact name+DOB on an encounter-ish surface, is
 * accepted without the date; an unchanged frame keeps the date rule. The follow-up chart read re-proves
 * the banner in that same frame id (routeBoundBannerSeen) exactly as before, and writes keep every gate.
 * Counted in the closed diag (eaDatelessChanged). Latin1 seams, inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const only = process.argv[2] || '';
function editFile(file, plan) {
  const target = path.join(__dirname, '..', file);
  const before = fs.readFileSync(target, 'latin1');
  let out = before; const edits = [];
  const count = (s, n) => s.split(n).length - 1;
  function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
  function rep(a, b, label) { assert(count(out, a) === 1, file + ' ' + label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
  plan(rep, eolAt);
  let restored = out;
  for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
  assert.strictEqual(restored, before, file + ' inverse restores original');
  fs.writeFileSync(target, Buffer.from(out, 'latin1'));
  console.log('splice-30137b ' + file + ': ' + edits.length + ' verified seams');
}

if (!only || only === 'background.js') editFile('background.js', function (rep, eolAt) {
  var a;
  a = "                var __navDiag = { navChangedFrames: 0, eaSkipped: 0, eaNoCand: 0, eaCand: 0, eaTimeout: 0, eaMatches: 0, eaRejVia: 0, eaRejName: 0, eaRejDob: 0, eaRejEncish: 0, eaRejDate: 0 }; /* navproof-diag-1.0.0 (3.0.136): counts only */";
  rep(a, "                var __navDiag = { navChangedFrames: 0, eaSkipped: 0, eaNoCand: 0, eaCand: 0, eaChanged: 0, eaTimeout: 0, eaMatches: 0, eaRejVia: 0, eaRejName: 0, eaRejDob: 0, eaRejEncish: 0, eaRejDate: 0, eaDatelessChanged: 0 }; /* navproof-diag-1.0.0 (3.0.136) + navaccept-1.0.0 (3.0.137): counts only */", 'decl');
  a = "                        __navDiag.eaCand = eaCand.length; if (!eaCand.length) __navDiag.eaNoCand = 1;";
  rep(a, a + eolAt(a) + "                        var eaChangedIds = eaChanged.map(function (fr) { return fr.frameId; }); __navDiag.eaChanged = eaChangedIds.length; /* navaccept-1.0.0 (3.0.137) */", 'changed-ids');
  a = "                              if ((sur.dates || []).indexOf(eaWantDate) < 0) { __navDiag.eaRejDate++; return; }";
  rep(a, "                              if ((sur.dates || []).indexOf(eaWantDate) < 0) {" + eolAt(a) +
         "                                /* navaccept-1.0.0 (3.0.137): the date rule is for a checked-in row landing on its encounter. A frame" + eolAt(a) +
         "                                   our click just navigated, printing banner-grade exact name+DOB, is this patient's chart - accept it;" + eolAt(a) +
         "                                   the follow-up chart read re-proves the banner in this same frame id. An unchanged frame keeps the rule. */" + eolAt(a) +
         "                                if (eaChangedIds.indexOf(en.frameId) < 0) { __navDiag.eaRejDate++; return; }" + eolAt(a) +
         "                                __navDiag.eaDatelessChanged++;" + eolAt(a) +
         "                              }", 'accept');
  a = "                              encounterAcceptedReceipt = true;" + eolAt("                              encounterAcceptedReceipt = true;") + "                              try { sched.diag.encounterAccepted = true; } catch (eEa1) {}";
  rep(a, "                              encounterAcceptedReceipt = true;" + eolAt("                              encounterAcceptedReceipt = true;") + "                              try { sched.diag.encounterAccepted = true; sched.diag.eaDatelessChanged = __navDiag.eaDatelessChanged; } catch (eEa1) {} /* navaccept-1.0.0 (3.0.137) */", 'receipt');
});

if (!only || only === 'content.js') editFile('content.js', function (rep, eolAt) {
  var a = "               'findRows', 'findDobHit', 'findNameHit', 'findDobOnly', 'findAltRows', 'findTokens', 'findPunct', 'findComma' /* finddiag-1.0.0 (3.0.137) */].forEach(function (key) {";
  rep(a, "               'findRows', 'findDobHit', 'findNameHit', 'findDobOnly', 'findAltRows', 'findTokens', 'findPunct', 'findComma' /* finddiag-1.0.0 (3.0.137) */," + eolAt(a) +
         "               'eaChanged', 'eaDatelessChanged' /* navaccept-1.0.0 (3.0.137) */].forEach(function (key) {", 'allowlist');
});
