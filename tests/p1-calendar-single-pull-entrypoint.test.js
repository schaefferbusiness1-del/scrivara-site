'use strict';

/*
 * DEFECT 1 (2026-08-16): the /1p Calendar showed FOUR pull entry points.
 * Diagnosis (already done, this test only verifies the fix):
 *   #1 the hero, #mlsCvNxt_calendar, built by FROZEN feat_mls_calm_views.js
 *      -> KEEP. The one surviving, live, clickable pull control.
 *   #2 .t3e-pull inside #mlsT3Empty, built by 1p-feat_task3_frontsync.js
 *      -> REMOVED as a second pull entry point; the empty state now points
 *         at the hero in plain text instead of duplicating it.
 *   #3 #mlsCalProviderPull, FROZEN feat_mls_calendar_polish.js:373,
 *      permanently disabled (roster never verifies)
 *      -> HIDDEN via CSS injected from an editable 1p file (frozen files
 *         may only be overridden, never edited).
 *   #4 #mlsCalEmptyActions "Pull this schedule from athenaOne ->" inside a
 *      display:none host, built by 1p-mls-connect.js
 *      -> DELETED outright (it was dead).
 * Also verifies the empty-state text was NOT left starting with the exact
 * string feat_athena_clarity.js:40 prefix-matches ("pull from athena"),
 * which would otherwise weld a per-patient chart-pull explanation onto a
 * whole-day schedule pull control.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

const frontsync = read('1p-feat_task3_frontsync.js');
const connect = read('1p-mls-connect.js');
const calmViews = read('feat_mls_calm_views.js');
const calendarPolish = read('feat_mls_calendar_polish.js');

/* ---- Control #1: the hero survives, untouched, in the frozen file ---- */
assert(calmViews.includes("key: 'calendar'") && calmViews.includes("id: 'calendarView'"),
  'the calendar hero view definition must remain present and untouched in the frozen shell');
assert(calmViews.includes("var id = 'mlsCvNxt_' + v.key;"),
  'the hero’s DOM id (mlsCvNxt_calendar for the calendar view) must still be built the same way');

/* ---- Control #2: the empty-state duplicate pull button is gone ---- */
assert(!/class="t3e-pull"/.test(frontsync),
  'the empty-state .t3e-pull duplicate pull button must be removed from 1p-feat_task3_frontsync.js');
assert(!frontsync.includes("el.querySelector('.t3e-pull')"),
  'the empty-state must no longer wire a second pull click handler');
assert(frontsync.includes('use the Pull button above'),
  'the empty-state must point the doctor at the one surviving hero pull control instead of duplicating it');

/* ---- Control #3: the frozen dead button is hidden via CSS, never edited directly ---- */
assert(!calendarPolish.includes('mlsCalHideDeadPull') && !calendarPolish.includes('p1-cal-hide-dead-provider-pull'),
  'feat_mls_calendar_polish.js is FROZEN and must never carry the 1p hide-fix directly');
assert(connect.includes("'#mlsCalProviderPull{display:none!important}'"),
  '1p-mls-connect.js must CSS-hide the permanently-disabled #mlsCalProviderPull button');
assert(connect.includes("'#mlsCalProviderPullStatus{display:none!important}'") &&
  connect.includes("'#mlsCalProviderPullBar{display:none!important}'"),
  '1p-mls-connect.js must also hide the dead button’s status line and progress bar');
assert(connect.includes('Finish a full Athena Day-schedule sweep'),
  '1p-mls-connect.js must hide the "Roster still verifying" notice that exists only to explain the dead button');

/* ---- Control #4: the fully invisible duplicate is deleted outright ---- */
assert(!/textContent\s*=\s*'Pull this schedule from athenaOne/.test(connect),
  'the dead #mlsCalEmptyActions "Pull this schedule from athenaOne" button text must be deleted, not merely hidden');
assert(!/var b2\s*=\s*document\.createElement\('button'\)/.test(connect),
  'the #mlsCalEmptyActions second (b2) button must no longer be constructed');

/* ---- No remaining button label triggers feat_athena_clarity.js:40's prefix match ---- */
function buttonLabelsFromHtml(src) {
  const labels = [];
  const re = /<button[^>]*>([^<]*)<\/button>/g;
  let m;
  while ((m = re.exec(src))) labels.push(m[1]);
  return labels;
}
function buttonLabelsFromTextContentAssignments(src) {
  const labels = [];
  const re = /\.textContent\s*=\s*'([^']*)'/g;
  let m;
  while ((m = re.exec(src))) labels.push(m[1]);
  return labels;
}
const TRIGGER = 'pull from athena';
[
  ['1p-feat_task3_frontsync.js', frontsync],
  ['1p-mls-connect.js', connect]
].forEach(([file, src]) => {
  buttonLabelsFromHtml(src).concat(buttonLabelsFromTextContentAssignments(src)).forEach((label) => {
    const norm = String(label).replace(/\s+/g, ' ').trim().toLowerCase();
    assert(norm.indexOf(TRIGGER) !== 0,
      `${file} still creates a button labelled "${label}" which prefix-matches feat_athena_clarity.js:40’s ` +
      `"pull from athena" and would weld a per-patient chart-pull explanation onto a whole-day schedule pull`);
  });
});

console.log('PASS p1 calendar single pull entry point: hero kept, three duplicate/dead controls removed or hidden, no clarity-script trigger label remains');
