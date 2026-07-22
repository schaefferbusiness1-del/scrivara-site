'use strict';

/* The "Recent" chip in the top patient banner must never unmount while its bar
 * is visible: a transiently empty patient store (mid-refresh hydration) used to
 * remove the node entirely, collapsing its grid cell and shifting every
 * neighboring control. Contract: chip stays mounted, holds its last committed
 * label through hydration, and renders a same-size disabled placeholder when
 * there are genuinely no recent charts. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_recentpts.js'), 'utf8');

assert(source.includes("var VERSION='rp-2.0.0'"), 'recent-chip stability version missing');
assert(source.includes('min-width:118px'), 'chip wrapper must reserve stable width');
assert(source.includes('min-width:112px'), 'chip button must reserve stable width');
assert(source.includes('font-variant-numeric:tabular-nums'), 'count digits must not change button width');
assert(source.includes(".mrp-btn[disabled]{opacity:.55;cursor:default;}"), 'disabled placeholder style missing');
assert(!/if\(!loc\|\|!others\.length\)/.test(source), 'retired remove-on-empty branch is back');

for (const bundle of ['mls-connect.js', 'mls-connect.staging.js']) {
  const connect = fs.readFileSync(path.join(root, bundle), 'utf8');
  assert(connect.includes('feat_mls_recentpts.js'), `${bundle} must load the recent chip`);
  assert(connect.includes('?v=20260722rp3'), `${bundle} must cache-bust the rp-2.0.0 stability release`);
  assert(!connect.includes('?v=20260714rp2'), `${bundle} still pins the pre-stability chip`);
}

/* ---- runtime: hand-rolled DOM, no jsdom (repo convention) ---- */

let removedWrapCount = 0;
let elSeq = 0;

function makeEl(tag) {
  const node = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    _seq: ++elSeq,
    children: [],
    parentNode: null,
    style: {},
    textContent: '',
    offsetParent: {},
    disabled: false,
    _handlers: {},
    _innerHTML: '',
    setAttribute(name, value) { this['_attr_' + name] = String(value); },
    getAttribute(name) { return this['_attr_' + name] == null ? null : this['_attr_' + name]; },
    appendChild(child) {
      if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(c => c !== child);
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    insertBefore(child, ref) {
      if (child.parentNode) child.parentNode.children = child.parentNode.children.filter(c => c !== child);
      child.parentNode = this;
      const i = this.children.indexOf(ref);
      if (i >= 0) this.children.splice(i, 0, child); else this.children.push(child);
      return child;
    },
    remove() {
      if (this.id === 'mlsRecentPts') removedWrapCount++;
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(c => c !== this);
      this.parentNode = null;
    },
    querySelector(sel) {
      if (sel === '.mlsctx-actions') return this._actionsAnchor || null;
      if (sel === '.mrp-btn') return this._btn || null;
      return null;
    },
    querySelectorAll() { return []; },
    addEventListener(type, fn) { this._handlers[type] = fn; },
    removeEventListener() {},
    getBoundingClientRect() { return { top: 0, left: 0, bottom: 20, right: 100 }; },
    contains() { return false; },
    get innerHTML() { return this._innerHTML; },
    set innerHTML(html) {
      this._innerHTML = String(html);
      if (this._innerHTML.includes('mrp-btn')) {
        const btn = makeEl('button');
        btn.className = 'mrp-btn';
        btn.disabled = / disabled /.test(this._innerHTML) || this._innerHTML.includes(' disabled aria-disabled');
        this._btn = btn;
      } else {
        this._btn = null;
      }
    },
  };
  allEls.push(node);
  return node;
}

const allEls = [];

const head = makeEl('head');
const body = makeEl('body');
const ctxBar = makeEl('div');
ctxBar.id = 'mlsCtxBar';
ctxBar.parentNode = body;
body.children.push(ctxBar);
const actions = makeEl('span');
actions.className = 'mlsctx-actions';
ctxBar.appendChild(actions);
ctxBar._actionsAnchor = actions;

const documentFake = {
  readyState: 'complete',
  head,
  body,
  getElementById(id) {
    if (id === 'mlsCtxBar') return ctxBar;
    for (const el of allEls) if (el.id === id && el.parentNode) return el;
    return null;
  },
  createElement(tag) { return makeEl(tag); },
  addEventListener() {},
  removeEventListener() {},
  querySelector() { return null; },
  querySelectorAll() { return []; },
};

const store = new Map();
store.set('mls_recent_pts_v1', JSON.stringify(['P1', 'P2']));

const context = {
  console,
  localStorage: {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
  },
  document: documentFake,
  getComputedStyle: () => ({ display: 'flex' }),
  MutationObserver: class { observe() {} disconnect() {} },
  setTimeout: fn => { fn(); return 1; },
  setInterval: () => 1,
  clearInterval: () => {},
  patientsData: [],
};
context.window = context;
context.getPatients = () => context.patientsData;
context.getActivePtId = () => 'P1';
vm.createContext(context);
vm.runInContext(source, context);

const api = context.window.__mlsRecentPts;
assert(api && api.__booted, 'module did not boot in the sandbox');

function wrap() { return documentFake.getElementById('mlsRecentPts'); }

/* 1. Store empty (hydrating) but recent ids exist: chip mounts as a disabled
 *    placeholder instead of staying absent. */
assert(wrap(), 'chip must mount even while the patient store is empty/hydrating');
assert(wrap().innerHTML.includes('disabled'), 'hydrating state must be a disabled placeholder');
assert(!/\(\d+\)/.test(wrap().innerHTML), 'hydrating state must not show a partial count');
assert.strictEqual(removedWrapCount, 0, 'chip was removed during hydration');

/* 2. Store hydrates: chip becomes an enabled control with the real count. */
context.patientsData = [
  { id: 'P1', name: 'Alpha Test', dob: '1980-01-01' },
  { id: 'P2', name: 'Beta Test', dob: '1981-02-02' },
];
api.rerender();
assert(wrap().innerHTML.includes('Recent (1)'), 'hydrated chip must show the committed count');
assert(!wrap().innerHTML.includes('disabled'), 'hydrated chip with recents must be enabled');

/* 3. Transient empty store mid-refresh: label holds, node never unmounts. */
const committed = wrap().innerHTML;
context.patientsData = [];
api.rerender();
assert.strictEqual(wrap().innerHTML, committed, 'transient empty store must not change the committed label');
assert.strictEqual(removedWrapCount, 0, 'transient empty store unmounted the chip');

/* 4. Genuinely zero other recents (hydrated): stable disabled placeholder, still mounted. */
context.patientsData = [{ id: 'P1', name: 'Alpha Test', dob: '1980-01-01' }];
api.rerender();
assert(wrap(), 'chip must stay mounted with zero recents');
assert(wrap().innerHTML.includes('disabled'), 'zero-recents state must be a disabled placeholder');
assert.strictEqual(removedWrapCount, 0, 'zero-recents state unmounted the chip');

/* 5. Repeated refresh churn (simulates reload/count-update cycles): no unmount,
 *    no label thrash beyond committed transitions. */
for (let i = 0; i < 25; i++) {
  context.patientsData = i % 2
    ? [{ id: 'P1', name: 'Alpha Test' }, { id: 'P2', name: 'Beta Test' }]
    : [];
  api.rerender();
  assert(wrap(), `chip unmounted on churn iteration ${i}`);
}
assert.strictEqual(removedWrapCount, 0, 'refresh churn unmounted the chip');

console.log('PASS recent chip stays mounted with stable width through hydration, refresh churn, and zero-recent states');
