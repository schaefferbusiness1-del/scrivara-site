'use strict';

/* txm-1.0.0 — the visit transcript mirrors must never erase live dictation.
 *
 * Both visit shells show the doctor a MIRROR of the real #transcript, and both
 * deliberately skip the hidden->visible copy while the caret is in the mirror
 * so typing never yanks the caret. That left the mirror stale by exactly the
 * words recognised since focus — and both shells then wrote the stale mirror
 * back over #transcript on the next keystroke, which also rewound finalText, so
 * the recogniser rebuilt from the truncated prefix. Measured on the live b581
 * page: six spoken words destroyed by a single keystroke, unrecoverably.
 *
 * This test runs the SHIPPED helper (extracted from mls-connect.js, not a
 * copy) against that exact scenario, and pins both call sites so a future edit
 * cannot quietly restore the clobber. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

/* ---------- load the real helper ---------- */
const marker = source.indexOf('/* ===== txm-1.0.0');
assert(marker > -1, 'the shared transcript-mirror helper (txm-1.0.0) is missing');
const start = source.indexOf(';(function () {', marker);
const end = source.indexOf('})();', start);
assert(start > marker && end > start, 'txm-1.0.0 helper block could not be delimited');
const helperSrc = source.slice(start, end + 5);

function makeEl(value) {
  return {
    value: value == null ? '' : String(value),
    selectionStart: 0,
    selectionEnd: 0,
    scrollTop: 0,
    setSelectionRange(s, e) { this.selectionStart = s; this.selectionEnd = e; }
  };
}

const sandbox = { window: {}, document: { activeElement: null } };
sandbox.window.document = sandbox.document;
vm.createContext(sandbox);
vm.runInContext(helperSrc, sandbox);
const M = sandbox.window.__mlsTxMirror;
assert(M && M.version === 'txm-1.0.0', 'txm-1.0.0 helper did not install');

/* ---------- 1. THE DEFECT: a keystroke must not destroy recognised speech ---------- */
const mirror = makeEl('Patient reports left knee pain');
M.setBase(mirror, 'Patient reports left knee pain');
const real = 'Patient reports left knee pain worse on stairs for three weeks';
const typed = 'Patient reports left knee pain.';
const merged = M.merge(mirror, typed, real);
assert(/worse on stairs for three weeks/.test(merged),
  'a keystroke in the mirror still destroys speech recognised while it was focused');
assert(merged.indexOf('Patient reports left knee pain.') === 0,
  "the doctor's own edit must survive the merge, and stay first");
assert.strictEqual(merged, 'Patient reports left knee pain. worse on stairs for three weeks');

/* ---------- 2. no duplicated text when the mirror already took the append ---------- */
const live = makeEl('one two three');
M.setBase(live, 'one two');
assert.strictEqual(M.merge(live, 'one two three', 'one two three'), 'one two three',
  'merge duplicated a tail the mirror had already shown');
const seen = makeEl('');
M.setBase(seen, 'one two');
assert.strictEqual(M.merge(seen, 'one two three edited', 'one two three'), 'one two three edited',
  'merge re-appended a tail the typed value already contained');

/* ---------- 3. unknown relationship => pre-txm behaviour, never a guess ---------- */
const noBase = makeEl('anything');
assert.strictEqual(M.merge(noBase, 'doctor text', 'unrelated real text'), 'doctor text',
  'merge invented a merge with no established baseline');

/* ---------- 4. a clear/replace of the real box must not resurrect deleted text ---------- */
const cleared = makeEl('gone');
M.setBase(cleared, 'hello world');
assert.strictEqual(M.merge(cleared, 'fresh', ''), 'fresh', 'a cleared transcript was resurrected');
assert.strictEqual(M.merge(cleared, 'fresh', 'goodbye'), 'fresh',
  'a replaced (non-append) transcript was treated as an append');

/* ---------- 5. the recogniser trims, so a trailing-space baseline must still match ---------- */
const trimmed = makeEl('abc');
M.setBase(trimmed, 'abc ');
assert.strictEqual(M.merge(trimmed, 'abc!', 'abc def'), 'abc! def',
  'a baseline with trailing whitespace defeated the tail carry');

/* ---------- 6. set() must not move the caret or the scroll position ---------- */
const focused = makeEl('one two');
focused.selectionStart = 4; focused.selectionEnd = 4; focused.scrollTop = 120;
sandbox.document.activeElement = focused;
M.set(focused, 'one two three');
assert.strictEqual(focused.value, 'one two three', 'set() did not apply the append');
assert.strictEqual(focused.selectionStart, 4, 'set() moved the caret out from under the doctor');
assert.strictEqual(focused.selectionEnd, 4, 'set() moved the selection end');
assert.strictEqual(focused.scrollTop, 120, 'set() reset the scroll position mid-edit');
assert.strictEqual(M.baseOf(focused), 'one two three', 'set() did not advance the baseline');
sandbox.document.activeElement = null;

/* ---------- 7. both call sites must route through the helper ---------- */
const flowStart = source.indexOf('  function syncRealTranscript(value) {');
assert(flowStart > -1, 'the ez3fl lane transcript sync is missing');
const flow = source.slice(flowStart, flowStart + 1200);
assert(!/\n    tx\.value = value;/.test(flow),
  'the ez3fl lane writes the stale mirror straight over the real transcript again');
assert(/mirror\.merge\(topMirror, value, tx\.value \|\| ''\)/.test(flow),
  'the ez3fl lane no longer merges before writing the real transcript');
assert(/finalText = merged \? merged \+ ' ' : ''/.test(flow),
  'finalText is still rewound to the unmerged value, which makes the loss permanent');

const laneSync = source.slice(source.indexOf('function syncTopLane(rec) {'));
assert(!/document\.activeElement !== topTx && topTx\.value !== text\) topTx\.value = text;/.test(laneSync),
  'the ez3fl mirror sync reverted to the freeze-while-focused copy');
assert(/txMirror\.set\(topTx, text\)/.test(laneSync),
  'the ez3fl mirror no longer takes caret-safe appends during dictation');

const doctorStart = source.indexOf("    var txTop = $('ez3Transcript'), txReal = $('transcript');");
assert(doctorStart > -1, 'the doctor-room transcript mirror is missing');
const doctor = source.slice(doctorStart, doctorStart + 1400);
assert(!/txReal\.value = txTop\.value;/.test(doctor),
  'the doctor room writes the stale mirror straight over the real transcript again');
assert(/mirror\.merge\(txTop, txTop\.value, txReal\.value \|\| ''\)/.test(doctor),
  'the doctor room no longer merges before writing the real transcript');

console.log('PASS transcript mirror merge: a keystroke cannot erase speech recognised while the box was focused (2 shells, caret and scroll preserved)');
