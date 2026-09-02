'use strict';

/* readysay-1.0.0 / apcover-1.0.0 / preview-1.0.0 - THE SHEET SAYS ONE THING.
 *
 * MEASURED LIVE, 2026-09-02 16:29-16:31, the owner's own tab, MLS Assist
 * 3.0.110, site b1207, the authorized test patient.
 *
 *   (d) The sheet stood at READY. Its sentence read "One click on Confirm &
 *       Send runs only Write reviewed HPI. Nothing else: no save, no signature,
 *       no billing, no orders." The button under it read "Confirm & write all
 *       6, starting with HPI". The button's aria-label read "Confirm write
 *       reviewed note - next step: The chart is verified - this sends only this
 *       one action". Three surfaces, three different claims about what ONE
 *       press was about to do - and the press did the third thing: it wrote
 *       four sections.
 *
 *   (e) After the combined "Assessment & Plan" row was verified, the separate
 *       "Assessment narrative" and "Plan / Follow-up" rows refused with
 *       note-section-not-on-surface and hetDiag stageNav 'opened-A/P' /
 *       'already-open', noteTargetFound:false - this athenaOne renders ONE
 *       combined A&P field - and the sheet then offered "Confirm & write all 2,
 *       starting with Assessment narrative", a press that could only refuse
 *       again.
 *
 *   OWNER, same day, verbatim: "make a better write UI by actually showing
 *   what's going to be written in cleaner if possible".
 *
 * WHAT THIS SUITE PINS, against the SHIPPED functions, with a per-fix negative
 * control that must be inert on the pre-fix bytes:
 *   1. readysay: under a batch arm the READY sentence, the button's visible
 *      label, its aria-label and its title are ONE claim - and the exact phrase
 *      MLS Assist arms from (content.js _mlsActionLabelMatches) is still on the
 *      button, because losing it would mint no write authorization at all.
 *   2. apcover: the A/P shape this athenaOne does not have leaves the queue and
 *      the primary button the moment the other shape lands - in BOTH directions
 *      - and says it is covered instead of being offered as a press that can
 *      only refuse.
 *   3. preview: every ready write row shows the exact text that will land, in
 *      reading type with its line breaks, and that text is byte for byte the
 *      string the execute actually sends.
 *
 * NOTHING HERE MAY WEAKEN A GATE: no new row becomes sendable, Sign stays
 * manual, the two closed action allowlists are byte-identical, and a covered
 * row can only ever DISABLE the primary button, never enable it.
 *
 * Run:  node tests/write-sheet-agreement-proof.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW_FILE = '1p-feat_mls_writeflow.js';
const FLOW = fs.readFileSync(path.join(ROOT, FLOW_FILE), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

/* ===================================================== THE NEGATIVE CONTROLS */
const READYSAY_PILL =
  "    /* readysay-1.0.0: the READY promise is re-aimed at the press it is actually\n" +
  "       describing. The WORD is untouched - it is still decided by the sheet's own\n" +
  "       gates, and nothing weaker than a bound validated probe may paint READY -\n" +
  "       and every other state keeps its sentence byte for byte. */\n" +
  "    if (out.label === 'READY') {\n" +
  "      var rsay = ''; try { rsay = readysayText(state); } catch (eRs) { rsay = ''; }\n" +
  "      if (rsay) out = { label: out.label, color: out.color, short: rsay };\n" +
  "    }\n";
const READYSAY_BTN =
  "    /* readysay-1.0.0 (2026-09-02): LAST, so the button's spoken label is the\n" +
  "       one it is actually wearing. It runs after the arm above deliberately -\n" +
  "       UNIFIED_ARIA's exact phrase for this button's own action still leads the\n" +
  "       aria-label, so MLS Assist arms exactly as it always did, and what follows\n" +
  "       is the visible label plus the same sentence the READY pill is showing. */\n" +
  "    try { readysayPaintButton(state, go); } catch (eRsay) {}\n";
ok(FLOW.indexOf(READYSAY_PILL) > 0, 'the readysay pill branch is not where this suite reads it, in sheetclarState');
ok(FLOW.indexOf(READYSAY_BTN) > 0, 'the readysay button paint is not where this suite reads it, at the end of wfnextPaintPrimary');
const NO_READYSAY = FLOW.replace(READYSAY_PILL, '').replace(READYSAY_BTN, '');
ok(NO_READYSAY.length < FLOW.length, 'the readysay negative control is byte-identical to the shipped source');

const APCOVER_QUEUE =
  "      /* apcover-1.0.0 (2026-09-02): the A/P shape this athenaOne does NOT have\n" +
  "         is covered by the one that landed, so it leaves the queue and the\n" +
  "         button's \"k of N\" instead of being offered as a press that can only\n" +
  "         refuse. It stays on the sheet, stays checked, and carries its own\n" +
  "         sentence in the receipt; nothing here unticks or hides anything. */\n" +
  "      if (apCovered(state, rows[i])) continue;\n";
const APCOVER_ROWSTATE =
  "    /* apcover-1.0.0 (2026-09-02): the mutually exclusive A/P alternative whose\n" +
  "       destination has already landed in the other shape. It is not owed work,\n" +
  "       not a failure and not the doctor's own un-tick - it is covered, and it\n" +
  "       says so. A real receipt and the durable ledger both outrank it above. */\n" +
  "    var covered = apCoveredState(state, row);\n" +
  "    if (covered) return covered;\n";
const APCOVER_PLAN = " && !apCovered(state, r)";
ok(FLOW.indexOf(APCOVER_QUEUE) > 0, 'the apcover queue clause is not where this suite reads it, in wfnextRemainingRows');
ok(FLOW.indexOf(APCOVER_ROWSTATE) > 0, 'the apcover receipt clause is not where this suite reads it, in receiptStateForRow');
ok(FLOW.indexOf(APCOVER_PLAN) > 0, 'the apcover plan clause is not where this suite reads it, in unifiedPrimaryPlan');
const NO_APCOVER = FLOW.replace(APCOVER_QUEUE, '').replace(APCOVER_ROWSTATE, '').replace(APCOVER_PLAN, '');
ok(NO_APCOVER.length < FLOW.length, 'the apcover negative control is byte-identical to the shipped source');

const PREVIEW_HUNK =
  "      /* preview-1.0.0 (owner 2026-09-02): the exact text that will land, as it\n" +
  "         will land, on the row itself. The engineer's payload disclosure below\n" +
  "         is unchanged - same summary, same slab, same two hashes. */\n" +
  "      previewBlockHtml(manifest, row) +\n";
ok(FLOW.indexOf(PREVIEW_HUNK) > 0, 'the preview block is not where this suite reads it, in unifiedReadyRowHtml');
const NO_PREVIEW = FLOW.replace(PREVIEW_HUNK, '');
ok(NO_PREVIEW.length < FLOW.length, 'the preview negative control is byte-identical to the shipped source');

/* ============================================ 0. THE BYTES THAT MAY NOT MOVE */
{
  ok(FLOW.indexOf('var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };') > 0,
    'the executable-action allowlist was rewritten - none of these three lanes needed anything from it');
  ok(FLOW.indexOf('var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };') > 0, 'the batch lane\'s CLOSED two-action allowlist was rewritten');
  ok(FLOW.indexOf("addRow({ id: 'sign-named-sections-manual', action: '', kind: 'sign'") > 0, 'SIGN & SAVE CHANGED - it stays manual and unexecutable');
  /* THE ARMING PHRASE, read off the extension that consumes it. */
  ok(CONTENT.indexOf("if (action === 'write_note') return /\\bconfirm\\s+write\\s+reviewed\\s+note\\b/i.test(label);") > 0,
    'MLS Assist no longer arms write_note from this exact phrase - re-derive readysay before trusting this suite');
  ok(CONTENT.indexOf("var label = String((t.textContent || t.value || '') + ' ' + (t.getAttribute('aria-label') || '') + ' ' + (t.getAttribute('title') || ''))") > 0,
    'MLS Assist no longer reads the arming label off textContent + aria-label + title');
  /* apcover may only ever SHRINK the owed list */
  const PLAN = FLOW.slice(FLOW.indexOf('  function unifiedPrimaryPlan(state) {'), FLOW.indexOf('  function unifiedSyncPrimaryButton(state) {'));
  eq((PLAN.match(/apCovered\(/g) || []).length, 1, 'apcover reaches the plan in more than one place - it is one clause on the owed filter and nothing else');
  ok(PLAN.indexOf("!apCovered(state, r)") > 0, 'the apcover clause is not a NEGATIVE filter - it could add a row to the owed list');
  const AP = FLOW.slice(FLOW.indexOf('  function apLandedSide(state) {'), FLOW.indexOf('  /* ===== end apcover-1.0.0'));
  eq(AP.indexOf('receiptStateForRow'), -1, 'apcover reads receiptStateForRow, which now asks apcover - the two would call each other');
  eq(AP.indexOf('checked'), -1, 'apcover reads or writes a checkbox - rowsel-1.0.0 reserves the tick for the doctor');
  const PV = FLOW.slice(FLOW.indexOf("  var PREVIEW_SHOW_ALL = 'Show all';"), FLOW.indexOf('  /* ===== end preview-1.0.0'));
  eq(PV.indexOf('slice('), -1, 'the preview truncates the payload string - a preview that is not the payload is a lie');
  eq(PV.indexOf('monospace'), -1, 'the preview is monospace - the owner asked for the text as it will land, in reading type');
  ok(PV.indexOf('white-space:pre-wrap') > 0, 'the preview does not preserve the line breaks the text will land with');
}

/* ------------------------------------------------------------------ fixtures */
const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-ag', patientId: 'syn-ag', name: 'Synthetic Patient Agree', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-ag', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
/* five named sections -> five rows plus the combined A&P row = SIX write rows,
   which is the shape the owner pressed on 2026-09-02. */
const FIVE = [
  { key: 'hpi', text: 'Line one of the HPI.\nLine two of the HPI.\nLine three of the HPI.' },
  { key: 'ros', text: 'Constitutional: negative.\nRespiratory: negative.' },
  { key: 'exam', text: 'General: well appearing.\nHEENT: normal.' },
  { key: 'assessment', text: 'Assessment narrative body.' },
  { key: 'plan', text: 'Plan and follow-up body.' }
];
const TWO = [
  { key: 'hpi', text: 'Two-row HPI body.\nSecond line.' },
  { key: 'ros', text: 'Two-row ROS body.' }
];
const GENERIC = [{ key: 'note', text: 'Generic encounter note body.\nSecond line of it.' }];
function clone(v) { return JSON.parse(JSON.stringify(v)); }
function unesc(s) { return String(s).replace(/&lt;/g, '<').replace(/&amp;/g, '&'); }
function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }

/* ------------------------------------------------------------------ DOM shim */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt'];
function makeDom() {
  const byId = new Map();
  const live = new Map();
  let card = null;
  function synth(attrs, text, style) {
    const el = {
      tagName: 'DIV', style: { cssText: String(style || '') }, children: [], attrs: Object.assign({}, attrs), handlers: {},
      id: '', disabled: false, title: '', textContent: String(text || ''),
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener() {}, focus() {}, select() {},
      click() { (el.handlers.click || []).forEach(fn => fn.call(el, { target: el })); },
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
    };
    return el;
  }
  function checkbox(rowId) {
    const el = synth({ 'data-mls-bx-row': rowId, class: 'mls-bx-check' }, '', '');
    el.tagName = 'INPUT'; el.type = 'checkbox'; el.checked = true;
    return el;
  }
  /* THE PREVIEW BLOCKS, parsed out of the markup the renderer actually emitted -
     so "what is on screen" here means the SHIPPED markup and nothing else. */
  function partsOf(el) {
    if (el._parts) return el._parts;
    const html = String(el.innerHTML || '');
    const boxes = [];
    let m;
    const bre = /class="mls-bx-check" data-mls-bx-row="([^"]+)"/g;
    while ((m = bre.exec(html))) boxes.push(checkbox(m[1]));
    const texts = [], toggles = [], titles = [];
    const tre = /<div data-mls-preview-text="([^"]+)" data-mls-preview-open="([01])" style="([^"]*)">([\s\S]*?)<\/div>/g;
    while ((m = tre.exec(html))) texts.push(synth({ 'data-mls-preview-text': m[1], 'data-mls-preview-open': m[2] }, unesc(m[4]), m[3]));
    const gre = /<button type="button" data-mls-preview-toggle="([^"]+)" aria-expanded="(true|false)" aria-controls="" style="[^"]*">(Show all|Show less)<\/button>/g;
    while ((m = gre.exec(html))) {
      const b = synth({ 'data-mls-preview-toggle': m[1], 'aria-expanded': m[2], type: 'button' }, m[3], '');
      b.tagName = 'BUTTON'; toggles.push(b);
    }
    const hre = /<div data-mls-preview-title="([^"]+)" style="[^"]*">([\s\S]*?)<\/div>/g;
    while ((m = hre.exec(html))) titles.push(synth({ 'data-mls-preview-title': m[1] }, unesc(m[2]), ''));
    el._parts = { boxes, texts, toggles, titles };
    return el._parts;
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
      isConnected: true, className: '', parentNode: null, _parts: null,
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
        const hit = attrHit(s);
        if (hit !== undefined) return hit;
        const m = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(s.trim());
        if (!m) return null;
        return el.children.filter(c => (m[2] === undefined ? c.getAttribute(m[1]) !== null : c.getAttribute(m[1]) === m[2]))[0] || null;
      },
      querySelectorAll(sel) { return listFor(el, sel); },
      closest() { return null; },
      click() { (el.handlers.click || []).forEach(fn => fn.call(el, { target: el })); }
    };
    let html = '', text = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return html; },
      set(v) {
        html = String(v); el._parts = null;
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
  function listFor(el, sel) {
    const s = String(sel || '');
    const host = (el && el.innerHTML) ? el : card;
    if (!host) return [];
    if (/mls-bx-check/.test(s)) return partsOf(host).boxes;
    if (/data-mls-preview-toggle/.test(s)) return partsOf(host).toggles;
    if (/data-mls-preview-text/.test(s)) return partsOf(host).texts;
    return [];
  }
  /* the app resolves ONE preview node by its exact attribute value */
  function attrHit(sel) {
    const m = /^\[(data-mls-preview-text|data-mls-preview-toggle|data-mls-preview-title)="([^"]*)"\]$/.exec(String(sel || '').trim());
    if (!m || !card) return undefined;
    const parts = partsOf(card);
    const bag = m[1] === 'data-mls-preview-text' ? parts.texts : (m[1] === 'data-mls-preview-toggle' ? parts.toggles : parts.titles);
    return bag.filter(n => n.getAttribute(m[1]) === m[2])[0] || null;
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
      const hit = attrHit(sel);
      if (hit !== undefined) return hit;
      return resolve(sel);
    },
    querySelectorAll(sel) { return listFor(card, sel); },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return {
    document, resolve, planNode,
    boxes: () => (card ? partsOf(card).boxes : []),
    previews: () => (card ? partsOf(card) : { boxes: [], texts: [], toggles: [], titles: [] }),
    cardHtml: () => (card ? card.innerHTML : '')
  };
}

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
        version: '3.0.111', buildId: '3.0.111', batchArm: '1.0.0',
        capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true, batchArmV1: true } });
    }
    if (m.type === 'mlsAppAthenaActionV2') {
      const resp = options.onAction ? options.onAction(m, defaultAction) : defaultAction(m);
      return deliver('mlsAppAthenaActionV2Result', m.requestId, resp);
    }
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.111', versionName: 'x', athena: { tabs: 1, discarded: 0 } });
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date: FakeDate, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => {
      const m = Number(ms || 0);
      if (m <= 2000 || m === 6000 || m === 12000 || m === 15000) { offset += m; Promise.resolve().then(fn); }
      return 1;
    },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(options.src || FLOW, context, { filename: FLOW_FILE });
  return {
    window, document: dom.document, el: dom.resolve, boxes: dom.boxes, previews: dom.previews, cardHtml: dom.cardHtml,
    planText: () => dom.planNode.textContent, posted,
    wf: window.__mlsWriteFlow,
    diag: () => window.__mlsWriteFlow.diagnostics,
    state: () => window.__mlsWriteFlow.diagnostics.state(),
    receiptHtml: () => String(dom.resolve('mlsAthenaUnifiedReceipt').innerHTML || ''),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    probes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe')
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }
function fireChange(box) { ((box.handlers && box.handlers.change) || []).forEach(function (fn) { fn({ target: box }); }); }
function whatHappenedRow(html, label) {
  const at = String(html).indexOf('<b>' + label + '</b><span');
  assert.ok(at >= 0, 'the "What happened" list no longer carries a block for ' + label);
  checks++;
  const next = String(html).indexOf('<b>', at + 3);
  return String(html).slice(at, next > at ? next : undefined);
}
/* the EXACT test MLS Assist runs on a trusted click, lifted from content.js */
function armsWriteNote(go) {
  const label = String((go.textContent || '') + ' ' + (go.getAttribute('aria-label') || '') + ' ' + (go.title || '')).replace(/\s+/g, ' ').trim();
  return /\bconfirm\s+write\s+reviewed\s+note\b/i.test(label);
}

(async function run() {

  /* ============ 1. readysay: ONE CLAIM ON THREE SURFACES ================== */
  {
    const h = makeHarness({ batchArm: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'rs-six' });
    await settle(400);
    const seam = h.diag().readySay;
    eq(seam.v, 'readysay-1.0.0', 'the readysay seam is not exported by the shipped module');

    const go = h.el('mlsAthenaUnifiedGo');
    const pill = h.diag().sheetClarity.stateFor('');
    eq(pill.label, 'READY', 'the six-section batch fixture did not reach READY');
    /* SIX write rows, one of which is the combined A&P - and the sheet's own
       arrival default leaves the separate pair unticked (apsel-1.0.0), so the
       count the sentence states is the count the press will run. */
    const checked = h.boxes().filter(b => b.checked).length;
    eq(checked, 4, 'the arrival default is not the apsel-1.0.0 one this sentence counts');
    /* under a batch arm a NAMED-section review always rides the encounter save
       (savenamed-app-1.0.0), so this is the armed form of the sentence. */
    eq(h.diag().savenamed.armed(), true, 'the named-section batch fixture did not arm the encounter save');
    eq(pill.short,
      'One press writes all 4 checked sections, one at a time, each read back before the next, then saves the encounter. No signature, no billing, no orders.',
      'the READY sentence is not the one this lane specified for an armed-save batch');
    eq(pill.short, seam.text(), 'the pill and the seam disagree about the sentence');

    /* THE BUTTON SAYS THE SAME THING - visible label plus that sentence. */
    const label = go.textContent;
    ok(/^Confirm & write all 4, starting with /.test(label), 'the button does not name the press it is about to make: ' + label);
    eq(go.getAttribute('aria-label'), 'Confirm write reviewed note. ' + seam.compose(label, pill.short),
      'THE MEASURED DEFECT: the button\'s aria-label does not agree with its own label and the READY sentence');
    eq(go.title, go.getAttribute('aria-label'), 'the button\'s title and aria-label are two different claims');
    /* ...and the exact phrase MLS Assist mints its authorization from is STILL
       on the button. Losing it would authorize nothing at all. */
    eq(armsWriteNote(go), true, 'THE WRITE ARM WOULD MINT NOTHING: the button lost the phrase MLS Assist matches on');
    eq(go.getAttribute('data-mls-athena-action'), 'write_note', 'the button lost the extension binding readysay is composed around');
    /* no other action's phrase is ever added - that would be cross-arming */
    const spoken = String(label + ' ' + go.getAttribute('aria-label') + ' ' + go.title).toLowerCase();
    eq(/confirm\s+sign\s*(?:&|and)\s*save/.test(spoken), false, 'the button now speaks the Sign & Save phrase - that arms a final action');
    eq(/confirm\s*(?:&|and)?\s*place\s+(?:one\s+)?(?:reviewed\s+)?order/.test(spoken), false, 'the button now speaks the order phrase');

    /* N = 1, and the plain form: a GENERIC encounter-note review mints no save
       row at all, so nothing rides the press and "No save" is still true. */
    const one = makeHarness({ batchArm: true });
    one.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(GENERIC), expectedContext: BOUND, receiptSessionId: 'rs-one' });
    await settle(400);
    eq(one.diag().savenamed.row(), null, 'the generic-note fixture minted an encounter-save row, so it cannot pin the plain sentence');
    eq(one.diag().sheetClarity.stateFor('').short,
      'One press writes all 1 checked section, one at a time, each read back before the next. No save, no signature, no billing, no orders.',
      'the READY sentence for a single checked section is not the one this lane specified');
    const oneGo = one.el('mlsAthenaUnifiedGo');
    eq(oneGo.getAttribute('aria-label'), 'Confirm write reviewed note. ' + one.diag().readySay.compose(oneGo.textContent, one.diag().sheetClarity.stateFor('').short),
      'the one-section button does not agree with its own READY sentence');
    eq(armsWriteNote(oneGo), true, 'the one-section button lost the phrase MLS Assist matches on');

    /* PROBE ONLY keeps its own promise, and an older extension keeps the
       shipped sentence byte for byte. */
    const old = makeHarness({});
    old.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'rs-old' });
    await settle(400);
    eq(old.diag().wfnext.batchArmReady(), false, 'the older-extension fixture advertised a batch arm');
    eq(old.diag().readySay.text(), '', 'the batch sentence was said on an extension that cannot take a batch authorization');
    ok(/One click on Confirm & Send runs/.test(old.diag().sheetClarity.stateFor('').short),
      'the older extension lost the shipped READY sentence: ' + old.diag().sheetClarity.stateFor('').short);

    /* NEGATIVE CONTROL */
    const pre = makeHarness({ batchArm: true, src: NO_READYSAY });
    pre.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'rs-pre' });
    await settle(400);
    const preGo = pre.el('mlsAthenaUnifiedGo');
    const preShort = pre.diag().sheetClarity.stateFor('').short;
    ok(/One click on Confirm & Send runs/.test(preShort),
      'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes already re-aim the READY sentence');
    ok(preGo.getAttribute('aria-label') !== 'Confirm write reviewed note. ' + pre.diag().readySay.compose(preGo.textContent, preShort),
      'THE NEGATIVE CONTROL IS INERT: the pre-fix button already agrees with the sentence');
    /* and the defect itself, measured: three surfaces, three claims */
    ok(preGo.textContent.indexOf('all 4') > 0 && /runs (?:only )?Write reviewed HPI/.test(preShort),
      'the pre-fix fixture did not reproduce the measured disagreement - the button names four sections while the sentence names one: ' + preGo.textContent + ' / ' + preShort);
  }

  /* ============ 2. apcover: THE OTHER A/P SHAPE IS COVERED ================ */
  {
    const h = makeHarness({ batchArm: true });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'ap-cover' });
    await settle(400);
    const seam = h.diag().apCover;
    eq(seam.v, 'apcover-1.0.0', 'the apcover seam is not exported by the shipped module');
    eq(seam.byCombinedMsg, 'Covered by the combined Assessment & Plan write (this athenaOne has one A&P field)',
      'the covered sentence is not the one this lane specified');

    const combined = manifest.rows.filter(r => r.kind === 'assessment_and_plan')[0];
    const assessment = manifest.rows.filter(r => r.kind === 'assessment')[0];
    const plan = manifest.rows.filter(r => r.kind === 'plan')[0];
    ok(combined && assessment && plan, 'the five-section fixture did not mint all three A/P destinations');

    /* the doctor ticked all three, exactly as the live run did */
    h.boxes().forEach(function (b) {
      const id = b.getAttribute('data-mls-bx-row');
      if (id === assessment.id || id === plan.id) { b.checked = true; fireChange(b); }
    });
    h.diag().apSurface.fromCheckbox(h.state());
    let ids = h.diag().wfnext.remainingRows().map(r => r.id);
    ok(ids.indexOf(assessment.id) >= 0 && ids.indexOf(plan.id) >= 0 && ids.indexOf(combined.id) >= 0,
      'the fixture did not put all three A/P rows on the queue, so this case measures nothing');

    /* THE COMBINED ROW LANDS - the shape this athenaOne actually has. */
    const state = h.state();
    const rec = { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' };
    state.receipts[combined.id] = rec;
    h.diag().receiptLedger.remember(state, combined.id, rec);
    eq(seam.side(), 'combined', 'the shipped reader did not resolve which A/P shape landed');
    eq(seam.covered(assessment), seam.byCombined, 'the separate Assessment row is not covered by the combined write');
    eq(seam.covered(plan), seam.byCombined, 'the separate Plan row is not covered by the combined write');
    eq(seam.covered(manifest.rows.filter(r => r.kind === 'hpi')[0]), '', 'apcover reached a row outside the A/P group');

    ids = h.diag().wfnext.remainingRows().map(r => r.id);
    eq(ids.indexOf(assessment.id), -1, 'THE MEASURED DEFECT: the separate Assessment row is still queued after the combined A&P landed');
    eq(ids.indexOf(plan.id), -1, 'THE MEASURED DEFECT: the separate Plan row is still queued after the combined A&P landed');
    const btn = h.diag().wfnext.buttonLabel();
    eq(/Assessment narrative|Plan \/ Follow-up/.test(btn), false,
      'the primary button still names a destination this athenaOne does not have: ' + btn);
    eq(h.diag().wfnext.queueRows().map(r => r.id).indexOf(assessment.id), -1, 'the queue this press authorizes still contains the covered row');

    /* the receipt says covered, not failed, and not "not attempted" */
    h.diag().receiptLedger.render(state);
    const block = whatHappenedRow(h.receiptHtml(), assessment.label);
    ok(block.indexOf('COVERED BY THE COMBINED WRITE') > 0, 'the covered row does not say so: ' + block.slice(0, 200));
    ok(block.indexOf('this athenaOne has one A&amp;P field') > 0 || block.indexOf('this athenaOne has one A&P field') > 0,
      'the covered row does not name the surface fact: ' + block.slice(0, 200));
    eq(block.indexOf('NOT SENT'), -1, 'a covered row is reported as a failed send');

    /* APCOVER LEAVES THE DOCTOR'S OWN TICK ALONE. It removes a row from the
       OWED list, never from the sheet and never from the checked set - and it
       can only ever DISABLE the primary button, never enable one. */
    eq(h.boxes().filter(b => b.getAttribute('data-mls-bx-row') === assessment.id)[0].checked, true,
      'apcover unticked the doctor\'s own box - rowsel-1.0.0 reserves that for him');
    ok(h.diag().sheetUx.checkedRows(h.state()).some(r => r.id === assessment.id),
      'apcover removed the covered row from the CHECKED set instead of only from the owed list');
    ok(h.cardHtml().indexOf('data-manifest-row="' + assessment.id + '"') > 0, 'apcover hid the covered row from the sheet');
    ['hpi', 'ros', 'exam'].forEach(function (k) {
      const r = manifest.rows.filter(x => x.kind === k)[0];
      state.receipts[r.id] = rec; h.diag().receiptLedger.remember(state, r.id, rec);
    });
    const plan2 = h.diag().sheetUx.plan(h.state());
    eq(plan2.mode, 'batch', 'with every destination landed and only the encounter save owed the plan is not the save press');
    eq(plan2.rows.length, 1, 'the plan carries a covered row as owed work');
    eq(plan2.rows[0].id, h.diag().savenamed.rowId, 'the only press left is not the encounter save');
    eq(h.diag().wfnext.remainingRows().map(r => r.id).indexOf(assessment.id), -1,
      'the covered row is still owed after every real destination landed');

    /* THE REVERSE DIRECTION, on a surface with two A/P fields. */
    const s = makeHarness({ batchArm: true });
    const m2 = s.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'ap-sep' });
    await settle(400);
    const c2 = m2.rows.filter(r => r.kind === 'assessment_and_plan')[0];
    const a2 = m2.rows.filter(r => r.kind === 'assessment')[0];
    const p2 = m2.rows.filter(r => r.kind === 'plan')[0];
    s.boxes().forEach(function (b) {
      const id = b.getAttribute('data-mls-bx-row');
      if (id === a2.id || id === p2.id) { b.checked = true; fireChange(b); }
    });
    const st2 = s.state();
    [a2, p2].forEach(function (r) { st2.receipts[r.id] = rec; s.diag().receiptLedger.remember(st2, r.id, rec); });
    eq(s.diag().apCover.side(), 'separate', 'a landed assessment AND plan pair did not resolve to the separate shape');
    eq(s.diag().apCover.covered(c2), s.diag().apCover.bySeparate, 'the combined row is not covered by the separate writes');
    eq(s.diag().wfnext.remainingRows().map(r => r.id).indexOf(c2.id), -1,
      'the combined A&P row is still queued after both separate destinations landed');

    /* NEGATIVE CONTROL: pre-fix, the covered row is still offered */
    const pre = makeHarness({ batchArm: true, src: NO_APCOVER });
    const m3 = pre.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'ap-pre' });
    await settle(400);
    const c3 = m3.rows.filter(r => r.kind === 'assessment_and_plan')[0];
    const a3 = m3.rows.filter(r => r.kind === 'assessment')[0];
    const p3 = m3.rows.filter(r => r.kind === 'plan')[0];
    pre.boxes().forEach(function (b) {
      const id = b.getAttribute('data-mls-bx-row');
      if (id === a3.id || id === p3.id) { b.checked = true; fireChange(b); }
    });
    const st3 = pre.state();
    st3.receipts[c3.id] = rec; pre.diag().receiptLedger.remember(st3, c3.id, rec);
    const preRemaining = pre.diag().wfnext.remainingRows().map(r => r.id);
    ok(preRemaining.indexOf(a3.id) >= 0 && preRemaining.indexOf(p3.id) >= 0,
      'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes already drop the covered rows from the queue');
    ok(/^Confirm & write all 5, /.test(pre.diag().wfnext.buttonLabel()),
      'the pre-fix fixture did not reproduce the measured button, which counts the two destinations this athenaOne does not have as owed work: ' + pre.diag().wfnext.buttonLabel());
    ok(pre.diag().wfnext.queueRows().map(r => r.id).indexOf(a3.id) >= 0,
      'the pre-fix queue does not carry the covered row, so the control cannot reproduce a press that can only refuse');
  }

  /* ============ 3. preview: THE TEXT THAT WILL LAND, AS IT WILL LAND ====== */
  {
    const seam = makeHarness({}).diag().preview;
    eq(seam.v, 'preview-1.0.0', 'the preview seam is not exported by the shipped module');
    eq(seam.openMaxRows, 3, 'the expanded-by-default rule is not the three-rows-or-fewer one this lane specified');
    ok(seam.style(false).indexOf('-webkit-line-clamp:2') > 0, 'the collapsed preview does not clamp to two lines');
    eq(seam.style(true).indexOf('line-clamp'), -1, 'the expanded preview is still clamped');

    /* SIX write rows -> collapsed, with a real button carrying aria-expanded */
    const h = makeHarness({ batchArm: true });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'pv-six' });
    await settle(400);
    const ready = manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    eq(ready.length, 6, 'the five-section fixture did not build six ready write rows');
    const parts = h.previews();
    eq(parts.texts.length, 6, 'not every ready write row shows the text that will land');
    eq(parts.toggles.length, 6, 'a preview block has no toggle control');
    parts.toggles.forEach(function (b) {
      eq(b.getAttribute('aria-expanded'), 'false', 'a six-row review did not arrive collapsed');
      eq(b.textContent, seam.showAll, 'the collapsed toggle does not offer to show all');
      eq(b.tagName, 'BUTTON', 'the preview toggle is not a real button, so it is not keyboard-reachable');
    });
    /* the destination label IS the block's title */
    parts.titles.forEach(function (t) {
      const row = ready.filter(r => r.id === t.getAttribute('data-mls-preview-title'))[0];
      ok(row, 'a preview block belongs to no ready row');
      eq(t.textContent, row.destination, 'the preview block is not titled with the exact Athena destination');
    });

    /* THE EQUALITY PIN: what the block shows IS what the execute sends. */
    ready.forEach(function (row) {
      const node = parts.texts.filter(t => t.getAttribute('data-mls-preview-text') === row.id)[0];
      ok(node, 'no preview block for ' + row.label);
      eq(node.textContent, row.payload.noteText, 'the preview text is not the row\'s own payload text for ' + row.label);
      eq(norm(node.textContent), norm(row.payload.sections[0].text),
        'the preview text is not the payload SECTION text for ' + row.label);
      eq(/```|\*\*|<b>/.test(node.textContent), false, 'the preview rendered markdown or markup for ' + row.label);
    });
    /* ...and the same string, off the wire, after one real press */
    h.el('mlsAthenaUnifiedGo').click();
    await settle(1400);
    const wrote = h.executes().filter(m => m.action === 'write_note');
    ok(wrote.length >= 1, 'the press never wrote anything, so the wire comparison measures nothing');
    wrote.forEach(function (m) {
      const row = ready.filter(r => r.payload.noteText === m.noteText)[0];
      ok(row, 'an execute carried text no preview block ever showed: ' + String(m.noteText).slice(0, 60));
      const node = parts.texts.filter(t => t.getAttribute('data-mls-preview-text') === row.id)[0];
      eq(norm(node.textContent), norm(m.noteText),
        'THE PREVIEW AND THE PAYLOAD DISAGREE for ' + row.label + ' - a preview that is not the payload is a lie');
    });

    /* THREE ROWS OR FEWER -> expanded on arrival */
    const two = makeHarness({ batchArm: true });
    two.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(TWO), expectedContext: BOUND, receiptSessionId: 'pv-two' });
    await settle(400);
    const tp = two.previews();
    eq(tp.texts.length, 2, 'the two-section review did not show both texts');
    tp.toggles.forEach(function (b) {
      eq(b.getAttribute('aria-expanded'), 'true', 'a review of three rows or fewer did not arrive expanded');
      eq(b.textContent, seam.showLess, 'the expanded toggle does not offer to show less');
    });

    /* THE TOGGLE, through the shipped click handler */
    const first = tp.toggles[0];
    const rowId = first.getAttribute('data-mls-preview-toggle');
    const textNode = tp.texts.filter(t => t.getAttribute('data-mls-preview-text') === rowId)[0];
    const before = textNode.textContent;
    first.click();
    eq(first.getAttribute('aria-expanded'), 'false', 'the toggle did not collapse the block');
    eq(first.textContent, seam.showAll, 'the toggle did not rename itself');
    eq(textNode.getAttribute('data-mls-preview-open'), '0', 'the block did not record that it is collapsed');
    ok(String(textNode.style.cssText).indexOf('-webkit-line-clamp:2') > 0, 'the collapsed block is not clamped');
    eq(textNode.textContent, before, 'collapsing the block CHANGED the text - the whole payload must stay in the DOM');
    first.click();
    eq(first.getAttribute('aria-expanded'), 'true', 'the toggle did not expand the block again');
    eq(first.textContent, seam.showLess, 'the re-expanded toggle did not rename itself back');
    eq(textNode.textContent, before, 'expanding the block CHANGED the text');
    eq(two.executes().length, 0, 'a preview toggle sent something');

    /* NEGATIVE CONTROL */
    const pre = makeHarness({ batchArm: true, src: NO_PREVIEW });
    pre.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(TWO), expectedContext: BOUND, receiptSessionId: 'pv-pre' });
    await settle(400);
    eq(pre.previews().texts.length, 0, 'THE NEGATIVE CONTROL IS INERT: the pre-fix rows already show the text that will land');
    ok(pre.cardHtml().indexOf('View the exact text going to') > 0,
      'the pre-fix rows lost writeui-1.0.0\'s own disclosure, so this control is not the pre-fix shape');
    /* ...and the shipped rows KEPT it - the engineer\'s view is not replaced */
    ok(h.cardHtml().indexOf('View the exact text going to') > 0,
      'the shipped preview REPLACED writeui-1.0.0\'s payload disclosure instead of sitting beside it');
    ok(h.cardHtml().indexOf('Payload ') > 0, 'the payload and row hashes left the sheet');
  }

  console.log('PASS write-sheet-agreement-proof: ' + checks + ' checks - under a batch arm the READY sentence, the primary button\'s visible label, its aria-label and its title are ONE claim about what one press does (and the exact phrase MLS Assist mints its write authorization from is still on the button, with no other action\'s phrase ever added); the Assessment/Plan shape this athenaOne does not have leaves the queue and the button the moment the other shape lands, in both directions, and reads COVERED instead of being offered as a press that can only refuse; and every ready write row shows the exact text that will land, in reading type with its line breaks, collapsed to two lines behind a keyboard-reachable aria-expanded toggle that never alters the string - which is byte for byte the noteText the execute actually sends - each measured against the PRE-FIX bytes, where none of it happens');
})().catch(err => { console.error(err); process.exit(1); });
