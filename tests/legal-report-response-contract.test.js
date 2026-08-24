'use strict';

/* A malformed legal response must never create a blank chart document. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const shells = [
  '1pScribeFlow.html',
  'ScribeFlow.html',
  '1p/index.html',
  'cloned/index.html',
  'ScribeFlow-staging.html'
];

for (const file of shells) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const guard = "const report=(d&&typeof d.report==='string')?d.report.trim():'';";
  const reject = "if(!report){ toast('The legal report came back empty or unusable.";
  const write = "addDocToActive(title, report, 'text')";
  const guardAt = source.indexOf(guard);
  const rejectAt = source.indexOf(reject, guardAt);
  const writeAt = source.indexOf(write, rejectAt);
  assert(guardAt >= 0, file + ': missing string/type guard for legal report');
  assert(rejectAt > guardAt, file + ': missing blank legal-report refusal after type guard');
  assert(writeAt > rejectAt, file + ': legal document creation is not after the refusal guard');
  assert(!source.includes("addDocToActive(title, d.report||''"), file + ': unsafe d.report fallback still creates documents');
  const legalMutation = source.indexOf('currentLegal=out;');
  const legalMutationGuard = source.lastIndexOf("if(typeof out!=='string'||!out.trim())", legalMutation);
  assert(legalMutation >= 0 && legalMutationGuard >= 0 && legalMutationGuard < legalMutation, file + ': legal workspace mutation lacks a nonblank string guard');
}

console.log('PASS legal report response guard: all five shells reject missing, non-string, and blank reports before document creation');
