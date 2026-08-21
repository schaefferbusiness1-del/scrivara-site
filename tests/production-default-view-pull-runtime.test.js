'use strict';

/* Production regression for the live b1025 default-view refusal.
 *
 * A complete, non-empty Day schedule is sufficient evidence for importing
 * the exact appointment census selected by Athena's current/default view.
 * A legacy reader may still be unable to prove a practice-wide provider
 * roster or row-to-provider attribution. That missing provider proof must stay
 * visible and must never be guessed, but it must not prevent the production
 * history pipeline from reading the exact patients on the proven schedule.
 *
 * A deliberately selected provider is a different capability: without a
 * complete canonical roster it remains fail-closed. This test executes the
 * real production importer for both sides of that boundary. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

const DAY = '2026-08-18';
const patient = {
  id: 'synthetic-patient-1',
  athenaPatientId: 'synthetic-patient-1',
  name: 'Synthetic Patient One',
  dob: '01/02/1960',
  visits: []
};
const providerHeaders = [
  { id: 'provider-a', stableKey: 'athena:provider-a', name: 'Provider Alpha, MD', rosterVerified: false },
  { id: 'provider-b', stableKey: 'athena:provider-b', name: 'Provider Beta, DO', rosterVerified: false }
];
const profileCoverage = {
  complete: true, exactIdentityVerified: true, patientId: patient.id,
  cards: {
    problems: { status: 'found', populated: true },
    meds: { status: 'found', populated: true },
    allergies: { status: 'found', populated: true },
    summary: { status: 'found', populated: true },
    vitals: { status: 'found', populated: true },
    history: { status: 'found', populated: true }
  }
};

const listeners = new Set();
const store = new Map();
const resumeRecords = [];
const posted = [];
const savedBodies = [];
const backendAppointments = [];
const statuses = [];
let historyReads = 0;
let chartReads = 0;
let armedRosterOperation = null;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function boundLegacyRosterReceipt() {
  return Object.assign({
    complete: false,
    partial: true,
    reason: 'legacy-unverified',
    observed: providerHeaders.length,
    observedCount: providerHeaders.length,
    targetDate: DAY,
    providerMode: 'all',
    requestedProviderId: '',
    requestedProviderStableKey: '',
    attributionCoverage: {
      verdict: 'row-unattributed', rows: 1,
      headerCount: providerHeaders.length, unattributedRows: 1, foreignRows: 0
    }
  }, armedRosterOperation ? {
    requestId: armedRosterOperation.requestId,
    targetDate: armedRosterOperation.targetDate,
    providerMode: armedRosterOperation.providerMode,
    requestedProviderId: armedRosterOperation.requestedProviderId,
    requestedProviderStableKey: armedRosterOperation.requestedProviderStableKey
  } : {});
}

const context = {
  console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number,
  Boolean, RegExp, Error, TypeError, encodeURIComponent, decodeURIComponent,
  queueMicrotask, setTimeout, clearTimeout,
  setInterval: () => 1,
  clearInterval: () => {},
  location: { pathname: '/ScribeFlow.html', origin: 'https://synthetic.invalid' },
  localStorage: {
    getItem(key) { return store.has(String(key)) ? store.get(String(key)) : null; },
    setItem(key, value) {
      store.set(String(key), String(value));
      if (/pullResumeV1$/i.test(String(key))) {
        try { resumeRecords.push(JSON.parse(String(value))); } catch (_) {}
      }
    },
    removeItem(key) { store.delete(String(key)); }
  },
  document: {
    readyState: 'complete',
    querySelectorAll: () => [],
    querySelector: () => null,
    getElementById: () => null,
    addEventListener: () => {},
    body: {}, head: {}, documentElement: {}
  },
  backendMode: () => true,
  bkToken: () => 'synthetic-token',
  bkBase: () => 'https://synthetic.invalid',
  uns: key => `production-default-test::${key}`,
  _normDate: value => String(value || '').slice(0, 10),
  _normTime: value => {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (!match) return '';
    let hour = Number(match[1]);
    if (match[3] && /PM/i.test(match[3]) && hour < 12) hour += 12;
    if (match[3] && /AM/i.test(match[3]) && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
  },
  _apptKey: (name, date, time) => `${String(name).trim().toLowerCase()}|${date}|${time}`,
  _acctWallToUtcIso: (date, time) => `${date}T${time}:00.000Z`,
  getPatients: () => [patient],
  upsertPatient: () => {},
  loadCalendar: () => {
    context._calAppts = clone(backendAppointments);
    return Promise.resolve({ applied: true });
  },
  renderTodayPicker: () => {},
  renderHistory: () => {},
  renderProfile: () => {},
  loadPatients: () => {},
  _athenaHistoryTargetSnapshot: ref => ref && ref.patientId === patient.id
    ? { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: '' }
    : null,
  _hasImportedHistory: target => !!(target && target.patientId === patient.id),
  _athenaHistoryProofMatches: (target, observed) => target.patientId === patient.id &&
    observed.chartName === patient.name && observed.chartDob === patient.dob,
  _assistReadChart: () => {
    chartReads++;
    const requestId = `synthetic-chart-${chartReads}`;
    const text = 'Synthetic verified problems medications allergies and history';
    return Promise.resolve({
      text, requestId, chartName: patient.name, chartDob: patient.dob, chartMrn: '',
      coverageReceipt: {
        kind: 'athena-chart-coverage', complete: true,
        readerVersion: '2.9.19-chart-r3', identityObserved: true,
        truncated: false, requestId, capturedAt: Date.now(),
        expectedClinicalFrames: 1, readClinicalFrames: 1, boundClinicalFrames: 1,
        unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0,
        omittedForCap: 0, textChars: text.length
      }
    });
  },
  _parsePatientChart: () => Promise.resolve({
    problems: 'Synthetic problem', meds: 'Synthetic medication',
    allergies: 'Synthetic allergy', summary: 'Synthetic summary',
    vitals: { bp: '120/80' }, history: { pmh: 'Synthetic PMH' },
    coverage: {
      problems: 'found', meds: 'found', allergies: 'found', summary: 'found',
      vitals: 'found', history: 'found'
    }
  }),
  _athenaChartProfileCoverage: () => profileCoverage,
  _athenaChartSnapshotFromChart: chart => ({
    problems: String(chart && chart.problems || ''), meds: String(chart && chart.meds || ''),
    allergies: String(chart && chart.allergies || ''), summary: String(chart && chart.summary || ''),
    vitals: Object.assign({}, chart && chart.vitals || {}),
    history: Object.assign({}, chart && chart.history || {}), visits: []
  }),
  _athenaChartSnapshotProof: snapshot => JSON.stringify(snapshot || {}),
  _athenaHistoryVerifiedRef: target => Object.freeze({
    patientId: target.patientId, name: target.name, dob: target.dob,
    verifiedName: target.name, verifiedDob: target.dob
  }),
  _savePatientChart: (ref, _row, chart) => {
    patient.athenaChartSnapshot = context._athenaChartSnapshotFromChart(chart);
    profileCoverage.capturedAt = new Date().toISOString();
    profileCoverage.saveRequestId = String(ref && ref.requestId || '');
    patient.athenaProfileCoverage = profileCoverage;
    return true;
  },
  _patientHistoryCardCoverage: () => patient.athenaProfileCoverage,
  fetch: async (_url, init) => {
    if (!init || !init.method) return { ok: true, json: async () => ({ appointments: clone(backendAppointments) }) };
    const body = JSON.parse(init.body);
    savedBodies.push(body);
    const id = `synthetic-appointment-${savedBodies.length}`;
    backendAppointments.push(Object.assign({ id }, body));
    return {
      ok: true, status: 200,
      json: async () => ({ ok: true, id })
    };
  }
};
context.window = context;

function saveVerifiedVisit(_id, raw, options) {
  options = options || {};
  const stored = Object.assign({}, raw, {
    source: options.source || 'athena-copy',
    identityVerified: options.identityVerified === true,
    identityBinding: options.identityBinding || patient.id,
    bodyComplete: options.bodyComplete === true && raw.fullDetail === true
  });
  const key = stored.encounterId || stored.sourceVisitKey;
  const prior = patient.visits.findIndex(visit => (visit.encounterId || visit.sourceVisitKey) === key);
  if (prior >= 0) patient.visits[prior] = stored;
  else patient.visits.push(stored);
  return stored;
}

context.__mlsVisitModel = {
  addVisit: saveVerifiedVisit,
  getVisits: () => patient.visits,
  reconcileVerifiedAthenaVisits: () => ({ complete: true, removed: 0, kept: patient.visits.length }),
  organizePatientHistory: () => ({ ok: true, verifiedVisits: patient.visits.length })
};
context.__mlsCopyVisits = {
  _saveVisits: (_p, _identity, visits) => {
    visits.forEach(visit => saveVerifiedVisit(patient.id, visit, {
      source: 'athena-copy', identityVerified: true,
      identityBinding: patient.id, bodyComplete: true
    }));
    return visits.length;
  },
  _visitIdentityAgrees: () => true
};

context.__mlsProviderRoster = {
  list: () => clone(providerHeaders),
  beginOperation(operation) {
    armedRosterOperation = Object.assign({}, operation || {});
    return clone(armedRosterOperation);
  },
  ingestResp: () => boundLegacyRosterReceipt(),
  getReceipt: () => boundLegacyRosterReceipt(),
  resolve(ref) {
    const raw = String(ref && typeof ref === 'object'
      ? (ref.stableKey || ref.id || ref.name || '') : (ref || '')).toLowerCase();
    const hit = providerHeaders.find(entry => [entry.stableKey, entry.id, entry.name]
      .some(value => String(value).toLowerCase() === raw));
    return hit ? clone(hit) : null;
  }
};

context.addEventListener = (_type, fn) => listeners.add(fn);
context.removeEventListener = (_type, fn) => listeners.delete(fn);
function emit(type, response, id) {
  const event = { data: { source: 'mls-ext', type, id: id || '', resp: response } };
  Array.from(listeners).forEach(fn => fn(event));
}

context.postMessage = message => {
  posted.push(message);
  if (message.type === 'mlsPing') {
    queueMicrotask(() => emit('mlsPong', { ok: true }, ''));
    return;
  }
  if (message.type === 'mlsAppGotoDate') {
    queueMicrotask(() => emit('mlsAppGotoDateResult', {
      id: message.id, requestId: message.requestId || message.id,
      ok: true, schedDate: DAY
    }, message.id));
    return;
  }
  if (message.type === 'mlsAppPullSchedule') {
    queueMicrotask(() => {
      const requestId = message.requestId || message.id;
      const rosterReceipt = Object.assign(boundLegacyRosterReceipt(), {
        requestId, targetDate: DAY, providerMode: 'all',
        requestedProviderId: '', requestedProviderStableKey: ''
      });
      emit('mlsAppScheduleResult', {
        id: message.id, requestId, ok: true, scheduleVerified: true,
        schedDate: DAY, text: `Verified synthetic Day schedule ${DAY}`,
        receipt: {
          complete: true, authoritativeEmpty: false, requestId,
          expectedCount: 1, parsedCount: 1, candidateCount: 1
        },
        appts: [{
          name: patient.name, dob: patient.dob, date: DAY, time: '9:20 AM',
          athenaPatientId: patient.id,
          athenaAppointmentId: 'synthetic-athena-appointment-1',
          provider: '', providerId: ''
        }],
        providers: providerHeaders.map(entry => entry.name),
        providerRoster: clone(providerHeaders),
        providerRosterReceipt: rosterReceipt,
        providerDiag: {
          providerNames: providerHeaders.map(entry => entry.name),
          attributionCoverage: {
            verdict: 'row-unattributed', rows: 1,
            headerCount: providerHeaders.length, unattributedRows: 1, foreignRows: 0
          }
        }
      }, message.id);
    });
    return;
  }
  if (message.type === 'mlsAppReadAllVisits') {
    historyReads++;
    queueMicrotask(() => {
      const response = {
        source: 'mls-ext', type: 'mlsAppAllVisitsResult',
        id: message.id, requestId: message.requestId || message.id,
        ok: true,
        visits: [{
          date: '2026-01-01', type: 'Office visit',
          raw: 'Synthetic verified prior visit with substantive clinical detail.',
          fullDetail: true, sourceVisitKey: 'synthetic-visit-1'
        }],
        receipt: {
          complete: true, indexComplete: true, bodyComplete: true,
          fullDetail: true, stableKeysComplete: true,
          expected: 1, parsed: 1, cap: 500,
          readerVersion: '2.9.22-visits-r4-two-stage'
        },
        readerVersion: '2.9.22-visits-r4-two-stage',
        identity: { name: patient.name, dob: patient.dob, mrn: '' }
      };
      Array.from(listeners).forEach(fn => fn({ data: response }));
    });
  }
};

vm.runInNewContext(source, context, {
  filename: 'feat_mls_schedimport_exact.js', timeout: 2000
});

async function withWatchdog(promise, label, ms = 12000) {
  let timer = null;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms);
    })
  ]).finally(() => { if (timer != null) clearTimeout(timer); });
}

(async () => {
  const result = await withWatchdog(context.__mlsSI.dayPull({
    date: DAY,
    provider: 'all',
    includeHistory: true,
    onStatus: message => statuses.push(String(message || ''))
  }), 'production default-view pull');

  assert.strictEqual(result.ok, true,
    'a complete default-view schedule was blocked by a legacy-unverified provider roster: ' +
    JSON.stringify({ reason: result.reason, providerRosterReceipt: result.providerRosterReceipt, providerReceipt: result.providerReceipt, calendarReceipt: result.calendarReceipt, authoritativeSnapshot: result.authoritativeSnapshot, historyReceipt: result.historyReceipt, identityBootstrapReceipt: result.identityBootstrapReceipt, failureReasons: result.failureReasons, unresolvedMappings: result.unresolvedMappings }));
  assert.strictEqual(result.complete, true, 'the exact default-view schedule/history pipeline did not complete');
  assert.strictEqual(result.reason, 'complete-appointment-census-with-history',
    'a completed appointment-census phase-two history read must use the current explicit terminal reason');
  assert.strictEqual(result.scheduleReceipt.complete, true);
  assert.strictEqual(result.scheduleReceipt.parsedCount, 1);

  /* Keep the provider limitation truthful in the returned evidence. The
     appointment scope may be complete without pretending the provider roster
     or row attribution became complete. */
  assert(result.providerRosterReceipt, 'the incomplete provider-roster evidence disappeared');
  assert.strictEqual(result.providerRosterReceipt.complete, false,
    'the default-view exception fabricated a complete practice provider roster');
  assert.strictEqual(result.providerRosterReceipt.partial, true);
  assert.strictEqual(result.providerRosterReceipt.reason, 'legacy-unverified');
  assert.strictEqual(result.appointmentCensusOnly, true,
    'the narrow provider-unknown completion was not identified as an appointment census');
  assert.strictEqual(result.providerAttributionComplete, false,
    'the appointment census was falsely promoted to provider attribution');
  assert(result.appointmentCensusReceipt && result.appointmentCensusReceipt.complete === true,
    'the exact appointment-census proof disappeared from the completion receipt');
  assert(result.providerReceipt, 'the appointment-scope receipt disappeared');
  assert.strictEqual(result.providerReceipt.sourceRows, 1);
  assert.strictEqual(result.providerReceipt.providerTaggedRows, 0);
  assert.strictEqual(result.providerReceipt.unattributedRows, 1);

  assert.strictEqual(savedBodies.length, 1, 'the proven appointment census was not imported exactly once');
  assert.strictEqual(String(savedBodies[0].provider || ''), '',
    'the default view guessed a provider onto an unattributed schedule row');
  assert(!providerHeaders.some(entry => savedBodies[0].provider === entry.name),
    'a visible provider header was guessed onto the patient row');

  assert.strictEqual(historyReads, 1,
    'production history/visits was skipped merely because provider attribution was unavailable');
  assert.strictEqual(chartReads, 1,
    'production chart-history cards were not read for the exact scheduled patient');
  assert(result.historyReceipt && result.historyReceipt.complete === true,
    'production history did not retain its existing verified completion contract');
  assert.strictEqual(result.historyReceipt.exactIdentityVerified, true);
  assert.strictEqual(result.historyReceipt.failures, 0);
  assert.strictEqual(patient.visits.length, 1, 'the verified prior visit was not stored');
  assert(resumeRecords.some(record => record && record.p1CensusEligible === true &&
      record.providerScope && record.providerScope.mode === 'all' && record.providerScope.source === 'day-caller'),
    'the guarded all-Day origin and census eligibility were not preserved in the bounded durable resume intent');
  assert(source.includes('if (p1ResumeCensusEligible) resumeOpts.__p1DayCensusToken = P1_DAY_CENSUS_TOKEN;'),
    'a same-intent guarded all-Day resume does not restore the private census capability');

  const appointmentCensus = context.__mlsSI.appointmentCensusStatusForDay(DAY);
  assert.strictEqual(appointmentCensus.exactAppointments, true,
    'the exact default-view appointment list was not available to production day consumers');
  assert.strictEqual(appointmentCensus.reason, 'exact-appointment-census');
  assert.strictEqual(appointmentCensus.providerAttributionComplete, false,
    'the display snapshot fabricated provider attribution');
  assert.strictEqual(appointmentCensus.coversPractice, false,
    'the default-view appointment census fabricated practice-wide coverage');
  assert.strictEqual(context.__mlsSI.appointmentCensusRowsForDay(DAY).length, 1,
    'the exact appointment-census snapshot did not expose its one proven backend appointment');
  const selectedAuthority = context.__mlsSI.authoritativeStatusForDay(DAY, {
    id: 'provider-a', stableKey: 'athena:provider-a', name: 'Provider Alpha, MD'
  });
  assert.strictEqual(selectedAuthority.exact, false,
    'provider-unknown rows leaked into a selected-provider authoritative slice');

  /* The same extension evidence cannot unlock the exported pull API. The
     private capability is minted only by dayPull after its visible lane gates. */
  const savesBeforeDirect = savedBodies.length;
  const historyBeforeDirect = historyReads;
  const direct = await withWatchdog(context.__mlsSI.pull({
    date: DAY,
    provider: 'all',
    includeHistory: true,
    onStatus: () => {}
  }), 'direct all-provider refusal');
  assert.strictEqual(direct.ok, false, 'the public pull API minted appointment-census authority');
  assert.strictEqual(direct.complete, false);
  assert.strictEqual(direct.reason, 'provider-roster-incomplete');
  assert.strictEqual(savedBodies.length, savesBeforeDirect,
    'the public pull API wrote provider-unknown rows');
  assert.strictEqual(historyReads, historyBeforeDirect,
    'the public pull API started history without the guarded Day capability');
  const directResume = context.__mlsSI.resumeState();
  assert(directResume && directResume.p1CensusEligible === false &&
      directResume.providerScope && directResume.providerScope.mode === 'all' &&
      directResume.providerScope.source === 'direct',
    'a direct public pull persisted the guarded Day census capability');

  const schedulesBeforeMonth = posted.filter(message => message.type === 'mlsAppPullSchedule').length;
  const savesBeforeMonth = savedBodies.length;
  const historyBeforeMonth = historyReads;
  const month = await withWatchdog(context.__mlsSI.pullMonth({
    month: '2026-08', dates: ['2026-08-12'], provider: 'all',
    includeHistory: true, onStatus: () => {}
  }), 'month all-provider refusal');
  assert.strictEqual(month.ok, false, 'month pull widened through incomplete provider proof');
  assert.strictEqual(month.complete, false);
  assert.strictEqual(month.reason, 'provider-roster-incomplete');
  assert.strictEqual(posted.filter(message => message.type === 'mlsAppPullSchedule').length, schedulesBeforeMonth,
    'the month route started a schedule read without complete provider proof');
  assert.strictEqual(savedBodies.length, savesBeforeMonth,
    'the month route wrote provider-unknown rows');
  assert.strictEqual(historyReads, historyBeforeMonth,
    'the month route started provider-unknown history work');

  const schedulePostsBeforeSelected = posted.filter(message => message.type === 'mlsAppPullSchedule').length;
  const savesBeforeSelected = savedBodies.length;
  const historyBeforeSelected = historyReads;
  const selected = await withWatchdog(context.__mlsSI.pull({
    date: DAY,
    provider: {
      id: 'provider-a', stableKey: 'athena:provider-a',
      name: 'Provider Alpha, MD', rosterVerified: true
    },
    includeHistory: true,
    onStatus: () => {}
  }), 'selected-provider refusal');

  assert.strictEqual(selected.ok, false, 'an explicitly selected provider widened through incomplete roster proof');
  assert.strictEqual(selected.complete, false);
  assert.strictEqual(selected.reason, 'provider-roster-incomplete');
  assert.strictEqual(posted.filter(message => message.type === 'mlsAppPullSchedule').length, schedulePostsBeforeSelected,
    'selected-provider insufficiency still started a schedule read');
  assert.strictEqual(savedBodies.length, savesBeforeSelected,
    'selected-provider insufficiency imported an appointment');
  assert.strictEqual(historyReads, historyBeforeSelected,
    'selected-provider insufficiency started patient history');

  console.log('PASS production default view: complete appointment census and exact history proceed without provider guessing; selected provider stays fail-closed');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
