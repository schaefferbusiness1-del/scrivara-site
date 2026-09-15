'use strict';
/* MLS Assist 3.0.147 — nowindow-1.0.0: the quiet-pull module never creates, moves, resizes or focuses a window.
 * Runs the real ensureBody against a fake chrome whose window API throws if touched: a visible tab answers
 * 'visible'; a hidden tab in an unfocused window is selected in place ('selected'); a hidden tab whose selection
 * would displace what the doctor is looking at is read where it is ('limp'); a discarded tab answers 'sleeping'. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };
function fnBlock(src, start) { const i = src.indexOf(start); assert(i >= 0, 'fn: ' + start.slice(0, 50)); let d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) break; } } return src.slice(i, e + 1); }

/* static: the module is free of window surgery */
const s = bg.indexOf('  self.__mlsQp = QP;'), e = bg.indexOf('// MLS Assist NOTE WRITE-BACK ENGINE');
ok(s > 0 && e > s, 'module located');
const mod = bg.slice(s - 6000, e);
['windows.create', 'tabs.move', 'qpMakeStrip(', 'releaseBody(', 'QP.winId', 'QP.strip', 'QP.orig', 'windows.update'].forEach((needle) => ok(!mod.includes(needle), 'module never uses ' + needle));
eq(bg.split('qpMakeStrip').length - 1, 1, 'qpMakeStrip survives only in the deletion note');
ok(mod.includes("var QP = { active: false, athenaTabId: null, lastUse: 0, pending: null, restoring: null, epoch: 0 };"), 'the lease carries the tab id only');
ok(mod.includes("athenaTabId: QP.athenaTabId, at: Date.now() } : null });"), 'the persisted lease carries the tab id only');

/* the real ensureBody */
const eb = fnBlock(bg, '  async function ensureBody(tab, senderTabId) {');
async function run(opts) {
  const calls = { get: 0, update: 0, windows: 0 };
  let active = !!opts.active, visible = !!opts.visible;
  const chrome = {
    tabs: { get: async (id) => { calls.get++; return { id, active }; }, update: async (id, u) => { calls.update++; if (u && u.active) { active = true; visible = opts.visibleAfterSelect !== false; } return { id }; } },
    windows: new Proxy({}, { get() { calls.windows++; throw new Error('window api touched'); } })
  };
  const QP = { active: false, athenaTabId: null };
  const self = {};
  const fn = new Function('chrome', 'QP', 'self', 'tabVisible', 'persist', 'qpSleep', 'mlsReadFocusWouldYank', 'mlsAthTabSleeping', eb + '\nreturn ensureBody;');
  const ensure = fn(chrome, QP, self, async () => visible, () => {}, async () => {}, async () => !!opts.yank, (t) => !!opts.sleeping);
  const verdict = await ensure({ id: 77 }, 1);
  return { verdict, calls, QP, last: self.__mlsQpLastVerdict };
}
(async () => {
  let r = await run({ visible: true, active: true });
  eq(r.verdict, 'visible', 'a tab already on screen is used as is'); eq(r.calls.update, 0, 'nothing selected'); eq(r.calls.windows, 0, 'no window API');
  eq(r.QP.athenaTabId, 77, 'the lease pins the tab'); eq(r.QP.active, true, 'and is active');
  r = await run({ visible: false, active: false, yank: false });
  eq(r.verdict, 'selected', 'a hidden tab in an unfocused window is selected in place'); eq(r.calls.update, 1, 'one selection'); eq(r.calls.windows, 0, 'no window API');
  eq(r.last && r.last.v, 'selected', 'verdict recorded');
  r = await run({ visible: false, active: false, yank: true });
  eq(r.verdict, 'limp', 'a tab whose selection would displace the doctor is read where it is'); eq(r.calls.update, 0, 'never selected'); eq(r.calls.windows, 0, 'no window API');
  eq(r.last && r.last.v, 'limp', 'verdict recorded');
  r = await run({ visible: false, active: false, yank: false, visibleAfterSelect: false });
  eq(r.verdict, 'limp', 'a selection that still leaves the tab hidden is honest'); eq(r.calls.windows, 0, 'no window API');
  r = await run({ visible: true, sleeping: true });
  eq(r.verdict, 'sleeping', 'a discarded tab answers sleeping before anything else');
  console.log('PASS nowindow-30147-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
