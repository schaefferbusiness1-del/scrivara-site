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
  const repairedNote = ['HPI:', 'Synthetic documented history.', '', 'ROS:', "Not documented in today's transcript.", '', 'EXAM:', "Not documented in today's transcript.", '', 'ASSESSMENT:', "Not documented in today's transcript.", '', 'PLAN:', "Not documented in today's transcript."].join('\n');
  const repairedPayload = JSON.stringify({ note: repairedNote });
  const context = {
    AbortController,
    bkBase: () => 'https://synthetic.invalid',
    bkToken: () => 'synthetic-token',
    getNoteModel: () => 'synthetic-model',
    parseGenJSON: value => JSON.parse(value),
    fetch: async (url, init) => {
      request = { url, init, body: JSON.parse(init.body) };
      return { ok: true, json: async () => ({ content: repairedPayload }) };
    }
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);

  const error = { mlsAi: { code: 'draft_quality_failed', issues: ['unsupported_clinical_claim'] } };
  assert.strictEqual(context._mlsUnsupportedClinicalClaimFailure(error), true, 'claim-only rejection was not recognized');
  assert.strictEqual(context._mlsUnsupportedClinicalClaimFailure({ mlsAi: { code: 'draft_quality_failed', issues: ['empty_note'] } }), false, 'unrelated quality failure was incorrectly bypassed');

  const tuning = { families: { hpi: { templateText: 'SYNTHETIC HPI ORDER', instructions: 'SYNTHETIC COMMENT' } } };
  context._mlsValidateStructuredNoteResult(JSON.parse(repairedPayload), tuning);
  const repaired = await context._mlsRepairUnsupportedClinicalClaim('BASE SYSTEM', 'TODAY_TRANSCRIPT_BEGIN\nsynthetic visit\nTODAY_TRANSCRIPT_END', tuning);
  assert.strictEqual(repaired, repairedPayload, 'repair content was not returned');
  assert(request && request.url.endsWith('/api/complete'), 'repair did not use the authenticated conservative completion lane');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(request.body.draftTuning)), tuning, 'saved section/template tuning was dropped during repair');
  assert(request.body.system.includes('Preserve every selected saved format'), 'repair prompt did not preserve saved templates');
  assert(request.body.system.includes('Not documented in today'), 'repair prompt did not require evidence-only placeholders');

  assert(!source.includes('function _mlsDocumentedOnlyNoteResult('), 'normal generation still has a success-shaped documented-only fallback');
  const genStart = source.indexOf('async function generateNote()');
  const genEnd = source.indexOf('\n/* =========================================================\n   AUTO-POPULATE EXTRAS', genStart);
  const generation = source.slice(genStart, genEnd);
  assert(generation.includes('let result=await _mlsAwaitGeneration('), 'normal generation no longer awaits its one hosted generation/repair result directly');
  assert(!generation.includes('_mlsUnsupportedClinicalClaimFailure(initialGenerationError)'), 'normal generation still catches a failed hosted repair as a generated note');
  assert(generation.indexOf('_mlsValidateStructuredNoteResult(result,generationDraftTuning);') < generation.indexOf('currentSoap=_reorderNoteForStyle(result.note'),
    'a failed generation can mutate the prior canonical note before validation');
  assert(generation.includes("var outcome='failed'"), 'generation no longer begins in a failed lifecycle state');
  assert(/finally\{[\s\S]*?_mlsSettleGeneration\(run,outcome,outcomeCode,outcomeMessage\);/.test(generation), 'failed generation no longer settles its lifecycle');

  /* Exercise the actual hosted transport: the primary structured route
     refuses, the one conservative repair refuses, and the original quality
     error must propagate instead of becoming a local note. */
  const transportStart = source.indexOf('function _mlsTemplateRoutingSource(');
  const transportEnd = source.indexOf('\nasync function postChat(', transportStart);
  assert(transportStart >= 0 && transportEnd > transportStart, 'hosted transport block not found');
  const routeCalls = [];
  const transport = {
    window: {}, backendMode: () => true, bkBase: () => 'https://synthetic.invalid', bkToken: () => 'synthetic-token',
    getNoteModel: () => 'synthetic-model', getGenStyle: () => 'soap', hostedNotePreferences: () => ({}), handle401() {},
    fetch: async url => {
      routeCalls.push(url);
      return { ok: false, status: 502, json: async () => ({ error: 'quality refused', code: 'draft_quality_failed', retryable: true, issues: ['unsupported_clinical_claim'] }) };
    }
  };
  vm.createContext(transport);
  vm.runInContext(source.slice(start, end) + '\n' + source.slice(transportStart, transportEnd) + '\nthis.__aiCallRaw=aiCallRaw;', transport);
  let routeError = null;
  try { await transport.__aiCallRaw('SYSTEM', 'synthetic source', '', { resolvedDraftTuning: tuning }); } catch (caught) { routeError = caught; }
  assert.deepStrictEqual(routeCalls, ['https://synthetic.invalid/api/generate', 'https://synthetic.invalid/api/complete'], 'hosted generation did not stop after its one conservative repair');
  assert(routeError && routeError.mlsAi && routeError.mlsAi.code === 'draft_quality_failed', 'two failed hosted routes did not propagate the original quality failure');

  console.log('generation claim repair + template preservation runtime: PASS');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
