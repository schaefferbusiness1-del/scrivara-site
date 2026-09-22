/* splice-30101-calmenu.js - ext 3.0.101 calmenu-1.0.0: when the weekstrip
 * date navigation fails from the dashboard, drive athena's own globalnav
 * Calendar > View Calendar (the classic schedule surface) before retrying.
 * Measured all day 2026-09-01: after every completed day the driver re-grounds
 * to the DASHBOARD, whose schedule widget cannot express a provider-scoped day
 * switch; every manual cure was exactly this menu path, and each restore made
 * the next days land. Read-only navigation inside athena's own nav menu -
 * the driver clicks nothing outside the globalnav frame, and only the two
 * exact menu entries. 2 splices, exact counts.
 */
'use strict';
var fs = require('fs');

var DRIVER = "function mlsCalendarMenuFn() {\n" +
  "  /* calmenu-1.0.0 (3.0.101): runs ONLY in the globalnav frame; clicks the\n" +
  "     exact 'Calendar' menu then its exact 'View Calendar' entry. Anything\n" +
  "     else returns receipts untouched. */\n" +
  "  try {\n" +
  "    if (!/globalnav/i.test(String(location.pathname || ''))) return null;\n" +
  "    function exact(txt) {\n" +
  "      var els = document.querySelectorAll('a, span, td, div, li');\n" +
  "      for (var i = 0; i < els.length; i++) {\n" +
  "        var own = '';\n" +
  "        try { own = String(els[i].textContent || '').replace(/\\s+/g, ' ').trim(); } catch (e0) {}\n" +
  "        if (own === txt && els[i].offsetParent !== null) return els[i];\n" +
  "      }\n" +
  "      return null;\n" +
  "    }\n" +
  "    var cal = exact('Calendar');\n" +
  "    if (!cal) return { frame: 'globalnav', calendar: false };\n" +
  "    try { cal.click(); } catch (e1) {}\n" +
  "    var t0 = Date.now();\n" +
  "    return new Promise(function (res) {\n" +
  "      var iv = setInterval(function () {\n" +
  "        var vc = exact('View Calendar');\n" +
  "        if (vc) { clearInterval(iv); try { vc.click(); } catch (e2) {} res({ frame: 'globalnav', calendar: true, viewCalendar: true }); return; }\n" +
  "        if (Date.now() - t0 > 3500) { clearInterval(iv); res({ frame: 'globalnav', calendar: true, viewCalendar: false }); }\n" +
  "      }, 250);\n" +
  "    });\n" +
  "  } catch (e) { return { err: String((e && e.message) || e).slice(0, 60) }; }\n" +
  "}\n";

var edits = [
  { find: "function mlsGoHomeDriverFn(requestGuard) {",
    repl: DRIVER + "function mlsGoHomeDriverFn(requestGuard) {", n: 1 },
  { find: "                for (let at = 0; at < 3 && !found; at++) {\n" +
          "                  if (!(await __gotoWait(at === 0 ? 5200 : 3200, 'the schedule frameset settle'))) { __gotoDeadline('the schedule frameset settle'); return; } /* frameset rebuild settle */",
    repl: "                for (let at = 0; at < 3 && !found; at++) {\n" +
          "                  if (!(await __gotoWait(at === 0 ? 5200 : 3200, 'the schedule frameset settle'))) { __gotoDeadline('the schedule frameset settle'); return; } /* frameset rebuild settle */\n" +
          "                  /* calmenu-1.0.0 (3.0.101): the dashboard's widget cannot express a provider-scoped day switch (measured 2026-09-01 - every manual cure was Calendar > View Calendar, and each one made the next days land). From the second attempt on, drive athena's own globalnav menu to the classic schedule surface first, then let the existing weekstrip try. */\n" +
          "                  if (at > 0) { try { const cm = await __gotoExec({ target: { tabId: tab.id, allFrames: true }, func: mlsCalendarMenuFn }, Math.min(9000, __gotoLeft()), 'the Calendar menu'); const cmh = ((cm && cm.r) || []).map((r) => r && r.result).filter(Boolean); RD.calmenu = cmh.length ? cmh[0] : null; if (cmh.some((h) => h && h.viewCalendar)) { if (!(await __gotoWait(6500, 'the View Calendar settle'))) { __gotoDeadline('the View Calendar settle'); return; } } } catch (eCm) { RD.calmenuErr = String((eCm && eCm.message) || eCm).slice(0, 60); } }",
    n: 1 }
];
var s = fs.readFileSync('background.js', 'latin1');
for (var i = 0; i < edits.length; i++) {
  var e = edits[i], n = s.split(e.find).length - 1;
  if (n !== e.n) { console.error('ABORT edit ' + i + ': hits=' + n); process.exit(1); }
  s = s.split(e.find).join(e.repl);
}
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK calmenu-1.0.0 spliced (2 edits)');
