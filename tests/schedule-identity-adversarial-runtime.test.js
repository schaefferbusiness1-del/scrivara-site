'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

const listeners = new Set();
const store = new Map();
const patients = [
  { id: 'local-a', name: 'Alex Same', dob: '01/02/1970', mrn: 'MRN-A', visits: [] },
  { id: 'local-b', name: 'Alex Same', dob: '03/04/1980', mrn: 'MRN-B', visits: [] },
  { id: 'local-partial', name: 'Partial Patient', dob: '', mrn: '', visits: [] }
];
let backendRows = [];
const postedBodies = [];
const mutations = [];
let assistMode = 'missing-coverage';
let assistCalls = 0;
let chartSaves = 0;

const context = {
  console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
  encodeURIComponent, queueMicrotask,
  setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
  location: { pathname: '/ScribeFlow-staging.html' },
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: key => store.delete(key)
  },
  document: {
    readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
    getElementById: () => null, addEventListener: () => {}, body: {}, head: {}, documentElement: {}
  },
  backendMode: () => true,
  bkToken: () => 'test-token',
  bkBase: () => 'https://local.invalid',
  uns: key => `identity-test::${key}`,
  _normDate: value => String(value || '').slice(0, 10),
  _normTime: value => {
    const s = String(value || '').trim();
    const m = s.match(/(?:T)?(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
    if (!m) return '';
    let hour = Number(m[1]);
    if (m[3] && /PM/i.test(m[3]) && hour < 12) hour += 12;
    if (m[3] && /AM/i.test(m[3]) && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${m[2]}`;
  },
  _acctWallToUtcIso: (date, time) => `${date}T${time}:00.000Z`,
  getPatients: () => patients,
  upsertPatient: patient => {
    const i = patients.findIndex(p => p.id === patient.id);
    if (i >= 0) patients[i] = patient; else patients.push(patient);
  },
  loadCalendar: () => Promise.resolve(),
  renderHistory: () => {}, loadPatients: () => {},
  _calAppts: [],
  fetch: async (url, init) => {
    if (!init || !init.method) return { ok: true, json: async () => ({ appointments: backendRows }) };
    const body = JSON.parse(init.body || '{}');
    postedBodies.push(body);
    const update = String(url).match(/\/api\/appointments\/([^/]+)\/update$/);
    if (update) {
      const row = backendRows.find(one => String(one.id) === decodeURIComponent(update[1]));
      if (row) Object.assign(row, body);
      mutations.push({ kind: 'update', id: decodeURIComponent(update[1]), body });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    const id = `backend-created-${postedBodies.length}`;
    backendRows.push(Object.assign({ id }, body));
    mutations.push({ kind: 'create', id, body });
    return { ok: true, status: 200, json: async () => ({ id }) };
  }
};
context.window = context;
context.addEventListener = (_type, fn) => listeners.add(fn);
context.removeEventListener = (_type, fn) => listeners.delete(fn);
context.postMessage = msg => {
  if (!msg || msg.type !== 'mlsAppReadAllVisits') return;
  queueMicrotask(() => {
    const target = patients.find(p => (msg.hint.athenaId && p.mrn === msg.hint.athenaId) || (p.name === msg.hint.name && p.dob === msg.hint.dob));
    assert(target, 'history request must carry Athena MRN or name+DOB, never rely on a local patient ID');
    const event = { data: {
      source: 'mls-ext', type: 'mlsAppAllVisitsResult', ok: true,
      identity: { name: target.name, dob: target.dob, mrn: target.mrn },
      visits: [{ date: '2026-01-01', type: 'Office visit', raw: 'A substantive verified encounter body used only by this regression test.', patientName: target.name, patientDob: target.dob, patientMrn: target.mrn, fullDetail: true, sourceVisitKey: 'row:schedule-identity-1' }],
      receipt: { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, stableKeysComplete: true, expected: 1, parsed: 1, cap: 500, readerVersion: '2.9.22-visits-r4-two-stage' },
      readerVersion: '2.9.22-visits-r4-two-stage'
    } };
    Array.from(listeners).forEach(fn => fn(event));
  });
};
context._athenaHistoryTargetSnapshot = ref => {
  const p = patients.find(one => one.id === ref.patientId);
  return p ? { patientId: p.id, name: p.name, dob: p.dob, mrn: p.mrn } : null;
};
context._athenaHistoryProofMatches = (target, observed) =>
  target.patientId && observed.chartName === target.name &&
  (observed.chartMrn === target.mrn || observed.chartDob === target.dob);
context._athenaHistoryVerifiedRef = (target, observed) =>
  context._athenaHistoryProofMatches(target, observed)
    ? { patientId: target.patientId, name: target.name, dob: target.dob, mrn: target.mrn,
        verifiedName: observed.chartName, verifiedDob: observed.chartDob, verifiedMrn: observed.chartMrn }
    : null;
context._hasImportedHistory = () => true; // deliberately stale legacy marker
context._parsePatientChart = () => Promise.resolve({
  problems: 'Verified problem', meds: 'Verified med', allergies: 'Verified allergy', summary: 'Verified summary',
  vitals: { bp: '120/80' }, history: { pmh: 'Verified PMH' },
  coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
});
context._athenaChartProfileCoverage = () => ({ complete: true });
context._savePatientChart = ref => {
  chartSaves++;
  const p = patients.find(one => one.id === ref.patientId);
  p.athenaProfileCoverage = { complete: true, exactIdentityVerified: true, patientId: p.id, cards: {
    problems: { populated: true }, meds: { populated: true }, allergies: { populated: true }, summary: { populated: true }, vitals: { populated: true }, history: { populated: true }
  } };
  return true;
};
context._patientHistoryCardCoverage = id => (patients.find(p => p.id === id) || {}).athenaProfileCoverage || null;
context._assistReadChart = target => {
  assistCalls++;
  const text = 'Verified problems medications allergies and longitudinal clinical history';
  const requestId = `chart-${assistCalls}`;
  const base = { text, requestId, chartName: target.name, chartDob: target.dob, chartMrn: target.mrn };
  if (assistMode === 'missing-coverage') return Promise.resolve(base);
  base.coverageReceipt = {
    kind: 'athena-chart-coverage', complete: true, readerVersion: '2.9.19-chart-r3', identityObserved: true, truncated: false,
    requestId, capturedAt: Date.now(), expectedClinicalFrames: 2, readClinicalFrames: 2, boundClinicalFrames: 2,
    unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0, textChars: text.length
  };
  return Promise.resolve(base);
};
context.__mlsVisitModel = {
  addVisit: (id, raw) => { patients.find(p => p.id === id).visits.push(raw); return raw; },
  getVisits: patient => patient.visits,
  organizePatientHistory: id => ({ ok: true, verifiedVisits: patients.find(p => p.id === id).visits.length })
};
context.__mlsCopyVisits = {
  _saveVisits: (patient, _identity, visits) => { visits.forEach(v => patient.visits.push(v)); return visits.length; },
  _visitIdentityAgrees: () => true
};

vm.runInNewContext(source, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
const api = context.__mlsSI;
assert(api && api.version === 'si-1.6.0');

(async () => {
  assert.strictEqual(api._findPatient([patients[0]], { name: patients[0].name }), null,
    'one local same-name patient must not upgrade a name-only Athena row');
  assert.strictEqual(api._patientIdentity({ name: patients[0].name }), '',
    'display name alone must not produce a patient identity');
  assert.strictEqual(api._findPatient([
    { id: 'dup-a', name: 'Duplicate Person', dob: '01/01/1980' },
    { id: 'dup-b', name: 'Duplicate Person', dob: '01/01/1980' }
  ], { name: 'Duplicate Person', dob: '01/01/1980' }), null,
  'ambiguous local duplicates must not become an arbitrary patient binding');
  assert.notStrictEqual(
    api._appointmentIdentity({ appointmentId: 'appt-a', name: 'Alex Same' }, '2026-07-15', '09:20'),
    api._appointmentIdentity({ appointmentId: 'appt-b', name: 'Alex Same' }, '2026-07-15', '09:20'),
    'exact appointment ids must take precedence over identical display fields'
  );
  assert.notStrictEqual(
    api._appointmentIdentity({ name: 'Alex Same', dob: patients[0].dob, providerId: 'provider-a' }, '2026-07-15', '09:20'),
    api._appointmentIdentity({ name: 'Alex Same', dob: patients[0].dob, providerId: 'provider-b' }, '2026-07-15', '09:20'),
    'provider identifiers must keep otherwise identical appointment slots separate'
  );

  backendRows = [{
    id: 'backend-a', name: 'Alex Same', dob: patients[0].dob, patient_external_id: patients[0].id,
    appt_date: '2026-07-15', start_at: '2026-07-15T09:20:00.000Z', provider: 'Doctor One', provider_id: 'provider-1'
  }];
  postedBodies.length = 0;
  const sameNameResult = await api.importAppts([{
    name: 'Alex Same', dob: patients[1].dob, mrn: patients[1].mrn,
    date: '2026-07-15', time: '09:20', provider: 'Doctor One', providerId: 'provider-1'
  }], { date: '2026-07-15', scopeDate: '2026-07-15' });
  assert.strictEqual(sameNameResult.created, 1, 'same-name/same-day patient B was collapsed into patient A');
  assert.strictEqual(sameNameResult.skipped, 0);
  assert.strictEqual(postedBodies[0].patient_external_id, patients[1].id, 'appointment bound to the wrong same-name patient');
  assert.deepStrictEqual(Array.from(sameNameResult.historyTargets, row => row._mlsTargetPatientId), [patients[1].id]);
  assert.strictEqual(sameNameResult.historyTargets[0]._mlsTargetMrn, patients[1].mrn);

  backendRows = [];
  postedBodies.length = 0;
  const nameOnlyResult = await api.importAppts([{
    appointmentId: 'exact-name-only-appointment', name: patients[0].name,
    date: '2026-07-16', time: '10:00', provider: 'Doctor One', providerId: 'provider-1'
  }], { date: '2026-07-16', scopeDate: '2026-07-16' });
  assert.strictEqual(nameOnlyResult.created, 1, 'an exact appointment may remain visible in schedule-only mode');
  assert.strictEqual(postedBodies[0].patient_external_id, null, 'name-only row borrowed a local patient binding');
  assert.strictEqual(postedBodies[0].athena_appointment_id, 'exact-name-only-appointment', 'source appointment id was not persisted on create');
  assert.strictEqual(postedBodies[0].athena_provider_id, 'provider-1', 'source provider id was not persisted on create');
  assert.strictEqual(nameOnlyResult.historyTargets.length, 0, 'name-only row entered the history reader');
  assert.strictEqual(nameOnlyResult.historyUnresolved[0].reason, 'patient-not-resolved');

  const partialPatient = patients[2];
  backendRows = [{
    id: 'backend-partial', appointment_id: 'athena-appt-partial', name: partialPatient.name,
    dob: '', patient_external_id: partialPatient.id, appt_date: '2026-07-17', start_at: '',
    provider: '', reason: ''
  }];
  postedBodies.length = 0; mutations.length = 0;
  const enrichedRow = {
    appointmentId: 'athena-appt-partial', name: partialPatient.name, dob: '05/06/1975', mrn: 'MRN-PARTIAL',
    date: '2026-07-17', time: '11:40', provider: 'Doctor Exact', providerId: 'provider-exact', reason: 'Follow-up'
  };
  const enriched = await api.importAppts([Object.assign({}, enrichedRow)], { date: '2026-07-17', scopeDate: '2026-07-17' });
  assert.strictEqual(enriched.created, 0);
  assert.strictEqual(enriched.repaired, 1, 'repeat pull did not enrich the exact existing appointment');
  assert.strictEqual(enriched.enrichedFields, 5);
  assert.strictEqual(mutations.filter(one => one.kind === 'update').length, 1);
  assert.deepStrictEqual(mutations[0].body, {
    dob: '05/06/1975', provider: 'Doctor Exact', athena_provider_id: 'provider-exact', reason: 'Follow-up',
    appt_date: '2026-07-17', start_at: '2026-07-17T11:40:00.000Z'
  });
  assert.strictEqual(partialPatient.dob, '05/06/1975', 'new proven DOB did not enrich the bound patient');
  assert.strictEqual(partialPatient.mrn, 'MRN-PARTIAL', 'new proven Athena MRN did not enrich the blank bound patient');
  assert.deepStrictEqual(Array.from(enriched.historyTargets, row => row._mlsTargetPatientId), [partialPatient.id]);

  postedBodies.length = 0; mutations.length = 0;
  const repeated = await api.importAppts([Object.assign({}, enrichedRow, { provider: 'Conflicting Provider', reason: 'Conflicting reason' })], { date: '2026-07-17', scopeDate: '2026-07-17' });
  assert.strictEqual(repeated.created, 0);
  assert.strictEqual(repeated.repaired, 0);
  assert.strictEqual(repeated.skipped, 1, 'second exact pull duplicated an existing appointment');
  assert.strictEqual(mutations.length, 0, 'conflicting nonempty fields were overwritten');
  assert.strictEqual(backendRows[0].provider, 'Doctor Exact');
  assert.strictEqual(backendRows[0].reason, 'Follow-up');
  assert.deepStrictEqual(Array.from(repeated.historyTargets, row => row._mlsTargetPatientId), [partialPatient.id],
    'idempotent repeat did not re-queue exact history refresh');

  postedBodies.length = 0; mutations.length = 0;
  const providerConflict = await api.importAppts([Object.assign({}, enrichedRow, { provider: '', providerId: 'provider-other' })], { date: '2026-07-17', scopeDate: '2026-07-17' });
  assert.strictEqual(providerConflict.failed, 1, 'exact appointment id bypassed a conflicting nonempty provider id');
  assert.strictEqual(providerConflict.created, 0);
  assert.strictEqual(providerConflict.repaired, 0);
  assert.strictEqual(providerConflict.skipped, 0);
  assert.strictEqual(mutations.length, 0, 'provider-id conflict mutated the backend appointment');
  assert.strictEqual(backendRows[0].athena_provider_id, 'provider-exact');

  const historyRow = {
    patient_external_id: patients[0].id, _mlsTargetPatientId: patients[0].id,
    _mlsTargetDob: patients[0].dob, _mlsTargetMrn: patients[0].mrn,
    name: patients[0].name, dob: patients[0].dob, mrn: patients[0].mrn
  };
  const unproven = await api._runHistoryBatch([historyRow], [], () => {});
  assert.strictEqual(unproven.complete, false, 'missing chart coverage receipt was accepted');
  assert.strictEqual(unproven.patients[0].organized, false);
  assert.strictEqual(unproven.patients[0].chartReason, 'chart-coverage-unproven');
  assert.strictEqual(chartSaves, 0, 'unproven chart coverage was saved');
  assert.strictEqual(assistCalls, 1, 'stale imported-history marker skipped the explicit pull');

  assistMode = 'complete';
  const proven = await api._runHistoryBatch([historyRow], [], () => {});
  assert.strictEqual(proven.complete, true);
  assert.strictEqual(proven.patients[0].chartCoverage.readerVersion, '2.9.19-chart-r3');
  assert.strictEqual(proven.patients[0].visitsCoverageComplete, true);
  assert.strictEqual(proven.patients[0].expectedVisits, proven.patients[0].parsedVisits);
  assert.strictEqual(chartSaves, 1);
  assert.strictEqual(assistCalls, 2, 'every explicit pull must perform a fresh chart read');

  console.log('PASS adversarial schedule identity, source-proof history binding, fresh chart coverage, and full visit-reader receipt');
})().catch(err => { console.error(err); process.exit(1); });
