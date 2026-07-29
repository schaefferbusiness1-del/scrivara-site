'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const snapshotPath = path.join(root, 'feat_mls_patient_snapshot.js');
const productionPath = path.join(root, 'mls-connect.js');
const stagingPath = path.join(root, 'mls-connect.staging.js');
const linearTestPath = path.join(root, 'tests', 'sanitize-regex-linear-time.test.js');

function replaceOne(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': exact source anchor is missing');
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': exact source anchor is ambiguous');
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const snapshot = fs.readFileSync(snapshotPath, 'utf8');
const production = fs.readFileSync(productionPath, 'latin1');
const staging = fs.readFileSync(stagingPath, 'latin1');
const linearTest = fs.readFileSync(linearTestPath, 'utf8');

const snapshotBefore = `  function parseList(raw) {
    var t = (raw == null ? '' : String(raw)).trim();
    if (!t) return [];
    if (/^(none|n\\/a|na|nil)\\.?$/i.test(t)) return [];
    var parts = t.split(/[;\\n•\\|]+|,(?![^()]*\\))/).map(function (x) { return x.trim().replace(/\\.$/, ''); })
      .filter(function (x) { return x && x.length <= 90; });
    var seen = {}, out = [];
    parts.forEach(function (p) { var k = p.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(p); } });
    return out;
  }`;

const snapshotAfter = `  /* 2026-07-29: decide each comma from the nearest following paren once. */
  function splitListLinear(t) {
    var cuts=[],nextParen='';
    for(var i=t.length-1;i>=0;i--){
      var ch=t.charAt(i);
      if(ch==='('||ch===')'){nextParen=ch;continue;}
      if(ch===','&&nextParen!==')'){cuts.push(i);continue;}
      if(ch===';'||ch==='\\n'||ch==='•'||ch==='|')cuts.push(i);
    }
    cuts.reverse();
    var parts=[],at=0;
    for(var j=0;j<cuts.length;j++){parts.push(t.slice(at,cuts[j]));at=cuts[j]+1;}
    parts.push(t.slice(at));
    return parts;
  }

  function parseList(raw) {
    var t = (raw == null ? '' : String(raw)).trim();
    if (!t) return [];
    if (/^(none|n\\/a|na|nil)\\.?$/i.test(t)) return [];
    var parts = splitListLinear(t).map(function (x) { return x.trim().replace(/\\.$/, ''); })
      .filter(function (x) { return x && x.length <= 90; });
    var seen = {}, out = [];
    parts.forEach(function (p) { var k = p.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(p); } });
    return out;
  }`;

const oldLoaderSrc = 's.src=A+"?v=20260727hcep1";';
const newLoaderSrc = 's.src=A+"?v=20260729listlinear";';

const testLog = `console.log('PASS sanitize regex linear time: coordinate rule guarded+bounded (both copies verified by literal), collapse linear on NBSP/CR runs, clinical dose lines never flagged');`;
const testAddition = `/* 2026-07-29: the comma lookahead rescanned the remaining list for every
 * comma. Extract the live parser, preserve even unmatched-paren behavior on
 * generated inputs, and time comma-heavy adversarial doublings. */
const patientSnapshotSrc = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_patient_snapshot.js'), 'utf8');
const snapshotParserStart = patientSnapshotSrc.indexOf('  function splitListLinear(t) {');
const snapshotParserEnd = patientSnapshotSrc.indexOf('\\n\\n  /* b749:', snapshotParserStart);
assert(snapshotParserStart >= 0 && snapshotParserEnd > snapshotParserStart,
  'could not extract the live patient snapshot list parser');
assert(!patientSnapshotSrc.includes('t.split(/[;\\\\n•\\\\|]+|,(?![^()]*\\\\))/)'),
  'quadratic patient snapshot comma lookahead returned');
const snapshotParserCtx = {};
vm.runInNewContext(
  patientSnapshotSrc.slice(snapshotParserStart, snapshotParserEnd) +
    '\\nthis.parseList = parseList;',
  snapshotParserCtx,
  { filename: 'patient-snapshot-list-parser.js' }
);
const parseSnapshotListLive = snapshotParserCtx.parseList;
assert.strictEqual(typeof parseSnapshotListLive, 'function',
  'live patient snapshot parser extraction was vacuous');
assert.deepStrictEqual(
  Array.from(parseSnapshotListLive('Alpha, Beta (left, right); Gamma\\nDelta•Epsilon|Zeta')),
  ['Alpha', 'Beta (left, right)', 'Gamma', 'Delta', 'Epsilon', 'Zeta'],
  'real mixed patient list delimiters changed'
);
assert.deepStrictEqual(Array.from(parseSnapshotListLive('none.')), [],
  'documented empty patient list no longer stays empty');

function parseSnapshotListPrior(raw) {
  const t = (raw == null ? '' : String(raw)).trim();
  if (!t) return [];
  if (/^(none|n\\/a|na|nil)\\.?$/i.test(t)) return [];
  const parts = t.split(/[;\\n•\\|]+|,(?![^()]*\\))/)
    .map(function (x) { return x.trim().replace(/\\.$/, ''); })
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
  'a', 'B', '1', ' ', '.', ',', ';', '\\n', '•', '|', '(', ')', '[', ']', '_', '\\t'
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

${testLog}`;

const nextSnapshot = replaceOne(
  snapshot,
  snapshotBefore,
  snapshotAfter,
  'patient snapshot list parser'
);
const nextProduction = replaceOne(
  production,
  oldLoaderSrc,
  newLoaderSrc,
  'production immutable patient snapshot token'
);
const nextStaging = replaceOne(
  staging,
  oldLoaderSrc,
  newLoaderSrc,
  'staging immutable patient snapshot token'
);
const nextLinearTest = replaceOne(
  linearTest,
  testLog,
  testAddition,
  'linear regex regression insertion'
);

if (!nextSnapshot.includes("if(ch===','&&nextParen!==')'){cuts.push(i);continue;}")) {
  throw new Error('postcondition failed: linear comma decision is missing');
}
if (nextSnapshot.includes('t.split(/[;\\n•\\|]+|,(?![^()]*\\))/)')) {
  throw new Error('postcondition failed: quadratic comma lookahead is still present');
}
if (
  !nextProduction.includes(newLoaderSrc) ||
  !nextStaging.includes(newLoaderSrc) ||
  nextProduction.includes(oldLoaderSrc) ||
  nextStaging.includes(oldLoaderSrc)
) {
  throw new Error('postcondition failed: immutable patient snapshot token did not advance');
}
if (
  !nextLinearTest.includes('generated patient list corpus lacked empty, single, or split verdict classes') ||
  !nextLinearTest.includes('patient list timing grew superlinearly')
) {
  throw new Error('postcondition failed: semantic and timing regression coverage is missing');
}

const outputs = [
  [snapshotPath, nextSnapshot, 'utf8'],
  [productionPath, nextProduction, 'latin1'],
  [stagingPath, nextStaging, 'latin1'],
  [linearTestPath, nextLinearTest, 'utf8']
];
outputs.forEach(function (entry) {
  fs.writeFileSync(entry[0], entry[1], entry[2]);
});

console.log('Applied proposal 048: patient snapshot list splitting is linear.');
