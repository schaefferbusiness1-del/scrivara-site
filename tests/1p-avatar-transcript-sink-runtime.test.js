'use strict';

/* Drives the real public recovered-capture writer with PHI-free synthetic
 * data. The live and recovery paths must then share the same verified sink. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_avatar.js'), 'utf8');
const END = SOURCE.lastIndexOf('})();');
assert(END > 0, 'avatar module wrapper not found');
const INSTRUMENTED = SOURCE.slice(0, END) + `
  window.__mlsAvatarSinkTest = {
    start: function (patientId) {
      kiosk.open = true; kiosk.completed = true; kiosk.consentAt = 500; kiosk.mic = true;
      kiosk.ext = String(patientId || ''); kiosk.sid = 'synthetic-live-session'; kiosk.intake = [];
      kiosk.ambFiled = false; kiosk.ambParts = []; kiosk.ambActions = [];
      return kioskAmbientStart();
    },
    setBody: function (body) { kiosk.ambParts = [String(body || '')]; return kioskAmbientSave(true); },
    file: function () { return kioskAmbientFile(); }
  };
` + SOURCE.slice(END);
const PATIENT_A = { id: 'synthetic-patient-a', patientId: 'synthetic-patient-a', name: 'Synthetic Patient A', dob: '01/02/1980', mrn: '100001' };
const PATIENT_B = { id: 'synthetic-patient-b', patientId: 'synthetic-patient-b', name: 'Synthetic Patient B', dob: '02/03/1981', mrn: '100002' };
const BODY = 'synthetic room capture proof phrase alpha beta gamma';
const VISIT_A = { historical: false, noteTimestamp: null, visitDate: '2026-08-17', provider: 'Synthetic Provider A', appointmentId: '700001', encounterId: '800001', encounterUrl: 'https://athena.example/encounter/800001' };
const VISIT_B = { historical: false, noteTimestamp: null, visitDate: '2026-08-17', provider: 'Synthetic Provider A', appointmentId: '700002', encounterId: '800002', encounterUrl: 'https://athena.example/encounter/800002' };
function visitReceipt(id, epoch, patient, visit) {
  return { v: 1, bindingId: id, epoch, patient: { patientId: patient.id, name: patient.name, dob: patient.dob, mrn: patient.mrn }, visit: Object.assign({}, visit) };
}

function element(id) {
  return {
    id, value: '', textContent: '', innerHTML: '', className: '', style: {}, type: '', title: '', disabled: false,
    children: [], parentNode: null, offsetParent: {},
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute() {}, getAttribute() { return null; }, addEventListener() {}, removeEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    focus() {}, dispatchEvent() { return true; }
  };
}

function makeHarness(options) {
  options = options || {};
  const mem = Object.create(null);
  const key = 'acct:mlsAvRoomCaptureV1:' + PATIENT_A.id;
  if (!options.noRecovery) mem[key] = JSON.stringify({
    v: 1, sid: 'synthetic-room-session', bound: PATIENT_A.id, start: 1000, savedAt: 2000,
    parts: [BODY], intake: [], actions: [], consentAt: 500, intakeFiled: true,
    visitBinding: visitReceipt('binding-a', 7, PATIENT_A, VISIT_A)
  });
  const localStorage = {
    get length() { return Object.keys(mem).length; },
    key(i) { return Object.keys(mem)[i] || null; },
    getItem(k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem(k, value) { mem[k] = String(value); },
    removeItem(k) { delete mem[k]; }
  };
  const mirror = element('ez3flTranscript');
  const canonical = element('transcript');
  mirror.value = options.mirrorBefore || '';
  canonical.value = options.canonicalBefore || '';
  let active = options.active || PATIENT_A;
  const nodes = { ez3flTranscript: mirror, transcript: canonical };
  if (options.dispatch === 'sync') {
    mirror.dispatchEvent = function () { canonical.value = mirror.value; return true; };
  } else if (options.dispatch === 'switch') {
    mirror.dispatchEvent = function () { canonical.value = mirror.value; active = PATIENT_B; return true; };
  } else if (options.dispatch === 'throw') {
    mirror.dispatchEvent = function () { throw new Error('synthetic mirror listener failure'); };
  }
  const document = {
    readyState: 'complete', hidden: false, activeElement: null,
    getElementById(id) { return nodes[id] || null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(tag) { return element(tag); }, createTextNode(text) { const node = element('#text'); node.textContent = String(text); return node; },
    addEventListener() {}, removeEventListener() {}, head: element('head'), body: element('body'), documentElement: element('html')
  };
  let binding = options.binding === 'other'
    ? { id: 'binding-other-patient', patient: PATIENT_B, visitContext: VISIT_B }
    : (options.binding === 'same-patient-other-visit'
      ? { id: 'binding-b', patient: PATIENT_A, visitContext: VISIT_B }
      : { id: 'binding-a', patient: PATIENT_A, visitContext: VISIT_A });
  let epoch = options.binding === 'same-patient-other-visit' ? 8 : 7;
  const window = {
    window: null, document, localStorage, location: { origin: 'https://mlsscribe.com', hostname: 'mlsscribe.com' },
    uns: name => 'acct:' + name, getActivePtId: () => active && active.id, activePatient: () => active,
    getPatients: () => [PATIENT_A, PATIENT_B], addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, toast() {},
    _athenaGuardBoundEditor: () => options.guard !== false,
    _athenaCurrentMatchesBound: candidate => !!candidate && candidate === binding && active && candidate.patient.id === active.id,
    SpeechRecognition: function () { this.start = function () {}; this.stop = function () {}; }
  };
  window.window = window;
  function Event(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
  function CustomEvent(type, init) { Event.call(this, type, init); this.detail = init && init.detail; }
  const context = vm.createContext({
    window, document, localStorage, location: window.location, console, Event, CustomEvent,
    currentVisitAthenaBinding: binding, currentVisitAthenaEpoch: epoch, currentVisitAthenaCompromised: options.compromised === true,
    _athenaGuardBoundEditor: window._athenaGuardBoundEditor, _athenaCurrentMatchesBound: window._athenaCurrentMatchesBound,
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, checkins: [] }) }),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    Date, Math, JSON, Promise, Array, Object, String, Number, RegExp, URL, Blob, Uint8Array, Buffer
  });
  vm.runInContext(INSTRUMENTED, context, { filename: '1p-feat_mls_avatar.js' });
  return {
    api: window.__mlsAvatar, mirror, canonical,
    backupPresent: () => Object.prototype.hasOwnProperty.call(mem, key),
    setActive(value) { active = value; },
    switchSamePatientVisit() {
      binding = { id: 'binding-b', patient: PATIENT_A, visitContext: VISIT_B }; epoch += 1;
      context.currentVisitAthenaBinding = binding; context.currentVisitAthenaEpoch = epoch;
    },
    startLive() { return window.__mlsAvatarSinkTest.start(PATIENT_A.id); },
    setLiveBody() { return window.__mlsAvatarSinkTest.setBody(BODY); },
    fileLive() { return window.__mlsAvatarSinkTest.file(); }
  };
}

function assertRefusedAndPreserved(h, label, mirrorBefore, canonicalBefore) {
  const result = h.api.fileRecoveredCapture();
  assert.strictEqual(result && result.ok, false, label + ': writer reported success');
  assert.strictEqual(h.backupPresent(), true, label + ': crash backup was discarded');
  assert.strictEqual(h.mirror.value, mirrorBefore || '', label + ': visible mirror was not rolled back');
  assert.strictEqual(h.canonical.value, canonicalBefore || '', label + ': canonical transcript changed without proof');
}

/* Dispatch success is not canonical-transcript success. */
assertRefusedAndPreserved(makeHarness(), 'missing mirror listener', '', '');
assertRefusedAndPreserved(makeHarness({ dispatch: 'throw' }), 'throwing mirror listener', '', '');

/* A transcript already bound to another patient must be rejected before any
 * mirror or canonical byte moves, even if the active patient matches capture. */
assertRefusedAndPreserved(makeHarness({ dispatch: 'sync', binding: 'other' }), 'other-patient visit binding', '', '');

/* Patient identity is not visit identity. A recovered appointment-A capture
 * must not file into appointment B for that same synthetic patient. */
assertRefusedAndPreserved(makeHarness({ dispatch: 'sync', binding: 'same-patient-other-visit' }), 'same-patient different recovered visit', '', '');

/* Switching patients synchronously during the mirror handoff invalidates the
 * commit and keeps the only durable copy. */
assertRefusedAndPreserved(makeHarness({ dispatch: 'switch' }), 'patient switched during commit', '', '');

/* A common body substring in the mirror is not an idempotency receipt. The
 * current implementation drops the backup on this false positive. */
{
  const prior = 'Unrelated note quoting: ' + BODY + ' (not the recovered block).';
  assertRefusedAndPreserved(makeHarness({ mirrorBefore: prior }), 'body-substring false positive', prior, '');
}

/* Exact success requires the full recovered block to reach the canonical
 * transcript under the same patient/binding, then and only then drops backup. */
{
  const h = makeHarness({ dispatch: 'sync', mirrorBefore: 'Existing synthetic transcript.', canonicalBefore: 'Existing synthetic transcript.' });
  const result = h.api.fileRecoveredCapture();
  assert.strictEqual(result && result.ok, true, 'exact canonical commit was refused');
  assert.strictEqual(h.backupPresent(), false, 'proved canonical commit kept a stale recovery backup');
  assert(h.canonical.value.includes(BODY), 'canonical transcript did not receive the exact recovered body');
  assert(h.canonical.value.includes('--- visit ---'), 'canonical transcript lacks the recovered visit provenance block');
  assert.strictEqual(h.canonical.value, h.mirror.value, 'mirror and canonical transcript disagree after exact commit');
}

/* The live microphone captures the immutable visit-A receipt before it opens.
 * A same-patient switch to visit B before End must refuse and keep the backup. */
{
  const h = makeHarness({ dispatch: 'sync', noRecovery: true });
  assert.strictEqual(h.startLive(), true, 'exact visit A could not start live capture');
  h.setLiveBody();
  assert.strictEqual(h.backupPresent(), true, 'live visit A was not backed up');
  h.switchSamePatientVisit();
  const result = h.fileLive();
  assert.strictEqual(result && result.ok, false, 'visit A live words filed into same-patient visit B');
  assert.strictEqual(h.backupPresent(), true, 'wrong-visit live refusal discarded the backup');
  assert.strictEqual(h.mirror.value, '', 'wrong-visit live refusal changed the mirror');
  assert.strictEqual(h.canonical.value, '', 'wrong-visit live refusal changed the canonical transcript');
}

/* The unchanged exact live binding remains the green path. */
{
  const h = makeHarness({ dispatch: 'sync', noRecovery: true });
  assert.strictEqual(h.startLive(), true, 'exact live binding did not start');
  h.setLiveBody();
  const result = h.fileLive();
  assert.strictEqual(result && result.ok, true, 'exact live binding was refused');
  assert.strictEqual(h.backupPresent(), false, 'exact live binding kept a stale backup');
  assert(h.canonical.value.includes(BODY), 'exact live binding did not reach canonical transcript');
}

/* Integration pin: live capture and recovered capture must use one proof
 * chokepoint, not two drifting implementations. */
{
  const helper = /function\s+(ambientCommitTranscript)\s*\(/.exec(SOURCE);
  assert(helper, 'missing shared ambientCommitTranscript proof chokepoint');
  function bodyOf(name, next) {
    const a = SOURCE.indexOf('function ' + name), b = SOURCE.indexOf('function ' + next, a + 1);
    assert(a >= 0 && b > a, 'cannot locate ' + name);
    return SOURCE.slice(a, b);
  }
  assert(bodyOf('kioskAmbientFile', 'ambientRecoverInfo').includes(helper[1] + '('), 'live capture bypasses verified transcript commit');
  assert(bodyOf('ambientRecoverFile', 'kioskAmbientStart').includes(helper[1] + '('), 'recovery bypasses verified transcript commit');
}

console.log('PASS 1p avatar transcript sink: canonical proof, exact patient/binding, rollback, recovery idempotency, and targeted backup lifecycle');
