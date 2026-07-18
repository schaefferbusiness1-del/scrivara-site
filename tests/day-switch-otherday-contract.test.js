'use strict';

/* Owner rule: days must NEVER mismatch. With Friday selected on the day strip,
 * the body below must not show today's hero / "Pull today's patients" /
 * Choose-patient content. ds-1.3.0 makes the selected day own the Visit body:
 * a non-today selection adds .mls-ds-otherday to #mlsEz3Body, CSS hides the
 * engine wrap (display only — nothing destroyed), the other-day list carries
 * an explicit not-today note, and Back to Today restores the native flow. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const connect = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');
const dsStart = connect.indexOf('__mlsDaySwitch ds-1');
const dsEnd = connect.indexOf('function retryFailedHistories', dsStart) > dsStart
  ? connect.indexOf('mlsDsCleanup', dsStart) : -1;
assert(dsStart >= 0, 'day-switch module boundary was not found');
const ds = connect.slice(dsStart, dsEnd > dsStart ? dsEnd : dsStart + 30000);

assert(connect.includes("version: 'ds-1.3.1'"), 'day-switch other-day ownership release is not installed');
/* ds-1.3.1: the other-day list buckets by the pull's filed date (appt_date)
 * FIRST — same precedence as the canonical _calDateOf — so a backend
 * day_local recomputation can never move a receipt-bound row off its day. */
assert(ds.includes("String(a.appt_date || a.day_local || '').slice(0, 10)"),
  'the day-strip list must bucket by the filed appt_date before day_local');
assert(connect.includes('#mlsEz3Body.mls-ds-otherday>#ez3Wrap{display:none!important;}'),
  'a non-today selection does not hide the engine\'s today content');
assert(ds.includes("classList.toggle('mls-ds-otherday', !isToday)"),
  'the other-day body class is not driven by the selected day');
assert(ds.includes('ds-otherday-note'),
  'the other-day list does not state which day is shown');
assert(/rebuilt #mlsEz3Body loses the other-day body class[\s\S]{0,80}syncStrip\(\)/.test(ds),
  'a rebuilt Visit body would silently drop back to mismatched days');

/* the hide must be display-only: the module must never remove #ez3Wrap */
assert(!/ez3Wrap[^\n]{0,40}\.remove\(\)/.test(ds), 'the engine wrap must never be removed by the day strip');

console.log('PASS day-switch other-day ownership: a selected non-today day owns the Visit body; today content never shows under another day\'s header');
