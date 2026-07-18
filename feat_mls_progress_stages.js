/* =============================================================================
 * MLS named-stage progress wiring + panel (ps-1.0.0)
 *
 * Builds ON the shared request-owned progress owner (__mlsLoadingCalm,
 * lb-2.0.0 by Codex) — this module creates NO parallel framework. It does two
 * things:
 *
 *  1. OBSERVER: a read-only listener on the existing app<->extension
 *     postMessage bridge that turns real protocol evidence into named lb jobs
 *     with real stages, item counts, and provider/date/patient context:
 *       - Athena connect / reconnect        (mlsPing / mlsPong)
 *       - Loading the schedule              (mlsAppPullSchedule / ...Result
 *                                            + receipt counts, partial-honest)
 *       - Finding patients / pulling history (mlsAppReadChart / ReadVisits /
 *                                            ChartResult / GoHome rhythm)
 *       - Review screen                     (mlsAppReviewScreen / ...Result)
 *       - Staging a write                   (mlsAppAthenaActionV2 probe /
 *                                            confirm-wait / execute / verify)
 *       - Teach destination                 (mlsAppTeachStart / ...Progress)
 *     It never wraps or edits any flow owner's code, and it never invents
 *     progress: stages advance only on observed messages, counts come from
 *     receipts/payloads, and lb refuses percentages without a real total.
 *
 *  2. PANEL: an expandable progress panel (chip above the lb pill) rendering
 *     lb's own job store — per-job stage checklist, "N of M" counts, patient/
 *     provider/date, elapsed time, a stale-heartbeat line when an active job
 *     has had no update for 15s (no frozen spinners pretending to work), and
 *     honest terminal chips (completed / partial / failed / canceled /
 *     timed_out) with lb's cancel where the job allows it.
 *
 * Flow owners can enrich observer jobs via the small adapter API:
 *   window.__mlsProgressStages.expect('history', { total: 7 })   // "N of 7"
 *   window.__mlsProgressStages.note('schedule', 'Matching patients', {...})
 *
 * Fail-open: if lb-2.0.0 is absent nothing installs a UI and every call
 * no-ops. Idle pages own no timers (tick only while the panel shows an
 * active job; the history quiet-timer only exists mid-pull).
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsProgressStages && window.__mlsProgressStages.installed) return;

  var VERSION = 'ps-1.1.0';
  var CHIP_ID = 'mlsPsChip', PANEL_ID = 'mlsPsPanel', CSS_ID = 'mlsPsCss';
  var STALE_AFTER_MS = 15000;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function now() { return Date.now(); }
  function text(v, max) { v = v == null ? '' : String(v); return v.slice(0, max || 160); }
  function lb() {
    var l = window.__mlsLoadingCalm;
    return (l && l.installed && typeof l.start === 'function' && typeof l.update === 'function') ? l : null;
  }

  /* ------------------------------------------------------------------ *
   * Flow catalog — the real named stages per flow.                      *
   * ------------------------------------------------------------------ */
  var FLOWS = {
    connect: {
      key: 'athena:connect', kind: 'athena_connect', label: 'Connecting to Athena',
      stages: ['Contacting the MLS Assist extension', 'Confirming your signed-in Athena tab'],
      timeoutMs: 20000
    },
    reconnect: {
      key: 'athena:reconnect', kind: 'athena_connect', label: 'Reconnecting to Athena',
      stages: ['Waiting for the MLS Assist extension to answer'],
      timeoutMs: 45000
    },
    schedule: {
      key: 'schedule:pull', kind: 'schedule_pull', label: 'Loading the schedule',
      stages: ['Reading the schedule day in Athena', 'Matching patients to your records'],
      timeoutMs: 90000
    },
    history: {
      key: 'history:pull', kind: 'history_pull', label: 'Pulling patient history',
      stages: ['Opening charts in Athena', 'Reading each chart', 'Analyzing pulled history'],
      timeoutMs: 20 * 60000
    },
    review: {
      key: 'review:screen', kind: 'review_screen', label: 'Review before writing',
      stages: ['Classifying proposed content', 'Waiting for your review'],
      timeoutMs: 10 * 60000
    },
    staging: {
      key: 'athena:staging', kind: 'athena_write', label: 'Staging an Athena write',
      stages: ['Verifying patient identity', 'Locking the exact encounter', 'Waiting for your confirmation', 'Writing to Athena', 'Verifying the write landed'],
      timeoutMs: 4 * 60000
    },
    teach: {
      key: 'teach:destination', kind: 'teach_destination', label: 'Teaching a destination',
      stages: ['Arming the read-only Athena watcher', 'Waiting for your teaching click in Athena', 'Validating the destination'],
      timeoutMs: 90000
    }
  };

  /* handle bookkeeping: flowName -> { handle, meta } while a job is active */
  var live = {};
  function ensure(flowName, opts) {
    var api = lb(), flow = FLOWS[flowName];
    if (!api || !flow) return null;
    opts = opts || {};
    var cur = live[flowName];
    if (cur && cur.handle && api.isCurrent(flow.key, cur.handle.requestId)) {
      /* already running — enrich context only */
      var patch = {};
      ['patient', 'provider', 'selectedDate'].forEach(function (k) { if (opts[k]) patch[k] = text(opts[k], 100); });
      if (Object.keys(patch).length) cur.handle.stage(api.get(cur.handle.id).stage, patch);
      return cur;
    }
    var handle = api.start({
      key: flow.key, kind: flow.kind, label: flow.label, stages: flow.stages,
      timeoutMs: flow.timeoutMs, replace: opts.replace === true,
      total: Math.max(0, Number(opts.total) || 0),
      patient: text(opts.patient, 100), provider: text(opts.provider, 100), selectedDate: text(opts.selectedDate, 40),
      cancelable: false
    });
    live[flowName] = { handle: handle, meta: { startedAt: now(), requestId: text(opts.requestId, 128), phase: '', count: 0, fail: 0, expectTotal: Math.max(0, Number(opts.total) || 0) } };
    return live[flowName];
  }
  function activeFlow(flowName) {
    var api = lb(), flow = FLOWS[flowName], cur = live[flowName];
    if (!api || !flow || !cur || !cur.handle) return null;
    return api.isCurrent(flow.key, cur.handle.requestId) ? cur : null;
  }
  function stage(flowName, stageName, patch) {
    var cur = activeFlow(flowName);
    if (cur) cur.handle.stage(stageName, patch || {});
    return cur;
  }
  function finish(flowName, how, message, current) {
    var cur = activeFlow(flowName);
    if (!cur) return;
    if (how === 'partial') cur.handle.partial(message, current);
    else if (how === 'fail') cur.handle.fail({ message: message });
    else cur.handle.complete(message);
    delete live[flowName];
  }

  /* ------------------------------------------------------------------ *
   * Honest reason mapping for staging failures.                         *
   * ------------------------------------------------------------------ */
  function reasonText(reason, fallback) {
    var map = {
      'write-safety-final-action-blocked': 'Preview-only by write-safety policy — do the final step yourself in athenaOne.',
      'patient-mismatch': 'The open Athena chart is a different patient. Nothing was changed.',
      'context-mismatch': 'The exact visit/encounter could not be matched. Nothing was changed.',
      'practice-mismatch': 'The open Athena tab is a different practice. Nothing was changed.',
      'token-expired': 'The confirmation window expired — start the action again.',
      'fresh-trusted-click-required': 'Click the action button again to confirm.',
      'extension-error': 'MLS Assist was updated or reloaded and this tab lost its connection. Refresh this MLS tab (Ctrl+R), then run the pull again.',
      'no-athena-tab': 'Open one signed-in Athena tab, then retry.',
      'ambiguous-athena-tabs': 'More than one Athena tab is open — leave exactly one, then retry.',
      'outcome-uncertain': 'Could not verify the outcome — check Athena before relying on it.'
    };
    if (/^extension error\b/i.test(String(fallback || ''))) return map['extension-error'];
    return map[String(reason || '')] || fallback || ('Blocked: ' + text(reason || 'unknown', 60));
  }
  /* ps-1.1.0: translate the reader's technical zero-row template into plain
     language (live 2026-07-18: "Athena showed 0 appointment rows, but MLS
     could verify only 0" reads as nonsense to a doctor). */
  function clarifySchedError(raw) {
    var t = String(raw || '');
    if (/Athena showed 0 appointment rows/i.test(t)) {
      return 'Athena’s Day schedule showed no readable appointment rows — the grid may still be loading, or athenaOne is signed out. Open the Athena tab, make sure it is signed in and on the Day schedule, then retry.';
    }
    var m = t.match(/Athena showed (\d+) appointment rows?, but MLS could verify only (\d+)/i);
    if (m) {
      return 'Athena listed ' + m[1] + ' appointment' + (m[1] === '1' ? '' : 's') + ' but only ' + m[2] + ' could be verified before the view changed. Keep Athena on this day until the grid finishes loading, then retry.';
    }
    return t;
  }

  /* ------------------------------------------------------------------ *
   * Connection state (ping/pong evidence).                              *
   * ------------------------------------------------------------------ */
  var conn = { lastPing: 0, lastPong: 0, everConnected: false, pingTimer: null, autoConnects: 0 };
  function onPing() {
    conn.lastPing = now();
    var silent = !conn.lastPong || (now() - conn.lastPong > 90000);
    if (silent && !activeFlow('connect') && !activeFlow('reconnect')) {
      /* ps-1.0.1 (Codex-flagged): on a device that has NEVER had the extension
         answer, every background ping used to spawn a doomed 20s "Connecting
         to Athena" job that timed out and was immediately recreated — an
         endless passive loop on phones / extension-less machines. Rules:
         relay/phone devices never auto-spawn a local connect job (their pulls
         run on the office computer by design), and elsewhere we stop after 2
         consecutive doomed auto-jobs; any real pong re-arms everything. */
      if (!conn.everConnected) {
        try { var rl = window.__mlsRelayLink; if (rl && typeof rl.shouldRelay === 'function' && rl.shouldRelay()) return; } catch (e) {}
        try { var dr = window.__mlsDeviceRole; if (dr && typeof dr.effectiveRole === 'function' && dr.effectiveRole() === 'phone') return; } catch (e) {}
        if (conn.autoConnects >= 2) return;
        conn.autoConnects++;
      }
      if (conn.everConnected) ensure('reconnect', {});
      else ensure('connect', {});
    }
    if (conn.pingTimer) clearTimeout(conn.pingTimer);
    conn.pingTimer = setTimeout(function () {
      conn.pingTimer = null;
      /* ping unanswered: keep the job honest — it will hit its own lb deadline
         (timed_out) if the extension never answers; nothing fakes progress. */
      var cur = activeFlow('connect');
      if (cur) cur.handle.stage('Confirming your signed-in Athena tab', { operation: 'No answer yet — is the MLS Assist extension enabled?' });
    }, 6000);
  }
  function onPong(d) {
    conn.lastPong = now(); conn.everConnected = true; conn.autoConnects = 0;
    if (conn.pingTimer) { clearTimeout(conn.pingTimer); conn.pingTimer = null; }
    var v = text(d && d.version, 20);
    finish('connect', 'complete', 'Connected' + (v ? ' — MLS Assist v' + v : '') + '.');
    finish('reconnect', 'complete', 'Reconnected' + (v ? ' — MLS Assist v' + v : '') + '.');
  }

  /* ------------------------------------------------------------------ *
   * History-pull session (chart-read rhythm).                           *
   * ------------------------------------------------------------------ */
  var hist = { quietTimer: null };
  function historyFinish() {
    hist.quietTimer = null;
    var cur = activeFlow('history');
    if (!cur) return;
    var n = cur.meta.count, bad = cur.meta.fail;
    if (!n && !bad) { finish('history', 'complete', 'No charts were read.'); return; }
    /* ps-1.1.0 clarity: when EVERY chart failed, the cause is almost never
       per-patient — say where to look instead of a bare count (live
       2026-07-18: "Read 0 of 1 — 1 failed" gave the doctor nothing). */
    if (bad) finish('history', 'partial', 'Read ' + (n - bad) + ' of ' + n + ' charts — ' + bad + ' failed.' +
      (bad >= n ? ' Every chart failed, which usually means the Athena side: check the Athena tab is SIGNED IN, is the only Athena tab open, and shows the schedule — then retry the failed patients.' : ' Retry the failed patients when ready.'), n - bad);
    else finish('history', 'complete', 'Read ' + n + ' chart' + (n === 1 ? '' : 's') + '.');
  }
  function historyTouch(chartDelta, operation, patient) {
    var cur = activeFlow('history') || ensure('history', {});
    if (!cur) return;
    cur.meta.count += chartDelta;
    var patch = { operation: text(operation, 160) };
    if (patient) patch.patient = text(patient, 100);
    if (chartDelta > 0) {
      var total = cur.meta.expectTotal;
      cur.handle.progress(cur.meta.count, total > 0 ? total : 0,
        'Reading chart ' + cur.meta.count + (total > 0 ? ' of ' + total : '') + (patient ? ' — ' + text(patient, 60) : ''));
      cur.handle.stage('Reading each chart', patch.patient ? { patient: patch.patient } : {});
    } else if (operation) {
      cur.handle.stage(lb() ? lb().get(cur.handle.id).stage : 'Reading each chart', patch);
    }
    if (hist.quietTimer) clearTimeout(hist.quietTimer);
    hist.quietTimer = setTimeout(function () {
      /* the trailing quiet window is when app-side analysis runs */
      var still = activeFlow('history');
      if (still && still.meta.count > 0) still.handle.stage('Analyzing pulled history', {});
      setTimeout(historyFinish, 3000);
    }, 12000);
  }
  function chartPatient(d) {
    return text((d && (d.name || (d.patient && d.patient.name) || (d.want && d.want.name) || (d.params && d.params.name))) || '', 100);
  }

  /* ------------------------------------------------------------------ *
   * Schedule pull.                                                       *
   * ------------------------------------------------------------------ */
  var sched = { graceTimer: null };
  function onScheduleRequest(d) {
    ensure('schedule', {
      replace: true,
      requestId: d && d.requestId,
      selectedDate: (d && (d.day || d.date || d.schedDate)) || '',
      provider: (d && d.provider) || ''
    });
    stage('schedule', 'Reading the schedule day in Athena', {});
  }
  function onScheduleResult(d) {
    var cur = activeFlow('schedule');
    if (!cur) return;
    var sr = (d && d.resp) || d || {};
    /* stale-response honesty: if the request was correlated, only its own
       result may advance the job */
    var rid = text(d && d.requestId || sr.requestId, 128);
    if (cur.meta.requestId && rid && cur.meta.requestId !== rid) return;
    if (sr.error || sr.ok === false || sr.blocked) {
      finish('schedule', 'fail', reasonText(sr.reason, clarifySchedError(text(sr.error || 'The schedule could not be read.', 300))));
      return;
    }
    var appts = Array.isArray(sr.appts) ? sr.appts.length : 0;
    var receipt = sr.receipt || {};
    var expected = Math.max(0, Number(receipt.expectedCount) || 0) || appts;
    var parsed = Math.max(0, Number(receipt.parsedCount) || 0) || appts;
    var day = text(sr.schedDate, 40);
    if (day) cur.handle.stage('Matching patients to your records', { selectedDate: day });
    else cur.handle.stage('Matching patients to your records', {});
    if (expected > 0) cur.handle.progress(Math.min(parsed, expected), expected, 'Importing appointments');
    if (sched.graceTimer) clearTimeout(sched.graceTimer);
    sched.graceTimer = setTimeout(function () {
      sched.graceTimer = null;
      var stillMine = activeFlow('schedule');
      if (!stillMine) return;
      if (receipt.complete === false || (expected > 0 && parsed < expected && receipt.authoritativeEmpty !== true)) {
        finish('schedule', 'partial', 'Imported ' + parsed + ' of ' + expected + ' expected appointments' + (day ? ' for ' + day : '') + '. Retry the pull when ready.', parsed);
      } else {
        finish('schedule', 'complete', 'Schedule loaded — ' + appts + ' appointment' + (appts === 1 ? '' : 's') + (day ? ' for ' + day : '') + '.');
      }
    }, 1800);
  }

  /* ------------------------------------------------------------------ *
   * Staging (supervised V2 write) + review + teach.                     *
   * ------------------------------------------------------------------ */
  function onActionRequest(d) {
    var mode = String((d && d.mode) || '').toLowerCase();
    var p = (d && (d.expectedPatient || d.patient)) || {};
    var c = (d && (d.expectedContext || d.context)) || {};
    if (mode === 'probe') {
      var cur = ensure('staging', { replace: true, requestId: d && d.requestId, patient: p.name, provider: c.provider, selectedDate: c.visitDate });
      if (cur) { cur.meta.phase = 'probe'; stage('staging', 'Verifying patient identity', {}); }
    } else if (mode === 'execute') {
      var run = activeFlow('staging') || ensure('staging', { patient: p.name, provider: c.provider, selectedDate: c.visitDate });
      if (run) { run.meta.phase = 'execute'; stage('staging', 'Writing to Athena', {}); }
    }
  }
  function onActionResult(d) {
    var cur = activeFlow('staging');
    if (!cur) return;
    var r = (d && d.resp) || {};
    if (cur.meta.phase === 'probe') {
      if (r.ok && (r.readOnly || r.actionToken || r.contextVerified || r.context)) {
        stage('staging', 'Locking the exact encounter', {});
        stage('staging', 'Waiting for your confirmation', { operation: 'Nothing is written until you confirm.' });
        cur.meta.phase = 'locked';
      } else {
        finish('staging', 'fail', reasonText(r.reason, text(r.error || 'The encounter could not be locked.', 200)));
      }
      return;
    }
    /* execute result */
    if (r.ok && (r.verified === true || r.written === true || r.saved === true)) {
      stage('staging', 'Verifying the write landed', {});
      finish('staging', 'complete', 'Written and verified in Athena.');
    } else if (r.blocked) {
      finish('staging', 'fail', reasonText(r.reason, text(r.error || 'Blocked before anything was written.', 200)));
    } else if (r.attempted) {
      finish('staging', 'partial', reasonText(r.reason, 'Attempted, but the outcome could not be verified — check Athena before relying on it.'));
    } else {
      finish('staging', 'fail', reasonText(r.reason, text(r.error || 'The write did not run.', 200)));
    }
  }
  function onReviewOpen(d) {
    var manifest = (d && d.manifest) || {};
    var items = Array.isArray(manifest.items) ? manifest.items.length : 0;
    var p = manifest.patient || {};
    var cur = ensure('review', { replace: true, patient: p.name });
    if (!cur) return;
    stage('review', 'Classifying proposed content', { operation: items ? items + ' proposed item' + (items === 1 ? '' : 's') : '' });
    stage('review', 'Waiting for your review', { operation: items ? items + ' proposed item' + (items === 1 ? '' : 's') : '' });
  }
  function onReviewResult(d) {
    var r = (d && d.resp) || {};
    if (r.confirmed === true) {
      var n = Array.isArray(r.selected) ? r.selected.length : 0;
      finish('review', 'complete', 'Confirmed ' + n + ' note section' + (n === 1 ? '' : 's') + ' for writing' + (r.blocked && r.blocked.length ? ' — ' + r.blocked.length + ' preview-only item' + (r.blocked.length === 1 ? '' : 's') + ' stay manual' : '') + '.');
    } else if (r.ok === false) {
      finish('review', 'fail', text(r.error || 'The review screen could not be shown.', 200));
    } else {
      finish('review', 'complete', 'Review closed — nothing was written.');
    }
  }
  function onTeachStart(d) {
    var p = (d && (d.patient || d.expectedPatient)) || {};
    ensure('teach', { replace: true, requestId: d && d.requestId, patient: p.name });
    stage('teach', 'Arming the read-only Athena watcher', {});
  }
  function onTeachProgress(d) {
    var r = (d && d.resp) || {};
    var st = String(r.state || '').toLowerCase();
    if (st === 'waiting' || st === 'connected') stage('teach', 'Waiting for your teaching click in Athena', {});
    else if (st === 'captured') finish('teach', 'complete', 'Destination captured and validated.');
    else if (st === 'expired') finish('teach', 'fail', text(r.message || 'The watcher expired — click Teach destination again.', 200));
    else if (st === 'failed') finish('teach', 'fail', text(r.message || 'Teaching failed. Nothing was captured.', 200));
  }

  /* ------------------------------------------------------------------ *
   * The observer itself.                                                *
   * ------------------------------------------------------------------ */
  function onMessage(e) {
    var d = e && e.data;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;
    safe(function () {
      if (d.source === 'mls-app') {
        if (d.type === 'mlsPing') onPing();
        else if (d.type === 'mlsAppPullSchedule' || d.type === 'mlsAppPullMonth') onScheduleRequest(d);
        else if (d.type === 'mlsAppReadChart') historyTouch(1, '', chartPatient(d));
        else if (d.type === 'mlsAppReadVisits') historyTouch(0, 'Reading the visits list', chartPatient(d));
        else if (d.type === 'mlsAppGoHome') { if (activeFlow('history')) historyTouch(0, 'Returning to the schedule'); }
        else if (d.type === 'mlsAppAthenaActionV2') onActionRequest(d);
        else if (d.type === 'mlsAppReviewScreen') onReviewOpen(d);
        else if (d.type === 'mlsAppTeachStart') onTeachStart(d);
        return;
      }
      if (d.source === 'mls-ext') {
        if (d.type === 'mlsPong') { onPong(d); return; }
        /* any extension traffic proves the link is alive */
        if (activeFlow('reconnect')) finish('reconnect', 'complete', 'Reconnected.');
        conn.lastPong = conn.lastPong || now();
        if (d.type === 'mlsAppScheduleResult') onScheduleResult(d);
        else if (d.type === 'mlsAppChartResult') {
          var resp = d.resp || d;
          var cur = activeFlow('history');
          if (cur && (resp.error || resp.blocked)) cur.meta.fail++;
          if (cur) historyTouch(0, resp.error ? 'A chart read failed — continuing' : 'Chart received');
        }
        else if (d.type === 'mlsAppAthenaActionV2Result') onActionResult(d);
        else if (d.type === 'mlsAppReviewScreenResult') onReviewResult(d);
        else if (d.type === 'mlsAppTeachProgress') onTeachProgress(d);
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * Panel UI (renders lb's job store — the single source of truth).     *
   * ------------------------------------------------------------------ */
  var panelOpen = false, tickIv = 0;
  function css() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style'); st.id = CSS_ID;
    st.textContent = [
      '#' + CHIP_ID + '{position:fixed;right:16px;bottom:76px;z-index:99969;display:none;align-items:center;gap:7px;background:#fff;border:1px solid #E7E5DD;border-radius:999px;padding:7px 12px;font:700 12px "Public Sans",system-ui,sans-serif;color:#234334;box-shadow:0 1px 2px rgba(20,33,28,.06),0 8px 24px rgba(20,33,28,.12);cursor:pointer}',
      '#' + CHIP_ID + '.on{display:inline-flex}',
      '#' + CHIP_ID + ' .ps-dot{width:8px;height:8px;border-radius:50%;background:#2E6A4B;animation:mlsPsPulse 1.2s ease infinite}',
      '#' + CHIP_ID + '.idle .ps-dot{animation:none;background:#8A9590}',
      '@keyframes mlsPsPulse{50%{opacity:.35}}',
      '#' + PANEL_ID + '{position:fixed;right:16px;bottom:118px;z-index:99968;width:min(400px,calc(100vw - 28px));max-height:min(520px,calc(100vh - 150px));overflow-y:auto;background:#FDFCF9;border:1px solid #E7E5DD;border-radius:16px;box-shadow:0 2px 4px rgba(20,33,28,.08),0 18px 48px rgba(20,33,28,.18);font:500 12.5px "Public Sans",system-ui,sans-serif;color:#1A211C;display:none}',
      '#' + PANEL_ID + '.on{display:block}',
      '#' + PANEL_ID + ' .ps-hd{position:sticky;top:0;background:#F6F3EC;border-bottom:1px solid #E7E5DD;padding:10px 14px;font-weight:800;font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#4B564F;display:flex;justify-content:space-between;align-items:center}',
      '#' + PANEL_ID + ' .ps-hd button{border:none;background:none;font:700 14px inherit;color:#66716A;cursor:pointer;padding:0 2px}',
      '#' + PANEL_ID + ' .ps-job{padding:11px 14px;border-bottom:1px solid #EFEDE5}',
      '#' + PANEL_ID + ' .ps-job:last-child{border-bottom:none}',
      '#' + PANEL_ID + ' .ps-top{display:flex;align-items:center;gap:8px;justify-content:space-between}',
      '#' + PANEL_ID + ' .ps-label{font-weight:700;font-size:13px}',
      '#' + PANEL_ID + ' .ps-chipst{font-size:10.5px;font-weight:800;letter-spacing:.03em;text-transform:uppercase;padding:2px 8px;border-radius:999px;white-space:nowrap}',
      '#' + PANEL_ID + ' .ps-chipst.running,#' + PANEL_ID + ' .ps-chipst.retrying,#' + PANEL_ID + ' .ps-chipst.queued{background:#E3F0E9;color:#1F5138}',
      '#' + PANEL_ID + ' .ps-chipst.completed{background:#DCFCE7;color:#166534}',
      '#' + PANEL_ID + ' .ps-chipst.partial{background:#FEF3C7;color:#92400E}',
      '#' + PANEL_ID + ' .ps-chipst.failed,#' + PANEL_ID + ' .ps-chipst.timed_out{background:#FEE2E2;color:#991B1B}',
      '#' + PANEL_ID + ' .ps-chipst.canceled{background:#EDEDEA;color:#57605A}',
      '#' + PANEL_ID + ' .ps-ctx{color:#66716A;font-size:11.5px;margin-top:3px}',
      '#' + PANEL_ID + ' .ps-stages{margin:7px 0 0;padding:0;list-style:none}',
      '#' + PANEL_ID + ' .ps-stages li{display:flex;gap:7px;align-items:baseline;padding:2px 0;color:#66716A}',
      '#' + PANEL_ID + ' .ps-stages li.done{color:#3E4A43}',
      '#' + PANEL_ID + ' .ps-stages li.cur{color:#1A211C;font-weight:700}',
      '#' + PANEL_ID + ' .ps-mk{width:13px;text-align:center;flex:none}',
      '#' + PANEL_ID + ' .ps-count{margin-top:5px;font-weight:700;color:#234334}',
      '#' + PANEL_ID + ' .ps-stale{margin-top:5px;color:#92400E;font-weight:600}',
      '#' + PANEL_ID + ' .ps-msg{margin-top:5px;color:#3E4A43}',
      '#' + PANEL_ID + ' .ps-act{margin-top:7px;display:flex;gap:6px}',
      '#' + PANEL_ID + ' .ps-act button{border:1px solid #D9E2DC;background:#fff;color:#234334;border-radius:8px;padding:5px 10px;font:700 11px inherit;cursor:pointer}',
      '#' + PANEL_ID + ' .ps-empty{padding:18px 14px;color:#66716A;text-align:center}',
      '@media (max-width:760px){#' + CHIP_ID + '{right:10px;bottom:128px}#' + PANEL_ID + '{right:10px;bottom:168px}}',
      '@media (prefers-reduced-motion:reduce){#' + CHIP_ID + ' .ps-dot{animation:none}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }
  function chip() {
    var c = document.getElementById(CHIP_ID); if (c) return c;
    css(); c = document.createElement('button'); c.id = CHIP_ID; c.type = 'button';
    c.setAttribute('aria-label', 'Show progress details');
    c.innerHTML = '<span class="ps-dot"></span><span class="ps-n">Progress</span>';
    c.addEventListener('click', function () { setPanel(!panelOpen); });
    (document.body || document.documentElement).appendChild(c); return c;
  }
  function panel() {
    var p = document.getElementById(PANEL_ID); if (p) return p;
    css(); p = document.createElement('div'); p.id = PANEL_ID; p.setAttribute('role', 'log'); p.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).appendChild(p); return p;
  }
  function setPanel(open) { panelOpen = !!open; render(); }
  function elapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    return s < 60 ? s + 's' : Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  }
  var ACTIVE_STATUS = { queued: 1, running: 1, retrying: 1 };
  function render() {
    var api = lb(); if (!api || typeof document === 'undefined' || !document.createElement) return;
    var jobsAll = safe(function () { return api.snapshot(); }, []) || [];
    var activeN = jobsAll.filter(function (j) { return ACTIVE_STATUS[j.status]; }).length;
    var recent = jobsAll.filter(function (j) { return ACTIVE_STATUS[j.status] || (now() - (j.finishedAt || j.updatedAt) < 90000); });
    var c = chip();
    if (recent.length) {
      c.classList.add('on');
      c.classList[activeN ? 'remove' : 'add']('idle');
      var lbl = c.querySelector('.ps-n');
      if (lbl) lbl.textContent = activeN ? (activeN + ' running') : 'Progress';
    } else { c.classList.remove('on'); if (panelOpen) panelOpen = false; }
    var p = panel();
    if (!panelOpen) { p.classList.remove('on'); syncTick(activeN); return; }
    p.classList.add('on');
    p.innerHTML = '';
    var hd = document.createElement('div'); hd.className = 'ps-hd';
    hd.innerHTML = '<span>Progress</span>';
    var x = document.createElement('button'); x.type = 'button'; x.textContent = '✕'; x.setAttribute('aria-label', 'Close progress panel');
    x.addEventListener('click', function () { setPanel(false); });
    hd.appendChild(x); p.appendChild(hd);
    if (!jobsAll.length) {
      var em = document.createElement('div'); em.className = 'ps-empty'; em.textContent = 'Nothing running.'; p.appendChild(em);
    }
    /* ps-1.1.0 QoL: a dozen identical failed runs (e.g. every auto-pull from a
       tab whose bridge was orphaned by an extension reload) stacked a dozen
       identical cards. Collapse same label+status+message terminal neighbors
       into one card with an honest repeat count. */
    var groupedJobs = [];
    jobsAll.forEach(function (j) {
      var prev = groupedJobs[groupedJobs.length - 1];
      var sig = (j.label || j.kind || '') + '|' + j.status + '|' + (j.message || '');
      if (prev && !ACTIVE_STATUS[j.status] && !ACTIVE_STATUS[prev.status] && prev._sig === sig) { prev._dupes += 1; return; }
      j._sig = sig; j._dupes = 1; groupedJobs.push(j);
    });
    groupedJobs.slice(0, 8).forEach(function (j) {
      var row = document.createElement('div'); row.className = 'ps-job';
      var top = document.createElement('div'); top.className = 'ps-top';
      var label = document.createElement('span'); label.className = 'ps-label'; label.textContent = j.label || j.kind || 'Working';
      var st = document.createElement('span'); st.className = 'ps-chipst ' + j.status; st.textContent = String(j.status || '').replace('_', ' ');
      top.appendChild(label); top.appendChild(st); row.appendChild(top);
      var bits = [];
      if (j.patient) bits.push(j.patient);
      if (j.provider) bits.push(j.provider);
      if (j.selectedDate) bits.push(j.selectedDate);
      bits.push(elapsed((j.finishedAt || now()) - j.startedAt) + (ACTIVE_STATUS[j.status] ? ' elapsed' : ''));
      if (j.attempt > 1) bits.push('attempt ' + j.attempt + (j.maxAttempts > 1 ? ' of ' + j.maxAttempts : ''));
      if (j._dupes > 1) bits.push('repeated ' + j._dupes + ' times');
      var ctx = document.createElement('div'); ctx.className = 'ps-ctx'; ctx.textContent = bits.join(' · '); row.appendChild(ctx);
      if (Array.isArray(j.stages) && j.stages.length) {
        var ul = document.createElement('ul'); ul.className = 'ps-stages';
        j.stages.forEach(function (name, i) {
          var li = document.createElement('li');
          var doneAll = !ACTIVE_STATUS[j.status] && (j.status === 'completed');
          var cls = doneAll || i < j.stageIndex ? 'done' : (ACTIVE_STATUS[j.status] && i === j.stageIndex ? 'cur' : '');
          if (cls) li.className = cls;
          var mk = document.createElement('span'); mk.className = 'ps-mk';
          mk.textContent = doneAll || i < j.stageIndex ? '✓' : (ACTIVE_STATUS[j.status] && i === j.stageIndex ? '●' : '○');
          li.appendChild(mk); li.appendChild(document.createTextNode(name));
          ul.appendChild(li);
        });
        row.appendChild(ul);
      }
      if (j.total > 0) {
        var cnt = document.createElement('div'); cnt.className = 'ps-count';
        cnt.textContent = (j.current || 0) + ' of ' + j.total + (j.percent != null ? ' (' + j.percent + '%)' : '');
        row.appendChild(cnt);
      } else if (j.current > 0 && ACTIVE_STATUS[j.status]) {
        var cnt2 = document.createElement('div'); cnt2.className = 'ps-count';
        cnt2.textContent = j.current + ' so far';
        row.appendChild(cnt2);
      }
      if (j.operation && ACTIVE_STATUS[j.status]) {
        var op = document.createElement('div'); op.className = 'ps-ctx'; op.textContent = j.operation; row.appendChild(op);
      }
      if (ACTIVE_STATUS[j.status] && now() - j.updatedAt > STALE_AFTER_MS) {
        var stale = document.createElement('div'); stale.className = 'ps-stale';
        stale.textContent = 'No update for ' + elapsed(now() - j.updatedAt) + ' — still waiting on Athena. This will time out honestly rather than spin forever.';
        row.appendChild(stale);
      }
      if (!ACTIVE_STATUS[j.status] && j.message) {
        var msg = document.createElement('div'); msg.className = 'ps-msg'; msg.textContent = j.message; row.appendChild(msg);
      }
      if (ACTIVE_STATUS[j.status] && j.cancelable) {
        var act = document.createElement('div'); act.className = 'ps-act';
        var cb = document.createElement('button'); cb.type = 'button'; cb.textContent = 'Cancel';
        cb.addEventListener('click', function () { var a = lb(); if (a) a.cancel(j.id, 'Canceled by user.', j.requestId); });
        act.appendChild(cb); row.appendChild(act);
      }
      p.appendChild(row);
    });
    syncTick(activeN);
  }
  function syncTick(activeN) {
    var want = panelOpen && activeN > 0;
    if (want && !tickIv) tickIv = setInterval(render, 1000);
    else if (!want && tickIv) { clearInterval(tickIv); tickIv = 0; }
  }

  /* ------------------------------------------------------------------ *
   * Install + adapter API.                                              *
   * ------------------------------------------------------------------ */
  window.addEventListener('message', onMessage, false);
  var onJobEvent = function () { safe(render); };
  window.addEventListener('mls:job-progress', onJobEvent, false);

  var api = {
    version: VERSION,
    installed: true,
    flows: FLOWS,
    /* flow owners MAY enrich observer jobs (e.g. a known patient total) */
    expect: function (flowName, opts) {
      opts = opts || {};
      var cur = activeFlow(flowName) || ensure(flowName, opts);
      if (!cur) return false;
      if (opts.total > 0) {
        cur.meta.expectTotal = Math.max(0, Number(opts.total) || 0);
        cur.handle.progress(cur.meta.count, cur.meta.expectTotal, undefined);
      }
      var patch = {};
      ['patient', 'provider', 'selectedDate'].forEach(function (k) { if (opts[k]) patch[k] = text(opts[k], 100); });
      if (Object.keys(patch).length) { var a = lb(); if (a) cur.handle.stage(a.get(cur.handle.id).stage, patch); }
      return true;
    },
    note: function (flowName, stageName, patch) { return !!stage(flowName, stageName, patch); },
    get: function (flowName) {
      var cur = activeFlow(flowName), a = lb();
      return cur && a ? a.get(cur.handle.id) : null;
    },
    panel: { open: function () { setPanel(true); }, close: function () { setPanel(false); }, toggle: function () { setPanel(!panelOpen); } },
    _observe: onMessage, /* exposed for tests: feed synthetic bridge messages */
    revert: function () {
      safe(function () { window.removeEventListener('message', onMessage, false); });
      safe(function () { window.removeEventListener('mls:job-progress', onJobEvent, false); });
      safe(function () { if (tickIv) clearInterval(tickIv); tickIv = 0; });
      safe(function () { if (hist.quietTimer) clearTimeout(hist.quietTimer); });
      safe(function () { if (sched.graceTimer) clearTimeout(sched.graceTimer); });
      safe(function () { if (conn.pingTimer) clearTimeout(conn.pingTimer); });
      safe(function () { [CHIP_ID, PANEL_ID, CSS_ID].forEach(function (id) { var el = document.getElementById(id); if (el && el.remove) el.remove(); }); });
      api.installed = false; delete window.__mlsProgressStages;
    }
  };
  window.__mlsProgressStages = api;
  safe(render);
})();
