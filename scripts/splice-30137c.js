'use strict';
/* MLS Assist 3.0.137 - readstage-1.1.0 (Fable, 2026-09-14). First evidence from readstage-1.0.0 on the
 * 3.0.136 live pull: a chart read hit its absolute deadline at 'identity poll 24' - the identity loop ran
 * the whole budget and never accepted a candidate. The marker does not say whether every poll saw a
 * DIFFERENT patient's banner (the open never navigated; stale chart) or NO banner at all (chart never
 * painted). Add that word to the marker (match / other / none), counts only. Latin1 seam, inverse proof.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
var a = "          bootstrapReadyEarly = !!(bootstrapIdentity && cand && cand.name && expectName && nmm(cand.name, expectName) && bootstrapIdentityReady(cand, identityFrameResults));";
rep(a, "          __chartStage = 'identity poll ' + polls + (cand && cand.name ? ((expectName && !nmm(cand.name, expectName)) ? ' other' : ' match') : ' none'); /* readstage-1.1.0 (3.0.137): which banner the poll saw, as a word */" + eolAt(a) + a, 'poll-word');
let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30137c: ' + edits.length + ' verified seams');
