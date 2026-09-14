'use strict';
/* MLS Assist 3.0.131 - bannernames-1.3.0 (Fable, 2026-09-14). On the 3.0.129 run the two
 * former wrong-chart rows read ok (complete, with text) but the app still marked them failed:
 * its own name check compares the response's chartName (the banner's PREFERRED name) with
 * the legal name it asked for. The exact pair matched through the banner's second printed
 * name, so the response now reports the matched printed name as chartName, keeps the
 * banner's primary in chartNamePrinted, and flags chartNameViaLegal. Nothing is invented:
 * both names are printed by athena on that chart. Byte-preserving latin1 seams with an
 * inverse proof. Run once: node scripts/splice-30131.js
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90)); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("if (alt.ok) return Object.assign({}, alt, { viaAltName: true });",
    "if (alt.ok) return Object.assign({}, alt, { viaAltName: true, matchedName: alts[ai] });", 'matchedName');
rep("polls: polls }, chartName: (ident && ident.name) || '', chartDob: (ident && ident.dob) || '',",
    "polls: polls }, chartName: (exactGlobalPair.viaAltName === true && exactGlobalPair.matchedName) ? exactGlobalPair.matchedName : ((ident && ident.name) || ''), chartNamePrinted: (ident && ident.name) || '', chartNameViaLegal: exactGlobalPair.viaAltName === true, chartDob: (ident && ident.dob) || '',", 'chartName');
let restored = out;
for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30131: ' + edits.length + ' verified seams');
