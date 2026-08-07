'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function sliceBetween(source, startText, endText) {
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
const visitDriver = sliceBetween(
  visitIife,
  'function mlsVisitsDriverFn(op, cfg, idx, expectedBinding)',
  '// ---- orchestrator (background scope'
);
const searchIife = extractIife(background, '/* === MLS Assist v1.36');
const searchDriver = sliceBetween(
  searchIife,
  'async function mlsSearchOpenDriverFn(name, phase',
  'function bestFrameResult(results, key)'
);
const findDriver = sliceBetween(
  searchIife,
  'async function mlsFindPatientOpenDriverFn(name, dob, requestGuard, mrn)',
  'chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse)'
);
const searchHandler = sliceBetween(
  searchIife,
  "if (msg.type === 'mlsAppSearchOpenRequest')",
  '// not ours'
);

/* Contract checks catch a future route accidentally bypassing the immutable
   request deadline even if that route is hard to reach in a DOM fixture. */
assert(searchHandler.includes('openDeadline = Math.min(openDeadline, callerDeadline)'), 'SearchOpen does not clamp to the caller deadline');
assert(searchHandler.includes("reason: 'open-deadline-exceeded'"), 'SearchOpen lost its one terminal deadline reason');
assert(searchHandler.includes("args: [msg.name || '', 'open', openGuard, frozenApptId, bootstrapIdentity]"), 'exact schedule-row injection lost the immutable appointment/bootstrap guard');
assert(searchHandler.includes("args: [msg.name || '', 'fill', openGuard]"), 'legacy fill injection lost the immutable guard');
assert(searchHandler.includes('findGuard, frozenMrn], func: mlsFindPatientOpenDriverFn'), 'find-patient injection lost the immutable guard');
assert(!searchHandler.includes('chrome.scripting.executeScript'), 'SearchOpen still contains a raw unbounded injection');
assert(!searchHandler.includes('settleOpen(mlsRecoverAthenaTab('), 'SearchOpen recovery is wrapped twice and can outlive its deadline');
assert(searchHandler.indexOf('if (responseSent) return;') < searchHandler.indexOf('var order = bootstrapIdentity'), 'SearchOpen can continue to a click route after a terminal recovery response');

assert(visitIife.includes("fireVisitCleanup('all-visits-ensure-timeout', true)"), 'quiet-work ensure timeout lacks immediate cleanup');
assert(visitIife.includes("qpEnsurePromise.finally(function () { fireVisitCleanup('all-visits-late-ensure', true); })"), 'quiet-work ensure timeout lacks a late-settlement cleanup backstop');
assert(visitIife.indexOf("fireVisitCleanup('all-visits-ensure-timeout')") < visitIife.indexOf('qpEnsurePromise.finally'), 'late cleanup is incorrectly the only cleanup');
assert(visitIife.indexOf('activeAllVisitsPromise = null;') < visitIife.indexOf('sendResponse(value);'), 'AllVisits keeps the single-flight lock while responding');
assert(!visitIife.includes('await self.__mlsQpRelease'), 'AllVisits still awaits response cleanup');
assert(visitIife.includes('settleVisitOp(chrome.webNavigation.getAllFrames'), 'visit frame discovery is not deadline-bounded');
assert(visitIife.includes('return settleVisitOp(execPromise, hardDeadline)'), 'visit executeScript is not deadline-bounded');
assert(visitIife.includes('readDeadline = Math.min(readDeadline, frozenCallerDeadline)'), 'AllVisits does not clamp its action guard to the caller deadline');
assert(visitIife.includes('transportRequestId, msg.deadlineAt)'), 'AllVisits handler did not forward the caller deadline into the reader');

async function testExpiredInjectedDriversAreZeroAction() {
  let visitClicks = 0;
  const tab = {
    className: '',
    getBoundingClientRect: () => ({ width: 30, height: 20 }),
    click: () => { visitClicks++; }
  };
  const icon = { closest: () => tab };
  const visitContext = {
    Date, Math, Number, String, Object, Array, RegExp, Map,
    document: { querySelectorAll: () => [icon], querySelector: () => null, body: {} },
    window: {}
  };
  vm.runInNewContext(visitDriver, visitContext, { filename: 'expired-visit-driver.js', timeout: 1000 });
  const visitResult = visitContext.mlsVisitsDriverFn('openVisits', {
    __readDeadline: Date.now() - 1,
    __requestToken: 'expired-visit'
  });
  assert.strictEqual(visitResult.reason, 'read-deadline-exceeded');
  assert.strictEqual(visitClicks, 0, 'a late visit injection clicked the Visits tab');

  let touched = 0;
  const forbiddenDocument = new Proxy({}, { get() { touched++; throw new Error('late driver touched the DOM'); } });
  const searchContext = {
    Date, Math, Number, String, Object, Array, RegExp, Promise,
    setTimeout, clearTimeout,
    document: forbiddenDocument,
    location: new Proxy({}, { get() { touched++; throw new Error('late driver read location'); } }),
    window: {}
  };
  vm.runInNewContext(searchDriver, searchContext, { filename: 'expired-search-driver.js', timeout: 1000 });
  const scheduleResult = await searchContext.mlsSearchOpenDriverFn('Exact Patient', 'open', {
    deadline: Date.now() - 1,
    token: 'expired-open'
  });
  assert.strictEqual(scheduleResult.reason, 'open-deadline-exceeded');

  vm.runInNewContext(findDriver, searchContext, { filename: 'expired-find-driver.js', timeout: 1000 });
  const findResult = await searchContext.mlsFindPatientOpenDriverFn('Exact Patient', '01/02/1960', {
    deadline: Date.now() - 1,
    token: 'expired-open'
  }, '12345');
  assert.strictEqual(findResult.reason, 'open-deadline-exceeded');
  assert.strictEqual(touched, 0, 'a late SearchOpen injection touched the page after expiry');
}

async function testNeverSettlingSearchOpen() {
  const listeners = [], responses = [], injections = [];
  let resolveLateInjection;
  const lateInjection = new Promise(resolve => { resolveLateInjection = resolve; });
  const context = {
    console, Promise, Date, Math, Number, String, Object, Array, RegExp, JSON,
    setTimeout: deadlineTimer, clearTimeout, setInterval: heartbeatTimer, clearInterval,
    __mlsReadsSinceReload: 0,
    mlsSleepW: ms => new Promise(resolve => deadlineTimer(resolve, ms)),
    mlsRecoverAthenaTab: async () => ({ ok: true }),
    mlsPickAthenaTab: async tabs => tabs[0] || null,
    self: null,
    chrome: {
      runtime: { id: 'mls-test-extension', /* csr-1.x orphan guards treat an id-less runtime as a dead context */ onMessage: { addListener: fn => listeners.push(fn) } },
      tabs: {
        query: async () => [{ id: 71, active: true, url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp' }],
        sendMessage() {}
      },
      scripting: {
        executeScript(opts) { injections.push(opts); return lateInjection; }
      }
    }
  };
  context.self = context;
  context.mlsExecTO = function (opts, ms) {
    return Promise.race([
      context.chrome.scripting.executeScript(opts).then(r => ({ r }), e => ({ err: String(e && e.message || e) })),
      context.mlsSleepW(ms || 15000).then(() => ({ timeout: true }))
    ]);
  };
  vm.runInNewContext(searchIife, context, { filename: 'search-open-timeout.js', timeout: 1000 });
  assert.strictEqual(listeners.length, 1, 'SearchOpen listener was not installed');

  const requestId = 'search-never-settles';
  const callerDeadline = Date.now() + 60;
  const result = await Promise.race([
    new Promise(resolve => {
      listeners[0](
        { type: 'mlsAppSearchOpenRequest', requestId, deadlineAt: callerDeadline, name: 'Exact Patient', dob: '01/02/1960', noReload: true },
        { tab: { id: 4 } },
        value => { responses.push(value); resolve(value); }
      );
    }),
    delay(1000).then(() => { throw new Error('SearchOpen stayed pending after its absolute deadline'); })
  ]);
  assert.strictEqual(result.reason, 'open-deadline-exceeded');
  assert.strictEqual(result.requestId, requestId);
  assert.strictEqual(result.deadlineAt, callerDeadline, 'worker did not echo the caller-clamped deadline');
  assert.strictEqual(injections.length, 1, 'SearchOpen retried/fell back after the timed-out injection');
  const injectedGuard = injections[0].args && injections[0].args[2];
  assert(injectedGuard && injectedGuard.token === requestId && injectedGuard.deadline === callerDeadline, 'renderer did not receive the immutable request token/deadline');

  resolveLateInjection([{ frameId: 0, result: { opened: true } }]);
  await delay(20);
  assert.strictEqual(responses.length, 1, 'a late SearchOpen completion emitted a second terminal result');
  assert.strictEqual(injections.length, 1, 'a late SearchOpen completion dispatched a fallback');
}

function makeVisitsRuntime(options) {
  options = options || {};
  const listeners = [], releases = [], responses = [];
  const timedSource = visitIife.replace(
    'Math.max(30000, Math.min(180000, Number(cfg.maxReadMs || 165000)))',
    'Math.max(45, Math.min(180000, Number(cfg.maxReadMs || 165000)))'
  );
  assert.notStrictEqual(timedSource, visitIife, 'test could not narrow the production minimum deadline');
  const context = {
    console, Promise, Date, Math, Number, String, Object, Array, RegExp, JSON, Map, WeakMap,
    setTimeout: deadlineTimer, clearTimeout, setInterval: heartbeatTimer, clearInterval,
    mlsReadChartIdentity: function () {},
    mlsReadChartIdentityShadow: function () {},
    self: null,
    chrome: {
      runtime: { id: 'mls-test-extension', /* csr-1.x orphan guards treat an id-less runtime as a dead context */ onMessage: { addListener: fn => listeners.push(fn) } },
      tabs: {
        query: (_query, callback) => callback([{ id: 77, active: false, url: 'https://athenanet.athenahealth.com/chart' }]),
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
    context.__mlsQp = { active: true, athenaTabId: 77 };
    return options.ensureNeverSettles ? new Promise(() => {}) : Promise.resolve({ ok: true });
  };
  context.__mlsQpRelease = function (reason) {
    releases.push(reason);
    if (!options.releaseNeverSettles) context.__mlsQp = { active: false, athenaTabId: 77 };
    return options.releaseNeverSettles ? new Promise(() => {}) : Promise.resolve({ ok: true });
  };
  vm.runInNewContext(timedSource, context, { filename: 'all-visits-timeout.js', timeout: 1000 });
  return { context, listeners, releases, responses };
}

function sendVisits(runtime, requestId, onResponse) {
  const listener = runtime.listeners[0];
  assert(listener, 'AllVisits listener was not installed');
  listener(
    { type: 'mlsAppAllVisitsRequest', requestId, hint: { name: 'Exact Patient', dob: '01/02/1960', mrn: '1234' } },
    { tab: { id: 4 } },
    value => { runtime.responses.push(value); if (onResponse) onResponse(value); }
  );
}

async function testNeverSettlingAllVisitsAndRelease() {
  const runtime = makeVisitsRuntime({ releaseNeverSettles: true });
  let first = null, second = null;
  const complete = new Promise(resolve => {
    sendVisits(runtime, 'visits-first', value => {
      first = value;
      /* Re-enter synchronously from sendResponse. The production listener must
         have cleared activeAllVisitsPromise before it calls us. */
      sendVisits(runtime, 'visits-second', value2 => { second = value2; resolve(); });
    });
  });
  await Promise.race([complete, delay(1000).then(() => { throw new Error('AllVisits stayed pending on executeScript/qpRelease'); })]);
  assert.strictEqual(first.reason, 'read-deadline-exceeded');
  assert.strictEqual(second.reason, 'read-deadline-exceeded');
  assert.notStrictEqual(second.reason, 'busy', 'AllVisits single-flight state survived its terminal response');
  await delay(20);
  assert(runtime.releases.includes('all-visits-after-response'), 'detached response cleanup was never started');
}

async function testNeverSettlingEnsureGetsImmediateCleanup() {
  const runtime = makeVisitsRuntime({ ensureNeverSettles: true });
  let response = null;
  await Promise.race([
    new Promise(resolve => sendVisits(runtime, 'visits-ensure-never', value => { response = value; resolve(); })),
    delay(1000).then(() => { throw new Error('AllVisits stayed pending on quiet-work ensure'); })
  ]);
  assert.strictEqual(response.reason, 'read-deadline-exceeded');
  await delay(20);
  assert(runtime.releases.includes('all-visits-ensure-timeout'), 'never-settling quiet-work ensure did not trigger immediate cleanup');
}

(async () => {
  await testExpiredInjectedDriversAreZeroAction();
  await testNeverSettlingSearchOpen();
  await testNeverSettlingAllVisitsAndRelease();
  await testNeverSettlingEnsureGetsImmediateCleanup();
  console.log('PASS immutable renderer deadlines, never-settling browser calls, detached QP cleanup, and busy reset');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
