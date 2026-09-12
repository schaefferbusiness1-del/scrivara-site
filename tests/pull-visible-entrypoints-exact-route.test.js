/*
 * Every visible day-history control must enter the guarded schedule importer.
 * The bundle still contains retired engines for compatibility/state readers;
 * this contract proves they are hidden and no current shortcut presses them.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONNECT = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');
const IMPORTER = fs.readFileSync(path.join(ROOT, '1p-feat_mls_schedimport_exact.js'), 'utf8');
const B121 = fs.readFileSync(path.join(ROOT, '1p-feat_mls_b121_pack.js'), 'utf8');

function between(source, from, to, label) {
  const start = source.indexOf(from);
  assert(start >= 0, label + ': start marker is missing');
  const end = source.indexOf(to, start + from.length);
  assert(end > start, label + ': end marker is missing');
  return source.slice(start, end);
}

const staffShortcut = between(
  CONNECT,
  '/* (2b) Pull day histories moved home.',
  '/* honor a day preset chosen from the doctor-view chip */',
  'Staff practice-tools history shortcut'
);
assert(/\$\('ez3sPullToday'\)/.test(staffShortcut),
  'Staff history shortcut must press the canonical Staff exact-day control');
assert(!/\$\('mlsDayHistBtn'\)|mlsAppSearchOpenPatient/.test(staffShortcut),
  'Staff history shortcut must not reach the retired name-only day-pull button');

assert(/body #mlsDayHistBtn,body #cfxBulkHistBtn\{display:none !important;\}/.test(CONNECT),
  'both retired fixed-position pull buttons must be permanently hidden');

const staffDay = between(CONNECT, 'function startDayPull(', 'function staffRangeBounds()', 'Staff exact-day pull');
assert(/exact\.dayPull\(dpOpts\)/.test(staffDay),
  'Staff Pull today must enter __mlsSI.dayPull with its frozen options');

const visitPull = between(CONNECT, 'function startPull(autoRetry, providerOverride)', 'function onEasyVisitDayChanged(', 'Visit day pull');
assert(/si\.dayPull\(dpOpts\)/.test(visitPull),
  'Visit Pull must enter __mlsSI.dayPull');
const visitRetry = between(CONNECT, 'function retryFailedHistories(cvOpts)', 'function dsAutoConvergeBodies(', 'Visit failed-history retry');
assert(/importer\.retryFailedHistory\(source/.test(visitRetry),
  'Visit Retry failed histories must enter the importer retry lane');
const attentionRetry = between(CONNECT, 'function retryAttentionCharts()', 'function dsIdentityQueue()', 'Visit attention retry');
assert(/si\.retryAttention\(day/.test(attentionRetry),
  'Visit Finish charts needing attention must enter the importer attention lane');

const calendarHero = between(
  CONNECT,
  '/* ============================================================\n * p1-cal-hero-pull-contract',
  '/* ===== calmbar-1.0.0',
  'Calendar hero pull'
);
assert(/si\.dayPull\(dpOpts\)/.test(calendarHero),
  'Calendar hero Pull must enter __mlsSI.dayPull');

const staffSpecificDay = between(
  B121,
  "var btn = row.querySelector('#mlsPadBtn');",
  "row.querySelector('#mlsPadNote').innerHTML",
  'Staff specific-day pull'
);
assert(/window\.__mlsDaySwitch/.test(staffSpecificDay) && /ds\.setDay\(day\)/.test(staffSpecificDay) && /ds\.pullDay\(\)/.test(staffSpecificDay),
  'Staff specific-day pull must proxy through the canonical DaySwitch owner');
assert(!/runFlow\(|importDay\(|__mlsProvMonthPull/.test(staffSpecificDay),
  'Staff specific-day pull must not enter its retired private import/chart engine');

const exactTarget = between(IMPORTER, 'function exactHistoryTarget(row)', 'function frozenRetryEntry(', 'exact history target');
for (const field of ['patientId', 'name', 'dob', 'mrn', 'appointmentId', 'scheduleDate']) {
  assert(new RegExp('\\b' + field + '\\b').test(exactTarget),
    'exact history target lost ' + field);
}
assert(/Object\.freeze\(exactSnap\)/.test(exactTarget),
  'the exact history target must be immutable before Athena is driven');

console.log('PASS pull-visible-entrypoints-exact-route: every current visible day pull/retry routes through the guarded importer; retired buttons stay hidden.');
