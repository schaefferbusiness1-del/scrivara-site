'use strict';

/* p1 appointment-census display authority contract
 *
 * A provider-unknown census proves the exact appointment IDs painted on one
 * Athena Day grid, but it proves neither provider attribution nor practice
 * coverage.  Deleting the provider/day authority is necessary, but it leaves
 * the schedule UIs falling back to the append-only backend calendar.  That
 * fallback can resurrect stale/cancelled Athena rows after a reload.
 *
 * The intended p1-only split is:
 *
 *   uns('p1SchedAppointmentCensusDaysV1')
 *     -> { v:1, days:{ YYYY-MM-DD:{ v:1, date,
 *          kind:'appointment-census-only', backendIds:[...], sourceCount,
 *          providerAttributionComplete:false, coversPractice:false,
 *          updated } } }
 *
 * This store is PHI-free and independent from schedAuthoritativeDaysV1.  The
 * latter remains the only provider/day authority.  The p1 importer exports a
 * display-only reader; p1-specific Next Up and Task3 forks consume it.  The
 * public/shared files and extension must not change.
 *
 * It became part of the green registry only after every assertion below
 * passed against the isolated 1p implementation.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const importerPath = path.join(root, '1p-feat_mls_schedimport_exact.js');
const nextUpPath = path.join(root, '1p-feat_nextup_connect.js');
const frontsyncPath = path.join(root, '1p-feat_task3_frontsync.js');
const p1ConnectPath = path.join(root, '1p-mls-connect.js');

const importerSource = fs.readFileSync(importerPath, 'utf8');
const p1ConnectSource = fs.readFileSync(p1ConnectPath, 'utf8');
const DAY = '2026-08-17';
const COUNT = 26;
const DISPLAY_SUFFIX = 'p1SchedAppointmentCensusDaysV1';
const AUTHORITATIVE_SUFFIX = 'schedAuthoritativeDaysV1';
const storage = new Map();
const displayKey = `p1-display-test::${DISPLAY_SUFFIX}`;
const authoritativeKey = `p1-display-test::${AUTHORITATIVE_SUFFIX}`;
let rejectDisplayWrite = false;
let rejectAuthoritativeWrite = false;

const active = Array.from({ length: COUNT }, (_, index) => ({
  id: `backend-census-${index + 1}`,
  athena_appointment_id: `athena-census-${index + 1}`,
  name: `Exact Census ${index + 1}`,
  appt_date: DAY,
  start_at: `${DAY}T${String(8 + Math.floor(index / 6)).padStart(2, '0')}:${String((index % 6) * 10).padStart(2, '0')}:00.000Z`,
  provider: ''
}));
const stale = [
  { id: 'backend-stale-cancelled', athena_appointment_id: 'athena-cancelled', name: 'STALE CANCELLED', appt_date: DAY, start_at: `${DAY}T15:00:00.000Z`, provider: '' },
  { id: 'backend-stale-moved', athena_appointment_id: 'athena-moved-old', patient_external_id: 'p_sched_old-row', name: 'STALE MOVED', appt_date: DAY, start_at: `${DAY}T15:20:00.000Z`, provider: '' }
];
const manual = {
  id: 'manual-keep', source: 'manual', name: 'Manual MLS row',
  appt_date: DAY, start_at: `${DAY}T16:00:00.000Z`, provider: ''
};
const manualPlausiblePatientId = {
  id: 'manual-p-sched-patient', source: 'manual', patient_external_id: 'p_sched_manual-patient',
  name: 'Manual prefixed patient id', appt_date: DAY, start_at: `${DAY}T16:10:00.000Z`, provider: ''
};
const rawRows = active.concat(stale, manual, manualPlausiblePatientId);
const mappings = active.map((row, index) => ({
  sourceIdentity: `source-appointment-${index + 1}`,
  backendAppointmentId: row.id
}));

function fakeNode(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(), id: '', hidden: false,
    style: {}, children: [], parentNode: null, parentElement: null,
    classList: { contains: () => false, add: () => {}, remove: () => {} },
    setAttribute(name, value) { this[name] = String(value); },
    getAttribute() { return null; }, removeAttribute() {},
    appendChild(child) { if (child) { child.parentNode = this; child.parentElement = this; this.children.push(child); } return child; },
    insertBefore(child) { return this.appendChild(child); },
    removeChild(child) { this.children = this.children.filter(one => one !== child); },
    querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    addEventListener() {}, removeEventListener() {}
  };
}

let heroRendered = null;
const body = fakeNode('body');
const head = fakeNode('head');
const documentElement = fakeNode('html');
const context = {
  console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number,
  Boolean, RegExp, Error, TypeError, encodeURIComponent, decodeURIComponent,
  queueMicrotask,
  setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
  requestIdleCallback: fn => { fn({ didTimeout: false, timeRemaining: () => 50 }); return 1; },
  cancelIdleCallback: () => {},
  location: { pathname: '/1p/' },
  navigator: {},
  sessionStorage: { getItem: key => key === '__mlsNextUpDebugDate' ? DAY : null, setItem() {}, removeItem() {} },
  localStorage: {
    getItem: key => storage.has(String(key)) ? storage.get(String(key)) : null,
    setItem: (key, value) => {
      key = String(key);
      if (rejectDisplayWrite && key === displayKey) throw new Error('synthetic p1 display quota failure');
      if (rejectAuthoritativeWrite && key === authoritativeKey) throw new Error('synthetic p1 authority quota failure');
      storage.set(key, String(value));
    },
    removeItem: key => storage.delete(String(key))
  },
  document: {
    readyState: 'complete', body, head, documentElement,
    createElement: fakeNode,
    getElementById: () => null,
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}
  },
  CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  uns: suffix => `p1-display-test::${suffix}`,
  _normDate: value => String(value || '').slice(0, 10),
  _normTime: value => String(value || '').slice(0, 5),
  _acctWallToUtcIso: (date, time) => `${date}T${time}:00.000Z`,
  _acctTz: () => 'America/Indianapolis',
  _apptHHMMTz: value => String(value || '').slice(11, 16),
  _calLabelOf: row => row && row.name || '',
  _calAppts: rawRows.map(row => Object.assign({}, row)),
  getPatients: () => [], upsertPatient: () => {},
  backendMode: () => false, bkToken: () => '',
  loadCalendar: () => Promise.resolve(), loadPatients: () => Promise.resolve(),
  renderCalendar: () => {}, renderHistory: () => {}, renderProfile: () => {},
  _calLoadNextUp: () => {},
  _renderTodayPatients: rows => {
    heroRendered = (rows || []).map(row => Object.assign({}, row));
    context._heroTodayList = heroRendered;
  },
  fetch: async () => ({ ok: true, status: 200, json: async () => ({}) })
};
context.window = context;

/* A separate VM is important here: the production module keeps only a
   process-local hint for days it has already read. A hard reload has no such
   hint, so corrupt or unreadable durable census storage must still own the
   queried day fail-closed instead of reopening the append-only calendar. */
const freshContextTemplate = Object.assign({}, context);
function bootFreshImporterWithDisplayRead(mode) {
  const freshBody = fakeNode('body');
  const freshHead = fakeNode('head');
  const freshDocumentElement = fakeNode('html');
  const fresh = Object.assign({}, freshContextTemplate, {
    _calAppts: rawRows.map(row => Object.assign({}, row)),
    sessionStorage: {
      getItem: key => key === '__mlsNextUpDebugDate' ? DAY : null,
      setItem() {}, removeItem() {}
    },
    localStorage: {
      getItem(key) {
        key = String(key);
        if (key === displayKey && mode === 'throw') throw new Error('synthetic fresh census read failure');
        if (key === displayKey && mode === 'corrupt') return '{"v":1,"days":"fresh-corrupt-census-store"}';
        return storage.has(key) ? storage.get(key) : null;
      },
      setItem(key, value) { storage.set(String(key), String(value)); },
      removeItem(key) { storage.delete(String(key)); }
    },
    document: {
      readyState: 'complete', body: freshBody, head: freshHead,
      documentElement: freshDocumentElement,
      createElement: fakeNode,
      getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {}
    },
    _renderTodayPatients(rows) {
      fresh._heroTodayList = (rows || []).map(row => Object.assign({}, row));
    }
  });
  fresh.window = fresh;
  vm.runInNewContext(importerSource, fresh, {
    filename: `1p-feat_mls_schedimport_exact.fresh-${mode}.js`, timeout: 3000
  });
  return fresh;
}

function bootFreshImporterWithAuthorityRead(mode) {
  const freshBody = fakeNode('body');
  const freshHead = fakeNode('head');
  const freshDocumentElement = fakeNode('html');
  const faultRaw = mode === 'corrupt'
    ? '{"v":1,"days":"fresh-corrupt-provider-authority"}'
    : mode === 'nested-corrupt'
      ? JSON.stringify({
          v: 1,
          days: {
            [DAY]: {
              all: {
                v: 1, date: DAY, mode: 'all', providerKey: '',
                backendIds: 'malformed-not-an-array', sourceCount: 1, updated: 1
              },
              providers: {}, active: { mode: 'all', key: '' }
            }
          }
        })
      : '{"v":1,"days":{"unreadable-provider-authority":true}}';
  const backing = new Map(storage);
  backing.delete(displayKey); /* prove provider-store failure owns the day by itself */
  backing.set(authoritativeKey, faultRaw);
  const faultState = { backing, faultRaw, authorityWriteAttempts: 0 };
  const fresh = Object.assign({}, freshContextTemplate, {
    _calAppts: rawRows.map(row => Object.assign({}, row)),
    sessionStorage: {
      getItem: key => key === '__mlsNextUpDebugDate' ? DAY : null,
      setItem() {}, removeItem() {}
    },
    localStorage: {
      getItem(key) {
        key = String(key);
        if (key === authoritativeKey && mode === 'throw') {
          throw new Error('synthetic fresh provider-authority read failure');
        }
        return backing.has(key) ? backing.get(key) : null;
      },
      setItem(key, value) {
        key = String(key);
        if (key === authoritativeKey) faultState.authorityWriteAttempts++;
        backing.set(key, String(value));
      },
      removeItem(key) { backing.delete(String(key)); }
    },
    document: {
      readyState: 'complete', body: freshBody, head: freshHead,
      documentElement: freshDocumentElement,
      createElement: fakeNode,
      getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {}
    },
    _renderTodayPatients(rows) {
      fresh._heroTodayList = (rows || []).map(row => Object.assign({}, row));
    }
  });
  fresh.window = fresh;
  fresh.__authorityFaultState = faultState;
  vm.runInNewContext(importerSource, fresh, {
    filename: `1p-feat_mls_schedimport_exact.fresh-authority-${mode}.js`, timeout: 3000
  });
  return fresh;
}

vm.runInNewContext(importerSource, context, {
  filename: '1p-feat_mls_schedimport_exact.js', timeout: 3000
});
const api = context.__mlsSI;
assert(api, 'p1 importer API did not boot');

assert.strictEqual(typeof api._publishAppointmentCensusDisplaySnapshot, 'function',
  'RED: p1 importer needs a private publisher for the PHI-free display-only census');
assert.strictEqual(typeof api.appointmentCensusRowsForDay, 'function',
  'RED: p1 importer needs appointmentCensusRowsForDay(day)');
assert.strictEqual(typeof api.appointmentCensusStatusForDay, 'function',
  'RED: p1 importer needs appointmentCensusStatusForDay(day)');

const published = api._publishAppointmentCensusDisplaySnapshot({
  date: DAY,
  appointmentCensusReceipt: {
    complete: true, kind: 'athena-appointment-census', targetDate: DAY,
    rowCount: COUNT, uniqueAppointmentIds: COUNT,
    providerAttributionComplete: false, providerSnapshotAllowed: false,
    noProviderGuess: true
  },
  calendarReceipt: {
    complete: true, appointmentCensusComplete: true,
    attempted: COUNT, accounted: COUNT, mapped: COUNT,
    providerAttributionComplete: false
  },
  resolvedAppointments: mappings
});
assert.strictEqual(published.published, true, 'exact 26/26 census display snapshot was not published');
assert.strictEqual(published.providerAuthorityPublished, false,
  'display snapshot falsely claimed provider authority');

const durableRaw = storage.get(displayKey);
assert(durableRaw, `display snapshot was not persisted under uns('${DISPLAY_SUFFIX}')`);
const durable = JSON.parse(durableRaw);
assert.strictEqual(durable.v, 1);
assert.deepStrictEqual(Object.keys(durable.days), [DAY]);
assert.strictEqual(durable.days[DAY].kind, 'appointment-census-only');
assert.strictEqual(durable.days[DAY].providerAttributionComplete, false);
assert.strictEqual(durable.days[DAY].coversPractice, false);
assert.strictEqual(durable.days[DAY].backendIds.length, COUNT);
for (const forbidden of ['Exact Census', 'STALE CANCELLED', 'Manual MLS row', '01/01/', 'Doctor']) {
  assert(!durableRaw.includes(forbidden), `PHI/display text leaked into census display store: ${forbidden}`);
}

const status = api.appointmentCensusStatusForDay(DAY);
assert.strictEqual(status.available, true);
assert.strictEqual(status.exactAppointments, true);
assert.strictEqual(status.providerAttributionComplete, false);
assert.strictEqual(status.coversPractice, false);
assert.strictEqual(status.sourceCount, COUNT);
assert.strictEqual(status.activeCount, COUNT);
assert.strictEqual(status.missingCount, 0);
assert.strictEqual(status.unclassifiedCount, 4);
const exactRows = api.appointmentCensusRowsForDay(DAY);
assert.strictEqual(exactRows.length, COUNT);
assert(!exactRows.some(row => /^backend-stale-/.test(row.id) || row.id === manual.id),
  'display-only census reader returned stale/manual rows outside its exact ID set');

assert.strictEqual(api.authoritativeStatusForDay(DAY, 'all').exact, false,
  'appointment display census leaked into provider/day authority');
assert.strictEqual(api.authoritativeRowsForDay(DAY, 'all'), null,
  'appointment display census leaked through provider-authoritative rows');

const missing = context._calAppts.shift();
const pending = api.appointmentCensusStatusForDay(DAY);
assert.strictEqual(pending.available, false, 'missing backend row was reported as an exact display census');
assert.strictEqual(pending.missingCount, 1);
assert.strictEqual(api.appointmentCensusRowsForDay(DAY), null,
  'partial backend hydration returned a plausible-but-incomplete display slice');
context._calAppts.unshift(missing);
assert.strictEqual(api.appointmentCensusRowsForDay(DAY).length, COUNT,
  'display census did not recover after backend calendar hydration completed');

const originalFirstName = context._calAppts[0].name;
const originalFirstDob = context._calAppts[0].dob;
context._calAppts[1].name = originalFirstName;
context._calAppts[1].dob = originalFirstDob;
context._calAppts[1].start_at = context._calAppts[0].start_at;
context._calAppts[0].patient_external_id = 'same-proven-patient';
context._calAppts[1].patient_external_id = 'same-proven-patient';
/* Distinct appointment IDs remain distinct even when demographics/time are
   identical; provider-unknown census IDs are the stronger identity proof. */
assert.strictEqual(api.appointmentCensusRowsForDay(DAY).length, COUNT,
  'same-patient/day/time distinct appointment IDs collapsed before display authority');

const duplicateBackendRow = Object.assign({}, context._calAppts[0]);
context._calAppts.push(duplicateBackendRow);
const duplicateBackendStatus = api.appointmentCensusStatusForDay(DAY);
assert.strictEqual(duplicateBackendStatus.available, false,
  'duplicate backend rows for one stored census ID were reported exact');
assert.strictEqual(duplicateBackendStatus.reason, 'duplicate-backend-rows');
assert.strictEqual(api.appointmentCensusRowsForDay(DAY), null,
  'duplicate backend hydration returned a plausible exact slice');
context._calAppts.pop();

const duplicate = api._publishAppointmentCensusDisplaySnapshot({
  date: DAY,
  appointmentCensusReceipt: {
    complete: true, kind: 'athena-appointment-census', targetDate: DAY,
    rowCount: 2, uniqueAppointmentIds: 2, providerAttributionComplete: false,
    providerSnapshotAllowed: false, noProviderGuess: true
  },
  calendarReceipt: {
    complete: true, appointmentCensusComplete: true,
    attempted: 2, accounted: 2, mapped: 2,
    providerAttributionComplete: false
  },
  resolvedAppointments: [
    { sourceIdentity: 'dup-source-1', backendAppointmentId: active[0].id },
    { sourceIdentity: 'dup-source-2', backendAppointmentId: active[0].id }
  ]
});
assert.strictEqual(duplicate.published, false, 'non-1:1 census mapping replaced exact display authority');
assert.strictEqual(api.appointmentCensusRowsForDay(DAY).length, COUNT,
  'rejected display snapshot destroyed the last exact census');

rejectDisplayWrite = true;
const failedWrite = api._publishAppointmentCensusDisplaySnapshot({
  date: DAY,
  appointmentCensusReceipt: {
    complete: true, kind: 'athena-appointment-census', targetDate: DAY,
    rowCount: 1, uniqueAppointmentIds: 1, providerAttributionComplete: false,
    providerSnapshotAllowed: false, noProviderGuess: true
  },
  calendarReceipt: {
    complete: true, appointmentCensusComplete: true,
    attempted: 1, accounted: 1, mapped: 1,
    providerAttributionComplete: false
  },
  resolvedAppointments: [{ sourceIdentity: 'replacement-source', backendAppointmentId: active[0].id }]
});
rejectDisplayWrite = false;
assert.strictEqual(failedWrite.published, false, 'failed display persistence was reported as published');
assert.strictEqual(api.appointmentCensusRowsForDay(DAY).length, COUNT,
  'failed display write mutated the prior in-memory authority by reference');

const goodBeforeCorrupt = storage.get(displayKey);
storage.set(displayKey, '{corrupt-census-json');
const corruptWrite = api._publishAppointmentCensusDisplaySnapshot({
  date: DAY,
  appointmentCensusReceipt: {
    complete: true, kind: 'athena-appointment-census', targetDate: DAY,
    rowCount: 1, uniqueAppointmentIds: 1, providerAttributionComplete: false,
    providerSnapshotAllowed: false, noProviderGuess: true
  },
  calendarReceipt: {
    complete: true, appointmentCensusComplete: true, attempted: 1,
    accounted: 1, mapped: 1, providerAttributionComplete: false
  },
  resolvedAppointments: [{ sourceIdentity: 'corrupt-replacement-source', backendAppointmentId: active[0].id }]
});
assert.strictEqual(corruptWrite.published, false,
  'publication overwrote an unreadable existing census store');
assert.strictEqual(storage.get(displayKey), '{corrupt-census-json',
  'publication destroyed unreadable existing census bytes');
storage.set(displayKey, goodBeforeCorrupt);

assert(fs.existsSync(nextUpPath), 'RED: isolate the p1 Next Up consumer as 1p-feat_nextup_connect.js');
assert(fs.existsSync(frontsyncPath), 'RED: isolate the p1 calendar consumer as 1p-feat_task3_frontsync.js');
const nextUpSource = fs.readFileSync(nextUpPath, 'utf8');
const frontsyncSource = fs.readFileSync(frontsyncPath, 'utf8');
assert(nextUpSource.includes('appointmentCensusRowsForDay') && nextUpSource.includes('appointmentCensusStatusForDay'),
  'p1 Next Up fork does not consume the appointment-only authority/status');
assert(frontsyncSource.includes('appointmentCensusRowsForDay') && frontsyncSource.includes('appointmentCensusStatusForDay'),
  'p1 Task3 fork does not consume the appointment-only authority/status');
assert(p1ConnectSource.includes('1p-feat_task3_frontsync.js'),
  'p1 connector still loads the shared Task3 consumer');
assert(importerSource.includes('1p-feat_nextup_connect.js'),
  'p1 importer still loads the shared Next Up consumer');
assert(importerSource.includes('version === "nextup-p1-2.1.0"'),
  'p1 importer can mistake the old shared Next Up API for the isolated census consumer');
assert(frontsyncSource.includes("window.__mlsT3.version === 't3-p1-1.2.0'") &&
  frontsyncSource.includes("typeof window.__mlsT3.revert === 'function'"),
  'p1 Task3 cannot take over from an already-installed shared consumer');

for (const mode of ['corrupt', 'throw']) {
  const fresh = bootFreshImporterWithDisplayRead(mode);
  const freshStatus = fresh.__mlsSI.appointmentCensusStatusForDay(DAY);
  assert.strictEqual(freshStatus.kind, 'appointment-census-only',
    `fresh ${mode} census storage was treated as an unowned day`);
  assert.strictEqual(freshStatus.storeUnavailable, true,
    `fresh ${mode} census storage did not report fail-closed storage ownership`);
  assert.strictEqual(freshStatus.reason,
    mode === 'corrupt' ? 'snapshot-store-invalid' : 'snapshot-store-read-failed');
  assert.strictEqual(fresh.__mlsSI.appointmentCensusRowsForDay(DAY), null,
    `fresh ${mode} census storage returned an unverified display slice`);

  vm.runInNewContext(nextUpSource, fresh, {
    filename: `1p-feat_nextup_connect.fresh-${mode}.js`, timeout: 3000
  });
  assert.strictEqual(fresh.__mlsNextUp._buildToday().length, 0,
    `fresh ${mode} census storage reopened Next Up raw-calendar fallback`);

  vm.runInNewContext(frontsyncSource, fresh, {
    filename: `1p-feat_task3_frontsync.fresh-${mode}.js`, timeout: 3000
  });
  fresh.MLSCal.normalize();
  assert.strictEqual(fresh.MLSCal.rows({ date: DAY }).length, 0,
    `fresh ${mode} census storage reopened Task3 raw-calendar fallback`);
}

const legacyMarker = p1ConnectSource.indexOf('feat_nextup_connect.js  —  NEXT UP');
for (const mode of ['corrupt', 'nested-corrupt', 'throw']) {
  const fresh = bootFreshImporterWithAuthorityRead(mode);
  const freshStatus = fresh.__mlsSI.authoritativeStatusForDay(DAY, 'all');
  assert.strictEqual(fresh.__mlsSI.appointmentCensusStatusForDay(DAY).reason, 'no-snapshot',
    `fresh ${mode} provider-authority fixture unexpectedly had a census`);
  assert.strictEqual(freshStatus.available, false,
    `fresh ${mode} provider-authority storage was reported available`);
  assert.strictEqual(freshStatus.exact, false,
    `fresh ${mode} provider-authority storage was reported exact`);
  assert.strictEqual(freshStatus.storeUnavailable, true,
    `fresh ${mode} provider-authority storage did not own the day fail-closed`);
  assert.strictEqual(freshStatus.scope, 'authority-unavailable',
    `fresh ${mode} provider-authority status looked like an unowned day`);
  assert.strictEqual(freshStatus.reason,
    mode === 'throw' ? 'authority-store-read-failed' : 'authority-store-invalid');
  assert.strictEqual(fresh.__mlsSI.authoritativeRowsForDay(DAY, 'all'), null,
    `fresh ${mode} provider-authority storage returned an unverified row slice`);

  vm.runInNewContext(nextUpSource, fresh, {
    filename: `1p-feat_nextup_connect.fresh-authority-${mode}.js`, timeout: 3000
  });
  assert.strictEqual(fresh.__mlsNextUp._buildToday().length, 0,
    `fresh ${mode} provider-authority storage reopened Next Up raw-calendar fallback`);

  vm.runInNewContext(frontsyncSource, fresh, {
    filename: `1p-feat_task3_frontsync.fresh-authority-${mode}.js`, timeout: 3000
  });
  fresh.MLSCal.normalize();
  assert.strictEqual(fresh.MLSCal.rows({ date: DAY }).length, 0,
    `fresh ${mode} provider-authority storage reopened Task3 raw-calendar fallback`);

  const refused = fresh.__mlsSI._publishAuthoritativeSnapshot({
    date: DAY,
    provider: 'all',
    scheduleReceipt: { complete: true, authoritativeEmpty: false },
    returnedAppointments: active,
    providerReceipt: { complete: true, reason: 'all-providers' },
    calendarReceipt: { complete: true, attempted: COUNT },
    resolvedAppointments: mappings
  });
  /* ===== p1-authority-repair-1.0.0 (2026-08-17) - a DELIBERATE change to
     this contract, for the 'corrupt' mode only.

     What this loop proved, and still proves for 'nested-corrupt' and 'throw':
     a publisher may never overwrite bytes it could not validate. That is the
     right rule when the failure is per-DAY (nested-corrupt: the day is
     quarantined, every other date still publishes and the blob self-heals) or
     when the read itself faulted (throw: we know nothing about the bytes).

     What it ALSO froze, wrongly: the WHOLE-STORE refusal. 'corrupt' mode is
     {"v":1,"days":"a string"} - days is not an object, so
     sanitizeAuthoritativeStore returns null outright, loadAuthoritativeStore
     reports authority-store-invalid, and because writeAuthoritativeStore
     sanitises BEFORE writing there was NO removeItem for this key anywhere in
     the file. The bytes could therefore never be replaced by anything: one
     alien blob wedged every future pull on every date, PERMANENTLY. That is
     the owner's live "snapshotPublished:false / authority-store-invalid",
     and a fail-closed rule that can never re-open is not fail-closed, it is
     failed.

     The repair is the smallest thing that closes it and it destroys nothing
     attributable: it first tries to SALVAGE (re-shape to the only legal top
     level and re-run the same per-day validator, keeping every day that
     validates), and only resets when NO day can be attributed to anything -
     which is exactly this fixture, where days is a bare string. The
     per-day and read-failure refusals below are untouched. */
  if (mode === 'corrupt') {
    assert.strictEqual(refused.published, true,
      'a top-level-alien authority blob still wedges every future publish forever');
    assert(refused.authorityRepair && refused.authorityRepair.ok === true,
      'the publish did not record the bounded repair it performed');
    assert.strictEqual(refused.authorityRepair.action, 'reset-unreadable',
      'the repair did something other than the bounded reset on unattributable bytes');
    assert.strictEqual(refused.authorityRepair.salvagedDays, 0,
      'the repair claimed to salvage days from a store whose days is a bare string');
    assert.notStrictEqual(
      fresh.__authorityFaultState.backing.get(authoritativeKey),
      fresh.__authorityFaultState.faultRaw,
      'the corrupt bytes survived a successful repair');
  } else {
    assert.strictEqual(refused.published, false,
      `fresh ${mode} provider-authority publisher overwrote unreadable state`);
    assert.strictEqual(refused.reason,
      mode === 'throw' ? 'authority-store-read-failed' : 'authority-store-invalid');
    assert.strictEqual(fresh.__authorityFaultState.authorityWriteAttempts, 0,
      `fresh ${mode} provider-authority publisher attempted a destructive rewrite`);
    assert.strictEqual(
      fresh.__authorityFaultState.backing.get(authoritativeKey),
      fresh.__authorityFaultState.faultRaw,
      `fresh ${mode} provider-authority publisher changed corrupt bytes`
    );
  }
}

const legacyStart = p1ConnectSource.indexOf('(function () {', legacyMarker);
const legacyEnd = p1ConnectSource.indexOf(';/* === Outcome Study', legacyStart);
assert(legacyMarker >= 0 && legacyStart > legacyMarker && legacyEnd > legacyStart,
  'embedded legacy Next Up block could not be isolated');
let legacyIntervals = 0;
const legacyContext = {
  window: null, console, Date, Promise,
  __MLS_P1_PREVIEW: { enabled: true },
  setInterval: () => { legacyIntervals++; return 1; }, clearInterval: () => {},
  setTimeout: () => 1, clearTimeout: () => {},
  document: { readyState: 'complete', getElementById: () => null, addEventListener() {} },
  sessionStorage: { getItem: () => null }
};
legacyContext.window = legacyContext;
vm.runInNewContext(p1ConnectSource.slice(legacyStart, legacyEnd), legacyContext,
  { filename: '1p-embedded-legacy-nextup.js', timeout: 1000 });
assert.strictEqual(legacyContext.__mlsP1LegacyNextUpRetired, true,
  '1p preview did not explicitly retire the embedded raw-calendar Next Up block');
assert.strictEqual(legacyIntervals, 0,
  'embedded raw-calendar Next Up installed its permanent repaint interval in 1p');
assert.strictEqual(legacyContext.__mlsNextUp, undefined,
  'embedded raw-calendar Next Up installed an API before the isolated fork');

heroRendered = null;
vm.runInNewContext(nextUpSource, context, {
  filename: '1p-feat_nextup_connect.js', timeout: 3000
});
assert.strictEqual(context.__mlsNextUp._buildToday().length, COUNT,
  'p1 Next Up did not project the exact census display slice');
assert(heroRendered && heroRendered.length === COUNT,
  'p1 Next Up renderer fell back to the stale append-only calendar');
assert(!heroRendered.some(row => /^backend-stale-/.test(row.id) || row.id === manual.id),
  'p1 Next Up rendered stale/manual rows outside the exact Athena census');
active[0].provider = 'STALE DOCTOR VALUE';
context._calAppts.find(row => row.id === active[0].id).provider = active[0].provider;
assert.strictEqual(context.__mlsNextUp._buildToday().find(row => row.id === active[0].id).provider, '',
  'p1 Next Up projected a stale backend provider through provider-unknown census authority');
storage.set(displayKey, '{corrupt-after-known-census');
assert.strictEqual(context.__mlsNextUp._buildToday().length, 0,
  'unreadable known census storage reopened Next Up raw-calendar fallback');
assert.strictEqual(api.appointmentCensusStatusForDay(DAY).storeUnavailable, true,
  'unreadable known census storage did not retain fail-closed day ownership');
storage.set(displayKey, goodBeforeCorrupt);

vm.runInNewContext(frontsyncSource, context, {
  filename: '1p-feat_task3_frontsync.js', timeout: 3000
});
assert(context.MLSCal && typeof context.MLSCal.normalize === 'function',
  'p1 Task3 calendar API did not boot');
context.MLSCal.normalize();
assert(context._calAppts.some(row => row.id === active[0].id) &&
  context._calAppts.some(row => row.id === active[1].id),
  'Task3 collapsed distinct census appointment IDs that share patient/day/time');
assert(!context._calAppts.some(row => /^backend-stale-/.test(row.id)),
  'p1 calendar retained stale/cancelled Athena rows outside the exact census IDs');
assert(context._calAppts.some(row => row.id === manual.id),
  'p1 calendar deleted a manual MLS row that the Athena census cannot adjudicate');
assert(context._calAppts.some(row => row.id === manualPlausiblePatientId.id),
  'p1 calendar treated a p_sched_ patient id as Athena appointment provenance');
assert.strictEqual(context._calAppts.filter(row => row.athena_appointment_id).length, COUNT,
  'p1 calendar did not retain every exact provider-unknown census row');
assert.strictEqual(context.MLSCal.providers(DAY).length, 0,
  'provider-unknown display census invented a provider grouping');
const censusVisibleRows = context.MLSCal.rows({ date: DAY });
assert(censusVisibleRows.every(row => !row.provider && !row.__t3pk),
  'provider-unknown Task3 projection exposed stale provider labels/tags');
assert(censusVisibleRows.some(row => row.id === manual.id) &&
  censusVisibleRows.some(row => row.id === manualPlausiblePatientId.id),
  'manual MLS rows were stored but hidden from the census-owned day display');
assert.strictEqual(censusVisibleRows.filter(row => row.athena_appointment_id).length, COUNT,
  'census-owned day display did not contain every exact Athena appointment ID');
context._calAppts[0].doctor_user_id = 'stale-doctor-id';
context._calAppts[0].provider_key = 'stale-provider-key';
context._calAppts[0].providerName = 'Stale Doctor Name';
context._calAppts[0].providerDisplayName = 'Stale Provider Display Name';
context._calAppts[0].provider_display_name = 'Stale provider_display_name';
context._calAppts[0].renderingProvider = 'Stale Rendering Provider';
context._calAppts[0].rendering_provider = 'Stale rendering_provider';
context._calAppts[0].renderingProviderName = 'Stale Rendering Provider Name';
context._calAppts[0].rendering_provider_name = 'Stale rendering_provider_name';
const stripped = context.MLSCal.rows({ date: DAY }).find(row => row.id === context._calAppts[0].id);
for (const key of [
  'provider', 'provider_id', 'athena_provider_id', 'doctor_user_id', 'provider_key', 'providerName',
  'providerDisplayName', 'provider_display_name', 'renderingProvider', 'rendering_provider',
  'renderingProviderName', 'rendering_provider_name'
]) {
  assert(!stripped[key], `provider-unknown Task3 projection leaked ${key}`);
}

const pendingRow = context._calAppts.find(row => row.id === active[2].id);
context._calAppts.splice(context._calAppts.indexOf(pendingRow), 1);
assert.strictEqual(context.MLSCal.rows({ date: DAY }).length, 0,
  'pending census hydration fell back to raw append-only Task3 rows');
context._calAppts.push(pendingRow);

const calParent = fakeNode('div');
const calView = fakeNode('section'); calView.style.display = '';
const splitWrap = fakeNode('div'); calParent.appendChild(splitWrap);
const roster = fakeNode('div'); roster.id = 'mlsT3Roster';
const refreshButton = fakeNode('button');
roster.querySelector = selector => selector === '.t3r-rf' ? refreshButton : null;
calParent.appendChild(roster);
const domById = { calendarView: calView, calSplitWrap: splitWrap, mlsT3Roster: roster };
context.document.getElementById = id => domById[String(id)] || null;
context._calMode = 'day'; context._calRefDate = DAY;
storage.set('p1-display-test::mlsProvScope3', 'stale-doctor|Stale Doctor');
context.__mlsT3._renderRoster();
assert(/26 Athena appointments?\s*(?:&middot;|·)\s*provider unavailable\s*(?:&middot;|·)\s*2 manual MLS entries/.test(roster.innerHTML),
  'census-owned day roster did not distinguish 26 Athena appointments from 2 manual MLS entries');
assert(!/t3r-chip|All providers|>Providers</.test(roster.innerHTML),
  'census-owned day rendered provider chips or a practice-scope caption');
assert.strictEqual(storage.get('p1-display-test::mlsProvScope3'), '',
  'census-owned day did not clear its inapplicable stored provider scope');

/* A stronger all-provider proof may supersede the census only after its own
   durable write succeeds. If that write is rejected, the last exact census
   must remain byte-for-byte active so a reload cannot reopen stale rows. */
const censusBeforeFailedProviderWrite = storage.get(displayKey);
rejectAuthoritativeWrite = true;
const failedProviderWrite = api._publishAuthoritativeSnapshot({
  date: DAY,
  provider: 'all',
  scheduleReceipt: { complete: true, authoritativeEmpty: false },
  returnedAppointments: active,
  providerReceipt: { complete: true, reason: 'all-providers' },
  calendarReceipt: { complete: true, attempted: COUNT },
  resolvedAppointments: mappings
});
rejectAuthoritativeWrite = false;
assert.strictEqual(failedProviderWrite.published, false,
  'rejected provider-authority persistence was reported as published');
assert.strictEqual(failedProviderWrite.reason, 'snapshot-persist-failed');
assert.strictEqual(storage.get(displayKey), censusBeforeFailedProviderWrite,
  'failed provider-authority write destroyed the prior exact census');
assert.strictEqual(api.appointmentCensusRowsForDay(DAY).length, COUNT,
  'failed provider-authority write deactivated the prior exact census');

/* A selected-provider snapshot proves only that selected slice. It must live
   beside the whole-day appointment census, remain invisible to all/implicit
   scope, and be selected only by the matching provider request. */
const selectedProvider = 'Scoped Clinician';
const selectedRows = active.slice(0, 2);
const selectedMappings = mappings.slice(0, 2);
const selectedPublished = api._publishAuthoritativeSnapshot({
  date: DAY,
  provider: selectedProvider,
  scheduleReceipt: { complete: true, authoritativeEmpty: false },
  returnedAppointments: selectedRows,
  providerReceipt: { complete: true, reason: 'selected-provider' },
  calendarReceipt: { complete: true, attempted: selectedRows.length },
  resolvedAppointments: selectedMappings
});
assert.strictEqual(selectedPublished.published, true,
  'selected-provider authoritative snapshot did not publish');
assert(JSON.parse(storage.get(displayKey)).days[DAY],
  'selected-provider snapshot incorrectly superseded the whole-day census');
assert.strictEqual(api.appointmentCensusRowsForDay(DAY).length, COUNT,
  'selected-provider snapshot deactivated the whole-day census');
assert.strictEqual(api.authoritativeStatusForDay(DAY, 'all').exact, false,
  'selected-provider snapshot masqueraded as all-provider authority');
assert.strictEqual(api.authoritativeStatusForDay(DAY).exact, false,
  'selected-provider snapshot became the implicit/all display authority');
assert.strictEqual(api.authoritativeStatusForDay(DAY, 'Different Clinician').exact, false,
  'selected-provider snapshot matched a different provider scope');
assert.strictEqual(api.authoritativeStatusForDay(DAY, selectedProvider).exact, true,
  'matching selected-provider scope did not use its exact snapshot');
assert.deepStrictEqual(
  Array.from(api.authoritativeRowsForDay(DAY, selectedProvider), row => row.id),
  selectedRows.map(row => row.id),
  'matching selected-provider scope returned the wrong exact slice'
);
storage.set('p1-display-test::mlsProvScope3', `clinician scoped|${selectedProvider}`);
assert.strictEqual(context.__mlsNextUp._buildToday().length, selectedRows.length,
  'matching visible provider scope did not use its selected exact snapshot in Next Up');
for (const selected of selectedRows) {
  const rawSelected = context._calAppts.find(row => row.id === selected.id);
  assert(rawSelected, `selected authoritative row ${selected.id} was already retired`);
  rawSelected.provider = selectedProvider;
}
/* Normalization is a storage-wide operation. A selected 2-row view may drive
   what is rendered, but it must not use that subset to retire or deduplicate
   the other 24 IDs owned by the coexisting whole-day census. */
context.MLSCal.normalize();
const selectedTask3Ids = context.MLSCal.rows({ date: DAY })
  .filter(row => row.athena_appointment_id)
  .map(row => row.id);
assert.strictEqual(selectedTask3Ids.length, selectedRows.length,
  'Task3 did not render the matching selected-provider exact slice');
assert(selectedRows.every(row => selectedTask3Ids.includes(row.id)),
  'Task3 selected-provider display returned the wrong exact IDs');
storage.set('p1-display-test::mlsProvScope3', '');
context.MLSCal.normalize();
const censusIdsAfterSelectedNormalize = context.MLSCal.rows({ date: DAY })
  .filter(row => row.athena_appointment_id)
  .map(row => row.id);
assert.strictEqual(censusIdsAfterSelectedNormalize.length, COUNT,
  'clearing selected scope did not restore all 26 coexisting census IDs');
assert(active.every(row => censusIdsAfterSelectedNormalize.includes(row.id)),
  'selected-scope normalization permanently retired or deduplicated census IDs');
assert(active.every(row => context._calAppts.some(raw => raw.id === row.id)),
  'selected-scope normalization mutated the canonical calendar down to its subset');
assert.strictEqual(context.__mlsNextUp._buildToday().length, COUNT,
  'selected-provider snapshot replaced the whole-day census in all-scope Next Up');

const providerPublished = api._publishAuthoritativeSnapshot({
  date: DAY,
  provider: 'all',
  scheduleReceipt: { complete: true, authoritativeEmpty: false },
  returnedAppointments: active,
  providerReceipt: { complete: true, reason: 'all-providers' },
  calendarReceipt: { complete: true, attempted: COUNT },
  resolvedAppointments: mappings
});
assert.strictEqual(providerPublished.published, true,
  'stronger provider-authoritative snapshot did not publish');
assert.strictEqual(providerPublished.appointmentCensusDisplayClear.complete, true);
assert.strictEqual(providerPublished.appointmentCensusDisplayClear.cleared, true,
  'stronger provider-authoritative snapshot did not clear same-day census display authority');
assert(!JSON.parse(storage.get(displayKey)).days[DAY],
  'same-day census display snapshot survived stronger provider authority');
assert.strictEqual(api.appointmentCensusStatusForDay(DAY).available, false,
  'cleared census display authority resurrected after provider-authoritative publication');

/* A selected UI filter does not require a separately published selected
   snapshot. When an exact all-provider day exists, Task3 must use that full
   ID set as the membership boundary and only then filter its rows by the
   visible provider. A same-provider Athena row outside that boundary is
   stale, even though its provider label happens to match. */
const ALL_ONLY_DAY = '2026-08-18';
const allOnlyExact = [
  { id: 'all-only-scoped-1', athena_appointment_id: 'athena-all-only-1', name: 'All exact one', appt_date: ALL_ONLY_DAY, start_at: `${ALL_ONLY_DAY}T08:00:00.000Z`, provider: selectedProvider },
  { id: 'all-only-other-1', athena_appointment_id: 'athena-all-only-2', name: 'All exact two', appt_date: ALL_ONLY_DAY, start_at: `${ALL_ONLY_DAY}T08:20:00.000Z`, provider: 'Different Clinician' },
  { id: 'all-only-scoped-2', athena_appointment_id: 'athena-all-only-3', name: 'All exact three', appt_date: ALL_ONLY_DAY, start_at: `${ALL_ONLY_DAY}T08:40:00.000Z`, provider: selectedProvider }
];
const allOnlyStale = {
  id: 'all-only-stale-same-provider', athena_appointment_id: 'athena-all-only-stale',
  name: 'Stale same-provider row', appt_date: ALL_ONLY_DAY,
  start_at: `${ALL_ONLY_DAY}T09:00:00.000Z`, provider: selectedProvider
};
context._calAppts.push(...allOnlyExact.map(row => Object.assign({}, row)), Object.assign({}, allOnlyStale));
const allOnlyMappings = allOnlyExact.map((row, index) => ({
  sourceIdentity: `all-only-source-${index + 1}`,
  backendAppointmentId: row.id
}));
const allOnlyPublished = api._publishAuthoritativeSnapshot({
  date: ALL_ONLY_DAY,
  provider: 'all',
  scheduleReceipt: { complete: true, authoritativeEmpty: false },
  returnedAppointments: allOnlyExact,
  providerReceipt: { complete: true, reason: 'all-providers' },
  calendarReceipt: { complete: true, attempted: allOnlyExact.length },
  resolvedAppointments: allOnlyMappings
});
assert.strictEqual(allOnlyPublished.published, true,
  'fresh all-provider-only day did not publish');
assert.strictEqual(api.appointmentCensusStatusForDay(ALL_ONLY_DAY).reason, 'no-snapshot',
  'fresh all-provider-only day unexpectedly had census authority');
assert.strictEqual(api.authoritativeStatusForDay(ALL_ONLY_DAY, selectedProvider).exact, true,
  'selected scope did not derive membership from the all-provider-only snapshot');
assert.strictEqual(api.authoritativeStatusForDay(ALL_ONLY_DAY, 'all').exact, true,
  'fresh all-provider-only day did not retain exact all-provider membership');
const allOnlyEntry = JSON.parse(storage.get(authoritativeKey)).days[ALL_ONLY_DAY];
assert(allOnlyEntry && allOnlyEntry.all && Object.keys(allOnlyEntry.providers || {}).length === 0,
  'fresh authority fixture was not all-provider-only');

storage.set('p1-display-test::mlsProvScope3', `clinician scoped|${selectedProvider}`);
context.MLSCal.normalize();
const allOnlySelectedIds = Array.from(context.MLSCal.rows({ date: ALL_ONLY_DAY }))
  .filter(row => row.athena_appointment_id)
  .map(row => row.id);
assert.deepStrictEqual(allOnlySelectedIds.sort(), ['all-only-scoped-1', 'all-only-scoped-2'],
  'selected scope did not derive exact membership from the all-provider snapshot');
assert(!allOnlySelectedIds.includes(allOnlyStale.id),
  'selected scope displayed a stale same-provider Athena row outside all-provider authority');

storage.set('p1-display-test::mlsProvScope3', '');
context.MLSCal.normalize();
const allOnlyClearedIds = Array.from(context.MLSCal.rows({ date: ALL_ONLY_DAY }))
  .filter(row => row.athena_appointment_id)
  .map(row => row.id);
assert.deepStrictEqual(allOnlyClearedIds.sort(), allOnlyExact.map(row => row.id).sort(),
  'clearing selected scope did not restore the complete all-provider exact day');
assert(!allOnlyClearedIds.includes(allOnlyStale.id),
  'all-provider exact display resurrected a stale same-provider Athena row');

/* =========================================================================
 * p1-authority-quarantine-1.0.0 proof (owner report 2026-08-16)
 *
 * sanitizeAuthoritativeStore() used to be whole-store all-or-nothing: one
 * malformed day anywhere in the up-to-45-day blob returned null from the
 * WHOLE function, so loadAuthoritativeStore() failed closed for every date
 * in the blob (not just the bad one), publishAuthoritativeSnapshot() refused
 * every date with "authority-store-invalid", and because
 * writeAuthoritativeStore() also sanitizes before writing, the bad bytes
 * could never be overwritten -- a single poisoned day permanently wedged
 * every future pull for the entire account.
 *
 * The fix quarantines the malformed day by itself: it is dropped from the
 * returned store and named in report.dropped/loaded.quarantined, while every
 * other day in the same blob stays usable, and the next successful publish
 * to ANY other date rewrites the blob without the bad day (self-heal).
 *
 * The existing 'corrupt'/'nested-corrupt'/'throw' loop above (~line 458)
 * already proves the malformed-day and alien-blob cases in isolation, each
 * with nothing else in the store. It does NOT prove the coexistence case:
 * a blob holding a malformed day ALONGSIDE genuinely clean days on other
 * dates, which is exactly the shape of the bug report (a 45-day rolling
 * blob where only one day goes bad). That coexistence is what this section
 * proves, using bytes written by the real publisher for the good days
 * rather than hand-authored JSON.
 *
 * It ALSO reuses that same loop's 'corrupt' mode (days is a string -- an
 * alien blob shape) to confirm the whole-blob structural guard is untouched
 * by this fix; see the note below instead of duplicating those assertions.
 * ========================================================================= */

const QDAY_GOOD_1 = '2026-09-01';
const QDAY_GOOD_2 = '2026-09-02';
const QDAY_BAD = '2026-09-03';
const QDAY_HEAL = '2026-09-04';
const quarantineAuthoritativeKey = 'p1-quarantine-proof-test::' + AUTHORITATIVE_SUFFIX;
const quarantineBacking = new Map();
let quarantineWriteAttempts = 0;

const qGoodRow1 = { id: 'quarantine-good-1-appt', athena_appointment_id: 'athena-quarantine-good-1', name: 'Quarantine Good One', appt_date: QDAY_GOOD_1, start_at: `${QDAY_GOOD_1}T09:00:00.000Z`, provider: '' };
const qGoodRow2 = { id: 'quarantine-good-2-appt', athena_appointment_id: 'athena-quarantine-good-2', name: 'Quarantine Good Two', appt_date: QDAY_GOOD_2, start_at: `${QDAY_GOOD_2}T09:00:00.000Z`, provider: '' };
const qHealRow = { id: 'quarantine-heal-appt', athena_appointment_id: 'athena-quarantine-heal', name: 'Quarantine Heal', appt_date: QDAY_HEAL, start_at: `${QDAY_HEAL}T09:00:00.000Z`, provider: '' };

function bootQuarantineImporter(backing) {
  const freshBody = fakeNode('body');
  const freshHead = fakeNode('head');
  const freshDocumentElement = fakeNode('html');
  const fresh = Object.assign({}, freshContextTemplate, {
    uns: suffix => `p1-quarantine-proof-test::${suffix}`,
    _calAppts: [qGoodRow1, qGoodRow2, qHealRow].map(row => Object.assign({}, row)),
    sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    localStorage: {
      getItem(key) {
        key = String(key);
        return backing.has(key) ? backing.get(key) : null;
      },
      setItem(key, value) {
        key = String(key);
        if (key === quarantineAuthoritativeKey) quarantineWriteAttempts++;
        backing.set(key, String(value));
      },
      removeItem(key) { backing.delete(String(key)); }
    },
    document: {
      readyState: 'complete', body: freshBody, head: freshHead,
      documentElement: freshDocumentElement,
      createElement: fakeNode,
      getElementById: () => null,
      querySelector: () => null, querySelectorAll: () => [],
      addEventListener() {}, removeEventListener() {}
    },
    _renderTodayPatients(rows) { fresh._heroTodayList = (rows || []).map(row => Object.assign({}, row)); }
  });
  fresh.window = fresh;
  vm.runInNewContext(importerSource, fresh, {
    filename: '1p-feat_mls_schedimport_exact.quarantine-proof.js', timeout: 3000
  });
  return fresh;
}

/* Publish the two "good" days through the REAL publisher so their stored
   bytes are guaranteed to satisfy cleanSnapshot/cleanDay -- no hand-written
   JSON to debug against the sanitizer's exact field/shape rules. */
const quarantineWriterCtx = bootQuarantineImporter(quarantineBacking);
const publishedGood1 = quarantineWriterCtx.__mlsSI._publishAuthoritativeSnapshot({
  date: QDAY_GOOD_1, provider: 'all',
  scheduleReceipt: { complete: true, authoritativeEmpty: false },
  returnedAppointments: [qGoodRow1],
  providerReceipt: { complete: true, reason: 'all-providers' },
  calendarReceipt: { complete: true, attempted: 1 },
  resolvedAppointments: [{ sourceIdentity: 'quarantine-good-1-source', backendAppointmentId: qGoodRow1.id }]
});
assert.strictEqual(publishedGood1.published, true,
  'setup: could not publish the first genuinely clean quarantine-proof day through the real API');
const publishedGood2 = quarantineWriterCtx.__mlsSI._publishAuthoritativeSnapshot({
  date: QDAY_GOOD_2, provider: 'all',
  scheduleReceipt: { complete: true, authoritativeEmpty: false },
  returnedAppointments: [qGoodRow2],
  providerReceipt: { complete: true, reason: 'all-providers' },
  calendarReceipt: { complete: true, attempted: 1 },
  resolvedAppointments: [{ sourceIdentity: 'quarantine-good-2-source', backendAppointmentId: qGoodRow2.id }]
});
assert.strictEqual(publishedGood2.published, true,
  'setup: could not publish the second genuinely clean quarantine-proof day through the real API');

/* Hand-inject exactly ONE malformed day into those real bytes, using the
   same malformed shape as the file's existing nested-corrupt fixture
   (backendIds is a string, not an array). This models the actual bug
   report: bit-rot/a bad write touches one day inside an otherwise-healthy
   rolling blob. Writing straight into the backing Map (not through
   localStorage.setItem) is deliberate -- it bypasses the sanitizer, exactly
   like the file's own pre-existing 'nested-corrupt' fixture does. */
const wedgeParsed = JSON.parse(quarantineBacking.get(quarantineAuthoritativeKey));
assert.deepStrictEqual(Object.keys(wedgeParsed.days).sort(), [QDAY_GOOD_1, QDAY_GOOD_2].sort(),
  'setup: quarantine-proof store did not contain exactly the two published clean days before injecting the bad one');
wedgeParsed.days[QDAY_BAD] = {
  all: { v: 1, date: QDAY_BAD, mode: 'all', providerKey: '', backendIds: 'malformed-not-an-array', sourceCount: 1, updated: Date.now() },
  providers: {}, active: { mode: 'all', key: '' }
};
quarantineBacking.set(quarantineAuthoritativeKey, JSON.stringify(wedgeParsed));

/* Reload: boot a completely fresh importer VM against the wedged bytes,
   exactly as a real browser tab reload would read them off disk. This
   mirrors bootFreshImporterWithAuthorityRead's own "a hard reload has no
   process-local hint" reasoning above. */
quarantineWriteAttempts = 0;
const quarantineReaderCtx = bootQuarantineImporter(quarantineBacking);

/* --- 1. THE GOOD DAYS SURVIVE ------------------------------------------
   Before the fix, sanitizeAuthoritativeStore() returned null for the WHOLE
   blob the instant it hit QDAY_BAD, so loadAuthoritativeStore() failed
   closed for QDAY_GOOD_1/QDAY_GOOD_2 too, even though neither was ever
   malformed. That is the permanent wedge -- this is the assertion that
   proves it is gone. */
const good1Status = quarantineReaderCtx.__mlsSI.authoritativeStatusForDay(QDAY_GOOD_1, 'all');
assert(!good1Status.storeUnavailable,
  'OLD BUG: a malformed day elsewhere in the blob fail-closed a genuinely clean day (good day 1) too');
assert.strictEqual(good1Status.available, true,
  'OLD BUG: whole-store nulling reported a clean day unavailable solely because another day in the same blob was malformed');
assert.strictEqual(good1Status.exact, true,
  'quarantine-proof good day 1 did not come back exact once hydrated');
const good1Rows = quarantineReaderCtx.__mlsSI.authoritativeRowsForDay(QDAY_GOOD_1, 'all');
assert(good1Rows && good1Rows.length === 1 && good1Rows[0].id === qGoodRow1.id,
  'quarantine-proof good day 1 did not return its exact row once the malformed day was quarantined');

const good2Status = quarantineReaderCtx.__mlsSI.authoritativeStatusForDay(QDAY_GOOD_2, 'all');
assert(!good2Status.storeUnavailable,
  'OLD BUG: a malformed day elsewhere in the blob fail-closed a genuinely clean day (good day 2) too');
assert.strictEqual(good2Status.available, true,
  'OLD BUG: whole-store nulling reported a second clean day unavailable solely because another day in the same blob was malformed');

/* --- 2. THE BAD DAY STILL FAILS CLOSED, WITH THE SAME REASON -----------
   In isolation these particular checks also held under the old whole-store
   behaviour (every day, including the bad one, read as
   "authority-store-invalid"), so they alone do not distinguish old from
   new. What they confirm is that quarantining the bad day did not loosen
   ITS OWN fail-closed guarantee while fixing the good days above --
   reverting the fix fails at assertion #1 first, before ever reaching this
   block, in the same run. */
const badStatus = quarantineReaderCtx.__mlsSI.authoritativeStatusForDay(QDAY_BAD, 'all');
assert.strictEqual(badStatus.storeUnavailable, true,
  'quarantined bad day stopped owning itself fail-closed');
assert.strictEqual(badStatus.scope, 'authority-unavailable',
  'quarantined bad day no longer reports the fail-closed authority-unavailable scope');
assert.strictEqual(badStatus.reason, 'authority-store-invalid',
  'quarantined bad day changed its fail-closed reason string');
assert.strictEqual(quarantineReaderCtx.__mlsSI.authoritativeRowsForDay(QDAY_BAD, 'all'), null,
  'quarantined bad day returned an unverified row slice instead of null');

/* --- 3. PUBLISHING TO THE BAD DAY IS STILL REFUSED, AND WRITES NOTHING -
   Same caveat as #2: in isolation this also held under the old behaviour.
   It proves the quarantine mechanism did not turn into "publish over
   whatever is there" for the one date it cannot verify. */
const bytesBeforeBadPublish = quarantineBacking.get(quarantineAuthoritativeKey);
quarantineWriteAttempts = 0;
const badPublish = quarantineReaderCtx.__mlsSI._publishAuthoritativeSnapshot({
  date: QDAY_BAD, provider: 'all',
  scheduleReceipt: { complete: true, authoritativeEmpty: false },
  returnedAppointments: [{ id: 'quarantine-bad-replacement', appt_date: QDAY_BAD, start_at: `${QDAY_BAD}T09:00:00.000Z`, provider: '' }],
  providerReceipt: { complete: true, reason: 'all-providers' },
  calendarReceipt: { complete: true, attempted: 1 },
  resolvedAppointments: [{ sourceIdentity: 'quarantine-bad-replacement-source', backendAppointmentId: 'quarantine-bad-replacement' }]
});
assert.strictEqual(badPublish.published, false,
  'publishing to the quarantined bad day was reported as published');
assert.strictEqual(badPublish.reason, 'authority-store-invalid',
  'publishing to the quarantined bad day returned the wrong refusal reason');
assert.strictEqual(quarantineWriteAttempts, 0,
  'publishing to the quarantined bad day attempted a destructive write');
assert.strictEqual(quarantineBacking.get(quarantineAuthoritativeKey), bytesBeforeBadPublish,
  'publishing to the quarantined bad day changed the stored bytes');

/* --- 4. SELF-HEAL -- the assertion that most distinguishes new from old.
   Under the old whole-store behaviour, loadAuthoritativeStore() failed for
   EVERY date once QDAY_BAD existed anywhere in the blob, so
   publishAuthoritativeSnapshot(QDAY_HEAL) -- a totally different, clean
   date -- would ALSO have been refused with "authority-store-invalid".
   That is the permanent wedge described in the bug report: no date could
   ever be published again until the whole key was manually cleared. Under
   the fix, publishing to any other date succeeds, and because the write
   path always re-serializes the already-sanitized (bad-day-dropped) store,
   that single write heals the blob. */
const healPublish = quarantineReaderCtx.__mlsSI._publishAuthoritativeSnapshot({
  date: QDAY_HEAL, provider: 'all',
  scheduleReceipt: { complete: true, authoritativeEmpty: false },
  returnedAppointments: [qHealRow],
  providerReceipt: { complete: true, reason: 'all-providers' },
  calendarReceipt: { complete: true, attempted: 1 },
  resolvedAppointments: [{ sourceIdentity: 'quarantine-heal-source', backendAppointmentId: qHealRow.id }]
});
assert.strictEqual(healPublish.published, true,
  'OLD BUG: publishing to a clean, unrelated date was refused just because a DIFFERENT day in the blob was malformed -- the permanent wedge');

const healedParsed = JSON.parse(quarantineBacking.get(quarantineAuthoritativeKey));
assert(!Object.prototype.hasOwnProperty.call(healedParsed.days, QDAY_BAD),
  'OLD BUG: the malformed day survived a successful write to a different date -- the store never heals, the wedge is permanent');
assert(Object.prototype.hasOwnProperty.call(healedParsed.days, QDAY_GOOD_1),
  'self-heal write lost the first genuinely clean day');
assert(Object.prototype.hasOwnProperty.call(healedParsed.days, QDAY_GOOD_2),
  'self-heal write lost the second genuinely clean day');
assert(Object.prototype.hasOwnProperty.call(healedParsed.days, QDAY_HEAL),
  'self-heal write did not persist the newly published day');

const badStatusAfterHeal = quarantineReaderCtx.__mlsSI.authoritativeStatusForDay(QDAY_BAD, 'all');
assert(!badStatusAfterHeal.storeUnavailable,
  'the healed store still reports the retired bad day as store-unavailable instead of simply absent');
assert.strictEqual(badStatusAfterHeal.reason, 'no-snapshot',
  'the healed store did not treat the retired bad day as an ordinary unowned day');

/* Alien whole-blob shapes (days is a string, not an object -- 'corrupt'
   mode) are proven by the loop at ~line 458: READS still refuse outright
   (available/exact false, storeUnavailable true, scope
   'authority-unavailable', reason 'authority-store-invalid'), and the
   structural guard itself is unchanged (v !== 1 / days not an object /
   extra top-level keys / > 90 days still return null).
   p1-authority-repair-1.0.0 (2026-08-17) changed exactly one thing there:
   the PUBLISH path now runs a bounded repair first, because without it that
   state was permanent - there is no removeItem for this key and
   writeAuthoritativeStore sanitises before writing, so an alien blob wedged
   every future pull on every date forever. Salvage keeps every day that
   validates on its own; the reset fires only when no day can be attributed
   to anything. See the mode === 'corrupt' branch above. */

console.log('PASS p1 authority-quarantine: one malformed day is dropped on its own, clean days on other dates stay exact, and the next publish to any other date self-heals the blob');

console.log('PASS p1 appointment-census display authority: exact IDs survive reload, stale Athena rows stay retired, manual rows remain, provider/practice authority stays false');
