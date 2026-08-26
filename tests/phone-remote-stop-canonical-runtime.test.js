'use strict';

/* The phone can render a stale non-recording snapshot while a segment, browser
 * recognizer, or paired phone microphone still owns capture. Remote Stop must
 * therefore call the idempotent canonical cleanup; it must not gate cleanup on
 * the UI-derived isRecording() answer. Execute the shipped remote method body
 * with isRecording wired to throw so this is causal, not only a text assertion.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const copies = ['mls-connect.js', '1p-mls-connect.js', 'cloned-mls-connect.js'];

copies.forEach((file) => {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const canonicalAt = source.indexOf('function stopRecordingOnly(fromLane)');
  assert(canonicalAt >= 0, file + ': canonical stopRecordingOnly is missing');

  const remoteAt = source.indexOf('stopRecording: function () {', canonicalAt);
  const generateAt = source.indexOf('\n      generate: function () {', remoteAt);
  assert(remoteAt > canonicalAt && generateAt > remoteAt,
    file + ': active Easy remote Stop method could not be isolated');

  const openBrace = source.indexOf('{', remoteAt);
  const methodBody = source.slice(openBrace + 1, generateAt).replace(/\n\s*\},\s*$/, '');
  assert(methodBody.includes('return stopRecordingOnly(false);'),
    file + ': remote Stop no longer routes to canonical cleanup');
  assert(!/if\s*\(\s*!\s*isRecording\(\)\s*\)/.test(methodBody),
    file + ': remote Stop still gates canonical cleanup on stale visible state');

  let cleanupCalls = 0;
  let cleanupArg = null;
  const remoteStop = new Function('stopRecordingOnly', 'isRecording',
    '"use strict"; return function () {' + methodBody + '\n};')(
    function (fromLane) {
      cleanupCalls++;
      cleanupArg = fromLane;
      return true;
    },
    function () {
      throw new Error('remote Stop consulted stale isRecording() state');
    }
  );

  assert.strictEqual(remoteStop(), true, file + ': remote Stop did not return canonical cleanup result');
  assert.strictEqual(cleanupCalls, 1, file + ': remote Stop did not invoke canonical cleanup exactly once');
  assert.strictEqual(cleanupArg, false, file + ': remote Stop used the lane-pill path instead of engine-stop cleanup');
});

console.log('PASS phone remote Stop: all shipped web copies invoke canonical cleanup even when visible recording state is stale');
