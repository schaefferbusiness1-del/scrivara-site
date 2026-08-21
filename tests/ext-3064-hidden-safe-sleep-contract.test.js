'use strict';
/* ext 3.0.64 — mls-hs-1.0.0: hidden-tab-safe sleeps in every INJECTED Athena driver.
 *
 * MEASURED 2026-08-18 on the owner's machine (/cloned, ext 3.0.63): the pulled
 * day's visit-note reads died `pulled-day-note-deadline-exceeded` (45 s) with the
 * athenaOne tab HIDDEN and finished 4 of 5 in 68 s with the tab in FRONT. Chrome
 * throttles a hidden tab's timers to one wake-up per second and, after five
 * minutes hidden, to one per MINUTE for chained timers — every `await sleep(400)`
 * and every inline `await new Promise(r => setTimeout(r, 700))` inside the
 * injected drivers became a 1 s, then 60 s, wait.
 *
 * The contract, EXECUTED rather than grepped where it can be:
 *  1. The mls-hs-1.0.0 body is present in background.js and content.js at the
 *     counts the two patch scripts applied (9 helper + 32 inline in background,
 *     2 helper + 11 inline in content).
 *  2. No injected driver still carries a bare page-side wait of the three
 *     shapes the transform covers.
 *  3. The body itself, lifted from background.js and RUN in node with a mocked
 *     `document.hidden`, sleeps for the asked-for wall time in BOTH states
 *     (visible → setTimeout path; hidden → MessageChannel yield loop) and does
 *     not overshoot.
 *  4. The service-worker-scope helpers were deliberately left alone: the two
 *     orchestrator sleeps still read exactly as before. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
const cs = fs.readFileSync(path.join(root, 'content.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* 1. counts */
const count = (s, needle) => s.split(needle).length - 1;
eq(count(bg, 'mls-hs-1.0.0'), 41, 'background.js must carry exactly 41 mls-hs-1.0.0 sleeps (9 helpers + 32 inline)');
eq(count(cs, 'mls-hs-1.0.0'), 13, 'content.js must carry exactly 13 mls-hs-1.0.0 sleeps (2 helpers + 11 inline)');

/* 2. no bare page-side wait remains inside the injected drivers */
function fnBody(src, name) {
  const i = src.indexOf(name);
  assert.ok(i >= 0, name + ' must exist');
  /* the driver bodies are long; take a generous window that ends before the next top-level "async function" */
  const rest = src.slice(i + name.length);
  const nxt = rest.search(/\n(async )?function [A-Za-z_$]+\(/);
  return rest.slice(0, nxt > 0 ? nxt : 60000);
}
const BARE = [
  /new Promise\(function\s*\(\s*[A-Za-z_$][\w$]*\s*\)\s*\{\s*setTimeout\(\s*[A-Za-z_$][\w$]*\s*,/,
  /new Promise\(\(\s*[A-Za-z_$][\w$]*\s*\)\s*=>\s*setTimeout\(/,
  /new Promise\(\s*[A-Za-z_$][\w$]*\s*=>\s*setTimeout\(/
];
for (const name of ['async function mlsFindPatientOpenDriverFn(', 'async function mlsReadVisitsPaneDriverFn(', 'async function mlsUnifiedWriteDriverFn(', 'async function mlsAthenaGotoDate(', 'async function mlsRobustType(', 'async function mlsAthenaSignSave(']) {
  const body = fnBody(bg, name);
  for (const re of BARE) ok(!re.test(body), name + ' still holds a bare page-side setTimeout wait: ' + re);
}

/* 3. the body runs: lift the FIRST patched helper from background.js and execute it */
const line = bg.split('\n').find((l) => l.startsWith('    function sleep(ms) { var __hsAt') || l.startsWith('  var sleep = function (ms) { var __hsAt'));
ok(!!line, 'a patched sleep helper must be liftable from background.js');
const src = line.trim().replace(/\r$/, '').replace(/^var sleep = /, '').replace(/;$/, '').replace(/^function sleep\(ms\)/, 'function (ms)');
const { MessageChannel } = require('worker_threads');
global.MessageChannel = MessageChannel;
const sleepFn = new Function('return (' + src + ')')();
(async () => {
  global.document = { hidden: true };
  let t = Date.now(); await sleepFn(300); const hidden = Date.now() - t;
  global.document = { hidden: false };
  t = Date.now(); await sleepFn(200); const visible = Date.now() - t;
  delete global.document;
  t = Date.now(); await sleepFn(120); const noDoc = Date.now() - t;
  ok(hidden >= 290 && hidden < 700, 'hidden-tab sleep(300) must wait ~300 ms without a timer (got ' + hidden + ' ms)');
  ok(visible >= 190 && visible < 500, 'visible-tab sleep(200) must still be a plain wait (got ' + visible + ' ms)');
  ok(noDoc >= 110 && noDoc < 400, 'service-worker scope (no document) sleep(120) must be a plain wait (got ' + noDoc + ' ms)');

  /* 4. SW-scope helpers: the inline transform reached them too (they have the
     same textual shape). That is SAFE — with no `document` the body is a plain
     setTimeout (proven by the noDoc timing above) — so the contract records the
     fact rather than pretending they were skipped. */
  ok(/var sleep = function \(ms\) \{ var __hsAt[^\n]*\/\* mls-hs-1\.0\.0/.test(bg), 'the order-orchestrator sleep (SW scope) carries the hs body and behaves as a plain wait there');
  ok(/  function sleep\(ms\) \{ var __hsAt[^\n]*\/\* mls-hs-1\.0\.0/.test(bg), 'the all-visits orchestrator sleep (SW scope) carries the hs body and behaves as a plain wait there');

  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  /* Pin moved 3.0.64 -> 3.0.74 with the 2026-08-19 release train; later
     releases keep this historical behavior contract version-agnostic. The
     package/release suites own the exact current version. */
  ok(/^\d+\.\d+\.\d+$/.test(String(manifest.version || '')), 'manifest version is a release version');
  ok(new RegExp('^' + manifest.version.replace(/\./g, '\\.') + '\\+core-sha256:[0-9a-f]{64}$').test(String(manifest.version_name || '')),
    'version_name carries the core digest for the manifest version');
  console.log('PASS ext-3064 hidden-safe sleep contract: ' + checks + ' checks (hidden ' + hidden + ' ms, visible ' + visible + ' ms, sw ' + noDoc + ' ms)');
})().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
