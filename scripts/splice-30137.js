'use strict';
/* MLS Assist 3.0.137 - finddiag-1.0.0 (Fable, 2026-09-14). Measured on the 3.0.136 live pull (tab visible):
 * the three rows that never open all fail the Find leg first ('no-name-match' / 'no-results'), and only then
 * fall into the schedule row click that proves no navigation. The Find refusal carried nothing about the
 * result rows it rejected. Add closed PHI-free COUNTS to the Find driver's refusals (rows scanned, rows whose
 * DOB matched, rows whose name matched, DOB-only rows, DOB rows printing an alternate name, and the searched
 * term's shape) and carry them through the worker refusals and content.js's closed allowlist. Latin1 seams,
 * inverse proof. Run once.
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
  console.log('splice-30137 ' + file + ': ' + edits.length + ' verified seams');
}

if (!only || only === 'background.js') editFile('background.js', function (rep, eolAt) {
  var a;
  /* 1. the Find driver: the searched term's shape on the no-results refusal */
  a = "      if (!/\\d+\\s+results?\\s+found/i.test(resText)) return { opened: false, reason: (/cannot leave the find text field blank/i.test(resText) ? 'blank-error' : (/no results/i.test(resText) ? 'no-results' : 'results-timeout')) };";
  rep(a, "      if (!/\\d+\\s+results?\\s+found/i.test(resText)) return { opened: false, reason: (/cannot leave the find text field blank/i.test(resText) ? 'blank-error' : (/no results/i.test(resText) ? 'no-results' : 'results-timeout')), diag: { findTokens: String(name || '').split(/\\s+/).filter(Boolean).length, findPunct: /['\\u2019\\-.]/.test(String(name || '')) ? 1 : 0, findComma: String(name || '').indexOf(',') >= 0 ? 1 : 0 } /* finddiag-1.0.0 (3.0.137): counts only */ };", 'no-results');
  /* 2. per-row evidence */
  a = "        return {ok:dates.length===1&&mlsExactIdentityPair({name:name,dob:dob},{name:rowName,dob:dates[0]}).ok,dob:dates.length===1?dates[0]:''};";
  rep(a, "        var __dobHit=dates.length===1&&!!mlsExactDobKey(dob)&&dates[0]===mlsExactDobKey(dob), __nameHit=!!rowName&&!!mlsExactNameKey(name)&&mlsExactNameKey(rowName)===mlsExactNameKey(name); /* finddiag-1.0.0 (3.0.137) */" + eolAt(a) +
         "        return {ok:dates.length===1&&mlsExactIdentityPair({name:name,dob:dob},{name:rowName,dob:dates[0]}).ok,dob:dates.length===1?dates[0]:'',dobHit:__dobHit,nameHit:__nameHit,alt:/\\(|\\blegal\\b|\\bpreferred\\b/i.test(cells.join(' '))};", 'row-evidence');
  a = "      var exact = [], prefix = [], pool = [], mrnNarrowed = false;";
  rep(a, a + eolAt(a) + "      var __fd = { findRows: 0, findDobHit: 0, findNameHit: 0, findDobOnly: 0, findAltRows: 0 }; /* finddiag-1.0.0 (3.0.137): counts only, never a name or DOB */", 'counters');
  a = "        if(evidence.ok) pool.push({a:chartAs[c],dob:evidence.dob,mrnMatched:false});";
  rep(a, "        __fd.findRows++; if(evidence.dobHit)__fd.findDobHit++; if(evidence.nameHit)__fd.findNameHit++; if(evidence.dobHit&&!evidence.nameHit)__fd.findDobOnly++; if(evidence.dobHit&&evidence.alt)__fd.findAltRows++;" + eolAt(a) + a, 'count');
  a = "      if(pool.length!==1) return {opened:false,attempted:false,reason:pool.length?'ambiguous':'no-name-match',count:pool.length,tier:'exact-name-dob'};";
  rep(a, "      if(pool.length!==1) return {opened:false,attempted:false,reason:pool.length?'ambiguous':'no-name-match',count:pool.length,tier:'exact-name-dob',diag:__fd};", 'refusal');
  /* 3. the worker refusals carry the Find diag */
  a = "                  reason: findRes.reason, findReason: findRes.reason }); return;";
  rep(a, "                  reason: findRes.reason, findReason: findRes.reason, diag: searchOpenDiag(Object.assign({}, findRes.diag || {}, { route: 'findpatient' })) }); return; /* finddiag-1.0.0 (3.0.137) */", 'find-refusal');
  a = "diag: searchOpenDiag(Object.assign({}, (sched && sched.diag) || {}, __navDiag, { appointmentNavigationProven: false })) }); return;";
  rep(a, "diag: searchOpenDiag(Object.assign({}, (findRes && findRes.diag) || {}, (sched && sched.diag) || {}, __navDiag, { appointmentNavigationProven: false })) }); return;", 'nav-refusal');
});

if (!only || only === 'content.js') editFile('content.js', function (rep, eolAt) {
  var a = "               'navChangedFrames', 'eaSkipped', 'eaNoCand', 'eaCand', 'eaTimeout', 'eaMatches', 'eaRejVia', 'eaRejName', 'eaRejDob', 'eaRejEncish', 'eaRejDate' /* navproof-diag-1.0.0 (3.0.136) */].forEach(function (key) {";
  rep(a, "               'navChangedFrames', 'eaSkipped', 'eaNoCand', 'eaCand', 'eaTimeout', 'eaMatches', 'eaRejVia', 'eaRejName', 'eaRejDob', 'eaRejEncish', 'eaRejDate' /* navproof-diag-1.0.0 (3.0.136) */," + eolAt(a) +
         "               'findRows', 'findDobHit', 'findNameHit', 'findDobOnly', 'findAltRows', 'findTokens', 'findPunct', 'findComma' /* finddiag-1.0.0 (3.0.137) */].forEach(function (key) {", 'allowlist');
});
