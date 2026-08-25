'use strict';

/* Real shipped-path proof for the visible Easy "Generate one note" control.
 * Fixtures are synthetic and contain no patient identity.  The test executes
 * the production handler plus the production generation engine, rather than
 * asserting only source strings. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shell = fs.readFileSync(path.join(root, '1pScribeFlow.html'), 'utf8');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `missing shipped span ${startMarker}`);
  return source.slice(start, end);
}

function functionExpressionAfter(source, marker) {
  const at = source.indexOf(marker);
  assert(at >= 0, `missing visible handler ${marker}`);
  const start = source.indexOf('function () {', at);
  const open = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i += 1; continue; }
    if (ch === '/' && next === '*') { block = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('visible handler is unbalanced');
}

const engine = between(
  shell,
  'var _mlsGenerationSequence=0;',
  '/* =========================================================\n   AUTO-POPULATE EXTRAS'
);
const draftable = between(
  shell,
  'function _mlsTranscriptHasDraftableTodayEvidence(text)',
  '\nasync function callOpenAI('
);
const visibleHandler = functionExpressionAfter(connect, "on('ez3Gen', function () {");

const canonical = [
  'HPI:',
  'The patient reports feeling fine today.',
  'ROS:',
  "Not documented in today's transcript.",
  'EXAM:',
  "Not documented in today's transcript.",
  'ASSESSMENT:',
  "Not documented in today's transcript.",
  'PLAN:',
  "Not documented in today's transcript."
].join('\n');

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function eventElement(initialValue) {
  const listeners = new Map();
  return {
    value: initialValue || '', disabled: false, innerHTML: '', textContent: '', style: {},
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) listeners.get(type).delete(listener);
    },
    fire(type) {
      for (const listener of Array.from(listeners.get(type) || [])) listener({ type, target: this });
    },
    focus() {}
  };
}

function generatedResult() {
  return {
    note: canonical,
    athena_note: canonical,
    insuranceNote: '',
    coding: { em: '', icd: [], cpt: [] },
    emr: {},
    patient_summary: ''
  };
}

function harness(options) {
  options = options || {};
  const transcript = eventElement(options.transcript || 'the patient is fine');
  const genBtn = eventElement('');
  const optCard = eventElement('');
  const noteBox = eventElement('');
  const genError = eventElement('');
  const state = {
    aiCalls: 0,
    aiSignals: [],
    tuning: [],
    lifecycle: [],
    toasts: [],
    templateSignals: [],
    templateReports: [],
    templateLifecycleSnapshots: [],
    pending: null,
    hiddenClicks: 0
  };
  const visit = Object.assign({
    identityVerified: true,
    identityBinding: 'synthetic-patient',
    fullDetail: true,
    bodyComplete: true,
    indexOnly: false,
    raw: 'Verified prior visit body used as background only.'
  }, options.visit || {});
  const patient = { id: 'synthetic-patient', visits: options.history === false ? [] : [visit] };
  const listeners = new Map();
  class CustomEventMock {
    constructor(type, init) { this.type = type; this.detail = init && init.detail; }
  }
  const context = {
    console, Promise, String, Number, Object, Array, RegExp, JSON, Math, Date,
    AbortController, setTimeout, clearTimeout, CustomEvent: CustomEventMock,
    document: {
      getElementById(id) {
        return { transcript, genBtn, optCard, noteBox, genError, noteGenError: genError }[id] || eventElement('');
      }
    },
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
    },
    removeEventListener(type, listener) {
      if (listeners.has(type)) listeners.get(type).delete(listener);
    },
    dispatchEvent(event) {
      if (/^mls:generation-(?:started|refused|settled|complete)$/.test(event.type)) {
        state.lifecycle.push({ type: event.type, detail: Object.assign({}, event.detail) });
      }
      for (const listener of Array.from(listeners.get(event.type) || [])) listener(event);
      return true;
    },
    __MLS_GENERATION_TIMEOUTS: Object.assign({ main: 120, template: 30, setup: 30 }, options.timeouts || {}),
    __mlsVisitModel: { getVisits() { return patient.visits; } },
    activePatient() { return patient; },
    getGenSectionProfileOverrides() { return { families: { hpi: { profileId: 'synthetic-hpi' } } }; },
    _mlsExactScheduledClinicalAction() { return true; },
    _athenaGuardBoundEditor() { return true; },
    _athenaBindingForCurrentVisit() { return context.currentVisitAthenaBinding; },
    _mlsAthenaGenerationSourceFingerprint() { return 'source-fingerprint'; },
    _athenaEditorFingerprint() { return 'editor-fingerprint'; },
    _athenaAsyncBindingStillSafe() { return true; },
    _mlsValidateStructuredNoteResult() {},
    _mlsValidateAthenaNote(text) { return { text: String(text) }; },
    _reorderNoteForStyle(text) { return String(text); },
    _athenaSetVisitBinding() { return true; },
    _mlsSetAthenaNote(text) { context.currentAthenaNote = String(text); },
    getGenStyle() { return 'soap'; },
    getDefaultFormat() { return 'soap'; },
    getKey() { return 'synthetic-key'; },
    hasAI() { return true; },
    refreshGenSectionProfiles() {},
    autoFillVisitComment() {},
    applyVisitCommentToNote() {},
    syncFormatToggle() {},
    showNote(text) { noteBox.value = String(text); },
    renderCoding() {}, populateEMR() {}, autoPopulateExtras() {},
    maybeAutoProcNote() {}, maybeCapturePainScore() {}, initCollapsibleExtras() {},
    _markVisitDirty() {},
    reportTemplateApplication(result) { state.templateReports.push(result); },
    maybeApplyTemplate(visitText, binding, epoch, templateOptions) {
      state.templateSignals.push(templateOptions && templateOptions.signal);
      state.templateLifecycleSnapshots.push(state.lifecycle.map(event => event.type));
      if (typeof options.templateImpl === 'function') return options.templateImpl(visitText, binding, epoch, templateOptions);
      return options.templatePromise || Promise.resolve({ applied: false, reason: 'templates-off' });
    },
    callOpenAI(text, key, callOptions) {
      state.aiCalls += 1;
      state.aiSignals.push(callOptions && callOptions.signal);
      state.tuning.push(context._mlsGenerationDraftTuning(callOptions && callOptions.evidence));
      if (Array.isArray(options.aiQueue) && options.aiQueue.length) return options.aiQueue.shift();
      return options.aiPromise || Promise.resolve(generatedResult());
    },
    toast(message, type) { state.toasts.push({ message: String(message), type: String(type || '') }); },
    friendlyError(error) { return String(error && error.message || error || 'Generation failed.'); },
    openSettings() {},
    offlineExampleNote() { return canonical; }, offlineExampleInsuranceNote() { return ''; },
    offlineExampleCoding() { return {}; }, offlineExampleEMR() { return {}; },
    EXAMPLE: 'offline example fixture',
    currentVisitAthenaBinding: { id: 'binding-synthetic' },
    currentVisitAthenaEpoch: 4,
    currentFormat: 'soap', currentOpt: null, currentSoap: '', currentInsurance: '',
    currentCoding: null, currentNoteProvenance: 'typed', lastAIDraft: '', lastEMR: {},
    currentAthenaNote: '', currentAthenaNoteSourceFingerprint: '', pendingCodingReview: null,
    currentHandout: '',
    S: { appt: { id: 'appointment-synthetic' }, phase: 'idle', genClickedAt: 0, signedAt: 0, lastWarn: '' },
    $: id => id === 'transcript' ? transcript : null,
    requireExactScheduledBinding() { return true; },
    genBtnResolve() { return genBtn; },
    render() {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(
    draftable + '\n' + engine + '\nthis.generateNote=generateNote;this._mlsGenerationDraftTuning=_mlsGenerationDraftTuning;',
    context,
    { filename: 'shipped-generation-engine.js' }
  );
  vm.runInContext('this.visibleGenerate=' + visibleHandler + ';', context, { filename: 'shipped-visible-generate.js' });
  genBtn.click = function clickHiddenGenerate() {
    state.hiddenClicks += 1;
    state.pending = context.generateNote();
  };
  return { context, state, transcript, genBtn, noteBox };
}

function events(state, suffix) {
  return state.lifecycle.filter((event) => event.type === `mls:generation-${suffix}`);
}

(async function run() {
  const sparseWithHistory = harness({ transcript: 'the patient is fine' });
  sparseWithHistory.context.visibleGenerate();
  assert.strictEqual(await sparseWithHistory.state.pending, true, 'visible sparse/history click did not generate');
  assert.strictEqual(sparseWithHistory.state.hiddenClicks, 1, 'visible control did not dispatch exactly one engine click');
  assert.strictEqual(events(sparseWithHistory.state, 'started').length, 1, 'successful click did not have exactly one truthful start');
  assert.strictEqual(events(sparseWithHistory.state, 'refused').length, 0, 'verified-history click was falsely refused');
  assert.strictEqual(events(sparseWithHistory.state, 'settled').length, 1, 'successful click did not settle exactly once');
  assert.strictEqual(events(sparseWithHistory.state, 'settled')[0].detail.status, 'success');
  assert.strictEqual(sparseWithHistory.genBtn.disabled, false, 'Generate remained disabled after success');
  assert.strictEqual(sparseWithHistory.noteBox.value, canonical, 'canonical five-section draft was not rendered');
  assert(sparseWithHistory.state.tuning[0].instructions.includes('CURRENT VISIT EVIDENCE IS SPARSE'), 'hosted tuning did not receive the sparse/current-visit rule');
  assert(sparseWithHistory.state.tuning[0].instructions.includes('ROS, EXAM, ASSESSMENT, and PLAN'), 'sparse rule does not keep unknown sections explicit');
  assert.strictEqual(sparseWithHistory.state.aiSignals[0].aborted, false, 'successful main signal was aborted');
  assert(sparseWithHistory.state.templateLifecycleSnapshots[0].includes('mls:generation-settled'), 'optional template started before the main draft settled');

  const sparseLiveTypo = harness({ transcript: 'the patient is idne' });
  sparseLiveTypo.context.visibleGenerate();
  assert.strictEqual(await sparseLiveTypo.state.pending, true, 'live four-word status typo with verified history did not generate');
  assert.strictEqual(sparseLiveTypo.state.aiCalls, 1, 'live four-word status typo did not reach one bounded model request');
  assert.strictEqual(events(sparseLiveTypo.state, 'started').length, 1, 'live four-word status typo did not own one truthful start');
  assert.strictEqual(events(sparseLiveTypo.state, 'settled')[0].detail.status, 'success', 'live four-word status typo did not settle successfully');

  const noHistory = harness({ transcript: 'the patient is fine', history: false });
  noHistory.context.visibleGenerate();
  assert.strictEqual(await noHistory.state.pending, false, 'sparse/no-history click did not refuse');
  assert.strictEqual(events(noHistory.state, 'started').length, 0, 'refused click falsely emitted started');
  assert.strictEqual(events(noHistory.state, 'refused').length, 1, 'refused click did not emit its exact refusal');
  assert.strictEqual(events(noHistory.state, 'settled').length, 1, 'refused click did not settle exactly once');
  assert.strictEqual(noHistory.state.aiCalls, 0, 'sparse/no-history refusal contacted the model');
  assert(events(noHistory.state, 'refused')[0].detail.message.includes('Add one specific detail from today'), 'refusal was not actionable');
  assert(!events(noHistory.state, 'refused')[0].detail.message.includes('connection'), 'refusal fell back to a fake connection diagnosis');
  assert.strictEqual(noHistory.genBtn.disabled, false, 'refusal left Generate disabled');

  const fillerWithHistory = harness({ transcript: 'please make patient note' });
  fillerWithHistory.context.visibleGenerate();
  assert.strictEqual(await fillerWithHistory.state.pending, false, 'arbitrary four-word filler borrowed prior history');
  assert.strictEqual(fillerWithHistory.state.aiCalls, 0, 'non-clinical filler reached the model');
  assert.strictEqual(events(fillerWithHistory.state, 'started').length, 0, 'non-clinical filler falsely started generation');

  for (const adversarialText of ['please make good note', 'patient note is good']) {
    const adversarial = harness({ transcript: adversarialText });
    adversarial.context.visibleGenerate();
    assert.strictEqual(await adversarial.state.pending, false, `non-status prompt borrowed history: ${adversarialText}`);
    assert.strictEqual(adversarial.state.aiCalls, 0, `non-status prompt reached the model: ${adversarialText}`);
    assert.strictEqual(events(adversarial.state, 'started').length, 0, `non-status prompt emitted started: ${adversarialText}`);
  }

  const contradictedHistory = harness({ transcript: 'the patient is fine', visit: { patientId: 'different-synthetic-patient' } });
  contradictedHistory.context.visibleGenerate();
  assert.strictEqual(await contradictedHistory.state.pending, false, 'history owned by a different patient supported generation');
  assert.strictEqual(contradictedHistory.state.aiCalls, 0, 'contradictory explicit patient owner reached the model');
  assert.strictEqual(events(contradictedHistory.state, 'started').length, 0, 'contradictory explicit patient owner falsely started generation');

  const hung = harness({ aiPromise: new Promise(() => {}), timeouts: { main: 20 } });
  hung.context.visibleGenerate();
  assert.strictEqual(await hung.state.pending, false, 'never-resolving request did not time out');
  assert.strictEqual(events(hung.state, 'started').length, 1, 'hung request did not truthfully start');
  assert.strictEqual(events(hung.state, 'settled').length, 1, 'hung request did not settle exactly once');
  assert.strictEqual(events(hung.state, 'settled')[0].detail.code, 'generation-timeout');
  assert.strictEqual(hung.state.aiSignals[0].aborted, true, 'main deadline did not abort transport');
  assert.strictEqual(hung.genBtn.disabled, false, 'main timeout left Generate disabled');

  const templateHang = harness({ templatePromise: new Promise(() => {}), timeouts: { template: 20 } });
  templateHang.context.visibleGenerate();
  assert.strictEqual(await templateHang.state.pending, true, 'template timeout discarded the successful original generation');
  assert.strictEqual(templateHang.noteBox.value, canonical, 'template timeout replaced the original draft');
  assert.strictEqual(templateHang.genBtn.disabled, false, 'optional template kept Generate disabled after main success');
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.strictEqual(templateHang.state.templateSignals[0].aborted, true, 'template deadline did not abort the optional pass');
  assert.strictEqual(events(templateHang.state, 'settled')[0].detail.status, 'success', 'optional template timeout changed generation success');
  assert.strictEqual(templateHang.context.__mlsLastTemplateGenerationReceipt.reason, 'template-timeout', 'template timeout did not leave an honest optional receipt');
  assert.strictEqual(templateHang.state.templateReports.length, 0, 'expected optional timeout emitted a contradictory formatting failure');

  const lateTemplate = deferred();
  const editedDuringTemplate = harness({ templatePromise: lateTemplate.promise, timeouts: { template: 1000 } });
  editedDuringTemplate.context.visibleGenerate();
  assert.strictEqual(await editedDuringTemplate.state.pending, true, 'main draft did not settle before optional formatting');
  assert.strictEqual(editedDuringTemplate.noteBox.value, canonical, 'main canonical draft was not retained');
  assert.strictEqual(events(editedDuringTemplate.state, 'settled').length, 1, 'main draft did not have one terminal lifecycle');
  assert.strictEqual(events(editedDuringTemplate.state, 'settled')[0].detail.status, 'success', 'main draft did not own successful settlement');
  editedDuringTemplate.transcript.value = 'the current visit source changed';
  editedDuringTemplate.transcript.fire('input');
  lateTemplate.resolve({ applied: true, templateName: 'Late stale template' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(editedDuringTemplate.state.templateSignals[0].aborted, true, 'source edit did not abort optional formatting');
  assert.strictEqual(editedDuringTemplate.noteBox.value, canonical, 'source edit erased or replaced the retained main draft');
  assert.strictEqual(events(editedDuringTemplate.state, 'settled').length, 1, 'optional cancellation emitted a second generation settlement');
  assert.strictEqual(editedDuringTemplate.context.__mlsLastTemplateGenerationReceipt.reason, 'source-changed', 'source edit did not leave an honest optional cancellation receipt');
  assert.strictEqual(editedDuringTemplate.state.templateReports.length, 0, 'source cancellation emitted a contradictory template report');
  assert.strictEqual(editedDuringTemplate.state.toasts.length, 1, 'source cancellation emitted both success and error toasts');
  assert.strictEqual(editedDuringTemplate.state.toasts[0].type, 'ok', 'retained main draft did not keep its success toast');

  const changed = harness({ aiPromise: new Promise(() => {}), timeouts: { main: 1000 } });
  changed.context.visibleGenerate();
  changed.transcript.value = 'different current visit source';
  changed.transcript.fire('input');
  assert.strictEqual(await changed.state.pending, false, 'source change did not abort generation');
  assert.strictEqual(events(changed.state, 'settled')[0].detail.code, 'source-changed');
  assert.strictEqual(changed.state.aiSignals[0].aborted, true, 'source change did not abort transport');
  assert.strictEqual(changed.noteBox.value, '', 'source-stale result mutated the note');
  assert.strictEqual(changed.genBtn.disabled, false, 'source abort left Generate disabled');

  const old = deferred();
  const superseded = harness({ aiQueue: [old.promise, Promise.resolve(generatedResult())], timeouts: { main: 1000 } });
  const first = superseded.context.generateNote();
  const second = superseded.context.generateNote();
  assert.strictEqual(await first, false, 'superseded request reported success');
  assert.strictEqual(await second, true, 'newer request did not complete');
  assert.strictEqual(events(superseded.state, 'started').length, 2, 'overlapping runs did not each receive one start');
  assert.strictEqual(events(superseded.state, 'settled').length, 2, 'overlapping runs did not each settle once');
  assert(events(superseded.state, 'settled').some((event) => event.detail.code === 'superseded'), 'older run was not identified as superseded');
  old.resolve({ note: 'LATE WRONG NOTE', athena_note: canonical, insuranceNote: '', coding: {}, emr: {} });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.strictEqual(superseded.noteBox.value, canonical, 'late superseded result overwrote the newer draft');
  assert.strictEqual(superseded.genBtn.disabled, false, 'newest overlapping run did not release Generate');

  console.log('PASS generate note lifecycle: grounded sparse/history generation, explicit-owner veto, bounded nonblocking templates, source abort, and superseding ownership');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
