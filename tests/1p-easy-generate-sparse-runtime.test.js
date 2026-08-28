'use strict';

/* Causal regression for facade ownership. The visible Easy control delegates
 * exactly once and never claims started/refused itself; the shipped engine is
 * the only lifecycle owner (fully executed in generate-note-lifecycle). */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', '1p-mls-connect.js'), 'utf8');
const shellSource = fs.readFileSync(path.join(__dirname, '..', '1pScribeFlow.html'), 'utf8');

function between(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, `missing shipped span ${startMarker}`);
  return text.slice(start, end);
}

function extractFunction(text, marker) {
  const at = text.indexOf(marker);
  assert(at >= 0, 'missing shipped function: ' + marker);
  const open = text.indexOf('{', at);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(at, i + 1);
  }
  throw new Error('unbalanced shipped function: ' + marker);
}

const marker = "on('ez3Gen', function () {";
const start = source.indexOf(marker);
assert(start >= 0, 'canonical Easy Visit ez3Gen handler is missing');
const fnStart = source.indexOf('function () {', start);
let depth = 0, quote = '', escaped = false, end = -1;
for (let i = fnStart + 'function '.length; i < source.length; i += 1) {
  const ch = source[i];
  if (quote) {
    if (escaped) escaped = false;
    else if (ch === '\\') escaped = true;
    else if (ch === quote) quote = '';
    continue;
  }
  if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
  if (ch === '{') depth += 1;
  else if (ch === '}' && --depth === 0) { end = i + 1; break; }
}
assert(end > fnStart, 'canonical ez3Gen handler is unbalanced');

let clicked = 0, renders = 0;
const transcript = { value: 'the patient is idne' };
const hiddenGenerate = { click() { clicked += 1; } };
const sandbox = {
  S: { appt: { id: 'appt-1' }, phase: 'idle', genClickedAt: 0, signedAt: 0, lastWarn: '' },
  $: id => id === 'transcript' ? transcript : (id === 'genBtn' ? hiddenGenerate : null),
  toast: () => { throw new Error('non-empty facade path must not diagnose generation'); },
  requireExactScheduledBinding: () => true,
  genBtnResolve: () => hiddenGenerate,
  render: () => { renders += 1; },
  Date
};
vm.runInNewContext('this.handler = ' + source.slice(fnStart, end), sandbox, { filename: '1p-mls-connect.js' });
sandbox.handler();

assert.strictEqual(clicked, 1, 'visible facade did not delegate exactly once to the hidden engine');
assert.strictEqual(sandbox.S.genClickedAt, 0, 'visible facade stamped a generation start before engine evidence checks');
assert.strictEqual(sandbox.S.phase, 'idle', 'visible facade changed generation phase before an engine event');
assert.strictEqual(transcript.value, 'the patient is idne', 'sparse click altered the transcript');
assert.strictEqual(sandbox.S.lastWarn, '', 'visible facade invented a refusal/connection diagnosis');
assert.strictEqual(renders, 1, 'visible facade did not repaint after engine delegation');
assert(!source.includes('noteGenerationStarted: function ()'), 'legacy facade lifecycle owner still ships');

const exactRefusal = 'Add one specific detail from today—symptom, exam finding, assessment, or plan—before generating. Nothing from old chart history will be invented.';
const lifecycleSandbox = {
  S: { phase: 'idle', genClickedAt: 0, signedAt: 0, lastWarn: '', generationRunId: 0 },
  isRecording: () => false,
  noteText: () => '',
  $: () => ({ disabled: false }),
  bindingNotice() {},
  render() {},
  Date, Number, String
};
vm.runInNewContext([
  extractFunction(source, 'function computePhase()'),
  extractFunction(source, 'function onGenerationStarted(ev)'),
  extractFunction(source, 'function onGenerationRefused(ev)'),
  extractFunction(source, 'function onGenerationSettled(ev)'),
  'this.api={computePhase,onGenerationStarted,onGenerationRefused,onGenerationSettled};'
].join('\n'), lifecycleSandbox, { filename: '1p-easy-generation-lifecycle.js' });
lifecycleSandbox.api.onGenerationRefused({ detail: { runId: 7, code: 'sparse-today-evidence', message: exactRefusal } });
lifecycleSandbox.api.onGenerationSettled({ detail: { runId: 7, status: 'refused', code: 'sparse-today-evidence', message: exactRefusal } });
lifecycleSandbox.api.computePhase();
assert.strictEqual(lifecycleSandbox.S.genClickedAt, 0, 'engine refusal retained a fake in-flight timestamp');
assert.strictEqual(lifecycleSandbox.S.phase, 'stopped', 'engine refusal did not leave the visible control retryable');
assert.strictEqual(lifecycleSandbox.S.lastWarn, exactRefusal, 'phase fallback replaced the exact refusal');
assert(!lifecycleSandbox.S.lastWarn.includes('connection'), 'phase fallback invented a connection failure');

/* Two shipped indirect Generate paths used to pre-stamp genClickedAt/phase.
 * If the hidden engine threw before emitting any lifecycle event, computePhase
 * later fabricated a connection warning. A click with no engine event now owns
 * no generation state at all. */
const lockAndStartSource = between(source, 'function lockAndStart(a, opts)', '\n  function lockAndStartPatient(');
let lockRenders = 0;
/* liftbusy-1.0.0 (2026-08-28): this sandbox stubbed isRecording and nothing
   else, but lockAndStart now asks captureBusy(), which is isRecording() OR a
   direct-phone capture in starting/recording/stopping. The lift was never
   updated, so every run died on "ReferenceError: captureBusy is not defined"
   BEFORE reaching the assertion below - the suite has been red on main and, far
   worse, its real check has not executed since the engine gained that call.
   captureBusy is lifted REAL, not stubbed: the thing under test is whether
   lockAndStart refuses to fabricate generation state, and the recording guard
   is part of how it decides. Only its leaf dependency, the direct-phone bridge,
   is faked - and it is faked as a value, so both branches stay reachable. */
const captureBusySource = between(source, '  function directCaptureStatus()', '\n  function noteText()');
assert(/function captureBusy\(\)/.test(captureBusySource),
  'captureBusy is no longer adjacent to directCaptureStatus - re-derive this lift rather than stubbing the recording guard away');
let lockDirectStatus = '';
const lockSandbox = {
  S: { appt: null, locked: null, editing: false, genClickedAt: 0, signedAt: 0, lastWarn: '', phase: 'idle' },
  isRecording: () => false,
  window: {
    get __mlsDirectPhoneCapture() { return { state: () => ({ status: lockDirectStatus }) }; },
    /* The engine gained a STRUCTURED activation contract after this suite was
       written: a scheduled row is only opened when calStartVisit returns an
       object saying ok, and a legacy truthy/undefined return is treated as
       failure so a same-demographics prior encounter can never be reused. With
       no calStartVisit at all, lockAndStart correctly refuses and never reaches
       the generate click - which is why this harness could not exercise its own
       subject once that guard landed. Model a clean bound activation, which is
       the state this test's question ("does a throwing engine click leave
       fabricated generation state behind?") presupposes. */
    calStartVisit: () => ({ ok: true, bound: true, patientId: 'pt-synthetic' })
  },
  isFn: (f) => typeof f === 'function',
  safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
  canonicalActivePatient: () => ({ id: 'pt-synthetic', name: 'Synthetic Person', dob: '01/01/1980' }),
  dobConflicts: () => false,
  captureBtn: () => null,
  requireExactScheduledBinding: () => true,
  lockPatient() {},
  setEasyMode() {},
  activeName: () => 'Synthetic Person',
  nameMatch: () => true,
  installScheduledVisitBinding: () => true,
  exactScheduledBindingMatches: () => true,
  scheduledAppointmentId: () => 'synthetic-appointment',
  genBtnResolve: () => ({ click() { throw new Error('synthetic engine throw before lifecycle'); } }),
  render: () => { lockRenders += 1; },
  setTimeout,
  Date
};
vm.runInNewContext(captureBusySource + '\n' + lockAndStartSource + '\nthis.runLockAndStart=lockAndStart;this.captureBusy=captureBusy;',
  lockSandbox, { filename: '1p-lock-and-start-generate.js' });

/* The lifted guard must really be the guard, or the assertions below pass
   against a stub that always says "not recording". */
assert.strictEqual(lockSandbox.captureBusy(), false, 'the lifted recording guard reports busy with nothing recording');
for (const status of ['starting', 'recording', 'stopping']) {
  lockDirectStatus = status;
  assert.strictEqual(lockSandbox.captureBusy(), true,
    'the lifted recording guard does not treat a direct-phone capture in "' + status + '" as busy - that is the branch this lift exists to cover');
}
lockDirectStatus = '';

assert.throws(() => lockSandbox.runLockAndStart({ id: 'synthetic-appointment', name: 'Synthetic Person' }, { generate: true }), /synthetic engine throw/);
assert.strictEqual(lockSandbox.S.genClickedAt, 0, 'lockAndStart fabricated an in-flight generation without an engine event');
assert.strictEqual(lockSandbox.S.phase, 'idle', 'lockAndStart fabricated a generation phase without an engine event');
assert.strictEqual(lockSandbox.S.lastWarn, '', 'lockAndStart fabricated a connection/refusal diagnosis');
assert.strictEqual(lockRenders, 0, 'throwing engine path rendered fabricated lifecycle state');

const autoAdvanceSource = between(source, '(function installAutoAdvance() {', '\n  function wireVisitQuickTools()');
const queuedTimers = [];
let autoRenders = 0, autoToasts = 0;
const autoTranscript = { value: 'one two three four five six seven eight nine ten eleven twelve' };
const autoSandbox = {
  window: null,
  S: { appt: { id: 'synthetic-appointment' }, phase: 'idle', genClickedAt: 0, signedAt: 0, lastWarn: '', _discarding: false },
  isFn: value => typeof value === 'function',
  setTimeout(fn) { queuedTimers.push(fn); return queuedTimers.length; },
  localStorage: { getItem: () => '1' },
  uns: value => value,
  document: { getElementById: id => id === 'transcript' ? autoTranscript : null },
  requireExactScheduledBinding: () => true,
  genBtnResolve: () => ({ click() { throw new Error('synthetic engine throw before lifecycle'); } }),
  toast: () => { autoToasts += 1; },
  render: () => { autoRenders += 1; }
};
autoSandbox.window = autoSandbox;
autoSandbox.stopCapture = () => true;
vm.runInNewContext(autoAdvanceSource, autoSandbox, { filename: '1p-auto-generate-after-stop.js' });
autoSandbox.stopCapture();
assert.strictEqual(queuedTimers.length, 1, 'auto-generate did not schedule its shipped post-stop dispatch');
queuedTimers.shift()();
assert.strictEqual(autoSandbox.S.genClickedAt, 0, 'auto-generate fabricated an in-flight timestamp without an engine event');
assert.strictEqual(autoSandbox.S.phase, 'idle', 'auto-generate fabricated a generation phase without an engine event');
assert.strictEqual(autoSandbox.S.lastWarn, '', 'auto-generate fabricated a connection/refusal diagnosis');
assert.strictEqual(autoRenders, 0, 'auto-generate rendered fabricated lifecycle state');
assert.strictEqual(autoToasts, 0, 'auto-generate claimed generation before the engine accepted it');

console.log('PASS 1p-easy-generate-sparse-runtime: visible and indirect facades delegate without fabricating lifecycle state');
