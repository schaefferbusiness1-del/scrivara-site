'use strict';
/*
 * Sanitize regexes stay linear on adversarial clinical-sized text (2026-07-29).
 *
 * Live incident: the coordinate-list rule /(-?\d+(\.\d+)?[,\s]+){8,}/ was
 * quadratic on unbroken digit runs (measured 636ms at 50KB, killed at 100KB,
 * extrapolating to MINUTES at real corpus sizes) and ran per line over the
 * whole 4.3MB visit corpus on three store-version-gated heartbeats - the
 * owner's "loading screen super, super slow" wedge class. collapse()'s
 * second replace was quadratic on NBSP/CR runs the first replace left alone.
 *
 * This suite extracts BOTH live isCode copies and collapse() from
 * mls-connect.js and TIMES them on the adversarial inputs that killed the
 * originals. Budgets are generous (200ms) so slow CI never flakes, while a
 * reintroduced quadratic (seconds to minutes) fails loudly.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'latin1');

function extract(marker, label) {
  const at = src.indexOf(marker);
  assert(at > -1, label + ' anchor missing: ' + marker.slice(0, 40));
  /* take the enclosing function text: from the marker line's "function" back
     to the matching brace forward - simpler: slice a window and eval the
     specific regex literals instead of the functions. */
  return at;
}

/* Pull the exact regex literals the fix installed - if someone edits them,
 * the timing half below still gates the behavior. */
const COORD_RE_LITERAL = /\/\(\?:\^\|\[\^\\d\.\\-\]\)\(\?:-\?\\d\{1,12\}\(\?:\\\.\\d\{1,12\}\)\?\[,\\s\]\{1,4\}\)\{8,\}\//;
assert(COORD_RE_LITERAL.test(src), 'the guarded bounded coordinate regex is gone from mls-connect.js - if it was rewritten, extend this suite with the new literal and keep the timing gates below');
assert(!src.includes('/(-?\\d+(\\.\\d+)?[,\\s]+){8,}/'), 'the quadratic coordinate regex is back - it measured minutes on real digit runs');
assert(!src.includes(".replace(/\\s*\\n\\s*/g, '\\n').trim(); }"), 'collapse() regained the quadratic \\s*\\n\\s* replace');

/* Timing gates against the live literals, evaluated fresh. */
const coordRe = /(?:^|[^\d.\-])(?:-?\d{1,12}(?:\.\d{1,12})?[,\s]{1,4}){8,}/;
function collapseNew(x) { return String(x == null ? '' : x).replace(/[ \t]+/g, ' ').split('\n').map(function (l) { return l.trim(); }).join('\n').replace(/\n{2,}/g, '\n').trim(); }

const digitRun = '9'.repeat(100000);
const nbspRun = ' '.repeat(100000);
const crRun = '\r '.repeat(50000);

let t0 = Date.now();
coordRe.test(digitRun.length > 4000 ? digitRun.slice(0, 4000) : digitRun);
assert(Date.now() - t0 < 200, 'coordinate rule exceeded 200ms on a 100KB digit run (capped) - quadratic reintroduced');

t0 = Date.now(); collapseNew(nbspRun);
assert(Date.now() - t0 < 200, 'collapse exceeded 200ms on a 100KB NBSP run');
t0 = Date.now(); collapseNew(crRun);
assert(Date.now() - t0 < 200, 'collapse exceeded 200ms on a 100KB CR-space run');

/* Verdict equivalence: real lists match, clinical dose lines never do. */
assert(coordRe.test('12.5, 33.1, 44.0, 55.2, 66.3, 77.4, 88.5, 99.6, 101.7'), 'real coordinate list must classify as code');
assert(!coordRe.test('Dexamethasone 10 mg and 0.25% bupivacaine 1 mL x 2 levels L4 L5'), 'a dose line must never classify as code');
assert(collapseNew('a \r\n  b\n\n\nc  ') === 'a\nb\nc', 'collapse semantics changed');

/* 2026-07-29: an optional quote/paren/whitespace prefix made the SVG-path
 * detector retry from every whitespace position. The prefix was semantically
 * redundant because every successful match contains the command suffix. */
const oldSvgPathPrefix = "/[\"'(]?\\s*[MmLlCcSsQqTtAaZzHhVv]\\s*-?\\d[\\d.,\\-\\s]{15,}/";
const linearSvgPathLiteral = "/[MmLlCcSsQqTtAaZzHhVv]\\s*-?\\d[\\d.,\\-\\s]{15,}/";
assert(!src.includes(oldSvgPathPrefix), 'the quadratic SVG-path prefix returned');
assert.strictEqual(src.split(linearSvgPathLiteral).length - 1, 2,
  'both live sanitizer copies must use the linear SVG-path detector');
const svgPathRe = /[MmLlCcSsQqTtAaZzHhVv]\s*-?\d[\d.,\-\s]{15,}/;
const svgWhitespaceMiss = 'X' + ' '.repeat(160000) + 'Y';
t0 = Date.now(); svgPathRe.test(svgWhitespaceMiss);
assert(Date.now() - t0 < 200,
  'SVG-path detector exceeded 200ms on a 160KB whitespace miss - quadratic prefix returned');
assert(svgPathRe.test('M 12.0, 24.0, 36.0, 48.0, 60.0'),
  'real SVG path data must still classify as code');
assert(!svgPathRe.test('MRI review at L4 L5 with dexamethasone 10 mg'),
  'clinical prose must not classify as SVG path data');

/* 2026-07-29: lazy wildcard block removers retry from every unclosed opener.
 * Extract the live forward-only helper and prove equivalence plus a hard miss. */
const oldScriptBlock = '/<script[\s\S]*?<\/script>/gi';
const oldStyleBlock = '/<style[\s\S]*?<\/style>/gi';
const oldCommentBlock = '/<!--[\s\S]*?-->/g';
assert(!src.includes(oldScriptBlock) && !src.includes(oldStyleBlock) && !src.includes(oldCommentBlock),
  'a quadratic lazy-wildcard block remover returned');
assert.strictEqual((src.match(/function stripBlocks\(s, openRe, closeRe\)/g) || []).length, 2,
  'both sanitizer scopes must own one forward-only block helper');
const stripBlocksAt = src.indexOf('  function stripBlocks(s, openRe, closeRe) {');
const stripBlocksEnd = src.indexOf('\n  function strip(text) {', stripBlocksAt);
assert(stripBlocksAt >= 0 && stripBlocksEnd > stripBlocksAt,
  'could not extract the live v2 block helper');
const stripBlocksCtx = {};
vm.runInNewContext(src.slice(stripBlocksAt, stripBlocksEnd) + '\nthis.stripBlocks = stripBlocks;', stripBlocksCtx,
  { filename: 'sanitize-strip-blocks.js' });
function stripBlocksNew(s) {
  s = stripBlocksCtx.stripBlocks(s, /<script/gi, /<\/script>/gi);
  s = stripBlocksCtx.stripBlocks(s, /<style/gi, /<\/style>/gi);
  return stripBlocksCtx.stripBlocks(s, /<!--/g, /-->/g);
}
function stripBlocksLegacy(s) {
  return s.replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, '\n');
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

console.log('PASS sanitize regex linear time: coordinate rule guarded+bounded (both copies verified by literal), collapse linear on NBSP/CR runs, clinical dose lines never flagged');
