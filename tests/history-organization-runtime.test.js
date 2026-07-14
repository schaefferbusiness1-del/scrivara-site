'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const visitsSource = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const historyUiSource = fs.readFileSync(path.join(root, 'feat_visit_history_ext.js'), 'utf8');
const opSource = fs.readFileSync(path.join(root, 'feat_opnote_history.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing start marker ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing end marker ${end}`);
  return source.slice(a, b);
}

const modelSource = between(visitsSource, '/* ----------------------------------------------------------------------------\n * 1) VISIT-AWARE DATA MODEL', '/* ----------------------------------------------------------------------------\n * 2) PER-VISIT PROFILE UI');
const copySource = between(visitsSource, '/* ----------------------------------------------------------------------------\n * 3) COPY EVERY VISIT', '/* ----------------------------------------------------------------------------\n * 4) WIRE THE GRAB');

async function main() {
  let capturedAiRequest = null;
  let underlyingAiCalls = 0;
  let activePatientId = 'patient-a';
  let patients = [{
    id: 'patient-a', name: 'Example Patient', dob: '01/02/1970',
    problems: '', meds: '', allergies: '', summary: '', visits: []
  }];
  const clone = value => JSON.parse(JSON.stringify(value));
  const document = {
    readyState: 'loading',
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    createElement() { return {}; },
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    document,
    setTimeout, clearTimeout,
    setInterval() { return 1; }, clearInterval() {},
    getPatients() { return patients; },
    findPatient(id) { return patients.find(p => p.id === id) || null; },
    upsertPatient(p) {
      const i = patients.findIndex(x => x.id === p.id);
      if (i >= 0) patients[i] = p; else patients.push(p);
    },
    activePatient() { return patients.find(p => p.id === activePatientId) || null; },
    aiCallRaw(sys, user, key, opts) {
      underlyingAiCalls++;
      capturedAiRequest = { sys, user, key, opts };
      return Promise.resolve('Diagnoses: lumbar radiculopathy (M54.16)\nMedications: gabapentin\nPlan: continue care.');
    }
  };
  context.window = context;
  vm.runInNewContext(modelSource, context, { filename: 'visit-model.js' });
  vm.runInNewContext(copySource, context, { filename: 'copy-visits.js' });

  const M = context.__mlsVisitModel;
  assert(M && typeof M.summarizeAll === 'function', 'aggregate history summarizer did not install');

  M.addVisit('patient-a', {
    date: '2025-01-01', type: 'Imported chart',
    raw: 'Patient: Different Person DOB: 03/04/1980\nDiagnoses: unrelated condition'
  }, { source: 'athena-copy' });
  let receipt = M.organizePatientHistory('patient-a');
  assert.strictEqual(receipt.ok, false, 'unverified Athena-only history was allowed into the patient profile');
  assert.strictEqual(patients[0].problems, '', 'unverified history mutated the problem list');

  // Exact-profile-only facts must ride with the immutable patient id even when
  // they do not appear in any imported visit row.
  patients[0].problems = 'exact profile-only sacroiliitis';
  patients[0].meds = 'exact profile-only duloxetine';
  patients[0].allergies = 'exact profile-only latex allergy';
  patients[0].history = { family: 'exact profile-only family stroke history' };
  patients[0].athenaChartSnapshot = { summary: 'STALE SNAPSHOT MUST BE REPLACED' };
  patients[0].athenaChartSnapshot = {
    pulledAt: '2026-07-14T12:00:00Z',
    problems: ['exact latest snapshot spinal stenosis'],
    history: { pmh: 'exact latest snapshot PMH' }
  };

  const verifiedRaw = [
    'Patient: Example Patient DOB: 01/02/1970',
    'Diagnoses: lumbar radiculopathy (M54.16)',
    'Medications: gabapentin',
    'Allergies: penicillin',
    'Past medical history: hypertension',
    'Past surgical history: prior procedure',
    'Social history: never smoker'
  ].join('\n');
  M.addVisit('patient-a', { date: '2026-06-24', type: 'Office visit', raw: verifiedRaw }, {
    source: 'athena-copy', identityVerified: true, identityBinding: 'patient-a'
  });
  receipt = await M.summarizeAll('patient-a');
  assert.strictEqual(receipt.ok, true, 'verified visit history did not organize');
  assert(/lumbar radiculopathy/i.test(patients[0].problems), 'diagnosis text did not populate the problem list');
  assert(/M54\.16/i.test(patients[0].problems), 'structured ICD-10 did not remain represented');
  assert(/gabapentin/i.test(patients[0].meds), 'medication did not populate the medication group');
  assert(/penicillin/i.test(patients[0].allergies), 'allergy did not populate the allergy group');
  assert(/hypertension/i.test(patients[0].history.pmh), 'PMH did not populate history');
  assert(/never smoker/i.test(patients[0].history.social), 'social history did not populate history');
  assert(/Recent visits:/i.test(patients[0].athenaHistorySummary), 'longitudinal summary omitted recent visits');
  assert(!/Different Person/i.test(patients[0].athenaHistorySummary), 'unverified other-patient text leaked into the summary');
  assert.strictEqual(patients[0].historyImportReceipt.excludedUnverified, 1, 'excluded unverified rows were not receipted');

  // Same display name AND DOB, deliberately active, with fully different data.
  // The old active-patient fallback selected this chart; immutable id must not.
  patients.push({
    id: 'patient-b', name: 'Example Patient', dob: '01/02/1970',
    problems: 'WRONG PROFILE PROBLEM', meds: 'WRONG PROFILE MED',
    allergies: 'WRONG PROFILE ALLERGY', history: { pmh: 'WRONG PROFILE HISTORY' },
    summary: 'WRONG PROFILE SUMMARY', athenaChartSnapshot: { summary: 'WRONG OTHER PATIENT SNAPSHOT' }, visits: []
  });
  M.addVisit('patient-b', {
    date: '2026-06-25', type: 'Office visit', icd10: ['Z99.89'],
    raw: 'Diagnoses: WRONG OTHER PATIENT VISIT'
  }, { source: 'athena-copy', identityVerified: true, identityBinding: 'patient-b' });
  activePatientId = 'patient-b';

  assert.strictEqual(context.__mlsCopyVisits._visitIdentityAgrees(patients[0], verifiedRaw), true, 'matching printed identity was rejected');
  assert.strictEqual(context.__mlsCopyVisits._visitIdentityAgrees(patients[0], 'Patient: Different Person DOB: 03/04/1980'), false, 'contradictory printed identity was accepted');
  const before = patients[0].visits.length;
  assert.throws(() => context.__mlsCopyVisits._saveVisits(
    patients[0], { name: 'Example Patient', dob: '01/02/1970' },
    [{ date: '2026-07-01', raw: 'Patient: Different Person DOB: 03/04/1980' }]
  ), /different patient/i, 'mixed-identity batch did not fail closed');
  assert.strictEqual(patients[0].visits.length, before, 'failed identity batch partially saved rows');

  vm.runInNewContext(opSource, context, { filename: 'opnote-history.js' });
  const op = context.__mlsOpNoteHistory;
  assert(op && op.installed, 'op-note history module did not install');
  const prompt = [
    'PATIENT: Example Patient',
    'DATE OF PROCEDURE: 07/15/2026',
    'PROCEDURE: Example procedure',
    '',
    'KNOWN PATIENT FACTS (already in our chart):',
    '- date of birth: 01/02/1970',
    '',
    'TEMPLATE (example)'
  ].join('\n');
  const exactOpts = { freeform: true, mlsOpNotePatientId: 'patient-a' };
  const injected = op.injectIfOpNote('Draft an OPERATIVE / PROCEDURE NOTE', prompt, exactOpts);
  assert(/PRIOR LONGITUDINAL HISTORY/.test(injected), 'DOB-bound op-note prompt did not receive verified history');
  assert(/exact profile-only sacroiliitis/i.test(injected), 'exact profile-only problems were omitted from op-note context');
  assert(/exact profile-only duloxetine/i.test(injected), 'exact profile-only medications were omitted from op-note context');
  assert(/exact profile-only latex allergy/i.test(injected), 'exact profile-only allergies were omitted from op-note context');
  assert(/exact profile-only family stroke history/i.test(injected), 'exact profile-only history was omitted from op-note context');
  assert(/exact latest snapshot spinal stenosis/i.test(injected), 'latest exact-patient Athena chart snapshot was omitted from op-note context');
  assert(!/STALE SNAPSHOT MUST BE REPLACED/.test(injected), 'a replaced Athena chart snapshot remained in op-note context');
  assert(!/Different Person/.test(injected), 'op-note context included an unverified visit');
  assert(!/WRONG PROFILE|WRONG OTHER PATIENT|Z99\.89/.test(injected), 'duplicate-name/DOB active-patient data leaked into exact-id context');
  op.rewire();
  await context.aiCallRaw('Draft an OPERATIVE / PROCEDURE NOTE', prompt, 'test-key', exactOpts);
  assert(capturedAiRequest && /PRIOR LONGITUDINAL HISTORY/.test(capturedAiRequest.user), 'the actual op-note AI request omitted verified longitudinal history');
  assert(/lumbar radiculopathy|M54\.16/i.test(capturedAiRequest.user), 'the actual op-note AI request omitted the patient\'s verified clinical history');
  assert(/exact profile-only sacroiliitis|exact profile-only duloxetine/i.test(capturedAiRequest.user), 'the actual op-note AI request omitted exact profile-only data');
  assert(/exact latest snapshot spinal stenosis/i.test(capturedAiRequest.user), 'the actual op-note AI request omitted the latest exact-patient Athena chart snapshot');
  assert(!/Different Person/.test(capturedAiRequest.user), 'the actual op-note AI request leaked an excluded unverified visit');
  assert(!/WRONG PROFILE|WRONG OTHER PATIENT|Z99\.89/.test(capturedAiRequest.user), 'the actual AI request leaked a duplicate-name/DOB active patient');
  assert.strictEqual(op.lastInjectionReceipt.included, true, 'op-note request did not receipt verified-history injection');
  assert.strictEqual(op.lastInjectionReceipt.identityVerified, true, 'op-note request receipt did not prove immutable-id verification');
  assert.strictEqual(op.lastInjectionReceipt.visitCount, 1, 'op-note request receipt did not count the verified longitudinal visit');
  assert(op.lastInjectionReceipt.profileSections >= 4, 'op-note request receipt omitted exact profile sections');
  assert.strictEqual(op.lastInjectionReceipt.snapshotIncluded, true, 'op-note request receipt omitted the latest structured Athena chart snapshot');
  assert(op.lastInjectionReceipt.historyChars > 100, 'op-note request receipt did not prove a substantive history block');
  const wrongDob = prompt.replace('01/02/1970', '03/04/1980');
  assert.throws(() => op.injectIfOpNote('Draft an OPERATIVE / PROCEDURE NOTE', wrongDob, exactOpts), /exact patient identity/i, 'wrong-DOB prompt did not fail closed');
  assert.throws(() => op.injectIfOpNote('Draft an OPERATIVE / PROCEDURE NOTE', prompt, { freeform: true }), /exact patient identity/i, 'missing immutable patient id did not fail closed');

  const beforeBlockedCalls = underlyingAiCalls;
  patients.push({ id: 'patient-mismatch', name: 'Another Person', dob: '09/10/1985', problems: 'MISMATCHED ID PROFILE', visits: [] });
  await assert.rejects(
    context.aiCallRaw('Draft an OPERATIVE / PROCEDURE NOTE', prompt, 'test-key', { freeform: true }),
    err => err && err.code === 'MLS_OPNOTE_IDENTITY',
    'wrapped aiCallRaw did not reject a missing immutable patient id'
  );
  await assert.rejects(
    context.aiCallRaw('Draft an OPERATIVE / PROCEDURE NOTE', prompt, 'test-key', { freeform: true, mlsOpNotePatientId: 'missing-patient' }),
    err => err && err.code === 'MLS_OPNOTE_IDENTITY',
    'wrapped aiCallRaw did not reject an unknown immutable patient id'
  );
  await assert.rejects(
    context.aiCallRaw('Draft an OPERATIVE / PROCEDURE NOTE', prompt, 'test-key', { freeform: true, mlsOpNotePatientId: 'patient-mismatch' }),
    err => err && err.code === 'MLS_OPNOTE_IDENTITY',
    'wrapped aiCallRaw did not reject an immutable id whose chart identity mismatched the prompt'
  );
  assert.strictEqual(underlyingAiCalls, beforeBlockedCalls, 'identity-blocked op notes still reached the underlying AI transport');

  patients.push({
    id: 'profile-only', name: 'Profile Only', dob: '05/06/1990',
    problems: 'profile-only exact diagnosis', meds: 'profile-only exact medication',
    allergies: 'profile-only exact allergy', history: { social: 'profile-only exact social history' }, visits: []
  });
  const profilePrompt = prompt.replace('Example Patient', 'Profile Only').replace('01/02/1970', '05/06/1990');
  const profileOnlyInjected = op.injectIfOpNote('Draft an OPERATIVE / PROCEDURE NOTE', profilePrompt, { freeform: true, mlsOpNotePatientId: 'profile-only' });
  assert(/profile-only exact diagnosis/.test(profileOnlyInjected), 'profile-only patient problems were not injected without visits');
  assert(/VERIFIED VISITS: none recorded/.test(profileOnlyInjected), 'profile-only context did not honestly state that no visits were recorded');
  assert.strictEqual(op.lastInjectionReceipt.visitCount, 0, 'profile-only context fabricated a visit count');

  assert(historyUiSource.includes('MODEL().summarizeAll || MODEL().ensureSummaries'), 'visible Summarize all control does not update the aggregate profile');
  assert(historyUiSource.includes('document.createElement("details")'), 'visit years are not collapsible');
  assert(historyUiSource.includes('MutationObserver(scheduleRebuild)') && historyUiSource.includes('}, 3000)'), 'history UI still relies on a sub-second whole-section poll');

  console.log('PASS verified history organization: identity-bound visits populate profile groups, summaries, collapsible timeline, and op-note context');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
