'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

assert(!/_pullAllHistories\s*\(\s*false\s*\)/.test(source), 'day pull must never call history with false');
for (const marker of [
  'historyTargets.push({',
  '_mlsTargetPatientId: patientId',
  '? await runHistoryBatch',
  'historyReceipt.exactIdentityVerified === true',
  'res.scheduleReceipt = r.receipt',
  'res.calendarReceipt = calendarReceipt',
  'res.historyReceipt = historyReceipt',
  'res.ok = complete; res.complete = complete',
  'r.receipt.authoritativeEmpty',
  'visits-full-detail-unproven',
  'r.receipt.stableKeysComplete !== true',
  'athena-chart-coverage',
  'mlsAppReadAllVisits'
]) assert(source.includes(marker), `missing history receipt invariant: ${marker}`);

const listeners = new Set();
const patient = { id: 'p-exact-1', name: 'Exact Patient', dob: '01/02/1960', visits: [] };
let assistReadCalls = 0;

const context = {
  console,
  Promise,
  Date,
  Math,
  JSON,
  Intl,
  Object,
  Array,
  String,
  Number,
  RegExp,
  encodeURIComponent,
  setTimeout,
  clearTimeout,
  setInterval: () => 1,
  clearInterval: () => {},
  location: { pathname: '/ScribeFlow-staging.html' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    readyState: 'complete',
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => {},
    body: {}, head: {}, documentElement: {}
  }
};
context.window = context;
context.addEventListener = (_type, fn) => listeners.add(fn);
context.removeEventListener = (_type, fn) => listeners.delete(fn);
context.postMessage = msg => {
  if (!msg || msg.type !== 'mlsAppReadAllVisits') return;
  queueMicrotask(() => {
    const event = { data: { source: 'mls-ext', type: 'mlsAppAllVisitsResult',
      ok: true,
      visits: [{ date: '2026-01-01', type: 'Office visit', raw: 'Verified old visit with substantive clinical detail for the regression.', fullDetail: true, sourceVisitKey: 'row:schedule-history-1' }],
      receipt: { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, stableKeysComplete: true, expected: 1, parsed: 1, cap: 500, readerVersion: '2.9.22-visits-r4-two-stage' },
      readerVersion: '2.9.22-visits-r4-two-stage',
      identity: { name: patient.name, dob: patient.dob, mrn: '' }
    } };
    Array.from(listeners).forEach(fn => fn(event));
  });
};
context.getPatients = () => [patient];
context._athenaHistoryTargetSnapshot = ref => ref && ref.patientId === patient.id
  ? { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: '' }
  : null;
context._hasImportedHistory = target => target && target.patientId === patient.id;
context._athenaHistoryProofMatches = (target, observed) => target.patientId === patient.id && observed.chartName === patient.name && observed.chartDob === patient.dob;
context._assistReadChart = () => {
  assistReadCalls++;
  const requestId = `chart-test-${assistReadCalls}`;
  const text = 'Verified chart problems medications allergies and clinical history';
  return Promise.resolve({
    text, requestId, chartName: patient.name, chartDob: patient.dob, chartMrn: '',
    coverageReceipt: {
      kind: 'athena-chart-coverage', complete: true, readerVersion: '2.9.19-chart-r3', identityObserved: true, truncated: false,
      requestId, capturedAt: Date.now(), expectedClinicalFrames: 1, readClinicalFrames: 1, boundClinicalFrames: 1,
      unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0, textChars: text.length
    }
  });
};
const profileCoverage = { complete: true, exactIdentityVerified: true, patientId: patient.id, cards: {
  problems: { status: 'found', populated: true }, meds: { status: 'found', populated: true }, allergies: { status: 'found', populated: true },
  summary: { status: 'found', populated: true }, vitals: { status: 'found', populated: true }, history: { status: 'found', populated: true }
} };
context._parsePatientChart = () => Promise.resolve({
  problems: 'Verified problem', meds: 'Verified med', allergies: 'Verified allergy', summary: 'Verified summary',
  vitals: { bp: '120/80' }, history: { pmh: 'Verified PMH' },
  coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
});
context._athenaChartProfileCoverage = () => profileCoverage;
context._athenaHistoryVerifiedRef = target => ({ patientId: target.patientId, name: target.name, dob: target.dob, verifiedName: target.name, verifiedDob: target.dob });
context._savePatientChart = () => { patient.athenaProfileCoverage = profileCoverage; return true; };
context._patientHistoryCardCoverage = () => patient.athenaProfileCoverage;
context.__mlsVisitModel = {
  addVisit: (_id, raw) => { patient.visits.push(raw); return raw; },
  getVisits: () => patient.visits,
  organizePatientHistory: () => ({ ok: true, verifiedVisits: patient.visits.length })
};
context.__mlsCopyVisits = {
  _saveVisits: (_p, _identity, visits) => { visits.forEach(v => patient.visits.push(v)); return visits.length; },
  _visitIdentityAgrees: () => true
};
context.loadPatients = () => {};
context.renderHistory = () => {};
context.renderProfile = () => {};

vm.runInNewContext(source, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
assert(context.__mlsSI && typeof context.__mlsSI._runHistoryBatch === 'function');

(async () => {
  const row = { patient_external_id: patient.id, _mlsTargetPatientId: patient.id, _mlsTargetDob: patient.dob, name: patient.name, dob: patient.dob };
  const receipt = await context.__mlsSI._runHistoryBatch([row], [], () => {});
  assert.strictEqual(receipt.complete, true);
  assert.strictEqual(receipt.requested, 1);
  assert.strictEqual(receipt.processed, 1);
  assert.strictEqual(receipt.retry.length, 0);
  assert.strictEqual(receipt.patients[0].patientId, patient.id);
  assert.strictEqual(receipt.patients[0].organized, true);
  assert.strictEqual(receipt.patients[0].visitsComplete, true);
  assert.strictEqual(receipt.patients[0].complete, true);
  assert.strictEqual(patient.visits.length, 1);
  assert.strictEqual(assistReadCalls, 1, 'a stale imported-history marker must not skip an explicit fresh chart read');
  assert.strictEqual(receipt.patients[0].chartCoverage.complete, true);
  assert.strictEqual(receipt.patients[0].visitsCoverageComplete, true);

  const partial = await context.__mlsSI._runHistoryBatch([], [{ patientId: 'p-unresolved', reason: 'missing-dob-mrn-proof' }], () => {});
  assert.strictEqual(partial.complete, false);
  assert.strictEqual(partial.reason, 'history-partial');
  assert.strictEqual(partial.retry[0].patientId, 'p-unresolved');

  console.log('PASS exact-patient awaited history and old-visits receipt pipeline');
})().catch(err => { console.error(err); process.exit(1); });
