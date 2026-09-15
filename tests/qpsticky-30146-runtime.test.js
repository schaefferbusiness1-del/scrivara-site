'use strict';
/* MLS Assist 3.0.146 — qpsticky-1.0.0: the quiet work window is handed back 30 s after the LAST verb ended, and
 * the next row's ensure cancels the hand-back. Executes the real deferred-release helper with fake timers and
 * pins that the three verb terminals arm it while the real ends still release at once. */
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const root = path.join(__dirname, '..');
const bg = fs.readFileSync(path.join(root, 'background.js'), 'latin1');
let checks = 0;
const ok = (v, m) => { assert.ok(v, m); checks++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, m); checks++; };

/* static pins */
ok(bg.includes('  var QP_STICKY_MS = 30000;'), 'the sticky window lasts 30 s past the last verb');
eq(bg.split("(self.__mlsQpReleaseSoon || self.__mlsQpRelease)(reason || 'goto-date-terminal')").length - 1, 1, 'the goto-date terminal arms the hand-back');
eq(bg.split("(self.__mlsQpReleaseSoon || self.__mlsQpRelease)(reason || 'schedule-terminal')").length - 1, 1, 'the schedule terminal arms the hand-back');
eq(bg.split('(self.__mlsQpReleaseSoon || self.__mlsQpRelease)(reason)).then(function () {').length - 1, 1, 'the visits cleanup barrier arms the hand-back');
ok(bg.includes("await self.__mlsQpRelease('app-end');"), 'the app\'s end-of-pull message still releases at once');
ok(bg.includes("qpRelease('quiet');") && bg.includes("qpRelease('alarm');"), 'the quiet and alarm sweepers still release at once');
ok(bg.includes("__mlsQpRelease('write')") && bg.includes("__mlsQpRelease('explicit-wake-recovery')"), 'the write lane and wake recovery still release at once');
const ensureIdx = bg.indexOf('  async function qpEnsure(tab, senderTabId) {');
ok(ensureIdx > 0 && bg.slice(ensureIdx, ensureIdx + 200).includes('qpStickyCancel();'), 'an ensure cancels the pending hand-back first');

/* the helper with fake timers */
const s = bg.indexOf('  var qpStickyTimer = null, qpStickyArmed = 0, qpStickyCancelled = 0;');
const e = bg.indexOf('  self.__mlsQpSticky = function () { return { armed: qpStickyArmed, cancelled: qpStickyCancelled, pending: !!qpStickyTimer }; };', s);
ok(s > 0 && e > s, 'helper present');
const block = bg.slice(s, e + '  self.__mlsQpSticky = function () { return { armed: qpStickyArmed, cancelled: qpStickyCancelled, pending: !!qpStickyTimer }; };'.length);
const timers = []; let nextId = 1;
const fakeSetTimeout = (fn, ms) => { const id = nextId++; timers.push({ id, fn, ms, live: true }); return id; };
const fakeClearTimeout = (id) => { timers.forEach((t) => { if (t.id === id) t.live = false; }); };
const released = [];
const self = {};
const fn = new Function('self', 'setTimeout', 'clearTimeout', 'qpRelease', 'QP_STICKY_MS', block + '\nreturn { soon: qpReleaseSoon, cancel: qpStickyCancel };');
const h = fn(self, fakeSetTimeout, fakeClearTimeout, (r) => { released.push(r); return Promise.resolve(); }, 30000);
(async () => {
  const r1 = await h.soon('goto-date-terminal');
  eq(r1.deferred, true, 'the deferred release answers at once'); eq(released.length, 0, 'nothing released yet');
  eq(timers.filter((t) => t.live).length, 1, 'one hand-back armed'); eq(timers[0].ms, 30000, 'thirty seconds out');
  /* the next row arrives: its ensure cancels the hand-back */
  h.cancel();
  eq(timers.filter((t) => t.live).length, 0, 'the pending hand-back is cancelled');
  eq(self.__mlsQpSticky().cancelled, 1, 'and counted');
  /* the row ends: a new hand-back is armed, the earlier one stays dead */
  await h.soon('schedule-terminal');
  eq(timers.filter((t) => t.live).length, 1, 'exactly one live hand-back after re-arming');
  /* another terminal before it fires re-arms rather than stacking */
  await h.soon('all-visits-after-response');
  eq(timers.filter((t) => t.live).length, 1, 'terminals re-arm, never stack');
  eq(self.__mlsQpSticky().armed, 3, 'three arms counted');
  /* the pull goes quiet: the live timer fires and releases with a sticky-tagged reason */
  const live = timers.find((t) => t.live); live.fn();
  eq(released.length, 1, 'released once'); eq(released[0], 'all-visits-after-response:sticky', 'the reason names the verb and the sticky hand-back');
  eq(self.__mlsQpSticky().pending, false, 'no hand-back pending after it fired');
  console.log('PASS qpsticky-30146-runtime: ' + checks + ' checks');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });
