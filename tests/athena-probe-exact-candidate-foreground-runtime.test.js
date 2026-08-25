'use strict';
/* mdx-2.1.0: a presence-assisted ActionV2 probe must make the exact Athena
 * candidate visible immediately before reading that candidate. With multiple
 * signed-in Athena tabs, fronting one arbitrary tab and probing all tabs can
 * leave the matching encounter occluded. Presence remains read-only/probe-only
 * and must stop when the clinician makes a newer focus choice. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bg = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');

function between(source, start, end) {
  const a = source.indexOf(start);
  assert.ok(a >= 0, 'missing start marker: ' + start);
  const b = source.indexOf(end, a + start.length);
  assert.ok(b > a, 'missing end marker: ' + end);
  return source.slice(a, b);
}

/* Contract boundary: presence is requested only for probe, the exact candidate
   is fronted before its injection, and the post-probe execute rail has no
   access to the focus helper. */
const handler = between(bg, '/* ATHENA_ACTION_V2_HANDLER_START */', '/* ATHENA_ACTION_V2_HANDLER_END */');
assert.ok(handler.includes("var __probePresenceRequested = mode === 'probe' && msg.foregroundOk === true"),
  'foreground presence must be strictly probe-only');
const loopAt = handler.indexOf('for (var athIdx = 0; athIdx < athCandidates.length; athIdx++)');
const frontAt = handler.indexOf('self.__mlsFrontAthenaForRead(sender && sender.tab && sender.tab.id, athCandidates[athIdx].id, __probeFg)', loopAt);
const injectAt = handler.indexOf("injectOnce(athCandidates[athIdx].id, { mode: 'probe'", loopAt);
assert.ok(loopAt >= 0 && frontAt > loopAt && injectAt > frontAt,
  'each exact candidate must be fronted immediately before that candidate is probed');
assert.ok(handler.slice(loopAt, injectAt).includes('if (!__probeFg) { __probeFg = __probeFgBefore; __probePresenceOwned = false; }'),
  'a stale later candidate must retain the prior owned state for the final restore');
const executeRailAt = handler.indexOf('if (!appSender(sender))', injectAt);
assert.ok(executeRailAt > injectAt, 'execute rail boundary must be locatable');
assert.ok(!handler.slice(executeRailAt).includes('__mlsFrontAthenaForRead'),
  'execute must remain fail-closed and must never inherit the probe focus helper');

const helperStart = bg.indexOf('var __mlsFgRestorePending = null;');
const helperEnd = bg.indexOf('chrome.runtime.onMessage.addListener', helperStart);
assert.ok(helperStart >= 0 && helperEnd > helperStart, 'foreground helper block must be locatable');
const helperSource = bg.slice(helperStart, helperEnd);

function makeHarness(tabRows, focusedWindowId) {
  const tabs = tabRows.map(t => Object.assign({}, t));
  const calls = [];
  let pickerCalls = 0;
  let timerId = 0;

  function populatedWindow() {
    return {
      id: focusedWindowId,
      focused: true,
      tabs: tabs.filter(t => t.windowId === focusedWindowId).map(t => Object.assign({}, t)),
    };
  }

  const chrome = {
    runtime: { lastError: null },
    tabs: {
      query: async () => tabs.map(t => Object.assign({}, t)),
      update: (id, opts, cb) => {
        const target = tabs.find(t => Number(t.id) === Number(id));
        if (!target) {
          if (cb) cb();
          return Promise.reject(new Error('missing tab ' + id));
        }
        if (opts && opts.active === true) {
          tabs.forEach(t => { if (t.windowId === target.windowId) t.active = false; });
          target.active = true;
        }
        calls.push(['tab', Number(id), !!(opts && opts.active)]);
        if (cb) cb(Object.assign({}, target));
        return Promise.resolve(Object.assign({}, target));
      },
    },
    windows: {
      getLastFocused: (optsOrCb, maybeCb) => {
        const w = populatedWindow();
        const cb = typeof optsOrCb === 'function' ? optsOrCb : maybeCb;
        if (typeof cb === 'function') { cb(w); return; }
        return Promise.resolve(w);
      },
      update: (id, opts, cb) => {
        if (opts && opts.focused === true) focusedWindowId = Number(id);
        calls.push(['win', Number(id), !!(opts && opts.focused)]);
        if (cb) cb(populatedWindow());
        return Promise.resolve(populatedWindow());
      },
    },
  };

  const sandbox = vm.createContext({
    chrome,
    Promise,
    console,
    clearTimeout: () => {},
    setTimeout: (fn) => { timerId += 1; fn(); return timerId; },
    mlsAthTabHost: t => /^https:\/\/athenanet\.athenahealth\.com\//.test(String(t && t.url || '')) ? 'athenanet.athenahealth.com' : '',
    mlsAthIsLoginish: () => false,
    mlsPickAthenaTab: async rows => {
      pickerCalls += 1;
      return rows.find(t => /^https:\/\/athenanet\.athenahealth\.com\//.test(String(t && t.url || ''))) || null;
    },
  });
  sandbox.self = sandbox;
  vm.runInContext(helperSource + '\nthis.__front = __mlsFrontAthenaForRead; this.__restore = __mlsRestoreFocusAfterRead;', sandbox, { timeout: 5000 });

  return {
    front: sandbox.__front,
    restore: sandbox.__restore,
    calls,
    tabs,
    pickerCalls: () => pickerCalls,
    active: () => tabs.find(t => t.windowId === focusedWindowId && t.active),
    choose: id => {
      const target = tabs.find(t => Number(t.id) === Number(id));
      assert.ok(target, 'test tab exists: ' + id);
      tabs.forEach(t => { if (t.windowId === target.windowId) t.active = false; });
      target.active = true;
      focusedWindowId = target.windowId;
    },
  };
}

async function main() {
  const rows = [
    { id: 11, windowId: 1, active: true, url: 'https://mlsscribe.com/ScribeFlow.html' },
    { id: 21, windowId: 1, active: false, url: 'https://athenanet.athenahealth.com/encounter/one' },
    { id: 22, windowId: 1, active: false, url: 'https://athenanet.athenahealth.com/encounter/two' },
    { id: 33, windowId: 1, active: false, url: 'https://example.test/unrelated' },
  ];

  /* Runtime: candidate 21 is visible for probe 21, then candidate 22 is
     visible for probe 22. The original app return target survives the handoff. */
  const h = makeHarness(rows, 1);
  const first = await h.front(11, 21, null);
  assert.ok(first && first.athTabId === 21 && first.prevTabId === 11,
    'first exact candidate remembers the original app tab');
  const second = await h.front(11, 22, first);
  assert.strictEqual(second, first, 'the original focus state is carried across candidates');
  assert.strictEqual(second.athTabId, 22, 'restore ownership moves to the final exact candidate');
  assert.deepStrictEqual(h.calls.filter(c => c[0] === 'tab').map(c => c[1]), [21, 22],
    'the two exact candidates are fronted in probe order');
  assert.strictEqual(h.pickerCalls(), 0, 'exact candidate mode must never use the arbitrary Athena picker');
  h.calls.length = 0;
  h.restore(second);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(h.calls.some(c => c[0] === 'tab' && c[1] === 11),
    'the final restore returns to the original app tab exactly once');
  assert.strictEqual(h.active().id, 11, 'the original app tab is active after restore');

  /* Cross-window handoff: candidate one can share the app window while the
     matching second candidate lives in another window. Preserve the original
     app window id even when the first front did not cross a window boundary,
     otherwise activating the app tab during restore leaves the Athena window
     focused. */
  const crossRows = [
    { id: 11, windowId: 1, active: true, url: 'https://mlsscribe.com/ScribeFlow.html' },
    { id: 21, windowId: 1, active: false, url: 'https://athenanet.athenahealth.com/encounter/one' },
    { id: 22, windowId: 2, active: true, url: 'https://athenanet.athenahealth.com/encounter/two' },
  ];
  const cross = makeHarness(crossRows, 1);
  const crossFirst = await cross.front(11, 21, null);
  assert.strictEqual(crossFirst.prevWinId, 1, 'the first same-window candidate did not preserve the original app window id');
  const crossSecond = await cross.front(11, 22, crossFirst);
  assert.strictEqual(crossSecond, crossFirst, 'cross-window candidate handoff replaced the original focus state');
  cross.calls.length = 0;
  cross.restore(crossSecond);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(cross.calls.some(c => c[0] === 'tab' && c[1] === 11), 'cross-window restore did not reactivate the original app tab');
  assert.ok(cross.calls.some(c => c[0] === 'win' && c[1] === 1), 'cross-window restore did not refocus the original app window');
  assert.strictEqual(cross.active().id, 11, 'cross-window restore left Athena focused instead of the original app');

  /* No fallback: a stale exact id must fail closed, not front whichever Athena
     tab the legacy picker happens to prefer. */
  const stale = makeHarness(rows, 1);
  assert.strictEqual(await stale.front(11, 999, null), null, 'a missing exact candidate is refused');
  assert.strictEqual(stale.pickerCalls(), 0, 'a missing exact id cannot fall back to the arbitrary picker');
  assert.deepStrictEqual(stale.calls, [], 'a missing exact id causes no tab/window focus mutation');
  assert.strictEqual(await stale.front(11, 'not-a-tab', null), null, 'a malformed exact candidate is refused');
  assert.strictEqual(stale.pickerCalls(), 0, 'a malformed exact id cannot fall back to the arbitrary picker');

  /* Newer clinician choice wins between candidates. The second candidate is
     not fronted after they choose an unrelated tab, while probing can continue
     honestly without presence at the ActionV2 layer. */
  const moved = makeHarness(rows, 1);
  const owned = await moved.front(11, 21, null);
  assert.ok(owned, 'first exact candidate is fronted');
  moved.choose(33);
  assert.strictEqual(await moved.front(11, 22, owned), null,
    'a newer unrelated clinician focus choice stops candidate fronting');
  assert.deepStrictEqual(moved.calls.filter(c => c[0] === 'tab').map(c => c[1]), [21],
    'the second Athena candidate is never focused after the clinician moves');

  console.log('athena-probe-exact-candidate-foreground-runtime: PASS');
}

main().catch(err => { console.error(err); process.exit(1); });
