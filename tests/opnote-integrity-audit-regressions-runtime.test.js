'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_opnote_integrity.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const shellTwin = fs.readFileSync(path.join(root, '1p', 'index.html'), 'utf8');
const pdfSource = fs.readFileSync(path.join(root, 'mls-opnote-pro.js'), 'utf8');

function declaredFunction(src, declaration) {
  const at = src.indexOf(declaration);
  assert(at >= 0, 'missing declaration: ' + declaration);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(at, i + 1);
  }
  throw new Error('unterminated declaration: ' + declaration);
}

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
  const fixturePatients = Array.from({ length: 26 }, (_, i) => ({
    id: 'fixture-' + String(i + 1).padStart(2, '0'),
    name: 'Fixture Patient ' + String(i + 1).padStart(2, '0'),
    dob: String(1970 + i).padStart(4, '0') + '-' + String((i % 12) + 1).padStart(2, '0') + '-15',
    mrn: 'SYN-' + String(i + 1).padStart(2, '0'),
    sex: i % 2 ? 'F' : 'M', visits: []
  }));
  const patients = [patient].concat(fixturePatients);
  const document = { readyState: 'complete', addEventListener() {}, getElementById() { return null; } };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp, Error,
    document,
    getTemplates() { return templates; },
    getTemplateById(id) { return templates.find(t => t.id === id) || null; },
    getPatients() { return patients; },
    getKey() { return 'test-key'; },
    clinicalProviderName() { return 'Alex Morgan, MD'; },
    getProviderName() { return 'Alex Morgan, MD'; },
    getNpi() { return '1234567890'; },
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

  /* The final lane is exercised as the exact shape that escaped the old
     suites: one 26-note day, unique immutable patient bindings, stale identity
     headers, stale ages, crossed delimiters, and two legitimate blanks. */
  const serviceDate = '2026-09-12';
  const rows = fixturePatients.map((p, i) => ({
    patientId: p.id,
    dateStr: serviceDate,
    appt: { name: p.name, dob: p.dob, providerName: 'Morgan, Alex, MD', providerId: 'provider-fixture' },
    _ctx: { provider: 'Morgan, Alex, MD', providerNpi: '9999999999' },
    note: [
      'OPERATIVE NOTE',
      'Patient: Stale Template Person',
      'DOB: 1900-01-01',
      'MRN: OLD-' + i,
      'Date of Procedure: 2026-01-01',
      'Provider: Morgan, Alex, MD',
      'NPI: 9999999999',
      'Age: 99',
      'Assistant: [[assistant]]',
      'Facility: [[facility_name]]',
      'DESCRIPTION OF PROCEDURE:',
      'The patient is a 99-year-old adult. Injectate was documented as {40mg/cc).',
      'COMPLICATIONS: None.'
    ].join('\n')
  }));
  const originals = rows.map(r => r.note);

  rows[13].note += '\ninsert after "COMPLICATIONS" the following text';
  const residueOriginal = rows[13].note;
  const quarantined = api.preflightBatch(rows, 'surgeon-day', { applyRepairs: true });
  assert.strictEqual(quarantined.ok, false, 'a 26-note day containing template-edit residue was allowed through');
  assert.strictEqual(quarantined.rows.length, 26, 'the day preflight skipped or duplicated a row');
  assert(quarantined.rows[13].result.issues.some(x => x.code === 'TEMPLATE_EDIT_RESIDUE'), 'the residue row was not identified structurally');
  assert.strictEqual(rows[0].note, originals[0], 'a safe repair was applied before the whole 26-note day passed');
  assert.strictEqual(rows[13].note, residueOriginal, 'the blocked residue row was mutated');

  rows[13].note = originals[13];
  const finalized = api.preflightBatch(rows, 'surgeon-day', { applyRepairs: true });
  assert.strictEqual(finalized.ok, true, 'the repaired synthetic 26-note day did not pass');
  assert.strictEqual(finalized.rows.length, 26, 'the successful day did not return exactly 26 verdicts');
  const ids = new Set();
  finalized.rows.forEach((entry, i) => {
    assert.strictEqual(entry.rowIndex, i, 'the finalizer changed row order at ' + i);
    assert.strictEqual(entry.result.context.patientId, fixturePatients[i].id, 'the finalizer crossed patient ownership at ' + i);
    ids.add(entry.result.context.patientId);
    const out = entry.result.note;
    const expectedAge = api.patientAgeOn(fixturePatients[i].dob, serviceDate);
    assert(out.includes('Patient: ' + fixturePatients[i].name), 'canonical patient did not win at ' + i);
    assert(out.includes('DOB: ' + fixturePatients[i].dob), 'canonical DOB did not win at ' + i);
    assert(out.includes('MRN: ' + fixturePatients[i].mrn), 'canonical MRN did not win at ' + i);
    assert(out.includes('Date of Procedure: ' + serviceDate), 'canonical procedure date did not win at ' + i);
    assert(out.includes('Provider: Alex Morgan, MD'), 'verified practice provider spelling did not win at ' + i);
    assert(out.includes('NPI: 1234567890'), 'verified practice NPI did not win at ' + i);
    assert(out.includes('Age: ' + expectedAge) && out.includes('patient is a ' + expectedAge + '-year-old'), 'DOB-derived encounter age did not win at ' + i);
    assert(out.includes('(40mg/cc)') && !out.includes('{40mg/cc)'), 'unambiguous crossed delimiter was not repaired at ' + i);
    assert(out.includes('[[assistant]]') && out.includes('[[facility_name]]'), 'legitimate assistant/facility blanks were consumed at ' + i);
  });
  assert.strictEqual(ids.size, 26, 'the 26-note verdict set contains a duplicate/missing patient binding');
  assert.deepStrictEqual(rows.map(r => r.note), originals, 'the pure batch contract mutated caller rows rather than returning proposals');

  const directCtx = { patient: 'Fixture Patient 01', name: 'Fixture Patient 01', patientId: 'fixture-01', patientVerified: true,
    dob: fixturePatients[0].dob, mrn: fixturePatients[0].mrn, procedureDate: serviceDate };
  const bodyControls = api.finalizeNote([
    'Patient: Fixture Patient 01', 'Provider: Alex Morgan, MD', 'NPI: 1234567890',
    'HISTORY:', 'Date: follow-up timing to be arranged', 'DESCRIPTION OF PROCEDURE:', 'Patient: prone'
  ].join('\n'), directCtx, { boundary: 'save', applyRepairs: true, requirePatient: true, requireProvider: true });
  assert.strictEqual(bodyControls.ok, true, 'safe body labels were treated as identity contradictions');
  assert(bodyControls.note.includes('Date: follow-up timing to be arranged'), 'a bare body Date: was rewritten as procedure date');
  assert(bodyControls.note.includes('Patient: prone'), 'positioning prose was rewritten as patient identity');

  const standaloneHeading = api.finalizeNote([
    'Patient: Fixture Patient 01', 'Provider: Alex Morgan, MD',
    'PREOPERATIVE DIAGNOSIS', 'Patient: Historical Informant'
  ].join('\n'), directCtx, { boundary: 'save', applyRepairs: true, requirePatient: true, requireProvider: true });
  assert.strictEqual(standaloneHeading.ok, false, 'a standalone section heading did not close the demographic repair zone');
  assert(standaloneHeading.issues.some(x => x.code === 'IDENTITY_OUTSIDE_HEADER'), 'the post-heading identity-like body line was silently rewritten');
  assert(standaloneHeading.proposedNote.includes('Patient: Historical Informant'), 'text after a standalone section heading was mutated');
  const standaloneProcedureHeading = api.finalizeNote([
    'Patient: Fixture Patient 01', 'Provider: Alex Morgan, MD',
    'PROCEDURE', 'Provider: Historical consultant'
  ].join('\n'), directCtx, { boundary: 'save', applyRepairs: true, requirePatient: true, requireProvider: true });
  assert.strictEqual(standaloneProcedureHeading.ok, false, 'a standalone PROCEDURE heading did not close the demographic repair zone');
  assert(standaloneProcedureHeading.issues.some(x => x.code === 'IDENTITY_OUTSIDE_HEADER'), 'a provider-like body line after PROCEDURE was silently rewritten');
  assert(standaloneProcedureHeading.proposedNote.includes('Provider: Historical consultant'), 'the provider-like body text after PROCEDURE was mutated');

  const enumerated = api.finalizeNote([
    'Patient: Fixture Patient 01', 'Provider: Alex Morgan, MD', 'DESCRIPTION OF PROCEDURE:',
    '1) Advance the needle under imaging.', 'a) Confirm position.', 'Dose volume was documented (1 mL).'
  ].join('\n'), directCtx, { boundary: 'save', applyRepairs: true, requirePatient: true, requireProvider: true });
  assert.strictEqual(enumerated.ok, true, 'ordinary line-leading 1)/a) procedural steps were treated as broken parentheses');

  const familyAge = api.finalizeNote('Patient: Fixture Patient 01\nProvider: Alex Morgan, MD\nThe patient is a 99-year-old adult. Mother is a 70-year-old adult.', directCtx,
    { boundary: 'save', applyRepairs: true, requirePatient: true, requireProvider: true });
  assert.strictEqual(familyAge.ok, false, 'a conflicting age with ambiguous ownership was silently rewritten');
  assert(familyAge.issues.some(x => x.code === 'AGE_CLAIM_AMBIGUOUS'), 'ambiguous family-member age did not receive its review code');
  assert(familyAge.proposedNote.includes('Mother is a 70-year-old'), 'the family-member age was changed');
  assert(familyAge.proposedNote.includes('patient is a ' + api.patientAgeOn(fixturePatients[0].dob, serviceDate) + '-year-old'), 'the unambiguous patient age was not proposed correctly');

  const noProviderName = context.clinicalProviderName;
  const noProviderGetter = context.getProviderName;
  context.clinicalProviderName = () => '';
  context.getProviderName = () => '';
  const providerMissing = api.finalizeNote('Patient: Fixture Patient 01\nFINDINGS: Stable.', directCtx,
    { boundary: 'save', applyRepairs: true, requirePatient: true, requireProvider: true });
  assert.strictEqual(providerMissing.ok, false, 'clinical finality passed without verified provider provenance');
  assert(providerMissing.issues.some(x => x.code === 'PROVIDER_REQUIRED_FOR_FINAL'), 'missing provider setup did not receive its final-only review code');
  const providerDraft = api.finalizeNote('Patient: Fixture Patient 01\nFINDINGS: Stable.', directCtx,
    { boundary: 'save-draft', applyRepairs: true, requirePatient: true, requireProvider: false });
  assert.strictEqual(providerDraft.ok, true, 'the shared contract could not retain an identity-verified local draft while provider setup is incomplete');
  const providerInvented = api.finalizeNote('Patient: Fixture Patient 01\nProvider: Model Invented, MD\nFINDINGS: Stable.', directCtx,
    { boundary: 'save', applyRepairs: true, requirePatient: true, requireProvider: true });
  assert.strictEqual(providerInvented.ok, false, 'an unverified literal provider was allowed through the draft recovery distinction');
  assert(providerInvented.issues.some(x => x.code === 'PROVIDER_IDENTITY_UNVERIFIED'), 'an unverified literal provider was treated as mere missing setup');
  const changedAppointmentProvider = api.preflightRow({
    patientId: fixturePatients[0].id, dateStr: serviceDate,
    appt: { name: fixturePatients[0].name, dob: fixturePatients[0].dob, providerName: 'Jordan Taylor, MD', providerId: 'provider-new' },
    opFinalizationContext: { provider: 'Prior Clinician, MD', providerNpi: '1111111111', providerNpiSource: 'appointment' },
    note: 'Patient: ' + fixturePatients[0].name + '\nProvider: Jordan Taylor, MD\nNPI: 1111111111\nFINDINGS: Stable.'
  }, 'save', { applyRepairs: true });
  assert.strictEqual(changedAppointmentProvider.ok, false, 'a prior appointment provider donated its NPI to a changed schedule provider');
  assert(changedAppointmentProvider.issues.some(x => x.code === 'PROVIDER_NPI_UNVERIFIED'), 'the stale cross-provider NPI did not receive a review reason');
  assert(!changedAppointmentProvider.context.providerNpi, 'the stale cross-provider NPI survived in finalization context');

  /* The UI may retain ONLY the missing-provider case, and the persisted record
     must still say draft/review.  This executes the real save handler with the
     real finalizer; it is not a regex-only claim about the branch. */
  let savedNotes = [];
  const saveRow = { patientId: fixturePatients[0].id, dateStr: serviceDate,
    appt: { name: fixturePatients[0].name, dob: fixturePatients[0].dob }, proc: 'Synthetic procedure',
    note: 'Patient: ' + fixturePatients[0].name + '\nFINDINGS: Stable.' };
  const saveMessage = { innerHTML: '', style: {} };
  const saveToasts = [];
  const saveContext = {
    console, Date, Math, JSON, Object, String, Number, Array,
    window: null, _opPrep: [saveRow],
    _opFinalizerRun(i, boundary, applyRepairs, requireProvider) {
      const row = saveContext._opPrep[i];
      const result = api.preflightRow(row, boundary, { applyRepairs: !!applyRepairs, requirePatient: true, requireProvider: requireProvider !== false });
      row._finalReview = result;
      if (result.ok && applyRepairs) {
        row.note = result.note;
        row.opFinalization = result.receipt;
        row.opFinalizationContext = result.context;
      }
      return result;
    },
    _opFinalizerPaint(i, result) { saveContext._opPrep[i]._finalReview = result; },
    opNoteBlankTokens() { return []; },
    _opResolvePatient() { return fixturePatients[0]; },
    _opCcDate() { return serviceDate + ' — '; },
    _opVisitStamp() { return { visitDate: serviceDate, provider: '', appointmentId: '', visitTimestamp: '' }; },
    getNotes() { return savedNotes; },
    saveNotes(value) { savedNotes = value; },
    saveNoteToBackend() {}, renderHistory() {}, updateNavCounts() {}, esc(value) { return String(value); },
    toast(message, kind) { saveToasts.push({ message, kind }); },
    document: { getElementById(id) { return id === 'opPrepMsg_0' ? saveMessage : null; } }
  };
  saveContext.window = saveContext;
  vm.runInNewContext(declaredFunction(shell, 'function opPrepSave(i){'), saveContext, { filename: '1pScribeFlow.html#opPrepSave' });
  saveContext.opPrepSave(0);
  assert.strictEqual(savedNotes.length, 1, 'missing provider setup stranded the local draft instead of retaining it');
  assert.strictEqual(savedNotes[0].isDraft, true, 'a provider-unverified recovery save was marked complete');
  assert(/op-note draft/i.test(savedNotes[0].cc), 'a provider-unverified recovery save was not visibly labelled draft');
  assert(/verified operating provider/i.test(saveMessage.innerHTML), 'the draft receipt did not name the provider setup still required');
  assert(saveRow.opFinalization && saveRow.opFinalization.issueCodes.includes('PROVIDER_REQUIRED_FOR_FINAL'), 'the saved draft lost its blocking provider review receipt');
  assert(saveRow._finalReview && saveRow._finalReview.issues.some(x => x.code === 'PROVIDER_REQUIRED_FOR_FINAL'), 'the on-screen structured provider review disappeared after draft save');

  savedNotes = [];
  saveRow._noteId = '';
  saveRow.note = 'Patient: ' + fixturePatients[0].name + '\nProvider: Model Invented, MD\nFINDINGS: Stable.';
  saveContext.opPrepSave(0);
  assert.strictEqual(savedNotes.length, 0, 'a literal unverified provider used the missing-setup draft exception');
  assert(saveToasts.some(x => x.kind === 'err'), 'the unsafe provider refusal was not visible');
  assert(saveRow._finalReview.issues.some(x => x.code === 'PROVIDER_IDENTITY_UNVERIFIED'), 'the visible structured review lost the unsafe literal-provider reason');
  context.clinicalProviderName = noProviderName;
  context.getProviderName = noProviderGetter;

  const unmatched = api.finalizeNote('Patient: Fixture Patient 01\nProvider: Alex Morgan, MD\nFINDINGS: (unfinished', directCtx,
    { boundary: 'save', applyRepairs: true, requirePatient: true, requireProvider: true });
  assert.strictEqual(unmatched.ok, false, 'an ambiguous unmatched delimiter was repaired or allowed');
  assert(unmatched.issues.some(x => x.code === 'DELIMITER_REVIEW_REQUIRED'), 'unmatched delimiter did not get a structured review code');

  /* Wiring proof: shell twins share the same owner calls, and export reviews
     BEFORE the already-normalized bypass. */
  for (const [label, text] of [['shell', shell], ['shell twin', shellTwin]]) {
    assert(/function opPrepSave\(i\)[\s\S]{0,400}_opFinalizerRun\(i,'save',true\)/.test(text), label + ' save bypasses the finalizer');
    assert(/PROVIDER_REQUIRED_FOR_FINAL[\s\S]{0,1500}verified_operating_provider/.test(declaredFunction(text, 'function opPrepSave(i){')), label + ' does not keep missing-provider saves explicitly draft-only');
    assert(/function opSurgeonSendDay\(\)[\s\S]{0,500}_opFinalizerBatch\(day,'surgeon-day'\)/.test(text), label + ' day handoff bypasses the finalizer');
    assert(/function opSurgeonSend\(\)[\s\S]{0,350}_opFinalizerRun\(i,'surgeon-send',true\)/.test(text), label + ' single handoff bypasses the finalizer');
  }
  const exportAt = pdfSource.indexOf('async function exportPdf');
  const finalAt = pdfSource.indexOf('pdfFinalization(rawText, opts, meta)', exportAt);
  const normalizedAt = pdfSource.indexOf('isNormalized(rawText)', exportAt);
  assert(exportAt >= 0 && finalAt > exportAt && finalAt < normalizedAt, 'PDF finalization still occurs after the already-normalized bypass');

  console.log('PASS op-note integrity audit regressions: legacy integrity plus atomic 26-note finalization, provider provenance, DOB age, narrow delimiter repair, residue quarantine, body-label controls, and all exit wiring');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
