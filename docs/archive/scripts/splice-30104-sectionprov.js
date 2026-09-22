/* splice-30104-sectionprov.js - ext 3.0.104 sectionprov-1.0.0.
 * MEASURED 2026-09-01 (owner's athenaOne, single-day pull of 2026-08-05 scoped
 * to one PA): the grid reader returned 2 rows with provider '' while the read
 * discovered TWO provider names ("Uyen Phan, PA-C", "Matthew Schaeffer, MD").
 * athenaOne's Day/Week view grouped by provider paints each clinician as a
 * HEADER ROW (no time, just the name + credentials) followed by that
 * clinician's appointment rows, which carry no provider cell. The table-path
 * reader skipped every timeless row, so the header was never attached and the
 * app-side identity gate refused all 13 remaining days of the month as
 * "no provider identity" (fail-closed, correctly - the fix belongs HERE, in
 * the reader that saw the heading). The sequence-path reader already tracks
 * headings this way (`cur`); this brings the grid path to parity. A row that
 * carries its own provider cell keeps it; only column-less rows inherit the
 * heading, and the receipt counts both headings and inherited rows.
 * ASCII-only insert (latin1 writer). Indentation-agnostic anchor, exact count.
 */
'use strict';
var fs = require('fs');
var s = fs.readFileSync('background.js', 'latin1');
var FIND = "rows.forEach(function(r){out.diag.rowsScanned++;var cells=[].slice.call(r.querySelectorAll('th, td, [role=\"cell\"], [role=\"gridcell\"]'));if(!cells.length)return;var rt=tx(r),tm=ft(ti>=0&&cells[ti]?tx(cells[ti]):rt);if(!tm)return;var prov=cells[pi]?np(tx(cells[pi])):'';";
var REPL = "var secProv='';/* sectionprov-1.0.0 (3.0.104): a timeless row that reads as 'Name, CRED' is athena's provider heading; rows under it inherit it when they carry no provider cell (measured 2026-09-01: 2 of 2 rows refused as identity-less under a visible heading) */rows.forEach(function(r){out.diag.rowsScanned++;var cells=[].slice.call(r.querySelectorAll('th, td, [role=\"cell\"], [role=\"gridcell\"]'));if(!cells.length)return;var rt=tx(r),tm=ft(ti>=0&&cells[ti]?tx(cells[ti]):rt);if(!tm){var hdr=String(rt||'').trim();if(hdr.length<=80&&/^[A-Z][A-Za-z'.-]+(?:\\s+[A-Z][A-Za-z'.-]+){0,4},\\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|RN|DPM|DDS|DMD|PHD|MBBS|OD|CRNP)\\b/.test(hdr)){secProv=np(hdr)||'';out.diag.sectionHeaders=(out.diag.sectionHeaders||0)+1;}return;}var prov=cells[pi]?np(tx(cells[pi])):'';if(!prov&&secProv){prov=secProv;out.diag.sectionTagged=(out.diag.sectionTagged||0)+1;}";
var n = s.split(FIND).length - 1;
if (n !== 1) { console.error('ABORT: grid-reader anchor hits=' + n); process.exit(1); }
if (/[^\x00-\x7f]/.test(REPL)) { console.error('ABORT: non-ASCII in replacement'); process.exit(1); }
s = s.split(FIND).join(REPL);
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK sectionprov-1.0.0 spliced');
