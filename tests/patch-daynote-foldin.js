#!/usr/bin/env node
'use strict';
/* =============================================================================
 * patch-daynote-foldin.js  (dn-1.0)  2026-08-11
 *
 * DAY-NOTE FOLD-IN + TERMINAL DONE STATE — site-only patch prep.
 * Owner directive: the pull "should save the days visit note when its already
 * on that person, and then when its done it should stop and say done."
 *
 * HARD CONSTRAINT HONORED: zero extension edits. Every edit below lands in
 * site files only (feat_mls_schedimport_exact.js, mls-connect.js). The only
 * bridge verbs used are ones the SHIPPED 3.0.61 extension already handles:
 *   - mlsPing / mlsPong          (content.js:40 whitelist; content.js:155)
 *   - mlsAppReadChart            (content.js:40 whitelist; via _assistReadChart)
 *   - mlsAppReadAllVisits        (content.js:1702 dedicated router;
 *                                 hint.onlyDate honored background.js:11056)
 * ...and all of them only through the EXISTING, unmodified
 * window.__mlsVisitSavePref.runForPatient chain (mls-connect.js:47088).
 *
 * EOL SAFETY: mls-connect.js is historically mixed-EOL. Files are read and
 * written as latin1 (byte-preserving); every edit is an exact byte splice with
 * an occurrence==1 assertion on its anchor. No line-based rewrite, no
 * normalization, ever (memory: wyzant-metrics-file-has-no-backup — a byte
 * rewrite "newline fix" destroyed a file; splice, never rewrite).
 *
 * MODES:
 *   node patch-daynote-foldin.js            -> DRY-RUN: verify every anchor
 *                                              (occurrence==1) + print report.
 *                                              Writes NOTHING.
 *   node patch-daynote-foldin.js --apply    -> apply splices, write .bak
 *                                              first, then patched files.
 *
 * The module also exports { EDITS, applyToSources } so the contract test
 * (day-note-foldin-contract.test.js) can build the patched sources in memory
 * without touching the repo.
 *
 * AFTER APPLY (release-train checklist, not done by this script):
 *   1. register day-note-foldin-contract.test.js in tests/run-all.js
 *      (EXISTING IS NOT RUNNING — an unregistered fence never executes);
 *   2. run the full suite gate with the completeness line (GATE_PLAN/COMPLETE);
 *   3. /mls-build-ship (build bump at push time only).
 * ========================================================================== */

const fs = require('fs');
const path = require('path');

/* Repo root: this file lives in tests/, so the repo is one level up. The env
 * override lets a dry-run point at another checkout without editing this file
 * (an absolute default path would silently read the WRONG repo from a clone —
 * the dispatch-clones-drift class). */
const ROOT = process.env.MLS_REPO_ROOT || path.resolve(__dirname, '..');

const SI = 'feat_mls_schedimport_exact.js';
const MC = 'mls-connect.js';

/* ---------------------------------------------------------------------------
 * EDITS. Each: { file, id, why, find, replace }.
 * `find` must occur EXACTLY ONCE in the file's current bytes at the moment the
 * edit is applied (edits are sequential, so later anchors are checked against
 * earlier results — an inserted body can never silently duplicate an anchor).
 * ------------------------------------------------------------------------- */
const EDITS = [

  /* ==== 1. batch-scope state for the fold-in (si) ========================= */
  {
    file: SI, id: 'si-hoist-batch-scope',
    why: 'todayNoteExtOk/safeAsync hoisted from the tail pass to batch scope; inlineDayNoteFuse added (one-way fuse so a wedged scoped read degrades to the old tail-pass shape instead of poisoning later chart opens - the 2026-07-28 tab-of-record lesson).',
    find: '    var pipelineParses = [];\n',
    replace:
      '    var pipelineParses = [];\n' +
      '    /* dn-1.0 FOLD-IN state (owner 2026-08-11): shared by the inline day-note\n' +
      '       capture in the main loop and the tail pass below. todayNoteExtOk is the\n' +
      '       one-pong-per-batch scoped-read capability verdict (declared here instead\n' +
      '       of inside the tail pass; semantics identical). inlineDayNoteFuse is a\n' +
      '       ONE-WAY fuse: the first timeout-class inline failure stops every later\n' +
      '       INLINE attempt, because an abandoned mid-batch scoped read keeps driving\n' +
      '       the athena tab and wrestles the tab-of-record away from the next chart\n' +
      '       open (measured live 2026-07-28: 10 ok, then 11 straight tab-unreachable).\n' +
      '       Fused patients keep todayNote null and fall through to the tail pass,\n' +
      '       which is byte-for-byte the old post-batch behavior. */\n' +
      '    var todayNoteExtOk = null;\n' +
      '    var safeAsync = async function (fn, fb) { try { return await fn(); } catch (eSa) { return fb; } };\n' +
      '    var inlineDayNoteFuse = "";\n'
  },

  /* ==== 2. inline day-note capture inside the per-patient window (si) ===== */
  {
    file: SI, id: 'si-inline-daynote',
    why: 'THE FOLD-IN: with visit bodies OFF, capture the pulled day\'s note while this patient\'s verified chart is still the tab-of-record, through the SAME runForPatient chain the tail uses (identity gates + refusal reasons byte-identical). rd non-null proves this batch\'s chart read just succeeded.',
    find:
      '        receipt.patients.push(one); receipt.processed++;\n' +
      '        if (stopAfterTimeout) {\n',
    replace:
      '        receipt.patients.push(one); receipt.processed++;\n' +
      '        /* dn-1.0 FOLD-IN (owner 2026-08-11: it "should save the days visit note\n' +
      '           when its already on that person"): with visit bodies OFF the pulled\n' +
      '           day\'s note is captured NOW, while THIS patient\'s verified chart is\n' +
      '           still the tab-of-record. The old serial re-open pass cost ~38s/note\n' +
      '           re-opening charts this loop had already opened (62.8s/chart combined,\n' +
      '           criterion-1 FAIL: tests/live-e2e-artifacts/2026-08-11-3061-acceptance-\n' +
      '           jul7.md). The read is sequential and FULLY AWAITED before the next\n' +
      '           chart opens (2026-07-28 law), and it runs through the SAME\n' +
      '           __mlsVisitSavePref.runForPatient chain as the tail pass - the chart\n' +
      '           re-open+verify, every identity gate, the refusal reasons, and the\n' +
      '           additive scoped save are byte-identical; only the MOMENT moved.\n' +
      '           Because the tab is already parked on this patient, the reader\'s own\n' +
      '           _assistReadChart re-verifies a chart it is already on - which is also\n' +
      '           the answer to the ~25-30s athena surface recycle: the day-note leg\n' +
      '           re-establishes a FRESH verified surface immediately before the scoped\n' +
      '           read instead of trusting the history capture\'s aging one. A failed\n' +
      '           chart read (rd null) leaves todayNote null for the tail pass and the\n' +
      '           sweep, exactly as before. */\n' +
      '        if (!stopAfterTimeout && pullVisitBodies !== true && one.visitsSkipped === true && rd && !inlineDayNoteFuse) {\n' +
      '          var dnDay = normDate((row && (row.scheduleDate || row.date)) || "") || "";\n' +
      '          var dnVp = safe(function () { return window.__mlsVisitSavePref; }, null);\n' +
      '          var dnP = dnDay ? safe(function () { return findStorePatient(one.patientId); }, null) : null;\n' +
      '          if (!(dnVp && typeof dnVp.runForPatient === "function" && dnP)) { one.todayNote = false; one.todayNoteReason = dnDay ? "reader-unavailable" : "no-day-on-row"; }\n' +
      '          else {\n' +
      '            if (todayNoteExtOk === null) {\n' +
      '              /* one pong per batch decides scoped-read capability; the pong\n' +
      '                 version is the only honest source (2026-07-28 invariant). */\n' +
      '              todayNoteExtOk = await safeAsync(async function () {\n' +
      '                var pg = await bridge("mlsPong", "mlsPing", 3500);\n' +
      '                var m = String((pg && pg.version) || "").match(/^(\\d+)\\.(\\d+)\\.(\\d+)/);\n' +
      '                if (!m) return false;\n' +
      '                return (Number(m[1]) > 3) || (Number(m[1]) === 3 && (Number(m[2]) > 0 || Number(m[3]) >= 30));\n' +
      '              }, false);\n' +
      '            }\n' +
      '            if (!todayNoteExtOk) { one.todayNote = false; one.todayNoteReason = "extension-predates-scoped-read"; }\n' +
      '            else {\n' +
      '              try { ppCurrent(String(one.name || "").split(" ")[0] + " \\u2014 saving the pulled day\'s note"); } catch (eDnCur) {}\n' +
      '              safe(function () { if (window.__mlsPullShieldTick) window.__mlsPullShieldTick(); });\n' +
      '              try {\n' +
      '                var dnRes = await dnVp.runForPatient(dnP, function () {}, { onlyDate: dnDay });\n' +
      '                one.todayNote = !!(dnRes && (dnRes.ok === true || typeof dnRes === "number" || dnRes.visits != null));\n' +
      '                if (!one.todayNote) one.todayNoteReason = String((dnRes && dnRes.reason) || "scoped-read-unverified").slice(0, 80);\n' +
      '              } catch (eDnRun) {\n' +
      '                one.todayNote = false; one.todayNoteReason = String((eDnRun && eDnRun.message) || eDnRun).slice(0, 80);\n' +
      '                /* timeout-class failures mean the runner may still be driving\n' +
      '                   the tab: trip the fuse so no later INLINE attempt races the\n' +
      '                   next chart open; the tail pass (post-batch) inherits them. */\n' +
      '                if (/timeout|deadline|responding|unreachable|no-ext/i.test(one.todayNoteReason)) { inlineDayNoteFuse = one.todayNoteReason; receipt.todayNoteInlineFuse = inlineDayNoteFuse; }\n' +
      '              }\n' +
      '            }\n' +
      '          }\n' +
      '          /* qol-1.3 parity: an unread pulled-day note is VISIBLE on the row -\n' +
      '             pushed after the row\'s own settle so the day-note verdict wins the\n' +
      '             latest-state tally, exactly as the tail pass\'s emit did. */\n' +
      '          if (one.todayNote !== true && typeof ppSettle === "function" && one.name) { try { ppSettle(one.name, false, "pulled-day-note-unread " + String(one.todayNoteReason || "").slice(0, 60), false, { pid: one.patientId }); } catch (eDnPp) {} }\n' +
      '        }\n' +
      '        if (stopAfterTimeout) {\n'
  },

  /* ==== 3. tail pass: attempt-once filter + de-duplicated decls (si) ====== */
  {
    file: SI, id: 'si-tail-decl-dedupe',
    why: 'the tail pass no longer re-declares/re-initializes the hoisted batch-scope state (re-initializing todayNoteExtOk would discard the pong verdict and re-pong).',
    find:
      '      var todayNoteExtOk = null;\n' +
      '      var safeAsync = async function (fn, fb) { try { return await fn(); } catch (eSa) { return fb; } };\n' +
      '      try {\n',
    replace:
      '      /* dn-1.0: todayNoteExtOk + safeAsync now live at batch scope (shared\n' +
      '         with the inline fold-in in the main loop). This pass is the TAIL: it\n' +
      '         attempts ONLY patients the inline capture never reached (chart-read\n' +
      '         failures, fuse trips) - an inline verdict, success OR refusal, is\n' +
      '         attempt-once and is never re-run here, so a day where every inline\n' +
      '         capture succeeded performs ZERO second-pass re-opens. */\n' +
      '      try {\n'
  },
  {
    file: SI, id: 'si-tail-counter',
    why: 'the "(N of M)" tail narration counts only patients the tail will actually attempt.',
    find: 'if (receipt.patients[tnc] && receipt.patients[tnc].visitsSkipped === true) tnTotal++;',
    replace: 'if (receipt.patients[tnc] && receipt.patients[tnc].visitsSkipped === true && receipt.patients[tnc].todayNote == null) tnTotal++;'
  },
  {
    file: SI, id: 'si-tail-filter',
    why: 'THE SECOND SERIAL PASS DISAPPEARS for inline-settled patients: only never-attempted patients (todayNote == null) reach the tail loop.',
    find: '        if (!oneTn || oneTn.visitsSkipped !== true) continue;\n',
    replace: '        if (!oneTn || oneTn.visitsSkipped !== true || oneTn.todayNote != null) continue; /* dn-1.0: attempt-once - an inline verdict (success OR refusal, incl. identity-mismatch) is final; only never-attempted patients reach this tail */\n'
  },

  /* ==== 4. terminal-truth stamp for the DONE card (si) ==================== */
  {
    file: SI, id: 'si-dayverdict-stamp',
    why: 'the pull panel\'s DONE card needs the day verdict (saved/failed/day-note refusals/complete) on the state object both surfaces already share. Outer batch only (b752 subset trap); last finalize wins.',
    find: 'receipt.todayNoteFailures = tnF; receipt.todayNoteReasons = tnR; });\n',
    replace:
      'receipt.todayNoteFailures = tnF; receipt.todayNoteReasons = tnR; });\n' +
      '      /* dn-1.0 TERMINAL TRUTH: the pull panel\'s DONE card (mls-connect\n' +
      '         __mlsPullProgress) reads this stamp. Outer batch only - a sub-batch\n' +
      '         stamping day-level truth is the b752 subset trap. finalizeVerdict may\n' +
      '         run twice by design; the LAST call wins, which is the post-sweep truth. */\n' +
      '      safe(function () { if (sweepDepth) return; var sDv = ppState(); if (!sDv) return; sDv.dayVerdict = { ok: Number(sDv.ok || 0), failed: Number(sDv.failed || 0), chartOnly: Number(sDv.chartOnly || 0), total: Number(sDv.total || 0), complete: receipt.complete === true, tnFailed: Number(receipt.todayNoteFailures || 0), tnReasons: receipt.todayNoteReasons || {}, at: Date.now() }; });\n'
  },
  {
    file: SI, id: 'si-ppend-finishedat',
    why: 'the DONE card freezes its elapsed clock on the moment the run truly ended, not on the tick that painted it.',
    find: "    function ppEnd(){ var s=ppState(); if(s){ s.running=false; s.current=''; } }\n",
    replace: "    function ppEnd(){ var s=ppState(); if(s){ s.finishedAt=Date.now(); s.running=false; s.current=''; } } /* dn-1.0: the DONE card freezes its clock on finishedAt */\n"
  },

  /* ==== 5. ledger persists the todayNote aggregate (si, queue item) ======= */
  {
    file: SI, id: 'si-ledger-todaynote',
    why: 'queue item: the receipt histogram was the only carrier of day-note truth and died with the tab (2026-08-11 acceptance gap: recordHistoryVerdict does not persist todayNoteFailures/Reasons). Bounded fields beside the walk counts.',
    find:
      '        neverAttempted: Number(census.neverAttempted || 0),\n' +
      '        census: ledgerCensus\n',
    replace:
      '        neverAttempted: Number(census.neverAttempted || 0),\n' +
      '        /* dn-1.0: persist the day-note lane\'s truth in the day ledger - count,\n' +
      '           reason histogram, and per-patient refusals (pid -> reason head).\n' +
      '           Bounded: <=40 patients/day by construction, reasons sliced. */\n' +
      '        todayNoteFailures: Number(receipt.todayNoteFailures || 0),\n' +
      '        todayNoteReasons: (function () { var oTn = {}; try { Object.keys(receipt.todayNoteReasons || {}).slice(0, 20).forEach(function (kTn) { oTn[String(kTn).slice(0, 80)] = Number(receipt.todayNoteReasons[kTn] || 0); }); } catch (eTn) {} return oTn; })(),\n' +
      '        todayNoteRefused: (function () { var oTr = {}; try { (receipt.patients || []).forEach(function (pTr) { if (pTr && pTr.todayNote === false && pTr.patientId) oTr[String(pTr.patientId)] = String(pTr.todayNoteReason || "unknown").slice(0, 80); }); } catch (eTr) {} return oTr; })(),\n' +
      '        census: ledgerCensus\n'
  },

  /* ==== 6. day-end line NAMES refused day-notes (si, queue item) ========== */
  {
    file: SI, id: 'si-dayend-name-refusals',
    why: 'queue item: the si day-end line must NAME refused day-notes (first name + reason), not just count them - a count cannot be acted on.',
    find: '            var __chartOnly = 0; try { __chartOnly = ',
    replace:
      '            /* dn-1.0 (queue item): NAME the refused day-notes on the day line.\n' +
      '               First names + the reason head, bounded to 6; rides BOTH verdict\n' +
      '               lines because the day-note lane is verdict-neutral by design. */\n' +
      '            var __tnNote = "";\n' +
      '            try {\n' +
      '              var __tnList = ((historyReceipt && historyReceipt.patients) || []).filter(function (p) { return p && p.todayNote === false; });\n' +
      '              if (__tnList.length) __tnNote = " The pulled day\'s note could not be read for " + __tnList.slice(0, 6).map(function (p) { return (String(p.name || "").split(/\\s+/)[0] || ("#" + String(p.patientId || "????").slice(-4))) + " (" + String(p.todayNoteReason || "unread").split(/[\\[{]/)[0].trim().slice(0, 48) + ")"; }).join("; ") + (__tnList.length > 6 ? "; +" + (__tnList.length - 6) + " more" : "") + " \\u2014 the charts themselves saved; the reasons are in the day ledger.";\n' +
      '            } catch (eTnNote) {}\n' +
      '            var __chartOnly = 0; try { __chartOnly = '
  },
  {
    file: SI, id: 'si-dayend-append-err',
    why: 'refused day-note names ride the incomplete day line.',
    find: ' + contentNotice(historyReceipt) + __redoNote, "err");',
    replace: ' + contentNotice(historyReceipt) + __redoNote + __tnNote, "err");'
  },
  {
    file: SI, id: 'si-dayend-append-ok',
    why: 'refused day-note names ride the complete day line too (day-note failures never flip the verdict, so the complete line is exactly where they hide).',
    find: ' + contentNotice(historyReceipt) + __redoNote, "ok");',
    replace: ' + contentNotice(historyReceipt) + __redoNote + __tnNote, "ok");'
  },

  /* ==== 7. terminal DONE state on the pull panel (mls-connect) ============ */
  {
    file: MC, id: 'mc-done-state-vars',
    why: 'DONE-card lifecycle flag beside the panel\'s existing lifecycle vars.',
    find: '  var startedAt = 0, hidden = true, stopped = false;\n',
    replace:
      '  var startedAt = 0, hidden = true, stopped = false;\n' +
      '  var doneDismissed = false; /* dn-1.0: set only by the DONE card\'s Done button; re-armed when a new run starts */\n'
  },
  {
    file: MC, id: 'mc-render-terminal-branch',
    why: 'owner: "when its done it should stop and say done". A finished pull used to vanish on the next tick (panel+pill removed, render() early-return) with NO terminal state. The watched run now paints one honest DONE card that stays until dismissed.',
    find:
      '    if (!running) {\n' +
      '      var p0 = document.getElementById(PANEL); if (p0) p0.remove();\n' +
      '      ensureFab(false);\n' +
      '      startedAt = 0; hidden = true; /* b940: reset to the pill DEFAULT, never to the modal */\n' +
      '      return;\n' +
      '    }\n' +
      '    if (!startedAt) { startedAt = Date.now(); api.opens++; }\n',
    replace:
      '    if (!running) {\n' +
      '      /* dn-1.0 (owner 2026-08-11: "when its done it should stop and say\n' +
      '         done"): the run THIS panel watched (startedAt>0) paints ONE honest\n' +
      '         DONE card - saved / not saved / pulled-day-note refusals - and stays\n' +
      '         until the doctor closes it. No further passes run behind it (the\n' +
      '         engine has already released), and no "keep pulling" framing remains\n' +
      '         on the card. A tab that never watched a run keeps the old clean\n' +
      '         removal; the Done click resets to that same state. */\n' +
      '      if (startedAt > 0 && S && (S.rows || []).length && !doneDismissed) { renderDone(S); return; }\n' +
      '      var p0 = document.getElementById(PANEL); if (p0) p0.remove();\n' +
      '      ensureFab(false);\n' +
      '      startedAt = 0; hidden = true; /* b940: reset to the pill DEFAULT, never to the modal */\n' +
      '      doneDismissed = false;\n' +
      '      return;\n' +
      '    }\n' +
      '    if (doneDismissed) doneDismissed = false; /* dn-1.0: a NEW run re-arms the DONE card */\n' +
      '    (function () { var pStale = document.getElementById(PANEL); if (pStale && pStale.__ppDoneApplied) pStale.remove(); })(); /* dn-1.0: a fresh run never paints into last run\'s DONE card */\n' +
      '    if (!startedAt) { startedAt = Date.now(); api.opens++; }\n'
  },
  {
    file: MC, id: 'mc-renderdone-fn',
    why: 'the DONE card itself: honest counts (saved / not saved / chart-only / day-note refusals), frozen clock, rows list final, Stop hidden, Hide becomes Done. Idempotent paint; once-only mutations keyed on __ppDoneApplied so the terminal state fires exactly once per finished run.',
    find: '  (function loop() { tick(900, function () { try { render(); } catch (e) {} loop(); }); })();\n',
    replace:
      '  /* dn-1.0: the terminal DONE card. Idempotent paint (same guarded-write\n' +
      '     discipline as render); once-only mutations are keyed on __ppDoneApplied,\n' +
      '     so the terminal state FIRES EXACTLY ONCE per finished run (api.doneShown\n' +
      '     counts it). Reads the engine\'s dayVerdict stamp for day-note truth. */\n' +
      '  function renderDone(S) {\n' +
      '    css();\n' +
      '    var ok = S.ok || 0, failed = S.failed || 0, chartOnly = S.chartOnly || 0, total = S.total || 0;\n' +
      '    if (hidden) {\n' +
      '      ensureFab(true);\n' +
      '      var fD = document.getElementById(FAB);\n' +
      '      if (fD) { var tD = \'Pull done \\u2014 \\u2713 \' + ok + (failed ? \' \\u00B7 \\u26A0 \' + failed : \'\') + \' \\u2014 see results\'; if (fD.textContent !== tD) fD.textContent = tD; }\n' +
      '      var phD = document.getElementById(PANEL); if (phD) phD.remove();\n' +
      '      return;\n' +
      '    }\n' +
      '    ensureFab(false);\n' +
      '    var p = buildPanel();\n' +
      '    var dv = S.dayVerdict || null;\n' +
      '    if (!p.__ppDoneApplied) {\n' +
      '      p.__ppDoneApplied = 1;\n' +
      '      api.doneShown = (api.doneShown || 0) + 1;\n' +
      '      try { var h3D = p.querySelector(\'h3\'); if (h3D) h3D.textContent = \'\\u2705 Done \\u2014 the pull has finished\'; } catch (eH3) {}\n' +
      '      try { var subD = p.querySelector(\'.pp-sub\'); if (subD) subD.textContent = \'Every row below is final. Nothing more will run, and athenaOne is no longer being driven.\'; } catch (eSub) {}\n' +
      '      try { var curLbl = p.querySelector(\'.pp-cur b\'); if (curLbl) curLbl.textContent = \'Result:\'; } catch (eCur) {}\n' +
      '      try { var noteD = p.querySelector(\'.pp-note\'); if (noteD) noteD.textContent = failed ? \'Rows marked \\u26A0 carry their reason. "Retry failed histories" re-reads only those charts.\' : \'Everything the day asked for was read and saved.\'; } catch (eNote) {}\n' +
      '      try { var sbD = document.getElementById(\'mlsPullProgStop\'); if (sbD) sbD.style.display = \'none\'; } catch (eSb) {}\n' +
      '      try { var hbD = document.getElementById(\'mlsPullProgHide\'); if (hbD) { hbD.textContent = \'Done\'; hbD.onclick = function () { doneDismissed = true; render(); }; } } catch (eHb) {}\n' +
      '    }\n' +
      '    var doneLine = \'\\u2713 \' + ok + \' saved\' + (failed ? \' \\u00B7 \\u26A0 \' + failed + \' not saved\' + (chartOnly ? \' (\' + chartOnly + \' chart-saved, notes incomplete)\' : \'\') : \'\');\n' +
      '    if (dv && Number(dv.tnFailed || 0) > 0) doneLine += \' \\u00B7 \\u26A0 \' + dv.tnFailed + \' pulled-day note\' + (Number(dv.tnFailed) === 1 ? \'\' : \'s\') + \' not read\';\n' +
      '    if (dv && dv.complete === true) doneLine += \' \\u2014 everything verified\';\n' +
      '    setText(p, \'done\', String(S.done || 0));\n' +
      '    setText(p, \'total\', String(total));\n' +
      '    var fillD = p.querySelector(\'.pp-fill\');\n' +
      '    if (fillD) { var wD = (total ? Math.round(((S.done || 0) / total) * 100) : 100) + \'%\'; if (fillD.style.width !== wD) fillD.style.width = wD; }\n' +
      '    setText(p, \'pct\', \'Done\');\n' +
      '    setText(p, \'tally\', doneLine);\n' +
      '    setText(p, \'elapsed\', mmss(Math.max(0, (S.finishedAt || Date.now()) - startedAt)) + \' total\');\n' +
      '    setText(p, \'current\', doneLine);\n' +
      '    var rowsElD = p.querySelector(\'[data-pp="rows"]\');\n' +
      '    if (rowsElD && !p.__ppDoneRows) { p.__ppDoneRows = 1; var htmlD = rowsHtml(S); rowsElD.style.display = htmlD ? \'\' : \'none\'; rowsElD.innerHTML = htmlD; }\n' +
      '  }\n' +
      '  api._renderDone = renderDone; /* dn-1.0: contract-test seam; not used by the app */\n' +
      '\n' +
      '  (function loop() { tick(900, function () { try { render(); } catch (e) {} loop(); }); })();\n'
  }
];

/* ---------------------------------------------------------------------------
 * Engine: sequential exact-byte splices with occurrence==1 assertions.
 * (Extraction idiom per tests/quota-guard-edit-survives.test.js: locate by
 * exact source bytes, assert bounds, splice — never regex-rewrite.)
 * ------------------------------------------------------------------------- */
function occurrences(hay, needle) {
  let n = 0, i = 0;
  for (;;) { i = hay.indexOf(needle, i); if (i < 0) return n; n++; i += needle.length; }
}

function applyToSources(sources, opts) {
  opts = opts || {};
  const out = Object.assign({}, sources);
  const log = [];
  for (const e of EDITS) {
    const src = out[e.file];
    if (typeof src !== 'string') throw new Error('missing source for ' + e.file);
    const nFind = occurrences(src, e.find);
    const nRepl = occurrences(src, e.replace);
    /* ALREADY APPLIED comes FIRST and is judged on the REPLACE text, not on
     * the find's absence: several edits splice by prefix/suffix (their find
     * is contained in their replace), so the find SURVIVES a correct apply.
     * Judging by nFind===0 alone re-spliced those edits on every later run —
     * an in-memory double-patch the contract suite's non-vacuity identity
     * check caught (si !== raw). If the full replacement is present exactly
     * once, this edit is done: skip when tolerated, refuse otherwise (a
     * second --apply must never double-splice). */
    if (nRepl === 1) {
      if (opts.tolerateApplied) {
        log.push({ id: e.id, file: e.file, status: 'already-applied' });
        continue;
      }
      throw new Error('[' + e.id + '] in ' + e.file + ': already applied - refusing to double-splice');
    }
    if (nFind !== 1) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': expected occurrence==1, found ' + nFind +
        (nRepl ? ' (replacement text present ' + nRepl + 'x)' : ''));
    }
    if (nRepl !== 0 && e.replace.indexOf(e.find) !== 0 && occurrences(e.replace, e.find) === 0) {
      throw new Error('ANCHOR FAILURE [' + e.id + '] in ' + e.file + ': replacement already present alongside anchor');
    }
    const at = src.indexOf(e.find);
    out[e.file] = src.slice(0, at) + e.replace + src.slice(at + e.find.length);
    log.push({ id: e.id, file: e.file, status: 'ok', at });
  }
  return { sources: out, log };
}

function main() {
  const APPLY = process.argv.indexOf('--apply') >= 0;
  const files = Array.from(new Set(EDITS.map(e => e.file)));
  const sources = {};
  for (const f of files) {
    const full = path.join(ROOT, f);
    sources[f] = fs.readFileSync(full, 'latin1');
    console.log('read  ' + f + '  (' + sources[f].length + ' bytes, latin1)');
  }

  /* DRY-RUN verification pass (always runs, also before --apply). The dry-run
   * TOLERATES an applied repo and reports it; --apply itself stays strict via
   * the all-applied refusal below (never a double-splice, never a half-apply). */
  let result;
  try {
    result = applyToSources(sources, { tolerateApplied: !APPLY });
  } catch (err) {
    console.error('\nDRY-RUN: FAIL');
    console.error(String(err && err.message || err));
    process.exit(1);
  }
  const applied = result.log.filter(l => l.status === 'already-applied');
  if (applied.length === EDITS.length) {
    console.log('\nDRY-RUN: ALL ' + EDITS.length + ' EDITS ALREADY APPLIED — the repo carries dn-1.0; nothing to do.');
    return;
  }
  if (applied.length > 0) {
    console.error('\nDRY-RUN: FAIL — PARTIAL APPLY: ' + applied.length + '/' + EDITS.length +
      ' edits already present (' + applied.map(l => l.id).join(', ') + '). A half-applied repo needs the .dn10.bak restored before this patcher may run.');
    process.exit(1);
  }
  for (const l of result.log) console.log('anchor ok  [' + l.id + ']  ' + l.file + ' @' + l.at);
  for (const f of files) {
    console.log('post-splice size ' + f + ': ' + sources[f].length + ' -> ' + result.sources[f].length +
      ' (+' + (result.sources[f].length - sources[f].length) + ' bytes)');
  }
  console.log('\nDRY-RUN: PASS — ' + result.log.length + '/' + EDITS.length + ' anchors verified (occurrence==1 each).');

  if (!APPLY) {
    console.log('No files written. Re-run with --apply to splice (writes .bak first).');
    console.log('REMINDER after apply: register day-note-foldin-contract.test.js in tests/run-all.js (EXISTING IS NOT RUNNING), run the gated suite, then /mls-build-ship.');
    return;
  }

  for (const f of files) {
    const full = path.join(ROOT, f);
    fs.writeFileSync(full + '.dn10.bak', sources[f], 'latin1');
    fs.writeFileSync(full, result.sources[f], 'latin1');
    console.log('APPLIED ' + f + ' (backup: ' + f + '.dn10.bak)');
  }
}

if (require.main === module) main();
module.exports = { EDITS, applyToSources, occurrences, ROOT };
