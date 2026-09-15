'use strict';
/* MLS Assist 3.0.140 - legacysettle-1.0.0 (Fable, 2026-09-15). Measured on three hidden-tab pulls of the same
 * day: the classic dashboard day grid (legacy-day-grid lane) read 22 rows twice (rowsScanned 48) and 40 once
 * (rowsScanned 88); in a full-size tab the same day lists 44 rows per copy in three provider/department
 * sections, is not virtualized and has no collapsing. The legacy lane reads the DOM ONCE, right after the
 * date navigation, while athena is still appending sections - so a partially loaded list is imported as the
 * whole day and 18 patients silently vanish. Cure: before the legacy lane reads, wait until the row count is
 * unchanged across two looks (bounded: up to four looks, 700 ms apart, hidden-safe sleep, the same
 * __scheduleActionAllowed() guard); the reader receipt carries the settle looks, the first/final row counts
 * and the per-section row counts (provider/department headings only - never a patient). Latin1 seams,
 * inverse proof. Run once.
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
let out = before; const edits = [];
const count = (s, n) => s.split(n).length - 1;
function eolAt(anchor) { const i = out.indexOf(anchor); assert(i >= 0, 'eol anchor: ' + anchor.slice(0, 60)); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
function rep(a, b, label) { assert(count(out, a) === 1, label + ' unique seam: ' + a.slice(0, 90) + ' (' + count(out, a) + ')'); assert(count(out, b) === 0, label + ' replacement absent'); out = out.replace(a, () => b); edits.push([a, b]); }
var a;

/* 1. the settle loop and the section census, before the legacy lane reads */
a = "      var _legacyGridListsL=[].slice.call(doc.querySelectorAll('[class~=\"appointments-container\"]'));";
{
  const N = eolAt(a);
  const L = [
    "      /* legacysettle-1.0.0 (3.0.140): the classic day grid appends its provider/department sections after the",
    "         date navigation; reading once mid-load imported half a day. Wait until the row count holds across two",
    "         looks (bounded, hidden-safe, same action guard), and record what the grid printed (headings only). */",
    "      try {",
    "        var _lsCount = function () { try { return doc.querySelectorAll('[class~=\"filled-appointment-row\"]').length; } catch (_eLsC) { return 0; } };",
    "        var _lsPrev = -1, _lsNow = _lsCount(), _lsFirst = _lsNow, _lsLooks = 0;",
    "        while (_lsLooks < 4 && _lsNow !== _lsPrev && __scheduleActionAllowed()) { _lsPrev = _lsNow; if (!(await __scheduleActionSleep(700))) break; _lsLooks++; _lsNow = _lsCount(); }",
    "        out.diag.legacySettleLooks = _lsLooks; out.diag.legacyRowsFirst = _lsFirst; out.diag.legacyRowsFinal = _lsNow; out.diag.legacySettled = (_lsNow === _lsPrev);",
    "        var _lsList = doc.querySelector('[class~=\"appointments-container\"]'), _lsSections = [], _lsCur = null;",
    "        if (_lsList) { [].slice.call(_lsList.children).forEach(function (c) { var cls = String(c.className || ''); if (/appointment-header/.test(cls)) { _lsCur = { h: String(c.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 30), n: 0 }; if (_lsSections.length < 12) _lsSections.push(_lsCur); } else if (/filled-appointment-row/.test(cls) && _lsCur) { _lsCur.n++; } }); }",
    "        out.diag.legacySections = _lsSections;",
    "      } catch (_eLs) {}",
    a
  ];
  rep(a, L.join(N), 'settle');
}

/* 2. the reader receipt carries the settle facts and the section census */
a = "headingRows: Number(__dd.headingRows || 0), coordErr: String(__dd.coordErr || '').slice(0, 60) }, /* readerdiag-1.0.0: PHI-free reader trace */";
rep(a, "headingRows: Number(__dd.headingRows || 0), coordErr: String(__dd.coordErr || '').slice(0, 60), settleLooks: Number(__dd.legacySettleLooks || 0), rowsFirst: Number(__dd.legacyRowsFirst || 0), rowsFinal: Number(__dd.legacyRowsFinal || 0), settled: __dd.legacySettled !== false, sections: (Array.isArray(__dd.legacySections) ? __dd.legacySections : []).slice(0, 12).map(function (s) { return { h: String(s && s.h || '').slice(0, 30), n: Number(s && s.n || 0) }; }) }, /* readerdiag-1.0.0: PHI-free reader trace; legacysettle-1.0.0 (3.0.140) */", 'receipt');

let restored = out;
for (const [x, y] of edits.slice().reverse()) { assert(count(restored, y) === 1, 'inverse unique'); restored = restored.replace(y, () => x); }
assert.strictEqual(restored, before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30140: ' + edits.length + ' verified seams');
