'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const background = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function between(source, begin, end, from = 0) {
  const a = source.indexOf(begin, from);
  assert(a >= 0, `missing ${begin}`);
  const b = source.indexOf(end, a + begin.length);
  assert(b > a, `missing ${end}`);
  return source.slice(a, b);
}

function extractFunction(source, name) {
  let start = source.indexOf(`async function ${name}(`);
  if (start < 0) start = source.indexOf(`function ${name}(`);
  assert(start >= 0, `missing function ${name}`);
  const brace = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false, lineComment = false, blockComment = false;
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

function frameDocument({ text = '', title = '', heading = '', password = false, width = 900, height = 700, calendar = false, frameset = false } = {}) {
  const body = {
    innerText: text,
    textContent: text,
    getBoundingClientRect: () => ({ width, height })
  };
  return {
    body,
    title,
    querySelector(selector) {
      if (selector === 'input[type="password"]') return password ? {} : null;
      if (selector === '.calendar-nav') return calendar ? {} : null;
      if (selector === 'frameset,frame,iframe') return frameset ? {} : null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === 'h1,h2,h3,[role="heading"]' && heading) return [{ textContent: heading }];
      return [];
    }
  };
}

function runProbe(fixture, nested = true) {
  const context = {
    String, Number, Array, RegExp,
    document: frameDocument(fixture),
    window: { innerWidth: fixture.width == null ? 900 : fixture.width, innerHeight: fixture.height == null ? 700 : fixture.height }
  };
  context.window.top = nested ? {} : context.window;
  vm.runInNewContext(`${extractFunction(background, 'mlsAthSessionProbeFn')}; this.probe = mlsAthSessionProbeFn;`, context);
  return context.probe();
}

const exactTimeout = runProbe({
  text: 'Refresh Timed Out\nYour session has timed out. Please log in.'
});
assert.strictEqual(exactTimeout.timedOut, true, 'exact visible Athena timeout was not detected');

const exactLogin = runProbe({
  text: 'Welcome to athenaOne. Username Password Log in to athenaOne',
  password: true
});
assert.strictEqual(exactLogin.login, true, 'exact visible Athena login form was not detected');

const clinicalLoginMention = runProbe({
  heading: 'Visit note',
  text: 'Patient reports a portal login problem and discussed what a session timeout means. Continue signed-in chart workflow.'
});
assert.strictEqual(clinicalLoginMention.timedOut, false, 'generic clinical login text false-positive matched timeout');
assert.strictEqual(clinicalLoginMention.login, false, 'generic clinical login text false-positive matched login form');

const hiddenTimeout = runProbe({
  heading: 'Refresh Timed Out',
  text: 'Your session has timed out. Please log in.',
  width: 0,
  height: 0
});
assert.strictEqual(hiddenTimeout.timedOut, false, 'hidden/preloaded timeout frame was treated as the visible session');

async function testAllFrameVetoAndInvalidation() {
  const pingSource = [
    extractFunction(background, 'mlsAthRejectSignedOut'),
    extractFunction(background, 'mlsAthPing')
  ].join('\n');
  const injections = [];
  let frameResults = [];
  let pinClears = 0;
  const context = {
    Promise, Number, Object, Array,
    self: null,
    mlsAthSessionProbeFn() {},
    mlsExecTO: async opts => { injections.push(opts); return { r: frameResults }; },
    mlsPinSet: value => { if (value == null) pinClears++; context.self.__mlsAthPin = { tabId: value }; },
    chrome: { storage: { session: { set() {} } } }
  };
  context.self = context;
  context.__mlsAthReg = { 11: Date.now() };
  context.__mlsAthPickCache = { tabId: 11, at: Date.now() };
  context.__mlsAthPin = { tabId: 11 };
  vm.runInNewContext(`${pingSource}; this.ping = mlsAthPing;`, context);

  frameResults = [
    { frameId: 0, result: { p: 1, fs: true, timedOut: false, login: false } },
    { frameId: 7, result: { p: 1, fs: false, timedOut: true, login: false } }
  ];
  const timedOut = await context.ping(11, 50);
  assert.strictEqual(injections[0].target.allFrames, true, 'session probe did not inspect every current frame');
  assert.strictEqual(timedOut.alive, false, 'healthy outer frameset masked an expired inner frame');
  assert.strictEqual(timedOut.signedOut, true);
  assert.strictEqual(timedOut.timedOut, true);
  assert.strictEqual(timedOut.fs, false, 'frameset shell remained a healthy signal after timeout veto');
  assert.strictEqual(context.__mlsAthReg[11], undefined, 'expired tab retained hello health');
  assert.strictEqual(context.__mlsAthPickCache.tabId, null, 'expired tab retained cached selection');
  assert.strictEqual(context.__mlsAthPin.tabId, null, 'expired tab retained pin ownership');
  assert.strictEqual(pinClears, 1);

  frameResults = [{ frameId: 0, result: { p: 1, fs: true, timedOut: false, login: false } }];
  const healthy = await context.ping(12, 50);
  assert.strictEqual(healthy.alive, true);
  assert.strictEqual(healthy.signedOut, false);
}

async function testPickerAlwaysProbes() {
  const pickerSource = extractFunction(background, 'mlsPickAthenaTab');
  const tabs = [
    { id: 21, url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp', title: 'athenaOne', lastAccessed: 20 },
    { id: 22, url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp', title: 'athenaOne', lastAccessed: 10 }
  ];
  const probes = [];
  const rejected = [];
  const context = {
    Promise, Date, Number, Object, Array,
    self: null,
    mlsAthTabHost: () => 'athenanet.athenahealth.com',
    mlsAthIsLoginish: () => false,
    mlsTabTitleAthena: () => true,
    mlsAthScore: t => t.id === 21 ? 200 : 100,
    mlsPickGenericEmrTab: () => null,
    mlsPinSet() {},
    mlsAthRejectSignedOut: id => rejected.push(id),
    mlsAthPing: async id => {
      probes.push(id);
      return id === 21
        ? { alive: false, signedOut: true, timedOut: true }
        : { alive: true, signedOut: false, fs: true };
    },
    chrome: { tabs: { query: async () => tabs, get: async id => tabs.find(t => t.id === id) } }
  };
  context.self = context;
  context.__mlsAthPin = { tabId: null };
  context.__mlsAthPickCache = { tabId: 21, at: Date.now() };
  vm.runInNewContext(`${pickerSource}; this.pick = mlsPickAthenaTab;`, context);

  const selected = await context.pick(tabs, { athenaOnly: true });
  assert.strictEqual(selected.id, 22, 'expired cached tab beat a freshly verified healthy tab');
  assert.deepStrictEqual(Array.from(probes).sort(), [21, 22], 'picker did not freshly probe cached and alternative tabs');
  assert(rejected.includes(21), 'picker did not reject the expired cached tab');

  probes.length = 0;
  context.__mlsAthPickCache = { tabId: null, at: 0 };
  const single = await context.pick([tabs[0]], { athenaOnly: true, noPing: true });
  assert.strictEqual(single, null, 'single expired candidate bypassed health validation');
  assert.deepStrictEqual(Array.from(probes), [21], 'single/noPing candidate skipped the exact session probe');

  probes.length = 0;
  context.__mlsAthPin = { tabId: 21 };
  const pinned = await context.pick(tabs, { athenaOnly: true });
  assert.strictEqual(pinned, null, 'expired pinned tab remained selectable');
  assert.deepStrictEqual(Array.from(probes), [21], 'pinned tab bypassed the exact session probe');
}

async function testHelloAndAlarmFailClosed() {
  const helloMarker = background.indexOf("if (!msg || msg.type !== 'mlsAthenaHello'");
  const helloStart = background.lastIndexOf('try {', helloMarker);
  assert(helloStart >= 0, 'missing Athena hello listener');
  const helloEnd = background.indexOf('try { chrome.tabs.onRemoved.addListener', helloStart);
  const helloInstall = background.slice(helloStart, helloEnd);
  let listener = null, arms = 0, storageWrites = 0;
  const context = {
    Promise, Date, URL,
    self: null,
    mlsAthPing: async () => ({ alive: false, signedOut: true, timedOut: true }),
    mlsArmKeepAlive: async () => { arms++; },
    chrome: {
      runtime: { id: 'mls-test-extension', /* csr-1.x orphan guards treat an id-less runtime as a dead context */ onMessage: { addListener: fn => { listener = fn; } } },
      storage: { session: { set: () => { storageWrites++; } } },
      tabs: { query: (_q, cb) => cb([{ id: 90 }]) }
    }
  };
  context.self = context;
  context.__mlsAthReg = {};
  context.__mlsAthPin = { tabId: 31 };
  vm.runInNewContext(helloInstall, context);
  listener({ type: 'mlsAthenaHello' }, { tab: { id: 31, url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp' } });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(context.__mlsAthReg[31], undefined, 'expired Hello boosted registry health');
  assert.strictEqual(storageWrites, 0, 'expired Hello persisted registry health');
  assert.strictEqual(arms, 0, 'expired Hello armed keep-alive');

  const pinMarker = background.indexOf('/* ===================== v1.99 ATHENA TAB PIN');
  const alarmListenerMarker = background.indexOf("chrome.alarms.onAlarm.addListener(function (a) {", pinMarker);
  const alarmStart = background.lastIndexOf('try {', alarmListenerMarker);
  const alarmEnd = background.indexOf('/* =================== end v1.99 athena tab pin', alarmStart);
  const alarmInstall = background.slice(alarmStart, alarmEnd);
  let alarmListener = null, alarmArms = 0;
  const alarmContext = {
    Promise,
    self: null,
    mlsAthIsLoginish: () => false,
    mlsAthTabHost: () => 'athenanet.athenahealth.com',
    mlsAthRejectSignedOut() {},
    mlsAthPing: async () => ({ alive: false, signedOut: true, timedOut: true }),
    mlsArmKeepAlive: async () => { alarmArms++; },
    mlsPinSet() {},
    chrome: {
      alarms: { onAlarm: { addListener: fn => { alarmListener = fn; } }, clear() {} },
      tabs: { get: async id => ({ id, url: 'https://athenanet.athenahealth.com/1/1/globalframeset.esp' }) }
    }
  };
  alarmContext.self = alarmContext;
  alarmContext.__mlsAthPin = { tabId: 31 };
  vm.runInNewContext(alarmInstall, alarmContext);
  alarmListener({ name: 'mlsPinWatch' });
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.strictEqual(alarmArms, 0, 'five-minute pin alarm armed an expired nested-frame session');
}

async function testPinStateRequestListRecoveryAndKeepAlive() {
  const listBlock = between(background, "if (msg.type === 'mlsListAthenaTabsRequest')", "if (msg.type === 'mlsPinAthenaTabRequest')");
  assert(listBlock.includes('signedOut: signedOut') && listBlock.includes('connected: !!(pr.alive && !signedOut)'), 'tab list does not expose the exact session verdict');
  const pinBlock = between(background, "if (msg.type === 'mlsPinAthenaTabRequest')", "if (msg.type === 'mlsPinStateRequest')");
  assert(pinBlock.indexOf('if (pr.signedOut)') < pinBlock.indexOf('mlsPinSet(t.id)'), 'pin request mutates pin state before rejecting timeout');
  assert(pinBlock.indexOf('if (!pr.alive)') < pinBlock.indexOf('mlsPinSet(t.id)'), 'pin request accepts an unverified session');

  let listRejects = 0;
  const listedTabs = [
    { id: 51, title: 'athenaOne expired shell', url: 'https://athenanet.athenahealth.com/globalframeset.esp', active: true },
    { id: 52, title: 'athenaOne live shell', url: 'https://athenanet.athenahealth.com/globalframeset.esp', active: false }
  ];
  const listContext = {
    Promise, Date,
    self: null,
    mlsTabTitleAthena: () => true,
    mlsAthIsLoginish: () => false,
    mlsAthTabHost: () => 'athenanet.athenahealth.com',
    mlsAthPing: async id => id === 51
      ? { alive: false, signedOut: true, timedOut: true }
      : { alive: true, signedOut: false, timedOut: false },
    mlsAthRejectSignedOut: id => {
      if (id === 51) listRejects++;
      delete listContext.__mlsAthReg[id];
      if (listContext.__mlsAthPin.tabId === id) listContext.__mlsAthPin = { tabId: null };
    },
    chrome: { tabs: { query: async () => listedTabs } }
  };
  listContext.self = listContext;
  listContext.__mlsAthReg = { 51: Date.now(), 52: Date.now() };
  listContext.__mlsAthPin = { tabId: 51 };
  vm.runInNewContext(`this.handleList = function (msg, sendResponse) { ${listBlock}\nreturn false; };`, listContext);
  const listResponse = await new Promise(resolve => {
    assert.strictEqual(listContext.handleList({ type: 'mlsListAthenaTabsRequest' }, resolve), true);
  });
  const expiredRow = listResponse.tabs.find(row => row.id === 51);
  const liveRow = listResponse.tabs.find(row => row.id === 52);
  assert(expiredRow && expiredRow.signedOut && expiredRow.timedOut && expiredRow.loginish, 'tab list hid the exact timeout verdict');
  assert.strictEqual(expiredRow.connected, false);
  assert.strictEqual(expiredRow.hello, false, 'expired row retained Hello-connected label');
  assert.strictEqual(expiredRow.pinned, false, 'expired row retained pinned label');
  assert(liveRow && liveRow.connected && !liveRow.signedOut, 'live tab lost its connected verdict');
  assert.strictEqual(listRejects, 1);

  let pinSets = 0, pinArms = 0;
  const pinRequestContext = {
    Promise, Number,
    self: null,
    mlsAthIsLoginish: () => false,
    mlsAthTabHost: () => 'athenanet.athenahealth.com',
    mlsAthPing: async () => ({ alive: false, signedOut: true, timedOut: true }),
    mlsPinSet: () => { pinSets++; },
    mlsArmKeepAlive: async () => { pinArms++; },
    mlsPinInfo: async () => ({}),
    chrome: {
      tabs: { get: async id => ({ id, url: 'https://athenanet.athenahealth.com/globalframeset.esp' }) },
      storage: { session: { set() {} } }
    }
  };
  pinRequestContext.self = pinRequestContext;
  pinRequestContext.__mlsAthReg = {};
  vm.runInNewContext(`this.handlePin = function (msg, sendResponse) { ${pinBlock}\nreturn false; };`, pinRequestContext);
  const pinResponse = await new Promise(resolve => {
    assert.strictEqual(pinRequestContext.handlePin({ type: 'mlsPinAthenaTabRequest', tabId: 51 }, resolve), true);
  });
  assert.strictEqual(pinResponse.ok, false);
  assert.strictEqual(pinResponse.signedOut, true);
  assert.strictEqual(pinResponse.timedOut, true);
  assert.strictEqual(pinSets, 0, 'expired pin request changed pin state');
  assert.strictEqual(pinArms, 0, 'expired pin request armed keep-alive');

  const pinInfoSource = extractFunction(background, 'mlsPinInfo');
  let rejected = 0, keepAliveReads = 0;
  const pinContext = {
    Promise,
    self: null,
    mlsAthIsLoginish: () => false,
    mlsAthTabHost: () => 'athenanet.athenahealth.com',
    mlsAthPing: async () => ({ alive: false, signedOut: true, timedOut: true }),
    mlsAthRejectSignedOut: () => { rejected++; pinContext.__mlsAthPin = { tabId: null }; },
    mlsPinSet() {},
    mlsExecTO: async () => { keepAliveReads++; return {}; },
    chrome: { tabs: { get: async id => ({ id, title: 'athenaOne', url: 'https://athenanet.athenahealth.com/globalframeset.esp' }) } }
  };
  pinContext.self = pinContext;
  pinContext.__mlsAthPin = { tabId: 41 };
  vm.runInNewContext(`${pinInfoSource}; this.pinInfo = mlsPinInfo;`, pinContext);
  const info = await pinContext.pinInfo();
  assert.strictEqual(info.signedOut, true);
  assert.strictEqual(info.timedOut, true);
  assert.strictEqual(info.connected, false);
  assert.strictEqual(info.pinned, false, 'pin state still labels an expired tab pinned');
  assert.strictEqual(rejected, 1);
  assert.strictEqual(keepAliveReads, 0, 'pin state queried keep-alive state after exact timeout');

  const recoverySource = extractFunction(background, 'mlsRecoverAthenaTab');
  let recoveryArms = 0;
  const recoveryContext = {
    Promise,
    mlsIsAthenaTab: () => true,
    mlsAthIsLoginish: () => false,
    mlsAthPing: async () => ({ alive: false, signedOut: true, timedOut: true }),
    mlsArmKeepAlive: async () => { recoveryArms++; },
    chrome: { tabs: { get: async id => ({ id, url: 'https://athenanet.athenahealth.com/globalframeset.esp' }) } }
  };
  vm.runInNewContext(`${recoverySource}; this.recover = mlsRecoverAthenaTab;`, recoveryContext);
  const recovery = await recoveryContext.recover(41);
  assert.strictEqual(recovery.skipped, 'athena-signed-out', 'recovery mislabeled nested timeout as a refresh problem');
  assert.strictEqual(recovery.manualSignIn, true);
  assert.strictEqual(recovery.timedOut, true);
  assert.strictEqual(recoveryArms, 0);

  const armSource = extractFunction(background, 'mlsArmKeepAlive');
  let injections = 0;
  const armContext = {
    Promise, Date,
    self: null,
    mlsAthTabHost: () => 'athenanet.athenahealth.com',
    mlsAthIsLoginish: () => false,
    mlsAthRejectSignedOut() {},
    mlsAthPing: async () => ({ alive: false, signedOut: true, timedOut: true }),
    mlsKeepAlivePageFn() {},
    mlsExecTO: async () => { injections++; return {}; },
    chrome: { tabs: { get: async id => ({ id, url: 'https://athenanet.athenahealth.com/globalframeset.esp' }) } }
  };
  armContext.self = armContext;
  armContext.__mlsKaArmAt = {};
  vm.runInNewContext(`${armSource}; this.arm = mlsArmKeepAlive;`, armContext);
  const arm = await armContext.arm(41, true);
  assert.strictEqual(arm.armed, false);
  assert.strictEqual(arm.signedOut, true);
  assert.strictEqual(injections, 0, 'keep-alive marker was injected after exact timeout');
}

(async () => {
  await testAllFrameVetoAndInvalidation();
  await testPickerAlwaysProbes();
  await testHelloAndAlarmFailClosed();
  await testPinStateRequestListRecoveryAndKeepAlive();
  console.log('PASS Athena all-frame session health: exact timeout/login veto, no false positive, no stale cache/pin/keep-alive');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
