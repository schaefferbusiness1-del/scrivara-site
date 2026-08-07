'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(source, startText, endText) {
  const start = source.indexOf(startText);
  assert(start >= 0, `missing start marker: ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert(end > start, `missing end marker: ${endText}`);
  return source.slice(start, end);
}

function extractIife(source, marker) {
  const markerAt = source.indexOf(marker);
  assert(markerAt >= 0, `missing IIFE marker: ${marker}`);
  const start = source.indexOf('(function ()', markerAt);
  const end = source.indexOf('\n})();', start);
  assert(start >= 0 && end > start, `missing IIFE after: ${marker}`);
  return source.slice(start, end + '\n})();'.length);
}

const scheduleHandler = between(
  background,
  "if (msg.type === 'mlsAppScheduleRequest')",
  '// READ-ONLY: read the open Athena REPORT'
);
const searchIife = extractIife(background, '/* === MLS Assist v1.36');
const searchHandler = between(
  background,
  "if (msg.type === 'mlsAppSearchOpenRequest')",
  '// not ours'
);

/* One frozen absolute scrape guard is passed to every frame and the injected
   reader clamps to that value. The removed 12s floor was the overrun bug. */
assert(scheduleHandler.includes('var __scrapeGuard = Object.freeze({ token: __schedGuard.token, deadline: Math.min(__schedGuard.deadline'));
assert(scheduleHandler.includes('args: [ __schedCfgArg, __scrapeGuard ]'));
assert(scheduleHandler.includes('func: async (CFG, READ_GUARD)'));
assert(scheduleHandler.includes('async function mlsSchedDomInline(doc, CFG)'));
assert(scheduleHandler.includes('var ACTION_GUARD=arguments.length>2?arguments[2]:null'));
assert(scheduleHandler.includes('__scheduleSweepDeadline=Math.min(__scheduleSweepDeadline,__scheduleGuard.deadline)'));
assert(!scheduleHandler.includes('Math.max(12000,Math.min(45000'), 'short remaining schedule budget is still expanded to 12 seconds');
assert(scheduleHandler.includes('if(!(await _sleepS(_settleBaseS))){_finishedS=false;break;}'));
assert(scheduleHandler.includes('if(__scheduleActionAllowed()){_vsS.scrollTop=_voyS'));
assert(scheduleHandler.includes('if(__scheduleActionAllowed()){_scS.scrollLeft=_ogS'));

/* SearchOpen is Athena-only. It must not use the old local generic/HTTP picker
   after the verified athenaOnly picker refuses the current tabs. */
assert(!searchHandler.includes('picked.value || pickEmrTab(all)'));
assert(searchHandler.includes('var tab = picked.value || null'));
assert(searchHandler.includes("reason: 'no-athena-tab'"));
assert(searchHandler.includes('var __searchExactAthena = !!tab'));

class FakeEvent {
  constructor(type, init) { this.type = type; this.bubbles = !!(init && init.bubbles); }
}

async function testExpiredReaderTouchesNothing() {
  const nameStart = background.indexOf('function mlsParseName(raw)');
  const readerStart = background.indexOf('async function mlsSchedDomInline(doc, CFG)', nameStart);
  const readerEnd = background.indexOf('\n if (/stm\\.esp|', readerStart);
  assert(nameStart >= 0 && readerStart > nameStart && readerEnd > readerStart, 'could not extract guarded packaged schedule reader');
  const runtime = vm.runInNewContext(
    background.slice(nameStart, readerEnd) + '\n({ mlsParseName, mlsSchedDomInline });',
    { setTimeout, clearTimeout, Promise, Date, Number, String, Object, Array, RegExp, Event: FakeEvent },
    { filename: 'guarded-schedule-reader.js', timeout: 2000 }
  );
  let touches = 0;
  const forbiddenDoc = new Proxy({}, { get() { touches++; throw new Error('expired reader touched the DOM'); } });
  const result = await runtime.mlsSchedDomInline(forbiddenDoc, { __maxSweepMs: 30000 }, {
    token: 'expired-schedule-scrape', deadline: Date.now() - 1
  });
  assert.strictEqual(result.diag.reason, 'schedule-request-timeout');
  assert.strictEqual(result.diag.requestToken, 'expired-schedule-scrape');
  assert.strictEqual(touches, 0, 'expired schedule scrape touched the renderer');
}

function makeSearchRuntime(pickValue) {
  const listeners = [], responses = [], injections = [];
  const context = {
    console, Promise, Date, Math, Number, String, Object, Array, RegExp, JSON,
    setTimeout, clearTimeout, setInterval, clearInterval,
    __mlsReadsSinceReload: 0,
    mlsSleepW: ms => new Promise(resolve => setTimeout(resolve, ms)),
    mlsRecoverAthenaTab: async () => ({ ok: true }),
    mlsPickAthenaTab: async () => pickValue,
    self: null,
    chrome: {
      runtime: { id: 'mls-test-extension', /* csr-1.x orphan guards treat an id-less runtime as a dead context */ onMessage: { addListener(fn) { listeners.push(fn); } } },
      tabs: {
        query: async () => [{ id: 91, active: true, url: 'https://example.com/unrelated-chart' }],
        sendMessage() {}
      },
      scripting: {
        executeScript(opts) { injections.push(opts); return Promise.resolve([]); }
      }
    }
  };
  context.self = context;
  context.mlsExecTO = async opts => ({ r: await context.chrome.scripting.executeScript(opts) });
  vm.runInNewContext(searchIife, context, { filename: 'search-open-fail-closed.js', timeout: 2000 });
  return { listener: listeners[0], responses, injections };
}

async function runSearch(runtime, requestId) {
  assert(runtime.listener, 'SearchOpen listener was not installed');
  return new Promise(resolve => {
    runtime.listener(
      { type: 'mlsAppSearchOpenRequest', requestId, deadlineAt: Date.now() + 1000, name: 'Exact Patient', dob: '01/02/1960', noReload: true },
      { tab: { id: 4 } },
      value => { runtime.responses.push(value); resolve(value); }
    );
  });
}

async function testSearchOpenFailsClosed() {
  for (const [label, pickValue] of [
    ['null Athena pick', null],
    ['generic picker catch result', { id: 91, active: true, url: 'https://example.com/unrelated-chart' }]
  ]) {
    const runtime = makeSearchRuntime(pickValue);
    const result = await runSearch(runtime, 'fail-closed-' + label.replace(/\s+/g, '-'));
    assert.strictEqual(result.ok, false, label);
    assert.strictEqual(result.reason, 'no-athena-tab', label);
    assert.strictEqual(runtime.responses.length, 1, `${label} emitted more than one response`);
    assert.strictEqual(runtime.injections.length, 0, `${label} injected into an unrelated tab`);
  }
}

(async () => {
  await testExpiredReaderTouchesNothing();
  await testSearchOpenFailsClosed();
  console.log('PASS schedule scrape absolute guard and SearchOpen Athena-only fail-closed selection');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
