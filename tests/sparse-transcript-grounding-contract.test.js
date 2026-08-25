'use strict';

/* A sparse current encounter must never borrow years of chart history just to
 * manufacture a complete note or a bill. This executes the shipped browser
 * gates and evidence filter in both canonical /1p shells. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SHELLS = ['1pScribeFlow.html', '1p/index.html'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function marker: ' + marker);
  const open = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i], next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) { if (escaped) { escaped = false; continue; } if (ch === '\\') { escaped = true; continue; } if (ch === quote) quote = ''; continue; }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unbalanced function: ' + marker);
}

for (const file of SHELLS) {
  const source = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const sandbox = {
    document: { getElementById: id => id === 'transcript' ? { value: 'Left knee pain improved after today injection' } : null },
    emrText: value => value == null ? '—' : String(value)
  };
  vm.runInNewContext(
    extractFunction(source, 'function _mlsTranscriptHasDraftableTodayEvidence(text)') + '\n' +
    extractFunction(source, 'function parseGenJSON(content)') +
    '\nthis.__api={signal:_mlsTranscriptHasDraftableTodayEvidence,parse:parseGenJSON};',
    sandbox,
    { filename: file }
  );

  eq(sandbox.__api.signal('patient is fine'), false, file + ': generic sparse transcript was allowed to borrow chart history');
  eq(sandbox.__api.signal('doing well'), false, file + ': generic affirmation was treated as draftable evidence');
  eq(sandbox.__api.signal('Left knee pain improved after today injection'), true, file + ': concise but clinical current-visit evidence was rejected');

  const result = sandbox.__api.parse(JSON.stringify({
    note: 'valid display note',
    athena_note: 'valid sidecar',
    em_level: '99202',
    em_justification: 'low MDM',
    em_evidence_quote: 'not in the transcript',
    icd10: [
      { code: 'M25.562', desc: 'Left knee pain', evidence_quote: 'Left knee pain improved' },
      { code: 'M54.16', desc: 'Old lumbar diagnosis', evidence_quote: 'old chart history' }
    ],
    cpt: [{ code: '99202', desc: 'Office visit', evidence_quote: 'old chart history' }]
  }));
  eq(result.coding.em, '', file + ': unsupported E/M code survived before physician review');
  eq(result.coding.icd.length, 1, file + ': evidence filter did not keep exactly the supported diagnosis');
  ok(result.coding.icd[0].includes('M25.562'), file + ': supported current-visit diagnosis was removed');
  eq(result.coding.cpt.length, 0, file + ': unsupported CPT code survived before physician review');

  const generate = source.indexOf('async function generateNote()');
  const decision = source.indexOf('_mlsGenerationEvidenceDecision(transcript)', generate);
  const refusal = source.indexOf('if(!evidence.ok)', decision);
  const actionGuard = source.indexOf("_mlsExactScheduledClinicalAction('note generation')", generate);
  ok(decision > generate && refusal > decision && refusal < actionGuard, file + ': sparse/history evidence decision does not run before visit generation work');
  ok(source.includes("basis:'trusted-history-sparse'") && source.includes('identityVerified===true') && source.includes('bodyComplete===true'), file + ': sparse generation is not restricted to verified full prior-visit bodies');
  ok(source.includes('TODAY_TRANSCRIPT_BEGIN') && source.includes('BACKGROUND_ONLY_BEGIN'), file + ': today and background payloads are not explicitly separated');
  ok(source.includes("silence is not stability, review, reconciliation, or continuation"), file + ': background-only block lacks the no-promotion rule');
  ok(source.includes('"em_level": "<supported 99202-99215 code, or empty string when insufficient>"'), file + ': prompt still forces an E/M code');
  ok(source.includes('"evidence_quote":"<short exact TODAY_TRANSCRIPT quote>"'), file + ': ordinary generated codes do not require exact current-visit evidence');
  ok(source.includes("'hpi','ros','exam','assessment','plan'"), file + ': direct section-family transport omits one or more Athena sections');
}

console.log('PASS sparse-transcript-grounding-contract: ' + checks +
  ' checks — sparse visits require verified full history or refuse, chart background is fenced from today, and unsupported ordinary coding is withheld');
