'use strict';

/* The Athena plan must preserve typed/narrative compatibility while refusing
 * to guess when an AI SOAP result no longer proves the five named fields. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = [
  '1pScribeFlow.html',
  'ScribeFlow.html',
  '1p/index.html',
  'cloned/index.html',
  'ScribeFlow-staging.html'
];

function extractFunction(source, marker) {
  const start = source.indexOf(marker);
  assert(start >= 0, 'missing function marker: ' + marker);
  const open = source.indexOf('{', start);
  assert(open > start, 'missing function body: ' + marker);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) {
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (ch === '*' && next === '/') { blockComment = false; i += 1; }
      continue;
    }
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail('unbalanced function: ' + marker);
}

const validSections = [
  { key: 'hpi', text: 'Symptoms began two weeks ago.' },
  { key: 'ros', text: 'Denies dyspnea.' },
  { key: 'exam', text: 'Lungs clear.' },
  { key: 'assessment', text: 'Acute bronchitis.' },
  { key: 'plan', text: 'Supportive care and follow-up.' }
];

function runPlan(source, provenance, noteText, parserResult) {
  const block = extractFunction(source, 'function _athenaBuildPlan(binding)');
  const sandbox = {
    window: { __mlsWriteFlow: { parseGeneratedSoapSections: () => parserResult } },
    emrReadyText: () => noteText,
    currentCoding: null,
    currentOrders: [],
    aiSuggestedOrders: [],
    currentNoteProvenance: provenance,
    ATHENA_SECTIONS: {
      note: { icon: 'N', dest: 'generic note' },
      dx: { icon: 'D', dest: 'diagnoses' },
      billing: { icon: 'B', dest: 'billing' },
      orders: { icon: 'O', dest: 'orders' }
    },
    _athenaCanonicalBilling: () => ({}),
    _athenaOrderReviewBundle: () => ({ drafts: [], suggestions: [] }),
    console
  };
  vm.createContext(sandbox);
  vm.runInContext(block + '\nthis.__plan = _athenaBuildPlan({ patient: { name: "Test Patient" } });', sandbox);
  return sandbox.__plan;
}

for (const file of shells) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert(source.includes("currentNoteProvenance='typed'"), file + ': missing explicit note provenance');
  assert(source.includes("currentNoteProvenance==='generated_soap'"), file + ': generated SOAP provenance is not gated');
  assert(source.includes("currentNoteProvenance='edited_generated_soap'"), file + ': editing a generated SOAP note silently downgraded provenance');
  assert(source.includes('noteProvenance:'), file + ': note provenance is not persisted in saved state');
  assert(source.includes('savedNoteProvenance='), file + ': saved note provenance is not restored');
  assert(source.includes("blockReason:'generated-soap-format'"), file + ': parser failure is not fail-closed');
  assert(source.includes('if(built&&built.blocked)'), file + ': action path does not refuse a blocked plan');
  const staleGuardAt = source.indexOf("if(!_athenaAsyncBindingStillSafe(generationBinding,'note generation',generationEpoch))");
  const noteMutationAt = source.indexOf('currentSoap=_reorderNoteForStyle(result.note');
  assert(staleGuardAt >= 0 && staleGuardAt < noteMutationAt, file + ': post-await generation guard is not before note mutation');
  assert(source.indexOf('generationFingerprint') >= 0 && source.indexOf('generationOptFingerprint') >= 0, file + ': editor fingerprint guard is missing');
  assert(source.indexOf("const report=(d&&typeof d.report==='string')") >= 0, file + ': legal report type guard missing');
  assert(source.indexOf("if(!report){ toast('") >= 0, file + ': legal report blank guard missing');

  const asyncGuard = extractFunction(source, 'function _athenaAsyncBindingStillSafe(candidate,actionLabel,expectedEpoch)');
  const guardSandbox = {
    currentVisitAthenaBinding: { id: 'visit-1' }, currentVisitAthenaEpoch: 3,
    currentVisitAthenaCompromised: false, _athenaCurrentMatchesBound: () => true,
    toast: () => {}, console
  };
  vm.createContext(guardSandbox);
  vm.runInContext(asyncGuard + '\nthis.__same = _athenaAsyncBindingStillSafe({id:"visit-1"}, "note generation", 3);\nthis.__oldEpoch = _athenaAsyncBindingStillSafe({id:"visit-1"}, "note generation", 2);\nthis.__otherVisit = _athenaAsyncBindingStillSafe({id:"visit-2"}, "note generation", 3);', guardSandbox);
  assert.strictEqual(guardSandbox.__same, true, file + ': matching generation binding was refused');
  assert.strictEqual(guardSandbox.__oldEpoch, false, file + ': stale generation epoch was accepted');
  assert.strictEqual(guardSandbox.__otherVisit, false, file + ': different generation visit was accepted');

  const valid = runPlan(source, 'generated_soap', 'generated SOAP', { ok: true, sections: validSections });
  assert.deepStrictEqual(Array.from(valid.plan, row => row.kind), ['hpi', 'ros', 'exam', 'assessment', 'plan'], file + ': valid generated SOAP did not create five named rows');
  assert.strictEqual(valid.plan.some(row => row.kind === 'note'), false, file + ': valid generated SOAP fell back to generic note');

  const blocked = runPlan(source, 'generated_soap', 'malformed generated SOAP', { ok: false, sections: [] });
  assert.strictEqual(blocked.blocked, true, file + ': malformed generated SOAP was not blocked');
  assert.strictEqual(Array.from(blocked.plan).length, 0, file + ': blocked generated SOAP retained executable rows');
  const editedBlocked = runPlan(source, 'edited_generated_soap', 'edited malformed generated SOAP', { ok: false, sections: [] });
  assert.strictEqual(editedBlocked.blocked, true, file + ': edited malformed generated SOAP lost its fail-closed provenance');

  const typed = runPlan(source, 'typed', 'typed narrative note', { ok: false, sections: [] });
  assert.strictEqual(typed.blocked, undefined, file + ': typed narrative was incorrectly blocked');
  assert.strictEqual(typed.plan[0].kind, 'note', file + ': typed narrative lost generic-note compatibility');

  if (file === 'ScribeFlow-staging.html') {
    assert(source.includes('var allowed={note:1,hpi:1,ros:1,exam:1,assessment:1,plan:1,dx:1,billing:1,orders:1};'), 'staging allowlist does not include exact five named fields');
    assert(source.includes('sections:namedSections'), 'staging action does not pass named fields to unified review');
  }
}

console.log('PASS generated SOAP provenance: all five shells route valid fields by name, refuse malformed generated SOAP, and preserve typed/narrative generic-note compatibility');
