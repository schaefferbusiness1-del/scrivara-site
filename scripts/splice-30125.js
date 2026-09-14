'use strict';
/* MLS Assist 3.0.125 - byte-preserving bounded repairs (Fable, 2026-09-14).
 * Reads every file as latin1, edits only at unique seams, verifies the inverse
 * restores every original byte, and preserves the mixed CRLF/LF endings.
 * Run once from the extension worktree root: node scripts/splice-30125.js
 */
const fs = require('fs'), path = require('path'), assert = require('assert');
const root = path.join(__dirname, '..');
const ONLY = process.argv.slice(2); /* optional file filter: node scripts/splice-30125.js content.js */
function wanted(f) { return !ONLY.length || ONLY.indexOf(f) >= 0; }

function editFile(file, plan) {
  const target = path.join(root, file), before = fs.readFileSync(target, 'latin1');
  let out = before; const edits = [];
  function count(s, needle) { return s.split(needle).length - 1; }
  function mark(a, b, s) { if (b !== '') return edits.push([a, b]); const pre = out.slice(Math.max(0, s - 80), s), post = out.slice(s, s + 80); assert(count(out, pre + post) === 1, 'deletion context unique'); edits.push([a, b, 'del', pre, post]); }
  function rep(a, b, label) { assert(count(out, a) === 1, (label || '') + ' unique seam: ' + a.slice(0, 90)); const s = out.indexOf(a); out = out.replace(a, () => b); mark(a, b, s); }
  function repAll(a, b, expect, label) { assert(count(out, a) === expect, (label || '') + ' expected ' + expect + ' seams: ' + a.slice(0, 90)); assert(count(out, b) === 0, (label || '') + ' replacement absent before'); out = out.split(a).join(b); edits.push([a, b, 'all']); }
  function span(a, b, value, label) {
    assert(count(out, a) === 1, (label || '') + ' unique start: ' + a.slice(0, 90));
    const s = out.indexOf(a), e = out.indexOf(b, s + a.length);
    assert(e > s, (label || '') + ' end after start: ' + b.slice(0, 90));
    const orig = out.slice(s, e);
    assert(count(out, orig) === 1, (label || '') + ' unique span');
    out = out.slice(0, s) + value + out.slice(e); mark(orig, value, s);
  }
  function eolAt(anchor) { const i = out.indexOf(anchor); const nl = out.indexOf('\n', i); return (nl > 0 && out[nl - 1] === '\r') ? '\r\n' : '\n'; }
  plan({ rep, repAll, span, eolAt, count: (n) => count(out, n), get: () => out });
  /* inverse proof: applying the edits backwards must restore every byte */
  let restored = out;
  for (const [a, b, mode, pre, post] of edits.slice().reverse()) {
    if (mode === 'all') { assert(count(restored, b) >= 1 && count(restored, a) === 0, 'inverse all: ' + b.slice(0, 80)); restored = restored.split(b).join(a); continue; }
    if (mode === 'del') { assert(count(restored, pre + post) === 1, 'inverse del context unique'); restored = restored.replace(pre + post, () => pre + a + post); continue; }
    assert(count(restored, b) === 1, 'inverse unique: ' + b.slice(0, 80));
    restored = restored.replace(b, () => a);
  }
  assert.strictEqual(restored, before, file + ': inverse restores original');
  fs.writeFileSync(target, Buffer.from(out, 'latin1'));
  console.log(file + ': ' + edits.length + ' verified seams, ' + (out.length - before.length) + ' bytes delta');
}

/* ------------------------------------------------------------------ background.js */
if (wanted('background.js')) editFile('background.js', ({ rep, repAll, span, eolAt, count, get }) => {
  /* R1 + R2: exact-pair identity is the ONLY gate on an ordinary chart read */
  const N = eolAt("          const globalNameMatches = !!(want && ident && ident.name && strictNameMatch(ident.name, want));");
  rep("          const globalNameMatches = !!(want && ident && ident.name && strictNameMatch(ident.name, want));" + N +
      "          const globalStrongMismatch = !!(globalNameMatches && wantDob && (!ident.dob || !sameDobStrict(ident.dob, wantDob)));" + N,
      "          /* exactread-1.0.0 (3.0.125): the ONLY identity gate on an ordinary chart" + N +
      "             read is the canonical exact first+last+DOB resolver. A request with no" + N +
      "             usable DOB refuses (identity-hint-incomplete) instead of accepting a" + N +
      "             name-only banner; an ambiguous banner refuses; the MRN is reported and" + N +
      "             never vetoes an exact pair (owner ruling). */" + N +
      "          const exactGlobalPair = want ? mlsExactIdentityPair({name:want,dob:wantDob,mrn:wantMrn}, ident || {}) : { ok: false, reason: 'no-target' };" + N +
      "          const globalNameMatches = !!(want && ident && ident.name && strictNameMatch(ident.name, want));" + N +
      "          const globalStrongMismatch = !!(want && ident && ident.name && !exactGlobalPair.ok);" + N +
      "          if (want && exactGlobalPair.reason === 'identity-hint-incomplete') {" + N +
      "            await restoreFocus();" + N +
      "            return chartRespond({ ok: false, reason: 'identity-hint-incomplete', attempted: false, captured: false, opened: opened, version: versionStrict, chartName: (ident && ident.name) || '', chartDob: (ident && ident.dob) || '', error: 'MLS has no usable date of birth (or full first and last name) for ' + want + ', so it cannot prove which athenaOne chart is theirs. Add the date of birth in MLS, then pull again. Nothing was captured.' });" + N +
      "          }" + N +
      "          if (want && exactGlobalPair.reason === 'identity-ambiguous') {" + N +
      "            await restoreFocus();" + N +
      "            return chartRespond({ ok: false, reason: 'ambiguous', attempted: false, captured: false, opened: opened, version: versionStrict, chartName: (ident && ident.name) || '', chartDob: (ident && ident.dob) || '', error: 'athenaOne showed more than one patient banner for ' + want + ' and MLS did not guess. Open the right chart in athenaOne, then pull again. Nothing was captured.' });" + N +
      "          }" + N, 'R2');
  rep("          if (want && !opened && !(ident && ident.name)) {" + N + "            await restoreFocus();" + N + "            return chartRespond({ ok: false, reason: 'unverified', opened: false,",
      "          if (want && !(ident && ident.name)) {" + N + "            await restoreFocus();" + N + "            return chartRespond({ ok: false, reason: 'unverified', opened: opened,", 'R2 unverified');
  rep("          return chartRespond({ ok: true, text: chartTextStrict, receipt: chartReceiptStrict,",
      "          /* exactread-1.0.0 (3.0.125): a read that captured no chart text is a" + N +
      "             refusal with a sentence, never ok:true with an empty text field." + N +
      "             (\"Pulled successfully\" with nothing captured was the owner's" + N +
      "             \"the pull cheats\" report.) */" + N +
      "          if (!chosenStrict.length || !String(chartTextStrict || '').trim()) {" + N +
      "            return chartRespond({ ok: false, reason: 'chart-frames-unbound', attempted: false, captured: false, opened: opened, version: versionStrict, receipt: chartReceiptStrict, briefingDiag: briefingDiag, identityFill: __mlsIdentityFill, chartName: (ident && ident.name) || '', chartDob: (ident && ident.dob) || '', error: 'The chart' + (want ? ' for ' + want : '') + ' opened' + (want ? ' and the patient matched' : '') + ', but no chart section could be tied to this patient, so nothing was captured. Open the chart once in athenaOne and let it finish loading, then pull again.' });" + N +
      "          }" + N +
      "          return chartRespond({ ok: true, text: chartTextStrict, receipt: chartReceiptStrict,", 'R1');

  /* R3: an empty day needs a readable schedule date before it is authoritative */
  rep("        var __authoritativeEmpty = (__parsedCount === 0 && (__surface.probes || []).some(function (p) { return p && p.verified && p.empty; }) && __dd.emptyStable === true) || __allSlotDay;",
      "        var __authoritativeEmpty = (__parsedCount === 0 && !!((pick && pick.s && pick.s.schedDate) || '') && (__surface.probes || []).some(function (p) { return p && p.verified && p.empty; }) && __dd.emptyStable === true) || __allSlotDay; /* dayauthority-1.0.0 (3.0.125): no readable date, no proven-empty day */", 'R3');
  rep("          var __incompleteCause = !__coverageComplete ? 'coverage-unverified' : (__expectedCount === 0 ? 'no-readable-rows' : (",
      "          var __incompleteCause = !__coverageComplete ? 'coverage-unverified' : (__parsedCount === 0 && !((pick && pick.s && pick.s.schedDate) || '') ? 'schedule-date-unreadable' : (__expectedCount === 0 ? 'no-readable-rows' : (", 'R3 cause');
  rep("          var __incompleteError = __incompleteCause === 'coverage-unverified' ?",
      "          var __incompleteError = __incompleteCause === 'schedule-date-unreadable' ? 'athenaOne did not show a readable date for this day, so MLS cannot prove the day is empty. Open the Day view in athenaOne and let it finish loading, then pull again.' : __incompleteCause === 'coverage-unverified' ?", 'R3 error');
  /* balance the extra "(" opened in the cause chain: it closes on the same statement's final ")" run */
  {
    const src = get();
    const i = src.indexOf("? 'schedule-date-unreadable' : (__expectedCount === 0 ? 'no-readable-rows' : (");
    const lineEnd = src.indexOf('\n', i);
    const line = src.slice(i, lineEnd);
    const close = line.lastIndexOf(';');
    assert(close > 0, 'R3 cause line ends with ;');
    const fixed = line.slice(0, close) + ')' + line.slice(close);
    rep(line, fixed, 'R3 paren');
  }

  /* R4: an optional expected day makes a schedule read refuse a different day */
  {
    const N4 = eolAt("        __schedRespond({ ok: true, scheduleVerified: true, receipt: __receipt,");
    rep("        __schedRespond({ ok: true, scheduleVerified: true, receipt: __receipt,",
        "        var __expectedDay = /^\\d{4}-\\d{2}-\\d{2}$/.test(String(msg.expectedDate || '')) ? String(msg.expectedDate) : ''; /* dayauthority-1.0.0 (3.0.125): optional caller-declared day */" + N4 +
        "        if (__expectedDay && String((pick && pick.s && pick.s.schedDate) || '') !== __expectedDay) {" + N4 +
        "          return __schedRespond({ ok: false, reason: 'schedule-day-mismatch', scheduleVerified: true, receipt: __receipt, expectedDate: __expectedDay, schedDate: String((pick && pick.s && pick.s.schedDate) || ''), error: 'athenaOne is showing ' + (String((pick && pick.s && pick.s.schedDate) || '') || 'an unreadable day') + ', not ' + __expectedDay + '. MLS did not import that schedule. Nothing was changed.' });" + N4 +
        "        }" + N4 +
        "        __schedRespond({ ok: true, scheduleVerified: true, receipt: __receipt,", 'R4');
  }

  /* R5: the history progress line says how many bodies are actually held */
  span("emit(appTabId, frozenRequestId, 'Read full encounter ' + (i + 1) + ' of ' + total + '", "', i + 1, total);",
       "emit(appTabId, frozenRequestId, 'Encounter ' + (i + 1) + ' of ' + total + ' checked; ' + visits.length + ' full note' + (visits.length === 1 ? '' : 's') + ' read so far.", 'R5');

  /* R6: the name-scan opener refuses a surname-only request and a top-score tie */
  {
    const N6 = eolAt("          var best = null, bestSc = (lname && fname) ? 6 : 3;");
    rep("          var best = null, bestSc = (lname && fname) ? 6 : 3;" + N6 +
        "          for (var i = 0; i < nodes.length; i++) { var tx = rowText(nodes[i]).toLowerCase(); var sc = scoreRow(tx, nodes[i]); if (sc > bestSc) { bestSc = sc; best = nodes[i]; } }" + N6 +
        "          return { el: best, sc: bestSc, scanned: nodes.length };",
        "          /* exactopen-1.0.0 (3.0.125): a surname-only request never clicks a" + N6 +
        "             row, and a tie at the top score between two different rows is" + N6 +
        "             ambiguity, not a pick. */" + N6 +
        "          if (!fname) return { el: null, sc: 0, scanned: nodes.length, reason: 'first-name-required' };" + N6 +
        "          var best = null, bestSc = 6, ties = 0;" + N6 +
        "          for (var i = 0; i < nodes.length; i++) { var tx = rowText(nodes[i]).toLowerCase(); var sc = scoreRow(tx, nodes[i]); if (sc > bestSc) { bestSc = sc; best = nodes[i]; ties = 1; } else if (best && sc === bestSc) { try { if (!best.contains(nodes[i]) && !nodes[i].contains(best)) ties++; } catch (eTie) { ties++; } } }" + N6 +
        "          if (ties > 1) return { el: null, sc: bestSc, scanned: nodes.length, ambiguous: true, nameAmbiguous: true, matches: ties };" + N6 +
        "          return { el: best, sc: bestSc, scanned: nodes.length };", 'R6');
    rep("        if (hit.ambiguous) return { phase: 'open', opened: false, candidates: hit.matches || 2, reason: 'appointment-id-ambiguous',",
        "        if (hit.ambiguous) return { phase: 'open', opened: false, candidates: hit.matches || 2, reason: hit.nameAmbiguous ? 'ambiguous' : 'appointment-id-ambiguous',", 'R6 reason');
  }

  /* R7: no write executes while a chart read is in flight */
  rep("    try { self.__mlsChartReadBusyUntil = Math.max(Number(self.__mlsChartReadBusyUntil || 0), chartDeadlineAt); } catch (eBzC) {}",
      "    try { self.__mlsChartReadBusyUntil = Math.max(Number(self.__mlsChartReadBusyUntil || 0), chartDeadlineAt); } catch (eBzC) {} try { self.__mlsReadInFlight = (Number(self.__mlsReadInFlight) || 0) + 1; } catch (eRif) {} /* readlock-1.0.0 */", 'R7 chart+');
  {
    const N7 = eolAt("      chartResponseSent = true;");
    rep("      chartResponseSent = true;" + N7 + "      if (chartDeadlineTimer != null)",
        "      chartResponseSent = true;" + N7 + "      try { self.__mlsReadInFlight = Math.max(0, (Number(self.__mlsReadInFlight) || 0) - 1); } catch (eRif2) {} /* readlock-1.0.0 */" + N7 + "      if (chartDeadlineTimer != null)", 'R7 chart-');
  }
  rep("          try { self.__mlsChartReadBusyUntil = Math.max(Number(self.__mlsChartReadBusyUntil || 0), Number(msg.deadlineAt || (Date.now() + 195000))); } catch (eBzV) {} /* qol-2.3 */",
      "          try { self.__mlsChartReadBusyUntil = Math.max(Number(self.__mlsChartReadBusyUntil || 0), Number(msg.deadlineAt || (Date.now() + 195000))); } catch (eBzV) {} /* qol-2.3 */ try { self.__mlsReadInFlight = (Number(self.__mlsReadInFlight) || 0) + 1; } catch (eRif3) {} /* readlock-1.0.0 */", 'R7 visits+');
  {
    const N7b = eolAt("            if (__wdogFinished) return; __wdogFinished = true;");
    rep("            if (__wdogFinished) return; __wdogFinished = true;" + N7b,
        "            if (__wdogFinished) return; __wdogFinished = true;" + N7b + "            try { self.__mlsReadInFlight = Math.max(0, (Number(self.__mlsReadInFlight) || 0) - 1); } catch (eRif4) {} /* readlock-1.0.0 */" + N7b, 'R7 visits-');
  }
  {
    const N7c = eolAt("        actionToken = clean(msg.actionToken);");
    rep("        actionToken = clean(msg.actionToken);" + N7c,
        "        actionToken = clean(msg.actionToken);" + N7c +
        "        /* readlock-1.0.0 (3.0.125): the pull completes before any write starts. */" + N7c +
        "        if ((Number(self.__mlsReadInFlight) || 0) > 0) return { ok: false, blocked: true, reason: 'read-in-progress', error: 'MLS is still reading a chart in athenaOne. Let the pull finish, then press Confirm again. Nothing was changed.' };" + N7c, 'R7 gate');
  }

  /* R8: the patient opener gets the same wall-clock terminal timer every other pull handler has */
  {
    const N8 = eolAt("        var findGuard = Object.freeze({ value: frozenMrn, deadline: openGuard.deadline, token: openGuard.token });");
    rep("        var findGuard = Object.freeze({ value: frozenMrn, deadline: openGuard.deadline, token: openGuard.token });" + N8,
        "        var findGuard = Object.freeze({ value: frozenMrn, deadline: openGuard.deadline, token: openGuard.token });" + N8 +
        "        /* openterminal-1.0.0 (3.0.125): one terminal answer per open request, even if an await never settles. */" + N8 +
        "        try { setTimeout(function () { if (!responseSent) sendResponse({ ok: false, opened: false, reason: 'open-deadline-exceeded', requestToken: openGuard.token, error: 'The Athena patient open reached its one absolute deadline. No retry or fallback was attempted.' }); }, Math.max(0, openGuard.deadline - Date.now()) + 250); } catch (eOpenTimer) {}" + N8, 'R8');
  }

  /* S5: the alias record never existed in behaviour; delete the comment that says it does */
  {
    const NS5 = eolAt("    __mlsWalkAliasRec = null; /* wa-3072: fresh walk, fresh alias */");
    span("  /* wa-3072: one walk-scoped alias record, reset when the AllVisits mutex is", "  function visitIdentityGate(frozen, live) {", "", 'S5 decl');
    rep("    __mlsWalkAliasRec = null; /* wa-3072: fresh walk, fresh alias */" + NS5, "", 'S5 reset');
    assert(count('__mlsWalkAliasRec') === 0, 'S5 no alias residue');
  }

  /* F4: the sign half of mlsAthenaSignSave is gone; the driver is probe-only */
  {
    const NF4 = eolAt("  // ----- SIGN (clicks; user-initiated; never invoked autonomously) -----");
    span("  // ----- SIGN (clicks; user-initiated; never invoked autonomously) -----", "/* ===== v1.38: MLS Seamless Pop-up overlay router (appended) ===== */",
         "  /* draftonly-1.1.0 (3.0.125): the sign half of this driver was deleted." + NF4 +
         "     This function is probe-only. The only executable actions in MLS Assist" + NF4 +
         "     are write_note and save_draft; Sign stays the doctor's own click. */" + NF4 +
         "  return { ok: false, blocked: true, signed: false, reason: 'sign-route-disabled', msg: 'MLS Assist never signs. Sign the encounter in athenaOne yourself.', observed: observed };" + NF4 +
         "}" + NF4 + NF4, 'F4 body');
    rep("      var mode = (opts.probe ? 'probe' : 'sign');", "      var mode = 'probe'; /* draftonly-1.1.0 (3.0.125): probe-only; the sign half no longer exists */", 'F4 wrapper');
  }

  /* SIGN_ENCOUNTER: keep the marker and a refusal, delete the working sign-and-confirm clicker */
  {
    const src = get();
    const a = "      var signStatusEvidenceSnapshot = statusEvidenceSnapshot([noteScope]);";
    assert(count(a) === 1, 'sign block unique');
    const ai = src.indexOf(a);
    const start = src.lastIndexOf("    if (action === 'sign_encounter') {", ai);
    assert(start > 0 && ai - start < 80, 'sign block head');
    const NSE = eolAt(a);
    span(src.slice(start, ai + a.length), "    /* SIGN_ENCOUNTER_END */",
         "    if (action === 'sign_encounter') return { ok: false, blocked: true, action: action, attempted: false, verified: false, signed: false, reason: 'final-action-blocked', error: 'MLS Assist never signs an encounter. Sign it in athenaOne yourself.' }; /* draftonly-1.1.0 (3.0.125): the sign-and-confirm clicker was deleted */" + NSE, 'SIGN_ENCOUNTER');
  }

  /* F5: the stale wsg-2.0.0 comment claimed sign/order/billing execute; they do not */
  {
    const NF5 = eolAt("    /* wsg-2.0.0 (owner directive 2026-08-12, released 2026-08-17): the policy");
    span("    /* wsg-2.0.0 (owner directive 2026-08-12, released 2026-08-17): the policy", "    /* MLS_WRITE_SAFETY_DRIVER_GUARD_END */",
         "    /* draftonly-1.1.0 (3.0.125): the action map above is CLOSED to write_note" + NF5 +
         "       and save_draft. sign_encounter, stage_billing and place_order are refused" + NF5 +
         "       here, in the worker (mlsAppAthenaActionV2Request), in write_safety_guard.js" + NF5 +
         "       and in content.js; no branch below can reach a Sign, order or billing" + NF5 +
         "       control, and clickOnce refuses every final or irrevocable control without" + NF5 +
         "       exception. The wsg-2.0.0 note that once claimed otherwise was wrong. */" + NF5, 'F5');
  }

  /* F14: the v2.05 unified write driver and its dead orchestration are gone */
  {
    const src = get();
    const hdr = " * MLS Assist v2.05 - UNIFIED WRITE DRIVER (mlsUnifiedWriteDriverFn) +";
    assert(count(hdr) === 1, 'F14 header unique');
    const hi = src.indexOf(hdr);
    const start = src.lastIndexOf("/* =====", hi);
    assert(start > 0 && hi - start < 120, 'F14 header start');
    const NF14 = eolAt(hdr);
    span(src.slice(start, hi + hdr.length), "/* v2.05 handler: single-flight, verified tab pick, freeze-guard, foreground-",
         "/* draftonly-1.1.0 (3.0.125): the v2.05 unified write driver" + NF14 +
         "   (mlsUnifiedWriteDriverFn) was deleted. It carried a token-overlap name" + NF14 +
         "   comparator and a name-only acceptance when no DOB was supplied, behind a" + NF14 +
         "   refusal that had already closed its only caller. The supervised ActionV2" + NF14 +
         "   driver is the only writer. */" + NF14 + NF14, 'F14 driver');
    const tail = "      } finally { if (usedWriteTarget) { try { self.__mlsWriteTarget = null; } catch (eClear) {} } busy = 0; }";
    assert(count(tail) === 1, 'F14 tail unique');
    const NT = eolAt(tail);
    span("      var trustedSender = false;", tail, "", 'F14 orchestration');
    rep(tail + NT, "", 'F14 tail');
    assert(count('mlsUnifiedWriteDriverFn') === 1, 'F14 only the comment names the deleted driver');
  }

  /* F8: forbidden-control lists cover check-in/out, discharge, void, and the underscore forms */
  rep("'closeencounter','close-encounter','mls-forbidden'];",
      "'closeencounter','close-encounter','close_encounter','file_claim','checkin','check-in','check_in','checkout','check-out','check_out','discharge','deleteencounter','delete-encounter','delete_encounter','voidencounter','void-encounter','void_encounter','mls-forbidden'];", 'F8 attrs');
  rep("/\\bclose\\s+encounter\\b/, /\\bdelete\\s+(?:chart|patient|encounter)\\b/];",
      "/\\bclose\\s+encounter\\b/, /\\bdelete\\s+(?:chart|patient|encounter)\\b/, /\\bcheck\\s*-?\\s*(?:in|out)\\b/, /\\bdischarge\\b/, /\\bvoid\\b/];", 'F8 labels');

  /* F9: the generic executor's final-action regex covers check-in, close encounter, discharge, unlock, reopen (both copies) */
  {
    const a = "|file\\s+(?:the\\s+)?claim|check\\s*-?\\s*out|delete|remove|void)\\b/i";
    const b = "|file\\s+(?:the\\s+)?claim|check\\s*-?\\s*(?:in|out)|close\\s+encounter|discharge|unlock|reopen|delete|remove|void)\\b/i";
    repAll(a, b, 2, 'F9 both copies');
  }

  /* F13: a persisted token with a forbidden verb never hydrates */
  rep("if (!/^(write_note|stage_billing|save_draft|sign_encounter|place_order)$/.test(clean(rec.action))) return false;",
      "if (!/^(write_note|save_draft)$/.test(clean(rec.action))) return false; /* draftonly-1.1.0 (3.0.125) */", 'F13');

  /* F2/F3: the app's expected MRN is compared to the live-locked MRN and REPORTED, never a veto */
  rep("      if (rec.expectedMrn && rec.expectedMrn !== digits(rec.locked && rec.locked.mrn)) return {ok:false,blocked:true,reason:'patient-mismatch'}; /* captured live probe lock */",
      "      var __mrnConflictAtExecute = !!(digits(p && p.mrn) && digits(rec.locked && rec.locked.mrn) && digits(p.mrn) !== digits(rec.locked && rec.locked.mrn)); /* mrnreport-1.0.0 (3.0.125): the app's expected MRN versus the live-locked MRN is reported on the receipt; exact name+DOB is the identity and MRN never vetoes it (owner ruling) */", 'F3');
  rep("      executed.patientId = clean(p.patientId);",
      "      executed.patientId = clean(p.patientId);" + eolAt("      executed.patientId = clean(p.patientId);") + "      executed.mrnConflict = __mrnConflictAtExecute; executed.gestureClass = clean(msg.gestureClass) || 'trusted-click'; /* mrnreport-1.0.0 + gestureclass-1.0.0 (3.0.125) */", 'F2 receipt');
  rep("        return { ok: true, mode: 'probe', action: action, readOnly: true, actionToken: tok, expiresAt: tokenExpiresAt, previewHash: previewHash,",
      "        return { ok: true, mode: 'probe', action: action, readOnly: true, mrnConflict: !!(digits(p && p.mrn) && digits(probe.context && probe.context.mrn) && digits(p.mrn) !== digits(probe.context.mrn)), actionToken: tok, expiresAt: tokenExpiresAt, previewHash: previewHash,", 'F2 probe');

  /* S1: exactly one terminal response per supervised action, even if sendResponse throws */
  {
    const NS1 = eolAt("    if (!msg || msg.type !== 'mlsAppAthenaActionV2Request') return;");
    rep("    if (!msg || msg.type !== 'mlsAppAthenaActionV2Request') return;" + NS1,
        "    if (!msg || msg.type !== 'mlsAppAthenaActionV2Request') return;" + NS1 +
        "    var __v2Responded = false; function __v2Respond(r) { if (__v2Responded) return; __v2Responded = true; try { sendResponse(r); } catch (eV2R) {} } /* oneterminal-1.0.0 (3.0.125) */" + NS1, 'S1 decl');
    rep("    })().then(function (r) { sendResponse(r); }).catch(function (e) { sendResponse({ ok: false, reason: 'outcome-uncertain', error: String((e && e.message) || e), noAutomaticChaining: 'no-automatic-chaining' }); });",
        "    })().then(function (r) { __v2Respond(r); }, function (e) { __v2Respond({ ok: false, reason: 'outcome-uncertain', error: String((e && e.message) || e), noAutomaticChaining: 'no-automatic-chaining' }); });", 'S1 funnel');
  }

  /* S3: a discarded/sleeping athena tab is never a write candidate */
  rep("    return (all || []).filter(function (t) { try { return mlsAthTabHost(t) === 'athenanet.athenahealth.com' && !mlsAthIsLoginish(t); } catch (e) { return false; } });",
      "    return (all || []).filter(function (t) { try { return mlsAthTabHost(t) === 'athenanet.athenahealth.com' && !mlsAthIsLoginish(t) && !(typeof mlsAthTabSleeping === 'function' && mlsAthTabSleeping(t)); } catch (e) { return false; } }); /* sleeptab-1.0.0 (3.0.125) */", 'S3');

  /* S2: the read-back leg opens a section tab; its sentences say so instead of "Nothing was pressed" */
  {
    const src = get();
    const s = src.indexOf("      function nativeReadError(reason, key) {"), e = src.indexOf("      async function nativeReadSection(key, expectedValue) {", s);
    assert(s > 0 && e > s, 'S2 region');
    const region = src.slice(s, e);
    const n = region.split('Nothing was pressed.').length - 1;
    assert(n >= 5, 'S2 sentences present: ' + n);
    rep(region, region.split('Nothing was pressed.').join('MLS only opened that section tab to read it; no Save or Sign was pressed.'), 'S2');
  }

  /* F7: say plainly that reconcile proofs are reusable within their TTL because the reconcile leg presses nothing */
  rep("      return { ok: true, proofIds: proofIds, frameTimeOrigin: origins[0] };",
      "      /* 3.0.125: these four proofs are intentionally NOT consumed by a" + eolAt("      return { ok: true, proofIds: proofIds, frameTimeOrigin: origins[0] };") +
      "         reconcile. The reconcile leg presses nothing (it reads the saved" + eolAt("      return { ok: true, proofIds: proofIds, frameTimeOrigin: origins[0] };") +
      "         sections back), so re-verifying within the TTL is safe; each" + eolAt("      return { ok: true, proofIds: proofIds, frameTimeOrigin: origins[0] };") +
      "         execute still needs a fresh one-use action token from a fresh probe. */" + eolAt("      return { ok: true, proofIds: proofIds, frameTimeOrigin: origins[0] };") +
      "      return { ok: true, proofIds: proofIds, frameTimeOrigin: origins[0] };", 'F7');
});

/* ------------------------------------------------------------------ write_safety_guard.js */
if (wanted('write_safety_guard.js')) editFile('write_safety_guard.js', ({ rep }) => {
  rep("    'closeencounter', 'close-encounter',\n    'mls-forbidden'",
      "    'closeencounter', 'close-encounter', 'close_encounter', 'file_claim',\n    'checkin', 'check-in', 'check_in', 'checkout', 'check-out', 'check_out', 'discharge',\n    'deleteencounter', 'delete-encounter', 'delete_encounter', 'voidencounter', 'void-encounter', 'void_encounter',\n    'mls-forbidden'", 'F8 wsg attrs');
  rep("    '\\\\bdelete\\\\s+(?:chart|patient|encounter)\\\\b'\n  ];",
      "    '\\\\bdelete\\\\s+(?:chart|patient|encounter)\\\\b',\n    '\\\\bcheck\\\\s*-?\\\\s*(?:in|out)\\\\b',\n    '\\\\bdischarge\\\\b',\n    '\\\\bvoid\\\\b'\n  ];", 'F8 wsg labels');
});

/* ------------------------------------------------------------------ content.js */
if (wanted('content.js')) editFile('content.js', ({ rep, repAll, span, count }) => {
  /* F10: dead label patterns for refused actions */
  span("    if (action === 'stage_billing') return", "    if (action === 'save_draft') return", "", 'F10 billing');
  span("    if (action === 'sign_encounter') return /\\bconfirm", "    if (action === 'place_order') return", "", 'F10 sign');
  rep("    if (action === 'place_order') return /\\bconfirm\\s*(?:&|and)?\\s*place\\s+(?:one\\s+)?(?:reviewed\\s+)?order\\b/i.test(label);\n", "", 'F10 order');
  /* F11: the dead sign-gesture mechanism */
  rep("  /* A trusted origin is necessary but not sufficient for Sign & Save. Arm one\n     short-lived, one-use authorization only from a real click on the clearly\n     labelled MLS sign button. Programmatic .click() events are not trusted. */\n  var _mlsSignGestureUntil = 0;\n",
      "  /* draftonly-1.1.0 (3.0.125): there is no Sign gesture. MLS Assist never signs;\n     mlsAppSignAndSave answers only a read-only probe. */\n", 'F11 decl');
  rep("          if (/\\bsign\\s*(?:&|and)\\s*save\\b/i.test(label)) _mlsSignGestureUntil = Date.now() + 180000;\n", "", 'F11 writer');
  span("      if (!readOnlySignProbe && Date.now() > _mlsSignGestureUntil) {", "      if (!readOnlySignProbe) _mlsSignGestureUntil = 0; /* one click authorizes one sign request */\n", "", 'F11 dead gate');
  rep("      if (!readOnlySignProbe) _mlsSignGestureUntil = 0; /* one click authorizes one sign request */\n", "", 'F11 dead consume');
  assert(count('_mlsSignGestureUntil') === 0, 'F11 no residue');
  /* F1: the remote arm cannot come from loopback, and every arm carries its class into the receipt */
  rep("    if (!mlsTrustedOrigin(event.origin)) return; /* ra-origin-1.0.0 (3.0.103): the same trusted-origin gate every other bridge verb passes */",
      "    if (!mlsTrustedOrigin(event.origin)) return; /* ra-origin-1.0.0 (3.0.103): the same trusted-origin gate every other bridge verb passes */\n    if (mlsLoopbackOrigin(event.origin)) return; /* ra-origin-1.1.0 (3.0.125): loopback is synthetic-only and can never arm a write */", 'F1 loopback');
  rep("      remote: {\n        relayJobId: relayJobId.slice(0, 80),",
      "      gestureClass: 'remote-relay', /* gestureclass-1.0.0 (3.0.125): the worker records which confirmation class authorized the write */\n      remote: {\n        relayJobId: relayJobId.slice(0, 80),", 'F1 class');
  rep("              clientOrderId: String(actionEl.getAttribute('data-mls-client-order-id') || '').slice(0, 160)\n            };",
      "              clientOrderId: String(actionEl.getAttribute('data-mls-client-order-id') || '').slice(0, 160),\n              gestureClass: 'trusted-click' /* gestureclass-1.0.0 (3.0.125) */\n            };", 'F1 click class');
  rep("      var gestureProof = '';\n      if (mutating) {", "      var gestureProof = '', gestureClass = '';\n      if (mutating) {", 'F1 var');
  rep("        gestureProof = armBatch ? (arm.serial + ':' + armBatch.idx) : arm.serial;",
      "        gestureProof = armBatch ? (arm.serial + ':' + armBatch.idx) : arm.serial; gestureClass = String(arm.gestureClass || 'trusted-click');", 'F1 capture');
  rep("          gestureRowHash: mutating && athAction === 'place_order' ? orderRowHash : '',",
      "          gestureClass: gestureClass,\n          gestureRowHash: mutating && athAction === 'place_order' ? orderRowHash : '',", 'F1 message');
  /* R4: the schedule verb forwards an optional expected day */
  rep("        mlsRelayRetry({ type: 'mlsAppScheduleRequest', id: scheduleGuard.requestId, requestId: scheduleGuard.requestId, deadlineAt: scheduleGuard.deadlineAt }, function (resp) {",
      "        mlsRelayRetry({ type: 'mlsAppScheduleRequest', id: scheduleGuard.requestId, requestId: scheduleGuard.requestId, deadlineAt: scheduleGuard.deadlineAt, expectedDate: (/^\\d{4}-\\d{2}-\\d{2}$/.test(mlsStr(d.expectedDate || d.date, 10)) ? mlsStr(d.expectedDate || d.date, 10) : '') }, function (resp) {", 'R4 bridge');
  /* R9: navigation verbs retry only when the worker provably never received the message */
  rep("  function mlsRelayRetry(req, cb) {",
      "  /* navretry-1.0.0 (3.0.125): navigation verbs (open a chart, go to a date, go home)\n     are actions. They re-send only when Chrome says the worker never received the\n     message; a worker that died mid-action answers nothing and is NOT re-sent. */\n  function mlsRelayNav(req, cb) {\n    var done = false;\n    function finish(resp) { if (done) return; done = true; try { cb(resp); } catch (e) {} }\n    function once(last) {\n      try {\n        chrome.runtime.sendMessage(req, function (resp) {\n          var le = chrome.runtime.lastError;\n          var neverReceived = !!(le && /receiving end does not exist|could not establish connection/i.test(String(le.message || '')));\n          if (neverReceived && !last) { setTimeout(function () { once(true); }, 300); return; }\n          finish(resp);\n        });\n      } catch (e) { if (!last) { setTimeout(function () { once(true); }, 300); } else { finish(null); } }\n    }\n    once(false);\n  }\n  function mlsRelayRetry(req, cb) {", 'R9 helper');
  {
    repAll("mlsRelayRetry({ type: 'mlsAppSearchOpenRequest',", "mlsRelayNav({ type: 'mlsAppSearchOpenRequest',", 2, 'R9 open both');
    rep("mlsRelayRetry({ type: 'mlsAppGotoDateRequest',", "mlsRelayNav({ type: 'mlsAppGotoDateRequest',", 'R9 goto');
    rep("mlsRelayRetry({ type: 'mlsAppGoHomeRequest' }", "mlsRelayNav({ type: 'mlsAppGoHomeRequest' }", 'R9 home');
  }
});
console.log('splice-30125 complete');
