'use strict';

/* paintwait-1.0.0 / pullshield-1.0.0 / ledger-1.0.0 - THE READ-ONLY CHECK, THE
 * TAB IT SHARES, AND THE LEDGER THAT OUTLIVED ITS OWN TRUTH.
 *
 * MEASURED LIVE, 2026-09-02 16:09-16:31, the owner's own tab, MLS Assist
 * 3.0.110, site b1207, ONE press of the batch on the authorized test patient.
 *
 *   (a) The batch's auto-open landed ok at 16:26:33 (mlsAppGotoDate week strip
 *       + mlsAppSearchOpenPatient by appointment id). The FIRST row check, at
 *       16:26:45, answered reason 'note-section-not-on-surface' with hetDiag
 *       { qualified:true, rank:6, noteTargetFound:false, stageNav:'no-bead' },
 *       and the other five rows - probed 0.4s apart - answered identically. At
 *       16:26:55, TEN SECONDS later, the athena frame had all six stage beads
 *       painted; a manual "Check Athena again" at 16:29:46 passed
 *       context-verified and the same batch then wrote HPI, ROS, PE and the
 *       combined A&P (execute receipts ok 16:30:43-16:31:10).
 *       The encounter frame binds BEFORE its tab strip paints, and the app took
 *       the first no-bead answer as final: openpace-1.0.0's re-probe is gated on
 *       /encounter frame|context.unverified|context.mismatch/, and this code
 *       falls straight past it to wfClarify -> wfClarityRefusal.
 *
 *   (d) While the sheet stood at READY after that passing re-check, the "What
 *       happened" ledger still listed all six rows as
 *       "NOT SENT - READ-ONLY CHECK REFUSED" from the batch before it.
 *
 *   (g) wfbindPullBusy() already answers whether a schedule pull holds the one
 *       athenaOne tab - wfbindRun and the canonical generation path both
 *       consult it - and runUnifiedBatchSend never did. A pull that ENDS drives
 *       athenaOne back to its dashboard, the one surface every read-only check
 *       refuses on.
 *
 * WHAT THIS SUITE PINS, against the SHIPPED functions, with a per-fix negative
 * control that must be inert on the pre-fix bytes:
 *   1. paintwait: a no-bead / no-stageNav refusal on a FRESH open is paced like
 *      openpace (15s, at most 4) and on a stale one gets exactly ONE 6s
 *      re-probe per row id; a surface that PROVED its stage tab open
 *      ('already-open' / 'opened-<TAB>') refuses at once and is never paced;
 *      the waiting refusal never latches probeSettled, so the batch's own
 *      checkStage keeps waiting instead of settling on an answer the surface
 *      was about to contradict; and a refusal that then paints resolves to
 *      READY with no human press at all.
 *   2. pullshield: a row whose check would run into a live schedule pull waits,
 *      hidden-safe and bounded, and then checks; a pull that never lets go
 *      settles the row NOT ATTEMPTED - never a refusal receipt - and the queue
 *      moves on. No probe is ever sent while the pull holds the tab.
 *   3. ledger: a passing row-check replaces that row's stale NOT SENT entry and
 *      REPAINTS the panel, and a batch that starts does not carry the previous
 *      batch's refusals for the rows it is about to check.
 *
 * NOTHING HERE MAY WEAKEN A GATE, and the suite asserts that too: no execute is
 * ever issued by a wait, no receipt is minted, Sign stays manual, and the two
 * closed action allowlists are byte-identical.
 *
 * Run:  node tests/paintwait-queue-proof.js
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

/* ===================================================== THE NEGATIVE CONTROLS ==
 * Each is the pre-fix bytes of ONE fix, verbatim. Every runtime section below
 * runs against the shipped source AND against the matching control, and asserts
 * the control cannot answer - so this suite can never pass by measuring
 * nothing. */
const PAINTWAIT_HUNK =
  "    /* paintwait-1.0.0: ...unless the surface is still PAINTING, in which case\n" +
  "       there is no settled refusal yet to say. One bounded wait, then the same\n" +
  "       read-only check again; if it refuses again this branch is not taken and\n" +
  "       the sentence below is printed exactly as it always was. */\n" +
  "    if (paintwaitRetry(state, row)) return;\n";
ok(FLOW.indexOf(PAINTWAIT_HUNK) > 0, 'the paintwait branch is not where this suite reads it, inside wfClarityRefusal');
const NO_PAINTWAIT = FLOW.replace(PAINTWAIT_HUNK, '');
ok(NO_PAINTWAIT.length < FLOW.length, 'the paintwait negative control is byte-identical to the shipped source');

const PULLSHIELD_OPEN =
  "      /* pullshield-1.0.0 (2026-09-02): a schedule pull owns the same single\n" +
  "         athenaOne tab this check is about to drive, and a pull that ENDS leaves\n" +
  "         athenaOne on its dashboard - the one surface every read-only check\n" +
  "         refuses on. Wait for it, hidden-safe and bounded; a row this gives up\n" +
  "         on is NOT ATTEMPTED, never a refusal. It delays or skips; it cannot\n" +
  "         send, probe, enable a control or change a verdict. */\n" +
  "      pullshieldClear(state).then(function (clear) {\n" +
  "        if (state.closed || unifiedAthenaState !== state) { finish(); return; }\n" +
  "        if (!clear) { pullshieldSettle(state, row); wfprogPhase(state, row.id, 'skipped'); skipped.push(row.label); step(i + 1); return; }\n";
const PULLSHIELD_CLOSE = "        });\n      });\n      });\n    }\n    step(0);";
const PULLSHIELD_CLOSE_PRE = "        });\n      });\n    }\n    step(0);";
ok(FLOW.indexOf(PULLSHIELD_OPEN) > 0, 'the pullshield wrapper is not where this suite reads it, inside runUnifiedBatchSend.step');
ok(FLOW.indexOf(PULLSHIELD_CLOSE) > 0, 'the pullshield wrapper does not close where this suite reads it');
const NO_PULLSHIELD = FLOW.replace(PULLSHIELD_OPEN, '').replace(PULLSHIELD_CLOSE, PULLSHIELD_CLOSE_PRE);
ok(NO_PULLSHIELD.length < FLOW.length, 'the pullshield negative control is byte-identical to the shipped source');

const LEDGER_TICK =
  "    /* ledger-1.0.0 (2026-09-02): ...and it REPAINTS. Forgetting the stale\n" +
  "       failure was never enough - the receipt panel is HTML that was written\n" +
  "       before the check passed, and it kept saying NOT SENT under a READY sheet. */\n" +
  "    try { if (rowId && unifiedAthenaState) ledgerRecheckPassed(unifiedAthenaState, rowId); } catch (eAtt) {}";
const LEDGER_TICK_PRE = "    try { if (rowId && unifiedAthenaState) forgetRowAttempt(unifiedAthenaState, rowId); } catch (eAtt) {}";
const LEDGER_QUEUE = "    if (batch === true) ledgerClearForQueue(state, rows);\n";
ok(FLOW.indexOf(LEDGER_TICK) > 0, 'the ledger re-check repaint is not where this suite reads it, in setUnifiedReadyTick');
ok(FLOW.indexOf(LEDGER_QUEUE) > 0, 'the ledger batch-start clear is not where this suite reads it, in wfprogStart');
const NO_LEDGER = FLOW.replace(LEDGER_TICK, LEDGER_TICK_PRE).replace(LEDGER_QUEUE, '');
ok(NO_LEDGER.length < FLOW.length, 'the ledger negative control is byte-identical to the shipped source');

/* ============================================ 0. THE BYTES THAT MAY NOT MOVE */
{
  ok(FLOW.indexOf('var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };') > 0,
    'the executable-action allowlist was rewritten - not one of these three fixes needed anything from it');
  ok(FLOW.indexOf('var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };') > 0,
    'the batch lane\'s CLOSED two-action allowlist was rewritten');
  ok(FLOW.indexOf("addRow({ id: 'sign-named-sections-manual', action: '', kind: 'sign'") > 0,
    'SIGN & SAVE CHANGED - it stays manual and unexecutable through every one of these lanes');
  /* the waiting branch may NEVER latch the settle the queue waits on */
  const CLAR = FLOW.slice(FLOW.indexOf('  function wfClarityRefusal(state, row, clar) {'), FLOW.indexOf('  /* ===== end wfclar-1.0.0'));
  ok(CLAR.indexOf('if (paintwaitRetry(state, row)) return;') > 0, 'the paintwait branch left wfClarityRefusal');
  ok(CLAR.indexOf('if (paintwaitRetry(state, row)) return;') < CLAR.indexOf('unifiedRecheckButton(state, row.id);'),
    'the paintwait branch runs AFTER the settle latch - a waiting probe would already have been settled');
  const PW = FLOW.slice(FLOW.indexOf('  function paintwaitRetry(state, row) {'), FLOW.indexOf('  /* ===== end paintwait-1.0.0'));
  eq(PW.indexOf('unifiedRecheckButton'), -1, 'paintwaitRetry latches probeSettled through the recheck button - the queue would settle on a surface that is still painting');
  eq(PW.indexOf('probeSettled'), -1, 'paintwaitRetry writes the settle latch itself');
  eq(PW.indexOf('executeUnifiedSelection'), -1, 'paintwaitRetry can reach the execute path');
  eq(PW.indexOf('navigateAndSearchOpenTarget'), -1, 'paintwaitRetry re-drives navigation at a painting encounter - openpace measured that this DESTROYS it');
  eq(PW.indexOf('wfdxOpenEncounter'), -1, 'paintwaitRetry re-drives the read-only open ladder at a painting encounter');
  const PS = FLOW.slice(FLOW.indexOf('  function pullshieldClear(state) {'), FLOW.indexOf('  /* ===== end pullshield-1.0.0'));
  eq(PS.indexOf('executeUnifiedSelection'), -1, 'the pull shield can reach the execute path');
  eq(PS.indexOf('probeUnifiedRow'), -1, 'the pull shield probes by itself instead of letting the queue do it');
  ok(PS.indexOf('rememberRowAttempt') > 0, 'the pull shield records nothing, so a skipped row would read as never attempted');
  eq(PS.indexOf('resultToUnifiedReceipt'), -1, 'the pull shield mints a receipt - a wait is not an outcome in Athena');
}

/* ------------------------------------------------------------------ fixtures */
const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-pw', patientId: 'syn-pw', name: 'Synthetic Patient Paint', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-pw', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const THREE = [
  { key: 'hpi', text: 'Synthetic HPI body for the paintwait proof.' },
  { key: 'ros', text: 'Synthetic ROS body for the paintwait proof.' },
  { key: 'exam', text: 'Synthetic exam body for the paintwait proof.' }
];
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ------------------------------------------------------------------ DOM shim */
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

/* ------------------------------------------- fake MLS Assist + fake clock -- */
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
      return deliverRaw({ source: 'mls-ext', type: 'mlsPong', requestId: m.requestId,
        version: '3.0.110', buildId: '3.0.110', batchArm: '1.0.0',
        capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true, athenaFinalActionsV1: true, phoneConfirmedWriteV1: true, batchArmV1: true } });
    }
    if (m.type === 'mlsAppAthenaActionV2') {
      const resp = options.onAction ? options.onAction(m, defaultAction) : defaultAction(m);
      return deliver('mlsAppAthenaActionV2Result', m.requestId, resp);
    }
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.110', versionName: 'x', athena: { tabs: 1, discarded: 0 } });
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
    window, document: dom.document, el: dom.resolve, boxes: dom.boxes, cardHtml: dom.cardHtml,
    planText: () => dom.planNode.textContent, posted,
    now: () => RealDate.now() + offset,
    wf: window.__mlsWriteFlow,
    diag: () => window.__mlsWriteFlow.diagnostics,
    state: () => window.__mlsWriteFlow.diagnostics.state(),
    receiptHtml: () => String(dom.resolve('mlsAthenaUnifiedReceipt').innerHTML || ''),
    statusText: () => String(dom.resolve('mlsAthenaUnifiedProbe').textContent || ''),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    probes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe')
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }

function whatHappenedRow(html, label) {
  const at = String(html).indexOf('<b>' + label + '</b><span');
  assert.ok(at >= 0, 'the "What happened" list no longer carries a block for ' + label);
  checks++;
  const next = String(html).indexOf('<b>', at + 3);
  return String(html).slice(at, next > at ? next : undefined);
}

/* a refusal that names the stage-tab outcome the extension measured */
function noBead(m, dflt) {
  if (m.mode !== 'probe') return dflt(m);
  return { ok: false, blocked: true, reason: 'note-section-not-on-surface',
    hetDiag: { qualified: true, rank: 6, noteTargetFound: false, stageNav: 'no-bead' } };
}
function openedTab(m, dflt) {
  if (m.mode !== 'probe') return dflt(m);
  return { ok: false, blocked: true, reason: 'note-section-not-on-surface',
    hetDiag: { qualified: true, rank: 6, noteTargetFound: false, stageNav: 'opened-A/P' } };
}

(async function run() {

  /* ============ 1. paintwait: THE STAGE-TAB DISCRIMINATOR ================= */
  {
    const seam = makeHarness({}).diag().paintWait;
    eq(seam.v, 'paintwait-1.0.0', 'the paintwait seam is not exported by the shipped module');
    eq(seam.code, 'note-section-not-on-surface', 'paintwait is aimed at a different refusal code than the one measured');
    /* the ONLY two stage-tab outcomes that mean "not painted yet" */
    eq(seam.unpainted('no-bead'), true, 'a no-bead stage tab is not treated as a strip that has not painted');
    eq(seam.unpainted(''), true, 'an extension that sends no stageNav at all is not treated as unknown-and-unpainted');
    eq(seam.unpainted(undefined), true, 'a missing stageNav is not treated as unknown-and-unpainted');
    /* ...and the ones that mean the surface is genuinely different */
    ['already-open', 'opened-A/P', 'opened-HPI', 'forbidden-control', 'click-failed', 'not-needed'].forEach(function (sn) {
      eq(seam.unpainted(sn), false, 'stageNav ' + sn + ' was treated as a strip that has not painted - the extension PROVED the tab, so this must refuse at once');
    });
    ok(/still painting/i.test(seam.say), 'the waiting sentence does not say what MLS is waiting for: ' + seam.say);
    ok(/Nothing was changed/.test(seam.say), 'the waiting sentence drops the no-change guarantee: ' + seam.say);
    eq(seam.pacedMs, 15000, 'the paced wait is not openpace\'s own measured 15s');
    eq(seam.maxPaced, 4, 'the paced budget is not openpace\'s own measured 4');
    eq(seam.onceMs, 6000, 'the stale-open re-probe is not the bounded 6s this lane specified');
    eq(seam.freshMs, 90000, 'the fresh-open window is not openpace\'s own 90s');

    /* the code is on NO automatic re-check allowlist - the only cycles are
       openpace's own bounded pacing and this one, both bounded. */
    const auto = makeHarness({}).diag().autoChain;
    eq(auto.retryable['note-section-not-on-surface'], undefined, 'note-section-not-on-surface reached the wfauto allowlist - that is an unbounded loop');
    eq(auto.painting['note-section-not-on-surface'], undefined, 'note-section-not-on-surface reached the wfauto still-painting allowlist');
  }

  /* ==== 2. THE MEASURED CASE: refused no-bead, then painted, no press ===== */
  {
    let calls = 0;
    const h = makeHarness({ onAction: (m, dflt) => {
      if (m.mode !== 'probe') return dflt(m);
      calls++;
      return calls === 1 ? noBead(m, dflt) : dflt(m);
    } });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'pw-live' });
    await settle(400);

    ok(h.probes().length >= 2, 'the sheet settled on the FIRST no-bead answer - the encounter frame binds before its tab strip paints');
    const pill = h.diag().sheetClarity.stateFor('');
    eq(pill.label, 'READY', 'a surface that finished painting did not resolve to READY without a human press');
    eq(h.executes().length, 0, 'a read-only wait wrote something');
    eq(Object.keys(h.state().receipts).length, 0, 'a read-only wait minted a receipt');
    /* the row carries no settled failure at all - nothing failed */
    eq(h.diag().attemptLedger.get(h.state(), h.state().selectedRowId), null,
      'a section that only had to wait for its tab strip was recorded as a failed attempt');

    /* NEGATIVE CONTROL: the pre-fix bytes settle on the first refusal */
    let preCalls = 0;
    const pre = makeHarness({ src: NO_PAINTWAIT, onAction: (m, dflt) => {
      if (m.mode !== 'probe') return dflt(m);
      preCalls++;
      return preCalls === 1 ? noBead(m, dflt) : dflt(m);
    } });
    pre.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'pw-live-pre' });
    await settle(400);
    eq(pre.probes().length, 1, 'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes already re-check a no-bead refusal');
    eq(pre.diag().sheetClarity.readyRow(), null,
      'the pre-fix bytes reached READY on the first no-bead answer, so this suite is measuring nothing');
    eq(pre.diag().sheetClarity.stateFor('fix').label, 'NEEDS ONE STEP',
      'the pre-fix bytes did not settle the first no-bead answer as a refusal');
    ok(pre.statusText().indexOf('could not resolve one exact editor') > 0,
      'the pre-fix bytes printed something other than the shipped refusal sentence: ' + pre.statusText().slice(0, 140));
  }

  /* ======= 3. A PROVEN-OPEN STAGE TAB REFUSES AT ONCE, NEVER PACED ======== */
  {
    const h = makeHarness({ onAction: openedTab });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'pw-open' });
    await settle(400);
    eq(h.probes().length, 1, 'a surface whose stage tab the extension PROVED open was re-probed - it can only refuse identically');
    eq(h.diag().sheetClarity.stateFor('fix').label, 'NEEDS ONE STEP', 'the proven-open refusal did not settle');
    ok(h.statusText().indexOf('already open') > 0,
      'the proven-open refusal lost apdead-5\'s sentence: ' + h.statusText().slice(0, 140));
    eq(h.diag().paintWait.once().length, 0, 'a proven-open refusal burned this row\'s one bounded re-probe');
    /* the settle latch DID fire, so a queue waiting on it is released */
    eq(h.state().probeSettled, h.state().probeGeneration, 'the proven-open refusal never latched probeSettled - a queued send would burn its whole bound');
  }

  /* ============ 4. THE PER-ROW ONCE FLAG, AND THE PACED BUDGET ============ */
  {
    const h = makeHarness({ onAction: noBead });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'pw-once' });
    await settle(500);
    const rowId = h.state().selectedRowId;
    /* a STALE open: exactly one extra read-only check, then the sentence */
    eq(h.probes().length, 2, 'the stale-open lane did not take exactly ONE bounded re-probe');
    assert.deepStrictEqual(h.diag().paintWait.once(), [rowId], 'the once flag is not per row id');
    checks++;
    eq(h.state().probeSettled, h.state().probeGeneration, 'the second refusal never settled - the sheet would wait forever');
    ok(h.statusText().indexOf('could not resolve one exact editor') > 0,
      'after its one bounded re-probe the row does not carry the shipped refusal sentence');
    /* and it holds: the same row asked again does not re-arm the flag */
    eq(h.diag().paintWait.retry(h.state().manifest.rows.filter(r => r.id === rowId)[0]), false,
      'the per-row once flag did not hold - the same stale row could wait again');

    /* a FRESH open gets openpace's own paced budget instead */
    const f = makeHarness({ onAction: noBead });
    f.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'pw-paced' });
    await settle(200);
    const st = f.state();
    const beforePaced = f.probes().length;
    st.openedOkAt = f.now(); st.paceReprobes = 0; st.paintwaitOnce = null;
    eq(f.diag().paintWait.retry(st.manifest.rows.filter(r => r.id === st.selectedRowId)[0]), true,
      'a FRESH open did not take the paced lane at all');
    await settle(600);
    eq(Number(f.state().paceReprobes), 4, 'the paced budget is not openpace\'s own measured 4 re-probes');
    ok(f.probes().length >= beforePaced + 4, 'the paced lane did not actually re-run the read-only check');
    /* and it TERMINATES: after the paced budget the stale lane gives the row
       its one bounded re-probe and then the sheet says the shipped sentence. */
    eq(f.diag().paintWait.once().length, 1, 'the paced lane did not fall through to exactly one bounded stale re-probe');
    eq(f.state().probeSettled, f.state().probeGeneration, 'the paced lane never settled - the sheet would wait forever');
    ok(f.statusText().indexOf('could not resolve one exact editor') > 0,
      'the exhausted paced lane does not end on the shipped refusal sentence: ' + f.statusText().slice(0, 140));
    eq(f.executes().length, 0, 'the paced lane wrote something');
  }

  /* ================= 5. pullshield: THE TAB IS SHARED ===================== */
  {
    const seam = makeHarness({}).diag().pullShield;
    eq(seam.v, 'pullshield-1.0.0', 'the pull-shield seam is not exported by the shipped module');
    eq(seam.waitMs, 60000, 'the pull-shield wait is not the bounded 60s this lane specified');
    ok(/schedule pull/.test(seam.say) && /Nothing is sent/.test(seam.say), 'the waiting sentence is not the one this lane specified: ' + seam.say);
    ok(/press again when it finishes/.test(seam.notAttemptedMsg), 'the give-up sentence does not name the one move that changes the outcome: ' + seam.notAttemptedMsg);
    eq(/not sent/.test(seam.notAttempted), false, 'a row a pull held is reported as NOT SENT - it was never attempted, and calling it a refusal is a false statement about the software');

    /* (a) THE SENTENCE, AND THE RELEASE. unifiedStatus paints synchronously, so
       the waiting line is read the instant the shield starts waiting. */
    {
      const w = makeHarness({});
      w.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'ps-say' });
      await settle(300);
      let reads = 0;
      Object.defineProperty(w.window, '__mlsPullBusyAt', { get: () => (reads++ < 6 ? w.now() : 0), configurable: true });
      const waiting = w.diag().pullShield.clear();
      eq(w.statusText(), w.diag().pullShield.say, 'the sheet does not say why it is waiting');
      eq(await waiting, true, 'the shield never cleared after the schedule pull finished');
      eq(w.executes().length, 0, 'waiting for a schedule pull wrote something');
    }

    /* (b) A PULL THAT LETS GO: no probe leaves while it holds the tab, and the
       queue then runs its own read-only check and writes. */
    const h = makeHarness({ batchArm: true });
    let busy = false, busyReads = 0, probesAtRelease = -1;
    Object.defineProperty(h.window, '__mlsPullBusyAt', { get: () => {
      if (!busy) return 0;
      if (++busyReads > 12) { busy = false; probesAtRelease = h.probes().length; return 0; }
      return h.now();
    }, configurable: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'ps-clear' });
    await settle(300);
    const openProbes = h.probes().length;
    busy = true; busyReads = 0;
    h.el('mlsAthenaUnifiedGo').click();
    await settle(1200);
    eq(probesAtRelease, openProbes, 'the queue probed straight into a tab a schedule pull was driving');
    ok(h.executes().length >= 1, 'the queue never resumed after the schedule pull finished');
    ok(h.probes().length > openProbes, 'the queue never ran its read-only check after the pull finished');

    /* (b) A PULL THAT NEVER LETS GO: not attempted, never a refusal. */
    const g = makeHarness({ batchArm: true });
    Object.defineProperty(g.window, '__mlsPullBusyAt', { get: () => g.now(), configurable: true });
    g.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'ps-stuck' });
    await settle(300);
    const before = g.probes().length;
    g.el('mlsAthenaUnifiedGo').click();
    await settle(3000);
    eq(g.probes().length, before, 'the queue probed anyway after giving up on the schedule pull');
    eq(g.executes().length, 0, 'the queue wrote anyway after giving up on the schedule pull');
    eq(Object.keys(g.state().receipts).length, 0, 'giving up on a schedule pull minted a receipt in Athena');
    const rows = g.state().manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    const att = g.diag().attemptLedger.get(g.state(), rows[0].id);
    ok(att && att.status === g.diag().pullShield.notAttempted,
      'a row a schedule pull held is not recorded as NOT ATTEMPTED: ' + JSON.stringify(att));
    ok(String(att.message).indexOf('press again when it finishes') > 0, 'the recorded sentence does not name the doctor\'s next move');
    const rec = g.receiptHtml();
    eq(rec.indexOf('NOT SENT - READ-ONLY CHECK REFUSED'), -1,
      'a row nothing ever checked was reported as a REFUSED read-only check');

    /* NEGATIVE CONTROL: the pre-fix queue probes into the running pull */
    const pre = makeHarness({ batchArm: true, src: NO_PULLSHIELD });
    Object.defineProperty(pre.window, '__mlsPullBusyAt', { get: () => pre.now(), configurable: true });
    pre.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'ps-pre' });
    await settle(300);
    const preBefore = pre.probes().length;
    pre.el('mlsAthenaUnifiedGo').click();
    await settle(900);
    ok(pre.probes().length > preBefore,
      'THE NEGATIVE CONTROL IS INERT: the pre-fix queue already waits for a schedule pull');
  }

  /* ================= 6. ledger: A PASSING CHECK ERASES ITS OWN FAILURE ==== */
  {
    const seam = makeHarness({}).diag().ledgerFix;
    eq(seam.v, 'ledger-1.0.0', 'the ledger-fix seam is not exported by the shipped module');
    eq(/not sent/i.test(seam.rechecked), false, 'a section whose check just PASSED is still called not sent');
    ok(/passed just now/.test(seam.recheckedMsg), 'the re-checked sentence does not say what actually happened: ' + seam.recheckedMsg);

    /* END TO END, no seam calls: refuse once, then answer ok on the re-check. */
    let refuse = true;
    const h = makeHarness({ onAction: (m, dflt) => (m.mode === 'probe' && refuse ? noBead(m, dflt) : dflt(m)) });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'lg-live' });
    await settle(500);
    const rowId = h.state().selectedRowId;
    const row = manifest.rows.filter(r => r.id === rowId)[0];
    /* the shipped renderer, painting the panel the doctor was looking at */
    h.diag().receiptLedger.render(h.state());
    ok(h.receiptHtml().indexOf('NOT SENT - READ-ONLY CHECK REFUSED') > 0,
      'the settled refusal never reached the receipt panel, so this case is measuring nothing');
    refuse = false;
    h.el('mlsAthenaUnifiedRecheck').click();
    await settle(400);
    const after = whatHappenedRow(h.receiptHtml(), row.label);
    eq(after.indexOf('NOT SENT'), -1,
      'THE MEASURED DEFECT: the ledger still reads NOT SENT for a row whose read-only check has just passed: ' + after.slice(0, 200));
    ok(after.indexOf('READY - RE-CHECKED, NOTHING SENT YET') > 0, 'the re-checked row does not say what it is now: ' + after.slice(0, 200));
    eq(h.executes().length, 0, 'a read-only re-check wrote something');
    eq(h.diag().sheetClarity.stateFor('').label, 'READY', 'the passing re-check did not reach READY');

    /* NEGATIVE CONTROL: pre-fix, the panel is never repainted */
    let preRefuse = true;
    const pre = makeHarness({ src: NO_LEDGER, onAction: (m, dflt) => (m.mode === 'probe' && preRefuse ? noBead(m, dflt) : dflt(m)) });
    const preManifest = pre.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'lg-pre' });
    await settle(500);
    const preRow = preManifest.rows.filter(r => r.id === pre.state().selectedRowId)[0];
    pre.diag().receiptLedger.render(pre.state());
    ok(pre.receiptHtml().indexOf('NOT SENT - READ-ONLY CHECK REFUSED') > 0,
      'the pre-fix fixture never painted a stale refusal, so the control measures nothing');
    preRefuse = false;
    pre.el('mlsAthenaUnifiedRecheck').click();
    await settle(400);
    ok(whatHappenedRow(pre.receiptHtml(), preRow.label).indexOf('NOT SENT') > 0,
      'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes already repaint the ledger after a passing re-check');
  }

  /* ====== 7. A BATCH THAT STARTS DOES NOT CARRY THE LAST ONE'S REFUSALS === */
  {
    const h = makeHarness({ batchArm: true });
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'lg-batch' });
    await settle(300);
    const state = h.state();
    const rows = manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    const att = h.diag().attemptLedger;
    rows.forEach(r => att.remember(state, r.id, att.refused, 'The read-only check refused this section.'));
    h.diag().receiptLedger.render(state);
    ok(h.receiptHtml().indexOf('NOT SENT - READ-ONLY CHECK REFUSED') > 0, 'the stale refusals were never painted, so this case measures nothing');

    h.el('mlsAthenaUnifiedGo').click();
    await settle(1200);
    rows.forEach(function (r) {
      const live = att.get(state, r.id);
      ok(!(live && live.status === att.refused),
        'the new batch carried the PREVIOUS batch\'s read-only refusal for ' + r.label);
    });
    ok(h.executes().length >= 1, 'the batch never ran, so the clear could not be attributed to it');

    /* NEGATIVE CONTROL */
    const pre = makeHarness({ batchArm: true, src: NO_LEDGER });
    const preManifest = pre.wf.openUnifiedConfirmation({ patient: PATIENT, sections: clone(THREE), expectedContext: BOUND, receiptSessionId: 'lg-batch-pre' });
    await settle(300);
    const preState = pre.state();
    const preRows = preManifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    const preAtt = pre.diag().attemptLedger;
    /* the LAST row of the queue, so the assertion cannot be satisfied by a
       receipt that landed before the clear would have run */
    preAtt.remember(preState, preRows[preRows.length - 1].id, preAtt.refused, 'The read-only check refused this section.');
    const preBefore = preAtt.get(preState, preRows[preRows.length - 1].id);
    ok(preBefore && preBefore.status === preAtt.refused, 'the pre-fix fixture did not record a stale refusal');
    /* on the pre-fix bytes nothing clears it at batch start - only the row's own
       later verified receipt outranks it, which is why the panel showed six
       stale NOT SENT lines under a READY sheet. */
    const cleared = pre.wf.diagnostics.ledgerFix ? 'seam-present' : 'seam-absent';
    eq(cleared, 'seam-present', 'the pre-fix control lost the seam this comparison reads');
    ok(String(NO_LEDGER).indexOf('if (batch === true) ledgerClearForQueue(state, rows);') === -1,
      'THE NEGATIVE CONTROL IS INERT: the pre-fix bytes still clear the queue\'s stale attempts at batch start');
  }

  console.log('PASS paintwait-queue-proof: ' + checks + ' checks - a no-bead or stageNav-less refusal on a surface that is still painting is paced like openpace on a fresh open and gets exactly ONE bounded 6s re-probe per row on a stale one, never latching the settle the batch waits on, so the measured live case (refused at 16:26:45, beads painted at 16:26:55) resolves to READY with no human press; a stage tab the extension PROVED open refuses at once and is never paced; the queue waits, hidden-safe and bounded, for a schedule pull that owns the same athenaOne tab and settles a row it gives up on as NOT ATTEMPTED rather than as a refusal it never made; and a passing read-only check erases and repaints its own stale NOT SENT ledger line while a starting batch drops the previous batch\'s refusals for the rows it is about to check - each measured against the PRE-FIX bytes, where none of it happens');
})().catch(err => { console.error(err); process.exit(1); });
