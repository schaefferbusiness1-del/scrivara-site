'use strict';

/* opbatch-1.0.0 - "a bunch of op notes at the same time", proved.
 *
 * Owner, 2026-08-31, verbatim:
 *   "for the op notes wirght to atehna i sohuld be ab le to write a bunch of
 *    op ntoes at teh saem time."
 *
 * WHAT THIS SUITE DRIVES. Nothing here is re-implemented. It runs:
 *   - the REAL 1p-feat_mls_writeflow.js in a VM (the unified review sheet, its
 *     read-only probe ladder, its execute, its receipts, and the new
 *     opbatch-1.0.0 cross-note queue), against a fake MLS Assist - no browser,
 *     no athenaOne, no PHI;
 *   - the REAL pushHistoryNoteToAthena / _athenaPushPlan / _athenaShowReceipt
 *     sliced out of the shipped 1p twins, so the queue's ONE entry point is
 *     the same code a human press goes through;
 *   - the REAL athSendable() sliced out of the shipped op-note room block, so
 *     the count on the button is the shipped count.
 *
 * WHAT IT PINS, and why each one is a safety property and not a nicety:
 *
 *   1. QUEUE ORDERING. The notes run in the order the room paints them, one at
 *      a time, each through its own sheet: N opens, N probes, N executes, N
 *      receipts - never two writes in flight.
 *   2. PER-NOTE GATE ISOLATION. A note whose read-only check refuses is
 *      SKIPPED with the sheet's own words recorded and shown, and the notes
 *      after it still run. A refusal must never become a queue-wide failure,
 *      and it must never become a silent one.
 *   3. CANCEL BETWEEN NOTES, NEVER MID-WRITE. A cancel raised while a note is
 *      being written lets THAT note finish and produce its receipt; nothing
 *      after it opens.
 *   4. THE PULL REFUSAL. A running pull/import refuses the whole queue before
 *      a single message is posted.
 *   5. NO SECOND EXECUTE PATH. The block's only two verbs into the write lane
 *      are pushHistoryNoteToAthena() and runUnifiedPrimarySend() - the same
 *      call the sheet's own button makes. It never touches the bridge, never
 *      builds a manifest, never probes and never executes on its own.
 *   6. SIGN AND SAVE ARE NEVER QUEUED. OPBATCH_ACTIONS is a CLOSED allowlist,
 *      the guard that reads it runs BEFORE the press, and no message a whole
 *      run emits carries any action but the reviewed note write.
 *
 * Not registered in tests/run-all.js by this lane - the parent registers it.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW_FILE = '1p-feat_mls_writeflow.js';
const FLOW = fs.readFileSync(path.join(ROOT, FLOW_FILE), 'utf8');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
const SHELL_SRC = {};
SHELLS.forEach((s) => { SHELL_SRC[s] = fs.readFileSync(path.join(ROOT, s), 'utf8'); });

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* The repo's own balanced-brace slicer (athena-crosslayer-bridge-payload):
   comment- and string-aware, so a brace inside a comment cannot end a body. */
function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function marker: ' + marker);
  const open = source.indexOf('{', start);
  assert(open > start, 'missing function body: ' + marker);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unbalanced function: ' + marker);
  return '';
}

const OPBATCH_OPEN = '/* ===== opbatch-1.0.0';
const OPBATCH_CLOSE = '/* ===== end opbatch-1.0.0';
const BLOCK = FLOW.slice(FLOW.indexOf(OPBATCH_OPEN), FLOW.indexOf(OPBATCH_CLOSE));

/* ============================================================ PART 0: source
 * The properties a runtime cannot prove: that there is no OTHER way out of
 * this block, and that the allowlist is closed. */
{
  eq(FLOW.split(OPBATCH_OPEN).length - 1, 1, FLOW_FILE + ': the opbatch block must open exactly once');
  eq(FLOW.split(OPBATCH_CLOSE).length - 1, 1, FLOW_FILE + ': the opbatch block must close exactly once');
  ok(FLOW.indexOf(OPBATCH_OPEN) < FLOW.indexOf(OPBATCH_CLOSE), FLOW_FILE + ': the opbatch block closes before it opens');
  ok(BLOCK.length > 4000, 'the opbatch slice is suspiciously small: ' + BLOCK.length + ' bytes');

  /* THE CLOSED PIN, evaluated out of the shipped source rather than trusted. */
  const allowLit = /var OPBATCH_ACTIONS = (\{[^\n]*\});/.exec(BLOCK);
  ok(allowLit, 'the opbatch block lost its OPBATCH_ACTIONS allowlist literal');
  const allow = eval('(' + allowLit[1] + ')'); /* eslint-disable-line no-eval */
  assert.deepStrictEqual(Object.keys(allow).sort(), ['save_draft', 'write_note'],
    'OPBATCH_ACTIONS is not exactly {write_note, save_draft} - a batch may drive nothing else: ' + allowLit[1]);
  checks++;
  for (const forbidden of ['sign_encounter', 'stage_billing', 'place_order']) {
    eq(Object.prototype.hasOwnProperty.call(allow, forbidden), false,
      'OPBATCH_ACTIONS admits ' + forbidden + ' - Sign & Save, billing and orders are never batchable');
    eq(BLOCK.indexOf("'" + forbidden + "'"), -1,
      'the opbatch block names the action ' + forbidden + ' - it must not be able to emit or select it');
  }

  /* NO SECOND EXECUTE PATH. Everything below is a way to reach Athena that
     this block must NOT have of its own. */
  for (const verb of ['bridge(', 'postMessage', 'mlsAppAthenaActionV2', 'mlsAppSearchOpenPatient',
    'executeUnifiedSelection', 'startAthenaAction', 'runUnifiedBatchSend', 'probeUnifiedRow',
    'buildUnifiedManifest', 'openUnifiedConfirmation(']) {
    eq(BLOCK.indexOf(verb), -1, 'the opbatch block reaches Athena through ' + verb + ' instead of the existing single-note press');
  }
  /* ... and exactly the two verbs it MUST have. */
  eq(BLOCK.split('window.pushHistoryNoteToAthena(item.id)').length - 1, 1,
    'the opbatch block must open each review through exactly one call to the app\'s own pushHistoryNoteToAthena');
  eq(BLOCK.split('runUnifiedPrimarySend(st2, null)').length - 1, 1,
    'the opbatch block must press the sheet\'s own primary exactly once per note, through the shipped router');
  const step = extractFunction(BLOCK, '  function opBatchStep(run, i) {');
  ok(step.indexOf('OPBATCH_ACTIONS[') > 0 && step.indexOf('OPBATCH_ACTIONS[') < step.indexOf('runUnifiedPrimarySend('),
    'the closed-allowlist guard does not run BEFORE the press - a non-batchable action could be driven');
  ok(step.indexOf('closeUnifiedConfirmation') < 0 || step.indexOf('opBatchCloseSheet') > 0,
    'the step closes the sheet by hand instead of through the one close helper');
  /* CANCEL IS READ BETWEEN NOTES ONLY. */
  const next = extractFunction(BLOCK, '  function opBatchNext(run, i) {');
  ok(/if \(run\.cancel\) \{ opBatchFinish\(run\); return; \}/.test(next),
    'the between-notes stop is gone from opBatchNext');
  /* The write stretch may SET run.cancel (the uncertain-outcome halt stops the
     queue after this note) but must never READ it as a reason to abandon the
     write it is waiting on. */
  const write = step.slice(step.indexOf('runUnifiedPrimarySend(st2, null)'));
  eq(/if \(run\.cancel/.test(write), false,
    'the write wait branches on the cancel flag - a cancel must never abandon a write that has already started');
  ok(/run\.cancel = true;/.test(write), 'the uncertain-outcome halt no longer stops the queue after the note it happened on');

  eq(FLOW.split('window.__mlsOpBatchSend = OPBATCH_API;').length - 1, 1,
    FLOW_FILE + ': the public seam window.__mlsOpBatchSend must be published exactly once');

  /* THE ENTRY POINT, in BOTH twins, byte-identically. */
  const spans = SHELLS.map((s) => {
    const src = SHELL_SRC[s];
    return src.slice(src.indexOf('<!-- ===== opnote-day-4.0.0'), src.indexOf('<!-- ===== end opnote-day-4.0.0'));
  });
  eq(spans[0], spans[1], 'the two 1p twins carry different opnote-day-4.0.0 blocks - they must stay byte-identical');
  SHELLS.forEach((shell, i) => {
    const day = spans[i];
    ok(day.indexOf("id=\"mlsOpnAthAll\"") > 0, shell + ': the op-note room has no "send them all to Athena" control');
    ok(/rail\.querySelector\('#mlsOpnAthAll'\)\.addEventListener\('click', function \(\) \{ runAthenaAll\(\); \}, false\);/.test(day),
      shell + ': the send-all control is not wired to runAthenaAll()');
    const send = extractFunction(day, '  function athSendable() {');
    ok(send.indexOf('filedRecord(') > 0 && send.indexOf('blanksLeft(') > 0,
      shell + ': athSendable() no longer uses the room\'s own filed-record and blank-token tests');
    const run = extractFunction(day, '  function runAthenaAll() {');
    ok(run.indexOf('batch.start({ noteIds: ids })') > 0, shell + ': runAthenaAll() does not hand its ids to the one queue driver');
    for (const verb of ['pushHistoryNoteToAthena', 'postMessage', 'openUnifiedConfirmation', 'mlsAppAthena']) {
      eq(run.indexOf(verb), -1, shell + ': runAthenaAll() reaches Athena itself through ' + verb + ' instead of the queue driver');
    }
    /* the day block must not name a 1p-only asset (lane neutrality is pinned
       by 1p-ui-shape-contract; re-asserted here for the lines this lane adds) */
    eq(/\b1p-[\w.-]*\.js\b/.test(day), false, shell + ': the op-note room block now names a 1p-prefixed file');
  });
}

/* ====================================================== the runtime harness */

const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const PROVIDER = 'Synthetic Clinician One, MD';
const BASE_APPT = 70000000;

function patientOf(n) {
  return { id: 'syn-op-' + n, patientId: 'syn-op-' + n, name: 'Synthetic Opnote Patient ' + n,
    dob: '0' + n + '/02/1980', mrn: '20000' + n };
}
function recordOf(n, over) {
  const p = patientOf(n);
  const rec = { id: 'note-' + n, kind: 'opnote', isDraft: false,
    text: 'OPERATIVE NOTE ' + n + '\nSynthetic operative body for patient ' + n + ', batch-send suite.',
    patient: p.name, patientId: p.patientId, dob: p.dob, mrn: p.mrn, coding: null, orders: [] };
  return Object.assign(rec, over || {});
}
function calRowOf(n) {
  const p = patientOf(n);
  return { id: 'cal-row-' + n, patient_external_id: p.patientId, name: p.name, dob: p.dob,
    provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T1' + n + ':00:00.000Z' };
}
function boundOf(n) {
  return { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: String(BASE_APPT + n),
    encounterId: '5550' + n, encounterUrl: 'https://athena.example/encounter/5550' + n };
}

/* ---------------------------------------------------------------- DOM shim
 * The 1p-writeflow-sheet-ux shim, plus the queue's own progress host in the
 * STRICT id set: getElementById returns null for it until it is genuinely
 * appended, so "the progress surface is on screen" cannot pass on a phantom. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsOpBatchProgress', 'mlsOpBatchStop'];

function makeDom() {
  const byId = new Map();
  const live = new Map();
  let card = null;

  function checkbox(rowId) {
    const el = {
      tagName: 'INPUT', type: 'checkbox', checked: true, id: '', style: {}, children: [],
      attrs: { 'data-mls-bx-row': rowId, class: 'mls-bx-check' }, handlers: {},
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener() {}, focus() {}, click() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
      fire(t) { (el.handlers[t] || []).forEach((fn) => fn({ target: el })); }
    };
    return el;
  }
  function boxesOf(el) {
    if (el._bx) return el._bx;
    const out = [];
    const re = /class="mls-bx-check" data-mls-bx-row="([^"]+)"/g;
    let m;
    while ((m = re.exec(String(el.innerHTML || '')))) out.push(checkbox(m[1]));
    el._bx = out;
    return out;
  }
  function forget(children) {
    children.forEach((child) => {
      if (child && child.id && live.get(child.id) === child) live.delete(child.id);
      if (child && child.children && child.children.length) forget(child.children);
    });
  }
  function node(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [],
      handlers: {}, value: '', disabled: false, type: '', id: '', title: '',
      isConnected: true, className: '', parentNode: null, _bx: null,
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener(t, fn) { const l = el.handlers[t] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      appendChild(child) {
        el.children.push(child); child.parentNode = el;
        if (child.id && LIVE_IDS.indexOf(child.id) >= 0) live.set(child.id, child);
        return child;
      },
      insertBefore(child) { return el.appendChild(child); },
      remove() {
        if (el.id && live.get(el.id) === el) live.delete(el.id);
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter((c) => c !== el);
      },
      select() {}, focus() {},
      querySelector(sel) {
        const s = String(sel || '');
        if (s.charAt(0) === '#') return resolve(s);
        const m = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(s.trim());
        if (!m) return null;
        return el.children.filter((c) => (m[2] === undefined ? c.getAttribute(m[1]) !== null : c.getAttribute(m[1]) === m[2]))[0] || null;
      },
      querySelectorAll(sel) { return /mls-bx-check/.test(String(sel || '')) ? boxesOf(el) : []; },
      closest() { return null; },
      click() { (el.handlers.click || []).forEach((fn) => fn({ target: el })); }
    };
    let html = '', text = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return html; },
      set(v) {
        html = String(v); el._bx = null;
        forget(el.children); el.children.length = 0;
        if (html.indexOf('mlsAthenaUnifiedGo') >= 0) card = el;
      }
    });
    Object.defineProperty(el, 'textContent', {
      get() { return text; },
      set(v) { text = String(v); forget(el.children); el.children.length = 0; }
    });
    return el;
  }
  function resolve(sel) {
    const key = String(sel || '').replace(/^#/, '');
    if (LIVE_IDS.indexOf(key) >= 0) return live.get(key) || null;
    if (!byId.has(key)) { const el = node('div'); el.id = key; el.attrs.id = key; byId.set(key, el); }
    return byId.get(key);
  }
  const document = {
    readyState: 'complete', activeElement: null,
    body: node('body'), head: node('head'), documentElement: node('html'),
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return resolve(sel); },
    querySelectorAll(sel) { return (/mls-bx-check/.test(String(sel || '')) && card) ? boxesOf(card) : []; },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return { document, resolve, card: () => card };
}

/* A clock that only moves when a timer is scheduled. Without it every bounded
   wait in the queue (6s open, 150s check, 180s write) would spin against the
   wall clock for minutes when a fixture deliberately never settles. */
function makeClock() {
  let t = Date.now();
  function D(a, b, c, d, e, f, g) {
    if (arguments.length === 0) return new Date(t);
    if (arguments.length === 1) return new Date(a);
    return new Date(a, b, c || 1, d || 0, e || 0, f || 0, g || 0);
  }
  D.now = () => t;
  D.parse = Date.parse;
  D.UTC = Date.UTC;
  D.prototype = Date.prototype;
  return { D, advance(ms) { t += Math.max(0, Number(ms || 0)); } };
}

function makeHarness(options) {
  options = options || {};
  const dom = makeDom();
  const clock = makeClock();
  const listeners = [];
  const posted = [];
  const store = new Map();
  const n = options.count || 3;
  const records = [];
  for (let i = 1; i <= n; i++) records.push(recordOf(i, (options.records && options.records[i - 1]) || null));
  const calRows = [];
  for (let i = 1; i <= n; i++) {
    calRows.push(calRowOf(i));
    store.set('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {} }));
  }
  const idxRows = {};
  for (let i = 1; i <= n; i++) {
    idxRows['appointment-id:' + String(BASE_APPT + i)] = { state: 'done', patientId: patientOf(i).patientId, backendAppointmentId: 'cal-row-' + i, appt_date: DAY };
  }
  store.set('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: idxRows }));

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k)
  };
  const toasts = [];
  const window = {
    document: dom.document, localStorage,
    _calAppts: calRows.map(clone),
    _opPrep: records.map((rec, i) => ({ _noteId: rec.id, patientId: rec.patientId, note: rec.text, gen: true, appt: { name: rec.patient } })),
    uns: (k) => 'acct:' + k,
    activePatient: () => patientOf(1),
    getNotes: () => records.map(clone),
    toast: (m, k) => { toasts.push({ m: String(m), k: String(k || '') }); },
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage(message) { posted.push(message); route(message); }
  };
  window.window = window;

  function deliver(type, requestId, resp) {
    Promise.resolve().then(() => listeners.slice().forEach((fn) => fn({ data: { source: 'mls-ext', type, requestId, resp } })));
  }
  function contextFor(pid) {
    const i = Number(String(pid).replace(/\D/g, '')) || 1;
    const p = patientOf(i), b = boundOf(i);
    return { patientName: p.name, dob: p.dob, mrn: p.mrn, appointmentId: b.appointmentId,
      encounterId: b.encounterId, encounterUrl: b.encounterUrl, visitDate: ATHENA_DAY, provider: PROVIDER,
      control: 'Procedure Documentation editor', framePath: '0', encounterRootFingerprint: 'er',
      controlFingerprint: 'c', noteScopeFingerprint: 'nn', editorFingerprint: 'e', contextHash: 'h' };
  }
  function defaultAction(m) {
    const ctx = contextFor((m.patient && m.patient.patientId) || 'syn-op-1');
    if (m.mode === 'execute') {
      return { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        noteWriteProof: 'proof-' + ctx.encounterId, noteWriteProofExpiresAt: clock.D.now() + 600000, context: clone(ctx) };
    }
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
      rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(ctx) };
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId, options.onAction ? options.onAction(m, defaultAction) : defaultAction(m));
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.62', versionName: '3.0.62+core', athena: { tabs: 3, discarded: 0 } });
    return undefined;
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date: clock.D, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat, Error,
    setTimeout: (fn, ms) => {
      const m = Number(ms || 0);
      if (m <= 2000 || m === 12000 || m === 15000) { clock.advance(m); Promise.resolve().then(fn); }
      return 1;
    },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });

  /* ---- the app's OWN saved-note hand-off, sliced out of the shipped twin --- */
  const shell = SHELL_SRC[options.shell || SHELLS[0]];
  const push = extractFunction(shell, 'function pushHistoryNoteToAthena(id)');
  const pushPlan = extractFunction(shell, 'function _athenaPushPlan(sections, who, immutablePatient)');
  const showReceipt = extractFunction(shell, 'function _athenaShowReceipt(who, results, partial, immutablePatient, sections, visitContext)');
  const flow = window.__mlsWriteFlow;
  context.ATHENA_SECTIONS = {
    procedure: { icon: 'P', label: 'PROCEDURE / OPERATIVE NOTE', dest: flow.destinations.procedure },
    note: { icon: 'N', label: 'NOTE', dest: flow.destinations.note },
    dx: { icon: 'D', label: 'DIAGNOSES', dest: 'dx' },
    billing: { icon: 'B', label: 'BILLING', dest: 'billing' },
    orders: { icon: 'O', label: 'ORDERS', dest: 'orders' }
  };
  context.getNotes = window.getNotes;
  context.toast = window.toast;
  context.opNoteBlankTokens = (text) => {
    const m = String(text || '').match(/\[\[[a-z0-9_]+\]\]/gi);
    return (m || []).map((x) => ({ key: x, label: x }));
  };
  context._athenaItemsOf = () => [];
  context._athenaCanonicalBilling = () => ({ emCode: '', cptCodes: [], invalid: [] });
  context._athenaOrderReviewBundle = () => ({ drafts: [], suggestions: [] });
  context._mlsSavedAthenaCanonicalForWrite = () => null;
  context._athenaBindingForSavedRecord = (rec) => {
    const i = Number(String(rec && rec.patientId).replace(/\D/g, '')) || 1;
    const p = patientOf(i), b = boundOf(i);
    const over = (options.binding && options.binding(rec)) || null;
    return Object.assign({
      routeBlocked: false, identityConflict: false,
      patient: { name: p.name, dob: p.dob, mrn: p.mrn, patientId: p.patientId },
      noteTimestamp: null,
      visitContext: { historical: true, visitDate: b.visitDate, provider: b.provider,
        appointmentId: b.appointmentId, encounterId: b.encounterId, encounterUrl: b.encounterUrl }
    }, over);
  };
  /* On a real page these ARE window properties; in a VM a bare global is not,
     so publish the two the queue's own pre-screen reads by name. */
  window.opNoteBlankTokens = context.opNoteBlankTokens;
  window._athenaBindingForSavedRecord = context._athenaBindingForSavedRecord;
  vm.runInContext(showReceipt + '\n' + pushPlan + '\n' + push +
    '\nwindow.pushHistoryNoteToAthena = pushHistoryNoteToAthena;', context, { filename: 'shell-saved-note-handoff.js' });

  return {
    window, document: dom.document, el: dom.resolve, posted, toasts, records, clock, context,
    wf: flow, batch: window.__mlsOpBatchSend,
    actions: () => posted.filter((m) => m.type === 'mlsAppAthenaActionV2'),
    executes: () => posted.filter((m) => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    probes: () => posted.filter((m) => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe'),
    progress: () => dom.resolve('mlsOpBatchProgress')
  };
}
async function settle(n) { for (let i = 0; i < (n || 600); i++) await new Promise((r) => setImmediate(r)); }
async function runToEnd(h, cap) {
  for (let i = 0; i < (cap || 40); i++) {
    await settle(200);
    if (h.batch.status().done) return true;
  }
  return h.batch.status().done;
}

/* ================================================================== PART 1 */
(async function run() {

  /* ---- 1. the queue: one press, N notes, in the room's order -------------- */
  {
    const h = makeHarness({ count: 3 });
    eq(h.batch.eligible().count, 3, 'the three filed op notes were not all eligible');
    const started = h.batch.start({ noteIds: h.batch.eligible().ids });
    eq(started.started, true, 'the queue refused to start on a clean day: ' + JSON.stringify(started));
    eq(started.total, 3, 'the queue did not take all three notes');
    ok(await runToEnd(h), 'the queue never finished: ' + JSON.stringify(h.batch.status()));

    const st = h.batch.status();
    eq(st.written, 3, 'not every note was written: ' + JSON.stringify(st.notes));
    eq(st.skipped, 0, 'a clean queue skipped a note: ' + JSON.stringify(st.notes));
    assert.deepStrictEqual(clone(st.notes.map((x) => x.id)), ['note-1', 'note-2', 'note-3'],
      'the queue did not run the notes in the order the room paints them');
    checks++;
    assert.deepStrictEqual(clone(st.notes.map((x) => x.phase)), ['written', 'written', 'written'],
      'a note in a clean queue did not settle as written');
    checks++;

    /* ONE PRESS, N SHEETS, N WRITES - and never two writes in flight. */
    eq(h.executes().length, 3, 'the queue did not issue exactly one execute per note');
    ok(h.probes().length >= 3, 'a note was executed without its own read-only check');
    const modes = h.actions().map((m) => m.mode);
    for (let i = 0; i < modes.length; i++) {
      if (modes[i] !== 'execute') continue;
      ok(i > 0 && modes[i - 1] === 'probe', 'an execute was issued without its own immediately preceding read-only probe');
    }
    /* each write went to its OWN patient and its OWN encounter */
    const wrote = h.executes().map((m) => String(m.patient && m.patient.patientId));
    assert.deepStrictEqual(wrote, ['syn-op-1', 'syn-op-2', 'syn-op-3'],
      'the queue wrote the wrong patients, or wrote one patient twice');
    checks++;
    const appts = h.executes().map((m) => String(m.expectedContext && m.expectedContext.appointmentId));
    assert.deepStrictEqual(appts, [String(BASE_APPT + 1), String(BASE_APPT + 2), String(BASE_APPT + 3)],
      'a write was addressed to an appointment that is not that note\'s own');
    checks++;

    /* 6. SIGN AND SAVE NEVER APPEAR IN ANYTHING THE QUEUE EMITS. */
    ok(h.actions().every((m) => m.action === 'write_note'),
      'the queue emitted an action other than the reviewed note write: ' + JSON.stringify(h.actions().map((m) => m.action)));
    for (const forbidden of ['sign_encounter', 'stage_billing', 'place_order', 'save_draft']) {
      eq(h.actions().filter((m) => m.action === forbidden).length, 0,
        'the queue emitted ' + forbidden + ' - only the reviewed note write may be driven by a batch');
    }
    eq(h.posted.filter((m) => /sign|Sign/.test(String(m.type))).length, 0, 'the queue posted a signing message');

    /* the sheet is closed behind the queue, not left open on the last note */
    eq(h.wf.diagnostics.state(), null, 'the queue left an Athena review open when it finished');
    ok(/3 of 3 written into Athena/.test(st.summary), 'the summary does not count what landed: ' + st.summary);
    ok(/Nothing was saved and nothing was signed/.test(st.summary), 'the summary dropped the not-saved/not-signed honesty: ' + st.summary);
  }

  /* ---- 2. per-note gate isolation: a refusal never blocks the next -------- */
  {
    const REFUSAL = 'The exact Athena encounter frame was not found for this chart.';
    const h = makeHarness({
      count: 3,
      onAction: (m, dflt) => {
        const pid = String(m.patient && m.patient.patientId);
        if (pid === 'syn-op-2' && m.mode === 'probe') {
          return { ok: false, blocked: true, reason: 'probe-frame-missing', error: REFUSAL };
        }
        return dflt(m);
      }
    });
    h.batch.start({ noteIds: h.batch.eligible().ids });
    ok(await runToEnd(h), 'the queue never finished with one refusing note: ' + JSON.stringify(h.batch.status()));

    const st = h.batch.status();
    eq(st.notes.length, 3, 'the queue lost a note when one refused');
    eq(st.notes[0].phase, 'written', 'the note BEFORE the refusal did not write');
    eq(st.notes[1].phase, 'skipped', 'the refusing note was not skipped: ' + JSON.stringify(st.notes[1]));
    eq(st.notes[2].phase, 'written', 'A REFUSED NOTE BLOCKED THE NEXT ONE - the queue must continue past it');
    eq(st.written, 2, 'the queue miscounted what landed with one refusal: ' + JSON.stringify(st.notes));
    eq(st.skipped, 1, 'the queue miscounted its skips: ' + JSON.stringify(st.notes));

    /* THE REASON SURFACES - in the record, in the summary, and on screen. */
    ok(String(st.notes[1].why).length > 20, 'the skipped note carries no reason at all: ' + JSON.stringify(st.notes[1]));
    ok(/Nothing was sent for it/.test(st.notes[1].why), 'the skip does not say that nothing was sent for that note: ' + st.notes[1].why);
    ok(/skipped, each with its reason below/.test(st.summary), 'the summary hides that something was skipped: ' + st.summary);
    const host = h.progress();
    ok(host, 'the queue painted no progress surface');
    const html = String(host.innerHTML);
    ok(/SKIPPED/.test(html), 'the progress surface does not show the skipped verdict');
    ok(html.indexOf(String(st.notes[1].why).slice(0, 40)) > 0, 'the skipped note\'s reason is not on screen: ' + html.slice(0, 400));
    eq(h.executes().length, 2, 'the refused note still reached an execute');
    ok(h.executes().every((m) => String(m.patient.patientId) !== 'syn-op-2'), 'the refused patient was written anyway');
  }

  /* ---- 2b. a note whose WRITE is refused is skipped, not claimed ---------- */
  {
    const h = makeHarness({
      count: 2,
      onAction: (m, dflt) => (String(m.patient && m.patient.patientId) === 'syn-op-1' && m.mode === 'execute'
        ? { ok: false, attempted: false, reason: 'note-editor-not-empty', error: 'The Athena field already holds text.' }
        : dflt(m))
    });
    h.batch.start({ noteIds: h.batch.eligible().ids });
    ok(await runToEnd(h), 'the queue never finished with one refused write');
    const st = h.batch.status();
    eq(st.notes[0].phase, 'skipped', 'a refused write was reported as written');
    eq(st.notes[1].phase, 'written', 'a refused write blocked the note after it');
    ok(String(st.notes[0].why).length > 10, 'the refused write carries no reason: ' + JSON.stringify(st.notes[0]));
  }

  /* ---- 3. cancel between notes, never mid-write --------------------------- */
  {
    const h = makeHarness({ count: 3 });
    const started = h.batch.start({ noteIds: h.batch.eligible().ids });
    eq(started.started, true, 'the cancel fixture never started');
    /* Raised while note 1 is already in flight. */
    const c = h.batch.cancel('');
    eq(c.cancelled, true, 'cancel was refused while a queue was running');
    ok(await runToEnd(h), 'a cancelled queue never finished: ' + JSON.stringify(h.batch.status()));

    const st = h.batch.status();
    eq(st.notes[0].phase, 'written', 'CANCEL ABANDONED A WRITE THAT HAD ALREADY STARTED - it must finish and produce its receipt');
    eq(st.notes[1].phase, 'stopped', 'a note after the cancel was still run: ' + JSON.stringify(st.notes[1]));
    eq(st.notes[2].phase, 'stopped', 'a note after the cancel was still run: ' + JSON.stringify(st.notes[2]));
    eq(h.executes().length, 1, 'a cancelled queue wrote more than the note already in flight');
    ok(/2 not run/.test(st.summary), 'the summary does not say how many never ran: ' + st.summary);
    ok(/Stopped by the doctor/.test(st.stop), 'the stop reason was not recorded: ' + st.stop);
    eq(h.wf.diagnostics.state(), null, 'a cancelled queue left an Athena review open');

    /* ... and the same thing again with the cancel raised while note 1 is
       genuinely INSIDE its write, which is the exact moment the invariant is
       about: the write finishes and produces its receipt; nothing after it
       opens. */
    let w = null, cancelledAt = '';
    w = makeHarness({
      count: 3,
      /* the cancel is raised INSIDE the first execute round trip - the write
         has left MLS and its answer has not come back yet */
      onAction: (m, dflt) => {
        if (m.mode === 'execute' && !cancelledAt) {
          const live = w.batch.status();
          cancelledAt = live.notes[0].phase;
          w.batch.cancel('');
        }
        return dflt(m);
      }
    });
    w.batch.start({ noteIds: w.batch.eligible().ids });
    await settle(200);
    eq(cancelledAt, 'write', 'the cancel was not raised while the first note was inside its write');
    ok(await runToEnd(w), 'the mid-write cancel never finished: ' + JSON.stringify(w.batch.status()));
    const ws = w.batch.status();
    eq(ws.notes[0].phase, 'written', 'A CANCEL RAISED MID-WRITE ABANDONED THAT WRITE - it must finish and produce its receipt');
    eq(w.executes().length, 1, 'a mid-write cancel let a note after it reach Athena');
    eq(ws.notes[1].phase, 'stopped', 'a note after a mid-write cancel still ran');
    eq(ws.notes[2].phase, 'stopped', 'a note after a mid-write cancel still ran');
  }

  /* ---- 4. the pull/import refusal, before a single message goes out ------- */
  {
    const engines = [
      ['__mlsDayHistoryPull', { state: { running: true } }],
      ['__mlsProvMonthPull', { running: true }],
      ['__mlsEasyV32', { state: () => ({ pull: { running: true } }) }]
    ];
    for (const [key, value] of engines) {
      const h = makeHarness({ count: 2 });
      h.window[key] = value;
      eq(h.batch.pullRunning(), true, key + ' running is not seen by the queue');
      const res = h.batch.start({ noteIds: h.batch.eligible().ids });
      eq(res.started, false, 'the queue started while ' + key + ' was running');
      ok(/pull or import is running/.test(String(res.reason)), 'the pull refusal does not say why: ' + res.reason);
      ok(/Nothing was sent/.test(String(res.reason)), 'the pull refusal dropped the nothing-sent honesty: ' + res.reason);
      await settle(40);
      eq(h.actions().length, 0, 'the refused queue still posted an Athena message for ' + key);
      eq(h.batch.status().running, false, 'the refused queue reported itself as running');
    }
    /* the schedule importer's own busy stamp counts too */
    const h2 = makeHarness({ count: 2 });
    h2.window.__mlsPullBusyAt = h2.clock.D.now();
    eq(h2.batch.pullRunning(), true, 'a live schedule-import busy stamp is not seen by the queue');
    eq(h2.batch.start({}).started, false, 'the queue started while the schedule import held its busy stamp');
    eq(h2.actions().length, 0, 'the busy-stamp refusal still posted an Athena message');
  }

  /* ---- 5. the other start refusals --------------------------------------- */
  {
    const h = makeHarness({ count: 2 });
    /* an open review owns the tab */
    h.wf.openUnifiedConfirmation({ patient: patientOf(1), sections: [{ key: 'procedure', text: 'Body' }],
      expectedContext: boundOf(1), receiptSessionId: 'op-open' });
    await settle(60);
    const busy = h.batch.start({});
    eq(busy.started, false, 'the queue started on top of an already-open Athena review');
    ok(/already open/.test(String(busy.reason)), 'the open-review refusal does not say why: ' + busy.reason);
    h.wf.closeUnifiedConfirmation();

    /* a second start while one queue runs */
    h.batch.start({ noteIds: h.batch.eligible().ids });
    const again = h.batch.start({});
    eq(again.started, false, 'two queues were allowed to run at once');
    ok(/already running/.test(String(again.reason)), 'the double-start refusal does not say why: ' + again.reason);
    h.batch.cancel('');
    await runToEnd(h);

    /* nothing eligible */
    const empty = makeHarness({ count: 1, records: [{ isDraft: true }] });
    eq(empty.batch.eligible().count, 0, 'a draft op note was offered to the queue');
    const none = empty.batch.start({});
    eq(none.started, false, 'the queue started with nothing eligible');
    ok(/drafted, have every field filled in, and be saved to the chart/.test(String(none.reason)),
      'the nothing-eligible refusal does not say what a note needs: ' + none.reason);
    eq(empty.actions().length, 0, 'a queue with nothing eligible still posted an Athena message');
  }

  /* ---- 6. the pre-screen refuses exactly what the entry point refuses ----- */
  {
    const h = makeHarness({ count: 1 });
    const good = recordOf(1);
    eq(h.batch.screen(good).ok, true, 'a filed, complete op note was refused by the screen');
    eq(h.batch.screen(Object.assign({}, good, { isDraft: true })).ok, false, 'a DRAFT reached the queue');
    ok(/still a draft/.test(h.batch.screen(Object.assign({}, good, { isDraft: true })).why), 'the draft refusal does not name the draft');
    eq(h.batch.screen(Object.assign({}, good, { kind: 'visit' })).ok, false, 'a note that is not an op note reached the queue');
    eq(h.batch.screen(Object.assign({}, good, { text: 'FINDINGS: [[findings]] and [[dose_mg]]' })).ok, false,
      'a note with unresolved [[key]] placeholders reached the queue');
    ok(/2 unresolved fields/.test(h.batch.screen(Object.assign({}, good, { text: 'a [[x]] b [[y]]' })).why),
      'the blank refusal does not count the blanks');
    eq(h.batch.screen(Object.assign({}, good, { text: '', soap: '' })).ok, false, 'an empty note reached the queue');
    eq(h.batch.screen(null).ok, false, 'a missing record reached the queue');

    /* a quarantined record is refused by the SAME binding call the shipped
       pushHistoryNoteToAthena makes, and is reported rather than dropped */
    const q = makeHarness({ count: 2, binding: (rec) => (rec && rec.id === 'note-1' ? { routeBlocked: true } : null) });
    const el = q.batch.eligible(['note-1', 'note-2']);
    eq(el.count, 1, 'a route-quarantined record was queued');
    assert.deepStrictEqual(clone(el.ids), ['note-2'], 'the queue kept the wrong record after the quarantine screen');
    checks++;
    eq(el.refused.length, 1, 'the quarantined record was dropped silently instead of reported');
    ok(/quarantined/.test(el.refused[0].why), 'the quarantine refusal does not say why: ' + JSON.stringify(el.refused));

    const q2 = makeHarness({ count: 2, binding: (rec) => (rec && rec.id === 'note-1' ? { identityConflict: true } : null) });
    eq(q2.batch.eligible(['note-1', 'note-2']).count, 1, 'a record whose identity conflicts with its chart was queued');
  }

  /* ---- 7. the sheet a queue presses is the one it queued ------------------ */
  {
    const h = makeHarness({ count: 2 });
    /* the app's OWN saved-note hand-off, run directly - the same call the
       queue makes, without racing the queue's own close. */
    h.window.pushHistoryNoteToAthena('note-1');
    await settle(40);
    const state = h.wf.diagnostics.state();
    ok(state, 'no Athena review opened for the queued note');
    ok(h.batch.matches(state, { patientId: 'syn-op-1', name: patientOf(1).name,
      body: h.records[0].text.replace(/\s+/g, ' ').trim().slice(0, 400) }),
      'the queue cannot recognise the review it just opened as its own note');
    eq(h.batch.matches(state, { patientId: 'syn-op-2', name: patientOf(2).name,
      body: h.records[1].text.replace(/\s+/g, ' ').trim().slice(0, 400) }), false,
      'THE QUEUE WOULD PRESS ANOTHER PATIENT\'S REVIEW - the identity match is not binding');
    eq(h.batch.matches(state, { patientId: 'syn-op-1', name: patientOf(1).name, body: 'a completely different body of text' }), false,
      'the queue would press a review that does not carry the note it queued');
    eq(h.batch.matches(null, { patientId: 'syn-op-1', name: patientOf(1).name, body: 'x' }), false, 'a closed review matched');
    h.wf.closeUnifiedConfirmation();
  }

  /* ---- 8. the progress surface, and revert ------------------------------- */
  {
    const h = makeHarness({ count: 2 });
    h.batch.start({ noteIds: h.batch.eligible().ids });
    /* read the surface on the SAME turn the queue started, before anything can
       settle - this is the state the doctor actually sees first */
    const live = h.progress();
    const opening = String(live && live.innerHTML);
    const headline = h.batch.headline();
    ok(live, 'no progress surface appeared when the queue started');
    ok(/Sending op notes to Athena/.test(opening), 'the progress surface does not say what it is doing');
    ok(/of 2/.test(headline), 'the headline does not say which note of how many: ' + headline);
    ok(/Stop after this note/.test(opening), 'the progress surface offers no way to stop the queue');
    ok(/Nothing is saved and nothing is signed/.test(opening),
      'the progress surface dropped the not-saved/not-signed disclosure');
    ok(await runToEnd(h), 'the progress fixture never finished');
    ok(/WRITTEN/.test(String(h.progress().innerHTML)), 'the finished progress surface shows no per-note verdict');
    /* WHAT LANDED IS NOT OFFERED AGAIN in this session, and the reason is
       recorded rather than the note being dropped in silence. */
    assert.deepStrictEqual(clone(h.batch.sent()).sort(), ['note-1', 'note-2'],
      'a verified write was not remembered for this session');
    checks++;
    eq(h.batch.eligible().count, 0, 'a note already written into Athena was offered to the queue again');
    const again2 = h.batch.eligible(['note-1']);
    eq(again2.refused.length, 1, 'an already-written note was dropped silently instead of reported');
    ok(/already written into Athena in this session/.test(again2.refused[0].why),
      'the already-written refusal does not say why: ' + JSON.stringify(again2.refused));
    eq(h.batch.start({}).started, false, 'a queue started with every note already written');

    eq(h.batch.revert(), true, 'the queue could not be reverted');
    eq(h.progress(), null, 'revert left the progress surface on screen');
    eq(h.batch.status().running, false, 'revert left the queue reporting itself as running');
    eq(h.batch.sent().length, 0, 'revert did not forget what this session had sent');
  }

  /* ---- 9. the room's own count is the shipped one ------------------------- */
  {
    for (const shell of SHELLS) {
      const src = SHELL_SRC[shell];
      const day = src.slice(src.indexOf('<!-- ===== opnote-day-4.0.0'), src.indexOf('<!-- ===== end opnote-day-4.0.0'));
      const rows = [
        { _noteId: 'a', note: 'body a' },                       /* filed op note      -> in  */
        { _noteId: 'b', note: 'body b [[missing]]' },           /* blanks left        -> out */
        { _noteId: 'c', note: 'body c' },                       /* still a draft      -> out */
        { _noteId: 'd', note: 'body d' },                       /* a visit note       -> out */
        { _noteId: 'e', note: 'body e' },                       /* not in chart yet   -> out */
        { note: 'body f' },                                     /* never saved        -> out */
        { _noteId: 'g', note: 'body g' }                        /* filed op note      -> in  */
      ];
      const chart = {
        a: { id: 'a', kind: 'opnote', isDraft: false },
        b: { id: 'b', kind: 'opnote', isDraft: false },
        c: { id: 'c', kind: 'opnote', isDraft: true },
        d: { id: 'd', kind: 'visit', isDraft: false },
        g: { id: 'g', kind: 'opnote', isDraft: false }
      };
      /* the room's OWN per-pass status, which is what gates the walk */
      const kindOf = { a: 'filed', b: 'review', c: 'ready', d: 'filed', e: 'ready', f: 'queued', g: 'filed' };
      let chartReads = 0;
      const ctx = {
        S: (v) => (v == null ? '' : String(v)),
        rows: () => rows,
        statusOf: (row, i) => ({ k: kindOf[String(row && row._noteId)] || 'queued' }),
        blanksLeft: (row) => ((String(row && row.note).match(/\[\[[a-z0-9_]+\]\]/gi) || []).length),
        filedRecord: (row) => {
          chartReads += 1;
          const rec = chart[String(row && row._noteId)];
          return (rec && !rec.isDraft) ? rec : null;
        },
        console
      };
      vm.createContext(ctx);
      vm.runInContext(extractFunction(day, '  function athSendable() {') + '\nthis.__ids = athSendable();', ctx, { filename: shell + '#athSendable' });
      assert.deepStrictEqual(clone(ctx.__ids), ['a', 'g'],
        shell + ': the room offers the wrong notes to the Athena queue - got ' + JSON.stringify(ctx.__ids));
      checks++;
      /* ONE CHART SCAN PER PASS. The room already walks the notes store once
         per row through statusOf(); this count must stay at the FILED rows
         only, never at every row - that is the b965 shape the room's own
         renderer was rebuilt to remove. */
      ok(chartReads <= 3, shell + ': athSendable() reads the chart store for ' + chartReads + ' of ' + rows.length +
        ' rows - it must only look at the rows the cached status already calls filed');
    }
  }

  console.log('PASS opnote-batch-send (opbatch-1.0.0): ' + checks + ' checks - ONE press queues every filed op note through the SAME per-note ' +
    'pushHistoryNoteToAthena review and the SAME sheet primary, sequentially and in the room\'s own order; a refused note is skipped with its ' +
    'reason on screen and never blocks the next; cancel lets the note already being written finish and opens nothing after it; a running ' +
    'pull/import, an open review, a second queue and an empty day all refuse before a single Athena message is posted; and the closed ' +
    'write_note/save_draft allowlist is enforced before the press, so nothing a batch emits can ever sign, bill or order.');
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
