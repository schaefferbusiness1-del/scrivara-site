'use strict';
/*
 * ONE canonical stop (2026-07-28 owner order).
 *
 * "I should not have to click stop recording twice on two different buttons
 * in two different places." Before this, "stop" was split across layers that
 * did not agree: the lane pill stopped the segment/base recorder only, the
 * engine's Stop routed through a synthetic captureBtn click that the
 * stop-confirm wrapper turned into a modal (the second click), and an active
 * phone session was stoppable only from the pairing popup. mlsStopAllCapture
 * is now the single stop: segment/base recorder, phone engine, and dictation,
 * each branch independently guarded so it is safe when only one - or nothing -
 * is active.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

/* 1. The canonical stop exists and is exposed. */
const at = src.indexOf('function mlsStopAllCapture(');
assert(at > -1, 'mlsStopAllCapture is gone - the one canonical stop no longer exists');
assert(src.includes("window.__mlsStopAllCapture = mlsStopAllCapture"),
  'mlsStopAllCapture lost its window exposure; the engine copy cannot reach it');

/* 2. It stops every engine: segment/base, phone, dictation. */
const body = src.slice(at, src.indexOf('\n  function toggleTopRecording', at));
assert(/stopSegment/.test(body) && /window\.stopCapture/.test(body),
  'the canonical stop no longer reaches the segment/base recorder');
assert(/phoneMicCode/.test(body) && /stopPhoneMic/.test(body),
  'the canonical stop no longer reaches the phone engine (the guarded phoneMicCode + stopPhoneMic shape)');
assert(/__mlsDictateAnywhere/.test(body) && /isListening/.test(body),
  'the canonical stop no longer reaches dictation');

/* 3. Every stop surface routes through it. */
const sro = src.indexOf('function stopRecordingOnly()');
assert(sro > -1, 'stopRecordingOnly is gone');
const sroBody = src.slice(sro, sro + 1400);
assert(/__mlsStopAllCapture/.test(sroBody),
  'stopRecordingOnly no longer routes through the canonical stop');
assert(!/c\.click\(\); \/\* the existing safety confirmation remains the stop gate \*\//.test(sroBody),
  'stopRecordingOnly went back to the captureBtn click - that click re-opens the stop-confirm modal, the exact second click the owner ordered removed');

const disc = src.indexOf('function doDiscardRecording()');
assert(disc > -1, 'doDiscardRecording is gone');
assert(/__mlsStopAllCapture/.test(src.slice(disc, disc + 900)),
  'doDiscardRecording (active copy) no longer routes through the canonical stop - the stacked second popup returns');

assert(/mlsStopAllCapture\('lane-pill'\)/.test(src),
  'the lane pill no longer routes through the canonical stop');

/* 4. The phone engine counts as live on the lane pill, so its Stop is
 *    reachable from the primary control, not only the pairing popup. */
assert(/if \(!live && typeof phoneMicCode !== 'undefined' && phoneMicCode\) live = true;/.test(src),
  'syncTopLane no longer treats an active phone session as live - the pill would hide Stop while the phone streams');

console.log('PASS one canonical stop: every engine reachable, every surface routed, no captureBtn round-trip in stopRecordingOnly, phone session is live on the pill');
