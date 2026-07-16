'use strict';

/* ONE visit transcript contract (fl-1.7.0, owner directive 2026-07-16):
 * The ez3fl top lane and the engine's per-patient workspace each render a
 * transcript box. The TOP lane is the keeper — while it is mounted on the
 * doctor screen, the ENGINE's transcript card (.ez3-transcript-card) yields
 * via the ez3fl-top-owns class on #mlsEz3Body.
 *
 * History: fl-1.6.1 yielded in the other direction (hid .ez3fl-record while a
 * patient was open) — that also removed the quick-tools row and the primary
 * record CTA, and contradicted the owner's "keep the one at the top". The
 * yield stays a CSS hide, never node removal (fl-1.5.0: removal flashed the
 * transcript on every engine reconciliation).
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

// the module and both transcript surfaces still exist
assert.match(src, /__mlsEz3Flow\s+fl-1\.0\.0/, 'ez3fl module header present');
assert.match(src, /VERSION = 'fl-1\.7\.0'/);
assert.match(src, /id="ez3flTranscript"/, 'top-lane transcript');
assert.match(src, /id="ez3Transcript"/, 'engine workspace transcript');

// CSS: while the top lane owns the screen, the ENGINE transcript card hides
const cssRule = src.match(/#mlsEz3Body\.ez3fl-top-owns[^']+/);
assert.ok(cssRule, 'top-owns CSS rule present');
assert.match(cssRule[0], /\.ez3-transcript-card/);
assert.match(cssRule[0], /display:none!important/);

// the top lane itself must NOT be css-hidden by any yield class
assert.ok(!/ez3fl-ws-active/.test(src), 'fl-1.6.1 top-lane yield fully retired');

// toggle: keyed on the lane being mounted, on the body host, never on staff screen
assert.match(src, /classList\.toggle\('ez3fl-top-owns', !staff && laneMounted\)/,
  'class toggle keyed on the mounted top lane');

// the yield must NOT be implemented by removing nodes (fl-1.5.0 regression)
const flStart = src.indexOf("VERSION = 'fl-1.7.0'");
const flBlock = src.slice(flStart, src.indexOf('__mlsEz3Flow.revert', flStart) + 400);
assert.ok(!/ez3fl-top-owns[^\n]*\.remove\(\)/.test(flBlock), 'yield is CSS-only, no node removal');

console.log('visit-single-transcript-contract: ok');
