'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_copilot_dock_fix.js'), 'utf8');

function node(tag, id, cls) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(), id: id || '', className: cls || '',
    children: [], parentNode: null, attributes: {}, hidden: false, textContent: '',
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      this.children.push(child); child.parentNode = this; return child;
    },
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const at = before ? this.children.indexOf(before) : -1;
      if (at < 0) this.children.push(child); else this.children.splice(at, 0, child);
      child.parentNode = this; return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child); if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null; return child;
    },
    contains(target) { return this === target || this.children.some(child => child.contains(target)); },
    querySelector(selector) {
      if (selector === '.note') return walk(this).find(x => String(x.className).split(/\s+/).includes('note')) || null;
      return null;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] || null; }
  };
  Object.defineProperty(n, 'firstChild', { get() { return this.children[0] || null; } });
  return n;
}
function walk(rootNode) {
  const out = [];
  (function visit(n) { out.push(n); n.children.forEach(visit); })(rootNode);
  return out;
}

const html = node('html'), head = node('head'), body = node('body');
html.appendChild(head); html.appendChild(body);
const card = node('section', 'copilotCard');
const note = node('div', '', 'note');
const assistantSection = node('section', 'mls-asst-copilot-sec');
const thread = node('div', 'copilotThread');
const chips = node('div', 'copilotChips');
const inputRow = node('div', 'copilotInputRow');
card.appendChild(note);
assistantSection.appendChild(thread); assistantSection.appendChild(chips); assistantSection.appendChild(inputRow);
body.appendChild(card); body.appendChild(assistantSection);

let intervalStarts = 0, openCalls = 0, closeCalls = 0;
const listeners = {};
const document = {
  readyState: 'complete', head, body, documentElement: html,
  createElement(tag) { return node(tag); },
  getElementById(id) { return walk(html).find(x => x.id === id) || null; },
  addEventListener() {}
};
const context = {
  console, document,
  setInterval() { intervalStarts++; return 1; }, clearInterval() {},
  requestAnimationFrame(fn) { fn(); return 1; },
  addEventListener(name, fn) { (listeners[name] || (listeners[name] = [])).push(fn); },
  removeEventListener() {},
  openCopilotDock() { openCalls++; return 'opened'; },
  closeCopilotDock() { closeCalls++; return 'closed'; }
};
context.window = context;
vm.runInNewContext(source, context, { filename: 'feat_mls_copilot_dock_fix.js' });

assert.strictEqual(context.__mlsCopilotDockFix.version, 'cdf-2.0.0');
assert(card.contains(thread) && card.contains(chips) && card.contains(inputRow), 'canonical chat nodes were not claimed by #copilotCard');
assert(document.getElementById('mlsCopilotStableProxy'), 'Assistant section did not receive a stable Copilot proxy');
assert.strictEqual(context.__mlsCopilotDockFix.state(), 'ready');
assert.strictEqual(intervalStarts, 0, 'ready-on-first-pass Copilot started a needless recovery interval');

context.closeCopilotDock();
assert.strictEqual(closeCalls, 1);
assert(card.contains(thread) && card.contains(chips) && card.contains(inputRow), 'closing the dock physically shuttled the canonical conversation');
context.openCopilotDock();
assert.strictEqual(openCalls, 1);
assert.strictEqual(card.children.filter(x => x === thread).length, 1, 'opening duplicated the Copilot thread');
assert.strictEqual(card.children.filter(x => x === inputRow).length, 1, 'opening duplicated the Copilot composer');

assert(!/returnToSec\(\)[\s\S]{0,220}appendChild/.test(source), 'dock close still has a return-to-section shuttle');
console.log('PASS Copilot stable dock: one canonical DOM home, no close shuttle, no ready-state polling, and no duplicate composer');
