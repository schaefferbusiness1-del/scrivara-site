'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const scheduleSource = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const nextUpSource = fs.readFileSync(path.join(root, 'feat_nextup_connect.js'), 'utf8');
assert(scheduleSource.includes('window.__mlsNextUp.version === "nextup-2.0.1"'),
  'schedule import does not recognize the current authoritative Next Up module');
assert(scheduleSource.includes('feat_nextup_connect.js?v=20260808auth3perf1'),
  'schedule import did not mint a fresh immutable Next Up asset URL');
assert(!scheduleSource.includes('feat_nextup_connect.js?v=20260714auth1'),
  'schedule import still references the retired Next Up asset URL');
const store = new Map();
const patients = [];
let backendRows = [];
let createSequence = 0;
const creates = [];
const updates = [];
let rendered = null;
let failAuthoritativeWrite = false;

function normTime(value) {
  const s = String(value || '').trim();
  const m = s.match(/(?:T)?(\d{1,2}):(\d{2})(?:\s*([AP]M))?/i);
  if (!m) return '';
  let hour = Number(m[1]);
  if (m[3] && /PM/i.test(m[3]) && hour < 12) hour += 12;
  if (m[3] && /AM/i.test(m[3]) && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${m[2]}`;
}

const context = {
  console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
  encodeURIComponent, queueMicrotask,
  setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
  location: { pathname: '/ScribeFlow-staging.html' },
  sessionStorage: { getItem: key => key === '__mlsNextUpDebugDate' ? '2026-07-14' : null },
  localStorage: {
    getItem: key => store.has(key) ? store.get(key) : null,
    setItem: (key, value) => {
      if (failAuthoritativeWrite && String(key).includes('schedAuthoritativeDaysV1')) throw new Error('synthetic quota');
      store.set(key, String(value));
    },
    removeItem: key => store.delete(key)
  },
  document: {
    readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
    getElementById: () => null, addEventListener: () => {}, body: {}, head: {}, documentElement: {}
  },
  backendMode: () => true,
  bkToken: () => 'test-token',
  bkBase: () => 'https://local.invalid',
  uns: key => `authoritative-test::${key}`,
  _normDate: value => String(value || '').slice(0, 10),
  _normTime: normTime,
  _acctWallToUtcIso: (date, time) => `${date}T${time}:00.000Z`,
  _apptHHMMTz: value => normTime(value),
  _calLabelOf: row => row && row.name || '',
  getPatients: () => patients,
  upsertPatient: patient => {
    const i = patients.findIndex(p => p.id === patient.id);
    if (i >= 0) patients[i] = patient; else patients.push(patient);
  },
  loadCalendar: () => {
    context._calAppts = backendRows.map(row => Object.assign({}, row));
    return Promise.resolve();
  },
  renderHistory: () => {}, renderProfile: () => {}, loadPatients: () => {},
  _calLoadNextUp: () => {},
  _renderTodayPatients: rows => { rendered = rows.map(row => Object.assign({}, row)); context._heroTodayList = rendered; },
  _calAppts: [],
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {},
  fetch: async (url, init) => {
    if (!init || !init.method) return { ok: true, status: 200, json: async () => ({ appointments: backendRows.map(row => Object.assign({}, row)) }) };
    const body = JSON.parse(init.body || '{}');
    const update = String(url).match(/\/api\/appointments\/([^/]+)\/update$/);
    if (update) {
      const id = decodeURIComponent(update[1]);
      const row = backendRows.find(one => String(one.id) === id);
      if (row) Object.assign(row, body);
      updates.push({ id, body });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    const id = `created-${++createSequence}`;
    backendRows.push(Object.assign({ id }, body));
    creates.push({ id, body });
    return { ok: true, status: 200, json: async () => ({ ok: true, id }) };
  }
};
context.window = context;

vm.runInNewContext(scheduleSource, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
const api = context.__mlsSI;
assert(api && typeof api.authoritativeRowsForDay === 'function');

(async () => {
  const ledgerRow = {
    appointmentId: 'athena-ledger-1', name: 'Ledger Patient', date: '2026-07-18', time: '9:00 AM',
    provider: 'Doctor Exact', providerId: 'provider-exact'
  };
  backendRows = []; creates.length = 0;
  const first = await api.importAppts([Object.assign({}, ledgerRow)], { date: '2026-07-18', scopeDate: '2026-07-18' });
  assert.strictEqual(first.created, 1);
  assert.strictEqual(first.resolvedAppointments.length, 1);
  const deletedBackendId = first.resolvedAppointments[0].backendAppointmentId;

  backendRows = []; // simulate a backend deletion after the browser ledger said "done"
  const second = await api.importAppts([Object.assign({}, ledgerRow)], { date: '2026-07-18', scopeDate: '2026-07-18' });
  assert.strictEqual(second.created, 1, 'a missing ledger backend row was falsely skipped');
  assert.strictEqual(second.skipped, 0);
  assert.strictEqual(second.failed, 0);
  assert.notStrictEqual(second.resolvedAppointments[0].backendAppointmentId, deletedBackendId);
  assert.strictEqual(creates.length, 2, 'the stale done ledger was not safely reclaimed exactly once');

  backendRows = [{
    id: 'repeat-existing', athena_appointment_id: 'athena-repeat-1', name: 'Repeat Patient', dob: '',
    patient_external_id: '', appt_date: '2026-07-19', start_at: '2026-07-19T10:20:00.000Z',
    provider: '', reason: ''
  }];
  updates.length = 0;
  const repeatRow = {
    appointmentId: 'athena-repeat-1', name: 'Repeat Patient', dob: '01/02/1980', mrn: 'MRN-REPEAT',
    date: '2026-07-19', time: '10:20 AM', provider: 'Doctor Exact', providerId: 'provider-exact', reason: 'Enriched reason'
  };
  const enriched = await api.importAppts([Object.assign({}, repeatRow)], { date: '2026-07-19', scopeDate: '2026-07-19' });
  assert.strictEqual(enriched.repaired, 1);
  assert.strictEqual(enriched.resolvedAppointments[0].backendAppointmentId, 'repeat-existing');
  assert.strictEqual(backendRows[0].reason, 'Enriched reason');
  const idempotent = await api.importAppts([Object.assign({}, repeatRow)], { date: '2026-07-19', scopeDate: '2026-07-19' });
  assert.strictEqual(idempotent.created, 0);
  assert.strictEqual(idempotent.repaired, 0);
  assert.strictEqual(idempotent.skipped, 1);
  assert.strictEqual(idempotent.resolvedAppointments[0].backendAppointmentId, 'repeat-existing');
  assert.strictEqual(updates.length, 1, 'an idempotent repeat rewrote already-enriched fields');

  const sourcePatient = { id: 'source-patient-exact', name: 'Source Metadata Patient', dob: '03/04/1975', mrn: 'MRN-SOURCE-1', athenaId: 'MRN-SOURCE-1' };
  patients.push(sourcePatient);
  backendRows = [{
    id: 'source-metadata-existing', athena_appointment_id: 'athena-source-appt-1', athena_provider_id: 'athena-source-provider-1',
    name: sourcePatient.name, dob: sourcePatient.dob, patient_external_id: sourcePatient.id,
    appt_date: '2026-07-23', start_at: '2026-07-23T10:40:00.000Z',
    provider: 'Doctor Exact', reason: 'Exact repeat'
  }];
  updates.length = 0;
  const sourceMetadataRow = {
    appointmentId: 'athena-source-appt-1', providerId: 'athena-source-provider-1',
    name: sourcePatient.name, dob: sourcePatient.dob, mrn: sourcePatient.mrn,
    date: '2026-07-23', time: '10:40 AM', provider: 'Doctor Exact', reason: 'Exact repeat'
  };
  const sourceRepeatOne = await api.importAppts([Object.assign({}, sourceMetadataRow)], { date: '2026-07-23', scopeDate: '2026-07-23' });
  const sourceRepeatTwo = await api.importAppts([Object.assign({}, sourceMetadataRow)], { date: '2026-07-23', scopeDate: '2026-07-23' });
  assert.strictEqual(sourceRepeatOne.skipped, 1);
  assert.strictEqual(sourceRepeatTwo.skipped, 1);
  assert.strictEqual(sourceRepeatOne.failed + sourceRepeatTwo.failed, 0);
  assert.strictEqual(updates.length, 0, 'a backend row that echoed Athena source ids triggered an avoidable repeat-pull update');

  const day = '2026-07-14';
  const active = Array.from({ length: 18 }, (_, i) => ({
    id: `athena-active-${i + 1}`, name: `Verified ${i + 1}`, dob: '01/01/1980',
    appt_date: day, start_at: `${day}T${String(8 + Math.floor(i / 4)).padStart(2, '0')}:${String((i % 4) * 15).padStart(2, '0')}:00.000Z`, provider: 'Doctor Exact'
  }));
  const stale = [
    { id: 'legacy-athena-1', name: 'Old Athena One', appt_date: day, start_at: `${day}T15:00:00.000Z` },
    { id: 'legacy-athena-2', name: 'Old Athena Two', appt_date: day, start_at: `${day}T15:20:00.000Z` }
  ];
  const manual = { id: 'manual-keep-1', name: 'Manual MLS Row', appt_date: day, start_at: `${day}T16:00:00.000Z`, source: 'manual' };
  context._calAppts = active.concat(stale, manual);
  const mappings18 = active.map((row, i) => ({ sourceIdentity: `source-${i + 1}`, backendAppointmentId: row.id }));
  const published18 = api._publishAuthoritativeSnapshot({
    date: day, scheduleReceipt: { complete: true, authoritativeEmpty: false },
    providerReceipt: { complete: true, reason: 'all-providers' },
    calendarReceipt: { complete: true, attempted: 18 }, resolvedAppointments: mappings18
  });
  assert.strictEqual(published18.published, true);
  assert.strictEqual(api.authoritativeRowsForDay(day).length, 18, 'stale raw 21 rows replaced the exact 18-source snapshot');
  assert.strictEqual(api.authoritativeStatusForDay(day).unclassifiedCount, 3);
  assert.strictEqual(context._calAppts.length, 21, 'legacy/manual calendar rows were deleted');
  assert(context._calAppts.some(row => row.id === manual.id), 'manual calendar row was not preserved');

  const duplicateMapping = api._publishAuthoritativeSnapshot({
    date: day, scheduleReceipt: { complete: true }, providerReceipt: { complete: true, reason: 'all-providers' }, calendarReceipt: { complete: true, attempted: 2 },
    resolvedAppointments: [
      { sourceIdentity: 'dup-source-1', backendAppointmentId: 'athena-active-1' },
      { sourceIdentity: 'dup-source-2', backendAppointmentId: 'athena-active-1' }
    ]
  });
  assert.strictEqual(duplicateMapping.published, false, 'non-1:1 mapping replaced the last verified snapshot');
  assert.strictEqual(api.authoritativeRowsForDay(day).length, 18);

  const added = { id: 'athena-active-19', name: 'Verified 19', dob: '02/02/1980', appt_date: day, start_at: `${day}T16:20:00.000Z`, provider: 'Doctor Exact' };
  context._calAppts.push(added);
  active[0].reason = 'Repeat-pull enrichment';
  context._calAppts.find(row => row.id === active[0].id).reason = active[0].reason;
  const mappings19 = mappings18.concat({ sourceIdentity: 'source-19', backendAppointmentId: added.id });
  const published19 = api._publishAuthoritativeSnapshot({
    date: day, scheduleReceipt: { complete: true }, providerReceipt: { complete: true, reason: 'all-providers' }, calendarReceipt: { complete: true, attempted: 19 }, resolvedAppointments: mappings19
  });
  assert.strictEqual(published19.published, true);
  const exact19 = api.authoritativeRowsForDay(day);
  assert.strictEqual(exact19.length, 19, 'repeat pull did not add the newly verified row');
  assert.strictEqual(exact19.find(row => row.id === active[0].id).reason, 'Repeat-pull enrichment');
  assert.strictEqual(api.authoritativeStatusForDay(day).unclassifiedCount, 3);

  const emptyDay = '2026-07-20';
  const emptyManual = { id: 'manual-empty-day', name: 'Manual Empty Day', appt_date: emptyDay, start_at: `${emptyDay}T12:00:00.000Z` };
  context._calAppts.push(emptyManual);
  const unverifiedEmpty = api._publishAuthoritativeSnapshot({
    date: day, scheduleReceipt: { complete: true, authoritativeEmpty: false },
    calendarReceipt: { complete: true, attempted: 0 }, resolvedAppointments: []
  });
  assert.strictEqual(unverifiedEmpty.published, false);
  assert.strictEqual(api.authoritativeRowsForDay(day).length, 19, 'unverified empty cleared a prior exact snapshot');
  const verifiedEmpty = api._publishAuthoritativeSnapshot({
    date: emptyDay, scheduleReceipt: {
      complete: true, authoritativeEmpty: true,
      expectedCount: 0, candidateCount: 0, parsedCount: 0,
      declaredCount: 0, domValidRows: 0, textValidRows: 0, mergedRows: 0
    }, returnedAppointments: [],
    calendarReceipt: { complete: true, attempted: 0 }, resolvedAppointments: []
  });
  assert.strictEqual(verifiedEmpty.published, true);
  assert.deepStrictEqual(Array.from(api.authoritativeRowsForDay(emptyDay)), []);
  assert.strictEqual(api.authoritativeStatusForDay(emptyDay).unclassifiedCount, 1);
  assert(context._calAppts.some(row => row.id === emptyManual.id), 'authoritative empty deleted a manual row');

  const providerDay = '2026-07-21';
  const providerRows = [
    { id: 'provider-a-1', name: 'Provider A One', appt_date: providerDay, provider: 'Doctor Alpha' },
    { id: 'provider-a-2', name: 'Provider A Two', appt_date: providerDay, provider: 'Doctor Alpha' },
    { id: 'provider-b-1', name: 'Provider B One', appt_date: providerDay, provider: 'Doctor Beta' }
  ];
  context._calAppts.push(...providerRows);
  const selectedProvider = { id: 'provider-a', name: 'Doctor Alpha', rosterVerified: true };
  const providerPublished = api._publishAuthoritativeSnapshot({
    date: providerDay, provider: selectedProvider, scheduleReceipt: { complete: true },
    providerReceipt: { complete: true, reason: 'provider-complete' }, calendarReceipt: { complete: true, attempted: 2 },
    resolvedAppointments: [
      { sourceIdentity: 'provider-source-1', backendAppointmentId: 'provider-a-1' },
      { sourceIdentity: 'provider-source-2', backendAppointmentId: 'provider-a-2' }
    ]
  });
  assert.strictEqual(providerPublished.published, true);
  assert.strictEqual(api.authoritativeRowsForDay(providerDay).length, 2);
  assert.strictEqual(api.authoritativeStatusForDay(providerDay).unclassifiedCount, 1);

  const storageFailureDay = '2026-07-22';
  context._calAppts.push({ id: 'storage-stable-backend-1', name: 'Synthetic Stable Snapshot', appt_date: storageFailureDay });
  const storageStable = api._publishAuthoritativeSnapshot({
    date: storageFailureDay, scheduleReceipt: { complete: true },
    providerReceipt: { complete: true, reason: 'all-providers' },
    calendarReceipt: { complete: true, attempted: 1 },
    resolvedAppointments: [{ sourceIdentity: 'storage-stable-source-1', backendAppointmentId: 'storage-stable-backend-1' }]
  });
  assert.strictEqual(storageStable.published, true);
  context._calAppts.push({ id: 'storage-replacement-backend-1', name: 'Synthetic Failed Replacement', appt_date: storageFailureDay });
  failAuthoritativeWrite = true;
  const storageFailed = api._publishAuthoritativeSnapshot({
    date: storageFailureDay, scheduleReceipt: { complete: true },
    providerReceipt: { complete: true, reason: 'all-providers' },
    calendarReceipt: { complete: true, attempted: 1 },
    resolvedAppointments: [{ sourceIdentity: 'storage-replacement-source-1', backendAppointmentId: 'storage-replacement-backend-1' }]
  });
  failAuthoritativeWrite = false;
  assert.strictEqual(storageFailed.published, false, 'snapshot storage failure was reported as published');
  assert.strictEqual(storageFailed.reason, 'snapshot-persist-failed');
  const preservedAfterFailure = api.authoritativeRowsForDay(storageFailureDay);
  assert.strictEqual(preservedAfterFailure.length, 1, 'failed replacement destroyed the last published same-day snapshot');
  assert.strictEqual(preservedAfterFailure[0].id, 'storage-stable-backend-1', 'failed replacement leaked through the in-memory cache');

  rendered = null;
  context._renderTodayPatients.__wnRender = true;
  context._renderTodayPatients.__mlsUnrGuard = true;
  vm.runInNewContext(nextUpSource, context, { filename: 'feat_nextup_connect.js', timeout: 1000 });
  assert(context.__mlsNextUp && context.__mlsNextUp.version === 'nextup-2.0.1');
  assert.strictEqual(context._renderTodayPatients.__wnRender, true, 'Who\'s Next ownership marker was dropped and would cause wrapper churn');
  assert.strictEqual(context.__mlsNextUp._buildToday().length, 19);
  assert(rendered && rendered.length === 19, 'top schedule renderer did not consume the exact snapshot');
  assert(!rendered.some(row => row.id === 'manual-keep-1' || /^legacy-athena-/.test(row.id)), 'legacy/manual rows leaked into Choose/Next-Up/Agenda');
  context._renderTodayPatients(context._calAppts.filter(row => row.appt_date === day));
  assert.strictEqual(rendered.length, 19, 'a later raw calendar render overwrote the exact snapshot');
  assert.strictEqual(context._heroTodayList.length, 19, 'agenda source was not reconciled to the exact snapshot');

  console.log('PASS authoritative day/provider reconciliation, stale-ledger recovery, repeat enrichment, manual preservation, empty-day safety, and top UI consumption');
})().catch(error => { console.error(error); process.exit(1); });
