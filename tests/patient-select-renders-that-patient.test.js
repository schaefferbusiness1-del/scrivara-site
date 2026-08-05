'use strict';

/* Clicking a name on the left MUST render that patient on the right.
 * ===========================================================================
 * Owner report, 2026-08-05, with a screenshot of the live b869 app: the left
 * Patients list moved its ACTIVE badge to the clicked patient while the right
 * pane kept the PREVIOUS patient's name, MRN and clinical fields. Measured in
 * real Chrome on the shipped bytes: one renderProfile() call made 8,529
 * document.getElementById('profileCard') calls and never once asked for
 * '#profName' — the app's own render body never executed.
 *
 * MECHANISM (stack captured mid-recursion, frames alternating):
 *     w (feat_mls_visit_focus.js)  ->  w (feat_mls_visit_timeline.js)
 *     w (feat_mls_visit_focus.js)  ->  w (feat_mls_visit_timeline.js)  -> ...
 *
 * Four modules wrap renderProfile. visit_focus guarded on "is MY marker on
 * window.renderProfile" and re-armed on timers at 1.5s/4s/9s, while
 * visit_timeline wrapped over it WITHOUT carrying that marker forward. So the
 * retry saw an unmarked head, re-wrapped, and re-pointed the MODULE-LEVEL
 * `origRenderProfile` that its FIRST wrapper also reads at call time. The two
 * wrappers then called each other until the stack overflowed. The RangeError
 * was swallowed by visit_timeline's bare `catch (e) {}`, so a completely dead
 * profile pane raised nothing anywhere.
 *
 * feat_mls_b121_pack.js had already written this law down after the same cycle
 * blew the stack once before. b869 pushed both modules onto requestIdleCallback
 * ("deferred past first paint"), which put the two wraps back inside the retry
 * window and the cycle returned.
 *
 * This suite EXECUTES the two real module files against a stub DOM with
 * deterministic timers, so it fails on behaviour, not on wording. Three fences:
 *   1. the app's own renderProfile runs EXACTLY ONCE per call, after every
 *      retry has fired — the cycle cannot come back unnoticed;
 *   2. a throw from the chain is RECORDED, never silently eaten;
 *   3. the profile summary's repaint signature carries the patient's identity,
 *      so "different patient" always repaints regardless of tile values.
 * Plus the cache-bust pin, because a fix the browser never downloads is not a
 * fix (SHIPPED BUT NEVER SERVED).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

const focusSrc = read('feat_mls_visit_focus.js');
const timelineSrc = read('feat_mls_visit_timeline.js');
const connectSrc = read('mls-connect.js');

/* ------------------------------------------------------------------ 1. source
 * The runtime fences below are the real proof. These two only name the shape
 * that makes the runtime safe, so a future edit that removes it is legible in
 * the diff rather than only in a failing simulation. */

assert(
  /var\s+renderProfileWrapped\s*=\s*false\s*;/.test(focusSrc),
  'feat_mls_visit_focus.js must keep a wrap-once flag — guarding only on a marker read off window is what let the timed re-arm rebuild the cycle'
);
assert(
  /function wrapRenderProfile\(\)\s*\{\s*if \(renderProfileWrapped\) return;/.test(focusSrc),
  'feat_mls_visit_focus.js wrapRenderProfile must return early on its own wrap-once flag BEFORE looking at window.renderProfile'
);
assert(
  /var CARRY = \[[^\]]*'__vfWrapped'[^\]]*\]/.test(timelineSrc),
  'feat_mls_visit_timeline.js must carry __vfWrapped forward so no other module sees an unmarked head and re-wraps'
);
assert(
  !/try \{ r = origRender\.apply\(this, arguments\); \} catch \(e\) \{\}/.test(timelineSrc),
  'feat_mls_visit_timeline.js must not swallow a renderProfile throw silently — that is what hid a dead profile pane'
);
assert(
  /renderErrors/.test(timelineSrc) && /lastRenderError/.test(timelineSrc),
  'feat_mls_visit_timeline.js must expose renderErrors/lastRenderError as the receipt for a chain that threw'
);

/* SHIPPED BUT NEVER SERVED: feat_mls_visit_timeline.js is loaded with a frozen
 * literal ?v= pin, so its bytes only reach a returning browser when that pin
 * moves. feat_mls_visit_focus.js rides window.__MLS_AV and moves with the build. */
assert(
  connectSrc.includes("feat_mls_visit_timeline.js?v=20260805vtl103"),
  'mls-connect.js must cache-bust feat_mls_visit_timeline.js to the vtl-1.0.3 fix'
);
assert(
  !connectSrc.includes('20260712vtl102c1'),
  'the pre-fix visit-timeline pin is still in mls-connect.js — returning browsers would keep the cycling build'
);
assert(timelineSrc.includes("var VERSION = 'vtl-1.0.3'"), 'visit-timeline version must match its pin');
assert(focusSrc.includes("var VER = 'vf-1.2.1'"), 'visit-focus must advertise the wrap-once release');

/* ------------------------------------------------- 2. runtime: stub DOM + vm
 * jsdom-free hand-rolled DOM (repo convention). Both modules wrap every DOM
 * touch in their own safe(), so an unimplemented corner degrades instead of
 * throwing — which is exactly how they behave in a browser mid-boot. */

function makeNode(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    className: '',
    style: {},
    textContent: '',
    innerHTML: '',
    children: [],
    parentNode: null,
    dataset: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); },
      remove(c) { this._set.delete(c); },
      contains(c) { return this._set.has(c); },
      toggle(c, on) { if (on === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); return this._set.has(c); } if (on) this._set.add(c); else this._set.delete(c); return !!on; }
    },
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    appendChild(child) { child.parentNode = node; node.children.push(child); return child; },
    insertBefore(child) { child.parentNode = node; node.children.unshift(child); return child; },
    removeChild(child) { node.children = node.children.filter(c => c !== child); return child; },
    remove() { if (node.parentNode) node.parentNode.removeChild(node); },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    contains() { return false; },
    getBoundingClientRect() { return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; },
    focus() {},
    click() {}
  };
  return node;
}

/* Deterministic clock: every setTimeout/setInterval is captured, never real, so
 * the retry schedule that produced the cycle is replayed exactly. */
function makeSandbox() {
  const byId = new Map();
  const timeouts = [];
  const intervals = [];

  const body = makeNode('body');
  const head = makeNode('head');
  const document = {
    readyState: 'complete',
    body,
    head,
    documentElement: makeNode('html'),
    createElement: makeNode,
    createTextNode: t => ({ textContent: t }),
    getElementById: id => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };

  const sandbox = {
    document,
    console: { log() {}, warn() {}, error() {} },
    MutationObserver: function () { return { observe() {}, disconnect() {} }; },
    requestAnimationFrame: fn => { timeouts.push({ at: 0, fn }); return 1; },
    cancelAnimationFrame() {},
    requestIdleCallback: fn => { timeouts.push({ at: 0, fn }); return 1; },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    setTimeout: (fn, ms) => { timeouts.push({ at: Number(ms) || 0, fn }); return timeouts.length; },
    clearTimeout() {},
    setInterval: (fn, ms) => { intervals.push({ every: Number(ms) || 0, fn }); return intervals.length; },
    clearInterval() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    /* the four fences below are what the test actually reads */
    __baseCalls: 0,
    __renderedFor: '',
    __activeId: 'patient-one'
  };
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.globalThis = sandbox;

  /* the app's own render — the thing that MUST run when a patient is clicked */
  sandbox.renderProfile = function () {
    sandbox.__baseCalls++;
    sandbox.__renderedFor = sandbox.__activeId;
  };

  sandbox.__flush = function (uptoMs) {
    /* fire every captured timer whose delay is within the window, once, in
       schedule order — the browser's own ordering for these three retries */
    const due = timeouts.filter(t => t.at <= uptoMs);
    timeouts.length = 0;
    due.forEach(t => { try { t.fn(); } catch (e) {} });
  };
  sandbox.__addNode = function (id) {
    const n = makeNode('div');
    n.id = id;
    byId.set(id, n);
    return n;
  };
  return sandbox;
}

const ctx = vm.createContext(makeSandbox());
ctx.__addNode('profileCard');

vm.runInContext(focusSrc, ctx, { filename: 'feat_mls_visit_focus.js' });
assert.strictEqual(ctx.__mlsVisitFocus && ctx.__mlsVisitFocus.version, 'vf-1.2.1', 'visit-focus did not install in the sandbox');

vm.runInContext(timelineSrc, ctx, { filename: 'feat_mls_visit_timeline.js' });
assert.strictEqual(ctx.__mlsVisitTimeline && ctx.__mlsVisitTimeline.version, 'vtl-1.0.3', 'visit-timeline did not install in the sandbox');

/* visit_timeline has now wrapped OVER visit_focus. Replay every visit_focus
   retry (1.5s, 4s, 9s) plus the timeline's own poll — the exact sequence that
   used to rebuild the cycle. */
ctx.__flush(10000);
ctx.__flush(10000);

/* FENCE 1 — one click, one render of the app's own body. Pre-fix this recursed
   until the stack overflowed and the base never ran at all (baseCalls === 0). */
ctx.__baseCalls = 0;
ctx.__activeId = 'patient-two';
ctx.renderProfile();
assert.strictEqual(
  ctx.__baseCalls,
  1,
  'renderProfile ran ' + ctx.__baseCalls + ' times for one call — the wrapper chain is cycling again, and the profile pane will not follow the clicked patient'
);
assert.strictEqual(ctx.__renderedFor, 'patient-two', 'the profile rendered for the wrong patient');

/* FENCE 2 — switching patients repeatedly stays at exactly one render each,
   after every retry has already fired. One case is not a proof. */
['patient-three', 'patient-four', 'patient-five', 'patient-two'].forEach(id => {
  ctx.__baseCalls = 0;
  ctx.__activeId = id;
  ctx.renderProfile();
  assert.strictEqual(ctx.__baseCalls, 1, 'renderProfile did not run exactly once when selecting ' + id);
  assert.strictEqual(ctx.__renderedFor, id, 'the profile did not follow the selection to ' + id);
});

/* FENCE 3 — a throw from below is RECORDED, not eaten. A fresh sandbox whose
   base render throws the very error the cycle produced: the receipt is what
   turns "the pane is dead" from invisible into readable, in a live tab and in
   the UI sweeps. */
assert.strictEqual(ctx.__mlsVisitTimeline.renderErrors, 0, 'no chain error should have been recorded on a healthy run');

const throwCtx = vm.createContext(makeSandbox());
throwCtx.__addNode('profileCard');
throwCtx.renderProfile = function () {
  throwCtx.__baseCalls++;
  throw new RangeError('Maximum call stack size exceeded');
};
vm.runInContext(focusSrc, throwCtx, { filename: 'feat_mls_visit_focus.js' });
vm.runInContext(timelineSrc, throwCtx, { filename: 'feat_mls_visit_timeline.js' });
throwCtx.__flush(10000);
throwCtx.renderProfile();
assert.strictEqual(throwCtx.__mlsVisitTimeline.renderErrors, 1, 'a throw from the renderProfile chain must be counted, not swallowed');
assert(
  /Maximum call stack size exceeded/.test(throwCtx.__mlsVisitTimeline.lastRenderError),
  'the recorded receipt must name the actual error: got ' + JSON.stringify(throwCtx.__mlsVisitTimeline.lastRenderError)
);

/* --------------------------------------- 3. the profile summary keeps identity
 * __mlsProfCalm repaints the seven quick tiles only when their signature
 * changes. Built from the tile VALUES alone the signature carried no identity,
 * and qtxt() truncates at 220/120/90/60 chars — two charts agreeing only up to
 * the cut collided and the second kept the first's text. */
assert(
  /var sig = \(p \? String\(p\.id\) : ''\) \+ '\|' \+ boxes\.map/.test(connectSrc),
  "the pf2 quick-row signature must lead with the patient id — a signature of tile values alone cannot tell 'same values' from 'same chart'"
);
assert(
  !/var sig = boxes\.map\(function \(b\) \{ return b\[1\]; \}\)\.join\('\|'\);/.test(connectSrc),
  'the identity-free quick-row signature is back in mls-connect.js'
);

/* A source file with a NUL byte is corrupt no matter how it parses: it turns
   every text tool binary and does not survive every transfer path intact. */
const NUL = String.fromCharCode(0);
[['mls-connect.js', connectSrc], ['feat_mls_visit_focus.js', focusSrc], ['feat_mls_visit_timeline.js', timelineSrc]]
  .forEach(([name, src]) => {
    assert(src.indexOf(NUL) === -1, name + ' contains a NUL byte');
  });

console.log('PASS patient-select-renders-that-patient: one click -> exactly one render, 5 patients, chain errors recorded, summary keyed by identity');
