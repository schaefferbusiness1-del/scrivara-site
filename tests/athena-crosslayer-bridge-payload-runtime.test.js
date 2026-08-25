'use strict';

/*
 * Read-only cross-layer proof for the Athena handoff.  This deliberately stops
 * at the page -> content-script -> runtime request boundary: all requests are
 * mode:'probe', so no Athena tab, note, save, sign, order, or background write
 * is exercised.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, `missing function marker: ${marker}`);
  const open = source.indexOf('{', start);
  assert(open > start, `missing function body: ${marker}`);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`unbalanced function: ${marker}`);
}

function flowContext(flowSource) {
  const listeners = Object.create(null);
  const document = {
    readyState: 'loading', body: {}, activeElement: null,
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    getElementById() { return null; },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {}, addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } }; }
  };
  const window = {
    window: null, document, location: { origin: 'https://mlsscribe.com', hostname: 'mlsscribe.com' },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener() {}, postMessage() {}, toast() {}
  };
  window.window = window;
  function MutationObserver() {}
  MutationObserver.prototype.observe = function () {};
  MutationObserver.prototype.disconnect = function () {};
  const context = {
    window, document, location: window.location, MutationObserver, console,
    setTimeout, clearTimeout, setInterval, clearInterval, Date, Math, Promise,
    Object, Array, String, Number, RegExp, JSON, Uint32Array
  };
  vm.createContext(context);
  vm.runInContext(flowSource, context);
  return { context, flow: window.__mlsWriteFlow };
}

function shellPlan(shell, flow, noteText) {
  const source = fs.readFileSync(path.join(root, shell), 'utf8');
  const planBuilder = extractFunction(source, 'function _athenaBuildPlan(binding)');
  const context = {
    window: { __mlsWriteFlow: flow },
    emrReadyText: () => noteText,
    currentCoding: null, currentOrders: [], aiSuggestedOrders: [], currentNoteProvenance: 'generated_soap',
    ATHENA_SECTIONS: { note: { icon: 'N', dest: 'note' }, dx: { icon: 'D', dest: 'dx' }, billing: { icon: 'B', dest: 'billing' }, orders: { icon: 'O', dest: 'orders' } },
    _athenaCanonicalBilling: () => ({}),
    _athenaOrderReviewBundle: () => ({ drafts: [], suggestions: [] }), console
  };
  vm.createContext(context);
  vm.runInContext(`${planBuilder}\nthis.__built = _athenaBuildPlan({ patient: { name: 'Synthetic SOAP Patient' } });`, context);
  return context.__built;
}

function savedOpNotePlan(shell, flow, text) {
  const source = fs.readFileSync(path.join(root, shell), 'utf8');
  const route = extractFunction(source, 'function pushHistoryNoteToAthena(id)');
  let captured = null;
  const record = {
    id: 'saved-op-note', kind: 'opnote', isDraft: false,
    text, patient: 'Synthetic Procedure Patient', patientId: 'patient-procedure-1',
    dob: '04/18/1972', mrn: '730041', coding: null, orders: []
  };
  const context = {
    String, Array, Date, Math, console,
    getNotes: () => [record],
    opNoteBlankTokens: () => [],
    _athenaBindingForSavedRecord: () => ({
      routeBlocked: false, identityConflict: false,
      patient: { name: record.patient, dob: record.dob, mrn: record.mrn, patientId: record.patientId },
      visitContext: { historical: true, visitDate: '08/24/2026', provider: 'Synthetic Clinician, MD', appointmentId: '8830041', encounterId: '9930041', encounterUrl: 'https://athenanet.athenahealth.com/encounter/9930041' }
    }),
    ATHENA_SECTIONS: {
      procedure: { icon: 'P', label: 'PROCEDURE / OPERATIVE NOTE', dest: flow.destinations.procedure },
      note: { icon: 'N', label: 'NOTE', dest: flow.destinations.note },
      dx: { icon: 'D', label: 'DIAGNOSES', dest: 'dx' }, billing: { icon: 'B', label: 'BILLING', dest: 'billing' }, orders: { icon: 'O', label: 'ORDERS', dest: 'orders' }
    },
    _athenaOrderReviewBundle: () => ({ drafts: [], suggestions: [] }),
    _athenaPushPlan: (plan, who, patient, visitContext) => { captured = { plan, who, patient, visitContext }; },
    toast() {}
  };
  vm.createContext(context);
  vm.runInContext(`${route}\npushHistoryNoteToAthena('saved-op-note');`, context);
  assert(captured, 'saved completed op note did not reach the app plan handoff');
  return captured;
}

function contentBridge(contentSource) {
  const requests = [];
  const posts = [];
  const listeners = Object.create(null);
  const window = {
    __mlsAssistLoaded: false,
    location: { origin: 'https://mlsscribe.com', hostname: 'mlsscribe.com' },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
    removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
    postMessage(message, origin) { posts.push({ message, origin }); }
  };
  const document = {
    hidden: false, body: {}, documentElement: {},
    addEventListener() {}, removeEventListener() {}, createElement() { return { style: {}, appendChild() {}, setAttribute() {} }; },
    getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }
  };
  const chrome = {
    runtime: {
      id: 'synthetic-extension', lastError: null,
      sendMessage(message, callback) { requests.push(message); if (callback) callback({ ok: true, readOnly: true }); },
      getManifest: () => ({ version: 'synthetic' }), onMessage: { addListener() {} }
    },
    storage: { local: { get(_keys, callback) { callback({}); } }, onChanged: { addListener() {} } }
  };
  const start = contentSource.indexOf('(function () {');
  const marker = contentSource.indexOf('/* ATHENA_ACTION_V2_BRIDGE_END */');
  const end = contentSource.indexOf('};', marker) + 2;
  assert(start >= 0 && marker >= 0 && end > marker, 'content action bridge boundaries are missing');
  const bridgeSource = contentSource.slice(start, end) + '\nthis.__handler = mlsBridgeHandler;\n})();';
  const context = {
    window, document, chrome, location: window.location, URL, crypto: { getRandomValues(a) { a.fill(7); return a; } },
    Uint32Array, Date, Math, String, Number, Array, Object, RegExp, JSON, Promise, setTimeout, clearTimeout,
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }), console
  };
  vm.createContext(context);
  vm.runInContext(bridgeSource, context);
  assert.strictEqual(typeof context.__handler, 'function', 'content bridge handler did not initialize');
  return { handler: context.__handler, requests, posts };
}

function sendProbe(bridge, payload, identity, context, manifestHash, rowHash) {
  const lockedProbeContext = {
    patientName: identity.name, dob: identity.dob, mrn: identity.mrn,
    appointmentId: context.appointmentId, encounterId: context.encounterId,
    encounterUrl: context.encounterUrl, visitDate: context.visitDate, provider: context.provider,
    framePath: '0', encounterRootFingerprint: 'root-fingerprint', controlLabel: 'HPI editor',
    controlFingerprint: 'control-fingerprint', noteScopeFingerprint: 'scope-fingerprint',
    actionContainerFingerprint: 'container-fingerprint', editorFingerprint: 'editor-fingerprint',
    contextHash: 'context-hash', taughtDestinationFingerprint: '', taughtDestinationLabel: ''
  };
  bridge.handler({
    origin: 'https://mlsscribe.com',
    data: {
      source: 'mls-app', type: 'mlsAppAthenaActionV2', mode: 'probe', action: 'write_note',
      requestId: `probe-${rowHash}`, previewHash: 'mls-preview-cross-layer', manifestHash, rowHash,
      expectedPatient: identity, expectedContext: context,
      probeContext: lockedProbeContext,
      payload, noteText: payload.noteText, sections: payload.sections, notePolicy: 'empty_only'
    }
  });
  const request = bridge.requests[bridge.requests.length - 1];
  assert(request, 'site probe did not reach the content -> runtime bridge');
  assert.strictEqual(request.mode, 'probe');
  assert.strictEqual(request.action, 'write_note');
  assert.strictEqual(request.probeContext.appointmentId, context.appointmentId,
    'the content relay dropped the exact appointment id that execute must compare to the probe lock');
  assert.deepStrictEqual(plain(request.probeContext), lockedProbeContext,
    'the content relay changed the immutable probe context before the background execute gate');
  return request;
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const soap = [
  'HPI: Synthetic symptoms began two weeks ago.',
  'ROS: Synthetic patient denies dyspnea.',
  'EXAM: Synthetic lungs are clear.',
  'ASSESSMENT: Synthetic acute bronchitis.',
  'PLAN: Synthetic supportive care and follow-up.'
].join('\n');
const identity = { patientId: 'patient-soap-1', name: 'Synthetic SOAP Patient', dob: '01/02/1980', mrn: '123' };
const visit = { visitDate: '08/24/2026', provider: 'Synthetic Clinician, MD', appointmentId: '8830001', encounterId: '9930001', encounterUrl: 'https://athenanet.athenahealth.com/encounter/9930001' };
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');
const bridge = contentBridge(content);
const laneFiles = ['feat_mls_writeflow.js', '1p-feat_mls_writeflow.js', 'cloned-feat_mls_writeflow.js'];
const laneDestinations = [];

for (const lane of laneFiles) {
  const loaded = flowContext(fs.readFileSync(path.join(root, lane), 'utf8'));
  assert(loaded.flow && loaded.flow.destinations, `${lane}: writeflow did not expose destination constants`);
  laneDestinations.push(plain(loaded.flow.destinations));
  const built = shellPlan('ScribeFlow.html', loaded.flow, soap);
  assert.strictEqual(built.blocked, undefined, `${lane}: valid generated SOAP was blocked`);
  assert.deepStrictEqual(Array.from(built.plan, row => row.kind), ['hpi', 'ros', 'exam', 'assessment', 'plan'], `${lane}: shell plan did not retain all five named sections`);
  const sections = built.plan.map(row => ({ key: row.kind, text: row.body, execute: true, destination: loaded.flow.destinations[row.kind] }));
  const manifest = loaded.flow.buildUnifiedManifest({ patient: identity, expectedContext: visit, requireExpectedVisit: true, receiptSessionId: `soap-${lane}`, previewHash: `preview-${lane}`, plan: [], sections });
  const rows = manifest.rows.filter(row => row.action === 'write_note');
  assert.deepStrictEqual(Array.from(rows, row => row.kind), ['hpi', 'ros', 'exam', 'assessment', 'plan'], `${lane}: unified manifest lost a named row`);
  assert.strictEqual(rows.length, sections.length, `${lane}: unified manifest did not preserve five independent rows`);
  rows.forEach((row, index) => {
    const expected = sections[index];
    assert.deepStrictEqual(row.payload.sections, [expected], `${lane}/${row.kind}: manifest changed key/text/execute/destination bytes`);
    const request = sendProbe(bridge, row.payload, identity, visit, manifest.manifestHash, row.rowHash);
    assert.deepStrictEqual(plain(request.sections), [expected], `${lane}/${row.kind}: content bridge changed key/text/execute/destination bytes`);
  });
}

assert.deepStrictEqual(laneDestinations[1], laneDestinations[0], '1p writeflow destination constants drifted from production');
assert.deepStrictEqual(laneDestinations[2], laneDestinations[0], 'cloned writeflow destination constants drifted from production');

const procedureText = 'PREOPERATIVE DIAGNOSIS:\nSynthetic documented diagnosis.\n\nPROCEDURE:\nSynthetic completed procedure with no invented finding.';
const productionFlow = flowContext(fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8')).flow;
const saved = savedOpNotePlan('1pScribeFlow.html', productionFlow, procedureText);
assert.strictEqual(saved.plan[0].kind, 'procedure', 'saved completed op note was not classified as procedure');
const procedureManifest = productionFlow.buildUnifiedManifest({
  patient: saved.patient, expectedContext: saved.visitContext, requireExpectedVisit: true,
  receiptSessionId: 'saved-procedure', previewHash: 'preview-saved-procedure', plan: saved.plan, sections: []
});
const procedureRow = procedureManifest.rows.find(row => row.action === 'write_note' && row.kind === 'procedure');
assert(procedureRow, 'saved completed op note did not produce an executable Procedure Documentation row');
assert.strictEqual(procedureRow.destination, productionFlow.destinations.procedure);
assert.deepStrictEqual(procedureRow.payload.sections, [{ key: 'procedure', text: procedureText, execute: true, destination: productionFlow.destinations.procedure }]);
const procedureRequest = sendProbe(bridge, procedureRow.payload, saved.patient, saved.visitContext, procedureManifest.manifestHash, procedureRow.rowHash);
assert.deepStrictEqual(plain(procedureRequest.sections), plain(procedureRow.payload.sections), 'saved op note changed before reaching the content bridge');
assert.strictEqual(procedureRequest.sections[0].destination, 'Athena encounter > Physical Exam > Procedure Documentation');

assert.strictEqual(bridge.requests.every(request => request.mode === 'probe'), true, 'cross-layer proof emitted a mutating request');
console.log(`PASS Athena cross-layer bridge payloads: ${laneFiles.length} lanes, five SOAP destinations, saved Procedure Documentation payload, and exact destination parity; ${bridge.requests.length} read-only probes, no writes/orders`);
