'use strict';

/* AVS ACTION-TIME READINESS
 *
 * The patient-facing AVS is intentionally a late satellite. That is safe only
 * while its action surfaces ask the loader to admit it and wait for evaluation;
 * a guessed 80/800 ms delay is a race against the browser, not readiness.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const bundles = ['mls-connect.js', '1p-mls-connect.js', 'cloned-mls-connect.js'];

for (const name of bundles) {
  const source = fs.readFileSync(path.join(root, name), 'utf8');
  assert.strictEqual(
    (source.match(/window\.__mlsEnsureAfterVisitSummary/g) || []).length >= 2,
    true,
    `${name}: AVS readiness API is missing from the loader/actions`
  );
  assert(source.includes("var A='feat_after_visit_summary.js',V='avs-loader-1.0.1'"),
    `${name}: AVS loader version marker is missing`);
  assert(source.includes("s.addEventListener('load',function(){settle(true);}"),
    `${name}: AVS loader does not wait for script evaluation`);
  assert(source.includes("s.addEventListener('error',function(){settle(false);}"),
    `${name}: AVS loader has no bounded failure path`);
  assert(source.includes('setTimeout(function(){settle(false);},10000)'),
    `${name}: AVS loader has no real bounded timeout`);
  assert(!/setTimeout\([^\n]*mlsavsBtn[^\n]*,\s*800\)/.test(source),
    `${name}: an AVS trigger still uses the old 800 ms guess`);
  assert(!/same 800ms/.test(source),
    `${name}: AVS action documentation still promises a fixed 800 ms race`);
  assert((source.match(/afterVisitSummaryWhenReady\(/g) || []).length >= 3,
    `${name}: all three AVS action surfaces do not use readiness`);
}

/* The source module remains the sole AVS owner; this change belongs in the
 * connect-bundle admission layer and must not fork or edit the feature. */
const avs = fs.readFileSync(path.join(root, 'feat_after_visit_summary.js'), 'utf8');
assert(avs.includes("var VERSION = '1.1.1';"), 'the AVS owner is unexpectedly replaced');
const historyAvs = fs.readFileSync(path.join(root, 'feat_mls_history_avs.js'), 'utf8');
assert(historyAvs.includes('window.__mlsEnsureAfterVisitSummary') && historyAvs.includes('function triggerReady'),
  'History AVS action does not wait for the shared loader');
const tooltipAvs = fs.readFileSync(path.join(root, 'feat_athena_tooltip_dedupe.js'), 'utf8');
assert(tooltipAvs.includes('W.__mlsEnsureAfterVisitSummary') && tooltipAvs.includes('function openAfterVisitSummaryReady'),
  'tooltip AVS action does not wait for the shared loader');

function makeLoaderHarness() {
  const source = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
  const marker = source.indexOf("var A='feat_after_visit_summary.js',V='avs-loader-1.0.1'");
  const start = source.lastIndexOf(';(function(){try{', marker);
  const end = source.indexOf('/* ---- loader: feat_mls_protocol', start);
  assert(marker >= 0 && start >= 0 && end > start, 'could not isolate the AVS loader');
  const nodes = [];
  const timers = [];
  function script() {
    const attrs = Object.create(null), listeners = Object.create(null);
    return {
      tagName: 'SCRIPT', parentNode: null, readyState: 'loading',
      setAttribute(k, v) { attrs[k] = String(v); },
      getAttribute(k) { return attrs[k] || null; },
      addEventListener(k, fn) { (listeners[k] || (listeners[k] = [])).push(fn); },
      dispatch(k) { (listeners[k] || []).slice().forEach((fn) => fn()); },
      _attrs: attrs
    };
  }
  function attach(node, parent) {
    node.parentNode = parent;
    if (!nodes.includes(node)) nodes.push(node);
  }
  const parent = {
    appendChild(node) { attach(node, parent); return node; },
    removeChild(node) { const i = nodes.indexOf(node); if (i >= 0) nodes.splice(i, 1); node.parentNode = null; }
  };
  const document = {
    body: parent, head: parent, documentElement: parent,
    createElement: script,
    querySelector(sel) {
      if (sel.indexOf('data-mls-asset') < 0) return null;
      return nodes.find((n) => n.getAttribute('data-mls-asset') === 'feat_after_visit_summary.js') || null;
    }
  };
  const window = { __MLS_AV: 'test-build', __mlsDeferAsset() {} };
  const context = {
    window, document, Promise, Date,
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {}
  };
  vm.runInNewContext(source.slice(start, end), context, { filename: '1p-mls-connect.js#avs-loader' });
  return { window, nodes, timers };
}

(async function runtime() {
  const h = makeLoaderHarness();
  const first = h.window.__mlsEnsureAfterVisitSummary();
  const second = h.window.__mlsEnsureAfterVisitSummary();
  assert.strictEqual(first, second, 'concurrent AVS callers did not share one readiness promise');
  assert.strictEqual(h.nodes.length, 1, 'concurrent AVS callers appended duplicate scripts');
  const api = { installed: true, open() {} };
  h.window.__mlsAfterVisitSummary = api;
  h.nodes[0].dispatch('load');
  assert.strictEqual(await first, api, 'AVS readiness did not resolve after script evaluation');

  const evaluatedWithoutOwner = makeLoaderHarness();
  const missingApi = evaluatedWithoutOwner.window.__mlsEnsureAfterVisitSummary();
  evaluatedWithoutOwner.nodes[0].dispatch('load');
  await assert.rejects(missingApi, /failed to load/, 'evaluated AVS script without an installed owner did not fail immediately');
  assert.strictEqual(evaluatedWithoutOwner.nodes.length, 0, 'evaluated AVS script without an owner was left behind to poison retries');
  const missingApiRetry = evaluatedWithoutOwner.window.__mlsEnsureAfterVisitSummary();
  assert.strictEqual(evaluatedWithoutOwner.nodes.length, 1, 'owner-missing AVS retry did not append a fresh script');
  evaluatedWithoutOwner.timers[1]();
  await assert.rejects(missingApiRetry, /failed to load/);

  const timeout = makeLoaderHarness();
  const stalled = timeout.window.__mlsEnsureAfterVisitSummary();
  assert.strictEqual(timeout.timers.length, 1, 'AVS loader did not arm its bounded timeout');
  timeout.timers[0]();
  await assert.rejects(stalled, /failed to load/, 'stalled AVS load did not reject');
  assert.strictEqual(timeout.nodes.length, 0, 'failed AVS script was not removed for retry');
  const retry = timeout.window.__mlsEnsureAfterVisitSummary();
  assert.notStrictEqual(retry, stalled, 'failed AVS load did not permit a fresh retry');
  assert.strictEqual(timeout.nodes.length, 1, 'AVS retry did not append a fresh script');
  timeout.timers[1]();
  await assert.rejects(retry, /failed to load/);
  console.log('PASS AVS loader contract: production, P1, and cloned action paths use action-time readiness');
})().catch((error) => { console.error(error); process.exitCode = 1; });
