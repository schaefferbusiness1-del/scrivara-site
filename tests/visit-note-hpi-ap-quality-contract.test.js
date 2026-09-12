'use strict';

/*
 * Synthetic, provider-free proof for the general visit-note quality contract.
 * The model is intentionally not called here: these fixtures exercise the
 * shipped output boundary and pin the instructions that reach it.  That makes
 * the important safety behavior deterministic: terse dictation can be
 * organized, while facts the dictation did not contain stay out of the note.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const quality = require(path.join(root, 'feat_mls_note_quality.js'));
let checks = 0;
function ok(value, message) { checks++; assert.ok(value, message); }
function absent(text, value, message) { ok(!text.includes(value), message); }

function athenaValidator() {
  const source = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
  const start = source.indexOf('function _mlsAthenaNoteQualityError(');
  const end = source.indexOf('function _mlsAthenaSourceState(', start);
  ok(start >= 0 && end > start, 'could not isolate the general visit-note output validator');
  const sandbox = { stripSignatureBlock: value => String(value || ''), _autoDraftStripCarried: value => String(value || '') };
  vm.runInNewContext(source.slice(start, end) + '\nthis.validate=_mlsValidateAthenaNote;', sandbox,
    { filename: '1pScribeFlow.html#visit-note-validator' });
  return sandbox.validate;
}

const validate = athenaValidator();
const hpiContract = quality.contractFor('hpi', {});
const apContract = quality.contractFor('assessment', {});
const soapContract = quality.contractFor('soap', {});

[
  [hpiContract, 'natural chronological narrative', 'HPI contract lost chronological prose instruction'],
  [hpiContract, 'day-3, day-7', 'HPI contract lost conditional procedure-interval instruction'],
  [hpiContract, 'MILD follow-up', 'HPI contract lost MILD routing'],
  [hpiContract, 'medial branch block follow-up', 'HPI contract lost MBB routing'],
  [hpiContract, 'epidural steroid injection follow-up', 'HPI contract lost ESI routing'],
  [apContract, 'concise dictated facts', 'A&P contract no longer expands terse clinician dictation'],
  [apContract, 'accepted and declined options distinct', 'A&P contract no longer preserves decision polarity'],
  [soapContract, 'VISIT METADATA.', 'general visit contract lost encounter metadata requirement'],
  [soapContract, 'allergies including documented NKDA', 'general visit contract lost allergy requirement'],
  [soapContract, 'OBJECTIVE.', 'general visit contract lost focused objective requirement'],
  [soapContract, 'independently interpreted or only reported', 'general visit contract lost imaging-review distinction'],
  [soapContract, 'actual PDMP finding', 'general visit contract lost PDMP-finding requirement'],
  [soapContract, 'UDS date and interpretation', 'general visit contract lost UDS-interpretation requirement'],
  [soapContract, 'total daily MME', 'general visit contract lost MME requirement'],
  [soapContract, 'anticoagulant or antiplatelet management', 'general visit contract lost anticoagulant coordination requirement'],
  [soapContract, 'target laterality, level or joint', 'general visit contract lost procedure target requirement'],
  [soapContract, 'image guidance', 'general visit contract lost procedure image-guidance requirement'],
  [soapContract, 'follow-up interval/event anchor', 'general visit contract lost follow-up requirement'],
  [soapContract, 'plan-specific return precautions', 'general visit contract lost return-precaution requirement'],
  [soapContract, 'signature credentials', 'general visit contract lost signature/attestation requirement'],
  [soapContract, 'Never invent symptoms, percentages, dates', 'general visit contract lost grounding guard'],
  [soapContract, 'minimum necessary information', 'general visit contract lost concise-meaningful guard']
].forEach(([text, needle, message]) => ok(text.includes(needle), message));

/* A terse dictated MILD follow-up becomes a readable five-field note, but
   does not grow an invented percentage, date, red-flag denial, medication,
   imaging, or acceptance of PT. */
const mild = [
  'HPI:',
  'The patient returns for reevaluation after MILD. Walking and standing are easier, and the patient is open to physical therapy.',
  'ROS:', "Not documented in today's transcript.",
  'EXAM:', "Not documented in today's transcript.",
  'ASSESSMENT:',
  '1. Lumbar spinal stenosis status post MILD, with documented improvement in walking and standing tolerance.',
  'PLAN:',
  '1. Physical therapy openness was discussed; no acceptance, order, or interval was dictated.'
].join('\n');
const mildResult = validate(mild);
ok(mildResult.sections.map(section => section.key).join(',') === 'hpi,ros,exam,assessment,plan',
  'organized concise MILD output did not reach the exact general visit-note destinations');
['80%', 'three days', 'denies bowel', 'MRI', 'gabapentin', 'will start physical therapy'].forEach(value =>
  absent(mild, value, 'MILD fixture invented unsupported fact: ' + value));
const mildGrade = quality.grade(mild, 'soap', {});
['pain-severity-quantified', 'procedure-relief-percent-and-duration', 'functional-impact-present', 'conservative-care-quantified'].forEach(id =>
  ok(!mildGrade.missing.some(item => item.id === id),
    'general SOAP validation still pressures sparse dictation to invent ' + id));

/* Procedure-specific facts remain in the HPI lane rather than leaking into
   generic plan/exam language or becoming facts for another procedure family. */
const routes = [
  {
    kind: 'MILD',
    hpi: 'Reevaluation after MILD: walking, standing, and mobility are improved; the patient is open to PT.',
    must: ['walking', 'standing', 'mobility', 'PT'],
    mustNot: ['pain diary', 'new radicular symptoms', 'targeted radicular improvement']
  },
  {
    kind: 'medial branch block',
    hpi: 'Reevaluation after medial branch block #1: the pain diary showed initial relief that is now waning; symptoms remain axial without new radicular symptoms.',
    must: ['pain diary', 'waning', 'block #1', 'axial', 'new radicular symptoms'],
    mustNot: ['walking and standing are easier', 'targeted radicular improvement']
  },
  {
    kind: 'epidural steroid injection',
    hpi: 'Reevaluation after epidural steroid injection: left leg radicular pain is improved.',
    must: ['epidural steroid injection', 'radicular pain is improved'],
    mustNot: ['denies bowel', 'pain diary', 'block #']
  }
];
routes.forEach(route => {
  route.must.forEach(value => ok(route.hpi.includes(value), route.kind + ' HPI lost routed fact: ' + value));
  route.mustNot.forEach(value => absent(route.hpi, value, route.kind + ' HPI leaked another procedure family fact: ' + value));
  const note = ['HPI:', route.hpi, 'ROS:', "Not documented in today's transcript.", 'EXAM:', "Not documented in today's transcript.",
    'ASSESSMENT:', '1. Follow-up problem documented above.', 'PLAN:', "Not documented in today's transcript."].join('\n');
  ok(validate(note).sections[0].text === route.hpi, route.kind + ' HPI was not preserved by the output validator');
});

console.log('PASS visit-note HPI/A&P quality contract: ' + checks +
  ' checks — concise source-grounded dictation remains valid, missing facts stay absent, and MILD/MBB/ESI follow-up facts stay routed to HPI');
