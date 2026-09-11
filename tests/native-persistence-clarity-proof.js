'use strict';
/* THE SAVED-NOTE REFUSALS, IN THE DOCTOR'S OWN WORDS (savetruth-1.0.0)
 *
 * WHAT WAS MEASURED BEFORE THIS SUITE EXISTED
 * -------------------------------------------
 * 1. 999ba30f added five plain-English WFCLAR entries -
 *    section-persistence-frame-changed / -proof-ambiguous / -readback-missing /
 *    -readback-ambiguous / -readback-mismatch - and NOT ONE OF THEM COULD EVER
 *    RENDER on the execute path. nativePersistenceFailureMessage's regex covers
 *    exactly those five codes, and resultToUnifiedReceipt consulted it FIRST:
 *
 *      var execClar = attempted || nativeFailure ? null : wfClarify(resp.reason);
 *      message = nativeFailure || (execClar ? ... );
 *
 *    So for the extension's PRE-READ refusal section-persistence-frame-changed
 *    (attempted:false, fix:true) the doctor got the generic "MLS could not
 *    prove that all reviewed sections still match the saved Athena note"
 *    instead of the one thing that fixes it - "Let the encounter finish
 *    loading, then press Check Athena again."
 * 2. Seven more codes were on the CLOSED WFDX_KNOWN_REASONS allowlist with no
 *    WFCLAR entry at all (native-persistence-request-missing / -request-
 *    ambiguous / -response-failed / -readback-mismatch, and
 *    section-persistence-proof-missing / -mismatch / -expired), so every
 *    surface that classifies a code printed the raw extension token at a
 *    doctor who cannot act on one.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 *   1. Every one of the twelve codes has a WFCLAR entry, and its sentence is
 *      in doctor language: no raw code, no developer words, and it ends in the
 *      tail that is TRUE for that code - the no-change guarantee for the
 *      read-only reconciliation codes, and "MLS sent this one reviewed section"
 *      for the four that can only be minted after a section was placed.
 *   2. RUNTIME, through the shipped execute path and the receipt it mints:
 *      each of the five codes from 999ba30f renders its own cure sentence, and
 *      not the generic one that was swallowing it.
 *   3. The pre-existing rule did not move: an ATTEMPTED outcome is still never
 *      paraphrased, so the same code with attempted:true keeps the generic
 *      sentence and an uncertain receipt.
 *   4. None of the twelve is on WFAUTO_RETRY, so not one of them can start an
 *      automatic re-check. The only cycle here is a press the doctor makes.
 *
 * WHAT savetruth-1.1.0 / 1.2.0 ADDED (sections 5b - 9)
 * ---------------------------------------------------
 *   5b. An OPERATIVE NOTE can never take the read-only leg: MLS Assist gates
 *       native persistence on its own four-key set and 'procedure' is not in
 *       it, so that press is always the encounter Save click and every word
 *       for it says so. This is the counter-example that keeps section 5 real.
 *   6.  A CURE MAY ONLY NAME A CONTROL THAT IS ON THAT SCREEN. Twelve refusal
 *       sentences end in "press Check Athena again" and, from the execute
 *       path, no such button existed. It now exists and it re-probes.
 *   7.  A READ-ONLY REFUSAL MAY NEVER SAY SAVE WAS ATTEMPTED (owner D2): the
 *       pill, the primary button and the progress footer all named a Save the
 *       reconciliation leg never pressed. A real Save press keeps its words.
 *   8.  THE GENERIC REVIEW'S SAVE PRESS IS A SAVE PRESS (owner D4): no verify
 *       wording, no "no save" over a selected Save, and once Athena verifies
 *       it the footer and the standing safety banner say what landed.
 *   9.  THE MID-RUN PERSISTENCE CLAIM IS MEASURED, NOT ASSUMED (owner D4): it
 *       is made only for a key athenaOne can persist and only after a receipt
 *       carries persistenceMode native-section.
 *
 * WHAT savetruth-1.4.0 ADDED (sections 14 - 15)
 * ---------------------------------------------
 *  14. THE THIRD LEG CLAIMS NEITHER LEG. The refused-save footer's third
 *      branch - neither a Save click nor the read-only check proven - still
 *      ended "MLS did not press Save and nothing was signed" over a TIMEOUT,
 *      which proves neither, and opened "The encounter save did not finish"
 *      on a step that may never have started.
 *  15. THE LONE SAVE PRESS IS DESCRIBED IN THE ROW'S OWN WORDS. The primary
 *      button's hover sentence for a save-only queue was a hand-written
 *      paraphrase of the both-outcomes wording and had already drifted: it
 *      promised a read-only check on every shape, operative notes included.
 *
 * THE NEGATIVE CONTROL: every runtime case in sections 2-4 runs a SECOND time
 * against the pre-fix bytes, which must answer with the generic sentence, and
 * sections 7 and 9 each carry their own counter-case (a real Save press, an
 * op note) so neither can pass by blanket-rewriting every sentence. A refactor
 * that removes a fix reds this suite rather than passing it quietly.
 *
 * Run:  node tests/native-persistence-clarity-proof.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW_FILE = '1p-feat_mls_writeflow.js';
const FLOW = fs.readFileSync(path.join(ROOT, FLOW_FILE), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

/* ===================================================== THE NEGATIVE CONTROL ==
 * The two pre-fix lines, verbatim. */
/* savetruth-1.3.0 re-aim: the tail of this expression grew a plain-English
 * fallback for a refusal the extension sent no words for, so the pin is now the
 * three lines that DECIDE the precedence. The control still flips exactly the
 * thing the fix changed: the generic sentence back in front of the table. */
const SHIPPED_PRECEDENCE =
  '      var execClar = attempted ? null : wfClarify(resp.reason);\n' +
  '      var extWords = S(resp.error || resp.message);\n' +
  "      message = (execClar ? wfClarityText(execClar, row) : '') || nativeFailure || extWords ||";
const PREFIX_PRECEDENCE =
  '      var execClar = attempted || nativeFailure ? null : wfClarify(resp.reason);\n' +
  '      var extWords = S(resp.error || resp.message);\n' +
  "      message = nativeFailure || (execClar ? wfClarityText(execClar, row) : '') || extWords ||";
ok(FLOW.indexOf(SHIPPED_PRECEDENCE) > 0, 'the receipt-message precedence is not where this suite reads it');
eq(FLOW.indexOf(PREFIX_PRECEDENCE), -1, 'the pre-fix precedence is still in the shipped bytes');
const PREFIX_FLOW = FLOW.replace(SHIPPED_PRECEDENCE, PREFIX_PRECEDENCE);
ok(PREFIX_FLOW !== FLOW && PREFIX_FLOW.length !== FLOW.length,
  'the negative control is byte-identical to the shipped source - it would measure nothing');

/* -------------------------------------------------------------- the codes ---
 * key: the refusal code. cure: the fragment of ITS OWN sentence that names the
 * one thing the doctor can do (or the one fact he needs). leg: which execute
 * the extension answers it on. sent: whether MLS had already placed a section
 * when the code was minted, which decides the tail. */
const RECONCILE_CODES = [
  { code: 'section-persistence-frame-changed', cure: 'Let the encounter finish loading, then press Check Athena again.' },
  { code: 'section-persistence-proof-ambiguous', cure: 'Athena saved for these sections does not agree' },
  { code: 'section-persistence-readback-missing', cure: 'Put that section on screen in athenaOne, then press Check Athena again.' },
  { code: 'section-persistence-readback-ambiguous', cure: 'more than one possible copy of a reviewed section' },
  { code: 'section-persistence-readback-mismatch', cure: 'no longer matches the reviewed text' },
  { code: 'section-persistence-proof-missing', cure: 'Athena has not saved one of the reviewed sections yet' },
  { code: 'section-persistence-proof-mismatch', cure: 'names different text than the section MLS reviewed' },
  { code: 'section-persistence-proof-expired', cure: 'too old to prove the note is still the reviewed one' }
];
const SECTION_CODES = [
  { code: 'native-persistence-request-missing', cure: 'never asked its server to save that field' },
  { code: 'native-persistence-request-ambiguous', cure: 'more than one save for that field' },
  { code: 'native-persistence-response-failed', cure: 'came back failed' },
  { code: 'native-persistence-readback-mismatch', cure: 'is not the reviewed text' }
];
const GENERIC_RECONCILE = 'MLS could not prove that all reviewed sections still match the saved Athena note.';
const GENERIC_SECTION = 'Athena did not provide one exact persistence and read-back proof for this unsigned draft section.';
const NO_CHANGE_TAIL = ' Nothing was changed and nothing was sent.';
const SECTION_SENT_TAIL = ' MLS sent this one reviewed section and nothing else; it did not sign and it did not bill.';

/* ------------------------------------------------------------------ fixtures */
const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-nat', patientId: 'syn-nat', name: 'Synthetic Patient Native', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-nat', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const OP_SECTION = [{ key: 'procedure', text: 'PROCEDURE PERFORMED: synthetic left L5-S1 transforaminal epidural steroid injection.' }];
/* savetruth-1.2.0: a review of the named fields athenaOne can save itself.
   MLS Assist gates native persistence on its own four-key set
   (background.js: /^(hpi|ros|exam|ap)$/), so ONLY a review carrying one of
   them can take the read-only saved-note leg at all. 'procedure' never can,
   which is why OP_SECTION above is now the counter-example rather than the
   example. */
const NAMED_SECTIONS = [
  { key: 'hpi', text: 'Synthetic HPI narrative for this suite.' },
  { key: 'ros', text: 'Synthetic review of systems for this suite.' },
  { key: 'exam', text: 'Synthetic physical exam for this suite.' }
];
const GENERIC_NOTE_SECTION = [{ key: 'note', text: 'Synthetic generic encounter note body for this suite.' }];
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ------------------------------------------------------------------ DOM shim
 * The shape tests/1p-writeflow-opnote-clarity-progress.test.js proved the
 * renderer against. Ids outside LIVE_IDS resolve lazily, so the module's own
 * getElementById finds a node to paint into. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsAthenaUnifiedCopySection'];

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
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
    };
    return el;
  }
  /* savetruth-1.2.0: the action radios, parsed out of the shipped markup the
     same way the include checkboxes are, so a case can select the row a doctor
     would select. selectRow fires the module's OWN change handler. */
  function radioNode(rowId, checked) {
    const el = {
      tagName: 'INPUT', type: 'radio', checked: !!checked, disabled: false, id: '', style: {}, children: [],
      value: rowId, attrs: { name: 'mlsAthenaUnifiedAction', value: rowId, type: 'radio' }, handlers: {},
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener() {}, focus() {}, click() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
    };
    return el;
  }
  function radiosOf(el) {
    if (el._rx) return el._rx;
    const out = [];
    const re = /<input([^>]*name="mlsAthenaUnifiedAction"[^>]*)>/g;
    let m;
    while ((m = re.exec(String(el.innerHTML || '')))) {
      const v = /value="([^"]*)"/.exec(m[1]);
      out.push(radioNode(v ? v[1] : '', /checked/.test(m[1])));
    }
    el._rx = out;
    return out;
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
    children.forEach(child => {
      if (child && child.id && live.get(child.id) === child) live.delete(child.id);
      if (child && child.children && child.children.length) forget(child.children);
    });
  }
  function node(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [],
      handlers: {}, value: '', disabled: false, type: '', id: '', title: '',
      isConnected: true, className: '', parentNode: null, _bx: null, _rx: null,
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
        if (el.parentNode) el.parentNode.children = el.parentNode.children.filter(c => c !== el);
      },
      select() {}, focus() {},
      querySelector(sel) {
        const s = String(sel || '');
        if (s.charAt(0) === '#') return resolve(s);
        const m = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(s.trim());
        if (!m) return null;
        return el.children.filter(c => (m[2] === undefined ? c.getAttribute(m[1]) !== null : c.getAttribute(m[1]) === m[2]))[0] || null;
      },
      querySelectorAll(sel) {
        const s = String(sel || '');
        if (/mls-bx-check/.test(s)) return boxesOf(el);
        if (/mlsAthenaUnifiedAction/.test(s)) return radiosOf(el);
        return [];
      },
      closest() { return null; },
      click() { (el.handlers.click || []).forEach(fn => fn({ target: el })); }
    };
    let html = '', text = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return html; },
      set(v) {
        html = String(v); el._bx = null; el._rx = null;
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
    querySelectorAll(sel) {
      const s = String(sel || '');
      if (!card) return [];
      if (/mls-bx-check/.test(s)) return boxesOf(card);
      if (/mlsAthenaUnifiedAction/.test(s)) return radiosOf(card);
      return [];
    },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return { document, resolve, cardHtml: () => (card ? card.innerHTML : ''),
    radios: () => (card ? radiosOf(card) : []),
    selectRow(rowId) {
      const list = card ? radiosOf(card) : [];
      const hit = list.filter(r => r.value === rowId)[0];
      if (!hit) return false;
      list.forEach(r => { r.checked = r === hit; });
      (hit.handlers.change || []).forEach(fn => fn.call(hit, { target: hit }));
      return true;
    } };
}

/* -------------------------- a native-persistence MLS Assist (3.0.115 shape) --
 * `source` lets every case run twice: once on the shipped bytes and once on
 * the pre-fix ones. */
function makeHarness(options) {
  options = options || {};
  const source = options.source || FLOW;
  const dom = makeDom();
  const listeners = [];
  const posted = [];
  const store = new Map();
  store.set('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {
    ['appointment-id:' + APPOINTMENT]: { state: 'done', patientId: PATIENT.patientId, backendAppointmentId: CAL_ROW.id, appt_date: DAY }
  } }));
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const window = {
    document: dom.document, localStorage,
    _calAppts: [clone(CAL_ROW)],
    uns: k => 'acct:' + k,
    activePatient: () => PATIENT,
    toast: () => {},
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true,
      batchArmV1: true, nativeNamedSectionPersistenceV1: true },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage(message) { posted.push(message); route(message); }
  };
  window.window = window;

  function deliver(type, requestId, resp) {
    Promise.resolve().then(() => listeners.slice().forEach(fn => fn({ data: { source: 'mls-ext', type, requestId, resp } })));
  }
  function deliverRaw(message) {
    Promise.resolve().then(() => listeners.slice().forEach(fn => fn({ data: message })));
  }
  const CONTEXT = {
    patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, appointmentId: APPOINTMENT,
    encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL, visitDate: ATHENA_DAY, provider: PROVIDER,
    control: 'Procedure Documentation editor', framePath: '0', encounterRootFingerprint: 'er',
    controlFingerprint: 'c', noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h'
  };
  function defaultAction(m) {
    if (m.mode === 'execute') {
      if (m.action === 'save_draft') return { ok: true, mode: 'execute', action: m.action, attempted: false,
        verified: true, saved: true, persisted: true, serverVerified: true, reason: 'exact-section-persistence-reconciled',
        sectionsDeclared: 5, persistedDestinations: 4,
        results: ['hpi', 'ros', 'exam', 'ap'].map(key => ({ ok: true, key, saved: true, persisted: true, verified: true })),
        context: clone(CONTEXT) };
      return { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        saved: true, persisted: true, serverVerified: true, reason: 'exact-note-editor-persisted',
        results: [{ key: String((m.sections && m.sections[0] && m.sections[0].key) || ''), attempted: true, written: true, verified: true, saved: true, persisted: true, serverVerified: true }],
        noteWriteProof: 'proof-' + ENCOUNTER, noteWriteProofExpiresAt: Date.now() + 600000, context: clone(CONTEXT) };
    }
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
      rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(CONTEXT) };
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId, options.onAction ? options.onAction(m, defaultAction) : defaultAction(m));
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsPing') return deliverRaw({ source: 'mls-ext', type: 'mlsPong', requestId: m.requestId, version: '3.0.115', buildId: '3.0.115', batchArm: '1.0.0',
      capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true, batchArmV1: true, nativeNamedSectionPersistenceV1: true } });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.115', versionName: '3.0.115+core', athena: { tabs: 1, discarded: 0 } });
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => { if (Number(ms || 0) <= 2000) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(source, context, { filename: FLOW_FILE });
  return {
    window, el: dom.resolve, posted, cardHtml: dom.cardHtml,
    radios: dom.radios, selectRow: dom.selectRow,
    wf: window.__mlsWriteFlow,
    receipts: () => window.__mlsWriteFlow.diagnostics.state().receipts,
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute')
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }

/* ==================== 1. EVERY CODE HAS A SENTENCE, AND IT IS DOCTOR LANGUAGE
 * Read through the module's own clarity seam - the same classify/say pair the
 * probe path and the receipt path both call. */
{
  const seam = makeHarness({}).wf.diagnostics.clarity;
  eq(seam.v, 'wfclar-1.0.0', 'the clarity seam is not exported by the shipped module');
  const ROW = { destination: 'Athena encounter > HPI', label: 'Write reviewed HPI' };
  /* the developer vocabulary a doctor cannot act on */
  const JARGON = /\b(manifest|bind|binding|token|payload|hash|receipt session|regex|frame path|selector|fingerprint|null|undefined)\b/i;
  RECONCILE_CODES.concat(SECTION_CODES).forEach(function (entry) {
    const clar = seam.classify(entry.code);
    ok(clar && typeof clar === 'object', entry.code + ' has no clarity entry - every surface would print the raw extension token');
    const say = seam.say(clar, ROW);
    ok(say.indexOf(entry.cure) > 0, entry.code + ' does not say what the doctor can do about it: ' + say);
    eq(say.indexOf(entry.code), -1, entry.code + ' prints its own raw code at the doctor: ' + say);
    eq(JARGON.test(say), false, entry.code + ' answers in developer words: ' + say);
    ok(say.length > 60, entry.code + ' answers in a fragment, not a sentence: ' + say);
  });
  /* the tail is the one that is TRUE for that code */
  RECONCILE_CODES.forEach(function (entry) {
    const say = seam.say(seam.classify(entry.code), ROW);
    ok(say.indexOf(NO_CHANGE_TAIL) === say.length - NO_CHANGE_TAIL.length,
      entry.code + ' lost the no-change guarantee it is entitled to: ' + say);
  });
  SECTION_CODES.forEach(function (entry) {
    const say = seam.say(seam.classify(entry.code), ROW);
    ok(say.indexOf(SECTION_SENT_TAIL) === say.length - SECTION_SENT_TAIL.length,
      entry.code + ' is minted after a section was placed and may not carry a no-change guarantee: ' + say);
    eq(say.indexOf(NO_CHANGE_TAIL), -1, entry.code + ' claims nothing was sent after MLS sent a section: ' + say);
  });
  /* NOT ONE of them may start an automatic re-check */
  const retry = makeHarness({}).wf.diagnostics.autoChain.retryable;
  RECONCILE_CODES.concat(SECTION_CODES).forEach(function (entry) {
    eq(retry[entry.code], undefined, entry.code + ' joined the automatic re-check allowlist - it could loop without a press');
  });
}

/* ====== 2. RUNTIME: THE RECEIPT SAYS THE CURE, NOT THE GENERIC SENTENCE =====
 * One op-note section writes and persists; the final saved-note step is
 * refused with each code in turn, attempted:false - the extension refused
 * before touching Athena. The receipt the doctor reads must carry that code's
 * own cure. The SAME case on the pre-fix bytes must carry the generic one. */
async function reconcileReceipt(code, source) {
  const h = makeHarness({
    source: source,
    onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
      ? { ok: false, mode: 'execute', action: 'save_draft', attempted: false, reason: code }
      : dflt(m))
  });
  const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(OP_SECTION), expectedContext: BOUND, receiptSessionId: 'nat-' + code });
  await settle(160);
  const finish = manifest.rows.filter(r => r.action === 'save_draft')[0];
  assert.ok(finish, 'the named-section review did not build its final saved-note row');
  h.el('mlsAthenaUnifiedGo').click();
  await settle(1800);
  return { row: finish, rec: h.receipts()[finish.id], executes: h.executes() };
}

(async function run() {
  for (const entry of RECONCILE_CODES.slice(0, 5)) {
    const shipped = await reconcileReceipt(entry.code, FLOW);
    ok(shipped.rec, entry.code + ': the refused saved-note step minted no receipt at all');
    eq(shipped.rec.status, 'blocked', entry.code + ': a refusal that never touched Athena was not recorded as blocked');
    ok(String(shipped.rec.message).indexOf(entry.cure) > 0,
      entry.code + ': the receipt does not carry its own cure sentence: ' + shipped.rec.message);
    eq(String(shipped.rec.message).indexOf(GENERIC_RECONCILE), -1,
      entry.code + ': the generic sentence is still swallowing the plain one: ' + shipped.rec.message);
    eq(String(shipped.rec.message).indexOf(entry.code), -1,
      entry.code + ': the doctor is shown the raw extension token: ' + shipped.rec.message);

    /* THE NEGATIVE CONTROL: the pre-fix bytes answer with the generic sentence */
    const pre = await reconcileReceipt(entry.code, PREFIX_FLOW);
    ok(pre.rec && String(pre.rec.message).indexOf(GENERIC_RECONCILE) === 0,
      entry.code + ': THE CONTROL IS INERT - the pre-fix bytes already said the cure: ' + (pre.rec && pre.rec.message));
    eq(String(pre.rec.message).indexOf(entry.cure), -1,
      entry.code + ': the pre-fix bytes already carried this cure, so this case measures nothing');
  }

  /* ===== 3. AN ATTEMPTED OUTCOME IS STILL NEVER PARAPHRASED =================
   * The pre-existing rule: if the extension says it touched Athena, its own
   * words and its uncertain status stand. The fix above changed the order of
   * two fallbacks; it did not reach into this. */
  {
    const code = 'section-persistence-readback-mismatch';
    const h = makeHarness({
      onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
        ? { ok: false, mode: 'execute', action: 'save_draft', attempted: true, reason: code }
        : dflt(m))
    });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(OP_SECTION), expectedContext: BOUND, receiptSessionId: 'nat-attempted' });
    await settle(160);
    const finish = manifest.rows.filter(r => r.action === 'save_draft')[0];
    h.el('mlsAthenaUnifiedGo').click();
    await settle(1800);
    const rec = h.receipts()[finish.id];
    ok(rec, 'an attempted refusal minted no receipt');
    eq(rec.status, 'uncertain', 'an ATTEMPTED refusal no longer halts the review as uncertain');
    ok(String(rec.message).indexOf(GENERIC_RECONCILE) === 0,
      'an attempted outcome is now paraphrased into the plain-English cure: ' + rec.message);
    eq(String(rec.message).indexOf('press Check Athena again'), -1,
      'an attempted outcome was handed a one-step cure it has not earned: ' + rec.message);
  }

  /* ===== 4. THE GENERIC SENTENCE IS STILL THE FALLBACK, NOT THE FIRST WORD ==
   * It is still in the source, still covering the same codes, and still what a
   * per-section native-persistence refusal reads when the extension says it
   * attempted the write. */
  {
    const code = 'native-persistence-readback-mismatch';
    const h = makeHarness({
      onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'write_note')
        ? { ok: false, mode: 'execute', action: 'write_note', attempted: true, reason: code }
        : dflt(m))
    });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(OP_SECTION), expectedContext: BOUND, receiptSessionId: 'nat-section' });
    await settle(160);
    const write = manifest.rows.filter(r => r.action === 'write_note')[0];
    h.el('mlsAthenaUnifiedGo').click();
    await settle(1800);
    const rec = h.receipts()[write.id];
    ok(rec, 'the refused section write minted no receipt');
    ok(String(rec.message).indexOf(GENERIC_SECTION) === 0,
      'the generic per-section sentence stopped being the fallback for an attempted write: ' + rec.message);
  }

  /* ===== 5. THE SHEET-WIDE SENTENCES AGREE WITH THE ROW THEY SIT OVER ======
   * The amber "Nothing has changed yet" banner and the How-this-works guide
   * both promised native persistence plus a read-only saved-note check on the
   * CAPABILITY alone. A GENERIC review - one 'note' section, no named Athena
   * destinations - mints a plain READY save-draft row whose own consequence
   * says it clicks that encounter's Save / Save Draft control, and no
   * reconciliation row at all, so the guide read "It does not press Save"
   * directly above a row that presses Save. Capability AND the shape. */
  {
    const named = makeHarness({});
    named.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'shape-named' });
    await settle(160);
    const namedHtml = named.cardHtml();
    ok(namedHtml.indexOf('Nothing has changed yet.') > 0, 'the named-section sheet lost its standing promise');
    ok(namedHtml.indexOf('presses this encounter&rsquo;s Save once first if Athena has not already saved it') > 0,
      'the named-section sheet does not state both outcomes of the final press');
    eq(/The final saved-note check is read-only/.test(namedHtml), false,
      'the banner promises read-only on the capability alone again');
    eq(/MLS finishes with a read-only saved-note verification\. It does not press Save/.test(namedHtml), false,
      'the guide promises read-only on the capability alone again');

    const generic = makeHarness({});
    const gm = generic.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: 'Synthetic generic encounter note body for this suite.' }], expectedContext: BOUND, receiptSessionId: 'shape-generic' });
    await settle(160);
    const save = gm.rows.filter(r => r.id === 'save-draft')[0];
    ok(save, 'the generic review no longer mints the plain save-draft row this case is about');
    ok(/Save \/ Save Draft control/.test(String(save.consequence)),
      'the generic save-draft row stopped saying it clicks the encounter Save control: ' + save.consequence);
    eq(gm.rows.filter(r => r.id === 'save-named-sections').length, 0,
      'the generic review minted a reconciliation row, so this case no longer measures the contradiction');
    const genericHtml = generic.cardHtml();
    eq(/read-only saved-note verification|The final saved-note check is read-only|does not press Save/.test(genericHtml), false,
      'the generic review still says MLS does not press Save, over a row that presses Save');
    ok(genericHtml.indexOf('can save an unsigned draft when you choose Save draft') > 0,
      'the generic review lost the sentence that is true for it');
  }

  /* ===== 5b. AN OP NOTE CANNOT TAKE THE READ-ONLY LEG AT ALL (savetruth-1.2.0)
   * MLS Assist gates native persistence on its own four-key set, and
   * 'procedure' is not in it (background.js: nativePersistenceRequired is a
   * Slate editor AND /^(hpi|ros|exam|ap)$/), so on an operative note the final
   * press is ALWAYS the encounter Save click. Offering that doctor a
   * both-outcomes sentence hands him a read-only alternative his review can
   * never take, so the shape - not the capability flag - decides the words. */
  {
    const op = makeHarness({});
    const m = op.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(OP_SECTION), expectedContext: BOUND, receiptSessionId: 'shape-opnote' });
    await settle(160);
    const save = m.rows.filter(r => r.action === 'save_draft')[0];
    ok(save, 'the op-note review no longer mints a save row');
    eq(save.label, 'Save the encounter in Athena', 'the op-note save row claims an outcome its sections cannot take');
    ok(/presses the encounter Save in athenaOne once/.test(String(save.consequence)),
      'the op-note save row stopped naming the Save press it will really make: ' + save.consequence);
    const opHtml = op.cardHtml();
    eq(/presses this encounter&rsquo;s Save once first if Athena has not already saved it/.test(opHtml), false,
      'the op-note sheet still offers a read-only alternative its sections cannot take');
    ok(opHtml.indexOf('can save an unsigned draft when you choose Save draft') > 0,
      'the op-note sheet lost the sentence that is true for it');
  }

  /* ===== 6. A CURE MAY ONLY NAME A CONTROL THAT IS ON THAT SCREEN ===========
   * Twelve refusal sentences end in "press Check Athena again". Before
   * savetruth-1.1.0 the ONLY thing that ever put that button on screen was
   * unifiedRecheckButton, which is reachable from the read-only PROBE path
   * alone - so a refusal that arrived from the EXECUTE path named a control
   * the doctor did not have, and the button he DID have answered "The selected
   * action is not bound to a fresh exact Athena check" and did nothing.
   * Both halves are pinned: the control exists, and it re-probes. */
  {
    const code = 'section-persistence-frame-changed';
    const h = makeHarness({
      onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
        ? { ok: false, mode: 'execute', action: 'save_draft', attempted: false, blocked: true, reason: code }
        : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'cure-control' });
    await settle(200);
    h.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    const saveRec = h.receipts()['save-named-sections'];
    ok(saveRec && saveRec.status === 'blocked', 'the refused saved-note step did not mint a blocked receipt');
    ok(/press Check Athena again/.test(String(saveRec.message)),
      'this case no longer measures a cure that names a control: ' + saveRec.message);
    const recheck = h.el('mlsAthenaUnifiedRecheck');
    ok(recheck, 'the cure named "Check Athena again" and no such control was put on the screen');
    eq(String(recheck.textContent), 'Check Athena again', 'the control the cure names is not the control that appeared');
    const before = h.posted.filter(p => p.type === 'mlsAppAthenaActionV2' && p.mode === 'probe').length;
    recheck.click();
    await settle(600);
    const after = h.posted.filter(p => p.type === 'mlsAppAthenaActionV2' && p.mode === 'probe').length;
    ok(after > before, 'pressing the control the cure names ran no read-only re-check');
    ok(h.posted.filter(p => p.type === 'mlsAppAthenaActionV2' && p.mode === 'execute').length > 0,
      'this case never reached an execute, so it measured nothing');
  }

  /* ===== 7. A READ-ONLY REFUSAL MAY NEVER SAY SAVE WAS ATTEMPTED ============
   * (owner decision D2, 2026-09-10.) MLS Assist answers the read-only
   * saved-note reconciliation with attempted:true whenever it got as far as
   * walking the encounter's own section tabs - that leg clicks nav beads and
   * NEVER a Save control. The pill, the primary button and the progress footer
   * all said "Athena Save was attempted" / "Save outcome uncertain" /
   * "Encounter save was not verified" beside the receipt for the SAME press
   * saying it was read-only and did not press Save. The burden is now the
   * right way round: a receipt has to PROVE the Save click ran before any of
   * those three may name it. */
  {
    const h = makeHarness({
      onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
        ? { ok: false, mode: 'execute', action: 'save_draft', attempted: true, reason: 'section-persistence-readback-mismatch',
          message: 'Athena did not confirm the saved note.' }
        : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'readonly-uncertain' });
    await settle(200);
    h.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    const rec = h.receipts()['save-named-sections'];
    ok(rec && rec.status === 'uncertain', 'the attempted read-only refusal did not mint an uncertain receipt');
    const pill = String(h.el('mlsAthenaUnifiedState').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    eq(/Save was attempted/.test(pill), false, 'the pill still says Athena Save was attempted after a read-only refusal: ' + pill);
    /* savetruth-1.3.0 / owner decision D2: this family's sentence, byte for byte */
    ok(pill.indexOf('MLS could not verify the saved note. Nothing was pressed. Inspect this encounter, then press Confirm again.') >= 0,
      'the pill does not carry the read-only family\'s own sentence: ' + pill);
    /* ...and owner decision D3: the press that sentence names has to exist. A
       leg that pressed nothing leaves the sheet ALIVE, so Confirm is live, it
       names the save press, and the read-only re-check is on screen beside it. */
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, false, 'the cure says "press Confirm again" and Confirm is dead: ' + go.textContent);
    ok(/save|verify/i.test(String(go.textContent)),
      'Confirm no longer names the save press its own cure sentence tells him to make: ' + go.textContent);
    ok(h.el('mlsAthenaUnifiedRecheck'), 'a refusal that pressed nothing left no read-only re-check on the screen');
    const footer = String(h.el('mlsAthenaUnifiedProgress').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    eq(/Encounter save was not verified/.test(footer), false,
      'the progress footer still reports a Save that was never pressed: ' + footer);
    ok(/MLS did not press Save/.test(footer), 'the progress footer does not say nothing was pressed: ' + footer);

    /* ...and the SAVE CLICK leg keeps its own words, so this is not a blanket
       rewrite. A legacy encounter really does press Save. */
    const legacy = makeHarness({
      onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
        ? { ok: false, mode: 'execute', action: 'save_draft', attempted: true, saved: true,
          reason: 'exact-save-control-context-verified', message: 'Athena did not verify the save.' }
        : dflt(m))
    });
    legacy.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-click-uncertain' });
    await settle(200);
    legacy.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    const legacyPill = String(legacy.el('mlsAthenaUnifiedState').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    ok(/Athena Save was attempted/.test(legacyPill),
      'a real Save press stopped being reported as an attempted Save: ' + legacyPill);
    eq(String(legacy.el('mlsAthenaUnifiedGo').textContent), 'Save outcome uncertain — inspect Athena',
      'a real Save press stopped being named on the button');
  }

  /* ===== 8. THE GENERIC REVIEW: A SAVE PRESS IS A SAVE PRESS ================
   * (owner decision D4, 2026-09-10.) A GENERIC review has no named Athena
   * destinations and no reconciliation row: its 'save-draft' row clicks that
   * encounter's own Save / Save Draft control in EVERY shipped extension. The
   * sheet said "no save" over it before the press, and "MLS never saves and
   * never signs" after Athena had verified the save. */
  {
    const h = makeHarness({});
    const m = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(GENERIC_NOTE_SECTION), expectedContext: BOUND, receiptSessionId: 'generic-save' });
    await settle(200);
    eq(m.rows.filter(r => r.id === 'save-named-sections').length, 0,
      'the generic review minted a reconciliation row, so this case measures the wrong shape');
    ok(h.selectRow('save-draft'), 'the generic review offers no Save draft radio to select');
    await settle(900);
    const ready = String(h.el('mlsAthenaUnifiedState').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    ok(/runs only Save draft in Athena/.test(ready), 'the pill does not name the selected Save press: ' + ready);
    eq(/no save/i.test(ready), false, 'the pill still promises no save over a selected Save press: ' + ready);
    eq(/verif/i.test(ready), false, 'the generic review promises a verification leg it does not have: ' + ready);
    const go = h.el('mlsAthenaUnifiedGo');
    const aria = String(go.getAttribute('aria-label') || '') + ' ' + String(go.title || '');
    eq(/verify/i.test(aria), false, 'the generic Save press advertises a verify leg: ' + aria);
    go.click();
    await settle(3000);
    const rec = h.receipts()['save-draft'];
    ok(rec && rec.status === 'verified', 'the generic Save draft press minted no verified receipt');
    const footer = String(h.el('mlsAthenaUnifiedProgress').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    eq(/MLS never saves or signs/.test(footer), false,
      'the progress footer still claims MLS never saves after a verified Save: ' + footer);
    ok(/MLS saved this draft in athenaOne and read the save back/.test(footer),
      'the progress footer does not report the save that landed: ' + footer);
    const safety = String(h.el('mlsAthenaUnifiedSafety').innerHTML || '');
    eq(/Nothing has changed yet/.test(safety), false,
      'the standing safety banner still says nothing has changed after a verified Save: ' + safety);
    ok(/MLS saved this draft in athenaOne/.test(safety),
      'the repainted safety banner does not report what landed: ' + safety);
  }

  /* ===== 9. THE MID-RUN PERSISTENCE CLAIM IS MEASURED, NOT ASSUMED =========
   * (owner decision D4, 2026-09-10.) The pill painted while a section is on
   * the wire promised "Athena persists this unsigned field as it is written"
   * from the capability pong alone. On a legacy encounter and on every op note
   * MLS Assist answers exact-note-editor-verified-unsaved and nothing is saved
   * at all. It may claim persistence only for a key athenaOne can persist AND
   * only once a receipt in this review carries persistenceMode native-section. */
  {
    const seen = [];
    const h = makeHarness({
      onAction: (msg, dflt) => {
        if (msg.mode === 'execute' && msg.action === 'write_note') {
          seen.push(String(h.el('mlsAthenaUnifiedState').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
        }
        return dflt(msg);
      }
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'writeflight' });
    await settle(200);
    h.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    ok(seen.length >= 2, 'this case never saw two sections on the wire, so it measured nothing');
    eq(/persists this unsigned field as it is written|persists the field as it is written/.test(seen[0]), false,
      'the first section on the wire still claims persistence before any receipt proves it: ' + seen[0]);
    ok(/does not press Save on this step/.test(seen[0]),
      'the first section on the wire lost the sentence that is certainly true: ' + seen[0]);
    ok(/Athena saves some of these fields itself as they are written/.test(seen[seen.length - 1]),
      'after a native-section receipt landed the pill still will not say what Athena did: ' + seen[seen.length - 1]);

    /* an op note can never earn that claim, however many sections land */
    const opSeen = [];
    const op = makeHarness({
      onAction: (msg, dflt) => {
        if (msg.mode === 'execute' && msg.action === 'write_note') opSeen.push(String(op.el('mlsAthenaUnifiedState').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' '));
        return dflt(msg);
      }
    });
    op.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(OP_SECTION), expectedContext: BOUND, receiptSessionId: 'writeflight-op' });
    await settle(200);
    op.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    ok(opSeen.length >= 1, 'the op-note case never reached an execute');
    opSeen.forEach(function (line, i) {
      eq(/Athena saves some of these fields itself|persists this unsigned field/.test(line), false,
        'the op-note run claimed native persistence at step ' + i + ': ' + line);
    });
  }

  /* ===== 10. THE GENERIC REVIEW'S OWN SAVE, BEFORE AND AFTER IT RUNS =======
   * (owner decision D4, 2026-09-10; the residual the doctor-truth re-review
   * measured on live, HEAD and the working tree alike.)
   * The natural order is: write the note, THEN select Save draft and press. In
   * that order every "one press is left" sentence on the sheet is keyed off
   * savenamedOwedRow, which answers only for the NAMED reconciliation row a
   * generic review never mints - so the sheet read, all at once:
   *     pill    "DONE - Now do the last step yourself in athenaOne: Save, then
   *              Sign. MLS never saves and never signs."
   *     button  "Nothing left to send"   (ENABLED, armed save_draft)
   *     banner  "Everything on this review is in Athena - 1 of 1 note sections
   *              verified. Nothing was saved or signed; finish Save / Sign in
   *              Athena yourself."
   * ...over a live Save press. And after that press landed VERIFIED the same
   * green banner still said nothing was saved. */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(GENERIC_NOTE_SECTION), expectedContext: BOUND, receiptSessionId: 'generic-owed' });
    await settle(200);
    /* 1. write the note first, exactly as a doctor would */
    h.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    ok(h.receipts()['write-note'] && h.receipts()['write-note'].status === 'verified',
      'the generic note did not land, so this case measures the wrong state');
    /* 2. ...then select the Save draft row */
    ok(h.selectRow('save-draft'), 'the generic review offers no Save draft radio to select');
    await settle(1200);
    eq(!!h.receipts()['save-draft'], false, 'the save already ran - this case is meant to measure the state BEFORE it');

    const pill = String(h.el('mlsAthenaUnifiedState').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    eq(/MLS never saves/.test(pill), false,
      'the pill still says MLS never saves over a selected, armed Save press: ' + pill);
    eq(/\bDONE\b/.test(pill), false, 'the pill calls the review DONE with its save press still owed: ' + pill);
    const go = h.el('mlsAthenaUnifiedGo');
    eq(/Nothing left to send/.test(String(go.textContent)), false,
      'the primary button still reads "Nothing left to send" with a Save press armed: ' + go.textContent);
    const receiptPanel = String(h.el('mlsAthenaUnifiedReceipt').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    eq(/Everything on this review is in Athena/.test(receiptPanel), false,
      'the sheet painted its ENDING banner over a save press it still owes: ' + receiptPanel);
    /* 3. now press it. Athena verifies the save - and the banner may no longer
          say nothing was saved. */
    go.click();
    await settle(3000);
    const rec = h.receipts()['save-draft'];
    ok(rec && rec.status === 'verified', 'the generic Save draft press minted no verified receipt');
    const after = String(h.el('mlsAthenaUnifiedReceipt').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    ok(/Everything on this review is in Athena/.test(after),
      'the completion banner never returned after the save landed: ' + after);
    eq(/Nothing was saved or signed/.test(after), false,
      'the green completion banner still says nothing was saved over a VERIFIED Save receipt: ' + after);
    ok(/MLS saved this draft in athenaOne and read the save back/.test(after),
      'the completion banner does not report the save that landed: ' + after);
  }

  /* ===== 11. AN UNCERTAIN SAVE MAY NOT BE CALLED "NOTHING WAS SAVED" =======
   * The standing amber safety banner repaints through unifiedSavedSentence. On
   * a legacy Save click that came back save-readback-missing - the extension's
   * own words: "MLS pressed the encounter Save control, but athenaOne did not
   * paint a saved confirmation" - it answered "This review has already sent to
   * Athena. Nothing was saved and nothing was signed." on the same screen as
   * the pill saying the Save was attempted and unverified. */
  {
    const h = makeHarness({
      persist: false,
      onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
        ? { ok: false, mode: 'execute', action: 'save_draft', attempted: true, partialMutation: true,
          reason: 'save-readback-missing',
          error: 'MLS pressed the encounter Save control, but athenaOne did not paint a saved confirmation.' }
        : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-unsure' });
    await settle(200);
    h.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    const rec = h.receipts()['save-named-sections'];
    ok(rec && rec.status === 'uncertain', 'the save-readback-missing refusal did not mint an uncertain receipt');
    ok(rec.partialMutation === true, 'the receipt no longer records that Athena may have changed');
    const safety = String(h.el('mlsAthenaUnifiedSafety').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    eq(/Nothing was saved and nothing was signed/.test(safety), false,
      'the safety banner asserts nothing was saved where the outcome is unknown: ' + safety);
    ok(/could not verify the result/.test(safety),
      'the safety banner does not say the outcome is unverified: ' + safety);
    /* ...and a REAL Save press still keeps its own words on the pill */
    const pill = String(h.el('mlsAthenaUnifiedState').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    ok(/Athena Save was attempted/.test(pill), 'a real Save press stopped being reported as attempted: ' + pill);
    /* a partial mutation is NOT read-only, so the sheet is still halted */
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, true, 'a Save press with an unknown result left the sheet live');
  }

  /* ===== 12. A SAVE STEP THAT TIMED OUT CLAIMS NEITHER LEG =================
   * The uncertain wording used to be chosen by ONE negative test - "the receipt
   * did not prove a Save click" - so a timeout, which proves nothing at all,
   * was told "It did not press Save". Nobody can know that. */
  {
    const h = makeHarness({
      onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
        ? { __timeout: true } : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-timeout' });
    await settle(200);
    h.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    const rec = h.receipts()['save-named-sections'];
    ok(rec && rec.status === 'uncertain', 'the timed-out save did not mint an uncertain receipt');
    const pill = String(h.el('mlsAthenaUnifiedState').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    eq(/did not press Save|Nothing was pressed/.test(pill), false,
      'a timed-out save is told nothing was pressed, which nobody can know: ' + pill);
    eq(/Save was attempted/.test(pill), false,
      'a timed-out save is told Save was attempted, which nobody can know: ' + pill);
    ok(/could not verify the result of this save step/.test(pill),
      'a timed-out save does not say plainly that the result is unknown: ' + pill);
    eq(h.el('mlsAthenaUnifiedGo').disabled, true, 'a save with an unknown result left the sheet live');
  }

  /* ===== 13. A REFUSAL THE EXTENSION SENT NO WORDS FOR IS STILL A SENTENCE ==
   * MLS Assist 3.0.115 answers the read-only leg's MID-READ refusals with
   * attempted:true and no error text at all (3.0.116 sends a plain sentence).
   * The "an attempted outcome keeps the extension's words" rule then had no
   * words to keep, and the receipt printed the code: "Verify or save the note
   * in Athena  UNCERTAIN  context-mismatch". */
  {
    for (const code of ['context-mismatch', 'note-editor-unreadable']) {
      const h = makeHarness({
        onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
          ? { ok: false, mode: 'execute', action: 'save_draft', attempted: true, readOnly: true, reason: code }
          : dflt(m))
      });
      h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'codeless-' + code });
      await settle(200);
      h.el('mlsAthenaUnifiedGo').click();
      await settle(3000);
      const rec = h.receipts()['save-named-sections'];
      ok(rec, 'the codeless refusal minted no receipt for ' + code);
      eq(String(rec.message).indexOf(code), -1,
        'the doctor was shown the raw refusal code for ' + code + ': ' + rec.message);
      ok(/[a-z]\s[a-z]/i.test(String(rec.message)) && String(rec.message).split(' ').length > 5,
        'the receipt for ' + code + ' is not an English sentence: ' + rec.message);
      /* readOnly:true is the extension asserting it touched no control, so the
         sheet stays alive and the press its cure names is real (D2 + D3) */
      eq(h.el('mlsAthenaUnifiedGo').disabled, false,
        'a refusal that pressed nothing left the sheet dead for ' + code);
    }
  }

  /* ===== 14. THE THIRD LEG CLAIMS NEITHER LEG (savetruth-1.4.0) ============
   * savetruth-1.3.0 split the footer's refused-save sentence into three legs,
   * and the third one - the leg taken when NEITHER a Save click nor the
   * read-only check is proven - still ended "MLS did not press Save and
   * nothing was signed", under the opening "The encounter save did not
   * finish". A timeout is exactly the outcome that proves neither of those:
   * the click may have landed and the answer never come back, and the step may
   * never have started. Section 12 pins the pill for that outcome; this pins
   * the footer underneath it, and the two legs that ARE proven keep their own
   * words (sections 7 and 11 carry those counter-cases). */
  {
    const NEW_THIRD = ' MLS did not get an answer from Athena for the save step. Nothing was signed. Open the encounter to check, then press Confirm again.';
    const OLD_THIRD = ' The encounter save did not finish. MLS did not press Save and nothing was signed. Inspect Athena before retrying.';
    ok(FLOW.indexOf("'" + NEW_THIRD + "'") > 0, 'the neither-leg footer sentence is not where this suite reads it');
    eq(FLOW.indexOf(OLD_THIRD), -1, 'the pre-fix neither-leg sentence is still in the shipped bytes');
    const PREFIX_THIRD_FLOW = FLOW.replace("'" + NEW_THIRD + "'", "'" + OLD_THIRD + "'");
    ok(PREFIX_THIRD_FLOW !== FLOW && PREFIX_THIRD_FLOW.length !== FLOW.length,
      'the neither-leg negative control is byte-identical to the shipped source - it would measure nothing');

    async function timedOutSaveFooter(source) {
      const h = makeHarness({
        source: source,
        onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
          ? { __timeout: true } : dflt(m))
      });
      h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'third-leg' });
      await settle(200);
      h.el('mlsAthenaUnifiedGo').click();
      await settle(3000);
      return String(h.el('mlsAthenaUnifiedProgress').innerHTML || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
    }

    const footer = await timedOutSaveFooter(FLOW);
    eq(/did not press Save/.test(footer), false,
      'the footer tells a timed-out save that Save was not pressed, which nobody can know: ' + footer);
    eq(/saved-note check/.test(footer), false,
      'the footer names a saved-note check this review is not proven to have run: ' + footer);
    eq(/Encounter save was not verified/.test(footer), false,
      'the footer reports a Save press that is not proven to have happened: ' + footer);
    ok(footer.indexOf('MLS did not get an answer from Athena for the save step. Nothing was signed. Open the encounter to check, then press Confirm again.') >= 0,
      'the footer does not say the one thing that is certain about a timed-out save: ' + footer);

    /* THE NEGATIVE CONTROL: the pre-fix bytes make the claim again */
    const pre = await timedOutSaveFooter(PREFIX_THIRD_FLOW);
    ok(/did not press Save/.test(pre),
      'the negative control does not reproduce the pre-fix claim, so this case measures nothing: ' + pre);
  }

  /* ===== 15. THE LONE SAVE PRESS IS DESCRIBED IN THE ROW'S OWN WORDS =======
   * (savetruth-1.4.0.) When the queue this press will run is the save step
   * ALONE, the primary button's hover sentence was one hand-written paraphrase
   * of the both-outcomes wording - and it had already drifted: it promised
   * "MLS checks this exact Athena encounter read-only" on EVERY shape,
   * including the operative note, whose own save row says plainly that MLS
   * presses the encounter Save (section 5b). The sentence is composed now, from
   * the very consequence the save row carries, so the button cannot say one
   * thing while the row it belongs to says another. */
  {
    const SHIPPED_TITLE_CALL = 'savenamedOnlySavePressTitle(state, qSaveRow)';
    const OLD_TITLE_LITERAL = "'Runs the final step of this review: MLS checks this exact Athena encounter read-only, then reads the saved note back - pressing this encounter\\'s Save control once first if Athena has not already saved it. It never signs and never bills.'";
    ok(FLOW.indexOf(SHIPPED_TITLE_CALL) > 0, 'the lone-save hover sentence is no longer composed where this suite reads it');
    eq(FLOW.indexOf('Runs the final step of this review'), -1, 'the hard-coded lone-save hover sentence is still in the shipped bytes');
    const PREFIX_TITLE_FLOW = FLOW.replace(SHIPPED_TITLE_CALL, OLD_TITLE_LITERAL);
    ok(PREFIX_TITLE_FLOW !== FLOW && PREFIX_TITLE_FLOW.length !== FLOW.length,
      'the hover-sentence negative control is byte-identical to the shipped source - it would measure nothing');

    /* a refusal that touched nothing leaves the sheet alive with the save step
       as the only thing left to press - the exact state this sentence is for */
    async function loneSaveTitle(sections, source) {
      const h = makeHarness({
        source: source,
        onAction: (m, dflt) => ((m.mode === 'execute' && m.action === 'save_draft')
          ? { ok: false, mode: 'execute', action: 'save_draft', attempted: false, blocked: true, reason: 'section-persistence-frame-changed' }
          : dflt(m))
      });
      const man = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(sections), expectedContext: BOUND, receiptSessionId: 'lone-save-' + sections.length });
      await settle(200);
      h.el('mlsAthenaUnifiedGo').click();
      await settle(3000);
      const go = h.el('mlsAthenaUnifiedGo');
      return { title: String(go.title || ''), disabled: go.disabled, row: man.rows.filter(r => r.action === 'save_draft')[0] };
    }

    /* the both-outcomes shape: named fields athenaOne can save itself */
    const named = await loneSaveTitle(NAMED_SECTIONS, FLOW);
    eq(named.disabled, false, 'this case no longer reaches the live lone-save press it is about');
    ok(named.row && String(named.row.consequence).length > 40, 'the named-section save row carries no consequence to derive from');
    ok(named.title.indexOf(String(named.row.consequence)) > 0,
      'the hover sentence is not the save row\'s own consequence: ' + named.title);
    ok(/If Athena already saved each reviewed section itself/.test(named.title),
      'the lone-save hover sentence stopped stating both outcomes: ' + named.title);

    /* THE COUNTER-CASE that keeps it honest: an operative note can never take
       the read-only leg, and its row says so - so its button must say so too */
    const op = await loneSaveTitle(OP_SECTION, FLOW);
    eq(op.disabled, false, 'the op-note case no longer reaches the live lone-save press');
    ok(op.row && /presses the encounter Save in athenaOne once/.test(String(op.row.consequence)),
      'the op-note save row stopped naming the Save press, so this counter-case measures nothing');
    ok(op.title.indexOf(String(op.row.consequence)) > 0,
      'the op-note hover sentence is not its own save row\'s consequence: ' + op.title);
    eq(/read-only/.test(op.title), false,
      'the op-note button still offers a read-only alternative its sections can never take: ' + op.title);
    ok(op.title !== named.title, 'both shapes get the same hover sentence, so it is not derived from the row');

    /* THE NEGATIVE CONTROL: the pre-fix bytes hand the op note the read-only
       promise again, and neither shape carries its own row's words */
    const preOp = await loneSaveTitle(OP_SECTION, PREFIX_TITLE_FLOW);
    ok(/read-only/.test(preOp.title),
      'the negative control does not reproduce the pre-fix drift, so this case measures nothing: ' + preOp.title);
    eq(preOp.title.indexOf(String(preOp.row.consequence)), -1,
      'the negative control already carries the row\'s words, so it measures nothing: ' + preOp.title);
  }

  console.log('PASS native-persistence-clarity-proof: ' + checks + ' checks - all twelve saved-note refusal codes answer in the doctor\'s own words with a tail that is true for them, each of the five codes added by 999ba30f renders its own cure through the shipped receipt path (and the pre-fix bytes do not), an ATTEMPTED outcome is still never paraphrased, none of the twelve can start an automatic re-check, and the sheet-wide banner and guide state both outcomes on a named-section review while a generic one never claims MLS will not press Save; an operative note - which athenaOne can never persist natively - is told plainly that this press is the Save click; a cure that names Check Athena again puts that control on the screen and it re-probes; a read-only saved-note refusal never says Save was attempted on the pill, the button or the footer while a real Save press still does; a generic review never advertises a verify leg and reports the save it landed on the footer and the standing safety banner; and the mid-run persistence claim waits for a native-section receipt on a key athenaOne can persist; a save step that proved neither leg claims neither on the footer, and the lone save press is described to the doctor in its own row\'s words on both the both-outcomes and the operative shapes');
})().catch(err => { console.error(err && err.message ? err.message : err); process.exit(1); });
