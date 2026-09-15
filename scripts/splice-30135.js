'use strict';
/* MLS Assist 3.0.135 - qpstrip-2.0.0 (Fable, 2026-09-14). Owner: "it shouldn't have to be visible
 * to work." Measured across nine pulls today: a background athenaOne tab does not paint (the React
 * week strip has no day tabs, the Find Patient control never renders, chart panes swap late), so
 * reads there time out or refuse while the same rows read clean on a visible tab. The quiet-pull
 * lease used to answer 'limp' whenever selecting the tab would displace what the doctor is looking
 * at. It now gives the athenaOne tab its own UNFOCUSED work window at the right edge of its own
 * display (doctor's window, focus and active tab untouched); qpRelease already moves the tab back
 * to its original window and index when the run goes quiet, and the empty work window closes
 * itself. Byte-preserving latin1 seams with an inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90)); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }

/* 1. the work-window maker, placed right before ensureBody */
{
  const a = "  async function ensureBody(tab, senderTabId) {";
  const N = eolAt(a);
  rep(a,
      "  /* qpstrip-2.0.0 (3.0.135): give a hidden athenaOne tab its own unfocused work window at the" + N +
      "     right edge of its display. Returns {winId, orig, bounds} or null. The doctor's window," + N +
      "     focus and active tab are never touched; qpRelease moves the tab home afterwards. */" + N +
      "  async function qpMakeStrip(tab, t2) {" + N +
      "    try {" + N +
      "      var host = await chrome.windows.get(t2.windowId);" + N +
      "      if (!host || host.type !== 'normal') return null;" + N +
      "      var wa = null;" + N +
      "      try {" + N +
      "        var displays = await chrome.system.display.getInfo();" + N +
      "        var cx = Number(host.left || 0) + Number(host.width || 0) / 2, cy = Number(host.top || 0) + Number(host.height || 0) / 2;" + N +
      "        var d = (displays || []).filter(function (x) { var b = x && x.workArea; return b && cx >= b.left && cx < b.left + b.width && cy >= b.top && cy < b.top + b.height; })[0] || (displays || [])[0];" + N +
      "        wa = d && d.workArea;" + N +
      "      } catch (eDisp) {}" + N +
      "      var W = 760, H = Math.max(600, Math.round(((wa && wa.height) || 900) * 0.85));" + N +
      "      var left = wa ? (wa.left + wa.width - W) : 40, top = wa ? (wa.top + 40) : 40;" + N +
      "      var orig = { windowId: t2.windowId, index: t2.index };" + N +
      "      var w = await chrome.windows.create({ tabId: tab.id, focused: false, type: 'normal', state: 'normal', left: left, top: top, width: W, height: H });" + N +
      "      if (!w || w.id == null) return null;" + N +
      "      return { winId: w.id, orig: orig, bounds: { left: left, top: top, width: W, height: H } };" + N +
      "    } catch (e) { return null; }" + N +
      "  }" + N +
      "  self.__mlsQpMakeStrip = qpMakeStrip;" + N +
      a, 'maker');
}

/* 2. ensureBody: when selecting the tab would yank, or selection leaves it hidden, use the work window */
{
  const a = "    try {" + eolAt("      var t2 = await chrome.tabs.get(tab.id);") +
            "      var t2 = await chrome.tabs.get(tab.id);" + eolAt("      var t2 = await chrome.tabs.get(tab.id);") +
            "      if (!t2.active) {" + eolAt("      var t2 = await chrome.tabs.get(tab.id);") +
            "        if (await mlsReadFocusWouldYank(tab.id)) return 'limp';" + eolAt("      var t2 = await chrome.tabs.get(tab.id);") +
            "        await chrome.tabs.update(tab.id, { active: true });" + eolAt("      var t2 = await chrome.tabs.get(tab.id);") +
            "      }" + eolAt("      var t2 = await chrome.tabs.get(tab.id);") +
            "    } catch (e) {}";
  const N = eolAt("      var t2 = await chrome.tabs.get(tab.id);");
  rep(a,
      "    try {" + N +
      "      var t2 = await chrome.tabs.get(tab.id);" + N +
      "      var yank = !t2.active && (await mlsReadFocusWouldYank(tab.id));" + N +
      "      if (!t2.active && !yank) { await chrome.tabs.update(tab.id, { active: true }); await qpSleep(400); }" + N +
      "      /* qpstrip-2.0.0 (3.0.135, owner: \"it shouldn't have to be visible to work\"): a background tab" + N +
      "         does not paint, so the read cannot succeed there. When selecting the tab would displace what" + N +
      "         the doctor is looking at, or selection still leaves it hidden, give it an unfocused work" + N +
      "         window of its own; the doctor's window, focus and active tab stay exactly as they are. */" + N +
      "      if (yank || !(await tabVisible(tab.id))) {" + N +
      "        var strip = await qpMakeStrip(tab, t2);" + N +
      "        if (strip) { QP.orig = strip.orig; QP.winId = strip.winId; QP.soloWin = false; QP.strip = strip.bounds; persist(); try { self.__mlsQpLastVerdict = { v: 'strip', at: Date.now(), tabId: tab.id, winId: strip.winId }; } catch (eQv) {} }" + N +
      "      }" + N +
      "    } catch (e) {}", 'ensure');
}

let restored = out;
for (const [a, b] of edits.slice().reverse()) { assert(count(restored, b) === 1, 'inverse unique'); restored = restored.replace(b, () => a); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30135: ' + edits.length + ' verified seams');
