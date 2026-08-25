'use strict';
/* ===================================================================
   schedule-identity-adversarial-runtime
   Adversarial runtime suite for the EXACT schedule importer: identity
   binding, source-proof history targeting, fresh chart coverage, the
   full visit-reader receipt, and the visit-notes scope boundary.

   ===== CONTRACT CHANGE: dayfacts-1.0.0 (owner 2026-08-25) ===========
   The Full-visit-notes checkbox now means "ALL historical visit notes",
   never "whether any chart opens". That MOVED this suite's pins:

     OFF (settled)  was a schedule-only NO-OP  (historyRequested:false,
                    reason 'visit-notes-off', requested 0, zero chart
                    opens, zero chart saves)
                    -> is now DAY-FACTS mode: the batch RUNS, every exact
                    scheduled row gets its identity-verified chart open
                    plus a chart-facts save through the pipelined-parse
                    branch, and ONLY the historical body traversal is
                    skipped (visitsSkipped:true). Receipt says
                    visitNotesMode 'day-facts', chartFactsRequired:true,
                    allVisitBodiesRequested:false, and declares insurance
                    honestly as not-yet-attempted ('reader-not-shipped').

     UNSET          was folded into the same silent OFF no-op
                    -> is now the ONLY zero-read state: a blocked receipt,
                    reason 'visit-notes-unchosen', visitNotesMode
                    'blocked-unchosen', requested 0, patients 0.

   The retired 'visit-notes-off' schedule-only no-op must never be
   reasserted here; every old pin below was replaced by its new-contract
   equivalent rather than deleted.

   ===== dayfacts-1.0.1 (the day-note lanes actually shipped) =========
   Round 1 could only pin ZEROES for the pulled-day note: both lanes were
   hard-disabled for OFF and every helper short-circuited on the
   checkbox. Those kill switches are gone, so the day-facts block now
   PROVES the mandatory floor's second half — one date-SCOPED
   {onlyDate} read per exact scheduled row, through the ordinary
   __mlsVisitSavePref reader, for the day the pull targeted and never
   for "today" — and the receipt is held to the same count
   (todayNoteRead/chartOpens.dayNote, todayNoteNotRequested 0). The ON
   lane is pinned to ZERO scoped reads so that counter can only be moved
   by day-facts, and UNCHOSEN is pinned to zero day-note reads too.
   Round 2 left ONE tripwire here: both retry FEEDS still gated on the
   retired checkbox, so a day-facts row whose pulled-day note refused
   was dropped by BOTH queues. That gap is now closed and the tripwire
   is spent — the two feeds are pinned POSITIVELY, one per refusal
   class, because a dropped note is invisible on the surface and only a
   queue read can tell "retried later" from "silently lost":

     RETRYABLE refusal ('pull-in-flight', after observable progress)
       -> tnDeferRow queues it: the row reads todayNoteDeferred true,
          receipt todayNoteQueued 1, todayNoteUnreadFinal 0, and the
          deferred queue holds exactly that (patient, day, code) — with
          no name on it. niSyncFromReceipt must NOT also adopt it (the
          third queue that guard exists to prevent).
     NON-RETRYABLE refusal ('athena-shrugged' -> code 'other')
       -> nothing defers it, so niSyncFromReceipt's revoked early
          return is what stands between it and the idle backfill: the
          idle queue must gain exactly that (patient, day, code).

   In BOTH classes the note stays verdict-neutral: the row's chart
   facts were read and saved, so the row and the batch still complete.
   =================================================================== */

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
/* dayfacts-1.0.0: historical body traversal is the ONE thing the checkbox
   still gates, so it needs its own counter — a day-facts batch may open
   charts freely but must never ask the extension for visit bodies. */
let allVisitsRequests = 0;
/* dayfacts-1.0.1: the pulled-day encounter note is MANDATORY in both modes and
   is read through window.__mlsVisitSavePref.runForPatient with a date-SCOPED
   {onlyDate}. Every such call is recorded so "day-facts really attempted the
   pulled day's note" is a COUNT with the day on it, never a tolerance. */
const dayNoteCalls = [];
/* 'ok' | 'deferrable-refusal' (a TIMING class the engine may retry immediately)
   | 'hard-refusal' (outside the deferrable vocabulary, so only the persistent
   idle backfill can still recover it) — one refusal per retry FEED. */
let dayNoteMode = 'ok';
let pingCalls = 0;
/* the owner-pinned live extension; the scoped-read capability gate needs a
   pong version >= 3.0.30 before it will attempt any onlyDate read at all. */
const EXT_VERSION = '3.0.76';
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
/* qol-2.0: the engine resolves the bodies preference through the ONE
   resolver — install the REAL shipped resolver over this harness's store. */
context.__mlsVisitNotesPref = require('./lib-visit-notes-resolver.js').makeResolver(context.uns, context.localStorage);
/* Every low-level history call in this identity-focused harness must carry a
   real, settled choice. Unset is deliberately a no-read state now. */
assert.strictEqual(context.__mlsVisitNotesPref.write(true), true,
  'identity harness could not persist explicit Full Notes ON');
assert.strictEqual(context.__mlsVisitNotesPref.read().state, 'on');
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
  /* the one-pong-per-batch scoped-read capability probe. Answering it is what
     lets the day-note leg run at all, so the harness must be a FAITHFUL
     extension here: the reply carries the request id the bridge minted. */
  if (msg && msg.type === 'mlsPing') {
    pingCalls++;
    queueMicrotask(() => {
      const event = { data: { source: 'mls-ext', type: 'mlsPong', requestId: msg.requestId,
        resp: { ok: true, version: EXT_VERSION, requestId: msg.requestId } } };
      Array.from(listeners).forEach(fn => fn(event));
    });
    return;
  }
  if (!msg || msg.type !== 'mlsAppReadAllVisits') return;
  allVisitsRequests++;
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
/* dayfacts-1.0.1: THE PULLED-DAY NOTE READER. The engine reaches it as
   window.__mlsVisitSavePref.runForPatient(storePatient, say, { onlyDate }) —
   the same chain the tail pass uses. The mock refuses anything that is not a
   real store patient or is not date-scoped, so a lane that drifted back to an
   unscoped whole-history read would fail here rather than quietly pass. */
context.__mlsVisitSavePref = {
  runForPatient: (patient, _say, opts) => {
    assert(patient && patients.indexOf(patient) >= 0,
      'the pulled-day note reader was handed something other than the live store patient');
    const onlyDate = String((opts && opts.onlyDate) || '');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(onlyDate),
      'the pulled-day note read was not scoped to an exact day (onlyDate missing or malformed)');
    dayNoteCalls.push({ patientId: String(patient.id || ''), onlyDate: onlyDate });
    if (dayNoteMode === 'deferrable-refusal') return Promise.resolve({ ok: false, reason: 'pull-in-flight' });
    if (dayNoteMode === 'hard-refusal') return Promise.resolve({ ok: false, reason: 'athena-shrugged' });
    return Promise.resolve({ ok: true, visits: 1, onlyDate: onlyDate });
  }
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
/* Derive the release identity from the canonical owner instead of freezing an
   obsolete label. The executed API must expose exactly the version it loaded. */
const canonicalVersion = source.match(/\bvar VERSION = ["']([^"']+)["'];/);
assert(canonicalVersion && /^si-[A-Za-z0-9._-]+$/.test(canonicalVersion[1]),
  'schedule importer canonical version marker is missing or malformed');
assert(api && api.version === canonicalVersion[1],
  'executed schedule importer API does not match its canonical version marker');

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

  /* The harness already froze Full Notes ON through the shipped resolver;
     these sections exercise complete chart and encounter-body proofs. */
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

  /* dayfacts-1.0.1: a day-facts row is a SCHEDULE row, so it carries the day
     the pull targeted — that day, and never "today", is what the pulled-day
     note leg must ask for. Keeping the fixture day deliberately in the past
     (a) proves the read is scoped to the PULLED day rather than to the clock,
     and (b) keeps the not-yet-seen/future-day skips out of the way so a real
     read is the only way these pins can go green. */
  const dayFactsDay = '2026-07-22';
  const acctToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  assert(dayFactsDay < acctToday,
    'the day-facts fixture day is no longer in the past — the day-note pins would grade a future-day skip');
  const dayFactsRowA = {
    patient_external_id: patients[0].id, _mlsTargetPatientId: patients[0].id,
    _mlsTargetDob: patients[0].dob, _mlsTargetMrn: patients[0].mrn, date: dayFactsDay,
    name: patients[0].name, dob: patients[0].dob, mrn: patients[0].mrn
  };
  const dayFactsRowB = {
    patient_external_id: patients[1].id, _mlsTargetPatientId: patients[1].id,
    _mlsTargetDob: patients[1].dob, _mlsTargetMrn: patients[1].mrn, date: dayFactsDay,
    name: patients[1].name, dob: patients[1].dob, mrn: patients[1].mrn
  };

  /* ===== dayfacts-1.0.0 (owner 2026-08-25): OFF is DAY-FACTS, not a no-op ==
     The retired pins here demanded a schedule-only no-op — historyRequested
     false, reason 'visit-notes-off', requested 0, and above all ZERO chart
     opens and ZERO chart saves. Under the superseding day contract that is
     exactly backwards: settled OFF still owes every exact scheduled row an
     identity-verified chart open and a chart-facts save; only the HISTORICAL
     body traversal is dropped. Each old pin below has a new-contract
     replacement — nothing was merely removed. */
  {
    assert.strictEqual(context.__mlsVisitNotesPref.write(false), true,
      'identity harness could not persist explicit Full Notes OFF');
    assert.strictEqual(context.__mlsVisitNotesPref.read().state, 'off');
    assert.strictEqual(context.__mlsVisitNotesPref.read().settled, true,
      'day-facts mode requires a SETTLED off, never a provisional one');
    /* the first chart read of the batch answers without a coverage receipt, so
       this also proves the bounded open+verify retry still runs under OFF. */
    assistMode = 'missing-coverage-once';
    const callsBefore = assistCalls;
    const savesBefore = chartSaves;
    const bodyReadsBefore = allVisitsRequests;
    /* instrument reachability: a body-read counter that never fired in the ON
       lane would make every "day-facts read no bodies" pin below vacuous. */
    assert(bodyReadsBefore > 0, 'the historical-body counter never fired for Full Notes ON — the OFF pins would prove nothing');
    /* the mirror image, and the reason the day-note pins below mean something:
       the ON lane gets its bodies from the full traversal and must NEVER have
       spent a scoped onlyDate read. Every day-note call from here on is one
       day-facts caused. */
    assert.strictEqual(dayNoteCalls.length, 0,
      'the Full Notes ON lane spent a scoped pulled-day read — the day-facts day-note counter is contaminated');
    const dayNoteCallsBefore = dayNoteCalls.length;
    const pingsBefore = pingCalls;
    const visitsABefore = patients[0].visits.length;
    const visitsBBefore = patients[1].visits.length;
    const offReceipt = await api._runHistoryBatch([dayFactsRowA, dayFactsRowB], [], () => {});

    /* --- the mode declaration itself --- */
    assert.strictEqual(offReceipt.complete, true, 'settled OFF day-facts batch did not settle complete');
    assert.strictEqual(offReceipt.visitNotesRequested, false, 'day-facts must still declare visit bodies NOT requested');
    assert.strictEqual(offReceipt.visitNotesMode, 'day-facts',
      'settled OFF must report day-facts mode, never the retired schedule-only lane');
    assert.strictEqual(offReceipt.chartFactsRequired, true, 'chart facts are the mandatory floor in BOTH modes');
    assert.strictEqual(offReceipt.allVisitBodiesRequested, false, 'the checkbox is OFF, so all-bodies must read false');
    assert.notStrictEqual(offReceipt.reason, 'visit-notes-off',
      'the retired schedule-only no-op reason was reasserted on a day-facts receipt');
    assert.strictEqual(offReceipt.reason, 'complete', 'day-facts receipt did not settle with a completion reason');
    assert.notStrictEqual(offReceipt.historyRequested, false,
      'a day-facts batch that really ran must never report history as unrequested');
    assert.strictEqual(offReceipt.notRequestedRows, undefined,
      'day-facts rows are requested work, so none may be counted as not-requested');

    /* --- insurance is declared honestly, never as verified-none --- */
    assert.strictEqual(offReceipt.insuranceAttempted, 0, 'no insurance reader ships yet, so zero attempts is the honest count');
    assert.strictEqual(offReceipt.insuranceComplete, false, 'a missing insurance reader must never report complete');
    assert.strictEqual(offReceipt.benefitsComplete, false, 'a missing benefits reader must never report complete');
    assert.strictEqual(offReceipt.insuranceReason, 'reader-not-shipped',
      'the insurance placeholder must name the missing reader, not invent a clinical verdict');

    /* --- every exact row was actually worked --- */
    assert.strictEqual(offReceipt.requested, 2, 'day-facts must request every exact scheduled row');
    assert.strictEqual(offReceipt.processed, 2, 'day-facts skipped a scheduled row');
    assert.strictEqual(offReceipt.patients.length, 2, 'day-facts produced no per-patient receipt');
    assert.strictEqual(offReceipt.retry.length, 0, 'a clean day-facts batch left rows in retry');
    assert.strictEqual(offReceipt.failures, 0, 'a clean day-facts batch reported failures');
    offReceipt.patients.forEach(one => {
      assert.strictEqual(one.identityVerified, true, 'day-facts row was worked without identity verification');
      assert.strictEqual(one.dobVerified, true, 'day-facts row skipped the DOB/MRN chart proof');
      assert.strictEqual(one.dayNoteChartOpen, true, 'day-facts row never opened a chart');
      assert.strictEqual(one.organized, true, 'day-facts row did not organize its chart facts');
      assert.strictEqual(one.organizationComplete, true, 'day-facts row left chart-facts organization incomplete');
      assert.strictEqual(one.parsePipelined, true, 'day-facts must take the pipelined-parse branch');
      assert.strictEqual(one.visitsSkipped, true, 'day-facts must record the skipped historical traversal honestly');
      assert.strictEqual(one.visitsComplete, true, 'a deliberately skipped visits stage still settles');
      assert.strictEqual(one.complete, true, 'day-facts row did not complete');
      assert.strictEqual(one.chartCoverage.readerVersion, '2.9.19-chart-r3',
        'day-facts row carries no fresh chart-coverage receipt, so no chart was really read');
      assert.strictEqual(one.profileCoverage.exactIdentityVerified, true,
        'day-facts chart facts were saved without exact identity proof');
    });
    assert.strictEqual(offReceipt.patients[0].chartRetried, true,
      'the bounded open+verify chart retry must still run under day-facts');

    /* --- the charts really opened and the facts really saved --- */
    assert.strictEqual(assistCalls - callsBefore, 3,
      'day-facts must perform a fresh chart read per row (2 rows + exactly one coverage retry)');
    assert.strictEqual(chartSaves - savesBefore, 2, 'day-facts must save chart facts for every exact row');
    assert.strictEqual(offReceipt.chartOpens.history, 3, 'day-facts chart-open accounting does not match the reads it made');
    assert.strictEqual(offReceipt.chartOpens.rows, 2);

    /* --- and ONLY the historical bodies were skipped --- */
    assert.strictEqual(allVisitsRequests, bodyReadsBefore,
      'day-facts asked the extension for historical visit bodies');
    assert.strictEqual(patients[0].visits.length, visitsABefore, 'day-facts persisted historical visit bodies');
    assert.strictEqual(patients[1].visits.length, visitsBBefore, 'day-facts persisted historical visit bodies');

    /* ===== dayfacts-1.0.1: THE PULLED-DAY NOTE IS THE OTHER HALF OF THE FLOOR
       The round-1 pins here were zeroes with an engine-gap TODO: both day-note
       lanes were hard-disabled for OFF (pulledDayNoteLaneEnabled/
       pulledDayNoteTailEnabled = false) and every helper short-circuited on
       `receipt.visitNotesRequested !== true`. The engine lifted all of that, so
       tolerating the lane is no longer good enough — day-facts must now PROVE
       it attempted exactly the pulled day's encounter note, per row, scoped to
       the pulled day, through the ordinary reader. */
    assert.strictEqual(dayNoteCalls.length - dayNoteCallsBefore, 2,
      'day-facts did not attempt the pulled-day note once per exact scheduled row');
    assert.deepStrictEqual(Array.from(dayNoteCalls.slice(dayNoteCallsBefore), one => one.patientId).sort(),
      [patients[0].id, patients[1].id].sort(),
      'the pulled-day note was read for the wrong patients, or twice for one of them');
    dayNoteCalls.slice(dayNoteCallsBefore).forEach(one => {
      assert.strictEqual(one.onlyDate, dayFactsDay,
        'the pulled-day note read was not scoped to the day the pull targeted');
    });
    assert(pingCalls > pingsBefore,
      'the scoped-read capability was assumed instead of proven by a pong');
    /* the receipt has to say the same thing the reader did */
    assert.strictEqual(offReceipt.todayNoteRead, 2, 'day-facts read both pulled-day notes but did not report them');
    assert.strictEqual(offReceipt.todayNoteFailures, 0, 'a clean day-facts batch reported an unread pulled-day note');
    assert.strictEqual(offReceipt.todayNoteNotYet, 0, 'a PAST pulled day was misreported as not-yet-seen');
    assert.strictEqual(offReceipt.todayNoteFutureDay, 0, 'a PAST pulled day was misreported as a future day');
    assert.strictEqual(offReceipt.todayNoteNotRequested, 0,
      'the retired checkbox short-circuit is back: day-facts reported the pulled-day note as not-requested');
    assert.strictEqual(offReceipt.chartOpens.dayNote, 2,
      'the pulled-day note reads were not counted at the chart-open door');
    assert.strictEqual(offReceipt.chartOpens.total, offReceipt.chartOpens.history + offReceipt.chartOpens.dayNote);
    offReceipt.patients.forEach(one => {
      assert.strictEqual(one.todayNote, true, 'a day-facts row did not come back with its pulled-day note read');
      assert.strictEqual(one.todayNoteAttempts, 1, 'the pulled-day note was attempted more than once for one row');
      assert(Number.isFinite(one.todayNoteMs) && one.todayNoteMs >= 0,
        'the pulled-day note leg was not measured (todayNoteMs missing)');
      assert.notStrictEqual(String(one.todayNoteReason || ''), 'visit-notes-off',
        'the retired visit-notes-off stamp vocabulary reappeared on a day-facts row');
      assert.notStrictEqual(one.todayNote, 'not-requested',
        'a day-facts row reported its pulled-day note as not-requested');
    });
    assistMode = 'complete';
  }

  /* dayfacts-1.0.0: day-facts is a mandatory floor, not a completeness
     laundry. A row the importer could not bind to exact identity proof must
     still fail closed inside an OFF batch — the old no-op could not express
     this at all, because it never accepted rows in the first place. */
  {
    const callsBefore = assistCalls;
    const dayNoteCallsBefore = dayNoteCalls.length;
    /* its OWN day: the day ledger records a note read per (day, patient), and a
       second batch on the same day would legitimately skip the open as
       already-read — which would silently hollow out the pins below. */
    const failClosedDay = '2026-07-23';
    const dayFactsFailClosed = await api._runHistoryBatch([Object.assign({}, dayFactsRowA, { date: failClosedDay })],
      [{ patientId: patients[2].id, name: patients[2].name, reason: 'missing-source-dob-mrn-proof' }], () => {});
    assert.strictEqual(dayFactsFailClosed.visitNotesMode, 'day-facts');
    assert.strictEqual(dayFactsFailClosed.requested, 2, 'an unresolved row vanished from the day-facts receipt');
    assert.strictEqual(dayFactsFailClosed.complete, false, 'day-facts reported complete while a row stayed unresolved');
    assert.strictEqual(dayFactsFailClosed.retry.length, 1, 'the unresolved row was not retained for retry');
    assert.strictEqual(dayFactsFailClosed.retry[0].reason, 'missing-source-dob-mrn-proof',
      'the unresolved row lost its honest fail-closed reason');
    assert.strictEqual(dayFactsFailClosed.failures, 1, 'day-facts under-counted its failures');
    assert.strictEqual(assistCalls - callsBefore, 1,
      'day-facts opened a chart for a row with no exact identity proof');
    /* the mandatory floor still applies to the row that DID resolve, and only
       to that row: an unresolved row never reaches the pulled-day reader. */
    assert.strictEqual(dayNoteCalls.length - dayNoteCallsBefore, 1,
      'a partially failing day-facts batch dropped (or duplicated) the resolved row\'s pulled-day note');
    assert.strictEqual(dayNoteCalls[dayNoteCalls.length - 1].onlyDate, failClosedDay,
      'the pulled-day note read did not follow the batch to its own day');
    assert.strictEqual(dayFactsFailClosed.todayNoteRead, 1, 'the resolved row\'s pulled-day note was not reported read');
    assert.strictEqual(dayFactsFailClosed.todayNoteNotRequested, 0,
      'a fail-closed day-facts batch reverted to not-requested day-note vocabulary');
  }

  /* ===== dayfacts-1.0.1: A REFUSED PULLED-DAY NOTE IS STILL DAY-FACTS WORK ===
     The note leg is deliberately verdict-neutral for the row's history, and a
     TIMING-class refusal ('pull-in-flight') is the one class the engine calls
     retryable. This block holds the engine to both halves of that: the row's
     history verdict survives the refusal, and the refusal is HANDED ON to the
     immediate deferred round rather than dropped (feed 1 of 2). */
  {
    const deferrableDay = '2026-07-24';
    const callsBefore = assistCalls;
    const dayNoteCallsBefore = dayNoteCalls.length;
    dayNoteMode = 'deferrable-refusal';
    const refused = await api._runHistoryBatch([Object.assign({}, dayFactsRowA, { date: deferrableDay })], [], () => {});
    dayNoteMode = 'ok';
    assert.strictEqual(dayNoteCalls.length - dayNoteCallsBefore, 1, 'the refused pulled-day note was never attempted');
    assert.strictEqual(assistCalls - callsBefore, 1, 'a refused pulled-day note bought a second chart open in the same batch');
    const refusedRow = refused.patients[0];
    assert.strictEqual(refusedRow.todayNote, false, 'a refused pulled-day note was recorded as read');
    assert.strictEqual(refusedRow.todayNoteReason, 'pull-in-flight', 'the reader\'s own refusal reason was rewritten');
    assert.strictEqual(refused.todayNoteFailures, 1, 'the refused pulled-day note was not counted');
    assert.strictEqual(refused.todayNoteNotRequested, 0,
      'a refused day-facts note was laundered back into not-requested');
    /* the row's HISTORY verdict is untouched — chart facts were read and saved */
    assert.strictEqual(refusedRow.organized, true, 'a refused pulled-day note undid the row\'s chart-facts work');
    assert.strictEqual(refusedRow.complete, true, 'a refused pulled-day note failed the row\'s history verdict');
    assert.strictEqual(refused.complete, true, 'a refused pulled-day note failed the whole day-facts batch');
    assert.strictEqual(refused.failures, 0, 'the note column was allowed to move the batch failure tally');

    /* RECOVERY of the round-2 tripwire (feed 1 of 2). tnDeferRow's guard used
       to read `|| receipt.visitNotesRequested !== true`, which dropped every
       day-facts row on the floor; the checkbox term is gone, so the retryable
       refusal must now be QUEUED. This pair keeps the pins honest: the engine
       classified the refusal as deferrable AND recorded the observable
       progress a retry is allowed to bet on, which is the branch that CALLS
       tnDeferRow — so a red pin below means the queue refused the row, never
       that the row failed to reach the queue. */
    assert.strictEqual(refusedRow.dayNoteChartOpen, true, 'the refused row never had its chart opened');
    assert.strictEqual(refusedRow.todayNoteProgress, 'chart-open',
      'the refusal never reached the deferred-retry branch, so the queue pins below would prove nothing');
    assert.strictEqual(refusedRow.todayNoteDeferred, true,
      'the retired checkbox guard is back in tnDeferRow: a retryable day-facts note refusal was dropped instead of queued');
    assert.strictEqual(refused.todayNoteQueued, 1,
      'the deferred day-facts row was not counted as queued on its receipt');
    assert.strictEqual(refused.todayNoteUnreadFinal, 0,
      'a queued row is not finally unread — the receipt reported the deferred note as a final miss');
    /* the receipt's reason census is built INSIDE the vm realm, so it is
       compared field-by-field — a cross-realm deepStrictEqual would fail on
       prototypes alone and grade the realm instead of the engine. */
    assert.deepStrictEqual(Object.keys(refused.todayNoteReasonCodes || {}), ['pull-in-flight'],
      'the refusal lost its closed-vocabulary reason code on the way to the receipt');
    assert.strictEqual(refused.todayNoteReasonCodes['pull-in-flight'], 1,
      'the refused day-facts note was miscounted in the reason-code census');
    assert.strictEqual(Number(refused.todayNoteDeferred && refused.todayNoteDeferred.queued), 1,
      'the receipt-level deferred descriptor did not record the queued day-facts row');
    /* the queue itself, not just the receipt's word for it */
    const tnQueue = api._todayNoteDeferred();
    assert.strictEqual(tnQueue.queued, 1, 'the deferred today-note queue did not actually take the day-facts row');
    assert.strictEqual(tnQueue.rows.length, 1, 'the deferred queue holds more (or fewer) rows than the one refusal');
    assert.strictEqual(tnQueue.rows[0].patientId, patients[0].id, 'the deferred queue took the wrong patient');
    assert.strictEqual(tnQueue.rows[0].day, deferrableDay, 'the deferred queue lost the day the pull targeted');
    assert.strictEqual(tnQueue.rows[0].code, 'pull-in-flight', 'the deferred queue lost the refusal\'s reason code');
    /* dnbf-1.0.0: the backfill's receipt is codes and counts — the cheapest
       guarantee that no name leaks is that no name is ever on the queue. */
    assert.strictEqual(JSON.stringify(tnQueue.rows).includes(patients[0].name), false,
      'a patient name rode the deferred today-note queue');
    /* feed 2 must NOT also take it: a row _tnDefer still owns has not finished,
       and enqueuing it here is the third queue niSyncFromReceipt guards against. */
    assert.strictEqual(api._notesIdle().rows.filter(one =>
      one.patientId === patients[0].id && one.day === deferrableDay).length, 0,
      'a row the deferred round still owns was ALSO adopted by the idle backfill (double-queued)');
  }

  /* ===== dayfacts-1.0.1 (feed 2 of 2): A NON-RETRYABLE DAY-FACTS REFUSAL
     REACHES THE IDLE BACKFILL ================================================
     niSyncFromReceipt used to open with `if (receipt.visitNotesRequested !==
     true) return 0;` — under the day contract that dropped every day-facts
     note the immediate round did not own. The early return is revoked, so a
     refusal nothing defers must now land in the persistent idle queue. The
     refusal reason is deliberately OUTSIDE the deferrable vocabulary so
     tnDeferRow cannot claim the row and mask this feed. */
  {
    const idleFeedDay = '2026-07-25';
    const idleBefore = api._notesIdle().rows.length;
    const dayNoteCallsBefore = dayNoteCalls.length;
    dayNoteMode = 'hard-refusal';
    const stranded = await api._runHistoryBatch([Object.assign({}, dayFactsRowA, { date: idleFeedDay })], [], () => {});
    dayNoteMode = 'ok';
    assert.strictEqual(dayNoteCalls.length - dayNoteCallsBefore, 1, 'the non-retryable pulled-day note was never attempted');
    const strandedRow = stranded.patients[0];
    assert.strictEqual(strandedRow.todayNote, false, 'a refused pulled-day note was recorded as read');
    assert.strictEqual(strandedRow.todayNoteReason, 'athena-shrugged', 'the reader\'s own refusal reason was rewritten');
    assert.notStrictEqual(strandedRow.todayNoteDeferred, true,
      'a NON-retryable refusal was put on the immediate retry queue — this block can no longer prove the idle feed');
    assert.strictEqual(stranded.todayNoteQueued, 0, 'the receipt claimed an immediate retry that was never queued');
    assert.strictEqual(stranded.todayNoteNotRequested, 0,
      'the retired checkbox short-circuit is back: a day-facts note was reported as not-requested');
    /* the note stays verdict-neutral for the row's history, in this class too */
    assert.strictEqual(strandedRow.organized, true, 'a refused pulled-day note undid the row\'s chart-facts work');
    assert.strictEqual(strandedRow.complete, true, 'a refused pulled-day note failed the row\'s history verdict');
    assert.strictEqual(stranded.complete, true, 'a refused pulled-day note failed the whole day-facts batch');
    assert.strictEqual(stranded.failures, 0, 'the note column was allowed to move the batch failure tally');
    /* THE PIN: the revoked early return would leave this queue untouched. */
    const idleRows = api._notesIdle().rows;
    assert.strictEqual(idleRows.length, idleBefore + 1,
      'niSyncFromReceipt refused a day-facts receipt: the unread pulled-day note reached no queue at all');
    const adopted = idleRows.filter(one => one.patientId === patients[0].id && one.day === idleFeedDay);
    assert.strictEqual(adopted.length, 1, 'the idle backfill adopted the wrong row (or duplicated it)');
    assert.strictEqual(adopted[0].state, 'queued', 'the adopted row was parked in a non-retrying state');
    assert.strictEqual(adopted[0].code, 'other', 'the refusal reached the idle queue without its closed-vocabulary code');
    assert.strictEqual(JSON.stringify(idleRows).includes(patients[0].name), false,
      'a patient name rode the idle notes queue');
    /* and the drain the feed exists to serve is OPEN for a settled OFF account:
       an idle queue nothing may read is the same silent drop wearing a queue. */
    assert.notStrictEqual(api._notesIdleGate(true).reason, 'visit-notes-unchosen',
      'the idle drain still treats a settled day-facts account as unchosen');
  }

  /* dayfacts-1.0.0: UNSET is now the ONLY zero-read state. The batch is a
     compatibility/test seam reachable without the admission gate, so an
     account that never made the choice must get a blocked receipt and not a
     single chart open — this replaces the old silent OFF no-op wholesale. */
  {
    ['visitNotesModeV2', 'pullVisitBodies', 'pullVisitBodiesSet'].forEach(k => store.delete(context.uns(k)));
    store.delete('mls_save_every_athena_visit');
    const unchosen = context.__mlsVisitNotesPref.read();
    assert.strictEqual(unchosen.state, 'unset', 'harness could not return the preference to unchosen');
    assert.strictEqual(unchosen.settled, true, 'the unchosen probe must run on a real (settled) namespace');
    const callsBefore = assistCalls;
    const savesBefore = chartSaves;
    const bodyReadsBefore = allVisitsRequests;
    const dayNoteCallsBefore = dayNoteCalls.length;
    const blocked = await api._runHistoryBatch([dayFactsRowA, dayFactsRowB], [], () => {});
    assert.strictEqual(blocked.reason, 'visit-notes-unchosen', 'an unchosen account did not get the blocked reason');
    assert.strictEqual(blocked.visitNotesMode, 'blocked-unchosen',
      'an unchosen account was run in day-facts mode instead of being blocked');
    assert.strictEqual(blocked.historyRequested, false, 'a blocked receipt must declare history unrequested');
    assert.strictEqual(blocked.complete, true, 'the blocked receipt must settle honestly, not hang as incomplete');
    assert.strictEqual(blocked.requested, 0);
    assert.strictEqual(blocked.processed, 0);
    assert.strictEqual(blocked.notRequestedRows, 2, 'the blocked receipt must account for every refused row');
    assert.strictEqual(blocked.todayNoteNotRequested, 2);
    assert.strictEqual(blocked.patients.length, 0, 'a blocked batch produced per-patient work');
    assert.strictEqual(blocked.retry.length, 0);
    assert.strictEqual(blocked.failures, 0, 'a refusal to start is not a failure');
    assert.strictEqual(assistCalls, callsBefore, 'an unchosen account had an Athena chart opened on its behalf');
    assert.strictEqual(chartSaves, savesBefore, 'an unchosen account had a chart parsed or saved');
    assert.strictEqual(allVisitsRequests, bodyReadsBefore, 'an unchosen account had visit bodies read');
    assert.strictEqual(dayNoteCalls.length, dayNoteCallsBefore,
      'an unchosen account had its pulled-day encounter note read — the blocked door leaks into the day-note lane');
  }

  console.log('PASS adversarial schedule identity, source-proof history binding, fresh chart coverage, full visit-reader receipt, dayfacts-1.0.1 chart-facts + scoped pulled-day note on OFF, BOTH day-note retry feeds (deferred queue + idle backfill) fed by a day-facts receipt, and zero-read UNCHOSEN');
})().catch(err => { console.error(err); process.exit(1); });
