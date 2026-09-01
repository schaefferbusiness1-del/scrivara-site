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
  /* isodob-1.0.0: the installed MLS Assist parses the DOB it is handed with its
     OWN M/D/Y reader (background.js dateKey) and misreads an ISO date the same
     way this file used to - so an ISO-stored patient was refused
     'patient-mismatch' on the extension side as well, before anything was even
     compared against the chart. Hand it the one shape it can read.
     This is the SAME date, canonicalised - never a different one and never an
     invented one: a string nrmDob cannot read at all is passed through exactly
     as before, and the extension's own gates judge it exactly as before. The
     manifest, the preview hash and every row hash use the manifest's patient,
     not this object, so nothing hashed changes. */
  function bridgePatient(p) {
    p = p || {};
    var rawDob = S(p.dob).trim(), canonDob = nrmDob(rawDob);
    return { name: S(p.name).trim(), dob: canonDob || rawDob, mrn: S(p.mrn || p.athenaId || '').trim(), patientId: S(p.patientId || p.id || '').trim() };
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
  /* wfrep-1.0.0 (2026-08-28). A REFUSAL THE OFFICE COMPUTER SAYS BUT NEVER REPORTS.
   *
   * showActionConfirm's terminal refusals all did
   *     actionSay(opts, '<why>', 'err'); athenaActionRunning = false; return;
   * and no more. That is complete for a doctor standing at the desk - the
   * sentence is on his screen. It is silence for a doctor holding the phone:
   * the relay job is only ever finished from opts.onResult, so nothing came
   * back, and the phone sat there until its own watchdog gave up and blamed a
   * TIMEOUT. The five that matter most are the identity ones - "the Athena
   * chart does not match the saved patient identity" became "timed out", which
   * is not merely unhelpful, it points at the wrong problem entirely.
   *
   * refuseAction() says it, stands the action down, AND reports it. Reporting
   * is additive: only the phone relay path sets opts.onResult (runSendNote),
   * so a desk press behaves exactly as before, and no gate, guard or refusal
   * condition is changed by this - the refusal still refuses, it just arrives. */
  function refuseAction(action, opts, message) {
    actionSay(opts, message, 'err');
    athenaActionRunning = false;
    try {
      if (opts && typeof opts.onResult === 'function') {
        opts.onResult({ ok: false, error: message }, { action: action, context: null, verifiedWrite: null });
      }
    } catch (e) {}
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
    if (!actionToken) { return refuseAction(action, opts, 'Athena did not return a one-use confirmation token. Nothing was changed.'); }
    var orderRowHash = action === 'place_order' ? S((probe && probe.rowHash) || opts.rowHash || '').trim() : '';
    var orderClientId = action === 'place_order' ? S(payload && payload.order && payload.order.clientOrderId).trim() : '';
    if (action === 'place_order' && (!orderRowHash || !orderClientId || S(probe && probe.clientOrderId).trim() !== orderClientId)) {
      return refuseAction(action, opts, 'Athena did not return an exact order-row authorization binding. Nothing was changed.');
    }
    /* Imported patients do not always have an Athena MRN stored locally. The
       read-only probe must therefore report the chart MRN, which becomes the
       identity locked to this one-use confirmation. If an MRN was already
       stored locally, the observed chart must match it. */
    var athName = contextValue(ctx, ['patientName', 'name'], '');
    var athDob = contextValue(ctx, ['dob', 'patientDob'], '');
    var athMrn = contextValue(ctx, ['mrn', 'patientMrn', 'chartMrn'], '');
    if (!athName || !athDob || !athMrn || athName === '(not reported)' || athDob === '(not reported)' || athMrn === '(not reported)') {
      return refuseAction(action, opts, 'Athena did not report a complete chart identity (name, DOB, and MRN). Nothing was changed.');
    }
    if (!nameMatch(athName, patient.name) || nrmDob(athDob) !== nrmDob(patient.dob) || (patient.mrn && nrmId(athMrn) !== nrmId(patient.mrn))) {
      return refuseAction(action, opts, 'The Athena chart returned by the read-only check does not match the saved patient identity. Nothing was changed.');
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
      return refuseAction(action, opts, 'Athena did not report the exact encounter date, provider, ID, URL, and action control. Nothing was changed.');
    }
    var matchedWriteReceipt = action === 'sign_encounter' ? findVerifiedWrite(lockedPatient, previewHash, opts, payload, lockedContext) : null;
    if (action === 'sign_encounter' && (!matchedWriteReceipt || !matchedWriteReceipt.noteWriteProof)) {
      return refuseAction(action, opts, 'Sign & Save is still locked. This receipt does not have a verified write of this exact note to this exact Athena encounter. Write and verify the note first; no action was run.');
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
  function navigateAndSearchOpenTarget(patient, expectedContext) {
    var day = wfDayKey(expectedContext && expectedContext.visitDate);
    var appointmentId = S(expectedContext && expectedContext.appointmentId).trim();
    if (!day || !appointmentId) return Promise.resolve({ ok: false, opened: false, reason: 'appointment-navigation-unverified', error: 'The exact visit is not bound to a dated Athena appointment, so MLS will not open or guess an encounter.' });
    /* rowfirst-1.0.0 (measured live 2026-08-31): the Day-view drive's own
       recovery ladder can DESTROY a perfectly painted schedule (Home-drives on
       a slow renderer), after which the row hunt honestly finds nothing. The
       exact-id row click carries every identity gate itself - the landing
       surface must re-prove name, DOB and the frozen date, and the probe
       re-proves the banner - so it goes FIRST against whatever athenaOne
       already paints. Only when the row is not on the current grid does the
       day-drive run as the cure, exactly as before. */
    return searchOpenTarget(patient, expectedContext).then(function (firstTry) {
      firstTry = firstTry || {};
      wfdxNote({ verb: 'mlsAppSearchOpenPatient', stage: 'row-first', ok: firstTry.ok === true,
        reason: firstTry.reason || firstTry.findReason, error: firstTry.error, expectedDay: day, appointmentIdPresent: true });
      if (firstTry.ok === true) return firstTry;
      return navigateThenSearch();
    }, function () { return navigateThenSearch(); });
    function navigateThenSearch() {
    return bridge('mlsAppGotoDate', { date: day, deadlineAt: Date.now() + 60000 }, 'mlsAppGotoDateResult', 62000).then(function (nav) {
      nav = nav || {};
      var observed = wfDayKey(nav.schedDate);
      wfdxNote({ verb: 'mlsAppGotoDate', stage: 'auto-open', ok: nav.ok === true, timeout: nav.__timeout === true,
        reason: nav.reason, error: nav.error, expectedDay: day, observedDay: observed, appointmentIdPresent: true });
      /* dayfall-1.0.0 (measured live 2026-08-31): the Day-view drive is a
         navigation AID, not an identity gate - the open itself is an exact
         appointment-id row click that refuses ambiguity, and the landing
         surface must re-prove name, DOB and the frozen schedule date before
         anything is accepted (and the probe re-proves the banner after that).
         Under a heavy athenaOne renderer, mlsAppGotoDate times out or answers
         "calendar could not be reached" with NO observed day, and that spurious
         failure was terminal here - the row click never ran. Only a POSITIVELY
         different painted day may refuse this step. */
      if (observed && observed !== day) return { ok: false, opened: false, reason: 'appointment-navigation-unverified', error: 'athenaOne reported a different encounter day. Nothing was opened.' };
      return searchOpenTarget(patient, expectedContext);
    }, function () {
      return { ok: false, opened: false, reason: 'appointment-navigation-unverified', error: 'The exact encounter-day navigation could not be started. Nothing was opened.' };
    });
    }
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
  ('account-mismatch account-unverifiable already-on-file ambiguous ambiguous-athena-tabs appointment-id-ambiguous ' +
   'appointment-id-missing appointment-id-not-found appointment-navigation-snapshot-unavailable ' +
   'appointment-navigation-unverified athena-navigation-busy athena-page-changed bad-action ' +
   'billing-context-unverified billing-context-verified billing-duplicate-rejected billing-exact-match ' +
   'billing-existing-row-ambiguous billing-near-match-rejected billing-payload-mismatch blank-error ' +
   'bridge-error cancelled catalog-identity-required catalog-query-required ' +
   /* mrnadopt-1.0.0: the read-only chart-identity read has its own fixed
      outcomes; without them every adoption refusal printed as "unlisted". */
   'chart-dob-unreadable chart-identity-mismatch chart-mrn-absent chart-read-uncertain context-mismatch ' +
   'context-unverifiable context-unverified context-verified display-execute-day-mismatch dob-mismatch ' +
   'duplicate-session exact-chart-match exact-note-editor-verified-unsaved extension-error frame-coverage-unverified ' +
   'frame-generation-changed fresh-trusted-click-required goto-date-deadline-exceeded ' +
   'goto-date-relay-deadline-exceeded high-risk-order-blocked invalid-binding invalid-target-retry ' +
   'local-patient-id-required local-row-missing loopback-synthetic-only missing-order-fields missing-session ' +
   'mrn-adopted mrn-conflict name-not-found ' +
   'named-section-final-action-unsupported no-athena-tab no-chart-open no-name-match no-response no-results ' +
   'not-persisted not-watching ' +
   'note-content-required note-destination-mismatch note-editor-not-empty note-payload-mismatch ' +
   'note-section-count-mismatch note-section-payload-mismatch note-write-proof-expired note-write-proof-used ' +
   'note-write-unverified numeric-only-field-refused one-exact-order-isolated-readback-verified ' +
   'open-deadline-exceeded open-timeout order-client-id-mismatch order-exact-already-present ' +
   'order-existing-duplicate-rejected order-field-too-long order-id-required order-not-reviewed ' +
   'order-payload-incomplete order-payload-mismatch order-row-mismatch order-workspace-context-verified ' +
   'outcome-uncertain patient-changed patient-dob-unverifiable patient-mismatch patient-unverifiable practice-mismatch ' +
   'practice-unverifiable preview-hash-mismatch probe-frame-missing provider-mismatch provider-unverifiable rows-not-rendered ' +
   'schedule-date-missing-after-recovery schedule-date-restore-failed search-deadline-exceeded ' +
   'session-expired sign-prerequisite-mismatch store-refused store-unavailable synthetic-local-only ' +
   'taught-destination-binding-mismatch ' +
   'taught-destination-control-mismatch taught-destination-expired taught-destination-fingerprint-mismatch ' +
   'taught-destination-frame-mismatch taught-destination-invalid taught-destination-label-mismatch ' +
   'taught-destination-required taught-destination-selector-mismatch taught-destination-validated ' +
    'test-content-production-disabled timeout token-action-mismatch token-expired token-sender-mismatch token-state-unavailable ' +
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
    /* wfauto-1.0.0 sensor: a receipt is the only thing this file writes at the
       instant a POSITIVE refusal is decided, so the automatic re-check reads
       receipts rather than wording. Read-only with respect to everything here. */
    try { wfautoObserveReceipt(receipt); } catch (eWfAuto) {}
    return receipt;
  }
  function wfdxProbeReceipt(state, row, probe, stage) {
    var manifest = (state && state.manifest) || {}, visit = manifest.visit || {};
    /* wfauto-1.0.0 sensor: the raw answer of the last read-only ROW CHECK, with
       the probe generation it belongs to. That is the whole evidence base the
       automatic re-check is allowed to reason from. */
    try { wfautoRecordProbe(state, row, probe, stage); } catch (eWfAutoP) {}
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
    var expectedVisitReady = !!(expectedContext && wfDayKey(expectedContext.visitDate) && S(expectedContext.provider).trim() &&
      (S(expectedContext.appointmentId).trim() || (S(expectedContext.encounterId).trim() && S(expectedContext.encounterUrl).trim())));
    if (!expectedVisitReady) {
      actionSay(opts, 'This review is not bound to one exact Athena visit (date, provider, and appointment ID or encounter ID/URL). Re-pull or bind the scheduled day, then reopen the review. MLS will not guess an encounter and nothing was changed.', 'err');
      return Promise.resolve({ ok: false, error: opts.requireExpectedVisit ? 'historical-encounter-context-missing' : 'exact-encounter-context-missing' });
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
        return navigateAndSearchOpenTarget(patient, expectedContext).then(function (openRes) {
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
    /* mrnadopt-1.0.0 (owner 2026-08-27, "I hate how much is greyed out... it
       should be seamless and always work"): an identity block whose ONLY gap is
       the MRN is curable ON THIS SHEET, so it must not read like the generic
       three-factor refusal. The row still blocks - MLS Assist itself refuses a
       staged section write unless the app SUPPLIES name + DOB + MRN, so a READY
       row without a real MRN would only be refused at check time - but the Why
       sentence now names the one action that fixes it, and the adoption pass
       below performs that fix without the doctor typing anything. */
    var mrnOnlyIdentityBlock = identityBlocked && !!patient.patientId && !!patient.name && !!patient.dob;
    /* A write review may be current or historical, but both need an exact visit
       locator before the read-only Athena probe. Patient identity alone cannot
       distinguish two encounters for the same person; the schedule bind/re-pull
       supplies the independent date/provider/appointment evidence. */
    /* 2026-07-28: the LIVE lane painted a row READY that the extension's probe
       predicate could never accept. The pre-gate above only bound HISTORICAL
       writes, so a live review with no bound encounter showed a green READY row
       whose only possible outcome was a refusal at check time. Mirror the
       extension's own predicate here and say WHICH field is missing plus how to
       get it, instead of promising a write that cannot happen. */
    var visitReady = !!visit.visitDate && !!visit.provider &&
      (!!visit.appointmentId || (!!visit.encounterId && !!visit.encounterUrl));
    /* A current review must also name an independent visit locator before its
       read-only check. Patient identity alone cannot distinguish two encounters
       for the same patient; the schedule bind/re-pull path supplies the exact
       date, provider and appointment instead of adopting whatever is open. */
    var partialLiveVisitBlocked = opts.requireExpectedVisit !== true && !visitReady;
    var exactVisitBlocked = opts.requireExpectedVisit === true &&
      (!visit.visitDate || !visit.provider ||
        (!visit.appointmentId && !(visit.encounterId && visit.encounterUrl)));
    var partialLiveVisitReason = 'The exact visit needs its date, provider, and appointment ID (or a bound encounter ID and URL). MLS will not guess an encounter. Use “Bind this visit to its Athena appointment — re-pulls this day” to run the Athena schedule day pull; MLS then rebuilds this review from the exact appointment. Nothing is sent.';
    var exactVisitReason = 'The exact visit needs its date, provider, and appointment ID (or a bound encounter ID and URL). MLS will not guess an encounter.';
    var commonBlock = identityBlocked
      ? (mrnOnlyIdentityBlock ? mrnAdoptBlockReason(patient)
        : 'An immutable local patient ID plus the exact Athena name, DOB, and MRN are required. Nothing can be written.')
      : (partialLiveVisitBlocked ? partialLiveVisitReason : (exactVisitBlocked ? exactVisitReason : ''));
    /* Current and historical reviews both remain blocked until one exact visit
       is independently bound. Probe- and execute-time rebinding still enforce
       that frozen locator after the pre-gate. */
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
        /* ap-1.0.0 (measured 2026-08-26): some practices render ONE combined
           "Assessment & Plan" note area and no separate Assessment or Plan
           fields, so those two rows honestly refuse there. When the review
           holds exactly one assessment and one plan section, also offer the
           explicit combined destination - its own row, its own probe, its own
           confirmation, self-labelled payload. On surfaces WITH separate
           fields the doctor keeps using the separate rows; the read-only check
           tells the truth per surface either way. */
        var apAssessment = noteSectionCounts.assessment === 1 ? noteSections.filter(function (s) { return S(s && s.key).trim() === 'assessment' && S(s && s.text).trim(); })[0] : null;
        var apPlan = noteSectionCounts.plan === 1 ? noteSections.filter(function (s) { return S(s && s.key).trim() === 'plan' && S(s && s.text).trim(); })[0] : null;
        if (apAssessment && apPlan) {
          var apText = 'Assessment:\n' + S(apAssessment.text).trim() + '\n\nPlan / Follow-up:\n' + S(apPlan.text).trim();
          addRow({ id: 'write-note-assessment_and_plan', action: 'write_note', kind: 'assessment_and_plan',
            label: 'Write reviewed Assessment & Plan (combined)', destination: DESTINATION.assessment_and_plan,
            capability: commonBlock ? 'blocked' : 'ready', reason: commonBlock, consequence: ATHENA_ACTIONS.write_note.consequence,
            payload: { sections: [{ key: 'assessment_and_plan', text: apText, execute: true, destination: DESTINATION.assessment_and_plan }], noteText: apText, reviewText: apText, sectionKey: 'assessment_and_plan' },
            order: UNIFIED_ORDER.write_note + 0.9 });
        }
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
      patient: patient, visit: visit, requireExpectedVisit: opts.requireExpectedVisit === true, needsVisitDiscovery: false, rows: rows
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
  /* teachload-1.0.0: the teacher lives in feat_mls_show_assistant.js, appended
     by an idle-callback loader that can land seconds AFTER the review sheet
     rendered. A sheet built before it landed called the feature FAILED and
     wired nothing, so the button was dead until reopen. Resolve the teacher at
     CLICK time and nudge the loader on demand instead. */
  function ensureTeachingAsset() {
    try {
      var A = 'feat_mls_show_assistant.js';
      if (document.querySelector('script[data-mls-asset="' + A + '"]')) return;
      var s = document.createElement('script');
      s.src = A + '?v=20260718sa3'; s.setAttribute('data-mls-asset', A); s.async = true;
      (document.body || document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }
  function taughtDestinationFor(manifest, row) {
    var teacher = destinationTeacher();
    if (!teacher || typeof teacher.forRow !== 'function') return null;
    try { return teacher.forRow(manifest, row) || null; } catch (e) { return null; }
  }
  function teachStateFor(manifest, row) {
    var teacher = destinationTeacher();
    /* teachload-1.0.0: not-installed-yet is the ORDINARY case (the lazy asset
       lands after the sheet renders), not a failure - stop shouting FAILED. */
    if (!teacher || typeof teacher.statusFor !== 'function') return { state: 'idle', message: 'Optional. The teaching tools finish loading in the background - open the destination screen in athenaOne FIRST, then click Teach destination.' };
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
    /* bx-1.0.0: a truthy tick means a probe reached its success terminal -
       the batch driver waits on this settle latch (and on the recheck-button
       latch for refusals) instead of any timer heuristics. */
    try { if (rowId && unifiedAthenaState) unifiedAthenaState.probeSettled = unifiedAthenaState.probeGeneration; } catch (eBx) {}
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
    /* teachload-1.0.0: wire regardless of whether the lazy teacher landed yet;
       resolve it per click so a sheet opened early is not permanently dead. */
    if (!card) return;
    var starts = card.querySelectorAll('[data-mls-teach-start]');
    for (var i = 0; i < starts.length; i++) starts[i].addEventListener('click', function () {
      var row = unifiedRow(state.manifest, this.getAttribute('data-mls-teach-start')); if (!row || state.running || state.closed) return;
      var teacher = destinationTeacher();
      if (!teacher || typeof teacher.startForRow !== 'function') {
        ensureTeachingAsset();
        updateTeachingRow(state, row, { state: 'waiting', message: 'Loading the teaching tools now - a few seconds, then click Teach destination again.' });
        var tries = 0, tick = setInterval(function () {
          tries++; var t2 = destinationTeacher();
          if (t2 && typeof t2.startForRow === 'function') { clearInterval(tick); updateTeachingRow(state, row, { state: 'idle', message: 'Teaching tools are ready - click Teach destination again.' }); }
          else if (tries >= 24) { clearInterval(tick); updateTeachingRow(state, row, { state: 'failed', message: 'The teaching tools did not load in this tab. Reload the page and reopen this review to teach a destination.' }); }
        }, 250);
        return;
      }
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
      var teacher = destinationTeacher(); if (!teacher || typeof teacher.cancelForRow !== 'function') return;
      teacher.cancelForRow(state.manifest, row); invalidateUnifiedProbeForTeach(state); updateTeachingRow(state, row, { state: 'failed', message: 'Teaching was cancelled. Nothing changed.' });
    });
    var clears = card.querySelectorAll('[data-mls-teach-clear]');
    for (var xi = 0; xi < clears.length; xi++) clears[xi].addEventListener('click', function () {
      var row = unifiedRow(state.manifest, this.getAttribute('data-mls-teach-clear')); if (!row) return;
      var teacher = destinationTeacher(); if (!teacher || typeof teacher.clearForRow !== 'function') return;
      if (typeof teacher.cancelForRow === 'function') teacher.cancelForRow(state.manifest, row);
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
      /* wfauto-1.0.0: a closed sheet has no automatic re-check. The pending
         timer and its focus listeners go with it. */
      try { wfautoCancel(state); } catch (eWaC) {}
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
  /* sheetux-1.0.0 (owner 2026-08-27: "THIS WARNING MAKES IT LOOK LIKE ITS NOT
     GOING TO WORK THO"). THREE severities, not two. A refusal that names one
     step MLS can take itself is RECOVERABLE: it paints amber (attention), not
     error-red, and it brings the button that takes the step. Only a real
     conflict - identity mismatch, wrong chart, wrong day, missing write proof -
     stays red. Nothing about the honesty changes: every one of these still says
     that nothing was changed, because nothing was. */
  /* ===== sheetclar-1.0.0 (owner 2026-08-31: an Athena write must "actually
     work and be easy to do and understand") =================================
     The sheet's sentences were honest and DENSE. One paragraph carried the
     state, the act, the scope and the disclaimer in a single breath:

       "Ready - the exact chart is verified. One click on Confirm & Send runs
        only Write reviewed Procedure / operative note. Nothing else."

     A doctor between patients SCANS. So the honesty is RESTRUCTURED, never
     trimmed:

       - one BIG state word - CHECKING / READY / SENDING / NEEDS ONE STEP /
         CAN'T SEND / PARTLY DONE / DONE - with one short sentence under it;
       - the full sentence keeps every word it had, one disclosure below;
       - a REFUSAL opens that disclosure itself, so no refusal is ever folded
         away. #mlsAthenaUnifiedProbe still holds the exact same textContent
         it always did - every refusal pin reads that node unchanged.

     THE STATE WORD IS DERIVED FROM MEASURED STATE, NEVER FROM THE WORDING:
     is a write running, do the receipts say a section landed, is there a
     validated probe bound to the selected row. That is why not one line of
     the probe / execute / token / identity path had to change to get it -
     READY can only be painted by the very fact that enables Confirm. */
  function sheetclarInAthena(state) {
    var out = { total: 0, landed: 0 };
    try {
      state.manifest.rows.forEach(function (row) {
        if (row.action !== 'write_note') return;
        out.total++;
        var r = receiptStateForRow(state, row);
        if (r.status === 'verified' || r.status === 'already in Athena') out.landed++;
      });
    } catch (e) {}
    return out;
  }
  /* The SAME binding executeUnifiedSelection demands before it will write:
     a probe bound to this exact selected row, row hash and manifest hash.
     Nothing weaker may ever paint the word READY. */
  function sheetclarReadyRow(state) {
    var p = state.probe;
    if (!p || p.manifestHash !== state.manifest.manifestHash) return null;
    var row = unifiedRow(state.manifest, state.selectedRowId);
    return (row && p.rowId === row.id && p.rowHash === row.rowHash) ? row : null;
  }
  /* wfauto-1.0.0: the state line is where an automatic re-check narrates
     itself. The WORD is untouched - a refusal still reads NEEDS ONE STEP or
     CAN'T SEND - because the word says what the sheet's gates say; only the
     short sentence under it gains "...and MLS is re-checking by itself". */
  function sheetclarState(state, kind) {
    var out = sheetclarStateBase(state, kind);
    if (!out || WFAUTO_SKIP_LABELS[out.label] === 1) return out;
    var note = ''; try { note = wfautoNote(state); } catch (e) {}
    return note ? { label: out.label, color: out.color, short: out.short + note } : out;
  }
  function sheetclarStateBase(state, kind) {
    if (state.running || state.batchRunning) {
      return { label: 'SENDING', color: '#204034',
        short: 'MLS is writing the reviewed text into the exact Athena field. It never saves and never signs.' };
    }
    var n = sheetclarInAthena(state);
    /* owner 2026-08-31: after Done, Save / Sign must be unmissable as THE next
       manual step - it was one line inside a collapsed "final actions" drawer. */
    if (n.total && n.landed === n.total) {
      return { label: 'DONE', color: '#205c43',
        short: 'Now do the last step yourself in athenaOne: Save, then Sign. MLS never saves and never signs.' };
    }
    if (n.landed) {
      return { label: 'PARTLY DONE', color: '#6d5010',
        short: n.landed + ' of ' + n.total + ' note sections are in Athena; each of the rest keeps its own reason below. Save and Sign stay yours in athenaOne.' };
    }
    if (kind === 'fix') {
      return { label: 'NEEDS ONE STEP', color: '#7a5a16',
        short: 'Nothing was changed. One read-only step is named below - MLS can usually take it for you.' };
    }
    if (kind === 'err') {
      return { label: 'CAN’T SEND', color: '#8b2525',
        short: 'MLS refused and changed nothing in Athena. The exact reason is below.' };
    }
    var readyRow = sheetclarReadyRow(state);
    if (readyRow) {
      return { label: probeOnlyActive() ? 'READY (PROBE ONLY)' : 'READY', color: '#205c43',
        short: 'One click on Confirm & Send runs only ' + S(readyRow.label) + '. Nothing else' +
          (probeOnlyActive() ? ' - and in PROBE ONLY even that is rehearsed read-only, so nothing is written.' : ': no save, no signature, no billing, no orders.') };
    }
    return { label: 'CHECKING', color: '#6d5010',
      short: 'MLS is reading the exact Athena chart read-only. Nothing has been sent.' };
  }
  function paintSheetclarState(state, kind) {
    var host = null; try { host = document.getElementById('mlsAthenaUnifiedState'); } catch (e) { return; }
    if (!host || !state || state.closed) return;
    var s = sheetclarState(state, kind);
    try {
      host.setAttribute('data-mls-sheet-state', s.label);
      host.innerHTML = '<div data-mls-state-word="1" style="font-size:19px;line-height:1.2;font-weight:900;letter-spacing:.3px;color:' + s.color + '">' + esc(s.label) + '</div>' +
        '<div data-mls-state-short="1" style="margin-top:3px;color:#385b49;font-size:12.5px">' + esc(s.short) + '</div>';
    } catch (e2) {}
    /* A refusal is never folded away; anything else reads as one line plus a
       fold the doctor opens when he wants the whole sentence. */
    try {
      var det = document.getElementById('mlsAthenaUnifiedDetails');
      if (det) det.open = (kind === 'fix' || kind === 'err');
    } catch (e3) {}
  }
  /* ===== end sheetclar-1.0.0 state line ==================================== */
  function unifiedStatus(state, message, kind, behavior) {
    if (!state || state.closed) return;
    var el = null; try { el = document.getElementById('mlsAthenaUnifiedProbe'); } catch (e) {}
    if (el) {
      var isFix = kind === 'fix';
      el.style.color = kind === 'err' ? '#8b2525' : (kind === 'ok' ? '#205c43' : (isFix ? '#7a5a16' : '#6d5010'));
      el.style.border = isFix ? '1px solid #f0d79a' : '';
      el.style.background = isFix ? '#fff7e6' : '';
      el.style.borderRadius = isFix ? '9px' : '';
      el.style.padding = isFix ? '9px 11px' : '';
      try { el.setAttribute('data-mls-status-kind', isFix ? 'fix' : (S(kind) || 'info')); } catch (eKind) {}
      el.textContent = message;
    }
    /* wfauto-1.0.0: remember the severity this surface is currently painted at,
       so an automatic re-check can repaint the state line later WITHOUT
       inventing a severity of its own or touching this message. */
    try { state.wfautoLastKind = kind; } catch (eKind2) {}
    /* sheetclar-1.0.0: the scannable state word above the same honest sentence.
       It reads state, not this message, so it cannot contradict the gates. */
    try { paintSheetclarState(state, kind); } catch (eState) {}
    /* a recoverable step is neither a success nor a failure toast */
    actionSay(state.sourceOpts, message, kind === 'fix' ? '' : kind, behavior);
  }
  function unifiedRecheckButton(state, rowId) {
    /* wf2-1.9.0: read-only re-probe on demand; the button lives inside the
       status line and is wiped by the next unifiedStatus repaint. */
    if (!state || state.closed) return;
    /* bx-1.0.0: every settled probe refusal offers this button, so it doubles
       as the refusal settle latch the batch driver waits on. */
    try { state.probeSettled = state.probeGeneration; } catch (eBx) {}
    /* wfprog-1.1.0: a settled refusal dismisses the pre-write progress; the
       amber or red status line and the fix strip carry the outcome. A run that
       already holds write verdicts keeps its surface. */
    try { wfprogClearPre(state); } catch (ePr) {}
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
    /* sheetux-1.0.0: a settled refusal is also the moment the merged primary
       button becomes the doctor's next move again. */
    try { unifiedSyncPrimaryButton(state); } catch (eSync) {}
    /* wfauto-1.0.0: ...and it is the exact moment the AUTOMATIC cycle stopped.
       If the evidence says the surface is simply not ready YET, keep pressing
       this same read-only re-check on a bounded backoff instead of waiting for
       a human. A positive refusal never reaches here armed. */
    try { wfautoOnSettled(state, rowId); } catch (eAuto) {}
  }
  /* sheetux-1.0.0 RECOVERABLE REFUSALS. The message names one step; this puts
     that step on a button and takes it for the doctor. Everything the control
     can do is READ-ONLY - athenaOne's own Day view, its own appointment row,
     and the existing read-only re-check. It never writes, and it never retries
     a write: a write outcome is never recoverable by construction. */
  var SHEETUX_DOIT_LABEL = 'Open it and re-check';
  var SHEETUX_DOIT_TITLE = 'Do it for me. Read-only: sends athenaOne\'s own Day view to this encounter\'s date, clicks this exact appointment row, then re-runs the read-only check. Nothing is written.';
  function unifiedRecoveryButton(state, rowId, label, title, run) {
    if (!state || state.closed || typeof run !== 'function') return;
    var el = null; try { el = document.getElementById('mlsAthenaUnifiedProbe'); } catch (e) { return; }
    if (!el) return;
    try {
      if (document.getElementById('mlsAthenaUnifiedDoIt')) return;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'mlsAthenaUnifiedDoIt';
      btn.textContent = S(label) || SHEETUX_DOIT_LABEL; btn.title = S(title);
      btn.setAttribute('data-mls-recover-row', S(rowId));
      btn.style.cssText = 'display:block;margin-top:7px;border:1px solid #d8a93a;background:#fff3d6;color:#6d5010;border-radius:8px;padding:7px 13px;font:800 12px inherit;cursor:pointer';
      btn.addEventListener('click', function () { run(btn); });
      el.appendChild(btn);
    } catch (e2) {}
  }
  function unifiedRecoverableStatus(state, rowId, message, run) {
    unifiedStatus(state, message, 'fix');
    /* wfgen-1.0.0 (2026-09-01): THIS IS THE SECOND SETTLE LATCH, and it was the
       only terminal that never wrote it. unifiedRecheckButton latches
       probeSettled; wfClarityRefusal reaches that latch because it calls the
       button afterwards. But wfdxOpenEncounter's own ladder refusals - "one
       step needed: athenaOne's Day view has to be on <day>", "this exact
       appointment row is not on the grid", "the read-only open did not start" -
       land HERE and nowhere else. A queued send (bx-1.0.0's checked-section
       queue, opbatch-1.0.0's op-note queue) waits on
       `probeSettled === probeGeneration && !probe`, so an unlatched terminal
       made the queue burn its whole 150s read-only bound and then report the
       WRONG sentence ("ran past the 150-second bound and was left alone")
       instead of the honest step the sheet had already printed on screen.
       That refusal is the COMMON case for any patient whose chart is not
       already open - i.e. everyone except the one the doctor is looking at.
       This records that this probe generation has answered. It cannot enable a
       row, mint a token or make anything sendable: every reader additionally
       requires `!state.probe`, and the probe lock is untouched. */
    try { state.probeSettled = state.probeGeneration; } catch (eSettle) {}
    unifiedRecoveryButton(state, rowId, SHEETUX_DOIT_LABEL, SHEETUX_DOIT_TITLE, run);
    /* wfauto-1.0.0: the amber "one step" refusals are the ones the doctor most
       often clears by hand in athenaOne. This latch is the second place the
       automatic cycle stops, so it arms the same bounded read-only re-check. */
    try { wfautoOnSettled(state, rowId); } catch (eAuto) {}
  }
  function unifiedOpenDayRecovery(state, rowId) {
    return function (btn) {
      if (!state || state.closed || unifiedAthenaState !== state || state.running) return;
      /* the named step, taken by MLS: Day view -> this exact appointment row ->
         the existing read-only re-check (wfdxOpenEncounter re-runs the probe
         itself once the chart is open). One press, one attempt. */
      wfdxOpenEncounter(state, rowId, btn, false);
    };
  }
  /* ===== wfauto-1.0.0 (owner 2026-08-31: "writes need to be even more
     seamless and work every time") ==========================================
     THE SEAM THIS CLOSES, MEASURED LIVE. When athenaOne sits on the dashboard
     the sheet probes, says so honestly, drives the read-only open (rowfirst
     ladder) and paces its re-probes (openpace-1.0.0: 12s settle, then up to
     4 x 15s). In several live runs the encounter finished painting a few
     seconds AFTER that budget ran out, so the automatic cycle stopped ONE HOP
     SHORT of READY and sat there waiting for a human press of "Check Athena
     again" on a surface that was already fine.

     THE TERMINAL STATES THAT STOP THE SHIPPED CHAIN (all measured in source):
       T1 the openpace budget is exhausted while the open is still fresh - the
          frame-missing tail prints "To unlock: ... press Check Athena again".
       T2 the procedure-section read-only probe answers "not on screen" -
          amber + Check Athena again.
       T3 wfdxOpenEncounter's own ladder refuses (this exact row is not on the
          painted grid, the open did not start, the Day view could not be
          re-proven) - amber + "Open it and re-check".
       T4 the one-per-review auto-open could not open the chart - red + Check
          Athena again.
       T5 any WFCLAR fix-class refusal (no-chart-open, rows-not-rendered,
          timeout, open-timeout, appointment-id-not-found, unresolved-after-
          pull, note-editor-not-empty, ...) - amber + Check Athena again. The
          doctor usually fixes these BY HAND and then has to REMEMBER to press
          the button.
     Every one of them ends in unifiedRecheckButton() or
     unifiedRecoverableStatus() - the two settle latches - which is why this
     module hooks THERE and nowhere inside the probe / execute / token /
     identity path. Not one byte of that path changes. This module cannot make
     a row sendable, cannot mint a token, cannot enable Confirm and cannot
     write: all it can do is press the SAME read-only re-check the doctor would
     have pressed, on a bounded backoff, and say so out loud in the state line.

     WHAT IT WILL NEVER DO. Arming is a CLOSED ALLOWLIST of refusal codes
     (WFAUTO_RETRY). A POSITIVE refusal - wrong patient, wrong DOB/MRN, wrong
     day, a provider / practice / account conflict, a token or payload refusal,
     an expired athenaOne session, no athenaOne tab at all - is not on it, and
     any such receipt ALSO sets a sticky latch that disarms this module for the
     life of the sheet. A probe that came back ok:true and was then refused by
     MLS's own gates (identity lock, display-vs-execute day, sign proof, order
     binding) is positive by construction and latches too. Nothing here ever
     re-drives navigation (openpace measured that re-driving a painting
     encounter DESTROYS it), ever presses an execute path, and it is inert
     while a write, a batch, a rebuild or a rehearsal is in flight. */
  var WFAUTO_RETRY = {
    'context-unverified': 1, 'context-mismatch': 1, 'probe-frame-missing': 1, 'no-chart-open': 1,
    'rows-not-rendered': 1, 'athena-navigation-busy': 1, 'timeout': 1, 'open-timeout': 1,
    'appointment-id-not-found': 1, 'unresolved-after-pull': 1, 'appointment-id-missing': 1,
    'ambiguous-athena-tabs': 1, 'note-editor-not-empty': 1, 'no-response': 1
  };
  /* The subset that means "the surface MLS just opened has not finished
     painting YET". These get the paced backoff measured from the open itself. */
  var WFAUTO_PAINT = {
    'context-unverified': 1, 'context-mismatch': 1, 'probe-frame-missing': 1, 'no-chart-open': 1,
    'rows-not-rendered': 1, 'athena-navigation-busy': 1, 'timeout': 1, 'open-timeout': 1,
    'appointment-id-not-found': 1, 'unresolved-after-pull': 1
  };
  /* DEFENCE IN DEPTH ONLY - WFAUTO_RETRY above is the gate that decides. These
     are the codes that additionally LATCH the sheet out of automatic
     re-checking for good, however they arrive. */
  var WFAUTO_POSITIVE = {
    'patient-mismatch': 1, 'dob-mismatch': 1, 'mrn-conflict': 1, 'chart-identity-mismatch': 1,
    'provider-mismatch': 1, 'practice-mismatch': 1, 'account-mismatch': 1, 'session-expired': 1,
    'no-athena-tab': 1, 'display-execute-day-mismatch': 1, 'note-destination-mismatch': 1,
    'note-payload-mismatch': 1, 'note-section-payload-mismatch': 1, 'note-section-count-mismatch': 1,
    'preview-hash-mismatch': 1, 'verified-note-write-required': 1, 'sign-prerequisite-mismatch': 1,
    'unsafe-note-policy': 1, 'unknown-note-section': 1, 'write-safety-final-action-blocked': 1,
    'write-safety-guard-missing': 1
  };
  /* Backoff chosen so the whole automatic stretch fits inside the owner's
     three-minute bound: 9 + 18 + 30 + 45 + 60 = 162s of waiting across five
     re-probes, and the deadline clips the last one. */
  var WFAUTO_BACKOFF_MS = [9000, 18000, 30000, 45000, 60000, 60000];
  var WFAUTO_IDLE_MS = 20000;          /* owner: "or ~20s elapse" */
  var WFAUTO_WINDOW_MS = 180000;       /* owner: "e.g. 3 minutes from open" */
  var WFAUTO_OPEN_FRESH_MS = 180000;
  var WFAUTO_WAKE_DEBOUNCE_MS = 5000;
  var WFAUTO_MAX_PAINT = 5;
  var WFAUTO_MAX_SETTLED = 3;          /* owner: "max a few automatic re-probes" */
  var WFAUTO_SKIP_LABELS = { SENDING: 1, DONE: 1, READY: 1, 'READY (PROBE ONLY)': 1 };
  var wfautoOff = false;
  function wfautoClearTimer(state) {
    var a = state && state.wfauto;
    if (a && a.timer) { try { clearTimeout(a.timer); } catch (e) {} a.timer = null; }
  }
  function wfautoUnwatch(state) {
    var a = state && state.wfauto;
    if (!a || !a.watching) return;
    a.watching = false;
    try { document.removeEventListener('visibilitychange', a.onWake, false); } catch (e) {}
    try { window.removeEventListener('focus', a.onWake, false); } catch (e2) {}
  }
  function wfautoCancel(state) {
    var a = state && state.wfauto;
    if (!a) return;
    wfautoClearTimer(state); wfautoUnwatch(state);
    a.armed = false; a.nextAt = 0;
  }
  /* A positive refusal ends the automatic cycle permanently for this sheet.
     Nothing clears this latch except closing and reopening the review. */
  function wfautoLatchPositive(state, code) {
    if (!state) return;
    if (!state.wfautoPositive) state.wfautoPositive = S(code) || 'positive';
    wfautoCancel(state);
  }
  /* Every wfdxNote receipt passes through here. 'identity-lock' and
     'target-diff' are the only two stages the pinned probe path uses to
     announce that it refused on identity or on a display-vs-execute day
     conflict, so they are read as receipts rather than as wording. */
  function wfautoObserveReceipt(receipt) {
    var state = unifiedAthenaState;
    if (!state || state.closed || !receipt) return;
    if (receipt.stage === 'identity-lock' || receipt.stage === 'target-diff') { wfautoLatchPositive(state, receipt.reason || receipt.stage); return; }
    if (WFAUTO_POSITIVE[S(receipt.reason)] === 1) wfautoLatchPositive(state, receipt.reason);
  }
  /* The evidence the whole module runs on: what the LAST read-only row check
     actually answered, in which probe generation. A null / timed-out probe is
     recorded as 'timeout' - the same code WFCLAR gives it. */
  function wfautoRecordProbe(state, row, probe, stage) {
    if (!state || stage !== 'row-check') return;
    var code = S(probe && probe.reason).trim();
    if (!probe || probe.__timeout === true) code = 'timeout';
    state.wfautoProbe = { generation: state.probeGeneration, rowId: S(row && row.id),
      ok: !!(probe && probe.ok === true), code: code, at: Date.now() };
  }
  /* RETRYABLE-BY-EVIDENCE, decided from measured state only. */
  function wfautoEligible(state) {
    if (wfautoOff || !state || state.closed || unifiedAthenaState !== state) return null;
    if (state.running || state.batchRunning || state.generating || state.binding || state.halted) return null;
    if (state.wfautoPositive) return null;
    var last = state.wfautoProbe;
    if (!last || last.generation !== state.probeGeneration) return null;
    if (last.ok === true) return null;
    if (WFAUTO_RETRY[last.code] !== 1) return null;
    if (sheetclarReadyRow(state)) return null;
    var openedAt = Number(state.openedOkAt) || 0;
    var painting = WFAUTO_PAINT[last.code] === 1 && openedAt > 0 && (Date.now() - openedAt) <= WFAUTO_OPEN_FRESH_MS;
    return { rowId: last.rowId, code: last.code, painting: painting, openedAt: openedAt };
  }
  function wfautoRepaint(state) {
    try { paintSheetclarState(state, state.wfautoLastKind); } catch (e) {}
  }
  function wfautoWatch(state) {
    var a = state.wfauto;
    if (a.watching) return;
    a.onWake = function () { wfautoWake(state); };
    try { document.addEventListener('visibilitychange', a.onWake, false); a.watching = true; } catch (e) {}
    try { window.addEventListener('focus', a.onWake, false); a.watching = true; } catch (e2) {}
  }
  /* The doctor went to athenaOne, fixed it by hand, and came back. That return
     IS the press of "Check Athena again" - so take it for him, read-only. */
  function wfautoWake(state) {
    var a = state && state.wfauto;
    if (!a || !a.armed) return;
    try { if (document.visibilityState === 'hidden') return; } catch (e) {}
    if (Date.now() - Number(a.lastProbeAt || 0) < WFAUTO_WAKE_DEBOUNCE_MS) return;
    wfautoFire(state, state.probeGeneration, a.rowId);
  }
  function wfautoArm(state, wait, mode) {
    var a = state.wfauto;
    wfautoClearTimer(state);
    a.armed = true; a.mode = mode; a.waitMs = wait; a.nextAt = Date.now() + wait;
    a.exhausted = false; a.armedGeneration = state.probeGeneration;
    var gen = state.probeGeneration, rowId = a.rowId;
    try { a.timer = setTimeout(function () { wfautoFire(state, gen, rowId); }, wait); } catch (e) { a.timer = null; }
    wfautoWatch(state);
    wfautoRepaint(state);
  }
  function wfautoStop(state, exhausted) {
    var a = state && state.wfauto;
    wfautoCancel(state);
    if (a && exhausted) { a.exhausted = true; wfautoRepaint(state); }
    return false;
  }
  /* THE ONE ARMING POINT. Called from the two settle latches, i.e. at exactly
     the moment the shipped chain gave up and a human press became necessary. */
  function wfautoOnSettled(state, rowId) {
    var why = wfautoEligible(state);
    if (!why) return wfautoStop(state, false);
    var a = state.wfauto, now = Date.now();
    /* One cycle per uninterrupted stretch of refusals. A successful open that
       is NEWER than the cycle re-earns the window, because what the sheet is
       waiting on is genuinely new. */
    if (!a || (why.openedAt && why.openedAt > a.startedAt)) {
      /* tear the old cycle down FIRST - its timer and its two wake listeners
         belong to a window that is over. */
      wfautoCancel(state);
      a = state.wfauto = { cycle: (a ? a.cycle : 0) + 1, startedAt: (why.openedAt || now),
        tries: 0, settledTries: 0, timer: null, armed: false, armedGeneration: -1, watching: false,
        onWake: null, rowId: '', code: '', mode: '', waitMs: 0, nextAt: 0,
        exhausted: false, lastProbeAt: now };
    }
    /* wfClarityRefusal calls BOTH latches for one refusal - the second call
       must not restart the clock the first one set. */
    if (a.armed && a.armedGeneration === state.probeGeneration && a.rowId === S(rowId || why.rowId)) return true;
    a.rowId = S(rowId) || why.rowId; a.code = why.code; a.painting = why.painting;
    var deadline = a.startedAt + WFAUTO_WINDOW_MS;
    if (why.painting) {
      if (a.tries >= WFAUTO_MAX_PAINT || now >= deadline) return wfautoStop(state, true);
      var wait = WFAUTO_BACKOFF_MS[Math.min(a.tries, WFAUTO_BACKOFF_MS.length - 1)];
      if (now + wait > deadline) wait = Math.max(1000, deadline - now);
      wfautoArm(state, wait, 'paint');
      return true;
    }
    if (a.settledTries >= WFAUTO_MAX_SETTLED) return wfautoStop(state, true);
    wfautoArm(state, WFAUTO_IDLE_MS, 'settled');
    return true;
  }
  function wfautoFire(state, gen, rowId) {
    var a = state && state.wfauto;
    if (!a) return false;
    a.timer = null;
    if (!state || state.closed || unifiedAthenaState !== state || state.probeGeneration !== gen) return wfautoStop(state, false);
    var why = wfautoEligible(state);
    if (!why) return wfautoStop(state, false);
    if (a.mode === 'paint' && Date.now() >= a.startedAt + WFAUTO_WINDOW_MS) return wfautoStop(state, true);
    if (a.mode === 'paint') a.tries += 1; else a.settledTries += 1;
    a.armed = false; a.nextAt = 0;
    wfautoClearTimer(state); wfautoUnwatch(state);
    a.lastProbeAt = Date.now();
    /* openpace-1.0.0 AUDIT (deliberate, and the only existing field this module
       writes): while the open MLS just made is still fresh the encounter is
       LOADING, and re-driving navigation into it destroys it - measured live.
       state.autoOpenAt is precisely the throttle that suppresses that re-drive,
       and an open that succeeded moments ago IS the recent open it exists to
       debounce. Stamping it keeps exactly ONE owner of the retry timing (this
       cycle) instead of two fighting over the same surface. This module never
       opens or navigates anything itself. */
    if (why.painting) state.autoOpenAt = Date.now();
    wfautoRepaint(state);
    probeUnifiedRow(state, rowId);
    return true;
  }
  /* The narration, and the ONLY surface this module paints. It is appended to
     the sheetclar-1.0.0 state line's short sentence; #mlsAthenaUnifiedProbe
     keeps the refusal's exact textContent, and the disclosure stays forced
     open, so no refusal is ever softened or folded away by an auto re-check. */
  function wfautoNote(state) {
    var a = state && state.wfauto;
    if (!a || wfautoOff) return '';
    if (a.exhausted) {
      return ' MLS re-checked Athena by itself for three minutes and it still refused, so it stopped rather than loop: this one needs you. Fix the step named here, then press Check Athena again.';
    }
    if (!a.armed) return '';
    var secs = Math.max(1, Math.round((Number(a.nextAt) - Date.now()) / 1000));
    return a.mode === 'paint'
      ? ' athenaOne is still painting the encounter - MLS is re-checking automatically in about ' + secs + 's (' + (a.tries + 1) + ' of ' + WFAUTO_MAX_PAINT + '). Nothing was changed.'
      : ' MLS will check Athena again by itself in about ' + secs + 's, and the moment you come back to this tab - or press Check Athena again yourself. Nothing was changed.';
  }
  /* ===== end wfauto-1.0.0 ================================================== */
  /* ===== wfclar-1.0.0 (owner 2026-08-27: "not so many things that say
     blocked", "ALSO THE OP NOTES WRITE SHOULD WORK TOO") ====================
     MEASURED against MLS Assist 3.0.84: a refused read-only probe is
     `{ ok:false, blocked:true, reason:<code> }` and a whole family of them
     carries NO English sentence at all - noteEditorNotEmptyReceipt() in
     background.js returns reason only. The sheet printed
     `probe.error || probe.message || probe.reason`, so the doctor read the
     literal token "note-editor-not-empty" in error red under a Check-Athena-
     again button that would refuse identically forever.

     That is the OP-NOTE path's guaranteed ending. An op note is routed to
     "Athena encounter > Physical Exam > Procedure Documentation", and that
     editor only exists once the procedure template has been added - which
     fills it with the template's own skeleton. notePolicy stays 'empty_only'
     (MLS must never type over text a human or a template put there), so the
     op-note probe refuses with that bare token every single time.

     This table changes WHAT THE DOCTOR READS, and nothing else. It cannot
     change whether a probe refused, cannot enable a button, and cannot make a
     row sendable: every branch below returns without a probe lock, exactly as
     the raw-token branch did. It sorts the refusal into the two severities the
     sheet already knows:
       fix:true  - ONE step, named in plain words. Amber, plus the controls
                   that take or support that step. Still refused, still
                   "nothing was sent".
       fix:false - a real conflict (wrong patient, wrong chart, wrong day,
                   missing write proof, a payload that no longer matches the
                   reviewed one). Stays error-red and gets NO shortcut.
     A code that is not in this table keeps the exact behaviour it had. */
  var WFCLAR_NOTHING = ' Nothing was changed and nothing was sent.';
  var WFCLAR = {
    /* ---- one named step (amber) ------------------------------------- */
    'note-editor-not-empty': { fix: true, copy: true,
      say: 'One step needed: {where} already has text in it. MLS never types over text a person or an Athena template put there - for an op note that text is usually the procedure template skeleton. Clear that field in athenaOne (or keep what is already documented there), then press Check Athena again. Copy this section below if you would rather paste it yourself.' },
    'no-athena-tab': { fix: true,
      say: 'One step needed: no signed-in athenaOne tab is open. Open athenaOne and sign in, then press Check Athena again.' },
    'no-chart-open': { fix: true, open: true,
      say: 'One step needed: athenaOne has no chart open. MLS can open this exact encounter read-only, or open it yourself and press Check Athena again.' },
    'ambiguous-athena-tabs': { fix: true,
      say: 'One step needed: more than one signed-in athenaOne tab is open and MLS will not guess which one holds this encounter. Close all but the tab with this patient, then press Check Athena again.' },
    'probe-frame-missing': { fix: true, open: true,
      say: 'One step needed: athenaOne has no open encounter frame for this visit yet. MLS can open it read-only, or open the visit yourself and press Check Athena again.' },
    'athena-navigation-busy': { fix: true,
      say: 'One step needed: athenaOne is still finishing another read-only MLS navigation. Let it settle, then press Check Athena again.' },
    'rows-not-rendered': { fix: true, open: true,
      say: 'One step needed: athenaOne has not painted its schedule rows yet. MLS can send its Day view there again read-only, or click the athenaOne tab once so it can paint and press Check Athena again.' },
    'session-expired': { fix: true,
      say: 'One step needed: your athenaOne session expired. Sign in again in athenaOne, then press Check Athena again.' },
    'appointment-id-missing': { fix: true, open: true,
      say: 'One step needed: this review has no exact Athena appointment bound yet. Use the bind control above to re-pull this day, or open the encounter in athenaOne and press Check Athena again.' },
    'appointment-id-not-found': { fix: true, open: true,
      say: 'One step needed: athenaOne has not painted this exact appointment row on the day it is showing. MLS can send the Day view there and open the row read-only, or open the encounter yourself and press Check Athena again.' },
    'unresolved-after-pull': { fix: true, open: true,
      say: 'One step needed: the day pull finished without naming this exact appointment. MLS can try the read-only open again, or open the encounter in athenaOne and press Check Athena again.' },
    'timeout': { fix: true,
      say: 'One step needed: athenaOne did not answer the read-only check in time. If its tab is behind other windows, click it once so it can paint, then press Check Athena again.' },
    'open-timeout': { fix: true, open: true,
      say: 'One step needed: athenaOne did not finish opening the chart in time. MLS can try the read-only open again, or open it yourself and press Check Athena again.' },
    'no-response': { fix: true,
      say: 'One step needed: MLS Assist did not answer the read-only check. Reload MLS Assist at chrome://extensions, make sure athenaOne is open and signed in, then press Check Athena again.' },
    /* ---- a real conflict (red, no shortcut) ------------------------- */
    'patient-mismatch': { fix: false,
      say: 'The chart athenaOne has open is not this patient. MLS will not write into it and there is no shortcut past this. Open the correct chart yourself, then press Check Athena again.' },
    'dob-mismatch': { fix: false,
      say: 'The date of birth in the open Athena chart does not match this reviewed patient. MLS will not write into a chart whose identity disagrees with the note.' },
    'mrn-conflict': { fix: false,
      say: 'The MRN in the open Athena chart conflicts with the one on this reviewed patient. MLS will not resolve an identity conflict for you.' },
    'chart-identity-mismatch': { fix: false,
      say: 'The identity Athena reported for the open chart does not match this reviewed patient. MLS will not write into it.' },
    'provider-mismatch': { fix: false,
      say: 'The provider on the open Athena encounter is not the provider this review was built for. MLS will not retarget a note to a different clinician.' },
    'practice-mismatch': { fix: false,
      say: 'The open athenaOne practice is not the one this review was built for. MLS will not write across practices.' },
    'account-mismatch': { fix: false,
      say: 'The signed-in athenaOne account is not the one this review was built for. MLS will not write from a different account.' },
    'note-destination-mismatch': { fix: false,
      say: 'Athena resolved a different destination than the one shown on this row. MLS will not write a section into a field it is not showing you.' },
    'note-payload-mismatch': { fix: false,
      say: 'The text Athena was asked to place is not the reviewed text of this row. MLS will not send a payload the review did not freeze.' },
    'note-section-payload-mismatch': { fix: false,
      say: 'The section payload Athena checked is not the one this row froze at review time. MLS will not send it.' },
    'note-section-count-mismatch': { fix: false,
      say: 'Athena checked a different number of sections than this row froze at review time. MLS will not send it.' },
    'preview-hash-mismatch': { fix: false,
      say: 'This review changed after its immutable hash was minted. Close it and open Send to Athena again; MLS will not send an altered review.' },
    'verified-note-write-required': { fix: false,
      say: 'This action needs a verified note write for this exact encounter first. MLS will not run it out of order.' },
    'sign-prerequisite-mismatch': { fix: false,
      say: 'The verified write proof does not belong to this exact encounter, so Sign & Save stays locked. MLS will not sign on an unmatched proof.' },
    'unsafe-note-policy': { fix: false,
      say: 'Only empty-field placement is allowed, and this request did not carry it. MLS refused before touching Athena.' },
    'unknown-note-section': { fix: false,
      say: 'MLS Assist does not recognise this destination, so it refused before touching Athena. Update MLS Assist from Settings > Get the extension and reload it, then open this review again.' },
    'write-safety-final-action-blocked': { fix: false,
      say: 'The write-safety guard in MLS Assist blocked this final action. MLS will not work around its own guard.' },
    'write-safety-guard-missing': { fix: false,
      say: 'The write-safety guard is not loaded in MLS Assist, so no write may run. Reload MLS Assist at chrome://extensions, then open this review again.' }
  };
  function wfClarify(reason) {
    var code = wfdxReason(reason);
    return (code && WFCLAR[code]) ? WFCLAR[code] : null;
  }
  function wfClarityText(clar, row) {
    return S(clar && clar.say).replace('{where}', S(row && row.destination) || 'the exact Athena field') + WFCLAR_NOTHING;
  }
  /* The reviewed text of one refused section, so the doctor can finish it by
     hand in the two cases where MLS may not act: a field that already holds
     text, and any refusal they choose to complete themselves. Copy only. */
  function wfClarityCopyButton(state, row) {
    if (!state || state.closed || !row) return;
    var el = null; try { el = document.getElementById('mlsAthenaUnifiedProbe'); } catch (e) { return; }
    if (!el) return;
    try {
      if (document.getElementById('mlsAthenaUnifiedCopySection')) return;
      var btn = document.createElement('button');
      btn.type = 'button'; btn.id = 'mlsAthenaUnifiedCopySection';
      btn.textContent = 'Copy this section';
      btn.title = 'Copies the exact reviewed text of ' + S(row.label) + ' so you can paste it into athenaOne yourself. Read-only: nothing is written.';
      btn.setAttribute('data-mls-copy-section', S(row.id));
      btn.style.cssText = 'display:block;margin-top:7px;border:1px solid #cfe0d7;background:#fff;color:#204034;border-radius:8px;padding:6px 12px;font:700 12px inherit;cursor:pointer';
      btn.addEventListener('click', function () { unifiedCopyText(S(row.payload && row.payload.noteText), btn, 'Copy this section'); });
      el.appendChild(btn);
    } catch (e2) {}
  }
  /* One settled refusal, said in plain words at its true severity. It ALWAYS
     ends in unifiedRecheckButton, which is both the doctor's next control and
     the batch driver's settle latch - so a clarified refusal can never leave a
     queued send waiting on a probe that already answered. */
  function wfClarityRefusal(state, row, clar) {
    var say = wfClarityText(clar, row);
    if (clar.fix && clar.open) unifiedRecoverableStatus(state, row.id, say, unifiedOpenDayRecovery(state, row.id));
    else unifiedStatus(state, say, clar.fix ? 'fix' : 'err');
    unifiedRecheckButton(state, row.id);
    if (clar.copy) wfClarityCopyButton(state, row);
  }
  /* ===== end wfclar-1.0.0 ================================================= */
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
    /* mrnadopt-1.0.0: a review blocked ONLY for a missing MRN paints no READY
       row, so the probe path's own recheck control never appears. Offer the
       same words the blocked row's Why sentence names. */
    try { mrnAdoptOfferCure(state, host); } catch (eMrnCure) {}
    /* mrnopen-1.0.0 (owner 2026-09-01; 76% of charts carry no MRN in MLS).
       THE SEAM. mrnadopt-1.0.0 reads the MRN off the OPEN athenaOne chart, so on
       an MRN-only-blocked review it is the whole cure - but it refuses
       'no-chart-open' when nothing is open, and that review paints NO ready row,
       so this strip's read-only opener was gated out by `S(rowId).trim()` and
       the doctor was told to go open the chart by hand. MLS already knows the
       exact appointment and day for this review; opening it read-only is the
       identical ladder every other refusal already offers. Gate on the EVIDENCE
       (a bound visit) rather than on a ready row, so the majority-of-patients
       path gets the same one press the MRN-carrying path always had. Nothing
       here writes: the ladder is Day view -> this exact appointment row. */
    var canOpenUnrowed = !S(rowId).trim() && p1VisitBound(visit);
    if (day && (S(rowId).trim() || canOpenUnrowed)) {
      host.appendChild(wfdxButton('Open this patient’s encounter in athenaOne',
        'Read-only: sends the athenaOne Day view to ' + day + ', clicks this exact appointment row, then ' +
        (canOpenUnrowed ? 'reads that verified chart identity so this review can be checked. Nothing is written.'
          : 're-runs the read-only check. Nothing is written.'),
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
    /* sheetux-1.0.0: `recover` marks the refusals that are ONE READ-ONLY STEP
       away, not failures. They paint amber and carry the button that takes the
       step. Everything else on this ladder keeps its red. */
    function done(message, kind, recover) {
      if (btn) { btn.disabled = false; btn.textContent = byName ? 'Open by name instead' : 'Open this patient’s encounter in athenaOne'; }
      if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
      if (message) {
        if (recover) unifiedRecoverableStatus(state, rowId, message, unifiedOpenDayRecovery(state, rowId));
        else unifiedStatus(state, message, kind || 'err');
      }
      wfdxPaintDiag(state);
    }
    var openContext = byName ? { visitDate: visit.visitDate, provider: visit.provider, appointmentId: '' } : visit;
    /* rowfirst-1.0.0 (measured live 2026-08-31): the Day-view drive's recovery
       ladder can DESTROY a perfectly painted schedule (Home-drives on a slow
       renderer), after which the row hunt honestly finds nothing. The exact-id
       row click carries every identity gate itself, so it runs FIRST against
       whatever athenaOne already paints; the day-drive is the cure for a
       row-not-painted refusal, not the gatekeeper. The goto bridge is LAZY now
       - constructing it eagerly fired the drive even on the row-first path. */
    function handleOpenSuccess(openRes) {
      done('', '');
      if (state.closed || unifiedAthenaState !== state) return;
      /* openpace-1.0.0: an athenaOne encounter page takes 30-60s to paint -
         stamp the successful open and give it time before probing. */
      state.openedOkAt = Date.now(); state.paceReprobes = 0;
      /* mrnopen-1.0.0: an open started from a review with NO ready row (the
         MRN-only block) has no row to re-probe - probeUnifiedRow would answer
         "that destination is not executable", which is true and useless. The
         cure for THAT review is the read-only identity read, so run it, and
         leave the strip repainted either way. Still nothing written. */
      if (!S(rowId).trim()) {
        unifiedStatus(state, 'The chart is open in athenaOne (via ' + wfdxVia(openRes.via) + '). Reading its verified identity read-only in a moment - nothing is written...', '');
        wfPaceThen(12000, function () {
          if (state.closed || unifiedAthenaState !== state) return;
          var ran = false;
          try { ran = mrnAdoptPass(state) === true; } catch (eMP) { ran = false; }
          if (!ran) { try { wfdxShowFixStrip(state, ''); } catch (eS2) {} }
        });
        return;
      }
      unifiedStatus(state, 'The chart is open in athenaOne (via ' + wfdxVia(openRes.via) + '). Letting the encounter paint, then re-checking read-only…', '');
      /* wfgen-1.0.0: bxSleep, never a bare timer. During a write the extension
         is asked to bring athenaOne forward (probeUnifiedRow's foregroundOk),
         so the MLS tab is HIDDEN for exactly this stretch - and a hidden tab's
         setTimeout is clamped, then bucketed to one minute once it has been
         hidden for five. A 12s settle silently becoming 60s is what pushes a
         queued note past its 150s read-only bound. */
      wfPaceThen(12000, function () { if (!state.closed && unifiedAthenaState === state) probeUnifiedRow(state, rowId); });
    }
    var rowFirstEligible = !byName && day && S(visit.appointmentId).trim();
    unifiedStatus(state, byName
      ? 'Asking athenaOne’s patient search for this chart read-only — nothing is written…'
      : (rowFirstEligible
        ? 'Looking for this exact appointment row on the schedule athenaOne already shows — read-only, nothing is written…'
        : ('Sending athenaOne’s Day view to ' + day + ' and opening this exact appointment read-only — nothing is written…')), '');
    var attempt = rowFirstEligible ? searchOpenTarget(manifest.patient, openContext) : Promise.resolve(null);
    attempt.then(function (first) {
      first = first || {};
      if (rowFirstEligible) wfdxNote({ verb: 'mlsAppSearchOpenPatient', stage: 'fix-open-row-first', ok: first.ok === true,
        reason: first.reason || first.findReason, error: first.error, expectedDay: day, appointmentIdPresent: true });
      if (first.ok === true) { handleOpenSuccess(first); return; }
      runNavigateChain();
    }, function () { runNavigateChain(); });
    function runNavigateChain() {
    if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
    if (rowFirstEligible) unifiedStatus(state, 'This exact appointment row is not on the schedule athenaOne shows yet — sending its Day view to ' + day + ' read-only…', '');
    var navigate = (!byName && day)
      ? bridge('mlsAppGotoDate', { date: day, deadlineAt: Date.now() + 60000 }, 'mlsAppGotoDateResult', 62000)
      : Promise.resolve({ ok: true, skipped: true });
    navigate.then(function (nav) {
      /* navepoch-1.0.0 (qwen review HIGH, 2026-08-31): this continuation used
         to fire the row search even after the sheet closed or a newer probe
         took over mid-goto - the second drive then fought whoever owns the
         athena surface now (measured live: it wiped a manually painted
         encounter). Every async hop of the chain re-proves ownership before
         touching athena again. */
      if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
      nav = nav || {};
      if (nav.skipped !== true) {
        var observed = wfdxDayKey(nav.schedDate);
        if (observed) { wfdx.observedDay = observed; wfdx.observedDayAt = Date.now(); }
        wfdxNote({ verb: 'mlsAppGotoDate', stage: 'fix-open', ok: nav.ok === true, timeout: nav.__timeout === true,
          reason: nav.reason, error: nav.error, expectedDay: day, observedDay: observed,
          appointmentIdPresent: !!S(visit.appointmentId).trim() });
        /* dayfall-1.0.0: only a POSITIVELY different painted day refuses here.
           A goto that failed with no observed day (timeout, "calendar could not
           be reached" under a heavy renderer) falls through to the exact
           appointment-id row click, whose landing surface must re-prove name,
           DOB and the frozen schedule date before anything is accepted.
           dayfall-1.0.1: the refusal no longer asks whether the goto SUCCEEDED
           - a nav that reports ok:true while painting a positively different
           day is a day mismatch all the same (the other ladder site at
           navigateAndSearchOpenTarget always judged it this way; the two sites
           now agree). */
        if (observed && observed !== day) {
          /* wfauto-1.0.0: a POSITIVELY different painted day is a wrong-day
             refusal. It is terminal and stays terminal - no automatic
             re-check may ever run after it on this sheet. */
          try { wfautoLatchPositive(state, 'day-view-wrong-day'); } catch (eWa) {}
          done('One step needed: athenaOne’s Day view has to be on ' + day + ' once.' +
            ' Its Day view is on ' + observed + ' right now.' +
            ' MLS can take that step for you, or open ' + day + ' in athenaOne yourself and press Check Athena again. Nothing was changed and nothing was sent.', 'fix', true);
          wfdxOfferNameRoute(state, rowId);
          return;
        }
        /* dayfall-1.0.1: a MEASURED painted day is never overwritten by the
           expected one - the receipt records what athenaOne showed, not what
           MLS hoped. Only a goto that proved ok with NO measurable schedDate
           may stamp the expected day, and it is marked as assumed. */
        if (nav.ok === true && !observed) { wfdx.observedDay = day; wfdx.observedDayAt = Date.now(); wfdx.observedDayAssumed = true; }
        else if (nav.ok !== true) {
          unifiedStatus(state, 'athenaOne’s Day view could not be re-proven just now - opening this exact appointment row read-only instead. Identity is re-checked before anything can be written…', '');
        }
      }
      return searchOpenTarget(manifest.patient, openContext).then(function (openRes) {
        /* navepoch-1.0.0: same ownership re-proof after the row search - a
           stale generation must not paint refusals or fix offers over the
           surface a newer probe (or the doctor) now owns. */
        if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
        openRes = openRes || {};
        wfdxNote({ verb: 'mlsAppSearchOpenPatient', stage: byName ? 'fix-open-by-name' : 'fix-open', ok: openRes.ok === true,
          reason: openRes.reason || openRes.findReason, error: openRes.error, expectedDay: day,
          appointmentIdPresent: !!S(openContext.appointmentId).trim() });
        if (openRes.ok !== true) {
          var why = wfdxErrorClass(openRes.error) === 'appointment-row-open-refused'
            ? 'One step needed: athenaOne is on ' + day + ', but this exact appointment row is not on the grid it has painted yet.'
            : 'One step needed: athenaOne did not open the chart this time (' + (wfdxReason(openRes.reason || openRes.findReason) || 'no reason given') + ').';
          done(why + ' MLS can try the read-only open again, or open the encounter in athenaOne yourself and press Check Athena again. Nothing was changed.', 'fix', true);
          if (!byName) wfdxOfferNameRoute(state, rowId);
          return;
        }
        handleOpenSuccess(openRes);
      });
    }, function () { done('One step needed: the read-only open did not start. MLS can try it again, or open the encounter in athenaOne yourself and press Check Athena again. Nothing was changed.', 'fix', true); });
    }
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
    /* wfprog-1.1.0: the read-only ladder gets the animated progress surface
       too - outside a batch (the batch driver owns the surface) and never
       clobbering a run that already holds write verdicts. */
    if (!state.batchRunning && (!state.prog || state.prog.done || wfprogPreOnly(state))) { wfprogStart(state, [row], false); wfprogPhase(state, row.id, 'check'); }
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
          navigateAndSearchOpenTarget(state.manifest.patient, state.manifest.visit).then(function (openRes) {
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
            /* openpace-1.0.0: same pacing as the fix-strip open - the encounter
               surface needs time to paint before a probe can verify it. */
            state.openedOkAt = Date.now(); state.paceReprobes = 0;
            unifiedStatus(state, S(state.manifest.patient.name) + ' is open in Athena (via ' + S(openRes.via || 'patient search') + '). Letting the encounter paint, then re-checking...', '');
            wfPaceThen(12000, function () {          /* wfgen-1.0.0: hidden-safe */
              if (state.closed || unifiedAthenaState !== state) return;
              probeUnifiedRow(state, row.id);
            });
          });
          return;
        }
        /* wf2-1.9.0 QoL: a refused read-only probe is almost always fixable by
           the doctor. Say HOW, and offer one explicit re-check instead of
           making them reopen the whole review. */
        var probeErr = S(probe && (probe.error || probe.message || probe.reason)) || 'Athena context could not be verified. Nothing was changed.';
        if (/encounter frame|context.unverified|context.mismatch/i.test(probeErr + ' ' + probeReason)) {
          /* seam-1.0.0 (owner 2026-08-26: "nothing should ever be blocked",
             "seamless"): the read-only open ladder below IS the instruction this
             branch used to print at the doctor. Run it for them, once per
             minute at most (the ladder's tail re-runs this probe, so an
             unbounded auto-open here would loop against a surface athenaOne
             keeps closing; the time bound makes that impossible). A repeat
             failure inside the window falls through to the spoken instruction. */
          /* openpace-1.0.0: an open that succeeded moments ago means the surface
             is LOADING, not missing - re-driving navigation here destroys it
             (measured live: open ok at dt6, probe refused at dt8, the re-drive
             wedged the renderer and lost the encounter). While the open is
             fresh, wait and re-probe instead of navigating; up to 4 paced
             re-probes cover the slowest measured paint. */
          var openFresh = Number(state.openedOkAt) > Date.now() - 90000;
          if (openFresh && Number(state.paceReprobes || 0) < 4) {
            state.paceReprobes = Number(state.paceReprobes || 0) + 1;
            unifiedStatus(state, 'athenaOne is still painting the encounter it just opened — re-checking read-only in a moment. Nothing was changed…', '');
            wfPaceThen(15000, function () {          /* wfgen-1.0.0: hidden-safe */
              if (state.closed || unifiedAthenaState !== state) return;
              probeUnifiedRow(state, row.id);
            });
            return;
          }
          var autoOpenDue = !(Number(state.autoOpenAt) > Date.now() - 60000);
          if (autoOpenDue && wfdxDayKey(state.manifest.visit && state.manifest.visit.visitDate) && !state.running) {
            state.autoOpenAt = Date.now();
            wfdxNote({ verb: 'mlsAppSearchOpenPatient', stage: 'auto-open-encounter', ok: true, reason: 'probe-frame-missing',
              expectedDay: wfdxDayKey(state.manifest.visit.visitDate), appointmentIdPresent: !!S(state.manifest.visit.appointmentId).trim() });
            unifiedStatus(state, 'The encounter is not open in athenaOne. MLS is opening it read-only now — nothing is written…', '');
            wfdxOpenEncounter(state, row.id, null, false);
            return;
          }
          /* procdx-1.0.0: the frozen driver auto-opens a stage tab for every
             named section EXCEPT procedure (background.js snTabs has no
             'procedure' entry), so a reachability refusal on the op-note row
             usually means the Procedure Documentation section is simply not on
             screen - a state the chart/encounter auto-opens above cannot cure.
             Ask MLS Assist READ-ONLY what it can see (mode 'probe' is the only
             mode the frozen build allows; 'prep' answers
             procedure-template-mutation-disabled), then either re-check once
             or name the ONE human step. Nothing here writes or clicks Athena. */
          if (S(row.payload && row.payload.sectionKey) === 'procedure' && !state.procProbed) {
            state.procProbed = true;
            unifiedStatus(state, 'Checking read-only whether the Procedure Documentation section is on screen in athenaOne...', '');
            bridge('mlsAppPrepProcTemplate', { mode: 'probe', params: { sectionName: 'Procedure Documentation', tab: 'PE' } }, 'mlsAppPrepProcTemplateResult', 20000).then(function (proc) {
              if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
              proc = proc || {};
              var seen = proc.observed || {};
              wfdxNote({ verb: 'mlsAppPrepProcTemplate', stage: 'proc-probe', ok: proc.ok === true,
                reason: proc.ready === true ? 'template-present' : (seen.sectionReachable ? 'section-on-screen' : 'section-not-on-screen'),
                expectedDay: state.manifest.visit.visitDate, appointmentIdPresent: !!S(state.manifest.visit.appointmentId).trim() });
              if (proc.ok === true && (proc.ready === true || seen.sectionReachable === true)) {
                unifiedStatus(state, 'The Procedure Documentation section is on screen in athenaOne. Re-running the read-only check now - nothing has been sent.', '');
                wfPaceThen(1200, function () { if (!state.closed && unifiedAthenaState === state) probeUnifiedRow(state, row.id); });
                return;
              }
              var procStep = (proc.ok === true && seen.tabFound && !seen.sectionReachable)
                ? 'One step needed: in athenaOne, open the PE tab and choose Procedure Documentation (add your procedure template there if your practice uses one), then press Check Athena again. Nothing was changed and nothing was sent.'
                : 'One step needed: open this encounter in athenaOne with its Procedure Documentation section on screen, then press Check Athena again. Nothing was changed and nothing was sent.';
              unifiedStatus(state, procStep, 'fix');
              unifiedRecheckButton(state, row.id);
              wfClarityCopyButton(state, row);
            });
            return;
          }
          probeErr += ' To unlock: in athenaOne, open this patient\'s encounter for documentation (check the patient in and open the visit note), then press Check Athena again.';
        }
        /* mdx-2.0.0: a null probe is a timeout, and the most common cause is an
           occluded athenaOne tab that cannot paint its briefing. Name the cure. */
        if (!probe) probeErr += ' If athenaOne is open but behind other windows, click its tab once so it can paint, then press Check Athena again.';
        /* wfclar-1.0.0: a refusal code MLS understands is said in plain words at
           its true severity, with the controls that fit it. Everything else
           keeps the extension's own sentence and its red. */
        var clarified = wfClarify(probeReason);
        if (clarified) { wfClarityRefusal(state, row, clarified); return; }
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
      /* wfprog-1.1.0: READY dismisses the pre-write progress - the green tick
         and the enabled Confirm button ARE the finished state of this stretch. */
      wfprogClearPre(state);
      try { var fixHost = wfdxFixHost(); if (fixHost) fixHost.innerHTML = ''; } catch (eFix) {}
      unifiedStatus(state, (probeOnlyActive() ? 'PROBE ONLY — ' : '') + 'Ready — the exact chart is verified. One click on Confirm & Send runs only ' + row.label + '.' + (probeOnlyActive() ? ' In PROBE ONLY it is rehearsed read-only and nothing is written.' : ' Nothing else.'), '');
    });
  }
  /* wfsum-1.0.0 (owner 2026-08-26, watching his own writes land while the sheet
     said NOT ATTEMPTED): every sheet REOPEN (rebind, re-check rebuild) starts a
     fresh state with empty receipts, wiping the memory of what already landed.
     The ledger below survives reopens (keyed receiptSessionId+rowId; reopen
     paths reuse the same session id), so a section stays WRITTEN/VERIFIED for
     the life of the review. It records outcomes only - it can never make a row
     sendable. */
  var sectionLedger = Object.create(null);
  function ledgerKey(state, rowId) { return S(state.manifest && state.manifest.receiptSessionId) + '||' + S(rowId); }
  function rememberRowOutcome(state, rowId, receipt) {
    try { if (receipt && (receipt.status === 'verified' || receipt.status === 'uncertain')) sectionLedger[ledgerKey(state, rowId)] = receipt; } catch (e) {}
  }
  function receiptStateForRow(state, row) {
    if (state.receipts[row.id]) return state.receipts[row.id];
    var prior = sectionLedger[ledgerKey(state, row.id)];
    if (prior) return { status: prior.status, message: prior.message + ' (from earlier in this review)' };
    if (row.capability === 'blocked' && /note-editor-not-empty|not empty/i.test(S(row.reason))) {
      return { status: 'already in Athena', message: 'The exact Athena field already holds text (inserted earlier in this review, or by hand). There is nothing to send; review it in Athena.' };
    }
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
    /* wfsum-1.0.0: the ledger keeps earlier outcomes visible after reopens, so
       the receipt renders whenever ANY outcome exists for this review. */
    var anyOutcome = Object.keys(state.receipts).length > 0 ||
      state.manifest.rows.some(function (row) { return !!sectionLedger[ledgerKey(state, row.id)]; });
    if (!anyOutcome) { host.innerHTML = ''; return; }
    var colors = { verified: '#205c43', rehearsed: '#204034', uncertain: '#8b2525', blocked: '#8b2525', manual: '#6d5010', 'not attempted': '#52675c', 'already in Athena': '#205c43' };
    /* wfsum-1.0.0 completion banner: when every note-write row is in Athena
       (verified now, verified earlier, or its field already holds text), say so
       ONCE in green - the owner asked for one glanceable "everything is
       written" answer instead of reading eight rows. */
    var noteRows = state.manifest.rows.filter(function (row) { return row.action === 'write_note'; });
    var inAthena = noteRows.filter(function (row) { var r = receiptStateForRow(state, row); return r.status === 'verified' || r.status === 'already in Athena'; });
    var banner = (noteRows.length && inAthena.length === noteRows.length)
      ? '<div style="border:1px solid #bfe0cf;background:#eef7f2;color:#205c43;border-radius:10px;padding:10px 12px;margin-bottom:8px;font-weight:800">&#10003; Everything on this review is in Athena — ' + inAthena.length + ' of ' + noteRows.length + ' note sections verified. Nothing was saved or signed; finish Save / Sign in Athena yourself.</div>'
      : '';
    host.innerHTML = banner + '<div style="border:1px solid #e2e8f2;background:#fff;border-radius:10px;padding:10px 12px"><div style="font-weight:800;color:#204034;margin-bottom:6px">What happened</div>' + state.manifest.rows.map(function (row) {
      var r = receiptStateForRow(state, row), label = S(r.status).toUpperCase();
      return '<div style="border-top:1px solid #e2e8f2;padding:7px 0"><b>' + esc(row.label) + '</b><span style="float:right;color:' + (colors[r.status] || '#52675c') + ';font-weight:800">' + esc(label) + '</span><div style="clear:both;color:#52675c;font-size:12px">' + esc(r.message) + '</div></div>';
    }).join('') + '</div>';
    /* wfsum-1.0.0 footer truth (owner: '"Send checked sections" should be
       different than "Done" - it's confusing'): once anything landed, the exit
       button stops reading like it might undo the writes; once EVERYTHING is
       in Athena, it becomes the one obvious green Done and the send button
       says there is nothing left to send.
       sheetux-1.0.0: that send button is now the ONE merged primary. */
    try {
      var cancelBtn = document.getElementById('mlsAthenaUnifiedCancel'), batchBtn2 = document.getElementById('mlsAthenaUnifiedGo');
      var anyLanded = state.manifest.rows.some(function (row) { var r2 = receiptStateForRow(state, row); return r2.status === 'verified' || r2.status === 'already in Athena'; });
      if (cancelBtn && banner) {
        cancelBtn.textContent = 'Done — close review';
        cancelBtn.style.border = '1px solid #205c43'; cancelBtn.style.background = '#205c43'; cancelBtn.style.color = '#fff';
      } else if (cancelBtn && anyLanded) {
        cancelBtn.textContent = 'Close review (writes stay in Athena)';
      }
      if (batchBtn2 && banner && !state.batchRunning && !state.running) { batchBtn2.disabled = true; batchBtn2.setAttribute('aria-disabled', 'true'); batchBtn2.textContent = 'Nothing left to send'; }
    } catch (eFoot) {}
  }
  function resultToUnifiedReceipt(state, row, resp, probe) {
    resp = resp || {}; var status = 'blocked', message = '', verifiedWrite = null;
    var attempted = resp.attempted === true || resp.partialMutation === true || resp.reason === 'outcome-uncertain';
    if (resp.__timeout) { status = 'uncertain'; message = 'No completion response arrived. Athena may already have changed. Inspect the exact destination before any retry; no other action ran.'; }
    else if (row.action === 'stage_billing' && (resp.partialMutation === true || ((resp.stagedCodes || []).length && resp.ok !== true))) { status = 'uncertain'; message = billingResultSummary(resp, row.payload) || 'Billing was partially changed or not fully verified. Inspect the billing slate before retrying.'; }
    else if (!resp.ok) {
      status = attempted ? 'uncertain' : 'blocked';
      /* wfclar-1.0.0: a refusal that never touched Athena is said in plain
         words. An ATTEMPTED outcome keeps the extension's exact sentence and
         its uncertain status - nothing about a partial mutation is ever
         paraphrased. */
      var execClar = attempted ? null : wfClarify(resp.reason);
      message = execClar ? wfClarityText(execClar, row) : (S(resp.error || resp.message || resp.reason) || 'Athena refused the selected action. No other action ran.');
    }
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
    rememberRowOutcome(state, row.id, receipt); /* wfsum-1.0.0: survives sheet reopens */
    if (status === 'uncertain') state.halted = true;
    return receipt;
  }
  /* ===== wfprog-1.0.0 (owner 2026-08-27: "make it easy and simple with a good
     loading bar") ===========================================================
     wfsum-1.0.0 already ticked the seconds on the primary button and filled it
     left to right. Two things it could not do, both measured on the shipped
     code: (1) during a BATCH the button label is written twice - the batch
     driver writes "Writing 2/3..." and executeUnifiedSelection's own tick
     immediately overwrites it with "Writing to Athena... 4s", so the N-of-M
     the owner asked for survives for about one second per section; (2) there
     is nowhere at all that says WHICH section is being written, or what
     happened to the ones before it, until every receipt is in.

     This is that surface: one bar, one honest headline (which section, N of M,
     elapsed), one line per section, and a final summary. It is a RENDERER. It
     owns no gate, sends nothing, and reads its per-section verdicts from the
     receipts the execute path already writes - a section only ever reads
     "written" because state.receipts[row.id].status === 'verified', which is
     minted from the extension's own durable read-back receipt. */
  var WFPROG_PHASE = {
    wait: { label: 'waiting', color: '#52675c' },
    check: { label: 'checking Athena', color: '#6d5010' },
    write: { label: 'writing', color: '#6d5010' },
    done: { label: 'written', color: '#205c43' },
    already: { label: 'already in Athena', color: '#205c43' },
    refused: { label: 'not sent', color: '#8b2525' },
    timeout: { label: 'timed out', color: '#8b2525' },
    skipped: { label: 'not sent', color: '#8b2525' },
    rehearsed: { label: 'rehearsed only', color: '#7a5a16' }
  };
  function wfprogHost() { try { return document.getElementById('mlsAthenaUnifiedProgress'); } catch (e) { return null; } }
  /* wfprog-1.1.0 (owner 2026-08-31: "an actually good loading screen and UI for
     everything being written to athena"): 1.0.0 painted only from Confirm &
     Send onward, but the LONG stretch is the read-only ladder before it -
     probe, encounter open, paint waits - measured in minutes on a heavy
     renderer, during which the sheet showed one static text line and read as
     frozen. The same surface now paints for that pre-write stretch with an
     ANIMATED indeterminate bar. It stays a renderer: phases come from the
     probe/open code that already runs, and it disappears the moment the sheet
     reaches READY (the green tick takes over) or a refusal settles (the amber
     or red status carries the outcome). */
  function wfprogPreOnly(state) {
    var p = state && state.prog;
    if (!p || p.done) return false;
    /* sheetclar-1.0.0 (2026-08-31), MEASURED: 1p-writeflow-opnote-clarity-progress
       was ALREADY RED at b1144 with "the progress surface never painted a
       headline", and this predicate is why. A BATCH's very first step has row 0
       in 'check' with every later row still in 'wait' - byte for byte the shape
       "nothing has been written yet" was built to detect. So the moment section
       1 of N reached READY, wfprogClearPre() nulled state.prog and wiped the
       whole queue's loading surface, and every later wfprogPhase/Tick fell on a
       null and painted nothing. The doctor then watched a batch write N sections
       behind a blank panel.
       A batch OWNS this surface from its first section to its last (the same
       rule executeUnifiedSelection and probeUnifiedRow already state in words),
       so a batch run is never "pre-write only". */
    if (p.batch === true || state.batchRunning === true) return false;
    for (var i = 0; i < p.rows.length; i++) { var ph = p.rows[i].phase; if (ph !== 'wait' && ph !== 'check') return false; }
    return true;
  }
  function wfprogClearPre(state) {
    if (!state || !wfprogPreOnly(state)) return;
    state.prog = null; wfprogPaint(state);
  }
  function wfprogCss() {
    try {
      if (document.getElementById('mlsWfprogCss')) return;
      var st = document.createElement('style'); st.id = 'mlsWfprogCss';
      st.textContent = '@keyframes mlsWfprogSlide{0%{margin-left:-38%}100%{margin-left:100%}}';
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }
  function wfprogStart(state, rows, batch) {
    if (!state || state.closed) return;
    state.prog = { total: rows.length, batch: batch === true, secs: 0, done: false, summary: '',
      rows: rows.map(function (r) { return { id: S(r.id), label: S(r.label), phase: 'wait' }; }) };
    wfprogPaint(state);
  }
  function wfprogPhase(state, rowId, phase) {
    if (!state || state.closed || !state.prog) return;
    var list = state.prog.rows;
    for (var i = 0; i < list.length; i++) if (list[i].id === S(rowId)) list[i].phase = S(phase);
    if (phase === 'check' || phase === 'write') state.prog.secs = 0;
    wfprogPaint(state);
  }
  function wfprogTick(state, secs) {
    if (!state || state.closed || !state.prog || state.prog.done) return;
    state.prog.secs = Number(secs || 0);
    wfprogPaint(state);
  }
  function wfprogFinish(state, summary) {
    if (!state || state.closed || !state.prog) return;
    state.prog.done = true; state.prog.summary = S(summary); state.prog.secs = 0;
    wfprogPaint(state);
  }
  function wfprogCounts(state) {
    var out = { written: 0, refused: 0, pending: 0, total: 0 };
    var p = state && state.prog; if (!p) return out;
    out.total = p.rows.length;
    p.rows.forEach(function (r) {
      if (r.phase === 'done' || r.phase === 'already') out.written++;
      else if (r.phase === 'refused' || r.phase === 'timeout' || r.phase === 'skipped') out.refused++;
      else out.pending++;
    });
    return out;
  }
  function wfprogHeadline(state) {
    var p = state.prog, n = wfprogCounts(state);
    if (p.done) return S(p.summary);
    for (var i = 0; i < p.rows.length; i++) {
      var r = p.rows[i];
      if (r.phase !== 'check' && r.phase !== 'write') continue;
      return (r.phase === 'write' ? 'Writing ' : 'Checking Athena for ') + (i + 1) + ' of ' + p.total +
        ' - ' + r.label + (p.secs ? ' (' + p.secs + 's)' : '') + (r.phase === 'write' ? '' : ' - nothing sent yet');
    }
    return n.written + n.refused
      ? ('Finished ' + (n.written + n.refused) + ' of ' + p.total + ' - moving to the next section')
      : ('Starting ' + p.total + ' section' + (p.total === 1 ? '' : 's') + ' - nothing has been sent yet');
  }
  function wfprogPaint(state) {
    var host = wfprogHost(); if (!host || !state || state.closed) return;
    var p = state.prog;
    if (!p) { try { host.style.display = 'none'; host.innerHTML = ''; } catch (e0) {} return; }
    var n = wfprogCounts(state);
    /* The bar never claims 100% until the run is finished AND every section has
       a settled verdict, exactly as wfsum-1.0.0's button cap did. */
    var settled = n.written + n.refused;
    var pct = (p.done && !n.pending) ? 100 : Math.min(95, Math.round((settled / Math.max(1, p.total)) * 100));
    /* wfprog-1.1.0: before anything has settled or written, a determinate 0%
       bar reads as frozen - animate an indeterminate sweep instead. */
    var indeterminate = !p.done && settled === 0 && wfprogPreOnly(state);
    if (indeterminate) wfprogCss();
    var barInner = indeterminate
      ? '<div style="height:100%;width:38%;border-radius:999px;background:#2f7d5a;animation:mlsWfprogSlide 1.4s linear infinite"></div>'
      : '<div style="height:100%;width:' + pct + '%;background:#2f7d5a"></div>';
    var lines = p.rows.map(function (r) {
      var meta = WFPROG_PHASE[r.phase] || WFPROG_PHASE.wait;
      return '<div data-mls-prog-row="' + esc(r.id) + '" data-mls-prog-phase="' + esc(r.phase) + '" style="display:flex;gap:8px;border-top:1px solid #e2e8f2;padding:5px 0;font-size:12px">' +
        '<span style="flex:1;min-width:0;color:#204034">' + esc(r.label) + '</span>' +
        '<span style="font-weight:800;color:' + meta.color + '">' + esc(meta.label) + '</span></div>';
    }).join('');
    try {
      host.style.display = 'block';
      host.innerHTML = '<div style="border:1px solid #cfe0d7;background:#f7fbf9;border-radius:11px;padding:11px 12px">' +
        '<div data-mls-prog-headline="1" style="font-weight:850;color:#204034;font-size:13px">' + esc(wfprogHeadline(state)) + '</div>' +
        '<div role="progressbar" aria-valuemin="0" aria-valuemax="100" ' + (indeterminate ? 'data-mls-prog-indeterminate="1" ' : 'aria-valuenow="' + pct + '" ') + 'data-mls-prog-pct="' + pct + '" style="margin-top:8px;height:9px;border-radius:999px;background:#dbe7e0;overflow:hidden">' +
        barInner + '</div>' +
        '<div style="margin-top:7px">' + lines + '</div>' +
        '<div style="margin-top:6px;font-size:11.5px;color:#52675c">' +
        esc(n.written + ' written, ' + n.refused + ' not sent, ' + n.pending + ' still to go. MLS never saves or signs.') +
        '</div></div>';
    } catch (e) {}
  }
  /* The summary is DERIVED from the receipts, never from the loop's optimism:
     a section counts as written only where its own receipt says verified. */
  function wfprogSummaryText(state, rows, stopMsg) {
    var written = [], refused = [], uncertain = [];
    (rows || []).forEach(function (row) {
      var rec = state.receipts[row.id];
      if (rec && rec.status === 'verified') written.push(row.label);
      else if (rec && rec.status === 'uncertain') uncertain.push(row.label);
      else refused.push(row.label);
    });
    return 'Done: ' + written.length + ' of ' + (rows || []).length + ' section' + ((rows || []).length === 1 ? '' : 's') +
      ' written to Athena and read back.' +
      (uncertain.length ? ' Uncertain: ' + uncertain.join(', ') + ' - inspect Athena before retrying.' : '') +
      (refused.length ? ' Not sent: ' + refused.join(', ') + ' (each keeps its own reason above).' : '') +
      (stopMsg ? ' ' + stopMsg : '') + ' Nothing was saved or signed; finish Save / Sign in Athena yourself.';
  }
  /* ===== end wfprog-1.0.0 ================================================= */
  function executeUnifiedSelection(state) {
    if (!state || state.closed || state.running || state.halted) return;
    var row = unifiedRow(state.manifest, state.selectedRowId), probe = state.probe, go = document.getElementById('mlsAthenaUnifiedGo');
    if (!row || !ATHENA_EXECUTABLE_ACTIONS[row.action]) { unifiedStatus(state, 'That row is review-only. Complete it directly in Athena; MLS did not run a final action.', 'err'); return; }
    if (!row || row.capability !== 'ready' || !probe || probe.rowId !== row.id || probe.rowHash !== row.rowHash || probe.manifestHash !== state.manifest.manifestHash) { unifiedStatus(state, 'The selected action is not bound to a fresh exact Athena check. Nothing was changed.', 'err'); return; }
    if (!go || go.getAttribute('data-mls-athena-action') !== row.action || go.getAttribute('data-mls-preview-hash') !== state.manifest.previewHash || (row.action === 'place_order' && (go.getAttribute('data-mls-row-hash') !== row.rowHash || go.getAttribute('data-mls-client-order-id') !== S(row.payload.order && row.payload.order.clientOrderId).trim()))) { unifiedStatus(state, 'The confirmation binding changed. Nothing was written; select the action again.', 'err'); return; }
    var currentTaughtDestination = taughtDestinationFor(state.manifest, row);
    if (probe.taughtDestinationHash !== hashPreview(currentTaughtDestination || {})) { unifiedStatus(state, 'The taught destination changed after the read-only check. Select the action again before writing.', 'err'); invalidateUnifiedProbeForTeach(state); return; }
    state.running = true; go.disabled = true; go.setAttribute('aria-disabled', 'true'); go.textContent = 'Working…';
    /* wfsum-1.0.0 loading bar: the owner watched "Working…" for up to 40s with
       no sign of life. Tick the elapsed seconds on the button itself and fill
       it left-to-right (capped at 95% - only the receipt claims completion). */
    var wfsumT0 = Date.now(), wfsumVerb = probeOnlyActive() ? 'Checking (probe only)' : (row.action === 'save_draft' ? 'Saving draft in Athena' : 'Writing to Athena');
    /* wfprog-1.0.0: inside a batch the driver owns the button's N-of-M label,
       so the tick must not overwrite it - it decorates that label instead. A
       lone press starts its own one-section progress surface. */
    if (!state.batchRunning) wfprogStart(state, [row], false);
    wfprogPhase(state, row.id, 'write');
    var wfsumTick = setInterval(function () {
      try {
        if (state.closed || unifiedAthenaState !== state || !state.running) { clearInterval(wfsumTick); return; }
        var secs = Math.floor((Date.now() - wfsumT0) / 1000), pct = Math.min(95, Math.round((secs / 45) * 100));
        go.textContent = (state.batchRunning ? (S(state.batchLabel) || wfsumVerb) : wfsumVerb) + '... ' + secs + 's';
        go.style.background = 'linear-gradient(90deg,#2f7d5a ' + pct + '%,#204034 ' + pct + '%)';
        wfprogTick(state, secs);
      } catch (eTick) { try { clearInterval(wfsumTick); } catch (e2) {} }
    }, 1000);
    function wfsumStopTick() { try { clearInterval(wfsumTick); } catch (e) {} try { go.style.background = '#204034'; } catch (e3) {} }
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
        wfsumStopTick();
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
        /* wfprog-1.0.0: a rehearsal is neither written nor refused, and the
           progress surface must never let it read as either. */
        wfprogPhase(state, row.id, 'rehearsed');
        if (!state.batchRunning) wfprogFinish(state, 'PROBE ONLY: the full path was rehearsed read-only for ' + row.label + '. Nothing was written, saved, signed, billed or ordered.');
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
      wfsumStopTick();
      if (state.closed || unifiedAthenaState !== state) return;
      var completedProbe = state.probe;
      state.running = false;
      wfdxProbeReceipt(state, row, resp || {}, 'execute');
      var receipt = resultToUnifiedReceipt(state, row, resp || {}, completedProbe);
      /* wfprog-1.0.0: the per-section verdict comes from the receipt the line
         above minted, never from having reached this callback. */
      wfprogPhase(state, row.id, receipt.status === 'verified' ? 'done' : 'refused');
      if (!state.batchRunning) wfprogFinish(state, wfprogSummaryText(state, [row], state.halted ? 'This review is halted on an uncertain outcome.' : ''));
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
  /* ------------------------------------------------------------------ */
  /* bx-1.0.0 - batch send (owner 2026-08-26: "you should be able to send
     each section all at the same time and check each one off then it all
     off to Athena not just one at a time").
     The batch driver is a QUEUE over the existing per-row machinery: for
     each checked READY note-write row, in manifest order, it runs the SAME
     probeUnifiedRow (own read-only check, own action token) and the SAME
     executeUnifiedSelection (own execute, own receipt). No gate, token,
     payload, or receipt path changes; the only new thing is sequencing.
     Save, Sign, billing and orders never have checkboxes and never join.
     An uncertain outcome halts the manifest exactly as a manual run would.
     Waits are settle-latch driven (probeSettled) plus a hidden-safe sleep -
     never bare timers, because a backgrounded tab freezes those. */
  function bxSleep(ms) {
    return new Promise(function (resolve) {
      var at = Date.now() + Math.max(0, Number(ms || 0));
      if (typeof document === 'undefined' || !document.hidden) { setTimeout(resolve, Math.max(0, at - Date.now())); return; }
      var ch = null; try { ch = new MessageChannel(); } catch (e) { ch = null; }
      if (!ch) { setTimeout(resolve, Math.max(0, at - Date.now())); return; }
      ch.port1.onmessage = function () {
        if (Date.now() >= at || !document.hidden) { try { ch.port1.onmessage = null; ch.port1.close(); ch.port2.close(); } catch (e2) {} if (Date.now() >= at) { resolve(); } else { setTimeout(resolve, Math.max(0, at - Date.now())); } return; }
        try { ch.port2.postMessage(0); } catch (e3) { setTimeout(resolve, Math.max(0, at - Date.now())); }
      };
      ch.port2.postMessage(0);
    });
  }
  /* wfgen-1.0.0 (owner 2026-09-01: writing must "work for anybody and any
     appointment... smooth no matter the circumstances"). ONE paced wait for the
     read-only ladder, and it is bxSleep's wall clock - not a bare timer.

     THE CIRCUMSTANCE THIS IS ABOUT. probeUnifiedRow asks the extension to bring
     athenaOne FORWARD for the read-only check (foregroundOk, mdx-2.0.0), which
     means the MLS tab is hidden for precisely the stretch these waits cover.
     Chrome clamps a hidden tab's setTimeout, then buckets it to one minute once
     the tab has been hidden five minutes - which a multi-note queue reaches
     easily. openpace's measured budget (12s settle, then up to 4 x 15s) is 72s
     awake and up to 300s hidden, and the queue's own read-only bound is 150s.
     So on the shipped code the LAST patient in a batch got a materially
     different pacing budget from the first one. bxSleep yields through a
     MessageChannel while hidden, so the budget is the same wall clock for
     every note. It changes no gate: every callback still re-proves it owns the
     sheet before it touches anything. */
  function wfPaceThen(ms, fn) {
    try { return bxSleep(ms).then(function () { try { fn(); } catch (eRun) {} }); }
    catch (e) { try { setTimeout(fn, ms); } catch (e2) {} }
    return null;
  }
  function bxWait(pred, timeoutMs) {
    var until = Date.now() + timeoutMs;
    function step() {
      if (pred()) return Promise.resolve(true);
      if (Date.now() >= until) return Promise.resolve(false);
      return bxSleep(500).then(step);
    }
    return step();
  }
  function bxCheckedRows(state) {
    var out = [], boxes = [];
    try { boxes = document.querySelectorAll('#mlsAthenaUnifiedConfirm input.mls-bx-check'); } catch (e) { boxes = []; }
    for (var i = 0; i < boxes.length; i++) {
      if (!boxes[i].checked) continue;
      var row = unifiedRow(state.manifest, boxes[i].getAttribute('data-mls-bx-row'));
      if (row && row.capability === 'ready' && row.action === 'write_note') out.push(row);
    }
    return out;
  }
  /* ------------------------------------------------------------------ */
  /* sheetux-1.0.0 (owner 2026-08-27: "THE CONFIRM AND SEND TO ATHENA WHATS
     THE DIFFERENCE BETWEEN THOSE TWO BUTTONS THEY SHOULD BE MERGED").
     ONE primary button. It writes NO send loop of its own:

       - checked note sections  -> the EXISTING bx-1.0.0 batch driver, which
         runs the same probeUnifiedRow / executeUnifiedSelection pair per row,
         mints its own action token per row, writes its own receipt per row,
         and halts the manifest on an uncertain outcome exactly as before;
       - a selected Save draft / Sign & Save / order row - which by bx-1.0.0
         law can never carry a checkbox - keeps the EXACT legacy one-row path;
       - a sheet with no include checkboxes at all also keeps that legacy path,
         so "send what is checked" only ever governs a surface that has checks.

     With exactly one section checked the batch driver runs that single
     probe/execute pair once, so the receipt is the same receipt the old
     single-row press produced. Every refusal path, the never-retry rule, and
     the Sign-after-verified-write gate are untouched. */
  var SHEETUX_ZERO_REASON = 'Check at least one READY note section first - this button sends only the sections you have checked. Nothing was changed.';
  /* sheetclar-1.0.0: a sheet with NO include checkbox at all - every section
     blocked or manual - used to be refused with the sentence above, telling the
     doctor to tick a control that does not exist anywhere on the page. Same
     fail-closed refusal, honest words: name what is actually true. */
  var SHEETCLAR_NONE_READY_REASON = 'Nothing here can be sent yet - no note section has passed its read-only Athena check. Fix the reason shown above, then press Check Athena again. Nothing was changed.';
  function bxCheckBoxes() {
    try { return document.querySelectorAll('#mlsAthenaUnifiedConfirm input.mls-bx-check') || []; } catch (e) { return []; }
  }
  function unifiedPrimaryPlan(state) {
    if (!state || state.closed) return { mode: 'none', rows: [], reason: SHEETCLAR_NONE_READY_REASON };
    var sel = unifiedRow(state.manifest, state.selectedRowId);
    var selectable = !!(sel && sel.capability === 'ready' && sel.action);
    /* Save / Sign / order rows never join a batch - they keep the legacy path */
    if (selectable && sel.action !== 'write_note') return { mode: 'single', rows: [sel], reason: '' };
    if (!bxCheckBoxes().length) {
      return selectable ? { mode: 'single', rows: [sel], reason: '' } : { mode: 'none', rows: [], reason: SHEETCLAR_NONE_READY_REASON };
    }
    var rows = bxCheckedRows(state);
    if (!rows.length) return { mode: 'none', rows: [], reason: SHEETUX_ZERO_REASON };
    /* EXACTLY ONE checked section that is already the selected row and already
       bound to this review's fresh validated probe IS the legacy single-row
       press. Route it there, so its receipt AND its request count are what
       that button always produced - no extra read-only round trip. */
    if (rows.length === 1 && selectable && rows[0].id === sel.id && state.probe &&
      state.probe.rowId === sel.id && state.probe.rowHash === sel.rowHash &&
      state.probe.manifestHash === state.manifest.manifestHash) {
      return { mode: 'single', rows: rows, reason: '' };
    }
    return { mode: 'batch', rows: rows, reason: '' };
  }
  function unifiedSyncPrimaryButton(state) {
    var go = null; try { go = document.getElementById('mlsAthenaUnifiedGo'); } catch (e) { return; }
    if (!go || !state || state.closed || state.running || state.batchRunning || state.generating) return;
    var plan = unifiedPrimaryPlan(state);
    /* 'single' is the legacy lane: its ONLY enable path stays the validated
       read-only probe, so this never touches the button in that mode. */
    if (plan.mode === 'batch') {
      try {
        go.disabled = false; go.removeAttribute('aria-disabled'); go.removeAttribute('data-mls-primary-blocked');
        go.title = 'Sends every checked note section, one at a time, each with its own read-only Athena check and its own receipt. Save and Sign stay manual.';
      } catch (e2) {}
    } else if (plan.mode === 'none') {
      try {
        go.disabled = true; go.setAttribute('aria-disabled', 'true');
        go.setAttribute('data-mls-primary-blocked', plan.reason); go.title = plan.reason;
      } catch (e3) {}
    } else if (plan.mode === 'single') {
      /* sheetux-1.1.0 (measured live 2026-08-31): uncheck -> recheck left the
         button dead - mode 'none' wrote the disable and 'single' never undid
         it, so only a fresh probe could revive it. The plan returns 'single'
         only when the validated probe still matches the selected row, and the
         armed action attribute survives only the checkbox-sync disable (every
         real disarm strips it) - so this re-arms exactly the legacy press. */
      try {
        if (go.getAttribute('data-mls-primary-blocked') && go.getAttribute('data-mls-athena-action')) {
          go.disabled = false; go.removeAttribute('aria-disabled'); go.removeAttribute('data-mls-primary-blocked');
        }
      } catch (e4) {}
    }
  }
  function runUnifiedPrimarySend(state, btn) {
    if (!state || state.closed) return;
    if (state.running || state.batchRunning || state.generating) {
      unifiedStatus(state, 'MLS is already working on this review. Nothing new was started and nothing was sent.', '');
      return;
    }
    var plan = unifiedPrimaryPlan(state);
    if (plan.mode === 'none') { unifiedStatus(state, plan.reason, 'err'); return; }
    if (plan.mode === 'single') { executeUnifiedSelection(state); return; }
    runUnifiedBatchSend(state, btn);
  }
  function runUnifiedBatchSend(state, btn) {
    if (!state || state.closed || state.running || state.generating || state.batchRunning) return;
    if (state.halted) { unifiedStatus(state, 'This review is halted on an uncertain outcome. Inspect Athena before anything else runs.', 'err'); return; }
    var rows = bxCheckedRows(state);
    if (!rows.length) { unifiedStatus(state, 'Check at least one READY note section to include in the batch.', 'err'); return; }
    state.batchRunning = true;
    var restLabel = btn ? btn.textContent : '';
    if (btn) btn.disabled = true;
    var okCount = 0, skipped = [], stopMsg = '';
    /* wfprog-1.0.0: one progress surface for the whole queue. */
    wfprogStart(state, rows, true);
    function finish() {
      state.batchRunning = false; state.batchLabel = '';
      if (btn) { btn.disabled = false; btn.textContent = restLabel; }
      /* The summary is recomputed from the receipts, so it can never claim a
         section landed that has no durable read-back receipt of its own. */
      var summary = wfprogSummaryText(state, rows, stopMsg);
      wfprogFinish(state, summary);
      unifiedStatus(state, summary, okCount === rows.length && !stopMsg ? 'ok' : 'err');
      /* sheetux-1.0.0: the merged button decides its own next state from what
         is still checked - then the receipt render below gets the last word,
         because "Nothing left to send" outranks "some rows are checked". */
      try { unifiedSyncPrimaryButton(state); } catch (eSync) {}
      /* wfsum-1.0.0: re-render so the completion banner and footer relabel
         (Done / Nothing left to send) survive the label restore above. */
      try { renderUnifiedReceipts(state); } catch (eRR) {}
    }
    function step(i) {
      if (i >= rows.length || state.closed || unifiedAthenaState !== state) { finish(); return; }
      if (state.halted) { stopMsg = 'Halted on an uncertain outcome - inspect Athena before retrying anything.'; finish(); return; }
      var row = rows[i];
      if (state.receipts[row.id] && state.receipts[row.id].status === 'verified') { okCount++; wfprogPhase(state, row.id, 'already'); step(i + 1); return; }
      state.batchLabel = 'Checking ' + (i + 1) + ' of ' + rows.length;
      if (btn) btn.textContent = state.batchLabel + '...';
      wfprogPhase(state, row.id, 'check');
      probeUnifiedRow(state, row.id);
      bxWait(function () {
        if (state.closed || unifiedAthenaState !== state) return true;
        if (state.probe && state.probe.rowId === row.id) return true;
        return state.probeSettled === state.probeGeneration && !state.probe;
      }, 150000).then(function (settledInTime) {
        if (state.closed || unifiedAthenaState !== state) { finish(); return; }
        if (!(state.probe && state.probe.rowId === row.id)) {
          /* wfprog-1.0.0: a queue step is BOUNDED, and a step that ran out its
             bound says so rather than looking like an ordinary refusal. */
          if (settledInTime === false) { stopMsg = 'One step ran past its 150-second read-only check bound and was left alone.'; wfprogPhase(state, row.id, 'timeout'); }
          else wfprogPhase(state, row.id, 'refused');
          skipped.push(row.label); step(i + 1); return;
        }
        state.batchLabel = 'Writing ' + (i + 1) + ' of ' + rows.length;
        if (btn) btn.textContent = state.batchLabel + '...';
        wfprogPhase(state, row.id, 'write');
        executeUnifiedSelection(state);
        bxWait(function () {
          if (state.closed || unifiedAthenaState !== state) return true;
          return !state.running && !!state.receipts[row.id];
        }, 180000).then(function (wroteInTime) {
          var rec = state.receipts[row.id];
          if (rec && rec.status === 'verified') okCount++;
          else if (!rec || rec.status !== 'rehearsed') skipped.push(row.label);
          if (!rec && wroteInTime === false) { stopMsg = 'One write ran past its 180-second bound with no receipt - inspect that exact Athena field before retrying it.'; wfprogPhase(state, row.id, 'timeout'); }
          step(i + 1);
        });
      });
    }
    step(0);
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
  /* Days this patient could have been seen on, from the MLS schedule ONLY.
     bindday-1.0.0 (measured live 2026-08-26): a note created today for a visit
     that BELONGS to another day pins visit.visitDate to the creation day, and
     the early return here made that wrong pin the ONLY candidate - the
     multi-day offer below was unreachable, so the cure re-pulled the wrong day
     and dead-ended ("shouldn't always have to rebind... seamless" - owner).
     The pinned day stays FIRST (the single-day render is unchanged when the
     patient has no other scheduled days), and the patient's own other
     scheduled days follow as explicit offers; MLS still never picks a day. */
  function wfbindCandidateDays(manifest) {
    var out = [], seen = {};
    try {
      var visit = (manifest && manifest.visit) || {};
      var pinned = wfdxDayKey(visit.visitDate);
      if (pinned) { seen[pinned] = 1; out.push(pinned); }
      var pid = S(manifest && manifest.patient && manifest.patient.patientId).trim();
      if (!pid) return out;
      var rest = [];
      calendarRows().forEach(function (a) {
        if (!a || S(a.patient_external_id || a.patientId || '').trim() !== pid) return;
        var d = wfdxDayKey(visitDay(a.day_local || a.appt_date || a.start_at));
        if (!d || seen[d]) return;
        seen[d] = 1; rest.push(d);
      });
      rest.sort();
      out = out.concat(rest);
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
      /* mrnadopt-1.0.0: an MRN-only identity block reads differently now, and
         it is still an IDENTITY block - a day re-pull can never supply an MRN.
         Recognize it by the manifest's own predicate rather than by wording. */
      if (mrnAdoptCurable(manifest && manifest.patient)) return false;
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
          /* apptpick-1.0.0: "cannot name ONE" has two very different causes, and
             the doctor could not tell them apart. Say which one it is - several
             appointments is a CHOICE that is already on screen, not a dead end. */
          var many = wfbindApptChoices(state.manifest, day);
          if (many.length > 1) {
            unifiedStatus(state, 'The day pull for ' + day + ' finished and this patient has ' + many.length +
              ' appointments on that day, so MLS will not choose between them. Pick the one this note belongs to below - it is bound read-only and re-checked before anything can be sent. Nothing was written.', 'fix');
            try { wfdxShowFixStrip(state, ''); } catch (eS1) {}
            wfdxNote({ verb: 'wfbind', stage: 'bind-cure', ok: false, reason: 'appointment-ambiguous-on-day', expectedDay: day, appointmentIdPresent: false });
            return;
          }
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
  /* ===== apptpick-1.0.0 (owner 2026-09-01, "any appointment... it should work
     for everyone") =========================================================
     THE CIRCUMSTANCE. A patient seen TWICE on one day - a morning visit and an
     afternoon procedure, a re-check after imaging, a walk-in on top of a booked
     slot - is the one shape expectedVisitContext cannot answer. Its resolver
     binds an appointment only when the day holds EXACTLY ONE row for this
     patient (`dayRows.length === 1`); with two it honestly returns nothing, the
     manifest blocks with "the exact visit needs its ... appointment ID", and
     the wfbind cure re-pulls the day and asks the SAME resolver again - which
     answers the same way, forever. Measured on the shipped code: that patient
     is permanently unwritable through this sheet unless the saved note happened
     to carry an appointment id of its own.

     THE CURE IS A CHOICE, NOT A GUESS. This lists the day's own resolvable
     Athena appointments for THIS patient and lets the doctor name the one the
     note belongs to - the same law bindday-1.0.0 already uses for several
     candidate DAYS ("MLS still never picks a day"). It invents nothing: every
     id here came from the day's schedule-import index or the booking row, the
     chosen id is handed to the ordinary reopen path as expectedContext, and the
     read-only probe remains the fail-closed arbiter afterwards - a wrong pick
     refuses at check time exactly as any other wrong context does. One
     appointment needs no control at all, because the resolver already binds it.
     ==================================================================== */
  function wfbindApptTimeLabel(row) {
    try {
      var raw = S(row && row.start_at).trim();
      if (!raw) return '';
      var d = new Date(raw);
      if (isNaN(d.getTime())) return '';
      return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    } catch (e) { return ''; }
  }
  /* Every DISTINCT Athena appointment this exact patient has on this exact day,
     resolved by the same two resolvers expectedVisitContext itself uses. An id
     neither resolver can name is not offered - MLS never shows a control it
     cannot honestly bind. */
  function wfbindApptChoices(manifest, day) {
    var out = [];
    try {
      var pid = S(manifest && manifest.patient && manifest.patient.patientId).trim();
      var key = wfdxDayKey(day);
      if (!pid || !key) return out;
      var seen = {};
      calendarRows().forEach(function (a) {
        if (!a || S(a.patient_external_id || a.patientId || '').trim() !== pid) return;
        if (wfdxDayKey(visitDay(a.day_local || a.appt_date || a.start_at)) !== key) return;
        var id = athenaAppointmentIdFromImportIndex(pid, a.id, key) || athenaAppointmentIdFromBookingRow(a) || '';
        if (!id || seen[id]) return;
        seen[id] = 1;
        out.push({ appointmentId: id, time: wfbindApptTimeLabel(a), provider: apptProvider(a) });
      });
    } catch (e) {}
    return out;
  }
  /* The chosen appointment rides in on the SAME detached reopen options the day
     cure uses; the manifest is never mutated in place and every hash recomputes
     through openUnifiedConfirmation. The row's own provider is filled in only
     when the review has none - it comes from the same schedule row as the id,
     and the probe re-proves it against Athena either way. */
  function wfbindOptsForAppointment(state, day, choice) {
    var o = wfbindOptsForDay(state, day);
    if (!o || !choice || !S(choice.appointmentId).trim()) return null;
    o.expectedContext.appointmentId = S(choice.appointmentId).trim();
    if (!S(o.expectedContext.provider).trim() && S(choice.provider).trim()) o.expectedContext.provider = S(choice.provider).trim();
    return o;
  }
  function wfbindOfferApptChoice(state, host, day) {
    if (!state || state.closed || !host) return false;
    var choices = wfbindApptChoices(state.manifest, day);
    if (choices.length < 2) return false;                 /* one is bound by the resolver; none is an honest refusal */
    try { if (host.querySelector('[data-mls-appt-pick]')) return false; } catch (eQ) {}
    choices.slice(0, 8).forEach(function (choice, i) {
      var when = S(choice.time).trim(), who = S(choice.provider).trim();
      var label = 'Bind to the ' + (when || ('#' + (i + 1))) + ' appointment' + (who ? (' with ' + who) : '');
      var b = wfbindButton(label,
        'This patient has ' + choices.length + ' appointments on ' + wfdxDayKey(day) + ' and MLS will not choose between them. ' +
        'Binds this review to Athena appointment ' + choice.appointmentId + ', then re-runs the read-only check. Nothing is written, and a wrong choice refuses at that check.',
        function () {
          if (!state || state.closed || unifiedAthenaState !== state || state.running || state.binding) return;
          var opts = wfbindOptsForAppointment(state, day, choice);
          if (!opts) return;
          unifiedStatus(state, 'Binding this review to the ' + (when || 'chosen') + ' appointment on ' + wfdxDayKey(day) + ' and re-checking read-only. Nothing was sent.', '');
          openUnifiedConfirmation(opts);
        });
      b.setAttribute('data-mls-appt-pick', choice.appointmentId);
      host.appendChild(b);
    });
    return true;
  }
  /* The strip control(s). One candidate day is one press; several are named. */
  function wfbindOfferCure(state, host) {
    if (!state || state.closed || !host) return false;
    var manifest = state.manifest, visit = manifest.visit || {};
    if (p1VisitBound(visit)) return false;
    var days = wfbindCandidateDays(manifest);
    if (!days.length) return false;
    /* apptpick-1.0.0: an AMBIGUOUS day is not a missing day. When the review's
       own day already holds several of this patient's appointments, re-pulling
       it cannot help - offer the choice first, above the re-pull controls. */
    try { wfbindOfferApptChoice(state, host, days[0]); } catch (ePick) {}
    if (days.length === 1) {
      var one = wfbindButton(WFBIND_LABEL,
        'Sends athenaOne’s Day view to ' + days[0] + ', re-pulls that day’s schedule, then re-checks this exact appointment. Reads Athena; writes nothing.',
        function (btn) { wfbindRun(state, days[0], btn); });
      one.setAttribute('data-mls-bind-cure', days[0]);
      host.appendChild(one);
      return true;
    }
    /* bindday-1.0.0: the first candidate may be the review's own (possibly
       wrong) pinned day; the rest are the patient's other scheduled days. Name
       each honestly - the doctor picks, MLS never chooses a day. */
    var pinnedDay = wfdxDayKey((visit && visit.visitDate) || '');
    days.slice(0, 8).forEach(function (day) {
      var isPinned = !!pinnedDay && day === pinnedDay;
      var b = wfbindButton('Bind to ' + day + ' — re-pulls this day',
        isPinned
          ? 'This review expects ' + day + '. MLS re-pulls it read-only and re-checks the exact appointment.'
          : (pinnedDay
            ? 'This review expects ' + pinnedDay + ', but this patient is also on the MLS schedule for ' + day + '. MLS re-pulls ' + day + ' read-only and re-checks the exact appointment; it will not choose a day for you.'
            : 'This review names no day. ' + day + ' is one of this patient’s own scheduled days. MLS re-pulls it read-only and re-checks the exact appointment; it will not choose a day for you.'),
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
  /* sheetclar-1.0.0: ONE definition of "this section arrives selected", used by
     both the markup below and the post-render property set in
     renderUnifiedConfirmation, so the two can never disagree.
     A READY reviewed note section defaults ON - that is the primary reviewed
     note the doctor came here to send. Nothing else ever can: Save, Sign,
     billing and orders carry no include control at all (bx-1.0.0 law), and a
     blocked or manual row is not a candidate. Defaulting ON selects; it never
     sends - Confirm & Send is still a human click behind a validated probe. */
  function unifiedDefaultChecked(row) {
    return !!(row && row.capability === 'ready' && row.action === 'write_note');
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
      /* sheetux-1.0.0 (owner 2026-08-27: too many warnings in your face): the
         per-row "How" said the same sentence on every ready row, and with ONE
         merged send button it also said the wrong thing. It is now stated ONCE
         above the rows, in the What -> Where -> How guide. Per-row copy that is
         actually per-row (Where, Result, Why) stays inline. */
      '<span style="display:block;color:#52675c;font-size:12px;margin-top:3px"><b>Result:</b> ' + esc(unifiedOneLine(row.consequence)) + '</span></span></label>' +
      /* bx-1.0.0 (owner 2026-08-26: "send each section all at the same time
         and check each one off"): note-write rows carry an include checkbox
         for the one-confirm batch. It sits OUTSIDE the radio label so the two
         controls never fight, and only write_note rows ever get one - Save,
         Sign, billing and orders can never join a batch. */
      (row.action === 'write_note'
        ? '<label style="display:flex;gap:7px;align-items:center;margin-top:6px;font-size:11.5px;color:#204034;cursor:pointer"><input type="checkbox" class="mls-bx-check" data-mls-bx-row="' + esc(row.id) + '"' + (unifiedDefaultChecked(row) ? ' checked' : '') + '> Send this section</label>'
        : '') +
      unifiedPayloadDetails(row) + advancedTeachingHtml(manifest, row) + '</section>';
  }
  function unifiedManualRowHtml(manifest, row) {
    return '<section data-manifest-row="' + esc(row.id) + '" style="border:1px solid #f0d79a;border-radius:11px;padding:10px 11px;margin-top:8px;background:#fffdf5">' +
      '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><b style="color:#6d5010">What: ' + esc(unifiedArtifactName(row)) + '</b>' +
      '<span style="font-size:10.5px;font-weight:850;color:#7a5a16;border:1px solid currentColor;border-radius:999px;padding:1px 7px">MANUAL IN ATHENA</span></div>' +
      '<div style="font-size:12px;color:#6d5010;margin-top:3px"><b>Where:</b> ' + esc(row.destination) + '</div>' +
      /* sheetux-1.0.0: the "How" here was one identical sentence on every
         manual row; it is stated once in this group's own heading note. */
      '<div style="font-size:12px;color:#52675c;margin-top:3px"><b>Result:</b> ' + esc(unifiedOneLine(row.consequence)) + '</div>' +
      '<details style="margin-top:5px"><summary style="cursor:pointer;font-weight:700;color:#6d5010;font-size:11.5px">Why?</summary>' +
      (row.reason ? '<div style="font-size:12px;color:#52675c;margin-top:4px">' + esc(row.reason) + '</div>' : '') +
      '</details>' +
      unifiedPayloadDetails(row) + unifiedCopyPayloadButton(row) + advancedTeachingHtml(manifest, row) + '</section>';
  }
  /* wfclar-1.0.0 (owner 2026-08-27: "not so many things that say blocked"):
     when EVERY blocked row is blocked for the SAME reason - which is the
     overwhelmingly common case, because identity and encounter binding are
     per-review facts, not per-section ones - the sheet printed that identical
     sentence, plus the identical bind hint, once per row. Measured on his own
     store that is up to eight red paragraphs saying one thing.

     Returns the shared reason when there is exactly one; '' when the rows
     genuinely differ, in which case nothing is collapsed and every unique Why
     keeps its inline place. This is the sheetux-1.0.0 rule applied to the last
     block of boilerplate it did not reach. */
  function unifiedSharedBlockedReason(rows) {
    if (!rows || rows.length < 2) return '';
    var first = S(rows[0] && rows[0].reason).trim();
    if (!first) return '';
    for (var i = 1; i < rows.length; i++) if (S(rows[i] && rows[i].reason).trim() !== first) return '';
    return first;
  }
  /* Name the ONE fact that is missing, in plain words, instead of leaving the
     doctor to diff a three-clause sentence against the identity panel. Only
     when exactly one is absent; two or more keeps the full sentence. */
  function unifiedOneMissingFact(manifest) {
    var visit = (manifest && manifest.visit) || {}, missing = [];
    if (!S(visit.visitDate).trim()) missing.push('the visit date');
    if (!S(visit.provider).trim()) missing.push('the provider for this visit');
    if (!S(visit.appointmentId).trim() && !(S(visit.encounterId).trim() && S(visit.encounterUrl).trim())) missing.push('the Athena appointment ID for this visit');
    return missing.length === 1 ? missing[0] : '';
  }
  function unifiedBlockedRowHtml(manifest, row, sharedReason) {
    var showReason = !!row.reason && S(row.reason).trim() !== S(sharedReason).trim();
    return '<section data-manifest-row="' + esc(row.id) + '" style="border:1px solid #e7c0c0;border-radius:11px;padding:10px 11px;margin-top:8px;background:#fdf7f7">' +
      '<div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap"><b style="color:#8b2525">What: ' + esc(unifiedArtifactName(row)) + '</b>' +
      '<span style="font-size:10.5px;font-weight:850;color:#8b2525;border:1px solid currentColor;border-radius:999px;padding:1px 7px">BLOCKED &middot; NOTHING SENT</span></div>' +
      '<div style="font-size:12px;color:#8b2525;margin-top:3px"><b>Where:</b> ' + esc(row.destination) + '</div>' +
      /* sheetux-1.0.0: identical on every blocked row - said once in the group
         heading note instead. The per-row Why below is the unique part.
         wfclar-1.0.0: a reason that IS the shared one is now part of that same
         collapse; a row whose reason differs still prints its own here. */
      (showReason ? '<div style="font-size:12px;color:#8b2525;margin-top:3px"><b>Why:</b> ' + esc(row.reason) + '</div>' : '') +
      /* wfbind-1.0.0: a row blocked ONLY for the missing appointment binding has
         a one-press cure on this same sheet. Say so where the doctor is reading
         the refusal, instead of leaving the strip to be discovered.
         wfclar-1.0.0: only where the Why is still here - when the whole group
         shares one reason the hint is said once with it. */
      (showReason && wfbindCurableRow(manifest, row)
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
    var noteRow = unifiedRow(manifest, 'write-note'), heading = 'Review the generated encounter-note text';
    /* Named HPI/ROS/Exam/Assessment/Plan reviews have several independent
       destinations. A generic Encounter-note hero would be false and would
       visually duplicate those rows, so only the true generic-note lane gets
       the full-text hero. Named sections show their own What/Where/How rows. */
    /* wfclar-1.0.0 (owner 2026-08-27, on the op-note write): a review with
       EXACTLY ONE note-write row has no wall of destinations to duplicate, and
       an op note is exactly that shape. Hiding its entire body behind "Review
       full payload and hashes" made the one thing the doctor is confirming the
       hardest thing on the sheet to read. One row, one hero, titled by that
       row's own destination so it can never claim to be the generic note. */
    if (!noteRow) {
      var singles = manifest.rows.filter(function (r) { return r.action === 'write_note'; });
      if (singles.length !== 1) return '';
      noteRow = singles[0];
      heading = 'Review the exact text going to ' + S(noteRow.destination);
    }
    var who = [S(manifest.patient.name).trim() || '(patient name missing)'];
    if (manifest.patient.dob) who.push('DOB ' + S(manifest.patient.dob));
    if (manifest.patient.mrn) who.push('MRN ' + S(manifest.patient.mrn));
    if (manifest.visit.visitDate) who.push(S(manifest.visit.visitDate));
    if (manifest.visit.provider) who.push(S(manifest.visit.provider));
    var open = '<section style="border:1px solid #dce5df;border-radius:12px;padding:14px 15px;background:#fff;min-width:0;margin-top:12px">' +
      '<div style="font-size:13.5px;font-weight:850;color:#204034">' + esc(heading) + '</div>' +
      '<div style="color:#52675c;font-size:12px;margin-top:3px">' + esc(who.join(' - ')) + '</div>';
    return open +
      '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:60vh;overflow:auto;margin:11px 0 0;padding:13px;border:1px solid #dbe7e0;border-radius:10px;background:#f8fbf9;color:#1f3027;font:14px/1.6 ui-monospace,SFMono-Regular,Consolas,monospace">' + esc(S(noteRow.payload.noteText)) + '</pre>' +
      '<div style="display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:8px">' +
      '<span style="font-size:11px;color:#52675c">' + unifiedHashFooter(noteRow) + '</span>' +
      '<button type="button" data-mls-copy-note="' + esc(noteRow.id) + '" style="margin-left:auto;border:1px solid #d8ddd9;background:#fff;color:#3d5147;border-radius:8px;padding:5px 10px;font-size:11.5px;font-weight:700;cursor:pointer">Copy note</button></div></section>';
  }
  /* WHO and WHICH VISIT, in one line, from the frozen manifest only. An absent
     field says so instead of being omitted - a header that silently drops the
     provider would read as a complete identity. */
  function unifiedWhoLine(manifest) {
    var patient = (manifest && manifest.patient) || {}, visit = (manifest && manifest.visit) || {};
    var bits = [S(patient.name).trim() || '(patient name missing)'];
    if (S(patient.dob).trim()) bits.push('DOB ' + S(patient.dob).trim());
    bits.push(S(visit.visitDate).trim() || 'visit date not bound yet');
    bits.push(S(visit.provider).trim() || 'provider not bound yet');
    return bits.join(' - ');
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
    /* sheetux-1.0.0: the one shared "How" for every READY row, said once here
       instead of repeated verbatim inside each row. */
    var sharedHow = readyRows.some(function (row) { return row.action === 'write_note'; })
      ? ' Leave the sections you want checked, then press <b>Confirm &amp; Send to Athena</b> once. Each checked section still gets its own read-only Athena check, its own write and its own receipt; nothing is saved or signed.'
      : ' Every READY item needs its own Confirm &amp; Send.';
    var rowsHtml = generationIssue ? '' : '<div data-mls-destination-guide="1" style="margin-top:12px;padding:8px 10px;border:1px solid #dbe7e0;background:#f7fbf9;border-radius:9px;color:#385b49;font-size:12px"><b>What &rarr; Where &rarr; How.</b>' + sharedHow + ' MANUAL and BLOCKED items never cross the Athena write bridge.</div>';
    if (readyRows.length > 1) {
      rowsHtml += '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap" role="radiogroup" aria-label="What MLS sends">' +
        readyRows.map(function (row) { return unifiedReadyRowHtml(manifest, row, chosen && chosen.id === row.id); }).join('') + '</div>';
    } else if (readyRows.length === 1) {
      rowsHtml += unifiedReadyRowHtml(manifest, readyRows[0], true);
    }
    /* wfclar-1.0.0: one reason shared by every blocked row is said ONCE, in
       this group's heading, led by the single fact that is missing where there
       is exactly one. A row with its own distinct reason is untouched and
       still prints it inline. */
    var blockedShared = unifiedSharedBlockedReason(blockedRows);
    var blockedOneThing = blockedShared ? unifiedOneMissingFact(manifest) : '';
    var blockedGroupNote = 'MLS fails closed on these: nothing is sent from any of them. Resolve the reason each one names, then reopen the Athena review.';
    if (blockedShared) {
      blockedGroupNote = (blockedOneThing ? ('<b>All ' + blockedRows.length + ' need the same one thing: ' + esc(blockedOneThing) + '.</b> ') : ('<b>All ' + blockedRows.length + ' are blocked for the same reason.</b> ')) +
        esc(blockedShared) + ' MLS fails closed: nothing is sent from any of them.' +
        (blockedRows.every(function (row) { return wfbindCurableRow(manifest, row); })
          ? (' Fixable here: press &ldquo;' + esc(WFBIND_LABEL) + '&rdquo; above. MLS re-pulls the day and re-checks this exact appointment; nothing is written.')
          : '');
    }
    var drawerCount = manualRows.length + blockedRows.length + orderRows.length;
    if (drawerCount) {
      /* wf3: the drawer ships OPEN — what stays manual must be VISIBLE (the
         unified-confirmation runtime pins this), it is merely grouped and
         de-emphasized below the primary action instead of interleaved. */
      var readyOrderCount = orderRows.filter(function (row) { return row.capability === 'ready' && !!row.action; }).length;
      rowsHtml += '<details open style="margin-top:12px"><summary style="cursor:pointer;font-weight:750;color:#6d5010;font-size:12px">' +
        (readyOrderCount ? ('Orders and other Athena items (' + drawerCount + ') — ' + readyOrderCount + ' order' + (readyOrderCount === 1 ? '' : 's') + ' can be sent with separate confirmation') : ('Complete final actions in Athena yourself (' + drawerCount + ') — nothing here is sent')) + '</summary>' +
        /* sheetux-1.0.0: each group states its shared "How" ONCE, here. */
        (manualRows.length ? unifiedGroupHead('You finish this in Athena', '#7a5a16', 'Review or copy each payload here, then complete it yourself in Athena. Nothing is sent from these rows; the exact payload stays here for you to copy and never crosses the write bridge.') +
          manualRows.map(function (row) { return unifiedManualRowHtml(manifest, row); }).join('') : '') +
        (orderRows.length ? renderUnifiedOrderSummary(orderRows, manifest, chosen) : '') +
        (blockedRows.length ? unifiedGroupHead('Can\'t send', '#8b2525', blockedGroupNote) +
          blockedRows.map(function (row) { return unifiedBlockedRowHtml(manifest, row, blockedShared); }).join('') : '') +
        '</details>';
    }
    var ov = document.createElement('div'); ov.id = 'mlsAthenaUnifiedConfirm';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(10,25,50,.55);display:flex;align-items:center;justify-content:center;padding:18px';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-labelledby', 'mlsAthenaUnifiedTitle'); ov.setAttribute('aria-describedby', 'mlsAthenaUnifiedSafety');
    /* sheetclar-1.0.0 THE FOOTER MAY NEVER BE OVERLAID (measured live
       2026-08-31: document.elementFromPoint at the Confirm button's own centre
       returned #mlsAthenaUnifiedFix, so physical clicks on Confirm & Send did
       nothing at all). The old card was ONE scrolling box whose last child was
       a position:sticky footer: a sticky box shares its coordinate space with
       everything that scrolls beneath it, so which one wins a hit test comes
       down to paint order and stacking - one competing z-index, transform or
       stacking context anywhere in the card and the doctor's click lands on
       the wrong element.
       The cure is geometric, not a bigger z-index. The card is now a COLUMN
       FLEX CONTAINER with exactly two children: a scrolling body and a static
       footer. Two in-flow siblings of a column flex container cannot occupy
       the same pixels - no sticky, no absolute, no negative margin - so the
       Confirm button's box cannot intersect anything inside the body, whatever
       the stacking. tests/sheet-clarity.test.js pins that shape. */
    var card = document.createElement('div'); card.style.cssText = 'background:#fff;color:#1A211C;width:min(720px,96vw);max-height:92vh;display:flex;flex-direction:column;overflow:hidden;border-radius:16px;box-shadow:0 24px 70px rgba(10,30,70,.42);font:13px/1.5 system-ui';
    card.innerHTML =
      '<div id="mlsAthenaUnifiedBody" style="flex:1 1 auto;min-height:0;overflow:auto;padding:20px 22px 4px">' +
      (probeOnlyActive() ? '<div id="mlsAthenaProbeOnlyBanner" style="margin:0 0 12px;padding:10px 12px;border:2px solid #8b2525;background:#fdf2f2;color:#8b2525;border-radius:10px;font-weight:850">' + esc(PROBE_ONLY_BANNER) + '</div>' : '') +
      /* wfclar-1.0.0 (owner 2026-08-27: "make it easy and simple"): the header
         now leads with WHO and WHICH VISIT - the one thing it did NOT say, and
         the thing the doctor most needs at a glance; until now it was folded
         away inside the identity drawer.
         MEASURED, AND THE REASON THE SENTENCE BELOW IT STAYED: that sub-line
         reads like a duplicate of the Nothing-has-changed-yet block, and it is
         not. athena-unified-confirmation-contract pins BOTH of its capability
         branches by exact wording - the capability-off "Only reviewed note
         write and Save Draft can be confirmed here" and the capability-on
         "...run only after their own explicit confirmation" - and neither
         sentence exists anywhere else on the sheet. Deleting it silently drops
         a disclosure of what MLS is allowed to do at all. It stays. */
      '<div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1"><div id="mlsAthenaUnifiedTitle" style="font-size:20px;font-weight:850;color:#204034">Send to Athena</div>' + (generationIssue ? '' : '<div style="color:#204034;font-weight:700;margin-top:3px">' + esc(unifiedWhoLine(manifest)) + '</div>') + '<div style="color:#52675c;margin-top:3px">' + (generationIssue ? (esc(S(manifest.patient.name) || 'This note') + ' &middot; generate the missing or stale five-field clinical draft locally first; no Athena write is available until the rebuilt rows pass the exact encounter check.') : (athenaFinalActionsReady() ? 'Reviewed note writes, Save Draft, billing staging, Sign &amp; Save, and each supported catalog-bound order run only after their own explicit confirmation; medication and injection orders stay yours in Athena.' : 'Only reviewed note write and Save Draft can be confirmed here; signing, billing and orders stay yours in Athena.')) + '</div></div><button type="button" id="mlsAthenaUnifiedClose" aria-label="Close Athena review" style="border:0;background:none;font-size:23px;color:#66766d;cursor:pointer">&times;</button></div>' +
      unifiedNoteHeroHtml(manifest) +
      unifiedCanonicalGenerationHtml(state) +
      rowsHtml +
      '<div id="mlsAthenaUnifiedContext" style="margin-top:12px;padding:10px 12px;border:1px solid #cfe0d7;background:#f7fbf9;border-radius:10px;color:#204034;overflow-wrap:anywhere"><b>Exact Athena encounter:</b> ' + (generationIssue ? 'kept fail-closed while the five local draft fields are generated.' : 'being verified read-only now.') + '</div>' +
      /* sheetclar-1.0.0: the one thing a scanning doctor reads - the state word
         and one short sentence. Derived from measured state (paintSheetclarState),
         so it can never claim more than the gates allow. */
      '<div id="mlsAthenaUnifiedState" role="status" aria-live="polite" style="margin-top:11px" data-mls-sheet-state="' + (generationIssue ? 'NEEDS ONE STEP' : 'CHECKING') + '"><div data-mls-state-word="1" style="font-size:19px;line-height:1.2;font-weight:900;letter-spacing:.3px;color:' + (generationIssue ? '#7a5a16' : '#6d5010') + '">' + (generationIssue ? 'NEEDS ONE STEP' : 'CHECKING') + '</div><div data-mls-state-short="1" style="margin-top:3px;color:#385b49;font-size:12.5px">' + (generationIssue ? 'No Athena check or write has started. Generate the five local draft fields first; nothing here can be sent until they pass.' : 'MLS is reading the exact Athena chart read-only. Nothing has been sent.') + '</div></div>' +
      /* wfprog-1.1.0 lives with the words it belongs to: the read-only ladder is
         the LONG stretch, and its bar was rendered far below the state line, off
         the bottom of a scrolled sheet. It is the second thing you read now. */
      '<div id="mlsAthenaUnifiedProgress" role="status" aria-live="polite" style="display:none;margin-top:11px"></div>' +
      /* sheetclar-1.0.0: the full honest sentence, unchanged, one fold below the
         state word. #mlsAthenaUnifiedProbe keeps EXACTLY the textContent it has
         always had; a refusal opens this disclosure itself, so nothing that says
         "MLS refused" is ever hidden. */
      /* data-mls-clunky-seen="1" is deliberate: the shell's clunky-athena-1.0.0
         fold pass closes every <details> in this sheet exactly once, and this
         one's open state is owned here - a refusal must force it OPEN. Wearing
         that pass's own "already handled" mark keeps the two from fighting. */
      '<details id="mlsAthenaUnifiedDetails" data-mls-clunky-seen="1" style="margin-top:7px"><summary style="cursor:pointer;font-weight:750;color:#52675c;font-size:11.5px">What MLS is doing, in full</summary>' +
      '<div id="mlsAthenaUnifiedProbe" role="status" style="margin-top:6px;color:#6d5010">' + (generationIssue ? 'No Athena check or write has started. Generate the local fields first.' : 'Checking the exact chart read-only &mdash; nothing is sent yet.') + '</div></details>' +
      /* mrnadopt-1.0.0: what MLS changed in the patient record to unblock this
         review, stated durably. The status line above is repainted by the very
         next read-only check, so a transient sentence would vanish before the
         doctor read it. Rendered only when an adoption actually happened. */
      mrnAdoptNoteHtml(state) +
      /* wfdx-1.0.0: a PHI-free one-liner (extension version, athenaOne tab
         count, expected day, whether an appointment id is bound, and the day
         athenaOne is really on) plus the read-only buttons that fix it. */
      '<div id="mlsAthenaUnifiedDiag" style="display:none;margin-top:6px;font-size:11.5px;color:#52675c;overflow-wrap:anywhere"></div>' +
      /* sheetclar-1.0.0: position:static is deliberate and pinned. This strip is
         the surface that was measured on top of Confirm & Send; it stays in
         normal flow inside the scrolling body, ABOVE the footer, and never
         becomes a positioned box that could share the footer's pixels. */
      '<div id="mlsAthenaUnifiedFix" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;position:static"></div>' +
      '<div id="mlsAthenaUnifiedSafety" style="margin-top:10px;padding:9px 11px;border:1px solid #f0d79a;background:#fff7e6;border-radius:9px;color:#6d5010"><b>Nothing has changed yet.</b> ' + (generationIssue ? 'Generate / Regenerate updates only the local MLS draft through the normal validation and persistence gate. It never binds an encounter and never writes Athena; the rebuilt review must still pass exact patient, appointment, and destination checks.' : (athenaFinalActionsReady() ? 'One READY row is pre-selected and checked read-only; each Confirm &amp; Send click runs exactly that one action, and MLS never retries or auto-chains. Sign &amp; Save unlocks only after a verified note write; a reviewed catalog-bound order places only that item; prescriptions and claim submission stay yours in Athena.' :'One READY note row is pre-selected and checked read-only; each Confirm &amp; Send click runs exactly that one action, and MLS never retries or auto-chains. Billing, orders, prescriptions, signature, attestation, and claim submission stay yours in Athena.')) + '</div>' +
      wfxEvidenceHtml(state) + /* wfx-1.0.0: W1 staleness, W2 contradiction screen, W4 completeness tally */
      unifiedIdentityHtml(manifest) +
      /* wfprog-1.0.0: the send's own loading surface - which section, N of M,
         and a settled verdict per section - now rendered up with the state line
         (sheetclar-1.0.0), where the doctor is already looking. */
      '<div id="mlsAthenaUnifiedReceipt" style="margin-top:11px"></div>' +
      '</div>' + /* /#mlsAthenaUnifiedBody - everything above scrolls; the footer below does not */
      /* sheetux-1.0.0: ONE primary send button. "Send checked sections" and
         "Confirm & Send to Athena" were the same act described twice, so the
         second one is gone and this one drives both lanes (see
         runUnifiedPrimarySend). Bolder fill, taller hit area, real shadow -
         the owner could not tell which button was the send.
         sheetclar-1.0.0 RE-PINNED (was position:sticky;bottom:0;z-index:3): the
         footer is a static flex ROW that is the card's own second flex item, so
         it shares no pixels with the scrolling body above it. Cancel and
         Confirm & Send are the only two controls in it, and nothing else in the
         sheet can ever be painted over them. */
      '<div id="mlsAthenaUnifiedFooter" style="display:flex;gap:9px;align-items:center;flex:0 0 auto;position:static;background:#fff;border-top:1px solid #e4e9e6;padding:12px 22px 14px"><button type="button" id="mlsAthenaUnifiedCancel" style="border:1px solid #d8ddd9;background:#fff;border-radius:10px;padding:11px 16px;font-weight:750;cursor:pointer">Cancel</button><button type="button" id="mlsAthenaUnifiedGo" disabled aria-disabled="true" style="flex:1;border:0;background:#204034;color:#fff;border-radius:11px;padding:15px 18px;font-size:15.5px;font-weight:900;letter-spacing:.2px;box-shadow:0 2px 0 #14261d,0 7px 18px rgba(32,64,52,.30);cursor:pointer">Confirm &amp; Send to Athena</button></div>';
    ov.appendChild(card); document.body.appendChild(ov);
    var cancel = card.querySelector('#mlsAthenaUnifiedCancel'), close = card.querySelector('#mlsAthenaUnifiedClose'), go = card.querySelector('#mlsAthenaUnifiedGo');
    cancel.onclick = closeUnifiedConfirmation; close.onclick = closeUnifiedConfirmation;
    ov.addEventListener('click', function (ev) { if (ev.target === ov && !state.running && !state.generating) closeUnifiedConfirmation(); });
    /* sheetux-1.0.0: the ONE primary button routes to the existing drivers -
       the bx-1.0.0 batch queue for checked note sections, the legacy one-row
       execute for a selected Save / Sign / order row. No new send loop. */
    go.addEventListener('click', function () { runUnifiedPrimarySend(state, go); });
    var bxBoxes = card.querySelectorAll('input.mls-bx-check');
    for (var bxi = 0; bxi < bxBoxes.length; bxi++) bxBoxes[bxi].addEventListener('change', function () { unifiedSyncPrimaryButton(state); });
    /* sheetclar-1.0.0 (owner 2026-08-31, measured live: the one READY section's
       "Send this section" box arrived UNCHECKED, so the big Confirm & Send sat
       grayed with "Check at least one READY note section first" - a pointless
       extra step on a sheet with exactly one section, and it reads like a
       malfunction).
       The markup has always carried `checked`, but a markup `checked` is only
       the DEFAULT value: the browser is free to hand back a restored state
       instead (bfcache / soft reload / restored form state), and then the
       source says checked while the control is not. Decide it here, from the
       MANIFEST, after the control exists - the arriving state is then the one
       this code chose, not one restored from somewhere else.
       This only SELECTS. It cannot send: Confirm stays a human click and still
       demands its own validated read-only probe and one-use token per row. */
    for (var bxd = 0; bxd < bxBoxes.length; bxd++) {
      if (unifiedDefaultChecked(unifiedRow(manifest, bxBoxes[bxd].getAttribute('data-mls-bx-row')))) bxBoxes[bxd].checked = true;
    }
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
    /* sheetux-1.0.0: paint the merged button's zero-checked refusal (and its
       reason) BEFORE the receipt render and BEFORE the opening probe, so the
       probe's own disable and "Nothing left to send" both still get the last
       word over it. */
    try { unifiedSyncPrimaryButton(state); } catch (eSync0) {}
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

  /* ========================================================================
     mrnadopt-1.0.0 (2026-08-27) -- THE MRN IS ADOPTED, NEVER ASSUMED.

     Owner 2026-08-19: "name+DOB is enough to write - warn + confirm when no
     MRN". Owner 2026-08-27, looking at a review sheet where every row read
     BLOCKED - NOTHING SENT: "I hate how much is greyed out... it should be
     seamless and always work".

     The obvious edit - drop `!patient.mrn` from the identity predicate - is
     the WRONG one, and would be worse than the gray. The installed MLS Assist
     refuses a staged section write unless the APP supplies the exact name, a
     parseable DOB and a digit MRN; a row painted READY on a row with no MRN
     could therefore only ever end in a refusal at check time. The honest cure
     is to GET the MRN: athenaOne's own chart banner has it, the extension
     already exposes a read-only identity verb for it (mlsAppChartIdentity ->
     { ok, identity:{ name, dob, mrn } }), and the local patient row is simply
     missing a field the chart can prove.

     So: when the sheet opens blocked and the MRN is the ONE missing identity
     field, read the OPEN chart's identity read-only, and adopt its MRN only
     when that chart is provably this patient - the file's own name matcher
     AND exact DOB equality, the same pair the driver's own gate uses. Then
     persist it onto the local row through window.upsertPatient (a CLONE, never
     an in-place mutation), read the store back to prove it landed, and rebuild
     the review through the SAME entry point every other cure uses. The rows go
     ready HONESTLY, because the identity the extension demands now exists.

     It refuses, loudly and without changing anything, on: no chart open, an
     unreadable chart DOB, a name or DOB that does not match, a chart with no
     MRN, a timed-out or malformed read, a patient switch mid-read, a local row
     that already carries a DIFFERENT MRN (that is a conflict, not an
     enrichment), and a write the store does not read back. Nothing here can
     write to Athena: the only verb it sends is the read-only identity verb.

     Reversible: window.__mlsWriteFlow.mrnAdopt.revert().
     ======================================================================== */
  var mrnAdoptOff = false, mrnAdoptLast = null, mrnAdoptRunning = false, mrnAdoptReopened = {};
  var MRNADOPT_PROBE_MS = 12000;
  function mrnAdoptBlockReason(patient) {
    var who = S(patient && patient.name).trim();
    var whose = who ? (who + '\'s') : 'this patient\'s';
    return 'MLS does not have ' + whose + ' Athena MRN yet, and MLS Assist refuses a section write without it. Open ' +
      (who || 'this patient') + '\'s chart in athenaOne, then press Check Athena again - MLS reads the MRN off the verified chart and unblocks these rows automatically. Nothing is sent.';
  }
  /* The one predicate: every identity field except the MRN is present. */
  function mrnAdoptCurable(patient) {
    patient = patient || {};
    return !!S(patient.patientId).trim() && !!S(patient.name).trim() && !!S(patient.dob).trim() && !S(patient.mrn).trim();
  }
  function mrnAdoptRowMrn(row) { return nrmId(S(row && (row.mrn || row.athenaId || row.athena_id)).trim()); }
  /* A store row is replaced WHOLE by upsertPatient, so the clone must carry
     every own field forward; only the two MRN fields and their PHI-free
     provenance stamp are added. Never mutate the stored object in place. */
  function mrnAdoptShallowClone(row) {
    var out = {};
    try { Object.keys(row || {}).forEach(function (k) { out[k] = row[k]; }); } catch (e) {}
    return out;
  }
  function mrnAdoptLocalRow(patientId) {
    var want = S(patientId).trim();
    if (!want) return null;
    var rows = [];
    try { if (typeof window.getPatients === 'function') rows = window.getPatients() || []; } catch (e) { return null; }
    if (!Array.isArray(rows)) return null;
    for (var i = 0; i < rows.length; i++) if (rows[i] && S(rows[i].id).trim() === want) return rows[i];
    for (var j = 0; j < rows.length; j++) if (rows[j] && S(rows[j].patientId).trim() === want) return rows[j];
    return null;
  }
  /* The read-only identity verb, uncorrelated on purpose: MLS Assist 3.0.8x
     replies to mlsAppChartIdentity WITHOUT echoing a request id, so demanding
     one would drop every real answer. The identity gate below - not the
     transport - is what makes a stolen or stale answer harmless. */
  function mrnAdoptProbe() {
    var requestId = 'wfmrn-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
    var call;
    try { call = bridge('mlsAppChartIdentity', { requestId: requestId }, 'mlsAppChartIdentityResult', MRNADOPT_PROBE_MS); }
    catch (e) { return Promise.resolve({ __failed: true }); }
    return Promise.resolve(call).then(function (resp) { return resp && typeof resp === 'object' ? resp : { __failed: true }; },
      function () { return { __failed: true }; });
  }
  /* Adoption is a POSITIVE proof, never the absence of a contradiction: the
     chart must name a matching person AND carry a usable MRN. Anything else
     is a named refusal. */
  function mrnAdoptClassify(resp, frozen) {
    resp = resp || {}; frozen = frozen || {};
    if (resp.__failed === true || resp.__timeout === true) return { ok: false, code: 'chart-read-uncertain' };
    if (resp.ok !== true) return { ok: false, code: resp.timedOut === true ? 'chart-read-uncertain' : 'no-chart-open' };
    var ident = resp.identity;
    if (!ident || typeof ident !== 'object' || Array.isArray(ident)) return { ok: false, code: 'no-chart-open' };
    var chartName = S(ident.name).trim(), chartDob = S(ident.dob).trim(), chartMrn = S(ident.mrn || ident.athenaId).trim();
    if (!chartName) return { ok: false, code: 'no-chart-open' };
    var wantDob = nrmDob(frozen.dob), gotDob = nrmDob(chartDob);
    if (!gotDob) return { ok: false, code: 'chart-dob-unreadable' };
    if (!wantDob || !nameMatch(chartName, frozen.name) || wantDob !== gotDob) return { ok: false, code: 'chart-identity-mismatch' };
    if (!nrmId(chartMrn)) return { ok: false, code: 'chart-mrn-absent' };
    return { ok: true, code: 'exact-chart-match', mrn: chartMrn };
  }
  /* PRESENCE IS NOT PROVENANCE: the store is read back and must itself name
     this exact MRN before the review is allowed to rebuild. */
  function mrnAdoptPersist(patientId, mrn) {
    var digits = nrmId(mrn);
    if (!digits) return { ok: false, code: 'chart-mrn-absent' };
    var row = mrnAdoptLocalRow(patientId);
    if (!row) return { ok: false, code: 'local-row-missing' };
    var existing = mrnAdoptRowMrn(row);
    if (existing && existing !== digits) return { ok: false, code: 'mrn-conflict' };
    if (!existing) {
      if (typeof window.upsertPatient !== 'function') return { ok: false, code: 'store-unavailable' };
      var next = mrnAdoptShallowClone(row);
      next.mrn = S(mrn).trim();
      next.athenaId = S(mrn).trim();
      next.mrnSource = 'athena-chart-identity';
      next.mrnVerifiedAt = Date.now();
      try { window.upsertPatient(next); } catch (eUpsert) { return { ok: false, code: 'store-refused' }; }
    }
    var back = mrnAdoptLocalRow(patientId);
    if (!back || mrnAdoptRowMrn(back) !== digits) return { ok: false, code: 'not-persisted' };
    return { ok: true, code: existing ? 'already-on-file' : 'adopted', patient: back, mrn: S(back.mrn || back.athenaId).trim() };
  }
  var MRNADOPT_REFUSALS = {
    'no-chart-open': 'No athenaOne chart is open for MLS to read, so the MRN could not be picked up. Open the chart in athenaOne, then press Check Athena again. Nothing was changed.',
    'chart-read-uncertain': 'athenaOne did not settle enough for MLS to read the open chart, so nothing was adopted. Let the chart finish loading, then press Check Athena again. Nothing was changed.',
    'chart-dob-unreadable': 'MLS could not read a date of birth off the open athenaOne chart, so it will not assume this is the right patient. Nothing was changed.',
    'chart-identity-mismatch': 'The chart open in athenaOne is not this patient - its name and date of birth do not both match. MLS adopts an MRN only from a chart it can prove. Nothing was changed.',
    'chart-mrn-absent': 'The open athenaOne chart shows no patient ID for MLS to adopt. Nothing was changed.',
    'mrn-conflict': 'This patient already has a DIFFERENT MRN on file in MLS, and the open athenaOne chart shows another one. MLS will not overwrite a stored MRN - resolve the conflict in the patient record first. Nothing was changed.',
    'local-row-missing': 'MLS could not find this patient in the local record, so nothing was adopted or changed.',
    'store-unavailable': 'This page cannot save to the local patient record, so the MRN was not adopted. Nothing was changed.',
    'store-refused': 'The local patient record refused the MRN save, so nothing was adopted or changed.',
    'not-persisted': 'The MRN did not persist to the local patient record, so MLS is not treating it as adopted. Nothing was changed.',
    'patient-changed': 'The active patient changed while MLS was reading the chart, so nothing was adopted or changed.'
  };
  function mrnAdoptRefusal(code) {
    return MRNADOPT_REFUSALS[S(code)] || 'The MRN could not be picked up from athenaOne. Nothing was changed.';
  }
  function mrnAdoptNoteHtml(state) {
    var note = S(state && state.sourceOpts && state.sourceOpts.mrnAdoptedNote).trim();
    if (!note) return '';
    return '<div id="mlsAthenaUnifiedMrnNote" data-mls-mrn-adopted="1" style="margin-top:8px;padding:9px 11px;border:1px solid #cfe0d7;background:#f2f9f5;border-radius:9px;color:#205c43;font-size:12px"><b>MRN picked up from athenaOne.</b> ' + esc(note) + '</div>';
  }
  function mrnAdoptNoteFor(patientName, alreadyOnFile) {
    var who = S(patientName).trim() || 'this patient';
    return alreadyOnFile
      ? ('MLS already had ' + who + '\'s Athena MRN on file, so this review was rebuilt from the current patient record. Nothing was sent.')
      : ('MLS read ' + who + '\'s MRN off the verified athenaOne chart - the chart\'s name and date of birth both matched this patient - and saved it to the MLS patient record, so these rows can now be checked and sent. Nothing was sent.');
  }
  /* Rebuild, never mutate: the adopted identity is overlaid on THIS review's
     own options and the whole review is re-opened through the same entry point
     the bind cure and the order-accept path use, so every hash recomputes. The
     adoption sentence rides along so the rebuilt sheet can state, durably, what
     just changed in the patient record - the transient status line is repainted
     by the very next read-only check. */
  function mrnAdoptReopen(state, adoptedMrn, patientName, alreadyOnFile) {
    var o0 = state.sourceOpts || {}, next = {}, k;
    for (k in o0) if (Object.prototype.hasOwnProperty.call(o0, k)) next[k] = o0[k];
    var basePt = (o0 && o0.patient) ? o0.patient : (state.manifest && state.manifest.patient) || {};
    var nextPt = mrnAdoptShallowClone(basePt);
    nextPt.mrn = S(adoptedMrn).trim();
    nextPt.athenaId = S(adoptedMrn).trim();
    next.patient = nextPt;
    next.previewHash = '';                                   /* identity changed - recompute honestly */
    next.receiptSessionId = S(state.manifest && state.manifest.receiptSessionId);
    next.mrnAdoptedNote = mrnAdoptNoteFor(patientName, alreadyOnFile);
    openUnifiedConfirmation(next);                           /* closes this review itself */
    return unifiedAthenaState && unifiedAthenaState !== state ? unifiedAthenaState : null;
  }
  function mrnAdoptSettleOk(state, next, patientName, adoptedMrn, alreadyOnFile) {
    var target = next || state;
    if (!target || target.closed) return;
    var rows = (target.manifest && target.manifest.rows) || [];
    var ready = rows.filter(function (row) { return row && row.capability === 'ready' && row.action; }).length;
    unifiedStatus(target, mrnAdoptNoteFor(patientName, alreadyOnFile) + ' ' + (ready
      ? 'The Athena rows are being checked read-only now.'
      : 'Any rows still blocked now name a different reason.'), 'ok');
    mrnAdoptLast = { at: Date.now(), adopted: !alreadyOnFile, mrnPresent: !!nrmId(adoptedMrn), readyRows: ready };
  }
  /* Returns TRUE when this pass has taken ownership of the sheet's next step
     (a read is in flight, or the review was rebuilt); FALSE means "not my
     case" and the caller proceeds exactly as before. */
  function mrnAdoptPass(state) {
    if (mrnAdoptOff || mrnAdoptRunning || athenaActionRunning) return false;
    if (!state || state.closed || state.running || state.halted || unifiedAthenaState !== state) return false;
    var manifest = state.manifest;
    if (!manifest || !manifest.patient || !mrnAdoptCurable(manifest.patient)) return false;
    if (syntheticLocalRuntime()) return false;               /* the demo never reads live Athena */
    var frozen = { patientId: S(manifest.patient.patientId).trim(), name: S(manifest.patient.name).trim(), dob: S(manifest.patient.dob).trim() };
    var row = mrnAdoptLocalRow(frozen.patientId);
    if (!row) return false;                                  /* nothing to enrich - keep the honest block */
    /* The stored row may already hold the MRN this review was built without
       (a stale patient snapshot). That needs no Athena read at all - rebuild
       from the record. Guarded so one identity can rebuild only once. */
    var onFile = mrnAdoptRowMrn(row);
    if (onFile) {
      var seen = frozen.patientId + '|' + onFile;
      if (mrnAdoptReopened[seen]) return false;
      mrnAdoptReopened[seen] = 1;
      var onFileMrn = S(row.mrn || row.athenaId).trim();
      /* Deferred one turn on purpose: this pass is called FROM inside
         openUnifiedConfirmation, and re-entering that entry point
         synchronously would leave the outer call finishing against a review it
         had already replaced. */
      Promise.resolve().then(function () {
        if (!state || state.closed || unifiedAthenaState !== state) return;
        var reopenedNow = mrnAdoptReopen(state, onFileMrn, frozen.name, true);
        mrnAdoptSettleOk(state, reopenedNow, frozen.name, onFile, true);
      });
      return true;
    }
    if (typeof window.getPatients !== 'function' || typeof window.upsertPatient !== 'function') return false;
    var generation = state.probeGeneration;
    mrnAdoptRunning = true;
    /* Any throw between here and the settle would strand the lane's own busy
       flag and wedge every later retry, so nothing between them is unguarded. */
    try {
      unifiedStatus(state, 'Reading the open athenaOne chart read-only to pick up ' + (frozen.name || 'this patient') + '\'s MRN. Nothing is sent...', '');
    } catch (eSay) {}
    function mrnAdoptRefuse(code) {
      mrnAdoptRunning = false;
      mrnAdoptLast = { at: Date.now(), adopted: false, code: code };
      try { wfdxNote({ verb: 'mlsAppChartIdentity', stage: 'mrn-adopt', ok: false, reason: code }); } catch (eNote) {}
      if (!state || state.closed || unifiedAthenaState !== state) return;
      unifiedStatus(state, mrnAdoptRefusal(code), 'err');
      /* Repaint the strip so the disabled retry button is replaced by a live
         one - a refusal must always leave the doctor something to press. */
      try { wfdxShowFixStrip(state, ''); } catch (eStrip) {}
    }
    mrnAdoptProbe().then(function (resp) {
      mrnAdoptRunning = false;
      if (!state || state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
      var verdict = mrnAdoptClassify(resp, frozen);
      if (!verdict.ok) { mrnAdoptRefuse(verdict.code); return; }
      /* The patient must still be the one this read was started for. */
      if (!mrnAdoptCurable(state.manifest && state.manifest.patient) ||
          S(state.manifest.patient.patientId).trim() !== frozen.patientId ||
          nrmName(state.manifest.patient.name) !== nrmName(frozen.name) ||
          nrmDob(state.manifest.patient.dob) !== nrmDob(frozen.dob)) { mrnAdoptRefuse('patient-changed'); return; }
      var saved = mrnAdoptPersist(frozen.patientId, verdict.mrn);
      if (!saved.ok) { mrnAdoptRefuse(saved.code); return; }
      var key = frozen.patientId + '|' + nrmId(saved.mrn);
      mrnAdoptReopened[key] = 1;
      var reopened = mrnAdoptReopen(state, saved.mrn, frozen.name, saved.code === 'already-on-file');
      /* AFTER the reopen: opening a review resets the PHI-free receipt strip,
         so a note written before it would be wiped out of the very report the
         doctor copies from the rebuilt sheet. */
      try { wfdxNote({ verb: 'mlsAppChartIdentity', stage: 'mrn-adopt', ok: true, reason: 'mrn-adopted' }); } catch (eNote2) {}
      mrnAdoptSettleOk(state, reopened, frozen.name, saved.mrn, saved.code === 'already-on-file');
    }, function () { mrnAdoptRefuse('chart-read-uncertain'); });
    return true;
  }
  /* The sheet's own retry. A review blocked only for the MRN paints no READY
     row, so the probe path's own "Check Athena again" never appears - without
     this control the Why sentence would name a button that is not there. */
  function mrnAdoptOfferCure(state, host) {
    if (!state || state.closed || !host || mrnAdoptOff) return false;
    if (!mrnAdoptCurable(state.manifest && state.manifest.patient)) return false;
    try { if (host.querySelector('[data-mls-mrn-adopt]')) return false; } catch (eQ) {}
    var btn = wfdxButton('Check Athena again',
      'Read-only: reads the chart open in athenaOne and, when its name and date of birth both match this patient, saves that chart\'s MRN to the MLS patient record so these rows can be sent. Nothing is written to Athena.',
      function (b) {
        if (b) { b.disabled = true; b.textContent = 'Reading athenaOne...'; }
        var started = false;
        try { started = mrnAdoptPass(state) === true; } catch (eRun) { started = false; }
        if (!started && b) { b.disabled = false; b.textContent = 'Check Athena again'; }
      });
    btn.setAttribute('data-mls-mrn-adopt', '1');
    host.appendChild(btn);
    return true;
  }
  try {
    window.__mlsMrnAdopt = { v: 'mrnadopt-1.0.0',
      state: function () { return { off: mrnAdoptOff, running: mrnAdoptRunning, last: mrnAdoptLast }; },
      revert: function () { mrnAdoptOff = true; return true; } };
  } catch (eMA0) {}
  /* ===== end mrnadopt-1.0.0 =============================================== */

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
    var state = { manifest: manifest, sourceOpts: opts, reopenOpts: null, selectedRowId: '', probe: null, probeGeneration: 0, probeSettled: 0, receipts: {}, running: false, generating: false, binding: false, halted: false, closed: false, batchRunning: false, returnFocus: returnFocus, a11yKeyHandler: null, autoOpened: false };
    state.reopenOpts = reopenOptions(opts, manifest);
    srrArmIfUnbound(state); /* srr-1.0.0 */
    unifiedAthenaState = state;
    if (typeof document !== 'undefined' && document.body) renderUnifiedConfirmation(state);
    /* mrnadopt-1.0.0: the auto-bind below refuses outright without an MRN
       (it will not bind against a chart it cannot positively identify), so the
       adoption pass runs FIRST and only when the MRN is the single missing
       identity field. When it adopts it re-enters this same entry point, which
       runs the auto-bind on the rebuilt review; when it does not apply the
       original ordering is untouched. */
    var mrnAdopting = false;
    try { mrnAdopting = mrnAdoptPass(state) === true; } catch (eMA) { mrnAdopting = false; }
    /* p1-autobind-2.0.0: if the visit is unbound, use its exact imported appointment
       and request-bound provider headers to read the matching encounter instead of
       telling him to go run a day pull. Fails closed; see the block above. */
    if (!mrnAdopting) { try { p1AutoBindEncounter(state); } catch (eP1AB) {} }
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
  /* wfgen-1.0.0 (owner 2026-09-01, "it should work for everyone"): FOLD THE
     RENDERING, NEVER THE RULE.

     THE DEFECT, in the shipped normalizer. `[^a-z0-9 ] -> space` deletes every
     letter that is not plain ASCII, so a name carrying a diacritic is not
     normalized, it is TRUNCATED: "Garcia" with an accented i became the token
     "garc" plus the stray "a". The write chain's identity lock
     (validatedUnifiedProbe) demands >=2 overlapping tokens between the name MLS
     holds and the name Athena's own read-only reply reports, so the moment ONE
     of those two surfaces spells the name with the accent and the other does
     not - which is the ordinary case, because an EMR banner, a schedule cell
     and a typed patient row are three different renderings - the tokens no
     longer overlap and the write refuses. It refuses SAFELY: nothing is written
     to the wrong chart. But it refuses for that patient forever, and no message
     on the sheet can tell the doctor why, because nothing is actually wrong.

     Stripping the combining marks is the same normalization applied to both
     sides of the comparison. It cannot admit a pair the rule below would
     otherwise reject on substance: two-token overlap is unchanged, exact DOB
     equality is unchanged, MRN equality when MRN is known is unchanged, and
     Athena's own response identity is still recorded on the receipt (W3). */
  function wfFoldMarks(v) {
    /* Combining marks are U+0300..U+036F. Filtered by code point on purpose:
       this file is written through a latin1 pipeline, so it may not carry a
       non-ASCII byte anywhere - not even inside a character class. */
    try {
      if (!v || typeof v.normalize !== 'function') return v;
      var d = v.normalize('NFD'), out = '';
      for (var i = 0; i < d.length; i++) { var c = d.charCodeAt(i); if (c >= 768 && c <= 879) continue; out += d.charAt(i); }
      return out;
    } catch (e) {}
    return v;
  }
  /* The fold is applied through a guard on purpose: several suites LIFT nrmName
     out of this file as a standalone slice and evaluate it alone, and a bare
     call to a helper that did not come with it would throw where the shipped
     code cannot. A missing fold degrades to the old normalization - never to an
     exception, and never to a looser rule. */
  function nrmName(s) {
    var v = S(s);
    try { v = wfFoldMarks(v); } catch (e) {}
    return v.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  /* A WELDED rendering ("AdaSample" from a textContent read of two elements,
     "MaryJane" from a hyphen the surface dropped) is ONE token to the
     normalizer and can never overlap the spaced spelling. Splitting on the
     lower-to-upper boundary recovers it - but it also splits real names
     ("McDonald" -> "mc donald"), so it is a RETRY, never a replacement: it runs
     only after the plain comparison has already declined, so no pair that
     matched before can stop matching now. Same shape as
     _athenaHistoryNameCompatible's own camel retry in the app shell. */
  function nrmNameCamel(s) { return nrmName(S(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2')); }
  function nameTokens(normalized) { return S(normalized).split(' ').filter(function (x) { return x.length > 1; }); }
  function nameOverlapOk(ta, tb) {
    if (!ta.length || !tb.length) return false;
    var o = ta.filter(function (x) { return tb.indexOf(x) >= 0; }).length;
    return o >= 2 || (o >= 1 && Math.min(ta.length, tb.length) === 1);
  }
  function nameMatch(a, b) {
    var na = nrmName(a), nb = nrmName(b);
    var ta = nameTokens(na), tb = nameTokens(nb);
    if (nameOverlapOk(ta, tb)) return true;
    var ca = nrmNameCamel(a), cb = nrmNameCamel(b);
    if (ca === na && cb === nb) return false;      /* nothing was welded - the answer above stands */
    return nameOverlapOk(nameTokens(ca), nameTokens(cb));
  }
  /* isodob-1.0.0 (owner 2026-09-01, "it should work for everyone").
     THE WRITE CHAIN COULD NOT READ AN ISO DATE OF BIRTH, AND SAID SO AS AN
     IDENTITY REFUSAL. The reader below is M/D/Y only, and it does not DECLINE
     an ISO date - it MISREADS one. Run left to right over "1962-03-04" the
     M/D/Y pattern first matches at the "2-03-04" that starts inside the year,
     so the date of birth 4 March 1962 was read as 3 February 2004. The same
     string on the chart banner ("03/04/1962") reads correctly, so the two never
     compare equal and validatedUnifiedProbe refuses:
       "The read-only Athena check did not return a complete matching patient
        name, DOB, and MRN. Nothing was changed."
     Adam is stored M/D/Y and never met it. A patient stored the other way -
     which is what an ISO-shaped import produces, and exactly the shape
     idread-1.0.0 measured in the app shell for the PULL guard - could never be
     written to at all, with a message that blames Athena for the app's own
     reader.

     ISO IS READ FIRST, on its own anchored pattern, because a four-digit year
     in front is unambiguous. The M/D/Y branch is untouched, so no date that
     parsed before parses differently now. This makes one date read as itself;
     it can never make two different dates compare equal, and the equality the
     identity lock demands is unchanged. */
  function nrmDob(s) {
    var v = S(s), mo, dy, y;
    var iso = /\b(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/.exec(v);
    if (iso) { y = iso[1]; mo = Number(iso[2]); dy = Number(iso[3]); }
    else {
      var m = /([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})/.exec(v);
      if (!m) return '';
      var pivot = (new Date().getFullYear() % 100) + 1;
      y = m[3].length === 2 ? ((Number(m[3]) > pivot ? '19' : '20') + m[3]) : m[3];
      mo = Number(m[1]); dy = Number(m[2]);
    }
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
    assessment_and_plan: 'Athena encounter > Assessment & Plan',
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
    /* opbatch-1.0.0: a queue is stopped (never abandoned mid-write) and its
       progress surface removed before the sheet it drives is closed. */
    try { opBatchRevert(); } catch (e4) {}
    closeUnifiedConfirmation();
    closeActionConfirm();
    window.__mlsWriteFlow.installed = false;
  }

  /* ===== opbatch-1.0.0 =====================================================
     Owner, 2026-08-31, verbatim: "for the op notes wirght to atehna i sohuld
     be ab le to write a bunch of op ntoes at teh saem time."

     WHAT THIS IS. The op-note room already drafts a whole day in one press
     ("Draft all N op notes") and files the finished ones in one more ("Save
     all drafted"). The Athena write was the single step still done one note
     at a time: open the review, wait for READY, press Confirm, close, pick
     the next patient, repeat. This block makes that last stretch ONE press.

     WHAT THIS IS NOT. It is not a second write path, and it knows nothing
     about Athena. There are exactly TWO verbs here that reach the write lane
     at all, and both are the ones a human press already uses:

         window.pushHistoryNoteToAthena(id)   opens the SAME review
         runUnifiedPrimarySend(state, null)   is the SAME call the sheet's own
                                              #mlsAthenaUnifiedGo makes

     Everything the single-note press does still happens, per note, in full:
     its own read-only probe against the exact encounter, its own identity
     lock (patient, DOB, MRN, day, appointment binding), its own one-use
     token, its own receipt. A note that refuses for ANY reason is SKIPPED
     with the sheet's own words recorded and shown, and the queue moves to
     the next one. Nothing is retried, chained, guessed or re-derived here.

     THE FOUR INVARIANTS, restated because they are the whole safety of it:

       1. SEQUENTIAL. One athenaOne tab, one engine. "At the same time" means
          ONE CLICK STARTS THE QUEUE - never that two writes overlap. The next
          note is not opened until the previous review has been closed.

       2. NO NEW ACTION, EVER. OPBATCH_ACTIONS is a CLOSED allowlist of the
          only two actions a queue may drive. Sign & Save, billing staging and
          order placement are not in it and must never be added: the doctor
          signs each note himself, in athenaOne, per note. A review whose own
          primary plan would run anything outside that set is SKIPPED and the
          reason is named. (An open ban-list would rot the moment a new action
          shipped; this is the closed pin.)

       3. CANCELLABLE BETWEEN NOTES, NEVER MID-WRITE. Cancel is a flag, read
          before a note is opened and again after its review has closed. A
          write that has already started runs to its own receipt - abandoning
          one is exactly what makes an outcome uncertain.

       4. HALT ON UNCERTAINTY. The sheet sets state.halted when an outcome is
          uncertain. The queue stops there and says so, rather than opening
          the next chart while a partial mutation may be sitting in Athena.

     REFUSES TO START while a pull/import is running (the same engines
     __mlsDedupById.pullRunning() reads, plus the schedule importer's own
     lease/busy stamp), while any Athena review or action confirm is already
     open, and while a queue is already running.

     Public seam (also the test seam):
       window.__mlsOpBatchSend { start, cancel, status, eligible, ... }
     ==================================================================== */
  var OPBATCH_V = 'opbatch-1.0.0';
  /* THE CLOSED SET. Read invariant 2 above before touching this line. */
  var OPBATCH_ACTIONS = { write_note: 1, save_draft: 1 };
  var OPBATCH_OPEN_MS = 6000;      /* the review opens synchronously or not at all */
  var OPBATCH_READY_MS = 150000;   /* the same read-only bound the section queue uses */
  var OPBATCH_WRITE_MS = 180000;   /* the same write bound the section queue uses */
  var OPBATCH_CLOSE_MS = 700;      /* let the closed sheet settle before the next open */
  var OPBATCH_PHASE = {
    waiting: { t: 'Waiting', c: '#52675c' },
    opening: { t: 'Opening its review', c: '#6d5010' },
    check: { t: 'Checking Athena read-only', c: '#6d5010' },
    write: { t: 'Writing', c: '#6d5010' },
    written: { t: 'WRITTEN', c: '#205c43' },
    rehearsed: { t: 'REHEARSED', c: '#204034' },
    skipped: { t: 'SKIPPED', c: '#8b2525' },
    stopped: { t: 'NOT RUN', c: '#52675c' }
  };
  var opBatchRun = null;
  /* WHAT LANDED IN THIS BROWSER SESSION. Written only from a VERIFIED receipt,
     read only to make the queue SMALLER - it can never enable a note. A note
     already written is not offered again (and the op-note room's own count
     therefore falls as they land); a page reload forgets it and the sheet's
     own "the exact Athena field already holds text" refusal is what stops a
     duplicate then. */
  var opBatchSent = Object.create(null);

  function opBatchNorm(v) { return S(v).replace(/\s+/g, ' ').trim(); }
  /* The op-note room repaints itself from its own signals; a queue is not one
     of them, so it is told once when the count it prints has changed. */
  function opBatchNudgeRoom() {
    try { var d = window.__mlsOpDay; if (d && typeof d.refresh === 'function') d.refresh(); } catch (e) {}
  }
  function opBatchNotes() {
    try { return (typeof window.getNotes === 'function' ? window.getNotes() : []) || []; } catch (e) { return []; }
  }
  /* The app's own blank-token counter when it is on the page; the room's own
     fallback literal otherwise. A note with any unresolved placeholder never
     reaches the queue - and pushHistoryNoteToAthena refuses it again anyway. */
  function opBatchBlanks(text) {
    try { if (typeof window.opNoteBlankTokens === 'function') return (window.opNoteBlankTokens(text) || []).length; } catch (e) {}
    var m = S(text).match(/\[\[[a-z0-9_]+\]\]/gi);
    return m ? m.length : 0;
  }
  /* THE SAME THREE ENGINES __mlsDedupById.pullRunning() READS, plus the
     schedule importer's lease/busy stamp wfbind already honours. A queue
     started under a running import would fight it for the one athenaOne tab. */
  function opBatchPullRunning() {
    try { var D = window.__mlsDayHistoryPull; if (D && D.state && D.state.running) return true; } catch (e) {}
    try { var M = window.__mlsProvMonthPull; if (M && M.running) return true; } catch (e2) {}
    try {
      var E = window.__mlsEasyV32;
      if (E && typeof E.state === 'function') { var s = E.state(); if (s && s.pull && s.pull.running) return true; }
    } catch (e3) {}
    try { if (wfbindPullBusy()) return true; } catch (e4) {}
    return false;
  }
  /* ONE CHART RECORD, PRE-SCREENED THE WAY pushHistoryNoteToAthena WILL JUDGE
     IT. This exists for the QUEUE's shape and the button's count only. Every
     gate below is re-run by the real entry point, and the real entry point is
     the one that decides. Nothing here can make a note sendable. */
  function opBatchScreen(rec) {
    if (!rec || !S(rec.id)) return { ok: false, why: 'that note is no longer in the chart' };
    if (S(rec.kind) !== 'opnote') return { ok: false, why: 'that record is not an op note' };
    if (rec.isDraft) return { ok: false, why: 'still a draft - finish and save it to the chart first' };
    var body = S(rec.text || rec.soap || '');
    if (!opBatchNorm(body)) return { ok: false, why: 'it has no note text to send' };
    var blanks = opBatchBlanks(body);
    if (blanks) return { ok: false, why: blanks + ' unresolved field' + (blanks === 1 ? '' : 's') + ' still to fill in' };
    try {
      if (typeof window._athenaBindingForSavedRecord === 'function') {
        var b = window._athenaBindingForSavedRecord(rec);
        if (b && b.routeBlocked) return { ok: false, why: 'quarantined - its patient binding was not safe' };
        if (b && b.identityConflict) return { ok: false, why: 'its patient identity conflicts with the linked chart' };
      }
    } catch (eB) {}
    return { ok: true, why: '' };
  }
  function opBatchItem(rec) {
    return { id: S(rec.id), name: S(rec.patient), patientId: S(rec.patientId),
      body: opBatchNorm(S(rec.text || rec.soap || '')).slice(0, 400), phase: 'waiting', why: '', action: '' };
  }
  /* THE DAY'S OP NOTES, IN THE ORDER THE ROOM PAINTS THEM. window._opPrep is
     the op-note room's own row array and row._noteId is the chart record its
     save produced, so the queue is the day on screen - never the whole chart.
     An explicit id list (what the room's own button passes) is filtered by the
     same screen and never trusted: an id the screen refuses is reported, not
     queued. */
  function opBatchEligible(ids) {
    var want = null;
    if (Array.isArray(ids) && ids.length) { want = {}; ids.forEach(function (x) { if (S(x)) want[S(x)] = 1; }); }
    var byId = {};
    opBatchNotes().forEach(function (n) { if (n && S(n.id)) byId[S(n.id)] = n; });
    var order = [], rows = [];
    try { rows = window._opPrep || []; } catch (e) { rows = []; }
    for (var i = 0; i < rows.length; i++) { var nid = S(rows[i] && rows[i]._noteId); if (nid) order.push(nid); }
    if (want) Object.keys(want).forEach(function (k) { if (order.indexOf(k) < 0) order.push(k); });
    var seen = {}, items = [], refused = [];
    for (var j = 0; j < order.length; j++) {
      var id = order[j];
      if (seen[id]) continue;
      seen[id] = 1;
      if (want && !want[id]) continue;
      if (opBatchSent[id]) { if (want) refused.push({ id: id, why: 'already written into Athena in this session' }); continue; }
      var scr = opBatchScreen(byId[id]);
      if (!scr.ok) { if (want) refused.push({ id: id, why: scr.why }); continue; }
      items.push(opBatchItem(byId[id]));
    }
    return { items: items, refused: refused };
  }
  /* IS THE OPEN REVIEW THIS NOTE'S REVIEW? Identity is checked again here
     before anything is pressed - the sheet's own lock is the authority, this
     only refuses to press a sheet that is about a different patient or a
     different body of text (a rebind, a stale sheet, a race). */
  function opBatchSheetMatches(state, item) {
    try {
      if (!state || state.closed || !state.manifest || !item) return false;
      var p = state.manifest.patient || {};
      if (S(item.patientId) && S(p.patientId) && S(p.patientId).trim() !== S(item.patientId).trim()) return false;
      if (S(item.name) && S(p.name) && !nameMatch(p.name, item.name)) return false;
      if (!S(item.body)) return false;
      var rows = state.manifest.rows || [];
      for (var i = 0; i < rows.length; i++) {
        var t = opBatchNorm(rows[i] && rows[i].payload && rows[i].payload.noteText);
        if (t && t.slice(0, 400) === item.body) return true;
      }
      return false;
    } catch (e) { return false; }
  }
  /* THE SHEET'S OWN WORDS FOR ITS OWN REFUSAL. Never paraphrased here. */
  function opBatchRefusalText(state) {
    var said = '';
    try { var n = document.getElementById('mlsAthenaUnifiedProbe'); said = opBatchNorm(n && n.textContent); } catch (e) { said = ''; }
    if (!said) { try { said = opBatchNorm(unifiedPrimaryPlan(state).reason); } catch (e2) { said = ''; } }
    return said || 'the read-only Athena check did not verify this exact encounter';
  }

  /* ---- the progress surface (wfprog-1.1.0's shape, outside the sheet) ----
     The sheet's own #mlsAthenaUnifiedProgress is destroyed with every close,
     so a cross-note queue needs a host that outlives it. Same vocabulary,
     same colours, same "which one, N of M, and what happened to the ones
     before it" - and it sits ABOVE the sheet so it never disappears behind
     the review it is driving. */
  function opBatchHost(make) {
    var host = null;
    try { host = document.getElementById('mlsOpBatchProgress'); } catch (e) { return null; }
    if (host || !make) return host;
    try {
      host = document.createElement('div');
      host.id = 'mlsOpBatchProgress';
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      host.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483610;width:min(370px,92vw);max-height:72vh;overflow:auto;' +
        'background:#fff;color:#204034;border:1px solid #cfe0d7;border-radius:12px;box-shadow:0 18px 46px rgba(10,30,70,.30);' +
        'padding:12px 13px;font:12.5px/1.45 system-ui,-apple-system,Segoe UI,Arial,sans-serif';
      document.body.appendChild(host);
    } catch (e2) { return null; }
    return host;
  }
  function opBatchCloseHost() { try { var h = document.getElementById('mlsOpBatchProgress'); if (h) h.remove(); } catch (e) {} }
  function opBatchCounts(run) {
    var out = { written: 0, rehearsed: 0, skipped: 0, left: 0 };
    (run.items || []).forEach(function (x) {
      if (x.phase === 'written') out.written++;
      else if (x.phase === 'rehearsed') out.rehearsed++;
      else if (x.phase === 'skipped') out.skipped++;
      else if (x.phase === 'waiting' || x.phase === 'stopped') out.left++;
    });
    return out;
  }
  function opBatchHeadline(run) {
    var n = run.items.length;
    if (run.done) return run.summary || 'Finished.';
    if (run.cancel) return 'Stopping after this note - nothing after it will run.';
    var at = Math.max(0, Math.min(run.i, n - 1)) + 1;
    var cur = run.items[run.i];
    var phase = OPBATCH_PHASE[(cur && cur.phase) || 'waiting'] || OPBATCH_PHASE.waiting;
    return phase.t + ' - note ' + at + ' of ' + n + (cur && cur.name ? (' (' + cur.name + ')') : '');
  }
  function opBatchSummaryText(run) {
    var c = opBatchCounts(run), n = run.items.length, bits = [];
    bits.push(c.written + ' of ' + n + ' written into Athena');
    if (c.rehearsed) bits.push(c.rehearsed + ' rehearsed (probe only - nothing written)');
    if (c.skipped) bits.push(c.skipped + ' skipped, each with its reason below');
    if (c.left) bits.push(c.left + ' not run');
    return bits.join('; ') + '. Nothing was saved and nothing was signed - Save and Sign & Save stay yours in athenaOne, per note.' +
      (run.stop ? (' ' + run.stop) : '');
  }
  function opBatchPaint() {
    var run = opBatchRun;
    var host = opBatchHost(!!run);
    if (!host) return;
    if (!run) { opBatchCloseHost(); return; }
    var c = opBatchCounts(run), n = run.items.length;
    var pct = n ? Math.round(((c.written + c.rehearsed + c.skipped) / n) * 100) : 0;
    var rowsHtml = run.items.map(function (x, i) {
      var ph = OPBATCH_PHASE[x.phase] || OPBATCH_PHASE.waiting;
      var live = (!run.done && i === run.i && x.phase !== 'written' && x.phase !== 'skipped' && x.phase !== 'rehearsed');
      return '<div data-mls-opbatch-row="' + esc(x.id) + '" style="border-top:1px solid #e6efe9;padding:6px 0">' +
        '<b style="font-weight:750">' + esc(x.name || 'This op note') + '</b>' +
        '<span style="float:right;font-weight:800;color:' + ph.c + '">' + esc(live ? (ph.t + '...') : ph.t) + '</span>' +
        '<div style="clear:both;color:#52675c;font-size:11.5px">' + esc(x.why || '') + '</div></div>';
    }).join('');
    host.innerHTML =
      '<div style="display:flex;gap:8px;align-items:flex-start">' +
        '<div style="flex:1;font-weight:850;font-size:13px">Sending op notes to Athena</div>' +
        '<button type="button" id="mlsOpBatchStop" style="border:1px solid #d8ddd9;background:#fff;color:#204034;border-radius:9px;padding:6px 10px;font-weight:750;cursor:pointer;font:700 11.5px/1.2 inherit">' +
        (run.done ? 'Close' : 'Stop after this note') + '</button>' +
      '</div>' +
      '<div data-mls-opbatch-headline="1" style="margin-top:5px;color:#204034;font-weight:700">' + esc(opBatchHeadline(run)) + '</div>' +
      '<div style="margin-top:7px;height:8px;border-radius:6px;background:#e6efe9;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:#2f7d5a"></div></div>' +
      '<div style="margin-top:8px">' + rowsHtml + '</div>' +
      '<div style="margin-top:9px;padding:8px 10px;border:1px solid #f0d79a;background:#fff7e6;border-radius:9px;color:#6d5010;font-size:11.5px">' +
        '<b>Nothing is saved and nothing is signed.</b> Each note gets its own read-only Athena check, its own confirmation-bound write and its own receipt, one at a time. Save and Sign &amp; Save stay yours in athenaOne.</div>';
    try {
      var stop = document.getElementById('mlsOpBatchStop');
      if (stop) stop.addEventListener('click', function () { if (opBatchRun && !opBatchRun.done) opBatchCancel(''); else opBatchCloseHost(); }, false);
    } catch (e) {}
  }
  function opBatchSay(message, kind) {
    try { if (typeof window.toast === 'function') window.toast(message, kind || ''); } catch (e) {}
  }

  function opBatchSettle(run, item, phase, why, action) {
    item.phase = phase;
    item.why = S(why);
    item.action = S(action || '');
    /* Recorded ONLY from a settled written verdict, which is itself only ever
       set from a receipt whose status is 'verified'. */
    if (phase === 'written' && S(item.id)) opBatchSent[S(item.id)] = new Date().toISOString();
    opBatchPaint();
  }
  function opBatchFinish(run) {
    if (opBatchRun !== run || run.done) return;
    (run.items || []).forEach(function (x) { if (x.phase === 'waiting') { x.phase = 'stopped'; if (!x.why) x.why = 'the queue stopped before this one'; } });
    run.done = true;
    run.finishedAt = Date.now();
    run.summary = opBatchSummaryText(run);
    opBatchPaint();
    opBatchSay(run.summary, opBatchCounts(run).written ? '' : 'err');
    opBatchNudgeRoom();
  }
  function opBatchNext(run, i) {
    if (opBatchRun !== run || run.done) return;
    /* CANCELLABLE BETWEEN NOTES. This is the only place a stop takes effect,
       and it is always AFTER a review has closed - never inside a write. */
    if (run.cancel) { opBatchFinish(run); return; }
    bxSleep(OPBATCH_CLOSE_MS).then(function () { opBatchStep(run, i + 1); });
  }
  function opBatchCloseSheet() {
    try { closeUnifiedConfirmation(); } catch (e) {}
  }
  function opBatchStep(run, i) {
    if (opBatchRun !== run || run.done) return;
    if (run.cancel || i >= run.items.length) { opBatchFinish(run); return; }
    run.i = i;
    var item = run.items[i];
    item.phase = 'opening';
    item.why = '';
    opBatchPaint();
    var before = unifiedAthenaState;
    /* THE ONE ENTRY POINT. Every gate pushHistoryNoteToAthena owns - draft,
       unresolved blank tokens, route quarantine, identity conflict, the saved
       canonical payload check - runs here exactly as it does for a single
       human press, because it IS the single human press. */
    try { window.pushHistoryNoteToAthena(item.id); }
    catch (eOpen) {
      opBatchSettle(run, item, 'skipped', 'MLS could not open the Athena review for this note. Nothing was sent for it.');
      opBatchNext(run, i); return;
    }
    bxWait(function () {
      var st = unifiedAthenaState;
      return !!(st && st !== before && !st.closed && st.manifest);
    }, OPBATCH_OPEN_MS).then(function () {
      if (opBatchRun !== run || run.done) return;
      var st = unifiedAthenaState;
      if (!st || st === before || st.closed || !st.manifest) {
        opBatchSettle(run, item, 'skipped', 'The Athena review refused to open for this note - MLS said why on screen. Nothing was sent for it.');
        opBatchNext(run, i); return;
      }
      if (!opBatchSheetMatches(st, item)) {
        opBatchSettle(run, item, 'skipped', 'The review that opened is not this note - MLS will not press a sheet it cannot match to the note it queued. Nothing was sent for it.');
        opBatchCloseSheet(); opBatchNext(run, i); return;
      }
      item.phase = 'check';
      opBatchPaint();
      /* THE SAME SETTLE LATCH THE PER-SECTION QUEUE WAITS ON: a validated
         probe, or a probe generation that settled without one. */
      bxWait(function () {
        var s = unifiedAthenaState;
        if (!s || s.closed) return true;
        if (s.probe) return true;
        return s.probeSettled === s.probeGeneration && !s.probe;
      }, OPBATCH_READY_MS).then(function (settledInTime) {
        if (opBatchRun !== run || run.done) return;
        var st2 = unifiedAthenaState;
        if (!st2 || st2.closed) {
          opBatchSettle(run, item, 'skipped', 'The Athena review closed before its read-only check finished. Nothing was sent for it.');
          opBatchNext(run, i); return;
        }
        if (!opBatchSheetMatches(st2, item)) {
          opBatchSettle(run, item, 'skipped', 'The open review stopped matching this note during its read-only check. Nothing was sent for it.');
          opBatchCloseSheet(); opBatchNext(run, i); return;
        }
        if (!st2.probe) {
          opBatchSettle(run, item, 'skipped', settledInTime === false
            ? 'Its read-only Athena check ran past the 150-second bound and was left alone. Nothing was sent for it.'
            : (opBatchRefusalText(st2) + ' Nothing was sent for it.'));
          opBatchCloseSheet(); opBatchNext(run, i); return;
        }
        var plan = unifiedPrimaryPlan(st2);
        if (plan.mode === 'none' || !plan.rows || !plan.rows.length) {
          opBatchSettle(run, item, 'skipped', (opBatchNorm(plan.reason) || opBatchRefusalText(st2)) + ' Nothing was sent for it.');
          opBatchCloseSheet(); opBatchNext(run, i); return;
        }
        /* INVARIANT 2, ENFORCED AT THE PRESS. Every row this press would run
           must be in the closed set. Anything else - Sign & Save, billing,
           an order - is the doctor's own deliberate single confirmation and
           never a queue's. */
        var outside = plan.rows.filter(function (r) { return !OPBATCH_ACTIONS[S(r && r.action)]; });
        if (outside.length) {
          opBatchSettle(run, item, 'skipped', 'This review would run an action a batch may never drive (' +
            outside.map(function (r) { return S(r && r.label) || S(r && r.action); }).join(', ') +
            '). Open it yourself and confirm it on its own. Nothing was sent for it.');
          opBatchCloseSheet(); opBatchNext(run, i); return;
        }
        item.phase = 'write';
        opBatchPaint();
        /* THE SAME CALL #mlsAthenaUnifiedGo MAKES. No second send loop. */
        try { runUnifiedPrimarySend(st2, null); }
        catch (eSend) {
          opBatchSettle(run, item, 'skipped', 'The send did not start for this note. Nothing was sent for it.');
          opBatchCloseSheet(); opBatchNext(run, i); return;
        }
        bxWait(function () {
          var s3 = unifiedAthenaState;
          if (!s3 || s3 !== st2 || s3.closed) return true;
          if (s3.running || s3.batchRunning) return false;
          for (var k in s3.receipts) { if (Object.prototype.hasOwnProperty.call(s3.receipts, k)) return true; }
          return false;
        }, OPBATCH_WRITE_MS).then(function (wroteInTime) {
          if (opBatchRun !== run || run.done) return;
          var s3 = unifiedAthenaState;
          var receipts = (s3 && s3 === st2 && s3.receipts) ? s3.receipts : {};
          var keys = Object.keys(receipts);
          var verified = keys.filter(function (k) { return receipts[k] && receipts[k].status === 'verified'; });
          var rehearsed = keys.filter(function (k) { return receipts[k] && receipts[k].status === 'rehearsed'; });
          var uncertain = keys.filter(function (k) { return receipts[k] && receipts[k].status === 'uncertain'; });
          if (verified.length) opBatchSettle(run, item, 'written', S(receipts[verified[0]].message), S(receipts[verified[0]].action));
          else if (rehearsed.length) opBatchSettle(run, item, 'rehearsed', S(receipts[rehearsed[0]].message), S(receipts[rehearsed[0]].action));
          else if (uncertain.length) opBatchSettle(run, item, 'skipped', S(receipts[uncertain[0]].message), S(receipts[uncertain[0]].action));
          else if (!keys.length && wroteInTime === false) opBatchSettle(run, item, 'skipped', 'Its write ran past the 180-second bound with no receipt - inspect that exact Athena field before retrying this one.');
          else opBatchSettle(run, item, 'skipped', keys.length ? S(receipts[keys[0]].message) : 'Athena returned no receipt for this note. Nothing is claimed for it.');
          /* INVARIANT 4: an uncertain outcome halts the queue where it stands. */
          var halted = !!(s3 && s3 === st2 && s3.halted) || uncertain.length > 0;
          opBatchCloseSheet();
          if (halted) {
            run.stop = 'The queue stopped here: one outcome was uncertain. Inspect that exact Athena destination before anything else runs.';
            run.cancel = true;
            opBatchFinish(run);
            return;
          }
          opBatchNext(run, i);
        });
      });
    });
  }
  function opBatchStart(opts) {
    opts = opts || {};
    if (opBatchRun && !opBatchRun.done) return { started: false, reason: 'A batch send is already running. Nothing new was started.' };
    if (typeof window.pushHistoryNoteToAthena !== 'function') return { started: false, reason: 'The Athena review is not available on this page yet. Nothing was sent.' };
    if (typeof document === 'undefined' || !document.body) return { started: false, reason: 'The page is not ready. Nothing was sent.' };
    if (opBatchPullRunning()) return { started: false, reason: 'A pull or import is running. Let it finish, then send these op notes to Athena. Nothing was sent.' };
    if (unifiedAthenaState && !unifiedAthenaState.closed) return { started: false, reason: 'An Athena review is already open. Finish or close it, then start the send. Nothing was sent.' };
    if (athenaActionRunning) return { started: false, reason: 'Another Athena action is awaiting confirmation. Finish it first. Nothing was sent.' };
    var found = opBatchEligible(opts.noteIds);
    if (!found.items.length) {
      return { started: false, refused: found.refused,
        reason: 'No op note on this day is ready for Athena yet. A note must be drafted, have every field filled in, and be saved to the chart before it can be sent.' };
    }
    var run = { v: OPBATCH_V, startedAt: Date.now(), finishedAt: 0, items: found.items, refused: found.refused,
      i: 0, cancel: false, done: false, stop: '', summary: '' };
    opBatchRun = run;
    opBatchPaint();
    opBatchNudgeRoom();
    opBatchStep(run, 0);
    return { started: true, total: run.items.length, refused: found.refused,
      ids: run.items.map(function (x) { return x.id; }) };
  }
  function opBatchCancel(why) {
    var run = opBatchRun;
    if (!run || run.done) return { cancelled: false, reason: 'No batch send is running.' };
    run.cancel = true;
    run.stop = opBatchNorm(why) || 'Stopped by the doctor. The note already being written finishes on its own; nothing after it runs.';
    opBatchPaint();
    return { cancelled: true, at: run.i, total: run.items.length };
  }
  function opBatchStatus() {
    var run = opBatchRun;
    if (!run) return { v: OPBATCH_V, running: false, done: false, cancelRequested: false, total: 0, index: -1,
      written: 0, rehearsed: 0, skipped: 0, summary: '', stop: '', notes: [] };
    var c = opBatchCounts(run);
    return { v: OPBATCH_V, running: !run.done, done: run.done, cancelRequested: run.cancel,
      total: run.items.length, index: run.i, written: c.written, rehearsed: c.rehearsed, skipped: c.skipped,
      summary: run.summary, stop: run.stop,
      notes: run.items.map(function (x) { return { id: x.id, name: x.name, phase: x.phase, why: x.why, action: x.action }; }) };
  }
  function opBatchRevert() {
    if (opBatchRun && !opBatchRun.done) opBatchCancel('The write flow was reverted.');
    opBatchRun = null;
    opBatchSent = Object.create(null);
    opBatchCloseHost();
    return true;
  }
  var OPBATCH_API = {
    v: OPBATCH_V, version: OPBATCH_V,
    start: opBatchStart, cancel: opBatchCancel, status: opBatchStatus,
    /* read-only seams: nothing below can open a review or send anything */
    eligible: function (ids) {
      var found = opBatchEligible(ids);
      return { count: found.items.length, refused: found.refused,
        items: found.items.map(function (x) { return { id: x.id, name: x.name }; }),
        ids: found.items.map(function (x) { return x.id; }) };
    },
    screen: opBatchScreen, pullRunning: opBatchPullRunning, matches: opBatchSheetMatches,
    sent: function () { return Object.keys(opBatchSent); },
    actions: OPBATCH_ACTIONS, phases: OPBATCH_PHASE,
    bounds: { open: OPBATCH_OPEN_MS, ready: OPBATCH_READY_MS, write: OPBATCH_WRITE_MS, close: OPBATCH_CLOSE_MS },
    summaryText: function () { return opBatchRun ? opBatchSummaryText(opBatchRun) : ''; },
    headline: function () { return opBatchRun ? opBatchHeadline(opBatchRun) : ''; },
    revert: opBatchRevert
  };
  window.__mlsOpBatchSend = OPBATCH_API;
  /* ===== end opbatch-1.0.0 ================================================ */

  window.__mlsWriteFlow = {
    installed: true, version: VERSION, state: STATE,
    suggestOrders: suggestOrders, oneClick: oneClick, runV2: runV2,
    startAthenaAction: startAthenaAction, writeReceiptDrafts: writeReceiptDrafts,
    buildUnifiedManifest: buildUnifiedManifest, openUnifiedConfirmation: openUnifiedConfirmation, closeUnifiedConfirmation: closeUnifiedConfirmation,
    previewHash: hashPreview, normalizeBilling: normalizeBilling,
    canonicalSectionKey: canonicalSectionKey, parseGeneratedSoapSections: parseGeneratedSoapSections, parseCanonicalAthenaNote: parseCanonicalAthenaNote, destinations: DESTINATION,
    inspectSections: gatherSections,
    /* wfgen-1.0.0 read-only identity seam: the EXACT comparators the write
       chain's identity lock uses (validatedUnifiedProbe, the one-click identity
       gate, the mrn-adopt chart proof). Exposed so a suite pins the shipped
       functions instead of agreeing with a reimplementation of them. Nothing
       here can send, enable a control, or change a verdict. */
    identity: { v: 'wfgen-1.0.0', nameMatch: nameMatch, normName: nrmName, normNameCamel: nrmNameCamel,
      normDob: nrmDob, normId: nrmId, foldMarks: wfFoldMarks },
    /* wfdx-1.0.0 / athena-probe-only-1.0.0 test + support seam (read-only) */
    diagnostics: { report: function () { return wfdxReport(unifiedAthenaState && unifiedAthenaState.manifest); },
      receipts: function () { return wfdx.receipts.slice(); }, envLine: function () { return wfdxEnvLine(unifiedAthenaState && unifiedAthenaState.manifest, wfdx.env); },
      reason: wfdxReason, errorClass: wfdxErrorClass, health: wfdxHealth,
      probeOnly: probeOnlyActive, probeOnlyBanner: PROBE_ONLY_BANNER,
      state: function () { return unifiedAthenaState; },
      /* wfsum-1.0.0 test seam: the reopen-surviving receipt truth. remember()
         is the same call the execute path makes; rowState()/render() are the
         same functions the sheet paints with. Nothing here can write. */
      receiptLedger: { v: 'wfsum-1.0.0', key: ledgerKey, remember: rememberRowOutcome,
        rowState: receiptStateForRow, render: renderUnifiedReceipts },
      /* sheetux-1.0.0 test seam (read-only except press(), which is the SAME
         call the merged primary button makes). */
      sheetUx: { v: 'sheetux-1.0.0', zeroReason: SHEETUX_ZERO_REASON, doItLabel: SHEETUX_DOIT_LABEL,
        plan: unifiedPrimaryPlan, sync: unifiedSyncPrimaryButton, checkedRows: bxCheckedRows,
        press: function (btn) { return runUnifiedPrimarySend(unifiedAthenaState, btn || null); } },
      /* sheetclar-1.0.0 read-only seam: the arrival default, the honest
         no-ready-section refusal, and the derived state word. Nothing here can
         send, enable a control, or change a verdict. */
      sheetClarity: { v: 'sheetclar-1.0.0', noneReadyReason: SHEETCLAR_NONE_READY_REASON,
        defaultChecked: unifiedDefaultChecked,
        stateFor: function (kind) { return unifiedAthenaState ? sheetclarState(unifiedAthenaState, kind) : null; },
        readyRow: function () { return unifiedAthenaState ? sheetclarReadyRow(unifiedAthenaState) : null; } },
      /* wfclar-1.0.0 read-only seam: the refusal table and how one refusal is
         said. Nothing here can send, enable a control, or change a verdict. */
      clarity: { v: 'wfclar-1.0.0', table: WFCLAR, classify: wfClarify, say: wfClarityText },
      /* wfauto-1.0.0 seam. The two closed sets, the bounds, and the SAME
         functions the settle latches call - so a suite cannot agree with a
         reimplementation of them. arm()/fire() can only schedule or run a
         READ-ONLY re-probe; there is no path from here to an execute. */
      autoChain: { v: 'wfauto-1.0.0', retryable: WFAUTO_RETRY, painting: WFAUTO_PAINT,
        positive: WFAUTO_POSITIVE, backoff: WFAUTO_BACKOFF_MS, idleMs: WFAUTO_IDLE_MS,
        windowMs: WFAUTO_WINDOW_MS, maxPaint: WFAUTO_MAX_PAINT, maxSettled: WFAUTO_MAX_SETTLED,
        eligible: function () { return wfautoEligible(unifiedAthenaState); },
        snapshot: function () { var a = unifiedAthenaState && unifiedAthenaState.wfauto; return a ? { cycle: a.cycle, mode: a.mode, armed: a.armed === true, tries: a.tries, settledTries: a.settledTries, waitMs: a.waitMs, exhausted: a.exhausted === true, rowId: a.rowId, code: a.code, watching: a.watching === true } : null; },
        positiveLatch: function () { return unifiedAthenaState ? S(unifiedAthenaState.wfautoPositive) : ''; },
        lastProbe: function () { var p = unifiedAthenaState && unifiedAthenaState.wfautoProbe; return p ? { generation: p.generation, rowId: p.rowId, ok: p.ok, code: p.code } : null; },
        note: function () { return unifiedAthenaState ? wfautoNote(unifiedAthenaState) : ''; },
        arm: function (rowId) { return wfautoOnSettled(unifiedAthenaState, rowId); },
        wake: function () { return wfautoWake(unifiedAthenaState); },
        cancel: function () { return wfautoCancel(unifiedAthenaState); },
        revert: function () { wfautoOff = true; try { wfautoCancel(unifiedAthenaState); } catch (e) {} return true; } },
      /* wfprog-1.0.0 read-only seam: the loading surface's own state and the
         receipt-derived summary. Nothing here can send. */
      progress: { v: 'wfprog-1.0.0', phases: WFPROG_PHASE, counts: function () { return wfprogCounts(unifiedAthenaState); },
        headline: function () { return unifiedAthenaState && unifiedAthenaState.prog ? wfprogHeadline(unifiedAthenaState) : ''; },
        summary: function (rows) { return unifiedAthenaState ? wfprogSummaryText(unifiedAthenaState, rows || [], '') : ''; },
        snapshot: function () { return unifiedAthenaState && unifiedAthenaState.prog ? stableClone(unifiedAthenaState.prog) : null; } } },
    /* wfbind-1.0.0 test + support seam (read-only; run() is the same call the
       sheet's own control makes). */
    bindCure: { v: 'wfbind-1.0.0', label: WFBIND_LABEL,
      candidateDays: wfbindCandidateDays, curableRow: wfbindCurableRow,
      optsForDay: wfbindOptsForDay, resolvedOpts: wfbindResolvedOpts, pullBusy: wfbindPullBusy,
      run: function (day) { return wfbindRun(unifiedAthenaState, day, null); },
      /* apptpick-1.0.0 read-only seam: the day's distinct resolvable Athena
         appointments for this patient, and the detached reopen options one
         chosen appointment produces. Neither can send or enable anything. */
      apptChoices: function (day, manifest) { return wfbindApptChoices(manifest || (unifiedAthenaState && unifiedAthenaState.manifest), day); },
      optsForAppointment: function (day, choice) { return wfbindOptsForAppointment(unifiedAthenaState, day, choice); },
      /* wfx-1.0.0 write-fidelity seam (read-only, render-time, advisory) */
      fidelity: { v: 'wfx-1.0.0', facts: wfxFacts, factList: wfxFactList,
        contradictions: wfxContradictions, tally: wfxTally,
        stalenessLine: wfxStalenessLine, pulledAt: wfxPulledAt,
        evidenceHtml: function () { return unifiedAthenaState ? wfxEvidenceHtml(unifiedAthenaState) : ''; } },
      /* The visit-screen banner's cure uses this same navigate + confirm-day +
         pull; it owns its own definition of "bound" and its own wait. */
      pullDay: function (day, say) { return wfbindNavigateAndPull(day, say); },
      last: function () { return wfbindLast; } },
    /* mrnadopt-1.0.0 test + support seam. run() is the same call the sheet's
       own control makes; classify()/persist() are the exact functions the pass
       uses, so a suite cannot agree with a reimplementation of them. */
    mrnAdopt: { v: 'mrnadopt-1.0.0', curable: mrnAdoptCurable, classify: mrnAdoptClassify,
      persist: mrnAdoptPersist, blockReason: mrnAdoptBlockReason, refusal: mrnAdoptRefusal,
      run: function () { return mrnAdoptPass(unifiedAthenaState); },
      last: function () { return mrnAdoptLast; },
      revert: function () { mrnAdoptOff = true; return true; } },
    /* opbatch-1.0.0: the cross-NOTE queue. It owns no write of its own - it
       presses the sheet's own primary, one note at a time. Same object as
       window.__mlsOpBatchSend. */
    opBatch: OPBATCH_API,
    revert: revert
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
