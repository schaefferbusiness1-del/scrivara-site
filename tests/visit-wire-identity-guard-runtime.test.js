'use strict';

/* __mlsVisitWire's cross-patient guard: an AI-parsed chart.name may not veto a
   save that carries the extension's deterministic saveRef identity proof
   (live 2026-07-15: 5 exact-identity saves per pull were blocked because the
   parse reformatted the name). Callers WITHOUT the deterministic proof keep
   the full fail-closed name veto. Runs the REAL feat_visits.js. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');

function makeContext() {
  const store = { patients: [{ id: 'pt-1', name: 'Helen L Perigo', dob: '04/14/1934', mrn: '7728445', visits: [] }] };
  const el = () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {}, textContent: '', innerHTML: '', className: '', id: '' });
  const calls = [];
  const ctx = {
    console: { warn() {}, log() {}, error() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    document: { readyState: 'complete', addEventListener() {}, removeEventListener() {}, getElementById: () => null, createElement: el, querySelector: () => null, querySelectorAll: () => [], head: el(), documentElement: el(), body: el() },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getPatients: () => store.patients.map(p => p),
    savePatients(a) { store.patients = a; },
    findPatient: id => store.patients.find(p => p && p.id === id) || null,
    upsertPatient(p) { const i = store.patients.findIndex(x => x.id === p.id); if (i >= 0) store.patients[i] = p; else store.patients.unshift(p); },
    fetch: () => Promise.reject(new Error('none')),
    /* deterministic app identity gate: exact digits DOB or MRN */
    _athenaHistoryProofMatches(target, observed) {
      const d = s => String(s || '').replace(/\D/g, '');
      const nameOk = String(observed.chartName || '').toLowerCase().indexOf(String(target.name || '').toLowerCase().split(' ')[0]) >= 0;
      return nameOk && ((d(target.dob) && d(target.dob) === d(observed.chartDob)) || (d(target.mrn) && d(target.mrn) === d(observed.chartMrn)));
    },
    _savePatientChart(ref, appt, chart) { calls.push('base'); return true; },
    calls, store
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  assert(ctx._savePatientChart.__mlsWrapped, 'visit wire did not wrap _savePatientChart');
  return ctx;
}

const chartWithOddName = { name: 'PERIGO, H.', dob: '04/14/1934', problems: 'x', visits: [] };

// 1) deterministic saveRef proof present + AI name mismatch -> save proceeds
{
  const ctx = makeContext();
  const ref = { patientId: 'pt-1', name: 'Helen L Perigo', dob: '04/14/1934', mrn: '7728445', verifiedName: 'Helen L Perigo', verifiedDob: '04/14/1934', verifiedMrn: '7728445', requestId: 'r1' };
  const out = ctx._savePatientChart(ref, null, chartWithOddName);
  assert.strictEqual(out, true, 'a deterministically-proven save must not be vetoed by the AI-parsed name');
  assert(ctx.calls.includes('base'), 'the base save must run');
}

// 2) NO deterministic proof + AI name mismatch -> still fail closed
{
  const ctx = makeContext();
  const badChart = { name: 'Robert Different', dob: '01/01/1950', problems: 'x' };
  const out = ctx._savePatientChart({ patientId: 'pt-1', name: 'Helen L Perigo' }, null, badChart);
  assert.strictEqual(out, false, 'a proof-less mismatching chart must stay blocked');
  assert.strictEqual(ctx.calls.length, 0, 'the base save must never run for a blocked cross-patient chart');
  assert(ctx.__mlsVisitWire._blocked >= 1, 'the block must be counted');
}

// 3) forged verifiedName without matching DOB/MRN digits cannot mint the bypass
{
  const ctx = makeContext();
  const badChart = { name: 'Robert Different', dob: '01/01/1950', problems: 'x' };
  const forged = { patientId: 'pt-1', name: 'Helen L Perigo', dob: '04/14/1934', mrn: '7728445', verifiedName: 'Helen L Perigo', verifiedDob: '02/02/2000', verifiedMrn: '999' };
  const out = ctx._savePatientChart(forged, null, badChart);
  assert.strictEqual(out, false, 'a forged echo without digit proof must not bypass the veto');
}

console.log('PASS visit-wire guard: deterministic saveRef proof outranks AI-name veto; proof-less and forged callers stay blocked');
