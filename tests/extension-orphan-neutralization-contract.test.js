/* csr-1.1 (3.0.40) ORPHAN NEUTRALIZATION CONTRACT.
 *
 * csr-1.0 (3.0.39) re-injected content scripts into open tabs on update and
 * self-neutralized ORPHANED bridge handlers - but only 2 of content.js's 6
 * window-message listeners got the guard, and no DOM-level listener did. The
 * 2026-08-02 adversarial audit CONFIRMED (high confidence):
 *   - the mlsAppSearchOpenPatient relay orphan answered every chart-open
 *     request with an INSTANT ok:false carrying the matching requestId,
 *     synchronously beating the fresh script's genuine async reply - the app
 *     settles on the first reply per id, so post-update chart-open and
 *     day-pull orchestration failed until a manual page refresh (the exact
 *     class csr-1.0 claims to kill, live-reproduced 2026-08-01);
 *   - the #mls-cap capture-click interceptor called stopImmediatePropagation
 *     BEFORE any liveness check, so the dead world consumed every click on the
 *     panel pull button and painted advice ('reload the extension') that
 *     cannot fix an orphan;
 *   - the orphan tab-picker chip blocked the fresh chip via the shared DOM id
 *     and rendered a dead picker claiming no athenaOne tabs exist;
 *   - the version-announce IIFE kept broadcasting the stale pre-update version;
 *   - one grouped try in the background re-injector skipped content.js for a
 *     tab whenever the athena allFrames guard call rejected.
 *
 * csr-1.1 closes all five. This contract pins the source shape AND replays the
 * two critical handlers against dead- and live-runtime sandboxes so the
 * assertions cannot pass vacuously. */

'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const candDir = ['3.0.43', '3.0.42', '3.0.41', '3.0.40'].map(v => path.join(root, 'extension-candidates', v)).find(p => fs.existsSync(path.join(p, 'content.js')));
const contentPath = candDir ? path.join(candDir, 'content.js') : path.join(root, 'content.js');
const bgPath = candDir ? path.join(candDir, 'background.js') : path.join(root, 'background.js');
const content = fs.readFileSync(contentPath, 'utf8');
const bg = fs.readFileSync(bgPath, 'utf8');

let n = 0;
function ok(name) { n++; console.log('ok ' + n + ' - ' + name); }

/* ---- 1. source shape: every flagged listener is named + guarded ---- */
for (const marker of [
  'var mlsCapClickHandler = function (ev) {',
  "document.addEventListener('click', mlsCapClickHandler, true);",
  'var mlsSearchOpenHandler = function (ev) {',
  "window.addEventListener('message', mlsSearchOpenHandler, false);",
  'var mlsVersionMsgHandler = function (ev) {',
  "window.addEventListener('message', mlsVersionMsgHandler);",
  'var mlsTabPickerMsgHandler = function (ev) {',
  "window.addEventListener('message', mlsTabPickerMsgHandler, false);",
  'var mlsWriteV2ReceiptHandler = function (ev) {',
  "window.addEventListener('message', mlsWriteV2ReceiptHandler, false);",
  'window.__mlsVersionAnnounce = 1;',
  'window.__mlsWriteV2Receipt = 1;',
  'window.__mlsAutopilotInit = 1;',
  "prevChip.__mlsChipWorld === 1",
  "c.__mlsChipWorld = 1;",
  "panel.getAttribute('data-mls-ap-init') === '1'",
]) {
  assert.ok(content.indexOf(marker) !== -1, 'content marker present: ' + marker);
}
ok('all five orphan-exposed surfaces are named, guarded, and flagged');

/* every named handler self-detaches on a dead runtime */
for (const h of ['mlsCapClickHandler', 'mlsSearchOpenHandler', 'mlsVersionMsgHandler', 'mlsTabPickerMsgHandler', 'mlsWriteV2ReceiptHandler']) {
  const defIdx = content.indexOf('var ' + h + ' = function');
  const detachIdx = content.indexOf('removeEventListener', defIdx);
  const guardIdx = content.indexOf('chrome.runtime && chrome.runtime.id', defIdx);
  assert.ok(defIdx > 0 && guardIdx > defIdx && detachIdx > defIdx, h + ' carries the liveness guard + self-detach');
}
ok('every guarded handler carries liveness check + self-detach');

/* ---- 2. ORDER: the cap handler's liveness check precedes stopImmediatePropagation ---- */
{
  const defIdx = content.indexOf('var mlsCapClickHandler = function (ev) {');
  const endIdx = content.indexOf("document.addEventListener('click', mlsCapClickHandler, true);", defIdx);
  const body = content.slice(defIdx, endIdx);
  const guardIdx = body.indexOf('chrome.runtime && chrome.runtime.id');
  const sipIdx = body.indexOf('ev.stopImmediatePropagation()');
  assert.ok(guardIdx > 0 && sipIdx > 0 && guardIdx < sipIdx,
    'liveness check must run BEFORE stopImmediatePropagation (guard@' + guardIdx + ' sip@' + sipIdx + ')');
  ok('cap-click liveness check precedes stopImmediatePropagation');
}

/* ---- 3. background split-try: a guard rejection cannot skip the bundle ---- */
{
  assert.ok(bg.indexOf('} catch (eGuard) {}') !== -1, 'guard injection has its own catch');
  const gIdx = bg.indexOf('} catch (eGuard) {}');
  const bundleIdx = bg.indexOf("files: ['write_safety_guard.js', 'review_screen.js', 'content.js', 'mls-popup.js']", gIdx);
  const tabCatchIdx = bg.indexOf('} catch (eTab) {', gIdx);
  assert.ok(bundleIdx > gIdx && tabCatchIdx > bundleIdx, 'main bundle injection sits in its own try AFTER the guard catch');
  ok('background re-injector: guard rejection cannot skip the main bundle');
}

/* ---- 4. behavioral: dead-world search-open relay is SILENT and detaches ---- */
function extractIife(startMarker, endMarker) {
  const s = content.indexOf(startMarker);
  const e = content.indexOf(endMarker, s) + endMarker.length;
  assert.ok(s > 0 && e > s, 'IIFE extraction: ' + startMarker.slice(0, 40));
  return content.slice(s, e);
}
function makeWin() {
  const listeners = {};
  const posts = [];
  const removed = [];
  return {
    listeners, posts, removed,
    win: {
      addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
      removeEventListener(type, fn) { removed.push({ type, fn }); const a = listeners[type] || []; const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); },
      postMessage(data, origin) { posts.push({ data, origin }); },
    },
  };
}
const relaySrc = extractIife('/* (2) Search-and-navigate relay', '  };\n  window.addEventListener(\'message\', mlsSearchOpenHandler, false);');
function runRelay(chromeObj) {
  const w = makeWin();
  const sandbox = vm.createContext({
    window: w.win, chrome: chromeObj, URL, Date, localStorage: { length: 0, key() { return null; }, getItem() { return null; } },
    setTimeout, console,
  });
  vm.runInContext('(function(){' + relaySrc.slice(relaySrc.indexOf('(function () {') + '(function () {'.length) + '\n})();', sandbox, { timeout: 5000 });
  return w;
}
{
  /* dead runtime: chrome exists but runtime is gone (post-update orphan) */
  const w = runRelay({});
  const handler = (w.listeners.message || [])[0];
  assert.ok(handler, 'relay handler registered');
  handler({ origin: 'https://mlsscribe.com', data: { source: 'mls-app', type: 'mlsAppSearchOpenPatient', requestId: 'r1', name: 'Karen Bledsoe' } });
  assert.strictEqual(w.posts.length, 0, 'a dead-world relay must post NOTHING (it used to post instant ok:false): ' + JSON.stringify(w.posts));
  assert.ok(w.removed.some(r => r.type === 'message'), 'dead-world relay must detach itself');
  ok('dead-world search-open relay is silent and self-detaches');
}
{
  /* live runtime: the genuine round-trip fires */
  const sent = [];
  const w = runRelay({ runtime: { id: 'ext-id', lastError: null, sendMessage(msg, cb) { sent.push(msg); }, onMessage: { addListener() {} } } });
  const handler = (w.listeners.message || [])[0];
  handler({ origin: 'https://mlsscribe.com', data: { source: 'mls-app', type: 'mlsAppSearchOpenPatient', requestId: 'r2', name: 'Karen Bledsoe', bootstrapIdentity: true } });
  assert.strictEqual(sent.length, 1, 'live relay forwards to the background');
  assert.strictEqual(sent[0].type, 'mlsAppSearchOpenRequest');
  ok('live-world search-open relay forwards the genuine request');
}

/* ---- 5. behavioral: dead-world cap click hands the event onward ---- */
{
  const capSrc = extractIife("(function () {\n  'use strict';\n  try { if (window.__mlsPanelPullFix) return; window.__mlsPanelPullFix = 1; }",
    "document.addEventListener('click', mlsCapClickHandler, true);");
  const docListeners = [];
  const docRemoved = [];
  const sandbox = vm.createContext({
    window: {},
    document: {
      addEventListener(type, fn, cap) { docListeners.push({ type, fn, cap }); },
      removeEventListener(type, fn, cap) { docRemoved.push({ type, fn, cap }); },
      getElementById() { return null; },
      documentElement: {},
      createElement() { return { style: {}, setAttribute() {} }; },
    },
    MutationObserver: function () { return { observe() {} }; },
    chrome: {}, /* dead */
    setTimeout, console, Date,
  });
  vm.runInContext(capSrc + '\n})();', sandbox, { timeout: 5000 });
  const click = docListeners.find(l => l.type === 'click' && l.cap === true);
  assert.ok(click, 'capture click listener registered');
  let sip = 0, pd = 0;
  click.fn({
    target: { closest() { return { id: 'mls-cap' }; } },
    stopImmediatePropagation() { sip++; },
    preventDefault() { pd++; },
  });
  assert.strictEqual(sip, 0, 'dead world must NOT consume the click (stopImmediatePropagation)');
  assert.strictEqual(pd, 0, 'dead world must NOT preventDefault');
  assert.ok(docRemoved.some(r => r.type === 'click'), 'dead world detaches its click interceptor');
  ok('dead-world cap click passes through untouched and detaches');
}

console.log('# extension-orphan-neutralization-contract: ' + n + ' checks passed');
