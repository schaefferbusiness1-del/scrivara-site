'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SHELLS = [
  '1pScribeFlow.html',
  '1p/index.html',
  'ScribeFlow.html',
  'cloned/index.html',
  'ScribeFlow-staging.html',
];
const HEADINGS = [
  'IDENTIFICATION & PURPOSE OF EXAMINATION',
  'RECORDS REVIEWED',
  'HISTORY (PER RECORDS)',
  'EXAMINATION FINDINGS',
  'DIAGNOSES',
  'CAUSATION ANALYSIS',
  'MAXIMUM MEDICAL IMPROVEMENT (MMI) STATUS',
  'IMPAIRMENT RATING DISCUSSION',
  'WORK RESTRICTIONS / FUNCTIONAL CAPACITY',
  'OPINIONS',
];
const DISCLAIMER = "Draft for the examining physician's review, editing, and signature; not final until signed.";

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Could not locate ${start}`);
  return source.slice(a, b);
}

function ordered(source, label) {
  let cursor = -1;
  for (const heading of HEADINGS) {
    const next = source.indexOf(heading, cursor + 1);
    assert(next > cursor, `${label} does not contain ${heading} in order`);
    cursor = next;
  }
}

for (const relative of SHELLS) {
  const file = path.join(ROOT, relative);
  const app = fs.readFileSync(file, 'utf8');
  const generate = between(app, 'async function generateIME()', 'function offlineIME()');
  const offline = between(app, 'function offlineIME()', '\n}\n\n/* =========================================================');

  ordered(generate, `${relative} generateIME prompt`);
  ordered(offline, `${relative} offline IME`);
  assert(generate.includes(DISCLAIMER), `${relative} prompt does not require the server IME disclaimer`);
  assert(offline.includes(DISCLAIMER + '`'), `${relative} offline IME does not end with the server IME disclaimer`);
  assert(generate.includes("family:'legal_ime',draftSubtype:legalDraftSubtypeFor('Independent Medical Exam (IME)',false)"),
    `${relative} standalone IME request is missing its explicit legal subtype`);
  assert(generate.includes("const imeText=typeof raw==='string'?raw.replace"),
    `${relative} IME response is not type-guarded before currentIME mutation`);
  assert(generate.includes("if(!imeText){ const qualityError=new Error('The IME draft response was empty or malformed. Please retry.')"),
    `${relative} IME blank/malformed response does not fail with a retryable quality error`);
  assert(!/String\(raw\|\|' '\)/.test(generate), `${relative} still coerces a malformed IME response into editor text`);

  for (const oldHeading of [
    'PURPOSE OF EXAMINATION', 'PHYSICAL EXAMINATION', 'DIAGNOSTIC STUDIES REVIEWED',
    'DIAGNOSES / IMPRESSIONS', 'WORK STATUS / FUNCTIONAL RESTRICTIONS',
    'APPORTIONMENT', 'ANSWERS TO REFERRAL QUESTIONS', 'EXAMINER ATTESTATION',
  ]) {
    assert(!new RegExp(`(?:^|\\n)${oldHeading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:\\s*$|\\s*—)`, 'm').test(generate),
      `${relative} still exposes stale standalone IME heading ${oldHeading}`);
    assert(!new RegExp(`(?:^|\\n)${oldHeading.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}(?:\\s*$|\\s*—)`, 'm').test(offline),
      `${relative} offline IME still exposes stale heading ${oldHeading}`);
  }

  const context = {};
  vm.createContext(context);
  vm.runInContext(`${offline}\n}\nresult=offlineIME();`, context, { filename: `${relative}:offlineIME` });
  const text = String(context.result || '');
  assert(text.trim().endsWith(DISCLAIMER), `${relative} offline runtime result is missing final disclaimer`);
  ordered(text, `${relative} offline runtime result`);
}

console.log('PASS standalone IME contract: five shells use the server headings/disclaimer and reject malformed responses before currentIME mutation');
