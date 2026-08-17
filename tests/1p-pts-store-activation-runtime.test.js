'use strict';
/* ptsmig-1.0.0 - THE PATIENT STORE IS ACTUALLY TURNED ON.
 *
 * The sj-2.0 IndexedDB patient store, its journal, its verified cutover and
 * five passing suites all shipped, but nothing ever CALLED migrate(): a grep
 * for a shipped `.migrate(` call site returned hits under tests/ ONLY. Every
 * account therefore stayed in S.mode==='ls', isReady() never became true, and
 * savePatients() always fell to the localStorage lane. Five green suites
 * described a store no doctor was using.
 *
 * This suite proves three things against the shipped 1p bytes:
 *   A. a shipped call site exists in BOTH shells, after init(), and it never
 *      gates the boot paint;
 *   B. the activation helper itself refuses an unresolved namespace, refuses
 *      an account that changed mid-flight, is one-shot, and can never throw;
 *   C. a synthetic 3,000-patient roster round-trips through the REAL store's
 *      migrate() and is served back byte-identical, with localStorage left far
 *      below the 5,242,880-unit budget that the same roster blows through.
 * Nothing here touches a browser, a server, or any real patient. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const LS_BUDGET_UNITS = 5242880; /* the measured localStorage budget (5 MiB of UTF-16 units) */

function occurrences(hay, needle) { let n = 0, i = 0; for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n += 1; i += needle.length; } }
function slice(src, begin, end, what) {
  const a = src.indexOf(begin);
  assert(a >= 0, what + ' start marker missing');
  const b = src.indexOf(end, a);
  assert(b > a, what + ' end marker missing');
  return src.slice(a, b + end.length);
}

/* ======================================================================
 * A. the shipped call sites
 * ==================================================================== */
SHELLS.forEach((file) => {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');

  assert.strictEqual(occurrences(src, '/* ===== ptsmig-1.0.0'), 1, file + ': the ptsmig-1.0.0 block must appear exactly once');
  assert.strictEqual(occurrences(src, '/* ===== end ptsmig-1.0.0 */'), 1, file + ': the ptsmig-1.0.0 block is not closed exactly once');

  /* the defect this suite exists for: a SHIPPED migrate() call site */
  assert(/__mlsPtsAutoMigrate\(p,'boot'\)/.test(src),
    file + ': the boot barrier does not activate the patient store');
  assert(/__mlsPtsAutoMigrate\(window\.__mlsPtsBootReady,'identity-change'\)/.test(src),
    file + ': the identity-change site does not activate the patient store');
  assert(/store\.migrate\(\)/.test(src),
    file + ': nothing in the shipped shell calls the store\'s migrate()');

  /* it must run AFTER init(), never before */
  const barrier = slice(src, 'function __mlsPtsBootBarrier(paint){', '\nfunction startSession(', 'boot barrier');
  const initAt = barrier.indexOf('p=store.init()');
  const migAt = barrier.indexOf("__mlsPtsAutoMigrate(p,'boot')");
  assert(initAt >= 0 && migAt > initAt, file + ': the migration is attempted before init() in the boot barrier');

  /* it must never gate the first roster paint */
  const block = slice(src, '/* ===== ptsmig-1.0.0', '/* ===== end ptsmig-1.0.0 */', 'ptsmig block');
  assert(block.indexOf('runPaint') < 0, file + ': the activation block reaches into the boot paint');
  assert(block.indexOf('await ') < 0, file + ': the activation block blocks');
  const afterMig = barrier.slice(migAt);
  assert(/if\(!migrated\)\{ runPaint\(\); return; \}/.test(afterMig),
    file + ': the pre-migration fast paint no longer runs after the activation hook');

  /* the guard rails are in the shipped bytes, not just in this test */
  assert(/key\.indexOf\('::undefined::'\)<0&&key\.indexOf\('::_::'\)<0/.test(block),
    file + ': the activation does not refuse the sf_u::undefined / ::_ namespace class');
  assert(/if\(live!==key\)return \{migrated:false,skipped:'account-changed'\};/.test(block),
    file + ': the activation does not re-check the account after init settles');
  assert(/__mlsPtsMigrateOnce\[key\]/.test(block), file + ': the activation is not one-shot per account');
});

/* the two shells must carry the identical block */
{
  const blocks = SHELLS.map((f) => slice(fs.readFileSync(path.join(ROOT, f), 'utf8'),
    '/* ===== ptsmig-1.0.0', '/* ===== end ptsmig-1.0.0 */', f));
  assert.strictEqual(blocks[0], blocks[1], 'the two 1p shells carry different activation blocks');
}

/* ======================================================================
 * B. the activation helper's own behaviour
 * ==================================================================== */
const SHELL = fs.readFileSync(path.join(ROOT, SHELLS[0]), 'utf8');
const ACTIVATION = slice(SHELL, 'var __mlsPtsMigrateOnce=Object.create(null);', '/* ===== end ptsmig-1.0.0 */', 'activation helper');

function activation(options) {
  options = options || {};
  const calls = [];
  const warnings = [];
  const store = {
    mode() { return options.mode || 'ls'; },
    migrate() {
      calls.push('migrate');
      if (options.migrateRejects) return Promise.reject(new Error('idb refused'));
      return Promise.resolve(options.report || { migrated: true, rows: 3 });
    }
  };
  let nsCalls = 0;
  const sandbox = {
    Promise, Date, JSON, Object, String, RegExp,
    console: { warn(m) { warnings.push(String(m)); }, error() {}, log() {} },
    window: { __mlsPtsStore: options.noStore ? null : store },
    uns(k) {
      nsCalls += 1;
      const ns = (options.namespaces && options.namespaces[Math.min(nsCalls, options.namespaces.length) - 1]) || options.namespace || 'sf_u::doc@example.com::';
      return ns + k;
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(ACTIVATION + '\nthis.autoMigrate = __mlsPtsAutoMigrate;', sandbox);
  return { sandbox, calls, warnings, store };
}
const settled = () => new Promise((r) => setImmediate(r));

(async function behaviour() {
  /* success */
  {
    const a = activation({});
    const p = a.sandbox.autoMigrate(Promise.resolve(), 'boot');
    assert(p && typeof p.then === 'function', 'the activation returned nothing to observe');
    await p; await settled();
    assert.deepStrictEqual(a.calls, ['migrate'], 'the store was not migrated on a healthy boot');
    assert.strictEqual(a.sandbox.window.__mlsPtsMigrationReceipt.report.migrated, true, 'no migration receipt was filed');
    assert.strictEqual(a.sandbox.window.__mlsPtsMigrationReceipt.why, 'boot', 'the receipt does not say what triggered it');
  }
  /* unresolved namespaces are refused - both shapes */
  for (const ns of ['sf_u::undefined::', 'sf_u::_::']) {
    const a = activation({ namespace: ns });
    const r = a.sandbox.autoMigrate(Promise.resolve(), 'boot');
    await settled(); await settled();
    assert.strictEqual(r, null, 'the activation accepted the unresolved namespace ' + ns);
    assert.deepStrictEqual(a.calls, [], 'a migration was bound to the unresolved namespace ' + ns);
    assert(a.warnings.some((w) => /unresolved account namespace/.test(w)), 'the refusal for ' + ns + ' was silent');
  }
  /* one-shot per account */
  {
    const a = activation({});
    const first = a.sandbox.autoMigrate(Promise.resolve(), 'boot');
    const second = a.sandbox.autoMigrate(Promise.resolve(), 'identity-change');
    assert.strictEqual(first, second, 'a second activation for the same account started a second migration');
    await first; await settled();
    assert.deepStrictEqual(a.calls, ['migrate'], 'migrate() ran more than once for one account');
  }
  /* the account changed while init was settling */
  {
    const a = activation({ namespaces: ['sf_u::a@example.com::', 'sf_u::b@example.com::'] });
    await a.sandbox.autoMigrate(Promise.resolve(), 'boot'); await settled();
    assert.deepStrictEqual(a.calls, [], 'a migration ran against an account that had already changed');
    assert.strictEqual(a.sandbox.window.__mlsPtsMigrationReceipt.report.skipped, 'account-changed',
      'the account-change skip was not recorded');
  }
  /* an already-migrated account is not re-migrated */
  {
    const a = activation({ mode: 'idb' });
    await a.sandbox.autoMigrate(Promise.resolve(), 'boot'); await settled();
    assert.deepStrictEqual(a.calls, [], 'an already-migrated account was migrated again');
  }
  /* a refused migration is loud, recorded, and never throws */
  {
    const a = activation({ report: { migrated: false, steps: [{ step: 'idb-write', ok: false }] } });
    const rep = await a.sandbox.autoMigrate(Promise.resolve(), 'boot'); await settled();
    assert.strictEqual(rep.migrated, false, 'a refused migration was reported as done');
    assert(a.warnings.some((w) => /did NOT migrate/.test(w)), 'a refused migration was silent');
  }
  {
    const a = activation({ migrateRejects: true });
    const rep = await a.sandbox.autoMigrate(Promise.resolve(), 'boot'); await settled();
    assert.strictEqual(rep, null, 'a rejected migration leaked a value');
    assert.strictEqual(a.sandbox.window.__mlsPtsMigrationReceipt.error, 'idb refused', 'the rejection was not recorded');
  }
  /* a refused init must not start anything, and must not throw */
  {
    const a = activation({});
    const rejected = Promise.reject(new Error('MLS_PTS_STORE_NO_NAMESPACE'));
    const rep = await a.sandbox.autoMigrate(rejected, 'boot'); await settled();
    assert.strictEqual(rep, null, 'a refused init still produced a migration result');
    assert.deepStrictEqual(a.calls, [], 'a migration ran on top of a refused init');
  }
  /* no store at all */
  {
    const a = activation({ noStore: true });
    assert.strictEqual(a.sandbox.autoMigrate(Promise.resolve(), 'boot'), null, 'the activation ran without a store');
  }

  await capacity();
})().catch((e) => { console.error(e); process.exit(1); });

/* ======================================================================
 * C. 3,000 patients round-trip through the REAL store
 * ==================================================================== */
const STORE_SRC = slice(SHELL, '/* ===== BEGIN mls-pts-store (sj-2.0) ===== */',
  '/* ===== END mls-pts-store (sj-2.0) ===== */', 'sj-2.0 store primitive');

function makeLS() {
  const data = new Map();
  return {
    data,
    get length() { return data.size; },
    key(i) { const k = [...data.keys()][i]; return k === undefined ? null : k; },
    getItem(k) { k = String(k); return data.has(k) ? data.get(k) : null; },
    setItem(k, v) { data.set(String(k), String(v)); },
    removeItem(k) { data.delete(String(k)); },
    units() { let n = 0; data.forEach((v, k) => { n += String(k).length + String(v).length; }); return n; }
  };
}
function makeIDB() {
  const stores = new Map();
  function req() { return { onsuccess: null, onerror: null, result: undefined, error: null }; }
  function makeDB() {
    return {
      close() {},
      objectStoreNames: { contains: (n) => stores.has(n) },
      transaction() {
        const tx = { oncomplete: null, onabort: null, onerror: null, error: null, _aborted: false };
        tx.abort = function () { tx._aborted = true; setImmediate(() => { if (tx.onabort) tx.onabort(); }); };
        tx.objectStore = function (n) {
          const m = stores.get(n);
          return {
            get(k) { const r = req(); setImmediate(() => { if (tx._aborted) return; const rec = m.has(k) ? Object.assign({}, m.get(k)) : undefined; r.result = rec; if (r.onsuccess) r.onsuccess(); }); return r; },
            put(rec) { const r = req(); setImmediate(() => { if (tx._aborted) return; m.set(rec.k, Object.assign({}, rec)); if (r.onsuccess) r.onsuccess(); }); return r; },
            delete(k) { const r = req(); setImmediate(() => { if (tx._aborted) return; m.delete(k); if (r.onsuccess) r.onsuccess(); }); return r; }
          };
        };
        setImmediate(() => setImmediate(() => setImmediate(() => { if (!tx._aborted && tx.oncomplete) tx.oncomplete(); })));
        return tx;
      }
    };
  }
  return {
    _stores: stores,
    units() { let n = 0; stores.forEach((m) => m.forEach((rec) => { n += String(rec.json || '').length; })); return n; },
    open() {
      const r = req(); r.onupgradeneeded = null; r.onblocked = null;
      setImmediate(() => {
        if (!stores.has('ptsBlobs')) {
          r.result = { objectStoreNames: { contains: (n) => stores.has(n) }, createObjectStore: (n) => { stores.set(n, new Map()); return {}; } };
          if (r.onupgradeneeded) r.onupgradeneeded();
        }
        r.result = makeDB(); if (r.onsuccess) r.onsuccess();
      });
      return r;
    }
  };
}

/* A synthetic roster sized from the measured ceiling: the readiness audit
 * measured 1,400 patients at 5,386,889 units, i.e. ~3,848 units per patient. */
function roster(n) {
  const pad = 'x'.repeat(3400);
  const out = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      id: 'syn-' + i,
      name: 'Synthetic Patient ' + i,
      dob: '01/02/1980',
      mrn: String(100000 + i),
      updated: 1755400000000 + i,
      visits: [{ id: 'v-' + i, date: '2026-08-17', reason: 'Synthetic visit', body: pad }]
    });
  }
  return out;
}

async function capacity() {
  const ls = makeLS();
  const idb = makeIDB();
  const rows = roster(3000);
  const json = JSON.stringify(rows);
  const KEY = 't::acct::patients';
  ls.setItem(KEY, json);
  const beforeUnits = ls.units();

  const win = { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } };
  const ctx = {
    window: win, localStorage: ls, navigator: {},
    setTimeout, clearTimeout, setInterval, clearInterval,
    console: { warn() {}, error() {}, log() {} },
    JSON, Math, Date, Array, Object, String, Number, Promise, RegExp, Error, TypeError, Map, Set,
    CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
    Event: function (t) { this.type = t; },
    uns: (k) => 't::acct::' + k,
    toast() {},
    _mlsPtsDecode: (v) => v
  };
  ctx.window.localStorage = ls; ctx.window.navigator = ctx.navigator;
  ctx.window.__mlsBgSleep = () => Promise.resolve();
  ctx.self = ctx.window; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(STORE_SRC, ctx, { filename: '1pScribeFlow:mls-pts-store' });
  const api = ctx.window.__mlsPtsStore;
  api._t.setIdbFactory(idb);

  await api.init();
  assert.strictEqual(api.mode(), 'ls', 'a pre-migration account did not start on localStorage');
  assert.strictEqual(api.isReady(), false, 'the store claimed readiness before migrating');

  const rep = await api.migrate();
  assert.strictEqual(rep.migrated, true, '3,000 patients failed to migrate: ' + JSON.stringify(rep.steps || rep));
  assert.strictEqual(api.isReady(), true, 'the store is not serving from IndexedDB after a successful migration');

  /* the roster comes back whole and unchanged - never lose a patient */
  const served = api.getRoster();
  assert.strictEqual(served.length, 3000, 'the migrated roster lost patients: ' + served.length + ' of 3000');
  assert.strictEqual(JSON.stringify(served), json, 'the migrated roster is not byte-identical to what went in');

  /* a post-migration write still lands and is still served */
  const next = served.slice();
  next[0] = Object.assign({}, next[0], { name: 'Synthetic Patient 0 (edited)', updated: Date.now() });
  api.save(next, {});
  await api.flushNow();
  assert.strictEqual(api.getRoster()[0].name, 'Synthetic Patient 0 (edited)', 'a post-migration edit was lost');
  assert.strictEqual(api.getRoster().length, 3000, 'a post-migration write changed the roster size');

  const afterUnits = ls.units();
  assert.strictEqual(ls.getItem(KEY), null, 'the localStorage patients blob survived the migration');
  assert(beforeUnits > LS_BUDGET_UNITS,
    'the synthetic roster is too small to exercise the ceiling (' + beforeUnits + ' units)');
  assert(afterUnits < LS_BUDGET_UNITS,
    'localStorage is still over the ceiling after migration: ' + afterUnits + ' units');
  assert(idb.units() >= json.length, 'IndexedDB does not hold the roster');

  console.log('  3,000-patient roster: localStorage ' + beforeUnits + ' units BEFORE (budget ' + LS_BUDGET_UNITS +
    ', over by ' + (beforeUnits - LS_BUDGET_UNITS) + ') -> ' + afterUnits + ' units AFTER (' +
    (100 - Math.round(afterUnits / LS_BUDGET_UNITS * 100)) + '% of budget free); IndexedDB holds ' + idb.units() + ' units');
  console.log('PASS 1p patient-store activation (ptsmig-1.0.0, 2 shells, 9 behaviours, 3,000-patient round trip)');
}
