'use strict';
/* surg-1.0.0 control: A SECOND openSetup() NEVER WIPES TYPED WORK.
 *
 * Reported: "setup retry loses entered information". Mechanism: openSetup()
 * was fully re-entrant — the persistent header button (#ptSetupBtn), the
 * auto-prompt timer (maybePromptSetup) and the error-state Retry all call it,
 * and every call re-ran suPrefill() (overwriting all eight wizard inputs from
 * storage) and re-derived SU_STEP (rewinding the visible step). surg-1.0.0:
 * an already-open, healthily-loaded wizard makes duplicate calls no-ops; an
 * in-flight latch absorbs concurrent opens into ONE fetch; the load-failure
 * Retry still re-fetches; closeSetup resets the latch so a genuine reopen
 * prefills fresh.
 *
 * Executes the REAL shipped openSetup/suOpenSetupRun/closeSetup (extracted
 * from ScribeFlow.html) with stubbed transport/prefill. OLD BYTES FAIL THE
 * EXTRACTION BY NAME (no suOpenSetupRun) and case 2 behaviorally. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function extractFn(marker) {
  const at = src.indexOf(marker);
  assert.ok(at >= 0, marker + ' present in ScribeFlow.html');
  const open = src.indexOf('{', at + marker.length - 1);
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
  throw new Error('unbalanced ' + marker);
}

const openSrc = extractFn('async function openSetup(autoOpen)');
const runSrc = extractFn('async function suOpenSetupRun(automatic,m)');
const closeSrc = extractFn('async function closeSetup(reason)');
assert.ok(openSrc.includes("openSetup._inFlight"), 'openSetup carries the in-flight latch');
assert.ok(openSrc.includes("openSetup._loaded===true"), 'openSetup carries the healthy-open no-op guard');
assert.ok(closeSrc.includes('openSetup._loaded=false'), 'closeSetup resets the latch');

function el(id) {
  return { id, value: '', disabled: false, textContent: '', style: {}, dataset: {},
    classList: { _s: new Set(), add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); }, contains(c) { return this._s.has(c); } } };
}

function makeHarness() {
  const nodes = {};
  ['setupModal', 'setupMsg', 'su_nextBtn', 'su_retryBtn', 'su_name'].forEach(id => { nodes[id] = el(id); });
  const state = { getCalls: 0, prefills: 0, shows: 0, pendingResolvers: [], failNext: false };
  const ctx = vm.createContext({
    document: { getElementById: id => nodes[id] || null },
    SU_STATUS: { NOT_STARTED: 'not_started', IN_PROGRESS: 'in_progress', DEFERRED: 'deferred', COMPLETED: 'completed' },
    SU_STATE: { status: 'not_started', completedSteps: [], capabilities: {} },
    SU_STEP: 0,
    bkUser: null,
    suOnboardingRequest: function () {
      state.getCalls++;
      if (state.failNext) { state.failNext = false; return Promise.reject(new Error('Failed to fetch')); }
      return new Promise(resolve => { state.pendingResolvers.push(resolve); });
    },
    suActionableError: e => String((e && e.message) || e || 'error'),
    suPrefill: function () { state.prefills++; nodes.su_name.value = 'FROM-STORAGE'; },
    suResumeStep: () => 1,
    suApplyCapabilityUI: () => {},
    suShow: function () { state.shows++; },
    backendMode: () => false,
    bkToken: () => '',
    suSaveOnboarding: () => Promise.resolve(),
    toast: () => {},
    Promise, Object, String, Array
  });
  vm.runInContext(openSrc + '\n' + runSrc + '\n' + closeSrc, ctx, { filename: 'ScribeFlow:setup-open' });
  return {
    nodes, state, ctx,
    open: auto => vm.runInContext('openSetup(' + (auto === true) + ')', ctx),
    close: () => vm.runInContext("closeSetup('')", ctx),
    settlePending: () => { const r = state.pendingResolvers.splice(0); r.forEach(fn => fn()); return new Promise(res => setImmediate(res)); }
  };
}

(async function () {
  let n = 0;
  const ok = m => { n++; console.log('ok ' + n + ' - ' + m); };

  /* ---- 1. first open loads and prefills once ---- */
  const h = makeHarness();
  const p1 = h.open(false);
  await h.settlePending();
  assert.strictEqual(await p1, true, 'first open succeeds');
  assert.strictEqual(h.state.prefills, 1, 'first open prefills once');
  assert.ok(h.nodes.setupModal.classList.contains('show'), 'wizard on screen');
  ok('first open: one fetch, one prefill, wizard shown');

  /* ---- 2. THE REPORTED DEFECT: duplicate call keeps typed work + step ---- */
  h.nodes.su_name.value = 'TYPED-BY-THE-DOCTOR';
  h.ctx.SU_STEP = 3;
  const p2 = h.open(false);
  assert.strictEqual(await p2, true, 'duplicate open reports success');
  assert.strictEqual(h.state.getCalls, 1, 'duplicate open issued NO second fetch');
  assert.strictEqual(h.state.prefills, 1, 'duplicate open did NOT re-prefill (old shape wiped all eight inputs here)');
  assert.strictEqual(h.nodes.su_name.value, 'TYPED-BY-THE-DOCTOR', 'typed-but-unsaved value preserved');
  assert.strictEqual(vm.runInContext('SU_STEP', h.ctx), 3, 'visible step not rewound');
  ok('duplicate open while healthy: no fetch, no prefill, typed value and step intact');

  /* ---- 3. concurrent opens during the fetch join one run ---- */
  const h3 = makeHarness();
  const a = h3.open(false); const b = h3.open(false);
  assert.strictEqual(h3.state.getCalls, 1, 'two concurrent opens issued ONE fetch');
  await h3.settlePending();
  assert.strictEqual(await a, true); assert.strictEqual(await b, true);
  assert.strictEqual(h3.state.prefills, 1, 'one prefill for the joined open');
  ok('concurrent opens join the in-flight run: one fetch, one prefill');

  /* ---- 4. load failure keeps Retry able to re-fetch ---- */
  const h4 = makeHarness();
  h4.state.failNext = true;
  assert.strictEqual(await h4.open(false), false, 'failed load reports false');
  assert.strictEqual(h4.nodes.su_retryBtn.style.display, '', 'Retry visible after the failure');
  assert.strictEqual(h4.state.prefills, 0, 'no prefill on the failure path');
  const p4 = h4.open(false);
  assert.strictEqual(h4.state.getCalls, 2, 'Retry re-fetches (the guard does not eat the retry)');
  await h4.settlePending();
  assert.strictEqual(await p4, true, 'retry succeeds');
  assert.strictEqual(h4.state.prefills, 1, 'retry prefills the freshly-shown form');
  ok('load-failure Retry still re-fetches and then prefills the fresh form');

  /* ---- 5. close then reopen prefills fresh ---- */
  await h.close();
  assert.ok(!h.nodes.setupModal.classList.contains('show'), 'closed');
  const p5 = h.open(false);
  assert.strictEqual(h.state.getCalls, 2, 'reopen after close re-fetches');
  await h.settlePending();
  assert.strictEqual(await p5, true);
  assert.strictEqual(h.state.prefills, 2, 'reopen after close prefills fresh');
  assert.strictEqual(h.nodes.su_name.value, 'FROM-STORAGE', 'fresh open renders stored values again');
  ok('close resets the latch: a genuine reopen loads and prefills fresh');

  console.log('PASS setup-open re-entrancy: duplicate opens are no-ops that preserve typed work and step, concurrent opens join one run, Retry still re-fetches, close resets the latch (' + n + ' cases)');
})().catch(err => { console.error(err.stack || err); process.exit(1); });
