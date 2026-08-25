/* =============================================================================
 * feat_mls_writeflow.js -> window.__mlsWriteFlow  (wf2-2.2.0)
 * wf2-1.7.0 (2026-07-16): the exact-visit context prefers the REAL Athena
 *   appointment id resolved from the day's schedule-import index (keyed
 *   appointment-id:<id> -> {backendAppointmentId, patientId, appt_date}).
 *   The calendar row's `id` is the BACKEND row id (live: Adam 3794 vs Athena
 *   52585118) - numeric, so it passed shape checks and would only fail at the
 *   live probe as context-mismatch. Resolution accepts exactly ONE index
 *   match on (backend row id + patient + day); anything else keeps the prior
 *   behavior and still fail-closes at the probe. No gate is weakened.
 * wf2-1.6.0 (2026-07-14): one reviewed imaging, PT, referral, or DME
 *   order can use a dedicated exact-catalog Athena adapter. Each order remains
 *   an independent immutable row and needs its own read-only probe and fresh
 *   clinician confirmation; Rx/injection and incomplete suggestions stay
 *   blocked, and no action is ever chained.
 * wf2-1.5.2 (2026-07-14): the Orders workspace opens this immutable review
 *   directly. Local patient IDs remain in frontend manifests/receipts while
 *   complete drafts stay manual and incomplete/suggestion-only rows block.
 * wf2-1.5.1 (2026-07-14): the advanced workspace now opens the same immutable
 *   manifest review as every other Athena entry point. Its obsolete direct
 *   mlsAppWriteV2 send lane is disabled end-to-end.
 * wf2-1.5.0 (2026-07-14): one immutable Athena write manifest and one
 *   non-overlapping confirmation page. Unsupported structured destinations
 *   stay visible and fail closed; Sign remains a separate proof-gated choice.
 * wf2-1.4.1 (2026-07-14): confirmed billing uses a frozen structured code
 *   snapshot; diagnosis/order prose can never be inferred as CPT/HCPCS.
 * wf2-1.4.0 (2026-07-14): encounter-locked, confirmation-gated note writes;
 *   Sign remains disabled until that exact receipt's note write is verified.
 *   Billing failures report every verified/uncertain partial result honestly.
 * wf2-1.3.0 (2026-07-14): independent, probe-confirmed Athena billing,
 *   Save Draft, and Sign & Save actions on the same visible review surface.
 * wf2-1.2.0 (2026-07-14): canonical HPI/follow-up routing, fail-closed
 *   section keys, preview-only structured actions, and durable-result wording.
 * wf2-1.1.0 (2026-07-12): WRITE-BACK SAFETY. The panel now independently
 *   re-checks the chart identity the driver reports it wrote under against the
 *   patient we intended, and REFUSES to print any success line unless a content
 *   section is BOTH written AND read-back-verified. A wrong/absent chart yields
 *   a loud "nothing was written" refusal -- never a false "WROTE". Pairs with
 *   the extension driver's target-frame identity guard (background.js) that
 *   stops a write from landing in a field that is not on this patient's chart.
 * -----------------------------------------------------------------------------
 * Owner-requested write-back UX, generic for ANY account/patient/provider:
 *
 * 1) SUPERVISED DRAFT: a "Place Athena draft" button on the patient banner.
 *    Click -> the chart is opened in athenaOne (pull), the note is organized
 *    into sections (generate), and the EMR review-and-confirm panel opens with
 *    content sections pre-ticked (preview). The clinician reviews and presses
 *    "Insert confirmed to athenaOne" (confirm) -> identity-gated draft attempt. The
 *    safety gates are unchanged: identity verification + explicit on-screen
 *    confirm remain between the click and any write.
 *
 * 2) UNIFIED REVIEW: the panel's write button opens the same immutable
 *    manifest and exact-encounter confirmation page used by the top workflow.
 *    The obsolete direct mlsAppWriteV2 bridge is never called. Sections:
 *      - hpi/exam/assessment/plan: explicit canonical destinations only
 *      - history -> hpi; followup/follow_up -> plan (merged, never generic)
 *      - one canonical reviewed imaging/PT/referral/DME order may use the
 *        dedicated place_order row; prose, Rx, injections, and incomplete
 *        orders remain visible and blocked
 *
 * 3) SUGGESTED ORDERS: one-click chips derived from the visit note content
 *    ("We suggest: [+ MRI lumbar spine]") - clicking adds that order line to
 *    the Orders card so it appears in the final preview. A suggestion never
 *    executes until the clinician explicitly accepts and completes it.
 *
 * 4) COPY CLEANUP: the legacy "Orders - confirmed for your reference but never
 *    sent by MLS (athenaOne orders auto-execute; enter these in Athena
 *    yourself)." banner is removed from the review screen (behavior is
 *    replaced by the per-order typed confirmation and honest blocked states.
 *
 * Additive; revert(): window.__mlsWriteFlow.revert(). ASCII-only.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsWriteFlow && window.__mlsWriteFlow.installed) return;

  var VERSION = 'wf3-1.1.0'; /* owner 2026-08-04: the write UI remade — one sheet,
     one Confirm & Send. The pre-send #ez3Confirm interstitial is retired, the
     preferred action probes the exact chart the moment the sheet opens, and the
     single primary button is BOTH the human confirmation and the trusted-click
     gesture (its title carries the arm phrase; visible label is the doctor's
     language). Every wf2 safety invariant is unchanged: one-use token, probe
     binding, fail-closed identity, four-layer final-action block. */ /* b745: live writes probe-bound; historical writes still pre-name their encounter */
  var S = function (x) { return x == null ? '' : String(x); };
  var STATE = { oneClicks: 0, writes: 0, lastResp: null, verifiedWrites: {}, suggestionsShown: 0, suggestionsAdded: 0, copyScrubbed: 0, orderAccepts: 0 };
  var stopped = false;
  function syntheticLocalRuntime() {
    try {
      var h = String(location && location.hostname || '').toLowerCase();
      if (h === 'localhost' || h === '127.0.0.1' || h === '::1') return true;
      if (window._SF_DEMO === true || window.__MLS_SYNTHETIC_ONLY === true) return true;
    } catch (e) {}
    return false;
  }

  /* ===== athena-probe-only-1.0.0 (1p PREVIEW ONLY) =========================
     A supervised end-to-end rehearsal. When PROBE ONLY is on, the whole flow
     still runs — manifest, read-only check, READY row, the Confirm click — but
     every Athena request leaves the page with mode:'probe'. The switch lives in
     ONE place (the bridge, below) so a call site that forgot about it still
     cannot execute; the callers additionally opt in explicitly so the receipt
     text is honest instead of reporting a failed write.
       window.__mlsAthenaProbeOnly = true            (this tab only)
       localStorage.setItem('mlsAthenaProbeOnly','1') (survives reload)
     ======================================================================== */
  function probeOnlyActive() {
    try { if (window.__mlsAthenaProbeOnly === true) return true; } catch (e) {}
    try { if (window.localStorage && window.localStorage.getItem('mlsAthenaProbeOnly') === '1') return true; } catch (e2) {}
    return false;
  }
  var PROBE_ONLY_BANNER = 'PROBE ONLY — nothing will be written to Athena. Every request leaves this page as a read-only check.';

  /* ---------------------- bridge (same pattern as b111) -------------------- */
  /* wfdx-1.0.0: mlsAppGotoDate and mlsExtHealth both echo the request id at the
     top level of their reply, so correlate them too — two diagnostics in flight
     can no longer resolve each other's promise. */
  var BRIDGE_CORRELATED = { mlsAppAthenaActionV2: 1, mlsAppGotoDate: 1, mlsExtHealth: 1 };
  function bridge(type, payload, respType, timeout) {
    if (syntheticLocalRuntime() && /^mlsAppAthenaAction/.test(S(type))) {
      return Promise.resolve({ ok: false, blocked: true, reason: 'synthetic-local-only', error: 'The local synthetic demo never connects to live Athena data or actions.' });
    }
    return new Promise(function (resolve) {
      var done = false;
      var correlated = BRIDGE_CORRELATED[S(type)] === 1;
      var requestId = correlated ? ((type === 'mlsAppAthenaActionV2' ? 'wf2-' : 'wfdx-') + Date.now() + '-' + Math.random().toString(36).slice(2)) : '';
      function h(ev) { var d = ev && ev.data; if (!d || d.source !== 'mls-ext' || d.type !== respType || (correlated && S(d.requestId) !== requestId)) return; if (done) return; done = true; try { window.removeEventListener('message', h); } catch (e) {} resolve(d.resp || d); }
      try { window.addEventListener('message', h, false); } catch (e) {}
      try {
        var m = { type: type, source: 'mls-app', from: 'mls-app' }; for (var k in (payload || {})) m[k] = payload[k]; if (correlated) m.requestId = requestId;
        /* The one enforcement point: in PROBE ONLY no execute request can leave
           this page, whichever call site built it. The one-use action token is
           dropped with it — a probe never needs one. */
        if (S(m.type) === 'mlsAppAthenaActionV2' && S(m.mode) === 'execute' && probeOnlyActive()) {
          m.mode = 'probe'; m.actionToken = ''; m.__mlsProbeOnly = true;
        }
        window.postMessage(m, '*');
      } catch (e) {}
      setTimeout(function () { if (done) return; done = true; try { window.removeEventListener('message', h); } catch (e) {} resolve({ __timeout: true }); }, timeout || 150000);
    });
  }
  function esc(s) { return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function activePt() { try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; } catch (e) { return null; } }
  function supervisedOrderPlacementReady() { try { return !!(window.__mlsExtensionCapabilities && window.__mlsExtensionCapabilities.supervisedOrderPlacementV2 === true); } catch (e) { return false; } }
  /* Owner directive 2026-08-12: billing staging and Sign & Save are MLS
     actions. The installed extension is the transport authority: until it
     advertises athenaFinalActionsV1, its write-safety layers refuse these
     executes, so the rows say that instead of promising a send that the
     bridge would reject. The moment a capable extension is installed these
     rows go ready with zero further site change. */
  function athenaFinalActionsReady() { try { return !!(window.__mlsExtensionCapabilities && window.__mlsExtensionCapabilities.athenaFinalActionsV1 === true); } catch (e) { return false; } }
  var FINAL_ACTION_EXT_BLOCK = 'Your installed MLS Assist still enforces the previous write-safety policy and will refuse this action. Update MLS Assist (Settings > Get the extension, v3.0.62 or newer) to enable it.';

  /* ---------------- explicit Athena actions ------------------------------ */
  /* Owner directive 2026-08-12 (extension released 2026-08-17 as MLS Assist
     3.0.62): reviewed note write, Save Draft, billing staging, Sign & Save AND
     one exact reviewed order are ALL confirmable MLS actions. Every action
     still runs one-at-a-time behind the same read-only probe, identity lock,
     one-use token, and explicit per-action clinician confirm. The texts below
     are the FALLBACK rendered only while the installed extension does not yet
     advertise athenaFinalActionsV1 (an older MLS Assist): they say so and name
     the cure instead of promising a send the bridge would refuse. */
  var ATHENA_ACTIONS = {
    write_note: {
      label: 'Write reviewed note',
      consequence: 'Writes only the exact reviewed unsigned note text into the verified Athena encounter editor. It does not Save, Sign, bill, submit a claim, place an order, or prescribe. Review the result before choosing another action.'
    },
    stage_billing: {
      label: 'Stage billing in Athena (update MLS Assist)',
      consequence: 'Your installed MLS Assist still enforces the previous write-safety policy, so this stays review-only until you update it. Review the exact suggested E/M and CPT/HCPCS payload here; with MLS Assist 3.0.62 or newer this row stages the codes into the verified encounter\'s billing slate after your one-click confirm.'
    },
    save_draft: {
      label: 'Save draft in Athena',
      consequence: 'After verifying that this exact reviewed note is in the exact encounter editor, clicks that encounter\'s verified Save / Save Draft control. It does not sign the note, submit billing, or place an order.'
    },
    sign_encounter: {
      label: 'Sign & Save in Athena (update MLS Assist)',
      consequence: 'Your installed MLS Assist still enforces the previous write-safety policy, so this stays review-only until you update it. With MLS Assist 3.0.62 or newer, after MLS verifies this exact reviewed note was written to this exact encounter, your one-click confirm clicks that encounter\'s verified Sign & Save control.'
    },
    place_order: {
      label: 'Place reviewed order in Athena (update MLS Assist)',
      consequence: 'Your installed MLS Assist still enforces the previous write-safety policy, so this stays review-only until you update it. With MLS Assist 3.0.62 or newer, your one-click confirm selects exactly this catalog item in the verified encounter\'s Orders workspace and places only it, verified by an isolated read-back.'
    }
  };
  var ATHENA_EXECUTABLE_ACTIONS = { write_note: true, save_draft: true, stage_billing: true, sign_encounter: true, place_order: true };
  /* Capable-mode row text: rendered when the installed extension adverts
     athenaFinalActionsV1 (MLS Assist 3.0.62+). */
  var ATHENA_FINAL_READY = {
    stage_billing: {
      label: 'Stage billing in Athena',
      consequence: 'After your one-click confirm, writes the exact reviewed E/M and CPT/HCPCS codes into the verified encounter\'s billing slate. It does not submit a claim, place an order, or prescribe; review the slate before claim submission in Athena.'
    },
    sign_encounter: {
      label: 'Sign & Save in Athena',
      consequence: 'After MLS verifies this exact reviewed note was written to this exact encounter, your one-click confirm clicks that encounter\'s verified Sign & Save control. Nothing is signed without your explicit confirmation, and no billing or order runs with it.'
    },
    place_order: {
      label: 'Place reviewed order in Athena',
      consequence: 'After your one-click confirm, MLS selects exactly this catalog-bound reviewed order in the verified encounter\'s Orders workspace, fills only its reviewed fields, places only it, and verifies the result by an isolated read-back. It does not prescribe, sign, or bill; medication and injection orders stay manual because no typed adapter exists for them.'
    }
  };
  var athenaActionRunning = false;
  var unifiedAthenaState = null;

  function stableValue(v) {
    if (Array.isArray(v)) return v.map(stableValue);
    if (v && typeof v === 'object') {
      var out = {};
      Object.keys(v).sort().forEach(function (k) { out[k] = stableValue(v[k]); });
      return out;
    }
    return v == null ? '' : v;
  }
  function hashPreview(v) {
    var src = '';
    try { src = JSON.stringify(stableValue(v)); } catch (e) { src = S(v); }
    var h = 2166136261;
    for (var i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
    return 'mls-preview-' + (h >>> 0).toString(16);
  }
  function actionPatient(opts) {
    var p = (opts && opts.patient) || activePt() || {};
    return { name: S(p.name).trim(), dob: S(p.dob).trim(), mrn: S(p.mrn || p.athenaId || '').trim(), patientId: S(p.patientId || p.id || p.patient_external_id || '').trim() };
  }
  /* Athena cannot match the local MLS patient id, but the extension keeps it
     in the one-use authorization and result receipt as an audit binding. DOM
     identity still requires the exact Athena name + DOB + MRN tuple. */
  function bridgePatient(p) {
    p = p || {};
    return { name: S(p.name).trim(), dob: S(p.dob).trim(), mrn: S(p.mrn || p.athenaId || '').trim(), patientId: S(p.patientId || p.id || '').trim() };
  }
  function visitDay(v) {
    var raw = S(v).trim(), m = /(\d{4}-\d{2}-\d{2})/.exec(raw);
    if (m) return m[1];
    try {
      var d = new Date(v); if (isNaN(d.getTime())) return '';
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    } catch (e) { return ''; }
  }
  function athenaVisitDate(day) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(S(day));
    return m ? (Number(m[2]) + '/' + Number(m[3]) + '/' + m[1]) : '';
  }
  function calendarRows() {
    try { if (Array.isArray(window._calAppts)) return window._calAppts; } catch (e) {}
    try { if (typeof _calAppts !== 'undefined' && Array.isArray(_calAppts)) return _calAppts; } catch (e2) {}
    return [];
  }
  function apptProvider(a) {
    var out = S(a && (a.provider || a.providerName || a.provider_name || a.doctor_name)).trim();
    if (!out && a && a.doctor_user_id) {
      try { if (typeof window._docName === 'function') out = S(window._docName(a.doctor_user_id)).trim(); } catch (e) {}
    }
    /* When the calendar row does not name a provider, "assume it is me" is only
       true for the clinician. b820: the final rung here was the LOGIN/account
       name, and this provider becomes the rendering provider on an EHR write
       context — the one place a wrong name does not just misprint but targets
       another clinician's encounter. The shared resolver owns the single
       account-name fallback, gated on there being no verified roster; where it
       is absent this stops at the provider setting and returns '', which the
       caller above already treats as "cannot resolve" and refuses. */
    if (!out) {
      try { if (typeof window.clinicalProviderName === 'function') out = S(window.clinicalProviderName()).trim(); } catch (e2) {}
      try { if (!out && typeof window.getProviderName === 'function') out = S(window.getProviderName()).trim(); } catch (e3) {}
    }
    return out;
  }
  /* The calendar row's `id` is the BACKEND appointment row id, not Athena's.
     The day's schedule-import index (written by the exact importer) maps the
     REAL Athena appointment id to that backend row id + immutable patient id
     + day. Accept only an exactly-one match; otherwise return '' and let the
     caller keep its prior value (the live probe still fail-closes). */
  function athenaAppointmentIdFromImportIndex(pid, backendRowId, day) {
    try {
      if (!pid || !backendRowId || !day || typeof window.uns !== 'function') return '';
      var raw = localStorage.getItem(window.uns('schedImportIndexV1::' + day));
      if (!raw) return '';
      var rows = (JSON.parse(raw) || {}).rows || {};
      var matches = [];
      Object.keys(rows).forEach(function (k) {
        var m = /^appointment-id:(\d+)$/.exec(k), e = rows[k];
        if (!m || !e) return;
        if (S(e.backendAppointmentId).trim() === S(backendRowId).trim() &&
            S(e.patientId).trim() === S(pid).trim() &&
            S(e.appt_date).trim() === S(day).trim()) matches.push(m[1]);
      });
      return matches.length === 1 ? matches[0] : '';
    } catch (e) { return ''; }
  }
  /* awb-1.0.0 (2026-08-18): the day's import ledger is the FRESHEST id source,
     but it only exists after a successful schedule pull — and a hidden athena
     tab can leave a whole day unledgered while every write blocks with "run
     the day pull" (measured live: 17 booked rows, 14 ledgered, 3 forever
     unbindable). The backend calendar row itself carries the REAL Athena
     appointment id captured at booking (staff sync writes
     athena_appointment_id in Athena's own id namespace — never the backend
     row id wf2-1.9.0 forbids). Accept it only as a FALLBACK when the ledger
     cannot resolve, digits-only, and only off a row already matched to this
     exact patient id; the live probe still fail-closes on a stale/moved id
     before anything can execute. */
  function athenaAppointmentIdFromBookingRow(row) {
    try {
      var id = S(row && (row.athena_appointment_id || row.athenaAppointmentId)).trim();
      return /^\d{1,18}$/.test(id) ? id : '';
    } catch (e) { return ''; }
  }
  /* Use a schedule expectation only when it is traceable to an explicit visit
     context or one unambiguous closest appointment for this exact patient. */
  function expectedVisitContext(patient, opts) {
    opts = opts || {};
    var supplied = opts.expectedContext || {};
    var suppliedDate = visitDay(supplied.visitDate || supplied.encounterDate || opts.visitDate || opts.noteDate || '');
    var suppliedProvider = S(supplied.provider || supplied.providerName || opts.provider || '').trim();
    var suppliedEncounter = S(supplied.encounterId || supplied.visitId || '').trim();
    var suppliedEncounterUrl = S(supplied.encounterUrl || supplied.visitUrl || '').trim();
    if (!!suppliedEncounter !== !!suppliedEncounterUrl) { suppliedEncounter = ''; suppliedEncounterUrl = ''; }
    var suppliedAppointment = S(supplied.appointmentId || supplied.id || '').trim();
    if (suppliedDate && suppliedProvider) {
      /* b745 (write-blocker audit #15): this short-circuit returned with an
         empty appointmentId even when the day's import ledger could resolve it
         unambiguously, which fed the exact-visit gate nothing. Resolve first;
         exactly-one match or the id stays honestly empty. */
      if (!suppliedAppointment) {
        try {
          var srcS = opts.patient || activePt() || {};
          var pidS = S(srcS.patientId || srcS.id || srcS.patient_external_id || '').trim();
          var dayRows = calendarRows().filter(function (a) {
            return a && S(a.patient_external_id || a.patientId || '').trim() === pidS &&
              visitDay(a.day_local || a.appt_date || a.start_at) === suppliedDate;
          });
          if (pidS && dayRows.length === 1) suppliedAppointment = athenaAppointmentIdFromImportIndex(pidS, dayRows[0].id, suppliedDate) || athenaAppointmentIdFromBookingRow(dayRows[0]) || '';
        } catch (eResolve) {}
      }
      return { visitDate: athenaVisitDate(suppliedDate), provider: suppliedProvider, appointmentId: suppliedAppointment, encounterId: suppliedEncounter, encounterUrl: suppliedEncounterUrl };
    }

    /* opvs-1.0.0 (2026-08-17): a HISTORICAL review that names no date must not
       fall through to the nearest-appointment inference below, because that
       inference's reference point is a CLOCK READ (Date.now() when the record
       carries no timestamp). A saved op note with no visit metadata therefore
       bound itself to whichever appointment for this patient sits closest to
       TODAY and rendered READY under requireExpectedVisit - the exact "note in
       the wrong historical encounter" outcome that flag exists to prevent.
       With no supplied day there is nothing to anchor to: return null and let
       the manifest say which fields are missing. */
    if (opts.requireExpectedVisit === true && !suppliedDate) return null;
    var src = opts.patient || activePt() || {};
    var pid = S(src.patientId || src.id || src.patient_external_id || '').trim();
    var all = calendarRows().filter(Boolean);
    var idRows = pid ? all.filter(function (a) { return S(a.patient_external_id || a.patientId || '').trim() === pid; }) : [];
    var rows = idRows.length ? idRows : all.filter(function (a) { return !!(patient.name && nrmName(a.name || a.patient_name) === nrmName(patient.name)); });
    if (suppliedDate) rows = rows.filter(function (a) { return visitDay(a.day_local || a.appt_date || a.start_at) === suppliedDate; });
    if (!rows.length) return suppliedDate && suppliedProvider ? { visitDate: athenaVisitDate(suppliedDate), provider: suppliedProvider, appointmentId: suppliedAppointment, encounterId: suppliedEncounter, encounterUrl: suppliedEncounterUrl } : null;

    var ref = Number(opts.visitTimestamp || opts.noteTimestamp || Date.now()) || Date.now();
    rows = rows.map(function (a) {
      var t = NaN; try { t = new Date(a.start_at || (visitDay(a.appt_date) + 'T12:00:00')).getTime(); } catch (e) {}
      return { row: a, distance: isNaN(t) ? Number.MAX_SAFE_INTEGER : Math.abs(t - ref) };
    }).sort(function (x, y) { return x.distance - y.distance; });
    /* wf2-1.8.0: an MLS-only calendar row (one the day's schedule-import index cannot
       map to a real Athena appointment) can never match an open Athena encounter at
       write time, so binding to it guarantees a context-unverified refusal even when
       the patient's true Athena appointment is one row away. Prefer the nearest row
       that RESOLVES an Athena id; when none resolve, the prior nearest-row behavior
       stands (the live probe stays the fail-closed arbiter either way). */
    var resolvable = rows.filter(function (x) {
      var d0 = visitDay(x.row.day_local || x.row.appt_date || x.row.start_at);
      return !!(d0 && (athenaAppointmentIdFromImportIndex(pid, x.row.id, d0) ||
        (pid && S(x.row.patient_external_id || x.row.patientId).trim() === pid && athenaAppointmentIdFromBookingRow(x.row))));
    });
    if (resolvable.length) rows = resolvable;
    if (rows.length > 1 && rows[0].distance === rows[1].distance && String(rows[0].row.id || '') !== String(rows[1].row.id || '')) return null;
    var hit = rows[0].row;
    var day = suppliedDate || visitDay(hit.day_local || hit.appt_date || hit.start_at);
    var provider = suppliedProvider || apptProvider(hit);
    if (!day || !provider) return null;
    /* wf2-1.9.0: never present the backend calendar-row id as an Athena
       appointment id. The backend id is a different namespace; the extension's
       probe requires an exact match on any supplied appointment id, so a
       fabricated id guarantees a confusing first-click context refusal, while
       its mere truthiness flipped the unified manifest's exact-visit gate from
       blocked to ready. An empty id is honest: the manifest blocks with the
       real reason unless a bound encounter id + URL exists. */
    return { visitDate: athenaVisitDate(day), provider: provider, appointmentId: suppliedAppointment || athenaAppointmentIdFromImportIndex(pid, hit.id, day) ||
      ((pid && S(hit.patient_external_id || hit.patientId).trim() === pid) ? athenaAppointmentIdFromBookingRow(hit) : '') || '', encounterId: suppliedEncounter, encounterUrl: suppliedEncounterUrl };
  }
  function statusEl(opts) {
    try {
      if (opts && opts.statusEl && opts.statusEl.nodeType === 1) return opts.statusEl;
      if (opts && opts.statusId) return document.getElementById(opts.statusId);
    } catch (e) {}
    return null;
  }
  function actionSay(opts, msg, kind, behavior) {
    var el = statusEl(opts);
    if (el) {
      try {
        el.style.display = 'block';
        el.style.color = kind === 'err' ? '#9f2d2d' : (kind === 'ok' ? '#205c43' : '#6f5a20');
        el.textContent = msg;
      } catch (e) {}
    }
    try { if (!(behavior && behavior.toast === false) && typeof window.toast === 'function') window.toast(msg, kind === 'err' ? 'err' : (kind === 'ok' ? 'ok' : '')); } catch (e2) {}
  }

  function stringList(v) {
    if (v == null) return [];
    if (!Array.isArray(v)) v = [v];
    return v.map(function (x) { return S(x).trim(); }).filter(Boolean);
  }
  function parseBillingItem(item) {
    var raw = S(item && typeof item === 'object' ? (item.raw || item.label || item.text || item.code || '') : item).trim();
    var obj = (item && typeof item === 'object') ? item : {};
    /* CPT/HCPCS is five alphanumeric characters with at least one digit:
       99214, J3301, 0123T, and 1036F are all valid shapes. */
    var cm = /\b((?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5})\b/i.exec(S(obj.code || raw));
    var um = /\b(?:units?|qty|quantity)\s*[:x-]?\s*(\d+)\b/i.exec(raw) || /\bx\s*(\d+)\b/i.exec(raw);
    var mm = /\bmod(?:ifier)?s?\s*[:#-]?\s*([^;\n]+)/i.exec(raw);
    var dm = /\b(?:dx|diagnos(?:is|es)|pointer)s?\s*[:#-]?\s*([A-Z0-9.,\s-]{2,40})/i.exec(raw);
    var modText = mm && mm[1] ? mm[1].split(/\b(?:dx|diagnos(?:is|es)|pointer|units?|qty|quantity)\b/i)[0] : '';
    var mods = stringList(obj.modifiers || obj.modifier || (modText ? modText.split(/[\s,]+/) : []));
    var ptrs = stringList(obj.dxPointers || obj.diagnosisPointers || obj.dx || (dm && dm[1] ? dm[1].split(/[\s,]+/) : []));
    return {
      code: S(obj.code || (cm && cm[1]) || '').toUpperCase(),
      units: Math.max(1, Number(obj.units || (um && um[1]) || 1) || 1),
      modifiers: mods,
      dxPointers: ptrs,
      raw: raw
    };
  }
  function normalizeBilling(source) {
    source = source || {};
    if (source.billing) source = source.billing;
    var raw = S(source.raw || source.text || source.billingText || '');
    var emRaw = S(source.em || source.emCode || source.em_level || source.emLevel || '').trim();
    var emMatch = /\b(\d{5})\b/.exec(emRaw);
    var em = emMatch ? emMatch[1] : '';
    var invalidEm = emRaw && !emMatch ? [emRaw] : [];
    if (!em) {
      var emLine = /(?:E\/?M(?:\s+level)?|visit\s+level)\s*[:#-]?\s*(\d{5})/i.exec(raw);
      if (emLine) em = emLine[1];
    }
    var aliases = [source.cpt, source.cpts, source.cptCodes, source.codes], cptInput = [];
    for (var ai = 0; ai < aliases.length; ai++) {
      var candidate = aliases[ai];
      if (Array.isArray(candidate) ? candidate.length : S(candidate).trim()) { cptInput = candidate; break; }
    }
    if (!Array.isArray(cptInput)) cptInput = [cptInput];
    if (!cptInput.length && raw) {
      /* Legacy free-text fallback is section-aware. A generic five-character
         scan cannot distinguish an undotted ICD-10 value (for example M5450)
         from HCPCS, so only an explicit CPT/HCPCS line or section is eligible. */
      var inCptSection = false;
      raw.split(/\r?\n/).forEach(function (line) {
        var text = S(line).trim();
        if (!text) { inCptSection = false; return; }
        if (/^(?:BILLING|CHARGES?)\s*:?$/i.test(text)) return;
        if (/^E\/?M(?:\s+(?:level|code))?\s*[:#-]?\s*[A-Z0-9]{5}\b/i.test(text)) { inCptSection = false; return; }
        var explicit = /^(?:[-*•]\s*)?(?:CPT|HCPCS)(?:\s+(?:charges?|codes?|procedures?))?\s*(?::|#|-)?\s*(.*)$/i.exec(text);
        if (explicit) {
          inCptSection = true;
          var tail = S(explicit[1]).trim();
          if (/^(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b/i.test(tail)) cptInput.push(tail);
          return;
        }
        if (/^(?:[-*•]\s*)?(?:attach\b|ICD-?10\b|diagnos(?:is|es)\b|DX\b|orders?\b|patient\b|provider\b|date\b)/i.test(text)) { inCptSection = false; return; }
        if (inCptSection && /^(?:[-*•]\s*)?(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b/i.test(text)) { cptInput.push(text); return; }
        inCptSection = false;
      });
    }
    var parsedCpt = cptInput.map(parseBillingItem);
    var sourceInvalid = stringList(source.invalid).concat(stringList(source.conflicts));
    var invalid = sourceInvalid.concat(invalidEm, parsedCpt.filter(function (x) { return !x.code && x.raw; }).map(function (x) { return x.raw; }));
    var cpt = parsedCpt.filter(function (x) { return !!x.code; });
    var dx = stringList(source.diagnoses || source.icd || source.icd10 || source.dx);
    if (!dx.length && raw) {
      var dxLine = /(?:attach\s+)?(?:these\s+)?(?:ICD-?10\s+)?diagnos(?:is|es)\s*(?:to\s+the\s+charges)?\s*:\s*([^\n]+)/i.exec(raw);
      if (dxLine) dx = dxLine[1].split(/[;,]+/).map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return { em: em, emCode: em, cpt: cpt, cptCodes: cpt.map(function (x) { return x.code; }).filter(Boolean), invalid: invalid, diagnoses: dx, raw: raw };
  }
  function currentBilling(panel, opts) {
    if (opts && opts.payload && opts.payload.billing) return normalizeBilling(opts.payload.billing);
    if (opts && (opts.billing || opts.coding || opts.billingText)) return normalizeBilling(opts.billing || opts.coding || { billingText: opts.billingText });
    if (panel) {
      var ta = panel.querySelector('textarea[data-t="billing"]');
      if (ta && S(ta.value).trim()) return normalizeBilling({ billingText: ta.value });
    }
    try { if (typeof currentCoding !== 'undefined' && currentCoding) return normalizeBilling(currentCoding); } catch (e) {}
    return normalizeBilling({});
  }
  function actionPayload(action, opts) {
    opts = opts || {};
    if (action === 'stage_billing') return { billing: currentBilling(opts.panel || null, opts) };
    if (action === 'place_order') return { order: stableClone((opts.payload && opts.payload.order) || opts.order || {}) };
    if (action === 'write_note' || action === 'save_draft' || action === 'sign_encounter') {
      var secs = receiptNoteSections(opts);
      var noteText = secs.map(function (s) {
        return s.key === 'note' ? S(s.text).trim() : (S(s.key).toUpperCase() + ':\n' + S(s.text).trim());
      }).filter(Boolean).join('\n\n').trim();
      return { sections: secs, noteText: noteText };
    }
    return opts.payload && typeof opts.payload === 'object' ? opts.payload : {};
  }
  function hasBilling(b) { return !!(b && (b.em || (b.cpt && b.cpt.length))); }
  /* Local receipt lookup also keeps the immutable MLS patient id when present.
     The background-minted
     opaque proof separately binds the observed Athena MRN and rejects mismatch. */
  function actionPatientKey(p) { return S(p && p.patientId).trim() + '|' + nrmName(p && p.name) + '|' + nrmDob(p && p.dob); }
  function actionContextSignature(ctx) {
    var id = contextValue(ctx, ['encounterId', 'visitId', 'id'], '');
    var url = contextValue(ctx, ['encounterUrl', 'visitUrl', 'url'], '');
    var date = contextValue(ctx, ['visitDate', 'encounterDate', 'date'], '');
    var provider = nrmName(contextValue(ctx, ['provider', 'providerName'], ''));
    return id && url && date && provider ? [id, url, date, provider].join('|') : '';
  }
  function verifiedWritePrefix(patient, previewHash, opts, payload) {
    return [S(opts && opts.receiptSessionId), actionPatientKey(patient), S(previewHash), hashPreview(S(payload && payload.noteText))].join('||');
  }
  function verifiedWriteUsable(receipt) {
    if (!receipt || !receipt.noteWriteProof) return false;
    var expiresAt = Number(receipt.noteWriteProofExpiresAt || 0) || 0;
    return expiresAt > Date.now();
  }
  function verifiedWriteKey(patient, previewHash, opts, payload, ctx) {
    var sig = actionContextSignature(ctx);
    return sig ? verifiedWritePrefix(patient, previewHash, opts, payload) + '||' + sig : '';
  }
  function hasAnyVerifiedWrite(patient, previewHash, opts, payload) {
    var prefix = verifiedWritePrefix(patient, previewHash, opts, payload) + '||';
    return Object.keys(STATE.verifiedWrites).some(function (k) { return k.indexOf(prefix) === 0 && verifiedWriteUsable(STATE.verifiedWrites[k]); });
  }
  function findAnyVerifiedWrite(patient, previewHash, opts, payload) {
    var prefix = verifiedWritePrefix(patient, previewHash, opts, payload) + '||';
    var keys = Object.keys(STATE.verifiedWrites).filter(function (k) { return k.indexOf(prefix) === 0 && verifiedWriteUsable(STATE.verifiedWrites[k]); });
    return keys.length === 1 ? STATE.verifiedWrites[keys[0]] : null;
  }
  function findVerifiedWrite(patient, previewHash, opts, payload, ctx) {
    var key = verifiedWriteKey(patient, previewHash, opts, payload, ctx);
    return key && verifiedWriteUsable(STATE.verifiedWrites[key]) ? STATE.verifiedWrites[key] : null;
  }
  function verifiedNoteWrite(resp) {
    if (!resp || resp.ok !== true || resp.attempted !== true || resp.verified !== true) return false;
    if (resp.written === true || resp.noteWritten === true) return true;
    var rs = Array.isArray(resp.results) ? resp.results.filter(function (r) { return !r || r.execute !== false; }) : [];
    return !!(rs.length && rs.every(function (r) { return r && r.attempted === true && r.written === true && r.verified === true; }));
  }
  function rememberVerifiedWrite(patient, previewHash, opts, payload, lockedContext, resp) {
    if (!verifiedNoteWrite(resp) || !S(resp.noteWriteProof).trim() || Number(resp.noteWriteProofExpiresAt || 0) <= Date.now()) return null;
    var returnedContext = resp && resp.context;
    var lockedSig = actionContextSignature(lockedContext), returnedSig = actionContextSignature(returnedContext);
    if (!lockedSig || !returnedSig || returnedSig !== lockedSig) return null;
    var key = verifiedWriteKey(patient, previewHash, opts, payload, returnedContext);
    if (!key) return null;
    var receipt = { action: 'write_note', patientKey: actionPatientKey(patient), patientId: S(patient && patient.patientId).trim(), patientName: S(patient && patient.name).trim(), patientDob: S(patient && patient.dob).trim(), patientMrn: S(patient && patient.mrn).trim(), previewHash: previewHash, receiptSessionId: S(opts && opts.receiptSessionId), noteHash: hashPreview(S(payload && payload.noteText)), contextSignature: returnedSig, context: returnedContext, noteWriteProof: S(resp.noteWriteProof).trim(), noteWriteProofExpiresAt: Number(resp.noteWriteProofExpiresAt || 0) || 0, verified: true };
    try { Object.freeze(receipt); } catch (e) {}
    STATE.verifiedWrites[key] = receipt;
    return receipt;
  }
  function billingResultSummary(resp, payload) {
    resp = resp || {}; var rs = Array.isArray(resp.results) ? resp.results : [];
    var verified = [], uncertain = [];
    rs.forEach(function (r) {
      var code = S(r && r.code).trim() || '(unreported code)';
      if (r && r.verified === true) verified.push(code + (r.alreadyPresent ? ' (already present)' : (r.attempted === false ? ' (verified present)' : ' (staged and verified)')));
      else uncertain.push(code + ' (' + S((r && (r.reason || r.error)) || 'not verified') + ')');
    });
    var failedCode = S(resp.code).trim();
    if (failedCode && !rs.some(function (r) { return S(r && r.code).trim() === failedCode; })) uncertain.push(failedCode + ' (' + S(resp.detail || resp.reason || 'not verified') + ')');
    var stagedCodes = Array.isArray(resp.stagedCodes) ? resp.stagedCodes : [];
    stagedCodes.forEach(function (code) {
      code = S(code).trim();
      if (code && !verified.some(function (v) { return v.indexOf(code) === 0; })) verified.push(code + ' (staged and verified)');
    });
    var failedCodes = Array.isArray(resp.failedCodes) ? resp.failedCodes : [];
    failedCodes.forEach(function (code) {
      code = S(code).trim();
      if (code && !uncertain.some(function (v) { return v.indexOf(code) === 0; })) uncertain.push(code + ' (not verified)');
    });
    var attempted = resp.attempted === true || rs.some(function (r) { return r && r.attempted === true; });
    if (!attempted && !rs.length) return '';
    var bits = [resp.ok === true ? 'Athena returned a verified billing result.' : 'Athena returned a partial billing result.'];
    if (verified.length) bits.push('Verified in the billing slate: ' + verified.join(', ') + '.');
    if (uncertain.length) bits.push('Not verified: ' + uncertain.join(', ') + '.');
    if (attempted && !verified.length && !uncertain.length) bits.push('Athena was changed or clicked, but the final code state was not verified.');
    bits.push(resp.ok === true ? 'No claim was submitted and no other action ran.' : 'Review the open billing slate before retrying; some codes may already be present. No claim was submitted and no other action ran.');
    return bits.join(' ');
  }
  function billingHtml(payload) {
    var b = payload && payload.billing;
    if (!b) return '';
    var h = '<div style="margin-top:10px;border:1px solid #e6dfca;border-radius:10px;padding:10px;background:#fffdf7"><b>Billing review</b>';
    h += '<div style="margin-top:5px"><b>E/M:</b> ' + esc(b.em || 'none') + '</div>';
    h += '<div style="margin-top:5px"><b>CPT / HCPCS:</b></div><ul style="margin:3px 0 5px 20px;padding:0">';
    if (!b.cpt.length) h += '<li>none</li>';
    b.cpt.forEach(function (x) {
      var bits = [x.code || x.raw || '(unparsed item)', 'units ' + x.units + ' (review only)'];
      if (x.modifiers.length) bits.push('modifier' + (x.modifiers.length === 1 ? '' : 's') + ' ' + x.modifiers.join(', ') + ' (review only)');
      if (x.dxPointers.length) bits.push('Dx pointer' + (x.dxPointers.length === 1 ? '' : 's') + ' ' + x.dxPointers.join(', ') + ' (review only)');
      h += '<li>' + esc(bits.join(' · ')) + '</li>';
    });
    h += '</ul><div><b>Diagnoses to review manually:</b> ' + esc(b.diagnoses.length ? b.diagnoses.join(', ') : 'none listed') + '</div>';
    h += '<div style="margin-top:7px;color:#7a5a16"><b>This action automatically stages only the exact E/M and CPT/HCPCS codes.</b> Units, modifiers, diagnosis pointers, and diagnoses are visible here for review but are not automatically applied. No claim is submitted. Orders and prescriptions stay separate and manual.</div></div>';
    return h;
  }
  function noteHtml(payload) {
    var noteText = S(payload && payload.noteText).trim();
    if (!noteText) return '';
    var secs = Array.isArray(payload.sections) ? payload.sections : [];
    var labels = secs.map(function (s) { return S(s && s.key).toUpperCase(); }).filter(Boolean);
    return '<div style="margin-top:10px;border:1px solid #cfe0d7;border-radius:10px;padding:10px;background:#f7fbf9"><b>Exact reviewed note</b>' +
      '<div style="margin-top:4px;color:#385b49">' + esc(labels.length ? labels.join(', ') : 'Encounter note') + ' &middot; ' + noteText.length + ' characters &middot; fingerprint ' + esc(hashPreview(noteText).replace('mls-preview-', '')) + '</div>' +
      '<div style="margin-top:6px;color:#52675c">Only this reviewed text is bound to the confirmation. Save and Sign must find the same text in the same encounter editor.</div>' +
      '<details open style="margin-top:8px"><summary style="cursor:pointer;font-weight:700;color:#204034">Review the full note text</summary>' +
      '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:240px;overflow:auto;margin:7px 0 0;padding:10px;border:1px solid #dbe7e0;border-radius:8px;background:#fff;color:#1f3027;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace">' + esc(noteText) + '</pre></details></div>';
  }
  function closeActionConfirm() {
    try { var old = document.getElementById('mlsAthenaActionConfirm'); if (old) old.remove(); } catch (e) {}
  }
  function contextValue(ctx, keys, fallback) {
    for (var i = 0; i < keys.length; i++) { if (ctx && ctx[keys[i]] != null && S(ctx[keys[i]]).trim()) return S(ctx[keys[i]]).trim(); }
    return arguments.length > 2 ? S(fallback) : '(not reported)';
  }
  function showActionConfirm(action, opts, patient, previewHash, payload, probe) {
    closeActionConfirm();
    var meta = ATHENA_ACTIONS[action], ctx = (probe && probe.context) || {};
    var actionToken = S((probe && (probe.actionToken || probe.token)) || '');
    if (!actionToken) { actionSay(opts, 'Athena did not return a one-use confirmation token. Nothing was changed.', 'err'); athenaActionRunning = false; return; }
    var orderRowHash = action === 'place_order' ? S((probe && probe.rowHash) || opts.rowHash || '').trim() : '';
    var orderClientId = action === 'place_order' ? S(payload && payload.order && payload.order.clientOrderId).trim() : '';
    if (action === 'place_order' && (!orderRowHash || !orderClientId || S(probe && probe.clientOrderId).trim() !== orderClientId)) {
      actionSay(opts, 'Athena did not return an exact order-row authorization binding. Nothing was changed.', 'err'); athenaActionRunning = false; return;
    }
    /* Imported patients do not always have an Athena MRN stored locally. The
       read-only probe must therefore report the chart MRN, which becomes the
       identity locked to this one-use confirmation. If an MRN was already
       stored locally, the observed chart must match it. */
    var athName = contextValue(ctx, ['patientName', 'name'], '');
    var athDob = contextValue(ctx, ['dob', 'patientDob'], '');
    var athMrn = contextValue(ctx, ['mrn', 'patientMrn', 'chartMrn'], '');
    if (!athName || !athDob || !athMrn || athName === '(not reported)' || athDob === '(not reported)' || athMrn === '(not reported)') {
      actionSay(opts, 'Athena did not report a complete chart identity (name, DOB, and MRN). Nothing was changed.', 'err');
      athenaActionRunning = false; return;
    }
    if (!nameMatch(athName, patient.name) || nrmDob(athDob) !== nrmDob(patient.dob) || (patient.mrn && nrmId(athMrn) !== nrmId(patient.mrn))) {
      actionSay(opts, 'The Athena chart returned by the read-only check does not match the saved patient identity. Nothing was changed.', 'err');
      athenaActionRunning = false; return;
    }
    var lockedPatient = { name: patient.name, dob: patient.dob, mrn: athMrn, patientId: S(patient.patientId).trim() };
    var lockedContext = {
      appointmentId: contextValue(ctx, ['appointmentId', 'athenaAppointmentId'], ''),
      encounterId: contextValue(ctx, ['encounterId', 'visitId', 'id'], ''),
      encounterUrl: contextValue(ctx, ['encounterUrl', 'visitUrl', 'url'], ''),
      visitDate: contextValue(ctx, ['visitDate', 'encounterDate', 'date'], ''),
      provider: contextValue(ctx, ['provider', 'providerName'], '')
    };
    var lockedControl = contextValue(ctx, ['control', 'controlLabel', 'actionControl'], '');
    if (!lockedContext.encounterId || !lockedContext.encounterUrl || !lockedContext.visitDate || !lockedContext.provider || !lockedControl) {
      actionSay(opts, 'Athena did not report the exact encounter date, provider, ID, URL, and action control. Nothing was changed.', 'err');
      athenaActionRunning = false; return;
    }
    var matchedWriteReceipt = action === 'sign_encounter' ? findVerifiedWrite(lockedPatient, previewHash, opts, payload, lockedContext) : null;
    if (action === 'sign_encounter' && (!matchedWriteReceipt || !matchedWriteReceipt.noteWriteProof)) {
      actionSay(opts, 'Sign & Save is still locked. This receipt does not have a verified write of this exact note to this exact Athena encounter. Write and verify the note first; no action was run.', 'err');
      athenaActionRunning = false; return;
    }
    var ov = document.createElement('div'); ov.id = 'mlsAthenaActionConfirm';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(10,25,50,.52);display:flex;align-items:center;justify-content:center;padding:18px';
    var card = document.createElement('div');
    card.style.cssText = 'background:#fff;color:#1A211C;width:min(620px,96vw);max-height:90vh;overflow:auto;border-radius:16px;box-shadow:0 24px 70px rgba(10,30,70,.4);padding:20px 22px;font:13px/1.5 system-ui';
    card.innerHTML = '<div style="font-size:19px;font-weight:800;color:#204034">Confirm ' + esc(meta.label) + '</div>' +
      '<div style="margin:5px 0 12px;color:#55605A">Athena was checked read-only. Confirm the exact context before continuing.</div>' +
      '<div style="display:grid;grid-template-columns:145px 1fr;gap:6px 10px;background:#f7f9fb;border:1px solid #e2e8f2;border-radius:10px;padding:11px 12px">' +
      '<span>Patient</span><b>' + esc(athName) + '</b><span>DOB</span><b>' + esc(athDob) + '</b>' +
      '<span>MRN</span><b>' + esc(athMrn) + '</b><span>Encounter date</span><b>' + esc(contextValue(ctx, ['encounterDate', 'visitDate', 'date'])) + '</b>' +
      '<span>Provider</span><b>' + esc(contextValue(ctx, ['provider', 'providerName'])) + '</b><span>Encounter ID</span><b>' + esc(contextValue(ctx, ['encounterId', 'visitId', 'id'])) + '</b>' +
      '<span>Athena control</span><b>' + esc(lockedControl) + '</b></div>' +
      noteHtml(payload) + billingHtml(payload) + (payload.order ? '<div style="margin-top:10px;border:1px solid #cfe0d7;border-radius:10px;padding:10px;background:#f7fbf9"><b>One exact reviewed order</b><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;margin:7px 0 0;padding:10px;border:1px solid #dbe7e0;border-radius:8px;background:#fff;color:#1f3027;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace">' + esc(JSON.stringify(payload.order, null, 2)) + '</pre></div>' : '') +
      '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:#fff7e6;border:1px solid #f0d79a;color:#664d12"><b>Consequence:</b> ' + esc(meta.consequence) + '</div>' +
      '<div style="display:flex;gap:9px;margin-top:15px"><button type="button" id="mlsAthenaActionCancel" style="flex:1;border:1px solid #d8ddd9;background:#fff;border-radius:10px;padding:10px;font-weight:700;cursor:pointer">Cancel</button><button type="button" id="mlsAthenaActionGo" style="flex:1;border:0;background:#204034;color:#fff;border-radius:10px;padding:10px;font-weight:800;cursor:pointer">Confirm ' + esc(meta.label) + '</button></div>';
    ov.appendChild(card); document.body.appendChild(ov);
    var cancel = card.querySelector('#mlsAthenaActionCancel');
    var go = card.querySelector('#mlsAthenaActionGo');
    go.setAttribute('data-mls-athena-action', action);
    go.setAttribute('data-mls-preview-hash', previewHash);
    if (action === 'place_order') { go.setAttribute('data-mls-row-hash', orderRowHash); go.setAttribute('data-mls-client-order-id', orderClientId); }
    cancel.onclick = function () { closeActionConfirm(); athenaActionRunning = false; actionSay(opts, 'Cancelled. Nothing was changed in Athena.', ''); };
    ov.addEventListener('click', function (ev) { if (ev.target === ov) cancel.click(); });
    go.addEventListener('click', function () {
      go.disabled = true; cancel.disabled = true; go.textContent = 'Working…';
      var bridgeLockedPatient = bridgePatient(lockedPatient);
      bridge('mlsAppAthenaActionV2', {
        mode: 'execute', action: action, actionToken: actionToken,
        patient: bridgeLockedPatient, expectedPatient: bridgeLockedPatient,
        previewHash: previewHash, payload: payload,
        noteText: payload.noteText || '', sections: payload.sections || [],
        notePolicy: 'empty_only',
        noteWriteProof: matchedWriteReceipt ? matchedWriteReceipt.noteWriteProof : '',
        billing: payload.billing || null, order: payload.order || null, rowHash: orderRowHash, clientOrderId: orderClientId, probeContext: ctx,
        expectedContext: lockedContext
      }, 'mlsAppAthenaActionV2Result', 150000).then(function (resp) {
        closeActionConfirm(); athenaActionRunning = false; resp = resp || {};
        STATE.lastResp = resp;
        if (resp.__timeout) {
          actionSay(opts, 'MLS did not receive a completion response. The Athena outcome is uncertain and the destination may already have changed. Inspect the exact open note or billing slate before retrying. No Save, Sign, billing, or other action was auto-chained.', 'err');
          try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: null }); } catch (et) {}
          return;
        }
        var partialMutation = action === 'stage_billing' && (resp.partialMutation === true || ((Array.isArray(resp.stagedCodes) && resp.stagedCodes.length > 0) && resp.ok !== true));
        if (partialMutation) {
          var stagedCodes = Array.isArray(resp.stagedCodes) ? resp.stagedCodes : [];
          var failedCodes = Array.isArray(resp.failedCodes) ? resp.failedCodes : [];
          actionSay(opts, 'Athena partially staged billing codes. Verified staged: ' + (stagedCodes.length ? stagedCodes.join(', ') : 'none reported') + '. Failed or unverified: ' + (failedCodes.length ? failedCodes.join(', ') : (resp.code || 'not reported')) + '. Review the open billing slate before retrying because some codes already changed. No claim was submitted and no other action ran.', 'err');
          try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: null }); } catch (ep) {}
          return;
        }
        if (!resp.ok) {
          var partialBilling = action === 'stage_billing' ? billingResultSummary(resp, payload) : '';
          var failure = partialBilling || resp.error || resp.message || resp.reason || (meta.label + ' was not completed. Nothing else ran.');
          actionSay(opts, failure, 'err');
          try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: null }); } catch (e0) {}
          return;
        }
        if (action === 'write_note') {
          var writeReceipt = rememberVerifiedWrite(lockedPatient, previewHash, opts, payload, lockedContext, resp);
          if (!writeReceipt) {
            actionSay(opts, 'Athena did not return a verified note write tied to the exact probed encounter. Sign remains locked. Inspect the open note; MLS is not marking the write complete.', 'err');
            try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: null }); } catch (e1) {}
            return;
          }
          actionSay(opts, 'The exact reviewed unsigned note was written and verified in this Athena encounter. It was not saved, signed, billed, ordered, or prescribed. Sign & Save is now available for this receipt only.', 'ok');
          try { if (typeof opts.onVerifiedWrite === 'function') opts.onVerifiedWrite(writeReceipt); } catch (e2) {}
          try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: writeReceipt }); } catch (e3) {}
          return;
        }
        if (action === 'sign_encounter' && resp.signed !== true) { actionSay(opts, 'Athena did not confirm the encounter was signed. Check the open encounter; MLS is not marking it complete.', ''); try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: matchedWriteReceipt }); } catch (es) {} return; }
        if (action === 'save_draft' && !(resp.saved === true || resp.persisted === true || resp.serverVerified === true || resp.verified === true)) { actionSay(opts, 'Athena returned from Save, but durable save verification was not reported. Check the open encounter; MLS is not marking it complete.', ''); try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: null }); } catch (ev) {} return; }
        if (action === 'stage_billing' && !(resp.staged === true || resp.verified === true)) { actionSay(opts, 'Athena returned from billing staging, but no committed billing codes were verified. Review the billing slate; no claim was submitted.', ''); try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: null }); } catch (eb) {} return; }
        if (action === 'place_order' && !(resp.orderPlaced === true || resp.alreadyPresent === true) ) { actionSay(opts, 'Athena did not return an isolated exact-order verification. Inspect the Orders workspace before retrying; no other action ran.', 'err'); try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: null }); } catch (eo) {} return; }
        actionSay(opts, action === 'stage_billing' ? ('Billing result verified in Athena. ' + (billingResultSummary(resp, payload) || 'All requested E/M and CPT/HCPCS codes were verified in the billing slate. No claim was submitted.')) : (action === 'place_order' ? (resp.alreadyPresent ? 'Athena verified this exact order was already present. Nothing was added and no other action ran.' : 'Athena verified exactly one reviewed order was placed. No Save, Sign, billing, prescription, or second order ran.') : (action === 'save_draft' ? 'Athena confirmed the exact reviewed encounter content was saved as a draft. It was not signed or billed.' : 'Athena confirmed the exact reviewed encounter was signed and saved. Billing was not submitted.')), 'ok');
        try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: findVerifiedWrite(lockedPatient, previewHash, opts, payload, lockedContext) }); } catch (e4) {}
      });
    });
  }
  /* wf2-2.0.0: reach the destination on our own. When the write probe refuses
     because the exact patient/encounter is not open in Athena, MLS drives
     athenaOne's own patient search (the extension's proven SearchOpen verb,
     with the frozen identity + appointment id + schedule date) to open the
     chart, then re-runs the SAME action once from the top — a fresh probe
     against the newly opened context. Exactly one attempt (the retry carries
     __autoOpened), never on identity/token/tab failures, and the one-click
     human confirm is unchanged: auto-open only removes the "go open the chart
     first" manual step, never the review. */
  var AUTO_OPEN_REASONS = { 'context-unverified': 1, 'context-mismatch': 1 };
  function wfDayKey(v) {
    v = S(v).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v);
    if (!m) return '';
    return m[3] + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  }
  function searchOpenTarget(patient, expectedContext) {
    return new Promise(function (resolve) {
      var requestId = 'wf-open-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var done = false;
      function fin(v) { if (done) return; done = true; try { window.removeEventListener('message', onMsg); } catch (e) {} resolve(v || {}); }
      function onMsg(ev) {
        var d = ev && ev.data;
        if (!d || d.source !== 'mls-ext' || d.type !== 'mlsAppSearchOpenResult') return;
        var rid = String(d.requestId || (d.resp && d.resp.requestId) || '');
        if (rid && rid !== requestId) return;
        fin(d.resp && typeof d.resp === 'object' ? d.resp : d);
      }
      window.addEventListener('message', onMsg);
      try {
        window.postMessage({
          source: 'mls-app', type: 'mlsAppSearchOpenPatient',
          name: S(patient.name), dob: S(patient.dob), mrn: S(patient.mrn),
          appointmentId: S(expectedContext && expectedContext.appointmentId || ''),
          scheduleDate: wfDayKey(expectedContext && expectedContext.visitDate),
          /* wf2-2.2.1 (live 2026-07-23): findpatient opens the CHART, but the
             write/verify probe needs the ENCOUNTER frame — when we hold the
             exact appointment id + schedule date, open via the appointment
             ROW (bootstrap route: navigation-proven, lands on the encounter
             surface). Without them the chart-open fallback stands. */
          bootstrapIdentity: !!(S(expectedContext && expectedContext.appointmentId || '').trim() && wfDayKey(expectedContext && expectedContext.visitDate)),
          requestId: requestId, deadlineAt: Date.now() + 150000
        }, window.location.origin);
      } catch (e) { fin({ ok: false, error: String((e && e.message) || e) }); }
      setTimeout(function () { fin({ ok: false, reason: 'open-timeout', error: 'Opening the patient in Athena timed out.' }); }, 155000);
    });
  }
  /* ========================================================================
     wfdx-1.0.0 (1p PREVIEW ONLY) -- PHI-free write-readiness diagnostics.

     Measured against MLS Assist 3.0.62: an mlsAppAthenaActionV2 probe refusal
     is uniformly { ok:false, blocked:true, reason:<code> } with, at most, one
     English sentence. It carries NO tab count, NO observed day, NO "was the
     appointment id on the grid", NO "did the grid paint". So the review could
     only repeat the extension's sentence, and the doctor was left guessing.

     Two read-only verbs the page is already allowed to call supply the missing
     facts, and the page composes them itself:
       mlsExtHealth    -> { version, athena: { tabs, discarded } }
       mlsAppGotoDate  -> { ok, supported, schedDate }  (schedDate is the day
                          athenaOne is REALLY showing when the nav disagrees)

     Everything retained here is a code, a count, a boolean or a date key.
     Extension `error` sentences are NEVER retained: several of them embed the
     patient's name ("Found 3 possible matches for <name>"). They are mapped to
     a fixed class code instead.
     ======================================================================== */
  var WFDX_MAX_RECEIPTS = 16;
  var wfdx = { receipts: [], env: null, envAt: 0, observedDay: '', observedDayAt: 0, openedAt: 0, reviewId: '' };
  /* Reason codes the current MLS Assist write/probe/teach surfaces can return,
     plus this page's own. Anything else is reported as 'unlisted' so a future
     (or malformed) string can never carry free text into the report. Keep this
     allowlist synchronized with the extension sources; the contract suite
     derives their fixed reason literals and fails when a new code is omitted. */
  var WFDX_KNOWN_REASONS = {};
  ('account-mismatch account-unverifiable ambiguous ambiguous-athena-tabs appointment-id-ambiguous ' +
   'appointment-id-missing appointment-id-not-found appointment-navigation-snapshot-unavailable ' +
   'appointment-navigation-unverified athena-navigation-busy athena-page-changed bad-action ' +
   'billing-context-unverified billing-context-verified billing-duplicate-rejected billing-exact-match ' +
   'billing-existing-row-ambiguous billing-near-match-rejected billing-payload-mismatch blank-error ' +
   'bridge-error cancelled catalog-identity-required catalog-query-required context-mismatch ' +
   'context-unverifiable context-unverified context-verified display-execute-day-mismatch dob-mismatch ' +
   'duplicate-session exact-note-editor-verified-unsaved extension-error frame-coverage-unverified ' +
   'frame-generation-changed fresh-trusted-click-required goto-date-deadline-exceeded ' +
   'goto-date-relay-deadline-exceeded high-risk-order-blocked invalid-binding invalid-target-retry ' +
   'local-patient-id-required loopback-synthetic-only missing-order-fields missing-session name-not-found ' +
   'named-section-final-action-unsupported no-athena-tab no-name-match no-response no-results not-watching ' +
   'note-content-required note-destination-mismatch note-editor-not-empty note-payload-mismatch ' +
   'note-section-count-mismatch note-section-payload-mismatch note-write-proof-expired note-write-proof-used ' +
   'note-write-unverified numeric-only-field-refused one-exact-order-isolated-readback-verified ' +
   'open-deadline-exceeded open-timeout order-client-id-mismatch order-exact-already-present ' +
   'order-existing-duplicate-rejected order-field-too-long order-id-required order-not-reviewed ' +
   'order-payload-incomplete order-payload-mismatch order-row-mismatch order-workspace-context-verified ' +
   'outcome-uncertain patient-dob-unverifiable patient-mismatch patient-unverifiable practice-mismatch ' +
   'practice-unverifiable preview-hash-mismatch provider-mismatch provider-unverifiable rows-not-rendered ' +
   'schedule-date-missing-after-recovery schedule-date-restore-failed search-deadline-exceeded ' +
   'session-expired sign-prerequisite-mismatch synthetic-local-only taught-destination-binding-mismatch ' +
   'taught-destination-control-mismatch taught-destination-expired taught-destination-fingerprint-mismatch ' +
   'taught-destination-frame-mismatch taught-destination-invalid taught-destination-label-mismatch ' +
   'taught-destination-required taught-destination-selector-mismatch taught-destination-validated ' +
   'test-content-production-disabled timeout token-action-mismatch token-expired token-sender-mismatch ' +
   'token-tab-mismatch token-used unknown-action unknown-note-section unresolved-after-pull unsafe-note-policy ' +
   'unsupported-order-fields unsupported-order-source unsupported-order-type untrusted-sender ' +
   'verified-note-write-required watcher-error watcher-unavailable worker-unreachable ' +
   'write-safety-final-action-blocked write-safety-guard-missing wrong-tab').split(' ').forEach(function (code) { WFDX_KNOWN_REASONS[code] = 1; });
  function wfdxReason(value) {
    var raw = S(value).trim();
    if (!raw) return '';
    return WFDX_KNOWN_REASONS[raw] === 1 ? raw : 'unlisted';
  }
  function wfdxReasonCounts(values) {
    var out = {};
    (Array.isArray(values) ? values : []).slice(0, 32).forEach(function (value) {
      var code = wfdxReason(value && value.reason);
      if (code) out[code] = Number(out[code] || 0) + 1;
    });
    return out;
  }
  var WFDX_ERROR_CLASSES = [
    [/no name fallback was attempted/i, 'appointment-row-open-refused'],
    [/could not identify one exact patient encounter frame/i, 'no-encounter-frame'],
    [/more than one signed-in athena tab/i, 'ambiguous-athena-tabs'],
    [/open one signed-in athena tab|no athenaone tab open|open your signed-in athenaone/i, 'no-athena-tab'],
    [/week strip shows|is showing .* instead of/i, 'day-view-wrong-day'],
    [/calendar view could not be reached/i, 'day-view-unreachable'],
    [/refusing to open any of them/i, 'name-search-ambiguous'],
    [/dob on file does not match/i, 'name-search-dob-mismatch'],
    [/found no matching patient/i, 'name-search-no-match'],
    [/timed out|deadline/i, 'timeout'],
    [/write and verify this exact reviewed note/i, 'note-write-proof-missing']
  ];
  function wfdxErrorClass(value) {
    var raw = S(value);
    if (!raw) return '';
    for (var i = 0; i < WFDX_ERROR_CLASSES.length; i++) if (WFDX_ERROR_CLASSES[i][0].test(raw)) return WFDX_ERROR_CLASSES[i][1];
    return 'unclassified';
  }
  function wfdxCount(value) {
    var n = Number(value);
    return isFinite(n) && n >= 0 && Math.floor(n) === n ? n : -1;
  }
  var WFDX_VIA = { 'appointment-id': 'the exact appointment row', 'schedule-click': 'the schedule row',
    findpatient: 'athenaOne patient search', 'findpatient-dob-override': 'athenaOne patient search',
    search: 'athenaOne patient search', 'patient search': 'athenaOne patient search' };
  function wfdxVia(value) { return WFDX_VIA[S(value).trim()] || 'athenaOne'; }
  function wfdxDayKey(value) {
    var day = visitDay(value);
    return /^\d{4}-\d{2}-\d{2}$/.test(S(day)) ? day : '';
  }
  function wfdxReset(manifest) {
    wfdx.receipts = []; wfdx.observedDay = ''; wfdx.observedDayAt = 0; wfdx.openedAt = Date.now();
    wfdx.reviewId = S(manifest && manifest.manifestHash);
  }
  /* One receipt per bridge round trip. `verb` and `stage` are ours; every other
     field is a code, count, boolean or date key. */
  function wfdxNote(entry) {
    entry = entry || {};
    var receipt = {
      at: new Date().toISOString(), verb: S(entry.verb).slice(0, 28), stage: S(entry.stage).slice(0, 28),
      mode: S(entry.mode).slice(0, 12), action: S(entry.action).slice(0, 24), rowId: S(entry.rowId).slice(0, 24),
      ok: entry.ok === true, timeout: entry.timeout === true,
      attempted: entry.attempted === true, partialMutation: entry.partialMutation === true,
      reason: wfdxReason(entry.reason), detailReason: wfdxReason(entry.detail),
      resultReasons: wfdxReasonCounts(entry.results), errorClass: wfdxErrorClass(entry.error),
      appointmentIdPresent: entry.appointmentIdPresent === true,
      encounterBound: entry.encounterBound === true,
      identityLock: S(entry.identityLock || 'not-attempted').slice(0, 24),
      athenaTabs: wfdxCount(entry.athenaTabs === undefined ? (wfdx.env && wfdx.env.tabs) : entry.athenaTabs),
      observedDay: wfdxDayKey(entry.observedDay || wfdx.observedDay),
      expectedDay: wfdxDayKey(entry.expectedDay)
    };
    wfdx.receipts.push(receipt);
    while (wfdx.receipts.length > WFDX_MAX_RECEIPTS) wfdx.receipts.shift();
    return receipt;
  }
  function wfdxProbeReceipt(state, row, probe, stage) {
    var manifest = (state && state.manifest) || {}, visit = manifest.visit || {};
    var reason = S(probe && probe.reason), lock = 'not-attempted';
    if (probe && probe.__timeout === true) lock = 'no-response';
    else if (probe && probe.ok === true) lock = 'verified';
    else if (reason === 'patient-mismatch') lock = 'mismatch';
    else if (probe && probe.ok === false) lock = 'refused';
    return wfdxNote({
      verb: 'mlsAppAthenaActionV2', stage: stage || 'probe', mode: stage === 'execute' ? 'execute' : 'probe',
      action: S(row && row.action), rowId: S(row && row.id),
      ok: !!(probe && probe.ok === true), timeout: !!(probe && probe.__timeout === true),
      reason: reason, error: probe && (probe.error || probe.message),
      detail: probe && probe.detail, results: probe && probe.results,
      attempted: !!(probe && probe.attempted === true), partialMutation: !!(probe && probe.partialMutation === true),
      appointmentIdPresent: !!S(visit.appointmentId).trim(),
      encounterBound: !!(S(visit.encounterId).trim() && S(visit.encounterUrl).trim()),
      identityLock: lock, expectedDay: visit.visitDate
    });
  }
  /* mlsExtHealth: operational metadata only (version, athenaOne tab count and
     how many Chrome has unloaded). Never reads a chart. */
  function wfdxHealth(force) {
    if (!force && wfdx.env && (Date.now() - wfdx.envAt) < 15000) return Promise.resolve(wfdx.env);
    return bridge('mlsExtHealth', {}, 'mlsExtHealthResult', 6000).then(function (resp) {
      var out = { ok: false, tabs: -1, discarded: -1, version: '' };
      if (resp && resp.ok === true) {
        out.ok = true;
        out.version = S(resp.versionName || resp.version).split('+')[0].slice(0, 24);
        if (resp.athena && typeof resp.athena === 'object') { out.tabs = wfdxCount(resp.athena.tabs); out.discarded = wfdxCount(resp.athena.discarded); }
      }
      wfdx.env = out; wfdx.envAt = Date.now();
      return out;
    }, function () { var out = { ok: false, tabs: -1, discarded: -1, version: '' }; wfdx.env = out; wfdx.envAt = Date.now(); return out; });
  }
  /* The plain-English "what should I click" line. Never names the patient. */
  function wfdxEnvLine(manifest, env) {
    var bits = [], visit = (manifest && manifest.visit) || {}, day = wfdxDayKey(visit.visitDate);
    if (env && env.ok) {
      if (env.version) bits.push('MLS Assist ' + env.version);
      if (env.tabs === 0) bits.push('no athenaOne tab is open - open athenaOne and sign in');
      else if (env.tabs === 1) bits.push('1 athenaOne tab open');
      else if (env.tabs > 1) bits.push(env.tabs + ' athenaOne tabs open - close the extras and keep one');
      if (env.discarded > 0) bits.push(env.discarded + ' athenaOne tab unloaded by Chrome - click it once so it can paint');
    } else bits.push('MLS Assist did not answer the health check');
    bits.push(day ? ('expected day ' + day) : 'this review has no expected day');
    bits.push(S(visit.appointmentId).trim() ? 'appointment id is bound' : 'no appointment id is bound to this encounter');
    if (wfdx.observedDay) bits.push('athenaOne Day view is on ' + wfdx.observedDay + (day && wfdx.observedDay !== day ? ' - not ' + day : ''));
    return bits.join(' · ');
  }
  function wfdxReport(manifest) {
    var visit = (manifest && manifest.visit) || {};
    return {
      kind: 'mls-athena-review-error-report', at: new Date().toISOString(),
      build: (function () { try { return S(window.__MLS_AV); } catch (e) { return ''; } })(),
      writeflow: VERSION,
      env: {
        ua: (function () { try { return S(navigator.userAgent).slice(0, 220); } catch (e) { return ''; } })(),
        tz: (function () { try { return S(Intl.DateTimeFormat().resolvedOptions().timeZone); } catch (e) { return ''; } })(),
        extension: wfdx.env ? { ok: wfdx.env.ok, version: wfdx.env.version, athenaTabs: wfdx.env.tabs, athenaTabsUnloaded: wfdx.env.discarded } : null,
        capabilities: {
          athenaFinalActionsV1: athenaFinalActionsReady(),
          supervisedOrderPlacementV2: supervisedOrderPlacementReady()
        },
        probeOnly: probeOnlyActive()
      },
      review: {
        manifestHash: S(manifest && manifest.manifestHash), previewHash: S(manifest && manifest.previewHash),
        expectedDay: wfdxDayKey(visit.visitDate), observedDay: wfdx.observedDay,
        appointmentIdPresent: !!S(visit.appointmentId).trim(), providerPresent: !!S(visit.provider).trim(),
        encounterBound: !!(S(visit.encounterId).trim() && S(visit.encounterUrl).trim()),
        identityComplete: !!(manifest && manifest.patient && S(manifest.patient.patientId).trim() && S(manifest.patient.name).trim() && S(manifest.patient.dob).trim() && S(manifest.patient.mrn).trim()),
        rows: (manifest && manifest.rows ? manifest.rows : []).map(function (row) { return { id: row.id, action: row.action, capability: row.capability }; })
      },
      receipts: wfdx.receipts.slice()
    };
  }
  function wfdxCopyText(text, btn, idleLabel) { unifiedCopyText(text, btn, idleLabel); }

  function startAthenaAction(action, opts) {
    opts = opts || {};
    if (!ATHENA_ACTIONS[action]) { actionSay(opts, 'Unsupported Athena action. Nothing was changed.', 'err'); return Promise.resolve({ ok: false, error: 'unsupported-action' }); }
    if (!ATHENA_EXECUTABLE_ACTIONS[action]) {
      actionSay(opts, 'This payload is review-only here. Complete it directly in Athena; MLS keeps the exact payload visible for you.', '');
      return Promise.resolve({ ok: false, error: 'manual-only-final-action' });
    }
    if ((action === 'stage_billing' || action === 'sign_encounter' || action === 'place_order') && !athenaFinalActionsReady()) {
      actionSay(opts, FINAL_ACTION_EXT_BLOCK + ' Nothing was changed.', 'err');
      return Promise.resolve({ ok: false, error: 'final-action-capability-required' });
    }
    if (unifiedAthenaState && unifiedAthenaState.closed !== true) { actionSay(opts, 'The unified Athena review is already open. Finish or close that review before starting another Athena action.', ''); return Promise.resolve({ ok: false, error: 'unified-review-open' }); }
    if (athenaActionRunning) { actionSay(opts, 'Another Athena action is awaiting confirmation or still running. Finish or cancel it first.', ''); return Promise.resolve({ ok: false, error: 'busy' }); }
    var patient = actionPatient(opts);
    if (!patient.name || !patient.dob) { actionSay(opts, 'Patient name and DOB are required before ' + ATHENA_ACTIONS[action].label + '. Athena will verify and lock the chart MRN read-only before confirmation. Nothing was changed.', 'err'); return Promise.resolve({ ok: false, error: 'incomplete-patient-identity' }); }
    var payload = actionPayload(action, opts);
    if ((action === 'write_note' || action === 'save_draft' || action === 'sign_encounter') && !S(payload.noteText).trim()) {
      actionSay(opts, 'The exact reviewed note text is required before ' + ATHENA_ACTIONS[action].label + '. Nothing was changed.', 'err');
      return Promise.resolve({ ok: false, error: 'no-reviewed-note' });
    }
    if (action === 'stage_billing' && !hasBilling(payload.billing)) { actionSay(opts, 'No E/M or CPT billing codes are ready to stage. Nothing was changed.', 'err'); return Promise.resolve({ ok: false, error: 'no-billing-codes' }); }
    if (action === 'stage_billing' && payload.billing.invalid && payload.billing.invalid.length) { actionSay(opts, 'One or more billing items are not exact five-character CPT/HCPCS codes: ' + payload.billing.invalid.join(', ') + '. Fix them before staging; nothing was changed.', 'err'); return Promise.resolve({ ok: false, error: 'invalid-billing-code' }); }
    if (action === 'place_order') {
      if (!supervisedOrderPlacementReady()) { actionSay(opts, 'Update MLS Assist before supervised order placement. Enter the order manually in Athena until the extension advertises the exact supervised-order safety contract. Nothing was changed.', 'err'); return Promise.resolve({ ok: false, error: 'supervised-order-capability-required' }); }
      var checkedOrder = canonicalOrder(payload.order || {});
      if (!checkedOrder.ok) { actionSay(opts, checkedOrder.error + ' Nothing was changed.', 'err'); return Promise.resolve({ ok: false, error: checkedOrder.reason }); }
      payload = { order: checkedOrder.order };
      if (!S(opts.rowHash).trim()) { actionSay(opts, 'The exact order row is missing its immutable review hash. Reopen the order confirmation; nothing was changed.', 'err'); return Promise.resolve({ ok: false, error: 'order-row-hash-required' }); }
    }
    var previewHash = S(opts.previewHash || hashPreview({ patient: patient, action: action, payload: payload }));
    var expectedContext = expectedVisitContext(patient, opts);
    if (opts.requireExpectedVisit && (!expectedContext || !expectedContext.visitDate || !expectedContext.provider)) {
      actionSay(opts, 'This saved visit does not contain an exact encounter date and provider. Athena actions are disabled for it so the note cannot be placed in a different historical encounter. Nothing was changed.', 'err');
      return Promise.resolve({ ok: false, error: 'historical-encounter-context-missing' });
    }
    var priorWriteReceipt = action === 'sign_encounter' ? findAnyVerifiedWrite(patient, previewHash, opts, payload) : null;
    if (action === 'sign_encounter' && (!S(opts.receiptSessionId) || !priorWriteReceipt || !priorWriteReceipt.noteWriteProof)) {
      actionSay(opts, 'Write the reviewed note to this encounter first — Sign & Save unlocks after MLS verifies the note write. Nothing was changed.', 'err');
      return Promise.resolve({ ok: false, error: 'verified-note-write-required' });
    }
    athenaActionRunning = true;
    actionSay(opts, 'Checking the exact Athena encounter before ' + ATHENA_ACTIONS[action].label + '…', '');
    var bridgeProbePatient = bridgePatient(patient);
    return bridge('mlsAppAthenaActionV2', {
      mode: 'probe', action: action, patient: bridgeProbePatient,
      expectedPatient: bridgeProbePatient, expectedContext: expectedContext,
      previewHash: previewHash, payload: payload,
      noteText: payload.noteText || '', sections: payload.sections || [],
      notePolicy: 'empty_only',
      noteWriteProof: priorWriteReceipt ? priorWriteReceipt.noteWriteProof : '',
      billing: payload.billing || null, order: payload.order || null,
      rowHash: action === 'place_order' ? S(opts.rowHash).trim() : '',
      clientOrderId: action === 'place_order' ? S(payload.order && payload.order.clientOrderId).trim() : ''
    }, 'mlsAppAthenaActionV2Result', 90000).then(function (probe) {
      probe = probe || {};
      if (!probe.ok) {
        var canAutoOpen = AUTO_OPEN_REASONS[String(probe.reason || '')] === 1 && opts.autoOpen !== false && opts.__autoOpened !== true;
        if (!canAutoOpen) { athenaActionRunning = false; actionSay(opts, probe.error || probe.message || 'Athena context could not be verified. Nothing was changed.', 'err'); return probe; }
        actionSay(opts, patient.name + ' is not open in Athena. MLS is opening the chart there now — nothing is written without your confirmation.', '');
        return searchOpenTarget(patient, expectedContext).then(function (openRes) {
          athenaActionRunning = false;
          if (!openRes || openRes.ok !== true) {
            actionSay(opts, 'MLS could not open ' + patient.name + ' in Athena on its own' + ((openRes && (openRes.error || openRes.reason)) ? (': ' + (openRes.error || openRes.reason)) : '') + '. Open the chart in Athena, then try again. Nothing was changed.', 'err');
            return probe;
          }
          actionSay(opts, patient.name + ' is open in Athena. Re-verifying the exact encounter…', '');
          return startAthenaAction(action, Object.assign({}, opts, { __autoOpened: true }));
        });
      }
      try { if (typeof opts.onProbe === 'function') opts.onProbe(probe); } catch (e0) {}
      showActionConfirm(action, opts, patient, previewHash, payload, probe);
      return probe;
    });
  }

  /* ---------------- unified Athena manifest review ----------------------- */
  /* The extension's trusted-click contract intentionally authorizes exactly
     one typed mutation per real click. The unified page therefore shows every
     destination and payload together, but lets the clinician select exactly
     one ready action for each Confirm & write click. It never auto-chains the
     next action. This preserves the one-use action token and makes partial or
     uncertain outcomes stop the workflow immediately. */
  var UNIFIED_ORDER = { write_note: 10, stage_billing: 20, save_draft: 30, sign_encounter: 40, dx: 50, orders: 60, order: 60, rx: 70, referrals: 80, pt: 90, imaging: 100, procedure: 105, documents: 110, unknown: 999 };
  var UNIFIED_MANUAL = {
    dx: { label: 'Diagnoses (ICD-10)', destination: 'Athena encounter > Assessment & Plan > Diagnoses', consequence: 'MLS has no typed, exact-result ICD-10 adapter in this workflow. These diagnoses remain visible for manual entry and are not sent.' },
    orders: { label: 'Orders', destination: 'Athena encounter > Orders', consequence: 'Only one complete reviewed imaging, PT, referral, or DME payload can use the typed exact-catalog adapter after a fresh clinician confirmation. Prose, incomplete drafts, Rx, and injections remain manual or blocked.' },
    rx: { label: 'Prescriptions', destination: 'Athena encounter > Prescriptions', consequence: 'Medication details, pharmacy, safety checks, and e-signing require Athena review. MLS will not prescribe from this page.' },
    referrals: { label: 'Referrals', destination: 'Athena encounter > Orders > Referral', consequence: 'Referral routing requires a typed order and destination. MLS keeps this payload manual.' },
    pt: { label: 'Physical therapy', destination: 'Athena encounter > Orders > PT', consequence: 'PT orders require a typed order and clinical review. MLS keeps this payload manual.' },
    imaging: { label: 'Imaging', destination: 'Athena encounter > Orders > Imaging', consequence: 'Imaging orders require a typed catalog item, site/laterality, and clinical review. MLS keeps this payload manual.' },
    surgctr: { label: 'Surgery scheduling', destination: 'Athena surgery scheduling workflow', consequence: 'Scheduling and procedure-chain actions are blocked from automated write-back.' },
    consent: { label: 'Consent', destination: 'Athena patient documents > Consent', consequence: 'Consent requires its own document and signature workflow. MLS keeps it manual.' },
    handouts: { label: 'Patient handouts', destination: 'Athena patient documents > Handouts', consequence: 'Document routing is not typed in this workflow. MLS keeps it manual.' },
    instructions: { label: 'Patient instructions', destination: 'Athena encounter > Patient instructions', consequence: 'Patient instructions remain visible but are not written by this typed action bridge.' },
    documents: { label: 'Documents / letters', destination: 'Athena patient documents', consequence: 'The document type and destination are not typed in this workflow. MLS keeps this payload manual.' }
  };
  var UNIFIED_ALIASES = { diagnoses: 'dx', diagnosis: 'dx', icd: 'dx', icd10: 'dx', prescription: 'rx', prescriptions: 'rx', referral: 'referrals', opnote: 'procedure', op_note: 'procedure', procedure_note: 'procedure', operative_note: 'procedure', document: 'documents', letter: 'documents', letters: 'documents', avs: 'documents', prior_auth: 'documents', ime: 'documents', mips: 'documents' };
  var UNIFIED_ARIA = {
    write_note: 'Confirm write reviewed note',
    save_draft: 'Confirm save draft in Athena',
    stage_billing: 'Confirm stage billing in Athena',
    sign_encounter: 'Confirm Sign and Save in Athena',
    /* MLS Assist arms place_order ONLY from a trusted click whose label reads
       "confirm [and] place [one] [reviewed] order" (content.js
       _mlsActionLabelMatches) - keep this phrase exact. */
    place_order: 'Confirm and place one reviewed order in Athena'
  };

  function deepFreeze(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    try { Object.freeze(value); } catch (e) {}
    return value;
  }
  function stableClone(value) {
    try { return JSON.parse(JSON.stringify(stableValue(value))); } catch (e) { return stableValue(value); }
  }
  function planKind(value) {
    var key = S(value).toLowerCase().trim().replace(/[\s-]+/g, '_');
    return UNIFIED_ALIASES[key] || key;
  }
  function manifestPayloadText(row) {
    var payload = row && row.payload || {};
    if (payload.category === 'order') {
      var orderLines = [
        'Type: ' + (payload.orderTypeLabel || payload.orderType || 'Order'),
        'Proposed destination: ' + (payload.proposedDestination || row.destination || 'Athena Orders'),
        'Source: ' + (payload.sourceLabel || payload.source || 'Provider-entered draft'),
        'Review status: ' + (payload.reviewStatus || 'draft'),
        'Summary: ' + (payload.summary || payload.originalText || '(No summary)')
      ];
      var fields = payload.fields || {};
      Object.keys(fields).sort().forEach(function (key) {
        var value = S(fields[key]).trim();
        if (value) orderLines.push(key + ': ' + value);
      });
      if (payload.originalText && payload.originalText !== payload.summary) orderLines.push('Original suggestion: ' + payload.originalText);
      if (payload.order) {
        orderLines.push('Client order ID: ' + payload.order.clientOrderId);
        orderLines.push('Exact catalog query: ' + payload.order.query);
        orderLines.push('Exact catalog label: ' + payload.order.displayLabel);
        if (payload.order.catalogCode) orderLines.push('Catalog code: ' + payload.order.catalogCode);
        if (payload.order.catalogId) orderLines.push('Catalog ID: ' + payload.order.catalogId);
      }
      return orderLines.join('\n');
    }
    if (row && row.kind === 'billing') {
      var b = payload.billing || {}, lines = [];
      lines.push('E/M: ' + (b.em || b.emCode || 'none'));
      lines.push('CPT / HCPCS: ' + ((b.cptCodes && b.cptCodes.length) ? b.cptCodes.join(', ') : 'none'));
      (b.cpt || []).forEach(function (item) {
        var detail = [item.code || item.raw || '(unparsed item)', 'units ' + item.units + ' (manual review only)'];
        if (item.modifiers && item.modifiers.length) detail.push('modifiers ' + item.modifiers.join(', ') + ' (manual review only)');
        if (item.dxPointers && item.dxPointers.length) detail.push('diagnosis pointers ' + item.dxPointers.join(', ') + ' (manual review only)');
        lines.push('- ' + detail.join(' | '));
      });
      if (b.diagnoses && b.diagnoses.length) lines.push('Diagnoses (manual only): ' + b.diagnoses.join(', '));
      if (payload.reviewText) lines.push('', payload.reviewText);
      return lines.join('\n');
    }
    return S(payload.noteText || payload.reviewText || payload.body || '').trim() || '(No text payload)';
  }
  function orderDestination(type) {
    var key = S(type).toLowerCase().trim();
    var routes = {
      medication: 'Athena encounter > Prescriptions / Medication order',
      pt: 'Athena encounter > Orders > Physical therapy',
      dme: 'Athena encounter > Orders > DME / Medical supplies',
      imaging: 'Athena encounter > Orders > Imaging',
      injection: 'Athena encounter > Orders > Procedure / Injection',
      referral: 'Athena encounter > Orders > Referral'
    };
    return routes[key] || 'Athena encounter > Orders > Matched catalog item';
  }
  function orderLabel(type) {
    var labels = { medication: 'Medication', pt: 'Physical therapy', dme: 'DME / brace', imaging: 'Imaging', injection: 'Injection / procedure', referral: 'Referral' };
    var key = S(type).toLowerCase().trim();
    return labels[key] || (key ? key.replace(/_/g, ' ') : 'Order');
  }
  var EXECUTABLE_ORDER_FIELDS = {
    imaging: { allowed: ['study','region','indication','laterality','contrast','notes'], required: ['study','region','indication'] },
    pt: { allowed: ['dx','freq','duration','modalities','notes'], required: ['dx','freq','duration','modalities'] },
    referral: { allowed: ['specialty','reason','notes'], required: ['specialty','reason'] },
    dme: { allowed: ['item','dx','icd','notes'], required: ['item','dx','icd'] }
  };
  function normalizedOrderType(raw) {
    var key = S(raw).toLowerCase().trim().replace(/[\s-]+/g, '_');
    var aliases = { physical_therapy: 'pt', therapy: 'pt', physicaltherapy: 'pt', durable_medical_equipment: 'dme', brace: 'dme', radiology: 'imaging', consult: 'referral' };
    return aliases[key] || key;
  }
  function canonicalOrder(item) {
    item = item && typeof item === 'object' ? item : {};
    var type = normalizedOrderType(item.type || item.orderType), schema = EXECUTABLE_ORDER_FIELDS[type];
    if (!schema) return { ok: false, reason: /^(medication|rx|injection|procedure)$/.test(type) ? 'high-risk-order-blocked' : 'unsupported-order-type', error: /^(medication|rx|injection|procedure)$/.test(type) ? 'Medication and injection orders need their own complete safety adapter and remain blocked.' : 'This order type does not have a typed Athena adapter.' };
    var rawFields = item.fields && typeof item.fields === 'object' ? item.fields : {}, fields = {}, unknown = [], overlong = [];
    Object.keys(rawFields).sort().forEach(function (key) {
      var value = S(rawFields[key]).trim();
      if (!value) return;
      if (schema.allowed.indexOf(key) < 0) { unknown.push(key); return; }
      if (value.length > 2000) { overlong.push(key); return; }
      fields[key] = value;
    });
    if (overlong.length) return { ok: false, reason: 'order-field-too-long', error: 'The following order field exceeds 2000 characters: ' + overlong.join(', ') + '.' };
    if (unknown.length) return { ok: false, reason: 'unsupported-order-fields', error: 'Unsupported ' + type + ' field(s): ' + unknown.join(', ') + '.' };
    var missing = schema.required.filter(function (key) { return !S(fields[key]).trim(); });
    if (missing.length) return { ok: false, reason: 'missing-order-fields', error: 'Complete the required ' + type + ' field(s): ' + missing.join(', ') + '.' };
    var reviewStatus = S(item.reviewStatus).toLowerCase().trim();
    if (!/^(accepted|reviewed|accepted\s*\/\s*reviewed draft)$/.test(reviewStatus)) return { ok: false, reason: 'order-not-reviewed', error: 'The clinician must accept and review this order before it can be placed.' };
    var source = S(item.source).trim();
    if (!/^(provider-entered|ai-suggestion-accepted|rule-suggestion-accepted)$/.test(source)) return { ok: false, reason: 'unsupported-order-source', error: 'The order source is not an allowlisted reviewed source.' };
    var displayLabel = S(item.displayLabel).trim();
    var query = S(item.query).trim();
    var clientOrderId = S(item.clientOrderId).trim();
    var catalogCode = S(item.catalogCode).trim(), catalogId = S(item.catalogId).trim();
    if (!clientOrderId) return { ok: false, reason: 'order-id-required', error: 'This reviewed order is missing its immutable local order ID.' };
    if (!displayLabel || !query) return { ok: false, reason: 'catalog-query-required', error: 'This reviewed order needs an exact Athena catalog label/search query.' };
    if (!catalogCode && !catalogId) return { ok: false, reason: 'catalog-identity-required', error: 'A durable Athena catalog code or catalog ID is required before this order can be placed.' };
    if (clientOrderId.length > 160 || displayLabel.length > 300 || query.length > 300 || catalogCode.length > 100 || catalogId.length > 160) return { ok: false, reason: 'order-field-too-long', error: 'One or more order identity fields is too long.' };
    var order = { clientOrderId: clientOrderId, type: type, displayLabel: displayLabel, catalogCode: catalogCode, catalogId: catalogId, query: query, fields: fields, reviewStatus: 'accepted', source: source };
    return { ok: true, order: deepFreeze(order) };
  }
  function structuredOrderRows(source, planIndex, addRow, commonBlock) {
    var drafts = Array.isArray(source.orderDrafts) ? source.orderDrafts : (Array.isArray(source.orders) ? source.orders : []);
    var suggestions = Array.isArray(source.orderSuggestions) ? source.orderSuggestions : [];
    function payloadOf(item, reviewStatus, fallbackSource) {
      item = item || {};
      var type = S(item.type || item.orderType).toLowerCase().trim();
      var sourceKey = S(item.source || fallbackSource).trim() || fallbackSource;
      var sourceLabels = {
        'provider-entered': 'Provider-entered draft',
        'ai-suggestion-accepted': 'Accepted AI suggestion',
        'rule-suggestion-accepted': 'Accepted rules-based suggestion',
        'ai-suggestion': 'AI suggestion (not accepted)',
        'rule-suggestion': 'Rules-based suggestion (not accepted)',
        'legacy-auto-suggestion': 'Legacy generated suggestion (not accepted)'
      };
      var canonical = canonicalOrder(item);
      return {
        category: 'order', orderType: type, orderTypeLabel: orderLabel(type),
        proposedDestination: orderDestination(type), fields: stableClone(item.fields || {}),
        summary: S(item.summary || item.displayLabel || item.label || item.originalText || item.text).trim(),
        originalText: S(item.originalText || item.text || item._src).trim(),
        source: sourceKey, sourceLabel: sourceLabels[sourceKey] || sourceKey || 'Provider-entered draft',
        reviewStatus: reviewStatus, complete: item.complete !== false,
        order: canonical.ok ? stableClone(canonical.order) : null,
        orderEligibility: canonical.ok ? '' : canonical.reason,
        orderEligibilityMessage: canonical.ok ? '' : canonical.error
      };
    }
    function completeDraft(item) {
      if (!item || item.complete === false) return false;
      if (item.complete === true) return true;
      var type = S(item.type || item.orderType).toLowerCase().trim(), fields = item.fields || {};
      var primary = { medication: 'drug', pt: 'dx', dme: 'item', imaging: 'study', injection: 'inj', referral: 'specialty' }[type];
      return !!(primary && S(fields[primary]).trim());
    }
    drafts.forEach(function (item, index) {
      var complete = completeDraft(item);
      var payload = payloadOf(item, complete ? 'accepted / reviewed draft' : 'incomplete reviewed draft', 'provider-entered');
      payload.complete = complete;
      var fullySpecified = complete && !!payload.order;
      var highRisk = /^(medication|injection)$/.test(payload.orderType);
      if (fullySpecified && athenaFinalActionsReady() && supervisedOrderPlacementReady()) {
        /* Owner directive 2026-08-12 (MLS Assist 3.0.62+): one complete,
           clinician-accepted, catalog-bound imaging/PT/referral/DME order is a
           typed place_order row - the extension's supervised single-order
           contract (exact catalog item, isolated read-back, one confirm) does
           the placing. It blocks only for real correctness gaps: unbound
           identity/encounter (commonBlock) - never for policy. */
        addRow({ id: 'order-draft-' + planIndex + '-' + index, action: 'place_order', kind: 'orders', label: ATHENA_FINAL_READY.place_order.label + ': ' + payload.order.displayLabel,
          destination: payload.proposedDestination, capability: commonBlock ? 'blocked' : 'ready', source: payload.sourceLabel, reviewStatus: payload.reviewStatus,
          reason: commonBlock || '', consequence: ATHENA_FINAL_READY.place_order.consequence,
          payload: payload, order: UNIFIED_ORDER.orders + index / 1000 });
        return;
      }
      var staleExt = fullySpecified && !(athenaFinalActionsReady() && supervisedOrderPlacementReady());
      addRow({ id: 'order-draft-' + planIndex + '-' + index, action: '', kind: 'orders', label: fullySpecified ? ATHENA_ACTIONS.place_order.label + ': ' + payload.order.displayLabel : payload.orderTypeLabel,
        destination: payload.proposedDestination, capability: fullySpecified || highRisk ? 'manual' : 'blocked', source: payload.sourceLabel, reviewStatus: payload.reviewStatus,
        reason: staleExt ? FINAL_ACTION_EXT_BLOCK + ' MLS keeps this immutable reviewed payload visible for manual entry until then.' : (highRisk ? 'Complete in Athena. Medication and injection orders have no typed MLS adapter, so they stay in the clinician\'s hands.' : (payload.orderEligibilityMessage || 'This reviewed draft is incomplete or lacks an exact catalog binding. Complete it in Athena.')),
        consequence: fullySpecified ? ATHENA_ACTIONS.place_order.consequence : (highRisk ? 'This medication or injection order remains visible for manual Athena entry; no typed adapter exists, so MLS will not prescribe, inject, submit, or place it.' : 'Nothing is sent or executed for this incomplete or unbound draft.'),
        payload: payload, order: UNIFIED_ORDER.orders + index / 1000 });
    });
    suggestions.forEach(function (item, index) {
      var payload = payloadOf(item, 'suggestion only — not accepted', 'ai-suggestion');
      addRow({ id: 'order-suggestion-' + planIndex + '-' + index, action: '', kind: 'orders', label: payload.orderTypeLabel,
        destination: payload.proposedDestination, capability: 'blocked', source: payload.sourceLabel, reviewStatus: payload.reviewStatus,
        reason: 'Suggestion only. The clinician has not accepted this proposed order, so it cannot be executed or treated as a reviewed draft.',
        consequence: 'Nothing is sent. Accept and review the order in the Orders workspace before any manual Athena entry.',
        payload: payload, order: UNIFIED_ORDER.orders + .5 + index / 1000 });
    });
    return drafts.length + suggestions.length;
  }
  function buildUnifiedManifest(opts) {
    opts = opts || {};
    var patient = stableClone(actionPatient(opts));
    var plan = Array.isArray(opts.plan) ? stableClone(opts.plan) : [];
    var noteSections = receiptNoteSections({ sections: opts.sections, plan: plan });
    var noteText = noteSections.map(function (s) { return s.key === 'note' ? S(s.text).trim() : (S(s.key).toUpperCase() + ':\n' + S(s.text).trim()); }).filter(Boolean).join('\n\n').trim();
    var notePayload = { sections: stableClone(noteSections), noteText: noteText, reviewText: noteText };
    /* A named clinical section is a distinct Athena destination. Never flatten
       HPI/ROS/Exam/Assessment/Plan into the generic encounter-note editor just
       because all of them happen to be visible on one review page. Each named
       section becomes one immutable row and therefore one fresh probe + one
       clinician confirmation. The generic full-note lane remains one row. */
    var namedNoteLabels = { hpi: 'HPI', ros: 'Review of Systems', exam: 'Physical Exam', assessment: 'Assessment narrative', plan: 'Plan / Follow-up', procedure: 'Procedure / operative note' };
    var noteSectionCounts = {};
    noteSections.forEach(function (section) {
      var key = S(section && section.key).trim();
      if (key) noteSectionCounts[key] = Number(noteSectionCounts[key] || 0) + 1;
    });
    var hasNamedNoteSections = noteSections.some(function (section) { return section && section.key !== 'note'; });
    var supplied = opts.expectedContext || {};
    var expected = expectedVisitContext(patient, opts) || {
      visitDate: S(supplied.visitDate || supplied.encounterDate).trim(),
      provider: S(supplied.provider || supplied.providerName).trim(),
      appointmentId: S(supplied.appointmentId || supplied.id).trim(),
      encounterId: S(supplied.encounterId || supplied.visitId).trim(),
      encounterUrl: S(supplied.encounterUrl || supplied.visitUrl).trim()
    };
    var visit = {
      visitDate: S(expected && expected.visitDate).trim(), provider: S(expected && expected.provider).trim(),
      appointmentId: S(expected && expected.appointmentId).trim(), encounterId: S(expected && expected.encounterId).trim(),
      encounterUrl: S(expected && expected.encounterUrl).trim()
    };
    var receiptSessionId = S(opts.receiptSessionId).trim() || ('athena-unified-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    var previewHash = S(opts.previewHash).trim() || hashPreview({ patient: patient, visit: visit, plan: plan, sections: noteSections });
    var identityBlocked = !patient.patientId || !patient.name || !patient.dob || !patient.mrn;
    /* b745 (write-blocker audit #14): the appointment-id PRE-gate blocked every
       write before the read-only Athena probe ever ran — including today-writes
       whose id the ledger could resolve, and every historical record (a gate
       with no key: no UI could furnish what it demanded). Only a HISTORICAL
       write (requireExpectedVisit) must pre-name its exact encounter; for a
       live write the probe itself discovers, verifies, and LOCKS the open
       encounter (validatedUnifiedProbe still requires the complete matching
       patient plus one exact encounter id/URL/date/provider/control before
       anything can execute). The wrong-chart guarantee is unchanged - it was
       never this pre-gate, it is the probe + the execute-time rebinding. */
    /* 2026-07-28: the LIVE lane painted a row READY that the extension's probe
       predicate could never accept. The pre-gate above only bound HISTORICAL
       writes, so a live review with no bound encounter showed a green READY row
       whose only possible outcome was a refusal at check time. Mirror the
       extension's own predicate here and say WHICH field is missing plus how to
       get it, instead of promising a write that cannot happen. */
    var visitReady = !!visit.visitDate && !!visit.provider &&
      (!!visit.appointmentId || (!!visit.encounterId && !!visit.encounterUrl));
    var visitHasAnyLocator = !!(visit.visitDate || visit.provider || visit.appointmentId || visit.encounterId || visit.encounterUrl);
    /* Only a wholly unbound CURRENT visit may ask Athena to discover the one
       open encounter read-only. A partial locator stays blocked so the
       existing auto-bind path can finish that same locator. */
    var liveVisitNeedsDiscovery = opts.requireExpectedVisit !== true && !visitHasAnyLocator;
    var partialLiveVisitBlocked = opts.requireExpectedVisit !== true && visitHasAnyLocator && !visitReady;
    var exactVisitBlocked = opts.requireExpectedVisit === true &&
      (!visit.visitDate || !visit.provider ||
        (!visit.appointmentId && !(visit.encounterId && visit.encounterUrl)));
    var partialLiveVisitReason = 'The exact visit needs its date, provider, and appointment ID (or a bound encounter ID and URL). MLS will not guess an encounter. Use “Bind this visit to its Athena appointment — re-pulls this day” to run the Athena schedule day pull; MLS then rebuilds this review from the exact appointment. Nothing is sent.';
    var exactVisitReason = 'The exact visit needs its date, provider, and appointment ID (or a bound encounter ID and URL). MLS will not guess an encounter.';
    var commonBlock = identityBlocked
      ? 'An immutable local patient ID plus the exact Athena name, DOB, and MRN are required. Nothing can be written.'
      : (partialLiveVisitBlocked ? partialLiveVisitReason : (exactVisitBlocked ? exactVisitReason : ''));
    /* A CURRENT open encounter with complete patient identity may start with a
       read-only Check Athena probe. The probe must discover exactly one labeled
       date/provider/encounter, freeze the complete context, and execution must
       re-bind that same lock. Historical reviews remain pre-bound above. */
    /* Typed place_order rows (MLS Assist 3.0.62+) share the note rows'
       identity/encounter block; without a capable extension the order rows
       fall back to manual and the block is irrelevant to them. */
    var orderCommonBlock = commonBlock;
    var rows = [];
    function addRow(spec) {
      var payload = stableClone(spec.payload || {});
      var row = {
        id: S(spec.id), action: S(spec.action), kind: S(spec.kind), label: S(spec.label),
        destination: S(spec.destination), capability: S(spec.capability), reason: S(spec.reason),
        consequence: S(spec.consequence), source: S(spec.source), reviewStatus: S(spec.reviewStatus),
        payload: payload, payloadHash: hashPreview(payload), order: Number(spec.order || 999)
      };
      row.rowHash = hashPreview({ id: row.id, action: row.action, kind: row.kind, destination: row.destination, capability: row.capability, source: row.source, reviewStatus: row.reviewStatus, payloadHash: row.payloadHash, consequence: row.consequence });
      rows.push(row);
    }
    if (noteText) {
      if (hasNamedNoteSections) {
        var blockedDuplicateSections = {};
        noteSections.forEach(function (section, sectionIndex) {
          var sectionText = S(section && section.text).trim(), sectionKey = S(section && section.key).trim();
          if (!sectionText) return;
          var sectionPayload = { sections: [stableClone(section)], noteText: sectionText, reviewText: sectionText, sectionKey: sectionKey };
          if (sectionKey === 'note') {
            addRow({ id: 'blocked-mixed-generic-note-' + sectionIndex, action: '', kind: 'note', label: 'Generic encounter note (mixed destination)', destination: DESTINATION.note,
              capability: 'blocked', reason: 'A generic encounter note cannot share one review with named Athena fields. Open it in its own review; MLS will not use the generic editor as a fallback.',
              consequence: 'Nothing is written for this row.', payload: sectionPayload, order: UNIFIED_ORDER.write_note + sectionIndex / 1000 });
            return;
          }
          if (!namedNoteLabels[sectionKey]) return;
          if (noteSectionCounts[sectionKey] !== 1) {
            if (blockedDuplicateSections[sectionKey]) return;
            blockedDuplicateSections[sectionKey] = true;
            var duplicateSections = noteSections.filter(function (candidate) { return S(candidate && candidate.key).trim() === sectionKey; });
            var duplicateText = duplicateSections.map(function (candidate) { return S(candidate && candidate.text).trim(); }).filter(Boolean).join('\n\n');
            addRow({ id: 'blocked-duplicate-note-' + sectionKey, action: '', kind: sectionKey, label: 'Duplicate ' + namedNoteLabels[sectionKey] + ' destinations', destination: DESTINATION[sectionKey],
              capability: 'blocked', reason: 'More than one reviewed payload targets this Athena field. Combine them explicitly before review; MLS will not guess an order or overwrite the field twice.',
              consequence: 'Nothing is written for this destination.', payload: { sections: stableClone(duplicateSections), noteText: duplicateText, reviewText: duplicateText, sectionKey: sectionKey }, order: UNIFIED_ORDER.write_note + sectionIndex / 1000 });
            return;
          }
          addRow({ id: 'write-note-' + sectionKey + '-' + sectionIndex, action: 'write_note', kind: sectionKey,
            label: 'Write reviewed ' + namedNoteLabels[sectionKey], destination: DESTINATION[sectionKey],
            capability: commonBlock ? 'blocked' : 'ready', reason: commonBlock, consequence: ATHENA_ACTIONS.write_note.consequence,
            payload: sectionPayload, order: UNIFIED_ORDER.write_note + sectionIndex / 1000 });
        });
      } else {
        if (noteSectionCounts.note === 1) {
          addRow({ id: 'write-note', action: 'write_note', kind: 'note', label: ATHENA_ACTIONS.write_note.label, destination: DESTINATION.note,
            capability: commonBlock ? 'blocked' : 'ready', reason: commonBlock, consequence: ATHENA_ACTIONS.write_note.consequence, payload: notePayload, order: UNIFIED_ORDER.write_note });
        } else {
          addRow({ id: 'blocked-duplicate-generic-note', action: '', kind: 'note', label: 'Duplicate generic encounter-note destinations', destination: DESTINATION.note,
            capability: 'blocked', reason: 'More than one reviewed payload targets the generic Athena note editor. Combine them explicitly before review; MLS will not concatenate or overwrite them implicitly.',
            consequence: 'Nothing is written for this destination.', payload: notePayload, order: UNIFIED_ORDER.write_note });
        }
      }
    }
    var billingPlan = null;
    for (var pi = 0; pi < plan.length; pi++) { if (planKind(plan[pi] && plan[pi].kind) === 'billing') { billingPlan = plan[pi]; break; } }
    var billingSource = billingPlan && billingPlan.billing ? billingPlan.billing : (opts.billing || opts.coding || {});
    var billing = normalizeBilling(billingSource);
    var billingReview = S(billingPlan && billingPlan.body || opts.billingText).trim();
    if (hasBilling(billing) || (billing.invalid && billing.invalid.length) || billingReview) {
      var billingDetail = (billing.invalid && billing.invalid.length) ? (' Resolve invalid or conflicting item(s): ' + billing.invalid.join(', ') + '.') : (!hasBilling(billing) ? ' No exact E/M or five-character CPT/HCPCS code is available yet.' : '');
      if (athenaFinalActionsReady()) {
        /* Owner directive 2026-08-12 (capable extension only): billing staging
           is a confirmable MLS action; the row blocks only for real
           correctness gaps — unbound identity/encounter, invalid codes, or no
           exact code at all. */
        var billingBlock = commonBlock
          || ((billing.invalid && billing.invalid.length) ? 'Resolve invalid or conflicting item(s): ' + billing.invalid.join(', ') + '. Exact five-character CPT/HCPCS codes are required before staging.' : '')
          || (!hasBilling(billing) ? 'No exact E/M or five-character CPT/HCPCS code is available yet. Nothing can be staged.' : '');
        addRow({ id: 'stage-billing', action: 'stage_billing', kind: 'billing', label: ATHENA_FINAL_READY.stage_billing.label, destination: 'Athena encounter > Billing / Charges slate',
          capability: billingBlock ? 'blocked' : 'ready', reason: billingBlock, consequence: ATHENA_FINAL_READY.stage_billing.consequence,
          payload: { billing: billing, reviewText: billingReview }, order: UNIFIED_ORDER.stage_billing });
      } else {
        addRow({ id: 'stage-billing', action: '', kind: 'billing', label: ATHENA_ACTIONS.stage_billing.label, destination: 'Athena encounter > Billing / Charges slate',
          capability: 'manual', reason: FINAL_ACTION_EXT_BLOCK + billingDetail, consequence: ATHENA_ACTIONS.stage_billing.consequence,
          payload: { billing: billing, reviewText: billingReview }, order: UNIFIED_ORDER.stage_billing });
      }
    }
    var planHasDx = plan.some(function (entry) { return planKind(entry && entry.kind) === 'dx'; });
    if (!planHasDx && billing.diagnoses && billing.diagnoses.length) {
      plan.push({ kind: 'dx', body: 'ICD-10 DIAGNOSES (manual only):\n- ' + billing.diagnoses.join('\n- ') });
    }
    for (var i = 0; i < plan.length; i++) {
      var source = plan[i] || {}, kind = planKind(source.kind);
      if (kind === 'note' || kind === 'procedure' || kind === 'billing') continue;
      if (source.duplicateOf && namedNoteLabels[source.duplicateOf]) {
        var duplicateKey = source.duplicateOf;
        addRow({ id: 'blocked-duplicate-note-' + duplicateKey + '-' + i, action: '', kind: duplicateKey,
          label: 'Duplicate ' + namedNoteLabels[duplicateKey] + ' destinations', destination: DESTINATION[duplicateKey], capability: 'blocked',
          reason: source.reason || 'More than one reviewed payload targets the same Athena field. Combine them explicitly before review; MLS will not merge or overwrite the field twice.',
          consequence: 'Nothing is written for this destination.',
          payload: { sections: Array.isArray(source.duplicateSections) && source.duplicateSections.length ? stableClone(source.duplicateSections) : [{ key: duplicateKey, text: S(source.body || source.text).trim(), execute: true, destination: DESTINATION[duplicateKey] }], noteText: S(source.body || source.text).trim(), reviewText: S(source.body || source.text).trim(), sectionKey: duplicateKey }, order: UNIFIED_ORDER.write_note + i / 1000 });
        continue;
      }
      if (kind === 'orders' && structuredOrderRows(source, i, addRow, orderCommonBlock)) continue;
      if (kind === 'order' && structuredOrderRows({ orderDrafts: [source.order || source], orderSuggestions: [] }, i, addRow, orderCommonBlock)) continue;
      var manual = UNIFIED_MANUAL[kind];
      addRow({ id: (manual ? 'manual-' : 'blocked-') + (kind || 'unknown') + '-' + i, action: '', kind: kind || 'unknown',
        label: manual ? manual.label : ('Unsupported destination: ' + (kind || 'unknown')),
        destination: manual ? manual.destination : 'No allowlisted Athena destination',
        capability: manual ? 'manual' : 'blocked',
        reason: manual ? 'Manual entry only; this payload will not cross the Athena write bridge.' : 'Unknown or untyped destination. MLS fails closed and will not send it.',
        consequence: manual ? manual.consequence : 'Nothing is written for this row.',
        payload: { body: S(source.body || source.text).trim(), reviewText: S(source.body || source.text).trim() }, order: UNIFIED_ORDER[kind] || UNIFIED_ORDER.unknown });
    }
    if (noteText && !hasNamedNoteSections) {
      addRow({ id: 'save-draft', action: 'save_draft', kind: 'save', label: ATHENA_ACTIONS.save_draft.label, destination: 'Athena encounter > Save / Save Draft control',
        capability: commonBlock ? 'blocked' : 'ready', reason: commonBlock, consequence: ATHENA_ACTIONS.save_draft.consequence, payload: notePayload, order: UNIFIED_ORDER.save_draft });
      if (athenaFinalActionsReady()) {
        /* Owner directive 2026-08-12 (capable extension only): Sign & Save is
           a confirmable MLS action. Sequencing stays hard: the probe and the
           extension both require a verified note write for this exact
           encounter before sign can run. */
        addRow({ id: 'sign-encounter', action: 'sign_encounter', kind: 'sign', label: ATHENA_FINAL_READY.sign_encounter.label, destination: 'Athena encounter > Sign & Save control',
          capability: commonBlock ? 'blocked' : 'ready', reason: commonBlock,
          consequence: ATHENA_FINAL_READY.sign_encounter.consequence, payload: notePayload, order: UNIFIED_ORDER.sign_encounter });
      } else {
        addRow({ id: 'sign-encounter', action: '', kind: 'sign', label: ATHENA_ACTIONS.sign_encounter.label, destination: 'Athena encounter > Sign & Save control',
          capability: 'manual',
          reason: FINAL_ACTION_EXT_BLOCK + ' Until then, complete Sign & Save directly in Athena.',
          consequence: ATHENA_ACTIONS.sign_encounter.consequence, payload: notePayload, order: UNIFIED_ORDER.sign_encounter });
      }
    } else if (noteText && hasNamedNoteSections) {
      /* A single global Save/Sign cannot prove that several independent Athena
         section editors all own the same payload. Keep those final actions
         explicit and manual instead of binding them to an arbitrary editor. */
      var namedFinalReason = 'This review targets named Athena fields one at a time. Review every placed section, then Save or Sign directly in Athena; MLS will not bind a global final action to an arbitrary section editor.';
      addRow({ id: 'save-named-sections-manual', action: '', kind: 'save', label: 'Save named sections in Athena', destination: 'Athena encounter > section-specific Save controls',
        capability: 'manual', reason: namedFinalReason, consequence: 'Nothing is saved automatically from this row.', payload: notePayload, order: UNIFIED_ORDER.save_draft });
      addRow({ id: 'sign-named-sections-manual', action: '', kind: 'sign', label: 'Sign & Save named sections in Athena', destination: 'Athena encounter > Sign & Save control',
        capability: 'manual', reason: namedFinalReason, consequence: 'Nothing is signed automatically from this row.', payload: notePayload, order: UNIFIED_ORDER.sign_encounter });
    }
    rows.sort(function (a, b) { return a.order - b.order || a.id.localeCompare(b.id); });
    var manifestHash = hashPreview({ patient: patient, visit: visit, previewHash: previewHash, receiptSessionId: receiptSessionId, rows: rows.map(function (r) { return r.rowHash; }) });
    var manifest = {
      schema: 'mls-athena-write-manifest-v1', manifestId: 'athena-manifest-' + manifestHash.replace('mls-preview-', ''),
      manifestHash: manifestHash, previewHash: previewHash, receiptSessionId: receiptSessionId,
      patient: patient, visit: visit, requireExpectedVisit: opts.requireExpectedVisit === true, needsVisitDiscovery: liveVisitNeedsDiscovery, rows: rows
    };
    return deepFreeze(manifest);
  }

  function unifiedRow(manifest, id) {
    for (var i = 0; i < manifest.rows.length; i++) if (manifest.rows[i].id === id) return manifest.rows[i];
    return null;
  }
  function destinationTeacher() {
    try { return window.__mlsShowAsst && window.__mlsShowAsst.installed ? window.__mlsShowAsst : null; } catch (e) { return null; }
  }
  function taughtDestinationFor(manifest, row) {
    var teacher = destinationTeacher();
    if (!teacher || typeof teacher.forRow !== 'function') return null;
    try { return teacher.forRow(manifest, row) || null; } catch (e) { return null; }
  }
  function teachStateFor(manifest, row) {
    var teacher = destinationTeacher();
    if (!teacher || typeof teacher.statusFor !== 'function') return { state: 'failed', message: 'MLS Assist destination teaching is unavailable.' };
    try { return teacher.statusFor(manifest, row) || { state: 'idle', message: 'Not taught yet. Open the destination screen in athenaOne FIRST, then click Teach destination.' }; } catch (e) { return { state: 'failed', message: 'MLS Assist destination teaching is unavailable.' }; }
  }
  function teachingHtml(manifest, row) {
    if (!row || row.capability !== 'ready' || !row.action) return '';
    var learned = taughtDestinationFor(manifest, row), status = teachStateFor(manifest, row);
    var state = S(status.state || (learned ? 'captured' : 'idle')).toLowerCase();
    var message = S(status.message || (learned ? 'Captured and validated for this exact destination.' : 'Optional: open the destination screen in athenaOne FIRST, then click Teach destination - your next Athena click is captured, never activated.')).trim();
    var color = state === 'captured' ? '#205c43' : ((state === 'failed' || state === 'expired') ? '#8b2525' : '#6d5010');
    return '<div data-mls-teach-row="' + esc(row.id) + '" style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:7px;padding-top:7px;border-top:1px dashed #dbe7e0">' +
      '<button type="button" data-mls-teach-start="' + esc(row.id) + '" style="border:1px solid #bfd4c8;background:#f7fbf9;color:#204034;border-radius:8px;padding:5px 8px;font-size:11.5px;font-weight:750;cursor:pointer">' + (learned ? 'Re-teach destination' : 'Teach destination') + '</button>' +
      '<button type="button" data-mls-teach-cancel="' + esc(row.id) + '" style="display:' + ((state === 'connected' || state === 'waiting') ? 'inline-block' : 'none') + ';border:1px solid #d8ddd9;background:#fff;color:#52675c;border-radius:8px;padding:5px 8px;font-size:11.5px;font-weight:700;cursor:pointer">Cancel watcher</button>' +
      '<button type="button" data-mls-teach-clear="' + esc(row.id) + '" style="display:' + (learned ? 'inline-block' : 'none') + ';border:1px solid #d8ddd9;background:#fff;color:#52675c;border-radius:8px;padding:5px 8px;font-size:11.5px;font-weight:700;cursor:pointer">Clear</button>' +
      '<span data-mls-teach-status="' + esc(row.id) + '" data-state="' + esc(state) + '" style="font-size:11.5px;color:' + color + '"><b>' + esc(state === 'idle' ? 'OPTIONAL' : state.toUpperCase()) + ':</b> ' + esc(message) + '</span></div>';
  }
  /* 2026-07-28: destination teaching is an expert escape hatch, not a step in
     the write. It keeps its exact behaviour and call signature (the teaching
     runtime contract pins teachingHtml(manifest, row)); it is only demoted
     behind one disclosure so the review reads as note -> check -> confirm. */
  function advancedTeachingHtml(manifest, row) {
    var html = teachingHtml(manifest, row);
    if (!html) return '';
    return '<details style="margin-top:7px"><summary style="cursor:pointer;font-weight:700;color:#52675c;font-size:11.5px">Advanced</summary>' + html + '</details>';
  }
  /* Copy without a clipboard permission prompt where possible; never claim a
     copy that did not happen. */
  function unifiedCopyText(text, btn, idleLabel) {
    var value = S(text);
    function flash(msg) {
      if (!btn) return;
      try {
        btn.textContent = msg;
        setTimeout(function () { try { btn.textContent = idleLabel; } catch (e0) {} }, 1400);
      } catch (e1) {}
    }
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(value).then(function () { flash('Copied'); }, function () { flash('Copy failed'); });
        return;
      }
    } catch (e2) {}
    try {
      var ta = document.createElement('textarea');
      ta.value = value; ta.setAttribute('readonly', 'readonly');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e3) {}
      try { ta.remove(); } catch (e4) {}
      flash(ok ? 'Copied' : 'Copy failed');
    } catch (e5) { flash('Copy failed'); }
  }
  /* 2026-07-28: the green "Athena verified" tick is painted ONLY by a probe that
     validated, and is cleared by anything that invalidates that probe. It never
     enables the button - the single enable path stays the probe-ok branch. */
  function setUnifiedReadyTick(rowId) {
    try {
      var ticks = document.querySelectorAll('[data-mls-ready-tick]');
      for (var i = 0; i < ticks.length; i++) {
        ticks[i].style.display = (rowId && ticks[i].getAttribute('data-mls-ready-tick') === rowId) ? 'inline-block' : 'none';
      }
    } catch (e) {}
  }
  function disableUnifiedGo() {
    var go = document.getElementById('mlsAthenaUnifiedGo'); if (!go) return;
    go.disabled = true; go.setAttribute('aria-disabled', 'true'); go.removeAttribute('data-mls-athena-action'); go.removeAttribute('data-mls-preview-hash'); go.removeAttribute('data-mls-row-hash'); go.removeAttribute('data-mls-client-order-id');
    setUnifiedReadyTick(null);
  }
  function invalidateUnifiedProbeForTeach(state) {
    if (!state || state.closed) return;
    state.probe = null; state.probeGeneration += 1; disableUnifiedGo(); renderUnifiedContext(state, null);
  }
  function updateTeachingRow(state, row, next) {
    if (!state || state.closed || !row) return;
    var host = document.querySelector('[data-mls-teach-row="' + row.id.replace(/"/g, '\\"') + '"]'); if (!host) return;
    var learned = taughtDestinationFor(state.manifest, row), current = next || teachStateFor(state.manifest, row), value = S(current.state || (learned ? 'captured' : 'idle')).toLowerCase();
    var start = host.querySelector('[data-mls-teach-start]'), cancel = host.querySelector('[data-mls-teach-cancel]'), clear = host.querySelector('[data-mls-teach-clear]'), status = host.querySelector('[data-mls-teach-status]');
    if (start) { start.textContent = learned ? 'Re-teach destination' : 'Teach destination'; start.disabled = value === 'connected' || value === 'waiting'; }
    if (cancel) cancel.style.display = value === 'connected' || value === 'waiting' ? 'inline-block' : 'none';
    if (clear) clear.style.display = learned ? 'inline-block' : 'none';
    if (status) {
      var color = value === 'captured' ? '#205c43' : ((value === 'failed' || value === 'expired') ? '#8b2525' : '#6d5010');
      status.style.color = color; status.setAttribute('data-state', value);
      status.innerHTML = '<b>' + esc(value === 'idle' ? 'OPTIONAL' : value.toUpperCase()) + ':</b> ' + esc(S(current.message || (learned ? 'Captured and validated for this exact destination.' : 'Optional: open the destination screen in athenaOne FIRST, then click Teach destination - your next Athena click is captured, never activated.')));
    }
  }
  function wireUnifiedTeaching(state, card) {
    var teacher = destinationTeacher(); if (!teacher || !card) return;
    var starts = card.querySelectorAll('[data-mls-teach-start]');
    for (var i = 0; i < starts.length; i++) starts[i].addEventListener('click', function () {
      var row = unifiedRow(state.manifest, this.getAttribute('data-mls-teach-start')); if (!row || state.running || state.closed) return;
      invalidateUnifiedProbeForTeach(state);
      teacher.startForRow(state.manifest, row, function (next) {
        if (state.closed || unifiedAthenaState !== state) return;
        updateTeachingRow(state, row, next);
        if (next && next.state === 'captured') {
          invalidateUnifiedProbeForTeach(state);
          unifiedStatus(state, 'The taught destination was captured and validated for ' + row.label + '. Running a fresh read-only Athena check now.', 'ok');
          if (state.selectedRowId === row.id) probeUnifiedRow(state, row.id);
        } else if (next && (next.state === 'failed' || next.state === 'expired')) {
          unifiedStatus(state, S(next.message) || 'Destination teaching failed. Nothing was changed.', 'err');
        }
      });
      updateTeachingRow(state, row, { state: 'connected', message: 'Connecting to the read-only Athena watcher.' });
    });
    var cancels = card.querySelectorAll('[data-mls-teach-cancel]');
    for (var ci = 0; ci < cancels.length; ci++) cancels[ci].addEventListener('click', function () {
      var row = unifiedRow(state.manifest, this.getAttribute('data-mls-teach-cancel')); if (!row) return;
      teacher.cancelForRow(state.manifest, row); invalidateUnifiedProbeForTeach(state); updateTeachingRow(state, row, { state: 'failed', message: 'Teaching was cancelled. Nothing changed.' });
    });
    var clears = card.querySelectorAll('[data-mls-teach-clear]');
    for (var xi = 0; xi < clears.length; xi++) clears[xi].addEventListener('click', function () {
      var row = unifiedRow(state.manifest, this.getAttribute('data-mls-teach-clear')); if (!row) return;
      teacher.cancelForRow(state.manifest, row);
      teacher.clearForRow(state.manifest, row); invalidateUnifiedProbeForTeach(state); updateTeachingRow(state, row, { state: 'idle', message: 'Cleared only for this exact patient and destination row.' });
      unifiedStatus(state, 'Cleared the taught target only for ' + row.label + '. Nothing was changed in Athena.', '');
      if (state.selectedRowId === row.id) probeUnifiedRow(state, row.id);
    });
  }
  function unifiedVisibleFocusTarget(el) {
    try {
      if (!el || !el.isConnected || el.disabled) return false;
      var style = getComputedStyle(el), rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    } catch (e) { return false; }
  }
  function unifiedFocusableRows(root) {
    if (!root) return [];
    try {
      return [].slice.call(root.querySelectorAll("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex]:not([tabindex='-1'])")).filter(unifiedVisibleFocusTarget);
    } catch (e) { return []; }
  }
  function closeUnifiedConfirmation() {
    var state = unifiedAthenaState;
    var returnFocus = state && state.returnFocus;
    if (state) {
      var teacher = destinationTeacher();
      if (teacher && typeof teacher.cancelForRow === 'function') state.manifest.rows.forEach(function (row) { if (row.action) try { teacher.cancelForRow(state.manifest, row); } catch (e) {} });
      state.closed = true;
      if (state.a11yKeyHandler) {
        try { document.removeEventListener('keydown', state.a11yKeyHandler, true); } catch (e0) {}
        state.a11yKeyHandler = null;
      }
    }
    unifiedAthenaState = null;
    try { var ov = document.getElementById('mlsAthenaUnifiedConfirm'); if (ov) ov.remove(); } catch (e) {}
    if (unifiedVisibleFocusTarget(returnFocus)) setTimeout(function () {
      try { returnFocus.focus({ preventScroll: true }); } catch (e1) { try { returnFocus.focus(); } catch (e2) {} }
    }, 0);
  }
  function unifiedStatus(state, message, kind, behavior) {
    if (!state || state.closed) return;
    var el = null; try { el = document.getElementById('mlsAthenaUnifiedProbe'); } catch (e) {}
    if (el) { el.style.color = kind === 'err' ? '#8b2525' : (kind === 'ok' ? '#205c43' : '#6d5010'); el.textContent = message; }
    actionSay(state.sourceOpts, message, kind, behavior);
  }
  function unifiedRecheckButton(state, rowId) {
    /* wf2-1.9.0: read-only re-probe on demand; the button lives inside the
       status line and is wiped by the next unifiedStatus repaint. */
    if (!state || state.closed) return;
    var el = null; try { el = document.getElementById('mlsAthenaUnifiedProbe'); } catch (e) { return; }
    if (!el) return;
    try {
      if (document.getElementById('mlsAthenaUnifiedRecheck')) return;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'mlsAthenaUnifiedRecheck'; btn.textContent = 'Check Athena again';
      btn.style.cssText = 'display:block;margin-top:7px;border:1px solid #cfe0d7;background:#fff;color:#204034;border-radius:8px;padding:6px 12px;font:700 12px inherit;cursor:pointer';
      btn.addEventListener('click', function () { try { btn.remove(); } catch (e2) {} probeUnifiedRow(state, rowId); });
      el.appendChild(btn);
    } catch (e3) {}
    /* wfdx-1.0.0: the recheck button is transient (the next status repaint wipes
       it). The diagnostics and the two fix buttons live in their own persistent
       strip below, so a refused check always leaves the doctor something to
       click and something to read. */
    wfdxShowFixStrip(state, rowId);
  }
  /* ---- wfdx-1.0.0 fix strip: what is wrong, and the one button that fixes it -- */
  function wfdxFixHost() { try { return document.getElementById('mlsAthenaUnifiedFix'); } catch (e) { return null; } }
  function wfdxDiagHost() { try { return document.getElementById('mlsAthenaUnifiedDiag'); } catch (e) { return null; } }
  function wfdxPaintDiag(state) {
    var host = wfdxDiagHost(); if (!host || !state || state.closed) return;
    host.style.display = 'block';
    host.textContent = wfdxEnvLine(state.manifest, wfdx.env);
  }
  function wfdxButton(label, title, onClick) {
    var btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = label; btn.title = S(title);
    btn.style.cssText = 'border:1px solid #cfe0d7;background:#fff;color:#204034;border-radius:8px;padding:7px 12px;font:750 12px inherit;cursor:pointer';
    btn.addEventListener('click', function () { onClick(btn); });
    return btn;
  }
  function wfdxAppendCopyReport(state, host) {
    if (!host || !state || state.closed) return;
    host.appendChild(wfdxButton('Copy error report',
      'Copies a patient-free technical report of this review: verbs, refusal codes, athenaOne tab count, the day athenaOne is on, and whether an appointment id is bound.',
      function (btn) { wfdxCopyText(JSON.stringify(wfdxReport(state.manifest), null, 1), btn, 'Copy error report'); }));
  }
  function wfdxShowExecuteReport(state) {
    var host = wfdxFixHost(); if (!host || !state || state.closed) return;
    host.innerHTML = '';
    wfdxAppendCopyReport(state, host);
    wfdxHealth(false).then(function () { wfdxPaintDiag(state); });
  }
  /* Everything this strip can do is READ-ONLY: navigate athenaOne's own Day
     view to the encounter's date (mlsAppGotoDate), click that exact appointment
     row (mlsAppSearchOpenPatient), and re-run the read-only check. Nothing here
     writes, saves, signs, bills or orders. */
  function wfdxShowFixStrip(state, rowId) {
    var host = wfdxFixHost(); if (!host || !state || state.closed) return;
    host.innerHTML = '';
    var manifest = state.manifest, visit = manifest.visit || {}, day = wfdxDayKey(visit.visitDate);
    /* wfbind-1.0.0: when the sheet failed closed for a MISSING BINDING, the cure
       leads. This strip renders even with zero ready rows (renderUnifiedConfirmation
       calls it with an empty rowId), which is exactly the owner's screenshot. */
    try { wfbindOfferCure(state, host); } catch (eCure) {}
    if (day && S(rowId).trim()) {
      host.appendChild(wfdxButton('Open this patient’s encounter in athenaOne',
        'Read-only: sends athenaOne’s Day view to ' + day + ', clicks this exact appointment row, then re-runs the read-only check. Nothing is written.',
        function (btn) { wfdxOpenEncounter(state, rowId, btn, false); }));
    }
    wfdxAppendCopyReport(state, host);
    wfdxHealth(false).then(function () { wfdxPaintDiag(state); });
  }
  function wfdxOfferNameRoute(state, rowId) {
    var host = wfdxFixHost(); if (!host || !state || state.closed) return;
    if (host.querySelector('[data-mls-open-by-name]')) return;
    var btn = wfdxButton('Open by name instead',
      'Read-only: asks athenaOne’s own patient search for this chart. The search refuses an ambiguous or DOB-mismatched result, and the write check still re-verifies name, DOB and MRN before anything can be confirmed.',
      function (b) { wfdxOpenEncounter(state, rowId, b, true); });
    btn.setAttribute('data-mls-open-by-name', '1');
    host.appendChild(btn);
  }
  /* Compose the read-only ladder MLS Assist 3.0.62 exposes:
       mlsAppGotoDate {date}  ->  mlsAppSearchOpenPatient  ->  probe
     3.0.62 opens an appointment row on WHATEVER day is already painted; it has
     no date parameter of its own, and with bootstrapIdentity it refuses every
     name fallback. Driving the Day view first is therefore the missing step,
     and it is the step the doctor was silently being asked to do by hand. */
  function wfdxOpenEncounter(state, rowId, btn, byName) {
    if (!state || state.closed || state.running) return;
    var generation = state.probeGeneration, manifest = state.manifest, visit = manifest.visit || {};
    var day = wfdxDayKey(visit.visitDate);
    if (btn) { btn.disabled = true; btn.textContent = byName ? 'Searching athenaOne…' : 'Opening in athenaOne…'; }
    function done(message, kind) {
      if (btn) { btn.disabled = false; btn.textContent = byName ? 'Open by name instead' : 'Open this patient’s encounter in athenaOne'; }
      if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
      if (message) unifiedStatus(state, message, kind || 'err');
      wfdxPaintDiag(state);
    }
    var openContext = byName ? { visitDate: visit.visitDate, provider: visit.provider, appointmentId: '' } : visit;
    var navigate = (!byName && day)
      ? bridge('mlsAppGotoDate', { date: day, deadlineAt: Date.now() + 60000 }, 'mlsAppGotoDateResult', 62000)
      : Promise.resolve({ ok: true, skipped: true });
    unifiedStatus(state, byName
      ? 'Asking athenaOne’s patient search for this chart read-only — nothing is written…'
      : ('Sending athenaOne’s Day view to ' + day + ' and opening this exact appointment read-only — nothing is written…'), '');
    navigate.then(function (nav) {
      nav = nav || {};
      if (nav.skipped !== true) {
        var observed = wfdxDayKey(nav.schedDate);
        if (observed) { wfdx.observedDay = observed; wfdx.observedDayAt = Date.now(); }
        wfdxNote({ verb: 'mlsAppGotoDate', stage: 'fix-open', ok: nav.ok === true, timeout: nav.__timeout === true,
          reason: nav.reason, error: nav.error, expectedDay: day, observedDay: observed,
          appointmentIdPresent: !!S(visit.appointmentId).trim() });
        if (nav.ok !== true) {
          done('athenaOne could not be sent to ' + day + '.' +
            (observed && observed !== day ? ' Its Day view is on ' + observed + '.' : '') +
            ' Open athenaOne’s Day view on ' + day + ' yourself, then press Check Athena again. Nothing was changed.', 'err');
          wfdxOfferNameRoute(state, rowId);
          return;
        }
        wfdx.observedDay = day; wfdx.observedDayAt = Date.now();
      }
      return searchOpenTarget(manifest.patient, openContext).then(function (openRes) {
        openRes = openRes || {};
        wfdxNote({ verb: 'mlsAppSearchOpenPatient', stage: byName ? 'fix-open-by-name' : 'fix-open', ok: openRes.ok === true,
          reason: openRes.reason || openRes.findReason, error: openRes.error, expectedDay: day,
          appointmentIdPresent: !!S(openContext.appointmentId).trim() });
        if (openRes.ok !== true) {
          var why = wfdxErrorClass(openRes.error) === 'appointment-row-open-refused'
            ? 'athenaOne is on ' + day + ' but this exact appointment row was not on the painted grid.'
            : 'athenaOne refused the open (' + (wfdxReason(openRes.reason || openRes.findReason) || 'no reason given') + ').';
          done(why + ' Nothing was changed.', 'err');
          if (!byName) wfdxOfferNameRoute(state, rowId);
          return;
        }
        done('', '');
        if (state.closed || unifiedAthenaState !== state) return;
        unifiedStatus(state, 'The chart is open in athenaOne (via ' + wfdxVia(openRes.via) + '). Re-checking the exact encounter read-only…', '');
        setTimeout(function () { if (!state.closed && unifiedAthenaState === state) probeUnifiedRow(state, rowId); }, 1500);
      });
    }, function () { done('The read-only open could not be started. Nothing was changed.', 'err'); });
  }
  function validatedUnifiedProbe(patient, probe) {
    var ctx = probe && probe.context || {};
    var token = S(probe && (probe.actionToken || probe.token)).trim();
    if (!token) return { ok: false, error: 'Athena did not return a one-use confirmation token. Nothing was changed.' };
    var name = contextValue(ctx, ['patientName', 'name'], ''), dob = contextValue(ctx, ['dob', 'patientDob'], ''), mrn = contextValue(ctx, ['mrn', 'patientMrn', 'chartMrn'], '');
    if (!name || !dob || !mrn || !nameMatch(name, patient.name) || nrmDob(dob) !== nrmDob(patient.dob) || (patient.mrn && nrmId(mrn) !== nrmId(patient.mrn))) {
      return { ok: false, error: 'The read-only Athena check did not return a complete matching patient name, DOB, and MRN. Nothing was changed.' };
    }
    var lockedContext = {
      appointmentId: contextValue(ctx, ['appointmentId', 'athenaAppointmentId'], ''),
      encounterId: contextValue(ctx, ['encounterId', 'visitId', 'id'], ''), encounterUrl: contextValue(ctx, ['encounterUrl', 'visitUrl', 'url'], ''),
      visitDate: contextValue(ctx, ['visitDate', 'encounterDate', 'date'], ''), provider: contextValue(ctx, ['provider', 'providerName'], '')
    };
    var control = contextValue(ctx, ['control', 'controlLabel', 'actionControl'], '');
    if (!lockedContext.encounterId || !lockedContext.encounterUrl || !lockedContext.visitDate || !lockedContext.provider || !control) {
      return { ok: false, error: 'Athena did not report one exact encounter date, provider, ID, URL, and action control. Nothing was changed.' };
    }
    /* W3 (qwen3.8 oracle, HANDOFF 12:5x) — RESPONSE-BODY IDENTITY. `patient`
       below is the INTENDED identity (what the extension must match on), and it
       is what the write is addressed to. The receipt must additionally record
       what Athena's own reply SAID the chart was, so a twin / name+DOB
       collision is legible after the fact instead of being papered over by the
       request parameters we sent. These three values are read from the response
       body and are never substituted from the request. */
    var responseIdentity = { name: S(name).trim(), dob: S(dob).trim(), mrn: S(mrn).trim() };
    return { ok: true, token: token, patient: { name: patient.name, dob: patient.dob, mrn: mrn, patientId: S(patient.patientId).trim() }, responseIdentity: responseIdentity, context: lockedContext, control: control, rawContext: stableClone(ctx) };
  }
  function renderUnifiedContext(state, lock) {
    var el = document.getElementById('mlsAthenaUnifiedContext'); if (!el) return;
    if (!lock) { el.innerHTML = '<b>Exact Athena encounter:</b> waiting for the read-only check.'; return; }
    el.innerHTML = '<b>Exact Athena encounter verified read-only</b><div style="display:grid;grid-template-columns:120px 1fr;gap:4px 9px;margin-top:7px">' +
      '<span>Patient</span><b>' + esc(lock.patient.name) + '</b><span>DOB</span><b>' + esc(lock.patient.dob) + '</b><span>MRN</span><b>' + esc(lock.patient.mrn) + '</b><span>MLS patient ID</span><b>' + esc(lock.patient.patientId || '(missing)') + '</b>' +
      '<span>Date</span><b>' + esc(lock.context.visitDate) + '</b><span>Provider</span><b>' + esc(lock.context.provider) + '</b><span>Encounter ID</span><b>' + esc(lock.context.encounterId) + '</b>' +
      '<span>Encounter URL</span><b style="overflow-wrap:anywhere">' + esc(lock.context.encounterUrl) + '</b><span>Control</span><b>' + esc(lock.control) + '</b></div>';
  }
  function probeUnifiedRow(state, rowId) {
    if (!state || state.closed || state.running || state.halted) return;
    var row = unifiedRow(state.manifest, rowId), go = document.getElementById('mlsAthenaUnifiedGo');
    if (!row || row.capability !== 'ready' || !row.action) { unifiedStatus(state, 'That destination is not executable. Its payload remains visible for manual review.', 'err'); return; }
    if (state.receipts[row.id] && state.receipts[row.id].status === 'verified') { unifiedStatus(state, 'That exact action is already verified in this review. MLS will not repeat it.', ''); return; }
    state.selectedRowId = row.id; state.probe = null; state.probeGeneration += 1;
    var generation = state.probeGeneration;
    if (go) { go.disabled = true; go.setAttribute('aria-disabled', 'true'); go.removeAttribute('data-mls-athena-action'); go.removeAttribute('data-mls-preview-hash'); go.removeAttribute('data-mls-row-hash'); go.removeAttribute('data-mls-client-order-id'); go.setAttribute('aria-label', 'Confirm and write disabled while Athena is checked'); }
    setUnifiedReadyTick(null);
    renderUnifiedContext(state, null);
    unifiedStatus(state, 'Checking the exact Athena patient, encounter, destination, and control read-only for ' + row.label + '...', '');
    var proofOpts = { receiptSessionId: state.manifest.receiptSessionId };
    var priorWrite = row.action === 'sign_encounter' ? findAnyVerifiedWrite(state.manifest.patient, state.manifest.previewHash, proofOpts, row.payload) : null;
    if (row.action === 'sign_encounter' && (!priorWrite || !priorWrite.noteWriteProof)) { unifiedStatus(state, 'Write the reviewed note to this encounter first — Sign & Save unlocks after MLS verifies the note write in this review.', 'err'); unifiedRecheckButton(state, row.id); return; }
    var bridgeProbePatient = bridgePatient(state.manifest.patient);
    var taughtDestination = taughtDestinationFor(state.manifest, row);
    /* 2026-07-28: a first read-only check that has not answered in 25s is a
       stuck or absent extension, not a slow one - 90s of silent waiting read as
       a frozen review. Later attempts (auto-open re-probe, manual re-check) keep
       the long ceiling because a chart is genuinely loading behind them. An
       interim line at 8s says the wait is normal AND that nothing is sent. */
    state.probeAttempts = (state.probeAttempts || 0) + 1;
    var probeTimeoutMs = state.probeAttempts > 1 ? 90000 : 25000;
    var interimTimer = setTimeout(function () {
      if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration || state.probe) return;
      unifiedStatus(state, 'Still checking Athena - nothing is sent.', '', { toast: false });
    }, 8000);
    bridge('mlsAppAthenaActionV2', {
      /* mdx-2.0.0 (wf3 presence port): the sheet is always doctor-initiated, so
         ask the extension to bring athenaOne forward for the read-only probe -
         the briefing SPA renders on paused rAF while occluded (2026-08-05:
         a staged review starved for hours on exactly this). Never while a
         recording is active; the extension's own focus guards do the rest. */
      foregroundOk: (typeof window.__mlsDoctorMidVisit === 'function' ? window.__mlsDoctorMidVisit() !== true : true),
      mode: 'probe', action: row.action, patient: bridgeProbePatient, expectedPatient: bridgeProbePatient,
      expectedContext: state.manifest.visit, previewHash: state.manifest.previewHash, manifestHash: state.manifest.manifestHash, payload: row.payload,
      noteText: row.payload.noteText || '', sections: row.payload.sections || [], notePolicy: 'empty_only',
      noteWriteProof: priorWrite ? priorWrite.noteWriteProof : '', billing: row.payload.billing || null, order: row.payload.order || null,
      rowHash: row.rowHash, taughtDestination: taughtDestination,
      clientOrderId: row.action === 'place_order' ? S(row.payload.order && row.payload.order.clientOrderId).trim() : ''
    }, 'mlsAppAthenaActionV2Result', probeTimeoutMs).then(function (probe) {
      try { clearTimeout(interimTimer); } catch (eInterim) {}
      if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
      wfdxProbeReceipt(state, row, probe, 'row-check');
      if (!probe || !probe.ok) {
        var probeReason = S(probe && probe.reason);
        /* wf2-2.2.0 (owner 2026-07-22, seamless write): when the destination is
           simply not open, the review no longer tells the doctor to go open the
           chart — MLS opens the exact identity-verified chart itself (the same
           proven SearchOpen verb the one-click lane uses since wf2-2.0.0) and
           re-probes once. One auto-open per review; identity/token/tab
           failures never auto-open; the single human Confirm & write click is
           unchanged. */
        if (AUTO_OPEN_REASONS[probeReason] === 1 && !state.autoOpened) {
          state.autoOpened = true;
          unifiedStatus(state, S(state.manifest.patient.name) + ' is not open in Athena. MLS is finding and opening the exact chart now — identity is verified before it opens, and nothing is written without your Confirm & write click...', '');
          searchOpenTarget(state.manifest.patient, state.manifest.visit).then(function (openRes) {
            if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
            wfdxNote({ verb: 'mlsAppSearchOpenPatient', stage: 'auto-open', ok: !!(openRes && openRes.ok === true),
              reason: openRes && (openRes.reason || openRes.findReason), error: openRes && openRes.error,
              expectedDay: state.manifest.visit.visitDate,
              appointmentIdPresent: !!S(state.manifest.visit.appointmentId).trim() });
            if (!openRes || openRes.ok !== true) {
              /* wfdx-1.0.0: 3.0.62 runs the appointment-row route ONLY when the
                 app supplies an appointment id + schedule date, and it clicks
                 whatever day athenaOne already has painted — it cannot change
                 the day and it refuses every name fallback. So the honest next
                 step is not "go open the chart"; it is one read-only button
                 that sends the Day view to the right date and clicks the row. */
              unifiedStatus(state, 'MLS could not open ' + S(state.manifest.patient.name) + ' in Athena on its own' + ((openRes && (openRes.error || openRes.reason)) ? ': ' + S(openRes.error || openRes.reason) : '') + '. Use the read-only button below, or open the chart in athenaOne and press Check Athena again. Nothing was changed.', 'err');
              unifiedRecheckButton(state, row.id);
              if (wfdxErrorClass(openRes && openRes.error) === 'appointment-row-open-refused') wfdxOfferNameRoute(state, row.id);
              return;
            }
            unifiedStatus(state, S(state.manifest.patient.name) + ' is open in Athena (via ' + S(openRes.via || 'patient search') + '). Re-checking the exact destination...', '');
            setTimeout(function () {
              if (state.closed || unifiedAthenaState !== state) return;
              probeUnifiedRow(state, row.id);
            }, 1500);
          });
          return;
        }
        /* wf2-1.9.0 QoL: a refused read-only probe is almost always fixable by
           the doctor. Say HOW, and offer one explicit re-check instead of
           making them reopen the whole review. */
        var probeErr = S(probe && (probe.error || probe.message || probe.reason)) || 'Athena context could not be verified. Nothing was changed.';
        if (/encounter frame|context.unverified|context.mismatch/i.test(probeErr + ' ' + probeReason)) probeErr += ' To unlock: in athenaOne, open this patient\'s encounter for documentation (check the patient in and open the visit note), then press Check Athena again.';
        /* mdx-2.0.0: a null probe is a timeout, and the most common cause is an
           occluded athenaOne tab that cannot paint its briefing. Name the cure. */
        if (!probe) probeErr += ' If athenaOne is open but behind other windows, click its tab once so it can paint, then press Check Athena again.';
        unifiedStatus(state, probeErr, 'err');
        unifiedRecheckButton(state, row.id);
        return;
      }
      var lock = validatedUnifiedProbe(state.manifest.patient, probe);
      if (!lock.ok) {
        wfdxNote({ verb: 'mlsAppAthenaActionV2', stage: 'identity-lock', mode: 'probe', action: row.action, rowId: row.id,
          ok: false, reason: 'patient-mismatch', identityLock: 'mismatch', expectedDay: state.manifest.visit.visitDate,
          appointmentIdPresent: !!S(state.manifest.visit.appointmentId).trim() });
        unifiedStatus(state, lock.error, 'err'); unifiedRecheckButton(state, row.id); return;
      }
      var exactWrite = row.action === 'sign_encounter' ? findVerifiedWrite(lock.patient, state.manifest.previewHash, proofOpts, row.payload, lock.context) : null;
      if (row.action === 'sign_encounter' && (!exactWrite || !exactWrite.noteWriteProof)) { unifiedStatus(state, 'The verified note proof does not match this exact Athena encounter. Sign & Save remains blocked.', 'err'); unifiedRecheckButton(state, row.id); return; }
      var probedClientOrderId = row.action === 'place_order' ? S(probe.clientOrderId).trim() : '';
      if (row.action === 'place_order' && (S(probe.rowHash).trim() !== row.rowHash || probedClientOrderId !== S(row.payload.order && row.payload.order.clientOrderId).trim())) { unifiedStatus(state, 'The Athena order authorization did not bind this exact immutable row. Nothing was changed.', 'err'); unifiedRecheckButton(state, row.id); return; }
      /* W5 (qwen3.8 oracle, HANDOFF 12:5x) — DISPLAY TARGET vs EXECUTE TARGET.
         The sheet shows the EXPECTED visit from the manifest, but the write is
         addressed to the encounter this probe just LOCKED. If those two name
         different days, the doctor would be confirming one visit and writing to
         another. The extension enforces expectedContext on its side; MLS must
         not depend on that, and must never display an identity it is not about
         to write to. Refuse, name both days, and let the doctor re-check. */
      var expectedDay = wfdxDayKey(state.manifest.visit.visitDate), lockedDay = wfdxDayKey(lock.context.visitDate);
      if (expectedDay && lockedDay && expectedDay !== lockedDay) {
        wfdxNote({ verb: 'mlsAppAthenaActionV2', stage: 'target-diff', mode: 'probe', action: row.action, rowId: row.id,
          ok: false, reason: 'display-execute-day-mismatch', expectedDay: expectedDay, observedDay: lockedDay,
          appointmentIdPresent: !!S(state.manifest.visit.appointmentId).trim() });
        unifiedStatus(state, 'This review is for ' + expectedDay + ', but the encounter Athena verified is dated ' + lockedDay +
          '. MLS will not write to an encounter it is not showing you. Open the ' + expectedDay + ' encounter in athenaOne and press Check Athena again. Nothing was changed.', 'err');
        unifiedRecheckButton(state, row.id);
        return;
      }
      state.probe = deepFreeze({ rowId: row.id, rowHash: row.rowHash, clientOrderId: probedClientOrderId, manifestHash: state.manifest.manifestHash, token: lock.token, patient: lock.patient, responseIdentity: lock.responseIdentity, context: lock.context, control: lock.control, rawContext: lock.rawContext, verifiedWrite: exactWrite, taughtDestination: stableClone(taughtDestination), taughtDestinationHash: hashPreview(taughtDestination || {}) });
      renderUnifiedContext(state, lock);
      if (go) {
        go.disabled = false; go.setAttribute('aria-disabled', 'false');
        go.textContent = probeOnlyActive() ? 'Confirm (PROBE ONLY — nothing is written)' : (row.action === 'save_draft' ? 'Confirm & Save draft in Athena' : 'Confirm & Send to Athena');
        go.setAttribute('data-mls-athena-action', row.action);
        go.setAttribute('data-mls-preview-hash', state.manifest.previewHash); go.setAttribute('aria-label', UNIFIED_ARIA[row.action]); go.title = UNIFIED_ARIA[row.action] + '. Runs only this selected action.';
        if (row.action === 'place_order') { go.setAttribute('data-mls-row-hash', row.rowHash); go.setAttribute('data-mls-client-order-id', probedClientOrderId); }
      }
      setUnifiedReadyTick(row.id);
      try { var fixHost = wfdxFixHost(); if (fixHost) fixHost.innerHTML = ''; } catch (eFix) {}
      unifiedStatus(state, (probeOnlyActive() ? 'PROBE ONLY — ' : '') + 'Ready — the exact chart is verified. One click on Confirm & Send runs only ' + row.label + '.' + (probeOnlyActive() ? ' In PROBE ONLY it is rehearsed read-only and nothing is written.' : ' Nothing else.'), '');
    });
  }
  function receiptStateForRow(state, row) {
    if (state.receipts[row.id]) return state.receipts[row.id];
    if (row.capability === 'manual') return { status: 'manual', message: row.reason };
    if (row.capability === 'blocked') return { status: 'blocked', message: row.reason };
    return { status: 'not attempted', message: 'Ready, but not attempted in this receipt.' };
  }
  function renderUnifiedReceipts(state) {
    var host = document.getElementById('mlsAthenaUnifiedReceipt'); if (!host) return;
    /* 2026-07-28: before anything is attempted every row reported "NOT ATTEMPTED
       / BLOCKED / MANUAL" in a red-and-amber column that read as a wall of
       failure for a review where nothing had happened yet. The receipt is an
       outcome record: it appears only once there IS an outcome. */
    if (!Object.keys(state.receipts).length) { host.innerHTML = ''; return; }
    var colors = { verified: '#205c43', rehearsed: '#204034', uncertain: '#8b2525', blocked: '#8b2525', manual: '#6d5010', 'not attempted': '#52675c' };
    host.innerHTML = '<div style="border:1px solid #e2e8f2;background:#fff;border-radius:10px;padding:10px 12px"><div style="font-weight:800;color:#204034;margin-bottom:6px">What happened</div>' + state.manifest.rows.map(function (row) {
      var r = receiptStateForRow(state, row), label = S(r.status).toUpperCase();
      return '<div style="border-top:1px solid #e2e8f2;padding:7px 0"><b>' + esc(row.label) + '</b><span style="float:right;color:' + (colors[r.status] || '#52675c') + ';font-weight:800">' + esc(label) + '</span><div style="clear:both;color:#52675c;font-size:12px">' + esc(r.message) + '</div></div>';
    }).join('') + '</div>';
  }
  function resultToUnifiedReceipt(state, row, resp, probe) {
    resp = resp || {}; var status = 'blocked', message = '', verifiedWrite = null;
    var attempted = resp.attempted === true || resp.partialMutation === true || resp.reason === 'outcome-uncertain';
    if (resp.__timeout) { status = 'uncertain'; message = 'No completion response arrived. Athena may already have changed. Inspect the exact destination before any retry; no other action ran.'; }
    else if (row.action === 'stage_billing' && (resp.partialMutation === true || ((resp.stagedCodes || []).length && resp.ok !== true))) { status = 'uncertain'; message = billingResultSummary(resp, row.payload) || 'Billing was partially changed or not fully verified. Inspect the billing slate before retrying.'; }
    else if (!resp.ok) { status = attempted ? 'uncertain' : 'blocked'; message = S(resp.error || resp.message || resp.reason) || 'Athena refused the selected action. No other action ran.'; }
    else if (row.action === 'write_note') {
      verifiedWrite = resp.attempted === true ? rememberVerifiedWrite(probe.patient, state.manifest.previewHash, { receiptSessionId: state.manifest.receiptSessionId }, row.payload, probe.context, resp) : null;
      status = verifiedWrite ? 'verified' : 'uncertain';
      message = verifiedWrite ? 'Inserted into the exact Athena field and read back successfully. It has not been saved or signed. Save, Sign, billing, orders, and prescriptions did not run.' : 'Athena did not return a verified exact-field insertion receipt. Inspect the field before retrying; Sign remains locked.';
    } else if (row.action === 'stage_billing') {
      status = (resp.staged === true || resp.verified === true) ? 'verified' : 'uncertain';
      message = status === 'verified' ? (billingResultSummary(resp, row.payload) || 'The exact E/M and CPT/HCPCS codes were verified in the billing slate. No claim was submitted.') : 'Athena did not durably verify the billing result. Inspect the billing slate before retrying.';
    } else if (row.action === 'save_draft') {
      status = (resp.saved === true || resp.persisted === true || resp.serverVerified === true || resp.verified === true) ? 'verified' : 'uncertain';
      message = status === 'verified' ? 'Athena verified Save / Save Draft for the exact encounter. It was not signed or billed.' : 'Athena returned from Save without durable verification. Inspect the encounter before retrying.';
    } else if (row.action === 'sign_encounter') {
      status = resp.signed === true ? 'verified' : 'uncertain';
      message = status === 'verified' ? 'Athena confirmed the exact encounter was signed and saved. Billing was not submitted.' : 'Athena did not verify the electronic signature. Inspect the encounter; MLS will not retry or auto-chain.';
    } else if (row.action === 'place_order') {
      status = resp.verified === true && (resp.orderPlaced === true || resp.alreadyPresent === true) ? 'verified' : 'uncertain';
      message = status === 'verified' ? (resp.alreadyPresent === true ? 'Athena verified that this exact order was already present. Nothing was added and no other action ran.' : 'Athena verified one isolated exact order addition. No Save, Sign, billing, prescription, second order, or other action ran.') : 'Athena did not verify one isolated exact order result. Inspect the Orders workspace before retrying; this manifest is halted.';
    }
    /* W3: the receipt records the identity Athena's own RESPONSE reported for
       the chart it acted on, alongside the intended patient id. A twin or a
       name+DOB collision is then legible in the receipt itself rather than
       being confirmed by the parameters we happened to send. */
    var receipt = deepFreeze({ rowId: row.id, action: row.action, status: status, message: message, patientId: S(state.manifest.patient && state.manifest.patient.patientId).trim(), responseIdentity: stableClone((probe && probe.responseIdentity) || null), manifestHash: state.manifest.manifestHash, rowHash: row.rowHash, context: stableClone(probe && probe.context), completedAt: new Date().toISOString() });
    state.receipts[row.id] = receipt;
    if (status === 'uncertain') state.halted = true;
    return receipt;
  }
  function executeUnifiedSelection(state) {
    if (!state || state.closed || state.running || state.halted) return;
    var row = unifiedRow(state.manifest, state.selectedRowId), probe = state.probe, go = document.getElementById('mlsAthenaUnifiedGo');
    if (!row || !ATHENA_EXECUTABLE_ACTIONS[row.action]) { unifiedStatus(state, 'That row is review-only. Complete it directly in Athena; MLS did not run a final action.', 'err'); return; }
    if (!row || row.capability !== 'ready' || !probe || probe.rowId !== row.id || probe.rowHash !== row.rowHash || probe.manifestHash !== state.manifest.manifestHash) { unifiedStatus(state, 'The selected action is not bound to a fresh exact Athena check. Nothing was changed.', 'err'); return; }
    if (!go || go.getAttribute('data-mls-athena-action') !== row.action || go.getAttribute('data-mls-preview-hash') !== state.manifest.previewHash || (row.action === 'place_order' && (go.getAttribute('data-mls-row-hash') !== row.rowHash || go.getAttribute('data-mls-client-order-id') !== S(row.payload.order && row.payload.order.clientOrderId).trim()))) { unifiedStatus(state, 'The confirmation binding changed. Nothing was written; select the action again.', 'err'); return; }
    var currentTaughtDestination = taughtDestinationFor(state.manifest, row);
    if (probe.taughtDestinationHash !== hashPreview(currentTaughtDestination || {})) { unifiedStatus(state, 'The taught destination changed after the read-only check. Select the action again before writing.', 'err'); invalidateUnifiedProbeForTeach(state); return; }
    state.running = true; go.disabled = true; go.setAttribute('aria-disabled', 'true'); go.textContent = 'Working…';
    var cancel = document.getElementById('mlsAthenaUnifiedCancel'), close = document.getElementById('mlsAthenaUnifiedClose');
    if (cancel) cancel.disabled = true; if (close) close.disabled = true;
    var radios = document.querySelectorAll('#mlsAthenaUnifiedConfirm input[name="mlsAthenaUnifiedAction"]');
    for (var ri = 0; ri < radios.length; ri++) radios[ri].disabled = true;
    var bridgeExecutePatient = bridgePatient(probe.patient);
    /* athena-probe-only-1.0.0: the owner's supervised rehearsal. The whole path
       runs — same manifest, same verified probe, same single human confirm —
       but the request goes out as mode:'probe'. Nothing is written, so the
       result is recorded as a rehearsal, the manifest is NOT halted, and the
       row is re-checked so he can run it again. */
    if (probeOnlyActive()) {
      bridge('mlsAppAthenaActionV2', {
        mode: 'probe', action: row.action, patient: bridgeExecutePatient, expectedPatient: bridgeExecutePatient,
        previewHash: state.manifest.previewHash, manifestHash: state.manifest.manifestHash, payload: row.payload,
        noteText: row.payload.noteText || '', sections: row.payload.sections || [], notePolicy: 'empty_only',
        noteWriteProof: probe.verifiedWrite ? probe.verifiedWrite.noteWriteProof : '', billing: row.payload.billing || null,
        order: row.payload.order || null, rowHash: row.rowHash,
        clientOrderId: row.action === 'place_order' ? S(row.payload.order && row.payload.order.clientOrderId).trim() : '',
        taughtDestination: currentTaughtDestination, expectedContext: probe.context
      }, 'mlsAppAthenaActionV2Result', 150000).then(function (resp) {
        if (state.closed || unifiedAthenaState !== state) return;
        resp = resp || {};
        state.running = false;
        wfdxProbeReceipt(state, row, resp, 'probe-only-confirm');
        state.receipts[row.id] = deepFreeze({ rowId: row.id, action: row.action, status: 'rehearsed',
          message: 'PROBE ONLY: the full path ran and MLS sent a read-only check instead of ' + row.label + '. Athena ' +
            (resp.ok === true ? 'verified the exact encounter again' : 'refused the read-only check (' + (wfdxReason(resp.reason) || 'no reason given') + ')') +
            '. Nothing was written, saved, signed, billed or ordered.',
          patientId: S(state.manifest.patient && state.manifest.patient.patientId).trim(),
          manifestHash: state.manifest.manifestHash, rowHash: row.rowHash, context: stableClone(probe && probe.context),
          completedAt: new Date().toISOString() });
        state.probe = null;
        renderUnifiedReceipts(state);
        if (cancel) cancel.disabled = false; if (close) close.disabled = false;
        for (var rp = 0; rp < radios.length; rp++) radios[rp].disabled = false;
        setUnifiedReadyTick(null);
        unifiedStatus(state, state.receipts[row.id].message, resp.ok === true ? 'ok' : 'err');
        setTimeout(function () { if (!state.closed && unifiedAthenaState === state) probeUnifiedRow(state, row.id); }, 400);
      });
      return;
    }
    bridge('mlsAppAthenaActionV2', {
      mode: 'execute', action: row.action, actionToken: probe.token, patient: bridgeExecutePatient, expectedPatient: bridgeExecutePatient,
      previewHash: state.manifest.previewHash, manifestHash: state.manifest.manifestHash, payload: row.payload, noteText: row.payload.noteText || '', sections: row.payload.sections || [],
      notePolicy: 'empty_only', noteWriteProof: probe.verifiedWrite ? probe.verifiedWrite.noteWriteProof : '', billing: row.payload.billing || null,
      order: row.payload.order || null,
      rowHash: row.rowHash, clientOrderId: row.action === 'place_order' ? S(row.payload.order && row.payload.order.clientOrderId).trim() : '', taughtDestination: currentTaughtDestination,
      probeContext: probe.rawContext, expectedContext: probe.context
    }, 'mlsAppAthenaActionV2Result', 150000).then(function (resp) {
      if (state.closed || unifiedAthenaState !== state) return;
      var completedProbe = state.probe;
      state.running = false;
      wfdxProbeReceipt(state, row, resp || {}, 'execute');
      var receipt = resultToUnifiedReceipt(state, row, resp || {}, completedProbe);
      state.probe = null;
      renderUnifiedReceipts(state);
      if (go) { go.disabled = true; go.setAttribute('aria-disabled', 'true'); go.textContent = 'Confirm & write'; go.removeAttribute('data-mls-athena-action'); go.removeAttribute('data-mls-preview-hash'); go.removeAttribute('data-mls-row-hash'); go.removeAttribute('data-mls-client-order-id'); }
      setUnifiedReadyTick(null);
      if (cancel) cancel.disabled = false; if (close) close.disabled = false;
      unifiedStatus(state, receipt.message + (state.halted ? ' This manifest is halted because the outcome is uncertain.' : ' No other action ran automatically.'), receipt.status === 'verified' ? 'ok' : 'err');
      if (receipt.status !== 'verified') wfdxShowExecuteReport(state);
      if (state.halted) {
        for (var i = 0; i < radios.length; i++) radios[i].disabled = true;
      } else {
        for (var rj = 0; rj < radios.length; rj++) radios[rj].disabled = false;
      }
    });
  }
  function reopenOptions(opts, manifest) {
    return {
      patient: stableClone(manifest.patient), plan: stableClone(opts.plan || []), sections: stableClone(opts.sections || []),
      expectedContext: stableClone(manifest.visit), noteTimestamp: opts.noteTimestamp || null, requireExpectedVisit: manifest.requireExpectedVisit,
      previewHash: manifest.previewHash, receiptSessionId: manifest.receiptSessionId, statusEl: opts.statusEl || null, preferredAction: opts.preferredAction || '',
      generationIssue: unifiedCanonicalGenerationIssue(opts)
    };
  }
  /* srr-1.0.0 (2026-08-18): a review OPENED before the day's schedule pull
     binds no encounter, every write row paints CANNOT SEND, and NOTHING on the
     open sheet re-resolves — blocked rows never probe, so only a human press
     of "Check Athena again" rebuilds. Measured live: the owner's sheet sat
     unbound while a fresh manifest for the same patient bound (14/14 rows
     bind after the pull). While an OPEN sheet is unbound, poll the LOCAL
     resolver only (no bridge, no Athena, no network) and the moment the day
     ledger or booking row can name the encounter, rebuild through the SAME
     reopen path the button uses — a manifest is never mutated in place.
     Bounded: 5s ticks for 5 minutes, one reopen (fresh id non-empty implies
     the rebuilt manifest binds, so the poller can never re-arm into a loop),
     self-disarms on close or when a newer review replaces this state. */
  function srrArmIfUnbound(state) {
    try {
      var visit = (state.manifest && state.manifest.visit) || {};
      if (S(visit.appointmentId).trim() || (S(visit.encounterId).trim() && S(visit.encounterUrl).trim())) return false;
      if (!state.reopenOpts) return false;
      var ticks = 0;
      var timer = setInterval(function () {
        try {
          ticks++;
          if (state.closed || unifiedAthenaState !== state || ticks > 60) { clearInterval(timer); return; }
          var fresh = expectedVisitContext(state.manifest.patient, state.reopenOpts);
          if (!fresh || !S(fresh.appointmentId).trim()) return;
          clearInterval(timer);
          unifiedStatus(state, 'The day pull has named this exact encounter — rebinding this review now. Nothing was sent.', '');
          openUnifiedConfirmation(state.reopenOpts);
        } catch (eTick) { try { clearInterval(timer); } catch (e2) {} }
      }, 5000);
      return true;
    } catch (e) { return false; }
  }
  /* ===== wfbind-1.0.0 (2026-08-19) =========================================
     THE CURE ON THE SHEET ITSELF.

     Owner 2026-08-19, with a screenshot of a confirm sheet whose three rows all
     read CANNOT SEND ("The exact visit needs its date, provider, and
     appointment ID (or a bound encounter ID and URL). MLS will not guess an
     encounter.", footer "this review has no expected day - no appointment id is
     bound to this encounter"): "all these cannot sends need to become can sends
     and that confirm and send to athena thing needs to be ungrayed out and
     work."

     srr-1.0.0 already rebinds an open sheet the moment SOMEONE ELSE'S pull
     lands. It cannot help the screenshot case, because nothing is pulling: the
     doctor is looking at a dead sheet whose only documented cure is to abandon
     it, run a day pull by hand, and rebuild the review from scratch.

     This block puts that cure ON the sheet as one press. It runs exactly the
     machinery the doctor would have run by hand, in order, and re-verifies:
       1. name the DAY (see wfbindCandidateDays - never a clock read),
       2. mlsAppGotoDate -> athenaOne's own Day view, read-only, CONFIRMED by
          reading back the day it actually painted,
       3. the account's normal schedule pull for that painted day,
       4. poll the LOCAL resolver until the day ledger (or the booking row,
          awb-1.0.0) can name this exact appointment, then rebuild through the
          SAME reopen path srr-1.0.0 and "Check Athena again" use - a manifest
          is never mutated in place,
       5. the rebuilt sheet runs the ordinary read-only probe as always.

     IT CANNOT WEAKEN THE GATE. It never assigns a visit field, never invents an
     appointment id, and never marks a row ready. Everything it does is re-run
     the pull and re-ask expectedVisitContext, whose answer is unchanged law. An
     unbindable visit - no MLS appointment for this patient on that day, an
     identity mismatch, a day athenaOne will not paint, a ledger that still
     cannot name one exact appointment - stays CANNOT SEND with the reason
     named, and the live probe remains the fail-closed arbiter afterwards.

     THE DAY IS NEVER GUESSED. opvs-1.0.0 records what a clock read costs: a
     historical note bound itself to whichever appointment sat nearest TODAY.
     Candidate days therefore come only from THIS exact patient's own MLS
     schedule rows. Exactly one candidate is one press; several are offered as
     named days for the doctor to choose between; none is an honest refusal.
     ======================================================================== */
  var WFBIND_LABEL = 'Bind this visit to its Athena appointment — re-pulls this day';
  var WFBIND_POLL_MS = 5000, WFBIND_POLL_TICKS = 36;   /* 3 minutes, bounded */
  var wfbindLast = null;
  /* A pull already in flight (this tab or another) must not be stomped: the
     schedule importer keeps its own lease and busy stamp. */
  function wfbindPullBusy() {
    try {
      var now = Date.now();
      var lease = window.__mlsSchedulePullLease;
      if (lease && Number(lease.at) && (now - Number(lease.at)) < 60000) return true;
      var busyAt = Number(window.__mlsPullBusyAt || 0);
      if (busyAt && (now - busyAt) < 60000) return true;
    } catch (e) {}
    return false;
  }
  /* Days this patient could have been seen on, from the MLS schedule ONLY. */
  function wfbindCandidateDays(manifest) {
    var out = [], seen = {};
    try {
      var visit = (manifest && manifest.visit) || {};
      var pinned = wfdxDayKey(visit.visitDate);
      if (pinned) return [pinned];
      var pid = S(manifest && manifest.patient && manifest.patient.patientId).trim();
      if (!pid) return [];
      calendarRows().forEach(function (a) {
        if (!a || S(a.patient_external_id || a.patientId || '').trim() !== pid) return;
        var d = wfdxDayKey(visitDay(a.day_local || a.appt_date || a.start_at));
        if (!d || seen[d]) return;
        seen[d] = 1; out.push(d);
      });
      out.sort();
    } catch (e) {}
    return out;
  }
  /* Is THIS row blocked by exactly the thing a re-pull can cure? A missing
     identity (no MLS patient id, no Athena name/DOB/MRN) is NOT curable by a
     pull and must never advertise a cure; nor is a row with no candidate day. */
  var WFBIND_IDENTITY_BLOCK = 'An immutable local patient ID';
  function wfbindCurableRow(manifest, row) {
    try {
      if (!row || row.capability !== 'blocked') return false;
      if (S(row.reason).indexOf(WFBIND_IDENTITY_BLOCK) === 0) return false;
      if (!/appointment id|not bound|exact visit/i.test(S(row.reason))) return false;
      if (p1VisitBound(manifest && manifest.visit)) return false;
      return wfbindCandidateDays(manifest).length > 0;
    } catch (e) { return false; }
  }
  /* A detached reopen option set that names ONE day. Never mutates the source. */
  function wfbindOptsForDay(state, day) {
    var base = state && state.reopenOpts;
    if (!base || !wfdxDayKey(day)) return null;
    var o = {}, k;
    for (k in base) if (Object.prototype.hasOwnProperty.call(base, k)) o[k] = base[k];
    var ctx = {}, c0 = base.expectedContext || {};
    for (k in c0) if (Object.prototype.hasOwnProperty.call(c0, k)) ctx[k] = c0[k];
    ctx.visitDate = day;
    o.expectedContext = ctx;
    return o;
  }
  /* The ONLY test of success: the ordinary resolver can now name the exact
     Athena appointment for this exact patient on that day. */
  function wfbindResolvedOpts(state, day) {
    try {
      var o = wfbindOptsForDay(state, day);
      if (!o) return null;
      var fresh = expectedVisitContext(state.manifest.patient, o);
      return (fresh && S(fresh.appointmentId).trim()) ? o : null;
    } catch (e) { return null; }
  }
  function wfbindFinish(state, btn, label) {
    if (state) state.binding = false;
    if (!btn) return;
    try { btn.disabled = false; btn.textContent = label; } catch (e) {}
  }
  function wfbindPoll(state, day, btn, label, generation) {
    var ticks = 0;
    var timer = setInterval(function () {
      try {
        ticks++;
        if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) { clearInterval(timer); wfbindFinish(state, btn, label); return; }
        var resolved = wfbindResolvedOpts(state, day);
        if (!resolved) {
          if (ticks < WFBIND_POLL_TICKS) return;
          clearInterval(timer); wfbindFinish(state, btn, label);
          unifiedStatus(state, 'The day pull for ' + day + ' finished, but MLS still cannot name one exact Athena appointment for this patient on that day. This review stays unsendable and nothing was written. Check that ' + day + ' is the right day and that this patient is on athenaOne’s schedule for it.', 'err');
          wfdxNote({ verb: 'wfbind', stage: 'bind-cure', ok: false, reason: 'unresolved-after-pull', expectedDay: day, appointmentIdPresent: false });
          return;
        }
        clearInterval(timer); wfbindFinish(state, btn, label);
        wfbindLast = { day: day, at: Date.now() };
        wfdxNote({ verb: 'wfbind', stage: 'bind-cure', ok: true, expectedDay: day, appointmentIdPresent: true });
        unifiedStatus(state, 'The day pull named this exact Athena appointment — rebinding this review now. Nothing was sent.', 'ok');
        openUnifiedConfirmation(resolved);
      } catch (eTick) { try { clearInterval(timer); } catch (e2) {} wfbindFinish(state, btn, label); }
    }, WFBIND_POLL_MS);
    return timer;
  }
  function wfbindRun(state, day, btn) {
    if (!state || state.closed || unifiedAthenaState !== state) return false;
    if (state.running) { unifiedStatus(state, 'Finish the current Athena check or action before binding this visit. No pull started and nothing was sent.', ''); return false; }
    if (state.generating) { unifiedStatus(state, 'The five local draft fields are still generating. Let generation finish before binding this visit. No pull started and nothing was sent.', ''); return false; }
    if (state.binding) { unifiedStatus(state, 'This review is already binding its exact Athena appointment. No second pull started and nothing was sent.', ''); return false; }
    day = wfdxDayKey(day);
    if (!day) return false;
    var label = btn ? S(btn.textContent) : '';
    var generation = state.probeGeneration;
    /* Already resolvable locally? Then no Athena read is needed at all. */
    var already = wfbindResolvedOpts(state, day);
    if (already) {
      unifiedStatus(state, 'This day is already imported and names this exact appointment — rebinding this review now. Nothing was sent.', 'ok');
      wfbindLast = { day: day, at: Date.now() };
      openUnifiedConfirmation(already);
      return true;
    }
    if (wfbindPullBusy()) {
      unifiedStatus(state, 'A schedule pull is already running. Let it finish — this review rebinds itself the moment the day is named. Nothing was sent.', '');
      return false;
    }
    state.binding = true;
    if (btn) { btn.disabled = true; btn.textContent = 'Binding — re-pulling ' + day + '…'; }
    wfbindNavigateAndPull(day, function (msg, kind) { unifiedStatus(state, msg, kind || ''); }).then(function (res) {
      res = res || { ok: false, message: 'The day re-pull did not report a result. Nothing was changed.' };
      if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) { wfbindFinish(state, btn, label); return; }
      if (res.ok !== true) { wfbindFinish(state, btn, label); unifiedStatus(state, res.message, 'err'); return; }
      wfbindPoll(state, day, btn, label, generation);
    }, function () {
      wfbindFinish(state, btn, label);
      unifiedStatus(state, 'The read-only day navigation could not be started. No pull started and nothing was sent.', 'err');
    });
    return true;
  }
  /* Steps 2-3 of the cure, shared by the confirm sheet and by the visit-screen
     banner in mls-connect.js: send athenaOne's own Day view to this exact
     day, CONFIRM the day it actually painted, then start the account's normal
     schedule pull for it. Reads Athena; writes nothing. Resolves
     {ok:true} once the pull has been STARTED for a confirmed day - the caller
     owns the wait, because only the caller knows what "bound" means for it. */
  function wfbindNavigateAndPull(day, say) {
    day = wfdxDayKey(day);
    function tell(msg, kind) { try { if (typeof say === 'function') say(msg, kind); } catch (e) {} }
    if (!day) return Promise.resolve({ ok: false, message: 'MLS has no exact day to re-pull, so nothing was pulled and nothing was written.' });
    if (wfbindPullBusy()) return Promise.resolve({ ok: false, message: 'A schedule pull is already running. Let it finish, then try again. Nothing was changed.' });
    tell('Sending athenaOne’s Day view to ' + day + ' and re-pulling that day so MLS can name this exact appointment. This is a read of Athena — nothing is written…', '');
    return bridge('mlsAppGotoDate', { date: day, deadlineAt: Date.now() + 60000 }, 'mlsAppGotoDateResult', 62000).then(function (nav) {
      nav = nav || {};
      var observed = wfdxDayKey(nav.schedDate);
      if (observed) { wfdx.observedDay = observed; wfdx.observedDayAt = Date.now(); }
      wfdxNote({ verb: 'mlsAppGotoDate', stage: 'bind-cure', ok: nav.ok === true, timeout: nav.__timeout === true,
        reason: nav.reason, error: nav.error, expectedDay: day, observedDay: observed, appointmentIdPresent: false });
      if (nav.ok !== true) {
        return { ok: false, message: 'athenaOne could not be sent to ' + day + '.' + (observed && observed !== day ? ' Its Day view is on ' + observed + '.' : '') +
          ' Open athenaOne’s Day view on ' + day + ' yourself and pull that day, then check again. Nothing was changed.' };
      }
      /* Never pull a day athenaOne did not actually paint. */
      if (observed && observed !== day) {
        return { ok: false, message: 'athenaOne reported it is on ' + observed + ', not ' + day + '. MLS will not pull a day it cannot confirm, so nothing was pulled and nothing was written.' };
      }
      wfdx.observedDay = day; wfdx.observedDayAt = Date.now();
      var pull = null;
      try { pull = window.pullScheduleViaAssist; } catch (eP) {}
      if (typeof pull !== 'function') {
        return { ok: false, message: 'athenaOne is on ' + day + ', but this build exposes no schedule pull to run. Pull ' + day + ' from the schedule screen, then check again. Nothing was changed.' };
      }
      /* The day-probe inside the pull wrapper compares against TODAY and would
         stop a deliberate historical pull with a modal. We have already proven
         the painted day by reading it back, which is the stronger check. */
      try { pull.__skipProbe = true; } catch (eSkip) {}
      try { pull(); } catch (ePull) {
        return { ok: false, message: 'The schedule pull for ' + day + ' could not be started. Make sure athenaOne is open on Calendar > View Calendar for ' + day + ', then try again. Nothing was changed.' };
      }
      tell('Pulling athenaOne’s schedule for ' + day + ' read-only. This rebinds itself the moment the exact appointment is named — nothing is sent…', '');
      return { ok: true, message: '', day: day };
    }, function () {
      return { ok: false, message: 'The read-only day navigation could not be started. Nothing was changed.' };
    });
  }
  /* The strip control(s). One candidate day is one press; several are named. */
  function wfbindOfferCure(state, host) {
    if (!state || state.closed || !host) return false;
    var manifest = state.manifest, visit = manifest.visit || {};
    if (p1VisitBound(visit)) return false;
    var days = wfbindCandidateDays(manifest);
    if (!days.length) return false;
    if (days.length === 1) {
      var one = wfbindButton(WFBIND_LABEL,
        'Sends athenaOne’s Day view to ' + days[0] + ', re-pulls that day’s schedule, then re-checks this exact appointment. Reads Athena; writes nothing.',
        function (btn) { wfbindRun(state, days[0], btn); });
      one.setAttribute('data-mls-bind-cure', days[0]);
      host.appendChild(one);
      return true;
    }
    days.slice(0, 8).forEach(function (day) {
      var b = wfbindButton('Bind to ' + day + ' — re-pulls this day',
        'This review names no day. ' + day + ' is one of this patient’s own scheduled days. MLS re-pulls it read-only and re-checks the exact appointment; it will not choose a day for you.',
        function (btn) { wfbindRun(state, day, btn); });
      b.setAttribute('data-mls-bind-cure', day);
      host.appendChild(b);
    });
    return true;
  }
  function wfbindButton(label, title, onClick) {
    var btn = wfdxButton(label, title, onClick);
    try { btn.style.cssText = 'border:1px solid #204034;background:#204034;color:#fff;border-radius:8px;padding:7px 12px;font:800 12px inherit;cursor:pointer'; } catch (e) {}
    return btn;
  }
  /* ===== end wfbind-1.0.0 ================================================= */
  function renderUnifiedOrderSummary(orderRows, manifest, chosen) {
    if (!orderRows.length) return '';
    var items = orderRows.map(function (row) {
      var payload = row.payload || {}, blocked = row.capability === 'blocked';
      var ready = row.capability === 'ready' && !!row.action;
      var statusColor = ready ? '#205c43' : (blocked ? '#8b2525' : '#7a5a16');
      var statusText = ready ? 'READY · SEPARATE CONFIRMATION' : (row.capability === 'manual' ? 'MANUAL IN ATHENA' : 'BLOCKED · NOTHING SENT');
      var howText = ready
        ? 'Select this row, then use its own Confirm & Send. MLS places only this reviewed catalog item and runs no other action.'
        : (row.capability === 'manual'
          ? 'Review or copy this payload, then complete it yourself in Athena. This row never crosses the write bridge.'
          : 'Nothing is sent from this row. Resolve the reason below before it can become a reviewed Athena action.');
      var radioId = 'mlsAthenaOrderChoice-' + S(row.id).replace(/[^A-Za-z0-9_-]/g, '-');
      var selectHtml = ready
        ? '<input id="' + esc(radioId) + '" type="radio" name="mlsAthenaUnifiedAction" value="' + esc(row.id) + '"' + (chosen && chosen.id === row.id ? ' checked' : '') + ' aria-label="Select ' + esc(row.label) + ' for a separate Athena confirmation" style="margin-top:3px">'
        : '';
      /* oa-1.0.0 (owner 2026-07-22): a proposed order stuck at "Suggestion
         only" had no accept control anywhere on this card — the clinician
         had accepted it mentally and the UI kept re-asking. Suggestion rows
         now carry an explicit review-and-accept button; acceptance is
         recorded app-side immediately and the row becomes a reviewed draft.
         Accepting never executes anything — placement stays human, in Athena. */
      var acceptable = blocked && S(payload.reviewStatus).indexOf('suggestion only') === 0 && typeof window._athenaAcceptProposedOrder === 'function';
      var acceptHtml = acceptable
        ? '<div style="margin-top:7px;display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<button type="button" data-mls-accept-order="' + esc(row.id) + '" style="border:0;background:#205c43;color:#fff;border-radius:9px;padding:8px 13px;font-weight:800;font-size:12px;cursor:pointer">Accept this proposed order</button>' +
          '<span style="font-size:11px;color:#52675c">Records your acceptance now — it becomes a reviewed draft and will not be asked again. Nothing is placed or executed.</span></div>'
        : '';
      return '<section data-manifest-row="' + esc(row.id) + '" style="padding:9px 0;border-top:1px solid #e3ebe6">' +
        '<div style="display:flex;gap:8px;align-items:flex-start">' + selectHtml + '<div style="flex:1;min-width:0">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><label' + (ready ? ' for="' + esc(radioId) + '"' : '') + ' style="font-weight:800;color:#203b2e' + (ready ? ';cursor:pointer' : '') + '"><b>What:</b> ' + esc(unifiedArtifactName(row)) + '</label>' +
        '<span style="font-size:10px;font-weight:850;color:' + statusColor + ';border:1px solid currentColor;border-radius:999px;padding:1px 6px">' + esc(statusText) + '</span></div>' +
        '<div style="font-size:11.5px;color:#385b49;margin-top:3px"><b>Where:</b> ' + esc(row.destination) + '</div>' +
        '<div style="font-size:11.5px;color:#52675c;margin-top:3px"><b>How:</b> ' + esc(howText) + '</div>' +
        '<div style="font-size:11.5px;color:#52675c;margin-top:3px"><b>Result:</b> ' + esc(unifiedOneLine(row.consequence)) + '</div>' +
        '<div style="font-size:11.5px;color:#52675c;margin-top:2px"><b>Source:</b> ' + esc(row.source || payload.sourceLabel || 'Provider-entered draft') + '</div></div></div>' +
        '<details style="margin-top:5px"><summary style="cursor:pointer;font-weight:700;color:#204034">Review complete proposed order</summary>' +
        '<div style="font-size:10.5px;color:#52675c;margin:4px 0">Payload ' + esc(row.payloadHash) + ' | Row ' + esc(row.rowHash) + '</div>' +
        '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:190px;overflow:auto;margin:0;padding:8px;border:1px solid #dbe7e0;border-radius:8px;background:#fff;color:#1f3027;font:11.5px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace">' + esc(manifestPayloadText(row)) + '</pre></details>' +
        (row.reason ? '<div style="font-size:11.5px;color:' + statusColor + ';margin-top:5px"><b>Why:</b> ' + esc(row.reason) + '</div>' : '') + acceptHtml + advancedTeachingHtml(manifest, row) + '</section>';
    }).join('');
    return '<section data-mls-orders-summary="1" style="border:1px solid #cfded5;border-radius:11px;padding:10px 12px;margin-top:9px;background:#f7fbf9">' +
      '<div style="display:flex;gap:8px;align-items:center"><b style="font-size:14px;color:#204034">Orders proposed for Athena</b><span style="margin-left:auto;font-size:11px;color:#52675c">' + orderRows.length + ' item' + (orderRows.length === 1 ? '' : 's') + '</span></div>' +
      '<div style="font-size:11.5px;color:#52675c;margin:3px 0 5px">' + (athenaFinalActionsReady() && supervisedOrderPlacementReady() ? 'Review each frozen proposal here. A complete, accepted, catalog-bound imaging / PT / referral / DME order is a READY row: one Confirm &amp; Send places exactly that catalog item and verifies it by read-back. Medication and injection orders stay yours in Athena (no typed adapter). MLS never prescribes or submits anything.' : 'Review each frozen proposal here, then complete the exact order in Athena. Your installed MLS Assist still enforces the previous write-safety policy; with MLS Assist 3.0.62 or newer, complete catalog-bound orders become one-confirm MLS actions.') + '</div>' + items + '</section>';
  }
  /* oa-1.0.0: record acceptance of one suggestion row, then rebuild the review
     from a plan where that item is an accepted reviewed draft. The app hook is
     the durable source of truth (persisted with the visit record); the reopen
     recomputes every hash honestly. Fail closed: if acceptance cannot be
     recorded, the row stays a suggestion and says so. */
  function acceptUnifiedSuggestion(state, rowId, btn) {
    if (!state || state.closed || unifiedAthenaState !== state) return;
    if (state.running) { unifiedStatus(state, 'Wait for the running Athena check to finish, then accept the order.', 'err'); return; }
    var row = null;
    for (var i = 0; i < state.manifest.rows.length; i++) { if (state.manifest.rows[i] && state.manifest.rows[i].id === rowId) { row = state.manifest.rows[i]; break; } }
    if (!row || !row.payload) return;
    var hook = window._athenaAcceptProposedOrder;
    if (typeof hook !== 'function') { unifiedStatus(state, 'This page cannot record order acceptance — accept it in the Orders workspace instead. Nothing changed.', 'err'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Recording acceptance...'; }
    var res = null;
    try { res = hook(stableClone(row.payload)); } catch (eHook) { res = { ok: false, error: String(eHook && eHook.message || eHook) }; }
    if (!res || res.ok !== true) {
      if (btn) { btn.disabled = false; btn.textContent = 'Accept this proposed order'; }
      unifiedStatus(state, 'Acceptance was NOT recorded' + (res && res.error ? ' — ' + String(res.error) : '') + '. The order remains a suggestion.', 'err');
      return;
    }
    STATE.orderAccepts++;
    var opts = state.sourceOpts || {};
    var plan = stableClone(Array.isArray(opts.plan) ? opts.plan : []);
    var wantText = S(row.payload.originalText || row.payload.summary).trim().toLowerCase();
    plan.forEach(function (sec) {
      if (!sec || planKind(sec.kind) !== 'orders') return;
      var sugg = Array.isArray(sec.orderSuggestions) ? sec.orderSuggestions : [], keep = [], moved = null;
      sugg.forEach(function (item) {
        var t = S(item && (item.originalText || item.summary)).trim().toLowerCase();
        if (!moved && t && t === wantText) { moved = item; } else { keep.push(item); }
      });
      if (!moved) return;
      sec.orderSuggestions = keep;
      var draft = stableClone(moved);
      draft.source = /^rule/.test(S(draft.source)) ? 'rule-suggestion-accepted' : 'ai-suggestion-accepted';
      var drafts = Array.isArray(sec.orderDrafts) ? sec.orderDrafts : (Array.isArray(sec.orders) ? sec.orders : []);
      sec.orderDrafts = drafts.concat([draft]);
    });
    var next = {};
    for (var k in opts) next[k] = opts[k];
    next.plan = plan;
    next.previewHash = '';                                   /* content changed — recompute */
    next.receiptSessionId = S(state.manifest.receiptSessionId);
    openUnifiedConfirmation(next);                           /* closes this review itself */
    if (unifiedAthenaState && unifiedAthenaState !== state) {
      var acceptedRow = null, rebuiltRows = unifiedAthenaState.manifest && unifiedAthenaState.manifest.rows || [];
      for (var ai = 0; ai < rebuiltRows.length; ai++) {
        var rp = rebuiltRows[ai] && rebuiltRows[ai].payload || {};
        var rebuiltText = S(rp.originalText || rp.summary || rp.order && rp.order.summary).trim().toLowerCase();
        if (rp.category === 'order' && rebuiltText && rebuiltText === wantText) { acceptedRow = rebuiltRows[ai]; break; }
      }
      var acceptedNext = acceptedRow && acceptedRow.capability === 'ready' && acceptedRow.action === 'place_order'
        ? ' Its READY order row can now be selected and separately confirmed.'
        : (acceptedRow && acceptedRow.capability === 'blocked'
          ? ' Its rebuilt order row remains BLOCKED until the missing catalog or required details are resolved.'
          : ' Its rebuilt order row remains MANUAL in Athena.');
      unifiedStatus(unifiedAthenaState, 'Acceptance recorded — "' + S(row.payload.summary).slice(0, 90) + '" is now an accepted reviewed draft and will not be asked again.' + acceptedNext + ' Nothing was sent.', 'ok');
    }
  }
  /* -----------------------------------------------------------------------
     2026-07-28 review rework (owner: the review read as a wall of red for a
     page where nothing had happened yet, and the note being sent - the one
     thing a doctor must actually read - was buried under every other row).
     Two panels: the NOTE on the left as the hero, everything the review can
     say about it on the right, grouped by what MLS can really do. Nothing
     about the safety model moves: same rows, same [data-manifest-row]
     markers, same single radio group, same ONE disabled Confirm & write
     button whose only enable path is a validated read-only probe.
     ----------------------------------------------------------------------- */
  function unifiedOneLine(text) {
    var one = S(text).replace(/\s+/g, ' ').trim(), stop = one.indexOf('. ');
    return stop > 0 ? one.slice(0, stop + 1) : one;
  }
  function unifiedArtifactName(row) {
    var payload = row && row.payload || {}, kind = S(row && row.kind).trim();
    if (payload.category === 'order') {
      var orderName = S(payload.order && payload.order.displayLabel || payload.orderTypeLabel || row.label).trim() || 'Athena order';
      return (/suggestion only/i.test(S(payload.reviewStatus)) ? 'Proposed ' : 'Reviewed ') + orderName + ' order';
    }
    var labels = {
      note: 'Reviewed encounter-note draft', hpi: 'Reviewed HPI draft', ros: 'Reviewed Review of Systems draft',
      exam: 'Reviewed Physical Exam draft', assessment: 'Reviewed assessment narrative', plan: 'Reviewed Plan / Follow-up draft',
      billing: 'Reviewed E/M and CPT/HCPCS coding payload', dx: 'Reviewed ICD-10 diagnoses',
      save: 'Save the reviewed encounter draft', sign: 'Sign & Save the reviewed encounter',
      procedure: 'Reviewed procedure / operative-note draft', rx: 'Reviewed prescription draft', referrals: 'Reviewed referral draft',
      pt: 'Reviewed physical-therapy draft', imaging: 'Reviewed imaging draft', documents: 'Reviewed document / letter draft',
      instructions: 'Reviewed patient-instructions draft', consent: 'Reviewed consent item', handouts: 'Reviewed patient handout'
    };
    return labels[kind] || S(row && row.label).trim() || 'Reviewed Athena item';
  }
  function unifiedHashFooter(row) {
    return 'Payload ' + esc(row.payloadHash) + ' &middot; Row ' + esc(row.rowHash);
  }
  function unifiedPayloadDetails(row) {
    return '<details style="margin-top:6px"><summary style="cursor:pointer;font-weight:750;color:#204034;font-size:11.5px">Review full payload and hashes</summary>' +
      '<div style="font-size:11px;color:#52675c;margin:5px 0">' + unifiedHashFooter(row) + '</div>' +
      '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;margin:0;padding:9px;border:1px solid #dbe7e0;border-radius:8px;background:#f7fbf9;color:#1f3027;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace">' + esc(manifestPayloadText(row)) + '</pre></details>';
  }
  function unifiedCopyPayloadButton(row) {
    return '<button type="button" data-mls-copy-payload="' + esc(row.id) + '" style="margin-top:7px;border:1px solid #d8ddd9;background:#fff;color:#3d5147;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer">Copy payload</button>';
  }
  function unifiedGroupHead(title, color, note) {
    return '<div style="margin-top:14px"><div style="font-size:12.5px;font-weight:850;color:' + color + '">' + title + '</div>' +
      (note ? '<div style="font-size:11.5px;color:#52675c;margin-top:2px">' + note + '</div>' : '') + '</div>';
  }
  function unifiedReadyRowHtml(manifest, row, preChecked) {
    /* wf3: the ready row is a compact selectable pill (real radio inside, so
       every existing change-wire and suite hook still works). The preferred
       row arrives pre-checked and is probed on open — the doctor only touches
       these pills to switch to Save-as-draft. Payload details and destination
       teaching stay one fold away. */
    return '<section data-manifest-row="' + esc(row.id) + '" style="border:1px solid #cfe0d7;border-radius:11px;padding:9px 11px;margin-top:8px;background:#fff;flex:1;min-width:210px">' +
      '<label style="display:flex;gap:9px;align-items:center;cursor:pointer">' +
      '<input type="radio" name="mlsAthenaUnifiedAction" value="' + esc(row.id) + '"' + (preChecked ? ' checked' : '') + ' aria-label="Select ' + esc(row.label) + ' for Athena review">' +
      '<span style="flex:1;min-width:0">' +
      '<span style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><b style="color:#204034">What: ' + esc(unifiedArtifactName(row)) + '</b>' +
      '<span style="font-size:10.5px;font-weight:850;color:#205c43;border:1px solid currentColor;border-radius:999px;padding:1px 7px">READY &middot; SEPARATE CONFIRMATION</span>' +
      '<span data-mls-ready-tick="' + esc(row.id) + '" style="display:none;font-size:10.5px;font-weight:850;color:#205c43;border:1px solid currentColor;border-radius:999px;padding:1px 7px">&#10003; Athena verified</span></span>' +
      '<span style="display:block;color:#385b49;font-size:12px;margin-top:3px"><b>Where:</b> ' + esc(row.destination) + '</span>' +
      '<span style="display:block;color:#52675c;font-size:12px;margin-top:3px"><b>How:</b> Select this row, then use its own Confirm &amp; Send. Only &ldquo;' + esc(row.label) + '&rdquo; runs.</span>' +
      '<span style="display:block;color:#52675c;font-size:12px;margin-top:3px"><b>Result:</b> ' + esc(unifiedOneLine(row.consequence)) + '</span></span></label>' +
      unifiedPayloadDetails(row) + advancedTeachingHtml(manifest, row) + '</section>';
  }
  function unifiedManualRowHtml(manifest, row) {
    return '<section data-manifest-row="' + esc(row.id) + '" style="border:1px solid #f0d79a;border-radius:11px;padding:10px 11px;margin-top:8px;background:#fffdf5">' +
      '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><b style="color:#6d5010">What: ' + esc(unifiedArtifactName(row)) + '</b>' +
      '<span style="font-size:10.5px;font-weight:850;color:#7a5a16;border:1px solid currentColor;border-radius:999px;padding:1px 7px">MANUAL IN ATHENA</span></div>' +
      '<div style="font-size:12px;color:#6d5010;margin-top:3px"><b>Where:</b> ' + esc(row.destination) + '</div>' +
      '<div style="font-size:12px;color:#52675c;margin-top:3px"><b>How:</b> Review or copy this payload here, then complete it yourself in Athena. Nothing is sent from this row.</div>' +
      '<div style="font-size:12px;color:#52675c;margin-top:3px"><b>Result:</b> ' + esc(unifiedOneLine(row.consequence)) + '</div>' +
      '<details style="margin-top:5px"><summary style="cursor:pointer;font-weight:700;color:#6d5010;font-size:11.5px">Why?</summary>' +
      (row.reason ? '<div style="font-size:12px;color:#52675c;margin-top:4px">' + esc(row.reason) + '</div>' : '') +
      '</details>' +
      unifiedPayloadDetails(row) + unifiedCopyPayloadButton(row) + advancedTeachingHtml(manifest, row) + '</section>';
  }
  function unifiedBlockedRowHtml(manifest, row) {
    return '<section data-manifest-row="' + esc(row.id) + '" style="border:1px solid #e7c0c0;border-radius:11px;padding:10px 11px;margin-top:8px;background:#fdf7f7">' +
      '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><b style="color:#8b2525">What: ' + esc(unifiedArtifactName(row)) + '</b>' +
      '<span style="font-size:10.5px;font-weight:850;color:#8b2525;border:1px solid currentColor;border-radius:999px;padding:1px 7px">BLOCKED &middot; NOTHING SENT</span></div>' +
      '<div style="font-size:12px;color:#8b2525;margin-top:3px"><b>Where:</b> ' + esc(row.destination) + '</div>' +
      '<div style="font-size:12px;color:#52675c;margin-top:3px"><b>How:</b> Nothing is sent from this row. Resolve the reason below, then reopen the Athena review.</div>' +
      (row.reason ? '<div style="font-size:12px;color:#8b2525;margin-top:3px"><b>Why:</b> ' + esc(row.reason) + '</div>' : '') +
      /* wfbind-1.0.0: a row blocked ONLY for the missing appointment binding has
         a one-press cure on this same sheet. Say so where the doctor is reading
         the refusal, instead of leaving the strip to be discovered. */
      (wfbindCurableRow(manifest, row)
        ? '<div data-mls-bind-hint="' + esc(row.id) + '" style="font-size:12px;color:#204034;margin-top:5px;font-weight:700">Fixable here: press &ldquo;' + esc(WFBIND_LABEL) + '&rdquo; above. MLS re-pulls the day and re-checks this exact appointment; nothing is written.</div>'
        : '') +
      '<div style="font-size:12px;color:#52675c;margin-top:3px"><b>Result:</b> ' + esc(unifiedOneLine(row.consequence)) + '</div>' +
      unifiedPayloadDetails(row) + unifiedCopyPayloadButton(row) + '</section>';
  }
  /* ===== wfx-1.0.0 (2026-08-19) — THE WRITE-FIDELITY CONTRACT ==============
     Closes three of the five holes the qwen3.8:27b oracle found in the
     walkthrough (HANDOFF_LIVE 12:5x). W3 (response-body identity in the
     receipt) and W5 (display target vs execute target) are enforced at their
     own call sites above; W1, W2 and W4 are EVIDENCE the doctor reads before
     confirming, so they render here.

       W1 STALE-SNAPSHOT RACE — provenance is not currency. The chart can change
          between the pull and the confirm. Stamp how old this day's pulled
          facts are, and say plainly that Athena is re-read at check time and
          again at write time.
       W2 CROSS-SECTION CONTRADICTION — "Continue warfarin" in the plan while
          "warfarin anaphylaxis" sits in allergies passes every zero-fabrication
          test ever written. Screen the note against the patient's own allergy
          list and REPORT a collision.
       W4 OMISSION IS NOT FABRICATION — a note that silently drops a pulled fact
          is not "safe" merely because it invented nothing. Tally every pulled
          fact above the relevance floor: it either appears in the note or it is
          COUNTED as excluded, with the excluded ones named.

     THREE RULES THIS BLOCK NEVER BREAKS:
       1. It never edits clinical text. Not one character. It reports.
       2. It never blocks a send on its own judgment — a heuristic must not get
          a veto over a clinician. Every finding is advisory and says so.
       3. It is computed at RENDER time from the source patient, never folded
          into the manifest: previewHash, manifestHash and every row hash are
          byte-for-byte what they were before this block existed.
     ======================================================================== */
  var WFX_NEGATION = /^(?:none|nkda|nka|n\/a|unknown|denies|no known|not recorded|none recorded|no active|negative)\b/i;
  var WFX_MIN_TERM = 4;
  function wfxSourcePatient(state) {
    try { return (state && state.sourceOpts && state.sourceOpts.patient) || activePt() || {}; } catch (e) { return {}; }
  }
  /* One pulled fact per line/segment, above the relevance floor: long enough to
     be a real clinical term, and not a recorded ABSENCE (an absence has nothing
     to carry into a note). */
  function wfxFactList(value) {
    return S(value).split(/[\n;,]+/)
      .map(function (x) { return x.replace(/^[\s\-•*\d.)]+/, '').trim(); })
      .filter(function (x) { return x.length >= WFX_MIN_TERM && !WFX_NEGATION.test(x); });
  }
  /* The first substantial word is the term we can honestly look for — unless
     that word is a CATEGORY or a qualifier rather than a substance. "Other:
     see chart" would otherwise flag every note containing the word "other",
     and a screen that cries wolf on a patient-safety surface gets ignored
     exactly when it is right. Skip those and take the next real word. */
  var WFX_NOT_A_SUBSTANCE = {
    other: 1, others: 1, misc: 1, miscellaneous: 1, various: 1, multiple: 1, several: 1,
    unknown: 1, unspecified: 1, patient: 1, reports: 1, reported: 1, history: 1,
    drug: 1, drugs: 1, medication: 1, medications: 1, medicine: 1, medicines: 1,
    allergy: 1, allergies: 1, allergic: 1, reaction: 1, reactions: 1, intolerance: 1,
    seasonal: 1, environmental: 1, food: 1, foods: 1, contact: 1, chart: 1, note: 1,
    active: 1, chronic: 1, acute: 1, mild: 1, moderate: 1, severe: 1, daily: 1, other1: 1
  };
  function wfxHeadTerm(entry) {
    var words = S(entry).match(/[A-Za-z][A-Za-z0-9\-]{3,}/g) || [];
    for (var i = 0; i < words.length; i++) {
      var w = words[i].toLowerCase();
      if (!WFX_NOT_A_SUBSTANCE[w]) return w;
    }
    return '';
  }
  function wfxFacts(patient) {
    var out = [];
    [['allergy', patient && patient.allergies], ['medication', patient && patient.meds], ['problem', patient && patient.problems]]
      .forEach(function (pair) {
        wfxFactList(pair[1]).forEach(function (entry) {
          var term = wfxHeadTerm(entry);
          if (term) out.push({ kind: pair[0], entry: entry, term: term });
        });
      });
    return out;
  }
  function wfxNoteCorpus(manifest) {
    var bits = [];
    manifest.rows.forEach(function (row) {
      var p = row.payload || {};
      if (p.noteText) bits.push(S(p.noteText));
      if (p.body) bits.push(S(p.body));
      if (p.reviewText) bits.push(S(p.reviewText));
    });
    return bits.join('\n').toLowerCase();
  }
  function wfxMentions(corpus, term) {
    try { return new RegExp('\\b' + term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(corpus); } catch (e) { return corpus.indexOf(term) >= 0; }
  }
  /* W2: an allergy term the note also talks about. REPORT ONLY. */
  function wfxContradictions(manifest, patient) {
    var corpus = wfxNoteCorpus(manifest), out = [];
    wfxFacts(patient).forEach(function (f) {
      if (f.kind !== 'allergy') return;
      if (wfxMentions(corpus, f.term)) out.push(f);
    });
    return out;
  }
  /* W4: appears-or-counted-excluded, for every pulled fact. */
  function wfxTally(manifest, patient) {
    var corpus = wfxNoteCorpus(manifest), facts = wfxFacts(patient), present = [], excluded = [];
    facts.forEach(function (f) { (wfxMentions(corpus, f.term) ? present : excluded).push(f); });
    return { total: facts.length, present: present, excluded: excluded };
  }
  /* W1: how old are the facts this note was written from? */
  function wfxPulledAt(day) {
    try {
      var stamps = window.__mlsDayPullStamp || {}, entry = stamps[wfdxDayKey(day)];
      return (entry && Number(entry.completedAt)) || 0;
    } catch (e) { return 0; }
  }
  function wfxAgeText(ms) {
    var mins = Math.floor(ms / 60000);
    if (mins < 1) return 'less than a minute ago';
    if (mins < 60) return mins + (mins === 1 ? ' minute ago' : ' minutes ago');
    var hrs = Math.floor(mins / 60);
    if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
    var days = Math.floor(hrs / 24);
    return days + (days === 1 ? ' day ago' : ' days ago');
  }
  function wfxStalenessLine(manifest) {
    var day = wfdxDayKey(manifest.visit.visitDate), at = day ? wfxPulledAt(day) : 0;
    if (!day) return 'This review names no day, so MLS cannot date the facts it was written from. Athena is still re-read read-only before the check and again at the write.';
    if (!at) return 'This browser has no record of pulling ' + day + ', so MLS cannot say how old these facts are. Athena is re-read read-only before the check and again at the write.';
    return 'Facts for ' + day + ' were pulled ' + wfxAgeText(Math.max(0, Date.now() - at)) + '. The chart can have changed since: Athena is re-read read-only before the check and again at the write.';
  }
  function wfxEvidenceHtml(state) {
    var manifest = state.manifest, patient = wfxSourcePatient(state);
    var contradictions = wfxContradictions(manifest, patient);
    var tally = wfxTally(manifest, patient);
    var head = '<details open style="margin-top:12px"><summary style="cursor:pointer;font-weight:750;color:#204034;font-size:11.5px">What this note was written from</summary>' +
      '<div style="margin-top:7px;padding:11px 12px;background:#f7f9fb;border:1px solid #e2e8f2;border-radius:10px;color:#3d5147;font-size:12px;overflow-wrap:anywhere">';
    var body = '<div data-mls-wfx="staleness">' + esc(wfxStalenessLine(manifest)) + '</div>';
    if (contradictions.length) {
      body += '<div data-mls-wfx="contradiction" style="margin-top:8px;padding:9px 10px;border:1px solid #e7c0c0;background:#fdf7f7;border-radius:9px;color:#8b2525">' +
        '<b>Check this before you send.</b> This note discusses ' +
        contradictions.map(function (f) { return '<b>' + esc(f.term) + '</b>'; }).join(', ') +
        ', which also appears in this patient’s recorded allergies (' +
        contradictions.map(function (f) { return esc(f.entry); }).join('; ') +
        '). MLS does not change clinical text and is not overruling you — it is showing you both sections at once.</div>';
    } else {
      body += '<div data-mls-wfx="contradiction-clear" style="margin-top:8px">No recorded allergy is named anywhere in this note.</div>';
    }
    body += '<div data-mls-wfx="tally" style="margin-top:8px"><b>Pulled facts carried into this note:</b> ' +
      tally.present.length + ' of ' + tally.total + ' appear; ' + tally.excluded.length + ' are not mentioned.' +
      (tally.excluded.length
        ? ' Not mentioned: ' + tally.excluded.map(function (f) { return esc(f.entry) + ' (' + f.kind + ')'; }).join('; ') +
          '. Leaving a fact out can be exactly right — this is a count, not a correction.'
        : '') + '</div>';
    return head + body + '</div></details>';
  }
  /* ===== end wfx-1.0.0 ==================================================== */
  function unifiedNoteHeroHtml(manifest) {
    var noteRow = unifiedRow(manifest, 'write-note');
    /* Named HPI/ROS/Exam/Assessment/Plan reviews have several independent
       destinations. A generic Encounter-note hero would be false and would
       visually duplicate those rows, so only the true generic-note lane gets
       the full-text hero. Named sections show their own What/Where/How rows. */
    if (!noteRow) return '';
    var who = [S(manifest.patient.name).trim() || '(patient name missing)'];
    if (manifest.patient.dob) who.push('DOB ' + S(manifest.patient.dob));
    if (manifest.patient.mrn) who.push('MRN ' + S(manifest.patient.mrn));
    if (manifest.visit.visitDate) who.push(S(manifest.visit.visitDate));
    if (manifest.visit.provider) who.push(S(manifest.visit.provider));
    var open = '<section style="border:1px solid #dce5df;border-radius:12px;padding:14px 15px;background:#fff;min-width:0;margin-top:12px">' +
      '<div style="font-size:13.5px;font-weight:850;color:#204034">Review the generated encounter-note text</div>' +
      '<div style="color:#52675c;font-size:12px;margin-top:3px">' + esc(who.join(' - ')) + '</div>';
    return open +
      '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto;margin:11px 0 0;padding:13px;border:1px solid #dbe7e0;border-radius:10px;background:#f8fbf9;color:#1f3027;font:14px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace">' + esc(S(noteRow.payload.noteText)) + '</pre>' +
      '<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:8px">' +
      '<span style="font-size:11px;color:#52675c">' + unifiedHashFooter(noteRow) + '</span>' +
      '<button type="button" data-mls-copy-note="' + esc(noteRow.id) + '" style="margin-left:auto;border:1px solid #d8ddd9;background:#fff;color:#3d5147;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer">Copy note</button></div></section>';
  }
  function unifiedIdentityHtml(manifest) {
    return '<details style="margin-top:12px"><summary style="cursor:pointer;font-weight:750;color:#204034;font-size:11.5px">Patient, visit and manifest identity</summary>' +
      '<div style="display:grid;grid-template-columns:118px 1fr;gap:5px 9px;margin-top:7px;padding:11px 12px;background:#f7f9fb;border:1px solid #e2e8f2;border-radius:10px;overflow-wrap:anywhere"><span>Patient</span><b>' + esc(manifest.patient.name || '(missing)') + '</b><span>DOB</span><b>' + esc(manifest.patient.dob || '(missing)') + '</b><span>MRN</span><b>' + esc(manifest.patient.mrn || 'verified from Athena before writing') + '</b><span>MLS patient ID</span><b>' + esc(manifest.patient.patientId || '(missing)') + '</b><span>Expected visit</span><b>' + esc(manifest.visit.visitDate || 'unique encounter must be discovered') + '</b><span>Expected provider</span><b>' + esc(manifest.visit.provider || 'verified from Athena before writing') + '</b><span>Appointment ID</span><b>' + esc(manifest.visit.appointmentId || 'verified from Athena before writing') + '</b><span>Expected encounter</span><b>' + esc(manifest.visit.encounterId || 'verified from Athena before writing') + '</b><span>Manifest</span><b>' + esc(manifest.manifestHash) + '</b></div></details>';
  }
  /* A missing/stale canonical Athena sidecar is a LOCAL generation problem,
     not an encounter-binding problem. Keep the two remedies deliberately
     separate: wfbind may only re-pull identity; this explicit control invokes
     the page's ordinary generation gate and then asks the ordinary Athena
     review entrypoint to rebuild every row from persisted, validated output. */
  function unifiedCanonicalGenerationIssue(opts) {
    var issue = S(opts && opts.generationIssue).trim();
    return /^(?:athena-note-|generated-soap-format$)/.test(issue) ? issue : '';
  }
  function unifiedCanonicalGenerationHtml(state) {
    var issue = unifiedCanonicalGenerationIssue(state && state.sourceOpts);
    if (!issue) return '';
    var stale = /(?:stale|changed|malformed|format)/i.test(issue);
    var verb = stale ? 'Regenerate' : 'Generate';
    return '<section data-mls-canonical-generation="1" style="margin-top:12px;padding:13px 14px;border:1px solid #cfe0d7;background:#f7fbf9;border-radius:11px;color:#204034">' +
      '<div style="font-size:13.5px;font-weight:850">' + verb + ' the five exact Athena draft fields</div>' +
      '<div style="font-size:12px;color:#52675c;margin-top:4px">The reviewed HPI, ROS, Physical Exam, Assessment, and Plan / Follow-up draft is ' + (stale ? 'stale or malformed' : 'missing') + '. This action runs the normal MLS note-generation, validation, and local-save gate. It does not write to Athena. After success, MLS rebuilds every row and still requires the exact patient and appointment check before any Confirm button can enable.</div>' +
      '<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:10px"><button type="button" id="mlsAthenaUnifiedGenerateSections" data-mls-generate-canonical="1" style="border:0;background:#204034;color:#fff;border-radius:9px;padding:9px 13px;font-weight:800;cursor:pointer">' + verb + ' HPI, ROS, Exam, Assessment &amp; Plan</button>' +
      '<span id="mlsAthenaUnifiedGenerateStatus" role="status" style="font-size:11.5px;color:#52675c">Nothing has been generated or sent yet.</span></div></section>';
  }
  function unifiedCanonicalGenerationStatus(state, text, isError) {
    if (!state || state.closed || unifiedAthenaState !== state) return;
    var el = null; try { el = document.getElementById('mlsAthenaUnifiedGenerateStatus'); } catch (e) {}
    if (el) { el.textContent = S(text); el.style.color = isError ? '#8b2525' : '#385b49'; }
  }
  function runUnifiedCanonicalGeneration(state, button) {
    if (!state || state.closed || unifiedAthenaState !== state || state.generating) return;
    if (state.running) { unifiedCanonicalGenerationStatus(state, 'Finish the current Athena check or action before generating these local fields. Nothing was generated or sent.', true); return; }
    if (state.binding || wfbindPullBusy()) { unifiedCanonicalGenerationStatus(state, 'The Athena schedule pull / appointment bind is still running. Let it finish before generating these local fields. Nothing was generated or sent.', true); return; }
    var generate = null, reopen = null;
    try { generate = window.generateNote; reopen = window.pushEntireVisitToAthena; } catch (e) {}
    if (typeof generate !== 'function' || typeof reopen !== 'function') {
      unifiedCanonicalGenerationStatus(state, 'MLS note generation is still loading. Nothing was generated or sent; wait a moment and try again.', true);
      return;
    }
    state.generating = true;
    var cancel = null, close = null;
    try { cancel = document.getElementById('mlsAthenaUnifiedCancel'); close = document.getElementById('mlsAthenaUnifiedClose'); } catch (e0) {}
    if (button) { button.disabled = true; button.setAttribute('aria-disabled', 'true'); button.textContent = 'Generating exact fields…'; }
    if (cancel) cancel.disabled = true; if (close) close.disabled = true;
    unifiedCanonicalGenerationStatus(state, 'Running the normal local generation and validation gate… nothing is being sent to Athena.', false);
    function release(message, isError) {
      if (state.closed || unifiedAthenaState !== state) return;
      state.generating = false;
      if (button) { button.disabled = false; button.removeAttribute('aria-disabled'); button.textContent = (/^(?:athena-note-(?:stale|canonical-source-changed|malformed)|generated-soap-format)/i.test(unifiedCanonicalGenerationIssue(state.sourceOpts)) ? 'Regenerate' : 'Generate') + ' HPI, ROS, Exam, Assessment & Plan'; }
      if (cancel) cancel.disabled = false; if (close) close.disabled = false;
      unifiedCanonicalGenerationStatus(state, message, isError);
    }
    Promise.resolve().then(function () { return generate(); }).then(function (ok) {
      if (state.closed || unifiedAthenaState !== state) return;
      if (ok !== true) { release('Generation did not complete, so the existing review stayed unchanged and nothing was sent. Correct the issue shown by MLS and try again.', true); return; }
      unifiedCanonicalGenerationStatus(state, 'The five fields passed generation and validation. Rebuilding the exact Athena review now…', false);
      var rebuilt = reopen(null);
      if (state.closed || unifiedAthenaState !== state) return;
      if (rebuilt !== true) { release('The fields were generated, but the review could not be rebuilt for the same exact patient and visit. Nothing was sent; re-open Send to Athena after fixing the binding shown here.', true); return; }
      release('The five fields were generated. Re-open Send to Athena to review the rebuilt rows; nothing was sent.', false);
    }).catch(function () {
      release('Generation failed before the review could be rebuilt. The existing review stayed unchanged and nothing was sent.', true);
    });
  }
  function renderUnifiedConfirmation(state) {
    closeActionConfirm();
    try { var oldReceipt = document.getElementById('athenaReceipt'); if (oldReceipt) oldReceipt.remove(); } catch (e0) {}
    if (state.a11yKeyHandler) {
      try { document.removeEventListener('keydown', state.a11yKeyHandler, true); } catch (e1) {}
      state.a11yKeyHandler = null;
    }
    var old = document.getElementById('mlsAthenaUnifiedConfirm'); if (old) old.remove();
    var manifest = state.manifest, ready = manifest.rows.filter(function (r) { return r.capability === 'ready' && r.action; });
    var chosen = ready.filter(function (r) { return r.action === state.sourceOpts.preferredAction; })[0] || ready[0] || null;
    var orderRows = manifest.rows.filter(function (row) { return row.payload && row.payload.category === 'order'; });
    var plainRows = manifest.rows.filter(function (row) { return !(row.payload && row.payload.category === 'order'); });
    var readyRows = plainRows.filter(function (row) { return row.capability === 'ready' && row.action; });
    var manualRows = plainRows.filter(function (row) { return row.capability === 'manual'; });
    var blockedRows = plainRows.filter(function (row) { return row.capability !== 'manual' && !(row.capability === 'ready' && row.action); });
    /* wf3: ONE focused sheet. The preferred ready action is pre-selected and
       probed on open; alternatives render as compact pills (still real radios —
       every existing wire and suite hook is unchanged). Everything the doctor
       must do in Athena personally lives in one collapsed drawer instead of a
       wall of groups. */
    var generationIssue = unifiedCanonicalGenerationIssue(state.sourceOpts);
    var rowsHtml = generationIssue ? '' : '<div data-mls-destination-guide="1" style="margin-top:12px;padding:8px 10px;border:1px solid #dbe7e0;background:#f7fbf9;border-radius:9px;color:#385b49;font-size:12px"><b>What &rarr; Where &rarr; How.</b> Every READY item needs its own Confirm &amp; Send. MANUAL and BLOCKED items never cross the Athena write bridge.</div>';
    if (readyRows.length > 1) {
      rowsHtml += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap" role="radiogroup" aria-label="What MLS sends">' +
        readyRows.map(function (row) { return unifiedReadyRowHtml(manifest, row, chosen && chosen.id === row.id); }).join('') + '</div>';
    } else if (readyRows.length === 1) {
      rowsHtml += unifiedReadyRowHtml(manifest, readyRows[0], true);
    }
    var drawerCount = manualRows.length + blockedRows.length + orderRows.length;
    if (drawerCount) {
      /* wf3: the drawer ships OPEN — what stays manual must be VISIBLE (the
         unified-confirmation runtime pins this), it is merely grouped and
         de-emphasized below the primary action instead of interleaved. */
      var readyOrderCount = orderRows.filter(function (row) { return row.capability === 'ready' && !!row.action; }).length;
      rowsHtml += '<details open style="margin-top:12px"><summary style="cursor:pointer;font-weight:750;color:#6d5010;font-size:12px">' +
        (readyOrderCount ? ('Orders and other Athena items (' + drawerCount + ') — ' + readyOrderCount + ' order' + (readyOrderCount === 1 ? '' : 's') + ' can be sent with separate confirmation') : ('Complete final actions in Athena yourself (' + drawerCount + ') — nothing here is sent')) + '</summary>' +
        (manualRows.length ? unifiedGroupHead('You finish this in Athena', '#7a5a16', 'The exact payload stays here for you to copy. It never crosses the write bridge.') +
          manualRows.map(function (row) { return unifiedManualRowHtml(manifest, row); }).join('') : '') +
        (orderRows.length ? renderUnifiedOrderSummary(orderRows, manifest, chosen) : '') +
        (blockedRows.length ? unifiedGroupHead('Can\'t send', '#8b2525', 'MLS fails closed on these. Each one names exactly what is missing.') +
          blockedRows.map(function (row) { return unifiedBlockedRowHtml(manifest, row); }).join('') : '') +
        '</details>';
    }
    var ov = document.createElement('div'); ov.id = 'mlsAthenaUnifiedConfirm';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(10,25,50,.55);display:flex;align-items:center;justify-content:center;padding:18px';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'mlsAthenaUnifiedTitle'); ov.setAttribute('aria-describedby', 'mlsAthenaUnifiedSafety');
    var card = document.createElement('div'); card.style.cssText = 'background:#fff;color:#1A211C;width:min(720px,96vw);max-height:92vh;overflow:auto;border-radius:16px;box-shadow:0 24px 70px rgba(10,30,70,.42);padding:20px 22px;font:13px/1.5 system-ui';
    card.innerHTML =
      (probeOnlyActive() ? '<div id="mlsAthenaProbeOnlyBanner" style="margin:0 0 12px;padding:10px 12px;border:2px solid #8b2525;background:#fdf2f2;color:#8b2525;border-radius:10px;font-weight:850">' + esc(PROBE_ONLY_BANNER) + '</div>' : '') +
      '<div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1"><div id="mlsAthenaUnifiedTitle" style="font-size:20px;font-weight:850;color:#204034">Send to Athena</div><div style="color:#52675c;margin-top:3px">' + esc(S(manifest.patient.name) || 'This note') + ' &middot; ' + (generationIssue ? 'generate the missing or stale five-field clinical draft locally first; no Athena write is available until the rebuilt rows pass the exact encounter check.' : ('each confirmation runs exactly one selected READY item below. ' + (athenaFinalActionsReady() ? 'Reviewed note writes, Save Draft, billing staging, Sign &amp; Save, and each supported catalog-bound order run only after their own explicit confirmation; medication and injection orders stay yours in Athena.' : 'Only reviewed note write and Save Draft can be confirmed here; signing, billing and orders stay yours in Athena.'))) + '</div></div><button type="button" id="mlsAthenaUnifiedClose" aria-label="Close Athena review" style="border:0;background:none;font-size:23px;color:#66766d;cursor:pointer">&times;</button></div>' +
      unifiedNoteHeroHtml(manifest) +
      unifiedCanonicalGenerationHtml(state) +
      rowsHtml +
      '<div id="mlsAthenaUnifiedContext" style="margin-top:12px;padding:10px 12px;border:1px solid #cfe0d7;background:#f7fbf9;border-radius:10px;color:#204034;overflow-wrap:anywhere"><b>Exact Athena encounter:</b> ' + (generationIssue ? 'kept fail-closed while the five local draft fields are generated.' : 'being verified read-only now.') + '</div>' +
      '<div id="mlsAthenaUnifiedProbe" role="status" style="margin-top:8px;color:#6d5010">' + (generationIssue ? 'No Athena check or write has started. Generate the local fields first.' : 'Checking the exact chart read-only &mdash; nothing is sent yet.') + '</div>' +
      /* wfdx-1.0.0: a PHI-free one-liner (extension version, athenaOne tab
         count, expected day, whether an appointment id is bound, and the day
         athenaOne is really on) plus the read-only buttons that fix it. */
      '<div id="mlsAthenaUnifiedDiag" style="display:none;margin-top:6px;font-size:11.5px;color:#52675c;overflow-wrap:anywhere"></div>' +
      '<div id="mlsAthenaUnifiedFix" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"></div>' +
      '<div id="mlsAthenaUnifiedSafety" style="margin-top:10px;padding:9px 11px;border:1px solid #f0d79a;background:#fff7e6;border-radius:9px;color:#6d5010"><b>Nothing has changed yet.</b> ' + (generationIssue ? 'Generate / Regenerate updates only the local MLS draft through the normal validation and persistence gate. It never binds an encounter and never writes Athena; the rebuilt review must still pass exact patient, appointment, and destination checks.' : (athenaFinalActionsReady() ? 'One READY row is pre-selected and checked read-only; each Confirm &amp; Send click runs exactly that one action, and MLS never retries or auto-chains. Sign &amp; Save unlocks only after a verified note write; a reviewed catalog-bound order places only that item; prescriptions and claim submission stay yours in Athena.' :'One READY note row is pre-selected and checked read-only; each Confirm &amp; Send click runs exactly that one action, and MLS never retries or auto-chains. Billing, orders, prescriptions, signature, attestation, and claim submission stay yours in Athena.')) + '</div>' +
      wfxEvidenceHtml(state) + /* wfx-1.0.0: W1 staleness, W2 contradiction screen, W4 completeness tally */
      unifiedIdentityHtml(manifest) +
      '<div id="mlsAthenaUnifiedReceipt" style="margin-top:11px"></div>' +
      '<div style="display:flex;gap:9px;position:sticky;bottom:-20px;background:#fff;padding:12px 0 2px"><button type="button" id="mlsAthenaUnifiedCancel" style="border:1px solid #d8ddd9;background:#fff;border-radius:10px;padding:11px 16px;font-weight:750;cursor:pointer">Cancel</button><button type="button" id="mlsAthenaUnifiedGo" disabled aria-disabled="true" style="flex:1;border:0;background:#204034;color:#fff;border-radius:10px;padding:12px;font-size:14px;font-weight:850;cursor:pointer">Confirm &amp; Send to Athena</button></div>';
    ov.appendChild(card); document.body.appendChild(ov);
    var cancel = card.querySelector('#mlsAthenaUnifiedCancel'), close = card.querySelector('#mlsAthenaUnifiedClose'), go = card.querySelector('#mlsAthenaUnifiedGo');
    cancel.onclick = closeUnifiedConfirmation; close.onclick = closeUnifiedConfirmation;
    ov.addEventListener('click', function (ev) { if (ev.target === ov && !state.running && !state.generating) closeUnifiedConfirmation(); });
    go.addEventListener('click', function () { executeUnifiedSelection(state); });
    var generationButton = card.querySelector('#mlsAthenaUnifiedGenerateSections');
    if (generationButton) generationButton.addEventListener('click', function () { runUnifiedCanonicalGeneration(state, generationButton); });
    var radios = card.querySelectorAll('input[name="mlsAthenaUnifiedAction"]');
    for (var i = 0; i < radios.length; i++) radios[i].addEventListener('change', function () { probeUnifiedRow(state, this.value); });
    var acceptBtns = card.querySelectorAll('[data-mls-accept-order]');
    for (var abi = 0; abi < acceptBtns.length; abi++) acceptBtns[abi].addEventListener('click', function () { acceptUnifiedSuggestion(state, this.getAttribute('data-mls-accept-order'), this); });
    var copyPayloadBtns = card.querySelectorAll('[data-mls-copy-payload]');
    for (var cpi = 0; cpi < copyPayloadBtns.length; cpi++) copyPayloadBtns[cpi].addEventListener('click', function () {
      var row = unifiedRow(state.manifest, this.getAttribute('data-mls-copy-payload'));
      if (row) unifiedCopyText(manifestPayloadText(row), this, 'Copy payload');
    });
    var copyNoteBtns = card.querySelectorAll('[data-mls-copy-note]');
    for (var cni = 0; cni < copyNoteBtns.length; cni++) copyNoteBtns[cni].addEventListener('click', function () {
      var row = unifiedRow(state.manifest, this.getAttribute('data-mls-copy-note'));
      if (row) unifiedCopyText(S(row.payload.noteText), this, 'Copy note');
    });
    state.a11yKeyHandler = function (ev) {
      if (state.closed || unifiedAthenaState !== state) return;
      if (ev.key === 'Escape' || ev.key === 'Esc') {
        if (state.running || state.generating) return;
        ev.preventDefault(); ev.stopImmediatePropagation(); closeUnifiedConfirmation(); return;
      }
      if (ev.key !== 'Tab') return;
      var focusRows = unifiedFocusableRows(card);
      if (!focusRows.length) { ev.preventDefault(); return; }
      var first = focusRows[0], last = focusRows[focusRows.length - 1], active = document.activeElement;
      if (ev.shiftKey && (active === first || !card.contains(active))) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && (active === last || !card.contains(active))) { ev.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', state.a11yKeyHandler, true);
    wireUnifiedTeaching(state, card);
    renderUnifiedReceipts(state);
    if (chosen) {
      for (var ri = 0; ri < radios.length; ri++) if (radios[ri].value === chosen.id) radios[ri].checked = true;
      try { wfdxShowFixStrip(state, chosen.id); } catch (eStrip) {}
      probeUnifiedRow(state, chosen.id);
    } else {
      try { wfdxShowFixStrip(state, ''); } catch (eStrip2) {}
    }
    setTimeout(function () {
      if (!state.closed && unifiedAthenaState === state && unifiedVisibleFocusTarget(close)) {
        try { close.focus({ preventScroll: true }); } catch (e2) { try { close.focus(); } catch (e3) {} }
      }
    }, 0);
  }

  /* ========================================================================
     p1-autobind-2.0.0 (1p PREVIEW ONLY) -- satisfy the frozen 3.0.61 probe
     contract without changing MLS Assist or guessing a provider.

     3.0.61 rejects a probe before reading Athena unless expectedContext names
     date + provider + (appointment ID or encounter ID/URL). A null-context
     "discover it for me" probe therefore never reached the read-only driver.

     This lane starts only from one exact same-day appointment ID already in
     the account-namespaced schedule import index. Provider candidates come
     only from the structured headers on the same in-memory, request-bound Day
     response: schedule receipt ID, roster receipt ID, served day, row counts,
     header count and exact appointment census must all agree. Each distinct
     provider is tried with a V2 read-only probe carrying the complete patient
     identity plus that exact appointment/date/provider tuple.

     Adoption is deliberately harder than probe success: exactly one response
     must pass the existing name+DOB+MRN validator and echo the exact
     appointment, date and provider. Zero or multiple successes, stale/wrong-day
     data, a patient switch, timeout, malformed receipt, or any mismatch leaves
     the original blocked manifest untouched. Probe tokens are discarded; the
     normal row check still mints the only token that can enable Confirm.

     Rebuild, never mutate: expectedContext is detached, the manifest is rebuilt
     and the complete result is re-verified before state assignment. Billing,
     signing and orders remain manual under their existing capability gates.

     Reversible: window.__mlsP1AutoBind.revert().
     ======================================================================== */
  var p1AutoBindOff = false, p1AutoBindLast = null, P1_AUTOBIND_RESPONSE_MAX_AGE_MS = 30 * 60 * 1000;
  function p1VisitBound(v) {
    v = v || {};
    return !!(S(v.appointmentId).trim() || (S(v.encounterId).trim() && S(v.encounterUrl).trim()));
  }
  function p1SamePatient(a, b) {
    a = a || {}; b = b || {};
    return !!S(a.patientId).trim() && S(a.patientId).trim() === S(b.patientId).trim() &&
      !!S(a.name).trim() && !!S(a.dob).trim() && !!S(a.mrn).trim() &&
      nrmName(a.name) === nrmName(b.name) && nrmDob(a.dob) === nrmDob(b.dob) && nrmId(a.mrn) === nrmId(b.mrn);
  }
  function p1ProviderNorm(value) { return nrmName(S(value).replace(/^(?:provider|doctor)\s*[:\-]?\s*/i, '')); }
  function p1ExactInteger(value) {
    var n = Number(value); return isFinite(n) && n >= 0 && Math.floor(n) === n ? n : -1;
  }
  function p1Epoch(value) {
    var numeric = Number(value);
    if (isFinite(numeric) && numeric > 0) return numeric;
    var parsed = Date.parse(S(value).trim());
    return isFinite(parsed) && parsed > 0 ? parsed : 0;
  }
  function p1LedgerAppointment(patientId, backendRowId, day) {
    var out = [];
    try {
      if (!patientId || !backendRowId || !day || typeof window.uns !== 'function') return '';
      var raw = localStorage.getItem(window.uns('schedImportIndexV1::' + day));
      var parsed = raw ? JSON.parse(raw) : null, rows = parsed && parsed.v === 1 && parsed.rows;
      if (!rows || typeof rows !== 'object' || Array.isArray(rows)) return '';
      Object.keys(rows).forEach(function (key) {
        var m = /^appointment-id:(\d+)$/.exec(key), row = rows[key];
        if (!m || !row || row.state !== 'done') return;
        if (S(row.patientId).trim() === S(patientId).trim() &&
            S(row.backendAppointmentId).trim() === S(backendRowId).trim() &&
            visitDay(row.appt_date) === day) out.push(m[1]);
      });
    } catch (e) { return ''; }
    return out.length === 1 ? out[0] : '';
  }
  function p1AutoBindCandidates(manifest, source, pullResult, now, sourceAt) {
    var no = { ok: false, reason: 'unverified', candidates: [] };
    manifest = manifest || {}; source = source || {}; pullResult = pullResult || {}; now = p1Epoch(now || Date.now()); sourceAt = p1Epoch(sourceAt);
    var p = manifest.patient || {}, visit = manifest.visit || {};
    if (!S(p.patientId).trim() || !S(p.name).trim() || !S(p.dob).trim() || !S(p.mrn).trim()) { no.reason = 'patient-identity-incomplete'; return no; }
    if (!isFinite(sourceAt) || sourceAt <= 0 || sourceAt > now + 60000 || now - sourceAt > P1_AUTOBIND_RESPONSE_MAX_AGE_MS) { no.reason = 'schedule-response-stale'; return no; }
    var sourceDay = visitDay(source.schedDate);
    if (!sourceDay || (visit.visitDate && visitDay(visit.visitDate) !== sourceDay)) { no.reason = 'schedule-day-mismatch'; return no; }
    var cal = calendarRows().filter(function (row) {
      return row && S(row.patient_external_id || row.patientId).trim() === S(p.patientId).trim() &&
        visitDay(row.day_local || row.appt_date || row.start_at) === sourceDay;
    });
    var exact = [];
    cal.forEach(function (row) {
      var day = visitDay(row.day_local || row.appt_date || row.start_at);
      var appointmentId = day ? p1LedgerAppointment(p.patientId, row.id, day) : '';
      if (day && appointmentId) exact.push({ row: row, day: day, appointmentId: appointmentId });
    });
    if (exact.length !== 1) { no.reason = exact.length ? 'appointment-ambiguous' : 'appointment-unverified'; return no; }
    var appointment = exact[0], receipt = source.receipt || {}, rosterReceipt = source.providerRosterReceipt || {};
    var requestId = S(receipt.requestId).trim(), servedDay = visitDay(source.schedDate);
    var expected = p1ExactInteger(receipt.expectedCount), parsedCount = p1ExactInteger(receipt.parsedCount), candidateCount = p1ExactInteger(receipt.candidateCount);
    var coverage = rosterReceipt.attributionCoverage || (source.providerDiag && source.providerDiag.attributionCoverage) || {};
    var coverageRows = p1ExactInteger(coverage.rows), unattributedRows = p1ExactInteger(coverage.unattributedRows), foreignRows = p1ExactInteger(coverage.foreignRows);
    var headerCount = p1ExactInteger(coverage.headerCount), observedCount = p1ExactInteger(rosterReceipt.observedCount);
    var census = pullResult.appointmentCensusReceipt || {}, normalizedRoster = pullResult.providerRosterReceipt || {};
    var sourceRequestId = S(source.requestId || source.id).trim();
    if (source.ok !== true || source.scheduleVerified !== true || receipt.complete !== true || receipt.authoritativeEmpty === true || !requestId ||
        (sourceRequestId && sourceRequestId !== requestId) ||
        S(rosterReceipt.requestId).trim() !== requestId || servedDay !== appointment.day ||
        visitDay(rosterReceipt.targetDate) !== appointment.day || expected <= 0 || expected !== parsedCount ||
        expected !== candidateCount || expected !== coverageRows || headerCount <= 0 || observedCount !== headerCount ||
        rosterReceipt.complete === true || rosterReceipt.partial !== true || S(rosterReceipt.reason) !== 'legacy-unverified' ||
        (S(rosterReceipt.providerMode) && S(rosterReceipt.providerMode) !== 'all') || S(rosterReceipt.requestedProviderId) || S(rosterReceipt.requestedProviderStableKey) ||
        S(coverage.verdict) !== 'row-unattributed' || unattributedRows !== coverageRows || foreignRows !== 0 ||
        pullResult.ok !== true || pullResult.complete !== true || S(pullResult.reason) !== 'complete-appointment-census-only' ||
        normalizedRoster.complete === true || normalizedRoster.partial !== true || S(normalizedRoster.reason) !== 'legacy-unverified' ||
        S(normalizedRoster.providerMode) !== 'all' || S(normalizedRoster.requestId) !== requestId || visitDay(normalizedRoster.targetDate) !== appointment.day ||
        S(normalizedRoster.requestedProviderId) || S(normalizedRoster.requestedProviderStableKey) ||
        census.complete !== true || S(census.kind) !== 'athena-appointment-census' || S(census.reason) !== 'complete-provider-unknown' ||
        S(census.scope) !== 'appointment-census-only' || S(census.requestId) !== requestId || visitDay(census.targetDate) !== appointment.day ||
        p1ExactInteger(census.expectedCount) !== expected || p1ExactInteger(census.parsedCount) !== expected ||
        p1ExactInteger(census.candidateCount) !== expected || p1ExactInteger(census.rowCount) !== expected ||
        p1ExactInteger(census.uniqueAppointmentIds) !== expected || p1ExactInteger(census.providerHeaderCount) !== headerCount ||
        p1ExactInteger(census.unattributedRows) !== expected || p1ExactInteger(census.foreignRows) !== 0 ||
        census.providerAttributionComplete !== false || census.providerFieldsBlank !== true || census.noProviderGuess !== true || census.providerSnapshotAllowed !== false) {
      no.reason = 'schedule-receipt-unbound'; return no;
    }
    var sourceRows = Array.isArray(source.appts) ? source.appts : [], sourceMatches = [], sourceIds = {}, sourceInvalid = false;
    sourceRows.forEach(function (row) {
      var appointmentId = S(row && (row.athenaAppointmentId || row.athena_appointment_id || row.appointmentId || row.appointment_id || row.apptId || row.appt_id)).replace(/\D/g, '');
      var rowDay = visitDay(row && (row.date || row.appt_date || sourceDay));
      var providerName = S(row && (row.provider || row.providerName || row.provider_name || row.providerDisplayName || row.provider_display_name || row.renderingProvider || row.rendering_provider || row.renderingProviderName || row.rendering_provider_name)).trim();
      var providerId = S(row && (row.providerId || row.provider_id || row.athenaProviderId || row.athena_provider_id || row.renderingProviderId || row.rendering_provider_id)).trim();
      if (!appointmentId || sourceIds[appointmentId] || rowDay !== sourceDay || providerName || providerId) { sourceInvalid = true; return; }
      sourceIds[appointmentId] = 1;
      if (appointmentId === appointment.appointmentId) sourceMatches.push(row);
    });
    if (sourceInvalid || sourceRows.length !== expected || Object.keys(sourceIds).length !== expected || sourceMatches.length !== 1) { no.reason = 'appointment-response-unbound'; return no; }
    var roster = Array.isArray(source.providerRoster) ? source.providerRoster : [], providers = [], seen = {};
    roster.forEach(function (entry) {
      var label = S(entry && (entry.name || entry.raw)).trim(), norm = p1ProviderNorm(label);
      if (!label || !norm || seen[norm]) return;
      seen[norm] = 1; providers.push({ provider: label, providerNorm: norm });
    });
    if (providers.length !== headerCount) { no.reason = 'provider-headers-unbound'; return no; }
    return { ok: true, reason: 'candidate-set-verified', requestId: requestId, patient: stableClone(p),
      appointmentId: appointment.appointmentId, visitDate: athenaVisitDate(appointment.day), day: appointment.day,
      candidates: providers.map(function (entry) { return { appointmentId: appointment.appointmentId,
        visitDate: athenaVisitDate(appointment.day), provider: entry.provider, providerNorm: entry.providerNorm }; }) };
  }
  function p1SameCandidateSet(a, b) {
    a = a || {}; b = b || {};
    if (!a.ok || !b.ok || a.requestId !== b.requestId || a.appointmentId !== b.appointmentId ||
        a.visitDate !== b.visitDate || a.day !== b.day || !Array.isArray(a.candidates) || !Array.isArray(b.candidates) ||
        a.candidates.length !== b.candidates.length) return false;
    return !a.candidates.some(function (candidate, index) {
      var other = b.candidates[index];
      return !other || candidate.appointmentId !== other.appointmentId || candidate.visitDate !== other.visitDate ||
        candidate.provider !== other.provider || candidate.providerNorm !== other.providerNorm;
    });
  }
  function p1IndeterminateProbe(reason) {
    return { ok: false, conclusive: false, determinate: false, indeterminate: true, reason: reason || 'probe-indeterminate' };
  }
  function p1DefinitiveNegative(reason) {
    return { ok: false, conclusive: true, determinate: true, indeterminate: false, reason: reason || 'candidate-not-found' };
  }
  function p1ValidateAutoBindProbe(patient, candidate, probe) {
    candidate = candidate || {};
    if (!probe || typeof probe !== 'object' || Array.isArray(probe)) return p1IndeterminateProbe('probe-malformed');
    if (probe.__timeout === true) return p1IndeterminateProbe('probe-timeout');
    var reason = S(probe.reason).trim();
    if (reason === 'outcome-uncertain' || /outcome-uncertain/i.test(S(probe.detail))) return p1IndeterminateProbe('probe-outcome-uncertain');
    /* Frozen 3.0.61 returns this exact blocked receipt when a fully completed
       read found no encounter for one candidate provider. It is the only safe
       negative to count toward the exactly-one rule. Transport errors,
       malformed success shapes and every other refusal poison the whole bind. */
    if (probe.ok === false) {
      if (probe.blocked === true && reason === 'context-unverified') return p1DefinitiveNegative('candidate-context-unverified');
      return p1IndeterminateProbe(reason ? ('probe-' + reason) : 'probe-transport-unverified');
    }
    if (probe.ok !== true || probe.mode !== 'probe' || probe.readOnly !== true) return p1IndeterminateProbe('probe-unverified');
    var lock;
    try { lock = validatedUnifiedProbe(patient, probe); } catch (eValidate) { return p1IndeterminateProbe('probe-validation-failed'); }
    if (!lock || !lock.ok || !lock.context) return p1IndeterminateProbe('patient-identity-mismatch');
    var raw = probe.context || {}, appointmentId = contextValue(raw, ['appointmentId', 'athenaAppointmentId'], '');
    if (!appointmentId || nrmId(appointmentId) !== nrmId(candidate.appointmentId) ||
        visitDay(lock.context.visitDate) !== visitDay(candidate.visitDate) ||
        p1ProviderNorm(lock.context.provider) !== candidate.providerNorm) return p1IndeterminateProbe('probe-context-mismatch');
    return { ok: true, conclusive: true, determinate: true, indeterminate: false, reason: 'exact-probe-match', lock: lock };
  }
  function p1AutoBindEncounter(state) {
    if (p1AutoBindOff || !state || state.closed || state.running || state.halted) return false;
    var m = state.manifest; if (!m || !m.rows) return false;
    var p = m.patient || {};
    /* never bind against a chart we cannot positively identify */
    if (!S(p.name).trim() || !S(p.dob).trim() || !S(p.mrn).trim()) return false;
    var row = null;
    for (var i = 0; i < m.rows.length; i++) {
      var r = m.rows[i];
      if (r && r.payload && (r.action === 'write_note' || r.id === 'write-note')) { row = r; break; }
    }
    if (!row) return false;
    /* 2026-08-17 (wfdx lane): the old gate was p1VisitBound(m.visit) -- "an
       appointment id is present, therefore this review is bound". That is not
       the manifest's own predicate: the note row also needs the PROVIDER, and
       an encounter carrying an exact imported appointment id but no provider
       (an op note saved from the Prep room, or any provider-unknown census day)
       fell into the hole between the two -- auto-bind refused to run because an
       id existed, while the row stayed blocked because no provider did. Use the
       row's real capability instead, and keep the appointment identity frozen:
       a candidate set that resolves a DIFFERENT appointment id than the one
       already on the manifest is refused outright. */
    if (row.capability === 'ready') return false;                  /* already sendable */
    var priorAppointmentId = nrmId(m.visit && m.visit.appointmentId);
    var source = null, pullResult = null, sourceAt = 0;
    try {
      source = window.__mlsSI && typeof window.__mlsSI._lastResp === 'function' ? window.__mlsSI._lastResp() : null;
      pullResult = window.__mlsSI && typeof window.__mlsSI._lastPullResult === 'function' ? window.__mlsSI._lastPullResult() : null;
      sourceAt = window.__mlsSI && typeof window.__mlsSI._lastRespAt === 'function' ? window.__mlsSI._lastRespAt() : 0;
    } catch (eSource) {}
    var set = p1AutoBindCandidates(m, source, pullResult, Date.now(), sourceAt);
    if (!set.ok || !set.candidates.length) return false;
    if (priorAppointmentId && nrmId(set.appointmentId) !== priorAppointmentId) return false;
    var gen = state.probeGeneration, patientAtStart = stableClone(m.patient), bp = bridgePatient(m.patient), payload = row.payload || {};
    unifiedStatus(state, 'Checking the exact Athena appointment against ' + set.candidates.length + ' same-day provider header' + (set.candidates.length === 1 ? '' : 's') + ' read-only \u2014 nothing is sent.', '');
    var probeDeadlineAt = Date.now() + 60000;
    function p1ProbeCandidate(candidate) {
      var probePromise;
      var remainingMs = Math.max(0, probeDeadlineAt - Date.now());
      if (remainingMs <= 0) return Promise.resolve(p1IndeterminateProbe('probe-deadline-exceeded'));
      try { probePromise = bridge('mlsAppAthenaActionV2', {
          foregroundOk: false, mode: 'probe', action: 'write_note', patient: bp, expectedPatient: bp,
          expectedContext: { appointmentId: candidate.appointmentId, visitDate: candidate.visitDate, provider: candidate.provider },
          previewHash: m.previewHash, manifestHash: m.manifestHash, payload: payload,
          noteText: payload.noteText || '', sections: payload.sections || [], notePolicy: 'empty_only', noteWriteProof: '',
          billing: null, order: null, rowHash: row.rowHash || '', clientOrderId: ''
        }, 'mlsAppAthenaActionV2Result', Math.min(25000, remainingMs)); }
      catch (eProbeStart) { return Promise.resolve(p1IndeterminateProbe('probe-start-failed')); }
      return Promise.resolve(probePromise).then(function (probe) {
        return p1ValidateAutoBindProbe(patientAtStart, candidate, probe);
      }, function () { return p1IndeterminateProbe('probe-failed'); }).then(function (result) { return result; }, function () {
        return p1IndeterminateProbe('probe-validation-failed');
      });
    }
    /* The frozen background handler is asynchronous and does not serialize
       probe mode. Run candidates one at a time so two same-tab driver reads
       can never overlap or race the browser's current frame generation. */
    var results = [], sequenceAborted = false;
    var probeSequence = Promise.resolve();
    set.candidates.forEach(function (candidate) {
      probeSequence = probeSequence.then(function () {
        if (sequenceAborted) return null;
        if (p1AutoBindOff || athenaActionRunning || !state || state.closed || state.running || state.halted || state.probeGeneration !== gen ||
            !p1SamePatient(patientAtStart, actionPatient({ patient: activePt() }))) { sequenceAborted = true; return null; }
        var stepSource = null, stepPullResult = null, stepSourceAt = 0;
        try {
          stepSource = window.__mlsSI && typeof window.__mlsSI._lastResp === 'function' ? window.__mlsSI._lastResp() : null;
          stepPullResult = window.__mlsSI && typeof window.__mlsSI._lastPullResult === 'function' ? window.__mlsSI._lastPullResult() : null;
          stepSourceAt = window.__mlsSI && typeof window.__mlsSI._lastRespAt === 'function' ? window.__mlsSI._lastRespAt() : 0;
        } catch (eStepSource) {}
        if (stepSource !== source || stepPullResult !== pullResult || p1Epoch(stepSourceAt) !== p1Epoch(sourceAt)) { sequenceAborted = true; return null; }
        var stepSet = p1AutoBindCandidates(state.manifest, stepSource, stepPullResult, Date.now(), stepSourceAt);
        if (!p1SameCandidateSet(set, stepSet)) { sequenceAborted = true; return null; }
        return p1ProbeCandidate(candidate);
      }).then(function (result) {
        if (!result) return;
        results.push(result);
        if (result.indeterminate === true || result.determinate !== true || result.conclusive !== true) sequenceAborted = true;
      });
    });
    probeSequence.then(function () {
      try {
        if (sequenceAborted || p1AutoBindOff || athenaActionRunning || !state || state.closed || state.running || state.halted || state.probeGeneration !== gen) return;
        var liveRow = state.manifest && unifiedRow(state.manifest, row.id);
        if (!liveRow || liveRow.capability === 'ready' || liveRow.rowHash !== row.rowHash) return;
        if (nrmId(state.manifest.visit && state.manifest.visit.appointmentId) !== priorAppointmentId) return;
        if (!p1SamePatient(patientAtStart, state.manifest && state.manifest.patient) ||
            !p1SamePatient(patientAtStart, actionPatient({ patient: activePt() }))) return;
        var currentSource = null, currentPullResult = null, currentSourceAt = 0;
        try {
          currentSource = window.__mlsSI && typeof window.__mlsSI._lastResp === 'function' ? window.__mlsSI._lastResp() : null;
          currentPullResult = window.__mlsSI && typeof window.__mlsSI._lastPullResult === 'function' ? window.__mlsSI._lastPullResult() : null;
          currentSourceAt = window.__mlsSI && typeof window.__mlsSI._lastRespAt === 'function' ? window.__mlsSI._lastRespAt() : 0;
        } catch (eCurrentSource) {}
        if (currentSource !== source || currentPullResult !== pullResult || p1Epoch(currentSourceAt) !== p1Epoch(sourceAt)) return;
        var currentSet = p1AutoBindCandidates(state.manifest, currentSource, currentPullResult, Date.now(), currentSourceAt);
        if (!p1SameCandidateSet(set, currentSet)) return;
        if (results.length !== set.candidates.length || results.some(function (result) {
          return !result || result.indeterminate === true || result.determinate !== true || result.conclusive !== true;
        })) return;
        var successes = results.filter(function (result) { return result && result.ok === true; });
        if (successes.length !== 1) return;                          /* zero/multiple fail closed */
        var lock = successes[0].lock, raw = lock.rawContext || {}, v1 = {
          appointmentId: contextValue(raw, ['appointmentId', 'athenaAppointmentId'], ''),
          encounterId: S(lock.context.encounterId).trim(), encounterUrl: S(lock.context.encounterUrl).trim(),
          visitDate: S(lock.context.visitDate).trim(), provider: S(lock.context.provider).trim()
        };
        if (!v1.appointmentId || !v1.encounterId || !v1.encounterUrl || !v1.visitDate || !v1.provider) return;
        var o0 = state.sourceOpts || {}, o1 = {}, k;
        for (k in o0) if (Object.prototype.hasOwnProperty.call(o0, k)) o1[k] = o0[k];
        o1.expectedContext = stableClone(v1);
        var rebuilt = buildUnifiedManifest(o1);                      /* fresh freeze, correct hashes */
        if (!rebuilt || !p1SamePatient(patientAtStart, rebuilt.patient) ||
            nrmId(rebuilt.visit.appointmentId) !== nrmId(v1.appointmentId) ||
            visitDay(rebuilt.visit.visitDate) !== visitDay(v1.visitDate) ||
            p1ProviderNorm(rebuilt.visit.provider) !== p1ProviderNorm(v1.provider) ||
            nrmId(rebuilt.visit.encounterId) !== nrmId(v1.encounterId) ||
            S(rebuilt.visit.encounterUrl).trim() !== v1.encounterUrl || !p1VisitBound(rebuilt.visit)) return;
        if (!p1SamePatient(patientAtStart, actionPatient({ patient: activePt() }))) return;
        state.manifest = rebuilt; state.sourceOpts = o1;
        state.reopenOpts = reopenOptions(o1, rebuilt);
        p1AutoBindLast = { encounterId: v1.encounterId, appointmentId: v1.appointmentId, requestId: set.requestId, at: Date.now() };
        if (typeof document !== 'undefined' && document.body) renderUnifiedConfirmation(state);
        unifiedStatus(state, 'This exact appointment is now bound to one Athena provider and encounter \u2014 verified read-only against name, DOB and MRN. Nothing was sent.', 'ok');
      } catch (e1) {}
    }, function () {});
    return true;
  }
  try {
    window.__mlsP1AutoBind = { v: 'p1-autobind-2.0.0',
      state: function () { return { off: p1AutoBindOff, last: p1AutoBindLast }; },
      _test: { candidates: p1AutoBindCandidates, validateProbe: p1ValidateAutoBindProbe, samePatient: p1SamePatient, sameCandidateSet: p1SameCandidateSet,
        currentState: function () { return unifiedAthenaState; } },
      revert: function () { p1AutoBindOff = true; return true; } };
  } catch (eAB) {}
  function openUnifiedConfirmation(opts) {
    opts = opts || {};
    if (athenaActionRunning) { actionSay(opts, 'Another Athena action is already awaiting confirmation. Finish or cancel it before opening the unified review.', ''); return null; }
    var returnFocus = null;
    try {
      var active = document.activeElement;
      if (active && active !== document.body && active !== document.documentElement && !active.closest('#mlsAthenaUnifiedConfirm')) returnFocus = active;
    } catch (e0) {}
    if (unifiedAthenaState) closeUnifiedConfirmation();
    var manifest = buildUnifiedManifest(opts);
    wfdxReset(manifest);
    var state = { manifest: manifest, sourceOpts: opts, reopenOpts: null, selectedRowId: '', probe: null, probeGeneration: 0, receipts: {}, running: false, generating: false, binding: false, halted: false, closed: false, returnFocus: returnFocus, a11yKeyHandler: null, autoOpened: false };
    state.reopenOpts = reopenOptions(opts, manifest);
    srrArmIfUnbound(state); /* srr-1.0.0 */
    unifiedAthenaState = state;
    if (typeof document !== 'undefined' && document.body) renderUnifiedConfirmation(state);
    /* p1-autobind-2.0.0: if the visit is unbound, use its exact imported appointment
       and request-bound provider headers to read the matching encounter instead of
       telling him to go run a day pull. Fails closed; see the block above. */
    try { p1AutoBindEncounter(state); } catch (eP1AB) {}
    actionSay(opts, manifest.rows.some(function (row) { return row.capability === 'ready' && row.action; })
      ? (athenaFinalActionsReady()
        ? 'Athena review ready. Select one ready action — note write, Save Draft, billing staging, Sign & Save, or one supported order — and confirm it; MLS runs exactly that one action.'
        : 'Athena review ready. Only reviewed note write or Save Draft can be selected and confirmed; complete final actions in Athena.')
      : 'Athena review ready. This payload is review-only; complete it directly in Athena.', '', { toast: false });
    return manifest;
  }

  /* ---- identity helpers: MIRROR the extension driver's own matchers so the
     app's "is this the right chart?" judgment is identical to the driver's
     gate. Used to REFUSE a false "written" claim when the chart the driver
     reports it verified is NOT the patient we intended. ---------------------- */
  function nrmName(s) { return S(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function nameMatch(a, b) {
    var ta = nrmName(a).split(' ').filter(function (x) { return x.length > 1; });
    var tb = nrmName(b).split(' ').filter(function (x) { return x.length > 1; });
    if (!ta.length || !tb.length) return false;
    var o = ta.filter(function (x) { return tb.indexOf(x) >= 0; }).length;
    return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1);
  }
  function nrmDob(s) {
    var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(S(s));
    if (!m) return '';
    var pivot = (new Date().getFullYear() % 100) + 1;
    var y = m[3].length === 2 ? ((Number(m[3]) > pivot ? '19' : '20') + m[3]) : m[3];
    var mo = Number(m[1]), dy = Number(m[2]);
    if (mo < 1 || mo > 12 || dy < 1 || dy > 31) return '';
    return mo + '/' + dy + '/' + y;
  }
  function nrmId(s) { return S(s).replace(/\D/g, ''); }

  /* -------------------- sections from the review panel --------------------- */
  /* One explicit app-side routing table. Legacy aliases are normalized before
     crossing the bridge; unknown keys never reach the extension's generic
     fallback. Follow-up is merged into Plan because that is the driver's exact
     supported destination. Structured actions remain in the review panel only. */
  var EXEC_ALIAS = {
    note: 'note',
    hpi: 'hpi', history: 'hpi',
    ros: 'ros', review_of_systems: 'ros',
    exam: 'exam', physical_exam: 'exam',
    assessment: 'assessment', assessment_narrative: 'assessment',
    plan: 'plan', followup: 'plan', follow_up: 'plan',
    procedure: 'procedure', opnote: 'procedure', op_note: 'procedure',
    procedure_note: 'procedure', operative_note: 'procedure'
  };
  var PREVIEW_ONLY = {
    orders: 1, rx: 1, referrals: 1, pt: 1, imaging: 1, billing: 1,
    surgctr: 1, consent: 1, handouts: 1, instructions: 1
  };
  var DESTINATION = {
    note: 'Athena encounter > Encounter note',
    hpi: 'Athena encounter > HPI',
    ros: 'Athena encounter > Review of Systems',
    exam: 'Athena encounter > Physical Exam',
    assessment: 'Athena encounter > Assessment & Plan > Assessment',
    plan: 'Athena encounter > Assessment & Plan > Plan / Follow-up',
    orders: 'Athena Orders (manual entry)', rx: 'Athena Prescriptions (manual entry)',
    referrals: 'Athena Orders > Referral (manual entry)', pt: 'Athena Orders > PT (manual entry)',
    imaging: 'Athena Orders > Imaging (manual entry)', billing: 'Athena Billing / Charges (manual entry)',
    surgctr: 'Surgery scheduling workflow (manual entry)', consent: 'Patient documents / consent (manual entry)',
    handouts: 'Patient documents / handout (manual entry)', instructions: 'Patient instructions (manual entry)',
    procedure: 'Athena encounter > Physical Exam > Procedure Documentation'
  };
  function canonicalSectionKey(raw) {
    raw = S(raw).toLowerCase().trim();
    if (EXEC_ALIAS[raw]) return { key: EXEC_ALIAS[raw], execute: true };
    if (PREVIEW_ONLY[raw]) return { key: raw, execute: false, previewOnly: true };
    return null;
  }
  /* Parse only a generated note that explicitly supplies the five named
     Athena destinations. The generator supports several note styles and may
     emit SUBJECTIVE/OBJECTIVE, a combined ASSESSMENT & PLAN, or prose; those
     shapes are intentionally refused here rather than guessed into fields.
     This helper only creates immutable review rows. It never opens a panel,
     calls the bridge, or performs a write. */
  function parseGeneratedSoapSections(text) {
    var src = S(text).replace(/\r\n?/g, '\n').trim();
    var required = ['hpi', 'ros', 'exam', 'assessment', 'plan'];
    var labels = { hpi: 'HPI', ros: 'Review of Systems', exam: 'Physical Exam', assessment: 'Assessment', plan: 'Plan / Follow-up' };
    if (!src) return { ok: false, reason: 'empty-note', sections: [] };
    var lines = src.split('\n');
    function rows(bodies) {
      for (var r = 0; r < required.length; r++) {
        var k = required[r], body = S((bodies[k] || []).join('\n')).trim();
        if (!body) return { ok: false, reason: 'empty-' + k, sections: [] };
      }
      return null;
    }
    var bodies = {}, current = null, seen = {}, order = [];
    var flat = /^\s*(HPI|ROS|EXAM|ASSESSMENT|PLAN)\s*:?\s*(.*)$/i;
    var malformedDestinationHeading = /^\s*(?:#{1,6}\s*|\*{1,3}\s*|_{1,3}\s*|`{1,3}\s*|\d+[.)]\s*|[-•]\s+)(?:HPI|ROS|EXAM|PHYSICAL\s+EXAM|REVIEW\s+OF\s+SYSTEMS|SUBJECTIVE|OBJECTIVE|ASSESSMENT(?:\s*(?:AND|&)\s*PLAN)?|PLAN)\b\s*(?:[*_`]+)?\s*:?\s*/i;
    var bareUnsupportedWrapperHeading = /^\s*(?:SUBJECTIVE|OBJECTIVE|ASSESSMENT\s*(?:AND|&)\s*PLAN)\s*:?\s*$/i;
    var malformedNestedHeading = /^\s*(?:#{1,6}\s*|\*{1,3}\s*|_{1,3}\s*|`{1,3}\s*|\d+[.)]\s*|[-•]\s+)(?:CHIEF\s+COMPLAINT|HISTORY|PMH|PAST\s+MEDICAL\s+HISTORY|MEDICATIONS?|ALLERGIES|VITALS?|VITAL\s+SIGNS|FINDINGS|LABS?|IMAGING|DIAGNOS(?:IS|ES)|REVIEW\s+OF\s+SYSTEMS)\b\s*(?:[*_`]+)?\s*:?\s*/i;
    var first = ''; for (var fi = 0; fi < lines.length; fi++) { if (S(lines[fi]).trim()) { first = lines[fi]; break; } }
    var wrappedShape = /^\s*(SUBJECTIVE|OBJECTIVE|ASSESSMENT|PLAN)\s*:?/i.test(first);
    if (!wrappedShape) for (var i = 0; i < lines.length; i++) {
      var fm = flat.exec(lines[i]);
      if (bareUnsupportedWrapperHeading.test(lines[i])) return { ok: false, reason: 'malformed-heading', sections: [] };
      if (fm) {
        var fk = fm[1].toLowerCase();
        if (seen[fk]) return { ok: false, reason: 'duplicate-' + fk, sections: [] };
        seen[fk] = true; order.push(fk); current = fk; bodies[fk] = [];
        if (S(fm[2]).trim()) bodies[fk].push(fm[2]);
      } else if (S(lines[i]).trim()) {
        if (!current) return { ok: false, reason: 'preamble-or-unsupported-shape', sections: [] };
        if (malformedDestinationHeading.test(lines[i])) return { ok: false, reason: 'malformed-heading', sections: [] };
        bodies[current].push(lines[i]);
      }
    }
    var flatOrder = required.every(function (key, idx) { return order[idx] === key; });
    if (order.length === required.length && flatOrder) {
      var flatError = rows(bodies); if (flatError) return flatError;
    } else {
      /* Shipped structured SOAP shape: SUBJECTIVE/OBJECTIVE/ASSESSMENT/PLAN
         wrappers with exact nested HPI, ROS and Exam labels. We accept only the
         canonical wrapper order and only the exact nested labels; an unlabelled
         preamble, duplicate, combined A&P, or extra field is refused. */
      var top = /^(SUBJECTIVE|OBJECTIVE|ASSESSMENT|PLAN)\s*:?\s*(.*)$/i, wrapped = {}, topOrder = [], topSeen = {}, topKey = null;
      for (var j = 0; j < lines.length; j++) {
        var tm = top.exec(lines[j]);
        if (tm) {
          var tk = tm[1].toLowerCase();
          if (topSeen[tk]) return { ok: false, reason: 'duplicate-wrapper-' + tk, sections: [] };
          topSeen[tk] = true; topOrder.push(tk); topKey = tk; wrapped[tk] = [];
          if (S(tm[2]).trim()) wrapped[tk].push(tm[2]);
        } else if (S(lines[j]).trim()) {
          if (!topKey) return { ok: false, reason: 'preamble-before-subjective', sections: [] };
          wrapped[topKey].push(lines[j]);
        }
      }
      var expectedTop = ['subjective', 'objective', 'assessment', 'plan'];
      if (!expectedTop.every(function (key, idx) { return topOrder[idx] === key; })) return { ok: false, reason: 'wrapper-order', sections: [] };
      var nested = { hpi: [], ros: [], exam: [], assessment: wrapped.assessment.slice(), plan: wrapped.plan.slice() };
      var nestedHeading = /^\s*(HPI|ROS|PHYSICAL\s+EXAM|EXAM)\s*:?\s*(.*)$/i;
      var unsupportedNestedHeading = /^\s*(CHIEF\s+COMPLAINT|HISTORY|PMH|PAST\s+MEDICAL\s+HISTORY|MEDICATIONS?|ALLERGIES|VITALS?|VITAL\s+SIGNS|FINDINGS|LABS?|IMAGING|DIAGNOS(?:IS|ES))\s*:/i;
      function nestedParts(input, allowed) {
        var out = {}, active = null, seenNested = {}, sequence = [];
        for (var q = 0; q < input.length; q++) {
          var nm = nestedHeading.exec(input[q]);
          if (nm && allowed[nm[1].toLowerCase().replace(/\s+/g, ' ')]) {
            var nk = nm[1].toLowerCase().replace(/\s+/g, ' '); nk = nk === 'physical exam' ? 'exam' : nk;
            if (seenNested[nk]) return { error: 'duplicate-' + nk };
            seenNested[nk] = true; sequence.push(nk); active = nk; out[nk] = [];
            if (S(nm[2]).trim()) out[nk].push(nm[2]);
          } else if (S(input[q]).trim()) {
            if (malformedDestinationHeading.test(input[q]) || malformedNestedHeading.test(input[q])) return { error: 'malformed-heading' };
            if (unsupportedNestedHeading.test(input[q])) return { error: 'unsupported-nested-heading' };
            if (!active) return { error: 'preamble-before-nested-heading' };
            out[active].push(input[q]);
          }
        }
        return { out: out, sequence: sequence };
      }
      var subj = nestedParts(wrapped.subjective, { hpi: 1, ros: 1 });
      if (subj.error || subj.sequence.join('|') !== 'hpi|ros') return { ok: false, reason: subj.error || 'nested-order', sections: [] };
      var obj = nestedParts(wrapped.objective, { exam: 1, 'physical exam': 1 });
      if (obj.error || obj.sequence.length !== 1 || obj.sequence[0] !== 'exam') return { ok: false, reason: obj.error || 'missing-exam', sections: [] };
      nested.hpi = subj.out.hpi || []; nested.ros = subj.out.ros || []; nested.exam = obj.out.exam || [];
      var nestedError = rows(nested); if (nestedError) return nestedError;
      bodies = nested;
    }
    var out = required.map(function (key) {
      return { key: key, text: S(bodies[key].join('\n')).trim(), execute: true, destination: DESTINATION[key], label: labels[key] };
    });
    return { ok: true, reason: '', sections: out };
  }
  /* The model's `athena_note` sidecar is deliberately stricter than the
     display-note parser above.  It is the canonical write payload: exactly
     five flat, top-level destinations in this order, with no wrapper,
     preamble, duplicate, or guessed section.  Keep this parser separate so
     an APSO/narrative/problem/H&P display note can remain clinician-friendly
     without ever being mistaken for a five-field Athena payload. */
  function parseCanonicalAthenaNote(text) {
    var src = S(text).replace(/\r\n?/g, '\n').trim();
    var required = ['hpi', 'ros', 'exam', 'assessment', 'plan'];
    var labels = { hpi: 'HPI', ros: 'Review of Systems', exam: 'Physical Exam', assessment: 'Assessment', plan: 'Plan / Follow-up' };
    if (!src) return { ok: false, reason: 'empty-note', sections: [] };
    if (src.length > 50000) return { ok: false, reason: 'note-too-large', sections: [] };
    var lines = src.split('\n'), bodies = {}, current = null, seen = {}, order = [];
    var flat = /^\s*(HPI|ROS|EXAM|ASSESSMENT|PLAN)\s*:?\s*(.*)$/i;
    var combinedWrapper = /^\s*(?:#{1,6}\s*|\*{1,3}\s*|_{1,3}\s*|`{1,3}\s*)?ASSESSMENT\s*(?:AND|&)\s*PLAN\b/i;
    var malformed = /^\s*(?:#{1,6}\s*|\*{1,3}\s*|_{1,3}\s*|`{1,3}\s*|\d+[.)]\s*|[-•]\s+)?(?:HPI|ROS|EXAM|EXAMINATION|ASSESSMENT|PLAN|SUBJECTIVE|OBJECTIVE|ASSESSMENT\s*(?:AND|&)\s*PLAN|CHIEF\s+COMPLAINT|HISTORY|PMH|PAST\s+MEDICAL\s+HISTORY|MEDICATIONS?|ALLERGIES|VITALS?|VITAL\s+SIGNS|FINDINGS|LABS?|IMAGING|DIAGNOS(?:IS|ES)|REVIEW\s+OF\s+SYSTEMS|PHYSICAL\s+EXAM)\b\s*(?:[*_`]+)?\s*:?(?:\s*)$/i;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i], trimmed = S(line).trim();
      if (!trimmed) continue;
      if (combinedWrapper.test(line)) return { ok: false, reason: 'malformed-heading', sections: [] };
      var match = flat.exec(line);
      if (match) {
        var key = match[1].toLowerCase();
        if (seen[key]) return { ok: false, reason: 'duplicate-' + key, sections: [] };
        seen[key] = true; order.push(key); current = key; bodies[key] = [];
        if (S(match[2]).trim()) bodies[key].push(match[2]);
      } else {
        if (!current) return { ok: false, reason: 'preamble-or-unsupported-shape', sections: [] };
        if (malformed.test(line)) return { ok: false, reason: 'malformed-heading', sections: [] };
        bodies[current].push(line);
      }
    }
    if (order.length !== required.length || !required.every(function (key, index) { return order[index] === key; })) return { ok: false, reason: 'missing-or-out-of-order-section', sections: [] };
    for (var r = 0; r < required.length; r++) if (!S((bodies[required[r]] || []).join('\n')).trim()) return { ok: false, reason: 'empty-' + required[r], sections: [] };
    return { ok: true, reason: '', text: src, sections: required.map(function (key) {
      return { key: key, text: S(bodies[key].join('\n')).trim(), execute: true, destination: DESTINATION[key], label: labels[key] };
    }) };
  }
  function gatherSections(panel) {
    var out = [], held = [], errors = [], blocked = [], byKey = {}, duplicateByKey = {}, seenRaw = {};
    var boxes = panel.querySelectorAll('input[data-k]');
    for (var i = 0; i < boxes.length; i++) {
      var raw = S(boxes[i].getAttribute('data-k')).toLowerCase().trim();
      if (!boxes[i].checked) continue;
      /* One textarea per normal route is the shipped shape. If an adversarial
         panel supplies repeated controls, pair each checkbox with the same
         occurrence instead of repeatedly reading the first textarea. */
      var tas = panel.querySelectorAll('textarea[data-t="' + raw + '"]');
      var occ = Number(seenRaw[raw] || 0); seenRaw[raw] = occ + 1;
      var ta = tas[occ] || tas[0];
      var v = ta ? S(ta.value).trim() : '';
      if (!v) continue;
      var route = canonicalSectionKey(raw);
      if (!route) { errors.push(raw || '(blank)'); blocked.push({ key: raw || 'unknown', text: v }); continue; }
      if (route.previewOnly) { held.push({ key: raw, text: v, destination: DESTINATION[raw] || 'Manual destination required' }); continue; }
      if (/^follow_?up$/.test(raw) || raw === 'followup') v = 'Follow-up:\n' + v;
      if (duplicateByKey[route.key]) {
        duplicateByKey[route.key].text += '\n\n' + v;
        duplicateByKey[route.key].duplicateSections.push({ key: route.key, text: v, execute: true, destination: DESTINATION[route.key] });
      }
      else if (byKey[route.key]) {
        /* A repeated canonical destination is ambiguous. Remove the first
           executable item and retain one explicit blocked receipt carrying
           every reviewed payload; never concatenate two HPI/ROS/Exam/
           Assessment/Plan destinations into one write. */
        var prior = byKey[route.key];
        delete byKey[route.key];
        out = out.filter(function (item) { return item !== prior; });
        duplicateByKey[route.key] = { key: route.key, text: prior.text + '\n\n' + v,
          duplicateSections: [{ key: route.key, text: prior.text, execute: true, destination: DESTINATION[route.key] }, { key: route.key, text: v, execute: true, destination: DESTINATION[route.key] }],
          duplicate: true, reason: 'More than one reviewed payload targets the same Athena destination. Combine it explicitly before review; MLS will not merge or overwrite the field twice.' };
        blocked.push(duplicateByKey[route.key]);
      }
      else { byKey[route.key] = { key: route.key, text: v, execute: true, destination: DESTINATION[route.key] }; out.push(byKey[route.key]); }
    }
    return { sections: out, held: held, errors: errors, blocked: blocked };
  }

  /* --------------------------- result rendering ---------------------------- */
  function logTo(el, html) { try { el.innerHTML += '<div style="margin:3px 0">' + html + '</div>'; el.scrollTop = el.scrollHeight; } catch (e) {} }
  function bigRefusal(logEl, html) {
    try { logEl.innerHTML += '<div style="margin:6px 0;padding:8px 10px;border-radius:8px;background:rgba(220,38,38,.16);border:1px solid rgba(248,113,113,.55);color:#ffd9d9;font-weight:600">' + html + '</div>'; logEl.scrollTop = logEl.scrollHeight; } catch (e) {}
  }
  /* `ok`, `written`, and DOM read-back are not durable completion evidence.
     Done requires a section-specific persisted/serverVerified receipt. */
  function renderResp(logEl, resp, want) {
    want = want || {};
    if (!resp || resp.__timeout) { bigRefusal(logEl, '&#9888; No completion response from MLS Assist. This is not marked Done; inspect the open Athena note for any partial draft before retrying.'); return; }
    if (!resp.ok) {
      bigRefusal(logEl, '&#9940; <b>No durable completion evidence.</b> ' + esc(resp.error || resp.reason || 'The draft attempt was refused.'));
      return;
    }
    /* ---- independent chart-identity check (must match the intended patient) -- */
    var cName = S(resp.chartName), cDob = S(resp.chartDob), cMrn = S(resp.chartMrn);
    if (!cName) {
      bigRefusal(logEl, '&#9940; <b>Nothing was written.</b> Could not confirm which chart is open in athenaOne. Open <b>' + esc(want.name || 'the patient') + '</b>&#39;s chart, then write.');
      return;
    }
    var nameOK = want.name ? nameMatch(cName, want.name) : true;
    var dobOK = want.dob ? (nrmDob(cDob) === nrmDob(want.dob)) : true;
    var idOK = (want.mrn && cMrn) ? (nrmId(cMrn) === nrmId(want.mrn)) : true;
    if (!nameOK || !dobOK || !idOK) {
      bigRefusal(logEl, '&#9940; <b>WRONG CHART OPEN &mdash; nothing was written.</b><br>athenaOne is showing <b>' + esc(cName) + '</b>' + (cDob ? ' (' + esc(cDob) + ')' : '') + (cMrn ? ' #' + esc(cMrn) : '') +
        ',<br>not <b>' + esc(want.name || '?') + '</b>' + (want.dob ? ' (' + esc(want.dob) + ')' : '') + (want.mrn ? ' #' + esc(want.mrn) : '') +
        '.<br>Open the correct patient&#39;s chart in athenaOne, then write.');
      return;
    }
    logTo(logEl, '&#10003; Chart identity confirmed for supervised draft placement: <b>' + esc(cName) + '</b>' + (cDob ? ' (' + esc(cDob) + ')' : '') + (cMrn ? ' #' + esc(cMrn) : '') + '.');
    var rs = resp.results || [];
    var okN = 0, draftN = 0, warnN = 0, execTotal = 0;
    for (var i = 0; i < rs.length; i++) {
      var r = rs[i];
      var label = r.key.charAt(0).toUpperCase() + r.key.slice(1);
      var destination = DESTINATION[r.key] || 'explicit Athena section';
      if (r.execute) {
        execTotal++;
        var durable=!!(r.persisted||r.serverVerified);
        if (r.written && r.verified && durable) { okN++; logTo(logEl, '&nbsp;&nbsp;&#10003; <b>' + esc(label) + '</b> &rarr; ' + esc(destination) + ' — <b>Done</b>: durable Athena persistence was verified' + (r.method ? ' (' + esc(r.method) + ')' : '') + '.'); }
        else if (r.written || r.verified) { draftN++; logTo(logEl, '&nbsp;&nbsp;&#9888; <b>' + esc(label) + '</b> &rarr; ' + esc(destination) + ' — supervised draft placement reported, but no durable save/server verification was returned. Review it manually; not marked Done.'); }
        else { warnN++; logTo(logEl, '&nbsp;&nbsp;&#9888; ' + esc(label) + ' — ' + esc(r.error === 'target-not-on-open-chart' ? 'the field found was not on this patient’s chart' : (r.error || 'no matching field on this chart')) + ' (<b>NOT written</b>).'); }
      } else {
        if (r.found) { logTo(logEl, '&nbsp;&nbsp;&#127919; <b>' + esc(label) + '</b> — destination identified: ' + esc(r.fieldLabel || r.fieldTag || 'field') + '. Preview only, never sent.'); }
        else { logTo(logEl, '&nbsp;&nbsp;&#183; ' + esc(label) + ' — no destination field on this screen (preview kept here).'); }
      }
    }
    if (okN > 0 && draftN === 0 && warnN === 0) {
      logTo(logEl, '&#10003; <b>Done &mdash; ' + okN + ' section(s) durably verified on ' + esc(cName) + '.</b> ' + (athenaFinalActionsReady() ? 'Review in Athena, then Save/Sign there or via the Send-to-Athena review\'s confirmed actions.' : 'Review and sign in Athena; MLS never clicks Save/Sign.'));
    } else if (okN > 0) {
      logTo(logEl, '&#9888; <b>' + okN + ' section(s) durably verified.</b> ' + (draftN + warnN) + ' section(s) remain draft-only or blocked and need manual review.');
    } else if (execTotal > 0) {
      logTo(logEl, '&#9888; <b>No section is marked Done.</b> Athena returned no durable persistence/server verification. Any reported placement remains a supervised draft that you must check manually.');
    } else {
      logTo(logEl, 'Preview-only/manual destinations were kept in MLS. Nothing was sent.');
    }
  }

  /* -------------------- unified review from the panel ----------------------- */
  function receiptNoteSections(opts) {
    opts = opts || {};
    if (Array.isArray(opts.sections) && opts.sections.length) {
      return opts.sections.map(function (s) {
        var route = canonicalSectionKey(s && s.key);
        if (!route || !route.execute) return null;
        return { key: route.key, text: S(s.text).trim(), execute: true, destination: DESTINATION[route.key] };
      }).filter(function (s) { return s && s.text; });
    }
    var plan = Array.isArray(opts.plan) ? opts.plan : [];
    var note = null, route = null;
    for (var i = 0; i < plan.length; i++) {
      route = canonicalSectionKey(plan[i] && plan[i].kind);
      if (route && route.execute && (route.key === 'note' || route.key === 'procedure')) { note = plan[i]; break; }
      route = null;
    }
    var text = S(note && note.body);
    if (route && route.key === 'procedure') text = text.replace(/^\s*(?:PROCEDURE\s*\/\s*OPERATIVE NOTE|PROCEDURE NOTE|OPERATIVE NOTE|OP NOTE)\s*:\s*/i, '');
    else text = text.replace(/^\s*NOTE TEXT\s*:\s*/i, '');
    text = text.trim();
    if (!text) return [];
    /* The top receipt represents the complete generated encounter note. Send it
       through the driver's explicit encounter-note route; diagnosis, billing,
       orders, prescriptions, Save, and Sign remain independent actions. */
    var key = route && route.key === 'procedure' ? 'procedure' : 'note';
    return [{ key: key, text: text, execute: true, destination: DESTINATION[key] }];
  }
  function writeReceiptDrafts(opts) {
    opts = opts || {};
    var want = actionPatient(opts);
    var secs = receiptNoteSections(opts);
    if (!want.name || !want.dob) { actionSay(opts, 'Patient name and DOB are required before writing a draft. Nothing was sent.', 'err'); return Promise.resolve({ ok: false, error: 'incomplete-patient-identity' }); }
    if (!secs.length) { actionSay(opts, 'No generated clinical note is available to write. Nothing was sent.', 'err'); return Promise.resolve({ ok: false, error: 'no-note-draft' }); }
    STATE.writes++;
    actionSay(opts, 'Opening the immutable Athena destination review. The selected note will be checked against the exact patient and encounter read-only before one Confirm & write action can run.', '');
    var next = {};
    for (var k in opts) next[k] = opts[k];
    next.sections = secs;
    next.preferredAction = 'write_note';
    return openUnifiedConfirmation(next);
  }
  function panelManifestPlan(panel, gathered) {
    gathered = gathered || gatherSections(panel);
    var plan = [];
    for (var i = 0; i < gathered.held.length; i++) {
      var held = gathered.held[i] || {}, item = { kind: S(held.key).trim(), body: S(held.text).trim() };
      if (item.kind === 'billing') item.billing = normalizeBilling({ billingText: item.body });
      plan.push(item);
    }
    var blocked = gathered.blocked || [];
    for (var j = 0; j < blocked.length; j++) {
      var blockedKey = S(blocked[j] && blocked[j].key).trim() || 'unknown';
      plan.push({ kind: blockedKey,
        body: S(blocked[j] && blocked[j].text).trim(), duplicateOf: blocked[j] && blocked[j].duplicate ? blockedKey : '',
        duplicateSections: blocked[j] && blocked[j].duplicateSections ? stableClone(blocked[j].duplicateSections) : [],
        reason: S(blocked[j] && blocked[j].reason).trim() });
    }
    return plan;
  }
  function openPanelUnifiedConfirmation(panel, preferredAction) {
    var logEl = panel.querySelector('#emrWbLog'); if (!logEl) return;
    var gathered = gatherSections(panel);
    var plan = panelManifestPlan(panel, gathered), secs = gathered.sections;
    if (!secs.length && !plan.length) { logTo(logEl, 'Select at least one section to open the Athena destination review. Nothing was sent.'); return null; }
    var p = activePt() || {};
    /* The manifest identity gate requires the immutable LOCAL patient id as
       well; omitting it here made every panel-launched review show
       "Write reviewed note: BLOCKED" even for a fully identified patient. */
    var want = { patientId: S(p.id || ''), name: S(p.name), dob: S(p.dob), mrn: S(p.athenaId || p.mrn || '') };
    STATE.writes++;
    if (gathered.errors.length) logTo(logEl, '&#9940; <b>Blocked unknown route(s):</b> ' + esc(gathered.errors.join(', ')) + '. They are shown as BLOCKED in the unified review and can never cross the write bridge.');
    if (gathered.held.length) logTo(logEl, '&#128065; <b>Manual destinations:</b> ' + gathered.held.map(function(x){return esc(x.key) + ' &rarr; ' + esc(x.destination);}).join(' · ') + '. They remain visible but are never sent.');
    logTo(logEl, 'Opening the single Athena review for <b>' + esc(want.name || 'the selected patient') + '</b>. It freezes every selected payload, checks one exact destination read-only, and performs at most one typed action per Confirm &amp; write click.');
    return openUnifiedConfirmation({
      panel: panel, statusEl: logEl, patient: want, sections: secs, plan: plan,
      billing: currentBilling(panel, {}), preferredAction: preferredAction || 'write_note',
      receiptSessionId: S(panel.getAttribute('data-wf2-session'))
    });
  }
  function runV2(panel) {
    return openPanelUnifiedConfirmation(panel, 'write_note');
  }

  /* -------------------- panel takeover + copy cleanup ----------------------- */
  var SCRUB_RE = /Orders\s*[-—]\s*confirmed for your reference but never sent by MLS/i;
  function scrubLegacyCopy(logEl) {
    try {
      var kids = logEl.querySelectorAll('div');
      for (var i = 0; i < kids.length; i++) {
        if (SCRUB_RE.test(S(kids[i].textContent))) { kids[i].remove(); STATE.copyScrubbed++; }
      }
    } catch (e) {}
  }
  function enhancePanel(panel) {
    if (panel.getAttribute('data-wf2')) return;
    var btn = panel.querySelector('#emrWbAthena');
    var logEl = panel.querySelector('#emrWbLog');
    if (!btn || !logEl) return; /* b111 enhancement not there yet - retry on next tick */
    panel.setAttribute('data-wf2', '1');
    panel.setAttribute('data-wf2-session', 'wf2-panel-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    btn.textContent = 'Review selected Athena actions';
    btn.title = 'Open the one What → Where → How review for these selected sections. Nothing changes until one exact READY action passes its read-only check and you confirm it.';
    btn.setAttribute('data-mls-unified-write-review', '1');
    btn.onclick = function () { runV2(panel); };
    try {
      /* Older builds put a second disabled Save button and a competing block of
         capability copy beneath this launcher. The unified sheet is now the
         sole capability authority, so remove any stale copy and leave one
         contextual entry. Its rows state What, exact Where, How and Result. */
      var staleActions = panel.querySelector('#wf2AthenaActions');
      if (staleActions && staleActions.parentNode) staleActions.parentNode.removeChild(staleActions);
      var explain = document.createElement('div');
      explain.id = 'wf2AthenaGuide';
      explain.style.cssText = 'flex:1 0 100%;font-size:11.5px;line-height:1.45;color:#B9CEC2;margin-top:6px';
      explain.innerHTML = '<b>One review, one action at a time.</b> The next sheet shows What &rarr; exact Athena Where &rarr; How. READY items each require their own confirmation; MANUAL and BLOCKED items are never sent.';
      if (btn.parentNode) btn.parentNode.insertBefore(explain, btn.nextSibling);
    } catch (e0) {}
    try {
      var mo = new MutationObserver(function () { scrubLegacyCopy(logEl); });
      mo.observe(logEl, { childList: true, subtree: true });
    } catch (e) {}
    scrubLegacyCopy(logEl);
    try {
      panel.addEventListener('input', function () {
        var sign = panel.querySelector('#emrWbSign');
        if (sign) { sign.disabled = true; sign.title = 'Use the top Review Athena actions receipt for proof-gated signing.'; }
      });
    } catch (e1) {}
    addSuggestions(panel);
  }

  /* ------------------------- suggested orders chips ------------------------- */
  /* Generic keyword map over the note text - modality + body region. Nothing
     account- or provider-specific. Preview-only additions. */
  var MODS = [
    { re: /\bmri\b|magnetic resonance/i, label: 'MRI' },
    { re: /x-?ray|\bxr\b|radiograph/i, label: 'X-ray' },
    { re: /\bct\b|computed tomography/i, label: 'CT' },
    { re: /physical therapy|\bpt eval\b|therapy referral/i, label: 'Physical therapy referral' },
    { re: /injection|\besi\b|epidural|nerve block|\bmbb\b|\brfa\b/i, label: 'Injection procedure' },
    { re: /\blabs?\b|\bcbc\b|\bcmp\b|\ba1c\b|blood work/i, label: 'Labs' },
    { re: /\bemg\b|nerve conduction|\bncs\b/i, label: 'EMG/NCS' }
  ];
  var REGION = /(lumbar|cervical|thoracic|shoulder|knee|hip|wrist|ankle|elbow|foot|hand)(\s*spine)?/i;
  function suggestOrders(text) {
    var t = S(text);
    var out = [];
    var rg = REGION.exec(t);
    var region = rg ? rg[0].toLowerCase() : '';
    for (var i = 0; i < MODS.length && out.length < 5; i++) {
      if (MODS[i].re.test(t)) {
        var lbl = MODS[i].label;
        if (region && /MRI|X-ray|CT/.test(lbl)) lbl += ' ' + region;
        out.push(lbl);
      }
    }
    return out;
  }
  function noteText() {
    try { var n = document.getElementById('mls-note'); if (!n) return ''; return S(n.value != null ? n.value : n.textContent); } catch (e) { return ''; }
  }
  function addSuggestions(panel) {
    try {
      if (panel.querySelector('#wf2Suggest')) return;
      var ta = panel.querySelector('textarea[data-t="orders"]'); if (!ta) return;
      var src = noteText() + '\n' + (function () { var vals = []; panel.querySelectorAll('textarea[data-t]').forEach(function (t) { vals.push(t.value || ''); }); return vals.join('\n'); })();
      var sugg = suggestOrders(src);
      if (!sugg.length) return;
      var host = document.createElement('div');
      host.id = 'wf2Suggest';
      host.style.cssText = 'margin-top:6px;font:12px system-ui;color:#B9CEC2;display:flex;flex-wrap:wrap;gap:6px;align-items:center';
      host.appendChild(document.createTextNode('We suggest:'));
      sugg.forEach(function (lbl) {
        var chip = document.createElement('button');
        chip.type = 'button';
        chip.textContent = '+ ' + lbl;
        chip.style.cssText = 'background:rgba(52,82,214,.25);border:1px solid rgba(143,216,190,.45);color:#dfe7ff;border-radius:999px;padding:3px 10px;font:12px system-ui;cursor:pointer';
        chip.onclick = function () {
          var cur = S(ta.value).trim();
          if (cur.toLowerCase().indexOf(lbl.toLowerCase()) >= 0) { chip.disabled = true; return; }
          ta.value = (cur ? cur + '\n' : '') + lbl;
          try { ta.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {}
          var cb = panel.querySelector('input[data-k="orders"]');
          if (cb && !cb.checked) { cb.checked = true; try { cb.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
          chip.disabled = true; chip.style.opacity = '.55';
          STATE.suggestionsAdded++;
        };
        host.appendChild(chip);
      });
      ta.parentElement.appendChild(host);
      STATE.suggestionsShown += sugg.length;
    } catch (e) {}
  }

  /* ----------------------------- one-click write ---------------------------- */
  function ensureNoteContent() {
    var n = document.getElementById('mls-note'); if (!n) return false;
    var cur = S(n.value != null ? n.value : n.textContent).trim();
    /* Never manufacture a new current-visit note from old chart history merely
       because the user opened the Athena review. A draft must already exist
       from this visit's transcript/dictation and remain visible for review. */
    return !!cur;
  }
  function oneClick() {
    var p = activePt();
    if (!p || !p.name) { try { (window.toast||window.alert)('Pick a patient first.','err'); } catch (e) {} return; }
    if (!ensureNoteContent()) {
      try { (window.toast||window.alert)('Create or paste the current visit note first. MLS will not build an Athena draft from old chart history.','err'); } catch (e2) {}
      return;
    }
    STATE.oneClicks++;
    /* PULL: open the patient chart in athenaOne (background, identity-checked
       by the opener); the write's own identity gate re-verifies on the DOM. */
    try { window.postMessage({ type: 'mlsAppSearchOpenPatient', source: 'mls-app', name: S(p.name), dob: S(p.dob) }, '*'); } catch (e) {}
    /* PREVIEW: open the review-and-confirm panel (it organizes the note into
       sections on open) and pre-tick the content sections (order-class stays
       for the clinician to tick deliberately). */
    var b = document.getElementById('emrBtn'); if (b) b.click();
    setTimeout(function () {
      var panel = document.getElementById('emrPanel'); if (!panel) return;
      enhancePanel(panel);
      var boxes = panel.querySelectorAll('input[data-k]');
      for (var i = 0; i < boxes.length; i++) {
        var k = boxes[i].getAttribute('data-k');
        var route = canonicalSectionKey(k);
        if (!route || route.previewOnly) continue;
        var ta = panel.querySelector('textarea[data-t="' + k + '"]');
        if (ta && S(ta.value).trim() && !boxes[i].checked) { boxes[i].checked = true; try { boxes[i].dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {} }
      }
    }, 600);
  }
  function retireOneClickButton() {
    try { var old = document.getElementById('wf2OneClick'); if (old) old.remove(); } catch (e) {}
    try { window.__mlsLegacyAthenaShortcutRetired = true; } catch (e2) {}
  }

  /* --------------------------------- boot ----------------------------------- */
  var mo = null;
  function boot() {
    retireOneClickButton();
    try {
      mo = new MutationObserver(function () {
        if (stopped) return;
        retireOneClickButton();
        var p = document.getElementById('emrPanel');
        if (p) enhancePanel(p);
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    try { var p0 = document.getElementById('emrPanel'); if (p0) enhancePanel(p0); } catch (e) {}
  }
  function revert() {
    stopped = true;
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { var b = document.getElementById('wf2OneClick'); if (b) b.remove(); } catch (e) {}
    try { var a = document.getElementById('wf2AthenaActions'); if (a) a.remove(); } catch (e2) {}
    try { var g = document.getElementById('wf2AthenaGuide'); if (g) g.remove(); } catch (e3) {}
    closeUnifiedConfirmation();
    closeActionConfirm();
    window.__mlsWriteFlow.installed = false;
  }

  window.__mlsWriteFlow = {
    installed: true, version: VERSION, state: STATE,
    suggestOrders: suggestOrders, oneClick: oneClick, runV2: runV2,
    startAthenaAction: startAthenaAction, writeReceiptDrafts: writeReceiptDrafts,
    buildUnifiedManifest: buildUnifiedManifest, openUnifiedConfirmation: openUnifiedConfirmation, closeUnifiedConfirmation: closeUnifiedConfirmation,
    previewHash: hashPreview, normalizeBilling: normalizeBilling,
    canonicalSectionKey: canonicalSectionKey, parseGeneratedSoapSections: parseGeneratedSoapSections, parseCanonicalAthenaNote: parseCanonicalAthenaNote, destinations: DESTINATION,
    inspectSections: gatherSections,
    /* wfdx-1.0.0 / athena-probe-only-1.0.0 test + support seam (read-only) */
    diagnostics: { report: function () { return wfdxReport(unifiedAthenaState && unifiedAthenaState.manifest); },
      receipts: function () { return wfdx.receipts.slice(); }, envLine: function () { return wfdxEnvLine(unifiedAthenaState && unifiedAthenaState.manifest, wfdx.env); },
      reason: wfdxReason, errorClass: wfdxErrorClass, health: wfdxHealth,
      probeOnly: probeOnlyActive, probeOnlyBanner: PROBE_ONLY_BANNER,
      state: function () { return unifiedAthenaState; } },
    /* wfbind-1.0.0 test + support seam (read-only; run() is the same call the
       sheet's own control makes). */
    bindCure: { v: 'wfbind-1.0.0', label: WFBIND_LABEL,
      candidateDays: wfbindCandidateDays, curableRow: wfbindCurableRow,
      optsForDay: wfbindOptsForDay, resolvedOpts: wfbindResolvedOpts, pullBusy: wfbindPullBusy,
      run: function (day) { return wfbindRun(unifiedAthenaState, day, null); },
      /* wfx-1.0.0 write-fidelity seam (read-only, render-time, advisory) */
      fidelity: { v: 'wfx-1.0.0', facts: wfxFacts, factList: wfxFactList,
        contradictions: wfxContradictions, tally: wfxTally,
        stalenessLine: wfxStalenessLine, pulledAt: wfxPulledAt,
        evidenceHtml: function () { return unifiedAthenaState ? wfxEvidenceHtml(unifiedAthenaState) : ''; } },
      /* The visit-screen banner's cure uses this same navigate + confirm-day +
         pull; it owns its own definition of "bound" and its own wait. */
      pullDay: function (day, say) { return wfbindNavigateAndPull(day, say); },
      last: function () { return wfbindLast; } },
    revert: revert
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
