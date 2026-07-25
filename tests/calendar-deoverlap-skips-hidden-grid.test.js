'use strict';

/* Do not pay a per-node layout scan to discover there is nothing to lay out.
 *
 * deoverlapGrid() filtered EVERY node under #calGrid through isBlk(), which
 * calls getComputedStyle AND getBoundingClientRect on each one. While
 * #calendarView is not the visible screen, every rect is 0, so isBlk()'s
 * `r.height < 10` check rejects all of them and the function already did
 * nothing — after paying a forced layout read per node to find that out.
 * (isBlk short-circuits on position !== absolute, so most nodes cost only a
 * getComputedStyle. An earlier version of this header said two reads per node
 * and was wrong: the counterfactual measured 113 reads for 113 nodes, not 226.)
 * applyAll() runs 13 times during boot: once, then a 700ms interval x12.
 *
 * Measured on the running page at b606, with the calendar hidden:
 *
 *   calendarView.display        "none"
 *   calGrid.getClientRects()    empty
 *   nodes scanned per pass      113   -> 113 forced reads per pass
 *   across 13 boot passes             -> 1,456 reads saved (112 x 13)
 *   blocks actually found       0
 *
 * The other lane measured 3,722 reads from this file on a signed-in session —
 * 67% of the app's 5,576 — which is the same phenomenon with a larger calendar.
 * Each read costs ~16ms because the PATIENTS directory is the screen being laid
 * out while boot runs (1,481 patients, 150 rows rendered), and ~700 boot
 * mutations x 16ms is the measured 10,929ms of Total Blocking Time.
 *
 * The fix is behaviour-preserving by construction:
 *   hidden  -> every rect was 0, the scan returned empty, we now return earlier
 *   visible -> getClientRects() is non-empty and everything below runs as before
 * visibility:hidden still reports rects, so that case is deliberately unchanged.
 *
 * This is NOT the content-visibility:auto change. That one has no trustworthy
 * verdict — three A/B runs on the same page gave three different answers because
 * contain-intrinsic-size permanently mutates the page being measured — and the
 * lane that measured it said explicitly it must not ship on those numbers. */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'feat_mls_calendar_exact.js'), 'utf8');

const fn = /function deoverlapGrid\(\) \{([\s\S]*?)\n  \}/.exec(src);
assert(fn, 'deoverlapGrid() no longer parses');
const body = fn[1];

/* the bail must exist */
assert(/if \(!grid\.getClientRects\(\)\.length\) return;/.test(body),
  'deoverlapGrid no longer bails when the grid is not laid out, so it pays a getComputedStyle + ' +
  'getBoundingClientRect on every node under #calGrid on all 13 boot passes to find nothing');

/* and it must come BEFORE the per-node scan, or it saves nothing */
const bailAt = body.indexOf('getClientRects().length');
const scanAt = body.indexOf('querySelectorAll("*")');
assert(bailAt > -1 && scanAt > -1 && bailAt < scanAt,
  'the bail must precede the querySelectorAll("*") scan — after it, every read has already happened');

/* the reason hidden implies empty: isBlk rejects zero-height rects. If that
   check ever goes, the bail stops being provably equivalent. */
assert(/function isBlk\(el\) \{[\s\S]{0,400}r\.height \|\| 0\) < 10\) return false;/.test(src),
  "isBlk no longer rejects zero-height rects, so 'hidden means the scan finds nothing' is no longer " +
  'guaranteed — re-derive whether the early bail is still behaviour-preserving');

/* the scan itself must still be there for the visible case */
assert(/\[\]\.slice\.call\(grid\.querySelectorAll\("\*"\)\)\.filter\(isBlk\)/.test(body),
  'the de-overlap scan is gone entirely — the bail was meant to skip it while hidden, not remove it');

/* and applyAll must still drive it, or nothing lays the calendar out at all */
assert(/deoverlapGrid\(\);/.test(src) && /function applyAll\(\)/.test(src),
  'deoverlapGrid is no longer called from the orchestration path');

console.log('PASS calendar de-overlap skips a hidden grid: one rect replaces 112 forced layout reads per pass (1,456 across boot)');
