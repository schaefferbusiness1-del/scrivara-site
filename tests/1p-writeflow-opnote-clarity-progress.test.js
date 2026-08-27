'use strict';
/* THE OP-NOTE WRITE, THE HONEST REFUSAL, AND THE LOADING BAR
 * (wfclar-1.0.0 + wfprog-1.0.0 + opnsend-2.2.0)
 *
 * Owner, 2026-08-27: "really make sure the write works well like I mean make it
 * easy and simple with a good loading bar and not so many things that say
 * blocked", and "ALSO THE OP NOTES WRITE SHOULD WORK TOO".
 *
 * WHAT WAS MEASURED BEFORE THIS SUITE EXISTED
 * -------------------------------------------
 * 1. An op note DOES already reach the ordinary reviewed sheet: the room's
 *    card control calls opPrepSave then pushHistoryNoteToAthena, which builds
 *    a kind:'procedure' plan row, and buildUnifiedManifest turns that into ONE
 *    named write_note row addressed to
 *    "Athena encounter > Physical Exam > Procedure Documentation". MLS Assist
 *    3.0.84 accepts that exact destination (NAMED_NOTE_DEFS.procedure). So the
 *    manifest was never the defect.
 * 2. The defect is what happens next. MLS Assist refuses a write_note whose
 *    target editor already holds text - noteEditorNotEmptyReceipt() in
 *    background.js, `{ ok:false, blocked:true, reason:'note-editor-not-empty' }`
 *    with NO English sentence at all - and Procedure Documentation only exists
 *    once the procedure template has been added, which fills it with that
 *    template's skeleton. The sheet printed
 *    `probe.error || probe.message || probe.reason`, so the doctor read the
 *    literal token "note-editor-not-empty" in error red, under a re-check
 *    button that would refuse identically forever. That is the op note's
 *    guaranteed ending, and it is the "so many things that say blocked" the
 *    owner is describing.
 * 3. Both op-note send paths in the shell ended in a bare `if(!rec2) return;`.
 *    Press Send to Athena on a note carrying an unresolved field and it filed
 *    as a DRAFT while NOTHING at all was said about Athena.
 *
 * WHAT THIS SUITE PINS
 * --------------------
 *   1. The op-note row: ONE write_note row, destination Procedure
 *      Documentation, READY when the encounter is bound, and its payload
 *      carries the op-note text with the transport label already stripped.
 *   2. It reaches an execute and a verified receipt through the SAME reviewed
 *      path as an ordinary note - same probe, same one-use token, same
 *      receipt shape.
 *   3. A recoverable refusal is amber, in plain words, and brings working
 *      controls; an unsafe one stays red and brings no shortcut. The op note's
 *      own refusal (note-editor-not-empty) is the amber case and carries the
 *      copy control, because MLS may not clear an Athena field.
 *   4. The loading surface reports which section, N of M, per-section verdicts
 *      and a final summary DERIVED FROM THE RECEIPTS - and cannot say a section
 *      was written without one.
 *   5. Zero checked sections still refuses (the b1083 law, re-pinned here
 *      because the progress surface now sits on the same button).
 *   6. The shell's two op-note send paths no longer dead-end in silence, in
 *      both 1p shells, byte-identically.
 *
 * NOTHING HERE ASSERTS THAT A GATE MOVED. Every case below still runs the
 * probe -> single human confirm -> execute -> durable receipt sequence.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW = fs.readFileSync(path.join(ROOT, '1p-feat_mls_writeflow.js'), 'utf8');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];

let checks = 0;
function ok(cond, msg) { assert.ok(cond, msg); checks++; }
function eq(a, b, msg) { assert.strictEqual(a, b, msg + ' (got ' + JSON.stringify(a) + ', expected ' + JSON.stringify(b) + ')'); checks++; }

const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-op', patientId: 'syn-op', name: 'Synthetic Patient Op', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-op', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const OP_BODY = 'PROCEDURE PERFORMED: synthetic left L5-S1 transforaminal epidural steroid injection.\nFINDINGS: synthetic body for this suite.';
const OP_SECTION = [{ key: 'procedure', text: OP_BODY }];
const THREE = [
  { key: 'hpi', text: 'Synthetic HPI body.' },
  { key: 'ros', text: 'Synthetic ROS body.' },
  { key: 'exam', text: 'Synthetic exam body.' }
];

function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ------------------------------------------------------------------ DOM shim
 * The sheet-ux harness shape (1p-writeflow-sheet-ux.test.js) plus the two ids
 * this suite needs to be REAL rather than phantom: the copy-section control
 * wfclar-1.0.0 appends, and the progress host wfprog-1.0.0 paints into. Ids
 * outside LIVE_IDS resolve lazily, which is how the module's own
 * getElementById('mlsAthenaUnifiedProgress') finds a node to paint. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsAthenaUnifiedCopySection'];

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
      querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
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

/* ------------------------------------------------- fake MLS Assist 3.0.84 --- */
function makeHarness(options) {
  options = options || {};
  const dom = makeDom(options);
  const listeners = [];
  const posted = [];
  const said = [];
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
    toast: (m, k) => said.push({ message: String(m), kind: String(k || '') }),
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
    control: 'Procedure Documentation editor', framePath: '0', encounterRootFingerprint: 'er',
    controlFingerprint: 'c', noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h'
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
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.84', versionName: '3.0.84+core-sha256:abc', athena: { tabs: 1, discarded: 0 } });
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => { if (Number(ms || 0) <= 2000) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: '1p-feat_mls_writeflow.js' });
  return {
    window, document: dom.document, el: dom.resolve, boxes: dom.boxes, cardHtml: dom.cardHtml, posted, said,
    wf: window.__mlsWriteFlow,
    progressHtml: () => String(dom.resolve('mlsAthenaUnifiedProgress').innerHTML || ''),
    statusText: () => String(dom.resolve('mlsAthenaUnifiedProbe').textContent || ''),
    statusKind: () => dom.resolve('mlsAthenaUnifiedProbe').getAttribute('data-mls-status-kind'),
    actions: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2'),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    probes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe')
  };
}
async function settle(n) { for (let i = 0; i < (n || 400); i++) await new Promise(r => setImmediate(r)); }

/* ============================================================ 0. source pins
 * The wiring the runtime cases below rely on, so a refactor that quietly
 * removes it fails here rather than passing on a coincidence. */
{
  ok(FLOW.indexOf("procedure: 'Athena encounter > Physical Exam > Procedure Documentation'") > 0,
    'the op-note destination literal is gone from DESTINATION');
  ok(FLOW.indexOf("procedure: 'Procedure / operative note'") > 0,
    'procedure lost its namedNoteLabels entry, so an op note would build no named row at all');
  ok(/'note-editor-not-empty':\s*\{\s*fix:\s*true/.test(FLOW),
    'the op note\'s own refusal is not classified as one-step-recoverable');
  ok(/'patient-mismatch':\s*\{\s*fix:\s*false/.test(FLOW),
    'an identity conflict is no longer classified as unsafe');
  /* the whole point: not one entry may make a row sendable */
  const clar = FLOW.slice(FLOW.indexOf('function wfClarityRefusal'), FLOW.indexOf('/* ===== end wfclar-1.0.0'));
  ok(!/state\.probe\s*=|\.disabled\s*=\s*false|bridge\(|postMessage/.test(clar),
    'the refusal renderer touches the probe lock, a control\'s disabled state, or the bridge');
  const prog = FLOW.slice(FLOW.indexOf('function wfprogSummaryText'), FLOW.indexOf('/* ===== end wfprog-1.0.0'));
  ok(prog.indexOf("rec.status === 'verified'") > 0,
    'the progress summary counts written sections from something other than the durable receipt');
  ok(!/bridge\(|postMessage|\.disabled\s*=/.test(prog), 'the progress summary can send or enable something');
  /* wfclar's execute-side use must never paraphrase an ATTEMPTED outcome */
  ok(FLOW.indexOf('var execClar = attempted ? null : wfClarify(resp.reason);') > 0,
    'an attempted (possibly partial) Athena outcome can now be paraphrased');
}

(async function run() {
  /* ============ 1. THE OP-NOTE ROW: one row, right destination, READY ===== */
  {
    const h = makeHarness({});
    const manifest = h.wf.buildUnifiedManifest({ patient: PATIENT, sections: OP_SECTION, expectedContext: BOUND });
    const writes = manifest.rows.filter(r => r.action === 'write_note');
    eq(writes.length, 1, 'an op note did not build exactly one write row');
    eq(writes[0].kind, 'procedure', 'the op-note row is not addressed to the procedure destination');
    eq(writes[0].destination, 'Athena encounter > Physical Exam > Procedure Documentation',
      'the op-note row lost its exact Procedure Documentation destination');
    eq(writes[0].capability, 'ready', 'a bound op note did not reach READY: ' + writes[0].reason);
    eq(writes[0].payload.sectionKey, 'procedure', 'the op-note payload does not name its section key');
    eq(String(writes[0].payload.noteText), OP_BODY, 'the op-note payload is not the reviewed op-note text');
    /* Save / Sign never bind themselves to one named editor */
    manifest.rows.filter(r => r.kind === 'save' || r.kind === 'sign').forEach(r => {
      eq(r.capability, 'manual', 'a final action was bound to the op note\'s single named editor');
    });
  }
  /* the unbound control: the SAME op note with no appointment stays blocked */
  {
    const h = makeHarness({ unbound: true });
    const manifest = h.wf.buildUnifiedManifest({ patient: PATIENT, sections: OP_SECTION,
      expectedContext: { visitDate: ATHENA_DAY, provider: '', appointmentId: '', encounterId: '', encounterUrl: '' } });
    const row = manifest.rows.filter(r => r.kind === 'procedure')[0];
    ok(row, 'the unbound op note built no procedure row at all');
    eq(row.capability, 'blocked', 'an op note with no bound encounter was offered as READY');
    ok(/exact visit needs its date, provider, and appointment ID/.test(String(row.reason)),
      'the unbound op note does not name what is missing: ' + row.reason);
  }

  /* ====== 2. IT REACHES AN EXECUTE AND A VERIFIED RECEIPT, SAME PATH ====== */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: OP_SECTION, expectedContext: BOUND, receiptSessionId: 'op-happy' });
    await settle(120);
    const row = manifest.rows.filter(r => r.action === 'write_note')[0];
    /* the single reviewed section is shown in full, not folded away */
    ok(h.cardHtml().indexOf('Review the exact text going to Athena encounter > Physical Exam > Procedure Documentation') > 0,
      'the op note\'s only reviewed body is still hidden behind the payload fold');
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, false, 'the op-note sheet never enabled its send after the read-only check verified');
    go.click();
    await settle(900);
    eq(h.executes().length, 1, 'the op note did not reach exactly one execute');
    eq(h.executes()[0].action, 'write_note', 'the op note ran an action other than the reviewed note write');
    eq(String(h.executes()[0].sections[0].key), 'procedure', 'the executed section is not the procedure section');
    ok(h.probes().length >= 1, 'the op note executed without its own read-only probe');
    const rec = h.wf.diagnostics.state().receipts[row.id];
    ok(rec && rec.status === 'verified', 'the op-note write produced no verified receipt');
    eq(rec.rowHash, row.rowHash, 'the op-note receipt is not bound to that exact immutable row');
    /* the status line keeps the receipt's own sentence... */
    ok(/read back successfully/.test(h.statusText()), 'the op-note status line lost its receipt sentence: ' + h.statusText());
    /* ...and the loading surface's headline is the receipt-DERIVED summary */
    const summary = h.wf.diagnostics.progress.headline();
    ok(/Done: 1 of 1 section written to Athena and read back\./.test(summary),
      'the final summary does not report the receipt-backed count: ' + summary);
    ok(/Nothing was saved or signed/.test(summary), 'the final summary dropped the save/sign honesty: ' + summary);
    ok(h.progressHtml().indexOf('data-mls-prog-pct="100"') > 0, 'a verified single write never filled its bar');
  }

  /* == 3a. THE OP NOTE'S OWN REFUSAL IS AMBER, PLAIN, AND CARRIES THE CURE == */
  {
    const h = makeHarness({
      onAction: (m, dflt) => (m.mode === 'probe'
        ? { ok: false, blocked: true, reason: 'note-editor-not-empty' }
        : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: OP_SECTION, expectedContext: BOUND, receiptSessionId: 'op-notempty' });
    await settle(400);
    const text = h.statusText();
    eq(h.statusKind(), 'fix', 'the op note\'s one-step refusal is still painted as a failure: ' + text);
    ok(text.indexOf('note-editor-not-empty') < 0, 'the raw machine reason is still shown to the doctor: ' + text);
    ok(/^One step needed:/.test(text), 'the refusal does not open as one named step: ' + text);
    ok(text.indexOf('Athena encounter > Physical Exam > Procedure Documentation') > 0,
      'the refusal does not name WHICH field already holds text: ' + text);
    ok(/never types over text/.test(text), 'the refusal does not say why MLS will not just overwrite it: ' + text);
    ok(/Nothing was changed and nothing was sent\./.test(text), 'the refusal dropped the nothing-changed honesty: ' + text);
    /* the controls that fit it: re-check, and copy so the doctor can paste */
    ok(h.el('mlsAthenaUnifiedRecheck'), 'a recoverable refusal offered no read-only re-check');
    const copy = h.el('mlsAthenaUnifiedCopySection');
    ok(copy, 'the field-already-has-text refusal offered no way to take the text by hand');
    eq(copy.textContent, 'Copy this section', 'the copy control is not named for what it does');
    ok(/nothing is written/i.test(String(copy.title)), 'the copy control does not say it is read-only');
    /* and NOTHING was sent - not on the refusal, and not on a second press.
       The merged button stays the doctor's next move by design (sheetux-1.0.0);
       what may never happen is an execute without a fresh validated probe. */
    eq(h.executes().length, 0, 'a refused op-note check reached an execute');
    h.wf.diagnostics.sheetUx.press(h.el('mlsAthenaUnifiedGo'));
    await settle(600);
    eq(h.executes().length, 0, 'pressing send again after a refusal wrote to Athena anyway');
    ok(/Done: 0 of 1 section written to Athena and read back\./.test(h.statusText()),
      'the re-press summary claims something landed: ' + h.statusText());
    ok(/Not sent: Write reviewed Procedure \/ operative note/.test(h.statusText()),
      'the re-press summary does not name the op-note section it could not send: ' + h.statusText());
  }
  /* 3b. THE UNSAFE CONTROL: same shape of refusal, opposite verdict --------- */
  {
    const h = makeHarness({
      onAction: (m, dflt) => (m.mode === 'probe'
        ? { ok: false, blocked: true, reason: 'patient-mismatch' }
        : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: OP_SECTION, expectedContext: BOUND, receiptSessionId: 'op-mismatch' });
    await settle(400);
    const text = h.statusText();
    eq(h.statusKind(), 'err', 'a wrong-chart refusal stopped being an error: ' + text);
    ok(/is not this patient/.test(text), 'the wrong-chart refusal changed its meaning: ' + text);
    ok(/no shortcut past this/.test(text), 'the wrong-chart refusal offers itself as recoverable: ' + text);
    eq(h.el('mlsAthenaUnifiedDoIt'), null, 'an identity conflict offered a do-it-for-me control');
    eq(h.el('mlsAthenaUnifiedCopySection'), null, 'an identity conflict offered to hand over the note text anyway');
    eq(h.executes().length, 0, 'an identity conflict reached an execute');
  }
  /* 3c. an UNKNOWN reason keeps exactly the behaviour it had (no silent
        widening of the amber class) ---------------------------------------- */
  {
    const h = makeHarness({
      onAction: (m, dflt) => (m.mode === 'probe'
        ? { ok: false, blocked: true, reason: 'some-brand-new-code', error: 'Athena said no.' }
        : dflt(m))
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: OP_SECTION, expectedContext: BOUND, receiptSessionId: 'op-unknown' });
    await settle(400);
    eq(h.statusKind(), 'err', 'an unclassified refusal was quietly promoted to amber: ' + h.statusText());
    ok(h.statusText().indexOf('Athena said no.') === 0, 'an unclassified refusal lost the extension\'s own sentence');
  }

  /* ========== 4. THE LOADING SURFACE: which section, N of M, verdicts ===== */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'op-prog' });
    await settle(120);
    const rows = manifest.rows.filter(r => r.action === 'write_note' && r.capability === 'ready');
    eq(rows.length, 3, 'the three-section fixture did not build one ready row per named section');
    eq(h.progressHtml(), '', 'the progress surface painted before anything was sent');
    h.el('mlsAthenaUnifiedGo').click();
    await settle(2400);
    const html = h.progressHtml();
    ok(html.indexOf('data-mls-prog-headline') > 0, 'the progress surface never painted a headline');
    ok(/data-mls-prog-pct="100"/.test(html), 'a finished send never filled its bar');
    const checked = h.boxes().filter(b => b.checked).length;
    eq(h.executes().length, checked, 'the batch did not execute exactly the checked sections');
    /* one settled verdict per section, and every "written" is receipt-backed */
    const state = h.wf.diagnostics.state();
    const snap = h.wf.diagnostics.progress.snapshot();
    ok(snap, 'the progress surface kept no snapshot of what it reported');
    eq(snap.rows.length, checked, 'the progress surface tracked a different number of sections than were sent');
    snap.rows.forEach(r => {
      ok(r.phase !== 'wait' && r.phase !== 'check' && r.phase !== 'write',
        'a finished send left ' + r.label + ' with an unsettled phase: ' + r.phase);
      if (r.phase === 'done') {
        const rec = state.receipts[r.id];
        ok(rec && rec.status === 'verified',
          'the progress surface called ' + r.label + ' written with no verified receipt behind it');
      }
    });
    const counts = h.wf.diagnostics.progress.counts();
    eq(counts.pending, 0, 'a finished send left sections pending');
    eq(counts.written, checked, 'the progress counts disagree with the receipts');
    /* the honest final summary */
    const summary = h.statusText();
    ok(new RegExp('Done: ' + checked + ' of ' + checked + ' sections written to Athena and read back\\.').test(summary),
      'the final summary is not the receipt-derived count: ' + summary);
    ok(/Nothing was saved or signed/.test(summary), 'the final summary dropped the save/sign honesty: ' + summary);
  }
  /* 4b. a MIXED run: the summary may not launder a refusal into a write ---- */
  {
    let probes = 0;
    const h = makeHarness({
      onAction: (m, dflt) => {
        if (m.mode !== 'probe') return dflt(m);
        probes++;
        /* refuse the SECOND section only, with the op note's own refusal */
        return probes === 2 ? { ok: false, blocked: true, reason: 'note-editor-not-empty' } : dflt(m);
      }
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'op-mixed' });
    await settle(120);
    const total = h.boxes().filter(b => b.checked).length;
    h.el('mlsAthenaUnifiedGo').click();
    await settle(2400);
    const snap = h.wf.diagnostics.progress.snapshot();
    const written = snap.rows.filter(r => r.phase === 'done').length;
    const refused = snap.rows.filter(r => r.phase === 'refused' || r.phase === 'timeout').length;
    eq(refused, 1, 'the refused section is not reported as not-sent');
    eq(written, total - 1, 'the sections that did land are not all reported as written');
    eq(h.executes().length, total - 1, 'a refused read-only check still reached an execute');
    const summary = h.statusText();
    ok(new RegExp('Done: ' + (total - 1) + ' of ' + total + ' sections written').test(summary),
      'the mixed summary overstates what landed: ' + summary);
    ok(/Not sent: /.test(summary), 'the mixed summary does not name the section that did not go: ' + summary);
  }

  /* ================= 5. ZERO CHECKED STILL REFUSES (b1083 law) ============ */
  {
    const h = makeHarness({});
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: THREE, expectedContext: BOUND, receiptSessionId: 'op-zero' });
    await settle(120);
    h.boxes().forEach(b => { b.checked = false; });
    h.wf.diagnostics.sheetUx.sync(h.wf.diagnostics.state());
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, true, 'the send button stayed live with nothing checked');
    h.wf.diagnostics.sheetUx.press(go);
    await settle(200);
    eq(h.executes().length, 0, 'a zero-checked press sent something');
    eq(h.progressHtml(), '', 'a zero-checked press painted a loading surface for a send that never started');
    ok(/Check at least one READY note section/.test(h.statusText()),
      'a zero-checked press did not say why nothing ran: ' + h.statusText());
  }

  /* ======= 6. THE SHELL: neither op-note send path dead-ends in silence === */
  {
    const bodies = SHELLS.map(name => fs.readFileSync(path.join(ROOT, name), 'utf8'));
    bodies.forEach((src, i) => {
      ok(src.indexOf('function _opSendRefused(i){') > 0, SHELLS[i] + ' has no op-note send refusal voice at all');
      ok(src.indexOf('try{ window._opSendRefused(i); }catch(_e2){} return;') > 0,
        SHELLS[i] + ': the card control still returns in silence when the save produced no sendable record');
      ok(src.indexOf("if (typeof window._opSendRefused === 'function') window._opSendRefused(refusedAt);") > 0,
        SHELLS[i] + ': the room primary still returns in silence when the save produced no sendable record');
      /* scan CODE, not the block comment that quotes the old shape */
      const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ');
      ok(code.indexOf('if(!rec2) return;') < 0 && code.indexOf('if (!rec2) return;') < 0,
        SHELLS[i] + ': a bare silent return on an unsendable op note survives');
      /* the refusal names the ONE thing wrong and never claims a send */
      const fnAt = src.indexOf('function _opSendRefused(i){');
      const body = src.slice(fnAt, src.indexOf('try{ window._opSendRefused=_opSendRefused; }', fnAt));
      ok(/unresolved field/.test(body), SHELLS[i] + ': the draft case does not name the unresolved fields');
      ok(/opNoteBlankTokens/.test(body), SHELLS[i] + ': the refusal counts blanks with something other than the canonical parser');
      ok((body.match(/Nothing was sent\./g) || []).length === 2, SHELLS[i] + ': a refusal branch does not say nothing was sent');
      ok(!/pushHistoryNoteToAthena|opPrepSave\(/.test(body), SHELLS[i] + ': the refusal voice sends or saves something');
      /* it must not overwrite opPrepSave's own receipt line */
      ok(/appendChild\(line\)/.test(body), SHELLS[i] + ': the refusal replaces the save receipt instead of standing beside it');
    });
    eq(bodies[0].indexOf('function _opSendRefused(i){') > 0, bodies[1].indexOf('function _opSendRefused(i){') > 0,
      'the two 1p shells did not both receive the refusal voice');
    /* byte-identical block in both shells */
    const lift = (src) => src.slice(src.indexOf('/* ===== opnsend-2.2.0'), src.indexOf('try{ window.opPrepSendToAthena=opPrepSendToAthena; }'));
    eq(lift(bodies[0]), lift(bodies[1]), 'the opnsend-2.2.0 block is not byte-identical across the two 1p shells');
  }

  /* ===== 7. THE THIRD OP-NOTE SURFACE: the writeback chat console ========= */
  {
    /* mls-connect.js says in as many words that feat_athena_opnote_writeback.js
       (window.__mlsOpWb) is INTENTIONALLY not loaded, so the console's op-note
       branch was reached every single time - and answered with a module fault
       plus "reload the MLS page", which can never help. */
    const connect = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
    ok(/feat_athena_opnote_writeback\.js intentionally not loaded/.test(connect),
      'the premise changed: the op-note writeback module is loaded again, so this section needs rewriting');
    const con = fs.readFileSync(path.join(ROOT, 'feat_mls_wb_console.js'), 'utf8');
    const at = con.indexOf('function proposeWrite(kind) {');
    ok(at > 0, 'the writeback console lost its write proposal');
    const body = con.slice(at, con.indexOf('function proposeSign()', at));
    ok(/!mod && kind === 'opnote'/.test(body), 'the console still treats the deliberately-absent op-note module as a fault');
    ok(body.indexOf('Send to Athena') > 0, 'the console does not name the control that actually writes an op note');
    ok(body.indexOf('Athena encounter > Physical Exam > Procedure Documentation') > 0,
      'the console does not name the op note\'s exact destination');
    ok(/already has text in it/.test(body), 'the console does not warn about the template skeleton it will refuse to overwrite');
    /* the op-note branch must not promise a write of its own */
    const opBranch = body.slice(body.indexOf("!mod && kind === 'opnote'"), body.indexOf("if (!mod) return"));
    ok(!/writeOpNote|writeNoteToChart|postMessage|pending =/.test(opBranch),
      'the console\'s op-note answer started a write of its own instead of naming the reviewed route');
    /* the ORDINARY note branch is untouched */
    ok(body.indexOf("I can't reach the note writeback module right now") > 0,
      'the ordinary note branch lost its own honest module-missing refusal');
  }

  console.log('PASS 1p-writeflow-opnote-clarity-progress: ' + checks + ' checks - the op note builds ONE ready Procedure Documentation row and writes through the same reviewed path with its own receipt; its own refusal (the field already holds the template skeleton) is amber, plain and carries re-check + copy while a wrong-chart refusal stays red with none; the loading surface reports which section, N of M and a receipt-derived summary that cannot overstate what landed; zero checked still refuses; and neither op-note send path in either 1p shell dead-ends in silence');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
