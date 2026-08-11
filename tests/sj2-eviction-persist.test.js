'use strict';
/* sj-2.0 SUITE 3/3: INDEXEDDB IS EVICTABLE - THE GRANT IS VERIFIED, DENIAL IS
   LOUD, RETENTION TURNS CONSERVATIVE. Design Q5 (tests/live-e2e-artifacts/
   2026-08-11-sj2-patients-idb-design.md), adopted verbatim and PRE-REGISTERED:
   "call navigator.storage.persist(); VERIFY the grant with
   navigator.storage.persisted() rather than trusting the request; record the
   verdict in the store's receipt; define denied-grant behaviour - on denial
   the store declares itself non-durable LOUDLY ... journal truncation becomes
   conservative ... and log navigator.storage.estimate() at boot so
   quota/usage are observed, not inferred."

   Executed here against the REAL block from ScribeFlow.html bytes:
   - the verdict comes from persisted() ONLY - a granted persist() with a
     false persisted() is DENIED, and a rejecting persist() with a true
     persisted() is GRANTED (both directions, so the pin is not vacuous);
   - denial/unsupported/unverifiable are LOUD (toast + receipt) and flip
     journal truncation to conservative ballast retention, bounded by the
     64KB high-water mark;
   - the granted/denied pair asserts OPPOSITE truncation outcomes on
     otherwise identical stores - the retention branch is the discriminator,
     not a constant;
   - the evicted-blob boot (journal + stamp present, blob gone) reconstructs
     what the journal proves, latches degraded LOUDLY, and re-persists;
   - the degraded latch is a SESSION LATCH: a healed write-behind resumes
     moving data but the incident stays visible (the transient-fault-dressed-
     as-verdict class, refused by construction).

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

/* ---- harness (house extraction style) ---- */
function makeLS(hooks) {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key: i => [...data.keys()][i] ?? null,
    getItem: k => (data.has(String(k)) ? data.get(String(k)) : null),
    setItem: (k, v) => { k = String(k); v = String(v); if (hooks.setFail && hooks.setFail(k, v)) { const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e; } data.set(k, v); },
    removeItem: k => { data.delete(String(k)); },
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
  const toasts = []; const events = [];
  const win = { addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: ev => { events.push(ev && ev.type); return true; } };
  const ctx = {
    window: win, localStorage: ls, navigator: opts.navigator || {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console, JSON, Math, Date, Array, Object, String, Number, Promise, RegExp, Error, TypeError, Map, Set,
    CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
    Event: function (t) { this.type = t; },
    uns: k => 't::acct::' + k,
    toast: m => { toasts.push(String(m)); },
  };
  ctx.window.localStorage = ls; ctx.window.navigator = ctx.navigator;
  ctx.window.__mlsBgSleep = () => Promise.resolve();
  ctx.self = ctx.window; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: 'ScribeFlow:mls-pts-store' });
  const api = ctx.window.__mlsPtsStore;
  if (opts.idb) api._t.setIdbFactory(opts.idb);
  return { ctx, ls, hooks, toasts, events, api };
}
const tick = () => new Promise(r => setImmediate(r));
async function settle(n) { for (let i = 0; i < (n || 100); i++) await tick(); }
const J = 't::acct::ptsJournalV2', G = 't::acct::ptsGenV2', B = 't::acct::patients';
const ROWS = [{ id: 'p1', name: 'Adam', visits: [] }, { id: 'p2', name: 'Beth', visits: [] }];
const DENIED_NAV = () => ({ storage: { persist: async () => true, persisted: async () => false, estimate: async () => ({ usage: 4321, quota: 99999 }) } });
const GRANTED_NAV = () => ({ storage: { persist: async () => { throw new Error('request refused'); }, persisted: async () => true, estimate: async () => ({ usage: 1, quota: 2 }) } });

async function migrated(h) {
  h.ls.setItem(B, JSON.stringify(ROWS));
  await h.api.init();
  const rep = await h.api.migrate();
  assert.strictEqual(rep.migrated, true, 'fixture migrate: ' + JSON.stringify(rep.steps));
  return h;
}
function saveEdit(h, name, extra) {
  const r = h.api.getRoster().slice();
  r[0] = Object.assign({}, r[0], { name: name }, extra || {});
  h.api.save(r, { dirtyIds: ['p1'] });
}

(async function () {
  /* ---- 1: persist() says yes, persisted() says NO => DENIED. The verdict
     comes from persisted() ONLY; denial is loud; estimate is observed. ---- */
  {
    const h = boot({ idb: makeIDB(), navigator: DENIED_NAV() });
    h.ls.setItem(B, JSON.stringify(ROWS));
    await h.api.init(); await settle();
    const d = h.api.receipt().durable;
    assert.strictEqual(d.requested, true, 'persist() was requested');
    assert.strictEqual(d.persisted, false, 'the verdict is persisted()\'s false, NOT persist()\'s true');
    assert.strictEqual(d.why, 'denied', 'denial named');
    assert.ok(h.toasts.some(t => /durable storage/i.test(t)), 'denial is LOUD');
    assert.ok(h.events.indexOf('mls:pts-store-durability') >= 0, 'durability verdict event fired');
    assert.deepStrictEqual({ u: d.estimate.usage, q: d.estimate.quota }, { u: 4321, q: 99999 }, 'estimate() logged at boot - observed, not inferred');
  }

  /* ---- 2: persist() REJECTS, persisted() says YES => GRANTED (the other
     direction of verdict-from-persisted-only; proves 1 was not vacuous) ---- */
  {
    const h = boot({ idb: makeIDB(), navigator: GRANTED_NAV() });
    h.ls.setItem(B, JSON.stringify(ROWS));
    await h.api.init(); await settle();
    const d = h.api.receipt().durable;
    assert.strictEqual(d.persisted, true, 'the verdict is persisted()\'s true even though persist() rejected');
    assert.ok(!h.toasts.some(t => /durable storage/i.test(t)), 'no false alarm on a verified grant');
  }

  /* ---- 3: unsupported (no navigator.storage) => null verdict, treated as
     denied (the safe direction), loud ---- */
  {
    const h = boot({ idb: makeIDB(), navigator: {} });
    h.ls.setItem(B, JSON.stringify(ROWS));
    await h.api.init(); await settle();
    const d = h.api.receipt().durable;
    assert.strictEqual(d.persisted, null, 'unsupported records null, never a guessed true');
    assert.strictEqual(d.why, 'unsupported');
    assert.ok(h.toasts.some(t => /durable storage/i.test(t)), 'unsupported is loud too');
  }

  /* ---- 4: persisted() THROWS => unverifiable, treated as denied, loud ---- */
  {
    const h = boot({ idb: makeIDB(), navigator: { storage: { persist: async () => true, persisted: async () => { throw new Error('no verdict'); } } } });
    h.ls.setItem(B, JSON.stringify(ROWS));
    await h.api.init(); await settle();
    const d = h.api.receipt().durable;
    assert.strictEqual(d.persisted, null, 'unverifiable never counts as granted');
    assert.strictEqual(d.why, 'unverifiable');
    assert.ok(h.toasts.some(t => /durable storage/i.test(t)), 'unverifiable is loud');
  }

  /* ---- 5: THE DISCRIMINATOR PAIR - identical stores, opposite verdicts,
     OPPOSITE truncation outcomes ---- */
  {
    const den = await migrated(boot({ idb: makeIDB(), navigator: DENIED_NAV() }));
    await settle(); /* verdict lands before the pump confirms */
    saveEdit(den, 'Adam Edited');
    await den.api.flushNow(); await settle();
    const jd = JSON.parse(den.ls.getItem(J));
    assert.strictEqual(jd.baseGen, 2, 'denied: confirm still moved baseGen');
    assert.strictEqual(jd.entries.length, 1, 'DENIED: the confirmed entry is RETAINED as recovery ballast');

    const gra = await migrated(boot({ idb: makeIDB(), navigator: GRANTED_NAV() }));
    await settle();
    saveEdit(gra, 'Adam Edited');
    await gra.api.flushNow(); await settle();
    const jg = JSON.parse(gra.ls.getItem(J));
    assert.strictEqual(jg.baseGen, 2, 'granted: confirm moved baseGen');
    assert.strictEqual(jg.entries.length, 0, 'GRANTED: confirmed entries are dropped - the retention branch is the discriminator');
  }

  /* ---- 6: ballast is BOUNDED by the 64KB high-water mark and keeps the
     NEWEST confirmed entries ---- */
  {
    const h = await migrated(boot({ idb: makeIDB(), navigator: DENIED_NAV() }));
    await settle();
    for (let i = 0; i < 3; i++) {
      saveEdit(h, 'Bulk Edit ' + i, { payload: 'x'.repeat(30 * 1024) });
      await h.api.flushNow(); await settle();
    }
    const j = JSON.parse(h.ls.getItem(J));
    assert.ok(h.ls.getItem(J).length <= 64 * 1024, 'retained ballast stays under the high-water mark (' + h.ls.getItem(J).length + ' units)');
    assert.ok(j.entries.length >= 1, 'some ballast retained');
    const gens = j.entries.map(e => Number(e.gen));
    assert.deepStrictEqual(gens, gens.slice().sort((a, b) => a - b), 'ballast ordered');
    assert.strictEqual(gens[gens.length - 1], h.api.receipt().gen, 'the NEWEST confirmed entry is kept (recovery replays the freshest state)');
  }

  /* ---- 7: EVICTED-BLOB BOOT - journal + stamp present, blob gone. The store
     serves what the journal proves, latches degraded LOUDLY, re-persists. ---- */
  {
    const hooks = {};
    const ls = makeLS(hooks);
    const entries = [
      { gen: 1, tab: 'othertab', at: 1, p: [{ id: 'e1', name: 'Evicted Survivor One', updated: 1 }] },
      { gen: 2, tab: 'othertab', at: 2, p: [{ id: 'e2', name: 'Evicted Survivor Two', updated: 2 }] },
    ];
    ls.setItem(J, JSON.stringify({ v: 2, baseGen: 0, entries: entries }));
    ls.setItem(G, '2|othertab|2');
    const idb = makeIDB(); /* empty: the blob was evicted */
    const h = boot({ idb, ls, hooks });
    const rec = await h.api.init();
    assert.strictEqual(rec.mode, 'idb', 'evicted boot still serves the idb-mode store');
    assert.strictEqual(rec.evicted, true, 'the receipt NAMES the eviction');
    assert.strictEqual(rec.rows, 2, 'the journal-proven rows are served');
    assert.strictEqual(h.api.receipt().degraded, true, 'degraded is LATCHED');
    assert.ok(h.toasts.some(t => /degraded safety mode/i.test(t)), 'eviction is LOUD, never silent');
    assert.strictEqual(h.api.getRoster().length, 2, 'reads work on the reconstruction');
    await settle();
    const reblob = idb._stores.get('ptsBlobs').get(B);
    assert.ok(reblob && JSON.parse(reblob.json).length === 2, 'the reconstruction was RE-PERSISTED to IndexedDB');
  }

  /* ---- 8: the degraded latch is a SESSION LATCH - a healed write-behind
     resumes moving data (failures reset, truncation resumes) but the incident
     stays visible; bulk saves refuse while degraded ---- */
  {
    const tamper = { on: false };
    const idb = makeIDB(null, { tamperRead: tamper });
    const h = await migrated(boot({ idb, navigator: GRANTED_NAV() }));
    await settle();
    tamper.on = true; /* every echo read-back now lies -> confirm impossible */
    saveEdit(h, 'Edit During Outage');
    let waited = 0;
    while (h.api.receipt().wbFailures < 3 && waited++ < 200) await tick();
    assert.ok(h.api.receipt().wbFailures >= 3, 'three consecutive write-behind failures observed (got ' + h.api.receipt().wbFailures + ')');
    assert.strictEqual(h.api.receipt().degraded, true, 'degraded latched');
    assert.ok(h.toasts.some(t => /degraded safety mode/i.test(t)), 'degradation is LOUD');
    assert.ok(JSON.parse(h.ls.getItem(J)).entries.length >= 1, 'the journal RETAINS the unconfirmed edit (nothing dropped)');
    let bulkRefused = false;
    await h.api.saveAsync(h.api.getRoster().slice(), {}).catch(e => { bulkRefused = /DEGRADED/.test(e.code || ''); });
    assert.strictEqual(bulkRefused, true, 'bulk saves refuse while degraded (they cannot confirm)');
    tamper.on = false; /* the outage heals */
    await h.api.flushNow(); await settle();
    assert.strictEqual(h.api.receipt().wbFailures, 0, 'recovery visible: failures reset');
    assert.ok(JSON.parse(idb._stores.get('ptsBlobs').get(B).json).some(r => r.name === 'Edit During Outage'), 'recovery moved the data');
    assert.strictEqual(h.api.receipt().degraded, true,
      'THE LATCH HOLDS: an incident that healed silently is the transient-fault-dressed-as-verdict class');
  }

  console.log('sj2-eviction-persist: OK (verdict from persisted() only in BOTH directions, denial/unsupported/' +
    'unverifiable loud with estimate observed, granted-vs-denied truncation discriminator pair, ballast bounded by ' +
    'high water keeping newest, evicted-blob boot reconstructs + latches + re-persists, degraded is a session latch ' +
    'with loud bulk refusal and visible recovery)');
})().catch(e => { console.error('sj2-eviction-persist FAILED:', e && e.stack || e); process.exit(1); });
