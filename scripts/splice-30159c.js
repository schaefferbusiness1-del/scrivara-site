'use strict';
/* MLS Assist 3.0.159 - schedwait-1.0.0 (Fable, 2026-09-15). The one row every run refuses (no MRN, used first
 * name) is a REAL appointment row on the Sep 14 grid at index 30 of 44 (measured in the scratch tab: name div,
 * an encounter-summary link instead of a patient-id link). Its schedule leg answers name-not-found on every run:
 * the row opener's sweep waits ONCE for 1.2 s at the bottom of the lazy list (rowscroll-1.0.0, measured ~1 s
 * VISIBLE), but the athena tab is hidden all day and Chrome throttles the grid's own lazy-load timer, so the late
 * rows are not there yet when the sweep ends; every other late row was rescued by the Find leg, which this row
 * cannot pass. Cure: at the bottom, poll the list height every 800 ms (hidden-safe) for up to 8 s; the moment it
 * grows, extend the sweep and keep scanning; give up only when nothing grew. Same matcher, same click, same
 * appointment-id gates. Latin1 seam located programmatically, inverse proof. Run once (after splice-30159b.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const count = (s, n) => s.split(n).length - 1;
const startTok = "if (y + step > maxH) { /* rowscroll-1.0.0 (3.0.143): athena's classic day grid lazy-loads the rest of a long list ~1 s after it is scrolled to its end (measured); wait once at the bottom and extend the sweep if the list grew */";
assert(count(before, startTok) === 1, 'rowscroll block unique');
const s = before.indexOf(startTok);
const endTok = "try { var __nh = sc0.scrollHeight; if (__nh > maxH + 60) maxH = __nh; } catch (eNh) {} }";
const e = before.indexOf(endTok, s); assert(e > s && e - s < 2000, 'rowscroll block end');
const block = before.slice(s, e + endTok.length);
/* the hidden-safe sleep IIFE, verbatim from the block, re-used with a different duration */
const sleepStart = block.indexOf('await (function (ms) {'); const sleepEnd = block.indexOf('})(1200);', sleepStart);
assert(sleepStart > 0 && sleepEnd > sleepStart, 'sleep IIFE located');
const sleepFn = block.slice(sleepStart + 'await '.length, sleepEnd + '})'.length); /* "(function (ms) {...})" */
assert(/^\(function \(ms\) \{/.test(sleepFn) && /\}\)$/.test(sleepFn) && sleepFn.indexOf('\n') < 0, 'sleep IIFE shape');
const replacement =
  "if (y + step > maxH) { /* rowscroll-1.0.0 (3.0.143) + schedwait-1.0.0 (3.0.159): athena's classic day grid lazy-loads the rest of a long list ~1 s after it is scrolled to its end when VISIBLE; hidden, Chrome throttles that timer, so poll the height every 800 ms for up to 8 s and extend the sweep the moment it grows */ " +
  "var __swT0 = Date.now(), __swGrew = false; while (Date.now() - __swT0 < 8000 && openAllowed()) { await " + sleepFn + "(800); var __nh = 0; try { __nh = sc0.scrollHeight; } catch (eNh) {} if (__nh > maxH + 60) { maxH = __nh; __swGrew = true; break; } } " +
  "if (!__swGrew) { /* nothing more to load */ } }";
assert(count(before, 'schedwait-1.0.0') === 0, 'not applied yet');
const out = before.slice(0, s) + replacement + before.slice(e + endTok.length);
assert.strictEqual(out.slice(0, s) + block + out.slice(s + replacement.length), before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30159c: rowscroll bottom wait -> 8 s growth poll (' + block.length + ' -> ' + replacement.length + ' chars)');
