'use strict';

/* A stale keep-alive receipt is diagnostic state, never permission to move an
 * Athena tab. Exercise the shipped watchdog with PHI-free synthetic receipts. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, '1p-mls-connect.js'), 'utf8');
const start = connect.indexOf('/* ===== kal-1.0.1');
const end = connect.indexOf('/* ===== psr-1.0.0', start);
assert.ok(start >= 0 && end > start, 'could not isolate the keep-alive watchdog');
const source = connect.slice(start, end);

function harness(options) {
  options = options || {};
  const now = 2000000;
  const listeners = [];
  const posted = [];
  const timers = [];
  const window = {
    __mlsDayHistoryPull: { state: { running: options.pullRunning === true } },
    __mlsPtsPullActive() { return false; },
    addEventListener(name, fn) { if (name === 'message') listeners.push(fn); },
    removeEventListener(name, fn) { const at = listeners.indexOf(fn); if (at >= 0) listeners.splice(at, 1); },
    postMessage(value) { posted.push(value); }
  };
  const context = vm.createContext({
    window,
    Date: { now() { return now; } },
    Promise,
    Blob: function Blob() {},
    URL: { createObjectURL() { return 'blob:keepalive'; } },
    Worker: function Worker() { this.onmessage = null; },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    setInterval() { return 1; },
    isRecording() { return options.recording === true; }
  });
  vm.runInContext(source, context, { filename: '1p-mls-connect.js#keepalive' });
  function answerHealth(lastTick) {
    const request = timers.filter(row => row.ms === 8000)[0];
    assert.ok(request, 'initial health probe was not scheduled');
    request.fn();
    assert.strictEqual(posted[0] && posted[0].type, 'mlsExtHealth', 'watchdog did not begin with a read-only health request');
    listeners.slice().forEach(fn => fn({ data: { source: 'mls-ext', type: 'mlsExtHealthResult', resp: {
      ok: true, ka: { lastTick }, athena: { tabs: 1 }
    } } }));
  }
  return { window, posted, answerHealth, now };
}

(async () => {
  let h = harness();
  h.answerHealth(h.now - 500000);
  await Promise.resolve(); await Promise.resolve();
  assert.deepStrictEqual(h.posted.map(row => row.type), ['mlsExtHealth'], 'stale health autonomously navigated Athena');
  assert.strictEqual(h.window.__mlsKeepAliveWatch.lastVerdict, 'native-keepalive-stale-no-navigation');
  assert.strictEqual(h.window.__mlsKeepAliveWatch.goHomes, 0, 'watchdog recorded an autonomous Home navigation');
  assert.strictEqual(h.window.__mlsKeepAliveWatch.ledger[0].act, 'health-stale', 'stale state lacks its PHI-free diagnostic receipt');

  h = harness({ pullRunning: true });
  h.answerHealth(h.now - 500000);
  await Promise.resolve(); await Promise.resolve();
  assert.deepStrictEqual(h.posted.map(row => row.type), ['mlsExtHealth'], 'running pull allowed watchdog navigation');
  assert.strictEqual(h.window.__mlsKeepAliveWatch.lastVerdict, 'stale-but-pull-running', 'watchdog ignored the pull state.running contract');

  /* Explicit pull and recovery owners still retain their own Home requests. */
  const outsideWatchdog = connect.slice(0, start) + connect.slice(end);
  assert.ok((outsideWatchdog.match(/mlsAppGoHome/g) || []).length > 5, 'explicit pull/recovery Home paths were accidentally removed');
  console.log('PASS keep-alive never navigates Athena: 9 checks');
})().catch(error => { console.error(error && error.stack || error); process.exit(1); });
