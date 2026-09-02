'use strict';

/* sheetclar-1.0.0 — the owner's three MEASURED complaints about the unified
 * Athena write sheet, 2026-08-31 (the sheet WORKS; write_note was proven live
 * that night; it was hard to USE), turned into pins.
 *
 *   1. ARRIVAL. The one READY section's "Send this section" box arrived
 *      UNCHECKED, so the big Confirm & Send sat grayed carrying "Check at
 *      least one READY note section first". On a sheet with exactly one
 *      section that is a pointless extra step and reads like a malfunction.
 *      The markup always said `checked` — but a markup `checked` is only the
 *      DEFAULT value, and a browser is free to hand back restored form state
 *      instead. The cure is to decide it from the MANIFEST, as a PROPERTY,
 *      after the control exists. Section 1 proves that with a shim that
 *      deliberately IGNORES the markup attribute.
 *
 *   2. OVERLAP. document.elementFromPoint at the Confirm button's own centre
 *      returned #mlsAthenaUnifiedFix, so physical clicks on Confirm & Send did
 *      nothing. The card was ONE scrolling box whose last child was a
 *      position:sticky footer — a sticky box shares its coordinate space with
 *      everything scrolling beneath it, so the hit test comes down to stacking.
 *      The card is now a COLUMN FLEX container with exactly two children: a
 *      scrolling body and a static footer. Section 2 proves the geometry from
 *      the rendered markup: two in-flow siblings of a column flex container
 *      cannot occupy the same pixels, whatever the stacking, so nothing inside
 *      the body can be painted over Confirm & Send.
 *
 *   3. LANGUAGE. Every fact stays; the shape changes. One big state word
 *      (CHECKING / READY / SENDING / NEEDS ONE STEP / CAN'T SEND / PARTLY DONE
 *      / DONE) plus one short sentence, with the full honest sentence one
 *      disclosure below — and a REFUSAL opens that disclosure itself, so no
 *      refusal is ever folded away. #mlsAthenaUnifiedProbe keeps byte-for-byte
 *      the textContent it always had, which is what every refusal pin reads.
 *
 * AND THE HARD RULE THIS SUITE EXISTS TO ENFORCE: none of that may touch the
 * write. Section 0 proves the identity-lock, probe ladder, receipt mint,
 * execute, batch queue and BOTH closed action allowlists are byte-identical to
 * base b1144 (4b4ffacb) — not "equivalent", identical, by SHA-256.
 *
 * Deliberately NOT registered in scripts/run-all.js (staging lane).
 * Run:  node tests/sheet-clarity.test.js
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW = fs.readFileSync(path.join(ROOT, '1p-feat_mls_writeflow.js'), 'utf8');

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-cl', patientId: 'syn-cl', name: 'Synthetic Patient Clarity', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-cl', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const ONE = [{ key: 'hpi', text: 'Synthetic HPI body for the sheet-clarity suite.' }];
const THREE = [
  { key: 'hpi', text: 'Synthetic HPI body for the sheet-clarity suite.' },
  { key: 'ros', text: 'Synthetic ROS body for the sheet-clarity suite.' },
  { key: 'exam', text: 'Synthetic exam body for the sheet-clarity suite.' }
];
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ================================================================== 0. BYTES
 * The write path, pinned by SHA-256 against base b1144 (4b4ffacb). These are
 * the regions a UX pass may never edit: the identity lock that mints the
 * one-use token, the read-only probe ladder, the receipt mint, the execute,
 * the batch queue, and both CLOSED action allowlists. Recompute deliberately
 * and only alongside a reviewed change to the write itself. */
const HEAD_REGIONS = [
  ['identity-lock (validatedUnifiedProbe: token + name/DOB/MRN + exact encounter)',
    '  function validatedUnifiedProbe(patient, probe) {', '  function renderUnifiedContext(state, lock) {',
    '5132fb2c3047b18f75647b0dea7df7ce21c2d5a89325cfaa77e82e193d3533a1'],
  /* MOVED DELIBERATELY, wfgen-1.0.0 (2026-09-01): the read-only ladder's
     paced re-probes stopped being bare timers (a hidden tab buckets those to
     one minute, and the MLS tab IS hidden while the extension fronts
     athenaOne for the check). Only the WAIT changed - every refusal, the
     auto-open, the day-mismatch gate and the identity lock are byte-identical,
     which is why the other six regions below did not move. Proven in
     tests/write-generality-proof.js. */
  ['probe ladder (probeUnifiedRow: every refusal, auto-open, day-mismatch gate)',
    '  function probeUnifiedRow(state, rowId) {', '  /* wfsum-1.0.0 (owner 2026-08-26, watching his own writes land while the sheet',
    'b969672ecd13d4afd4c8f4e86e12cbc6a0799e32ffdee30744a4c68a1f8c2005'],
  ['receipt mint (resultToUnifiedReceipt: verified / uncertain / halt)',
    '  function resultToUnifiedReceipt(state, row, resp, probe) {', '  /* ===== wfprog-1.0.0 (owner 2026-08-27:',
    '82451a857daa88c986222abdca94ea4bdf504207cf11a6ac894bc25a52824de9'],
  ['execute (executeUnifiedSelection: the only code that writes)',
    '  function executeUnifiedSelection(state) {', '  /* bx-1.0.0 - batch send (owner 2026-08-26:',
    '13d1a666cb827dfa7561a4daeb394bdba7a990f4d4e322fcdc08317a438b80b5'],
  /* MOVED DELIBERATELY, wfnext-1.0.0 (2026-09-01) - owner ruling 23:05,
     verbatim: "nothing here should be blocked or manual or not attempted once
     its run". MEASURED 22:50-22:56 on his own tab: one trusted press, six
     checked sections, section 1 verified, sections 2 and 3 refused with
     fresh-trusted-click-required (MLS Assist consumes the arm on the first
     execute), section 4 then sat on "checking Athena" past three minutes. TWO
     things changed in this region and nothing else: the queue is handed the
     rows THIS PRESS AUTHORIZED (wfnextQueueRows - the whole remaining list on a
     batch-arm extension, exactly one section on any older one, which is also
     what stops a section being probed before the doctor has pressed for it),
     and the read-only stage retries ONCE inside the same run before settling
     the section in words that name his next move. Every gate, latch, bound,
     token, payload and receipt path in it is untouched: same probeUnifiedRow,
     same executeUnifiedSelection, same 150s / 180s ceilings, same
     halt-on-uncertain, same verified-only counting. Regions 1-4, 6 and 7 did
     not move, which is the check that this was a sequencing change and not a
     write-path change. Proven in tests/write-next-press-proof.js. */
  ['batch queue (runUnifiedBatchSend: per-row probe/execute/receipt sequencing)',
    '  function runUnifiedBatchSend(state, btn) {', '  function reopenOptions(opts, manifest) {',
    '44e41349ee1d1009cb29f74f1a484a9b70e9c6fc8f29a56017c74c207b98a0ab'],
  ['closed allowlist ATHENA_EXECUTABLE_ACTIONS', '  var ATHENA_EXECUTABLE_ACTIONS = ', '\n',
    '5f712227078089f313988b254825795ed695d22fa6393e5a3c635d92ebcbb6f2'],
  ['closed allowlist OPBATCH_ACTIONS', '  var OPBATCH_ACTIONS = ', '\n',
    '35da13388ee65c349a310314a6b74ba28a492c98ca44e3e4a258c829302d89fa']
];
{
  HEAD_REGIONS.forEach(function (r) {
    const name = r[0], start = r[1], end = r[2], want = r[3];
    const i = FLOW.indexOf(start);
    ok(i >= 0, 'the write-path region vanished entirely: ' + name);
    const j = FLOW.indexOf(end, i + start.length);
    ok(j > i, 'the write-path region lost its end marker: ' + name);
    const got = crypto.createHash('sha256').update(FLOW.slice(i, j), 'utf8').digest('hex');
    eq(got, want, 'THE WRITE PATH CHANGED — this is a UI/wording lane and may not touch it: ' + name);
  });
  /* and the allowlists say what they say */
  ok(FLOW.indexOf('var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };') > 0,
    'the executable-action allowlist was rewritten');
  ok(FLOW.indexOf('var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };') > 0,
    'the batch lane\'s CLOSED two-action allowlist was rewritten');
  /* the zero-checked refusal keeps its exact shipped sentence (sheetux-1.0.0) */
  ok(FLOW.indexOf("var SHEETUX_ZERO_REASON = 'Check at least one READY note section first - this button sends only the sections you have checked. Nothing was changed.';") > 0,
    'the zero-checked refusal changed its wording out from under the sheet-ux suite');
}

/* ------------------------------------------------------------------ DOM shim
 * The sheet-ux harness shape, with the two things this suite must not fake:
 *   - a checkbox's `checked` comes from the RENDERED MARKUP, not a constant;
 *     with options.ignoreMarkupChecked it starts false whatever the markup
 *     said, which is exactly what a browser restoring form state does;
 *   - the card's markup is parsed into a real nesting tree so the layout can
 *     be reasoned about instead of asserted by string. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsAthenaUnifiedCopySection'];

function makeDom(options) {
  options = options || {};
  const byId = new Map();
  const live = new Map();
  let card = null;

  function checkbox(rowId, tail) {
    const markupChecked = /(^|\s)checked(\s|$|>)/.test(String(tail || ''));
    const el = {
      tagName: 'INPUT', type: 'checkbox', markupChecked: markupChecked,
      checked: options.ignoreMarkupChecked ? false : markupChecked,
      id: '', style: {}, children: [],
      attrs: { 'data-mls-bx-row': rowId, class: 'mls-bx-check' }, handlers: {},
      setAttribute(k, v) { el.attrs[k] = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(t, fn) { (el.handlers[t] = el.handlers[t] || []).push(fn); },
      removeEventListener() {}, focus() {}, click() {},
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
      fire(t) { (el.handlers[t] || []).forEach(fn => fn({ target: el })); }
    };
    return el;
  }
  function boxesOf(el) {
    if (options.noCheckboxes) return [];
    if (el._bx) return el._bx;
    const out = [];
    const re = /class="mls-bx-check" data-mls-bx-row="([^"]+)"([^>]*)>/g;
    let m;
    while ((m = re.exec(String(el.innerHTML || '')))) out.push(checkbox(m[1], m[2]));
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
      isConnected: true, className: '', parentNode: null, _bx: null, open: false,
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
  return { document, resolve, boxes: () => (card ? boxesOf(card) : []), cardHtml: () => (card ? card.innerHTML : '') };
}

function makeHarness(options) {
  options = options || {};
  const dom = makeDom(options);
  const listeners = [];
  const posted = [];
  const store = new Map();
  if (!options.unbound) {
    store.set('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {
      ['appointment-id:' + APPOINTMENT]: { state: 'done', patientId: PATIENT.patientId, backendAppointmentId: CAL_ROW.id, appt_date: DAY }
    } }));
  }
  const localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k)
  };
  const window = {
    document: dom.document, localStorage,
    _calAppts: options.unbound ? [] : [clone(CAL_ROW)],
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
  const CONTEXT = {
    patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, appointmentId: APPOINTMENT,
    encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL, visitDate: ATHENA_DAY, provider: PROVIDER,
    control: 'HPI editor', framePath: '0', encounterRootFingerprint: 'er', controlFingerprint: 'c',
    noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h'
  };
  function defaultAction(m) {
    if (m.mode === 'execute') {
      return { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        noteWriteProof: 'proof-' + ENCOUNTER, noteWriteProofExpiresAt: Date.now() + 600000, context: clone(CONTEXT) };
    }
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
      rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(CONTEXT) };
  }
  function deliverRaw(message) {
    Promise.resolve().then(() => listeners.slice().forEach(fn => fn({ data: message })));
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId, options.onAction ? options.onAction(m, defaultAction) : defaultAction(m));
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, options.onOpen ? options.onOpen(m) : { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, options.onGoto ? options.onGoto(m) : { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    /* wfnext-1.0.0 (2026-09-01): the shim answers mlsPing the way the extension
       really does - a TOP-LEVEL mlsPong with no resp wrapper - so the sheet can
       feature-detect batchArm. MLS Assist 3.0.108+ mints a batch authorization
       from ONE trusted click, which is the lane on which one press still writes
       every checked section; the one-press-per-section lane an older extension
       gets is proved in tests/write-next-press-proof.js. */
    if (m.type === 'mlsPing') return deliverRaw({ source: 'mls-ext', type: 'mlsPong', requestId: m.requestId, version: '3.0.108', buildId: '3.0.108', batchArm: '1.0.0', capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true, batchArmV1: true } });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.62', versionName: '3.0.62+core-sha256:abc', athena: { tabs: 3, discarded: 1 } });
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => { const m = Number(ms || 0); if (m <= 2000 || m === 12000 || m === 15000) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: '1p-feat_mls_writeflow.js' });
  return {
    window, document: dom.document, el: dom.resolve, boxes: dom.boxes, cardHtml: dom.cardHtml, posted, options,
    wf: window.__mlsWriteFlow,
    stateWord: () => dom.resolve('mlsAthenaUnifiedState').getAttribute('data-mls-sheet-state'),
    stateHtml: () => String(dom.resolve('mlsAthenaUnifiedState').innerHTML || ''),
    statusText: () => String(dom.resolve('mlsAthenaUnifiedProbe').textContent || ''),
    detailsOpen: () => dom.resolve('mlsAthenaUnifiedDetails').open === true,
    progressHtml: () => String(dom.resolve('mlsAthenaUnifiedProgress').innerHTML || ''),
    actions: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2'),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    probes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe')
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }

/* --------------------------------------------------------- markup tree ----
 * A nesting tree of the rendered card, so section 2 can argue about BOXES
 * instead of substrings. esc() escapes '<', so no clinical text can inject a
 * tag; the only tags in here are the ones the renderer wrote. */
const VOID_TAGS = { input: 1, br: 1, img: 1, hr: 1, meta: 1, link: 1, source: 1, col: 1, area: 1 };
function parseTree(html) {
  const root = { tag: 'root', id: '', style: '', children: [], parent: null };
  let cur = root;
  const re = /<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[2].toLowerCase(), attrs = m[3] || '';
    if (m[1] === '/') {
      let n = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (n && n.parent) cur = n.parent;
      continue;
    }
    const idM = /\sid="([^"]*)"/.exec(attrs);
    const styleM = /\sstyle="([^"]*)"/.exec(attrs);
    const el = { tag: tag, id: idM ? idM[1] : '', style: styleM ? styleM[1] : '', attrs: attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!VOID_TAGS[tag] && !/\/$/.test(attrs.trim())) cur = el;
  }
  return root;
}
function findById(node, id) {
  if (node.id === id) return node;
  for (let i = 0; i < node.children.length; i++) {
    const hit = findById(node.children[i], id);
    if (hit) return hit;
  }
  return null;
}
function chain(node) {
  const out = [];
  for (let n = node; n; n = n.parent) out.push(n.id || n.tag);
  return out;
}
function walk(node, fn) { fn(node); node.children.forEach(c => walk(c, fn)); }

(async function run() {

  /* ============ 1. THE SINGLE READY SECTION ARRIVES SELECTED ============== */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'clar-one' });
    const readyNotes = manifest.rows.filter(r => r.capability === 'ready' && r.action === 'write_note');
    eq(readyNotes.length, 1, 'the fixture did not build exactly one READY note section');
    eq(h.boxes().length, 1, 'the one-section sheet rendered a different number of include checkboxes');
    ok(h.boxes()[0].markupChecked, 'the shipped markup no longer carries the checked default');
    eq(h.boxes()[0].checked, true, 'THE ONE READY SECTION ARRIVED UNCHECKED - the measured defect');
    /* nothing has been sent merely by arriving selected */
    eq(h.executes().length, 0, 'the sheet sent something on open');

    await settle(200);
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, false, 'the one READY section did not enable Confirm after its read-only check verified');
    eq(go.getAttribute('data-mls-athena-action'), 'write_note', 'Confirm is enabled without the probe-bound action attribute');
    eq(h.stateWord(), 'READY', 'a verified sheet does not say READY: ' + h.stateWord());
    eq(h.executes().length, 0, 'a default-checked section auto-sent itself - Confirm must stay a human click');

    /* and the human click is what sends */
    go.click();
    await settle(600);
    eq(h.executes().length, 1, 'the human Confirm click did not issue exactly one execute');
  }
  {
    /* THE MEASURED CAUSE, isolated: a control whose state did NOT come from the
       markup (a browser restoring form state across a reload does exactly this)
       must still arrive selected, because the property is set from the manifest
       after render. Without that cure this fixture reproduces the owner's sheet:
       an unchecked box and a grayed Confirm carrying the check-a-box refusal. */
    const h = makeHarness({ ignoreMarkupChecked: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'clar-restored' });
    eq(h.boxes()[0].markupChecked, true, 'the markup default disappeared');
    eq(h.boxes()[0].checked, true,
      'a restored/unchecked control was left unchecked - the arrival default must be set as a PROPERTY from the manifest, not left to the markup');
    await settle(200);
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, false, 'the restored-state sheet left Confirm grayed');
    eq(go.getAttribute('data-mls-primary-blocked'), null,
      'the restored-state sheet still tells the doctor to check a box that is already checked');
    eq(h.executes().length, 0, 'the restored-state sheet sent something without a click');
  }
  {
    /* NOT enabled without a validated probe: a refused check leaves no action
       binding, no READY word, and a press writes nothing. */
    const h = makeHarness({
      onAction: (m, dflt) => (m.mode === 'probe' ? { ok: false, blocked: true, reason: 'patient-mismatch' } : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'clar-refused' });
    await settle(400);
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.getAttribute('data-mls-athena-action'), null, 'a refused check left the Confirm action binding in place');
    eq(h.wf.diagnostics.sheetClarity.readyRow(), null, 'a refused check still counts as a validated probe');
    ok(h.stateWord() !== 'READY', 'a refused check painted READY anyway: ' + h.stateWord());
    h.wf.diagnostics.sheetUx.press(go);
    await settle(600);
    eq(h.executes().length, 0, 'pressing Confirm after a refused check reached Athena');
  }
  {
    /* every READY note section on a multi-section sheet arrives ON, and the
       primary reviewed section is one of them. bx-1.0.0 law is intact: Save,
       Sign, billing and orders never get an include control at all. */
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'clar-three' });
    eq(h.boxes().length, 3, 'the three-section sheet did not render one include checkbox per READY note row');
    ok(h.boxes().every(b => b.checked === true), 'a READY note section arrived unselected on a multi-section sheet');
    const boxRows = h.boxes().map(b => b.getAttribute('data-mls-bx-row'));
    boxRows.forEach(id => {
      const row = manifest.rows.filter(r => r.id === id)[0];
      ok(row && row.action === 'write_note' && row.capability === 'ready',
        'an include checkbox was rendered for something other than a READY note write: ' + id);
    });
    manifest.rows.forEach(row => {
      if (row.action === 'write_note') return;
      eq(boxRows.indexOf(row.id), -1, 'a non-note row was given an include checkbox: ' + row.id + ' / ' + row.action);
    });
    eq(h.executes().length, 0, 'three default-checked sections auto-sent themselves');
  }

  /* ======== 2. NOTHING CAN BE PAINTED OVER CONFIRM & SEND (GEOMETRY) ====== */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'clar-layout' });
    await settle(200);
    const tree = parseTree(h.cardHtml());
    const body = findById(tree, 'mlsAthenaUnifiedBody');
    const footer = findById(tree, 'mlsAthenaUnifiedFooter');
    const go = findById(tree, 'mlsAthenaUnifiedGo');
    const cancel = findById(tree, 'mlsAthenaUnifiedCancel');
    const fix = findById(tree, 'mlsAthenaUnifiedFix');
    ok(body, 'the card has no scrolling body element');
    ok(footer, 'the card has no footer element');
    ok(go, 'the rendered card has no Confirm & Send button');
    ok(fix, 'the rendered card has no fix strip - the element that was measured on top of Confirm');

    /* (a) body and footer are SIBLINGS, and the only two, of the card root */
    ok(body.parent === tree, 'the scrolling body is not a direct child of the card');
    ok(footer.parent === tree, 'the footer is not a direct child of the card');
    eq(tree.children.length, 2, 'the card has children other than the scrolling body and the footer');
    ok(tree.children.indexOf(body) < tree.children.indexOf(footer), 'the footer is rendered before the body it must sit under');

    /* (b) the card lays them out as a COLUMN FLEX - two in-flow siblings of a
           column flex container cannot occupy the same pixels, so no box inside
           the body can intersect the Confirm button's box, whatever the paint
           order or stacking context. THAT is the cure for elementFromPoint
           returning the fix strip at the Confirm button's centre. */
    const cardStyleAt = FLOW.indexOf("card.style.cssText = 'background:#fff;color:#1A211C;width:min(720px,96vw);max-height:92vh;");
    ok(cardStyleAt > 0, 'the card style declaration moved - the layout proof cannot find it');
    const cardStyle = FLOW.slice(cardStyleAt, FLOW.indexOf("';", cardStyleAt));
    ok(/display:flex/.test(cardStyle) && /flex-direction:column/.test(cardStyle),
      'the card is no longer a column flex container: ' + cardStyle);
    ok(/overflow:hidden/.test(cardStyle), 'the card scrolls as a whole again, which re-creates the sticky-footer overlap');

    /* (c) the body scrolls; the footer does not, and is not positioned */
    ok(/overflow:auto/.test(body.style), 'the scrolling body does not scroll: ' + body.style);
    ok(/min-height:0/.test(body.style), 'the scrolling body has no min-height:0, so it cannot shrink and the footer gets pushed off');
    ok(/flex:1/.test(body.style), 'the scrolling body is not the flexible child');
    ok(/position:static/.test(footer.style), 'the footer stopped declaring itself unpositioned: ' + footer.style);
    ok(!/position:\s*(sticky|absolute|fixed)/.test(footer.style), 'THE FOOTER IS A POSITIONED BOX AGAIN - it can be overlaid: ' + footer.style);
    ok(/flex:0 0 auto/.test(footer.style), 'the footer can be squeezed or grown by its content: ' + footer.style);
    ok(!/margin-top:-/.test(footer.style) && !/margin:-/.test(footer.style), 'the footer pulls itself up over the body with a negative margin');

    /* (d) Confirm & Cancel live in the footer; the fix strip lives in the body */
    ok(chain(go).indexOf('mlsAthenaUnifiedFooter') >= 0, 'Confirm & Send is not inside the footer: ' + chain(go).join(' < '));
    ok(chain(go).indexOf('mlsAthenaUnifiedBody') < 0, 'Confirm & Send is inside the scrolling body');
    ok(chain(cancel).indexOf('mlsAthenaUnifiedFooter') >= 0, 'Cancel is not in the same stable footer row as Confirm');
    ok(chain(fix).indexOf('mlsAthenaUnifiedBody') >= 0, 'the fix strip is not inside the scrolling body: ' + chain(fix).join(' < '));
    ok(chain(fix).indexOf('mlsAthenaUnifiedFooter') < 0, 'THE FIX STRIP IS IN THE FOOTER - the measured overlap, rebuilt');
    ok(/position:static/.test(fix.style), 'the fix strip stopped declaring itself unpositioned: ' + fix.style);

    /* (e) and NOTHING inside the scrolling body is a positioned box that could
           escape it and share the footer's pixels. */
    const positioned = [];
    walk(body, n => { if (/position:\s*(fixed|absolute|sticky)/.test(n.style)) positioned.push((n.id || n.tag) + ' {' + n.style + '}'); });
    eq(positioned.length, 0, 'a positioned box inside the scrolling body can be painted over the footer: ' + positioned.join(' | '));

    /* (f) the fix strip's own buttons are appended into that same in-flow host,
           so a refusal cannot move them either. */
    const refuse = makeHarness({
      onAction: (m, dflt) => (m.mode === 'probe' ? { ok: false, blocked: true, reason: 'note-editor-not-empty' } : dflt(m))
    });
    refuse.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'clar-layout-fix' });
    await settle(400);
    const fixHost = refuse.el('mlsAthenaUnifiedFix');
    ok(String(fixHost.innerHTML || '').length > 0 || fixHost.children.length > 0,
      'the refusal painted no fix strip at all, so this fixture proves nothing');
    const refuseTree = parseTree(refuse.cardHtml());
    ok(chain(findById(refuseTree, 'mlsAthenaUnifiedFix')).indexOf('mlsAthenaUnifiedBody') >= 0,
      'after a refusal the fix strip host is no longer inside the scrolling body');
  }

  /* ===== 2b. THE SHELL MAY NOT BUILD A SECOND FOOTER EITHER ==============
   * THE ROOT CAUSE, found in the shells rather than the module: the shell's
   * clunky-athena-1.0.0 overlay stamped data-mls-clunky-why="1" onto BOTH
   * #mlsAthenaUnifiedProbe and #mlsAthenaUnifiedFix whenever Confirm was
   * disabled, and its CSS made that a second sticky footer -
   * `position:sticky; bottom:0; z-index:6` - inside the same scrollport as the
   * sheet's own footer at z-index:3. Two boxes pinned to the same edge; the
   * higher z-index wins the hit test. That is precisely why elementFromPoint at
   * the Confirm button's centre returned the fix strip.
   * The module's flex-column card already makes the overlap impossible, but a
   * competing sticky in the shell is the same defect waiting to be rebuilt, so
   * it is pinned in every shell that ships this sheet. */
  {
    const SHELLS = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
    SHELLS.forEach(function (name) {
      const p = path.join(ROOT, name);
      if (!fs.existsSync(p)) return;
      const shell = fs.readFileSync(p, 'utf8');
      const at = shell.indexOf('#mlsAthenaUnifiedConfirm [data-mls-clunky-why="1"]{');
      ok(at > 0, name + ' no longer carries the clunky-athena reason rule this pin protects');
      const rule = shell.slice(at, shell.indexOf('}', at));
      ok(!/position:\s*(sticky|fixed|absolute)/.test(rule),
        name + ' REBUILT THE SECOND STICKY FOOTER over Confirm & Send: ' + rule.replace(/\s+/g, ' '));
      ok(!/bottom:\s*0/.test(rule), name + ' pins the sheet status line to the bottom edge again: ' + rule.replace(/\s+/g, ' '));
      ok(/position:\s*static/.test(rule), name + ' stopped declaring the reason block unpositioned');
      /* and no other rule in that stylesheet pins a sheet surface to bottom:0 */
      const cssAt = shell.indexOf('<style id="mlsClunkyAthenaCss">');
      if (cssAt > 0) {
        /* declarations only - the comment above the cured rule names the defect
           it cured, and quoting the old declaration must not trip its own pin. */
        const css = shell.slice(cssAt, shell.indexOf('</style>', cssAt)).replace(/\/\*[\s\S]*?\*\//g, '');
        ok(css.indexOf('bottom:0') < 0, name + ' has another clunky rule pinned to the bottom edge of the sheet');
        ok(css.indexOf('position:sticky') < 0, name + ' has another clunky rule making a sheet surface sticky');
      }
    });
    /* the module's own disclosure opts out of the shell's fold-closing pass,
       so a refusal cannot be folded shut by the overlay a beat later. */
    ok(FLOW.indexOf('<details id="mlsAthenaUnifiedDetails" data-mls-clunky-seen="1"') > 0,
      'the full-detail disclosure lost its opt-out from the shell fold pass, so a refusal can be closed under the doctor');
  }

  /* ================= 3. THE LANGUAGE: SCANNABLE, STILL HONEST ============= */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'clar-words' });
    await settle(200);
    /* the big state word, and one short sentence under it */
    eq(h.stateWord(), 'READY', 'the verified sheet does not lead with READY');
    ok(/data-mls-state-word="1"[^>]*font-size:19px/.test(h.stateHtml()), 'the state word is not rendered big: ' + h.stateHtml());
    ok(/data-mls-state-short="1"/.test(h.stateHtml()), 'the state line carries no short sentence');
    const short = (/data-mls-state-short="1"[^>]*>([^<]*)</.exec(h.stateHtml()) || [])[1] || '';
    /* esc() renders the ampersand as &amp; - the short line is HTML, not text */
    ok(/One click on Confirm &amp; Send runs only Write reviewed HPI\./.test(short),
      'the READY sentence no longer names the one thing the click does: ' + short);
    ok(/no save, no signature, no billing, no orders/.test(short),
      'the READY sentence dropped the scope honesty: ' + short);

    /* EVERY honest fact survives, verbatim, one disclosure below */
    ok(h.statusText().indexOf('Ready — the exact chart is verified. One click on Confirm & Send runs only Write reviewed HPI. Nothing else.') === 0,
      'the full honest sentence was trimmed instead of moved: ' + h.statusText());
    eq(h.detailsOpen(), false, 'a normal state leaves its full-detail disclosure open, which is the density the owner asked to lose');

    /* DONE says what the doctor must now do himself, in the big line */
    h.el('mlsAthenaUnifiedGo').click();
    await settle(900);
    eq(h.executes().length, 1, 'the words fixture did not reach one execute');
    eq(h.stateWord(), 'DONE', 'a verified write does not say DONE: ' + h.stateWord());
    const doneShort = (/data-mls-state-short="1"[^>]*>([^<]*)</.exec(h.stateHtml()) || [])[1] || '';
    ok(/Save, then Sign/.test(doneShort), 'the DONE line does not name Save then Sign as THE next manual step: ' + doneShort);
    ok(/MLS never saves and never signs/.test(doneShort), 'the DONE line dropped the never-saves-never-signs honesty: ' + doneShort);
    ok(/read back successfully/.test(h.statusText()), 'the receipt sentence was lost from the full detail: ' + h.statusText());
  }
  {
    /* A REFUSAL KEEPS ITS FULL HONEST TEXT AND IS NEVER FOLDED AWAY */
    const h = makeHarness({
      onAction: (m, dflt) => (m.mode === 'probe' ? { ok: false, blocked: true, reason: 'note-editor-not-empty' } : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'clar-refusal-words' });
    await settle(400);
    eq(h.stateWord(), 'NEEDS ONE STEP', 'a one-step refusal is not summarised as one step: ' + h.stateWord());
    eq(h.detailsOpen(), true, 'A REFUSAL WAS HIDDEN BEHIND A FOLD');
    ok(/^One step needed:/.test(h.statusText()), 'the refusal lost its own opening words: ' + h.statusText());
    ok(/never types over text/.test(h.statusText()), 'the refusal lost the reason MLS will not overwrite: ' + h.statusText());
    ok(/Nothing was changed and nothing was sent\./.test(h.statusText()), 'the refusal dropped the nothing-changed honesty: ' + h.statusText());
    eq(h.el('mlsAthenaUnifiedProbe').getAttribute('data-mls-status-kind'), 'fix', 'the recoverable refusal lost its amber severity');
  }
  {
    /* an identity conflict is not "one step" and must not be softened */
    const h = makeHarness({
      onAction: (m, dflt) => {
        const r = dflt(m);
        if (m.mode === 'probe') r.context = Object.assign({}, r.context, { dob: '11/11/1911' });
        return r;
      }
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'clar-identity' });
    await settle(300);
    eq(h.stateWord(), 'CAN’T SEND', 'an identity conflict was softened into a step: ' + h.stateWord());
    eq(h.detailsOpen(), true, 'an identity conflict was folded away');
    ok(/did not return a complete matching patient name, DOB, and MRN/.test(h.statusText()),
      'the identity refusal changed its words: ' + h.statusText());
    eq(h.executes().length, 0, 'an identity conflict reached an execute');
  }

  /* ====== 4. "CHECK A BOX" IS NEVER SAID WHERE THERE IS NO BOX =========== */
  {
    const h = makeHarness({ unbound: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: { visitDate: '', provider: '', appointmentId: '' },
      requireExpectedVisit: true, receiptSessionId: 'clar-noready' });
    await settle(120);
    eq(h.boxes().length, 0, 'the all-blocked fixture rendered an include checkbox after all');
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, true, 'a sheet with no READY section left Confirm live');
    const reason = go.getAttribute('data-mls-primary-blocked');
    eq(reason, h.wf.diagnostics.sheetClarity.noneReadyReason, 'the no-READY-section refusal is not the honest one');
    ok(!/Check at least one READY note section/.test(String(reason)),
      'the sheet still tells the doctor to tick a control that does not exist: ' + reason);
    ok(/Nothing was changed/.test(String(reason)), 'the honest no-READY refusal dropped the nothing-changed honesty: ' + reason);
    h.wf.diagnostics.sheetUx.press(go);
    await settle(120);
    eq(h.executes().length, 0, 'a sheet with no READY section still reached Athena');
  }
  {
    /* CONTROL: where the boxes DO exist, unchecking them keeps the exact
       shipped sheetux-1.0.0 sentence, byte for byte. */
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'clar-zero' });
    await settle(200);
    const boxes = h.boxes();
    boxes.forEach(b => { b.checked = false; });
    boxes[0].fire('change');
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, true, 'unchecking every section left the send button live');
    eq(go.getAttribute('data-mls-primary-blocked'), h.wf.diagnostics.sheetUx.zeroReason,
      'the zero-checked refusal changed where the checkboxes really exist');
    /* and the sheetux-1.1.0 re-arm still works */
    boxes[1].checked = true;
    boxes[1].fire('change');
    eq(go.disabled, false, 're-checking a section no longer re-arms the send button');
  }

  /* ===== 5. THE BATCH SEAM AND ITS LOADING SURFACE ARE INTACT ============ */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'clar-batch' });
    await settle(120);
    eq(h.progressHtml(), '', 'the progress surface painted before anything was sent');
    /* the op-note room drives this sheet through exactly this seam */
    ok(typeof h.wf.diagnostics.sheetUx.press === 'function', 'the batch lane lost the seam it presses');
    h.wf.diagnostics.sheetUx.press(h.el('mlsAthenaUnifiedGo'));
    await settle(2400);
    eq(h.executes().length, 3, 'the one press did not send all three checked sections');
    const state = h.wf.diagnostics.state();
    manifest.rows.filter(r => r.action === 'write_note').forEach(row => {
      const rec = state.receipts[row.id];
      ok(rec && rec.status === 'verified', 'batched section ' + row.id + ' has no verified receipt of its own');
      eq(rec.rowHash, row.rowHash, 'the receipt for ' + row.id + ' is not bound to that exact row');
    });
    /* wfprog: a BATCH owns the loading surface end to end. Before sheetclar-1.0.0
       the first section reaching READY looked like "nothing written yet" and
       wiped the whole queue's bar - 1p-writeflow-opnote-clarity-progress was
       RED at b1144 on exactly this. */
    const prog = h.progressHtml();
    ok(prog.indexOf('data-mls-prog-headline') > 0, 'the batch never painted a progress headline');
    ok(/data-mls-prog-pct="100"/.test(prog), 'a finished batch never filled its bar');
    eq(h.wf.diagnostics.progress.counts().pending, 0, 'a finished batch left sections pending');
    eq(h.stateWord(), 'DONE', 'a fully verified batch does not say DONE: ' + h.stateWord());
  }
  {
    /* the progress surface sits with the words it belongs to, not below the
       fold: state line -> progress -> the full-detail disclosure. */
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: 'clar-order' });
    await settle(120);
    const html = h.cardHtml();
    const at = id => html.indexOf('id="' + id + '"');
    ok(at('mlsAthenaUnifiedState') > 0 && at('mlsAthenaUnifiedProgress') > at('mlsAthenaUnifiedState'),
      'the progress surface is no longer rendered directly under the state line');
    ok(at('mlsAthenaUnifiedDetails') > at('mlsAthenaUnifiedProgress'),
      'the full-detail disclosure is rendered above the progress surface');
    ok(at('mlsAthenaUnifiedFix') > at('mlsAthenaUnifiedProgress'), 'the fix strip climbed above the progress surface');
    ok(at('mlsAthenaUnifiedFooter') > at('mlsAthenaUnifiedReceipt'), 'the footer is no longer the last thing in the card');
  }

  console.log('PASS sheet-clarity (sheetclar-1.0.0): ' + checks + ' checks - the write path is byte-identical to b1144 by SHA-256; the single READY section arrives CHECKED as a property set from the manifest (proven against a control whose markup state is ignored) and still sends nothing until a human click behind a validated probe; the card is a column flex with a scrolling body and a static footer, so nothing in the body - the fix strip included - can share pixels with Confirm & Send; the state word is big and derived from the same fact that enables Confirm, DONE names Save then Sign, and every refusal keeps its full honest text with its disclosure forced open; a sheet with no READY section stops telling the doctor to tick a box that does not exist while the real zero-checked refusal is unchanged; and the batch seam still sends every checked section with its own receipt, now behind a progress bar a batch no longer wipes');
})().catch(err => { console.error(err); process.exit(1); });
