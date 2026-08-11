'use strict';
/* sj-2.0 SUITE 1/3: the __mlsPtsStore primitive CONTRACT, executed from the
   REAL ScribeFlow.html bytes post-integration (extraction-based, never a file
   copy - SHIPPED-ONLY law: a suite that runs a salvage copy reports fiction).
   Authoritative design: tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-
   design.md; primitive contract table: handoff-2026-08-11/salvage/sj2/
   primitive/NOTES.md. Registered form of the salvaged smoke harness, extended
   with executed non-vacuity controls (the byte-echo instrument is PROVEN to
   fire, not assumed).

   REGISTRATION TIMING: register in tests/run-all.js at the SAME commit as the
   primitive splice patcher (EXISTING IS NOT RUNNING - an unregistered fence
   never executes). Before the splice this suite fails loudly at the BEGIN
   marker - that failure IS the old-code-fails-the-new-test demonstration.

   NOT WEAKENED HERE (the six pre-registered criteria stand): acceptance bar,
   logout wipe zero-IDB-bytes, verified persist() grant, merge-receipt naming,
   labelled baselines, two-layer durability verifier with content read-back
   before journal truncation. This suite executes the primitive's share of
   criteria 2/3/6; the live acceptance run remains the design's own
   instrument. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'latin1');

function occurrences(hay, needle) { let n = 0, i = 0; for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; } }

/* ---- extraction: the block between its own unique markers ---- */
const BEGIN = '/* ===== BEGIN mls-pts-store (sj-2.0) ===== */';
const END = '/* ===== END mls-pts-store (sj-2.0) ===== */';
assert.strictEqual(occurrences(html, BEGIN), 1,
  'sj-2.0 primitive BEGIN marker: expected occurrence==1, found ' + occurrences(html, BEGIN) +
  '. If 0: the splice patcher has not run - this suite registers WITH the splice, never before.');
assert.strictEqual(occurrences(html, END), 1, 'sj-2.0 primitive END marker: expected occurrence==1');
const bi = html.indexOf(BEGIN), ei = html.indexOf(END);
assert.ok(ei > bi, 'END follows BEGIN');
const SRC = html.slice(bi, ei + END.length);

/* ---- position pins: the block sits INSIDE the window the other patient-store
   suites extract (quota-guard: __mlsLZ -> loadPatientsFromServer; rollback:
   __mlsLZ -> getActivePtId), immediately after the memo line the design names
   as the splice point ---- */
assert.strictEqual(occurrences(html, 'var __mlsPtsMemo=null;'), 1, 'memo splice anchor unique');
assert.ok(html.indexOf('var __mlsPtsMemo=null;') < bi, 'block sits AFTER the memo line');
assert.ok(html.indexOf('var __mlsLZ=(function(){') < bi, 'block inside the __mlsLZ extraction window');
assert.ok(ei < html.indexOf('async function loadPatientsFromServer'), 'block ends before loadPatientsFromServer');

/* ---- byte-travel pins (latin1 splice into a mixed-EOL file) ---- */
for (let i = 0; i < SRC.length; i++) {
  const c = SRC.charCodeAt(i);
  assert.ok(c === 9 || c === 10 || c === 13 || (c >= 32 && c <= 126),
    'NON-ASCII byte 0x' + c.toString(16) + ' at block offset ' + i + ' - the block must travel latin1 as ' +
    'printable ASCII. Known offender in the salvage draft: two raw 0x01 join separators in computeDelta; ' +
    'write them as the six-ASCII-char escape \\u0001 instead (behaviour-identical).');
}
assert.strictEqual(SRC.toLowerCase().indexOf('</script'), -1, 'no script-close sequence inside the block');

/* ---- cross-suite anchor guard: quota-guard-edit-survives.test.js locates the
   qg-2.0 splice with SRC.indexOf('qg-2.0') over a window that now CONTAINS
   this block, which sits BEFORE the real splice. If the block carries those
   bytes the registered suite anchors on a COMMENT and goes red at the splice
   commit. The salvage draft carries them 3x; the splice stage must render them
   as qg 2.0 (comment-only edit, zero behaviour). ---- */
assert.strictEqual(occurrences(SRC, 'qg-2.0'), 0,
  'the block contains the byte sequence qg-2.0 (' + occurrences(SRC, 'qg-2.0') + 'x) - it would steal ' +
  'the first-indexOf anchor of quota-guard-edit-survives.test.js. Render block comments as qg 2.0 before splicing.');

/* ---- naming pins from the design: retired v1 journal names banned; the
   qg-2.0 at-risk latch has ONE writer and this block is not it ---- */
assert.strictEqual(occurrences(SRC, '.pending-v1'), 0, 'retired journal name .pending-v1 absent from block');
assert.strictEqual(occurrences(SRC, '.commit-v1'), 0, 'retired journal name .commit-v1 absent from block');
assert.strictEqual(occurrences(SRC, '__mlsPtsEditAtRiskUnknown'), 0,
  'the block must not reference the at-risk latch at all (1 writer, 0 readers - qg-latch-has-no-reader-yet)');
assert.strictEqual(occurrences(SRC, 'window.__mlsPtsStore='), 1, 'exactly one __mlsPtsStore definition');

/* ---- the qg-2.0 splice survived the sj-2.0 splice byte-intact ---- */
assert.strictEqual(occurrences(html, 'if(backendMode() && bkToken() && p && p.id!=null){ _pendingSyncAdd(String(p.id)); }'), 1,
  'the qg-2.0 enqueue-before-write line is byte-intact, exactly once');
assert.strictEqual(occurrences(html, 'window.__mlsPtsEditAtRiskUnknown=true'), 1,
  'the latch writer is byte-intact, exactly once');

/* =========================================================================
 * harness: vm + fake localStorage (hook-injectable) + minimal fake IndexedDB
 * (house extraction style per tests/quota-guard-edit-survives.test.js /
 * salvage smoke.test.js)
 * ========================================================================= */
function makeLS(hooks) {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    getItem: k => {
      k = String(k);
      const base = data.has(k) ? data.get(k) : null;
      if (hooks.getLie) { const lie = hooks.getLie(k, base); if (lie != null) return lie; }
      return base;
    },
    setItem: (k, v) => {
      k = String(k); v = String(v);
      if (hooks.setFail && hooks.setFail(k, v)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; }
      data.set(k, v);
    },
    removeItem: k => {
      k = String(k);
      if (hooks.removeFail && hooks.removeFail(k)) throw new Error('removal refused');
      data.delete(k);
    },
  };
}
function makeIDB(persist, opts) {
  opts = opts || {};
  const stores = persist || new Map(); /* storeName -> Map(k->rec) */
  function req() { return { onsuccess: null, onerror: null, result: undefined, error: null }; }
  function makeDB() {
    return {
      close() {},
      objectStoreNames: { contains: n => stores.has(n) },
      transaction() {
        const tx = { oncomplete: null, onabort: null, onerror: null, error: null, _aborted: false };
        const stalled = !!(opts.stall && opts.stall.on);
        tx.abort = function () { tx._aborted = true; setImmediate(() => { tx.onabort && tx.onabort(); }); };
        tx.objectStore = function (n) {
          const m = stores.get(n);
          return {
            get(k) {
              const r = req(); if (stalled) return r;
              setImmediate(() => {
                if (tx._aborted) return;
                let rec = m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined;
                if (rec && opts.tamperRead && opts.tamperRead.on) rec.json = String(rec.json) + '~TAMPER';
                r.result = rec; r.onsuccess && r.onsuccess();
              });
              return r;
            },
            put(rec) { const r = req(); if (stalled) return r; setImmediate(() => { if (tx._aborted) return; m.set(rec.k, JSON.parse(JSON.stringify(rec))); r.onsuccess && r.onsuccess(); }); return r; },
            delete(k) { const r = req(); if (stalled) return r; setImmediate(() => { if (tx._aborted) return; m.delete(k); r.onsuccess && r.onsuccess(); }); return r; },
          };
        };
        if (!stalled) setImmediate(() => setImmediate(() => setImmediate(() => { if (!tx._aborted) { tx.oncomplete && tx.oncomplete(); } })));
        return tx;
      },
    };
  }
  return {
    _stores: stores,
    open() {
      const r = req(); r.onupgradeneeded = null; r.onblocked = null;
      if (opts.stall && opts.stall.on) return r; /* never settles */
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
function boot(opts) {
  opts = opts || {};
  const hooks = opts.hooks || {};
  const ls = opts.ls || makeLS(hooks);
  const toasts = []; const events = [];
  const win = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: ev => { events.push(ev && ev.type); return true; } };
  const ctx = {
    window: win, localStorage: ls,
    navigator: opts.navigator || {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, JSON, Math, Date, Array, Object, String, Number, Promise, RegExp, Error, TypeError, Map, Set,
    CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
    Event: function (t) { this.type = t; },
    uns: opts.uns || (k => 't::acct::' + k),
    toast: m => { toasts.push(String(m)); },
    _mlsPtsDecode: opts.decode,
  };
  ctx.window.localStorage = ls; ctx.window.navigator = ctx.navigator;
  ctx.window.__mlsBgSleep = () => Promise.resolve(); /* the proven sleeper: instant retries in vm */
  ctx.self = ctx.window; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'ScribeFlow:mls-pts-store' });
  const api = ctx.window.__mlsPtsStore;
  assert.ok(api && typeof api.init === 'function', 'the block defines window.__mlsPtsStore');
  if (opts.idb) api._t.setIdbFactory(opts.idb);
  return { ctx, ls, hooks, toasts, events, api };
}
const tick = () => new Promise(r => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 80); i++) await tick(); }
const J = 't::acct::ptsJournalV2', G = 't::acct::ptsGenV2', B = 't::acct::patients';

(async function () {
  /* ---- A: pre-migration boot stays ls-authoritative; reads/writes refuse ---- */
  {
    const h = boot({ idb: makeIDB() });
    h.ls.setItem(B, JSON.stringify([{ id: 'p1', name: 'Adam', visits: [] }]));
    const rec = await h.api.init();
    assert.strictEqual(rec.mode, 'ls', 'pre-migration boot is ls-authoritative');
    assert.throws(() => h.api.getRoster(), /not been migrated/i, 'getRoster refuses pre-migration');
    assert.throws(() => h.api.save([]), /not been migrated/i, 'save refuses pre-migration');
  }

  /* ---- B..H: the main walk on one store ---- */
  {
    const idb = makeIDB();
    /* persist() granted AND verified - the durability verdict comes from
       persisted() and lands on microtasks, before the first fake-IDB confirm */
    const h = boot({ idb, navigator: { storage: { persist: async () => true, persisted: async () => true, estimate: async () => ({ usage: 111, quota: 55555 }) } } });
    const rows = [{ id: 'p1', name: 'Adam', visits: [] }, { id: 'p2', name: 'Beth', visits: [] }];
    h.ls.setItem(B, JSON.stringify(rows));
    await h.api.init();

    /* B: migration success - byte-identical echo, journal+stamp live, blob REMOVED */
    const rep = await h.api.migrate();
    assert.strictEqual(rep.migrated, true, 'migration completed: ' + JSON.stringify(rep.steps));
    assert.strictEqual(h.ls.getItem(B), null, 'the localStorage blob is REMOVED at cutover');
    assert.ok(h.ls.getItem(J), 'journal live');
    assert.ok(h.ls.getItem(G), 'gen stamp live');
    assert.strictEqual(h.api.mode(), 'idb');
    assert.strictEqual(h.api.getRoster().length, 2, 'roster served from memory');
    assert.strictEqual(idb._stores.get('ptsBlobs').get(B).json, JSON.stringify(rows),
      'BYTE-IDENTICAL echo: the IndexedDB copy is the exact blob bytes');

    /* C: saveSync = pinned contract (returns undefined, same-tick read-after-write,
       dirty-only journal entry readable back same tick, gen stamp bumped) */
    const r2 = h.api.getRoster().slice();
    r2[0] = Object.assign({}, r2[0], { name: 'Adam Edited' });
    const out = h.api.save(r2, { dirtyIds: ['p1'] });
    assert.strictEqual(out, undefined, 'save returns undefined (pinned contract)');
    assert.strictEqual(h.api.getRoster()[0].name, 'Adam Edited', 'sync read-after-write same tick');
    const j1 = JSON.parse(h.ls.getItem(J));
    assert.strictEqual(j1.entries.length, 1, 'one journal entry');
    assert.strictEqual(j1.entries[0].p.length, 1, 'entry carries ONLY the dirty patient');
    assert.strictEqual(j1.entries[0].p[0].name, 'Adam Edited', 'layer-a durable: the edit is READABLE from the sync store same tick');
    assert.ok(/^2\|/.test(h.ls.getItem(G)), 'gen stamp bumped to 2');

    /* D: write-behind confirm = txn complete + CONTENT read-back; only then truncation */
    await settle();
    await h.api.flushNow(); await settle();
    const j2 = JSON.parse(h.ls.getItem(J));
    assert.strictEqual(j2.entries.length, 0, 'journal truncated ONLY after IDB confirm (grant verified => no ballast)');
    assert.strictEqual(j2.baseGen, 2, 'baseGen moved to the confirmed generation');
    const stored = idb._stores.get('ptsBlobs').get(B);
    assert.ok(stored && stored.gen === 2 && JSON.parse(stored.json)[0].name === 'Adam Edited', 'IDB blob carries the confirmed content');
    assert.strictEqual(stored.hash, h.api._t.hashSync(stored.json), 'stored hash matches recomputed content hash (Q3 layer b)');
    const rcp = h.api.receipt();
    assert.strictEqual(rcp.durable.persisted, true, 'persist verdict recorded from persisted()');
    assert.deepStrictEqual({ u: rcp.durable.estimate.usage, q: rcp.durable.estimate.quota }, { u: 111, q: 55555 }, 'estimate() observed, not inferred');

    /* E: journal-write failure THROWS (pinned) but the edit SURVIVES - the
       design-authorized MOVE of the old store-serves-pre-edit-bytes pin:
       memory serves the POST-edit rows, loudly, journal refused */
    h.hooks.setFail = () => true;
    const jBytesBefore = h.ls.getItem(J);
    const r3 = h.api.getRoster().slice();
    r3[0] = Object.assign({}, r3[0], { name: 'After Quota Edit' });
    let threw = false;
    try { h.api.save(r3, { dirtyIds: ['p1'] }); } catch (e) { threw = true; }
    assert.strictEqual(threw, true, 'quota still THROWS out of the save path (pinned contract)');
    assert.strictEqual(h.api.getRoster()[0].name, 'After Quota Edit', 'Q1: the edit is NOT stranded - memory holds it');
    assert.ok(h.toasts.some(t => /could NOT be saved/i.test(t)), 'the failure is LOUD (the phrase the qg suite greps)');
    assert.strictEqual(h.ls.getItem(J), jBytesBefore, 'the journal REFUSED - durable layer bytes unchanged');
    h.hooks.setFail = null;
    await h.api.flushNow(); await settle();
    assert.ok(JSON.parse(idb._stores.get('ptsBlobs').get(B).json)[0].name === 'After Quota Edit',
      'the write-behind still carried the quota-refused edit to IDB');

    /* E2: a single oversized delta refuses as JOURNAL_FULL, names the async
       path, and still survives (Q1 bound arithmetic executed) */
    const r4 = h.api.getRoster().slice();
    r4.unshift({ id: 'p3', name: 'Big Row', payload: 'x'.repeat(300 * 1024), visits: [] });
    let code = '';
    try { h.api.save(r4, { dirtyIds: ['p3'] }); } catch (e) { code = e.code; assert.ok(/async path|journal/i.test(String(e.message)), 'refusal names the bound'); }
    assert.strictEqual(code, 'MLS_PTS_JOURNAL_FULL', 'oversized delta refuses with the journal-full code');
    assert.ok(h.api.getRoster().some(r => r.id === 'p3'), 'memory holds the oversized edit');
    await h.api.flushNow(); await settle();
    assert.ok(JSON.parse(idb._stores.get('ptsBlobs').get(B).json).some(r => r.id === 'p3'), 'write-behind carried it to IDB');

    /* F: saveAsync (bulk) - memory immediate, NO journal entry (deliberate gen
       gap), resolution is the IndexedDB confirm */
    const jBytesPreBulk = h.ls.getItem(J);
    const bulk = h.api.getRoster().slice();
    for (let i = 0; i < 3; i++) bulk.push({ id: 'bulk' + i, name: 'Bulk ' + i, visits: [] });
    const p = h.api.saveAsync(bulk, { dirtyIds: ['bulk0', 'bulk1', 'bulk2'] });
    assert.ok(h.api.getRoster().some(r => r.id === 'bulk2'), 'saveAsync commits memory immediately');
    assert.strictEqual(h.ls.getItem(J), jBytesPreBulk, 'saveAsync writes NO sync journal entry (the gap is the signal)');
    const conf = await p;
    assert.strictEqual(conf.saved, true, 'saveAsync resolves on confirm');
    await settle();
    assert.ok(JSON.parse(idb._stores.get('ptsBlobs').get(B).json).some(r => r.id === 'bulk2'), 'bulk content confirmed in IDB');

    /* G: cold reload hydrates blob + replays journal behind the ready-barrier */
    const h2 = boot({ idb: makeIDB(idb._stores), ls: h.ls, hooks: h.hooks });
    const boot2 = await h2.api.init();
    assert.strictEqual(boot2.mode, 'idb', 'post-migration boot hydrates from IDB');
    assert.strictEqual(h2.api.getRoster().filter(r => r.name === 'After Quota Edit').length, 1, 'cold reload serves the confirmed content');
    assert.ok(h2.api.getRoster().some(r => r.id === 'bulk1'), 'cold reload includes the bulk save');
    assert.strictEqual(h2.api.receipt().key.indexOf('acct'), -1, 'receipt is PHI-free: account prefix hashed');

    /* H: wipe leaves ZERO patient bytes, PROVEN by read-back (Q2, blocking) */
    const w = await h2.api.wipe();
    assert.strictEqual(w.verifiedEmpty, true, 'Q2: wipe verified empty by read-back');
    assert.strictEqual(h.ls.getItem(J), null, 'journal key gone');
    assert.strictEqual(h.ls.getItem(G), null, 'gen key gone');
    assert.strictEqual(idb._stores.get('ptsBlobs').has(B), false, 'IDB record gone');
  }

  /* ---- H2: wipe with IndexedDB unavailable = NO PROOF, NO GREEN ---- */
  {
    const h = boot({}); /* no idb factory, no window.indexedDB */
    h.ls.setItem(J, '{"v":2,"baseGen":0,"entries":[]}');
    const w = await h.api.wipe();
    assert.strictEqual(w.verifiedEmpty, false, 'fail-closed: unprovable wipe is never green');
    assert.strictEqual(w.idbUnavailable, true, 'the receipt names the reason');
  }

  /* ---- I: unresolved-namespace refusal (the sf_u::undefined class) ---- */
  for (const bad of ['sf_u::undefined::', 'sf_u::_::']) {
    const h = boot({ idb: makeIDB(), uns: k => bad + k });
    let refused = false;
    await h.api.init().catch(e => { refused = /NO_NAMESPACE/.test(e.code || ''); });
    assert.strictEqual(refused, true, 'unresolved namespace ' + bad + ' refused');
  }

  /* ---- J: EXECUTED NON-VACUITY - the same-tick byte echo is a real
     instrument. A store that LIES on the echo read (returns different bytes
     than were written) must be caught: 4 CAS rounds, then a LOUD contention
     throw - never a quiet acceptance. ---- */
  {
    const idb = makeIDB();
    const h = boot({ idb });
    h.ls.setItem(B, JSON.stringify([{ id: 'p1', name: 'Adam', visits: [] }]));
    await h.api.init();
    assert.strictEqual((await h.api.migrate()).migrated, true, 'control migrate');
    const lie = { on: false };
    h.hooks.getLie = (k, base) => (lie.on && k === J && base != null) ? base + '~LIE' : null;
    lie.on = true;
    const r2 = h.api.getRoster().slice();
    r2[0] = Object.assign({}, r2[0], { name: 'Echo Lie Edit' });
    let code = '';
    try { h.api.save(r2, { dirtyIds: ['p1'] }); } catch (e) { code = e.code; }
    assert.strictEqual(code, 'MLS_PTS_STORE_CONTENTION', 'a lying echo is refused as contention, not accepted');
    assert.ok(h.toasts.some(t => /cross-tab conflict/i.test(t)), 'contention is LOUD');
    assert.strictEqual(h.api.getRoster()[0].name, 'Echo Lie Edit', 'memory still holds the edit');
    lie.on = false;
    await h.api.flushNow(); await settle();
    assert.strictEqual(JSON.parse(idb._stores.get('ptsBlobs').get(B).json)[0].name, 'Echo Lie Edit',
      'the survival path (write-behind) still carried the edit');
  }

  console.log('sj2-pts-store-contract: OK (block position + ASCII + cross-anchor pins, ls-mode guards, ' +
    'byte-identical migrate, undefined-save + same-tick read-after-write + dirty-only journal, confirm-then-truncate ' +
    'with content hash, quota edit survives loudly with journal refused, oversized delta refuses as JOURNAL_FULL, ' +
    'saveAsync gap semantics, cold-reload replay, wipe proven empty + unprovable wipe never green, namespace refusal, ' +
    'lying echo caught as loud contention)');
})().catch(e => { console.error('sj2-pts-store-contract FAILED:', e && e.stack || e); process.exit(1); });
