'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing source marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}

const identity = between(app, 'function _athenaHistoryDigits(v)', '/* Like _assistReadAthenaTab');
const save = between(app, 'function _athenaChartHistoryObject(chart)', '/* Bulk: after pulling the schedule');
const emptyText = between(app, 'function _athenaProfileEmptyText(p,key,fallback)', 'function fieldBody(elId,txt,placeholder)');
const clone = value => JSON.parse(JSON.stringify(value));

function covered(fields) {
  const chart = Object.assign({ problems: '', meds: '', allergies: '', summary: '', vitals: {}, history: {}, visits: [] }, fields || {});
  const present = value => value && (typeof value !== 'object' || Object.values(value).some(Boolean));
  chart.coverage = {
    problems: present(chart.problems) ? 'found' : 'not_documented', meds: present(chart.meds) ? 'found' : 'not_documented',
    allergies: present(chart.allergies) ? 'found' : 'not_documented', summary: present(chart.summary) ? 'found' : 'not_documented',
    vitals: present(chart.vitals) ? 'found' : 'not_documented', history: present(chart.history) ? 'found' : 'not_documented'
  };
  return chart;
}

let patients = [{
  id: 'patient-a', name: 'Alex Same', dob: '01/02/1970', mrn: '111',
  problems: 'Manual problem', meds: 'Manual medication',
  allergies: 'Unknown; Manual allergy', summary: 'Clinician-authored summary.'
}, {
  id: 'patient-b', name: 'Alex Same', dob: '03/04/1980', mrn: '222',
  problems: 'Other patient problem', meds: '', allergies: '', summary: 'Other patient summary.'
}];
let notes = [{ id: 'other-note', patientId: 'patient-b', patient: 'Alex Same', cc: 'Athena chart import', text: 'Other patient import', created: 5, updated: 5 }];

const context = {
  console, Date, Math, JSON, Object, String, Number, Array, RegExp,
  getPatients() { return clone(patients); },
  upsertPatient(p) {
    const i = patients.findIndex(x => x.id === p.id);
    if (i >= 0) patients[i] = clone(p); else patients.push(clone(p));
  },
  getNotes() { return clone(notes); },
  saveNotes(next) { notes = clone(next); }
};
context.window = context;
vm.runInNewContext(identity + '\n' + save + '\n' + emptyText, context, { filename: 'chart-refresh-merge-runtime.js' });

const exact = {
  patientId: 'patient-a', name: 'Alex Same', dob: '01/02/1970', mrn: '111',
  verifiedName: 'Alex Same', verifiedDob: '01/02/1970', verifiedMrn: '111'
};
const wrong = { ...exact, verifiedDob: '03/04/1980', verifiedMrn: '222' };

assert.strictEqual(context._savePatientChart(wrong, null, {
  problems: 'WRONG', summary: 'WRONG DUPLICATE PATIENT'
}), false, 'wrong-patient proof was accepted');
assert(!JSON.stringify(patients).includes('WRONG DUPLICATE PATIENT'), 'failed exact-identity save mutated a patient');

assert.strictEqual(context._savePatientChart(exact, null, covered({
  problems: 'A, B', meds: 'M1, M2', allergies: 'Latex',
  summary: 'First verified Athena summary.',
  vitals: { bp: '128/82', hr: '72', takenAt: '2026-01-01' },
  history: ['PMH: First imported history'], visits: ['01/01/2026 — First imported visit']
})), true, 'first exact-patient chart save failed');

const firstPatient = clone(patients.find(p => p.id === 'patient-a'));
const firstNote = clone(notes.find(n => n.patientId === 'patient-a' && n.cc === 'Athena chart import'));
assert(firstNote, 'first pull did not create its one Athena import note');

// Simulate a clinician adding text after the import. A refresh must preserve it.
patients.find(p => p.id === 'patient-a').summary += '\n\nClinician added this after the first pull.';
patients.find(p => p.id === 'patient-a').problems += '; Clinician-added problem';

const secondChart = covered({
  problems: 'A, C, none recorded', meds: 'M2, M3, N/A', allergies: 'Penicillin, not recorded',
  summary: 'Second verified Athena summary.',
  vitals: { bp: '130/84', hr: '74', takenAt: '2026-02-02' },
  history: { pmh: 'Second imported history', social: 'Never smoker' }, visits: ['02/02/2026 — Second imported visit']
});
assert.strictEqual(context._savePatientChart({ ...exact, requestId: 'refresh-op-2' }, null, secondChart), true, 'repeat exact-patient chart save failed');

const patient = patients.find(p => p.id === 'patient-a');
function canonicalItems(value) {
  return String(value || '').split(/[\r\n;,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
}
function exactlyOnce(list, item) {
  assert.strictEqual(list.filter(x => x === item.toLowerCase()).length, 1, `${item} was not stored exactly once`);
}
const problems = canonicalItems(patient.problems);
['Manual problem', 'A', 'C', 'Clinician-added problem'].forEach(x => exactlyOnce(problems, x));
assert(!problems.includes('b'), 'removed Athena problem B survived the verified refresh');
const meds = canonicalItems(patient.meds);
['Manual medication', 'M2', 'M3'].forEach(x => exactlyOnce(meds, x));
assert(!meds.includes('m1'), 'removed Athena medication M1 survived the verified refresh');
const allergies = canonicalItems(patient.allergies);
['Manual allergy', 'Penicillin'].forEach(x => exactlyOnce(allergies, x));
assert(!allergies.includes('latex'), 'removed Athena allergy survived the verified refresh');
['none recorded', 'not recorded', 'unknown', 'n/a'].forEach(placeholder => {
  assert(!problems.includes(placeholder), `${placeholder} contradicted a meaningful problem list`);
  assert(!meds.includes(placeholder), `${placeholder} contradicted a meaningful medication list`);
  assert(!allergies.includes(placeholder), `${placeholder} contradicted a meaningful allergy list`);
});

assert(patient.summary.includes('Clinician-authored summary.'), 'pre-import manual summary was lost');
assert(patient.summary.includes('Clinician added this after the first pull.'), 'post-import manual summary was lost');
assert(patient.summary.includes('Second verified Athena summary.'), 'latest verified summary is absent from the normal profile summary');
assert(patient.summary.includes('Second imported history'), 'latest verified history is absent from the normal profile summary');
assert(patient.summary.includes('02/02/2026 — Second imported visit'), 'latest verified visit is absent from the normal profile summary');
assert.strictEqual(patient.vitals.bp, '130/84', 'latest Athena-owned vitals did not refresh');
assert(!/First imported history/i.test(patient.history.pmh) && /Second imported history/i.test(patient.history.pmh), 'verified refresh did not replace stale Athena-owned PMH');
assert(/Never smoker/i.test(patient.history.social), 'structured social history did not populate');
assert.strictEqual(patient.athenaProfileCoverage.complete, true, 'six-card profile coverage was not receipted');
assert.strictEqual(patient.athenaProfileCoverage.patientId, 'patient-a', 'six-card receipt was not bound to the exact patient id');
assert.strictEqual(patient.athenaProfileCoverage.saveRequestId, 'refresh-op-2', 'six-card receipt was not bound to the exact save operation');
assert.strictEqual(
  context._athenaChartSnapshotProof(patient.athenaChartSnapshot),
  context._athenaChartSnapshotProof(context._athenaChartSnapshotFromChart(secondChart)),
  'stored Athena-owned chart snapshot differs from the exact parsed chart payload'
);
assert(!patient.summary.includes('First verified Athena summary.'), 'stale verified summary remained in the normal profile summary');
assert.strictEqual((patient.summary.match(/Pulled from Athena/g) || []).length, 1, 'repeat pull created duplicate daily summary blocks');
assert.strictEqual(patient.athenaChartSummaryBlock.includes('Second verified Athena summary.'), true, 'latest display-summary ownership marker was not replaced');
assert.strictEqual(patient.athenaChartSnapshot.summary, 'Second verified Athena summary.', 'latest structured snapshot did not replace the old one');
assert(!JSON.stringify(patient.athenaChartSnapshot).includes('First imported history'), 'old snapshot facts survived replacement');
assert(!/none recorded|not recorded|unknown|n\/a/i.test(JSON.stringify(patient.athenaChartSnapshot)), 'no-data placeholder leaked into the meaningful latest snapshot');

const imports = notes.filter(n => n.patientId === 'patient-a' && n.cc === 'Athena chart import');
assert.strictEqual(imports.length, 1, 'repeat pull did not leave exactly one Athena import note');
assert.strictEqual(imports[0].id, firstNote.id, 'repeat pull changed the Athena import note id');
assert.strictEqual(imports[0].created, firstNote.created, 'repeat pull changed the Athena import note creation time');
assert(imports[0].updated > firstNote.updated, 'repeat pull did not refresh the Athena import note update time');
assert(imports[0].text.includes('Second verified Athena summary.'), 'Athena import note does not contain the latest verified summary');
assert(!imports[0].text.includes('First verified Athena summary.'), 'Athena import note retained stale summary text');
assert.strictEqual(notes.filter(n => n.id === 'other-note').length, 1, 'refresh changed another patient\'s import note');

// A later verified not_documented snapshot must clear every prior Athena-owned
// fact while retaining clinician-authored deltas in the same fields.
patients.find(p => p.id === 'patient-a').history.pmh += '; Manual PMH note';
patients.find(p => p.id === 'patient-a').vitals.temp = '98.6 F';
assert.strictEqual(context._savePatientChart(exact, null, covered({})), true, 'verified not_documented refresh failed');
const cleared = patients.find(p => p.id === 'patient-a');
const clearedProblems = canonicalItems(cleared.problems);
const clearedMeds = canonicalItems(cleared.meds);
const clearedAllergies = canonicalItems(cleared.allergies);
['manual problem', 'clinician-added problem'].forEach(x => assert(clearedProblems.includes(x), `manual problem delta ${x} was lost`));
assert(!clearedProblems.some(x => ['a', 'b', 'c'].includes(x)), 'Athena-owned problems survived verified not_documented');
assert.deepStrictEqual(clearedMeds, ['manual medication'], 'Athena-owned medications survived verified not_documented');
assert.deepStrictEqual(clearedAllergies, ['manual allergy'], 'Athena-owned allergies survived verified not_documented');
assert.strictEqual(cleared.history.pmh, 'Manual PMH note', 'manual PMH delta was not isolated from cleared Athena PMH');
assert.strictEqual(cleared.vitals.bp, '', 'old Athena blood pressure survived verified not_documented');
assert.strictEqual(cleared.vitals.hr, '', 'old Athena heart rate survived verified not_documented');
assert.strictEqual(cleared.vitals.temp, '98.6 F', 'manual vital delta was lost during verified not_documented');
assert(cleared.summary.includes('Clinician-authored summary.') && cleared.summary.includes('Clinician added this after the first pull.'), 'manual summary text was lost during verified not_documented');
assert(!/First verified Athena summary|Second verified Athena summary/.test(cleared.summary), 'stale Athena summary survived verified not_documented');
for (const key of ['problems', 'meds', 'allergies', 'summary', 'vitals', 'history']) {
  assert.strictEqual(cleared.athenaProfileCoverage.cards[key].status, 'not_documented', `${key} did not retain verified not_documented coverage`);
}
assert.strictEqual(cleared.athenaProfileCoverage.exactIdentityVerified, true);
assert.strictEqual(cleared.athenaProfileCoverage.patientId, 'patient-a');
assert(/^Athena chart verified/.test(context._athenaProfileEmptyText(cleared, 'problems', 'fallback')), 'exact verified not_documented receipt did not render its honest empty state');
assert.strictEqual(context._athenaProfileEmptyText({ ...cleared, athenaProfileCoverage: { ...cleared.athenaProfileCoverage, patientId: 'patient-b' } }, 'problems', 'fallback'), 'fallback', 'another patient\'s empty receipt authorized this profile');
assert.deepStrictEqual(cleared.athenaChartSnapshot.problems, []);
assert.deepStrictEqual(cleared.athenaChartSnapshot.meds, []);
assert.deepStrictEqual(cleared.athenaChartSnapshot.allergies, []);
assert.strictEqual(notes.filter(n => n.patientId === 'patient-a' && n.cc === 'Athena chart import').length, 1, 'verified empty refresh duplicated its import note');
assert(!notes.find(n => n.patientId === 'patient-a' && n.cc === 'Athena chart import').text.includes('Second verified Athena summary.'), 'verified empty import note retained stale Athena text');

const beforeRefusal = clone({ patients, notes });
assert.strictEqual(context._savePatientChart(wrong, null, {
  problems: 'SHOULD NEVER SAVE', summary: 'SHOULD NEVER SAVE'
}), false, 'repeat save stopped failing closed on conflicting DOB/MRN proof');
assert.deepStrictEqual(clone({ patients, notes }), beforeRefusal, 'refused repeat save mutated stored chart data');
assert(firstPatient.athenaChartSnapshot.summary === 'First verified Athena summary.', 'test did not prove two distinct snapshot generations');

console.log('PASS repeat chart refresh: canonical list enrichment, one replace-in-place import, manual summary preservation, and exact identity fail closed');
