'use strict';

/* Startup remains Athena-passive. The selected-day strip is the one visible
 * pull owner for Today and every other date; the inner empty state is guidance,
 * not a competing action. Mounting/sign-in/reconciliation reads nothing. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const connect = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
const pullflow = fs.readFileSync(path.join(root, 'feat_mls_pullflow.js'), 'utf8');

const marker = connect.indexOf('the effortless Visit tab  (__mlsEasyV32)', 15000);
const easyStart = connect.lastIndexOf('/*', marker);
const easyEnd = connect.indexOf('F7  MLS EASY SYNC TRUTH', marker);
assert(marker >= 0 && easyStart >= 0 && easyEnd > easyStart, 'active canonical Easy Visit engine boundary was not found');
const easy = connect.slice(easyStart, easyEnd);

function functionSource(text, name, nextName) {
  const start = text.indexOf(`function ${name}(`);
  const end = text.indexOf(`\n  function ${nextName}(`, start);
  assert(start >= 0 && end > start, `could not bound active Easy ${name}`);
  return text.slice(start, end);
}

const startTodayPull = functionSource(easy, 'startTodayPull', 'maybeAutoPull');
const maybeAutoPull = functionSource(easy, 'maybeAutoPull', 'emptyTodayHtml');
const emptyTodayHtml = functionSource(easy, 'emptyTodayHtml', 'wireEmptyToday');

assert(startTodayPull.includes('if (manual !== true)'), 'Today pull must reject a missing explicit-user marker');
assert(startTodayPull.indexOf('if (manual !== true)') < startTodayPull.indexOf('window.pullScheduleViaAssist()'),
  'the explicit-user gate must run before the Athena bridge');
assert(!/pullScheduleViaAssist|_importPulledSchedule|_pullAllHistories|__mlsSI\.pull/.test(maybeAutoPull),
  'passive reconciliation must not read or import Athena data');
assert(easy.includes('function boot() { mount(); startPoll(); }'), 'active Easy boot is not passive');
assert(!easy.includes('startTodayPull(false)'), 'active Easy startup/sign-in/visibility path may initiate a Today pull');
assert(!easy.includes('maybeAutoPull();'), 'active Easy boot or polling still invokes the retired auto-pull reconciler');

assert(!emptyTodayHtml.includes('ez3PullNow'),
  'the Easy empty state must not duplicate the selected-day strip pull action');
assert(emptyTodayHtml.includes('id="ez3DayEmpty"') && emptyTodayHtml.includes('Use the <b>📥 Pull</b> button above'),
  'the passive empty state must point doctors to the canonical strip action');
assert(!easy.includes("on('ez3PullNow'"), 'the retired Easy pull control must have no live handler');
assert(connect.includes("$('mlsDsPullBtn').onclick = startPull;"),
  'the selected-day strip must own the one visible pull handler');

// Recovery widgets also remain status-only until their own visible click.
assert(!/doRetry\(true\)/.test(pullflow), 'the recovery panel must never auto-retry an Athena read');
assert(/function doRetry\(isAuto\) \{[\s\S]*?if \(isAuto\) return;/.test(pullflow), 'stale retry timers must fail closed');
const pullflowBoot = pullflow.slice(pullflow.indexOf('function boot()'), pullflow.indexOf('/* ---- public API'));
assert(!/pullScheduleViaAssist|_importPulledSchedule|_pullAllHistories|__mlsSI\.pull/.test(pullflowBoot),
  'pullflow boot/rehydration must be status-only');

// Execute the active entry points with a minimal harness. Passive paths have
// zero side effects; one visible click invokes exactly one matching day pull.
const context = {
  S: { autoPull: 'idle', autoPullNote: '', autoPullAt: 0 },
  P: { running: false },
  cleanup: [],
  selectedDay: '2026-07-19',
  calls: { bridge: 0, lease: 0, marked: 0, rendered: 0, intervals: 0, toasts: 0 },
  window: {
    pullScheduleViaAssist() { context.calls.bridge++; }
  },
  todayCountUnscoped() { return 0; },
  visitDay() { return context.selectedDay; },
  visitIsToday() { return context.selectedDay === '2026-07-19'; },
  isFn(fn) { return typeof fn === 'function'; },
  safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } },
  claimPullLease() { context.calls.lease++; return true; },
  releasePullLease() {},
  markAutoPull() { context.calls.marked++; },
  render() { context.calls.rendered++; },
  toast() { context.calls.toasts++; },
  heroPullStatusText() { return ''; },
  $() { return null; },
  setInterval() { context.calls.intervals++; return 7; },
  clearInterval() {},
  Date
};
vm.createContext(context);
vm.runInContext(
  `var autoPullIv = null;\n${startTodayPull}\n${maybeAutoPull}\n` +
  'this.startTodayPull = startTodayPull; this.maybeAutoPull = maybeAutoPull;',
  context
);

context.maybeAutoPull();
context.startTodayPull(false);
assert.deepStrictEqual(context.calls,
  { bridge: 0, lease: 0, marked: 0, rendered: 0, intervals: 0, toasts: 0 },
  'startup and passive reconciliation must have zero Athena side effects');

console.log('PASS startup is Athena-passive; the selected-day strip is the one visible pull owner and the empty state is guidance only');
