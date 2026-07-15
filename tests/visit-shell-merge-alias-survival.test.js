'use strict';

/* Live 2026-07-15: EVERY verified history save lost its trust opts because the
   b121 addVisit cycle-guard wrapper re-issued a deliberate TWO-ARG "b120
   parity" call (inner.call(M, patientId, visit)) — _normVisit re-tagged every
   verified row as an unverified 'import' row and the day failed
   visits-persistence-count-unproven. This test (1) pins the guard to full
   argument passthrough, and (2) proves the REAL feat_visits.js model persists
   a verified day batch through add + reconcile against pre-existing schedule
   shells, surviving the strict persistence filter. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');

// 1) static contract: the cycle-guard must pass ALL addVisit arguments through
{
  const guard = fs.readFileSync(path.join(root, 'feat_mls_b121_pack.js'), 'utf8');
  assert(guard.includes('inner.apply(M, arguments)'), 'b121 guard must forward every addVisit argument');
  assert(!/inner\.call\(M,\s*patientId,\s*visit\)/.test(guard), 'the opts-dropping two-arg guard call must never return');
}

const source = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');

function makeContext() {
  const store = { patients: [] };
  const el = () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {}, textContent: '', innerHTML: '', className: '', id: '' });
  const ctx = {
    console, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    document: {
      readyState: 'complete',
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null,
      createElement: el,
      querySelector: () => null, querySelectorAll: () => [],
      head: el(), documentElement: el(), body: el()
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getPatients: () => store.patients.map(p => p),
    savePatients(arr) { store.patients = arr; },
    findPatient: id => store.patients.find(p => p && p.id === id) || null,
    upsertPatient(p) { const i = store.patients.findIndex(x => x.id === p.id); if (i >= 0) store.patients[i] = p; else store.patients.unshift(p); },
    fetch: () => Promise.reject(new Error('no network in test')),
    store
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  assert(ctx.__mlsVisitModel && typeof ctx.__mlsVisitModel.addVisit === 'function', 'feat_visits.js did not install the visit model');
  return ctx;
}

const strictPersistedFilter = (v, pid) =>
  !!(v && /athena|legacy|grab|pullrec/i.test(String(v.source || '')) && v.identityVerified === true &&
    String(v.identityBinding || '') === String(pid) && v.indexOnly !== true && v.fullDetail === true &&
    v.bodyComplete === true && String(v.raw || '').trim() &&
    (String(v.encounterId || '').trim() || String(v.sourceVisitKey || '').trim()));

// 2) a verified day batch lands next to schedule shells and survives reconcile
{
  const ctx = makeContext();
  const M = ctx.__mlsVisitModel;
  const pid = 'pt-shell-1';
  ctx.store.patients = [{
    id: pid, name: 'Shell Patient', dob: '01/02/1960',
    visits: [
      { id: 'shell-1', date: '2026-07-01', type: '', raw: '', textHead: 'index text', indexOnly: true, fullDetail: false, bodyComplete: false, source: 'athena-schedule-history', cpt: [], icd10: [], meds: [] },
      { id: 'old-import', date: '2026-05-04', type: 'Office Visit', raw: 'Older locally imported body.', source: 'import', cpt: [], icd10: [], meds: [] }
    ]
  }];
  const rows = [
    { date: '2026-07-01', type: 'Office Visit', raw: 'Subjective: pain improved. Objective: stable. Plan: continue.', fullDetail: true, encounterId: 'enc-777', sourceVisitKey: 'rowkey-777' },
    { date: '2026-06-10', type: 'Follow up', raw: 'Distinct second visit body.', fullDetail: true, encounterId: 'enc-778' }
  ];
  rows.forEach(r => {
    const stored = M.addVisit(pid, r, { source: 'athena-copy', identityVerified: true, identityBinding: pid, bodyComplete: true });
    assert(stored, 'verified add failed');
    assert.strictEqual(stored.identityVerified, true, 'trust must be stamped from opts');
    assert.strictEqual(stored.bodyComplete, true, 'bodyComplete must be stamped from opts + fullDetail');
    assert(String(stored.encounterId || stored.sourceVisitKey || '').trim(), 'stable alias must be stored');
  });
  const receipt = M.reconcileVerifiedAthenaVisits(pid, rows);
  assert(receipt && receipt.complete === true, 'reconcile must complete: ' + JSON.stringify(receipt));
  const p = ctx.findPatient(pid);
  const proven = (p.visits || []).filter(v => strictPersistedFilter(v, pid));
  assert.strictEqual(proven.length, rows.length, 'every verified batch row must persist proven; got ' + proven.length + ' of ' + (p.visits || []).length + ' stored');
  assert((p.visits || []).some(v => v && v.id === 'old-import'), 'manual/unverified rows must never be deleted by the verified reconcile');

  // 3) repeat pull (same batch again) stays idempotent — one proven row per encounter
  rows.forEach(r => assert(M.addVisit(pid, r, { source: 'athena-copy', identityVerified: true, identityBinding: pid, bodyComplete: true }), 're-add failed'));
  const receipt2 = M.reconcileVerifiedAthenaVisits(pid, rows);
  assert(receipt2 && receipt2.complete === true, 'repeat reconcile must complete');
  const proven2 = (ctx.findPatient(pid).visits || []).filter(v => strictPersistedFilter(v, pid));
  assert.strictEqual(proven2.length, rows.length, 'repeat pull must not duplicate or drop proven rows');
}

// 4) an untrusted payload still cannot mint trust
{
  const ctx = makeContext();
  const M = ctx.__mlsVisitModel;
  const pid = 'pt-hostile-1';
  ctx.store.patients = [{ id: pid, name: 'Hostile Case', dob: '03/04/1962', visits: [] }];
  const stored = M.addVisit(pid, { date: '2026-07-03', raw: 'payload text', fullDetail: true, identityVerified: true, encounterId: 'enc-h' }, { source: 'import' });
  assert(stored, 'untrusted add failed');
  assert.notStrictEqual(stored.identityVerified, true, 'payload must not mint identity trust');
  assert.notStrictEqual(stored.bodyComplete, true, 'payload must not mint bodyComplete without a trusted batch');
}

console.log('PASS visit persistence: guard passes opts through; verified batches persist, reconcile idempotent, trust caller-gated');
