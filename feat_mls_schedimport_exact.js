/* feat_mls_schedimport_exact.js  ->  window.__mlsSI  (schedule -> calendar import, corrected)
 *
 *  STAGING-FIRST, then prod via the data: staging marker. Additive, reversible, ASCII-only,
 *  idempotent. Loaded by mls-connect.staging.js (and mls-connect.js) AFTER the core app and
 *  the patient picker / assistant modules.
 *
 *  WHY THIS EXISTS
 *  ---------------
 *  The Athena schedule pull reads the day's appointments but they were not landing on the
 *  calendar (_calAppts), so Today's patients was empty, the op-note drafter found 0 procedures,
 *  and any-day picking showed nothing. Root causes confirmed by reading the LIVE code + a
 *  read-only check of the signed-in athenaOne tab:
 *    1) The app's _importPulledSchedule(appts) puts up a BLOCKING window.confirm whenever many
 *       appointments would land on one day ("Import all N anyway?"). Clicking Cancel returns
 *       with ZERO appointments imported -- but _pullAllHistories still runs afterward, so chart
 *       histories save while NO appointments are added (the exact reported symptom).
 *    2) When the AI parse returns appointments with no explicit per-appt date, the original
 *       filed them on _nextClinicDay() (which can skip to Monday) instead of the day actually
 *       being pulled, so "today" stayed empty.
 *    3) start_at (EST -> UTC) was only computed for bare "HH:MM" times; "12:27 PM"-style times
 *       from the DOM scrape were dropped, leaving appts time-less.
 *
 *  WHAT THIS DOES (no fabrication; only the app's OWN data + helpers)
 *  -----------------------------------------------------------------
 *  - Replaces window._importPulledSchedule with a faithful, corrected version that:
 *      * NEVER blocks on a confirm (non-blocking; a heavy-day note is shown, not a modal).
 *      * Files EACH appointment on its OWN real date when the parse provides one, else on the
 *        TARGET day (an explicit chosen day or the proven day printed on the page).
 *      * Normalizes times robustly (handles "12:27 PM" and "14:30") and stores start_at as the
 *        correct UTC for the account TZ (America/New_York / EST by default).
 *      * Falls back to the extension's STRUCTURED DOM scrape (li.filled-appointment-row ->
 *        {time,name,provider}) when the AI text parse returns nothing.
 *      * Dedupes by exact appointment id, or by a DOB/MRN-proven patient + day + time +
 *        provider identity. Display names alone never collapse or bind schedule rows.
 *      * Refreshes the calendar, Today's patients (hero), the picker and the assistant after.
 *      * Is HONEST: if nothing real is found it says so (no silent fallback to a synthetic day).
 *  - Exposes __mlsSI.pull({date, provider, onStatus}) for day-scoped pulls (Today / Tomorrow /
 *    any date): it reads the signed-in athenaOne tab read-only, then imports onto that date.
 *  - Captures the latest schedule read (read-only, in-memory) so the DOM-scrape fallback works.
 *
 *  Reversible: window.__mlsSI.revert() restores the previous _importPulledSchedule.
 */
;(function () {
  if (window.__mlsSI && window.__mlsSI.installed) return;

  var VERSION = "si-1.5.1";
  var EST_TZ = "America/New_York";
  var IMPORT_INDEX_SUFFIX = "schedImportIndexV1";
  var IMPORT_DAYS_SUFFIX = "schedImportDaysV1";
  var PENDING_TTL = 5 * 60 * 1000;
  var inFlight = {};
  var knownDays = {};
  var historyBatchRunning = false;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function gfn(n) { return safe(function () { return isFn(window[n]) ? window[n] : null; }, null); }
  function callG(n, a, b, c) { var f = gfn(n); return f ? safe(function () { return f(a, b, c); }) : undefined; }

  /* ---- staging/prod gate: active on the staging page OR on prod via the data: marker ---- */
  function gateOn() {
    return safe(function () {
      if (/ScribeFlow-staging\.html/i.test(location.pathname)) return true;
      var s = document.querySelectorAll('script[src]');
      for (var i = 0; i < s.length; i++) { if (/data:,mls-connect\.staging\.js/.test(s[i].getAttribute("src") || "")) return true; }
      return false;
    }, false);
  }

  /* ---- dates / times (EST) ---- */
  function estTodayKey() {
    return safe(function () {
      return new Intl.DateTimeFormat("en-CA", { timeZone: EST_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    }, new Date().toISOString().slice(0, 10));
  }
  function normDate(d) { var f = gfn("_normDate"); return f ? (f(d) || "") : String(d || "").slice(0, 10); }
  function normTime(t) { var f = gfn("_normTime"); return f ? (f(t) || "") : ""; }
  function apptKey(n, d, t) { var f = gfn("_apptKey"); return f ? f(n, d, t) : (String(n || "").trim().toLowerCase().replace(/\s+/g, " ") + "|" + d + "|" + normTime(t)); }
  function wallToUtc(d, hhmm) { var f = gfn("_acctWallToUtcIso"); return f ? safe(function () { return f(d, hhmm); }, null) : null; }
  function detectSchedDate(text) { var f = gfn("_detectSchedDate"); return f ? (f(text) || "") : ""; }

  /* ---- backend ---- */
  function bkBase() { return callG("bkBase") || "https://scrivara-backend.onrender.com"; }
  function bkToken() { return callG("bkToken") || ""; }
  function signedIn() { return safe(function () { return isFn(window.backendMode) && window.backendMode() && !!bkToken(); }, false); }
  function toast(m, k) { var f = gfn("toast"); if (f) safe(function () { f(m, k); }); }

  /* ---- account-local import identity / idempotency index ----
   * The backend appointment API has no idempotency key. Keep a tiny index in
   * the SAME account namespace as the patient store so a repeated/stale GET
   * cannot cause the same schedule row to be POSTed twice from this browser.
   * Patient identity prefers exact local/Athena ids, then MRN, then name+DOB;
   * appointment identity prefers Athena's appointment id and otherwise adds the
   * authoritative day, time, and provider identity. */
  function normName(s) { return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
  /* Provider identity is deliberately stricter than patient-name display
     matching. Athena can render "Schaeffer_Matthew_MD", "Matthew Schaeffer,
     MD", or "Schaeffer, Matthew" for the same clinician. Ignore credentials
     and order, but require the same complete set of name tokens. A surname or
     first-token match is never sufficient (two clinicians can share either). */
  var PROVIDER_NOISE = {
    dr: 1, doctor: 1, md: 1, do: 1, np: 1, pa: 1, c: 1, pac: 1,
    aprn: 1, fnp: 1, fnpc: 1, dnp: 1, rn: 1, crnp: 1, cnp: 1,
    dpm: 1, dds: 1, dmd: 1, phd: 1, mbbs: 1, od: 1
  };
  function providerKey(raw) {
    var s = String(raw == null ? "" : raw).trim().toLowerCase();
    if (!s || /^all(?:\s+providers?)?$/.test(s)) return "";
    s = safe(function () { return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); }, s);
    var seen = {}, tokens = s.replace(/[_/]+/g, " ").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(function (t) {
      if (!t || PROVIDER_NOISE[t] || seen[t]) return false;
      seen[t] = 1; return true;
    });
    if (tokens.length < 2) return "";
    tokens.sort();
    return tokens.join("|");
  }
  function providerRequest(raw) {
    var obj = raw && typeof raw === "object" ? raw : null;
    var name = String(obj ? (obj.name || obj.displayName || obj.provider || "") : (raw || "")).trim();
    var id = obj && obj.id != null ? String(obj.id) : "";
    var rosterVerified = !!(obj && obj.rosterVerified === true && id);
    if (!name || /^all(?:\s+providers?)?$/i.test(name)) return { mode: "all", name: name || "All providers", id: id, key: "", rosterVerified: rosterVerified };
    return { mode: "selected", name: name, id: id, key: providerKey(name), rosterVerified: rosterVerified };
  }
  function providerDiagLabels(resp, rows) {
    var labels = [], seen = {};
    function add(v) {
      v = String(v || "").trim(); var k = providerKey(v);
      if (!v || !k || seen[v.toLowerCase()]) return;
      seen[v.toLowerCase()] = 1; labels.push(v);
    }
    safe(function () { (resp && resp.providers || []).forEach(add); });
    safe(function () { (resp && resp.providerDiag && resp.providerDiag.providerNames || []).forEach(add); });
    safe(function () { add(resp && resp.providerDiag && resp.providerDiag.providerFillScope); });
    safe(function () { add(resp && resp.providerDiag && resp.providerDiag.dom && resp.providerDiag.dom.singleProviderName); });
    safe(function () { add(resp && resp.providerDiag && resp.providerDiag.text && resp.providerDiag.text.singleProviderName); });
    (rows || []).forEach(function (r) { add(r && r.provider); });
    return labels;
  }
  function scopeProviderRows(rows, rawProvider, resp) {
    rows = Array.isArray(rows) ? rows.slice() : [];
    resp = resp || null;
    var req = providerRequest(rawProvider);
    var receipt = {
      mode: req.mode,
      requested: req.name,
      requestedId: req.id,
      requestedKey: req.key,
      rosterVerified: req.rosterVerified,
      complete: false,
      reason: "",
      scheduleComplete: !!(resp && resp.receipt && resp.receipt.complete === true),
      sourceRows: rows.length,
      providerTaggedRows: 0,
      matchingRows: 0,
      mismatchedRows: 0,
      unattributedRows: 0,
      discoveredProviders: providerDiagLabels(resp, rows)
    };
    if (req.mode === "all") {
      receipt.complete = true; receipt.reason = "all-providers";
      receipt.providerTaggedRows = rows.filter(function (r) { return !!providerKey(r && r.provider); }).length;
      receipt.unattributedRows = rows.length - receipt.providerTaggedRows;
      return { complete: true, reason: "all-providers", rows: rows, receipt: receipt };
    }
    if (!req.key || !receipt.scheduleComplete) {
      receipt.reason = "provider-unverified";
      return { complete: false, reason: receipt.reason, rows: [], receipt: receipt };
    }
    var matching = [];
    rows.forEach(function (r) {
      var k = providerKey(r && r.provider);
      if (!k) { receipt.unattributedRows++; return; }
      receipt.providerTaggedRows++;
      if (k === req.key) matching.push(r); else receipt.mismatchedRows++;
    });
    receipt.matchingRows = matching.length;
    var targetSeen = matching.length > 0 || req.rosterVerified || receipt.discoveredProviders.some(function (p) { return providerKey(p) === req.key; });
    if (receipt.unattributedRows > 0) receipt.reason = "provider-incomplete";
    else if (!targetSeen) receipt.reason = "provider-not-found";
    else {
      receipt.complete = true;
      receipt.reason = matching.length ? "provider-complete" : "provider-empty";
    }
    return { complete: receipt.complete, reason: receipt.reason, rows: receipt.complete ? matching : [], receipt: receipt };
  }
  function normDob(s) {
    s = String(s || "").trim(); if (!s) return "";
    var m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
    if (m) {
      var yy = m[3];
      if (yy.length === 2) yy = (Number(yy) <= Number(String(new Date().getFullYear()).slice(-2)) ? "20" : "19") + yy;
      return yy + ("0" + m[1]).slice(-2) + ("0" + m[2]).slice(-2);
    }
    var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if (iso) return iso[1] + ("0" + iso[2]).slice(-2) + ("0" + iso[3]).slice(-2);
    return s.toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  function normMrn(s) { return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function firstField(a, fields) {
    a = a || {};
    for (var i = 0; i < fields.length; i++) {
      var v = a[fields[i]];
      if (v != null && String(v).trim()) return String(v).trim();
    }
    return "";
  }
  function rowMrn(a) { return normMrn(a && (a.mrn || a.athenaId || a.athena_id)); }
  function rowLocalPatientId(a) { return firstField(a, ["patient_external_id", "_mlsTargetPatientId"]); }
  function rowSourcePatientId(a) { return firstField(a, ["athenaPatientId", "athena_patient_id", "patientId", "patient_id", "chartId", "chart_id"]); }
  function rowAppointmentId(a) { return firstField(a, ["athenaAppointmentId", "athena_appointment_id", "appointmentId", "appointment_id", "apptId", "appt_id", "encounterId", "encounter_id"]); }
  function rowProviderId(a) { return firstField(a, ["athenaProviderId", "athena_provider_id", "providerId", "provider_id", "renderingProviderId", "rendering_provider_id"]); }
  function sourceProof(a) {
    return { dob: normDob(a && a.dob), mrn: rowMrn(a) };
  }
  function patientIdentity(a, allowBoundLocal) {
    var proof = sourceProof(a), localId = rowLocalPatientId(a);
    /* A backend appointment already bound to one immutable local patient may
       use that binding while we reconcile a re-pull. A new schedule row still
       needs its own DOB/MRN proof before it can bind to that local id. */
    if (localId && (allowBoundLocal === true || proof.dob || proof.mrn)) return "local:" + localId;
    if (!proof.dob && !proof.mrn) return "";
    var sourceId = rowSourcePatientId(a);
    if (sourceId) return "athena-patient:" + sourceId.toLowerCase();
    if (proof.mrn) return "mrn:" + proof.mrn;
    var name = normName(a && a.name);
    return name && proof.dob ? ("nd:" + name + "|" + proof.dob) : "";
  }
  function providerIdentity(a) {
    var id = rowProviderId(a); if (id) return "provider-id:" + id.toLowerCase();
    var key = providerKey(a && a.provider); return key ? ("provider-name:" + key) : "provider-unattributed";
  }
  function appointmentSlotIdentity(a, date, time, allowBoundLocal) {
    var patientKey = patientIdentity(a, allowBoundLocal === true);
    var nt = normTime(time != null ? time : (a && (a.start_local || a.time || a.time_display || "")));
    if (!patientKey || !date || !nt) return "";
    return "slot:" + patientKey + "|" + String(date) + "|" + nt + "|" + providerIdentity(a);
  }
  function appointmentCoreIdentity(a, date, time, allowBoundLocal) {
    var patientKey = patientIdentity(a, allowBoundLocal === true);
    var nt = normTime(time != null ? time : (a && (a.start_local || a.time || a.time_display || "")));
    if (!patientKey || !date || !nt) return "";
    return "core:" + patientKey + "|" + String(date) + "|" + nt;
  }
  function appointmentDayProviderIdentity(a, date, allowBoundLocal) {
    var patientKey = patientIdentity(a, allowBoundLocal === true), provider = providerIdentity(a);
    if (!patientKey || !date || provider === "provider-unattributed") return "";
    return "day-provider:" + patientKey + "|" + String(date) + "|" + provider;
  }
  function appointmentIdentity(a, date, time, allowBoundLocal) {
    var appointmentId = rowAppointmentId(a);
    if (appointmentId) return "appointment-id:" + appointmentId.toLowerCase();
    return appointmentSlotIdentity(a, date, time, allowBoundLocal);
  }
  function importKey(a, date, time) { return appointmentIdentity(a, date, time, false); }
  function stableId(s) {
    var h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return "p_sched_" + (h >>> 0).toString(36);
  }
  function indexKey(day) { return safe(function () { return isFn(window.uns) ? window.uns(IMPORT_INDEX_SUFFIX + "::" + String(day || "")) : ""; }, ""); }
  function daysKey() { return safe(function () { return isFn(window.uns) ? window.uns(IMPORT_DAYS_SUFFIX) : ""; }, ""); }
  function ensureDay(day) {
    day = String(day || ""); if (!day || knownDays[day]) return;
    knownDays[day] = 1;
    var k = daysKey(); if (!k) return;
    safe(function () {
      var days = JSON.parse(localStorage.getItem(k) || "[]"); if (!Array.isArray(days)) days = [];
      if (days.indexOf(day) < 0) days.push(day);
      days.sort();
      while (days.length > 45) { var old = days.shift(); delete knownDays[old]; localStorage.removeItem(indexKey(old)); }
      localStorage.setItem(k, JSON.stringify(days));
    });
  }
  function readIndex(day) {
    var k = indexKey(day); if (!k) return { v: 1, rows: {} };
    return safe(function () {
      var x = JSON.parse(localStorage.getItem(k) || "null");
      if (!x || x.v !== 1 || !x.rows || typeof x.rows !== "object") x = { v: 1, rows: {} };
      return x;
    }, { v: 1, rows: {} });
  }
  function writeIndex(day, x) { var k = indexKey(day); if (k) { ensureDay(day); safe(function () { localStorage.setItem(k, JSON.stringify(x)); }); } }
  function markDone(key, meta) {
    var day = String((meta && meta.date) || ""), x = readIndex(day);
    x.rows[key] = { state: "done", patientId: String((meta && meta.patientId) || ""), backendAppointmentId: String((meta && meta.backendAppointmentId) || ""), appt_date: String((meta && meta.date) || ""), updated: Date.now() };
    writeIndex(day, x); delete inFlight[key];
  }
  function claim(key, meta) {
    if (inFlight[key]) return "";
    var day = String((meta && meta.date) || ""), now = Date.now(), x = readIndex(day), old = x.rows[key];
    if (old && old.state === "done") return "";
    if (old && old.state === "pending" && now - Number(old.updated || 0) < PENDING_TTL) return "";
    var owner = now.toString(36) + Math.random().toString(36).slice(2);
    x.rows[key] = { state: "pending", owner: owner, patientId: String((meta && meta.patientId) || ""), appt_date: String((meta && meta.date) || ""), updated: now };
    writeIndex(day, x);
    var check = readIndex(day).rows[key];
    if (!check || check.state !== "pending" || check.owner !== owner) return "";
    inFlight[key] = owner; return owner;
  }
  function rollback(key, owner, day) {
    var x = readIndex(day), old = x.rows[key];
    if (old && old.state === "pending" && old.owner === owner) { delete x.rows[key]; writeIndex(day, x); }
    if (inFlight[key] === owner) delete inFlight[key];
  }
  function findPatient(pts, a) {
    var mrn = rowMrn(a), nk = normName(a && a.name), dk = normDob(a && a.dob), i, p;
    var localId = rowLocalPatientId(a);
    if (localId) {
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        if (String(p && p.id || "") !== localId) continue;
        if (mrn && rowMrn(p) && rowMrn(p) !== mrn) return null;
        if (dk && normDob(p && p.dob) && normDob(p && p.dob) !== dk) return null;
        /* An exact local id without source DOB/MRN is still not enough for a
           new frozen Athena row; only an already-bound appointment may supply
           that proof later in queueHistory. */
        return (mrn || dk) ? p : null;
      }
      return null;
    }
    var sourceId = rowSourcePatientId(a);
    if (sourceId && (mrn || dk)) {
      var sourceMatches = pts.filter(function (one) { return rowSourcePatientId(one).toLowerCase() === sourceId.toLowerCase(); });
      if (sourceMatches.length !== 1) return null;
      p = sourceMatches[0];
      if (mrn && rowMrn(p) && rowMrn(p) !== mrn) return null;
      if (dk && normDob(p && p.dob) && normDob(p && p.dob) !== dk) return null;
      return p;
    }
    if (mrn) {
      var mrnMatches = pts.filter(function (one) { return rowMrn(one) === mrn; });
      if (mrnMatches.length > 1) return null;
      if (mrnMatches.length === 1) { p = mrnMatches[0]; return (!dk || !normDob(p && p.dob) || normDob(p && p.dob) === dk) ? p : null; }
      if (dk) {
        var fallbackDobMatches = pts.filter(function (one) { return !rowMrn(one) && normName(one && one.name) === nk && normDob(one && one.dob) === dk; });
        if (fallbackDobMatches.length === 1) return fallbackDobMatches[0];
      }
      return null;
    }
    if (dk) {
      var dobMatches = pts.filter(function (one) { return normName(one && one.name) === nk && normDob(one && one.dob) === dk; });
      if (dobMatches.length === 1) return dobMatches[0];
      /* A supplied DOB that does not match must never degrade to name-only. */
      return null;
    }
    /* A unique display name is not an identity proof. In particular, never
       upgrade a name-only Athena row with DOB/MRN copied from a local record. */
    return null;
  }

  /* ---- read-only capture of the latest schedule read (for DOM-scrape fallback) ---- */
  var lastResp = null;
  function onSchedMsg(e) {
    safe(function () {
      var d = e && e.data;
      if (!d || d.source !== "mls-ext" || d.type !== "mlsAppScheduleResult") return;
      lastResp = d.resp || null;   // kept in memory only; never logged or forwarded
    });
  }

  /* map the extension DOM scrape rows {time,name,provider} into the app appt shape */
  function domApptsFromResp(resp, confirmedDay) {
    return safe(function () {
      var a = (resp && resp.appts) || [];
      var out = [];
      for (var i = 0; i < a.length; i++) {
        var nm = String((a[i] && a[i].name) || "").trim();
        if (!nm) continue;
        /* FIX 2026-07-01: keep the DOB the extension already supplies (it was mapped to ""
           here, so structured-read imports stored dob-less rows -- same dropped-field class
           as the provider bug). */
        out.push({
          name: nm,
          dob: String(a[i].dob || ""),
          mrn: String(a[i].mrn || a[i].athenaId || a[i].athena_id || ""),
          patientId: firstField(a[i], ["athenaPatientId", "athena_patient_id", "patientId", "patient_id", "chartId", "chart_id"]),
          patient_external_id: firstField(a[i], ["patient_external_id", "_mlsTargetPatientId"]),
          appointmentId: firstField(a[i], ["athenaAppointmentId", "athena_appointment_id", "appointmentId", "appointment_id", "apptId", "appt_id", "encounterId", "encounter_id"]),
          providerId: firstField(a[i], ["athenaProviderId", "athena_provider_id", "providerId", "provider_id", "renderingProviderId", "rendering_provider_id"]),
          date: normDate(a[i].date || a[i].appt_date || "") || String(confirmedDay || ""),
          time: normTime(a[i].start_local || a[i].time || a[i].time_display || ""),
          reason: String(a[i].reason || ""),
          provider: String(a[i].provider || "")
        });
      }
      return out;
    }, []);
  }

  /* ---- the corrected importer. appts = [{name,dob,date,time,reason}], opts.date = target day ---- */
  function importAppts(appts, opts) {
    opts = opts || {};
    appts = (appts || []).filter(function (a) { return a && String(a.name || "").trim(); });
    var providerResp = opts.providerResponse || lastResp || null;
    var requestedProvider = providerRequest(opts.provider);

    function emptyResult(reason, providerReceipt, wrongDay, invalidDate) {
      return { created: 0, repaired: 0, enrichedFields: 0, skipped: 0, failed: 0, attempted: 0,
        wrongDay: Number(wrongDay || 0), invalidDate: Number(invalidDate || 0),
        reason: reason || "empty", days: {}, target: normDate(opts.scopeDate || opts.date) || "",
        scope: normDate(opts.scopeDate) || "", historyTargets: [], historyUnresolved: [],
        providerReceipt: providerReceipt || null };
    }

    if (!signedIn()) { toast("Sign in to import the schedule.", "err"); return Promise.resolve({ created: 0, skipped: 0, reason: "signin", days: {} }); }

    /* DOM-scrape fallback: if nothing parsed but the live read has structured rows, use them */
    if (!appts.length) {
      var dom = domApptsFromResp(providerResp);
      if (dom.length) appts = dom;
    }
    if (!appts.length) {
      if (requestedProvider.mode === "selected") {
        var emptyScope = scopeProviderRows([], opts.provider, providerResp);
        return Promise.resolve(emptyResult(emptyScope.complete ? "provider-empty" : emptyScope.reason, emptyScope.receipt));
      }
      return Promise.resolve(emptyResult("empty", null));
    }

    /* target day: explicit -> page-printed date. No unproven today fallback. */
    var schedText = safe(function () { return (window.__schedRaw && window.__schedRaw.text) || (lastResp && lastResp.text) || ""; }, "");
    var pageDate = normDate(detectSchedDate(schedText)) || "";
    var fallbackDay = normDate(opts.date) || (window.__mlsSITarget ? normDate(window.__mlsSITarget) : "") || pageDate || "";
    var scopeDate = opts.scopeDate ? (normDate(opts.scopeDate) || String(opts.scopeDate).slice(0, 10)) : "";
    var wrongDay = 0, invalidDate = 0;

    /* Resolve EACH appointment's REAL scheduled date: its own parsed date first, then the
       date printed on the schedule page, then the requested/target day. This stops the old
       behaviour where every parsed row got one single fallback date (the whole week landing
       on today). */
    /* FIX 2026-07-01: the structured extension read (lastResp.appts) always carries the
       per-appointment provider ("Matthew Schaeffer, MD"), but the TEXT-parse path drops it.
       Build an exact name+time -> provider map from that structured read so a
       text fallback may be enriched without crossing duplicate names. Any
       conflicting mapping stays unattributed and selected-provider pulls fail
       closed rather than guessing. */
    var respProv = {}, respProvAmbiguous = {};
    safe(function () {
      var ra = (providerResp && providerResp.appts) || [];
      ra.forEach(function (x) {
        var nm = String((x && x.name) || "").trim().toLowerCase().replace(/\s+/g, " ");
        var p = String((x && x.provider) || "").trim();
        var tm = normTime(x && (x.start_local || x.time || x.time_display || ""));
        var rk = nm && tm ? (nm + "|" + tm) : "";
        if (!rk || !p || respProvAmbiguous[rk]) return;
        if (respProv[rk] && providerKey(respProv[rk]) !== providerKey(p)) { delete respProv[rk]; respProvAmbiguous[rk] = 1; }
        else respProv[rk] = p;
      });
    });
    appts = appts.map(function (a) {
      var o = {}; for (var k in a) { if (a.hasOwnProperty(k)) o[k] = a[k]; }
      /* FIX 2026-07-01: the user's REQUESTED day (fallbackDay's first slot = opts.date) must
         outrank the date PRINTED on the athena page -- a week-range banner ("Week of June 28 -
         July 4, 2026") made pageDate resolve to the wrong day, so day-scoped pulls filtered
         every row out ("patients land on July 4" / "0 imported"). A conflicting
         per-row date is rejected, never silently moved onto the requested day. */
      var parsedDate = normDate(a.date), storedDate = normDate(a.appt_date), ownDate = parsedDate || storedDate;
      if (parsedDate && storedDate && parsedDate !== storedDate) { o._wrongDay = true; wrongDay++; }
      if (scopeDate && ownDate && ownDate !== scopeDate && !o._wrongDay) { o._wrongDay = true; wrongDay++; }
      o._date = scopeDate ? (o._wrongDay ? "" : scopeDate) : (ownDate || fallbackDay);
      if (!o._date && !o._wrongDay) { o._badDate = true; invalidDate++; }
      if (!String(o.provider || "").trim()) {
        var _nm = String(o.name || "").trim().toLowerCase().replace(/\s+/g, " ");
        var _tm = normTime(o.start_local || o.time || o.time_display || "");
        var _rk = _nm && _tm ? (_nm + "|" + _tm) : "";
        if (_rk && respProv[_rk] && !respProvAmbiguous[_rk]) o.provider = respProv[_rk];
      }
      return o;
    });
    /* Day-scoped pull (Today / Tomorrow / a specific date): import ONLY that day's
       appointments, placed on that day. Never smear other days onto it. */
    if (scopeDate) appts = appts.filter(function (a) { return !a._wrongDay && a._date === scopeDate; });
    else appts = appts.filter(function (a) { return !a._wrongDay && !a._badDate && !!a._date; });
    if (!appts.length) {
      return Promise.resolve(emptyResult(scopeDate ? "none-for-day" : (invalidDate ? "unproven-date" : "empty"), null, wrongDay, invalidDate));
    }
    var target = scopeDate || fallbackDay;

    /* A selected-provider import is fail-closed. The whole verified day may be
       read, but only exact provider-token matches are imported. Any untagged
       schedule row means the selected provider's subset cannot be proven
       complete, so nothing is changed and the user can safely retry. */
    var providerScope = scopeProviderRows(appts, opts.provider, providerResp);
    if (!providerScope.complete) {
      return Promise.resolve(emptyResult(providerScope.reason, providerScope.receipt, wrongDay, invalidDate));
    }
    appts = providerScope.rows;
    if (!appts.length) {
      return Promise.resolve(emptyResult(requestedProvider.mode === "selected" ? "provider-empty" : "empty", providerScope.receipt, wrongDay, invalidDate));
    }

    var token = bkToken(), base = bkBase();
    var pts = (callG("getPatients") || []) || [];
    var existingRows = {}, existingAmbiguous = {};

    function indexExisting(key, row) {
      if (!key || existingAmbiguous[key]) return;
      if (existingRows[key] && String(existingRows[key].id || "") !== String(row && row.id || "")) {
        delete existingRows[key]; existingAmbiguous[key] = 1; return;
      }
      existingRows[key] = row;
    }

    return safe(function () {
      return fetch(base + "/api/appointments", { headers: { Authorization: "Bearer " + token } })
        .then(function (r) { return r.ok ? r.json() : { appointments: [] }; })
        .catch(function () { return { appointments: [] }; });
    }, Promise.resolve({ appointments: [] })).then(function (ed) {
      (ed.appointments || []).forEach(function (x) {
        var lt = ""; safe(function () { if (x.start_at) lt = new Date(x.start_at).toTimeString().slice(0, 5); });
        var ld = x.appt_date || ""; if (!ld) safe(function () { if (x.start_at) { var dd = new Date(x.start_at); ld = dd.getFullYear() + "-" + ("0" + (dd.getMonth() + 1)).slice(-2) + "-" + ("0" + dd.getDate()).slice(-2); } });
        var linked = null;
        safe(function () { linked = pts.find(function (p) { return String(p && p.id || "") === String(x.patient_external_id || ""); }); });
        var bound = {}; for (var bx in x) if (x.hasOwnProperty(bx)) bound[bx] = x[bx];
        if (linked && linked.id) bound.patient_external_id = String(linked.id);
        var existingIdentityKey = appointmentIdentity(bound, ld, lt, !!(linked && linked.id));
        var existingSlotKey = appointmentSlotIdentity(bound, ld, lt, !!(linked && linked.id));
        var existingCoreKey = appointmentCoreIdentity(bound, ld, lt, !!(linked && linked.id));
        var existingDayProviderKey = appointmentDayProviderIdentity(bound, ld, !!(linked && linked.id));
        indexExisting(existingIdentityKey, x);
        if (existingSlotKey !== existingIdentityKey) indexExisting(existingSlotKey, x);
        indexExisting(existingCoreKey, x);
        indexExisting(existingDayProviderKey, x);
        /* Reconnect an Athena source appointment id to the backend row created
           by an earlier pull, even when the backend schema does not echo that
           source id. The account-local ledger stores only ids, never PHI. */
        var dayLedger = readIndex(ld), backendId = String(x && x.id || "");
        if (backendId) Object.keys(dayLedger.rows || {}).forEach(function (ledgerIdentity) {
          var ledgerRow = dayLedger.rows[ledgerIdentity] || {};
          if (ledgerRow.state === "done" && String(ledgerRow.backendAppointmentId || "") === backendId) indexExisting(ledgerIdentity, x);
        });
      });

      var created = 0, repaired = 0, enrichedFields = 0, skipped = 0, failed = 0, days = {};
      /* Bind every imported/skipped appointment to one immutable MLS patient
         before any asynchronous chart work begins. The history pipeline uses
         these IDs (plus DOB/MRN proof), never a later name-only lookup. */
      var historyTargets = [], historyTargetSeen = {}, historyUnresolved = [];
      function queueHistory(a, p, date, exactOldRow) {
        var patientId = String(p && p.id || "").trim();
        if (!patientId) { historyUnresolved.push({ patientId: "", reason: "patient-not-resolved" }); return; }
        if (historyTargetSeen[patientId]) return;
        var rowProof = sourceProof(a), dob = rowProof.dob ? String(a && a.dob || "").trim() : "", mrn = rowProof.mrn ? String(a && (a.mrn || a.athenaId || a.athena_id) || "").trim() : "";
        /* Only the frozen Athena row may normally supply proof. The one safe
           fallback is an existing appointment already bound to this exact local
           patient; even then the proof must live on that appointment, never be
           borrowed from the local patient record by display name. */
        if (!dob && !mrn && exactOldRow && String(exactOldRow.patient_external_id || "") === patientId) {
          var oldProof = sourceProof(exactOldRow);
          if (oldProof.dob) dob = String(exactOldRow.dob || "").trim();
          if (oldProof.mrn) mrn = String(exactOldRow.mrn || exactOldRow.athenaId || exactOldRow.athena_id || "").trim();
        }
        if ((!dob && !mrn) || (dob && normDob(p && p.dob) !== normDob(dob)) || (mrn && rowMrn(p) !== normMrn(mrn))) {
          historyTargetSeen[patientId] = 1;
          historyUnresolved.push({ patientId: patientId, reason: (!dob && !mrn) ? "missing-source-dob-mrn-proof" : "source-proof-conflict" });
          return;
        }
        historyTargetSeen[patientId] = 1;
        historyTargets.push({
          patient_external_id: patientId,
          _mlsTargetPatientId: patientId,
          _mlsTargetDob: dob,
          _mlsTargetMrn: mrn,
          name: String((p && p.name) || (a && a.name) || "").trim(),
          dob: dob,
           mrn: mrn,
           athenaId: mrn,
           date: String(date || ""),
           source: "athena-schedule-history"
         });
      }
      var onEach = isFn(opts.onEach) ? opts.onEach : null;   /* task-1: per-appointment status callback */
      var chain = Promise.resolve();
      appts.forEach(function (a) {
        chain = chain.then(function () {
          var name = String(a.name || "").trim(); if (!name) return;
          if (onEach) safe(function () { onEach("patient", { name: name }); });
          var date = a._date || normDate(a.date) || target;   /* the resolved per-appt date */
          var nt = normTime(a.time);
          if (onEach) safe(function () { onEach("fields", { name: name, time: nt, provider: String(a.provider || "") }); });
          var desiredStart = /^\d\d:\d\d$/.test(nt) ? wallToUtc(date, nt) : null;
          if (onEach) safe(function () { onEach("dedupe", { name: name }); });
          var exactAppointmentKey = rowAppointmentId(a) ? appointmentIdentity(a, date, nt, false) : "";
          var oldRow = (exactAppointmentKey && !existingAmbiguous[exactAppointmentKey]) ? (existingRows[exactAppointmentKey] || null) : null;
          var ext = "", existing = null;
          /* Resolve the patient from frozen source proof first. A same-name local
             record, even when unique, is never a binding candidate. */
          safe(function () {
            existing = findPatient(pts, a);
            if (existing) ext = existing.id;
          });
          /* An exact appointment id may locate an already-bound backend row.
             It can reconcile that appointment, but conflicting source proof is
             fatal and its local patient's DOB/MRN is never copied onto the row. */
          if (oldRow && oldRow.patient_external_id) {
            var boundPatient = pts.find(function (p0) { return String(p0 && p0.id || "") === String(oldRow.patient_external_id); }) || null;
            var frozenProof = sourceProof(a);
            var proofConflict = !!(boundPatient && ((frozenProof.dob && normDob(boundPatient.dob) && normDob(boundPatient.dob) !== frozenProof.dob) || (frozenProof.mrn && rowMrn(boundPatient) && rowMrn(boundPatient) !== frozenProof.mrn)));
            if (proofConflict || (existing && String(existing.id || "") !== String(oldRow.patient_external_id || ""))) {
              failed++;
              if (onEach) safe(function () { onEach("error", { name: name, error: "appointment-patient-identity-conflict" }); });
              return;
            }
            if (!existing && boundPatient) { existing = boundPatient; ext = String(boundPatient.id || ""); }
          }
          /* Once DOB/MRN has resolved an immutable local patient, use that exact
             id in the slot identity. This is what keeps two same-name patients
             on the same day (and even at the same time) separate. */
          if (existing && existing.id) {
            ext = String(existing.id); a.patient_external_id = ext;
            var resolvedSlotKey = appointmentSlotIdentity(a, date, nt, false);
            if (!oldRow && resolvedSlotKey && !existingAmbiguous[resolvedSlotKey]) oldRow = existingRows[resolvedSlotKey] || null;
            if (!oldRow) {
              var coreKey = appointmentCoreIdentity(a, date, nt, false);
              var dayProviderKey = appointmentDayProviderIdentity(a, date, false);
              var coreRow = coreKey && !existingAmbiguous[coreKey] ? existingRows[coreKey] : null;
              var dayProviderRow = dayProviderKey && !existingAmbiguous[dayProviderKey] ? existingRows[dayProviderKey] : null;
              if (coreRow) {
                var incomingProviderId = rowProviderId(a), oldProviderId = rowProviderId(coreRow);
                var incomingProviderKey = providerKey(a.provider), oldProviderKey = providerKey(coreRow.provider);
                if ((incomingProviderId && oldProviderId && incomingProviderId.toLowerCase() !== oldProviderId.toLowerCase()) ||
                    (incomingProviderKey && oldProviderKey && incomingProviderKey !== oldProviderKey)) coreRow = null;
              }
              if (dayProviderRow && String(dayProviderRow.start_at || "").trim()) dayProviderRow = null; /* only repair a proven missing-time row */
              if (coreRow && dayProviderRow && String(coreRow.id || "") !== String(dayProviderRow.id || "")) {
                failed++;
                if (onEach) safe(function () { onEach("error", { name: name, error: "appointment-enrichment-ambiguous" }); });
                return;
              }
              oldRow = coreRow || dayProviderRow || null;
            }
            if (oldRow && oldRow.patient_external_id && String(oldRow.patient_external_id) !== ext) {
              failed++;
              if (onEach) safe(function () { onEach("error", { name: name, error: "slot-patient-identity-conflict" }); });
              return;
            }
          }
          var patientKey = patientIdentity(a, false);
          if (!existing && patientKey && isFn(window.upsertPatient)) {
            var np = { id: stableId(patientKey), name: name, dob: String(a.dob || ""), reason: String(a.reason || ""), source: "athena-schedule", created: Date.now() };
            if (rowMrn(a)) { np.athenaId = String(a.mrn || a.athenaId || a.athena_id || ""); np.mrn = np.athenaId; }
            safe(function () { window.upsertPatient(np); existing = np; ext = np.id; a.patient_external_id = ext; if (!pts.some(function (p0) { return String(p0 && p0.id || "") === String(np.id); })) pts.push(np); });
          } else if (existing) {
            var dirty = false;
            if (a.dob && !existing.dob) { existing.dob = String(a.dob); dirty = true; }
            if (rowMrn(a) && !rowMrn(existing)) { existing.athenaId = String(a.mrn || a.athenaId || a.athena_id || ""); if (!existing.mrn) existing.mrn = existing.athenaId; dirty = true; }
            if (dirty) safe(function () { window.upsertPatient(existing); });
          }
          if (existing && existing.id) { ext = String(existing.id); a.patient_external_id = ext; }
          var ledgerKey = importKey(a, date, nt);
          if (!ledgerKey) {
            failed++;
            historyUnresolved.push({ patientId: ext || "", reason: "appointment-identity-unresolved" });
            if (onEach) safe(function () { onEach("error", { name: name, error: "appointment-identity-unresolved" }); });
            return;
          }
          if (!oldRow && !existingAmbiguous[ledgerKey]) oldRow = existingRows[ledgerKey] || null;
          if (oldRow) {
            var incomingAppointmentId = rowAppointmentId(a), storedAppointmentId = rowAppointmentId(oldRow);
            var incomingProviderId2 = rowProviderId(a), storedProviderId2 = rowProviderId(oldRow);
            if ((incomingAppointmentId && storedAppointmentId && incomingAppointmentId.toLowerCase() !== storedAppointmentId.toLowerCase()) ||
                (incomingProviderId2 && storedProviderId2 && incomingProviderId2.toLowerCase() !== storedProviderId2.toLowerCase())) {
              failed++;
              if (onEach) safe(function () { onEach("error", { name: name, error: "appointment-source-identity-conflict" }); });
              return;
            }
            /* The calendar row already exists, so its exact patient is eligible
               for history even if an optional missing-time repair later fails. */
            queueHistory(a, existing, date, oldRow);
            /* A repeat pull is idempotent enrichment, not a blind skip. Fill only
               fields that are still empty on this exact existing appointment;
               conflicting nonempty values are preserved for human review. */
            var enrich = {}, enrichKeys = [];
            function addMissing(field, value) {
              if (String(oldRow && oldRow[field] || "").trim() || value == null || !String(value).trim()) return;
              enrich[field] = value; enrichKeys.push(field);
            }
            addMissing("dob", String(a.dob || ""));
            addMissing("provider", String(a.provider || ""));
            if (!storedAppointmentId) addMissing("athena_appointment_id", incomingAppointmentId);
            if (!storedProviderId2) addMissing("athena_provider_id", incomingProviderId2);
            addMissing("reason", String(a.reason || ""));
            addMissing("patient_external_id", ext || "");
            if (desiredStart && !String(oldRow.start_at || "").trim()) { enrich.appt_date = date; enrich.start_at = desiredStart; enrichKeys.push("start_at"); }
            if (oldRow && oldRow.id != null && enrichKeys.length) {
              if (onEach) safe(function () { onEach("repair", { name: name }); });
              return fetch(base + "/api/appointments/" + encodeURIComponent(oldRow.id) + "/update", {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: "Bearer " + token },
                body: JSON.stringify(enrich)
              }).then(function (rr) {
                if (rr.ok) {
                  enrichKeys.forEach(function (field) { oldRow[field] = enrich[field]; });
                  markDone(ledgerKey, { patientId: ext || oldRow.patient_external_id || "", backendAppointmentId: oldRow.id, date: date });
                  enrichedFields += enrichKeys.length;
                  repaired++; days[date] = (days[date] || 0) + 1;
                  if (onEach) safe(function () { onEach("repaired", { name: name, fields: enrichKeys.slice() }); });
                } else {
                  failed++;
                  if (onEach) safe(function () { onEach("error", { name: name, error: "HTTP " + rr.status }); });
                }
              }).catch(function () {
                failed++;
                if (onEach) safe(function () { onEach("error", { name: name, error: "network" }); });
              });
            }
            markDone(ledgerKey, { patientId: ext || (oldRow && oldRow.patient_external_id) || "", backendAppointmentId: oldRow && oldRow.id, date: date }); skipped++; if (onEach) safe(function () { onEach("skipped", { name: name }); }); return;
          }
          var owner = claim(ledgerKey, { date: date });
          if (!owner) {
            var ledgerState = safe(function () { return readIndex(date).rows[ledgerKey] || null; }, null);
            if (ledgerState && ledgerState.state === "done") {
              queueHistory(a, existing, date, null); skipped++;
              if (onEach) safe(function () { onEach("skipped", { name: name }); });
            } else {
              /* A pending/unknown ledger row is not an imported appointment.
                 Mark the calendar partial and do not repeat the old bug where
                 history saved even though no appointment landed. */
              failed++;
              if (onEach) safe(function () { onEach("error", { name: name, error: "import-in-flight" }); });
            }
            return;
          }
          var startIso = desiredStart;
          /* FIX 2026-07-01: carry the per-appointment PROVIDER into storage. The extension
             supplies it (a.provider e.g. "Matthew Schaeffer, MD") and the backend has a
             provider column, but it was being dropped here -> every stored appt had provider
             null -> doctor-scoped "Who's Next" excluded them (matchesDoctor returns false on
             an empty provider) and showed a stale set instead. This is the "doctors assigned
             to their correct patients" fix. */
          var body = { name: name, dob: String(a.dob || ""), reason: String(a.reason || ""), provider: String(a.provider || ""), patient_external_id: ext || null, appt_date: date, start_at: startIso };
          var sourceAppointmentId = rowAppointmentId(a), sourceProviderId = rowProviderId(a);
          if (sourceAppointmentId) body.athena_appointment_id = sourceAppointmentId;
          if (sourceProviderId) body.athena_provider_id = sourceProviderId;
          if (onEach) safe(function () { onEach("save", { name: name }); });
          return safe(function () {
            return fetch(base + "/api/appointments", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) })
              .then(function (r) {
                if (!r.ok) { rollback(ledgerKey, owner, date); failed++; if (onEach) safe(function () { onEach("error", { name: name, error: "HTTP " + r.status }); }); return; }
                return Promise.resolve(safe(function () { return isFn(r.json) ? r.json() : null; }, null)).catch(function () { return null; }).then(function (saved) {
                  var backendAppointmentId = String((saved && (saved.id || (saved.appointment && saved.appointment.id) || (saved.data && saved.data.id))) || "");
                  markDone(ledgerKey, { patientId: ext, backendAppointmentId: backendAppointmentId, date: date });
                  queueHistory(a, existing, date, null); created++; days[date] = (days[date] || 0) + 1;
                  if (onEach) safe(function () { onEach("saved", { name: name }); });
                });
              })
              .catch(function () { rollback(ledgerKey, owner, date); failed++; if (onEach) safe(function () { onEach("error", { name: name, error: "network" }); }); });
          }, null) || (rollback(ledgerKey, owner, date), Promise.resolve());
        });
      });

      /* Build an exact appointment -> provider map from what we just imported, so we can
         re-stamp provider onto the in-memory calendar AFTER loadCalendar (the backend may not
         echo provider back on already-existing rows, and older rows were stored provider-null).
         A display name/date is deliberately not a key: two same-name patients can
         be booked on the same day. In-memory only -- never modifies a backend record. */
      var provByKey = {};
      appts.forEach(function (a) {
        var p = String(a.provider || "").trim(); if (!p) return;
        var dt = a._date || normDate(a.date) || target;
        var tm = normTime(a.time || a.start_local || a.time_display || "");
        var exact = appointmentIdentity(a, dt, tm, !!rowLocalPatientId(a));
        var slot = appointmentSlotIdentity(a, dt, tm, !!rowLocalPatientId(a));
        if (exact) provByKey[exact] = p;
        if (slot) provByKey[slot] = p;
      });
      function stampProviders() {
        safe(function () {
          var cal = window._calAppts; if (!Array.isArray(cal)) return;
          for (var i = 0; i < cal.length; i++) {
            var r = cal[i]; if (!r || (r.provider && String(r.provider).trim())) continue;
            var dt = r.appt_date || (r.start_at ? new Date(r.start_at).toISOString().slice(0, 10) : "");
            var tm = ""; safe(function () { if (r.start_at) tm = new Date(r.start_at).toTimeString().slice(0, 5); });
            var p = provByKey[appointmentIdentity(r, dt, tm, true)] || provByKey[appointmentSlotIdentity(r, dt, tm, true)];
            if (p) r.provider = p;
          }
        });
      }

      return chain.then(function () {
        return Promise.resolve(safe(function () { return isFn(window.loadCalendar) ? window.loadCalendar() : null; })).then(function () {
          stampProviders();
          safe(function () { if (window.__mlsWhosNext && isFn(window.__mlsWhosNext.render)) window.__mlsWhosNext.render(); });
          /* FIX 2026-07-01: loadCalendar repopulates _calAppts asynchronously, so a single
             stamp can run before the rows exist (or be overwritten). Re-stamp on short timers
             so provider reliably lands regardless of loadCalendar's async timing. */
          [700, 1800, 3500].forEach(function (ms) { setTimeout(function () { safe(function () { stampProviders(); if (window.__mlsWhosNext && isFn(window.__mlsWhosNext.render)) window.__mlsWhosNext.render(); }); }, ms); });
          window._heroNowIdx = -1;
          var todayKey = estTodayKey();
          var todays = appts.filter(function (a) { return (a._date || normDate(a.date) || target) === todayKey && String(a.name || "").trim(); });
          safe(function () { if (isFn(window._renderTodayPatients)) window._renderTodayPatients(todays); });
          safe(function () { if (window.__mlsPick && isFn(window.__mlsPick.reapply)) window.__mlsPick.reapply(); });
          safe(function () { if (window.__mlsAsst && isFn(window.__mlsAsst._renderSchedule)) window.__mlsAsst._renderSchedule(); });
          safe(function () { if (isFn(window._calLoadNextUp)) window._calLoadNextUp(); });
          return { created: created, repaired: repaired, enrichedFields: enrichedFields, skipped: skipped, failed: failed, attempted: appts.length, wrongDay: wrongDay, invalidDate: invalidDate, days: days, target: target, scope: scopeDate || "", historyTargets: historyTargets, historyUnresolved: historyUnresolved, providerReceipt: providerScope.receipt };
        });
      });
    });
  }

  /* ---- replacement for window._importPulledSchedule (same signature: (appts) -> Promise) ---- */
  var _prevImport = null;
  function chainHasReplacement() {
    /* true if our corrected importer is already anywhere in the wrapper chain
       (a later module may have wrapped it as its .__orig). Prevents a re-install
       ping-pong with provider-scope/centerpiece/protocol wrappers. */
    var f = window._importPulledSchedule, guard = 0;
    while (f && guard < 16) { if (f.__mlsSIReplaced) return true; f = f.__orig; guard++; }
    return false;
  }
  function installImport() {
    if (chainHasReplacement()) return;
    _prevImport = window._importPulledSchedule || null;
    var fn = function (appts) {
      return Promise.resolve(importAppts(appts, {})).then(function (res) {
        safe(function () {
          var nDays = (res && res.days) ? Object.keys(res.days).length : 0;
          var msg = (res && res.created)
            ? ("Imported " + res.created + " appointment" + (res.created === 1 ? "" : "s")
               + (nDays > 1 ? (" across " + nDays + " days") : (res.target ? (" for " + res.target) : ""))
               + (res.skipped ? (" (" + res.skipped + " already on your calendar)") : "") + ".")
            : (res && res.skipped ? ("Those " + res.skipped + " appointment" + (res.skipped === 1 ? " is" : "s are") + " already on your calendar - nothing new to import.")
              : (res && res.reason === "signin" ? "Sign in to import the schedule."
                : "No appointments found to import. Open your athenaOne Day schedule (the patient grid, not the dashboard) and pull again."));
          toast(msg, res && res.created ? "ok" : "");
          var ps = document.getElementById("heroPullStatus");
          if (ps) { ps.textContent = msg; ps.style.color = (res && res.created) ? "#d8ffe8" : "rgba(255,255,255,.95)"; ps.style.display = "block"; }
        });
        return res;
      });
    };
    fn.__mlsSIReplaced = true;
    fn.__orig = _prevImport;
    window._importPulledSchedule = fn;
  }

  /* ---- day-scoped pull (Today / Tomorrow / any date) for items 2 & 3 ---- */
  function bridge(type, reqType, timeoutMs, payload) {
    return new Promise(function (res) {
      var done = false, tid = null;
      var requestId = "mlssi-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
      function finish(v) { if (done) return; done = true; if (tid) clearTimeout(tid); window.removeEventListener("message", on); res(v); }
      function on(e) {
        if (!(e.data && e.data.source === "mls-ext") || e.data.type !== type) return;
        var gotId = String((e.data.resp && e.data.resp.id) || e.data.id || "");
        /* New extension builds echo the request id. Older builds do not, so
           retain compatibility; whenever an id is present, a stale/probe
           reply can no longer satisfy this pull. */
        if (gotId && gotId !== requestId) return;
        finish(e.data.resp || e.data || null);
      }
      window.addEventListener("message", on);
      safe(function () {
        var msg = { source: "mls-app", type: reqType, id: requestId };
        payload = payload || {};
        for (var k in payload) { if (payload.hasOwnProperty(k)) msg[k] = payload[k]; }
        window.postMessage(msg, "*");
      });
      tid = setTimeout(function () { finish(null); }, timeoutMs || 12000);
    });
  }

  function responseDay(r) {
    var sd = normDate(r && r.schedDate);
    if (sd) return sd;
    return normDate(detectSchedDate((r && r.text) || "")) || "";
  }

  /* ---- calendar-selected provider/day ----------------------------------
   * The calendar provider filter stores a provider ID, while Athena exposes a
   * provider name. Resolve the ID through the loaded provider roster and
   * refuse missing/ambiguous names. Month/week views must have an explicitly
   * opened day; Day view uses its visible reference date. */
  function calendarProviderRows() {
    var raw = safe(function () { return window._calProviders || []; }, []) || [], out = [];
    raw.forEach(function (p) {
      if (typeof p === "string") {
        var rs = String(p || "").trim(); if (rs) out.push({ fval: "nm:" + rs, id: "", name: rs, key: providerKey(rs) });
      } else if (p && typeof p === "object") {
        var n = String(p.name || p.displayName || "").trim();
        if (n) out.push({ fval: p.id != null ? String(p.id) : ("nm:" + n), id: p.id != null ? String(p.id) : "", name: n, key: providerKey(n) });
      }
    });
    return out;
  }
  function calendarSelection() {
    var pf = safe(function () { return document.getElementById("calProvFilter"); }, null);
    var fval = pf ? String(pf.value || "") : "";
    if (!fval) return { ok: false, complete: false, reason: "provider-required", error: "Choose one provider in Calendar first." };
    var entries = calendarProviderRows();
    var matches = entries.filter(function (p) { return p.fval === fval; });
    if (matches.length !== 1 || !matches[0].key) return { ok: false, complete: false, reason: "provider-unverified", error: "The selected calendar provider could not be verified." };
    var chosen = matches[0];
    var collisions = entries.filter(function (p) { return p.key && p.key === chosen.key && p.fval !== chosen.fval; });
    if (collisions.length) return { ok: false, complete: false, reason: "provider-ambiguous", error: "Two calendar providers have the same display name. Nothing was pulled." };

    var mode = safe(function () { return String(window._calMode || "month"); }, "month");
    var date = "";
    if (mode === "day") date = normDate(safe(function () { return window._calRefDate; }, ""));
    else {
      var panel = safe(function () { return document.getElementById("calDayPanel"); }, null);
      var panelOpen = !!(panel && panel.style && panel.style.display !== "none");
      if (panelOpen) date = normDate(safe(function () { return window._calSelDay; }, ""));
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, complete: false, reason: "date-required", error: "Open the calendar day you want to pull first." };
    return { ok: true, complete: true, date: date, source: "calendar", provider: { id: chosen.id, name: chosen.name, key: chosen.key, rosterVerified: true } };
  }

  /* ---- exact-patient history + old-visits batch -------------------------
   * Schedule import returns immutable patient IDs. Process those IDs one at
   * a time, keep every Athena operation read-only, and return an honest
   * per-patient receipt. A partial/timeout never becomes a completed pull. */
  function bounded(promise, ms, label) {
    return new Promise(function (resolve, reject) {
      var done = false, tid = setTimeout(function () {
        if (done) return; done = true; reject(new Error(label || "timeout"));
      }, ms);
      Promise.resolve(promise).then(function (v) {
        if (done) return; done = true; clearTimeout(tid); resolve(v);
      }, function (e) {
        if (done) return; done = true; clearTimeout(tid); reject(e);
      });
    });
  }
  function patientById(id) {
    var pts = (callG("getPatients") || []) || [], sid = String(id || "");
    for (var i = 0; i < pts.length; i++) if (String(pts[i] && pts[i].id || "") === sid) return pts[i];
    return null;
  }
  function exactHistoryTarget(row) {
    row = row || {};
    var ref = { patientId: String(row._mlsTargetPatientId || row.patient_external_id || ""), name: String(row.name || ""), dob: String(row._mlsTargetDob || row.dob || ""), mrn: String(row._mlsTargetMrn || row.mrn || row.athenaId || "") };
    if (!ref.patientId || (!normDob(ref.dob) && !normMrn(ref.mrn))) return null;
    var bound = patientById(ref.patientId);
    if (!bound) return null;
    /* Every proof supplied by the frozen schedule target must still agree with
       the immutable local patient id. A duplicate/name-only row can never enter
       the history reader, and conflicting DOB/MRN proof cannot degrade. */
    if (normDob(ref.dob) && normDob(bound.dob) !== normDob(ref.dob)) return null;
    if (normMrn(ref.mrn) && rowMrn(bound) !== normMrn(ref.mrn)) return null;
    var snap = safe(function () { return isFn(window._athenaHistoryTargetSnapshot) ? window._athenaHistoryTargetSnapshot(ref, false) : null; }, null);
    if (!snap || String(snap.patientId || "") !== ref.patientId) return null;
    if (normDob(ref.dob) && normDob(snap.dob) !== normDob(ref.dob)) return null;
    if (normMrn(ref.mrn) && normMrn(snap.mrn || snap.athenaId) !== normMrn(ref.mrn)) return null;
    return snap;
  }
  function verifiedChartCoverage(rd, readStartedAt) {
    rd = rd || {};
    var receipt = rd.coverageReceipt || null;
    var expected = Number(receipt && receipt.expectedClinicalFrames), read = Number(receipt && receipt.readClinicalFrames);
    var capturedAt = Number(receipt && receipt.capturedAt), textChars = Number(receipt && receipt.textChars);
    var requestId = String(rd.requestId || ""), receiptRequestId = String(receipt && receipt.requestId || "");
    if (!receipt || receipt.kind !== "athena-chart-coverage" || receipt.complete !== true) return null;
    if (String(receipt.readerVersion || "") !== "2.9.19-chart-r3" || receipt.identityObserved !== true || !requestId || receiptRequestId !== requestId) return null;
    if (!capturedAt || capturedAt < Number(readStartedAt || 0) - 5000 || capturedAt > Date.now() + 5000) return null;
    if (!(expected >= 1) || read !== expected || Number(receipt.boundClinicalFrames) !== expected || Number(receipt.unboundClinicalFrames || 0) !== 0 || Number(receipt.oversizeClinicalFrames || 0) !== 0 || Number(receipt.unreadFrames || 0) !== 0 || Number(receipt.omittedForCap || 0) !== 0 || receipt.truncated === true || textChars !== String(rd.text || "").length) return null;
    return receipt;
  }
  function saveOrganizedHistory(target, row, rd, readStartedAt) {
    var coverage = verifiedChartCoverage(rd, readStartedAt);
    if (!coverage) return Promise.reject(new Error("chart-coverage-unproven"));
    return bounded(Promise.resolve(safe(function () { return window._parsePatientChart(rd.text); }, null)), 120000, "chart-parse-timeout").then(function (chart) {
      var parsedCoverage=safe(function(){return isFn(window._athenaChartProfileCoverage)?window._athenaChartProfileCoverage(chart):null;},null);
      if (!chart || !parsedCoverage || parsedCoverage.complete!==true) throw new Error("clinical-field-coverage-unproven");
      var saveRef = safe(function () { return window._athenaHistoryVerifiedRef(target, rd); }, null);
      if (!saveRef || !safe(function () { return window._savePatientChart(saveRef, row, chart) === true; }, false)) throw new Error("chart-identity-save-refused");
      var storedCoverage=safe(function(){return isFn(window._patientHistoryCardCoverage)?window._patientHistoryCardCoverage(target.patientId):null;},null);
      if(!storedCoverage||storedCoverage.complete!==true||storedCoverage.exactIdentityVerified!==true) throw new Error("clinical-field-save-unproven");
      var clinicalFieldCount=['problems','meds','allergies','vitals','history'].reduce(function(n,k){return n+(storedCoverage.cards&&storedCoverage.cards[k]&&storedCoverage.cards[k].populated?1:0);},0);
      return {chartCoverage:coverage,profileCoverage:storedCoverage,clinicalFieldCount:clinicalFieldCount};
    });
  }
  function saveVerifiedVisits(target, r) {
    var identity = r && r.identity || {};
    var observed = { chartName: identity.name || r.chartName || "", chartDob: identity.dob || r.chartDob || "", chartMrn: identity.mrn || identity.athenaId || r.chartMrn || "" };
    var proof = safe(function () { return isFn(window._athenaHistoryProofMatches) && window._athenaHistoryProofMatches(target, observed); }, false);
    if (!proof) throw new Error("visits-identity-proof-failed");
    var expected = Number(r && r.receipt && r.receipt.expected), parsed = Number(r && r.receipt && r.receipt.parsed);
    var readerVersion = String(r && r.readerVersion || ""), receiptReaderVersion = String(r && r.receipt && r.receipt.readerVersion || "");
    var provenR3 = /^2\.9\.19-visits-r3$/.test(readerVersion) && receiptReaderVersion === readerVersion;
    if (!r.receipt || r.receipt.complete !== true || r.receipt.indexComplete !== true || r.receipt.bodyComplete !== true || r.receipt.fullDetail !== true || r.receipt.stableKeysComplete !== true || !provenR3 || expected < 0 || parsed !== expected) throw new Error("visits-full-detail-unproven");
    if (expected === 0 && r.receipt.authoritativeEmpty !== true) throw new Error("visits-empty-unproven");
    var p = patientById(target.patientId), cv = window.__mlsCopyVisits, vm = window.__mlsVisitModel, visits = Array.isArray(r.visits) ? r.visits : [];
    if (visits.length !== parsed) throw new Error("visits-count-mismatch");
    var sourceKeys = {};
    for (var vk = 0; vk < visits.length; vk++) {
      var sourceKey = String(visits[vk] && (visits[vk].encounterId || visits[vk].sourceVisitKey) || "");
      if (!sourceKey || sourceKeys[sourceKey]) throw new Error("visits-source-key-unproven");
      sourceKeys[sourceKey] = 1;
    }
    if (!p || !vm || !isFn(vm.addVisit) || !cv) throw new Error("visit-model-unavailable");
    /* Prefer the established strict name+DOB ingest. MRN-verified charts may
       legitimately lack DOB; in that case retain the same per-row veto and
       write through the one visit model with immutable patient binding. */
    if (target.dob && observed.chartDob && isFn(cv._saveVisits)) {
      cv._saveVisits(p, { name: observed.chartName || target.name, dob: observed.chartDob }, visits, function () {}, r.receipt);
    } else {
      if (!target.mrn || !observed.chartMrn || normMrn(target.mrn) !== normMrn(observed.chartMrn)) throw new Error("visits-dob-mrn-proof-missing");
      for (var i = 0; i < visits.length; i++) {
        if (isFn(cv._visitIdentityAgrees) && !cv._visitIdentityAgrees(p, visits[i], true)) throw new Error("visit-row-identity-mismatch");
      }
      visits.forEach(function (raw) { vm.addVisit(p.id, raw, { source: "athena-schedule-history", identityVerified: true, identityBinding: String(p.id), bodyComplete: true }); });
      if (isFn(vm.reconcileVerifiedAthenaVisits)) vm.reconcileVerifiedAthenaVisits(p.id, visits);
    }
    var organization=safe(function(){return isFn(vm.organizePatientHistory)?vm.organizePatientHistory(target.patientId):null;},null);
    if(!organization||organization.ok!==true) throw new Error("history-organization-unproven");
    var fresh = patientById(target.patientId) || p;
    var refreshedCoverage=safe(function(){return isFn(window._patientHistoryCardCoverage)?window._patientHistoryCardCoverage(target.patientId):null;},null);
    var clinicalFieldCount=['problems','meds','allergies','vitals','history'].reduce(function(n,k){return n+(refreshedCoverage&&refreshedCoverage.cards&&refreshedCoverage.cards[k]&&refreshedCoverage.cards[k].populated?1:0);},0);
    return { visitCount: safe(function () { return vm.getVisits(fresh).length; }, visits.length), parsedVisits: parsed, expectedVisits: expected, visitsCoverageComplete: true, bodyComplete: true, fullDetail: true, readerVersion: readerVersion, authoritativeEmpty: expected===0&&r.receipt.authoritativeEmpty===true, organization:organization, profileCoverage:refreshedCoverage, clinicalFieldCount:clinicalFieldCount };
  }
  async function runHistoryBatch(rows, unresolved, onStatus) {
    rows = Array.isArray(rows) ? rows : []; unresolved = Array.isArray(unresolved) ? unresolved : [];
    var receipt = { requested: rows.length + unresolved.length, processed: 0, complete: false, exactIdentityVerified: false, patients: [], retry: unresolved.slice(), failures: unresolved.length };
    if (historyBatchRunning) {
      rows.forEach(function (r) { receipt.retry.push({ patientId: String(r && (r._mlsTargetPatientId || r.patient_external_id) || ""), reason: "history-batch-busy" }); });
      receipt.failures = receipt.retry.length; receipt.reason = "history-batch-busy"; return receipt;
    }
    historyBatchRunning = true;
    var stopAfterTimeout = false;
    try {
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i] || {}, target = exactHistoryTarget(row), one = { patientId: String(row._mlsTargetPatientId || row.patient_external_id || ""), identityVerified: false, organized: false, organizationComplete: false, visitsComplete: false, complete: false };
        if (!target) {
          one.reason = "identity-target-unresolved"; receipt.patients.push(one); receipt.retry.push({ patientId: one.patientId, reason: one.reason }); receipt.processed++; continue;
        }
        one.patientId = String(target.patientId || one.patientId);
        one.identityVerified = true;
        one.identityProof = target.mrn ? "mrn" : (target.dob ? "dob" : "");
        if (onStatus) onStatus("Reading verified history " + (i + 1) + " of " + rows.length + "...", "");
        /* An explicit pull always performs a fresh chart read. A legacy
           "Pulled from Athena" marker is not a coverage receipt and may be
           stale or partial, so it can never short-circuit this batch. */
        one.organized = false;
        try {
          var chartReadStartedAt = Date.now();
          var rd = await bounded(window._assistReadChart(target, function () {}), 110000, "chart-read-timeout");
          var organizedResult = await saveOrganizedHistory(target, row, rd, chartReadStartedAt);
          one.chartCoverage = organizedResult.chartCoverage; one.profileCoverage=organizedResult.profileCoverage; one.clinicalFieldCount=organizedResult.clinicalFieldCount;
          one.organized = !!(one.profileCoverage&&one.profileCoverage.complete===true);
        } catch (chartErr) { one.chartReason = String(chartErr && chartErr.message || chartErr || "chart-read-failed").slice(0, 120); if (/timeout/i.test(one.chartReason)) stopAfterTimeout = true; }
        if (!stopAfterTimeout) {
          try {
            var vr = await bounded(bridge("mlsAppAllVisitsResult", "mlsAppReadAllVisits", 190000, { hint: { patient: target.name, name: target.name, dob: target.dob || "", athenaId: target.mrn || target.athenaId || "" } }), 195000, "visits-read-timeout");
            if (!vr || !vr.ok) throw new Error((vr && (vr.reason || vr.error)) || "visits-read-failed");
            var savedVisits = saveVerifiedVisits(target, vr);
            one.visitsComplete = true; one.visitCount = savedVisits.visitCount; one.parsedVisits = savedVisits.parsedVisits; one.expectedVisits = savedVisits.expectedVisits; one.visitsCoverageComplete = savedVisits.visitsCoverageComplete; one.visitsReaderVersion = savedVisits.readerVersion; one.authoritativeEmpty=savedVisits.authoritativeEmpty===true; one.organizationComplete=!!(savedVisits.organization&&savedVisits.organization.ok===true); one.organizationReceipt=savedVisits.organization;
            if(savedVisits.profileCoverage&&savedVisits.profileCoverage.complete===true){one.profileCoverage=savedVisits.profileCoverage;one.clinicalFieldCount=savedVisits.clinicalFieldCount;}
          } catch (visitErr) { one.visitsReason = String(visitErr && visitErr.message || visitErr || "visits-read-failed").slice(0, 120); if (/timeout/i.test(one.visitsReason)) stopAfterTimeout = true; }
        }
        if(one.organized&&one.visitsComplete&&Number(one.clinicalFieldCount||0)===0&&Number(one.parsedVisits||0)===0&&one.authoritativeEmpty!==true){one.organizationComplete=false;one.visitsReason="clinical-field-coverage-unproven";}
        one.complete = !!(one.identityVerified && one.organized && one.organizationComplete && one.visitsComplete);
        if (!one.complete) {
          one.reason = one.chartReason || one.visitsReason || "history-partial";
          receipt.retry.push({ patientId: one.patientId, reason: one.reason });
        }
        receipt.patients.push(one); receipt.processed++;
        if (stopAfterTimeout) {
          for (var j = i + 1; j < rows.length; j++) receipt.retry.push({ patientId: String(rows[j] && (rows[j]._mlsTargetPatientId || rows[j].patient_external_id) || ""), reason: "deferred-after-timeout" });
          break;
        }
      }
    } finally { historyBatchRunning = false; }
    receipt.exactIdentityVerified = receipt.retry.length === 0 && receipt.patients.length === rows.length && receipt.patients.every(function (p) { return p && p.identityVerified === true; });
    /* An empty verified provider day has no patient history targets and is
       vacuously exact; unresolved/name-only rows remain in retry and fail. */
    if (receipt.requested === 0) receipt.exactIdentityVerified = true;
    receipt.failures = receipt.retry.length;
    receipt.complete = receipt.exactIdentityVerified && receipt.retry.length === 0 && receipt.processed === rows.length && receipt.patients.every(function (p) { return p && p.complete === true; });
    receipt.reason = receipt.complete ? "complete" : "history-partial";
    safe(function () { if (isFn(window.renderHistory)) window.renderHistory(); });
    safe(function () { if (isFn(window.renderProfile)) window.renderProfile(); });
    safe(function () { if (isFn(window.loadPatients)) window.loadPatients(); });
    return receipt;
  }

  function pull(opts) {
    opts = opts || {};
    var date = opts.date || estTodayKey();
    var includeHistory = opts.includeHistory !== false; /* safe default: full verified workflow */
    var onStatus = isFn(opts.onStatus) ? opts.onStatus : function () {};
    function fail(reason, extra) {
      var out = { ok: false, complete: false, reason: reason || "failed", includeHistory: includeHistory, created: 0, repaired: 0, skipped: 0, failed: 0, target: date, scheduleReceipt: null, providerReceipt: null, calendarReceipt: null, historyReceipt: null, retry: {} };
      extra = extra || {}; for (var k in extra) if (extra.hasOwnProperty(k)) out[k] = extra[k];
      return out;
    }
    /* FIX 2026-07-01: stamp "a user pull is in flight" so the connection prober pauses --
       the extension bridge has no request ids, so probe replies and pull replies can cross. */
    window.__mlsPullBusyAt = Date.now();
    if (!signedIn()) { onStatus("Sign in to import the schedule.", "err"); return Promise.resolve(fail("signin")); }

    onStatus("Looking for MLS Assist...", "");
    return bridge("mlsPong", "mlsPing", 3500).then(function (pong) {
      if (!pong) { onStatus("MLS Assist isn't responding. Enable it and open your athenaOne Day schedule, then try again.", "err"); return fail("no-ext"); }
      onStatus("Opening " + date + " in athenaOne...", "");
      return bridge("mlsAppGotoDateResult", "mlsAppGotoDate", 60000, { date: date, probe: false }).then(function (nav) {
        var navDay = normDate(nav && nav.schedDate);
        if (nav && nav.ok === false) {
          onStatus((nav && nav.error) || "Couldn't open the requested athenaOne day.", "err");
          return fail("nav-failed", { error: nav && nav.error || "" });
        }
        if (navDay && navDay !== date) {
          onStatus("Athena opened " + navDay + " instead of " + date + ". Nothing was imported.", "err");
          return fail("wrong-day", { observedDay: navDay });
        }
        onStatus("Reading your athenaOne Day schedule...", "");
        return bridge("mlsAppScheduleResult", "mlsAppPullSchedule", 30000).then(function (r) {
        if (!r || !r.ok) { onStatus((r && r.error) || "Couldn't read your athenaOne tab. Open your Day schedule and try again.", "err"); return fail((r && r.reason) || "no-read", { error: r && r.error || "", scheduleReceipt: r && r.receipt || null, retry: { schedule: true } }); }
        /* A successful extension reply is not enough: require the row-count
           receipt. Older/incomplete readers must retry instead of importing a
           visually plausible subset. Structured rows do not require flat text. */
        if (!r.receipt || r.receipt.complete !== true) {
          onStatus((r && r.error) || "Athena's schedule was only partly readable. Nothing was imported; keep that day open and retry.", "err");
          return fail("schedule-incomplete", { error: r && r.error || "", scheduleReceipt: r && r.receipt || null, retry: { schedule: true } });
        }
        if (!String(r.text || "").trim() && !(r.appts && r.appts.length) && !r.receipt.authoritativeEmpty) {
          onStatus("Athena returned no verifiable schedule rows. Nothing was imported.", "err");
          return fail("no-read", { scheduleReceipt: r.receipt, retry: { schedule: true } });
        }
        var readDay = responseDay(r) || navDay;
        if (!readDay) {
          onStatus("Couldn't verify the date shown in athenaOne. Nothing was imported.", "err");
          return fail("unverified-day", { scheduleReceipt: r.receipt, retry: { schedule: true } });
        }
        if (readDay !== date) {
          onStatus("Athena is showing " + readDay + " instead of " + date + ". Nothing was imported.", "err");
          return fail("wrong-day", { observedDay: readDay, scheduleReceipt: r.receipt, retry: { schedule: true } });
        }
        lastResp = r;
        safe(function () { window.__schedRaw = { text: r.text || "", url: r.url || "", frames: r.frames, appts: r.appts || [], schedDate: readDay }; });
        onStatus("Finding patients on " + date + "...", "");
        /* Exact structured DOM rows are authoritative for time. The prior AI-first path
           could turn a real appointment into a guessed time (including the repeated 6 PM
           symptom). Only fall back to text parsing when the extension supplied no rows. */
        var exactRows = domApptsFromResp(r, readDay);
        var parsedP = exactRows.length
          ? Promise.resolve(exactRows)
          : Promise.resolve(safe(function () { return isFn(window._parseScheduleText) ? window._parseScheduleText(r.text) : []; }, []));
        return parsedP.then(function (parsed) {
          parsed = Array.isArray(parsed) ? parsed : [];
          /* keep each appt OWN parsed date; importAppts scopes to `date` and files each
             appointment on its real day -- no whole-week-onto-one-day smear. */
          var rows = parsed.map(function (a) { return {
            name: a.name,
            dob: a.dob || "",
            mrn: a.mrn || a.athenaId || a.athena_id || "",
            patientId: firstField(a, ["athenaPatientId", "athena_patient_id", "patientId", "patient_id", "chartId", "chart_id"]),
            patient_external_id: firstField(a, ["patient_external_id", "_mlsTargetPatientId"]),
            appointmentId: firstField(a, ["athenaAppointmentId", "athena_appointment_id", "appointmentId", "appointment_id", "apptId", "appt_id", "encounterId", "encounter_id"]),
            providerId: firstField(a, ["athenaProviderId", "athena_provider_id", "providerId", "provider_id", "renderingProviderId", "rendering_provider_id"]),
            date: a.date || readDay,
            time: a.start_local || a.time || a.time_display || "",
            reason: a.reason || "",
            provider: a.provider || ""
          }; });
          return importAppts(rows, { date: date, scopeDate: date, provider: opts.provider, providerResponse: r }).then(async function (res) {
            res = res || {};
            var selectedProvider = providerRequest(opts.provider);
            if (selectedProvider.mode === "selected" && (!res.providerReceipt || res.providerReceipt.complete !== true)) {
              var providerReason = res.reason || (res.providerReceipt && res.providerReceipt.reason) || "provider-unverified";
              onStatus(providerReason === "provider-incomplete"
                ? "Some Athena schedule rows did not identify their provider. Nothing was imported; retry after the full day grid finishes loading."
                : "MLS could not verify the selected provider on this Athena day. Nothing was imported; the pull was not widened to other providers.", "err");
              return fail(providerReason, { scheduleReceipt: r.receipt, providerReceipt: res.providerReceipt || null, retry: { schedule: true, provider: selectedProvider.name } });
            }
            var attempted = Number(res.attempted != null ? res.attempted : rows.length), accounted = Number(res.created || 0) + Number(res.repaired || 0) + Number(res.skipped || 0);
            var calendarReceipt = { complete: Number(res.failed || 0) === 0 && Number(res.wrongDay || 0) === 0 && Number(res.invalidDate || 0) === 0 && accounted >= attempted, attempted: attempted, accounted: accounted, created: Number(res.created || 0), repaired: Number(res.repaired || 0), skipped: Number(res.skipped || 0), failed: Number(res.failed || 0), wrongDay: Number(res.wrongDay || 0), invalidDate: Number(res.invalidDate || 0) };
            if (res.created > 0 || res.repaired > 0) {
              var parts = [];
              if (res.created > 0) parts.push("added " + res.created + " appointment" + (res.created === 1 ? "" : "s"));
              if (res.repaired > 0) parts.push("enriched " + res.repaired + " existing appointment" + (res.repaired === 1 ? "" : "s"));
              onStatus(parts.join(" and ") + " for " + date + ".", "ok");
            }
            else if (res.skipped > 0) onStatus("Those " + res.skipped + " appointment" + (res.skipped === 1 ? " is" : "s are") + " already on your calendar for " + date + ".", "");
            else if (res.reason === "provider-empty" && selectedProvider.mode === "selected") onStatus("Athena verified no appointments for " + selectedProvider.name + " on " + date + ".", "ok");
            else if (r.receipt.authoritativeEmpty) onStatus("Athena verified that " + date + " has no appointments.", "ok");
            else onStatus("No verified patients could be imported for " + date + ".", "err");
            var historyReceipt = includeHistory
              ? await runHistoryBatch(res.historyTargets || [], res.historyUnresolved || [], onStatus)
              : { requested: 0, processed: 0, complete: true, exactIdentityVerified: true, skipped: true, reason: "not-requested", patients: [], retry: [], failures: 0 };
            var providerComplete = selectedProvider.mode !== "selected" || !!(res.providerReceipt && res.providerReceipt.complete);
            var historyComplete = !includeHistory || !!(historyReceipt.complete && historyReceipt.exactIdentityVerified === true);
            var complete = !!(r.receipt.complete && providerComplete && calendarReceipt.complete && historyComplete);
            res.ok = complete; res.complete = complete;
            res.includeHistory = includeHistory;
            res.reason = complete ? (res.reason === "provider-empty" ? "provider-empty" : (r.receipt.authoritativeEmpty ? "empty-day" : (includeHistory ? "complete" : "complete-schedule-only"))) : (!providerComplete ? "provider-unverified" : (!calendarReceipt.complete ? "calendar-partial" : "history-partial"));
            res.scheduleReceipt = r.receipt; res.providerReceipt = res.providerReceipt || null; res.calendarReceipt = calendarReceipt; res.historyReceipt = historyReceipt;
            res.retry = { schedule: false, calendarFailed: calendarReceipt.failed, history: historyReceipt.retry || [] };
            var scheduleSummary = calendarReceipt.accounted + "/" + calendarReceipt.attempted;
            var historySummary = historyReceipt.processed + "/" + historyReceipt.requested;
            var historyFailures = Number(historyReceipt.failures != null ? historyReceipt.failures : (historyReceipt.retry || []).length);
            if (!complete) onStatus("Incomplete: schedule " + scheduleSummary + "; history " + historySummary + "; failures " + (calendarReceipt.failed + historyFailures) + ". It is safe to retry; MLS did not mark this pull complete.", "err");
            else if (!includeHistory) onStatus("Schedule-only complete: " + scheduleSummary + " appointments accounted for; history was not requested.", "ok");
            else onStatus("Verified complete: schedule " + scheduleSummary + "; history " + historySummary + "; failures 0.", "ok");
            return res;
          });
        });
        });
      });
    });
  }

  function pullCalendarSelection(opts) {
    opts = opts || {};
    var onStatus = isFn(opts.onStatus) ? opts.onStatus : function () {};
    var sel = calendarSelection();
    if (!sel.ok) {
      onStatus(sel.error || "Choose a provider and day in Calendar first.", "err");
      return Promise.resolve({ ok: false, complete: false, reason: sel.reason || "calendar-selection-unverified", error: sel.error || "", source: "calendar", providerReceipt: null, scheduleReceipt: null, calendarReceipt: null, historyReceipt: null, retry: {} });
    }
    /* Freeze the exact selection before any async navigation. Changing calendar
       filters while Athena is loading cannot redirect an in-flight pull. */
    var frozenProvider = { id: sel.provider.id, name: sel.provider.name, key: sel.provider.key, rosterVerified: sel.provider.rosterVerified === true };
    var frozenDate = sel.date;
    onStatus("Pulling " + frozenProvider.name + " on " + frozenDate + "...", "");
    var includeHistory = opts.includeHistory !== false;
    return pull({ date: frozenDate, provider: frozenProvider, includeHistory: includeHistory, onStatus: onStatus }).then(function (res) {
      res = res || {};
      res.source = "calendar";
      res.requestedProvider = { id: frozenProvider.id, name: frozenProvider.name, key: frozenProvider.key, rosterVerified: frozenProvider.rosterVerified };
      return res;
    });
  }

  function revert() {
    safe(function () { window.removeEventListener("message", onSchedMsg); });
    safe(function () { if (window._importPulledSchedule && window._importPulledSchedule.__mlsSIReplaced && _prevImport) window._importPulledSchedule = _prevImport; });
    window.__mlsSI.installed = false;
  }

  function boot() {
    safe(function () { window.addEventListener("message", onSchedMsg); });
    installImport();
    /* a light retry in case a later module re-wraps _importPulledSchedule after us */
    var n = 0, iv = setInterval(function () { installImport(); if (++n > 8) clearInterval(iv); }, 1200);
  }

  window.__mlsSI = {
    installed: true,
    version: VERSION,
    asset: "feat_mls_schedimport_exact.js",
    importAppts: importAppts,
    pull: pull,
    pullCalendarSelection: pullCalendarSelection,
    calendarSelection: calendarSelection,
    _providerKey: providerKey,
    _scopeProviderRows: scopeProviderRows,
    _patientIdentity: patientIdentity,
    _appointmentIdentity: appointmentIdentity,
    _findPatient: findPatient,
    _verifiedChartCoverage: verifiedChartCoverage,
    _runHistoryBatch: runHistoryBatch,
    _lastResp: function () { return lastResp; },
    revert: revert
  };

  if (!gateOn()) { window.__mlsSI.installed = false; window.__mlsSI.gated = true; return; }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
