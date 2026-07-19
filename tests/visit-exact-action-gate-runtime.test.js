'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const start = source.indexOf('  function scheduledAppointmentId(');
const end = source.indexOf('\n  function lockAndStartPatient(', start);
assert(start >= 0 && end > start, 'could not bound canonical scheduled-action gate');
const runtime = source.slice(start, end);

assert(runtime.includes('installScheduledVisitBinding(a) && exactScheduledBindingMatches(a)'), 'activation does not require a read-back match after installing the exact binding');
assert(runtime.includes('if (!exactBindingReady) { render(); return; }'), 'record/generate can continue after exact binding failure');
assert(source.includes("on('ez3Rec2', function () { if (!requireExactScheduledBinding(S.appt, 'recording')) return;"), 'resume recording bypasses exact scheduled binding');
assert(source.includes("if (!requireExactScheduledBinding(S.appt, 'note generation')) return;"), 'visible note generation bypasses exact scheduled binding');
assert(source.includes("on('ez3Regen', function () { if (!requireExactScheduledBinding(S.appt, 'note regeneration')) return;"), 'regeneration bypasses exact scheduled binding');
assert(source.includes("if (!S.appt || !requireExactScheduledBinding(S.appt, 'note generation')) return false;"), 'remote generation bypasses exact scheduled binding');

function makeHarness(options) {
  options = options || {};
  let active = options.active === undefined ? { id: 'PT-1', name: 'Exact Patient', dob: '03/04/1980' } : options.active;
  const calls = { record: 0, generate: 0, freeze: 0, set: 0, render: 0, select: 0 };
  const context = {
    console, Date, isNaN,
    currentVisitAthenaBinding: null,
    S: { appt: null, locked: null, editing: false, genClickedAt: 0, signedAt: 0, lastWarn: '', mode: 'doctor', screen: 'home', phase: 'idle' },
    safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
    apptDay(a) { return String(a && (a.appt_date || a.day_local) || '').slice(0, 10); },
    normTokens(value) { return String(value || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean).sort(); },
    nameMatch(a, b) {
      const A = String(a || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const B = String(b || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return !!A && A === B;
    },
    rowKey(a) { return String(a && a.id || ''); },
    lockPatient: null,
    isRecording() { return false; }, blockSwitchWhileRecording() {},
    isFn(fn) { return typeof fn === 'function'; },
    setEasyMode(mode, screen) { context.S.mode = mode; context.S.screen = screen; context.render(); },
    activeName() { return active && active.name || ''; },
    render() { calls.render += 1; }, toast() {},
    setTimeout(fn) { fn(); return 1; },
    captureBtn() { return { click() { calls.record += 1; } }; },
    genBtnResolve() { return { click() { calls.generate += 1; } }; },
    window: {
      activePatient() { return active; },
      calStartVisit() { calls.select += 1; },
      __mlsCrossDayContext: { current() { return options.xdcContext || null; } },
      _athenaFreezeVisitBinding(patient, meta) {
        calls.freeze += 1;
        if (options.freezeFails) return null;
        return {
          id: 'binding-' + calls.freeze,
          patient: { patientId: String(patient.id), name: patient.name, dob: patient.dob },
          visitContext: meta.visitContext
        };
      },
      _athenaSetVisitBinding(binding) {
        calls.set += 1;
        if (options.setFails) return false;
        context.currentVisitAthenaBinding = binding;
        return true;
      }
    }
  };
  context.lockPatient = function (a) { context.S.locked = { id: a.id, name: a.name, dob: a.dob, key: String(a.id) }; };
  context.window.window = context.window;
  context.window.currentVisitAthenaBinding = null;
  vm.createContext(context);
  vm.runInContext(`${runtime}\nthis.run=lockAndStart;this.matches=exactScheduledBindingMatches;`, context, { filename: 'visit-exact-action-gate.js' });
  return { context, calls, run: context.run, setActive(next) { active = next; } };
}

function row(day) {
  return {
    id: 'ROW-' + day, appointment_id: day === '2026-07-19' ? 'APT-TODAY' : 'APT-FUTURE',
    name: 'Exact Patient', dob: '03/04/1980', appt_date: day, provider: 'Exact Provider, MD'
  };
}

for (const day of ['2026-07-19', '2026-07-22']) {
  {
    const h = makeHarness({ active: null });
    h.run(row(day), { record: true, generate: true });
    assert.strictEqual(h.calls.record, 0, `${day}: missing active patient started recording`);
    assert.strictEqual(h.calls.generate, 0, `${day}: missing active patient started generation`);
    assert.strictEqual(h.calls.freeze, 0, `${day}: missing active patient created a visit binding`);
  }
  {
    const h = makeHarness({ setFails: true });
    h.run(row(day), { record: true, generate: true });
    assert.strictEqual(h.calls.record, 0, `${day}: failed binding write started recording`);
    assert.strictEqual(h.calls.generate, 0, `${day}: failed binding write started generation`);
    assert.strictEqual(h.calls.set, 1, `${day}: exact binding was not attempted once`);
  }
  {
    const h = makeHarness();
    h.run(row(day), { record: true, generate: true });
    assert.strictEqual(h.calls.record, 1, `${day}: proven exact binding did not allow recording`);
    assert.strictEqual(h.calls.generate, 1, `${day}: proven exact binding did not allow generation`);
    assert.strictEqual(h.context.matches(row(day)), true, `${day}: installed exact binding failed read-back verification`);
  }
}

console.log('PASS exact scheduled action gate: Today and non-Today block record/generate until patient, appointment, date, provider, and binding read-back all match');
