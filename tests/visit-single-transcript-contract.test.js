'use strict';

/* ONE visit transcript contract (fl-1.6.1):
 * The ez3fl top lane and the engine's per-patient workspace each render a
 * transcript box. While the engine has a patient open (its card carries the
 * DOB badge — recording, generating, or note review), the top lane must yield
 * via the ez3fl-ws-active CSS class so exactly one transcript ever shows.
 * The yield is a CSS hide, never node removal (fl-1.5.0: removal flashed the
 * transcript on every engine reconciliation).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

// the module and both transcript surfaces still exist
assert.match(src, /__mlsEz3Flow\s+fl-1\.0\.0/, 'ez3fl module header present');
assert.match(src, /VERSION = 'fl-1\.6\.1'/);
assert.match(src, /id="ez3flTranscript"/, 'top-lane transcript');
assert.match(src, /id="ez3Transcript"/, 'engine workspace transcript');

// CSS: the yield class hides the top lane's record row, transcript and note
const cssRule = src.match(/#mlsEz3Body\.ez3fl-ws-active[^']+/);
assert.ok(cssRule, 'yield CSS rule present');
assert.match(cssRule[0], /\.ez3fl-record/);
assert.match(cssRule[0], /\.ez3fl-transcript/);
assert.match(cssRule[0], /\.ez3fl-note/);
assert.match(cssRule[0], /display:none!important/);

// toggle: keyed on the engine card's DOB badge, on the body host, never on staff screen
assert.match(src, /classList\.toggle\('ez3fl-ws-active', !staff && !!\(wrap && wrap\.querySelector\('\.ez3-badge\.dob'\)\)\)/,
  'class toggle keyed on the engine patient card');

// the yield must NOT be implemented by removing the lane (fl-1.5.0 regression)
const flStart = src.indexOf("VERSION = 'fl-1.6.1'");
const flBlock = src.slice(flStart, src.indexOf('__mlsEz3Flow.revert', flStart) + 400);
assert.ok(!/ez3fl-ws-active[^\n]*\.remove\(\)/.test(flBlock), 'yield is CSS-only, no node removal');

console.log('visit-single-transcript-contract: ok');
