'use strict';
/* sim-1.0.0 — the schedule-incomplete refusal names the condition that ACTUALLY
 * failed the completeness law.
 *
 * Live 2026-08-25 (b1068, ext 3.0.8x): two day pulls refused with "Athena
 * listed 26 appointment rows but only 27 could be verified" — counts that PASS
 * the completeness clause (parsed >= expected). The real killer both times was
 * __legacyTextOnlyRows === 1: one row (the 10 PM appointment below the week
 * view pane's scroll fold) existed only in the text lane with no DOM twin. The
 * message hid that, printed two passing numbers, and told the operator to wait
 * on a grid that was already loaded — unfixable-by-instruction babysitting.
 *
 * This splice:
 *  1. inserts a closed-vocabulary cause classifier (__incompleteCause):
 *     coverage-unverified | no-readable-rows | text-only-rows | unnamed-rows |
 *     count-mismatch
 *  2. rewrites __incompleteError to key on that cause, with a cause-specific
 *     operator instruction for the two newly named classes
 *  3. carries incompleteCause on the schedule-incomplete refusal response so
 *     the engine/app can classify by machine code, never by English.
 *
 * background.js law: latin1 read/write, index-splice only, LF-first-then-CRLF
 * match with the replacement inheriting the matched form.
 */
const fs = require('fs');
const path = require('path');
const file = path.resolve(__dirname, '..', 'background.js');
let src = fs.readFileSync(file, 'latin1');

function spliceOne(label, findLF, replLF) {
  const findCRLF = findLF.replace(/\n/g, '\r\n');
  const replCRLF = replLF.replace(/\n/g, '\r\n');
  let idx = src.indexOf(findLF);
  let find = findLF, repl = replLF;
  if (idx < 0) { idx = src.indexOf(findCRLF); find = findCRLF; repl = replCRLF; }
  if (idx < 0) throw new Error('sim-splice: target not found: ' + label);
  if (src.indexOf(find, idx + 1) >= 0) throw new Error('sim-splice: target not unique: ' + label);
  src = src.slice(0, idx) + repl + src.slice(idx + find.length);
  console.log('spliced', label, 'at', idx);
}

/* ---- 1+2: the classifier and the cause-keyed message ---- */
const OLD_ERR = "          var __incompleteError = !__coverageComplete ? ('MLS could not finish the full two-dimensional Athena schedule sweep (' + String(__viewportCoverage && __viewportCoverage.reason || 'coverage-unverified').replace(/-/g, ' ') + '). Nothing was imported; keep the full Day schedule open and retry.') : (__expectedCount === 0 ? 'Athena did not show any readable appointment rows - the schedule grid may still be loading, or athenaOne is signed out. Open the signed-in Day schedule and retry. Nothing was imported.' : ('Athena listed ' + __expectedCount + ' appointment row' + (__expectedCount === 1 ? '' : 's') + ' but only ' + __parsedCount + ' could be verified before the view changed. Keep Athena on this day until the grid finishes loading, then retry. Nothing was imported.'));";
const NEW_ERR = "          var __incompleteCause = !__coverageComplete ? 'coverage-unverified' : (__expectedCount === 0 ? 'no-readable-rows' : (__legacyTextOnlyRows > 0 ? 'text-only-rows' : (__unnamedCount > 0 && __parsedCount >= __expectedCount ? 'unnamed-rows' : 'count-mismatch'))); /* sim-1.0.0: name the condition that ACTUALLY failed the completeness law - the old message printed the two counts even when they passed (26 listed / 27 parsed) and the killer was a text-only or unnamed row, which read as loading weather and hid the pane-scroll-fold defect. */\n          var __incompleteError = __incompleteCause === 'coverage-unverified' ? ('MLS could not finish the full two-dimensional Athena schedule sweep (' + String(__viewportCoverage && __viewportCoverage.reason || 'coverage-unverified').replace(/-/g, ' ') + '). Nothing was imported; keep the full Day schedule open and retry.') : (__incompleteCause === 'no-readable-rows' ? 'Athena did not show any readable appointment rows - the schedule grid may still be loading, or athenaOne is signed out. Open the signed-in Day schedule and retry. Nothing was imported.' : (__incompleteCause === 'text-only-rows' ? ('Athena rendered ' + __parsedCount + ' appointment row' + (__parsedCount === 1 ? '' : 's') + ' but ' + __legacyTextOnlyRows + ' of them ' + (__legacyTextOnlyRows === 1 ? 'exists' : 'exist') + ' only as schedule text with no verified grid row - usually a row scrolled past a schedule pane fold. Scroll the schedule so every appointment is visible, then retry. Nothing was imported.') : (__incompleteCause === 'unnamed-rows' ? ('Athena rendered ' + __parsedCount + ' appointment row' + (__parsedCount === 1 ? '' : 's') + ' but ' + __unnamedCount + ' of them ' + (__unnamedCount === 1 ? 'has' : 'have') + ' no readable patient name yet. Let the grid finish painting, then retry. Nothing was imported.') : ('Athena listed ' + __expectedCount + ' appointment row' + (__expectedCount === 1 ? '' : 's') + ' but only ' + __parsedCount + ' could be verified before the view changed. Keep Athena on this day until the grid finishes loading, then retry. Nothing was imported.'))));";
spliceOne('incomplete-error-classifier', OLD_ERR, NEW_ERR);

/* ---- 3: the refusal response carries the closed cause code ---- */
const OLD_RESP = "error: __incompleteError, surfaceDiag: {";
const NEW_RESP = "error: __incompleteError, incompleteCause: __incompleteCause, surfaceDiag: {";
spliceOne('refusal-carries-cause', OLD_RESP, NEW_RESP);

fs.writeFileSync(file, src, 'latin1');
console.log('sim-1.0.0 spliced OK');
