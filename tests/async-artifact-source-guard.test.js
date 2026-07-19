'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `Could not locate ${start}`);
  return source.slice(a, b);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const sources = {
  aiToOut: between(app, 'function _aiOutputSourceFingerprint', 'function revenueDenialCheck()'),
  generateRecommendations: between(app, 'async function generateRecommendations()', 'function recommendationsText()'),
  runRedFlagScan: between(app, 'async function runRedFlagScan()', 'function renderRedFlags(text)'),
  generateDifferentials: between(app, 'async function generateDifferentials()', 'function copyDdx()'),
  generateHandout: between(app, 'async function generateHandout()', 'function offlineHandout(dxStr)'),
  generateIME: between(app, 'async function generateIME()', 'function offlineIME()'),
  runCustomWidget: between(app, 'async function runCustomWidget(id,opts)', 'function refreshCustomWidget(id)'),
  autoPopulateCustomWidgets: between(app, 'async function autoPopulateCustomWidgets()', '/* =========================================================\n   INIT')
};

function assertGuardContract(name, guardName, mutationText) {
  const source = sources[name];
  const awaitAt = source.indexOf('await ');
  const postAwaitGuard = source.indexOf(`if(!${guardName}()) return;`, awaitAt);
  const mutationAt = mutationText ? source.indexOf(mutationText, awaitAt) : source.length;
  assert(source.includes('currentVisitAthenaBinding||_athenaBindingForCurrentVisit'), `${name} did not capture an immutable binding candidate`);
  assert(source.includes('currentVisitAthenaEpoch'), `${name} did not capture the visit epoch`);
  assert(source.indexOf('fingerprint') >= 0 || source.indexOf('SourceFingerprint') >= 0, `${name} did not capture source state`);
  assert(awaitAt >= 0 && postAwaitGuard > awaitAt, `${name} did not guard immediately after async work`);
  if(mutationText) assert(mutationAt > postAwaitGuard, `${name} mutates ${mutationText} before its post-await guard`);
  assert(source.includes('_athenaAsyncBindingStillSafe'), `${name} does not use the shared immutable-visit guard`);
}

assertGuardContract('generateRecommendations', 'recResultStillSafe', 'currentRecs=');
assertGuardContract('runRedFlagScan', 'redFlagResultStillSafe', 'currentRedFlags=');
assertGuardContract('generateDifferentials', 'ddxResultStillSafe', 'currentDdx=');
assertGuardContract('generateHandout', 'handoutResultStillSafe', 'currentHandout=');
assertGuardContract('generateIME', 'imeResultStillSafe', 'currentIME=');
assertGuardContract('runCustomWidget', 'customWidgetResultStillSafe', '_cwLatest[id]=');
assertGuardContract('autoPopulateCustomWidgets', 'autoWidgetResultStillSafe');

assert(sources.runRedFlagScan.includes('JSON.stringify([editor,note,tr,pctx])'));
assert(sources.generateDifferentials.includes('JSON.stringify([editor,note,tr,cc,pctx])'));
assert(sources.generateHandout.includes('JSON.stringify([editor,currentDxStr,note,target,stored])'));
assert(sources.generateIME.includes('JSON.stringify([editor,note,transcript,pctx,prefs])'));
assert(sources.generateRecommendations.includes('JSON.stringify([editor,codingLine,note,trans,pctx])'));
assert(sources.runCustomWidget.includes('JSON.stringify([editor,liveWidget,payload,priorOutput,priorState])'));
assert(sources.autoPopulateCustomWidgets.includes('JSON.stringify([editor,liveList,payload,prior])'));
assert(sources.aiToOut.includes('requestBinding=currentVisitAthenaBinding,requestEpoch=currentVisitAthenaEpoch'));
assert(sources.aiToOut.includes('_aiOutputSourceFingerprint(sys,user,outId)!==sourceFingerprint'));
assert(sources.aiToOut.includes('_mlsAiRequestGeneration'));
assert(sources.aiToOut.includes('_mlsAiOutputTargetFingerprint'));
assert(sources.aiToOut.includes('_athenaAsyncBindingStillSafe'));
assert(between(app, 'function newVisit(opts)', 'function noteRecordFromState').includes('_resetAiVisitOutputs()'));
assert(between(app, 'function _athenaHandleActivePatientChange', 'function _athenaMarkBoundEdit').includes('_resetAiVisitOutputs()'));

function element(id) {
  return {
    id,
    value: '',
    disabled: false,
    innerHTML: '',
    textContent: '',
    style: {},
    querySelectorAll() { return []; },
    scrollIntoView() {}
  };
}

function aiOutputHarness(aiQueue) {
  const elements = {};
  const getElement = (id) => (elements[id] || (elements[id] = element(id)));
  const binding = { id: 'binding-A', patient: { patientId: 'A', name: 'Patient A' } };
  const context = {
    console,
    currentVisitAthenaBinding: binding,
    currentVisitAthenaEpoch: 4,
    currentFormat: 'soap',
    __editor: 'visit A',
    __note: 'note A',
    __guardCalls: 0,
    document: { getElementById: getElement },
    _currentNoteText() { return context.__note; },
    _athenaEditorFingerprint() { return context.__editor; },
    _athenaGuardBoundEditor: () => true,
    _athenaAsyncBindingStillSafe(candidate, action, epoch) {
      context.__guardCalls += 1;
      return candidate === context.currentVisitAthenaBinding && Number(epoch) === Number(context.currentVisitAthenaEpoch);
    },
    aiCallRaw() {
      const next = aiQueue.shift();
      assert(next, 'unexpected revenue/decision-support AI call');
      return next.promise;
    },
    toast() {}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(sources.aiToOut, context, { filename: 'aiToOut.js' });
  return { context, elements };
}

function artifactHarness(name) {
  const ai = deferred();
  const elements = {};
  const getElement = (id) => (elements[id] || (elements[id] = element(id)));
  getElement('transcript').value = 'transcript A';
  const binding = { id: 'binding-A', patient: { patientId: 'A', name: 'Patient A' } };
  const context = {
    console,
    // The public app holds IME generation closed before any async work. Enable
    // the isolated harness lane so this test can continue proving the dormant
    // implementation discards stale exact-patient results if it is released.
    __MLS_LEGAL_WORKSPACE_RELEASED: name === 'generateIME',
    currentSoap: 'note A',
    currentInsurance: '',
    currentCoding: { em: '99213', icd: ['M54.50'], cpt: ['97110'] },
    currentOrders: [],
    currentRecs: 'OLD_RECS',
    currentRedFlags: 'OLD_RED_FLAGS',
    currentDdx: 'OLD_DDX',
    currentHandout: 'OLD_HANDOUT',
    currentIME: 'OLD_IME',
    currentVisitAthenaBinding: binding,
    currentVisitAthenaEpoch: 11,
    lastEMR: { cc: 'Back pain A' },
    EXAMPLE: 'offline example',
    __note: 'note A',
    __pctx: 'patient context A',
    __prefs: 'preferences A',
    __dx: { text: 'lumbar pain', icd: ['M54.50'] },
    __artifactMutations: 0,
    __guardCalls: 0,
    document: { getElementById: getElement },
    currentNoteText() { return context.__note; },
    buildPatientContext() { return context.__pctx; },
    docPrefsBlock() { return context.__prefs; },
    noteDiagnosisText() { return context.__dx; },
    hasAI: () => true,
    backendMode: () => true,
    getKey: () => 'key',
    aiCallRaw: () => ai.promise,
    postChatRaw: () => ai.promise,
    _athenaGuardBoundEditor: () => true,
    _athenaBindingForCurrentVisit: () => binding,
    _athenaEditorFingerprint() {
      return JSON.stringify([context.__note, getElement('transcript').value, context.currentSoap, context.currentInsurance, context.currentCoding, context.currentOrders]);
    },
    _athenaAsyncBindingStillSafe(candidate, action, epoch) {
      context.__guardCalls += 1;
      return !!candidate && candidate.id === context.currentVisitAthenaBinding.id && Number(epoch) === Number(context.currentVisitAthenaEpoch);
    },
    normalizeRecs: (value) => value,
    renderRecommendations() { context.__artifactMutations += 1; },
    renderRedFlags() { context.__artifactMutations += 1; },
    showExtra() { context.__artifactMutations += 1; },
    expandCardSliver() { context.__artifactMutations += 1; },
    showView() {},
    openSettings() {},
    offlineExampleRecommendations: () => ({}),
    offlineHandout: () => '',
    offlineIME: () => '',
    toast() {},
    friendlyError: (error) => String(error && error.message || error)
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(sources[name], context, { filename: `${name}.js` });
  return { context, ai, elements };
}

const artifactFields = {
  generateRecommendations: 'currentRecs',
  runRedFlagScan: 'currentRedFlags',
  generateDifferentials: 'currentDdx',
  generateHandout: 'currentHandout',
  generateIME: 'currentIME'
};

async function assertSourceChangeDiscarded(name, mutate, raw) {
  const h = artifactHarness(name);
  const field = artifactFields[name];
  const before = h.context[field];
  const pending = h.context[name]();
  mutate(h.context, h.elements);
  h.ai.resolve(raw);
  await pending;
  assert.strictEqual(h.context[field], before, `${name} accepted a result after its request source changed`);
  assert.strictEqual(h.context.__artifactMutations, 0, `${name} rendered a stale artifact`);
  assert(h.context.__guardCalls > 0, `${name} did not execute its binding/epoch guard`);
}

async function assertEpochChangeDiscarded(name, raw) {
  const h = artifactHarness(name);
  const field = artifactFields[name];
  const before = h.context[field];
  const pending = h.context[name]();
  h.context.currentVisitAthenaEpoch += 1;
  h.ai.resolve(raw);
  await pending;
  assert.strictEqual(h.context[field], before, `${name} accepted a result after the visit epoch changed`);
  assert.strictEqual(h.context.__artifactMutations, 0, `${name} rendered after the visit epoch changed`);
}

function customWidgetHarness(aiQueue) {
  const elements = {};
  const getElement = (id) => (elements[id] || (elements[id] = element(id)));
  const binding = { id: 'binding-A', patient: { patientId: 'A', name: 'Patient A' } };
  const context = {
    console,
    currentVisitAthenaBinding: binding,
    currentVisitAthenaEpoch: 7,
    __widgets: [{ id: 'w1', title: 'Test widget', prompt: 'Use the visit', format: 'text', auto: true, useHistory: true, created: 1 }],
    __payload: 'visit payload A',
    __prior: 'prior visits A',
    __renders: 0,
    __guardCalls: 0,
    document: { getElementById: getElement },
    currentNoteText: () => 'note A',
    getCustomWidgets() { return context.__widgets.map((widget) => Object.assign({}, widget)); },
    cwBuildUserPayload() { return context.__payload; },
    cwBuildPriorVisits() { return context.__prior; },
    cwLayoutOutputSpec: () => '',
    cwFormatSpec: () => 'plain text',
    hasAI: () => true,
    getKey: () => 'key',
    aiCallRaw: () => {
      const next = aiQueue.shift();
      assert(next, 'unexpected custom-widget AI call');
      return next.promise;
    },
    _athenaGuardBoundEditor: () => true,
    _athenaBindingForCurrentVisit: () => binding,
    _athenaEditorFingerprint: () => JSON.stringify([context.__payload]),
    _athenaAsyncBindingStillSafe(candidate, action, epoch) {
      context.__guardCalls += 1;
      return candidate.id === context.currentVisitAthenaBinding.id && Number(epoch) === Number(context.currentVisitAthenaEpoch);
    },
    _cwLatest: {},
    _cwState: { w1: ['existing state'] },
    cwRenderOutput() { context.__renders += 1; },
    toast() {},
    friendlyError: (error) => String(error && error.message || error)
  };
  getElement('cwBody_w1');
  getElement('cwRefresh_w1');
  context.window = context;
  vm.createContext(context);
  vm.runInContext(sources.runCustomWidget, context, { filename: 'runCustomWidget.js' });
  return { context, elements };
}

async function run() {
  const changedAi = deferred();
  const changed = aiOutputHarness([changedAi]);
  const changedButton = element('changedButton');
  const changedPending = changed.context._aiToOut('system A', 'note A', changedButton, 'revToolsOut');
  changed.context.__editor = 'visit source changed';
  changedAi.resolve('stale patient-A denial analysis');
  assert.strictEqual(await changedPending, false);
  assert.strictEqual(changed.elements.revToolsOut.textContent, '', 'a source-stale revenue result remained visible');
  assert.strictEqual(changed.elements.revToolsOut.style.display, 'none', 'a source-stale revenue result could be re-shown');

  const epochAi = deferred();
  const epoch = aiOutputHarness([epochAi]);
  const epochPending = epoch.context._aiToOut('system A', 'note A', element('epochButton'), 'dsOut');
  epoch.context.currentVisitAthenaEpoch += 1;
  epochAi.resolve('stale patient-A decision support');
  assert.strictEqual(await epochPending, false);
  assert.strictEqual(epoch.elements.dsOut.textContent, '', 'an old-visit decision-support result remained visible');
  assert.strictEqual(epoch.elements.dsOut.style.display, 'none', 'an old-visit decision-support result could be re-shown');
  assert(epoch.context.__guardCalls > 0, 'the revenue/decision-support result did not revalidate its visit epoch');

  const olderAi = deferred();
  const newerAi = deferred();
  const overlappingAi = aiOutputHarness([olderAi, newerAi]);
  const olderPending = overlappingAi.context._aiToOut('older system', 'note A', element('olderButton'), 'revToolsOut');
  const newerPending = overlappingAi.context._aiToOut('newer system', 'note A', element('newerButton'), 'revToolsOut');
  olderAi.resolve('older response');
  assert.strictEqual(await olderPending, false);
  assert.notStrictEqual(overlappingAi.elements.revToolsOut.textContent, 'older response', 'an older overlapping revenue request overwrote the newer request');
  newerAi.resolve('newer response');
  assert.strictEqual(await newerPending, true);
  assert.strictEqual(overlappingAi.elements.revToolsOut.textContent, 'newer response');

  const completedAi = deferred();
  const completed = aiOutputHarness([completedAi]);
  const completedPending = completed.context._aiToOut('system A', 'note A', element('completedButton'), 'revToolsOut');
  completedAi.resolve('completed patient-A output');
  assert.strictEqual(await completedPending, true);
  completed.context._resetAiVisitOutputs();
  assert.strictEqual(completed.elements.revToolsOut.textContent, '', 'new-visit reset retained a prior patient output');
  assert.strictEqual(completed.elements.revToolsOut.style.display, 'none', 'new-visit reset left a prior patient output visible');

  await assertSourceChangeDiscarded('runRedFlagScan', (ctx) => { ctx.__pctx = 'patient context B'; }, 'new red flags');
  await assertSourceChangeDiscarded('generateDifferentials', (ctx) => { ctx.lastEMR = { cc: 'Different complaint' }; }, 'new differential');
  await assertSourceChangeDiscarded('generateHandout', (ctx) => { ctx.__dx = { text: 'cervical pain', icd: ['M54.2'] }; }, 'new handout');
  await assertSourceChangeDiscarded('generateHandout', (ctx, elements) => { elements.handoutBody.value = 'doctor edited this handout while waiting'; }, 'new handout');
  await assertSourceChangeDiscarded('generateIME', (ctx) => { ctx.__prefs = 'preferences B'; }, 'new IME');
  await assertSourceChangeDiscarded('generateRecommendations', (ctx) => { ctx.currentCoding = { em: '99215', icd: ['G89.4'], cpt: [] }; }, '{"care_gaps":["new"],"interactions":[],"follow_up":[],"documentation":[]}');

  await assertEpochChangeDiscarded('runRedFlagScan', 'epoch-stale red flags');
  await assertEpochChangeDiscarded('generateDifferentials', 'epoch-stale differential');
  await assertEpochChangeDiscarded('generateHandout', 'epoch-stale handout');
  await assertEpochChangeDiscarded('generateIME', 'epoch-stale IME');
  await assertEpochChangeDiscarded('generateRecommendations', '{"care_gaps":["epoch stale"],"interactions":[],"follow_up":[],"documentation":[]}');

  const widgetAi = deferred();
  const widget = customWidgetHarness([widgetAi]);
  const widgetPending = widget.context.runCustomWidget('w1', { manual: true });
  widget.context.__prior = 'prior visits changed';
  widgetAi.resolve('stale widget output');
  await widgetPending;
  assert.strictEqual(widget.context._cwLatest.w1, undefined, 'custom widget accepted output after its visit/history source changed');
  assert.deepStrictEqual(Array.from(widget.context._cwState.w1), ['existing state'], 'custom widget erased live state for a stale response');
  assert.strictEqual(widget.context.__renders, 0, 'custom widget rendered a stale response');

  const firstAi = deferred();
  const secondAi = deferred();
  const overlapping = customWidgetHarness([firstAi, secondAi]);
  const firstPending = overlapping.context.runCustomWidget('w1', { manual: true });
  const secondPending = overlapping.context.runCustomWidget('w1', { manual: true });
  firstAi.resolve('older response');
  await firstPending;
  assert.strictEqual(overlapping.context.__renders, 0, 'an older overlapping widget request rendered over the newer request');
  secondAi.resolve('newer response');
  await secondPending;
  assert.strictEqual(overlapping.context._cwLatest.w1, 'newer response');
  assert.strictEqual(overlapping.context.__renders, 1, 'the current widget request did not render exactly once');

  const autoWait = deferred();
  const autoElements = {};
  const autoBinding = { id: 'binding-A', patient: { patientId: 'A' } };
  const autoContext = {
    console,
    currentVisitAthenaBinding: autoBinding,
    currentVisitAthenaEpoch: 3,
    __payload: 'visit A',
    __calls: [],
    __widgets: [
      { id: 'w1', auto: true, useHistory: false },
      { id: 'w2', auto: true, useHistory: false }
    ],
    document: { getElementById: (id) => (autoElements[id] || (autoElements[id] = element(id))) },
    hasAI: () => true,
    getCustomWidgets() { return autoContext.__widgets.map((widget) => Object.assign({}, widget)); },
    cwBuildUserPayload() { return autoContext.__payload; },
    cwBuildPriorVisits: () => '',
    _athenaGuardBoundEditor: () => true,
    _athenaBindingForCurrentVisit: () => autoBinding,
    _athenaEditorFingerprint: () => JSON.stringify([autoContext.__payload]),
    _athenaAsyncBindingStillSafe: (candidate, action, epoch) => candidate.id === autoContext.currentVisitAthenaBinding.id && Number(epoch) === Number(autoContext.currentVisitAthenaEpoch),
    renderCustomWidgets() {},
    runCustomWidget(id) {
      autoContext.__calls.push(id);
      return id === 'w1' ? autoWait.promise : Promise.resolve();
    },
    toast() {}
  };
  autoContext.window = autoContext;
  vm.createContext(autoContext);
  vm.runInContext(sources.autoPopulateCustomWidgets, autoContext, { filename: 'autoPopulateCustomWidgets.js' });
  const autoPending = autoContext.autoPopulateCustomWidgets();
  autoContext.__payload = 'visit B';
  autoWait.resolve();
  await autoPending;
  assert.deepStrictEqual(Array.from(autoContext.__calls), ['w1'], 'the stale auto-widget loop continued into the changed visit');

  console.log('PASS async artifact source guards: stale visit/source results cannot mutate built-in or custom artifacts');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
