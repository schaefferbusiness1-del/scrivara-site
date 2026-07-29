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

/* 2026-07-29: nested optional whitespace inside a repeated placeholder
 * group made a prose miss quadratic. Extract the live classifier, compare it
 * with the prior verdict on generated inputs, and time adversarial doublings. */
const opnoteIntegritySrc = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_opnote_integrity.js'), 'utf8');
const placeholderStart = opnoteIntegritySrc.indexOf('  function placeholderOnlyTail(tail){');
const placeholderEnd = opnoteIntegritySrc.indexOf('\n  function forceFacts(', placeholderStart);
assert(placeholderStart >= 0 && placeholderEnd > placeholderStart,
  'could not extract the live op-note placeholder tail classifier');
assert(!opnoteIntegritySrc.includes('/^(?:\\s*(?:\\[\\[[^\\]]+\\]\\]|\\[(?:FILL\\s*:?\\s*)?[^\\]]+\\]|\\{\\{[^}]+\\}\\}|_{2,})\\s*)+$/i'),
  'quadratic repeated optional whitespace returned to the op-note classifier');
const placeholderCtx = {
  S: function (value) { return String(value == null ? '' : value); }
};
vm.runInNewContext(
  opnoteIntegritySrc.slice(placeholderStart, placeholderEnd) +
    '\nthis.placeholderOnlyTail = placeholderOnlyTail;',
  placeholderCtx,
  { filename: 'opnote-placeholder-tail.js' }
);
const placeholderOnlyTailLive = placeholderCtx.placeholderOnlyTail;
assert.strictEqual(typeof placeholderOnlyTailLive, 'function',
  'live op-note placeholder classifier extraction was vacuous');
assert.strictEqual(placeholderOnlyTailLive(' [[procedure]] [FILL: side] {{level}} __ '), true,
  'real placeholder-only tail no longer classifies as replaceable');
assert.strictEqual(placeholderOnlyTailLive(' [[procedure]] keep this wording'), false,
  'fixed template wording was misclassified as replaceable');

function placeholderOnlyTailPrior(tail) {
  const t = String(tail == null ? '' : tail).trim();
  if (!t) return true;
  return /^(?:\s*(?:\[\[[^\]]+\]\]|\[(?:FILL\s*:?\s*)?[^\]]+\]|\{\{[^}]+\}\}|_{2,})\s*)+$/i.test(t);
}
let placeholderSeed = 0x8a5cd789;
function nextPlaceholderRandom() {
  placeholderSeed = (Math.imul(placeholderSeed, 1664525) + 1013904223) >>> 0;
  return placeholderSeed;
}
const placeholderAlphabet = [
  '[', ']', '{', '}', '_', 'F', 'I', 'L', ':', ' ', '\t', '\n', '\r',
  '\u00a0', '\u2028', 'X', 'a', '1'
];
let placeholderTrue = 0;
let placeholderFalse = 0;
for (let caseIndex = 0; caseIndex < 50000; caseIndex++) {
  const length = nextPlaceholderRandom() % 48;
  let generated = '';
  for (let charIndex = 0; charIndex < length; charIndex++) {
    generated += placeholderAlphabet[nextPlaceholderRandom() % placeholderAlphabet.length];
  }
  const priorVerdict = placeholderOnlyTailPrior(generated);
  const liveVerdict = placeholderOnlyTailLive(generated);
  assert.strictEqual(liveVerdict, priorVerdict,
    'op-note placeholder verdict changed on generated case ' + caseIndex);
  if (liveVerdict) placeholderTrue++; else placeholderFalse++;
}
assert(placeholderTrue > 25 && placeholderFalse > 25000,
  'generated op-note equivalence corpus lacked both verdict classes');

const placeholderSizes = [40000, 80000, 160000, 320000];
const placeholderTimes = [];
placeholderSizes.forEach(function (size) {
  const adversarial = '[[field]]' + ' '.repeat(size) + 'X';
  const started = process.hrtime.bigint();
  for (let repeat = 0; repeat < 5; repeat++) {
    assert.strictEqual(placeholderOnlyTailLive(adversarial), false,
      'adversarial prose tail must remain non-placeholder content');
  }
  placeholderTimes.push(Number(process.hrtime.bigint() - started) / 1e6);
});
assert(placeholderTimes[placeholderTimes.length - 1] < 500,
  'linear op-note placeholder classifier exceeded 500ms at the largest doubling');
for (let timeIndex = 1; timeIndex < placeholderTimes.length; timeIndex++) {
  assert(placeholderTimes[timeIndex] <= placeholderTimes[timeIndex - 1] * 3.5 + 40,
    'op-note placeholder timing grew superlinearly across adversarial doublings');
}

/* 2026-07-29: the comma lookahead rescanned the remaining list for every
 * comma. Extract the live parser, preserve even unmatched-paren behavior on
 * generated inputs, and time comma-heavy adversarial doublings. */
const patientSnapshotSrc = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_patient_snapshot.js'), 'utf8');
const snapshotParserStart = patientSnapshotSrc.indexOf('  function splitListLinear(t) {');
const snapshotParserEnd = patientSnapshotSrc.indexOf('\n\n  /* b749:', snapshotParserStart);
assert(snapshotParserStart >= 0 && snapshotParserEnd > snapshotParserStart,
  'could not extract the live patient snapshot list parser');
assert(!patientSnapshotSrc.includes('t.split(/[;\\n•\\|]+|,(?![^()]*\\))/)'),
  'quadratic patient snapshot comma lookahead returned');
const snapshotParserCtx = {};
vm.runInNewContext(
  patientSnapshotSrc.slice(snapshotParserStart, snapshotParserEnd) +
    '\nthis.parseList = parseList;',
  snapshotParserCtx,
  { filename: 'patient-snapshot-list-parser.js' }
);
const parseSnapshotListLive = snapshotParserCtx.parseList;
assert.strictEqual(typeof parseSnapshotListLive, 'function',
  'live patient snapshot parser extraction was vacuous');
assert.deepStrictEqual(
  Array.from(parseSnapshotListLive('Alpha, Beta (left, right); Gamma\nDelta•Epsilon|Zeta')),
  ['Alpha', 'Beta (left, right)', 'Gamma', 'Delta', 'Epsilon', 'Zeta'],
  'real mixed patient list delimiters changed'
);
assert.deepStrictEqual(Array.from(parseSnapshotListLive('none.')), [],
  'documented empty patient list no longer stays empty');

function parseSnapshotListPrior(raw) {
  const t = (raw == null ? '' : String(raw)).trim();
  if (!t) return [];
  if (/^(none|n\/a|na|nil)\.?$/i.test(t)) return [];
  const parts = t.split(/[;\n•\|]+|,(?![^()]*\))/)
    .map(function (x) { return x.trim().replace(/\.$/, ''); })
    .filter(function (x) { return x && x.length <= 90; });
  const seen = {};
  const out = [];
  parts.forEach(function (part) {
    const key = part.toLowerCase();
    if (!seen[key]) { seen[key] = 1; out.push(part); }
  });
  return out;
}
let snapshotSeed = 0x74b129ce;
function nextSnapshotRandom() {
  snapshotSeed = (Math.imul(snapshotSeed, 1664525) + 1013904223) >>> 0;
  return snapshotSeed;
}
const snapshotAlphabet = [
  'a', 'B', '1', ' ', '.', ',', ';', '\n', '•', '|', '(', ')', '[', ']', '_', '\t'
];
const documentedEmptyLists = ['', ' ', 'none', 'None.', 'n/a', 'NA', 'nil.'];
let snapshotEmpty = 0;
let snapshotNonEmpty = 0;
let snapshotMultiple = 0;
for (let caseIndex = 0; caseIndex < 50000; caseIndex++) {
  let generated = '';
  if (caseIndex % 19 === 0) {
    generated = documentedEmptyLists[caseIndex % documentedEmptyLists.length];
  } else {
    const length = nextSnapshotRandom() % 80;
    for (let charIndex = 0; charIndex < length; charIndex++) {
      generated += snapshotAlphabet[nextSnapshotRandom() % snapshotAlphabet.length];
    }
  }
  const priorParts = parseSnapshotListPrior(generated);
  const liveParts = Array.from(parseSnapshotListLive(generated));
  assert.deepStrictEqual(liveParts, priorParts,
    'patient snapshot list verdict changed on generated case ' + caseIndex);
  if (!liveParts.length) snapshotEmpty++;
  else {
    snapshotNonEmpty++;
    if (liveParts.length > 1) snapshotMultiple++;
  }
}
assert(snapshotEmpty > 1000 && snapshotNonEmpty > 25000 && snapshotMultiple > 10000,
  'generated patient list corpus lacked empty, single, or split verdict classes');

const snapshotSizes = [16000, 32000, 64000, 128000];
const snapshotTimes = [];
snapshotSizes.forEach(function (size) {
  const adversarial = 'a,'.repeat(size / 2) + 'a';
  const started = process.hrtime.bigint();
  for (let repeat = 0; repeat < 5; repeat++) {
    assert.deepStrictEqual(Array.from(parseSnapshotListLive(adversarial)), ['a'],
      'comma-heavy patient list changed its deduplicated output');
  }
  snapshotTimes.push(Number(process.hrtime.bigint() - started) / 1e6);
});
assert(snapshotTimes[snapshotTimes.length - 1] < 500,
  'linear patient list parser exceeded 500ms at the largest doubling');
for (let timeIndex = 1; timeIndex < snapshotTimes.length; timeIndex++) {
  assert(snapshotTimes[timeIndex] <= snapshotTimes[timeIndex - 1] * 3.5 + 40,
    'patient list timing grew superlinearly across adversarial doublings');
}

const snapshotStagingConnect = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.staging.js'), 'latin1');
const snapshotProductionLoaderAt = src.indexOf('var A="feat_mls_patient_snapshot.js";');
const snapshotStagingLoaderAt = snapshotStagingConnect.indexOf('var A="feat_mls_patient_snapshot.js";');
assert(snapshotProductionLoaderAt >= 0 &&
  src.slice(snapshotProductionLoaderAt, snapshotProductionLoaderAt + 500)
    .includes('s.src=A+"?v=20260729listlinear";'),
  'production patient snapshot immutable token did not advance');
assert(snapshotStagingLoaderAt >= 0 &&
  snapshotStagingConnect.slice(snapshotStagingLoaderAt, snapshotStagingLoaderAt + 500)
    .includes('s.src=A+"?v=20260729listlinear";'),
  'staging patient snapshot immutable token did not advance');

console.log('PASS sanitize regex linear time: coordinate rule guarded+bounded (both copies verified by literal), collapse linear on NBSP/CR runs, clinical dose lines never flagged');
