'use strict';
/* =============================================================================
 * wipes-contract.test.js  (sj-2.0 WIPES stage)  2026-08-11  -- DRAFT
 *
 * Contract suite for patch-sj2-wipes.js. Builds the patched sources IN MEMORY
 * (applyToSources - the repo is never written) and proves, in vm:
 *
 *   clinical-state-purge.js (module-level):
 *     P1  proven wipe -> ptsStore receipt verifiedEmpty:true, no escalation,
 *         other-account keys untouched, patient-store DATABASE never deleted
 *     P2  wipe answers verifiedEmpty:false -> escalated, err toast, console.error
 *     P3  store missing + document present -> LOUD escalation (fail-closed)
 *     P4  store missing + bare vm (no document) -> QUIET, but still refuses
 *         green (existing registered suites keep their clean output)
 *     P5  uns() namespace mismatch -> wipe NEVER called, refused, escalated
 *     P6  ::undefined:: account -> refused before any wipe (stranded-notes class)
 *     P7  wipe says true but a journal key survives -> independent read-back
 *         flips the verdict to false (a green from the store alone is not proof)
 *
 *   ScribeFlow.html clearDeviceData (extracted by byte markers):
 *     C1  proven wipe -> success toast, 400ms reload, receipt published
 *     C2  wipe unproven -> NO success toast, err toast, console.error, 4200ms
 *     C3  store missing -> same red path (pts-store-missing)
 *     C4  sticky journal key -> red path localStorage-keys-remain
 *     C5  ::undefined:: namespace -> refused, wipe never called
 *     C6  consent-audit purge still runs, and BEFORE the wipe (ordering)
 *
 *   Static invariants on the patched bytes:
 *     S1  non-vacuity (patched !== raw, both files)
 *     S2  qg-2.0 write-only latch identifier count UNMOVED (and == 1): these
 *         edits add no reader and no writer
 *     S3  upsertPatient region byte-intact (the b1008 qg-2.0 splice)
 *     S4  consent-audit call still inside its 1200-byte pin window
 *     S5  logout barrier folds _ptsWipe exactly once; the 2-member call is gone
 *
 *   INTEGRATION (the real primitive + the patched purge module in ONE vm):
 *     I1  migrate -> save -> purge(email): ptsStore resolves verifiedEmpty:true,
 *         own IndexedDB record GONE, a FOREIGN account's record SURVIVES
 *         (own-prefix law proven at the IndexedDB level), journal + gen keys
 *         null - the draft-level shape of the logout-wipe-zero-IDB-bytes
 *         criterion. The LIVE criterion run (real sign-out, real browser) is
 *         logout-wipe-zero-idb-bytes.check.js and stays BLOCKING regardless.
 *
 * Primitive source resolution for I1: (1) the patched ScribeFlow.html BEGIN/END
 * markers (phase-2 state), (2) env MLS_SJ2_PRIMITIVE, (3) the salvage path
 * relative to this draft. If none resolve, this suite FAILS (a skipped
 * integration is the a-partial-gate class).
 * ========================================================================== */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const patcher = require('./patch-sj2-wipes.js');
const { EDITS, applyToSources, occurrences, assertInvariants, CSP, SF } = patcher;

const ROOT = process.env.MLS_REPO_ROOT ||
  (path.basename(__dirname) === 'tests' ? path.resolve(__dirname, '..') : null);
if (!ROOT) { console.error('set MLS_REPO_ROOT'); process.exit(1); }

const raw = {};
raw[CSP] = fs.readFileSync(path.join(ROOT, CSP), 'latin1');
raw[SF] = fs.readFileSync(path.join(ROOT, SF), 'latin1');

const built = applyToSources(raw, { tolerateApplied: true });
const patched = built.sources;
const freshApply = built.log.every(l => l.status === 'ok');

/* ---- S1..S5 static invariants ------------------------------------------- */
if (freshApply) {
  assert.notStrictEqual(patched[CSP], raw[CSP], 'S1: CSP unchanged (vacuous patch)');
  assert.notStrictEqual(patched[SF], raw[SF], 'S1: SF unchanged (vacuous patch)');
}
assertInvariants(raw, patched); /* S2 partial + S4 + ascii + fold-in */
const LATCH = '__mlsPtsEdit' + 'AtRiskUnknown';
assert.strictEqual(occurrences(patched[SF], LATCH), 1, 'S2: latch identifier must stay at exactly one occurrence (one writer, zero readers)');
const upsAt = raw[SF].indexOf('function upsertPatient(');
assert.ok(upsAt > 0, 'S3: upsertPatient head not found in raw');
const upsBlock = raw[SF].slice(upsAt, upsAt + 6000);
assert.strictEqual(occurrences(patched[SF], upsBlock), 1, 'S3: the qg-2.0 upsertPatient region is no longer byte-intact');
assert.strictEqual(occurrences(patched[SF], 'Promise.all([_clinicalPurge,_consentPurge,_ptsWipe]);'), 1, 'S5: barrier fold-in missing');
assert.strictEqual(occurrences(patched[SF], 'Promise.all([_clinicalPurge,_consentPurge]);'), 0, 'S5: old 2-member barrier call still present');

/* ---- shared fakes -------------------------------------------------------- */
function storage(initial) {
  const values = new Map(Object.entries(initial || {}));
  const s = {
    get length() { return values.size; },
    key(i) { return [...values.keys()][i] ?? null; },
    getItem(k) { return values.has(String(k)) ? values.get(String(k)) : null; },
    setItem(k, v) { values.set(String(k), String(v)); },
    removeItem(k) { if (s.sticky && s.sticky.has(String(k))) return; values.delete(String(k)); },
    clear() { values.clear(); },
    keys() { return [...values.keys()]; },
    sticky: null
  };
  return s;
}
function recorder() { return { toasts: [], errors: [], order: [] }; }

function cspCtx(opts) {
  opts = opts || {};
  const R = recorder();
  const ls = opts.ls || storage(opts.seed);
  const deleted = [];
  const ctx = {
    localStorage: ls,
    sessionStorage: { clear() {} },
    setTimeout, clearTimeout, Promise,
    console: { error: (...a) => { R.errors.push(a); }, warn() {}, info() {}, log() {} },
    indexedDB: { deleteDatabase(name) { deleted.push(name); const r = {}; setImmediate(() => { r.onsuccess && r.onsuccess(); }); return r; } },
    toast: (m, k) => { R.toasts.push([String(m), String(k || '')]); }
  };
  if (opts.document) ctx.document = {};
  if (opts.uns) ctx.uns = opts.uns;
  if (opts.store) ctx.__mlsPtsStore = opts.store;
  ctx.window = ctx;
  vm.runInNewContext(patched[CSP], ctx, { filename: 'clinical-state-purge.patched.js' });
  return { ctx, ls, R, deleted, api: ctx.__mlsClinicalStatePurge };
}
function fakeStore(receipt, R) {
  const st = { calls: 0, wipe() { st.calls++; if (R) R.order.push('wipe'); return Promise.resolve(typeof receipt === 'function' ? receipt() : receipt); } };
  return st;
}
const EMAIL = 'doc@x';
const PFX = 'sf_u::' + EMAIL + '::';
const unsOk = k => PFX + k;

(async function () {

  /* ---- P1: proven wipe, own-prefix law, database never deleted ---------- */
  {
    const st = fakeStore({ verifiedEmpty: true });
    const h = cspCtx({ document: true, uns: unsOk, store: st, seed: {
      [PFX + 'patients']: 'blob', [PFX + 'ptsJournalV2']: '{}', [PFX + 'ptsGenV2']: '1|t|0',
      'sf_u::other@example.test::patients': 'other-account', 'sf_u::other@example.test::ptsJournalV2': '{}'
    } });
    const res = h.api.purge(EMAIL);
    assert.ok(res.ptsStore && typeof res.ptsStore.then === 'function', 'P1: purge() gained no ptsStore promise');
    const rec = await res.ptsStore;
    assert.strictEqual(rec.verifiedEmpty, true, 'P1: proven wipe not green: ' + JSON.stringify(rec));
    assert.strictEqual(rec.escalated, false, 'P1: green run escalated');
    assert.strictEqual(st.calls, 1, 'P1: wipe not called exactly once');
    assert.strictEqual(h.R.toasts.length, 0, 'P1: green run toasted');
    assert.strictEqual(h.R.errors.length, 0, 'P1: green run console.errored');
    assert.strictEqual(h.ctx.__mlsPtsWipeLast, rec, 'P1: receipt not published');
    assert.ok(h.ls.keys().includes('sf_u::other@example.test::patients'), 'P1: foreign namespace touched (LS)');
    assert.ok(!h.deleted.includes('mlsPtsStoreV2'), 'P1: the SHARED patient-store database was deleted (own-prefix law violated)');
  }

  /* ---- P2: unproven wipe escalates loudly ------------------------------- */
  {
    const st = fakeStore({ verifiedEmpty: false, error: 'idb: refused' });
    const h = cspCtx({ document: true, uns: unsOk, store: st, seed: {} });
    const rec = await h.api.purge(EMAIL).ptsStore;
    assert.strictEqual(rec.verifiedEmpty, false, 'P2: unproven wipe went green');
    assert.strictEqual(rec.escalated, true, 'P2: not escalated');
    assert.ok(h.R.toasts.some(t => t[1] === 'err'), 'P2: no err toast');
    assert.ok(h.R.errors.length > 0, 'P2: no console.error');
    assert.ok(/idb: refused|store-wipe-unverified/.test(rec.error), 'P2: error not carried: ' + rec.error);
  }

  /* ---- P3: store missing + document -> LOUD ----------------------------- */
  {
    const h = cspCtx({ document: true, uns: unsOk, seed: {} });
    const rec = await h.api.purge(EMAIL).ptsStore;
    assert.strictEqual(rec.verifiedEmpty, false, 'P3: missing store went green');
    assert.strictEqual(rec.error, 'pts-store-missing', 'P3: wrong error: ' + rec.error);
    assert.ok(h.R.errors.length > 0, 'P3: missing store on a real page must be LOUD');
  }

  /* ---- P4: store missing in a bare vm -> quiet, still refused ----------- */
  {
    const h = cspCtx({ seed: {} }); /* no document, no store, no uns */
    const rec = await h.api.purge(EMAIL).ptsStore;
    assert.strictEqual(rec.verifiedEmpty, false, 'P4: bare vm went green');
    assert.strictEqual(h.R.errors.length, 0, 'P4: bare vm was noisy (existing suites would carry alarming output)');
    assert.strictEqual(h.R.toasts.length, 0, 'P4: bare vm toasted');
  }

  /* ---- P5: namespace mismatch refuses BEFORE the wipe ------------------- */
  {
    const st = fakeStore({ verifiedEmpty: true });
    const h = cspCtx({ document: true, uns: k => 'sf_u::somebody-else@x::' + k, store: st, seed: {} });
    const rec = await h.api.purge(EMAIL).ptsStore;
    assert.strictEqual(st.calls, 0, 'P5: wipe ran against a mismatched namespace');
    assert.strictEqual(rec.verifiedEmpty, false, 'P5: mismatch went green');
    assert.ok(/namespace-mismatch/.test(rec.error), 'P5: wrong error: ' + rec.error);
  }

  /* ---- P6: the ::undefined:: class is refused up front ------------------ */
  {
    const st = fakeStore({ verifiedEmpty: true });
    const h = cspCtx({ document: true, uns: k => 'sf_u::undefined::' + k, store: st, seed: {} });
    const rec = await h.api.purge('undefined').ptsStore;
    assert.strictEqual(st.calls, 0, 'P6: wipe ran against the undefined namespace');
    assert.strictEqual(rec.verifiedEmpty, false, 'P6: undefined namespace went green');
    assert.strictEqual(rec.error, 'unresolved-account-namespace', 'P6: wrong error: ' + rec.error);
  }

  /* ---- P7: store green + surviving key -> independent read-back refuses - */
  {
    const st = fakeStore({ verifiedEmpty: true });
    const ls = storage({ [PFX + 'ptsJournalV2']: '{"v":2}' });
    ls.sticky = new Set([PFX + 'ptsJournalV2']); /* removeItem silently fails */
    const h = cspCtx({ document: true, uns: unsOk, store: st, ls });
    const rec = await h.api.purge(EMAIL).ptsStore;
    assert.strictEqual(rec.verifiedEmpty, false, 'P7: surviving journal key went green');
    assert.ok(/localStorage-keys-remain/.test(rec.error), 'P7: wrong error: ' + rec.error);
    assert.strictEqual(rec.escalated, true, 'P7: not escalated');
  }

  /* ---- clearDeviceData extraction --------------------------------------- */
  const cddHead = 'async function clearDeviceData(){';
  const cddAt = patched[SF].indexOf(cddHead);
  assert.ok(cddAt > 0, 'C: clearDeviceData head missing from patched SF');
  /* wipeslice-1.0.0 (2026-08-28): the end marker was '\n}\nfunction saveSettings(){'
     - it required clearDeviceData to be IMMEDIATELY followed by saveSettings.
     That adjacency broke when dockfn-1.0.0 (b1099) inserted
     qolDockSideChanged/qolDockAutoHideChanged between them, and this suite went
     red for a change that has nothing to do with wiping a device. A
     neighbour-keyed slice fails whenever a neighbour moves in, which is a thing
     source files do; the same class killed two persistence suites earlier the
     same day.
     Brace-matched to clearDeviceData's own closing brace, and QUOTE-AWARE
     because a brace inside a string is not structure. Inserting anything after
     it is now harmless. */
  const cddEnd = (() => {
    /* The end is still the function's own `\n}` at column 0 - that part was
       always right. What was wrong was requiring a SPECIFIC next function.
       Take the first such close that is followed, after any blank lines and
       comments, by ANY top-level function declaration.
       (Brace-matching was tried and is NOT safe here: this source contains
       regex literals with braces, which a brace counter miscounts - it cut in
       the wrong place and the lifted slice failed to parse.) */
    let from = cddAt;
    for (;;) {
      const at = patched[SF].indexOf('\n}\n', from);
      if (at < 0) return -1;
      const rest = patched[SF].slice(at + 3, at + 4000)
        .replace(/^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)+/, '');
      if (/^(?:async\s+)?function\s/.test(rest)) return at;
      from = at + 1;
    }
  })();
  assert.ok(cddEnd > cddAt,
    'C: clearDeviceData end marker missing - no top-level function follows its close');
  const cddSrc = patched[SF].slice(cddAt, cddEnd + 2); /* include closing brace */
  /* No separate swallow-guard here on purpose: this slice is EXECUTED a few
     lines below (vm.runInContext(cddSrc + ...)), so a cut in the wrong place
     fails loudly there as a SyntaxError rather than passing quietly. A second
     textual check would only be another thing to keep in sync. */

  function cddCtx(opts) {
    opts = opts || {};
    const R = recorder();
    const ls = opts.ls || storage(Object.assign({
      [PFX + 'patients']: 'blob', [PFX + 'ptsJournalV2']: '{}', [PFX + 'ptsGenV2']: '1|t|0',
      [PFX + 'qolTheme']: 'dark', 'sf_u::other@example.test::patients': 'other-account'
    }, opts.seed));
    const delays = [];
    const ctx = {
      localStorage: ls, Promise,
      console: { error: (...a) => { R.errors.push(a); }, warn() {}, info() {}, log() {} },
      uns: opts.uns || (k => PFX + k),
      mlsConfirm: async () => true,
      toast: (m, k) => { R.toasts.push([String(m), String(k || '')]); },
      setTimeout: (fn, ms) => { delays.push(ms); return 1; },
      location: { reload() {}, href: 'https://app.test/' },
      _mlsConsentAccountId: () => EMAIL,
      _mlsPurgeConsentAuditDb: async () => { R.order.push('consent'); return true; }
    };
    if (opts.store) ctx.__mlsPtsStore = opts.store;
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(cddSrc + '\n;window.__cdd=clearDeviceData;', ctx, { filename: 'clearDeviceData.patched.js' });
    return { ctx, ls, R, delays, run: () => ctx.__cdd() };
  }

  /* ---- C1: proven wipe -> success toast, 400ms -------------------------- */
  {
    const st = fakeStore({ verifiedEmpty: true });
    const h = cddCtx({ store: st });
    await h.run();
    assert.ok(h.R.toasts.some(t => t[1] === 'ok' && /Cleared saved data/.test(t[0])), 'C1: success toast missing');
    assert.ok(!h.R.toasts.some(t => t[1] === 'err'), 'C1: err toast on a green run');
    assert.deepStrictEqual(h.delays, [400], 'C1: reload delay changed: ' + JSON.stringify(h.delays));
    assert.strictEqual(h.ctx.__mlsPtsWipeLast.site, 'clearDeviceData', 'C1: receipt not published');
    assert.strictEqual(h.ctx.__mlsPtsWipeLast.verifiedEmpty, true, 'C1: receipt not green');
    assert.ok(h.ls.keys().includes('sf_u::other@example.test::patients'), 'C1: foreign namespace touched');
    assert.strictEqual(st.calls, 1, 'C1: wipe not called exactly once');
  }

  /* ---- C2: unproven wipe -> NO green, err toast, slow reload ------------ */
  {
    const st = fakeStore({ verifiedEmpty: false, error: 'verify: idb read failed' });
    const h = cddCtx({ store: st });
    await h.run();
    assert.ok(!h.R.toasts.some(t => t[1] === 'ok'), 'C2: SUCCESS TOAST ON AN UNPROVEN WIPE (no proof, no green)');
    assert.ok(h.R.toasts.some(t => t[1] === 'err' && /could NOT be proven/.test(t[0])), 'C2: err toast missing');
    assert.ok(h.R.errors.length > 0, 'C2: console.error missing');
    assert.deepStrictEqual(h.delays, [4200], 'C2: failure reload not slowed: ' + JSON.stringify(h.delays));
    assert.strictEqual(h.ctx.__mlsPtsWipeLast.verifiedEmpty, false, 'C2: receipt went green');
  }

  /* ---- C3: store missing -> red path ------------------------------------ */
  {
    const h = cddCtx({});
    await h.run();
    assert.ok(!h.R.toasts.some(t => t[1] === 'ok'), 'C3: green with no store');
    assert.strictEqual(h.ctx.__mlsPtsWipeLast.error, 'pts-store-missing', 'C3: wrong error');
    assert.deepStrictEqual(h.delays, [4200], 'C3: failure reload not slowed');
  }

  /* ---- C4: sticky journal key -> independent read-back refuses ---------- */
  {
    const st = fakeStore({ verifiedEmpty: true });
    const ls = storage({ [PFX + 'patients']: 'blob', [PFX + 'ptsJournalV2']: '{}', [PFX + 'ptsGenV2']: '1|t|0' });
    ls.sticky = new Set([PFX + 'ptsJournalV2']);
    const h = cddCtx({ store: st, ls });
    await h.run();
    assert.ok(!h.R.toasts.some(t => t[1] === 'ok'), 'C4: green with a surviving journal key');
    assert.ok(/localStorage-keys-remain/.test(h.ctx.__mlsPtsWipeLast.error), 'C4: wrong error: ' + h.ctx.__mlsPtsWipeLast.error);
  }

  /* ---- C5: ::undefined:: namespace refused, wipe never called ----------- */
  {
    const st = fakeStore({ verifiedEmpty: true });
    const h = cddCtx({ store: st, uns: k => 'sf_u::undefined::' + k });
    await h.run();
    assert.strictEqual(st.calls, 0, 'C5: wipe ran against the undefined namespace');
    assert.ok(!h.R.toasts.some(t => t[1] === 'ok'), 'C5: green on the undefined namespace');
    assert.strictEqual(h.ctx.__mlsPtsWipeLast.error, 'unresolved-account-namespace', 'C5: wrong error');
  }

  /* ---- C6: consent purge still runs, BEFORE the wipe -------------------- */
  {
    const R6 = recorder();
    const st = { calls: 0, wipe() { st.calls++; R6.order.push('wipe'); return Promise.resolve({ verifiedEmpty: true }); } };
    const h = cddCtx({ store: st });
    h.ctx._mlsPurgeConsentAuditDb = async () => { R6.order.push('consent'); return true; };
    await h.run();
    assert.deepStrictEqual(R6.order, ['consent', 'wipe'], 'C6: consent purge and wipe out of order: ' + JSON.stringify(R6.order));
  }

  /* ---- I1: INTEGRATION - real primitive + patched purge module ---------- */
  {
    const primSrc = resolvePrimitive();
    /* fake localStorage + minimal fake IndexedDB, house extraction style
       (copied from the primitive's smoke harness) */
    const ls = storage({});
    const stores = new Map();
    function req() { return { onsuccess: null, onerror: null, result: undefined, error: null }; }
    const idb = {
      _stores: stores,
      open() {
        const r = req(); r.onupgradeneeded = null;
        setImmediate(() => {
          if (!stores.has('ptsBlobs')) {
            r.result = { objectStoreNames: { contains: n => stores.has(n) }, createObjectStore: n => { stores.set(n, new Map()); return {}; } };
            r.onupgradeneeded && r.onupgradeneeded();
          }
          r.result = mkdb(); r.onsuccess && r.onsuccess();
        });
        return r;
      }
    };
    function mkdb() {
      return {
        close() {},
        objectStoreNames: { contains: n => stores.has(n) },
        transaction(name) {
          const tx = { oncomplete: null, onabort: null, onerror: null, error: null, _aborted: false };
          tx.abort = function () { tx._aborted = true; setImmediate(() => { tx.onabort && tx.onabort(); }); };
          tx.objectStore = function (n) {
            const m = stores.get(n);
            return {
              get(k) { const r = req(); setImmediate(() => { if (tx._aborted) return; r.result = m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : undefined; r.onsuccess && r.onsuccess(); }); return r; },
              put(rec) { const r = req(); setImmediate(() => { if (tx._aborted) return; m.set(rec.k, JSON.parse(JSON.stringify(rec))); r.onsuccess && r.onsuccess(); }); return r; },
              delete(k) { const r = req(); setImmediate(() => { if (tx._aborted) return; m.delete(k); r.onsuccess && r.onsuccess(); }); return r; }
            };
          };
          setImmediate(() => setImmediate(() => setImmediate(() => { if (!tx._aborted) tx.oncomplete && tx.oncomplete(); })));
          return tx;
        }
      };
    }
    const R = recorder();
    const ctx = {
      localStorage: ls, sessionStorage: { clear() {} },
      setTimeout, clearTimeout, setInterval, clearInterval, Promise,
      console: { error: (...a) => { R.errors.push(a); }, warn() {}, info() {}, log() {} },
      JSON, Math, Date, Array, Object, String, Number, RegExp, Error, TypeError,
      CustomEvent: function (t, i) { this.type = t; this.detail = i && i.detail; },
      Event: function (t) { this.type = t; },
      uns: k => PFX + k,
      toast: (m, k) => { R.toasts.push([String(m), String(k || '')]); },
      document: {},
      indexedDB: { deleteDatabase(name) { R.order.push('deleteDatabase:' + name); const r = {}; setImmediate(() => { r.onsuccess && r.onsuccess(); }); return r; } }
    };
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    vm.createContext(ctx);
    vm.runInContext(primSrc, ctx, { filename: 'mls-pts-store.js' });
    const api = ctx.window.__mlsPtsStore;
    api._t.setIdbFactory(idb);
    /* migrate a 2-row roster, then edit one row */
    ls.setItem(PFX + 'patients', JSON.stringify([{ id: 'p1', name: 'Adam', visits: [] }, { id: 'p2', name: 'Beth', visits: [] }]));
    await api.init();
    const mig = await api.migrate();
    assert.strictEqual(mig.migrated, true, 'I1: migration failed: ' + JSON.stringify(mig.steps));
    const r2 = api.getRoster().slice(); r2[0] = Object.assign({}, r2[0], { name: 'Adam Edited', updated: Date.now() });
    api.save(r2, { dirtyIds: ['p1'] });
    await api.flushNow();
    /* a FOREIGN account's record sits beside ours in the SAME database */
    stores.get('ptsBlobs').set('sf_u::other@example.test::patients', { k: 'sf_u::other@example.test::patients', gen: 3, json: '[{"id":"z1"}]', len: 13 });
    assert.ok(stores.get('ptsBlobs').has(PFX + 'patients'), 'I1: own record missing before purge');
    /* now the PATCHED purge module, same context */
    vm.runInContext(patched[CSP], ctx, { filename: 'clinical-state-purge.patched.js' });
    const res = ctx.__mlsClinicalStatePurge.purge(EMAIL);
    const rec = await res.ptsStore;
    assert.strictEqual(rec.verifiedEmpty, true, 'I1: integration wipe not proven: ' + JSON.stringify(rec));
    assert.strictEqual(stores.get('ptsBlobs').has(PFX + 'patients'), false, 'I1: own IndexedDB record SURVIVED the purge');
    assert.strictEqual(stores.get('ptsBlobs').has('sf_u::other@example.test::patients'), true, 'I1: FOREIGN IndexedDB record was deleted (own-prefix law violated)');
    assert.strictEqual(ls.getItem(PFX + 'ptsJournalV2'), null, 'I1: journal key survived');
    assert.strictEqual(ls.getItem(PFX + 'ptsGenV2'), null, 'I1: generation key survived');
    assert.strictEqual(ls.getItem(PFX + 'patients'), null, 'I1: legacy blob key survived');
    assert.strictEqual(api.mode(), 'ls', 'I1: store memory state not reset by wipe');
    assert.strictEqual(R.errors.length, 0, 'I1: green integration escalated: ' + JSON.stringify(R.errors[0] || null));
  }

  console.log('PASS sj-2.0 wipes contract: purge + clearDeviceData wipe with HARD verifiedEmpty gates (P1-P7, C1-C6), statics S1-S5 (latch count unmoved, qg-2.0 region byte-intact, consent pin window held), and the primitive integration proves own-record-gone + foreign-record-survives (I1)');
})().catch(e => { console.error('FAIL wipes contract:', e && e.stack || e); process.exit(1); });

function resolvePrimitive() {
  const B = '/* ===== BEGIN mls-pts-store (sj-2.0) ===== */';
  const E = '/* ===== END mls-pts-store (sj-2.0) ===== */';
  const at = patched[SF].indexOf(B);
  if (at >= 0) {
    const end = patched[SF].indexOf(E, at);
    assert.ok(end > at, 'primitive BEGIN marker without END marker in ScribeFlow.html');
    return patched[SF].slice(at, end + E.length);
  }
  const cands = [];
  if (process.env.MLS_SJ2_PRIMITIVE) cands.push(process.env.MLS_SJ2_PRIMITIVE);
  cands.push(path.join(__dirname, '..', '..', 'salvage', 'sj2', 'primitive', 'mls-pts-store.js'));
  for (const c of cands) { try { if (fs.existsSync(c)) return fs.readFileSync(c, 'utf8'); } catch (_) {} }
  throw new Error('primitive source not found: not spliced into ScribeFlow.html and no salvage copy at ' + cands.join(' | '));
}
