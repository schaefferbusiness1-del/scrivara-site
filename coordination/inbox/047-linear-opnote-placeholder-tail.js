'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const integrityPath = path.join(root, 'feat_mls_opnote_integrity.js');
const productionPath = path.join(root, 'mls-connect.js');
const stagingPath = path.join(root, 'mls-connect.staging.js');
const linearTestPath = path.join(root, 'tests', 'sanitize-regex-linear-time.test.js');
const liveFindingsTestPath = path.join(root, 'tests', 'opnote-live-findings-regression.test.js');
const stagingParityTestPath = path.join(root, 'tests', 'opnote-staging-parity-runtime.test.js');
const templateIntegrityTestPath = path.join(root, 'tests', 'opnote-template-integrity-runtime.test.js');

function replaceOne(source, before, after, label) {
  const first = source.indexOf(before);
  if (first < 0) throw new Error(label + ': exact source anchor is missing');
  if (source.indexOf(before, first + before.length) >= 0) {
    throw new Error(label + ': exact source anchor is ambiguous');
  }
  return source.slice(0, first) + after + source.slice(first + before.length);
}

const integrity = fs.readFileSync(integrityPath, 'utf8');
const production = fs.readFileSync(productionPath, 'latin1');
const staging = fs.readFileSync(stagingPath, 'latin1');
const linearTest = fs.readFileSync(linearTestPath, 'utf8');
const liveFindingsTest = fs.readFileSync(liveFindingsTestPath, 'utf8');
const stagingParityTest = fs.readFileSync(stagingParityTestPath, 'utf8');
const templateIntegrityTest = fs.readFileSync(templateIntegrityTestPath, 'utf8');

const integrityBefore = `  function placeholderOnlyTail(tail){
    var t=S(tail).trim(); if(!t) return true;
    return /^(?:\\s*(?:\\[\\[[^\\]]+\\]\\]|\\[(?:FILL\\s*:?\\s*)?[^\\]]+\\]|\\{\\{[^}]+\\}\\}|_{2,})\\s*)+$/i.test(t);
  }`;

const integrityAfter = `  /* 2026-07-29: consume each placeholder and whitespace run once. */
  function placeholderOnlyTail(tail){
    var t=S(tail).trim(); if(!t) return true;
    var token=/\\[\\[[^\\]]+\\]\\]|\\[[^\\]]+\\]|\\{\\{[^}]+\\}\\}|_{2,}/g;
    var at=0,any=false,m;
    while(at<t.length){
      while(at<t.length&&/\\s/.test(t.charAt(at)))at++;
      if(at>=t.length)break;
      token.lastIndex=at;m=token.exec(t);
      if(!m||m.index!==at)return false;
      any=true;at=token.lastIndex;
    }
    return any;
  }`;

const oldToken = 'feat_mls_opnote_integrity.js?v=20260728oni2170';
const newToken = 'feat_mls_opnote_integrity.js?v=20260729phlinear';

const testLog = `console.log('PASS sanitize regex linear time: coordinate rule guarded+bounded (both copies verified by literal), collapse linear on NBSP/CR runs, clinical dose lines never flagged');`;
const testAddition = `/* 2026-07-29: nested optional whitespace inside a repeated placeholder
 * group made a prose miss quadratic. Extract the live classifier, compare it
 * with the prior verdict on generated inputs, and time adversarial doublings. */
const opnoteIntegritySrc = fs.readFileSync(path.join(__dirname, '..', 'feat_mls_opnote_integrity.js'), 'utf8');
const placeholderStart = opnoteIntegritySrc.indexOf('  function placeholderOnlyTail(tail){');
const placeholderEnd = opnoteIntegritySrc.indexOf('\\n  function forceFacts(', placeholderStart);
assert(placeholderStart >= 0 && placeholderEnd > placeholderStart,
  'could not extract the live op-note placeholder tail classifier');
assert(!opnoteIntegritySrc.includes('/^(?:\\\\s*(?:\\\\[\\\\[[^\\\\]]+\\\\]\\\\]|\\\\[(?:FILL\\\\s*:?\\\\s*)?[^\\\\]]+\\\\]|\\\\{\\\\{[^}]+\\\\}\\\\}|_{2,})\\\\s*)+$/i'),
  'quadratic repeated optional whitespace returned to the op-note classifier');
const placeholderCtx = {
  S: function (value) { return String(value == null ? '' : value); }
};
vm.runInNewContext(
  opnoteIntegritySrc.slice(placeholderStart, placeholderEnd) +
    '\\nthis.placeholderOnlyTail = placeholderOnlyTail;',
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
  return /^(?:\\s*(?:\\[\\[[^\\]]+\\]\\]|\\[(?:FILL\\s*:?\\s*)?[^\\]]+\\]|\\{\\{[^}]+\\}\\}|_{2,})\\s*)+$/i.test(t);
}
let placeholderSeed = 0x8a5cd789;
function nextPlaceholderRandom() {
  placeholderSeed = (Math.imul(placeholderSeed, 1664525) + 1013904223) >>> 0;
  return placeholderSeed;
}
const placeholderAlphabet = [
  '[', ']', '{', '}', '_', 'F', 'I', 'L', ':', ' ', '\\t', '\\n', '\\r',
  '\\u00a0', '\\u2028', 'X', 'a', '1'
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

${testLog}`;

const templatePinsBefore = `  assert(connect.includes('feat_mls_opnote_integrity.js?v=20260728oni2170'), 'production does not load the final op-note integrity owner');
  assert(stagingConnect.includes('feat_mls_opnote_integrity.js?v=20260728oni2170'), 'staging does not load the same op-note integrity owner');`;
const templatePinsAfter = `  assert(connect.includes('feat_mls_opnote_integrity.js?v=20260729phlinear'), 'production does not load the final op-note integrity owner');
  assert(stagingConnect.includes('feat_mls_opnote_integrity.js?v=20260729phlinear'), 'staging does not load the same op-note integrity owner');`;

const nextIntegrity = replaceOne(
  integrity,
  integrityBefore,
  integrityAfter,
  'op-note placeholder tail classifier'
);
const nextProduction = replaceOne(
  production,
  oldToken,
  newToken,
  'production immutable op-note token'
);
const nextStaging = replaceOne(
  staging,
  oldToken,
  newToken,
  'staging immutable op-note token'
);
const nextLinearTest = replaceOne(
  linearTest,
  testLog,
  testAddition,
  'linear regex regression insertion'
);
const nextLiveFindingsTest = replaceOne(
  liveFindingsTest,
  oldToken,
  newToken,
  'live findings immutable op-note pin'
);
const nextStagingParityTest = replaceOne(
  stagingParityTest,
  oldToken,
  newToken,
  'staging parity immutable op-note pin'
);
const nextTemplateIntegrityTest = replaceOne(
  templateIntegrityTest,
  templatePinsBefore,
  templatePinsAfter,
  'template integrity immutable op-note pins'
);

if (!nextIntegrity.includes('while(at<t.length&&/\\s/.test(t.charAt(at)))at++;')) {
  throw new Error('postcondition failed: linear whitespace consumer is missing');
}
if (nextIntegrity.includes('return /^(?:\\s*(?:\\[\\[')) {
  throw new Error('postcondition failed: quadratic classifier is still present');
}
if (
  !nextProduction.includes(newToken) ||
  !nextStaging.includes(newToken) ||
  nextProduction.includes(oldToken) ||
  nextStaging.includes(oldToken)
) {
  throw new Error('postcondition failed: immutable op-note loader token did not advance');
}
if (
  !nextLinearTest.includes('generated op-note equivalence corpus lacked both verdict classes') ||
  !nextLinearTest.includes('op-note placeholder timing grew superlinearly')
) {
  throw new Error('postcondition failed: semantic and timing regression coverage is missing');
}

const outputs = [
  [integrityPath, nextIntegrity, 'utf8'],
  [productionPath, nextProduction, 'latin1'],
  [stagingPath, nextStaging, 'latin1'],
  [linearTestPath, nextLinearTest, 'utf8'],
  [liveFindingsTestPath, nextLiveFindingsTest, 'utf8'],
  [stagingParityTestPath, nextStagingParityTest, 'utf8'],
  [templateIntegrityTestPath, nextTemplateIntegrityTest, 'utf8']
];
outputs.forEach(function (entry) {
  fs.writeFileSync(entry[0], entry[1], entry[2]);
});

console.log('Applied proposal 047: op-note placeholder tail classification is linear.');
