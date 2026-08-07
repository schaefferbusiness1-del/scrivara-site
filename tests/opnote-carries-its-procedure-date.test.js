'use strict';
/*
 * A NOTE THAT DOES NOT SAY WHEN THE PROCEDURE HAPPENED
 * -----------------------------------------------------------------------------
 * Owner, 2026-08-06: "for the op note the date of procidure needs to be put in."
 *
 * REPRODUCED 15/15 by a live QA pass — three templates, five drafts each, on a
 * real patient. `'2026-08-06'` was passed as `dateStr` on every call and NO
 * returned note contained it in ANY form: not `2026-08-06`, not `08/06/2026`,
 * not "August 6, 2026", not even the phrase "date of procedure".
 *
 * Unlike the medication defect this one is DETERMINISTIC and it affects EVERY
 * note rather than the 3 of 96 templates that carry drug placeholders — which
 * is why it was taken first despite sounding smaller.
 *
 * CAUSE: the date IS handed to the model, as "DATE OF PROCEDURE: <dateStr>" in
 * the user message. The prompt line directly above the fix says "NEVER ask for
 * patient name, sex/gender, age, date of birth, MRN, or BMI — treat those as
 * known or as boilerplate that needs no input." That means do not ASK; the
 * model generalised it to do not WRITE. Nothing instructed it to render the
 * procedure date, and none of the at-risk templates carry a [DATE] placeholder
 * for one to land in.
 *
 * WHY THIS GUARD REPAIRS WHERE THE DRUG GUARD REFUSES — the distinction is the
 * whole point and must not be blurred. The date is a value we were GIVEN, so
 * inserting it invents nothing. A drug dose was never given to us, so the drug
 * guard may only re-blank and re-ask. Same shape, opposite remedy.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function lift(name) {
  const at = html.indexOf('function ' + name + '(');
  assert(at >= 0, name + ' is not in ScribeFlow.html — the date guard was removed or renamed');
  let depth = 0, started = false, end = at;
  for (let i = at; i < html.length; i++) {
    const c = html[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  return html.slice(at, end);
}

const api = new Function('window', 'console', 'Date',
  lift('_opNoteHasDate') + '\n' + lift('_opGuardProcedureDate') +
  '\nreturn {_opNoteHasDate:_opNoteHasDate,_opGuardProcedureDate:_opGuardProcedureDate};'
)({}, { warn() {} }, Date);

const DATE = '2026-08-06';

/* ---- 1. THE MEASURED DEFECT: a dateless note gets a date ---------------- */
const DATELESS = 'LUMBAR FACET JOINT INJECTION\n' +
  'The patient was identified and consent confirmed.\n' +
  'The skin was prepped, draped, and anesthetized.\n' +
  'The needle was advanced under fluoroscopic guidance.';
assert.strictEqual(api._opNoteHasDate(DATELESS, DATE), false,
  'the detector thinks a note with no date has one — this is the 15/15 live case and it must be seen');

const fixed = api._opGuardProcedureDate(DATE, { note: DATELESS, missing: [] });
assert(fixed.dateGuard && fixed.dateGuard.added === DATE, 'the guard did not report inserting the date');
assert(api._opNoteHasDate(fixed.note, DATE), 'the guard ran and the note still has no date');
assert(/^Date of procedure: 2026-08-06\n/.test(fixed.note),
  'the date was not placed at the top of the note — it must not be buried in prose, where it reads as dictated');
assert(fixed.note.indexOf(DATELESS) >= 0, 'the guard rewrote the clinical body — it may only prepend');

/* ---- 2. EVERY RENDERING THE MODEL MIGHT ALREADY HAVE USED IS ACCEPTED ---
   The guard must not stack a second date onto a note that already says the day
   in prose. Getting this wrong turns one defect into a worse one: two dates on
   a signed operative note, disagreeing in format. */
[
  '2026-08-06', '8/6/2026', '08/06/2026', '8-6-2026',
  'August 6, 2026', 'August 06, 2026', 'Aug. 6, 2026', 'Aug 6 2026', '6 August 2026'
].forEach((rendering) => {
  const note = 'Date of procedure: ' + rendering + '\nThe patient was identified.';
  assert.strictEqual(api._opNoteHasDate(note, DATE), true,
    'the rendering "' + rendering + '" was not recognised as the same day — the guard would add a SECOND, conflicting date line');
  assert.strictEqual(api._opGuardProcedureDate(DATE, { note, missing: [] }).note, note,
    'a note already carrying "' + rendering + '" was modified');
});

/* ---- 3. A DIFFERENT DAY IS NOT THIS DAY -------------------------------- */
[
  'Date of procedure: 2026-08-07\n', 'Date of procedure: August 7, 2026\n',
  'Date of procedure: 8/7/2026\n', 'Date of birth: 2026-08-06\n'
].forEach((wrong) => {
  const has = api._opNoteHasDate(wrong + 'body', DATE);
  if (/Date of birth/.test(wrong)) {
    /* DOB carrying the same digits is the one case the detector cannot
       distinguish by value alone. Documented deliberately: it errs toward NOT
       adding a duplicate line, and the prompt carries the "do not confuse it
       with date of birth" instruction. Asserted so the behaviour is a decision
       on record rather than an accident someone else has to rediscover. */
    assert.strictEqual(has, true, 'behaviour changed: a same-day DOB now triggers a second date line');
  } else {
    assert.strictEqual(has, false, '"' + wrong.trim() + '" was accepted as 2026-08-06 — a wrong date would be left standing');
  }
});

/* ---- 4. NOTHING TO ENFORCE IS NOT A VIOLATION -------------------------- */
['', null, undefined].forEach((empty) => {
  const note = 'No date was supplied to this draft.';
  assert.strictEqual(api._opNoteHasDate(note, empty), true, 'an absent dateStr was treated as a missing date');
  assert.strictEqual(api._opGuardProcedureDate(empty, { note, missing: [] }).note, note,
    'the guard invented a date line when it had no date to insert');
});

/* ---- 5. NEGATIVE CONTROL: the fixture really is dateless ---------------
   If DATELESS ever gains a date, every assertion above passes against a guard
   that does nothing. */
assert(!/2026|August|Aug|8\/6/.test(DATELESS),
  'the dateless fixture now contains a date — this suite would pass against a guard that never runs');

/* ---- 6. the prompt half is present too ---------------------------------
   The guard is the guarantee, but the prompt is what makes the guard a rare
   fallback rather than the mechanism. If the instruction is dropped, every note
   gets a machine-prepended line instead of the model placing the date where
   the template wants it. */
/* Asserted against feat_mls_opnote_integrity.js, NOT ScribeFlow.html. The first
   version checked `html` — the shadowed prompt, which is never sent. It would
   have gone green on a build where the instruction reached the model in no
   form at all: the identical mistake as the guard itself, made inside the test
   written to catch that mistake. */
const _int = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
assert(/ALWAYS WRITE THE DATE OF PROCEDURE/.test(_int),
  'the procedure-date instruction is missing from the prompt the INSTALLED generator sends — the guard would silently become the only mechanism');


/* ── SHADOW GATE (QA, 2026-08-06) ──────────────────────────────────────────
   Everything above tests the IMPLEMENTATION. It cannot tell shipped from
   shadowed, and that distinction cost two builds of a patient-safety fix:
   b925 and b927 both put their guard in ScribeFlow.html's _genOpNote, which
   feat_mls_opnote_integrity.js replaces at load. Suite green, doctor still
   told "80 mg triamcinolone".
   So this file also refuses to pass unless the guard is wired into the
   generator that actually runs. The full contract lives in
   tests/opnote-guards-run-in-the-installed-generator.test.js; this is the
   tripwire, here so that anyone reading THIS suite alone is stopped too. */
const _integrity = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
assert(/window\._genOpNote\s*=/.test(_integrity),
  'feat_mls_opnote_integrity.js no longer installs _genOpNote — re-aim this check at whatever owns the generator now');
assert(_integrity.includes('window._opGuardProcedureDate('),
  'the INSTALLED generator does not call _opGuardProcedureDate. A definition in ScribeFlow.html is overwritten at load, so this suite would be green while every draft went unguarded — the exact live b926 defect.');

console.log('PASS op note carries its procedure date: the measured 15/15 dateless draft is repaired at the top of the note, ' +
  '9 renderings of the same day are accepted without adding a second conflicting line, a different day is refused, ' +
  'an absent date is not invented, and the prompt instruction is pinned alongside the guard');
