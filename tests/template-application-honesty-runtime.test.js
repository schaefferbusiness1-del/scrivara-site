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
/* noteq-1.0.0 / noteq-1.1.0 (b118x) put the note-quality floor on the reformat
 * pass: applyTemplateToNote now awaits __mlsNoteQualityEnsure(), appends
 * __mlsNoteQualityContract('template-fidelity',...) to the system prompt, and
 * regrades what came back through __mlsNoteQualityOnce. Those wrappers live
 * ABOVE this slice, so the slice alone stopped running (ReferenceError on the
 * first contract).
 * The host lifts the REAL wrappers out of the same shipped file and installs
 * the REAL module as window.__mlsNoteQuality - the way
 * tests/note-quality-proof.js does - so the formatter under test builds the
 * same prompt and takes the same single regrade it takes in production. A
 * no-op stub would prove the receipts of a formatter that skips the floor,
 * which is not the formatter that ships. */
const noteqHostSource = production.slice(
  production.indexOf('var NOTEQ_MAX_REGEN = 1;'),
  production.indexOf('async function aiCallRaw(sys,user,key,opts){'));
assert(noteqHostSource.includes('function __mlsNoteQualityContract(noteType,opts){'),
  'the shipped note-quality prompt wrapper could not be sliced out of ScribeFlow.html');
assert(noteqHostSource.includes('async function __mlsNoteQualityOnce(text,noteType,ctx,again){'),
  'the shipped note-quality one-shot regrade could not be sliced out of ScribeFlow.html');
const noteQuality = require(path.join(root, 'feat_mls_note_quality.js'));
assert(typeof noteQuality.contractFor === 'function' && typeof noteQuality.grade === 'function' &&
  typeof noteQuality.floor === 'function',
  'the note-quality module no longer exports the contractFor/grade/floor shape the wrappers call');
/* vnfid-1.0.0: this pinned the exact SPELLING of the success receipt, so a
 * receipt that grew an honest extra field (the template-conformance measure)
 * would red a suite that the change strengthened. Pin the PROPERTY instead:
 * applied:true carrying the template it applied. */
const SUCCESS_RECEIPT = /return \{applied:true,templateId:template\.id[,}]/;
assert(SUCCESS_RECEIPT.test(applySource), 'production formatter does not return a success receipt');
assert(applySource.includes('reason:\'empty-output\''), 'production formatter does not report empty model output');
assert(applySource.includes('function reportTemplateApplication'), 'automatic template result reporter is missing');
const maybeSource = applySource.slice(applySource.indexOf('async function maybeApplyTemplate'), applySource.indexOf('function reportTemplateApplication'));
assert.strictEqual((maybeSource.match(/resolveActiveTemplate\(/g) || []).length, 1, 'maybeApplyTemplate resolves the active template more than once');
const generationSource = production.slice(production.indexOf('async function generateNote'), production.indexOf('/* =========================================================', production.indexOf('async function generateNote')));
const templateLifecycleSource = production.slice(production.indexOf('function _mlsStartOptionalTemplate'), production.indexOf('function _mlsHasTrustedVerifiedHistory'));
assert(templateLifecycleSource.includes('reportTemplateApplication(receipt,receipt&&receipt.templateName)'), 'optional template owner does not report a completed template result');
assert(generationSource.includes('_mlsStartOptionalTemplate(transcript,generationBinding,generationEpoch,transcriptEl)'), 'automatic generation does not launch its bounded optional template owner');
assert(!generationSource.includes('resolveActiveTemplate('), 'automatic generation created a second template-selection point');

for (const file of ['1pScribeFlow.html', '1p/index.html', 'cloned/index.html', 'ScribeFlow-staging.html', 'ScribeFlow_test.html']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const start = source.indexOf('async function applyTemplateToNote');
  assert(start >= 0, `${file} has no template formatter`);
  const end = source.indexOf('\nfunction openDoc', start);
  const block = source.slice(start, end);
  assert(SUCCESS_RECEIPT.test(block), `${file} has no honest success receipt`);
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
    window: { __mlsCodeTable: null, __mlsNoteQuality: noteQuality },
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
    ${noteqHostSource}
    ${applySource}
    this.api = { applyTemplateToNote, maybeApplyTemplate, reportTemplateApplication };
    this.noteq = { contract: __mlsNoteQualityContract };
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
  /* The floor is REALLY in this host, not stubbed away: the template-fidelity
     contract the reformat pass appends to its own prompt is real prose here. */
  assert(h.context.noteq.contract('template-fidelity', { template: 'X' }).length > 200,
    'the note-quality contract is empty in this host, so every receipt below would be proving a formatter that ships without the floor');
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

/* ngsig-1.0.0 executed pin (2026-09-01): everything above slices the SHELL
 * formatter, but production runs it through ngv1's wrapApply overlay - which
 * used to DROP the fifth options/{signal} argument on its sanitized main
 * path, leaving every abort guard above dead on the live path while this
 * suite stayed green. Lift the REAL overlay from the production connect lane
 * (the kind-and-keyword pins suite proves all three lanes carry identical
 * slices) and prove the SAME signal object reaches the wrapped formatter's
 * arguments[4] on BOTH paths. */
(async () => {
  const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  const ngv1At = connect.indexOf('var API = { v: "ngv1-1.1.0" };');
  assert(ngv1At > 0, 'ngv1 overlay is missing from the production connect lane');
  const wrapAt = connect.indexOf('var _origApply = null;', ngv1At);
  const wrapEnd = connect.indexOf('* E. keyword backfill', wrapAt);
  assert(wrapAt > ngv1At && wrapEnd > wrapAt, 'ngv1 wrapApply region moved');
  const wrapSlice = connect.slice(wrapAt, connect.lastIndexOf('/*', wrapEnd));

  function overlayHarness() {
    const seen = [];
    const ctx = {
      window: {
        applyTemplateToNote: function (t) { seen.push({ len: arguments.length, opts: arguments[4], tpl: t }); return { applied: true, templateId: t && t.id }; },
      },
      Promise, console,
      isFn: (f) => typeof f === 'function',
      sanitizeTplText: (t) => ({ text: t, stripped: 0 }),
      logEvent: () => {}, warnOnce: () => {},
      $: () => null,
      S: (v) => String(v == null ? '' : v),
      MARKERS: [],
    };
    vm.createContext(ctx);
    vm.runInContext(wrapSlice + '\nwrapApply();', ctx, { filename: 'ngv1-wrapApply' });
    assert(ctx.window.applyTemplateToNote.__ngv1 === 1, 'the overlay did not install');
    return { ctx, seen };
  }

  const SIG = { aborted: false, __theOneSignal: true };

  /* sanitized main path: template WITH text */
  {
    const { ctx, seen } = overlayHarness();
    ctx.__SIG = SIG;
    await vm.runInContext('window.applyTemplateToNote({id:"t1",name:"T",keywords:[],text:"TPL BODY"},"visit text",{bound:1},7,{signal:__SIG})', ctx);
    assert.strictEqual(seen.length, 1, 'the sanitized path did not reach the wrapped formatter');
    assert(seen[0].opts && seen[0].opts.signal === SIG,
      'NGV1 DROPPED THE SIGNAL AGAIN on the sanitized path - the shell reads arguments[4].signal and every abort guard above is dead in production without it');
    assert.strictEqual(seen[0].tpl.text, 'TPL BODY', 'the sanitized template body did not ride through');
  }

  /* early path: template with NO text forwards the raw argument list */
  {
    const { ctx, seen } = overlayHarness();
    ctx.__SIG = SIG;
    await vm.runInContext('window.applyTemplateToNote({id:"t2",name:"T2"},"visit text",{bound:1},7,{signal:__SIG})', ctx);
    assert.strictEqual(seen.length, 1, 'the no-text path did not reach the wrapped formatter');
    assert(seen[0].opts && seen[0].opts.signal === SIG, 'the no-text path dropped the signal');
  }

  console.log('PASS ngv1 overlay signal pin: the exact {signal} object rides arguments[4] through the REAL production overlay on both paths - the shell abort guards are alive on the live path');
})().catch((e) => { console.error(e); process.exit(1); });
})();
