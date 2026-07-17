'use strict';
/* Athena window/tab guard contract (awg-2.0.0, 2026-07-17).
 *
 * Owner-confirmed breakage class: the quiet-pull machinery keeps Athena in a
 * PRESET-size strip window (hard 520-780px floor computed from host bounds,
 * persisted bounds re-applied verbatim) which breaks on Macs and smaller /
 * narrower screens. awg-2.0.0 must ADAPT every window placement to the
 * display actually present — clamp size to the work area, keep the window
 * fully on-screen, relocate stale off-screen rects — and must cover BOTH
 * chrome.windows.update and chrome.windows.create (the strip's birth).
 *
 * Loads the appended guard block from the repo-root background.js (the
 * canonical extension source) in a vm with a stubbed chrome. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const bg = fs.readFileSync(path.resolve(__dirname, '..', 'background.js'), 'latin1');
const start = bg.indexOf('/* ===== MLS ATHENA WINDOW/TAB GUARD');
assert(start > 0, 'guard block missing from background.js');
const src = bg.slice(start);

const calls = { alarms: [], updates: [], creates: [] };
const sandbox = {
  self: {},
  setTimeout: (fn, ms) => {},
  Promise, Math, Object, Number, String,
  chrome: {
    runtime: { getPlatformInfo: (cb) => cb({ os: 'mac' }) },
    windows: {
      update: function (id, u, cb) { calls.updates.push([id, u]); if (cb) { cb({}); return; } return Promise.resolve({}); },
      create: function (cd, cb) { calls.creates.push(cd); if (cb) { cb({ id: 1 }); return; } return Promise.resolve({ id: 1 }); },
      get: async () => ({ left: 100, top: 100, width: 800, height: 600, state: 'normal' })
    },
    tabs: { query: async () => [], update: async () => ({}) },
    alarms: { create: (n) => calls.alarms.push(n), onAlarm: { addListener: () => {} } },
    system: { display: { getInfo: async () => DISPLAYS_LIVE } }
  }
};
let DISPLAYS_LIVE = [{ isPrimary: true, workArea: { left: 0, top: 0, width: 1440, height: 900 } }];
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const G = sandbox.self.__mlsAthWinGuard;
assert(G && G.version === 'awg-2.0.0', 'awg-2.0.0 not installed (got ' + (G && G.version) + ')');
assert(calls.alarms.includes('mlsAthGuard'), 'discard-guard alarm not armed');

const MAC13 = [{ isPrimary: true, workArea: { left: 0, top: 25, width: 1280, height: 775 } }]; // 13" MacBook, menu bar
const BIG = [{ isPrimary: true, workArea: { left: 0, top: 0, width: 1440, height: 900 } }];
const TINY = [{ isPrimary: true, workArea: { left: 0, top: 0, width: 400, height: 700 } }];
const win = (o) => Object.assign({ left: 100, top: 100, width: 800, height: 600, state: 'normal' }, o);

/* 1) mac fullscreen protections unchanged from awg-1.0.0 */
let d = G.decide(win({ state: 'fullscreen' }), { state: 'normal', left: 0, top: 0, width: 500, height: 500 }, BIG, 'mac');
assert.equal(d.updates, null, 'mac fullscreen maintenance move must be skipped');
d = G.decide(win({ state: 'fullscreen' }), { focused: true, state: 'normal' }, BIG, 'mac');
assert(d.updates && d.updates.focused === true, 'explicit focused:true must pass through on mac fullscreen');
d = G.decide(win({ state: 'fullscreen' }), { state: 'normal', left: 0 }, BIG, 'win');
assert(d.updates && d.updates.state === 'normal', 'Windows behavior unchanged (fullscreen rule is mac-only)');

/* 2) PRESET-SIZE strip on a small display is adapted, not applied verbatim */
d = G.decide(win(), { left: 0, top: 0, width: 520, height: 900 }, TINY, 'mac');
assert.equal(d.reason, 'bounds-adapted', 'preset 520px strip must adapt on a 400px display');
assert.equal(d.updates.width, 400, 'width must clamp to the work area width');
assert.equal(d.updates.height, 700, 'height must clamp to the work area height');
assert.equal(d.updates.left, 0, 'left stays at the work-area edge');

/* work-area offset respected (Mac menu bar): top must never be above it */
d = G.decide(win(), { left: 900, top: 0, width: 520, height: 900 }, MAC13, 'mac');
assert.equal(d.reason, 'bounds-adapted', 'strip taller than the Mac work area must adapt');
assert.equal(d.updates.top, 25, 'top clamps below the menu bar');
assert.equal(d.updates.height, 775, 'height clamps to the visible work area');
assert.equal(d.updates.left, 760, 'left pulls in so the full 520px strip stays on the 1280px display');

/* 3) stale off-screen strip (undocked Mac) is RELOCATED onto a live display */
d = G.decide(win(), { left: 2200, top: 0, width: 600, height: 900 }, BIG, 'mac');
assert.equal(d.reason, 'bounds-adapted', 'fully off-screen bounds must be adapted, not applied');
assert.equal(d.updates.left, 840, 'strip re-lands flush with the right edge (1440-600)');
assert.equal(d.updates.width, 600, 'width preserved when it fits the display');
assert(d.updates.top === 0 && d.updates.height === 900, 'top/height land inside the display');

/* 4) geometry that already fits passes untouched; fail-open without displays */
d = G.decide(win(), { left: 900, top: 100, width: 540, height: 700 }, BIG, 'mac');
assert.equal(d.reason, 'pass', 'fitting bounds must pass untouched');
d = G.decide(win(), { left: 9000, top: 9000, width: 540, height: 700 }, null, 'mac');
assert.equal(d.reason, 'pass', 'no display info -> never block (fail-open for bounds)');

/* 5) non-bounds updates and non-geometry keys are never touched */
d = G.decide(win(), { drawAttention: true }, BIG, 'mac');
assert(d.updates && d.updates.drawAttention === true && d.reason === 'pass', 'non-bounds updates pass');
d = G.decide(win(), { left: 2200, top: 0, width: 600, height: 900, state: 'normal' }, BIG, 'win');
assert(d.updates.state === 'normal', 'non-geometry keys survive adaptation');

/* 6) windows.create is wrapped: a preset-size strip birth gets clamped */
DISPLAYS_LIVE = TINY;
(async () => {
  const w = await sandbox.chrome.windows.create({ tabId: 7, focused: false, type: 'normal', left: 880, top: 0, width: 520, height: 900 });
  assert(w && calls.creates.length === 1, 'wrapped create did not reach the real API');
  const cd = calls.creates[0];
  assert.equal(cd.width, 400, 'created strip width must clamp to the 400px display');
  assert.equal(cd.height, 700, 'created strip height must clamp to the display');
  assert.equal(cd.left, 0, 'created strip must land fully on-screen');
  assert(cd.tabId === 7 && cd.focused === false && cd.type === 'normal', 'non-geometry create keys preserved');

  /* create without bounds passes through untouched */
  await sandbox.chrome.windows.create({ url: 'about:blank' });
  assert.deepStrictEqual(calls.creates[1], { url: 'about:blank' }, 'bound-less create must be untouched');

  console.log('PASS athena-window-guard: awg-2.0.0 adaptive geometry — preset strips clamp to the real display (update+create), off-screen strips relocated, mac-fullscreen skip + focused pass + discard alarm unchanged, fail-open without display info');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
