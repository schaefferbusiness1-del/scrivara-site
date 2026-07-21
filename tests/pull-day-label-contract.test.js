'use strict';

/* Owner goal 2026-07-21 (date button): the pull button names its target day —
 * "Pull today" ONLY when the selected day is today in the PRACTICE time zone,
 * "Pull Wednesday the 22nd" for any other selected day — and the button, the
 * day strip, the patient list, and the pull job all read the SAME selected-day
 * source (DS.day), so a pull can never run for a different date than the one
 * on the button.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');

// ---- bound the active ds-2.0.2 day-strip module -----------------------------
const dsAt = connect.indexOf("version: 'ds-2.0.2'");
assert(dsAt > 0, 'active day-strip module (ds-2.0.2) not found');
const dsStart = connect.lastIndexOf('(function () {', dsAt);
const dsEnd = connect.indexOf('function removeDoctorDayControls()', dsAt);
assert(dsStart >= 0 && dsEnd > dsStart, 'could not bound the day-strip module');
const ds = connect.slice(dsStart, dsEnd);

// ---- one selected-day source everywhere -------------------------------------
assert(ds.includes('var day = DS.day;'), 'the pull job must read the strip-selected day');
assert(/si\.pull\(\{ date: day/.test(ds), 'the pull engine must be invoked with the SAME selected day');
assert(ds.includes("$('mlsDsPullBtn').onclick = startPull;") || connect.includes("$('mlsDsPullBtn').onclick = startPull;"),
  'the strip pull button must own the pull handler');
assert(/rowsFor\(/.test(ds) && ds.includes('if (d !== dayK) continue;'),
  'the patient list must bucket rows by the same selected day');

// ---- "today" is the PRACTICE time zone, never the device clock --------------
const dsTodayKey = ds.slice(ds.indexOf('function todayKey()'), ds.indexOf('function parseKey'));
assert(dsTodayKey.includes('_acctTodayKey'), 'the strip todayKey must delegate to the account/practice-tz clock');
assert(app.includes('function _acctTodayKey(){ return _acctDateKeyOf(new Date()); }'),
  'the practice-tz today helper is missing');
assert(app.includes("localStorage.setItem(uns('acctTz')"),
  '/api/me practice timezone must be persisted to the acctTz pref');

// ---- label format ------------------------------------------------------------
const fnStart = ds.indexOf('function dsOrdinal(');
const fnEnd = ds.indexOf('function syncStrip()');
assert(fnStart > 0 && fnEnd > fnStart, 'could not bound dsOrdinal/dsPullVerb');
const labelFns = ds.slice(fnStart, fnEnd);

/* Deliberately NO safe() stub: the ds module has no local safe(), so any
   helper dependency reintroduced into these label functions must fail THIS
   suite instead of silently throwing into syncStrip's catch at runtime
   (exactly how the b470 label broke live). */
const context = {
  String, Number, Date,
  todayKey: () => '2026-07-21',
  DS: { day: '2026-07-22' }
};
vm.createContext(context);
vm.runInContext(labelFns + '\nthis.dsOrdinal = dsOrdinal; this.dsPullVerb = dsPullVerb;', context);

assert.strictEqual(context.dsPullVerb('2026-07-21'), 'Pull today', 'today must read "Pull today"');
assert.strictEqual(context.dsPullVerb('2026-07-22'), 'Pull Wednesday the 22nd',
  'a selected non-today day must read like "Pull Wednesday the 22nd"');
assert.strictEqual(context.dsPullVerb('2026-08-01'), 'Pull Saturday the 1st');
assert.strictEqual(context.dsPullVerb(), 'Pull Wednesday the 22nd', 'with no argument the label follows DS.day');

for (const [n, want] of [[1, '1st'], [2, '2nd'], [3, '3rd'], [4, '4th'], [11, '11th'], [12, '12th'], [13, '13th'], [21, '21st'], [22, '22nd'], [23, '23rd'], [30, '30th'], [31, '31st']]) {
  assert.strictEqual(context.dsOrdinal(n), want, `ordinal ${n}`);
}

// A different DEVICE zone must not change the label day: the key parses at
// noon local, so the printed weekday/day always match the selected key itself.
assert(labelFns.includes("T12:00:00"), 'the label must parse the day key at noon to stay zone-safe');

console.log('PASS pull day label: one DS.day source for button/list/job, practice-tz today, and "Pull Wednesday the 22nd" naming with correct ordinals');
