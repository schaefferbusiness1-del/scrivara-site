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

function exactMarker(source, marker, label) {
  const first = source.indexOf(marker);
  if (first < 0) throw new Error(label + ': expected marker was not found');
  if (source.indexOf(marker, first + marker.length) >= 0) {
    throw new Error(label + ': expected marker is ambiguous');
  }
  return first;
}

let connect = fs.readFileSync(connectPath, 'latin1');
let test = fs.readFileSync(testPath, 'utf8');

const ownerMarker = "var VER = '3.7.3';";
const markerAt = exactMarker(connect, ownerMarker, 'active Easy owner');
const ownerStart = connect.lastIndexOf('(function () {', markerAt);
const ownerEnd = connect.indexOf('\n})();', markerAt);
if (ownerStart < 0 || ownerEnd <= ownerStart) {
  throw new Error('active Easy owner: exact function boundary was not found');
}

let owner = connect.slice(ownerStart, ownerEnd);
owner = replaceExactlyOnce(
  owner,
  "  function homeStatus() {\n    var prov = activeProvider(), g = guardInfo();",
  "  function setHomeStatusHtml(st, hs) {\n    if (!st) return;\n    if (st.__ez3HomeStatusSrc === hs && st.innerHTML === st.__ez3HomeStatusRendered) return;\n    st.innerHTML = hs;\n    st.__ez3HomeStatusSrc = hs;\n    st.__ez3HomeStatusRendered = st.innerHTML;\n  }\n\n  function homeStatus() {\n    var prov = activeProvider(), g = guardInfo();",
  'active Easy canonical status writer'
);

owner = replaceExactlyOnce(
  owner,
  "        var st = $('ez3HomeStatus'); if (st) { var hs = homeStatus(); if (st.innerHTML !== hs) st.innerHTML = hs; }",
  "        var st = $('ez3HomeStatus'); if (st) setHomeStatusHtml(st, homeStatus());",
  'active Easy canonical status writer call'
);

connect = connect.slice(0, ownerStart) + owner + connect.slice(ownerEnd);

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
  'canonical Easy home-status runtime contract'
);

const postMarkerAt = exactMarker(connect, ownerMarker, 'active Easy owner postcondition');
const postOwnerStart = connect.lastIndexOf('(function () {', postMarkerAt);
const postOwnerEnd = connect.indexOf('\n})();', postMarkerAt);
const postOwner = connect.slice(postOwnerStart, postOwnerEnd);
if (!postOwner.includes('function setHomeStatusHtml(st, hs) {') ||
    !postOwner.includes('st.__ez3HomeStatusRendered = st.innerHTML;') ||
    !postOwner.includes("if (st) setHomeStatusHtml(st, homeStatus());") ||
    postOwner.includes('if (st.innerHTML !== hs) st.innerHTML = hs;') ||
    !test.includes('browser-canonical punctuation caused a stable Home status rewrite') ||
    !test.includes('external Home status mutation did not self-heal')) {
  throw new Error('active Easy canonical status postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Made Easy Home status writes stable across browser HTML canonicalization.');
