/* splice-30110-surfnav.js - ext 3.0.110 surfnav-1.0.0.
 *
 * THE DEFECT, MEASURED LIVE 2026-09-02 05:5x-06:1x (owner's practice, MLS
 * Assist 3.0.107 loaded, site rebuilt three times during the window). The
 * durable month pull's date navigation failed on nine attempts across those
 * three builds, and every failing day was a day whose goto BEGAN while
 * athenaOne was parked on its DASHBOARD. That is not a coincidence: the
 * extension's own schedule leg navigates Home after the per-chart reads
 * (background.js ~7818-7825), and so does the goto ladder itself (~7260 and
 * ~7269), so the surface a day inherits is the dashboard far more often than
 * not. Every one of those days answered the deadline funnel __gotoDeadline
 * (~7159) with "...during the selected-day settle" and NO diag. Days whose
 * goto began on Calendar > View Calendar navigated in seconds.
 *
 * THE CAUSE, CITED. athenaOne's dashboard paints a `.calendar-nav` week strip.
 * mlsAthenaGotoDate takes that strip as its strategy 0 (background.js ~4867-
 * 4977; the v1.66 comment there says in as many words that the strip is the
 * ONLY date nav on the v26.3 dashboard), so it answers found:true / via:
 * 'weekstrip' at ~4977. The handler's `found` at ~7195 is therefore truthy,
 * and the `if (!found)` ladder at ~7228 is skipped. That ladder is the ONLY
 * place the shipped Calendar > View Calendar restore ever runs
 * (mlsCalendarMenuFn, defined ~4254, invoked ~7278; calmenu-1.0.0, stamped
 * 3.0.101), and its own comment states the case exactly: the dashboard's
 * widget "cannot express a provider-scoped day switch". So the handler spent
 * the whole selected-day settle budget (~7292-7359) re-clicking a widget that
 * cannot do the job, and died at its deadline.
 *
 * THE SIGNAL, AND WHY IT CANNOT MISFIRE. chrome.scripting hands the handler
 * frameId and documentId, never a URL, so the handler cannot tell which
 * surface answered from the result alone. The cheapest exact signal is
 * therefore stamped by the frame that DID answer, out of the value it already
 * has for free: its own `location.pathname`. `/\/ax\/dashboard(?:\/|$)/` is
 * the athenaOne dashboard route and nothing else (`/{ctx}/{n}/ax/dashboard`;
 * the same route this file already fetches at ~7104 and ~17772 as "the
 * dashboard"). It is a whole-segment match, so it cannot catch a sibling
 * route, and no classic calendar / schedule frame is served from it - those
 * are .esp frames. The stamp is a CLOSED CODE ('dashboard' or ''), never the
 * path, so nothing tenant-identifying enters a receipt. A frame that cannot
 * read its own pathname stamps '' and behaves exactly as it does today.
 *
 * THE CURE. When the found control says it lives on the dashboard, the handler
 * takes the SAME restore the ladder already owns - mlsCalendarMenuFn 'open',
 * the Calendar menu paint wait, mlsCalendarMenuFn 'pick', the View Calendar
 * settle, then one re-detect - EXACTLY ONCE, before the found/!found decision,
 * and then continues unchanged. Only an off-dashboard control replaces `found`
 * (and its frame replaces __gotoFoundFrame); if the restore does not produce
 * one, the original hit and every branch below it stay byte-for-byte what they
 * are today. Every deadline is reused, not redefined: the same __gotoExec /
 * __gotoWait funnels, the same __gotoDeadline stage strings that the ladder's
 * own calmenu leg already uses verbatim ('the Calendar menu', 'the Calendar
 * menu paint', 'the View Calendar entry', 'the View Calendar settle', 'date
 * navigation'), the same single picked tab (no new chrome.tabs query), the
 * same late-result discard. The leg refuses to start under 18 s of remaining
 * budget so it can never eat a request that had no room for it.
 *
 * NO GATE MOVES: read-only navigation only, nothing is written, no identity,
 * scope or equality check is touched, and no day that navigates today can take
 * this path at all (a control found off the dashboard stamps '').
 *
 * TWO edits, background.js only; content.js is not touched.
 *
 * LINE ENDINGS - READ THIS BEFORE COPYING THIS SCRIPT. background.js is NOT a
 * uniform CRLF file: measured 2026-09-02 it holds 6344 CRLF and 11435 bare-LF
 * line terminators (earlier splices inserted LF into a CRLF file). The
 * file-wide `NL = /\r\n/.test(s) ? CRLF : LF` used by splice-30108/30109 would
 * therefore inject CRLF into a region that is LF - BOTH of this splice's
 * anchors sit in LF regions, and the line immediately after anchor 2 is CRLF.
 * So each edit here detects the terminator of ITS OWN anchor line and joins
 * the inserted lines with that. Everything else keeps the proven shape:
 * latin1 in, exact single-line anchor, exact occurrence count (abort
 * otherwise), ASCII-only insert, latin1 out, print what it did.
 *
 * IDEMPOTENCE: refuses to run twice - aborts if the surfnav-1.0.0 marker is
 * already present.
 *
 * DO NOT RUN AS PART OF A RELEASE - the coordinator releases the extension.
 */
'use strict';
var fs = require('fs');

var LF = String.fromCharCode(10);
var CR = String.fromCharCode(13);

/* Split into lines that KEEP their own terminator, so a mixed-EOL file
   round-trips byte-for-byte through join(''). */
function splitKeepEol(s) {
  var out = [], start = 0, i;
  for (i = 0; i < s.length; i++) {
    if (s.charAt(i) === LF) { out.push(s.slice(start, i + 1)); start = i + 1; }
  }
  if (start < s.length) out.push(s.slice(start));
  return out;
}
function bodyOf(line) {
  var b = line;
  if (b.charAt(b.length - 1) === LF) b = b.slice(0, -1);
  if (b.charAt(b.length - 1) === CR) b = b.slice(0, -1);
  return b;
}
function eolOf(line) {
  if (line.charAt(line.length - 1) !== LF) return '';
  return (line.charAt(line.length - 2) === CR) ? (CR + LF) : LF;
}

function splice(file, marker, edits) {
  var s = fs.readFileSync(file, 'latin1');
  if (s.indexOf(marker) >= 0) {
    console.error('ABORT ' + file + ': marker ' + marker + ' is already present - this splice has already run');
    process.exit(1);
  }
  var lines = splitKeepEol(s);
  edits.forEach(function (e, i) {
    var joined = e.lines.join(LF);
    if (/[^\x00-\x7f]/.test(joined)) { console.error('ABORT ' + file + ' edit ' + i + ': non-ASCII insert'); process.exit(1); }
    if (/[\r\n]/.test(e.find)) { console.error('ABORT ' + file + ' edit ' + i + ': anchor is not a single line'); process.exit(1); }
    var at = -1, n = 0, j;
    for (j = 0; j < lines.length; j++) { if (bodyOf(lines[j]) === e.find) { n++; at = j; } }
    if (n !== e.n) { console.error('ABORT ' + file + ' edit ' + i + ': hits=' + n + ' expected ' + e.n + ' for: ' + e.find.slice(0, 90)); process.exit(1); }
    var eol = eolOf(lines[at]) || LF;
    var block = e.lines.map(function (t) { return t + eol; }).join('');
    if (e.where === 'before') lines[at] = block + lines[at];
    else lines[at] = lines[at] + block;
    console.log('  edit ' + i + ': ' + e.where + ' line ' + (at + 1) + ' (' + (eol === LF ? 'LF' : 'CRLF') + '), +' + e.lines.length + ' lines');
  });
  fs.writeFileSync(file, lines.join(''), 'latin1');
  console.log('OK ' + file + ' (' + edits.length + ' edits)');
}

var EDITS = [
  /* 1. the frame that finds a date control stamps WHICH SURFACE it found it on.
        Placed immediately AFTER mlsAthenaGotoDate's own deadline guard, not at
        the top of the function: reading location IS touching the renderer, and
        an expired injection is required to touch nothing at all
        (tests/day-schedule-absolute-deadline-runtime.test.js runs this driver
        against a Proxy that counts every renderer property read and asserts
        zero). Below the guard it still runs before every strategy, so every
        strategy and every non-deadline return path carries the stamp -
        including the weekstrip return at ~4977 this defect rides on. A
        deadline-stopped result simply has no surface field, which reads false
        at the caller exactly as an off-dashboard control does. */
  {
    n: 1,
    where: 'after',
    find: "    if (!actionAllowed()) return deadlineStop();",
    lines: [
      "    /* surfnav-1.0.0 (3.0.110, measured live 2026-09-02): WHICH athenaOne surface",
      "       this control was found on. The dashboard paints a .calendar-nav week strip",
      "       that strategy 0 below accepts as a date control (see the v1.66 comment), so",
      "       a goto that begins on the dashboard answers found:true and its caller never",
      "       runs the Calendar > View Calendar restore that is the only thing that can",
      "       express a provider-scoped day switch. The caller cannot tell the surfaces",
      "       apart from the result - chrome.scripting gives it a frameId, never a URL -",
      "       so this frame stamps its own path here, as a CLOSED CODE and never as the",
      "       path itself. '' for every other surface, classic calendar frames included.",
      "       This is the first renderer read the driver makes, and it is deliberately",
      "       BELOW the deadline guard above: an expired injection touches nothing. */",
      "    try { out.surface = /\\/ax\\/dashboard(?:\\/|$)/.test(String(location.pathname || '')) ? 'dashboard' : ''; } catch (eSurfNav) { out.surface = ''; }"
    ]
  },
  /* 2. a dashboard-surface control takes the restore ladder's OWN Calendar >
        View Calendar leg once, then the existing found/!found decision runs
        unchanged. */
  {
    n: 1,
    where: 'before',
    find: "if (!found) {",
    lines: [
      "        /* ===== surfnav-1.0.0 (3.0.110) =====================================",
      "           A date control found on athenaOne's DASHBOARD is not the calendar's",
      "           date control. Measured 2026-09-02 05:5x-06:1x on the owner's practice",
      "           (3.0.107 loaded, site rebuilt three times): nine month-pull days died",
      "           at this request's deadline during the selected-day settle with no",
      "           diag, and every one of them was a day whose goto BEGAN on the",
      "           dashboard - which is the common case, because the schedule leg and",
      "           this ladder both navigate Home after the per-chart reads. The",
      "           dashboard's .calendar-nav week strip is accepted as strategy 0 by",
      "           mlsAthenaGotoDate (v1.66), so 'found' is truthy and the !found ladder",
      "           below - the ONLY place the shipped Calendar > View Calendar restore",
      "           runs - is skipped; the settle budget is then spent re-clicking a",
      "           widget that, per calmenu-1.0.0, cannot express a provider-scoped day",
      "           switch. Days whose goto began on Calendar > View Calendar landed in",
      "           seconds. So: take that same restore ONCE, here, before the found /",
      "           !found decision, and only for a control whose own frame said it is",
      "           the dashboard. Same __gotoExec / __gotoWait funnels, same deadline",
      "           stage names the ladder's calmenu leg already uses, same single picked",
      "           tab (no new tab query), same late-result discard. Only an",
      "           off-dashboard control replaces 'found'; if the restore does not",
      "           produce one, the original hit and every branch below stay exactly as",
      "           they are today. The leg will not start under 18s of remaining budget,",
      "           and it can never run twice in one request. */",
      "        if (found && found.surface === 'dashboard' && !GDIAG.surfaceRestored) {",
      "          GDIAG.surface = 'dashboard';",
      "          if (__gotoLeft() < 18000) { GDIAG.surfaceSkipped = 'budget'; }",
      "          else {",
      "            GDIAG.surfaceRestored = true; /* set BEFORE the attempt: one restore per request, even if it throws */",
      "            try {",
      "              const smo = await __gotoExec({ target: { tabId: tab.id, allFrames: true }, args: ['open'], func: mlsCalendarMenuFn }, Math.min(6000, __gotoLeft()), 'the Calendar menu');",
      "              GDIAG.surfaceMenu = ((smo && smo.r) || []).map((r) => r && r.result).filter(Boolean).some((h) => h && h.calendar);",
      "              if (GDIAG.surfaceMenu) {",
      "                if (!(await __gotoWait(900, 'the Calendar menu paint'))) { __gotoDeadline('the Calendar menu paint'); return; }",
      "                const smp = await __gotoExec({ target: { tabId: tab.id, allFrames: true }, args: ['pick'], func: mlsCalendarMenuFn }, Math.min(6000, __gotoLeft()), 'the View Calendar entry');",
      "                GDIAG.surfacePick = ((smp && smp.r) || []).map((r) => r && r.result).filter(Boolean).some((h) => h && h.viewCalendar);",
      "                if (GDIAG.surfacePick) {",
      "                  if (!(await __gotoWait(6500, 'the View Calendar settle'))) { __gotoDeadline('the View Calendar settle'); return; }",
      "                  const sgx = await __gotoExec({ target: { tabId: tab.id, allFrames: true }, args: [date, false, __gotoGuard], func: mlsAthenaGotoDate }, Math.min(16000, __gotoLeft()), 'date navigation');",
      "                  const sfr = ((sgx && sgx.r) || []).find((r) => r && r.result && r.result.found && r.result.surface !== 'dashboard');",
      "                  if (sfr) { found = sfr.result; __gotoFoundFrame = (sfr.frameId != null ? sfr.frameId : null); }",
      "                  GDIAG.surfaceFound = !!sfr;",
      "                }",
      "              }",
      "            } catch (eSurfNav) { GDIAG.surfaceErr = String((eSurfNav && eSurfNav.message) || eSurfNav).slice(0, 60); }",
      "          }",
      "        }"
    ]
  }
];

/* Running this file splices. REQUIRING it only hands over the declared edits,
   so tests/surfnav-splice-proof.js can rebuild the pre-splice file from a
   background.js that already carries this change and prove the shipped bytes
   are exactly what this script produces. Nothing is written on require. */
if (require.main === module) {
  splice('background.js', 'surfnav-1.0.0', EDITS);
  console.log('SPLICE 3.0.110 surfnav-1.0.0 DONE');
} else {
  module.exports = { MARKER: 'surfnav-1.0.0', TARGET: 'background.js', EDITS: EDITS, splitKeepEol: splitKeepEol, bodyOf: bodyOf, eolOf: eolOf };
}
