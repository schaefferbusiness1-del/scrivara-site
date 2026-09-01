'use strict';

/* sj-2.1 (2026-08-31) — the pre-merge snapshot lane moves to IndexedDB.
 *
 * sj-2.0 retired the localStorage patients blob, so snapshotRotate() minted
 * nothing in idb mode and EVERY duplicate merge refused 'no-snapshot' (the
 * owner hit this live: "Merge did not run (no-snapshot)" over 75 duplicate
 * groups). sj-2.1 mints the snapshot into the b121 lane's OWN IndexedDB
 * database, confirmed before the merge runs; the gate refuses without a fresh
 * confirmed mint, exactly as fail-closed as before.
 *
 * The snapshot machinery is EXECUTED here against a fake indexedDB — mint,
 * rotation, gate freshness, plainRows restore routing, and the legacy
 * localStorage path — sliced from the shipped file, never retyped.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

let checks = 0;
function ok(v, m) { checks++; assert.ok(v, m); }
function eq(a, b, m) { checks++; assert.strictEqual(a, b, m); }

const root = path.resolve(__dirname, '..');
const LANES = ['1p-feat_mls_b121_pack.js', 'feat_mls_b121_pack.js', 'cloned-feat_mls_b121_pack.js'];

function makeFakeIdb() {
  const databases = {};
  function makeDb(name) {
    const rec = databases[name] || (databases[name] = { stores: {} });
    return {
      createObjectStore(n) { rec.stores[n] = rec.stores[n] || new Map(); return rec.stores[n]; },
      transaction(n) {
        const store = rec.stores[n];
        if (!store) throw new Error('no-store:' + n);
        const tx = { oncomplete: null, onerror: null, onabort: null, error: null, _done: false };
        queueMicrotask(() => queueMicrotask(() => { if (!tx._done) { tx._done = true; if (tx.oncomplete) tx.oncomplete(); } }));
        tx.objectStore = function () {
          return {
            put(v, k) { store.set(k, v); const rq = {}; queueMicrotask(() => { if (rq.onsuccess) rq.onsuccess(); }); return rq; },
            get(k) { const rq = {}; queueMicrotask(() => { rq.result = store.has(k) ? store.get(k) : undefined; if (rq.onsuccess) rq.onsuccess(); }); return rq; },
          };
        };
        return tx;
      },
      close() {},
    };
  }
  return {
    open(name) {
      const rq = {};
      queueMicrotask(() => {
        const isNew = !databases[name];
        rq.result = makeDb(name);
        if (isNew && rq.onupgradeneeded) rq.onupgradeneeded();
        if (rq.onsuccess) rq.onsuccess();
      });
      return rq;
    },
    _databases: databases,
  };
}

function makeFakeLocalStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

function slice(src, fromMark, toMark, label) {
  const a = src.indexOf(fromMark);
  const b = src.indexOf(toMark, a);
  assert.ok(a >= 0 && b > a, label + ': expected region [' + fromMark.slice(0, 30) + ' .. ' + toMark.slice(0, 30) + '] is missing');
  return src.slice(a, b);
}

let lanesChecked = 0;

(async function main() {
  for (const lane of LANES) {
    const file = path.join(root, lane);
    if (!fs.existsSync(file)) continue;
    lanesChecked++;
    const src = fs.readFileSync(file, 'latin1');

    /* the snapshot region: rotate + sj-2.1 idb helpers + mintSnapshot +
       _restoreSnapshotRows, then the emergency restore itself */
    const region1 = slice(src, 'function snapshotRotate(key)', 'api._clearBackups', lane);
    const region2 = slice(src, 'api._restoreSnapshot = function', 'function pullRunning()', lane);

    function buildLane(opts) {
      const idb = makeFakeIdb();
      const ls = makeFakeLocalStorage();
      const saveCalls = [];
      const win = {
        __mlsPtsStore: opts.idbMode ? {
          isReady: () => true,
          saveAsync: (rows, o) => { saveCalls.push({ rows, o }); return Promise.resolve({ confirmedGen: 7 }); },
        } : undefined,
        __mlsPtsDecode: (raw) => { if (opts.decodeSpy) opts.decodeSpy.calls++; return raw; },
      };
      const api = { state: {}, };
      const logs = [];
      const fn = new Function('api', 'patientsKey', 'getP', 'log', 'localStorage', 'indexedDB', 'window', 'refreshRenders', 'Promise',
        region1 + '\n' + region2 + '\nreturn { snapshotRotate: snapshotRotate };');
      const handles = fn(api, () => opts.key, () => opts.rows, (m) => logs.push(String(m)), ls, idb, win, () => {}, Promise);
      return { api, idb, ls, logs, saveCalls, rotate: handles.snapshotRotate, win };
    }

    const KEY = 'acct:patients';
    const ROWS = [{ id: 'p1', name: 'A' }, { id: 'p2', name: 'B' }];

    /* 1. idb mode, no mint yet: the gate refuses exactly like before */
    {
      const L = buildLane({ idbMode: true, key: KEY, rows: ROWS });
      eq(L.rotate(KEY), '', lane + ': without a fresh confirmed mint the gate must refuse');
      ok(L.logs.some((m) => /sj-2\.1/.test(m)), lane + ': the refusal must say the true sj-2.1 reason');
    }

    /* 2. mint -> confirmed payload in idb, gate opens */
    {
      const L = buildLane({ idbMode: true, key: KEY, rows: ROWS });
      const minted = await L.api.mintSnapshot();
      eq(minted, true, lane + ': the mint must confirm');
      const store = L.idb._databases.mlsB121SnapshotsV1.stores.snaps;
      const b1 = store.get(KEY + '::b121backup::1');
      ok(b1 && b1.plainRows === true && typeof b1.raw === 'string', lane + ': the newest generation must be a plainRows payload');
      assert.deepStrictEqual(JSON.parse(b1.raw), ROWS, lane + ': the snapshot must carry the exact roster rows'); checks++;
      ok(/^idb::/.test(L.rotate(KEY)), lane + ': a fresh confirmed mint must open the gate');
    }

    /* 3. a second mint rotates the previous generation to ::2 */
    {
      const L = buildLane({ idbMode: true, key: KEY, rows: ROWS });
      await L.api.mintSnapshot();
      const store = L.idb._databases.mlsB121SnapshotsV1.stores.snaps;
      const first = store.get(KEY + '::b121backup::1');
      await L.api.mintSnapshot();
      assert.deepStrictEqual(store.get(KEY + '::b121backup::2'), first, lane + ': the previous generation must rotate to ::2'); checks++;
    }

    /* 4. a stale mint token refuses again — the gate is freshness-bound */
    {
      const L = buildLane({ idbMode: true, key: KEY, rows: ROWS });
      await L.api.mintSnapshot();
      L.api.state.snapshotMintedAt = Date.now() - 61000;
      eq(L.rotate(KEY), '', lane + ': a stale mint must not open the gate');
    }

    /* 5. emergency restore in idb mode reads the idb snapshot, skips the blob
       decode for plainRows, and routes the exact rows with allowRemovals */
    {
      const decodeSpy = { calls: 0 };
      const L = buildLane({ idbMode: true, key: KEY, rows: ROWS, decodeSpy });
      await L.api.mintSnapshot();
      const verdict = await L.api._restoreSnapshot({ confirm: 'EXECUTE' });
      ok(/^restored snapshot from /.test(String(verdict)), lane + ': the idb restore must settle restored, got: ' + verdict);
      eq(L.saveCalls.length, 1, lane + ': the restore must route through the primitive exactly once');
      assert.deepStrictEqual(L.saveCalls[0].rows, ROWS, lane + ': the restored rows must be the snapshot rows'); checks++;
      eq(L.saveCalls[0].o && L.saveCalls[0].o.allowRemovals, true, lane + ': the rewind must carry allowRemovals');
      eq(decodeSpy.calls, 0, lane + ': a plainRows snapshot must never pass through the blob decoder');
    }

    /* 6. legacy mode (no idb store): the localStorage lane is byte-for-byte alive */
    {
      const L = buildLane({ idbMode: false, key: KEY, rows: ROWS });
      L.ls.setItem(KEY, JSON.stringify(ROWS));
      const got = L.rotate(KEY);
      eq(got, KEY + '::b121backup::1', lane + ': legacy rotate must mint into localStorage');
      ok(L.ls._map.has(KEY + '::b121backup::1'), lane + ': the legacy snapshot must be written');
      const verdict = L.api._restoreSnapshot({ confirm: 'EXECUTE' });
      ok(/^restored snapshot from /.test(String(verdict)), lane + ': the legacy restore stays synchronous and honest');
      eq(L.ls.getItem(KEY), JSON.stringify(ROWS), lane + ': the legacy restore rewrites the blob key');
    }

    /* 7. the review dialog mints BEFORE it merges, and refuses out loud on a
       failed mint (wiring pins — the executed machinery is proven above) */
    ok(src.indexOf('Writing the pre-merge safety snapshot') > 0, lane + ': the dialog must announce the snapshot step');
    const goAt = src.indexOf('Writing the pre-merge safety snapshot');
    const handler = src.slice(goAt - 800, goAt + 900);
    ok(/api\.mintSnapshot\(\)/.test(handler), lane + ': the dialog must mint through the real API');
    ok(/the pre-merge safety snapshot could not be written/.test(handler), lane + ': a failed mint must refuse out loud');
    ok(handler.indexOf('api.mintSnapshot') < handler.indexOf("runOnce({ confirm: 'EXECUTE' })"), lane + ': the mint must come before the merge');
  }

  assert.ok(lanesChecked >= 2, 'expected at least the 1p and production lanes to exist, saw ' + lanesChecked);
  console.log('PASS sj21-premerge-snapshot: the duplicate merge mints its pre-merge snapshot into IndexedDB and stays fail-closed — no fresh confirmed mint means no merge, rotation keeps two generations, the emergency rewind routes plainRows through the primitive with allowRemovals, and the legacy localStorage lane is untouched (' + checks + ' checks across ' + lanesChecked + ' lanes)');
})().catch((e) => { console.error(e); process.exit(1); });
