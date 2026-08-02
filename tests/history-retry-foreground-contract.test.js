/* fg-1.0 (3.0.41) FOREGROUND-ASSISTED BODIES RETRY CONTRACT.
 *
 * The visit-bodies lane fails in occluded tabs because athenaOne's chart panes
 * never hydrate hidden (live-documented 2026-07-14..21: 14/14 bodies failed
 * occluded, retry failed the same 14; per-row 'encounter-frame-not-refreshed'
 * persisted across cold reopens). The quiet pull deliberately never steals
 * focus. The USER-INITIATED retry is the one moment the doctor is present by
 * definition, so fg-1.0 lets exactly that lane front the athena tab for the
 * read and ALWAYS restores the previous tab/window - success or failure.
 *
 * Four invariants, pinned against the shipped bytes:
 *  1. only a request carrying foregroundOk:true can front anything - the
 *     quiet-pull path reaches runAllVisits with no focus change;
 *  2. the app sets that flag ONLY inside retryFailedHistory's batch (module
 *     flag set on entry, cleared on BOTH settle paths);
 *  3. the content bridge forwards the flag verbatim (=== true, never truthy);
 *  4. focus restore runs in finish() for every terminal, and the front/restore
 *     helpers behave (executed against a fake chrome). */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const candDir = ['3.0.41', '3.0.40'].map(v => path.join(root, 'extension-candidates', v)).find(p => fs.existsSync(path.join(p, 'background.js')));
const bg = fs.readFileSync(candDir ? path.join(candDir, 'background.js') : path.join(root, 'background.js'), 'utf8');
const content = fs.readFileSync(candDir ? path.join(candDir, 'content.js') : path.join(root, 'content.js'), 'utf8');
const feat = fs.readFileSync(path.join(root, 'feat_mls_schedimport_exact.js'), 'utf8');

let n = 0;
function ok(name) { n++; console.log('ok ' + n + ' - ' + name); }

/* ---- 1. background: gate + placement ---- */
{
  assert.strictEqual((bg.match(/async function __mlsFrontAthenaForRead\(\)/g) || []).length, 1, 'front helper defined once');
  assert.strictEqual((bg.match(/__mlsFrontAthenaForRead\(\)\.then/g) || []).length, 1, 'front helper invoked exactly once');
  const gateIdx = bg.indexOf('if (msg.foregroundOk === true) {');
  const frontIdx = bg.indexOf('__mlsFrontAthenaForRead().then');
  const elseRun = bg.indexOf('} else {', gateIdx);
  assert.ok(gateIdx > 0 && frontIdx > gateIdx && frontIdx < elseRun,
    'the front call lives INSIDE the foregroundOk===true branch');
  /* the quiet branch runs the reader directly with no focus verbs */
  const quietSlice = bg.slice(elseRun, bg.indexOf('activeAllVisitsPromise = thisRead;', elseRun));
  assert.ok(quietSlice.includes('runAllVisits(appTabId,') && !/chrome\.(tabs|windows)\.update/.test(quietSlice),
    'the quiet path never touches tab or window focus');
  /* restore precedes the response at the single terminal */
  const finishIdx = bg.indexOf('__mlsRestoreFocusAfterRead(__fgState); __fgState = null;');
  const respIdx = bg.indexOf('sendResponse(value);', finishIdx - 400);
  assert.ok(finishIdx > 0 && bg.indexOf('sendResponse(value);', finishIdx) > finishIdx,
    'restore runs in finish() before the response goes out');
  ok('background: front only under foregroundOk, quiet path focus-free, restore at the terminal');
}

/* ---- 2. app: the flag exists only for the user-initiated retry ---- */
{
  assert.strictEqual((feat.match(/__historyRetryForeground = true;/g) || []).length, 1, 'flag set exactly once');
  const setIdx = feat.indexOf('__historyRetryForeground = true;');
  const retryIdx = feat.indexOf('function retryFailedHistory(');
  const nextFnIdx = feat.indexOf('function phiFreeReasonCounts(');
  assert.ok(setIdx > retryIdx && setIdx < nextFnIdx, 'the flag is set inside retryFailedHistory only');
  assert.strictEqual((feat.match(/__historyRetryForeground = false;/g) || []).length, 3,
    'cleared at init + both settle paths');
  assert.strictEqual((feat.match(/foregroundOk: __historyRetryForeground === true/g) || []).length, 1,
    'the one allvisits post carries the strict flag');
  ok('app: flag set only in retryFailedHistory, cleared on both settle paths, one strict post');
}

/* ---- 3. content bridge forwards strictly ---- */
{
  assert.ok(content.includes("foregroundOk: d.foregroundOk === true, hint: d.hint || {}"),
    'the bridge forwards foregroundOk strictly (=== true)');
  ok('content bridge forwards the flag strictly');
}

/* ---- 4. execute the helpers against a fake chrome ---- */
{
  const hStart = bg.indexOf('async function __mlsFrontAthenaForRead()');
  const hEnd = bg.indexOf('chrome.runtime.onMessage.addListener', hStart);
  const helpers = bg.slice(hStart, hEnd);
  const calls = [];
  const sandbox = vm.createContext({
    setTimeout: (fn) => fn(), /* collapse the hydrate wait */
    chrome: {
      tabs: {
        query: async () => [
          { id: 11, windowId: 1, active: true, url: 'https://mlsscribe.com/ScribeFlow.html' },
          { id: 22, windowId: 1, active: false, url: 'https://athenanet.athenahealth.com/x' },
        ],
        update: async (id, o) => { calls.push(['tab', id, o.active]); },
      },
      windows: {
        getLastFocused: async () => ({ id: 1, focused: true }),
        update: async (id, o) => { calls.push(['win', id, o.focused]); },
      },
    },
    mlsPickAthenaTab: async (tabs) => tabs.find(t => /athenanet/.test(t.url)),
    Promise, console,
  });
  vm.runInContext(helpers + '\nthis.__front = __mlsFrontAthenaForRead; this.__restore = __mlsRestoreFocusAfterRead;', sandbox, { timeout: 5000 });
  (async () => {
    const st = await sandbox.__front();
    assert.ok(st && st.prevTabId === 11, 'previous active tab remembered');
    assert.deepStrictEqual(calls.filter(c => c[0] === 'tab').map(c => c[1]), [22], 'athena tab fronted');
    calls.length = 0;
    sandbox.__restore(st);
    assert.ok(calls.some(c => c[0] === 'tab' && c[1] === 11 && c[2] === true), 'previous tab restored');
    sandbox.__restore(null); /* must be a no-op, not a throw */
    ok('helpers executed: front remembers + restores, null state no-ops');
    console.log('# history-retry-foreground-contract: ' + n + ' checks passed');
  })().catch(e => { console.error(e); process.exit(1); });
}
