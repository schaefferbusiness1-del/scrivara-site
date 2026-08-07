'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const writeflow = fs.readFileSync(path.join(root, 'feat_mls_writeflow.js'), 'utf8');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const patientLock = fs.readFileSync(path.join(root, 'feat_mls_patientlock_b53.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing start marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

/* The executable payload is derived from structured coding fields, not from
 * the receipt prose that also contains diagnoses and other review-only data. */
const canonicalSource = between(app, 'function _athenaCanonicalBilling(coding)', '/* One plan builder');
const canonicalBilling = Function(`${canonicalSource}\nreturn _athenaCanonicalBilling;`)();
const frozen = canonicalBilling({
  em: '99214 — established patient visit',
  cpt: ['J3301 — injection medication', 'CPT 20610 — large joint injection', '99214 duplicate E/M'],
  icd: ['M5450', 'Z0000', 'U0710']
});
/* b946: the snapshot gained a `lines` field carrying units, modifiers and
   laterality, so the billing check can see a bilateral procedure as bilateral —
   without it the payload could not express modifier 50 at all, and a bilateral
   line billed as unilateral pays a third less with no denial to point at it.
   The three fields the confirmation path and the frozen-payload hash depend on
   are asserted individually and are UNCHANGED; asserting the whole object by
   deep equality would only pin that nobody may ever add a field, which is not
   the property this suite exists to protect. The leak check below now covers
   `lines` too, because that is the property that matters. */
assert.strictEqual(frozen.emCode, '99214');
assert.deepStrictEqual(frozen.cptCodes, ['J3301', '20610']);
assert.deepStrictEqual(frozen.invalid, []);
assert(!frozen.cptCodes.some(code => ['M5450', 'Z0000', 'U0710'].includes(code)), 'diagnosis codes leaked into the typed billing snapshot');
assert(!frozen.lines.some(line => ['M5450', 'Z0000', 'U0710'].includes(line.code)), 'diagnosis codes leaked into the structured billing lines');
assert.deepStrictEqual(frozen.lines.map(line => line.code), ['99214', 'J3301', '20610'],
  'every executable code must appear as a line, so the billing check sees the whole claim');
assert(frozen.lines.every(line => Array.isArray(line.modifiers) && line.modifiers.length === 0),
  'these inputs carry no structured modifier, and one must never be invented from a description');
const aliasShadow = canonicalBilling({ cptCodes: [], cpt: ['J3301'] });
assert.strictEqual(aliasShadow.emCode, '', 'an empty alias must not shadow populated structured CPT data');
assert.deepStrictEqual(aliasShadow.cptCodes, ['J3301'], 'an empty alias must not shadow populated structured CPT data');
assert.deepStrictEqual(aliasShadow.invalid, []);
const conflicting = canonicalBilling({ emCode: '99215', em: '99214', cptCodes: ['J3301'], cpt: ['20610'] });
assert(conflicting.invalid.length >= 2, 'conflicting populated E/M and CPT aliases did not fail closed');

const buildPlan = between(app, 'function _athenaBuildPlan(binding)', 'function pushEntireVisitToAthena');
assert(/kind:'billing'[^}]*billing:_athenaCanonicalBilling\(c\)/.test(buildPlan), 'current visit billing plan must carry a typed billing snapshot');
const historyPlan = between(app, 'function pushHistoryNoteToAthena(id)', 'function getAutoSendEMR');
assert(/kind:'billing'[^}]*billing:_athenaCanonicalBilling\(c\)/.test(historyPlan), 'saved visit billing plan must carry its saved typed billing snapshot');

const receiptAction = between(app, 'function _athenaReceiptAction(action)', '/* One truthful destination map');
assert(/action!==['"]write_note['"]&&action!==['"]save_draft['"]/.test(receiptAction), 'receipt action must allow only note write and Save Draft');
assert(/Complete billing, orders, prescriptions, electronic signature, attestation, and claim submission directly in Athena/.test(receiptAction), 'receipt action must give a truthful manual-final-action response');
assert(!/startAthenaAction\(['"]stage_billing['"]/.test(receiptAction), 'receipt action must never start billing execution');

const receipt = between(app, 'function _athenaShowReceipt(who, results, partial, immutablePatient, sections, visitContext)', '/* Review the frozen superbill payload');
assert(/x\.billing=\{emCode:/.test(receipt) && /Object\.freeze\(x\.billing\.cptCodes\)/.test(receipt), 'receipt must copy and freeze exact billing codes');
assert(/hashInput=\{patient:patientCopy,sections:sectionCopy\}/.test(receipt), 'the preview hash must include the frozen billing snapshot');
assert(/Only reviewed note write and Save Draft can be confirmed here/.test(receipt), 'receipt must limit confirmation to the two note lanes');
assert(/Complete in Athena:[^]{0,220}billing[^]{0,220}Sign &amp; Save/.test(receipt), 'receipt must visibly route billing and signature to Athena');
assert(/Dx links manual; no claim/.test(app), 'billing destination must not imply diagnosis links or claim submission');

/* The Superbill shortcut opens one immutable review-only billing payload. It
 * must never start a billing probe/execute controller. */
const superbill = between(app, 'function pushSuperbillToAthena()', '/* Preview a SAVED visit');
assert(/openUnifiedConfirmation\(\{patient:snap\.patient,plan:\[\{kind:['"]billing['"]/.test(superbill), 'Superbill shortcut must open a billing review row');
assert(/snap\.bindingId!==binding\.id/.test(superbill), 'Superbill action must reject a stale display/visit binding');
assert(!/startAthenaAction|mode\s*:\s*['"]execute['"]|mlsAppAthenaActionV2/.test(superbill), 'Superbill shortcut must not enter a billing execution path');
const reviewCalls = [];
const directStatus = { nodeType: 1, style: {}, textContent: '' };
const directBinding = { id: 'visit-bind-1', historical: false };
const directSnapshot = {
  bindingId: directBinding.id,
  patient: { patientId: 'p1', name: 'Example Patient', dob: '01/02/1970', mrn: '1234' },
  billing: { emCode: '99214', cptCodes: ['J3301'] },
  expectedContext: null,
  noteTimestamp: 123,
  historical: false
};
const directContext = {
  _athenaBoundVisitForAction: () => directBinding,
  currentSuperbillSnapshot: directSnapshot,
  window: { __mlsWriteFlow: { openUnifiedConfirmation: opts => { reviewCalls.push(opts); return { manifestId: 'billing-review' }; } } },
  document: { getElementById: id => id === 'billAthenaStatus' ? directStatus : null },
  toast: () => {}
};
vm.runInNewContext(superbill + '\npushSuperbillToAthena();', directContext, { timeout: 100 });
assert.strictEqual(reviewCalls.length, 1, 'one Superbill click must open one immutable review');
assert.strictEqual(reviewCalls[0].plan.length, 1);
assert.strictEqual(reviewCalls[0].plan[0].kind, 'billing');
/* b946: `lines` rides along with the payload. Asserted field by field for the
   same reason as above — the property under test is that the reviewed payload
   is an isolated COPY that a later mutation of the source cannot reach, not
   that the object may never grow a field. */
const reviewedBilling = () => JSON.parse(JSON.stringify(reviewCalls[0].plan[0].billing));
assert.strictEqual(reviewedBilling().emCode, '99214');
assert.deepStrictEqual(reviewedBilling().cptCodes, ['J3301']);
assert.deepStrictEqual(reviewedBilling().invalid, []);
assert(Array.isArray(reviewedBilling().lines), 'the reviewed payload must carry its structured lines');
assert(!reviewCalls[0].plan[0].billing.cptCodes.includes('M5450'), 'Superbill shortcut leaked an ICD code into the reviewed billing payload');
assert.strictEqual(reviewCalls[0].patient.name, 'Example Patient');
directSnapshot.billing.cptCodes[0] = 'M5450';
directSnapshot.billing.lines = [{ code: 'M5450', units: 9, modifiers: ['50'], side: 'bilateral', levels: [] }];
assert.deepStrictEqual(reviewedBilling().cptCodes, ['J3301'], 'post-preview coding mutation changed the reviewed billing snapshot');
assert.strictEqual(reviewedBilling().emCode, '99214', 'post-preview coding mutation changed the reviewed billing snapshot');
assert(!reviewedBilling().lines.some(line => line.code === 'M5450'),
  'post-preview mutation reached the reviewed structured lines — the copy is not isolated');

const identitySource = between(app, 'function _athenaNormIdentity(v)', 'function _athenaResetSuperbill(hide)');
const sameBoundPatient = Function(identitySource + '\nreturn _athenaSameBoundPatient;')();
const patientA = { patientId: 'p-a', name: 'Patient A', dob: '01/01/1970', mrn: '100' };
assert.strictEqual(sameBoundPatient(patientA, { id: 'p-a', name: 'Patient A', dob: '01/01/1970', mrn: '100' }), true);
assert.strictEqual(sameBoundPatient(patientA, { id: 'p-b', name: 'Patient B', dob: '02/02/1980', mrn: '200' }), false, 'A visit could be retargeted to active patient B');

const bindingSource = between(app, 'function _athenaLocalDay(ts)', 'function _athenaResetSuperbill(hide)');
const savedBindingFactory = Function('linkedPatient', `
  var findPatient = function(id){ return linkedPatient && String(linkedPatient.id) === String(id) ? linkedPatient : null; };
  var activePatient = function(){ return linkedPatient; };
  var document = { getElementById: function(){ return null; } };
  var getProviderName = function(){ return ''; };
  var getName = function(){ return ''; };
  var _acctTz = function(){ return 'America/New_York'; };
  ${bindingSource}
  return { saved: _athenaBindingForSavedRecord, day: _athenaLocalDay };
`);
const savedBindingHelpers = savedBindingFactory({ id: 'p-a', name: 'Patient A', dob: '01/01/1970', mrn: '100' });
assert.strictEqual(savedBindingHelpers.saved({ patientId: 'p-a', patient: 'Patient A', patientDob: '01/01/1970', patientMrn: '100', visitDate: '2026-07-13', provider: 'Dr. Example' }).identityConflict, false);
assert.strictEqual(savedBindingHelpers.saved({ patientId: 'p-a', patient: 'Patient B', patientDob: '02/02/1980', patientMrn: '200', visitDate: '2026-07-13', provider: 'Dr. Example' }).identityConflict, true, 'saved record identity conflict did not fail closed');
assert.strictEqual(savedBindingHelpers.day(Date.parse('2026-07-14T02:00:00Z')), '2026-07-13', 'visit day must use the configured account time zone');

const attachSource = between(app, 'function attachVisitToPatient(rec)', 'let currentNoteId=null');
const linkedA = { id: 'p-a', name: 'Patient A', summary: '' };
const activeB = { id: 'p-b', name: 'Patient B', summary: '' };
const attached = [];
const attachVisit = Function('findPatient', 'activePatient', 'upsertPatient', 'mergeListInto', 'currentVisitAthenaBinding', `${attachSource}\nreturn attachVisitToPatient;`)(
  id => id === 'p-a' ? linkedA : null,
  () => activeB,
  patient => attached.push(patient.id),
  (existing, additions) => existing || '',
  { patient: patientA }
);
const savedVisit = { patientId: 'p-a', emr: {}, updated: Date.parse('2026-07-13T12:00:00Z') };
attachVisit(savedVisit);
assert.strictEqual(savedVisit.patientId, 'p-a');
assert.deepStrictEqual(attached, ['p-a'], 'saving patient A\'s bound visit attached it to active patient B');

const topAction = between(app, 'function pushEntireVisitToAthena(btn)', '/* Legacy natural-language autopilot');
assert(/_athenaBoundVisitForAction\('note',false\)/.test(topAction), 'top Athena review must fail closed unless the editor still belongs to the active patient');
assert(/binding\.visitContext\|\|\{historical:false,noteTimestamp:binding\.noteTimestamp\|\|null\}/.test(topAction), 'top Athena review must preserve the visit timestamp/context used during capture or generation');
const freezeBinding = between(app, 'function _athenaFreezeVisitBinding(patient,meta)', 'function _athenaBindingForCurrentVisit(source)');
assert(/historical=meta\.historical===true\|\|rawCtx\.historical===true/.test(freezeBinding) && /noteTimestamp=Number\(meta\.noteTimestamp\|\|rawCtx\.noteTimestamp/.test(freezeBinding), 'frozen visit context must retain historical and timestamp provenance');

const noteRecord = between(app, 'function noteRecordFromState(markSigned)', 'function upsertNote(rec)');
assert(/routePatient=currentVisitAthenaBinding&&currentVisitAthenaBinding\.patient/.test(noteRecord), 'saved notes must use the immutable visit patient');
assert(/patientId:\s*\(routePatient&&routePatient\.patientId\)/.test(noteRecord), 'saved notes must persist the immutable visit patient id');
assert(noteRecord.includes('athenaRouteBlocked:'), 'saved records must quarantine any compromised or mismatched route');
const attachContract = between(app, 'function attachVisitToPatient(rec)', 'let currentNoteId=null');
assert(/findPatient\(rec\.patientId\)/.test(attachContract), 'save attachment must resolve the patient recorded on the visit');
assert(/else if\(!currentVisitAthenaBinding\)/.test(attachContract), 'active-patient fallback must be unavailable for a bound visit');

const desktopStart = between(app, 'function startCapture()', 'function stopCapture()');
assert(desktopStart.indexOf("_athenaPrepareRecording('recording')") < desktopStart.indexOf('recog.start()'), 'desktop capture must safely prepare or refuse a stale patient binding before touching the microphone');
assert(desktopStart.indexOf('recog.start()') < desktopStart.indexOf('_athenaSetVisitBinding(captureBindingCandidate)'), 'desktop capture must not bind the patient until microphone start succeeds');
assert(desktopStart.indexOf('return false;') < desktopStart.indexOf('_athenaSetVisitBinding(captureBindingCandidate)'), 'failed desktop capture could leave a stale patient binding');
assert(desktopStart.includes('recog._mlsCaptureEpoch=captureSessionEpoch') && desktopStart.includes('recog._mlsBindingId=currentVisitAthenaBinding') && desktopStart.includes('recog._mlsBindingEpoch=currentVisitAthenaEpoch'), 'desktop recording results were not scoped to one visit binding and epoch');
const desktopRecognition = between(app, 'function initRecog()', 'function showMicWarn(msg)');
assert(desktopRecognition.includes('if(instance!==recog)return;') && desktopRecognition.includes('if(instance._mlsStartPending)') && desktopRecognition.includes('instance._mlsPendingResults') && desktopRecognition.includes('!capturing||instance._mlsCaptureEpoch!==captureSessionEpoch') && desktopRecognition.includes('instance._mlsBindingId!==currentVisitAthenaBinding.id') && desktopRecognition.includes('instance._mlsBindingEpoch') && desktopRecognition.includes('currentVisitAthenaEpoch'), 'late or synchronous desktop recognition events could land before binding or in a new visit');

function desktopCaptureHarness(options = {}) {
  const events = [], warnings = [], timers = [];
  const transcript = { value: '' };
  const captureBtn = {
    innerHTML: '',
    classList: {
      values: new Set(['btn-primary']),
      add(value) { this.values.add(value); },
      remove(value) { this.values.delete(value); },
      contains(value) { return this.values.has(value); }
    }
  };
  const candidate = { id: 'visit-candidate', patient: { patientId: 'patient-a', name: 'Patient A' } };
  const recognizers = [];
  class FakeRecognition {
    constructor() { this.startCalls = 0; this.stopCalls = 0; recognizers.push(this); }
    start() {
      this.startCalls += 1;
      events.push('start');
      if (options.syncResult && typeof this.onresult === 'function') {
        const row = [{ transcript: options.syncResult }]; row.isFinal = true;
        this.onresult({ resultIndex: 0, results: [row] });
      }
      if (options.syncError && typeof this.onerror === 'function') this.onerror({ error: options.syncError });
      if (options.startThrows) throw new Error('synthetic start failure');
      events.push('start-return');
    }
    stop() { this.stopCalls += 1; events.push('stop'); if (typeof this.onend === 'function') this.onend(); }
    abort() { events.push('abort'); if (typeof this.onend === 'function') this.onend(); }
  }
  const context = {
    console, Promise, Date, Math, Number, String, Array, Object,
    SpeechRecognition: FakeRecognition,
    currentVisitAthenaBinding: null,
    currentVisitAthenaEpoch: 0,
    currentVisitAthenaCompromised: false,
    document: { getElementById(id) { return id === 'transcript' ? transcript : id === 'captureBtn' ? captureBtn : null; } },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    _mlsExactScheduledClinicalAction() { return true; },
    _athenaPrepareRecording() { events.push('prepare'); return true; },
    _athenaBindingForCurrentVisit() { return candidate; },
    _athenaCurrentMatchesBound() { return true; },
    _markVisitDirty() {}, _updateLiveCapture() {}, _hideLiveCapture() {},
    toast() {},
    showMicWarn(message) { warnings.push(message); }
  };
  context.window = context;
  context._athenaSetVisitBinding = function (binding) {
    events.push('bind');
    if (options.bindFails) return false;
    context.currentVisitAthenaBinding = binding;
    context.currentVisitAthenaEpoch += 1;
    return true;
  };
  const speechStart = app.indexOf("let recog=null, capturing=false, finalText='', captureSessionEpoch=0;");
  const speechEnd = app.indexOf('\nfunction showMicWarn(msg)', speechStart);
  const captureStart = app.indexOf('function startCapture()');
  const captureEnd = app.indexOf('\nfunction clearTranscript()', captureStart);
  assert(speechStart >= 0 && speechEnd > speechStart && captureStart >= 0 && captureEnd > captureStart,
    'desktop capture transaction source could not be isolated');
  const runtime = app.slice(speechStart, speechEnd) + '\n' + app.slice(captureStart, captureEnd) +
    '\nwindow.startCapture=startCapture;window.stopCapture=stopCapture;' +
    '\nwindow.__desktopCaptureState=function(){return {capturing:capturing,hasRecog:!!recog,epoch:captureSessionEpoch};};';
  vm.runInNewContext(runtime, context, { filename: 'desktop-capture-transaction.js' });
  return { context, events, warnings, transcript, captureBtn, recognizers, timers };
}

/* A synchronous result from start() is buffered until the successful return
 * commits the immutable binding, then replayed exactly once into that visit. */
const syncCapture = desktopCaptureHarness({ syncResult: 'synchronous phrase' });
assert.strictEqual(syncCapture.context.startCapture(), true, 'successful synchronous desktop capture was refused');
assert(syncCapture.events.indexOf('prepare') < syncCapture.events.indexOf('start'), 'recording touched the microphone before visit preparation');
assert(syncCapture.events.indexOf('start-return') < syncCapture.events.indexOf('bind'), 'desktop visit bound before microphone start succeeded');
assert.strictEqual(syncCapture.transcript.value, 'synchronous phrase', 'synchronous recognition result was not replayed after binding');
assert.strictEqual(syncCapture.context.__desktopCaptureState().capturing, true, 'successful desktop capture did not remain active');

/* If start throws after a synchronous result, no visit binding or transcript
 * mutation may survive, and the prepared recognizer must be invalidated. */
const failedCapture = desktopCaptureHarness({ syncResult: 'must be discarded', startThrows: true });
assert.strictEqual(failedCapture.context.startCapture(), false, 'synchronous microphone failure reported a successful capture');
assert.strictEqual(failedCapture.context.currentVisitAthenaBinding, null, 'failed microphone start left a visit binding');
assert.strictEqual(failedCapture.transcript.value, '', 'failed microphone start replayed buffered speech');
assert.strictEqual(JSON.stringify(failedCapture.context.__desktopCaptureState()), JSON.stringify({ capturing: false, hasRecog: false, epoch: 1 }), 'failed microphone start left a live recognizer or capture state');
assert.strictEqual(failedCapture.warnings.length, 1, 'failed microphone start was not explained once');

const deniedCapture = desktopCaptureHarness({ syncResult: 'must also be discarded', syncError: 'not-allowed' });
assert.strictEqual(deniedCapture.context.startCapture(), false, 'synchronous permission denial reported a successful capture');
assert.strictEqual(deniedCapture.context.currentVisitAthenaBinding, null, 'permission denial bound a visit after its handler stopped capture');
assert.strictEqual(deniedCapture.transcript.value, '', 'permission denial replayed a result buffered before failure');
assert.strictEqual(deniedCapture.warnings.length, 1, 'permission denial was not explained exactly once');
const desktopStop = between(app, 'function stopCapture()', 'function clearTranscript()');
assert(desktopStop.indexOf('recog=null') < desktopStop.indexOf('oldRecog.stop()'), 'desktop stop must invalidate the old recognition instance before a late result can fire');
const phoneStart = between(app, 'async function startPhoneMic(clickEvent)', 'async function pollPhoneMic()');
assert(phoneStart.indexOf("_athenaPrepareRecording('phone recording')") < phoneStart.indexOf('/api/mic/start'), 'phone capture must safely prepare or refuse a stale patient binding before starting remotely');
assert(phoneStart.indexOf('!res.ok || !data.code') < phoneStart.indexOf('_athenaSetVisitBinding(phoneBindingCandidate)'), 'phone capture must not bind the patient until the server returns a valid recording code');
assert(phoneStart.indexOf("_athenaAsyncBindingStillSafe(phoneBindingCandidate,'phone recording',phoneBindingEpoch)") < phoneStart.indexOf('phoneMicCode=data.code'), 'a delayed phone response must be discarded after any patient/visit change');
const generation = between(app, 'async function generateNote()', 'function autoPopulateExtras(result)');
assert(generation.indexOf("_athenaGuardBoundEditor('note generation')") < generation.indexOf('generationBinding='), 'note generation must refuse a patient/bound-visit mismatch');
assert(generation.indexOf("_athenaAsyncBindingStillSafe(generationBinding,'note generation',generationEpoch)") < generation.indexOf('currentSoap=_reorderNoteForStyle(result.note'), 'a delayed AI result must be discarded after any patient/visit change');
const generationAwait = generation.indexOf('callOpenAI(transcript,key)');
assert(generationAwait >= 0, 'note generation no longer routes through callOpenAI');
assert(generation.indexOf('generationFingerprint=_athenaEditorFingerprint()') < generationAwait && generation.indexOf('generationFormat=currentFormat') < generationAwait, 'note generation did not capture the exact same-visit editor state before AI');
assert(generation.indexOf('_athenaEditorFingerprint()!==generationFingerprint', generationAwait) < generation.indexOf('currentSoap=_reorderNoteForStyle(result.note'), 'a delayed note result could overwrite newer clinician edits in the same visit');
assert(generation.indexOf('currentFormat!==generationFormat', generationAwait) < generation.indexOf('currentSoap=_reorderNoteForStyle(result.note'), 'a delayed note result could overwrite a newly selected note format');
assert(generation.indexOf('generation-timeout') >= 0 && generation.indexOf('Promise.race') >= 0 && generation.indexOf('Promise.race') < generation.indexOf('currentSoap=_reorderNoteForStyle(result.note'), 'note generation must bound the AI wait so a hung request cannot silently disable Generate forever');

const optimization = between(app, 'async function optimizeForPayout()', 'async function postChatRaw');
const optimizationAwait = optimization.indexOf('await postChatRaw');
const optimizationMutation = optimization.indexOf('currentOpt=normalizeOpt(data)');
assert(optimization.indexOf('if(!currentVisitAthenaBinding)') >= 0 && optimization.indexOf("_athenaGuardBoundEditor('coding optimization')") < optimizationAwait, 'coding optimization must require and guard one immutable visit before starting');
assert(optimization.indexOf('optimizationBinding=currentVisitAthenaBinding') < optimizationAwait && optimization.indexOf('optimizationEpoch=currentVisitAthenaEpoch') < optimizationAwait && optimization.indexOf('optimizationFingerprint=_athenaEditorFingerprint()') < optimizationAwait, 'coding optimization did not capture the visit, epoch, and exact input before its async request');
assert(optimizationAwait >= 0 && optimization.indexOf("_athenaAsyncBindingStillSafe(optimizationBinding,'coding optimization',optimizationEpoch)", optimizationAwait) < optimizationMutation, 'a delayed coding response could mutate a different patient visit');
assert(optimization.indexOf('_athenaEditorFingerprint()!==optimizationFingerprint', optimizationAwait) < optimizationMutation, 'a delayed coding response could overwrite content edited during its request');
assert(optimization.indexOf('_markVisitDirty()', optimizationMutation) > optimizationMutation, 'accepted coding changes must participate in draft recovery and saved-state checks');

const persistence = between(app, 'function upsertNote(rec)', '/* Best-effort backend persistence');
for (const required of ["_athenaGuardBoundEditor('saving this visit')", "_athenaGuardBoundEditor('saving this draft')", "_athenaGuardBoundEditor('saving this note')"]) {
  assert(persistence.includes(required), `local persistence is missing ${required}`);
}
const signing = between(app, 'function signNote()', 'function fullText()');
assert(signing.includes("_athenaGuardBoundEditor('signing this note')") && signing.includes('saveCurrentNote(false)!==true'), 'signing could claim success after an unsafe/failed save');
const orderSave = between(app, 'function saveOrdersToHistory()', '/* =========================================================\n   FEATURE 1');
assert(orderSave.includes("_athenaGuardBoundEditor('saving these orders')"), 'orders history could bypass the visit/patient persistence guard');
assert(historyPlan.includes('savedBinding.routeBlocked'), 'a quarantined saved visit could reopen the Athena action workflow');

const draftSave = between(app, 'function _saveVisitDraft()', 'function _wipeVisitDraft()');
assert(draftSave.includes('athenaBinding:bindingCopy') && draftSave.includes('athenaCompromised:'), 'refresh recovery must persist patient-binding provenance');
const draftRestore = between(app, 'function _restoreVisitDraft()', 'function _dismissVisitRestore()');
assert(draftRestore.includes("source:'restored-draft'") && draftRestore.includes("else restored=_athenaFreezeVisitBinding") && draftRestore.includes("source:'legacy-restored-draft'") && draftRestore.includes('routeBlocked:true') && draftRestore.includes('||!rb'), 'restored drafts must retain identity and quarantine every legacy identity-free draft');
const sessionStart = between(app, 'function startSession(email)', 'function logout(force)');
assert(sessionStart.includes('newVisit({preserveRecovery:true})'), 'session bootstrap erased the recoverable draft before the Restore bar could read it');
const newVisitSource = between(app, 'function newVisit(opts)', 'function noteRecordFromState(markSigned)');
assert(newVisitSource.includes('if(!opts.preserveRecovery)') && newVisitSource.includes('stopPhoneMic()'), 'New visit must preserve bootstrap recovery and stop an old phone session');

const phonePoll = between(app, 'async function pollPhoneMic()', 'async function stopPhoneMic()');
assert(phonePoll.includes('const code=phoneMicCode, bindingId=phoneMicBindingId, bindingEpoch=phoneMicBindingEpoch') && phonePoll.includes('Number(bindingEpoch)!==Number(currentVisitAthenaEpoch)') && phonePoll.includes('currentVisitAthenaBinding.id!==bindingId'), 'in-flight phone polling was not scoped to one visit binding and epoch');
assert(noteRecord.includes('currentVisitAthenaBinding.identityConflict'), 'saving a conflicted record could launder its patient identity');

const templateApply = between(app, 'async function applyTemplateToNote(template,visitText,expectedBinding,expectedEpoch)', 'async function maybeApplyTemplate');
const manualTemplateApply = between(app, 'async function useTemplateNow(id)', 'function previewTemplate(id)');
assert(manualTemplateApply.includes('if(!currentVisitAthenaBinding)') && manualTemplateApply.indexOf("_athenaGuardBoundEditor('template formatting')") < manualTemplateApply.indexOf('await applyTemplateToNote'), 'manual template formatting can start without one safe patient visit');
assert(templateApply.indexOf('if(!expectedBinding)') < templateApply.indexOf('await aiCallRaw'), 'template formatting could start without one immutable visit binding');
assert(templateApply.indexOf("_athenaAsyncBindingStillSafe(expectedBinding,'template formatting',expectedEpoch)") < templateApply.indexOf('await aiCallRaw'), 'template formatting did not validate its visit before starting');
assert(templateApply.indexOf("_athenaAsyncBindingStillSafe(expectedBinding,'template formatting',expectedEpoch)") < templateApply.indexOf("if(currentFormat==='soap') currentSoap=out"), 'a delayed template result could mutate a different patient visit');
assert(templateApply.indexOf('templateFingerprint=_athenaEditorFingerprint()') < templateApply.indexOf('await aiCallRaw') && templateApply.indexOf('templateFormat=currentFormat') < templateApply.indexOf('await aiCallRaw'), 'template formatting did not capture the source note and format before AI');
assert(templateApply.indexOf('_athenaEditorFingerprint()!==templateFingerprint', templateApply.indexOf('await aiCallRaw')) < templateApply.indexOf("if(currentFormat==='soap') currentSoap=out"), 'template formatting could overwrite same-visit clinician edits');
assert(templateApply.indexOf('currentFormat!==templateFormat', templateApply.indexOf('await aiCallRaw')) < templateApply.indexOf("if(currentFormat==='soap') currentSoap=out"), 'template formatting could put a stale SOAP result into the insurance buffer');

const groundedTemplateWrapper = between(connect, 'var _origApply = null;', '/* =====================================================================\n   * E. keyword backfill');
assert(groundedTemplateWrapper.includes('function (template, visitText, expectedBinding, expectedEpoch)'), 'grounded template wrapper does not accept the core binding and epoch');
assert(groundedTemplateWrapper.includes('_origApply.call(self, safeTpl, visitText, expectedBinding, expectedEpoch)'), 'grounded template wrapper dropped the core binding or epoch');
assert(groundedTemplateWrapper.indexOf('_athenaAsyncBindingStillSafe(expectedBinding, "template formatting audit", expectedEpoch)') < groundedTemplateWrapper.indexOf('var nb2 = $("noteBox")'), 'grounded template audit could restore patient A text into patient B');

const opTemplateFill = between(connect, 'function fillOpSkeleton(tpl, transcript, expectedBinding, expectedEpoch)', '/* =====================================================================\n   * D. wrap maybeApplyTemplate');
assert(opTemplateFill.indexOf('_athenaAsyncBindingStillSafe(expectedBinding, "operative-note formatting", expectedEpoch)') < opTemplateFill.indexOf('Promise.resolve(window.aiCallRaw'), 'operative-note formatting did not validate the visit before starting AI');
assert(opTemplateFill.lastIndexOf('_athenaAsyncBindingStillSafe(expectedBinding, "operative-note formatting", expectedEpoch)') < opTemplateFill.indexOf('nb2.value = note'), 'operative-note formatting could write a delayed result into another visit');
assert(opTemplateFill.includes('window._athenaEditorFingerprint() !== editorFingerprint'), 'operative-note formatting could overwrite same-visit edits made during AI');
const opTemplateWrapper = between(connect, 'function wrapMaybe()', '/* =====================================================================\n   * E. "ADD ANY WORD TO AN OP NOTE"');
assert(opTemplateWrapper.includes('function (visitText, expectedBinding, expectedEpoch)') && opTemplateWrapper.includes('fillOpSkeleton(pick.tpl, S(visitText), expectedBinding, expectedEpoch)'), 'operative-note wrapper dropped the core binding or epoch');
assert(opTemplateWrapper.includes('r.reason === "stale-visit"'), 'operative-note wrapper could retry stale patient-A work through another wrapper');

assert(!/rec\.patientId\s*=\s*LOCK\.snapshot\.id/.test(patientLock), 'legacy patient lock can still retarget the core immutable saved record');
assert(/if \(r === true\) clearLock\(\)/.test(patientLock), 'legacy patient lock clears ownership even when saving is refused');

const legacyStash = between(connect, '/* =============================================================================\n * __mlsVisitSessionStash', '/* ============================================================\n * feat_mls_ext_download_sync');
const stashDisabled = legacyStash.indexOf('window.__mlsVisitSessionStashDisabled = true');
const stashReturn = legacyStash.indexOf('return;', stashDisabled);
const legacyStashApi = legacyStash.indexOf("var api = { ver: '1.0.0'");
assert(stashDisabled >= 0 && stashReturn > stashDisabled && legacyStashApi > stashReturn, 'the unsafe legacy cross-patient visit stash is still reachable');
assert(legacyStash.indexOf('window.__mlsVisitSessionStash_revert();') < stashDisabled, 'a previously installed legacy stash wrapper is not retired when the new bundle loads');

const setActive = between(app, 'function setActivePtId(id)', 'function activePatient()');
assert(setActive.includes('_athenaHandleActivePatientChange(previous,id'), 'every active-patient transition must clear stale action state and preserve visit ownership');
assert(app.includes("_athenaMarkBoundEdit==='function')_athenaMarkBoundEdit(id)"), 'manual edits must bind on first input and invalidate the old visit destination after a patient switch');
const bindingSafetySource = between(app, 'function _athenaEditorFingerprint()', 'function _athenaLocalDay(ts)');
assert(bindingSafetySource.includes('if(binding.identityConflict)'), 'identity-conflicted saved visits must be read-only and Athena-blocked');
assert(bindingSafetySource.includes('_athenaResetSuperbill(true)'), 'every patient switch must clear the old Superbill/action status');
assert(bindingSafetySource.includes('currentVisitAthenaCompromised=true'), 'cross-patient editor changes must become a hard failure');
assert(bindingSafetySource.includes('Start a New visit'), 'mismatched recording/generation must give a safe recovery path');
assert(bindingSafetySource.includes("!_visitDirty") && bindingSafetySource.includes('newVisit()'), 'a clean completed visit must automatically become a fresh visit before recording the newly selected patient');
assert(bindingSafetySource.includes('recog._mlsBindingId=currentVisitAthenaBinding.id') && bindingSafetySource.includes('phoneMicBindingId=currentVisitAthenaBinding.id'), 'one-time blank visit label completion must keep active desktop and phone recording attached to the same visit');
assert(topAction.includes("_athenaBoundVisitForAction('note',false)"));

const makeBindingSafety = Function(`
  var transcript={value:'patient A transcript'}, note={value:''}, label={value:''}, active=null, resets=0;
  var patients={a:{id:'a',name:'Patient A',dob:'01/01/1970'},b:{id:'b',name:'Patient B',dob:'02/02/1980'}};
  var document={getElementById:function(id){return id==='transcript'?transcript:(id==='noteBox'?note:(id==='patientLabel'?label:null));}};
  var currentSoap='',currentInsurance='',currentCoding=null,currentOrders=[],currentFormat='soap',currentNoteId='n-a';
  var _visitDirty=false;
  var currentVisitAthenaBinding=null,currentVisitAthenaCompromised=false,currentVisitAthenaAwayFingerprint=null,currentVisitAthenaEpoch=0;
  var capturing=false,phoneMicCode='';
  var activePatient=function(){return active;},findPatient=function(id){return patients[id]||null;};
  var _athenaBindingForCurrentVisit=function(){return {id:'manual-a',patient:{patientId:active&&active.id,name:(active&&active.name)||label.value,dob:active&&active.dob}};};
  var _athenaFreezeVisitBinding=function(patient,meta){return {id:'completed-'+Date.now(),patient:{patientId:patient.patientId||'',name:patient.name||'',dob:patient.dob||'',mrn:patient.mrn||''},source:meta.source||'',historical:meta.historical===true,routeBlocked:meta.routeBlocked===true,visitContext:meta.visitContext||null,noteTimestamp:meta.noteTimestamp||null,displayDate:meta.displayDate||'',displayProvider:meta.displayProvider||''};};
  var getNotes=function(){return [{id:'n-a',transcript:'patient A transcript',soap:'',insurance:'',coding:null,orders:[]}];};
  var _athenaNormIdentity=function(v){return String(v||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();};
  var _athenaSameBoundPatient=function(bound,p){return !!(bound&&p&&String(bound.patientId)===String(p.id));};
  var _athenaResetSuperbill=function(){resets++;},toast=function(){},newVisit=function(){currentNoteId=null;transcript.value='';_athenaSetVisitBinding(null);},prefillContextFromProfile=function(){};
  ${bindingSafetySource}
  active=patients.a;
  _athenaSetVisitBinding({id:'bind-a',patient:{patientId:'a',name:'Patient A',dob:'01/01/1970'}});
  return {
    switchTo:function(id){var old=active&&active.id;_athenaHandleActivePatientChange(old,id);active=patients[id]||null;},
    edit:function(text){transcript.value=text;_visitDirty=true;_athenaMarkBoundEdit('transcript');},
    guard:function(){return _athenaGuardBoundEditor('recording');},
    prepare:function(){return _athenaPrepareRecording('recording');},
    asyncSafe:function(candidate,epoch){return _athenaAsyncBindingStillSafe(candidate,'delayed work',epoch);},
    candidate:function(){return currentVisitAthenaBinding;},
    epoch:function(){return currentVisitAthenaEpoch;},
    recommit:function(binding){return _athenaSetVisitBinding(binding);},
    abandon:function(){newVisit();},
    resetUnbound:function(){_athenaSetVisitBinding(null,true);transcript.value='first manual text';_visitDirty=true;},
    mark:function(){_athenaMarkBoundEdit('transcript');},
    beginUnlabelled:function(){active=null;label.value='';_athenaSetVisitBinding(null,true);transcript.value='unlabelled text';_athenaMarkBoundEdit('transcript');},
    completeLabel:function(value){label.value=value;_athenaMarkBoundEdit('patientLabel');},
    owner:function(){return currentVisitAthenaBinding&&currentVisitAthenaBinding.patient&&currentVisitAthenaBinding.patient.patientId;},
    boundName:function(){return currentVisitAthenaBinding&&currentVisitAthenaBinding.patient&&currentVisitAthenaBinding.patient.name;},
    resets:function(){return resets;}
  };
`);
const unchangedSwitch = makeBindingSafety();
unchangedSwitch.switchTo('b');
assert.strictEqual(unchangedSwitch.guard(), false, 'patient B could continue patient A\'s bound editor');
unchangedSwitch.switchTo('a');
assert.strictEqual(unchangedSwitch.guard(), true, 'unchanged patient A work could not be resumed after viewing patient B');
const cleanNewPatient = makeBindingSafety();
cleanNewPatient.switchTo('b');
assert.strictEqual(cleanNewPatient.prepare(), true, 'a clean completed visit did not atomically start a fresh visit for patient B');
assert.strictEqual(cleanNewPatient.guard(), true, 'fresh patient B recording remained tied to patient A');
const changedSwitch = makeBindingSafety();
const originalBinding = changedSwitch.candidate();
changedSwitch.switchTo('b');
changedSwitch.edit('patient B transcript');
changedSwitch.switchTo('a');
assert.strictEqual(changedSwitch.guard(), false, 'patient B content could be confirmed after reselecting patient A');
changedSwitch.recommit(originalBinding);
assert.strictEqual(changedSwitch.guard(), false, 'recommitting an existing async binding erased its compromise state');
assert(changedSwitch.resets() >= 2, 'patient switches did not clear stale Superbill/action status');
const firstInput = makeBindingSafety();
firstInput.resetUnbound();
firstInput.mark();
assert.strictEqual(firstInput.owner(), 'a', 'first manual clinical text was not bound to patient A immediately');
const unlabelled = makeBindingSafety();
unlabelled.beginUnlabelled();
unlabelled.completeLabel('J.D.');
assert.strictEqual(unlabelled.boundName(), 'J.D.', 'an unlabeled manual visit could not complete its label once without becoming compromised');
assert.strictEqual(unlabelled.guard(), true, 'one-time unlabeled identity completion blocked the local visit');
const delayed = makeBindingSafety();
const delayedCandidate = delayed.candidate();
delayed.switchTo('b');
assert.strictEqual(delayed.asyncSafe(delayedCandidate), false, 'delayed work stayed valid after the active patient changed');
const abandoned = makeBindingSafety();
const abandonedCandidate = abandoned.candidate();
const abandonedEpoch = abandoned.epoch();
abandoned.abandon();
assert.strictEqual(abandoned.asyncSafe(abandonedCandidate, abandonedEpoch), false, 'an abandoned async result was accepted into a new visit for the same patient');

const superbillRender = between(app, 'function showSuperbill()', '/* =========================================================\n   PATIENT COST ESTIMATOR');
assert(/currentSuperbillSnapshot=\{bindingId:binding\.id/.test(superbillRender), 'visible Superbill must freeze its patient, visit, and exact displayed codes');
assert(/_athenaResetSuperbill\(true\)/.test(superbillRender), 'rendering a Superbill must clear and hide any prior action result');
assert(/typedBilling\.invalid&&typedBilling\.invalid\.length/.test(superbillRender), 'conflicting displayed/executable billing aliases must fail closed');

/* Legacy text input remains supported only when it explicitly labels a CPT or
 * HCPCS line/section. Undotted ICD-10 tokens in diagnosis prose must never be
 * reinterpreted as executable billing codes. */
const normalizerSource = between(writeflow, 'function stringList(v)', 'function currentBilling(panel, opts)');
const normalizeBilling = Function(`var S=function(x){return x==null?'':String(x);};\n${normalizerSource}\nreturn normalizeBilling;`)();
const parsed = normalizeBilling({ billingText: [
  'BILLING:',
  'E/M level: 99214',
  'CPT charges:',
  '• J3301 — medication',
  '• 20610 — large joint injection',
  'Attach these diagnoses to the charges: M5450; Z0000; U0710',
  'ORDERS:',
  '• 72148 MRI lumbar spine',
  'Patient: Example Patient'
].join('\n') });
assert.strictEqual(parsed.emCode, '99214');
assert.deepStrictEqual(parsed.cptCodes, ['J3301', '20610']);
assert.deepStrictEqual(parsed.diagnoses, ['M5450', 'Z0000', 'U0710']);
for (const forbidden of ['M5450', 'Z0000', 'U0710', '72148']) {
  assert(!parsed.cptCodes.includes(forbidden), `${forbidden} leaked from non-billing prose into CPT/HCPCS staging`);
}
assert.deepStrictEqual(normalizeBilling({ billingText: 'Diagnosis: M5450\nPatient: Z0000' }).cptCodes, []);
assert.deepStrictEqual(normalizeBilling({ billingText: 'CPT charges:\n• J3301\nOTHER REVIEW:\n• M5450' }).cptCodes, ['J3301']);
assert.deepStrictEqual(normalizeBilling({ cpt: [], cptCodes: ['J3301'] }).cptCodes, ['J3301'], 'empty CPT alias shadowed populated cptCodes');
assert.deepStrictEqual(normalizeBilling({ invalid: [], conflicts: ['Conflicting CPT aliases'] }).invalid, ['Conflicting CPT aliases'], 'an empty invalid list shadowed explicit billing conflicts');

console.log('PASS confirmed billing contract: review-only Superbill uses a frozen typed code payload and excludes diagnosis/order prose');
