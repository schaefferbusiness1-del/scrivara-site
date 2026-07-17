'use strict';

/* Connection-status truth-in-messaging contract (2026-07-17).
 *
 * Live incident it pins: the extension's background worker crashed (Chrome
 * invalidated the runtime), the content bridge answered 'extension-error'
 * within ms, and every status surface told the owner "athenaOne is signed
 * out or unavailable — Sign in to athenaOne" while the real Athena session
 * was signed in and fine. The fix must be named as an EXTENSION RELOAD.
 *
 * Also pins probe correlation: the content bridge echoes requestId (b346);
 * a status probe must never settle on a reply stamped with someone else's
 * id (e.g. a concurrent pull's lease refusal), and must stamp its own.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(ROOT, f), 'utf8'); }

/* ---------------- 1. mls-connection-truth.js runtime behavior ------------- */
function makeWindow() {
  const listeners = [];
  const posted = [];
  const win = {
    addEventListener: (t, fn) => { if (t === 'message') listeners.push(fn); },
    removeEventListener: (t, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
    postMessage: (msg) => { posted.push(msg); },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    location: { origin: 'https://mlsscribe.com' },
    document: { visibilityState: 'visible', addEventListener: () => {} }
  };
  win.window = win;
  return { win, listeners, posted };
}
function deliver(listeners, data) { for (const fn of listeners.slice()) { try { fn({ data }); } catch (e) {} } }

function bootConnTruth() {
  const env = makeWindow();
  const src = read('mls-connection-truth.js');
  vm.runInNewContext(src, {
    window: env.win, document: env.win.document,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    Date, Promise, Object, String, Error, Math, JSON, console
  }, { timeout: 5000 });
  assert(env.win.__mlsConnTruth && env.win.__mlsConnTruth.installed, 'conn-truth did not install');
  return env;
}

(async function connTruthScenarios() {
  /* Scenario A: extension-error control reply -> 'error' + reload wording, no sign-in blame */
  {
    const env = bootConnTruth();
    const ct = env.win.__mlsConnTruth;
    const done = ct.check();
    // ping goes out first
    await new Promise(r => setTimeout(r, 20));
    const ping = env.posted.find(m => m.type === 'mlsPing');
    assert(ping, 'probe did not send mlsPing');
    assert(ping.requestId, 'mlsPing probe is not stamped with requestId');
    deliver(env.listeners, { source: 'mls-ext', type: 'mlsPong', version: '' }); // id-less pong passes
    await new Promise(r => setTimeout(r, 20));
    const sched = env.posted.find(m => m.type === 'mlsAppPullSchedule');
    assert(sched, 'probe did not send mlsAppPullSchedule');
    assert(sched.requestId, 'schedule probe is not stamped with requestId');
    deliver(env.listeners, {
      source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: sched.requestId,
      resp: { ok: false, reason: 'extension-error', error: 'extension error' }
    });
    const st = await done;
    assert.strictEqual(st.status, 'error', 'extension-error must classify as error, got ' + st.status);
    assert(/reload/i.test(st.reason) && /chrome:\/\/extensions/i.test(st.reason),
      'reason must name the extension reload fix: ' + st.reason);
    assert(!/sign in to athenaone/i.test(st.reason), 'reason must NOT tell the user to sign in: ' + st.reason);
    assert(/athenaOne itself may still be signed in/i.test(st.reason), 'reason must exonerate the Athena session');
  }

  /* Scenario B: a FOREIGN-stamped reply (another surface's lease refusal) must not settle the probe */
  {
    const env = bootConnTruth();
    const ct = env.win.__mlsConnTruth;
    const done = ct.check();
    await new Promise(r => setTimeout(r, 20));
    deliver(env.listeners, { source: 'mls-ext', type: 'mlsPong', version: '2.9.26' });
    await new Promise(r => setTimeout(r, 20));
    const sched = env.posted.find(m => m.type === 'mlsAppPullSchedule');
    // foreign reply: someone else's pull got refused — must be ignored
    deliver(env.listeners, {
      source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: 'someone-elses-pull-1',
      resp: { ok: false, reason: 'pull-in-flight' }
    });
    await new Promise(r => setTimeout(r, 20));
    // now OUR real reply lands: a big signed-in schedule text
    deliver(env.listeners, {
      source: 'mls-ext', type: 'mlsAppScheduleResult', requestId: sched.requestId,
      resp: { ok: true, text: new Array(5001).join('x') }
    });
    const st = await done;
    assert.strictEqual(st.status, 'connected',
      'foreign lease refusal settled the probe (status ' + st.status + ': ' + st.reason + ')');
  }
})().then(() => {

  /* ---------------- 2. status-center source pins --------------------------- */
  const sc = read('feat_mls_status_center.js');
  assert(/ext-crashed/.test(sc), 'status center must classify extension-runtime failure (ext-crashed)');
  assert(/extension-error\|bridge-error/.test(sc), 'status center must match the bridge control reasons');
  assert(/setVerdict\('disconnected',\s*'no-extension',\s*cls\.why\)/.test(sc),
    'ext-crashed must resolve definitively with the reload message');
  assert(/payload\.requestId = reqId/.test(sc), 'status-center probes must stamp requestId');
  assert(/d\.requestId && d\.requestId !== reqId/.test(sc), 'status-center probes must ignore foreign-stamped replies');
  assert(/chrome:\/\/extensions, find MLS Assist, press ↻ Reload/.test(sc),
    'the ext-crashed message must name the one-click fix');

  /* ---------------- 3. writeback-safety: reason-truthful hard block -------- */
  const wbsWin = { __mlsConnTruth: null };
  const wbsDoc = {
    readyState: 'loading', addEventListener: () => {}, removeEventListener: () => {},
    getElementById: () => null, querySelectorAll: () => [], createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} })
  };
  vm.runInNewContext(read('feat_mls_writeback_safety.js'), {
    window: wbsWin, document: wbsDoc,
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval: () => {},
    MutationObserver: function () { this.observe = () => {}; this.disconnect = () => {}; },
    Date, Promise, Object, String, Error, Math, JSON, console
  }, { timeout: 5000 });
  const wbs = wbsWin.__mlsWritebackSafety;
  assert(wbs && typeof wbs.evaluate === 'function', 'writeback safety did not install');

  const baseCtx = {
    patient: { name: 'Adam J Schaeffer', dob: '03/24/2006', mrn: '7833832' },
    beaconName: 'Adam J Schaeffer',
    sections: [{ key: 'plan', text: 'follow up in 2 weeks' }]
  };

  /* extension-crash reason -> label blames the extension, detail carries the live reason */
  const reloadReason = 'MLS Assist hit an internal error and needs a reload — open chrome://extensions, find MLS Assist, press Reload. athenaOne itself may still be signed in.';
  let v = wbs.evaluate(Object.assign({}, baseCtx, { athena: 'disconnected', athenaReason: reloadReason }));
  let blk = (v.hardBlocks || v.blocks || []).filter(b => b.code === 'ATHENA_DISCONNECTED')[0];
  assert(blk, 'disconnected must still hard-block (fail closed)');
  assert(/extension needs a reload/i.test(blk.label), 'label must blame the extension, got: ' + blk.label);
  assert.strictEqual(blk.detail, reloadReason, 'detail must carry the live probe reason verbatim');
  assert(!/sign in to athenaone/i.test(blk.detail), 'detail must not command a sign-in for a runtime crash');

  /* no reason supplied -> legacy wording preserved */
  v = wbs.evaluate(Object.assign({}, baseCtx, { athena: 'disconnected' }));
  blk = (v.hardBlocks || v.blocks || []).filter(b => b.code === 'ATHENA_DISCONNECTED')[0];
  assert(blk && /signed out or unavailable/.test(blk.label), 'legacy label must survive when no reason is known');
  assert(/Sign in to athenaOne/.test(blk.detail), 'legacy detail must survive when no reason is known');

  /* ---------------- 4. eh screen source pins ------------------------------- */
  const connect = read('mls-connect.js');
  assert(/Extension runtime.*background worker crashed or Chrome invalidated it/.test(connect),
    'eh screen must carry the empty-version-pong crashed-runtime row');
  assert(/bridge-error\|worker-unreachable\|no-response/.test(connect),
    'eh deep diagnostics must classify bridge control failures as crashed runtime');
  assert(/does not report permissions\/alarms\/tab state yet/.test(connect),
    'eh old-build honest degradation message must survive');

  console.log('PASS conn-status truth: extension-crash never reads as "Athena signed out" (conn-truth runtime, status-center pins, writeback reason-truth, eh rows), probes stamped + foreign replies ignored');
}).catch(e => { console.error(e && e.stack || e); process.exit(1); });
