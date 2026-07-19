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

function makeHarness(options = {}) {
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
    start() {
      this.startCalls += 1;
      if (options.immediateResult && typeof this.onresult === 'function') this.onresult(finalResult(options.immediateResult));
      if (options.immediateEnd && typeof this.onend === 'function') this.onend();
    }
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

  if (options.useAppSpeechHub) {
    const hubStart = app.indexOf('function mlsSpeechHub(){');
    const hubEnd = app.indexOf('\nconst SR=', hubStart);
    assert(hubStart >= 0 && hubEnd > hubStart, 'shared speech hub source could not be isolated');
    vm.runInNewContext(app.slice(hubStart, hubEnd) + '\nwindow.mlsSpeechHub=mlsSpeechHub;', context, { filename: 'mls-speech-hub.js' });
  }
  vm.runInNewContext(source, context, { filename: 'feat_mls_dictate_anywhere.js' });
  return { context, transcript, nodes, documentHandlers, recognizers, toasts };
}

function finalResult(text) {
  const item = [{ transcript: text }];
  item.isFinal = true;
  return { resultIndex: 0, results: [item] };
}

const h = makeHarness();
assert(h.context.__mlsDictateAnywhere && h.context.__mlsDictateAnywhere.version === 'da-1.1.1');
for (const id of ['transcript', 'noteBox', 'patientLabel', 'ez3Transcript', 'ez3Note', 'mlsProtoScratch', 'ez3flTranscript', 'ez3flNote']) {
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

/* ---- da-1.1.0: the easy-workflow chip drives dictation through toggleFor ----
 * Clicking the easy Dictate chip must start recognition bound to the exact
 * #ez3flTranscript node, insert final speech into it, let the lane's own input
 * listener synchronize the underlying #transcript, and reject stale results
 * after a visit change. */
const h2 = makeHarness();
const api2 = h2.context.__mlsDictateAnywhere;
assert.strictEqual(typeof api2.toggleFor, 'function', 'the direct toggleFor API is missing');

const topTx = makeNode('textarea', h2.nodes);
topTx.id = 'ez3flTranscript';
h2.nodes.ez3flTranscript = topTx;
/* the flow lane mirrors the top textarea into the canonical #transcript on
   every input event — model that exact listener */
topTx.dispatchEvent = function (ev) {
  if (ev && ev.type === 'input') h2.nodes.transcript.value = topTx.value;
};

/* an ineligible target is refused with a calm explanation */
const disabledBox = makeNode('textarea', h2.nodes);
disabledBox.disabled = true;
assert.strictEqual(api2.toggleFor(disabledBox), false, 'a disabled field must not accept dictation');
assert.strictEqual(h2.recognizers.length, 0, 'a refused toggle still created a recognizer');

assert.strictEqual(api2.toggleFor(topTx), true, 'toggleFor did not start listening on the easy transcript');
assert(h2.context.currentVisitAthenaBinding, 'the easy transcript was not visit-bound before the first spoken word');
assert.strictEqual(h2.recognizers.length, 1, 'toggleFor did not start exactly one recognition session');
const easyRecognition = h2.recognizers[0];
easyRecognition.onresult(finalResult('knee exam is stable today'));
assert.strictEqual(topTx.value, 'knee exam is stable today', 'final speech did not land in the easy transcript');
assert.strictEqual(h2.nodes.transcript.value, 'knee exam is stable today', 'the underlying transcript was not synchronized');

/* toggling again while listening stops the same session */
assert.strictEqual(api2.toggleFor(topTx), false, 'a second toggle did not stop dictation');
assert.strictEqual(api2.isListening(), false);
assert.strictEqual(easyRecognition.stopCalls, 1, 'the recognizer was not stopped');

/* a stale queued result after a visit change is rejected, not inserted */
assert.strictEqual(api2.toggleFor(topTx), true, 'restart for the stale-result scenario failed');
const staleRecognition = h2.recognizers[1];
h2.context.currentVisitAthenaBinding = { id: 'visit-z', patient: { patientId: 'z', name: 'Patient Z' } };
h2.context.currentVisitAthenaEpoch += 1;
staleRecognition.onresult(finalResult('should never land'));
assert.strictEqual(topTx.value, 'knee exam is stable today', 'a stale result crossed the visit change into the easy transcript');
assert.strictEqual(api2.isListening(), false, 'stale dictation did not stop after the visit change');

/* the easy chip keeps a compatibility fallback to the old dock */
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
assert(connect.includes('dictate.toggleFor(top)'), 'the easy Dictate chip does not call the direct API');
assert(connect.includes("else clickTopVoiceControl('mlsDaDock', 'Dictate')"), 'the old dock fallback was removed instead of kept as compatibility');

const newVisitSource = app.slice(app.indexOf('function newVisit(opts)'), app.indexOf('function noteRecordFromState(markSigned)'));
const switchSource = app.slice(app.indexOf('function _athenaHandleActivePatientChange(previousId,nextId)'), app.indexOf('function _athenaMarkBoundEdit(fieldId)'));
assert(newVisitSource.includes("_vh.claim('visit-reset')") && switchSource.includes("speech.claim('patient-switch')"), 'New Visit and patient switching do not synchronously stop the current speech owner');

(async function testMicHandoffRaces() {
  /* A final result and end are both allowed to arrive from start() immediately.
     The word must land once, and the UI must end stopped rather than being set
     back to a ghost listening state after onend cleanup. */
  const immediate = makeHarness({ immediateResult: 'immediate clinical phrase', immediateEnd: true });
  immediate.documentHandlers.focusin({ target: immediate.transcript });
  immediate.nodes.mlsDaChip.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(immediate.transcript.value, 'immediate clinical phrase', 'an immediate final dictation result was dropped during start');
  assert.strictEqual(immediate.context.__mlsDictateAnywhere.isListening(), false, 'immediate end left Dictate in a ghost listening state');
  assert.strictEqual(immediate.context.__mlsDictateAnywhere.starts, 1, 'the immediate recognition session was not counted exactly once');

  /* The real coordinator must hold the new Dictate recognizer until a prior
     microphone owner actually finishes its asynchronous stop. */
  const delayed = makeHarness({ useAppSpeechHub: true });
  const hub = delayed.context.mlsSpeechHub();
  let finishPrior = null;
  hub.register('prior-voice', 'Prior Voice', function () {
    return new Promise(resolve => { finishPrior = resolve; });
  });
  hub.claim('prior-voice');
  delayed.documentHandlers.focusin({ target: delayed.transcript });
  delayed.nodes.mlsDaChip.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(delayed.recognizers.length, 1, 'Dictate did not prepare its next recognition session');
  assert.strictEqual(delayed.recognizers[0].startCalls, 0, 'Dictate started before the prior microphone owner ended');
  assert.strictEqual(typeof finishPrior, 'function', 'the prior owner was not asked to stop');
  finishPrior();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(delayed.recognizers[0].startCalls, 1, 'Dictate did not start exactly once after the prior owner ended');

  /* If another owner wins while Dictate is still waiting, the prepared
     recognizer is canceled and must not wake up when the old barrier settles. */
  const superseded = makeHarness({ useAppSpeechHub: true });
  const supersededHub = superseded.context.mlsSpeechHub();
  let finishSupersededPrior = null;
  supersededHub.register('slow-prior', 'Slow Prior', function () {
    return new Promise(resolve => { finishSupersededPrior = resolve; });
  });
  supersededHub.claim('slow-prior');
  superseded.documentHandlers.focusin({ target: superseded.transcript });
  superseded.nodes.mlsDaChip.listeners.click({ preventDefault() {}, stopPropagation() {} });
  assert.strictEqual(superseded.recognizers[0].startCalls, 0, 'superseded Dictate started before the slow prior owner ended');
  supersededHub.register('new-winner', 'New Winner', function () {});
  supersededHub.claim('new-winner');
  assert.strictEqual(superseded.context.__mlsDictateAnywhere.isListening(), false, 'a superseded pending Dictate session stayed visibly active');
  finishSupersededPrior();
  await Promise.resolve();
  await Promise.resolve();
  assert.strictEqual(superseded.recognizers[0].startCalls, 0, 'a superseded pending Dictate session started after its old barrier settled');

  console.log('PASS dictate-anywhere binding: queued speech stays visit-owned; immediate events and delayed microphone handoffs are race-safe');
})().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
