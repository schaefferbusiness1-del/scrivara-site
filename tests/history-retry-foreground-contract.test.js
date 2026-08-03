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
const candDir = ['3.0.43', '3.0.42', '3.0.41', '3.0.40'].map(v => path.join(root, 'extension-candidates', v)).find(p => fs.existsSync(path.join(p, 'background.js')));
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

/* ---- 2. app: the flag exists only for USER-INITIATED lanes ----
 * fg-1.2 (3.0.43): dayPull joined retryFailedHistory - "the ONE guarded day
 * lane every visible pull owner calls" is user-initiated by definition, so the
 * FIRST pull gets the presence assist and the retry becomes vestigial. Auto/
 * relay pulls never pass through either setter. */
{
  const sets = [...feat.matchAll(/__historyRetryForeground = true;/g)].map(m => m.index);
  assert.strictEqual(sets.length, 2, 'flag set in exactly the two user-initiated lanes');
  const retryIdx = feat.indexOf('function retryFailedHistory(');
  const retryEnd = feat.indexOf('function phiFreeReasonCounts(');
  const dayIdx = feat.indexOf('function dayPull(');
  const dayEnd = feat.indexOf('function __dayPullInner(');
  assert.ok(sets.some(i => i > retryIdx && i < retryEnd), 'one setter inside retryFailedHistory');
  assert.ok(sets.some(i => i > dayIdx && i < dayEnd), 'one setter inside the dayPull wrapper');
  assert.strictEqual((feat.match(/__historyRetryForeground = false;/g) || []).length, 5,
    'cleared at init + both settle paths of BOTH lanes');
  assert.strictEqual((feat.match(/foregroundOk: __historyRetryForeground === true/g) || []).length, 1,
    'the one allvisits post carries the strict flag');
  /* fg-1.2 disclosure plumbing */
  assert.ok(feat.includes('presenceRequested: __historyRetryForeground === true, presenceAssisted: false,'),
    'batch receipt declares the presence request and starts unassisted');
  assert.ok(feat.includes("if (vr && vr.fronted === true) receipt.presenceAssisted = true;"),
    'a fronted reply marks the batch assisted');
  assert.ok(feat.includes('foregroundBatchStart: (__historyRetryForeground === true && receipt.presenceBatchAnnounced !== true) ? (receipt.presenceBatchAnnounced = true) : false'),
    'exactly the first row of a user-initiated batch announces the batch start');
  ok('app: two user-initiated setters (retry + dayPull), 5 clears, strict post, disclosure plumbing');
}

/* ---- 2b. banner honesty (mls-connect) + doctor-moved machinery (bg) ---- */
{
  const mc = fs.readFileSync(path.join(root, 'mls-connect.js'), 'utf8');
  assert.ok(mc.includes("(r && r.navSessionLikelyExpired === true)"),
    'nav-failed distinguishes a dead athena session');
  assert.ok(mc.includes('Athena signed you out (its idle timeout). Sign in again on the Athena tab'),
    'the sign-in message names the real fix');
  assert.ok(mc.includes("hr2.presenceRequested === true && hr2.presenceAssisted !== true"),
    'the history-partial banner tells the doctor when presence would have helped');
  assert.ok(bg.includes('var __mlsFgDoctorMoved = false;'), 'doctor-moved memory exists');
  assert.ok(bg.includes('if (__mlsFgDoctorMoved) return null;'), 'front refuses after the doctor moved');
  assert.ok(bg.includes('if (!stillOurs) { __mlsFgDoctorMoved = true; }'), 'restore records the move');
  assert.ok(bg.includes("if (msg.foregroundBatchStart === true) __mlsFgDoctorMoved = false;"),
    'a new user-initiated batch re-earns the assist');
  assert.ok(bg.includes("value.fronted = __fgDidFront === true;"), 'the reply discloses fronting');
  assert.ok(content.includes('foregroundBatchStart: d.foregroundBatchStart === true'),
    'the bridge forwards the batch announcement strictly');
  /* sx-1.0 */
  assert.ok(bg.includes('async function __mlsProbeSessionExpired()'), 'session probe helper exists');
  assert.ok(bg.includes('sessionLikelyExpired: exp === true,'), 'goto failures carry the session verdict');
  assert.ok(feat.includes('navSessionLikelyExpired: !!(nav && nav.sessionLikelyExpired)'),
    'the importer threads the verdict onto the nav-failed result');
  ok('fg-1.2 doctor-moved machinery + sx-1.0 session honesty pinned end to end');
}

/* ---- 3. content bridge forwards strictly ---- */
{
  assert.ok(content.includes("foregroundOk: d.foregroundOk === true, foregroundBatchStart: d.foregroundBatchStart === true, hint: d.hint || {}"),
    'the bridge forwards foregroundOk and the batch announcement strictly (=== true)');
  ok('content bridge forwards the flag strictly');
}

/* ---- 4. execute the helpers against a fake chrome (fg-1.1 semantics) ---- */
{
  const hStart = bg.indexOf('var __mlsFgRestorePending = null;');
  const hEnd = bg.indexOf('chrome.runtime.onMessage.addListener', hStart);
  assert.ok(hStart > 0 && hEnd > hStart, 'fg-1.1 helper block present (pending var + both helpers)');
  const helpers = bg.slice(hStart, hEnd);
  const calls = [];
  const world = { focused: true, activeTabId: 22 }; /* mutated per scenario */
  const sandbox = vm.createContext({
    setTimeout: (fn) => fn(), /* collapse the hydrate wait */
    chrome: {
      runtime: { lastError: null },
      tabs: {
        query: async () => [
          { id: 11, windowId: 1, active: true, url: 'https://mlsscribe.com/ScribeFlow.html' },
          { id: 22, windowId: 1, active: false, url: 'https://athenanet.athenahealth.com/x' },
        ],
        update: (id, o, cb) => { calls.push(['tab', id, o.active]); if (cb) cb(); return Promise.resolve(); },
      },
      windows: {
        getLastFocused: (optsOrNothing, maybeCb) => {
          const w = { id: 1, focused: world.focused, tabs: [{ id: world.activeTabId, active: true }] };
          if (typeof optsOrNothing === 'function') { optsOrNothing(w); return; }
          if (typeof maybeCb === 'function') { maybeCb(w); return; }
          return Promise.resolve(w);
        },
        update: (id, o, cb) => { calls.push(['win', id, o.focused]); if (cb) cb(); return Promise.resolve(); },
      },
    },
    mlsPickAthenaTab: async (tabs) => tabs.find(t => /athenanet/.test(t.url)),
    Promise, console,
  });
  vm.runInContext(helpers + '\nthis.__front = __mlsFrontAthenaForRead; this.__restore = __mlsRestoreFocusAfterRead;', sandbox, { timeout: 5000 });
  (async () => {
    /* 4a. doctor OUTSIDE Chrome: fronting must be refused outright */
    world.focused = false;
    const stOut = await sandbox.__front();
    assert.strictEqual(stOut, null, 'front must refuse when Chrome does not own focus');
    assert.strictEqual(calls.length, 0, 'no focus verbs may fire when refused: ' + JSON.stringify(calls));
    ok('front refuses when the doctor is outside Chrome (no keystroke-steal risk)');

    /* 4b. happy path: front remembers, restore returns the doctor */
    world.focused = true;
    const st = await sandbox.__front();
    assert.ok(st && st.prevTabId === 11 && st.athTabId === 22, 'previous active tab + fronted tab remembered');
    assert.deepStrictEqual(calls.filter(c => c[0] === 'tab').map(c => c[1]), [22], 'athena tab fronted');
    calls.length = 0;
    world.activeTabId = 22; /* nothing moved during the read */
    sandbox.__restore(st);
    await new Promise(r => setImmediate(r));
    assert.ok(calls.some(c => c[0] === 'tab' && c[1] === 11 && c[2] === true), 'previous tab restored when the front is still ours');
    ok('happy path: front remembers and restore returns the doctor');

    /* 4c. NEWER CHOICE WINS: doctor moved mid-read -> restore must not stomp */
    calls.length = 0;
    world.activeTabId = 99; /* doctor clicked elsewhere during the read */
    sandbox.__restore(st);
    await new Promise(r => setImmediate(r));
    assert.strictEqual(calls.length, 0, 'restore must NOT stomp the doctor\'s newer choice: ' + JSON.stringify(calls));
    ok('newer human choice wins: restore skips when the doctor moved mid-read');

    sandbox.__restore(null); /* must be a no-op, not a throw */
    ok('null state no-ops');
    console.log('# history-retry-foreground-contract: ' + n + ' checks passed');
  })().catch(e => { console.error(e); process.exit(1); });
}

/* ---- 5. hc-1.0.3: the briefing waits counter is request-token keyed ---- */
{
  assert.ok(bg.includes("_bfTok = (requestGuard && requestGuard.token) ? String(requestGuard.token) : ''"),
    'waits counter reads the request token');
  assert.ok(bg.includes("_bfPrev.length === 2 && _bfPrev[0] === _bfTok"),
    'a token mismatch reads as zero (no cross-read leak)');
  assert.ok(bg.includes("'data-mls-briefing-waits', _bfTok + ':' + (_bfWaits + 1)"),
    'the counter writes token:count');
  ok('hc-1.0.3: waits counter keyed to the request token');
}
