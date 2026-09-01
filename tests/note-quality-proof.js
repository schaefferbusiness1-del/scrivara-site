/* =============================================================================
 * note-quality-proof.js  (noteq-1.0.0, b1169)
 *
 * Proves the note-quality floor is real, in the four ways it could be fake:
 *
 *   1. It would be fake if a professional note failed it. So a genuine,
 *      standards-complete exemplar of EVERY note type is graded and must pass
 *      its own floor with zero block failures.
 *   2. It would be fake if a bad note passed it. So a boilerplate/incomplete
 *      note of every type is graded and must fail, AND must name the specific
 *      elements it is missing - a grader that says "quality issue" and no more
 *      teaches the doctor nothing.
 *   3. It would be fake if the contract never reached the model. So the
 *      derived, shipping bytes are grepped at every generation site.
 *   4. It would be fake if it looped. So the regeneration bound is pinned at
 *      exactly one, in the module constant and in every call site.
 *
 * Offline, deterministic, no network. Prints "PASS note-quality: N checks".
 * ============================================================================= */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const Q = require(path.join(ROOT, 'feat_mls_note_quality.js'));

let checks = 0;
const failures = [];

function ok(cond, msg) {
  checks++;
  if (!cond) failures.push(msg);
}
function eq(a, b, msg) {
  checks++;
  if (a !== b) failures.push(msg + ` (got ${JSON.stringify(a)}, wanted ${JSON.stringify(b)})`);
}
function read(rel) {
  const p = path.join(ROOT, rel);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
}

/* ---------------------------------------------------------------------------
 * 0. Module shape
 * ------------------------------------------------------------------------- */
eq(Q.version, 'noteq-1.0.0', 'module version drifted');
ok(typeof Q.contractFor === 'function', 'contractFor is not exported');
ok(typeof Q.grade === 'function', 'grade is not exported');
ok(typeof Q.floor === 'function', 'floor is not exported');
ok(Q.ledger && typeof Q.ledger.record === 'function', 'ledger.record is not exported');
ok(typeof Q.ledger.stats === 'function', 'ledger.stats is not exported');
eq(Q.ledger.cap, 500, 'the ledger cap is not 500');
eq(Q.MAX_REGENERATIONS, 1, 'the regeneration bound is not exactly one');

/* The floor is a CONSTANT: it must not move when settings-shaped input is
 * pushed at it, and it must be identical on repeat calls. */
const floorsBefore = Q.noteTypes.map((t) => Q.floor(t)).join(',');
try { Q.FLOORS['operative-procedure-note'] = 1; } catch (e) { /* frozen is fine too */ }
const opFloorNow = Q.floor('op note');
ok(opFloorNow >= 88, 'the operative-note floor was lowered by writing to FLOORS');
try { Q.FLOORS['operative-procedure-note'] = 92; } catch (e) { }
eq(Q.noteTypes.map((t) => Q.floor(t)).join(','), floorsBefore, 'floors are not stable across calls');

/* type resolution covers the app's own spellings */
eq(Q.normalizeType('op note'), 'operative-procedure-note', 'op note does not resolve');
eq(Q.normalizeType('opnote'), 'operative-procedure-note', 'opnote does not resolve');
eq(Q.normalizeType('hpi'), 'hpi', 'hpi does not resolve');
eq(Q.normalizeType('assessment'), 'assessment-plan', 'assessment does not resolve');
eq(Q.normalizeType('plan'), 'assessment-plan', 'plan does not resolve');
eq(Q.normalizeType('exam'), 'ros-pe', 'exam does not resolve');
eq(Q.normalizeType('ros'), 'ros-pe', 'ros does not resolve');
eq(Q.normalizeType('soap'), 'visit-note-soap', 'soap does not resolve');
eq(Q.normalizeType('template_reformat'), 'template-fidelity', 'template reformat does not resolve');

/* ---------------------------------------------------------------------------
 * 1. PROFESSIONAL EXEMPLARS - every one must PASS its own floor.
 * ------------------------------------------------------------------------- */

const EX_OP = `OPERATIVE / PROCEDURE NOTE

PATIENT: Doe, Jane
DATE OF PROCEDURE: 08/28/2026
TIME OF PROCEDURE: 10:42 AM
FACILITY: Ambulatory Procedure Suite 2
PROCEDURALIST: Matthew Schaeffer, M.D.
ASSISTANT: None.

PRE-PROCEDURE DIAGNOSIS: Chronic right-sided lumbar facet arthropathy, right L4-L5 and right L5-S1, with axial low back pain for 14 months.

POST-PROCEDURE DIAGNOSIS: Same.

PROCEDURE PERFORMED: Fluoroscopically guided right L3 and right L4 medial branch blocks and right L5 dorsal ramus block, targeting the right L4-L5 and right L5-S1 facet joints. Diagnostic block, first of two.

INDICATION: Medical necessity for this diagnostic block rests on 14 months of axial low back pain, paravertebral tenderness with facet loading on the right, and the absence of radicular findings. Conservative care failed: physical therapy for 10 weeks and meloxicam for 12 weeks produced inadequate relief. Imaging correlation was obtained; MRI of 05/12/2026 was reported as showing facet arthropathy at the right L4-L5 and right L5-S1 levels.

PRE-PROCEDURE ASSESSMENT: Allergies: no known drug allergies. Antithrombotic status: the patient is not on any anticoagulant or antiplatelet agent; none was held. Pre-procedure pain 7/10 on the numeric rating scale. Vital signs were stable. The patient was not sedated and remained awake throughout.

INFORMED CONSENT: Informed consent was obtained before the procedure. The risks of bleeding, infection, nerve injury, allergic reaction and failure to obtain relief, the benefits of diagnostic clarification, and the alternatives of continued conservative care or no procedure were discussed. Questions were answered and the patient elected to proceed.

SITE MARKING: The right side and the intended levels were marked and verified with the patient prior to positioning.

TIME-OUT: An itemized time-out was performed and documented before any needle insertion. Patient identity was confirmed by two identifiers, name and date of birth. The correct site, correct side and correct level were confirmed. The correct procedure was confirmed. Position was confirmed. Allergies were confirmed. Consent was verified. Imaging was displayed and verified.

TECHNIQUE: The patient was placed prone on the fluoroscopy table. The overlying skin of the right lumbar region was prepped with chlorhexidine and draped in the usual sterile fashion. The skin was anesthetized with 1 mL of 1% lidocaine at each entry point. Under fluoroscopic guidance with AP and oblique views, a 22-gauge, 3.5-inch spinal needle was advanced coaxially down to the junction of the superior articular process and transverse process at the right L3 medial branch. Negative aspiration for blood and cerebrospinal fluid was confirmed at each level. Contrast was injected: 0.3 mL of iohexol demonstrated appropriate periosteal spread with no vascular, intrathecal, subdural or intraneural uptake. The needle was then repositioned to the right L4 medial branch and to the right L5 dorsal ramus at the sacral ala, with the same confirmation performed at each target. Total fluoroscopy time was 42 seconds. Permanent images were retained in PACS.

MEDICATIONS: At each of the three targets, 0.5 mL of 0.5% bupivacaine was injected, delivering 2.5 mg per target, for a session total of 1.5 mL and 7.5 mg of bupivacaine. No corticosteroid was administered.

FINDINGS: Periosteal contrast spread was appropriate at all three targets. There was no vascular uptake at any level.

The needles were removed intact. Hemostasis was obtained with manual pressure and an adhesive dressing was applied.

ESTIMATED BLOOD LOSS: Minimal.

COMPLICATIONS: None.

DISPOSITION: The patient tolerated the procedure well and remained hemodynamically stable. She was observed for 20 minutes in recovery. Post-procedure pain 2/10 at 20 minutes. She ambulated without difficulty and was discharged in stable condition.

INSTRUCTIONS: The patient was instructed to keep a pain diary over the next 8 hours and to record the percent relief obtained during that window. She was instructed to call the office for fever, worsening weakness, new numbness, or severe headache, and to return to clinic in 2 weeks for review of the diary.

Matthew Schaeffer, M.D.
08/28/2026 11:15 AM
Draft - unsigned, pending physician review.`;

const EX_HPI = `HPI

Ms. Doe returns for follow-up of chronic axial low back pain, present now for 14 months and therefore beyond the three-month threshold for chronicity. Onset was insidious and atraumatic; she recalls no injury, no motor vehicle accident, and she remains employed full time in an administrative role.

The pain is located across the right lower lumbar region, described by her as a deep, dull ache that becomes sharp with extension and rotation. She denies radiation below the knee and denies any numbness or tingling into either foot. Severity averages 6/10, with a worst of 9/10 after prolonged standing and a best of 3/10 in the morning. Symptoms are worse in the late afternoon and worse with extension, twisting, and prolonged standing; sitting and lying supine relieve them.

Since her last visit the trajectory has been unchanged. She underwent a right-sided lumbar medial branch block on 06/03/2026 which gave approximately 80% relief of her back pain lasting three weeks before the pain returned to baseline. She reports no adverse effect from that block.

Red-flag screening is negative: she denies bowel or bladder incontinence, denies urinary retention, and denies saddle or perineal numbness. She denies fever, unintentional weight loss, and has no history of malignancy.

Prior workup: MRI of 05/12/2026 was reported as showing facet arthropathy at the right L4-L5 and right L5-S1 levels without central canal stenosis. Prior treatments have included physical therapy for 10 weeks, which produced no lasting relief, and meloxicam for 12 weeks, which was of insufficient benefit. Current medications include meloxicam 15 mg daily; she takes no controlled substances.

Functionally, her walking tolerance is limited to approximately one block before she must stop, and she is unable to complete her usual grocery shopping without resting. Her stated goal is to return to walking for exercise without stopping.`;

const EX_AP = `ASSESSMENT

1. Right-sided lumbar facet arthropathy, right L4-L5 and right L5-S1, chronic and unchanged since the last visit. Exam demonstrates right paravertebral tenderness with reproduction on facet loading and no radicular findings, concordant with the MRI of 05/12/2026. The diagnostic medial branch block of 06/03/2026 produced 80% relief lasting three weeks, concordant and obtained during the local anesthetic phase. Baseline pain 6/10; walking tolerance limited to one block.

2. Chronic pain with functional limitation, stable. No controlled substances are prescribed and none are requested.

PLAN

1. Right-sided lumbar facet arthropathy.
   - Proceed with a second confirmatory diagnostic right L3 and L4 medial branch block under fluoroscopic guidance, targeting the right L4-L5 and right L5-S1 facet joints, as the second of two diagnostic blocks. Local anesthetic only.
   - The risks, benefits and alternatives were discussed and the patient wishes to proceed.
   - Continue meloxicam 15 mg by mouth daily with food for pain, quantity 30, one refill.
   - Continue the home exercise program.

2. Chronic pain with functional limitation.
   - No change to the current regimen.

MEDICAL DECISION MAKING: Two problems addressed, one chronic with exacerbation risk and one stable. Data reviewed and analyzed included my own independent interpretation of the lumbar MRI of 05/12/2026. Risk of patient management is moderate given the planned interventional procedure.

FOLLOW-UP: Return to clinic in 3 weeks for review of the diagnostic block diary.

RETURN PRECAUTIONS: The patient was instructed to call the office or seek care for fever, new or worsening weakness, new numbness, or any change in bowel or bladder control.

Matthew Schaeffer, M.D.
08/28/2026 11:40 AM`;

const EX_PE = `REVIEW OF SYSTEMS

Constitutional: Denies fever, chills, night sweats, or unintentional weight loss.
Musculoskeletal: Reports right-sided low back pain with extension. Denies joint swelling.
Neurologic: Denies bowel or bladder incontinence, denies urinary retention, and denies saddle or perineal numbness. Denies lower extremity weakness.
All other systems reviewed and negative.

PHYSICAL EXAMINATION

General: Alert, in no acute distress. Pain score today 6/10 on the numeric rating scale.
Vital signs: BP 128/78, HR 72, afebrile.
Gait and station: Gait is antalgic on the right without assistive device. Station is normal.
Inspection: Lumbar region without erythema, rash or breakdown. Skin is intact.
Palpation: Tenderness to palpation over the right L4-L5 and right L5-S1 paravertebral facet region. No midline spinous tenderness.
Range of motion: Lumbar extension limited to 15 degrees and reproduces her concordant right-sided pain. Flexion is full.
Provocative testing: Facet loading with extension and rotation is positive on the right and reproduces her typical pain. Straight leg raise is negative bilaterally. FABER is negative on the right.
Strength: 5/5 throughout the bilateral lower extremities on screening examination.
Reflexes: Patellar and Achilles reflexes are 2+ and symmetric.
Sensation: Grossly intact to light touch in the L3 through S1 dermatomes bilaterally.
Radicular findings: There are no radicular findings on examination today.

The examination findings support the planned right-sided lumbar medial branch target.`;

const EX_SOAP = `SUBJECTIVE

Date and time of service: 08/28/2026, 11:05 AM. In-person visit. Established patient, interval follow-up.
Chief complaint: Right-sided chronic axial low back pain.
Allergies: No known drug allergies.

Since the last visit on 08/11/2026 there have been no falls, no injuries, no emergency department visits and no new prescribers. Pain today 6/10, improved from 7/10 at the 08/11/2026 visit. The right-sided medial branch block of 06/03/2026 gave 80% relief lasting three weeks, and the relief occurred during the local anesthetic phase and was concordant. Walking tolerance is limited to approximately one block, unchanged. Current medications were reviewed and the medication list was reconciled today; she takes meloxicam 15 mg daily and no controlled substances.

OBJECTIVE

Vital signs: BP 128/78, HR 72, afebrile.
The lumbar examination was re-performed today. Tenderness to palpation over the right L4-L5 paravertebral region. Lumbar extension limited to 15 degrees, reproducing concordant right-sided pain. Straight leg raise negative bilaterally. Strength 5/5 throughout the bilateral lower extremities. Reflexes 2+ and symmetric. Sensation grossly intact to light touch by dermatome. Gait antalgic on the right.
Data reviewed this visit: I personally reviewed the lumbar MRI of 05/12/2026 and performed my own independent interpretation.

ASSESSMENT

1. Right-sided lumbar facet arthropathy, right L4-L5 and right L5-S1, chronic and stable.
Medical decision making: one chronic problem addressed with an interventional plan, data reviewed included independent interpretation of the MRI, and risk of patient management is moderate.

PLAN

1. Right-sided lumbar facet arthropathy.
   - Schedule the second confirmatory diagnostic right L3 and L4 medial branch block under fluoroscopic guidance, targeting the right L4-L5 facet joint. Local anesthetic only.
   - The risks, benefits and alternatives were discussed and the patient wishes to proceed.
   - Continue meloxicam 15 mg by mouth daily with food, quantity 30, one refill, for pain.
Follow-up: Return to clinic in 3 weeks for review of the pain diary.
Return precautions: The patient was instructed to call the office or seek care for fever, new or worsening weakness, new numbness, or any change in bowel or bladder control.

Matthew Schaeffer, M.D.
08/28/2026 11:40 AM`;

const EXEMPLARS = [
  ['op note', EX_OP],
  ['hpi', EX_HPI],
  ['assessment', EX_AP],
  ['exam', EX_PE],
  ['soap', EX_SOAP]
];

EXEMPLARS.forEach(([type, text]) => {
  const r = Q.grade(text, type, {});
  const named = r.missing.map((m) => `${m.severity}:${m.id}`).join(', ');
  const forb = r.forbidden.map((f) => `${f.id}("${f.excerpt}")`).join(', ');
  eq(r.counts.blockFailures, 0,
    `professional ${r.noteType} exemplar has block failures [${named}] forbidden[${forb}]`);
  ok(r.score >= r.floor,
    `professional ${r.noteType} exemplar scored ${r.score} under its floor ${r.floor} [${named}]`);
  ok(r.pass === true,
    `professional ${r.noteType} exemplar did not pass (score ${r.score}/${r.floor}) [${named}]`);
  ok(r.forbidden.length === 0,
    `professional ${r.noteType} exemplar tripped a forbidden pattern: ${forb}`);
});

/* ---------------------------------------------------------------------------
 * 2. BOILERPLATE / INCOMPLETE NOTES - must FAIL, and must NAME what is missing.
 * ------------------------------------------------------------------------- */

const BAD_OP = `Here is the operative note based on the transcript provided.

Procedure: injection
The patient tolerated the procedure well. Details as described above.
Findings: [INSERT FINDINGS]
Medications given: bupivacaine 1.0 mL and 10 U of steroid.
Signed.`;

const rBadOp = Q.grade(BAD_OP, 'op note', {});
ok(rBadOp.pass === false, 'a boilerplate op note passed the floor');
ok(rBadOp.counts.blockFailures > 0, 'a boilerplate op note recorded no block failures');
ok(rBadOp.score < rBadOp.floor, 'a boilerplate op note scored at or above floor');

function hasMissing(res, id) { return res.missing.some((m) => m.id === id); }
function hasForbidden(res, id) { return res.forbidden.some((f) => f.id === id); }

/* it must name the SPECIFIC elements, not just fail */
[
  'op.dx',
  'op.indication',
  'timeout-itemized-and-positioned',
  'consent-before-sedation',
  'ebl-present',
  'post-procedure-instructions',
  'allergy-and-antithrombotic-status',
  'signature-authentication'
].forEach((id) => {
  ok(hasMissing(rBadOp, id), `the boilerplate op note did not name the missing element "${id}"`);
});

/* every missing entry carries a human label and a repair instruction */
ok(rBadOp.missing.every((m) => m.label && m.label.length > 10),
  'a missing entry has no human-readable label');
ok(rBadOp.missing.filter((m) => m.severity === 'block').every((m) => m.why && m.why.length > 10),
  'a block-tier missing entry has no repair instruction');

/* ---------------------------------------------------------------------------
 * 3. FORBIDDEN PATTERNS - dangerous abbreviations, trailing zero, AI voice,
 *    transcript leakage, placeholders, stigmatizing language.
 * ------------------------------------------------------------------------- */
ok(hasForbidden(rBadOp, 'placeholder-leak'), 'the [INSERT FINDINGS] placeholder was not detected');
ok(hasForbidden(rBadOp, 'instructional-meta-leak'), '"details as described above" was not detected');
ok(hasForbidden(rBadOp, 'no-ai-self-reference-or-meta'), '"based on the transcript provided" was not detected');
ok(hasForbidden(rBadOp, 'do-not-use-trailing-zero'), 'the trailing-zero dose "1.0 mL" was not detected');
ok(hasForbidden(rBadOp, 'do-not-use-abbreviations'), 'the dangerous abbreviation "10 U" was not detected');

const DANGER = Q.grade(
  'Give 10 U of insulin, 5 IU daily, take QD, alternate QOD, and MSO4 as needed. Dose 2.0 mg and .5 mL.',
  'soap', {});
['do-not-use-abbreviations', 'do-not-use-trailing-zero', 'do-not-use-naked-decimal'].forEach((id) => {
  ok(hasForbidden(DANGER, id), `the forbidden pattern "${id}" was not detected`);
});
const dangerHits = DANGER.forbidden.filter((f) => f.id === 'do-not-use-abbreviations').map((f) => f.excerpt).join('|');
['U', 'IU', 'QD', 'QOD', 'MSO4'].forEach((tok) => {
  ok(new RegExp(tok).test(dangerHits), `the Do Not Use token "${tok}" was not reported in the excerpts (${dangerHits})`);
});

const LEAK = Q.grade(
  'Doctor: how are you today?\nPatient: my back hurts [inaudible] at [10:32].\nThe patient is a drug-seeking addict with dirty urine.',
  'hpi', {});
ok(hasForbidden(LEAK, 'transcript-artifact-leak'), 'speaker labels / ASR artifacts were not detected');
ok(hasForbidden(LEAK, 'stigmatizing-language'), 'stigmatizing language was not detected');

const RETIRED = Q.grade('More than 50% of the visit was spent in counseling and coordination of care.', 'soap', {});
ok(hasForbidden(RETIRED, 'retired-counseling-construct'), 'the retired >50% counseling construct was not detected');

/* an exemplar must NOT trip the placeholder rule on legitimate charting */
const NA_OK = Q.grade('SPECIMENS: N/A\nCOMPLICATIONS: None.\nGlucose was [mg/dL] normal.', 'op note', {});
ok(!NA_OK.forbidden.some((f) => f.id === 'placeholder-leak' && /N\/A/i.test(f.excerpt)),
  'a bare N/A was wrongly flagged as a placeholder');
ok(!NA_OK.forbidden.some((f) => f.id === 'placeholder-leak' && /mg\/dL/i.test(f.excerpt)),
  'the unit notation [mg/dL] was wrongly flagged as a placeholder');

/* ---------------------------------------------------------------------------
 * 4. TEMPLATE GAPS - a missing / renamed / reordered / added section is caught,
 *    and an altered negation in fixed boilerplate is caught.
 * ------------------------------------------------------------------------- */
const TPL = `PROCEDURE PERFORMED:
INDICATION:
TECHNIQUE:
COMPLICATIONS:
DISPOSITION:
The patient was advised that no driving is permitted for the remainder of the day.`;

const NOTE_GAPPY = `PROCEDURE PERFORMED: Right L4 medial branch block.
INDICATION: Chronic facet pain.
TECHNIQUE: Needle advanced under fluoroscopy.
BILLING NOTES: 64493.
The patient was advised that driving is permitted for the remainder of the day.`;

const rTpl = Q.grade(NOTE_GAPPY, 'op note', { template: TPL, templateName: 'MBB template' });
const gapKinds = rTpl.templateGaps.map((g) => `${g.kind}:${g.heading}`).join(', ');
ok(rTpl.templateGaps.some((g) => g.kind === 'missing' && /COMPLICATIONS/i.test(g.heading)),
  `the missing COMPLICATIONS section was not reported (${gapKinds})`);
ok(rTpl.templateGaps.some((g) => g.kind === 'missing' && /DISPOSITION/i.test(g.heading)),
  `the missing DISPOSITION section was not reported (${gapKinds})`);
ok(rTpl.templateGaps.some((g) => g.kind === 'extra' && /BILLING NOTES/i.test(g.heading)),
  `the added BILLING NOTES section was not reported (${gapKinds})`);
ok(rTpl.templateGaps.some((g) => g.kind === 'boilerplate-altered'),
  `the dropped "no" in the fixed driving sentence was not reported (${gapKinds})`);
ok(hasMissing(rTpl, 'template-headers-present-and-ordered'),
  'the template-headers rule did not fail on a note with missing sections');
ok(hasMissing(rTpl, 'boilerplate-negation-intact'),
  'the boilerplate-negation rule did not fail on an altered negation');
ok(rTpl.pass === false, 'a note with template gaps passed the floor');

/* with no template supplied, template rules SKIP rather than fabricate a gap */
const rNoTpl = Q.grade(NOTE_GAPPY, 'op note', {});
eq(rNoTpl.templateGaps.length, 0, 'template gaps were reported with no template in use');
ok(rNoTpl.skipped.indexOf('template-headers-present-and-ordered') >= 0,
  'the template-headers rule did not SKIP when no template was supplied');

/* an exemplar rendered against its own template has zero gaps */
const TPL_MATCHED = `SUBJECTIVE
OBJECTIVE
ASSESSMENT
PLAN`;
const rMatched = Q.grade(EX_SOAP, 'soap', { template: TPL_MATCHED });
ok(!rMatched.templateGaps.some((g) => g.kind === 'missing'),
  'a note that reproduces its template reported a missing section: ' +
  rMatched.templateGaps.map((g) => g.kind + ':' + g.heading).join(', '));

/* ---------------------------------------------------------------------------
 * 5. CONDITIONAL ELEMENTS fire only for the applicable procedure class.
 * ------------------------------------------------------------------------- */
const CERV_TF = Q.grade(
  'PROCEDURE PERFORMED: Right C6-C7 transforaminal epidural steroid injection under fluoroscopy. ' +
  'MEDICATIONS: 1 mL of triamcinolone 40 mg/mL was injected.', 'op note', {});
ok(hasMissing(CERV_TF, 'cervical-transforaminal-particulate-ban'),
  'particulate steroid at a cervical transforaminal level was not blocked');

const LUMBAR_IA = Q.grade(EX_OP, 'op note', {});
ok(LUMBAR_IA.skipped.indexOf('cervical-transforaminal-particulate-ban') >= 0,
  'the cervical-transforaminal rule fired on a lumbar medial branch block');
ok(LUMBAR_IA.skipped.indexOf('rfa-parameters-and-predicate') >= 0,
  'the radiofrequency parameter rule fired on a note with no ablation');
eq(LUMBAR_IA.counts.procedureClass, 'MBB', 'the procedure class was misdetected for the exemplar');

const DIAG_WITH_STEROID = Q.grade(
  'PROCEDURE PERFORMED: Right L4 diagnostic medial branch block. ' +
  'MEDICATIONS: 0.5 mL of 0.5% bupivacaine with dexamethasone 4 mg.', 'op note', {});
ok(hasMissing(DIAG_WITH_STEROID, 'diagnostic-block-purity'),
  'a corticosteroid in a diagnostic block was not blocked');

/* laterality conflict is a wrong-site finding */
const SIDE_CLASH = Q.grade(
  'PROCEDURE PERFORMED: Right knee injection. TECHNIQUE: The left knee was prepped and injected.',
  'op note', {});
ok(hasMissing(SIDE_CLASH, 'laterality-conflict'),
  'two different sides for one structure were not detected');

/* dose arithmetic catches a wrong computed dose */
const BAD_MATH = Q.grade(
  'MEDICATIONS: 2 mL of 0.5% bupivacaine was injected, delivering 25 mg.', 'op note', {});
ok(hasMissing(BAD_MATH, 'dose-arithmetic'),
  'a dose inconsistent with its volume and concentration was not detected (2 mL of 0.5% is 10 mg, not 25 mg)');
const GOOD_MATH = Q.grade(
  'MEDICATIONS: 2 mL of 0.5% bupivacaine was injected, delivering 10 mg.', 'op note', {});
ok(!hasMissing(GOOD_MATH, 'dose-arithmetic'),
  'a correct dose computation was wrongly flagged');

/* ---------------------------------------------------------------------------
 * 6. CONTRACT TEXT - the contract carries the law, and grows the findings on
 *    the regeneration pass.
 * ------------------------------------------------------------------------- */
Q.noteTypes.forEach((t) => {
  const c = Q.contractFor(t, {});
  ok(typeof c === 'string' && c.length > 500, `contractFor(${t}) returned no usable contract`);
  ok(/TEMPLATE/i.test(c), `contractFor(${t}) does not mention the template`);
  ok(/PRECEDENCE/i.test(c), `contractFor(${t}) does not carry the precedence clause`);
  ok(/never authority to invent a clinical fact|never authority/i.test(c),
    `contractFor(${t}) does not state that a rule is never authority to invent a fact`);
  ok(/not documented|not-addressed/i.test(c),
    `contractFor(${t}) does not tell the model what to write when a value is absent`);
});

/* the template clause names the actual template sections when one is bound */
const cTpl = Q.contractFor('op note', { template: TPL, templateName: 'MBB template' });
ok(/COMPLICATIONS/.test(cTpl), 'the contract does not enumerate the bound template sections');
ok(/MBB template/.test(cTpl), 'the contract does not name the bound template');
ok(/not applicable|not-addressed/i.test(cTpl),
  'the contract does not require an empty field to be marked rather than dropped');

/* the repair contract quotes the findings verbatim and bounds the pass to one */
const cRepair = Q.contractFor('op note', { findings: rBadOp });
ok(/REGENERATION PASS 1 of 1/.test(cRepair), 'the repair contract does not bound the pass to one');
ok(/ebl-present/.test(cRepair), 'the repair contract does not quote the findings verbatim');
ok(/placeholder-leak/.test(cRepair), 'the repair contract does not quote the forbidden findings');
ok(/never a plausible number/i.test(cRepair),
  'the repair contract does not forbid inventing a value to pass a check');

/* ---------------------------------------------------------------------------
 * 7. LEDGER
 * ------------------------------------------------------------------------- */
const row = Q.ledger.record({ noteType: 'op note', score: 95, pass: true, regenerated: false });
eq(row.noteType, 'operative-procedure-note', 'the ledger did not normalize the note type');
ok(typeof row.ts === 'number' && row.ts > 0, 'the ledger row carries no timestamp');
eq(row.pass, true, 'the ledger did not record the pass flag');
eq(row.regenerated, false, 'the ledger did not record the regenerated flag');
const st = Q.ledger.stats();
ok(st && typeof st.total === 'number', 'ledger.stats() returned no total');
ok(st.byType && typeof st.byType === 'object', 'ledger.stats() returned no per-type breakdown');

/* ---------------------------------------------------------------------------
 * 8. THE CONTRACT ACTUALLY REACHES THE MODEL - pinned in the DERIVED,
 *    shipping bytes at every generation site, and the loop is bounded at one.
 * ------------------------------------------------------------------------- */
const SHIP = read('ScribeFlow.html');
ok(SHIP.length > 100000, 'ScribeFlow.html (derived) was not readable - run derive-production-from-1p.js');

const SITES = [
  ['primary visit note', /__mlsNoteQualityContract\('visit-note-soap'/],
  ['op note', /__mlsNoteQualityContract\('operative-procedure-note'/],
  ['template reformat', /__mlsNoteQualityContract\('template-fidelity'/],
  /* Re-aimed deliberately (noteq-1.0.0, b1169): the AVS site builds its
     context as a named const (noteqAvsCtx) rather than an inline object
     literal, so the original literal-shaped pin could never match. The pin
     that matters is that the contract is BUILT for this site and that the
     built string is what reaches aiCallRaw - both are asserted below. */
  ['after-visit summary', /const noteqAvs\s*=\s*__mlsNoteQualityContract\('visit-note-soap'/]
];
SITES.forEach(([name, re]) => {
  ok(re.test(SHIP), `the quality contract is not appended at the ${name} generation site`);
});

/* the built contract must actually reach the transport at every site, not
   merely be constructed and dropped */
[
  ['primary visit note', /\+tplBlock\+noteqBlock/],
  ['op note', /aiCallRaw\(sys\+noteqOp,/],
  ['template reformat', /aiCallRaw\(sys\+noteqTpl,/],
  ['after-visit summary', /aiCallRaw\(sys\+noteqAvs,/]
].forEach(([name, re]) => {
  ok(re.test(SHIP), `the ${name} site builds a quality contract but never sends it to the model`);
});

/* the grader is called back on the produced text at each site */
ok(/__mlsNoteQualityGrade\(/.test(SHIP), 'the shipped app never grades a generated note');
const gradeCalls = (SHIP.match(/__mlsNoteQualityGrade\(/g) || []).length;
ok(gradeCalls >= 4, `the shipped app grades at only ${gradeCalls} sites; 4 generation sites were wired`);

/* EXACTLY ONE regeneration: the bound is a constant and no site loops */
ok(/noteq-1\.0\.0[^\n]*exactly one|NOTEQ_MAX_REGEN\s*=\s*1/.test(SHIP),
  'the single-regeneration bound is not pinned in the shipped app');
const regenConst = SHIP.match(/NOTEQ_MAX_REGEN\s*=\s*(\d+)/);
ok(regenConst && regenConst[1] === '1',
  `the regeneration bound in the shipped app is ${regenConst ? regenConst[1] : 'absent'}, not 1`);
ok(!/while\s*\([^)]*__mlsNoteQualityGrade/.test(SHIP),
  'a while-loop wraps the quality regeneration - the bound must be exactly one');

/* THE OP NOTE THAT ACTUALLY RUNS.
   feat_mls_opnote_integrity.js replaces window._genOpNote outright and builds
   its own prompt, so wiring only ScribeFlow's inline generator would have
   delivered the contract to the FALLBACK. The chokepoint wrapper is what makes
   the contract reach the note the doctor actually gets - pin it, and pin that
   it stays idempotent and explicitly classified rather than append-to-all. */
const CONNECT = read('mls-connect.js');
ok(CONNECT.length > 100000, 'mls-connect.js (derived) was not readable');
ok(/__mlsNoteQualityReach/.test(CONNECT),
  'the aiCallRaw chokepoint wrapper is missing, so the op-note contract never reaches feat_mls_opnote_integrity.js');
ok(/w\.__mlsNoteQualityWrapped\s*=\s*true;/.test(CONNECT),
  'the chokepoint wrapper does not mark itself, so a second install would double-append');
ok(!/w\.__mlsWrapped\s*=\s*true;[\s\S]{0,200}__mlsNoteQualityReach/.test(CONNECT),
  'the chokepoint wrapper sets __mlsWrapped and would silently delete the op-note quality directive');
ok(/if\(sys\.indexOf\(STAMP\)>=0\) return false;/.test(CONNECT),
  'the chokepoint wrapper is not idempotent - a stamped prompt must be left alone');
ok(/var INGEST=/.test(CONNECT),
  'the chokepoint wrapper does not exclude ingestion prompts');
ok(/arguments\[0\]=augment\(a0\)/.test(CONNECT),
  'the chokepoint wrapper touches an argument other than the system prompt');

/* the module ships and is registered as a deferred asset */
ok(/feat_mls_note_quality\.js/.test(CONNECT),
  'feat_mls_note_quality.js is not registered as a deferred module in the derived connect file');
ok(fs.existsSync(path.join(ROOT, 'feat_mls_note_quality.js')),
  'feat_mls_note_quality.js does not exist at the repo root');

/* a new published file must be listed in the publication inventory */
const INV = read('pages-publication-inventory.json');
ok(/"feat_mls_note_quality\.js"/.test(INV),
  'feat_mls_note_quality.js is not listed in pages-publication-inventory.json');

/* the floor is never read from settings anywhere in the shipped module */
const MOD = read('feat_mls_note_quality.js');
const floorFn = (MOD.match(/function floor\(noteType\)[\s\S]{0,300}?\n  \}/) || [''])[0];
ok(floorFn.length > 20, 'the floor() function could not be located in the module');
ok(!/(localStorage|getItem|settings|fetch)/i.test(floorFn),
  'floor() reads from settings or storage - the floor must be a constant');
ok(/var FLOORS = \{\};/.test(MOD), 'the FLOORS constant table is missing from the module');

/* ---------------------------------------------------------------------------
 * REPORT
 * ------------------------------------------------------------------------- */
if (failures.length) {
  console.error(`FAIL note-quality: ${failures.length} of ${checks} checks failed`);
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log(`PASS note-quality: ${checks} checks`);
