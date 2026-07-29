'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const connectPath = path.join(root, 'mls-connect.js');
const testPath = path.join(root, 'tests', 'sanitize-regex-linear-time.test.js');

function replaceExactlyOnce(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': expected source text was not found');
  const second = source.indexOf(before, first + before.length);
  if (second >= 0) throw new Error(label + ': expected source text is ambiguous');
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const helper =
  "  function stripBlocks(s, openRe, closeRe) {\n" +
  "    var out = [], at = 0, op, cl; openRe.lastIndex = 0; closeRe.lastIndex = 0;\n" +
  "    while ((op = openRe.exec(s))) {\n" +
  "      closeRe.lastIndex = openRe.lastIndex; cl = closeRe.exec(s); if (!cl) break;\n" +
  "      out.push(s.slice(at, op.index), '\\n'); at = closeRe.lastIndex; openRe.lastIndex = at;\n" +
  "    }\n" +
  "    out.push(s.slice(at)); return out.join('');\n" +
  "  }\n";

let connect = fs.readFileSync(connectPath, 'latin1');
let test = fs.readFileSync(testPath, 'utf8');

connect = replaceExactlyOnce(
  connect,
  '  function strip(text) {',
  helper + '  function strip(text) {',
  'v2 forward-only block helper'
);

connect = replaceExactlyOnce(
  connect,
  '  function stripChartCode(text) {',
  helper + '  function stripChartCode(text) {',
  'base forward-only block helper'
);

connect = replaceExactlyOnce(
  connect,
  "    if (!hasCode(s)) return s;\n    s = s.replace(/<script[\\s\\S]*?<\\/script>/gi, '\\n').replace(/<style[\\s\\S]*?<\\/style>/gi, '\\n').replace(/<!--[\\s\\S]*?-->/g, '\\n');\n    var lines = s.split(/\\r?\\n/);\n    var mark = lines.map(function (ln) { return isCode(ln.trim()); });",
  "    if (!hasCode(s)) return s;\n    s = stripBlocks(s, /<script/gi, /<\\/script>/gi);\n    s = stripBlocks(s, /<style/gi, /<\\/style>/gi);\n    s = stripBlocks(s, /<!--/g, /-->/g);\n    var lines = s.split(/\\r?\\n/);\n    var mark = lines.map(function (ln) { return isCode(ln.trim()); });",
  'v2 forward-only block removal'
);

connect = replaceExactlyOnce(
  connect,
  "    if (!hasCode(s)) return s; // fast path: nothing to strip\n    s = s.replace(/<script[\\s\\S]*?<\\/script>/gi, '\\n').replace(/<style[\\s\\S]*?<\\/style>/gi, '\\n').replace(/<!--[\\s\\S]*?-->/g, '\\n');\n    var lines = s.split(/\\r?\\n/), kept = [];",
  "    if (!hasCode(s)) return s; // fast path: nothing to strip\n    s = stripBlocks(s, /<script/gi, /<\\/script>/gi);\n    s = stripBlocks(s, /<style/gi, /<\\/style>/gi);\n    s = stripBlocks(s, /<!--/g, /-->/g);\n    var lines = s.split(/\\r?\\n/), kept = [];",
  'base forward-only block removal'
);

test = replaceExactlyOnce(
  test,
  "console.log('PASS sanitize regex linear time: coordinate rule guarded+bounded (both copies verified by literal), collapse linear on NBSP/CR runs, clinical dose lines never flagged');",
  `/* 2026-07-29: lazy wildcard block removers retry from every unclosed opener.
 * Extract the live forward-only helper and prove equivalence plus a hard miss. */
const oldScriptBlock = '/<script[\\s\\S]*?<\\/script>/gi';
const oldStyleBlock = '/<style[\\s\\S]*?<\\/style>/gi';
const oldCommentBlock = '/<!--[\\s\\S]*?-->/g';
assert(!src.includes(oldScriptBlock) && !src.includes(oldStyleBlock) && !src.includes(oldCommentBlock),
  'a quadratic lazy-wildcard block remover returned');
assert.strictEqual((src.match(/function stripBlocks\\(s, openRe, closeRe\\)/g) || []).length, 2,
  'both sanitizer scopes must own one forward-only block helper');
const stripBlocksAt = src.indexOf('  function stripBlocks(s, openRe, closeRe) {');
const stripBlocksEnd = src.indexOf('\\n  function strip(text) {', stripBlocksAt);
assert(stripBlocksAt >= 0 && stripBlocksEnd > stripBlocksAt,
  'could not extract the live v2 block helper');
const stripBlocksCtx = {};
vm.runInNewContext(src.slice(stripBlocksAt, stripBlocksEnd) + '\\nthis.stripBlocks = stripBlocks;', stripBlocksCtx,
  { filename: 'sanitize-strip-blocks.js' });
function stripBlocksNew(s) {
  s = stripBlocksCtx.stripBlocks(s, /<script/gi, /<\\/script>/gi);
  s = stripBlocksCtx.stripBlocks(s, /<style/gi, /<\\/style>/gi);
  return stripBlocksCtx.stripBlocks(s, /<!--/g, /-->/g);
}
function stripBlocksLegacy(s) {
  return s.replace(/<script[\\s\\S]*?<\\/script>/gi, '\\n')
    .replace(/<style[\\s\\S]*?<\\/style>/gi, '\\n')
    .replace(/<!--[\\s\\S]*?-->/g, '\\n');
}
const mixedBlocks = 'before<ScRiPt>one</sCrIpT>middle<style>two</style><!--three-->after';
assert.strictEqual(stripBlocksNew(mixedBlocks), stripBlocksLegacy(mixedBlocks),
  'forward-only helper changed complete mixed-case block semantics');
const unmatchedBlocks = '<script'.repeat(16000);
t0 = Date.now();
assert.strictEqual(stripBlocksNew(unmatchedBlocks), unmatchedBlocks,
  'an unclosed opener must remain unchanged');
assert(Date.now() - t0 < 200,
  'forward-only block removal exceeded 200ms on repeated unclosed openers');

console.log('PASS sanitize regex linear time: coordinate rule guarded+bounded (both copies verified by literal), collapse linear on NBSP/CR runs, clinical dose lines never flagged');`,
  'forward-only block-strip contract'
);

if ((connect.match(/function stripBlocks\(s, openRe, closeRe\)/g) || []).length !== 2) {
  throw new Error('forward-only helper count postcondition failed');
}
if (connect.includes('/<script[\\s\\S]*?<\\/script>/gi') ||
    connect.includes('/<style[\\s\\S]*?<\\/style>/gi') ||
    connect.includes('/<!--[\\s\\S]*?-->/g')) {
  throw new Error('quadratic lazy-wildcard remover postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Replaced both sanitizer block chains with forward-only scans.');
