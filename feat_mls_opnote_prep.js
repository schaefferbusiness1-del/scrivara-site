/* =============================================================================
 * feat_mls_opnote_prep.js  ->  window.__mlsOpNotePrep   (opnp-1.0.0)
 * -----------------------------------------------------------------------------
 * TASK 12 — OP-NOTE DRAFTING (schedule-prep flow). Hardens the LIVE
 * "Prep op notes" surface in ScribeFlow.html (openOpPrep / openOpPrepForPatient
 * / _opApptsForDay / _opNewRow / _opPatientCtx / _genOpNote / opPrepAutosaveDraft
 * / opPrepSave) so a scheduled procedure is drafted with the CORRECT date,
 * patient (by ID/MRN + DOB, never name alone), procedure, provider, facility,
 * and required provider identifiers — with explicit missing-information
 * warnings, full editing, a draft preview, and NO submission, ever.
 *
 * Additive + reversible (window.__mlsOpNotePrep_revert()). Pure ES5 (no
 * arrow/let/const/template-literal/async-await) so the same file runs under the
 * offline cscript JScript harness and matches the app's module convention.
 *
 * SCOPE: op-note DRAFTING only. It READS calendar (_calAppts), patient
 * (getPatients), and provider/practice settings (getProviderName/getNpi/
 * getPracticeName...) — it does NOT edit calendar/provider-selection code, the
 * patient-prep card, Copilot, or any write-back/orders path. It never calls any
 * Athena write bridge; the op-note save is a LOCAL History draft only.
 *
 * WHY (gaps found in the live b130 flow, ScribeFlow.html ~9919-10230):
 *   1. Patient resolved by NAME (lowercased) ALONE in _opPatientCtx /
 *      opPrepAutosaveDraft / opPrepSave -> two same-name patients collide; a
 *      draft can land on the wrong chart. (patient-safety)
 *   2. _genOpNote's known-facts carry name/sex/dob/age/BMI/MRN but NO provider,
 *      NO facility, NO NPI/credential -> the operative note does not state the
 *      operating provider, their identifiers, or the facility.
 *   3. No missing-information warnings for the schedule-level essentials
 *      (procedure / template / date / patient-DOB / provider / NPI / facility).
 *   4. openOpPrepForPatient stamps TODAY, not the patient's SCHEDULED procedure
 *      date.
 *   5. No procedure-day-aware default -> "Sunday prep for Monday" and "prep for
 *      Thursday" (the clinic's real recurring pattern) need a smart next-
 *      procedure-day default + quick affordances.
 * ===========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsOpNotePrep && window.__mlsOpNotePrep.installed) return; } catch (e) { return; }

  var VERSION = 'opnp-1.1.0';
  var STYLE_ID = 'mlsOpnpCss';

  function S(x) { return x == null ? '' : String(x); }
  function isFn(f) { return typeof f === 'function'; }
  function trim(x) { return S(x).replace(/^\s+|\s+$/g, ''); }
  function low(x) { return trim(x).toLowerCase(); }
  function nname(x) { return low(x).replace(/\s+/g, ' '); }
  function esc(s) {
    return S(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---- normalize a DOB to M/D/YYYY for comparison (handles ISO + m/d/y + 2-digit yr) ---- */
  function normDob(s) {
    s = trim(s); if (!s) return '';
    var iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return (+iso[2]) + '/' + (+iso[3]) + '/' + iso[1];
    var m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { var y = m[3].length === 2 ? ((+m[3] > 30 ? '19' : '20') + m[3]) : m[3]; return (+m[1]) + '/' + (+m[2]) + '/' + y; }
    return '';
  }
  function digits(s) { return S(s).replace(/\D/g, ''); }

  function getPts() { try { return (isFn(window.getPatients) ? window.getPatients() : []) || []; } catch (e) { return []; } }

  /* =========================================================================
   * (1) PATIENT IDENTITY — resolve by athena ID / MRN + DOB, NEVER name alone.
   * Returns { patient, status, warnings[] }.
   *   status: 'id-match' | 'name-dob-match' | 'ambiguous' | 'name-only' |
   *           'no-record'
   * An 'ambiguous' or name-only-with-conflict result is a SAFETY STOP for
   * saving to a chart (the caller must not silently pick one).
   * ======================================================================= */
  function apptId(appt) { appt = appt || {}; return S(appt.athenaId || appt.mrn || appt.patient_external_id || appt.externalId || ''); }
  function ptId(p) { p = p || {}; return S(p.athenaId || p.mrn || p.id || ''); }

  function resolvePatient(appt) {
    appt = appt || {};
    var out = { patient: null, status: 'no-record', warnings: [] };
    var pts = getPts();
    var wantId = digits(apptId(appt));
    var wantName = nname(appt.name);
    var wantDob = normDob(appt.dob);

    // Tier 1: exact athena-ID / MRN match (the only truly safe key).
    if (wantId) {
      var byId = [];
      for (var i = 0; i < pts.length; i++) {
        var pid = digits(S(pts[i].athenaId || pts[i].mrn || pts[i].id));
        if (pid && pid === wantId) byId.push(pts[i]);
      }
      if (byId.length === 1) { out.patient = byId[0]; out.status = 'id-match'; return out; }
      if (byId.length > 1) { out.status = 'ambiguous'; out.warnings.push('Multiple chart records share this athena ID — refusing to guess.'); return out; }
    }

    // Tier 2: name + DOB (both must match; DOB is the disambiguator).
    var byName = [];
    for (var j = 0; j < pts.length; j++) { if (nname(pts[j].name) === wantName && wantName) byName.push(pts[j]); }
    if (byName.length === 0) { out.status = 'no-record'; return out; }
    if (wantDob) {
      var dobMatch = [];
      for (var k = 0; k < byName.length; k++) { if (normDob(byName[k].dob) === wantDob) dobMatch.push(byName[k]); }
      if (dobMatch.length === 1) { out.patient = dobMatch[0]; out.status = 'name-dob-match'; return out; }
      if (dobMatch.length > 1) { out.status = 'ambiguous'; out.warnings.push('Two chart records share this name AND DOB — refusing to guess.'); return out; }
      // name matched but NO record has the scheduled DOB -> do NOT fall back to name-only.
      out.status = 'ambiguous';
      out.warnings.push('A record named "' + trim(appt.name) + '" exists but none matches the scheduled DOB (' + wantDob + ') — confirm identity before saving.');
      return out;
    }
    // No DOB on the schedule row: name-only. Safe ONLY if exactly one same-name record.
    if (byName.length === 1) { out.patient = byName[0]; out.status = 'name-only'; out.warnings.push('Matched by name only (no DOB on the schedule) — confirm this is the right ' + trim(appt.name) + '.'); return out; }
    out.status = 'ambiguous';
    out.warnings.push(byName.length + ' records named "' + trim(appt.name) + '" and no DOB to disambiguate — confirm identity before saving.');
    return out;
  }

  /* =========================================================================
   * (2)+(3) PROVIDER + FACILITY context (from the app's own settings getters).
   * ======================================================================= */
  function pick() { for (var i = 0; i < arguments.length; i++) { var f = arguments[i]; try { if (isFn(window[f])) { var v = trim(window[f]()); if (v) return v; } } catch (e) {} } return ''; }
  // provider name + credential, WITHOUT doubling if the stored name already
  // carries the credential (real data: getProviderName()="Jane Doe, MD",
  // getProviderCred()="MD" -> "Jane Doe, MD", not "Jane Doe, MD, MD").
  function providerDisplay(pf) {
    var name = trim(pf.provider), cred = trim(pf.cred);
    if (!name) return '';
    if (!cred) return name;
    var q = cred.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try { if (new RegExp('(^|[,\\s])' + q + '\\.?\\s*$', 'i').test(name)) return name; } catch (e) {}
    return name + ', ' + cred;
  }
  function providerFacilityCtx() {
    var ctx = {
      provider: pick('getProviderName', 'getName'),
      cred: pick('getProviderCred'),
      spec: pick('getSpec'),
      npi: pick('getNpi', 'getNPI'),
      license: pick('getLicense', 'getProviderLicense'),
      dea: pick('getDea', 'getDEA'),
      facility: pick('getPracticeName'),
      facilityAddress: pick('getClinicAddress'),
      facilityPhone: pick('getClinicPhone')
    };
    return ctx;
  }

  /* =========================================================================
   * (4) READINESS — the missing-information checklist for one prep row.
   * Draft is ALWAYS allowed (draft-only tool); this only WARNS.
   * Returns { ok, blockingSave, items:[{key,label,level,ok}] }.
   * level: 'error' (identity/safety) | 'warn' (should confirm) | 'ok'
   * ======================================================================= */
  function readiness(row) {
    var items = [], appt = (row && row.appt) || {}, pf = providerFacilityCtx();
    function add(key, label, ok, level) { items.push({ key: key, label: label, ok: !!ok, level: ok ? 'ok' : (level || 'warn') }); }

    // procedure date
    add('date', 'Procedure date', !!trim(row && row.dateStr), 'error');
    // patient identity
    var res = resolvePatient(appt);
    var idOk = (res.status === 'id-match' || res.status === 'name-dob-match');
    add('identity', 'Patient identity (ID/DOB verified)', idOk, 'error');
    // procedure text
    add('procedure', 'Procedure', !!trim(row && row.proc), 'error');
    // template
    var tplOk = false; try { tplOk = !!(row && row.tplId && isFn(window.getTemplateById) && window.getTemplateById(row.tplId)); } catch (e) {}
    add('template', 'Operative-note template', tplOk, 'error');
    // provider
    add('provider', 'Operating provider name', !!pf.provider, 'warn');
    add('npi', 'Provider NPI', !!pf.npi, 'warn');
    // facility
    add('facility', 'Facility / practice', !!pf.facility, 'warn');

    var ok = true, blockingSave = false;
    for (var i = 0; i < items.length; i++) {
      if (!items[i].ok) { ok = false; if (items[i].level === 'error') blockingSave = true; }
    }
    return { ok: ok, blockingSave: blockingSave, items: items, identity: res, provider: pf };
  }

  /* =========================================================================
   * (2) ENRICH the op-note context so _genOpNote states provider + facility +
   * identifiers. Called by the _genOpNote wrapper; also unit-tested directly.
   * ======================================================================= */
  function enrichCtx(name, baseCtx, appt) {
    var ctx = {}, k;
    if (baseCtx) for (k in baseCtx) { if (baseCtx.hasOwnProperty(k)) ctx[k] = baseCtx[k]; }
    var pf = providerFacilityCtx();
    // provider + identifiers -> the note MUST name the operating provider.
    if (pf.provider) ctx.provider = providerDisplay(pf);
    if (pf.spec) ctx.providerSpecialty = pf.spec;
    if (pf.npi) ctx.providerNpi = pf.npi;
    if (pf.license) ctx.providerLicense = pf.license;
    if (pf.dea) ctx.providerDea = pf.dea;
    // facility.
    var fac = pf.facility;
    // an appointment-level location, if the schedule row carried one, overrides.
    var loc = appt ? trim(appt.facility || appt.location || appt.department || appt.dept || '') : '';
    if (loc) fac = loc;
    if (fac) ctx.facility = fac;
    if (pf.facilityAddress) ctx.facilityAddress = pf.facilityAddress;
    return ctx;
  }

  /* =========================================================================
   * (2)(3) PROVIDER + FACILITY ATTESTATION BLOCK — the deterministic guarantee
   * that the DRAFTED op note actually STATES the operating provider, their
   * required identifiers, and the facility. The base _genOpNote never puts
   * these in the prompt, so we append a standard attestation footer after the
   * AI draft. Any identifier we don't have is emitted as a [[blank]] so the
   * app's existing guided blank-filler picks it up. Idempotent (sentinel).
   * ======================================================================= */
  var ATTEST_MARK = 'PROVIDER & FACILITY (MLS op-note prep)';
  function attestBlock(pf) {
    var L = [];
    L.push('---- ' + ATTEST_MARK + ' ----');
    L.push('Operating provider: ' + (pf.provider ? providerDisplay(pf) : '[[provider_name]]'));
    if (pf.spec) L.push('Specialty: ' + pf.spec);
    L.push('NPI: ' + (pf.npi || '[[provider_npi]]')
      + (pf.license ? ('   State license: ' + pf.license) : '')
      + (pf.dea ? ('   DEA: ' + pf.dea) : ''));
    L.push('Facility: ' + (pf.facility || '[[facility_name]]'));
    if (pf.facilityAddress) L.push(pf.facilityAddress);
    L.push('(DRAFT — not submitted to athenaOne. Review, edit, and sign in your EMR.)');
    return '\n\n' + L.join('\n') + '\n';
  }
  function ensureProviderFacilityBlock(note, pf) {
    note = S(note);
    if (note.indexOf(ATTEST_MARK) >= 0) return note; // already present (re-draft) — don't duplicate
    return note + attestBlock(pf);
  }

  /* =========================================================================
   * (5) SCHEDULING — next procedure day (weekend/empty-day aware) so "Sunday
   * prep for Monday" and "prep for Thursday" work off the ACTUAL schedule
   * rather than a blind "tomorrow". Scans forward from `fromKey`+1 up to `span`
   * days for the first day that has >=1 scheduled procedure appointment;
   * returns that YYYY-MM-DD, else fromKey+1 (so the empty-state still shows).
   * ======================================================================= */
  function dayKeyOf(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function parseKey(key) { var m = /(\d{4})-(\d{1,2})-(\d{1,2})/.exec(S(key)); if (!m) return null; return new Date(+m[1], (+m[2]) - 1, +m[3], 12, 0, 0); }
  // RAW appts for a day, filtered + ordered EXACTLY like the base _opApptsForDay
  // (day match + non-empty resulting name), so they line up 1:1 with the prep rows.
  function rawApptsForKey(key) {
    var all = (window._calAppts || []) || [], out = [];
    for (var i = 0; i < all.length; i++) {
      var a = all[i]; var dk = S(a.appt_date || S(a.start_at || '').slice(0, 10));
      if (dk !== key) continue;
      var nm = trim(a.name || (isFn(window._calLabelOf) ? window._calLabelOf(a) : ''));
      if (nm) out.push(a);
    }
    return out;
  }
  function apptsForKey(key) {
    try {
      if (isFn(window._opApptsForDay) && !window._opApptsForDay.__opnpWrapped) return window._opApptsForDay(key) || [];
      return rawApptsForKey(key);
    } catch (e) { return []; }
  }
  function nextProcedureDay(fromKey, span) {
    span = span || 10;
    var base = parseKey(fromKey) || new Date();
    for (var i = 1; i <= span; i++) {
      var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, 12, 0, 0);
      var key = dayKeyOf(d);
      if (apptsForKey(key).length) return key;
    }
    var t = new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, 12, 0, 0);
    return dayKeyOf(t);
  }
  // "This/next Monday" and "This/next Thursday" from a reference date (default today).
  function nextWeekday(targetDow, fromDate) {
    var base = fromDate || new Date();
    for (var i = 1; i <= 7; i++) { var d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + i, 12, 0, 0); if (d.getDay() === targetDow) return dayKeyOf(d); }
    return dayKeyOf(base);
  }

  /* =========================================================================
   * WRAPPERS (all idempotent; each keeps a handle to the original for revert).
   * ======================================================================= */
  var wrapped = {};
  function wrap(name, factory) {
    var orig = window[name];
    if (!isFn(orig) || (orig.__opnpWrapped)) return;
    var w = factory(orig);
    w.__opnpWrapped = true; w.__opnpOrig = orig;
    window[name] = w; wrapped[name] = orig;
  }

  function ensureWrapped() {
    // (A) carry ID + location onto each schedule row's appt — POSITIONALLY.
    // The base _opApptsForDay maps the day's raw appts 1:1 in order (dropping
    // only nameless ones), so we zip by INDEX against the same-filtered raw list
    // rather than re-matching by name (two same-name patients must NOT share an
    // ID — that was the identity-collision bug).
    wrap('_opApptsForDay', function (orig) {
      return function (key) {
        var rows = orig.apply(this, arguments) || [];
        try {
          var raw = rawApptsForKey(key);
          if (raw.length === rows.length) {
            for (var i = 0; i < rows.length; i++) {
              rows[i].athenaId = S(raw[i].patient_external_id || raw[i].athenaId || raw[i].mrn || '');
              rows[i].location = S(raw[i].location || raw[i].department || raw[i].dept || raw[i].facility || '');
            }
          }
        } catch (e) {}
        return rows;
      };
    });

    // dob passthrough only (NO name-based id guess — id is carried positionally
    // via the openOpPrep wrapper, which knows the row order).
    wrap('_opNewRow', function (orig) {
      return function (name, reason, dob, dateStr) {
        var row = orig.apply(this, arguments);
        try { if (row && row.appt) row.appt.dob = row.appt.dob || S(dob || ''); } catch (e) {}
        return row;
      };
    });

    // (1) identity-safe patient ctx + (2)(3) provider/facility enrichment.
    wrap('_opPatientCtx', function (orig) {
      return function (name) {
        // Resolve the patient safely from the current prep row's appt when possible.
        // IDENTITY-SAFE for SAME-NAME patients: prefer the EXACT row being drafted
        // (window.__opnpActiveIdx, pinned by the opPrepGenerateOne wrap below) so two
        // patients who share a name never get each other's DOB/MRN in the note body.
        // A bare first-name-match is only a last resort for non-drafting/display calls.
        var appt = null;
        try {
          var rows = window._opPrep || [];
          var ai = window.__opnpActiveIdx;
          if (ai != null && rows[ai] && rows[ai].appt && nname(rows[ai].appt.name) === nname(name)) appt = rows[ai].appt;
          if (!appt) { for (var i = 0; i < rows.length; i++) { if (rows[i] && rows[i].appt && nname(rows[i].appt.name) === nname(name)) { appt = rows[i].appt; break; } } }
        } catch (e) {}
        var base;
        var res = resolvePatient(appt || { name: name });
        if (res.patient) {
          var p = res.patient;
          base = { dob: S(p.dob || ''), sex: S(p.sex || p.gender || ''), age: (isFn(window._ptAge) ? window._ptAge(p.dob) : null), bmi: (isFn(window._ptBmi) ? window._ptBmi(p) : null), mrn: S(p.mrn || p.athenaId || '') };
        } else {
          // fall back to the original (name-based) ONLY for demographics display; identity
          // status is recorded so the save path can still refuse an unsafe write.
          try { base = orig.apply(this, arguments) || {}; } catch (e2) { base = {}; }
        }
        base._idStatus = res.status; base._idWarnings = res.warnings; base._resolvedId = res.patient ? ptId(res.patient) : '';
        return enrichCtx(name, base, appt);
      };
    });

    // Pin the EXACT row being drafted so _opPatientCtx (above) resolves same-name
    // patients by the right row (not the first name-match). draftAll calls
    // opPrepGenerateOne(idx) sequentially, so a single active index is race-free.
    // Cleared when the draft settles so stray display-time ctx calls fall back safely.
    wrap('opPrepGenerateOne', function (orig) {
      return function (idx) {
        try { window.__opnpActiveIdx = idx; } catch (e) {}
        var clear = function () { try { if (window.__opnpActiveIdx === idx) window.__opnpActiveIdx = null; } catch (e) {} };
        var r;
        try { r = orig.apply(this, arguments); } catch (e) { clear(); throw e; }
        try { if (r && isFn(r.then)) { r.then(clear, clear); } else { clear(); } } catch (e2) { clear(); }
        return r;
      };
    });

    // (2)(3) _genOpNote — after the AI draft, GUARANTEE a provider+facility
    // attestation block (with [[blanks]] for any missing identifier). The base
    // _genOpNote ignores provider/facility ctx fields, so this is what actually
    // makes the drafted note state the correct provider/identifiers/facility.
    wrap('_genOpNote', function (orig) {
      return function (name, dateStr, procedure, tplText, ctx) {
        var enriched = enrichCtx(name, ctx || {}, null);
        var pf = providerFacilityCtx();
        var p;
        try { p = orig.call(this, name, dateStr, procedure, tplText, enriched); } catch (e) { p = null; }
        if (!p || typeof p.then !== 'function') {
          var res0 = p || { note: '', missing: [] };
          try { res0.note = ensureProviderFacilityBlock(res0.note, pf); } catch (e2) {}
          return res0;
        }
        return p.then(function (res) {
          res = res || { note: '', missing: [] };
          try { res.note = ensureProviderFacilityBlock(res.note, pf); } catch (e3) {}
          return res;
        });
      };
    });

    // (4) fix single-patient date bug: use the SCHEDULED procedure date.
    wrap('openOpPrepForPatient', function (orig) {
      return function (pid) {
        var r = orig.apply(this, arguments);
        try {
          var rows = window._opPrep || [];
          if (rows.length === 1 && rows[0] && rows[0].appt) {
            var nm = rows[0].appt.name, best = null;
            var all = (window._calAppts || []) || [];
            var todayKey = dayKeyOf(new Date());
            for (var j = 0; j < all.length; j++) {
              var a = all[j];
              if (nname(a.name) !== nname(nm)) continue;
              var dk = S(a.appt_date || S(a.start_at || '').slice(0, 10));
              if (dk >= todayKey && (!best || dk < best)) best = dk;   // soonest UPCOMING procedure day
            }
            if (best) {
              var dstr = isFn(window._opDayStr) ? window._opDayStr(best) : best;
              rows[0].dateStr = dstr; rows[0].appt.dob = rows[0].appt.dob || '';
              if (isFn(window.opPrepRender)) window.opPrepRender();
            }
          }
        } catch (e) {}
        return r;
      };
    });

    // (5) procedure-day-aware default for the ALL-patients prep +
    // (A) POSITIONAL id/location carry onto each built row's appt.
    wrap('openOpPrep', function (orig) {
      return function (dayKey) {
        if (!dayKey) {
          try { dayKey = nextProcedureDay(dayKeyOf(new Date())); } catch (e) {}
        }
        var r = orig.call(this, dayKey);
        try {
          var raw = rawApptsForKey(dayKey), rows = window._opPrep || [];
          if (raw.length === rows.length) {
            for (var i = 0; i < rows.length; i++) {
              if (!rows[i] || !rows[i].appt) continue;
              rows[i].appt.athenaId = S(raw[i].patient_external_id || raw[i].athenaId || raw[i].mrn || '');
              rows[i].appt.location = S(raw[i].location || raw[i].department || raw[i].dept || raw[i].facility || '');
              rows[i].appt.dob = rows[i].appt.dob || S(raw[i].dob || '');
            }
            if (isFn(window.opPrepRender)) window.opPrepRender();
          }
        } catch (e) {}
        return r;
      };
    });

    // (1)+(7) SAFE, draft-only save: refuse an ambiguous-identity write; tag draft.
    wrap('opPrepSave', function (orig) {
      return function (i) {
        try {
          var row = (window._opPrep || [])[i];
          if (row && row.appt) {
            var res = resolvePatient(row.appt);
            if (res.status === 'ambiguous') {
              var msg = document.getElementById('opPrepMsg_' + i);
              if (msg) { msg.style.color = '#b4231e'; msg.innerHTML = '⛔ Not saved — ' + esc(res.warnings[0] || 'patient identity could not be confirmed') + ' Open the patient in the Patients tab to confirm, then save.'; }
              try { if (isFn(window.toast)) window.toast('Identity not confirmed — draft NOT saved to a chart.', 'err'); } catch (e0) {}
              STATE.refusedSaves++;
              return;   // hard stop: never write to a guessed chart.
            }
          }
        } catch (e) {}
        var r = orig.apply(this, arguments);
        // tag the just-saved note as an explicit, never-submitted draft.
        try {
          var row2 = (window._opPrep || [])[i];
          if (row2 && row2._noteId && isFn(window.getNotes) && isFn(window.saveNotes)) {
            var ns = window.getNotes(), n = null;
            for (var q = 0; q < ns.length; q++) { if (ns[q].id === row2._noteId) { n = ns[q]; break; } }
            if (n) {
              n.opnpDraft = true; n.submittedToAthena = false; n.kind = n.kind || 'opnote';
              var pf = providerFacilityCtx();
              n.opnpMeta = { provider: pf.provider, npi: pf.npi, facility: pf.facility, dateStr: S(row2.dateStr || ''), procedure: S(row2.proc || '') };
              window.saveNotes(ns);
            }
          }
          STATE.savedDrafts++;
        } catch (e) {}
        return r;
      };
    });

    // (4) missing-info warnings — decorate the rendered modal (add-only, id-based).
    wrap('opPrepRender', function (orig) {
      return function () {
        var r = orig.apply(this, arguments);
        try { decorateWarnings(); } catch (e) {}
        return r;
      };
    });
  }

  /* ---- missing-info + scheduling UI decoration (add-only; never rewrites rows) ---- */
  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      '.mls-opnp-warn{margin:8px 0 2px;border:1px solid #f0d79a;background:#fff7e6;border-radius:9px;padding:9px 12px;font-size:12px;line-height:1.5}',
      '.mls-opnp-warn.err{border-color:#e6b4b0;background:#fdecea}',
      '.mls-opnp-warn b{font-size:12px}',
      '.mls-opnp-chk{display:inline-block;margin:2px 8px 2px 0;white-space:nowrap}',
      '.mls-opnp-chk .ok{color:#16924e}.mls-opnp-chk .bad{color:#b4231e}.mls-opnp-chk .warn{color:#9a7b2a}',
      '.mls-opnp-days{display:flex;gap:6px;flex-wrap:wrap;margin:2px 0 4px}',
      '.mls-opnp-days button{font-size:11.5px;padding:5px 10px;border:1px solid var(--line,#d8dee9);border-radius:8px;background:var(--card,#fff);color:inherit;cursor:pointer}',
      '.mls-opnp-days button:hover{background:var(--hover,#eef4fc)}'
    ].join('');
    var s = document.createElement('style'); s.id = STYLE_ID; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }
  function chk(it) {
    var sym = it.ok ? '✓' : (it.level === 'error' ? '✗' : '⚠');
    var cls = it.ok ? 'ok' : (it.level === 'error' ? 'bad' : 'warn');
    return '<span class="mls-opnp-chk"><span class="' + cls + '">' + sym + '</span> ' + esc(it.label) + '</span>';
  }
  function decorateWarnings() {
    injectCss();
    var rows = window._opPrep || [];
    // per-row readiness strip, inserted right under each row's live preview.
    for (var i = 0; i < rows.length; i++) {
      var prev = document.getElementById('opPrepPrev_' + i); if (!prev) continue;
      var host = prev.parentNode; if (!host) continue;
      var old = document.getElementById('mlsOpnpWarn_' + i); if (old && old.parentNode) old.parentNode.removeChild(old);
      var rd = readiness(rows[i]);
      var strip = document.createElement('div');
      strip.id = 'mlsOpnpWarn_' + i;
      strip.className = 'mls-opnp-warn' + (rd.blockingSave ? ' err' : '');
      var head = rd.ok ? '✓ Ready to draft — all essentials present.'
        : (rd.blockingSave ? '⚠ Missing information — you can still draft, but confirm these before saving to a chart:'
          : 'ℹ Confirm before signing:');
      var body = '<b>' + head + '</b><div style="margin-top:5px">';
      for (var j = 0; j < rd.items.length; j++) body += chk(rd.items[j]);
      body += '</div>';
      // identity detail (the safety line)
      if (rd.identity && rd.identity.warnings && rd.identity.warnings.length) {
        body += '<div style="margin-top:5px;color:#b4231e;font-size:11.5px">🔒 ' + esc(rd.identity.warnings[0]) + '</div>';
      } else if (rd.identity && (rd.identity.status === 'id-match' || rd.identity.status === 'name-dob-match')) {
        body += '<div style="margin-top:5px;color:#16924e;font-size:11.5px">🔒 Identity confirmed (' + (rd.identity.status === 'id-match' ? 'by athena ID' : 'by name + DOB') + ').</div>';
      }
      strip.innerHTML = body;
      host.insertBefore(strip, prev.nextSibling);
    }
    // scheduling quick-buttons on the ALL-patients day row.
    try {
      if (window._opPrepMode !== 'patient') {
        var dr = document.getElementById('opPrepDayRow') || document.getElementById('opPrepList');
        if (dr && !document.getElementById('mlsOpnpDays')) {
          var bar = document.createElement('div'); bar.id = 'mlsOpnpDays'; bar.className = 'mls-opnp-days';
          bar.innerHTML =
            '<button onclick="__mlsOpNotePrep.gotoNextProcedureDay()" title="Next day that has scheduled procedures">📅 Next procedure day</button>' +
            '<button onclick="__mlsOpNotePrep.gotoWeekday(1)" title="Prep the coming Monday (Sunday → Monday procedures)">Mon</button>' +
            '<button onclick="__mlsOpNotePrep.gotoWeekday(4)" title="Prep the coming Thursday">Thu</button>';
          if (dr.id === 'opPrepDayRow') dr.appendChild(bar); else dr.parentNode.insertBefore(bar, dr);
        }
      }
    } catch (e) {}
  }

  function gotoDay(key) { try { if (isFn(window.openOpPrep)) window.openOpPrep(key); } catch (e) {} }

  /* ------------------------------ self-test ------------------------------ *
   * Side-effect-free: snapshots EVERY global it stubs and restores them in a
   * finally block, so running it against the LIVE app never clobbers a real
   * function (e.g. _opApptsForDay / getTemplateById). */
  function selfTest() {
    var fails = [], t = 0;
    function ok(cond, label) { t++; if (!cond) fails.push(label); }
    var g = {}, gi;
    var gk = ['getProviderName', 'getProviderCred', 'getSpec', 'getNpi', 'getPracticeName',
              'getClinicAddress', 'getPatients', '_calAppts', 'getTemplateById', '_opApptsForDay'];
    for (gi = 0; gi < gk.length; gi++) { g[gk[gi]] = window[gk[gi]]; }
    try {
      window.getProviderName = function () { return 'Jane Vresilovic'; };
      window.getProviderCred = function () { return 'MD'; };
      window.getSpec = function () { return 'PM&R'; };
      window.getNpi = function () { return '1234567890'; };
      window.getPracticeName = function () { return 'POSM ASC West Chester'; };
      window.getClinicAddress = function () { return '600 E Marshall St'; };

      var mockPts = [
        { id: 'p1', athenaId: '7001', mrn: '7001', name: 'John Smith', dob: '03/24/1980' },
        { id: 'p2', athenaId: '7002', mrn: '7002', name: 'John Smith', dob: '11/02/1955' },
        { id: 'p3', athenaId: '7003', mrn: '7003', name: 'Mary Sue Boyle', dob: '10/20/1953' }
      ];
      window.getPatients = function () { return mockPts; };

      // (1) identity by ID
      var r1 = resolvePatient({ name: 'John Smith', dob: '03/24/1980', athenaId: '7001' });
      ok(r1.status === 'id-match' && r1.patient && r1.patient.id === 'p1', 'T1 id-match');
      // (1) two same-name, DOB disambiguates
      var r2 = resolvePatient({ name: 'John Smith', dob: '11/02/1955' });
      ok(r2.status === 'name-dob-match' && r2.patient.id === 'p2', 'T2 name+dob disambiguates same-name');
      // (1) same-name, NO dob -> ambiguous (safety stop), NOT a guess
      var r3 = resolvePatient({ name: 'John Smith' });
      ok(r3.status === 'ambiguous' && !r3.patient, 'T3 same-name no-dob -> ambiguous stop');
      // (1) name matches but DOB conflicts -> ambiguous, no name-only fallback
      var r4 = resolvePatient({ name: 'John Smith', dob: '01/01/2000' });
      ok(r4.status === 'ambiguous' && !r4.patient, 'T4 name match, dob conflict -> ambiguous');
      // (1) unique name, no dob -> name-only (allowed, warned)
      var r5 = resolvePatient({ name: 'Mary Sue Boyle' });
      ok(r5.status === 'name-only' && r5.patient.id === 'p3', 'T5 unique name-only allowed+warned');
      // (1) unknown -> no-record
      var r6 = resolvePatient({ name: 'Nobody Here', dob: '01/01/1970' });
      ok(r6.status === 'no-record' && !r6.patient, 'T6 unknown -> no-record');

      // (2)(3) provider/facility enrichment
      var e = enrichCtx('John Smith', { dob: '03/24/1980' }, null);
      ok(e.provider === 'Jane Vresilovic, MD', 'T7 provider name+cred in ctx');
      ok(e.providerNpi === '1234567890', 'T8 NPI in ctx');
      ok(e.facility === 'POSM ASC West Chester', 'T9 facility in ctx');
      ok(e.dob === '03/24/1980', 'T9b base ctx preserved');
      // appt location overrides facility
      var e2 = enrichCtx('John Smith', {}, { location: 'Main OR Suite 3' });
      ok(e2.facility === 'Main OR Suite 3', 'T10 appt location overrides facility');

      // (4) readiness — full green
      var rowFull = { dateStr: 'Monday, July 13, 2026', proc: 'Left L5-S1 TFESI', tplId: 'tpl1', appt: { name: 'John Smith', dob: '03/24/1980', athenaId: '7001' } };
      window.getTemplateById = function (id) { return id === 'tpl1' ? { id: 'tpl1', name: 'ESI', text: 'x' } : null; };
      var rdA = readiness(rowFull);
      ok(rdA.ok === true && rdA.blockingSave === false, 'T11 full row ready');
      // (4) readiness — missing procedure + ambiguous identity => blockingSave
      var rowBad = { dateStr: 'Monday', proc: '', tplId: '', appt: { name: 'John Smith' } };
      var rdB = readiness(rowBad);
      ok(rdB.blockingSave === true, 'T12 missing essentials block save');
      var identItem = null, procItem = null;
      for (var z = 0; z < rdB.items.length; z++) { if (rdB.items[z].key === 'identity') identItem = rdB.items[z]; if (rdB.items[z].key === 'procedure') procItem = rdB.items[z]; }
      ok(identItem && !identItem.ok && identItem.level === 'error', 'T13 identity flagged error');
      ok(procItem && !procItem.ok, 'T14 procedure flagged');

      // (5) scheduling — next procedure day skips empty days
      // schedule: procedures on 2026-07-13 (Mon) and 2026-07-16 (Thu); none 07-11..12,14..15
      window._calAppts = [
        { name: 'John Smith', appt_date: '2026-07-13', reason: 'L5-S1 TFESI', dob: '03/24/1980', patient_external_id: '7001' },
        { name: 'Mary Sue Boyle', appt_date: '2026-07-16', reason: 'RFA', dob: '10/20/1953', patient_external_id: '7003' }
      ];
      window._opApptsForDay = null; // force the internal apptsForKey fallback
      var nd = nextProcedureDay('2026-07-10'); // Fri -> next procedure day = Mon 13th (skips Sat/Sun empty)
      ok(nd === '2026-07-13', 'T15 next procedure day = 2026-07-13 (got ' + nd + ')');
      var nd2 = nextProcedureDay('2026-07-13'); // Mon -> next = Thu 16th
      ok(nd2 === '2026-07-16', 'T16 next procedure day after Mon = Thu 16 (got ' + nd2 + ')');
      // empty schedule -> falls back to +1 (empty-state), never throws
      window._calAppts = [];
      var nd3 = nextProcedureDay('2026-07-10');
      ok(nd3 === '2026-07-11', 'T17 empty schedule -> tomorrow fallback');
    } catch (ex) { fails.push('EXCEPTION: ' + (ex && ex.message || ex)); }
    finally { for (var kk in g) { if (g.hasOwnProperty(kk)) window[kk] = g[kk]; } } // restore EVERY stubbed global
    return { pass: !fails.length, total: t, fails: fails };
  }

  /* ------------------------------- public -------------------------------- */
  var STATE = { refusedSaves: 0, savedDrafts: 0 };
  var ensureIv = null, ticks = 0;

  function revert() {
    try {
      var k;
      for (k in wrapped) {
        if (wrapped.hasOwnProperty(k)) { try { if (window[k] && window[k].__opnpWrapped) window[k] = wrapped[k]; } catch (e) {} }
      }
    } catch (e) {}
    try { clearInterval(ensureIv); } catch (e) {}
    try { var s = document.getElementById(STYLE_ID); if (s) s.parentNode.removeChild(s); } catch (e) {}
    try {
      var d = document.getElementById('mlsOpnpDays'); if (d && d.parentNode) d.parentNode.removeChild(d);
      var ws = document.querySelectorAll('[id^="mlsOpnpWarn_"]');
      for (var i = 0; i < ws.length; i++) { if (ws[i].parentNode) ws[i].parentNode.removeChild(ws[i]); }
    } catch (e) {}
    window.__mlsOpNotePrep.installed = false;
  }

  window.__mlsOpNotePrep = {
    installed: true, version: VERSION, state: STATE,
    // pure API (unit-tested)
    resolvePatient: resolvePatient, providerFacilityCtx: providerFacilityCtx,
    readiness: readiness, enrichCtx: enrichCtx,
    ensureProviderFacilityBlock: ensureProviderFacilityBlock, attestBlock: attestBlock,
    nextProcedureDay: nextProcedureDay, nextWeekday: nextWeekday,
    rawApptsForKey: rawApptsForKey,
    selfTest: selfTest, revert: revert,
    // UI helpers referenced by the injected buttons
    gotoNextProcedureDay: function () { gotoDay(nextProcedureDay(dayKeyOf(new Date()))); },
    gotoWeekday: function (dow) { gotoDay(nextWeekday(dow)); },
    decorate: decorateWarnings
  };

  // boot: wrap now + heartbeat for load-order safety (base fns come from ScribeFlow.html).
  ensureWrapped();
  ensureIv = setInterval(function () { ensureWrapped(); if (++ticks > 40) clearInterval(ensureIv); }, 500);
})();
