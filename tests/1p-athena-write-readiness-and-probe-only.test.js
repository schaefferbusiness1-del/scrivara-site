'use strict';

/* 1p PREVIEW ONLY. Drives the real isolated 1p-feat_mls_writeflow.js in a VM
 * against a FAKE extension. No browser, no MLS Assist, no athenaOne, no PHI,
 * and — asserted below — never one mlsAppAthenaActionV2 request with
 * mode:'execute'.
 *
 * What it proves:
 *   1. A bound encounter reaches READY: the read-only check ungrays Confirm and
 *      binds it to exactly that row.  (deliverable 2)
 *   2. A current/live note with complete patient identity but no local visit
 *      locator enters the read-only discovery probe; a historical note with
 *      the same missing locator remains honestly blocked.
 *   3. A missing three-factor identity produces the identity block text.
 *   4. A refused check leaves Confirm disabled AND records PHI-free receipts.
 *   5. The read-only fix ladder (mlsAppGotoDate -> appointment row -> re-check)
 *      is composed by the page and reports the day athenaOne is really on.
 *   6. PROBE ONLY runs the whole path including the Confirm click, sends
 *      mode:'probe', and records a rehearsal instead of a write.
 *   7. PROBE ONLY is enforced in ONE place (the bridge): the legacy lane, which
 *      does not know about the switch, still cannot emit an execute.
 *   8. An op note saved from the Prep Op Notes room carries its operative day,
 *      provider and Athena appointment id into the review, its text arrives
 *      byte-for-byte, and the row goes READY — probe only.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const FLOW = fs.readFileSync(path.join(ROOT, '1p-feat_mls_writeflow.js'), 'utf8');
const SHELL = fs.readFileSync(path.join(ROOT, '1pScribeFlow.html'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const WRITE_SAFETY = fs.readFileSync(path.join(ROOT, 'write_safety_guard.js'), 'utf8');

const DAY = '2026-08-17';
const ATHENA_DAY = '8/17/2026';
const APPOINTMENT = '70000017';
const ENCOUNTER = '55501';
const ENCOUNTER_URL = 'https://athena.example/encounter/55501';
const PROVIDER = 'Synthetic Clinician One, MD';
const PATIENT = { id: 'syn-a', patientId: 'syn-a', name: 'Synthetic Patient A', dob: '01/02/1980', mrn: '100001' };
const CAL_ROW = { id: 'cal-row-1', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: PROVIDER, providerName: PROVIDER, appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const OWNER_OPEN_ERROR = 'The exact Athena appointment row could not be opened. No name fallback was attempted.';

function clone(v) { return JSON.parse(JSON.stringify(v)); }
function sourceBetween(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing source start marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}
function fixedReasonCodes(source) {
  const out = new Set();
  const re = /reason\s*:\s*['"]([a-z0-9][a-z0-9+_-]*)['"]/g;
  let match;
  while ((match = re.exec(source))) out.add(match[1]);
  return Array.from(out).sort();
}

/* ------------------------------------------------------------------ DOM shim
 * Just enough to let the real renderer run: element ids resolve to ONE shared
 * stub, so the button the renderer wires is the same object probeUnifiedRow
 * later enables. innerHTML is stored as text (assertable), never parsed. */
function makeDom() {
  const byId = new Map();
  function node(tag) {
    const el = {
      tagName: String(tag || 'div').toUpperCase(), style: {}, dataset: {}, attrs: {}, children: [],
      handlers: {}, textContent: '', innerHTML: '', value: '', disabled: false, type: '', id: '',
      isConnected: true, className: '', parentNode: null,
      classList: { add() {}, remove() {}, contains() { return false; } },
      setAttribute(k, v) { el.attrs[k] = String(v); if (k === 'id') el.id = String(v); },
      getAttribute(k) { return Object.prototype.hasOwnProperty.call(el.attrs, k) ? el.attrs[k] : null; },
      removeAttribute(k) { delete el.attrs[k]; },
      addEventListener(type, fn) { (el.handlers[type] = el.handlers[type] || []).push(fn); },
      removeEventListener(type, fn) { const l = el.handlers[type] || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
      appendChild(child) { el.children.push(child); child.parentNode = el; return child; },
      insertBefore(child) { el.children.push(child); return child; },
      remove() {}, select() {}, focus() {},
      /* '#id' resolves through the shared registry (so the renderer and the
         probe wire the SAME button). Any other selector searches this node's
         own children and honestly returns null when there is no match. */
      querySelector(sel) {
        const s = String(sel || '');
        if (s.charAt(0) === '#') return resolve(s);
        const m = /^\[([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(s.trim());
        if (!m) return null;
        return el.children.filter(c => (m[2] === undefined ? c.getAttribute(m[1]) !== null : c.getAttribute(m[1]) === m[2]))[0] || null;
      },
      querySelectorAll() { return []; },
      closest() { return null; },
      click() { (el.handlers.click || []).forEach(fn => fn({ target: el })); }
    };
    let html = '';
    Object.defineProperty(el, 'innerHTML', {
      get() { return html; },
      set(v) { html = String(v); if (html === '') el.children.length = 0; }
    });
    return el;
  }
  function resolve(sel) {
    const key = String(sel || '').replace(/^#/, '');
    if (!byId.has(key)) { const el = node('div'); el.id = key; byId.set(key, el); }
    return byId.get(key);
  }
  const document = {
    readyState: 'complete', activeElement: null,
    body: node('body'), head: node('head'), documentElement: node('html'),
    addEventListener() {}, removeEventListener() {},
    querySelector(sel) { return resolve(sel); },
    querySelectorAll() { return []; },
    getElementById(id) { return resolve(id); },
    createElement(tag) { return node(tag); },
    execCommand() { return false; }
  };
  return { document, byId, resolve };
}

/* ------------------------------------------------------- fake MLS Assist 3.0.62 */
function makeHarness(options) {
  options = options || {};
  const dom = makeDom();
  const listeners = [];
  const posted = [];
  const store = new Map();
  if (options.ledger !== false) {
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
    _calAppts: options.calendar === undefined ? [clone(CAL_ROW)] : options.calendar,
    uns: k => 'acct:' + k,
    activePatient: () => (options.active === undefined ? PATIENT : options.active),
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
  function route(m) {
    if (!m || m.source !== 'mls-app') return;
    if (m.type === 'mlsAppAthenaActionV2') return deliver('mlsAppAthenaActionV2Result', m.requestId, options.onProbe ? options.onProbe(m) : probeOk(m));
    if (m.type === 'mlsAppSearchOpenPatient') return deliver('mlsAppSearchOpenResult', m.requestId, options.onOpen ? options.onOpen(m) : { ok: true, opened: true, via: 'appointment-id' });
    if (m.type === 'mlsAppGotoDate') return deliver('mlsAppGotoDateResult', m.requestId, options.onGoto ? options.onGoto(m) : { ok: true, supported: true, via: 'weekstrip', schedDate: m.date });
    if (m.type === 'mlsExtHealth') return deliver('mlsExtHealthResult', m.requestId, options.onHealth ? options.onHealth(m) : { ok: true, version: '3.0.62', versionName: '3.0.62+core-sha256:abc', athena: { tabs: 3, discarded: 1 } });
  }
  function probeOk(m) {
    return { ok: true, mode: 'probe', readOnly: true, action: m.action, actionToken: 'one-use-token', rowHash: m.rowHash,
      clientOrderId: m.clientOrderId || '', reason: 'context-verified', context: {
        patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, appointmentId: APPOINTMENT,
        encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL, visitDate: ATHENA_DAY, provider: PROVIDER,
        control: 'Save', framePath: '0', encounterRootFingerprint: 'er', controlFingerprint: 'c',
        noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h' } };
  }

  /* Only short timers run, and they run as microtasks. Every long timer in the
     flow is a deadline (8s interim line, 25s/90s/150s bridge timeouts) that
     must NOT fire while a synchronous fake extension is answering. */
  const context = vm.createContext({
    window, document: dom.document, localStorage, location: window.location, console,
    navigator: { userAgent: 'synthetic-test-agent', clipboard: null },
    Intl, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, isFinite, parseInt, parseFloat,
    setTimeout: (fn, ms) => { if (Number(ms || 0) <= 2000) Promise.resolve().then(fn); return 1; },
    clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(FLOW, context, { filename: '1p-feat_mls_writeflow.js' });
  return { window, document: dom.document, byId: dom.byId, el: dom.resolve, posted, context,
    wf: window.__mlsWriteFlow, athenaRequests: () => posted.filter(m => m.type === 'mlsAppAthenaActionV2') };
}
async function settle(n) { for (let i = 0; i < (n || 24); i++) await new Promise(r => setImmediate(r)); }
function probeOnlyGuard(h) {
  const bad = h.athenaRequests().filter(m => m.mode === 'execute');
  assert.strictEqual(bad.length, 0, 'an execute request left the page: ' + JSON.stringify(bad.map(m => m.action)));
}

const BOUND_CONTEXT = { visitDate: ATHENA_DAY, provider: PROVIDER, appointmentId: APPOINTMENT, encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL };
const NOTE = 'PREOPERATIVE DIAGNOSIS: right knee osteoarthritis.\nPROCEDURE: total knee arthroplasty.';

(async function () {
  /* ---------------------------------------------------- 1. bound -> READY --- */
  {
    const h = makeHarness({});
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }], expectedContext: BOUND_CONTEXT });
    assert.strictEqual(manifest.visit.appointmentId, APPOINTMENT, 'the bound appointment id did not survive into the manifest');
    const noteRow = manifest.rows.filter(r => r.id === 'write-note')[0];
    assert.strictEqual(noteRow.capability, 'ready', 'a fully bound encounter did not produce a READY note row: ' + noteRow.reason);
    assert.strictEqual(noteRow.payload.noteText, NOTE, 'the reviewed note text was not carried byte-for-byte');
    await settle();
    const go = h.el('mlsAthenaUnifiedGo');
    assert.strictEqual(go.disabled, false, 'Confirm stayed grayed after a verified read-only check');
    assert.strictEqual(go.getAttribute('aria-disabled'), 'false');
    assert.strictEqual(go.getAttribute('data-mls-athena-action'), 'write_note', 'Confirm was not bound to the READY row');
    assert.strictEqual(go.getAttribute('data-mls-preview-hash'), manifest.previewHash, 'Confirm was not bound to this exact manifest');
    const requests = h.athenaRequests();
    assert.strictEqual(requests.length, 1, 'the READY path sent ' + requests.length + ' Athena requests, expected exactly one read-only check');
    assert.strictEqual(requests[0].mode, 'probe');
    assert.deepStrictEqual(requests[0].expectedContext, manifest.visit, 'the check did not carry the manifest visit context');
    probeOnlyGuard(h);
  }

  /* ---------------- 2. every unbound visit stays blocked until re-pull/bind - */
  {
    const h = makeHarness({ calendar: [], ledger: false });
    h.window.__mlsAthenaProbeOnly = true;
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }] });
    const noteRow = manifest.rows.filter(r => r.id === 'write-note')[0];
    assert.strictEqual(noteRow.capability, 'blocked', 'a current/live note with no independent visit locator entered encounter discovery');
    assert.deepStrictEqual(JSON.parse(JSON.stringify(manifest.visit)), { visitDate: '', provider: '', appointmentId: '', encounterId: '', encounterUrl: '' },
      'the live-current fixture accidentally acquired a local visit locator');
    assert(/appointment ID|MLS will not guess an encounter/.test(noteRow.reason),
      'the live-current refusal did not explain that the exact appointment must be bound');
    await settle();
    const go = h.el('mlsAthenaUnifiedGo');
    assert.strictEqual(h.athenaRequests().length, 0, 'a live unbound review contacted Athena instead of waiting for an exact schedule bind');
    assert.strictEqual(go.getAttribute('data-mls-athena-action'), null, 'a live unbound row armed Confirm');
    assert.strictEqual(h.wf.diagnostics.state().probe, null, 'a live unbound row adopted whichever encounter happened to be open');
    probeOnlyGuard(h);

    const partial = makeHarness({ calendar: [], ledger: false });
    const partialManifest = partial.wf.buildUnifiedManifest({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }],
      expectedContext: { visitDate: ATHENA_DAY, provider: '', appointmentId: APPOINTMENT } });
    assert.strictEqual(partialManifest.rows.filter(r => r.id === 'write-note')[0].capability, 'blocked',
      'a partial live locator bypassed the exact auto-bind path');

    const historical = makeHarness({ calendar: [], ledger: false });
    const historicalManifest = historical.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }], requireExpectedVisit: true });
    const historicalRow = historicalManifest.rows.filter(r => r.id === 'write-note')[0];
    assert.strictEqual(historicalRow.capability, 'blocked', 'a historical note without its saved visit locator entered discovery');
    assert(/MLS will not guess an encounter/.test(historicalRow.reason), 'the historical refusal no longer names the no-guess encounter rule');
    await settle();
    assert.strictEqual(historical.athenaRequests().length, 0, 'a historical-unbound review contacted Athena instead of failing closed');
    assert.strictEqual(historical.el('mlsAthenaUnifiedGo').getAttribute('data-mls-athena-action'), null,
      'a historical-unbound row armed Confirm');
    probeOnlyGuard(historical);
  }

  /* ------------------------------------- 3. three-factor identity missing --- */
  {
    const h = makeHarness({ active: { id: 'syn-a', name: PATIENT.name, dob: PATIENT.dob } });
    const manifest = h.wf.buildUnifiedManifest({ patient: { id: 'syn-a', name: PATIENT.name, dob: PATIENT.dob }, sections: [{ key: 'note', text: NOTE }], expectedContext: BOUND_CONTEXT });
    const noteRow = manifest.rows.filter(r => r.id === 'write-note')[0];
    assert.strictEqual(noteRow.capability, 'blocked', 'a chart with no MRN produced a sendable row');
    /* mrnadopt-1.0.0: the MRN is the one identity field the sheet can obtain
       for itself, so an MRN-ONLY gap names that cure instead of repeating the
       generic three-factor refusal. The row still blocks - MLS Assist refuses
       a staged section write without a supplied MRN. */
    assert(/Athena MRN yet/.test(noteRow.reason) && /Check Athena again/.test(noteRow.reason),
      'the MRN-only block no longer names the one action that clears it: ' + noteRow.reason);
    const noDob = h.wf.buildUnifiedManifest({ patient: { id: 'syn-a', name: PATIENT.name }, sections: [{ key: 'note', text: NOTE }], expectedContext: BOUND_CONTEXT });
    assert.strictEqual(noDob.rows.filter(r => r.id === 'write-note')[0].reason,
      'An immutable local patient ID plus the exact Athena name, DOB, and MRN are required. Nothing can be written.',
      'a multi-field identity gap lost the original fail-closed sentence');
    probeOnlyGuard(h);
  }

  /* -------------------------- 4. refused check -> gray + PHI-free receipts -- */
  {
    const h = makeHarness({
      onProbe: () => ({ ok: false, blocked: true, reason: 'context-unverified', error: 'Could not identify one exact patient encounter frame.' }),
      onOpen: () => ({ ok: false, opened: false, reason: 'appointment-id-not-found', error: OWNER_OPEN_ERROR })
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }], expectedContext: BOUND_CONTEXT });
    await settle(60);
    const go = h.el('mlsAthenaUnifiedGo');
    assert.strictEqual(go.disabled, true, 'a refused read-only check left Confirm enabled');
    assert.strictEqual(go.getAttribute('data-mls-athena-action'), null, 'a refused check left an action bound to Confirm');
    const receipts = h.wf.diagnostics.receipts();
    const probeReceipt = receipts.filter(r => r.verb === 'mlsAppAthenaActionV2')[0];
    assert(probeReceipt, 'no probe receipt was recorded');
    assert.strictEqual(probeReceipt.reason, 'context-unverified');
    assert.strictEqual(probeReceipt.errorClass, 'no-encounter-frame');
    assert.strictEqual(probeReceipt.appointmentIdPresent, true);
    assert.strictEqual(probeReceipt.encounterBound, true);
    assert.strictEqual(probeReceipt.expectedDay, DAY, 'the receipt did not record the expected day');
    assert.strictEqual(probeReceipt.identityLock, 'refused', 'the receipt did not record the identity-lock result');
    assert.strictEqual(typeof probeReceipt.athenaTabs, 'number', 'the receipt did not carry an athenaOne tab count field');
    assert.strictEqual(probeReceipt.mode, 'probe', 'a receipt recorded a non-probe request');
    const openReceipt = receipts.filter(r => r.verb === 'mlsAppSearchOpenPatient')[0];
    assert(openReceipt, 'no appointment-open receipt was recorded');
    assert.strictEqual(openReceipt.reason, 'appointment-id-not-found');
    assert.strictEqual(openReceipt.errorClass, 'appointment-row-open-refused',
      'the exact refusal the owner saw was not classified');
    /* re-pinned to rowfirst-1.0.0 (b1133): the exact-appointment-id row click
       runs FIRST against whatever athenaOne already paints (the day-drive's
       recovery ladder can destroy a painted schedule), and the frozen-day
       navigation is the FALLBACK for a row-not-painted refusal, followed by a
       fresh row search. Same identity gates, new order. */
    const autoNavIndex = h.posted.findIndex(m => m.type === 'mlsAppGotoDate');
    const firstOpenIndex = h.posted.findIndex(m => m.type === 'mlsAppSearchOpenPatient');
    const retryOpenIndex = h.posted.findIndex((m, i) => m.type === 'mlsAppSearchOpenPatient' && i > autoNavIndex);
    assert(firstOpenIndex >= 0 && autoNavIndex > firstOpenIndex,
      'the automatic no-chart route must try the exact appointment row FIRST, then navigate to its frozen day');
    assert(retryOpenIndex > autoNavIndex,
      'after the frozen-day navigation the route must search the appointment row again');
    assert.strictEqual(h.posted[autoNavIndex].date, DAY, 'the automatic no-chart route navigated to the wrong day');
    const report = h.wf.diagnostics.report();
    assert.strictEqual(report.kind, 'mls-athena-review-error-report');
    assert.strictEqual(report.review.appointmentIdPresent, true);
    assert.strictEqual(report.review.expectedDay, DAY);
    assert.strictEqual(report.env.extension.athenaTabs, 3, 'the report did not carry the athenaOne tab count');
    assert.strictEqual(report.env.extension.athenaTabsUnloaded, 1);
    assert.strictEqual(report.env.probeOnly, false);
    assert(report.receipts.length >= 2, 'the report dropped the probe receipts');
    const serialized = JSON.stringify(report);
    [PATIENT.name, PATIENT.dob, PATIENT.mrn, APPOINTMENT, ENCOUNTER_URL, PROVIDER, OWNER_OPEN_ERROR].forEach(secret => {
      assert.strictEqual(serialized.indexOf(secret), -1, 'the copyable error report leaked ' + secret.slice(0, 24));
    });
    const diagLine = h.wf.diagnostics.envLine();
    assert(diagLine.indexOf('3 athenaOne tabs open') >= 0, 'the diagnostics line does not report the tab count: ' + diagLine);
    assert(diagLine.indexOf('keep one') >= 0, 'the diagnostics line does not say what to do about extra tabs');
    assert(diagLine.indexOf('unloaded by Chrome') >= 0, 'the diagnostics line does not report the unloaded tab');
    assert(diagLine.indexOf('expected day ' + DAY) >= 0, 'the diagnostics line does not report the expected day: ' + diagLine);
    assert(diagLine.indexOf('appointment id is bound') >= 0, 'the diagnostics line does not report the appointment binding');
    [PATIENT.name, PATIENT.dob, PATIENT.mrn, APPOINTMENT].forEach(secret => {
      assert.strictEqual(diagLine.indexOf(secret), -1, 'the on-screen diagnostics line leaked ' + secret);
    });
    probeOnlyGuard(h);

    /* 3.0.80 exposed dozens of newer fixed refusal/result codes while this
       patient-free report still allowed only the old 3.0.62 vocabulary. That
       flattened actionable failures (including target-day mismatches) to
       "unlisted". Derive every fixed code from the current cross-layer write
       surfaces so a future extension reason cannot drift silently again. */
    const reasonSources = [
      sourceBetween(CONTENT, "if (d.type === 'mlsAppAthenaActionV2')", '/* ATHENA_ACTION_V2_BRIDGE_END */'),
      sourceBetween(BACKGROUND, '/* ATHENA_ACTION_V2_DRIVER_START */', '/* ATHENA_ACTION_V2_DRIVER_END */'),
      sourceBetween(BACKGROUND, '/* ATHENA_ACTION_V2_HANDLER_START */', '/* ATHENA_ACTION_V2_HANDLER_END */'),
      WRITE_SAFETY,
      sourceBetween(FLOW, 'wfdx-1.0.0', 'function receiptStateForRow')
    ];
    const currentCodes = Array.from(new Set(reasonSources.flatMap(fixedReasonCodes).concat(['unresolved-after-pull']))).sort();
    const missingCodes = currentCodes.filter(code => h.wf.diagnostics.reason(code) !== code);
    assert.deepStrictEqual(missingCodes, [],
      'the copyable Athena report flattened current fixed reason code(s): ' + missingCodes.join(', '));
    assert.strictEqual(h.wf.diagnostics.reason('Synthetic Patient A'), 'unlisted',
      'free text was allowed into the patient-free error report');
    assert.strictEqual(h.wf.diagnostics.reason('synthetic-patient-a'), 'unlisted',
      'an unknown identifier-shaped value was allowed into the patient-free error report');
  }

  /* ----------- 4b. an execute failure remains copyable and PHI-free -------- */
  {
    const privateError = `Failed while writing ${PATIENT.name} ${PATIENT.dob} MRN ${PATIENT.mrn}`;
    const h = makeHarness({
      onProbe: m => {
        if (m.mode === 'execute') return {
          ok: false, attempted: true, partialMutation: true,
          reason: 'outcome-uncertain', detail: 'note-write-unverified',
          results: [{ key: 'hpi', reason: 'note-write-unverified' }], error: privateError
        };
        return { ok: true, mode: 'probe', readOnly: true, action: m.action,
          actionToken: 'one-use-token', rowHash: m.rowHash, reason: 'context-verified', context: {
            patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, appointmentId: APPOINTMENT,
            encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL, visitDate: ATHENA_DAY, provider: PROVIDER,
            control: 'HPI editor', framePath: '0', encounterRootFingerprint: 'er', controlFingerprint: 'c',
            noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h' } };
      }
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'hpi', text: 'Synthetic HPI.' }], expectedContext: BOUND_CONTEXT });
    await settle(40);
    const go = h.el('mlsAthenaUnifiedGo');
    assert.strictEqual(go.disabled, false, 'the synthetic execute-failure row never reached READY');
    go.click();
    await settle(60);
    const report = h.wf.diagnostics.report();
    const executeReceipt = report.receipts.filter(r => r.stage === 'execute')[0];
    assert(executeReceipt, 'the copyable report dropped the execute attempt');
    assert.strictEqual(executeReceipt.mode, 'execute', 'the copyable report mislabeled an execute attempt as a read-only probe');
    assert.strictEqual(executeReceipt.reason, 'outcome-uncertain');
    assert.strictEqual(executeReceipt.detailReason, 'note-write-unverified');
    assert.strictEqual(executeReceipt.resultReasons['note-write-unverified'], 1);
    assert.strictEqual(executeReceipt.attempted, true);
    assert.strictEqual(executeReceipt.partialMutation, true);
    const serialized = JSON.stringify(report);
    [PATIENT.name, PATIENT.dob, PATIENT.mrn, privateError].forEach(secret => {
      assert.strictEqual(serialized.indexOf(secret), -1, 'the execute receipt leaked ' + secret.slice(0, 24));
    });
    const fix = h.el('mlsAthenaUnifiedFix');
    assert(fix.children.some(c => String(c.textContent).indexOf('Copy error report') === 0),
      'an execute failure did not restore the Copy error report control');
    assert.strictEqual(h.wf.diagnostics.state().halted, true,
      'an uncertain execute result did not halt the manifest');
  }

  /* ------------------- 5. the read-only fix ladder the doctor can click ----- */
  {
    const wrongDay = '2026-08-11';
    const h = makeHarness({
      onProbe: () => ({ ok: false, blocked: true, reason: 'context-unverified' }),
      onOpen: () => ({ ok: false, opened: false, reason: 'appointment-id-not-found', error: OWNER_OPEN_ERROR }),
      onGoto: () => ({ ok: false, supported: true, via: 'weekstrip', schedDate: wrongDay, error: 'athena week strip shows 8/11 instead of ' + DAY + '.' })
    });
    h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }], expectedContext: BOUND_CONTEXT });
    await settle(60);
    const fix = h.el('mlsAthenaUnifiedFix');
    const openBtn = fix.children.filter(c => String(c.textContent).indexOf('Open this patient') === 0)[0];
    assert(openBtn, 'the review offered no read-only "open this encounter" button after a refused open');
    const reportBtn = fix.children.filter(c => String(c.textContent).indexOf('Copy error report') === 0)[0];
    assert(reportBtn, 'the review offered no copyable error report');
    /* re-pinned to rowfirst-1.0.0 (b1133) + dayfall-1.0.1 (b1136): the exact-id
       row click legitimately runs ONCE before the goto (its landing surface
       carries the identity gates, and here it honestly refused). The protected
       property is unchanged and now pinned tighter: after athenaOne OBSERVES a
       positively different painted day, NO row search may follow - on the
       automatic or the manual route. */
    const gotosBeforeManual = h.posted.filter(m => m.type === 'mlsAppGotoDate').length;
    assert.strictEqual(gotosBeforeManual, 1, 'the automatic open did not make exactly one frozen-day navigation attempt');
    const firstGotoAt = h.posted.findIndex(m => m.type === 'mlsAppGotoDate');
    const preGotoScans = h.posted.filter((m, i) => m.type === 'mlsAppSearchOpenPatient' && i < firstGotoAt).length;
    assert(preGotoScans <= 1, 'the automatic route may make at most the one row-first attempt before navigating');
    assert.strictEqual(h.posted.filter((m, i) => m.type === 'mlsAppSearchOpenPatient' && i > firstGotoAt).length, 0,
      'the automatic route scanned the current Day view after its frozen-day navigation observed the WRONG day');
    openBtn.click();
    await settle(60);
    const gotos = h.posted.filter(m => m.type === 'mlsAppGotoDate');
    assert.strictEqual(gotos.length, gotosBeforeManual + 1, 'the manual helper did not make exactly one fresh day-navigation attempt');
    assert.strictEqual(gotos[gotos.length - 1].date, DAY, 'the helper asked athenaOne for the wrong day');
    /* the manual route is rowfirst too: its own single pre-goto row attempt is
       lawful; NOTHING may scan after ITS goto observed the wrong day. */
    const manualGotoAt = h.posted.map((m, i) => (m.type === 'mlsAppGotoDate' ? i : -1)).filter(i => i >= 0).pop();
    const betweenScans = h.posted.filter((m, i) => m.type === 'mlsAppSearchOpenPatient' && i > firstGotoAt && i < manualGotoAt).length;
    assert(betweenScans <= 1, 'the manual route may make at most its one row-first attempt before its own navigation');
    assert.strictEqual(h.posted.filter((m, i) => m.type === 'mlsAppSearchOpenPatient' && i > manualGotoAt).length, 0,
      'the manual route scanned the current Day view after its frozen-day navigation observed the WRONG day');
    assert.strictEqual(h.wf.diagnostics.receipts().filter(r => r.verb === 'mlsAppGotoDate' && r.observedDay === wrongDay).length, gotos.length,
      'one or more observed athenaOne day attempts were not recorded');
    const status = h.el('mlsAthenaUnifiedProbe');
    assert(String(status.textContent).indexOf('Day view is on ' + wrongDay) >= 0,
      'the status line did not tell the doctor which day athenaOne is on: ' + status.textContent);
    assert(String(status.textContent).indexOf('Nothing was changed') >= 0, 'the failure line did not say nothing changed');
    const byName = fix.children.filter(c => c.getAttribute('data-mls-open-by-name') === '1')[0];
    assert(byName, 'no identity-verified name route was offered after the appointment row could not be opened');
    assert.strictEqual(h.wf.diagnostics.envLine().indexOf('athenaOne Day view is on ' + wrongDay) >= 0, true,
      'the diagnostics line did not surface the observed day');
    probeOnlyGuard(h);
  }

  /* ------------------- 5b. the ladder succeeding re-checks the encounter ---- */
  {
    let probes = 0;
    const h = makeHarness({
      onProbe: m => { probes++; return probes === 1 ? { ok: false, blocked: true, reason: 'context-unverified' } : null; },
      onOpen: m => (m.bootstrapIdentity === true ? { ok: false, opened: false, reason: 'appointment-id-not-found', error: OWNER_OPEN_ERROR } : { ok: true, opened: true, via: 'appointment-id' })
    });
    /* onProbe returning null falls through to the verified default */
    h.context.__unused = 0;
    const wf = h.wf;
    wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }], expectedContext: BOUND_CONTEXT });
    await settle(60);
    const fix = h.el('mlsAthenaUnifiedFix');
    const openBtn = fix.children.filter(c => String(c.textContent).indexOf('Open this patient') === 0)[0];
    assert(openBtn, 'no read-only open button was offered');
    const gotosBeforeManual = h.posted.filter(m => m.type === 'mlsAppGotoDate').length;
    assert.strictEqual(gotosBeforeManual, 1, 'the automatic route did not first navigate to the frozen encounter day');
    openBtn.click();
    await settle(80);
    assert(h.posted.filter(m => m.type === 'mlsAppGotoDate').length === gotosBeforeManual + 1, 'the manual ladder did not make one fresh Day-view navigation');
    assert(h.posted.filter(m => m.type === 'mlsAppSearchOpenPatient').length >= 2, 'the ladder did not re-open the appointment row');
    probeOnlyGuard(h);
  }

  /* ------------------------------------------------------- 6. PROBE ONLY --- */
  {
    const h = makeHarness({});
    h.window.__mlsAthenaProbeOnly = true;
    assert.strictEqual(h.wf.diagnostics.probeOnly(), true, 'the PROBE ONLY switch was not honoured');
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }], expectedContext: BOUND_CONTEXT });
    await settle();
    const card = h.el('mlsAthenaUnifiedConfirm');
    /* the card the renderer built is the overlay's only child */
    const cardHtml = String((h.document.body.children[0] && h.document.body.children[0].children[0] || {}).innerHTML || '');
    assert(cardHtml.indexOf('PROBE ONLY') >= 0, 'the review did not say PROBE ONLY');
    assert(cardHtml.indexOf('nothing will be written') >= 0, 'the PROBE ONLY banner did not promise nothing is written');
    const go = h.el('mlsAthenaUnifiedGo');
    assert.strictEqual(go.disabled, false, 'PROBE ONLY did not reach READY');
    assert(String(go.textContent).indexOf('PROBE ONLY') >= 0, 'the Confirm button did not say PROBE ONLY: ' + go.textContent);
    go.click();
    await settle(60);
    const requests = h.athenaRequests();
    assert(requests.length >= 2, 'the Confirm click sent nothing');
    const confirmRequest = requests[requests.length - 1];
    assert.strictEqual(confirmRequest.mode, 'probe', 'the Confirm click executed in PROBE ONLY');
    assert.strictEqual(confirmRequest.actionToken, undefined, 'PROBE ONLY carried a one-use execution token');
    assert.strictEqual(confirmRequest.action, 'write_note');
    probeOnlyGuard(h);
    const receiptState = h.wf.diagnostics.state();
    const receipt = receiptState.receipts['write-note'];
    assert(receipt, 'the rehearsal produced no receipt');
    assert.strictEqual(receipt.status, 'rehearsed');
    assert(receipt.message.indexOf('Nothing was written') >= 0, 'the rehearsal receipt did not say nothing was written');
    assert.strictEqual(receiptState.halted, false, 'a rehearsal halted the manifest');
    assert.strictEqual(h.wf.diagnostics.report().env.probeOnly, true, 'the error report did not record PROBE ONLY');
    assert.strictEqual(manifest.rows.filter(r => r.id === 'write-note')[0].capability, 'ready');
  }

  /* ---- 7. one enforcement point: the legacy lane cannot execute either ----- */
  {
    const h = makeHarness({});
    h.window.__mlsAthenaProbeOnly = true;
    h.wf.startAthenaAction('write_note', { patient: PATIENT, sections: [{ key: 'note', text: NOTE }], expectedContext: BOUND_CONTEXT });
    await settle(40);
    const legacyGo = h.el('mlsAthenaActionGo');
    assert(legacyGo.handlers.click && legacyGo.handlers.click.length, 'the legacy confirmation never armed its execute button');
    legacyGo.click();
    await settle(40);
    const requests = h.athenaRequests();
    assert(requests.length >= 2, 'the legacy confirm sent nothing');
    const legacyRequest = requests[requests.length - 1];
    assert.strictEqual(legacyRequest.mode, 'probe', 'the legacy lane executed in PROBE ONLY - the bridge guard did not hold');
    assert.strictEqual(legacyRequest.actionToken, '', 'the bridge left a one-use execution token on a rehearsed request');
    assert.strictEqual(legacyRequest.__mlsProbeOnly, true, 'the rehearsed request was not marked');
    probeOnlyGuard(h);
  }

  /* -------- 8. an op note prepped in the room reaches the review READY ------ */
  {
    /* Execute the SHELL's own two functions - the ones that decide what a saved
       op note remembers and how it is rebound - against the real writeflow. */
    function extract(name) {
      const at = SHELL.indexOf('\nfunction ' + name + '(');
      assert(at > 0, 'shell function ' + name + ' not found');
      let i = SHELL.indexOf('{', at), depth = 0, end = -1;
      for (let j = i; j < SHELL.length; j++) {
        if (SHELL[j] === '{') depth++;
        else if (SHELL[j] === '}') { depth--; if (!depth) { end = j + 1; break; } }
      }
      assert(end > 0, 'shell function ' + name + ' is unbalanced');
      return SHELL.slice(at + 1, end);
    }
    const h = makeHarness({});
    const shellSrc = ['_opVisitStamp', '_athenaPatientSnapshot', '_athenaFreezeVisitBinding', '_athenaBindingForSavedRecord']
      .map(extract).join('\n') +
      '\nfunction _athenaNormIdentity(v){return String(v||"").toLowerCase().trim();}' +
      '\nfunction _athenaDigits(v){return String(v||"").replace(/[^0-9]/g,"");}' +
      '\nwindow.__shell={_opVisitStamp:_opVisitStamp,_athenaBindingForSavedRecord:_athenaBindingForSavedRecord};';
    vm.runInContext(shellSrc, h.context, { filename: 'shell-opnote-slice.js' });
    const shell = h.window.__shell;

    /* the prep row the Op Notes room builds for a scheduled operative day */
    const row = { patientId: PATIENT.patientId, dateKey: DAY, proc: 'Total knee arthroplasty',
      appt: { name: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, providerName: PROVIDER }, note: NOTE };
    const stamp = shell._opVisitStamp(row, { id: PATIENT.patientId, name: PATIENT.name });
    assert.strictEqual(stamp.visitDate, DAY, 'the operative day was not stamped on the saved op note');
    assert.strictEqual(stamp.provider, PROVIDER, 'the scheduled provider was not stamped on the saved op note');
    assert.strictEqual(stamp.appointmentId, APPOINTMENT, 'the Athena appointment id was not resolved from the day ledger');
    assert.strictEqual(stamp.visitTimestamp, Date.parse(CAL_ROW.start_at), 'the operative timestamp was not stamped');

    /* the History record that save writes, then the binding a reopen rebuilds */
    const record = { id: 'n1', patient: PATIENT.name, patientId: PATIENT.patientId, text: NOTE, kind: 'opnote',
      isDraft: false, visitDate: stamp.visitDate, provider: stamp.provider, appointmentId: stamp.appointmentId,
      visitTimestamp: stamp.visitTimestamp, patientDob: PATIENT.dob, patientMrn: PATIENT.mrn };
    const binding = shell._athenaBindingForSavedRecord(record);
    assert.strictEqual(binding.historical, true, 'a saved op note stopped being historical');
    assert.strictEqual(binding.visitContext.visitDate, DAY);
    assert.strictEqual(binding.visitContext.provider, PROVIDER);
    assert.strictEqual(binding.visitContext.appointmentId, APPOINTMENT);

    /* the exact hand-off pushHistoryNoteToAthena -> _athenaShowReceipt makes */
    const plan = [{ kind: 'procedure', body: 'PROCEDURE / OPERATIVE NOTE:\n' + record.text }];
    const manifest = h.wf.openUnifiedConfirmation({
      patient: { name: binding.patient.name, dob: PATIENT.dob, mrn: PATIENT.mrn, patientId: PATIENT.patientId },
      plan: plan,
      expectedContext: { visitDate: binding.visitContext.visitDate, provider: binding.visitContext.provider,
        appointmentId: binding.visitContext.appointmentId, encounterId: '', encounterUrl: '' },
      noteTimestamp: binding.noteTimestamp, requireExpectedVisit: binding.historical, preferredAction: 'write_note'
    });
    const noteRow = manifest.rows.filter(r => r.kind === 'procedure')[0];
    assert.strictEqual(noteRow.payload.noteText, NOTE, 'the drafted op note did not reach the review payload byte-for-byte');
    assert.strictEqual(noteRow.payload.sections[0].key, 'procedure', 'the drafted op note lost its exact Procedure Documentation key');
    assert(!manifest.rows.some(r => r.id === 'write-note'), 'the drafted op note fell back to the generic encounter-note row');
    assert.strictEqual(noteRow.capability, 'ready', 'a bound op note still could not be sent: ' + noteRow.reason);
    assert.strictEqual(manifest.requireExpectedVisit, true, 'the historical guard was dropped for an op note');
    assert.strictEqual(manifest.visit.appointmentId, APPOINTMENT);
    await settle();
    const go = h.el('mlsAthenaUnifiedGo');
    assert.strictEqual(go.disabled, false, 'the op-note review never ungrayed Confirm');
    assert.strictEqual(go.getAttribute('data-mls-athena-action'), 'write_note');
    probeOnlyGuard(h);

    /* and the pre-fix record - no visit metadata at all - still blocks honestly */
    const legacyBinding = shell._athenaBindingForSavedRecord({ id: 'n2', patient: PATIENT.name, patientId: PATIENT.patientId, text: NOTE, kind: 'opnote', isDraft: false });
    assert.strictEqual(legacyBinding.visitContext.visitDate, '', 'the pre-fix record fixture is not representative');
    const blocked = h.wf.buildUnifiedManifest({ patient: PATIENT, plan: plan,
      expectedContext: { visitDate: '', provider: '', appointmentId: '', encounterId: '', encounterUrl: '' },
      requireExpectedVisit: true });
    assert.strictEqual(blocked.rows.filter(r => r.kind === 'procedure')[0].capability, 'blocked',
      'an op note with no encounter evidence became sendable');
  }

  /* --- 9. a historical review never infers its encounter from a clock read -- */
  {
    const h = makeHarness({});
    const live = h.wf.buildUnifiedManifest({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }] });
    assert.strictEqual(live.visit.appointmentId, APPOINTMENT,
      'the LIVE lane must still bind today\'s appointment from the day ledger');
    const historical = h.wf.buildUnifiedManifest({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }], requireExpectedVisit: true });
    assert.strictEqual(historical.visit.appointmentId, '',
      'a historical review with no stored day inferred an encounter from the clock');
    assert.strictEqual(historical.visit.visitDate, '');
    assert.strictEqual(historical.rows.filter(r => r.id === 'write-note')[0].capability, 'blocked');
    const historicalWithDay = h.wf.buildUnifiedManifest({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }],
      requireExpectedVisit: true, expectedContext: { visitDate: ATHENA_DAY, provider: PROVIDER } });
    assert.strictEqual(historicalWithDay.visit.appointmentId, APPOINTMENT,
      'a historical review that DOES name its day lost its ledger-resolved appointment');
    probeOnlyGuard(h);
  }

  /* -- 10. appointment id bound but provider unknown is bindable, not stuck -- */
  {
    const REQUEST = 'synthetic-request-10';
    /* the engine's own guard: the response identity must not move under the
       sequential probes, so the harness must hand back ONE frozen timestamp */
    const RESP_AT = Date.now() - 1000;
    const coverage = { verdict: 'row-unattributed', rows: 1, headerCount: 2, unattributedRows: 1, foreignRows: 0 };
    const source = { id: REQUEST, requestId: REQUEST, ok: true, scheduleVerified: true, schedDate: DAY,
      appts: [{ name: PATIENT.name, date: DAY, appointmentId: APPOINTMENT, provider: '' }],
      providerRoster: [{ stableKey: 'h1', id: '501', name: 'Header One, MD', raw: 'Header_One_MD' },
        { stableKey: 'h2', id: '502', name: 'Header Two, MD', raw: 'Header_Two_MD' }],
      receipt: { complete: true, authoritativeEmpty: false, requestId: REQUEST, expectedCount: 1, parsedCount: 1, candidateCount: 1 },
      providerRosterReceipt: { complete: false, partial: true, reason: 'legacy-unverified', providerMode: 'all', requestId: REQUEST,
        targetDate: DAY, requestedProviderId: '', requestedProviderStableKey: '', observedCount: 2, attributionCoverage: coverage } };
    const pull = { ok: true, complete: true, reason: 'complete-appointment-census-only',
      providerRosterReceipt: { complete: false, partial: true, reason: 'legacy-unverified', providerMode: 'all', requestId: REQUEST,
        targetDate: DAY, requestedProviderId: '', requestedProviderStableKey: '' },
      appointmentCensusReceipt: { kind: 'athena-appointment-census', complete: true, reason: 'complete-provider-unknown',
        scope: 'appointment-census-only', targetDate: DAY, requestId: REQUEST, expectedCount: 1, parsedCount: 1, candidateCount: 1,
        rowCount: 1, uniqueAppointmentIds: 1, providerHeaderCount: 2, unattributedRows: 1, foreignRows: 0,
        providerAttributionComplete: false, providerFieldsBlank: true, noProviderGuess: true, providerSnapshotAllowed: false } };
    /* one provider header answers with the exact encounter, the other refuses */
    const h = makeHarness({
      calendar: [Object.assign(clone(CAL_ROW), { provider: '', providerName: '' })],
      onProbe: m => (m.expectedContext && m.expectedContext.provider === 'Header One, MD'
        ? { ok: false, blocked: true, reason: 'context-unverified' }
        : { ok: true, mode: 'probe', readOnly: true, actionToken: 'discard-me', rowHash: m.rowHash, context: {
            patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, appointmentId: APPOINTMENT,
            encounterId: ENCOUNTER, encounterUrl: ENCOUNTER_URL, visitDate: ATHENA_DAY, provider: 'Header Two, MD',
            control: 'Save', framePath: '0', encounterRootFingerprint: 'er', controlFingerprint: 'c',
            noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h' } })
    });
    h.window.__mlsSI = { _lastResp: () => source, _lastPullResult: () => pull, _lastRespAt: () => RESP_AT };
    /* the manifest already names the exact appointment; only the provider is unknown */
    const manifest = h.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }],
      expectedContext: { visitDate: ATHENA_DAY, provider: '', appointmentId: APPOINTMENT } });
    assert.strictEqual(manifest.rows.filter(r => r.id === 'write-note')[0].capability, 'blocked',
      'a provider-less encounter must start blocked');
    await settle(80);
    const bound = h.window.__mlsP1AutoBind.state().last;
    assert(bound, 'an appointment-id-bound, provider-unknown encounter was never offered to the read-only bind');
    assert.strictEqual(bound.appointmentId, APPOINTMENT, 'the bind changed the exact imported appointment');
    const live = h.wf.diagnostics.state();
    assert.strictEqual(live.manifest.visit.provider, 'Header Two, MD', 'the one verified provider was not adopted');
    assert.strictEqual(live.manifest.rows.filter(r => r.id === 'write-note')[0].capability, 'ready',
      'the rebuilt manifest did not become sendable');
    probeOnlyGuard(h);

    /* a candidate set resolving a DIFFERENT appointment id is refused outright */
    const h2 = makeHarness({ calendar: [Object.assign(clone(CAL_ROW), { provider: '', providerName: '' })] });
    h2.window.__mlsSI = { _lastResp: () => source, _lastPullResult: () => pull, _lastRespAt: () => RESP_AT };
    h2.wf.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: NOTE }],
      expectedContext: { visitDate: ATHENA_DAY, provider: '', appointmentId: '99999999' } });
    await settle(80);
    assert.strictEqual(h2.window.__mlsP1AutoBind.state().last, null,
      'the bind adopted a different appointment id than the one already on the manifest');
    assert.strictEqual(h2.athenaRequests().filter(m => m.mode === 'probe').length, 0,
      'a mismatched appointment id still probed Athena');
    probeOnlyGuard(h2);
  }

  console.log('PASS 1p Athena write-readiness: bound->READY, live and historical unbound reviews stay blocked until an exact schedule bind, PHI-free probe receipts and copyable report, read-only goto/open/re-check ladder, PROBE ONLY end-to-end with a single bridge enforcement point, and op-note -> review byte-for-byte');
})().catch(error => { console.error(error); process.exitCode = 1; });
