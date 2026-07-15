'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function extractIife(source, marker) {
  const markerAt = source.indexOf(marker);
  assert(markerAt >= 0, `missing IIFE marker: ${marker}`);
  const start = source.indexOf('(function ()', markerAt);
  const end = source.indexOf('\n})();', start);
  assert(start >= 0 && end > start, `missing IIFE after: ${marker}`);
  return source.slice(start, end + '\n})();'.length);
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function deadlineTimer(fn, ms) {
  const timer = setTimeout(fn, ms);
  if (Number(ms) >= 1000 && timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}
function heartbeatTimer(fn, ms) {
  const timer = setInterval(fn, ms);
  if (timer && typeof timer.unref === 'function') timer.unref();
  return timer;
}

const visitIife = extractIife(background, '/* === MLS Assist visit-reader lineage (active: v2.9.22 r4)');
const handlerStart = visitIife.indexOf('var activeAllVisitsPromise = null;');
const handlerEnd = visitIife.indexOf('// --- v1.40: publish the PROVEN read-all-visits engine', handlerStart);
assert(handlerStart >= 0 && handlerEnd > handlerStart, 'AllVisits request handler could not be isolated');
const handler = visitIife.slice(handlerStart, handlerEnd);

assert(visitIife.includes('var visitCleanupTail = Promise.resolve();'), 'AllVisits lacks a serialized cleanup queue');
assert(visitIife.includes('function waitForVisitCleanup(callerDeadlineAt)'), 'AllVisits lacks a bounded cleanup barrier');
assert(handler.indexOf('waitForVisitCleanup(msg.deadlineAt)') < handler.indexOf('runAllVisits(appTabId'), 'next AllVisits read starts before the prior cleanup barrier');
assert(handler.indexOf('sendResponse(value);') < handler.indexOf('thisRead.__mlsAfterResponseCleanup()'), 'the completed read waits for cleanup before responding');

function createRuntime() {
  const listeners = [];
  const responses = [];
  const events = [];
  let pickCalls = 0;
  let ensureCalls = 0;
  let releaseCalls = 0;
  let resolveFirstRelease = null;

  const timedSource = visitIife.replace(
    'Math.max(30000, Math.min(180000, Number(cfg.maxReadMs || 165000)))',
    'Math.max(45, Math.min(180000, Number(cfg.maxReadMs || 165000)))'
  );
  assert.notStrictEqual(timedSource, visitIife, 'test could not narrow the production reader deadline');

  const context = {
    console, Promise, Date, Math, Number, String, Object, Array, RegExp, JSON, Map, WeakMap,
    setTimeout: deadlineTimer, clearTimeout, setInterval: heartbeatTimer, clearInterval,
    mlsReadChartIdentity: function () {}, mlsReadChartIdentityShadow: function () {},
    self: null,
    chrome: {
      runtime: { onMessage: { addListener: fn => listeners.push(fn) } },
      tabs: {
        query: (_query, callback) => {
          pickCalls++;
          events.push(`pick-${pickCalls}`);
          callback([{ id: 77, active: false, url: 'https://athenanet.athenahealth.com/chart' }]);
        },
        sendMessage() {}
      },
      storage: {
        local: {
          get: (_keys, callback) => callback({ mlsAthenaVisitsCfg: { maxReadMs: 45, visitTabWaitMs: 1, initialWaitMs: 1, maxVisits: 50, minRealLen: 60 } }),
          set() {}
        }
      },
      webNavigation: { getAllFrames: () => new Promise(() => {}) },
      scripting: { executeScript: () => new Promise(() => {}) }
    }
  };
  context.self = context;
  context.__mlsVerifiedReadTarget = { name: 'Exact Patient', dob: '01/02/1960', mrn: '1234', tabId: 77, at: Date.now() };
  context.__mlsQpEnsure = function () {
    ensureCalls++;
    events.push(`ensure-${ensureCalls}`);
    context.__mlsQp = { active: true, athenaTabId: 77 };
    return Promise.resolve({ ok: true });
  };
  context.__mlsQpRelease = function () {
    releaseCalls++;
    const call = releaseCalls;
    events.push(`release-start-${call}`);
    if (call === 1) {
      return new Promise(resolve => {
        resolveFirstRelease = function () {
          context.__mlsQp = { active: false, athenaTabId: null };
          events.push('release-complete-1');
          resolve({ ok: true });
        };
      });
    }
    context.__mlsQp = { active: false, athenaTabId: null };
    events.push(`release-complete-${call}`);
    return Promise.resolve({ ok: true });
  };

  vm.runInNewContext(timedSource, context, { filename: 'all-visits-cleanup-serialization.js', timeout: 1000 });

  function send(requestId, onResponse) {
    const listener = listeners[0];
    assert(listener, 'AllVisits listener was not installed');
    listener(
      { type: 'mlsAppAllVisitsRequest', requestId, hint: { name: 'Exact Patient', dob: '01/02/1960', mrn: '1234' } },
      { tab: { id: 4 } },
      value => { responses.push(value); onResponse(value); }
    );
  }
  return {
    events, responses, send,
    pickCalls: () => pickCalls,
    ensureCalls: () => ensureCalls,
    releaseCalls: () => releaseCalls,
    resolveFirstRelease: () => resolveFirstRelease
  };
}

async function waitUntil(fn, message) {
  const stop = Date.now() + 600;
  while (Date.now() < stop) {
    const value = fn();
    if (value) return value;
    await delay(5);
  }
  throw new Error(message);
}

(async () => {
  const runtime = createRuntime();
  let first = null;
  let second = null;
  let resolveSecond;
  const secondDone = new Promise(resolve => { resolveSecond = resolve; });

  await new Promise(resolveFirst => {
    runtime.send('cleanup-first', value => {
      first = value;
      runtime.events.push('response-1');
      /* Re-enter synchronously, exactly in the old race window. */
      runtime.send('cleanup-second', value2 => {
        second = value2;
        runtime.events.push('response-2');
        resolveSecond();
      });
      resolveFirst();
    });
  });

  assert.strictEqual(first.reason, 'read-deadline-exceeded');
  const release = await waitUntil(runtime.resolveFirstRelease, 'detached cleanup never started');
  assert.strictEqual(runtime.pickCalls(), 1, 'second read selected an Athena tab before prior cleanup was visible');
  assert.strictEqual(runtime.ensureCalls(), 1, 'second read entered quiet-work setup before prior cleanup was visible');
  await delay(25);
  assert.strictEqual(runtime.pickCalls(), 1, 'second read selected an Athena tab while prior qpRelease was pending');
  assert.strictEqual(runtime.ensureCalls(), 1, 'second read raced the still-pending prior qpRelease');
  assert.strictEqual(second, null, 'second read responded before the bounded cleanup barrier settled');

  release();
  await Promise.race([secondDone, delay(1000).then(() => { throw new Error('second AllVisits request never completed after cleanup'); })]);

  assert.strictEqual(second.reason, 'read-deadline-exceeded');
  assert.strictEqual(runtime.pickCalls(), 2, 'second read did not start after cleanup completed: ' + JSON.stringify({ events: runtime.events, second }));
  assert(runtime.events.indexOf('response-1') < runtime.events.indexOf('release-complete-1'), 'prior response waited for cleanup completion');
  assert(runtime.events.indexOf('release-complete-1') < runtime.events.indexOf('pick-2'), 'second Athena read began before prior release completed');
  assert.notStrictEqual(second.reason, 'busy', 'cleanup coordination leaked the AllVisits single-flight lock');

  console.log('PASS AllVisits responds before cleanup and serializes the next read behind prior qpRelease');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
