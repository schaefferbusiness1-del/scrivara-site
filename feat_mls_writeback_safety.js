/* =============================================================================
 * feat_mls_writeback_safety.js  ->  window.__mlsWritebackSafety   (wbs-1.2.0)
 * -----------------------------------------------------------------------------
 * TASK 10 — Writeback Preview & Patient Safety (APP-SIDE ONLY).
 *
 * Adds a PRE-WRITE safety preview + a fail-closed gate to the existing
 * "EMR sections - review & confirm" modal (#emrPanel). Before ANY write bridge
 * fires (mlsAppWriteV2 via feat_mls_writeflow.js, or mlsAppVerifiedWrite via
 * __mlsEmrSectionsWrite), the clinician sees ONE consolidated safety header:
 *
 *     Patient · DOB · MRN · Visit date · Provider · Destination
 *     Draft/live status per section · identity warnings · missing fields
 *     System confidence (high / medium / low)
 *
 * and the write is HARD-BLOCKED (the click never reaches the write button's
 * handler) when the app can already tell it is unsafe:
 *
 *   - patient is uncertain      (no active patient / no name)
 *   - DOB is missing            (cannot verify identity app-side)
 *   - DOB does not match         (observed chart DOB != active patient DOB)
 *   - visit / context is stale   (open-visit label != selected patient)
 *   - provider does not match    (known note provider != signed-in provider)
 *   - destination is missing     (no confirmed clinical section to write)
 *   - athenaOne is signed out / unavailable   (connTruth == 'disconnected')
 *   - system confidence is low   (aggregated: not enough to safely proceed)
 *
 * SCOPE / SAFETY DESIGN (read before changing):
 *   * This is a DEFENSE-IN-DEPTH layer that runs BEFORE the extension's own
 *     identity/DOB/MRN/order gates. It never replaces them; the frozen
 *     extension remains the authoritative backstop. It never sets force:true,
 *     never sends orders, never clicks Save/Sign, never touches athenaOne or
 *     the extension. It only reads app state and blocks the click.
 *   * It cannot AUTHORITATIVELY verify the open chart's patient/provider —
 *     that requires the extension (see audit R1: no provider gate exists, and
 *     it lives in the frozen extension). So provider is SURFACED for the
 *     clinician and, when the app has no signal, treated as a WARNING, not a
 *     false hard block. The extension still refuses a real mismatch at write.
 *   * Athena "signed out / unavailable" is inferred from the app's existing
 *     connTruth signal ('connected'/'unknown'/'disconnected'). Only a
 *     CONFIDENT negative ('disconnected') hard-blocks; 'unknown' warns and
 *     lets the extension backstop decide, to avoid unusable false blocks.
 *     >> The live signed-out/unavailable path is Athena-gated: it must be
 *        certified on Fable + live athenaOne. This module is fully
 *        mock-testable offline (see test_writeback_safety.html).
 *
 * evaluate(ctx) is a PURE function (no DOM) so every block condition is
 * unit-testable deterministically. The DOM glue just builds ctx and renders
 * the verdict.
 *
 * Additive; revert(): window.__mlsWritebackSafety.revert(). ASCII-only.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsWritebackSafety && window.__mlsWritebackSafety.installed) return;

  var VERSION = 'wbs-1.2.0';
  var S = function (x) { return x == null ? '' : String(x); };
  var DESTINATION = 'athenaOne encounter (open chart)';

  /* Which confirmed section keys are clinical CONTENT (will be written,
     unsigned) vs ORDER-CLASS (draft / target-only, never sent). Mirrors
     feat_mls_writeflow.js ORDER_CLASS / EXEC_KEYS and __mlsEmrSectionsWrite. */
  var ORDER_CLASS = { orders: 1, rx: 1, referrals: 1, pt: 1, imaging: 1, billing: 1,
    /* Task 9 draft-only extras (feat_mls_orders_draft_extra.js) — never sent */
    surgctr: 1, consent: 1, handouts: 1, instructions: 1 };
  var CONTENT_KEYS = { history: 1, exam: 1, assessment: 1, plan: 1, followup: 1 };

  /* ---------------------------- name normalize ----------------------------- */
  /* "Schaeffer, Adam" == "Adam Schaeffer" == "ADAM  SCHAEFFER". Token-sorted,
     lowercased, letters only. Empty -> ''. */
  function normName(s) {
    var toks = S(s).toLowerCase().replace(/[^a-z\s,]/g, ' ').replace(/,/g, ' ').split(/\s+/);
    var out = [];
    for (var i = 0; i < toks.length; i++) { if (toks[i]) out.push(toks[i]); }
    out.sort();
    return out.join(' ');
  }
  function normDob(s) {
    /* compare digits only so 01/02/1968 == 1968-01-02 won't accidentally
       match; keep order-sensitive by normalizing to sorted-agnostic? No —
       DOB order matters. Just strip non-digits and compare the digit string
       when both are the same layout; otherwise fall back to loose contains.
       We only use this to detect a DEFINITE mismatch, never to assert a
       match, so be conservative: mismatch only when both parse to a full
       8-digit date and they differ. */
    var d = S(s).replace(/[^0-9]/g, '');
    return d;
  }
  function dobConflict(a, b) {
    var x = normDob(a), y = normDob(b);
    if (x.length < 6 || y.length < 6) return false;     /* not enough to judge */
    if (x.length === 8 && y.length === 8) {
      /* try to reconcile mm/dd/yyyy vs yyyy/mm/dd forms; if any arrangement
         matches, it's not a conflict */
      var forms = [x, x.slice(4, 8) + x.slice(0, 4)];   /* mmddyyyy <-> yyyymmdd swap of halves */
      if (forms.indexOf(y) >= 0) return false;
      return true;
    }
    return x !== y;
  }

  /* ------------------------------- PURE CORE -------------------------------- */
  /* ctx: {
   *   patient:      { name, dob, mrn } | null   (from activePatient())
   *   chartDob:     string|null   (observed open-chart DOB, if the app knows it)
   *   beaconName:   string|null   (name in #mlsActivePtBeacon)
   *   lockedLabel:  string|null   (open-visit label the app locked to)
   *   noteProvider: string|null   (provider named in the note/visit, if any)
   *   activeProvider:string|null  (signed-in provider name, if known)
   *   athena:       'connected'|'unknown'|'disconnected'
   *   sections:     [ { key, text } ]  (CONFIRMED sections only)
   *   visitDate:    string|null
   * }
   * returns verdict (see header). */
  function evaluate(ctx) {
    ctx = ctx || {};
    var hardBlocks = [], warnings = [];
    var p = ctx.patient || null;
    var name = p ? S(p.name).trim() : '';
    var dob = p ? S(p.dob).trim() : '';
    var mrn = p ? S(p.mrn || p.athenaId || '').trim() : '';
    var sections = Array.isArray(ctx.sections) ? ctx.sections : [];

    var contentSections = [], draftSections = [];
    for (var i = 0; i < sections.length; i++) {
      var k = sections[i] && sections[i].key;
      var txt = S(sections[i] && sections[i].text).trim();
      if (!k || !txt) continue;
      if (ORDER_CLASS[k]) draftSections.push(sections[i]);
      else if (CONTENT_KEYS[k]) contentSections.push(sections[i]);
      else contentSections.push(sections[i]);   /* unknown key -> treat as content, extension still gates */
    }

    /* -- block conditions (order = display priority) -- */
    if (!p || !name) {
      hardBlocks.push({ code: 'NO_PATIENT', label: 'Patient is uncertain', detail: 'No active patient is selected. Pick a patient before writing.' });
    }
    if (p && name && !dob) {
      hardBlocks.push({ code: 'NO_DOB', label: 'Date of birth is missing', detail: 'Cannot verify identity without a DOB. Add the DOB to the patient record first.' });
    }
    if (p && dob && ctx.chartDob && dobConflict(dob, ctx.chartDob)) {
      hardBlocks.push({ code: 'DOB_MISMATCH', label: 'DOB does not match the open chart', detail: 'Selected patient DOB ' + dob + ' vs open chart ' + S(ctx.chartDob) + '. Nothing will be written.' });
    }

    /* stale context / wrong open visit */
    var beacon = S(ctx.beaconName).trim();
    var locked = S(ctx.lockedLabel).trim();
    var openLabel = beacon || locked;
    if (p && name && openLabel && normName(openLabel) && normName(openLabel) !== normName(name)) {
      hardBlocks.push({ code: 'STALE_CONTEXT', label: 'The open visit does not match the selected patient', detail: 'Open visit is labeled "' + openLabel + '", not "' + name + '". Re-open ' + name + '’s chart before writing.' });
    }

    /* provider */
    var np = S(ctx.noteProvider).trim(), ap = S(ctx.activeProvider).trim();
    if (np && ap && normName(np) !== normName(ap)) {
      hardBlocks.push({ code: 'PROVIDER_MISMATCH', label: 'Provider does not match', detail: 'Note provider "' + np + '" differs from the signed-in provider "' + ap + '".' });
    } else {
      /* R1: the app cannot read the OPEN CHART's authoring provider (that gate
         lives in the frozen extension and does not exist). Always surface it. */
      warnings.push({ code: 'PROVIDER_UNVERIFIED', label: 'Provider not verified against the chart', detail: 'MLS does not check the open chart’s author. Confirm ' + (ap || 'the correct provider') + ' owns this encounter.' });
    }

    /* destination / nothing to write */
    if (contentSections.length === 0) {
      hardBlocks.push({ code: 'NO_DESTINATION', label: 'Nothing to write', detail: draftSections.length ? 'Only order-class/billing sections are confirmed — those are never sent. Confirm a clinical section (History/Exam/Assessment/Plan) to write.' : 'No section is confirmed. Tick "confirm" on at least one clinical section.' });
    }

    /* athena reachability */
    var athena = ctx.athena === 'connected' || ctx.athena === 'disconnected' ? ctx.athena : 'unknown';
    if (athena === 'disconnected') {
      /* wbs-1.1.0: use the LIVE probe reason when the caller supplies one —
         the hard-coded "Sign in to athenaOne" text blamed a signed-in session
         when the real failure was the extension runtime needing a reload. */
      var athenaWhy = S(ctx.athenaReason).replace(/\s+/g, ' ').trim().slice(0, 220);
      var extIssue = /extension|MLS Assist.*(reload|internal error)|worker/i.test(athenaWhy);
      hardBlocks.push({
        code: 'ATHENA_DISCONNECTED',
        label: extIssue ? 'MLS Assist cannot reach athenaOne (extension needs a reload)' : 'athenaOne is signed out or unavailable',
        detail: athenaWhy || 'MLS Assist reports no live athenaOne. Sign in to athenaOne, open the patient chart, then try again.'
      });
    } else if (athena === 'unknown') {
      warnings.push({ code: 'ATHENA_UNKNOWN', label: 'athenaOne connection unconfirmed', detail: 'MLS Assist will re-verify the open chart at write time and refuse if it is not this patient.' });
    }

    /* confidence score */
    var score = 2;
    if (mrn) score += 1;
    if (dob) score += 1;
    if (p && name && openLabel && normName(openLabel) === normName(name)) score += 1;   /* corroborated */
    if (athena === 'unknown') score -= 1;
    if (athena === 'disconnected') score -= 3;
    var confidence = score >= 4 ? 'high' : (score >= 2 ? 'medium' : 'low');
    if (confidence === 'low' && !hasCode(hardBlocks, 'ATHENA_DISCONNECTED') && !hasCode(hardBlocks, 'NO_PATIENT')) {
      hardBlocks.push({ code: 'LOW_CONFIDENCE', label: 'System confidence is too low to write', detail: 'Not enough verified identity signal to safely place this note. Re-open the chart and confirm the patient.' });
    }

    var missingFields = [];
    if (!dob) missingFields.push('DOB');
    if (!mrn) missingFields.push('MRN');
    if (!ctx.visitDate) missingFields.push('visit date');

    return {
      safe: hardBlocks.length === 0,
      hardBlocks: hardBlocks,
      warnings: warnings,
      confidence: confidence,
      fields: {
        patient: name || '(none)',
        dob: dob || '(missing)',
        mrn: mrn || '(none)',
        visitDate: S(ctx.visitDate) || '(this encounter)',
        provider: ap || '(unknown)',
        destination: DESTINATION
      },
      contentSections: contentSections,
      draftSections: draftSections,
      missingFields: missingFields
    };
  }
  function hasCode(arr, code) { for (var i = 0; i < arr.length; i++) { if (arr[i].code === code) return true; } return false; }

  /* =======================================================================
   *  DOM GLUE  (below this line is browser-only; the core above is pure)
   * ===================================================================== */
  var stopped = false;

  function activePt() { try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; } catch (e) { return null; } }
  var previewPatientId = null, previewPatientValue = null;
  function currentActiveId() {
    try { return (typeof window.getActivePtId === 'function') ? S(window.getActivePtId()) : ''; } catch (e) { return ''; }
  }
  function previewPatient(force) {
    var id = currentActiveId();
    if (!force && previewPatientId === id) return previewPatientValue;
    /* An unexpected id change must fail the presentation closed until its
       exact lifecycle repair runs. Never cold-decode the roster from an input
       event merely to make the preview prettier. The write click forces a
       fresh record below before any bridge handler can run. */
    if (!force && previewPatientId !== null && previewPatientId !== id) return null;
    var p = activePt();
    previewPatientId = id;
    previewPatientValue = p ? {
      id: p.id, name: p.name, dob: p.dob, mrn: p.mrn, athenaId: p.athenaId,
      lastVisit: p.lastVisit, visitDate: p.visitDate
    } : null;
    return previewPatientValue;
  }
  function invalidatePreviewPatient() { previewPatientId = null; previewPatientValue = null; }
  function esc(s) { return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  /* Map the deployed __mlsConnTruth vocabulary to our 3-state model. PURE +
     exported so the production signed-out detection is unit-tested offline.
     Contract mirrors the deployed feat_athena_signin_prompt.js SINGLE SOURCE
     OF TRUTH: a genuine disconnect is EXACTLY 'no-extension' | 'no-tab' |
     'error' (plus explicit 'disconnected'/'signed-out'); 'connected' (or
     isConnected()) is connected; 'checking'/absent/anything else is 'unknown'
     (warn only — never a false hard block; the extension gate backstops). */
  var DISCONNECTED_STATUS = { 'no-extension': 1, 'no-tab': 1, 'error': 1, 'disconnected': 1, 'signed-out': 1 };
  function mapConnStatus(status, isConnectedBool) {
    if (isConnectedBool === true) return 'connected';
    if (status === 'connected') return 'connected';
    if (status && DISCONNECTED_STATUS[status]) return 'disconnected';
    return 'unknown';
  }

  /* Athena state from the app's existing connTruth signal. Replaceable for
     tests via api._athenaState. Never invents a new bridge. */
  function athenaState() {
    try {
      var ct = window.__mlsConnTruth;
      if (ct) {
        var isc = (typeof ct.isConnected === 'function') ? !!ct.isConnected() : null;
        var status = ct.state && ct.state.status;
        return mapConnStatus(status, isc === null ? undefined : isc);
      }
    } catch (e) {}
    return 'unknown';
  }

  function beaconName() {
    try {
      var el = document.getElementById('mlsActivePtBeacon');
      if (!el) return '';
      var m = S(el.textContent).match(/Patient:\s*([^\n]+)/);
      return m ? m[1].trim() : '';
    } catch (e) { return ''; }
  }
  function providerName() {
    try { if (typeof window.getProviderName === 'function') { return S(window.getProviderName()); } } catch (e) {}
    return '';
  }

  /* confirmed sections straight off the panel checkboxes/textareas */
  function panelSections(panel) {
    var out = [];
    try {
      var boxes = panel.querySelectorAll('input[data-k]');
      for (var i = 0; i < boxes.length; i++) {
        if (!boxes[i].checked) continue;
        var k = boxes[i].getAttribute('data-k');
        var ta = panel.querySelector('textarea[data-t="' + k + '"]');
        var v = ta ? S(ta.value).trim() : '';
        out.push({ key: k, text: v });
      }
    } catch (e) {}
    return out;
  }

  function gatherContext(panel, forcePatient) {
    var p = previewPatient(!!forcePatient) || null;
    var ctx = {
      patient: p ? { name: p.name, dob: p.dob, mrn: p.mrn || p.athenaId || '' } : null,
      chartDob: null,                 /* app has no pre-write chart DOB; extension checks it */
      beaconName: beaconName(),
      lockedLabel: (function () { try { return S(window.__mlsLastOpenVisitLabel || ''); } catch (e) { return ''; } })(),
      noteProvider: null,             /* not reliably parseable; left null -> provider WARNING, not block */
      activeProvider: providerName(),
      athena: (api._athenaState || athenaState)(),
      athenaReason: (function () { try { var ct = window.__mlsConnTruth; return (ct && ct.state && String(ct.state.reason || '').slice(0, 220)) || ''; } catch (e) { return ''; } })(),
      sections: panel ? panelSections(panel) : [],
      visitDate: p && (p.lastVisit || p.visitDate) || ''
    };
    return ctx;
  }

  /* ---------------------------- preview render ----------------------------- */
  function chip(txt, bg, fg) { return '<span style="display:inline-block;background:' + bg + ';color:' + fg + ';border-radius:999px;padding:2px 9px;font:700 11px system-ui;margin:0 4px 4px 0">' + esc(txt) + '</span>'; }

  function renderPreview(panel, forcePatient) {
    if (!panel || stopped) return null;
    var v = evaluate(gatherContext(panel, forcePatient));
    var host = panel.querySelector('#mlsWbSafety');
    if (!host) {
      host = document.createElement('div');
      host.id = 'mlsWbSafety';
      var body = panel.querySelector('#emrBody');
      if (body && body.parentElement) body.parentElement.insertBefore(host, body);
      else panel.appendChild(host);
    }
    var confColor = v.confidence === 'high' ? '#2E6A4B' : (v.confidence === 'medium' ? '#B07636' : '#B23B3B');
    var statusColor = v.safe ? '#2E6A4B' : '#B0791F'; /* calm amber: a human is mid-review, not blocked */
    var html = '';
    html += '<div style="background:#FCFBF8;border:1px solid ' + (v.safe ? '#E7E5DD' : '#E4C883') + ';border-radius:12px;padding:12px 14px;margin-bottom:12px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px">';
    html += '<b style="color:#1A211C;font-size:14px">Write-back safety preview</b>';
    html += '<span style="color:' + statusColor + ';font-weight:800;font-size:12.5px">' + (v.safe ? '✓ Ready to write (after you confirm)' : '⏸ Needs your review — nothing is ever sent without you') + '</span>';
    html += '</div>';
    /* identity grid */
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px 14px;font:12.5px/1.5 system-ui;color:#1A211C">';
    html += row('Patient', v.fields.patient);
    html += row('DOB', v.fields.dob);
    html += row('MRN', v.fields.mrn);
    html += row('Visit date', v.fields.visitDate);
    html += row('Provider', v.fields.provider);
    html += row('Destination', v.fields.destination);
    html += '</div>';
    /* draft/live status */
    html += '<div style="margin-top:8px">';
    html += chip('Will write (unsigned): ' + (v.contentSections.length ? cnt(v.contentSections) : 'none'), '#F2F0E9', '#2E6A4B');
    html += chip('DRAFT / never sent: ' + (v.draftSections.length ? cnt(v.draftSections) : 'none'), '#FCF8EF', '#B07636');
    html += chip('Confidence: ' + v.confidence, '#F2F0E9', confColor);
    html += '</div>';
    if (v.missingFields.length) {
      html += '<div style="margin-top:6px;font:12px system-ui;color:#B07636">Missing: ' + esc(v.missingFields.join(', ')) + '</div>';
    }
    /* warnings */
    for (var w = 0; w < v.warnings.length; w++) {
      html += '<div style="margin-top:6px;font:12px/1.5 system-ui;color:#B07636">⚠ <b>' + esc(v.warnings[w].label) + '</b> — ' + esc(v.warnings[w].detail) + '</div>';
    }
    /* hard blocks */
    for (var b = 0; b < v.hardBlocks.length; b++) {
      html += '<div style="margin-top:6px;font:12.5px/1.5 system-ui;color:#B23B3B"><b>⛔ ' + esc(v.hardBlocks[b].label) + '</b> — ' + esc(v.hardBlocks[b].detail) + '</div>';
    }
    html += '<div style="margin-top:8px;font:11px system-ui;color:#79837C">Defense-in-depth: MLS Assist re-verifies patient identity in athenaOne at write time and refuses on any mismatch. Orders/prescriptions are never sent. MLS never clicks Save/Sign.</div>';
    html += '</div>';
    host.innerHTML = html;

    /* reflect on the write button (belt; the click gate is the real enforcement) */
    reflectButton(panel, v);
    lastVerdict = v;
    return v;
  }
  function row(k, val) { return '<div><span style="color:#55605A">' + esc(k) + ':</span> <b style="color:#1A211C">' + esc(val) + '</b></div>'; }
  function cnt(list) { var names = []; for (var i = 0; i < list.length; i++) names.push(list[i].key); return names.join(', '); }

  function reflectButton(panel, v) {
    try {
      var btn = panel.querySelector('#emrWbAthena');
      if (!btn) return;
      if (!v.safe) {
        btn.setAttribute('data-wbs-blocked', '1');
        btn.style.opacity = '.5';
        btn.style.cursor = 'not-allowed';
        if (!btn.getAttribute('data-wbs-title')) { btn.setAttribute('data-wbs-title', btn.title || ''); }
        btn.title = 'Waiting on: ' + v.hardBlocks.map(function (h) { return h.label; }).join('; ');
      } else {
        btn.removeAttribute('data-wbs-blocked');
        btn.style.opacity = '';
        btn.style.cursor = 'pointer';
        if (btn.getAttribute('data-wbs-title') != null) { btn.title = btn.getAttribute('data-wbs-title'); }
      }
    } catch (e) {}
  }

  /* ------------------------------ click gate ------------------------------- */
  /* Capture-phase, on document, so it runs BEFORE the write button's own
     onclick (assigned by writeflow / emrSectionsWrite). If the current verdict
     is unsafe we stop the event entirely -> the write bridge never fires. */
  var lastVerdict = null;
  function isWriteTrigger(t) {
    if (!t || !t.id) return false;
    return t.id === 'emrWbAthena';
  }
  function gateClick(ev) {
    try {
      if (stopped) return;
      var t = ev.target;
      /* walk up a couple levels in case of an inner span */
      for (var hop = 0; hop < 3 && t && !isWriteTrigger(t); hop++) t = t.parentElement;
      if (!isWriteTrigger(t)) return;
      var panel = document.getElementById('emrPanel');
      if (!panel) return;
      var v = renderPreview(panel, true);   /* re-evaluate FRESH at click time */
      if (v && !v.safe) {
        ev.stopImmediatePropagation();
        ev.preventDefault();
        flashBlocked(panel, v);
        STATE.blocks++;
      } else {
        STATE.allowed++;
      }
    } catch (e) {}
  }
  function flashBlocked(panel, v) {
    try {
      var host = panel.querySelector('#mlsWbSafety');
      if (host) { host.scrollIntoView({ block: 'nearest' }); host.animate ? host.animate([{ outline: '0 solid #B23B3B' }, { outline: '3px solid #B23B3B' }, { outline: '0 solid #B23B3B' }], { duration: 700 }) : 0; }
      var logEl = panel.querySelector('#emrWbLog');
      if (logEl) { logEl.innerHTML += '<div style="margin:3px 0;color:#B0791F">⏸ <b>Hold on — finish these first:</b> ' + esc(v.hardBlocks.map(function (h) { return h.label; }).join('; ')) + '. Nothing was sent.</div>'; logEl.scrollTop = logEl.scrollHeight; }
    } catch (e) {}
  }

  /* -------------------------------- boot ----------------------------------- */
  var STATE = { blocks: 0, allowed: 0, previews: 0 };
  var mo = null, refreshTimer = null, activeHandler = null, recordHandler = null, boundaryHandler = null;
  function schedulePatientPreview() {
    if (stopped || refreshTimer) return;
    refreshTimer = setTimeout(function () {
      refreshTimer = null;
      if (stopped) return;
      var panel = document.getElementById('emrPanel');
      if (panel && panel.getAttribute('data-wbs')) renderPreview(panel, true);
    }, 0);
  }
  function attach(panel) {
    if (!panel || panel.getAttribute('data-wbs')) return;
    panel.setAttribute('data-wbs', '1');
    renderPreview(panel, true);
    STATE.previews++;
    try {
      panel.addEventListener('change', function () { renderPreview(panel, false); }, false);
      panel.addEventListener('input', function () { renderPreview(panel, false); }, false);
    } catch (e) {}
  }
  function boot() {
    try { document.addEventListener('click', gateClick, true); } catch (e) {}
    try {
      mo = new MutationObserver(function () { if (stopped) return; var p = document.getElementById('emrPanel'); if (p) attach(p); });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    try { var p0 = document.getElementById('emrPanel'); if (p0) attach(p0); } catch (e) {}
    activeHandler = function () { invalidatePreviewPatient(); schedulePatientPreview(); };
    recordHandler = function (ev) {
      try {
        var id = S(ev && ev.detail && ev.detail.patientId);
        if (!id || id !== currentActiveId()) return;
      } catch (e) { return; }
      invalidatePreviewPatient();
      schedulePatientPreview();
    };
    boundaryHandler = function () { invalidatePreviewPatient(); schedulePatientPreview(); };
    try { window.addEventListener('mls:active-patient-changed', activeHandler); } catch (e) {}
    try { window.addEventListener('mls:patient-record-updated', recordHandler); } catch (e) {}
    try { window.addEventListener('mls:session-boundary', boundaryHandler); } catch (e) {}
  }
  function revert() {
    stopped = true;
    try { document.removeEventListener('click', gateClick, true); } catch (e) {}
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { if (refreshTimer) clearTimeout(refreshTimer); } catch (e) {} refreshTimer = null;
    try { if (activeHandler) window.removeEventListener('mls:active-patient-changed', activeHandler); } catch (e) {}
    try { if (recordHandler) window.removeEventListener('mls:patient-record-updated', recordHandler); } catch (e) {}
    try { if (boundaryHandler) window.removeEventListener('mls:session-boundary', boundaryHandler); } catch (e) {}
    activeHandler = recordHandler = boundaryHandler = null;
    invalidatePreviewPatient();
    try { var h = document.querySelectorAll('#mlsWbSafety'); for (var i = 0; i < h.length; i++) h[i].remove(); } catch (e) {}
    window.__mlsWritebackSafety.installed = false;
  }

  var api = {
    installed: true, version: VERSION, state: STATE,
    evaluate: evaluate, normName: normName, dobConflict: dobConflict, mapConnStatus: mapConnStatus,
    renderPreview: renderPreview, gatherContext: gatherContext,
    _athenaState: null,          /* set to a function in tests to stub connTruth */
    revert: revert
  };
  window.__mlsWritebackSafety = api;

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
