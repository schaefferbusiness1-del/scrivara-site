'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_note_editor.js'), 'utf8');

function between(text, start, end) {
  const a = text.indexOf(start);
  assert(a >= 0, `missing source marker: ${start}`);
  const b = text.indexOf(end, a + start.length);
  assert(b > a, `missing source end marker: ${end}`);
  return text.slice(a, b);
}

const wrapperSource = between(source, 'function wrapOverwriters()', 'function unwrap()');
assert(wrapperSource.includes('captureVisitToken("regenerating this note")'), 'full regeneration must capture one immutable visit token');
assert(wrapperSource.indexOf('visitTokenStillSafe(visitToken, "locked-section restoration")') < wrapperSource.indexOf('reapplyLocked(savedLocked)'), 'locked sections can be restored before the captured visit is revalidated');
assert(wrapperSource.includes('accepted !== true') && !wrapperSource.includes('setInterval('), 'locked-section restoration can still treat an unrelated same-visit edit as regeneration completion');

const sectionSource = between(source, 'function regenerateSection(key)', '/* =====================================================================\n   * DICTATION');
assert(sectionSource.includes('captureVisitToken("regenerating this section")'), 'section regeneration must capture the immutable visit before its AI request');
assert(sectionSource.indexOf('visitTokenStillSafe(visitToken, "section regeneration")') < sectionSource.indexOf('setNote(replaced'), 'a delayed section result can reach the editor before revalidation');
assert(sectionSource.indexOf('sectionFingerprint = JSON.stringify([cur, transcript])') < sectionSource.indexOf('window.aiCallRaw') && sectionSource.indexOf('JSON.stringify([noteVal(), transcriptNow]) !== sectionFingerprint') < sectionSource.indexOf('setNote(replaced'), 'section regeneration can overwrite newer same-visit edits');
assert(/soapKeyFamily\s*=\s*\{\s*s:\s*["']soap["']\s*,\s*o:\s*["']exam["']\s*,\s*a:\s*["']assessment["']\s*,\s*p:\s*["']plan["']\s*\}/.test(sectionSource) &&
  /family:\s*family/.test(sectionSource), 'section regeneration must send the exact SOAP-section tuning family');
assert(/draftSubtype:\s*["']section_regeneration["']/.test(sectionSource), 'section regeneration must identify its bounded draft subtype');

const dictationSource = between(source, 'function discardDictation()', '/* =====================================================================\n   * ORIGINAL vs EDITED');
assert(dictationSource.includes('dictVisitToken = visitToken') && dictationSource.includes('session !== dictSession'), 'dictation must be scoped to one recognizer session and visit token');
assert(dictationSource.indexOf('if (!visitTokenStillSafe(visitToken, "note dictation")) return "";') < dictationSource.indexOf('if (text) addSentence'), 'stale dictation can be inserted before the visit token is revalidated');
assert(dictationSource.includes('claimNoteSpeech()') && dictationSource.includes('releaseNoteSpeech()'), 'advanced note dictation does not participate in the single microphone owner');

function makeElement(value, display) {
  return {
    value: value || '',
    style: { display: display == null ? 'block' : display },
    dispatchEvent() {},
    getElementsByClassName() { return []; }
  };
}

async function main() {
  const noteBox = makeElement('');
  const transcript = makeElement('');
  const patientLabel = makeElement('Patient A');
  const elements = { noteBox, transcript, patientLabel };
  const toasts = [];
  let activeId = 'a';
  let recognizer = null;

  class FakeRecognition {
    constructor() {
      recognizer = this;
      this.started = 0;
    }
    start() { this.started++; }
    stop() { if (typeof this.onend === 'function') this.onend(); }
    abort() { if (typeof this.onend === 'function') this.onend(); }
  }

  const bindingA = { id: 'visit-a', patientId: 'a' };
  const bindingB = { id: 'visit-b', patientId: 'b' };
  const context = {
    console,
    Promise,
    Date,
    Math,
    JSON,
    Object,
    String,
    Number,
    Array,
    RegExp,
    isFinite,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    Event: function Event(type) { this.type = type; },
    location: { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' },
    document: {
      readyState: 'loading',
      getElementById(id) { return elements[id] || null; },
      querySelector() { return null; },
      addEventListener() {},
      removeEventListener() {}
    },
    SpeechRecognition: FakeRecognition,
    MutationObserver: null,
    currentVisitAthenaBinding: bindingA,
    currentVisitAthenaEpoch: 1,
    getActivePtId() { return activeId; },
    toast(message, kind) { toasts.push({ message, kind }); },
    currentNoteText() {},
    buildPatientContext() { return ''; },
    getKey() { return 'test-key'; },
    regenerateNote() { return Promise.resolve(true); }
  };
  context.window = context;
  context._athenaGuardBoundEditor = function () {
    const b = context.currentVisitAthenaBinding;
    return !!(b && String(b.patientId) === String(activeId));
  };
  context._athenaAsyncBindingStillSafe = function (candidate, _label, epoch) {
    const current = context.currentVisitAthenaBinding;
    return !!(candidate && current && candidate.id === current.id && Number(epoch) === Number(context.currentVisitAthenaEpoch) && String(candidate.patientId) === String(activeId));
  };

  vm.runInNewContext(source, context, { filename: 'feat_mls_note_editor.js' });
  const api = context.__mlsNoteEditor;
  assert(api && api.installed, 'note editor did not install in the contract harness');

  const soapA = 'SUBJECTIVE\nA subjective.\nOBJECTIVE\nA objective.\nASSESSMENT\nA assessment.\nPLAN\nA plan.';
  const soapB = 'SUBJECTIVE\nB subjective.\nOBJECTIVE\nB objective.\nASSESSMENT\nB assessment.\nPLAN\nB plan.';

  // A delayed section result for patient A must not mutate patient B.
  noteBox.value = soapA;
  transcript.value = 'Patient A transcript';
  let resolveSection;
  let sectionOpts = null;
  context.aiCallRaw = (_sys, _user, _key, opts) => {
    sectionOpts = opts || null;
    return new Promise(resolve => { resolveSection = resolve; });
  };
  const sectionRun = api.regenerateSection('A');
  assert(sectionRun && typeof sectionRun.then === 'function', 'section regeneration did not return its guarded async operation');
  assert(sectionOpts && sectionOpts.family === 'assessment' && sectionOpts.draftSubtype === 'section_regeneration', 'assessment regeneration did not reach its exact tuning family');
  activeId = 'b';
  context.currentVisitAthenaBinding = bindingB;
  context.currentVisitAthenaEpoch = 2;
  patientLabel.value = 'Patient B';
  noteBox.value = soapB;
  resolveSection('ASSESSMENT\nPatient A delayed assessment.');
  await sectionRun;
  assert.strictEqual(noteBox.value, soapB, 'patient A section regeneration mutated patient B');

  // A locked patient-A section must not be reapplied merely because switching
  // to patient B changed the visible note while regeneration was in flight.
  activeId = 'a';
  context.currentVisitAthenaBinding = bindingA;
  context.currentVisitAthenaEpoch = 3;
  patientLabel.value = 'Patient A';
  noteBox.value = soapA;
  api.toggleLock('S');
  api._wrapOverwriters();
  context.regenerateNote();
  activeId = 'b';
  context.currentVisitAthenaBinding = bindingB;
  context.currentVisitAthenaEpoch = 4;
  patientLabel.value = 'Patient B';
  noteBox.value = soapB;
  await new Promise(resolve => setTimeout(resolve, 230));
  assert.strictEqual(noteBox.value, soapB, 'patient A locked section was merged into patient B after a switch');

  // Buffered dictation and queued recognition events belong only to the visit
  // that started the recognizer.
  activeId = 'a';
  context.currentVisitAthenaBinding = bindingA;
  context.currentVisitAthenaEpoch = 5;
  patientLabel.value = 'Patient A';
  noteBox.value = soapA;
  assert.strictEqual(api.startDictation(null), true, 'safe patient-A dictation did not start');
  const oldRecognizer = recognizer;
  const result = [{ transcript: 'patient A confidential detail' }];
  result.isFinal = true;
  oldRecognizer.onresult({ resultIndex: 0, results: [result] });
  activeId = 'b';
  context.currentVisitAthenaBinding = bindingB;
  context.currentVisitAthenaEpoch = 6;
  patientLabel.value = 'Patient B';
  noteBox.value = soapB;
  assert.strictEqual(api.stopDictation(), '', 'stale dictation was reported as inserted');
  assert.strictEqual(noteBox.value, soapB, 'patient A dictation was inserted into patient B');
  oldRecognizer.onresult({ resultIndex: 0, results: [result] });
  assert.strictEqual(noteBox.value, soapB, 'queued recognition event mutated patient B after stop');

  // New Visit for the same patient is also a hard boundary: the patient id is
  // unchanged, but the visit epoch must invalidate the old dictation buffer.
  activeId = 'a';
  context.currentVisitAthenaBinding = bindingA;
  context.currentVisitAthenaEpoch = 7;
  patientLabel.value = 'Patient A';
  noteBox.value = soapA;
  assert.strictEqual(api.startDictation(null), true, 'same-patient epoch scenario did not start');
  const samePatientRecognizer = recognizer;
  samePatientRecognizer.onresult({ resultIndex: 0, results: [result] });
  context.currentVisitAthenaEpoch = 8;
  noteBox.value = 'SUBJECTIVE\nFresh visit for patient A.';
  assert.strictEqual(api.stopDictation(), '', 'old dictation crossed a same-patient New visit boundary');
  assert.strictEqual(noteBox.value, 'SUBJECTIVE\nFresh visit for patient A.', 'old dictation mutated the fresh same-patient visit');

  api.revert();
  assert(toasts.length >= 1, 'the guarded editor produced no user-facing status during the scenarios');
  console.log('PASS note editor binding: delayed section, locked-section restore, and dictation stay on one immutable visit');
}

main().catch(err => {
  console.error(err);
  process.exitCode = 1;
});
