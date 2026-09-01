/* splice-30104-nav.js - ext 3.0.104 landed-1.0.0 (extension pull/write audit,
 * 2026-09-01, two confirmed navigation defects):
 *  (1) gotoDate treated "a date control was seen" (found:true) as "the
 *      navigation landed". A weekstrip that saw the strip but could not reach
 *      the day answered {found:true, done:false, error:'weekstrip: target day
 *      not reachable'} and the whole Home / CSRF-Continue / Calendar-menu
 *      recovery ladder was skipped; the verification loop then re-clicked the
 *      same dead arrow and the day was filed needs-attention. Now a hit that
 *      reported done:false does not count as found, so the ladder runs.
 *  (2) The header-date verification accepted the target date from ANY frame.
 *      Now it prefers the frame that owns the schedule control; the any-frame
 *      rule is only a fallback (and the receipt says which was used).
 *  Plus content.js: mlsVisitsCensus is routed but was missing from
 *  MLS_BRIDGE_TYPES, so the router gate dropped it before its handler.
 * Anchors are bare statements (indentation-agnostic, unique); the files are
 * CRLF, so inserted lines use the file's own line ending. Fail-closed counts.
 */
'use strict';
var fs = require('fs');

function splice(file, edits) {
  var s = fs.readFileSync(file, 'latin1');
  var NL = /\r\n/.test(s) ? '\r\n' : '\n';
  edits.forEach(function (e, i) {
    var n = s.split(e.find).length - 1;
    if (n !== e.n) { console.error('ABORT ' + file + ' edit ' + i + ': hits=' + n + ' expected ' + e.n + ' for: ' + e.find.slice(0, 80)); process.exit(1); }
    s = s.split(e.find).join(e.repl.split('\n').join(NL));
  });
  fs.writeFileSync(file, s, 'latin1');
  console.log('OK ' + file + ' (' + edits.length + ' edits)');
}

var I8 = '        ';
splice('background.js', [
  { n: 1,
    find: "let found = hits.find((h) => h.found) || null;",
    repl: "let found = hits.find((h) => h.found) || null;\n" +
          I8 + "/* landed-1.0.0 (3.0.104): remember WHICH frame answered with a landed\n" +
          I8 + "   control so the date verification below reads that frame's header. */\n" +
          I8 + "const __gotoFoundFrameOf = (rx) => { try { const rr = ((rx && rx.r) || []).find((r) => r && r.result && r.result.found && r.result.done !== false); return rr && rr.frameId != null ? rr.frameId : null; } catch (e) { return null; } };\n" +
          I8 + "let __gotoFoundFrame = __gotoFoundFrameOf(initX);" },
  { n: 1,
    find: "if (msg.probe) return __gotoRespond({ ok: true, supported: true, via: (found && found.via) || 'auto-recovery', controlVisible: !!found });",
    repl: "if (msg.probe) return __gotoRespond({ ok: true, supported: true, via: (found && found.via) || 'auto-recovery', controlVisible: !!found });\n" +
          I8 + "/* landed-1.0.0 (3.0.104, audit 2026-09-01): 'found' meant a control exists,\n" +
          I8 + "   never that the navigation LANDED. A strip that could not reach the day\n" +
          I8 + "   returned done:false and the recovery ladder below was skipped. */\n" +
          I8 + "if (found && found.done === false) { GDIAG.notLanded = String(found.error || 'not-landed').slice(0, 60); found = null; __gotoFoundFrame = null; }" },
  { n: 1,
    find: "found = hits2b.find((h) => h.found) || null;",
    repl: "found = hits2b.find((h) => h.found && h.done !== false) || null; /* landed-1.0.0 */\n" +
          I8 + "    if (found) __gotoFoundFrame = __gotoFoundFrameOf(rx2);" },
  { n: 1,
    find: "found = hits2.find((h) => h.found) || null;",
    repl: "found = hits2.find((h) => h.found && h.done !== false) || null; /* landed-1.0.0 */\n" +
          I8 + "          if (found) __gotoFoundFrame = __gotoFoundFrameOf(gx);" },
  { n: 1,
    find: "const onTarget = dates.indexOf(date) >= 0;",
    repl: "/* landed-1.0.0 (3.0.104): the header date must come from the frame that owns\n" +
          I8 + "   the schedule control - a date read from any other frame (a chart, a\n" +
          I8 + "   letters view) could answer ok for the wrong day. The any-frame rule\n" +
          I8 + "   stays only as the fallback when that frame reported nothing. */\n" +
          I8 + "const __ownFrame = (chk || []).find((r) => r && __gotoFoundFrame != null && r.frameId === __gotoFoundFrame && r.result);\n" +
          I8 + "GDIAG.dateFrame = __ownFrame ? 'own' : 'any';\n" +
          I8 + "const onTarget = __ownFrame ? (String(__ownFrame.result) === date) : (dates.indexOf(date) >= 0);" }
]);

splice('content.js', [
  { n: 1,
    find: "var MLS_BRIDGE_TYPES = { mlsPing: 1, ",
    repl: "var MLS_BRIDGE_TYPES = { mlsPing: 1, mlsVisitsCensus: 1 /* census-gate-1.0.0 (3.0.104): routed at the handler but missing here, so the gate dropped it */, " }
]);
console.log('SPLICE 3.0.104 landed-1.0.0 DONE');
