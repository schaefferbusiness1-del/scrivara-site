'use strict';

/* Drives the real public recovered-capture writer with PHI-free synthetic
 * data. The live and recovery paths must then share the same verified sink. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_avatar.js'), 'utf8');
const PATIENT_A = { id: 'synthetic-patient-a', patientId: 'synthetic-patient-a', name: 'Synthetic Patient A', dob: '01/02/1980', mrn: '100001' };
const PATIENT_B = { id: 'synthetic-patient-b', patientId: 'synthetic-patient-b', name: 'Synthetic Patient B', dob: '02/03/1981', mrn: '100002' };
const BODY = 'synthetic room capture proof phrase alpha beta gamma';

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
  mem[key] = JSON.stringify({
    v: 1, sid: 'synthetic-room-session', bound: PATIENT_A.id, start: 1000, savedAt: 2000,
    parts: [BODY], intake: [], actions: [], consentAt: 500, intakeFiled: true
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
  const binding = options.binding === 'other'
    ? { id: 'binding-b', patient: PATIENT_B }
    : { id: 'binding-a', patient: PATIENT_A };
  const window = {
    window: null, document, localStorage, location: { origin: 'https://mlsscribe.com', hostname: 'mlsscribe.com' },
    uns: name => 'acct:' + name, getActivePtId: () => active && active.id, activePatient: () => active,
    getPatients: () => [PATIENT_A, PATIENT_B], addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, toast() {},
    _athenaGuardBoundEditor: () => options.guard !== false,
    _athenaCurrentMatchesBound: candidate => !!candidate && candidate.id === binding.id && active && candidate.patient.id === active.id
  };
  window.window = window;
  function Event(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
  function CustomEvent(type, init) { Event.call(this, type, init); this.detail = init && init.detail; }
  const context = vm.createContext({
    window, document, localStorage, location: window.location, console, Event, CustomEvent,
    currentVisitAthenaBinding: binding, currentVisitAthenaEpoch: 7, currentVisitAthenaCompromised: options.compromised === true,
    _athenaGuardBoundEditor: window._athenaGuardBoundEditor, _athenaCurrentMatchesBound: window._athenaCurrentMatchesBound,
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, checkins: [] }) }),
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    Date, Math, JSON, Promise, Array, Object, String, Number, RegExp, URL, Blob, Uint8Array, Buffer
  });
  vm.runInContext(SOURCE, context, { filename: '1p-feat_mls_avatar.js' });
  return {
    api: window.__mlsAvatar, mirror, canonical,
    backupPresent: () => Object.prototype.hasOwnProperty.call(mem, key),
    setActive(value) { active = value; }
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
