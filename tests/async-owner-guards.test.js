'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');

function read(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

async function testAssistantPatientBuckets() {
  const source = read('feat_mls_assistant_exact.js');
  let activeId = 'A';
  const pendingFetches = [];
  const fetchBodies = [];
  const document = {
    readyState: 'loading',
    getElementById() { return null; },
    querySelector() { return null; },
    addEventListener() {},
    removeEventListener() {},
    createElement() { return {}; },
    head: { appendChild() {} },
    body: { appendChild() {} },
    documentElement: { appendChild() {} }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Array, RegExp,
    location: { pathname: '/ScribeFlow.staging.html' },
    document,
    setTimeout, clearTimeout,
    setInterval() { return 1; }, clearInterval() {},
    requestAnimationFrame(fn) { fn(); return 1; },
    localStorage: { getItem() { return null; }, setItem() {} },
    getComputedStyle() { return {}; },
    getActivePtId() { return activeId; },
    activePatient() { return { id: activeId, name: 'Patient ' + activeId }; },
    getPatients() { return [{ id: 'A', name: 'Patient A' }, { id: 'B', name: 'Patient B' }]; },
    backendMode() { return true; },
    bkToken() { return 'test-token'; },
    bkBase() { return 'https://example.invalid'; },
    copilotSnapshot() { return { patientId: activeId }; },
    fetch(_url, init) {
      fetchBodies.push(JSON.parse(init.body));
      return new Promise(resolve => pendingFetches.push(resolve));
    }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'feat_mls_assistant_exact.js' });

  const api = context.__mlsAsst;
  assert(api && api.installed, 'assistant did not install');
  const patientARequest = api.ask('question for A');
  activeId = 'B';
  const patientBRequest = api.ask('question for B');
  assert(patientARequest && patientBRequest, 'patient-owned requests did not both start');
  assert.strictEqual(fetchBodies[0].context.patientId, 'A', 'patient A request used another patient context');
  assert.strictEqual(fetchBodies[1].context.patientId, 'B', 'patient B request used another patient context');

  pendingFetches[1]({ json() { return Promise.resolve({ reply: 'reply B' }); } });
  await patientBRequest;
  pendingFetches[0]({ json() { return Promise.resolve({ reply: 'reply A' }); } });
  await patientARequest;

  const aText = api._historyFor('A').map(m => m.text).join('|');
  const bText = api._historyFor('B').map(m => m.text).join('|');
  const currentText = api._history().map(m => m.text).join('|');
  assert(aText.includes('question for A') && aText.includes('reply A'), 'patient A thread lost its own exchange');
  assert(!aText.includes('question for B') && !aText.includes('reply B'), 'patient B exchange leaked into patient A thread');
  assert(bText.includes('question for B') && bText.includes('reply B'), 'patient B thread lost its own exchange');
  assert(!bText.includes('question for A') && !bText.includes('reply A'), 'patient A exchange leaked into patient B thread');
  assert.strictEqual(currentText, bText, 'late patient A reply repainted the active patient B thread');
}

function makeStdlineHarness() {
  const source = read('feat_stdline_autoinsert.js');
  let activeId = 'A';
  let resolveAi;
  const bindingA = { id: 'visit-A' };
  const noteBox = {
    id: 'noteBox', nodeType: 1, value: 'A base note', offsetParent: {}, style: {},
    getClientRects() { return [{}]; }, dispatchEvent() {}
  };
  const document = {
    readyState: 'loading',
    getElementById(id) { return id === 'noteBox' ? noteBox : null; },
    querySelectorAll() { return []; },
    addEventListener() {}, removeEventListener() {},
    createElement() { return {}; },
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Array, RegExp,
    document,
    setTimeout() { return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    Event: function Event(type) { this.type = type; },
    currentVisitAthenaBinding: bindingA,
    currentVisitAthenaEpoch: 1,
    currentNoteId: null,
    getActivePtId() { return activeId; },
    _athenaGuardBoundEditor() { return true; },
    _athenaAsyncBindingStillSafe(candidate, _label, epoch) {
      return candidate === context.currentVisitAthenaBinding && Number(epoch) === Number(context.currentVisitAthenaEpoch);
    },
    aiCallRaw() { return new Promise(resolve => { resolveAi = resolve; }); },
    toast() {}
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'feat_stdline_autoinsert.js' });
  const item = {
    getAttribute() { return ''; },
    querySelector(selector) { return selector === '.txt' ? { textContent: 'STANDARD LINE' } : null; },
    setAttribute() {}
  };
  const button = {
    textContent: 'Add', __slaiPrev: null, __slaiBusy: false,
    classList: { toggle() {}, remove() {} }
  };
  return {
    context, noteBox, item, button, bindingA,
    setActive(id) { activeId = id; },
    resolveAi(value) { resolveAi(value); }
  };
}

async function testStdlineEditorOwnership() {
  const sameVisit = makeStdlineHarness();
  const sameVisitRun = sameVisit.context.__mlsStdLineAuto.coreAdd(sameVisit.item, sameVisit.button);
  sameVisit.noteBox.value = 'Doctor newer manual edit';
  sameVisit.resolveAi('A base note\nSTANDARD LINE');
  const sameVisitResult = await sameVisitRun;
  assert.strictEqual(sameVisitResult.reason, 'stale-editor', 'same-visit edit was not recognized as stale');
  assert.strictEqual(sameVisit.noteBox.value, 'Doctor newer manual edit', 'AI saved-line result overwrote a newer manual edit');

  const switched = makeStdlineHarness();
  const switchedRun = switched.context.__mlsStdLineAuto.coreAdd(switched.item, switched.button);
  switched.setActive('B');
  switched.context.currentVisitAthenaBinding = { id: 'visit-B' };
  switched.context.currentVisitAthenaEpoch = 2;
  /* Keep the same visible value so this scenario proves ownership, not merely
     the value fingerprint, blocks the delayed patient-A result. */
  switched.resolveAi('A base note\nSTANDARD LINE');
  const switchedResult = await switchedRun;
  assert.strictEqual(switchedResult.reason, 'stale-editor', 'patient switch was not recognized as stale');
  assert.strictEqual(switched.noteBox.value, 'A base note', 'patient A saved line landed in patient B');
}

function finalSpeech(text) {
  const row = [{ transcript: text }];
  row.isFinal = true;
  return { resultIndex: 0, results: [row] };
}

function multiFinalSpeech(texts) {
  return {
    resultIndex: 0,
    results: texts.map(text => {
      const row = [{ transcript: text }];
      row.isFinal = true;
      return row;
    })
  };
}

function testCopilotVoiceSessionsAndChain() {
  const source = read('feat_mls_copilot_voice_v2.js');
  const timers = [];
  const recognizers = [];
  const voiceState = { activeId: 'B', selectCalls: 0, recordCalls: 0 };
  class FakeRecognition {
    constructor() { recognizers.push(this); }
    start() {}
    stop() {}
  }
  const speechHub = {
    register() { return function unregister() {}; },
    claim() { return { ok: true }; },
    release() {}
  };
  const document = {
    readyState: 'loading',
    getElementById() { return null; },
    addEventListener() {}, removeEventListener() {},
    createElement() { return { style: {}, classList: { toggle() {} }, remove() {} }; },
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Array, RegExp,
    document,
    SpeechRecognition: FakeRecognition,
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {},
    __voiceState: voiceState,
    currentVisitAthenaBinding: null,
    currentVisitAthenaEpoch: 0,
    getActivePtId() { return this.__voiceState.activeId; },
    activePatient() { return this.getPatients().find(p => p.id === this.__voiceState.activeId) || null; },
    getPatients() { return [{ id: 'A', name: 'Alice Adams', dob: '01/01/1980' }, { id: 'B', name: 'Bob Brown', dob: '02/02/1980' }]; },
    selectPatient(id) { this.__voiceState.selectCalls += 1; this.__voiceState.activeId = id; },
    startCapture() { this.__voiceState.recordCalls += 1; },
    showView() {}, toast() {},
    mlsSpeechHub() { return speechHub; }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'feat_mls_copilot_voice_v2.js' });
  const api = context.__mlsCopilotVoiceV2;
  assert(api && api.installed, 'Copilot Voice V2 did not install');

  api.start();
  assert.strictEqual(recognizers.length, 1, 'voice recognizer did not start');
  const staleHandler = recognizers[0].onresult;
  api.stop();
  staleHandler(finalSpeech('open Alice Adams'));
  assert.strictEqual(voiceState.selectCalls, 0, 'queued recognition result opened a patient after voice was stopped');
  assert.strictEqual(voiceState.activeId, 'B', 'queued recognition result changed patient ownership after stop');

  /* If one browser event batches two finals, "stop listening" must invalidate
     the recognizer before a later command in that same event is processed. */
  api.start();
  const batchedRecognizer = recognizers[1];
  batchedRecognizer.onresult(multiFinalSpeech(['stop listening', 'open Alice Adams']));
  assert.strictEqual(voiceState.selectCalls, 0, 'a later final in the stop-listening event still opened a patient');
  assert.strictEqual(voiceState.activeId, 'B', 'batched speech crossed the recognition-session boundary');

  timers.length = 0;
  api._test.runVoiceChain(['open Alice Adams', 'record']);
  assert.strictEqual(voiceState.activeId, 'A', 'first chain leg did not open its requested patient');
  assert.strictEqual(timers.length, 1, 'voice chain did not queue its delayed second leg');
  voiceState.activeId = 'B';
  timers.shift()();
  assert.strictEqual(voiceState.recordCalls, 0, 'delayed voice-chain leg recorded the newly selected patient B');
}

function makeAddPatientHarness() {
  const source = read('feat_addpatient.js');
  let activeId = 'A';
  let resolveAi;
  let resolveSummaries;
  let currentModal;
  let currentOverlay;
  const timers = [];
  const selectionCalls = [];
  const savedVisits = [];
  const patients = [
    { id: 'A', name: 'Patient A', dob: '01/01/1980', visits: [] },
    { id: 'B', name: 'Patient B', dob: '02/02/1980', visits: [] }
  ];

  function makeModal(epoch, name) {
    const elements = {
      '#apName': { value: name || 'Patient A' },
      '#apDob': { value: name === 'Patient B' ? '02/02/1980' : '01/01/1980' },
      '#apMrn': { value: '' }, '#apSex': { value: '' }, '#apPhone': { value: '' },
      '#apSave': { disabled: false }, '#apStatus': { textContent: '' }
    };
    return {
      __mlsAddPatientEpoch: epoch,
      elements,
      querySelector(selector) { return elements[selector] || null; }
    };
  }

  function mount(modal) {
    currentModal = modal;
    currentOverlay = {
      __mlsAddPatientEpoch: modal.__mlsAddPatientEpoch,
      remove() {
        if (currentOverlay === this) {
          currentOverlay = null;
          currentModal = null;
        }
      }
    };
  }

  const document = {
    readyState: 'loading',
    getElementById(id) {
      if (id === 'mlsAddPtModal') return currentModal;
      if (id === 'mlsAddPtOv') return currentOverlay;
      return null;
    },
    querySelector() { return null; },
    addEventListener() {}, removeEventListener() {},
    createElement() { return {}; },
    head: { appendChild() {} }, body: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const visitModel = {
    _normDob(value) { return String(value || '').replace(/\D/g, ''); },
    addVisit(patientId, visit) {
      savedVisits.push({ patientId, visit });
      const patient = patients.find(p => p.id === patientId);
      if (patient) patient.visits.push(visit);
      return visit;
    },
    ensureSummaries() { return new Promise(resolve => { resolveSummaries = resolve; }); },
    getVisits(patient) { return patient.visits || []; }
  };
  const context = {
    console, Promise, Date, Math, JSON, Object, String, Array, RegExp,
    document,
    __mlsVisitModel: visitModel,
    setTimeout(fn) { timers.push(fn); return timers.length; }, clearTimeout() {},
    setInterval() { return 1; }, clearInterval() {},
    getActivePtId() { return activeId; },
    activePatient() { return patients.find(p => p.id === activeId) || null; },
    getPatients() { return patients; },
    upsertPatient(patient) {
      const index = patients.findIndex(p => p.id === patient.id);
      if (index >= 0) patients[index] = patient; else patients.push(patient);
    },
    setActivePtId(id) { selectionCalls.push({ via: 'setActivePtId', id }); activeId = id; },
    selectPatient(id) { selectionCalls.push({ via: 'selectPatient', id }); activeId = id; },
    renderPatients() {}, renderProfile() {},
    aiCallRaw() { return new Promise(resolve => { resolveAi = resolve; }); }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'feat_addpatient.js' });

  const firstModal = makeModal(0, 'Patient A');
  mount(firstModal);
  return {
    context, api: context.__mlsAddPatient, firstModal, savedVisits, selectionCalls, timers,
    makeModal, mount,
    setActive(id) { activeId = id; },
    active() { return activeId; },
    resolveAi(value) { resolveAi(value); },
    resolveSummaries() { resolveSummaries(); }
  };
}

async function testAddPatientAsyncOwnership() {
  const pasted = makeAddPatientHarness();
  const pasteUi = {
    textarea: { value: 'Patient A visit text' },
    status: { textContent: 'Structuring with AI...' },
    button: { disabled: true }
  };
  const lateStructure = pasted.api._structureAndQueue(
    pasted.firstModal, pasteUi.textarea.value, 0, 1, () => 1, pasteUi
  );
  pasted.api.close(0);
  const reopened = pasted.makeModal(1, 'Patient B');
  pasted.mount(reopened);
  pasted.resolveAi('{"date":"2026-07-14","type":"Follow-up","icd10":[],"cpt":[],"meds":[],"findings":"","scores":{},"plan":""}');
  const structureResult = await lateStructure;
  assert.strictEqual(structureResult.reason, 'stale-modal', 'late structured visit was not rejected after modal reopen');
  assert.strictEqual(pasted.api._pending().length, 0, 'patient A structured visit entered the reopened patient B modal');
  assert.strictEqual(pasteUi.textarea.value, 'Patient A visit text', 'stale structure completion still rewrote detached modal UI');

  const saved = makeAddPatientHarness();
  saved.api._pending().push({ date: '2026-07-14', type: 'Patient A follow-up' });
  const saveRun = saved.api._doSave(saved.firstModal, {
    name: 'Patient A', dob: '01/01/1980', mrn: '', sex: '', phone: ''
  });
  assert.strictEqual(saved.savedVisits.length, 1, 'captured visit was not saved before summary generation');
  assert.strictEqual(saved.savedVisits[0].patientId, 'A', 'captured visit was saved under the wrong patient ID');
  saved.setActive('B');
  saved.resolveSummaries();
  const saveResult = await saveRun;
  assert.strictEqual(saveResult.selectionPreserved, true, 'save completion did not report the moved patient context');
  assert.strictEqual(saved.active(), 'B', 'late patient A save completion yanked the UI back from patient B');
  assert.strictEqual(saved.selectionCalls.length, 0, 'late save invoked patient selection after the user moved to B');
  assert.strictEqual(saved.timers.length, 0, 'moved-context save scheduled a modal close from stale patient A work');

  const reopenedSave = makeAddPatientHarness();
  reopenedSave.api._pending().push({ date: '2026-07-14', type: 'Patient A visit' });
  const oldSaveRun = reopenedSave.api._doSave(reopenedSave.firstModal, {
    name: 'Patient A', dob: '01/01/1980', mrn: '', sex: '', phone: ''
  });
  reopenedSave.api.close(0);
  const newPatientModal = reopenedSave.makeModal(1, 'Patient B');
  reopenedSave.mount(newPatientModal);
  const patientBPending = { date: '2026-07-15', type: 'Patient B visit' };
  reopenedSave.api._pending().push(patientBPending);
  reopenedSave.resolveSummaries();
  const oldSaveResult = await oldSaveRun;
  assert.strictEqual(oldSaveResult.uiUpdated, false, 'old save completion updated a reopened modal');
  assert.strictEqual(reopenedSave.api._pending().length, 1, 'old save completion cleared the reopened modal queue');
  assert.strictEqual(reopenedSave.api._pending()[0], patientBPending, 'old save completion replaced the reopened modal queue');
  assert.strictEqual(reopenedSave.selectionCalls.length, 0, 'old save completion selected its patient after modal reopen');
}

async function main() {
  await testAssistantPatientBuckets();
  await testStdlineEditorOwnership();
  testCopilotVoiceSessionsAndChain();
  await testAddPatientAsyncOwnership();
  console.log('PASS async owner guards: assistant replies, saved-line AI, voice actions, and add-patient work stay with their originating patient/visit');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
