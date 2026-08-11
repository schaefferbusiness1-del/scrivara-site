'use strict';
/* =============================================================================
 * time-unknown-display-contract.test.js  (td-1.0)  2026-08-11
 *
 * FAILING-WHEN-VIOLATED contract for the time-unknown display fix
 * (tests/patch-time-unknown-display.js). The practice carries 420 backend
 * appointment rows with start_at NULL (timeless-scan-RESULT.md); the repair
 * lane will mark them time_unknown=1 but has not executed, so BOTH states must
 * display honestly TODAY.
 *
 * WHAT THIS PROVES (against the REAL renderer, not a re-implementation):
 *   1. calOpenDay (the diagnosed all-dash wall) is extracted from
 *      ScribeFlow.html's actual bytes and DRIVEN with a fixture day holding
 *      timed + start_at:null + time_unknown:1 rows. NEW code: timed rows first
 *      in time order, unknown rows LAST, each unknown row carries the plain
 *      honest chip "time not recorded", zero bare-dash time cells, header +
 *      row count untouched.
 *   2. The OLD code FAILS the same checker: nulls sort FIRST and the time cell
 *      is a bare em-dash. (A guard and its test can agree and both be wrong -
 *      so the old bytes are reconstructed and run against the new assertions.)
 *   3. Every sibling sort site (month cells, day agenda, waiting room, staff
 *      board, #mlsQpAll, Who's-Next, picker pool, day-chip strip) has its
 *      comparator extracted FROM THE FILE BYTES and executed: NEW sorts
 *      timeless last; OLD sorts them first.
 *   4. The two epoch-time sites (mls-connect fmtTime over new Date(null) =
 *      THE EPOCH) printed a confidently-wrong clock time for timeless rows in
 *      the OLD bytes - proven by running the file's own fmtTime - and print
 *      "time not recorded" in the NEW bytes.
 *
 * Works in BOTH repo states: pre-apply (edits applied in memory) and
 * post-apply (old bytes reconstructed by reverse-splice). No files written.
 * Fixture rows use neutral labels - no patient names.
 * ========================================================================== */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const patcher = require('./patch-time-unknown-display.js');
const { EDITS, applyToSources, revertSources, occurrences, ROOT } = patcher;

const EMDASH = 'â'; /* UTF-8 em-dash bytes under latin1 */

/* ---- load both variants ------------------------------------------------- */
const files = Array.from(new Set(EDITS.map(e => e.file)));
const current = {};
for (const f of files) current[f] = fs.readFileSync(path.join(ROOT, f), 'latin1');

const appliedCount = EDITS.filter(e => occurrences(current[e.file], e.replace) === 1).length;
let OLD, NEW;
if (appliedCount === EDITS.length) {
  NEW = current;
  OLD = revertSources(current);
} else if (appliedCount === 0) {
  OLD = current;
  NEW = applyToSources(current).sources;
} else {
  throw new Error('repo is HALF-APPLIED (' + appliedCount + '/' + EDITS.length + ' edits present) - refusing to certify a chimera');
}

/* non-vacuity: the two variants must actually differ at every edited file */
for (const f of files) assert(OLD[f] !== NEW[f], 'variants identical for ' + f + ' - the patch is vacuous');

/* ---- extraction helpers (real bytes, not re-implementations) ------------ */
function extractBlock(src, startMarker) {
  const s = src.indexOf(startMarker);
  assert(s >= 0, 'marker not found: ' + startMarker);
  const e = src.indexOf('\n}', s);
  assert(e > s, 'end not found for ' + startMarker);
  return src.slice(s, e + 2);
}
function extractLine(src, marker) {
  const s = src.indexOf(marker);
  assert(s >= 0, 'line marker not found: ' + marker);
  const e = src.indexOf('\n', s);
  return src.slice(s, e < 0 ? src.length : e);
}

/* ---- fixture day: timed + current-state null + post-repair flagged ------ */
/* deliberately shuffled so any correct order is the sort's doing */
function fixture() {
  return [
    { id: 3, appt_date: '2026-07-07', start_at: null, name: 'Row Charlie', status: 'booked' },                   /* TODAY's state */
    { id: 4, appt_date: '2026-07-07', start_at: null, time_unknown: 1, name: 'Row Delta', status: 'booked' },    /* post-repair state */
    { id: 2, appt_date: '2026-07-07', start_at: '2026-07-07T18:30:00.000Z', name: 'Row Bravo', status: 'booked' },
    { id: 1, appt_date: '2026-07-07', start_at: '2026-07-07T13:00:00.000Z', name: 'Row Alpha', status: 'booked' }
  ];
}

/* ==== 1+2. DRIVE THE REAL calOpenDay, old and new ========================= */
function runCalOpenDay(sfSrc, appts) {
  const fnSrc = [
    extractBlock(sfSrc, 'function _fmtApptTime(v){'),
    extractLine(sfSrc, 'function _calStatusColor(s){'),
    extractLine(sfSrc, 'function _calLabelOf(a){'),
    extractLine(sfSrc, 'function _calDateOf(a){'),
    extractLine(sfSrc, 'function esc(s){'),
    extractBlock(sfSrc, 'function calOpenDay(key){')
  ].join('\n');
  const panel = { innerHTML: '', style: {} };
  const sandbox = {
    window: {},
    document: { getElementById: function (id) { return id === 'calDayPanel' ? panel : null; } },
    _calAppts: appts,
    _calMode: 'day',
    _calProviders: [],
    _calRenderMonth: function () {},
    _mlsTzFmt: function (k, o) { return new Intl.DateTimeFormat([], o); },
    _acctTz: function () { return 'America/New_York'; },
    console: console
  };
  vm.createContext(sandbox);
  vm.runInContext(fnSrc, sandbox, { filename: 'calOpenDay-extracted.js' });
  sandbox.calOpenDay('2026-07-07');
  return panel.innerHTML;
}

/* the day-panel invariant checker - the SAME assertions run on old and new */
function checkDayPanel(html) {
  const iA = html.indexOf('Row Alpha');
  const iB = html.indexOf('Row Bravo');
  const iC = html.indexOf('Row Charlie');
  const iD = html.indexOf('Row Delta');
  assert(iA >= 0 && iB >= 0 && iC >= 0 && iD >= 0, 'a fixture row is missing from the panel');
  assert(iA < iB, 'timed rows lost their time order (9:00 AM must precede 2:30 PM)');
  assert(iB < iC && iB < iD, 'a time-unknown row rendered BEFORE a timed row (nulls-first defect)');
  assert(occurrences(html, 'time not recorded') === 2, 'each unknown row must carry exactly one honest chip (want 2 total)');
  assert(html.indexOf('>' + EMDASH + '<') < 0, 'a bare em-dash time cell survived');
}

const newHtml = runCalOpenDay(NEW[ 'ScribeFlow.html' ], fixture());
checkDayPanel(newHtml);

const oldHtml = runCalOpenDay(OLD[ 'ScribeFlow.html' ], fixture());
let oldFailed = false;
try { checkDayPanel(oldHtml); } catch (e) { oldFailed = true; }
assert(oldFailed, 'the OLD renderer PASSED the new contract - this suite does not discriminate');
/* and the old failure is exactly the diagnosed shape: nulls first + bare dash */
assert(oldHtml.indexOf('>' + EMDASH + '<') >= 0, 'old code did not render the bare-dash cell (fixture no longer reproduces DEFECT C)');
assert(Math.min(oldHtml.indexOf('Row Charlie'), oldHtml.indexOf('Row Delta')) < oldHtml.indexOf('Row Alpha'),
  'old code did not sort nulls first (fixture no longer reproduces DEFECT C)');

/* headers + row count unaffected by the fix */
const hdrOf = h => h.slice(0, h.indexOf('</div>'));
assert.strictEqual(hdrOf(newHtml), hdrOf(oldHtml), 'the day header changed');
assert.strictEqual(occurrences(newHtml, 'calApptEdit_'), 4, 'new panel row count wrong');
assert.strictEqual(occurrences(oldHtml, 'calApptEdit_'), 4, 'old panel row count wrong');

/* both states honest: null-only day AND flagged-only day each get the chip */
const onlyNull = runCalOpenDay(NEW['ScribeFlow.html'], [fixture()[0], fixture()[3]]);
assert(occurrences(onlyNull, 'time not recorded') === 1 && onlyNull.indexOf('Row Alpha') < onlyNull.indexOf('Row Charlie'),
  'current state (start_at:null, no flag) is not handled');
const onlyFlag = runCalOpenDay(NEW['ScribeFlow.html'], [fixture()[1], fixture()[3]]);
assert(occurrences(onlyFlag, 'time not recorded') === 1 && onlyFlag.indexOf('Row Alpha') < onlyFlag.indexOf('Row Delta'),
  'post-repair state (time_unknown=1) is not handled');

console.log('PASS calOpenDay: new bytes sort unknown last + honest chip; old bytes fail exactly as diagnosed (nulls first + bare dash)');

/* ==== 3. every sibling comparator, extracted from the bytes ============== */
function comparatorAt(src, siteText) {
  const at = src.indexOf(siteText);
  assert(at >= 0, 'sort site not found: ' + siteText.slice(0, 60));
  const s = siteText.indexOf('function');
  assert(s >= 0, 'no callback in site: ' + siteText.slice(0, 60));
  let cb = siteText.slice(s);
  const close = cb.lastIndexOf('}');
  cb = cb.slice(0, close + 1);
  /* the staff-board comparator closes over `order`; inject it */
  return new Function('order', 'return (' + cb + ');')({ checked_in: 0, roomed: 1, booked: 2, completed: 3, no_show: 4, cancelled: 5 });
}
const SORT_EDITS = EDITS.filter(e => /\.sort\(function|a\.sort\(function|appts\.sort\(function|out\.sort\(function/.test(e.find));
assert(SORT_EDITS.length === 8, 'expected 8 sort edits, found ' + SORT_EDITS.length);

const timedEarly = { start_at: '2026-07-07T13:00:00.000Z', status: 'booked' };
const timedLate = { start_at: '2026-07-07T18:30:00.000Z', status: 'booked' };
const nullRow = { start_at: null, appt_date: '2026-07-07', status: 'booked' };
const flagRow = { start_at: null, appt_date: '2026-07-07', time_unknown: 1, status: 'booked' };

for (const e of SORT_EDITS) {
  const cNew = comparatorAt(NEW[e.file], e.replace);
  assert(cNew(timedEarly, nullRow) < 0 && cNew(nullRow, timedEarly) > 0, e.id + ': null row does not sort last');
  assert(cNew(timedEarly, flagRow) < 0 && cNew(flagRow, timedEarly) > 0, e.id + ': flagged row does not sort last');
  assert(cNew(timedEarly, timedLate) < 0, e.id + ': timed order broken');
  const cOld = comparatorAt(OLD[e.file], e.find);
  assert(cOld(nullRow, timedEarly) < 0, e.id + ': OLD comparator does not exhibit nulls-first - suite would not discriminate');
}
console.log('PASS sibling sorts: 8/8 comparators (month cells, day agenda, waiting room, board, QpAll, Who\'s-Next, picker, day chips) - new: timeless last; old: nulls first');

/* ==== 4. the epoch-time sites print honestly ============================== */
function fnFromLine(src, marker) {
  const line = extractLine(src, marker);
  return new Function('return (' + line.replace(/^function\s+\w+/, 'function') + ');')();
}
const fmtQpa = fnFromLine(NEW['mls-connect.js'], 'function fmtTime(iso){');
const fmtWn = fnFromLine(NEW['mls-connect.js'], 'function fmtTime(z){');
/* the OLD defect, proven on the file's own formatter: null -> THE EPOCH */
assert(/\d/.test(fmtQpa(null)) && /(AM|PM)/i.test(fmtQpa(null)), 'fmtTime(null) no longer prints an epoch clock time - update the old-defect proof');
assert(/\d/.test(fmtWn(null)), 'WN fmtTime(null) no longer prints an epoch clock time');

function exprValue(src, exprText, varName, row, fmt) {
  assert(occurrences(src, exprText) === 1, 'expression not present exactly once: ' + exprText.slice(0, 60));
  const inner = exprText.slice(exprText.indexOf("'+") + 2, exprText.lastIndexOf("+'"));
  return new Function(varName, 'fmtTime', 'esc', 'return (' + inner + ');')(row, fmt, s => String(s));
}
const QPA_NEW = '<span class="qpa-t">\'+esc((a.start_at&&!a.time_unknown)?fmtTime(a.start_at):\'time not recorded\')+\'</span>';
assert.strictEqual(exprValue(NEW['mls-connect.js'], QPA_NEW, 'a', nullRow, fmtQpa), 'time not recorded', 'QpAll: null row must print the honest text');
assert.strictEqual(exprValue(NEW['mls-connect.js'], QPA_NEW, 'a', flagRow, fmtQpa), 'time not recorded', 'QpAll: flagged row must print the honest text');
assert(/(AM|PM)/i.test(exprValue(NEW['mls-connect.js'], QPA_NEW, 'a', timedEarly, fmtQpa)), 'QpAll: timed row lost its time');

const WN_NEW = "esc((x.start_at&&!x.time_unknown)?fmtTime(x.start_at):'time not recorded')+' / DOB '";
assert(occurrences(NEW['mls-connect.js'], WN_NEW) === 1, 'Who\'s-Next honest expression missing');
const wnVal = new Function('x', 'fmtTime', 'esc', "return (x.start_at&&!x.time_unknown)?fmtTime(x.start_at):'time not recorded';")(nullRow, fmtWn, s => String(s));
assert.strictEqual(wnVal, 'time not recorded', 'Who\'s-Next: null row must print the honest text');

/* board + picker chip sites: honest in new bytes, dash/blank in old bytes */
assert(occurrences(NEW['ScribeFlow.html'], "const t=(a.start_at&&!a.time_unknown)?_fmtApptTime(a.start_at):'time not recorded';") === 1, 'board time line missing');
assert(occurrences(OLD['ScribeFlow.html'], "const t=a.start_at?_fmtApptTime(a.start_at):'';") === 1, 'old board time line missing');
assert(occurrences(NEW['feat_mls_patientpick.js'], '((tStr && !p.time_unknown) ? esc(tStr) : "time not recorded")') === 1, 'picker pill honest text missing');
assert(occurrences(OLD['feat_mls_patientpick.js'], '(tStr ? esc(tStr) : "&mdash;")') === 1, 'old picker pill dash missing');
assert(occurrences(NEW['feat_mls_patientpick.js'], 'time_unknown: a.time_unknown ? 1 : 0,') === 1, 'picker rows do not carry the flag');

console.log('PASS honest chips: epoch-time defect proven on old formatter; QpAll/Who\'s-Next/board/picker print "time not recorded" for both timeless states');

console.log('PASS time-unknown display contract (td-1.0): 420 timeless rows sort last and say so plainly, on today\'s nulls and tomorrow\'s flags alike');
