'use strict';
/* MLS Assist 3.0.136 - navproof-diag-1.0.0 (Fable, 2026-09-14). Measured on the 3.0.135 live pull with a
 * VISIBLE athenaOne tab: one schedule-route row refused 'appointment-navigation-unverified' twice, and its
 * diag carried nothing (route '', no counts) because the refusal built its diag from an empty object
 * instead of the schedule opener's own diag, and the encounter-acceptance leg kept no receipt of WHY every
 * candidate frame was rejected. Rule from 3.0.128-3.0.132: add a closed PHI-free field naming why before
 * guessing a fix. This adds counts only (frames changed, candidates, matches, rejections by check, timeout)
 * to the worker refusal and carries them through content.js's closed allowlist. Latin1 seams, inverse proof.
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
  console.log('splice-30136 ' + file + ': ' + edits.length + ' verified seams');
}

if (!only || only === 'background.js') editFile('background.js', function (rep, eolAt) {
  var a;
  a = "                var appointmentNavigationFrameIds = [];";
  rep(a, a + eolAt(a) +
      "                var __navDiag = { navChangedFrames: 0, eaSkipped: 0, eaNoCand: 0, eaCand: 0, eaTimeout: 0, eaMatches: 0, eaRejVia: 0, eaRejName: 0, eaRejDob: 0, eaRejEncish: 0, eaRejDate: 0 }; /* navproof-diag-1.0.0 (3.0.136): counts only */", 'decl');
  a = "                    appointmentNavigationFrameIds = navigationDelta.changedFrameIds || [];";
  rep(a, a + eolAt(a) +
      "                    __navDiag.navChangedFrames = appointmentNavigationFrameIds.length;", 'delta');
  a = "                      if (eaWantDob && eaWantDate && (msg.name || '')) {";
  rep(a, "                      if (!(eaWantDob && eaWantDate && (msg.name || ''))) __navDiag.eaSkipped = 1;" + eolAt(a) + a, 'skipped');
  a = "                        if (eaCand.length) {";
  rep(a, "                        __navDiag.eaCand = eaCand.length; if (!eaCand.length) __navDiag.eaNoCand = 1;" + eolAt(a) + a, 'cand');
  a = "                          if (eaIdX && !eaIdX.timeout && eaSurX && !eaSurX.timeout) {";
  rep(a, "                          if (!(eaIdX && !eaIdX.timeout && eaSurX && !eaSurX.timeout)) __navDiag.eaTimeout = 1;" + eolAt(a) + a, 'timeout');
  rep("                              if (!/^(?:banner|shadow-labels|shadow-banner)$/.test(String(idr.via || ''))) return;",
      "                              if (!/^(?:banner|shadow-labels|shadow-banner)$/.test(String(idr.via || ''))) { __navDiag.eaRejVia++; return; }", 'via');
  rep("                              if (!eaNameOk(idr.name, msg.name || '')) return;",
      "                              if (!eaNameOk(idr.name, msg.name || '')) { __navDiag.eaRejName++; return; }", 'name');
  rep("                              if (!eaGotDob || eaGotDob !== eaWantDob) return;",
      "                              if (!eaGotDob || eaGotDob !== eaWantDob) { __navDiag.eaRejDob++; return; }", 'dob');
  rep("                              if (sur.encish !== true) return;",
      "                              if (sur.encish !== true) { __navDiag.eaRejEncish++; return; }", 'encish');
  rep("                              if ((sur.dates || []).indexOf(eaWantDate) < 0) return;",
      "                              if ((sur.dates || []).indexOf(eaWantDate) < 0) { __navDiag.eaRejDate++; return; }", 'date');
  rep("                            eaMatches = eaMatches.filter(function (v, i, a) { return a.indexOf(v) === i; });",
      "                            eaMatches = eaMatches.filter(function (v, i, a) { return a.indexOf(v) === i; }); __navDiag.eaMatches = eaMatches.length;", 'matches');
  rep("diag: searchOpenDiag({ appointmentNavigationProven: false }) }); return;",
      "diag: searchOpenDiag(Object.assign({}, (sched && sched.diag) || {}, __navDiag, { appointmentNavigationProven: false })) }); return;", 'refusal');
});

if (!only || only === 'content.js') editFile('content.js', function (rep, eolAt) {
  var a = "              ['scanned', 'scrollers', 'topScore', 'inputCount', 'numericFieldsRefused', 'apptIdMatches', 'rowDobKnown'].forEach(function (key) {";
  rep(a, "              ['scanned', 'scrollers', 'topScore', 'inputCount', 'numericFieldsRefused', 'apptIdMatches', 'rowDobKnown'," + eolAt(a) +
      "               'navChangedFrames', 'eaSkipped', 'eaNoCand', 'eaCand', 'eaTimeout', 'eaMatches', 'eaRejVia', 'eaRejName', 'eaRejDob', 'eaRejEncish', 'eaRejDate' /* navproof-diag-1.0.0 (3.0.136) */].forEach(function (key) {", 'allowlist');
  a = "              safeDiag.rowMrnMatched = openedDiag.rowMrnMatched === true;";
  rep(a, a + eolAt(a) +
      "              safeDiag.apptIdBound = openedDiag.apptIdBound === true; /* navproof-diag-1.0.0 (3.0.136) */", 'apptIdBound');
});
