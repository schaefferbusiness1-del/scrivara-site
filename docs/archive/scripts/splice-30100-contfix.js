/* splice-30100-contfix.js - ext 3.0.100 contfix-1.0.0: the interstitial
 * handler CLICKS athena's own Continue on the CSRF retry page instead of
 * declaring manualActionRequired and letting every navigation round fail.
 * Measured 2026-09-01 (Uyen August month pull): ~10 wedges, every one cured by
 * a DOM click on that exact control; the engine's rounds re-detected the page
 * each time and did nothing. Session-expired variants STAY manual (never
 * re-auth); only the exact retry page with an exact Continue control is
 * pressed, and pages carrying sign/order/billing vocabulary refuse.
 */
'use strict';
var fs = require('fs');
var FIND = "function mlsAthenaContinueFn() {\n" +
  "  try {\n" +
  "    var body = String((document.body && document.body.innerText) || '').slice(0, 12000);\n" +
  "    if (!/unable to complete|could not complete|session (has )?(expired|timed)|please try again/i.test(body)) return { seen: false };\n" +
  "    return { seen: true, clicked: false, manualActionRequired: true };\n" +
  "  } catch (e) { return { seen: false, error: String((e && e.message) || e).slice(0, 80) }; }\n" +
  "}";
var REPL = "function mlsAthenaContinueFn() {\n" +
  "  try {\n" +
  "    var body = String((document.body && document.body.innerText) || '').slice(0, 12000);\n" +
  "    if (!/unable to complete|could not complete|session (has )?(expired|timed)|please try again/i.test(body)) return { seen: false };\n" +
  "    /* contfix-1.0.0 (3.0.100, measured live 2026-09-01): the \"We were unable\n" +
  "       to complete the requested action\" page is athena's CSRF retry\n" +
  "       interstitial - its Continue re-issues the SAME read-only navigation\n" +
  "       with a fresh token. This handler used to only REPORT it\n" +
  "       (manualActionRequired), so every goHome/gotoDate round re-detected the\n" +
  "       page and did nothing; a month pull burned whole days until a human\n" +
  "       clicked Continue (~10 wedges in one pull, each cured by exactly that\n" +
  "       click). Now the handler presses athena's own Continue - ONLY on the\n" +
  "       exact retry page, ONLY the exact Continue control, and NEVER on a page\n" +
  "       carrying sign/order/billing vocabulary. Session-expired variants keep\n" +
  "       the manual path: a real sign-out is the owner's click, always. */\n" +
  "    var retryPage = /unable to complete the requested action/i.test(body);\n" +
  "    if (retryPage && !/sign\\s*&?\\s*save|place order|billing|payment|prescri/i.test(body)) {\n" +
  "      var els = document.querySelectorAll('input[type=submit],input[type=button],button,a');\n" +
  "      for (var i = 0; i < els.length; i++) {\n" +
  "        var v = String((els[i].value || els[i].textContent || '')).trim();\n" +
  "        if (/^continue$/i.test(v)) { try { els[i].click(); return { seen: true, clicked: true, via: 'contfix' }; } catch (eClk) { break; } }\n" +
  "      }\n" +
  "    }\n" +
  "    return { seen: true, clicked: false, manualActionRequired: true };\n" +
  "  } catch (e) { return { seen: false, error: String((e && e.message) || e).slice(0, 80) }; }\n" +
  "}";
var s = fs.readFileSync('background.js', 'latin1');
var n = s.split(FIND).length - 1;
if (n !== 1) { console.error('ABORT: contfix anchor hits=' + n); process.exit(1); }
s = s.split(FIND).join(REPL);
fs.writeFileSync('background.js', s, 'latin1');
console.log('OK contfix-1.0.0 spliced');
