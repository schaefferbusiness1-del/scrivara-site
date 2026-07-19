'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'mls-connect.js'), 'utf8');

function retirementCode(headerNeedle, returnNeedle) {
  const header = source.indexOf(headerNeedle);
  const start = source.indexOf('(function () {', header);
  const receipt = source.indexOf("version: 'retired-b432'", start);
  const ret = source.indexOf(returnNeedle, receipt);
  assert(header >= 0 && start > header && receipt > start && ret > receipt, `${headerNeedle} retirement prefix missing`);
  return source.slice(start, ret + returnNeedle.length) + '\n})();';
}

function executeRetirement(headerNeedle, returnNeedle, suppliedContext) {
  const code = retirementCode(headerNeedle, returnNeedle);
  const context = suppliedContext || { window: {}, Object };
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

const retiredFlowContext = executeRetirement(' * __mlsEz3Flow', '  return;');
const retiredFlow = retiredFlowContext.window;
assert(retiredFlow.__mlsEz3Flow && retiredFlow.__mlsEz3Flow.retired === true,
  'duplicate visit flow did not retire at runtime');
assert.strictEqual(retiredFlow.__mlsEz3Flow.installed, false, 'retired visit flow still claims installation');

const monthContext = executeRetirement(' * MLS Scribe - ONE MONTH PULL', '  return;');
assert(monthContext.window.__mlsMonthPullOne && monthContext.window.__mlsMonthPullOne.retired === true,
  'duplicate Staff Prep month-pull UI did not retire at runtime');
assert.strictEqual(monthContext.window.__mlsMonthPullOne.owner, 'ez3PullStart');

function removable(id, registry) {
  const node = {
    id,
    removed: false,
    remove() { this.removed = true; if (registry) registry.delete(id); }
  };
  if (registry) registry.set(id, node);
  return node;
}

function fakeDocument(ids) {
  const registry = new Map();
  (ids || []).forEach(id => removable(id, registry));
  const appended = [];
  const head = {
    appendChild(node) { appended.push(node); if (node.id) registry.set(node.id, node); return node; }
  };
  return {
    registry,
    appended,
    head,
    documentElement: head,
    body: { classList: { remove() {} } },
    getElementById(id) { return registry.get(id) || null; },
    createElement(tagName) { return { tagName, id: '', textContent: '', remove() { if (this.id) registry.delete(this.id); } }; },
    querySelectorAll() { return []; }
  };
}

// Hot-loading b432 over b431 must actively tear down the old visit-flow owner.
let flowReverts = 0;
const staleFlowNodes = [removable('old-flow-a'), removable('old-flow-b')];
const flowDocument = fakeDocument();
flowDocument.querySelectorAll = () => staleFlowNodes;
const hotFlowContext = {
  Object,
  document: flowDocument,
  window: { __mlsEz3Flow: { installed: true, version: 'fl-1.7.0', revert() { flowReverts++; } } }
};
executeRetirement(' * __mlsEz3Flow', '  return;', hotFlowContext);
assert.strictEqual(flowReverts, 1, 'hot upgrade did not revert the previously loaded visit-flow owner');
assert(staleFlowNodes.every(node => node.removed), 'hot upgrade left stale duplicate visit controls mounted');
assert.strictEqual(hotFlowContext.window.__mlsEz3Flow.retired, true, 'hot upgrade did not replace visit owner with retirement receipt');
vm.runInContext(retirementCode(' * __mlsEz3Flow', '  return;'), hotFlowContext);
assert.strictEqual(flowReverts, 1, 'idempotent retirement reverted an already retired visit owner');

// Month-pull b431 exposed teardown through a global fallback, not api.revert().
let monthReverts = 0;
const monthDocument = fakeDocument(['mlsMpoBtn', 'mlsMpoNote', 'mlsMpoCss', 'mlsPmpBtn', 'mlsPmpPanel', 'mlsPmpCss']);
const hotMonthContext = {
  Object,
  document: monthDocument,
  window: {
    __mlsMonthPullOne: { installed: true, version: '1.0.0' },
    __mlsMonthPullOne_revert() { monthReverts++; }
  }
};
executeRetirement(' * MLS Scribe - ONE MONTH PULL', '  return;', hotMonthContext);
assert.strictEqual(monthReverts, 1, 'hot upgrade did not call the legacy month-pull teardown hook');
assert.strictEqual(hotMonthContext.window.__mlsMonthPullOne.retired, true, 'hot upgrade did not replace month owner with retirement receipt');
assert.strictEqual(hotMonthContext.window.__mlsMonthPullOne_revert, undefined, 'stale month-pull teardown hook survived retirement');
['mlsMpoBtn', 'mlsMpoNote', 'mlsMpoCss', 'mlsPmpBtn', 'mlsPmpPanel', 'mlsPmpCss'].forEach(id => {
  assert(!monthDocument.registry.has(id), `legacy Staff Prep node ${id} survived retirement`);
});
assert.match(monthDocument.registry.get('mlsStaffPrepOwnerCss').textContent,
  /#mlsPmpBtn,#mlsPmpPanel,#mlsMpoBtn,#mlsMpoNote\{display:none!important\}/,
  'static suppression for a legacy remounter is missing');
vm.runInContext(retirementCode(' * MLS Scribe - ONE MONTH PULL', '  return;'), hotMonthContext);
assert.strictEqual(monthReverts, 1, 'idempotent retirement called the legacy month teardown twice');

// Keep the provider/month compatibility engine, but it may not own any UI/timer.
const providerHeader = source.indexOf(' * MLS Scribe - CROSS-PROVIDER MONTH PULL');
const providerStart = source.indexOf('(function () {', providerHeader);
const providerNext = source.indexOf(' * MLS Scribe - COPILOT TRUTH GATE', providerStart);
const providerEnd = source.lastIndexOf('})();', providerNext) + '})();'.length;
assert(providerHeader >= 0 && providerStart > providerHeader && providerNext > providerStart && providerEnd > providerStart,
  'provider/month compatibility engine missing');
const providerCode = source.slice(providerStart, providerEnd);
assert(!providerCode.includes('setInterval(mountBtn'), 'retired provider/month floating button still has a remount timer');
assert(!providerCode.includes('function mountBtn'), 'retired provider/month floating button still has a mount owner');
let providerReverts = 0;
let providerIntervals = 0;
const providerDocument = fakeDocument(['mlsPmpBtn', 'mlsPmpPanel', 'mlsPmpCss']);
const basePost = function () {};
const providerContext = {
  Object,
  document: providerDocument,
  window: {
    postMessage: basePost,
    addEventListener() {},
    removeEventListener() {},
    __mlsProvMonthPull: { version: '1.1.1' },
    __mlsProvMonthPull_revert() { providerReverts++; delete this.__mlsProvMonthPull; }
  },
  URL: { createObjectURL() { return null; } },
  Blob: function Blob() {},
  setInterval() { providerIntervals++; return 1; },
  clearInterval() {},
  setTimeout() {},
  console: { log() {} }
};
vm.createContext(providerContext);
vm.runInContext(providerCode, providerContext);
assert.strictEqual(providerReverts, 1, 'provider/month hot upgrade did not stop the legacy UI owner');
assert.strictEqual(providerIntervals, 0, 'provider/month compatibility engine started a UI timer');
assert.strictEqual(providerContext.window.__mlsProvMonthPull.uiRetired, true, 'provider/month engine does not report retired UI ownership');
assert.strictEqual(providerContext.window.__mlsProvMonthPull.uiOwner, 'ez3PullStart');
['run', 'rosterFor', 'providersFor'].forEach(method => {
  assert.strictEqual(typeof providerContext.window.__mlsProvMonthPull[method], 'function', `provider compatibility method ${method} was removed`);
});
const providerApi = providerContext.window.__mlsProvMonthPull;
vm.runInContext(providerCode, providerContext);
assert.strictEqual(providerReverts, 1, 'idempotent provider load reverted the retired owner twice');
assert.strictEqual(providerContext.window.__mlsProvMonthPull, providerApi, 'idempotent provider load replaced the live compatibility engine');

const canonicalMonthStart = source.indexOf('  function startMonthPull(retryOnly, rosterRetried) {');
const canonicalMonth = source.slice(canonicalMonthStart, source.indexOf('  function renderStaff()', canonicalMonthStart));
assert(canonicalMonthStart >= 0, 'active canonical Staff Prep month engine missing');
assert(canonicalMonth.includes('includeHistory: true'), 'canonical Staff Prep month pull lost full-history loading');
assert(source.includes('id="ez3PullStart"'), 'canonical Staff Prep month-pull control missing');
assert(source.includes("window.addEventListener('mls:menu-staff-prep-request'"), 'Menu-only Staff Prep entry point missing');

console.log('PASS single UI owners: canonical visit transcript and exact Staff Prep month/history pull only');
