'use strict';

/* Deterministic /p1-only mobile encounter-state proof. No browser, network,
 * account, patient, Athena instance, or regular-site asset is touched. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('1p-feat_mls_mobile_encounter.js', 'utf8');
const regularConnect = fs.readFileSync('mls-connect.js', 'utf8');
const regularShell = fs.readFileSync('ScribeFlow.html', 'utf8');

assert(!regularConnect.includes('1p-feat_mls_mobile_encounter.js') &&
  !regularConnect.includes('__mlsP1MobileEncounter'),
  'the regular connect asset was made aware of the P1 mobile coordinator');
assert(!regularShell.includes('1p-feat_mls_mobile_encounter.js') &&
  !regularShell.includes('__mlsP1MobileEncounter'),
  'the regular shell was made aware of the P1 mobile coordinator');
assert(source.includes("window.__MLS_P1_PREVIEW.enabled === true") &&
  source.includes("var LOADER_KEY = '__mlsP1MobileEncounterLoader'") &&
  source.includes('loader.installToken !== installToken'),
  'the module is not fail-closed behind the exact P1 loader owner');
assert(!/new\s+Notification\s*\(/.test(source),
  'the state module can emit an unsupervised lock-screen notification');

function makeRuntime(options = {}) {
  const store = options.store || new Map();
  const writes = [];
  const removals = [];
  const listeners = Object.create(null);
  let account = options.account === undefined ? 'doctor-a@example.invalid' : options.account;
  let epoch = options.epoch === undefined ? 31 : options.epoch;
  let today = options.today || '2026-08-15';
  let uuid = 0;
  let appointments = options.appointments || [
    {
      id: 'row-A', appointmentId: 'appt-A', patient_external_id: 'patient-A', name: 'Secret Patient Alpha',
      dob: '1950-01-01', mrn: 'MRN-SECRET-A', start_at: '2026-08-15T08:00:00-04:00',
      reason: 'Sensitive follow-up', provider: 'Dr Private', seen: false
    },
    {
      id: 'row-B', appointmentId: 'appt-B', patient_external_id: 'patient-B', name: 'Secret Patient Beta',
      dob: '1960-02-02', start_at: '2026-08-15T09:00:00-04:00',
      reason: 'Second visit', provider: 'Dr Private', seen: false
    }
  ];
  let remote = options.remote || { active: null, phase: 'idle', day: today, ts: Date.now() };
  let remoteHook = null;
  let strongBinding = null;
  let visitCompromised = false;
  let activePatientId = options.activePatientId || 'patient-A';
  const patientsByAccount = options.patientsByAccount || {
    'doctor-a@example.invalid': [
      {
        id: 'patient-A', name: 'Secret Patient Alpha', athenaHistorySummary: 'Sensitive history summary',
        problems: ['private problem'], meds: ['private medication'], allergies: ['private allergy'],
        priorProcedures: [{ name: 'Private prior procedure', date: '2025-04-03' }]
      },
      { id: 'patient-B', name: 'Secret Patient Beta' }
    ],
    'doctor-b@example.invalid': [{ id: 'patient-C', name: 'Different Account Patient' }]
  };
  const notesByPatient = options.notesByPatient || {
    'patient-A': [{ date: '2026-01-02', type: 'follow-up', text: 'Private historical note text' }]
  };
  const currentScript = {
    getAttribute(name) { return name === 'data-mls-install-token' ? (options.scriptToken || 'mobile-install-1') : null; }
  };
  const localStorage = {
    getItem(key) {
      if (options.readFailure && options.readFailure(String(key))) throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
      return store.has(String(key)) ? store.get(String(key)) : null;
    },
    setItem(key, value) {
      key = String(key); value = String(value);
      if (options.writeFailure && options.writeFailure(key, value)) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' });
      store.set(key, value); writes.push({ key, value });
    },
    removeItem(key) {
      key = String(key);
      if (options.removeFailure && options.removeFailure(key)) throw Object.assign(new Error('blocked'), { name: 'SecurityError' });
      store.delete(key); removals.push(key);
    }
  };
  const sandbox = {
    console, JSON, Math, Object, Array, String, Number, Boolean, RegExp,
    Date, Promise, Uint32Array, isFinite, parseInt, parseFloat,
    document: { currentScript },
    localStorage,
    sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    crypto: { randomUUID() { uuid += 1; return `synthetic-${uuid}`; } },
    __MLS_P1_PREVIEW: { enabled: options.preview !== false },
    __mlsP1MobileEncounterLoader: {
      installed: true, version: 'p1-mobile-encounter-1.0.0',
      installToken: options.loaderToken || 'mobile-install-1'
    },
    _calAppts: appointments,
    _acctTodayKey() { return today; },
    _calOwnerMatches(value, valueEpoch) {
      return String(value || '').toLowerCase() === String(account || '').toLowerCase() && Number(valueEpoch) === Number(epoch);
    },
    uns(suffix) { return `sf_u::${account || '_'}::${suffix}`; },
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    removeEventListener(type, fn) {
      const list = listeners[type] || []; const at = list.indexOf(fn);
      if (at >= 0) list.splice(at, 1);
    },
    patientNotes(id) { return notesByPatient[id] || []; },
    activePatient() {
      return (patientsByAccount[account] || []).find(row =>
        String(row.id || row.patientId || '') === String(activePatientId)) || null;
    },
    __mlsEasyV32: { remote: { snapshot() {
      if (remoteHook) remoteHook();
      return JSON.parse(JSON.stringify(remote));
    } } }
  };
  Object.defineProperty(sandbox, '__mlsSessionAccount', { enumerable: true, configurable: true,
    get() { return account; }, set(value) { account = value; } });
  Object.defineProperty(sandbox, '__mlsSessionEpoch', { enumerable: true, configurable: true,
    get() { return epoch; }, set(value) { epoch = value; } });
  Object.defineProperty(sandbox, 'currentVisitAthenaBinding', { enumerable: true, configurable: true,
    get() { return strongBinding; }, set(value) { strongBinding = value; } });
  Object.defineProperty(sandbox, 'currentVisitAthenaCompromised', { enumerable: true, configurable: true,
    get() { return visitCompromised; }, set(value) { visitCompromised = value === true; } });
  sandbox.__mlsAvatar = {
    installed: true,
    sessionState() { return { generation: 1, epoch, accountBound: !!account, tokenBound: !!account }; },
    exactPatient(id) {
      const rows = patientsByAccount[account] || [];
      const hits = rows.filter(row => String(row.id || row.athenaId || row.mrn || '') === String(id));
      return hits.length === 1 ? hits[0] : null;
    },
    lastReady: {
      at: Date.now(), total: 1,
      checkins: [{
        id: 'checkin-secret', patient_external_id: 'patient-A', headline: 'Private intake headline',
        summary: 'Sensitive intake summary', bullets: ['Private symptom'], flags: ['Private flag'],
        askAbout: ['Private follow-up question'], audited: true, ready_at: '2026-08-15T11:00:00Z'
      }]
    }
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: '1p-feat_mls_mobile_encounter.js' });
  return {
    api: sandbox.__mlsP1MobileEncounter,
    sandbox, store, writes, removals,
    key(value = account) { return `sf_u::${value || '_'}::p1MobileEncounterControlV1`; },
    setAccount(value, nextEpoch) { account = value; if (nextEpoch !== undefined) epoch = nextEpoch; },
    setToday(value) { today = value; },
    setAppointments(value) { appointments = value; sandbox._calAppts = value; },
    setRemote(value) { remote = value; },
    setRemoteHook(value) { remoteHook = value; },
    setStrongBinding(binding, overrides = {}) {
      const row = appointments.find(item => String(item.id || '') === String(binding && binding.selectionId || '')) || {};
      const sourcePatient = (patientsByAccount[account] || []).find(item =>
        String(item.id || item.patientId || '') === String(binding && binding.patientId || '')) || {};
      activePatientId = overrides.activePatientId || (binding && binding.patientId) || '';
      const patient = Object.freeze({
        patientId: String(overrides.patientId === undefined ? binding.patientId : overrides.patientId),
        name: String(overrides.patientName === undefined ? (sourcePatient.name || row.name || '') : overrides.patientName),
        dob: String(overrides.patientDob === undefined ? (sourcePatient.dob || row.dob || '') : overrides.patientDob),
        mrn: String(overrides.patientMrn || '')
      });
      const visitContext = Object.freeze({
        historical: overrides.contextHistorical === true,
        visitDate: String(overrides.visitDate === undefined ? binding.visitDate : overrides.visitDate),
        provider: String(overrides.provider === undefined ? (row.provider || '') : overrides.provider),
        appointmentId: String(overrides.appointmentId === undefined ? binding.appointmentId : overrides.appointmentId),
        encounterId: '', encounterUrl: ''
      });
      strongBinding = Object.freeze({
        id: 'strong-binding-1', patient,
        source: String(overrides.source || 'scheduled-appointment'),
        historical: overrides.historical === true,
        identityConflict: overrides.identityConflict === true,
        routeBlocked: overrides.routeBlocked === true,
        visitContext
      });
      visitCompromised = overrides.compromised === true;
      return strongBinding;
    },
    clearStrongBinding() { strongBinding = null; visitCompromised = false; },
    setAvatarReady(value) { sandbox.__mlsAvatar.lastReady = value; },
    dispatchBoundary(detail) { for (const fn of (listeners['mls:session-boundary'] || []).slice()) fn({ detail: detail || {} }); }
  };
}

function event(binding, type, seq, eventId, extra = {}) {
  return Object.assign({ source: 'local', binding, type, seq, eventId }, extra);
}

function testP1OwnershipGate() {
  assert.strictEqual(makeRuntime({ preview: false }).api, undefined,
    'the mobile coordinator installed outside the P1 preview');
  assert.strictEqual(makeRuntime({ loaderToken: 'wrong-loader-token' }).api, undefined,
    'a script without the exact live loader token installed');
}

function testStateSurfaceOrderingPrivacyAndHandoff() {
  const r = makeRuntime();
  const api = r.api;
  assert(api && api.installed, 'the exact P1 loader did not install the coordinator');
  assert.strictEqual(api.capabilities().crossDevice.supported, false, 'cross-device continuation was advertised');
  assert.strictEqual(api.capabilities().crossDevice.reason, 'verified-encounter-relay-unavailable');

  let state = api.state();
  assert.strictEqual(state.todaySchedule.status, 'verified-local');
  assert.strictEqual(state.todaySchedule.patients.length, 2, 'today schedule surface omitted a strongly bound row');
  assert.strictEqual(state.nextPatient.patient.selectionId, 'row-A');
  assert.strictEqual(state.nextPatient.patient.appointmentId, 'appt-A', 'next patient is not the first unseen scheduled row');

  const binding = api.bindingFor('row-A');
  assert(binding, 'a unique strongly bound appointment did not produce a binding');
  assert.strictEqual(binding.selectionId, 'row-A');
  assert.strictEqual(binding.appointmentId, 'appt-A');
  assert.strictEqual(api.openEncounter(binding).ok, true, 'the exact local encounter did not open');
  state = api.state();
  assert.strictEqual(state.relevantHistory.status, 'available', 'exact-patient history was not surfaced');
  assert.strictEqual(state.priorProcedures.status, 'available', 'exact-patient prior procedures were not surfaced');
  assert.strictEqual(state.intakeSummary.status, 'unavailable', 'patient-only intake was presented as exact-visit data');
  assert.strictEqual(state.intakeSummary.reason, 'intake-exact-visit-binding-unavailable');
  assert.strictEqual(state.intakeSummary.serverAcknowledged, true);
  assert(!JSON.stringify(state.intakeSummary).includes('Sensitive intake summary'),
    'unbound intake content crossed into an exact encounter surface');

  const firstRaw = r.store.get(r.key());
  const forbidden = [
    'row-A', 'appt-A', 'patient-A', '2026-08-15', 'Secret Patient Alpha', '1950-01-01', 'MRN-SECRET-A',
    'Sensitive history summary', 'Private historical note text', 'Sensitive intake summary', 'Private symptom'
  ];
  for (const secret of forbidden) assert(!firstRaw.includes(secret), `durable control metadata leaked ${secret}`);

  const start = event(binding, 'start_visit', 1, 'evt-start');
  let result = api.dispatch(start);
  assert.strictEqual(result.ok, false, 'start visit was accepted without an exact observed local visit');
  assert.strictEqual(result.reason, 'exact-local-visit-ack-unproven');
  assert.strictEqual(JSON.parse(r.store.get(r.key())).lastSeq, 0, 'a refused event advanced durable order');

  r.setRemote({ active: { id: 'row-A', name: 'Secret Patient Alpha', dob: '1950-01-01' },
    phase: 'idle', day: '2026-08-15', ts: Date.now() });
  result = api.dispatch(start);
  assert.strictEqual(result.ok, false, 'Easy row identity alone was treated as an immutable encounter receipt');
  assert.strictEqual(result.reason, 'exact-local-visit-binding-unproven');
  assert.strictEqual(JSON.parse(r.store.get(r.key())).lastSeq, 0);

  r.setStrongBinding(binding);
  r.setRemote({ active: { id: 'row-A', name: 'Secret Patient Alpha', dob: '1950-01-01' },
    phase: 'idle', day: '2026-08-14', ts: Date.now() });
  result = api.dispatch(start);
  assert.strictEqual(result.reason, 'exact-local-visit-ack-unproven',
    'an Easy snapshot from a different day was accepted');
  r.setRemote({ active: { id: 'row-A', name: 'Secret Patient Alpha', dob: '1950-01-01' },
    phase: 'idle', day: '2026-08-15', ts: Date.now() });
  result = api.dispatch(start);
  assert.strictEqual(result.ok, true, 'exact local start observation was refused');
  assert.strictEqual(result.state.startVisit.state, 'observed');
  assert.strictEqual(result.state.startVisit.serverAcknowledged, false,
    'a local visit observation was mislabeled as a server acknowledgement');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(result.state.progress)), { phase: 'in-visit', lastSeq: 1, nextSeq: 2 });
  const duplicate = api.dispatch(start);
  assert.strictEqual(duplicate.ok, true);
  assert.strictEqual(duplicate.applied, false);
  assert.strictEqual(duplicate.duplicate, true, 'an identical event was not idempotent');
  const conflict = api.dispatch(event(binding, 'recording_started', 1, 'evt-start'));
  assert.strictEqual(conflict.reason, 'event-id-conflict', 'same event ID with different content was replayed');
  const outOfOrder = api.dispatch(event(binding, 'recording_started', 3, 'evt-too-late'));
  assert.strictEqual(outOfOrder.reason, 'out-of-order-event');
  assert.strictEqual(outOfOrder.expectedSeq, 2);

  const staleBinding = Object.assign({}, binding, {
    selectionId: 'row-B', appointmentId: 'appt-B', patientId: 'patient-B'
  });
  const stale = api.dispatch(event(staleBinding, 'recording_started', 2, 'evt-stale'));
  assert.strictEqual(stale.reason, 'stale-visit', 'a different visit changed the active coordinator');

  r.setRemote({ active: { id: 'row-A', name: 'Secret Patient Alpha', dob: '1950-01-01' },
    phase: 'rec', day: '2026-08-15', ts: Date.now() });
  result = api.dispatch(event(binding, 'recording_started', 2, 'evt-recording'));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.recording.state, 'recording');

  r.setRemote({ active: { id: 'row-A', name: 'Secret Patient Alpha', dob: '1950-01-01' },
    phase: 'stopped', day: '2026-08-15', ts: Date.now() });
  result = api.dispatch(event(binding, 'recording_stopped', 3, 'evt-stopped'));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.recording.state, 'stopped');

  const proposalSecrets = {
    note: 'Sensitive current note', transcript: 'Sensitive current transcript', mrn: 'MRN-SECRET-A'
  };
  result = api.dispatch(event(binding, 'propose_actions', 4, 'evt-proposals', {
    actions: [{ kind: 'order_suggestion', title: 'Review imaging', summary: 'Sensitive proposed action', payload: proposalSecrets }]
  }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.proposedActions.length, 1);
  assert.strictEqual(result.state.proposedActions[0].executable, false);
  assert.strictEqual(result.state.proposedActions[0].requiresClinicianReview, true);
  const proposalRaw = r.store.get(r.key());
  for (const secret of Object.values(proposalSecrets).concat('Sensitive proposed action'))
    assert(!proposalRaw.includes(secret), `proposal PHI leaked into durable metadata: ${secret}`);

  result = api.dispatch(event(binding, 'end_handoff', 5, 'evt-handoff', { explicit: true }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.handoff.state, 'ready-for-local-review');
  assert.strictEqual(result.state.handoff.crossDevice, false);
  assert.strictEqual(result.state.handoff.serverAcknowledged, false);

  const remoteAttempt = api.dispatch(event(binding, 'review_opened', 6, 'evt-remote', {
    source: 'remote', explicit: true, serverAck: { ok: true, id: 'fabricated-ack' }
  }));
  assert.strictEqual(remoteAttempt.reason, 'verified-encounter-relay-unavailable',
    'a fabricated server acknowledgement unlocked cross-device continuation');
  assert.strictEqual(api.requestCrossDeviceContinuation({ serverAck: { ok: true } }).ok, false);

  result = api.dispatch(event(binding, 'review_opened', 6, 'evt-review', { explicit: true }));
  assert.strictEqual(result.ok, true);
  result = api.dispatch(event(binding, 'review_acknowledged', 7, 'evt-reviewed', { explicit: true }));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.state.review.state, 'acknowledged');
  assert.strictEqual(result.state.review.executesFinalAction, false);

  const sign = api.dispatch(event(binding, 'sign_encounter', 8, 'evt-sign'));
  assert.strictEqual(sign.reason, 'human-final-action-required');
  assert.strictEqual(api.requestFinalAction('place_order', binding).reason, 'human-final-action-required');
  assert.strictEqual(JSON.parse(r.store.get(r.key())).lastSeq, 7, 'a final-action refusal advanced state');

  const notification = api.safeNotification('review-ready', {
    patientName: 'Secret Patient Alpha', dob: '1950-01-01', mrn: 'MRN-SECRET-A',
    note: 'Sensitive current note', transcript: 'Sensitive current transcript'
  });
  const notificationRaw = JSON.stringify(notification);
  for (const secret of ['Secret Patient Alpha', '1950-01-01', 'MRN-SECRET-A', 'Sensitive current note', 'Sensitive current transcript'])
    assert(!notificationRaw.includes(secret), `lock-screen notification leaked ${secret}`);
  assert.deepStrictEqual(Object.keys(notification).sort(), ['body', 'data', 'tag', 'title']);
}

function testAccountSwitchLogoutAndStaleVisit() {
  const r = makeRuntime();
  const bindingA = r.api.bindingFor('row-A');
  assert(r.api.openEncounter(bindingA).ok);
  assert(r.store.has(r.key('doctor-a@example.invalid')));

  r.setAccount('doctor-b@example.invalid', 32);
  /* Model the narrow shell handoff window: Account B is published but the
     calendar still reports Account A ownership. Nothing from A may render. */
  r.sandbox._calOwnerMatches = () => false;
  let state = r.api.state();
  assert.strictEqual(state.binding, null, 'Account A encounter survived into Account B');
  assert.strictEqual(state.todaySchedule.status, 'unavailable');
  assert(!JSON.stringify(state).includes('Secret Patient Alpha'), 'old calendar PHI rendered during owner handoff');

  r.setAppointments([{
    id: 'row-C', appointmentId: 'appt-C', patient_external_id: 'patient-C', name: 'Different Account Patient',
    provider: 'Dr Other', start_at: '2026-08-15T10:00:00-04:00'
  }]);
  r.sandbox._calOwnerMatches = (value, valueEpoch) =>
    String(value).toLowerCase() === 'doctor-b@example.invalid' && Number(valueEpoch) === 32;
  state = r.api.state();
  assert.strictEqual(state.todaySchedule.patients[0].name, 'Different Account Patient');
  assert(!JSON.stringify(state).includes('Secret Patient Alpha'), 'Account A PHI survived the account switch');
  assert(!r.store.has(r.key('doctor-a@example.invalid')), 'Account A durable progress was not removed on switch');
  assert(!r.store.has(r.key('doctor-b@example.invalid')), 'Account switch invented an Account B encounter');
  assert(r.writes.every(write => write.key.includes('::doctor-a@example.invalid::')),
    'an encounter write crossed into another or placeholder namespace');

  const bindingB = r.api.bindingFor('row-C');
  assert(bindingB && r.api.openEncounter(bindingB).ok, 'Account B could not start a fresh isolated coordinator');
  assert(r.store.has(r.key('doctor-b@example.invalid')));
  r.setAccount('', 33);
  r.dispatchBoundary({ previousAccount: 'doctor-b@example.invalid', nextAccount: '', reason: 'logout', epoch: 33 });
  state = r.api.state();
  assert.strictEqual(state.ready, false);
  assert.strictEqual(state.binding, null);
  assert.strictEqual(state.proposedActions.length, 0);
  assert(!r.store.has(r.key('doctor-b@example.invalid')), 'logout retained the active account progress key');

  const staleRun = makeRuntime();
  const staleBinding = staleRun.api.bindingFor('row-A');
  assert(staleRun.api.openEncounter(staleBinding).ok);
  assert.strictEqual(staleRun.api.state().relevantHistory.status, 'available');
  staleRun.setAppointments([]);
  const staleState = staleRun.api.state();
  assert.strictEqual(staleState.binding, null, 'state() exposed a binding removed from the schedule');
  assert.strictEqual(staleState.relevantHistory.status, 'not-selected',
    'state() read old clinical history before retiring a stale schedule binding');
  assert(!JSON.stringify(staleState).includes('Sensitive history summary'),
    'state() exposed stale-visit PHI after schedule retirement');
  assert(!staleRun.store.has(staleRun.key()), 'stale encounter retained durable progress');
}

function testLogoutCleanupFailureStillScrubsMemory() {
  const r = makeRuntime({ removeFailure: key => key.includes('p1MobileEncounterControlV1') });
  const binding = r.api.bindingFor('row-A');
  assert(r.api.openEncounter(binding).ok);
  r.setAccount('', 34);
  r.dispatchBoundary({ nextAccount: '', reason: 'logout', epoch: 34 });
  const state = r.api.state();
  assert.strictEqual(state.binding, null, 'cleanup failure kept PHI in memory');
  assert.strictEqual(state.ready, false);
  assert.strictEqual(state.boundary.cleanup.ok, false, 'failed durable cleanup was reported as verified');
  assert.strictEqual(state.boundary.cleanup.reason, 'metadata-remove-failed');
}

function testAmbiguousAppointmentRefusal() {
  const r = makeRuntime({ appointments: [
    { id: 'row-first', appointmentId: 'duplicate-appt', patient_external_id: 'patient-A', name: 'First', provider: 'Dr Private', start_at: '2026-08-15T08:00:00-04:00' },
    { id: 'row-second', appointmentId: 'duplicate-appt', patient_external_id: 'patient-B', name: 'Second', provider: 'Dr Private', start_at: '2026-08-15T08:05:00-04:00' }
  ] });
  assert.strictEqual(r.api.bindingFor('row-first'), null,
    'an ambiguous appointment ID produced an immutable binding');
  const attempted = r.api.openEncounter({
    account: 'doctor-a@example.invalid', epoch: 31, visitDate: '2026-08-15',
    selectionId: 'row-first', appointmentId: 'duplicate-appt', patientId: 'patient-A'
  });
  assert.strictEqual(attempted.reason, 'exact-visit-binding-unproven');
}

function testCalendarOwnerHookIsMandatory() {
  const r = makeRuntime();
  delete r.sandbox._calOwnerMatches;
  const state = r.api.state();
  assert.strictEqual(state.todaySchedule.status, 'unavailable',
    'calendar rows were accepted without the account+epoch owner verifier');
  assert.strictEqual(state.todaySchedule.patients.length, 0);
  assert.strictEqual(r.api.bindingFor('row-A'), null,
    'a visit binding was created without the calendar owner verifier');
}

function testIntakeFreshnessAndSamplingTruth() {
  const stale = makeRuntime();
  const staleBinding = stale.api.bindingFor('row-A');
  assert(stale.api.openEncounter(staleBinding).ok);
  stale.setAvatarReady({
    at: Date.now() - 11 * 60 * 1000, total: 1,
    checkins: [{
      patient_external_id: 'patient-A', appointmentId: 'appt-A',
      headline: 'Must not escape stale cache', summary: 'Stale sensitive intake',
      ready_at: '2026-08-15T11:00:00Z'
    }]
  });
  let intake = stale.api.state().intakeSummary;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(intake)), {
    status: 'stale', reason: 'intake-cache-stale', serverAcknowledged: true
  });
  assert(!JSON.stringify(intake).includes('Stale sensitive intake'),
    'stale intake content was surfaced as current encounter data');

  const sampled = makeRuntime();
  const sampledBinding = sampled.api.bindingFor('row-A');
  assert(sampled.api.openEncounter(sampledBinding).ok);
  sampled.setAvatarReady({
    at: Date.now(), total: 22,
    checkins: [{ patient_external_id: 'someone-else', headline: 'Other patient' }]
  });
  intake = sampled.api.state().intakeSummary;
  assert.strictEqual(intake.status, 'unavailable');
  assert.strictEqual(intake.reason, 'intake-cache-sampled',
    'an absent patient in a sampled cache was falsely reported as no intake');

  sampled.setAvatarReady({
    at: Date.now(), total: 1,
    checkins: [{ patient_external_id: 'someone-else', headline: 'Other patient' }]
  });
  intake = sampled.api.state().intakeSummary;
  assert.strictEqual(intake.status, 'none',
    'a fresh complete server result could not truthfully report no matching intake');
  assert.strictEqual(intake.serverAcknowledged, true);
}

function testExactObservationPatientAndEpochProof() {
  const patientMismatch = makeRuntime();
  const binding = patientMismatch.api.bindingFor('row-A');
  assert(patientMismatch.api.openEncounter(binding).ok);
  patientMismatch.setRemote({
    active: { id: 'row-A', name: 'Secret Patient Alpha', dob: '1950-01-01' },
    phase: 'idle', day: '2026-08-15', ts: Date.now()
  });
  patientMismatch.setStrongBinding(binding, { activePatientId: 'patient-B' });
  let result = patientMismatch.api.dispatch(event(binding, 'start_visit', 1, 'evt-patient-mismatch'));
  assert.strictEqual(result.reason, 'exact-local-visit-binding-unproven',
    'a different active patient satisfied the local encounter observation');
  assert.strictEqual(JSON.parse(patientMismatch.store.get(patientMismatch.key())).lastSeq, 0);

  const epochRace = makeRuntime();
  const epochBinding = epochRace.api.bindingFor('row-A');
  assert(epochRace.api.openEncounter(epochBinding).ok);
  epochRace.setStrongBinding(epochBinding);
  epochRace.setRemote({
    active: { id: 'row-A', name: 'Secret Patient Alpha', dob: '1950-01-01' },
    phase: 'idle', day: '2026-08-15', ts: Date.now()
  });
  epochRace.setRemoteHook(() => { epochRace.sandbox.__mlsSessionEpoch = 32; });
  result = epochRace.api.dispatch(event(epochBinding, 'start_visit', 1, 'evt-epoch-race'));
  assert.strictEqual(result.reason, 'session-changed-during-local-observation',
    'an account epoch change during Easy observation was ignored');
  assert.strictEqual(result.state.binding, null, 'the old encounter survived an observation-time epoch change');
  assert(!epochRace.store.has(epochRace.key('doctor-a@example.invalid')),
    'the old account/epoch control receipt survived the observation race');
}

function testReloadedOrphanCleanup() {
  const accountKey = 'sf_u::doctor-a@example.invalid::p1MobileEncounterControlV1';
  const seed = JSON.stringify({
    v: 1, controlId: 'old-control', phase: 'review', recording: 'stopped',
    handoff: 'ready-for-local-review', review: 'open', lastSeq: 9
  });

  const logoutStore = new Map([[accountKey, seed]]);
  const logout = makeRuntime({ store: logoutStore });
  /* No API read/open occurs first: the module must retain the proven owner key
     synchronously at install rather than learning it only from an encounter. */
  logout.setAccount('', 41);
  logout.dispatchBoundary({ previousAccount: 'doctor-a@example.invalid', nextAccount: '', reason: 'logout', epoch: 41 });
  assert(!logoutStore.has(accountKey), 'logout retained a reloaded orphan control record');
  assert(logout.removals.includes(accountKey));

  const revertStore = new Map([[accountKey, seed]]);
  const reverted = makeRuntime({ store: revertStore });
  assert.strictEqual(reverted.api.revert(), true, 'revert could not verify orphan cleanup');
  assert(!revertStore.has(accountKey), 'revert retained a reloaded orphan control record');
  assert.strictEqual(reverted.sandbox.__mlsP1MobileEncounter, undefined);
}

testP1OwnershipGate();
testStateSurfaceOrderingPrivacyAndHandoff();
testAccountSwitchLogoutAndStaleVisit();
testLogoutCleanupFailureStillScrubsMemory();
testAmbiguousAppointmentRefusal();
testCalendarOwnerHookIsMandatory();
testIntakeFreshnessAndSamplingTruth();
testExactObservationPatientAndEpochProof();
testReloadedOrphanCleanup();

console.log('PASS P1 mobile encounter coordinator: frozen exact local binding, ordered idempotent state, freshness/coverage truth, PHI-free durability/notifications, account/logout/orphan cleanup, and truthful cross-device/final-action refusal');
