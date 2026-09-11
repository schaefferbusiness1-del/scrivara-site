/* A hosted unsupported-claim repair used /api/complete and then passed through
 * the broad display validator. Exercise the shipped frontend functions so a
 * malformed repair cannot replace the editor or produce a stale Athena copy. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1pScribeFlow.html', 'ScribeFlow.html'];
let checks = 0;
function ok(value, message) { assert.ok(value, message); checks += 1; }
function eq(actual, expected, message) { assert.strictEqual(actual, expected, message); checks += 1; }

const base = [
  'HPI:', 'Synthetic documented history for today.', '',
  'ROS:', "Not documented in today's transcript.", '',
  'EXAM:', 'Synthetic documented examination finding today.', '',
  'ASSESSMENT:', 'Synthetic documented assessment remains provisional.', '',
  'PLAN:',
  'DIAGNOSIS:', 'Synthetic documented condition.',
  'Recommendations:', 'Proceed with the documented next step.',
  'Discussion:', 'Return after the documented interval.'
].join('\n');
const tuning = { families: { plan: {
  templateMode: 'adapt',
  templateText: 'PLAN FOR TODAY\nDIAGNOSIS:\n[DOCUMENTED CONDITION]\nRecommendations:\n[DOCUMENTED PLAN]\nDiscussion:\n[DOCUMENTED DISCUSSION]'
} } };

function block(source, file) {
  const start = source.indexOf('function _mlsStructuredNoteQualityError(');
  const end = source.indexOf('\n\n/* =========================================================\n   GENERATE NOTE', start);
  assert(start >= 0 && end > start, file + ': structured/canonical block missing');
  return source.slice(start, end);
}
function tuningBlock(source, file) {
  const start = source.indexOf('function _mlsGenerationDraftTuning(');
  const end = source.indexOf('\nasync function generateNote()', start);
  assert(start >= 0 && end > start, file + ': generation tuning block missing');
  return source.slice(start, end);
}
function generationBlock(source, file) {
  const start = source.indexOf('async function generateNote()');
  const end = source.indexOf('\n/* =========================================================\n   AUTO-POPULATE EXTRAS', start);
  assert(start >= 0 && end > start, file + ': generateNote block missing');
  return source.slice(start, end);
}
function rejected(api, note, expected, label) {
  let error = null;
  try { api.validate({ note }, tuning); } catch (caught) { error = caught; }
  ok(error && error.mlsStructuredNoteQuality, label + ' was accepted');
  ok(expected.test(String(error && error.mlsAi && error.mlsAi.detail)), label + ' reported the wrong reason');
}

(async function () {
  for (const file of shells) {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    const strictBeforeMutation = source.indexOf('_mlsValidateStructuredNoteResult(result,generationDraftTuning);');
    const firstEditorMutation = source.indexOf('currentSoap=_reorderNoteForStyle(result.note', strictBeforeMutation);
    const ensureTuning = source.indexOf('await _mlsAwaitGeneration(run,Promise.resolve().then(function(){return window.__mlsEnsureDraftTuning();})');
    const captureTuning = source.indexOf('const generationDraftTuning=_mlsResolvedGenerationDraftTuning(transcript,evidence);');
    ok(strictBeforeMutation > 0 && firstEditorMutation > strictBeforeMutation,
      file + ': strict validation no longer precedes the first generated editor mutation');
    ok(ensureTuning > 0 && captureTuning > ensureTuning, file + ': settings were frozen before the lazy profile load completed');
    ok(source.includes('resolvedDraftTuning:generationDraftTuning'), file + ': request did not receive the validated tuning snapshot');
    ok(source.includes('draftTuningResolved:!!options.resolvedDraftTuning'), file + ': request did not mark the resolved tuning snapshot');
    ok(source.includes("if(opts.draftTuningResolved!==true&&typeof _dt.autoRoute==='function')"), file + ': transport can reroute the frozen tuning snapshot');
    ok(source.includes("opts.draftTuningResolved===true&&_draftFamily==='soap'"), file + ': transport can rebuild the frozen structured tuning snapshot');
    ok(!source.includes('function _mlsDocumentedOnlyNoteResult('), file + ': failed hosted routes can still become a documented-only success');
    {
      const transcriptEl = { value: 'Synthetic source retained byte for byte.' };
      const noteEl = { value: 'PRIOR DISPLAY NOTE' };
      const genBtn = { disabled: false, innerHTML: 'Generate' };
      const genError = { textContent: '', style: { display: 'none' } };
      const settled = [], toasts = [];
      const failure = Object.assign(new Error('quality refused'), { mlsAi: { code: 'draft_quality_failed', issues: ['unsupported_clinical_claim'] } });
      const lifecycle = {
        window: {}, document: { getElementById(id) { return ({ transcript: transcriptEl, noteBox: noteEl, genBtn, genError, noteGenError: genError })[id] || null; } },
        _mlsGenerationEvidenceDecision: () => ({ ok: true }), _mlsExactScheduledClinicalAction: () => true,
        _athenaGuardBoundEditor: () => true, hasAI: () => true,
        _mlsStartGeneration: () => ({ id: 7, controller: { signal: null }, abortReason: '' }),
        refreshGenSectionProfiles() {}, autoFillVisitComment() {},
        _athenaBindingForCurrentVisit: () => ({ id: 'binding-one' }), _mlsAthenaGenerationSourceFingerprint: () => 'source-fp',
        _mlsAthenaGenerationKey: () => 'generation-key', _athenaEditorFingerprint: () => 'editor-fp',
        _mlsGenerationFingerprintRest: () => 'editor-rest', _mlsGenerationSourceRest: () => 'source-rest',
        getGenStyle: () => 'soap', getKey: () => 'synthetic-key', _mlsResolvedGenerationDraftTuning: () => Object.freeze({}),
        _mlsAwaitGeneration: async (_run, promise) => await promise, _mlsGenerationTimeoutMs: () => 10,
        callOpenAI: async () => { throw failure; }, friendlyError: () => 'Generation could not finish. Your prior draft was retained.',
        toast: (message, kind) => toasts.push({ message, kind }),
        _mlsSettleGeneration: (_run, outcome, code, message) => settled.push({ outcome, code, message })
      };
      vm.createContext(lifecycle);
      vm.runInContext("var currentVisitAthenaBinding={id:'binding-one'},currentVisitAthenaEpoch=1,currentFormat='soap',currentOpt=null,currentSoap='PRIOR CANONICAL NOTE',currentNoteProvenance='generated_soap',currentAthenaNote='PRIOR ATHENA NOTE',_mlsActiveGeneration=null;" +
        generationBlock(source, file) + '\nthis.__generate=generateNote;this.__state=function(){return {soap:currentSoap,provenance:currentNoteProvenance,athena:currentAthenaNote};};', lifecycle, { filename: file + ':failed-generation' });
      eq(await lifecycle.__generate(), false, file + ': two failed hosted routes were reported as generation success');
      assert.deepStrictEqual(JSON.parse(JSON.stringify(lifecycle.__state())), { soap: 'PRIOR CANONICAL NOTE', provenance: 'generated_soap', athena: 'PRIOR ATHENA NOTE' }); checks += 1;
      eq(noteEl.value, 'PRIOR DISPLAY NOTE', file + ': failed generation changed the displayed prior note');
      eq(transcriptEl.value, 'Synthetic source retained byte for byte.', file + ': failed generation changed the source');
      eq(settled.length, 1, file + ': failed generation did not settle exactly once');
      eq(settled[0].outcome, 'failed', file + ': failed generation emitted a success lifecycle');
      eq(settled[0].code, 'draft_quality_failed', file + ': failed generation lost the backend quality code');
      ok(toasts.some(item => item.kind === 'err' && /prior draft was retained/i.test(item.message)), file + ': failed generation did not explain retained prior draft');
    }
    let repairContent = '', stripCalls = 0;
    const sandbox = {
      window: {},
      stripSignatureBlock: value => { stripCalls += 1; return String(value || '').replace(/\nSignature:[\s\S]*$/i, ''); },
      _autoDraftStripCarried: value => String(value || ''),
      parseGenJSON: value => JSON.parse(value),
      bkBase: () => 'https://synthetic.invalid',
      bkToken: () => 'synthetic-token',
      getNoteModel: () => 'synthetic-model',
      fetch: async () => ({ ok: true, json: async () => ({ content: repairContent }) })
    };
    vm.createContext(sandbox);
    vm.runInContext(block(source, file) + `
      this.__api={validate:_mlsValidateStructuredNoteResult,repair:_mlsRepairUnsupportedClinicalClaim,required:_mlsRequiredTemplateHeadings};`, sandbox, { filename: file });
    const api = sandbox.__api;

    const valid = api.validate({ note: base }, tuning);
    eq(valid.note, base, file + ': valid exact five-field note was rewritten');
    eq(stripCalls, 0, file + ': raw model response passed through the displayed-note signature stripper');
    rejected(api, 'Date of Service: synthetic\n' + base, /preamble/i, file + ': metadata preamble');
    rejected(api, base.replace(/^HPI:/, '**HPI:**'), /preamble|unsupported/i, file + ': markdown outer heading');
    rejected(api, base + '\n\n**Signature:**', /signature heading/i, file + ': bold Signature heading');
    rejected(api, base + '\n\nSignature: [provider]', /signature heading/i, file + ': provider Signature heading');
    rejected(api, base + '\n\nSignature', /signature heading/i, file + ': bare Signature heading');
    eq(stripCalls, 0, file + ': signature stripper hid a malformed raw model response');
    const planProse = base.replace('Return after the documented interval.', 'Return after the documented interval. Signature requirements for a future form were discussed.');
    eq(api.validate({ note: planProse }, tuning).note, planProse, file + ': ordinary Plan prose containing signature was rejected');
    rejected(api, base.replace('\nDiscussion:\nReturn after the documented interval.', ''), /active adapt plan template structure/i,
      file + ': missing required Plan template label');

    /* A natural-text or placeholder-only template has no unambiguous two-label
       structure and therefore remains guidance rather than a false gate. */
    eq(api.validate({ note: base }, { families: { plan: { templateMode: 'adapt', templateText: '[PLAN TEXT]' } } }).note, base,
      file + ': placeholder-only template became a structural requirement');
    const noPlan = base.replace('DIAGNOSIS:\nSynthetic documented condition.\nRecommendations:\nProceed with the documented next step.\nDiscussion:\nReturn after the documented interval.', "Not documented in today's transcript.");
    eq(api.validate({ note: noPlan }, tuning).note, noPlan, file + ': exact no-plan-evidence body was forced to invent template fields');
    rejected(api, noPlan.replace("PLAN:\nNot documented in today's transcript.", "PLAN:\nNot documented in today's transcript.\nA mixed statement."), /active adapt plan template structure/i,
      file + ': mixed Plan body incorrectly received the no-evidence exemption');
    for (const family of ['hpi', 'ros', 'exam', 'assessment']) {
      const outer = family.toUpperCase();
      const sparse = base.replace(new RegExp(outer + ':\\n[\\s\\S]*?(?=\\n\\n(?:HPI|ROS|EXAM|ASSESSMENT|PLAN):|$)'), outer + ":\nNot documented in today's transcript.");
      const familyTuning = { families: { [family]: { templateMode: 'adapt', templateText: 'FIRST FIELD:\n[x]\nSECOND FIELD:\n[y]' } } };
      eq(api.validate({ note: sparse }, familyTuning).note, sparse, file + ': exact no-evidence ' + outer + ' body was forced to invent template fields');
    }
    const reservedTemplate = { templateMode: 'adapt', templateText: 'DATE OF SERVICE:\n[DATE]\nVISIT TYPE:\n[TYPE]\nDIAGNOSIS:\n[DIAGNOSIS]\nRecommendations:\n[PLAN]' };
    assert.deepStrictEqual(Array.from(api.required(reservedTemplate, 'plan')), ['DIAGNOSIS', 'RECOMMENDATIONS']); checks += 1;
    const compositeExample = { templateMode: 'adapt', templateText: 'ASSESSMENT\n[CONDITION #] — [STATUS]; pain today [PAIN SCORE]:\nDocumented finding:\n[FINDING]\nClinical status:\n[STATUS]' };
    assert.deepStrictEqual(Array.from(api.required(compositeExample, 'assessment')), ['DOCUMENTED FINDING', 'CLINICAL STATUS']); checks += 1;
    const onePlaceholderExample = { templateMode: 'adapt', templateText: '[CONDITION] status:\nDocumented finding:\n[FINDING]\nClinical status:\n[STATUS]' };
    assert.deepStrictEqual(Array.from(api.required(onePlaceholderExample, 'assessment')), ['DOCUMENTED FINDING', 'CLINICAL STATUS']); checks += 1;
    const placeholderAfterColon = { templateMode: 'adapt', templateText: 'DIAGNOSIS: [value]\nRecommendations: [documented plan]' };
    assert.deepStrictEqual(Array.from(api.required(placeholderAfterColon, 'plan')), ['DIAGNOSIS', 'RECOMMENDATIONS']); checks += 1;

    repairContent = JSON.stringify({ note: base });
    eq(await api.repair('system', 'synthetic source', tuning, null), repairContent,
      file + ': valid repair did not pass byte-for-byte');
    repairContent = JSON.stringify({ note: '**HPI:**\nSynthetic history.\n\n**ROS:**\nSynthetic review.\n\n**EXAM:**\nSynthetic exam.\n\n**ASSESSMENT:**\nSynthetic assessment.\n\n**PLAN:**\nSynthetic plan.\n\n**Signature:**\n____' });
    let repairError = null;
    try { await api.repair('system', 'synthetic source', tuning, null); } catch (caught) { repairError = caught; }
    ok(repairError && repairError.mlsStructuredNoteQuality, file + ': malformed /api/complete repair returned as success');

    ok(source.includes('Your prior draft was retained if one was already open.'), file + ': failure UI does not say the prior draft was retained');

    const mutableTuning = { families: { plan: { templateMode: 'adapt', templateText: 'DIAGNOSIS:\n[x]\nRecommendations:\n[y]' } } };
    const tuningSandbox = {
      window: { __mlsDraftTuning: {
        installed: true,
        autoRoute: (_source, requested) => requested,
        forStructured: requested => requested
      } },
      getGenSectionProfileOverrides: () => mutableTuning
    };
    vm.createContext(tuningSandbox);
    vm.runInContext(tuningBlock(source, file) + '\nthis.__resolved=_mlsResolvedGenerationDraftTuning("synthetic",{});', tuningSandbox, { filename: file + ':tuning' });
    mutableTuning.families.plan.templateMode = 'guide';
    eq(tuningSandbox.__resolved.families.plan.templateMode, 'adapt', file + ': resolved request tuning drifted after capture');
    ok(Object.isFrozen(tuningSandbox.__resolved) && Object.isFrozen(tuningSandbox.__resolved.families.plan), file + ': resolved request tuning was not deeply frozen');
  }
  console.log('PASS structured repair five-field runtime: ' + checks + ' checks; exact display, active Adapt labels, repair boundary, unchanged bytes, and retained-draft UI are enforced in both canonical shells');
})().catch(error => { console.error(error); process.exitCode = 1; });
