'use strict';

/* Runs the real review-card handoff with PHI-free synthetic identities. A
 * nonempty old note is not proof that this transcript produced a draft. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, '1p-feat_mls_avatar.js'), 'utf8');
const END = SOURCE.lastIndexOf('})();');
assert(END > 0, 'avatar module wrapper not found');
const INSTRUMENTED = SOURCE.slice(0, END) + `
  window.__mlsAvatarReviewTest = {
    show: kioskReviewShow,
    setVisit: function (patientId) {
      kiosk.ambBound = String(patientId || '');
      kiosk.ambStart = Date.now() - 60000;
      kiosk.ambParts = ['synthetic transcript words'];
      kiosk.ambActions = [];
    }
  };
` + SOURCE.slice(END);

const PATIENT_A = { id: 'synthetic-patient-a', patientId: 'synthetic-patient-a', name: 'Synthetic Patient A', dob: '01/02/1980', mrn: '100001' };
const PATIENT_B = { id: 'synthetic-patient-b', patientId: 'synthetic-patient-b', name: 'Synthetic Patient B', dob: '02/03/1981', mrn: '100002' };

function element(id, className) {
  const listeners = Object.create(null);
  return {
    id: id || '', value: '', textContent: '', innerHTML: '', className: className || '', style: {}, type: '', title: '', disabled: false,
    children: [], parentNode: null, offsetParent: {},
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; return child; },
    remove() { if (this.parentNode) this.parentNode.removeChild(this); },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); }, removeEventListener() {},
    dispatchEvent(event) { (listeners[event && event.type] || []).slice().forEach(fn => fn.call(this, event)); return true; },
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }, focus() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } }
  };
}

function findClass(root, token) {
  if (!root) return null;
  if (String(root.className || '').split(/\s+/).includes(token)) return root;
  for (const child of root.children || []) {
    const found = findClass(child, token);
    if (found) return found;
  }
  return null;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function makeHarness(options) {
  options = options || {};
  const timers = [];
  const pane = element('mlsAvKioskReview');
  const noteBox = element('noteBox');
  noteBox.value = options.noteBefore || '';
  const nodes = { mlsAvKioskReview: pane, noteBox };
  const made = [];
  let active = PATIENT_A;
  let binding = { id: 'synthetic-binding-a', patient: PATIENT_A, visitContext: { appointmentId: '700001', visitDate: '08/17/2026', provider: 'Synthetic Provider A' } };
  let epoch = 11;
  let compromised = false;
  const localStorage = { length: 0, key() { return null; }, getItem() { return null; }, setItem() {}, removeItem() {} };
  const document = {
    readyState: 'complete', hidden: false, activeElement: null,
    getElementById(id) { return nodes[id] || null; }, querySelector() { return null; }, querySelectorAll() { return []; },
    createElement(tag) { const node = element('', ''); node.tagName = String(tag).toUpperCase(); made.push(node); return node; },
    createTextNode(text) { const node = element('#text'); node.textContent = String(text); return node; },
    addEventListener() {}, removeEventListener() {}, head: element('head'), body: element('body'), documentElement: element('html')
  };
  const window = {
    window: null, document, localStorage, location: { origin: 'https://mlsscribe.com', hostname: 'mlsscribe.com' },
    uns: name => 'acct:' + name, getActivePtId: () => active && active.id, activePatient: () => active,
    getPatients: () => [PATIENT_A, PATIENT_B], addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, toast() {},
    generateNote: options.generateNote || (() => Promise.resolve(false))
  };
  window.window = window;
  function currentMatches(candidate) {
    return !!candidate && candidate === binding && !compromised && active && candidate.patient && candidate.patient.id === active.id;
  }
  function asyncStillSafe(candidate, label, expectedEpoch) {
    return !!candidate && candidate === binding && Number(expectedEpoch) === Number(epoch) && currentMatches(candidate);
  }
  function Event(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
  function CustomEvent(type, init) { Event.call(this, type, init); this.detail = init && init.detail; }
  const context = vm.createContext({
    window, document, localStorage, location: window.location, console, Event, CustomEvent,
    currentVisitAthenaBinding: binding, currentVisitAthenaEpoch: epoch, currentVisitAthenaCompromised: compromised,
    _athenaGuardBoundEditor: () => currentMatches(binding), _athenaCurrentMatchesBound: currentMatches, _athenaAsyncBindingStillSafe: asyncStillSafe,
    fetch: () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, checkins: [] }) }),
    setTimeout(fn, delay) { timers.push({ fn, delay: Number(delay) || 0 }); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {}, Date, Math, JSON, Promise, Array, Object, String, Number, RegExp, URL, Blob, Uint8Array, Buffer
  });
  vm.runInContext(INSTRUMENTED, context, { filename: '1p-feat_mls_avatar.js' });
  timers.length = 0; // discard boot-only work; this test starts at the review handoff
  window.__mlsAvatarReviewTest.setVisit(PATIENT_A.id);
  return {
    window, context, pane, noteBox, timers,
    setGenerate(fn) { window.generateNote = fn; },
    switchPatient() { active = PATIENT_B; },
    switchBinding() {
      binding = { id: 'synthetic-binding-b', patient: PATIENT_B, visitContext: { appointmentId: '700002', visitDate: '08/17/2026', provider: 'Synthetic Provider B' } };
      epoch += 1;
      context.currentVisitAthenaBinding = binding; context.currentVisitAthenaEpoch = epoch;
    },
    compromise() { compromised = true; context.currentVisitAthenaCompromised = true; },
    show() { window.__mlsAvatarReviewTest.show({ filed: true, chars: 41 }); },
    runNext(delay) {
      const at = timers.findIndex(t => delay == null || t.delay === delay);
      assert(at >= 0, 'expected review timer was not scheduled');
      const task = timers.splice(at, 1)[0]; task.fn();
    },
    line() { return findClass(pane, 'mlsAvRevNote'); }
  };
}

async function flush() { await Promise.resolve(); await Promise.resolve(); }
function assertBad(h, label) {
  const line = h.line();
  assert(line, label + ': note readiness line missing');
  assert(String(line.className).split(/\s+/).includes('bad'), label + ': review claimed a ready note: ' + line.textContent);
  assert(!/Draft note ready/.test(String(line.textContent)), label + ': false ready copy remained visible');
}
function assertGood(h, label) {
  const line = h.line();
  assert(line, label + ': note readiness line missing');
  assert(String(line.className).split(/\s+/).includes('ok'), label + ': exact generated note was not accepted: ' + line.textContent);
  assert(/Draft note ready/.test(String(line.textContent)), label + ': ready receipt copy missing');
}

(async function run() {
  /* The exact generateNote receipt is authoritative. Old content cannot turn a
   * false/undefined result into success. */
  {
    const h = makeHarness({ noteBefore: 'Old synthetic note belonging to an earlier visit.' });
    h.setGenerate(() => Promise.resolve(false)); h.show(); h.runNext(0); await flush();
    assertBad(h, 'resolved false with pre-existing note');
  }
  {
    const h = makeHarness({ noteBefore: 'Old synthetic note belonging to an earlier visit.' });
    h.setGenerate(() => Promise.resolve(undefined)); h.show(); h.runNext(0); await flush();
    assertBad(h, 'resolved undefined with pre-existing note');
  }

  /* A successful drafter result is discarded if patient or binding changes
   * while it is in flight. */
  {
    const gate = deferred(), h = makeHarness();
    h.setGenerate(() => gate.promise); h.show(); h.runNext(0);
    h.noteBox.value = 'New synthetic note'; h.switchPatient(); gate.resolve(true); await flush();
    assertBad(h, 'active patient switched during drafting');
  }
  {
    const gate = deferred(), h = makeHarness();
    h.setGenerate(() => gate.promise); h.show(); h.runNext(0);
    h.noteBox.value = 'New synthetic note'; h.switchBinding(); gate.resolve(true); await flush();
    assertBad(h, 'visit binding/epoch switched during drafting');
  }
  {
    const gate = deferred(), h = makeHarness();
    h.setGenerate(() => gate.promise); h.show(); h.runNext(0);
    h.noteBox.value = 'New synthetic note'; h.compromise(); gate.resolve(true); await flush();
    assertBad(h, 'visit binding became compromised during drafting');
  }

  /* Rejection and a bounded hang are honest failures, while exact true under
   * the unchanged patient/binding with a nonempty canonical note is ready. */
  {
    const h = makeHarness();
    h.setGenerate(() => Promise.reject(new Error('synthetic drafter refusal'))); h.show(); h.runNext(0); await flush();
    assertBad(h, 'drafter rejected');
  }
  {
    const h = makeHarness();
    h.setGenerate(() => new Promise(() => {})); h.show(); h.runNext(0);
    for (let i = 0; i < 90; i += 1) h.runNext(500);
    assertBad(h, 'drafter timed out');
  }
  {
    const h = makeHarness();
    h.setGenerate(() => { h.noteBox.value = 'New synthetic note for the exact visit.'; return Promise.resolve(true); });
    h.show(); h.runNext(0); await flush(); assertGood(h, 'exact same-visit draft');
  }

  console.log('PASS 1p avatar note readiness: exact generate receipt, canonical note, stable patient/binding/epoch, rejection, and bounded timeout');
})().catch(error => { console.error(error && error.stack || error); process.exitCode = 1; });
