'use strict';
/* sim-1.0.0 pins: THE SCHEDULE-INCOMPLETE REFUSAL NAMES ITS REAL CAUSE.
 *
 * OLD BYTES FAIL BY NAME: the refusal printed "listed N but only M verified"
 * even when parsed >= expected and the completeness law actually failed on a
 * text-only or unnamed row (live 2026-08-25: "listed 26 but only 27 verified"
 * — both counts passing, the one text-only row below the pane fold unnamed).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const bg = fs.readFileSync(path.join(path.resolve(__dirname, '..'), 'background.js'), 'latin1');

/* the closed cause classifier exists, keyed on the completeness law's own terms */
assert.ok(bg.includes("var __incompleteCause = !__coverageComplete ? 'coverage-unverified' : (__expectedCount === 0 ? 'no-readable-rows' : (__legacyTextOnlyRows > 0 ? 'text-only-rows' : (__unnamedCount > 0 && __parsedCount >= __expectedCount ? 'unnamed-rows' : 'count-mismatch')));"),
  'the incomplete-cause classifier is gone - refusals flatten back into the count sentence');

/* every closed code survives */
['coverage-unverified', 'no-readable-rows', 'text-only-rows', 'unnamed-rows', 'count-mismatch'].forEach(code => {
  assert.ok(bg.includes("'" + code + "'"), 'incomplete cause code ' + code + ' vanished');
});

/* the two newly named classes carry their own operator instruction */
assert.ok(bg.includes('only as schedule text with no verified grid row'),
  'the text-only-rows message lost its cause statement');
assert.ok(bg.includes('Scroll the schedule so every appointment is visible, then retry.'),
  'the text-only-rows message lost its actionable instruction');
assert.ok(bg.includes('no readable patient name yet. Let the grid finish painting'),
  'the unnamed-rows message lost its cause statement');

/* the count sentence still exists but only as the count-mismatch arm */
const countMsgAt = bg.indexOf('could be verified before the view changed');
assert.ok(countMsgAt > 0, 'the genuine count-mismatch message vanished entirely');
const causeAt = bg.indexOf('var __incompleteCause =');
assert.ok(causeAt > 0 && causeAt < countMsgAt,
  'the count message no longer sits behind the cause classifier');

/* the refusal response carries the machine code */
assert.ok(bg.includes('error: __incompleteError, incompleteCause: __incompleteCause, surfaceDiag: {'),
  'the schedule-incomplete refusal dropped its incompleteCause code');

console.log('PASS schedule-incomplete cause pins: the refusal names coverage/empty/text-only/unnamed/count causes by closed code and message');
