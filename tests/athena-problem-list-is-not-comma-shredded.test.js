'use strict';

/* THE ATHENA PROBLEM LIST MUST REACH THE STORE WHOLE.

   _parsePatientChart asks the model for a SEMICOLON separated problem list and
   official ICD-10 wording is comma heavy, so both list splitters on the save
   path used to shred one problem into several rows. Measured on the production
   _savePatientChart with twelve real problems: four or five survived intact,
   seven or eight were stored truncated at their first comma, and four to nine
   orphan fragments ("unspecified", "lumbar region", "initial encounter") were
   stored AS PROBLEMS. Worse, the de-dupe keys on row text, so five problems
   ending in ", unspecified" collapsed onto ONE such row - four qualifiers
   deleted outright, inside our own pipeline, from data already in hand.

   This suite runs the REAL production function (no re-implementation) and pins:
     1. every problem reaches p.problems verbatim, one row each
     2. the Athena-owned snapshot holds exactly the parsed list
     3. no fragment of a problem name is ever stored as a problem of its own
     4. meds and allergies get the same protection
     5. a genuinely comma-only list still splits - the tolerance the old regex
        bought is preserved, not traded away
     6. ScribeFlow-staging.html behaves identically (a one-file edit here drifts
        silently past the parity suite, which only pins _savePatientChart) */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.env.MLS_TEST_ROOT ? path.resolve(process.env.MLS_TEST_ROOT) : path.resolve(__dirname, '..');

function between(source, begin, end, file) {
  const a = source.indexOf(begin);
  assert(a >= 0, file + ': missing source marker: ' + begin);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, file + ': missing source end marker: ' + end);
  return source.slice(a, b);
}

const clone = value => JSON.parse(JSON.stringify(value));

function buildContext(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const identity = between(src, 'function _athenaHistoryDigits(v)', '/* Like _assistReadAthenaTab', file);
  const save = between(src, 'function _athenaChartHistoryObject(chart)', '/* Bulk: after pulling the schedule', file);
  const state = { patients: [{ id: 'p1', name: 'Ada Lovelace', dob: '12/10/1815', mrn: '9001', problems: '', meds: '', allergies: '', summary: '' }], notes: [] };
  const context = {
    console, Date, Math, JSON, Object, String, Number, Array, RegExp,
    getPatients() { return clone(state.patients); },
    upsertPatient(p) { const i = state.patients.findIndex(x => x.id === p.id); if (i >= 0) state.patients[i] = clone(p); else state.patients.push(clone(p)); },
    getNotes() { return clone(state.notes); },
    saveNotes(next) { state.notes = clone(next); }
  };
  context.window = context;
  vm.runInNewContext(identity + '\n' + save, context, { filename: file + '-chart-save-slice.js' });
  assert.strictEqual(typeof context._savePatientChart, 'function', file + ': _savePatientChart did not load');
  return { context, state, file };
}

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

const REF = {
  patientId: 'p1', name: 'Ada Lovelace', dob: '12/10/1815', mrn: '9001',
  verifiedName: 'Ada Lovelace', verifiedDob: '12/10/1815', verifiedMrn: '9001'
};

/* Real athenaOne / ICD-10 wording. Every comma below is INSIDE one diagnosis. */
const PROBLEMS = [
  'Spinal stenosis, lumbar region, with neurogenic claudication (M48.062)',
  'Intervertebral disc degeneration, lumbosacral region (M51.37)',
  'Radiculopathy, lumbosacral region (M54.17)',
  'Sacroiliitis, not elsewhere classified (M46.1)',
  'Unspecified rotator cuff tear or rupture of right shoulder, not specified as traumatic (M75.101)',
  'Cervicalgia (M54.2)',
  'Chronic pain syndrome (G89.4)',
  'Osteoarthritis of spine, cervical region (M47.812)',
  'Compression fracture of T12 vertebra, initial encounter (S22.080A)',
  'Long term (current) use of opiate analgesic (Z79.891)',
  'Muscle spasm of back (M62.830)',
  'Post-laminectomy syndrome, not elsewhere classified (M96.1)'
];
const MEDS = [
  'gabapentin 300 mg capsule, take 1 capsule by mouth three times daily',
  'duloxetine 60 mg capsule, delayed release, once daily',
  'meloxicam 15 mg tablet, once daily with food'
];
const ALLERGIES = ['Penicillin, rash', 'Codeine, nausea and vomiting'];

function rowsOf(value) { return String(value || '').split(/[\r\n;]+/).map(x => x.trim()).filter(Boolean); }

[ 'ScribeFlow.html', 'ScribeFlow-staging.html' ].forEach(file => {
  const { context, state } = buildContext(file);

  assert.strictEqual(context._savePatientChart(Object.assign({ requestId: 'op-1' }, REF), null, covered({
    problems: PROBLEMS.join('; '), meds: MEDS.join('; '), allergies: ALLERGIES.join('; '),
    summary: 'Chronic axial and radicular low back pain under interventional management.',
    vitals: { bp: '128/78', hr: '70', takenAt: '2026-07-28' },
    history: { pmh: 'Lumbar fusion 2019' }, visits: ['07/01/2026 - Follow-up, lumbar ESI']
  })), true, file + ': the verified chart save was refused');

  const p = state.patients.find(x => x.id === 'p1');
  const stored = rowsOf(p.problems);

  PROBLEMS.forEach(problem => {
    assert(stored.indexOf(problem) >= 0,
      file + ': the problem list lost or truncated "' + problem + '" - stored rows were: ' + JSON.stringify(stored));
  });

  /* A fragment of a diagnosis is not a diagnosis. If any row is a strict
     substring of one of the real problems, the value was split inside a name. */
  stored.forEach(row => {
    const isWholeProblem = PROBLEMS.indexOf(row) >= 0;
    const isFragment = !isWholeProblem && PROBLEMS.some(problem => problem.indexOf(row) >= 0);
    assert(!isFragment, file + ': "' + row + '" is a fragment of a problem name and was stored as a problem of its own');
  });

  assert.deepStrictEqual(p.athenaChartSnapshot.problems, PROBLEMS,
    file + ': the Athena-owned snapshot does not hold the parsed problem list exactly');
  assert.deepStrictEqual(p.athenaChartSnapshot.meds, MEDS,
    file + ': the Athena-owned snapshot does not hold the parsed medication list exactly');
  assert.deepStrictEqual(p.athenaChartSnapshot.allergies, ALLERGIES,
    file + ': the Athena-owned snapshot does not hold the parsed allergy list exactly');

  MEDS.forEach(med => assert(rowsOf(p.meds).indexOf(med) >= 0, file + ': the medication list lost or truncated "' + med + '"'));
  ALLERGIES.forEach(a => assert(rowsOf(p.allergies).indexOf(a) >= 0, file + ': the allergy list lost or truncated "' + a + '"'));

  /* The comma tolerance the old regex bought must SURVIVE: when the value
     carries no semicolon and no newline, a comma is still the separator. */
  const commaOnly = buildContext(file);
  assert.strictEqual(commaOnly.context._savePatientChart(Object.assign({ requestId: 'op-2' }, REF), null, covered({
    problems: 'Cervicalgia, Chronic pain syndrome, Muscle spasm of back',
    meds: 'meloxicam, gabapentin', allergies: 'Penicillin',
    summary: 'Comma separated list from Athena.',
    vitals: { bp: '120/70' }, history: { pmh: 'None documented elsewhere' }, visits: []
  })), true, file + ': the comma-separated chart save was refused');
  const commaPatient = commaOnly.state.patients.find(x => x.id === 'p1');
  assert.deepStrictEqual(commaPatient.athenaChartSnapshot.problems,
    ['Cervicalgia', 'Chronic pain syndrome', 'Muscle spasm of back'],
    file + ': a genuinely comma-separated problem list stopped splitting');

  /* CASE 3 - a NEWLINE-separated list that also contains commas. The value already
     declares its separator, so every comma is clinical text and must survive. This is
     the case a future simplification of the predicate to /;/ would silently break, and
     it is the one that would bring back the orphan fragments. */
  const nlCommas = buildContext(file);
  assert.strictEqual(nlCommas.context._savePatientChart(Object.assign({ requestId: 'op-3' }, REF), null, covered({
    problems: 'Spinal stenosis, lumbar region, with neurogenic claudication (M48.062)\n' +
              'Radiculopathy, lumbar region (M54.16)\n' +
              'Osteoarthritis of spine, unspecified',
    meds: 'meloxicam 15 mg, once daily', allergies: 'Penicillin',
    summary: 'Newline separated list that also contains clinical commas.',
    vitals: { bp: '120/70' }, history: { pmh: 'None documented elsewhere' }, visits: []
  })), true, file + ': the newline-separated chart save was refused');
  const nlPatient = nlCommas.state.patients.find(x => x.id === 'p1');
  assert.deepStrictEqual(nlPatient.athenaChartSnapshot.problems, [
    'Spinal stenosis, lumbar region, with neurogenic claudication (M48.062)',
    'Radiculopathy, lumbar region (M54.16)',
    'Osteoarthritis of spine, unspecified'
  ], file + ': a NEWLINE-separated list had its clinical commas treated as separators - ' +
     'the value already declared a separator, so every comma in it is chart text');

  /* DIRECT contract on the predicate itself. The three cases above reach it only
     through _savePatientChart, so a refactor could relocate it and still pass. */
  const splitRe = nlCommas.context._athenaListSplitRe;
  assert.strictEqual(typeof splitRe, 'function', file + ': _athenaListSplitRe did not load');
  assert.strictEqual('A, B, C'.split(splitRe('A, B, C')).length, 3,
    file + ': commas MUST separate when the value declares no other separator');
  assert.strictEqual('A, B; C'.split(splitRe('A, B; C')).length, 2,
    file + ': a semicolon in the value means commas are clinical text');
  assert.strictEqual('A, B\nC'.split(splitRe('A, B\nC')).length, 2,
    file + ': a NEWLINE in the value means commas are clinical text');
  assert.strictEqual('A, B\r\nC'.split(splitRe('A, B\r\nC')).length, 2,
    file + ': a CRLF in the value means commas are clinical text');
});

console.log('athena-problem-list-is-not-comma-shredded: OK');
