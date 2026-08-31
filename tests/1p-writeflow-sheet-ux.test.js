'use strict';

/* sheetux-1.0.0 - the owner's three complaints about the unified Athena review
 * sheet, turned into pins (2026-08-27, verbatim):
 *
 *   "THIS WARNING MAKES IT LOOK LIKE ITS NOT GOING TO WORK THO AND ALSO THE
 *    SEND CHECK SECTION BUTTON NEEDS TO BE MORE BOLD AND THE CONFIRM AND SEND
 *    TO ATHENA WHATS THE DIFFERENCE BETWEEN THOSE TWO BUTTONS THEY SHOULD BE
 *    MERGED FIX ALL THAT"
 *
 * What this suite proves, driving the REAL 1p-feat_mls_writeflow.js in a VM
 * against a fake extension (no browser, no athenaOne, no PHI):
 *
 *   1. ONE primary button. "Send checked sections" is gone from the footer and
 *      the single "Confirm & Send to Athena" sends EVERY checked section - each
 *      through the existing per-row probe/execute/receipt machinery, not a new
 *      send loop.
 *   2. Exactly one checked section is byte-equivalent to the legacy single-row
 *      press: the same single probe, the same single execute request, and a
 *      receipt that deep-equals the legacy receipt field for field.
 *   3. Zero checked sections disable the button AND carry the reason. The
 *      router refuses even if the DOM disable itself were bypassed.
 *   4. A RECOVERABLE refusal (one read-only step missing) paints amber, not
 *      error-red, says so in words that do not imply failure, keeps the
 *      "nothing was changed" honesty, and brings a WORKING do-it-for-me control
 *      that takes the named step and presses the existing re-check. A FATAL
 *      refusal (identity mismatch) stays red and offers no such control.
 *   5. The repeated per-row boilerplate collapsed: an identical Why/How
 *      sentence renders ONCE above the rows while every per-row unique reason
 *      stays inline.
 *
 * No gate may weaken: this suite also pins that every execute is preceded by
 * its own fresh read-only probe, that the recovery lane never writes, and that
 * Save / Sign / order rows can never be swept into a batch.
 */

const assert = require('assert');
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
const PATIENT = { id: 'syn-ux', patientId: 'syn-ux', name: 'Synthetic Patient Ux', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-ux', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const SECTIONS = [
  { key: 'hpi', text: 'Synthetic HPI body for the sheet-ux suite.' },
  { key: 'ros', text: 'Synthetic ROS body for the sheet-ux suite.' },
  { key: 'exam', text: 'Synthetic exam body for the sheet-ux suite.' }
];

function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ------------------------------------------------------------------ DOM shim
 * The write-readiness harness shape, plus the two things this suite needs and
 * that one does not have:
 *   - `textContent = x` CLEARS children, the way a real node does. Without it a
 *     wiped status control would still look present.
 *   - the include checkboxes are REAL: they are parsed out of the markup the
 *     renderer actually emitted, so "checked" here means the shipped markup.
 * Ids the renderer mints at runtime are strict: getElementById returns null
 * until one is genuinely appended, so a guard cannot pass on a phantom. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt'];

function makeDom(options) {
  options = options || {};
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
      fire(t) { (el.handlers[t] || []).forEach(fn => fn({ target: el })); }
    };
    return el;
  }
  function boxesOf(el) {
    if (options.noCheckboxes) return [];
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

/* ------------------------------------------------- fake MLS Assist 3.0.62 --- */
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
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId, options.onAction ? options.onAction(m, defaultAction) : defaultAction(m));
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, options.onOpen ? options.onOpen(m) : { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, options.onGoto ? options.onGoto(m) : { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.62', versionName: '3.0.62+core-sha256:abc', athena: { tabs: 3, discarded: 1 } });
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    /* openpace-1.0.0 (b1129): the paced post-open re-probe waits 12s and the
       grace re-checks wait 15s - run exactly those two delays immediately so
       the paced flow is exercised, while genuinely long timers (probe
       timeouts, minute-scale interims) stay inert as before. */
    setTimeout: (fn, ms) => { const m = Number(ms || 0); if (m <= 2000 || m === 12000 || m === 15000) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: '1p-feat_mls_writeflow.js' });
  return {
    window, document: dom.document, el: dom.resolve, boxes: dom.boxes, cardHtml: dom.cardHtml, posted, options,
    wf: window.__mlsWriteFlow,
    actions: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2'),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    probes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe')
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }
function stripTime(receipt) { const c = clone(receipt); delete c.completedAt; return c; }
function tally(html, needle) { return html.split(needle).length - 1; }

/* ------------------------------------------------------- 0. source contract */
{
  ok(FLOW.indexOf('id="mlsAthenaUnifiedBatch"') < 0,
    'the second footer send button is still rendered - the owner asked for ONE');
  const footerAt = FLOW.indexOf('position:sticky;bottom:0;z-index:3');
  ok(footerAt > 0, 'the sticky review footer is gone');
  const footer = FLOW.slice(footerAt, FLOW.indexOf('</div>\';', footerAt));
  eq(tally(footer, 'type="button"'), 2, 'the sticky footer must hold exactly Cancel + one primary send button');
  ok(/id="mlsAthenaUnifiedGo"[^>]*font-weight:900/.test(footer),
    'the merged primary button is not visually bolder than the two it replaced');
  ok(/id="mlsAthenaUnifiedGo"[^>]*box-shadow:/.test(footer), 'the merged primary button carries no raised fill');
  ok(footer.indexOf('Confirm &amp; Send to Athena') > 0, 'the merged primary button lost its label');

  const router = FLOW.slice(FLOW.indexOf('function runUnifiedPrimarySend'), FLOW.indexOf('function runUnifiedBatchSend'));
  ok(router.indexOf('runUnifiedBatchSend(state, btn);') > 0, 'the merged button does not route into the existing batch driver');
  ok(router.indexOf('executeUnifiedSelection(state);') > 0, 'the merged button lost the legacy one-row lane');
  ok(!/bridge\(|postMessage/.test(router), 'the merged button talks to the bridge directly instead of through the existing drivers');

  const plan = FLOW.slice(FLOW.indexOf('function unifiedPrimaryPlan'), FLOW.indexOf('function unifiedSyncPrimaryButton'));
  ok(plan.indexOf("sel.action !== 'write_note'") > 0, 'the plan no longer keeps Save / Sign / order rows on the one-row path');
  const bx = FLOW.slice(FLOW.indexOf('function bxCheckedRows'), FLOW.indexOf('function unifiedPrimaryPlan'));
  ok(bx.indexOf("row.capability === 'ready' && row.action === 'write_note'") > 0,
    'the checked-row filter lost its ready/write_note gate');
}

(async function run() {
  /* ------------------------ 1. the merged button sends EVERY checked row ---- */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: BOUND, receiptSessionId: 'ux-batch' });
    await settle(80);
    const noteRows = manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    eq(noteRows.length, 3, 'the fixture did not produce three READY note rows');
    eq(h.boxes().length, 3, 'the shipped markup did not carry one include checkbox per READY note row');
    ok(h.boxes().every(b => b.checked === true), 'the include checkboxes do not ship checked');

    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, false, 'the merged primary button stayed grayed after the opening read-only check verified');
    go.click();
    await settle(1200);

    eq(h.executes().length, 3, 'the ONE button did not send all three checked sections');
    ok(h.probes().length >= 3, 'a section was executed without its own fresh read-only check');
    const order = h.actions().map(m => m.mode);
    for (let i = 0; i < order.length; i++) {
      if (order[i] !== 'execute') continue;
      ok(i > 0 && order[i - 1] === 'probe', 'an execute was issued without its own immediately preceding read-only probe');
    }
    const state = h.wf.diagnostics.state();
    noteRows.forEach(row => {
      const rec = state.receipts[row.id];
      ok(rec && rec.status === 'verified', 'checked section ' + row.id + ' has no verified receipt of its own');
      eq(rec.rowHash, row.rowHash, 'the receipt for ' + row.id + ' is not bound to that exact row');
    });
    eq(Object.keys(state.receipts).length, 3, 'the batch produced a different number of receipts than checked rows');
    ok(h.actions().every(m => m.action === 'write_note'), 'the merged button ran an action other than the checked note writes');
    ok(h.wf.diagnostics.state().halted !== true, 'a clean batch halted the review');
  }

  /* ------------- 2. exactly one checked == the legacy single-row press ------ */
  {
    /* control lane: a sheet with no include checkboxes at all keeps the exact
       legacy one-row path. This is what byte-equivalence is measured against. */
    const legacy = makeHarness({ noCheckboxes: true });
    legacy.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [SECTIONS[0]], expectedContext: BOUND, receiptSessionId: 'ux-one' });
    await settle(80);
    const legacyGo = legacy.el('mlsAthenaUnifiedGo');
    eq(legacyGo.disabled, false, 'the legacy control sheet never reached READY');
    legacyGo.click();
    await settle(400);
    eq(legacy.executes().length, 1, 'the legacy control lane did not issue exactly one execute');
    const legacyState = legacy.wf.diagnostics.state();
    const rowId = Object.keys(legacyState.receipts)[0];
    ok(rowId, 'the legacy control lane produced no receipt at all');
    const legacyReceipt = stripTime(legacyState.receipts[rowId]);
    eq(legacyReceipt.status, 'verified', 'the legacy control lane did not verify');

    const merged = makeHarness({});
    merged.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [SECTIONS[0]], expectedContext: BOUND, receiptSessionId: 'ux-one' });
    await settle(80);
    eq(merged.boxes().length, 1, 'the single-section sheet did not render exactly one include checkbox');
    merged.el('mlsAthenaUnifiedGo').click();
    await settle(600);
    eq(merged.executes().length, 1, 'one checked section did not issue exactly one execute');
    eq(merged.probes().length, legacy.probes().length, 'one checked section changed the number of read-only checks');
    const mergedReceipt = stripTime(merged.wf.diagnostics.state().receipts[rowId]);
    assert.deepStrictEqual(mergedReceipt, legacyReceipt,
      'ONE CHECKED SECTION IS NOT EQUIVALENT TO THE LEGACY SINGLE-ROW PRESS - the receipts differ');
    checks++;
    const a = clone(legacy.executes()[0]), b = clone(merged.executes()[0]);
    ['requestId'].forEach(k => { delete a[k]; delete b[k]; });
    assert.deepStrictEqual(b, a, 'one checked section sent a different execute request than the legacy press');
    checks++;
  }

  /* ---------------------- 3. zero checked disables, with the reason -------- */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: BOUND, receiptSessionId: 'ux-zero' });
    await settle(80);
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, false, 'the fixture did not reach READY before unchecking');
    const boxes = h.boxes();
    boxes.forEach(b => { b.checked = false; });
    boxes[0].fire('change');
    eq(go.disabled, true, 'unchecking every section left the send button live');
    eq(go.getAttribute('aria-disabled'), 'true', 'the disabled send button is not announced as disabled');
    const reason = go.getAttribute('data-mls-primary-blocked');
    ok(reason && /Check at least one READY note section/.test(reason),
      'the disabled send button carries no reason: ' + reason);
    eq(go.title, reason, 'the reason is not reachable on hover');

    const before = h.executes().length;
    go.click();
    await settle(120);
    eq(h.executes().length, before, 'a zero-checked press still reached Athena');
    const status = String(h.el('mlsAthenaUnifiedProbe').textContent);
    ok(/Check at least one READY note section/.test(status), 'a zero-checked press did not say why: ' + status);
    ok(/Nothing was changed/.test(status), 'the zero-checked refusal dropped the nothing-changed honesty');

    boxes[1].checked = true;
    boxes[1].fire('change');
    eq(go.disabled, false, 're-checking a section did not restore the send button');
  }

  /* ------------- 4. recoverable refusals are amber and carry the cure ------ */
  {
    const wrongDay = '2026-08-11';
    const opts = {
      onAction: (m, dflt) => (m.mode === 'probe'
        ? { ok: false, blocked: true, reason: 'probe-frame-missing', error: 'The encounter frame was not found.' }
        : dflt(m)),
      onOpen: () => ({ ok: false, opened: false, reason: 'appointment-id-not-found', error: 'The exact Athena appointment row could not be opened.' }),
      onGoto: () => ({ ok: false, supported: true, via: 'weekstrip', schedDate: wrongDay, error: 'frozen day' })
    };
    const h = makeHarness(opts);
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [SECTIONS[0]], expectedContext: BOUND, receiptSessionId: 'ux-recover' });
    await settle(400);

    const statusEl = h.el('mlsAthenaUnifiedProbe');
    const text = String(statusEl.textContent);
    eq(statusEl.getAttribute('data-mls-status-kind'), 'fix', 'a recoverable refusal is still painted as an error: ' + text);
    eq(statusEl.style.color, '#7a5a16', 'the recoverable refusal did not take the amber attention colour');
    eq(statusEl.style.background, '#fff7e6', 'the recoverable refusal has no attention surface behind it');
    ok(/^One step needed:/.test(text), 'the recoverable refusal still opens like a failure: ' + text);
    ok(!/could not be sent to/.test(text), 'the recoverable refusal still reads as a failed send: ' + text);
    ok(text.indexOf('Day view is on ' + wrongDay) >= 0,
      'the recoverable refusal stopped naming the day athenaOne is really on: ' + text);
    ok(/Nothing was changed/.test(text), 'the recoverable refusal dropped the nothing-changed honesty: ' + text);

    const doIt = h.el('mlsAthenaUnifiedDoIt');
    ok(doIt, 'a recoverable refusal offered no do-it-for-me control');
    eq(doIt.textContent, h.wf.diagnostics.sheetUx.doItLabel, 'the recovery control is not the named next step');
    ok(/Do it for me/.test(String(doIt.title)), 'the recovery control does not say what it does');
    const boundRow = doIt.getAttribute('data-mls-recover-row');
    ok(manifest.rows.some(r => r.id === boundRow), 'the recovery control is not bound to a real row of this review: ' + boundRow);

    /* the control WORKS: it takes the named step, then presses the re-check */
    const gotosBefore = h.posted.filter(m => m.type === 'mlsAppGotoDate').length;
    const probesBefore = h.probes().length;
    opts.onGoto = m => ({ ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    opts.onOpen = () => ({ ok: true, opened: true, via: 'appointment-id' });
    opts.onAction = (m, dflt) => dflt(m);
    doIt.click();
    await settle(600);
    ok(h.posted.filter(m => m.type === 'mlsAppGotoDate').length > gotosBefore,
      'the do-it-for-me control did not send athenaOne to the encounter day');
    ok(h.posted.some(m => m.type === 'mlsAppSearchOpenPatient'),
      'the do-it-for-me control did not open the exact appointment row');
    ok(h.probes().length > probesBefore, 'the do-it-for-me control did not press the existing re-check');
    eq(h.executes().length, 0, 'the read-only recovery wrote to Athena');
    ok(!/^One step needed:/.test(String(h.el('mlsAthenaUnifiedProbe').textContent)),
      'the recovery ran but the one-step notice never cleared');
  }
  {
    /* FATAL control: an identity that does not match stays RED and offers no
       do-it-for-me, because nothing about it is one read-only step away. */
    const h = makeHarness({
      onAction: (m, dflt) => {
        const r = dflt(m);
        if (m.mode === 'probe') r.context = Object.assign({}, r.context, { dob: '11/11/1911' });
        return r;
      }
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [SECTIONS[0]], expectedContext: BOUND, receiptSessionId: 'ux-fatal' });
    await settle(300);
    const statusEl = h.el('mlsAthenaUnifiedProbe');
    eq(statusEl.getAttribute('data-mls-status-kind'), 'err', 'an identity conflict stopped being an error: ' + statusEl.textContent);
    eq(statusEl.style.color, '#8b2525', 'an identity conflict lost its error-red');
    ok(/did not return a complete matching patient name, DOB, and MRN/.test(String(statusEl.textContent)),
      'the identity conflict changed its refusal: ' + statusEl.textContent);
    eq(h.el('mlsAthenaUnifiedDoIt'), null, 'an identity conflict offered a do-it-for-me control');
    eq(h.executes().length, 0, 'an identity conflict reached an execute');
  }

  /* ----------------- 5. the identical per-row boilerplate is said ONCE ----- */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: BOUND, receiptSessionId: 'ux-collapse' });
    await settle(80);
    const html = h.cardHtml();
    eq(tally(html, 'class="mls-bx-check"'), 3, 'the collapse fixture did not render three ready note rows');
    eq(tally(html, 'Leave the sections you want checked, then press'), 1,
      'the shared How sentence is not rendered exactly once above the rows');
    eq(tally(html, 'What &rarr; Where &rarr; How'), 1, 'the destination guide is no longer the single place the How lives');
    eq(tally(html, 'then use its own Confirm'), 0, 'the per-row How boilerplate is still repeated inside each row');
    const rowCount = tally(html, 'data-manifest-row="');
    ok(rowCount >= 3, 'the collapse fixture rendered fewer rows than it staged (' + rowCount + ')');
    eq(tally(html, '<b>Where:</b>'), rowCount, 'a per-row destination was collapsed away with the boilerplate');
    eq(tally(html, '<b>Result:</b>'), rowCount, 'a per-row result was collapsed away with the boilerplate');
  }
  {
    const h = makeHarness({ unbound: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: SECTIONS, expectedContext: { visitDate: '', provider: '', appointmentId: '' }, requireExpectedVisit: true, receiptSessionId: 'ux-blocked' });
    await settle(80);
    const html = h.cardHtml();
    const blocked = tally(html, 'BLOCKED &middot; NOTHING SENT');
    ok(blocked >= 2, 'the blocked fixture did not produce at least two blocked rows (got ' + blocked + ')');
    eq(tally(html, 'nothing is sent from any of them'), 1, 'the shared blocked How is not stated exactly once');
    eq(tally(html, 'Nothing is sent from this row. Resolve the reason below'), 0,
      'the identical blocked How is still repeated on every row');
    /* wfclar-1.0.0 (owner 2026-08-27, "not so many things that say blocked"):
       these rows are blocked for ONE reason - the review has no bound
       encounter - and that sentence used to print once per row, up to eight
       red paragraphs saying one thing. An IDENTICAL reason is now part of the
       same collapse the How went through: stated once in the group heading,
       led by the single missing fact. Uniqueness is what may never collapse,
       and the fixture below is the control for that. */
    eq(tally(html, '<b>Why:</b>'), 0,
      'one reason shared by every blocked row is still repeated inside each of them');
    eq(tally(html, 'are blocked for the same reason.') + tally(html, 'need the same one thing:'), 1,
      'the shared blocked reason is not stated exactly once in the group heading');
    ok(html.indexOf('The exact visit needs its date, provider, and appointment ID') > 0,
      'the shared blocked reason lost its exact sentence when it moved to the heading');
  }
  {
    /* CONTROL: blocked rows with GENUINELY DIFFERENT reasons collapse nothing. */
    const h = makeHarness({ unbound: true });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [SECTIONS[0]],
      plan: [{ kind: 'not-a-real-destination', body: 'synthetic unsupported payload' }],
      expectedContext: { visitDate: '', provider: '', appointmentId: '' }, requireExpectedVisit: true, receiptSessionId: 'ux-blocked-mixed' });
    await settle(80);
    const html = h.cardHtml();
    const blocked = tally(html, 'BLOCKED &middot; NOTHING SENT');
    eq(blocked, 2, 'the mixed-reason fixture did not produce exactly two blocked rows');
    eq(tally(html, '<b>Why:</b>'), 2, 'a per-row UNIQUE reason was collapsed away with the boilerplate');
    eq(tally(html, 'are blocked for the same reason.') + tally(html, 'need the same one thing:'), 0,
      'rows with different reasons were reported as sharing one');
  }

  console.log('PASS 1p-writeflow-sheet-ux: ' + checks + ' checks - ONE bold primary button sends every checked section through the existing per-row probe/execute/receipt queue, one checked section is equivalent to the legacy single-row press, zero checked disables with its reason and still refuses if bypassed, recoverable refusals paint amber with a working do-it-for-me control while identity conflicts stay red, and identical per-row boilerplate is said once while unique reasons stay inline');
})().catch(err => { console.error(err); process.exit(1); });
