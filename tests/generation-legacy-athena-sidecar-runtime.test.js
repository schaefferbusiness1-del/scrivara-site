'use strict';

/* The fixed five-field display is the reviewed Athena source, whether a
 * deployment omits `athena_note` or returns a different sidecar. It may be
 * reused only after the exact display validator accepts it. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', '1p/index.html', 'ScribeFlow.html', 'cloned/index.html'];
const flat = [
  'HPI: symptoms began two weeks ago.',
  'ROS: Patient denies shortness of breath.',
  'EXAM: Lungs are clear bilaterally.',
  'ASSESSMENT: Findings support acute bronchitis.',
  'PLAN: Continue supportive care and arrange follow-up.'
].join('\n');

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing ' + marker);
  const open = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unbalanced ' + marker);
}

let checks = 0;
for (const file of shells) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert(source.includes("generationStyle==='soap'?_mlsAthenaCanonicalFromStandardNote(result.note):_mlsValidateAthenaNote("),
    file + ': fixed-format generation does not validate the displayed note first');
  checks += 1;
  const sandbox = { stripSignatureBlock: text => String(text), _autoDraftStripCarried: text => String(text) };
  const canonicalStart = source.indexOf('function _mlsAthenaNoteQualityError(reason)');
  const canonicalEnd = source.indexOf('\nfunction _mlsAthenaSourceState(', canonicalStart);
  assert(canonicalStart >= 0 && canonicalEnd > canonicalStart, file + ': canonical validator block missing');
  vm.runInNewContext(source.slice(canonicalStart, canonicalEnd) +
    '\nthis.fromDisplay=_mlsAthenaCanonicalFromStandardNote;', sandbox, { filename: file });
  const fallback = sandbox.fromDisplay(flat);
  assert.strictEqual(fallback.text, flat, file + ': valid flat displayed note was not accepted');
  checks += 1;
  assert.throws(() => sandbox.fromDisplay('HPI: symptoms.\nROS: denies.\nAssessment: stable.\nPlan: follow-up.'),
    file + ': incomplete displayed note was accepted');
  checks += 1;
}

console.log('PASS generation-legacy-athena-sidecar-runtime: ' + checks +
  ' checks — valid reviewed flat SOAP is canonical regardless of sidecar transport, while incomplete/narrative displays remain fail-closed');
