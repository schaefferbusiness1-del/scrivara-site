'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');
const storage = new Map();
const patients = [];
let fetchMode = 'calendar-read-failed';

function response(ok, status, body) {
  return { ok, status, json: async () => body };
}

const context = {
  console, Promise, Date, Math, JSON, Intl, Object, Array, String, Number, RegExp,
  encodeURIComponent, isFinite,
  /* inerttimer-1.0.0 (2026-08-28): setTimeout was `() => 1` - a stub that
     returns a handle and NEVER invokes its callback. Every engine path that
     makes progress through a timer (a deadline, a retry, a deferred
     continuation) therefore could not complete, and the three async
     importAppts cases below have never run: the file entered its IIFE, awaited
     the first importAppts, and the process exited 0 with the PASS line never
     printed. tests/run-all.js judges on exit code alone, so it counted green.
     Real timers now, clamped so a long engine deadline cannot make this suite
     slow. Callbacks are queued for real, which is the whole point - an inert
     timer is indistinguishable from a hang. */
  setTimeout: (fn, ms) => setTimeout(fn, Math.min(Number(ms) || 0, 25)),
  clearTimeout: (h) => clearTimeout(h),
  setInterval: (fn, ms) => setInterval(fn, Math.max(Math.min(Number(ms) || 0, 25), 5)),
  clearInterval: (h) => clearInterval(h),
  location: { pathname: '/ScribeFlow-staging.html', origin: 'https://mlsscribe.com' },
  localStorage: {
    getItem: key => storage.has(key) ? storage.get(key) : null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: key => storage.delete(key)
  },
  document: {
    readyState: 'complete', querySelectorAll: () => [], querySelector: () => null,
    getElementById: () => null, addEventListener: () => {},
    body: {}, head: { appendChild: () => {} }, documentElement: { appendChild: () => {} }
  },
  backendMode: () => true,
  bkToken: () => 'synthetic-token',
  bkBase: () => 'https://backend.invalid',
  uns: suffix => `calendar-diagnostic::${suffix}`,
  _normDate: value => String(value || '').slice(0, 10),
  _normTime: value => {
    const m = String(value || '').match(/(\d{1,2}):(\d{2})\s*([AP]M)?/i);
    if (!m) return '';
    let hour = Number(m[1]);
    if (m[3] && /PM/i.test(m[3]) && hour < 12) hour += 12;
    if (m[3] && /AM/i.test(m[3]) && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${m[2]}`;
  },
  _acctWallToUtcIso: (date, time) => `${date}T${time}:00.000Z`,
  getPatients: () => patients,
  upsertPatient(patient) {
    const i = patients.findIndex(one => one.id === patient.id);
    if (i >= 0) patients[i] = patient; else patients.push(patient);
  },
  loadCalendar: () => Promise.resolve(),
  _calAppts: [],
  addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {},
  fetch: (_url, init) => {
    if (!init || !init.method) {
      if (fetchMode === 'calendar-read-failed') return Promise.resolve(response(false, 503, {}));
      return Promise.resolve(response(true, 200, { appointments: [] }));
    }
    if (fetchMode === 'create-http') return Promise.resolve(response(false, 503, {}));
    throw new Error('synthetic synchronous dispatch failure');
  }
};
context.window = context;

vm.runInNewContext(source, context, { filename: 'feat_mls_schedimport_exact.js', timeout: 1000 });
const api = context.__mlsSI;
assert(api && typeof api._classifyCalendarFailure === 'function', 'calendar failure classifier is not exposed');

function partial(overrides) {
  return Object.assign({
    complete: false, attempted: 1, accounted: 0, failed: 1,
    wrongDay: 0, invalidDate: 0, accountingComplete: false,
    mappingComplete: false, unresolvedMappings: 1, snapshotPublished: false
  }, overrides || {});
}

assert.strictEqual(api._classifyCalendarFailure({ failureReasons: { 'appointment-create-http': 1 } }, partial()), 'save-failed');
assert.strictEqual(api._classifyCalendarFailure({ failureReasons: { 'patient-not-resolved': 1 } }, partial()), 'identity-unverified');
assert.strictEqual(api._classifyCalendarFailure({ failureReasons: { 'import-in-flight': 1 } }, partial()), 'concurrent-import');
assert.strictEqual(api._classifyCalendarFailure({ failureReasons: {} }, partial({ failed: 0, accounted: 1, accountingComplete: true })), 'mapping-unverified');
assert.strictEqual(api._classifyCalendarFailure({ failureReasons: {} }, partial({ failed: 0, accounted: 1, accountingComplete: true, mappingComplete: true, unresolvedMappings: 0 })), 'snapshot-unverified');
assert.strictEqual(api._classifyCalendarFailure({ failureReasons: {} }, partial({ wrongDay: 1 })), 'date-unverified');
assert.deepStrictEqual(
  JSON.parse(JSON.stringify(api._phiFreeReasonCounts({
    'appointment-create-http': 2,
    'Patient Jane Doe': 1,
    'janedoe': 1,
    'MRN-123': 1,
  }))),
  { 'appointment-create-http': 2, 'calendar-row-unverified': 3 },
  'diagnostic histogram allowed a patient-shaped free-form key through the fixed allowlist'
);

(async () => {
  const readFailure = await api.importAppts([
    { appointmentId: 'diag-read-1', name: 'Synthetic Read', dob: '01/02/1980', date: '2026-07-20', time: '9:00 AM', provider: 'Doctor Synthetic' }
  ], { date: '2026-07-20', scopeDate: '2026-07-20' });
  assert.strictEqual(readFailure.failed, 1);
  assert.strictEqual(readFailure.failureReasons['calendar-read-unverified'], 1, 'calendar GET failure lost its fixed reason count');

  fetchMode = 'create-http';
  const createHttp = await api.importAppts([
    { appointmentId: 'diag-create-1', name: 'Synthetic Create', dob: '02/03/1981', date: '2026-07-21', time: '10:00 AM', provider: 'Doctor Synthetic' }
  ], { date: '2026-07-21', scopeDate: '2026-07-21' });
  assert.strictEqual(createHttp.failed, 1);
  assert.strictEqual(createHttp.failureReasons['appointment-create-http'], 1, 'backend create HTTP failure was not classified');

  fetchMode = 'create-dispatch';
  const dispatchFailure = await api.importAppts([
    { appointmentId: 'diag-dispatch-1', name: 'Synthetic Dispatch', dob: '03/04/1982', date: '2026-07-22', time: '11:00 AM', provider: 'Doctor Synthetic' }
  ], { date: '2026-07-22', scopeDate: '2026-07-22' });
  assert.strictEqual(dispatchFailure.failed, 1, 'synchronous create dispatch failure disappeared from accounting');
  assert.strictEqual(dispatchFailure.failureReasons['appointment-create-dispatch-failed'], 1);
  assert.strictEqual(dispatchFailure.unresolvedMappings[0].reason, 'appointment-create-dispatch-failed');

  console.log('PASS calendar-partial diagnostics distinguish read/save/identity/mapping/snapshot/date gates without PHI');
})().catch(error => { console.error(error); process.exit(1); });
