'use strict';

/* The template formatter must report the mutation it actually performed. A
 * generated note may keep running when formatting fails, but it must surface
 * that the original note remains unchanged instead of treating a swallowed
 * rejection or empty model response as success. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const production = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const applyStart = 'async function applyTemplateToNote(template,visitText,expectedBinding,expectedEpoch)';
const applyEnd = '\nfunction openDoc';
const applySource = production.slice(production.indexOf(applyStart), production.indexOf(applyEnd, production.indexOf(applyStart)));
assert(applySource.includes('return {applied:true,templateId:template.id}'), 'production formatter does not return a success receipt');
assert(applySource.includes('reason:\'empty-output\''), 'production formatter does not report empty model output');
assert(applySource.includes('function reportTemplateApplication'), 'automatic template result reporter is missing');
const maybeSource = applySource.slice(applySource.indexOf('async function maybeApplyTemplate'), applySource.indexOf('function reportTemplateApplication'));
assert.strictEqual((maybeSource.match(/resolveActiveTemplate\(/g) || []).length, 1, 'maybeApplyTemplate resolves the active template more than once');
const generationSource = production.slice(production.indexOf('async function generateNote'), production.indexOf('/* =========================================================', production.indexOf('async function generateNote')));
assert(generationSource.includes('reportTemplateApplication(templateResult,templateResult&&templateResult.templateName)'), 'automatic generation does not report the template result');
assert(!generationSource.includes('resolveActiveTemplate('), 'automatic generation created a second template-selection point');

for (const file of ['1pScribeFlow.html', '1p/index.html', 'cloned/index.html', 'ScribeFlow-staging.html', 'ScribeFlow_test.html']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.indexOf('async function applyTemplateToNote');
  assert(start >= 0, `${file} has no template formatter`);
  const end = source.indexOf('\nfunction openDoc', start);
  const block = source.slice(start, end);
  assert(block.includes('return {applied:true,templateId:template.id}'), `${file} has no honest success receipt`);
  assert(block.includes('reason:\'ai-error\''), `${file} does not report thrown formatter errors`);
  const maybe = block.slice(block.indexOf('async function maybeApplyTemplate'), block.indexOf('function reportTemplateApplication'));
  assert.strictEqual((maybe.match(/resolveActiveTemplate\(/g) || []).length, 1, `${file} resolves the active template more than once`);
  const genStart = source.indexOf('async function generateNote');
  const genEnd = source.indexOf('/* =========================================================', genStart);
  assert(genStart >= 0 && genEnd > genStart && !source.slice(genStart, genEnd).includes('resolveActiveTemplate('), `${file} generation has a second template-selection point`);
}

function harness(options) {
  options = options || {};
  const state = {
    format: 'soap',
    soap: 'Original note',
    insurance: '',
    safe: options.safe !== false,
    calls: 0,
    mode: options.mode || 'success'
  };
  const noteBox = { value: state.soap, style: { display: 'block' }, dispatchEvent() {} };
  const context = {
    window: { __mlsCodeTable: null },
    document: { getElementById(id) { return id === 'noteBox' ? noteBox : null; } },
    Promise, String, Object, Array, RegExp, JSON, Math, Date, console, AbortController,
    setTimeout, clearTimeout
  };
  const script = `
    let currentFormat = 'soap';
    let currentSoap = 'Original note';
    let currentInsurance = '';
    let currentVisitAthenaBinding = { id: 'visit-1' };
    let currentVisitAthenaEpoch = 4;
    function hasAI() { return true; }
    function getKey() { return 'test-key'; }
    function _tplTextForDraft(text) { return String(text || ''); }
    function _athenaAsyncBindingStillSafe() {
      calls += 1;
      return safe;
    }
    function _athenaEditorFingerprint() { return fingerprint; }
    function _mlsSyncAthenaAfterStandardNoteMutation() {}
    function _markVisitDirty() {}
    function toast(message, kind) { messages.push(String(message) + '|' + String(kind || '')); }
    function useTemplatesOn() { return true; }
    function resolveActiveTemplate() { selectionCalls += 1; return { id: 'tpl-1', name: 'Test template', text: 'TEMPLATE' }; }
    async function aiCallRaw() {
      if (mode === 'pending') return pending;
      if (mode === 'thrown') throw new Error('mock failure');
      if (mode === 'empty') return '   ';
      if (mode === 'stale') { safe = false; return 'Formatted note'; }
      return 'Formatted note';
    }
    ${applySource}
    this.api = { applyTemplateToNote, maybeApplyTemplate, reportTemplateApplication };
    this.state = { get soap() { return currentSoap; }, get calls() { return calls; }, get selectionCalls() { return selectionCalls; } };
  `;
  context.calls = state.calls;
  context.safe = state.safe;
  context.mode = state.mode;
  context.fingerprint = 'fp-1';
  context.messages = [];
  context.selectionCalls = 0;
  context.pending = options.pending || Promise.resolve('Formatted note');
  vm.runInNewContext(script, context);
  return { api: context.api, state, context, noteBox };
}

(async function run() {
  let h = harness({ mode: 'success' });
  let result = await h.api.applyTemplateToNote({ id: 'tpl-1', name: 'Test', text: 'TEMPLATE' }, 'visit', { id: 'visit-1' }, 4);
  assert.strictEqual(result.applied, true, 'successful formatting was not acknowledged');
  assert.strictEqual(result.templateId, 'tpl-1');
  assert.strictEqual(h.context.api ? h.context.state.soap : '', 'Formatted note', 'successful formatting did not mutate the note');
  h.api.reportTemplateApplication(result, 'Test template');
  assert(h.context.messages.some(message => message.includes('Note formatted to template: Test template')), 'automatic success did not announce the applied template');
  h = harness({ mode: 'success' });
  const maybe = await h.api.maybeApplyTemplate('visit', { id: 'visit-1' }, 4);
  assert.strictEqual(maybe.applied, true, 'maybeApplyTemplate did not return the formatter receipt');
  assert.strictEqual(maybe.templateId, 'tpl-1');
  assert.strictEqual(maybe.templateName, 'Test template');
  assert.strictEqual(h.context.state.selectionCalls, 1, 'maybeApplyTemplate selected the template more than once');

  h = harness({ mode: 'thrown' });
  result = await h.api.applyTemplateToNote({ id: 'tpl-1', text: 'TEMPLATE' }, 'visit', { id: 'visit-1' }, 4);
  assert.deepStrictEqual({ applied: result.applied, reason: result.reason }, { applied: false, reason: 'ai-error' });
  assert.strictEqual(h.context.state.soap, 'Original note', 'thrown formatter changed the original note');
  h.api.reportTemplateApplication(result, 'Test template');
  assert(h.context.messages.some(message => message.includes('original note is unchanged')), 'automatic failure did not warn that the original note is unchanged');
  assert(!h.context.messages.some(message => message.includes('Note formatted to template')), 'automatic failure emitted a false success toast');

  h = harness({ mode: 'empty' });
  result = await h.api.applyTemplateToNote({ id: 'tpl-1', text: 'TEMPLATE' }, 'visit', { id: 'visit-1' }, 4);
  assert.deepStrictEqual({ applied: result.applied, reason: result.reason }, { applied: false, reason: 'empty-output' });
  assert.strictEqual(h.context.state.soap, 'Original note', 'empty formatter output changed the original note');

  h = harness({ mode: 'stale' });
  result = await h.api.applyTemplateToNote({ id: 'tpl-1', text: 'TEMPLATE' }, 'visit', { id: 'visit-1' }, 4);
  assert.deepStrictEqual({ applied: result.applied, reason: result.reason }, { applied: false, reason: 'stale-visit' });
  assert.strictEqual(h.context.state.soap, 'Original note', 'stale formatter result changed the original note');

  let resolveLate;
  const late = new Promise((resolve) => { resolveLate = resolve; });
  h = harness({ mode: 'pending', pending: late });
  const controller = new AbortController();
  const lateResult = h.api.applyTemplateToNote(
    { id: 'tpl-1', text: 'TEMPLATE' },
    'visit',
    { id: 'visit-1' },
    4,
    { signal: controller.signal }
  );
  controller.abort('template-timeout');
  resolveLate('Formatted note that arrived after the deadline');
  result = await lateResult;
  assert.deepStrictEqual({ applied: result.applied, reason: result.reason }, { applied: false, reason: 'aborted' });
  assert.strictEqual(h.context.state.soap, 'Original note', 'late aborted formatter overwrote the successful original note');

  console.log('PASS template application receipts: success mutates; thrown, empty, stale, and late-aborted paths preserve the original note');
})();
