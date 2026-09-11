'use strict';
/* THE SAVE PRESS MUST STILL ARM THE EXTENSION (savetruth-1.1.0 / 1.2.0)
 *
 * WHAT WAS MEASURED
 * -----------------
 * MLS Assist mints a save_draft authorization ONLY from a real, freshly
 * trusted click whose composed label matches its own pattern. The label it
 * composes is, verbatim from content.js:
 *
 *   var label = String((t.textContent || t.value || '') + ' ' +
 *     (t.getAttribute('aria-label') || '') + ' ' +
 *     (t.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
 *
 * and the save_draft test is _mlsActionLabelMatches:
 *
 *   3.0.112 (public):  /\bconfirm\s+save\s+draft(?:\s+in\s+athena)?\b/i
 *   3.0.115 (this repo): the same, plus
 *                        |verify\s+saved\s+unsigned\s+note\s+in\s+athena
 *
 * When the both-outcomes wording ("Verify or save the note in Athena") became
 * the button's ARMING phrase it matched NEITHER pattern, so the LONE save
 * press stopped arming at all: MLS Assist answered fresh-trusted-click-required
 * while the sheet promised "one press is left". Nothing caught it, because an
 * in-batch save still arms off the batch hash list (content.js consumes the
 * gesture by preview hash inside a batch and ignores the action mismatch), and
 * that is the path every existing suite drives.
 *
 * WHAT THIS SUITE PINS (owner decision D1, 2026-09-10)
 * ---------------------------------------------------
 *   1. The two matchers are read OUT OF THE SHIPPED EXTENSION SOURCE where a
 *      copy of it is on this machine, and compared against the literals pinned
 *      below - so a drift in either direction is a failure here rather than a
 *      silent one in Athena. Where no extension folder is present (a clean CI
 *      checkout) the pinned literals stand on their own and the suite says so.
 *   2. RUNTIME, through the shipped module and the real DOM composition rule:
 *      at the moment the save press is the next press, the primary button's
 *      composed label matches BOTH patterns, in all four review shapes -
 *      named (native-capable), legacy-named, op note, and generic.
 *   3. The arming phrase is not a place for prose: the both-outcomes
 *      explanation lives in the row consequence, the pill and the guide, and
 *      the aria still leads with the phrase both extensions accept.
 *   4. A live negative control: the pre-1.1.0 arming phrase is run through the
 *      SAME matchers and must fail them, so cases 2 and 3 cannot pass vacuously.
 *
 * Run:  node tests/save-press-truth-proof.js
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

/* ===================================================== 1. THE TWO MATCHERS ===
 * The pinned copies. Source of truth: content.js _mlsActionLabelMatches. */
const SAVE_DRAFT_112 = /\bconfirm\s+save\s+draft(?:\s+in\s+athena)?\b/i;
const SAVE_DRAFT_115 = /\b(?:confirm\s+save\s+draft(?:\s+in\s+athena)?|verify\s+saved\s+unsigned\s+note\s+in\s+athena)\b/i;
/* the composition rule, verbatim from the same file's trusted-click listener */
function extensionLabel(el) {
  return String((el.textContent || el.value || '') + ' ' +
    (el.getAttribute('aria-label') || '') + ' ' +
    (el.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
}

/* Where a copy of an extension is on this machine, read ITS matcher and pin
 * ours against it. Both folders are read; neither is required. */
const EXTENSION_CANDIDATES = [
  path.resolve(ROOT, '..', 'athena-native-persistence-30115'),
  path.resolve(ROOT, '..', 'savenamed-active-surface-30114'),
  path.join(process.env.USERPROFILE || process.env.HOME || '', 'Downloads', 'MLS_Assist_v3.0.64 (1)')
];
const SOURCE_LINE = /if\s*\(action === 'save_draft'\)\s*return\s*(\/[^\n]*?\/i)\.test\(label\);/;
let extensionsRead = 0;
EXTENSION_CANDIDATES.forEach(function (dir) {
  let src = '', version = '';
  try { src = fs.readFileSync(path.join(dir, 'content.js'), 'utf8'); } catch (e) { return; }
  try { version = String(JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')).version || ''); } catch (e2) { version = '?'; }
  const m = SOURCE_LINE.exec(src);
  ok(m, 'the save_draft arming test is not where this suite reads it in ' + dir);
  const pinned = /verify/.test(m[1]) ? SAVE_DRAFT_115 : SAVE_DRAFT_112;
  eq(m[1], String(pinned), 'the pinned matcher drifted from the extension in ' + dir + ' (version ' + version + ')');
  extensionsRead++;
  /* the composition rule is read from the same file, so a change to it is
     also a failure here rather than a surprise in Athena */
  ok(src.indexOf("(t.textContent || t.value || '') + ' ' + (t.getAttribute('aria-label') || '') + ' ' + (t.getAttribute('title') || '')") > 0,
    'the trusted-click label composition changed in ' + dir + ' - re-read it before trusting this suite');
});
console.log('save-press-truth-proof: read ' + extensionsRead + ' extension copy/copies from disk' +
  (extensionsRead ? '' : ' (none present - the pinned matchers stand on their own)'));

/* the negative control: the phrase that broke it, through the same matchers */
const BROKEN_ARMING_PHRASE = 'Verify or save the note in Athena';
eq(SAVE_DRAFT_112.test(BROKEN_ARMING_PHRASE), false, 'the negative control phrase matches 3.0.112 - this suite would measure nothing');
eq(SAVE_DRAFT_115.test(BROKEN_ARMING_PHRASE), false, 'the negative control phrase matches 3.0.115 - this suite would measure nothing');
/* ...and the button text alone never rescues it: an ampersand is not whitespace */
eq(SAVE_DRAFT_112.test('Confirm & Save draft in Athena'), false,
  'the button TEXT alone arms 3.0.112, so the aria phrase would not be load-bearing and this suite would measure nothing');

/* ============================================== 2. THE SHIPPED ARMING PHRASE */
const ARIA_LITERAL = "    save_draft: 'Confirm save draft in Athena',";
ok(FLOW.indexOf(ARIA_LITERAL) > 0, 'the default save_draft arming phrase is not where this suite reads it');
const BOTH_ARIA = /var SAVENAMED_BOTH_ARIA = '([^']*)';/.exec(FLOW);
ok(BOTH_ARIA, 'the both-outcomes arming phrase is not where this suite reads it');
ok(SAVE_DRAFT_112.test(BOTH_ARIA[1]), 'the both-outcomes arming phrase does not arm 3.0.112: ' + BOTH_ARIA[1]);
ok(SAVE_DRAFT_115.test(BOTH_ARIA[1]), 'the both-outcomes arming phrase does not arm 3.0.115: ' + BOTH_ARIA[1]);
ok(BOTH_ARIA[1].indexOf('Confirm save draft in Athena') === 0,
  'the arming phrase no longer LEADS the aria-label, so a future prose edit can push it out of reach: ' + BOTH_ARIA[1]);

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
const NAMED_SECTIONS = [
  { key: 'hpi', text: 'Synthetic HPI narrative for this suite.' },
  { key: 'ros', text: 'Synthetic review of systems for this suite.' },
  { key: 'exam', text: 'Synthetic physical exam for this suite.' }
];
const OP_SECTION = [{ key: 'procedure', text: 'PROCEDURE PERFORMED: synthetic left L5-S1 transforaminal epidural steroid injection.' }];
const GENERIC_NOTE = [{ key: 'note', text: 'Synthetic generic encounter note body for this suite.' }];
function clone(v) { return JSON.parse(JSON.stringify(v)); }
const CONTEXT = {
  patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, appointmentId: APPOINTMENT,
  encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL, visitDate: ATHENA_DAY, provider: PROVIDER,
  control: 'Note editor', framePath: '0', encounterRootFingerprint: 'er',
  controlFingerprint: 'c', noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h'
};

/* ------------------------------------------------------------------ DOM shim
 * The shape tests/native-persistence-clarity-proof.js proved the renderer
 * against, plus the action radios, so a case can select the row a doctor
 * would select. Ids outside LIVE_IDS resolve lazily. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsAthenaUnifiedCopySection'];

function makeDom() {
  const byId = new Map();
  const live = new Map();
  let card = null;

  function inputNode(attrs, extra) {
    const el = Object.assign({
      tagName: 'INPUT', checked: false, disabled: false, id: '', style: {}, children: [], handlers: {},
      attrs: attrs,
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener() {}, focus() {}, click() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
    }, extra || {});
    return el;
  }
  function checkbox(rowId) {
    return inputNode({ 'data-mls-bx-row': rowId, class: 'mls-bx-check' }, { type: 'checkbox', checked: true, value: '' });
  }
  function radio(rowId, checked) {
    return inputNode({ name: 'mlsAthenaUnifiedAction', value: rowId, type: 'radio' },
      { type: 'radio', checked: !!checked, value: rowId });
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
  function radiosOf(el) {
    if (el._rx) return el._rx;
    const out = [];
    const re = /<input([^>]*name="mlsAthenaUnifiedAction"[^>]*)>/g;
    let m;
    while ((m = re.exec(String(el.innerHTML || '')))) {
      const v = /value="([^"]*)"/.exec(m[1]);
      out.push(radio(v ? v[1] : '', /\bchecked\b/.test(m[1])));
    }
    el._rx = out;
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
  return {
    document, resolve,
    cardHtml: () => (card ? card.innerHTML : ''),
    selectRow(rowId) {
      const list = card ? radiosOf(card) : [];
      const hit = list.filter(r => r.value === rowId)[0];
      if (!hit) return false;
      list.forEach(r => { r.checked = r === hit; });
      (hit.handlers.change || []).forEach(fn => fn.call(hit, { target: hit }));
      return true;
    },
    uncheckAllBut(rowId) {
      const list = card ? boxesOf(card) : [];
      let touched = 0;
      list.forEach(b => {
        const want = b.getAttribute('data-mls-bx-row') === rowId;
        if (b.checked !== want) { b.checked = want; touched++; }
      });
      return touched;
    }
  };
}

/* -------------------- an MLS Assist that answers like 3.0.115 on this shape --
 * `persist` false is the LEGACY leg: every write comes back
 * exact-note-editor-verified-unsaved and the save press is a real Save click,
 * which is what 3.0.115 does on a non-Slate encounter. */
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
  function action(m) {
    if (m.mode !== 'execute') {
      return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
        rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(CONTEXT) };
    }
    if (m.action === 'save_draft') {
      return options.persist === false
        ? { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, saved: true,
          reason: 'exact-save-control-context-verified', context: clone(CONTEXT) }
        : { ok: true, mode: 'execute', action: m.action, attempted: false, verified: true, saved: true,
          persisted: true, serverVerified: true, reason: 'exact-section-persistence-reconciled',
          sectionsDeclared: 5, persistedDestinations: 4,
          results: ['hpi', 'ros', 'exam', 'ap'].map(key => ({ ok: true, key, saved: true, persisted: true, verified: true })),
          context: clone(CONTEXT) };
    }
    const key = String((m.sections && m.sections[0] && m.sections[0].key) || '');
    return options.persist === false
      ? { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        reason: 'exact-note-editor-verified-unsaved',
        results: [{ key, attempted: true, written: true, verified: true }],
        noteWriteProof: 'proof-' + ENCOUNTER, noteWriteProofExpiresAt: Date.now() + 600000, context: clone(CONTEXT) }
      : { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        saved: true, persisted: true, serverVerified: true, reason: 'exact-note-editor-persisted',
        results: [{ key, attempted: true, written: true, verified: true, saved: true, persisted: true, serverVerified: true }],
        noteWriteProof: 'proof-' + ENCOUNTER, noteWriteProofExpiresAt: Date.now() + 600000, context: clone(CONTEXT) };
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId, action(m));
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
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });
  return {
    window, el: dom.resolve, posted, cardHtml: dom.cardHtml,
    selectRow: dom.selectRow, uncheckAllBut: dom.uncheckAllBut,
    wf: window.__mlsWriteFlow,
    receipts: () => window.__mlsWriteFlow.diagnostics.state().receipts
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }

/* ==== 3. RUNTIME: THE LONE SAVE PRESS ARMS IN ALL FOUR REVIEW SHAPES ======= */
(async function run() {
  /* A named or op-note review: write every section first, so the save is the
     only thing the sheet still owes - which is the press that stopped arming. */
  async function landSectionsThenRead(h, sections, id) {
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(sections), expectedContext: BOUND, receiptSessionId: id });
    await settle(200);
    h.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    return h.el('mlsAthenaUnifiedGo');
  }

  /* --- named, native-capable ------------------------------------------- */
  {
    const h = makeHarness({});
    const go = await landSectionsThenRead(h, NAMED_SECTIONS, 'arm-named');
    const label = extensionLabel(go);
    ok(SAVE_DRAFT_112.test(label), 'the named save press does not arm MLS Assist 3.0.112: ' + label);
    ok(SAVE_DRAFT_115.test(label), 'the named save press does not arm MLS Assist 3.0.115: ' + label);
    const rec = h.receipts()['save-named-sections'];
    ok(rec && rec.status === 'verified', 'the named save did not land, so this case measured the wrong state');
  }

  /* --- named, LEGACY encounter: the same manifest, the other extension leg.
     The app cannot see which editor athenaOne rendered, so the phrase has to
     arm on both. --------------------------------------------------------- */
  {
    const h = makeHarness({ persist: false });
    const go = await landSectionsThenRead(h, NAMED_SECTIONS, 'arm-legacy');
    const label = extensionLabel(go);
    ok(SAVE_DRAFT_112.test(label), 'the legacy-named save press does not arm MLS Assist 3.0.112: ' + label);
    ok(SAVE_DRAFT_115.test(label), 'the legacy-named save press does not arm MLS Assist 3.0.115: ' + label);
    const rec = h.receipts()['save-named-sections'];
    ok(rec && rec.status === 'verified', 'the legacy-named save did not land, so this case measured the wrong state');
  }

  /* --- op note: never native, so its press is always the Save click ----- */
  {
    const h = makeHarness({ persist: false });
    const go = await landSectionsThenRead(h, OP_SECTION, 'arm-opnote');
    const label = extensionLabel(go);
    ok(SAVE_DRAFT_112.test(label), 'the op-note save press does not arm MLS Assist 3.0.112: ' + label);
    ok(SAVE_DRAFT_115.test(label), 'the op-note save press does not arm MLS Assist 3.0.115: ' + label);
    eq(/verify/i.test(String(go.getAttribute('aria-label') || '')), false,
      'the op-note save press advertises a verify leg its sections cannot take: ' + go.getAttribute('aria-label'));
  }

  /* --- generic: no named destinations, so the doctor selects Save draft - */
  {
    const h = makeHarness({ persist: false });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(GENERIC_NOTE), expectedContext: BOUND, receiptSessionId: 'arm-generic' });
    await settle(200);
    ok(h.selectRow('save-draft'), 'the generic review offers no Save draft radio to select');
    await settle(900);
    const go = h.el('mlsAthenaUnifiedGo');
    const label = extensionLabel(go);
    ok(SAVE_DRAFT_112.test(label), 'the generic save press does not arm MLS Assist 3.0.112: ' + label);
    ok(SAVE_DRAFT_115.test(label), 'the generic save press does not arm MLS Assist 3.0.115: ' + label);
    eq(/verify/i.test(label), false, 'the generic save press advertises a verify leg it does not have: ' + label);
    go.click();
    await settle(3000);
    const rec = h.receipts()['save-draft'];
    ok(rec && rec.status === 'verified', 'the generic Save draft press minted no verified receipt');
  }

  /* --- generic, in the order a doctor actually works: write the note FIRST,
     then select Save draft. savetruth-1.3.0 renamed the button for exactly
     this moment - it read "Nothing left to send" while armed - so the rename
     has to be run back through both extensions' matchers or it could break
     arming the same way SAVENAMED_BOTH_LABEL did. ------------------------- */
  {
    const h = makeHarness({ persist: false });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(GENERIC_NOTE), expectedContext: BOUND, receiptSessionId: 'arm-generic-after' });
    await settle(200);
    h.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    ok(h.receipts()['write-note'] && h.receipts()['write-note'].status === 'verified',
      'the generic note did not land, so this case measures the wrong state');
    ok(h.selectRow('save-draft'), 'the generic review offers no Save draft radio to select');
    await settle(1200);
    const go = h.el('mlsAthenaUnifiedGo');
    const label = extensionLabel(go);
    eq(/Nothing left to send/.test(String(go.textContent)), false,
      'the armed save press is still labelled "Nothing left to send": ' + go.textContent);
    ok(SAVE_DRAFT_112.test(label), 'the generic save press after a write does not arm MLS Assist 3.0.112: ' + label);
    ok(SAVE_DRAFT_115.test(label), 'the generic save press after a write does not arm MLS Assist 3.0.115: ' + label);
    eq(/verify/i.test(label), false, 'the generic save press advertises a verify leg it does not have: ' + label);
    go.click();
    await settle(3000);
    const rec = h.receipts()['save-draft'];
    ok(rec && rec.status === 'verified', 'the relabelled generic Save press minted no verified receipt');
  }

  /* ==== 4. THE PROSE STAYS OFF THE ARMING PHRASE ========================= */
  {
    const h = makeHarness({});
    const m = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(NAMED_SECTIONS), expectedContext: BOUND, receiptSessionId: 'arm-prose' });
    await settle(200);
    const save = m.rows.filter(r => r.action === 'save_draft')[0];
    ok(save, 'the named review no longer mints a save row');
    /* the both-outcomes explanation is on the ROW, where it belongs */
    ok(/only reads the saved note back/.test(String(save.consequence)) &&
      /presses this encounter's Save control once/.test(String(save.consequence)),
      'the row stopped carrying the both-outcomes explanation: ' + save.consequence);
    /* ...and the sheet's own guide says it too */
    ok(h.cardHtml().indexOf('presses this encounter&rsquo;s Save once first if Athena has not already saved it') > 0,
      'the sheet guide stopped stating both outcomes of the final press');
  }

  console.log('PASS save-press-truth-proof: ' + checks + ' checks - the save press arms MLS Assist 3.0.112 AND 3.0.115 in all four review shapes (named, legacy-named, op note, generic), the arming phrase leads the aria-label and matches both extensions\' own matchers read from disk, the both-outcomes explanation lives on the row and in the guide instead, and the phrase that broke arming fails both matchers');
})().catch(err => { console.error(err && err.message ? err.message : err); process.exit(1); });
