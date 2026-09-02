'use strict';

/* wfnext-1.0.0 - ONE PRESS, ONE SECTION, SAID UP FRONT; AND NEVER A HANG.
 *
 * OWNER, 2026-09-01 23:05, verbatim: "nothing here should be blocked or manual
 * or not attempted once its run."
 *
 * WHAT WAS MEASURED that minute on his own tab (b1191, test patient Adam
 * #7833832, encounter 08-31). The Send-to-Athena sheet showed "Sections to
 * write (6)", all six checked, state READY. ONE trusted press of
 * #mlsAthenaUnifiedGo produced:
 *
 *     Reviewed HPI          -> VERIFIED (written and read back - correct)
 *     Review of Systems     -> BLOCKED "Click the matching Athena action
 *                              button again before continuing."
 *     Physical Exam         -> BLOCKED, the same sentence
 *     Assessment narrative  -> "checking Athena" for MORE THAN THREE MINUTES,
 *                              pill stuck on SENDING, footer offering only
 *                              "Close review" and a dead "Done"
 *
 * ...and the progress line froze on "1 written, 2 not sent, 3 still to go".
 *
 * WHY, EXACTLY - two separate faults, both proven here.
 *
 *   1. THE BLOCKED SECTIONS WERE THE SAFETY GATE DOING ITS JOB. MLS Assist
 *      mints the write authorization from one trusted click and CONSUMES IT ON
 *      THE FIRST EXECUTE; it expires 20 seconds later regardless. So one press
 *      could only ever authorize one write, and the queue was cheerfully
 *      issuing six. Nothing in this lane weakens that gate - the whole point is
 *      to stop asking it for writes nobody pressed for. On MLS Assist 3.0.108+
 *      the SAME trusted click may mint a batch authorization (an ordered list
 *      of preview hashes on the button, consumed one per execute), and the
 *      sheet's job is to put that list there BEFORE the click. On anything
 *      older the queue is handed exactly one section per press.
 *
 *   2. THE STALL WAS THE READ-ONLY STAGE, AND ITS BOUND WAS NEVER OBSERVED.
 *      The queue bounds that stage at 150s, but the probe ladder restarts its
 *      own generation on every auto-open hop, so neither settle latch can fire
 *      and the stage can only end by burning the whole ceiling - and the poll
 *      that watches the ceiling was itself a bare timer scheduled while the tab
 *      was still visible, which Chrome then clamped once the extension brought
 *      athenaOne forward (the probe asks it to). A 150-second bound was
 *      therefore observed as minutes. bxSleep now follows the tab instead of
 *      guessing at schedule time, and the stage retries once and then settles
 *      in the doctor's own words.
 *
 * WHAT THIS SUITE REFUSES TO LET DRIFT: the seven SHA-pinned write-path regions
 * (section 0), the fact that the sheet never self-arms the extension (section
 * 1), one-press-one-section with nothing pre-probed (section 3), the re-arm and
 * the accumulating receipt (section 4), the bounded no-hang settle (section 5),
 * and the batch lane's list being on the button before any click (section 6).
 *
 * Run:  node tests/write-next-press-proof.js
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
 * The write path, by SHA-256, exactly as tests/write-ui-proof.js does it: the
 * digests are NOT re-derived here. Each one must already be present in BOTH
 * tests/sheet-clarity.test.js and tests/write-auto-chain.test.js, so this suite
 * cannot bless a digest those two do not hold and a deliberate re-aim has to
 * move every file at once.
 *
 * wfnext-1.0.0 moved EXACTLY ONE of the seven - the batch queue - and it is the
 * sequencing region by its own name. The identity lock, the probe ladder, the
 * receipt mint, the execute and BOTH closed allowlists are byte-identical, and
 * that is the check that this was a change to WHICH ROWS A PRESS RUNS and not a
 * change to what a write is. */
const SHEET_CLARITY = read('tests/sheet-clarity.test.js');
const AUTO_CHAIN = read('tests/write-auto-chain.test.js');
const HEAD_REGIONS = [
  ['identity-lock (validatedUnifiedProbe: token + name/DOB/MRN + exact encounter)',
    '  function validatedUnifiedProbe(patient, probe) {', '  function renderUnifiedContext(state, lock) {'],
  ['probe ladder (probeUnifiedRow: every refusal, auto-open, day-mismatch gate)',
    '  function probeUnifiedRow(state, rowId) {', '  /* wfsum-1.0.0 (owner 2026-08-26, watching his own writes land while the sheet'],
  ['receipt mint (resultToUnifiedReceipt: verified / uncertain / halt)',
    '  function resultToUnifiedReceipt(state, row, resp, probe) {', '  /* ===== wfprog-1.0.0 (owner 2026-08-27:'],
  ['execute (executeUnifiedSelection: the only code that writes)',
    '  function executeUnifiedSelection(state) {', '  /* bx-1.0.0 - batch send (owner 2026-08-26:'],
  ['batch queue (runUnifiedBatchSend: per-row probe/execute/receipt sequencing)',
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
      'tests/sheet-clarity.test.js does not carry this region\'s current digest - the write path changed without a reviewed re-aim: ' + name);
    ok(AUTO_CHAIN.indexOf(got) > 0,
      'tests/write-auto-chain.test.js does not carry this region\'s current digest - the pins have drifted apart: ' + name);
  });
  /* and the closed allowlists still say exactly what they say */
  ok(FLOW.indexOf('var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };') > 0,
    'the executable-action allowlist was rewritten');
  ok(FLOW.indexOf('var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };') > 0,
    'the batch lane\'s CLOSED two-action allowlist was rewritten');
}

/* ============================ 1. THE SHEET NEVER ARMS THE EXTENSION ITSELF ==
 * The one thing that would have made this easy and must never be done: MLS
 * Assist exposes a page-callable remote arm (the phone-confirmed write lane).
 * Calling it from the sheet would end the trusted-click requirement for every
 * Athena note write. The write flow does not know that verb exists, and the
 * extension's own single-use consume and its refusal sentence are still there.
 */
{
  ok(FLOW.indexOf('mlsAppAthenaRemoteArmV1') < 0,
    'THE SHEET CAN NOW ARM THE EXTENSION WITHOUT A HUMAN CLICK - that is the trusted-click gate, deleted');
  ok(FLOW.indexOf('isTrusted') < 0,
    'the write flow is reasoning about event trust itself - the arm is the extension\'s to mint, never the page\'s');
  const CONTENT = read('content.js');
  ok(CONTENT.indexOf("error: 'Click the matching Athena action button again before continuing.'") > 0,
    'the extension lost the refusal that IS the click gate');
  ok(CONTENT.indexOf('_mlsAthenaActionGesture = { action: \'\', until: 0, serial: \'\', previewHash: \'\', rowHash: \'\', clientOrderId: \'\' }') > 0,
    'the extension no longer clears the arm - the single-use property is gone');
  /* the module reads a capability and paints attributes; it does not send */
  const MOD = FLOW.slice(FLOW.indexOf('/* ===== wfnext-1.0.0'), FLOW.indexOf('/* ===== end wfnext-1.0.0'));
  ok(MOD.length > 3000, 'the wfnext-1.0.0 module is not where this suite expects it');
  /* call-shaped, so the module's own prose may NAME the write path it promises
     not to touch without that reading as touching it */
  eq(/executeUnifiedSelection\(|runUnifiedBatchSend\(|probeUnifiedRow\(|actionToken\s*[:=]|'mlsAppAthenaActionV2'/.test(MOD), false,
    'THE UP-FRONT/LABEL MODULE REACHED FOR A WRITE, A PROBE OR A TOKEN - it may only read the checked set and paint');
  eq((MOD.match(/bridge\(/g) || []).length, 1, 'the module talks to the bridge for something other than its one read-only capability ping');
  ok(MOD.indexOf("bridge('mlsPing', null, 'mlsPong', 3500)") > 0, 'the capability probe is not the read-only ping');
  eq(/\.disabled\s*=/.test(MOD), false, 'the module enables or disables Confirm - only unifiedPrimaryPlan / unifiedSyncPrimaryButton may');
  /* the queue is fed by the authorization, and the batch attributes are painted
     from a sync, never from inside a click handler */
  const QUEUE = FLOW.slice(FLOW.indexOf('  function runUnifiedBatchSend(state, btn) {'), FLOW.indexOf('  function reopenOptions(opts, manifest) {'));
  ok(QUEUE.indexOf('var rows = wfnextQueueRows(state);') > 0, 'the queue no longer runs the rows THIS press authorized');
  ok(QUEUE.indexOf('probeUnifiedRow(state, row.id);') > 0, 'the queue no longer runs the per-row read-only check');
  ok(QUEUE.indexOf('executeUnifiedSelection(state);') > 0, 'the queue no longer runs the per-row execute');
  ok(QUEUE.indexOf("stopMsg = 'Halted on an uncertain outcome") > 0, 'the queue no longer halts on an uncertain outcome');
  ok(QUEUE.indexOf('150000') > 0 && QUEUE.indexOf('180000') > 0, 'the queue lost one of its two bounds');
  const CLICK = FLOW.slice(FLOW.indexOf("go.addEventListener('click'"), FLOW.indexOf("go.addEventListener('click'") + 200);
  eq(/wfnextPaintPrimary|data-mls-batch/.test(CLICK), false,
    'the batch list is being set from the click handler - it must already be on the button when the trusted click lands');

  /* THE POLL THAT WATCHES THE BOUND. The stall was not the ceiling; it was that
     nothing checked the ceiling on time. bxSleep used to hand the WHOLE
     remaining wait to a bare setTimeout whenever the tab happened to be visible
     at schedule time - and the read-only probe hides this tab a moment later by
     design (foregroundOk), so Chrome clamped exactly the timer the bound
     depended on. It must now follow the tab, and it must re-check the clock in
     short steps so a single clamp can cost at most one tick. The hidden-tab
     half of this behaviour is proven at runtime by tests/write-generality.test.js. */
  const SLEEP = FLOW.slice(FLOW.indexOf('  function bxSleep(ms) {'), FLOW.indexOf('  function wfPaceThen(ms, fn) {'));
  ok(SLEEP.length > 600, 'the hidden-safe sleep is not where this suite expects it');
  ok(SLEEP.indexOf('MessageChannel') > 0, 'bxSleep lost its hidden-tab MessageChannel yield');
  ok(SLEEP.indexOf("document.addEventListener('visibilitychange'") > 0,
    'BXSLEEP NO LONGER FOLLOWS THE TAB - a wait scheduled while visible and clamped once hidden is the measured three-minute stall');
  ok(SLEEP.indexOf('BXSLEEP_VISIBLE_TICK_MS') > 0, 'the visible poll no longer re-checks the clock in bounded steps');
  ok(/var BXSLEEP_VISIBLE_TICK_MS = (\d{1,3});/.test(FLOW),
    'the visible tick is no longer a small bounded number, so one clamp can swallow a whole bound again');
  eq(SLEEP.indexOf('if (typeof document === \'undefined\' || !document.hidden) { setTimeout(resolve,'), -1,
    'the one-shot bare timer that caused the stall is back in bxSleep');
}

/* ------------------------------------------------------------------ fixtures */
const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-next', patientId: 'syn-next', name: 'Synthetic Patient Next', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-next', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const SECTIONS = [
  { key: 'hpi', text: 'Synthetic HPI body for the write-next-press proof.' },
  { key: 'ros', text: 'Synthetic ROS body for the write-next-press proof.' },
  { key: 'exam', text: 'Synthetic exam body for the write-next-press proof.' }
];
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ------------------------------------------------------------------ DOM shim
 * The same shape tests/1p-writeflow-sheet-ux.test.js proved this renderer
 * against: the include checkboxes are parsed out of the markup the renderer
 * actually emitted, so "checked" here means the shipped markup. */
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
  /* the sheet paints its up-front sentence into a node it rendered as markup;
     the shim resolves it the same way the browser's querySelector would */
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

/* --------------------------------------------------- fake MLS Assist + clock
 * `batchArm` decides which extension this harness pretends to be. `deadSection`
 * names a row whose read-only probe is NEVER answered and whose bridge deadline
 * never fires either - the exact shape of the stage that stalled live: nothing
 * settles it, so only the queue's own bound can end it. The clock advances by
 * the delay of every timer this shim actually runs, so a 150-second ceiling is
 * reached in real milliseconds. */
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
      return { ok: true, mode: 'execute', action: m.action, attempted: true, verified: true, written: true,
        noteWriteProof: 'proof-' + ENCOUNTER, noteWriteProofExpiresAt: FakeDate.now() + 600000, context: clone(CONTEXT) };
    }
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
      rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(CONTEXT) };
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsPing') {
      if (!options.batchArm) return;
      return deliverRaw({ source: 'mls-ext', type: 'mlsPong', requestId: m.requestId, version: '3.0.108',
        buildId: '3.0.108', batchArm: '1.0.0',
        capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true, batchArmV1: true } });
    }
    if (m.type === 'mlsAppAthenaActionV2') {
      /* the measured stall: this row's read-only check is never answered by
         anything - not the extension, not a deadline. Only the bound can end
         it, which is precisely what must not take three minutes on screen. */
      if (options.deadSection && m.mode === 'probe' && Array.isArray(m.sections) && m.sections.some(s => s && s.key === options.deadSection)) return;
      return deliver('mlsAppAthenaActionV2Result', m.requestId, defaultAction(m));
    }
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: options.batchArm ? '3.0.108' : '3.0.84', versionName: 'x', athena: { tabs: 1, discarded: 0 } });
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
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });
  return {
    window, document: dom.document, el: dom.resolve, boxes: dom.boxes, cardHtml: dom.cardHtml,
    planText: () => dom.planNode.textContent, posted,
    wf: window.__mlsWriteFlow,
    next: () => window.__mlsWriteFlow.diagnostics.wfnext,
    arms: () => posted.filter(m => m.type === 'mlsAppAthenaRemoteArmV1'),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    probes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe'),
    sectionsOf: list => list.map(m => (Array.isArray(m.sections) && m.sections[0] ? m.sections[0].key : ''))
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }
/* wfdone-1.0.0: the DOM shim's checkboxes expose `handlers` but no
   dispatchEvent, so this is how the doctor's own tick reaches the SHIPPED
   change handler (unifiedSyncFromIncludeCheckbox) rather than a test calling it
   directly. */
function fireChange(box) { ((box.handlers && box.handlers.change) || []).forEach(function (fn) { fn({ target: box }); }); }

(async function run() {

  /* ============== 2. SAID UP FRONT, BEFORE THE DOCTOR PRESSES ANYTHING =====
   * "6 sections checked - each needs its own Confirm press" is not a consolation
   * message after the fact; it is on the sheet before the first press, and the
   * button names which section that press writes. */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: BOUND, receiptSessionId: 'next-upfront' });
    await settle(120);
    eq(manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready').length, 3, 'the fixture did not produce three READY note rows');
    eq(h.boxes().length, 3, 'the shipped markup did not carry one include checkbox per READY note row');

    eq(h.planText(),
      '3 sections checked - each needs its own Confirm press; MLS writes them one at a time and asks you before each.',
      'the up-front sentence does not say how many presses this will cost, in plain words, before the first one');
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.textContent, 'Confirm & write 1 of 3: HPI', 'the primary button does not name which section this press writes');
    eq(go.disabled, false, 'the primary button stayed grayed after the opening read-only check verified');
    eq(go.getAttribute('data-mls-batch-count'), null,
      'the sheet promised a batch to an extension that never said it could take one');
    eq(h.next().batchArmReady(), false, 'the harness pretended to be a batch-arm extension when it answered no pong');
  }

  /* ==================== 3. ONE PRESS WRITES EXACTLY ONE SECTION ============
   * ...and nothing at all is dispatched for the sections nobody pressed for.
   * That is what makes "BLOCKED - click again" impossible as the result of a
   * single press: MLS never asks the gate for a write it was not authorized to
   * make. */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: BOUND, receiptSessionId: 'next-one' });
    await settle(120);
    const go = h.el('mlsAthenaUnifiedGo');

    go.click();
    await settle(600);

    eq(h.executes().length, 1, 'ONE press wrote more than one section - the gate can only authorize one');
    eq(h.sectionsOf(h.executes())[0], 'hpi', 'the press did not write the section the button named');
    eq(h.sectionsOf(h.probes()).filter(k => k === 'ros').length, 0,
      'a section nobody pressed for was PROBED - a queue may not pre-check work it has no authorization to do');
    eq(h.sectionsOf(h.probes()).filter(k => k === 'exam').length, 0, 'a second unpressed section was probed');
    eq(h.executes().filter(m => (m.sections || []).some(s => s.key !== 'hpi')).length, 0, 'an unpressed section was written');
    eq(h.arms().length, 0, 'the sheet armed the extension itself instead of letting the doctor\'s click do it');

    /* ...and the sheet stayed open, re-armed, and named the next press */
    eq(go.textContent, 'Confirm & write 2 of 3: Review of Systems',
      'the button did not re-arm for the next section after a verified landing');
    eq(h.planText(),
      '3 sections checked - each needs its own Confirm press; MLS writes them one at a time and asks you before each. 1 of 3 already landed.',
      'the up-front sentence does not carry the honest landed count');
    eq(go.disabled, false, 'the sheet did not re-arm - the doctor cannot continue from inside it');
    eq(go.getAttribute('data-mls-athena-action'), 'write_note', 'the extension binding for the next press is missing from the button');
    eq(go.getAttribute('aria-label'), 'Confirm write reviewed note',
      'the button lost the exact label MLS Assist arms from - the next press would authorize nothing');
    const st = h.wf.diagnostics.state();
    eq(st.closed, false, 'the sheet closed itself instead of staying open');
    eq(h.next().remainingRows().map(r => r.id).length, 2, 'the remaining list is wrong after one landing');
    /* the word above it stays honest: a sheet part-way through is PARTLY DONE,
       never READY - only a bound validated probe may paint READY - and the
       sentence under it names the doctor's next press. */
    const pill = h.wf.diagnostics.sheetClarity.stateFor('');
    eq(pill.label, 'PARTLY DONE', 'the pill claimed a state the sheet has not re-earned');
    ok(pill.short.indexOf('Press Confirm to write 2 of 3: Review of Systems') > 0,
      'the state sentence does not name what the next press does');
    ok(pill.short.indexOf('Nothing runs for it until you do') > 0,
      'the state sentence does not say that nothing is attempted until he presses');
  }

  /* ================== 4. PRESS BY PRESS TO DONE, RECEIPT ACCUMULATING ======
   * Three presses, three sections, one sheet. Nothing is ever reported blocked
   * or not attempted, and the receipt of what landed grows across presses
   * instead of being rebuilt. */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: BOUND, receiptSessionId: 'next-done' });
    await settle(120);
    const go = h.el('mlsAthenaUnifiedGo');

    const wrote = [];
    for (let press = 1; press <= 3; press++) {
      go.click();
      await settle(600);
      wrote.push(h.executes().length);
    }
    assert.deepStrictEqual(wrote, [1, 2, 3], 'each press must write exactly one more section');
    checks++;
    assert.deepStrictEqual(h.sectionsOf(h.executes()), ['hpi', 'ros', 'exam'],
      'the sections were not written in the order the sheet promised');
    checks++;

    const st = h.wf.diagnostics.state();
    const verified = Object.keys(st.receipts).filter(k => st.receipts[k].status === 'verified');
    eq(verified.length, 3, 'three presses did not leave three verified receipts');
    eq(h.next().remainingRows().length, 0, 'the sheet still thinks something is left to write');
    eq(h.planText(), 'All 3 checked sections are in Athena and verified. Save and Sign stay yours in athenaOne.',
      'done does not say done');
    eq(h.wf.diagnostics.sheetClarity.stateFor('').label, 'DONE', 'the pill does not say DONE when everything landed');
    eq(go.disabled, true, 'the primary button is still live with nothing left to send');
    eq(go.textContent, 'Nothing left to send', 'the footer does not say there is nothing left');

    /* the receipt is one accumulating record inside the same sheet */
    const receipt = h.el('mlsAthenaUnifiedReceipt').innerHTML;
    ok(receipt.indexOf('Everything on this review is in Athena') > 0, 'the receipt lost its one glanceable answer');
    ['HPI', 'Review of Systems', 'Physical Exam'].forEach(function (name) {
      ok(receipt.indexOf(name) > 0, 'the accumulated receipt does not name what landed: ' + name);
    });
    eq(receipt.indexOf('not attempted'), -1, 'a section that was written is still reported NOT ATTEMPTED');
    eq(h.arms().length, 0, 'the sheet armed the extension itself at some point during the run');
  }

  /* ===== 4b. EVERYTHING CHECKED IS WRITTEN, BUT NOT EVERYTHING IS CHECKED ==
   * wfdone-1.0.0, measured 2026-09-02 by adversarial replay of the one-press
   * lane. Section 4 above only ever exercised the case where EVERY note row is
   * checked, and there the green completion banner relabels and kills the
   * button. Leave one row unchecked - which is exactly what the doctor does
   * with an A/P row that cannot bind - and that banner never fires, because it
   * requires every write_note row in the manifest to be in Athena. finish()
   * then restored the label the button carried at press time and
   * unifiedSyncPrimaryButton re-ENABLED it, because the plan still read the
   * checked set without excluding rows that had already landed. The result was
   * a live button reading "Confirm & write 2 of 2: Physical Exam" three inches
   * under "All 2 checked sections are in Athena and verified", and pressing it
   * was refused with "Check at least one READY note section" - which was false.
   * The PLAN decides this, not the painter, and it is reversible. */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: BOUND, receiptSessionId: 'next-partial' });
    await settle(160);
    const go = h.el('mlsAthenaUnifiedGo'), boxes = h.boxes();
    eq(boxes.length, 3, 'the fixture did not render one include checkbox per READY note row');

    /* he unticks the middle section and presses until nothing is left */
    boxes[1].checked = false; fireChange(boxes[1]);
    await settle(60);
    for (let p = 1; p <= 3 && !go.disabled; p++) { go.click(); await settle(700); }

    eq(h.executes().length, 2, 'the two checked sections did not both land');
    eq(go.disabled, true, 'THE MEASURED DEFECT: every checked section landed and the primary button is still live');
    eq(go.textContent, 'Nothing left to send', 'THE MEASURED DEFECT: the button still names a write that cannot happen');
    const plan = h.wf.diagnostics.sheetUx.plan(h.wf.diagnostics.state());
    eq(plan.mode, 'none', 'the plan still claims a batch to send when every checked section is verified');
    eq(go.getAttribute('data-mls-primary-blocked'), plan.reason, 'the dead button does not carry the plan\'s own reason');
    eq(h.planText(), 'All 2 checked sections are in Athena and verified. Save and Sign stay yours in athenaOne.',
      'the up-front line and the button no longer agree');
    eq(h.el('mlsAthenaUnifiedReceipt').innerHTML.indexOf('Everything on this review is in Athena'), -1,
      'the green banner fired with a note row still not in Athena');

    /* reversible - the doctor may still change his mind */
    boxes[1].checked = true; fireChange(boxes[1]);
    await settle(60);
    eq(go.disabled, false, 're-checking a section left the button dead');
    eq(go.textContent, 'Confirm & write 3 of 3: Review of Systems',
      'the revived button does not name the section the next press writes');
    go.click();
    await settle(900);
    eq(h.executes().length, 3, 'the re-checked section was not written by its own press');
    eq(go.disabled, true, 'the finished sheet left the button live again');
    eq(go.textContent, 'Nothing left to send', 'the finished sheet does not say there is nothing left');
  }

  /* ================== 5. A SECTION THAT NEVER ANSWERS SETTLES, AND RE-ARMS ==
   * The measured hang: a read-only stage nothing will ever settle. The queue
   * retries it once, then says so in the doctor's words and gives him the
   * button back. It never sits on "checking Athena" with the pill on SENDING. */
  {
    const h = makeHarness({ deadSection: 'hpi' });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: BOUND, receiptSessionId: 'next-dead' });
    await settle(200);
    const go = h.el('mlsAthenaUnifiedGo');
    /* the opening probe for HPI is one of the ones that never answers, so the
       queue is reached through the batch plan rather than a validated single.
       Count from HERE, so "it retried" cannot be satisfied by the sheet's own
       opening check - the exact way this assertion could pass vacuously. */
    const before = h.probes().length;
    go.click();
    await settle(9000);
    /* the literal, not the module's own constant - a pin that reads the number
       it is checking cannot fail when that number changes */
    eq(h.probes().length - before, 2,
      'the stalled read-only stage did not make exactly TWO bounded attempts inside the one run - one try is a dead end, three is a retry loop');
    eq(h.next().checkTries, 2, 'the retry budget drifted from the one attempt-plus-one this suite pins');

    const st = h.wf.diagnostics.state();
    eq(st.batchRunning, false, 'THE QUEUE IS STILL RUNNING - this is the three-minute stall, unfixed');
    eq(st.running, false, 'the sheet is still marked as writing with nothing in flight');
    eq(h.executes().length, 0, 'a section whose read-only check never answered was WRITTEN');
    eq(h.sectionsOf(h.probes()).filter(k => k !== 'hpi').length, 0,
      'the stalled run reached for a section nobody pressed for');
    const status = h.el('mlsAthenaUnifiedProbe').textContent;
    ok(status.indexOf(h.next().checkTimeoutMsg) > 0,
      'the settled section does not say, in the doctor\'s words, that it did not answer and can be pressed again');
    eq(h.next().checkTimeoutMsg,
      'One section did not answer in time, twice - press Confirm again to retry it. Nothing was written for it.',
      'the timeout wording drifted from the sentence this suite pins');
    /* and the pill is off SENDING with the button live again */
    eq(h.wf.diagnostics.sheetClarity.stateFor('err').label === 'SENDING', false,
      'the pill is stuck on SENDING after the queue settled');
    eq(go.disabled, false, 'the doctor cannot press again - the sheet has dead-ended');
    eq(go.textContent, 'Confirm & write 1 of 3: HPI', 'the button did not re-arm for a retry of the same section');
  }

  /* ============ 6. THE BATCH LANE: THE LIST IS ON THE BUTTON BEFORE A CLICK ==
   * On MLS Assist 3.0.108+ one press writes every checked section, because the
   * SAME trusted click mints an ordered authorization. The extension's own
   * precondition is that the list is well formed and begins with the button's
   * own preview hash, so that is what is asserted here - on the button, before
   * anything is pressed. */
  {
    const h = makeHarness({ batchArm: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: BOUND, receiptSessionId: 'next-batch' });
    await settle(150);
    const go = h.el('mlsAthenaUnifiedGo');

    eq(h.next().batchArmReady(), true, 'the sheet did not hear the extension advertise batchArm');
    eq(h.planText(), '3 sections checked - one press writes all 3, one at a time, each read back before the next.',
      'the batch lane does not promise what it can actually keep');
    eq(go.textContent, 'Confirm & write all 3, starting with HPI', 'the batch lane\'s button does not say what one press does');

    const count = go.getAttribute('data-mls-batch-count');
    const hashes = String(go.getAttribute('data-mls-batch-hashes') || '').split(',');
    eq(count, '3', 'the ordered authorization is not on the button before the click');
    eq(hashes.length, 3, 'the hash list does not carry one entry per section this press will run');
    eq(hashes[0], go.getAttribute('data-mls-preview-hash'),
      'the list does not begin with the button\'s own preview hash - MLS Assist would refuse to mint the batch');
    ok(hashes.every(x => x.length >= 8 && x.indexOf(',') < 0), 'a hash on the list cannot survive the extension\'s own parse');
    ok(Number(count) >= 2 && Number(count) <= h.next().maxBatch, 'the count is outside the extension\'s accepted range');

    go.click();
    await settle(1400);
    eq(h.executes().length, 3, 'the batch lane did not write every checked section from one press');
    assert.deepStrictEqual(h.sectionsOf(h.executes()), ['hpi', 'ros', 'exam'], 'the batch ran the sections out of order');
    checks++;
    eq(h.arms().length, 0, 'the sheet self-armed instead of letting the one trusted click authorize the batch');
    /* every execute still carries exactly one section and its own probe */
    h.executes().forEach(function (m) {
      eq((m.sections || []).filter(s => s.execute === true).length, 1,
        'an execute carried more than one section - the driver takes exactly one per write');
    });
    eq(h.next().remainingRows().length, 0, 'the batch lane left work behind');
    eq(h.planText(), 'All 3 checked sections are in Athena and verified. Save and Sign stay yours in athenaOne.',
      'the batch lane does not say done when it is done');
  }

  /* ===== 7. THE SPENT OR EXPIRED WRITE ARM IS SAID IN WORDS THAT WORK ======
   * wfarm-1.0.0. Section 1 above pins that the extension still owns the trusted
   * click and still refuses a spent arm with its own sentence, "Click the
   * matching Athena action button again before continuing." The defect was that
   * the SHEET printed that sentence: 'fresh-trusted-click-required' was in
   * WFDX_KNOWN_REASONS but had no WFCLAR entry, so resultToUnifiedReceipt fell
   * through to the raw string. Following it reproduces the refusal - the button
   * he is told to press again is the one he just pressed - which is exactly
   * what the owner reported at 22:50 on 2026-09-01 for sections 2 and 3.
   * Exercised through the SHIPPED seam, not a copy of the table. */
  {
    const CODE = 'fresh-trusted-click-required';
    const seam = makeHarness({}).wf.diagnostics;
    eq(seam.reason(CODE), CODE,
      'wfdxReason folds the spent-arm refusal to unlisted, so every receipt and clarity lookup loses it');
    const clar = seam.clarity.classify(CODE);
    ok(clar && clar.fix === true,
      'the spent-arm refusal has no clarity entry - it keeps the extension raw sentence that reproduces the failure');
    eq(!!clar.open, false, 'the spent-arm refusal was given the read-only open ladder - there is nothing to navigate');
    eq(!!clar.copy, false,
      'the spent-arm refusal offers a copy button that can never render - wfClarityRefusal is on the probe path and this code is execute-only');

    const say = seam.clarity.say(clar, { destination: 'Athena encounter > HPI', label: 'Write reviewed HPI' });
    ok(/Nothing was changed and nothing was sent\.$/.test(say), 'the sentence does not end in the no-change guarantee');
    eq(/Click the matching Athena action button/.test(say), false,
      'THE MEASURED DEFECT: the sheet still prints the extension instruction that reproduces the refusal');
    ok(say.indexOf('Check Athena again') > 0, 'the sentence does not name the control that re-binds the section');
    ok(/spent or had timed out/.test(say), 'the sentence does not say what actually happened');
    eq(/Pressing Confirm again on its own refuses the same way/.test(say), true,
      'the sentence does not warn him off the one move that loops');

    /* the three closed sets stay clean: a spent arm is not a surface that will
       change on its own, so nothing may put it into an automatic ladder */
    eq(seam.autoChain.retryable[CODE], undefined, 'the spent-arm refusal is on the automatic re-check allowlist - that is a loop');
    eq(seam.autoChain.painting[CODE], undefined, 'the spent-arm refusal is on the "still painting" set - the surface is not painting');
    eq(seam.autoChain.positive[CODE], undefined, 'the spent-arm refusal latches the whole sheet out of automatic re-checking');
    ok(FLOW.indexOf("var AUTO_OPEN_REASONS = { 'context-unverified': 1, 'context-mismatch': 1 };") > 0,
      'the auto-open allowlist was rewritten - a spent arm must never drive athenaOne navigation');
  }

  console.log('PASS write-next-press-proof: ' + checks + ' checks - the seven write-path regions are byte-identical to the digests sheet-clarity and write-auto-chain both carry; the sheet never arms MLS Assist itself; the number of checked sections and the cost in presses are stated before the first press; one press writes exactly one section and neither probes nor writes anything for a section nobody pressed for; the sheet stays open, re-arms with the next section named, accumulates one receipt and reaches DONE; a read-only stage nothing will settle is retried once and then settled in the doctor\'s words with the button live again; and on an extension that can take a batch authorization the ordered list is on the button before the trusted click and one press writes all of them, one section per execute; with a section left unchecked the finished sheet kills its own button from the PLAN and says "Nothing left to send" instead of naming a write that would be refused, and re-ticking that section revives it; and the spent or expired write arm is said in words that name the fresh-check step instead of the extension instruction that reproduces it');
})().catch(err => { console.error('FAIL: ' + (err && err.message ? err.message : err)); process.exit(1); });
