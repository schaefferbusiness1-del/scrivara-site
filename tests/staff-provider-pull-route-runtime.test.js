/*
 * The Staff provider selector is a scope control, not a display-only filter.
 * Exercise the actual overlay proxy so a regression cannot silently send the
 * clinician back through the unscoped external hero.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, '1p-mls-connect.js'), 'utf8');

function extractFunction(name) {
  const start = SOURCE.lastIndexOf('function ' + name + '(');
  assert(start >= 0, name + ': function is missing');
  const end = SOURCE.indexOf('\n  /* ---- patient rows', start);
  assert(end > start, name + ': body end marker is missing');
  return SOURCE.slice(start, end).trim();
}

function invoke(providerFilter) {
  const calls = [];
  const external = { click: () => calls.push(['external-hero-click']) };
  const daySwitch = {
    isBusy: () => false,
    setDay: day => { calls.push(['set-day', day]); return true; },
    pullDayFor: target => calls.push(['pull-day-for', target])
  };
  const result = new Function(
    'S', 'window', 'isFn', 'todayLocal', 'handOff', 'findBtnByText', 'toast', 'activeProvider',
    extractFunction('pullTodayProxy') + '\nreturn pullTodayProxy();'
  )(
    { providerFilter },
    { __mlsDaySwitch: daySwitch },
    value => typeof value === 'function',
    () => '2026-09-12',
    (fn) => fn(),
    () => external,
    () => {},
    () => providerFilter === null ? 'Dr Inherited' : providerFilter
  );
  return { calls, result };
}

assert.deepStrictEqual(invoke('Dr Ada').calls, [
  ['set-day', '2026-09-12'],
  ['pull-day-for', 'Dr Ada']
], 'selected Staff provider must be frozen into the canonical DaySwitch pull');

assert.deepStrictEqual(invoke('').calls, [
  ['set-day', '2026-09-12'],
  ['pull-day-for', 'all']
], 'All Staff providers must use the canonical DaySwitch pull with an explicit all scope');

assert.deepStrictEqual(invoke(null).calls, [
  ['set-day', '2026-09-12'],
  ['pull-day-for', 'Dr Inherited']
], 'an inherited displayed provider must remain scoped instead of widening to all');

const staffShortcutStart = SOURCE.indexOf("$('ez3sPullToday')");
assert(staffShortcutStart >= 0, 'Staff practice-tools shortcut must target #ez3sPullToday');
assert(/b\.onclick\s*=\s*pullTodayProxy/.test(SOURCE),
  '#ez3sPullToday must use the provider-aware Staff proxy');

const homeRender = SOURCE.slice(SOURCE.lastIndexOf('function renderHome()'), SOURCE.lastIndexOf('function dobLabelPlain'));
const staffRender = SOURCE.slice(SOURCE.lastIndexOf('function renderStaff()'), SOURCE.lastIndexOf('function seg('));
assert(/var todayPullReady = canonicalDayPullReady\(\)/.test(homeRender) &&
  !/findBtnByText\(\/pull today/.test(homeRender),
  'home Staff pull control must not depend on the external hero');
assert(/var todayBtn = canonicalDayPullReady\(\)/.test(staffRender) &&
  !/findBtnByText\(\/pull today/.test(staffRender),
  'Staff pull control must remain visible when only the canonical DaySwitch API exists');
assert(/function canonicalDayPullReady\(\)[\s\S]*ds\.setDay[\s\S]*ds\.pullDayFor/.test(SOURCE),
  'today controls must be gated by canonical DaySwitch readiness');
const readyStart = SOURCE.lastIndexOf('function canonicalDayPullReady()');
const readyEnd = SOURCE.indexOf('\n\n  function renderHome()', readyStart);
const canonicalDayPullReady = new Function(
  'window', 'isFn', SOURCE.slice(readyStart, readyEnd) + '\nreturn canonicalDayPullReady;'
)({ __mlsDaySwitch: { setDay() {}, pullDayFor() {} } }, value => typeof value === 'function');
assert.strictEqual(canonicalDayPullReady(), true,
  'the canonical Staff control must stay available without an external hero button');

const daySwitchApiStart = SOURCE.indexOf('api.pullDay = startPull;');
assert(daySwitchApiStart >= 0 && /api\.pullDayFor\s*=\s*function \(providerTarget\) \{ return startPull\(false, providerTarget\); \}/.test(
  SOURCE.slice(daySwitchApiStart, daySwitchApiStart + 520)
), 'Staff explicit target must remain on the canonical startPull engine');
const pullLane = SOURCE.slice(SOURCE.indexOf('function startPull(autoRetry, providerOverride)'), SOURCE.indexOf('function resetDaySwitchSession()'));
assert(/startPull\(DS_PREF_READY, providerOverride\)/.test(pullLane),
  'the frozen Staff scope must survive the full-visit-notes choice gate');
assert(/!automaticRetry && providerOverride === undefined/.test(pullLane),
  'the mutable Easy selector must not overwrite an explicit Staff scope');
const providerFreezeAt = pullLane.indexOf('var easyProviderOwner = window.__mlsEasyV32;');
const relayForkAt = pullLane.indexOf('window.__mlsRelayLink && window.__mlsRelayLink.shouldRelay');
assert(providerFreezeAt >= 0 && relayForkAt > providerFreezeAt,
  'the visible provider must be frozen before choosing the relay or local pull path');
assert(/__mlsRelayLink\.pullDay\(rday, \{[\s\S]*?provider:\s*DS\.pullProviderScope,[\s\S]*?onStatus:/.test(pullLane),
  'the office-computer relay must receive the same frozen selected/all provider scope');
assert(/dpOpts\.provider = DS\.pullProviderScope/.test(pullLane),
  'the explicit Staff scope must be handed to the guarded importer options');

console.log('PASS staff-provider-pull-route-runtime: Staff selected/all scopes use DaySwitch and never click the unscoped external hero.');
