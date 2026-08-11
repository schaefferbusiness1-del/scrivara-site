'use strict';
/* qg-2.0 control, sj-2.0 EDITION - DELIBERATE PIN MOVE No. 1 of exactly two.
   This file is the drafted REPLACEMENT for tests/quota-guard-edit-survives
   .test.js and may only replace it AT the phase-2 fence re-route commit
   (when savePatients routes idb-mode saves through __mlsPtsStore) - never
   before, never after-the-fact.

   THE MOVE, with the design's authorization quoted (tests/live-e2e-artifacts/
   2026-08-11-sj2-patients-idb-design.md, Q1 - arrows rendered ASCII):

     "Journal-full or journal-write-failure mid-run: savePatients THROWS (the
      pinned quota-throws-out contract, unchanged) - but unlike today, the
      edit survives: the pending-sync enqueue ALREADY ran (enqueue-before-
      write) and memory holds it; the unknown-latch takes the LOUD branch and
      si fails the row honestly."

   and the same document's quota-semantics paragraph: "Journal-write failure
   still throws out of savePatients (contract preserved), but the edit now
   lives in the pending queue + memory."

   WHAT MOVES: the old case C asserted "the store serves pre-edit bytes at
   quota" - correct while localStorage was the only store, because the refused
   write left ONLY the pre-edit copy. Under sj-2.0 (post-migration) memory is
   authoritative and the refused layer is the sync journal, so the SAME defect
   class is now pinned as: the throw still happens, the failure is still LOUD,
   the JOURNAL refused (durable-layer bytes unchanged), and the store serves
   the POST-edit rows from memory - the edit is never again in NO location.

   WHAT DOES NOT MOVE (kept byte-for-byte from the shipped suite): the splice
   source pins (enqueue unconditional + un-caught + before the write, the
   unknown latch, Array.isArray), case A (exactly ONE enqueue per ordinary
   edit), case B (ZERO enqueues per 200-row batch), the PRE-MIGRATION case C
   (ls-mode users keep the old pre-edit-bytes contract until the owner-gated
   cutover), and case D (the OLD enqueue order still reproduces the
   queue-empty signature by name). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const start = html.indexOf('var __mlsLZ=(function(){');
const end = html.indexOf('async function loadPatientsFromServer', start);
assert(start >= 0 && end > start, 'patient-store + pending-sync block not found');
const SRC = html.slice(start, end);

/* ---- source pins (unchanged from the shipped suite) ---- */
const spliceAt = SRC.indexOf('qg-2.0');
assert(spliceAt > 0, 'the qg-2.0 splice exists');
const spliceRegion = SRC.slice(spliceAt, spliceAt + 1600);
assert(/if\(backendMode\(\) && bkToken\(\) && p && p\.id!=null\)\{ _pendingSyncAdd\(String\(p\.id\)\); \}/.test(spliceRegion),
  'the enqueue runs unconditionally on the direct path - and is NOT wrapped in a try (no catch may swallow it)');
assert(!/try\s*\{\s*if\(backendMode\(\) && bkToken\(\) && p && p\.id!=null\)\{ _pendingSyncAdd/.test(SRC),
  'NO catch around the enqueue - a swallowed throw recreates the defect one layer out');
assert(spliceRegion.indexOf('_pendingSyncAdd') < spliceRegion.indexOf('savePatients(arr)'),
  'the enqueue precedes the local write - the whole point');
assert(/__mlsPtsEditAtRiskUnknown=true/.test(spliceRegion), 'the unknown latch exists and unknown takes the loud branch');
assert(/\(Array\.isArray\(list\)\?list:\[\]\)/.test(SRC), '_pendingSyncSet stays Array.isArray, never duck-typed length');

/* ---- sj-2.0 anchor-integrity pin: the primitive block sits in this window
   BEFORE the splice; if it carried the bytes qg-2.0 the spliceAt anchor above
   would land in a comment and every splice pin would go blind ---- */
const blockBegin = SRC.indexOf('/* ===== BEGIN mls-pts-store (sj-2.0) ===== */');
const blockEnd = SRC.indexOf('/* ===== END mls-pts-store (sj-2.0) ===== */');
assert(blockBegin >= 0 && blockEnd > blockBegin,
  'sj-2.0 primitive block present in the window - this MOVED suite only replaces the shipped one at the re-route commit');
assert(SRC.slice(blockBegin, blockEnd).indexOf('qg-2.0') < 0, 'the primitive block does not shadow the qg-2.0 anchor');
assert(blockEnd < spliceAt, 'the block precedes the real splice, so spliceAt still names the splice');

/* ---- harness: run the REAL block (unchanged from the shipped suite, plus a
   minimal fake IndexedDB + microtask settle for the idb-mode half) ---- */
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
function makeIDB(persist) {
  const stores = persist || new Map();
  function req() { return { onsuccess: null, onerror: null, result: undefined, error: null }; }
  function makeDB() {
    return {
      close() {},
      objectStoreNames: { contains: n => stores.has(n) },
      transaction() {
        const tx = { oncomplete: null, onabort: null, onerror: null, error: null, _aborted: false };
        tx.abort = function () { tx._aborted = true; setImmediate(() => { tx.onabort && tx.onabort(); }); };
        tx.objectStore = function (n) {
          const m = stores.get(n);
          return {
            get(k) { const r = req(); setImmediate(() => { if (tx._aborted) return; r.result = m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined; r.onsuccess && r.onsuccess(); }); return r; },
            put(rec) { const r = req(); setImmediate(() => { if (tx._aborted) return; m.set(rec.k, JSON.parse(JSON.stringify(rec))); r.onsuccess && r.onsuccess(); }); return r; },
            delete(k) { const r = req(); setImmediate(() => { if (tx._aborted) return; m.delete(k); r.onsuccess && r.onsuccess(); }); return r; },
          };
        };
        setImmediate(() => setImmediate(() => setImmediate(() => { if (!tx._aborted) { tx.oncomplete && tx.oncomplete(); } })));
        return tx;
      },
    };
  }
  return {
    _stores: stores,
    open() {
      const r = req(); r.onupgradeneeded = null; r.onblocked = null;
      setImmediate(() => {
        if (!stores.has('ptsBlobs')) {
          r.result = { objectStoreNames: { contains: n => stores.has(n) }, createObjectStore: n => { stores.set(n, new Map()); return {}; } };
          r.onupgradeneeded && r.onupgradeneeded();
        }
        r.result = makeDB(); r.onsuccess && r.onsuccess();
      });
      return r;
    },
  };
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
  ctx.window.__mlsBgSleep = () => Promise.resolve();
  ctx.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'ScribeFlow:patient-store' });
  /* the block defines the REAL syncPatientToServer - replace it post-boot so
     the spy observes the mirror call (free-variable lookup is call-time) */
  ctx.syncPatientToServer = p => { syncCalls.push(String(p && p.id)); };
  /* the app wires window.savePatients after this block; the batch flush
     resolves through it */
  ctx.window.savePatients = ctx.savePatients;
  return { ctx, store, fullFlag, syncCalls, toasts };
}
const pendingCount = (h) => [...h.store.data.keys()].filter(k => k.indexOf('pendingPtSync') >= 0).length;
const memPending = (h) => { try { const m = h.ctx.__mlsPtsPendingMirrorMemoryByKey || {}; return Object.keys(m).reduce((s, k) => s + Object.keys(m[k] || {}).length, 0); } catch (e) { return -1; } };
const tick = () => new Promise(r => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 80); i++) await tick(); }

/* ---- A: single ordinary edit -> exactly ONE enqueue, save lands, mirror runs ---- */
{
  const h = boot(SRC);
  h.ctx.upsertPatient({ id: 'p1', name: 'Adam Test', visits: [] });
  assert.strictEqual(pendingCount(h), 1, 'exactly one pending enqueue for a single ordinary edit (got ' + pendingCount(h) + ')');
  assert.strictEqual(h.syncCalls.length, 1, 'the immediate mirror still runs');
  const got = h.ctx.getPatients();
  assert.strictEqual(got.length, 1, 'the save landed');
  assert.strictEqual(got[0].name, 'Adam Test');
}

/* ---- B: 200-row batched pull -> ZERO pre-enqueues (and the zero is not vacuous:
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

/* ---- C-ls: AT QUOTA, PRE-MIGRATION (ls mode) - the SHIPPED contract holds
        unchanged for every user the owner-gated cutover has not reached ---- */
{
  const h = boot(SRC);
  h.ctx.upsertPatient({ id: 'pq', name: 'Before Edit', visits: [] });
  h.syncCalls.length = 0;
  h.fullFlag.full = true; /* hard quota: every setItem throws */
  let threw = false;
  try { h.ctx.upsertPatient({ id: 'pq', name: 'After Edit', visits: [] }); } catch (e) { threw = true; }
  assert.strictEqual(threw, true, 'quota still THROWS out of the save path (pinned contract)');
  assert.strictEqual(h.ctx.getPatients()[0].name, 'Before Edit', 'ls mode: the store serves pre-edit bytes (the local write was refused)');
  assert.ok(memPending(h) >= 1, 'THE EDIT IS NOT IN NO LOCATION: the pending mirror holds the id via the in-memory fallback (got ' + memPending(h) + ')');
  assert.ok(h.toasts.some(t => /could NOT be saved/i.test(t)), 'the failure is LOUD');
}

/* ---- D: NON-VACUITY - the OLD order reproduces the lost-edit signature by name ---- */
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
  assert.strictEqual(h.ctx.getPatients()[0].name, 'Before Edit', 'OLD order: store pre-edit - the queue-empty lost-edit signature, reproduced by name');
}

/* ---- C-idb: THE MOVED PIN (design Q1, quoted in the header) - AT QUOTA,
        POST-MIGRATION, the edit survives IN MEMORY, loudly, with the durable
        layer (journal + stamp) provably refused ---- */
(async function () {
  const saveStart = SRC.indexOf('function savePatients(arr,__storageKey,__opts){');
  const saveEnd = SRC.indexOf('var __mlsPtsBaseSavePatients=savePatients;', saveStart);
  assert.ok(saveStart >= 0 && saveEnd > saveStart, 'savePatients body located');
  assert.ok(SRC.slice(saveStart, saveEnd).indexOf('__psS.save(arr,__psSOpts);') >= 0,
    'PHASE-2 FENCE RE-ROUTE ABSENT: savePatients does not route idb-mode saves through the store ' +
    '(__psS.save(arr,__psSOpts); - the exact bytes patch-sj2-reroutes.js emits; re-anchored from the ' +
    'draft guess __mlsPtsStore.save( per INTEGRATION-ORDER.md conflict C1 adjudication, Commit B step 1). ' +
    'This MOVED suite may only replace quota-guard-edit-survives.test.js AT the re-route commit - keep the ' +
    'shipped suite registered until then.');

  const h = boot(SRC);
  const idb = makeIDB();
  h.ctx.window.__mlsPtsStore._t.setIdbFactory(idb);
  h.ctx.upsertPatient({ id: 'pq', name: 'Before Edit', visits: [] });
  await h.ctx.window.__mlsPtsStore.init();
  const rep = await h.ctx.window.__mlsPtsStore.migrate();
  assert.strictEqual(rep.migrated, true, 'cutover fixture: ' + JSON.stringify(rep.steps || rep));
  assert.strictEqual(h.ctx.getPatients()[0].name, 'Before Edit', 'idb-mode baseline serves the migrated roster');
  h.syncCalls.length = 0;

  const jBefore = h.store.data.get('t::ptsJournalV2') || null;
  const gBefore = h.store.data.get('t::ptsGenV2') || null;
  h.fullFlag.full = true; /* hard quota: every setItem throws - journal AND stamp refused */
  let threw = false;
  try { h.ctx.upsertPatient({ id: 'pq', name: 'After Edit', visits: [] }); } catch (e) { threw = true; }
  assert.strictEqual(threw, true, 'quota still THROWS out of the save path (the UNMOVED half of the contract)');
  assert.strictEqual(h.ctx.getPatients()[0].name, 'After Edit',
    'THE MOVED PIN: memory serves the POST-edit rows - "the edit now lives in the pending queue + memory" (design Q1)');
  assert.ok(memPending(h) >= 1, 'the pending mirror holds the id (enqueue-before-write already ran)');
  assert.ok(h.toasts.some(t => /could NOT be saved/i.test(t)), 'the failure is LOUD (unmoved)');
  assert.strictEqual(h.store.data.get('t::ptsJournalV2') || null, jBefore, 'the sync journal REFUSED - durable-layer bytes unchanged');
  assert.strictEqual(h.store.data.get('t::ptsGenV2') || null, gBefore, 'the gen stamp REFUSED - no phantom generation');

  h.fullFlag.full = false;
  await h.ctx.window.__mlsPtsStore.flushNow(); await settle();
  const stored = idb._stores.get('ptsBlobs').get('t::patients');
  assert.ok(stored && JSON.parse(stored.json)[0].name === 'After Edit',
    'the write-behind still carried the quota-refused edit to IndexedDB (the survival path)');

  console.log('quota-guard-edit-survives (sj2-moved): OK (1 enqueue per ordinary edit, 0 per 200-row batch, ' +
    'ls-mode quota keeps the shipped pre-edit contract, old order reproduces queue-empty by name, and the MOVED ' +
    'idb-mode pin holds: throw + loud + journal/stamp refused + POST-edit memory + IDB survival - no-catch and ' +
    'Array.isArray pinned, block/anchor integrity pinned)');
})().catch(e => { console.error('quota-guard-edit-survives (sj2-moved) FAILED:', e && e.stack || e); process.exit(1); });
