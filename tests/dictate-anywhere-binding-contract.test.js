'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_dictate_anywhere.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

function makeNode(tag, nodes) {
  const label = { textContent: '' };
  return {
    tagName: String(tag || 'div').toUpperCase(),
    type: '', id: '', value: '', selectionStart: 0, selectionEnd: 0,
    disabled: false, readOnly: false, isContentEditable: false, offsetWidth: 80,
    style: {}, listeners: {}, connected: true,
    classList: { toggle() {} },
    setAttribute() {}, getAttribute() { return null; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    removeEventListener() {},
    appendChild(child) { if (child && child.id) nodes[child.id] = child; child.connected = true; return child; },
    remove() { this.connected = false; if (this.id) delete nodes[this.id]; },
    querySelector(selector) { return selector === '.da-t' ? label : null; },
    getBoundingClientRect() { return { top: 100, bottom: 180, right: 500, width: 400, height: 80 }; },
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; },
    dispatchEvent() {}, focus() {}
  };
}

function makeHarness() {
  const nodes = {};
  const documentHandlers = {};
  const recognizers = [];
  const body = makeNode('body', nodes);
  const head = makeNode('head', nodes);
  const documentElement = makeNode('html', nodes);
  const transcript = makeNode('textarea', nodes);
  transcript.id = 'transcript';
  transcript.value = '';
  nodes.transcript = transcript;

  class FakeRecognition {
    constructor() { this.startCalls = 0; this.stopCalls = 0; recognizers.push(this); }
    start() { this.startCalls += 1; }
    stop() { this.stopCalls += 1; if (typeof this.onend === 'function') this.onend(); }
  }

  const speechEntries = {};
  let speechOwner = '';
  const speechHub = {
    register(id, label, stop) { speechEntries[id] = { label, stop }; return () => { delete speechEntries[id]; }; },
    claim(id) {
      const previous = speechOwner && speechEntries[speechOwner] ? { id: speechOwner, label: speechEntries[speechOwner].label } : null;
      if (speechOwner && speechEntries[speechOwner] && speechEntries[speechOwner].stop) speechEntries[speechOwner].stop();
      speechOwner = id;
      return { ok: true, previous };
    },
    release(id) { if (speechOwner === id) speechOwner = ''; }
  };

  const toasts = [];
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Number, Array, RegExp,
    setTimeout(fn) { fn(); return 1; }, clearTimeout() {},
    Event: function Event(type) { this.type = type; },
    navigator: { language: 'en-US' },
    SpeechRecognition: FakeRecognition,
    currentVisitAthenaBinding: null,
    currentVisitAthenaEpoch: 0,
    mlsSpeechHub() { return speechHub; },
    toast(message, kind) { toasts.push({ message, kind }); },
    document: {
      body, head, documentElement, activeElement: transcript,
      createElement(tag) { return makeNode(tag, nodes); },
      getElementById(id) { return nodes[id] || null; },
      addEventListener(type, fn) { documentHandlers[type] = fn; },
      removeEventListener() {},
      contains(el) { return !!(el && el.connected !== false); },
      execCommand() { return true; }
    },
    addEventListener() {}, removeEventListener() {}
  };
  context.window = context;
  context._athenaBindingForCurrentVisit = () => ({ id: 'visit-a', patient: { patientId: 'a', name: 'Patient A' } });
  context._athenaSetVisitBinding = (binding) => { context.currentVisitAthenaBinding = binding; context.currentVisitAthenaEpoch += 1; return true; };
  context._athenaAsyncBindingStillSafe = (candidate, _label, epoch) => !!(
    candidate && context.currentVisitAthenaBinding && candidate.id === context.currentVisitAthenaBinding.id
    && Number(epoch) === Number(context.currentVisitAthenaEpoch)
  );

  vm.runInNewContext(source, context, { filename: 'feat_mls_dictate_anywhere.js' });
  return { context, transcript, nodes, documentHandlers, recognizers, toasts };
}

function finalResult(text) {
  const item = [{ transcript: text }];
  item.isFinal = true;
  return { resultIndex: 0, results: [item] };
}

const h = makeHarness();
assert(h.context.__mlsDictateAnywhere && h.context.__mlsDictateAnywhere.version === 'da-1.0.2');
for (const id of ['transcript', 'noteBox', 'patientLabel', 'ez3Transcript', 'ez3Note', 'mlsProtoScratch']) {
  assert(source.includes("id === '" + id + "'"), `clinical dictation alias ${id} is not visit-scoped`);
}
h.documentHandlers.focusin({ target: h.transcript });
const chip = h.nodes.mlsDaChip;
assert(chip && chip.listeners.click, 'dictation chip did not attach to the clinical field');
chip.listeners.click({ preventDefault() {}, stopPropagation() {} });
assert(h.context.currentVisitAthenaBinding, 'dictation did not bind the blank clinical editor before the first spoken word');
assert.strictEqual(h.recognizers.length, 1);
const patientARecognition = h.recognizers[0];

// A queued patient-A result must not land after the selected patient/visit changes.
h.context.currentVisitAthenaBinding = { id: 'visit-b', patient: { patientId: 'b', name: 'Patient B' } };
h.context.currentVisitAthenaEpoch += 1;
patientARecognition.onresult(finalResult('patient A private detail'));
assert.strictEqual(h.transcript.value, '', 'patient-A field dictation landed in patient B');
assert.strictEqual(patientARecognition.stopCalls, 1, 'stale field dictation did not stop its recognizer');
assert.strictEqual(h.context.__mlsDictateAnywhere.isListening(), false);
patientARecognition.onresult(finalResult('queued old result'));
assert.strictEqual(h.transcript.value, '', 'a queued old recognition event mutated the new visit');

// New Visit for the same patient changes only the epoch and is still a hard boundary.
h.context.currentVisitAthenaBinding = { id: 'visit-a-2', patient: { patientId: 'a', name: 'Patient A' } };
h.context.currentVisitAthenaEpoch += 1;
chip.listeners.click({ preventDefault() {}, stopPropagation() {} });
const samePatientRecognition = h.recognizers[1];
h.context.currentVisitAthenaEpoch += 1;
samePatientRecognition.onresult(finalResult('old same-patient visit detail'));
assert.strictEqual(h.transcript.value, '', 'field dictation crossed a same-patient New Visit boundary');
assert.strictEqual(h.context.__mlsDictateAnywhere.isListening(), false);

const newVisitSource = app.slice(app.indexOf('function newVisit(opts)'), app.indexOf('function noteRecordFromState(markSigned)'));
const switchSource = app.slice(app.indexOf('function _athenaHandleActivePatientChange(previousId,nextId)'), app.indexOf('function _athenaMarkBoundEdit(fieldId)'));
assert(newVisitSource.includes("_vh.claim('visit-reset')") && switchSource.includes("speech.claim('patient-switch')"), 'New Visit and patient switching do not synchronously stop the current speech owner');

console.log('PASS dictate-anywhere binding: queued speech cannot cross patient switches or same-patient New Visit');
