'use strict';
/* MLS Assist 3.0.151 - axlistdate-1.0.0 (Fable, 2026-09-15). Run AB (plain pull, athena tab hidden, 3.0.150): every
 * row's day-facts visit read refused after ~80 s with "The scoped ax read kept 0 in-day of 1 encounters (0 other-day
 * skipped, 0 refused, 0 identity-unknown, 1 date-unknown)" - the encounter body WAS read and identity-gated, but the
 * ax encounter page prints no label the axRead date regex knows (encounter date / date of service / visit date /
 * DOS), so the in-day encounter was dropped as date-unknown; the app's retry then read the frame the ax route had
 * left on the ENCOUNTER page, found no encounter list, and answered the day as empty in 6 s (a false "absent").
 * Cures: (1) axHarvest carries the date athena prints beside each encounter link (the anchor's own text, else its
 * parent's first 200 chars) as listDate, and the scoped-day decision falls back to it when the body prints no
 * labeled date (counted as dateFromListRows); (2) after its encounter reads the ax route puts the frame back on the
 * chart's briefing (briefingGo, the existing engine-owned recovery navigation) so the next read never harvests an
 * encounter page; (3) the classic explicit-empty verdict is never accepted on an encounter route. Latin1 seams,
 * inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + '): ' + a.slice(0, 80)); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }

/* 1. the harvest carries the printed list date and the briefing path */
rep("            if (am && axAcc.length < 80) axAcc.push({ eid: am[2], route: am[3], hrefPath: ah.replace(/[#?].*$/, '') });",
    "            if (am && axAcc.length < 80) { var axLd = ''; try { var axCtx = String(el.textContent || '').replace(/\\s+/g, ' '); if (!/\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4}/.test(axCtx) && el.parentElement) axCtx = String(el.parentElement.textContent || '').replace(/\\s+/g, ' ').slice(0, 200); var axLm = axCtx.match(/\\b(\\d{1,2}[\\/\\-.]\\d{1,2}[\\/\\-.]\\d{2,4})\\b/); if (axLm) axLd = axLm[1]; } catch (eLd) {} axAcc.push({ eid: am[2], route: am[3], hrefPath: ah.replace(/[#?].*$/, ''), listDate: axLd }); } /* axlistdate-1.0.0 (3.0.151): the date athena prints beside the encounter link */", 'harvest date');
rep("      return { ok: true, encounters: axUnique, surfaceSig: {",
    "      return { ok: true, encounters: axUnique, briefingPath: String(location.pathname || ''), surfaceSig: {", 'harvest path');

/* 2. the scoped-day decision falls back to the list date */
rep("          var axDateSkipped = 0, axDateUnknown = 0, axScannedAll = axCap === axBest.encounters.length;",
    "          var axDateSkipped = 0, axDateUnknown = 0, axDateFromList = 0, axScannedAll = axCap === axBest.encounters.length; /* axlistdate-1.0.0 */", 'counter');
rep("              var axBodyDate = mlsVisitDateKeyForHint(axBody.headerDate);",
    "              var axBodyDate = mlsVisitDateKeyForHint(axBody.headerDate) || mlsVisitDateKeyForHint(axE.listDate); if (axBodyDate && !mlsVisitDateKeyForHint(axBody.headerDate)) axDateFromList++; /* axlistdate-1.0.0 (3.0.151): the ax encounter page prints no labeled date; the list beside its link does */", 'date fallback');
rep("dateUnknownRows: axDateUnknown", "dateUnknownRows: axDateUnknown, dateFromListRows: axDateFromList", 'receipt');

/* 3. the frame goes back to the briefing after the encounter reads */
rep("          if (axVisits.length || axOnlyDate) {",
    "          if (axAttempted > 0 && axBest.briefingPath && /^\\/\\d+\\/\\d+\\/ax\\/briefing\\/\\d+$/.test(String(axBest.briefingPath))) { try { await exec(emrId, [axBestFrame], ['briefingGo', cfg, axBest.briefingPath]); await sleep(900); touchVisitLease(); } catch (eAxBack) {} } /* axlistdate-1.0.0 (3.0.151): never leave the frame on an encounter page - the next read would harvest it as an empty day */\n" +
    "          if (axVisits.length || axOnlyDate) {", 'briefing back');

/* 4. an explicit empty on an encounter route is not an empty day */
rep("        if (explicitEmptyVisits()) return { ok: true, selector: 'verified-empty-state',",
    "        if (explicitEmptyVisits() && !/\\/ax\\/encounter\\//i.test(String(location.pathname || ''))) return { ok: true, selector: 'verified-empty-state', /* axlistdate-1.0.0: an encounter page is not the visits list */", 'empty guard');

let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30151: ' + edits.length + ' verified seams');
