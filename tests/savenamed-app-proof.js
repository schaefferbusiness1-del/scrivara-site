'use strict';

/* savenamed-app-1.0.0 - THE APP HALF OF THE ENCOUNTER SAVE.
 *
 * OWNER RULING, 2026-09-02, verbatim on the next two lines:
 *   unblock the save block in mls assistant it should be able to do it if
 *   someone clicks save on mls site
 * ...and, the same minute: "no one should have to touch Athena this entire
 * process".
 *
 * WHAT WAS THERE BEFORE. A review that places NAMED Athena sections (Reviewed
 * HPI, ROS, Physical Exam, Assessment & Plan, or an op note into Procedure
 * Documentation) built its Save row as `action:'' capability:'manual'` with the
 * id `save-named-sections-manual`. It never called the bridge, it could never
 * be pressed, and the sheet's own words sent the doctor into athenaOne to do
 * BOTH remaining steps by hand. That was correct while MLS Assist had no way to
 * save a named-section encounter - findNoteAction only ever resolved a Save
 * inside exactly one GENERIC encounter-note scope, and the driver refused
 * save_draft for the named shape outright, before the probe/execute split.
 *
 * WHAT CHANGED UNDER IT. MLS Assist 3.0.111 (savenamed-1.0.0, proven in
 * tests/savenamed-splice-proof.js) added a SECOND save_draft leg on the SAME
 * supervised path: same candidate loop, same identity gates, same one-use
 * token, same fresh-trusted-click requirement, same clickOnce boundary. It is
 * taken only when EVERY reviewed section in the request is a named Athena
 * destination carrying its exact NAMED_NOTE_DESTINATIONS string; it resolves
 * the ENCOUNTER's own Save through a CLOSED label allowlist that refuses a
 * Sign, billing, order or close control without ever clicking one; and it
 * answers verified ONLY on a NEW read-back status node.
 *
 * WHAT THIS SUITE PINS, against the SHIPPED functions and with a negative
 * control that must go red on the pre-fix bytes:
 *   1. the closed action allowlists did not move, and Sign & Save is still
 *      MANUAL and still not executable - on every review;
 *   2. the row: save_draft, ready, the all-named payload it already carried,
 *      sorted LAST after every note row, and carrying NO include checkbox
 *      (bx-1.0.0 law is intact - write_note rows and only write_note rows);
 *   3. the ROW'S OWN READINESS RULE - nothing checked, nothing armed; on an
 *      older extension the save arms only once every checked section is
 *      VERIFIED; on a batch-arm extension it rides the same press as the FINAL
 *      item, because the sections are written ahead of it in that one run;
 *   4. the press: the ordered authorization on the button counts it, the
 *      button and the up-front sentence name it, and the fallback lane makes
 *      it the next "Confirm & write" press;
 *   5. the words: WAITING FOR YOUR PRESS -> VERIFIED ("Encounter saved in
 *      athenaOne and read back") -> NOT SENT with the refusal's own reason,
 *      and never MANUAL once the review has run;
 *   6. every new refusal code is a known reason with a WFCLAR sentence in
 *      doctor language, none of them is on any automatic re-check allowlist,
 *      and the one code minted AFTER a click never carries the no-change
 *      guarantee;
 *   7. the RUNNING extension (3.0.107 / 3.0.110, no savenamed leg) answers the
 *      old refusal and the sheet says, in one sentence, that MLS Assist is
 *      older than 3.0.111 - the row stays NOT SENT and nothing loops.
 *
 * Run:  node tests/savenamed-app-proof.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW_FILE = '1p-feat_mls_writeflow.js';
const FLOW = fs.readFileSync(path.join(ROOT, FLOW_FILE), 'utf8');
function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

/* ===================================================== THE NEGATIVE CONTROL ==
 * The pre-fix bytes, verbatim: the dead manual row this lane replaced. Every
 * runtime section below runs against BOTH sources and asserts that the pre-fix
 * one cannot answer - so this suite can never pass by measuring nothing. */
const SHIPPED_ROW =
  "      addRow({ id: SAVENAMED_ROW_ID, action: 'save_draft', kind: 'save', label: SAVENAMED_ROW_LABEL, destination: SAVENAMED_ROW_DESTINATION,\n" +
  "        capability: commonBlock ? 'blocked' : 'ready', reason: commonBlock, consequence: SAVENAMED_ROW_CONSEQUENCE, payload: notePayload, order: UNIFIED_ORDER.save_draft });";
const PREFIX_ROW =
  "      addRow({ id: 'save-named-sections-manual', action: '', kind: 'save', label: 'Save named sections in Athena', destination: 'Athena encounter > section-specific Save controls',\n" +
  "        capability: 'manual', reason: namedFinalReason, consequence: 'Nothing is saved automatically from this row.', payload: notePayload, order: UNIFIED_ORDER.save_draft });";
ok(FLOW.indexOf(SHIPPED_ROW) > 0, 'the shipped encounter-save row is not where this suite reads it');
eq(FLOW.indexOf(PREFIX_ROW), -1, 'the dead manual save row is still in the shipped bytes beside the executable one');
const PREFIX = FLOW.replace(SHIPPED_ROW, PREFIX_ROW);
ok(PREFIX !== FLOW && PREFIX.length !== FLOW.length, 'the negative control is byte-identical to the shipped source - it would measure nothing');

/* ================================================ 0. THE BYTES THAT MAY NOT MOVE
 * The two CLOSED action allowlists, and the include-control law. */
{
  ok(FLOW.indexOf('var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };') > 0,
    'the executable-action allowlist was rewritten - savenamed-app-1.0.0 needed nothing from it, because save_draft was ALREADY on it');
  ok(FLOW.indexOf('var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };') > 0,
    'the batch lane\'s CLOSED two-action allowlist was rewritten');
  /* bx-1.0.0 law: the include checkbox is emitted for write_note rows and for
     nothing else, and the checked-row reader still filters on ready+write_note.
     The save row therefore carries no control of its own - its readiness is a
     RULE, which is exactly what the owner ruling asked for. */
  ok(FLOW.indexOf("(row.action === 'write_note'\n        ? '<label style=\"order:-1;display:flex;gap:7px;align-items:center;margin:0 0 6px;font-size:12px;font-weight:800;color:#204034;cursor:pointer\"><input type=\"checkbox\" class=\"mls-bx-check\"") > 0,
    'the include checkbox is no longer gated on write_note - the save row would carry a control it must not have');
  const BX = FLOW.slice(FLOW.indexOf('  function bxCheckedRows(state) {'), FLOW.indexOf('  /* ------------------------------------------------------------------ */\n  /* sheetux-1.0.0'));
  ok(BX.indexOf("row.capability === 'ready' && row.action === 'write_note'") > 0,
    'the checked-row reader lost its ready/write_note gate - the save row must never be reachable through a checkbox');
  eq(BX.indexOf('savenamed'), -1, 'the readiness rule was written INTO the checked-row reader instead of beside it');
  /* the SIGN row is untouched, byte for byte, and carries no action */
  ok(FLOW.indexOf("addRow({ id: 'sign-named-sections-manual', action: '', kind: 'sign', label: 'Sign & Save named sections in Athena', destination: 'Athena encounter > Sign & Save control',\n" +
    "        capability: 'manual', reason: namedFinalReason, consequence: 'Nothing is signed automatically from this row.', payload: notePayload, order: UNIFIED_ORDER.sign_encounter });") > 0,
    'SIGN & SAVE CHANGED - it stays manual, unexecutable and byte-identical, with the sentence it always had');
}

/* ============================== 1. THE REASON CODES AND THEIR DOCTOR SENTENCES */
const REFUSALS = ['encounter-mismatch', 'forbidden-control', 'save-control-ambiguous', 'save-control-not-found', 'save-readback-missing'];
const OLD_EXT = 'named-section-final-action-unsupported';
const VERIFIED_CODE = 'exact-save-control-context-verified';

/* ------------------------------------------------------------------ fixtures */
const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-save', patientId: 'syn-save', name: 'Synthetic Patient Save', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-save', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const SECTIONS = [
  { key: 'hpi', text: 'Synthetic HPI body for the savenamed-app proof.' },
  { key: 'ros', text: 'Synthetic ROS body for the savenamed-app proof.' },
  { key: 'exam', text: 'Synthetic exam body for the savenamed-app proof.' }
];
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ------------------------------------------------------------------ DOM shim
 * The same shape tests/write-next-press-proof.js proved the renderer against:
 * the include checkboxes are parsed out of the markup the renderer actually
 * emitted, so "checked" here means the SHIPPED markup. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt'];

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
      querySelectorAll(sel) { return /mls-bx-check/.test(String(sel || '')) ? boxesOf(el) : []; },
      closest() { return null; },
      click() { (el.handlers.click || []).forEach(fn => fn({ target: el })); }
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
  const planNode = node('div');
  planNode.attrs['data-mls-next-plan'] = '1';
  const document = {
    readyState: 'complete', activeElement: null,
    body: node('body'), head: node('head'), documentElement: node('html'),
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) {
      if (String(sel || '') === '[data-mls-next-plan="1"]') return planNode;
      return resolve(sel);
    },
    querySelectorAll(sel) { return (/mls-bx-check/.test(String(sel || '')) && card) ? boxesOf(card) : []; },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return { document, resolve, planNode, boxes: () => (card ? boxesOf(card) : []), cardHtml: () => (card ? card.innerHTML : '') };
}

/* ------------------------------------------------- fake MLS Assist + clock --
 * `batchArm` chooses which extension this harness pretends to be (3.0.108+ vs
 * anything older). `noSaveLeg` is the RUNNING extension: 3.0.107 / 3.0.110,
 * which has the batch arm but no encounter-save leg at all and answers the old
 * named-section refusal. `src` chooses the shipped source or the pre-fix
 * negative control. */
function makeHarness(options) {
  options = options || {};
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
  let offset = 0;
  const RealDate = Date;
  function FakeDate(...args) { return args.length ? new RealDate(...args) : new RealDate(RealDate.now() + offset); }
  FakeDate.prototype = RealDate.prototype;
  FakeDate.now = () => RealDate.now() + offset;
  FakeDate.parse = RealDate.parse;
  FakeDate.UTC = RealDate.UTC;

  const window = {
    document: dom.document, localStorage,
    _calAppts: [clone(CAL_ROW)],
    uns: k => 'acct:' + k,
    activePatient: () => PATIENT,
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
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
    control: 'HPI editor', framePath: '0', encounterRootFingerprint: 'er', controlFingerprint: 'c',
    noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h'
  };
  function defaultAction(m) {
    if (m.mode === 'execute') {
      /* the 3.0.111 encounter-save receipt, exactly as the spliced leg answers:
         verified only on a read-back, savenamed:true, signed:false. */
      if (m.action === 'save_draft') {
        return { ok: true, mode: 'execute', action: 'save_draft', attempted: true, savenamed: true, encounterMatched: true,
          verified: true, saved: true, partialMutation: false, signed: false, sectionsDeclared: (m.sections || []).length,
          reason: 'exact-save-control-context-verified', context: clone(CONTEXT), noAutomaticChaining: 'no-automatic-chaining' };
      }
      return { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        noteWriteProof: 'proof-' + ENCOUNTER, noteWriteProofExpiresAt: FakeDate.now() + 600000, context: clone(CONTEXT) };
    }
    if (m.action === 'save_draft') {
      return { ok: true, mode: 'probe', readOnly: true, action: 'save_draft', actionToken: 'one-use-token', rowHash: m.rowHash,
        reason: 'context-verified', contextVerified: true, savenamed: true, encounterMatched: true,
        control: { labelCore: 'save', scope: 'encounter' }, context: clone(CONTEXT), noAutomaticChaining: 'no-automatic-chaining' };
    }
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
      rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(CONTEXT) };
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsPing') {
      if (!options.batchArm) return;
      return deliverRaw({ source: 'mls-ext', type: 'mlsPong', requestId: m.requestId,
        version: options.noSaveLeg ? '3.0.110' : '3.0.111', buildId: options.noSaveLeg ? '3.0.110' : '3.0.111', batchArm: '1.0.0',
        capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true, batchArmV1: true } });
    }
    if (m.type === 'mlsAppAthenaActionV2') {
      /* THE RUNNING EXTENSION. 3.0.107 / 3.0.110 refuse the named shape before
         the probe/execute split, with the code they have always used. */
      if (options.noSaveLeg && m.action === 'save_draft') {
        return deliver('mlsAppAthenaActionV2Result', m.requestId, { ok: false, blocked: true,
          reason: 'named-section-final-action-unsupported', error: 'Review and save independently placed named sections directly in Athena.' });
      }
      if (options.saveRefusal && m.action === 'save_draft') {
        return deliver('mlsAppAthenaActionV2Result', m.requestId, options.saveRefusal(m));
      }
      return deliver('mlsAppAthenaActionV2Result', m.requestId, defaultAction(m));
    }
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: options.batchArm ? '3.0.111' : '3.0.84', versionName: 'x', athena: { tabs: 1, discarded: 0 } });
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date: FakeDate, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => {
      const m = Number(ms || 0);
      if (m <= 2000 || m === 12000 || m === 15000) { offset += m; Promise.resolve().then(fn); }
      return 1;
    },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(options.src || FLOW, context, { filename: FLOW_FILE });
  return {
    window, document: dom.document, el: dom.resolve, boxes: dom.boxes, cardHtml: dom.cardHtml,
    planText: () => dom.planNode.textContent, posted,
    wf: window.__mlsWriteFlow,
    next: () => window.__mlsWriteFlow.diagnostics.wfnext,
    save: () => window.__mlsWriteFlow.diagnostics.savenamed || null,
    state: () => window.__mlsWriteFlow.diagnostics.state(),
    receiptHtml: () => String(dom.resolve('mlsAthenaUnifiedReceipt').innerHTML || ''),
    statusText: () => String(dom.resolve('mlsAthenaUnifiedProbe').textContent || ''),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    probes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe')
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }
function fireChange(box) { ((box.handlers && box.handlers.change) || []).forEach(function (fn) { fn({ target: box }); }); }

(async function run() {

  /* ============ 1. THE REASON CODES AND THEIR DOCTOR SENTENCES ============ */
  {
    const seam = makeHarness({}).wf.diagnostics;
    REFUSALS.concat([OLD_EXT, VERIFIED_CODE]).forEach(function (code) {
      eq(seam.reason(code), code, 'wfdxReason folds ' + code + ' to unlisted, so every receipt and clarity lookup loses it');
    });
    REFUSALS.concat([OLD_EXT]).forEach(function (code) {
      const clar = seam.clarity.classify(code);
      ok(clar && typeof clar === 'object', code + ' has no clarity entry - the sheet would print the raw extension token');
      const say = seam.clarity.say(clar, { destination: 'Athena encounter > HPI', label: 'Save the encounter in Athena' });
      ok(say.length > 60, 'the sentence for ' + code + ' is not a sentence');
      eq(/[a-z]-[a-z]+-[a-z]/.test(say.replace(/chrome:\/\/extensions/g, '')), false,
        'the sentence for ' + code + ' still contains a raw jargon token: ' + say);
      ok(/athenaOne|Athena/.test(say), 'the sentence for ' + code + ' never says where the doctor is: ' + say);
    });
    /* the VERIFIED code is deliberately NOT in the clarity table - it is not a
       refusal, and wfClarify is only ever consulted on one. */
    eq(seam.clarity.classify(VERIFIED_CODE), null,
      'the encounter-save VERIFIED code was given a refusal sentence - it is the code that means the save landed');

    /* NEVER A LOOP. The automatic re-check allowlists are CLOSED; not one of
       these codes is on either of them, so no refusal here can re-drive a
       check by itself. The only cycle is a press the doctor makes. */
    REFUSALS.concat([OLD_EXT]).forEach(function (code) {
      eq(seam.autoChain.retryable[code], undefined, code + ' is on the automatic re-check allowlist - that is a loop');
      eq(seam.autoChain.painting ? seam.autoChain.painting[code] : undefined, undefined,
        code + ' is on the still-painting allowlist - that is a loop');
    });

    /* THE ONE CODE MINTED AFTER A CLICK may never carry the no-change
       guarantee: save-readback-missing arrives with partialMutation:true. */
    const readback = seam.clarity.say(seam.clarity.classify('save-readback-missing'), { destination: 'x', label: 'y' });
    eq(/Nothing was changed and nothing was sent\./.test(readback), false,
      'THE SHEET PROMISED NOTHING CHANGED AFTER MLS ALREADY PRESSED SAVE: ' + readback);
    ok(/MLS pressed Save once and sent nothing else/.test(readback),
      'the post-click refusal does not say what MLS actually did: ' + readback);
    /* ...and every OTHER entry still ends in it, byte for byte */
    REFUSALS.filter(c => c !== 'save-readback-missing').concat([OLD_EXT]).forEach(function (code) {
      const say = seam.clarity.say(seam.clarity.classify(code), { destination: 'x', label: 'y' });
      ok(/Nothing was changed and nothing was sent\.$/.test(say), code + ' lost the no-change guarantee: ' + say);
    });

    /* THE RUNNING-EXTENSION SENTENCE names the version and warns off the loop */
    const oldSay = seam.clarity.say(seam.clarity.classify(OLD_EXT), { destination: 'x', label: 'y' });
    ok(/older than 3\.0\.111/.test(oldSay), 'the old-extension sentence does not name the version that fixes it: ' + oldSay);
    ok(/[Rr]eload MLS Assist/.test(oldSay), 'the old-extension sentence does not name the one move that changes the outcome: ' + oldSay);
    ok(/refuses in exactly the same way/.test(oldSay), 'the old-extension sentence does not warn him off pressing again: ' + oldSay);
  }

  /* ================= 2. THE ROW: SHAPE, PAYLOAD AND ORDER ================= */
  {
    const h = makeHarness({});
    const manifest = h.wf.buildUnifiedManifest({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-row' });
    const rowId = h.save().rowId;
    eq(rowId, 'save-named-sections', 'the encounter-save row id changed');
    const save = manifest.rows.find(r => r.id === rowId);
    ok(save, 'the named-section review builds no encounter-save row at all');
    eq(save.action, 'save_draft', 'the encounter-save row is not the supervised save_draft action');
    eq(save.capability, 'ready', 'the encounter-save row did not arrive executable on a bound review');
    eq(save.kind, 'save', 'the encounter-save row changed kind');
    eq(save.label, 'Save the encounter in Athena', 'the encounter-save row label changed');
    eq(save.destination, 'Athena encounter > Save / Save Draft control', 'the encounter-save row names something other than the encounter Save control');
    /* THE PAYLOAD IS THE ALL-NAMED ONE IT ALREADY CARRIED. That tuple list is
       what declares the shape to MLS Assist - the extension refuses the leg
       unless every section is a named destination with its exact string. */
    assert.deepStrictEqual(save.payload.sections.map(s => s.key), ['hpi', 'ros', 'exam'],
      'the encounter-save payload is not the review\'s own named section list');
    checks++;
    ok(save.payload.sections.every(s => s.execute === true && String(s.destination || '').indexOf('Athena encounter > ') === 0),
      'a section on the encounter-save payload is not a named execute:true destination - MLS Assist would refuse the shape');
    /* ORDERED LAST, after every note row */
    const noteIdx = manifest.rows.map((r, i) => (r.action === 'write_note' ? i : -1)).filter(i => i >= 0);
    ok(noteIdx.length >= 3, 'the fixture did not build the named note rows');
    ok(manifest.rows.indexOf(save) > Math.max.apply(null, noteIdx), 'the encounter-save row does not sort last, after every note row');
    /* and the SIGN row is still manual and unexecutable */
    const sign = manifest.rows.find(r => r.kind === 'sign');
    ok(sign && sign.capability === 'manual' && !sign.action, 'SIGN & SAVE BECAME EXECUTABLE');

    /* NEGATIVE CONTROL: on the pre-fix bytes there is no such row at all */
    const pre = makeHarness({ src: PREFIX });
    const preManifest = pre.wf.buildUnifiedManifest({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-row-pre' });
    eq(preManifest.rows.filter(r => r.action === 'save_draft').length, 0,
      'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes already build an executable encounter save');
    const preSave = preManifest.rows.find(r => r.kind === 'save');
    ok(preSave && preSave.capability === 'manual' && !preSave.action, 'the negative control is not the pre-fix manual row');
  }

  /* ============= 3. THE ROW'S OWN READINESS RULE (no new control) ========= */
  {
    /* an OLD extension: one row per press, so the save arms only once every
       checked section is VERIFIED. */
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-arm-old' });
    await settle(140);
    eq(h.boxes().length, 3, 'the sheet did not render one include checkbox per READY note row');
    eq(h.boxes().filter(b => b.getAttribute('data-mls-bx-row') === h.save().rowId).length, 0,
      'THE SAVE ROW CARRIES AN INCLUDE CHECKBOX - its readiness is a rule, not a new control');
    eq(h.save().armed(), false, 'the encounter save armed itself before a single section had landed');
    eq(h.save().owedRow(), null, 'the encounter save joined the press list before a single section had landed');
    eq(h.next().remainingRows().filter(r => r.action === 'save_draft').length, 0, 'the save is on the queue before anything landed');

    const go = h.el('mlsAthenaUnifiedGo');
    for (let p = 1; p <= 3; p++) { go.click(); await settle(600); }
    eq(h.executes().length, 3, 'the three sections did not land one press at a time');
    eq(h.save().armed(), true, 'every checked section landed and the encounter save is still not armed');
    const owed = h.save().owedRow();
    ok(owed && owed.id === h.save().rowId, 'the armed encounter save is not the row that is owed');
    /* THE FALLBACK PRESS: the next Confirm & write press IS the save, named */
    eq(go.textContent, 'Confirm & save the encounter in athenaOne', 'the fallback press does not name the encounter save');
    eq(h.next().remainingRows().length, 1, 'something other than the encounter save is still owed');
    eq(h.next().queueRows().length, 1, 'the one-press lane handed the queue more than the save');
    eq(h.next().queueRows()[0].action, 'save_draft', 'the one-press lane handed the queue something other than the save');

    go.click();
    await settle(900);
    eq(h.executes().length, 4, 'the save press did not reach exactly one more execute');
    eq(h.executes()[3].action, 'save_draft', 'the save press ran something other than the encounter save');
    eq(h.save().verified(), true, 'the encounter save did not verify off its own read-back receipt');
    eq(h.save().owedRow(), null, 'a verified encounter save is still owed');
    eq(go.disabled, true, 'the finished review left the button live');

    /* NEGATIVE CONTROL: the pre-fix bytes have no save to arm, ever. */
    const pre = makeHarness({ src: PREFIX });
    pre.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-arm-pre' });
    await settle(140);
    /* the seam still answers on the control (only the ROW's bytes differ), and
       what it answers is: there is no such row, so nothing can ever arm. */
    eq(pre.save().row(), null, 'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes already build an executable save row');
    eq(pre.save().armed(), false, 'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes already arm an encounter save');
    eq(pre.save().owedRow(), null, 'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes already owe an encounter save');
    const preGo = pre.el('mlsAthenaUnifiedGo');
    for (let p = 1; p <= 4; p++) { preGo.click(); await settle(600); }
    eq(pre.executes().filter(m => m.action === 'save_draft').length, 0,
      'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes already save the encounter');
    eq(preGo.textContent, 'Nothing left to send', 'the pre-fix sheet did not end where it always ended');
  }

  /* ====== 4. THE BATCH LANE: THE SAVE IS THE FINAL ITEM OF ONE PRESS ====== */
  {
    const h = makeHarness({ batchArm: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-batch' });
    await settle(160);
    const go = h.el('mlsAthenaUnifiedGo');
    eq(h.next().batchArmReady(), true, 'the harness did not advertise a batch-arm extension');
    /* armed BEFORE the press, because the sections are written ahead of it in
       the very run this press authorizes */
    eq(h.save().armed(), true, 'the encounter save does not ride the batch press');
    const queue = h.next().queueRows();
    eq(queue.length, 4, 'the batch queue is not the three sections plus the save');
    eq(queue[3].action, 'save_draft', 'the encounter save is not the FINAL item of the press');
    eq(queue.filter(r => r.action === 'save_draft').length, 1, 'the save is on the press list more than once');
    /* the ordered authorization on the button counts it, BEFORE any click */
    eq(go.getAttribute('data-mls-batch-count'), '4', 'the batch authorization does not carry one entry for the save');
    eq(String(go.getAttribute('data-mls-batch-hashes') || '').split(',').length, 4, 'the hash list does not carry one entry per row this press runs');
    /* the button and the up-front sentence name it in the doctor's words */
    eq(go.textContent, 'Confirm & write all 3, starting with HPI, then save the encounter',
      'the batch button does not say the press also saves the encounter');
    ok(/The same press then saves the encounter in athenaOne for you; Sign stays your own click\.$/.test(h.planText()),
      'the up-front sentence does not promise the save before the first press: ' + h.planText());

    go.click();
    await settle(1600);
    assert.deepStrictEqual(h.executes().map(m => m.action), ['write_note', 'write_note', 'write_note', 'save_draft'],
      'the one press did not write every section and then save the encounter, in that order');
    checks++;
    /* the save carried the review's own named list, and its own read-only check */
    eq(h.probes().filter(m => m.action === 'save_draft').length, 1, 'the encounter save executed without its own read-only check');
    assert.deepStrictEqual((h.executes()[3].sections || []).map(s => s.key), ['hpi', 'ros', 'exam'],
      'the encounter save did not carry the review\'s own named sections');
    checks++;
    eq(h.save().verified(), true, 'the batch press did not leave a verified encounter save');

    /* NEGATIVE CONTROL: the same press on the pre-fix bytes saves nothing */
    const pre = makeHarness({ batchArm: true, src: PREFIX });
    pre.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-batch-pre' });
    await settle(160);
    eq(pre.el('mlsAthenaUnifiedGo').getAttribute('data-mls-batch-count'), '3',
      'THE NEGATIVE CONTROL IS INERT: the pre-fix authorization already counts a fourth row');
    pre.el('mlsAthenaUnifiedGo').click();
    await settle(1600);
    eq(pre.executes().filter(m => m.action === 'save_draft').length, 0,
      'THE NEGATIVE CONTROL IS INERT: the pre-fix press already saved the encounter');
  }

  /* ============== 5. THE WORDS THE SAVE ROW READS, IN EVERY STATE ========= */
  {
    const h = makeHarness({ batchArm: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-words' });
    await settle(160);
    /* NEVER MANUAL. Before anything has run it is WAITING FOR YOUR PRESS. */
    const before = h.save().rowState();
    eq(before.status, 'waiting for your press', 'the save row reads ' + before.status + ' before the review has run');
    eq(/manual/i.test(before.status), false, 'THE SAVE ROW STILL READS MANUAL');
    ok(before.message.length > 40, 'the waiting sentence says nothing');

    h.el('mlsAthenaUnifiedGo').click();
    await settle(1600);
    const after = h.save().rowState();
    eq(after.status, 'verified', 'a landed, read-back encounter save does not read VERIFIED');
    eq(after.message, 'Encounter saved in athenaOne and read back. Nothing was signed and nothing was billed - only Sign is left, and Sign stays your own click in athenaOne.',
      'the verified save row does not say the encounter was saved and read back');
    /* the DONE sentence, and the banner, say the encounter is saved and that
       only Sign is left */
    const done = h.wf.diagnostics.sheetClarity.stateFor('').label;
    eq(done, 'DONE', 'a finished review with a verified save does not say DONE');
    const short = h.wf.diagnostics.sheetClarity.stateFor('').short;
    ok(/MLS saved this encounter there and read the save back/.test(short), 'the DONE sentence does not say the encounter was saved: ' + short);
    ok(/Only Sign is left, and Sign stays your own click in athenaOne\./.test(short), 'the DONE sentence does not name Sign as the only step left: ' + short);
    eq(/MLS never saves/.test(short), false, 'the DONE sentence still claims MLS never saves');
    const rec = h.receiptHtml();
    ok(rec.indexOf('MLS also saved this encounter in athenaOne and read the save back') > 0,
      'the completion banner still sends the doctor to athenaOne to save what MLS saved');
    /* the SIGN row is still MANUAL, and its sentence is the one it always had */
    const signRow = h.state().manifest.rows.find(r => r.kind === 'sign');
    eq(h.wf.diagnostics.receiptLedger.rowState(h.state(), signRow).status, 'manual', 'the Sign & Save row stopped reading MANUAL');
    eq(signRow.action, '', 'the Sign & Save row became executable');
  }

  /* ===== 6. A REFUSED SAVE READS NOT SENT, WITH THE REFUSAL'S OWN REASON == */
  {
    const h = makeHarness({ batchArm: true, saveRefusal: m => (m.mode === 'probe'
      ? { ok: false, blocked: true, action: 'save_draft', savenamed: true, encounterMatched: true, reason: 'save-control-not-found',
        error: 'MLS could not see one exact Save control in the open encounter. Nothing was changed.' }
      : { ok: false, blocked: true, reason: 'save-control-not-found' }) });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-refused' });
    await settle(160);
    h.el('mlsAthenaUnifiedGo').click();
    await settle(1800);
    eq(h.executes().filter(m => m.action === 'save_draft').length, 0, 'a refused read-only save check still reached an execute');
    const st = h.save().rowState();
    eq(/manual/i.test(st.status), false, 'a refused save row read MANUAL');
    eq(/^not sent/.test(st.status), true, 'a refused save row does not read NOT SENT: ' + st.status);
    ok(st.message.length > 40, 'the refused save row carries no reason at all');
    eq(h.save().verified(), false, 'a refused save was counted as verified');
    /* the review is not halted by a read-only refusal, and the sections stand */
    eq(h.state().halted !== true, true, 'a refused read-only save check halted the review');
    eq(h.executes().filter(m => m.action === 'write_note').length, 3, 'a refused save cost the sections their writes');
  }

  /* ====== 7. THE RUNNING EXTENSION (3.0.110): ONE SENTENCE, NO LOOP ======= */
  {
    const h = makeHarness({ batchArm: true, noSaveLeg: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(SECTIONS), expectedContext: BOUND, receiptSessionId: 'save-old-ext' });
    await settle(160);
    h.el('mlsAthenaUnifiedGo').click();
    await settle(1800);
    eq(h.executes().filter(m => m.action === 'write_note').length, 3, 'the older extension lost the section writes too');
    eq(h.executes().filter(m => m.action === 'save_draft').length, 0, 'the older extension was asked to execute a save it refuses');
    const st = h.save().rowState();
    eq(/^not sent/.test(st.status), true, 'the older extension left the save row reading ' + st.status);
    eq(h.save().verified(), false, 'an unsupported save was counted as verified');
    /* the sheet says WHY, in one sentence that names the fix and warns off the
       press that would loop - somewhere the doctor actually reads it */
    const said = h.statusText() + ' ' + st.message + ' ' + h.receiptHtml();
    ok(/older than 3\.0\.111/.test(said), 'the sheet never says the extension is older than 3.0.111');
    ok(/[Rr]eload MLS Assist/.test(said), 'the sheet never names the one move that fixes it');
    /* NO LOOP: nothing re-drove a check on its own, and the press count is the
       doctor's own. Three sections + one save = four read-only checks. */
    eq(h.probes().filter(m => m.action === 'save_draft').length, 1,
      'the unsupported save was re-checked automatically - that is the loop');
  }

  console.log('PASS savenamed-app-proof: ' + checks + ' checks - the named-section review\'s Save row is a supervised save_draft that sorts LAST, carries the all-named payload it already had and no include checkbox of its own; its readiness is a RULE (nothing checked, nothing armed; on an older extension it arms only once every checked section is VERIFIED and becomes the next "Confirm & save the encounter in athenaOne" press; on a batch-arm extension it rides the SAME press as the final item of the ordered authorization, and the button and the up-front sentence say so before the click); the row reads WAITING FOR YOUR PRESS -> VERIFIED ("Encounter saved in athenaOne and read back") -> NOT SENT with the refusal\'s own reason and never MANUAL; the DONE sentence says the encounter was saved and that only Sign is left; every new refusal code is a known reason with a doctor sentence, none is on an automatic re-check allowlist, and the one code minted after a click never claims nothing changed; the running 3.0.110 answers its old refusal and the sheet says in one sentence that MLS Assist is older than 3.0.111 without ever re-checking by itself; Sign & Save is still MANUAL and still not executable; and every runtime section is measured against the PRE-FIX bytes, where none of it happens');
})().catch(err => { console.error(err); process.exit(1); });
