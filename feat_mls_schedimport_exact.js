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
 *      * Dedupes (same patient + same day, any time) exactly like the original, so re-pulls are
 *        idempotent and never double-book.
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

  var VERSION = "si-1.1.0";
  var EST_TZ = "America/New_York";
  var IMPORT_INDEX_SUFFIX = "schedImportIndexV1";
  var IMPORT_DAYS_SUFFIX = "schedImportDaysV1";
  var PENDING_TTL = 5 * 60 * 1000;
  var inFlight = {};
  var knownDays = {};

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
   * Patient identity is MRN/athenaId first, otherwise normalized name + DOB;
   * appointment identity adds the authoritative appointment day. */
  function normName(s) { return String(s || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
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
  function rowMrn(a) { return normMrn(a && (a.mrn || a.athenaId || a.athena_id)); }
  function patientIdentity(a) {
    var m = rowMrn(a); if (m) return "mrn:" + m;
    return "nd:" + normName(a && a.name) + "|" + normDob(a && a.dob);
  }
  function importKey(a, date) { return patientIdentity(a) + "|" + String(date || ""); }
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
    x.rows[key] = { state: "done", patientId: String((meta && meta.patientId) || ""), appt_date: String((meta && meta.date) || ""), updated: Date.now() };
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
    if (mrn) {
      for (i = 0; i < pts.length; i++) { p = pts[i]; if (rowMrn(p) === mrn) return p; }
      if (dk) for (i = 0; i < pts.length; i++) { p = pts[i]; if (!rowMrn(p) && normName(p && p.name) === nk && normDob(p && p.dob) === dk) return p; }
      return null;
    }
    if (dk) for (i = 0; i < pts.length; i++) { p = pts[i]; if (normName(p && p.name) === nk && normDob(p && p.dob) === dk) return p; }
    for (i = 0; i < pts.length; i++) { p = pts[i]; if (normName(p && p.name) === nk) return p; }
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
  function domApptsFromResp(resp) {
    return safe(function () {
      var a = (resp && resp.appts) || [];
      var out = [];
      for (var i = 0; i < a.length; i++) {
        var nm = String((a[i] && a[i].name) || "").trim();
        if (!nm) continue;
        /* FIX 2026-07-01: keep the DOB the extension already supplies (it was mapped to ""
           here, so structured-read imports stored dob-less rows -- same dropped-field class
           as the provider bug). */
        out.push({ name: nm, dob: String(a[i].dob || ""), date: "", time: normTime(a[i].time || ""), reason: "", provider: String(a[i].provider || "") });
      }
      return out;
    }, []);
  }

  /* ---- the corrected importer. appts = [{name,dob,date,time,reason}], opts.date = target day ---- */
  function importAppts(appts, opts) {
    opts = opts || {};
    appts = (appts || []).filter(function (a) { return a && String(a.name || "").trim(); });

    if (!signedIn()) { toast("Sign in to import the schedule.", "err"); return Promise.resolve({ created: 0, skipped: 0, reason: "signin", days: {} }); }

    /* DOM-scrape fallback: if nothing parsed but the live read has structured rows, use them */
    if (!appts.length) {
      var dom = domApptsFromResp(lastResp);
      if (dom.length) appts = dom;
    }
    if (!appts.length) {
      return Promise.resolve({ created: 0, skipped: 0, reason: "empty", days: {} });
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
       Build a name -> provider map from that structured read so we can enrich every row below,
       regardless of which parse path produced it. This is what makes doctor-scoping work. */
    var respProv = {};
    safe(function () {
      var ra = (lastResp && lastResp.appts) || [];
      ra.forEach(function (x) {
        var nm = String((x && x.name) || "").trim().toLowerCase().replace(/\s+/g, " ");
        var p = String((x && x.provider) || "").trim();
        if (nm && p && !respProv[nm]) respProv[nm] = p;
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
        if (respProv[_nm]) o.provider = respProv[_nm];
      }
      return o;
    });
    /* Day-scoped pull (Today / Tomorrow / a specific date): import ONLY that day's
       appointments, placed on that day. Never smear other days onto it. */
    if (scopeDate) appts = appts.filter(function (a) { return !a._wrongDay && a._date === scopeDate; });
    else appts = appts.filter(function (a) { return !a._wrongDay && !a._badDate && !!a._date; });
    if (!appts.length) {
      return Promise.resolve({ created: 0, skipped: 0, wrongDay: wrongDay, invalidDate: invalidDate, reason: scopeDate ? "none-for-day" : (invalidDate ? "unproven-date" : "empty"), days: {}, target: scopeDate || fallbackDay, scope: scopeDate || "" });
    }
    var target = scopeDate || fallbackDay;

    /* optional provider scoping (item 5): keep only the chosen provider's rows when present */
    if (opts.provider && !/^all$/i.test(String(opts.provider))) {
      var want = String(opts.provider).trim().toLowerCase();
      var scoped = appts.filter(function (a) { return a.provider && String(a.provider).toLowerCase().indexOf(want.split(/[ ,]/)[0]) >= 0; });
      if (scoped.length) appts = scoped;   // fall back to all if the scope matched none (honest, never drops everyone)
    }

    var token = bkToken(), base = bkBase();
    var pts = (callG("getPatients") || []) || [];
    var existingKeys = {};

    return safe(function () {
      return fetch(base + "/api/appointments", { headers: { Authorization: "Bearer " + token } })
        .then(function (r) { return r.ok ? r.json() : { appointments: [] }; })
        .catch(function () { return { appointments: [] }; });
    }, Promise.resolve({ appointments: [] })).then(function (ed) {
      (ed.appointments || []).forEach(function (x) {
        var lt = ""; safe(function () { if (x.start_at) lt = new Date(x.start_at).toTimeString().slice(0, 5); });
        var ld = x.appt_date || ""; if (!ld) safe(function () { if (x.start_at) { var dd = new Date(x.start_at); ld = dd.getFullYear() + "-" + ("0" + (dd.getMonth() + 1)).slice(-2) + "-" + ("0" + dd.getDate()).slice(-2); } });
        existingKeys[apptKey(x.name, ld, lt)] = 1;
        existingKeys["D:" + String(x.name || "").trim().toLowerCase().replace(/\s+/g, " ") + "|" + ld] = 1;
        var linked = null;
        safe(function () { linked = pts.find(function (p) { return String(p && p.id || "") === String(x.patient_external_id || ""); }); });
        existingKeys["I:" + importKey(linked || x, ld)] = 1;
      });

      var created = 0, skipped = 0, failed = 0, days = {};
      var onEach = isFn(opts.onEach) ? opts.onEach : null;   /* task-1: per-appointment status callback */
      var chain = Promise.resolve();
      appts.forEach(function (a) {
        chain = chain.then(function () {
          var name = String(a.name || "").trim(); if (!name) return;
          if (onEach) safe(function () { onEach("patient", { name: name }); });
          var date = a._date || normDate(a.date) || target;   /* the resolved per-appt date */
          var nt = normTime(a.time);
          if (onEach) safe(function () { onEach("fields", { name: name, time: nt, provider: String(a.provider || "") }); });
          var key = apptKey(name, date, nt);
          var dayKey = "D:" + name.toLowerCase().replace(/\s+/g, " ") + "|" + date;
          var ledgerKey = importKey(a, date);
          if (onEach) safe(function () { onEach("dedupe", { name: name }); });
          if (existingKeys[key] || existingKeys[dayKey] || existingKeys["I:" + ledgerKey]) {
            markDone(ledgerKey, { date: date }); skipped++; if (onEach) safe(function () { onEach("skipped", { name: name }); }); return;
          }
          var owner = claim(ledgerKey, { date: date });
          if (!owner) { skipped++; if (onEach) safe(function () { onEach("skipped", { name: name }); }); return; }
          existingKeys[key] = 1; existingKeys[dayKey] = 1;

          var ext = "", existing = null;
          safe(function () { existing = findPatient(pts, a); if (existing) ext = existing.id; });
          if (!existing && isFn(window.upsertPatient)) {
            var np = { id: stableId(patientIdentity(a)), name: name, dob: String(a.dob || ""), reason: String(a.reason || ""), source: "athena-schedule", created: Date.now() };
            if (rowMrn(a)) { np.athenaId = String(a.mrn || a.athenaId || a.athena_id || ""); np.mrn = np.athenaId; }
            safe(function () { window.upsertPatient(np); ext = np.id; if (!findPatient(pts, np)) pts.push(np); });
          } else if (existing) {
            var dirty = false;
            if (a.dob && !existing.dob) { existing.dob = String(a.dob); dirty = true; }
            if (rowMrn(a) && !rowMrn(existing)) { existing.athenaId = String(a.mrn || a.athenaId || a.athena_id || ""); if (!existing.mrn) existing.mrn = existing.athenaId; dirty = true; }
            if (dirty) safe(function () { window.upsertPatient(existing); });
          }

          var startIso = null; if (/^\d\d:\d\d$/.test(nt)) startIso = wallToUtc(date, nt);
          /* FIX 2026-07-01: carry the per-appointment PROVIDER into storage. The extension
             supplies it (a.provider e.g. "Matthew Schaeffer, MD") and the backend has a
             provider column, but it was being dropped here -> every stored appt had provider
             null -> doctor-scoped "Who's Next" excluded them (matchesDoctor returns false on
             an empty provider) and showed a stale set instead. This is the "doctors assigned
             to their correct patients" fix. */
          var body = { name: name, dob: String(a.dob || ""), reason: String(a.reason || ""), provider: String(a.provider || ""), patient_external_id: ext || null, appt_date: date, start_at: startIso };
          if (onEach) safe(function () { onEach("save", { name: name }); });
          return safe(function () {
            return fetch(base + "/api/appointments", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) })
              .then(function (r) {
                if (r.ok) { markDone(ledgerKey, { patientId: ext, date: date }); created++; days[date] = (days[date] || 0) + 1; if (onEach) safe(function () { onEach("saved", { name: name }); }); }
                else { rollback(ledgerKey, owner, date); failed++; if (onEach) safe(function () { onEach("error", { name: name, error: "HTTP " + r.status }); }); }
              })
              .catch(function () { rollback(ledgerKey, owner, date); failed++; if (onEach) safe(function () { onEach("error", { name: name, error: "network" }); }); });
          }, null) || (rollback(ledgerKey, owner, date), Promise.resolve());
        });
      });

      /* FIX 2026-07-01: build a name+date -> provider map from what we just imported, so we can
         re-stamp provider onto the in-memory calendar AFTER loadCalendar (the backend may not
         echo provider back on already-existing rows, and older rows were stored provider-null).
         In-memory only -- never modifies a backend appointment record. */
      var provByKey = {};
      appts.forEach(function (a) {
        var p = String(a.provider || "").trim(); if (!p) return;
        var nm = String(a.name || "").trim().toLowerCase().replace(/\s+/g, " ");
        var dt = a._date || normDate(a.date) || target;
        if (nm && dt) provByKey[nm + "|" + dt] = p;
      });
      function stampProviders() {
        safe(function () {
          var cal = window._calAppts; if (!Array.isArray(cal)) return;
          for (var i = 0; i < cal.length; i++) {
            var r = cal[i]; if (!r || (r.provider && String(r.provider).trim())) continue;
            var nm = String(r.name || "").trim().toLowerCase().replace(/\s+/g, " ");
            var dt = r.appt_date || (r.start_at ? new Date(r.start_at).toISOString().slice(0, 10) : "");
            var p = provByKey[nm + "|" + dt];
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
          return { created: created, skipped: skipped, failed: failed, wrongDay: wrongDay, invalidDate: invalidDate, days: days, target: target, scope: scopeDate || "" };
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
  function bridge(type, reqType, timeoutMs) {
    return new Promise(function (res) {
      var done = false;
      function on(e) { if (!(e.data && e.data.source === "mls-ext")) return; if (e.data.type === type) { done = true; window.removeEventListener("message", on); res(e.data.resp || e.data || null); } }
      window.addEventListener("message", on);
      safe(function () { window.postMessage({ source: "mls-app", type: reqType }, "*"); });
      setTimeout(function () { if (!done) { window.removeEventListener("message", on); res(null); } }, timeoutMs || 12000);
    });
  }

  function pull(opts) {
    opts = opts || {};
    var date = opts.date || estTodayKey();
    var onStatus = isFn(opts.onStatus) ? opts.onStatus : function () {};
    /* FIX 2026-07-01: stamp "a user pull is in flight" so the connection prober pauses --
       the extension bridge has no request ids, so probe replies and pull replies can cross. */
    window.__mlsPullBusyAt = Date.now();
    if (!signedIn()) { onStatus("Sign in to import the schedule.", "err"); return Promise.resolve({ created: 0, reason: "signin" }); }

    onStatus("Looking for MLS Assist...", "");
    return bridge("mlsPong", "mlsPing", 3500).then(function (pong) {
      if (!pong) { onStatus("MLS Assist isn't responding. Enable it and open your athenaOne Day schedule, then try again.", "err"); return { created: 0, reason: "no-ext" }; }
      onStatus("Reading your athenaOne Day schedule...", "");
      return bridge("mlsAppScheduleResult", "mlsAppPullSchedule", 30000).then(function (r) {
        if (!r || !r.ok || !r.text) { onStatus((r && r.error) || "Couldn't read your athenaOne tab. Open your Day schedule and try again.", "err"); return { created: 0, reason: "no-read" }; }
        lastResp = r;
        safe(function () { window.__schedRaw = { text: r.text || "", url: r.url || "", frames: r.frames }; });
        onStatus("Finding patients on " + date + "...", "");
        return Promise.resolve(safe(function () { return isFn(window._parseScheduleText) ? window._parseScheduleText(r.text) : []; }, [])).then(function (parsed) {
          parsed = Array.isArray(parsed) ? parsed : [];
          /* keep each appt OWN parsed date; importAppts scopes to `date` and files each
             appointment on its real day -- no whole-week-onto-one-day smear. */
          var rows = parsed.map(function (a) { return { name: a.name, dob: a.dob || "", date: a.date || "", time: a.time || "", reason: a.reason || "" }; });
          return importAppts(rows, { date: date, scopeDate: date, provider: opts.provider }).then(function (res) {
            if (res.created > 0) onStatus("Imported " + res.created + " appointment" + (res.created === 1 ? "" : "s") + " for " + date + ".", "ok");
            else if (res.skipped > 0) onStatus("Those " + res.skipped + " appointment" + (res.skipped === 1 ? " is" : "s are") + " already on your calendar for " + date + ".", "");
            else onStatus("No patients scheduled for " + date + " in your open athenaOne tab. Open that day Day schedule (the patient grid) and pull again.", "err");
            /* also pull each patient's chart history in the background (non-blocking) */
            /* FIX 2026-07-01: 'forced' was an undefined variable -- the ReferenceError was
               swallowed by safe(), so chart histories were NEVER pulled after a day pull. */
            safe(function () { if (isFn(window._pullAllHistories)) window._pullAllHistories(false); });
            return res;
          });
        });
      });
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
    _lastResp: function () { return lastResp; },
    revert: revert
  };

  if (!gateOn()) { window.__mlsSI.installed = false; window.__mlsSI.gated = true; return; }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
