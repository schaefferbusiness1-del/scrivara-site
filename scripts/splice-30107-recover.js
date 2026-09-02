/* splice-30107-recover.js - ext 3.0.107 recover-1.1.0 (extension audit #1,
 * confirmed by one verifier, and measured live 2026-09-01 20:0x: a day in a
 * provider-scoped month pull looped "Athena is still switching days" for
 * minutes on a dashboard whose schedule widget had stopped rendering; the
 * ONLY cure was a same-origin reload of the tab to its dashboard frameset,
 * which is exactly what mlsRecoverAthenaTab does - and which it REFUSED every
 * time during a pull, because the pull's own quiet-probe lease makes
 * `self.__mlsQp.active` true for the whole pull ({skipped:'quiet-probe-active'}).
 * The goto ladder then inspected only the settle flag and carried on as if the
 * tab had been re-grounded, so round 1 repeated round 0 against the same
 * wedged renderer.
 * Cure: the lease OWNER may ask for the reload. mlsRecoverAthenaTab takes an
 * ownerToken; when the quiet probe is active but the caller holds the day
 * schedule lease (self.__mlsDayScheduleQpOwner === ownerToken) the bounded,
 * same-origin, signed-in-only reload proceeds; any other caller keeps the
 * refusal (never reload under somebody else's lease, never a signed-out or
 * non-athena tab, throttle unchanged). The goto ladder passes its guard
 * token and records the recovery's OWN verdict in the round receipt
 * (RD.reload = 'reloaded' | 'skipped:<why>' | 'settle-timeout') instead of
 * assuming. The reads-since-reload counter now resets only after a real
 * navigation, so the freeze-chunking rule cannot be silently disarmed by a
 * refused recovery.
 * Anchors are bare statements (indentation-agnostic); the files are CRLF, so
 * inserted lines use the file's own line ending. Fail-closed counts.
 */
'use strict';
var fs = require('fs');

function splice(file, edits) {
  var s = fs.readFileSync(file, 'latin1');
  var NL = /\r\n/.test(s) ? '\r\n' : '\n';
  edits.forEach(function (e, i) {
    var find = e.find.split('\n').join(NL);
    var repl = e.repl.split('\n').join(NL);
    if (e.after) {
      /* scoped edit: the FIRST occurrence of `find` after the unique `after` anchor */
      var a = s.indexOf(e.after);
      if (a < 0 || s.indexOf(e.after, a + 1) >= 0) { console.error('ABORT ' + file + ' edit ' + i + ': after-anchor not unique'); process.exit(1); }
      var p = s.indexOf(find, a);
      if (p < 0 || p - a > 400) { console.error('ABORT ' + file + ' edit ' + i + ': find not within 400 bytes after anchor'); process.exit(1); }
      s = s.slice(0, p) + repl + s.slice(p + find.length);
      return;
    }
    var n = s.split(find).length - 1;
    if (n !== e.n) { console.error('ABORT ' + file + ' edit ' + i + ': hits=' + n + ' expected ' + e.n + ' for: ' + e.find.slice(0, 80)); process.exit(1); }
    s = s.split(find).join(repl);
  });
  fs.writeFileSync(file, s, 'latin1');
  console.log('OK ' + file + ' (' + edits.length + ' edits)');
}

splice('background.js', [
  { n: 1,
    find: "async function mlsRecoverAthenaTab(tabId) {",
    repl: "async function mlsRecoverAthenaTab(tabId, ownerToken) { /* recover-1.1.0 (3.0.107): ownerToken = the day-schedule lease holder asking for its own reload */" },
  { n: 1, after: "try { await mlsArmKeepAlive(tabId, true, sessionHealth); } catch (eKa) {}",
    find: "__mlsReadsSinceReload = 0;",
    repl: "/* recover-1.1.0: the reads-since-reload counter resets only after a REAL navigation (below), never on a refused recovery */" },
  { n: 1, after: "skipped: 'recovery-throttled', manualRefresh: true, tabUntouched: true };",
    find: "if (self.__mlsQp && self.__mlsQp.active) {",
    repl: "if (self.__mlsQp && self.__mlsQp.active && !(ownerToken && self.__mlsDayScheduleQpOwner === ownerToken)) { /* recover-1.1.0 (3.0.107): the lease OWNER (the pull's own goto ladder) may reload its quiet workspace - measured 2026-09-01: the only cure for a dashboard whose widget stopped rendering was exactly this same-origin reload, and it was refused for the whole pull */" },
  { n: 1,
    find: "    await chrome.tabs.update(tabId, { url: recUrl });",
    repl: "    await chrome.tabs.update(tabId, { url: recUrl });\n    __mlsReadsSinceReload = 0; /* recover-1.1.0: a real navigation happened */" },
  { n: 1,
    find: "const recoveryX = await __gotoSettle(mlsRecoverAthenaTab(tab.id), Math.min(6000, __gotoLeft()), 'Athena recovery');",
    repl: "const recoveryX = await __gotoSettle(mlsRecoverAthenaTab(tab.id, __gotoGuard.token), Math.min(6000, __gotoLeft()), 'Athena recovery'); /* recover-1.1.0: the ladder owns the lease and says so */\n                  try { RD.reload = (recoveryX && recoveryX.value) ? (recoveryX.value.ok ? 'reloaded' : ('skipped:' + String(recoveryX.value.skipped || ''))) : 'settle-timeout'; } catch (eRdR) {}" }
]);
console.log('SPLICE 3.0.107 recover-1.1.0 DONE');
