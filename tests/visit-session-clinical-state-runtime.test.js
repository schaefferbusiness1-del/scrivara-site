'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'mls-connect.js'), 'utf8');

function sliceFunction(name, nextMarker) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf(nextMarker, start);
  assert(start >= 0 && end > start, `could not bound ${name}`);
  return source.slice(start, end);
}

{
  const easyReset = sliceFunction('resetEasySession', "\n  window.addEventListener('mls:session-boundary', resetEasySession)");
  const events = [];
  let pullCancelled = 0;
  let backgroundCancelled = 0;
  let bindingClears = 0;
  let renders = 0;
  const context = {
    P: { running: true, patientName: 'Account A Patient' },
    S: {
      mode: 'staff', screen: 'staff', visitDay: '2026-08-14',
      appt: { id: 'A-ROW', name: 'Account A Patient' }, locked: { id: 'A-ROW' },
      phase: 'note', recStart: 88, genClickedAt: 10, signedAt: 12,
      expanded: 'A-ROW', editing: true, lastWarn: 'Account A warning', showCount: 99,
      providerFilter: 'Account A Provider', providerRef: 'A-PROVIDER-REF',
      staffRange: 'custom', customFrom: '2026-08-01', customTo: '2026-08-31',
      advOpen: true, query: 'Account A Patient', autoPull: 'done', autoPullAt: 22, autoPullNote: 'Account A status'
    },
    cancelPullRun() { pullCancelled += 1; },
    cancelBgWaits() { backgroundCancelled += 1; }, abortPullFetches() { backgroundCancelled += 1; }, releasePullLease() { backgroundCancelled += 1; },
    isRecording() { return false; }, todayLocal() { return '2026-07-19'; },
    safe(fn, fallback) { try { return fn(); } catch (_) { return fallback; } },
    $(id) { return id === 'ez3Confirm' ? { remove() { events.push('confirm-removed'); } } : null; },
    mount() { events.push('mounted'); }, render() { renders += 1; },
    signalEasyMode(phase, reason) { events.push(`${phase}:${reason}`); },
    window: {
      _athenaSetVisitBinding(value, replace) { assert.strictEqual(value, null); assert.strictEqual(replace, true); bindingClears += 1; }
    }
  };
  vm.createContext(context);
  vm.runInContext(`${easyReset}\nthis.reset=resetEasySession;`, context);
  assert.strictEqual(context.reset(), true);
  assert.strictEqual(pullCancelled, 1, 'session reset did not cancel the old Staff pull');
  assert(backgroundCancelled >= 3, 'session reset did not abort old background work');
  assert.strictEqual(context.P, null, 'session reset retained Account A pull state');
  assert.strictEqual(context.S.mode, 'doctor'); assert.strictEqual(context.S.screen, 'home');
  assert.strictEqual(context.S.visitDay, '2026-07-19');
  assert.strictEqual(context.S.appt, null); assert.strictEqual(context.S.locked, null);
  /* '' is Easy's canonical all/account-scope selection; null means "follow the
     app provider" in the older bundles. Both clear Account A, but this bundle
     intentionally resets to the account-wide view. */
  assert.strictEqual(context.S.providerFilter, ''); assert.strictEqual(context.S.providerRef, '');
  assert.strictEqual(context.S.query, ''); assert.strictEqual(context.S.customFrom, ''); assert.strictEqual(context.S.customTo, '');
  assert.strictEqual(context.S.phase, 'idle'); assert.strictEqual(context.S.autoPull, 'idle');
  assert.strictEqual(bindingClears, 1, 'Easy reset did not clear the visit binding');
  assert.deepStrictEqual(events.filter(item => /session-boundary/.test(item)), ['before:session-boundary', 'after:session-boundary']);
  assert(renders >= 1, 'Easy reset did not repaint the empty doctor home');
}

{
  const dayReset = sliceFunction('resetDaySwitchSession', "\n  window.addEventListener('mls:easy-visit-day-changed', onEasyVisitDayChanged)");
  const removed = [];
  let easyDay = '';
  let ensured = 0;
  const nodes = new Map(['mlsDsStrip', 'mlsDsList', 'mlsDsPullBar'].map(id => [id, { remove() { removed.push(id); } }]));
  const context = {
    DS: {
      day: '2026-08-14', followToday: false, pulling: true, retrying: true,
      lastResult: { patientName: 'Account A Patient' }, statusLog: ['Account A Provider'], sessionSerial: 4
    },
    todayKey() { return '2026-07-19'; },
    $(id) { return nodes.get(id) || null; },
    ensure() { ensured += 1; },
    window: { __mlsEasyV32: { remote: { setVisitDay(day) { easyDay = day; return true; } } } }
  };
  vm.createContext(context);
  vm.runInContext(`${dayReset}\nthis.reset=resetDaySwitchSession;`, context);
  assert.strictEqual(context.reset(), true);
  assert.strictEqual(context.DS.day, '2026-07-19'); assert.strictEqual(context.DS.followToday, true);
  assert.strictEqual(context.DS.pulling, false); assert.strictEqual(context.DS.retrying, false);
  assert.strictEqual(context.DS.lastResult, null); assert.deepStrictEqual(Array.from(context.DS.statusLog), []);
  assert.strictEqual(context.DS.sessionSerial, 5, 'late Account A pull callbacks were not invalidated');
  assert.strictEqual(easyDay, '2026-07-19', 'DaySwitch did not return Easy to account-local Today');
  assert.deepStrictEqual(removed.sort(), ['mlsDsList', 'mlsDsPullBar', 'mlsDsStrip']);
  assert.strictEqual(ensured, 1, 'DaySwitch did not reconcile its sole current-day strip');
}

assert(source.includes("window.addEventListener('mls:session-boundary', resetEasySession)"), 'Easy is not subscribed to synchronous account boundaries');
assert(source.includes("window.removeEventListener('mls:session-boundary', resetEasySession)"), 'Easy revert leaks its account-boundary listener');
assert(source.includes("window.addEventListener('mls:session-boundary', resetDaySwitchSession)"), 'DaySwitch is not subscribed to synchronous account boundaries');
assert(source.includes("window.removeEventListener('mls:session-boundary', resetDaySwitchSession)"), 'DaySwitch revert leaks its account-boundary listener');

console.log('PASS visit session clinical reset: Easy, DaySwitch, pull state, provider/date selection, patient lock, and binding clear synchronously at account boundary');
