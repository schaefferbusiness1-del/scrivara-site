'use strict';
/* MLS Assist 3.0.143 — rowscroll-1.0.0: the schedule-row opener's scroll sweep considers athena's classic list
 * container (div.appointments) and, at the bottom of a container, waits once for the lazy page and extends the
 * sweep when the list grew. Executes the real sweep loop against a fake container that grows on the first
 * bottom wait, with the per-step wait stubbed to a fast timer. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* 1. the scroller candidates include the classic list container, first */
ok(bg.includes("document.querySelectorAll('[class~=\"appointments\"],[class*=\"ScheduleColumn_schedule-column\"],[class*=\"schedule\"],[class*=\"calendar\"],main,section')"), 'div.appointments is a sweep candidate');
eq(bg.split("[class~=\"appointments\"],[class*=\"ScheduleColumn_schedule-column\"]").length - 1, 1, 'exactly one sweep selector carries it');

/* 2. the sweep loop: slice it out and run it */
const forLine = "          for (var y = 0; y <= maxH && y < 40000; y += step) {";
const s = bg.indexOf(forLine);
const endLine = "          if (openAllowed()) try { sc0.scrollTop = orig; } catch (e) {}";
const e = bg.indexOf(endLine, s);
ok(s > 0 && e > s && e - s < 6000, 'the sweep loop is where the opener keeps it');
const loop = bg.slice(s, e);
ok(loop.includes('if (y + step > maxH) {'), 'the bottom wait is inside the loop');
ok(loop.indexOf('if (y + step > maxH) {') > loop.indexOf('if (h2.el) return await clickRebound(h2, y);'), 'the bottom wait runs after the scan of the current step');
ok(/\}\)\(800\);/.test(loop) && !/\}\)\(1200\);/.test(loop), 'schedwait-1.0.0 (3.0.159): the bottom wait polls every 800 ms (was one 1.2 s wait)');
ok(loop.includes('while (Date.now() - __swT0 < 8000 && openAllowed()) {'), 'for up to 8 s, and never past the open deadline');
eq((loop.match(/mls-hs-1\.0\.0/g) || []).length, 2, 'both waits (per step and at the bottom) are the hidden-safe wait');
ok(loop.includes('if (__nh > maxH + 60) { maxH = __nh; __swGrew = true; break; }'), 'the sweep extends the moment the list grew');

/* replace both hidden-safe waits with a fast recorder so the loop runs in milliseconds */
const fast = loop.replace(/await \(function \(ms\) \{[\s\S]*?\}\)\((\d+)\);/g, (m, ms) => 'await __rec(' + ms + ');');
eq((fast.match(/await __rec\(/g) || []).length, 2, 'two waits rewritten for the harness');
async function run(opts) {
  const waits = []; const scrolls = [];
  const sc0 = { clientHeight: 759, _h: opts.heights[0], get scrollHeight() { return this._h; }, set scrollTop(v) { scrolls.push(v); this._top = v; }, get scrollTop() { return this._top || 0; }, dispatchEvent() { return true; } };
  let bottomWaits = 0; let fakeNow = 1000000;
  const fakeDate = { now: () => fakeNow };
  /* the bottom poll: each 800 ms wait advances the fake clock; the list takes opts.growAtWait polls to grow */
  const __rec = async (ms) => { waits.push(ms); fakeNow += ms; if (ms === 800) { bottomWaits++; if (opts.heights[1] && bottomWaits >= (opts.growAtWait || 1)) sc0._h = opts.heights[1]; } };
  const found = opts.foundAtRows || Infinity;
  const rowsAt = () => (sc0._h >= 2470 ? 44 : 24);
  const apptIdRow = () => (rowsAt() >= found ? { el: { row: true }, sc: 1, scanned: rowsAt() } : { el: null, sc: 0, scanned: rowsAt() });
  let clicked = null;
  const clickRebound = async (h2, y) => { clicked = { y, rows: h2.scanned }; return { phase: 'open', opened: true }; };
  const fn = new Function('sc0', '__rec', 'apptIdRow', 'clickRebound', 'openAllowed', 'deadlineOut', 'scanOnce', 'requireAppointmentId', 'scannedTotal', 'step', 'maxH', 'location', 'Date',
    'return (async () => {\n' + fast + '\nreturn { fell: true, scannedTotal: scannedTotal, maxH: maxH };\n})();');
  const res = await fn(sc0, __rec, apptIdRow, clickRebound, () => true, () => ({ deadline: true }), () => ({ el: null, sc: 0, scanned: 0 }), true, 0, Math.max(220, Math.round(759 * 0.8)), opts.heights[0], { hostname: 'x' }, fakeDate);
  return { res, waits, scrolls, clicked, bottomWaits };
}
(async () => {
  /* the list grows on the first bottom poll (1410 -> 2470) and the late row is found in the new page */
  let r = await run({ heights: [1410, 2470], foundAtRows: 44 });
  ok(r.clicked, 'the late row was clicked');
  ok(r.clicked.y > 1410 - 607, 'the click came from a step at or past the original bottom');
  eq(r.clicked.rows, 44, 'the scan that found it saw the whole day');
  eq(r.bottomWaits, 1, 'one 800 ms poll was enough when the list grew at once');
  /* schedwait-1.0.0: a hidden tab's throttled lazy load lands on the 6th poll (4.8 s) - still found */
  r = await run({ heights: [1410, 2470], foundAtRows: 44, growAtWait: 6 });
  ok(r.clicked && r.clicked.rows === 44, 'a lazy load that takes ~5 s on a hidden tab is still swept');
  eq(r.bottomWaits, 6, 'six polls, then the sweep extended');
  /* a list that does not grow: the poll runs out at 8 s (ten polls), then the sweep ends honestly */
  r = await run({ heights: [1410] });
  ok(r.res.fell, 'no row: the loop ends and the opener reports not-found');
  eq(r.bottomWaits, 10, 'a stable list costs the full 8 s poll (ten 800 ms waits) and no more');
  eq(r.res.maxH, 1410, 'the sweep length is unchanged when the list did not grow');
  /* a row on the first page is clicked before any bottom wait */
  r = await run({ heights: [1410, 2470], foundAtRows: 24 });
  ok(r.clicked && r.clicked.y === 0, 'a first-page row is clicked at the first step');
  eq(r.bottomWaits, 0, 'no bottom wait was needed');
  console.log('PASS rowscroll-30143-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
