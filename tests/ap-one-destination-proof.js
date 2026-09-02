'use strict';

/* apsel-1.0.0 - THE ASSESSMENT / PLAN PAIR IS ONE DESTINATION, NOT TWO.
 *
 * OWNER RULING, 2026-09-01, verbatim: "nothing here should be blocked or manual
 * or not attempted once its run."
 *
 * MEASURED 2026-09-02 09:xx, on the owner's own tab, MLS Assist 3.0.107.
 * ap-1.0.0 mints THREE Assessment/Plan rows on any review that holds exactly
 * one assessment and one plan section: the separate "Write reviewed Assessment
 * narrative", the separate "Write reviewed Plan / Follow-up", and the combined
 * "Write reviewed Assessment & Plan (combined)". An athenaOne A/P stage renders
 * EITHER one combined field OR separate ones - never both - and his renders the
 * one combined uta-ap-note editor. Two defects fell out of that:
 *
 *   (A) THE COUNT. sheetclarInAthena counted every write_note row as its own
 *       destination, so an A/P-bearing review had a total the writes could
 *       never reach. The state pill could not say DONE and the green
 *       "Everything on this review is in Athena" banner could not fire - on
 *       every practice, in both directions, even when the doctor unticked
 *       perfectly and every write he asked for landed. That is the ruling
 *       failing on the SENTENCE, with the write path behaving perfectly.
 *
 *   (B) THE ARRIVAL. All three rows arrived ticked, so his default press always
 *       attempted at least one destination that cannot exist on his surface.
 *
 * THE CURE. (A) the count collapses the group to the ONE destination this
 * surface has - it needs no preference and is correct on both shapes. (B)
 * exactly ONE side of the group arrives ticked: the combined row unless this
 * athenaOne has already answered that it renders separate fields. NOTHING IS
 * REMOVED - all three rows are still minted, still rendered, still one tick
 * away, and the un-ticked side carries one sentence saying it is the
 * alternative.
 *
 * WHAT THIS SUITE IS NOT. It is not a write proof. Section 0 pins that all
 * seven SHA-pinned write-path regions are byte-identical, so nothing here can
 * be mistaken for a change to what a write is. Every assertion below runs the
 * SHIPPED functions - the manifest builder, the arrival default, the count the
 * pill reads, and the receipt renderer - never a reimplementation of them.
 *
 * Run:  node tests/ap-one-destination-proof.js
 */

const assert = require('assert');
const crypto = require('crypto');
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

/* ================================================================== 0. BYTES
 * The seven SHA-pinned write-path regions, read exactly as
 * tests/sheet-rows-and-reopen-proof.js reads them: the digests are NOT
 * re-derived here, they must already be carried by BOTH
 * tests/sheet-clarity.test.js and tests/write-auto-chain.test.js. This lane
 * moved NONE of them - it changed which of two mutually exclusive destinations
 * arrives selected, and how many destinations the sheet counts. */
const SHEET_CLARITY = read('tests/sheet-clarity.test.js');
const AUTO_CHAIN = read('tests/write-auto-chain.test.js');
const HEAD_REGIONS = [
  ['identity-lock (validatedUnifiedProbe)',
    '  function validatedUnifiedProbe(patient, probe) {', '  function renderUnifiedContext(state, lock) {'],
  ['probe ladder (probeUnifiedRow)',
    '  function probeUnifiedRow(state, rowId) {', '  /* wfsum-1.0.0 (owner 2026-08-26, watching his own writes land while the sheet'],
  ['receipt mint (resultToUnifiedReceipt)',
    '  function resultToUnifiedReceipt(state, row, resp, probe) {', '  /* ===== wfprog-1.0.0 (owner 2026-08-27:'],
  ['execute (executeUnifiedSelection)',
    '  function executeUnifiedSelection(state) {', '  /* bx-1.0.0 - batch send (owner 2026-08-26:'],
  ['batch queue (runUnifiedBatchSend)',
    '  function runUnifiedBatchSend(state, btn) {', '  function reopenOptions(opts, manifest) {'],
  ['closed allowlist ATHENA_EXECUTABLE_ACTIONS', '  var ATHENA_EXECUTABLE_ACTIONS = ', '\n'],
  ['closed allowlist OPBATCH_ACTIONS', '  var OPBATCH_ACTIONS = ', '\n']
];
{
  HEAD_REGIONS.forEach(function (r) {
    const name = r[0], start = r[1], end = r[2];
    const i = FLOW.indexOf(start);
    ok(i >= 0, 'the write-path region vanished entirely: ' + name);
    const j = FLOW.indexOf(end, i + start.length);
    ok(j > i, 'the write-path region lost its end marker: ' + name);
    const got = crypto.createHash('sha256').update(FLOW.slice(i, j), 'utf8').digest('hex');
    ok(SHEET_CLARITY.indexOf(got) > 0,
      'tests/sheet-clarity.test.js does not carry this region\'s current digest - apsel touched the write path: ' + name);
    ok(AUTO_CHAIN.indexOf(got) > 0,
      'tests/write-auto-chain.test.js does not carry this region\'s current digest - the pins have drifted apart: ' + name);
  });
  /* and the A/P group is a SELECTION and a COUNT, never a new send path */
  eq((FLOW.match(/function apGroupLanded\(state\) \{/g) || []).length, 1,
    'the one-destination reader exists more than once - two answers to one question');
  ['apGroupLanded', 'apSurfaceLearn', 'apSurfaceNoteRefusal', 'apNoteManualPick'].forEach(function (fn) {
    const at = FLOW.indexOf('  function ' + fn + '(');
    ok(at > 0, 'the apsel-1.0.0 helper vanished: ' + fn);
    const body = FLOW.slice(at, FLOW.indexOf('\n  function ', at + 20));
    ['executeUnifiedSelection', 'runUnifiedBatchSend', 'probeUnifiedRow', 'postMessage', 'bridge('].forEach(function (banned) {
      eq(body.indexOf(banned), -1, 'an apsel-1.0.0 observer reaches the write path through ' + banned + ': ' + fn);
    });
  });
}

/* ------------------------------------------------------------------ fixtures */
const DAY = '2026-08-31';
const ATHENA_DAY = '8/31/2026';
const APPOINTMENT = '70000831';
const ENCOUNTER = '55831';
const ENCOUNTER_URL = 'https://athena.example/encounter/55831';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-apsel', patientId: 'syn-apsel', name: 'Synthetic Patient Apsel', dob: '01/02/1980', mrn: '100831' };
const CAL_ROW = { id: 'cal-row-apsel', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
/* the exact shape the owner's own review carries: the three plain sections plus
   one assessment and one plan, which is what makes ap-1.0.0 mint the pair AND
   the combined row. */
const FIVE = [
  { key: 'hpi', text: 'Synthetic HPI body for the apsel proof.' },
  { key: 'ros', text: 'Synthetic ROS body for the apsel proof.' },
  { key: 'exam', text: 'Synthetic exam body for the apsel proof.' },
  { key: 'assessment', text: 'Synthetic assessment narrative for the apsel proof.' },
  { key: 'plan', text: 'Synthetic plan and follow-up for the apsel proof.' }
];
const AP_IDS = { combined: 'write-note-assessment_and_plan' };
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ------------------------------------------------------------------ DOM shim
 * The same shape tests/write-ui-proof.js proved this renderer against: the
 * include checkboxes are parsed out of the markup the renderer ACTUALLY
 * emitted, so "unchecked" here means the shipped control, flipped the way the
 * doctor flips it. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsAthenaUnifiedCopySection'];
const SECTIONS_SELECTOR = '#mlsAthenaUnifiedConfirm [data-mls-sections="1"]';

function makeDom() {
  const byId = new Map();
  const live = new Map();
  const sectionsHost = { style: { display: '' } };
  let card = null;

  function checkbox(rowId, tail) {
    const markupChecked = /(^|\s)checked(\s|$|>)/.test(String(tail || ''));
    const el = {
      tagName: 'INPUT', type: 'checkbox', checked: markupChecked,
      id: '', style: {}, children: [],
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
        if (s === SECTIONS_SELECTOR) return sectionsHost;
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
    querySelector(sel) { return String(sel) === SECTIONS_SELECTOR ? sectionsHost : resolve(sel); },
    querySelectorAll(sel) { return (/mls-bx-check/.test(String(sel || '')) && card) ? boxesOf(card) : []; },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return { document, resolve, sectionsHost, boxes: () => (card ? boxesOf(card) : []), cardHtml: () => (card ? card.innerHTML : '') };
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
  /* apsel-1.0.0: the learned A/P surface preference, seeded exactly where the
     shipped apSurfacePref() reads it (account-scoped through window.uns). */
  if (options.pref) store.set('acct:mlsApSurfaceV1', String(options.pref));
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
      return { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        noteWriteProof: 'proof-' + ENCOUNTER, noteWriteProofExpiresAt: Date.now() + 600000, context: clone(CONTEXT) };
    }
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
      rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(CONTEXT) };
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    /* wfatt-1.0.0: `onAction` lets a case answer the SHIPPED bridge the way
       athenaOne answered the owner's tab - a read-only check that refuses. It
       is the only way to reach the settle latch through the real code path
       instead of poking the ledger by hand. */
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId,
      (typeof options.onAction === 'function' ? options.onAction(m, defaultAction) : defaultAction(m)));
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsPing') return deliverRaw({ source: 'mls-ext', type: 'mlsPong', requestId: m.requestId, version: '3.0.108', buildId: '3.0.108', batchArm: '1.0.0', capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true, batchArmV1: true } });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.108', versionName: 'x', athena: { tabs: 1, discarded: 0 } });
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => { const m = Number(ms || 0); if (m <= 2000 || m === 12000 || m === 15000) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });
  return {
    window, document: dom.document, el: dom.resolve, boxes: dom.boxes, cardHtml: dom.cardHtml,
    sectionsHost: dom.sectionsHost, posted,
    wf: window.__mlsWriteFlow,
    ledger: () => window.__mlsWriteFlow.diagnostics.receiptLedger,
    rowSel: () => window.__mlsWriteFlow.diagnostics.rowSel,
    regenKeep: () => window.__mlsWriteFlow.diagnostics.regenKeep,
    state: () => window.__mlsWriteFlow.diagnostics.state(),
    receiptHtml: () => String(dom.resolve('mlsAthenaUnifiedReceipt').innerHTML || ''),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    box: rowId => dom.boxes().filter(b => b.getAttribute('data-mls-bx-row') === rowId)[0] || null
  };
}
async function settle(n) { for (let i = 0; i < (n || 300); i++) await new Promise(r => setImmediate(r)); }

/* Every A/P row this review minted, in manifest order. The manifest is built
   inside the vm realm, so it is copied into THIS realm with Array.from before
   anything compares it - a cross-realm array is never deep-equal to a literal
   one, and that failure would look like a missing destination. */
function noteRows(manifest) {
  return Array.from(manifest.rows).filter(r => r.action === 'write_note');
}
function rowOfKind(manifest, kind) {
  return noteRows(manifest).filter(r => r.kind === kind)[0];
}
function apRows(manifest) {
  return noteRows(manifest).filter(r => ['assessment', 'plan', 'assessment_and_plan'].indexOf(r.kind) >= 0);
}
function checkedIds(h) {
  return h.boxes().filter(b => b.checked).map(b => b.getAttribute('data-mls-bx-row'));
}

(async function run() {

  /* ============ 1. NOTHING WAS REMOVED - ALL SIX DESTINATIONS ARE MINTED ===
   * The cure is a selection and a count. If a row stopped being offered, the
   * doctor lost a destination, and that is the failure mode this section
   * exists to catch. */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-mint' });
    await settle(160);
    const kinds = noteRows(manifest).map(r => r.kind);
    assert.deepStrictEqual(kinds, ['hpi', 'ros', 'exam', 'assessment', 'plan', 'assessment_and_plan'],
      'apsel-1.0.0 REMOVED A DESTINATION - all six rows must still be minted and offered');
    checks++;
    eq(apRows(manifest).length, 3, 'the mutually exclusive A/P group is no longer three rows');
    eq(h.boxes().length, 6, 'a note-write row lost its include checkbox - every one of them is still one tick away');
  }

  /* ============ 2. THE ARRIVAL: EXACTLY ONE A/P DESTINATION IS TICKED ======
   * THE MEASURED DEFECT: all three arrived ticked, so the default press always
   * attempted a destination that cannot exist on this surface. */
  {
    /* 2a. unlearned - the combined row, because the only A/P surface anyone has
       measured renders ONE combined field and it is the row the live run named
       as the one to press. */
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-arrive' });
    await settle(160);
    const ap = apRows(manifest);
    const ticked = ap.filter(r => h.box(r.id) && h.box(r.id).checked);
    /* THE NEGATIVE CONTROL. This assertion is read off the SHIPPED markup and
       needs no new seam, so it runs on the pre-fix bytes too - and on them it
       is RED with all three destinations ticked, which is the measured defect
       itself. Every apsel-only seam is read AFTER it. */
    eq(ticked.length, 1, 'THE MEASURED DEFECT: the mutually exclusive A/P rows did not arrive with exactly ONE destination ticked');
    eq(h.wf.diagnostics.apSurface.pref(), '', 'this harness did not start unlearned - 2a is not measuring the unlearned default');
    eq(ticked[0].id, AP_IDS.combined, 'the unlearned default is not the combined Assessment & Plan row');
    /* and nothing outside the group lost its tick */
    ['hpi', 'ros', 'exam'].forEach(k => {
      const row = rowOfKind(manifest, k);
      eq(h.box(row.id).checked, true, 'a section outside the A/P group arrived UNticked: ' + k);
    });
    eq(checkedIds(h).length, 4, 'the sheet did not arrive with the three plain sections plus exactly one A/P destination');
    /* the shipped decider agrees with the shipped markup */
    ap.forEach(r => eq(h.wf.diagnostics.apSurface.defaultChecked(r), h.box(r.id).checked,
      'the arrival default and the rendered control disagree for ' + r.id));
    /* the un-ticked side is not hidden: it says what it is, once */
    const html = h.cardHtml();
    eq((html.match(/data-mls-ap-alt/g) || []).length, 2, 'the two un-ticked A/P rows do not each carry exactly one alternative sentence');
    ok(html.indexOf(h.wf.diagnostics.apSurface.altSeparate) > 0,
      'the separate Assessment/Plan rows do not say they are the alternative for a separate-field athenaOne');
    eq(html.indexOf(h.wf.diagnostics.apSurface.altCombined), -1,
      'the TICKED combined row is labelled as an alternative to itself');
    /* nothing was sent by arriving */
    eq(h.executes().length, 0, 'a default-ticked section auto-sent itself - Confirm is still a human click');
  }
  {
    /* 2b. learned 'separate' - the pair is ticked and the combined is not.
       Never both sides, in either direction. */
    const h = makeHarness({ pref: 'separate' });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-arrive-sep' });
    await settle(160);
    eq(h.wf.diagnostics.apSurface.pref(), 'separate', 'the stored surface preference was not read back by the shipped reader');
    const ap = apRows(manifest);
    const ticked = ap.filter(r => h.box(r.id).checked).map(r => r.kind).sort();
    assert.deepStrictEqual(ticked, ['assessment', 'plan'],
      'a separate-field athenaOne did not arrive with the separate Assessment and Plan rows ticked, and only those');
    checks++;
    eq(h.box(AP_IDS.combined).checked, false, 'BOTH SIDES ARRIVED TICKED - the guaranteed dead row is back');
    ok(h.cardHtml().indexOf(h.wf.diagnostics.apSurface.altCombined) > 0,
      'the un-ticked combined row does not say it is the alternative for a one-field athenaOne');
  }

  /* ============ 3. THE COUNT: DONE IS REACHABLE ON BOTH SURFACE SHAPES =====
   * This is the real cure, and it needs no preference at all. The A/P group is
   * ONE destination because only one of its two shapes exists on any surface. */
  {
    /* 3a. a combined-field athenaOne: the three plain sections plus the
       combined row land, and the sheet says so. */
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-count-combined' });
    await settle(160);
    const seam = h.ledger(), state = h.state();
    ['hpi', 'ros', 'exam'].forEach(k => {
      const row = rowOfKind(manifest, k);
      seam.remember(state, row.id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    });
    seam.remember(state, AP_IDS.combined, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    seam.render(state);

    /* the pre-fix rule, computed off the SAME shipped manifest and the SAME
       shipped row reader: every write_note row is its own destination. It is
       carried here as the negative control - on today's receipts it can never
       reach its own total, which is exactly why DONE was unreachable. */
    const every = noteRows(manifest);
    const preFixTotal = every.length;
    const preFixLanded = every.filter(r => {
      const s = seam.rowState(state, r).status;
      return s === 'verified' || s === 'already in Athena';
    }).length;
    eq(preFixTotal, 6, 'the pre-fix control is not counting the six rows the sheet actually renders');
    ok(preFixLanded < preFixTotal,
      'THE NEGATIVE CONTROL IS INERT: the pre-fix per-row count reaches its own total on this review, so it could not have been what blocked DONE');

    const n = h.wf.diagnostics.apSurface.count();
    eq(n.total, 4, 'the collapsed count is not three plain sections plus ONE A/P destination');
    eq(n.landed, n.total, 'THE MEASURED DEFECT: every write landed and the sheet still counted a destination this surface does not have');
    const group = h.wf.diagnostics.apSurface.group();
    eq(group.present, true, 'the A/P group is not seen at all on a review that minted it');
    eq(group.landed, true, 'the combined destination landed and the group still reads unlanded');
    /* savenamed-app-1.0.0 (OWNER RULING 2026-09-02: "unblock the save block in
       mls assistant..."). Every DESTINATION is in Athena - which is what this
       suite is about, and the collapsed count above proves it - but under MLS
       Assist 3.0.111 this review also owes the doctor its own encounter save,
       so the pill may not say DONE yet and the completion banner may not fire
       and fold the checklist away over the row his last press is on. The A/P
       collapse is unaffected either way: it is asserted on both sides. */
    const svId = h.wf.diagnostics.savenamed.rowId;
    eq(h.wf.diagnostics.sheetClarity.stateFor('').label, 'ONE PRESS LEFT',
      'the pill claimed the review was finished while MLS still owed the encounter save');
    eq(h.receiptHtml().indexOf('Everything on this review is in Athena'), -1,
      'the completion banner fired while the encounter save was still owed');
    seam.remember(state, svId, { status: 'verified', message: 'Athena verified Save / Save Draft for the exact encounter.' });
    seam.render(state);
    eq(h.wf.diagnostics.sheetClarity.stateFor('').label, 'DONE',
      'THE MEASURED DEFECT: the pill could not reach DONE with every destination in Athena');
    const rec = h.receiptHtml();
    ok(rec.indexOf('Everything on this review is in Athena') > 0,
      'THE MEASURED DEFECT: the completion banner could not fire on an A/P-bearing review');
    ok(rec.indexOf('4 of 4 note sections verified') > 0, 'the banner does not count destinations the way the pill does');
    ok(rec.indexOf('MLS also saved this encounter in athenaOne and read the save back') > 0,
      'the completion banner still tells the doctor to go and save an encounter MLS saved for him');
    eq(rec.indexOf('Not written'), -1,
      'the sheet still bills the doctor for the alternative A/P destination this surface does not have');
  }
  {
    /* 3b. a separate-field athenaOne: the pair lands and the combined row is
       the one that does not exist here. Same answer, no preference needed for
       the count - the preference only decides which side arrives ticked. */
    const h = makeHarness({ pref: 'separate' });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-count-separate' });
    await settle(160);
    const seam = h.ledger(), state = h.state();
    ['hpi', 'ros', 'exam', 'assessment', 'plan'].forEach(k => {
      const row = rowOfKind(manifest, k);
      seam.remember(state, row.id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    });
    seam.render(state);
    const n = h.wf.diagnostics.apSurface.count();
    eq(n.total, 4, 'the collapsed count changed shape on a separate-field surface');
    eq(n.landed, n.total, 'THE MEASURED DEFECT: both separate A/P fields landed and the sheet still counted the combined destination too');
    /* savenamed-app-1.0.0: same rule on the separate-field surface - the save
       is owed until it lands, and DONE waits for it. */
    eq(h.wf.diagnostics.sheetClarity.stateFor('').label, 'ONE PRESS LEFT',
      'the pill claimed the review was finished while MLS still owed the encounter save');
    seam.remember(state, h.wf.diagnostics.savenamed.rowId, { status: 'verified', message: 'Athena verified Save / Save Draft for the exact encounter.' });
    seam.render(state);
    eq(h.wf.diagnostics.sheetClarity.stateFor('').label, 'DONE', 'the pill could not reach DONE on a separate-field surface');
    const rec = h.receiptHtml();
    ok(rec.indexOf('Everything on this review is in Athena') > 0, 'the completion banner could not fire on a separate-field surface');
    ok(rec.indexOf('4 of 4 note sections verified') > 0, 'the banner does not count destinations the way the pill does');
  }
  {
    /* 3c. AND THE COUNT STILL TELLS THE TRUTH WHEN IT IS NOT DONE. The collapse
       may not launder a missing destination into a finished review. */
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-count-partial' });
    await settle(160);
    const seam = h.ledger(), state = h.state();
    ['hpi', 'ros'].forEach(k => {
      const row = rowOfKind(manifest, k);
      seam.remember(state, row.id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    });
    seam.render(state);
    const n = h.wf.diagnostics.apSurface.count();
    eq(n.total, 4, 'the collapsed total moved on a partial send');
    eq(n.landed, 2, 'the collapsed count credited a destination nothing landed in');
    eq(h.wf.diagnostics.apSurface.group().landed, false, 'the A/P group reads landed with no A/P receipt at all');
    eq(h.wf.diagnostics.sheetClarity.stateFor('').label, 'PARTLY DONE', 'a partial send no longer reads PARTLY DONE');
    eq(h.receiptHtml().indexOf('Everything on this review is in Athena'), -1,
      'a partial send claimed everything is in Athena');
  }
  {
    /* 3d. HALF the separate pair is not the destination. One field written and
       the other not is exactly the state the doctor must still see as owed. */
    const h = makeHarness({ pref: 'separate' });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-count-half' });
    await settle(160);
    const seam = h.ledger(), state = h.state();
    ['hpi', 'ros', 'exam', 'assessment'].forEach(k => {
      const row = rowOfKind(manifest, k);
      seam.remember(state, row.id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    });
    seam.render(state);
    eq(h.wf.diagnostics.apSurface.group().landed, false, 'half of the separate A/P pair was counted as the whole destination');
    eq(h.wf.diagnostics.apSurface.count().landed, 3, 'a half-written A/P pair was credited as its destination');
    eq(h.wf.diagnostics.sheetClarity.stateFor('').label, 'PARTLY DONE', 'a half-written A/P pair read DONE');
  }

  /* ============ 4. THE DOCTOR'S OWN TICK OUTRANKS THE LEARNED DEFAULT ======
   * Recorded through the SHIPPED include-checkbox sync, so a re-render restores
   * the destination he chose rather than the one this athenaOne last taught. */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-pick' });
    await settle(160);
    eq(h.wf.diagnostics.apSurface.pick(), '', 'a new review did not start from a clear per-sheet pick');
    const assessment = rowOfKind(manifest, 'assessment');
    const planRow = rowOfKind(manifest, 'plan');
    h.box(AP_IDS.combined).checked = false;
    h.box(assessment.id).checked = true;
    h.box(planRow.id).checked = true;
    h.wf.diagnostics.apSurface.fromCheckbox(h.state());   /* the SAME function the shipped change handler calls */
    eq(h.wf.diagnostics.apSurface.pick(), 'separate', 'the doctor\'s own A/P tick was not recorded for this sheet');
    eq(h.wf.diagnostics.apSurface.defaultChecked(assessment), true,
      'a re-render would have UNticked the separate Assessment row he just chose');
    eq(h.wf.diagnostics.apSurface.defaultChecked(rowOfKind(h.state().manifest, 'assessment_and_plan')), false,
      'a re-render would have re-ticked the combined row he just cleared');
    /* his pick is for THIS sheet only - it never becomes the learned surface */
    eq(h.wf.diagnostics.apSurface.pref(), '', 'the doctor\'s one-sheet tick was written into the account-scoped surface preference');
  }

  /* ============ 5. LEARNING IS OBSERVATION, AND IT IS EVIDENCE-LED ==========
   * A landed A/P row is the strongest statement athenaOne can make about which
   * shape it has. It is read off the receipts the write path already minted. */
  {
    const h = makeHarness({ pref: 'separate' });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-learn' });
    await settle(160);
    eq(h.wf.diagnostics.apSurface.pref(), 'separate', 'the harness did not start from the wrong learned surface, so 5 proves nothing');
    const seam = h.ledger(), state = h.state();
    seam.remember(state, AP_IDS.combined, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    seam.render(state);
    eq(h.wf.diagnostics.apSurface.pref(), 'combined',
      'a VERIFIED combined Assessment & Plan write did not teach the sheet that this athenaOne has one combined field');
    eq(h.executes().length, 0, 'the learning pass sent something');
    eq(noteRows(manifest).length, 6, 'the learning pass removed a row');
  }
  {
    /* the mirror: a separate Assessment write that landed teaches 'separate' */
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(FIVE), expectedContext: BOUND, receiptSessionId: 'apsel-learn-sep' });
    await settle(160);
    const assessment = rowOfKind(manifest, 'assessment');
    const seam = h.ledger(), state = h.state();
    seam.remember(state, assessment.id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    seam.render(state);
    eq(h.wf.diagnostics.apSurface.pref(), 'separate',
      'a VERIFIED separate Assessment write did not teach the sheet that this athenaOne has separate fields');
  }

  console.log('ap-one-destination-proof: ' + checks + ' checks passed (apsel-1.0.0) - the seven write-path regions are byte-identical to the digests sheet-clarity and write-auto-chain both carry; all six destinations are still minted, still rendered and still one tick away; exactly ONE of the mutually exclusive Assessment/Plan destinations arrives ticked - the combined row until this athenaOne answers otherwise - and the un-ticked side says once what it is; the sheet counts that group as the ONE destination the surface has, so DONE and the green "Everything on this review is in Athena" banner are reachable on a combined-field surface and on a separate-field surface alike while a partial or half-written send still reads PARTLY DONE; and the doctor\'s own tick outranks the learned surface for his sheet without ever being written into it');
})().catch(function (err) { console.error(err && err.stack || err); process.exit(1); });
