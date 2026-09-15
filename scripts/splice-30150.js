'use strict';
/* MLS Assist 3.0.150 - nofront-1.0.0 (Fable, 2026-09-15, owner: "it keeps jumping me to athena that is not ok").
 * Read from the module after the owner's word: every history/visits read (and the write probe's presence port)
 * called __mlsFrontAthenaForRead, which ACTIVATES the athena tab and FOCUSES its window whenever Chrome already
 * has focus ("fg-1.1: only steal focus Chrome already owns"), then the focus guardian hands the doctor back to
 * MLS - that is the jump he sees on every row. ensureBody (nowindow-1.0.0) still SELECTED the athena tab inside
 * its own window when it judged that displaced nothing; the judgement is his to make, not ours. Cure: the fronting
 * function's 60-line body is deleted - it answers null (its callers already treat null as "read where it is,
 * refuse honestly if occluded"); ensureBody never selects a tab - a hidden tab is read hidden ('limp'). No tab is
 * activated and no window is focused by any read, ever. Explicit owner clicks (Wake Athena, the AI switchtab
 * action, the write lane's own fronting before a supervised write) are untouched. Latin1 seams, inverse proof.
 * Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam (' + count(out, a) + ')'); assert(a.indexOf(b) >= 0 || count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
function fnBlock(src, start) { const i = src.indexOf(start); assert(i >= 0, 'fn: ' + start.slice(0, 50)); let d = 0, e = i; for (; e < src.length; e++) { if (src[e] === '{') d++; else if (src[e] === '}') { d--; if (d === 0) break; } } return src.slice(i, e + 1); }

/* 1. the fronting function is a null stub */
const front = fnBlock(out, '  async function __mlsFrontAthenaForRead(appTabId) {');
assert(front.length > 4000 && front.indexOf("await chrome.tabs.update(athT.id, { active: true });") > 0, 'fronting body located');
rep(front,
    "  async function __mlsFrontAthenaForRead(appTabId) {\n" +
    "    /* nofront-1.0.0 (3.0.150, owner: \"it keeps jumping me to athena that is not ok\"): reads never activate\n" +
    "       the athena tab or focus its window. The fg-1.1/1.2 body (front, hydrate, defer the restore) is deleted;\n" +
    "       every caller already treats null as \"read the tab where it is\". */\n" +
    "    return null;\n" +
    "  }", 'front stub');

/* 2. ensureBody never selects a tab */
rep("    /* nowindow-1.0.0 (3.0.147): select the tab inside ITS OWN window only when that displaces nothing the doctor is\n" +
    "       looking at (the rule since v2.9.35); otherwise the read proceeds on the hidden tab ('limp') under the callers'\n" +
    "       hidden-safe budgets. No window is created, moved, resized or focused - ever. */\n" +
    "    try {\n" +
    "      var t2 = await chrome.tabs.get(tab.id);\n" +
    "      var yank = !t2.active && (await mlsReadFocusWouldYank(tab.id));\n" +
    "      if (!t2.active && !yank) {\n" +
    "        await chrome.tabs.update(tab.id, { active: true }); await qpSleep(400);\n" +
    "        if (await tabVisible(tab.id)) { try { self.__mlsQpLastVerdict = { v: 'selected', at: Date.now(), tabId: tab.id }; } catch (eQv) {} return 'selected'; }\n" +
    "      }\n" +
    "    } catch (e) {}\n",
    "    /* nofront-1.0.0 (3.0.150): a hidden tab is read hidden. No selection, no activation, no focus - the doctor\n" +
    "       decides what is on screen. The read proceeds under the callers' hidden-safe budgets ('limp'). */\n", 'no selection');

/* proof */
{
  const front2 = fnBlock(out, '  async function __mlsFrontAthenaForRead(appTabId) {');
  assert(front2.indexOf('tabs.update') < 0 && front2.indexOf('windows.update') < 0, 'front stub is clean');
  const eb = fnBlock(out, '  async function ensureBody(tab, senderTabId) {');
  assert(eb.indexOf('tabs.update') < 0 && eb.indexOf("'selected'") < 0, 'ensureBody never selects');
}
let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30150: ' + edits.length + ' verified seams');
