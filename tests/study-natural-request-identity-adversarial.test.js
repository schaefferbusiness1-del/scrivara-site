'use strict';

const assert = require('assert');
const path = require('path');
const study = require(path.join(__dirname, '..', 'feat_mls_study_request.js'));

const SAME_NAME = 'Alex Same';
const SAME_DOB = '1975-04-05';
const records = study.collectStoredRecords({
  getPatients() {
    return [
      {
        id: 'shared-ref', name: SAME_NAME, dob: SAME_DOB,
        visits: [{ date: '2026-01-01', type: 'Patient one', detail: 'P1-DIRECT' }]
      },
      {
        id: 'patient-two', athenaId: 'shared-ref', name: SAME_NAME, dob: SAME_DOB,
        visits: [{ date: '2026-02-01', type: 'Patient two', detail: 'P2-DIRECT' }]
      }
    ];
  },
  getNotes() {
    return [
      { patientId: 'shared-ref', date: '2026-01-02', cc: 'P1 note', text: 'P1-ID-BOUND' },
      { patientId: 'patient-two', date: '2026-02-02', cc: 'P2 note', text: 'P2-ID-BOUND' },
      { patientName: SAME_NAME, dob: SAME_DOB, date: '2026-03-01', cc: 'Ambiguous note', text: 'MUST-NOT-ATTACH' },
      { patientName: SAME_NAME, date: '2026-03-02', cc: 'Name only', text: 'NAME-ONLY-MUST-NOT-ATTACH' }
    ];
  },
  _calAppts: [
    { patientId: 'patient-two', name: SAME_NAME, dob: SAME_DOB, appt_date: '2026-02-03', appt_type: 'P2 appointment', reason: 'P2-APPT' }
  ],
  sgFix: {
    buildAll() {
      /* A derived row cannot be assigned when two real records share the exact
         same demographics. It must be skipped instead of cross-contaminating. */
      return [{
        name: SAME_NAME, dob: SAME_DOB, mrn: 'ambiguous-projection',
        visits: [{ date: '2026-03-03', type: 'Ambiguous harvester row', detail: 'HARVEST-MUST-NOT-ATTACH' }]
      }];
    }
  }
});

assert.strictEqual(records.patients.length, 2, 'namespace-distinct stable refs must preserve two patients');
assert.strictEqual(records.provenance.visits, 5);
assert.ok(records.provenance.ambiguousRecordsSkipped >= 3, 'ambiguous demographic, name-only, and harvester rows should be skipped');

const visitSets = records.patients.map((p) => p.visits.map((v) => v.detail).join('|'));
assert.ok(visitSets.some((s) => /P1-DIRECT/.test(s) && /P1-ID-BOUND/.test(s) && !/P2-/.test(s)));
assert.ok(visitSets.some((s) => /P2-DIRECT/.test(s) && /P2-ID-BOUND/.test(s) && /P2-APPT/.test(s) && !/P1-/.test(s)));
assert.ok(!visitSets.some((s) => /MUST-NOT-ATTACH|NAME-ONLY-MUST-NOT-ATTACH|HARVEST-MUST-NOT-ATTACH/.test(s)));

const reusedId = study.collectStoredRecords({
  getPatients() {
    return [
      { id: 'reused-id', name: 'Alice Correct', dob: '1980-01-01', mrn: 'MRN-A', visits: [{ date: '2026-01-01', type: 'Alice visit', detail: 'ALICE-ONLY' }] },
      { id: 'reused-id', name: 'Bob Conflict', dob: '1990-02-02', mrn: 'MRN-B', visits: [{ date: '2026-02-02', type: 'Bob visit', detail: 'BOB-MUST-NOT-MERGE' }] }
    ];
  },
  getNotes() { return []; },
  _calAppts: [],
  sgFix: { buildAll() { return []; } }
});
assert.strictEqual(reusedId.patients.length, 1, 'a reused stable id with conflicting identity must be quarantined, not merged');
assert.strictEqual(reusedId.provenance.identityConflicts, 1);
assert.match(JSON.stringify(reusedId.patients), /ALICE-ONLY/);
assert.doesNotMatch(JSON.stringify(reusedId.patients), /Bob Conflict|BOB-MUST-NOT-MERGE/);

const contradictoryNamespace = study.collectStoredRecords({
  getPatients() {
    return [
      { id: 'A', athenaId: 'ATH-OLD', name: 'Stable Same', dob: '1988-08-08', visits: [{ date: '2026-01-01', type: 'first', detail: 'OLD-ATHENA' }] },
      { id: 'A', athenaId: 'ATH-NEW', name: 'Stable Same', dob: '1988-08-08', visits: [{ date: '2026-01-02', type: 'second', detail: 'NEW-ATHENA-MUST-NOT-MERGE' }] }
    ];
  },
  getNotes() { return []; }, _calAppts: [], sgFix: { buildAll() { return []; } }
});
assert.strictEqual(contradictoryNamespace.patients.length, 1);
assert.strictEqual(contradictoryNamespace.provenance.identityConflicts, 1);
assert.match(JSON.stringify(contradictoryNamespace.patients), /OLD-ATHENA/);
assert.doesNotMatch(JSON.stringify(contradictoryNamespace.patients), /NEW-ATHENA-MUST-NOT-MERGE/);

console.log('study-natural-request-identity-adversarial: ok');
