'use strict';
/* MLS Assist 3.0.145 - visitsalt-1.0.0 (Fable, 2026-09-15). Run V on 3.0.144: the two rows that used to refuse
 * chart-swap-never-settled now pass the visits identity gate through the banner's other printed name
 * (visitsshadow-1.0.0) - and the app then refuses them itself as visits-identity-proof-failed, because the
 * visits result's identity carries the banner's PRIMARY printed name (the used name) while the app proves the
 * result against the name it asked for (the legal name). The chart read path solved the same shape in 3.0.131
 * (chartName = the matched printed name, chartNamePrinted = the primary, chartNameViaLegal = true). Cure, the
 * same shape here: the gate names the alternative it matched; where the visits handler adopts a frame's identity
 * after the gate passed through an alternative, the result identity's name becomes the matched name, the primary
 * printed name rides as namePrinted and nameViaAlt is true. DOB and MRN untouched. Latin1 seams, inverse proof.
 * Run once (after splice-30145.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("if (__alt && __alt.ok) { __alt.viaAltName = true; return __alt; }",
    "if (__alt && __alt.ok) { __alt.viaAltName = true; __alt.matchedName = String(live.altNames[__ai]); return __alt; }", 'gate names the match');
rep("if (!ecPicked || ecGate.ok) { identity = ecIdentity; gate = ecGate; ecPicked = true; }",
    "if (!ecPicked || ecGate.ok) { identity = (ecGate && ecGate.ok && ecGate.viaAltName && ecGate.matchedName && ecIdentity) ? Object.assign({}, ecIdentity, { namePrinted: ecIdentity.name, name: ecGate.matchedName, nameViaAlt: true }) : ecIdentity; gate = ecGate; ecPicked = true; } /* visitsalt-1.0.0 (3.0.145): the result identity carries the printed name the gate matched */", 'adopt matched name');
let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30145b: ' + edits.length + ' verified seams');
