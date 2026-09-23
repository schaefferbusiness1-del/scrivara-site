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

/* b1303: this section used to extract the LAST pullTodayProxy in the bundle,
   which was a copy inside a retired Easy owner that returned before
   installing - the assertions below it were proving unreachable code. With
   the retired owners deleted there is one copy, and it routes through
   startDayPull -> __mlsSI.dayPull with the Staff picker's request as scope.
   Exercise that live chain. */
function extractLive(name, near) {
  const sig = '  function ' + name + '(';
  /* the copy in the proxy's own module: the definition nearest to it */
  let at = SOURCE.indexOf(sig);
  if (near !== undefined) for (let k = at; k >= 0; k = SOURCE.indexOf(sig, k + 1)) { if (Math.abs(k - near) < Math.abs(at - near)) at = k; }
  assert(at >= 0, name + ': function is missing');
  let i = SOURCE.indexOf('{', at), depth = 0;
  for (; i < SOURCE.length; i++) {
    const c = SOURCE[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) break; }
  }
  return SOURCE.slice(at, i + 1);
}
const proxyAt = SOURCE.indexOf('  function pullTodayProxy(');
assert(proxyAt >= 0 && SOURCE.indexOf('  function pullTodayProxy(', proxyAt + 1) < 0, 'exactly one pullTodayProxy remains');
assert(/function pullTodayProxy\(\) \{[\s\S]*?startDayPull\(false\);\s*\}/.test(extractLive('pullTodayProxy')),
  'the Staff proxy starts the guarded day lane');
const LIVE = ['activeProvider', 'activeProviderRequest', 'startDayPull'].map((n) => extractLive(n, proxyAt)).join('\n');

function invoke(providerFilter, roster) {
  const calls = [];
  const win = {
    __mlsSI: { dayPull: (o) => { calls.push(['day-pull', o.date, o.provider]); return Promise.resolve({ complete: true, calendarReceipt: {}, historyReceipt: {} }); } },
    __mlsProviderRoster: roster
  };
  new Function(
    'S', 'window', 'isFn', 'safe', 'todayLocal', 'resolveAppProvider', 'admitStaffVisitChoice', 'freshPull',
    'p1RangeFullNotes', 'pSet', 'plog', 'pCounts', 'render', 'toast',
    'var P = null;\n' + LIVE + '\nreturn startDayPull(false);'
  )(
    { providerFilter, providerRef: '' }, win,
    (v) => typeof v === 'function',
    (fn, d) => { try { return fn(); } catch (e) { return d; } },
    () => '2026-09-12',
    () => 'Dr Inherited',
    (cb) => cb(false),
    (range, label) => ({ range, label, dayStatus: {}, failedDays: [], emptyDays: [] }),
    () => false, () => {}, () => {}, () => {}, () => {}, () => {}
  );
  return { calls };
}

assert.deepStrictEqual(invoke('Dr Ada').calls, [['day-pull', '2026-09-12', 'Dr Ada']],
  'selected Staff provider must be the scope of the guarded day pull');
assert.deepStrictEqual(invoke('').calls, [['day-pull', '2026-09-12', 'all']],
  'All Staff providers must pull with an explicit all scope');
assert.deepStrictEqual(invoke(null).calls, [['day-pull', '2026-09-12', 'Dr Inherited']],
  'an inherited displayed provider must remain scoped instead of widening to all');
const exactRef = { id: 'prov-7', name: 'Dr Ada' };
assert.deepStrictEqual(invoke('Dr Ada', { resolve: (ref) => (ref === 'Dr Ada' ? exactRef : null) }).calls, [['day-pull', '2026-09-12', exactRef]],
  'a roster-resolved provider is passed as its exact reference');

const staffShortcutStart = SOURCE.indexOf("$('ez3sPullToday')");
assert(staffShortcutStart >= 0, 'Staff practice-tools shortcut must target #ez3sPullToday');
assert(/on\('ez3sPullToday', pullTodayProxy\)/.test(SOURCE),
  '#ez3sPullToday must use the provider-aware Staff proxy');

const homeRender = extractLive('renderHome', proxyAt);
const staffRender = extractLive('renderStaff', proxyAt);
assert(!/findBtnByText\(\/pull today/i.test(homeRender) && !/findBtnByText\(\/pull today/i.test(staffRender),
  'the Staff and home pull controls must not depend on the external hero');
assert(/id="ez3sPullToday"/.test(extractLive('pullPanelHtml', proxyAt)),
  'the Staff pull panel always renders "Pull today only" - no external hero is needed to reach it');

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

console.log('PASS staff-provider-pull-route-runtime: the live Staff proxy pulls through the guarded day lane with the selected/all/inherited scope, and the DaySwitch lane keeps the frozen scope.');
