'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_copilot_unify.js'), 'utf8');

const nodes = {};
function makeNode(tag) {
  return {
    tagName: String(tag || 'div').toUpperCase(), id: '', className: '', style: {}, children: [], parentNode: null,
    appendChild(child) { this.children.push(child); child.parentNode = this; if (child.id) nodes[child.id] = child; return child; },
    insertBefore(child) { return this.appendChild(child); }, removeChild(child) { const i = this.children.indexOf(child); if (i >= 0) this.children.splice(i, 1); child.parentNode = null; },
    querySelector() { return null; }, setAttribute() {}
  };
}
const head = makeNode('head'), body = makeNode('body'), html = makeNode('html');
let intervalStarts = 0;
const handlers = {};
const document = {
  readyState: 'complete', head, body, documentElement: html,
  createElement: makeNode, createTextNode(text) { return { textContent: String(text), parentNode: null }; },
  getElementById(id) { return nodes[id] || null; }, querySelector() { return null; },
  addEventListener() {}, removeEventListener() {}
};
const context = {
  console, document, location: { hostname: 'mlsscribe.com', pathname: '/ScribeFlow.html' },
  _copilotHistory: [],
  _copilotRenderThread() {}, _copilotRenderChips() {}, _copilotSaveHist() {}, copilotSnapshot() { return {}; },
  localStorage: { removeItem() {} }, uns(v) { return v; }, activePatient() { return null; },
  setInterval() { intervalStarts++; return 1; }, clearInterval() {},
  addEventListener(name, fn) { (handlers[name] || (handlers[name] = [])).push(fn); }, removeEventListener() {}
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'feat_mls_copilot_unify.js' });

const store = context.__mlsCopilotConvo;
assert.strictEqual(context.__mlsCopilotUnify.version, 'unify-1.1.0');
const first = store.pushPending('First', { requestId: 1 });
const second = store.pushPending('Second', { requestId: 2 });
assert.strictEqual(store.dropPending(first), true);
assert.strictEqual(store.all().includes(first), false, 'specific pending token was not removed');
assert.strictEqual(store.all().includes(second), true, 'one request cleared another request pending token');
assert.strictEqual(store.dropPending(second), true);
assert.strictEqual(intervalStarts, 0, 'ready canonical store started a permanent or needless polling loop');
assert((handlers['mls:active-patient-changed'] || []).length === 1, 'canonical patient event is not wired for no-patient hint refresh');
assert(!source.includes('hintPoll = setInterval'), 'legacy permanent no-patient hint polling remains');

console.log('PASS Copilot canonical store: request-specific pending tokens and event-driven hint lifecycle without permanent polling');
