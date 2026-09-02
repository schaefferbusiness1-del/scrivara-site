'use strict';

/* rowsel-1.0.0 / reopen-1.0.0 / regenkeep-1.0.0 - THREE THINGS THE DOCTOR DID
 * THAT THE APP ANSWERED WRONG.
 *
 * OWNER RULING, 2026-09-01, verbatim: "nothing here should be blocked or manual
 * or not attempted once its run."
 *
 * All three were measured on his own tab at b1197 (2026-09-02, 01:5x-02:1x,
 * test patient Adam only). None of them is a write defect: in every one of the
 * three the write path did exactly what it is built to do, and the APP then
 * described it wrongly, threw away work it already had, or undid a binding he
 * had just made by hand. Each is fixed where it happened, and each is pinned
 * here against the SHIPPED functions - lifted, never reimplemented.
 *
 *   (A) rowsel-1.0.0 - THE ROWS HE UNCHECKED WERE REPORTED AS FAILURES.
 *       He unchecked five of six sections and pressed Confirm for the one he
 *       wanted ("Write reviewed Assessment & Plan (combined)"), which went
 *       VERIFIED. The receipt then listed the five he had deliberately left
 *       alone as "NOT ATTEMPTED - Ready, but not attempted in this receipt."
 *       and totalled them into "Not written - 5 of 6". An unchecked row is a
 *       row the doctor chose not to send. It reads NOT SELECTED, in his own
 *       terms, and it is in neither number: "Not written - N of M" counts only
 *       CHECKED rows, and M is the checked rows. A checked row he has not
 *       pressed for yet keeps wfnext-1.0.0's WAITING FOR YOUR PRESS, and a
 *       checked row that did not land still counts, because that one IS owed.
 *
 *   (B) reopen-1.0.0 - REOPENING A SAVED NOTE THREW AWAY ITS ATHENA SIDECAR.
 *       History row -> "Reopen in editor". The saved record carried athenaNote
 *       (1,603 chars), athenaNoteProvenance 'generated' and a matching
 *       athenaNoteSourceFingerprint - History's own review accepted that exact
 *       record - yet the reopened editor read 'stale' and the sheet answered
 *       "NEEDS ONE STEP - generate the five local draft fields first". A second
 *       model call and about forty seconds, for a note that already had a valid
 *       payload. The cause is identity metadata, never clinical text: the
 *       reopen fills #patientLabel from the record's ROUTE PATIENT NAME while
 *       the saved fingerprint holds the clinician's own typed label, so the
 *       live comparison failed on a field that had not changed.
 *
 *   (C) regenkeep-1.0.0 - REGENERATE UNDID THE BIND HE HAD JUST DONE.
 *       He pressed "Bind to 2026-08-31", watched the sheet rebind to the exact
 *       appointment, then pressed the sheet's own "Regenerate HPI, ROS, Exam,
 *       Assessment & Plan". The rebuilt review came back "expected day
 *       2026-09-01 - no appointment id is bound". wfbind does not touch the
 *       app's currentVisitAthenaBinding; it re-enters the sheet with a bound
 *       expectedContext, which lives in the SHEET's state. The regenerate
 *       rebuilt through the app binding alone and discarded it.
 *
 * WHAT THIS SUITE IS NOT. It is not a write proof. Section 0 pins that all
 * seven SHA-pinned write-path regions are byte-identical, so nothing here can
 * be mistaken for a change to what a write is.
 *
 * Run:  node tests/sheet-rows-and-reopen-proof.js
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
 * The seven SHA-pinned write-path regions, exactly as tests/write-ui-proof.js
 * and tests/write-next-press-proof.js do it: the digests are NOT re-derived
 * here, they must already be carried by BOTH tests/sheet-clarity.test.js and
 * tests/write-auto-chain.test.js. This lane moved NONE of them - it changed
 * how a finished review is DESCRIBED, what a reopen restores, and which visit
 * a regenerate rebuilds against. */
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
      'tests/sheet-clarity.test.js does not carry this region\'s current digest - a presentation lane changed the write path: ' + name);
    ok(AUTO_CHAIN.indexOf(got) > 0,
      'tests/write-auto-chain.test.js does not carry this region\'s current digest - the pins have drifted apart: ' + name);
  });
  /* and this lane never reaches for the app's own visit binding */
  eq(FLOW.indexOf('_athenaSetVisitBinding'), -1,
    'THE WRITE FLOW NOW SETS THE APP\'S VISIT BINDING - a sheet may read a binding, never assign one');
}

/* ------------------------------------------------------------------ fixtures */
const DAY = '2026-08-31';
const ATHENA_DAY = '8/31/2026';
const APPOINTMENT = '70000831';
const ENCOUNTER = '55831';
const ENCOUNTER_URL = 'https://athena.example/encounter/55831';
const PROVIDER = 'Synthetic Clinician One, MD';
/* the day the app rebuilds against when the sheet's binding is thrown away:
   the creation day, with nothing on the schedule for this patient. */
const APP_DAY = '2026-09-01';
const APP_ATHENA_DAY = '9/1/2026';
const PATIENT = { id: 'syn-rowsel', patientId: 'syn-rowsel', name: 'Synthetic Patient Rowsel', dob: '01/02/1980', mrn: '100831' };
const OTHER_PATIENT = { id: 'syn-other', patientId: 'syn-other', name: 'Synthetic Other Patient', dob: '03/04/1975', mrn: '100999' };
const CAL_ROW = { id: 'cal-row-rowsel', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const THREE = [
  { key: 'hpi', text: 'Synthetic HPI body for the rowsel proof.' },
  { key: 'ros', text: 'Synthetic ROS body for the rowsel proof.' },
  { key: 'exam', text: 'Synthetic exam body for the rowsel proof.' }
];
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

/* wfatt-1.0.0: ONE row's own block inside the "What happened" list. Every row
   there is emitted as <b>label</b><span>STATUS</span><div>message</div>, so a
   status or a sentence that is true of some OTHER row can never satisfy - or
   mask - an assertion about this one. */
function whatHappenedRow(html, label) {
  const at = String(html).indexOf('<b>' + label + '</b><span');
  assert.ok(at >= 0, 'the "What happened" list no longer carries a block for ' + label);
  checks++;
  const next = String(html).indexOf('<b>', at + 3);
  return String(html).slice(at, next > at ? next : undefined);
}

(async function run() {

  /* =============== 1. AN UNCHECKED ROW IS A CHOICE, NOT A FAILURE ==========
   * The measured shape, scaled to three: one section checked and landed, the
   * others deliberately unchecked. */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'rowsel-one' });
    await settle(160);
    const noteRows = manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    eq(noteRows.length, 3, 'the three-section fixture did not build three READY note rows');
    eq(h.boxes().length, 3, 'the shipped markup did not carry one include checkbox per READY note row');
    /* apsel-1.0.0 (2026-09-02 09:xx) SCOPE NOTE, deliberate and NOT a re-aim:
       the arrival default now un-ticks exactly one side of the mutually
       exclusive Assessment / Plan / combined group, because only one of those
       two shapes exists on any athenaOne A/P stage (his renders one combined
       field). THIS fixture is hpi/ros/exam - it mints no A/P row at all - so
       "every READY note section arrives checked" is still the whole truth here
       and the assertion is unchanged. The A/P arrival is proven, in both
       directions, in tests/ap-one-destination-proof.js. */
    h.boxes().forEach(b => ok(b.checked === true, 'the sheet no longer arrives with every READY note section checked'));

    /* he unchecks two, and only the first one lands */
    h.box(noteRows[1].id).checked = false;
    h.box(noteRows[2].id).checked = false;
    const seam = h.ledger(), state = h.state();
    seam.remember(state, noteRows[0].id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    seam.render(state);

    eq(seam.rowState(state, noteRows[1]).status, 'not selected', 'an UNCHECKED row is still reported as an attempt that did not happen');
    eq(seam.rowState(state, noteRows[2]).status, 'not selected', 'the second unchecked row is still reported as an attempt that did not happen');
    eq(seam.rowState(state, noteRows[1]).message, 'You left this section unchecked; nothing was sent for it.',
      'the unchecked row does not say, in his own terms, that he left it unchecked');
    eq(h.rowSel().status, 'not selected', 'the rowsel seam no longer exposes the shipped status word');
    eq(h.rowSel().message, 'You left this section unchecked; nothing was sent for it.', 'the rowsel seam no longer exposes the shipped sentence');

    const rec = h.receiptHtml();
    ok(rec.indexOf('NOT SELECTED') > 0, 'the receipt does not paint NOT SELECTED for a row the doctor unchecked');
    eq((rec.match(/NOT SELECTED/g) || []).length, 2, 'the receipt did not paint NOT SELECTED once per unchecked row');
    eq(rec.indexOf('NOT ATTEMPTED'), -1, 'THE MEASURED DEFECT: a row the doctor unchecked is still reported NOT ATTEMPTED');
    eq(rec.indexOf('Ready, but not attempted in this receipt.'), -1,
      'the unchecked rows still carry the "not attempted in this receipt" sentence');
    eq(rec.indexOf('Not written'), -1,
      'THE MEASURED DEFECT: rows the doctor never selected were totalled into "Not written - N of M"');
    ok(rec.indexOf('data-mls-receipt-landed="1"') > 0, 'the one section that did land is not named');
    ok(rec.indexOf('<b>' + noteRows[0].label + '</b> &rarr; ' + noteRows[0].destination) > 0,
      'the receipt does not say where the section he did send landed');
  }

  /* ============= 2. A CHECKED ROW IS STILL OWED, AND STILL COUNTS ==========
   * Same sheet, one of the two re-checked. The re-checked row keeps wfnext's
   * WAITING FOR YOUR PRESS and IS in the count; the one still unchecked is in
   * neither number. */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'rowsel-two' });
    await settle(160);
    const noteRows = manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    const seam = h.ledger(), state = h.state();
    h.box(noteRows[1].id).checked = false;   /* left alone on purpose */
    seam.remember(state, noteRows[0].id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    seam.render(state);

    eq(seam.rowState(state, noteRows[2]).status, 'waiting for your press',
      'a CHECKED section nobody has pressed for yet stopped saying it is waiting for the next press');
    const rec = h.receiptHtml();
    ok(rec.indexOf('WAITING FOR YOUR PRESS') > 0, 'the receipt no longer paints WAITING FOR YOUR PRESS for a checked, unpressed row');
    ok(/Not written &mdash; 1 of 2/.test(rec),
      'M is not the CHECKED rows: the unchecked section is still being counted into "Not written - N of M"');
    ok(rec.indexOf('<b>' + noteRows[2].label + '</b>') > 0, 'the checked row that has not landed is not named under "Not written"');
    eq(rec.indexOf('<b>' + noteRows[1].label + '</b> &mdash; You left this section unchecked'), -1,
      'the unchecked row was listed under "Not written" instead of only in the row list');

    /* a checked row that FAILED still counts - that one really is owed */
    seam.remember(state, noteRows[2].id, { status: 'uncertain', message: 'No completion response arrived. Inspect the exact destination before any retry.' });
    seam.render(state);
    const rec2 = h.receiptHtml();
    ok(rec2.indexOf('UNCERTAIN') > 0, 'a checked row whose outcome was uncertain lost its status word');
    ok(/Not written &mdash; 1 of 2/.test(rec2), 'a CHECKED row that did not land stopped counting as not written');

    /* the control: re-check the third and M moves to 3 */
    h.box(noteRows[1].id).checked = true;
    seam.render(state);
    ok(/Not written &mdash; 2 of 3/.test(h.receiptHtml()),
      're-checking a section did not put it back into the count - M is not reading the checkboxes');
  }

  /* ===== 3. A ROW THAT NEVER CARRIES A CHECKBOX KEEPS EVERY WORD IT HAD ====
   * Save draft, Sign & Save, orders, and any sheet with no include checkboxes
   * at all can never be "unchecked", so the fallback sentence is untouched. */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'rowsel-three' });
    await settle(160);
    const seam = h.ledger(), state = h.state();
    const phantom = { id: 'row-no-checkbox', capability: 'ready', action: 'save_draft', reason: '' };
    eq(seam.rowState(state, phantom).status, 'not attempted',
      'a row with no include checkbox was called NOT SELECTED - only a real, unticked control may say that');
    eq(seam.rowState(state, phantom).message, 'Ready, but not attempted in this receipt.',
      'the no-checkbox fallback sentence changed');
    eq(seam.rowState(state, { id: 'row-manual', capability: 'manual', reason: 'Do this in Athena yourself.' }).status, 'manual',
      'a MANUAL row was swept into the new status');
    eq(seam.rowState(state, { id: 'row-blocked', capability: 'blocked', reason: 'The exact visit needs its appointment ID.' }).status, 'blocked',
      'a BLOCKED row was swept into the new status');
  }

  /* ======== 4. REGENERATE KEEPS THE VISIT HE JUST BOUND, BY HAND ===========
   * The measured sequence: bound sheet -> "Regenerate HPI, ROS, Exam,
   * Assessment & Plan" -> the rebuild comes back for the app's own day. */
  const APP_OPTS = { patient: PATIENT, sections: THREE, receiptSessionId: 'regen-app',
    expectedContext: { visitDate: APP_ATHENA_DAY, provider: PROVIDER, appointmentId: '', encounterId: '', encounterUrl: '' } };
  {
    /* 4a. THE DEFECT, reproduced against the shipped rebuild with nothing
       armed: the app's own context names the creation day and no appointment. */
    const h = makeHarness({});
    const bare = h.wf.openUnifiedConfirmation(clone(APP_OPTS));
    await settle(120);
    eq(bare.visit.appointmentId, '', 'the fixture is invalid - the app-side rebuild already knows an appointment');
    ok(bare.visit.visitDate.indexOf('9/1/2026') >= 0 || bare.visit.visitDate.indexOf(APP_DAY) >= 0,
      'the fixture is invalid - the app-side rebuild did not land on the creation day (got ' + bare.visit.visitDate + ')');
  }
  {
    const h = makeHarness({});
    let generateCalls = 0, rebuildCalls = 0;
    const boundManifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, plan: [], sections: [], expectedContext: BOUND,
      receiptSessionId: 'regen-bound', generationIssue: 'athena-note-stale-canonical-provenance' });
    await settle(160);
    const boundVisit = clone(boundManifest.visit);
    eq(boundVisit.appointmentId, APPOINTMENT, 'the bound review did not carry the exact appointment the doctor bound');
    eq(boundVisit.encounterId, ENCOUNTER, 'the bound review did not carry the exact encounter');

    /* the sheet's own local-generation action, wired exactly as it ships */
    h.window.generateNote = function () { generateCalls++; return true; };
    h.window.pushEntireVisitToAthena = function () {
      rebuildCalls++;
      /* the app rebuild knows only the app binding - the creation day, unbound */
      h.wf.openUnifiedConfirmation(clone(APP_OPTS));
      return true;
    };
    const genBtn = h.el('mlsAthenaUnifiedGenerateSections');
    ok(genBtn && (genBtn.handlers.click || []).length === 1, 'the Regenerate control is not wired on the sheet');
    genBtn.click();
    await settle(300);

    eq(generateCalls, 1, 'the regenerate did not run the ordinary local generation exactly once');
    eq(rebuildCalls, 1, 'the regenerate did not rebuild the review exactly once');
    eq(h.executes().length, 0, 'THE REGENERATE WROTE TO ATHENA - it may only run local generation and validation');

    const rebuilt = h.state().manifest;
    eq(rebuilt.visit.visitDate, boundVisit.visitDate,
      'THE MEASURED DEFECT: the regenerate reset the visit to the creation day and the bind had to be done again');
    eq(rebuilt.visit.appointmentId, boundVisit.appointmentId, 'the regenerate lost the exact appointment the doctor bound');
    eq(rebuilt.visit.encounterId, boundVisit.encounterId, 'the regenerate lost the bound encounter id');
    eq(rebuilt.visit.encounterUrl, boundVisit.encounterUrl, 'the regenerate lost the bound encounter URL');
    eq(rebuilt.visit.provider, boundVisit.provider, 'the regenerate lost the bound provider');
    eq(rebuilt.patient.patientId, PATIENT.patientId, 'the regenerate rebuilt against a different patient');
    /* ...and it DID re-run the note generation: the freshly generated sections
       are the rows on the rebuilt sheet. */
    eq(rebuilt.rows.filter(r => r.action === 'write_note').length, 3,
      'the rebuild did not carry the freshly generated note sections');

    /* the carry-through is ONE SHOT: the very next ordinary open is untouched */
    eq(h.regenKeep().pending(), null, 'the regenerate left a standing visit override armed');
    const after = h.wf.openUnifiedConfirmation(clone(APP_OPTS));
    await settle(120);
    eq(after.visit.appointmentId, '', 'a later ordinary review inherited the regenerate\'s carry-through');
    ok(after.visit.visitDate !== boundVisit.visitDate, 'a later ordinary review inherited the regenerate\'s bound day');
  }
  {
    /* 4b. it refuses outright for a different patient, and it can never invent
       a binding the sheet did not already hold. */
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, plan: [], sections: [], expectedContext: BOUND,
      receiptSessionId: 'regen-guard', generationIssue: 'athena-note-stale-canonical-provenance' });
    await settle(160);
    const keep = h.regenKeep();
    eq(keep.arm(h.state()), true, 'a bound review could not arm the carry-through');
    const otherOpts = { patient: OTHER_PATIENT, sections: THREE, expectedContext: { visitDate: APP_ATHENA_DAY, provider: PROVIDER, appointmentId: '' } };
    const applied = keep.apply(clone(otherOpts));
    eq(applied.expectedContext.appointmentId, '', 'THE CARRY-THROUGH CROSSED PATIENTS - it must refuse the moment the rebuild names another chart');
    eq(applied.expectedContext.visitDate, APP_ATHENA_DAY, 'the carry-through moved another patient\'s day');
    eq(keep.pending(), null, 'apply() did not consume the one-shot');

    eq(keep.visitOf({ visitDate: ATHENA_DAY, appointmentId: '', encounterId: '', encounterUrl: '' }), null,
      'a HALF-bound visit was treated as an exact binding worth carrying');
    eq(keep.visitOf({ visitDate: '', appointmentId: APPOINTMENT }), null, 'a visit with no day was treated as bindable');
    ok(!!keep.visitOf({ visitDate: ATHENA_DAY, appointmentId: APPOINTMENT }), 'a day + appointment is not recognised as an exact binding');
    ok(!!keep.visitOf({ visitDate: ATHENA_DAY, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL }),
      'a day + bound encounter is not recognised as an exact binding');
    eq(keep.samePatient(PATIENT, OTHER_PATIENT), false, 'the identity guard accepted two different charts');
    eq(keep.samePatient(PATIENT, clone(PATIENT)), true, 'the identity guard rejected the same chart');
    /* and with nothing armed, apply() is the identity function */
    const untouched = { patient: PATIENT, expectedContext: { visitDate: APP_ATHENA_DAY, appointmentId: '' } };
    eq(keep.apply(untouched), untouched, 'apply() rewrote an opts object with nothing armed');
  }

  /* ================= 5. REOPEN KEEPS THE SIDECAR IT ALREADY HAS ============
   * Lifted from BOTH 1p shells - the shipped canonical block, never a
   * reimplementation. */
  const SHELLS = ['1pScribeFlow.html', path.join('1p', 'index.html')];
  const CANON_TEXT = [
    'HPI:', 'Pain improved after the injection.',
    '', 'ROS:', 'Denies weakness or bowel/bladder change.',
    '', 'EXAM:', 'Strength is five out of five.',
    '', 'ASSESSMENT:', 'Lumbar radicular pain, improving.',
    '', 'PLAN:', 'Continue home exercise and follow up in four weeks.'
  ].join('\n');

  function canonicalBlock(source) {
    const start = source.indexOf('function _mlsAthenaNoteQualityError(');
    const end = source.indexOf('\n\n/* =========================================================\n   GENERATE NOTE', start);
    ok(start >= 0 && end > start, 'the canonical Athena state block moved or was removed');
    return source.slice(start, end);
  }
  function shellHarness(source, file) {
    const values = { transcript: 'source transcript', contextBox: 'source context', visitComment: '',
      patientLabel: 'Label the clinician typed', noteBox: CANON_TEXT };
    const binding = {
      patient: { patientId: 'p-1', name: 'Route Patient Name', dob: '1980-01-01', mrn: 'M-1' },
      visitContext: { visitDate: DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL }
    };
    const sandbox = {
      window: { __mlsWriteFlow: { parseGeneratedSoapSections: () => ({ ok: false, sections: [] }) } },
      document: {
        getElementById: id => Object.prototype.hasOwnProperty.call(values, id) ? {
          style: { display: 'block' },
          get value() { return values[id]; },
          set value(v) { values[id] = String(v); }
        } : null
      },
      getActivePtId: () => 'p-1',
      currentVisitAthenaBinding: binding,
      currentSoap: CANON_TEXT, currentInsurance: '', currentFormat: 'soap',
      currentNoteProvenance: 'generated_soap',
      currentAthenaNote: '', currentAthenaNoteProvenance: 'none', currentAthenaNoteSourceFingerprint: ''
    };
    vm.createContext(sandbox);
    vm.runInContext(canonicalBlock(source) + '\n' + [
      'this.__api={',
      '  set:_mlsSetAthenaNote,',
      '  restore:_mlsRestoreAthenaState,',
      '  reopen:_mlsReopenRestoreSavedAthenaSidecar,',
      '  fingerprint:_mlsAthenaSourceFingerprint,',
      '  write:_mlsAthenaCanonicalForWrite,',
      '  saved:_mlsSavedAthenaCanonicalForWrite,',
      '  matchesRecord:_mlsSavedAthenaFingerprintMatchesRecord',
      '};'
    ].join('\n'), sandbox, { filename: file });
    return { sandbox, values, binding, api: sandbox.__api };
  }

  SHELLS.forEach(function (file) {
    const source = read(file);
    const h = shellHarness(source, file);
    const s = h.sandbox, v = h.values, api = h.api;

    /* the visit as it was SAVED: the clinician's own typed label is what the
       fingerprint holds, and the route patient carries a different name. */
    api.set(CANON_TEXT, 'generated');
    const record = {
      id: 'reopen-1', patient: h.binding.patient.name, patientLabel: v.patientLabel, patientId: 'p-1',
      patientDob: h.binding.patient.dob, patientMrn: h.binding.patient.mrn,
      transcript: v.transcript, context: v.contextBox, visitComment: v.visitComment,
      soap: s.currentSoap, noteProvenance: s.currentNoteProvenance,
      athenaNote: s.currentAthenaNote, athenaNoteProvenance: s.currentAthenaNoteProvenance,
      athenaNoteSourceFingerprint: s.currentAthenaNoteSourceFingerprint,
      visitDate: h.binding.visitContext.visitDate, provider: h.binding.visitContext.provider,
      appointmentId: h.binding.visitContext.appointmentId, encounterId: h.binding.visitContext.encounterId,
      encounterUrl: h.binding.visitContext.encounterUrl, coding: null, orders: []
    };
    ok(record.athenaNote.length > 0, file + ': the fixture never minted a canonical sidecar');
    eq(api.saved(record).ok, true, file + ': the fixture record is not one History would accept - the premise is invalid');
    eq(api.matchesRecord(record.athenaNoteSourceFingerprint, record), true,
      file + ': the record fingerprint does not match the record - the premise is invalid');
    ok(record.patient !== record.patientLabel, file + ': the route-name / typed-label drift control is invalid');

    /* THE REOPEN. loadRecordIntoEditor fills #patientLabel from the record's
       ROUTE PATIENT NAME, which is the one field that differs. */
    v.patientLabel = record.patient;
    s.currentAthenaNote = ''; s.currentAthenaNoteProvenance = 'none'; s.currentAthenaNoteSourceFingerprint = '';
    api.restore(record);
    eq(s.currentAthenaNoteProvenance, 'stale',
      file + ': the premise is invalid - the shipped restore no longer goes stale on a reopen');
    eq(s.currentAthenaNote, '', file + ': the premise is invalid - the stale restore kept executable text');

    /* ...and reopen-1.0.0 puts it back, because the record proves itself. */
    eq(api.reopen(record), true, file + ': THE MEASURED DEFECT - a record with a matching fingerprint was not restored on reopen');
    eq(s.currentAthenaNoteProvenance, 'generated', file + ': the reopened sidecar did not regain its generated provenance');
    eq(s.currentAthenaNote, record.athenaNote, file + ': the reopened sidecar text is not the saved payload');
    eq(api.write().ok, true, file + ': the reopened review is still not ready to check - a regenerate is still being demanded');

    /* reopen-1.1.0 - THE LIVE b1199 SIGNATURE. reopen-1.0.0 re-anchors correctly
       at load time (every load-time asymmetry was measured; none reproduces the
       failure), so the only way the owner could see provenance 'generated' with
       the payload restored AND canonical-source-changed is a mutation AFTER
       loadRecordIntoEditor returned. The whole-state fingerprint dies on identity
       churn the canonical note does not depend on. Non-clinical churn must not
       cost him a second model call. */
    const beforeChurn = s.currentAthenaNote;
    v.patientLabel = 'Adam S (walk-in)';                    /* a re-render of the label */
    s.currentVisitAthenaBinding = {
      patient: { patientId: 'p-1', name: 'Route Patient Name', dob: '1980-01-01', mrn: 'M-1' },
      visitContext: { visitDate: DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL + '?rebound=1' }
    };                                                       /* a later re-bind of the visit */
    eq(api.write().ok, true,
      file + ': THE MEASURED b1199 DEFECT - non-clinical churn after the reopen (a relabel, a re-bind) killed a restored sidecar and the sheet demanded a regenerate again');
    eq(s.currentAthenaNote, beforeChurn, file + ': the re-anchor rewrote the canonical payload instead of only its fingerprint');
    eq(s.currentAthenaNoteProvenance, 'generated', file + ': the re-anchor changed the payload provenance');

    /* ...and the gate still MEANS what it says: a clinical edit is still stale. */
    s.currentSoap = record.soap + '\nA clinical line the sidecar never saw.';
    eq(api.write().ok, false, file + ': A CLINICAL EDIT WAS RE-ANCHORED - the canonical note no longer has to match the note on screen');
    eq(api.write().reason, 'canonical-source-changed', file + ': a clinical edit reported the wrong refusal');
    s.currentSoap = record.soap;

    /* a record whose fingerprint does NOT match its own soap/text stays stale */
    const drifted = Object.assign({}, record, { soap: record.soap + '\nEdited after the save.' });
    s.currentSoap = drifted.soap; v.noteBox = drifted.soap;
    s.currentAthenaNote = ''; s.currentAthenaNoteProvenance = 'none'; s.currentAthenaNoteSourceFingerprint = '';
    api.restore(drifted);
    eq(s.currentAthenaNoteProvenance, 'stale', file + ': a drifted record did not restore as stale');
    eq(api.reopen(drifted), false, file + ': A DRIFTED RECORD WAS BLESSED ON REOPEN - the gate was weakened, not restored');
    eq(s.currentAthenaNoteProvenance, 'stale', file + ': the refused repair still changed the provenance');
    eq(s.currentAthenaNote, '', file + ': the refused repair still restored executable text');

    /* and the editor must hold the record VERBATIM: same record, an editor
       whose standard note is something else, is refused. */
    s.currentSoap = record.soap + '\nSomething else entirely.';
    s.currentAthenaNote = ''; s.currentAthenaNoteProvenance = 'none'; s.currentAthenaNoteSourceFingerprint = '';
    eq(api.reopen(record), false,
      file + ': the repair accepted an editor whose standard note is not the record it claims to be restoring');
    s.currentSoap = record.soap;
    const otherTranscript = Object.assign({}, record);
    v.transcript = 'a different transcript than the record';
    eq(api.reopen(otherTranscript), false, file + ': the repair accepted an editor whose transcript is not the record\'s');
    v.transcript = record.transcript;

    /* a manual/typed record is untouched by any of this */
    eq(api.reopen({ noteProvenance: 'typed', athenaNoteProvenance: 'none' }), false,
      file + ': a typed record was forced through the generated-sidecar repair');
  });

  /* ===== 6. A SECTION THAT RAN AND DID NOT LAND NEVER READS AS NEVER-RUN ===
   * wfatt-1.0.0. MEASURED 2026-09-02: six sections checked, one press. The
   * Assessment narrative check ran out its bound TWICE - about five minutes -
   * and the progress panel briefly read "timed out". A check-stage refusal or
   * timeout inside runUnifiedBatchSend writes NO receipt, so the moment the
   * doctor pressed Confirm again wfprogStart replaced the progress list and
   * erased the only line that had said so. The "What happened" panel then told
   * him "WAITING FOR YOUR PRESS - Checked and ready. Nothing has been attempted
   * for this section". That is a false statement about what the software did:
   * it attempted it twice. It also hid the one fact that would have helped him.
   * A settled attempt is an outcome, and it is reported as one. */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'wfatt-one' });
    await settle(160);
    const noteRows = manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    eq(noteRows.length, 3, 'the three-section fixture did not build three READY note rows');
    const seam = h.ledger(), att = h.wf.diagnostics.attemptLedger, state = h.state();
    eq(att && att.v, 'wfatt-1.0.0', 'the settled-attempt seam is not exported by the shipped module');

    /* one section landed; the next one ran twice and never answered */
    seam.remember(state, noteRows[0].id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    att.remember(state, noteRows[1].id, att.checkTimeout, att.checkTimeoutMsg);
    seam.render(state);

    eq(seam.rowState(state, noteRows[1]).status, 'not sent - did not answer in time',
      'a section the run probed twice and settled is still reported as an attempt that never happened');
    eq(seam.rowState(state, noteRows[1]).message, att.checkTimeoutMsg,
      'the settled section does not say, in the doctor\'s words, what the software actually did');

    const rec = h.receiptHtml();
    /* THE DEFECT ITSELF - read off ONE row's own block in "What happened", so
       a sentence that is still true of a DIFFERENT row cannot mask it. */
    const timedOut = whatHappenedRow(rec, noteRows[1].label);
    eq(timedOut.indexOf('Nothing has been attempted for this section'), -1,
      'THE MEASURED DEFECT: a section MLS probed twice across five minutes is reported to the doctor as never attempted');
    ok(timedOut.indexOf('NOT SENT - DID NOT ANSWER IN TIME') > 0,
      'the receipt does not name the outcome the run actually reached for that section');
    ok(timedOut.indexOf(att.checkTimeoutMsg) > 0, 'the row does not carry the settled sentence in the doctor\'s own words');
    ok(rec.indexOf('<b>' + noteRows[1].label + '</b> &mdash; ' + att.checkTimeoutMsg) > 0,
      'the section that ran and did not land is not named under "Not written" carrying its own reason');
    ok(/Not written &mdash; 2 of 3/.test(rec), 'a settled failed attempt stopped counting as work still owed');

    /* CONTROL - the ruling this may not break: a row genuinely not reached yet
       keeps wfnext-1.0.0's exact words, in its own block. */
    eq(seam.rowState(state, noteRows[2]).status, 'waiting for your press',
      'a section nothing has run for yet lost the words that are still true of it');
    const untouched = whatHappenedRow(rec, noteRows[2].label);
    ok(untouched.indexOf('WAITING FOR YOUR PRESS') > 0 && untouched.indexOf('Nothing has been attempted for this section') > 0,
      'a section nothing has run for yet was swept into the new settled-attempt wording');

    /* a later successful check erases the stale failure - self-correcting */
    att.forget(state, noteRows[1].id);
    eq(seam.rowState(state, noteRows[1]).status, 'waiting for your press',
      'a section that finally passed its read-only check is still wearing its old failure');

    /* PRECEDENCE: a real receipt always outranks an attempt */
    att.remember(state, noteRows[2].id, att.refused, 'The read-only check refused this section.');
    seam.remember(state, noteRows[2].id, { status: 'verified', message: 'Inserted into the exact Athena field and read back successfully.' });
    eq(seam.rowState(state, noteRows[2]).status, 'verified',
      'a stale attempt outranked the durable read-back receipt for the same section');

    /* ROWSEL UNTOUCHED: the doctor's own choice is not re-opened by this lane */
    att.remember(state, noteRows[1].id, att.refused, 'The read-only check refused this section.');
    h.box(noteRows[1].id).checked = false;
    eq(seam.rowState(state, noteRows[1]).status, 'not selected',
      'a row the doctor unchecked was re-reported as a failed attempt - the rowsel-1.0.0 ruling was re-opened');
    eq(seam.rowState(state, noteRows[1]).message, 'You left this section unchecked; nothing was sent for it.',
      'the unchecked row lost its exact pinned sentence');
    h.box(noteRows[1].id).checked = true;

    /* an attempt can never make a row sendable, exactly as sectionLedger cannot */
    eq(noteRows[1].capability, 'ready', 'the fixture row changed capability under the ledger');
    eq(att.get(state, 'row-that-never-ran'), null, 'the ledger invented a record for a row nothing ran for');
  }

  /* == 6b. END TO END: THE SHIPPED REFUSAL PATH, NO SEAM CALLS AT ALL ========
   * The reachability half. Nothing below pokes the ledger: athenaOne answers
   * the read-only check the way it answered the owner's tab, the doctor presses
   * the primary once, and the receipt is read back. This is what proves the
   * settle latch really is on the path every refusal takes. */
  {
    const h = makeHarness({
      onAction: (m, dflt) => (m.mode === 'probe' ? { ok: false, blocked: true, reason: 'note-section-not-on-surface' } : dflt(m))
    });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'wfatt-live' });
    await settle(220);
    const noteRows = manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    const go = h.el('mlsAthenaUnifiedGo');
    go.click();
    await settle(900);

    eq(h.executes().length, 0, 'a section whose read-only check refused was WRITTEN');
    const state = h.state();
    eq(Object.keys(state.receipts).length, 0, 'the refused run minted a receipt - the premise of this whole case is that it does not');
    const rec = h.receiptHtml();
    ok(rec.length > 0, 'the run settled with no receipt panel at all, so the doctor is told nothing');
    eq(rec.indexOf('Nothing has been attempted for this section'), -1,
      'THE MEASURED DEFECT, END TO END: a section the shipped run just probed and refused reads as never attempted');
    ok(rec.indexOf('NOT SENT - READ-ONLY CHECK REFUSED') > 0,
      'the refused section does not carry the outcome the shipped settle latch recorded');
    ok(rec.indexOf('could not resolve one exact editor') > 0,
      'the row does not carry the reason the doctor just read on screen - the one fact that would help him');
    const live = h.wf.diagnostics.attemptLedger.get(state, noteRows[0].id);
    ok(live && live.status === 'not sent - read-only check refused',
      'the shipped refusal path recorded no attempt, so nothing but a seam call could ever have made this panel honest');
  }

  /* ============================ 7. THE TWINS, AND THE DERIVED LANES ========
   * The reopen hunks are INLINE in both 1p shells (they are not byte-identical
   * files, so the shared hunk is what must match), and every derived lane
   * carries the same write-flow bytes. */
  {
    function slice(src, start, end, what) {
      const i = src.indexOf(start);
      ok(i >= 0, what + ': start marker missing');
      const j = src.indexOf(end, i + start.length);
      ok(j > i, what + ': end marker missing');
      return src.slice(i, j);
    }
    const REOPEN_START = '/* reopen-1.0.0 (owner 2026-09-02, measured on his own tab 01:5x-02:1x): REOPENING';
    const REOPEN_END = 'function _mlsAthenaCanonicalForWrite(){';
    const CALL_SITE = '  try{ _mlsReopenRestoreSavedAthenaSidecar(n); }catch(eReopenSidecar){}';
    const shellSlices = SHELLS.concat(['ScribeFlow.html', path.join('cloned', 'index.html')]).map(function (name) {
      const src = read(name);
      const body = slice(src, REOPEN_START, REOPEN_END, name + ' reopen-1.0.0');
      eq((src.match(/function _mlsReopenRestoreSavedAthenaSidecar\(n\)\{/g) || []).length, 1,
        name + ': the reopen repair is defined more or less than once');
      const callAt = src.indexOf(CALL_SITE);
      ok(callAt > 0, name + ': loadRecordIntoEditor does not call the reopen repair');
      const restoreAt = src.indexOf("if(typeof _mlsRestoreAthenaState==='function') _mlsRestoreAthenaState(n);");
      ok(restoreAt > 0 && restoreAt < callAt,
        name + ': the reopen repair no longer runs AFTER the ordinary restore inside loadRecordIntoEditor');
      const loadAt = src.indexOf('function loadRecordIntoEditor(n){');
      const speechAt = src.indexOf('   SPEECH CAPTURE', loadAt);
      ok(loadAt > 0 && callAt > loadAt && callAt < speechAt,
        name + ': the reopen repair call is not inside loadRecordIntoEditor');
      return { name: name, body: body };
    });
    /* bumpsafe-1.0.0 (measured 2026-09-02, the b1198 bump, on this very hunk):
       ScribeFlow.html is BOTH a scripts/bump-build.js TARGET and a DERIVED file.
       replaceToken() rewrites every ISOLATED bNNNN occurrence in a target, so the
       words 'measured on his own tab at b1197' inside this comment were rewritten
       to b1198 in the derived shell alone - which is not a typo, it is DERIVATION
       DRIFT: 1p still said b1197. That one line reddened 1p-preview-contract,
       hex-colour-integrity and this suite, on origin/main. Prose that lands in
       ScribeFlow.html may therefore never carry an isolated build token; name the
       measurement by DATE instead. The check is on the hunk, where the rule bites. */
    shellSlices.forEach(function (s0) {
      eq(/(^|[^0-9a-zA-Z])b\d{3,5}([^0-9a-zA-Z]|$)/.test(s0.body), false,
        s0.name + ': the reopen-1.0.0 hunk carries an isolated bNNNN build token, which the next build bump will rewrite in the DERIVED shell only - instant derivation drift');
    });
    shellSlices.slice(1).forEach(function (other) {
      eq(other.body, shellSlices[0].body,
        'the reopen-1.0.0 hunk is NOT byte-identical between ' + shellSlices[0].name + ' and ' + other.name);
    });

    /* bumpsafe-1.1.0 (measured 2026-09-02 again, one build later, on the
       reopen-1.1.0 comment): the SAME drift class recurred because the 1.0.0
       check only looked at its own hunk. The rule is general and it is about
       ONE token: the 1p twins may name PAST builds in prose, but never the
       CURRENT one, because scripts/bump-build.js rewrites exactly that token
       and rewrites it in the derived shell alone. Checked against
       app-version.json, so it bites in the worktree before the bump runs. */
    const curTok = (function () {
      try { return String(JSON.parse(read('app-version.json')).build || '').match(/(b\d{3,5})$/)[1]; } catch (e) { return ''; }
    })();
    ok(!!curTok, 'app-version.json names the current build token (bumpsafe-1.1.0)');
    ['1pScribeFlow.html', '1p/index.html'].forEach(function (rel) {
      const re = new RegExp('(^|[^0-9a-zA-Z])' + curTok + '([^0-9a-zA-Z]|$)');
      eq(re.test(read(rel)), false,
        rel + ' carries the CURRENT build token ' + curTok + ' in prose - the next bump rewrites it in the derived shell only, which is derivation drift (bumpsafe-1.1.0)');
    });

    const FLOW_LANES = ['1p-feat_mls_writeflow.js', 'feat_mls_writeflow.js', 'cloned-feat_mls_writeflow.js'];
    const rowselSlices = [], regenSlices = [];
    FLOW_LANES.forEach(function (name) {
      const src = read(name);
      ok(src.indexOf('rowsel-1.0.0') > 0, name + ': the rowsel-1.0.0 lane is missing from this derived write flow');
      ok(src.indexOf('regenkeep-1.0.0') > 0, name + ': the regenkeep-1.0.0 lane is missing from this derived write flow');
      ok(src.indexOf("var ROWSEL_NOT_SELECTED = 'not selected';") > 0, name + ': the status word is no longer a shared constant');
      ok(src.indexOf("var ROWSEL_NOT_SELECTED_MSG = 'You left this section unchecked; nothing was sent for it.';") > 0,
        name + ': the unchecked-row sentence is no longer a shared constant');
      ok(src.indexOf("Not written &mdash; ' + missedRows.length + ' of ' + selectedRows.length") > 0,
        name + ': "Not written - N of M" no longer counts the CHECKED rows');
      rowselSlices.push({ name: name, body: slice(src, '  function receiptStateForRow(state, row) {', '  function renderUnifiedReceipts(state) {', name + ' rowState') });
      regenSlices.push({ name: name, body: slice(src, '  var regenKeepPending = null;', '  function unifiedCanonicalGenerationHtml(state) {', name + ' regenkeep') });
    });
    rowselSlices.slice(1).forEach(function (o) { eq(o.body, rowselSlices[0].body, 'the row-state reader drifted between ' + rowselSlices[0].name + ' and ' + o.name); });
    regenSlices.slice(1).forEach(function (o) { eq(o.body, regenSlices[0].body, 'the regenkeep carry-through drifted between ' + regenSlices[0].name + ' and ' + o.name); });

    /* the carry-through may only ever be consumed by openUnifiedConfirmation,
       and armed only by the regenerate - never by a click handler, a probe or
       an execute. */
    eq((FLOW.match(/regenKeepArm\(/g) || []).length, 2, 'the carry-through is armed from somewhere other than its own declaration and the regenerate');
    eq((FLOW.match(/regenKeepApply\(/g) || []).length, 2, 'the carry-through is applied from somewhere other than its own declaration and openUnifiedConfirmation');
    const REGEN_MOD = slice(FLOW, '  var regenKeepPending = null;', '  function unifiedCanonicalGenerationHtml(state) {', 'regenkeep module');
    eq(/executeUnifiedSelection\(|runUnifiedBatchSend\(|probeUnifiedRow\(|actionToken\s*[:=]|'mlsAppAthenaActionV2'/.test(REGEN_MOD), false,
      'THE CARRY-THROUGH REACHED FOR A WRITE, A PROBE OR A TOKEN - it may only copy a visit context forward');
    eq(/\.disabled\s*=/.test(REGEN_MOD), false, 'the carry-through enables or disables a control');
    ok(FLOW.indexOf('try { rebuilt = reopen(null); } finally { regenKeepDisarm(); }') > 0,
      'the carry-through is no longer one-shot: a rebuild that refuses or throws would leave a standing visit override armed');
  }

  console.log('sheet-rows-and-reopen-proof: ' + checks + ' checks passed');
})().catch(function (e) {
  console.error(e && e.stack || e);
  process.exit(1);
});
