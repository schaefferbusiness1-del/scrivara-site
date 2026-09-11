'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const source = fs.readFileSync(path.resolve(__dirname, '..', '1p-feat_mls_writeflow.js'), 'utf8');
/* 2026-09-10: the scanner skips COMMENTS. It used to track quotes only, so one
   apostrophe in a prose comment inside the function ("a GENERIC review's own
   Save draft row...") opened a string that never closed, the brace depth
   desynced, and extract() returned 7KB ending in the middle of a different
   function - a SyntaxError that looks nothing like its cause. Comments cannot
   contain a real brace that matters here, so skipping them is strictly more
   correct and changes no other extraction. */
function extract(name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, 'missing ' + name);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') { const end = source.indexOf('*/', i + 2); i = (end < 0 ? source.length : end + 1); continue; }
    if (ch === '/' && source[i + 1] === '/') { const end = source.indexOf('\n', i + 2); i = (end < 0 ? source.length : end); continue; }
    if (ch === '"' || ch === "'" || ch === '`') quote = ch;
    else if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated ' + name);
}

const SAVENAMED_ROW_ID = 'save-named-sections';
/* savetruth-1.1.0 / 1.2.0 (2026-09-10) added three reads to this footer, each
   injected here the same way the others are:
     unifiedSaveVerified      - a GENERIC review's own Save draft row can land
                                verified without ever minting a named save row;
     unifiedSavePressed       - whether the save this review ran PRESSED Save,
                                which the read-only saved-note leg never does;
     savenamedNativeFinishShape - capability AND a section athenaOne can save
                                itself, which replaced the bare capability flag.
   savetruth-1.3.0 (2026-09-10) added two more, for the same reason each:
     unifiedSaveReadOnlyRefused - "The saved-note check did not finish" was
                                painted for a refused SAVE CLICK and for an
                                op note, which has no saved-note check at all;
     unifiedGenericSaveOwed   - a GENERIC review whose Save draft row the doctor
                                SELECTED still owes that press, so the footer
                                may not end "MLS never saves or signs". */
const factory = new Function('S', 'SAVENAMED_ROW_ID', 'wfprogCounts', 'savenamedVerified', 'savenamedRow', 'savenamedNativeVerified', 'savenamedNativeFinishShape', 'unifiedSaveVerified', 'unifiedSavePressed', 'unifiedSaveReadOnlyRefused', 'unifiedGenericSaveOwed', 'GENERICSAVE_FOOTER_OWED',
  extract('wfprogSaveStep') + '\n' + extract('wfprogFooterText') + '\nreturn wfprogFooterText;');
/* read out of the shipped source so a re-worded constant fails HERE */
const GENERICSAVE_FOOTER_OWED = /var GENERICSAVE_FOOTER_OWED = '([^']*)';/.exec(source)[1];
const footer = factory(String, SAVENAMED_ROW_ID, () => ({}),
  state => !!state.saved,
  state => state.hasSave ? { id: SAVENAMED_ROW_ID } : null,
  state => !!state.native,
  () => false,
  state => !!state.genericSaved,
  state => !!state.savePressed,
  state => !!state.saveReadOnly,
  state => (state.genericSaveOwed ? { id: 'save-draft' } : null),
  GENERICSAVE_FOOTER_OWED);

let checks = 0;
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }
function state(savePhase) {
  const rows = ['hpi', 'ros', 'exam', 'assessment-plan'].map(id => ({ id, phase: 'done' }));
  if (savePhase) rows.push({ id: SAVENAMED_ROW_ID, phase: savePhase });
  return { prog: { rows }, hasSave: !!savePhase };
}

eq(footer(state('write'), { outside: 0 }),
  '4 sections written, 0 not sent, 0 still to go. Encounter save is in progress. MLS never signs.',
  'an in-progress encounter save was counted as a fifth clinical section or described as impossible');
eq(footer(state('done'), { outside: 0 }),
  '4 sections written, 0 not sent, 0 still to go. Encounter saved and read back. MLS never signs.',
  'a verified encounter save was counted as a section or described as unsaved');
/* savetruth-1.2.0 (2026-09-10): "Encounter save was not verified" is a sentence
   about a Save press, so the footer may only say it where the receipt PROVES
   the Save click ran. The read-only saved-note leg refuses having clicked
   nothing but nav beads, and a step that never ran pressed nothing either. */
const refusedAfterPress = state('refused'); refusedAfterPress.savePressed = true;
eq(footer(refusedAfterPress, { outside: 0 }),
  '4 sections written, 0 not sent, 0 still to go. Encounter save was not verified. Inspect Athena before retrying. MLS never signs.',
  'an uncertain encounter save was laundered into a saved or never-attempted state');
const refusedReadOnly = state('refused'); refusedReadOnly.saveReadOnly = true;
eq(footer(refusedReadOnly, { outside: 0 }),
  '4 sections written, 0 not sent, 0 still to go. The saved-note check did not finish. MLS did not press Save and nothing was signed. Inspect Athena before retrying.',
  'a refused read-only saved-note check is still reported as a Save that was pressed and failed');
/* savetruth-1.3.0: NEITHER leg proven - a refused Save CLICK that never found
   the control, and every op note, which has no saved-note check to not finish.
   The sentence names the step this review actually has.
   savetruth-1.4.0 (2026-09-11): ...and it claims nothing about the press. This
   leg is also the one a TIMEOUT takes, and a timeout proves neither that Save
   was pressed nor that it was not - the click may have landed and the answer
   never come back - so "MLS did not press Save" was a claim nobody could make
   here, under an opening ("The encounter save did not finish") that assumes the
   step started. It now reports the one certain fact, the one guarantee that
   always holds, and the press the doctor can make next. */
const neitherProven = footer(state('refused'), { outside: 0 });
eq(neitherProven,
  '4 sections written, 0 not sent, 0 still to go. MLS did not get an answer from Athena for the save step. Nothing was signed. Open the encounter to check, then press Confirm again.',
  'a save step that proved neither leg still claims one of them');
/* the property, not just the spelling: neither unproven claim may come back */
eq(/did not press Save/.test(neitherProven), false,
  'the neither-proven footer claims Save was not pressed, which a timeout cannot know: ' + neitherProven);
eq(/saved-note check/.test(neitherProven), false,
  'the neither-proven footer names a saved-note check this review is not proven to have run: ' + neitherProven);
/* savetruth-1.3.0: a GENERIC review with its own Save draft row selected */
const genericOwed = { prog: { rows: ['note'].map(id => ({ id, phase: 'done' })) }, hasSave: false, genericSaveOwed: true };
eq(footer(genericOwed, { outside: 0 }),
  '1 section written, 0 not sent, 0 still to go.' + GENERICSAVE_FOOTER_OWED,
  'the footer still says MLS never saves over a selected, unsent Save draft press');

const partial = state('wait');
partial.prog.rows[2].phase = 'refused';
partial.prog.rows[3].phase = 'check';
eq(footer(partial, { outside: 1 }),
  '2 sections written, 1 not sent, 2 still to go. After the checked sections are verified, this same Confirm saves the encounter. MLS never signs.',
  'the clinical-section census or pending Save copy is incorrect');

console.log('PASS write-progress-save-accounting-runtime: ' + checks + ' checks');
