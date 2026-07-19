/*! feat_athena_doctor.js — MLS Assistant self-troubleshooting + clearer success
 *  window.__mlsAthenaDoctor (v1.0.3)
 *
 *  WHAT IT DOES (live production medical software — REAL checks only, no fake "all good"):
 *   1. Self-troubleshoot: a step-by-step chain check down the whole Athena pipeline.
 *      Each step is PASS / FAIL / WARN derived from a REAL signal (it reuses the
 *      existing detection/probe functions — it does NOT reinvent detection):
 *        a) MLS Assist extension loaded & responding   -> __mlsAthenaStatusDot.pingExtension()
 *                                                          (mlsPing -> mlsPong handshake)
 *        b) Exact Athena product tab detected           -> mlsExtHealth operational metadata
 *        c) Detected Athena tab is not discarded        -> tab/discarded counts only
 *        d) Background service worker healthy           -> health request received a reply
 *        e) Last user-started chart read receipt         -> supplied explicit result only
 *        f) Last user-started data receipt               -> supplied explicit result only
 *      Runs in order, stops at the first real failure, prints the ONE plain-English fix,
 *      and auto re-checks/re-probes a couple of times where safe before
 *      declaring failure. SAFE auto-fix only: it NEVER reloads his extension and NEVER writes
 *      to Athena — those it instructs the user to do.
 *   2. Clearer success: after any Athena action an explicit honest result line
 *      ("✓ Pulled N visits from athenaOne") with counts, complementing the §58 save-verify
 *      banner (which separately confirms the data actually persisted).
 *   3. Wiring: a "🔧 Troubleshoot Athena" control by the status dot (and clicking the red dot),
 *      AND it auto-opens the diagnostic when a pull/search actually fails — so the user
 *      immediately sees WHY + the fix instead of a vague error.
 *
 *  Self-contained, additive, idempotent, fully reversible: window.__mlsAthenaDoctor.revert().
 *  Diagnostics never request or receive PHI. A ready result means only worker
 *  health plus a usable Athena tab; it never verifies sign-in, patient, encounter,
 *  or chart readability.
 */
(function () {
  'use strict';
  var W = window;
  if (W.__mlsAthenaDoctor && W.__mlsAthenaDoctor.installed) return;

  var VERSION = '1.0.3';
  var ASSET = 'feat_athena_doctor.js';
  var STYLE_ID = 'mls-athena-doctor-style';
  var PANEL_ID = 'mlsAthenaDoctorPanel';
  var BTN_ID = 'mlsAthenaDoctorBtn';
  var TOAST_ID = 'mlsAthenaDoctorToast';

  // ---- tiny helpers -------------------------------------------------------
  function log() { /* deliberately silent — no PHI, no noise */ }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function isPermErr(s) {
    if (!s) return false;
    return /permission|host[_\s-]?perm|cannot access|no access|access to|not allowed|denied|<all_urls>|activeTab|scripting/i.test(String(s));
  }

  // ---- REUSED PROBES (never reinvented) -----------------------------------
  // Extension responding: prefer the status dot's pingExtension, fall back to
  // the app's own __mlsCopyVisits._ping (the same mlsPing->mlsPong handshake).
  function pingExtension() {
    try {
      var sd = W.__mlsAthenaStatusDot;
      if (sd && typeof sd.pingExtension === 'function') return Promise.resolve(sd.pingExtension());
    } catch (e) {}
    try {
      var cv = W.__mlsCopyVisits;
      if (cv && typeof cv._ping === 'function') return Promise.resolve(cv._ping());
    } catch (e) {}
    return Promise.resolve(false);
  }

  // Worker + exact Athena product-tab presence from one PHI-free health reply.
  function healthProbe(timeoutMs) {
    timeoutMs = timeoutMs || 4500;
    return new Promise(function (resolve) {
      var done = false, timer = null;
      var id = 'mlsdx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      function finish(value) {
        if (done) return;
        done = true;
        if (timer != null) { try { clearTimeout(timer); } catch (e) {} }
        try { W.removeEventListener('message', onMsg, true); } catch (e) {}
        resolve(value);
      }
      function onMsg(ev) {
        var d = ev && ev.data;
        if (!d || d.source !== 'mls-ext' || d.type !== 'mlsExtHealthResult') return;
        if (d.requestId && d.requestId !== id) return;
        var r = (d.resp && typeof d.resp === 'object') ? d.resp : d;
        var a = r.athena && typeof r.athena === 'object' ? r.athena : {};
        var tabs = Math.max(0, Number(a.tabs || 0)), discarded = Math.max(0, Number(a.discarded || 0));
        finish({ responded: true, ok: r.ok === true, tabs: tabs, discarded: discarded, usable: r.ok === true && tabs > discarded, error: String(r.reason || r.error || '').slice(0, 120) });
      }
      try { W.addEventListener('message', onMsg, true); } catch (e) {}
      timer = setTimeout(function () { finish({ responded: false, ok: false, tabs: 0, discarded: 0, usable: false, error: '' }); }, timeoutMs);
      try { W.postMessage({ source: 'mls-app', type: 'mlsExtHealth', requestId: id }, '*'); } catch (e) {}
    });
  }

  // ---- THE CHAIN ----------------------------------------------------------
  // status: 'pass' | 'fail' | 'warn' | 'check'
  function blankSteps() {
    return [
      { id: 'ext',   label: 'MLS Assist extension is responding',        status: 'check', detail: '', fix: '' },
      { id: 'tab',   label: 'An exact Athena product tab is detected',   status: 'check', detail: '', fix: '' },
      { id: 'perm',  label: 'A detected Athena tab is loaded',           status: 'check', detail: '', fix: '' },
      { id: 'worker',label: 'Background service worker is healthy',       status: 'check', detail: '', fix: '' },
      { id: 'chart', label: 'Last user-started chart read has a receipt', status: 'check', detail: '', fix: '' },
      { id: 'data',  label: 'Last user-started pull has a data receipt',  status: 'check', detail: '', fix: '' }
    ];
  }

  // lastResult (optional): a captured pull/search result so steps e/f reflect a
  // genuine read. Shape-tolerant: { ok, count, anyReal, stage }.
  function runChain(lastResult, onProgress) {
    var steps = blankSteps();
    function emit() { if (typeof onProgress === 'function') { try { onProgress(steps); } catch (e) {} } }
    var byId = {};
    steps.forEach(function (s) { byId[s.id] = s; });

    return (async function () {
      // ---- a) extension responding (auto-retry: re-ping up to 3x) ----------
      var extOk = false;
      for (var i = 0; i < 3 && !extOk; i++) {
        if (i) await sleep(250);
        try { extOk = !!(await pingExtension()); } catch (e) { extOk = false; }
      }
      if (extOk) {
        byId.ext.status = 'pass';
        byId.ext.detail = 'The extension answered the ping handshake.';
      } else {
        byId.ext.status = 'fail';
        byId.ext.detail = 'No response to the mlsPing handshake after 3 tries.';
        byId.ext.fix = "MLS Assist isn't responding — reload it at chrome://extensions (or install it from Settings → Get the extension), then re-check.";
      }
      emit();

      // If the extension isn't responding, operational tab health is unavailable.
      if (!extOk) {
        ['tab', 'perm', 'worker'].forEach(function (k) {
          byId[k].status = 'warn';
          byId[k].detail = 'Could not check — fix the extension step above first.';
        });
        return finishE_F(steps, byId, lastResult, emit);
      }

      // ---- PHI-free health probe drives b / c / d --------------------------
      var sp = { responded: false, ok: false, tabs: 0, discarded: 0, usable: false, error: '' };
      for (var j = 0; j < 3; j++) {
        if (j) await sleep(400); // give a sleeping MV3 worker a moment to wake
        sp = await healthProbe(4500);
        if (sp.responded) break; // any reply means the worker is alive — stop retrying
      }

      if (!sp.responded) {
        // d) worker dead/stuck: the extension answered the ping but never processed
        // the PHI-free health request across retries.
        byId.worker.status = 'fail';
        byId.worker.detail = 'The extension pings, but the background worker did not answer health after 3 tries.';
        byId.worker.fix = 'Reload MLS Assist at chrome://extensions (the background service worker looks asleep/stuck), then re-check.';
        byId.tab.status = 'warn';  byId.tab.detail = 'Could not check — see the background worker step.';
        byId.perm.status = 'warn'; byId.perm.detail = 'Could not check — see the background worker step.';
        emit();
        return finishE_F(steps, byId, lastResult, emit);
      }

      // worker is alive (it replied)
      byId.worker.status = 'pass';
      byId.worker.detail = 'The background worker answered with operational metadata only.';

      if (!sp.ok) {
        byId.worker.status = 'fail';
        byId.worker.detail = 'The health request returned an extension-worker failure.';
        byId.worker.fix = 'Reload MLS Assist at chrome://extensions, then re-check.';
        byId.tab.status = 'warn'; byId.tab.detail = 'Could not inspect tab metadata until worker health recovers.';
        byId.perm.status = 'warn'; byId.perm.detail = 'Could not inspect discarded-tab metadata.';
      } else if (sp.tabs <= 0) {
        byId.tab.status = 'fail';
        byId.tab.detail = 'No exact Athena product tab was detected.';
        byId.tab.fix = 'Open athenaOne in this browser, then re-check. Sign-in and chart access are verified only when you start a clinical action.';
        byId.perm.status = 'warn';
        byId.perm.detail = 'No detected Athena tab was available to classify as loaded or discarded.';
      } else {
        byId.tab.status = 'pass';
        byId.tab.detail = sp.tabs + ' exact Athena product tab' + (sp.tabs === 1 ? '' : 's') + ' detected; no page or patient data was read.';
        if (sp.usable) {
          byId.perm.status = 'pass';
          byId.perm.detail = (sp.tabs - sp.discarded) + ' detected Athena tab' + ((sp.tabs - sp.discarded) === 1 ? ' is' : 's are') + ' loaded. Patient and encounter are not verified yet.';
        } else {
          byId.perm.status = 'fail';
          byId.perm.detail = 'Every detected Athena tab is discarded by Memory Saver.';
          byId.perm.fix = 'Activate an Athena tab before a clinical action, then re-check.';
        }
      }
      emit();

      return finishE_F(steps, byId, lastResult, emit);
    })();
  }

  // e/f use only a receipt supplied by a prior explicit clinician-started read.
  // Diagnostics themselves never open or inspect a chart.
  function finishE_F(steps, byId, lastResult, emit) {
    if (lastResult && typeof lastResult === 'object') {
      if (lastResult.ok === false && (lastResult.count == null || lastResult.count === 0)) {
        // a real pull/search failed
        byId.chart.status = 'fail';
        byId.chart.detail = lastResult.stage
          ? ('The read failed at: ' + lastResult.stage + '.')
          : 'The prior user-started chart read did not return a success receipt.';
        byId.chart.fix = "Just run the pull again — it opens the patient's chart automatically. If it keeps failing, reload the athenaOne tab, then retry.";
        byId.data.status = 'fail';
        byId.data.detail = 'No real visit data was returned by the last read.';
        byId.data.fix = 'Run the pull again — it auto-opens each patient’s chart and reports the count. If athenaOne looks stuck, reload its tab first.';
      } else if (lastResult.ok) {
        byId.chart.status = 'pass';
        byId.chart.detail = 'The prior user-started chart read returned a success receipt.';
        if (lastResult.anyReal === false) {
          byId.data.status = 'warn';
          byId.data.detail = 'The read completed but no visits had real clinical content.';
          byId.data.fix = 'Run the pull again — it opens each patient’s chart automatically and reads the encounters.';
        } else {
          byId.data.status = 'pass';
          byId.data.detail = (lastResult.count != null)
            ? ('Returned ' + lastResult.count + ' visit(s) with real content.')
            : 'Returned visits with real content.';
        }
      } else {
        markGuidance(byId);
      }
    } else {
      markGuidance(byId);
    }
    if (typeof emit === 'function') emit();
    return summarize(steps);
  }

  function markGuidance(byId) {
    // No genuine read to judge — give honest guidance, not a fake pass/fail.
    byId.chart.status = 'warn';
    byId.chart.detail = 'Not checked passively. Start a clinical pull to verify the exact patient and chart.';
    byId.data.status = 'warn';
    byId.data.detail = 'Run a pull to confirm real data is returned.';
  }

  function summarize(steps) {
    var order = ['ext', 'tab', 'perm', 'worker', 'chart', 'data'];
    var byId = {}; steps.forEach(function (s) { byId[s.id] = s; });
    var firstFail = null;
    for (var i = 0; i < order.length; i++) {
      if (byId[order[i]].status === 'fail') { firstFail = byId[order[i]]; break; }
    }
    var hardSteps = ['ext', 'tab', 'perm', 'worker'];
    var ready = hardSteps.every(function (k) { return byId[k].status === 'pass'; });
    return { steps: steps, firstFail: firstFail, ready: ready };
  }

  // ---- UI: the checklist panel -------------------------------------------
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '#' + PANEL_ID + '{position:fixed;inset:0;z-index:2147483602;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(15,23,42,.55);font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}' +
      '#' + PANEL_ID + ' .mlsdoc-card{width:min(520px,94vw);max-height:88vh;overflow:auto;background:#ffffff;' +
      'color:#0f172a;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.4);padding:20px 22px;}' +
      '#' + PANEL_ID + ' .mlsdoc-h{display:flex;align-items:center;gap:10px;font-size:18px;font-weight:800;margin:0 0 4px;}' +
      '#' + PANEL_ID + ' .mlsdoc-sub{font-size:13px;color:#475569;margin:0 0 14px;}' +
      '#' + PANEL_ID + ' .mlsdoc-fix{background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;border-radius:10px;' +
      'padding:11px 13px;margin:0 0 14px;font-size:14px;font-weight:600;line-height:1.4;}' +
      '#' + PANEL_ID + ' .mlsdoc-ok{background:#ecfdf5;border:1px solid #6ee7b7;color:#065f46;border-radius:10px;' +
      'padding:11px 13px;margin:0 0 14px;font-size:14px;font-weight:700;}' +
      '#' + PANEL_ID + ' ul.mlsdoc-list{list-style:none;margin:0 0 14px;padding:0;}' +
      '#' + PANEL_ID + ' li.mlsdoc-step{display:flex;gap:10px;align-items:flex-start;padding:9px 0;border-top:1px solid #F4F2EC;}' +
      '#' + PANEL_ID + ' li.mlsdoc-step:first-child{border-top:none;}' +
      '#' + PANEL_ID + ' .mlsdoc-ic{flex:0 0 22px;width:22px;height:22px;border-radius:50%;display:flex;align-items:center;' +
      'justify-content:center;font-size:13px;font-weight:900;color:#fff;margin-top:1px;}' +
      '#' + PANEL_ID + ' .ic-pass{background:#2E6A4B;}' +
      '#' + PANEL_ID + ' .ic-fail{background:#dc2626;}' +
      '#' + PANEL_ID + ' .ic-warn{background:#d97706;}' +
      '#' + PANEL_ID + ' .ic-check{background:#94a3b8;}' +
      '#' + PANEL_ID + ' .mlsdoc-body{flex:1;min-width:0;}' +
      '#' + PANEL_ID + ' .mlsdoc-lbl{font-size:14px;font-weight:700;color:#0f172a;line-height:1.3;}' +
      '#' + PANEL_ID + ' .mlsdoc-det{font-size:12.5px;color:#475569;margin-top:2px;line-height:1.4;}' +
      '#' + PANEL_ID + ' .mlsdoc-stepfix{font-size:12.5px;color:#7c2d12;background:#fff7ed;border-radius:7px;' +
      'padding:5px 8px;margin-top:5px;font-weight:600;line-height:1.4;}' +
      '#' + PANEL_ID + ' .mlsdoc-actions{display:flex;gap:10px;justify-content:flex-end;}' +
      '#' + PANEL_ID + ' .mlsdoc-btn{border:none;border-radius:9px;padding:9px 15px;font-size:14px;font-weight:700;cursor:pointer;}' +
      '#' + PANEL_ID + ' .mlsdoc-btn.primary{background:#2E6A4B;color:#fff;}' +
      '#' + PANEL_ID + ' .mlsdoc-btn.ghost{background:#e2e8f0;color:#0f172a;}' +
      // top-right troubleshoot control
      '#' + BTN_ID + '{position:fixed;top:8px;right:30px;z-index:2147483601;background:rgba(15,23,42,.82);color:#fff;' +
      'border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;' +
      'cursor:pointer;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;line-height:1.6;}' +
      '#' + BTN_ID + ':hover{background:#2E6A4B;}' +
      // success / failure toast
      '#' + TOAST_ID + '{position:fixed;top:46px;left:50%;transform:translateX(-50%);z-index:2147483602;' +
      'max-width:min(560px,92vw);padding:11px 16px;border-radius:11px;font-size:14px;font-weight:700;color:#fff;' +
      'box-shadow:0 10px 34px rgba(0,0,0,.32);font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;' +
      'display:flex;align-items:center;gap:10px;line-height:1.4;}' +
      '#' + TOAST_ID + '.ok{background:#15803d;}' +
      '#' + TOAST_ID + '.warn{background:#b45309;}' +
      '#' + TOAST_ID + '.info{background:#204034;}' +
      '#' + TOAST_ID + ' .mlsdoc-x{margin-left:6px;cursor:pointer;opacity:.85;font-weight:900;}';
    (document.head || document.documentElement).appendChild(st);
  }

  function icClass(s) {
    return s === 'pass' ? 'ic-pass' : s === 'fail' ? 'ic-fail' : s === 'warn' ? 'ic-warn' : 'ic-check';
  }
  function icChar(s) {
    return s === 'pass' ? '✓' : s === 'fail' ? '✗' : s === 'warn' ? '!' : '…';
  }

  function renderPanel(result, opts) {
    opts = opts || {};
    ensureStyle();
    var panel = document.getElementById(PANEL_ID);
    if (!panel) {
      panel = document.createElement('div');
      panel.id = PANEL_ID;
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-label', 'Athena troubleshooting');
      panel.addEventListener('click', function (e) { if (e.target === panel) closePanel(); });
      (document.body || document.documentElement).appendChild(panel);
    }
    var steps = result.steps;
    var running = opts.running;
    var headHtml, fixHtml = '';
    if (running) {
      headHtml = '<span>🔧</span><span>Checking MLS Assist…</span>';
    } else if (result.ready && !result.firstFail) {
      headHtml = '<span>✅</span><span>MLS Assist is ready</span>';
      fixHtml = '<div class="mlsdoc-ok">MLS Assist is ready and a loaded Athena product tab is detected. The exact patient and encounter will be verified only when you start a clinical action.</div>';
    } else if (result.firstFail) {
      headHtml = '<span>⚠️</span><span>Found the problem</span>';
      fixHtml = '<div class="mlsdoc-fix">Do this: ' + esc(result.firstFail.fix) + '</div>';
    } else {
      headHtml = '<span>ℹ️</span><span>Checked the connection</span>';
    }

    var rows = steps.map(function (s) {
      var stepFix = (s.status === 'fail' && s.fix) ? '<div class="mlsdoc-stepfix">→ ' + esc(s.fix) + '</div>' : '';
      return '<li class="mlsdoc-step">' +
        '<span class="mlsdoc-ic ' + icClass(s.status) + '">' + icChar(s.status) + '</span>' +
        '<span class="mlsdoc-body"><span class="mlsdoc-lbl">' + esc(s.label) + '</span>' +
        (s.detail ? '<span class="mlsdoc-det">' + esc(s.detail) + '</span>' : '') +
        stepFix + '</span></li>';
    }).join('');

    panel.innerHTML =
      '<div class="mlsdoc-card">' +
      '<div class="mlsdoc-h">' + headHtml + '</div>' +
      '<div class="mlsdoc-sub">PHI-free readiness check of MLS Assist and Athena tab metadata. It does not read a schedule or chart.</div>' +
      fixHtml +
      '<ul class="mlsdoc-list">' + rows + '</ul>' +
      '<div class="mlsdoc-actions">' +
      '<button class="mlsdoc-btn ghost" data-act="close">Close</button>' +
      '<button class="mlsdoc-btn primary" data-act="recheck"' + (running ? ' disabled' : '') + '>Re-check</button>' +
      '</div></div>';

    panel.querySelectorAll('[data-act]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('data-act') === 'close') closePanel();
        else openDiagnostic(opts.lastResult);
      });
    });
  }

  function closePanel() {
    var p = document.getElementById(PANEL_ID);
    if (p && p.parentNode) p.parentNode.removeChild(p);
  }

  // Open + run the diagnostic, streaming live step updates, then auto re-check
  // once after a short delay if the only failure is a sleeping worker (safe).
  var _running = false;
  function openDiagnostic(lastResult) {
    if (_running) return;
    _running = true;
    renderPanel({ steps: blankSteps(), ready: false, firstFail: null }, { running: true, lastResult: lastResult });
    var finalRes = null;
    runChain(lastResult, function (steps) {
      renderPanel(summarizeLive(steps), { running: true, lastResult: lastResult });
    }).then(function (res) {
      finalRes = res;
      _running = false;
      renderPanel(res, { running: false, lastResult: lastResult });
    }).catch(function () {
      _running = false;
      var s = blankSteps();
      s[0].status = 'warn'; s[0].detail = 'The check could not complete; try Re-check.';
      renderPanel({ steps: s, ready: false, firstFail: null }, { running: false, lastResult: lastResult });
    });
  }
  function summarizeLive(steps) { return summarize(steps); }

  // ---- UI: top-right troubleshoot control + red-dot click -----------------
  function ensureButton() {
    ensureStyle();
    if (!document.getElementById(BTN_ID)) {
      var b = document.createElement('button');
      b.id = BTN_ID;
      b.type = 'button';
      b.textContent = '🔧 Troubleshoot Athena';
      b.setAttribute('aria-label', 'Troubleshoot the MLS Assist Athena connection');
      b.addEventListener('click', function () { openDiagnostic(null); });
      (document.body || document.documentElement).appendChild(b);
    }
    // make the status dot clickable to open the diagnostic
    var dot = document.getElementById('mlsAthenaStatusDot');
    if (dot && !dot.__mlsDoctorWired) {
      dot.__mlsDoctorWired = true;
      dot.style.cursor = 'pointer';
      dot.addEventListener('click', function () { openDiagnostic(null); });
    }
  }

  // ---- clearer SUCCESS + auto-trigger on failure --------------------------
  // Listens (capture phase) for the extension's result messages — the SAME
  // shared event family §50/§58 hook. Reads ONLY ok + a count (array length) —
  // never the visit/chart contents, so no PHI is read or logged.
  function resultMeta(d) {
    var r = (d.resp && typeof d.resp === 'object') ? d.resp : d;
    var ok = r.ok === true;
    var count = null;
    if (Array.isArray(r.visits)) count = r.visits.length;
    else if (Array.isArray(r.results)) count = r.results.length;
    else if (Array.isArray(r.rows)) count = r.rows.length;
    else if (typeof r.count === 'number') count = r.count;
    var stage = (typeof r.stage === 'string') ? r.stage : (typeof r.reason === 'string' ? r.reason : '');
    return { ok: ok, count: count, stage: stage, raw: r };
  }

  /* Provider/day pulls deliberately issue one correlated visit read per
     patient and own one aggregate progress/result surface. Those internal
     reads use an `mlssi-*` request id (or an explicit managed/background
     marker). They must not each create the standalone, persistent orange
     warning: the batch owner already reports retryable patients once, in
     context. A direct/manual read has no such marker and keeps the honest
     actionable warning below. */
  function resultRequestId(d) {
    d = d || {};
    var r = (d.resp && typeof d.resp === 'object') ? d.resp : d;
    return String(d.id || d.requestId || r.id || r.requestId || '');
  }

  function resultCorrelationId(d) {
    d = d || {};
    var r = (d.resp && typeof d.resp === 'object') ? d.resp : d;
    return String(d.correlationId || d.retryOf || d.parentRequestId ||
      r.correlationId || r.retryOf || r.parentRequestId || '');
  }

  function markPullNoticeHandled(d, owner) {
    try { d.__mlsAthenaPullNoticeHandled = String(owner || 'doctor'); } catch (e) {}
  }

  function pullNoticeHandled(d) {
    try { return !!(d && d.__mlsAthenaPullNoticeHandled); } catch (e) { return false; }
  }

  function isManagedPullResult(d) {
    d = d || {};
    var r = (d.resp && typeof d.resp === 'object') ? d.resp : d;
    if (/^mlssi-[a-z0-9]+-[a-z0-9]+$/i.test(resultRequestId(d))) return true;
    if (d.managed === true || d.background === true || d.silent === true ||
        r.managed === true || r.background === true || r.silent === true) return true;
    var owner = String(d.initiator || d.origin || d.mode || r.initiator || r.origin || r.mode || '').toLowerCase();
    return /^(?:background|batch|prefetch|automatic|auto)$/.test(owner);
  }

  function kindOf(type) {
    if (/AllVisits|Visits/i.test(type)) return 'pull';
    if (/Search/i.test(type)) return 'search';
    if (/Report/i.test(type)) return 'report';
    if (/Schedule/i.test(type)) return 'schedule';
    return '';
  }

  /* Only a success from the same manual action may retire its warning. A
     managed/background success is unrelated and must never erase a real
     manual failure. Request ids win when present; the legacy manual bridge
     legitimately sends empty ids, so empty-id results correlate by action
     kind. retryOf/correlationId can explicitly link a newer retry id. */
  var _activeManualFailure = null;
  function manualFailureRef(d, kind) {
    return { kind: kind, requestId: resultRequestId(d), correlationId: resultCorrelationId(d) };
  }
  function successMatchesManualFailure(d, kind) {
    var a = _activeManualFailure;
    if (!a || a.kind !== kind) return false;
    var id = resultRequestId(d), corr = resultCorrelationId(d);
    if (a.requestId) return id === a.requestId || corr === a.requestId || (!!a.correlationId && corr === a.correlationId);
    if (a.correlationId) return corr === a.correlationId || id === a.correlationId;
    return !id && !corr;
  }
  function clearTaggedPullFailures() {
    try {
      var nodes = document.querySelectorAll('[data-mls-athena-pull-failure="1"]');
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i] && nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
      }
    } catch (e) {}
  }
  function clearManualFailure() {
    clearToast();
    clearTaggedPullFailures();
    _activeManualFailure = null;
  }

  function onResultMessage(ev) {
    var d = ev && ev.data;
    if (!d || d.source !== 'mls-ext' || !d.type || !/Result$/.test(d.type)) return;
    var kind = kindOf(d.type);
    if (kind !== 'pull' && kind !== 'search') return; // only user-facing pull/search actions
    var m = resultMeta(d);
    var managedPull = (kind === 'pull') && isManagedPullResult(d);

    /* Editorial Calm consolidation (2026-07-13, RS#2): clarity shows the richer
       per-patient toast ("Pulled N real visits into <name> — saved in MLS", plus
       its own zero-visits line) for PULLs, so this module's overlapping generic
       pull toasts stand down when clarity is installed. Search toasts and
       genuine-failure warnings remain ours (clarity does not cover those). */
    var clarityOwnsPull = (kind === 'pull') && !!(W.__mlsAthenaClarity);
    if (m.ok && (m.count == null || m.count > 0)) {
      if (managedPull) { markPullNoticeHandled(d, 'managed'); return; }
      var matchesFailure = successMatchesManualFailure(d, kind);
      if (_activeManualFailure && !matchesFailure) return;
      if (matchesFailure) clearManualFailure();
      if (!clarityOwnsPull) {
        // honest success line (counts). §58 save-verify separately confirms persistence.
        var noun = kind === 'pull' ? 'visit' : 'result';
        var what = kind === 'pull' ? 'Pulled' : 'Athena search returned';
        var n = (m.count == null) ? '' : (m.count + ' ');
        var tail = (kind === 'pull' && W.__mlsSaveVerify) ? ' — save check below confirms they\'re stored.' : '';
        showToast('ok', '✓ ' + what + ' ' + n + noun + (m.count === 1 ? '' : 's') + (kind === 'pull' ? ' from athenaOne.' : '.') + tail);
      }
    } else if (m.ok && m.count === 0) {
      if (managedPull) { markPullNoticeHandled(d, 'managed'); return; }
      var matchesZeroFailure = successMatchesManualFailure(d, kind);
      if (_activeManualFailure && !matchesZeroFailure) return;
      if (matchesZeroFailure) clearManualFailure();
      if (!clarityOwnsPull) {
        showToast('info', 'ℹ The read completed but found 0 ' + (kind === 'pull' ? 'visits' : 'results') + '. The pull opens the chart automatically — re-run it, or this patient may simply have no visits yet.');
      }
      // soft auto-trigger so the user sees why (kept regardless — no toast involved)
      autoTrigger({ ok: true, count: 0, anyReal: false });
    } else {
      // Internal per-patient/background failures are summarized by their
      // owning workflow. Suppressing this duplicate does not conceal a
      // manual failure; unmarked standalone pulls still warn immediately.
      if (managedPull) { markPullNoticeHandled(d, 'managed'); return; }
      // genuine failure — show honest line AND auto-open the diagnostic
      markPullNoticeHandled(d, 'doctor');
      var ref = manualFailureRef(d, kind);
      showToast('warn', '⚠ That Athena ' + kind + ' didn\'t work — re-run, or tap the Troubleshoot Athena button…', {
        key: kind + '|' + (m.stage || 'failed') + '|' + ref.requestId,
        pullFailure: true,
        requestId: ref.requestId,
        resultKind: kind
      });
      _activeManualFailure = ref;
      autoTrigger({ ok: false, count: m.count, stage: m.stage });
    }
  }

  var _autoCooldown = 0;
  function autoTrigger(lastResult) {
    /* auto-popup removed 2026-07-08 (b102): the full-screen "Found the problem"
       diagnostic used to auto-open on every honest pull/search failure, which is
       disruptive during normal pulls (they routinely include expected refusals).
       No-op now; the manual "Troubleshoot Athena" button / status-dot still opens
       the full panel on request. Kept as a no-op so both call sites stay valid. */
    return;
  }

  var _lastWarnKey = '';
  var _lastWarnAt = 0;

  function clearToast() {
    var old = document.getElementById(TOAST_ID);
    if (old && old.parentNode) old.parentNode.removeChild(old);
    _lastWarnKey = '';
    _lastWarnAt = 0;
  }

  function showToast(kind, text, opts) {
    opts = opts || {};
    ensureStyle();
    var t = document.getElementById(TOAST_ID);
    var warnKey = kind === 'warn' ? String(opts.key || text || '') : '';
    if (kind === 'warn' && t && t.parentNode && warnKey &&
        warnKey === _lastWarnKey && Date.now() - _lastWarnAt < 15000) {
      return t; // same manual failure already visible; do not flash/recreate it
    }
    clearToast();
    t = document.createElement('div');
    t.id = TOAST_ID;
    t.className = kind;
    t.setAttribute('role', 'status');
    if (warnKey) {
      _lastWarnKey = warnKey;
      _lastWarnAt = Date.now();
      t.setAttribute('data-mlsdoc-toast-key', warnKey);
    }
    if (opts.pullFailure) {
      t.setAttribute('data-mls-athena-pull-failure', '1');
      t.setAttribute('data-mls-athena-result-kind', String(opts.resultKind || ''));
      t.setAttribute('data-mls-athena-request-id', String(opts.requestId || ''));
    }
    t.innerHTML = '<span>' + esc(text) + '</span><span class="mlsdoc-x" aria-label="dismiss">✕</span>';
    t.querySelector('.mlsdoc-x').addEventListener('click', function () {
      if (opts.pullFailure) clearManualFailure();
      else if (t.parentNode) t.parentNode.removeChild(t);
    });
    (document.body || document.documentElement).appendChild(t);
    if (kind === 'ok' || kind === 'info') {
      setTimeout(function () { if (t && t.parentNode) t.parentNode.removeChild(t); }, 6500);
    }
    // mirror the worst signal: nothing else needed
    return t;
  }

  // ---- boot: idempotent mount + light re-mount observer (no jitter) --------
  var _obs = null;
  function boot() {
    ensureButton();
    if (!_obs && W.MutationObserver) {
      _obs = new MutationObserver(function () {
        // only act when our control is actually missing — no render loop, no jitter
        if (!document.getElementById(BTN_ID)) ensureButton();
        var dot = document.getElementById('mlsAthenaStatusDot');
        if (dot && !dot.__mlsDoctorWired) ensureButton();
      });
      try { _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    }
    try { W.addEventListener('message', onResultMessage, true); } catch (e) {}
  }

  function revert() {
    try { if (_obs) { _obs.disconnect(); _obs = null; } } catch (e) {}
    try { W.removeEventListener('message', onResultMessage, true); } catch (e) {}
    [PANEL_ID, BTN_ID, TOAST_ID, STYLE_ID].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    var dot = document.getElementById('mlsAthenaStatusDot');
    if (dot) { try { delete dot.__mlsDoctorWired; } catch (e) { dot.__mlsDoctorWired = false; } }
    if (W.__mlsAthenaDoctor) W.__mlsAthenaDoctor.installed = false;
  }

  // ---- public API (also the pieces the offline tests drive) ---------------
  W.__mlsAthenaDoctor = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    // probes (reused)
    pingExtension: pingExtension,
    healthProbe: healthProbe,
    // chain
    runChain: runChain,
    summarize: summarize,
    blankSteps: blankSteps,
    isPermErr: isPermErr,
    resultMeta: resultMeta,
    resultRequestId: resultRequestId,
    resultCorrelationId: resultCorrelationId,
    isManagedPullResult: isManagedPullResult,
    pullNoticeHandled: pullNoticeHandled,
    ownsPullNotices: true,
    kindOf: kindOf,
    // UI / actions
    open: function (lastResult) { openDiagnostic(lastResult || null); },
    diagnose: function (lastResult) { return runChain(lastResult || null, null); },
    showToast: showToast,
    clearToast: clearToast,
    _onResultMessage: onResultMessage,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
