'use strict';

/* Live 2026-07-22 (b482, OFF-mode day pull): four patients each gained an
   EXACT duplicate schedule-history index row — identical date/type/textHead/
   source, ids minted ~46ms apart. The second ingest pass read the patient
   through a PRE-BATCH accessor that did not yet contain the first pass's row.
   This suite pins the b483 fix:
   1) _findPatient prefers the batch-aware getPatients() read over the
      possibly-stale window.findPatient accessor;
   2) addVisit + ingestChart collapse exact-clone alias-less index shells on
      the freshest record (self-healing pairs stranded by earlier sessions);
   3) the collapse NEVER touches bodies, alias'd rows, differing content, or
      rows whose trust state differs. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_visits.js'), 'utf8');

/* Harness matching the REAL store semantics (ScribeFlow.html):
   - upsertPatient REPLACES the row (arr[i]=p) in the authoritative array;
   - getPatients() serves that authoritative (batch) array — fresh clones;
   - findPatient() serves a FROZEN earlier snapshot (the stale memo that
     caused the live duplicates). */
function makeContext() {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const store = { arr: [], frozen: [] };
  const el = () => ({ style: {}, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {}, textContent: '', innerHTML: '', className: '', id: '' });
  const ctx = {
    console, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval: () => {},
    document: {
      readyState: 'complete',
      addEventListener() {}, removeEventListener() {},
      getElementById: () => null, createElement: el,
      querySelector: () => null, querySelectorAll: () => [],
      head: el(), documentElement: el(), body: el()
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    getPatients: () => store.arr.map(clone),
    savePatients(arr) { store.arr = arr.map(clone); },
    findPatient: id => { const hit = store.frozen.find(p => p && p.id === id); return hit ? clone(hit) : null; },
    upsertPatient(p) {
      const i = store.arr.findIndex(x => x && x.id === p.id);
      if (i >= 0) store.arr[i] = clone(p); else store.arr.unshift(clone(p));
    },
    freeze() { store.frozen = store.arr.map(clone); },
    fetch: () => Promise.reject(new Error('no network in test')),
    store
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(source, ctx);
  assert(ctx.__mlsVisitModel && typeof ctx.__mlsVisitModel.addVisit === 'function', 'feat_visits.js did not install the visit model');
  return ctx;
}

const R1 = { date: '2026-07-22', type: 'Lumbar back pain; Pain in lower back', textHead: '2026-07-22 — Lumbar back pain; office visit', fullDetail: false };
const R2 = { date: '2026-07-19', type: 'L Spine, Imaging - X-ray', textHead: '2026-07-19 — L Spine imaging', fullDetail: false };

// 1) static contract: the fix is present in source
assert(source.includes('_collapseExactIndexDuplicates'), 'exact-index collapse must exist');
assert(/_getPatients\(\)\.find[\s\S]{0,260}window\.findPatient/.test(source.slice(source.indexOf('function _findPatient'), source.indexOf('function _findPatient') + 900)),
  '_findPatient must prefer the batch-aware getPatients() read over the pre-batch findPatient accessor');

// 2) THE LIVE RACE: a second ingest pass while findPatient still serves the
//    pre-pull snapshot. With the batch-aware read every row lands exactly
//    once; the stale-accessor code path either duplicated or dropped rows.
{
  const ctx = makeContext();
  const M = ctx.__mlsVisitModel;
  const pid = 'pt-race-1';
  ctx.store.arr = [{ id: pid, name: 'Race Case', dob: '01/02/1960', visits: [] }];
  ctx.freeze(); // findPatient now serves the EMPTY pre-pull snapshot forever
  M.ingestChart(pid, { visits: [R1, R2] }, 'athena-schedule-history', {});
  M.ingestChart(pid, { visits: [R1, R2] }, 'athena-schedule-history', {}); // second pass, stale accessor unchanged
  const p = ctx.store.arr.find(x => x.id === pid);
  const idx = (p.visits || []).filter(v => v && v.indexOnly === true);
  assert.strictEqual(idx.length, 2, 'two distinct rows must persist exactly once each, got ' + idx.length);
  const types = idx.map(v => v.type).sort();
  assert.deepStrictEqual(types, [R1.type, R2.type].sort(), 'both distinct rows must survive: ' + JSON.stringify(types));
}

// 3) self-heal: an exact clone pair already persisted (stranded by an earlier
//    session's race) collapses on the next ingest touching that patient.
{
  const ctx = makeContext();
  const M = ctx.__mlsVisitModel;
  const pid = 'pt-heal-1';
  const dup = (id) => Object.assign({ id, raw: '', indexOnly: true, bodyComplete: false, fullDetail: false, encounterId: '', sourceVisitKey: '', source: 'athena-schedule-history', cpt: [], icd10: [], meds: [], identityVerified: false, identityBinding: '' }, R1);
  ctx.store.arr = [{ id: pid, name: 'Heal Case', dob: '02/03/1961', visits: [dup('old-a'), dup('old-b')] }];
  ctx.freeze();
  M.ingestChart(pid, { visits: [R2] }, 'athena-schedule-history', {});
  const p = ctx.store.arr.find(x => x.id === pid);
  const clones = (p.visits || []).filter(v => v && v.type === R1.type);
  assert.strictEqual(clones.length, 1, 'pre-existing exact clone pair must collapse to one, got ' + clones.length);
  assert((p.visits || []).some(v => v && v.type === R2.type), 'the new distinct row must be saved');
}

// 4) collapse safety: what must NEVER collapse
{
  const ctx = makeContext();
  const M = ctx.__mlsVisitModel;
  const pid = 'pt-safe-1';
  const base = { raw: '', indexOnly: true, bodyComplete: false, fullDetail: false, encounterId: '', sourceVisitKey: '', source: 'athena-schedule-history', cpt: [], icd10: [], meds: [], identityVerified: false, identityBinding: '' };
  const safeP = {
    id: pid, name: 'Safety Case', dob: '03/04/1962', visits: [
      // distinct textHead — two real same-day entries
      Object.assign({}, base, { id: 's1', date: '2026-07-10', type: 'Office visit', textHead: '9:00 AM — Office visit' }),
      Object.assign({}, base, { id: 's2', date: '2026-07-10', type: 'Office visit', textHead: '2:30 PM — Office visit' }),
      // verified full bodies — untouchable even with identical text
      Object.assign({}, base, { id: 's3', date: '2026-06-01', type: 'Procedure', indexOnly: false, fullDetail: true, bodyComplete: true, raw: 'Full body A', encounterId: 'enc-1', identityVerified: true, identityBinding: pid }),
      Object.assign({}, base, { id: 's4', date: '2026-06-01', type: 'Procedure', indexOnly: false, fullDetail: true, bodyComplete: true, raw: 'Full body A', encounterId: 'enc-2', identityVerified: true, identityBinding: pid }),
      // alias'd index rows — alias machinery owns these, not the collapse
      Object.assign({}, base, { id: 's5', date: '2026-05-05', type: 'Follow up', textHead: 'fu', sourceVisitKey: 'rk-1' }),
      Object.assign({}, base, { id: 's6', date: '2026-05-05', type: 'Follow up', textHead: 'fu', sourceVisitKey: 'rk-2' }),
      // trust states differ — never merge across the trust boundary
      Object.assign({}, base, { id: 's7', date: '2026-04-04', type: 'Consult', textHead: 'c' }),
      Object.assign({}, base, { id: 's8', date: '2026-04-04', type: 'Consult', textHead: 'c', identityVerified: true, identityBinding: pid })
    ]
  };
  const before = safeP.visits.length;
  const changed = M._collapseExactIndexDuplicates(safeP);
  assert.strictEqual(changed, false, 'nothing in the safety set may collapse');
  assert.strictEqual(safeP.visits.length, before, 'no safety row may be removed');

  // and a true exact pair in the same record DOES collapse, keeping the first
  safeP.visits.push(Object.assign({}, base, { id: 's9', date: '2026-03-03', type: 'Injection', textHead: 'inj' }));
  safeP.visits.push(Object.assign({}, base, { id: 's10', date: '2026-03-03', type: 'Injection', textHead: 'inj', aiSummary: 'kept summary' }));
  assert.strictEqual(M._collapseExactIndexDuplicates(safeP), true, 'the exact pair must collapse');
  const kept = safeP.visits.filter(v => v.type === 'Injection');
  assert.strictEqual(kept.length, 1, 'exactly one Injection row must remain');
  assert.strictEqual(kept[0].id, 's9', 'the EARLIER row must be kept');
  assert.strictEqual(kept[0].aiSummary, 'kept summary', 'a later clone\'s aiSummary must carry onto the keeper');
}

// 5) loaders ship the new module bytes
for (const loader of ['mls-connect.js', 'mls-connect.staging.js']) {
  const text = fs.readFileSync(path.join(root, loader), 'utf8');
  assert(text.includes('feat_visits.js?v=20260722vis7'), loader + ': feat_visits cache pin not bumped — the SW would serve the old module forever');
}

console.log('PASS visit index dupe collapse: batch-aware findPatient, racing ingest keeps each row once, union artifacts self-heal, bodies/aliases/trust boundaries untouched, loader pins bumped');
