'use strict';

/* Generic-label controls get a section in their accessible name, and the
 * derivation that makes that safe must not be "simplified" back.
 *
 * The patient card carried nine buttons all announcing "Edit"; the visit screen
 * carries 31 generic-labelled controls including "copy" x15 and "print" x10.
 * Tabbing either said "Edit, Edit, Edit" / "Copy, Copy, Copy".
 *
 * Two narrower derivations were tried against the LIVE DOM and rejected, and
 * both look reasonable enough to be proposed again:
 *
 *   subtract only the control's OWN words   #profileCard 9/9 right
 *                                           #visitView   names controls after
 *                                                        the sibling BUTTON —
 *                                                        "Copy — Print",
 *                                                        "Print — Copy"
 *   prefer an inert sibling ELEMENT         #visitView   readable
 *                                           #profileCard 8 of 9 WORSE, and it
 *                                                        lifted patient data
 *                                                        into the name:
 *                                                        "Edit — Sample
 *                                                        medication 10 mg daily"
 *
 * What works is subtracting EVERY control's text from the container. The two
 * regions differ only in where the buttons sit — beside the heading on the
 * patient card, INSIDE it on the visit screen
 * ("<h3>Patient after-visit summary Copy Print</h3>") — and removing all
 * control text leaves the heading's own words in both shapes.
 *
 * Measured after: #profileCard 9/9 unchanged, #visitView 31 named, 0 unnamed,
 * 30 distinct, no patient data in any name.
 *
 * An aria-label REPLACES the visible text for a screen reader, so a wrong name
 * is worse than a generic one and clinical detail must never reach one.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

/* 1. The pass and its vocabulary still exist. */
assert(/function\s+nameIfGeneric\s*\(/.test(shell),
  'nameIfGeneric() is gone — generic controls would go back to announcing only "Copy" / "Edit".');
assert(/var\s+GENERIC_LABEL\s*=/.test(shell), 'GENERIC_LABEL is gone');
for (const word of ['edit', 'copy', 'print']) {
  assert(new RegExp('GENERIC_LABEL[^\\n]*\\b' + word + '\\b').test(shell),
    'GENERIC_LABEL no longer covers "' + word + '", which is one of the measured offenders.');
}

/* 2. The derivation subtracts EVERY control, not just the one being named.
 *    This is the whole reason one heuristic can serve both regions. */
assert(/function\s+inertText\s*\(/.test(shell),
  'inertText() is gone — without it the visit screen names controls after each other.');
assert(/querySelectorAll\(CTRL_SEL\)/.test(shell),
  'inertText() no longer removes every control\'s text from the container. Subtracting only ' +
  'the named control\'s own words reintroduces "Copy — Print" on the visit screen.');
assert(/function\s+inertSibling\s*\(/.test(shell),
  'the inert-sibling fallback is gone; rows that are nothing but controls would go unnamed.');

/* 3. Opaque identifiers are never used as a name. */
assert(/function\s+usableName\s*\(/.test(shell) && /A-Z0-9-\]\{8,\}/.test(shell),
  'the opaque-identifier guard is gone; a run id such as PF-RUN-20260725-96375 could become ' +
  'a control\'s accessible name.');

/* 4. It runs over the ONE visible view, never the document. Cost was measured:
 *    0.19ms scoped against 2.1ms document-wide, on a 3.27ms render pass. */
assert(/function\s+nameGenericInView\s*\(/.test(shell), 'nameGenericInView() is gone');
const inView = (function () {
  const start = shell.indexOf('function nameGenericInView()');
  const end = shell.indexOf('\n  function ', start + 10);
  return shell.slice(start, end > start ? end : start + 1400);
})();
assert(/activeAppView\(\)/.test(inView),
  'nameGenericInView() no longer restricts itself to the active view. A document-wide walk ' +
  'costs 2.1ms per render pass on a 3.27ms budget, in a repo with a freeze history.');
assert(/function\s+activeAppView\s*\(/.test(shell) && /style\s*&&\s*views\[i\]\.style\.display/.test(shell),
  'activeAppView() no longer reads showView\'s inline display decision before falling back to forced layout.');

const namingPass = (function () {
  const start = shell.indexOf('function nameControls()');
  const end = shell.indexOf('\n  function ', start + 10);
  return shell.slice(start, end > start ? end : start + 2200);
})();
const hiddenViewGuard = namingPass.indexOf('owningView && owningView !== activeView');
const layoutRead = namingPass.indexOf('onScreen(el)');
assert(hiddenViewGuard >= 0 && layoutRead > hiddenViewGuard,
  'nameControls() must reject controls in inactive views before onScreen() performs offset/getClientRects layout reads.');

/* 5. It never overwrites a name the app itself chose, and the shell cleans up
 *    after itself so the Classic layout does not inherit these. */
assert(/getAttribute\('aria-label'\)\s*&&\s*!b\.getAttribute\('data-mls-secname'\)/.test(shell),
  'nameIfGeneric() may now overwrite an aria-label the app set deliberately.');
assert(/data-mls-secname/.test(shell) && /qsa\('\[data-mls-secname\]'\)/.test(shell),
  'teardown() no longer drops data-mls-secname, so Classic layout inherits the shell\'s names.');

/* 6. The evidence stays with the code. A reader who cannot see WHY the
 *    derivation is shaped this way will simplify it back. */
/* Whitespace-flexible: the example wraps across comment lines. */
assert(/Sample\s+medication\s+10\s+mg\s+daily/.test(shell),
  'the measured example of patient data leaking into an accessible name was removed; it is ' +
  'the single strongest reason the rejected heuristic stays rejected.');
assert(/Copy — Print|Copy - Print/.test(shell),
  'the measured example of controls naming each other was removed.');

console.log('PASS calm shell generic naming: every-control subtraction, scoped to the visible view, with the measurements that rejected both narrower derivations');
