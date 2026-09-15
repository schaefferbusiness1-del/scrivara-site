'use strict';
/* MLS Assist 3.0.162 - gohome-2.0.0 (Fable, 2026-09-16). The 3.0.161 probe grounded the schedule-first open on the
 * OWNER's hidden athena tab and left it on globalframeset.esp?MAIN=...dashboard WITHOUT the CSRFPROTECT token:
 * athena renders that as its "We were unable to complete the requested action ... Click Continue" interstitial with
 * NO frames (measured on the scratch tab: title empty, 0 frames, 145 chars), so the sweep found 0 rows and the Find
 * leg found no content frame. The Home driver clicks athena's logo, whose link drops the token. Cure: when the top
 * frame's own address carries CSRFPROTECT (the signed-in frameset), the TOP frame navigates itself to the same
 * frameset address with MAIN set to the practice's /ax/dashboard - token kept, no interstitial - and child frames
 * defer to it instead of clicking the logo; when there is no token to keep, the legacy logo click stays. Read-only
 * navigation of the tab the extension already drives; never activates or focuses anything. Latin1 seam, inverse
 * proof. Run once (after splice-30161.js).
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const target = path.join(__dirname, '..', 'background.js');
const before = fs.readFileSync(target, 'latin1');
const count = (s, n) => s.split(n).length - 1;
const a = "    if (!actionAllowed()) return { clicked: false, found: false, reason: 'request-deadline-exceeded' };\n    function vis(el) { try { var r = el.getBoundingClientRect(); var s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; } catch (e) { return false; } }\n    var el = document.querySelector('.menuitemlogo')\r\n"; /* that line is CRLF-terminated */
const b = "    if (!actionAllowed()) return { clicked: false, found: false, reason: 'request-deadline-exceeded' };\n" +
  "    /* gohome-2.0.0 (3.0.162): the logo link drops the CSRFPROTECT token and athena then renders its Continue interstitial\n" +
  "       with no frames; when the signed-in frameset address carries the token, the TOP frame navigates itself to the same\n" +
  "       address with MAIN set to the practice dashboard (token kept) and child frames defer to it. */\n" +
  "    try {\n" +
  "      var __ghTop = null; try { __ghTop = window.top; } catch (eGhT) { __ghTop = null; }\n" +
  "      var __ghTopHref = ''; try { __ghTopHref = String(__ghTop && __ghTop.location && __ghTop.location.href || ''); } catch (eGhH) { __ghTopHref = ''; }\n" +
  "      var __ghM = /^(https:\\/\\/[^/]+)\\/(\\d+)\\/(\\d+)\\/globalframeset\\.esp\\?(?:[^#]*&)?CSRFPROTECT=([0-9a-fA-F]+)/.exec(__ghTopHref);\n" +
  "      if (__ghM) {\n" +
  "        if (__ghTop !== window) return { clicked: false, found: true, deferredToTop: true, frame: location.hostname };\n" +
  "        var __ghUrl = __ghM[1] + '/' + __ghM[2] + '/' + __ghM[3] + '/globalframeset.esp?CSRFPROTECT=' + __ghM[4] + '&MAIN=' + encodeURIComponent(__ghM[1] + '/' + __ghM[2] + '/' + __ghM[3] + '/ax/dashboard');\n" +
  "        if (!actionAllowed()) return { clicked: false, found: true, reason: 'request-deadline-exceeded', frame: location.hostname };\n" +
  "        location.href = __ghUrl;\n" +
  "        return { clicked: true, found: true, via: 'tokened-frameset', frame: location.hostname };\n" +
  "      }\n" +
  "    } catch (eGh) {}\n" +
  "    function vis(el) { try { var r = el.getBoundingClientRect(); var s = getComputedStyle(el); return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none'; } catch (e) { return false; } }\n    var el = document.querySelector('.menuitemlogo')\r\n"; /* that line is CRLF-terminated */
assert(count(before, a) === 1 && count(before, b) === 0, 'gohome seam');
const out = before.replace(a, () => b);
assert.strictEqual(out.replace(b, () => a), before, 'inverse restores original');
fs.writeFileSync(target, Buffer.from(out, 'latin1'));
console.log('splice-30162: 1 verified seam');
