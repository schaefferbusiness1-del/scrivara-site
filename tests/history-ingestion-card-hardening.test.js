'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');
const start = source.indexOf('/* ----------------------------------------------------------------------------\n * 1) VISIT-AWARE DATA MODEL');
const end = source.indexOf('/* ----------------------------------------------------------------------------\n * 2) PER-VISIT PROFILE UI', start);
assert(start >= 0 && end > start, 'visit model source not found');

const patients = [];
const context = {
  console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
  setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
  addEventListener() {}, removeEventListener() {}, postMessage() {},
  getPatients() { return patients; },
  findPatient(id) { return patients.find(p => p.id === id) || null; },
  upsertPatient(p) {
    const i = patients.findIndex(x => x.id === p.id);
    if (i >= 0) patients[i] = p; else patients.push(p);
  }
};
context.window = context;
vm.runInNewContext(source.slice(start, end), context, { filename: 'visit-model-hardening.js', timeout: 1000 });
const M = context.__mlsVisitModel;

function cardReceipt(id) {
  const cards = {};
  for (const key of ['problems', 'meds', 'allergies', 'summary', 'vitals', 'history']) {
    cards[key] = { status: 'not_documented', populated: false };
  }
  return { complete: true, exactIdentityVerified: true, patientId: id, cards };
}

function strict(id) {
  return { source: 'athena-copy', identityVerified: true, identityBinding: id, bodyComplete: true };
}

// A legacy unverified chart shell must disappear only after a strict body for
// that service date arrives. Manual and substantive unverified rows survive.
const p1 = {
  id: 'patient-ingest', name: 'Example Patient', dob: '01/02/1970',
  problems: 'Clinician-entered scoliosis', meds: 'Clinician-entered vitamin D',
  allergies: 'Clinician-entered latex sensitivity', history: { social: 'Clinician-entered occupation' },
  summary: '', visits: [], athenaProfileCoverage: cardReceipt('patient-ingest')
};
patients.push(p1);
M.addVisit(p1.id, {
  date: '2026-06-24', type: 'Chart summary',
  raw: 'Legacy chart shell assembled before exact encounter verification.'
}, { source: 'athena-copy' });
M.addVisit(p1.id, {
  date: '2026-06-24', type: 'Office visit', sourceVisitKey: 'row:unsafe-a',
  raw: 'Substantive but unverified remote encounter retained for audit.'
}, { source: 'athena-copy' });
M.addVisit(p1.id, {
  date: '2026-06-24', type: 'Office visit', sourceVisitKey: 'row:other-index',
  textHead: 'A different same-day encounter index row remains unhydrated.'
}, { source: 'athena-copy' });
M.addVisit(p1.id, {
  date: '2026-06-24', type: 'Manual note', encounterId: 'manual-a',
  raw: 'Clinician-authored visit content must never be compacted.'
}, { source: 'manual' });

const firstBody = [
  'Assessment:',
  '- Lumbar radiculopathy M54.16',
  '- Sacroiliitis',
  'Medications:',
  '- Gabapentin 300 mg three times daily',
  '- Meloxicam 15 mg daily',
  'Allergies:',
  'Penicillin - rash',
  'Past Medical History:',
  '- Hypertension',
  '- Type 2 diabetes',
  'Past Surgical History:',
  '- Appendectomy in 1998',
  'Social History:',
  '- Never smoker',
  '- No alcohol use',
  'Family History:',
  '- Father with myocardial infarction',
  '- Mother with stroke',
  'Vitals:',
  'BP: 124/76',
  'HR: 72',
  'BMI: 27.4',
  'Plan:',
  '- Continue home exercise and schedule follow-up.'
].join('\n');

M.addVisit(p1.id, {
  date: '2026-06-24', type: 'Office visit', sourceVisitKey: 'row:verified-a',
  fullDetail: true, raw: firstBody
}, strict(p1.id));
let exact = M.getVisits(p1).filter(v => v.sourceVisitKey === 'row:verified-a' || v.encounterId === 'encounter-a');
assert.strictEqual(exact.length, 1, 'strict encounter was not stored exactly once');
assert(!M.getVisits(p1).some(v => v.type === 'Chart summary'), 'superseded unverified chart shell survived strict ingestion');
assert(M.getVisits(p1).some(v => /Substantive but unverified/.test(v.raw)), 'substantive unverified audit row was deleted');
assert(M.getVisits(p1).some(v => v.sourceVisitKey === 'row:other-index'), 'a distinct stable same-day encounter shell was compacted by the wrong visit');
assert(M.getVisits(p1).some(v => /Clinician-authored visit/.test(v.raw)), 'manual visit was deleted');

// The same encounter can gain a second stable alias and later arrive by either
// alias. Each refresh replaces the trusted body rather than appending a row.
M.addVisit(p1.id, {
  date: '2026-06-24', type: 'Office visit', encounterId: 'encounter-a', sourceVisitKey: 'row:verified-a',
  fullDetail: true, raw: firstBody + '\nAssessment:\n- Updated verified diagnosis'
}, strict(p1.id));
M.addVisit(p1.id, {
  date: '2026-06-24', type: 'Office visit', encounterId: 'encounter-a',
  fullDetail: true, raw: firstBody + '\nPlan:\n- Corrected latest plan'
}, strict(p1.id));
exact = M.getVisits(p1).filter(v => v.sourceVisitKey === 'row:verified-a' || v.encounterId === 'encounter-a');
assert.strictEqual(exact.length, 1, 'source-key/encounter-id refresh duplicated one encounter');
assert(/Corrected latest plan/.test(exact[0].raw), 'latest exact encounter body did not replace the stale body');
assert.strictEqual(exact[0].sourceVisitKey, 'row:verified-a', 'source alias was lost during encounter-id refresh');
assert.strictEqual(exact[0].encounterId, 'encounter-a', 'encounter alias was not attached during source-key refresh');

const organized = M.organizePatientHistory(p1.id);
assert.strictEqual(organized.ok, true, 'complete multiline history was rejected');
assert.strictEqual(organized.complete, true);
assert.strictEqual(p1.historyImportReceipt.complete, true, 'semantic history receipt did not complete');
assert.strictEqual(p1.historyImportReceipt.semanticCoverage.complete, true);
assert(/Clinician-entered scoliosis/.test(p1.problems), 'manual problem was overwritten');
assert(/Lumbar radiculopathy M54\.16/.test(p1.problems) && /Sacroiliitis/.test(p1.problems), 'multiline assessment did not populate problems');
assert(/Clinician-entered vitamin D/.test(p1.meds), 'manual medication was overwritten');
assert(/Gabapentin 300 mg/.test(p1.meds) && /Meloxicam 15 mg/.test(p1.meds), 'multiline medications did not populate medication card');
assert(/Clinician-entered latex/.test(p1.allergies) && /Penicillin - rash/.test(p1.allergies), 'allergy card lost manual or imported data');
assert(/Hypertension/.test(p1.history.pmh) && /Type 2 diabetes/.test(p1.history.pmh), 'multiline PMH was not organized');
assert(/Appendectomy/.test(p1.history.psh), 'multiline PSH was not organized');
assert(/Never smoker/.test(p1.history.social), 'multiline social history was not organized');
assert(/myocardial infarction/.test(p1.history.family) && /Mother with stroke/.test(p1.history.family), 'multiline family history was not organized');
assert.strictEqual(p1.vitals.bp, '124/76', 'blood pressure did not populate vitals card');
assert.strictEqual(p1.vitals.hr, '72', 'heart rate did not populate vitals card');
assert.strictEqual(p1.vitals.bmi, '27.4', 'BMI did not populate vitals card');
assert(/^Pulled from Athena/.test(p1.athenaHistorySummary), 'summary card was not generated from verified history');
for (const key of ['problems', 'meds', 'allergies', 'summary', 'vitals', 'history']) {
  assert.strictEqual(p1.athenaProfileCoverage.cards[key].status, 'found', `${key} card was not marked found`);
}
assert.strictEqual(p1.athenaProfileCoverage.semanticComplete, true, 'six-card semantic receipt was not marked complete');

// Reconcile two historical aliases for one exact encounter, delete only stale
// verified Athena rows from the authoritative complete batch, and preserve all
// manual/unverified data.
const p2 = { id: 'patient-reconcile', name: 'Reconcile Patient', dob: '02/03/1975', visits: [] };
patients.push(p2);
p2.visits.push(
  { id: 'old-enc', date: '2026-05-01', type: 'Office visit', encounterId: 'enc-r', sourceVisitKey: '', raw: 'older exact body', source: 'athena-copy', identityVerified: true, identityBinding: p2.id, fullDetail: true, bodyComplete: true, captured: '2026-07-01T00:00:00Z' },
  { id: 'new-src', date: '2026-05-01', type: 'Office visit', encounterId: '', sourceVisitKey: 'row:r', raw: 'newer exact body', source: 'athena-copy', identityVerified: true, identityBinding: p2.id, fullDetail: true, bodyComplete: true, captured: '2026-07-02T00:00:00Z' },
  { id: 'retired', date: '2025-01-01', type: 'Office visit', encounterId: 'retired-r', raw: 'retired verified Athena row', source: 'athena-copy', identityVerified: true, identityBinding: p2.id, fullDetail: true, bodyComplete: true },
  { id: 'manual-r', date: '2025-01-01', type: 'Manual note', encounterId: 'retired-r', raw: 'manual row with same external label', source: 'manual' },
  { id: 'unsafe-r', date: '2025-01-01', type: 'Office visit', encounterId: 'unsafe-r', raw: 'unverified row retained for audit', source: 'athena-copy', identityVerified: false, identityBinding: '' }
);
const reconciled = M.reconcileVerifiedAthenaVisits(p2.id, [{ encounterId: 'enc-r', sourceVisitKey: 'row:r' }]);
assert.strictEqual(reconciled.complete, true);
assert.strictEqual(reconciled.removed, 2, 'exact duplicate plus retired verified row were not reconciled');
const p2RemoteVerified = p2.visits.filter(v => v.source === 'athena-copy' && v.identityVerified === true);
assert.strictEqual(p2RemoteVerified.length, 1, 'authoritative batch retained duplicate verified encounters');
assert.strictEqual(p2RemoteVerified[0].encounterId, 'enc-r', 'reconciled winner lost encounter id');
assert.strictEqual(p2RemoteVerified[0].sourceVisitKey, 'row:r', 'reconciled winner lost source visit key');
assert(/newer exact body/.test(p2RemoteVerified[0].raw), 'reconcile did not retain the newest complete exact body');
assert(p2.visits.some(v => v.id === 'manual-r'), 'reconcile deleted manual history');
assert(p2.visits.some(v => v.id === 'unsafe-r'), 'reconcile deleted unverified audit history');
const beforeUnsafeReconcile = JSON.stringify(p2.visits);
const refused = M.reconcileVerifiedAthenaVisits(p2.id, [{ date: '2026-05-01' }]);
assert.strictEqual(refused.reason, 'stable-keys-incomplete');
assert.strictEqual(JSON.stringify(p2.visits), beforeUnsafeReconcile, 'missing-key reconcile mutated visits instead of failing closed');

// A labeled section that cannot be parsed must produce an incomplete semantic
// receipt and leave every pre-existing clinical field untouched.
const p3 = {
  id: 'patient-incomplete', name: 'Incomplete Patient', dob: '03/04/1980',
  problems: 'Manual problem stays', meds: 'Manual medication stays', allergies: 'Manual allergy stays',
  summary: 'Manual summary stays', history: { pmh: 'Manual PMH stays' }, visits: [],
  athenaProfileCoverage: cardReceipt('patient-incomplete')
};
patients.push(p3);
M.addVisit(p3.id, {
  date: '2026-07-01', type: 'Office visit', encounterId: 'enc-incomplete', fullDetail: true,
  raw: 'Assessment:\n\nMedications:\n- Duloxetine 30 mg daily\nPlan:\n- Follow up.'
}, strict(p3.id));
const incomplete = M.organizePatientHistory(p3.id);
assert.strictEqual(incomplete.ok, false);
assert.strictEqual(incomplete.reason, 'semantic-coverage-incomplete');
assert.strictEqual(incomplete.semanticCoverage.complete, false, 'missed labeled facts falsely claimed semantic completeness');
assert(incomplete.semanticCoverage.missedSections.includes('problems'), 'missed assessment was not receipted');
assert.strictEqual(p3.historyImportReceipt.complete, false);
assert.strictEqual(p3.athenaProfileCoverage.semanticComplete, false);
assert.strictEqual(p3.problems, 'Manual problem stays', 'incomplete parse changed manual problems');
assert.strictEqual(p3.meds, 'Manual medication stays', 'incomplete parse partially changed medications');
assert.strictEqual(p3.allergies, 'Manual allergy stays', 'incomplete parse changed allergies');
assert.strictEqual(p3.summary, 'Manual summary stays', 'incomplete parse changed summary');
assert.strictEqual(p3.history.pmh, 'Manual PMH stays', 'incomplete parse changed PMH');

// The chart parser is not the identity authority and may return visit index
// strings while omitting chart.name/chart.dob. A frozen saveRef that re-passes
// the app's exact identity gate must still bind those shells to this patient so
// the subsequent authoritative full-detail batch compacts them. A bare ref must
// remain unverified even when a legacy/base sink happens to return true.
const wireStart = source.indexOf('/* ----------------------------------------------------------------------------\n * 4) WIRE THE GRAB + ALL CHART IMPORTS');
assert(wireStart >= 0, 'visit chart-save wire source not found');
context._savePatientChart = () => true;
context._athenaHistoryProofMatches = (target, observed) => {
  const bound = patients.find(p => p.id === target.patientId);
  return !!(bound && bound.name === target.name && bound.dob === target.dob && observed.chartDob === target.dob);
};
vm.runInNewContext(source.slice(wireStart), context, { filename: 'visit-save-wire-hardening.js', timeout: 1000 });

const p4 = { id: 'patient-nine', name: 'Nine Visit Patient', dob: '04/05/1970', visits: [] };
patients.push(p4);
const nineDates = Array.from({ length: 9 }, (_x, i) => `2026-06-${String(i + 1).padStart(2, '0')}`);
const verifiedRef = {
  patientId: p4.id, name: p4.name, dob: p4.dob, mrn: '',
  verifiedName: '', verifiedDob: p4.dob, verifiedMrn: ''
};
const parserChartWithoutIdentity = {
  name: '', dob: '',
  visits: nineDates.map(date => `${date} — Office visit index metadata`)
};
assert.strictEqual(context._savePatientChart(verifiedRef, null, parserChartWithoutIdentity), true);
let p4Rows = M.getVisits(p4);
assert.strictEqual(p4Rows.length, 9, 'verified chart index did not create nine patient-bound shells');
assert(p4Rows.every(v => v.indexOnly === true && v.identityVerified === true && v.identityBinding === p4.id), 'verified saveRef did not bind parser shells to the exact patient');

const fullNine = nineDates.map((date, i) => ({
  date, type: 'Office visit', encounterId: `enc-nine-${i + 1}`, sourceVisitKey: `row:nine-${i + 1}`,
  fullDetail: true,
  raw: `Assessment: verified condition ${i + 1}. Plan: verified follow-up for encounter ${i + 1}.`
}));
fullNine.forEach(row => M.addVisit(p4.id, row, strict(p4.id)));
const nineReconcile = M.reconcileVerifiedAthenaVisits(p4.id, fullNine);
assert.strictEqual(nineReconcile.complete, true, 'authoritative nine-encounter batch did not reconcile');
p4Rows = M.getVisits(p4);
assert.strictEqual(p4Rows.length, 9, 'nine full encounters retained duplicate parser shells in the timeline');
assert.strictEqual(M.usableVisits(p4).length, 9, 'the nine verified full encounters were not all usable');
assert(p4Rows.every(v => v.indexOnly !== true && v.fullDetail === true && v.bodyComplete === true), 'a parser shell survived the authoritative full batch');

const p5 = { id: 'patient-unbound-shell', name: 'Unbound Shell Patient', dob: '05/06/1970', visits: [] };
patients.push(p5);
context._savePatientChart(
  { patientId: p5.id, name: p5.name, dob: p5.dob, verifiedName: '', verifiedDob: '', verifiedMrn: '' },
  null,
  { name: '', dob: '', visits: ['2026-06-01 — Office visit index metadata'] }
);
const unboundShell = M.getVisits(p5)[0];
assert(unboundShell && unboundShell.indexOnly === true && unboundShell.identityVerified !== true, 'an unproven saveRef granted trust to a parser shell');
assert.strictEqual(M.usableVisits(p5).length, 0, 'an unbound parser shell entered clinical or op-note context');

console.log('PASS history ingestion hardening: exact encounter idempotency, verified 9-row shell compaction, multiline six-card organization, and honest semantic coverage');
