'use strict';

/* b585 — the prep summary may describe the RECORD, never the PATIENT.
 *
 * The pre-visit brief prints one line per clinical field. When a field is
 * empty the app has two entirely different situations it cannot tell apart:
 *
 *   (a) the chart says the patient has none, and
 *   (b) we never read that card.
 *
 * "PROBLEMS: None recorded" and "MEDICATIONS: None recorded" read as (a).
 * On a patient who is actually anticoagulated, a medication line that reads
 * as an affirmative "none" is a clinical hazard, and it was reached by doing
 * nothing more than opening a chart that had not hydrated.
 *
 * ALLERGIES already got this right — it names the uncertainty out loud and
 * tells the reader to confirm — and VITALS and HISTORY already said "Not
 * recorded", which describes the record. PROBLEMS and MEDICATIONS were the
 * two outliers, fixed in b585.
 *
 * Charter rule: "Never state a negative the system cannot back."
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

/* Pin the builder's fallbacks by their real call sites, so this fails on the
 * line that would reintroduce the claim rather than on a fuzzy text search. */
const FIELDS = [
  { label: 'PROBLEMS', expr: "(trim(ctx.problems) || blank.problems || 'Not recorded')" },
  { label: 'MEDICATIONS', expr: "(trim(ctx.meds) || blank.meds || 'Not recorded')" }
];

assert(connect.includes('var blank = ctx.emptyText || {}'),
  'coverage-receipt-aware empty wording must be the first fallback source');

for (const field of FIELDS) {
  assert(connect.includes(field.expr),
    field.label + ' prep-summary fallback is not the record-describing "Not recorded". ' +
    'Expected exactly: ' + field.expr + '\n' +
    'A bare "None recorded" asserts the patient HAS none, which the app cannot know ' +
    'when the chart never hydrated.');
}

/* The inverse: neither field may fall back to a phrase that asserts absence in
 * the patient. Guarding the specific regression, not every possible wording. */
for (const bad of ["(trim(ctx.problems) || 'None recorded')", "(trim(ctx.meds) || 'None recorded')"]) {
  assert(!connect.includes(bad),
    'prep summary reintroduced an unbacked clinical negative: ' + bad);
}

/* ALLERGIES is allowed to be longer, but it must keep naming the uncertainty.
 * Silence here is the highest-severity version of this defect. */
const allergyStart = connect.indexOf('var allergyEmpty = unread');
const allergyEnd = connect.indexOf("/* pvr-1.0.0:", allergyStart);
assert(allergyStart >= 0 && allergyEnd > allergyStart,
  'prep summary no longer defines its explicit ALLERGIES fallback');
const allergyBlock = connect.slice(allergyStart, allergyEnd);
assert(/confirm with patient/i.test(allergyBlock),
  'ALLERGIES fallback stopped telling the reader to confirm with the patient. ' +
  'An undocumented allergy list is not an absence of allergies.');
assert(connect.includes("lines.push('ALLERGIES: ' + (trim(ctx.allergies) || allergyEmpty));"),
  'ALLERGIES fallback is no longer connected to the emitted prep-summary line');

/* VITALS and HISTORY were already correct; keep them that way so the four
 * record-describing fields cannot drift apart again. */
for (const expr of ["'VITALS: ' + (vBits.length ? vBits.join(', ') : (blank.vitals || 'Not recorded'))",
                    "'HISTORY: ' + (hBits.length ? hBits.join(' | ') : (blank.history || 'Not recorded'))"]) {
  assert(connect.includes(expr),
    'prep summary field drifted from the record-describing convention: ' + expr);
}

console.log('PASS prep summary clinical negatives: PROBLEMS/MEDICATIONS/VITALS/HISTORY describe the record, ALLERGIES names its uncertainty');
