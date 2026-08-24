'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated function ${name}`);
}

async function run() {
  const clock = { now: 360000 };
  const injections = [];
  const fetches = [];
  let activityEvents = 0;
  let queryImpl = async () => [{ id: 41, discarded: false, url: 'https://athenanet.athenahealth.com/123/6/ax/dashboard' }];
  let executeImpl = async details => [{ frameId: 0, result: await details.func() }];

  class FakeDate extends Date {
    static now() { return clock.now; }
  }

  const document = {
    dispatchEvent() { activityEvents++; },
    querySelectorAll() { return []; },
    body: { dispatchEvent() { activityEvents++; } }
  };

  const context = {
    Promise,
    Date: FakeDate,
    Event: class Event {},
    MouseEvent: class MouseEvent {},
    document,
    console: { log() {}, error() {} },
    mlsAthIsLoginish: () => false,
    fetch: async (url, options) => {
      fetches.push({ url: String(url), method: String(options && options.method || 'GET') });
      return { ok: true, text: async () => 'OK' };
    },
    chrome: {
      tabs: {
        query: (...args) => queryImpl(...args)
      },
      scripting: {
        executeScript: async details => {
          injections.push(details);
          return executeImpl(details);
        }
      },
      storage: {
        local: {
          get(_keys, callback) { callback({ mlsKeepAlive: { enabled: true, periodMin: 3 }, mlsKaLedger: [] }); },
          set(_value, callback) { if (callback) callback(); },
          remove(_key, callback) { if (callback) callback(); }
        }
      }
    }
  };
  context.self = context;
  context.window = context;
  context.top = context;
  context.location = {
    pathname: '/123/6/ax/dashboard',
    href: 'https://athenanet.athenahealth.com/123/6/ax/dashboard'
  };
  context.__mlsQp = { active: false };
  context.__mlsChartReadBusyUntil = clock.now + 60000;

  vm.runInNewContext(
    `const KA_KEY = 'mlsKeepAlive';\n${extractFunction(background, 'kaGetCfg')}\n${extractFunction(background, 'kaFrameTouch')}\n${extractFunction(background, 'kaTick')}\nthis.tick = kaTick;`,
    context
  );

  await context.tick();
  assert.strictEqual(injections.length, 0, 'kaTick injected kaFrameTouch while the explicit chart-read deadline was active');
  assert.strictEqual(fetches.length, 0, 'kaTick issued an Athena session request while the explicit chart-read deadline was active');
  assert.strictEqual(activityEvents, 0, 'kaTick synthesized frame activity while the explicit chart-read deadline was active');

  clock.now = context.__mlsChartReadBusyUntil + 1;
  context.__mlsQp.active = true;
  await context.tick();
  assert.strictEqual(injections.length, 0, 'kaTick injected kaFrameTouch while the explicit quiet-pull lease was active');
  assert.strictEqual(fetches.length, 0, 'kaTick issued an Athena session request while the explicit quiet-pull lease was active');
  assert.strictEqual(activityEvents, 0, 'kaTick synthesized frame activity while the explicit quiet-pull lease was active');

  context.__mlsQp.active = false;
  await context.tick();
  assert.strictEqual(injections.length, 1, 'kaTick did not become eligible after the explicit pull guards cleared');
  assert(activityEvents >= 3, 'eligible kaTick did not execute kaFrameTouch');
  assert(fetches.some(entry => entry.url === '/123/6/ax/login/ping' && entry.method === 'GET'), 'eligible kaTick did not issue the Athena session ping');
  assert(fetches.some(entry => entry.url === context.location.href && entry.method === 'HEAD'), 'eligible kaTick did not issue the same-page HEAD');
  assert(fetches.some(entry => entry.url === '/123/6/ax/dashboard' && entry.method === 'GET'), 'eligible kaTick did not issue the periodic authenticated dashboard GET');

  /* The read can start while kaTick is awaiting tab enumeration. Re-checking
     immediately before executeScript closes that actual event-loop race. */
  injections.length = 0;
  fetches.length = 0;
  activityEvents = 0;
  queryImpl = async () => {
    context.__mlsChartReadBusyUntil = clock.now + 60000;
    return [{ id: 41, discarded: false, url: 'https://athenanet.athenahealth.com/123/6/ax/dashboard' }];
  };
  await context.tick();
  assert.strictEqual(injections.length, 0, 'kaTick failed to re-check a pull that began during tab enumeration');
  assert.strictEqual(fetches.length, 0, 'kaTick issued session traffic after a pull began during tab enumeration');

  /* Periodic and one-shot alarms can arrive together. Only one eligible tick
     may inject while the first asynchronous frame pass is still in flight. */
  context.__mlsChartReadBusyUntil = 0;
  queryImpl = async () => [{ id: 41, discarded: false, url: 'https://athenanet.athenahealth.com/123/6/ax/dashboard' }];
  let releaseExecute;
  executeImpl = details => new Promise(resolve => {
    releaseExecute = async () => resolve([{ frameId: 0, result: await details.func() }]);
  });
  const firstTick = context.tick();
  for (let i = 0; i < 8 && injections.length === 0; i++) await Promise.resolve();
  assert.strictEqual(injections.length, 1, 'first eligible tick did not enter its frame pass');
  const overlappingTick = context.tick();
  for (let i = 0; i < 8; i++) await Promise.resolve();
  assert.strictEqual(injections.length, 1, 'overlapping keep-alive ticks injected twice');
  await releaseExecute();
  await Promise.all([firstTick, overlappingTick]);

  console.log('PASS Athena keep-alive defers during pulls, re-checks after awaits, resumes afterward, and rejects overlapping ticks');
}

run().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
