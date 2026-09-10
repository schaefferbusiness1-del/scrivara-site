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
    ok(strictBeforeMutation > 0 && firstEditorMutation > strictBeforeMutation,
      file + ': strict validation no longer precedes the first generated editor mutation');
    let repairContent = '';
    const sandbox = {
      window: {},
      stripSignatureBlock: value => String(value || ''),
      _autoDraftStripCarried: value => String(value || ''),
      parseGenJSON: value => JSON.parse(value),
      bkBase: () => 'https://synthetic.invalid',
      bkToken: () => 'synthetic-token',
      getNoteModel: () => 'synthetic-model',
      fetch: async () => ({ ok: true, json: async () => ({ content: repairContent }) })
    };
    vm.createContext(sandbox);
    vm.runInContext(block(source, file) + `
      this.__api={validate:_mlsValidateStructuredNoteResult,repair:_mlsRepairUnsupportedClinicalClaim};`, sandbox, { filename: file });
    const api = sandbox.__api;

    const valid = api.validate({ note: base }, tuning);
    eq(valid.note, base, file + ': valid exact five-field note was rewritten');
    rejected(api, 'Date of Service: synthetic\n' + base, /preamble/i, file + ': metadata preamble');
    rejected(api, base.replace(/^HPI:/, '**HPI:**'), /preamble|unsupported/i, file + ': markdown outer heading');
    rejected(api, base + '\n\nSignature:\n________________', /nested|wrapper|heading/i, file + ': sixth Signature heading');
    rejected(api, base.replace('\nDiscussion:\nReturn after the documented interval.', ''), /active adapt plan template structure/i,
      file + ': missing required Plan template label');

    /* A natural-text or placeholder-only template has no unambiguous two-label
       structure and therefore remains guidance rather than a false gate. */
    eq(api.validate({ note: base }, { families: { plan: { templateMode: 'adapt', templateText: '[PLAN TEXT]' } } }).note, base,
      file + ': placeholder-only template became a structural requirement');

    repairContent = JSON.stringify({ note: base });
    eq(await api.repair('system', 'synthetic source', tuning, null), repairContent,
      file + ': valid repair did not pass byte-for-byte');
    repairContent = JSON.stringify({ note: '**HPI:**\nSynthetic history.\n\n**ROS:**\nSynthetic review.\n\n**EXAM:**\nSynthetic exam.\n\n**ASSESSMENT:**\nSynthetic assessment.\n\n**PLAN:**\nSynthetic plan.\n\n**Signature:**\n____' });
    let repairError = null;
    try { await api.repair('system', 'synthetic source', tuning, null); } catch (caught) { repairError = caught; }
    ok(repairError && repairError.mlsStructuredNoteQuality, file + ': malformed /api/complete repair returned as success');

    ok(source.includes('Your prior draft was retained if one was already open.'), file + ': failure UI does not say the prior draft was retained');
  }
  console.log('PASS structured repair five-field runtime: ' + checks + ' checks; exact display, active Adapt labels, repair boundary, unchanged bytes, and retained-draft UI are enforced in both canonical shells');
})().catch(error => { console.error(error); process.exitCode = 1; });
