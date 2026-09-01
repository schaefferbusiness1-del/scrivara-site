/* splice-30106-revert-landed.js - REVERT the found-nulling half of landed-1.0.0.
 * MEASURED 2026-09-01 19:5x (single-day pull of 2026-08-05 from a dashboard
 * parked on today): with a weekstrip hit that reports done:false the ladder
 * now drove athena HOME every round, which reset the strip to today, so the
 * navigation never progressed and the app re-checked "Athena is still
 * switching days" for 170 s+. The audit's second refuter was right: a strip
 * that saw the control but has not landed yet is making PROGRESS through the
 * verification loop's own re-clicks; the Home ladder is for the case where no
 * control exists at all. Kept from landed-1.0.0: the frame memo and the
 * own-frame header-date check (they only matter once a control is found).
 * Indentation-agnostic anchors on the exact inserted text; CRLF-aware.
 */
'use strict';
var fs = require('fs');
var s = fs.readFileSync('background.js', 'latin1');
var NL = /\r\n/.test(s) ? '\r\n' : '\n';
var I8 = '        ';
function nl(x) { return x.split('\n').join(NL); }
var edits = [
  { n: 1,
    find: "if (found && found.done === false) { GDIAG.notLanded = String(found.error || 'not-landed').slice(0, 60); found = null; __gotoFoundFrame = null; }",
    repl: "if (found && found.done === false) { GDIAG.notLanded = String(found.error || 'not-landed').slice(0, 60); } /* landed-1.0.1 (3.0.106): the found-nulling is REVERTED - measured 2026-09-01: a done:false strip hit is PROGRESS, and sending it through the Home ladder reset athena to today every round (170 s of 'still switching days'); a seen control never enters the ladder, only a missing one does, exactly as before 3.0.104 */" },
  { n: 1,
    find: "found = hits2b.find((h) => h.found && h.done !== false) || null; /* landed-1.0.0 */",
    repl: "found = hits2b.find((h) => h.found) || null; /* landed-1.0.1: any seen control counts, as before 3.0.104 */" },
  { n: 1,
    find: "found = hits2.find((h) => h.found && h.done !== false) || null; /* landed-1.0.0 */",
    repl: "found = hits2.find((h) => h.found) || null; /* landed-1.0.1: any seen control counts, as before 3.0.104 */" },
  { n: 1,
    find: "const __gotoFoundFrameOf = (rx) => { try { const rr = ((rx && rx.r) || []).find((r) => r && r.result && r.result.found && r.result.done !== false); return rr && rr.frameId != null ? rr.frameId : null; } catch (e) { return null; } };",
    repl: "const __gotoFoundFrameOf = (rx) => { try { const rr = ((rx && rx.r) || []).find((r) => r && r.result && r.result.found); return rr && rr.frameId != null ? rr.frameId : null; } catch (e) { return null; } };" }
];
edits.forEach(function (e, i) {
  var n = s.split(e.find).length - 1;
  if (n !== e.n) { console.error('ABORT edit ' + i + ': hits=' + n); process.exit(1); }
  s = s.split(e.find).join(e.repl);
});
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK landed-1.0.1 (revert of found-nulling) spliced');
