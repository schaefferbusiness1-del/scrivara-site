'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const app = fs.readFileSync(path.join(__dirname, '..', 'ScribeFlow.html'), 'utf8');
const start = app.indexOf('var sfGateLoadingStarted=0');
const end = app.indexOf('function sfShowGateLoading', start);
assert(start >= 0 && end > start, 'loader lifecycle source is missing');
const source = app.slice(start, end);

function harness(ready, assetsSettled = true) {
  let now = 0, seq = 0;
  const tasks = [];
  const rect = { x: 0, y: 0, width: 1000, height: 700 };
  let rectReads = 0;
  const node = { hidden: false, style: { display: '' }, className: '', textContent: '', value: '', getBoundingClientRect() { rectReads++; return rect; } };
  const ids = new Proxy({}, { get() { return node; } });
  const context = {
    Promise,
    Math,
    Date: { now() { return now; } },
    window: {
      __mlsUiBundleReady: !!ready,
      __mlsUiBundleFailed: false,
      __mlsUiUnification: ready ? { installed: true } : null,
      __mlsStartupAssets: { settled: !!assetsSettled }
    },
    document: { getElementById(id) { return ids[id]; } },
    setTimeout(fn, ms) { const id = ++seq; tasks.push({ id, at: now + ms, fn }); return id; },
    clearTimeout(id) { const i = tasks.findIndex(t => t.id === id); if (i >= 0) tasks.splice(i, 1); }
  };
  vm.createContext(context);
  vm.runInContext(source + '\nthis.api={wait:sfWaitForStableFirstFrame,setStart:function(v){sfGateLoadingStarted=v;},setToken:function(v){sfGateHideToken=v;}};', context);
  async function advance(target) {
    while (true) {
      tasks.sort((a, b) => a.at - b.at || a.id - b.id);
      const task = tasks[0];
      if (!task || task.at > target) break;
      tasks.shift(); now = task.at; task.fn();
      await Promise.resolve();
    }
    now = target; await Promise.resolve();
  }
  return { context, advance, now: () => now, rectReads: () => rectReads, settleAssets() { context.window.__mlsStartupAssets.settled = true; } };
}

(async function () {
  const fast = harness(true);
  fast.context.api.setStart(0); fast.context.api.setToken(1);
  let fastResult = 'pending';
  fast.context.api.wait(1, false).then(v => { fastResult = v; });
  await fast.advance(4499);
  assert.strictEqual(fastResult, 'pending', 'ready UI revealed before the 4.5-second minimum');
  await fast.advance(4620);
  assert.strictEqual(fastResult, true, 'stable ready UI did not release at the minimum');

  const deferred = harness(true, false);
  deferred.context.api.setStart(0); deferred.context.api.setToken(5);
  let deferredResult = 'pending';
  deferred.context.api.wait(5, false).then(v => { deferredResult = v; });
  await deferred.advance(3000);
  assert.strictEqual(deferredResult, 'pending', 'unsettled critical assets incorrectly released the loader');
  assert.strictEqual(deferred.rectReads(), 0, 'loader forced layout while critical assets were still invalidating the page');
  deferred.settleAssets();
  await deferred.advance(4700);
  assert(deferred.rectReads() > 0, 'loader never sampled layout after the critical asset wave settled');
  assert.strictEqual(deferredResult, true, 'settled critical assets did not enter stable-frame release');

  const capped = harness(false);
  capped.context.api.setStart(0); capped.context.api.setToken(7);
  let cappedResult = 'pending';
  capped.context.api.wait(7, false).then(v => { cappedResult = v; });
  await capped.advance(31839);
  assert.strictEqual(cappedResult, 'pending', 'unready UI released before the bounded deadline');
  await capped.advance(31860);
  assert.strictEqual(cappedResult, true, 'failed optional readiness did not reach the absolute release path');

  const stale = harness(true);
  stale.context.api.setStart(0); stale.context.api.setToken(3);
  let staleResult = 'pending';
  stale.context.api.wait(3, false).then(v => { staleResult = v; });
  stale.context.api.setToken(4);
  await stale.advance(140);
  assert.strictEqual(staleResult, false, 'a stale hide request can clear a newer loading owner');

  console.log('PASS loader lifecycle: 4.5s minimum, deferred layout sampling, 32s bounded reveal, and stale-token safety');
})().catch(err => { console.error(err); process.exit(1); });
