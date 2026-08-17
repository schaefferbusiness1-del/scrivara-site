/* =============================================================================
 * LIVE PROBE - /1p fast pull, 2026-08-17 lane (dnd / fd / bob / stp / cvc /
 *              fdx / scv / ed / U0 / rsk / p1-authority-repair)
 *
 * FOR THE LEAD to paste into the devtools console of the owner's signed-in /1p
 * tab. It is READ-ONLY except for ONE deliberate click of the existing Pull
 * button, exactly as the owner would press it.
 *
 * PHI RULES BUILT IN - read them before you change anything:
 *   - import-ledger ROW KEYS are `name|date|time` (1p-feat_mls_schedimport_
 *     exact.js:297). NEVER emit Object.keys() of a ledger's rows. This script
 *     only ever counts states.
 *   - receipts are read through the site's OWN redactor, dsDiagReport()
 *     (1p-mls-connect.js, allowlisted fields + DS_SAFE_REASON_CODES). Never
 *     paste window.__mlsSI._lastPullResult() raw.
 *   - patient NAMES appear in __mlsDayHistoryPull.state.rows[].name and in
 *     state.current. This script reduces them to counts and never prints one.
 *
 * USAGE
 *   1.  MLS_LIVE.frame()          - record the frame BEFORE anything else
 *   2.  await MLS_LIVE.pull()     - one click, waits for settle, prints numbers
 *   3.  await MLS_LIVE.stopTest() - starts a pull, presses Stop, checks release
 *   4.  MLS_LIVE.report()         - the PHI-free copyable block
 * ========================================================================== */
(function () {
  'use strict';
  var OUT = { frame: null, runs: [], stop: null };

  function el(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function pick(o, keys) { var r = {}; if (!o) return null; keys.forEach(function (k) { if (o[k] !== undefined) r[k] = o[k]; }); return r; }

  /* ---- STEP 0: the frame. A time without `bodies` is uninterpretable. ---- */
  function frame() {
    var f = {
      build: (function () { try { return String(window.__MLS_AV || ''); } catch (e) { return ''; } })(),
      ext: (function () { try { return String(window.__mlsExtReportedVersion || ''); } catch (e) { return ''; } })(),
      bodies: (function () { try { return (window.__mlsVisitNotesPref && window.__mlsVisitNotesPref.read()) || null; } catch (e) { return null; } })(),
      ns: (function () { try { return typeof uns === 'function' ? uns('') : null; } catch (e) { return null; } })(),
      dayLabel: (function () { var d = el('mlsDsDayLbl'); return d ? String(d.textContent || '') : ''; })(),
      acctToday: (function () { try { return typeof _acctTodayKey === 'function' ? _acctTodayKey() : ''; } catch (e) { return ''; } })(),
      visibility: (function () { try { return document.visibilityState; } catch (e) { return ''; } })(),
      skipVerifiedToday: (function () { try { return window.__mlsP1SkipVerifiedToday !== false; } catch (e) { return true; } })()
    };
    /* STOP condition from the synthesis: an untraced second route to
       authority-store-invalid. Key NAMES carry no PHI. */
    f.nsSuspect = /sf_u::undefined::|sf_u::_::/.test(String(f.ns || ''));
    OUT.frame = f;
    console.log('FRAME', f);
    if (f.nsSuspect) console.warn('STOP: the namespace reads sf_u::undefined:: / sf_u::_:: - report this and do not pull.');
    if (!f.bodies) console.warn('bodies preference unreadable - the timing below cannot be compared to anything.');
    return f;
  }

  /* ---- the PHI-free slice of the live pull state ------------------------ */
  function pullState() {
    var s = null;
    try { s = window.__mlsDayHistoryPull && window.__mlsDayHistoryPull.state; } catch (e) {}
    if (!s) return null;
    /* rows[] carry NAMES. Reduce to a reason histogram, never emit a row. */
    var reasons = {}, latest = {};
    try {
      (s.rows || []).forEach(function (r) { latest[String(r.k || r.name || '')] = r; });
      Object.keys(latest).forEach(function (k) {
        var r = latest[k];
        var why = r.ok === true ? 'ok' : (r.pending === true ? 'pending' : String(r.reason || 'unknown').split(/[[{]/)[0].trim().slice(0, 60));
        reasons[why] = (reasons[why] || 0) + 1;
      });
    } catch (e) {}
    return {
      running: s.running === true, total: num(s.total), done: num(s.done), ok: num(s.ok),
      failed: num(s.failed), chartOnly: num(s.chartOnly),
      /* NOT s.current - it carries a first name. */
      reasons: reasons,
      dayVerdict: s.dayVerdict ? pick(s.dayVerdict, ['ok', 'failed', 'chartOnly', 'total', 'complete', 'tnFailed', 'tnReasons', 'tnDeferredRecovered']) : null
    };
  }

  /* ---- the receipts, through the site's own redactor -------------------- */
  function receipts() {
    var raw = null;
    try { raw = typeof dsDiagReport === 'function' ? JSON.parse(dsDiagReport()) : null; } catch (e) { return { error: String(e && e.message || e) }; }
    if (!raw || !raw.result) return { error: 'no dsDiagReport result yet' };
    var r = raw.result, hr = r.historyReceipt || {}, cr = r.calendarReceipt || {};
    return {
      build: raw.build, day: raw.day, ext: raw.env && raw.env.extVersion,
      ok: r.ok, complete: r.complete, reason: r.reason,
      schedule: pick(r.scheduleReceipt, ['complete', 'expectedCount', 'parsedCount', 'authoritativeEmpty', 'reason', 'schedDate']),
      calendar: pick(cr, ['complete', 'attempted', 'accounted', 'mapped', 'uniqueSources', 'uniqueBackend', 'failed', 'wrongDay', 'invalidDate', 'snapshotPublished', 'snapshotReason', 'failureClass']),
      history: pick(hr, ['requested', 'processed', 'complete', 'exactIdentityVerified', 'failures', 'timedOut', 'reason',
        'retryReasons', 'todayNoteFailures', 'todayNoteReasons',
        /* the new instruments this lane added */
        'findReasons', 'findVia', 'noMatchingPatient', 'findDiagRows', 'findHint',
        'todayNoteMsTotal', 'todayNoteMsMax', 'todayNoteAttempts', 'todayNoteSkipped',
        'storeVerdict', 'storeCensus', 'storeDelta', 'contentVerified', 'contentGap',
        'stoppedByUser', 'todayNoteStoppedRows', 'day']),
      identityBootstrap: pick(r.identityBootstrap, ['complete', 'attempted', 'requested', 'resolved', 'failed']),
      providerReceipt: pick(r.providerReceipt, ['mode', 'complete', 'reason', 'rosterVerified', 'mismatchedRows', 'unattributedRows']),
      statusEvents: raw.statusEvents, statusEventsOmitted: raw.statusEventsOmitted
    };
  }

  /* ---- the day ledger, COUNTS ONLY (row keys contain names) ------------- */
  function dayLedger(day) {
    try {
      var ns = typeof uns === 'function' ? uns('') : '';
      var idx = JSON.parse(localStorage.getItem(ns + 'schedImportIndexV1::' + day) || '{"rows":{}}');
      var states = {}, backendIds = {}, n = 0;
      Object.keys(idx.rows || {}).forEach(function (k) {   /* keys NEVER leave this loop */
        var r = idx.rows[k]; n++;
        states[String(r && r.state || 'unknown')] = (states[String(r && r.state || 'unknown')] || 0) + 1;
        if (r && r.backendAppointmentId) backendIds[String(r.backendAppointmentId)] = 1;
      });
      var days = JSON.parse(localStorage.getItem(ns + 'schedImportDaysV1') || '[]');
      var h = idx.history || null;
      return {
        rows: n, states: states, backendIdCount: Object.keys(backendIds).length,
        dayComplete: days.indexOf(day) >= 0,
        history: h ? pick(h, ['dayRows', 'requested', 'processed', 'storedOk', 'failures', 'complete', 'verdict',
          'contentOk', 'contentNone', 'contentGap', 'contentMeasured', 'contentVerified',
          'contentChanged', 'contentUnchanged', 'changeMeasured', 'athenaSourced', 'neverAttempted',
          'todayNoteFailures', 'todayNoteReasons', 'todayNoteDeferred', 'reasons']) : null
      };
    } catch (e) { return { error: String(e && e.message || e) }; }
  }

  function leaseState() {
    var out = {};
    try { var m = window.__mlsP1AthenaReadLease; out.lease = m && typeof m.state === 'function' ? m.state() : null; out.busy = m && typeof m.busy === 'function' ? !!m.busy() : null; } catch (e) {}
    try { out.pageLease = !!window.__mlsSchedulePullLease; } catch (e) {}
    try { out.loan = !!window.__mlsP1AthenaLeaseLoan; } catch (e) {}
    try { out.busyAt = Number(window.__mlsPullBusyAt || 0); } catch (e) {}
    try { out.stopRequested = window.__mlsPullStopRequested === true; } catch (e) {}
    try { out.lastOutcome = window.__mlsPullLastOutcome ? pick(window.__mlsPullLastOutcome, ['ok', 'complete', 'reason', 'gate']) : null; } catch (e) {}
    try { out.deferredNotes = window.__mlsSI && window.__mlsSI._todayNoteDeferred ? window.__mlsSI._todayNoteDeferred() : null; } catch (e) {}
    if (out.deferredNotes) delete out.deferredNotes.rows;   /* rows carry patientIds */
    return out;
  }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  async function waitSettle(maxMs) {
    var t0 = Date.now(), sawRunning = false, rounds = 0, lastDone = -1;
    while (Date.now() - t0 < (maxMs || 45 * 60000)) {
      var s = pullState();
      var busy = false;
      try { busy = !!(window.__mlsDsPull && window.__mlsDsPull.isBusy && window.__mlsDsPull.isBusy()); } catch (e) {}
      if (s && s.running) { sawRunning = true; if (s.done < lastDone) rounds++; lastDone = s.done; }
      if (sawRunning && s && !s.running && !busy) return { settledMs: Date.now() - t0, barResets: rounds };
      await sleep(1000);
    }
    return { settledMs: Date.now() - t0, barResets: rounds, timedOut: true };
  }

  /* ---- STEP 1: ONE click, then measure --------------------------------- */
  async function pull() {
    var day = (function () { try { return window.__mlsDsPull && window.__mlsDsPull.day ? window.__mlsDsPull.day() : ''; } catch (e) { return ''; } })();
    var before = dayLedger(day || '');
    var btn = el('mlsDsPullBtn');
    if (!btn) { console.error('no #mlsDsPullBtn on this screen'); return null; }
    var t0 = Date.now();
    btn.click();
    /* the first click after a fresh load can be swallowed by nav settle */
    await sleep(10000);
    if (!(pullState() || {}).running) { console.log('re-clicking once (first click swallowed by nav settle)'); btn.click(); t0 = Date.now(); }
    var settle = await waitSettle();
    var run = {
      at: new Date().toISOString(),
      startToSettleMs: Date.now() - t0,
      barResets: settle.barResets, timedOut: settle.timedOut === true,
      state: pullState(),
      receipts: receipts(),
      ledgerBefore: before,
      ledgerAfter: dayLedger(day || ''),
      lease: leaseState()
    };
    var hr = (run.receipts && run.receipts.history) || {};
    var n = Number(hr.requested || 0);
    run.secondsPerPatient = n ? Math.round(run.startToSettleMs / n / 100) / 10 : null;
    OUT.runs.push(run);
    console.log('RUN', run);
    console.log('--- the six numbers ---');
    console.log('  settle              ', run.startToSettleMs + 'ms', run.secondsPerPatient ? ('(' + run.secondsPerPatient + 's/patient)') : '');
    console.log('  N                   ', n);
    console.log('  findReasons         ', hr.findReasons, ' noMatchingPatient', hr.noMatchingPatient);
    console.log('  todayNoteFailures   ', hr.todayNoteFailures, ' reasons', hr.todayNoteReasons, ' skipped', hr.todayNoteSkipped, ' msMax', hr.todayNoteMsMax);
    console.log('  store               ', 'contentVerified', hr.contentVerified, 'contentGap', hr.contentGap, 'census', hr.storeCensus, 'verdict', hr.storeVerdict);
    console.log('  calendar snapshot   ', (run.receipts.calendar || {}).snapshotPublished, (run.receipts.calendar || {}).snapshotReason);
    console.log('  retry rounds (bar resets, MUST be 0)', run.barResets);
    return run;
  }

  /* ---- STEP 2: STOP mid-pull, then check that nothing is latched -------- */
  async function stopTest(afterMs) {
    var btn = el('mlsDsPullBtn');
    if (!btn) { console.error('no #mlsDsPullBtn'); return null; }
    btn.click();
    await sleep(Number(afterMs || 45000));
    var during = pullState();
    /* press the real Stop control if the panel is up; otherwise the API */
    var stopBtn = el('mlsPullProgStop');
    if (stopBtn) stopBtn.click();
    else { try { window.__mlsSI.stopPull(); } catch (e) {} }
    var settle = await waitSettle(10 * 60000);
    await sleep(4000);
    var after = {
      during: during,
      stoppedAfterMs: settle.settledMs,
      state: pullState(),
      receipts: receipts(),
      lease: leaseState(),
      pullBtnEnabled: !!(el('mlsDsPullBtn') && !el('mlsDsPullBtn').disabled)
    };
    var hr = (after.receipts && after.receipts.history) || {};
    after.PASS = {
      honestPartial: String(after.receipts.reason || '') !== '' && hr.stoppedByUser === true,
      leaseFree: after.lease.lease ? !after.lease.busy : true,
      pageLeaseFree: after.lease.pageLease === false,
      loanWithdrawn: after.lease.loan === false,
      busyStampCleared: Number(after.lease.busyAt || 0) === 0,
      noDeferredRound: !after.lease.deferredNotes || Number(after.lease.deferredNotes.queued || 0) === 0,
      buttonUsable: after.pullBtnEnabled
    };
    OUT.stop = after;
    console.log('STOP', after);
    console.log('STOP PASS FLAGS (all must be true):', after.PASS);
    return after;
  }

  function report() {
    var r = JSON.stringify(OUT, null, 1);
    console.log(r);
    try { if (navigator.clipboard) navigator.clipboard.writeText(r); } catch (e) {}
    return r;
  }

  window.MLS_LIVE = { frame: frame, pull: pull, stopTest: stopTest, report: report,
    state: pullState, receipts: receipts, ledger: dayLedger, lease: leaseState, _out: OUT };
  console.log('MLS_LIVE ready. Run MLS_LIVE.frame() first, then await MLS_LIVE.pull().');
})();

/* -----------------------------------------------------------------------------
 * PASS CRITERIA for this lane (all PHI-free, all from the numbers above)
 *
 *  dnd-1.0.0  history.todayNoteReasons has NO 'no-day-on-row' entry.
 *  fd-1.0.0   pulling a FUTURE day: todayNoteFailures 0, todayNoteSkipped == N,
 *             todayNoteMsTotal 0. Pulling TODAY or a PAST day: the note IS read.
 *  bob-1.0.0  on a provider-unknown census day: history.requested > 0 and the
 *             status line says "Appointment census + history".
 *  cvc-1.0.0  barResets === 0 - the bar never restarts, there is one verdict.
 *  fdx-1.0.0  if any row fails to open, findReasons names WHICH of no-results /
 *             no-name-match / blank-error / rows-not-rendered it was.
 *  scv-1.0.0  a "complete" verdict implies storeCensus.measured === true and
 *             storeCensus.withContent > 0. contentVerified/contentGap reported.
 *  stp-2.0.0  every flag in STOP PASS FLAGS is true.
 *  rsk-1.0.0  a SECOND pull of the same day the same day shows
 *             history.chartsSkippedVerifiedToday > 0 and a shorter settle.
 *             A/B it with window.__mlsP1SkipVerifiedToday = false.
 *  U0         on the CALENDAR hero (#mlsCvNxt_calendar) the bar must LEAVE 3%.
 *
 * Log counts/states/seconds only into tests/live-e2e-artifacts/ - no keys,
 * no names, no DOBs.
 * -------------------------------------------------------------------------- */
