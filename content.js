/* MLS Assist — content script.
   Sits dormant as a small badge on every page. Does NOTHING until the doctor
   opens the panel (consent). Then: capture the visit (live dictation or page
   selection) -> MLS generates a note -> the doctor reviews -> one click inserts
   it into the focused EMR field. Nothing is ever written automatically. */
(function () {
  /* MLS Assist v1.35 — scope guard: never run on github.com (perf+privacy; via <all_urls> the panel/observers used to inject into GitHub and could freeze its renderer). Belt-and-suspenders with manifest exclude_matches. athenaOne + mlsscribe.com are unaffected. */
  try { var __mlsHost = (location && location.hostname || '').toLowerCase(); if (__mlsHost === 'github.com' || __mlsHost.slice(-11) === '.github.com' || __mlsHost === 'githubusercontent.com' || __mlsHost.slice(-22) === '.githubusercontent.com' || __mlsHost === 'github.dev' || __mlsHost.slice(-11) === '.github.dev') { return; } } catch (e) {}
  if (window.__mlsAssistLoaded) return; window.__mlsAssistLoaded = true;
  /* v1.90: athena-tab REGISTRATION heartbeat. Fires ONLY on the raw product host
     (athenanet.athenahealth.com — identity./login hosts never register), carries
     NO data beyond the message type (no PHI, no URL), and lets the background's
     unified mlsPickAthenaTab prefer the tab whose content script is actually
     alive. Event-driven only — no timers. */
  try {
    if ((location.hostname || '').toLowerCase() === 'athenanet.athenahealth.com') {
      var __mlsAthHello = function () { try { chrome.runtime.sendMessage({ type: 'mlsAthenaHello' }, function () { var _ = chrome.runtime.lastError; }); } catch (e) {} };
      __mlsAthHello();
      window.addEventListener('focus', __mlsAthHello, true);
      window.addEventListener('pageshow', __mlsAthHello, true);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) __mlsAthHello(); }, true);
    }
  } catch (e) {}
  // SECURITY (v1.26) -- trusted-origin gate for the page->extension postMessage bridge.
  // The content script runs on <all_urls> so the doctor can open the MLS Assist panel
  // on ANY page (that any-page behavior is intentional and unchanged). BUT the bridge
  // below can drive the extension to scrape the open EMR/Athena chart and return PHI,
  // so it must only be drivable by the MLS web app itself. We therefore (1) validate
  // e.origin against an allowlist of MLS app origins, (2) validate the message shape
  // and type, and (3) reply ONLY to the trusted origin -- never '*'. The doctor's own
  // panel/popup actions do NOT use this bridge (they use chrome.runtime messaging),
  // so a malicious page can neither puppet the extension nor receive chart data, while
  // the doctor's any-page usage is fully preserved.
  /* v1.52 fix #2 (broken allowlist): mlsAppGotoDate + mlsAppScrapeReviews had handlers but were gate-dropped here - hands-free month-pull nav and review scraping were dead. Two keys added; gate semantics unchanged. */
  /* v1.55: mlsAppGoHome added — the app-side day/month history orchestrator needs to
     return athenaOne to the CLINICAL SCHEDULE (home) between patients so each patient's
     row is on screen to open. Read-only navigation (clicks the athenaOne Home logo). */
  var MLS_BRIDGE_TYPES = { mlsPing: 1, mlsAppCapture: 1, mlsAppPasteNote: 1, mlsAppPullSchedule: 1, mlsAppReadChart: 1, mlsAppReadReport: 1, mlsAppPushVisit: 1, mlsAppSearchProcedure: 1, mlsAppPrepProcTemplate: 1, mlsAppSignAndSave: 1, mlsAppAthenaActionV2: 1, mlsAppTeachStart: 1, mlsAppTeachCancel: 1, mlsAppGotoDate: 1, mlsAppScrapeReviews: 1, mlsAppGoHome: 1, mlsAppFocusMlsTab: 1, mlsDevReload: 1, mlsAppVerifiedWrite: 1, mlsFgState: 1, mlsIdDiag: 1, mlsAppReadVisits: 1, mlsNameShadowState: 1 };
  // Optional operator-set extra origins (e.g. a staging domain, or http://localhost:PORT
  // for development). Defaults to none, so out of the box ONLY mlsscribe.com is trusted.
  var _mlsExtraOrigins = [];
  try {
    if (chrome.storage && chrome.storage.local) {
      chrome.storage.local.get(['mlsTrustedOrigins'], function (c) {
        try { if (c && Array.isArray(c.mlsTrustedOrigins)) _mlsExtraOrigins = c.mlsTrustedOrigins.filter(function (o) { return typeof o === 'string'; }).map(function (o) { return o.toLowerCase(); }); } catch (e) {}
      });
    }
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener(function (ch, area) {
        if (area === 'local' && ch && ch.mlsTrustedOrigins) { try { var v = ch.mlsTrustedOrigins.newValue; _mlsExtraOrigins = Array.isArray(v) ? v.filter(function (o) { return typeof o === 'string'; }).map(function (o) { return o.toLowerCase(); }) : []; } catch (e) {} }
      });
    }
  } catch (e) {}
  function mlsTrustedOrigin(origin) {
    if (!origin || typeof origin !== 'string') return false;
    var o = origin.toLowerCase();
    try {
      var u = new URL(origin);
      if (u.protocol === 'https:' && (u.hostname === 'mlsscribe.com' || u.hostname === 'www.mlsscribe.com' || u.hostname.endsWith('.mlsscribe.com'))) return true;
    } catch (e) {}
    if (_mlsExtraOrigins.indexOf(o) >= 0) return true;
    return false;
  }
  /* A trusted origin is necessary but not sufficient for Sign & Save. Arm one
     short-lived, one-use authorization only from a real click on the clearly
     labelled MLS sign button. Programmatic .click() events are not trusted. */
  var _mlsSignGestureUntil = 0;
  /* ATHENA_ACTION_V2_CLICK_GATE_START */
  /* v2 Athena mutations are armed only by a real, freshly trusted click on the
     exact action button. Page scripts cannot manufacture Event.isTrusted. The
     arm is short-lived and consumed by the first matching bridge request. */
  var _mlsAthenaActionGesture = { action: '', until: 0, serial: '', previewHash: '', rowHash: '', clientOrderId: '' };
  function _mlsGestureSerial() {
    try { var a = new Uint32Array(4); crypto.getRandomValues(a); return Array.prototype.map.call(a, function (n) { return n.toString(16); }).join(''); }
    catch (e) { return String(Date.now()) + '-' + String(Math.random()).slice(2); }
  }
  function _mlsActionLabelMatches(action, label) {
    label = String(label || '').replace(/\s+/g, ' ').trim();
    if (action === 'write_note') return /\bconfirm\s+write\s+reviewed\s+note\b/i.test(label);
    if (action === 'stage_billing') return /\bconfirm\s+stage\s+billing\s+codes?\b/i.test(label);
    if (action === 'save_draft') return /\bconfirm\s+save\s+draft(?:\s+in\s+athena)?\b/i.test(label);
    if (action === 'sign_encounter') return /\bconfirm\s+sign\s*(?:&|and)\s*save(?:\s+in\s+athena)?\b/i.test(label);
    if (action === 'place_order') return /\bconfirm\s*(?:&|and)?\s*place\s+(?:one\s+)?(?:reviewed\s+)?order\b/i.test(label);
    return false;
  }
  try {
    if (mlsTrustedOrigin(location.origin)) {
      document.addEventListener('click', function (ev) {
        try {
          if (!ev || ev.isTrusted !== true) return;
          var t = ev.target && ev.target.closest ? ev.target.closest('button,a,[role="button"],input[type="button"],input[type="submit"]') : null;
          if (!t) return;
          var label = String((t.textContent || t.value || '') + ' ' + (t.getAttribute('aria-label') || '') + ' ' + (t.getAttribute('title') || '')).replace(/\s+/g, ' ').trim();
          if (/\bsign\s*(?:&|and)\s*save\b/i.test(label)) _mlsSignGestureUntil = Date.now() + 180000;
          var actionEl = ev.target && ev.target.closest ? ev.target.closest('[data-mls-athena-action]') : null;
          var action = actionEl ? String(actionEl.getAttribute('data-mls-athena-action') || '').toLowerCase().trim() : '';
          var actionable = actionEl === t && !t.disabled && t.getAttribute('aria-disabled') !== 'true';
          if (actionable) {
            try { var cs = getComputedStyle(t), rect = t.getBoundingClientRect(); actionable = cs.display !== 'none' && cs.visibility !== 'hidden' && Number(cs.opacity || 1) > 0.05 && rect.width > 2 && rect.height > 2; } catch (eVisible) { actionable = false; }
          }
          if (actionable && /^(write_note|stage_billing|save_draft|sign_encounter|place_order)$/.test(action) && _mlsActionLabelMatches(action, label)) {
            _mlsAthenaActionGesture = {
              action: action,
              until: Date.now() + 20000,
              serial: _mlsGestureSerial(),
              previewHash: String(actionEl.getAttribute('data-mls-preview-hash') || '').slice(0, 160),
              rowHash: String(actionEl.getAttribute('data-mls-row-hash') || '').slice(0, 160),
              clientOrderId: String(actionEl.getAttribute('data-mls-client-order-id') || '').slice(0, 160)
            };
          }
        } catch (e) {}
      }, true);
    }
  } catch (e) {}
  /* ATHENA_ACTION_V2_CLICK_GATE_END */
  function mlsStr(v, max) { return (typeof v === 'string') ? v.slice(0, max || 100000) : ''; }

  // Bridge: the MLS web app (mlsscribe.com) can ping us (to show "Assist installed")
  // and ask us to capture the patient currently open in the doctor's EMR tab.
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || d.source !== 'mls-app') return;
    if (typeof d.type !== 'string' || !MLS_BRIDGE_TYPES[d.type]) return;
    if (!mlsTrustedOrigin(e.origin)) return;
    var origin = e.origin;
    var reply = function (payload) { try { window.postMessage(payload, origin); } catch (err) {} };
    if (d.type === 'mlsPing') { var __v = ''; try { __v = chrome.runtime.getManifest().version; } catch (e) {} reply({ source: 'mls-ext', type: 'mlsPong', version: __v, capabilities: { supervisedOrderPlacementV2: true, destinationTeachingV2: true } }); return; }
    if (d.type === 'mlsAppCapture') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppCaptureRequest' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppCaptureResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppCaptureResult', resp: { error: 'extension error' } }); }
    }
    if (d.type === 'mlsAppPrepProcTemplate') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppPrepProcTemplateRequest', params: (d.params || {}), mode: (d.mode || 'prep') }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppPrepProcTemplateResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppPrepProcTemplateResult', resp: { error: 'extension error' } }); }
      return;
    }
    if (d.type === 'mlsAppPasteNote') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppPasteRequest', note: mlsStr(d.note) }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppPasteResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppPasteResult', resp: { error: 'extension error' } }); }
    }
    /* v1.70: PER-SECTION verified write for the app's "EMR sections - review &
       confirm" console. Relays to the existing mlsVerifiedWrite worker path:
       identity gate (refuse-by-default; force only via the doctor's explicit
       in-app override) -> mlsSegmentNote -> per-section field scan -> paste ->
       per-section confirmed/notfound results. The worker's hard ORDERS block
       and never-Save/Sign behavior are untouched. */
    if (d.type === 'mlsAppVerifiedWrite') {
      reply({ source: 'mls-ext', type: 'mlsAppVerifiedWriteResult', resp: { ok: false, blocked: true, reason: 'legacy-untyped-write-disabled', error: 'Use Review Athena actions or the explicitly labelled advanced section writer. Nothing was written.' } });
      return;
    }
    // Pull TODAY'S SCHEDULE from the EMR tab (Athena) so MLS can pre-load the day's patients.
    if (d.type === 'mlsAppPullSchedule') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppScheduleRequest', id: mlsStr(d.id, 80) }, function (resp) {
          var out = resp || { error: 'no response' }; if (d.id && !out.id) { out = Object.assign({}, out, { id: mlsStr(d.id, 80) }); }
          reply({ source: 'mls-ext', type: 'mlsAppScheduleResult', id: mlsStr(d.id, 80), resp: out });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppScheduleResult', id: mlsStr(d.id, 80), resp: { id: mlsStr(d.id, 80), error: 'extension error' } }); }
    }
    // v1.51: navigate the athena schedule to a specific DATE (read-only navigation;
    // probe:true just reports whether hands-free date-nav is available on this view).
    if (d.type === 'mlsAppGotoDate') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppGotoDateRequest', date: mlsStr(d.date, 10), probe: !!d.probe, id: mlsStr(d.id, 80) }, function (resp) {
          var out = resp || { error: 'no response' }; if (d.id && !out.id) { out = Object.assign({}, out, { id: mlsStr(d.id, 80) }); }
          reply({ source: 'mls-ext', type: 'mlsAppGotoDateResult', id: mlsStr(d.id, 80), resp: out });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppGotoDateResult', id: mlsStr(d.id, 80), resp: { id: mlsStr(d.id, 80), error: 'extension error' } }); }
    }
    // v1.55: return athenaOne to the CLINICAL SCHEDULE (home) by clicking the athenaOne
    // Home logo. Read-only navigation. Lets the app-side day/month orchestrator re-ground
    // between patients (each patient's schedule row must be on screen to open the chart).
    if (d.type === 'mlsAppGoHome') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppGoHomeRequest' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppGoHomeResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppGoHomeResult', resp: { error: 'extension error' } }); }
    }
    // v1.60 DEV: reload the unpacked extension from disk (build iteration without a
    // manual chrome://extensions click). Reload only - nothing else.
    /* v2.9.11: read the accumulated shadow-parser totals (cutover evidence). Read-only. */
    if (d.type === 'mlsNameShadowState') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsNameShadowStateRequest' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsNameShadowStateResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsNameShadowStateResult', resp: { error: 'extension error' } }); }
      return;
    }
    if (d.type === 'mlsDevReload') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsDevReloadRequest' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsDevReloadResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsDevReloadResult', resp: { error: 'extension error' } }); }
    }
    // v1.56: return focus to the MLS (mlsscribe) tab. The app posts this when a history
    // pull ends so the doctor is brought back from athenaOne instead of being stranded there.
    if (d.type === 'mlsAppFocusMlsTab') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppFocusMlsTab' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppFocusMlsTabResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppFocusMlsTabResult', resp: { error: 'extension error' } }); }
    }
    // v1.75: read-only focus-guardian state (which tab is active, is a return owed).
    // No DOM access, no PHI — used to VERIFY the doctor was returned to MLS.
    if (d.type === 'mlsFgState') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsFgState' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsFgStateResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsFgStateResult', resp: { error: 'extension error' } }); }
    }
    // v1.77: read-only identity diagnostic (initials + scores only, no PHI).
    if (d.type === 'mlsIdDiag') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsIdDiag' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsIdDiagResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsIdDiagResult', resp: { error: 'extension error' } }); }
    }
    // v1.51: reviews scrape driver (reputation lane) — background opens each PUBLIC
    // review URL in a background tab, runs the reader, returns normalized data. No PHI.
    if (d.type === 'mlsAppScrapeReviews') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppScrapeReviewsRequest', targets: (Array.isArray(d.targets) ? d.targets : []).slice(0, 12) }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppScrapeResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppScrapeResult', resp: { error: 'extension error' } }); }
    }
    // Open + read ONE PATIENT'S CHART from Athena. If a patient name is passed, the
    // background tries to click that patient (e.g. in the schedule) to open the chart,
    // then reads the frame that looks most like a clinical chart (not the schedule).
    if (d.type === 'mlsAppReadChart') {
      try {
        var chartRequestId = mlsStr(d.requestId, 100);
        var chartPatient = mlsStr(d.patient, 200);
        var chartDob = mlsStr(d.patientDob || d.dob, 20);
        var chartMrn = mlsStr(d.patientMrn || d.mrn || d.athenaId, 40);
        var chartMessage = {
          type: 'mlsAppChartRequest',
          patient: chartPatient,
          patientDob: chartDob,
          patientMrn: chartMrn,
          patientId: mlsStr(d.patientId, 100),
          requestId: chartRequestId
        };
        function finishChart(resp) {
          reply({ source: 'mls-ext', type: 'mlsAppChartResult', requestId: chartRequestId, resp: resp || { error: 'no response' } });
        }
        function readPreopenedChart() {
          chartMessage.preopened = true;
          chrome.runtime.sendMessage(chartMessage, finishChart);
        }
        /* v2.9.22: named history reads must use the live-certified, DOB-gated
           findpatient Chart opener before the reader settles the exact chart.
           A generic visible-name click lands on Athena's exam-prep surface. */
        if (chartPatient) {
          chrome.runtime.sendMessage({ type: 'mlsAppSearchOpenRequest', name: chartPatient, dob: chartDob, mrn: chartMrn }, function (opened) {
            var openErr = chrome.runtime.lastError;
            if (openErr || !opened || !opened.opened) {
              finishChart({ ok: false, reason: (opened && (opened.findReason || opened.reason)) || 'open-failed', error: (openErr && openErr.message) || (opened && opened.error) || 'Could not safely open the requested patient chart.' });
              return;
            }
            readPreopenedChart();
          });
        } else {
          chrome.runtime.sendMessage(chartMessage, finishChart);
        }
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppChartResult', requestId: mlsStr(d.requestId, 100), resp: { error: 'extension error' } }); }
    }
    /* v1.89: READ-ONLY, identity-gated read of the OPEN chart's left-rail
       "Visits and Cases" pane - individual visit entries {date,type,provider,
       textHead}. The injected driver verifies the open chart matches the
       requested {patient,dob,athenaId} on the live DOM BEFORE reading and
       refuses honestly otherwise (wrong-chart / wrong-dob / unverified-dob /
       wrong-id / no-rail). Never clicks Save/Sign/orders.
       BRIDGE CONTRACT (app side):
        - timeout must be >= 100s (90s injection budget + relay overhead) and
          ABSOLUTE-DEADLINE based: a Worker timer or Date.now() checks on
          capture-phase message events - NEVER bare setTimeout/setInterval in
          the (possibly hidden, ~0-tick-throttled) MLS tab.
        - one call at a time: overlapping calls come back reason:'busy' -
          do NOT auto-refire while a read may still be running.
        - call ReadVisits AFTER ReadChart for a patient (the rail click
          navigates the chart frame to the Visits pane), and re-verify
          chartName/chartDob/chartMrn on the response before ingesting.
        - the athenaOne tab should be visible/foreground during the read.
        - every DOM row is retained through the read receipt; downstream
          reconciliation may merge only records with the same verified visit
          identity, never merely because their visible text is identical. */
    if (d.type === 'mlsAppReadVisits') {
      try {
        var visitPatient = mlsStr(d.patient || d.name, 200);
        var visitDob = mlsStr(d.dob, 20);
        var visitAthenaId = mlsStr(d.athenaId, 40);
        var visitRequest = { type: 'mlsAppReadVisitsRequest', patient: visitPatient, dob: visitDob, athenaId: visitAthenaId };
        function finishVisits(resp) {
          reply({ source: 'mls-ext', type: 'mlsAppReadVisitsResult', resp: resp || { ok: false, reason: 'no-response', error: 'No response from MLS Assist' } });
        }
        function readVisitsOnce(canOpen) {
          chrome.runtime.sendMessage(visitRequest, function (resp) {
            var runtimeErr = chrome.runtime.lastError;
            if (runtimeErr || !resp) { finishVisits({ ok: false, reason: 'extension-error', error: (runtimeErr && runtimeErr.message) || 'No response from MLS Assist' }); return; }
            /* v2.9.15: a history read may be requested while Athena is parked on
               the dashboard or a different chart. The reader correctly refuses
               that state; recover ONCE through the already-proven, DOB-gated
               patient opener, then repeat the identity-gated read. */
            if (canOpen && visitPatient && /^(wrong-chart|unverified|unverified-patient)$/.test(String(resp.reason || ''))) {
              chrome.runtime.sendMessage({ type: 'mlsAppSearchOpenRequest', name: visitPatient, dob: visitDob, mrn: visitAthenaId }, function (opened) {
                var openErr = chrome.runtime.lastError;
                if (openErr || !opened || !opened.opened) {
                  finishVisits({ ok: false, reason: (opened && (opened.findReason || opened.reason)) || 'open-failed', error: (openErr && openErr.message) || (opened && opened.error) || 'Could not safely open the requested patient before reading history.' });
                  return;
                }
                /* The Athena airlock renders its identity banner after the opener
                   reports navigation. Run the established read-chart settle leg
                   before touching Visits; the visits driver still re-verifies the
                   requested name+DOB/MRN immediately before its rail click. */
                chrome.runtime.sendMessage({ type: 'mlsAppChartRequest', patient: visitPatient, patientDob: visitDob, patientMrn: visitAthenaId, preopened: true }, function (chartReady) {
                  var chartErr = chrome.runtime.lastError;
                  if (chartErr || !chartReady || !chartReady.ok) {
                    finishVisits({ ok: false, reason: (chartReady && chartReady.reason) || 'chart-not-ready', error: (chartErr && chartErr.message) || (chartReady && chartReady.error) || 'The requested chart opened, but its identity banner did not become ready.' });
                    return;
                  }
                  readVisitsOnce(false);
                });
              });
              return;
            }
            finishVisits(resp);
          });
        }
        readVisitsOnce(true);
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppReadVisitsResult', resp: { ok: false, reason: 'extension-error', error: 'Extension error' } }); }
    }
    // READ-ONLY: read the open Athena REPORT / claims / procedure / patient LIST tab so MLS
    // can enumerate patients by procedure/CPT (Study cohort, Mode B). Unlike mlsAppPullSchedule
    // (which scores frames for a SCHEDULE), this scores frames for a REPORT/LIST table (dates,
    // CPT-like codes, $ charges, "claim/procedure/service date" headers, many rows) and returns
    // the richest table frame plus a capped concat of the top frames. It never writes anything.
    if (d.type === 'mlsAppReadReport') {
      try {
        chrome.runtime.sendMessage({ type: 'mlsAppReportRequest' }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppReportResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppReportResult', resp: { error: 'extension error' } }); }
    }
    // Push the ENTIRE finished visit into the open Athena encounter (note, diagnoses,
    // ICD-10, E/M + CPT, orders, etc.) via the AI autopilot. NEVER clicks Save/Sign --
    // it stops and hands off to the doctor to review + sign in Athena.
    if (d.type === 'mlsAppPushVisit') {
      /* Retired: this mixed narrative, diagnoses, charges and order-chain
         actions in one free-form AI goal and could not prove destination-level
         persistence. Older app builds now fail closed instead of invoking it. */
      reply({ source: 'mls-ext', type: 'mlsAppPushResult', resp: {
        ok: false,
        blocked: true,
        reason: 'legacy-untyped-write-disabled',
        error: 'This older mixed Athena writer is disabled for safety. Use the supervised note-only workflow; diagnoses, billing and orders remain preview-only.'
      } });
    }
    // READ-ONLY autopilot (Mode C): DRIVE an athenaOne procedure/claims search, run it, and
    // PAGINATE through every result page, harvesting each row's text. The app parses + filters
    // + verifies+imports the rows through its existing strict name+DOB gate. Operates only the
    // search controls (CPT/procedure + date range + Run/Next); it NEVER clicks Save/Sign.
    if (d.type === 'mlsAppSearchProcedure') {
      try { _mlsSearchProcedure(d.params || {}, d.cfg || {}, origin); }
      catch (err) { reply({ source: 'mls-ext', type: 'mlsAppSearchResult', resp: { error: 'extension error' } }); }
    }
    // SIGN & SAVE (v1.40): the MLS web app's "Sign and Save" button asks the
    // extension to (optionally) write the verified note into the open Athena
    // chart and then auto-click Athena's Sign & Save. USER-INITIATED ONLY - this
    // relay fires only from an explicit trusted-origin message; the background
    // re-enforces the name+DOB patient gate and reports "signed" only on a
    // confirmed save/sign. Never autonomous; never Save/Sign without this click.
    if (d.type === 'mlsAppSignAndSave') {
      var readOnlySignProbe = d.probe === true && d.note == null && d.codes == null;
      if (!readOnlySignProbe) {
        reply({ source: 'mls-ext', type: 'mlsAppSignAndSaveResult', resp: {
          ok: false,
          blocked: true,
          signed: false,
          reason: 'sign-route-disabled',
          error: 'Automatic Save/Sign is disabled until the exact encounter, provider and visit date can be locked and verified. Review and sign directly in athenaOne.'
        } });
        return;
      }
      if (!readOnlySignProbe && Date.now() > _mlsSignGestureUntil) {
        reply({ source: 'mls-ext', type: 'mlsAppSignAndSaveResult', resp: { blocked: true, signed: false, error: 'fresh-user-gesture-required', message: 'Click the Sign & Save button yourself, then confirm again.' } });
        return;
      }
      if (!readOnlySignProbe) _mlsSignGestureUntil = 0; /* one click authorizes one sign request */
      try {
        chrome.runtime.sendMessage({
          type: 'MLS_OVL_SIGNSAVE',
          userInitiated: true,
          note: (d.note != null ? d.note : null),
          codes: (d.codes != null ? d.codes : null),
          mlsIdentity: (d.mlsIdentity && typeof d.mlsIdentity === 'object') ? { name: mlsStr(d.mlsIdentity.name, 200), dob: mlsStr(d.mlsIdentity.dob, 40), mrn: mlsStr(d.mlsIdentity.mrn, 60) } : null,
          probe: !!d.probe
        }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppSignAndSaveResult', resp: resp || { error: 'no response' } });
        });
      } catch (err) { reply({ source: 'mls-ext', type: 'mlsAppSignAndSaveResult', resp: { error: 'extension error' } }); }
    }
    /* Read-only destination teaching. The app supplies an immutable row and
       patient/writeflow binding. The background owns the one signed-in Athena
       tab watcher and streams explicit progress back through this trusted
       origin. No in-app click fallback exists. */
    if (d.type === 'mlsAppTeachStart' || d.type === 'mlsAppTeachCancel') {
      function safeTeachPatient(v) {
        v = v && typeof v === 'object' ? v : {};
        return { name: mlsStr(v.name, 200), dob: mlsStr(v.dob, 40), mrn: mlsStr(v.mrn || v.athenaId, 80), patientId: mlsStr(v.patientId || v.id, 200) };
      }
      function safeTeachContext(v) {
        v = v && typeof v === 'object' ? v : {};
        return { appointmentId: mlsStr(v.appointmentId || v.id, 160), encounterId: mlsStr(v.encounterId, 100), encounterUrl: mlsStr(v.encounterUrl, 1000), visitDate: mlsStr(v.visitDate, 40), provider: mlsStr(v.provider, 200) };
      }
      function safeTeachBinding(v) {
        v = v && typeof v === 'object' ? v : {};
        return {
          schema: mlsStr(v.schema, 80), contextHash: mlsStr(v.contextHash, 160), action: mlsStr(v.action, 80), kind: mlsStr(v.kind, 80),
          rowId: mlsStr(v.rowId, 180), rowHash: mlsStr(v.rowHash, 160), manifestHash: mlsStr(v.manifestHash, 160), previewHash: mlsStr(v.previewHash, 160),
          patientHash: mlsStr(v.patientHash, 160), visitHash: mlsStr(v.visitHash, 160)
        };
      }
      var teachRequestId = mlsStr(d.requestId, 120);
      try {
        chrome.runtime.sendMessage({
          type: d.type === 'mlsAppTeachStart' ? 'mlsAppTeachStartRequest' : 'mlsAppTeachCancelRequest',
          requestId: teachRequestId, action: mlsStr(d.action, 80), binding: safeTeachBinding(d.binding),
          expectedPatient: safeTeachPatient(d.patient || d.expectedPatient), expectedContext: safeTeachContext(d.expectedContext),
          timeoutMs: Math.max(5000, Math.min(60000, Number(d.timeoutMs || 60000)))
        }, function (resp) {
          reply({ source: 'mls-ext', type: d.type === 'mlsAppTeachStart' ? 'mlsAppTeachStartResult' : 'mlsAppTeachCancelResult', requestId: teachRequestId, resp: resp || { ok: false, state: 'failed', reason: 'no-response', message: 'MLS Assist returned no watcher response.' } });
        });
      } catch (errTeach) {
        reply({ source: 'mls-ext', type: d.type === 'mlsAppTeachStart' ? 'mlsAppTeachStartResult' : 'mlsAppTeachCancelResult', requestId: teachRequestId, resp: { ok: false, state: 'failed', reason: 'extension-error', message: 'MLS Assist could not start the read-only watcher.' } });
      }
      return;
    }
    /* Supervised typed Athena actions. `probe` is read-only and obtains one
       short-lived background token. An execute request additionally consumes a
       fresh trusted-click arm captured from data-mls-athena-action above. */
    if (d.type === 'mlsAppAthenaActionV2') {
      var athMode = String(d.mode || '').toLowerCase().trim();
      var athAction = String(d.action || d.targetAction || '').toLowerCase().trim();
      /* Backward-compatible read-only alias; the primary contract is always
         mode:'probe'|'execute' plus the concrete action. */
      if (!athMode && athAction === 'probe') { athMode = 'probe'; athAction = String(d.targetAction || '').toLowerCase().trim(); }
      var mutating = athMode === 'execute';
      if (!/^(probe|execute)$/.test(athMode) || !/^(write_note|stage_billing|save_draft|sign_encounter|place_order)$/.test(athAction)) {
        reply({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: mlsStr(d.requestId, 100), resp: { ok: false, blocked: true, reason: 'bad-action', error: 'Choose one typed note, billing, save, sign, or single reviewed-order action.' } });
        return;
      }
      var previewHash = mlsStr(d.previewHash, 160);
      var orderRowHash = mlsStr(d.rowHash, 160);
      var orderClientOrderId = mlsStr(d.clientOrderId || (d.order && d.order.clientOrderId) || (d.payload && d.payload.order && d.payload.order.clientOrderId), 160);
      if (athAction === 'place_order' && ((typeof d.rowHash === 'string' && d.rowHash.length > 160) || (typeof d.clientOrderId === 'string' && d.clientOrderId.length > 160))) {
        reply({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: mlsStr(d.requestId, 100), resp: { ok: false, blocked: true, reason: 'order-row-mismatch', error: 'The immutable order-row binding exceeds the exact transport limit.' } });
        return;
      }
      var gestureProof = '';
      if (mutating) {
        var arm = _mlsAthenaActionGesture || {};
        var armHashOk = !!arm.previewHash && !!previewHash && arm.previewHash === previewHash;
        var exactOrderArm = athAction !== 'place_order' || (!!orderRowHash && !!orderClientOrderId && arm.rowHash === orderRowHash && arm.clientOrderId === orderClientOrderId);
        if (arm.action !== athAction || Date.now() > Number(arm.until || 0) || !armHashOk || !exactOrderArm || !arm.serial) {
          reply({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: mlsStr(d.requestId, 100), resp: { ok: false, blocked: true, reason: 'fresh-trusted-click-required', error: 'Click the matching Athena action button again before continuing.' } });
          return;
        }
        gestureProof = arm.serial;
        _mlsAthenaActionGesture = { action: '', until: 0, serial: '', previewHash: '', rowHash: '', clientOrderId: '' }; // consumed once
      }
      function safePatient(v) {
        v = (v && typeof v === 'object') ? v : {};
        return { name: mlsStr(v.name, 200), dob: mlsStr(v.dob, 40), mrn: mlsStr(v.mrn || v.athenaId, 80), patientId: mlsStr(v.patientId || v.id, 200) };
      }
      function safeContext(v) {
        v = (v && typeof v === 'object') ? v : {};
        return { appointmentId: mlsStr(v.appointmentId || v.id, 160), encounterId: mlsStr(v.encounterId, 100), encounterUrl: mlsStr(v.encounterUrl, 1000), visitDate: mlsStr(v.visitDate, 40), provider: mlsStr(v.provider, 200) };
      }
      function safeBilling(v) {
        v = (v && typeof v === 'object') ? v : {};
        var c = Array.isArray(v.cptCodes) ? v.cptCodes : (Array.isArray(v.cpt) ? v.cpt : []);
        return { emCode: mlsStr(v.emCode || v.emLevel, 20), cptCodes: c.slice(0, 24).map(function (x) { return mlsStr(x, 20); }) };
      }
      function safeNoteSections(v) {
        var a = Array.isArray(v) ? v : [];
        return a.slice(0, 64).map(function (s) {
          s = (s && typeof s === 'object') ? s : {};
          return { key: mlsStr(s.key, 80), text: mlsStr(s.text, 180000), execute: s.execute === true, destination: mlsStr(s.destination, 160) };
        });
      }
      function safeTaughtDestination(v) {
        v = v && typeof v === 'object' ? v : {};
        return {
          schema: mlsStr(v.schema, 80), contextHash: mlsStr(v.contextHash, 160), action: mlsStr(v.action, 80), rowId: mlsStr(v.rowId, 180),
          rowHash: mlsStr(v.rowHash, 160), manifestHash: mlsStr(v.manifestHash, 160), patientHash: mlsStr(v.patientHash, 160), visitHash: mlsStr(v.visitHash, 160),
          capturedAt: mlsStr(v.capturedAt, 80), expiresAt: Number(v.expiresAt || 0), selector: mlsStr(v.selector, 2000), sectionLabel: mlsStr(v.sectionLabel, 240),
          label: mlsStr(v.label, 240), framePath: mlsStr(v.framePath, 100), frameUrl: mlsStr(v.frameUrl, 1200), tag: mlsStr(v.tag, 40), targetFingerprint: mlsStr(v.targetFingerprint, 120)
        };
      }
      function safeOrder(v) {
        v = (v && typeof v === 'object') ? v : {};
        var rawFields = (v.fields && typeof v.fields === 'object') ? v.fields : {}, fields = {}, error = '';
        var rawKeys = Object.keys(rawFields);
        if (rawKeys.length > 32) error = 'unsupported-order-fields';
        rawKeys.slice(0, 32).sort().forEach(function (key) {
          if (!/^[a-z][a-z0-9_]{0,39}$/i.test(key)) { error = 'unsupported-order-fields'; return; }
          if (typeof rawFields[key] !== 'string' || rawFields[key].length > 2000) { error = 'order-field-too-long'; return; }
          fields[key] = rawFields[key];
        });
        var values = {
          clientOrderId: mlsStr(v.clientOrderId, 160), type: mlsStr(v.type, 60),
          displayLabel: mlsStr(v.displayLabel, 300), catalogCode: mlsStr(v.catalogCode, 100),
          catalogId: mlsStr(v.catalogId, 160), query: mlsStr(v.query, 300), fields: fields,
          reviewStatus: mlsStr(v.reviewStatus, 80), source: mlsStr(v.source, 100)
        };
        if ((typeof v.clientOrderId === 'string' && v.clientOrderId.length > 160) || (typeof v.displayLabel === 'string' && v.displayLabel.length > 300) || (typeof v.catalogCode === 'string' && v.catalogCode.length > 100) || (typeof v.catalogId === 'string' && v.catalogId.length > 160) || (typeof v.query === 'string' && v.query.length > 300)) error = 'order-field-too-long';
        return { value: values, error: error };
      }
      var safeOrderResult = safeOrder(d.order || (d.payload && d.payload.order));
      if (athAction === 'place_order' && safeOrderResult.error) {
        reply({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: mlsStr(d.requestId, 100), resp: { ok: false, blocked: true, reason: safeOrderResult.error, error: safeOrderResult.error === 'unsupported-order-fields' ? 'The reviewed order contains unsupported structured fields.' : 'One or more reviewed order fields exceeds the exact transport limit.' } });
        return;
      }
      try {
        chrome.runtime.sendMessage({
          type: 'mlsAppAthenaActionV2Request',
          mode: athMode,
          action: athAction,
          requestId: mlsStr(d.requestId, 100),
          previewHash: previewHash,
          manifestHash: mlsStr(d.manifestHash, 160),
          actionToken: mlsStr(d.actionToken || d.token, 220),
          noteWriteProof: mlsStr(d.noteWriteProof || (d.payload && d.payload.noteWriteProof), 220),
          expectedPatient: safePatient(d.expectedPatient || d.patient || (d.payload && d.payload.patient)),
          expectedContext: safeContext(d.expectedContext || d.context || (d.payload && d.payload.context)),
          probeContext: (function (v) { v = (v && typeof v === 'object') ? v : {}; return { patientName: mlsStr(v.patientName, 200), dob: mlsStr(v.dob, 40), mrn: mlsStr(v.mrn, 80), encounterId: mlsStr(v.encounterId, 100), encounterUrl: mlsStr(v.encounterUrl, 1000), visitDate: mlsStr(v.visitDate, 40), provider: mlsStr(v.provider, 200), framePath: mlsStr(v.framePath, 80), encounterRootFingerprint: mlsStr(v.encounterRootFingerprint, 120), controlLabel: mlsStr(v.controlLabel, 200), controlFingerprint: mlsStr(v.controlFingerprint, 120), noteScopeFingerprint: mlsStr(v.noteScopeFingerprint, 120), actionContainerFingerprint: mlsStr(v.actionContainerFingerprint, 120), editorFingerprint: mlsStr(v.editorFingerprint, 120), contextHash: mlsStr(v.contextHash, 120), taughtDestinationFingerprint: mlsStr(v.taughtDestinationFingerprint, 120), taughtDestinationLabel: mlsStr(v.taughtDestinationLabel, 240) }; })(d.probeContext || (d.payload && d.payload.probeContext)),
          billing: safeBilling(d.billing || (d.payload && d.payload.billing)),
          order: safeOrderResult.value,
          rowHash: orderRowHash,
          clientOrderId: orderClientOrderId,
          noteText: mlsStr(d.noteText != null ? d.noteText : (d.payload && d.payload.noteText), 180000),
          notePolicy: mlsStr(d.notePolicy || (d.payload && d.payload.notePolicy) || 'empty_only', 40),
          sections: safeNoteSections(d.sections || (d.payload && d.payload.sections)),
          taughtDestination: safeTaughtDestination(d.taughtDestination || (d.payload && d.payload.taughtDestination)),
          userGesture: mutating,
          gestureProof: gestureProof,
          gestureRowHash: mutating && athAction === 'place_order' ? orderRowHash : '',
          gestureClientOrderId: mutating && athAction === 'place_order' ? orderClientOrderId : ''
        }, function (resp) {
          reply({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: mlsStr(d.requestId, 100), resp: resp || { ok: false, error: 'no response' } });
        });
      } catch (err) {
        reply({ source: 'mls-ext', type: 'mlsAppAthenaActionV2Result', requestId: mlsStr(d.requestId, 100), resp: { ok: false, error: 'extension error' } });
      }
      return;
    }
    /* ATHENA_ACTION_V2_BRIDGE_END */
  });
  /* Background progress is delivered only to the originating trusted MLS app
     tab, then forwarded to that same origin. */
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (!msg || msg.type !== 'mlsAppTeachProgress' || !mlsTrustedOrigin(location.origin)) return false;
      try { window.postMessage({ source: 'mls-ext', type: 'mlsAppTeachProgress', requestId: mlsStr(msg.requestId, 120), resp: msg.resp || {} }, location.origin); } catch (e) {}
      return false;
    });
  } catch (eTeachProgress) {}
  // Headless autopilot loop that enters a finished visit into the EMR encounter.
  function _bg(type, payload) { return new Promise(function (res) { try { chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (r) { res(r || {}); }); } catch (e) { res({}); } }); }
  async function _mlsPushVisit(goal, trustedOrigin, patient) {
    // v1.26: results/progress go ONLY to the trusted MLS origin that initiated the push,
    // never '*' -- so a hostile page can't observe the autopilot's PHI-bearing progress.
    var _to = trustedOrigin || 'https://mlsscribe.com';
    var post = function (type, payload) { try { window.postMessage(Object.assign({ source: 'mls-ext', type: type }, payload || {}), _to); } catch (e) {} };
    if (!goal) { post('mlsAppPushResult', { resp: { error: 'Nothing to push.' } }); return; }
    /* v2.00 ORDERS POLICY (owner-directed, 2026-07-10 night): the v1.52
       categorical ORDER hard-block is LIFTED — orders are now a valid,
       doctor-driven write destination. Every other gate is UNCHANGED and
       still applies to orders: the identity gate below must pass, the run is
       an explicit doctor action, and the autopilot's deny-list still refuses
       Save/Sign/Post/Approve/Submit-class clicks — MLS enters content but
       never finalizes. A caution is surfaced because athenaOne executes
       orders on ITS OWN submit, which stays in the doctor's hands. */
    if (/open the ORDERS? area|\bORDER ENTRY\b/i.test(String(goal).slice(0, 300))) {
      post('mlsAppPushProgress', { msg: '⚠ Orders destination: MLS will fill order content but NEVER submits/signs — review and submit the order in athenaOne yourself.' });
    }
    /* v1.51 WRITEBACK TARGETING GATE (v1.52-hardened): verify the OPEN athena
       encounter belongs to the patient this push is FOR, before the autopilot
       types a single character. Wrong chart open → refuse loudly, nothing
       written. v1.52: when the app didn't send a patient (older app build),
       fall back to the ACTIVE patient shown in the MLS patient bar ON THIS
       PAGE — the push is by definition for that patient — so the safe-write
       guarantee does not depend on the app pack being deployed. If neither is
       readable, ANNOUNCE whose chart is open. Stop-before-Save/Sign unchanged. */
    try {
      if (!(patient && patient.name)) {
        /* Deterministic source: the app's own storage (content scripts share the
           page's localStorage). uns()-namespaced keys: sf_u::<email>::activePt
           holds the active patient id; ::patients holds the records. The pushed
           note is BY DEFINITION for the active patient, so gating on it can not
           false-refuse a legitimate push. Unreadable → announce-only (v1.51). */
        try {
          var aid = null, ptsRaw = null;
          for (var ki = 0; ki < localStorage.length; ki++) {
            var kk = localStorage.key(ki);
            if (/::activePt$/.test(kk)) aid = String(localStorage.getItem(kk) || '').replace(/^"|"$/g, '');
            else if (/::patients$/.test(kk)) ptsRaw = localStorage.getItem(kk);
          }
          if (aid && ptsRaw) {
            var ptsArr = JSON.parse(ptsRaw);
            var ap = null;
            for (var pi = 0; pi < ptsArr.length; pi++) { if (ptsArr[pi] && String(ptsArr[pi].id) === aid) { ap = ptsArr[pi]; break; } }
            if (ap && ap.name) {
              patient = { name: String(ap.name), dob: String(ap.dob || '') };
              post('mlsAppPushProgress', { msg: 'Write-safety: verifying against the active MLS patient (' + patient.name + ').' });
            }
          }
        } catch (e0) {}
      }
      var idr = await _bg('mlsAssistChartIdentity');
      var openId = (idr && idr.ok && idr.identity) ? idr.identity : null;
      if (patient && patient.name && openId && openId.name) {
        var _nn = function (s) { return String(s || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (x) { return x.length > 1; }); };
        var ta = _nn(patient.name), tb = _nn(openId.name);
        var ov = ta.filter(function (x) { return tb.indexOf(x) >= 0; }).length;
        var match = ov >= 2 || (ov >= 1 && Math.min(ta.length, tb.length) === 1);
        if (!match) {
          post('mlsAppPushResult', { resp: { ok: false, reason: 'wrong-chart',
            error: 'The open athenaOne encounter belongs to ' + openId.name + ', not ' + patient.name + '. NOTHING was written. Open ' + patient.name + '’s encounter in Athena, then push again.' } });
          return;
        }
        post('mlsAppPushProgress', { msg: '✓ Verified: the open athena encounter is ' + openId.name + (openId.dob ? (' (DOB ' + openId.dob + ')') : '') + ' — entering the visit there.' });
      } else if (openId && openId.name) {
        post('mlsAppPushProgress', { msg: 'Entering into the OPEN athena encounter: ' + openId.name + ' — make sure that is the right patient.' });
      } else if (patient && patient.name) {
        post('mlsAppPushResult', { resp: { ok: false, reason: 'unverified',
          error: 'Could not verify whose encounter is open in athenaOne. Open ' + patient.name + '’s encounter (the chart page, not a list), then push again. NOTHING was written.' } });
        return;
      }
    } catch (e) { /* identity probe crashed — fall through with the announce-only behavior */ }
    var history = [], lastSig = '', sameN = 0;
    post('mlsAppPushProgress', { msg: 'Starting — reading the Athena encounter…' });
    try {
      for (var step = 0; step < 60; step++) {
        post('mlsAppPushProgress', { msg: 'Entering the visit into Athena… step ' + (step + 1) });
        var cap = await _bg('mlsAssistCapture');
        var pt = await _bg('mlsAssistPageText'); var pageText = (pt && pt.text) || '';
        if (pageText.replace(/\s/g, '').length < 40) { await new Promise(function (r) { setTimeout(r, 1300); }); pt = await _bg('mlsAssistPageText'); pageText = (pt && pt.text) || ''; }
        var els = await _bg('mlsAssistElements'); var elements = (els && els.list) || [];
        var resp = await _bg('mlsAssistAgentStep', { goal: goal, pageText: pageText, screenshot: (cap && cap.dataUrl) || '', history: history, elements: elements });
        if (!resp || resp.error) { post('mlsAppPushResult', { resp: { ok: false, error: (resp && resp.error) || 'no response from the AI' } }); return; }
        var a = resp.action || {}; if (resp.reasoning) post('mlsAppPushProgress', { msg: '(' + (step + 1) + ') ' + String(resp.reasoning).slice(0, 110) });
        history.push({ type: a.type, target: a.target });
        // Loop-guard keyed on type+target+a coarse page signature, so legitimately repeating
        // the SAME control on a CHANGED screen (e.g. adding several diagnoses) isn't blocked.
        var sig = (a.type || '') + '|' + (a.target || '') + '|' + pageText.length;
        if (sig === lastSig) sameN++; else { sameN = 0; lastSig = sig; }
        if (sameN >= 4) { post('mlsAppPushResult', { resp: { ok: true, partial: true, msg: 'Got stuck repeating a step — paused. Review Athena and finish the rest manually.' } }); return; }
        if (a.type === 'done') { post('mlsAppPushResult', { resp: { ok: true, msg: 'Entered the visit into Athena. Review everything and sign it there.' } }); return; }
        if (a.type === 'confirm') { post('mlsAppPushResult', { resp: { ok: true, paused: true, msg: 'Everything is entered. Athena is asking to Save/Sign — review it and click Sign yourself.' } }); return; }
        if (a.type === 'ask') { post('mlsAppPushResult', { resp: { ok: true, paused: true, msg: 'Athena needs a choice from you: ' + (a.target || a.reasoning || '') + '. Handle that, then re-run.' } }); return; }
        if (a.type === 'switchtab') { await _bg('mlsAssistExec', { action: a }); await new Promise(function (r) { setTimeout(r, 1200); }); continue; }
        await _bg('mlsAssistExec', { action: a });
        await new Promise(function (r) { setTimeout(r, 850); });
      }
      post('mlsAppPushResult', { resp: { ok: true, partial: true, msg: 'Entered as much as I could — review Athena and finish any remaining fields, then sign.' } });
    } catch (e) { post('mlsAppPushResult', { resp: { ok: false, error: String((e && e.message) || e) } }); }
  }

  // Mode C orchestrator: tell the background to FILL+RUN the athenaOne search, then page
  // through every result page (read -> Next -> read ...) accumulating the row text, and hand
  // the whole thing back to the MLS app to parse + verify + import. Progress is posted ONLY to
  // the trusted MLS origin that started it (never '*'). The background does all DOM work in the
  // signed-in athenaOne tab via chrome.scripting; this content script never touches Athena DOM.
  function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  async function _mlsSearchProcedure(params, cfg, trustedOrigin) {
    var _to = trustedOrigin || 'https://mlsscribe.com';
    var post = function (type, payload) { try { window.postMessage(Object.assign({ source: 'mls-ext', type: type }, payload || {}), _to); } catch (e) {} };
    cfg = cfg || {};
    var pageWait = cfg.pageWaitMs || 1600, initWait = cfg.initialWaitMs || 2200, maxPages = cfg.maxPages || 60;
    try {
      post('mlsAppSearchProgress', { msg: 'Asking athenaOne to run the procedure search...' });
      var fill = await _bg('mlsAppSearchFill', { params: params, cfg: cfg });
      if (!fill || !fill.ok) { post('mlsAppSearchResult', { resp: { ok: false, error: (fill && fill.error) || 'Could not reach your athenaOne tab.' } }); return; }
      var tabId = fill.tabId;
      if (!(fill.acted && fill.acted.acted)) {
        post('mlsAppSearchResult', { resp: { ok: false, code: 'NO_FORM', error: 'Could not find the procedure-search fields on your athenaOne screen. Open the procedure/claims report or charge-search page (so the CPT/procedure + date filters are visible), or tune window.__mlsStudyConfig.search, then retry. You can also run the report yourself and use the read-only Find in Athena.' } }); return;
      }
      await _sleep(initWait);
      var io = {
        read: function () { return _bg('mlsAppSearchRead', { tabId: tabId, cfg: cfg }); },
        next: function () { return _bg('mlsAppSearchNext', { tabId: tabId, cfg: cfg }); }
      };
      var result = await mlsPaginate(io, {
        maxPages: maxPages,
        wait: function () { return _sleep(pageWait); },
        onProgress: function (pages, rows) { post('mlsAppSearchProgress', { msg: 'Read page ' + pages + ' (' + rows + ' rows on this page)...' }); }
      });
      post('mlsAppSearchResult', { resp: { ok: true, text: result.text || '', pages: result.pages || 0, ranControls: fill.acted } });
    } catch (e) { post('mlsAppSearchResult', { resp: { ok: false, error: String((e && e.message) || e) } }); }
  }

  /*MLS_PAGINATE_START*/
  async function mlsPaginate(io, opts) {
    opts = opts || {};
    var maxPages = opts.maxPages || 60;
    var seen = {}, pages = 0, all = '';
    var onProgress = opts.onProgress || function () {};
    for (var p = 0; p < maxPages; p++) {
      var rd = await io.read();
      if (!rd || !rd.ok) break;
      pages++;
      var dup = !!(rd.sig && seen[rd.sig]);
      if (rd.text && !dup) { if (all.length < 300000) all += (all ? '\n' : '') + rd.text; }
      if (rd.sig) seen[rd.sig] = 1;
      onProgress(pages, rd.rowCount || 0);
      if (dup) break;
      if (!rd.hasNext) break;
      var nx = await io.next();
      if (!nx || !nx.clicked) break;
      if (opts.wait) { await opts.wait(); }
    }
    return { text: all, pages: pages };
  }
  /*MLS_PAGINATE_END*/

  // --- custom hover tooltips: appear only after the cursor rests ~2s on a button ---
  (function () {
    var DELAY = 2000, tipEl = null, timer = null, currentEl = null;
    function ensure() { if (tipEl) return tipEl; tipEl = document.createElement('div'); tipEl.id = 'mls-tip'; (document.body || document.documentElement).appendChild(tipEl); return tipEl; }
    function show(el) {
      if (!el || !el.getAttribute) return;
      var txt = el.getAttribute('data-tip'); if (!txt) return;
      var t = ensure(); t.textContent = txt; t.style.display = 'block'; t.style.opacity = '0';
      var r = el.getBoundingClientRect(), tw = t.offsetWidth, th = t.offsetHeight;
      var left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), window.innerWidth - tw - 8);
      var top = r.top - th - 8; if (top < 8) top = r.bottom + 8;
      t.style.left = left + 'px'; t.style.top = top + 'px'; t.style.opacity = '1';
    }
    function hide() { if (timer) { clearTimeout(timer); timer = null; } if (tipEl) tipEl.style.display = 'none'; }
    document.addEventListener('mouseover', function (e) {
      var el = (e.target && e.target.closest) ? e.target.closest('[data-tip]') : null;
      if (el === currentEl) return;
      currentEl = el; hide();
      if (el) timer = setTimeout(function () { show(el); }, DELAY);
    }, true);
    document.addEventListener('mousedown', hide, true);
    window.addEventListener('scroll', hide, true);
  })();

  // --- remember the last editable field the user focused (the note field) ---
  let lastEditable = null;
  function isEditable(el) {
    if (!el) return false;
    const t = (el.tagName || '').toUpperCase();
    if (t === 'TEXTAREA') return true;
    if (t === 'INPUT') return /^(text|search|email|url|tel|)$/i.test(el.type || '');
    return !!el.isContentEditable;
  }
  document.addEventListener('focusin', e => { if (isEditable(e.target)) lastEditable = e.target; }, true);
  // Smart note-field detection so the doctor doesn't have to click the field first.
  function bestNoteField() {
    if (isEditable(lastEditable)) return lastEditable;
    if (isEditable(document.activeElement)) return document.activeElement;
    const cands = [...document.querySelectorAll('textarea,[contenteditable=""],[contenteditable="true"]')].filter(el => { const r = el.getBoundingClientRect(); return r.width > 120 && r.height > 36 && r.bottom > 0 && r.top < innerHeight; });
    // v1.26: score by identity (label/aria/placeholder/name/id + associated <label>) + size,
    // so a real note field beats a large search/chat box; falls back to largest-area when
    // identity is ambiguous, so the v1.25 behavior still holds (no regression).
    function _hay(el){ var h=((el.getAttribute&&(el.getAttribute('aria-label')||el.getAttribute('placeholder')||el.getAttribute('name')||el.getAttribute('title')||el.id))||''); try{ if(el.id){ var lb=document.querySelector('label[for="'+el.id+'"]'); if(lb) h+=' '+(lb.textContent||''); } }catch(e){} return String(h).toLowerCase(); }
    function _score(el){ var r=el.getBoundingClientRect(); var s=Math.min(r.width*r.height,400000)/1000; var h=_hay(el); if(/note|hpi|assess|plan|soap|progress|narrative|subjective|objective|chief|complaint|document|free.?text|encounter|impression|history of present/.test(h)) s+=1000; if(/search|find|lookup|filter|chat|messag|comment|reason for|address|e-?mail|phone|\bnpi\b|\bmrn\b|patient.?id|claim|invoice|login|password|user.?name|\bzip\b|\bcity\b|\bstate\b/.test(h)) s-=1500; if((el.tagName||'')==='TEXTAREA') s+=120; if(el.isContentEditable) s+=100; return s; }
    cands.sort((a, b) => _score(b) - _score(a));
    return cands[0] || null;
  }

  // --- build UI ---
  const badge = document.createElement('div');
  badge.id = 'mls-assist-badge';
  badge.innerHTML = '<span class="dot"></span>🩺 MLS Assist';
  badge.setAttribute('data-tip', 'Open MLS Assist — dictate, draft, and insert your note');

  const panel = document.createElement('div');
  panel.id = 'mls-assist-panel';
  var SECH = 'font-weight:800;font-size:11.5px;color:#15528f;letter-spacing:.2px;margin:15px 0 7px;display:flex;align-items:center;gap:7px';
  var NUM = 'display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:#1f7ae0;color:#fff;font-size:11px;font-weight:800;flex:none';
  panel.innerHTML = [
    '<header><b>🩺 MLS Assist</b><span class="x" data-tip="Close MLS Assist">×</span></header>',
    '<div class="body">',
    '  <div class="consent">Dictate or select the visit → MLS drafts the note → it goes into the chart <b>only when you click</b>. You review everything.</div>',

    '  <div style="' + SECH + '"><span style="' + NUM + '">1</span> Capture the visit</div>',
    '  <textarea id="mls-tx" rows="4" placeholder="Press 🎙 Dictate and talk through the visit — or paste / highlight text from the chart."></textarea>',
    '  <div class="row">',
    '    <button class="b b-rec" id="mls-rec" data-tip="Dictate the visit out loud — MLS transcribes as you talk">🎙 Dictate</button>',
    '    <button class="b b-ghost" id="mls-sel" data-tip="Use the text you have highlighted on the chart as the visit context">Use selection</button>',
    '    <button class="b b-ghost" id="mls-clr" data-tip="Clear the transcript and the drafted note">Clear</button>',
    '  </div>',

    '  <div style="' + SECH + '"><span style="' + NUM + '">2</span> Write &amp; insert the note</div>',
    '  <div class="row"><button class="b b-go" id="mls-gen" data-tip="Turn the transcript into a structured clinical note" style="flex:1">✨ Generate note</button></div>',
    '  <textarea id="mls-note" rows="6" placeholder="Your drafted note appears here — review it before inserting." style="margin-top:7px"></textarea>',
    '  <div class="row">',
    '    <button class="b b-primary" id="mls-ins" data-tip="Drops the drafted note straight into your EMR note field — it finds the field for you (one-shot paste)" style="flex:1">⤵ Insert into chart</button>',
    '    <button class="b b-ghost" id="mls-cpy" data-tip="Copy the drafted note to your clipboard">Copy</button>',
    '  </div>',

    '  <div style="' + SECH + '"><span style="' + NUM + '">3</span> Pull the chart into MLS</div>',
    '  <div class="row"><button class="b b-ghost" id="mls-cap" data-tip="Read this patient and their prior visits into MLS — nothing is written back to the EMR" style="flex:1">📋 Capture chart → MLS</button></div>',
    '  <div class="consent" style="margin-top:6px">Reads the patient + prior visits off this page into MLS (encrypted). Nothing is written back to the EMR.</div>',

    '  <div class="log" id="mls-log"></div>',
    '</div>'
  ].join('');

  // v1.47 — auto-show the floating "🩺 MLS Assist" badge ONLY where it belongs: athenaOne
  // (the doctor's EMR) and any host the user explicitly allowlists. This stops the pill from
  // appearing on random non-EMR tabs (Render, Gmail, news, etc.) and from DUPLICATING the MLS
  // web app's own assistant on mlsscribe.com. The panel is still injected on every page and the
  // toolbar icon (mlsOpenPanel) opens it anywhere, so nothing is disabled — athenaOne write-back
  // is fully preserved. Set chrome.storage.local 'mlsBadgeHosts' (or window.__mlsBadgeHosts) to
  // an array of extra EMR hostnames to auto-show elsewhere.
  function _mlsAutoBadge() {
    try {
      var h = (location.hostname || '').toLowerCase();
      if (!h) return false;
      if (h === 'mlsscribe.com' || h === 'www.mlsscribe.com' || h.endsWith('.mlsscribe.com')) return false;
      /* v2.9.8 (owner directive): on athenaOne the NEW floating widget (mls-popup
         "MLS · Ready — Go / Pick a patient") is THE surface — the legacy
         Dictate/Generate/Insert panel's corner badge no longer auto-shows there.
         The panel machinery stays intact: the extension toolbar icon (mlsOpenPanel)
         still opens it deliberately, and non-athena EMR hosts are unchanged. */
      if (h === 'athenahealth.com' || h.endsWith('.athenahealth.com')) return false;
      try { var ex = window.__mlsBadgeHosts; if (Array.isArray(ex) && ex.some(function (x) { x = String(x).toLowerCase(); return h === x || h.endsWith('.' + x); })) return true; } catch (e) {}
      return false;
    } catch (e) { return false; }
  }
  document.documentElement.appendChild(panel);
  if (_mlsAutoBadge()) {
    document.documentElement.appendChild(badge);
  } else {
    // Not a known EMR page: load any user allowlist async, and show the badge without a reload
    // if this host turns out to be allowlisted.
    try {
      chrome.storage && chrome.storage.local && chrome.storage.local.get(['mlsBadgeHosts'], function (r) {
        try {
          var list = (r && r.mlsBadgeHosts) || [];
          if (list.length) { window.__mlsBadgeHosts = list; if (_mlsAutoBadge() && !document.getElementById('mls-assist-badge')) document.documentElement.appendChild(badge); }
        } catch (e) {}
      });
    } catch (e) {}
  }

  const $ = s => panel.querySelector(s);
  const tx = $('#mls-tx'), noteBox = $('#mls-note'), logBox = $('#mls-log');
  function log(m) { const d = document.createElement('div'); d.textContent = '• ' + m; logBox.prepend(d); }

  function mlsVerCmp(a, b) { a = String(a).split('.').map(Number); b = String(b).split('.').map(Number); for (let i = 0; i < Math.max(a.length, b.length); i++) { const x = a[i] || 0, y = b[i] || 0; if (x > y) return 1; if (x < y) return -1; } return 0; }
  let _updChecked = false;
  async function checkForUpdate() {
    if (_updChecked) return; _updChecked = true;
    try {
      const cur = chrome.runtime.getManifest().version;
      const r = await fetch('https://mlsscribe.com/extension-version.json?t=' + Date.now());
      const d = await r.json();
      if (d && d.version && mlsVerCmp(d.version, cur) > 0) {
        // v1.42 fix #5: the version + url come from a fetched JSON, so treat them as untrusted.
        // Only accept an https mlsscribe.com download URL, and build the banner from DOM nodes
        // (no innerHTML) so a tampered feed can't inject markup or a javascript: link.
        let url = 'https://mlsscribe.com/assist.html';
        try { const uu = new URL(d.url); if (uu.protocol === 'https:' && (uu.hostname === 'mlsscribe.com' || uu.hostname === 'www.mlsscribe.com' || uu.hostname.endsWith('.mlsscribe.com'))) url = uu.href; } catch (e) {}
        const safeVer = String(d.version).replace(/[^0-9.]/g, '').slice(0, 20);
        const bn = document.createElement('div');
        bn.style.cssText = 'background:#fff7e6;border:1px solid #f0d9a0;border-radius:8px;padding:8px 10px;margin:0 0 8px;font-size:12.5px;color:#8a5a00';
        bn.appendChild(document.createTextNode('\u{1F504} '));
        const bEl = document.createElement('b'); bEl.textContent = 'Update available'; bn.appendChild(bEl);
        bn.appendChild(document.createTextNode(' (v' + safeVer + '). '));
        const aEl = document.createElement('a'); aEl.textContent = 'Download'; aEl.setAttribute('href', url); aEl.setAttribute('target', '_blank'); aEl.setAttribute('rel', 'noopener noreferrer'); aEl.style.cssText = 'color:#1f7ae0;font-weight:700'; bn.appendChild(aEl);
        bn.appendChild(document.createTextNode(', then reload it at chrome://extensions.'));
        const body = panel.querySelector('.body'); if (body) body.insertBefore(bn, body.firstChild);
        log('A newer version of MLS Assist is available.');
      }
    } catch (e) {}
  }
  badge.addEventListener('click', () => {
    const open = panel.classList.toggle('open');
    if (open) { log('Panel opened — capture is active.'); checkForUpdate(); }
  });
  $('.x').addEventListener('click', () => { panel.classList.remove('open'); stopRec(); });
  chrome.runtime.onMessage.addListener((m, s, send) => { if (m && m.type === 'mlsOpenPanel') { panel.classList.add('open'); log('Opened MLS Assist from the toolbar.'); try { send && send({ ok: true }); } catch (e) {} return true; } return false; /* v1.42 fix #7: only hold the message port for messages we actually answer, so other messages don't error with "port closed before a response". */ });

  // --- live dictation (Web Speech API) ---
  let rec = null, recing = false;
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recBtn = $('#mls-rec');
  if (!SR) { recBtn.disabled = true; recBtn.textContent = '🎙 (no speech support)'; }
  function startRec() {
    if (!SR) return;
    rec = new SR(); rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = true;
    // v1.42 fix #1: append dictation to the CURRENT field value on every final result,
    // so anything the doctor types while dictating is never overwritten.
    rec.onresult = (e) => {
      let finalTxt = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalTxt += e.results[i][0].transcript + ' ';
      }
      if (finalTxt) {
        const cur = tx.value;
        tx.value = cur + (cur && !/\s$/.test(cur) ? ' ' : '') + finalTxt.trim() + ' ';
        try { tx.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {}
      }
    };
    // v1.42 fix #4: only flip to the recording state once capture ACTUALLY starts.
    rec.onstart = () => { if (recing) { recBtn.textContent = '⏹ Stop'; badge.classList.add('active'); } };
    rec.onerror = (e) => {
      const err = (e && e.error) || 'error';
      log('Dictation: ' + err);
      // Permission / capture failures mean nothing is recording — clear the fake "recording" state.
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        recing = false; recBtn.textContent = '🎙 Dictate'; badge.classList.remove('active');
      }
    };
    // v1.42 fix #2: Web Speech ends itself periodically; restart to stay continuous, but if the
    // restart fails, say so honestly instead of leaving a live "Stop" button over a dead mic.
    rec.onend = () => {
      if (!recing) return;
      setTimeout(() => {
        if (!recing) return;
        try { rec.start(); }
        catch (err) {
          recing = false; recBtn.textContent = '🎙 Dictate'; badge.classList.remove('active');
          log('Dictation stopped unexpectedly — tap 🎙 Dictate to resume.');
        }
      }, 250);
    };
    try { recing = true; recBtn.textContent = '… starting'; rec.start(); log('Dictation started.'); }
    catch (e) { recing = false; recBtn.textContent = '🎙 Dictate'; badge.classList.remove('active'); log('Could not start mic.'); }
  }
  function stopRec() {
    recing = false; if (rec) { try { rec.stop(); } catch (e) {} } recBtn.textContent = '🎙 Dictate'; badge.classList.remove('active');
  }
  recBtn.addEventListener('click', () => { recing ? (stopRec(), log('Dictation stopped.')) : startRec(); });

  // --- use page selection ---
  $('#mls-sel').addEventListener('click', () => {
    const sel = (window.getSelection ? window.getSelection().toString() : '').trim();
    if (!sel) { log('No text selected on the page.'); return; }
    tx.value = (tx.value ? tx.value + '\n\n' : '') + sel; log('Added ' + sel.length + ' chars from selection.');
  });
  $('#mls-clr').addEventListener('click', () => { tx.value = ''; noteBox.value = ''; });

  // --- generate (key + network handled by the background worker) ---
  $('#mls-gen').addEventListener('click', () => {
    const transcript = tx.value.trim();
    if (!transcript) { log('Add a transcript or selection first.'); return; }
    const btn = $('#mls-gen'); btn.disabled = true; btn.textContent = '… generating';
    chrome.runtime.sendMessage({ type: 'mlsAssistGenerate', transcript }, (resp) => {
      btn.disabled = false; btn.textContent = '✨ Generate note';
      if (!resp) { log('No response (extension reloaded?).'); return; }
      if (resp.error) { log('Error: ' + resp.error); return; }
      noteBox.value = resp.note || '';
      log('Note drafted' + (resp.model ? ' (' + resp.model + ')' : '') + ' — review, then Insert.');
    });
  });

  // --- capture the whole chart (read all data) into MLS ---
  $('#mls-cap').addEventListener('click', () => {
    const pageText = ((document.body && document.body.innerText) || '').trim().slice(0, 20000);
    if (!pageText) { log('Nothing readable on this page to capture.'); return; }
    const btn = $('#mls-cap'); btn.disabled = true; btn.textContent = '… capturing chart';
    chrome.runtime.sendMessage({ type: 'mlsAssistExtract', pageText, url: location.href }, (resp) => {
      btn.disabled = false; btn.textContent = '📋 Capture whole chart → MLS';
      if (!resp) { log('No response (extension reloaded?).'); return; }
      if (resp.ok) { log('✓ Captured ' + (resp.patient || 'patient') + ' + ' + (resp.visits || 0) + ' prior visit(s) into MLS.'); return; }
      log('Capture: ' + (resp.error || 'no patient identity found on this page.'));
    });
  });

  // --- insert into the focused EMR field (v1.28: patient-gated, section-routed) ---
  // v1.28 — hardened, VERIFIED text entry (same logic as background mlsRobustType):
  // resolves a real editable field from a label/wrapper, clicks+focuses, native-setter ->
  // simulated paste -> per-character keystrokes (mask-aware), then selects a matching
  // typeahead suggestion, and re-reads after a settle + blur to confirm. Returns a boolean.
  async function _robustType(el, txt) {
    txt = String(txt == null ? '' : txt);
    var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
    function _isEd(e) { if (!e || !e.tagName) return false; if (e.isContentEditable) return true; var tg = e.tagName.toUpperCase(); if (tg === 'TEXTAREA') return true; if (tg === 'INPUT') { var t = (e.getAttribute('type') || 'text').toLowerCase(); return /^(text|search|email|url|tel|number|password|date|month|week|time|datetime-local|)$/.test(t); } return false; }
    function _resolve(e) { if (_isEd(e)) return e; if (!e || !e.tagName) return e; try { if (e.tagName.toUpperCase() === 'LABEL') { var f = e.getAttribute('for'); if (f) { var byId = document.getElementById(f); if (_isEd(byId)) return byId; } var within = e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(within)) return within; } } catch (e2) {} try { var n = e.querySelector && e.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(n)) return n; } catch (e3) {} try { var p = e.parentElement, d = 0; while (p && d < 3) { var inp = p.querySelector && p.querySelector('input:not([type=hidden]),textarea,[contenteditable=""],[contenteditable="true"]'); if (_isEd(inp)) return inp; p = p.parentElement; d++; } } catch (e5) {} return e; }
    el = _resolve(el);
    if (!el || !_isEd(el) || el.readOnly || el.disabled) return false;
    var CE = !!el.isContentEditable;
    function rd() { return CE ? (el.innerText || el.textContent || '') : (el.value || ''); }
    function norm(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
    function digits(s) { return String(s || '').replace(/\D/g, ''); }
    function isMasked() { try { if (CE) return false; var t = (el.getAttribute('type') || '').toLowerCase(); if (t === 'date' || t === 'tel') return true; var ph = el.getAttribute('placeholder') || ''; if (/[\/\-.]/.test(ph) && /[mdyhMDYH#0_]/.test(ph)) return true; if (el.getAttribute('inputmode') === 'numeric') return true; if (el.getAttribute('data-mask') || el.getAttribute('pattern')) return true; var ml = el.maxLength; if (ml && ml > 0 && ml <= 12 && /[\/\-.]/.test(ph)) return true; } catch (e) {} return false; }
    var masked = isMasked();
    function landed() { var cur = rd(); if (!cur && txt) return false; var a = norm(cur), b = norm(txt); if (!b) return true; if (a.indexOf(b.slice(0, Math.min(b.length, 40))) >= 0) return true; if (masked) { var dc = digits(cur), dt = digits(txt); if (dt && dc.indexOf(dt) >= 0) return true; } return cur.replace(/\s+/g, '').length >= Math.min(txt.replace(/\s+/g, '').length, 15); }
    function setNative(v) { if (CE) { try { el.textContent = v; } catch (e) {} return; } var pr = (el.tagName === 'TEXTAREA') ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; var d = Object.getOwnPropertyDescriptor(pr, 'value'); if (d && d.set) d.set.call(el, v); else el.value = v; }
    function fireInput(data, type) { try { el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: type || 'insertText', data: data })); } catch (e) { try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {} } }
    function clearField() { try { if (!CE && el.setSelectionRange) el.setSelectionRange(0, (el.value || '').length); } catch (e) {} setNative(''); fireInput('', 'deleteContentBackward'); }
    function _vis(e) { try { var r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; var s = getComputedStyle(e); return s.display !== 'none' && s.visibility !== 'hidden'; } catch (e2) { return true; } }
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    try { el.click(); } catch (e) {}
    try { el.focus(); } catch (e) {}
    await sleep(0);
    async function keystroke() { clearField(); for (var i = 0; i < txt.length; i++) { var ch = txt.charAt(i); try { el.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keypress', { key: ch, bubbles: true })); } catch (e) {} if (CE) { var ok; try { ok = document.execCommand('insertText', false, ch); } catch (e) { ok = false; } if (!ok) setNative(rd() + ch); } else { var base = (el.value != null) ? el.value : ''; setNative(base + ch); } fireInput(ch, 'insertText'); try { el.dispatchEvent(new KeyboardEvent('keyup', { key: ch, bubbles: true })); } catch (e) {} await sleep(masked ? 18 : 6); } try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
    async function pickSuggestion() { await sleep(320); var opts = []; var ac = el.getAttribute && (el.getAttribute('aria-controls') || el.getAttribute('aria-owns')); if (ac) { var box = document.getElementById(ac); if (box) opts = [].slice.call(box.querySelectorAll('[role=option],li,.option,.item')).filter(_vis); } if (!opts.length) opts = [].slice.call(document.querySelectorAll('[role=option],[role=listbox] li,.autocomplete-item,.suggestion,.typeahead-option,ul[class*=auto] li,ul[class*=suggest] li,li[class*=option]')).filter(_vis); if (!opts.length) { var lists = [].slice.call(document.querySelectorAll('ul,ol,[role=listbox],[role=menu]')).filter(_vis); for (var L = 0; L < lists.length && !opts.length; L++) { var items = [].slice.call(lists[L].querySelectorAll('li,[role=option],[role=menuitem]')).filter(_vis); if (items.length && items.length <= 25) opts = items; } } if (!opts.length) return false; var want = norm(txt), pick = null; for (var i = 0; i < opts.length; i++) { if (norm(opts[i].textContent).indexOf(want) >= 0) { pick = opts[i]; break; } } if (!pick) pick = opts[0]; if (!pick) return false; try { pick.scrollIntoView({ block: 'center' }); } catch (e) {} var r = pick.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2, o = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y }; ['pointerover', 'mouseover', 'pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach(function (tp) { try { pick.dispatchEvent(new (tp.indexOf('pointer') === 0 ? PointerEvent : MouseEvent)(tp, o)); } catch (e) {} }); try { pick.click(); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true })); } catch (e) {} await sleep(150); return true; }
    var method = '';
    if (!masked) {
      try { try { el.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true })); } catch (e) {} if (CE) { try { var rg = document.createRange(); rg.selectNodeContents(el); var se = window.getSelection(); se.removeAllRanges(); se.addRange(rg); } catch (e) {} try { el.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: txt })); } catch (e) {} var _ec; try { _ec = document.execCommand('insertText', false, txt); } catch (e) { _ec = false; } if (!_ec) setNative(txt); } else { clearField(); setNative(txt); } fireInput(txt, 'insertText'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} try { el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true })); } catch (e) {} } catch (e) {}
      await sleep(0); if (landed()) method = 'native';
      if (!method) { try { var dt = new DataTransfer(); dt.setData('text/plain', txt); el.focus(); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt })); fireInput(txt, 'insertFromPaste'); try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} } catch (e) {} await sleep(0); if (landed()) method = 'paste'; }
    }
    if (!method && txt.length <= 4000) { try { await keystroke(); } catch (e) {} if (landed()) method = 'keystroke'; }
    var picked = false; try { picked = await pickSuggestion(); } catch (e) {}
    if (picked) await sleep(60);
    await sleep(120);
    if (!landed()) { try { el.dispatchEvent(new Event('blur', { bubbles: true })); } catch (e) {} await sleep(80); }
    return landed();
  }
  function localPaste(target, note) { return _robustType(target, note); }
  function clipFallback(note) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(note).then(function () { log('Couldn’t reach the field — copied the note instead. Click into the right field and press Ctrl/Cmd + V.'); }, function () { log('Couldn’t reach the field, and copy was blocked. Click into the field, then try again.'); });
    } else { log('Couldn’t reach the field. Click into the field and try again.'); }
  }
  // remove any leftover override button from a previous attempt
  function _clearOverride() { try { var b = panel.querySelector('#mls-ins-override'); if (b) b.remove(); } catch (e) {} }
  // dob shown only in the doctor's own browser; nothing is logged off-device
  function _short(name, dob) { var s = (name || '').trim(); if (dob) s += (s ? ' ' : '') + '(' + dob + ')'; return s || 'unknown'; }
  function _renderWrite(resp) {
    _clearOverride();
    if (!resp) { clipFallback(noteBox.value.trim()); return; }
    if (resp.error) { log('⚠ ' + resp.error); return; }
    // PATIENT GATE blocked the write
    if (resp.blocked) {
      var p = resp.patient || {};
      if (resp.patientStatus === 'mismatch') {
        log('⛔ PATIENT MISMATCH — nothing was written. MLS active patient: ' + _short(p.mlsName, p.mlsDob) + ' · Athena chart shows: ' + _short(p.athName, p.athDob) + '. Open the correct chart (or switch the MLS patient) so they match, then Insert again.');
      } else {
        log('⛔ Could not verify the patient — nothing was written. MLS: ' + _short(p.mlsName, p.mlsDob) + ' · Athena chart read: ' + _short(p.athName, p.athDob) + '. Make sure the patient chart is open in Athena and the right patient is active in MLS.');
      }
      // offer an explicit, consent-based override
      try {
        var btn = document.createElement('button'); btn.id = 'mls-ins-override'; btn.className = 'b';
        btn.style.cssText = 'margin-top:6px;width:100%;border:1px solid #c0392b;color:#c0392b;background:#fff5f4;font-weight:700';
        btn.textContent = '⚠ Insert anyway — I confirmed this is the right patient';
        btn.addEventListener('click', function () { _clearOverride(); log('Override confirmed — writing…'); _doVerifiedWrite(noteBox.value.trim(), true); });
        var host = panel.querySelector('#mls-log'); if (host && host.parentNode) host.parentNode.insertBefore(btn, host);
      } catch (e) {}
      return;
    }
    // MATCH (or override): show who, then each field that was written
    var pt = resp.patient || {};
    log('✓ Found patient: ' + _short(pt.athName || pt.mlsName, pt.athDob || pt.mlsDob) + (resp.forced ? ' (override)' : '') + ' — writing to this chart.');
    var wr = resp.wrote || [];
    if (!wr.length) { log('⚠ Patient verified, but I found no matching field to write into. Open the section you want and click its field, then Insert.'); return; }
    var okN = 0, badN = 0;
    wr.forEach(function (w) {
      if (w.confirmed) { okN++; log('   ✓ ' + (w.targetLabel || w.section) + (w.chosenLabel && w.chosenLabel !== w.targetLabel ? ' (' + w.chosenLabel + ')' : '') + ' — verified.'); }
      else if (w.notfound) { badN++; log('   ⚠ ' + (w.targetLabel || w.section) + ' — no matching field found here (not written).'); }
      else { badN++; log('   ⚠ ' + (w.targetLabel || w.section) + ' — wrote but could not confirm; check before signing.'); }
    });
    log((badN === 0 ? '✓ All sections placed and verified.' : '⚠ ' + okN + ' verified, ' + badN + ' need a check.') + ' Review and sign in your EMR — MLS never saves or signs for you.');
  }
  function _doVerifiedWrite(note, force) {
    if (!note) { log('Nothing to insert yet.'); return; }
    log(force ? 'Writing (override)…' : 'Finding and verifying the patient…');
    try { chrome.runtime.sendMessage({ type: 'mlsVerifiedWrite', note: note, force: !!force }, function (resp) { _renderWrite(resp); }); }
    catch (e) { clipFallback(note); }
  }
  $('#mls-ins').addEventListener('click', () => {
    const note = noteBox.value.trim();
    if (!note) { log('Nothing to paste yet.'); return; }
    // EVERY write goes through the patient-match gate first (no silent top-frame bypass).
    _doVerifiedWrite(note, false);
  });
  $('#mls-cpy').addEventListener('click', () => {
    const txt = noteBox.value || '';
    function ec() {
      try { noteBox.focus(); const s = noteBox.selectionStart, e2 = noteBox.selectionEnd; noteBox.select(); const ok = document.execCommand('copy'); try { noteBox.setSelectionRange(s, e2); } catch (e) {} if (ok) { log('Copied to clipboard.'); return; } } catch (e) {}
      log('Copy blocked — select the note text and press Ctrl/Cmd + C.');
    }
    if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt).then(() => log('Copied to clipboard.'), ec); } else { ec(); }
  });
})();

/* MLS Assist — Stage 2 Autopilot (beta).
   A supervised agent loop: screenshot + page text -> MLS agent brain decides the
   next action -> we execute it on the page -> repeat. Hard safety rail: it never
   commits to the chart; on a Save/Sign it PAUSES and asks the doctor to do it. */
(function () {
  function ready() { const p = document.getElementById('mls-assist-panel'); if (!p) return setTimeout(ready, 600); init(p); }
  ready();
  function init(panel) {
    const body = panel.querySelector('.body'); if (!body || panel.__apInit) return; panel.__apInit = true;
    const log = panel.querySelector('#mls-log'); const L = m => { const d = document.createElement('div'); d.textContent = '⤷ ' + m; log.prepend(d); };
    const wrap = document.createElement('div');
    wrap.style.cssText = 'border-top:1px solid #e8eef6;margin-top:14px;padding-top:4px';
    wrap.innerHTML =
      // Collapsible header — autopilot is advanced, so it stays tucked away until opened.
      '<div id="mls-ap-toggle" style="cursor:pointer;user-select:none;font-weight:800;font-size:11.5px;color:#15528f;letter-spacing:.2px;display:flex;align-items:center;gap:7px;padding:9px 0">' +
        '<span id="mls-ap-caret" style="display:inline-block;transition:transform .15s">▸</span> 🤖 Autopilot <span style="font-weight:500;color:#9aa7b4;font-size:11px">— advanced, optional</span>' +
      '</div>' +
      '<div id="mls-ap-wrap" style="display:none">' +
        '<div class="consent" style="margin:0 0 8px">Tell the agent what to do and it takes the steps on screen while you watch. It <b>pauses before any Save/Sign</b> unless you allow it below.</div>' +
        '<input id="mls-ap-goal" placeholder="e.g. find the note field and insert the visit note" style="width:100%;box-sizing:border-box;border:1px solid #cfe0f3;border-radius:8px;padding:8px;font:13px inherit">' +
        '<div class="row" style="margin-top:6px"><button class="b b-go" id="mls-ap-run" data-tip="Let the agent take the steps toward your goal — it pauses before any Save or Sign" style="flex:1">▶ Run</button><button class="b b-rec" id="mls-ap-stop" data-tip="Stop the autopilot right now" style="display:none">⏹ Stop</button><button class="b b-ghost" id="mls-ap-mic" data-tip="Speak your goal instead of typing it">🎤</button></div>' +
        '<div id="mls-ap-status" style="font-size:12px;color:#5a6a7a;margin:7px 0 0;min-height:15px"></div>' +
        '<div id="mls-ap-pbs" style="display:flex;gap:5px;flex-wrap:wrap;margin:7px 0 0"></div>' +
        '<div id="mls-ap-recs" style="display:flex;gap:5px;flex-wrap:wrap;margin:5px 0 0"></div>' +
        // The rarely-used controls go under a second "More" fold so the menu stays clean.
        '<div id="mls-ap-more-toggle" style="cursor:pointer;user-select:none;font-size:11.5px;color:#6a7a8a;margin-top:9px">＋ More options</div>' +
        '<div id="mls-ap-more" style="display:none;margin-top:7px">' +
          '<div class="row" style="gap:6px"><button class="b b-ghost" id="mls-ap-savepb" data-tip="Save this goal as a one-tap playbook">💾 Save as playbook</button><button class="b b-ghost" id="mls-ap-rec" data-tip="Record the clicks and typing you do, then replay it anytime">⏺ Record a task</button><button class="b b-ghost" id="mls-ap-undo" data-tip="Undo the last text the agent typed into a field">↩ Undo</button></div>' +
          '<label class="row" style="display:flex;align-items:center;gap:6px;margin-top:9px;font-size:12px;color:#8a5a00"><input type="checkbox" id="mls-ap-save" style="width:auto;flex:none"> Let it click Save / Sign on its own (only while watching)</label>' +
        '</div>' +
      '</div>';
    body.appendChild(wrap);
    // toggles for the two collapsibles
    (function () {
      var tg = wrap.querySelector('#mls-ap-toggle'), apw = wrap.querySelector('#mls-ap-wrap'), car = wrap.querySelector('#mls-ap-caret');
      if (tg) tg.addEventListener('click', function () { var open = apw.style.display === 'none'; apw.style.display = open ? 'block' : 'none'; if (car) car.style.transform = open ? 'rotate(90deg)' : 'none'; });
      var mt = wrap.querySelector('#mls-ap-more-toggle'), mm = wrap.querySelector('#mls-ap-more');
      if (mt) mt.addEventListener('click', function () { var open = mm.style.display === 'none'; mm.style.display = open ? 'block' : 'none'; mt.textContent = open ? '－ Fewer options' : '＋ More options'; });
    })();
    const goalI = wrap.querySelector('#mls-ap-goal'), runB = wrap.querySelector('#mls-ap-run'), stopB = wrap.querySelector('#mls-ap-stop');
    const send = (type, extra) => new Promise(res => chrome.runtime.sendMessage(Object.assign({ type }, extra || {}), res));
    let running = false;
    let lastTypeTarget = null;
    function findEl(target) {
      if (!target) return null;
      try { const el = document.querySelector(target); if (el) return el; } catch (e) {}
      const t = String(target).toLowerCase().trim();
      const cand = [...document.querySelectorAll('button,a,[role=button],input[type=submit],input[type=button],label,[onclick]')];
      return cand.find(e => ((e.innerText || e.value || e.getAttribute('aria-label') || '')).toLowerCase().trim().includes(t)) || null;
    }
    function typeInto(el, text) {
      el.focus();
      if (el.isContentEditable) { if (!document.execCommand('insertText', false, text)) { el.textContent = text; el.dispatchEvent(new Event('input', { bubbles: true })); } }
      else { const p = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const s = Object.getOwnPropertyDescriptor(p, 'value'); if (s && s.set) s.set.call(el, text); else el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }
    }
    async function loop() {
      if (running) return;
      const statusEl = wrap.querySelector('#mls-ap-status');
      const setStatus = (m, k) => { if (statusEl) { statusEl.textContent = m || ''; statusEl.style.color = k === 'err' ? '#c0392b' : k === 'ok' ? '#16924e' : '#5a6a7a'; } };
      const uiRun = (on) => { running = on; if (runB) runB.style.display = on ? 'none' : ''; if (stopB) stopB.style.display = on ? '' : 'none'; };
      // Flip to Stop IMMEDIATELY — before anything that could fail or early-return —
      // so the user is never stuck with a dead Start button.
      uiRun(true);
      const goal = (goalI && goalI.value || '').trim();
      if (!goal) { uiRun(false); setStatus('Type what you want it to do first — e.g. “capture this chart into MLS”.', 'err'); try { goalI.focus(); var _ob = goalI.style.borderColor; goalI.style.borderColor = '#c0392b'; setTimeout(function () { goalI.style.borderColor = _ob || ''; }, 2200); } catch (e) {} L('Enter a goal for autopilot, then press Run.'); return; }
      const history = []; var _lastSig = '', _sameN = 0; setStatus('Starting — reading the screen…'); L('Starting — reading the screen…');
      try {
      for (let step = 0; step < 50 && running; step++) {
        setStatus('Working… step ' + (step + 1) + ' — press Stop to cancel.');
        const cap = await send('mlsAssistCapture');
        let pt = await send('mlsAssistPageText');
        let pageText = (pt && pt.text) || '';
        // If the page looks like it is still loading, wait briefly and re-read once before deciding.
        if (pageText.replace(/\s/g, '').length < 40) { await new Promise(r => setTimeout(r, 1300)); pt = await send('mlsAssistPageText'); pageText = (pt && pt.text) || ''; }
        if (!running) break;
        const els = await send('mlsAssistElements');
        const elements = (els && els.list) || [];
        const resp = await send('mlsAssistAgentStep', { goal, pageText, screenshot: (cap && cap.dataUrl) || '', history, elements });
        if (!resp || resp.error) {
          var _em = (resp && resp.error) || 'no response';
          if (/api key|not authenticated|login|bearer|expired|sign in/i.test(_em)) { L('⚠ Not connected. Open MLS (mlsscribe.com) in a tab and sign in — MLS Assist uses your login automatically, no key needed. (You can still paste an API key via the toolbar icon if you prefer.)'); setStatus('Not connected — open MLS and sign in.', 'err'); }
          else { L('Assistant: ' + _em + ' — try again in a moment.'); setStatus('Error: ' + String(_em).slice(0, 70), 'err'); }
          break;
        }
        const a = resp.action || {}; if (resp.reasoning) L('(' + (step + 1) + ') ' + String(resp.reasoning).slice(0, 120));
        history.push({ type: a.type, target: a.target });
        var _sig = (a.type || '') + '|' + (a.target || ''); if (_sig === _lastSig) { _sameN++; } else { _sameN = 0; _lastSig = _sig; }
        if (_sameN >= 3) { L('I seem stuck repeating the same step — stopping so I don’t loop. Try rephrasing the goal, or do that one step yourself.'); break; }
        if (a.type === 'done') { L('✓ Autopilot finished.'); break; }
        if (a.type === 'confirm') {
          var _allow = !!((document.getElementById('mls-ap-save') || {}).checked);
          if (_allow) { const cr = await send('mlsAssistExec', { action: { type: 'click', target: a.target } }); if (cr && cr.ok) { L('✅ ' + cr.msg + ' (Save/Sign allowed)'); await new Promise(function (r) { setTimeout(r, 1000); }); continue; } L('Wanted to commit but ' + ((cr && cr.msg) || 'failed') + ' — paused.'); break; }
          L('⚠ Agent wants to commit ("' + (a.target || '') + '"). Tick "Let it click Save/Sign" to allow, or do it yourself — paused.'); break;
        }
        if (a.type === 'ask') { L('Agent needs you: ' + (a.target || a.reasoning || '')); break; }
        if (a.type === 'switchtab') { const sr = await send('mlsAssistExec', { action: a }); L((sr && sr.ok) ? ('\u21B9 ' + sr.msg) : ('Could not switch tab: ' + ((sr && sr.msg) || ''))); await new Promise(function (r) { setTimeout(r, 1200); }); continue; }
        if (a.type === 'capturechart') {
          var ptc = await send('mlsAssistPageText');
          var ex = await send('mlsAssistExtract', { pageText: (ptc && ptc.text) || '' });
          L((ex && ex.ok) ? ('📋 Captured ' + (ex.patient || 'patient') + ' (' + (ex.visits || 0) + ' visits) into MLS') : ('Capture: ' + ((ex && ex.error) || 'no patient found on this screen')));
          await new Promise(function (r) { setTimeout(r, 1000); }); continue;
        }
        if (a.type === 'pastenote') {
          var nb = document.getElementById('mls-note');
          var note = (nb && nb.value || '').trim();
          if (!note) { L('No drafted note to paste — Generate one in MLS Assist first.'); break; }
          var pr = await send('mlsAssistExec', { action: { type: 'pastenote', text: note } });
          L((pr && pr.msg) || 'Pasted the note.');
          await new Promise(function (r) { setTimeout(r, 1000); }); continue;
        }
        let er = await send('mlsAssistExec', { action: a });
        // Retry only when the control wasn't FOUND yet (async render) — scroll + retry once.
        // Do NOT retry a "stuck" type (field found but rejected the text): re-typing into a
        // typeahead/masked field never helps.
        if (er && er.ok === false && er.notfound && /^(click|select|type)$/.test(a.type || '')) { await send('mlsAssistExec', { action: { type: 'scroll' } }); await new Promise(r => setTimeout(r, 650)); er = await send('mlsAssistExec', { action: a }); }
        if (a.type === 'type' && er && er.ok) lastTypeTarget = a.target;
        // STOP (don't loop) when typing/pasting genuinely won't stick — clear failure, hand back to the doctor.
        if (/^(type|pastenote)$/.test(a.type || '') && er && er.ok === false && er.stuck) {
          L('⛔ ' + ((er && er.msg) || 'Could not type into the field — it would not accept the text.') + ' Stopping here so I don’t loop. Type it yourself, then press Run to continue.');
          setStatus('Couldn’t type into ' + (a.target || 'a field') + ' — please type it manually, then Run.', 'err');
          break;
        }
        L((er && er.msg) ? er.msg : ('Did: ' + (a.type || '')));
        await new Promise(r => setTimeout(r, /^(click|select|switchtab)$/.test(a.type || '') ? 1500 : 800));
      }
      if (running) setStatus('Reached the step limit — press Run to continue.', 'ok');
      } catch (e) {
        L('Autopilot hit an error: ' + ((e && e.message) || e));
        setStatus('Stopped after an error — press Run to try again.', 'err');
      } finally {
        uiRun(false);
      }
    }
    runB.addEventListener('click', function () { try { loop(); } catch (e) { try { runB.style.display = ''; stopB.style.display = 'none'; running = false; } catch (e2) {} } });
    stopB.addEventListener('click', function () { running = false; if (runB) runB.style.display = ''; if (stopB) stopB.style.display = 'none'; var _s = wrap.querySelector('#mls-ap-status'); if (_s) { _s.textContent = 'Stopped.'; _s.style.color = '#16924e'; } L('Stopped by you.'); });
    (function () {
      var micB = wrap.querySelector('#mls-ap-mic'); if (!micB) return;
      var SRx = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SRx) { micB.disabled = true; micB.textContent = '🎤 (no voice)'; return; }
      var arec = null, aon = false;
      micB.addEventListener('click', function () {
        if (aon) { try { arec.stop(); } catch (e) {} return; }
        arec = new SRx(); arec.lang = 'en-US'; arec.interimResults = true; arec.continuous = false;
        var base = goalI.value;
        arec.onresult = function (e) { var t = ''; for (var i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript; goalI.value = (base ? base + ' ' : '') + t; };
        arec.onerror = function () { aon = false; micB.textContent = '🎤 Speak'; };
        arec.onend = function () { aon = false; micB.textContent = '🎤 Speak'; };
        try { arec.start(); aon = true; micB.textContent = '⏹ Listening…'; } catch (e) {}
      });
    })();
    function pbGet() { try { return JSON.parse(localStorage.getItem('mls_playbooks') || '[]') || []; } catch (e) { return []; } }
    function pbSet(a) { try { localStorage.setItem('mls_playbooks', JSON.stringify(a.slice(0, 12))); } catch (e) {} }
    function pbRender() {
      var box = wrap.querySelector('#mls-ap-pbs'); if (!box) return;
      var a = pbGet(); box.innerHTML = '';
      a.forEach(function (g, i) {
        var chip = document.createElement('span'); chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#eef4fc;border:1px solid #cfe0f3;border-radius:999px;padding:3px 4px 3px 9px;font-size:12px;max-width:100%';
        var run = document.createElement('button'); run.textContent = '▶ ' + (g.length > 26 ? g.slice(0, 26) + '…' : g); run.title = g; run.style.cssText = 'background:none;border:none;color:#1f7ae0;font:inherit;cursor:pointer;padding:0;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        run.addEventListener('click', function () { goalI.value = g; loop(); });
        var del = document.createElement('button'); del.textContent = '✕'; del.title = 'Remove'; del.style.cssText = 'background:none;border:none;color:#9aa7b4;font:inherit;cursor:pointer;padding:0 2px';
        del.addEventListener('click', function (ev) { ev.stopPropagation(); var arr = pbGet(); arr.splice(i, 1); pbSet(arr); pbRender(); });
        chip.appendChild(run); chip.appendChild(del); box.appendChild(chip);
      });
    }
    var savepb = wrap.querySelector('#mls-ap-savepb');
    if (savepb) savepb.addEventListener('click', function () { var g = goalI.value.trim(); if (!g) { L('Type or speak a goal first, then save it.'); return; } var a = pbGet(); if (a.indexOf(g) === -1) { a.unshift(g); pbSet(a); pbRender(); L('Saved playbook.'); } });
    pbRender();
    var undoB = wrap.querySelector('#mls-ap-undo');
    if (undoB) undoB.addEventListener('click', async function () {
      if (!lastTypeTarget) { L('Nothing to undo yet.'); return; }
      var er = await send('mlsAssistExec', { action: { type: 'type', target: lastTypeTarget, text: '' } });
      L((er && er.ok) ? ('Cleared: ' + lastTypeTarget) : ('Could not undo: ' + ((er && er.msg) || '')));
      lastTypeTarget = null;
    });
    var recOn = false, recSteps = [];
    var recB = wrap.querySelector('#mls-ap-rec');
    function elSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return '';
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return '#' + el.id;
      if (el.getAttribute && el.getAttribute('name')) return el.tagName.toLowerCase() + '[name="' + el.getAttribute('name') + '"]';
      var txt = (el.innerText || el.value || '').trim();
      if (txt && txt.length < 40 && /^(BUTTON|A|LABEL)$/.test(el.tagName)) return txt;
      var s = el.tagName.toLowerCase();
      if (typeof el.className === 'string' && el.className.trim()) { var cl = el.className.trim().split(/\s+/)[0].replace(/[^\w-]/g, ''); if (cl) s += '.' + cl; }
      return s;
    }
    function fieldLabel(el) {
      try {
        if (el.getAttribute) {
          var al = el.getAttribute('aria-label'); if (al) return al.trim();
          var ph = el.getAttribute('placeholder'); if (ph) return ph.trim();
          if (el.id) { var lab = document.querySelector('label[for="' + el.id + '"]'); if (lab && lab.textContent) return lab.textContent.trim().slice(0, 50); }
        }
        var p = el.closest && el.closest('label'); if (p) { var t = p.textContent.replace(el.value || '', '').trim(); if (t) return t.slice(0, 50); }
        var nm = el.getAttribute && el.getAttribute('name'); if (nm) return nm;
      } catch (e) {}
      return (el.tagName || 'field').toLowerCase();
    }
    function stepDesc(type, el, text) {
      if (type === 'click') return 'Click "' + ((el.innerText || el.value || fieldLabel(el)) || '').trim().replace(/\s+/g, ' ').slice(0, 50) + '"';
      if (type === 'type') return 'Type "' + String(text || '').slice(0, 40) + '" into the "' + fieldLabel(el) + '" field';
      if (type === 'select') return 'Choose "' + String(text || '').slice(0, 40) + '" in the "' + fieldLabel(el) + '" dropdown';
      return type;
    }
    function recPush(type, el, text) {
      if (!recOn || !el || panel.contains(el)) return;
      var target = elSelector(el); if (!target) return;
      recSteps.push({ type: type, target: target, text: text || '', desc: stepDesc(type, el, text) });
      if (recB) recB.textContent = '⏹ Stop (' + recSteps.length + ')';
    }
    function recClick(e) { var el = (e.target && e.target.closest) ? (e.target.closest('button,a,[role=button],input[type=submit],input[type=button],[onclick],label') || e.target) : e.target; if (el && el.tagName === 'SELECT') return; recPush('click', el); }
    function recChange(e) { var el = e.target; if (!el) return; if (el.tagName === 'SELECT') recPush('select', el, (el.options[el.selectedIndex] || {}).text || ''); else if (/^(INPUT|TEXTAREA)$/.test(el.tagName)) recPush('type', el, el.value); }
    function recStart() { recOn = true; recSteps = []; document.addEventListener('click', recClick, true); document.addEventListener('change', recChange, true); if (recB) recB.textContent = '⏹ Stop (0)'; L('Recording — do your task, then press Stop.'); }
    function recStop() {
      recOn = false; document.removeEventListener('click', recClick, true); document.removeEventListener('change', recChange, true);
      if (recB) recB.textContent = '⏺ Record a task';
      if (!recSteps.length) { L('Nothing was recorded.'); return; }
      var name = prompt('Name this recorded task:', 'Task ' + (mrGet().length + 1));
      if (name === null) { L('Recording discarded.'); return; }
      var a = mrGet(); a.unshift({ name: String(name).slice(0, 40) || 'Task', steps: recSteps.slice() }); mrSet(a); mrRender();
      L('Saved recording (' + recSteps.length + ' steps).');
    }
    if (recB) recB.addEventListener('click', function () { recOn ? recStop() : recStart(); });
    function mrGet() { try { return JSON.parse(localStorage.getItem('mls_recordings') || '[]') || []; } catch (e) { return []; } }
    function mrSet(a) { try { localStorage.setItem('mls_recordings', JSON.stringify(a.slice(0, 12))); } catch (e) {} }
    async function mrReplay(steps) {
      L('▶ Replaying ' + steps.length + ' steps (smart/adaptive)…'); running = true; runB.style.display = 'none'; stopB.style.display = '';
      for (var i = 0; i < steps.length && running; i++) {
        var s = steps[i];
        var er = await send('mlsAssistExec', { action: s });
        if (!er || er.ok === false) {
          L('  ' + (i + 1) + '. page changed — adapting: ' + (s.desc || s.type));
          var cap = await send('mlsAssistCapture');
          var pt = await send('mlsAssistPageText');
          var resp = await send('mlsAssistAgentStep', { goal: 'Do exactly this ONE UI step on the current screen and nothing else: ' + (s.desc || (s.type + ' ' + s.target)), pageText: (pt && pt.text) || '', screenshot: (cap && cap.dataUrl) || '', history: [] });
          if (resp && resp.action && resp.action.type && resp.action.type !== 'ask' && resp.action.type !== 'done') {
            er = await send('mlsAssistExec', { action: resp.action });
            L('     \u21B3 ' + ((er && er.msg) || 'adapted') + (resp.reasoning ? (' — ' + String(resp.reasoning).slice(0, 60)) : ''));
          } else {
            L('     \u21B3 could not adapt this step.');
          }
        } else {
          L('  ' + (i + 1) + '. ' + ((er && er.msg) || s.type));
        }
        await new Promise(function (r) { setTimeout(r, 900); });
      }
      running = false; runB.style.display = ''; stopB.style.display = 'none'; L('\u2713 Replay finished.');
    }
    function mrRender() {
      var box = wrap.querySelector('#mls-ap-recs'); if (!box) return; var a = mrGet(); box.innerHTML = '';
      a.forEach(function (rec, i) {
        var chip = document.createElement('span'); chip.style.cssText = 'display:inline-flex;align-items:center;gap:4px;background:#eef9f1;border:1px solid #bfe6cf;border-radius:999px;padding:3px 4px 3px 9px;font-size:12px';
        var run = document.createElement('button'); run.textContent = '🎬 ' + rec.name; run.title = 'Replay (' + rec.steps.length + ' steps)'; run.style.cssText = 'background:none;border:none;color:#1c7a43;font:inherit;cursor:pointer;padding:0;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
        run.addEventListener('click', function () { mrReplay(rec.steps); });
        var del = document.createElement('button'); del.textContent = '✕'; del.title = 'Remove'; del.style.cssText = 'background:none;border:none;color:#9aa7b4;font:inherit;cursor:pointer;padding:0 2px';
        del.addEventListener('click', function (ev) { ev.stopPropagation(); var arr = mrGet(); arr.splice(i, 1); mrSet(arr); mrRender(); });
        chip.appendChild(run); chip.appendChild(del); box.appendChild(chip);
      });
    }
    mrRender();
  }
})();
/* MLS Assist content.js — v1.17 schedule-pull build */

/* === MLS Assist v1.35 — Copy-every-visit bridge (APPEND-ONLY to content.js) ===
 * Self-contained. Adds its own message listeners; does not touch the existing
 * bridge router. Relays the app's mlsAppReadAllVisits request to background and
 * streams mlsAppVisitsProgress / mlsAppAllVisitsResult back to the page. */
(function () {
  'use strict';
  try { if (window.__mlsAllVisitsBridge) return; window.__mlsAllVisitsBridge = 1; } catch (e) { return; }
  var pendingById = Object.create(null);
  function trusted(origin) {
    if (!origin || typeof origin !== 'string') return false;
    try {
      var u = new URL(origin);
      if (u.protocol === 'https:' && (u.hostname === 'mlsscribe.com' || u.hostname === 'www.mlsscribe.com' || u.hostname.endsWith('.mlsscribe.com'))) return true;
    } catch (e) {}
    return false;
  }
  function post(origin, type, payload) {
    try { window.postMessage(Object.assign({ source: 'mls-ext', type: type }, payload || {}), origin); } catch (e) {}
  }
  function finishPending(requestId) {
    var pending = pendingById[requestId];
    if (!pending) return null;
    if (pending.timer) clearTimeout(pending.timer);
    delete pendingById[requestId];
    return pending;
  }
  function pendingMeta(pending, payload) {
    var out = Object.assign({}, payload || {});
    if (!pending) return out;
    if (pending.retryOf) { out.retryOf = pending.retryOf; out.parentRequestId = pending.retryOf; }
    if (pending.managed) out.managed = true;
    if (pending.background) out.background = true;
    if (pending.silent) out.silent = true;
    if (pending.initiator) out.initiator = pending.initiator;
    return out;
  }
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data; if (!d || d.type !== 'mlsAppReadAllVisits' || d.source !== 'mls-app' || !trusted(ev.origin)) return;
    var origin = ev.origin;
    var requestId = String(d.id || d.requestId || '').slice(0, 100);
    var retryOf = String(d.retryOf || d.parentRequestId || d.correlationId || '').slice(0, 100);
    var pending = {
      origin: origin, timer: null, retryOf: retryOf,
      managed: d.managed === true, background: d.background === true,
      silent: d.silent === true, initiator: String(d.initiator || '').slice(0, 32)
    };
    if (!requestId) {
      post(origin, 'mlsAppAllVisitsResult', pendingMeta(pending, { id: '', requestId: '', ok: false, error: 'History request correlation id is required.' }));
      return;
    }
    if (pendingById[requestId]) {
      post(origin, 'mlsAppAllVisitsResult', pendingMeta(pending, { id: requestId, requestId: requestId, ok: false, error: 'Duplicate history request correlation id.' }));
      return;
    }
    pending.timer = setTimeout(function () { finishPending(requestId); }, 300000);
    pendingById[requestId] = pending;
    /* Correlated acceptance keeps the page on its long timeout while Athena is
       being located. Runtime progress below is still accepted only when the
       background echoes this exact id. */
    post(origin, 'mlsAppVisitsProgress', pendingMeta(pending, { id: requestId, requestId: requestId, message: 'MLS Assist accepted the history request...' }));
    try {
      chrome.runtime.sendMessage(pendingMeta(pending, { type: 'mlsAppAllVisitsRequest', hint: d.hint || {}, requestId: requestId }), function (res) {
        var err = chrome.runtime && chrome.runtime.lastError;
        var target = finishPending(requestId);
        if (!target) return;
        if (err || !res) { post(target.origin, 'mlsAppAllVisitsResult', pendingMeta(target, { id: requestId, requestId: requestId, ok: false, error: (err && err.message) || 'No response from MLS Assist' })); return; }
        var out = {}; for (var k in res) out[k] = res[k]; out.type = 'mlsAppAllVisitsResult'; out.id = requestId; out.requestId = requestId;
        post(target.origin, 'mlsAppAllVisitsResult', pendingMeta(target, out));
      });
    } catch (e) {
      var target = finishPending(requestId);
      if (target) post(target.origin, 'mlsAppAllVisitsResult', pendingMeta(target, { id: requestId, requestId: requestId, ok: false, error: String((e && e.message) || e) }));
    }
  }, false);
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'mlsAppVisitsProgress') {
        var requestId = String(msg.requestId || msg.id || '').slice(0, 100);
        var pending = requestId && pendingById[requestId];
        if (pending) post(pending.origin, 'mlsAppVisitsProgress', pendingMeta(pending, { id: requestId, requestId: requestId, message: msg.message, n: msg.n, total: msg.total }));
      }
    });
  } catch (e) {}
})();



/* === MLS Assist v1.36 — panel "Pull from chart" fix + search-and-navigate relay (APPEND-ONLY to content.js) ===
 * Two self-contained IIFEs. Neither touches the existing bridge router or the
 * existing #mls-cap handler code; they ADD behavior and are individually
 * reversible by removing this block. Read-only on Athena (no Save/Sign).
 *
 *  (1) Panel "Pull from chart": the old #mls-cap button read only the TOP frame's
 *      innerText (empty on iframed athenaNet) and sent it to an AI extract, so it
 *      did nothing on real charts. This intercepts the click and instead routes
 *      the pull through the proven in-app Athena pull (which uses the frame-aware
 *      v1.34 reader), so it reads the open chart's patient (name+DOB) and ALL
 *      their visits into MLS — with the shared app module's live status,
 *      destination report, save-verify, and self-recovery. Honest failure if no
 *      MLS tab / no chart / extension.
 *
 *  (2) Search-and-navigate relay: forwards the app's mlsAppSearchOpenPatient
 *      request to background (which drives Athena's patient search bar read-only:
 *      type "Last, First", run search, open the matching chart) and streams the
 *      result/progress back to the page. Mirrors the v1.34 copy-every-visit
 *      bridge exactly. */

/* (1) Panel "Pull from chart" -> route through the in-app proven pull ---------*/
(function () {
  'use strict';
  try { if (window.__mlsPanelPullFix) return; window.__mlsPanelPullFix = 1; } catch (e) { return; }

  function relabel() {
    try {
      var btn = document.getElementById('mls-cap');
      if (!btn) return;
      if (btn.getAttribute('data-mls-pullfix') === '1') return;
      btn.setAttribute('data-mls-pullfix', '1');
      btn.textContent = '📋 Pull from chart → MLS';
      btn.setAttribute('data-tip', 'Reads THIS open chart’s patient (name + DOB) and ALL their visits into MLS — read-only, nothing is written back to the EMR.');
      // a small honest intent line under the button
      if (btn.parentNode && !btn.parentNode.querySelector('.mls-pullfix-intent')) {
        var cap = document.createElement('div');
        cap.className = 'mls-pullfix-intent';
        cap.style.cssText = 'font-size:10.5px;line-height:1.3;color:#41566b;margin-top:3px;';
        cap.innerHTML = '<b style="color:#0f6b3a;">READ-ONLY</b> — brings in name, DOB and every visit from the open chart.';
        btn.parentNode.insertBefore(cap, btn.nextSibling);
      }
    } catch (e) {}
  }
  // panel is injected on demand; find the button when it appears (idempotent)
  try {
    var mo = new MutationObserver(function () { relabel(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  relabel();

  function status(btn, msg) { try { var s = btn.parentNode && btn.parentNode.querySelector('.mls-pullfix-intent'); if (s) s.innerHTML = msg; } catch (e) {} }

  // capture-phase interceptor: suppress the OLD #mls-cap handler and run the new one
  document.addEventListener('click', function (ev) {
    var t = ev.target;
    var btn = t && t.closest ? t.closest('#mls-cap') : null;
    if (!btn) return;
    ev.stopImmediatePropagation();
    ev.preventDefault();
    try {
      btn.disabled = true; var old = btn.textContent; btn.textContent = '… reading the open chart';
      status(btn, 'Reading the open chart and sending it to MLS…');
      chrome.runtime.sendMessage({ type: 'mlsAssistPullToApp', url: location.href }, function (resp) {
        btn.disabled = false; btn.textContent = old;
        var err = chrome.runtime && chrome.runtime.lastError;
        if (err || !resp) { status(btn, '<b style="color:#a01818;">MLS Assist didn’t respond.</b> Reload it at chrome://extensions, then try again.'); return; }
        if (resp.ok) {
          status(btn, '<b style="color:#0f6b3a;">✓ Sent to MLS.</b> Switch to the MLS tab — it shows live progress, the exact destination, and a save-verify.');
        } else {
          status(btn, '<b style="color:#a01818;">' + (resp.error || 'Couldn’t start the pull.') + '</b>');
        }
      });
    } catch (e) {
      btn.disabled = false;
      status(btn, '<b style="color:#a01818;">Couldn’t start the pull.</b> ' + String((e && e.message) || e));
    }
  }, true);
})();

/* (2) Search-and-navigate relay (mirrors the v1.34 copy-every-visit bridge) ----*/
(function () {
  'use strict';
  try { if (window.__mlsSearchOpenBridge) return; window.__mlsSearchOpenBridge = 1; } catch (e) { return; }
  var activeOrigin = '', activeUntil = 0;
  function trusted(origin) {
    if (!origin || typeof origin !== 'string') return false;
    try {
      var u = new URL(origin);
      if (u.protocol === 'https:' && (u.hostname === 'mlsscribe.com' || u.hostname === 'www.mlsscribe.com' || u.hostname.endsWith('.mlsscribe.com'))) return true;
    } catch (e) {}
    return false;
  }
  function post(origin, type, payload) {
    // v1.42 fix #6: never fall back to '*' — only reply to the specific trusted origin.
    if (!origin || typeof origin !== 'string' || !trusted(origin)) return;
    try { var o = {}; for (var k in payload) o[k] = payload[k]; o.source = 'mls-ext'; o.type = type; window.postMessage(o, origin); } catch (e) {}
  }
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.source !== 'mls-app' || d.type !== 'mlsAppSearchOpenPatient') return;
    if (!trusted(ev.origin)) return;
    activeOrigin = ev.origin; activeUntil = Date.now() + 120000;
    try {
      /* v1.78: forward the app's DOB when it sends one - the findpatient route
         verifies the result row's DOB BEFORE opening the chart. Optional.
         v1.85: when the app did NOT send one, look it up in the app's OWN
         patient store (same-origin localStorage) by exact normalized name -
         this is what disambiguates two same-name patients (live: two Marie
         Dunnes, different DOBs). A wrong-twin dob cannot misfile: the pull's
         read gate still verifies the roster row against the opened chart. */
      var dobHint = d.dob || '';
      var mrnHint = String(d.mrn || d.patientMrn || d.athenaId || '').trim().slice(0, 40);
      if (!dobHint) {
        try {
          var nrmN = function (s) { return String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim(); };
          var wantN = nrmN(d.name || d.raw);
          if (wantN) {
            for (var ki = 0; ki < localStorage.length; ki++) {
              var kk = localStorage.key(ki);
              if (!/::patients$/.test(kk || '')) continue;
              var arrP = [];
              try { arrP = JSON.parse(localStorage.getItem(kk)) || []; } catch (e0) { continue; }
              for (var pi = 0; pi < arrP.length; pi++) {
                var pp = arrP[pi];
                if (pp && pp.name && pp.dob && nrmN(pp.name) === wantN) { dobHint = pp.dob; break; }
              }
              if (dobHint) break;
            }
          }
        } catch (e1) {}
      }
      chrome.runtime.sendMessage({ type: 'mlsAppSearchOpenRequest', name: d.name || d.raw || '', dob: dobHint, mrn: mrnHint, noReload: d.noReload === true }, function (res) {
        var err = chrome.runtime && chrome.runtime.lastError;
        if (err || !res) { post(activeOrigin, 'mlsAppSearchOpenResult', { ok: false, error: (err && err.message) || 'No response from MLS Assist', unhandled: true }); return; }
        var out = {}; for (var k in res) out[k] = res[k];
        post(activeOrigin, 'mlsAppSearchOpenResult', out);
      });
    } catch (e) { post(activeOrigin, 'mlsAppSearchOpenResult', { ok: false, error: String((e && e.message) || e) }); }
  }, false);
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'mlsAppSearchOpenProgress') {
        if (activeOrigin && Date.now() < activeUntil) post(activeOrigin, 'mlsAppSearchOpenProgress', { message: msg.message });
      }
    });
  } catch (e) {}
})();


/* =========================================================================
 * MLS Assist v1.50 — version announce to the MLS app  (APPEND-ONLY)
 * On mlsscribe.com pages: announce the installed extension version via
 * postMessage (and answer mlsAppGetVersion), so the app's Settings -> MLS
 * Controls row and update-reminder banner know what's installed. No PHI.
 * ========================================================================= */
(function () {
  'use strict';
  try {
    if (!/(^|\.)mlsscribe\.com$|^localhost$|^127\.0\.0\.1$/.test(location.hostname)) return;
    var VER = ''; try { VER = chrome.runtime.getManifest().version; } catch (e) {}
    if (!VER) return;
    var say = function () { try { window.postMessage({ source: 'mls-ext', type: 'mlsExtVersion', version: VER }, location.origin); } catch (e) {} };
    window.addEventListener('message', function (ev) {
      var d = ev && ev.data;
      if (!d || d.source !== 'mls-app' || d.type !== 'mlsAppGetVersion') return;
      if (ev.origin !== location.origin) return;
      say();
    });
    say(); setTimeout(say, 2500); setTimeout(say, 8000);
  } catch (e) {}
})();

/* ===================== v1.99 ATHENA TAB PICKER (app-page UI) =================
 * Lets the user point MLS Assist at an already-open athenaOne tab and walk
 * away: pick a tab -> it is PINNED (background honors it for every driver) and
 * the gentle 55s Worker keep-alive holds it signed in (armed on pin, re-checked
 * by a 5-min alarm). Never navigates the pinned tab outside a user-started
 * pull; if the session drops the panel says so - MLS never re-auths.
 * Renders ONLY on the MLS app page. Launcher chip #mlsTabPickerChip; panel
 * opens on click or on window message {source:'mls-app', type:'mlsShowTabPicker'}. */
(function () {
  try {
    if (!/(^|\.)mlsscribe\.com$/i.test(location.hostname || '')) return;
    if (!/ScribeFlow/i.test(location.pathname || '')) return;
    if (window.__mlsTabPickerInstalled) return; window.__mlsTabPickerInstalled = 1;
    var PANEL_ID = 'mlsTabPickerPanel';
    function el(tag, css, txt) { var n = document.createElement(tag); if (css) n.style.cssText = css; if (txt != null) n.textContent = txt; return n; }
    function bg(type, payload) {
      return new Promise(function (res) {
        try { chrome.runtime.sendMessage(Object.assign({ type: type }, payload || {}), function (r) { var _ = chrome.runtime.lastError; res(r || null); }); }
        catch (e) { res(null); }
      });
    }
    function closePanel() { var p = document.getElementById(PANEL_ID); if (p) p.remove(); }
    function render() {
      closePanel();
      var p = el('div', 'position:fixed;right:16px;bottom:64px;z-index:2147483000;width:344px;background:#0b1020;border:1px solid rgba(120,140,220,.35);border-radius:14px;padding:14px;box-shadow:0 12px 40px rgba(0,0,0,.5);font:13px/1.45 system-ui;color:#e8ecff');
      p.id = PANEL_ID;
      var h = el('div', 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px');
      h.appendChild(el('b', 'font-size:13.5px', 'Athena tab — hand off to MLS Assist'));
      var x = el('button', 'background:none;border:0;color:#9fb0d8;font-size:17px;cursor:pointer;line-height:1', String.fromCharCode(215));
      x.onclick = closePanel; h.appendChild(x);
      p.appendChild(h);
      var status = el('div', 'font-size:12px;color:#9fb0d8;margin-bottom:8px', 'Checking...');
      p.appendChild(status);
      var list = el('div', 'max-height:260px;overflow:auto');
      p.appendChild(list);
      var foot = el('div', 'display:flex;gap:8px;margin-top:10px');
      var B = 'flex:1;border:1px solid rgba(120,140,220,.3);background:#141b3d;color:#e8ecff;border-radius:9px;padding:7px 8px;font:600 12px system-ui;cursor:pointer';
      var rf = el('button', B, 'Refresh'); rf.onclick = render; foot.appendChild(rf);
      var un = el('button', B, 'Auto-pick (unpin)');
      un.onclick = function () { bg('mlsPinAthenaTabRequest', { tabId: null }).then(render); };
      foot.appendChild(un);
      p.appendChild(foot);
      p.appendChild(el('div', 'font-size:11px;color:#7f8db0;margin-top:8px', 'The pinned tab is held signed in by a gentle 55s keep-alive. MLS only navigates it during a pull you start, and never signs in for you - if the session drops, work pauses and this panel says so.'));
      document.body.appendChild(p);
      Promise.all([bg('mlsPinStateRequest'), bg('mlsListAthenaTabsRequest')]).then(function (rs) {
        var st = rs[0], resp = rs[1];
        if (st && st.pinned) status.textContent = st.signedOut ? '⚠ Pinned tab looks SIGNED OUT - sign back in on that tab; keep-alive is paused and MLS will not re-auth.' : ('✓ Pinned: "' + (st.title || 'athenaOne') + '" - keep-alive ' + (st.ka || 'arming...'));
        else status.textContent = 'No tab pinned - MLS auto-picks. Choose your athenaOne tab below to pin it.';
        list.innerHTML = '';
        var tabs = (resp && resp.tabs) || [];
        if (!tabs.length) { list.appendChild(el('div', 'color:#9fb0d8;padding:8px 2px', 'No athenaOne tabs found. Open athenaOne in another tab, then Refresh.')); return; }
        tabs.forEach(function (t) {
          var row = el('div', 'display:flex;align-items:center;gap:8px;padding:7px 8px;border:1px solid rgba(120,140,220,.18);border-radius:9px;margin-bottom:6px;background:' + (t.pinned ? 'rgba(37,99,201,.28)' : '#0f1530'));
          var lab = el('div', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap');
          lab.textContent = (t.pinned ? '📌 ' : '') + t.title; lab.title = t.title;
          row.appendChild(lab);
          row.appendChild(el('span', 'font-size:10.5px;white-space:nowrap;color:' + (t.loginish ? '#f2b8b5' : '#9fe0b0'), t.loginish ? 'sign-in page' : (t.hello ? 'connected' : 'athena')));
          var b = el('button', 'border:1px solid rgba(120,140,220,.35);background:#1b2a5e;color:#e8ecff;border-radius:8px;padding:5px 9px;font:600 11.5px system-ui;cursor:pointer;white-space:nowrap', t.pinned ? 'Pinned' : 'Use this tab');
          if (t.pinned) b.disabled = true;
          b.onclick = function () {
            b.textContent = '...';
            bg('mlsPinAthenaTabRequest', { tabId: t.id }).then(function (r) {
              if (r && r.ok) render();
              else { b.textContent = 'Use this tab'; status.textContent = '⚠ ' + ((r && r.error) || 'Could not pin that tab.'); }
            });
          };
          row.appendChild(b);
          list.appendChild(row);
        });
      });
    }
    function chip() {
      try {
        if (document.getElementById('mlsTabPickerChip') || !document.body) return;
        var c = el('button', 'position:fixed;right:184px;bottom:14px;z-index:2147482999;border:1px solid rgba(120,140,220,.4);background:#0b1020;color:#cfd9ff;border-radius:999px;padding:7px 12px;font:600 12px system-ui;cursor:pointer;box-shadow:0 6px 18px rgba(0,0,0,.35)', '🔗 Athena tab');
        c.id = 'mlsTabPickerChip';
        c.title = 'Pick which open athenaOne tab MLS Assist should use (and keep signed in)';
        c.onclick = function () { if (document.getElementById(PANEL_ID)) closePanel(); else render(); };
        document.body.appendChild(c);
      } catch (e) {}
    }
    window.addEventListener('message', function (ev) {
      var d = ev && ev.data;
      if (d && d.source === 'mls-app' && d.type === 'mlsShowTabPicker' && ev.origin === location.origin) render();
    }, false);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', chip); else chip();
    setTimeout(chip, 2500);
  } catch (e) {}
})();


/* =========================================================================
 * Deprecated advanced-section writer. This former mlsAppWriteV2 relay is kept
 * only as a fail-closed compatibility receipt for stale cached pages. Current
 * pages must use the unified mlsAppAthenaActionV2 manifest review above.
 * ========================================================================= */
(function () {
  'use strict';
  function trusted(origin) {
    try {
      var u = new URL(origin);
      return u.protocol === 'https:' && /(^|\.)mlsscribe\.com$/i.test(u.hostname);
    } catch (e) { return false; }
  }
  window.addEventListener('message', function (ev) {
    var d = ev && ev.data;
    if (!d || d.source !== 'mls-app' || d.type !== 'mlsAppWriteV2') return;
    if (!trusted(ev.origin)) return;
    var origin = ev.origin;
    function post(type, payload) {
      try { var o = {}; for (var k in payload) o[k] = payload[k]; o.source = 'mls-ext'; o.type = type; window.postMessage(o, origin); } catch (e) {}
    }
    post('mlsAppWriteV2Result', { resp: {
      ok: false, blocked: true, reason: 'unified-confirmation-required',
      error: 'This older direct writer is disabled. Refresh MLS and use Review selected Athena routes so the exact immutable manifest and read-only encounter check are shown first.'
    } });
  }, false);
})();
