'use strict';
// Mechanical, inverse-verified replacements preserve this source's mixed EOLs.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let after = before;
const edits = [];
function replace(oldText, newText) {
  assert(after.includes(oldText) && after.indexOf(oldText) === after.lastIndexOf(oldText), 'unique source seam: ' + oldText.slice(0, 100));
  after = after.replace(oldText, newText); edits.push([oldText, newText]);
}
const anchor = 'var axDateSkipped = 0, axScannedAll = true;';
const at = before.indexOf(anchor);
assert(at >= 0);
const eol = before.slice(at + anchor.length, at + anchor.length + 2) === '\r\n' ? '\r\n' : '\n';
replace(anchor, "var axDateSkipped = 0, axDateUnknown = 0, axScannedAll = axCap === axBest.encounters.length;");
const earlyStart = after.indexOf('            var axBodyEarly = null;');
const earlyEnd = after.indexOf('            var axIdOk = false, axIdent = null;', earlyStart);
assert(earlyStart > 0 && earlyEnd > earlyStart);
replace(after.slice(earlyStart, earlyEnd), '');
replace('            var axBody = axBodyEarly;' + eol + '            if (!axBody) {', '            var axBody = null;' + eol + '            if (!axBody) {');
const bodyEnd = '            if (!axBody || !axBody.ok) { axRefused++; continue; }';
replace(bodyEnd, bodyEnd + eol + [
  '            /* scoped-census-30121: identity precedes every date decision.',
  '               Unknown dates cannot prove that an encounter is out of scope. */',
  '            if (axOnlyDate) {',
  '              var axBodyDate = mlsVisitDateKeyForHint(axBody.headerDate);',
  '              if (!axBodyDate) { axDateUnknown++; continue; }',
  '              if (axBodyDate !== axOnlyDate) { axDateSkipped++; continue; }',
  '            }'
].join(eol));
replace('if (axVisits.length || (axOnlyDate && axScannedAll && axRefused === 0 && axShapeUnknown === 0)) {', 'if (axVisits.length || axOnlyDate) {');
replace('var axExpected = axOnlyDate ? axTotalE : Math.max(axTotalE, Number(total) || 0);', [
  'var axKnown = Math.max(axTotalE, Number(total) || 0);',
  '            var axExpected = axOnlyDate ? Math.max(0, axKnown - axDateSkipped) : axKnown;',
  "            var axTodayValid = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(frozenHint.todayKey || ''));"
].join(eol));
replace('var axCoverageComplete = axOnlyDate ? (axScannedAll && axRefused === 0 && axShapeUnknown === 0) : (axKept === axExpected && axRefused === 0 && axShapeUnknown === 0);', [
  'var axCoverageComplete = axKept === axExpected && axRefused === 0 && axShapeUnknown === 0 && axDateUnknown === 0 && (!axOnlyDate || (axScannedAll && (axKept > 0 || axTodayValid)));',
  "            var axSameDay = axOnlyDate ? (axCoverageComplete ? (axKept ? 'saved' : 'absent') : 'partial') : '';"
].join(eol));
replace('onlyDate: axOnlyDate, axDateSkipped: axDateSkipped, expected: axExpected, parsed: axKept, attempted: axAttempted, notAttempted: Math.max(0, axExpected - axAttempted), failures: axRefused + axShapeUnknown,', "onlyDate: axOnlyDate, scopeDate: axOnlyDate, sameDayStatus: axSameDay, noSubstitution: !!axOnlyDate, absenceProven: axSameDay === 'absent', temporalAuthority: axOnlyDate ? (axTodayValid ? 'account-local' : 'absent') : undefined, axDateSkipped: axDateSkipped, dateUnknownRows: axDateUnknown, expected: axExpected, parsed: axKept, attempted: axAttempted, notAttempted: Math.max(0, axKnown - axAttempted), failures: axRefused + axShapeUnknown + axDateUnknown,");
replace("error: axOnlyDate ? ((axScannedAll && axRefused === 0 && axShapeUnknown === 0) ? '' :", "error: axOnlyDate ? (axCoverageComplete ? '' :");
replace("' identity-unknown' + (axScannedAll ? '' : ', scan cut by deadline')", "' identity-unknown, ' + axDateUnknown + ' date-unknown' + (axScannedAll ? '' : ', scan capped or cut by deadline')");
const commentStart = after.indexOf('          /* qol-2.3 scoped-day on the ax route:');
const commentEnd = after.indexOf('          var axOnlyDate', commentStart);
assert(commentStart > 0 && commentEnd > commentStart);
replace(after.slice(commentStart, commentEnd), [
  '          /* Scoped reads inspect every harvested encounter under the same',
  '             identity proof. Only positively dated other-day encounters are',
  '             excluded; caps, missing dates and missing index rows stay partial. */',
  ''
].join(eol));
let restored = after;
for (const [oldText, newText] of edits.slice().reverse()) {
  if (newText) { assert(restored.indexOf(newText) === restored.lastIndexOf(newText)); restored = restored.replace(newText, oldText); }
  else { const insertAt = restored.indexOf('            var axIdOk = false, axIdent = null;'); restored = restored.slice(0, insertAt) + oldText + restored.slice(insertAt); }
}
assert.strictEqual(restored, before, 'inverse source-byte proof');
fs.writeFileSync(target, Buffer.from(after, 'latin1'));
console.log('Applied scoped census repair; inverse source-byte proof passed.');
