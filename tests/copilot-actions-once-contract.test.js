'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_copilot_actions.js'), 'utf8');
const appSource = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const afterVisitSource = fs.readFileSync(path.join(root, 'feat_after_visit_summary.js'), 'utf8');

/* 2026-08-05: ca-2.1.0 — runAction delegates agentic kinds (pullProviders,
   draftNote) to window.__mlsCopilotPower before the keyword fallback, so a
   proposed pull can never degrade into a navigation guess. */
assert(source.includes("var VERSION = 'ca-2.1.0'"));
assert(source.includes("window.__mlsCopilotPower.handles(a.kind)"), 'agentic kinds no longer delegate to the Copilot Power executors');
/* ca-2.0.3: unknown model-drift kinds resolve to a REAL view or say so —
   never a silent dead click, never navigation to a garbage view name. */
assert(source.includes('function strictView(x)'), 'unknown-kind keyword resolver was removed');
assert(source.includes("toast('That suggestion isn’t wired to a screen yet"), 'dead suggestions can fail silently again');
assert(!source.includes('response.clone') && !source.includes('resp.clone'), 'action asset still clones the base Copilot response');
assert(!source.includes('installFetchPeek') && !source.includes('__mlsCaWrapped'), 'action asset still intercepts base Copilot fetches');
assert(!source.includes('window.fetch ='), 'action asset still replaces the shared fetch function');
assert(!source.includes("fetch(base + '/api/copilot',"), 'action asset still issues or parses a second base Copilot request');
assert(!/\/api\/copilot\/email/.test(source) && !/\bSend email\b/.test(source), 'Copilot artifact UI can still send to an arbitrary recipient');
assert(source.includes('function copyEmailDraft') && source.includes("sendBtn.textContent = 'Copy email draft'"), 'held email artifact lost its local draft-copy path');
assert(!/\bteam\s*:\s*['"]team['"]/.test(source), 'Copilot navigation still exposes the held Team workspace');
assert(!/\/api\/copilot\/email/.test(appSource), 'base Studio/Copilot runtime can still send to an arbitrary recipient');
assert(!/\bcopilotSendEmail\b/.test(appSource), 'legacy send-email handler remains callable');
assert(!appSource.includes('MLS.email') && !appSource.includes("email:function(to,subject,body){return rpc(\"email\""), 'custom-widget bridge still advertises arbitrary-recipient email');
assert(appSource.includes('function copilotCopyEmailDraft') && appSource.includes('Nothing is sent from MLS'), 'base Copilot lost its draft-only review/copy boundary');
assert(appSource.includes("return reply(false,{draftOnly:true},'Email sending is unavailable in MLS."), 'custom Studio widgets can still request a network email side effect');
assert(!/\/api\/copilot\/email/.test(afterVisitSource) && !/\bSend to patient\b/.test(afterVisitSource), 'after-visit summary can still send through the generic arbitrary-recipient endpoint');
assert(afterVisitSource.includes("var VERSION = '1.1.0'") && afterVisitSource.includes('id="mlsavsCopyEmail"') && afterVisitSource.includes('Nothing is sent from MLS.'), 'after-visit summary lost its exact-patient local draft-copy boundary');
assert(afterVisitSource.includes("patientBinding(activePatient()) !== els.patientBinding"), 'after-visit summary actions do not stale-block after a chart switch');

const normalizeStart = appSource.indexOf('function _copilotTopPatientsByVisits');
const normalizeEnd = appSource.indexOf('function _copilotRenderThread', normalizeStart);
assert(normalizeStart >= 0 && normalizeEnd > normalizeStart, 'client response action normalizer is missing');
const normalizeContext = { Array, String, Object, RegExp };
vm.runInNewContext(appSource.slice(normalizeStart, normalizeEnd), normalizeContext, { filename: 'ScribeFlow-copilot-normalizer.js' });
const localTopActions = normalizeContext._copilotNormalizeActions('Who are my top patients by visit count?', undefined);
assert.deepStrictEqual(JSON.parse(JSON.stringify(localTopActions)), [{ label: 'View Top Patients', kind: 'navigate', arg: 'patients' }], 'local visit-count answer did not receive the canonical action');
const dedupedTopActions = normalizeContext._copilotNormalizeActions('top patients with the most visits', [
  { label: 'View Patient List', kind: 'navigate', arg: 'patients' },
  { label: 'View Top Patients', kind: 'navigate', arg: 'patients' },
  { label: 'View Appointments', kind: 'navigate', arg: 'calendar' }
]);
assert.strictEqual(dedupedTopActions.filter(a => a.label === 'View Top Patients').length, 1, 'top-patient action was duplicated');
assert.strictEqual(dedupedTopActions.some(a => a.label === 'View Patient List'), false, 'generic patient navigation was not replaced');
assert.deepStrictEqual(JSON.parse(JSON.stringify(normalizeContext._copilotNormalizeActions('What are the top problems?', []))), [], 'unrelated answers were given a patient action');
assert(appSource.includes('actions:_copilotNormalizeActions(q,d.actions||[])'), 'Copilot success path bypasses the client response action normalizer');

function hasClass(node, cls) { return String(node.className || '').split(/\s+/).includes(cls); }
function walk(rootNode) {
  const out = [];
  (function visit(node) { out.push(node); node.children.forEach(visit); })(rootNode);
  return out;
}
function makeNode(tag, id, cls) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', className: cls || '', children: [], parentNode: null,
    attributes: {}, style: {}, textContent: '', value: '', offsetParent: {},
    appendChild(child) { if (child.parentNode) child.parentNode.removeChild(child); this.children.push(child); child.parentNode = this; return child; },
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const at = before ? this.children.indexOf(before) : -1;
      if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
      child.parentNode = this; return child;
    },
    removeChild(child) { const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1); child.parentNode = null; return child; },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const descendants = walk(this).slice(1);
      if (selector.startsWith('.')) return descendants.filter(n => hasClass(n, selector.slice(1)));
      const exact = selector.match(/^\[data-mlsca-message="([^"]+)"\]$/);
      if (exact) return descendants.filter(n => n.getAttribute('data-mlsca-message') === exact[1]);
      if (selector === '[data-mlsca-message]') return descendants.filter(n => n.getAttribute('data-mlsca-message') != null);
      return [];
    },
    scrollIntoView() {}, dispatchEvent() {}, focus() {}
  };
  Object.defineProperty(node, 'nextSibling', { get() { if (!this.parentNode) return null; const i = this.parentNode.children.indexOf(this); return this.parentNode.children[i + 1] || null; } });
  return node;
}

const html = makeNode('html'), head = makeNode('head'), body = makeNode('body');
html.appendChild(head); html.appendChild(body);
const panel = makeNode('section', 'mlsAsstPanel');
const assistantThread = makeNode('div', '', 'as-thread');
const assistantBubble = makeNode('div', '', 'as-msg ai');
assistantThread.appendChild(assistantBubble); panel.appendChild(assistantThread); body.appendChild(panel);
const studioThread = makeNode('div', 'copilotThread');
const canonicalStudioBlock = makeNode('div', '', 'base-copilot-actions');
studioThread.appendChild(canonicalStudioBlock); body.appendChild(studioThread);
const patientSort = makeNode('select', 'ptSort'); patientSort.value = 'name'; body.appendChild(patientSort);

const messages = [{
  role: 'ai', requestId: 7, text: 'Canonical answer',
  actions: [{ kind: 'navigate', arg: 'visit', label: 'Open visit' }, { kind: 'navigate', arg: 'visit', label: 'Open visit' }],
  followups: ['What next?', 'What next?'],
  artifact: { kind: 'draft', title: 'Plan', content: 'Canonical artifact' }
}];
const subscribers = [];
const store = {
  all() { return messages.slice(); },
  subscribe(fn) { subscribers.push(fn); fn(); return () => { const i = subscribers.indexOf(fn); if (i >= 0) subscribers.splice(i, 1); }; }
};
const timers = [];
let timerId = 0, fetchCalls = 0;
const handlers = {};
const patients = [
  { id: 'p1', mrn: 'M1', name: 'Jane Doe', dob: '1980-01-01' },
  { id: 'p2', mrn: 'M2', name: 'Jane Doe', dob: '1990-02-02' },
  { id: 'p3', mrn: 'M3', name: 'Janet Doe', dob: '1975-03-03' },
  { id: 'p4', mrn: 'M4', name: 'John Unique', dob: '1985-04-04' }
];
const selected = [], views = [], toasts = [];
let recordCalls = 0, renderPatientCalls = 0;
const document = {
  readyState: 'complete', head, body, documentElement: html,
  createElement(tag) { return makeNode(tag); },
  getElementById(id) { return walk(html).find(node => node.id === id) || null; },
  querySelectorAll(selector) { return html.querySelectorAll(selector); }, addEventListener() {}
};
const originalFetch = function () { fetchCalls++; return Promise.resolve({ json: () => Promise.resolve({ ok: true }) }); };
const context = {
  console, Promise, Date, JSON, Object, Array, String, Number, RegExp, Event: function Event() {},
  document, __mlsCopilotConvo: store, fetch: originalFetch,
  setTimeout(fn) { const id = ++timerId; timers.push({ id, fn }); return id; }, clearTimeout(id) { const item = timers.find(x => x.id === id); if (item) item.fn = null; },
  setInterval() { throw new Error('action metadata must not poll'); }, clearInterval() {},
  addEventListener(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); }, removeEventListener() {},
  getPatients() { return patients.slice(); },
  __mlsWhosNext: { activeList() { return [patients[3]]; } },
  __mlsPick: { select(id) { selected.push(id); return true; } },
  showView(view) { views.push(view); },
  renderPatients() { renderPatientCalls++; },
  startCapture() { recordCalls++; },
  toast(message) { toasts.push(String(message)); }
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'feat_mls_copilot_actions.js' });
while (timers.length) { const item = timers.shift(); if (item.fn) item.fn(); }

assert.strictEqual(context.fetch, originalFetch, 'action asset replaced fetch even without making a request');
assert.strictEqual(fetchCalls, 0, 'action asset made a second request while rendering canonical metadata');
assert.strictEqual(studioThread.children.length, 1, 'action asset injected a second block into base Studio Copilot');
assert.strictEqual(studioThread.children[0], canonicalStudioBlock);

let blocks = assistantThread.querySelectorAll('[data-mlsca-message]');
assert.strictEqual(blocks.length, 1, 'Assistant did not receive exactly one canonical metadata block');
assert.strictEqual(blocks[0].querySelector('.mlsca-acts').children.length, 1, 'duplicate canonical action was rendered');
assert.strictEqual(blocks[0].querySelector('.mlsca-fu').children.length, 1, 'duplicate canonical follow-up was rendered');
assert.strictEqual(blocks[0].querySelectorAll('.mlsca-art').length, 1, 'artifact was missing or duplicated');

subscribers.slice().forEach(fn => fn());
context.__mlsCopilotActions.sync();
while (timers.length) { const item = timers.shift(); if (item.fn) item.fn(); }
blocks = assistantThread.querySelectorAll('[data-mlsca-message]');
assert.strictEqual(blocks.length, 1, 'repeated canonical notifications duplicated Assistant metadata');
assert.strictEqual(fetchCalls, 0, 'repeated canonical rendering parsed or requested the response again');

const api = context.__mlsCopilotActions;
assert.strictEqual(api.resolvePatient('Jane Doe').reason, 'ambiguous-name', 'duplicate exact names did not fail closed');
assert.strictEqual(api.resolvePatient('Jan').reason, 'ambiguous-name', 'non-unique partial name did not fail closed');
assert.strictEqual(api.resolvePatient({ id: 'p2' }).patient.id, 'p2', 'same-namespace stable ID did not resolve exactly');
assert.strictEqual(api.resolvePatient({ mrn: 'p2' }).patient, null, 'equal value in a different ID namespace crossed charts');
assert.strictEqual(api.runAction({ kind: 'openPatient', arg: 'Jane Doe' }), false);
assert.strictEqual(selected.length, 0, 'ambiguous name opened a chart');
assert(toasts.some(t => /more than one patient/i.test(t)), 'ambiguity did not produce an explicit message');

assert.strictEqual(api.runAction({ kind: 'openPatient', arg: 'John' }), true, 'unique partial name did not resolve');
assert.deepStrictEqual(selected, ['p4']);
assert.strictEqual(api.runAction({ kind: 'startVisit', arg: { id: 'p2' } }), true);
assert.deepStrictEqual(selected, ['p4', 'p2'], 'Start Visit did not canonically select the exact resolved patient');
assert.strictEqual(views[views.length - 1], 'visit', 'Start Visit did not navigate after exact selection');
assert.strictEqual(recordCalls, 0, 'Start Visit auto-started recording');

assert.strictEqual(api.runAction({ kind: 'navigate', arg: 'patients', label: 'View Top Patients' }), true);
assert.strictEqual(patientSort.value, 'visits', 'View Top Patients did not select visit-count ranking');
assert.strictEqual(views[views.length - 1], 'patients');
assert.strictEqual(renderPatientCalls, 1, 'visit-count ranking was not rendered immediately');

assert.strictEqual(api.runAction({ kind: 'navigate', arg: 'top diagnoses', label: 'View Top Diagnoses' }), true);
assert.strictEqual(views[views.length - 1], 'analysis', 'top diagnoses did not resolve to Analysis');

const beforeUnknownViews = views.length;
assert.strictEqual(api.runAction({ kind: 'navigate', arg: 'definitely nowhere', label: 'Mystery screen' }), false);
assert.strictEqual(views.length, beforeUnknownViews, 'unknown navigation claimed success or dispatched a garbage view');
assert(toasts.some(t => /isn.t wired to a screen/i.test(t)), 'unknown navigation failed silently');

console.log('PASS Copilot actions: single-owner metadata plus fail-closed patient resolution and canonical no-auto-record Start Visit');
