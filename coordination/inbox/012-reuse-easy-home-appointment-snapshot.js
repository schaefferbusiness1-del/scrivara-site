'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const visitDayTestPath = path.join(root, 'tests', 'visit-day-ownership-contract.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

function exactMarker(source, marker, label) {
  const first = source.indexOf(marker);
  if (first < 0) throw new Error(label + ': expected marker was not found');
  if (source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(label + ': expected marker is ambiguous');
  }
  return first;
}

let connect = fs.readFileSync(connectPath, 'latin1');
let visitDayTest = fs.readFileSync(visitDayTestPath, 'utf8');

const ownerMarker = "var VER = '3.7.3';";
const markerAt = exactMarker(connect, ownerMarker, 'active Easy owner');
const ownerStart = connect.lastIndexOf('(function () {', markerAt);
const ownerEnd = connect.indexOf('\n})();', markerAt);
if (ownerStart < 0 || ownerEnd <= ownerStart) {
  throw new Error('active Easy owner: exact function boundary was not found');
}

let owner = connect.slice(ownerStart, ownerEnd);
if (!owner.includes("  function homeStatus() {\n    var prov = activeProvider(), g = guardInfo();") ||
    !owner.includes('function setHomeStatusHtml(st, hs) {') ||
    !owner.includes("if (st) setHomeStatusHtml(st, homeStatus());")) {
  throw new Error('proposal 012 requires proposal 009 to be applied first');
}

owner = replaceExactlyOnce(
  owner,
  "  function timeContext() {\n    var rows = dayRows(visitDay()).filter(function (a) { return !isSeen(a); });",
  "  function timeContext() {\n    var allRows = arguments.length ? arguments[0] : dayRows(visitDay());\n    var rows = allRows.filter(function (a) { return !isSeen(a); });",
  'active Easy time-context snapshot input'
);

owner = replaceExactlyOnce(
  owner,
  "  function homeSig() {\n    var tc = timeContext();",
  "  function homeSig() {\n    var allRows = arguments.length ? arguments[0] : dayRows(visitDay());\n    var tc = arguments.length > 1 ? arguments[1] : timeContext(allRows);",
  'active Easy home-signature snapshot input'
);

owner = replaceExactlyOnce(
  owner,
  "'|' + (lateLine(tc) ? '1' : '0') + '|' + dayRows(visitDay()).length + '|' + (isRecording() ? 'R' : '') + '|' + apk;",
  "'|' + (lateLine(tc) ? '1' : '0') + '|' + allRows.length + '|' + (isRecording() ? 'R' : '') + '|' + apk;",
  'active Easy home-signature all-row count'
);

owner = replaceExactlyOnce(
  owner,
  "  function renderHome() {\n    var rows = dayRows(visitDay());\n    var tc = timeContext(), late = lateLine(tc);\n    S._homeSig = homeSig();",
  "  function renderHome() {\n    var rows = dayRows(visitDay());\n    var tc = timeContext(rows), late = lateLine(tc);\n    S._homeSig = homeSig(rows, tc);",
  'active Easy Home render snapshot reuse'
);

owner = replaceExactlyOnce(
  owner,
  "        var ck = $('ez3Clock'); if (ck) ck.textContent = '\u00f0\u009f\u0095\u0090 ' + fmtClock();\n        if (homeSig() !== S._homeSig) { render(); return; }\n        var lt = $('ez3Late'); if (lt) { var l = lateLine(timeContext()); if (l) lt.textContent = '\u00e2\u008f\u00b0 ' + l; }\n        var st = $('ez3HomeStatus'); if (st) setHomeStatusHtml(st, homeStatus());",
  "        var ck = $('ez3Clock'); if (ck) ck.textContent = '\u00f0\u009f\u0095\u0090 ' + fmtClock();\n        var rows = dayRows(visitDay()), tc = timeContext(rows);\n        if (homeSig(rows, tc) !== S._homeSig) { render(); return; }\n        var lt = $('ez3Late'); if (lt) { var l = lateLine(tc); if (l) lt.textContent = '\u00e2\u008f\u00b0 ' + l; }\n        var st = $('ez3HomeStatus'); if (st) setHomeStatusHtml(st, homeStatus());",
  'active Easy stable Home poll snapshot reuse after proposal 009'
);

connect = connect.slice(0, ownerStart) + owner + connect.slice(ownerEnd);

visitDayTest = replaceExactlyOnce(
  visitDayTest,
  "const homeSig = functionSource(easy, 'homeSig', 'recBannerHtml');\nassert(homeSig.includes(\"visitDay() + '|'\"), 'Home invalidation is not selected-day owned');\nassert(homeSig.includes('dayRows(visitDay()).length'), 'Home invalidation ignores selected-day rows');\n\nconst renderHome = functionSource(easy, 'renderHome', 'hasPrep');\nassert(renderHome.includes('var rows = dayRows(visitDay());'), 'Home does not render the selected day');\nassert(renderHome.includes('fmtToday()'), 'Home does not render the selected date label');",
  "const timeContext = functionSource(easy, 'timeContext', 'lateLine');\nassert(timeContext.includes('var allRows = arguments.length ? arguments[0] : dayRows(visitDay());'),\n  'Home time context cannot consume one selected-day appointment snapshot');\nassert(timeContext.includes('var rows = allRows.filter'),\n  'Home time context does not preserve seen filtering over the supplied snapshot');\n\nconst homeSig = functionSource(easy, 'homeSig', 'recBannerHtml');\nassert(homeSig.includes(\"visitDay() + '|'\"), 'Home invalidation is not selected-day owned');\nassert(homeSig.includes('var allRows = arguments.length ? arguments[0] : dayRows(visitDay());'),\n  'Home invalidation cannot own or consume one selected-day snapshot');\nassert(homeSig.includes('var tc = arguments.length > 1 ? arguments[1] : timeContext(allRows);'),\n  'Home invalidation recomputes time context when the caller already has it');\nassert(homeSig.includes(\"'|' + allRows.length + '|'\"),\n  'Home invalidation must count every selected-day row, including seen rows');\nassert(!homeSig.includes('dayRows(visitDay()).length'),\n  'Home invalidation returned to a second selected-day appointment scan');\n\nconst renderHome = functionSource(easy, 'renderHome', 'hasPrep');\nassert(renderHome.includes('var rows = dayRows(visitDay());'), 'Home does not render the selected day');\nassert(renderHome.includes('var tc = timeContext(rows), late = lateLine(tc);'),\n  'Home render does not reuse its selected-day snapshot for time context');\nassert(renderHome.includes('S._homeSig = homeSig(rows, tc);'),\n  'Home render does not reuse its snapshot and time context for invalidation');\nassert.strictEqual((renderHome.match(/dayRows\\(visitDay\\(\\)\\)/g) || []).length, 1,\n  'Home render performs more than one selected-day appointment scan');\nassert(renderHome.includes('fmtToday()'), 'Home does not render the selected date label');\n\nconst pollStart = easy.indexOf('pollIv = setInterval(function () {');\nconst pollEnd = easy.indexOf('\\n    }, 700);', pollStart);\nassert(pollStart >= 0 && pollEnd > pollStart, 'active Easy poll could not be bounded');\nconst poll = easy.slice(pollStart, pollEnd);\nconst pollHomeStart = poll.indexOf(\"} else if (S.mode === 'doctor' && S.screen === 'home') {\");\nconst pollChooseStart = poll.indexOf(\"} else if (S.mode === 'doctor' && S.screen === 'choose') {\", pollHomeStart);\nassert(pollHomeStart >= 0 && pollChooseStart > pollHomeStart, 'active Easy Home poll branch could not be bounded');\nconst pollHome = poll.slice(pollHomeStart, pollChooseStart);\nassert.strictEqual((pollHome.match(/dayRows\\(visitDay\\(\\)\\)/g) || []).length, 1,\n  'stable Home poll performs more than one selected-day appointment scan');\nassert(pollHome.includes('var rows = dayRows(visitDay()), tc = timeContext(rows);'),\n  'stable Home poll does not derive time context from its one snapshot');\nassert(pollHome.includes('homeSig(rows, tc)') && pollHome.includes('lateLine(tc)'),\n  'stable Home poll does not share one context between invalidation and lateness');\n\n/* 2026-07-29: execute the active functions with generated rows. The signature\n * must scan once when called alone, scan zero times with a caller snapshot,\n * and count all scheduled rows rather than only the unseen time-context rows. */\n{\n  const generatedRows = [\n    { id: 'row-a', seen: false },\n    { id: 'row-b', seen: true },\n    { id: 'row-c', seen: false }\n  ];\n  const ctx = {\n    S: { autoPull: 'idle' },\n    dayRowsCalls: 0,\n    dayRows(day) { ctx.dayRowsCalls++; assert.strictEqual(day, '2026-07-29'); return generatedRows; },\n    visitDay() { return '2026-07-29'; },\n    visitIsToday() { return false; },\n    isSeen(row) { return row.seen; },\n    rowKey(row) { return row.id; },\n    lateLine() { return ''; },\n    isRecording() { return false; },\n    isFn(value) { return typeof value === 'function'; },\n    window: { verifiedActivePatient() { return null; }, activePatient() { return null; } },\n    assert\n  };\n  vm.createContext(ctx);\n  vm.runInContext(`${timeContext}\\n${homeSig}\\nthis.snapshotApi = { timeContext, homeSig };`, ctx);\n\n  const standaloneSig = ctx.snapshotApi.homeSig();\n  assert.strictEqual(ctx.dayRowsCalls, 1, 'standalone Home invalidation must scan appointments exactly once');\n  assert.strictEqual(standaloneSig.split('|')[5], '3',\n    'standalone Home invalidation lost the all-row count when one row was seen');\n\n  ctx.dayRowsCalls = 0;\n  const suppliedContext = ctx.snapshotApi.timeContext(generatedRows);\n  const suppliedSig = ctx.snapshotApi.homeSig(generatedRows, suppliedContext);\n  assert.strictEqual(ctx.dayRowsCalls, 0, 'caller-supplied Home snapshot unexpectedly rescanned appointments');\n  assert.strictEqual(suppliedContext.rows.length, 2, 'time context no longer filters seen rows');\n  assert.strictEqual(suppliedSig.split('|')[5], '3',\n    'caller-supplied Home invalidation counted unseen rows instead of all rows');\n}",
  'selected-day Home snapshot contracts'
);

const postMarkerAt = exactMarker(connect, ownerMarker, 'active Easy owner postcondition');
const postOwnerStart = connect.lastIndexOf('(function () {', postMarkerAt);
const postOwnerEnd = connect.indexOf('\n})();', postMarkerAt);
const postOwner = connect.slice(postOwnerStart, postOwnerEnd);
const postPollStart = postOwner.indexOf('pollIv = setInterval(function () {');
const postPollEnd = postOwner.indexOf('\n    }, 700);', postPollStart);
const postPoll = postOwner.slice(postPollStart, postPollEnd);
const postHomeStart = postPoll.indexOf("} else if (S.mode === 'doctor' && S.screen === 'home') {");
const postChooseStart = postPoll.indexOf("} else if (S.mode === 'doctor' && S.screen === 'choose') {", postHomeStart);
const postHome = postPoll.slice(postHomeStart, postChooseStart);
if (!postOwner.includes('var allRows = arguments.length ? arguments[0] : dayRows(visitDay());') ||
    !postOwner.includes('S._homeSig = homeSig(rows, tc);') ||
    !postOwner.includes("'|' + allRows.length + '|'") ||
    postHomeStart < 0 || postChooseStart <= postHomeStart ||
    (postHome.match(/dayRows\(visitDay\(\)\)/g) || []).length !== 1 ||
    !postHome.includes('homeSig(rows, tc)') ||
    !postHome.includes('lateLine(tc)') ||
    !postHome.includes("if (st) setHomeStatusHtml(st, homeStatus());")) {
  throw new Error('active Easy appointment-snapshot postcondition failed');
}
if (!visitDayTest.includes('standalone Home invalidation must scan appointments exactly once') ||
    !visitDayTest.includes('caller-supplied Home snapshot unexpectedly rescanned appointments')) {
  throw new Error('selected-day snapshot runtime contract postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(visitDayTestPath, visitDayTest, 'utf8');

console.log('Reused one selected-day appointment snapshot across Easy Home work.');
