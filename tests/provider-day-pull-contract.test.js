'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const siSource = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const calSource = fs.readFileSync(path.join(root, 'feat_mls_calendar_polish.js'), 'utf8');
const loaderSource = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const stagingLoaderSource = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');
const providerLabelSource = fs.readFileSync(path.join(root, 'feat_mls_provider_label.js'), 'utf8');
const findDoctorsSource = fs.readFileSync(path.join(root, 'feat_mls_find_doctors.js'), 'utf8');

for (const marker of [
  'function scopeProviderRows',
  'receipt.unattributedRows > 0',
  'providerReason === "provider-incomplete"',
  'pullCalendarSelection',
  'var frozenProvider =',
  'var frozenDate =',
  'provider: frozenProvider',
  'opts.includeHistory !== false',
  'exactIdentityVerified',
  'historyReceipt.complete && historyReceipt.exactIdentityVerified === true'
]) assert(siSource.includes(marker), `missing fail-closed provider-day invariant: ${marker}`);

assert(!siSource.includes('want.split(/[ ,]/)[0]'), 'provider scope must not use first-token substring matching');
assert(!siSource.includes('if (scoped.length) appts = scoped'), 'explicit provider scope must never fall back to all rows');
assert(calSource.includes('id="\' + PULL_ID + \'"'), 'calendar roster must render a selected-provider pull action');
assert(calSource.includes('api.pullCalendarSelection'), 'calendar action must route through the verified provider-day pipeline');
assert(!calSource.includes('Also pull &amp;amp; verify full history/visits'), '2026-07-28: the calendar history checkbox is retired - a provider-day pull always verifies history');
assert(calSource.includes('the calendar checkbox for this preference is') && /function includeHistory\(\) \{[\s\S]{0,700}?return true;\s*\}/.test(calSource), '2026-07-28: includeHistory is hard-true and must IGNORE the legacy stored 0 (honoring it would strand opted-out accounts in schedule-only mode with no control left)');
assert(calSource.includes('includeHistory: withHistory'), 'calendar UI must freeze and route the checkbox value into the exact pull');
assert(calSource.includes('Schedule-only complete:'), 'unchecked mode must report an honest schedule-only result');
assert(loaderSource.includes("var A='feat_mls_schedimport_exact.js',V='si-1.7.22-p1-census1'") &&
  loaderSource.includes("s.src='feat_mls_schedimport_exact.js?v='+(window.__MLS_AV||'p1-preview')"),
  'production loader must own the promoted exact importer version and use the shared build cache-buster with a deterministic pre-build fallback');
assert(stagingLoaderSource.includes("feat_mls_schedimport_exact.js?v='+(window.__MLS_AV||Date.now())"), 'staging loader must use the shared cache-buster for the exact provider/day/month history importer');
assert(loaderSource.includes('A+"?v="+(window.__MLS_AV||Date.now())'), 'production loader must use the shared cache-buster for the canonical calendar provider pull UI');

// Every roster normalizer runs before a provider-day pull. None may erase a
// stable identity merely because two clinicians share the same display name.
function assertStableRosterNormalization(source, apiName, includeRawEcho) {
  const roster = [
    { id: '7', name: 'Matthew Schaeffer, MD' },
    { id: '10', name: 'Matthew Schaeffer, MD' }
  ];
  if (includeRawEcho) roster.push('Matthew Schaeffer, MD');
  const ctx = {
    console, _calProviders: roster,
    document: { readyState: 'loading', addEventListener: () => {}, querySelectorAll: () => [], querySelector: () => null },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  };
  ctx.window = ctx;
  vm.runInNewContext(source, ctx, { filename: apiName + '.js', timeout: 1000 });
  ctx[apiName].normalize();
  assert.deepStrictEqual(Array.from(ctx._calProviders.filter(p => p && p.id != null), p => String(p.id)), ['7', '10']);
  if (includeRawEcho) assert.strictEqual(ctx._calProviders.length, 2, 'id-less roster echo should collapse into the stable API entries');
}
assertStableRosterNormalization(providerLabelSource, '__mlsProviderLabel', false);
assertStableRosterNormalization(findDoctorsSource, '__mlsFindDoctors', true);

const nodes = {
  calProvFilter: { value: '7' },
  calDayPanel: { style: { display: 'block' } }
};
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
    getElementById: id => nodes[id] || null,
    addEventListener: () => {},
    body: {}, head: {}, documentElement: {}
  },
  _calMode: 'day',
  _calRefDate: '2026-07-15',
  _calSelDay: '2026-07-16',
  _calProviders: [
    { id: 7, name: 'Matthew Schaeffer, MD' },
    { id: 8, name: 'Michael Schaeffer, MD' }
  ],
  addEventListener: () => {},
  removeEventListener: () => {},
  postMessage: () => {}
};
context.window = context;
context.__mlsProviderRoster = {
  list: () => context._calProviders.map(p => Object.assign({ stableKey: `backend:${p.id}`, rosterVerified: true }, p)),
  getReceipt: () => ({ complete: true, partial: false, reason: 'complete' }),
  resolve: ref => {
    let raw = ref && typeof ref === 'object' ? (ref.stableKey || ref.id || ref.name || '') : String(ref || '');
    if (String(raw).startsWith('pv:')) raw = decodeURIComponent(String(raw).slice(3));
    const hits = context._calProviders.filter(p => String(p.id) === String(raw) || `backend:${p.id}` === String(raw) || String(p.name).toLowerCase() === String(raw).toLowerCase());
    return hits.length === 1 ? Object.assign({ stableKey: `backend:${hits[0].id}`, rosterVerified: true }, hits[0]) : null;
  }
};
vm.runInNewContext(siSource, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });

const api = context.__mlsSI;
assert(api && typeof api._providerKey === 'function');
assert.strictEqual(api._providerKey('Schaeffer_Matthew_MD'), api._providerKey('Matthew Schaeffer, MD'));
assert.strictEqual(api._providerKey('Schaeffer, Matthew'), api._providerKey('Dr. Matthew Schaeffer DO'));
assert.notStrictEqual(api._providerKey('Matthew Schaeffer, MD'), api._providerKey('Michael Schaeffer, MD'));
assert.strictEqual(api._providerKey('Schaeffer'), '', 'single-token provider labels are ambiguous');

const fullResponse = {
  receipt: { complete: true, authoritativeEmpty: false },
  providers: ['Matthew Schaeffer, MD', 'Michael Schaeffer, MD'],
  providerDiag: { providerNames: ['Matthew Schaeffer, MD', 'Michael Schaeffer, MD'] }
};
const mixedRows = [
  { name: 'Patient One', provider: 'Schaeffer_Matthew_MD' },
  { name: 'Patient Two', provider: 'Michael Schaeffer, MD' },
  { name: 'Patient Three', provider: 'Matthew Schaeffer, DO' }
];
const exact = api._scopeProviderRows(mixedRows, { id: '7', name: 'Matthew Schaeffer, MD' }, fullResponse);
assert.strictEqual(exact.complete, true);
assert.strictEqual(exact.rows.length, 2);
assert(exact.rows.every(r => /Matthew|Schaeffer_Matthew/.test(r.provider)));
assert.strictEqual(exact.receipt.sourceRows, 3);
assert.strictEqual(exact.receipt.providerTaggedRows, 3);
assert.strictEqual(exact.receipt.matchingRows, 2);
assert.strictEqual(exact.receipt.mismatchedRows, 1);
assert.strictEqual(exact.receipt.unattributedRows, 0);

const partial = api._scopeProviderRows(
  mixedRows.concat([{ name: 'Patient Four', provider: '' }]),
  { id: '7', name: 'Matthew Schaeffer, MD' },
  fullResponse
);
assert.strictEqual(partial.complete, false);
assert.strictEqual(partial.reason, 'provider-incomplete');
assert.strictEqual(partial.rows.length, 0, 'partial provider attribution must import nothing');
assert.strictEqual(partial.receipt.unattributedRows, 1);

const absent = api._scopeProviderRows(
  [{ name: 'Patient Two', provider: 'Michael Schaeffer, MD' }],
  { id: '9', name: 'Amanda Carter, MD' },
  { receipt: { complete: true }, providers: ['Michael Schaeffer, MD'] }
);
assert.strictEqual(absent.complete, false);
assert.strictEqual(absent.reason, 'provider-not-found');
assert.strictEqual(absent.rows.length, 0, 'zero matches must never widen to every provider');

const provenEmpty = api._scopeProviderRows(
  [{ name: 'Patient Two', provider: 'Michael Schaeffer, MD' }],
  { id: '7', name: 'Matthew Schaeffer, MD' },
  { receipt: { complete: true }, providers: ['Matthew Schaeffer, MD', 'Michael Schaeffer, MD'] }
);
assert.strictEqual(provenEmpty.complete, true);
assert.strictEqual(provenEmpty.reason, 'provider-empty');
assert.strictEqual(provenEmpty.rows.length, 0);

const rosterProvenEmpty = api._scopeProviderRows(
  [{ name: 'Patient Two', provider: 'Michael Schaeffer, MD' }],
  { id: '7', name: 'Matthew Schaeffer, MD', rosterVerified: true },
  { receipt: { complete: true }, providers: ['Michael Schaeffer, MD'] }
);
assert.strictEqual(rosterProvenEmpty.complete, true, 'an exact calendar roster ID plus a fully attributed day proves a selected-provider empty day');
assert.strictEqual(rosterProvenEmpty.reason, 'provider-empty');
assert.strictEqual(rosterProvenEmpty.receipt.rosterVerified, true);

const noReceipt = api._scopeProviderRows(mixedRows, 'Matthew Schaeffer, MD', { providers: ['Matthew Schaeffer, MD'] });
assert.strictEqual(noReceipt.complete, false);
assert.strictEqual(noReceipt.reason, 'provider-unverified');

const all = api._scopeProviderRows(mixedRows, 'all', { receipt: { complete: true }, providers: fullResponse.providers });
assert.strictEqual(all.complete, true);
assert.strictEqual(all.rows.length, mixedRows.length);
assert.strictEqual(all.rows[0].provider, 'Schaeffer_Matthew_MD');
assert.strictEqual(all.rows[1].provider, 'Michael Schaeffer, MD');
const allUnverified = api._scopeProviderRows(mixedRows, 'all', null);
assert.strictEqual(allUnverified.complete, false, 'all-provider day scope requires a complete schedule receipt');

// Stable provider ids must remain authoritative even when two clinicians have
// the exact same display name. A name-token match may never widen one selected
// provider into the other provider's patients.
const duplicateNameProvider = { id: '7', stableKey: 'backend:7', name: 'Alex Morgan, MD', raw: 'Morgan_Alex_MD', rosterVerified: true };
const duplicateNameRows = [
  { name: 'Provider Seven Patient', provider: 'Alex Morgan, MD', providerId: '7' },
  { name: 'Provider Eight Patient', provider: 'Alex Morgan, MD', providerId: '8' }
];
const duplicateNameScoped = api._scopeProviderRows(duplicateNameRows, duplicateNameProvider, { receipt: { complete: true }, providers: ['Alex Morgan, MD'] });
assert.strictEqual(duplicateNameScoped.complete, true);
assert.deepStrictEqual(Array.from(duplicateNameScoped.rows, row => row.name), ['Provider Seven Patient'], 'same-name provider id isolation widened to the wrong clinician');
const duplicateNameMissingId = api._scopeProviderRows([{ name: 'Unproven Patient', provider: 'Alex Morgan, MD' }], duplicateNameProvider, { receipt: { complete: true }, providers: ['Alex Morgan, MD'] });
assert.strictEqual(duplicateNameMissingId.complete, false, 'id-less same-name row was guessed into a stable-id provider pull');
assert.strictEqual(duplicateNameMissingId.reason, 'provider-incomplete');

let selection = api.calendarSelection();
assert.strictEqual(selection.ok, true);
assert.strictEqual(selection.date, '2026-07-15');
assert.strictEqual(selection.provider.id, '7');
assert.strictEqual(selection.provider.name, 'Matthew Schaeffer, MD');

nodes.calProvFilter.value = '';
selection = api.calendarSelection();
assert.strictEqual(selection.ok, false);
assert.strictEqual(selection.reason, 'provider-required');

nodes.calProvFilter.value = '7';
context._calMode = 'month';
nodes.calDayPanel.style.display = 'none';
selection = api.calendarSelection();
assert.strictEqual(selection.ok, false);
assert.strictEqual(selection.reason, 'date-required');

nodes.calDayPanel.style.display = 'block';
selection = api.calendarSelection();
assert.strictEqual(selection.ok, true);
assert.strictEqual(selection.date, '2026-07-16');

context._calProviders.push({ id: 10, name: 'Schaeffer_Matthew_DO' });
selection = api.calendarSelection();
assert.strictEqual(selection.ok, false);
assert.strictEqual(selection.reason, 'provider-ambiguous');

(async () => {
  const listeners = new Set();
  const store = new Map();
  const posted = [];
  const savedBodies = [];
  function withWatchdog(promise, label, ms = 10000) {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} did not settle within ${ms}ms`)), ms); })
    ]).finally(() => { if (timer != null) clearTimeout(timer); });
  }
  const patient = { id: 'p-provider-1', name: 'Exact Patient', dob: '01/02/1960', visits: [] };
  const runtimeNodes = {
    calProvFilter: { value: '7' },
    calDayPanel: { style: { display: 'block' } }
  };
  const rt = {
    console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
    encodeURIComponent, queueMicrotask, setTimeout, clearTimeout,
    setInterval: () => 1, clearInterval: () => {},
    location: { pathname: '/ScribeFlow-staging.html' },
    localStorage: {
      getItem: k => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: k => store.delete(k)
    },
    document: {
      readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
      getElementById: id => runtimeNodes[id] || null, addEventListener: () => {},
      body: {}, head: {}, documentElement: {}
    },
    _calMode: 'day', _calRefDate: '2026-07-15', _calSelDay: '',
    _calProviders: [{ id: 7, name: 'Matthew Schaeffer, MD' }, { id: 8, name: 'Michael Schaeffer, MD' }],
    backendMode: () => true, bkToken: () => 'test-token', bkBase: () => 'https://local.invalid',
    uns: k => `test::${k}`,
    _normDate: d => String(d || '').slice(0, 10),
    _normTime: t => {
      const s = String(t || '').trim();
      let m = s.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
      if (!m) return '';
      let h = Number(m[1]);
      if (m[3]) { if (/PM/i.test(m[3]) && h < 12) h += 12; if (/AM/i.test(m[3]) && h === 12) h = 0; }
      return `${String(h).padStart(2, '0')}:${m[2]}`;
    },
    _apptKey: (n, d, t) => `${String(n).trim().toLowerCase()}|${d}|${t}`,
    _acctWallToUtcIso: (d, t) => `${d}T${t}:00.000Z`,
    getPatients: () => [patient], upsertPatient: () => {},
    loadCalendar: () => Promise.resolve(), renderTodayPicker: () => {}, renderHistory: () => {}, loadPatients: () => {},
    _athenaHistoryTargetSnapshot: ref => ref && ref.patientId === patient.id
      ? { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: '' } : null,
    _hasImportedHistory: target => !!(target && target.patientId === patient.id),
    _athenaHistoryProofMatches: (target, observed) => target.patientId === patient.id && observed.chartName === patient.name && observed.chartDob === patient.dob,
    _assistReadChart: () => {
      const requestId = 'chart-provider-day';
      const text = 'Verified chart problems medications allergies and clinical history';
      return Promise.resolve({
        text, requestId, chartName: patient.name, chartDob: patient.dob, chartMrn: '',
        coverageReceipt: {
          kind: 'athena-chart-coverage', complete: true, readerVersion: '2.9.19-chart-r3', identityObserved: true, truncated: false,
          requestId, capturedAt: Date.now(), expectedClinicalFrames: 1, readClinicalFrames: 1, boundClinicalFrames: 1,
          unboundClinicalFrames: 0, oversizeClinicalFrames: 0, unreadFrames: 0, omittedForCap: 0, textChars: text.length
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
    _athenaHistoryVerifiedRef: target => Object.freeze({ patientId: target.patientId, name: target.name, dob: target.dob, verifiedName: target.name, verifiedDob: target.dob }),
    _savePatientChart: (ref, _row, chart) => { patient.athenaChartSnapshot = { problems: String(chart.problems || ''), meds: String(chart.meds || ''), allergies: String(chart.allergies || ''), summary: String(chart.summary || ''), vitals: Object.assign({}, chart.vitals || {}), history: Object.assign({}, chart.history || {}), visits: [] }; patient.athenaProfileCoverage = { complete: true, exactIdentityVerified: true, patientId: patient.id, capturedAt: new Date().toISOString(), saveRequestId: String(ref.requestId || ''), cards: {
      problems: { populated: true }, meds: { populated: true }, allergies: { populated: true }, summary: { populated: true }, vitals: { populated: true }, history: { populated: true }
    } }; return true; },
    _patientHistoryCardCoverage: () => patient.athenaProfileCoverage,
    __mlsVisitModel: null,
    __mlsCopyVisits: null,
    fetch: async (_url, init) => {
      if (!init || !init.method) return { ok: true, json: async () => ({ appointments: [] }) };
      savedBodies.push(JSON.parse(init.body));
      return { ok: true, status: 200, json: async () => ({ ok: true, id: `provider-day-backend-${savedBodies.length}` }) };
    }
  };
  function storeVerifiedVisit(_id, raw, opts) {
    opts = opts || {};
    const stored = Object.assign({}, raw, {
      source: opts.source || 'athena-copy', identityVerified: opts.identityVerified === true,
      identityBinding: opts.identityBinding || patient.id,
      bodyComplete: opts.bodyComplete === true && raw.fullDetail === true
    });
    const key = stored.encounterId || stored.sourceVisitKey;
    const prior = patient.visits.findIndex(v => (v.encounterId || v.sourceVisitKey) === key);
    if (prior >= 0) patient.visits[prior] = stored; else patient.visits.push(stored);
    return stored;
  }
  rt.__mlsVisitModel = {
    addVisit: storeVerifiedVisit,
    getVisits: () => patient.visits,
    reconcileVerifiedAthenaVisits: () => ({ complete: true, removed: 0, kept: patient.visits.length }),
    organizePatientHistory: () => ({ ok: true, verifiedVisits: patient.visits.length })
  };
  rt.__mlsCopyVisits = {
    _saveVisits: (_p, _identity, visits) => {
      visits.forEach(v => storeVerifiedVisit(patient.id, v, { source: 'athena-copy', identityVerified: true, identityBinding: patient.id, bodyComplete: true }));
      return visits.length;
    },
    _visitIdentityAgrees: () => true
  };
  rt.window = rt;
  /* This harness calls the low-level history seam after the public pull. Give
     that diagnostic call the same explicit, settled Full Notes ON choice a
     clinician would have made; an unset resolver must now fail closed. */
  rt.__mlsVisitNotesPref = require('./lib-visit-notes-resolver.js').makeResolver(rt.uns, rt.localStorage);
  assert.strictEqual(rt.__mlsVisitNotesPref.write(true), true, 'provider-day harness could not persist explicit Full Notes ON');
  let armedRosterOperation = null;
  rt.__mlsProviderRoster = {
    list: () => rt._calProviders.map(p => Object.assign({ stableKey: `backend:${p.id}`, rosterVerified: true }, p)),
    beginOperation: op => { armedRosterOperation = Object.assign({}, op); return armedRosterOperation; },
    getReceipt: () => Object.assign(
      { complete: true, partial: false, reason: 'complete' },
      armedRosterOperation ? {
        targetDate: armedRosterOperation.targetDate, requestId: armedRosterOperation.requestId,
        providerMode: armedRosterOperation.providerMode,
        requestedProviderId: armedRosterOperation.requestedProviderId,
        requestedProviderStableKey: armedRosterOperation.requestedProviderStableKey
      } : {}
    ),
    resolve: ref => {
      let raw = ref && typeof ref === 'object' ? (ref.stableKey || ref.id || ref.name || '') : String(ref || '');
      if (String(raw).startsWith('pv:')) raw = decodeURIComponent(String(raw).slice(3));
      const hits = rt._calProviders.filter(p => String(p.id) === String(raw) || `backend:${p.id}` === String(raw) || String(p.name).toLowerCase() === String(raw).toLowerCase());
      return hits.length === 1 ? Object.assign({ stableKey: `backend:${hits[0].id}`, rosterVerified: true }, hits[0]) : null;
    }
  };
  rt.addEventListener = (_type, fn) => listeners.add(fn);
  rt.removeEventListener = (_type, fn) => listeners.delete(fn);
  const emit = (type, resp, id) => {
    const event = { data: { source: 'mls-ext', type, id: id || '', resp } };
    Array.from(listeners).forEach(fn => fn(event));
  };
  rt.postMessage = msg => {
    posted.push(msg);
    if (msg.type === 'mlsPing') queueMicrotask(() => emit('mlsPong', { ok: true }, ''));
    if (msg.type === 'mlsAppGotoDate') queueMicrotask(() => {
      emit('mlsAppGotoDateResult', { id: 'stale-request', ok: true, schedDate: '2026-07-14' }, 'stale-request');
      emit('mlsAppGotoDateResult', { id: msg.id, ok: true, schedDate: '2026-07-15' }, msg.id);
    });
    if (msg.type === 'mlsAppPullSchedule') queueMicrotask(() => {
      emit('mlsAppScheduleResult', { id: 'stale-request', ok: true, schedDate: '2026-07-15', receipt: { complete: true }, appts: [{ name: 'Wrong Patient', time: '8:00 AM', provider: 'Michael Schaeffer, MD' }], providers: ['Michael Schaeffer, MD'] }, 'stale-request');
      emit('mlsAppScheduleResult', {
        id: msg.id, requestId: msg.requestId || msg.id, ok: true, scheduleVerified: true, schedDate: '2026-07-15', text: 'Wednesday July 15 2026',
        receipt: { complete: true, authoritativeEmpty: false, parsedCount: 1, expectedCount: 1, requestId: msg.requestId || msg.id },
        appts: [{ name: patient.name, dob: patient.dob, date: '2026-07-15', time: '9:20 AM', provider: 'Schaeffer_Matthew_MD' }],
        providers: ['Matthew Schaeffer, MD'], providerDiag: { providerNames: ['Matthew Schaeffer, MD'] }
      }, msg.id);
    });
    if (msg.type === 'mlsAppReadAllVisits') queueMicrotask(() => {
      const event = { data: {
        source: 'mls-ext', type: 'mlsAppAllVisitsResult', id: msg.id, requestId: msg.id, ok: true,
        visits: [{ date: '2026-01-01', type: 'Office visit', raw: 'Verified old visit with substantive clinical detail for the regression.', fullDetail: true, sourceVisitKey: 'row:provider-day-1' }],
        receipt: { complete: true, indexComplete: true, bodyComplete: true, fullDetail: true, stableKeysComplete: true, expected: 1, parsed: 1, cap: 500, readerVersion: '2.9.22-visits-r4-two-stage' },
        readerVersion: '2.9.22-visits-r4-two-stage', identity: { name: patient.name, dob: patient.dob, mrn: '' }
      } };
      Array.from(listeners).forEach(fn => fn(event));
    });
  };

  vm.runInNewContext(siSource, rt, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
  const promise = rt.__mlsSI.pullCalendarSelection({ includeHistory: true, pullVisitBodies: true, onStatus: () => {} });
  // Mutate the live calendar immediately; the in-flight request must retain its snapshot.
  runtimeNodes.calProvFilter.value = '8';
  rt._calRefDate = '2026-07-20';
  const result = await withWatchdog(promise, 'provider-day history pull');
  assert.strictEqual(result.ok, true, JSON.stringify({ reason: result.reason, error: result.error, historyReceipt: result.historyReceipt }));
  assert.strictEqual(result.complete, true);
  assert.strictEqual(result.scheduleVerified, true, 'verified schedule provenance was not retained on the final pull receipt');
  assert.strictEqual(result.target, '2026-07-15');
  assert.strictEqual(result.requestedProvider.id, '7');
  assert.strictEqual(result.requestedProvider.name, 'Matthew Schaeffer, MD');
  assert.strictEqual(result.providerReceipt.matchingRows, 1);
  assert.strictEqual(result.providerReceipt.unattributedRows, 0);
  assert.strictEqual(result.historyReceipt.complete, true);
  assert.strictEqual(result.historyReceipt.exactIdentityVerified, true);
  assert.strictEqual(result.historyReceipt.failures, 0);
  assert.strictEqual(savedBodies.length, 1);
  assert.strictEqual(savedBodies[0].provider, 'Schaeffer_Matthew_MD');
  assert.strictEqual(savedBodies[0].appt_date, '2026-07-15');
  assert(posted.filter(m => m.type === 'mlsAppGotoDate' || m.type === 'mlsAppPullSchedule').every(m => /^mlssi-/.test(m.id)), 'provider-day bridge requests must carry correlation ids');

  const visitsBeforeScheduleOnly = posted.filter(m => m.type === 'mlsAppReadAllVisits').length;
  runtimeNodes.calProvFilter.value = '7';
  rt._calMode = 'day'; rt._calRefDate = '2026-07-15'; runtimeNodes.calDayPanel.style.display = 'block';
  const scheduleOnly = await withWatchdog(rt.__mlsSI.pullCalendarSelection({ includeHistory: false, pullVisitBodies: false, onStatus: () => {} }), 'provider-day schedule-only pull');
  assert.strictEqual(scheduleOnly.ok, true);
  assert.strictEqual(scheduleOnly.complete, true);
  assert.strictEqual(scheduleOnly.includeHistory, false);
  assert.strictEqual(scheduleOnly.reason, 'complete-schedule-only');
  assert.strictEqual(scheduleOnly.historyReceipt.skipped, true);
  assert.strictEqual(scheduleOnly.historyReceipt.reason, 'full-notes-off');
  assert.strictEqual(posted.filter(m => m.type === 'mlsAppReadAllVisits').length, visitsBeforeScheduleOnly, 'schedule-only mode must not read Athena history/visits');

  const blockedNameOnly = await withWatchdog(rt.__mlsSI._runHistoryBatch([{ name: patient.name }], [], () => {}), 'provider-day name-only rejection');
  assert.strictEqual(blockedNameOnly.complete, false);
  assert.strictEqual(blockedNameOnly.exactIdentityVerified, false);
  assert.strictEqual(blockedNameOnly.retry[0].reason, 'identity-target-unresolved', 'name-only history targets remain blocked');

  console.log('PASS provider-day pull, default-on exact history, schedule-only opt-out, and frozen runtime route');
})().catch(err => { console.error(err); process.exit(1); });
