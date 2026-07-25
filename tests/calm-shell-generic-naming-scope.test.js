'use strict';

/* The generic-label naming pass must stay scoped to #profileCard.
 *
 * b589/b593 gave the patient card's nine "Edit" buttons distinct accessible
 * names by subtracting the control's own words from its row's. The obvious next
 * step — run it everywhere, since visitView carries 76 controls including
 * "copy" x15 and "print" x10 — was measured against the live DOM at b599 and
 * REJECTED. Both candidate heuristics regress somewhere:
 *
 *   subtraction-first   #profileCard 9/9 correct
 *                       #visitView   names controls after the sibling BUTTON:
 *                                    "Copy — Print", "Print — Copy", and
 *                                    "Copy — PF-RUN-20260725-96375"
 *
 *   heading/inert-first #visitView   good ("Copy — Clinical note Draft")
 *                       #profileCard 8 of 9 WORSE: sections collapse onto
 *                                    "Visit context", and patient data is
 *                                    lifted into the name — measured example,
 *                                    "Edit — Sample medication 10 mg daily"
 *
 * The last one disqualifies a global pass on its own: an aria-label REPLACES
 * the visible text for a screen reader, so a wrong name is worse than a generic
 * one, and clinical detail does not belong in a control name.
 *
 * Cost was never the blocker and should not be cited as one: scoped to the
 * visible view the scan is 0.19ms against a 3.27ms render pass; document-wide
 * it is 2.1ms.
 *
 * This suite exists so the next session cannot "finish the job" and quietly
 * ship either regression.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

/* 1. The pass still exists and still names generic controls. */
assert(/function\s+nameIfGeneric\s*\(/.test(shell),
  'nameIfGeneric() is gone — the patient card would go back to nine controls all announcing "Edit".');
assert(/var\s+GENERIC_LABEL\s*=/.test(shell), 'GENERIC_LABEL is gone');

/* 2. It is called from exactly one place, and that place is the #profileCard
 *    pass. More call sites means it was generalised without re-measuring. */
const calls = (shell.match(/nameIfGeneric\s*\(/g) || []).length - 1; /* minus the declaration */
assert(calls === 1,
  'nameIfGeneric() has ' + calls + ' call site(s); exactly 1 is expected.\n' +
  'Generalising this pass was measured against the live DOM and regresses: see the ' +
  'comment above GENERIC_LABEL. If you are extending it deliberately, re-run that ' +
  'comparison first and update this suite with the new evidence.');

const patientScreen = (function () {
  const start = shell.indexOf('function patientScreen()');
  assert(start > -1, 'patientScreen() is gone');
  const end = shell.indexOf('\n  function ', start + 10);
  return shell.slice(start, end > start ? end : start + 2500);
})();
assert(/nameIfGeneric\(/.test(patientScreen),
  'nameIfGeneric() is no longer called from patientScreen(), so the card is unnamed again.');

/* 3. The evidence stays with the code. A future reader who cannot see WHY the
 *    scope is deliberate will widen it. */
assert(/DELIBERATELY SCOPED TO #profileCard/.test(shell),
  'the comment recording why this pass is not global was removed.');
/* Whitespace-flexible: the example is wrapped across comment lines. */
assert(/Sample medication\s+10 mg daily/.test(shell),
  'the measured example of patient data leaking into an accessible name was removed; ' +
  'it is the single strongest reason this pass is not global.');

console.log('PASS calm shell generic naming scope: the naming pass stays on #profileCard, with the measurement that rejected a global pass kept beside it');
