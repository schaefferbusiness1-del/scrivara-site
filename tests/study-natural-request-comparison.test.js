'use strict';

const assert = require('assert');
const path = require('path');
const study = require(path.join(__dirname, '..', 'feat_mls_study_request.js'));

const spec = study.parseStudySpec('Compare patients with lumbar injections versus epidural injections, all time');
assert.strictEqual(spec.ok, true);
assert.strictEqual(spec.studyType, 'procedure');
assert.deepStrictEqual(spec.cohort.keywords, ['lumbar injections', 'epidural injections']);

const records = {
  provenance: { sources: { test: 5 }, duplicateVisitsRemoved: 0 },
  patients: [
    { name: 'Lumbar Only', dob: '1970-01-01', mrn: '', _chartText: '', visits: [
      { date: '2026-01-01', type: 'Lumbar injection', detail: 'L-spine injection completed; pain 8/10', source: 'test' },
      { date: '2026-03-01', type: 'Follow-up', detail: 'pain 4/10', source: 'test' }
    ] },
    { name: 'Epidural Only', dob: '1971-01-01', mrn: '', _chartText: '', visits: [
      { date: '2026-01-02', type: 'ESI procedure', detail: 'Epidural steroid shot completed; pain 6/10', source: 'test' },
      { date: '2026-04-02', type: 'Follow-up', detail: 'pain 5/10', source: 'test' }
    ] },
    { name: 'Overlap', dob: '1972-01-01', mrn: '', _chartText: '', visits: [
      { date: '2026-01-03', type: 'Lumbar injection', detail: 'lumbar injection', source: 'test' },
      { date: '2026-02-03', type: 'Epidural injection', detail: 'epidural injection', source: 'test' }
    ] },
    { name: 'Unrelated', dob: '1973-01-01', mrn: '', _chartText: '', visits: [{ date: '2026-01-04', type: 'Office visit', detail: 'unrelated', source: 'test' }] }
  ]
};

const scoped = study.applyScope(records, spec, new Date('2026-07-16T12:00:00Z'));
assert.strictEqual(scoped.patientCount, 3, 'the comparison cohort is the union of both procedure terms');
const deidentified = study.deidentifyPatients(scoped.patients);
const model = study.buildReportModel(spec, deidentified, { scope: scoped.scope, resolvedCohort: 'comparison test' });
assert.ok(model.comparison && model.comparison.mutuallyExclusive);
assert.strictEqual(model.comparison.groups[0].label, 'lumbar injections');
assert.strictEqual(model.comparison.groups[0].patientCount, 1);
assert.strictEqual(model.comparison.groups[0].matchingVisitCount, 1);
assert.strictEqual(model.comparison.groups[0].meanIncludedVisitsPerPatient, 2);
assert.strictEqual(model.comparison.groups[0].documentedPainScoreCount, 2);
assert.strictEqual(model.comparison.groups[0].meanDocumentedPainScore, 6);
assert.strictEqual(model.comparison.groups[0].pairedPainPatientCount, 1);
assert.strictEqual(model.comparison.groups[0].meanFirstToLastPainChange, -4);
assert.strictEqual(model.comparison.groups[1].label, 'epidural injections');
assert.strictEqual(model.comparison.groups[1].patientCount, 1);
assert.strictEqual(model.comparison.groups[1].matchingVisitCount, 1);
assert.strictEqual(model.comparison.groups[1].meanIncludedVisitsPerPatient, 2);
assert.strictEqual(model.comparison.groups[1].documentedPainScoreCount, 2);
assert.strictEqual(model.comparison.groups[1].meanDocumentedPainScore, 5.5);
assert.strictEqual(model.comparison.groups[1].pairedPainPatientCount, 1);
assert.strictEqual(model.comparison.groups[1].meanFirstToLastPainChange, -1);
assert.strictEqual(model.comparison.overlapPatients, 1, 'patients in both groups must not be counted in either arm');
assert.strictEqual(model.comparison.unmatchedPatients, 0);
/* sr-2.1.0 presents the mutually exclusive arms as a structured table
   instead of prose. Assert the same facts against the table rows. */
const comparisonSection = model.sections.find(s => s.key === 'comparison');
assert(comparisonSection && comparisonSection.table, 'comparison arms table is missing');
const armRows = comparisonSection.table.rows;
const lumbarRow = armRows.find(r => r[0] === 'lumbar injections');
const epiduralRow = armRows.find(r => r[0] === 'epidural injections');
assert(lumbarRow && lumbarRow[1] === '1' && lumbarRow[2] === '1', 'lumbar arm must show 1 mutually exclusive patient and 1 matching visit');
assert(epiduralRow && epiduralRow[1] === '1' && epiduralRow[2] === '1', 'epidural arm must show 1 mutually exclusive patient and 1 matching visit');
assert.strictEqual(lumbarRow[4], '6.0', 'lumbar arm mean documented pain must be 6.0');
assert.match(lumbarRow[5], /^-4\.0/, 'lumbar arm first-to-last pain change must be -4.0');
assert.strictEqual(epiduralRow[4], '5.5', 'epidural arm mean documented pain must be 5.5');
assert.match(epiduralRow[5], /^-1\.0/, 'epidural arm first-to-last pain change must be -1.0');
assert.match(JSON.stringify(model.sections), /Overlap excluded: 1 patients/, 'both-group patients must be disclosed and excluded');
assert.match(JSON.stringify(model.sections), /do not establish comparative effectiveness or causation/i);

console.log('study-natural-request-comparison: ok');
