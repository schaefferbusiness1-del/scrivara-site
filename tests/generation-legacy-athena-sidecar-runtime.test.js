'use strict';

/* A lagging /api/generate deployment may return a valid flat SOAP `note`
 * without the newer `athena_note` sidecar. The browser may reuse that note
 * only after the exact five-destination validator accepts it. */
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
  /* re-pinned to autodraft-1.1.0: the legacy fallback still validates the
     display note, but strips the marked carried-history appendix (display-only
     by contract) before it can become athena_note. The real sidecar is never
     cleaned - a leaked marker there fails validation closed. */
  assert(source.includes("result.athena_note==null?(typeof _autoDraftStripCarried==='function'?_autoDraftStripCarried(result.note):result.note):result.athena_note"), file + ': legacy sidecar fallback missing');
  checks += 1;
  const sandbox = {};
  const canonicalStart = source.indexOf('function _mlsAthenaNoteQualityError(reason)');
  const canonicalEnd = source.indexOf('\nfunction _mlsAthenaSourceState(', canonicalStart);
  assert(canonicalStart >= 0 && canonicalEnd > canonicalStart, file + ': canonical validator block missing');
  vm.runInNewContext(source.slice(canonicalStart, canonicalEnd) +
    '\nthis.validate=_mlsValidateAthenaNote;', sandbox, { filename: file });
  const fallback = sandbox.validate(flat);
  assert.strictEqual(fallback.text, flat, file + ': valid flat SOAP was not accepted as fallback');
  checks += 1;
  assert.throws(() => sandbox.validate('HPI: symptoms.\nROS: denies.\nAssessment: stable.\nPlan: follow-up.'),
    file + ': incomplete sidecar fallback was accepted');
  checks += 1;
}

console.log('PASS generation-legacy-athena-sidecar-runtime: ' + checks +
  ' checks — valid flat SOAP can bridge an older /api/generate response, while incomplete/narrative payloads remain fail-closed');
