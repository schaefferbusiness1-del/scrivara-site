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
const bootstrapCalls = [];
const gotoCalls = [];
const bootstrapResponses = new Map();

const context = {
  console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
  encodeURIComponent, queueMicrotask,
  setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
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
  if (msg && msg.type === 'mlsAppGotoDate') {
    gotoCalls.push({ date: msg.date, requestId: msg.requestId });
    queueMicrotask(() => {
      const resp = { ok: true, schedDate: msg.date, requestId: msg.requestId, id: msg.requestId };
      const event = { data: { source: 'mls-ext', type: 'mlsAppGotoDateResult', requestId: msg.requestId, resp } };
      Array.from(listeners).forEach(fn => fn(event));
    });
    return;
  }
  if (msg && msg.type === 'mlsAppReadChart' && msg.bootstrapIdentity === true) {
    bootstrapCalls.push({ appointmentId: msg.appointmentId, patient: msg.patient, scheduleDate: msg.scheduleDate, requestId: msg.requestId });
    const planned = bootstrapResponses.get(msg.appointmentId) || { ok: false, reason: 'appointment-id-not-found' };
    queueMicrotask(() => {
      const resp = Object.assign({ requestId: msg.requestId }, planned);
      /* The real extension binds its bootstrap receipt to the exact open
         request and asserts the navigation/banner proofs; the importer must
         refuse any receipt missing them, so the faithful mock supplies them. */
      if (resp.identityBootstrapReceipt) {
        resp.identityBootstrapReceipt = Object.assign({
          navigationProven: true, bannerIdentity: true, dobVerified: true
        }, resp.identityBootstrapReceipt, { requestId: msg.requestId });
      }
      const event = { data: { source: 'mls-ext', type: 'mlsAppChartResult', requestId: msg.requestId, resp } };
      Array.from(listeners).forEach(fn => fn(event));
    });
    return;
  }
  if (!msg || msg.type !== 'mlsAppReadAllVisits') return;
  queueMicrotask(() => {
    const target = patients.find(p => (msg.hint.athenaId && p.mrn === msg.hint.athenaId) || (p.name === msg.hint.name && p.dob === msg.hint.dob));
    assert(target, 'history request must carry Athena MRN or name+DOB, never rely on a local patient ID');
     const event = { data: {
       source: 'mls-ext', type: 'mlsAppAllVisitsResult', ok: true,
       id: msg.id, requestId: msg.requestId,
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
    ? Object.freeze({ patientId: target.patientId, name: target.name, dob: target.dob, mrn: target.mrn,
        verifiedName: observed.chartName, verifiedDob: observed.chartDob, verifiedMrn: observed.chartMrn })
    : null;
context._hasImportedHistory = () => true; // deliberately stale legacy marker
context._parsePatientChart = () => Promise.resolve({
  problems: 'Verified problem', meds: 'Verified med', allergies: 'Verified allergy', summary: 'Verified summary',
  vitals: { bp: '120/80' }, history: { pmh: 'Verified PMH' },
  coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
});
context._athenaChartProfileCoverage = () => ({ complete: true });
context._athenaChartSnapshotFromChart = chart => ({ problems: String(chart.problems || ''), meds: String(chart.meds || ''), allergies: String(chart.allergies || ''), summary: String(chart.summary || ''), vitals: Object.assign({}, chart.vitals || {}), history: Object.assign({}, chart.history || {}), visits: [] });
context._athenaChartSnapshotProof = snapshot => JSON.stringify(snapshot || {});
context._savePatientChart = (ref, _row, chart) => {
  chartSaves++;
  const p = patients.find(one => one.id === ref.patientId);
  p.athenaChartSnapshot = context._athenaChartSnapshotFromChart(chart);
  p.athenaProfileCoverage = { complete: true, exactIdentityVerified: true, patientId: p.id, capturedAt: new Date().toISOString(), saveRequestId: String(ref.requestId || ''), cards: {
    problems: { populated: true }, meds: { populated: true }, allergies: { populated: true }, summary: { populated: true }, vitals: { populated: true }, history: { populated: true }
  } };
  return true;
};
context._patientHistoryCardCoverage = id => (patients.find(p => p.id === id) || {}).athenaProfileCoverage || null;
context._assistReadChart = (target, _onStatus, request) => {
  assistCalls++;
  const text = 'Verified problems medications allergies and longitudinal clinical history';
  const requestId = String(request && request.requestId || `chart-${assistCalls}`);
  const base = { text, requestId, chartName: target.name, chartDob: target.dob, chartMrn: target.mrn };
  if (assistMode === 'missing-coverage') return Promise.resolve(base);
  if (assistMode === 'missing-coverage-once') { assistMode = 'complete'; return Promise.resolve(base); }
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
  reconcileVerifiedAthenaVisits: id => {
    const patient = patients.find(p => p.id === id);
    const seen = new Set();
    const before = patient.visits.length;
    patient.visits = patient.visits.filter(v => {
      const key = String(v.encounterId || v.sourceVisitKey || '');
      if (!key || seen.has(key)) return false;
      seen.add(key); return true;
    });
    return { complete: true, removed: before - patient.visits.length, retained: patient.visits.length };
  },
  organizePatientHistory: id => ({ ok: true, verifiedVisits: patients.find(p => p.id === id).visits.length })
};
context.__mlsCopyVisits = {
  _saveVisits: (patient, _identity, visits) => {
    visits.forEach(v => patient.visits.push(Object.assign({}, v, {
      source: 'athena-schedule-history', identityVerified: true, identityBinding: patient.id,
      indexOnly: false, fullDetail: true, bodyComplete: true
    })));
    return visits.length;
  },
  _visitIdentityAgrees: () => true
};

vm.runInNewContext(source, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
const api = context.__mlsSI;
assert(api && api.version === 'si-1.7.8');

(async () => {
  const bootstrapDate = '2026-07-22';
  bootstrapResponses.set('bootstrap-a', {
    ok: true, opened: true, appointmentId: 'bootstrap-a', chartName: 'Alex Same', chartDob: '01/02/1970',
    identityBootstrapReceipt: { complete: true, appointmentIdBound: true, exactNameMatched: true, appointmentId: 'bootstrap-a', scheduleDate: bootstrapDate }
  });
  bootstrapResponses.set('bootstrap-b', {
    ok: true, opened: true, appointmentId: 'bootstrap-b', chartName: 'Alex Same', chartDob: '03/04/1980',
    identityBootstrapReceipt: { complete: true, appointmentIdBound: true, exactNameMatched: true, appointmentId: 'bootstrap-b', scheduleDate: bootstrapDate }
  });
  const bootstrapRows = [
    { appointmentId: 'bootstrap-a', name: 'Alex Same', date: bootstrapDate, dob: '' },
    { appointmentId: 'bootstrap-b', name: 'Alex Same', date: bootstrapDate, mrn: 'MRN-B' }
  ];
  const hydrated = await api._hydrateMissingScheduleProof(bootstrapRows, () => {}, bootstrapDate);
  assert.strictEqual(hydrated.receipt.complete, true, 'two exact appointment/banner identities did not hydrate completely');
  assert.strictEqual(hydrated.receipt.appointmentBound, 2);
  assert.deepStrictEqual(Array.from(bootstrapRows, row => row.dob), ['01/02/1970', '03/04/1980'], 'same-name appointment ids exchanged or lost banner DOBs');
  assert.deepStrictEqual(Array.from(bootstrapCalls, call => call.appointmentId), ['bootstrap-a', 'bootstrap-b'], 'identity bootstrap cached by name instead of appointment id');
  assert.strictEqual(gotoCalls.length, 1, 'the day grid was not restored exactly once between two chart opens');
  assert.strictEqual(gotoCalls[0].date, bootstrapDate, 'day restoration was hard-coded or used the wrong date');

  const callsBeforeDuplicate = bootstrapCalls.length;
  const duplicateBootstrap = await api._hydrateMissingScheduleProof([
    { appointmentId: 'duplicate-id', name: 'First Same', date: bootstrapDate },
    { appointmentId: 'duplicate-id', name: 'Second Same', date: bootstrapDate }
  ], () => {}, bootstrapDate);
  assert.strictEqual(duplicateBootstrap.receipt.complete, false, 'duplicate source appointment id was accepted');
  assert.strictEqual(duplicateBootstrap.receipt.reasons['appointment-id-duplicate'], 2);
  assert.strictEqual(bootstrapCalls.length, callsBeforeDuplicate, 'duplicate appointment id launched a chart open');

  bootstrapResponses.set('invalid-dob-row', {
    ok: true, opened: true, appointmentId: 'invalid-dob-row', chartName: 'Invalid Dob', chartDob: '05/06/1975',
    identityBootstrapReceipt: { complete: true, appointmentIdBound: true, exactNameMatched: true, appointmentId: 'invalid-dob-row', scheduleDate: bootstrapDate }
  });
  const invalidDobRow = { appointmentId: 'invalid-dob-row', name: 'Invalid Dob', date: bootstrapDate, dob: '88y' };
  const invalidDobHydrated = await api._hydrateMissingScheduleProof([invalidDobRow], () => {}, bootstrapDate);
  assert.strictEqual(invalidDobHydrated.receipt.complete, true, 'malformed DOB incorrectly skipped exact appointment bootstrap');
  assert.strictEqual(invalidDobRow.dob, '05/06/1975');

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
  assert.strictEqual(nameOnlyResult.historyUnresolved.length, 1, 'name-only schedule-only row emitted duplicate unresolved history entries');
  assert.strictEqual(nameOnlyResult.historyUnresolved[0].reason, 'patient-not-resolved');

  /* A source appointment id is exact enough to preserve/idempotently recognize
     the schedule row, but it is not current patient identity proof. In
     particular, an old backend row's DOB/MRN must not leak into a fresh
     name-only row and launch a history read for that bound patient. */
  backendRows = [{
    id: 'backend-reused-name-only', athena_appointment_id: 'reused-name-only-source-id',
    name: patients[1].name, dob: patients[1].dob, mrn: patients[1].mrn,
    patient_external_id: patients[1].id, appt_date: '2026-07-17', start_at: '2026-07-17T10:10:00.000Z',
    provider: 'Doctor One', athena_provider_id: 'provider-1'
  }];
  postedBodies.length = 0; mutations.length = 0;
  const reusedNameOnly = await api.importAppts([{
    appointmentId: 'reused-name-only-source-id', name: patients[0].name,
    date: '2026-07-17', time: '10:10', provider: 'Doctor One', providerId: 'provider-1'
  }], { date: '2026-07-17', scopeDate: '2026-07-17' });
  assert.strictEqual(reusedNameOnly.created, 0, 'name-only exact appointment was duplicated');
  assert.strictEqual(reusedNameOnly.skipped, 1, 'existing exact appointment did not remain schedule-visible');
  assert.strictEqual(reusedNameOnly.failed, 0, 'schedule reconciliation failed only because current identity proof was absent');
  assert.strictEqual(postedBodies.length, 0, 'name-only exact appointment created or updated a backend binding');
  assert.strictEqual(mutations.length, 0, 'name-only exact appointment mutated the old backend row');
  assert.strictEqual(backendRows[0].patient_external_id, patients[1].id, 'existing schedule row was destructively unbound');
  assert.strictEqual(reusedNameOnly.historyTargets.length, 0, 'old appointment DOB/MRN was copied into a current history target');
  assert(reusedNameOnly.historyUnresolved.some(row => row.patientId === patients[1].id && row.reason === 'missing-source-dob-mrn-proof'),
    'current name-only row was not retained as history-unresolved');
  const historyCallsBeforeNameOnly = assistCalls;
  const reusedNameOnlyHistory = await api._runHistoryBatch(reusedNameOnly.historyTargets, reusedNameOnly.historyUnresolved, () => {});
  assert.strictEqual(reusedNameOnlyHistory.requested, 1, 'unresolved current row was omitted from the honest history receipt');
  assert.strictEqual(reusedNameOnlyHistory.processed, 0, 'current name-only row was processed as an exact history target');
  assert.strictEqual(assistCalls, historyCallsBeforeNameOnly, 'current name-only row launched a chart/history pull');

  backendRows = [];
  postedBodies.length = 0;
  const newDuplicateResult = await api.importAppts([{
    appointmentId: 'new-duplicate-a', name: 'Brand New Duplicate', dob: '02/03/1971', mrn: 'NEW-MRN-A',
    date: '2026-07-16', time: '10:20', provider: 'Doctor One', providerId: 'provider-1'
  }, {
    appointmentId: 'new-duplicate-b', name: 'Brand New Duplicate', dob: '04/05/1982', mrn: 'NEW-MRN-B',
    date: '2026-07-16', time: '10:20', provider: 'Doctor One', providerId: 'provider-1'
  }], { date: '2026-07-16', scopeDate: '2026-07-16' });
  assert.strictEqual(newDuplicateResult.created, 2, 'two brand-new same-name patients with different proof were collapsed');
  assert.strictEqual(newDuplicateResult.historyTargets.length, 2, 'brand-new proven schedule patients did not become exact history targets');
  assert.strictEqual(new Set(Array.from(newDuplicateResult.historyTargets, row => row._mlsTargetPatientId)).size, 2,
    'different DOB/MRN rows shared one local patient id');
  assert.deepStrictEqual(Array.from(newDuplicateResult.historyTargets, row => row._mlsTargetDob).sort(), ['02/03/1971', '04/05/1982']);
  assert.deepStrictEqual(Array.from(newDuplicateResult.historyTargets, row => row._mlsTargetMrn).sort(), ['NEW-MRN-A', 'NEW-MRN-B']);

  /* Deterministic FNV collision regression: these two distinct exact MRN
     identities intentionally hash to the same compact local id. The second
     patient must fail closed, never overwrite or borrow the first patient. */
  backendRows = [];
  postedBodies.length = 0;
  const collisionPatientsBefore = patients.length;
  const stableIdCollision = await api.importAppts([{
    appointmentId: 'stable-collision-a', name: 'Collision Alpha', dob: '01/02/1970', mrn: 'mrn1uacaok154ts46',
    date: '2026-07-18', time: '08:00', provider: 'Doctor One', providerId: 'provider-1'
  }, {
    appointmentId: 'stable-collision-b', name: 'Collision Beta', dob: '03/04/1980', mrn: 'mrn1kg9zyr0h0ljm4',
    date: '2026-07-18', time: '08:20', provider: 'Doctor One', providerId: 'provider-1'
  }], { date: '2026-07-18', scopeDate: '2026-07-18', includeHistory: true, requirePatientBinding: true });
  assert.strictEqual(stableIdCollision.created, 1, 'both colliding exact identities were persisted');
  assert.strictEqual(stableIdCollision.failed, 1, 'the second colliding exact identity did not fail closed');
  assert.strictEqual(patients.length, collisionPatientsBefore + 1, 'a compact-id collision created or overwrote a second local patient');
  const collisionStored = patients.filter(patient => patient.id === 'p_sched_oi9qit');
  assert.strictEqual(collisionStored.length, 1, 'the deterministic collision produced an aliased local patient set');
  assert.strictEqual(collisionStored[0].name, 'Collision Alpha', 'the second collision overwrote the first exact patient');
  assert.strictEqual(stableIdCollision.historyTargets.length, 1, 'the colliding patient entered exact history targets');

  backendRows = [{
    id: 'bound-missing', athena_appointment_id: 'bound-missing-proof', name: patients[0].name,
    dob: '', patient_external_id: patients[0].id, appt_date: '2026-07-18', start_at: '2026-07-18T12:00:00.000Z',
    provider: 'Doctor One', athena_provider_id: 'provider-1'
  }, {
    id: 'bound-exact', athena_appointment_id: 'bound-later-proof', name: patients[0].name,
    dob: '', patient_external_id: patients[0].id, appt_date: '2026-07-18', start_at: '2026-07-18T12:20:00.000Z',
    provider: 'Doctor One', athena_provider_id: 'provider-1'
  }];
  postedBodies.length = 0;
  const laterProof = await api.importAppts([{
    appointmentId: 'bound-missing-proof', name: patients[0].name,
    date: '2026-07-18', time: '12:00', provider: 'Doctor One', providerId: 'provider-1'
  }, {
    appointmentId: 'bound-later-proof', name: patients[0].name, dob: patients[0].dob, mrn: patients[0].mrn,
    date: '2026-07-18', time: '12:20', provider: 'Doctor One', providerId: 'provider-1'
  }], { date: '2026-07-18', scopeDate: '2026-07-18' });
  assert.deepStrictEqual(Array.from(laterProof.historyTargets, row => row._mlsTargetPatientId), [patients[0].id],
    'a provisional missing-proof row blocked a later exact row for the same patient');
  assert.strictEqual(laterProof.historyUnresolved.some(row => row.patientId === patients[0].id && row.reason === 'missing-source-dob-mrn-proof'), false,
    'superseded missing-proof history result remained in the batch receipt');

  backendRows = [{
    id: 'bound-good', athena_appointment_id: 'bound-good-proof', name: patients[0].name,
    dob: '', patient_external_id: patients[0].id, appt_date: '2026-07-19', start_at: '2026-07-19T12:00:00.000Z',
    provider: 'Doctor One', athena_provider_id: 'provider-1'
  }, {
    id: 'bound-conflict', athena_appointment_id: 'bound-conflicting-proof', name: patients[0].name,
    dob: '', patient_external_id: patients[0].id, appt_date: '2026-07-19', start_at: '2026-07-19T12:20:00.000Z',
    provider: 'Doctor One', athena_provider_id: 'provider-1'
  }];
  const laterConflict = await api.importAppts([{
    appointmentId: 'bound-good-proof', name: patients[0].name, dob: patients[0].dob, mrn: patients[0].mrn,
    date: '2026-07-19', time: '12:00', provider: 'Doctor One', providerId: 'provider-1'
  }, {
    appointmentId: 'bound-conflicting-proof', name: patients[0].name, dob: '09/09/1999', mrn: 'WRONG-MRN-9',
    date: '2026-07-19', time: '12:20', provider: 'Doctor One', providerId: 'provider-1'
  }], { date: '2026-07-19', scopeDate: '2026-07-19' });
  assert.strictEqual(laterConflict.historyTargets.length, 0, 'a later conflicting row left an earlier exact history target queued');
  assert(laterConflict.historyUnresolved.some(row => row.patientId === patients[0].id && row.reason === 'source-proof-conflict'),
    'genuine later identity conflict was not retained as a fail-closed result');

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
  /* si-1.7.2: a non-timeout chart failure performs exactly ONE bounded
     in-batch open+verify retry (2 fresh reads total, never more). */
  assert.strictEqual(assistCalls, 2, 'unproven chart read must retry exactly once (fresh open+verify), never zero or more');
  assert.strictEqual(unproven.patients[0].chartRetried, true, 'chart retry receipt missing');

  assistMode = 'complete';
  const proven = await api._runHistoryBatch([historyRow], [], () => {});
  assert.strictEqual(proven.complete, true);
  assert.strictEqual(proven.patients[0].chartCoverage.readerVersion, '2.9.19-chart-r3');
  assert.strictEqual(proven.patients[0].visitsCoverageComplete, true);
  assert.strictEqual(proven.patients[0].expectedVisits, proven.patients[0].parsedVisits);
  assert.strictEqual(chartSaves, 1);
  assert.strictEqual(assistCalls, 3, 'every explicit pull must perform a fresh chart read (2 from the retried unproven batch + 1 clean)');
  /* si-1.7.3 SPEED EVIDENCE: every processed patient receipt carries PHI-free
     per-stage wall-clock stamps (pure numbers) so one live run localizes the
     slow stage before any sleep is converted to a readiness poll. */
  const stamps = proven.patients[0].stageMs;
  assert(stamps && typeof stamps === 'object', 'per-stage timing stamps missing from a completed patient receipt');
  ['chartMs', 'parseSaveMs', 'visitsMs', 'visitSaveMs', 'totalMs'].forEach(k => {
    assert(Number.isFinite(stamps[k]) && stamps[k] >= 0, 'stage stamp ' + k + ' must be a non-negative number');
  });
  assert(stamps.totalMs >= stamps.chartMs, 'total must cover the chart stage');
  assert(stamps.visitsMs >= stamps.visitSaveMs, 'visits stage must contain the visit persist');
  assert.strictEqual(JSON.stringify(stamps).includes(patients[0].name), false, 'timing stamps must stay PHI-free');
  const failedStamps = unproven.patients[0].stageMs;
  assert(failedStamps && Number.isFinite(failedStamps.chartMs), 'failed patients must still carry chart-stage timing evidence');
  assert.notStrictEqual(proven.patients[0].parsePipelined, true, 'full-visit batches must stay strictly sequential (the visits reader needs THIS chart on screen)');

  /* si-1.7.4 PIPELINED PARSE (visit bodies skipped only): patient N's server
     parse+persist overlaps patient N+1's chart open. Every identity gate
     still runs; a failed pipelined parse gets exactly ONE deferred full
     re-run (fresh chart open + verify + sequential parse) after the sweep;
     receipt order and honest failure semantics are unchanged. */
  {
    store.set('identity-test::pullVisitBodies', '0');
    assistMode = 'missing-coverage-once'; /* first chart read lacks coverage -> pipelined parse fails -> deferred re-run heals */
    const rowA = {
      patient_external_id: patients[0].id, _mlsTargetPatientId: patients[0].id,
      _mlsTargetDob: patients[0].dob, _mlsTargetMrn: patients[0].mrn,
      name: patients[0].name, dob: patients[0].dob, mrn: patients[0].mrn
    };
    const rowB = {
      patient_external_id: patients[1].id, _mlsTargetPatientId: patients[1].id,
      _mlsTargetDob: patients[1].dob, _mlsTargetMrn: patients[1].mrn,
      name: patients[1].name, dob: patients[1].dob, mrn: patients[1].mrn
    };
    const callsBefore = assistCalls;
    const piped = await api._runHistoryBatch([rowA, rowB], [], () => {});
    assert.strictEqual(piped.complete, true, 'pipelined batch with one deferred-healed parse must end complete');
    assert.strictEqual(piped.patients.length, 2);
    assert.strictEqual(piped.patients[0].patientId, patients[0].id, 'pipelined receipts must keep batch order');
    assert.strictEqual(piped.patients[0].parsePipelined, true, 'skip-visits batches must pipeline the parse');
    assert.strictEqual(piped.patients[1].parsePipelined, true);
    assert.strictEqual(piped.patients[0].parseDeferredRetried, true, 'failed pipelined parse must get its one deferred full re-run');
    assert.strictEqual(piped.patients[0].complete, true, 'the deferred re-run must heal the patient honestly');
    assert.strictEqual(piped.patients[1].complete, true);
    assert.strictEqual(piped.patients[0].visitsSkipped, true, 'skipping visits must stay honestly recorded');
    assert.strictEqual(assistCalls - callsBefore, 3, 'exactly one deferred fresh chart re-read (2 first-pass + 1 retry), never more');
    const pipedStamps = piped.patients[0].stageMs;
    assert(pipedStamps && Number.isFinite(pipedStamps.parseSaveMs) && pipedStamps.totalMs >= pipedStamps.chartMs, 'pipelined receipts must carry self-time stage stamps');
    /* Ambiguity/regression guard: a pipelined parse failure that CANNOT heal
       still fails closed with an honest reason and a retry entry. */
    assistMode = 'missing-coverage';
    const failedPiped = await api._runHistoryBatch([rowA], [], () => {});
    assert.strictEqual(failedPiped.complete, false, 'an unhealable pipelined parse must stay failed');
    assert.strictEqual(failedPiped.patients[0].reason, 'chart-coverage-unproven', 'pipelined failures must keep their exact reason');
    assert.strictEqual(failedPiped.failures >= 1, true, 'pipelined failures must land in the retry lane');
    assistMode = 'complete';
    store.delete('identity-test::pullVisitBodies');
  }

  console.log('PASS adversarial schedule identity, source-proof history binding, fresh chart coverage, and full visit-reader receipt');
})().catch(err => { console.error(err); process.exit(1); });
