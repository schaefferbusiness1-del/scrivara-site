'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');

function element(tag) {
  return {
    nodeType: 1,
    tagName: String(tag || '').toUpperCase(),
    id: '',
    className: '',
    textContent: '',
    style: {},
    attributes: {},
    children: [],
    parentNode: null,
    firstChild: null,
    appendChild(child) {
      if (child.parentNode) child.parentNode.removeChild(child);
      child.parentNode = this;
      this.children.push(child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    insertBefore(child, before) {
      if (child.parentNode) child.parentNode.removeChild(child);
      const at = this.children.indexOf(before);
      child.parentNode = this;
      this.children.splice(at < 0 ? this.children.length : at, 0, child);
      this.firstChild = this.children[0] || null;
      return child;
    },
    removeChild(child) {
      const at = this.children.indexOf(child);
      if (at >= 0) this.children.splice(at, 1);
      child.parentNode = null;
      this.firstChild = this.children[0] || null;
      return child;
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null; },
    querySelectorAll() { return []; }
  };
}

function byId(node, id) {
  if (!node) return null;
  if (node.id === id) return node;
  for (const child of node.children || []) {
    const found = byId(child, id);
    if (found) return found;
  }
  return null;
}

const html = element('html');
const head = element('head');
const body = element('body');
const shelf = element('div'); shelf.id = 'mlsMobileNoticeShelf';
html.appendChild(head); html.appendChild(body); body.appendChild(shelf);

const document = {
  readyState: 'loading', head, body, documentElement: html,
  createElement: element,
  createTextNode(text) { const node = element('#text'); node.textContent = String(text); return node; },
  getElementById(id) { return byId(html, id); },
  addEventListener() {},
  querySelectorAll() { return []; }
};

const timers = [];
const ctx = {
  console, document,
  setTimeout(fn, ms) { const row = { fn, ms: Number(ms) || 0, cleared: false }; timers.push(row); return timers.length; },
  clearTimeout(id) { if (timers[id - 1]) timers[id - 1].cleared = true; },
  setInterval() { return 1; }, clearInterval() {},
  addEventListener() {}, removeEventListener() {},
  __mlsPlaceMobileNotice(node) { shelf.appendChild(node); return true; },
  __mlsRefreshMobileNoticeShelf() {}
};
ctx.window = ctx;

vm.runInNewContext(read('feat_save_verify.js'), ctx, { filename: 'feat_save_verify.js', timeout: 1000 });
const api = ctx.__mlsSaveVerify;
assert(api && api.installed, 'save verifier did not install');

const first = api.banner('ok', 'Saved & verified: synthetic patient', ['0 visits stored.'], { ttl: 4500 });
const duplicate = api.banner('ok', 'Saved & verified: synthetic patient', ['0 visits stored.'], { ttl: 4500 });
const stack = document.getElementById('mls-save-verify-stack');
assert.strictEqual(duplicate, first, 'an identical success created a second notice instead of deduping');
assert.strictEqual(stack.parentNode, shelf, 'phone save notice was not placed in the normal-flow mobile shelf');
assert.strictEqual(stack.children.length, 1, 'duplicate success stacked visually');
assert.strictEqual(timers.length, 1, 'duplicate success restarted/extended the retirement timer');
assert.strictEqual(first.getAttribute('role'), 'status', 'success lost its polite live-region semantics');
assert.strictEqual(first.getAttribute('aria-live'), 'polite', 'success must remain a polite announcement');

const latest = api.banner('ok', 'Saved & verified: updated synthetic patient', ['1 visit stored.'], { ttl: 4500 });
assert.notStrictEqual(latest, first, 'new current state was mistaken for a duplicate');
assert.strictEqual(stack.children.length, 1, 'older success was left behind when a newer success arrived');
assert.strictEqual(stack.children[0], latest, 'newest save state is not the sole visible success');

const failure = api.banner('warn', 'Save could not be verified', ['Retry the save.'], { ttl: 0 });
assert.strictEqual(stack.children.length, 2, 'important failure replaced the current success instead of remaining visible');
assert.strictEqual(failure.getAttribute('role'), 'alert', 'failure lost alert semantics');
assert.strictEqual(failure.getAttribute('aria-live'), 'assertive', 'failure must remain an assertive announcement');

const latestTimer = timers[timers.length - 1];
latestTimer.fn();
assert.strictEqual(stack.children.length, 1, 'success did not self-retire');
assert.strictEqual(stack.children[0], failure, 'persistent failure disappeared when success retired');

const main = read('ScribeFlow.html');
const staging = read('ScribeFlow-staging.html');
for (const [name, source] of [['production', main], ['staging', staging]]) {
  assert(source.includes('function mlsMobileNoticeShelf()'), `${name} lacks the normal-flow phone notice owner`);
  assert(source.includes("toastKey===nextKey") && source.includes('return t;'), `${name} repeated toast can still extend itself indefinitely`);
  assert(source.includes("nextType==='err'?'alert':'status'"), `${name} toast lost accessible error/status semantics`);
  assert(source.includes('#mlsMobileNoticeShelf>.toast{position:static'), `${name} phone toast can still overlay primary controls`);
}

const writeflow = read('feat_mls_writeflow.js');
assert(writeflow.includes("ov.setAttribute('aria-describedby', 'mlsAthenaUnifiedSafety')"), 'Athena review dialog lacks its safety announcement');
assert(writeflow.includes("'', { toast: false });"), 'opening the self-announcing Athena dialog still creates a redundant floating toast');

const redesign = read('feat_mls_redesign.js');
assert(redesign.includes('#mlsTbMenuBtn>span{display:none;}'), '360px top bar still spends width on the Menu label');
assert(redesign.includes('font-size:0 !important') && redesign.includes("#mlsTbMenuBtn::before{content:'⋯'"), 'hot-upgraded text-only Menu button is not converted to a compact visual icon');
assert(redesign.includes('#mlsRdMenuSlot{gap:4px !important'), '360px top-bar control group remains needlessly cramped');
assert(redesign.includes('body.mls-redesign{ scrollbar-gutter:auto !important; }'), 'phone layout still reserves a second nested scrollbar gutter');

console.log('PASS phone notices use normal flow, dedupe/retire success, preserve persistent failure announcements, and compact the 360px header');
