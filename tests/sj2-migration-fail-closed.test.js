'use strict';
/* sj-2.0 SUITE 2/3: THE MIGRATION IS FAIL-CLOSED AT EVERY STEP. The design's
   cutover law (tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md):
   "one-shot, fail-closed: read blob -> write IDB -> byte-identical echo verify
   -> journal live -> only then remove the blob. Anything short of a verified
   echo keeps localStorage authoritative and reports."

   This suite REFUSES each step in turn against the REAL block extracted from
   ScribeFlow.html bytes and proves, for every refusal: (a) migrated:false and
   the receipt NAMES the refusing step; (b) the localStorage blob is BYTE-
   IDENTICAL untouched; (c) no partial journal/stamp/IDB writes survive;
   (d) the store stays 'ls' (localStorage authoritative). The success control
   runs first so the refusals are not vacuous, and a refused run is proven
   RETRYABLE (fail-closed leaves a cleanly re-runnable state). The both-
   present anomaly (rollback re-created the blob after a cutover) fails closed
   to 'ls' and migrate() reconciles with the BLOB winning - localStorage stays
   authoritative, exactly as the design orders.

   REGISTRATION TIMING: register with the primitive splice (same commit as
   sj2-pts-store-contract.test.js). Fails loudly pre-splice by design. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'ScribeFlow.html'), 'latin1');
function occurrences(hay, needle) { let n = 0, i = 0; for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; } }
const BEGIN = '/* ===== BEGIN mls-pts-store (sj-2.0) ===== */';
const END = '/* ===== END mls-pts-store (sj-2.0) ===== */';
assert.strictEqual(occurrences(html, BEGIN), 1, 'sj-2.0 primitive BEGIN marker: occurrence==1 (run the splice patcher first)');
assert.strictEqual(occurrences(html, END), 1, 'sj-2.0 primitive END marker: occurrence==1');
const SRC = html.slice(html.indexOf(BEGIN), html.indexOf(END) + END.length);

/* ---- harness (house extraction style; hooks allow per-key refusals) ---- */
function makeLS(hooks) {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    getItem: k => { k = String(k); const base = data.has(k) ? data.get(k) : null; if (hooks.getLie) { const lie = hooks.getLie(k, base); if (lie != null) return lie; } return base; },
    setItem: (k, v) => { k = String(k); v = String(v); if (hooks.setFail && hooks.setFail(k, v)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } data.set(k, v); },
    removeItem: k => { k = String(k); if (hooks.removeFail && hooks.removeFail(k)) throw new Error('removal refused'); data.delete(k); },
  };
}
function makeIDB(persist, opts) {
  opts = opts || {};
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
            get(k) { const r = req(); setImmediate(() => { if (tx._aborted) return; let rec = m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined; if (rec && opts.tamperRead && opts.tamperRead.on) rec.json = String(rec.json) + '~TAMPER'; r.result = rec; r.onsuccess && r.onsuccess(); }); return r; },
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
function boot(opts) {
  opts = opts || {};
  const hooks = opts.hooks || {};
  const ls = opts.ls || makeLS(hooks);
  const toasts = [];
  const win = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => true };
  const ctx = {
    window: win, localStorage: ls, navigator: opts.navigator || {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, JSON, Math, Date, Array, Object, String, Number, Promise, RegExp, Error, TypeError, Map, Set,
    CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
    Event: function (t) { this.type = t; },
    uns: k => 't::acct::' + k,
    toast: m => { toasts.push(String(m)); },
    _mlsPtsDecode: opts.decode,
  };
  ctx.window.localStorage = ls; ctx.window.navigator = ctx.navigator;
  ctx.window.__mlsBgSleep = () => Promise.resolve();
  ctx.self = ctx.window; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'ScribeFlow:mls-pts-store' });
  const api = ctx.window.__mlsPtsStore;
  if (opts.idb) api._t.setIdbFactory(opts.idb);
  return { ctx, ls, hooks, toasts, api };
}
const tick = () => new Promise(r => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 80); i++) await tick(); }
const J = 't::acct::ptsJournalV2', G = 't::acct::ptsGenV2', B = 't::acct::patients';
const ROWS = [{ id: 'p1', name: 'Adam', visits: [] }, { id: 'p2', name: 'Beth', visits: [] }];

function assertFailClosed(h, rep, blobBytes, stepName) {
  assert.strictEqual(rep.migrated, false, stepName + ': migration must refuse');
  const failing = (rep.steps || []).filter(s => s.ok === false);
  assert.ok(failing.length >= 1, stepName + ': the receipt records a failing step');
  assert.strictEqual(failing[failing.length - 1].step, stepName, 'the receipt NAMES the refusing step (' + JSON.stringify(rep.steps) + ')');
  assert.strictEqual(h.ls.getItem(B), blobBytes, stepName + ': the blob is BYTE-IDENTICAL untouched');
  assert.strictEqual(h.ls.data.get(J) === undefined ? null : h.ls.data.get(J), null, stepName + ': no partial journal left behind');
  assert.strictEqual(h.ls.data.get(G) === undefined ? null : h.ls.data.get(G), null, stepName + ': no partial gen stamp left behind');
  assert.strictEqual(h.api.mode(), 'ls', stepName + ': localStorage stays authoritative');
  assert.throws(() => h.api.getRoster(), /not been migrated/i, stepName + ': reads still refuse (no half-open store)');
}

(async function () {
  /* ---- 0: SUCCESS CONTROL (the refusals below are not vacuous) ---- */
  {
    const idb = makeIDB();
    const h = boot({ idb });
    const raw = JSON.stringify(ROWS);
    h.ls.setItem(B, raw);
    await h.api.init();
    const rep = await h.api.migrate();
    assert.strictEqual(rep.migrated, true, 'control: migration succeeds: ' + JSON.stringify(rep.steps));
    /* joined-string compare: rep is a vm-realm object, so a host-side
       deepStrictEqual would fail on Array prototypes, not content */
    const names = Array.prototype.map.call(rep.steps, s => s.step).join('>');
    assert.strictEqual(names, 'read-blob>parse>idb-write>idb-echo-byte-identical>journal-live>gen-stamp>remove-blob',
      'the full verified step chain ran, in order (got ' + names + ')');
    assert.ok(rep.steps.every(s => s.ok === true), 'every step green');
    assert.strictEqual(idb._stores.get('ptsBlobs').get(B).json, raw, 'byte-identical echo held');
    assert.strictEqual(h.ls.getItem(B), null, 'blob removed ONLY at the end');
    assert.strictEqual(h.api.mode(), 'idb');
  }

  /* ---- 1: decode refusal ---- */
  {
    const h = boot({ idb: makeIDB(), decode: () => { throw new Error('decode boom'); } });
    const raw = 'MLSZ1|opaque-compressed-bytes';
    h.ls.setItem(B, raw);
    await h.api.init();
    const rep = await h.api.migrate();
    assertFailClosed(h, rep, raw, 'decode');
  }

  /* ---- 2: parse refusal - not an array (two shapes) ---- */
  for (const raw of ['{not-an-array', '"a json string, not a roster"']) {
    const h = boot({ idb: makeIDB() });
    h.ls.setItem(B, raw);
    await h.api.init();
    const rep = await h.api.migrate();
    assertFailClosed(h, rep, raw, 'parse');
    assert.ok(/REFUSING/i.test(rep.steps[rep.steps.length - 1].detail), 'parse refusal says so in the detail');
  }

  /* ---- 3: IndexedDB unavailable - the write step cannot run ---- */
  {
    const h = boot({}); /* no idb factory anywhere */
    const raw = JSON.stringify(ROWS);
    h.ls.setItem(B, raw);
    await h.api.init();
    const rep = await h.api.migrate();
    assertFailClosed(h, rep, raw, 'exception');
    assert.ok(/IndexedDB/i.test(rep.steps[rep.steps.length - 1].detail), 'the exception detail names IndexedDB');
  }

  /* ---- 4: IDB echo mismatch - the stored copy is NOT byte-identical.
     EXECUTED NON-VACUITY for the echo instrument: a store that accepts the
     write but returns different bytes must be refused. ---- */
  {
    const idb = makeIDB(null, { tamperRead: { on: true } });
    const h = boot({ idb });
    const raw = JSON.stringify(ROWS);
    h.ls.setItem(B, raw);
    await h.api.init();
    const rep = await h.api.migrate();
    assertFailClosed(h, rep, raw, 'idb-echo-byte-identical');
    await settle();
    assert.strictEqual(idb._stores.get('ptsBlobs').has(B), false, 'the partial IDB write was cleaned up');
  }

  /* ---- 5: journal-live refusal (quota on the journal key) ---- */
  {
    const idb = makeIDB();
    const h = boot({ idb });
    const raw = JSON.stringify(ROWS);
    h.ls.setItem(B, raw);
    h.hooks.setFail = k => k === J;
    await h.api.init();
    const rep = await h.api.migrate();
    assertFailClosed(h, rep, raw, 'journal-live');
    await settle();
    assert.strictEqual(idb._stores.get('ptsBlobs').has(B), false, 'the already-written IDB record was cleaned up');

    /* ---- 5b: fail-closed leaves a RETRYABLE state ---- */
    h.hooks.setFail = null;
    const rep2 = await h.api.migrate();
    assert.strictEqual(rep2.migrated, true, 'after the refusal heals, the SAME store migrates cleanly: ' + JSON.stringify(rep2.steps));
    assert.strictEqual(h.ls.getItem(B), null, 'blob removed on the successful retry');
  }

  /* ---- 6: gen-stamp refusal (journal landed, stamp refused - the partial
     journal must NOT survive) ---- */
  {
    const idb = makeIDB();
    const h = boot({ idb });
    const raw = JSON.stringify(ROWS);
    h.ls.setItem(B, raw);
    h.hooks.setFail = k => k === G;
    await h.api.init();
    const rep = await h.api.migrate();
    assertFailClosed(h, rep, raw, 'gen-stamp');
  }

  /* ---- 7: remove-blob refusal (everything landed but the blob will not
     leave) - still fail-closed: OWN writes rolled back, blob stays, ls stays
     authoritative. A cutover that cannot delete the blob must not flip, or
     the next boot sees both-present with the store already claiming idb. ---- */
  {
    const idb = makeIDB();
    const h = boot({ idb });
    const raw = JSON.stringify(ROWS);
    h.ls.setItem(B, raw);
    h.hooks.removeFail = k => k === B;
    await h.api.init();
    const rep = await h.api.migrate();
    assertFailClosed(h, rep, raw, 'remove-blob');
    await settle();
    assert.strictEqual(idb._stores.get('ptsBlobs').has(B), false, 'IDB record rolled back');
  }

  /* ---- 8: BOTH-PRESENT ANOMALY fails closed to ls; migrate() reconciles
     with the BLOB winning (design: "a present blob can be NEWER than the
     IndexedDB copy (a rolled-back build re-created it). FAIL CLOSED:
     localStorage stays authoritative; migrate() reconciles by re-running the
     verified cutover.") ---- */
  {
    const staleIdbRows = [{ id: 'stale1', name: 'Stale Idb Row', visits: [] }];
    const stores = new Map([['ptsBlobs', new Map([[B, { k: B, gen: 5, len: JSON.stringify(staleIdbRows).length, hash: '', at: 1, tab: 'zz', json: JSON.stringify(staleIdbRows) }]])]]);
    const idb = makeIDB(stores);
    const h = boot({ idb });
    const raw = JSON.stringify(ROWS);
    h.ls.setItem(B, raw);
    const rec = await h.api.init();
    assert.strictEqual(rec.mode, 'ls', 'both-present boots ls-authoritative');
    assert.strictEqual(rec.anomaly, 'both-blob-and-idb-present', 'the anomaly is NAMED in the boot receipt');
    assert.throws(() => h.api.getRoster(), /not been migrated/i, 'no read is served from the ambiguous pair');
    const rep = await h.api.migrate();
    assert.strictEqual(rep.migrated, true, 'migrate() reconciles: ' + JSON.stringify(rep.steps));
    assert.strictEqual(h.api.getRoster().length, 2, 'the BLOB rows won');
    assert.ok(!h.api.getRoster().some(r => r.id === 'stale1'), 'the stale IDB copy was overwritten, not adopted');
    assert.strictEqual(stores.get('ptsBlobs').get(B).json, raw, 'IDB now carries the blob bytes, byte-identical');
    assert.strictEqual(h.ls.getItem(B), null, 'blob removed after the verified re-cutover');
  }

  console.log('sj2-migration-fail-closed: OK (success control with full step chain, decode/parse/idb-unavailable/' +
    'idb-echo/journal/gen-stamp/remove-blob refusals each leave the blob byte-identical + zero partials + ls ' +
    'authoritative + the refusing step named, refused run proven retryable, both-present anomaly named and ' +
    'reconciled with the blob winning)');
})().catch(e => { console.error('sj2-migration-fail-closed FAILED:', e && e.stack || e); process.exit(1); });
