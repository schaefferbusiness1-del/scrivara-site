'use strict';

/* PHI-free passive Athena readiness contract (2026-07-18).
 *
 * Passive boot/poll/status/doctor code may use only mlsPing + mlsExtHealth.
 * A ready result means worker health plus an exact non-discarded Athena tab;
 * it never means signed in, chart-readable, or patient/encounter verified.
 * Explicit clinician-started schedule pulls remain a separate supported path.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');

function makeWindow() {
  const listeners = [];
  const posted = [];
  const document = {
    visibilityState: 'visible',
    addEventListener() {},
    removeEventListener() {}
  };
  const win = {
    document,
    location: { origin: 'https://mlsscribe.com' },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) {
      if (type !== 'message') return;
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    postMessage(msg) { posted.push(JSON.parse(JSON.stringify(msg))); }
  };
  win.window = win;
  return { win, document, listeners, posted };
}

function bootConnTruth() {
  const env = makeWindow();
  vm.runInNewContext(read('mls-connection-truth.js'), {
    window: env.win,
    document: env.document,
    setTimeout,
    clearTimeout,
    setInterval() { return 1; },
    clearInterval() {},
    Date, Promise, Object, String, Number, Error, Math, JSON, console
  }, { filename: 'mls-connection-truth.js', timeout: 5000 });
  assert(env.win.__mlsConnTruth && env.win.__mlsConnTruth.installed);
  return env;
}

function deliver(env, data) {
  for (const fn of env.listeners.slice()) fn({ data });
}

function tick(ms = 15) { return new Promise(resolve => setTimeout(resolve, ms)); }

function exerciseTrustedScheduleBridge(content) {
  const start = content.indexOf('  var MLS_BRIDGE_TYPES');
  const end = content.indexOf('  /* Background progress is delivered', start);
  assert(start >= 0 && end > start, 'could not isolate the real content bridge');
  const source = content.slice(start, end);
  const messageListeners = [];
  const posted = [];
  const runtimeMessages = [];
  const window = {
    addEventListener(type, fn) { if (type === 'message') messageListeners.push(fn); },
    removeEventListener() {},
    postMessage(payload, target) { posted.push({ payload: JSON.parse(JSON.stringify(payload)), target }); }
  };
  const document = { addEventListener() {} };
  const chrome = {
    storage: {
      local: { get(_keys, cb) { cb({ mlsTrustedOrigins: ['http://127.0.0.1:4173'] }); } },
      onChanged: { addListener() {} }
    },
    runtime: {
      lastError: null,
      getManifest() { return { version: '2.9.synthetic', version_name: 'synthetic' }; },
      sendMessage(message, cb) {
        runtimeMessages.push(JSON.parse(JSON.stringify(message)));
        if (message.type === 'mlsAppScheduleRequest') {
          cb({ ok: true, scheduleVerified: true, appts: [{ name: 'Synthetic Test Patient', time: '9:00 AM' }] });
          return;
        }
        if (message.type === 'mlsExtHealthRequest') {
          cb({ ok: true, athena: { tabs: 1, discarded: 0 } });
          return;
        }
        cb({ ok: false, reason: 'unexpected-test-message' });
      }
    }
  };
  vm.runInNewContext(source, {
    window, document, chrome,
    location: { origin: 'https://mlsscribe.com' },
    URL, Date, Math, Object, Array, String, Number, Boolean, RegExp, JSON,
    Uint32Array, crypto: { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = i + 1; return a; } },
    setTimeout, clearTimeout, isFinite,
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; }
  }, { filename: 'content-bridge-slice.js', timeout: 5000 });
  assert.strictEqual(messageListeners.length, 1, 'content bridge installed an unexpected number of message listeners');
  const onMessage = messageListeners[0];

  onMessage({
    origin: 'https://mlsscribe.com',
    data: { source: 'mls-app', type: 'mlsAppPullSchedule', requestId: 'explicit-synthetic-pull', deadlineAt: Date.now() + 5000 }
  });
  const relayed = runtimeMessages.find(m => m.type === 'mlsAppScheduleRequest');
  assert(relayed, 'trusted explicit MLS schedule pull did not reach the extension worker');
  assert.strictEqual(relayed.requestId, 'explicit-synthetic-pull');
  const result = posted.find(x => x.payload.type === 'mlsAppScheduleResult');
  assert(result && result.payload.resp && result.payload.resp.ok === true, 'trusted explicit schedule result was not returned');
  assert.strictEqual(result.target, 'https://mlsscribe.com');

  const beforeLoopbackRuntime = runtimeMessages.length;
  for (const type of ['mlsAppPullSchedule', 'mlsAppReadChart', 'mlsAppReadVisits', 'mlsAppPasteNote', 'mlsAppPushVisit', 'mlsAppAthenaActionV2']) {
    const requestId = `loopback-block-${type}`;
    onMessage({ origin: 'http://127.0.0.1:4173', data: { source: 'mls-app', type, requestId } });
    const blocked = posted.find(x => x.payload.type === 'mlsBridgeBlocked' && x.payload.requestId === requestId);
    assert(blocked && blocked.payload.resp.reason === 'loopback-synthetic-only', `loopback ${type} was not blocked`);
  }
  assert.strictEqual(runtimeMessages.length, beforeLoopbackRuntime, 'a loopback clinical request reached the worker');
}

async function exerciseDoctorHealthOnly() {
  const listeners = [];
  const posted = [];
  const document = {
    readyState: 'loading',
    addEventListener() {}, removeEventListener() {}, getElementById() { return null; }
  };
  const window = {
    document,
    __mlsAthenaStatusDot: { pingExtension() { return Promise.resolve(true); } },
    addEventListener(type, fn) { if (type === 'message') listeners.push(fn); },
    removeEventListener(type, fn) {
      if (type !== 'message') return;
      const i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    postMessage(message) {
      posted.push(JSON.parse(JSON.stringify(message)));
      if (message.type === 'mlsExtHealth') {
        setTimeout(() => {
          for (const fn of listeners.slice()) fn({ data: {
            source: 'mls-ext', type: 'mlsExtHealthResult', requestId: message.requestId,
            resp: { ok: true, athena: { tabs: 1, discarded: 0 } }
          } });
        }, 0);
      }
    }
  };
  window.window = window;
  vm.runInNewContext(read('feat_athena_doctor.js'), {
    window, document, setTimeout, clearTimeout, Date, Promise, Object, Array, String, Number, Math, JSON, RegExp, console
  }, { filename: 'feat_athena_doctor.js', timeout: 5000 });
  const result = await window.__mlsAthenaDoctor.runChain(
    { ok: true, count: 2, anyReal: true, stage: 'synthetic-explicit-result' },
    function () {}
  );
  assert.strictEqual(result.ready, true, 'doctor did not accept healthy worker/tab metadata');
  const byId = Object.fromEntries(result.steps.map(step => [step.id, step]));
  assert.strictEqual(byId.tab.status, 'pass');
  assert.strictEqual(byId.perm.status, 'pass');
  assert(/not verified yet/i.test(byId.perm.detail));
  assert(posted.some(message => message.type === 'mlsExtHealth'));
  assert(!posted.some(message => message.type === 'mlsAppPullSchedule'), 'doctor diagnostic pulled a schedule');
}

(async () => {
  // Worker-health failure: reload the extension, never blame or inspect Athena.
  {
    const env = bootConnTruth();
    const done = env.win.__mlsConnTruth.check();
    await tick();
    const ping = env.posted.find(m => m.type === 'mlsPing');
    assert(ping && ping.requestId, 'readiness ping is not request-correlated');
    deliver(env, { source: 'mls-ext', type: 'mlsPong', requestId: ping.requestId });
    await tick();
    const health = env.posted.find(m => m.type === 'mlsExtHealth');
    assert(health && health.requestId, 'readiness health request is not correlated');
    assert(!env.posted.some(m => m.type === 'mlsAppPullSchedule'), 'passive readiness requested a live schedule');
    deliver(env, {
      source: 'mls-ext', type: 'mlsExtHealthResult', requestId: health.requestId,
      resp: { ok: false, reason: 'worker-unreachable' }
    });
    const state = await done;
    assert.strictEqual(state.status, 'error');
    assert(/chrome:\/\/extensions/i.test(state.reason));
    assert(/Athena was not read/i.test(state.reason));
    assert(!/sign in/i.test(state.reason), 'passive health inferred Athena sign-in state');
  }

  // Foreign health replies cannot settle a probe; exact loaded-tab metadata can.
  {
    const env = bootConnTruth();
    const done = env.win.__mlsConnTruth.check();
    await tick();
    const ping = env.posted.find(m => m.type === 'mlsPing');
    deliver(env, { source: 'mls-ext', type: 'mlsPong', requestId: ping.requestId });
    await tick();
    const health = env.posted.find(m => m.type === 'mlsExtHealth');
    deliver(env, {
      source: 'mls-ext', type: 'mlsExtHealthResult', requestId: 'foreign-health',
      resp: { ok: true, athena: { tabs: 0, discarded: 0 } }
    });
    await tick();
    deliver(env, {
      source: 'mls-ext', type: 'mlsExtHealthResult', requestId: health.requestId,
      resp: { ok: true, athena: { tabs: 2, discarded: 1 } }
    });
    const state = await done;
    assert.strictEqual(state.status, 'connected'); // compatibility vocabulary
    assert.strictEqual(state.tab, true);
    assert.strictEqual(state.tabs, 2);
    assert.strictEqual(state.discarded, 1);
    assert.strictEqual(state.patientVerified, false);
    assert.strictEqual(state.encounterVerified, false);
    assert(/not yet verified/i.test(state.reason));
    await assert.rejects(env.win.__mlsConnTruth.assertReadable(), /Passive readiness cannot verify a chart/i);
  }

  // Every passive owner is schedule-free and uses the same health-only verb.
  for (const file of [
    'mls-connection-truth.js',
    'feat_mls_asst_fix.js',
    'feat_athena_truthcheck.js',
    'feat_athena_doctor.js',
    'feat_athena_status_dot.js'
  ]) {
    const src = read(file);
    assert(src.includes('mlsExtHealth'), `${file} does not use PHI-free health`);
    assert(!src.includes('mlsAppPullSchedule'), `${file} passive path still requests a schedule`);
    assert(!/signed-in[^\n]{0,80}readable/i.test(src), `${file} overclaims signed-in readability`);
  }

  const center = read('feat_mls_status_center.js');
  const sectionA = center.slice(center.indexOf('SECTION A'), center.indexOf('SECTION B'));
  assert(sectionA.includes('mlsExtHealth') && sectionA.includes('mlsExtHealthResult'));
  assert(!sectionA.includes('mlsAppPullSchedule'), 'status-center boot/poll connection section still pulls a schedule');
  assert(!sectionA.includes('mlsAppConnCheck'), 'status center still uses the obsolete non-health probe');
  assert(center.includes("if (d.type === 'mlsAppPullSchedule' && pullBusy.active)"),
    'explicit clinician-started schedule event tracking was removed');

  // The extension health census is exact-host-only.
  const background = read('background.js');
  const healthBlock = background.slice(background.indexOf('MLS EXT HEALTH'), background.indexOf('PHI-SAFE VISITS DOM CENSUS'));
  assert(healthBlock.includes("chrome.tabs.query({ url: 'https://athenanet.athenahealth.com/*' })"),
    'health metadata counts non-product Athena domains');
  assert(!healthBlock.includes("*://*.athenahealth.com/*"));

  // Loopback is synthetic-health-only, while the trusted MLS production origin
  // retains the real schedule relay and its result receipt.
  const content = read('content.js');
  assert(/mlsLoopbackOrigin\(origin\) && d\.type !== 'mlsPing' && d\.type !== 'mlsExtHealth'/.test(content));
  assert(/hostname === 'mlsscribe\.com'/.test(content), 'production MLS origin is not trusted');
  assert(/mlsAppPullSchedule:\s*1/.test(content), 'explicit schedule verb was removed from the allowlist');
  assert(/if \(d\.type === 'mlsAppPullSchedule'\)/.test(content), 'explicit schedule relay handler was removed');
  assert(/type:\s*'mlsAppScheduleRequest'/.test(content), 'trusted schedule request no longer reaches the worker');
  assert(/type:\s*'mlsAppScheduleResult'/.test(content), 'trusted schedule result receipt was removed');
  assert(/type:\s*'mlsExtHealthResult', requestId: __healthRequestId/.test(content), 'health result does not echo correlation id');
  exerciseTrustedScheduleBridge(content);
  await exerciseDoctorHealthOnly();

  // Preserve the prior fail-closed writeback regression: a worker-specific
  // failure must never be rewritten as an Athena sign-in diagnosis.
  const wbsWin = { __mlsConnTruth: null };
  const wbsDoc = {
    readyState: 'loading', addEventListener() {}, removeEventListener() {},
    getElementById() { return null; }, querySelectorAll() { return []; },
    createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; }
  };
  vm.runInNewContext(read('feat_mls_writeback_safety.js'), {
    window: wbsWin, document: wbsDoc,
    setTimeout, clearTimeout, setInterval() { return 0; }, clearInterval() {},
    MutationObserver: function () { this.observe = function () {}; this.disconnect = function () {}; },
    Date, Promise, Object, String, Error, Math, JSON, console
  }, { filename: 'feat_mls_writeback_safety.js', timeout: 5000 });
  const wbs = wbsWin.__mlsWritebackSafety;
  assert(wbs && typeof wbs.evaluate === 'function');
  const baseCtx = {
    patient: { name: 'Synthetic Test Patient', dob: '01/02/1980', mrn: 'TEST-0001' },
    beaconName: 'Synthetic Test Patient', sections: [{ key: 'plan', text: 'synthetic test plan' }]
  };
  const reloadReason = 'MLS Assist was detected, but its worker health check failed — reload MLS Assist at chrome://extensions. Athena was not read.';
  const verdict = wbs.evaluate(Object.assign({}, baseCtx, { athena: 'disconnected', athenaReason: reloadReason }));
  const block = (verdict.hardBlocks || verdict.blocks || []).find(item => item.code === 'ATHENA_DISCONNECTED');
  assert(block, 'unavailable readiness must fail closed for writeback');
  assert.strictEqual(block.detail, reloadReason);
  assert(!/sign in to athenaone/i.test(block.detail));

  // Preserve extension-health screen degradation/recovery assertions.
  const connect = read('mls-connect.js');
  assert(/Extension runtime.*background worker crashed or Chrome invalidated it/.test(connect));
  assert(/bridge-error\|worker-unreachable\|no-response/.test(connect));
  assert(/does not report permissions\/alarms\/tab state yet/.test(connect));

  console.log('PASS PHI-free readiness: passive owners use correlated health metadata only; exact Athena tab census; loopback blocked from clinical verbs; trusted explicit schedule relay preserved');
})().catch(error => {
  console.error(error && error.stack || error);
  process.exit(1);
});
