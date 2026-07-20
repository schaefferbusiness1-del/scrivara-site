'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const connect = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');

function sliceFunction(name, nextName) {
  const start = connect.indexOf(`function ${name}(`);
  const end = connect.indexOf(`\n  function ${nextName}(`, start);
  assert(start >= 0 && end > start, `could not bound ${name}`);
  return connect.slice(start, end);
}

const idSource = sliceFunction('scheduledAppointmentId', 'installScheduledVisitBinding');
const bindSource = sliceFunction('installScheduledVisitBinding', 'lockAndStart');
const lockSource = sliceFunction('lockAndStart', 'lockAndStartPatient');

assert(lockSource.includes('var exactBindingReady = installScheduledVisitBinding(a) && exactScheduledBindingMatches(a);'), 'scheduled visit activation does not install and read back the exact binding');
assert(lockSource.indexOf('installScheduledVisitBinding(a)') < lockSource.indexOf('if (opts.record'), 'recording can begin before exact scheduled binding is attempted');
assert(lockSource.includes('if (!exactBindingReady) { render(); return; }'), 'record/generate can run after exact scheduled binding failure');
assert(idSource.includes('a.appointmentId || a.appointment_id || a.apptId || a.appt_id || a.athena_appointment_id'), 'binding does not recognize the explicit Athena appointment-id fields');
assert(!/a\.id\s*\|\|/.test(idSource), 'calendar/source id can still masquerade as Athena appointment id');

function harness(overrides) {
  overrides = overrides || {};
  const calls = { freeze: [], set: [] };
  const patient = overrides.patient === undefined
    ? { id: 'local-p-1', name: 'Exact Patient', dob: '03/04/1980', mrn: '550012' }
    : overrides.patient;
  const current = overrides.xdcContext || null;
  const context = {
    Date,
    isNaN,
    apptDay(a) { return String(a.appt_date || a.day_local || '').slice(0, 10); },
    nameMatch(a, b) { return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase(); },
    window: {
      activePatient() { return patient; },
      __mlsCrossDayContext: { current() { return current; } },
      _athenaFreezeVisitBinding(p, meta) {
        calls.freeze.push({ p, meta });
        return { id: 'binding-1', patient: p, visitContext: meta.visitContext };
      },
      _athenaSetVisitBinding(binding, replaceExisting) {
        calls.set.push({ binding, replaceExisting });
        return overrides.setResult === undefined ? true : overrides.setResult;
      }
    }
  };
  vm.createContext(context);
  vm.runInContext(`${idSource}\n${bindSource}\nthis.install = installScheduledVisitBinding;`, context);
  return { install: context.install, calls };
}

const row = {
  id: 'calendar-row-77', appointment_id: '1272764709',
  name: 'Exact Patient', dob: '03/04/1980', appt_date: '2026-07-22',
  provider: 'Exact Provider, MD'
};

{
  const h = harness();
  assert.strictEqual(h.install(row), true, 'complete exact scheduled row did not bind');
  assert.strictEqual(h.calls.freeze.length, 1);
  const meta = h.calls.freeze[0].meta;
  assert.strictEqual(meta.source, 'scheduled-appointment');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(meta.visitContext)), {
    historical: false,
    visitDate: '2026-07-22',
    provider: 'Exact Provider, MD',
    appointmentId: '1272764709',
    encounterId: '',
    encounterUrl: ''
  });
  assert.deepStrictEqual(h.calls.set.map(x => x.replaceExisting), [true]);
}

/* b438: date and provider are what pin a note to the right day and clinician,
 * so their absence still fails closed. An Athena appointment id is a
 * DESTINATION identifier - its absence must NOT block binding, because the only
 * producer is the extension's schedule scrape and a pulled row routinely
 * arrives without one. Blocking on it stopped the doctor recording or
 * generating on such rows, on every date. */
for (const bad of [
  { ...row, provider: '' },
  { ...row, appt_date: '', day_local: '' }
]) {
  const h = harness();
  assert.strictEqual(h.install(bad), false, 'incomplete exact row was bound');
  assert.strictEqual(h.calls.set.length, 0, 'incomplete exact row mutated the binding');
}

/* A row with no Athena appointment id binds, and the binding records the empty
 * id VERBATIM. That empty string is load-bearing downstream: it is what keeps
 * write_note / save_draft blocked and exact-encounter verification unavailable.
 * A placeholder, sentinel, or the backend row id substituted here would
 * silently convert those from blocked to ready. */
{
  const h = harness();
  assert.strictEqual(h.install({ ...row, appointment_id: '' }), true,
    'a pulled row without an Athena appointment id refused to bind');
  assert.strictEqual(h.calls.set.length, 1, 'id-less exact row did not install exactly one binding');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(h.calls.freeze[0].meta.visitContext)), {
    historical: false,
    visitDate: '2026-07-22',
    provider: 'Exact Provider, MD',
    appointmentId: '',
    encounterId: '',
    encounterUrl: ''
  }, 'id-less binding must carry appointmentId "" verbatim, never a substitute');
}

{
  const h = harness({ patient: { id: 'local-p-2', name: 'Different Patient', dob: '03/04/1980', mrn: '550012' } });
  assert.strictEqual(h.install(row), false, 'wrong active patient was bound to the scheduled appointment');
  assert.strictEqual(h.calls.set.length, 0);
}

{
  const h = harness({ patient: { id: 'local-p-1', name: 'Exact Patient', dob: '05/06/1981', mrn: '550012' } });
  assert.strictEqual(h.install(row), false, 'DOB-conflicting patient was bound to the scheduled appointment');
  assert.strictEqual(h.calls.set.length, 0);
}

{
  const h = harness({ xdcContext: { sourceId: row.id, appointmentId: row.appointment_id, date: row.appt_date } });
  assert.strictEqual(h.install(row), true, 'existing stronger selected-day binding was not preserved');
  assert.strictEqual(h.calls.freeze.length, 0, 'delayed Easy activation overwrote XDC binding');
  assert.strictEqual(h.calls.set.length, 0, 'delayed Easy activation mutated XDC binding');
}

console.log('PASS scheduled Visit binding: one exact Athena appointment/date/provider context is installed before actions; missing/conflicting rows fail closed and XDC is preserved');
