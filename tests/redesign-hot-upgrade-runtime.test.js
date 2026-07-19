'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'feat_mls_redesign.js'), 'utf8');
const production = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const staging = fs.readFileSync(path.join(root, 'mls-connect.staging.js'), 'utf8');

function functionBlock(name) {
  const start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, line = false, block = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i], next = source[i + 1];
    if (line) { if (ch === '\n') line = false; continue; }
    if (block) { if (ch === '*' && next === '/') { block = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { line = true; i++; continue; }
    if (ch === '/' && next === '*') { block = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

assert(source.indexOf('try{if(retirePriorInstall())return;}') < source.indexOf('var FONT_ID'),
  'version-aware retirement does not run before the normal installation guard');
assert(source.includes("removeNode('mlsRdNewMenu');removeNode('mlsRdNewBtn');removeNode('mlsRdUserChip');"),
  'hot upgrade does not retire the stale New/account nodes');
assert(source.includes('_historyWrapper.__rdHistOrig=original') && source.includes('_historyWrapper.__rdHistVersion=VERSION'),
  'current history owner is not reversible/versioned');
assert(functionBlock('ensureBackControl').includes('replaceChild(back,prior)'),
  'hot upgrade keeps the old closure-bound Back button');
for (const [name, bundle] of [['production', production], ['staging', staging]]) {
  assert(bundle.includes("V='3.2.2',api=window.__mlsRedesign") && bundle.includes("old.removeAttribute('data-mls-asset')"),
    `${name} loader blocks the version-aware redesign from evaluating in an existing document`);
}

/* A reversible 3.2.1 owner is fully unwrapped and its stale controls are
 * removed before 3.2.2 evaluates the idempotent shell builders. */
{
  const removed = [];
  const nodes = Object.create(null);
  for (const id of ['mlsRdNewMenu', 'mlsRdNewBtn', 'mlsRdUserChip']) {
    nodes[id] = { id, parentNode: { removeChild(node) { removed.push(node.id); delete nodes[node.id]; } } };
  }
  let baseCalls = 0, revertCalls = 0;
  function base(view) { baseCalls++; return view; }
  function oldHistory(view) { return base(view); }
  oldHistory.__rdHist = true;
  oldHistory.__rdHistOrig = base;
  function oldTitle(view) { return oldHistory(view); }
  oldTitle.__rdTitleWrapped = true;
  oldTitle.__rdTitleOrig = oldHistory;
  const prior = {
    installed: true,
    version: '3.2.1',
    revert() { revertCalls++; this.installed = false; window.showView = oldHistory; }
  };
  const window = { __mlsRedesign: prior, showView: oldTitle };
  const context = {
    window,
    document: { getElementById(id) { return nodes[id] || null; } },
    VERSION: '3.2.2',
    _priorRedesign: null,
    _opaqueLegacyHistory: null
  };
  vm.createContext(context);
  vm.runInContext([
    functionBlock('rawById'),
    functionBlock('removeNode'),
    functionBlock('unwrapKnownRedesignOwners'),
    functionBlock('retirePriorInstall'),
    'this.retirePriorInstall=retirePriorInstall;'
  ].join('\n'), context);
  assert.strictEqual(context.retirePriorInstall(), false);
  assert.strictEqual(revertCalls, 1, 'old redesign revert was not called exactly once');
  assert.strictEqual(window.showView, base, 'pointer-bearing old history wrapper was not fully unwrapped');
  assert.deepStrictEqual(removed.sort(), ['mlsRdNewBtn', 'mlsRdNewMenu', 'mlsRdUserChip'].sort());
  window.showView('patients');
  assert.strictEqual(baseCalls, 1);
}

/* The shipped opaque 3.2.1 wrapper had no pointer to its host function. The
 * new owner therefore treats it as a forwarding bridge under a locked
 * throwaway state; a navigation must still add exactly one canonical entry. */
{
  let baseCalls = 0, oldPushes = 0;
  const window = { __mlsViewHist: { stack: [], lock: false, cur: 'visit' } };
  function base(view) { baseCalls++; return `base:${view}`; }
  function opaqueOld(view) {
    const h = window.__mlsViewHist, cur = h.cur;
    if (!h.lock && cur && cur !== view && cur !== '__pinned') { h.stack.push(cur); oldPushes++; }
    if (view && view !== '__pinned') h.cur = view;
    return base(view);
  }
  opaqueOld.__rdHist = true;
  window.showView = opaqueOld;
  const context = {
    window,
    VERSION: '3.2.2',
    _opaqueLegacyHistory: null,
    _historyWrapper: null,
    _historyOriginal: null,
    _historyBeforeInstall: undefined,
    _historyBeforeInstallCaptured: false,
    _historyBeforeInstallHadOwn: false,
    Object,
    Array,
    syncBackButton() {}
  };
  vm.createContext(context);
  vm.runInContext([
    functionBlock('chainHasCurrentHistory'),
    functionBlock('ensureHistoryOwner'),
    functionBlock('restoreShowViewOwners'),
    'this.ensureHistoryOwner=ensureHistoryOwner;this.restoreShowViewOwners=restoreShowViewOwners;'
  ].join('\n'), context);
  context.ensureHistoryOwner();
  const current = window.showView;
  assert.strictEqual(current.__rdHistVersion, '3.2.2');
  assert.strictEqual(current.__rdHistOrig, opaqueOld);
  assert.strictEqual(current.__rdOpaqueLegacy, true);
  assert.strictEqual(window.showView('patients'), 'base:patients');
  assert.deepStrictEqual(Array.from(window.__mlsViewHist.stack), ['visit'], 'one navigation produced duplicate history entries');
  assert.strictEqual(oldPushes, 0, 'opaque old history owner mutated the canonical stack');
  assert.strictEqual(baseCalls, 1, 'opaque forwarding bridge called host showView more than once');

  function title(view) { return current(view); }
  title.__rdTitleWrapped = true;
  title.__rdTitleOrig = current;
  title.__rdTitleVersion = '3.2.2';
  window.showView = title;
  context.restoreShowViewOwners();
  assert.strictEqual(window.showView, opaqueOld, 'revert did not remove both current redesign wrappers');
  assert.deepStrictEqual(
    { lock: window.__mlsViewHist.lock, cur: window.__mlsViewHist.cur, owner: window.__mlsViewHist.owner },
    { lock: true, cur: '__pinned', owner: 'retired-legacy' },
    'opaque retired wrapper was left able to mutate history after revert'
  );
}

/* A metadata-bearing legacy wrapper is bypassed, never invoked as an inner
 * owner, and the current wrapper restores the real host on revert. */
{
  let baseCalls = 0, oldCalls = 0;
  const window = {};
  function base(view) { baseCalls++; return view; }
  function reversibleOld(view) { oldCalls++; return base(view); }
  reversibleOld.__rdHist = true;
  reversibleOld.__rdHistOrig = base;
  window.showView = reversibleOld;
  const context = {
    window,
    VERSION: '3.2.2',
    _opaqueLegacyHistory: null,
    _historyWrapper: null,
    _historyOriginal: null,
    _historyBeforeInstall: undefined,
    _historyBeforeInstallCaptured: false,
    _historyBeforeInstallHadOwn: false,
    Object,
    Array,
    syncBackButton() {}
  };
  vm.createContext(context);
  vm.runInContext([
    functionBlock('chainHasCurrentHistory'),
    functionBlock('ensureHistoryOwner'),
    functionBlock('restoreShowViewOwners'),
    'this.ensureHistoryOwner=ensureHistoryOwner;this.restoreShowViewOwners=restoreShowViewOwners;'
  ].join('\n'), context);
  context.ensureHistoryOwner();
  window.showView('calendar');
  assert.strictEqual(oldCalls, 0, 'reversible old history wrapper remained nested');
  assert.strictEqual(baseCalls, 1);
  context.restoreShowViewOwners();
  assert.strictEqual(window.showView, base, 'revert did not restore the original host showView');
  assert.strictEqual(Object.prototype.hasOwnProperty.call(window, '__mlsViewHist'), false, 'revert left current history state behind');
}

console.log('PASS redesign hot upgrade: 3.2.1 nodes/wrappers retire and 3.2.2 records one reversible history owner');
