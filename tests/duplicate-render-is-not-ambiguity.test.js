'use strict';

/* `appointment-id-ambiguous` WAS ATHENA'S DOUBLE RENDER (b754).
 *
 * Reproduced on demand 2026-07-28: one mlsAppReadChart with a real name/dob/mrn
 * and appointmentId 40795090, Athena sitting on the 7/29 grid with 19
 * appointments, returned `appointment-id-ambiguous` - the exact refusal that
 * started the whole missing-history investigation.
 *
 * It was never ambiguous identity. athenaOne renders EVERY appointment TWICE -
 * the main schedule and a mini schedule, hence its own isMiniSchedule parameter -
 * and repeats the id across LI/A/SPAN/BUTTON. Measured on that grid: 186 nodes
 * carrying only 19 DISTINCT appointment ids, a 5.6x inflation.
 *
 * apptIdRow() already tried to dedupe, but `sameRow` only merges nodes that ARE
 * or CONTAIN one another. The main row and the mini-schedule row are siblings in
 * different containers, so they survived as two entries and tripped
 * `if (matchedRows.length > 1) ... ambiguous:true`.
 *
 * Consequence: the appointment-id path could NEVER resolve on this athenaOne
 * build. That is why a fully built and fully enforced identity spine never
 * produced a lookup, and why b753's briefing capture never fired - the read
 * refused before any briefing was reached.
 *
 * WHY COLLAPSING IS SAFE AND NOT A LOOSENED GATE - the part that matters:
 *   apptIdRow searches for ONE EXACT wanted id, so every holder carries that same
 *   id by construction, and every matched row has ALREADY been required to
 *   contain the expected last name. An appointment id is unique per appointment,
 *   so two matches are the same appointment drawn twice. No identity proof is
 *   weakened: the follow-up chart read still verifies the banner and the caller
 *   still supplies name/dob/mrn.
 *
 * ---- SECOND FIX: allergies must not, alone, mean "captured" ----
 * The store census reported withContent 19/19 with contentVerified true while its
 * own breakdown showed problems 11, meds 0, vitals 0, history 0 - because
 * allergies counted 19. Those are the literal NKDA strings that mergeOwned
 * PRESERVES whenever the fresh read is empty; they were present even on a
 * SIGNED-OUT pull that stored nothing. A field the broken path does not produce
 * cannot be evidence that the path worked. This is the same exclusion the
 * chart-import gate already makes, applied one level up.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

/* ---- 1. an exact-id match must never refuse as ambiguous ---- */
{
  const at = bg.indexOf('function apptIdRow()');
  assert(at > 0, 'apptIdRow must still exist');
  /* A fixed window, NOT "up to the next `function `": the fix itself introduces
     an inner `var inMini = function (el)`, so slicing at the next `function `
     ended the window before the code being asserted and the suite failed on the
     very change it was written to pin. */
  const fn = bg.slice(at, at + 6000);

  assert(!/matchedRows\.length > 1\) return \{[^}]*ambiguous: true/.test(fn),
    'an exact appointment-id match still refuses as ambiguous when more than one ROW matches. ' +
    'Every holder carries the one wanted id and every row already matched the expected last ' +
    'name, so those are duplicate RENDERS of one appointment (athena draws a main schedule and ' +
    'a mini schedule). This refusal made the appointment-id path unresolvable on every pull.');

  assert(/dupRenders:/.test(fn),
    'the collapse must report how many duplicate renders it merged, so it stays visible in the ' +
    'diag instead of silently passing');

  /* it must PICK, and prefer the main grid over the mini schedule */
  assert(/MINI_RE/.test(fn) && /inMini/.test(fn),
    'the collapse must prefer a row outside any mini-schedule container - the mini row is the ' +
    'abbreviated copy');
  assert(/pool\.sort\(/.test(fn),
    'among equally eligible rows the collapse must choose deterministically (longest row text = ' +
    'the fuller main-grid row), not whichever happened to be found first');

  /* and the safety that makes it legitimate must still be there */
  assert(/lname/.test(fn) && /indexOf\(lname\)/.test(fn),
    'the row must STILL be required to contain the expected last name - that requirement is what ' +
    'makes collapsing duplicate renders safe rather than a guess');
}

/* ---- 2. allergies stay in the breakdown but do not decide "captured" ---- */
{
  assert(/var CENSUS_CONTENT_FIELDS = /.test(si),
    'there must be a content-deciding field subset distinct from the reporting breakdown');
  const m = /var CENSUS_CONTENT_FIELDS = \[([^\]]*)\]/.exec(si);
  assert(m, 'CENSUS_CONTENT_FIELDS must be a literal list');
  assert(!/allergies/.test(m[1]),
    'allergies must NOT be a content-deciding field. mergeOwned preserves a prior allergy value ' +
    'when the fresh read is empty and athenaOne prints that section as the literal NKDA, so ' +
    'allergies were present for 19 of 19 patients on a pull that stored nothing - and on a ' +
    'signed-OUT session. Counting it makes the census unable to detect total capture failure.');
  /* the breakdown must still report it, or we lose visibility */
  const full = /var CENSUS_FIELDS = \[([^\]]*)\]/.exec(si);
  assert(full && /allergies/.test(full[1]),
    'allergies must still appear in the reporting breakdown - excluding it from the DECISION is ' +
    'not a reason to stop measuring it');
  /* and the decision must actually use the subset */
  assert(/CENSUS_CONTENT_FIELDS\[ci\]/.test(si) || /CENSUS_CONTENT_FIELDS\[/.test(si),
    'the withContent decision must iterate the content subset, not the full breakdown list');
}

console.log('PASS duplicate render is not ambiguity: an exact appointment-id match collapses ' +
  'duplicate main/mini renders to the richest main row and reports dupRenders instead of ' +
  'refusing, while still requiring the expected last name; and allergies remain in the census ' +
  'breakdown but can no longer, alone, mark a record as captured');
