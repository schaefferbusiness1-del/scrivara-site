'use strict';
/* MLS Assist 3.0.142 - legacyscroll-1.0.0 (Fable, 2026-09-15). Measured live, same day, same account, three ways:
 * a full-width tab printed the classic day grid with 44 rows; a fresh popup (any width, 1287 to 2300 px) printed
 * 24 - the first 12 + 4 rows of two sections whole and the first 8 of the 28 rows of the third, in time order.
 * Scrolling the list container (div.appointments) to its end made the remaining 20 rows appear about one second
 * later (sampled at 50 ms: 24 rows at 246 ms, 44 rows at 1257 ms after the scroll). athena's dashboard day grid
 * LAZY-LOADS: it paints a first page sized to the container and appends the rest only when the list is scrolled.
 * The extension never scrolls the list, so every hidden pull imported the first page as the whole day (22 of 40
 * rows on 3.0.139-3.0.141), and the 3.0.141 width theory (qpstrip-2.1.0) was wrong: the popup printed 24 rows at
 * 2248 px too. Cure, inside the 3.0.140 settle block of the legacy-day-grid lane: before every look, scroll the
 * list container to its end (and dispatch a scroll event); read only after two consecutive looks agree; up to
 * ten looks a second apart (hidden-safe sleep, same action guard); restore the container's scroll position; the
 * diag and the reader receipt carry the scroll count. The qpstrip-2.1.0 comment is corrected in place (the width
 * is kept for the desktop layout, it is no longer claimed as a cure). Latin1 seams on single lines (no EOL
 * dependence), inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }

/* 1. the comment over the settle block tells the truth */
rep("      /* legacysettle-1.0.0 (3.0.140): the classic day grid appends its provider/department sections after the",
    "      /* legacysettle-1.0.0 (3.0.140) + legacyscroll-1.0.0 (3.0.142): athena's classic day grid LAZY-LOADS on scroll -", 'comment 1');
rep("         date navigation; reading once mid-load imported half a day. Wait until the row count holds across two",
    "         it paints a first page (measured: 24 of 44 rows; the rest ~1 s after the list is scrolled to its end). Scroll", 'comment 2');
rep("         looks (bounded, hidden-safe, same action guard), and record what the grid printed (headings only). */",
    "         the list to its end before every look; read only after two looks agree (bounded, hidden-safe, same guard). */", 'comment 3');

/* 2. the scroll helper and the two-stable-looks loop (the inserted line breaks copy the block's own terminator) */
const __i = out.indexOf("        var _lsPrev = -1, _lsNow = _lsCount(), _lsFirst = _lsNow, _lsLooks = 0;");
assert(__i > 0, 'loop vars anchor present');
const __nl = out.indexOf('\n', __i); const N = (__nl > 0 && out[__nl - 1] === '\r') ? '\r\n' : '\n';
rep("        var _lsPrev = -1, _lsNow = _lsCount(), _lsFirst = _lsNow, _lsLooks = 0;",
    "        var _lsScroll = function () { try { var sc = doc.querySelector('div.appointments'); if (!sc) return false; sc.scrollTop = sc.scrollHeight; try { sc.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (_eLsE) {} return true; } catch (_eLsS) { return false; } };" + N +
    "        var _lsPrev = -1, _lsNow = _lsCount(), _lsFirst = _lsNow, _lsLooks = 0, _lsScrolls = 0, _lsStable = 0;", 'loop vars');
rep("        while (_lsLooks < 4 && _lsNow !== _lsPrev && __scheduleActionAllowed()) { _lsPrev = _lsNow; if (!(await __scheduleActionSleep(700))) break; _lsLooks++; _lsNow = _lsCount(); }",
    "        while (_lsLooks < 10 && _lsStable < 2 && __scheduleActionAllowed()) { _lsPrev = _lsNow; if (_lsScroll()) _lsScrolls++; if (!(await __scheduleActionSleep(1000))) break; _lsLooks++; _lsNow = _lsCount(); _lsStable = (_lsNow === _lsPrev) ? _lsStable + 1 : 0; }", 'loop');
rep("        out.diag.legacySettleLooks = _lsLooks; out.diag.legacyRowsFirst = _lsFirst; out.diag.legacyRowsFinal = _lsNow; out.diag.legacySettled = (_lsNow === _lsPrev);",
    "        try { var _lsSc0 = doc.querySelector('div.appointments'); if (_lsSc0) _lsSc0.scrollTop = 0; } catch (_eLsR) {}" + N +
    "        out.diag.legacySettleLooks = _lsLooks; out.diag.legacyRowsFirst = _lsFirst; out.diag.legacyRowsFinal = _lsNow; out.diag.legacySettled = (_lsStable >= 2); out.diag.legacyScrolls = _lsScrolls;", 'diag');

/* 3. the reader receipt carries the scroll count */
rep("settled: __dd.legacySettled !== false, sections: (Array.isArray(__dd.legacySections) ? __dd.legacySections : []).slice(0, 12).map(function (s) { return { h: String(s && s.h || '').slice(0, 30), n: Number(s && s.n || 0) }; }) }, /* readerdiag-1.0.0: PHI-free reader trace; legacysettle-1.0.0 (3.0.140) */",
    "settled: __dd.legacySettled !== false, scrolls: Number(__dd.legacyScrolls || 0), sections: (Array.isArray(__dd.legacySections) ? __dd.legacySections : []).slice(0, 12).map(function (s) { return { h: String(s && s.h || '').slice(0, 30), n: Number(s && s.n || 0) }; }) }, /* readerdiag-1.0.0: PHI-free reader trace; legacysettle-1.0.0 (3.0.140); legacyscroll-1.0.0 (3.0.142) */", 'receipt');

/* 4. the qpstrip-2.1.0 comment no longer claims a cure it never was */
rep("/* qpstrip-2.1.0 (3.0.141): a desktop-width viewport - below it athena's day grid prints a subset of a long section (measured: 8 of 28 rows at 760 px) */",
    "/* qpstrip-2.1.0 (3.0.141): a desktop-width viewport for the desktop layout. NOTE 3.0.142: the 8-of-28 rows measured at 760 px were athena's lazy-loaded FIRST PAGE, not a width effect (a 2248 px popup printed the same 24 rows) - cured by legacyscroll-1.0.0 in the day-grid lane */", 'qpstrip comment');

let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30142: ' + edits.length + ' verified seams');
