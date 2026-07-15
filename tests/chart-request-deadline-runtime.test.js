'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');

function between(source, begin, end) {
  const a = source.indexOf(begin);
  assert(a >= 0, `missing marker: ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing end marker: ${end}`);
  return source.slice(a, b);
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function timer(fn, ms) {
  const handle = setTimeout(fn, ms);
  if (Number(ms) >= 1000 && handle && typeof handle.unref === 'function') handle.unref();
  return handle;
}

const chartHandler = between(
  background,
  "if (msg.type === 'mlsAppChartRequest')",
  '/* ---- v1.51: read the OPEN athena chart'
);
const ensureDriver = between(
  background,
  'function mlsEnsureClinicalChartFn(requestGuard)',
  '/* Injected read-only interstitial detector.'
);

assert(chartHandler.includes('const chartRequestGuard = Object.freeze'), 'chart request does not freeze its request token/deadline');
assert(chartHandler.includes('chartDeadlineAt = Math.min(chartDeadlineAt, chartCallerDeadline)'), 'chart request does not clamp to the caller deadline');
assert(chartHandler.includes('if (chartResponseSent) return false'), 'chart request lost exact-once response ownership');
assert(chartHandler.includes('deadline: Math.min(chartRequestGuard.deadline, chartOpenStartedAt + 20000)'), 'fallback chart-open deadline is not clamped to the caller');
assert(chartHandler.includes('func: openFn, args: [want, wantDob, wantMrn, chartOpenGuard]'), 'fallback chart opener lost its immutable action guard');
assert(chartHandler.includes('func: mlsEnsureClinicalChartFn, args: [chartRequestGuard]'), 'clinical-chart navigation lost its immutable action guard');
assert(chartHandler.includes("kind: 'athena-chart-coverage', requestId: chartRequestGuard.token, deadlineAt: chartRequestGuard.deadline"), 'chart receipt does not echo correlation/deadline');
assert(!chartHandler.includes('mlsExecTO('), 'chart handler still has a request-local unbounded executeScript wrapper');
assert(!chartHandler.includes('await chrome.'), 'chart handler still awaits a raw Chrome operation');
assert(!chartHandler.includes('await mlsRecoverAthenaTab'), 'chart handler can continue a recovery after its terminal deadline');
assert(ensureDriver.includes("out.reason = 'chart-deadline-exceeded'"), 'clinical-chart driver does not fail closed after expiry');

async function testNeverSettlingChartInjection() {
  const responses = [];
  const injections = [];
  let resolveLate;
  const neverUntilReleased = new Promise(resolve => { resolveLate = resolve; });
  let domTouches = 0;
  const forbiddenDocument = new Proxy({}, {
    get() { domTouches++; throw new Error('expired chart opener touched the DOM'); }
  });
  const context = {
    console, Promise, Date, Math, Number, String, Object, Array, RegExp, JSON, Map,
    setTimeout: timer, clearTimeout,
    document: forbiddenDocument,
    window: {}, location: { href: 'https://athenanet.athenahealth.com/chart' },
    Event: function Event() {}, KeyboardEvent: function KeyboardEvent() {},
    PointerEvent: function PointerEvent() {}, MouseEvent: function MouseEvent() {},
    self: null,
    __mlsReadsSinceReload: 0,
    mlsSleepW: ms => new Promise(resolve => timer(resolve, ms)),
    mlsPickAthenaTab: async tabs => tabs[0] || null,
    mlsIsAthenaTab: () => true,
    mlsAthIsLoginish: () => false,
    mlsReadChartIdentity: function () {},
    mlsEnsureClinicalChartFn: function () {},
    mlsShadowIdentityTry: async () => null,
    mlsBestIdentityFrom: () => null,
    chrome: {
      tabs: {
        query: async () => [{ id: 91, url: 'https://athenanet.athenahealth.com/chart', title: 'athenaOne' }],
        get: async id => ({ id, url: 'https://athenanet.athenahealth.com/chart', title: 'athenaOne' })
      },
      scripting: {
        executeScript(opts) { injections.push(opts); return neverUntilReleased; }
      },
      runtime: { getManifest: () => ({ version: 'test' }) }
    }
  };
  context.self = context;
  vm.runInNewContext(`this.__chartListener = function (msg, sender, sendResponse) { ${chartHandler}\nreturn false; };`, context, {
    filename: 'chart-request-deadline-handler.js', timeout: 1000
  });

  const requestId = 'chart-never-settles';
  const callerDeadline = Date.now() + 65;
  const result = await Promise.race([
    new Promise(resolve => {
      const asyncOwned = context.__chartListener(
        { type: 'mlsAppChartRequest', requestId, deadlineAt: callerDeadline, patient: 'Exact Patient', patientDob: '01/02/1960', patientMrn: '12345' },
        { tab: { id: 4 } },
        value => { responses.push(value); resolve(value); }
      );
      assert.strictEqual(asyncOwned, true, 'chart request did not retain its async response channel');
    }),
    delay(1000).then(() => { throw new Error('chart request stayed pending after its absolute deadline'); })
  ]);

  assert(['chart-deadline-exceeded', 'open-deadline-exceeded'].includes(result.reason), 'chart request did not report its terminal absolute deadline');
  assert.strictEqual(result.requestId, requestId);
  assert.strictEqual(result.deadlineAt, callerDeadline);
  assert.strictEqual(injections.length, 1, 'chart request retried/fell back after a never-settling injection');
  const injected = injections[0];
  const guard = injected.args && injected.args[3];
  assert(guard && guard.token === requestId && guard.deadline === callerDeadline, 'late chart opener did not carry the caller-clamped guard');

  const lateResult = injected.func.apply(null, injected.args);
  assert.strictEqual(lateResult, 'open-deadline-exceeded');
  assert.strictEqual(domTouches, 0, 'expired late chart opener touched the page');
  resolveLate([{ frameId: 0, result: 'searched' }]);
  await delay(25);
  assert.strictEqual(responses.length, 1, 'late chart completion emitted a second response');
  assert.strictEqual(injections.length, 1, 'late chart completion dispatched another action');
}

function testExpiredClinicalChartDriverIsZeroAction() {
  let clicks = 0, scrolls = 0, dispatches = 0;
  const control = {
    textContent: 'REFRESH CHART', value: '',
    getBoundingClientRect: () => ({ width: 100, height: 20, left: 1, top: 1 }),
    scrollIntoView: () => { scrolls++; },
    dispatchEvent: () => { dispatches++; },
    click: () => { clicks++; }
  };
  const context = {
    Date, Math, Number, String, Object, Array, RegExp,
    location: { href: 'https://athenanet.athenahealth.com/appointment/123' },
    window: {},
    document: { querySelectorAll: () => [control] },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    PointerEvent: function PointerEvent() {}, MouseEvent: function MouseEvent() {}
  };
  vm.runInNewContext(ensureDriver, context, { filename: 'expired-clinical-chart-driver.js', timeout: 1000 });
  const result = context.mlsEnsureClinicalChartFn({ token: 'expired-chart', deadline: Date.now() - 1 });
  assert.strictEqual(result.reason, 'chart-deadline-exceeded');
  assert.strictEqual(clicks, 0, 'expired clinical-chart driver clicked');
  assert.strictEqual(scrolls, 0, 'expired clinical-chart driver scrolled before its click');
  assert.strictEqual(dispatches, 0, 'expired clinical-chart driver dispatched pointer events');
}

(async () => {
  await testNeverSettlingChartInjection();
  testExpiredClinicalChartDriverIsZeroAction();
  console.log('PASS chart request absolute-deadline and late-action guards');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
