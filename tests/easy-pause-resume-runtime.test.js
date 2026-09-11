'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');
const doctorStart = source.indexOf('  function renderDoctor() {');
const stopEnd = source.indexOf('\n  /* ---- send-to-Athena', doctorStart);
assert(doctorStart >= 0 && stopEnd > doctorStart, 'canonical visit workflow missing');
const workflow = source.slice(doctorStart, stopEnd);

assert(workflow.includes('id="ez3Stop"'), 'recording state has no canonical Stop control');
assert(workflow.includes('id="ez3Rec2"'), 'stopped state has no canonical Resume control');
assert(workflow.includes("on('ez3Stop', function () { stopRecordingOnly(false); })"),
  'engine Stop is not wired explicitly to the canonical stop owner');
assert(workflow.includes("on('ez3Rec2', function () { if (!requireExactScheduledBinding(S.appt, 'recording')) return;"),
  'Resume does not preserve exact scheduled-patient binding');
assert(workflow.includes('function stopRecordingOnly(fromLane)') &&
       workflow.includes("window.__mlsStopAllCapture(fromLane ? 'lane-pill' : 'engine-stop')"),
  'Stop does not route through the real canonical recorder stop');
assert(workflow.includes("S.phase = 'stopped'") && workflow.includes('Everything captured is saved below'),
  'successful stop does not preserve transcript/resume state');

/* ==========================================================================
 * recmore-1.1.0  --  THE NOTE SCREEN'S RECORD DOOR
 * --------------------------------------------------------------------------
 * THE MEASURED HOLE. Every resting state of a visit kept a way back to the
 * microphone except one. The stopped screen keeps Resume recording
 * (#ez3Rec2), the empty screen keeps Start Recording (#ez3Rec) - but the
 * moment a note existed, renderDoctor's phase-'note' branch rendered a note
 * box, Edit, Regenerate, Copy, Sign and Send and NO record control, and the
 * flow lane's own pill hid itself too. MEASURED in the booted 1p app on the
 * note screen: #ez3Rec absent, #ez3Rec2 absent, #captureBtn hidden by the calm
 * shell, .ez3fl-recbtn hidden. Nowhere on the screen could a doctor who
 * remembered one more finding say it - they had to sign or leave the visit.
 *
 * THE CURE, AND WHY IT IS NOT A NEW BUTTON. recmore-1.0.0 added an "Add more
 * to this recording" chip to that branch inside a .ez3-row2, and MEASURED it
 * never reached the doctor either: feat_mls_visit_focus.js folds every
 * .ez3-row2 child in a locked visit behind "Visit shortcuts", which is exactly
 * where it folds #ez3Rec2 on the stopped screen. A door nobody can see is not
 * a door, and a second one beside a door that works is the "two controls for
 * one job" defect walkfix-1.0.0 already paid for. So the door is the lane's
 * OWN record pill - .ez3fl-recbtn, wired to toggleTopRecording, already on
 * recvis-1.0.0's watched list - kept on screen in one more state.
 *
 * WHAT THIS SECTION REFUSES TO LET REGRESS
 *   1. the pill survives the note state (the predicate is EXECUTED below over
 *      its whole truth table, so this is the shipped rule, not a description);
 *   2. b940 stays kept, not broken: on the idle screen with no transcript and
 *      no note the pill is still hidden, because the taught hero there says
 *      the same thing;
 *   3. the label is honest in every shape it can now appear in - Pause while
 *      live, Resume when a stopped session has transcript, Start when the
 *      visit was pasted or dictated elsewhere;
 *   4. the press is the ordinary toggleTopRecording, and #captureBtn and
 *      .ez3fl-recbtn are both still watched doors, so a silent start failure
 *      is still explained;
 *   5. the note branch of renderDoctor mints no record button of its own -
 *      one door, not two.
 *
 * It reads the CANONICAL source (1p-mls-connect.js); the production twin is
 * written from it by scripts/derive-production-from-1p.js.
 * ======================================================================== */
const src1p = fs.readFileSync(path.join(__dirname, '..', '1p-mls-connect.js'), 'utf8');
const doctorStart1p = src1p.indexOf('  function renderDoctor() {');
const stopEnd1p = src1p.indexOf('\n  /* ---- send-to-Athena', doctorStart1p);
assert(doctorStart1p >= 0 && stopEnd1p > doctorStart1p, 'canonical visit workflow missing from 1p-mls-connect.js');
const workflow1p = src1p.slice(doctorStart1p, stopEnd1p);

/* 5 -- ONE DOOR. The note branch renders no record control of its own. */
const noteBranchAt = workflow1p.indexOf("} else if (S.phase === 'note') {");
const idleBranchAt = workflow1p.indexOf("} else { /* idle / stopped */", noteBranchAt);
assert(noteBranchAt > 0 && idleBranchAt > noteBranchAt, 'the phase-note branch of renderDoctor is gone');
const noteBranch = workflow1p.slice(noteBranchAt, idleBranchAt);
assert(!/id="ez3Rec/.test(noteBranch),
  'the note screen mints a record button of its own again - it folds behind "Visit shortcuts" like every other .ez3-row2 chip, and it duplicates the lane pill that already works');
assert(!/id="ez3RecMore"/.test(src1p) && !/'ez3RecMore'/.test(src1p),
  '#ez3RecMore is back somewhere in the file - the door that measured display:none on the screen it was built for');

/* 4 -- the doors the recording-verdict lane watches. This is the PROPERTY,
       not the spelling: the pill and the node every other door presses both
       have to stay on the list, or a silent start explains nothing. */
const recSel = src1p.match(/var REC_START_SEL = '([^']*)'/);
assert(recSel, 'recvis-1.0.0 lost REC_START_SEL entirely');
for (const door of ['#captureBtn', '.ez3fl-recbtn']) {
  assert(recSel[1].indexOf(door) >= 0,
    'recvis-1.0.0 stopped watching ' + door + ' - a press through it would fail silently with nothing painted');
}
assert(/rb\.addEventListener\('click', toggleTopRecording\)/.test(src1p),
  'the lane record pill is no longer wired to toggleTopRecording, which is the press that runs the exact-patient check and the recvis refusals');

/* 1 + 2 -- THE PREDICATE, EXECUTED. Lifted out of the shipped file and run
   over its whole truth table, so these are the shipped bytes deciding. */
const predAt = src1p.indexOf('      var rbResumable = !!(text.trim() && _recSessionSeen);');
assert(predAt > 0, 'the lane pill visibility predicate is gone');
const predEndAt = src1p.indexOf(';', src1p.indexOf('setLaneHidden(rb,', predAt));
assert(predEndAt > predAt, 'the lane pill visibility predicate no longer ends in a setLaneHidden call');
const predicate = src1p.slice(predAt, predEndAt + 1);
assert(/noteText/.test(predicate),
  'the lane pill stopped consulting the note, so the note screen has no record door again (measured: every other door is absent or hidden there)');

function hiddenWhen(live, text, seen, noteText) {
  let got = null;
  const ctx = { live, text, _recSessionSeen: seen, noteText, rb: {}, setLaneHidden(el, v) { got = v; } };
  vm.createContext(ctx);
  vm.runInContext('(function () {' + predicate + '})()', ctx);
  assert(got !== null, 'the predicate did not decide the pill visibility at all');
  return !!got;
}
/* the note screen, in both shapes a doctor can arrive at it */
assert(hiddenWhen(false, 'recorded words', true, 'A NOTE') === false,
  'the record pill is hidden on the note screen after a real recording - the doctor cannot add one more finding');
assert(hiddenWhen(false, '', false, 'A NOTE') === false,
  'the record pill is hidden on the note screen of a pasted or dictated-elsewhere visit - the one shape with no session to resume');
/* b940 kept: idle with nothing captured and no note is still the hero's job */
assert(hiddenWhen(false, '', false, '') === true,
  'the record pill came back to the idle screen, where the taught hero already says Start recording (b940)');
assert(hiddenWhen(false, '   ', false, '   ') === true,
  'whitespace in the note box now counts as a note and re-opens the b940 duplicate');
/* the two states it always had */
assert(hiddenWhen(true, '', false, '') === false, 'the pill vanished while recording is live - there is no Pause');
assert(hiddenWhen(false, 'recorded words', true, '') === false,
  'a stopped session with transcript lost its Resume');

/* 3 -- the label, EXECUTED, in every shape the pill can now appear in. */
const labAt = src1p.indexOf("      var recordLabel = live ? 'Pause recording'");
assert(labAt > 0, 'the lane pill label is gone');
const labelLine = src1p.slice(labAt, src1p.indexOf(';', labAt) + 1);
function labelWhen(live, text, seen, pname) {
  const ctx = { live, text, _recSessionSeen: seen, pname, out: '' };
  vm.createContext(ctx);
  vm.runInContext('(function () {' + labelLine + ' out = recordLabel; })()', ctx);
  return ctx.out;
}
assert(labelWhen(true, 'x', true, 'Ada Sample') === 'Pause recording', 'a live recording stopped offering Pause');
assert(labelWhen(false, 'recorded words', true, 'Ada Sample') === 'Resume recording',
  'a stopped session with transcript stopped offering Resume');
assert(labelWhen(false, '', false, 'Ada Sample') === 'Start recording - Ada Sample',
  'the note screen of a pasted visit offers Resume for a session that never happened, or lost the patient name');
assert(labelWhen(false, '', false, '') === 'Start a visit recording',
  'with no patient name painted the pill lost its plain label');

/* ...and nothing a doctor reads on that pill is written in developer words. */
for (const word of ['bind', 'binding', 'probe', 'receipt', 'token', 'payload', 'manifest', 'catalog', 'hash']) {
  assert(!new RegExp('\\b' + word, 'i').test(labelLine),
    'the record pill says "' + word + '" to a doctor: ' + JSON.stringify(labelLine));
}

console.log('PASS Easy pause/resume: canonical exact-patient controls preserve the combined transcript');
console.log('  recmore-1.1.0: the note screen keeps a record door - the lane pill survives the note state, labelled honestly, wired to the one press');
