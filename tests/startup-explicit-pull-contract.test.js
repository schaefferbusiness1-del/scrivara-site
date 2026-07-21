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

// ---- explicit-click audit extensions (owner goal 2026-07-21) ----------------
// Phone relay: the desktop agent may only EXECUTE a server-queued job (created
// by an authenticated click on the phone). Polling alone must never pull.
{
  const relayStart = connect.indexOf("version: 'rl-2.0.0'");
  assert(relayStart > 0, 'active relay module (rl-2.0.0) not found');
  const relay = connect.slice(connect.lastIndexOf('/* ===== __mlsRelayLink', relayStart), connect.indexOf('phoneBarTick', relayStart));
  const tick = relay.slice(relay.indexOf('function agentTick()'), relay.indexOf('var agentIv'));
  assert(tick.includes("if (!job) { agentBusy = false; return; }"), 'an empty relay queue must be a no-op');
  assert(tick.includes('executedJobs[job.id]'), 'a relay job id may execute at most once per device');
  assert(!/si\.pull|pullScheduleViaAssist|_importPulledSchedule/.test(tick),
    'agentTick itself must never enter a pull lane — only the fetched job runners may');
  const runDay = relay.slice(relay.indexOf('function runPullDay(job)'), relay.indexOf('function runPullChart'));
  assert(runDay.includes('job.payload'), 'the relay day pull must run ONLY the queued job payload');
}
// Tab messages: schedule imports are REQUEST-SCOPED. The import listener is
// registered inside the click-driven pull and removed after one result; the
// always-on extension listeners may only stash rows for enrichment.
{
  const app = fs.readFileSync(path.join(root, 'ScribeFlow.html'), 'utf8');
  const pullFn = app.slice(app.indexOf('function onResult(e)'), app.indexOf('function _assistReadAthenaTab'));
  assert(pullFn.includes("window.removeEventListener('message',onResult)"),
    'the schedule-result listener must be one-shot');
  assert(pullFn.includes("window.addEventListener('message',onResult)"),
    'the schedule-result listener must be registered only inside the click-driven pull');
  const passive = connect.slice(connect.indexOf('function extListener(ev)'), connect.indexOf('function chartDobFor'));
  assert(!/(_importPulledSchedule|si\.pull|pullScheduleViaAssist)/.test(passive),
    'the passive extension stash must never import or pull');
}

console.log('PASS startup is Athena-passive; the selected-day strip is the one visible pull owner, the empty state is guidance only, relay executes only phone-queued jobs, and schedule imports are request-scoped');
