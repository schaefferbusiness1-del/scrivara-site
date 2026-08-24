'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const siSource = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const rosterSource = fs.readFileSync(path.join(root, 'feat_athena_provider_roster.js'), 'utf8');
const calendarSource = fs.readFileSync(path.join(root, 'feat_mls_calendar_polish.js'), 'utf8');
const assistantSource = fs.readFileSync(path.join(root, 'feat_mls_asst_fix.js'), 'utf8');
const connectSource = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');

function functionBlock(source, name, from) {
  const start = source.indexOf(`function ${name}(`, from || 0);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

function monthDays(ym) {
  const [year, month] = ym.split('-').map(Number);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${ym}-${String(i + 1).padStart(2, '0')}`);
}

// Route wiring is deliberately checked only in the active Easy v3.7 workspace.
// Later bundled copies are guarded fallbacks and must not justify a production pass.
const activeStart = connectSource.indexOf("var VER = '3.7.3'", 15000);
const activeEnd = connectSource.indexOf('/* =========================================================================\n * MLS Scribe — PULL PIPELINE TRUTH PACK', activeStart);
assert(activeStart >= 0 && activeEnd > activeStart, 'active Staff workspace could not be isolated');
const activeStaff = connectSource.slice(activeStart, activeEnd);
const staffMonth = functionBlock(activeStaff, 'startMonthPull');
const staffDay = functionBlock(activeStaff, 'startDayPull');
for (const [label, block, method] of [
  ['Staff month', staffMonth, 'pullMonth'],
  ['Staff day', staffDay, 'pull']
]) {
  assert(block.includes('_resolveProviderRequest'), `${label} must preflight the canonical roster`);
  assert(block.includes(`.${method}(`), `${label} must use the exact managed ${method} route`);
  assert(block.includes('includeHistory: true'), `${label} must default verified history on`);
  assert(!block.includes('mlsAppPullSchedule'), `${label} must not invoke the legacy bridge directly`);
}
assert(staffMonth.includes('requireRosterForAll: true'), 'all-provider month pull must require a complete canonical roster');
assert(staffMonth.includes('retryDates'), 'Retry failed days must re-run only the recorded failed days');
assert(staffMonth.includes('dates: retryDates || undefined'), 'the failed-day subset must reach the exact pullMonth route');

const assistantPullStart = assistantSource.indexOf('function doPullHonest(');
const assistantPullEnd = assistantSource.indexOf('function takeoverPullButton(', assistantPullStart);
assert(assistantPullStart >= 0 && assistantPullEnd > assistantPullStart, 'Assistant exact pull route could not be isolated');
const assistantRoute = functionBlock(assistantSource, 'curSelDateProv') + '\n' + assistantSource.slice(assistantPullStart, assistantPullEnd);
assert(assistantRoute.includes('_resolveProviderRequest'), 'Assistant must preflight the canonical roster before pulling');
assert(!/pv\s*=\s*["']All doctors["']/.test(assistantRoute), 'Assistant must not pass the UI label "All doctors" as a provider identity');
assert(calendarSource.includes('api.pullCalendarSelection'), 'Calendar must use the exact guarded provider/day route');

const siBoot = functionBlock(siSource, 'boot');
const staffBoot = functionBlock(activeStaff, 'boot');
assert(!/\bpull(?:Month|CalendarSelection)?\s*\(/.test(siBoot), 'exact importer startup must remain Athena-passive');
assert(!/start(?:Month|Day)Pull\s*\(/.test(staffBoot), 'Staff startup must not start a pull');

function createHarness() {
  const listeners = new Set();
  const store = new Map();
  const posted = [];
  const backendRows = [];
  const savedBodies = [];
  const historyRefs = [];
  const gotoDates = [];
  const incompleteDays = new Set();
  const untaggedDays = new Set();
  const rowDays = new Map();
  const providerAlpha = {
    stableKey: 'backend:7', id: '7', raw: 'Schaeffer_Matthew_MD',
    name: 'Matthew Schaeffer, MD', rosterVerified: true
  };
  const providerNear = {
    stableKey: 'backend:8', id: '8', raw: 'Schaeffer_Michael_MD',
    name: 'Michael Schaeffer, MD', rosterVerified: true
  };
  const roster = [providerAlpha, providerNear];
  let rosterReceipt = {
    complete: true, partial: false, reason: 'complete', observedCount: 2,
    reachedEnd: true, restored: true
  };
  let currentDay = '';
  let createSeq = 0;
  const patient = {
    id: 'p-exact-100', name: 'Exact Patient', dob: '01/02/1960',
    mrn: 'MRN-100', athenaId: 'MRN-100', visits: []
  };
  const patients = [patient];
  const nodes = {
    calProvFilter: { value: '7' },
    calDayPanel: { style: { display: 'block' } }
  };

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function resolveProvider(ref) {
    let raw = ref;
    if (raw && typeof raw === 'object') raw = raw.stableKey || raw.id || raw.raw || raw.name || '';
    raw = String(raw || '');
    if (raw.indexOf('pv:') === 0) raw = decodeURIComponent(raw.slice(3));
    const hits = roster.filter(p => p.stableKey === raw || p.id === raw || p.raw.toLowerCase() === raw.toLowerCase() || p.name.toLowerCase() === raw.toLowerCase());
    return hits.length === 1 ? clone(hits[0]) : null;
  }
  function normTime(value) {
    const match = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (!match) return '';
    let hour = Number(match[1]);
    if (match[3] && /PM/i.test(match[3]) && hour < 12) hour += 12;
    if (match[3] && /AM/i.test(match[3]) && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${match[2]}`;
  }
  function emit(type, resp, id) {
    const event = { data: { source: 'mls-ext', type, id: id || '', resp } };
    Array.from(listeners).forEach(fn => fn(event));
  }
  function scheduleResponse(day, requestId) {
    if (incompleteDays.has(day)) {
      return {
        id: requestId, ok: true, schedDate: day, text: 'partial schedule', appts: [],
        receipt: { complete: false, authoritativeEmpty: false, parsedCount: 0, expectedCount: 1 }
      };
    }
    let appts = rowDays.has(day) ? clone(rowDays.get(day)) : [];
    if (untaggedDays.has(day)) {
      appts = [{
        name: 'Unattributed Patient', dob: '03/04/1970', mrn: 'MRN-UNTAGGED',
        patient_external_id: 'p-untagged', appointmentId: `untagged-${day}`,
        date: day, time: '8:00 AM', provider: ''
      }];
    }
    return {
      id: requestId, ok: true, schedDate: day,
      text: appts.length ? `Verified Day schedule ${day}` : '',
      appts,
      providers: [providerAlpha.name, providerNear.name],
      providerRoster: clone(roster),
      providerRosterReceipt: clone(rosterReceipt),
      providerDiag: { providerNames: [providerAlpha.name, providerNear.name] },
      receipt: {
        complete: true, authoritativeEmpty: appts.length === 0, requestId: requestId,
        parsedCount: appts.length, candidateCount: appts.length, expectedCount: appts.length
      }
    };
  }

  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
    encodeURIComponent, decodeURIComponent, queueMicrotask,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    location: { pathname: '/ScribeFlow-staging.html' },
    localStorage: {
      getItem: key => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)),
      removeItem: key => store.delete(key)
    },
    document: {
      readyState: 'complete',
      querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => nodes[id] || null,
      addEventListener: () => {}, removeEventListener: () => {},
      body: {}, head: { appendChild: () => {} }, documentElement: { appendChild: () => {} }
    },
    _calMode: 'day', _calRefDate: '2026-02-03', _calSelDay: '',
    _calProviders: roster,
    __mlsProviderRoster: {
      list: () => clone(roster), resolve: resolveProvider,
      beginOperation: op => { rt.__armedRosterOperation = Object.assign({}, op); return rt.__armedRosterOperation; },
      getReceipt: () => Object.assign(clone(rosterReceipt), rt.__armedRosterOperation ? {
        targetDate: rt.__armedRosterOperation.targetDate, requestId: rt.__armedRosterOperation.requestId,
        providerMode: rt.__armedRosterOperation.providerMode,
        requestedProviderId: rt.__armedRosterOperation.requestedProviderId,
        requestedProviderStableKey: rt.__armedRosterOperation.requestedProviderStableKey
      } : {})
    },
    backendMode: () => true, bkToken: () => 'test-token', bkBase: () => 'https://local.invalid',
    uns: key => `provider-month-test::${key}`,
    __mlsVisitNotesPref: {
      read: () => ({ state: 'on', on: true, settled: true }),
      ensureChosenForBulkPull: () => Promise.resolve({ ok: true, on: true, reason: 'test-choice-on' })
    },
    _normDate: value => String(value || '').slice(0, 10),
    _normTime: normTime,
    _apptKey: (name, date, time) => `${String(name || '').trim().toLowerCase()}|${date}|${time}`,
    _acctWallToUtcIso: (date, time) => `${date}T${time}:00.000Z`,
    getPatients: () => patients,
    upsertPatient: next => {
      const index = patients.findIndex(p => String(p.id) === String(next.id));
      if (index >= 0) patients[index] = next; else patients.push(next);
    },
    loadCalendar: () => { rt._calAppts = backendRows.map(clone); return Promise.resolve(); },
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    dispatchEvent: () => {},
    _athenaHistoryTargetSnapshot: ref => {
      historyRefs.push(clone(ref));
      return ref && ref.patientId === patient.id
        ? { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn }
        : null;
    },
    _hasImportedHistory: target => !!(target && target.patientId === patient.id),
    _athenaHistoryProofMatches: (target, observed) => target.patientId === patient.id && observed.chartName === patient.name && observed.chartDob === patient.dob && observed.chartMrn === patient.mrn,
    _assistReadChart: (_target, _onStatus, options) => {
      const requestId = String(options && options.requestId || `chart-${historyRefs.length}`);
      const text = 'Verified chart problems medications allergies and clinical history';
      return Promise.resolve({
        text, requestId, chartName: patient.name, chartDob: patient.dob, chartMrn: patient.mrn,
        coverageReceipt: {
          kind: 'athena-chart-coverage', complete: true, readerVersion: '2.9.19-chart-r3',
          identityObserved: true, truncated: false, requestId, capturedAt: Date.now(),
          expectedClinicalFrames: 1, readClinicalFrames: 1, boundClinicalFrames: 1,
          unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0,
          omittedForCap: 0, textChars: text.length
        }
      });
    },
    _parsePatientChart: () => Promise.resolve({
      problems: 'Verified problem', meds: 'Verified med', allergies: 'Verified allergy', summary: 'Verified summary',
      vitals: { bp: '120/80' }, history: { pmh: 'Verified PMH' },
      coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
    }),
    _athenaChartProfileCoverage: () => ({ complete: true }),
    _athenaChartSnapshotFromChart: chart => ({ problems: String(chart.problems || ''), meds: String(chart.meds || ''), allergies: String(chart.allergies || ''), summary: String(chart.summary || ''), vitals: Object.assign({}, chart.vitals || {}), history: Object.assign({}, chart.history || {}), visits: [] }),
    _athenaChartSnapshotProof: snapshot => JSON.stringify(snapshot || {}),
    _athenaHistoryVerifiedRef: target => Object.freeze({
      patientId: target.patientId, name: target.name, dob: target.dob, mrn: target.mrn,
      verifiedName: target.name, verifiedDob: target.dob, verifiedMrn: target.mrn
    }),
    _savePatientChart: (ref, _row, chart) => {
      patient.athenaChartSnapshot = { problems: String(chart.problems || ''), meds: String(chart.meds || ''), allergies: String(chart.allergies || ''), summary: String(chart.summary || ''), vitals: Object.assign({}, chart.vitals || {}), history: Object.assign({}, chart.history || {}), visits: [] };
      patient.athenaProfileCoverage = {
        complete: true, exactIdentityVerified: true, patientId: patient.id, capturedAt: new Date().toISOString(), saveRequestId: String(ref.requestId || ''),
        cards: {
          problems: { populated: true }, meds: { populated: true }, allergies: { populated: true },
          summary: { populated: true }, vitals: { populated: true }, history: { populated: true }
        }
      };
      return true;
    },
    _patientHistoryCardCoverage: () => patient.athenaProfileCoverage,
    __mlsVisitModel: {
      addVisit: (_id, raw) => {
        if (!patient.visits.some(v => v.sourceVisitKey === raw.sourceVisitKey)) patient.visits.push(raw);
        return raw;
      },
      getVisits: () => patient.visits,
      reconcileVerifiedAthenaVisits: () => ({ complete: true, removed: 0, retained: patient.visits.length }),
      organizePatientHistory: () => ({ ok: true, complete: true, verifiedVisits: patient.visits.length })
    },
    __mlsCopyVisits: {
      _saveVisits: (_p, _identity, visits) => {
        let added = 0;
        visits.forEach(v => {
          if (!patient.visits.some(old => old.sourceVisitKey === v.sourceVisitKey)) {
            patient.visits.push(Object.assign({}, v, {
              source: 'athena-schedule-history', identityVerified: true, identityBinding: patient.id,
              indexOnly: false, fullDetail: true, bodyComplete: true
            }));
            added++;
          }
        });
        return added;
      },
      _visitIdentityAgrees: () => true
    },
    fetch: async (url, init) => {
      if (!init || !init.method) return { ok: true, status: 200, json: async () => ({ appointments: backendRows.map(clone) }) };
      const body = JSON.parse(init.body || '{}');
      const update = String(url).match(/\/api\/appointments\/([^/]+)\/update$/);
      if (update) {
        const id = decodeURIComponent(update[1]);
        const row = backendRows.find(one => String(one.id) === id);
        if (row) Object.assign(row, body);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const id = `month-backend-${++createSeq}`;
      savedBodies.push(clone(body));
      backendRows.push(Object.assign({ id }, clone(body)));
      return { ok: true, status: 200, json: async () => ({ ok: true, id }) };
    }
  };
  rt.window = rt;
  rt.addEventListener = (_type, fn) => listeners.add(fn);
  rt.removeEventListener = (_type, fn) => listeners.delete(fn);
  rt.postMessage = msg => {
    posted.push(clone(msg));
    if (msg.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true }, ''));
    if (msg.type === 'mlsAppGotoDate') queueMicrotask(() => {
      currentDay = msg.date;
      gotoDates.push(msg.date);
      emit('mlsAppGotoDateResult', { id: msg.id, ok: true, schedDate: msg.date }, msg.id);
    });
    if (msg.type === 'mlsAppPullSchedule') queueMicrotask(() => {
      emit('mlsAppScheduleResult', scheduleResponse(currentDay, msg.id), msg.id);
    });
    if (msg.type === 'mlsAppReadAllVisits') queueMicrotask(() => {
      const event = { data: {
        source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: msg.id,
        requestId: msg.requestId, ok: true,
        visits: [{
          date: '2025-12-01', type: 'Office visit',
          raw: 'Verified old visit with substantive clinical detail for the month regression.',
          fullDetail: true, sourceVisitKey: 'row:month-exact-1'
        }],
        receipt: {
          complete: true, indexComplete: true, bodyComplete: true, fullDetail: true,
          stableKeysComplete: true, expected: 1, parsed: 1, cap: 500,
          readerVersion: '2.9.22-visits-r4-two-stage'
        },
        readerVersion: '2.9.22-visits-r4-two-stage',
        identity: { name: patient.name, dob: patient.dob, mrn: patient.mrn }
      } };
      Array.from(listeners).forEach(fn => fn(event));
    });
  };

  vm.runInNewContext(siSource, rt, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
  return {
    rt, api: rt.__mlsSI, nodes, posted, gotoDates, savedBodies, backendRows, historyRefs,
    patient, providerAlpha, providerNear, rowDays, incompleteDays, untaggedDays,
    setReceipt(next) { rosterReceipt = Object.assign({}, rosterReceipt, next); }
  };
}

function assertLateRosterRefresh() {
  const installToken = 'provider-month-owned-roster';
  let calendarRefreshes = 0;
  const store = new Map();
  const bridgeWrites = [];
  const context = {
    console, Date, JSON, Object, Array, String, Number, RegExp,
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    localStorage: {
      getItem: key => store.has(key) ? store.get(key) : null,
      setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key)
    },
    document: {
      readyState: 'complete', addEventListener: () => {}, removeEventListener: () => {},
      querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
      currentScript: {
        getAttribute(name) {
          if (name === 'data-mls-install-token') return installToken;
          if (name === 'data-mls-asset') return 'feat_athena_provider_roster.js';
          return null;
        }
      }
    },
    _calProviders: [], uns: key => `roster-refresh-test::${key}`,
    __MLS_MAIN: { enabled: true },
    __mlsP1ProviderRosterLoader: {
      installed: true, version: 'p1-provider-roster-1.0.0', installToken
    },
    __mlsSessionAccount: 'provider-month@example.test',
    __mlsSessionEpoch: 1,
    bkToken: () => 'provider-month-session-token',
    addEventListener: () => {}, removeEventListener: () => {},
    postMessage: msg => bridgeWrites.push(msg),
    renderCalendar: () => { calendarRefreshes++; },
    __mlsCalPolish: { installed: true, enhance: () => { calendarRefreshes++; } }
  };
  context.window = context;
  vm.runInNewContext(rosterSource, context, { filename: 'feat_athena_provider_roster.js', timeout: 1000 });
  assert(context.__mlsProviderRoster && context.__mlsProviderRoster.version === 'p1-provider-roster-1.0.0',
    'the promoted provider roster did not install under its exact controller/session owner');
  assert.strictEqual(context.__mlsProviderRoster.installToken, installToken,
    'the provider roster API is not bound to the exact loader token');
  let requestSequence = 0;
  function exactIngest(response) {
    const requestId = `provider-month-roster-${++requestSequence}`;
    assert(context.__mlsProviderRoster.beginOperation({
      targetDate: '2026-02-03', requestId, providerMode: 'all',
      requestedProviderId: '', requestedProviderStableKey: ''
    }), 'the exact provider-roster operation did not arm');
    const payload = Object.assign({}, response, { requestId });
    if (payload.providerRosterReceipt) {
      payload.providerRosterReceipt = Object.assign({}, payload.providerRosterReceipt, {
        requestId, targetDate: '2026-02-03'
      });
    }
    const result = context.__mlsProviderRoster.ingestResp(payload);
    assert(!result || result.ignored !== true,
      'the exact owned provider-roster response was refused as unbound');
    return result;
  }
  assert.strictEqual(bridgeWrites.length, 0, 'provider-roster startup must remain read-only and passive');
  exactIngest({
    providerRoster: [{ stableKey: 'backend:77', id: '77', raw: 'Doctor_Late_MD', name: 'Late Doctor' }],
    providerRosterReceipt: {
      complete: true, partial: false, reason: 'complete', observedCount: 1,
      reachedEnd: true, restored: true
    }
  });
  assert(calendarRefreshes > 0, 'late canonical roster ingestion must refresh visible Calendar provider chips');

  // An evidence-free compatibility replay has no exact armed request owner and
  // must not revoke the current session-verified receipt. This is the exact
  // late/empty shape that used to make the first clinic day after a weekend
  // fail its all-provider roster gate on every month pull.
  assert.strictEqual(context.__mlsProviderRoster.getReceipt().complete, true, 'verified receipt missing before the evidence-free read');
  const ignoredEmpty = context.__mlsProviderRoster.ingestResp({
    ok: true, requestId: 'unowned-empty-day', text: '', appts: []
  });
  assert.strictEqual(ignoredEmpty && ignoredEmpty.reason, 'unbound-or-stale-response',
    'an unowned evidence-free replay was not refused at the exact ingestion choke point');
  assert.strictEqual(context.__mlsProviderRoster.getReceipt().complete, true,
    'an unowned evidence-free empty-day replay revoked the verified roster receipt');
  // A read carrying a schedule error is contrary evidence and must still downgrade.
  exactIngest({ ok: false, error: 'schedule read failed', text: '', appts: [] });
  assert.strictEqual(context.__mlsProviderRoster.getReceipt().complete, false, 'an errored read must still downgrade the receipt (fail-closed)');
}

async function main() {
  assertLateRosterRefresh();

  const h = createHarness();
  const api = h.api;
  assert(api && typeof api.pullMonth === 'function', 'exact importer must expose pullMonth');
  assert.strictEqual(typeof api._resolveProviderRequest, 'function', 'exact importer must expose its canonical provider preflight for UI routes');
  assert.strictEqual(h.posted.length, 0, 'loading the exact importer must not ping, navigate, read, or pull Athena');

  // The UI phrase is not an identity. It must resolve to the canonical all scope.
  const allDoctors = api._resolveProviderRequest('All doctors', { allowAll: true });
  assert.strictEqual(allDoctors.ok, true);
  assert.strictEqual(allDoctors.provider, 'all');

  // A partial canonical roster remains fail-closed on ordinary selected and
  // every-provider routes. The explicitly guarded Calendar/Day/Month selected
  // lanes may carry one uniquely detected strong identity forward as
  // `detectedOnly`; the fresh schedule receipt and row attribution below still
  // have to prove that exact clinician before anything is imported.
  h.setReceipt({ complete: false, partial: true, reason: 'viewport-incomplete' });
  const partial = api._resolveProviderRequest(h.providerAlpha, { allowAll: true });
  assert.strictEqual(partial.ok, false);
  assert.strictEqual(partial.reason, 'provider-roster-incomplete');
  const calendarPartial = api.calendarSelection();
  assert.strictEqual(calendarPartial.ok, true);
  assert.strictEqual(calendarPartial.provider.detectedOnly, true);
  assert.strictEqual(calendarPartial.provider.rosterVerified, false);
  assert.strictEqual(calendarPartial.provider.id, h.providerAlpha.id);
  assert.strictEqual(calendarPartial.provider.stableKey, h.providerAlpha.stableKey);
  const beforeBlockedMonth = h.posted.length;
  const blockedMonth = await api.pullMonth({ month: '2026-02', provider: 'all' });
  assert.strictEqual(blockedMonth.ok, false);
  assert.strictEqual(blockedMonth.reason, 'provider-roster-incomplete');
  assert.strictEqual(h.posted.length, beforeBlockedMonth, 'blocked all-provider month route touched the Athena bridge');

  h.setReceipt({ complete: true, partial: false, reason: 'complete' });
  const exactProvider = api._resolveProviderRequest(h.providerAlpha, { allowAll: true });
  assert.strictEqual(exactProvider.ok, true);
  assert.strictEqual(exactProvider.provider.id, '7');

  // Similar clinician names must never cross-match.
  const scoped = api._scopeProviderRows([
    { name: 'Alpha Patient', provider: 'Schaeffer_Matthew_MD' },
    { name: 'Near Patient', provider: 'Schaeffer_Michael_MD' }
  ], h.providerAlpha, {
    receipt: { complete: true },
    providers: [h.providerAlpha.name, h.providerNear.name],
    providerDiag: { providerNames: [h.providerAlpha.name, h.providerNear.name] }
  });
  assert.strictEqual(scoped.complete, true);
  assert.deepStrictEqual(Array.from(scoped.rows, row => row.name), ['Alpha Patient']);

  const exactRow = {
    name: h.patient.name, dob: h.patient.dob, mrn: h.patient.mrn,
    athenaPatientId: 'athena-patient-100', patient_external_id: h.patient.id,
    athenaAppointmentId: 'athena-appt-100', athenaProviderId: h.providerAlpha.id,
    date: '2026-02-03', time: '9:20 AM', reason: 'Exact month regression',
    provider: h.providerAlpha.raw
  };
  h.rowDays.set('2026-02-03', [exactRow]);
  const inputProvider = Object.assign({}, h.providerAlpha);
  const firstPromise = api.pullMonth({ month: '2026-02', provider: inputProvider });
  inputProvider.id = '8'; inputProvider.name = h.providerNear.name; inputProvider.raw = h.providerNear.raw;
  h.nodes.calProvFilter.value = '8'; h.rt._calRefDate = '2026-07-30';
  const first = await firstPromise;
  assert.strictEqual(first.ok, true, JSON.stringify({ reason: first.reason, error: first.error, days: first.days && first.days.filter(day => !day.complete).slice(0, 2) }));
  assert.strictEqual(first.complete, true);
  assert.strictEqual(first.month, '2026-02');
  assert.strictEqual(first.provider.id, '7', 'in-flight month pull followed a mutated provider object');
  assert.strictEqual(first.provider.name, h.providerAlpha.name);
  assert.strictEqual(first.days.length, 28);
  assert.deepStrictEqual(h.gotoDates.slice(-28), monthDays('2026-02'), 'month route did not freeze and visit the exact requested dates');
  assert(first.days.every(day => day.receipt && day.receipt.includeHistory === true), 'month history must default on for every exact day pull');
  assert.strictEqual(first.totals.created, 1);
  assert.strictEqual(first.totals.failures, 0);
  assert.strictEqual(h.backendRows.length, 1);
  assert.strictEqual(h.savedBodies[0].dob, h.patient.dob);
  assert.strictEqual(h.savedBodies[0].patient_external_id, h.patient.id);
  assert.strictEqual(h.savedBodies[0].athena_appointment_id, 'athena-appt-100');
  assert.strictEqual(h.savedBodies[0].athena_provider_id, h.providerAlpha.id);
  assert.strictEqual(h.patient.mrn, 'MRN-100');
  assert(h.historyRefs.some(ref => ref.patientId === h.patient.id && ref.dob === h.patient.dob && ref.mrn === h.patient.mrn), 'DOB/MRN/stable patient identity did not reach the verified history request');

  // A repeat month pull is additive/idempotent: no duplicate backend row, but
  // the exact existing appointment is honestly accounted for.
  const second = await api.pullMonth({ month: '2026-02', provider: h.providerAlpha });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.complete, true);
  assert.strictEqual(second.totals.created, 0);
  assert.strictEqual(second.totals.skipped, 1);
  assert.strictEqual(h.backendRows.length, 1, 'repeat month pull duplicated an appointment');

  // A dates allow-list narrows the run to exactly those days (Retry failed
  // days). Entries outside the month are dropped, never widening the run.
  const gotoBeforeSubset = h.gotoDates.length;
  const subset = await api.pullMonth({ month: '2026-02', provider: h.providerAlpha, dates: ['2026-02-03', '2026-09-09'] });
  assert.strictEqual(subset.ok, true);
  assert.strictEqual(subset.days.length, 1, 'dates allow-list must narrow the month run');
  assert.strictEqual(subset.days[0].date, '2026-02-03');
  assert.deepStrictEqual(h.gotoDates.slice(gotoBeforeSubset), ['2026-02-03'], 'subset retry must visit only the requested day');

  // A single incomplete schedule receipt makes the whole month retryable and
  // cannot be promoted to a successful month.
  h.incompleteDays.add('2026-03-05');
  const incomplete = await api.pullMonth({ month: '2026-03', provider: h.providerAlpha });
  assert.strictEqual(incomplete.ok, false);
  assert.strictEqual(incomplete.complete, false);
  assert(JSON.stringify(incomplete.retry).includes('2026-03-05'), 'incomplete day is missing from the month retry receipt');
  h.incompleteDays.clear();

  // All-provider month reads need full provider attribution as well as a complete
  // row-count receipt. An unattributed patient may not become a complete month.
  h.untaggedDays.add('2026-04-01');
  const unattributed = await api.pullMonth({ month: '2026-04', provider: 'all', includeHistory: false });
  assert.strictEqual(unattributed.ok, false);
  assert.strictEqual(unattributed.complete, false);
  assert(JSON.stringify(unattributed.retry).includes('2026-04-01'), 'unattributed all-provider day is missing from the retry receipt');

  // si-1.7.12: a failure repeating identically on 3 consecutive days is
  // SYSTEMIC (live 2026-07-18: signed-out athena burned 30 days in 5s with a
  // bare "0/30"). The sweep must stop early, name the one cause, and keep
  // every unfinished day retryable - nothing silently skipped.
  h.incompleteDays.add('2026-05-01'); h.incompleteDays.add('2026-05-02'); h.incompleteDays.add('2026-05-03');
  const stopped = await api.pullMonth({ month: '2026-05', provider: h.providerAlpha, includeHistory: false });
  assert.strictEqual(stopped.ok, false);
  assert.strictEqual(stopped.reason, 'month-stopped-systemic', 'three identical consecutive failures must stop the sweep, got ' + stopped.reason);
  assert.strictEqual(stopped.systemicReason, 'schedule-incomplete', 'the stop must carry the systemic reason');
  const notAttempted = stopped.days.filter(d => d.reason === 'not-attempted-after-systemic-failure');
  assert(notAttempted.length >= 25, 'remaining days must be marked not-attempted, got ' + notAttempted.length);
  assert.strictEqual(stopped.retry.dates.length, 31, 'every unfinished day must stay in Retry failed days, got ' + stopped.retry.dates.length);
  h.incompleteDays.clear();

  // px-6.1 (Elizabeth, 2026-08-08): the history proof chain must carry
  // organize's ACTUAL refusal evidence into the thrown row message - a gate
  // that discards the evidence of its own refusal makes every downstream
  // failure unexplainable. The control runs the REAL extracted throw block
  // against a stubbed refusal, so a placeholder string cannot pass it.
  {
    const throwStart = siSource.indexOf('var orgReason=String((organization&&organization.reason)||"organize-returned-no-result")');
    assert(throwStart >= 0, 'px-6.1 reason-propagation block missing from the si source');
    const throwEnd = siSource.indexOf('throw new Error("history-organization-unproven: "', throwStart);
    assert(throwEnd > throwStart, 'px-6.1 throw does not interpolate the organize reason');
    const blockEnd = siSource.indexOf('}', siSource.indexOf(';', throwEnd));
    const throwBlock = siSource.slice(throwStart, blockEnd);
    const runThrow = new Function('organization', 'safe', throwBlock);
    let thrownMsg = '';
    try {
      runThrow(
        { ok: false, reason: 'semantic-coverage-incomplete', semanticCoverage: { missedSections: ['history.family'] } },
        (fn, d) => { try { return fn(); } catch (e) { return d; } }
      );
    } catch (e) { thrownMsg = String(e.message || e); }
    assert.strictEqual(
      thrownMsg,
      'history-organization-unproven: semantic-coverage-incomplete - sections detected but not captured: history.family',
      'the row message must carry the real reason and the missed sections, got: ' + thrownMsg
    );
    let bareMsg = '';
    try { runThrow(null, (fn, d) => { try { return fn(); } catch (e) { return d; } }); } catch (e) { bareMsg = String(e.message || e); }
    assert.strictEqual(bareMsg, 'history-organization-unproven: organize-returned-no-result', 'a null organize result must still name itself, got: ' + bareMsg);
  }

  // stp-1.0.0 (owner 2026-08-08: "there should be a stop pull button"): a
  // cooperative abort between days. BOTH arms: with the flag set mid-run the
  // sweep stops, marks every remaining day stopped-by-user AND retryable, and
  // reports itself (fails pre-fix: the flag was ignored and every day ran);
  // with the flag clear, a full run is untouched.
  {
    h.rt.__mlsPullStopRequested = false;
    let stopArmedAfter = 2, daysStarted = 0;
    const stopRun = await api.pullMonth({
      month: '2026-05', provider: h.providerAlpha, includeHistory: false,
      onStatus: (m) => { if (/^Month pull \d+\//.test(String(m))) { daysStarted++; if (daysStarted === stopArmedAfter) h.rt.__mlsPullStopRequested = true; } }
    });
    assert.strictEqual(stopRun.stoppedByUser, true, 'the run must report it was stopped by the user');
    const stoppedDays = stopRun.days.filter(d => d.reason === 'stopped-by-user');
    assert(stoppedDays.length >= 25, 'every unstarted day must be marked stopped-by-user, got ' + stoppedDays.length);
    assert(stopRun.retry.dates.length >= stoppedDays.length, 'stopped days must remain retryable');
    h.rt.__mlsPullStopRequested = false;
    const cleanRun = await api.pullMonth({ month: '2026-05', provider: h.providerAlpha, includeHistory: false });
    assert.strictEqual(cleanRun.stoppedByUser, undefined, 'an unstopped run must not claim a stop');
    assert(!cleanRun.days.some(d => d.reason === 'stopped-by-user'), 'an unstopped run must run every day');
    assert(/stopPull: function \(\) \{\s*window\.__mlsPullStopRequested = true;/.test(siSource), 'the engine must expose stopPull()');
    assert(/window\.__mlsPullStopRequested === true\) \{\n          receipt\.stoppedByUser = true/.test(siSource), 'the per-chart batch loop must honor the flag between charts');
    assert(connectSource.includes('id="mlsPullProgStop"') && connectSource.includes('>Stop pull</button>'), 'the Stop pull button must exist on the progress panel');
    assert(connectSource.includes("getElementById('mlsPullProgStop')") && connectSource.includes('stopPull'), 'the button must be wired to the cooperative stopPull()');
  }

  // sde-1.0 (day 6, 2026-08-09): a day must never close silently. The month
  // loop's rejection path recorded reason 'exception' into result.days and
  // emitted NO status line, so a live observer only noticed the date sequence
  // jump 5->7; the schedule phase had already said "saved 24/24". Both arms:
  // a day that dies mid-pull must still emit a date-prefixed day-end line and
  // stay retryable; a clean run must record no exception day. The poison is a
  // one-shot throwing onStatus - the same seam as a real mid-phase exception
  // (si's status callbacks are normalized bare, never try/catch-wrapped).
  {
    h.rt.__mlsPullStopRequested = false;
    let armed = true;
    const lines = [];
    const poisoned = await api.pullMonth({
      month: '2026-05', provider: h.providerAlpha, includeHistory: false,
      onStatus: (m) => {
        const s = String(m);
        if (armed && s.startsWith('2026-05-06: ')) { armed = false; throw new Error('sde-test-day-death'); }
        lines.push(s);
      }
    });
    const excDay = poisoned.days.find(d => d.date === '2026-05-06');
    assert(excDay && excDay.reason === 'exception', 'the poisoned day must record reason exception, got ' + (excDay ? excDay.reason : 'no-day-entry'));
    assert.strictEqual(excDay.error, undefined, 'a raw exception that may contain chart or DOM text leaked into the durable month receipt');
    assert.strictEqual(excDay.errorType, 'Error', 'the PHI-free exception class disappeared from the durable month receipt');
    const emitted = lines.filter(l => l.startsWith('2026-05-06: ') && /stopped before finishing/.test(l) && /queued for retry/.test(l));
    assert.strictEqual(emitted.length, 1, 'the dead day must emit exactly one day-end line into the stream, got ' + emitted.length);
    assert(!emitted[0].includes('sde-test-day-death'), 'the day-end line leaked the raw exception, got ' + emitted[0]);
    assert(poisoned.retry.dates.includes('2026-05-06'), 'the dead day must stay retryable');
    assert(poisoned.days.some(d => d.date === '2026-05-07' && d.reason !== 'exception'), 'the day AFTER the death must still run - one dead day must not kill the month');
    const cleanAfter = await api.pullMonth({ month: '2026-05', provider: h.providerAlpha, includeHistory: false });
    assert(!cleanAfter.days.some(d => d.reason === 'exception'), 'control: a clean run must record no exception day');
    // The other two silent exits gained the same day-end shape; pin the emits
    // next to their reasons so a refactor cannot quietly re-silence them.
    const stoppedExit = siSource.slice(siSource.indexOf('if (window.__mlsPullStopRequested === true) {', siSource.indexOf('dates.forEach(function (date, index) {')),
      siSource.indexOf('        if (breaker.tripped)', siSource.indexOf('dates.forEach(function (date, index) {')));
    assert(stoppedExit.includes('reason: "stopped-by-user"') &&
      stoppedExit.includes('onStatus(date + ": Not pulled — stop was requested. The day is queued for retry."'),
      'the stopped-by-user exit must emit its day-end line');
    const breakerExit = siSource.slice(siSource.indexOf('        if (breaker.tripped)', siSource.indexOf('dates.forEach(function (date, index) {')),
      siSource.indexOf('        onStatus("Month pull "', siSource.indexOf('dates.forEach(function (date, index) {')));
    assert(breakerExit.includes('reason: "not-attempted-after-systemic-failure"') &&
      breakerExit.includes('onStatus(date + ": Not attempted — three days in a row failed the same way (" + breaker.reason + "), so MLS stopped rather than repeat the failure. The day is queued for retry."'),
      'the breaker exit must emit its day-end line');
  }

  // Full Notes OFF is schedule/booking-only. Even if an old caller supplies
  // includeHistory:true, the explicit frozen false narrows the operation before
  // any chart or visit-body reader can open.
  {
    const realRead = h.rt._assistReadChart;
    let bodiesOffReads = 0;
    h.rt._assistReadChart = function () { bodiesOffReads++; return realRead.apply(null, arguments); };
    const allVisitsBefore = h.posted.filter(message => message.type === 'mlsAppReadAllVisits').length;
    const bodiesOff = await api.pull({ date: '2026-02-03', provider: h.providerAlpha, includeHistory: true, pullVisitBodies: false });
    h.rt._assistReadChart = realRead;
    assert.strictEqual(bodiesOff.includeHistory, false, 'explicit Full Notes OFF did not narrow includeHistory');
    assert.strictEqual(bodiesOff.historyRequested, false, 'explicit Full Notes OFF still claims history requested');
    assert.strictEqual(bodiesOffReads, 0, 'Full Notes OFF opened a patient chart');
    assert.strictEqual(h.posted.filter(message => message.type === 'mlsAppReadAllVisits').length, allVisitsBefore,
      'Full Notes OFF opened a visit-body reader');
  }

  console.log('PASS exact provider/day/month routing, canonical roster gates, late refresh, frozen identity/date, receipts, idempotency, and passive startup');
}

const watchdog = setTimeout(() => {
  console.error(new Error('provider/month exact-routing regression did not settle'));
  process.exit(1);
}, 45000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
