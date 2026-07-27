'use strict';

/* ac-1.0.0 + tn-1.0.0 — the two claims in this pair that can rot silently.
 *
 * WHY THIS GATE EXISTS AT ALL
 * ---------------------------
 * Both of these features are about HONESTY, and dishonesty here is invisible:
 *
 *   1. Audio constraints. The obvious "improvement" is to turn noiseSuppression
 *      ON, because a cleaner recording sounds better in a demo. For AMBIENT
 *      multi-speaker capture it is the wrong call — the suppressor is tuned for
 *      one near talker over stationary noise and gates the soft, distant voice
 *      the note is actually made of. Nothing breaks if someone flips it; the
 *      recordings just quietly stop containing the patient. Arm 1 pins the
 *      choice AND the fact that the module never claims the constraints were
 *      applied: it reports MediaStreamTrack.getSettings(), which is what the
 *      device did, not what we asked for.
 *
 *   2. Speaker labels. The browser Web Speech API HAS NO DIARIZATION. A future
 *      edit that starts describing pause boundaries as speaker detection, or
 *      that drops the "this is a guess" header, converts a UI hint into a
 *      clinical assertion about who said what — inside a document that becomes
 *      part of a medical record. Arms 2-4 make that loud.
 *
 * BOTH DIRECTIONS PROVEN on the real tree before this gate was trusted:
 *   - arm 1 fails when ambient noiseSuppression is flipped to true
 *   - arm 3 fails when the header line is removed from render()
 *   - arm 4's control proves the raw text really is recoverable by mutating a
 *     label and re-reading raw()
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

/* ---------- 1. the ambient policy, and the refusal to claim it applied ---------- */
const capSrc = read('feat_mls_audio_capture.js');

function loadCapture() {
  const sandbox = { window: {}, navigator: {}, localStorage: {
    _d: {}, getItem(k) { return Object.prototype.hasOwnProperty.call(this._d, k) ? this._d[k] : null; },
    setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; }
  }, Date };
  sandbox.localStorage = sandbox.localStorage;
  vm.createContext(sandbox);
  vm.runInContext(capSrc, sandbox, { filename: 'feat_mls_audio_capture.js' });
  return sandbox.window.__mlsAudioCapture;
}
const cap = loadCapture();
assert(cap && cap.installed && cap.version === 'ac-1.0.0', 'the audio capture policy did not install');

const ambient = cap.constraints('ambient').audio;
assert.strictEqual(ambient.noiseSuppression, false,
  'AMBIENT capture turned noiseSuppression ON. Chrome\'s suppressor is trained on ONE near ' +
  'speaker over stationary noise; at the low SNR of a patient two or three metres away it ' +
  'classifies soft consonants and sentence tails AS noise and gates them. A cleaner file that ' +
  'has lost the patient\'s answer is worse than a noisy one that kept it. If this is being ' +
  'changed, change it with a measurement, not a preference.');
assert.strictEqual(ambient.echoCancellation, false,
  'AMBIENT capture turned echoCancellation ON. There is no loudspeaker output to cancel during ' +
  'a room recording, and AEC\'s residual suppressor still attenuates far-field speech it mistakes ' +
  'for echo.');
assert.strictEqual(ambient.autoGainControl, true,
  'AMBIENT capture turned autoGainControl OFF — it is the one constraint of the three that helps ' +
  'the distant, quiet talker rather than hurting them');
assert.strictEqual(ambient.channelCount, 1, 'ambient capture stopped asking for mono');

const close = cap.constraints('closetalk').audio;
assert.strictEqual(close.echoCancellation, true,
  'CLOSE-TALK dropped echoCancellation. This mode exists partly for the case where the app is ' +
  'SPEAKING (TTS) while a microphone is open; without AEC it hears itself.');
assert.strictEqual(close.noiseSuppression, true,
  'CLOSE-TALK dropped noiseSuppression — with the speaker close and the SNR high there is no ' +
  'soft distant voice left to protect, so the tradeoff reverses');

/* the honest limit must survive edits: nothing here may imply it moves the transcript */
const desc = cap.describe();
assert(/Live transcription/.test(desc.doesNotApplyTo) && /ignores these settings/.test(desc.doesNotApplyTo),
  'describe() no longer states that live transcription ignores these constraints. ' +
  'SpeechRecognition accepts no audio constraints and no deviceId — any surface built on this ' +
  'module would then imply a transcript improvement that does not exist.');
assert.strictEqual(cap.report(), null, 'report() invented a measurement before any capture happened');

/* deviceId must NOT be exact: an unplugged headset would make getUserMedia reject,
   turning "your device is gone" into "recording failed" */
cap.select('some-device-id');
const withDevice = cap.constraints('ambient').audio;
assert.strictEqual(withDevice.deviceId, 'some-device-id', 'a selected device is not being requested');
assert(typeof withDevice.deviceId === 'string',
  'deviceId became an {exact:...} constraint — an unplugged device then makes getUserMedia REJECT, ' +
  'so losing a headset would present as a failed recording instead of falling back to the default');
cap.select('');

/* ---------- 2. the turn engine claims no diarization ---------- */
const turnSrc = read('feat_mls_turn_labels.js');

function loadTurns() {
  const el = { value: '', className: '', parentNode: null, isConnected: true,
    dispatchEvent() {}, addEventListener() {}, setAttribute() {}, getAttribute() { return null; } };
  const doc = {
    readyState: 'complete', addEventListener() {},
    getElementById(id) { return id === 'transcript' ? el : null; },
    createElement() { return { style: {}, setAttribute() {}, addEventListener() {}, appendChild() {} }; },
    head: { appendChild() {} }, documentElement: { appendChild() {} }
  };
  const sandbox = { window: {}, document: doc, Date, MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; }, Event: function () {} };
  sandbox.window.document = doc;
  vm.createContext(sandbox);
  vm.runInContext(turnSrc, sandbox, { filename: 'feat_mls_turn_labels.js' });
  return { api: sandbox.window.__mlsTurns, el };
}

const { api: T, el: box } = loadTurns();
assert(T && T.installed && T.version === 'tn-1.1.0', 'the turn engine did not install');
assert.strictEqual(T.diarization, false,
  'the turn engine now advertises diarization. The browser Web Speech API performs NO speaker ' +
  'identification — there is no speaker field and no speaker confidence. Anything printing a ' +
  'name next to a line is guessing, and this flag is the machine-readable admission of that.');
assert.strictEqual(T.basis, 'pause',
  'the stated basis for a turn boundary changed. Wall-clock silence between final results is the ' +
  'ONLY signal available; if the basis is now something else, say what measured it.');

/* ---------- 3. turns are pause boundaries, labels are marked as assumed ------- */
const t0 = 1000000;
T.record('good morning what brings you in', t0);
T.record('my knee has been hurting for three weeks', t0 + 3000);   /* 3000ms gap -> new turn */
T.record('especially going down stairs', t0 + 3400);               /* 400ms gap  -> same turn */
T.record('lets take a look at that', t0 + 6000);                   /* new turn */

let list = T.turns();
assert.strictEqual(list.length, 3,
  'expected 3 pause-separated turns, got ' + list.length + ' — a 400ms breath must NOT split a ' +
  'turn and a 2.6s silence must');
assert(/three weeks especially going down stairs/.test(list[1].text),
  'the continuation fragment was not merged into its own turn');
assert(list.every((t) => t.basis === 'pause'), 'a turn record stopped carrying its basis');
assert(list.every((t) => t.assumed === true),
  'a label the doctor has never touched is not marked assumed — the UI and the note prompt both ' +
  'depend on that flag to avoid presenting a guess as a fact');
assert(list[0].gapMs === 0 && list[1].gapMs >= 1200,
  'the measured gap that produced the boundary is no longer recorded, so the basis cannot be audited');

const rendered = T.render();
assert(rendered.indexOf(T.header) === 0,
  'the labelled transcript no longer LEADS with the "these labels are a guess" header. That line ' +
  'is what keeps the labels honest inside the note-generation prompt and in front of the doctor.');
assert(/not voice recognition/.test(T.header),
  'the header stopped saying this is not voice recognition — which is the one thing a reader ' +
  'would otherwise assume');

/* ---------- 4. one tap re-anchors, and RAW IS ALWAYS RECOVERABLE ---------- */
const rawBefore = T.raw();
assert(!/Dr:|Patient:|\[Speaker labels/.test(rawBefore), 'raw() leaked a label into the unlabelled text');

assert(T.setLabel(0, 'Patient'), 'setLabel refused a valid correction');
list = T.turns();
assert.strictEqual(list[0].assumed, false, 'a corrected turn is still marked as a guess');
assert.strictEqual(list[1].label, 'Dr',
  'correcting turn 0 did not re-anchor the suggestions after it — one correction must fix ' +
  'everything downstream, or the doctor taps every line');
assert.strictEqual(list[1].assumed, true, 're-anchored suggestions must stay marked as guesses');

assert.strictEqual(T.raw(), rawBefore,
  'changing a label changed the RAW transcript. The unlabelled text is the clinical record of ' +
  'what was heard; it must be byte-identical no matter what the labels say.');

/* the box round-trip: apply then unapply restores exactly what was recorded */
const applyRes = T.apply();
assert(applyRes.ok, 'apply() refused on a stopped recorder: ' + applyRes.reason);
assert(box.value.indexOf(T.header) === 0, 'the applied transcript does not lead with the header');
assert(/Patient: good morning/.test(box.value), 'the applied transcript does not carry the corrected label');
const un = T.unapply();
assert(un.ok, 'unapply() failed: ' + un.reason);
assert.strictEqual(box.value, rawBefore,
  'unapply() did not restore the exact raw transcript — labelling must never be destructive');

/* ---------- 5. it must refuse to write while the recorder owns the box ------- */
/* ScribeFlow.html's onresult assigns (finalText + interim) over the whole value,
   and finalText is a top-level `let` that nothing outside that script can amend.
   A label written mid-capture is erased by the next result and reads as data loss. */
assert(/appCapturing\(\)\) return \{ ok: false/.test(turnSrc),
  'apply() no longer refuses while recording. finalText is a top-level `let` — NOT a window ' +
  'property — so the recogniser rebuilds the box from its own unlabelled accumulator and the ' +
  'labels vanish within one result, which a doctor reads as the app eating their transcript.');

/* ---------- 6. the note generator treats labels as hypotheses ---------- */
const html = read('ScribeFlow.html');
assert(/SPEAKER LABELS ARE UNVERIFIED HYPOTHESES, NOT FACTS/.test(html),
  'the note-generation prompt no longer tells the model that speaker labels are unverified');
assert(/CONTENT ALWAYS WINS/.test(html),
  'the prompt no longer instructs the model to prefer content over the label — a mislabelled line ' +
  'could then attribute a symptom or a decision to the wrong person inside a medical record');

/* ---------- 7. the engine owns no recognizer and no lease ---------- */
function stripComments(s) {
  return String(s).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const turnCode = stripComments(turnSrc);
assert(!/new\s+(?:SR|SRC|Ctor|C)\s*\(/.test(turnCode) && !/getUserMedia/.test(turnCode),
  'the turn engine constructs a recognizer or opens a microphone — it must only OBSERVE the visit ' +
  'recorder through an additive result listener, or it becomes a microphone owner outside the truce');
assert(!/\.claim\(/.test(turnCode), 'the turn engine claims a microphone lease it has no business holding');

console.log('PASS capture and turns are honest: ambient policy is NS/AEC off + AGC on with getSettings receipts (not claims), turns are pause boundaries marked assumed, the raw transcript survives labelling byte-for-byte, and the note prompt treats labels as hypotheses');
