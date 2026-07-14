'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const pullflow = fs.readFileSync(path.join(root, 'feat_mls_pullflow.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
const stagingApp = fs.readFileSync(path.join(root, 'ScribeFlow-staging.html'), 'utf8');

function count(re, text) { return (text.match(re) || []).length; }

function functionSlices(text, name, nextName) {
  const out = [];
  const marker = `function ${name}(`;
  let from = 0;
  while (true) {
    const start = text.indexOf(marker, from);
    if (start < 0) break;
    const end = text.indexOf(`\n  function ${nextName}(`, start);
    assert(end > start, `could not bound ${name}`);
    out.push(text.slice(start, end));
    from = end;
  }
  return out;
}

const starters = functionSlices(connect, 'startTodayPull', 'maybeAutoPull');
const passiveReconcilers = functionSlices(connect, 'maybeAutoPull', 'emptyTodayHtml');

assert.strictEqual(starters.length, 3, 'all three guarded Visit-workspace copies must carry the safety gate');
assert.strictEqual(passiveReconcilers.length, 3, 'all three guarded Visit-workspace copies must keep passive reconciliation');

for (const src of starters) {
  assert(src.includes('if (manual !== true)'), 'every pull entry must reject a missing explicit-user marker');
  assert(src.indexOf('if (manual !== true)') < src.indexOf('window.pullScheduleViaAssist()'), 'the explicit-user gate must precede the Athena bridge');
}
for (const src of passiveReconcilers) {
  assert(!/pullScheduleViaAssist|_importPulledSchedule|_pullAllHistories|__mlsSI\.pull/.test(src), 'startup reconciliation must not read or import Athena data');
}

assert.strictEqual(count(/startTodayPull\(false\)/g, connect), 0, 'no startup/sign-in/visibility path may initiate a pull');
assert.strictEqual(count(/maybeAutoPull\(\);/g, connect), 0, 'boot and polling must not invoke the legacy auto-pull reconciler');
assert(count(/function boot\(\) \{ mount\(\); startPoll\(\); \}/g, connect) >= starters.length, 'each Visit-workspace copy must boot passively');
assert.strictEqual(count(/on\('ez3PullNow', function \(\) \{ startTodayPull\(true\); \}\);/g, connect), 2, 'active and first fallback workspaces must retain their explicit pull button');
assert.strictEqual(count(/b\.onclick = function \(\) \{ startTodayPull\(true\); \};/g, connect), 1, 'legacy fallback workspace must retain its explicit pull button');

assert(!/doRetry\(true\)/.test(pullflow), 'the restored recovery panel must never auto-retry an Athena read');
assert(/function doRetry\(isAuto\) \{[\s\S]*?if \(isAuto\) return;/.test(pullflow), 'stale retry timers must fail closed');
const pullflowBoot = pullflow.slice(pullflow.indexOf('function boot()'), pullflow.indexOf('/* ---- public API'));
assert(!/pullScheduleViaAssist|_importPulledSchedule|_pullAllHistories|__mlsSI\.pull/.test(pullflowBoot), 'pullflow boot/rehydration must be status-only');

assert.strictEqual(count(/pullScheduleViaAssist\s*\(/g, app), 2, 'production app must expose only the visible button call and function definition');
assert.strictEqual(count(/pullScheduleViaAssist\s*\(/g, stagingApp), 2, 'staging app must expose only the visible button call and function definition');

// Execute the active pull entry with a minimal harness: passive startup is a
// no-op, while one explicit click crosses the bridge exactly once.
const context = {
  S: { autoPull: 'idle', autoPullNote: '', autoPullAt: 0 },
  P: { running: false },
  cleanup: [],
  calls: { bridge: 0, lease: 0, marked: 0, rendered: 0, intervals: 0 },
  window: { pullScheduleViaAssist() { context.calls.bridge++; } },
  todayCountUnscoped() { return 0; },
  isFn(fn) { return typeof fn === 'function'; },
  claimPullLease() { context.calls.lease++; return true; },
  releasePullLease() {},
  markAutoPull() { context.calls.marked++; },
  render() { context.calls.rendered++; },
  toast() {},
  heroPullStatusText() { return ''; },
  $() { return null; },
  setInterval() { context.calls.intervals++; return 7; },
  clearInterval() {},
  Date
};
vm.createContext(context);
vm.runInContext(`var autoPullIv = null;\n${starters[0]}\n${passiveReconcilers[0]}\nthis.startTodayPull = startTodayPull; this.maybeAutoPull = maybeAutoPull;`, context);

context.maybeAutoPull();
context.startTodayPull(false);
assert.deepStrictEqual(context.calls, { bridge: 0, lease: 0, marked: 0, rendered: 0, intervals: 0 }, 'startup and passive reconciliation must have zero Athena side effects');

context.startTodayPull(true);
assert.strictEqual(context.calls.bridge, 1, 'one explicit click must invoke exactly one schedule/history pull');
assert.strictEqual(context.calls.lease, 1, 'one explicit click must acquire exactly one pull lease');
assert.strictEqual(context.calls.marked, 1, 'one explicit click may mark exactly one requested pull cycle');
assert.strictEqual(context.calls.intervals, 1, 'one explicit click may start exactly one bounded progress monitor');

console.log('PASS startup is Athena-passive and explicit pull invokes exactly once');
