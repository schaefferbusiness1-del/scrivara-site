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

/* b435: the contract is ONE transcript lane - not ZERO.
 *
 * b432 enforced "single transcript" by retiring __mlsEz3Flow outright, on the
 * theory that MLS Easy v3.7+ had taken over the doctor room. It had not: with
 * the flow retired the visit screen rendered with NO transcript box and no
 * quick-action lane at all, so the only way to type was the "Advanced visit
 * workspace" button. Zero lanes satisfied the old assertion and broke the
 * product. Pin the real invariant instead - the flow is ACTIVE, and it is
 * structurally incapable of leaving a second lane behind. */
const flowStart = source.indexOf(' * __mlsEz3Flow');
const flowIife = source.indexOf('(function () {', flowStart);
assert(flowStart >= 0 && flowIife > flowStart, 'the Easy visit-flow owner is missing');

const flowBody = source.slice(flowIife, flowIife + 60000);
assert(/var VERSION = 'fl-1\.7\.\d+'/.test(flowBody),
  'the Easy visit-flow owner is not active (expected a live fl-1.7.x VERSION)');
assert(!flowBody.includes("version: 'retired-b432'"),
  'the Easy visit-flow owner is retired again - the visit screen loses its transcript box');

/* The anti-duplication guard that makes "exactly one" true: adopt the already
 * mounted lane, and actively remove any accidental extras. */
assert(flowBody.includes("var mountedLanes = body.querySelectorAll('.ez3fl-record');"),
  'single-lane adoption query missing');
assert(/if \(mountedLanes\[laneIndex\] !== mountedLane\) mountedLanes\[laneIndex\]\.remove\(\);/.test(flowBody),
  'the flow no longer removes duplicate transcript lanes - a second lane could reappear');
assert(flowBody.includes('if (!mountedLane) {'),
  'the flow no longer creates the lane only when it is truly absent');
assert(flowBody.includes("var tx = document.getElementById('ez3flTranscript')") ||
  flowBody.includes("id=\"ez3flTranscript\""),
  'the flow no longer owns the #ez3flTranscript node');

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

/* Hot-loading a newer visit-flow owner over an older one must still tear the
 * old one down, so a reload cannot leave two observer/timer owners running.
 * b435 keeps that teardown but no longer follows it with an early return, so
 * execute only the module preamble (up to its VERSION line) rather than the
 * whole implementation, which needs real timers and a live DOM. */
function flowPreamble() {
  const header = source.indexOf(' * __mlsEz3Flow');
  const start = source.indexOf('(function () {', header);
  const version = source.indexOf("var VERSION = 'fl-1.7", start);
  assert(header >= 0 && start > header && version > start, 'visit-flow preamble missing');
  return source.slice(start, version) + '\n})();';
}

let flowReverts = 0;
const staleFlowNodes = [removable('old-flow-a'), removable('old-flow-b')];
const flowDocument = fakeDocument();
flowDocument.querySelectorAll = () => staleFlowNodes;
const hotFlowContext = {
  Object,
  document: flowDocument,
  window: { __mlsEz3Flow: { installed: true, version: 'fl-1.7.0', revert() { flowReverts++; } } }
};
vm.createContext(hotFlowContext);
vm.runInContext(flowPreamble(), hotFlowContext);
assert.strictEqual(flowReverts, 1, 'hot upgrade did not revert the previously loaded visit-flow owner');

// A retired receipt from an older build must not be reverted a second time.
const retiredCarryContext = {
  Object,
  document: fakeDocument(),
  window: { __mlsEz3Flow: { installed: false, retired: true, version: 'retired-b432', revert() { flowReverts++; } } }
};
vm.createContext(retiredCarryContext);
vm.runInContext(flowPreamble(), retiredCarryContext);
assert.strictEqual(flowReverts, 1, 'idempotent load reverted an already retired visit owner');

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
