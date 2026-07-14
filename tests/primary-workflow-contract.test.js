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
assert(connect.includes('Advanced visit workspace'), 'optional workspace must use the requested label');
assert(connect.includes('send-portal-invite.html') && connect.includes('Patient portal'), 'patient portal must be reachable from the primary patient area');

// Starting a patient/recording must not force the optional workspace open.
const startPatient = between(connect, 'function lockAndStart(a, opts)', 'function lockAndStartPatient(p)');
assert(!/advOpen|ez3adv|openWorkspace/.test(startPatient), 'starting a recording must not open the advanced workspace');

// Stop is a pause boundary, not Generate and not Discard. Resume starts from
// the current transcript, while clearing is isolated behind the discard flow.
const stopOnly = between(connect, 'function stopRecordingOnly()', '/* ---- send-to-Athena');
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
