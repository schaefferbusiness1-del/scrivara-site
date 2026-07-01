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
 *        TARGET day (an explicit chosen day, else the day printed on the page, else EST today).
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

  var VERSION = "si-1.0.2";
  var EST_TZ = "America/New_York";

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
        out.push({ name: nm, dob: "", date: "", time: normTime(a[i].time || ""), reason: "", provider: String(a[i].provider || "") });
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

    /* target day: explicit -> page-printed date -> EST today (NO synthetic fallback) */
    var schedText = safe(function () { return (window.__schedRaw && window.__schedRaw.text) || (lastResp && lastResp.text) || ""; }, "");
    var pageDate = normDate(detectSchedDate(schedText)) || "";
    var fallbackDay = normDate(opts.date) || (window.__mlsSITarget ? normDate(window.__mlsSITarget) : "") || pageDate || estTodayKey();
    var scopeDate = opts.scopeDate ? (normDate(opts.scopeDate) || String(opts.scopeDate).slice(0, 10)) : "";

    /* Resolve EACH appointment's REAL scheduled date: its own parsed date first, then the
       date printed on the schedule page, then the requested/target day. This stops the old
       behaviour where every parsed row got one single fallback date (the whole week landing
       on today). */
    appts = appts.map(function (a) {
      var o = {}; for (var k in a) { if (a.hasOwnProperty(k)) o[k] = a[k]; }
      /* FIX 2026-07-01: the user's REQUESTED day (fallbackDay's first slot = opts.date) must
         outrank the date PRINTED on the athena page -- a week-range banner ("Week of June 28 -
         July 4, 2026") made pageDate resolve to the wrong day, so day-scoped pulls filtered
         every row out ("patients land on July 4" / "0 imported"). Per-row dates still win. */
      o._date = normDate(a.date) || fallbackDay;
      return o;
    });
    /* Day-scoped pull (Today / Tomorrow / a specific date): import ONLY that day's
       appointments, placed on that day. Never smear other days onto it. */
    if (scopeDate) appts = appts.filter(function (a) { return a._date === scopeDate; });
    if (!appts.length) {
      return Promise.resolve({ created: 0, skipped: 0, reason: scopeDate ? "none-for-day" : "empty", days: {}, target: scopeDate || fallbackDay, scope: scopeDate || "" });
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
      });

      var created = 0, skipped = 0, days = {};
      var chain = Promise.resolve();
      appts.forEach(function (a) {
        chain = chain.then(function () {
          var name = String(a.name || "").trim(); if (!name) return;
          var date = a._date || normDate(a.date) || target;   /* the resolved per-appt date */
          var nt = normTime(a.time);
          var key = apptKey(name, date, nt);
          var dayKey = "D:" + name.toLowerCase().replace(/\s+/g, " ") + "|" + date;
          if (existingKeys[key] || existingKeys[dayKey]) { skipped++; return; }
          existingKeys[key] = 1; existingKeys[dayKey] = 1;

          var ext = "", existing = null;
          safe(function () { existing = pts.find(function (x) { return String(x.name || "").trim().toLowerCase() === name.toLowerCase(); }); if (existing) ext = existing.id; });
          if (!existing && isFn(window.upsertPatient)) {
            var np = { id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, dob: String(a.dob || ""), reason: String(a.reason || ""), source: "athena-schedule", created: Date.now() };
            safe(function () { window.upsertPatient(np); pts.push(np); ext = np.id; });
          } else if (existing && a.dob && !existing.dob) { existing.dob = String(a.dob); safe(function () { window.upsertPatient(existing); }); }

          var startIso = null; if (/^\d\d:\d\d$/.test(nt)) startIso = wallToUtc(date, nt);
          var body = { name: name, dob: String(a.dob || ""), reason: String(a.reason || ""), patient_external_id: ext || null, appt_date: date, start_at: startIso };
          return safe(function () {
            return fetch(base + "/api/appointments", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) })
              .then(function (r) { if (r.ok) { created++; days[date] = (days[date] || 0) + 1; } })
              .catch(function () {});
          }, Promise.resolve());
        });
      });

      return chain.then(function () {
        return Promise.resolve(safe(function () { return isFn(window.loadCalendar) ? window.loadCalendar() : null; })).then(function () {
          window._heroNowIdx = -1;
          var todayKey = estTodayKey();
          var todays = appts.filter(function (a) { return (a._date || normDate(a.date) || target) === todayKey && String(a.name || "").trim(); });
          safe(function () { if (isFn(window._renderTodayPatients)) window._renderTodayPatients(todays); });
          safe(function () { if (window.__mlsPick && isFn(window.__mlsPick.reapply)) window.__mlsPick.reapply(); });
          safe(function () { if (window.__mlsAsst && isFn(window.__mlsAsst._renderSchedule)) window.__mlsAsst._renderSchedule(); });
          safe(function () { if (isFn(window._calLoadNextUp)) window._calLoadNextUp(); });
          return { created: created, skipped: skipped, days: days, target: target, scope: scopeDate || "" };
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
