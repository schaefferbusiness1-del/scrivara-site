'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const shells = ['1p/index.html', '1pScribeFlow.html'];

function between(source, start, end) {
  const a = source.indexOf(start);
  const b = source.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, `could not extract ${start}`);
  return source.slice(a, b);
}

function tick() { return new Promise(resolve => setImmediate(resolve)); }

function testInlineSyntax(app, label) {
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const errors = [];
  let count = 0, match;
  while ((match = re.exec(app))) {
    if (/\bsrc\s*=/.test(match[1])) continue;
    const type = match[1].match(/\btype\s*=\s*["']([^"']+)["']/i);
    if (type && !/^(?:text|application)\/(?:java|ecma)script$|^module$/i.test(type[1].trim())) continue;
    const code = match[2].replace(/^\s*<!--/, '').replace(/-->\s*$/, '');
    if (!code.trim()) continue;
    count++;
    try { new vm.Script(`(function(){\n${code}\n})`, { filename: `${label}#inline-${count}` }); }
    catch (err) { errors.push(String(err.stack || err)); }
  }
  assert(count > 0, `${label}: no inline scripts compiled`);
  assert.deepStrictEqual(errors, [], `${label}: inline syntax errors:\n${errors.join('\n')}`);
}

function testBudget(app, label) {
  const prefs = between(app, 'function _studioPrefsValue(budget){', 'function syncPrefsToServer(opts){');
  const plan = between(app, 'function _studioCloudPlan(arr,budget){', 'function renderStudioSaved(){');
  const tools = Array.from({ length: 3 }, (_, i) => ({
    id: `w${i}`, title: `Tool ${i}`, html: `<html>${'x'.repeat(3500)}</html>`, ts: 1000 + i
  }));
  function context(items) {
    const raw = JSON.stringify(items);
    const ctx = {
      console, String, Number, Object, Array, JSON, Math, isFinite,
      STUDIO_CLOUD_BUDGET: 250000,
      uns: k => `u::${k}`,
      localStorage: { getItem: k => (k === 'u::studio_widgets' ? raw : null) }
    };
    vm.runInNewContext(`${plan}\n${prefs}`, ctx, { filename: `${label}#budget` });
    return ctx;
  }
  const ctx = context(tools);
  assert.strictEqual(ctx._studioPrefsValue(0), null, `${label}: measured zero became a full budget`);
  assert.strictEqual(ctx._studioPrefsValue(-40000), null, `${label}: negative remaining room shipped creations`);
  assert.strictEqual(ctx._studioPrefsValue(undefined), JSON.stringify(tools), `${label}: missing budget lost its default`);
  assert.strictEqual(context([])._studioPrefsValue(0), '[]', `${label}: a real empty list cannot sync`);
  const partial = JSON.parse(ctx._studioPrefsValue(6000));
  assert(partial.length > 0 && partial.length < tools.length, `${label}: partial budget was not honored`);
}

function testSandbox(app, label) {
  const compose = between(app, 'function _widgetSafeSnapshot(snap){', '/* ===================== PINNED WIDGET TABS');
  const ctx = { console, String, Object, Array, JSON, isFinite, _mlsWidgetBridgeJS: () => 'window.MLS={};' };
  vm.runInNewContext(compose, ctx, { filename: `${label}#sandbox` });
  const source = {
    patients: [{ id: 'p1', name: 'Synthetic Person', dob: '1971-04-02', mrn: 'TEST-MRN', age: 55,
      nested: { date_of_birth: '1971-04-02', medicalRecordNumber: 'TEST-MRN' } }],
    appointments: [{ name: 'Synthetic Person', DOB: '1971-04-02', MRN: 'TEST-MRN' }]
  };
  const safe = ctx._widgetSafeSnapshot(source);
  assert.strictEqual(safe.patients[0].dob, undefined, `${label}: patient DOB reached a widget`);
  assert.strictEqual(safe.patients[0].mrn, undefined, `${label}: patient MRN reached a widget`);
  assert.strictEqual(safe.patients[0].nested.date_of_birth, undefined, `${label}: nested DOB alias survived`);
  assert.strictEqual(safe.appointments[0].MRN, undefined, `${label}: appointment MRN survived`);
  assert.strictEqual(source.patients[0].dob, '1971-04-02', `${label}: safe snapshot mutated shared state`);
  assert.strictEqual(safe.patients[0].age, 55, `${label}: useful widget data was stripped`);

  const doc = ctx._composeWidgetSrcdoc('<main><canvas></canvas></main>', source, 'nonce-1');
  assert(!doc.includes('1971-04-02') && !doc.includes('TEST-MRN'), `${label}: identifiers are in composed srcdoc`);
  assert(doc.includes('Synthetic Person') && doc.includes("connect-src 'none'"), `${label}: safe data/CSP missing`);
  const match = doc.match(/<script>([\s\S]*?)<\/script>/i);
  assert(match, `${label}: injected widget runtime missing`);
  new vm.Script(match[1], { filename: `${label}#generated-widget-runtime` });
  assert(/addEventListener\("error",[\s\S]*?\},true\)/.test(match[1]), `${label}: blocked resources are not captured`);
  assert(/textLength:/.test(match[1]) && /surfaceCount:/.test(match[1]) && /blocked:/.test(match[1]),
    `${label}: ready message has no rendered-content evidence`);

  function node(tag, options = {}) {
    return {
      tagName: tag.toUpperCase(), hidden: !!options.hidden,
      src: options.src || '', href: options.href || '',
      childNodes: options.text == null ? [] : [{ nodeType: 3, nodeValue: options.text }],
      getAttribute(name) { return name === 'aria-hidden' ? (options.ariaHidden ? 'true' : null) : null; },
      getBoundingClientRect() { return { width: options.width == null ? 100 : options.width, height: options.height == null ? 24 : options.height }; },
      _style: options.style || {}
    };
  }
  function executeRenderProof(nodes, blockedTarget) {
    const listeners = {};
    const messages = [];
    const body = node('body', { width: 800, height: 600 });
    body.querySelectorAll = () => nodes;
    let timerDelay = null;
    const runtimeCtx = {
      console, String, Number, Object, Array, JSON, Date,
      document: { body },
      parent: { postMessage(msg) { messages.push(msg); } },
      addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
      getComputedStyle(el) { return Object.assign({ display: 'block', visibility: 'visible', opacity: '1' }, el._style || {}); },
      setTimeout(fn, ms) { timerDelay = ms; fn(); return 1; }
    };
    runtimeCtx.window = runtimeCtx;
    vm.runInNewContext(match[1], runtimeCtx, { filename: `${label}#render-proof-runtime` });
    if (blockedTarget) (listeners.error || []).forEach(fn => fn({ target: blockedTarget }));
    (listeners.DOMContentLoaded || []).forEach(fn => fn({}));
    return { ready: messages.find(m => m.__mlsWidgetReady), delay: timerDelay };
  }

  let proof = executeRenderProof([node('script', { text: 'window.x=1' })]);
  assert.strictEqual(proof.ready.surfaceCount, 0, `${label}: script-only page counted as rendered`);
  assert.strictEqual(proof.ready.textLength, 0, `${label}: script source counted as visible text`);
  assert(proof.delay >= 300 && proof.delay < 1000, `${label}: render check is not a slightly delayed bounded check`);

  proof = executeRenderProof([node('div', { text: 'hidden words', hidden: true }), node('meta')]);
  assert.strictEqual(proof.ready.surfaceCount, 0, `${label}: hidden/meta-only page counted as rendered`);
  proof = executeRenderProof([node('div')]);
  assert.strictEqual(proof.ready.surfaceCount, 0, `${label}: blank div counted as rendered`);
  proof = executeRenderProof([node('canvas', { width: 320, height: 180 })]);
  assert.strictEqual(proof.ready.surfaceCount, 1, `${label}: visible canvas was not accepted`);
  proof = executeRenderProof([node('p', { text: 'Visible result' })]);
  assert.strictEqual(proof.ready.textLength, 14, `${label}: visible text was not accepted`);
  proof = executeRenderProof([node('canvas', { width: 320, height: 180 })], node('script', { src: 'https://cdn.example.test/chart.js' }));
  assert.strictEqual(proof.ready.blocked[0], 'https://cdn.example.test/chart.js', `${label}: blocked resource did not override incidental DOM`);
}

function driveReady(app, label, payload) {
  const handler = between(app, 'function _ensureStudioMsgBound(){', 'function _studioFrameForMessage(ev){');
  const state = { failures: [], statuses: [], saved: [], note: { style: {}, textContent: '' } };
  const frame = { id: 'studioFrame', dataset: { mlsWidgetNonce: 'n1' } };
  let listener;
  const ctx = {
    console, String, Object, Array, JSON, Date, Number, isFinite,
    addEventListener(type, fn) { if (type === 'message') listener = fn; },
    _studioFrameForMessage: () => frame,
    _studioReadyTimer: 1,
    clearTimeout() {},
    _studioPendingQuality: {},
    studioStatus(msg) { state.statuses.push(String(msg)); },
    studioFail(msg) { state.failures.push(String(msg)); },
    studioGetSaved: () => state.saved,
    studioSetSaved(arr) { state.saved = arr; },
    renderStudioSaved() {}, _studioHandleAction() {}, _studioHandleRpc() {},
    document: { getElementById: id => (id === 'studioErrNote' ? state.note : null) }
  };
  ctx.window = ctx;
  ctx.__mlsStudioPendingSave = { html: '<html>synthetic tool</html>', title: 'Tool' };
  vm.runInNewContext(handler, ctx, { filename: `${label}#ready-handler` });
  ctx._ensureStudioMsgBound();
  assert(listener, `${label}: ready listener did not bind`);
  listener({ data: Object.assign({ __mlsWidgetReady: true }, payload) });
  return { state, pending: ctx.__mlsStudioPendingSave };
}

function testReady(app, label) {
  let result = driveReady(app, label, {});
  assert.strictEqual(result.state.saved.length, 0, `${label}: proof-free ready auto-saved`);
  assert(result.state.failures.some(m => /did not prove/i.test(m)), `${label}: missing render proof was not refused`);

  result = driveReady(app, label, { textLength: 0, surfaceCount: 0, blocked: [] });
  assert.strictEqual(result.state.saved.length, 0, `${label}: empty widget auto-saved`);
  assert(result.state.failures.some(m => /rendered nothing/i.test(m)), `${label}: empty render was not named`);

  result = driveReady(app, label, { textLength: 0, surfaceCount: 1, blocked: ['https://cdn.example.test/chart.js'] });
  assert.strictEqual(result.state.saved.length, 0, `${label}: external-resource widget auto-saved`);
  assert(result.state.failures.some(m => /cdn\.example\.test/.test(m)), `${label}: blocked host was not disclosed`);

  result = driveReady(app, label, { textLength: 40, surfaceCount: 3, blocked: [] });
  assert.strictEqual(result.state.failures.length, 0, `${label}: healthy widget was refused`);
  assert.strictEqual(result.state.saved.length, 1, `${label}: healthy widget did not auto-save after proof`);
  assert(result.state.statuses.some(m => /running below/.test(m)), `${label}: healthy widget did not confirm`);

  result = driveReady(app, label, { textLength: 0, surfaceCount: 1, blocked: [] });
  assert.strictEqual(result.state.failures.length, 0, `${label}: canvas-only tool was wrongly refused`);
}

async function testUnload(app, label) {
  const closeBlock = between(app, 'function _studioUnloadFrame(id){', '/* ============================================================================');
  function harness(saved, confirm) {
    const frame = {
      srcdoc: '<html>serialized practice snapshot</html>', src: '', dataset: { mlsWidgetNonce: 'secret' },
      removeAttribute(name) { if (name === 'srcdoc') this.srcdoc = ''; if (name === 'data-mls-widget-nonce') delete this.dataset.mlsWidgetNonce; }
    };
    const card = { style: { display: 'block' } };
    const ctx = {
      console, document: { getElementById: id => (id === 'studioFrame' ? frame : id === 'studioResultCard' ? card : null) },
      studioLastHtml: '<html>tool</html>', _studioIsSaved: () => saved,
      mlsConfirm: () => Promise.resolve(confirm), studioStatus() {},
      _studioReadyTimer: 1, clearTimeout() {}, __mlsStudioPendingSave: { html: 'x' }
    };
    ctx.window = ctx;
    vm.runInNewContext(closeBlock, ctx, { filename: `${label}#close-result` });
    return { ctx, frame, card };
  }
  let h = harness(true, true);
  h.ctx.closeStudioResult();
  assert.strictEqual(h.frame.srcdoc, '', `${label}: close kept PHI srcdoc`);
  assert.strictEqual(h.frame.src, 'about:blank', `${label}: close did not navigate blank`);
  assert.strictEqual(h.frame.dataset.mlsWidgetNonce, undefined, `${label}: close kept nonce alive`);
  assert.strictEqual(h.card.style.display, 'none', `${label}: close did not hide result`);

  h = harness(false, true);
  h.ctx.closeStudioResult();
  await tick();
  assert.strictEqual(h.frame.srcdoc, '', `${label}: confirmed discard kept srcdoc`);
  assert.strictEqual(h.frame.dataset.mlsWidgetNonce, undefined, `${label}: confirmed discard kept nonce`);

  const unload = between(app, 'function _studioUnloadFrame(id){', 'function closeStudioResult(){');
  const closeFs = between(app, 'function closeStudioFullscreen(){', '/* Jump straight to the Copilot');
  const fsFrame = {
    srcdoc: '<html>snapshot</html>', src: '', dataset: { mlsWidgetNonce: 'fs-secret' },
    removeAttribute(name) { if (name === 'srcdoc') this.srcdoc = ''; if (name === 'data-mls-widget-nonce') delete this.dataset.mlsWidgetNonce; }
  };
  const overlay = { style: { display: 'flex' } };
  const fsCtx = { console, document: { getElementById: id => (id === 'studioFsFrame' ? fsFrame : id === 'studioFsOverlay' ? overlay : null) } };
  vm.runInNewContext(`${unload}\n${closeFs}`, fsCtx, { filename: `${label}#close-fullscreen` });
  fsCtx.closeStudioFullscreen();
  assert.strictEqual(overlay.style.display, 'none', `${label}: fullscreen did not close`);
  assert.strictEqual(fsFrame.srcdoc, '', `${label}: fullscreen close kept srcdoc`);
  assert.strictEqual(fsFrame.dataset.mlsWidgetNonce, undefined, `${label}: fullscreen close kept nonce`);
  assert(/previousView==='studio'[\s\S]{0,500}_studioUnloadFrame\('studioFrame'\)/.test(app), `${label}: navigating away hides but does not unload Studio`);

  let boundary = null;
  const boundaryFrames = {};
  ['studioFrame', 'studioFsFrame', 'pinnedFrame'].forEach(id => {
    boundaryFrames[id] = {
      srcdoc: `<html>${id} snapshot</html>`, src: '', dataset: { mlsWidgetNonce: `${id}-nonce` },
      removeAttribute(name) { if (name === 'srcdoc') this.srcdoc = ''; if (name === 'data-mls-widget-nonce') delete this.dataset.mlsWidgetNonce; }
    };
  });
  const fsOverlay = { style: { display: 'flex' } }, resultCard = { style: { display: 'block' } };
  const boundaryCtx = {
    console, document: { getElementById: id => boundaryFrames[id] || (id === 'studioFsOverlay' ? fsOverlay : id === 'studioResultCard' ? resultCard : null) },
    addEventListener(type, fn) { if (type === 'mls:session-boundary') boundary = fn; },
    __mlsStudioFrameBoundaryBound: false, __mlsStudioPendingSave: { html: 'tool' },
    studioLastHtml: '<html>tool</html>', studioLastPrompt: 'Synthetic prompt', _pinnedCur: { id: 'w1' },
    _studioReadyTimer: 1, clearTimeout() {}
  };
  boundaryCtx.window = boundaryCtx;
  vm.runInNewContext(`${unload}\n${closeFs}`, boundaryCtx, { filename: `${label}#frame-session-boundary` });
  assert(boundary, `${label}: Studio frames have no session-boundary scrub`);
  boundary({ type: 'mls:session-boundary' });
  Object.entries(boundaryFrames).forEach(([id, frame]) => {
    assert.strictEqual(frame.srcdoc, '', `${label}: ${id} kept srcdoc across session boundary`);
    assert.strictEqual(frame.dataset.mlsWidgetNonce, undefined, `${label}: ${id} kept nonce across session boundary`);
  });
  assert.strictEqual(fsOverlay.style.display, 'none', `${label}: fullscreen stayed visible across session boundary`);
  assert.strictEqual(resultCard.style.display, 'none', `${label}: result stayed visible across session boundary`);
  assert.strictEqual(boundaryCtx.studioLastHtml, '', `${label}: generated HTML stayed in memory across session boundary`);
}

function testSnapshot(app, label) {
  const fn = between(app, 'function _copilotClinicalText(', 'var COPILOT_STARTERS = [');
  const fullPatientCount = 1518;
  /* The real Studio snapshot intentionally carries at most 800 detailed rows
     while patientCount preserves the full roster denominator. */
  const patients = Array.from({ length: 800 }, (_, i) => ({
    id: `p-${i}`, name: `Patient Number ${i}`, age: 30 + (i % 50), sex: i % 2 ? 'F' : 'M',
    problems: ['Lumbar radiculopathy', 'Facet arthropathy', 'Chronic pain'], summary: 'S'.repeat(900),
    meds: ['synthetic med'], allergies: ['synthetic allergy'], visitCount: 2 + (i % 8), firstVisit: '2023-01-01',
    lastVisit: '2025-01-01', lastPain: i % 11, avgPain: 5, maxPain: 9,
    painSeries: [{ pain: 3 }, { pain: i % 11 }]
  }));
  const appointments = Array.from({ length: 40 }, (_, i) => ({
    name: `Patient Number ${799 - i}`, date: '2026-08-13', time: '09:00', status: 'booked', reason: 'Follow-up', provider: 'Test Provider'
  }));
  const ctx = {
    console, Date, Math, JSON, String, Number, Array, Object, isNaN,
    _acctTodayKey: () => '2026-08-13',
    activePatient: () => ({ id: 'p-700', name: 'Patient Number 700' }),
    studioDataSnapshot: () => ({ patients, appointments, practice: { name: 'Synthetic Practice' }, patientCount: fullPatientCount,
      totalVisits: 4000, avgPainAcrossPractice: 5.4, visitsByMonth: { '2026-07': 210 }, topProblems: [] }),
    document: { getElementById: id => (id === 'transcript' ? { value: `current visit ${'t'.repeat(5000)}` } : null) },
    currentSoap: `current note ${'n'.repeat(6000)}`, currentCoding: { icd10: ['M54.16'], cpt: ['99214'], em: '99214' }, capturing: false
  };
  ctx.window = ctx;
  vm.runInNewContext(`${fn}\nthis.__snapshot=copilotSnapshot();`, ctx, { filename: `${label}#copilot-snapshot` });
  const snap = ctx.__snapshot;
  const wire = JSON.stringify(snap);
  assert(wire.length < 60000, `${label}: ${wire.length}-char context will be sliced by the server`);
  const seen = JSON.parse(wire.slice(0, 60000));
  assert.strictEqual(seen.activePatient.id, 'p-700', `${label}: current chart did not survive`);
  assert.strictEqual(seen.activeVisit.patient.id, 'p-700', `${label}: current visit did not survive`);
  assert(seen.activeVisit.transcriptWords > 0 && seen.activeVisit.noteWords > 0, `${label}: visit content was not retained`);
  const keys = Object.keys(seen);
  assert(keys.indexOf('activePatient') < keys.indexOf('patients'), `${label}: active chart serializes after panel rows`);
  assert(keys.indexOf('activeVisit') < keys.indexOf('patients'), `${label}: active visit serializes after panel rows`);
  assert.strictEqual(seen.patients[0].id, 'p-700', `${label}: current chart is not the first detail row`);
  assert.strictEqual(seen.coverage.patientsTotal, fullPatientCount, `${label}: coverage denominator is wrong`);
  assert.strictEqual(seen.coverage.patientsAvailable, patients.length, `${label}: available-detail denominator is wrong`);
  assert.strictEqual(seen.coverage.patientsTruncated, true, `${label}: truncated panel was called complete`);
  assert.strictEqual(seen.panel.computedFromPatients, patients.length, `${label}: panel computation denominator is wrong`);
  assert.strictEqual(seen.panel.coverageComplete, false, `${label}: 800 detailed charts were called a complete 1518-chart panel`);
  assert(seen.patients.some(p => p.detail === 'compact'), `${label}: context budget gained no compact breadth`);
}

function actionHarness(app, label, opts = {}) {
  const source = between(app, 'function _copilotResolvePatientSafe(arg){', '/* ===== Builder: refine the last widget');
  const patients = opts.patients || [
    { id: 'p1', name: 'John Smith', dob: '1970-03-02' },
    { id: 'p2', name: 'Mary Smith', dob: '1984-11-19' },
    { id: 'p3', name: 'Alice Nguyen', dob: '1962-01-07' }
  ];
  let active = opts.active || '';
  const calls = { selected: [], visits: 0, toasts: [] };
  const ctx = {
    console, String, Number, Array, Object, JSON, Math,
    getPatients: () => patients,
    getActivePtId: () => active,
    selectPatient(id) { calls.selected.push(String(id)); if (!opts.refuseSelection) active = String(id); },
    goNewVisitForPatient() { calls.visits++; }, showView() {},
    toast(msg, kind) { calls.toasts.push({ msg: String(msg), kind: kind || '' }); },
    _copilotHistory: [], _copilotRenderThread() {}, _copilotResolveView: () => '', _copilotNavigate: () => false,
    generateStudioWidget() {}, document: { getElementById: () => null }
  };
  ctx.window = ctx;
  vm.runInNewContext(source, ctx, { filename: `${label}#copilot-actions` });
  return { ctx, calls, active: () => active };
}

function testActions(app, label) {
  let h = actionHarness(app, label);
  h.ctx._copilotDoAction('startVisit', 'Smith');
  assert.deepStrictEqual(h.calls.selected, [], `${label}: ambiguous substring selected a chart`);
  assert.strictEqual(h.calls.visits, 0, `${label}: ambiguous substring started a visit`);
  assert.strictEqual(h.ctx._copilotHistory.length, 1, `${label}: ambiguity did not ask the clinician`);
  assert.strictEqual(h.ctx._copilotHistory[0].actions.length, 2, `${label}: ambiguity omitted candidates`);
  assert(Array.from(h.ctx._copilotHistory[0].actions).every(a => a.kind === 'startVisit' && /^p[12]$/.test(a.arg)), `${label}: disambiguation did not carry exact IDs`);
  assert(Array.from(h.ctx._copilotHistory[0].actions).every(a => /^Choose match \d+$/.test(a.label)), `${label}: disambiguation exposed patient identifiers in labels`);

  h = actionHarness(app, label, { patients: [
    { id: 'p1', name: 'John Smith', dob: '1970-03-02' },
    { id: 'p3', name: 'Alice Nguyen', dob: '1962-01-07' }
  ] });
  h.ctx._copilotDoAction('openPatient', 'mit');
  assert.deepStrictEqual(h.calls.selected, [], `${label}: sole fuzzy surname fragment opened a chart`);
  h.ctx._copilotDoAction('startVisit', 'John');
  assert.deepStrictEqual(h.calls.selected, [], `${label}: sole first-name fragment opened a chart`);
  assert.strictEqual(h.calls.visits, 0, `${label}: fuzzy fragment started a visit`);

  h = actionHarness(app, label);
  h.ctx._copilotDoAction('openPatient', '  ALICE   NGUYEN  ');
  assert.deepStrictEqual(h.calls.selected, ['p3'], `${label}: exact normalized full name did not open`);

  h = actionHarness(app, label);
  h.ctx._copilotDoAction('openPatient', 'p2');
  assert.deepStrictEqual(h.calls.selected, ['p2'], `${label}: exact primary ID did not open`);

  h = actionHarness(app, label, { patients: [
    { id: 'd1', name: 'Sam Taylor' }, { id: 'd2', name: 'Sam Taylor' }
  ] });
  h.ctx._copilotDoAction('startVisit', 'Sam Taylor');
  assert.deepStrictEqual(h.calls.selected, [], `${label}: duplicate exact names selected a chart`);
  assert.strictEqual(h.calls.visits, 0, `${label}: duplicate exact names started a visit`);
  assert.strictEqual(h.ctx._copilotHistory[0].actions.length, 2, `${label}: duplicate exact names did not ask for exact-id choice`);

  h = actionHarness(app, label, { active: 'p3', refuseSelection: true });
  h.ctx._copilotDoAction('startVisit', 'John Smith');
  assert.deepStrictEqual(h.calls.selected, ['p1'], `${label}: exact selection was not attempted`);
  assert.strictEqual(h.calls.visits, 0, `${label}: visit started after chart pointer failed to move`);
  assert(!h.calls.toasts.some(t => t.kind === 'ok'), `${label}: failed chart move claimed success`);
}

async function testAi(app, label) {
  const helper = between(app, 'function _mlsAiFault(r,d,noun){', 'async function copilotAsk(){');
  let handled = 0;
  const helperCtx = { console, String, handle401() { handled++; } };
  vm.runInNewContext(helper, helperCtx, { filename: `${label}#ai-fault` });
  assert(/session expired/i.test(helperCtx._mlsAiFault({ status: 401, ok: false }, {}, 'Copilot')), `${label}: 401 is not truthful`);
  assert.strictEqual(handled, 1, `${label}: 401 did not expire the local session`);
  assert.strictEqual(helperCtx._mlsAiFault({ status: 402, ok: false }, { error: 'Synthetic plan restriction.' }, 'Copilot'), 'Synthetic plan restriction.', `${label}: server rejection was hidden`);
  assert(/wait a few seconds/i.test(helperCtx._mlsAiFault({ status: 429, ok: false }, {}, 'Copilot')), `${label}: 429 is not transient`);
  assert(/temporarily unavailable/i.test(helperCtx._mlsAiFault({ status: 503, ok: false }, {}, 'Copilot')), `${label}: 503 is not transient`);

  const ask = between(app, 'async function copilotAsk(){', '/* b398:');
  async function askWith(response) {
    const input = { value: 'What is happening?', style: {} };
    const send = { disabled: false };
    const ctx = {
      console, String, Object, Array, JSON,
      _copilotBusy: false, _copilotHistory: [],
      document: { getElementById: id => (id === 'copilotInput' ? input : id === 'copilotSendBtn' ? send : id === 'copilotChips' ? { innerHTML: '' } : null) },
      backendMode: () => true, bkToken: () => 'synthetic', bkBase: () => 'https://example.test',
      fetch: async () => ({ status: response.status, ok: response.ok, json: async () => response.body }),
      copilotSnapshot: () => ({ activeVisit: { patient: { id: 'p1' } } }),
      _copilotRenderThread() {}, _copilotRenderChips() {}, _copilotSaveHist() {},
      _copilotNormalizeActions: (q, actions) => actions, handle401() {}
    };
    ctx.window = ctx;
    vm.runInNewContext(`${helper}\n${ask}`, ctx, { filename: `${label}#copilot-ask` });
    await ctx.copilotAsk();
    return ctx._copilotHistory.filter(m => m.role === 'ai').pop();
  }
  let answer = await askWith({ status: 200, ok: true, body: { reply: '' } });
  assert(/No answer came back/i.test(answer.text), `${label}: empty AI response claimed completion`);
  assert(!/^Done\.?$/i.test(answer.text), `${label}: empty AI response said Done`);
  answer = await askWith({ status: 402, ok: false, body: { error: 'Synthetic subscription is inactive.' } });
  assert.strictEqual(answer.text, 'Synthetic subscription is inactive.', `${label}: Copilot hid a rejection reason`);

  const lines = app.split('\n');
  const sites = [];
  lines.forEach((line, i) => { if (/fetch\(bkBase\(\)\+'\/api\/(copilot|widget|assist)/.test(line)) sites.push(i); });
  assert(sites.length >= 7, `${label}: expected seven AI call sites`);
  const unguarded = sites.filter(i => !/_mlsAiFault\(/.test(lines.slice(i, i + 18).join('\n')));
  assert.deepStrictEqual(unguarded, [], `${label}: an AI call site still collapses rejection into generic retry`);
}

function testBuildReveal(app, label) {
  const source = between(app, 'function _studioShowBuildSection(){', 'function _studioUnloadFrame(id){');
  const selected = [], views = [];
  const card = {
    style: {}, focused: false, setAttribute() {}, focus() { this.focused = true; }, scrollIntoView() {}
  };
  const frame = { dataset: {}, srcdoc: '' };
  const elements = { studioErrNote: { style: {}, textContent: '' }, studioResultTitle: { textContent: '' }, studioResultCard: card, studioFrame: frame };
  const ctx = {
    console, String,
    __mlsCurrentView: 'patients', showView(v) { views.push(v); ctx.__mlsCurrentView = v; },
    __mlsStudioMerge: { select(k) { selected.push(k); } },
    studioDataSnapshot: () => ({ patients: [] }), _ensureStudioMsgBound() {},
    document: { getElementById: id => elements[id] || null },
    _studioNonce: () => 'n1', _composeWidgetSrcdoc: () => '<html>tool</html>',
    studioStatus() {}, _studioReadyTimer: null, _studioPendingQuality: null,
    setTimeout: () => 1, clearTimeout() {}, studioLastHtml: '', studioLastPrompt: ''
  };
  ctx.window = ctx;
  vm.runInNewContext(source, ctx, { filename: `${label}#build-reveal` });
  ctx.renderStudioWidget('<html>tool</html>', 'Tool', {});
  assert.deepStrictEqual(views, ['studio'], `${label}: generated output did not reveal the outer Studio view`);
  assert.deepStrictEqual(selected, ['build'], `${label}: generated output did not select Build`);
  assert.strictEqual(card.style.display, 'block', `${label}: generated result stayed hidden`);
  assert.strictEqual(card.focused, true, `${label}: generated result did not receive focus`);
  const generate = between(app, 'async function generateStudioWidget(){', 'function _studioShowBuildSection(){');
  assert(/_studioShowBuildSection\(\)/.test(generate), `${label}: builder does not reveal Build before the request`);
}

async function main() {
  for (const relative of shells) {
    const label = relative;
    const app = fs.readFileSync(path.join(root, relative), 'utf8');
    testInlineSyntax(app, label);
    testBudget(app, label);
    testSandbox(app, label);
    testReady(app, label);
    await testUnload(app, label);
    testSnapshot(app, label);
    testActions(app, label);
    await testAi(app, label);
    testBuildReveal(app, label);
  }
  console.log('PASS P1 Copilot/Studio safety in both preview shells: budget, PHI unload, rendered-ready, context priority, exact identity, truthful AI faults, visible builds');
}

main().catch(err => { console.error(err && err.stack || err); process.exit(1); });
