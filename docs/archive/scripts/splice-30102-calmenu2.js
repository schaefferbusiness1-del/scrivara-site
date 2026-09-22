/* splice-30102-calmenu2.js - ext 3.0.102 calmenu-1.0.1: two-stage Calendar
 * restore. MEASURED 2026-09-01 18:5x: in the globalnav frame the exact
 * 'Calendar' element exists (DIV.menucomponent) but 'View Calendar' is NOT in
 * that frame's DOM even after the click - athena renders the dropdown in
 * another document - so calmenu-1.0.0's in-frame poll never saw it and the
 * restore silently did nothing (day pull stuck on the dashboard for 3 rounds).
 * Stage 'open' clicks Calendar in globalnav; stage 'pick' runs allFrames and
 * clicks the exact 'View Calendar' entry wherever it rendered. 2 splices.
 */
'use strict';
var fs = require('fs');
var FIND_FN_START = "function mlsCalendarMenuFn() {";
var FIND_FN_END = "function mlsGoHomeDriverFn(requestGuard) {";
var s = fs.readFileSync('background.js', 'latin1');
var a = s.indexOf(FIND_FN_START), b = s.indexOf(FIND_FN_END);
if (a < 0 || b < 0 || b < a) { console.error('ABORT: driver anchors'); process.exit(1); }
var NEWFN = "function mlsCalendarMenuFn(stage) {\n" +
  "  /* calmenu-1.0.1 (3.0.102): two-stage. stage 'open' runs in the globalnav\n" +
  "     frame only and clicks the exact 'Calendar' menu; stage 'pick' runs in\n" +
  "     EVERY frame and clicks the exact 'View Calendar' entry wherever athena\n" +
  "     rendered the dropdown (measured: not inside globalnav). Nothing else is\n" +
  "     ever clicked. */\n" +
  "  try {\n" +
  "    function exact(txt) {\n" +
  "      var els = document.querySelectorAll('a, span, td, div, li');\n" +
  "      for (var i = 0; i < els.length; i++) {\n" +
  "        var own = '';\n" +
  "        try { own = String(els[i].textContent || '').replace(/\s+/g, ' ').trim(); } catch (e0) {}\n" +
  "        if (own === txt && els[i].offsetParent !== null) return els[i];\n" +
  "      }\n" +
  "      return null;\n" +
  "    }\n" +
  "    if (stage === 'open') {\n" +
  "      if (!/globalnav/i.test(String(location.pathname || ''))) return null;\n" +
  "      var cal = exact('Calendar');\n" +
  "      if (!cal) return { stage: 'open', calendar: false };\n" +
  "      try { cal.click(); } catch (e1) {}\n" +
  "      return { stage: 'open', calendar: true };\n" +
  "    }\n" +
  "    var vc = exact('View Calendar');\n" +
  "    if (!vc) return null;\n" +
  "    try { vc.click(); } catch (e2) { return { stage: 'pick', viewCalendar: false }; }\n" +
  "    return { stage: 'pick', viewCalendar: true, path: String(location.pathname || '').slice(0, 40) };\n" +
  "  } catch (e) { return { err: String((e && e.message) || e).slice(0, 60) }; }\n" +
  "}\n";
s = s.slice(0, a) + NEWFN + s.slice(b);
var CALL_FIND = "if (at > 0) { try { const cm = await __gotoExec({ target: { tabId: tab.id, allFrames: true }, func: mlsCalendarMenuFn }, Math.min(9000, __gotoLeft()), 'the Calendar menu'); const cmh = ((cm && cm.r) || []).map((r) => r && r.result).filter(Boolean); RD.calmenu = cmh.length ? cmh[0] : null; if (cmh.some((h) => h && h.viewCalendar)) { if (!(await __gotoWait(6500, 'the View Calendar settle'))) { __gotoDeadline('the View Calendar settle'); return; } } } catch (eCm) { RD.calmenuErr = String((eCm && eCm.message) || eCm).slice(0, 60); } }";
var CALL_REPL = "if (at > 0) { try { const cmo = await __gotoExec({ target: { tabId: tab.id, allFrames: true }, args: ['open'], func: mlsCalendarMenuFn }, Math.min(6000, __gotoLeft()), 'the Calendar menu'); const cmoh = ((cmo && cmo.r) || []).map((r) => r && r.result).filter(Boolean); RD.calmenu = cmoh.length ? cmoh[0] : null; if (cmoh.some((h) => h && h.calendar)) { if (!(await __gotoWait(900, 'the Calendar menu paint'))) { __gotoDeadline('the Calendar menu paint'); return; } const cmp = await __gotoExec({ target: { tabId: tab.id, allFrames: true }, args: ['pick'], func: mlsCalendarMenuFn }, Math.min(6000, __gotoLeft()), 'the View Calendar entry'); const cmph = ((cmp && cmp.r) || []).map((r) => r && r.result).filter(Boolean); RD.calpick = cmph.length ? cmph[0] : null; if (cmph.some((h) => h && h.viewCalendar)) { if (!(await __gotoWait(6500, 'the View Calendar settle'))) { __gotoDeadline('the View Calendar settle'); return; } } } } catch (eCm) { RD.calmenuErr = String((eCm && eCm.message) || eCm).slice(0, 60); } }";
var n = s.split(CALL_FIND).length - 1;
if (n !== 1) { console.error('ABORT: call anchor hits=' + n); process.exit(1); }
s = s.split(CALL_FIND).join(CALL_REPL);
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK calmenu-1.0.1 spliced');
