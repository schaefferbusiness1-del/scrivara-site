'use strict';
/* qg-2.0 control: AT QUOTA, THE EDIT SURVIVES — quota-write-loses-the-edit-
   silently, rebuilt per the surviving recipe after the proven fix (adf483ac)
   died with its lane. The REAL ScribeFlow patient-store block runs here:
   the enqueue fires BEFORE the local write, so a quota throw can no longer
   strand an edit in NO location. Paired assertions per the recipe: exactly
   ONE enqueue for a single ordinary edit AND ZERO for a 200-row batched pull
   (the zero half alone passes on code that never runs); the quota case holds
   the id in the pending mirror while the store serves pre-edit bytes LOUDLY;
   and the OLD order reproduces the lost-edit signature by name. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const start = html.indexOf('var __mlsLZ=(function(){');
const end = html.indexOf('async function loadPatientsFromServer', start);
assert(start >= 0 && end > start, 'patient-store + pending-sync block not found');
const SRC = html.slice(start, end);

/* ---- source pins ---- */
const spliceAt = SRC.indexOf('qg-2.0');
assert(spliceAt > 0, 'the qg-2.0 splice exists');
const spliceRegion = SRC.slice(spliceAt, spliceAt + 1600);
assert(/if\(backendMode\(\) && bkToken\(\) && p && p\.id!=null\)\{ _pendingSyncAdd\(String\(p\.id\)\); \}/.test(spliceRegion),
  'the enqueue runs unconditionally on the direct path — and is NOT wrapped in a try (no catch may swallow it)');
assert(!/try\s*\{\s*if\(backendMode\(\) && bkToken\(\) && p && p\.id!=null\)\{ _pendingSyncAdd/.test(SRC),
  'NO catch around the enqueue — a swallowed throw recreates the defect one layer out');
assert(spliceRegion.indexOf('_pendingSyncAdd') < spliceRegion.indexOf('savePatients(arr)'),
  'the enqueue precedes the local write — the whole point');
assert(/__mlsPtsEditAtRiskUnknown=true/.test(spliceRegion), 'the unknown latch exists and unknown takes the loud branch');
assert(/\(Array\.isArray\(list\)\?list:\[\]\)/.test(SRC), '_pendingSyncSet stays Array.isArray, never duck-typed length');

/* ---- harness: run the REAL block ---- */
function makeStore(fullFlag) {
  const data = new Map();
  const store = {
    data,
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    getItem: k => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => { if (fullFlag.full) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } data.set(k, String(v)); },
    removeItem: k => { data.delete(k); },
  };
  return store;
}
function boot(src) {
  const fullFlag = { full: false };
  const store = makeStore(fullFlag);
  const syncCalls = [];
  const toasts = [];
  const win = {
    addEventListener: () => {}, removeEventListener: () => {},
    dispatchEvent: () => true,
    requestAnimationFrame: fn => 1,
  };
  const ctx = {
    window: win, localStorage: store, document: { getElementById: () => null, addEventListener: () => {}, createElement: () => ({ style: {} }), visibilityState: 'visible' },
    navigator: { onLine: true }, performance: { now: () => 0 },
    setTimeout: () => 1, clearTimeout: () => {}, setInterval: () => 1, clearInterval: () => {},
    CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
    Event: function (t) { this.type = t; },
    Worker: undefined,
    console, JSON, Math, Date, Array, Object, String, Number, Promise, RegExp, Uint8Array, TextEncoder: global.TextEncoder, TextDecoder: global.TextDecoder,
    uns: k => 't::' + k,
    backendMode: () => true, bkToken: () => 'tok',
    syncPatientToServer: p => { syncCalls.push(String(p && p.id)); },
    toast: (m) => { toasts.push(String(m)); },
    getActivePt: () => null, renderPatients: () => {}, updateNavCounts: () => {}, renderProfile: () => {}, renderPatientBar: () => {},
  };
  ctx.window.localStorage = store; ctx.self = ctx.window; ctx.globalThis = ctx;
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'ScribeFlow:patient-store' });
  /* the block defines the REAL syncPatientToServer — replace it post-boot so
     the spy observes the mirror call (free-variable lookup is call-time) */
  ctx.syncPatientToServer = p => { syncCalls.push(String(p && p.id)); };
  /* the app wires window.savePatients after this block; the batch flush
     resolves through it */
  ctx.window.savePatients = ctx.savePatients;
  return { ctx, store, fullFlag, syncCalls, toasts };
}
const pendingCount = (h) => [...h.store.data.keys()].filter(k => k.indexOf('pendingPtSync') >= 0).length;
const memPending = (h) => { try { const m = h.ctx.__mlsPtsPendingMirrorMemoryByKey || {}; return Object.keys(m).reduce((s, k) => s + Object.keys(m[k] || {}).length, 0); } catch (e) { return -1; } };

/* ---- A: single ordinary edit → exactly ONE enqueue, save lands, mirror runs ---- */
{
  const h = boot(SRC);
  h.ctx.upsertPatient({ id: 'p1', name: 'Adam Test', visits: [] });
  assert.strictEqual(pendingCount(h), 1, 'exactly one pending enqueue for a single ordinary edit (got ' + pendingCount(h) + ')');
  assert.strictEqual(h.syncCalls.length, 1, 'the immediate mirror still runs');
  const got = h.ctx.getPatients();
  assert.strictEqual(got.length, 1, 'the save landed');
  assert.strictEqual(got[0].name, 'Adam Test');
}

/* ---- B: 200-row batched pull → ZERO pre-enqueues (and the zero is not vacuous:
        case A proved the counter counts) ---- */
{
  const h = boot(SRC);
  const tok = h.ctx.window.__mlsPatientStoreBatch.begin({ label: 'schedule-pull' });
  for (let i = 0; i < 200; i++) h.ctx.upsertPatient({ id: 'bp' + i, name: 'Batch Row ' + i, visits: [] });
  assert.strictEqual(pendingCount(h), 0, 'a 200-row batched pull makes ZERO sidecar enqueues (got ' + pendingCount(h) + ')');
  h.ctx.window.__mlsPatientStoreBatch.end(tok, 'test');
  assert.strictEqual(pendingCount(h), 0, 'still zero after the batch flush');
  assert.strictEqual(h.ctx.getPatients().length, 200, 'the batch itself landed');
}

/* ---- C: AT QUOTA — the edit SURVIVES, loudly ---- */
{
  const h = boot(SRC);
  h.ctx.upsertPatient({ id: 'pq', name: 'Before Edit', visits: [] });
  h.syncCalls.length = 0;
  h.fullFlag.full = true; /* hard quota: every setItem throws */
  let threw = false;
  try { h.ctx.upsertPatient({ id: 'pq', name: 'After Edit', visits: [] }); } catch (e) { threw = true; }
  assert.strictEqual(threw, true, 'quota still THROWS out of the save path (pinned contract)');
  assert.strictEqual(h.ctx.getPatients()[0].name, 'Before Edit', 'the store serves pre-edit bytes (the local write was refused)');
  assert.ok(memPending(h) >= 1, 'THE EDIT IS NOT IN NO LOCATION: the pending mirror holds the id via the in-memory fallback (got ' + memPending(h) + ')');
  assert.ok(h.toasts.some(t => /could NOT be saved/i.test(t)), 'the failure is LOUD');
}

/* ---- D: NON-VACUITY — the OLD order reproduces the lost-edit signature by name ---- */
{
  const revertStart = SRC.lastIndexOf('}else{', spliceAt);
  const endTok = 'savePatients(arr);\n  }';
  const revertEnd = SRC.indexOf(endTok, spliceAt);
  assert.ok(revertStart > 0 && revertEnd > revertStart, 'splice bounds for the revert found');
  const OLD = SRC.slice(0, revertStart) + '}else savePatients(arr);' + SRC.slice(revertEnd + endTok.length);
  const h = boot(OLD);
  h.ctx.upsertPatient({ id: 'pq', name: 'Before Edit', visits: [] });
  h.fullFlag.full = true;
  try { h.ctx.upsertPatient({ id: 'pq', name: 'After Edit', visits: [] }); } catch (e) {}
  assert.strictEqual(pendingCount(h), 0, 'OLD order: queue empty');
  assert.strictEqual(memPending(h), 0, 'OLD order: memory mirror empty');
  assert.strictEqual(h.ctx.getPatients()[0].name, 'Before Edit', 'OLD order: store pre-edit — THE EDIT EXISTS NOWHERE: the exact defect, reproduced by name');
}

console.log('quota-guard-edit-survives: OK (1 enqueue per ordinary edit, 0 per 200-row batch, quota edit survives in the pending mirror + loud throw + pre-edit store, old order reproduces edit-exists-nowhere, no-catch and Array.isArray pinned)');
