'use strict';

/* Deterministic active-patient procedure answers. The list path is deliberately
 * separate from chart intent: a procedure question must return dated evidence
 * or an honest no-data answer, never a guessed procedure or a forced graph. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, '1pScribeFlow.html');
const source = fs.readFileSync(appPath, 'utf8');

function extractFunction(text, name) {
  const marker = 'function ' + name + '(';
  const start = text.indexOf(marker);
  assert(start >= 0, name + ' seam is missing from 1pScribeFlow.html');
  const brace = text.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i += 1; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i += 1; continue; }
    if (ch === '\'' || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error(name + ' body is unterminated');
}

const helperStart = source.indexOf('function _copilotClinicalText(');
const helperEnd = source.indexOf('/* Lean, id-carrying snapshot', helperStart);
assert(helperStart >= 0 && helperEnd > helperStart, 'could not isolate Copilot helper block');
const helperSource = source.slice(helperStart, helperEnd);
assert(/function _copilotProcedureAnswerForQuestion\(/.test(helperSource),
  'the deterministic procedure answer seam is missing');
const askSource = extractFunction(source, 'copilotAsk');
assert(askSource.indexOf('if(localProcedure)') >= 0,
  'copilotAsk does not claim the deterministic procedure path');
assert(askSource.indexOf('if(localProcedure)') < askSource.indexOf("var r=await fetch"),
  'procedure questions reach the generic model before the deterministic answer path');

const context = {
  console, String, Number, Boolean, Array, Object, Math, Date, RegExp, JSON,
  isNaN, parseInt, parseFloat,
  window: null, globalThis: null,
  document: { getElementById() { return null; } }
};
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(
  helperSource +
  '\nthis.__procedureApi = {' +
  '_copilotBuildLongitudinalPatient: _copilotBuildLongitudinalPatient,' +
  '_copilotProcedureAnswerForQuestion: _copilotProcedureAnswerForQuestion,' +
  '_copilotChartForQuestion: _copilotChartForQuestion' +
  '};',
  context,
  { filename: appPath + ':copilot-procedure-seams' }
);

const api = context.__procedureApi;
assert(api && typeof api._copilotBuildLongitudinalPatient === 'function');
assert(api && typeof api._copilotProcedureAnswerForQuestion === 'function');

const patient = {
  id: 'pt-A', name: 'Synthetic Active A',
  visits: [
    { id: 'a1', sourceVisitKey: 'enc:a1', encounterId: 'a1', date: '2026-01-10',
      source: 'athena-visits', identityVerified: true, identityBinding: 'pt-A',
      fullDetail: true, bodyComplete: true, procedure: 'Lumbar epidural injection',
      cpt: ['62323'], raw: 'Verified procedure body.' },
    /* A mirrored verified row with a different local id must collapse by its
       same date + procedure evidence, not create a second procedure. */
    { id: 'a1-mirror', sourceVisitKey: 'mirror:a1', encounterId: 'a1-mirror', date: '2026-01-10',
      source: 'athena-copy', identityVerified: true, identityBinding: 'pt-A',
      fullDetail: true, bodyComplete: true, type: 'Lumbar epidural injection',
      procedureCodes: ['62323'], raw: 'Mirrored verified procedure body.' },
    { id: 'a2', sourceVisitKey: 'enc:a2', encounterId: 'a2', date: '2026-03-04',
      source: 'athena-visits', identityVerified: true, identityBinding: 'pt-A',
      fullDetail: true, bodyComplete: true, type: 'Radiofrequency ablation',
      cpt: ['64635'], raw: 'Second verified procedure body.' },
    { id: 'a3-unverified', date: '2026-04-04', type: 'Unverified surgery',
      source: 'athena-visits', identityVerified: false, identityBinding: 'pt-other',
      fullDetail: true, bodyComplete: true, procedure: 'Unverified surgery', cpt: ['99999'], raw: 'DO NOT USE' },
    { id: 'b1-foreign', date: '2026-05-04', type: 'Foreign procedure',
      source: 'athena-visits', identityVerified: true, identityBinding: 'pt-B',
      fullDetail: true, bodyComplete: true, procedure: 'Foreign procedure', cpt: ['88888'], raw: 'FOREIGN DO NOT USE' },
    { id: 'b2-local-foreign', date: '2026-05-05', type: 'Local foreign procedure',
      source: 'mls-visit-editor', identityVerified: true, identityBinding: 'pt-B',
      fullDetail: true, bodyComplete: true, procedure: 'Local foreign procedure', cpt: ['88887'], raw: 'LOCAL FOREIGN DO NOT USE' },
    { id: 'a-index', date: '2026-06-04', type: 'Indexed procedure',
      source: 'athena-visits', identityVerified: true, identityBinding: 'pt-A',
      indexOnly: true, fullDetail: false, bodyComplete: false,
      procedure: 'Indexed procedure', cpt: ['77777'], textHead: 'metadata only' }
  ]
};

const question = 'what procedures did he get done';
const longitudinal = api._copilotBuildLongitudinalPatient(patient, question);
assert(!longitudinal.visits.some((v) => v.visitId === 'b2-local-foreign'),
  'a conflicting local binding entered the active-patient timeline before procedure filtering');
assert(!JSON.stringify(longitudinal).includes('LOCAL FOREIGN DO NOT USE'),
  'a conflicting local row leaked into generic longitudinal context');
const answer = api._copilotProcedureAnswerForQuestion(question, longitudinal);
assert(answer, 'exact procedure question was not recognized');
assert.strictEqual(answer.kind, 'patient-procedure-list');
assert.strictEqual(answer.status, 'ready');
assert.strictEqual(answer.patientId, 'pt-A');
assert.strictEqual(answer.procedures.length, 2, 'mirrored same-date procedure was not deduplicated');
assert.strictEqual(answer.procedures.map((p) => p.date).join('|'), '2026-01-10|2026-03-04',
  'procedure dates are not distinct, deterministic, and chronological');
assert.strictEqual(answer.procedures.map((p) => p.name).join('|'),
  'Lumbar epidural injection|Radiofrequency ablation');
assert(answer.procedures.every((p) => p.ref && p.source && p.date),
  'every procedure answer must carry a source reference and date');
assert(!JSON.stringify(answer).includes('Unverified surgery'));
assert(!JSON.stringify(answer).includes('Foreign procedure'));
assert(!JSON.stringify(answer).includes('Indexed procedure'));
assert(/2026-01-10/.test(answer.message) && /2026-03-04/.test(answer.message),
  'the answer text does not cite each procedure date');

for (const variant of [
  'Which procedures were performed?',
  'List the procedures he has had',
  'tell me what procedures were done for him'
]) {
  const variantAnswer = api._copilotProcedureAnswerForQuestion(variant, longitudinal);
  assert(variantAnswer && variantAnswer.status === 'ready',
    'procedure wording variant did not use the deterministic list path: ' + variant);
  assert.strictEqual(variantAnswer.procedures.length, 2);
  assert.strictEqual(api._copilotChartForQuestion(variant, longitudinal), null,
    'a procedure list question was incorrectly forced into chart behavior');
}

const empty = api._copilotBuildLongitudinalPatient({
  id: 'pt-empty', name: 'No Procedures', visits: [
    { id: 'e1', date: '2026-01-01', type: 'Follow-up', source: 'mls-visit-editor', raw: 'No procedure documented.' }
  ]
}, question);
const noData = api._copilotProcedureAnswerForQuestion(question, empty);
assert(noData && noData.status === 'no-data', 'absent procedures did not produce honest no-data');
assert(!noData.procedures.length, 'no-data procedure answer contains fabricated rows');
assert(/no verified procedure records/i.test(noData.message));

const truncatedVisits = Array.from({ length: 35 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 0, 1 + i));
  const date = d.toISOString().slice(0, 10);
  return i === 0
    ? { id: 'old-procedure', date, type: 'Lumbar epidural injection', source: 'mls-visit-editor', cpt: ['62323'], raw: 'Old documented procedure.' }
    : { id: 'recent-' + i, date, type: 'Follow-up', source: 'mls-visit-editor', raw: 'Recent follow-up.' };
});
const truncated = api._copilotBuildLongitudinalPatient({ id: 'pt-truncated', name: 'Bounded Procedure Patient', visits: truncatedVisits }, question);
const truncatedAnswer = api._copilotProcedureAnswerForQuestion(question, truncated);
assert.strictEqual(truncatedAnswer.status, 'no-data', 'an out-of-window procedure was silently promoted into the bounded answer');
assert(/included evidence/i.test(truncatedAnswer.message) && /older or omitted records/i.test(truncatedAnswer.message),
  'bounded procedure no-data answer made an unqualified whole-history claim');

console.log('PASS Copilot procedure answer: exact and variant questions use active-patient verified dated evidence; mirrored same-date rows dedupe; foreign/unverified/index-only rows are excluded; no-data is explicit; no chart is forced');
