'use strict';
/*
 * write-auto-chain (wfauto-1.0.0) - THE AUTOMATIC RE-CHECK CYCLE
 * =============================================================================
 * Owner, 2026-08-31: "writes need to be even more seamless and work every
 * time." The unified write sheet was already correct and (since b1146) clear.
 * What it was not, was FINISHED: when athenaOne sat on the dashboard the sheet
 * honestly said so, drove the read-only open, paced its re-probes (openpace:
 * 12s settle, up to 4 x 15s) - and then, in several measured live runs, stopped
 * ONE HOP SHORT of READY because the encounter finished painting a few seconds
 * after that budget ran out. The doctor had to press "Check Athena again" on a
 * surface that was already fine. The same seam bites after a MANUAL fix: the
 * doctor opens the encounter himself and then has to remember to press.
 *
 * THE TERMINAL STATES THAT STOP THE SHIPPED CHAIN (read out of the source and
 * exercised below, each one with a human press as its only exit):
 *   T1 the openpace budget is exhausted while the open is still fresh - the
 *      frame-missing tail prints "To unlock: ... press Check Athena again",
 *      in ERROR RED, about a surface that is merely still loading;
 *   T2 the read-only procedure-section probe answers "not on screen";
 *   T3 wfdxOpenEncounter's own ladder refuses (this exact row is not on the
 *      painted grid / the open did not start / the Day view could not be
 *      re-proven);
 *   T4 the one-per-review auto-open could not open the chart;
 *   T5 any WFCLAR fix-class refusal - no-chart-open, rows-not-rendered,
 *      timeout, open-timeout, appointment-id-not-found, unresolved-after-pull,
 *      note-editor-not-empty, ambiguous-athena-tabs, appointment-id-missing.
 * ALL FIVE land in unifiedRecheckButton() or unifiedRecoverableStatus(). Those
 * two settle latches are the only place wfauto-1.0.0 hooks, which is why the
 * probe / execute / token / identity path is byte-identical (section 0).
 *
 * WHAT THIS SUITE REFUSES TO LET THE CYCLE BECOME:
 *   - it may never retry a POSITIVE refusal (wrong patient, wrong DOB, wrong
 *     day, a token/identity refusal, an expired athenaOne session, no athenaOne
 *     tab). Section 2 proves each one is terminal AND latches the sheet;
 *   - it may never run unbounded. Sections 1 and 3 walk it to both of its
 *     bounds and read the honest stop sentence off the state line;
 *   - it may never press an execute path, mint a token, enable Confirm, or
 *     re-drive navigation into a painting encounter. Sections 3 and 6;
 *   - it may never run while a write, a batch or a closed sheet says no.
 *     Section 5.
 *
 * Everything here runs against the REAL 1p-feat_mls_writeflow.js in a vm, over
 * a stubbed extension bridge and a clock that only moves when this file says
 * so - so a bounded backoff can be walked to its end in milliseconds without
 * one real second of waiting.
 *
 * NOT registered in run-all.js (stage lane).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const FLOW_FILE = '1p-feat_mls_writeflow.js';
const FLOW = fs.readFileSync(path.join(ROOT, FLOW_FILE), 'utf8');

let checks = 0;
function ok(cond, msg) { checks++; if (!cond) { console.error('FAIL: ' + msg); process.exit(1); } }
function eq(got, want, msg) { ok(got === want, msg + ' (got ' + JSON.stringify(got) + ', want ' + JSON.stringify(want) + ')'); }

const DAY = '2026-08-31';
const ATHENA_DAY = '08/31/2026';
const OTHER_ATHENA_DAY = '08/30/2026';
const APPOINTMENT = '99001';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-ac', patientId: 'syn-ac', name: 'Synthetic Patient AutoChain', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-ac', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const BOUND = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const ONE = [{ key: 'hpi', text: 'Synthetic HPI body for the write-auto-chain suite.' }];
function clone(v) { return JSON.parse(JSON.stringify(v)); }

/* ================================================================== 0. BYTES
 * The write path, pinned by SHA-256 against base b1146 (02158d65) - the SAME
 * seven regions the sheet-clarity suite pins, recomputed here so this lane
 * cannot quietly move one of them and still call itself orchestration. An
 * automatic re-check that had to edit the probe, the execute, the receipt mint
 * or either closed allowlist would not be orchestration; it would be a new
 * write path wearing one. */
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
  /* MOVED DELIBERATELY A SECOND TIME, pullshield-1.0.0 (2026-09-02). The one
     caller of wfbindPullBusy() that never consulted it: this queue probed
     straight into the single athenaOne tab a schedule pull was driving, and a
     pull that ENDS drives athenaOne back to its dashboard - the surface every
     read-only check refuses on. The step now awaits a bounded, hidden-safe wait
     on that same lease before it checks a row, and a pull that never lets go
     settles the row as NOT ATTEMPTED (an attempt record, never a receipt) and
     the queue moves on. Every gate, latch, bound, token, payload and receipt
     path in this region is untouched - it can only DELAY or SKIP. Measured, not
     assumed: on the pre-edit staged tree this region still hashed to 44e41349,
     so savenamed-app-1.0.0 did not move it. Proven in
     tests/paintwait-queue-proof.js. */
  ['batch queue (runUnifiedBatchSend: per-row probe/execute/receipt sequencing)',
    '  function runUnifiedBatchSend(state, btn) {', '  function reopenOptions(opts, manifest) {',
    '85e30a6375f57e7637dbc2a4380d978be55e47f7bd9b99b0ee7d60c11acceac1'],
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
    eq(got, want, 'THE WRITE PATH CHANGED - the auto-chain lane is orchestration and may not touch it: ' + name);
  });
  /* the auto cycle re-probes, and that is ALL it may ever call. */
  const mod = FLOW.slice(FLOW.indexOf('/* ===== wfauto-1.0.0'), FLOW.indexOf('/* ===== end wfauto-1.0.0'));
  ok(mod.length > 2000, 'the wfauto-1.0.0 module is not where this suite expects it');
  eq(/executeUnifiedSelection|runUnifiedBatchSend|actionToken|mlsAppAthenaActionV2|mlsAppGotoDate|mlsAppSearchOpenPatient/.test(mod), false,
    'THE AUTOMATIC RE-CHECK REACHED FOR A WRITE, A TOKEN, OR A NAVIGATION VERB - it may only re-run the read-only probe');
  ok(mod.indexOf('probeUnifiedRow(state, rowId)') > 0, 'the automatic cycle no longer re-runs the read-only row check at all');
  /* navepoch-1.0.0 and sheetclar-1.0.0 are still in this file and untouched. */
  ok(FLOW.indexOf('navepoch-1.0.0') > 0, 'navepoch-1.0.0 was regressed out of the flow');
  ok(FLOW.indexOf('sheetclar-1.0.0') > 0, 'sheetclar-1.0.0 was regressed out of the flow');
  ok(FLOW.indexOf("var SHEETUX_ZERO_REASON = 'Check at least one READY note section first") > 0,
    'the zero-checked refusal changed out from under the sheet-ux suite');
}

/* ------------------------------------------------------------ fake clock ---
 * Time moves only when this file says so, and every setTimeout the flow
 * schedules lands in this queue. That is what makes a three-minute bounded
 * backoff walkable in one millisecond - and it is the only way to tell a
 * cycle that STOPPED from one that is merely still waiting. */
function makeClock() {
  let t = Date.UTC(2026, 7, 31, 15, 0, 0);
  let seq = 1;
  const timers = new Map();
  function D(a, b, c, d, e, f, g) {
    if (arguments.length === 0) return new Date(t);
    if (arguments.length === 1) return new Date(a);
    return new Date(a, b, c || 1, d || 0, e || 0, f || 0, g || 0);
  }
  D.now = () => t;
  D.parse = Date.parse; D.UTC = Date.UTC; D.prototype = Date.prototype;
  return {
    D,
    now: () => t,
    pending: () => timers.size,
    set(fn, ms) { const id = seq++; timers.set(id, { at: t + Math.max(0, Number(ms) || 0), fn }); return id; },
    clear(id) { timers.delete(id); },
    async advance(ms) {
      const target = t + Math.max(0, Number(ms) || 0);
      for (let guard = 0; guard < 4000; guard++) {
        let bestId = 0, bestAt = Infinity;
        timers.forEach((v, k) => { if (v.at <= target && (v.at < bestAt || (v.at === bestAt && k < bestId))) { bestAt = v.at; bestId = k; } });
        if (!bestId) break;
        const timer = timers.get(bestId);
        timers.delete(bestId);
        if (timer.at > t) t = timer.at;
        try { timer.fn(); } catch (e) {}
        await flush(40);
      }
      if (target > t) t = target;
      await flush(40);
    }
  };
}
async function flush(n) { for (let i = 0; i < (n || 120); i++) await new Promise(r => setImmediate(r)); }

/* ---------------------------------------------------------------- DOM shim
 * The same shape the sheet-ux / sheet-clarity harnesses use, plus the two
 * things this suite must be able to observe: real per-type listener
 * registration (so a focus/visibility wake can be fired AND its removal
 * proven) and a settable document.visibilityState. */
const LIVE_IDS = ['mlsAthenaUnifiedRecheck', 'mlsAthenaUnifiedDoIt', 'mlsAthenaUnifiedCopySection'];
function makeDom() {
  const byId = new Map();
  const live = new Map();
  const docHandlers = new Map();
  let card = null;

  function checkbox(rowId, tail) {
    const markupChecked = /(^|\s)checked(\s|$|>)/.test(String(tail || ''));
    const el = {
      tagName: 'INPUT', type: 'checkbox', checked: markupChecked, id: '', style: {}, children: [],
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
      set(v) { html = String(v); el._bx = null; forget(el.children); el.children.length = 0; if (html.indexOf('mlsAthenaUnifiedGo') >= 0) card = el; }
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
    readyState: 'complete', activeElement: null, visibilityState: 'visible',
    body: node('body'), head: node('head'), documentElement: node('html'),
    addEventListener(type, fn) { const l = docHandlers.get(type) || []; l.push(fn); docHandlers.set(type, l); },
    removeEventListener(type, fn) { const l = docHandlers.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); docHandlers.set(type, l); },
    querySelector(sel) { return resolve(sel); },
    querySelectorAll(sel) { return (/mls-bx-check/.test(String(sel || '')) && card) ? boxesOf(card) : []; },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return {
    document, resolve, docHandlers,
    fireDoc(type) { (docHandlers.get(type) || []).slice().forEach(fn => { try { fn({ type }); } catch (e) {} }); },
    docCount(type) { return (docHandlers.get(type) || []).length; }
  };
}

function makeHarness(options) {
  options = options || {};
  const dom = makeDom();
  const clock = makeClock();
  const winHandlers = new Map();
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
    addEventListener(type, fn) { const l = winHandlers.get(type) || []; l.push(fn); winHandlers.set(type, l); },
    removeEventListener(type, fn) { const l = winHandlers.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); winHandlers.set(type, l); },
    postMessage(message) { posted.push(message); route(message); }
  };
  window.window = window;

  function deliver(type, requestId, resp) {
    Promise.resolve().then(() => (winHandlers.get('message') || []).slice().forEach(fn => fn({ data: { source: 'mls-ext', type, requestId, resp } })));
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
        noteWriteProof: 'proof-' + ENCOUNTER, noteWriteProofExpiresAt: clock.now() + 600000, context: clone(CONTEXT) };
    }
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token',
      rowHash: m.rowHash, clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: clone(CONTEXT) };
  }
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId, options.onAction ? options.onAction(m, defaultAction) : defaultAction(m));
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, options.onOpen ? options.onOpen(m) : { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, options.onGoto ? options.onGoto(m) : { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, { ok: true, version: '3.0.62', versionName: '3.0.62+core-sha256:abc', athena: { tabs: 1, discarded: 0 } });
  }

  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date: clock.D, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat, Error,
    setTimeout: (fn, ms) => clock.set(fn, ms),
    clearTimeout: (id) => clock.clear(id),
    setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: FLOW_FILE });
  const wf = window.__mlsWriteFlow;
  return {
    window, document: dom.document, clock, posted, wf, dom,
    el: dom.resolve,
    auto: () => wf.diagnostics.autoChain,
    snap: () => wf.diagnostics.autoChain.snapshot(),
    state: () => wf.diagnostics.state(),
    stateWord: () => dom.resolve('mlsAthenaUnifiedState').getAttribute('data-mls-sheet-state'),
    shortLine: () => ((/data-mls-state-short="1"[^>]*>([^<]*)</.exec(String(dom.resolve('mlsAthenaUnifiedState').innerHTML || '')) || [])[1] || ''),
    statusText: () => String(dom.resolve('mlsAthenaUnifiedProbe').textContent || ''),
    detailsOpen: () => dom.resolve('mlsAthenaUnifiedDetails').open === true,
    probes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe'),
    executes: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute'),
    opens: () => posted.filter(m => m.type === 'mlsAppSearchOpenPatient'),
    gotos: () => posted.filter(m => m.type === 'mlsAppGotoDate'),
    fireDoc: dom.fireDoc,
    docCount: dom.docCount,
    winCount: (type) => (winHandlers.get(type) || []).length,
    fireWin: (type) => (winHandlers.get(type) || []).slice().forEach(fn => { try { fn({ type }); } catch (e) {} })
  };
}

/* A stub that refuses `fails` read-only checks with `reason` and then answers
   normally. That is the whole shape of the live seam: a surface that is not
   ready YET and then is. */
function refuseThenAnswer(reason, fails) {
  const box = { left: fails };
  return {
    box,
    onAction: (m, dflt) => {
      if (m.mode !== 'probe') return dflt(m);
      if (box.left > 0) { box.left--; return { ok: false, blocked: true, reason: reason }; }
      return dflt(m);
    }
  };
}
async function openSheet(h, session) {
  h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: ONE, expectedContext: BOUND, receiptSessionId: session });
  await flush(200);
  await h.clock.advance(1);
}
function rowIdOf(h) {
  const st = h.state();
  return st && st.selectedRowId;
}

(async function main() {
  /* ============ 1. A RETRYABLE REFUSAL KEEPS GOING, AND REACHES READY ======
   * The doctor presses nothing. One refused read-only check arms the cycle;
   * twenty seconds later MLS re-runs the SAME read-only check by itself; the
   * surface has finished and the sheet lands on READY - still with an unpressed
   * Confirm & Send, because that click is the doctor's and always will be. */
  {
    const stub = refuseThenAnswer('probe-frame-missing', 1);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'auto-reaches-ready');

    eq(h.probes().length, 1, 'the sheet did not run its one read-only check on open');
    eq(h.stateWord(), 'NEEDS ONE STEP', 'a one-step refusal stopped being summarised as one step: ' + h.stateWord());
    eq(h.detailsOpen(), true, 'sheetclar-1.0.0 REGRESSED: a refusal was folded away');
    ok(/^One step needed:/.test(h.statusText()), 'the refusal lost its own opening words: ' + h.statusText());
    ok(/Nothing was changed and nothing was sent\./.test(h.statusText()), 'the refusal dropped the nothing-changed honesty');
    ok(h.statusText().indexOf('re-checking') < 0 && h.statusText().indexOf('by itself') < 0,
      'THE AUTO-RETRY WROTE INTO #mlsAthenaUnifiedProbe - every refusal pin reads that node unchanged: ' + h.statusText());

    const armed = h.snap();
    ok(armed && armed.armed === true, 'a retryable refusal did not arm the automatic re-check');
    eq(armed.mode, 'settled', 'a refusal with no fresh open should take the gentle settled cadence');
    eq(armed.waitMs, 20000, 'the settled cadence is not the ~20s the owner asked for');
    eq(armed.code, 'probe-frame-missing', 'the cycle armed on evidence it did not measure');
    ok(/check Athena again by itself/.test(h.shortLine()), 'the state line does not narrate the automatic re-check: ' + h.shortLine());
    ok(/Nothing was changed/.test(h.shortLine()), 'the automatic narration dropped the nothing-changed honesty');

    /* nineteen seconds is not twenty */
    await h.clock.advance(19000);
    eq(h.probes().length, 1, 'the automatic re-check fired before its own backoff');

    await h.clock.advance(1500);
    eq(h.probes().length, 2, 'THE AUTOMATIC RE-CHECK NEVER FIRED - this is the whole seam');
    eq(h.executes().length, 0, 'the automatic cycle reached an execute');
    eq(h.stateWord(), 'READY', 'the automatic re-check did not carry the sheet to READY: ' + h.stateWord());
    ok(h.wf.diagnostics.sheetClarity.readyRow() !== null, 'READY was painted without a validated probe bound to the row');
    const go = h.el('mlsAthenaUnifiedGo');
    eq(go.disabled, false, 'READY left Confirm grayed');
    const after = h.snap();
    ok(!after || after.armed === false, 'the cycle stayed armed after it succeeded');

    /* the human click is untouched: nothing was sent until it happened */
    eq(h.executes().length, 0, 'something was written without a human Confirm & Send');
    h.wf.diagnostics.sheetUx.press(go);
    await flush(300);
    await h.clock.advance(1);
    eq(h.executes().length, 1, 'the human Confirm & Send stopped working');
  }

  /* ---- and the settled tier is BOUNDED: three automatic tries, then it says
   * so out loud and stops rather than loop forever against a real refusal. */
  {
    const stub = refuseThenAnswer('no-chart-open', 99);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'auto-settled-bound');
    eq(h.probes().length, 1, 'the opening read-only check did not run');
    ok(h.snap().armed === true, 'a no-chart-open refusal did not arm the cycle');

    for (let i = 0; i < 6; i++) await h.clock.advance(21000);
    eq(h.probes().length, 4, 'the settled cadence is not bounded at three automatic re-checks');
    const s = h.snap();
    eq(s.settledTries, 3, 'the settled counter disagrees with the probes it caused');
    eq(s.armed, false, 'an exhausted cycle is still armed');
    eq(s.exhausted, true, 'the exhausted cycle did not record that it gave up');
    ok(/it stopped rather than loop/.test(h.shortLine()), 'the bounded stop is not said honestly on the state line: ' + h.shortLine());
    ok(/needs you/.test(h.shortLine()), 'the bounded stop does not hand the next step back to the doctor');
    eq(h.executes().length, 0, 'a bounded stop still reached an execute');

    /* and it stays stopped */
    await h.clock.advance(600000);
    eq(h.probes().length, 4, 'a stopped cycle woke itself up again');
  }

  /* ============ 2. POSITIVE REFUSALS ARE TERMINAL, AND LATCH ===============
   * Wrong patient, wrong DOB, wrong day, a token refusal, an expired session,
   * no athenaOne tab. Every one of these means a HUMAN has to look. Not one of
   * them may ever be retried automatically, and each one disarms this module
   * for the life of the sheet. */
  {
    const NEVER = [
      ['patient-mismatch', 'the chart open in athenaOne is a different person'],
      ['dob-mismatch', 'the DOB in the open chart disagrees with the note'],
      ['mrn-conflict', 'the MRN in the open chart conflicts'],
      ['provider-mismatch', 'the encounter belongs to another clinician'],
      ['practice-mismatch', 'the open practice is not the one reviewed'],
      ['account-mismatch', 'the signed-in account is not the one reviewed'],
      ['session-expired', 'the athenaOne session is signed out'],
      ['no-athena-tab', 'there is no signed-in athenaOne tab at all'],
      ['preview-hash-mismatch', 'the review changed after its immutable hash'],
      ['note-payload-mismatch', 'the text Athena was asked to place is not the reviewed text'],
      ['unsafe-note-policy', 'empty-field placement was not carried'],
      ['write-safety-guard-missing', 'the write-safety guard is not loaded']
    ];
    for (const pair of NEVER) {
      const code = pair[0], why = pair[1];
      const stub = refuseThenAnswer(code, 99);
      const h = makeHarness({ onAction: stub.onAction });
      await openSheet(h, 'never-' + code);
      eq(h.probes().length, 1, code + ': the opening read-only check did not run');
      const s = h.snap();
      ok(!s || s.armed === false, 'A POSITIVE REFUSAL ARMED AN AUTOMATIC RETRY (' + code + ' - ' + why + ')');
      eq(h.auto().positiveLatch(), code, code + ': the positive refusal did not latch the sheet');
      eq(h.auto().eligible(), null, code + ': the cycle still considers this retryable');
      await h.clock.advance(600000);
      eq(h.probes().length, 1, 'MLS AUTOMATICALLY RETRIED A POSITIVE REFUSAL (' + code + ' - ' + why + ')');
      eq(h.executes().length, 0, code + ': a positive refusal reached an execute');
      /* and a human press still works - honesty, not paralysis */
      const btn = h.el('mlsAthenaUnifiedRecheck');
      if (btn) { btn.click(); await flush(200); await h.clock.advance(1); eq(h.probes().length, 2, code + ': the human re-check button stopped working'); }
    }
  }
  {
    /* the identity lock: the probe ANSWERED ok and MLS refused it afterwards.
       That is positive by construction and may never be retried. */
    const h = makeHarness({
      onAction: (m, dflt) => { const r = dflt(m); if (m.mode === 'probe') r.context = Object.assign({}, r.context, { dob: '11/11/1911' }); return r; }
    });
    await openSheet(h, 'never-identity-lock');
    eq(h.stateWord(), 'CAN’T SEND', 'an identity conflict was softened: ' + h.stateWord());
    const s = h.snap();
    ok(!s || s.armed === false, 'AN IDENTITY-LOCK REFUSAL ARMED AN AUTOMATIC RETRY');
    ok(h.auto().positiveLatch().length > 0, 'the identity-lock refusal did not latch the sheet');
    eq(h.auto().lastProbe().ok, true, 'the suite is not exercising the ok-probe-then-refused path it claims to');
    await h.clock.advance(600000);
    eq(h.probes().length, 1, 'MLS AUTOMATICALLY RETRIED AN IDENTITY CONFLICT');
    eq(h.executes().length, 0, 'an identity conflict reached an execute');
  }
  {
    /* the display-vs-execute DAY gate: the probe verified an encounter dated
       on another day. Wrong day is terminal, always. */
    const h = makeHarness({
      onAction: (m, dflt) => { const r = dflt(m); if (m.mode === 'probe') r.context = Object.assign({}, r.context, { visitDate: OTHER_ATHENA_DAY }); return r; }
    });
    await openSheet(h, 'never-day');
    ok(/not write to an encounter it is not showing you/.test(h.statusText()), 'the day gate changed its words: ' + h.statusText());
    const s = h.snap();
    ok(!s || s.armed === false, 'A WRONG-DAY REFUSAL ARMED AN AUTOMATIC RETRY');
    eq(h.auto().positiveLatch(), 'display-execute-day-mismatch', 'the wrong-day refusal did not latch the sheet');
    await h.clock.advance(600000);
    eq(h.probes().length, 1, 'MLS AUTOMATICALLY RETRIED A WRONG-DAY REFUSAL');
  }
  {
    /* the closed allowlist is closed: an unlisted code is not retried either */
    const stub = refuseThenAnswer('note-destination-mismatch', 99);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'never-unlisted');
    const s = h.snap();
    ok(!s || s.armed === false, 'a code outside the closed retry allowlist armed the cycle');
    await h.clock.advance(300000);
    eq(h.probes().length, 1, 'a code outside the closed retry allowlist was retried anyway');
  }

  /* ============ 3. THE PAINT TIER, ITS BACKOFF, AND ITS THREE-MINUTE WALL ==
   * This is T1/T3: MLS opened the chart itself moments ago, so the refusal is
   * evidence of a surface that is still LOADING. The cycle re-checks on a
   * widening backoff, never re-drives navigation into it, and stops at the
   * owner's bound with an honest sentence. */
  {
    const stub = refuseThenAnswer('probe-frame-missing', 99);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'auto-paint-bound');
    const rowId = rowIdOf(h);
    ok(rowId, 'no row was selected to re-check');
    eq(h.snap().mode, 'settled', 'the fixture started in the wrong tier');

    /* the ONE piece of live evidence a stub cannot mint: an open that MLS
       itself completed seconds ago (openpace-1.0.0 stamps this). */
    h.state().openedOkAt = h.clock.now();
    const openedBefore = h.opens().length, gotoBefore = h.gotos().length;
    eq(h.auto().arm(rowId), true, 'a fresh open did not re-arm the cycle');
    const p0 = h.snap();
    eq(p0.mode, 'paint', 'a fresh open did not switch the cycle to the paced paint cadence');
    eq(p0.waitMs, 9000, 'the paint backoff does not start where this suite expects');
    ok(/still painting the encounter/.test(h.shortLine()), 'the paint state is not narrated on the state line: ' + h.shortLine());
    ok(/re-checking automatically/.test(h.shortLine()), 'the owner\'s exact narration is missing: ' + h.shortLine());

    const seen = [];
    let last = h.probes().length;
    for (let i = 0; i < 8; i++) {
      await h.clock.advance(70000);
      const now = h.probes().length;
      if (now > last) seen.push(now - last);
      last = now;
    }
    eq(h.probes().length, 6, 'the paint tier did not run its five automatic re-checks (or ran more)');
    const pEnd = h.snap();
    eq(pEnd.tries, 5, 'the paint counter disagrees with the probes it caused');
    eq(pEnd.armed, false, 'the paint cycle is still armed past its bound');
    eq(pEnd.exhausted, true, 'the paint cycle did not record that it gave up');
    /* RE-AIMED DELIBERATELY, rwfix-1.0.0 (b1169). This used to pin the literal
       words "three minutes", and that sentence was a constant: the settled lane
       exhausts after three 20s re-probes (60 seconds of elapsed time) and a
       paint lane armed against an open that is already 175s old clips its last
       wait to a second or two - both then told the doctor MLS had hammered the
       surface for three minutes, so he stopped pressing a button that would
       very likely have landed. The cycle now MEASURES its own stretch and the
       number of automatic re-checks it actually ran, and this pin asserts the
       sentence against that measurement rather than against a constant - a
       stronger pin, not a weaker one: it fails if the words and the measurement
       ever disagree, which the old one could not see. The bound itself
       (WFAUTO_WINDOW_MS, five paint tries) is unchanged and still pinned above
       by pEnd.tries / probes().length. */
    eq(pEnd.autoChecks, 5, 'the exhausted cycle did not count the re-checks it actually ran: ' + JSON.stringify(pEnd));
    ok(pEnd.exhaustedMs > 0, 'the exhausted cycle never measured its own automatic stretch: ' + JSON.stringify(pEnd));
    const spanSecs = Math.max(1, Math.round(pEnd.exhaustedMs / 1000));
    const spanSaid = spanSecs < 120
      ? (spanSecs + ' second' + (spanSecs === 1 ? '' : 's'))
      : (Math.round(spanSecs / 60) + ' minute' + (Math.round(spanSecs / 60) === 1 ? '' : 's'));
    ok(h.shortLine().indexOf('re-checked Athena by itself 5 times over about ' + spanSaid) >= 0,
      'the exhausted sentence does not state the stretch it actually ran (' + spanSaid + '): ' + h.shortLine());
    ok(!/by itself for three minutes/.test(h.shortLine()),
      'the exhausted sentence still claims a fixed three-minute stretch: ' + h.shortLine());

    /* openpace-1.0.0 LAW: re-driving navigation into a painting encounter
       destroys it. The automatic cycle re-probes and NOTHING else. */
    eq(h.opens().length, openedBefore, 'THE AUTOMATIC CYCLE RE-DROVE THE PATIENT OPEN INTO A PAINTING ENCOUNTER');
    eq(h.gotos().length, gotoBefore, 'THE AUTOMATIC CYCLE RE-DROVE THE DAY VIEW INTO A PAINTING ENCOUNTER');
    eq(h.executes().length, 0, 'the paint tier reached an execute');

    await h.clock.advance(900000);
    eq(h.probes().length, 6, 'an exhausted paint cycle woke itself up again');
  }
  {
    /* the same tier, but the encounter finishes painting: it must land READY
       without one human press. */
    const stub = refuseThenAnswer('probe-frame-missing', 2);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'auto-paint-ready');
    h.state().openedOkAt = h.clock.now();
    h.auto().arm(rowIdOf(h));
    eq(h.snap().mode, 'paint', 'the paint tier did not arm');
    await h.clock.advance(40000);
    eq(h.probes().length, 3, 'the paced re-checks did not run on their backoff');
    eq(h.stateWord(), 'READY', 'a surface that finished painting did not reach READY by itself: ' + h.stateWord());
    eq(h.executes().length, 0, 'reaching READY automatically wrote something');
  }

  /* ============ 4. THE DOCTOR FIXED IT HIMSELF AND CAME BACK ===============
   * Owner: "they must remember to press Check Athena again". The return to the
   * tab IS that press. One re-check, debounced, and never while hidden. */
  {
    const stub = refuseThenAnswer('no-chart-open', 1);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'auto-focus-wake');
    eq(h.probes().length, 1, 'the opening read-only check did not run');
    ok(h.snap().armed === true, 'the refusal did not arm a cycle to wake');
    ok(h.docCount('visibilitychange') > 0, 'nothing is listening for the doctor coming back');

    /* a wake inside the debounce window is ignored - a focus storm is not
       five read-only probes into athenaOne */
    h.fireWin('focus');
    await flush(120);
    eq(h.probes().length, 1, 'a focus event inside the debounce window fired a probe anyway');

    await h.clock.advance(6000);
    /* hidden means hidden: coming back is the signal, not leaving */
    h.document.visibilityState = 'hidden';
    h.fireDoc('visibilitychange');
    await flush(120);
    eq(h.probes().length, 1, 'a HIDDEN tab fired an automatic re-check');

    h.document.visibilityState = 'visible';
    h.fireDoc('visibilitychange');
    await flush(200);
    await h.clock.advance(1);
    eq(h.probes().length, 2, 'COMING BACK TO THE TAB DID NOT TAKE THE RE-CHECK FOR THE DOCTOR');
    eq(h.stateWord(), 'READY', 'the wake re-check did not carry the sheet to READY: ' + h.stateWord());
    eq(h.executes().length, 0, 'the wake re-check wrote something');
    eq(h.docCount('visibilitychange'), 0, 'the wake listener was left registered after the cycle ended');
    eq(h.winCount('focus'), 0, 'the focus listener was left registered after the cycle ended');
  }

  /* ============ 5. RUNNING / BATCH / CLOSED ALL SAY NO =====================*/
  {
    /* closed: the timer AND both wake listeners go with the sheet */
    const stub = refuseThenAnswer('rows-not-rendered', 99);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'auto-closed');
    ok(h.snap().armed === true, 'the refusal did not arm a cycle to cancel');
    ok(h.docCount('visibilitychange') > 0, 'nothing was registered to clean up');
    h.wf.closeUnifiedConfirmation();
    await flush(120);
    eq(h.docCount('visibilitychange'), 0, 'a closed sheet left its wake listener registered');
    eq(h.winCount('focus'), 0, 'a closed sheet left its focus listener registered');
    const before = h.probes().length;
    await h.clock.advance(600000);
    eq(h.probes().length, before, 'A CLOSED SHEET KEPT PROBING ATHENA BY ITSELF');
  }
  {
    /* a write in flight: nothing automatic may touch the surface */
    const stub = refuseThenAnswer('rows-not-rendered', 99);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'auto-running');
    ok(h.snap().armed === true, 'the refusal did not arm a cycle to suppress');
    const before = h.probes().length;
    h.state().running = true;
    eq(h.auto().eligible(), null, 'the cycle considers itself eligible while a write is running');
    await h.clock.advance(120000);
    eq(h.probes().length, before, 'AN AUTOMATIC RE-CHECK RAN WHILE A WRITE WAS IN FLIGHT');
    eq(h.snap().armed, false, 'the cycle stayed armed through a running write');

    h.state().running = false;
    h.state().batchRunning = true;
    eq(h.auto().eligible(), null, 'the cycle considers itself eligible during a batch');
    eq(h.auto().arm(rowIdOf(h)), false, 'the cycle armed itself during a batch');
    await h.clock.advance(120000);
    eq(h.probes().length, before, 'AN AUTOMATIC RE-CHECK RAN DURING A BATCH SEND');

    h.state().batchRunning = false;
    h.state().halted = true;
    eq(h.auto().eligible(), null, 'the cycle considers itself eligible on a halted manifest');
    h.state().halted = false;
    h.state().generating = true;
    eq(h.auto().eligible(), null, 'the cycle considers itself eligible while the sheet is generating');
    h.state().generating = false;
    eq(h.executes().length, 0, 'a suppressed cycle reached an execute somehow');
  }
  {
    /* a stale generation cannot fire: the doctor pressing Check Athena again
       (or picking another row) takes ownership away from a pending timer */
    const stub = refuseThenAnswer('timeout', 99);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'auto-generation');
    const armedGen = h.state().probeGeneration;
    ok(h.snap().armed === true, 'the timeout refusal did not arm the cycle');
    const btn = h.el('mlsAthenaUnifiedRecheck');
    ok(!!btn, 'the settled refusal offered no human re-check button');
    btn.click();
    await flush(200);
    await h.clock.advance(1);
    ok(h.state().probeGeneration > armedGen, 'a human re-check did not take over the probe generation');
    eq(h.probes().length, 2, 'the human re-check did not run');
    /* the pending timer from the OLD generation must be inert; the new cycle
       owns the timing now, so exactly one automatic probe lands per 20s */
    await h.clock.advance(21000);
    eq(h.probes().length, 3, 'a stale automatic timer double-probed alongside the new cycle');
  }

  /* ============ 6. THE MODULE CANNOT WRITE, ANYWHERE, EVER ================= */
  {
    const stub = refuseThenAnswer('note-editor-not-empty', 99);
    const h = makeHarness({ onAction: stub.onAction });
    await openSheet(h, 'auto-no-write');
    ok(h.snap().armed === true, 'note-editor-not-empty (the op-note path\'s own refusal) did not arm a gentle re-check');
    await h.clock.advance(300000);
    eq(h.executes().length, 0, 'THE AUTOMATIC CYCLE WROTE TO ATHENA');
    const go = h.el('mlsAthenaUnifiedGo');
    /* the merged primary stays reachable by design (sheetux-1.0.0) - what may
       never happen is a BINDING behind it, because that binding is minted only
       by a validated probe and nothing here can mint one. */
    eq(go.getAttribute('data-mls-athena-action'), null, 'a refused sheet left an action binding on Confirm');
    eq(h.wf.diagnostics.sheetClarity.readyRow(), null, 'automatic re-checks manufactured a validated probe out of refusals');
    ok(h.stateWord() !== 'READY', 'a permanently refused sheet painted READY: ' + h.stateWord());
    /* every message this suite ever posted, across the whole file */
    eq(h.posted.filter(m => m.mode === 'execute').length, 0, 'an execute-mode message left the page');
  }

  console.log('PASS write-auto-chain (wfauto-1.0.0): ' + checks + ' checks - the write path is byte-identical by SHA-256 and the module reaches for no write, token or navigation verb; a retryable refusal now keeps re-running the SAME read-only check by itself on a bounded backoff and lands READY with Confirm still waiting for a human click; a fresh open switches it to the paced paint cadence that never re-drives navigation and stops at the owner\'s three-minute wall saying so; every positive refusal - wrong patient, DOB, MRN, provider, practice, account, wrong day, expired session, no athenaOne tab, a payload or guard refusal, and an ok probe MLS itself refused - is terminal and latches the sheet out of the cycle for good; coming back to the tab takes the re-check for the doctor, debounced and never while hidden; and a running write, a batch, a halted manifest, a stale generation and a closed sheet each shut the whole thing off, listeners and all');
})().catch((e) => { console.error('FAIL (threw): ' + (e && e.stack || e)); process.exit(1); });
