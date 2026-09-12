'use strict';

// Literal, reversible byte replacements preserve background.js's mixed EOLs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let after = before;
const edits = [];
function replace(oldText, newText) {
  if (after.indexOf(newText) >= 0) {
    assert(after.indexOf(newText) === after.lastIndexOf(newText), 'already-applied replacement is not unique');
    return;
  }
  assert(after.indexOf(oldText) >= 0 && after.indexOf(oldText) === after.lastIndexOf(oldText), 'expected exactly one replacement: ' + oldText);
  after = after.replace(oldText, newText);
  edits.push([oldText, newText]);
}
const anchor = 'var axKept = axVisits.length, axTotalE = axBest.encounters.length;';
const at = before.indexOf(anchor);
assert(at >= 0);
const eol = before.slice(at + anchor.length, at + anchor.length + 2) === '\r\n' ? '\r\n' : '\n';
replace(anchor, anchor + eol + [
  '            /* vcensus-1.0.0 (3.0.118): the fallback cannot shrink the known',
  '               full-history population. Its refusal must survive the shared',
  '               terminal hop even when every harvested ax body was read. */',
  '            var axExpected = axOnlyDate ? axTotalE : Math.max(axTotalE, Number(total) || 0);',
  '            var axCoverageComplete = axOnlyDate ? (axScannedAll && axRefused === 0 && axShapeUnknown === 0) : (axKept === axExpected && axRefused === 0 && axShapeUnknown === 0);'
].join(eol));
replace('complete: axOnlyDate ? (axScannedAll && axRefused === 0 && axShapeUnknown === 0) : (axKept === axTotalE && axRefused === 0 && axShapeUnknown === 0 && (!(total > 0) || axKept >= total)), indexComplete: true, indexRowsKnown:', 'complete: axCoverageComplete, indexComplete: true, indexRowsKnown:');
replace('bodyComplete: axOnlyDate ? (axScannedAll && axRefused === 0) : axKept === axTotalE, fullDetail: axOnlyDate ? (axScannedAll && axRefused === 0) : axKept === axTotalE, onlyDate: axOnlyDate, axDateSkipped: axDateSkipped, expected: axTotalE,', 'bodyComplete: axCoverageComplete, fullDetail: axCoverageComplete, onlyDate: axOnlyDate, axDateSkipped: axDateSkipped, expected: axExpected,');
replace('var proven = res.ok === true && res.receipt.indexComplete === true', 'var proven = res.ok === true && res.receipt.complete === true && res.receipt.indexComplete === true');
replace('var axVisits = [], axRefused = 0, axShapeUnknown = 0, axSigs = [axBest.surfaceSig], axT0 = Date.now();', 'var axVisits = [], axRefused = 0, axShapeUnknown = 0, axAttempted = 0, axSigs = [axBest.surfaceSig], axT0 = Date.now();');
replace('var axE = axBest.encounters[axI];', 'var axE = axBest.encounters[axI]; axAttempted++;');
replace("ok: true, reason: '', identity: (axVisits[0] ?", "ok: axCoverageComplete, reason: axCoverageComplete ? '' : 'visit-bodies-incomplete', identity: (axVisits[0] ?");
replace('expected: axExpected, parsed: axKept, attempted: axCap, failures: axRefused + axShapeUnknown,', 'expected: axExpected, parsed: axKept, attempted: axAttempted, notAttempted: Math.max(0, axExpected - axAttempted), failures: axRefused + axShapeUnknown,');

let restored = after;
for (const [oldText, newText] of edits.slice().reverse()) {
  assert(restored.indexOf(newText) === restored.lastIndexOf(newText));
  restored = restored.replace(newText, oldText);
}
assert.strictEqual(restored, before, 'bytes outside declared replacements changed');
fs.writeFileSync(target, Buffer.from(after, 'latin1'));
console.log('Applied 3.0.118 visit-census fix; inverse byte proof passed for ' + edits.length + ' replacements.');
