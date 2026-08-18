'use strict';

/* awb-1.0.0 (1p fork only): when the day's schedule-import ledger cannot
 * resolve an Athena appointment id (no successful schedule pull — measured
 * live 2026-08-18: 17 booked rows, 14 ledgered, 3 forever unbindable, every
 * write blocked with "run the day pull" while the pull itself was the broken
 * leg), the exact-visit context may fall back to the backend calendar row's
 * OWN athena_appointment_id — the real Athena-namespace id captured at
 * booking by the staff sync.
 *
 * What must hold (each case asserts a specific value, never just truthiness):
 *   1. The ledger stays the PREFERRED source: when both exist, the ledger id
 *      wins.
 *   2. No ledger + a digits-only athena_appointment_id on this patient's
 *      single row for the day => the manifest binds that id and write-note
 *      goes READY (identity complete).
 *   3. A non-digit athena_appointment_id is refused (b438: ids are never
 *      guessed or synthesized) and the row blocks naming the appointment id.
 *   4. TWO rows for the patient on the day fail closed (empty id).
 *   5. The fallback needs an exact patient-id match: a row matched by NAME
 *      only never booking-binds (exact-name-equality is not identity).
 *   6. wf2-1.9.0 regression: the backend row id itself still never leaks
 *      into the appointment-id field.
 *   7. wf2-1.8.0 extension: a nearer MLS-only row must not outrank a farther
 *      row that carries a booking id.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');

assert(src.includes('function athenaAppointmentIdFromBookingRow'), 'awb-1.0.0 booking-row resolver must exist in the 1p fork');
assert(!/appointmentId:\s*suppliedAppointment\s*\|\|[^,]*\|\|\s*S\(hit\.id/.test(src), 'the backend row id must never be the appointment-id fallback');

function makeContext(indexRows, calAppts) {
  const store = new Map();
  if (indexRows) store.set('acct:schedImportIndexV1::2026-08-18', JSON.stringify({ v: 1, rows: indexRows }));
  const localStorage = {
    getItem: k => store.has(k) ? store.get(k) : null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const elementStub = () => ({
    style: {}, dataset: {}, setAttribute: () => {}, getAttribute: () => null, removeAttribute: () => {},
    addEventListener: () => {}, removeEventListener: () => {}, appendChild: () => {}, remove: () => {},
    querySelector: () => null, querySelectorAll: () => [], classList: { add: () => {}, remove: () => {}, contains: () => false },
    textContent: '', innerHTML: ''
  });
  const document = {
    readyState: 'complete',
    addEventListener: () => {}, removeEventListener: () => {},
    querySelector: () => null, querySelectorAll: () => [],
    getElementById: () => null,
    createElement: elementStub,
    body: elementStub(), head: elementStub(), documentElement: elementStub()
  };
  const window = {
    _calAppts: calAppts,
    uns: n => `acct:${n}`,
    addEventListener: () => {}, removeEventListener: () => {},
    document, localStorage,
    location: { origin: 'https://mlsscribe.com' },
    postMessage: () => {}
  };
  window.window = window;
  return vm.createContext({
    window, document, localStorage,
    setInterval: () => 1, clearInterval: () => {},
    setTimeout: () => 1, clearTimeout: () => {},
    MutationObserver: function () { return { observe: () => {}, disconnect: () => {} }; },
    console
  });
}

const DAY = '2026-08-18';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-awb-pid', patientId: 'syn-awb-pid', name: 'Synthetic Patient Awb', dob: '01/02/1980', mrn: '100001' };
const BOOKED_ROW = {
  id: 'cal-row-77', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, appt_date: DAY, day_local: DAY,
  start_at: DAY + 'T14:00:00.000Z', status: 'booked', athena_appointment_id: '88880001'
};
const NOTE_OPTS = { patient: PATIENT, sections: [{ key: 'note', text: 'Reviewed test note body.' }] };

function manifestFor(indexRows, calAppts, extraOpts) {
  const ctx = makeContext(indexRows, calAppts);
  vm.runInContext(src, ctx, { filename: '1p-feat_mls_writeflow.js' });
  const wf = ctx.window.__mlsWriteFlow;
  assert(wf && wf.installed, '1p writeflow failed to install in the VM');
  return wf.buildUnifiedManifest(Object.assign({}, NOTE_OPTS, extraOpts || {}));
}

// 1. The ledger is still the preferred source when both exist.
{
  const manifest = manifestFor({
    'appointment-id:70000018': { state: 'done', patientId: PATIENT.patientId, backendAppointmentId: BOOKED_ROW.id, appt_date: DAY }
  }, [BOOKED_ROW]);
  assert.strictEqual(manifest.visit.appointmentId, '70000018', 'the import ledger must outrank the booking-row id');
}

// 2. No ledger: the booking id binds via the explicit-context path and the
//    write-note row goes READY.
{
  const manifest = manifestFor(null, [BOOKED_ROW], { expectedContext: { visitDate: DAY, provider: PROVIDER } });
  assert.strictEqual(manifest.visit.appointmentId, '88880001', 'the booking-row athena_appointment_id must bind when the ledger cannot resolve');
  assert.strictEqual(manifest.visit.visitDate, '8/18/2026');
  const note = manifest.rows.find(r => r.id === 'write-note');
  assert(note && note.capability === 'ready', 'write-note must be READY with full identity + booking-bound visit, got: ' + String(note && note.capability) + ' / ' + String(note && note.reason));
}

// 2b. Same, via the nearest-row path (no explicit context supplied).
{
  const manifest = manifestFor(null, [BOOKED_ROW]);
  assert.strictEqual(manifest.visit.appointmentId, '88880001', 'the nearest-row path must also accept the booking id');
  assert.strictEqual(manifest.visit.provider, PROVIDER);
}

// 3. A non-digit id is never bound (b438: ids are never guessed/synthesized).
{
  const row = Object.assign({}, BOOKED_ROW, { athena_appointment_id: 'cal-row-77' });
  const manifest = manifestFor(null, [row], { expectedContext: { visitDate: DAY, provider: PROVIDER } });
  assert.strictEqual(manifest.visit.appointmentId, '', 'a non-digit athena_appointment_id must be refused');
  const note = manifest.rows.find(r => r.id === 'write-note');
  assert(note && note.capability !== 'ready', 'a live write with no bindable id must not paint READY');
  assert(/appointment ID/i.test(String(note && note.reason || '')), 'the block reason must still name the appointment id');
}

// 4. Two rows for this patient on the day: the explicit-context path fails
//    closed (no arbitrary pick between two booking ids).
{
  const second = Object.assign({}, BOOKED_ROW, { id: 'cal-row-78', athena_appointment_id: '88880002', start_at: DAY + 'T16:00:00.000Z' });
  const manifest = manifestFor(null, [BOOKED_ROW, second], { expectedContext: { visitDate: DAY, provider: PROVIDER } });
  assert.strictEqual(manifest.visit.appointmentId, '', 'two same-day rows must not booking-bind via the explicit-context path');
}

// 5. A row matched by NAME only (patient supplies no patient id) never
//    booking-binds — exact-name equality is not identity.
{
  const foreignRow = Object.assign({}, BOOKED_ROW, { patient_external_id: 'someone-else' });
  const namedOnly = { name: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn };
  const ctx = makeContext(null, [foreignRow]);
  vm.runInContext(src, ctx, { filename: '1p-feat_mls_writeflow.js' });
  const manifest = ctx.window.__mlsWriteFlow.buildUnifiedManifest({ patient: namedOnly, sections: NOTE_OPTS.sections });
  assert.strictEqual(manifest.visit.appointmentId, '', 'a name-matched row must never supply a booking id without an exact patient-id match');
}

// 6. wf2-1.9.0 regression on the fork: a row with NO athena_appointment_id
//    still yields an empty id — the backend row id never leaks.
{
  const bare = Object.assign({}, BOOKED_ROW); delete bare.athena_appointment_id;
  const manifest = manifestFor(null, [bare], { expectedContext: { visitDate: DAY, provider: PROVIDER } });
  assert.strictEqual(manifest.visit.appointmentId, '', 'without ledger and booking id the appointment id must stay empty');
  assert.notStrictEqual(manifest.visit.appointmentId, bare.id, 'the backend row id must never appear as the appointment id');
}

// 7. wf2-1.8.0 extension: a nearer MLS-only row must not outrank a farther
//    row carrying a booking id.
{
  const mlsOnlyNearer = {
    id: 'cal-row-90', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
    provider: PROVIDER, appt_date: '2026-08-19', day_local: '2026-08-19',
    start_at: '2026-08-19T06:00:00.000Z', status: 'booked'
  };
  const ctx = makeContext(null, [mlsOnlyNearer, BOOKED_ROW]);
  vm.runInContext(src, ctx, { filename: '1p-feat_mls_writeflow.js' });
  const manifest = ctx.window.__mlsWriteFlow.buildUnifiedManifest({
    patient: PATIENT, sections: NOTE_OPTS.sections,
    noteTimestamp: new Date('2026-08-19T05:00:00.000Z').getTime()
  });
  assert.strictEqual(manifest.visit.appointmentId, '88880001', 'the booking-resolvable row must outrank a nearer MLS-only row');
  assert.strictEqual(manifest.visit.visitDate, '8/18/2026', 'the visit date must come from the booking-resolvable row');
}

console.log('PASS 1p writeflow booking-row fallback: ledger preferred, digits-only booking id binds one exact-patient row per day, name-only and backend-id paths still refuse, MLS-only rows never outrank a bindable row');
