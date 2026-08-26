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

function identityDobKey(value) {
  let m = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return m[1] + m[2] + m[3];
  m = String(value || '').match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  return m ? m[3] + String(m[1]).padStart(2, '0') + String(m[2]).padStart(2, '0') : '';
}
function identityMrnKey(value) {
  const v = value && (value.mrn || value.athenaId || value.athenaPatientId || value.patient_mrn) || '';
  return String(v).toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function positiveEvidence(a, p, patients, nameMatch) {
  function agrees(candidate) {
    if (!a || !candidate || !candidate.id || !nameMatch(a.name, candidate.name)) return false;
    const ad = identityDobKey(a.dob), pd = identityDobKey(candidate.dob);
    const am = identityMrnKey(a), pm = identityMrnKey(candidate);
    if ((ad && pd && ad !== pd) || (am && pm && am !== pm)) return false;
    return !!((ad && pd && ad === pd) || (am && pm && am === pm));
  }
  const hits = (patients || []).filter(agrees);
  return agrees(p) && hits.length === 1 && String(hits[0].id) === String(p.id);
}

assert(runtime.includes('installScheduledVisitBinding(a) && exactScheduledBindingMatches(a)'), 'activation does not require a read-back match after installing the exact binding');
/* Owner 2026-07-26: record/generate under an unproven binding demote through
 * requireExactScheduledBinding (unscheduled + visible warning; only a proven
 * cross-patient conflict blocks). A plain open still warns and stops. */
assert(runtime.includes('if (!opts.record && !opts.generate) { render(); return true; }'), 'a plain open must still warn and stop on unproven binding');
assert(runtime.includes("requireExactScheduledBinding(a, opts.record ? 'recording' : 'note generation', opts)"), 'record/generate on unproven binding must route through the demotion gate');
assert(source.includes("on('ez3Rec2', function () { if (!requireExactScheduledBinding(S.appt, 'recording')) return;"), 'resume recording bypasses exact scheduled binding');
assert(source.includes("if (!requireExactScheduledBinding(S.appt, 'note generation')) return;"), 'visible note generation bypasses exact scheduled binding');
assert(source.includes("on('ez3Regen', function () { if (!requireExactScheduledBinding(S.appt, 'note regeneration')) return;"), 'regeneration bypasses exact scheduled binding');
assert(source.includes("if (!S.appt || !requireExactScheduledBinding(S.appt, 'note generation', { quiet: true })) return false;"), 'remote generation bypasses exact scheduled binding or duplicates the phone warning');

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
    dobConflicts(a, b) {
      const A = identityDobKey(a), B = identityDobKey(b); return !!(A && B && A !== B);
    },
    mrnKey: identityMrnKey,
    mrnConflicts(a, b) { const A = identityMrnKey(a), B = identityMrnKey(b); return !!(A && B && A !== B); },
    positiveIdentityEvidence(a, p) {
      return positiveEvidence(a, p, active ? [active] : [], context.nameMatch);
    },
    canonicalActivePatient() { return active; },
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
      getPatients() { return active ? [active] : []; },
      calStartVisit() {
        calls.select += 1;
        if (Object.prototype.hasOwnProperty.call(options, 'calReceipt')) return options.calReceipt;
        return { ok: true, bound: true, patientId: String(active && active.id || ''), reason: 'exact-patient' };
      },
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
    const h = makeHarness({ calReceipt: null });
    h.run(row(day), { record: true, generate: true });
    assert.strictEqual(h.calls.record, 0, `${day}: missing structured start receipt reused the prior encounter for recording`);
    assert.strictEqual(h.calls.generate, 0, `${day}: missing structured start receipt reused the prior encounter for generation`);
    assert(/could not start a fresh visit/i.test(h.context.S.lastWarn), `${day}: missing structured start receipt gave no truthful warning`);
  }
  {
    const h = makeHarness({ active: null });
    h.run(row(day), { record: true, generate: true });
    assert.strictEqual(h.calls.record, 0, `${day}: missing active patient started recording`);
    assert.strictEqual(h.calls.generate, 0, `${day}: missing active patient started generation`);
    assert.strictEqual(h.calls.freeze, 0, `${day}: missing active patient created a visit binding`);
  }
  {
    /* Owner 2026-07-26: a failed binding WRITE is an unproven schedule, not a
     * wrong patient - the action DEMOTES to an explicitly-unscheduled visit
     * (binding cleared, visible warning) and proceeds. */
    const h = makeHarness({ setFails: true });
    h.run(row(day), { record: true, generate: true });
    assert.strictEqual(h.calls.record, 1, `${day}: unproven binding must demote and record, not silently refuse`);
    assert.strictEqual(h.calls.generate, 1, `${day}: unproven binding must demote and generate`);
    assert.strictEqual(h.calls.set, 2, `${day}: the demotion must clear the binding (set(null) after the failed install)`);
    assert(/Athena appointment not linked/.test(h.context.S.lastWarn) && /work normally/.test(h.context.S.lastWarn), `${day}: the demotion must calmly explain that local work continues`);
    assert.strictEqual(h.context.currentVisitAthenaBinding, null, `${day}: no binding may survive the demotion`);
  }
  {
    /* The fail-closed core the gate exists for is PRESERVED: an active chart
     * whose DOB contradicts the picked row is a proven cross-patient conflict
     * and still blocks outright. */
    const h = makeHarness({ active: { id: 'PT-2', name: 'Exact Patient', dob: '01/01/1999' } });
    h.run(row(day), { record: true, generate: true });
    assert.strictEqual(h.calls.record, 0, `${day}: DOB-conflicting active chart must never record`);
    assert.strictEqual(h.calls.generate, 0, `${day}: DOB-conflicting active chart must never generate`);
    assert(/DIFFERENT patient/.test(h.context.S.lastWarn), `${day}: the conflict block must name the cause`);
  }
  {
    /* Canonical local IDs outrank agreeing demographics. */
    const h = makeHarness({ active: { id: 'PT-2', name: 'Exact Patient', dob: '03/04/1980' } });
    h.run({ ...row(day), _mlsTargetPatientId: 'PT-1' }, { record: true, generate: true });
    assert.strictEqual(h.calls.record, 0, `${day}: explicit local-id contradiction reached recording`);
    assert.strictEqual(h.calls.generate, 0, `${day}: explicit local-id contradiction reached generation`);
    assert(/DIFFERENT patient/.test(h.context.S.lastWarn), `${day}: local-id contradiction did not stay a hard conflict`);
  }
  {
    const h = makeHarness();
    h.run(row(day), { record: true, generate: true });
    assert.strictEqual(h.calls.record, 1, `${day}: proven exact binding did not allow recording`);
    assert.strictEqual(h.calls.generate, 1, `${day}: proven exact binding did not allow generation`);
    assert.strictEqual(h.context.matches(row(day)), true, `${day}: installed exact binding failed read-back verification`);
  }
}

console.log('PASS exact scheduled action gate: a proven binding records bound, an unproven one demotes to unscheduled with the binding cleared, and a cross-patient conflict still blocks outright');
