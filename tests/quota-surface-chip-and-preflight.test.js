'use strict';
/* lr-1.0 / qv-1.1 control: A PERSISTENT CONDITION GETS A PERSISTENT SURFACE,
 * AND THE PULL REFUSES LOUDLY WHILE THE STORE IS DROPPING WRITES.
 *
 * Diagnosis 2026-08-11 defect B: window.__mlsStoreWriteFailed existed and was
 * maintained (set by qv-1.0 on a swallowed-quota persist failure, cleared by
 * the next verified write) but NO surface rendered it - the only voice was a
 * 60s rate-limited toast that died ~90s before anyone looked
 * (quotaUIVisible: [] in the validation sweep). Meanwhile dayPull happily
 * drove Athena to read charts into a store that silently drops growth.
 *
 * Pinned here on the real shipped bytes:
 *   1. the qv IIFE (mls-connect) renders a persistent chip while the flag is
 *      set - appears at the failure moment, re-asserts on heal ticks,
 *      disappears when the flag clears, dies with revert();
 *   2. the console line names the store KEY;
 *   3. __dayPullInner (schedimport) refuses LOUDLY - named reason, named
 *      gate, spoken through onStatus, receipt-stamped - BEFORE any Athena
 *      navigation while the flag is set, and never arms presence assist on
 *      the refusal; a healthy store is never blocked. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'latin1');
const si = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'latin1');

/* =========================================================================
 * PART 1: the chip (qv IIFE, extracted exactly like quota-verified-writes)
 * ========================================================================= */
const start = mc.indexOf('qv-1.0 (2026-08-09)');
assert.ok(start > 0, 'qv-1.0 block present');
const iifeStart = mc.indexOf('(function () {', start);
const TAIL = 'window.__mlsQuotaGuard_revert = QG.revert;\n})();';
const iifeEnd = mc.indexOf(TAIL, iifeStart);
assert.ok(iifeStart > 0 && iifeEnd > iifeStart, 'qv IIFE extractable');
const qvSrc = mc.slice(iifeStart, iifeEnd) + TAIL;

function bootQv(validScope = true) {
  const map = new Map();
  const localStorage = {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k)
  };
  const elements = new Map();
  function host() {
    return {
      firstChild: null,
      insertBefore(el) { el.parentNode = this; if (el.id) elements.set(el.id, el); this.firstChild = el; return el; },
      appendChild(el) { el.parentNode = this; if (el.id) elements.set(el.id, el); if (!this.firstChild) this.firstChild = el; return el; }
    };
  }
  const body = host(), documentElement = host();
  const doc = {
    getElementById: id => elements.get(id) || null,
    createElement: () => {
      const el = {
        id: '', style: {}, attrs: {}, textContent: '',
        setAttribute(k, v) { this.attrs[k] = v; },
        parentNode: null,
        remove() { if (this.id && elements.get(this.id) === this) elements.delete(this.id); this.parentNode = null; this.__removed = true; }
      };
      return el;
    },
    body,
    documentElement
  };
  const toasts = [];
  const consoleLines = [];
  const intervalFns = [];
  const win = {
    uns: k => 'sf_u::doctor@example.test::' + k,
    toast: m => toasts.push(String(m)),
    localStorage,
    addEventListener() {},
    removeEventListener() {}
  };
  if (validScope) {
    win.__mlsSessionAccount = 'doctor@example.test';
    win.__mlsSessionEpoch = 1;
  }
  const state = { persist: false, payload: 'C'.repeat(2000) };
  win.savePatients = function () { if (state.persist) map.set(win.uns('patients'), state.payload); };
  const consoleStub = {
    error: function () { consoleLines.push(Array.prototype.join.call(arguments, ' ')); },
    log: function () {}, warn: function () {}
  };
  const f = new Function('window', 'document', 'localStorage', 'setInterval', 'clearInterval', 'console', qvSrc);
  f(win, doc, localStorage, fn => { intervalFns.push(fn); return intervalFns.length; }, () => {}, consoleStub);
  return { win, doc, map, elements, toasts, consoleLines, intervalFns, state };
}

const CHIP_TEXT = "MLS couldn't verify the latest save on this device. Keep this tab open, check available storage, then retry the last action.";

{
  const h = bootQv();
  h.map.set('sf_u::doctor@example.test::patients', 'A'.repeat(1000));

  /* silent no-op: the write wants +4kB, the stored bytes do not move */
  h.win.savePatients(new Array(200).fill({ id: 1, name: 'x'.repeat(20) }));
  assert.ok(h.win.__mlsStoreWriteFailed && h.win.__mlsStoreWriteFailed.reason === 'local-write-unconfirmed',
    'baseline: qv-1.0 catches the swallowed-quota no-op (unchanged behavior)');

  /* 1a. the chip exists THE MOMENT the condition does */
  const chip = h.elements.get('mlsQuotaChip');
  assert.ok(chip, 'a persistent quota chip is rendered (old shape: NO surface rendered the flag - quotaUIVisible [])');
  assert.ok(String(chip.textContent).indexOf(CHIP_TEXT) === 0,
    'the chip carries the agreed text verbatim: "' + CHIP_TEXT + '"');
  assert.strictEqual(chip.attrs['data-mls-failure-count'], '1', 'the chip carries the failure count as bounded diagnostic metadata');
  assert.strictEqual(chip.attrs['data-mls-failure-code'], 'local-write-unconfirmed', 'the chip carries the closed failure code');
  assert.strictEqual(chip.attrs.role, 'alert', 'the chip announces itself to assistive tech');
  assert.ok(String(chip.style.cssText || '').indexOf('position:relative') >= 0,
    'the warning stays in normal layout rather than floating over controls');

  /* 1b. the console line names the store key */
  const diag = h.win.__mlsQuotaGuard.diagnostic();
  assert.strictEqual(diag.category, 'local-write-unconfirmed', 'diagnostics name the closed failure category');
  assert.strictEqual(diag.store, 'local', 'diagnostics name the failing store boundary without exposing an account key');

  /* 1c. heal ticks re-assert the chip (a rerender that removed it loses) */
  h.elements.delete('mlsQuotaChip');
  h.intervalFns.forEach(fn => fn());
  assert.ok(h.elements.get('mlsQuotaChip'),
    'the heal tick re-renders the chip while the flag is set - persistent means persistent');

  /* 1d. a verified write clears flag AND chip */
  h.state.persist = true;
  h.win.savePatients(new Array(200).fill({ id: 1, name: 'x'.repeat(20) }));
  assert.strictEqual(h.win.__mlsStoreWriteFailed, null, 'verified write clears the flag (unchanged qv-1.0 behavior)');
  h.intervalFns.forEach(fn => fn());
  assert.ok(!h.elements.get('mlsQuotaChip'),
    'the chip disappears only when the flag clears - and it does');

  /* 1e. revert() removes the chip with the guard */
  h.state.persist = false;
  h.map.set('sf_u::doctor@example.test::patients', 'A'.repeat(1000));
  h.win.savePatients(new Array(200).fill({ id: 2, name: 'y'.repeat(20) }));
  assert.ok(h.elements.get('mlsQuotaChip'), 'chip back for the revert case');
  h.win.__mlsQuotaGuard_revert();
  assert.ok(!h.elements.get('mlsQuotaChip'), 'revert() takes the chip down with the guard');

  console.log('ok 1 - quota chip: appears at failure, named text + count, survives rerender, clears with the flag, dies with revert');
}

/* An unresolved account scope must never arm a latch that could bleed into a
 * later signed-in account. The save still delegates; only the global verdict
 * is withheld until account + epoch + namespaced key agree. */
{
  const h = bootQv(false);
  h.map.set('sf_u::doctor@example.test::patients', 'A'.repeat(1000));
  h.win.savePatients(new Array(200).fill({ id: 9, name: 'z'.repeat(20) }));
  assert.strictEqual(h.win.__mlsStoreWriteFailed, undefined, 'unresolved session cannot arm a cross-account quota latch');
  assert.ok(!h.elements.get('mlsQuotaChip'), 'unresolved session cannot paint an accountless failure surface');
}

/* =========================================================================
 * PART 2: the dayPull quota preflight (schedimport __dayPullInner)
 * ========================================================================= */
function extractBraced(src, startToken, from) {
  const at = src.indexOf(startToken, from || 0);
  assert.ok(at >= 0, 'extractor found: ' + startToken);
  const open = src.indexOf('{', at);
  let depth = 0, mode = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i], p = src[i - 1];
    if (mode === null) {
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return src.slice(at, i + 1); }
      else if (c === "'" || c === '"' || c === '`') mode = c;
      else if (c === '/' && src[i + 1] === '/') { mode = '//'; i++; }
      else if (c === '/' && src[i + 1] === '*') { mode = '/*'; i++; }
    } else if (mode === '//') { if (c === '\n') mode = null; }
    else if (mode === '/*') { if (p === '*' && c === '/') mode = null; }
    else { if (c === '\\') i++; else if (c === mode) mode = null; }
  }
  throw new Error('unbalanced braces after ' + startToken);
}

const innerSrc = extractBraced(si, 'function __dayPullInner(opts, __armPresence)');

function buildInner(ctx) {
  const f = new Function('ctx',
    'var window = ctx.window;\n' +
    'var pullRunning = false;\n' +
    'var lastPullResult = null;\n' +
    'var monthPullRunning = false;\n' +
    'var p1MonthForeignOwner = function () { return null; };\n' +
    'var p1MonthOverlapRefusal = function () { return { ok:false, reason:"pull-in-flight" }; };\n' +
    'var p1MetadataRefusal = function () { return null; };\n' +
    'var isFn = function (x) { return typeof x === "function"; };\n' +
    'var normDate = function (d) { d = String(d || ""); return /^\\d{4}-\\d{2}-\\d{2}$/.test(d) ? d : ""; };\n' +
    'var safe = function (fn, fb) { try { return fn(); } catch (e) { return fb; } };\n' +
    'var foreignPullLease = function () { return null; };\n' +
    'var P1_DAY_CENSUS_TOKEN = {};\n' +
    'var _dayPreflightDone = true;\n' +
    'var warmUpDay = ctx.warmUpDay;\n' +
    'var accountProviderRequest = function () { return "all"; };\n' +
    'var _resolveDayScope = function () { return { ok: true, provider: "all" }; };\n' +
    'var providerRequest = function (x) { return { mode: x === "all" ? "all" : "selected" }; };\n' +
    'var rosterReceiptComplete = function () { return true; };\n' +
    'var p1OneTabPreflight = function () {};\n' +
    'var pull = ctx.pull;\n' +
    innerSrc + '\n' +
    'return { inner: __dayPullInner, getLastPullResult: function () { return lastPullResult; } };');
  return f(ctx);
}

(async function () {
  /* ---- 2a. flag set: loud, named, stamped, no navigation, no arm ---- */
  {
    const said = [];
    let warmed = false, pulled = false, armed = false;
    const ctx = {
      window: {
        __mlsStoreWriteFailed: { at: Date.now() - 300000, reason: 'silent-no-op' },
        __mlsQuotaGuard: { failures: 3 }
      },
      warmUpDay: () => { warmed = true; return Promise.resolve({}); },
      pull: () => { pulled = true; return Promise.resolve({ ok: true, marker: 'engine-ran' }); }
    };
    const h = buildInner(ctx);
    const res = await h.inner(
      { date: '2026-08-12', onStatus: (m, k) => said.push({ m: String(m), k: String(k || '') }) },
      () => { armed = true; });
    assert.strictEqual(res.ok, false, 'the pull is refused while writes are failing');
    assert.strictEqual(res.reason, 'storage-full-writes-failing',
      'the refusal has a NAMED reason (old shape: dayPull drove Athena while the store dropped every growing write)');
    assert.strictEqual(res.gate, 'quota-preflight', 'the refusal names its gate');
    assert.strictEqual(res.failures, 3, 'the refusal carries the guard failure count');
    assert.ok(said.some(s => s.k === 'err' && /could not verify the latest save/i.test(s.m)),
      'the refusal is SPOKEN through onStatus before any navigation');
    assert.ok(said.some(s => /No Athena navigation was started/.test(s.m)),
      'the spoken refusal tells the truth that nothing moved');
    assert.strictEqual(h.getLastPullResult(), res, 'the refusal is receipt-stamped into lastPullResult');
    assert.ok(ctx.window.__mlsPullLastOutcome && ctx.window.__mlsPullLastOutcome.ok === false,
      'the outcome stamp records the refusal');
    assert.ok(!warmed && !pulled, 'no warm-up and no engine call: Athena was never driven');
    assert.ok(!armed, 'a quota-refused call never arms presence assist (arm-inside-the-mutex law)');
    console.log('ok 2 - quota preflight refuses loudly before driving Athena');
  }

  /* ---- 2b. flag clear: a healthy store is never blocked ---- */
  {
    let pulled = false;
    const ctx = {
      window: {},
      warmUpDay: () => Promise.resolve({}),
      pull: () => { pulled = true; return Promise.resolve({ ok: true, marker: 'engine-ran' }); }
    };
    const h = buildInner(ctx);
    const res = await h.inner({ date: '2026-08-12', onStatus: () => {} }, null);
    assert.strictEqual(res.ok, true, 'a healthy store pulls normally');
    assert.ok(pulled, 'the engine ran');
    console.log('ok 3 - healthy store never blocked by the quota gate');
  }

  console.log('# quota-surface-chip-and-preflight: 3 groups passed');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
