'use strict';
/* MLS Assist 3.0.135 — qpstrip-2.0.0: a hidden athenaOne tab gets its own UNFOCUSED work window on
 * its own display; the doctor's window, focus and active tab are never touched. Executes the real
 * qpMakeStrip against stubbed chrome APIs and pins the ensureBody decision and the release path. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* 1. lift qpMakeStrip and execute it */
const s = bg.indexOf('  async function qpMakeStrip(tab, t2) {');
ok(s > 0, 'qpMakeStrip present');
let d = 0, e = s; for (; e < bg.length; e++) { if (bg[e] === '{') d++; else if (bg[e] === '}') { d--; if (d === 0) { e++; break; } } }
const src = bg.slice(s, e);
function makeChrome(opts) {
  const calls = { create: [], update: [], tabsUpdate: [] };
  const chrome = {
    windows: {
      get: async (id) => ({ id, type: opts.hostType || 'normal', left: 0, top: 0, width: 2560, height: 1400, focused: true }),
      create: async (data) => { calls.create.push(data); return { id: 777 }; },
      update: async (id, data) => { calls.update.push([id, data]); return {}; }
    },
    tabs: { update: async (id, data) => { calls.tabsUpdate.push([id, data]); return {}; } },
    system: { display: { getInfo: async () => opts.displays || [{ workArea: { left: 0, top: 0, width: 2560, height: 1360 } }, { workArea: { left: 2560, top: 0, width: 1920, height: 1040 } }] } }
  };
  return { chrome, calls };
}
(async () => {
  {
    const { chrome, calls } = makeChrome({});
    const fn = new Function('chrome', src + '\nreturn qpMakeStrip;')(chrome);
    const r = await fn({ id: 5 }, { id: 5, windowId: 11, index: 3, active: false });
    ok(r && r.winId === 777, 'work window created');
    assert.deepStrictEqual(r.orig, { windowId: 11, index: 3 }); checks++;
    eq(calls.create.length, 1, 'exactly one window created');
    const c = calls.create[0];
    eq(c.focused, false, 'never focused');
    eq(c.tabId, 5, 'the athena tab moves into it');
    eq(c.left + c.width, 2560, 'placed at the right edge of the host display work area');
    eq(c.width, 1408, 'qpstrip-2.1.0 (3.0.141): a desktop-width viewport, 55% of a 2560 work area');
    ok(c.width >= 1280 && c.width <= 1500, 'width stays between 1280 and 1500');
    eq(c.top, 40, 'below the top edge');
    ok(c.height >= 600 && c.height <= 1360, 'height bounded to the work area');
    eq(calls.update.length, 0, 'the doctor\'s window is never moved or resized');
    eq(calls.tabsUpdate.length, 0, 'no tab selection changes');
  }
  {
    const { chrome, calls } = makeChrome({ hostType: 'popup' });
    const fn = new Function('chrome', src + '\nreturn qpMakeStrip;')(chrome);
    const r = await fn({ id: 5 }, { id: 5, windowId: 11, index: 0, active: false });
    eq(r, null, 'a non-normal host window is left alone');
    eq(calls.create.length, 0, 'no window created for a popup host');
  }
  {
    const { chrome } = makeChrome({ displays: [] });
    const fn = new Function('chrome', src + '\nreturn qpMakeStrip;')(chrome);
    const r = await fn({ id: 5 }, { id: 5, windowId: 11, index: 0, active: false });
    ok(r && r.bounds.left === 40 && r.bounds.top === 40 && r.bounds.width === 1287, 'no display info -> safe default bounds (2340 * 0.55 = 1287)');
  }
  /* 2. the ensure decision and the release path */
  ok(bg.includes("      var yank = !t2.active && (await mlsReadFocusWouldYank(tab.id));"), 'yank decision computed first');
  ok(bg.includes("      if (yank || !(await tabVisible(tab.id))) {"), 'work window when selection would yank or leaves the tab hidden');
  ok(bg.includes("        var strip = await qpMakeStrip(tab, t2);"), 'ensure uses the maker');
  ok(bg.includes("QP.orig = strip.orig; QP.winId = strip.winId; QP.strip = strip.bounds; persist();"), 'lease records the original window and index for release');
  ok(bg.includes("if (QP.athenaTabId != null && QP.orig && QP.orig.windowId != null) {"), 'release moves the tab home to its original window');
  ok(bg.includes("await chrome.tabs.move(QP.athenaTabId, { windowId: QP.orig.windowId, index: QP.orig.index });"), 'release restores the original index');
  ok(!bg.includes("a read must NEVER create, move, or resize a"), 'the superseded no-window comment is gone');
  ok(!/soloWin|athOrig|hostWinId|hostOrig|flashed/.test(bg), 'the retired solo-window and host-window lease fields are deleted, not parked');
  ok(!bg.includes('No window is ever created, moved, or resized (v2.9.35 directive)'), 'no comment still claims the old policy');
  ok(bg.includes("v2.9.35 rule (never create a window) is superseded by this owner instruction"), 'the current policy is written where the code is');
  console.log('PASS qpstrip-30135-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
