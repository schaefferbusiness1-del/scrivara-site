'use strict';

/* 1p-only adversarial runtime for the provider-unknown -> exact Athena visit
 * bind. This drives the real isolated writeflow in a VM. It never loads the
 * extension, opens Athena, or sends an execute request. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_writeflow.js'), 'utf8');
const DAY = '2026-08-17';
const APPOINTMENT = '70000017';
const REQUEST = 'synthetic-request-17';
const PATIENT = { id: 'synthetic-patient-a', patientId: 'synthetic-patient-a', name: 'Synthetic Patient A', dob: '01/02/1980', mrn: '100001' };
const OTHER = { id: 'synthetic-patient-b', patientId: 'synthetic-patient-b', name: 'Synthetic Patient B', dob: '02/03/1981', mrn: '100002' };
const CAL = { id: 'synthetic-calendar-row-17', patient_external_id: PATIENT.patientId, name: PATIENT.name, dob: PATIENT.dob,
  provider: '', appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function sourceReceipt() {
  const coverage = { verdict: 'row-unattributed', rows: 1, headerCount: 2, unattributedRows: 1, foreignRows: 0 };
  return {
    id: REQUEST, requestId: REQUEST, ok: true, scheduleVerified: true, schedDate: DAY,
    appts: [{ name: PATIENT.name, date: DAY, start_local: '09:00', appointmentId: APPOINTMENT, provider: '' }],
    providerRoster: [
      { stableKey: 'synthetic-header-1', id: '501', name: 'Synthetic Clinician One, MD', raw: 'Synthetic_Clinician_One_MD' },
      { stableKey: 'synthetic-header-2', id: '502', name: 'Synthetic Clinician Two, MD', raw: 'Synthetic_Clinician_Two_MD' }
    ],
    receipt: { complete: true, authoritativeEmpty: false, requestId: REQUEST, expectedCount: 1, parsedCount: 1, candidateCount: 1 },
    providerRosterReceipt: { complete: false, partial: true, reason: 'legacy-unverified', providerMode: 'all', requestId: REQUEST,
      targetDate: DAY, requestedProviderId: '', requestedProviderStableKey: '', observedCount: 2, attributionCoverage: coverage }
  };
}
function pullReceipt() {
  return {
    ok: true, complete: true, reason: 'complete-appointment-census-only',
    providerRosterReceipt: { complete: false, partial: true, reason: 'legacy-unverified', providerMode: 'all', requestId: REQUEST,
      targetDate: DAY, requestedProviderId: '', requestedProviderStableKey: '' },
    appointmentCensusReceipt: { kind: 'athena-appointment-census', complete: true, reason: 'complete-provider-unknown',
      scope: 'appointment-census-only', targetDate: DAY, requestId: REQUEST, expectedCount: 1, parsedCount: 1, candidateCount: 1,
      rowCount: 1, uniqueAppointmentIds: 1, providerHeaderCount: 2, unattributedRows: 1, foreignRows: 0,
      providerAttributionComplete: false, providerFieldsBlank: true, noProviderGuess: true, providerSnapshotAllowed: false }
  };
}

function makeHarness(options) {
  options = options || {};
  const listeners = [];
  const posted = [];
  const store = new Map();
  if (options.ledger !== false) store.set('acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {
    ['appointment-id:' + APPOINTMENT]: { state: 'done', patientId: PATIENT.patientId, backendAppointmentId: CAL.id, appt_date: DAY }
  } }));
  const localStorage = { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) };
  let active = clone(PATIENT);
  let source = options.source || sourceReceipt();
  let pull = options.pull || pullReceipt();
  let sourceAt = Date.now();
  const document = {
    readyState: 'complete', body: null, head: null, documentElement: {}, activeElement: null,
    addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById() { return null; }, createElement() { return {}; }
  };
  /* opt-in element stub: only the confirmation-overlay positive control needs
   * a DOM that can actually be appended to. Every other case keeps the bare
   * document above, so no existing assertion changes shape. */
  const mounted = [];
  if (options.dom) {
    const element = () => {
      const el = {
        style: {}, children: [], attributes: {}, id: '', innerHTML: '', textContent: '', disabled: false, _found: {},
        appendChild(child) { this.children.push(child); return child; },
        removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); return child; },
        setAttribute(k, v) { this.attributes[k] = String(v); },
        getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attributes, k) ? this.attributes[k] : null; },
        addEventListener() {}, removeEventListener() {}, remove() {}, focus() {}, click() {}, contains() { return false; },
        querySelector(sel) { if (!this._found[sel]) this._found[sel] = element(); return this._found[sel]; },
        querySelectorAll() { return []; }
      };
      return el;
    };
    document.createElement = element;
    document.body = element();
    document.body.appendChild = function (child) { mounted.push(child); this.children.push(child); return child; };
  }
  const window = {
    window: null, document, localStorage, _calAppts: options.calendar || [clone(CAL)],
    location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' },
    uns: key => 'acct:' + key, activePatient: () => active,
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) { if (type !== 'message') return; const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage(message) { posted.push(message); },
    __mlsSI: { _lastResp: () => source, _lastPullResult: () => pull, _lastRespAt: () => sourceAt }
  };
  window.window = window;
  /* the installed extension's advertised capability set: absent by default so
   * every pre-existing case keeps measuring the frozen 3.0.61 contract */
  if (options.capabilities) window.__mlsExtensionCapabilities = options.capabilities;
  /* actionSay()'s only observable in this harness */
  const said = [];
  window.toast = (message, kind) => { said.push({ message: String(message), kind: String(kind || '') }); };
  const context = vm.createContext({
    window, document, localStorage, location: window.location, console,
    Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Uint32Array,
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }
  });
  vm.runInContext(SOURCE, context, { filename: '1p-feat_mls_writeflow.js' });
  function deliver(message, resp, requestId) {
    const data = { source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: requestId || message.requestId, resp };
    listeners.slice().forEach(fn => fn({ data }));
  }
  async function settle(rounds) { for (let i = 0; i < (rounds || 8); i++) await new Promise(resolve => setImmediate(resolve)); }
  function open() {
    return window.__mlsWriteFlow.openUnifiedConfirmation({
      patient: clone(PATIENT), preferredAction: 'write_note', visitTimestamp: Date.parse(DAY + 'T14:00:00Z'),
      sections: [{ key: 'note', text: 'Synthetic reviewed note body.' }]
    });
  }
  return {
    window, posted, deliver, settle, open, said, mounted,
    state: () => window.__mlsP1AutoBind._test.currentState(),
    setActive(value) { active = value ? clone(value) : null; },
    replaceSource(value) { source = value; sourceAt = Date.now(); },
    replacePull(value) { pull = value; },
    bumpSourceClock() { sourceAt += 1; }
  };
}

/* This suite awaits promises returned by the shipped module. Its harness stubs
 * setTimeout, so a guard that stops refusing does not fail - it returns a
 * promise that never settles, the event loop drains, and node exits 0 with the
 * rest of the suite unrun. Measured: deleting the place_order row-hash guard
 * produced exactly that false green. The completion latch below turns a
 * never-settled await into a red gate. */
let COMPLETED = false;
process.on('exit', (code) => {
  if (code === 0 && !COMPLETED) {
    console.error('FAIL 1p Athena unlock adversarial runtime: the suite never reached its end. ' +
      'The event loop drained while awaiting a promise the module never settled - assertions after that point did not run.');
    process.exitCode = 1;
  }
});

/* Read a refusal without hanging on a guard that stopped refusing. */
async function refusal(h, promise, rounds) {
  let settled = false, value = null;
  promise.then((v) => { settled = true; value = v; }, (e) => { settled = true; value = { ok: false, error: 'threw: ' + ((e && e.message) || e) }; });
  await h.settle(rounds || 12);
  return settled ? (value || {}) : { ok: 'never-settled', error: 'never-settled' };
}

function negative(reason) { return { ok: false, blocked: true, reason: reason || 'context-unverified' }; }
function success(provider, token) {
  return { ok: true, mode: 'probe', action: 'write_note', readOnly: true, actionToken: token || 'discarded-autobind-token', context: {
    patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, appointmentId: APPOINTMENT,
    encounterId: '80000017', encounterUrl: 'https://athena.synthetic/encounter/80000017', visitDate: '8/17/2026', provider,
    control: 'Encounter note editor', encounterRootFingerprint: 'synthetic-root', controlFingerprint: 'synthetic-control',
    noteScopeFingerprint: 'synthetic-note-scope', editorFingerprint: 'synthetic-editor', contextHash: 'synthetic-context'
  } };
}

(async function main() {
  /* Happy path: probes are strictly serial, one exact candidate wins, and the
   * discovery token is discarded rather than arming Confirm. */
  {
    const h = makeHarness();
    const initial = h.open();
    assert.strictEqual(initial.visit.appointmentId, '', 'control manifest unexpectedly began bound');
    await h.settle();
    assert.strictEqual(h.posted.length, 1, 'all provider probes started concurrently');
    assert.strictEqual(h.posted[0].mode, 'probe');
    assert.strictEqual(h.posted[0].expectedContext.provider, 'Synthetic Clinician One, MD');
    h.deliver(h.posted[0], negative());
    await h.settle();
    assert.strictEqual(h.posted.length, 2, 'the second candidate did not wait for the first completed result');
    assert.strictEqual(h.posted[1].expectedContext.provider, 'Synthetic Clinician Two, MD');
    h.deliver(h.posted[1], success('Synthetic Clinician Two, MD'));
    await h.settle(12);
    const state = h.state();
    assert.strictEqual(state.manifest.visit.appointmentId, APPOINTMENT);
    assert.strictEqual(state.manifest.visit.provider, 'Synthetic Clinician Two, MD');
    assert.strictEqual(state.probe, null, 'auto-bind retained a discovery token as an executable row probe');
    assert(!JSON.stringify(state).includes('discarded-autobind-token'), 'auto-bind token leaked into review state');
    assert(!h.posted.some(message => message.mode === 'execute'), 'auto-bind crossed the mutation boundary');
  }

  /* Zero and multiple positives both block. */
  {
    const h = makeHarness(); h.open(); await h.settle();
    h.deliver(h.posted[0], negative()); await h.settle();
    h.deliver(h.posted[1], negative()); await h.settle(10);
    assert.strictEqual(h.state().manifest.visit.appointmentId, '', 'zero matches bound an encounter');
  }
  {
    const h = makeHarness(); h.open(); await h.settle();
    h.deliver(h.posted[0], success('Synthetic Clinician One, MD', 'discard-one')); await h.settle();
    h.deliver(h.posted[1], success('Synthetic Clinician Two, MD', 'discard-two')); await h.settle(10);
    assert.strictEqual(h.state().manifest.visit.appointmentId, '', 'ambiguous provider matches picked one');
    assert(!JSON.stringify(h.state()).includes('discard-one') && !JSON.stringify(h.state()).includes('discard-two'), 'ambiguous tokens entered review state');
  }

  /* Timeout/error is UNKNOWN, not a negative. It aborts the candidate sweep;
   * otherwise a later success could hide a second possible match. */
  for (const uncertain of [
    { __timeout: true },
    { ok: false, blocked: true, reason: 'outcome-uncertain' },
    { ok: false, blocked: true, reason: 'extension-error' }
  ]) {
    const h = makeHarness(); h.open(); await h.settle();
    h.deliver(h.posted[0], uncertain); await h.settle(10);
    assert.strictEqual(h.posted.length, 1, 'an indeterminate probe started another provider read: ' + JSON.stringify(uncertain));
    assert.strictEqual(h.state().manifest.visit.appointmentId, '', 'an indeterminate provider was counted as a safe negative');
  }

  /* Source replacement, patient switch, stale generation, and closure cancel
   * before another provider starts. */
  {
    const h = makeHarness(); h.open(); await h.settle();
    h.replaceSource(sourceReceipt());
    h.deliver(h.posted[0], negative()); await h.settle(10);
    assert.strictEqual(h.posted.length, 1, 'a stale pull response was used for the next provider');
    assert.strictEqual(h.state().manifest.visit.appointmentId, '');
  }
  {
    const h = makeHarness(); h.open(); await h.settle();
    h.setActive(OTHER); h.deliver(h.posted[0], negative()); await h.settle(10);
    assert.strictEqual(h.posted.length, 1, 'patient switch did not cancel remaining probes');
    assert.strictEqual(h.state().manifest.visit.appointmentId, '');
  }
  {
    const h = makeHarness(); h.open(); await h.settle();
    h.state().probeGeneration += 1; h.deliver(h.posted[0], negative()); await h.settle(10);
    assert.strictEqual(h.posted.length, 1, 'stale generation started another probe');
    assert.strictEqual(h.state().manifest.visit.appointmentId, '');
  }
  {
    const h = makeHarness(); h.open(); await h.settle();
    h.state().closed = true; h.deliver(h.posted[0], negative()); await h.settle(10);
    assert.strictEqual(h.posted.length, 1, 'closed review started another probe');
  }

  /* Wrong day/request/no appointment fail before any bridge request. */
  {
    const bad = sourceReceipt(); bad.schedDate = '2026-08-18';
    const h = makeHarness({ source: bad }); h.open(); await h.settle();
    assert.strictEqual(h.posted.length, 0, 'wrong-day source reached the extension');
  }
  {
    const bad = sourceReceipt(); bad.providerRosterReceipt.requestId = 'stale-request';
    const h = makeHarness({ source: bad }); h.open(); await h.settle();
    assert.strictEqual(h.posted.length, 0, 'stale request reached the extension');
  }
  {
    const h = makeHarness({ ledger: false }); h.open(); await h.settle();
    assert.strictEqual(h.posted.length, 0, 'missing exact appointment reached the extension');
  }

  /* Correlation prevents response replay. */
  {
    const h = makeHarness(); h.open(); await h.settle();
    const first = h.posted[0];
    h.deliver(first, success('Synthetic Clinician One, MD'), 'replayed-foreign-request-id');
    await h.settle(10);
    assert.strictEqual(h.posted.length, 1, 'a replayed response advanced the provider sequence');
    assert.strictEqual(h.state().manifest.visit.appointmentId, '', 'a replayed response bound an encounter');
    h.state().closed = true;
  }

  /* An already-running ordinary Athena action owns the global lease and blocks
   * opening this review. */
  {
    const h = makeHarness();
    h.window.__mlsWriteFlow.startAthenaAction('write_note', {
      patient: clone(PATIENT), sections: [{ key: 'note', text: 'Synthetic reviewed note body.' }],
      expectedContext: { appointmentId: APPOINTMENT, visitDate: DAY, provider: 'Synthetic Clinician One, MD' }
    });
    await h.settle();
    const opened = h.open();
    assert.strictEqual(opened, null, 'auto-bind review bypassed an existing Athena action lease');
    assert.strictEqual(h.window.__mlsP1AutoBind._test.currentState(), null);
  }

  /* Frozen 3.0.61 keeps every final clinical/financial lane manual. */
  {
    const h = makeHarness();
    const manifest = h.window.__mlsWriteFlow.buildUnifiedManifest({
      patient: clone(PATIENT), expectedContext: { appointmentId: APPOINTMENT, visitDate: DAY, provider: 'Synthetic Clinician One, MD' },
      plan: [
        { kind: 'note', body: 'NOTE TEXT:\nSynthetic reviewed note body.' },
        { kind: 'billing', body: 'BILLING:\nE/M level: 99214', billing: { emCode: '99214', cptCodes: [] } },
        { kind: 'orders', body: 'ORDERS:\nSynthetic imaging proposal.' }
      ]
    });
    const executable = manifest.rows.filter(row => row.action).map(row => row.action).sort();
    assert.deepStrictEqual(Array.from(executable), ['save_draft', 'write_note']);
    for (const id of ['stage-billing', 'sign-encounter']) {
      const row = manifest.rows.find(item => item.id === id);
      assert(row && row.capability === 'manual' && row.action === '', id + ' escaped the manual gate');
    }
    assert(!manifest.rows.some(row => row.action === 'place_order'), 'orders became executable');
  }

  /* ======================================================================
   * The two unlocked lanes the gate never executed (readiness verdict 2).
   * Three passing 1p suites already cover the unlocked action set, the
   * stale-extension degrade and the MRN identity lock. Neither `noteWriteProof`
   * nor `opts.rowHash` appeared in ANY 1p test, so the two guards that make
   * sign_encounter and place_order safe were source-only. Both are executed
   * here against the shipped 1p bytes, each with a positive control so a
   * universal refusal cannot masquerade as a proof.
   * ==================================================================== */

  const CAPABLE = { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true };

  /* ---- (b) place_order refuses without the immutable review row hash ---- */
  const ORDER = {
    type: 'imaging', clientOrderId: 'synthetic-order-1', displayLabel: 'MRI Left Knee w/o contrast',
    query: 'MRI knee left without contrast', catalogCode: 'SYN-MRI-KNEE-L',
    fields: { study: 'MRI knee', region: 'Left knee', indication: 'Synthetic indication' },
    reviewStatus: 'accepted', source: 'provider-entered'
  };
  {
    const h = makeHarness({ capabilities: CAPABLE });
    const refused = await refusal(h, h.window.__mlsWriteFlow.startAthenaAction('place_order', {
      patient: clone(PATIENT), order: clone(ORDER) /* no rowHash */
    }));
    assert.strictEqual(refused.ok, false, 'place_order ran without an immutable review row hash (result: ' +
      JSON.stringify(refused) + ')');
    assert.strictEqual(refused.error, 'order-row-hash-required',
      'place_order without opts.rowHash refused for the wrong reason: ' + refused.error);
    assert.strictEqual(h.posted.length, 0, 'a row-hash-less order still reached the extension bridge');
    assert(h.said.some(entry => /immutable review hash/.test(entry.message) && entry.kind === 'err'),
      'the row-hash refusal was silent');

    /* positive control: the SAME call with a row hash gets past this gate */
    const g = makeHarness({ capabilities: CAPABLE });
    g.window.__mlsWriteFlow.startAthenaAction('place_order', {
      patient: clone(PATIENT), order: clone(ORDER), rowHash: 'synthetic-row-hash'
    });
    await g.settle();
    assert.strictEqual(g.posted.length, 1,
      'positive control failed: place_order WITH a row hash never reached the read-only probe, ' +
      'so the refusal above proves nothing about rowHash');
    assert.strictEqual(g.posted[0].mode, 'probe', 'the order probe was not read-only');
    assert.strictEqual(g.posted[0].rowHash, 'synthetic-row-hash', 'the reviewed row hash was not carried to the extension');
    assert.strictEqual(g.posted[0].clientOrderId, 'synthetic-order-1', 'the immutable client order id was not carried');
    assert(!g.posted.some(message => message.mode === 'execute'), 'an order crossed the mutation boundary during probe');
  }

  /* ---- (a) sign_encounter refuses unless the verified-write receipt is
   * bound to the EXACT encounter Athena just returned ------------------- */
  /* The receipt key is derived by running the shipped normalizers, not by
   * re-implementing them, so the derivation cannot drift away from the guard. */
  function sliceFn(name) {
    const anchor = '\n  function ' + name + '(';
    const at = SOURCE.indexOf(anchor);
    assert(at >= 0, 'writeflow helper `' + name + '` is gone; the receipt-key derivation lost its source');
    let i = SOURCE.indexOf('{', at + anchor.length), depth = 0;
    for (; i < SOURCE.length; i += 1) {
      if (SOURCE[i] === '{') depth += 1;
      else if (SOURCE[i] === '}') { depth -= 1; if (depth === 0) { i += 1; break; } }
    }
    return SOURCE.slice(at + 1, i);
  }
  const keyBox = vm.createContext({ Date, Math, JSON, Number, String, RegExp, Object, Array });
  vm.runInContext([
    'var S = function (x) { return x == null ? \'\' : String(x); };',
    sliceFn('nrmName'), sliceFn('nrmDob'), sliceFn('contextValue'),
    sliceFn('actionPatientKey'), sliceFn('actionContextSignature'),
    'this.patientKey = actionPatientKey; this.sig = actionContextSignature;'
  ].join('\n'), keyBox);

  const SESSION = 'synthetic-receipt-session';
  const PREVIEW = 'mls-preview-synthetic-sign';
  const NOTE_TEXT = 'Synthetic reviewed note body.';
  const SIGN_OPTS = () => ({
    patient: clone(PATIENT), receiptSessionId: SESSION, previewHash: PREVIEW,
    sections: [{ key: 'note', text: NOTE_TEXT }]
  });
  const BOUND_CONTEXT = {
    encounterId: '80000017', encounterUrl: 'https://athena.synthetic/encounter/80000017',
    visitDate: '8/17/2026', provider: 'Synthetic Clinician Two, MD'
  };
  const OTHER_CONTEXT = {
    encounterId: '80000099', encounterUrl: 'https://athena.synthetic/encounter/80000099',
    visitDate: '8/17/2026', provider: 'Synthetic Clinician Two, MD'
  };
  function plantReceipt(h, context, proof) {
    const hash = h.window.__mlsWriteFlow.previewHash;
    const prefix = [SESSION, keyBox.patientKey(PATIENT), PREVIEW, hash(NOTE_TEXT)].join('||');
    const key = prefix + '||' + keyBox.sig(context);
    assert(keyBox.sig(context), 'the synthetic encounter context does not produce a signature');
    h.window.__mlsWriteFlow.state.verifiedWrites[key] = {
      action: 'write_note', noteWriteProof: proof, noteWriteProofExpiresAt: Date.now() + 600000,
      contextSignature: keyBox.sig(context), context: context, verified: true
    };
    return key;
  }
  function signProbe(context, token) {
    const base = success(context.provider, token || 'synthetic-sign-token');
    base.action = 'sign_encounter';
    Object.assign(base.context, context);
    base.context.encounterDate = context.visitDate;
    return base;
  }

  /* (a-0) no verified write at all: the outer gate refuses before any bridge */
  {
    const h = makeHarness({ capabilities: CAPABLE });
    const refused = await refusal(h, h.window.__mlsWriteFlow.startAthenaAction('sign_encounter', SIGN_OPTS()));
    assert.strictEqual(refused.ok, false, 'sign_encounter ran with no verified note write at all (result: ' +
      JSON.stringify(refused) + ')');
    assert.strictEqual(refused.error, 'verified-note-write-required',
      'sign_encounter with no receipt refused for the wrong reason: ' + refused.error);
    assert.strictEqual(h.posted.length, 0, 'an unverified Sign & Save reached the extension bridge');
  }

  /* (a-1) a receipt exists, but for a DIFFERENT encounter than the one Athena
   * returned: the outer prefix gate passes, the exact-context gate refuses. */
  {
    const h = makeHarness({ capabilities: CAPABLE, dom: true });
    plantReceipt(h, BOUND_CONTEXT, 'synthetic-note-write-proof');
    h.window.__mlsWriteFlow.startAthenaAction('sign_encounter', SIGN_OPTS());
    await h.settle();
    assert.strictEqual(h.posted.length, 1,
      'setup failed: the planted verified-write receipt did not satisfy the outer Sign & Save gate, ' +
      'so the exact-context guard below was never reached');
    assert.strictEqual(h.posted[0].mode, 'probe', 'Sign & Save probed with a mutating request');
    assert.strictEqual(h.posted[0].noteWriteProof, 'synthetic-note-write-proof',
      'the verified-write proof was not carried into the read-only probe');
    h.deliver(h.posted[0], signProbe(OTHER_CONTEXT));
    await h.settle(12);
    assert(h.said.some(entry => /Sign & Save is still locked/.test(entry.message) && entry.kind === 'err'),
      'a note-write proof bound to a DIFFERENT encounter did not lock Sign & Save. Said: ' +
      JSON.stringify(h.said.map(entry => entry.message)));
    assert.strictEqual(h.mounted.length, 0, 'the confirmation overlay opened for an unproven encounter');
    assert(!h.posted.some(message => message.mode === 'execute'), 'Sign & Save crossed the mutation boundary');
  }

  /* (a-2) positive control: the identical run whose ONLY difference is that
   * the returned encounter matches the receipt reaches the confirmation. */
  {
    const h = makeHarness({ capabilities: CAPABLE, dom: true });
    plantReceipt(h, BOUND_CONTEXT, 'synthetic-note-write-proof');
    h.window.__mlsWriteFlow.startAthenaAction('sign_encounter', SIGN_OPTS());
    await h.settle();
    assert.strictEqual(h.posted.length, 1, 'positive control never probed');
    h.deliver(h.posted[0], signProbe(BOUND_CONTEXT));
    await h.settle(12);
    assert(!h.said.some(entry => /Sign & Save is still locked/.test(entry.message)),
      'positive control was refused, so the (a-1) refusal proves nothing about noteWriteProof matching. Said: ' +
      JSON.stringify(h.said.map(entry => entry.message)));
    assert.strictEqual(h.mounted.length, 1,
      'positive control did not reach the confirmation overlay, so the guard under test is unproven');
    assert.strictEqual(h.mounted[0].id, 'mlsAthenaActionConfirm', 'a different node was mounted');
    /* the confirmation is a STOP: still nothing executed without a real click */
    assert(!h.posted.some(message => message.mode === 'execute'),
      'the matching encounter auto-executed without a clinician confirmation click');
  }

  /* (a-3) a receipt whose proof string is empty is not a receipt. */
  {
    const h = makeHarness({ capabilities: CAPABLE, dom: true });
    plantReceipt(h, BOUND_CONTEXT, '');
    const refused = await refusal(h, h.window.__mlsWriteFlow.startAthenaAction('sign_encounter', SIGN_OPTS()));
    assert.strictEqual(refused.ok, false, 'an empty note-write proof unlocked Sign & Save (result: ' +
      JSON.stringify(refused) + ')');
    assert.strictEqual(refused.error, 'verified-note-write-required',
      'an empty note-write proof refused for the wrong reason: ' + refused.error);
    assert.strictEqual(h.posted.length, 0, 'an empty-proof Sign & Save reached the extension bridge');
  }

  assert(/var probeSequence = Promise\.resolve\(\)/.test(SOURCE) && !/Promise\.all\(attempts\)/.test(SOURCE), 'provider probes are not structurally serialized');
  COMPLETED = true;
  console.log('PASS 1p Athena unlock adversarial runtime: exact-one provider, serial/cancelled probes, stale/patient/replay/error blocks, discarded discovery tokens, frozen manual final lanes, place_order row-hash gate (+control), and the sign_encounter exact-encounter noteWriteProof gate (+control)');
})().catch(error => { console.error(error); process.exit(1); });
