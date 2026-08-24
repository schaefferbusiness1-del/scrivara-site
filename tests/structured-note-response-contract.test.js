'use strict';

/*
 * The structured note response is the last boundary before the browser can
 * replace the clinician's current draft.  This test executes the shipped
 * validator from every release/staging shell and checks that malformed model
 * output is rejected before the currentSoap assignment.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = [
  '1pScribeFlow.html',
  '1p/index.html',
  'ScribeFlow.html',
  'cloned/index.html',
  'ScribeFlow-staging.html'
];

let checks = 0;
function ok(value, message) { assert.ok(value, message); checks++; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks++; }

function read(name) { return fs.readFileSync(path.join(ROOT, name), 'utf8'); }

function contractBlock(source, name) {
  const start = source.indexOf('function _mlsStructuredNoteQualityError(');
  /* The dual-note work adds a second, stricter Athena payload contract between
     the style-neutral validator and generateNote. Keep this test focused on
     the original display-note boundary; the dual-note suite verifies its own
     canonical block separately. Older shells do not have that marker. */
  const canonical = source.indexOf('\n\n/* =========================================================\n   CANONICAL ATHENA NOTE CONTRACT', start);
  const end = canonical > start ? canonical : source.indexOf('\n\n/* =========================================================\n   GENERATE NOTE', start);
  ok(start >= 0 && end > start, name + ' has no structured-note contract block');
  return source.slice(start, end);
}

function loadValidator(source, name) {
  const sandbox = {};
  vm.runInNewContext(
    contractBlock(source, name) +
      '\nthis.__mlsStructuredNoteContract={validate:_mlsValidateStructuredNoteResult,quality:_mlsStructuredNoteQualityError};',
    sandbox,
    { filename: name }
  );
  return sandbox.__mlsStructuredNoteContract;
}

function expectQualityFailure(validate, value, label) {
  let error = null;
  try { validate(value); } catch (e) { error = e; }
  ok(error, label + ' was accepted');
  eq(error.mlsStructuredNoteQuality, true, label + ' did not carry the quality-failure marker');
  eq(error.mlsAi && error.mlsAi.code, 'draft_quality_failed', label + ' did not carry the retryable quality code');
  eq(error.mlsAi && error.mlsAi.retryable, true, label + ' was not marked retryable');
}

const sources = SHELLS.map(name => [name, read(name)]);
const firstContract = contractBlock(sources[0][1], sources[0][0]);

for (const [name, source] of sources) {
  const validator = loadValidator(source, name);
  const generation = source.indexOf('async function generateNote()');
  const generate = generation >= 0 ? generation : source.indexOf('function generateNote()');
  const validation = source.indexOf('_mlsValidateStructuredNoteResult(result);', generate);
  const mutation = source.indexOf('currentSoap=_reorderNoteForStyle(result.note', generate);
  ok(generate >= 0, name + ' has no generateNote sink');
  ok(validation > generate, name + ' does not validate the structured result inside generateNote');
  ok(mutation > validation, name + ' can mutate currentSoap before validating result.note');
  ok(source.indexOf('if(err&&err.mlsStructuredNoteQuality)') > source.indexOf('function friendlyError'),
    name + ' has no clear retryable quality-failure message');
  eq(contractBlock(source, name), firstContract, name + ' drifted from the canonical response contract');

  const goodSoap = {
    note: 'SUBJECTIVE:\nHPI: cough for three days.\nOBJECTIVE:\nExam: lungs clear.\nASSESSMENT:\nAcute cough.\nPLAN:\nSupportive care and follow-up.'
  };
  eq(validator.validate(goodSoap), goodSoap, name + ' rejected a valid SOAP response');
  eq(validator.validate({
    note: 'ASSESSMENT: stable condition. PLAN: continue current care. SUBJECTIVE: no new concern.'
  }).note.indexOf('ASSESSMENT:'), 0, name + ' rejected a valid APSO-style response');
  eq(validator.validate({
    note: 'HPI describes improving pain. Exam is reassuring. Assessment is benign. Plan is routine follow-up.'
  }).note.indexOf('HPI'), 0, name + ' rejected a valid narrative response');

  expectQualityFailure(validator.validate, undefined, name + ' missing response');
  expectQualityFailure(validator.validate, {}, name + ' missing note');
  expectQualityFailure(validator.validate, { note: 42 }, name + ' non-string note');
  expectQualityFailure(validator.validate, { note: '   ' }, name + ' blank note');
  expectQualityFailure(validator.validate, { note: 'The model returned an error and no draft.' }, name + ' malformed note');

  let currentSoap = 'the clinician draft already on screen';
  let editorWrites = 0;
  try {
    const result = { note: 'not a clinical note' };
    validator.validate(result);
    currentSoap = result.note;
    editorWrites++;
  } catch (e) {}
  eq(currentSoap, 'the clinician draft already on screen', name + ' changed currentSoap after a quality failure');
  eq(editorWrites, 0, name + ' performed an editor write after a quality failure');
}

console.log('PASS structured-note-response-contract: ' + checks +
  ' checks — malformed /api/generate note responses fail closed before currentSoap/editor mutation in production, 1p, cloned, and staging shells, while SOAP/APSO/narrative notes remain accepted and the failure is explicitly retryable');
