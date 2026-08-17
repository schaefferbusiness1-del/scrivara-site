'use strict';

/*
 * A DEAD FEED IS NOT A DIM ROOM (owner report, 2026-08-16 — the second time)
 * =========================================================================
 * The owner sat looking at a black camera preview being told "The picture is
 * too dark — turn a light on, or face a window." It was not a lighting
 * problem. The compositor surface had died and no lamp would have fixed it.
 *
 * 1p-feat_mls_avatar.js already documents the discrimination that makes the
 * two distinguishable, at faceLiveLoopStart: "a real dark room reads 5-40, a
 * dead surface reads a flat 0". But two separate places tested luminance and
 * only one of them knew that. The live loop's black-feed witness fired at
 * <= 0.8; the quality hint fired at < 45 and blamed the room — and the hint
 * fires every tick, immediately, while the witness deliberately waits 1.5s
 * and stays silent on its first report so a re-attach can work unseen. So the
 * wrong diagnosis always won the race, and always will unless the two numbers
 * agree.
 *
 * They cannot share a variable: 1p-avatar-face-likeness-runtime slices
 * faceCaptureVerdict out of the file and evaluates it alone, so a constant
 * declared outside that function is not in scope. Both sites therefore carry
 * the literal, and THIS test is what keeps them equal. If you change one,
 * change the other.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_avatar.js'), 'utf8');

/* The quality hint's copy, inside faceCaptureVerdict. */
const hintMatch = source.match(/var DEAD_FEED_EXPOSURE = ([\d.]+);/);
assert(hintMatch, 'faceCaptureVerdict no longer declares DEAD_FEED_EXPOSURE — the black-feed hint has been removed or renamed');
const hintValue = Number(hintMatch[1]);

/* The live loop's copy. */
const loopMatch = source.match(/var DARK_TICKS = \d+, DARK_EXPOSURE = ([\d.]+);/);
assert(loopMatch, 'faceLiveLoopStart no longer declares DARK_EXPOSURE — the black-feed witness has been removed or renamed');
const loopValue = Number(loopMatch[1]);

assert.strictEqual(hintValue, loopValue,
  'the black-feed threshold drifted: faceCaptureVerdict says ' + hintValue + ' and faceLiveLoopStart says ' + loopValue +
  '. When they disagree the doctor is told the wrong cause for a black camera — which is the exact defect this pins.');

/* It must sit in dead-surface territory, not dim-room territory. A dim room
   reads 5-40; a threshold anywhere near that would blame the compositor for
   an evening consult. */
assert(hintValue > 0 && hintValue < 5,
  'the black-feed threshold (' + hintValue + ') is not in dead-surface territory. A real dark room reads 5-40, so a ' +
  'threshold at or above that would report a dim room as a dead camera and send the doctor to restart hardware that is fine.');

/* The dim-room advice must still exist, and must be reachable only ABOVE the
   dead-feed threshold — otherwise the black feed gets the lamp advice again. */
const hintBlock = source.slice(source.indexOf('var DEAD_FEED_EXPOSURE'), source.indexOf('var DEAD_FEED_EXPOSURE') + 900);
assert(/q\.exposure <= DEAD_FEED_EXPOSURE[\s\S]*?went black/.test(hintBlock),
  'the dead-feed branch no longer names a black picture');
assert(/else if \(q\.exposure < 45\)[\s\S]*?too dark/.test(hintBlock),
  'the dim-room branch is no longer an ELSE of the dead-feed branch, so a black feed can be blamed on the lighting again');

/* The dead-feed message must not send the doctor after a lamp. Note this
   tests the REMEDY, not the word: "this is not a lighting problem" contains
   "lighting" and is exactly the right thing to say. An earlier version of
   this assertion banned the word and failed the correct message. */
const deadMsg = (hintBlock.match(/went black[^']*/) || [''])[0];
assert(!/turn a light on|face a window|more light|add light|brighter/i.test(deadMsg),
  'the dead-feed message advises a lighting remedy: "' + deadMsg + '". No lamp fixes a dropped compositor surface, ' +
  'and that advice is exactly what the owner was shown while staring at a black picture.');
assert(/restart/i.test(deadMsg),
  'the dead-feed message does not tell the doctor to restart the camera, which is the only remedy that works: "' + deadMsg + '"');

console.log('PASS p1 avatar dead-feed threshold: both sites agree at ' + hintValue +
  ', it sits below dim-room luminance, the dim-room branch stays subordinate, and the black-feed message sends nobody after a lamp');
