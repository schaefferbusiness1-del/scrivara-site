'use strict';
/* MLS Assist 3.0.147 - nowindow-1.0.0 (Fable, 2026-09-15). Owner, in his words: "the whole snapping windows out is not
 * reliable and not going to work for me". The quiet-pull work window (qpstrip-2.0.0 in 3.0.135, widened in 3.0.141,
 * made sticky in 3.0.146) is DELETED: qpMakeStrip, the strip branch of ensureBody, releaseBody's tab move home, and
 * the winId/orig/strip lease fields. No window is ever created, moved, resized or focused. What remains of the
 * policy: a hidden athenaOne tab is selected inside ITS OWN window only when that displaces nothing the doctor is
 * looking at (unchanged); otherwise the read proceeds on the hidden tab ('limp') under the callers' hidden-safe
 * budgets. The lease (one exact tab per pull), the sticky hand-back timer (now only ending the lease), the quiet
 * and alarm sweepers and the session restore keep working on the tab id alone. Latin1 seams, inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(b === '' || a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
function eolAfter(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor'); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function fnBlock(src, start) { const i = src.indexOf(start); assert(i >= 0, 'fn: ' + start.slice(0, 50)); let d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) break; } } return src.slice(i, e + 1); }

/* 1. the work-window builder and its comment go */
const mkComment = "  /* qpstrip-2.0.0 (3.0.135): give a hidden athenaOne tab its own unfocused work window at the\n     right edge of its display. Returns {winId, orig, bounds} or null. The doctor's window,\n     focus and active tab are never touched; qpRelease moves the tab home afterwards. */\n";
const mk = fnBlock(out, '  async function qpMakeStrip(tab, t2) {');
assert(count(out, mkComment + mk + '\n  self.__mlsQpMakeStrip = qpMakeStrip;\n') === 1, 'builder + comment + export contiguous');
rep(mkComment + mk + '\n  self.__mlsQpMakeStrip = qpMakeStrip;\n',
    "  /* nowindow-1.0.0 (3.0.147, owner 2026-09-15: \"the whole snapping windows out is not reliable and not going to work\n     for me\"): the work window (qpstrip-2.0.0..2.1.0, qpMakeStrip) is deleted. No window is ever created, moved,\n     resized or focused; a hidden athenaOne tab is read where it is. */\n", 'builder deleted');

/* 2. ensureBody: keep the harmless in-window selection, drop the strip, answer selected / limp */
const eb = fnBlock(out, '  async function ensureBody(tab, senderTabId) {');
const tailStart = eb.indexOf("    if (await tabVisible(tab.id)) return 'visible';");
assert(tailStart > 0, 'ensure tail anchor');
const oldTail = eb.slice(tailStart);
assert(oldTail.indexOf('qpMakeStrip(tab, t2)') > 0 && /return 'limp';\n  \}$/.test(oldTail), 'ensure tail is the strip branch');
const newTail =
  "    if (await tabVisible(tab.id)) return 'visible'; /* already on screen (incl. doctor parked on athena) */\n" +
  "    /* nowindow-1.0.0 (3.0.147): select the tab inside ITS OWN window only when that displaces nothing the doctor is\n" +
  "       looking at (the rule since v2.9.35); otherwise the read proceeds on the hidden tab ('limp') under the callers'\n" +
  "       hidden-safe budgets. No window is created, moved, resized or focused - ever. */\n" +
  "    try {\n" +
  "      var t2 = await chrome.tabs.get(tab.id);\n" +
  "      var yank = !t2.active && (await mlsReadFocusWouldYank(tab.id));\n" +
  "      if (!t2.active && !yank) {\n" +
  "        await chrome.tabs.update(tab.id, { active: true }); await qpSleep(400);\n" +
  "        if (await tabVisible(tab.id)) { try { self.__mlsQpLastVerdict = { v: 'selected', at: Date.now(), tabId: tab.id }; } catch (eQv) {} return 'selected'; }\n" +
  "      }\n" +
  "    } catch (e) {}\n" +
  "    try { self.__mlsQpLastVerdict = { v: 'limp', at: Date.now(), tabId: tab.id }; } catch (eQv2) {}\n" +
  "    return 'limp';\n" +
  "  }";
rep(oldTail, newTail, 'ensure tail');
rep("    QP.athenaTabId = tab.id; QP.winId = null; QP.orig = null; QP.strip = null;", "    QP.athenaTabId = tab.id;", 'ensure lease fields');

/* 3. releaseBody (the tab move home) goes; the release just ends the lease */
const rb = fnBlock(out, '  async function releaseBody() {');
rep(rb + '\n', "  /* nowindow-1.0.0 (3.0.147): releaseBody (the move of the tab back to its home window) is deleted - nothing was moved. */\n", 'releaseBody deleted');
rep("    var restoreTask = releaseBody().catch(function () {});\n    var r = Promise.race([restoreTask, qpSleep(QP_RESTORE_WAIT_MS)]);",
    "    var r = Promise.resolve(); /* nowindow-1.0.0: no window to move back; the lease just ends */", 'release call');

/* 4. the lease carries the tab id only */
rep("      QP.restoring = null; QP.active = false; QP.winId = null; QP.orig = null; QP.strip = null; QP.athenaTabId = null;",
    "      QP.restoring = null; QP.active = false; QP.athenaTabId = null;", 'release fields');
rep("          QP.active = false; QP.winId = null; QP.orig = null; QP.strip = null;", "          QP.active = false;", 'close fields');
rep("        winId: QP.winId, athenaTabId: QP.athenaTabId, orig: QP.orig, strip: QP.strip || null, at: Date.now() } : null });",
    "        athenaTabId: QP.athenaTabId, at: Date.now() } : null });", 'persist fields');
{
  const rl1 = "        QP.active = true; QP.winId = s.winId; QP.athenaTabId = s.athenaTabId; QP.orig = s.orig || null;";
  const N2 = eolAfter(rl1);
  rep(rl1 + N2 + "        QP.strip = s.strip || null;", "        QP.active = true; QP.athenaTabId = s.athenaTabId;", 'restore fields');
}
rep("  var QP = { active: false, winId: null, athenaTabId: null, orig: null, strip: null, lastUse: 0, pending: null, restoring: null, epoch: 0 };",
    "  var QP = { active: false, athenaTabId: null, lastUse: 0, pending: null, restoring: null, epoch: 0 };", 'state object');

/* proof: nothing in the module creates or moves a window any more */
{
  const s = out.indexOf('  self.__mlsQp = QP;'), e = out.indexOf('// MLS Assist NOTE WRITE-BACK ENGINE');
  const mod = out.slice(s - 6000, e);
  assert(!/windows\.create|tabs\.move|qpMakeStrip\(|releaseBody\(|QP\.winId|QP\.strip|QP\.orig/.test(mod), 'module free of window surgery');
}
let restored = out;
for (const [x, y] of edits.slice().reverse()) { if (y === '') { assert(count(restored, x) === 0, 'inverse'); restored = restored; } else { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); } }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30147: ' + edits.length + ' verified seams');
