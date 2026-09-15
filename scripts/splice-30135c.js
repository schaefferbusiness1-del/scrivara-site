'use strict';
/* MLS Assist 3.0.135 - qpstrip-2.0.0 cleanup (owner 2026-09-14: "feel free to delete code if you have
 * to and you're sure, don't always just add"). After qpstrip-2.0.0 the quiet-pull lease never sets
 * soloWin/athOrig/hostWinId/hostOrig to anything but false/null (ensureBody clears them and nothing
 * assigns them), so the two release branches that restore a "solo" athena window and the doctor's
 * window bounds are unreachable, and the module header still describes the retired taskbar-flash
 * design. Delete the dead fields, the dead branches, and rewrite the header to the current law.
 * Byte-preserving latin1 seams with an inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90)); assert(b === '' || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
function span(startMark, endMark, b, label) {
  const i = out.indexOf(startMark); assert(i >= 0 && count(out, startMark) === 1, label + ' start unique');
  const j = out.indexOf(endMark, i); assert(j > i, label + ' end after start');
  const a = out.slice(i, j + endMark.length);
  rep(a, b, label);
}

/* 1. header comment */
{
  const N = eolAt(' * v2.9.5 QUIET PULL (__mlsQp)');
  span(' * v2.9.5 QUIET PULL (__mlsQp)', ' * focuses a window the doctor is using.',
    " * v2.9.5 QUIET PULL (__mlsQp) - pulls must never steal the doctor's focus." + N +
    " * A covered or background tab is occluded (visibilityState hidden, rAF 0/s, timers" + N +
    " * throttled) and athenaOne does not paint there, so a read needs the tab VISIBLE" + N +
    " * somewhere without ever foregrounding it over the doctor's work." + N +
    " *   - qpEnsure(tab, senderTabId): already visible -> 'visible'. Otherwise select the" + N +
    " *     tab inside its window only when that displaces nothing the doctor is looking at;" + N +
    " *     else (qpstrip-2.0.0, 3.0.135) move it once into an UNFOCUSED work window of its" + N +
    " *     own at the right edge of its display -> 'strip'. Still occluded -> 'limp': the" + N +
    " *     read proceeds under the callers' own budgets and retries." + N +
    " *   - qpRelease(): move athena back to its original window and index, preserving" + N +
    " *     whatever tab the doctor has selected - fired by end-of-run mlsAppFocusMlsTab, a" + N +
    " *     120s quiet watchdog + alarms backstop (worker restarts), and before any write op." + N +
    " * Quiet pulls record NO focus debt, so the guardian never yanks the doctor back to MLS." + N +
    " * The doctor's window is never moved, resized, focused or re-selected.", 'header');
}

/* 2. lease shape: drop the four dead fields */
rep("  var QP = { active: false, winId: null, athenaTabId: null, orig: null, soloWin: false, athOrig: null," + eolAt("  var QP = { active: false, winId: null") +
    "             hostWinId: null, hostOrig: null, lastUse: 0, flashed: false, pending: null, restoring: null, epoch: 0 };",
    "  var QP = { active: false, winId: null, athenaTabId: null, orig: null, strip: null, lastUse: 0, pending: null, restoring: null, epoch: 0 };", 'shape');
rep("          QP.active = false; QP.winId = null; QP.orig = null; QP.soloWin = false;" + eolAt("          QP.active = false; QP.winId = null; QP.orig = null; QP.soloWin = false;") +
    "          QP.athenaTabId = null; QP.pending = null; QP.restoring = null;",
    "          QP.active = false; QP.winId = null; QP.orig = null; QP.strip = null;" + eolAt("          QP.active = false; QP.winId = null; QP.orig = null; QP.soloWin = false;") +
    "          QP.athenaTabId = null; QP.pending = null; QP.restoring = null;", 'onRemoved');
rep("        winId: QP.winId, athenaTabId: QP.athenaTabId, orig: QP.orig, soloWin: QP.soloWin," + eolAt("        winId: QP.winId, athenaTabId: QP.athenaTabId, orig: QP.orig, soloWin: QP.soloWin,") +
    "        athOrig: QP.athOrig, hostWinId: QP.hostWinId, hostOrig: QP.hostOrig, strip: QP.strip || null, at: Date.now() } : null });",
    "        winId: QP.winId, athenaTabId: QP.athenaTabId, orig: QP.orig, strip: QP.strip || null, at: Date.now() } : null });", 'persist');

/* 3. ensureBody: the stale v2.9.36 line and the reset */
{
  const N = eolAt("       No window is ever created, moved, or resized (v2.9.35 directive). */");
  rep("       / wrong-tab class). The watchdog release clears the lease as before." + N +
      "       No window is ever created, moved, or resized (v2.9.35 directive). */",
      "       / wrong-tab class). The watchdog release clears the lease as before. */", 'v2936');
  rep("    QP.athenaTabId = tab.id; QP.winId = null; QP.soloWin = false; QP.orig = null; QP.athOrig = null; QP.strip = null;" + N +
      "    QP.hostWinId = null; QP.hostOrig = null;" + N +
      "    QP.active = true; QP.flashed = false;",
      "    QP.athenaTabId = tab.id; QP.winId = null; QP.orig = null; QP.strip = null;" + N +
      "    QP.active = true;", 'reset');
  rep("        if (strip) { QP.orig = strip.orig; QP.winId = strip.winId; QP.soloWin = false; QP.strip = strip.bounds; persist();",
      "        if (strip) { QP.orig = strip.orig; QP.winId = strip.winId; QP.strip = strip.bounds; persist();", 'strip-assign');
}

/* 4. releaseBody: the move-home guard and the two unreachable restore branches */
rep("    if (!QP.soloWin && QP.athenaTabId != null && QP.orig && QP.orig.windowId != null) {",
    "    if (QP.athenaTabId != null && QP.orig && QP.orig.windowId != null) {", 'move-home guard');
{
  const i = out.indexOf("    if (QP.soloWin && QP.winId != null && QP.athOrig) {"); const j = out.indexOf("    if (preserveTabId != null) {", i);
  assert(i > 0 && j > i && count(out, "    if (QP.soloWin && QP.winId != null && QP.athOrig) {") === 1, "dead branches bounded");
  rep(out.slice(i, j), "", "dead restore branches");
}

/* 5. qpRelease guard + finally, and the adopt-on-restart shape */
rep("    if (!QP.active && QP.hostOrig == null && !QP.pending && !QP.restoring) return;",
    "    if (!QP.active && !QP.pending && !QP.restoring) return;", 'release guard');
{
  const N = eolAt("      QP.restoring = null; QP.active = false; QP.winId = null; QP.orig = null; QP.soloWin = false;");
  rep("      QP.restoring = null; QP.active = false; QP.winId = null; QP.orig = null; QP.soloWin = false;" + N +
      "      QP.athOrig = null; QP.hostWinId = null; QP.hostOrig = null; QP.athenaTabId = null; QP.flashed = false;",
      "      QP.restoring = null; QP.active = false; QP.winId = null; QP.orig = null; QP.strip = null; QP.athenaTabId = null;", 'release finally');
}
rep("        QP.soloWin = !!s.soloWin; QP.athOrig = s.athOrig || null; QP.hostWinId = s.hostWinId; QP.hostOrig = s.hostOrig || null; QP.strip = s.strip || null;",
    "        QP.strip = s.strip || null;", 'adopt');

/* inverse proof */
let restored = out;
for (const [a, b] of edits.slice().reverse()) {
  if (b === '') { /* deletion: reinsert at the unique context that preceded it */ continue; }
  assert(count(restored, b) === 1, 'inverse unique: ' + b.slice(0, 60)); restored = restored.replace(b, () => a);
}
/* the single deletion is re-inserted by its unique neighbour */
{
  const del = edits.filter(([, b]) => b === '')[0][0];
  const neighbour = "    if (preserveTabId != null) {";
  assert(count(restored, neighbour) === 1 && count(restored, del) === 0, 'deletion neighbour unique');
  restored = restored.replace(neighbour, () => del + neighbour);
}
assert.strictEqual(restored, before, 'inverse restores original');
assert(!/soloWin|athOrig|hostWinId|hostOrig|flashed/.test(out.slice(out.indexOf('QUIET PULL (__mlsQp)'), out.indexOf('MLS Assist NOTE WRITE-BACK ENGINE'))), 'no dead field survives in the module');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30135c: ' + edits.length + ' verified seams');
