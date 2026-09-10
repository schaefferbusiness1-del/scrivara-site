'use strict';

/* A stale/missing canonical Athena sidecar keeps the existing note blocked.
   Changed source offers Return to note only. The exact legacy saved-binding
   mismatch offers one explicit zero-AI repair through the normal Bind gate,
   then reopens the ordinary review; neither path starts an Athena write. */
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
   the legacy internal generation helper remains available only for compatibility. */
const bindBlock = source.slice(source.indexOf('/* ===== wfbind-1.0.0'), source.indexOf('/* ===== end wfbind-1.0.0'));
assert(bindBlock.length > 500, 'bind-cure block is missing');
assert(!/generateNote|runUnifiedCanonicalGeneration/.test(bindBlock), 'bind/re-pull silently started clinical generation');
assert(/return generate\(\)/.test(source), 'legacy generation helper lost its normal generateNote gate');
/* RE-AIMED, regenkeep-1.0.0 (2026-09-02), and STRENGTHENED, not relaxed. The
   rebuild itself is unchanged - it is still reopen(null), the ordinary Athena
   review entrypoint - but the call is now wrapped so the ONE-SHOT visit
   carry-through a regenerate arms is disarmed even when that rebuild refuses or
   throws. The old pin matched the assignment's exact spelling ("var rebuilt =")
   and so reddened on a change that only moved the declaration up one line. It
   now follows the CALL, and a second line pins the disarm the wrap exists for -
   without it, a refused rebuild would leave a standing visit override armed for
   whatever opened the review next. See tests/sheet-rows-and-reopen-proof.js. */
assert(/rebuilt = reopen\(null\);/.test(source), 'successful generation no longer re-enters the ordinary Athena review entrypoint');
assert(/try \{ rebuilt = reopen\(null\); \} finally \{ regenKeepDisarm\(\); \}/.test(source),
  'the regenerate rebuild no longer disarms its one-shot visit carry-through');
assert(/generationIssue:\s*unifiedCanonicalGenerationIssue\(opts\)/.test(source), 'a bind/re-pull rebuild drops the canonical generation issue');
for (const file of shellPaths) {
  const shell = shellSources[file];
  assert(/function _athenaOpenCanonicalGenerationReview\(binding,reason\)/.test(shell), `${file} is missing the inline canonical generation integration`);
  assert(/generationIssue:String\(reason\|\|'athena-note-missing-canonical-note'\)/.test(shell), `${file} does not carry the canonical failure into the review`);
  assert(/_athenaOpenCanonicalGenerationReview\(binding,built\.blockReason\)/.test(shell), `${file} still early-returns instead of opening the deliberate generation review`);
}
assert(/id=\"mlsAthenaUnifiedReturnToNote\"/.test(source), 'writeflow is missing the Return to note action');
assert(/id=\"mlsAthenaUnifiedRecoverSaved\"/.test(source), 'writeflow is missing the exact legacy saved-binding recovery action');
assert(/function runUnifiedCanonicalRecovery[\s\S]*wfbindCommitCanonical/.test(source), 'saved-binding recovery bypasses the frozen editor / exact patient Bind gate');
assert(!/id=\"mlsAthenaUnifiedGenerateSections\"/.test(source), 'writeflow still renders a Generate/Regenerate action in Send review');

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
window.pushEntireVisitToAthena = () => { reopened++; return true; };

const noteBox = new El('textarea'); noteBox.id = 'noteBox'; noteBox.value = 'Existing generated display note.'; document.body.appendChild(noteBox);

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const missing = window.__mlsWriteFlow.openUnifiedConfirmation({
    patient, expectedContext: exactVisit, plan: [], sections: [], preferredAction: '',
    generationIssue: 'athena-note-missing-canonical-note', receiptSessionId: 'inline-missing'
  });
  const firstCard = byId.mlsAthenaUnifiedConfirm.children[0];
  assert.strictEqual(missing.rows.length, 0, 'missing canonical draft unexpectedly exposed a writable row');
  assert(/Return to the note/i.test(firstCard.innerHTML), 'missing canonical draft does not offer a return to the retained note');
  assert(/existing note retained/i.test(firstCard.innerHTML), 'blocked canonical draft does not explain that the existing note is retained');
  assert(!/mlsAthenaUnifiedGenerateSections|Generate HPI|Regenerate HPI/i.test(firstCard.innerHTML), 'Send review still presents an AI generation action');
  assert.strictEqual(byId.mlsAthenaUnifiedGo.disabled, true, 'Confirm enabled before canonical generation');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppAthenaActionV2').length, 0, 'generation-only sheet started an Athena probe');

  const beforePatient = JSON.stringify(missing.patient), beforeVisit = JSON.stringify(missing.visit);
  byId.mlsAthenaUnifiedReturnToNote.click();
  await wait(20);
  assert.strictEqual(generated, 0, 'Return to note invoked AI generation');
  assert.strictEqual(reopened, 0, 'Return to note rebuilt the review');
  assert.strictEqual(byId.mlsAthenaUnifiedConfirm, undefined, 'Return to note did not close the review');
  assert.strictEqual(noteBox.value, 'Existing generated display note.', 'Return to note changed the retained note');
  assert.strictEqual(JSON.stringify(missing.patient), beforePatient, 'Return to note changed patient identity');
  assert.strictEqual(JSON.stringify(missing.visit), beforeVisit, 'Return to note changed visit context');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppAthenaActionV2').length, 0, 'Return to note started an Athena action');

  let currentBinding = { patient, source: 'saved-record', historical: true,
    visitContext: { visitDate: exactVisit.visitDate, provider: exactVisit.provider, appointmentId: exactVisit.appointmentId, encounterId: '', encounterUrl: '' } };
  let canonicalReady = false, reanchors = 0;
  window.activePatient = () => patient;
  window._athenaEditorFingerprint = () => 'unchanged-editor-fingerprint';
  window._athenaGetVisitBinding = () => currentBinding;
  window._athenaFreezeVisitBinding = (activePatient, meta) => ({
    id: 'fresh-explicit-binding', patient: activePatient, source: meta.source,
    visitContext: Object.assign({}, meta.visitContext)
  });
  window._athenaSetVisitBinding = binding => { currentBinding = binding; return true; };
  window._mlsAthenaCanRecoverExplicitBinding = binding => binding === currentBinding;
  window._mlsAthenaReanchorExplicitBinding = (prior, readback) => {
    assert.strictEqual(prior.patient.patientId, patient.patientId, 'recovery lost the prior exact patient');
    assert.strictEqual(readback.visitContext.appointmentId, exactVisit.appointmentId, 'recovery changed the selected appointment');
    reanchors++; canonicalReady = true; return true;
  };
  window._mlsAthenaCanonicalForWrite = () => ({ required: true, ok: canonicalReady });

  const eligible = window.__mlsWriteFlow.openUnifiedConfirmation({
    patient, expectedContext: exactVisit, plan: [], sections: [], preferredAction: '',
    generationIssue: 'athena-note-stale-canonical-provenance', receiptSessionId: 'inline-legacy-recovery'
  });
  const eligibleCard = byId.mlsAthenaUnifiedConfirm.children[0];
  assert(byId.mlsAthenaUnifiedRecoverSaved, 'exact legacy saved-binding issue has no reachable recovery action');
  assert(/Use this note for this visit/.test(eligibleCard.innerHTML), 'recovery action does not name the retained-note outcome');
  const eligiblePatient = JSON.stringify(eligible.patient), eligibleVisit = JSON.stringify(eligible.visit);
  window._athenaEditorFingerprint = () => 'changed-after-sheet-open';
  byId.mlsAthenaUnifiedRecoverSaved.click();
  await wait(20);
  assert.strictEqual(reanchors, 0, 'changed editor reached saved-note recovery');
  assert.strictEqual(reopened, 0, 'changed editor reopened the ordinary Athena review');
  assert(byId.mlsAthenaUnifiedConfirm, 'changed-editor refusal closed the retained-note explanation');
  assert.strictEqual(noteBox.value, 'Existing generated display note.', 'changed-editor refusal mutated the retained note');
  window._athenaEditorFingerprint = () => 'unchanged-editor-fingerprint';
  byId.mlsAthenaUnifiedRecoverSaved.click();
  await wait(20);
  assert.strictEqual(reanchors, 1, 'explicit recovery did not pass through the canonical binding/re-anchor gate exactly once');
  assert.strictEqual(generated, 0, 'saved-note recovery invoked AI generation');
  assert.strictEqual(reopened, 1, 'saved-note recovery did not re-enter the ordinary Athena review');
  assert.strictEqual(noteBox.value, 'Existing generated display note.', 'saved-note recovery changed the displayed note');
  assert.strictEqual(JSON.stringify(eligible.patient), eligiblePatient, 'saved-note recovery changed the sheet patient');
  assert.strictEqual(JSON.stringify(eligible.visit), eligibleVisit, 'saved-note recovery changed the sheet appointment');
  assert.strictEqual(currentBinding.visitContext.appointmentId, exactVisit.appointmentId, 'saved-note recovery changed the canonical appointment');
  assert.strictEqual(sent.filter(m => m.type === 'mlsAppAthenaActionV2').length, 0, 'recovery itself started an Athena action before the normal review');

  window._mlsAthenaCanRecoverExplicitBinding = () => false;
  const changed = window.__mlsWriteFlow.openUnifiedConfirmation({
    patient, expectedContext: exactVisit, plan: [], sections: [], preferredAction: '',
    generationIssue: 'athena-note-canonical-source-changed', receiptSessionId: 'inline-changed-source'
  });
  const changedCard = byId.mlsAthenaUnifiedConfirm.children[0];
  assert.strictEqual(byId.mlsAthenaUnifiedRecoverSaved, undefined, 'changed source incorrectly exposed saved-note recovery');
  assert(/Existing note retained; review the updated source or complete its five sections/.test(changedCard.innerHTML), 'changed-source issue retained stale generation instructions');
  byId.mlsAthenaUnifiedReturnToNote.click();
  await wait(20);
  assert.strictEqual(generated, 0, 'changed-source Return invoked AI generation');
  assert.strictEqual(reopened, 1, 'changed-source Return rebuilt the Athena review');
  assert.strictEqual(noteBox.value, 'Existing generated display note.', 'changed-source Return changed the retained note');

  console.log('PASS Athena inline canonical review: ordinary stale source offers Return only; exact legacy binding offers explicit zero-AI recovery through the canonical bind gate and normal review');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
