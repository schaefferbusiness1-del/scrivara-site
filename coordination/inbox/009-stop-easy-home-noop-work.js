'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const testPath = path.join(root, 'tests', 'interaction-performance-contract.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

let connect = fs.readFileSync(connectPath, 'latin1');
let test = fs.readFileSync(testPath, 'utf8');

connect = replaceExactlyOnce(
  connect,
  "  function homeStatus() {\n    var prov = activeProvider(), rows = dayRows(visitDay());\n    var seen = rows.filter(isSeen).length, g = guardInfo();\n    var bits = [];",
  "  function setHomeStatusHtml(st, hs) {\n    if (!st) return;\n    if (st.__ez3HomeStatusSrc === hs && st.innerHTML === st.__ez3HomeStatusRendered) return;\n    st.innerHTML = hs;\n    st.__ez3HomeStatusSrc = hs;\n    st.__ez3HomeStatusRendered = st.innerHTML;\n  }\n\n  function homeStatus() {\n    var prov = activeProvider(), g = guardInfo();\n    var bits = [];",
  'active Easy dead home-status roster scan'
);

connect = replaceExactlyOnce(
  connect,
  "        var st = $('ez3HomeStatus'); if (st) st.innerHTML = homeStatus();\n      } else if (S.mode === 'doctor' && S.screen === 'choose') {",
  "        var st = $('ez3HomeStatus'); if (st) setHomeStatusHtml(st, homeStatus());\n      } else if (S.mode === 'doctor' && S.screen === 'choose') {",
  'active Easy stable home-status write guard'
);

test = replaceExactlyOnce(
  test,
  "console.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');",
  "/* 2026-07-29: the active 700ms Easy Home poll must not rescan the roster for\n * unused status values or replace an unchanged status subtree. */\nconst easyV373Start = connect.indexOf(\"var VER = '3.7.3';\");\nconst easyV373End = connect.indexOf('window.__mlsEasyV32 = api;', easyV373Start);\nassert(easyV373Start >= 0 && easyV373End > easyV373Start, 'active Easy 3.7.3 owner slice is missing');\nconst easyV373 = connect.slice(easyV373Start, easyV373End);\nconst easyHomeStatusStart = easyV373.indexOf('function homeStatus() {');\nconst easyHomeStatusEnd = easyV373.indexOf('\\n  function homeSig() {', easyHomeStatusStart);\nconst easyHomeStatus = easyV373.slice(easyHomeStatusStart, easyHomeStatusEnd);\nassert(easyHomeStatusStart >= 0 && easyHomeStatusEnd > easyHomeStatusStart,\n  'active Easy homeStatus slice is missing');\nassert(!easyHomeStatus.includes('dayRows(') && !easyHomeStatus.includes('isSeen'),\n  'homeStatus returned to unused per-appointment roster/seen work');\nassert(easyV373.includes(\"var hs = homeStatus(); if (st.innerHTML !== hs) st.innerHTML = hs;\"),\n  'stable Easy status HTML can still be replaced every 700ms');\nassert(!easyV373.includes(\"if (st) st.innerHTML = homeStatus();\"),\n  'unguarded Easy status subtree replacement returned');\n\nconsole.log('PASS interaction performance: native Settings scroll, loader-safe timers/calls, bounded agents, exact SW lifetime, deferred polish, and da-1.1.1');",
  'active Easy home-poll cost contract'
);

test = replaceExactlyOnce(
  test,
  `assert(easyV373.includes("var hs = homeStatus(); if (st.innerHTML !== hs) st.innerHTML = hs;"),
  'stable Easy status HTML can still be replaced every 700ms');
assert(!easyV373.includes("if (st) st.innerHTML = homeStatus();"),
  'unguarded Easy status subtree replacement returned');`,
  `assert(easyV373.includes("if (st) setHomeStatusHtml(st, homeStatus());"),
  'stable Easy status HTML does not use the canonical write guard');
assert(!easyV373.includes("if (st) st.innerHTML = homeStatus();"),
  'unguarded Easy status subtree replacement returned');

const statusWriterStart = easyV373.indexOf('function setHomeStatusHtml(st, hs) {');
const statusWriterEnd = easyV373.indexOf('\\n\\n  function homeStatus() {', statusWriterStart);
assert(statusWriterStart >= 0 && statusWriterEnd > statusWriterStart,
  'active Easy canonical status writer is missing');
const statusWriterSource = easyV373.slice(statusWriterStart, statusWriterEnd);
const statusWriterCtx = {};
vm.runInNewContext(statusWriterSource + '\\nthis.setHomeStatusHtml=setHomeStatusHtml;', statusWriterCtx,
  { filename: 'easy-home-status-writer.js' });
let statusWrites = 0, canonicalStatusHtml = '';
const statusNode = {};
Object.defineProperty(statusNode, 'innerHTML', {
  configurable: true,
  get() { return canonicalStatusHtml; },
  set(value) {
    statusWrites++;
    canonicalStatusHtml = String(value)
      .replace(/&#39;/g, "'")
      .replace(/&quot;/g, '"')
      .replace(/&amp;/g, '&');
  }
});
const punctuatedStatus = '<span><b>Dr. Synthetic O&#39;Name &amp; &quot;West&quot;</b></span>';
statusWriterCtx.setHomeStatusHtml(statusNode, punctuatedStatus);
assert.strictEqual(statusWrites, 1, 'initial punctuated Home status was not written exactly once');
statusWriterCtx.setHomeStatusHtml(statusNode, punctuatedStatus);
assert.strictEqual(statusWrites, 1,
  'browser-canonical punctuation caused a stable Home status rewrite');
const changedStatus = '<span><b>Dr. Synthetic O&#39;Name &amp; &quot;East&quot;</b></span>';
statusWriterCtx.setHomeStatusHtml(statusNode, changedStatus);
assert.strictEqual(statusWrites, 2, 'changed Home status did not repaint exactly once');
canonicalStatusHtml = '<span>external replacement</span>';
statusWriterCtx.setHomeStatusHtml(statusNode, changedStatus);
assert.strictEqual(statusWrites, 3, 'external Home status mutation did not self-heal');`,
  'canonical Easy home-status writer contract'
);

const easyStart = connect.indexOf("var VER = '3.7.3';");
const easyEnd = connect.indexOf('window.__mlsEasyV32 = api;', easyStart);
const easy = connect.slice(easyStart, easyEnd);
const statusStart = easy.indexOf('function homeStatus() {');
const statusEnd = easy.indexOf('\n  function homeSig() {', statusStart);
const status = easy.slice(statusStart, statusEnd);
if (easyStart < 0 || easyEnd <= easyStart || statusStart < 0 || statusEnd <= statusStart ||
    status.includes('dayRows(') || status.includes('isSeen') ||
    !easy.includes('function setHomeStatusHtml(st, hs) {') ||
    !easy.includes('st.__ez3HomeStatusRendered = st.innerHTML;') ||
    !easy.includes("if (st) setHomeStatusHtml(st, homeStatus());")) {
  throw new Error('active Easy home-poll postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Removed dead Easy home scans and guarded unchanged status HTML.');
