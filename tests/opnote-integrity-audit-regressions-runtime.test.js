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
    'PREOPERATIVE DIAGNOSIS: [[preoperative_diagnosis]]',
    'PROCEDURE:',
    'HISTORY: [[history]]',
    'DESCRIPTION OF PROCEDURE: [[procedure_description]]',
    'COMPLICATIONS:'
  ].join('\n');
  const templates = [{ id: 'only-tfesi', name: 'Lumbar TFESI', keywords: [], text: templateText }];
  const patient = {
    id: 'p-safe', name: 'Safe Patient', dob: '1980-01-01', sex: 'F', mrn: 'QA-1', problems: '',
    visits: [
      {
        date: '2026-07-16', source: 'athena', identityBinding: 'p-wrong', identityVerified: true,
        patientId: 'p-wrong', patientName: 'Wrong Patient', patientDob: '1971-02-03',
        raw: 'Wrong Bound Diagnosis - Onset: 01/01/2020', plan: 'WRONG-BOUND PLAN'
      },
      {
        date: '2026-07-15', source: 'athena', identityBinding: 'p-safe', identityVerified: true,
        patientId: 'p-safe', patientName: 'Safe Patient', patientDob: '1980-01-01',
        raw: 'Safe Lumbar Radiculopathy - Onset: 01/01/2021', plan: 'SAFE VERIFIED PLAN'
      }
    ]
  };
  const document = { readyState: 'complete', addEventListener() {}, getElementById() { return null; } };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document,
    getTemplates() { return templates; },
    getTemplateById(id) { return templates.find(t => t.id === id) || null; },
    getPatients() { return [patient]; },
    getKey() { return 'test-key'; },
    _opDobKey(v) { return String(v || '').trim(); },
    opPrepRender() {},
    toast() {},
    async aiCallRaw() {
      return JSON.stringify({
        note: [
          'PATIENT: [[patient]]',
          'PREOPERATIVE DIAGNOSIS: [[preoperative_diagnosis]]',
          'PROCEDURE: Left L5 transforaminal epidural steroid injection',
          'HISTORY: [[history]]',
          'DESCRIPTION OF PROCEDURE: Left L5 transforaminal epidural steroid injection was completed.',
          'COMPLICATIONS: None.'
        ].join('\n'),
        missing: []
      });
    }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'feat_mls_opnote_integrity.js' });
  const api = context.__mlsOpNoteIntegrity;
  assert(api && api.installed, 'op-note integrity owner did not install');

  // A one-template library is not enough evidence to assign a procedure.
  assert.strictEqual(api.best('follow-up appointment').tpl, null, 'score-zero follow-up silently received the sole template');
  assert.strictEqual(api.best('Lumbar follow-up').tpl, null, 'unclassified keyword overlap silently received the sole template');
  assert.strictEqual(api.best('Left L5 TFESI').tpl.id, 'only-tfesi', 'a classified exact procedure stopped matching the sole compatible template');

  // Provider-defined short colon headings are part of exact structure/order.
  const customTemplate = [
    'PATIENT:',
    'Pre-Procedure Verification:',
    'Safety Checklist: Completed before positioning.',
    'PROCEDURE:',
    'Recovery Criteria:',
    'COMPLICATIONS:'
  ].join('\n');
  const customHeadings = api.headings(customTemplate);
  assert(customHeadings.includes('pre procedure verification'), 'empty custom colon heading was not recognized');
  assert(customHeadings.includes('safety checklist'), 'inline Title Case custom colon heading was not recognized');
  assert(customHeadings.includes('recovery criteria'), 'second custom colon heading was not recognized');
  const customMissing = customTemplate.replace('Pre-Procedure Verification:\n', '');
  assert.strictEqual(api.fidelity(customMissing, customTemplate).pass, false, 'omitting a custom heading still passed fidelity');
  const customReordered = customTemplate
    .replace('Pre-Procedure Verification:\nSafety Checklist: Completed before positioning.', 'Safety Checklist: Completed before positioning.\nPre-Procedure Verification:');
  assert.strictEqual(api.fidelity(customReordered, customTemplate).pass, false, 'reordering custom headings still passed fidelity');

  // Capture the prior patient from Patient: and neutralize full-name variants
  // everywhere in the reusable narrative, without scrubbing lone name words.
  const priorTemplate = [
    'PROCEDURE NOTE',
    'Patient: Brown, David',
    'History:',
    'David Brown reported chronic pain. Brown, David confirmed the history.',
    'Procedure:',
    'The standard sterile technique was followed.'
  ].join('\n');
  const sanitized = api.sanitizeTemplate(priorTemplate);
  assert(!/Brown\s*,\s*David|David\s+Brown/i.test(sanitized), 'captured prior-patient name variant survived in template narrative');
  assert(/Patient: \[\[patient\]\]/i.test(sanitized), 'patient identity heading did not remain a fillable patient slot');
  assert((sanitized.match(/the patient/gi) || []).length >= 2, 'narrative name variants were not neutralized to the patient');
  assert.strictEqual(api.sanitizeTemplate(sanitized), sanitized, 'name scrubbing made template sanitization non-idempotent');

  // Deterministic diagnosis/history slot filling must use the same verified
  // exact-patient visit set as matching and prompt construction.
  const verified = api._verifiedHistoryVisits(patient);
  assert.strictEqual(verified.length, 1, 'fixture did not isolate one verified exact-patient visit');
  assert.deepStrictEqual(Array.from(api.chartProblems(patient, 'Left L5 TFESI')), ['Safe Lumbar Radiculopathy'], 'wrong-bound visit entered deterministic diagnosis extraction');
  const generated = await api.generate('Safe Patient', '2026-07-17', 'Left L5 TFESI', templateText, {
    patientId: 'p-safe', dob: '1980-01-01'
  });
  assert(generated.note.includes('Safe Lumbar Radiculopathy'), 'verified diagnosis did not fill the deterministic chart slot');
  assert(generated.note.includes('SAFE VERIFIED PLAN'), 'verified plan did not fill the deterministic history slot');
  assert(!generated.note.includes('Wrong Bound Diagnosis') && !generated.note.includes('WRONG-BOUND PLAN'), 'wrong-bound history leaked into the generated note');

  console.log('PASS op-note integrity audit regressions: sole-template signal, custom headings, prior-name scrub, and verified deterministic chart slots');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
