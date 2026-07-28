'use strict';

/* AN ORGANIZE PASS MAY NEVER DELETE A FACT IT DID NOT RE-READ.

   organizePatientHistory rebuilds problems/meds/allergies/history through
   _mergeOwnedText(current, previousFactsSnapshot, freshFacts). Everything in
   the previous facts snapshot is treated as REMOVABLE, and the fresh facts are
   seeded from the Athena-owned chart snapshot only when the exact-patient
   profile receipt is intact. So when that receipt is missing, incomplete, or
   bound to another patient id - the documented stale-bulk-write clobber class,
   which cost 8 of 17 and 11-14 of 16 day-pull patients their coverage stamp on
   two separate live days - the pass DELETED the chart-derived facts and put
   back only what it could re-derive from visit bodies.

   Measured on the real model 2026-07-28: twelve chart problems in, SIX out (the
   six named in one visit assessment); with no visits at all the field went to
   the empty string. Both returned receipt ok:true.

   This suite runs the production __mlsVisitModel and pins the rule in both
   directions: an unread slice may only be added to, and a slice that WAS read
   still replaces its own stale facts. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.env.MLS_TEST_ROOT ? path.resolve(process.env.MLS_TEST_ROOT) : path.resolve(__dirname, '..');
const visitsSource = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start); assert(a >= 0, 'missing start marker ' + start);
  const b = source.indexOf(end, a + start.length); assert(b > a, 'missing end marker ' + end);
  return source.slice(a, b);
}
const modelSource = between(
  visitsSource,
  '/* ----------------------------------------------------------------------------\n * 1) VISIT-AWARE DATA MODEL',
  '/* ----------------------------------------------------------------------------\n * 2) PER-VISIT PROFILE UI'
);

let patients = [];
const noop = () => {};
const context = {
  console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
  document: {
    readyState: 'complete', addEventListener: noop, removeEventListener: noop,
    getElementById: () => null, querySelector: () => null, createElement: () => ({}),
    head: { appendChild: noop }, body: { appendChild: noop }, documentElement: { appendChild: noop }
  },
  setTimeout, clearTimeout, setInterval: () => 1, clearInterval: noop,
  getPatients: () => patients,
  findPatient: id => patients.find(p => p.id === id) || null,
  upsertPatient(p) { const i = patients.findIndex(x => x.id === p.id); if (i >= 0) patients[i] = p; else patients.push(p); },
  activePatient: () => patients[0] || null,
  aiCallRaw: () => Promise.resolve('')
};
context.window = context;
vm.runInNewContext(modelSource, context, { filename: 'visit-model.js' });
const M = context.__mlsVisitModel;
assert(M && typeof M.organizePatientHistory === 'function', 'the visit model did not install');

const CHART_PROBLEMS = [
  'Spinal stenosis, lumbar region, with neurogenic claudication (M48.062)',
  'Intervertebral disc degeneration, lumbosacral region (M51.37)',
  'Radiculopathy, lumbosacral region (M54.17)',
  'Sacroiliitis, not elsewhere classified (M46.1)',
  'Cervicalgia (M54.2)',
  'Chronic pain syndrome (G89.4)',
  'Osteoarthritis of spine, cervical region (M47.812)',
  'Compression fracture of T12 vertebra, initial encounter (S22.080A)',
  'Long term (current) use of opiate analgesic (Z79.891)',
  'Muscle spasm of back (M62.830)',
  'Post-laminectomy syndrome, not elsewhere classified (M96.1)',
  'Obesity, unspecified (E66.9)'
];
const rowsOf = value => String(value || '').split(/[\r\n;]+/).map(x => x.trim()).filter(Boolean);
const snapshotOf = () => ({ problems: CHART_PROBLEMS.slice(), meds: [], allergies: [], history: {}, vitals: {} });

function seed(coverage) {
  patients = [{
    id: 'p1', name: 'Ada Lovelace', dob: '12/10/1815',
    problems: CHART_PROBLEMS.join('; '), meds: '', allergies: '', visits: [],
    athenaProfileCoverage: coverage,
    athenaChartSnapshot: snapshotOf(),
    athenaHistoryFactsSnapshot: { problems: CHART_PROBLEMS.slice(), meds: [], allergies: [], history: {}, vitals: {} }
  }];
  return patients[0];
}
function addAssessmentVisit() {
  M.addVisit('p1', {
    date: '2026-07-01', type: 'Office visit',
    raw: ['Assessment:'].concat(CHART_PROBLEMS.slice(0, 6)).concat(['Plan: continue the current regimen.']).join('\n')
  }, { source: 'manual', persist: true });
}
function assertAllHeld(label) {
  const held = rowsOf(patients[0].problems);
  const lost = CHART_PROBLEMS.filter(x => held.indexOf(x) < 0);
  assert.strictEqual(lost.length, 0, label + ': organizePatientHistory deleted ' + lost.length + ' chart problem(s) it never re-read: ' + JSON.stringify(lost));
}

/* 1. receipt absent + a visit naming six of the twelve. The other six must survive. */
seed(null); addAssessmentVisit();
M.organizePatientHistory('p1');
assertAllHeld('receipt absent, six-problem visit assessment');

/* 2. receipt absent and NO visit at all - the field must not be emptied. */
seed(null);
M.organizePatientHistory('p1');
assertAllHeld('receipt absent, no visits');
assert(rowsOf(patients[0].problems).length > 0, 'receipt absent, no visits: the problem list was wiped to empty');

/* 3. receipt bound to a DIFFERENT patient id (stale carry-forward). */
seed({ complete: true, exactIdentityVerified: true, patientId: 'someone-else', cards: {} });
M.organizePatientHistory('p1');
assertAllHeld('receipt bound to another patient');

/* 4. the Athena snapshot itself is gone. */
seed({ complete: true, exactIdentityVerified: true, patientId: 'p1', cards: {} });
delete patients[0].athenaChartSnapshot;
M.organizePatientHistory('p1');
assertAllHeld('snapshot missing');

/* 5. CONTROL - an intact receipt still replaces its own stale Athena slice, so
      the fix above did not turn stale clinical data into a permanent resident. */
patients = [{
  id: 'p1', name: 'Ada Lovelace', dob: '12/10/1815',
  problems: 'STALE ATHENA PROBLEM; Clinician typed this one', meds: '', allergies: '', visits: [],
  athenaProfileCoverage: { complete: true, exactIdentityVerified: true, patientId: 'p1', cards: {} },
  athenaChartSnapshot: { problems: ['Cervicalgia (M54.2)'], meds: [], allergies: [], history: {}, vitals: {} },
  athenaHistoryFactsSnapshot: { problems: ['STALE ATHENA PROBLEM'], meds: [], allergies: [], history: {}, vitals: {} }
}];
M.organizePatientHistory('p1');
const control = rowsOf(patients[0].problems);
assert(control.indexOf('STALE ATHENA PROBLEM') < 0, 'control: a re-read Athena slice stopped replacing its own stale fact');
assert(control.indexOf('Clinician typed this one') >= 0, 'control: a clinician-authored fact was removed');
assert(control.indexOf('Cervicalgia (M54.2)') >= 0, 'control: the freshly read Athena fact did not land');

console.log('organize-history-never-strips-an-unread-slice: OK');
