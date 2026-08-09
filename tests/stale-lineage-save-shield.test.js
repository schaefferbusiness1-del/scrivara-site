'use strict';

/*
 * svs-1.0.0 — the cross-tab stale-lineage save shield.
 *
 * Measured 2026-08-08: a wedged second app tab re-saved its pre-heal roster
 * ~45.6s behind each fresh write; every save stamps updated=now, so the STALE
 * lineage carried the NEWER stamp and newest-updated-wins re-hydration
 * replaced 98 of 153 freshly healed records. The rule: a writer may only
 * replace a record it has OBSERVED — an incoming object whose own pre-stamp
 * `updated` is older than the stored row's is descended from an older copy
 * and is refused (upsert) or per-row protected (bulk save).
 *
 * BOTH ARMS, plus the in-suite pre-fix control: with the shield REVERTED the
 * same stale write is accepted and destroys the fresh value — proving the
 * suite tests the shield and not a coincidence of the base.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'feat_mls_saveshield.js'), 'utf8');

function freshWorld() {
  const timers = [];
  let patientReads = 0;
  let rawValue = 'stable-raw';
  const localStorage = { getItem() { return rawValue; } };
  const patients = [
    { id: 'pt-a', name: 'A', meds: 'FRESH MEDS 1200 chars worth', updated: 2000 },
    { id: 'pt-b', name: 'B', meds: 'B meds', updated: 2000 }
  ];
  const world = {
    console: { warn() {}, log() {}, error() {} },
    setInterval() { return 1; }, clearInterval() {},
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    Date, Number, String, Array, Object, JSON, Math, isFinite,
    patients, timers, localStorage, uns() { return 'acct::patients'; }, __mlsPtsBatchByKey: {},
    setRaw(value) { rawValue = String(value); }, onPatientRead: null,
    patientReads() { return patientReads; },
    getPatients() { patientReads++; const rows = patients; if (typeof world.onPatientRead === 'function') world.onPatientRead(); return rows; },
    upsertPatient(p) {
      const i = patients.findIndex(x => x.id === p.id);
      p.updated = 999999; /* the base always stamps now — the clobber vector */
      if (i >= 0) patients[i] = p; else patients.push(p);
      if (world.__testBatch) world.__testBatch.totalChanges++;
      return { ok: true };
    },
    savePatients(arr) { patients.length = 0; arr.forEach(p => patients.push(p)); return true; },
    toast() {}
  };
  world.window = world;
  vm.runInNewContext(src, world, { filename: 'feat_mls_saveshield.js' });
  return world;
}

/* ---- a scope change during map construction must retry, never bless A as B ---- */
{
  const w = freshWorld();
  w.onPatientRead = function () { w.onPatientRead = null; w.setRaw('new-raw-generation'); };
  const accepted = w.upsertPatient({ id: 'pt-b', name: 'B', meds: 'new', updated: 2000 });
  assert.strictEqual(accepted && accepted.ok, true, 'stable retry after a map-generation change was refused');
  assert.strictEqual(w.patientReads(), 2, 'save shield cached rows from an old raw generation under a new generation');
}

/* ---- rearm ownership: a wipe/other wrapper above us must not duplicate the shield ---- */
{
  const w = freshWorld();
  const shield = w.savePatients;
  const outer = function () { return shield.apply(this, arguments); };
  outer.__mlsWipeGuarded = true; outer.__mlsWipeGuardOrig = shield; outer.__mlsOrig = shield;
  w.savePatients = outer;
  assert(w.timers.length >= 1, 'save-shield rearm was not scheduled');
  w.timers[0]();
  assert.strictEqual(w.savePatients, outer, 'save-shield duplicated itself below an interoperable wrapper owner');
}

/* ---- active managed batch: build the safety index once, then update it O(1) ---- */
{
  const w = freshWorld();
  while (w.patients.length < 1571) w.patients.push({ id: 'bulk-' + w.patients.length, name: 'Bulk', updated: 2000 });
  const batch = { depth: 1, arr: w.patients, totalChanges: 0, externalWrites: 0 };
  w.__testBatch = batch; w.__mlsPtsBatchByKey['acct::patients'] = batch;
  for (let i = 0; i < 80; i++) {
    const current = w.patients[i];
    const result = w.upsertPatient(Object.assign({}, current, { meds: 'batch-' + i, updated: current.updated }));
    assert.strictEqual(result && result.ok, true, 'fresh managed-batch upsert was refused');
  }
  assert.strictEqual(w.patientReads(), 1, 'save shield rebuilt the full 1,571-patient safety map per managed upsert');
  batch.externalWrites++;
  const refreshed = w.upsertPatient(Object.assign({}, w.patients[90], { meds: 'after-external-generation', updated: w.patients[90].updated }));
  assert.strictEqual(refreshed && refreshed.ok, true, 'post-external-generation upsert was refused');
  assert.strictEqual(w.patientReads(), 2, 'external batch generation did not invalidate the cached safety map exactly once');
  const beforeChanges = batch.totalChanges;
  const refused = w.upsertPatient({ id: w.patients[90].id, name: 'Bulk', meds: 'stale', updated: 1 });
  assert.strictEqual(refused && refused.refused, 'stale-lineage', 'cached safety lookup stopped refusing a stale managed-batch row');
  assert.strictEqual(batch.totalChanges, beforeChanges, 'a refused inner write was incorrectly recorded as accepted');
}

/* ---- in-suite pre-fix control: WITHOUT the shield the stale write wins ---- */
{
  const w = freshWorld();
  w.__mlsSaveShield.revert();
  const stale = { id: 'pt-a', name: 'A', meds: 'STALE OLD MEDS', updated: 1000 };
  w.upsertPatient(stale);
  assert.strictEqual(w.patients.find(p => p.id === 'pt-a').meds, 'STALE OLD MEDS',
    'control broken: without the shield the stale write must clobber (it did on live 2026-08-08)');
}

/* ---- arm 1 (discriminating): the stale-lineage upsert is REFUSED ---- */
{
  const w = freshWorld();
  const stale = { id: 'pt-a', name: 'A', meds: 'STALE OLD MEDS', updated: 1000 };
  const r = w.upsertPatient(stale);
  assert.strictEqual(r && r.refused, 'stale-lineage', 'a stale-lineage upsert must be refused, got ' + JSON.stringify(r));
  assert.strictEqual(w.patients.find(p => p.id === 'pt-a').meds, 'FRESH MEDS 1200 chars worth', 'the fresh value must survive');
  assert.strictEqual(w.__mlsSaveShield.state.refusedUpserts, 1, 'the refusal must be COUNTED');
  assert(w.__mlsSaveShield.state.samples.length === 1 && w.__mlsSaveShield.state.samples[0].id === 'pt-a', 'the refusal must be sampled visibly');
}

/* ---- arm 2: legitimate writes still succeed (a shield that blocks everything is an outage) ---- */
{
  const w = freshWorld();
  const live = w.patients.find(p => p.id === 'pt-a');
  live.meds = 'LIVE MUTATION';
  assert.strictEqual((w.upsertPatient(live) || {}).ok, true, 'a live-reference mutation save must pass');
  assert.strictEqual(w.patients.find(p => p.id === 'pt-a').meds, 'LIVE MUTATION');

  const equalStamp = { id: 'pt-b', name: 'B', meds: 'CONCURRENT FRESH', updated: 2000 };
  assert.strictEqual((w.upsertPatient(equalStamp) || {}).ok, true, 'an equal-stamp concurrent write from a fresh tab must pass');

  const brandNew = { id: 'pt-new', name: 'N', meds: 'first save' };
  assert.strictEqual((w.upsertPatient(brandNew) || {}).ok, true, 'a brand-new record must pass');
  assert(w.patients.some(p => p.id === 'pt-new'), 'the new record must land');
  assert.strictEqual(w.__mlsSaveShield.state.refusedUpserts, 0, 'no legitimate write may be refused');
}

/* ---- arm 3: a stale BULK save is per-row protected, not wholesale refused ---- */
{
  const w = freshWorld();
  const staleRow = { id: 'pt-a', name: 'A', meds: 'ZOMBIE ROSTER COPY', updated: 1000 };
  const freshRow = { id: 'pt-b', name: 'B', meds: 'B meds v2', updated: 2000 };
  w.savePatients([staleRow, freshRow]);
  assert.strictEqual(w.patients.find(p => p.id === 'pt-a').meds, 'FRESH MEDS 1200 chars worth',
    'the fresher stored row must survive a stale bulk save (the 98-record clobber vector)');
  assert.strictEqual(w.patients.find(p => p.id === 'pt-b').meds, 'B meds v2', 'the legitimately-fresh bulk row must still land');
  assert.strictEqual(w.__mlsSaveShield.state.protectedBulkRows, 1, 'the protected row must be COUNTED');
}

/* ---- the loader must actually serve it (shipped-only law) ---- */
{
  const connect = fs.readFileSync(path.join(ROOT, 'mls-connect.js'), 'latin1');
  assert(connect.includes('data-mls-asset="feat_mls_saveshield.js"'), 'the save shield has no loader — a dead file protects nothing');
  assert(/feat_mls_saveshield\.js\?v='\s*\+\s*\(window\.__MLS_AV\|\|Date\.now\(\)\)/.test(connect), 'the loader must use the __MLS_AV cache-busting form');
}

console.log('stale-lineage-save-shield: PASS (14 checks)');
