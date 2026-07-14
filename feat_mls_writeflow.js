/* =============================================================================
 * feat_mls_writeflow.js -> window.__mlsWriteFlow  (wf2-1.4.0)
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
 * 2) UNIFIED BRIDGE: the panel's write button is rewired to the v2.05
 *    mlsAppWriteV2 bridge (one top-frame shadow-aware driver). Sections:
 *      - hpi/exam/assessment/plan: explicit canonical destinations only
 *      - history -> hpi; followup/follow_up -> plan (merged, never generic)
 *      - orders/prescriptions/billing/documents: retained in the visible
 *        routing review for manual entry and never sent to this bridge
 *
 * 3) SUGGESTED ORDERS: one-click chips derived from the visit note content
 *    ("We suggest: [+ MRI lumbar spine]") - clicking adds that order line to
 *    the Orders card so it appears in the final preview. Preview only; the
 *    extension never sends orders.
 *
 * 4) COPY CLEANUP: the legacy "Orders - confirmed for your reference but never
 *    sent by MLS (athenaOne orders auto-execute; enter these in Athena
 *    yourself)." banner is removed from the review screen (behavior is
 *    unchanged - orders still are never sent; only the copy is gone).
 *
 * Additive; revert(): window.__mlsWriteFlow.revert(). ASCII-only.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsWriteFlow && window.__mlsWriteFlow.installed) return;

  var VERSION = 'wf2-1.4.0';
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

  /* ---------------- explicit Athena actions ------------------------------ */
  /* Note write, Save, Sign, and Billing are deliberately independent. Each action first
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
    }
  };
  var athenaActionRunning = false;

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
    return { name: S(p.name).trim(), dob: S(p.dob).trim(), mrn: S(p.mrn || p.athenaId || '').trim() };
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
    if (rows.length > 1 && rows[0].distance === rows[1].distance && String(rows[0].row.id || '') !== String(rows[1].row.id || '')) return null;
    var hit = rows[0].row;
    var day = suppliedDate || visitDay(hit.day_local || hit.appt_date || hit.start_at);
    var provider = suppliedProvider || apptProvider(hit);
    if (!day || !provider) return null;
    return { visitDate: athenaVisitDate(day), provider: provider, appointmentId: suppliedAppointment || S(hit.id || ''), encounterId: suppliedEncounter, encounterUrl: suppliedEncounterUrl };
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
    var cptInput = source.cpt || source.cpts || source.cptCodes || source.codes || [];
    if (!Array.isArray(cptInput)) cptInput = [cptInput];
    if (!cptInput.length && raw) {
      raw.split(/\r?\n/).forEach(function (line) {
        if (/\bE\/?M(?:\s+level)?\s*[:#-]?\s*[A-Z0-9]{5}\b/i.test(line)) return;
        if (/\b(?=[A-Z0-9]{5}\b)(?=[A-Z0-9]*\d)[A-Z0-9]{5}\b/i.test(line)) cptInput.push(line);
      });
    }
    var parsedCpt = cptInput.map(parseBillingItem);
    var invalid = invalidEm.concat(parsedCpt.filter(function (x) { return !x.code && x.raw; }).map(function (x) { return x.raw; }));
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
  /* Local receipt lookup uses the immutable name+DOB pair. The background-minted
     opaque proof separately binds the observed Athena MRN and rejects mismatch. */
  function actionPatientKey(p) { return nrmName(p && p.name) + '|' + nrmDob(p && p.dob); }
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
    var receipt = { action: 'write_note', patientKey: actionPatientKey(patient), patientName: S(patient && patient.name).trim(), patientDob: S(patient && patient.dob).trim(), patientMrn: S(patient && patient.mrn).trim(), previewHash: previewHash, receiptSessionId: S(opts && opts.receiptSessionId), noteHash: hashPreview(S(payload && payload.noteText)), contextSignature: returnedSig, context: returnedContext, noteWriteProof: S(resp.noteWriteProof).trim(), noteWriteProofExpiresAt: Number(resp.noteWriteProofExpiresAt || 0) || 0, verified: true };
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
    var lockedPatient = { name: patient.name, dob: patient.dob, mrn: athMrn };
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
      noteHtml(payload) + billingHtml(payload) +
      '<div style="margin-top:12px;padding:10px 12px;border-radius:10px;background:#fff7e6;border:1px solid #f0d79a;color:#664d12"><b>Consequence:</b> ' + esc(meta.consequence) + '</div>' +
      '<div style="display:flex;gap:9px;margin-top:15px"><button type="button" id="mlsAthenaActionCancel" style="flex:1;border:1px solid #d8ddd9;background:#fff;border-radius:10px;padding:10px;font-weight:700;cursor:pointer">Cancel</button><button type="button" id="mlsAthenaActionGo" style="flex:1;border:0;background:#204034;color:#fff;border-radius:10px;padding:10px;font-weight:800;cursor:pointer">Confirm ' + esc(meta.label) + '</button></div>';
    ov.appendChild(card); document.body.appendChild(ov);
    var cancel = card.querySelector('#mlsAthenaActionCancel');
    var go = card.querySelector('#mlsAthenaActionGo');
    go.setAttribute('data-mls-athena-action', action);
    go.setAttribute('data-mls-preview-hash', previewHash);
    cancel.onclick = function () { closeActionConfirm(); athenaActionRunning = false; actionSay(opts, 'Cancelled. Nothing was changed in Athena.', ''); };
    ov.addEventListener('click', function (ev) { if (ev.target === ov) cancel.click(); });
    go.addEventListener('click', function () {
      go.disabled = true; cancel.disabled = true; go.textContent = 'Working…';
      bridge('mlsAppAthenaActionV2', {
        mode: 'execute', action: action, actionToken: actionToken,
        patient: lockedPatient, expectedPatient: lockedPatient,
        previewHash: previewHash, payload: payload,
        noteText: payload.noteText || '', sections: payload.sections || [],
        notePolicy: 'empty_only',
        noteWriteProof: matchedWriteReceipt ? matchedWriteReceipt.noteWriteProof : '',
        billing: payload.billing || null, probeContext: ctx,
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
        actionSay(opts, action === 'stage_billing' ? ('Billing result verified in Athena. ' + (billingResultSummary(resp, payload) || 'All requested E/M and CPT/HCPCS codes were verified in the billing slate. No claim was submitted.')) : (action === 'save_draft' ? 'Athena confirmed the exact reviewed encounter content was saved as a draft. It was not signed or billed.' : 'Athena confirmed the exact reviewed encounter was signed and saved. Billing was not submitted.'), 'ok');
        try { if (typeof opts.onResult === 'function') opts.onResult(resp, { action: action, context: lockedContext, verifiedWrite: findVerifiedWrite(lockedPatient, previewHash, opts, payload, lockedContext) }); } catch (e4) {}
      });
    });
  }
  function startAthenaAction(action, opts) {
    opts = opts || {};
    if (!ATHENA_ACTIONS[action]) { actionSay(opts, 'Unsupported Athena action. Nothing was changed.', 'err'); return Promise.resolve({ ok: false, error: 'unsupported-action' }); }
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
    var previewHash = S(opts.previewHash || hashPreview({ patient: patient, action: action, payload: payload }));
    var expectedContext = expectedVisitContext(patient, opts);
    if (opts.requireExpectedVisit && (!expectedContext || !expectedContext.visitDate || !expectedContext.provider)) {
      actionSay(opts, 'This saved visit does not contain an exact encounter date and provider. Athena actions are disabled for it so the note cannot be placed in a different historical encounter. Nothing was changed.', 'err');
      return Promise.resolve({ ok: false, error: 'historical-encounter-context-missing' });
    }
    var priorWriteReceipt = action === 'sign_encounter' ? findAnyVerifiedWrite(patient, previewHash, opts, payload) : null;
    if (action === 'sign_encounter' && (!S(opts.receiptSessionId) || !priorWriteReceipt || !priorWriteReceipt.noteWriteProof)) {
      actionSay(opts, 'Sign & Save is locked until this receipt verifies that this exact reviewed note was written to the exact Athena encounter. Use Write reviewed note first; nothing was changed.', 'err');
      return Promise.resolve({ ok: false, error: 'verified-note-write-required' });
    }
    athenaActionRunning = true;
    actionSay(opts, 'Checking the exact Athena encounter before ' + ATHENA_ACTIONS[action].label + '…', '');
    return bridge('mlsAppAthenaActionV2', {
      mode: 'probe', action: action, patient: patient,
      expectedPatient: patient, expectedContext: expectedContext,
      previewHash: previewHash, payload: payload,
      noteText: payload.noteText || '', sections: payload.sections || [],
      notePolicy: 'empty_only',
      noteWriteProof: priorWriteReceipt ? priorWriteReceipt.noteWriteProof : '',
      billing: payload.billing || null
    }, 'mlsAppAthenaActionV2Result', 90000).then(function (probe) {
      probe = probe || {};
      if (!probe.ok) { athenaActionRunning = false; actionSay(opts, probe.error || probe.message || 'Athena context could not be verified. Nothing was changed.', 'err'); return probe; }
      try { if (typeof opts.onProbe === 'function') opts.onProbe(probe); } catch (e0) {}
      showActionConfirm(action, opts, patient, previewHash, payload, probe);
      return probe;
    });
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
    var out = [], held = [], errors = [], byKey = {};
    var boxes = panel.querySelectorAll('input[data-k]');
    for (var i = 0; i < boxes.length; i++) {
      var raw = S(boxes[i].getAttribute('data-k')).toLowerCase().trim();
      if (!boxes[i].checked) continue;
      var ta = panel.querySelector('textarea[data-t="' + raw + '"]');
      var v = ta ? S(ta.value).trim() : '';
      if (!v) continue;
      var route = canonicalSectionKey(raw);
      if (!route) { errors.push(raw || '(blank)'); continue; }
      if (route.previewOnly) { held.push({ key: raw, text: v, destination: DESTINATION[raw] || 'Manual destination required' }); continue; }
      if (/^follow_?up$/.test(raw) || raw === 'followup') v = 'Follow-up:\n' + v;
      if (byKey[route.key]) byKey[route.key].text += '\n\n' + v;
      else { byKey[route.key] = { key: route.key, text: v, execute: true, destination: DESTINATION[route.key] }; out.push(byKey[route.key]); }
    }
    return { sections: out, held: held, errors: errors };
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

  /* ------------------------- v2 write from the panel ------------------------ */
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
    actionSay(opts, 'Checking the exact patient, date, provider, encounter ID, URL, and note editor before showing the write confirmation. Save, Sign, billing, orders, and prescriptions will not run.', '');
    var next = {};
    for (var k in opts) next[k] = opts[k];
    next.sections = secs;
    return startAthenaAction('write_note', next);
  }
  function runV2(panel) {
    var logEl = panel.querySelector('#emrWbLog'); if (!logEl) return;
    var gathered = gatherSections(panel);
    if (gathered.errors.length) { bigRefusal(logEl, '&#9940; <b>Blocked unknown route(s):</b> ' + esc(gathered.errors.join(', ')) + '. Nothing was sent; choose a supported destination explicitly.'); return; }
    if (gathered.held.length) {
      logTo(logEl, '&#128065; <b>Preview-only/manual:</b> ' + gathered.held.map(function(x){return esc(x.key) + ' &rarr; ' + esc(x.destination);}).join(' · ') + '. These structured actions stay in MLS and are not sent through the note bridge.');
    }
    var secs = gathered.sections;
    if (!secs.length) { logTo(logEl, gathered.held.length ? 'No supervised free-text section was selected. Nothing was sent.' : 'Confirm at least one supported section first.'); return; }
    var p = activePt() || {};
    var want = { name: S(p.name), dob: S(p.dob), mrn: S(p.athenaId || p.mrn || '') };
    if (!want.name) { bigRefusal(logEl, '&#9940; No active patient selected. Pick the patient first, then write.'); return; }
    STATE.writes++;
    logTo(logEl, 'Verifying <b>' + esc(want.name) + '</b> before supervised draft placement: ' + secs.map(function(s){return '<b>'+esc(s.key)+'</b> &rarr; '+esc(s.destination);}).join(' · ') + '. No generic fallback is allowed.');
    bridge('mlsAppWriteV2', { patient: want.name, dob: want.dob, athenaId: want.mrn, sections: secs }, 'mlsAppWriteV2Result', 150000)
      .then(function (resp) { STATE.lastResp = resp; renderResp(logEl, resp, want); });
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
    btn.textContent = 'Write selected drafts';
    btn.title = 'Writes only the checked free-text draft sections. It does not Save, Sign, bill, order, or prescribe.';
    btn.setAttribute('data-mls-advanced-write', '1');
    btn.onclick = function () { runV2(panel); }; /* replace legacy per-frame path with the unified driver */
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
        b.onclick = function () {
          var p = actionPatient({});
          var gathered = gatherSections(panel);
          var hash = hashPreview({ patient: p, selectedDrafts: gathered.sections, held: gathered.held, billing: currentBilling(panel, {}) });
          startAthenaAction(action, { panel: panel, statusEl: logEl, patient: p, sections: gathered.sections, previewHash: hash, receiptSessionId: S(panel.getAttribute('data-wf2-session')) });
        };
        actions.appendChild(b);
      }
      actionButton('emrWbBilling', 'Stage billing codes', 'stage_billing');
      actionButton('emrWbSave', 'Save draft in Athena', 'save_draft');
      actionButton('emrWbSign', 'Sign & Save in Athena', 'sign_encounter');
      var explain = document.createElement('div');
      explain.style.cssText = 'flex:1 0 100%;font-size:11.5px;line-height:1.45;color:#B9CEC2';
      explain.textContent = 'This advanced panel keeps its section-by-section HPI, Exam, Assessment, and Plan destinations. Save and Sign & Save are intentionally unavailable here because they require one exact full-note editor; save these section fields manually in Athena, or use the top Review Athena actions receipt for verified full-note Save and proof-gated Sign. Stage billing applies exact E/M and CPT/HCPCS codes only; units, modifiers, diagnosis pointers, and diagnoses remain manual, and no claim is submitted. Orders and prescriptions stay separate and manual.';
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
    closeActionConfirm();
    window.__mlsWriteFlow.installed = false;
  }

  window.__mlsWriteFlow = {
    installed: true, version: VERSION, state: STATE,
    suggestOrders: suggestOrders, oneClick: oneClick, runV2: runV2,
    startAthenaAction: startAthenaAction, writeReceiptDrafts: writeReceiptDrafts,
    previewHash: hashPreview, normalizeBilling: normalizeBilling,
    canonicalSectionKey: canonicalSectionKey, destinations: DESTINATION,
    inspectSections: gatherSections,
    revert: revert
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
