'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

(async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '1pScribeFlow.html'), 'utf8');
  const start = source.indexOf('function _mlsStructuredNoteQualityError(');
  const end = source.indexOf('\nfunction _mlsAthenaSourceState(', start);
  assert(start >= 0 && end > start, 'claim-repair runtime block not found');

  let request = null;
  const context = {
    AbortController,
    bkBase: () => 'https://synthetic.invalid',
    bkToken: () => 'synthetic-token',
    getNoteModel: () => 'synthetic-model',
    fetch: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ content: '{"note":"synthetic repaired note"}' }) };
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);

  const error = { mlsAi: { code: 'draft_quality_failed', issues: ['unsupported_clinical_claim'] } };
  assert.strictEqual(context._mlsUnsupportedClinicalClaimFailure(error), true, 'claim-only rejection was not recognized');
  assert.strictEqual(context._mlsUnsupportedClinicalClaimFailure({ mlsAi: { code: 'draft_quality_failed', issues: ['empty_note'] } }), false, 'unrelated quality failure was incorrectly bypassed');

  const tuning = { families: { hpi: { templateText: 'SYNTHETIC HPI ORDER', instructions: 'SYNTHETIC COMMENT' } } };
  const repaired = await context._mlsRepairUnsupportedClinicalClaim('BASE SYSTEM', 'TODAY_TRANSCRIPT_BEGIN\nsynthetic visit\nTODAY_TRANSCRIPT_END', tuning);
  assert.strictEqual(repaired, '{"note":"synthetic repaired note"}', 'repair content was not returned');
  assert(request && request.url.endsWith('/api/complete'), 'repair did not use the authenticated conservative completion lane');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(request.body.draftTuning)), tuning, 'saved section/template tuning was dropped during repair');
  assert(request.body.system.includes('Preserve every selected saved format'), 'repair prompt did not preserve saved templates');
  assert(request.body.system.includes('Not documented in today'), 'repair prompt did not require evidence-only placeholders');

  const fallback = context._mlsDocumentedOnlyNoteResult('Synthetic current symptom only.');
  context._mlsValidateStructuredNoteResult(fallback);
  context._mlsValidateAthenaNote(fallback.athena_note);
  assert(fallback.note.includes('Synthetic current symptom only.'), 'documented words were lost from fallback');
  assert(!/diagnos(?:is|ed)|normal exam|continue medication/i.test(fallback.note), 'fallback invented a clinical claim');
  assert.strictEqual(fallback.mlsDocumentedOnlyFallback, true, 'fallback receipt is missing');

  console.log('generation claim repair + template preservation runtime: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
