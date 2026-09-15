'use strict';
/* MLS Assist 3.0.152 - axscoped-1.1.0 (Fable, 2026-09-15), replacing the 1.0.0 line of splice-30152.js. The 1.0.0
 * rule (a scoped day counts only the harvested encounters) broke the census contract of 3.0.118: an index that
 * KNOWS more encounters than the harvest lists cannot be called complete, because an unlisted one could be in-day.
 * The classic index rows carry each encounter's printed date and id (rowBinding), so the honest scoped
 * population is: the harvested in-day encounters + every index row the harvest did not cover whose printed date is
 * the scoped day or unknown + any declared total beyond the rows and the harvest. On the live chart (index 38 rows,
 * all dated other days, harvest 1 in-day) that is 1; in the census suite's shorter-index case (index 6, harvest 4,
 * no rows) it is 1 + 2 and refuses, as before. The receipt counts the index rows in-day / undated. Latin1 seam,
 * inverse proof. Run once (after splice-30152.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
rep("            var axExpected = axOnlyDate ? Math.max(0, axTotalE - axDateSkipped) : axKnown; /* axscoped-1.0.0 (3.0.152): a scoped day counts the harvested encounters (every one read and dated, axScannedAll guards the cap), not the full-history index */",
    "            var axIdxInDay = 0, axIdxUndated = 0, axIdxBeyond = 0, axExpected = axKnown;" +
    " if (axOnlyDate) { /* axscoped-1.1.0 (3.0.152): the honest scoped population - harvested in-day encounters, plus every classic index row the harvest did not cover whose printed date is the scoped day or unknown, plus any declared total beyond both */" +
    " var __axHarv = {}; (axBest.encounters || []).forEach(function (e) { if (e && e.eid) __axHarv[String(e.eid)] = 1; });" +
    " var __axIdxRows = (typeof rows !== 'undefined' && Array.isArray(rows)) ? rows : [];" +
    " __axIdxRows.forEach(function (r) { if (!r) return; var __eid = String(r.encounterId || ''); if (__eid && __axHarv[__eid]) return; var __k = mlsVisitDateKeyForHint(r.date); if (!__k) axIdxUndated++; else if (__k === axOnlyDate) axIdxInDay++; });" +
    " axIdxBeyond = Math.max(0, (Number(total) || 0) - Math.max(__axIdxRows.length, axTotalE));" +
    " axExpected = Math.max(0, axTotalE - axDateSkipped) + axIdxInDay + axIdxUndated + axIdxBeyond; }", 'scoped population');
rep("dateUnknownRows: axDateUnknown, dateFromListRows: axDateFromList",
    "dateUnknownRows: axDateUnknown, dateFromListRows: axDateFromList, indexInDayRows: axIdxInDay, indexUndatedRows: axIdxUndated, indexBeyondRows: axIdxBeyond", 'receipt');
let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30152b: ' + edits.length + ' verified seams');
