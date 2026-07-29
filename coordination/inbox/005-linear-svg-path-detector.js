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

let connect = fs.readFileSync(connectPath, 'latin1');
let test = fs.readFileSync(testPath, 'utf8');

connect = replaceExactlyOnce(
  connect,
  "    if (/[\"'(]?\\s*[MmLlCcSsQqTtAaZzHhVv]\\s*-?\\d[\\d.,\\-\\s]{15,}/.test(t)) return true;\n    if (/(?:^|[^\\d.\\-])(?:-?\\d{1,12}(?:\\.\\d{1,12})?[,\\s]{1,4}){8,}/.test(t.length > 4000 ? t.slice(0, 4000) : t)) return true;",
  "    if (/[MmLlCcSsQqTtAaZzHhVv]\\s*-?\\d[\\d.,\\-\\s]{15,}/.test(t)) return true;\n    if (/(?:^|[^\\d.\\-])(?:-?\\d{1,12}(?:\\.\\d{1,12})?[,\\s]{1,4}){8,}/.test(t.length > 4000 ? t.slice(0, 4000) : t)) return true;",
  'v2 SVG path detector'
);

connect = replaceExactlyOnce(
  connect,
  "    if (/[\"'(]?\\s*[MmLlCcSsQqTtAaZzHhVv]\\s*-?\\d[\\d.,\\-\\s]{15,}/.test(t)) return true;   // SVG path data",
  "    if (/[MmLlCcSsQqTtAaZzHhVv]\\s*-?\\d[\\d.,\\-\\s]{15,}/.test(t)) return true;   // SVG path data",
  'base SVG path detector'
);

test = replaceExactlyOnce(
  test,
  "console.log('PASS sanitize regex linear time: coordinate rule guarded+bounded (both copies verified by literal), collapse linear on NBSP/CR runs, clinical dose lines never flagged');",
  "/* 2026-07-29: an optional quote/paren/whitespace prefix made the SVG-path\n * detector retry from every whitespace position. The prefix was semantically\n * redundant because every successful match contains the command suffix. */\nconst oldSvgPathPrefix = \"/[\\\"'(]?\\\\s*[MmLlCcSsQqTtAaZzHhVv]\\\\s*-?\\\\d[\\\\d.,\\\\-\\\\s]{15,}/\";\nconst linearSvgPathLiteral = \"/[MmLlCcSsQqTtAaZzHhVv]\\\\s*-?\\\\d[\\\\d.,\\\\-\\\\s]{15,}/\";\nassert(!src.includes(oldSvgPathPrefix), 'the quadratic SVG-path prefix returned');\nassert.strictEqual(src.split(linearSvgPathLiteral).length - 1, 2,\n  'both live sanitizer copies must use the linear SVG-path detector');\nconst svgPathRe = /[MmLlCcSsQqTtAaZzHhVv]\\s*-?\\d[\\d.,\\-\\s]{15,}/;\nconst svgWhitespaceMiss = 'X' + ' '.repeat(160000) + 'Y';\nt0 = Date.now(); svgPathRe.test(svgWhitespaceMiss);\nassert(Date.now() - t0 < 200,\n  'SVG-path detector exceeded 200ms on a 160KB whitespace miss - quadratic prefix returned');\nassert(svgPathRe.test('M 12.0, 24.0, 36.0, 48.0, 60.0'),\n  'real SVG path data must still classify as code');\nassert(!svgPathRe.test('MRI review at L4 L5 with dexamethasone 10 mg'),\n  'clinical prose must not classify as SVG path data');\n\nconsole.log('PASS sanitize regex linear time: coordinate rule guarded+bounded (both copies verified by literal), collapse linear on NBSP/CR runs, clinical dose lines never flagged');",
  'SVG path linear-time contract'
);

const oldSvgPathPrefix = "/[\"'(]?\\s*[MmLlCcSsQqTtAaZzHhVv]\\s*-?\\d[\\d.,\\-\\s]{15,}/";
const linearSvgPathLiteral = "/[MmLlCcSsQqTtAaZzHhVv]\\s*-?\\d[\\d.,\\-\\s]{15,}/";
if (connect.includes(oldSvgPathPrefix)) {
  throw new Error('quadratic SVG-path prefix postcondition failed');
}
if (connect.split(linearSvgPathLiteral).length - 1 !== 2) {
  throw new Error('linear SVG-path detector count postcondition failed');
}

fs.writeFileSync(connectPath, connect, 'latin1');
fs.writeFileSync(testPath, test, 'utf8');

console.log('Removed the quadratic optional prefix from both SVG-path detectors.');
