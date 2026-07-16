'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const asset = path.join(__dirname, '..', 'feat_mls_study_request.js');
const study = require(asset);

const env = {
  getPatients() {
    return [{
      id: 'pt-1', name: 'Jane Example', dob: '1980-02-03', mrn: 'MRN-7788',
      visits: [{
        date: '2026-06-10', type: 'Lumbar injection', source: 'patient-record',
        detail: 'Jane Example DOB 1980-02-03 MRN MRN-7788 pain 8/10 jane@example.com 317-555-1212'
      }]
    }];
  },
  getNotes() {
    return [
      { patientId: 'pt-1', date: '2026-06-10', cc: 'Lumbar injection', text: 'Jane Example DOB 1980-02-03 MRN MRN-7788 pain 8/10 jane@example.com 317-555-1212' },
      { patientId: 'pt-1', date: '2024-01-01', cc: 'Old follow-up', text: 'Historical record, pain 9/10' }
    ];
  },
  _calAppts: [{ patientId: 'pt-1', name: 'Jane Example', dob: '1980-02-03', appt_date: '2026-06-20', appt_type: 'Follow-up', reason: 'post injection', status: 'complete' }],
  sgFix: {
    buildAll() {
      return [{
        name: 'Jane Example', dob: '1980-02-03', mrn: 'MRN-7788',
        visits: [
          { date: '2026-06-10', type: 'Lumbar injection', source: 'patient-record', detail: 'Jane Example DOB 1980-02-03 MRN MRN-7788 pain 8/10 jane@example.com 317-555-1212' },
          { date: '2026-06-12', type: 'Athena follow-up', source: 'athena-visit', detail: 'Jane Example improved; pain 4/10' }
        ]
      }];
    }
  }
};

const records = study.collectStoredRecords(env);
assert.strictEqual(records.patients.length, 1);
assert.strictEqual(records.provenance.visits, 4, 'p.visits, harvester, note, and calendar evidence should merge');
assert.ok(records.provenance.duplicateVisitsRemoved >= 2, 'same visit from direct/harvest/note sources must dedupe');
assert.deepStrictEqual(
  records.patients[0].visits.map((v) => v.date),
  ['2024-01-01', '2026-06-10', '2026-06-12', '2026-06-20']
);

const spec = study.parseStudySpec(
  'Study outcomes for patients who received lumbar injections from 2026-06-01 through 2026-06-30, 30 pages'
);
const scoped = study.applyScope(records, spec, new Date('2026-07-16T12:00:00Z'));
assert.strictEqual(scoped.patientCount, 1);
assert.strictEqual(scoped.visitCount, 3, 'the exact date StudySpec must change the engine-bound evidence');
assert.strictEqual(scoped.scope.excludedOutOfRange, 1);

const deidentified = study.deidentifyPatients(scoped.patients);
const deidText = JSON.stringify(deidentified);
assert.ok(!/Jane Example/i.test(deidText));
assert.ok(!/1980-02-03/.test(deidText));
assert.ok(!/MRN-7788/i.test(deidText));
assert.ok(!/jane@example\.com/i.test(deidText));
assert.ok(!/317-555-1212/.test(deidText));
assert.strictEqual(deidentified[0].name, 'P001');
assert.strictEqual(deidentified[0].dob, '');
assert.strictEqual(deidentified[0].mrn, '');

const reportSpec = Object.assign({}, spec, {
  originalQuery: spec.originalQuery + ' for Jane Example MRN MRN-7788',
  question: spec.question + ' for Jane Example MRN MRN-7788'
});
const model = study.buildReportModel(reportSpec, deidentified, {
  scope: scoped.scope,
  resolvedCohort: 'Records matching lumbar injections',
  duplicateVisitsRemoved: records.provenance.duplicateVisitsRemoved,
  identities: records.patients
});
const reportText = JSON.stringify(model);
assert.strictEqual(model.deidentified, false);
assert.strictEqual(model.privacyMode, 'direct-identifiers-removed-limited-data-draft');
assert.match(model.privacyWarning, /limited-data study draft requiring clinician and privacy review/i);
assert.strictEqual(model.patientCount, 1);
assert.strictEqual(model.visitCount, 3);
assert.ok(model.supportedPageCeiling < 30, 'small evidence must not be padded to 30 pages');
assert.ok(model.supportedPageCeiling >= 3);
assert.ok(model.sections.some((s) => s.heading === 'Data quality and limitations'));
assert.ok(model.sections.some((s) => s.heading === 'Methods and provenance'));
assert.ok(!/Jane Example/i.test(reportText));
assert.ok(!/MRN-7788/i.test(reportText));

const source = fs.readFileSync(asset, 'utf8');
assert.match(source, /root\.__mlsSgFix/);
assert.match(source, /root\.__mlsStudyGroups/);
assert.match(source, /sg\.analyze\(inMemoryGroup\)/);
assert.match(source, /sg\.chartSVG\(analysis\)/);
assert.doesNotMatch(source, /sg\.createGroup\s*\(/, 'natural-language runs must never persist a temporary group');
assert.doesNotMatch(source, /sg\.addPatient\s*\(/, 'natural-language runs must not serialize once per patient');
assert.doesNotMatch(source, /sg\.runStudy\s*\(/, 'natural-language runs use the pure in-memory analyzer, not the persisted group runner');
assert.doesNotMatch(source, /sgRef\.deleteGroup\s*\(/, 'there should be no crash-prone temp group cleanup path');
assert.match(source, /typeof root\.loadJsPdf === 'function'/, 'study reports should reuse the app\'s one shared PDF loader');
assert.match(source, /pdf-loader-timeout/);
assert.doesNotMatch(source, /env\.sgFix\s*=/, 'record collection must not mutate the shared window namespace');
assert.match(source, /if \(uiRunPromise\)/, 'Enter presses must not start duplicate concurrent study jobs');
assert.match(source, /Press Enter - no setup steps required/);
assert.match(source, /MutationObserver/);
assert.doesNotMatch(source, /setInterval\s*\(/, 'asset must have no permanent polling loop');
assert.match(source, /Advanced options and named cohorts/);

class FakeJsPDF {
  constructor() {
    this.pages = 1;
    this.internal = { pageSize: { getWidth: () => 612, getHeight: () => 792 } };
  }
  setTextColor() {}
  setFontSize() {}
  setFont() {}
  text() {}
  splitTextToSize(value) {
    const text = String(value);
    const lines = [];
    for (let i = 0; i < text.length; i += 85) lines.push(text.slice(i, i + 85));
    return lines.length ? lines : [''];
  }
  addPage() { this.pages += 1; }
  getNumberOfPages() { return this.pages; }
  setPage() {}
  output() { return new Blob(['fake-pdf'], { type: 'application/pdf' }); }
}

(async () => {
  let analyzedGroup = null;
  let persistenceCalls = 0;
  const sg = {
    __live: true,
    analyze(group) {
      analyzedGroup = group;
      const allVisits = group.patients.flatMap((p) => p.visits.map((v) => ({ pt: p, v })));
      return { patientCount: group.patients.length, visitCount: allVisits.length, patients: group.patients, allVisits, months: [], byMonth: {}, byType: {}, pain: [], avgVisits: allVisits.length / group.patients.length };
    },
    chartSVG() { return '<svg></svg>'; },
    createGroup() { persistenceCalls += 1; throw new Error('must not persist'); },
    addPatient() { persistenceCalls += 1; throw new Error('must not persist'); },
    runStudy() { persistenceCalls += 1; throw new Error('must not persist'); },
    deleteGroup() { persistenceCalls += 1; throw new Error('must not persist'); },
    get() { return null; }
  };
  const controls = {
    sgpType: { value: '', dispatchEvent() {} },
    sgpRange: { value: '', options: [{ value: 'all' }], appendChild(o) { this.options.push(o); } },
    sgpCustomTx: { value: '' }
  };
  const doc = {
    getElementById(id) { return controls[id] || null; },
    createElement() { return { value: '', textContent: '' }; }
  };
  const result = await study.executeSpec(spec, {
    sg,
    records,
    document: doc,
    now: new Date('2026-07-16T12:00:00Z'),
    jsPDF: FakeJsPDF
  });
  assert.strictEqual(persistenceCalls, 0, 'the detailed path must remain entirely in memory');
  assert.strictEqual(analyzedGroup.id, 'in-memory-only');
  assert.strictEqual(controls.sgpType.value, 'outcomes', 'StudySpec type must reach the existing engine controls');
  assert.strictEqual(analyzedGroup.patients.length, 1);
  assert.strictEqual(analyzedGroup.patients[0].name, 'P001');
  assert.strictEqual(analyzedGroup.patients[0].dob, '');
  assert.strictEqual(analyzedGroup.patients[0].mrn, '');
  assert.strictEqual(analyzedGroup.patients[0].visits.length, 3, 'date-scoped evidence must be what the engine receives');
  assert.ok(!/Jane Example|1980-02-03|MRN-7788/i.test(JSON.stringify(analyzedGroup)));
  assert.ok(result.pdfBlob instanceof Blob);
  assert.ok(result.pdfPages >= 2 && result.pdfPages <= result.supportedPageCeiling);
  assert.strictEqual(result.xlsxFallback, true, 'the in-memory path returns a correctly labeled limited-data CSV');
  const csv = await result.xlsxBlob.text();
  assert.match(csv, /2026-06/);
  assert.doesNotMatch(csv, /2026-06-(?:01|10|12|20|30)/, 'exported visit dates and range must use month precision');
  assert.match(csv, /limited-data study draft requiring clinician and privacy review/i);
  assert.ok(!/Jane Example|1980-02-03|MRN-7788/i.test(csv));
  assert.match(result.svg, /2026-06/);
  assert.doesNotMatch(result.svg, /2026-06-(?:01|30)/);
  assert.doesNotMatch(result.svg, /all time/i);
  assert.ok(!/Jane Example|1980-02-03|MRN-7788/i.test(JSON.stringify(result)), 'the stable result API must also remove common direct identifiers');
  console.log('study-natural-request-report: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
