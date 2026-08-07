'use strict';
/*
 * A DRUG THE PATIENT DID NOT GET IS THE WORST THING THIS APP CAN WRITE
 * -----------------------------------------------------------------------------
 * Owner, 2026-08-06: "some times it puts in the wrong medication and stuff like
 * that it needs to be better."
 *
 * REPRODUCED on a real patient on live b923, 18 drafts across the template
 * families. Template `Lumbar Facet Joint Injection` carries [LOCAL ANESTHETIC]
 * and [STEROID DOSE] and names no drug anywhere in its own text. The draft came
 * back reading, verbatim:
 *
 *   "The skin was prepped, draped, and anesthetized with 1% lidocaine."
 *   "80 mg triamcinolone with [FILL: volume of anesthetic] of 0.25% bupivacaine
 *    was injected into each joint."
 *
 * Three drugs and a DOSE, invented. A signed note would assert the patient
 * received 80 mg of triamcinolone on no authority at all.
 *
 * CAUSE, and it is not model weakness. Two lines of the _genOpNote system
 * prompt point opposite ways for drug fields: one names medication name/dose/
 * volume as placeholder-worthy, the next says "BE CONSERVATIVE — use the FEWEST
 * placeholders possible … KEEP the template's value (a routine dose, a standard
 * volume)". The conservative one won, which is why every invented value is
 * textbook. A STRONGER MODEL FOLLOWS THAT INSTRUCTION MORE CONFIDENTLY, so
 * buying one would have made this worse.
 *
 * The tell that the blank machinery itself is fine: [VOLUME] survived as
 * `[FILL: volume of anesthetic]` IN THE SAME SENTENCE. Only the drug fields
 * were being resolved away — which is why "wrong medication" and "it doesn't
 * prompt for things to fill" are one defect seen from two ends.
 *
 * The prompt carve-out is a request. _opGuardDrugBlanks is the guarantee, and
 * it is what this suite pins.
 *
 * EXPOSURE, swept across all 96 templates: 3 carry drug-class placeholders
 * (Caudal ESI, Lumbar Facet Joint Injection, Genicular Nerve Block). 93 spell
 * their drugs out and cannot reach this path. So the guard is provable on its
 * ENTIRE at-risk population rather than sampled — and it keys off the
 * template's own tokens, never a list of template names, so a new template
 * carrying [STEROID DOSE] is covered on the day it is added.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

/* Lift the shipped functions out of the shipped file — never a re-implementation.
   A copy of the logic in the test is the "stub looser than the real thing" trap:
   it would pass while production did anything at all. */
function lift(name) {
  const at = html.indexOf('function ' + name + '(');
  assert(at >= 0, name + ' is not in ScribeFlow.html — the guard was removed or renamed');
  let depth = 0, started = false, end = at;
  for (let i = at; i < html.length; i++) {
    const c = html[i];
    if (c === '{') { depth++; started = true; }
    else if (c === '}') { depth--; if (started && depth === 0) { end = i + 1; break; } }
  }
  return html.slice(at, end);
}

const reAt = html.indexOf('var _OP_DRUG_FIELD_RE');
assert(reAt >= 0, '_OP_DRUG_FIELD_RE is gone — the guard cannot classify drug fields');
const reSrc = html.slice(reAt, html.indexOf('\n', reAt) + 1);

const sandbox = { window: {}, console: { warn() {} }, Date };
const load = new Function('window', 'console', 'Date',
  reSrc + '\n' + lift('_opDrugPlaceholdersIn') + '\n' + lift('_opGuardDrugBlanks') +
  '\nreturn {_opDrugPlaceholdersIn:_opDrugPlaceholdersIn,_opGuardDrugBlanks:_opGuardDrugBlanks};');
const { _opDrugPlaceholdersIn, _opGuardDrugBlanks } = load(sandbox.window, sandbox.console, Date);

/* ---- the real at-risk template shapes, as swept from the live library ---- */
const LUMBAR_FACET = 'Lumbar Facet Joint Injection\n' +
  'Levels: [LEVELS]  Laterality: [LATERALITY]  Diagnosis: [DIAGNOSIS]\n' +
  'The skin was anesthetized with [LOCAL ANESTHETIC].\n' +
  'A [GAUGE] needle was advanced to the [LEVELS] facet joints.\n' +
  '[STEROID DOSE] with [VOLUME] of [ANESTHETIC] was injected into each joint.';

const CAUDAL = 'Caudal Epidural Steroid Injection\n' +
  'Skin anesthetized with [LOCAL ANESTHETIC]; a [GAUGE] needle was used.\n' +
  '[STEROID DOSE] in [VOLUME] of [ANESTHETIC/SALINE] was injected.';

const GENICULAR = 'Genicular Nerve Block\n' +
  '[LOCAL ANESTHETIC] was infiltrated. A [GAUGE] needle was placed.\n' +
  '[STEROID DOSE] with [VOLUME] of [ANESTHETIC] was injected.';

/* One of the 93 that spell their drugs out — the regression population. */
const CLEAN_TFESI = 'Transforaminal Epidural Steroid Injection\n' +
  'Levels: [LEVELS]  Laterality: [LATERALITY]\n' +
  'The skin was anesthetized with 1% lidocaine without epinephrine.\n' +
  'A 22-gauge spinal needle was advanced under fluoroscopy.\n' +
  'Dexamethasone 10 mg in 2 mL preservative-free normal saline was injected.';

/* ---- 1. the drug fields are recognised, the prose fields are not --------- */
const lf = _opDrugPlaceholdersIn(LUMBAR_FACET).map((f) => f.label);
['LOCAL ANESTHETIC', 'GAUGE', 'STEROID DOSE', 'ANESTHETIC'].forEach((l) => {
  assert(lf.includes(l), 'drug-class field "' + l + '" was not recognised — the model will be allowed to invent it');
});
['LEVELS', 'LATERALITY', 'DIAGNOSIS'].forEach((l) => {
  assert(!lf.includes(l), '"' + l + '" was classified as a drug field — prose fields must stay inferable or every note fills with blanks');
});
assert.strictEqual(_opDrugPlaceholdersIn(CLEAN_TFESI).length, 0,
  'a template that spells its drugs out was treated as at-risk — 93 of 96 templates must pass straight through');

/* ---- 2. THE VERBATIM DEFECT. QA's captured output, re-blanked. ---------- */
const INVENTED = 'The skin was prepped, draped, and anesthetized with 1% lidocaine.\n' +
  'A 22-gauge needle was advanced to the L4-L5 facet joints.\n' +
  '80 mg triamcinolone with [FILL: volume of anesthetic] of 0.25% bupivacaine was injected into each joint.';

const guarded = _opGuardDrugBlanks(LUMBAR_FACET, { note: INVENTED, missing: [] });

assert(guarded.drugGuard && guarded.drugGuard.violated.length >= 3,
  'the guard did not notice that the model resolved the drug fields — this is the exact live defect and it must not pass');
['local_anesthetic', 'steroid_dose', 'anesthetic'].forEach((k) => {
  assert(guarded.drugGuard.violated.includes(k), 'drug field ' + k + ' was resolved by the model and the guard let it through');
});
guarded.drugGuard.violated.forEach((k) => {
  assert(guarded.note.indexOf('[[' + k + ']]') >= 0, 'field ' + k + ' was flagged but no blank was put back — the doctor is still told, not asked');
  assert(guarded.missing.some((m) => m.key === k), 'field ' + k + ' was re-blanked but never added to `missing`, so the Fields box will not prompt for it');
});

/* [VOLUME] survived correctly in the original output. It must not be
   double-blanked — re-asking for something already asked is its own defect. */
assert.strictEqual((guarded.note.match(/\[\[volume\]\]/g) || []).length, 0,
  'a field that correctly survived as [FILL: …] was re-blanked a second time');

/* ---- 3. NEGATIVE CONTROL, the one QA demanded ---------------------------
   Without the guard the invented dose is still there. If this ever fails, the
   assertions above are proving nothing — the note was already safe and the
   guard is decorative. */
assert(/80 mg triamcinolone/.test(INVENTED),
  'the fixture no longer contains the invented dose — this suite would pass against a guard that does nothing');
assert(/0\.25% bupivacaine/.test(INVENTED) && /1% lidocaine/.test(INVENTED),
  'the fixture lost the other two invented drugs');

/* ---- 4. the other two at-risk templates, same treatment ----------------- */
[['Caudal ESI', CAUDAL], ['Genicular Nerve Block', GENICULAR]].forEach(([name, tpl]) => {
  const fields = _opDrugPlaceholdersIn(tpl);
  assert(fields.length >= 3, name + ' has drug placeholders the guard cannot see');
  const bad = _opGuardDrugBlanks(tpl, { note: 'Ropivacaine 0.2% and 40 mg methylprednisolone were injected.', missing: [] });
  assert(bad.drugGuard.violated.length === fields.length,
    name + ': the model resolved every drug field and the guard caught only ' + bad.drugGuard.violated.length + ' of ' + fields.length);
});

/* ---- 5. a compliant draft is left completely alone ---------------------- */
const compliant = { note: 'The skin was anesthetized with [[local_anesthetic]].\n' +
  'A [[gauge]] needle was used. [[steroid_dose]] with [[volume]] of [[anesthetic]] was injected.', missing: [] };
const passed = _opGuardDrugBlanks(LUMBAR_FACET, compliant);
assert.strictEqual(passed.drugGuard.violated.length, 0, 'a draft that correctly blanked every drug field was flagged as a violation');
assert.strictEqual(passed.note, compliant.note, 'a compliant note was modified — the guard must be a no-op when the model behaved');

/* ---- 6. the 93 clean templates are untouched, object-identical ---------- */
const cleanIn = { note: CLEAN_TFESI, missing: [] };
const cleanOut = _opGuardDrugBlanks(CLEAN_TFESI, cleanIn);
assert.strictEqual(cleanOut, cleanIn,
  'a template with no drug placeholders was rewritten — 93 of 96 templates must not be touched at all');

/* ---- 7. coverage is by TOKEN, not by template name --------------------- */
const novel = 'Brand New Procedure 2027\nInject [STEROID DOSE] of [ANESTHETIC].';
assert.strictEqual(_opDrugPlaceholdersIn(novel).length, 2,
  'a template added tomorrow carrying [STEROID DOSE] is not covered — the guard must key off tokens, never a list of 3 known template names');


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
assert(_integrity.includes('window._opGuardDrugBlanks('),
  'the INSTALLED generator does not call _opGuardDrugBlanks. A definition in ScribeFlow.html is overwritten at load, so this suite would be green while every draft went unguarded — the exact live b926 defect.');

console.log('PASS op-note drug blanks are never invented: 4 drug-class fields recognised and 3 prose fields left inferable, ' +
  'the verbatim live defect (1% lidocaine / 0.25% bupivacaine / 80 mg triamcinolone) is re-blanked and re-prompted, ' +
  'all 3 at-risk templates covered by token not by name, a compliant draft and the 93 clean templates are untouched, ' +
  'and the fixture still carries the invented dose so the guard cannot be decorative');
