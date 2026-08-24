'use strict';

/* The live failure was a split transition: the top Pause stopped capture but
 * left Easy in `rec`, while the calm shell kept its old heads-down hint/timer.
 * These are intentionally source-level causal checks against the authoritative
 * 1p owner and its shared asset; they protect the seams without booting a
 * recorder or touching a signed-in Athena session. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const calm = fs.readFileSync(path.join(root, 'feat_mls_calm_shell.js'), 'utf8');

const topStart = connect.indexOf('function toggleTopRecording()');
const topEnd = connect.indexOf('\n  function generateTopNote()', topStart);
assert(topStart >= 0 && topEnd > topStart, 'top recording lane is missing');
const top = connect.slice(topStart, topEnd);
assert(/window\.__mlsStopEasyRecording/.test(top),
  'a single top Pause still bypasses the Easy phase owner');
assert(/else\s*\{[\s\S]*mlsStopAllCapture\('lane-pill'\)/.test(top),
  'top Pause lost its guarded low-level fallback');

const stopStart = connect.indexOf('function stopRecordingOnly(');
const stopEnd = connect.indexOf('\n  cleanup.push(function () { if (stopIv)', stopStart);
assert(stopStart >= 0 && stopEnd > stopStart, 'canonical Easy stop is missing');
const stop = connect.slice(stopStart, stopEnd);
assert(/function stopRecordingOnly\(fromLane\)/.test(stop),
  'Easy stop does not accept the lane transition without recursing through remote.stopRecording');
assert(/__mlsStopAllCapture\(fromLane \? 'lane-pill' : 'engine-stop'\)/.test(stop),
  'single Easy stop does not reach the canonical low-level capture stop');
assert(!/if \(!isRecording\(\)\) \{[\s\S]{0,180}return/.test(stop),
  'second Stop can return before cleaning a still-armed segment/phone/dictation engine');
assert(/S\.phase = 'stopped'/.test(stop) && /return true/.test(stop),
  'one Pause does not settle Easy into stopped state');
assert(/var easyStopBridge = function \(reason\)/.test(stop) &&
       /window\.__mlsStopEasyRecording = easyStopBridge/.test(stop),
  'the top lane has no idempotent Easy stop bridge');

const clearStart = calm.indexOf('function clearHeadsDown()');
const wakeStart = calm.indexOf('function wake()', clearStart);
assert(clearStart >= 0 && wakeStart > clearStart, 'calm-shell heads-down clear helper is missing');
const clear = calm.slice(clearStart, wakeStart);
assert(/classList\.remove\('mls-headsdown'\)/.test(clear) &&
       /clearTimeout\(idleTimer\)/.test(clear) &&
       /mlsHeadsDownHint/.test(clear) && /removeChild\(hint\)/.test(clear),
  'clearing heads-down does not remove its class, timer, and stale hint');
const clickStart = calm.indexOf('function onDocumentClick(e)');
const clickEnd = calm.indexOf('\n  function observeRoot', clickStart);
assert(clickStart >= 0 && clickEnd > clickStart, 'calm-shell document click handler is missing');
const click = calm.slice(clickStart, clickEnd);
assert(/#ez3Stop,#captureBtn,\.ez3fl-recbtn/.test(click) &&
       /isStopClick/.test(click) && /if \(isStopClick\) clearHeadsDown\(\)/.test(click),
  'real Pause/Stop clicks do not clear stale calm-shell state');
assert(/else wake\(\)/.test(click),
  'ordinary clicks lost the existing calm-shell wake/re-arm behavior');
const headsDownStart = calm.indexOf('function captureActuallyRecording()');
const headsDownEnd = calm.indexOf('\n  function ensureStages()', headsDownStart);
assert(headsDownStart >= 0 && headsDownEnd > headsDownStart,
  'calm-shell has no active-capture predicate separate from stage progress');
const activeCapture = calm.slice(headsDownStart, headsDownEnd);
assert(/Pause|stop/.test(activeCapture) && /captureBtn/.test(activeCapture) &&
       /classList\.contains\('recording'\)/.test(activeCapture),
  'active-capture predicate does not use visible Pause/Stop and recorder evidence');
const headsDown = calm.slice(calm.indexOf('function wake()', headsDownStart),
  calm.indexOf('/* --------------------------------------------------------------- activity */', headsDownStart));
assert(/stageNow\(\) !== 1 \|\| !captureActuallyRecording\(\)/.test(headsDown) &&
       /stageNow\(\) === 1 && captureActuallyRecording\(\)/.test(headsDown),
  'heads-down timer can still arm from the stopped Resume state');

console.log('PASS stop/wake causal contract: single Pause settles Easy, repeat stop is idempotent, and Stop clears heads-down hint/timer');
