'use strict';
/* MLS Assist 3.0.160 - schedscandiag-1.0.0 (Fable, 2026-09-16). Run AJ + an in-page probe (mlsAppSearchOpenPatient
 * for the one refused row, PHI in-page only): the schedule leg still answers name-not-found with the 8 s bottom
 * poll (schedwait-1.0.0), so the sweep's scan does not see the row for a reason the refusal cannot show. The
 * not-found answer now carries PHI-free evidence from the frame the sweep ran in: whether the requested last and
 * first name tokens occur ANYWHERE in the frame text (0/1), the appointment-list row count, the frame text length
 * and a route code for its path; the legsdiag wrapper copies them onto the refusal as legSched* counts and
 * content.js allowlists them. Diagnostic only; no gate changes. Latin1 seams, inverse proof. Run once (after
 * splice-30159c.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
function splice(file, fn) {
  const target = path.join(__dirname, '..', file);
  const before = fs.readFileSync(target, 'latin1');
  const { out, inverse } = fn(before);
  assert.strictEqual(inverse(out), before, file + ' inverse restores original');
  fs.writeFileSync(target, Buffer.from(out, 'latin1'));
}
const count = (s, n) => s.split(n).length - 1;
function mk(before) {
  let out = before; const edits = [];
  function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
  const inverse = (x) => { let y = x; for (const [a, b] of edits.slice().reverse()) { assert(count(y, b) === 1, 'inverse unique: ' + b.slice(0, 50)); y = y.replace(b, () => a); } return y; };
  return { rep, inverse, get: () => out };
}
splice('background.js', (before) => {
  const m = mk(before);
  m.rep("        return { phase: 'open', opened: false, candidates: 0, reason: requireAppointmentId === true ? 'appointment-id-not-found' : 'name-not-found', diag: { frame: location.hostname, scanned: scannedTotal, scrollers: scrollers.length, topScore: scannedTotal > 0 ? 0 : -1, apptIdBound: false } };",
        "        var __sdT = ''; try { __sdT = String(document.body && document.body.innerText || '').toLowerCase(); } catch (eSdT) {} /* schedscandiag-1.0.0 (3.0.160): PHI-free evidence of what the sweep's frame held */\n" +
        "        var __sdRows = 0; try { __sdRows = document.querySelectorAll('ul.appointments-container li').length; } catch (eSdR) {}\n" +
        "        var __sdPath = 0; try { var __sdP = String(location.pathname || ''); __sdPath = /\\/ax\\/dashboard/.test(__sdP) ? 1 : (/findpatient/.test(__sdP) ? 2 : (/\\/ax\\/(chart|encounter|briefing)/.test(__sdP) ? 3 : (/globalframeset|framecontent/.test(__sdP) ? 4 : 9))); } catch (eSdP) {}\n" +
        "        return { phase: 'open', opened: false, candidates: 0, reason: requireAppointmentId === true ? 'appointment-id-not-found' : 'name-not-found', diag: { frame: location.hostname, scanned: scannedTotal, scrollers: scrollers.length, topScore: scannedTotal > 0 ? 0 : -1, apptIdBound: false, lnameInDoc: (lname && __sdT.indexOf(lname) >= 0) ? 1 : 0, fnameInDoc: (fname && __sdT.indexOf(fname) >= 0) ? 1 : 0, listRows: __sdRows, docLen: __sdT.length, pathCode: __sdPath } };", 'not-found diag');
  m.rep("/* legsdiag-1.1.0 (3.0.149): the Find leg's counts ride on every refusal */",
        "/* legsdiag-1.1.0 (3.0.149): the Find leg's counts ride on every refusal */ if (__sr && __sr.diag) { ['scanned', 'scrollers', 'topScore', 'lnameInDoc', 'fnameInDoc', 'listRows', 'docLen', 'pathCode'].forEach(function (k) { if (__sr.diag[k] != null) __p.diag['legSched' + k.charAt(0).toUpperCase() + k.slice(1)] = __sr.diag[k]; }); } /* schedscandiag-1.0.0 (3.0.160): the schedule leg's scan evidence too */", 'wrapper');
  console.log('splice-30160 background.js: 2 seams');
  return { out: m.get(), inverse: m.inverse };
});
splice('content.js', (before) => {
  const m = mk(before);
  m.rep("'dobFindUsedRows', 'dobFindResultsTotal' /* findbydob-2.1.0 (3.0.158) */].forEach(function (key) {",
        "'dobFindUsedRows', 'dobFindResultsTotal' /* findbydob-2.1.0 (3.0.158) */, 'legSchedScanned', 'legSchedScrollers', 'legSchedTopScore', 'legSchedLnameInDoc', 'legSchedFnameInDoc', 'legSchedListRows', 'legSchedDocLen', 'legSchedPathCode' /* schedscandiag-1.0.0 (3.0.160) */].forEach(function (key) {", 'content counts');
  console.log('splice-30160 content.js: 1 seam');
  return { out: m.get(), inverse: m.inverse };
});
