'use strict';
/* MLS Assist 3.0.146 - qpsticky-1.0.0 (Fable, 2026-09-15, owner: "this athena tab keeps popping in and out, it
 * looks so glitchy and is not ok"). Measured in the module: every verb that establishes the quiet work window
 * (goto-date, schedule read, all-visits read) hands the athena tab back to its home window the moment that verb
 * ends (__gotoCleanup / __schedCleanup / fireVisitCleanup -> qpRelease), and the next row's verb builds the
 * window again - so a 40-row pull creates and destroys the window dozens of times. Cure: those three verb
 * terminals now schedule a STICKY release instead - the window is handed back 30 s after the last verb ended,
 * and any ensure that arrives before then cancels the hand-back and keeps the same window (ensureBody already
 * answers 'visible' at once for a tab that is still on screen). The immediate releases stay immediate: the
 * app's end-of-pull message (app-end), the quiet/alarm sweepers, the write lane, wake recovery and the
 * late-pending guard. Nothing about where the window opens or how the tab is read changes. Latin1 seams,
 * inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
function eolAfter(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor'); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }

/* 1. the sticky window: constant, deferred release, and the ensure that keeps it */
{
  const a = '  var QP_RESTORE_WAIT_MS = 8000;'; const N = eolAfter(a);
  rep(a, a + N + '  var QP_STICKY_MS = 30000; /* qpsticky-1.0.0 (3.0.146): the work window is handed back this long after the LAST verb ended, never per row */', 'constant');
}
{
  const a = '  self.__mlsQpRelease = qpRelease;'; const N = eolAfter(a);
  rep(a, a + N +
    "  /* qpsticky-1.0.0 (3.0.146): a verb terminal never hands the window back itself - it arms a hand-back that the" + N +
    "     next row's ensure cancels; only a real end (app-end, quiet, alarm, write, wake recovery) releases at once. */" + N +
    "  var qpStickyTimer = null, qpStickyArmed = 0, qpStickyCancelled = 0;" + N +
    "  function qpReleaseSoon(reason) {" + N +
    "    try { if (qpStickyTimer) clearTimeout(qpStickyTimer); } catch (eSt) {}" + N +
    "    qpStickyArmed++;" + N +
    "    qpStickyTimer = setTimeout(function () { qpStickyTimer = null; qpRelease(String(reason || 'sticky') + ':sticky').catch(function () {}); }, QP_STICKY_MS);" + N +
    "    return Promise.resolve({ ok: true, deferred: true });" + N +
    "  }" + N +
    "  function qpStickyCancel() { try { if (qpStickyTimer) { clearTimeout(qpStickyTimer); qpStickyTimer = null; qpStickyCancelled++; } } catch (eSc) {} }" + N +
    "  self.__mlsQpReleaseSoon = qpReleaseSoon;" + N +
    "  self.__mlsQpSticky = function () { return { armed: qpStickyArmed, cancelled: qpStickyCancelled, pending: !!qpStickyTimer }; };", 'deferred release');
}
{
  const a = '  async function qpEnsure(tab, senderTabId) {'; const N = eolAfter(a);
  rep(a, a + N + '    qpStickyCancel(); /* qpsticky-1.0.0: the next row keeps the window */', 'ensure keeps');
}

/* 2. the three verb terminals arm the hand-back instead of releasing */
rep("var release = Promise.resolve(self.__mlsQpRelease(reason || 'goto-date-terminal')).catch(function () {});",
    "var release = Promise.resolve((self.__mlsQpReleaseSoon || self.__mlsQpRelease)(reason || 'goto-date-terminal')).catch(function () {}); /* qpsticky-1.0.0 */", 'goto terminal');
rep("var release = Promise.resolve(self.__mlsQpRelease(reason || 'schedule-terminal')).catch(function () {});",
    "var release = Promise.resolve((self.__mlsQpReleaseSoon || self.__mlsQpRelease)(reason || 'schedule-terminal')).catch(function () {}); /* qpsticky-1.0.0 */", 'schedule terminal');
rep('            Promise.resolve(self.__mlsQpRelease(reason)).then(function () {',
    '            Promise.resolve((self.__mlsQpReleaseSoon || self.__mlsQpRelease)(reason)).then(function () { /* qpsticky-1.0.0 */', 'visits terminal');

let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30146: ' + edits.length + ' verified seams');
