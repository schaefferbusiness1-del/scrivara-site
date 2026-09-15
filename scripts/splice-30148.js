'use strict';
/* MLS Assist 3.0.148 - legsdiag-1.0.0 (Fable, 2026-09-15). Runs T-Y: the same two rows refuse every day, and their
 * refusal diag names only the LAST leg that failed (the schedule re-ground, or the Find page's no-results) - the
 * other leg's outcome is lost, so the mechanism has been guessed three times. Cure: every refused chart-open
 * answer carries, in its diag, the outcome of BOTH legs as closed codes - legFind / legSched ('opened', the leg's
 * own reason code, or 'not-run') and legOrder (which legs ran, in order). Attached once, in the handler's own
 * response wrapper, so no refusal site is forgotten; content.js copies the three keys through a closed sanitizer
 * (letters, digits, dashes; 40 chars) - never a name, DOB, MRN or text. Latin1 seams, inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
function splice(file, edits) {
  const target = path.join(__dirname, '..', file);
  const before = fs.readFileSync(target, 'latin1');
  let out = before; const done = [];
  const count = (s, n) => s.split(n).length - 1;
  for (const [a, b, label] of edits) {
    assert(count(out, a) === 1, file + ' ' + label + ' unique seam: ' + a.slice(0, 80) + ' (' + count(out, a) + ')');
    assert(count(out, b) === 0, file + ' ' + label + ' replacement absent');
    out = out.replace(a, () => b); done.push([a, b]);
  }
  let restored = out;
  for (const [x, y] of done.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
  assert.strictEqual(restored, before, file + ' inverse restores original');
  fs.writeFileSync(target, Buffer.from(out, 'latin1'));
  console.log('splice-30148 ' + file + ': ' + done.length + ' verified seams');
}
splice('background.js', [[
  "          rawSendResponse(Object.assign({}, payload || {}, { requestId: openGuard.token, deadlineAt: openGuard.deadline }));",
  "          var __p = Object.assign({}, payload || {}, { requestId: openGuard.token, deadlineAt: openGuard.deadline });" +
  " if (!__p.ok) { try { var __fr = (typeof findRes !== 'undefined') ? findRes : null, __sr = (typeof sched !== 'undefined') ? sched : null; __p.diag = Object.assign({}, __p.diag || {}, { legFind: __fr ? (__fr.opened ? 'opened' : String(__fr.reason || 'refused')) : 'not-run', legSched: __sr ? (__sr.opened ? 'opened' : String(__sr.reason || 'refused')) : 'not-run', legOrder: (typeof order !== 'undefined' && Array.isArray(order)) ? order.join('-') : '' }); } catch (_eLegs) {} } /* legsdiag-1.0.0 (3.0.148): every refusal names both legs' outcomes as closed codes */" +
  " rawSendResponse(__p);",
  'response wrapper']]);
splice('content.js', [[
  "              safeDiag.apptIdBound = openedDiag.apptIdBound === true; /* navproof-diag-1.0.0 (3.0.136) */",
  "              safeDiag.apptIdBound = openedDiag.apptIdBound === true; /* navproof-diag-1.0.0 (3.0.136) */\n" +
  "              ['legFind', 'legSched', 'legOrder'].forEach(function (key) { var v = String(openedDiag[key] == null ? '' : openedDiag[key]).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40); if (v) safeDiag[key] = v; }); /* legsdiag-1.0.0 (3.0.148): closed codes only */",
  'allowlist']]);
