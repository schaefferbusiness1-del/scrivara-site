'use strict';

/* A stale/missing canonical Athena sidecar is repaired only by a deliberate
   local Generate/Regenerate press. The schedule bind cure stays identity-only;
   successful generation re-enters the ordinary review builder, which stages
   five exact destinations and still performs only a read-only probe. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, '1p-feat_mls_writeflow.js'), 'utf8');
const shellPaths = ['1pScribeFlow.html', path.join('1p', 'index.html'), 'ScribeFlow.html', path.join('cloned', 'index.html')];
const shellSources = Object.fromEntries(shellPaths.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
const site = shellSources['1pScribeFlow.html'];

/* Source boundaries: bind/re-pull may never generate clinical content, while
   the explicit generation control must call the existing page-owned gate. */
const bindBlock = source.slice(source.indexOf('/* ===== wfbind-1.0.0'), source.indexOf('/* ===== end wfbind-1.0.0'));
assert(bindBlock.length > 500, 'bind-cure block is missing');
assert(!/generateNote|runUnifiedCanonicalGeneration/.test(bindBlock), 'bind/re-pull silently started clinical generation');
assert(/return generate\(\)/.test(source), 'inline action no longer calls the normal generateNote gate');
assert(/var rebuilt = reopen\(null\)/.test(source), 'successful generation no longer re-enters the ordinary Athena review entrypoint');
assert(/generationIssue:\s*unifiedCanonicalGenerationIssue\(opts\)/.test(source), 'a bind/re-pull rebuild drops the canonical generation issue');
for (const file of shellPaths) {
  const shell = shellSources[file];
  assert(/function _athenaOpenCanonicalGenerationReview\(binding,reason\)/.test(shell), `${file} is missing the inline canonical generation integration`);
  assert(/generationIssue:String\(reason\|\|'athena-note-missing-canonical-note'\)/.test(shell), `${file} does not carry the canonical failure into the review`);
  assert(/_athenaOpenCanonicalGenerationReview\(binding,built\.blockReason\)/.test(shell), `${file} still early-returns instead of opening the deliberate generation review`);
  assert(!/The canonical Athena note is missing, malformed, or stale\. Nothing was opened or written; regenerate the note and review again\./.test(shell), `${file} still contains the dead-end early-return toast`);
}

/* Page integration: a blocked canonical build opens a zero-row generation
   review with the exact frozen identity; a valid build follows the normal plan
   route. No browser or Athena account is touched. */
{
  const start = site.indexOf('function _athenaOpenCanonicalGenerationReview(');
  const end = site.indexOf('/* Legacy natural-language autopilot', start);
  assert(start > 0 && end > start, 'site canonical-generation integration block is missing');
  const opened = [];
  const pushed = [];
  const binding = {
    patient: { patientId: 'pt-inline-1', name: 'Synthetic Inline Patient', dob: '01/02/1980', mrn: '123' },
    historical: false, noteTimestamp: 111,
    visitContext: { visitDate: '08/23/2026', provider: 'Synthetic Doctor, MD', appointmentId: '70001', encounterId: '', encounterUrl: '' }
  };
  let build = { plan: [], lines: [], who: binding.patient.name, noteText: 'Existing generated display note.', blocked: true, blockReason: 'athena-note-stale-canonical-provenance' };
  const pageWindow = { __mlsWriteFlow: { openUnifiedConfirmation(opts) { opened.push(opts); return {}; } } };
  const pageCtx = vm.createContext({
    window: pageWindow,
    emrReadyText: () => 'Existing generated display note.',
    _athenaBoundVisitForAction: () => binding,
    _athenaBuildPlan: () => build,
    _athenaPushPlan: (...args) => pushed.push(args),
    toast() {}, String
  });
  vm.runInContext(site.slice(start, end), pageCtx, { filename: 'canonical-generation-site-block.js' });
  assert.strictEqual(pageCtx.pushEntireVisitToAthena(null), false, 'blocked canonical build did not fail closed');
  assert.strictEqual(opened.length, 1, 'blocked canonical build did not open one explicit generation review');
  assert.strictEqual(pushed.length, 0, 'blocked canonical build reached the Athena plan route');
  assert.strictEqual(opened[0].generationIssue, build.blockReason, 'generation review lost the exact canonical failure reason');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(opened[0].expectedContext)), binding.visitContext, 'generation review changed the exact appointment context');
  assert.strictEqual(opened[0].patient.patientId, binding.patient.patientId, 'generation review changed the immutable patient id');

  build = { plan: [{ kind: 'hpi', body: 'Synthetic HPI.' }], lines: [], who: binding.patient.name, noteText: 'Validated canonical display note.' };
  assert.strictEqual(pageCtx.pushEntireVisitToAthena(null), true, 'valid canonical build did not enter the normal review route');
  assert.strictEqual(pushed.length, 1, 'valid canonical build did not use the normal Athena plan builder');
  assert.strictEqual(pushed[0][3].appointmentId, binding.visitContext.appointmentId, 'normal plan route changed the exact appointment id');
}

const sent = [];
const byId = Object.create(null);
const listeners = Object.create(null);

class El {
  constructor(tag = 'div') {
    this.tagName = tag.toUpperCase(); this.style = {}; this.attrs = {}; this.listeners = {};
    this.children = []; this.parentNode = null; this.nodeType = 1; this.disabled = false;
    this.checked = false; this.textContent = ''; this.value = ''; this._id = ''; this._html = '';
  }
  set id(value) { this._id = String(value || ''); if (this._id) byId[this._id] = this; }
  get id() { return this._id; }
  set innerHTML(value) {
    this._html = String(value || ''); this.children.slice().forEach(child => child.remove()); this.children = [];
    const tags = this._html.match(/<(?:button|div|input|span)\b[^>]*>/gi) || [];
    for (const tag of tags) {
      const id = /\bid="([^"]+)"/i.exec(tag), name = /\bname="([^"]+)"/i.exec(tag);
      if (!id && (!name || name[1] !== 'mlsAthenaUnifiedAction')) continue;
      const el = new El(/^<([a-z]+)/i.exec(tag)[1]);
      if (id) el.id = id[1];
      const valueMatch = /\bvalue="([^"]*)"/i.exec(tag); if (valueMatch) el.value = valueMatch[1];
      if (name) el.setAttribute('name', name[1]);
      if (/\bdisabled\b/i.test(tag)) el.disabled = true;
      if (/\bchecked\b/i.test(tag)) el.checked = true;
      this.appendChild(el);
    }
  }
  get innerHTML() { return this._html; }
  appendChild(el) { this.children.push(el); el.parentNode = this; return el; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] || ''; }
  removeAttribute(key) { delete this.attrs[key]; }
  addEventListener(type, fn) { (this.listeners[type] || (this.listeners[type] = [])).push(fn); }
  click() { for (const fn of this.listeners.click || []) fn({ target: this }); }
  focus() {}
  closest() { return null; }
  contains() { return false; }
  querySelector(selector) { if (selector[0] === '#') return byId[selector.slice(1)] || null; return this.querySelectorAll(selector)[0] || null; }
  querySelectorAll(selector) {
    const all = []; const walk = node => { for (const child of node.children) { all.push(child); walk(child); } }; walk(this);
    if (/input\[name="mlsAthenaUnifiedAction"\]/.test(selector)) return all.filter(el => el.tagName === 'INPUT' && el.getAttribute('name') === 'mlsAthenaUnifiedAction');
    return [];
  }
  remove() {
    const drop = node => { node.children.forEach(drop); if (node.id && byId[node.id] === node) delete byId[node.id]; };
    drop(this); if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this);
  }
}

const document = {
  readyState: 'loading', activeElement: null, body: new El('body'),
  addEventListener() {}, removeEventListener() {}, createElement: tag => new El(tag),
  getElementById: id => byId[id] || null,
  querySelectorAll(selector) { return this.body.querySelectorAll(selector); }
};
const exactVisit = { visitDate: '08/23/2026', provider: 'Synthetic Doctor, MD', appointmentId: '70001' };
const patient = { patientId: 'pt-inline-1', name: 'Synthetic Inline Patient', dob: '01/02/1980', mrn: '123' };
const exactContext = {
  patientName: patient.name, dob: '1/2/1980', mrn: patient.mrn, appointmentId: exactVisit.appointmentId,
  encounterId: 'enc-inline-1', encounterUrl: 'https://athenanet.athenahealth.com/encounter/enc-inline-1',
  visitDate: '8/23/2026', provider: exactVisit.provider, controlLabel: 'HPI editor'
};
const store = Object.create(null);
const window = {
  document, location: { origin: 'https://mlsscribe.com' },
  __mlsExtensionCapabilities: { athenaFinalActionsV1: true, supervisedOrderPlacementV2: true },
  sessionStorage: { getItem: key => Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null, setItem: (key, value) => { store[key] = String(value); }, removeItem: key => { delete store[key]; } },
  toast() {}, addEventListener(type, fn) { (listeners[type] || (listeners[type] = [])).push(fn); },
  removeEventListener(type, fn) { listeners[type] = (listeners[type] || []).filter(item => item !== fn); },
  postMessage(message) {
    sent.push(structuredClone(message));
    if (message.type !== 'mlsAppAthenaActionV2' || message.mode !== 'probe') return;
    const resp = { ok: true, actionToken: 'inline-probe-token', context: exactContext };
    setTimeout(() => { for (const fn of [...(listeners.message || [])]) fn({ data: { source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: message.requestId, resp } }); }, 0);
  }
};
window.window = window;
function MutationObserver() { this.observe = () => {}; this.disconnect = () => {}; }
const safeTimer = (fn, ms) => { const timer = setTimeout(fn, ms); if (ms > 1000 && timer.unref) timer.unref(); return timer; };
const ctx = { window, document, MutationObserver, console, structuredClone, setTimeout: safeTimer, clearTimeout, setInterval, clearInterval, Date, Math, Promise, Object, Array, String, Number, RegExp, JSON, Uint32Array };
vm.createContext(ctx);
vm.runInContext(source, ctx, { filename: '1p-feat_mls_writeflow.js' });

const five = [
  { key: 'hpi', text: 'Synthetic HPI.' }, { key: 'ros', text: 'Synthetic ROS.' },
  { key: 'exam', text: 'Synthetic exam.' }, { key: 'assessment', text: 'Synthetic assessment.' },
  { key: 'plan', text: 'Synthetic plan.' }
];
let generated = 0, reopened = 0;
window.generateNote = async () => { generated++; return true; };
window.pushEntireVisitToAthena = () => {
  reopened++;
  window.__mlsWriteFlow.openUnifiedConfirmation({ patient, expectedContext: exactVisit, sections: five, preferredAction: 'write_note', receiptSessionId: 'inline-rebuilt' });
  return true;
};

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const missing = window.__mlsWriteFlow.openUnifiedConfirmation({
    patient, expectedContext: exactVisit, plan: [], sections: [], preferredAction: '',
    generationIssue: 'athena-note-missing-canonical-note', receiptSessionId: 'inline-missing'
  });
  const firstCard = byId.mlsAthenaUnifiedConfirm.children[0];
  assert.strictEqual(missing.rows.length, 0, 'missing canonical draft unexpectedly exposed a writable row');
  assert(/Generate HPI, ROS, Exam, Assessment &amp; Plan/.test(firstCard.innerHTML), 'missing canonical draft has no deliberate inline Generate action');
  assert.strictEqual(byId.mlsAthenaUnifiedGo.disabled, true, 'Confirm enabled before canonical generation');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppAthenaActionV2').length, 0, 'generation-only sheet started an Athena probe');

  byId.mlsAthenaUnifiedGenerateSections.click();
  await wait(30);
  assert.strictEqual(generated, 1, 'explicit Generate press did not run exactly one normal generation');
  assert.strictEqual(reopened, 1, 'successful generation did not rebuild the normal Athena review exactly once');
  const rebuilt = window.__mlsWriteFlow.diagnostics.state().manifest;
  const writeRows = rebuilt.rows.filter(row => row.action === 'write_note');
  assert.deepStrictEqual(Array.from(writeRows, row => row.kind), ['hpi', 'ros', 'exam', 'assessment', 'plan'], 'rebuilt review did not stage all five exact destinations');
  assert.strictEqual(rebuilt.patient.patientId, patient.patientId, 'rebuilt review changed the immutable patient');
  assert.strictEqual(rebuilt.visit.appointmentId, exactVisit.appointmentId, 'rebuilt review changed the exact appointment');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'probe').length, 1, 'rebuilt review did not perform exactly one read-only exact-destination probe');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute').length, 0, 'generation/rebuild executed an Athena write');
  assert.strictEqual(byId.mlsAthenaUnifiedGo.disabled, false, 'valid exact read-only probe did not enable the selected rebuilt destination');

  let failedReopen = 0;
  window.generateNote = async () => false;
  window.pushEntireVisitToAthena = () => { failedReopen++; return true; };
  const failed = window.__mlsWriteFlow.openUnifiedConfirmation({
    patient, expectedContext: exactVisit, generationIssue: 'athena-note-stale-canonical-provenance', receiptSessionId: 'inline-failed'
  });
  const failedCard = byId.mlsAthenaUnifiedConfirm.children[0];
  assert(/Regenerate HPI, ROS, Exam, Assessment &amp; Plan/.test(failedCard.innerHTML), 'stale canonical draft has no deliberate inline Regenerate action');
  byId.mlsAthenaUnifiedGenerateSections.click();
  await wait(20);
  assert.strictEqual(failedReopen, 0, 'failed generation rebuilt or advanced the Athena review');
  assert.strictEqual(window.__mlsWriteFlow.diagnostics.state().manifest.manifestHash, failed.manifestHash, 'failed generation changed the review manifest');
  assert.strictEqual(byId.mlsAthenaUnifiedGo.disabled, true, 'failed generation enabled Confirm');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute').length, 0, 'failure path executed an Athena write');

  /* Bind owns the sheet first: generation must not start while the read-only
     day navigation / pull promise is outstanding. */
  let generateDuringBind = 0;
  window.generateNote = async () => { generateDuringBind++; return true; };
  window.pushEntireVisitToAthena = () => true;
  window.__mlsWriteFlow.openUnifiedConfirmation({
    patient, expectedContext: { visitDate: exactVisit.visitDate, provider: exactVisit.provider, appointmentId: '' },
    generationIssue: 'athena-note-missing-canonical-note', receiptSessionId: 'inline-bind-first'
  });
  const bindState = window.__mlsWriteFlow.diagnostics.state();
  const gotoBeforeBind = sent.filter(m => m.type === 'mlsAppGotoDate').length;
  assert.strictEqual(window.__mlsWriteFlow.bindCure.run('2026-08-23'), true, 'bind-first fixture did not start its read-only bind');
  assert.strictEqual(bindState.binding, true, 'bind-first fixture did not own the sheet with a separate binding flag');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppGotoDate').length, gotoBeforeBind + 1, 'bind-first fixture did not start exactly one day navigation');
  byId.mlsAthenaUnifiedGenerateSections.click();
  await wait(0);
  assert.strictEqual(generateDuringBind, 0, 'generation started while bind/re-pull owned the sheet');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppGotoDate').length, gotoBeforeBind + 1, 'generation click started a second bind/pull');

  /* Generation owns the sheet first: bind must not start. Replacing/closing
     the sheet before the deferred result settles must also suppress rebuild. */
  let settleDeferred = null, deferredCalls = 0, staleRebuilds = 0;
  window.generateNote = () => { deferredCalls++; return new Promise(resolve => { settleDeferred = resolve; }); };
  window.pushEntireVisitToAthena = () => { staleRebuilds++; return true; };
  window.__mlsWriteFlow.openUnifiedConfirmation({
    patient, expectedContext: { visitDate: exactVisit.visitDate, provider: exactVisit.provider, appointmentId: '' },
    generationIssue: 'athena-note-stale-canonical-provenance', receiptSessionId: 'inline-generate-first'
  });
  const generateState = window.__mlsWriteFlow.diagnostics.state();
  const gotoBeforeGenerate = sent.filter(m => m.type === 'mlsAppGotoDate').length;
  byId.mlsAthenaUnifiedGenerateSections.click();
  await wait(0);
  assert.strictEqual(deferredCalls, 1, 'generate-first fixture did not start exactly one generation');
  assert.strictEqual(generateState.generating, true, 'generate-first fixture did not own the sheet with the generation flag');
  assert.strictEqual(window.__mlsWriteFlow.bindCure.run('2026-08-23'), false, 'bind started while generation owned the sheet');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppGotoDate').length, gotoBeforeGenerate, 'generation-owned sheet posted a day navigation');
  window.__mlsWriteFlow.openUnifiedConfirmation({ patient, expectedContext: exactVisit, plan: [], sections: [], receiptSessionId: 'inline-replacement' });
  assert.strictEqual(generateState.closed, true, 'replacement did not close the deferred generation sheet');
  settleDeferred(true);
  await wait(20);
  assert.strictEqual(staleRebuilds, 0, 'a stale/closed generation completion rebuilt the Athena review');

  /* Other active review work and a global pull lease independently refuse a
     generation start; neither is represented by the generation flag. */
  let ownershipGenerateCalls = 0;
  window.generateNote = async () => { ownershipGenerateCalls++; return true; };
  window.__mlsWriteFlow.openUnifiedConfirmation({ patient, expectedContext: exactVisit, generationIssue: 'athena-note-missing-canonical-note', receiptSessionId: 'inline-running-owner' });
  const runningState = window.__mlsWriteFlow.diagnostics.state();
  runningState.running = true;
  byId.mlsAthenaUnifiedGenerateSections.click();
  await wait(0);
  assert.strictEqual(ownershipGenerateCalls, 0, 'generation started while the review action flag was active');
  runningState.running = false;
  window.__mlsSchedulePullLease = { at: Date.now() };
  byId.mlsAthenaUnifiedGenerateSections.click();
  await wait(0);
  assert.strictEqual(ownershipGenerateCalls, 0, 'generation started while the global schedule-pull lease was active');
  delete window.__mlsSchedulePullLease;
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppAthenaActionV2' && m.mode === 'execute').length, 0, 'ownership race tests executed an Athena write');

  console.log('PASS Athena inline canonical generation: deliberate local Generate/Regenerate only; success rebuilds HPI/ROS/Exam/Assessment/Plan under the same patient and appointment; bind/generate/action/pull ownership is mutually exclusive; stale completion cannot rebuild; execute count 0');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
