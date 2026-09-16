'use strict';
/* MLS Assist 3.0.164 - apptrowdob-1.1.0 (Fable, 2026-09-16). Run AL on 3.0.163: the row's chart read answered
 * ok with identityVia appointment-row-dob and the exact DOB, but only 460 chars of text - every clinical frame
 * without its own banner stayed UNBOUND (frame binding demands the exact name pair in the frame text, which a
 * used-vs-legal patient's frames cannot print) - so the receipt was incomplete and the app refused the row:
 * "could not prove that every patient chart frame ...". Two completions of the door: (a) when the door proved the
 * chart identity, a clinical frame whose text prints the exact expected DOB is bound (the tab is the one whose
 * appointment row athena listed; the DOB is exact; no name-only binding); (b) the response reports the printed
 * schedule name as chartName - exactly as the alt-name path reports its matched printed name - with the banner's
 * own name kept in chartNamePrinted and identityVia saying how it was proven. Latin1 seams, inverse proof.
 * Run once (after splice-30163.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("            if (identityMatchesTarget(frameIdentity[f.frameId])) return true;",
    "            if (identityMatchesTarget(frameIdentity[f.frameId])) return true;\n" +
    "            if (__apptRowDoor(ident) && wantDob && textHasDobStrict(f.t, wantDob)) return true; /* apptrowdob-1.1.0 (3.0.164): the door proved this chart (athena's appointment row + exact DOB + exact surname); a clinical frame printing the exact DOB is bound */", 'frame binding');
rep("chartName: (exactGlobalPair.viaAltName === true && exactGlobalPair.matchedName) ? exactGlobalPair.matchedName : ((ident && ident.name) || ''), chartNamePrinted:",
    "chartName: (exactGlobalPair.viaAltName === true && exactGlobalPair.matchedName) ? exactGlobalPair.matchedName : ((!exactGlobalPair.ok && __apptRowDoor(ident)) ? want : ((ident && ident.name) || '')) /* apptrowdob-1.1.0: the door reports the printed schedule name it proved, like the alt-name path */, chartNamePrinted:", 'chart name');
let restored = out;
for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30164: ' + edits.length + ' verified seams');
