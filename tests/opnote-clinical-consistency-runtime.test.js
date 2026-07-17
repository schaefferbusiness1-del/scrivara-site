'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');

async function main() {
  const templateText = [
    'PATIENT:',
    'PROVIDER:',
    'FACILITY:',
    'DATE OF PROCEDURE:',
    'PREOPERATIVE DIAGNOSIS:',
    'PROCEDURE:',
    'DESCRIPTION OF PROCEDURE:',
    'COMPLICATIONS:',
    'DISPOSITION:'
  ].join('\n');
  let templates = [{
    id: 'lumbar-tfesi',
    name: 'Lumbar transforaminal epidural steroid injection',
    text: templateText
  }];
  const patients = [{
    id: 'patient-1', name: 'Jordan Lee', dob: '1984-05-12', sex: 'F', mrn: 'QA-1', visits: []
  }];
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
    getTemplates() { return templates; },
    getTemplateById(id) { return templates.find(t => t.id === id) || null; },
    getPatients() { return patients; },
    getKey() { return 'test-key'; },
    opPrepRender() {},
    toast() {}
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'opnote-integrity.js' });
  const api = context.__mlsOpNoteIntegrity;
  assert(api && api.version === 'oni-2.7.0', 'clinical consistency owner did not install');

  const factCases = [
    ['Left L2 TFESI', { procedureType: 'tfesi', region: 'lumbar', side: 'left', levels: ['L2'], levelCount: 1, approach: 'transforaminal' }],
    ['Right C6-7 interlaminar epidural steroid injection', { procedureType: 'interlaminar_esi', region: 'cervical', side: 'right', levels: ['C6', 'C7'], levelCount: 2, approach: 'interlaminar' }],
    ['Bilateral L3-L5 transforaminal epidural steroid injections', { procedureType: 'tfesi', region: 'lumbar', side: 'bilateral', levels: ['L3', 'L4', 'L5'], levelCount: 3, approach: 'transforaminal' }],
    ['L4-5 interlaminar ESI', { procedureType: 'interlaminar_esi', region: 'lumbar', side: '', levels: ['L4', 'L5'], levelCount: 2, approach: 'interlaminar' }]
  ];
  for (const [input, expected] of factCases) {
    const actual = api.parseProcedureFacts(input);
    for (const key of Object.keys(expected)) {
      if (Array.isArray(expected[key])) assert.deepStrictEqual(Array.from(actual[key]), expected[key], `${input}: ${key}`);
      else assert.strictEqual(actual[key], expected[key], `${input}: ${key}`);
    }
  }

  const incompatible = api.best('Right C6-7 interlaminar epidural steroid injection');
  assert.strictEqual(incompatible.tpl, null, 'a lone incompatible lumbar TFESI template bypassed the conflict guard');
  assert.strictEqual(incompatible.confident, false, 'an incompatible template was marked confident');
  assert(incompatible.conflicts.some(e => e.field === 'procedureType'), 'procedure-type conflict was not reported separately');
  assert(incompatible.conflicts.some(e => e.field === 'region'), 'region conflict was not reported separately');
  assert(incompatible.conflicts.some(e => e.field === 'approach'), 'approach conflict was not reported separately');

  const validated = {
    name: 'Left L2 lumbar TFESI', text: templateText, validatedFacts: true
  };
  const levelConflict = api.templateCompatibility('Left L2-L3 lumbar TFESI', validated);
  assert.strictEqual(levelConflict.pass, false, 'validated exact levels were treated as interchangeable');
  assert(levelConflict.errors.some(e => e.field === 'levels'), 'exact-level mismatch was not reported');
  assert(levelConflict.errors.some(e => e.field === 'levelCount'), 'level-count mismatch was not reported');

  const scoped = {
    name: 'Lumbar TFESI', text: templateText,
    providerName: 'Jane Smith, MD', facilityName: 'North Procedure Center'
  };
  assert.strictEqual(api.templateCompatibility('Left L2 TFESI', scoped, {
    provider: 'Jane Smith, MD', facility: 'North Procedure Center'
  }).pass, true, 'matching provider/facility scope was rejected');
  const scopeConflict = api.templateCompatibility('Left L2 TFESI', scoped, {
    provider: 'Alex Jones, DO', facility: 'South Procedure Center'
  });
  assert.strictEqual(scopeConflict.pass, false, 'provider/facility-specific template crossed scopes');
  assert(scopeConflict.errors.some(e => e.field === 'provider'), 'provider conflict was not reported separately');
  assert(scopeConflict.errors.some(e => e.field === 'facility'), 'facility conflict was not reported separately');

  const medicationTemplate = {
    requiredFields: ['dexamethasone'], prohibitedFields: ['particulate steroid'], text: templateText
  };
  const baseClinicalNote = 'PROCEDURE: Left L2 TFESI\nMEDICATIONS INJECTED: Dexamethasone and lidocaine.';
  assert.strictEqual(api.clinicalConsistency(baseClinicalNote, 'Left L2 TFESI', medicationTemplate).pass, true, 'required medication language was rejected');
  const badMedication = api.clinicalConsistency(`${baseClinicalNote}\nParticulate steroid was used.`, 'Left L2 TFESI', medicationTemplate);
  assert(badMedication.errors.some(e => e.code === 'prohibited_field'), 'prohibited medication language was not blocked');
  const fluoroscopyTime = api.clinicalConsistency(`${baseClinicalNote}\nFLUOROSCOPY TIME: 12 seconds.`, 'Left L2 TFESI', medicationTemplate);
  assert(fluoroscopyTime.errors.some(e => e.code === 'unrequested_fluoroscopy_time'), 'unrequested fluoroscopy time was not blocked');

  const correct = [
    'PATIENT: Jordan Lee',
    'PROVIDER: Wrong Provider',
    'FACILITY: Wrong Facility',
    'DATE OF PROCEDURE: 2026-07-14',
    'PREOPERATIVE DIAGNOSIS: Lumbar radiculopathy',
    'PROCEDURE: Left L2 TFESI',
    'DESCRIPTION OF PROCEDURE: Completed at the requested level.',
    'COMPLICATIONS: None.',
    'DISPOSITION: Stable.'
  ].join('\n');
  let calls = 0;
  context.aiCallRaw = async () => { calls++; return JSON.stringify({ note: correct, missing: [] }); };
  const ready = await context._genOpNote('Jordan Lee', '2026-07-14', 'Left L2 TFESI', templateText, {
    patientId: 'patient-1', dob: '1984-05-12', provider: 'Jane Smith, MD', facility: 'North Procedure Center'
  });
  assert.strictEqual(calls, 1, 'a clinically correct note made an unnecessary repair request');
  assert(ready.note.includes('PROVIDER: Jane Smith, MD'), 'chart-owned provider metadata was not stamped');
  assert(ready.note.includes('FACILITY: North Procedure Center'), 'chart-owned facility metadata was not stamped');
  assert.strictEqual(ready.clinicalConsistency.pass, true, 'correct note lacks a clinical consistency receipt');

  const wrong = correct
    .replace('PROCEDURE: Left L2 TFESI', 'PROCEDURE: Bilateral S1-S2 TFESI')
    .replace('requested level', 'common level');
  calls = 0;
  context.aiCallRaw = async () => { calls++; return JSON.stringify({ note: wrong, missing: [] }); };
  await assert.rejects(
    context._genOpNote('Jordan Lee', '2026-07-14', 'Left L2 TFESI', templateText, {
      patientId: 'patient-1', dob: '1984-05-12', provider: 'Jane Smith, MD', facility: 'North Procedure Center'
    }),
    err => err && err.code === 'MLS_OPNOTE_CLINICAL_CONFLICT' &&
      err.details.errors.some(e => e.field === 'side') &&
      err.details.errors.some(e => e.field === 'levels') &&
      err.details.errors.some(e => e.field === 'levelCount')
  );
  assert.strictEqual(calls, 2, 'a clinical mismatch did not receive exactly one repair before failing closed');
  assert.strictEqual(context.__mlsLastOpFidelityPass, false, 'a failed clinical draft was marked ready');

  console.log('PASS op-note clinical consistency: independent fact parsing, scope guards, required/prohibited fields, deterministic metadata, and fail-closed repair');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
