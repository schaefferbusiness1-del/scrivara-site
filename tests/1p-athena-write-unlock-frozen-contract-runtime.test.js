'use strict';

/* 1p preview only: execute the exact candidate and probe validators used to
 * bridge the provider-unknown appointment census to frozen MLS Assist 3.0.61.
 * No real extension, browser, Athena data or mutation is involved. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');
const DAY = '2026-08-17';
const NOW = Date.parse('2026-08-12T23:00:00Z');
const PATIENT = { patientId: 'patient-1', id: 'patient-1', name: 'Example Patient', dob: '01/02/1980', mrn: '123456' };
const CAL_ROW = { id: 'backend-1', patient_external_id: 'patient-1', name: PATIENT.name, dob: PATIENT.dob, provider: '', appt_date: DAY, day_local: DAY, start_at: DAY + 'T14:00:00.000Z' };
const APPOINTMENT_ID = '52585118';
const REQUEST_ID = 'req-p1-write-1';

const stores = new Map([['acct:schedImportIndexV1::' + DAY, JSON.stringify({ v: 1, rows: {
  ['appointment-id:' + APPOINTMENT_ID]: { state: 'done', patientId: PATIENT.patientId, backendAppointmentId: CAL_ROW.id, appt_date: DAY, updated: NOW }
} })]]);
const localStorage = { getItem: key => stores.has(key) ? stores.get(key) : null, setItem: (key, value) => stores.set(key, String(value)), removeItem: key => stores.delete(key) };
const element = () => ({ style: {}, dataset: {}, classList: { add() {}, remove() {}, contains() { return false; } },
  setAttribute() {}, removeAttribute() {}, addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
  querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, focus() {}, textContent: '', innerHTML: '' });
const document = { readyState: 'complete', body: element(), head: element(), documentElement: element(), activeElement: null,
  addEventListener() {}, removeEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
  getElementById() { return null; }, createElement: element };
const window = { document, localStorage, _calAppts: [CAL_ROW], activePatient: () => PATIENT, uns: key => 'acct:' + key,
  location: { hostname: 'mlsscribe.com', origin: 'https://mlsscribe.com' }, addEventListener() {}, removeEventListener() {}, postMessage() {} };
window.window = window;
const context = vm.createContext({ window, document, localStorage, location: window.location, Date, Promise, Object, Array, String, Number, Math, JSON,
  setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; }, console });
vm.runInContext(source, context, { filename: '1p-feat_mls_writeflow.js' });
const api = window.__mlsP1AutoBind && window.__mlsP1AutoBind._test;
assert(api && typeof api.candidates === 'function' && typeof api.validateProbe === 'function', 'p1 auto-bind test seam missing');

const manifest = window.__mlsWriteFlow.buildUnifiedManifest({ patient: PATIENT, sections: [{ key: 'note', text: 'Reviewed note body.' }], visitTimestamp: Date.parse(DAY + 'T14:00:00Z') });
assert.strictEqual(manifest.visit.appointmentId, '', 'provider-unknown census must remain blocked before candidate probing');
assert.strictEqual(manifest.visit.provider, '');

function receiptSource() {
  const coverage = { verdict: 'row-unattributed', rows: 1, headerCount: 2, unattributedRows: 1, foreignRows: 0 };
  return { id: REQUEST_ID, requestId: REQUEST_ID, ok: true, scheduleVerified: true, schedDate: DAY,
    appts: [{ name: PATIENT.name, date: DAY, appointmentId: APPOINTMENT_ID, provider: '' }],
    providerRoster: [
      { stableKey: 'header:1', id: '101', name: 'Header One, MD', raw: 'Header_One_MD' },
      { stableKey: 'header:2', id: '202', name: 'Header Two, MD', raw: 'Header_Two_MD' }
    ],
    receipt: { complete: true, authoritativeEmpty: false, requestId: REQUEST_ID, expectedCount: 1, parsedCount: 1, candidateCount: 1 },
    providerRosterReceipt: { complete: false, partial: true, reason: 'legacy-unverified', providerMode: 'all', requestId: REQUEST_ID, targetDate: DAY,
      requestedProviderId: '', requestedProviderStableKey: '', observedCount: 2, attributionCoverage: coverage } };
}
function pullResult() {
  return { ok: true, complete: true, reason: 'complete-appointment-census-only',
    providerRosterReceipt: { complete: false, partial: true, reason: 'legacy-unverified', providerMode: 'all', requestId: REQUEST_ID, targetDate: DAY,
      requestedProviderId: '', requestedProviderStableKey: '' },
    appointmentCensusReceipt: { kind: 'athena-appointment-census', complete: true, reason: 'complete-provider-unknown', scope: 'appointment-census-only',
      targetDate: DAY, requestId: REQUEST_ID, expectedCount: 1, parsedCount: 1, candidateCount: 1, rowCount: 1, uniqueAppointmentIds: 1,
      providerHeaderCount: 2, unattributedRows: 1, foreignRows: 0, providerAttributionComplete: false, providerFieldsBlank: true, noProviderGuess: true, providerSnapshotAllowed: false } };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }

const verified = api.candidates(manifest, receiptSource(), pullResult(), NOW, NOW - 1000);
assert.strictEqual(verified.ok, true, JSON.stringify(verified));
assert.strictEqual(verified.appointmentId, APPOINTMENT_ID);
assert.deepStrictEqual(Array.from(verified.candidates, c => c.provider), ['Header One, MD', 'Header Two, MD']);

for (const [label, mutate] of [
  ['wrong served day', s => { s.schedDate = '2026-08-18'; }],
  ['request replay', s => { s.providerRosterReceipt.requestId = 'old-request'; }],
  ['mixed provider coverage', s => { s.providerRosterReceipt.attributionCoverage.verdict = 'mixed'; }],
  ['foreign row', s => { s.providerRosterReceipt.attributionCoverage.foreignRows = 1; }],
  ['provider leaked onto appointment', s => { s.appts[0].provider = 'Header One, MD'; }],
  ['duplicate appointment id', s => { s.receipt.expectedCount = s.receipt.parsedCount = s.receipt.candidateCount = 2; s.providerRosterReceipt.attributionCoverage.rows = s.providerRosterReceipt.attributionCoverage.unattributedRows = 2; s.appts.push(clone(s.appts[0])); }]
]) {
  const bad = receiptSource(); mutate(bad);
  assert.strictEqual(api.candidates(manifest, bad, pullResult(), NOW, NOW - 1000).ok, false, label + ' was accepted');
}
assert.strictEqual(api.candidates(manifest, receiptSource(), pullResult(), NOW, NOW - 31 * 60 * 1000).reason, 'schedule-response-stale');
assert.strictEqual(api.candidates(manifest, receiptSource(), pullResult(), NOW, new Date(NOW - 1000).toISOString()).ok, true, 'fresh ISO response timestamp was not parsed');
assert.strictEqual(api.candidates(manifest, receiptSource(), pullResult(), NOW, new Date(NOW - 31 * 60 * 1000).toISOString()).reason, 'schedule-response-stale', 'stale ISO response timestamp was accepted');
const badPull = pullResult(); badPull.appointmentCensusReceipt.requestId = 'old-request';
assert.strictEqual(api.candidates(manifest, receiptSource(), badPull, NOW, NOW - 1000).ok, false, 'unbound completed pull was accepted');

const candidate = verified.candidates[0];
function probe(overrides) {
  return Object.assign({ ok: true, mode: 'probe', readOnly: true, actionToken: 'discard-me', context: {
    patientName: PATIENT.name, dob: PATIENT.dob, mrn: PATIENT.mrn, appointmentId: APPOINTMENT_ID,
    encounterId: '98765', encounterUrl: 'https://athena.example/encounter/98765', visitDate: '8/17/2026', provider: candidate.provider,
    control: 'Save', framePath: '0', encounterRootFingerprint: 'er', controlFingerprint: 'c', noteScopeFingerprint: 'n', editorFingerprint: 'e', contextHash: 'h'
  } }, overrides || {});
}
assert.strictEqual(api.validateProbe(PATIENT, candidate, probe()).ok, true);
const timedOut = api.validateProbe(PATIENT, candidate, { __timeout: true });
assert.strictEqual(timedOut.indeterminate, true, 'timeout was treated as a provider non-match');
assert.strictEqual(timedOut.determinate, false, 'timeout was counted toward the exactly-one decision');
const definitiveNegative = api.validateProbe(PATIENT, candidate, { ok: false, blocked: true, reason: 'context-unverified' });
assert.strictEqual(definitiveNegative.determinate, true, 'frozen completed context-unverified receipt was not treated as a definitive negative');
assert.strictEqual(definitiveNegative.indeterminate, false);
for (const uncertain of [
  { ok: false, reason: 'outcome-uncertain' },
  { ok: false, error: 'no response' },
  { ok: false, error: 'extension error' },
  {}, null
]) {
  assert.strictEqual(api.validateProbe(PATIENT, candidate, uncertain).indeterminate, true, 'malformed/uncertain transport response was treated as a provider non-match');
}
assert.strictEqual(api.validateProbe(PATIENT, candidate, probe({ readOnly: false })).ok, false, 'non-read-only response accepted');
const wrongDay = probe(); wrongDay.context.visitDate = '8/18/2026';
assert.strictEqual(api.validateProbe(PATIENT, candidate, wrongDay).ok, false, 'wrong day accepted');
const wrongProvider = probe(); wrongProvider.context.provider = 'Header Two, MD';
assert.strictEqual(api.validateProbe(PATIENT, candidate, wrongProvider).ok, false, 'wrong provider accepted');
const wrongAppt = probe(); wrongAppt.context.appointmentId = '52585119';
assert.strictEqual(api.validateProbe(PATIENT, candidate, wrongAppt).ok, false, 'wrong appointment accepted');
const wrongIdentity = probe(); wrongIdentity.context.mrn = '999999';
assert.strictEqual(api.validateProbe(PATIENT, candidate, wrongIdentity).ok, false, 'wrong patient accepted');
assert.strictEqual(api.validateProbe(PATIENT, candidate, wrongIdentity).indeterminate, true, 'claimed success with the wrong identity could be counted as a safe negative');
assert.strictEqual(api.samePatient(PATIENT, Object.assign({}, PATIENT, { patientId: 'patient-2' })), false, 'patient switch accepted');

/* Frozen extension pre-gate is part of this contract: every candidate has the
 * required date/provider/appointment tuple, while null context cannot pass. */
const frozenBackground = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const gateAt = frozenBackground.indexOf("if (!expectedContextShape(c, mode === 'execute')");
assert(gateAt > 0 && frozenBackground.slice(gateAt, gateAt + 300).includes("(!digits(c.appointmentId)"), 'frozen 3.0.61 pre-gate contract changed');
verified.candidates.forEach(c => { assert(c.visitDate && c.provider && /^\d+$/.test(c.appointmentId), 'candidate would fail frozen pre-gate'); });
const autoBindBody = source.slice(source.indexOf('function p1AutoBindEncounter'), source.indexOf('function openUnifiedConfirmation'));
assert(autoBindBody.includes('var probeSequence = Promise.resolve()') && !autoBindBody.includes('Promise.all('), 'provider probes are not strictly sequential');
assert(autoBindBody.includes('probeDeadlineAt = Date.now() + 60000'), 'provider probing has no total deadline');
assert(autoBindBody.includes('result.indeterminate === true') && autoBindBody.includes('result.determinate !== true'), 'timeout/transport uncertainty could be mistaken for a provider non-match');

/* A page-side timeout cannot cancel frozen background work. Prove a hanging
 * first provider aborts the sequence and never posts candidate two. */
(async function () {
  const posted = [], listeners = [];
  window.postMessage = msg => posted.push(msg);
  window.addEventListener = (type, fn) => { if (type === 'message') listeners.push(fn); };
  window.removeEventListener = (type, fn) => { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); };
  window.__mlsSI = { _lastResp: () => hangingSource, _lastPullResult: () => hangingPull, _lastRespAt: () => hangingAt };
  const hangingSource = receiptSource(), hangingPull = pullResult(), hangingAt = Date.now();
  context.setTimeout = (fn, ms) => { if (Number(ms) >= 20000) Promise.resolve().then(fn); return 1; };
  context.clearTimeout = () => {};
  document.body = null; // keep this test on the state machine, not the visual renderer
  window.__mlsWriteFlow.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: 'Reviewed note body.' }], visitTimestamp: Date.parse(DAY + 'T14:00:00Z') });
  for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve));
  const probes = posted.filter(msg => msg.type === 'mlsAppAthenaActionV2' && msg.mode === 'probe');
  assert.strictEqual(probes.length, 1, 'a timed-out first provider allowed a second background probe to overlap');
  assert.strictEqual(probes[0].expectedContext.provider, 'Header One, MD', 'the sequential lane did not start with the frozen first candidate');
  assert.strictEqual(window.__mlsP1AutoBind.state().last, null, 'a timeout adopted a provider or encounter');

  /* A completed context-unverified receipt is a real negative. Prove that one
   * such provider followed by exactly one verified success binds, while still
   * preserving the exact imported appointment and never retaining its token. */
  const completedSource = receiptSource(), completedPull = pullResult(), completedAt = Date.now();
  const completedPosts = [];
  window.__mlsSI = { _lastResp: () => completedSource, _lastPullResult: () => completedPull, _lastRespAt: () => completedAt };
  context.setTimeout = () => 1; // responses below are immediate; do not leave Node timers behind
  window.postMessage = msg => {
    completedPosts.push(msg);
    if (msg.type !== 'mlsAppAthenaActionV2' || msg.mode !== 'probe') return;
    const response = msg.expectedContext.provider === 'Header One, MD'
      ? { ok: false, blocked: true, reason: 'context-unverified' }
      : probe({ context: Object.assign({}, probe().context, { provider: msg.expectedContext.provider }) });
    Promise.resolve().then(() => listeners.slice().forEach(fn => fn({ data: {
      source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: msg.requestId, resp: response
    } })));
  };
  window.__mlsWriteFlow.openUnifiedConfirmation({ patient: PATIENT, sections: [{ key: 'note', text: 'Reviewed note body.' }], visitTimestamp: Date.parse(DAY + 'T14:00:00Z') });
  for (let i = 0; i < 18; i++) await new Promise(resolve => setImmediate(resolve));
  const completedProbes = completedPosts.filter(msg => msg.type === 'mlsAppAthenaActionV2' && msg.mode === 'probe');
  assert.deepStrictEqual(completedProbes.map(msg => msg.expectedContext.provider), ['Header One, MD', 'Header Two, MD'], 'definitive negative did not advance sequentially to the one successful provider');
  const adopted = api.currentState();
  assert(adopted && adopted.manifest && adopted.manifest.visit, 'successful exact bind did not keep a live review state');
  assert.strictEqual(adopted.manifest.visit.appointmentId, APPOINTMENT_ID, 'adoption changed the exact imported appointment');
  assert.strictEqual(adopted.manifest.visit.provider, 'Header Two, MD', 'adoption did not use the one verified provider');
  assert.strictEqual(adopted.manifest.visit.encounterId, '98765', 'adoption dropped the verified encounter');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(adopted, 'actionToken'), false, 'auto-bind retained an execution token');
  assert.strictEqual(window.__mlsP1AutoBind.state().last.appointmentId, APPOINTMENT_ID, 'successful exact adoption was not recorded');
  console.log('PASS p1 Athena note/save unlock: exact census + frozen 3.0.61 context gate, request/day/provider/identity validation, hanging-first abort, and all fail-closed vectors');
})().catch(error => { console.error(error); process.exitCode = 1; });
