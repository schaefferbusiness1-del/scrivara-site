'use strict';

/* gkey-1.0.0 / gsrc-1.1.0 / gsx-1.1.0 / gsup-1.0.0 (measured 2026-09-02 10:xx)
 *
 * FOUR MEASURED DEFECTS ON THE ONE POST-RESPONSE GUARD, each proved here by
 * executing the SHIPPED generation engine (lifted, never reimplemented) and
 * each paired with the negative control that would catch a weakening:
 *
 *  gkey  #patientLabel sat inside the generation source fingerprint, and the
 *        "up now" schedule fill repaints it mid-generation through
 *        _calLoadNextUp() -> _heroSyncName() with a bare `pl.value=n` and NO
 *        input event. A cosmetic label repaint therefore destroyed a FINISHED
 *        note as 'source-changed' and accused the doctor of a patient mix-up.
 *        NEGATIVE CONTROLS: activePatientId, context, transcript and visit
 *        identity changes must ALL still abort.
 *
 *  gsrc  Nothing recorded WHICH comparand discarded the run, so a field report
 *        could not be attributed without re-measuring live.
 *        NEGATIVE CONTROLS: the four-way disjunction still aborts on an
 *        editor-only change (the doctor's typed text survives), and the
 *        receipt carries key NAMES only - never a value (PHI control).
 *
 *  gsx   The calm-vs-alarming sentence was chosen from an input-event flag, so
 *        any writer that assigns #transcript.value directly (live dictation,
 *        an unsaved-draft restore, the per-patient stash) was reported as a
 *        patient mix-up.
 *        NEGATIVE CONTROLS: an input-event edit keeps the gsx-1.0.0 sentence;
 *        a format change and an identity change both keep the alarming one.
 *
 *  gsup  generateNote() aborted the previous run on its FIRST line, before any
 *        gate, so a press that was then REFUSED silently killed a healthy
 *        in-flight generation ('superseded' raises no toast and no line).
 *        NEGATIVE CONTROL: a press that really does start a replacement must
 *        behave IDENTICALLY before and after.
 *
 * Every "before" build below is produced by reverting the shipped bytes in
 * memory, so the positive cases are real before/after measurements rather than
 * assertions about the fix's own vocabulary.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
const SHELL = fs.readFileSync(path.join(root, shells[0]), 'utf8');
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }

/* ------------------------------------------------------- shipped-span lifts */
function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `missing shipped span ${startMarker.slice(0, 60)}`);
  return source.slice(start, end);
}
function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function marker: ' + marker);
  const open = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) { if (escaped) { escaped = false; continue; } if (ch === '\\') { escaped = true; continue; } if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unbalanced function: ' + marker);
}

/* --------------------------------------------- in-memory reverts ("before") */
function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  assert.strictEqual(count, 1, `revert ${label}: anchor occurs ${count} times (need exactly 1)`);
  return source.replace(from, () => to);
}
function dropSpan(source, startMarker, endMarker, label) {
  const start = source.indexOf(startMarker);
  assert(start >= 0, `revert ${label}: missing span start`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert(end > start, `revert ${label}: missing span end`);
  assert.strictEqual(source.split(startMarker).length - 1, 1, `revert ${label}: span start is not unique`);
  return source.slice(0, start) + source.slice(end);
}
const REVERT = {
  /* gkey: put #patientLabel back inside the generation-time comparison. */
  gkey: s => replaceOnce(s,
    '||_mlsAthenaGenerationKey(generationBinding)!==generationKey){',
    '||_mlsAthenaGenerationSourceFingerprint(generationBinding)!==generationSourceFingerprint){', 'gkey'),
  /* gsup: put the pre-gate supersede abort back at the head of generateNote. */
  gsup: s => replaceOnce(s,
    "  const transcriptEl=document.getElementById('transcript');",
    "  _mlsAbortActiveGeneration('superseded');\n  const transcriptEl=document.getElementById('transcript');", 'gsup'),
  /* gsx: remove the transcript-only arm so both routes share one sentence. */
  gsx: s => dropSpan(s,
    "      }else if(run&&run.abortDiff==='transcript-only'){",
    '      }else{', 'gsx'),
  /* gsrc: neutralise the discard receipt everywhere at once - the four call
     sites are deliberately layered, so removing only one of them would still
     leave a receipt and prove nothing. */
  gsrc: s => replaceOnce(s,
    "function _mlsNoteGenerationDiscard(runId,field){try{window.__mlsLastGenerationDiscard={runId:Number(runId||0)||0,field:String(field||'unknown'),at:Date.now()};}catch(e){}return String(field||'unknown');}",
    "function _mlsNoteGenerationDiscard(runId,field){return String(field||'unknown');}", 'gsrc')
};
function shellWith(reverts) {
  return (reverts || []).reduce((source, name) => REVERT[name](source), SHELL);
}

/* --------------------------------------------------------------- fixtures */
const TRANSCRIPT = 'Adam reports right knee pain for three weeks, worse on stairs, no injury today.';
const CONTEXT_TEXT = 'Prior right knee arthroscopy, 2019.';
const PATIENT_NAME = 'Adam Testpatient';
const OTHER_NAME = 'Betty Otherpatient';
const canonicalNote = [
  'HPI:', 'The patient reports feeling fine today.',
  'ROS:', "Not documented in today's transcript.",
  'EXAM:', "Not documented in today's transcript.",
  'ASSESSMENT:', "Not documented in today's transcript.",
  'PLAN:', "Not documented in today's transcript."
].join('\n');
function generatedResult() {
  return { note: canonicalNote, athena_note: canonicalNote, insuranceNote: '', coding: { em: '', icd: [], cpt: [] }, emr: {}, patient_summary: '' };
}
function deferred() { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; }
function eventElement(initialValue) {
  const listeners = new Map();
  return {
    value: initialValue || '', disabled: false, innerHTML: '', textContent: '', style: {}, children: [1],
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { if (listeners.has(type)) listeners.get(type).delete(listener); },
    fire(type) { for (const listener of Array.from(listeners.get(type) || [])) listener({ type, target: this }); },
    focus() {}
  };
}

/* ---------------------------------------------------------------- harness */
function harness(shellSource, options) {
  options = options || {};
  /* The REAL shipped source-state, editor fingerprint, hero name sync,
     evidence gate and generation engine - no reimplementation. */
  const athenaState = between(shellSource, 'function _mlsAthenaSourceState(binding,includeDisplay){', '\nfunction _mlsAthenaNoteWithVisitComment(');
  const editorFingerprint = extractFunction(shellSource, 'function _athenaEditorFingerprint()');
  const heroSyncName = extractFunction(shellSource, 'function _heroSyncName()');
  const draftable = between(shellSource, 'function _mlsTranscriptHasDraftableTodayEvidence(text)', '\nasync function callOpenAI(');
  const engine = between(shellSource, 'var _mlsGenerationSequence=0;', '/* =========================================================\n   AUTO-POPULATE EXTRAS');

  const el = {
    transcript: eventElement(options.transcript || TRANSCRIPT),
    contextBox: eventElement(CONTEXT_TEXT),
    visitComment: eventElement(''),
    patientLabel: eventElement(PATIENT_NAME),
    heroPtName: eventElement(PATIENT_NAME),
    heroPtList: eventElement(''),
    noteBox: eventElement(''),
    genBtn: eventElement(''),
    optCard: eventElement(''),
    genError: eventElement(''),
    noteGenError: eventElement(''),
    toast: eventElement('')
  };
  const state = { toasts: [], lifecycle: [], aiCalls: 0, pending: null };
  const visit = { identityVerified: true, identityBinding: 'adam-1', fullDetail: true, bodyComplete: true, indexOnly: false, raw: 'Verified prior visit body used as background only.' };
  const patient = { id: 'adam-1', visits: [visit] };
  const listeners = new Map();
  class CustomEventMock { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  const context = {
    console, Promise, String, Number, Object, Array, RegExp, JSON, Math, Date,
    AbortController, setTimeout, clearTimeout, CustomEvent: CustomEventMock,
    document: { getElementById(id) { return el[id] || eventElement(''); } },
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { if (listeners.has(type)) listeners.get(type).delete(listener); },
    dispatchEvent(event) {
      if (/^mls:generation-(?:started|refused|settled|complete)$/.test(event.type)) state.lifecycle.push({ type: event.type, detail: Object.assign({}, event.detail) });
      for (const listener of Array.from(listeners.get(event.type) || [])) listener(event);
      return true;
    },
    __MLS_GENERATION_TIMEOUTS: Object.assign({ main: 4000, template: 4000, setup: 4000 }, options.timeouts || {}),
    __mlsVisitModel: { getVisits() { return patient.visits; } },
    activePatient() { return patient; },
    __activeId: 'adam-1',
    getActivePtId() { return context.__activeId; },
    getGenSectionProfileOverrides() { return { families: { hpi: { profileId: 'synthetic-hpi' } } }; },
    _mlsExactScheduledClinicalAction() { return true; },
    _athenaGuardBoundEditor() { return true; },
    _athenaBindingForCurrentVisit() { return context.currentVisitAthenaBinding; },
    _athenaAsyncBindingStillSafe() { return true; },
    _mlsValidateStructuredNoteResult() {},
    _mlsValidateAthenaNote(text) { return { text: String(text) }; },
    _reorderNoteForStyle(text) { return String(text); },
    _athenaSetVisitBinding() { return true; },
    _mlsSetAthenaNote(text) { context.currentAthenaNote = String(text); },
    _mlsMarkAthenaNoteStale() {},
    _mlsAthenaClearReopenAnchor() {},
    _heroPopulateList() {},
    getGenStyle() { return 'soap'; },
    getDefaultFormat() { return 'soap'; },
    getKey() { return 'synthetic-key'; },
    hasAI() { return true; },
    refreshGenSectionProfiles() {},
    autoFillVisitComment() {},
    applyVisitCommentToNote() {},
    syncFormatToggle() {},
    showNote(text) { el.noteBox.value = String(text); },
    renderCoding() {}, populateEMR() {}, autoPopulateExtras() {},
    maybeAutoProcNote() {}, maybeCapturePainScore() {}, initCollapsibleExtras() {},
    _markVisitDirty() {},
    reportTemplateApplication() {},
    maybeApplyTemplate() { return Promise.resolve({ applied: false, reason: 'templates-off' }); },
    callOpenAI() {
      state.aiCalls += 1;
      if (Array.isArray(options.aiQueue) && options.aiQueue.length) return options.aiQueue.shift();
      return options.aiPromise || Promise.resolve(generatedResult());
    },
    toast(message, type) { state.toasts.push({ message: String(message), type: String(type || '') }); },
    friendlyError(error) { return String((error && error.message) || error || 'Generation failed.'); },
    openSettings() {},
    offlineExampleNote() { return canonicalNote; }, offlineExampleInsuranceNote() { return ''; },
    offlineExampleCoding() { return {}; }, offlineExampleEMR() { return {}; },
    EXAMPLE: 'offline example fixture',
    currentVisitAthenaBinding: {
      patient: { patientId: 'adam-1', name: PATIENT_NAME, dob: '1980-02-02', mrn: 'MRN-1' },
      visitContext: { visitDate: '2026-09-02', provider: 'Dr Synthetic', appointmentId: 'appt-1', encounterId: 'enc-1', encounterUrl: '' }
    },
    currentVisitAthenaEpoch: 4,
    currentFormat: 'soap', currentOpt: null, currentSoap: '', currentInsurance: '',
    currentCoding: null, currentOrders: [], currentNoteProvenance: 'typed', lastAIDraft: '', lastEMR: {},
    currentAthenaNote: '', currentAthenaNoteSourceFingerprint: '', currentAthenaNoteProvenance: 'none', pendingCodingReview: null,
    currentHandout: '',
    S: { appt: { id: 'appt-1' }, phase: 'idle', genClickedAt: 0, signedAt: 0, lastWarn: '' },
    $: id => el[id] || null,
    requireExactScheduledBinding() { return true; },
    genBtnResolve() { return el.genBtn; },
    render() {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext([athenaState, editorFingerprint, heroSyncName, draftable, engine,
    'this.generateNote=generateNote;this._heroSyncName=_heroSyncName;this._mlsAthenaGenerationKey=_mlsAthenaGenerationKey;this._mlsAthenaGenerationSourceFingerprint=_mlsAthenaGenerationSourceFingerprint;'
  ].join('\n'), context, { filename: 'shipped-generation-engine.js' });
  return { context, state, el };
}
function settled(state) { return state.lifecycle.filter(e => e.type === 'mls:generation-settled'); }
function refused(state) { return state.lifecycle.filter(e => e.type === 'mls:generation-refused'); }
function started(state) { return state.lifecycle.filter(e => e.type === 'mls:generation-started'); }
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/* Start a run, mutate mid-flight, then let the model answer. */
async function midFlight(shellSource, mutate) {
  const ai = deferred();
  const h = harness(shellSource, { aiPromise: ai.promise });
  const pending = h.context.generateNote();
  await tick(); await tick();
  mutate(h);
  ai.resolve(generatedResult());
  const result = await pending;
  return { h, result };
}

(async function run() {
  /* =================================================================== gkey
     POSITIVE: the "up now" schedule fill repaints #patientLabel through the
     REAL _heroSyncName(). Before the fix that destroyed the finished note. */
  const repaint = h => { h.el.heroPtName.value = OTHER_NAME; h.context._heroSyncName(); };

  const beforeRepaint = await midFlight(shellWith(['gkey']), repaint);
  eq(beforeRepaint.result, false, 'PRE-FIX control: a cosmetic patientLabel repaint did NOT discard the note - the defect is unreproducible, so this proof is void');
  eq(settled(beforeRepaint.h.state)[0].detail.code, 'source-changed', 'PRE-FIX control: the discard did not use the source-changed code');
  eq(beforeRepaint.h.el.noteBox.value, '', 'PRE-FIX control: the discarded run rendered a note anyway');

  const afterRepaint = await midFlight(SHELL, repaint);
  eq(afterRepaint.result, true, 'a cosmetic patientLabel repaint still discards the finished note');
  eq(settled(afterRepaint.h.state)[0].detail.status, 'success', 'the surviving run did not settle successfully');
  eq(afterRepaint.h.el.noteBox.value, canonicalNote, 'the surviving run did not render its canonical draft');
  eq(afterRepaint.h.el.patientLabel.value, OTHER_NAME, 'the repaint under test never actually happened');

  /* NEGATIVE CONTROL 1a: the same repaint with the SAME name must not abort in
     either build - no behaviour delta on a no-op repaint. */
  for (const [label, source] of [['pre-fix', shellWith(['gkey'])], ['shipped', SHELL]]) {
    const sameName = await midFlight(source, h => { h.el.heroPtName.value = PATIENT_NAME; h.context._heroSyncName(); });
    eq(sameName.result, true, `${label}: a same-name repaint discarded the note`);
    eq(sameName.h.el.noteBox.value, canonicalNote, `${label}: a same-name repaint lost the draft`);
  }

  /* NEGATIVE CONTROLS 1b-1e, mandatory - the fix is void without them. Every
     real source change must STILL abort on the shipped bytes. */
  const mustStillAbort = [
    ['activePatientId', h => { h.context.__activeId = 'betty-2'; }, 'activePatientId'],
    ['context box', h => { h.el.contextBox.value = 'Different clinical context entirely.'; }, 'context'],
    ['transcript (no input event)', h => { h.el.transcript.value = TRANSCRIPT + ' Also reports a cough.'; }, 'transcript'],
    ['visit comment', h => { h.el.visitComment.value = 'Comment added mid-run.'; }, 'visitComment'],
    /* mutated IN PLACE: the guard re-reads the binding it captured at request
       time, so rebinding the variable would prove nothing. */
    ['bound patient identity', h => { h.context.currentVisitAthenaBinding.patient.name = OTHER_NAME; h.context.currentVisitAthenaBinding.patient.mrn = 'MRN-2'; }, 'patient'],
    ['bound visit context', h => { h.context.currentVisitAthenaBinding.visitContext.appointmentId = 'appt-99'; }, 'visit'],
    ['note editor', h => { h.el.noteBox.value = 'The doctor typed this while waiting.'; }, 'editor'],
    ['note format', h => { h.context.currentFormat = 'insurance'; }, 'format'],
    ['coding optimizer', h => { h.context.currentOpt = { em: '99213' }; }, 'coding-optimizer']
  ];
  for (const [label, mutate, expectedField] of mustStillAbort) {
    const probe = await midFlight(SHELL, mutate);
    eq(probe.result, false, `NEGATIVE CONTROL: a ${label} change no longer aborts - the guard was weakened`);
    eq(settled(probe.h.state)[0].detail.code, 'source-changed', `NEGATIVE CONTROL: the ${label} abort lost its pinned code`);
    /* ================================================================ gsrc
       ...and every abort now NAMES the comparand that caused it. */
    eq(probe.h.context.__mlsLastGenerationDiscard.field, expectedField, `the ${label} discard was attributed to the wrong comparand`);
    eq(settled(probe.h.state)[0].detail.discardField, expectedField, `the ${label} settlement receipt lost its discard field`);
  }

  /* NEGATIVE CONTROL: the editor-only abort must leave the DOCTOR'S text in the
     box - the model draft must not land. */
  const editorOnly = await midFlight(SHELL, h => { h.el.noteBox.value = 'The doctor typed this while waiting.'; });
  eq(editorOnly.h.el.noteBox.value, 'The doctor typed this while waiting.', 'the discarded model draft overwrote the doctor typed text');

  /* gsrc PHI CONTROL: the receipt is key NAMES only. */
  const phi = await midFlight(SHELL, h => { h.el.contextBox.value = 'SECRET CLINICAL DETAIL 4242'; });
  const receipt = JSON.stringify(phi.h.context.__mlsLastGenerationDiscard);
  for (const secret of ['SECRET CLINICAL DETAIL 4242', TRANSCRIPT, CONTEXT_TEXT, PATIENT_NAME, OTHER_NAME, 'MRN-1', '1980-02-02']) {
    ok(receipt.indexOf(secret) < 0, 'the discard receipt leaked content: ' + secret.slice(0, 24));
  }
  eq(Object.keys(phi.h.context.__mlsLastGenerationDiscard).sort().join(','), 'at,field,runId', 'the discard receipt grew a field that is not a key name');
  ok(Array.isArray(phi.h.context.__mlsLastGenerationAbortFields) && phi.h.context.__mlsLastGenerationAbortFields.indexOf('context') >= 0,
    'the diverged-fields probe did not name the context box');
  ok(JSON.stringify(phi.h.context.__mlsLastGenerationAbortFields).indexOf('SECRET CLINICAL DETAIL 4242') < 0,
    'the diverged-fields probe leaked content');

  /* gsrc NEGATIVE CONTROL: with the receipt reverted there is nothing to read,
     which is exactly the field-undiagnosable state that was measured. */
  const noReceipt = await midFlight(shellWith(['gsrc']), h => { h.el.contextBox.value = 'anything'; });
  eq(noReceipt.result, false, 'PRE-FIX control: the context change did not abort');
  eq(typeof noReceipt.h.context.__mlsLastGenerationDiscard, 'undefined', 'PRE-FIX control: a discard receipt existed before the fix');

  /* ==================================================================== gsx
     POSITIVE: a transcript rewritten with a bare .value= (live dictation, a
     draft restore, a stash restore) is reported calmly. */
  const silentEdit = h => { h.el.transcript.value = TRANSCRIPT + ' Also reports a cough.'; };
  const beforeSentence = await midFlight(shellWith(['gsx']), silentEdit);
  eq(beforeSentence.h.state.toasts[0].type, 'err', 'PRE-FIX control: the silent transcript rewrite was not reported as an error');
  ok(beforeSentence.h.state.toasts[0].message.startsWith('The patient or visit source changed'),
    'PRE-FIX control: the silent transcript rewrite did not produce the patient-mix-up sentence');

  const afterSentence = await midFlight(SHELL, silentEdit);
  eq(afterSentence.h.state.toasts[0].type, '', 'a silent transcript rewrite still raises the assertive error skin');
  ok(afterSentence.h.state.toasts[0].message.startsWith('The visit transcript changed while MLS was generating'),
    'a silent transcript rewrite is still reported as a patient or visit change');
  eq(settled(afterSentence.h.state)[0].detail.code, 'source-changed', 'the calm sentence changed the pinned abort code');
  eq(afterSentence.h.el.noteGenError.textContent, afterSentence.h.state.toasts[0].message, 'the calm sentence did not reach the persistent inline line');

  /* gsx NEGATIVE CONTROL 1: a transcript edit WITH an input event keeps the
     existing gsx-1.0.0 sentence, unchanged. */
  const typedEdit = await (async () => {
    const ai = deferred();
    const h = harness(SHELL, { aiPromise: ai.promise });
    const pending = h.context.generateNote();
    await tick(); await tick();
    h.el.transcript.value = TRANSCRIPT + ' typed by the doctor';
    h.el.transcript.fire('input');
    ai.resolve(generatedResult());
    return { h, result: await pending };
  })();
  eq(typedEdit.result, false, 'a typed transcript edit no longer aborts');
  eq(typedEdit.h.state.toasts[0].type, '', 'the typed-edit sentence lost its neutral skin');
  ok(typedEdit.h.state.toasts[0].message.startsWith('You edited the transcript'), 'the gsx-1.0.0 typed-edit sentence changed');
  eq(settled(typedEdit.h.state)[0].detail.code, 'source-changed', 'the typed-edit abort lost its pinned code');
  eq(typedEdit.h.context.__mlsLastGenerationDiscard.field, 'transcript-edit', 'the typed-edit discard was not attributed');

  /* gsx NEGATIVE CONTROLS 2 and 3: a non-transcript change keeps the alarming
     sentence, and an unchanged run still succeeds. */
  for (const [label, mutate] of [['format', h => { h.context.currentFormat = 'insurance'; }],
                                 ['identity', h => { h.context.__activeId = 'betty-2'; }]]) {
    const alarming = await midFlight(SHELL, mutate);
    eq(alarming.h.state.toasts[0].type, 'err', `the ${label} change lost the assertive error skin`);
    ok(alarming.h.state.toasts[0].message.startsWith('The patient or visit source changed'),
      `the ${label} change no longer says the patient or visit source changed`);
  }
  const untouched = await midFlight(SHELL, () => {});
  eq(untouched.result, true, 'an untouched run no longer succeeds');
  eq(settled(untouched.h.state)[0].detail.code, 'generated', 'an untouched run lost its generated code');
  eq(untouched.h.state.toasts[0].type, 'ok', 'an untouched run lost its success toast');

  /* =================================================================== gsup
     POSITIVE: a press that is REFUSED must not kill the healthy run. */
  async function refusedSecondPress(shellSource) {
    const h = harness(shellSource, { aiPromise: new Promise(() => {}), timeouts: { main: 5000 } });
    const first = h.context.generateNote();
    let firstSettledValue = 'STILL-IN-FLIGHT';
    first.then(value => { firstSettledValue = value; });
    await tick(); await tick();
    h.context._mlsExactScheduledClinicalAction = () => false;
    await h.context.generateNote();
    await new Promise(resolve => setTimeout(resolve, 60));
    return { h, firstSettledValue };
  }
  const beforeRefusal = await refusedSecondPress(shellWith(['gsup']));
  eq(beforeRefusal.firstSettledValue, false, 'PRE-FIX control: the refused press did not kill the in-flight run');
  eq(settled(beforeRefusal.h.state).map(e => e.detail.status + '/' + e.detail.code).sort().join(' '),
    'aborted/superseded refused/visit-action-blocked', 'PRE-FIX control: the silent supersede did not happen');
  eq(settled(beforeRefusal.h.state).filter(e => e.detail.code === 'superseded')[0].detail.message, '',
    'PRE-FIX control: the supersede was not silent');

  const afterRefusal = await refusedSecondPress(SHELL);
  eq(afterRefusal.firstSettledValue, 'STILL-IN-FLIGHT', 'a refused press still kills the healthy in-flight generation');
  eq(settled(afterRefusal.h.state).map(e => e.detail.status + '/' + e.detail.code).join(' '),
    'refused/visit-action-blocked', 'the refused press emitted something other than its own refusal');
  eq(afterRefusal.h.el.genBtn.disabled, true, 'the surviving run released the Generate button');
  eq(afterRefusal.h.el.noteBox.value, '', 'the refused press rendered a note');

  /* gsup NEGATIVE CONTROL: a press that really DOES start a replacement must
     behave identically before and after. If this differs, the deletion was
     mis-applied. */
  async function realSupersede(shellSource) {
    const old = deferred();
    const h = harness(shellSource, { aiQueue: [old.promise, Promise.resolve(generatedResult())], timeouts: { main: 5000 } });
    const first = h.context.generateNote();
    const second = h.context.generateNote();
    const firstValue = await first;
    const secondValue = await second;
    old.resolve({ note: 'LATE WRONG NOTE', athena_note: canonicalNote, insuranceNote: '', coding: {}, emr: {} });
    await tick();
    return {
      firstValue, secondValue,
      started: started(h.state).length,
      refused: refused(h.state).length,
      settled: settled(h.state).map(e => e.detail.status + '/' + e.detail.code).sort().join(' '),
      note: h.el.noteBox.value,
      disabled: h.el.genBtn.disabled
    };
  }
  const supersedeBefore = await realSupersede(shellWith(['gsup']));
  const supersedeAfter = await realSupersede(SHELL);
  eq(JSON.stringify(supersedeAfter), JSON.stringify(supersedeBefore),
    'NEGATIVE CONTROL: a genuine supersede behaves differently after the deletion - the deletion was mis-applied');
  eq(supersedeAfter.started, 2, 'a genuine supersede did not start two runs');
  eq(supersedeAfter.refused, 0, 'a genuine supersede refused a press');
  eq(supersedeAfter.settled, 'aborted/superseded success/generated', 'a genuine supersede lost its two settlements');
  eq(supersedeAfter.note, canonicalNote, 'a genuine supersede did not land the newer draft');
  eq(supersedeAfter.disabled, false, 'a genuine supersede left Generate disabled');

  /* gsup static half of the same control: nothing awaits between the head of
     generateNote and _mlsStartGeneration, which is why the healthy path cannot
     change. */
  const head = between(SHELL, 'async function generateNote(){', 'const run=_mlsStartGeneration(transcriptEl,evidence);');
  ok(!/\bawait\b/.test(head), 'an await appeared before _mlsStartGeneration, so the deleted abort was not a pure duplicate');
  eq(SHELL.split("  _mlsAbortActiveGeneration('superseded');").length - 1, 1,
    'the supersede abort is no longer the single statement inside _mlsStartGeneration');

  /* ================================================== four-shell twin parity */
  let firstFn = null, firstHelpers = null;
  for (const file of shells) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const fn = extractFunction(source, 'async function generateNote()');
    const helpers = between(source, 'function _mlsGenerationAbortError(reason,field){', 'function _mlsAwaitGeneration(');
    if (firstFn === null) { firstFn = fn; firstHelpers = helpers; }
    else {
      eq(fn, firstFn, file + ': generateNote drifted from the canonical 1p lane');
      eq(helpers, firstHelpers, file + ': the abort/discard helper block drifted from the canonical 1p lane');
    }
    eq(source.split('_mlsFirstDifferingSourceField').length - 1, 2, file + ': the discard-attribution helper is not defined-and-used exactly once each');
    eq(source.split("_mlsGenerationAbortError('source-changed')").length - 1, 0, file + ': an unlabelled source-changed abort came back');
  }

  console.log('PASS generation-discard-attribution-runtime: ' + checks + ' checks on the shipped engine - ' +
    'a cosmetic patientLabel repaint no longer discards a finished note (pre-fix control reproduces the discard); ' +
    'eight real source changes still abort and each names its comparand PHI-free; ' +
    'a transcript rewritten without an input event gets its own calm sentence while typed edits, format and identity changes keep theirs; ' +
    'and a refused press no longer kills the healthy in-flight run while a genuine supersede is byte-identical before and after');
})().catch(error => { console.error((error && error.stack) || error); process.exit(1); });
