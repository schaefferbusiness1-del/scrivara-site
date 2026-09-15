'use strict';
/* MLS Assist 3.0.143 - rowscroll-1.0.0 (Fable, 2026-09-15). Run T on 3.0.142 (Sep 14, 40 rows, hidden work window):
 * the schedule read now offers every row (legacyscroll-1.0.0), but three late rows of the long section still
 * failed with schedule-date-restore-failed after appointment-id-not-found on the schedule route - the same three
 * rows as every run since Run C. Mechanism, read from the schedule-row opener (mlsScheduleOpenDriver, phase
 * 'open'): its scroll sweep only considers containers matching [class*="schedule"], [class*="calendar"], main,
 * section - athena's classic day grid scrolls in div.appointments (class "appointments"), which matches none of
 * them, so the sweep never scrolls the one list that lazy-loads; a row past the first page is honestly "not
 * found", the recovery re-grounds the date, scans the same first page again, and refuses. Cure: (1) the sweep
 * also considers [class~="appointments"]; (2) at the bottom of a container the sweep waits once for the lazy
 * page (1.2 s, the same hidden-safe wait the sweep already uses) and re-reads scrollHeight - if the list grew,
 * the sweep continues into the new rows. Nothing else changes: same row matcher, same click, same deadlines.
 * Latin1 seams, inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }

/* 1. the sweep considers athena's classic list container */
rep("          var cands = [].slice.call(document.querySelectorAll('[class*=\"ScheduleColumn_schedule-column\"],[class*=\"schedule\"],[class*=\"calendar\"],main,section')).slice(0, 400);",
    "          var cands = [].slice.call(document.querySelectorAll('[class~=\"appointments\"],[class*=\"ScheduleColumn_schedule-column\"],[class*=\"schedule\"],[class*=\"calendar\"],main,section')).slice(0, 400); /* rowscroll-1.0.0 (3.0.143): the classic day grid scrolls in div.appointments */", 'scrollers');

/* 2. the bottom-of-list lazy-page wait, built from the sweep's own hidden-safe wait expression */
const forLine = "          for (var y = 0; y <= maxH && y < 40000; y += step) {";
assert(count(out, forLine) === 1, 'for-line unique');
const fi = out.indexOf(forLine);
const a = out.indexOf('await (function (ms)', fi), b = out.indexOf('})(', a), c = out.indexOf(';', b);
assert(a > fi && b > a && c > b && a - fi < 400, 'the sweep wait expression sits right after the for-line');
const waitExpr = out.slice(a, c + 1);
assert(/\}\)\(320\);$/.test(waitExpr) && waitExpr.indexOf('mls-hs-1.0.0') > 0, 'the sweep wait is the 320 ms hidden-safe wait');
const lazyWait = waitExpr.replace(/\}\)\(320\);$/, '})(1200);');
const clickLine = "            if (h2.el) return await clickRebound(h2, y);";
assert(count(out, clickLine) === 1, 'click line unique');
const ci = out.indexOf(clickLine); const nl = out.indexOf('\n', ci); const N = (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n';
rep(clickLine,
    clickLine + N +
    "            if (y + step > maxH) { /* rowscroll-1.0.0 (3.0.143): athena's classic day grid lazy-loads the rest of a long list ~1 s after it is scrolled to its end (measured); wait once at the bottom and extend the sweep if the list grew */ " + lazyWait + " try { var __nh = sc0.scrollHeight; if (__nh > maxH + 60) maxH = __nh; } catch (eNh) {} }", 'lazy wait');

let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30143: ' + edits.length + ' verified seams');
