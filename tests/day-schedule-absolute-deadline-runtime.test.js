'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(path.join(root, 'content.js'), 'utf8');

function between(source, startText, endText) {
  const start = source.indexOf(startText);
  assert(start >= 0, `missing start marker: ${startText}`);
  const end = source.indexOf(endText, start + startText.length);
  assert(end > start, `missing end marker: ${endText}`);
  return source.slice(start, end);
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

const gotoDriverSource = between(
  background,
  'async function mlsAthenaGotoDate(target, probe, requestGuard)',
  '// ---- Patient identity reader:'
);
const homeDriverSource = between(
  background,
  'function mlsGoHomeDriverFn(requestGuard)',
  '/* ===================== v1.59 CHART-READY'
);
const scheduleDriverSource = between(
  background,
  'async function mlsAthenaGotoSchedule(NAV, requestGuard)',
  '/* ---- v1.51: hands-free schedule DATE navigation'
);
const gotoHandlerSource = between(
  background,
  "if (msg.type === 'mlsAppGotoDateRequest')",
  "if (msg.type === 'mlsAppGoHomeRequest')"
);
const scheduleHandlerSource = between(
  background,
  "if (msg.type === 'mlsAppScheduleRequest')",
  '// READ-ONLY: read the open Athena REPORT'
);

/* Relay contract: the page-created correlation/deadline is not replaced at
   either content hop, and a late runtime callback cannot post twice. */
const contentDayRelay = between(content, "if (d.type === 'mlsAppPullSchedule')", "if (d.type === 'mlsAppGoHome')");
assert(contentDayRelay.includes("requestId: scheduleGuard.requestId, deadlineAt: scheduleGuard.deadlineAt"));
assert(contentDayRelay.includes("requestId: gotoGuard.requestId, deadlineAt: gotoGuard.deadlineAt"));
assert(contentDayRelay.includes('if (scheduleFinished) return;'));
assert(contentDayRelay.includes('if (gotoFinished) return;'));

/* Worker handlers must clamp to the caller deadline, use one frozen guard, and
   pass that exact guard into every click-capable renderer route. */
assert(gotoHandlerSource.includes('Math.min(__gotoDeadlineAt, __gotoCallerDeadline)'));
assert(gotoHandlerSource.includes('Object.freeze({ token: __gotoRequestId, deadline: __gotoDeadlineAt })'));
assert(gotoHandlerSource.includes('args: [date, !!msg.probe, __gotoGuard]'));
assert(gotoHandlerSource.includes('args: [__gotoGuard], func: mlsGoHomeDriverFn'));
assert(gotoHandlerSource.includes('args: [date, false, __gotoGuard]'));
assert(scheduleHandlerSource.includes('Math.min(__schedDeadline, __schedCallerDeadline)'));
assert(scheduleHandlerSource.includes('Object.freeze({ token: __schedRequestId, deadline: __schedDeadline })'));
assert(scheduleHandlerSource.includes('args: [__schedGuard], func: mlsGoHomeDriverFn'));
assert(scheduleHandlerSource.includes('args: [ (__mlsCfg && __mlsCfg.nav) || null, __schedGuard ]'));
assert(!gotoHandlerSource.includes('await chrome.scripting.executeScript('));
assert(!scheduleHandlerSource.includes('await chrome.scripting.executeScript('));
assert(gotoHandlerSource.includes("__gotoCleanup('goto-date-terminal', false)"));
assert(scheduleHandlerSource.includes("__schedCleanup('schedule-terminal', false)"));

async function testExpiredDriversTouchNothing() {
  let touches = 0;
  const forbiddenDocument = new Proxy({}, {
    get() { touches++; throw new Error('expired driver touched the DOM'); }
  });
  const context = {
    Date, Math, Number, String, Object, Array, RegExp, Promise,
    setTimeout, clearTimeout,
    document: forbiddenDocument,
    location: new Proxy({}, { get() { touches++; throw new Error('expired driver touched location'); } }),
    window: {}
  };
  vm.runInNewContext(gotoDriverSource, context, { filename: 'expired-goto-driver.js', timeout: 1000 });
  vm.runInNewContext(homeDriverSource, context, { filename: 'expired-home-driver.js', timeout: 1000 });
  vm.runInNewContext(scheduleDriverSource, context, { filename: 'expired-schedule-driver.js', timeout: 1000 });
  const expired = { token: 'expired-day-request', deadline: Date.now() - 1 };
  const goto = await context.mlsAthenaGotoDate('2026-07-14', false, expired);
  const home = context.mlsGoHomeDriverFn(expired);
  const schedule = await context.mlsAthenaGotoSchedule(null, expired);
  assert.strictEqual(goto.reason, 'request-deadline-exceeded');
  assert.strictEqual(home.reason, 'request-deadline-exceeded');
  assert.strictEqual(schedule.reason, 'request-deadline-exceeded');
  assert.strictEqual(touches, 0, 'an expired date/schedule injection touched the renderer');
}

function makeHandlerRuntime(handlerSource, options) {
  options = options || {};
  const listeners = [], responses = [], releases = [];
  const never = new Promise(() => {});
  const context = {
    console, Promise, Date, Math, Number, String, Object, Array, RegExp, JSON, URL,
    setTimeout, clearTimeout,
    self: null,
    mlsSleepW: ms => new Promise(resolve => setTimeout(resolve, ms)),
    mlsHostOnly: () => 'athenanet.athenahealth.com',
    mlsIsAthenaTab: () => true,
    mlsAthenaGotoDate() {}, mlsGoHomeDriverFn() {}, mlsAthenaContinueFn() {},
    mlsAthenaReadHeaderDate() {}, mlsAthenaScheduleSurfaceFn() {}, mlsAthenaGotoSchedule() {},
    mlsAttachDobs: value => value,
    mlsRecoverAthenaTab: () => Promise.resolve({ ok: true }),
    mlsExecTO: () => Promise.resolve({ r: [] }),
    mlsPickAthenaTab: options.pickNever ? () => never : async tabs => tabs[0] || null,
    fetch: () => never,
    chrome: {
      runtime: { onMessage: { addListener(fn) { listeners.push(fn); } } },
      tabs: { query: async () => [{ id: 71, url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp' }] },
      storage: { local: { get() {}, set() {} } }
    }
  };
  context.self = context;
  context.__mlsQpEnsure = options.ensureNever ? () => never : () => Promise.resolve('strip');
  context.__mlsQpRelease = reason => { releases.push(reason); return options.releaseNever ? never : Promise.resolve(); };
  vm.runInNewContext(
    `(function(){ chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse){ ${handlerSource} }); })();`,
    context,
    { filename: 'day-handler-runtime.js', timeout: 1000 }
  );
  return { context, listener: listeners[0], responses, releases };
}

async function sendWithDeadline(runtime, msg) {
  const result = await Promise.race([
    new Promise(resolve => runtime.listener(msg, { tab: { id: 4 } }, value => {
      runtime.responses.push(value); resolve(value);
    })),
    delay(1000).then(() => { throw new Error(`${msg.type} stayed pending past its absolute deadline`); })
  ]);
  await delay(25);
  return result;
}

async function testNeverSettlingHandlers() {
  for (const spec of [
    { source: gotoHandlerSource, type: 'mlsAppGotoDateRequest', id: 'goto-pick-never', extra: { date: '2026-07-14' } },
    { source: scheduleHandlerSource, type: 'mlsAppScheduleRequest', id: 'schedule-pick-never', extra: {} }
  ]) {
    const runtime = makeHandlerRuntime(spec.source, { pickNever: true });
    const deadlineAt = Date.now() + 60;
    const result = await sendWithDeadline(runtime, Object.assign({ type: spec.type, id: spec.id, requestId: spec.id, deadlineAt }, spec.extra));
    assert.strictEqual(runtime.responses.length, 1, `${spec.type} emitted more than one terminal response`);
    assert.strictEqual(result.requestId, spec.id);
    assert.strictEqual(result.deadlineAt, deadlineAt, `${spec.type} did not echo the caller-clamped deadline`);
    assert(/deadline|timeout/.test(result.reason), `${spec.type} did not fail with an honest deadline reason`);
  }

  for (const spec of [
    { source: gotoHandlerSource, type: 'mlsAppGotoDateRequest', id: 'goto-ensure-never', extra: { date: '2026-07-14' } },
    { source: scheduleHandlerSource, type: 'mlsAppScheduleRequest', id: 'schedule-ensure-never', extra: {} }
  ]) {
    const runtime = makeHandlerRuntime(spec.source, { ensureNever: true, releaseNever: true });
    const deadlineAt = Date.now() + 70;
    const result = await sendWithDeadline(runtime, Object.assign({ type: spec.type, id: spec.id, requestId: spec.id, deadlineAt }, spec.extra));
    assert.strictEqual(runtime.responses.length, 1, `${spec.type} emitted more than one terminal response after QP timeout`);
    assert.strictEqual(result.requestId, spec.id);
    assert(runtime.releases.some(reason => /ensure-timeout|terminal/.test(reason)), `${spec.type} did not start detached cleanup after a never-settling QP ensure`);
  }
}

(async () => {
  await testExpiredDriversTouchNothing();
  await testNeverSettlingHandlers();
  console.log('PASS day/schedule caller deadlines, zero-action expired drivers, exact-once response, and detached QP cleanup');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
