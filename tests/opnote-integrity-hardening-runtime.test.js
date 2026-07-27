'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const scribeFlow = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

async function main() {
  const sharedText = [
    'PROCEDURE NOTE',
    'PATIENT:',
    'DOB:',
    'MRN:',
    'AGE:',
    'PROCEDURE: Lumbar ESI',
    'COMPLICATIONS: None.'
  ].join('\n');
  const scopedA = { id: 'esi-alpha', name: 'Lumbar ESI', text: sharedText, providerName: 'Alpha Doctor', facilityName: 'Alpha Center' };
  const scopedB = { id: 'esi-beta', name: 'Lumbar ESI', text: sharedText, providerName: 'Beta Doctor', facilityName: 'Beta Center' };
  let templates = [scopedA, scopedB];
  const patient = { id: 'patient-safe', name: 'Current Patient', dob: '1980-01-02', mrn: 'SAFE-22', visits: [] };
  let uiCalls = 0;
  const aiOpts = [];
  let responder = async () => JSON.stringify({
    note: [
      'PROCEDURE NOTE',
      'PATIENT: Current Patient',
      'DOB: 1980-01-02',
      'MRN: SAFE-22',
      'AGE: 46',
      'PROCEDURE: Lumbar ESI',
      'COMPLICATIONS: None.'
    ].join('\n'),
    missing: []
  });
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document: { readyState: 'complete', addEventListener() {}, getElementById() { return null; } },
    getTemplates() { return templates; },
    getTemplateById(id) { return templates.find(t => t.id === id) || null; },
    getPatients() { return [patient]; },
    getKey() { return 'test-key'; },
    _opDobKey(v) { return String(v || '').trim(); },
    _opPatientCtx() { return { patientId: patient.id, dob: patient.dob, provider: 'Beta Doctor', providerNpi: '1234567890', facility: 'Beta Center', facilityAddress: '1 Beta Way' }; },
    async opPrepGenerateOne() { uiCalls++; },
    opPrepRender() {}, toast() {},
    async aiCallRaw(sys, user, key, opts) { aiOpts.push(opts); return responder(sys, user, key, opts); }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'feat_mls_opnote_integrity.js' });
  const api = context.__mlsOpNoteIntegrity;
  assert(api && api.installed, 'op-note integrity owner did not install');

  // Repeated inline and multiline prior identity values must all be removed,
  // while headings/order and fixed clinical boilerplate remain reusable.
  const prior = [
    'PROCEDURE NOTE',
    'PATIENT: Avery Stone',
    'PATIENT:',
    'Avery Stone',
    'DOB: 04/05/1960',
    'DOB:',
    '04/05/1960',
    'MRN: OLD-7788',
    'MRN:',
    'OLD-7788',
    'AGE: 66',
    'AGE:',
    '66',
    'HISTORY:',
    'Avery Stone (DOB 04/05/1960; MRN OLD-7788) is a 66-year-old with chronic pain.',
    'HISTORY: Prior-patient-only history must not persist.',
    'DIAGNOSIS: Prior-patient-only diagnosis',
    'DIAGNOSIS: Second prior-patient-only diagnosis',
    'PROCEDURE: Lumbar ESI',
    'COMPLICATIONS: None.'
  ].join('\n');
  const sanitized = api.sanitizeTemplate(prior);
  assert(!/Avery\s+Stone|Stone\s*,\s*Avery|04\/05\/1960|OLD-7788|\b66-year-old\b/.test(sanitized), `multiline or repeated prior-patient PHI survived sanitization:\n${sanitized}`);
  assert(!/Prior-patient-only/.test(sanitized), `repeated history or diagnosis content survived sanitization:\n${sanitized}`);
  assert.strictEqual((sanitized.match(/^HISTORY: \[\[history\]\]$/gmi) || []).length, 1, 'filled repeated history was not converted to a slot');
  assert.strictEqual((sanitized.match(/^DIAGNOSIS: \[\[diagnosis\]\]$/gmi) || []).length, 2, 'every repeated diagnosis was not converted to a slot');
  for (const label of ['PATIENT', 'DOB', 'MRN', 'AGE']) {
    assert.strictEqual((sanitized.match(new RegExp(`^${label}:`, 'gmi')) || []).length, 2, `${label} heading structure was not preserved twice`);
  }
  assert(sanitized.includes('COMPLICATIONS: None.'), 'short fixed template value was changed by sanitization');
  assert.strictEqual(api.sanitizeTemplate(sanitized), sanitized, 'adversarial PHI sanitization is not idempotent');
  const stamped = api.forceFacts(sanitized, { patient: 'Current Patient', dob: '1980-01-02', mrn: 'SAFE-22', age: '46' });
  assert.strictEqual((stamped.match(/PATIENT: Current Patient/g) || []).length, 2, 'repeated patient slots were not all stamped');
  assert.strictEqual((stamped.match(/DOB: 1980-01-02/g) || []).length, 2, 'repeated DOB slots were not all stamped');
  assert.strictEqual((stamped.match(/MRN: SAFE-22/g) || []).length, 2, 'repeated MRN slots were not all stamped');
  assert.strictEqual((stamped.match(/AGE: 46/g) || []).length, 2, 'repeated age slots were not all stamped');

  // A verified identityBinding cannot override a contradictory patientId.
  patient.visits = [{ source: 'athena', identityBinding: patient.id, identityVerified: true, patientId: 'different-patient', raw: 'SHOULD NEVER ENTER' }];
  assert.strictEqual(api._verifiedHistoryVisits(patient).length, 0, 'contradictory identityBinding/patientId visit was accepted as verified');
  patient.visits = [];

  // Generic ESI must be a real exact class, without stealing TFESI.
  templates = [
    { id: 'generic-esi', name: 'Lumbar ESI', text: sharedText },
    { id: 'tfesi', name: 'Lumbar TFESI', text: sharedText }
  ];
  assert.strictEqual(api.best('Lumbar ESI').tpl.id, 'generic-esi', 'generic ESI did not exact-match its generic ESI template');
  assert.strictEqual(api.best('Left L5 TFESI').tpl.id, 'tfesi', 'generic ESI matching stole a specific TFESI request');

  // A short concrete heading value is fixed wording, not disposable prose.
  const changedComplications = sharedText.replace('COMPLICATIONS: None.', 'COMPLICATIONS: No immediate complication was documented.');
  assert.strictEqual(api.fidelity(sharedText, sharedText).pass, true, 'unchanged short fixed literal was rejected');
  assert.strictEqual(api.fidelity(changedComplications, sharedText).pass, false, 'changed COMPLICATIONS: None. passed template fidelity');

  // Duplicate text must resolve by the clinician-selected template id, retain
  // that template's provider/facility metadata, and reach the API as that id.
  templates = [scopedA, scopedB];
  const beta = await api.generate(patient.name, '2026-07-17', 'Lumbar ESI', sharedText, {
    patientId: patient.id, dob: patient.dob, provider: 'Beta Doctor', facility: 'Beta Center', templateId: scopedB.id
  });
  assert(beta.note.includes('COMPLICATIONS: None.'), 'selected duplicate-text template did not generate successfully');
  assert.strictEqual(aiOpts[0].mlsOpNoteTemplateId, scopedB.id, 'selected template identity was not carried to the API request');

  const appointmentScope = api._rowGenerationCtx({
    patientId: patient.id, tplId: scopedA.id,
    appt: { name: patient.name, dob: patient.dob, providerName: 'Appointment Doctor', facilityName: 'Appointment ASC' }
  });
  assert.strictEqual(appointmentScope.provider, 'Appointment Doctor', 'appointment provider did not outrank the account provider in UI validation');
  assert.strictEqual(appointmentScope.providerNpi, undefined, 'appointment provider inherited another provider NPI in UI validation');
  assert.strictEqual(appointmentScope.facility, 'Appointment ASC', 'appointment facility did not outrank the account facility in UI validation');
  assert.strictEqual(appointmentScope.facilityAddress, undefined, 'appointment facility inherited another facility address in UI validation');

  // Switching duplicate-text templates while a request is active must create a
  // distinct job; the newer template supersedes the older response safely.
  let releases = [], concurrentCalls = 0;
  responder = () => new Promise(resolve => { concurrentCalls++; releases.push(() => resolve(JSON.stringify({ note: beta.note, missing: [] }))); });
  const alphaPromise = api.generate(patient.name, '2026-07-18', 'Lumbar ESI', sharedText, {
    patientId: patient.id, dob: patient.dob, provider: 'Alpha Doctor', facility: 'Alpha Center', templateId: scopedA.id
  });
  const alphaRejected = assert.rejects(alphaPromise, err => err && err.code === 'MLS_OPNOTE_STALE');
  const betaPromise = api.generate(patient.name, '2026-07-18', 'Lumbar ESI', sharedText, {
    patientId: patient.id, dob: patient.dob, provider: 'Beta Doctor', facility: 'Beta Center', templateId: scopedB.id
  });
  await Promise.resolve(); await Promise.resolve();
  assert.strictEqual(concurrentCalls, 2, 'duplicate-text template ids collided in the generation job key');
  releases.forEach(release => release());
  await betaPromise;
  await alphaRejected;

  // oni-2.14.0 (owner 2026-07-23): a cross-scope template WARNS but still goes
  // through — the wrapper no longer refuses; the underlying generator runs.
  templates = [scopedA];
  context._opPrep = [{ patientId: patient.id, appt: { name: patient.name, dob: patient.dob, reason: 'Lumbar ESI' }, proc: 'Lumbar ESI', tplId: scopedA.id, tplManual: true }];
  const blocked = await context.opPrepGenerateOne(0);
  assert.strictEqual(blocked, false, 'stub generation produced no note yet reported success');
  assert.strictEqual(uiCalls, 1, 'cross-scope template must warn and proceed to the generator (owner directive), not refuse');

  // Cross-PROCEDURE template: generation itself must adapt instead of throwing,
  // and the requested-fact safety net must still be the gate that passed.
  templates = [scopedA, scopedB];
  responder = () => JSON.stringify({
    note: [
      'PROCEDURE NOTE',
      'PATIENT: Current Patient',
      'DOB: 1980-01-02',
      'MRN: SAFE-22',
      'AGE: 46',
      'PROCEDURE: Left L4 medial branch block',
      'DESCRIPTION OF PROCEDURE: Left L4 medial branch block performed under fluoroscopic guidance.',
      'COMPLICATIONS: None.'
    ].join('\n'),
    missing: []
  });
  const adapted = await api.generate(patient.name, '2026-07-19', 'Left L4 medial branch block', sharedText, {
    patientId: patient.id, dob: patient.dob, provider: 'Beta Doctor', facility: 'Beta Center', templateId: scopedB.id
  });
  assert(adapted && adapted.clinicalConsistency && adapted.clinicalConsistency.adapted === true, 'cross-procedure draft did not run in adapted mode');
  assert(adapted.clinicalConsistency.pass === true, 'adapted draft failed the requested-fact safety net');
  assert(/medial branch/i.test(adapted.note), 'cross-procedure draft lost the requested procedure');
  assert(context.__mlsOpNoteTplAdapted && context.__mlsOpNoteTplAdapted.hard === true, 'cross-procedure adaptation was not recorded for the UI');
  assert(scribeFlow.includes("ctx.templateId=String(row.tplId||'')"), 'production UI does not pass selected template identity into generation');
  assert(/ctx\.providerId=String\(appt\.providerId\)/.test(scribeFlow) && /ctx\.facilityId=String\(appt\.facilityId\)/.test(scribeFlow), 'production UI does not pass appointment provider/facility scope into generation');
  /* b722: the rail note became one sentence; the pin follows the words while
     keeping the intent - the intro must teach the ONE-Fields-box workflow. */
  assert(scribeFlow.includes('gathers every missing detail into one <b>Fields</b> box'), 'op-note intro still describes the retired one-at-a-time blank workflow');

  console.log('PASS op-note integrity hardening: repeated PHI scrub, contradictory binding rejection, selected-template identity, generic ESI, short literals, and UI scope');
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
