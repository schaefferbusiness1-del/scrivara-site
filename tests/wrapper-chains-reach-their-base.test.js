'use strict';

/* No wrapper chain may eat itself — swept across every SHIPPED module.
 * ===========================================================================
 * b870 fixed ONE instance of a class: two modules wrapped renderProfile, called
 * each other to stack overflow, and the app's own function never ran. This
 * suite proves the class is absent everywhere rather than fixing instances as
 * users trip over them.
 *
 * A cycle needs three things in one module:
 *   (a) it wraps an app function that another LOADED module also wraps,
 *   (b) its wrap guard reads a marker off `window.<fn>` — what is CURRENTLY on
 *       window — instead of a module-level once-flag, and
 *   (c) something RE-RUNS that wrap (timer, interval, observer).
 * Then any co-wrapper that does not carry the marker forward makes the re-arm
 * re-point a MODULE-LEVEL orig that the already-installed wrapper still reads
 * at call time, and the two wrappers call each other forever.
 *
 * SHIPPED-ONLY, and that qualifier is load-bearing. The repo carries 50 dead
 * feat_*.js files that nothing references. Counting them manufactures cycles
 * that cannot happen: feat_mls_navfeat_keep.js "cycles" with apptabs_menu over
 * setNavFeat, but it is referenced 0 times and never reaches a browser. A sweep
 * that cannot tell shipped from dead reports fiction.
 *
 * The test EXECUTES each contested function's real modules together, in both
 * load orders, with the polls replayed — then calls the function once and
 * counts how many times the app's own implementation is reached.
 *   1 = healthy.   0 = the chain ate itself (this is what b869 did).
 * Order matters: both b870's defect and the two found by this sweep were
 * broken in ONE order and clean in the other, which is exactly why they
 * survived review and reached a doctor.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const allFeat = fs.readdirSync(root).filter(f => /^feat_.*\.js$/.test(f));

const shipped = allFeat.filter(f => {
  const re = new RegExp('["\'`]' + f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return re.test(connect) || re.test(shell);
});
assert(shipped.length > 100, 'shipped-module detection collapsed: only ' + shipped.length + ' of ' + allFeat.length);

/* (fn -> modules that wrap it), shipped only */
const CAPTURE = /([A-Za-z_$][\w$]*)\s*=\s*window\.([A-Za-z_$][\w$]*)\s*[;,)]/g;
const wraps = new Map();
for (const file of shipped) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const captured = new Set();
  let m; CAPTURE.lastIndex = 0;
  while ((m = CAPTURE.exec(src))) if (/orig|^_mls|^prior|^old|^base/i.test(m[1])) captured.add(m[2]);
  for (const fn of captured) {
    if (!new RegExp('window\\.' + fn + '\\s*=').test(src)) continue;
    if (!wraps.has(fn)) wraps.set(fn, []);
    wraps.get(fn).push(file);
  }
}
const contested = [...wraps.entries()].filter(([, mods]) => mods.length > 1);
assert(contested.length >= 8,
  'only ' + contested.length + ' contested functions found — the detector went blind, which would make this suite pass vacuously');

/* ---------------- stub DOM + deterministic timers ---------------- */
function makeNode() {
  const n = {
    tagName: 'DIV', id: '', className: '', style: {}, textContent: '', innerHTML: '',
    children: [], parentNode: null, dataset: {},
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() { return false; } },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    appendChild(c) { n.children.push(c); return c; }, insertBefore(c) { n.children.unshift(c); return c; },
    removeChild(c) { n.children = n.children.filter(x => x !== c); return c; }, remove() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, contains() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    focus() {}, click() {}
  };
  return n;
}
function makeSandbox(fnName) {
  const timers = [];
  const store = {};
  const document = {
    readyState: 'complete', body: makeNode(), head: makeNode(), documentElement: makeNode(),
    createElement: makeNode, createTextNode: t => ({ textContent: t }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {}
  };
  const sb = {
    document, console: { log() {}, warn() {}, error() {} },
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    requestAnimationFrame: fn => { timers.push({ kind: 't', fn }); return 1; },
    cancelAnimationFrame() {},
    requestIdleCallback: fn => { timers.push({ kind: 't', fn }); return 1; },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    setTimeout: fn => { timers.push({ kind: 't', fn }); return timers.length; },
    clearTimeout() {},
    setInterval: fn => { const h = { kind: 'i', fn, live: true }; timers.push(h); return h; },
    clearInterval: h => { if (h && typeof h === 'object') h.live = false; },
    localStorage: {
      getItem: k => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; }
    },
    fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}), text: () => Promise.resolve('') }),
    __baseCalls: 0
  };
  sb.window = sb; sb.self = sb; sb.globalThis = sb;
  sb[fnName] = function () { sb.__baseCalls++; return 'base'; };
  sb.__drain = () => { for (const t of timers.slice()) if (t.kind === 't') { try { t.fn(); } catch (e) {} } };
  sb.__tick = r => { for (let i = 0; i < r; i++) for (const t of timers.slice()) if (t.kind === 'i' && t.live) { try { t.fn(); } catch (e) {} } };
  return sb;
}

const failures = [];
let checked = 0;
for (const [fn, mods] of contested) {
  for (const order of [mods, mods.slice().reverse()]) {
    const ctx = vm.createContext(makeSandbox(fn));
    for (const f of order) {
      try { vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f }); } catch (e) {}
    }
    ctx.__drain();
    ctx.__tick(3);          /* replay the bounded polls that re-arm the wraps */
    ctx.__baseCalls = 0;
    let threw = null;
    try { ctx[fn](); } catch (e) { threw = e.name + ': ' + e.message; }
    checked++;
    if (ctx.__baseCalls !== 1) {
      failures.push(fn + ' reached its base ' + ctx.__baseCalls + ' times' +
        (threw ? ' (' + threw + ')' : '') + ' — load order: ' + order.join(' -> '));
    }
  }
}

assert.deepStrictEqual(
  failures, [],
  'wrapper chain(s) do not reach the app function exactly once:\n  ' + failures.join('\n  ')
);

/* The two instances this sweep found, named so a regression is legible.
   feat_mls_upnow_realtime.js drives the Up-Next hero and today's patient list;
   both of its cycles were silent. */
const unr = fs.readFileSync(path.join(root, 'feat_mls_upnow_realtime.js'), 'utf8');
assert(/var _didAutoPos = false, _didLoadNextUp = false, _didRenderGuard = false;/.test(unr),
  'feat_mls_upnow_realtime.js must keep a wrap-once flag per installer');
for (const g of ['_didAutoPos', '_didLoadNextUp', '_didRenderGuard']) {
  assert(new RegExp('if \\(' + g + '\\) return;').test(unr),
    'feat_mls_upnow_realtime.js must return early on ' + g + ' before touching window');
}
assert(connect.includes("feat_mls_upnow_realtime.js?v='+(window.__MLS_AV||Date.now())"),
  'mls-connect.js must cache-bust feat_mls_upnow_realtime.js with the shared build token');
assert(!connect.includes('20260723unr110'),
  'the pre-fix upnow-realtime pin is still in mls-connect.js — returning browsers keep the cycling build');

console.log('PASS wrapper chains reach their base: ' + contested.length + ' contested functions across ' +
  shipped.length + ' shipped modules (' + (allFeat.length - shipped.length) + ' dead files excluded), ' +
  checked + ' load orders, every chain reaches its base exactly once');
