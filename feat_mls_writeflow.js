/* =============================================================================
 * feat_mls_writeflow.js -> window.__mlsWriteFlow  (wf2-1.7.0)
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

  var VERSION = 'wf2-1.8.0';
  var S = function (x) { return x == null ? '' : String(x); };
  var STATE = { oneClicks: 0, writes: 0, lastResp: null, verifiedWrites: {}, suggestionsShown: 0, suggestionsAdded: 0, copyScrubbed: 0 };
  var stopped = false;

  /* ---------------------- bridge (same pattern as b111) -------------------- */
  function bridge(type, payload, respType, timeout) {
    return new Promise(function (resolve) {
      var done = false;
      var correlated = type === 'mlsAppAthenaActionV2';
      var requestId = correlated ? ('wf2-' + Date.now() + '-' + Math.random().toString(36).slice(2)) : '';
      function h(ev) { var d = ev && ev.data; if (!d || d.source !== 'mls-ext' || d.type !== respType || (correlated && S(d.requestId) !== requestId)) return; if (done) return; done = true; try { window.removeEventListener('message', h); } catch (e) {} resolve(d.resp || d); }
      try { window.addEventListener('message', h, false); } catch (e) {}
      try { var m = { type: type, source: 'mls-app', from: 'mls-app' }; for (var k in (payload || {})) m[k] = payload[k]; if (correlated) m.requestId = requestId; window.postMessage(m, '*'); } catch (e) {}
      setTimeout(function () { if (done) return; done = true; try { window.removeEventListener('message', h); } catch (e) {} resolve({ __timeout: true }); }, timeout || 150000);
    });
  }
  function esc(s) { return S(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function activePt() { try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; } catch (e) { return null; } }
  function supervisedOrderPlacementReady() { try { return !!(window.__mlsExtensionCapabilities && window.__mlsExtensionCapabilities.supervisedOrderPlacementV2 === true); } catch (e) { return false; } }

  /* ---------------- explicit Athena actions ------------------------------ */
  /* Note write, Save, Sign, Billing, and one typed order are deliberately independent. Each action first
     performs a read-only probe, shows the exact Athena context, and then waits
     for a fresh human click before the one-use actionToken can be executed. */
  var ATHENA_ACTIONS = {
    write_note: {
      label: 'Write reviewed note',
      consequence: 'Writes only the exact reviewed unsigned note text into the verified Athena encounter editor. It does not Save, Sign, bill, submit a claim, place an order, or prescribe. Review the result before choosing another action.'
    },
    stage_billing: {
      label: 'Stage billing codes',
      consequence: 'Stages only the exact reviewed E/M and CPT/HCPCS codes in the verified Athena billing slate. Units, modifiers, diagnosis pointers, and diagnoses remain review-only/manual. It does not submit a claim, save the encounter, sign the note, or place an order.'
    },
    save_draft: {
      label: 'Save draft in Athena',
      consequence: 'After verifying that this exact reviewed note is in the exact encounter editor, clicks that encounter\'s verified Save / Save Draft control. It does not sign the note, submit billing, or place an order.'
    },
    sign_encounter: {
      label: 'Sign & Save in Athena',
      consequence: 'Available only after this receipt has a verified write of this exact reviewed note to this exact encounter. It then clicks the verified Sign & Save control and electronically finalizes the encounter. It does not submit a claim or place an order.'
    },
    place_order: {
      label: 'Place one reviewed order',
      consequence: 'After a read-only exact-patient, exact-encounter, and exact Orders-workspace check, this places only this one frozen reviewed order. It does not Save or Sign the encounter, submit billing or a claim, prescribe, place a second order, or run another action.'
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
    if (!out) {
      try { if (typeof window.getProviderName === 'function') out = S(window.getProviderName()).trim(); } catch (e2) {}
      try { if (!out && typeof window.getName === 'function') out = S(window.getName()).trim(); } catch (e3) {}
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
    if (suppliedDate && suppliedProvider) return { visitDate: athenaVisitDate(suppliedDate), provider: suppliedProvider, appointmentId: suppliedAppointment, encounterId: suppliedEncounter, encounterUrl: suppliedEncounterUrl };

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
      return !!(d0 && athenaAppointmentIdFromImportIndex(pid, x.row.id, d0));
    });
    if (resolvable.length) rows = resolvable;
    if (rows.length > 1 && rows[0].distance === rows[1].distance && String(rows[0].row.id || '') !== String(rows[1].row.id || '')) return null;
    var hit = rows[0].row;
    var day = suppliedDate || visitDay(hit.day_local || hit.appt_date || hit.start_at);
    var provider = suppliedProvider || apptProvider(hit);
    if (!day || !provider) return null;
    return { visitDate: athenaVisitDate(day), provider: provider, appointmentId: suppliedAppointment || athenaAppointmentIdFromImportIndex(pid, hit.id, day) || S(hit.id || ''), encounterId: suppliedEncounter, encounterUrl: suppliedEncounterUrl };
  }
  function statusEl(opts) {
    try {
      if (opts && opts.statusEl && opts.statusEl.nodeType === 1) return opts.statusEl;
      if (opts && opts.statusId) return document.getElementById(opts.statusId);
    } catch (e) {}
    return null;
  }
  function actionSay(opts, msg, kind) {
    var el = statusEl(opts);
    if (el) {
      try {
        el.style.display = 'block';
        el.style.color = kind === 'err' ? '#9f2d2d' : (kind === 'ok' ? '#205c43' : '#6f5a20');
        el.textContent = msg;
      } catch (e) {}
    }
    try { if (typeof window.toast === 'function') window.toast(msg, kind === 'err' ? 'err' : (kind === 'ok' ? 'ok' : '')); } catch (e2) {}
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
    if (!resp || resp.ok !== true || resp.verified !== true) return false;
    if (resp.written === true || resp.noteWritten === true) return true;
    var rs = Array.isArray(resp.results) ? resp.results.filter(function (r) { return !r || r.execute !== false; }) : [];
    return !!(rs.length && rs.every(function (r) { return r && r.written === true && r.verified === true; }));
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
  function startAthenaAction(action, opts) {
    opts = opts || {};
    if (!ATHENA_ACTIONS[action]) { actionSay(opts, 'Unsupported Athena action. Nothing was changed.', 'err'); return Promise.resolve({ ok: false, error: 'unsupported-action' }); }
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
      actionSay(opts, 'Sign & Save unlocks right after this receipt verifies the note write. Run Write reviewed note first, then sign with your own confirmation; nothing was changed.', 'err');
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
      if (!probe.ok) { athenaActionRunning = false; actionSay(opts, probe.error || probe.message || 'Athena context could not be verified. Nothing was changed.', 'err'); return probe; }
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
  var UNIFIED_ORDER = { write_note: 10, stage_billing: 20, save_draft: 30, sign_encounter: 40, dx: 50, orders: 60, order: 60, rx: 70, referrals: 80, pt: 90, imaging: 100, documents: 110, unknown: 999 };
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
  var UNIFIED_ALIASES = { diagnoses: 'dx', diagnosis: 'dx', icd: 'dx', icd10: 'dx', prescription: 'rx', prescriptions: 'rx', referral: 'referrals', document: 'documents', letter: 'documents', letters: 'documents', avs: 'documents', prior_auth: 'documents', ime: 'documents', mips: 'documents' };
  var UNIFIED_ARIA = {
    write_note: 'Confirm write reviewed note',
    stage_billing: 'Confirm stage billing codes',
    save_draft: 'Confirm save draft in Athena',
    sign_encounter: 'Confirm Sign & Save in Athena',
    place_order: 'Confirm place one reviewed order'
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
    if (row && row.action === 'stage_billing') {
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
      var executable = complete && !!payload.order;
      var highRisk = /^(medication|injection)$/.test(payload.orderType);
      addRow({ id: 'order-draft-' + planIndex + '-' + index, action: executable && !commonBlock ? 'place_order' : '', kind: 'orders', label: executable ? ATHENA_ACTIONS.place_order.label + ': ' + payload.order.displayLabel : payload.orderTypeLabel,
        destination: payload.proposedDestination, capability: executable && !commonBlock ? 'ready' : 'blocked', source: payload.sourceLabel, reviewStatus: payload.reviewStatus,
        reason: commonBlock || (executable ? 'Ready for one exact typed order action. A clinician must review the frozen payload, pass the read-only Athena check, and click Confirm & place one order.' : (highRisk ? payload.orderEligibilityMessage : (payload.orderEligibilityMessage || 'This reviewed draft is incomplete or lacks an exact catalog binding. Complete it in the Orders workspace.'))),
        consequence: executable ? ATHENA_ACTIONS.place_order.consequence : (highRisk ? 'This high-risk order remains visible for manual Athena entry; MLS will not prescribe, inject, submit, or place it.' : 'Nothing is sent or executed for this incomplete or unbound draft.'),
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
    var exactVisitBlocked = !visit.visitDate || !visit.provider ||
      (!visit.appointmentId && !(visit.encounterId && visit.encounterUrl));
    var commonBlock = identityBlocked
      ? 'An immutable local patient ID plus the exact Athena name, DOB, and MRN are required. Nothing can be written.'
      : (exactVisitBlocked ? 'The exact visit needs its date, provider, and appointment ID (or a bound encounter ID and URL). MLS will not guess an encounter.' : '');
    var orderCommonBlock = commonBlock || (!supervisedOrderPlacementReady() ? 'Update MLS Assist before supervised order placement. This order remains visible for manual Athena entry.' : (!patient.patientId ? 'An immutable local patient ID is required for an Athena order audit. Nothing can be placed.' : (!patient.mrn ? 'An exact Athena MRN is required before an order can be offered for placement.' : '')));
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
      addRow({ id: 'write-note', action: 'write_note', kind: 'note', label: ATHENA_ACTIONS.write_note.label, destination: DESTINATION.note,
        capability: commonBlock ? 'blocked' : 'ready', reason: commonBlock, consequence: ATHENA_ACTIONS.write_note.consequence, payload: notePayload, order: UNIFIED_ORDER.write_note });
    }
    var billingPlan = null;
    for (var pi = 0; pi < plan.length; pi++) { if (planKind(plan[pi] && plan[pi].kind) === 'billing') { billingPlan = plan[pi]; break; } }
    var billingSource = billingPlan && billingPlan.billing ? billingPlan.billing : (opts.billing || opts.coding || {});
    var billing = normalizeBilling(billingSource);
    var billingReview = S(billingPlan && billingPlan.body || opts.billingText).trim();
    if (hasBilling(billing) || (billing.invalid && billing.invalid.length) || billingReview) {
      var billingReason = commonBlock || ((billing.invalid && billing.invalid.length) ? ('Invalid or conflicting billing item(s): ' + billing.invalid.join(', ')) : (!hasBilling(billing) ? 'No exact E/M or five-character CPT/HCPCS code is available.' : ''));
      addRow({ id: 'stage-billing', action: 'stage_billing', kind: 'billing', label: ATHENA_ACTIONS.stage_billing.label, destination: 'Athena encounter > Billing / Charges slate',
        capability: billingReason ? 'blocked' : 'ready', reason: billingReason, consequence: ATHENA_ACTIONS.stage_billing.consequence,
        payload: { billing: billing, reviewText: billingReview }, order: UNIFIED_ORDER.stage_billing });
    }
    var planHasDx = plan.some(function (entry) { return planKind(entry && entry.kind) === 'dx'; });
    if (!planHasDx && billing.diagnoses && billing.diagnoses.length) {
      plan.push({ kind: 'dx', body: 'ICD-10 DIAGNOSES (manual only):\n- ' + billing.diagnoses.join('\n- ') });
    }
    for (var i = 0; i < plan.length; i++) {
      var source = plan[i] || {}, kind = planKind(source.kind);
      if (kind === 'note' || kind === 'billing') continue;
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
    if (noteText) {
      addRow({ id: 'save-draft', action: 'save_draft', kind: 'save', label: ATHENA_ACTIONS.save_draft.label, destination: 'Athena encounter > Save / Save Draft control',
        capability: commonBlock ? 'blocked' : 'ready', reason: commonBlock, consequence: ATHENA_ACTIONS.save_draft.consequence, payload: notePayload, order: UNIFIED_ORDER.save_draft });
      var proofOpts = { receiptSessionId: receiptSessionId };
      var priorWrite = !commonBlock ? findAnyVerifiedWrite(patient, previewHash, proofOpts, notePayload) : null;
      addRow({ id: 'sign-encounter', action: 'sign_encounter', kind: 'sign', label: ATHENA_ACTIONS.sign_encounter.label, destination: 'Athena encounter > Sign & Save control',
        capability: priorWrite && priorWrite.noteWriteProof ? 'ready' : 'blocked',
        reason: priorWrite && priorWrite.noteWriteProof ? '' : 'Signing stays in your hands — not forbidden, just sequenced. Sign & Save requires a verified write proof from this exact review, so this row unlocks the moment the note write above is verified, then asks for your own separate confirmation. It is never auto-chained from a new write, and MLS never signs on its own.',
        consequence: ATHENA_ACTIONS.sign_encounter.consequence, payload: notePayload, order: UNIFIED_ORDER.sign_encounter });
    }
    rows.sort(function (a, b) { return a.order - b.order || a.id.localeCompare(b.id); });
    var manifestHash = hashPreview({ patient: patient, visit: visit, previewHash: previewHash, receiptSessionId: receiptSessionId, rows: rows.map(function (r) { return r.rowHash; }) });
    var manifest = {
      schema: 'mls-athena-write-manifest-v1', manifestId: 'athena-manifest-' + manifestHash.replace('mls-preview-', ''),
      manifestHash: manifestHash, previewHash: previewHash, receiptSessionId: receiptSessionId,
      patient: patient, visit: visit, requireExpectedVisit: opts.requireExpectedVisit === true, rows: rows
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
      '<span data-mls-teach-status="' + esc(row.id) + '" data-state="' + esc(state) + '" style="font-size:11.5px;color:' + color + '"><b>' + esc(state === 'idle' ? 'READY TO TEACH' : state.toUpperCase()) + ':</b> ' + esc(message) + '</span></div>';
  }
  function disableUnifiedGo() {
    var go = document.getElementById('mlsAthenaUnifiedGo'); if (!go) return;
    go.disabled = true; go.setAttribute('aria-disabled', 'true'); go.removeAttribute('data-mls-athena-action'); go.removeAttribute('data-mls-preview-hash'); go.removeAttribute('data-mls-row-hash'); go.removeAttribute('data-mls-client-order-id');
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
      status.innerHTML = '<b>' + esc(value === 'idle' ? 'READY TO TEACH' : value.toUpperCase()) + ':</b> ' + esc(S(current.message || (learned ? 'Captured and validated for this exact destination.' : 'Optional: open the destination screen in athenaOne FIRST, then click Teach destination - your next Athena click is captured, never activated.')));
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
  function closeUnifiedConfirmation() {
    var state = unifiedAthenaState;
    if (state) {
      var teacher = destinationTeacher();
      if (teacher && typeof teacher.cancelForRow === 'function') state.manifest.rows.forEach(function (row) { if (row.action) try { teacher.cancelForRow(state.manifest, row); } catch (e) {} });
      state.closed = true;
    }
    unifiedAthenaState = null;
    try { var ov = document.getElementById('mlsAthenaUnifiedConfirm'); if (ov) ov.remove(); } catch (e) {}
  }
  function unifiedStatus(state, message, kind) {
    if (!state || state.closed) return;
    var el = null; try { el = document.getElementById('mlsAthenaUnifiedProbe'); } catch (e) {}
    if (el) { el.style.color = kind === 'err' ? '#8b2525' : (kind === 'ok' ? '#205c43' : '#6d5010'); el.textContent = message; }
    actionSay(state.sourceOpts, message, kind);
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
      encounterId: contextValue(ctx, ['encounterId', 'visitId', 'id'], ''), encounterUrl: contextValue(ctx, ['encounterUrl', 'visitUrl', 'url'], ''),
      visitDate: contextValue(ctx, ['visitDate', 'encounterDate', 'date'], ''), provider: contextValue(ctx, ['provider', 'providerName'], '')
    };
    var control = contextValue(ctx, ['control', 'controlLabel', 'actionControl'], '');
    if (!lockedContext.encounterId || !lockedContext.encounterUrl || !lockedContext.visitDate || !lockedContext.provider || !control) {
      return { ok: false, error: 'Athena did not report one exact encounter date, provider, ID, URL, and action control. Nothing was changed.' };
    }
    return { ok: true, token: token, patient: { name: patient.name, dob: patient.dob, mrn: mrn, patientId: S(patient.patientId).trim() }, context: lockedContext, control: control, rawContext: stableClone(ctx) };
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
    renderUnifiedContext(state, null);
    unifiedStatus(state, 'Checking the exact Athena patient, encounter, destination, and control read-only for ' + row.label + '...', '');
    var proofOpts = { receiptSessionId: state.manifest.receiptSessionId };
    var priorWrite = row.action === 'sign_encounter' ? findAnyVerifiedWrite(state.manifest.patient, state.manifest.previewHash, proofOpts, row.payload) : null;
    if (row.action === 'sign_encounter' && (!priorWrite || !priorWrite.noteWriteProof)) { unifiedStatus(state, 'Sign & Save unlocks after a verified note write in this review. Run Write reviewed note first, then re-open and select Sign & Save — it always asks for your own confirmation.', 'err'); return; }
    var bridgeProbePatient = bridgePatient(state.manifest.patient);
    var taughtDestination = taughtDestinationFor(state.manifest, row);
    bridge('mlsAppAthenaActionV2', {
      mode: 'probe', action: row.action, patient: bridgeProbePatient, expectedPatient: bridgeProbePatient,
      expectedContext: state.manifest.visit, previewHash: state.manifest.previewHash, manifestHash: state.manifest.manifestHash, payload: row.payload,
      noteText: row.payload.noteText || '', sections: row.payload.sections || [], notePolicy: 'empty_only',
      noteWriteProof: priorWrite ? priorWrite.noteWriteProof : '', billing: row.payload.billing || null, order: row.payload.order || null,
      rowHash: row.rowHash, taughtDestination: taughtDestination,
      clientOrderId: row.action === 'place_order' ? S(row.payload.order && row.payload.order.clientOrderId).trim() : ''
    }, 'mlsAppAthenaActionV2Result', 90000).then(function (probe) {
      if (state.closed || unifiedAthenaState !== state || generation !== state.probeGeneration) return;
      if (!probe || !probe.ok) {
        /* wf2-1.9.0 QoL: a refused read-only probe is almost always fixable by
           the doctor. Say HOW, and offer one explicit re-check instead of
           making them reopen the whole review. */
        var probeErr = S(probe && (probe.error || probe.message || probe.reason)) || 'Athena context could not be verified. Nothing was changed.';
        if (/encounter frame|context.unverified|context.mismatch/i.test(probeErr + ' ' + S(probe && probe.reason))) probeErr += ' To unlock: in athenaOne, open this patient\'s encounter for documentation (check the patient in and open the visit note), then press Check Athena again.';
        unifiedStatus(state, probeErr, 'err');
        unifiedRecheckButton(state, row.id);
        return;
      }
      var lock = validatedUnifiedProbe(state.manifest.patient, probe);
      if (!lock.ok) { unifiedStatus(state, lock.error, 'err'); return; }
      var exactWrite = row.action === 'sign_encounter' ? findVerifiedWrite(lock.patient, state.manifest.previewHash, proofOpts, row.payload, lock.context) : null;
      if (row.action === 'sign_encounter' && (!exactWrite || !exactWrite.noteWriteProof)) { unifiedStatus(state, 'The verified note proof does not match this exact Athena encounter. Sign & Save remains blocked.', 'err'); return; }
      var probedClientOrderId = row.action === 'place_order' ? S(probe.clientOrderId).trim() : '';
      if (row.action === 'place_order' && (S(probe.rowHash).trim() !== row.rowHash || probedClientOrderId !== S(row.payload.order && row.payload.order.clientOrderId).trim())) { unifiedStatus(state, 'The Athena order authorization did not bind this exact immutable row. Nothing was changed.', 'err'); return; }
      state.probe = deepFreeze({ rowId: row.id, rowHash: row.rowHash, clientOrderId: probedClientOrderId, manifestHash: state.manifest.manifestHash, token: lock.token, patient: lock.patient, context: lock.context, control: lock.control, rawContext: lock.rawContext, verifiedWrite: exactWrite, taughtDestination: stableClone(taughtDestination), taughtDestinationHash: hashPreview(taughtDestination || {}) });
      renderUnifiedContext(state, lock);
      if (go) {
        go.disabled = false; go.setAttribute('aria-disabled', 'false'); go.textContent = row.action === 'place_order' ? 'Confirm & place one order' : 'Confirm & write'; go.setAttribute('data-mls-athena-action', row.action);
        go.setAttribute('data-mls-preview-hash', state.manifest.previewHash); go.setAttribute('aria-label', UNIFIED_ARIA[row.action]); go.title = UNIFIED_ARIA[row.action] + '. Runs only this selected action.';
        if (row.action === 'place_order') { go.setAttribute('data-mls-row-hash', row.rowHash); go.setAttribute('data-mls-client-order-id', probedClientOrderId); }
      }
      unifiedStatus(state, 'Ready. Review the full payload and exact Athena context, then use the single Confirm & write button. Only ' + row.label + ' will run.', '');
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
    var colors = { verified: '#205c43', uncertain: '#8b2525', blocked: '#8b2525', manual: '#6d5010', 'not attempted': '#52675c' };
    host.innerHTML = '<div style="font-weight:800;color:#204034;margin-bottom:6px">Receipt for this immutable manifest</div>' + state.manifest.rows.map(function (row) {
      var r = receiptStateForRow(state, row), label = S(r.status).toUpperCase();
      return '<div style="border-top:1px solid #e2e8f2;padding:7px 0"><b>' + esc(row.label) + '</b><span style="float:right;color:' + (colors[r.status] || '#52675c') + ';font-weight:800">' + esc(label) + '</span><div style="clear:both;color:#52675c;font-size:12px">' + esc(r.message) + '</div></div>';
    }).join('');
    var wrote = state.manifest.rows.some(function (row) { return row.action === 'write_note' && state.receipts[row.id] && state.receipts[row.id].status === 'verified'; });
    var signBlocked = state.manifest.rows.some(function (row) { return row.action === 'sign_encounter' && row.capability === 'blocked'; });
    if (wrote && signBlocked && !state.halted) {
      var b = document.createElement('button'); b.type = 'button'; b.id = 'mlsAthenaUnifiedReviewSign'; b.textContent = 'Review Sign & Save separately';
      b.style.cssText = 'margin-top:9px;border:1px solid #cfdad4;background:#fff;color:#204034;border-radius:9px;padding:8px 10px;font-weight:750;cursor:pointer';
      b.onclick = function () { var next = state.reopenOpts; closeUnifiedConfirmation(); next.preferredAction = 'sign_encounter'; openUnifiedConfirmation(next); };
      host.appendChild(b);
    }
  }
  function resultToUnifiedReceipt(state, row, resp, probe) {
    resp = resp || {}; var status = 'blocked', message = '', verifiedWrite = null;
    var attempted = resp.attempted === true || resp.partialMutation === true || resp.reason === 'outcome-uncertain';
    if (resp.__timeout) { status = 'uncertain'; message = 'No completion response arrived. Athena may already have changed. Inspect the exact destination before any retry; no other action ran.'; }
    else if (row.action === 'stage_billing' && (resp.partialMutation === true || ((resp.stagedCodes || []).length && resp.ok !== true))) { status = 'uncertain'; message = billingResultSummary(resp, row.payload) || 'Billing was partially changed or not fully verified. Inspect the billing slate before retrying.'; }
    else if (!resp.ok) { status = attempted ? 'uncertain' : 'blocked'; message = S(resp.error || resp.message || resp.reason) || 'Athena refused the selected action. No other action ran.'; }
    else if (row.action === 'write_note') {
      verifiedWrite = rememberVerifiedWrite(probe.patient, state.manifest.previewHash, { receiptSessionId: state.manifest.receiptSessionId }, row.payload, probe.context, resp);
      status = verifiedWrite ? 'verified' : 'uncertain';
      message = verifiedWrite ? 'The exact reviewed unsigned note was written and verified. Save, Sign, billing, orders, and prescriptions did not run.' : 'Athena did not return a verified exact-note receipt. Inspect the note before retrying; Sign remains locked.';
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
    var receipt = deepFreeze({ rowId: row.id, action: row.action, status: status, message: message, patientId: S(state.manifest.patient && state.manifest.patient.patientId).trim(), manifestHash: state.manifest.manifestHash, rowHash: row.rowHash, context: stableClone(probe && probe.context), completedAt: new Date().toISOString() });
    state.receipts[row.id] = receipt;
    if (status === 'uncertain') state.halted = true;
    return receipt;
  }
  function executeUnifiedSelection(state) {
    if (!state || state.closed || state.running || state.halted) return;
    var row = unifiedRow(state.manifest, state.selectedRowId), probe = state.probe, go = document.getElementById('mlsAthenaUnifiedGo');
    if (!row || row.capability !== 'ready' || !probe || probe.rowId !== row.id || probe.rowHash !== row.rowHash || probe.manifestHash !== state.manifest.manifestHash) { unifiedStatus(state, 'The selected action is not bound to a fresh exact Athena check. Nothing was changed.', 'err'); return; }
    if (!go || go.getAttribute('data-mls-athena-action') !== row.action || go.getAttribute('data-mls-preview-hash') !== state.manifest.previewHash || (row.action === 'place_order' && (go.getAttribute('data-mls-row-hash') !== row.rowHash || go.getAttribute('data-mls-client-order-id') !== S(row.payload.order && row.payload.order.clientOrderId).trim()))) { unifiedStatus(state, 'The confirmation binding changed. Nothing was written; select the action again.', 'err'); return; }
    var currentTaughtDestination = taughtDestinationFor(state.manifest, row);
    if (probe.taughtDestinationHash !== hashPreview(currentTaughtDestination || {})) { unifiedStatus(state, 'The taught destination changed after the read-only check. Select the action again before writing.', 'err'); invalidateUnifiedProbeForTeach(state); return; }
    state.running = true; go.disabled = true; go.setAttribute('aria-disabled', 'true'); go.textContent = 'Working...';
    var cancel = document.getElementById('mlsAthenaUnifiedCancel'), close = document.getElementById('mlsAthenaUnifiedClose');
    if (cancel) cancel.disabled = true; if (close) close.disabled = true;
    var radios = document.querySelectorAll('#mlsAthenaUnifiedConfirm input[name="mlsAthenaUnifiedAction"]');
    for (var ri = 0; ri < radios.length; ri++) radios[ri].disabled = true;
    var bridgeExecutePatient = bridgePatient(probe.patient);
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
      var receipt = resultToUnifiedReceipt(state, row, resp || {}, completedProbe);
      state.probe = null;
      renderUnifiedReceipts(state);
      if (go) { go.disabled = true; go.setAttribute('aria-disabled', 'true'); go.textContent = row.action === 'place_order' ? 'Confirm & place one order' : 'Confirm & write'; go.removeAttribute('data-mls-athena-action'); go.removeAttribute('data-mls-preview-hash'); go.removeAttribute('data-mls-row-hash'); go.removeAttribute('data-mls-client-order-id'); }
      if (cancel) cancel.disabled = false; if (close) close.disabled = false;
      unifiedStatus(state, receipt.message + (state.halted ? ' This manifest is halted because the outcome is uncertain.' : ' No other action ran automatically.'), receipt.status === 'verified' ? 'ok' : 'err');
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
      previewHash: manifest.previewHash, receiptSessionId: manifest.receiptSessionId, statusEl: opts.statusEl || null, preferredAction: opts.preferredAction || ''
    };
  }
  function renderUnifiedOrderSummary(orderRows, manifest) {
    if (!orderRows.length) return '';
    var items = orderRows.map(function (row) {
      var payload = row.payload || {}, blocked = row.capability === 'blocked', selectable = row.capability === 'ready' && row.action === 'place_order';
      var statusColor = blocked ? '#8b2525' : '#7a5a16';
      return '<div data-manifest-row="' + esc(row.id) + '" style="padding:9px 0;border-top:1px solid #e3ebe6">' +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' + (selectable ? '<input type="radio" name="mlsAthenaUnifiedAction" value="' + esc(row.id) + '" aria-label="Select ' + esc(row.label) + '">' : '') + '<b style="color:#203b2e">' + esc(payload.orderTypeLabel || row.label) + '</b>' +
        '<span style="font-size:10px;font-weight:850;color:' + statusColor + ';border:1px solid currentColor;border-radius:999px;padding:1px 6px">' + esc((row.action === 'sign_encounter' && row.capability === 'blocked') ? 'AFTER WRITE · YOUR CONFIRM' : (row.reviewStatus || row.capability).toUpperCase()) + '</span></div>' +
        '<div style="font-size:11.5px;color:#385b49;margin-top:2px"><b>Destination:</b> ' + esc(row.destination) + '</div>' +
        '<div style="font-size:11.5px;color:#52675c;margin-top:2px"><b>Source:</b> ' + esc(row.source || payload.sourceLabel || 'Provider-entered draft') + ' &middot; <b>Capability:</b> ' + esc(row.capability.toUpperCase()) + '</div>' +
        '<details style="margin-top:5px"><summary style="cursor:pointer;font-weight:700;color:#204034">Review complete proposed order</summary>' +
        '<div style="font-size:10.5px;color:#52675c;margin:4px 0">Payload ' + esc(row.payloadHash) + ' | Row ' + esc(row.rowHash) + '</div>' +
        '<pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:190px;overflow:auto;margin:0;padding:8px;border:1px solid #dbe7e0;border-radius:8px;background:#fff;color:#1f3027;font:11.5px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace">' + esc(manifestPayloadText(row)) + '</pre></details>' +
        '<div style="font-size:11.5px;color:' + statusColor + ';margin-top:5px">' + esc(row.reason) + '</div>' + teachingHtml(manifest, row) + '</div>';
    }).join('');
    return '<section data-mls-orders-summary="1" style="border:1px solid #cfded5;border-radius:11px;padding:10px 12px;margin-top:9px;background:#f7fbf9">' +
      '<div style="display:flex;gap:8px;align-items:center"><b style="font-size:14px;color:#204034">Orders proposed for Athena</b><span style="margin-left:auto;font-size:11px;color:#52675c">' + orderRows.length + ' item' + (orderRows.length === 1 ? '' : 's') + '</span></div>' +
      '<div style="font-size:11.5px;color:#52675c;margin:3px 0 5px">A complete reviewed imaging, PT, referral, or DME row can be selected for one exact typed Athena action. Every row needs its own read-only check and real clinician click. Suggestions, Rx, injections, and incomplete rows cannot execute, and nothing auto-chains.</div>' + items + '</section>';
  }
  function renderUnifiedConfirmation(state) {
    closeActionConfirm();
    try { var oldReceipt = document.getElementById('athenaReceipt'); if (oldReceipt) oldReceipt.remove(); } catch (e0) {}
    var old = document.getElementById('mlsAthenaUnifiedConfirm'); if (old) old.remove();
    var manifest = state.manifest, ready = manifest.rows.filter(function (r) { return r.capability === 'ready' && r.action; });
    var chosen = ready.filter(function (r) { return r.action === state.sourceOpts.preferredAction; })[0] || ready[0] || null;
    var orderRows = manifest.rows.filter(function (row) { return row.payload && row.payload.category === 'order'; });
    var renderedOrders = false;
    var rowsHtml = manifest.rows.map(function (row) {
      if (row.payload && row.payload.category === 'order') {
        if (renderedOrders) return '';
        renderedOrders = true;
        return renderUnifiedOrderSummary(orderRows, manifest);
      }
      var selectable = row.capability === 'ready' && row.action;
      var badgeColor = row.capability === 'ready' ? '#205c43' : (row.capability === 'manual' ? '#7a5a16' : '#8b2525');
      return '<section data-manifest-row="' + esc(row.id) + '" style="border:1px solid #dce5df;border-radius:11px;padding:11px 12px;margin-top:9px;background:#fff">' +
        '<div style="display:flex;gap:9px;align-items:flex-start">' + (selectable ? '<input type="radio" name="mlsAthenaUnifiedAction" value="' + esc(row.id) + '" style="margin-top:4px">' : '<span style="width:13px"></span>') +
        '<div style="flex:1;min-width:0"><div><b>' + esc(row.label) + '</b><span style="float:right;color:' + badgeColor + ';font-size:11px;font-weight:850">' + esc(row.capability.toUpperCase()) + '</span></div>' +
        '<div style="clear:both;color:#385b49;font-size:12px;margin-top:2px">Destination: ' + esc(row.destination) + '</div>' +
        (row.reason ? '<div style="color:' + badgeColor + ';font-size:12px;margin-top:5px">' + esc(row.reason) + '</div>' : '') +
        '<div style="color:#52675c;font-size:12px;margin-top:5px"><b>Consequence:</b> ' + esc(row.consequence) + '</div>' +
        '<details style="margin-top:7px"><summary style="cursor:pointer;font-weight:750;color:#204034">Review full payload and hashes</summary><div style="font-size:11px;color:#52675c;margin:5px 0">Payload ' + esc(row.payloadHash) + ' | Row ' + esc(row.rowHash) + '</div><pre style="white-space:pre-wrap;overflow-wrap:anywhere;max-height:220px;overflow:auto;margin:0;padding:9px;border:1px solid #dbe7e0;border-radius:8px;background:#f7fbf9;color:#1f3027;font:12px/1.45 ui-monospace,SFMono-Regular,Consolas,monospace">' + esc(manifestPayloadText(row)) + '</pre></details>' + teachingHtml(manifest, row) + '</div></div></section>';
    }).join('');
    var ov = document.createElement('div'); ov.id = 'mlsAthenaUnifiedConfirm';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(10,25,50,.55);display:flex;align-items:center;justify-content:center;padding:18px';
    var card = document.createElement('div'); card.style.cssText = 'background:#fff;color:#1A211C;width:min(760px,96vw);max-height:92vh;overflow:auto;border-radius:16px;box-shadow:0 24px 70px rgba(10,30,70,.42);padding:20px 22px;font:13px/1.5 system-ui';
    card.innerHTML = '<div style="display:flex;gap:10px;align-items:flex-start"><div style="flex:1"><div style="font-size:20px;font-weight:850;color:#204034">Review everything going to Athena</div><div style="color:#52675c;margin-top:3px">One immutable manifest, one visible confirmation page, and exactly one typed action per Confirm & write click.</div></div><button type="button" id="mlsAthenaUnifiedClose" aria-label="Close Athena review" style="border:0;background:none;font-size:23px;color:#66766d;cursor:pointer">&times;</button></div>' +
      '<div style="display:grid;grid-template-columns:120px 1fr;gap:5px 9px;margin-top:12px;padding:11px 12px;background:#f7f9fb;border:1px solid #e2e8f2;border-radius:10px"><span>Patient</span><b>' + esc(manifest.patient.name || '(missing)') + '</b><span>DOB</span><b>' + esc(manifest.patient.dob || '(missing)') + '</b><span>MRN</span><b>' + esc(manifest.patient.mrn || 'verified from Athena before writing') + '</b><span>MLS patient ID</span><b>' + esc(manifest.patient.patientId || '(missing)') + '</b><span>Expected visit</span><b>' + esc(manifest.visit.visitDate || 'unique encounter must be discovered') + '</b><span>Expected provider</span><b>' + esc(manifest.visit.provider || 'verified from Athena before writing') + '</b><span>Appointment ID</span><b>' + esc(manifest.visit.appointmentId || 'verified from Athena before writing') + '</b><span>Expected encounter</span><b>' + esc(manifest.visit.encounterId || 'verified from Athena before writing') + '</b><span>Manifest</span><b>' + esc(manifest.manifestHash) + '</b></div>' +
      '<div style="margin-top:11px;padding:9px 11px;border:1px solid #f0d79a;background:#fff7e6;border-radius:9px;color:#6d5010"><b>Nothing has changed yet.</b> Manual and blocked rows never cross the write bridge. Select exactly one READY row. A partial or uncertain result halts this manifest; MLS never retries or auto-chains.</div>' +
      rowsHtml + '<div id="mlsAthenaUnifiedContext" style="margin-top:11px;padding:10px 12px;border:1px solid #cfe0d7;background:#f7fbf9;border-radius:10px;color:#204034"><b>Exact Athena encounter:</b> waiting for the read-only check.</div>' +
      '<div id="mlsAthenaUnifiedProbe" role="status" style="margin-top:8px;color:#6d5010">Choose one ready action to run its read-only Athena check.</div>' +
      '<div id="mlsAthenaUnifiedReceipt" style="margin-top:11px;padding:10px 12px;border:1px solid #e2e8f2;background:#fff;border-radius:10px"></div>' +
      '<div style="display:flex;gap:9px;position:sticky;bottom:-20px;background:#fff;padding:12px 0 2px"><button type="button" id="mlsAthenaUnifiedCancel" style="flex:1;border:1px solid #d8ddd9;background:#fff;border-radius:10px;padding:11px;font-weight:750;cursor:pointer">Close review</button><button type="button" id="mlsAthenaUnifiedGo" disabled aria-disabled="true" style="flex:1;border:0;background:#204034;color:#fff;border-radius:10px;padding:11px;font-weight:850;cursor:pointer">Confirm &amp; write</button></div>';
    ov.appendChild(card); document.body.appendChild(ov);
    var cancel = card.querySelector('#mlsAthenaUnifiedCancel'), close = card.querySelector('#mlsAthenaUnifiedClose'), go = card.querySelector('#mlsAthenaUnifiedGo');
    cancel.onclick = closeUnifiedConfirmation; close.onclick = closeUnifiedConfirmation;
    ov.addEventListener('click', function (ev) { if (ev.target === ov && !state.running) closeUnifiedConfirmation(); });
    go.addEventListener('click', function () { executeUnifiedSelection(state); });
    var radios = card.querySelectorAll('input[name="mlsAthenaUnifiedAction"]');
    for (var i = 0; i < radios.length; i++) radios[i].addEventListener('change', function () { probeUnifiedRow(state, this.value); });
    wireUnifiedTeaching(state, card);
    renderUnifiedReceipts(state);
    if (chosen) {
      for (var ri = 0; ri < radios.length; ri++) if (radios[ri].value === chosen.id) radios[ri].checked = true;
      probeUnifiedRow(state, chosen.id);
    }
  }
  function openUnifiedConfirmation(opts) {
    opts = opts || {};
    if (athenaActionRunning) { actionSay(opts, 'Another Athena action is already awaiting confirmation. Finish or cancel it before opening the unified review.', ''); return null; }
    if (unifiedAthenaState) closeUnifiedConfirmation();
    var manifest = buildUnifiedManifest(opts);
    var state = { manifest: manifest, sourceOpts: opts, reopenOpts: null, selectedRowId: '', probe: null, probeGeneration: 0, receipts: {}, running: false, halted: false, closed: false };
    state.reopenOpts = reopenOptions(opts, manifest);
    unifiedAthenaState = state;
    if (typeof document !== 'undefined' && document.body) renderUnifiedConfirmation(state);
    actionSay(opts, 'Unified Athena review ready. Nothing changes until you select one ready destination and use Confirm & write.', '');
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
    exam: 'exam', physical_exam: 'exam',
    assessment: 'assessment', assessment_narrative: 'assessment',
    plan: 'plan', followup: 'plan', follow_up: 'plan'
  };
  var PREVIEW_ONLY = {
    orders: 1, rx: 1, referrals: 1, pt: 1, imaging: 1, billing: 1,
    surgctr: 1, consent: 1, handouts: 1, instructions: 1
  };
  var DESTINATION = {
    note: 'Athena encounter > Encounter note',
    hpi: 'Athena encounter > HPI',
    exam: 'Athena encounter > Physical Exam',
    assessment: 'Athena encounter > Assessment narrative',
    plan: 'Athena encounter > Plan / Follow-up',
    orders: 'Athena Orders (manual entry)', rx: 'Athena Prescriptions (manual entry)',
    referrals: 'Athena Orders > Referral (manual entry)', pt: 'Athena Orders > PT (manual entry)',
    imaging: 'Athena Orders > Imaging (manual entry)', billing: 'Athena Billing / Charges (manual entry)',
    surgctr: 'Surgery scheduling workflow (manual entry)', consent: 'Patient documents / consent (manual entry)',
    handouts: 'Patient documents / handout (manual entry)', instructions: 'Patient instructions (manual entry)'
  };
  function canonicalSectionKey(raw) {
    raw = S(raw).toLowerCase().trim();
    if (EXEC_ALIAS[raw]) return { key: EXEC_ALIAS[raw], execute: true };
    if (PREVIEW_ONLY[raw]) return { key: raw, execute: false, previewOnly: true };
    return null;
  }
  function gatherSections(panel) {
    var out = [], held = [], errors = [], blocked = [], byKey = {};
    var boxes = panel.querySelectorAll('input[data-k]');
    for (var i = 0; i < boxes.length; i++) {
      var raw = S(boxes[i].getAttribute('data-k')).toLowerCase().trim();
      if (!boxes[i].checked) continue;
      var ta = panel.querySelector('textarea[data-t="' + raw + '"]');
      var v = ta ? S(ta.value).trim() : '';
      if (!v) continue;
      var route = canonicalSectionKey(raw);
      if (!route) { errors.push(raw || '(blank)'); blocked.push({ key: raw || 'unknown', text: v }); continue; }
      if (route.previewOnly) { held.push({ key: raw, text: v, destination: DESTINATION[raw] || 'Manual destination required' }); continue; }
      if (/^follow_?up$/.test(raw) || raw === 'followup') v = 'Follow-up:\n' + v;
      if (byKey[route.key]) byKey[route.key].text += '\n\n' + v;
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
      logTo(logEl, '&#10003; <b>Done &mdash; ' + okN + ' section(s) durably verified on ' + esc(cName) + '.</b> Review and sign in Athena; MLS never clicks Save/Sign.');
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
    var note = null;
    for (var i = 0; i < plan.length; i++) { if (plan[i] && plan[i].kind === 'note') { note = plan[i]; break; } }
    var text = S(note && note.body).replace(/^\s*NOTE TEXT\s*:\s*/i, '').trim();
    if (!text) return [];
    /* The top receipt represents the complete generated encounter note. Send it
       through the driver's explicit encounter-note route; diagnosis, billing,
       orders, prescriptions, Save, and Sign remain independent actions. */
    return [{ key: 'note', text: text, execute: true, destination: DESTINATION.note }];
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
      plan.push({ kind: S(blocked[j] && blocked[j].key).trim() || 'unknown', body: S(blocked[j] && blocked[j].text).trim() });
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
    btn.textContent = 'Review selected Athena routes';
    btn.title = 'Opens the one immutable Athena destination review. Nothing changes until one exact action passes its read-only check and you click Confirm & write.';
    btn.setAttribute('data-mls-unified-write-review', '1');
    btn.onclick = function () { runV2(panel); };
    try {
      var actions = document.createElement('div');
      actions.id = 'wf2AthenaActions';
      actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:7px;margin-top:8px;align-items:center';
      function actionButton(id, label, action) {
        var b = document.createElement('button');
        b.type = 'button'; b.id = id; b.textContent = label;
        b.className = btn.className;
        b.style.cssText = 'flex:1 1 165px;min-height:38px';
        if (action === 'save_draft' || action === 'sign_encounter') {
          b.disabled = true;
          b.title = action === 'save_draft' ? 'This advanced panel writes separate section fields. Save the sections manually in Athena, or use the top full-note receipt for verified Save.' : 'Use the top Review Athena actions receipt. Sign unlocks there only after its full-note write is verified.';
        }
        b.onclick = function () { openPanelUnifiedConfirmation(panel, action); };
        actions.appendChild(b);
      }
      actionButton('emrWbBilling', 'Stage billing codes', 'stage_billing');
      actionButton('emrWbSave', 'Save draft in Athena', 'save_draft');
      actionButton('emrWbSign', 'Sign & Save in Athena', 'sign_encounter');
      var explain = document.createElement('div');
      explain.style.cssText = 'flex:1 0 100%;font-size:11.5px;line-height:1.45;color:#B9CEC2';
      explain.textContent = 'Every selected item opens the same immutable Athena review used by the top workflow. HPI, Exam, Assessment, and Plan are frozen together as one reviewed unsigned note; exact E/M and CPT/HCPCS codes are a separate ready action. Orders, prescriptions, diagnoses, modifiers, and unsupported destinations remain visible as manual or blocked. One Confirm & write click can perform exactly one typed action; nothing auto-chains.';
      actions.appendChild(explain);
      if (btn.parentNode) btn.parentNode.insertBefore(actions, btn.nextSibling);
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
    if (cur) return true;
    /* generate a starting draft from the patient's own record (generic) */
    var p = activePt(); if (!p) return false;
    var vs = Array.isArray(p.visits) ? p.visits : [];
    var latest = null;
    for (var i = 0; i < vs.length; i++) { if (vs[i] && (vs[i].aiSummary || vs[i].raw)) { latest = vs[i]; break; } }
    var parts = [];
    if (latest && S(latest.aiSummary).trim()) parts.push('HPI: ' + S(latest.aiSummary).trim());
    else if (latest && S(latest.raw).trim()) parts.push('HPI: ' + S(latest.raw).trim().slice(0, 600));
    if (S(p.problems).trim()) parts.push('Assessment: ' + S(p.problems).trim().split('\n').slice(0, 6).join('; '));
    if (!parts.length && S(p.summary).trim()) parts.push('HPI: ' + S(p.summary).trim().slice(0, 600));
    if (!parts.length) return false;
    var txt = parts.join('\n\n');
    if (n.value != null) { n.value = txt; try { n.dispatchEvent(new Event('input', { bubbles: true })); } catch (e) {} }
    else n.textContent = txt;
    return true;
  }
  function oneClick() {
    var p = activePt();
    if (!p || !p.name) { try { alert('Pick a patient first.'); } catch (e) {} return; }
    STATE.oneClicks++;
    /* PULL: open the patient chart in athenaOne (background, identity-checked
       by the opener); the write's own identity gate re-verifies on the DOM. */
    try { window.postMessage({ type: 'mlsAppSearchOpenPatient', source: 'mls-app', name: S(p.name), dob: S(p.dob) }, '*'); } catch (e) {}
    /* GENERATE: make sure there is note content to organize. */
    ensureNoteContent();
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
  function addOneClickButton() {
    try {
      if (stopped || document.getElementById('wf2OneClick')) return;
      var sw = null;
      var btns = document.querySelectorAll('button');
      for (var i = 0; i < btns.length; i++) { if (/^Switch patient$/i.test(S(btns[i].textContent).trim())) { sw = btns[i]; break; } }
      if (!sw || !sw.parentElement) return;
      var b = document.createElement('button');
      b.id = 'wf2OneClick';
      b.type = 'button';
      b.textContent = 'Place Athena draft';
      b.title = 'Opens the chart and review panel. Only canonical HPI, Exam, Assessment and Plan drafts may be attempted; structured actions remain manual, and Done requires durable verification.';
      b.style.cssText = 'margin-left:6px;background:#d97706;border:none;color:#fff;border-radius:10px;padding:6px 12px;font-weight:800;font-size:12.5px;cursor:pointer';
      b.onclick = oneClick;
      sw.parentElement.insertBefore(b, sw.nextSibling);
    } catch (e) {}
  }

  /* --------------------------------- boot ----------------------------------- */
  var mo = null;
  function boot() {
    addOneClickButton();
    try {
      mo = new MutationObserver(function () {
        if (stopped) return;
        addOneClickButton();
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
    canonicalSectionKey: canonicalSectionKey, destinations: DESTINATION,
    inspectSections: gatherSections,
    revert: revert
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
