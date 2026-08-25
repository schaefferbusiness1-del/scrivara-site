'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const app = read('ScribeFlow.html');
const connect = read('mls-connect.js');
const segments = read('feat_mls_recording_segments.js');
const dictate = read('feat_mls_dictate_anywhere.js');
const voice = read('feat_mls_copilot_voice_v2.js');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert(a >= 0, `missing source marker: ${start}`);
  const b = source.indexOf(end, a + start.length);
  assert(b > a, `missing source end marker: ${end}`);
  return source.slice(a, b);
}

// The primary doctor surface owns the complete visit workflow. The optional
// workspace must not be required for transcript entry, pause/resume, or note
// generation.
const doctor = between(connect, 'function renderDoctor()', 'function syncTx()');
assert(doctor.includes('id="ez3Transcript"'), 'primary visit surface needs an editable transcript');
assert(doctor.includes('Stop recording'), 'primary visit surface needs an explicit stop action');
assert(doctor.includes('Resume recording'), 'primary visit surface needs an explicit resume action');
assert(doctor.includes('Generate one note'), 'primary visit surface needs note generation');
assert(doctor.includes('Every recording segment is combined'), 'primary surface must explain segment merging');
assert(doctor.indexOf('id="ez3Transcript"') < doctor.lastIndexOf('advRowHtml()'), 'primary transcript must appear before the optional workspace control');

/* THE ADVANCED VISIT WORKSPACE IS RETIRED — owner, 2026-07-26, verbatim:
 *   "get rid of and completely rework the advanced visit workspace from
 *    scratch and make sure the op notes button is easily accessible."
 *
 * This line used to read:
 *   assert(connect.includes('Advanced visit workspace'),
 *          'optional workspace must use the requested label')
 * i.e. it required the label to EXIST. It is inverted rather than deleted,
 * because the requirement genuinely reversed and the reversal is the point:
 * the door is gone, and what it hid now arrives on state.
 *
 * The two builders still exist in this file and are still wired — retiring a
 * door is a presentation change, and leaving the machinery reachable is what
 * keeps revert() a single call. What must be true is that NO DOCTOR CAN SEE
 * ONE, which is a property of feat_mls_visit_focus.js, so that is where this
 * asserts. MEASURED on the running page at b681+vf-1.1.0: both doors compute
 * 0x0 in every visit state, and #noteCard surfaces at 390x4200 the moment a
 * real note exists, with #pushAllEmrBtn inside it 5/5 reachable by real mouse. */
{
  const focus = fs.readFileSync(path.join(root, 'feat_mls_visit_focus.js'), 'utf8');
  assert(/#visitView #mlsEz3 \.ez3fl-openws,[\s\S]{0,120}?#visitView #mlsEz3 \.ez3-advrow\{display:none!important\}/.test(focus),
    'the Advanced visit workspace door is back on the surface. Both builders — ' +
    'the flow-lane .ez3fl-openws (which feat_athena_tooltip_dedupe adopts as the ' +
    'single owner) and its .ez3-advrow duplicate — must be class-hidden.');
  assert(focus.includes("var NOTE = 'mls-note-live'") &&
         focus.includes("+ NOTE + ' #visitView #noteCard{display:block!important}'"),
    'the note no longer surfaces on state. Retiring the door without replacing ' +
    'it with the state that opens the note would DELETE the note editor, not ' +
    'declutter it.');
}
assert(!connect.includes('send-portal-invite.html'), 'primary workflow still opens the retired synthetic portal sender');
assert(connect.includes('id="ez3Portal"') && connect.includes("var button = $('mlsPortalInviteBtn')"), 'primary patient area must delegate to the one exact-active-patient portal owner');

// Starting a patient/recording must not force the optional workspace open.
const startPatient = between(connect, 'function lockAndStart(a, opts)', 'function lockAndStartPatient(p)');
assert(!/advOpen|ez3adv|openWorkspace/.test(startPatient), 'starting a recording must not open the advanced workspace');

// Stop is a pause boundary, not Generate and not Discard. Resume starts from
// the current transcript, while clearing is isolated behind the discard flow.
// The canonical stop now receives the lane-origin flag so the top Pause can
// settle Easy without re-entering the engine confirmation path. Keep the
// exact signature here; the dedicated stop tests cover the same seam's
// routing and idempotence in more detail.
const stopOnly = between(connect, 'function stopRecordingOnly(fromLane)', '/* ---- send-to-Athena');
assert(!/genBtn|generateNote|\.value\s*=\s*['"]{2}/.test(stopOnly), 'stop must not generate or clear the visit');
assert(/transcript stays intact|Everything captured is saved/.test(stopOnly), 'stop flow must preserve the transcript');
const startCapture = between(app, 'function startCapture()', 'function stopCapture()');
assert(startCapture.includes("document.getElementById('transcript').value"), 'resume must seed recognition from the existing transcript');
assert(segments.includes('MULTIPLE labeled recording segments per visit'), 'segment module must support multiple recording spans');
assert(segments.includes('startSegment') && segments.includes('stopSegment'), 'segment module must expose start/stop boundaries');

// Dictate and Copilot Voice are distinct controls that coordinate microphone
// ownership instead of competing for the same SpeechRecognition instance.
assert(app.includes('function mlsSpeechHub()'), 'shared microphone coordinator is required');
assert(dictate.includes("register('dictate', 'Dictate'"), 'Dictate must have its own microphone identity');
assert(dictate.includes('persistent bottom dock'), 'Dictate must remain available across text fields');
assert(voice.includes("register('copilot', 'MLS Copilot Voice'"), 'Copilot Voice must remain distinct from Dictate');
assert(voice.includes('start recording') && voice.includes('stop recording') && voice.includes('generate the note'), 'Copilot Voice needs core visit commands');

// The primary UI is honest about where chart content would go. Structured
// destinations are plans/review items, not automatic writes.
assert(app.includes('var ATHENA_SECTIONS='), 'Athena destination map must be visible in app logic');
assert(app.includes('Manual Athena entry plan'), 'route preview must be shown to the user');
assert(app.includes('Nothing was written, saved, signed, submitted, ordered, or billed.'), 'route preview must state that no Athena action occurred');
assert(app.includes('function getAutoSendEMR(){ return false; }'), 'automatic EMR send must remain disabled');

console.log('PASS primary workflow: top transcript, pause/resume, one-note generation, distinct voice controls, visible route plan');
