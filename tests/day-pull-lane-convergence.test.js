'use strict';

/* THE OWNER PULLS FROM THE NORMAL VISIT VIEW, NOT THE STAFF-PREP CONSOLE.
 *
 * Everything that had ever been verified was verified through the staff-prep
 * lane, which does two things before it pulls: it drives athenaOne to the Day
 * view and re-reads the painted grid (so the canonical provider roster is
 * ingested), and it then pulls SCOPED to a real provider.
 *
 * The Visit-day strip (__mlsDaySwitch ds-2.0.2) did neither. It called
 * si.pull({date, onStatus}) with NO provider and NO pre-flight, so every pull
 * he ran took the all-providers branch of scopeProviderRows - which is
 * all-or-nothing: ONE row that does not name its provider makes it return
 * rows:[] and import ZERO. On a one-column Day grid that is EVERY row
 * (measured live: 400/400 stored rows provider-empty across 17 days). Same
 * engine, same day, same patient - and the button he actually presses imported
 * nothing while the console he never opens worked.
 *
 * cv-1.0.0 converged the lanes behind ONE guarded entry, __mlsSI.dayPull:
 * warm the day, re-ingest the roster, resolve the ACCOUNT provider, then call
 * the same pull(). The pre-flight is ADVISORY - it can never refuse a pull and
 * never touches complete - and dayPull never fabricates a success.
 *
 * This suite fails if the Visit lane goes back to the un-warmed, provider-less
 * call, if the synchronous si.pull fallback is dropped, or if dayPull starts
 * enumerating before it warms / inventing verdicts the engine did not give.
 * Arm 2 pulls the OLD call on the SAME columnless surface, so the defect the
 * convergence fixed is reproduced here rather than described. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
/* mls-connect.js carries bytes that are not valid UTF-8; reading it as utf8
   corrupts the source and every pin below silently stops matching. */
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');

const DAY = '2026-02-03';
const DAY2 = '2026-02-04';
const ACCOUNT_NAME = 'Matthew Schaeffer, MD';

/* =====================================================================
   1. STRUCTURAL: the Visit lane calls the guarded entry, and keeps its
      synchronous fallback for an engine that predates dayPull.
   ===================================================================== */
/* Plain indexOf slices only - deliberately NO brace/quote scanner over these
   sources, which is the trap that makes a comment-blind extractor read the
   wrong block. */
const dsStart = connect.indexOf('__mlsDaySwitch ds-2.0.2');
assert(dsStart > 0, 'the selected-Visit-day module (ds-2.0.2) could not be located');
const dsEnd = connect.indexOf('function removeDoctorDayControls()', dsStart);
assert(dsEnd > dsStart, 'the ds day-strip region could not be bounded');
const ds = connect.slice(dsStart, dsEnd);

assert(ds.includes("typeof si.dayPull === 'function'"),
  'the Visit lane must feature-detect dayPull before calling it');
assert(ds.includes('si.dayPull({ date: day, includeHistory: true, onStatus: dsOnStatus })'),
  'the Visit pull button must call the guarded dayPull entry with the day, history on, and its status sink');
assert(/var p = \(si && typeof si\.dayPull === 'function'\)\s*\r?\n?\s*\? si\.dayPull\(/.test(ds),
  'dayPull must be the PRIMARY route the visible Visit pull takes, not a branch below si.pull');
assert(ds.includes(': si.pull({ date: day, onStatus: dsOnStatus })'),
  'the synchronous si.pull fallback must survive for an engine that predates dayPull');
assert(!/var p\s*=\s*si\.pull\(/.test(ds),
  'REVERTED: the Visit lane is back to the un-warmed, provider-less si.pull call');
assert((ds.match(/si\.pull\(/g) || []).length === 1,
  'the Visit lane must reach the engine through exactly one fallback si.pull call');
assert(!/dayPull\(\{[^}]*includeHistory:\s*false/.test(ds),
  'the Visit lane must never ask the converged entry for a history-less pull');
assert(ds.includes('__mlsSI.pull({date,onStatus})') || ds.includes('si.dayPull('),
  'the ds module region must still own the visible pull control');

/* The engine must publish the converged entry and its two halves. */
assert(/window\.__mlsSI = \{[\s\S]*?\n\s*dayPull: dayPull,/.test(si),
  'the exact importer must export dayPull on window.__mlsSI');
assert(si.includes('_warmUpDay: warmUpDay,') && si.includes('_accountProviderRequest: accountProviderRequest,'),
  'the pre-flight and the account-scope resolver must be exported for the suites and the console');

/* The pre-flight opens the day BEFORE it re-reads the grid, and it can never
   reject: a thrown bridge is caught into an advisory receipt. */
const warmBlock = si.slice(si.indexOf('function warmUpDay(date, onStatus) {'),
  si.indexOf('function accountProviderRequest()'));
assert(warmBlock.length > 200, 'warmUpDay could not be isolated');
assert(warmBlock.indexOf('"mlsAppGotoDate"') < warmBlock.indexOf('"mlsAppPullSchedule"'),
  'the pre-flight must OPEN the day before it re-reads the painted grid');
assert(/\}, function \(err\) \{[\s\S]*?return out;/.test(warmBlock),
  'a thrown pre-flight must resolve to an advisory receipt, never reject the pull');

const dayPullBlock = si.slice(si.indexOf('function dayPull(opts) {'), si.indexOf('window.__mlsSI = {'));
assert(dayPullBlock.length > 400, 'dayPull could not be isolated');
assert(dayPullBlock.includes('.then(null, function () {'),
  'dayPull must swallow a pre-flight rejection - the pre-flight cannot refuse a pull');
assert(dayPullBlock.includes('if (runOpts.includeHistory === undefined) runOpts.includeHistory = true;'),
  'verified history must default ON through the converged entry');
/* pull() is closed over inside the module, so the non-promise engine branch
   cannot be reached from a vm arm without replacing the engine itself. Pin the
   exact refusal the strip used to raise instead of faking a success. */
assert(dayPullBlock.includes('reason: "no-receipt"') &&
  dayPullBlock.includes('The Athena pull engine did not return a verifiable completion receipt.'),
  'an engine that hands back no settleable receipt must still produce an honest refusal');

/* =====================================================================
   2. BEHAVIORAL: run the real engine under vm against a fake athenaOne.
   ===================================================================== */
function createHarness(opts) {
  opts = opts || {};
  const listeners = new Set();
  const store = new Map();
  /* 2026-07-28: visit bodies default ON. This suite proves LANE CONVERGENCE
     (the columnless Day grid pulls at all), not the bodies stage — its fake
     bridge serves chart cards only. Record an explicit human fast-lane choice
     so the scenario stays what it always was. */
  store.set('day-pull-convergence-test::pullVisitBodies', '0');
  store.set('day-pull-convergence-test::pullVisitBodiesSet', '1');
  const posted = [];
  const statuses = [];
  const backendRows = [];
  const savedBodies = [];
  const gotoDates = [];
  const incompleteDays = new Set();
  const navFailDays = new Set();
  const rowDays = new Map();
  const me = { id: '7', name: ACCOUNT_NAME };
  const providerAlpha = { stableKey: 'backend:7', id: '7', raw: 'Schaeffer_Matthew_MD', name: ACCOUNT_NAME, rosterVerified: true };
  const providerNear = { stableKey: 'backend:8', id: '8', raw: 'Schaeffer_Michael_MD', name: 'Michael Schaeffer, MD', rosterVerified: true };
  const roster = [providerAlpha, providerNear];
  let rosterReceipt = { complete: true, partial: false, reason: 'complete', observedCount: 2, reachedEnd: true, restored: true };
  let currentDay = '';
  let createSeq = 0;
  const patient = { id: 'p-dp-1', name: 'Columnless Patient', dob: '01/02/1960', mrn: 'MRN-DP1', athenaId: 'MRN-DP1', visits: [] };
  const patients = [patient];

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function resolveProvider(ref) {
    let raw = ref;
    if (raw && typeof raw === 'object') raw = raw.stableKey || raw.id || raw.raw || raw.name || '';
    raw = String(raw || '');
    if (raw.indexOf('pv:') === 0) raw = decodeURIComponent(raw.slice(3));
    const hits = roster.filter(p => p.stableKey === raw || p.id === raw ||
      p.raw.toLowerCase() === raw.toLowerCase() || p.name.toLowerCase() === raw.toLowerCase());
    return hits.length === 1 ? clone(hits[0]) : null;
  }
  function normTime(value) {
    const m = String(value || '').trim().match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
    if (!m) return '';
    let hour = Number(m[1]);
    if (m[3] && /PM/i.test(m[3]) && hour < 12) hour += 12;
    if (m[3] && /AM/i.test(m[3]) && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${m[2]}`;
  }
  function emit(type, resp, id) {
    const ev = { data: { source: 'mls-ext', type, id: id || '', resp } };
    Array.from(listeners).forEach(fn => fn(ev));
  }
  function scheduleResponse(day, requestId) {
    if (incompleteDays.has(day)) {
      return { id: requestId, ok: true, schedDate: day, text: 'partial schedule', appts: [],
        providerRoster: clone(roster), providerRosterReceipt: clone(rosterReceipt),
        receipt: { complete: false, authoritativeEmpty: false, parsedCount: 0, expectedCount: 1 } };
    }
    const appts = rowDays.has(day) ? clone(rowDays.get(day)) : [];
    /* The read can only report provider names the GRID actually painted. His
       one-column Day view paints NONE - that is the whole surface under test. */
    const painted = Array.from(new Set(appts.map(a => String(a.provider || '').trim()).filter(Boolean)));
    return {
      id: requestId, ok: true, schedDate: day,
      text: appts.length ? `Verified Day schedule ${day}` : '',
      appts,
      providers: painted,
      providerRoster: clone(roster),
      providerRosterReceipt: clone(rosterReceipt),
      providerDiag: { providerNames: painted },
      receipt: { complete: true, authoritativeEmpty: appts.length === 0, requestId,
        parsedCount: appts.length, candidateCount: appts.length, expectedCount: appts.length }
    };
  }

  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
    encodeURIComponent, decodeURIComponent, queueMicrotask,
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval: () => {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    location: { pathname: '/ScribeFlow-staging.html' },
    localStorage: {
      getItem: k => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k)
    },
    document: {
      readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
      getElementById: () => null, addEventListener: () => {}, removeEventListener: () => {},
      body: {}, head: { appendChild: () => {} }, documentElement: { appendChild: () => {} }
    },
    _calMode: 'day', _calRefDate: DAY, _calSelDay: '',
    _calProviders: roster,
    /* The Visit lane has no provider picker. The signed-in account is the only
       scope it can honestly pull as - opts.noAccount removes even that. */
    _calMe: opts.noAccount ? null : me,
    __mlsProviderRoster: {
      list: () => clone(roster), resolve: resolveProvider, ingestResp: () => {},
      beginOperation: op => { rt.__armedRosterOperation = Object.assign({}, op); return rt.__armedRosterOperation; },
      getReceipt: () => Object.assign(clone(rosterReceipt), rt.__armedRosterOperation ? {
        targetDate: rt.__armedRosterOperation.targetDate, requestId: rt.__armedRosterOperation.requestId,
        providerMode: rt.__armedRosterOperation.providerMode,
        requestedProviderId: rt.__armedRosterOperation.requestedProviderId,
        requestedProviderStableKey: rt.__armedRosterOperation.requestedProviderStableKey
      } : {})
    },
    backendMode: () => true, bkToken: () => 'test-token', bkBase: () => 'https://local.invalid',
    uns: k => `day-pull-convergence-test::${k}`,
    _normDate: v => String(v || '').slice(0, 10),
    _normTime: normTime,
    _apptKey: (n, d, t) => `${String(n || '').trim().toLowerCase()}|${d}|${t}`,
    _acctWallToUtcIso: (d, t) => `${d}T${t}:00.000Z`,
    getPatients: () => patients,
    upsertPatient: next => {
      const i = patients.findIndex(p => String(p.id) === String(next.id));
      if (i >= 0) patients[i] = next; else patients.push(next);
    },
    loadCalendar: () => { rt._calAppts = backendRows.map(clone); return Promise.resolve(); },
    renderTodayPicker: () => {}, renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
    dispatchEvent: () => {},
    _athenaHistoryTargetSnapshot: ref => (ref && ref.patientId === patient.id
      ? { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn } : null),
    _hasImportedHistory: t => !!(t && t.patientId === patient.id),
    _athenaHistoryProofMatches: () => true,
    _assistReadChart: (_t, _s, o) => {
      const requestId = String((o && o.requestId) || 'chart-1');
      const text = 'Verified chart problems medications allergies and clinical history';
      return Promise.resolve({ text, requestId, chartName: patient.name, chartDob: patient.dob, chartMrn: patient.mrn,
        coverageReceipt: { kind: 'athena-chart-coverage', complete: true, readerVersion: '2.9.19-chart-r3',
          identityObserved: true, truncated: false, requestId, capturedAt: Date.now(),
          expectedClinicalFrames: 1, readClinicalFrames: 1, boundClinicalFrames: 1, unboundClinicalFrames: 0,
          oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0, textChars: text.length } });
    },
    _parsePatientChart: () => Promise.resolve({
      problems: 'Verified problem', meds: 'Verified med', allergies: 'Verified allergy', summary: 'Verified summary',
      vitals: { bp: '120/80' }, history: { pmh: 'Verified PMH' },
      coverage: { problems: 'found', meds: 'found', allergies: 'found', summary: 'found', vitals: 'found', history: 'found' }
    }),
    _athenaChartProfileCoverage: () => ({ complete: true }),
    _athenaChartSnapshotFromChart: c => ({ problems: String(c.problems || ''), meds: String(c.meds || ''),
      allergies: String(c.allergies || ''), summary: String(c.summary || ''),
      vitals: Object.assign({}, c.vitals || {}), history: Object.assign({}, c.history || {}), visits: [] }),
    _athenaChartSnapshotProof: s => JSON.stringify(s || {}),
    _athenaHistoryVerifiedRef: t => Object.freeze({ patientId: t.patientId, name: t.name, dob: t.dob, mrn: t.mrn,
      verifiedName: t.name, verifiedDob: t.dob, verifiedMrn: t.mrn }),
    _savePatientChart: (ref, _row, chart) => {
      patient.athenaChartSnapshot = { problems: String(chart.problems || ''), meds: String(chart.meds || ''),
        allergies: String(chart.allergies || ''), summary: String(chart.summary || ''),
        vitals: Object.assign({}, chart.vitals || {}), history: Object.assign({}, chart.history || {}), visits: [] };
      patient.athenaProfileCoverage = {
        complete: true, exactIdentityVerified: true, patientId: patient.id,
        capturedAt: new Date().toISOString(), saveRequestId: String(ref.requestId || ''),
        cards: { problems: { populated: true }, meds: { populated: true }, allergies: { populated: true },
          summary: { populated: true }, vitals: { populated: true }, history: { populated: true } }
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
    __mlsCopyVisits: { _saveVisits: () => 0, _visitIdentityAgrees: () => true },
    fetch: async (url, init) => {
      if (!init || !init.method) return { ok: true, status: 200, json: async () => ({ appointments: backendRows.map(clone) }) };
      const body = JSON.parse(init.body || '{}');
      const upd = String(url).match(/\/api\/appointments\/([^/]+)\/update$/);
      if (upd) {
        const id = decodeURIComponent(upd[1]);
        const row = backendRows.find(o => String(o.id) === id);
        if (row) Object.assign(row, body);
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      }
      const id = `dp-backend-${++createSeq}`;
      savedBodies.push(clone(body));
      backendRows.push(Object.assign({ id }, clone(body)));
      return { ok: true, status: 200, json: async () => ({ ok: true, id }) };
    }
  };
  rt.window = rt;
  rt.addEventListener = (_t, fn) => listeners.add(fn);
  rt.removeEventListener = (_t, fn) => listeners.delete(fn);
  rt.postMessage = msg => {
    posted.push(clone(msg));
    if (msg.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true }, ''));
    if (msg.type === 'mlsAppGotoDate') queueMicrotask(() => {
      if (navFailDays.has(msg.date)) { emit('mlsAppGotoDateResult', { id: msg.id, ok: false, reason: 'nav-refused' }, msg.id); return; }
      currentDay = msg.date; gotoDates.push(msg.date);
      emit('mlsAppGotoDateResult', { id: msg.id, ok: true, schedDate: msg.date }, msg.id);
    });
    if (msg.type === 'mlsAppPullSchedule') queueMicrotask(() => emit('mlsAppScheduleResult', scheduleResponse(currentDay, msg.id), msg.id));
    if (msg.type === 'mlsAppReadAllVisits') queueMicrotask(() => {
      const ev = { data: { source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: msg.id, requestId: msg.requestId, ok: true,
        visits: [{ date: '2025-12-01', type: 'Office visit', raw: 'Verified old visit with substantive clinical detail.', fullDetail: true, sourceVisitKey: 'row:dp-1' }],
        receipt: { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, stableKeysComplete: true,
          expected: 1, parsed: 1, cap: 500, readerVersion: '2.9.22-visits-r4-two-stage' },
        readerVersion: '2.9.22-visits-r4-two-stage',
        identity: { name: patient.name, dob: patient.dob, mrn: patient.mrn } } };
      Array.from(listeners).forEach(fn => fn(ev));
    });
  };
  vm.runInNewContext(si, rt, { filename: 'feat_mls_schedimport_exact.js', timeout: 2000 });
  return { rt, api: rt.__mlsSI, posted, statuses, gotoDates, savedBodies, backendRows, patient,
    providerAlpha, providerNear, rowDays, incompleteDays, navFailDays,
    onStatus: m => statuses.push(String(m || '')),
    gotos: () => posted.filter(p => p.type === 'mlsAppGotoDate').length,
    /* The pre-flight read carries the date on its payload; the engine's own
       enumeration carries only its request id. That is the discriminator that
       proves ORDER without stubbing anything. */
    warmReadAt: () => posted.findIndex(p => p.type === 'mlsAppPullSchedule' && p.date),
    enumReadAt: () => posted.findIndex(p => p.type === 'mlsAppPullSchedule' && !p.date) };
}

/* The exact surface that broke: a one-column Day grid, every row provider-empty. */
function columnlessRows(day) {
  return [{ name: 'Columnless Patient', dob: '01/02/1960', mrn: 'MRN-DP1',
    athenaPatientId: 'ath-1', patient_external_id: 'p-dp-1', athenaAppointmentId: 'ath-appt-' + day,
    date: day, time: '9:20 AM', reason: 'Columnless day grid', provider: '' }];
}

async function main() {
  /* ---- ARM 1: the converged entry warms, scopes, and IMPORTS ---- */
  const h = createHarness();
  assert.strictEqual(typeof h.api.dayPull, 'function', 'the engine must expose dayPull at runtime');
  assert.strictEqual(typeof h.api._warmUpDay, 'function', 'the engine must expose its day pre-flight');
  assert.strictEqual(typeof h.api._accountProviderRequest, 'function', 'the engine must expose its account-scope resolver');
  assert.strictEqual(h.posted.length, 0, 'loading the exact importer must not touch Athena');

  const account = h.api._accountProviderRequest();
  assert.strictEqual(account && account.name, ACCOUNT_NAME,
    'a Visit lane with no provider picker must resolve the signed-in account through the VERIFIED roster');
  assert.strictEqual(account.stableKey, 'backend:7', 'the account scope must be a roster entry, never a bare name');

  h.rowDays.set(DAY, columnlessRows(DAY));
  h.rowDays.set(DAY2, columnlessRows(DAY2));
  /* includeHistory deliberately omitted: the default must be ON. */
  const res = await h.api.dayPull({ date: DAY, onStatus: h.onStatus });

  assert.strictEqual(h.posted[0] && h.posted[0].type, 'mlsAppGotoDate',
    'the FIRST thing a Visit pull does must be opening the day in athenaOne');
  assert.strictEqual(h.posted[0].date, DAY, 'the pre-flight must open the day the clinician selected');
  assert(h.warmReadAt() > 0, 'the pre-flight must re-read the painted Day grid');
  assert(h.enumReadAt() > h.warmReadAt(),
    'the day must be WARMED before the engine enumerates - the un-warmed first pull after a reload is the failure');
  assert.strictEqual(h.statuses[0], 'Opening ' + DAY + ' in athenaOne before the pull...',
    'onStatus must reach the pre-flight, so the clinician sees the warm-up instead of a frozen button');
  assert(/Re-reading the athenaOne Day schedule/.test(h.statuses[1] || ''),
    'the re-read must be narrated too');
  assert(h.statuses.some(s => s === 'Pulling ' + DAY + ' as ' + ACCOUNT_NAME + '.'),
    'the converged entry must tell the clinician the exact scope it resolved');
  assert(h.statuses.some(s => /Reading your athenaOne Day schedule/.test(s)),
    'onStatus must be forwarded INTO pull() - the engine keeps narrating its own progress');

  const pre = res.preflightReceipt;
  assert(pre && typeof pre === 'object', 'a dated dayPull must disclose a pre-flight receipt');
  assert.strictEqual(pre.ran, true, 'the first pull of a page lifetime must run the pre-flight');
  assert.strictEqual(pre.warmed, true, 'a successful nav + read must report warmed');
  assert.strictEqual(pre.navOk, true, 'the pre-flight must record the nav result');
  assert.strictEqual(pre.readOk, true, 'the pre-flight must record the re-read result');
  assert.strictEqual(pre.rosterComplete, true, 'the pre-flight must re-ingest the canonical roster and report its receipt');
  assert.strictEqual(pre.providerMode, 'selected', 'a resolvable account must pull SCOPED, not all-providers');
  assert.strictEqual(pre.providerResolved, true, 'the resolved scope must be disclosed');
  assert.strictEqual(pre.scopeSource, 'account', 'a Visit pull with no picker scopes from the ACCOUNT');
  assert.strictEqual(res.includeHistory, true, 'verified history must default ON through the converged entry');

  assert.strictEqual(res.ok, true, 'the owner\'s columnless Day grid must PULL: ' + JSON.stringify({ reason: res.reason, error: res.error }));
  assert.strictEqual(res.complete, true, 'a warmed, scoped, fully-read day must settle complete');
  assert.strictEqual(res.created, 1, 'the columnless appointment must be imported, not silently dropped');
  assert.strictEqual(h.backendRows.length, 1, 'the imported appointment must reach the store');
  assert.strictEqual(h.savedBodies[0].provider, ACCOUNT_NAME, 'the stored row must carry the scoped provider');
  assert.strictEqual(res.providerReceipt.attribution, 'requested-scope-columnless',
    'the receipt must name attribution honestly as a columnless scope fill');
  assert.strictEqual(res.providerReceipt.scopeFilledRows, 1, 'every filled row must be counted on the receipt');
  assert.strictEqual(res.providerReceipt.unattributedRows, 0, 'no row may be left unattributed on a scoped columnless pull');

  /* ---- ARM 1b: ONE pre-flight per page lifetime while the scope resolves ---- */
  const gotosAfterFirst = h.gotos();
  const second = await h.api.dayPull({ date: DAY2, onStatus: h.onStatus });
  assert.strictEqual(second.preflightReceipt.ran, false, 'the pre-flight must not re-run once the day is warm and the scope resolves');
  assert.strictEqual(second.preflightReceipt.reason, 'skipped-already-warm', 'the skip must be disclosed, not hidden');
  assert.strictEqual(second.preflightReceipt.providerResolved, true, 'a skipped pre-flight must still scope to the account');
  assert.strictEqual(h.gotos(), gotosAfterFirst + 1, 'a warm lane must open the day ONCE, not twice');
  assert.strictEqual(second.ok, true, 'the second day must still pull');

  /* ---- ARM 1c: an explicit caller scope is never overwritten by the account ---- */
  const third = await h.api.dayPull({ date: DAY, provider: h.providerAlpha, onStatus: h.onStatus });
  assert.strictEqual(third.preflightReceipt.scopeSource, 'caller', 'an explicit provider must stay the callers');
  assert.strictEqual(third.preflightReceipt.providerMode, 'selected', 'an explicit provider must resolve selected');

  /* ---- ARM 2: THE DEFECT. The old Visit-lane call, same columnless day ---- */
  const old = createHarness();
  old.rowDays.set(DAY, columnlessRows(DAY));
  const oldRes = await old.api.pull({ date: DAY, includeHistory: false, onStatus: old.onStatus });
  assert.strictEqual(oldRes.ok, false, 'the OLD provider-less Visit call must still fail here - if it passes, this suite guards nothing');
  assert.strictEqual(oldRes.reason, 'provider-incomplete', 'the old lane fails in the all-or-nothing all-providers branch');
  assert.strictEqual(oldRes.created, 0, 'the old lane imported nothing from the grid the doctor was looking at');
  assert.strictEqual(old.backendRows.length, 0, 'no appointment reached the store on the old lane');
  assert.strictEqual(old.gotos(), 1, 'the old lane opened the day only as part of the pull - there was no pre-flight');
  assert.strictEqual(old.warmReadAt(), -1, 'the old lane never re-read the grid before enumerating');

  /* ---- ARM 3: no resolvable account -> honest "all", never a guess ---- */
  const anon = createHarness({ noAccount: true });
  assert.strictEqual(anon.api._accountProviderRequest(), 'all',
    'an unresolvable account must fall back to the string all - never a guessed name');
  anon.rowDays.set(DAY, columnlessRows(DAY));
  const anonRes = await anon.api.dayPull({ date: DAY, includeHistory: false, onStatus: anon.onStatus });
  assert.strictEqual(anonRes.preflightReceipt.providerMode, 'all', 'an unresolvable scope must be disclosed as all');
  assert.strictEqual(anonRes.preflightReceipt.providerResolved, false, 'an unresolved scope must not claim it resolved');
  assert(anon.statuses.some(s => s === 'Pulling every provider painted on the athenaOne Day grid.'),
    'the all-scope must be stated plainly to the clinician');
  assert.strictEqual(anonRes.ok, false, 'an all-scope pull of a columnless grid must stay fail-closed');
  assert.strictEqual(anonRes.reason, 'provider-incomplete', 'attribution is never invented for an all-scope pull');
  assert.strictEqual(anon.backendRows.length, 0, 'an unattributable all-scope row must never be stored');

  /* ---- ARM 4: the pre-flight is ADVISORY. It cannot refuse a pull ---- */
  const nav = createHarness();
  nav.navFailDays.add(DAY);
  nav.rowDays.set(DAY, columnlessRows(DAY));
  const navRes = await nav.api.dayPull({ date: DAY, includeHistory: false, onStatus: nav.onStatus });
  assert.strictEqual(navRes.preflightReceipt.warmed, false, 'a refused nav must not report warmed');
  assert.strictEqual(navRes.preflightReceipt.navOk, false, 'a refused nav must be recorded');
  assert.strictEqual(navRes.preflightReceipt.reason, 'nav-refused',
    'the pre-flight must forward the extension\'s own reason, not invent one');
  const navWarmRead = nav.warmReadAt();
  assert(nav.posted.some((p, i) => i > navWarmRead && p.type === 'mlsAppGotoDate'),
    'a failed pre-flight must NOT stop the pull - the engine still runs and owns the verdict');
  assert.strictEqual(navRes.ok, false, 'the engine must report the failure it actually hit');
  assert.notStrictEqual(navRes.reason, 'no-receipt', 'dayPull must not swap the engines refusal for its own');
  assert(navRes.reason && navRes.reason !== 'preflight-failed',
    'the clinician must read the engine reason, got ' + navRes.reason);

  /* ---- ARM 5: an honest failure keeps its pre-flight evidence ---- */
  const bad = createHarness();
  bad.incompleteDays.add(DAY);
  const badRes = await bad.api.dayPull({ date: DAY, includeHistory: false, onStatus: bad.onStatus });
  assert.strictEqual(badRes.ok, false, 'an incomplete schedule read must never be promoted to a success');
  assert.strictEqual(badRes.complete, false, 'the pre-flight must never touch complete');
  assert.strictEqual(badRes.reason, 'schedule-incomplete', 'the engines own refusal must survive the converged entry');
  assert.strictEqual(badRes.preflightReceipt.ran, true, 'a failure must still disclose that the pre-flight ran');

  /* ---- ARM 6: no date is not this lane to judge ---- */
  const undated = createHarness();
  const undatedRes = await undated.api.dayPull({ onStatus: undated.onStatus });
  assert.strictEqual(undatedRes.preflightReceipt, undefined,
    'a dateless call must be handed straight to the engine - no warm-up, no decoration');
  assert.strictEqual(undated.warmReadAt(), -1, 'a dateless call must never run the pre-flight read');

  console.log('PASS day-pull lane convergence: the Visit strip routes through the guarded dayPull (history on, si.pull fallback intact), the day is warmed and the roster re-ingested BEFORE the engine enumerates, onStatus reaches both halves, the account scope imports the columnless Day grid the old provider-less call dropped, and every pre-flight stays advisory - no invented scope, no invented verdict');
}

const watchdog = setTimeout(() => {
  console.error(new Error('day-pull lane convergence regression did not settle'));
  process.exit(1);
}, 90000);
main().then(() => clearTimeout(watchdog), error => {
  clearTimeout(watchdog);
  console.error(error);
  process.exit(1);
});
