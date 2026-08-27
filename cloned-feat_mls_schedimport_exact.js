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

  var VERSION = "si-1.7.22-p1-census1";
  /* p1-census-1.0.0: private capability tokens keep the provider-unknown
     appointment-census exception inside the guarded Day lane. An exported
     direct import, a month pull, or a caller-supplied option cannot opt itself
     into this path. The exception never invents a provider: it only permits
     exact appointment-id rows to be stored with provider deliberately blank. */
  var P1_DAY_CENSUS_TOKEN = {};
  var P1_CENSUS_IMPORT_TOKEN = {};
  /* Diagnostics cross a copy/support boundary, so reason keys are a closed
     vocabulary rather than merely "identifier-looking" strings. A patient
     name, MRN, or source id must collapse to the generic bucket even when it
     happens to contain only letters, numbers, or hyphens. */
  var CALENDAR_REASON_CODES = {
    "calendar-row-unverified": 1,
    "calendar-read-unverified": 1,
    "appointment-patient-identity-conflict": 1,
    "appointment-enrichment-ambiguous": 1,
    "slot-patient-identity-conflict": 1,
    "patient-not-resolved": 1,
    "appointment-identity-unresolved": 1,
    "appointment-source-identity-conflict": 1,
    "appointment-update-http": 1,
    "appointment-update-network": 1,
    "source-identity-missing": 1,
    "backend-id-missing": 1,
    "patient-id-missing": 1,
    "mapping-unresolved": 1,
    "ledger-backend-day-mismatch": 1,
    "import-in-flight": 1,
    "appointment-create-http": 1,
    "appointment-create-network": 1,
    "appointment-create-dispatch-failed": 1
  };
  var EST_TZ = "America/New_York";
  /* si-1.7.7: answering-extension version (from this pull's pong) and the
     site-published current version — used ONLY to explain receipt-gate
     failures on machines running an outdated MLS Assist. */
  var extPong = { version: "" };
  var publishedExt = { v: "", at: 0 };
  function verLess(a, b) {
    /* unparseable/missing on either side: never claim outdated */
    if (!/^\d+(\.\d+)*$/.test(String(a || "")) || !/^\d+(\.\d+)*$/.test(String(b || ""))) return false;
    var A = String(a).split(".").map(Number), B = String(b).split(".").map(Number);
    for (var i = 0; i < Math.max(A.length, B.length); i++) {
      var x = A[i] || 0, y = B[i] || 0;
      if (x !== y) return x < y;
    }
    return false;
  }
  function fetchPublishedExtVersion() {
    if (publishedExt.v && Date.now() - publishedExt.at < 6 * 3600 * 1000) return;
    safe(function () {
      fetch("extension-version.json?ts=" + Date.now(), { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
        var v = String(j && j.version || "").trim();
        if (v) publishedExt = { v: v, at: Date.now() };
      }).catch(function () {});
    });
  }
  var IMPORT_INDEX_SUFFIX = "schedImportIndexV1";
  var IMPORT_DAYS_SUFFIX = "schedImportDaysV1";
  var AUTHORITATIVE_SNAPSHOT_SUFFIX = "schedAuthoritativeDaysV1";
  /* p1-census-display-1.0.0: provider-unknown pulls own only the exact
     appointment IDs painted on one Athena day. Keep that display proof in a
     separate, PHI-free store; it must never satisfy provider/practice
     authority checks. */
  var APPOINTMENT_CENSUS_DISPLAY_SUFFIX = "p1SchedAppointmentCensusDaysV1";
  var PENDING_TTL = 5 * 60 * 1000;
  var inFlight = {};
  var knownDays = {};
  var historyBatchRunning = false;
  var pullRunning = false;
  var lastPullResult = null;

  /* A hidden MLS tab can have its window timers throttled to effectively zero.
     Keep pull deadlines in one dedicated Worker when the browser permits it;
     the window-timer branch is only a compatibility fallback. Every caller
     supplies an absolute timestamp, so no relay can accidentally extend a
     patient read by starting a fresh relative timeout. */
  function makeAbsoluteDeadlineScheduler() {
    var seq = 0, pending = {}, worker = null, workerUrl = "";
    function armWindowFallback(entry) {
      if (!entry || !entry.active || entry.timer != null) return !!(entry && entry.active);
      if (entry.deadlineAt <= Date.now()) { entry.fire(); return false; }
      try {
        entry.timer = setTimeout(entry.fire, Math.max(0, entry.deadlineAt - Date.now()));
        if (entry.active && entry.deadlineAt <= Date.now()) {
          try { clearTimeout(entry.timer); } catch (e) {}
          entry.timer = null; entry.fire(); return false;
        }
        return true;
      } catch (e) {
        /* If even the compatibility timer cannot be armed, fail this request
           synchronously. arm() exposes that terminal state so its caller can
           refuse to dispatch the stateful browser operation afterward. */
        entry.fire();
        return false;
      }
    }
    function failWorker() {
      /* A Worker transport failure is not itself the request deadline. Move
         every live arm to a window timer using its ORIGINAL absolute time;
         firing callbacks here would settle a request early and its caller
         could still dispatch the stateful operation after arm() returned. */
      var failedWorker = worker;
      worker = null;
      try { if (failedWorker) failedWorker.onerror = null; } catch (e) {}
      try { if (failedWorker) failedWorker.terminate(); } catch (e) {}
      Object.keys(pending).forEach(function (id) {
        var entry = pending[id];
        if (entry && entry.active) armWindowFallback(entry);
      });
    }
    try {
      if (typeof Worker === "function" && typeof Blob === "function" && window.URL && isFn(window.URL.createObjectURL)) {
        workerUrl = window.URL.createObjectURL(new Blob([
          "var t={};onmessage=function(e){var d=e.data||{},id=String(d.id||'');" +
          "if(d.action==='cancel'){if(t[id]){clearTimeout(t[id]);delete t[id];}return;}" +
          "if(d.action!=='arm'||!id)return;if(t[id])clearTimeout(t[id]);" +
          "var ms=Math.max(0,Number(d.deadlineAt||0)-Date.now());" +
          "t[id]=setTimeout(function(){delete t[id];postMessage({id:id});},ms);};"
        ], { type: "text/javascript" }));
        worker = new Worker(workerUrl);
        worker.onmessage = function (event) {
          var id = String(event && event.data && event.data.id || ""), entry = pending[id];
          if (!entry) return;
          try { entry.fire(); } catch (e) {}
        };
        worker.onerror = failWorker;
      }
    } catch (e) { worker = null; }
    function arm(deadlineAt, callback) {
      var at = Number(deadlineAt || 0);
      if (!isFinite(at) || at <= 0) at = Date.now();
      var id = "mls-deadline-" + (++seq) + "-" + Date.now().toString(36);
      var entry = { id: id, deadlineAt: at, timer: null, active: true, fire: null, cancel: null };
      function fire() {
        if (!entry.active) return;
        entry.active = false; delete pending[id];
        if (entry.timer != null) { try { clearTimeout(entry.timer); } catch (e) {} entry.timer = null; }
        callback();
      }
      function cancel() {
        if (!entry.active) return;
        entry.active = false; delete pending[id];
        if (entry.timer != null) { try { clearTimeout(entry.timer); } catch (e) {} entry.timer = null; }
        if (worker) { try { worker.postMessage({ action: "cancel", id: id }); } catch (e) {} }
      }
      cancel.isTerminal = function () { return !entry.active; };
      entry.fire = fire; entry.cancel = cancel; pending[id] = entry;
      if (at <= Date.now()) {
        fire();
      } else if (worker) {
        try { worker.postMessage({ action: "arm", id: id, deadlineAt: at }); }
        catch (e) { failWorker(); }
      } else armWindowFallback(entry);
      return cancel;
    }
    function destroy() {
      Object.keys(pending).forEach(function (id) { var entry = pending[id]; if (entry && entry.cancel) entry.cancel(); });
      if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
      if (workerUrl && window.URL && isFn(window.URL.revokeObjectURL)) { try { window.URL.revokeObjectURL(workerUrl); } catch (e) {} }
      workerUrl = "";
    }
    return { arm: arm, destroy: destroy, workerBacked: function () { return !!worker; } };
  }
  var absoluteDeadlines = makeAbsoluteDeadlineScheduler();
  safe(function () { window.__mlsAbsoluteDeadline = absoluteDeadlines; });

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function gfn(n) { return safe(function () { return isFn(window[n]) ? window[n] : null; }, null); }
  function callG(n, a, b, c) { var f = gfn(n); return f ? safe(function () { return f(a, b, c); }) : undefined; }

  /* Managed schedule/history pulls can update many patient rows within one
     short result burst. The base store owns the account-scoped shadow and all
     durability rules; this feature only brackets its own workflow and forces
     durable checkpoints after schedule import and at every terminal outcome. */
  function patientBatchApi() {
    return safe(function () {
      var api = window.__mlsPatientStoreBatch;
      return api && isFn(api.begin) && isFn(api.checkpoint) && isFn(api.end) ? api : null;
    }, null);
  }
  function beginPatientBatch(label) {
    var api = patientBatchApi();
    /* One logical chart can enrich the same patient through several guarded
       layers. Count unique patients, retain the 15s durability timer, and let
       the base store encode the one required roster checkpoint in its worker.
       The forced pre-history and terminal barriers are still awaited. */
    return api ? api.begin({ label: String(label || "managed-pull"), cooperative: true, maxChanges: 64, maxDelayMs: 15000 }) : null;
  }
  function checkpointPatientBatch(token, reason, force) {
    if (!token) return null;
    var api = patientBatchApi();
    return api ? api.checkpoint(token, String(reason || "checkpoint"), force === true) : null;
  }
  function endPatientBatch(token, reason) {
    if (!token) return { batched: false };
    var api = patientBatchApi();
    return api ? api.end(token, String(reason || "end")) : { batched: false };
  }
  function withPatientBatch(label, task) {
    var token = beginPatientBatch(label);
    return Promise.resolve().then(function () { return task(token); }).then(function (value) {
      return Promise.resolve(endPatientBatch(token, "receipt")).then(function (receipt) {
        if (value && typeof value === "object") value.patientPersistenceReceipt = receipt;
        return value;
      });
    }, function (error) {
      var ended;
      try { ended = endPatientBatch(token, "error"); }
      catch (flushError) { try { flushError.originalError = String(error && error.message || error || "").slice(0, 180); } catch (_) {} throw flushError; }
      return Promise.resolve(ended).then(function () { throw error; }, function (flushError) {
        try { flushError.originalError = String(error && error.message || error || "").slice(0, 180); } catch (_) {}
        throw flushError;
      });
    });
  }

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
  /* p1-date-guard-1.0: backend start_at is an instant, while every pull
     receipt is an account-wall date. Never use the browser's local zone for
     this fallback: a UTC-midnight row can otherwise move to the adjacent day
     on a clinician's device. If the account-zone conversion cannot be proven,
     return an empty date and let the existing exact-day gates refuse it. */
  function accountDayFromInstant(value) {
    try {
      var instant = new Date(value);
      if (!isFinite(instant.getTime()) || !Intl || !isFn(Intl.DateTimeFormat)) return "";
      var parts = new Intl.DateTimeFormat("en-US", { timeZone: EST_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant), y = "", m = "", d = "";
      parts.forEach(function (part) { if (part.type === "year") y = part.value; else if (part.type === "month") m = part.value; else if (part.type === "day") d = part.value; });
      return /^\d{4}$/.test(y) && /^\d{2}$/.test(m) && /^\d{2}$/.test(d) ? y + "-" + m + "-" + d : "";
    } catch (eAccountDay) { return ""; }
  }
  function normDate(d) { var f = gfn("_normDate"); return f ? (f(d) || "") : String(d || "").slice(0, 10); }
  /* ===== fd-1.0.0 (a future day has no note to read) =====
     MEASURED on the owner's PRODUCTION pull 2026-08-17/18 (b1027, ext 3.0.62,
     bodies OFF): pulling TOMORROW, every row spent 60-80 s inside the day-note
     leg and the batch sat at "Reading verified history 2 of 14" for >75 s.
     There is no encounter on a day that has not happened, so this is the
     slowness AND the "0 ok" the owner sees. The account day key is the only
     honest "today" (never the browser zone); if it cannot be proven this fails
     OPEN toward reading the note, because reading a note that exists is always
     safer than skipping one that does. TODAY and every PAST day are unchanged. */
  function acctTodayKey() {
    var f = gfn("_acctTodayKey");
    var k = f ? safe(function () { return String(f() || ""); }, "") : "";
    if (k) return k;
    return safe(estTodayKey, "") || "";
  }
  function dayNoteFuture(dayKey) {
    var d = normDate(dayKey || "") || "";
    var t = acctTodayKey();
    /* ISO yyyy-mm-dd keys order correctly as strings. */
    return !!(d && t && d > t);
  }
  /* ===== end fd-1.0.0 ===== */
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
  /* A TITLE is never a surname; a CREDENTIAL can be. "Dr"/"Doctor" only ever
     precede a name, so they are always noise. "Do", "Pa", "Rn", "Ot", "Od" are
     real surnames in a pain practice AND real credentials, and which one they
     are depends on whether the name can spare them. */
  var PROVIDER_TITLE = { dr: 1, doctor: 1 };
  function providerKey(raw) {
    var s = String(raw == null ? "" : raw).trim().toLowerCase();
    if (!s || /^all(?:\s+providers?)?$/.test(s)) return "";
    s = safe(function () { return s.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""); }, s);
    var seen = {}, all = s.replace(/[_/]+/g, " ").replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(function (t) {
      if (!t || PROVIDER_TITLE[t] || seen[t]) return false;
      seen[t] = 1; return true;
    });
    /* A CLINICIAN WHOSE SURNAME SPELLS A CREDENTIAL COULD NEVER PULL.
       Every credential-spelled token was stripped unconditionally and the
       result then had to hold two survivors, so "Anh Do", "Sam Pa" and
       "Lee Rn" all keyed to "" and failed at provider-unverified \u2014 100% of
       their selected-provider imports, since the day this shipped. Measured
       by the ext-goal lane, 2026-08-06.
       Credentials are stripped only while the name can SPARE them: if
       removing them would leave fewer than two identifying tokens, the token
       was carrying name weight and is kept. This CANNOT widen matching \u2014 the
       key either gains a token it already had in the raw label, or is
       unchanged. Proven unchanged on every existing shape:
         "Anh Thi Do" -> anh|thi        (credential genuinely spare)
         "Matthew Schaeffer, MD" -> matthew|schaeffer
         "Schaeffer_Matthew_MD" / "Schaeffer, Matthew" -> same key
         "John Smith DO" -> john|smith  "Sam Parker PA" -> parker|sam
       and newly resolvable, without colliding with anyone:
         "Anh Do" -> anh|do   "Dr. Anh Do" -> anh|do   "Anh Doe" -> anh|doe
       A label that is ONLY a credential still refuses: "Dr Do" and "MD" -> "". */
    var stripped = all.filter(function (t) { return !PROVIDER_NOISE[t]; });
    var tokens = stripped.length >= 2 ? stripped : all;
    if (tokens.length < 2) return "";
    tokens = tokens.slice().sort();
    return tokens.join("|");
  }
  /* mdx-2.0.2: the credential portion of a provider label, for the same-name
     echo test in scopeProviderRows.

     A BARE SURNAME IS NOT A CREDENTIAL JUST BECAUSE IT SPELLS ONE. "Dr. Anh Do"
     is a real surname in a pain practice, as are Ot, Od, Rn and Pa. mdx-2.0.0
     read the credential two ways that both got this wrong: it trusted the
     roster's `equivalentKey` credential segment (whose parse yields
     "anh thi|do", i.e. Do-as-credential), and its own fallback accepted ANY
     trailing credential-spelled token. Measured: a clinician named "Anh Thi
     Do" produced signatures {"do","md"} across her OWN two roster entries,
     tripped credential-conflict, and was blocked from 100% of her
     selected-provider imports - the same "gate whose condition can never be
     satisfied on that machine" shape as the defect this file just fixed, one
     axis over (QA lane, 2026-08-06).

     So a credential is only ASSERTED when an explicit delimiter separates it
     from the name: a comma ("Anh Thi Do, MD") or the underscore of athena's
     machine username ("Schaeffer_Matthew_MD"). A plain space does not qualify.
     Empty means "no credential stated" and conflicts with nothing, so this
     errs toward silence rather than toward inventing a second clinician -
     while still catching the case that matters, a delimited MD standing beside
     a DO. Keeping the underscore is load-bearing: a comma-only rule would let
     two REAL clinicians through in athena's machine-username form. Titles
     ("Dr") never count: a title cannot distinguish two humans.

     NOT FIXED HERE, deliberately: `providerKey("Anh Do")` returns "" (both
     tokens are stripped as noise, leaving fewer than two), so a TWO-token
     credential-surname clinician fails earlier still, at provider-unverified.
     That lives in PROVIDER_NOISE, predates this work, and feeds every matching
     surface in the app - it is reported, not patched mid-flight. */
  var PROVIDER_CRED_TOKENS = {
    md: 1, do: 1, np: 1, pa: 1, pac: 1, aprn: 1, fnp: 1, fnpc: 1, dnp: 1,
    rn: 1, crnp: 1, cnp: 1, dpm: 1, dds: 1, dmd: 1, phd: 1, mbbs: 1, od: 1
  };
  function providerCredentialSignature(entry) {
    /* Read the DISPLAY NAME only. equivalentKey is deliberately not consulted:
       its credential segment is exactly the parse that mistakes a surname for
       a credential. */
    var raw = String(entry && entry.name || "").toLowerCase();
    var tail = raw.split(/[,_/]/);
    if (tail.length < 2) return "";                 /* no explicit delimiter -> nothing asserted */
    var sig = [];
    for (var i = tail.length - 1; i >= 1; i--) {
      var seg = tail[i].replace(/[^a-z0-9]+/g, " ").split(/\s+/).filter(Boolean);
      if (!seg.length) continue;
      var all = true;
      for (var j = 0; j < seg.length; j++) {
        var t = seg[j];
        if (t === "c") continue;                    /* the "-C" tail of PA-C */
        if (PROVIDER_CRED_TOKENS[t] !== 1) { all = false; break; }
        if (sig.indexOf(t) < 0) sig.push(t);
      }
      if (!all) break;
    }
    sig.sort();
    return sig.join("+");
  }
  function providerRequest(raw) {
    var obj = raw && typeof raw === "object" ? raw : null;
    var name = String(obj ? (obj.name || obj.displayName || obj.provider || "") : (raw || "")).trim();
    var id = obj && obj.id != null ? String(obj.id) : "";
    var stableKey = obj ? String(obj.stableKey || obj.stable_key || "") : "";
    var providerRaw = obj ? String(obj.raw || obj.provider_raw || obj.provider || name || "") : String(raw || "");
    var rosterVerified = !!(obj && obj.rosterVerified === true && (id || stableKey));
    var detectedOnly = !!(obj && obj.detectedOnly === true && (id || stableKey));
    if (!name || /^all(?:\s+(?:providers?|doctors?))?$/i.test(name)) return { mode: "all", name: "All providers", id: id, stableKey: stableKey, raw: providerRaw, key: "", rosterVerified: rosterVerified, detectedOnly: false };
    return { mode: "selected", name: name, id: id, stableKey: stableKey, raw: providerRaw, key: providerKey(name), rosterVerified: rosterVerified, detectedOnly: detectedOnly };
  }
  /* Every selected-provider route shares this one gate. A display name or an
     appointment-derived provider list is never a roster. The canonical roster
     must carry a complete Athena sweep receipt, then the selected stable
     identity must resolve exactly. All-provider day pulls are the sole
     exception: they are permitted to read the day, but scopeProviderRows below
     still requires the complete two-dimensional schedule receipt and provider
     attribution on every returned row. Month-wide All requires the canonical
     roster too because it spans multiple independently navigated days. */
  function resolveProviderRequest(raw, opts) {
    opts = opts || {};
    var req = providerRequest(raw);
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    var receipt = roster && isFn(roster.getReceipt) ? safe(function () { return roster.getReceipt(); }, null) : null;
    function no(reason, error) { return { ok: false, complete: false, reason: reason, error: error, request: req, provider: null, receipt: receipt }; }
    if (req.mode === "all") {
      if (opts.allowAll !== true) return no("provider-required", "Choose one verified provider first.");
      if (opts.requireRosterForAll === true && !(receipt && receipt.complete === true)) {
        return no("provider-roster-incomplete", "The full Athena provider roster is not verified yet. Re-pull the Day schedule and retry.");
      }
      return { ok: true, complete: true, request: req, provider: "all", receipt: receipt };
    }
    var rosterComplete = !!(receipt && receipt.complete === true && receipt.partial !== true);
    if (!(roster && isFn(roster.resolve))) {
      return no("provider-roster-incomplete", "No Athena providers have been detected yet. Keep the Day schedule open, refresh providers, and retry.");
    }
    var entry = safe(function () { return roster.resolve(raw); }, null);
    if (!entry || !entry.name || !entry.stableKey) {
      return no("provider-unverified", "That provider is not uniquely present in the detected Athena list. Choose the clinician again.");
    }
    /* p1-detected-provider-1.0.0: the installed extension can enumerate every
       provider header painted in the current Athena Day view even when that
       legacy view cannot prove a practice-wide roster. Those exact, uniquely
       resolved entries are useful routing choices, but they are not promoted
       to a verified full roster. Only the 1p guarded day/month callers opt in
       to this provisional route. The fresh, request-bound schedule read below
       must still show the selected identity and scopeProviderRows must prove
       every imported row belongs to it. Thus this enables a real detected
       clinician without ever widening a selected request or guessing across
       an ambiguous multi-header/columnless grid. */
    var detectedOnly = !rosterComplete;
    if (detectedOnly && opts.allowDetectedProvider !== true) {
      return no("provider-roster-incomplete", "That clinician was detected in Athena, but this pull route requires a fully verified roster. Use the guarded Day pull instead.");
    }
    var resolved = {
      id: entry.id != null ? String(entry.id) : "",
      stableKey: String(entry.stableKey),
      raw: String(entry.raw || entry.name),
      name: String(entry.name),
      key: providerKey(entry.name),
      rosterVerified: !detectedOnly,
      detectedOnly: detectedOnly
    };
    if (!providerKey(resolved.name)) return no("provider-unverified", "That provider identity is incomplete or ambiguous.");
    return { ok: true, complete: true, request: providerRequest(resolved), provider: resolved, receipt: receipt };
  }
  function providerDiagLabels(resp, rows) {
    var labels = [], seen = {};
    function add(v) {
      v = String(v || "").trim(); var k = providerKey(v);
      if (!v || !k || seen[v.toLowerCase()]) return;
      seen[v.toLowerCase()] = 1; labels.push(v);
    }
    safe(function () { (resp && resp.providers || []).forEach(add); });
    safe(function () { (resp && resp.providerRoster || []).forEach(function (p) { add(p && (p.name || p.raw || p.provider)); }); });
    safe(function () { (resp && resp.providerDiag && resp.providerDiag.providerNames || []).forEach(add); });
    safe(function () { add(resp && resp.providerDiag && resp.providerDiag.providerFillScope); });
    safe(function () { add(resp && resp.providerDiag && resp.providerDiag.dom && resp.providerDiag.dom.singleProviderName); });
    safe(function () { add(resp && resp.providerDiag && resp.providerDiag.text && resp.providerDiag.text.singleProviderName); });
    (rows || []).forEach(function (r) { add(r && r.provider); });
    return labels;
  }
  /* sfp-1.0.0 STALENESS DISCLOSURE -------------------------------------------
     The extension's schedule read is a pure DOM scrape of an ALREADY-PAINTED
     athenaOne grid. It contacts athena's servers ZERO times, so it returns the
     same rows whether the athenaOne session is alive or died hours ago. The
     navigation step before it proves nothing either: it verifies the day by
     re-reading the painted `.calendar-nav` week strip, and for a TODAY pull it
     compares the selected tab against the BROWSER's clock - a check a stale
     painted strip passes without athena serving anything.

     ext 3.0.21 therefore reports how old the painted grid is, and whether it
     ever saw athena's server actually serve this tab (receipt.sessionProof).
     This turns that into one plain sentence for the clinician.

     THREE RULES, each learned from a defect in this repo:
       1. It NEVER refuses and NEVER touches `complete`. A pull that works today
          still works; it just stops claiming the rows are current when nothing
          proved they are.
       2. An ABSENT signal reads as "not stated", never as "fresh". An older
          extension sends no sessionProof at all, and a missing field must not
          be silently upgraded into a clean bill of health.
       3. It says what is known and nothing more. "MLS saw no sign your session
          served anything" is true; "you are signed out" would be a guess. */
  function freshnessNotice(resp) {
    var sp = (resp && (resp.sessionProof || (resp.receipt && resp.receipt.sessionProof))) || null;
    if (!sp) return "";                        /* extension predates sfp-1.0.0 */
    if (sp.staleRisk === "fresh") return "";
    var age = Number(sp.dataAgeMs);
    if (sp.staleRisk === "stale" && isFinite(age) && age > 0) {
      var mins = Math.round(age / 60000);
      var howLong = mins >= 120 ? (Math.round(mins / 60) + " hours") : (mins + " minute" + (mins === 1 ? "" : "s"));
      return " Heads up: these rows are what athenaOne had on screen " + howLong
        + " ago, and MLS saw no sign athenaOne served that tab since. Refresh the Day schedule in athenaOne and pull again to be sure nothing was cancelled, added or moved.";
    }
    return " Heads up: MLS could not confirm how current the athenaOne schedule was when it read it. Refresh the Day schedule in athenaOne and pull again if anything looks out of date.";
  }
  function freshnessReceipt(resp) {
    var sp = (resp && (resp.sessionProof || (resp.receipt && resp.receipt.sessionProof))) || null;
    if (!sp) return { stated: false, staleRisk: "not-reported", dataAgeMs: null, liveSessionProven: null, proofVia: "" };
    return {
      stated: true,
      staleRisk: String(sp.staleRisk || "unproven"),
      dataAgeMs: (sp.dataAgeMs == null ? null : Number(sp.dataAgeMs)),
      liveSessionProven: !!sp.liveSessionProven,
      proofVia: String(sp.proofVia || ""),
      proofAgeMs: (sp.proofAgeMs == null ? null : Number(sp.proofAgeMs))
    };
  }
  /* prs-1.0.0 PROVIDER-SCOPE DISCLOSURE ---------------------------------------
     "All providers" has never meant all providers. Both roster receipts in
     background.js derive `complete` from the athenaOne Day grid that happened
     to be PAINTED: observed>0, the horizontal sweep reached its end, bounds
     stable, scroll restored. Measured on the owner's tab 2026-07-26 (b688):
     `{complete:true, expectedCount:1, observedCount:1, providerMode:"all"}`
     over a ONE-column grid, while the app's own calendar listed 18 providers.
     So an "all providers" day pull silently covered one clinician and reported
     day-complete.

     Same three rules the staleness notice follows, for the same reasons:
       1. It NEVER refuses and NEVER touches `complete`. The pull works; it just
          stops implying a coverage it did not measure.
       2. An ABSENT roster module reads as "not stated", never as "all".
       3. It says only what is known: how many providers MLS knows of, how many
          athenaOne actually painted, and that athenaOne's own provider list has
          not been enumerated. "You are missing 17 providers" would be a guess. */
  function providerScope() {
    return safe(function () {
      var api = window.__mlsProviderRoster;
      return api && isFn(api.getScope) ? api.getScope() : null;
    }, null);
  }
  function providerScopeNotice(providerMode) {
    if (providerMode !== "all") return "";
    var sc = providerScope();
    if (!sc) return "";                    /* older page bundle: say nothing rather than "all" */
    if (sc.scopeComplete === true) return "";
    var known = Number(sc.knownCount || 0), painted = Number(sc.gridSweptCount || 0);
    if (known > painted && painted > 0) {
      return " Note on coverage: athenaOne's Day view showed " + painted + " provider"
        + (painted === 1 ? "" : "s") + " and that is who this pull covered, but MLS knows of "
        + known + " provider" + (known === 1 ? "" : "s") + " in this practice. To pull the others, "
        + "switch athenaOne's Day view to show them (or pick each one in Choose a provider) and pull again.";
    }
    return " Note on coverage: this covered the " + (painted || known) + " provider"
      + ((painted || known) === 1 ? "" : "s") + " athenaOne's Day view had on screen. MLS has never read "
      + "athenaOne's own provider list, so it cannot confirm that is everyone.";
  }
  /* b752: say the census out loud. The doctor was shown
     the terminal verdict sentence reading schedule 19/19, history 19/19,
     failures 0 for a pull that wrote zero characters, and no wording tweak
     to a walk count could have prevented it - the number had to come from
     the store.
     This notice never guesses WHY a record is empty: MLS cannot tell an
     empty Athena chart from a chart whose content it failed to read, so it
     states only what is held and names a route that is genuinely true (an
     explicit pull always performs a fresh chart read for every row - the
     Retry failed histories control is deliberately NOT named here, because
     it is built from receipt.retry and these patients are not failures). */
  /* THE PULL SENTENCE, separate from the store sentence. The census answers
     what MLS holds; the delta answers what THIS pull changed. Both are needed:
     a store already filled by an earlier pull would let a second zero-write
     pull close its own gap, and a fact the clinician typed by hand counts
     toward the store no matter who wrote it. Descriptive, never a cause - an
     unchanged record is perfectly legitimate when Athena has nothing new. */
  function censusChangeClause(hr) {
    var d = hr && hr.storeDelta;
    if (!d || d.measured !== true) return "";
    var n = Number(d.compared || 0), ch = Number(d.changed || 0);
    if (!n) return "";
    if (!ch) return " No stored record changed during this pull.";
    return " " + ch + " of " + n + " stored record" + (n === 1 ? "" : "s")
      + " changed during this pull.";
  }
  function contentNotice(hr) {
    var c = hr && hr.storeCensus;
    if (!c) return "";
    var t = Number(c.targets || 0);
    /* AN UNMEASURED CENSUS MUST NOT FALL SILENT. Silence handed the sentence
       straight back to processed/requested - the discredited pair that read
       19/19 - with nothing saying the store had never been looked at. */
    if (c.measured !== true) {
      if (!t && !Number(c.rows || 0)) return "";
      return " Chart content in MLS was NOT measured for this day, so the history count"
        + " above is a count of rows walked rather than of records stored - treat it as"
        + " unproven and pull this day again.";
    }
    if (!t) return "";
    var held = Number(c.withContent || 0), gap = Math.max(0, t - held);
    /* Says only what the STORE shows. It cannot say nothing was captured for
       these patients: vitals-only and typed-by-hand records both exist, and
       from here an empty Athena chart and a read that missed the content look
       identical. Never names the Retry failed histories control either - that
       is built from receipt.retry, and these patients are not failures. */
    return " Chart content in MLS: " + held + " of " + t + " patient" + (t === 1 ? "" : "s") + "."
      + censusChangeClause(hr)
      + (gap ? (" " + gap + (gap === 1 ? " holds" : " hold") + " none that MLS can see, and from"
        + " here an empty Athena chart looks the same as a chart MLS failed to read. Pulling"
        + " this day again re-reads every chart.") : "");
  }
  function providerScopeReceipt(providerMode) {
    var sc = providerScope();
    if (!sc) return { stated: false, scope: "not-reported", knownCount: null, paintedCount: null, athenaListEnumerated: null, coversPractice: null };
    return {
      stated: true,
      scope: String(sc.scope || "painted-day-grid"),
      requestedMode: String(providerMode || ""),
      knownCount: Number(sc.knownCount || 0),
      paintedCount: Number(sc.gridSweptCount || 0),
      rosterVerifiedCount: Number(sc.rosterVerifiedCount || 0),
      athenaListEnumerated: sc.athenaListEnumerated === true,
      /* the only field a "we pulled everyone" claim may be built on */
      coversPractice: sc.scopeComplete === true,
      sources: sc.sources || {},
      statement: String(sc.statement || "")
    };
  }
  function scopeProviderRows(rows, rawProvider, resp) {
    rows = Array.isArray(rows) ? rows.slice() : [];
    resp = resp || null;
    var req = providerRequest(rawProvider);
    var receipt = {
      mode: req.mode,
      requested: req.name,
      requestedId: req.id,
      requestedStableKey: req.stableKey,
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
      discoveredProviders: providerDiagLabels(resp, rows),
      /* mdx-1.0.0 (field report, Mac, 2026-08-05): a provider-incomplete
         refusal must NAME its rows or nobody can cure it remotely. PHI-free by
         construction - appointment times and shape flags only, never patient
         fields. nameMatchedIdMissingRows separates "athena exposed no provider
         identity on the row at all" from "the row showed the selected name but
         athena gave no structured id" - two different cures the emailed error
         report previously could not tell apart. */
      requireStableId: false,
      canonicalNameFallback: false,
      /* mdx-2.0.0: WHY the name fallback did or did not engage, so the next
         emailed report names the arm instead of a bare false. PHI-free:
         constant strings and counts only. */
      canonicalNameFallbackBasis: "",
      rosterSameNameCount: 0,
      sameNameConflictKinds: [],
      nameMatchedIdMissingRows: 0,
      unattributedDetail: []
    };
    var noteUnattributed = function (r, shape, k, rowId) {
      if (receipt.unattributedDetail.length >= 12) return;
      receipt.unattributedDetail.push({
        time: String(r && (r.time || r.start_local || "") || "").slice(0, 12),
        shape: shape,
        hasName: !!k,
        nameMatchesSelected: !!(k && req.key && k === req.key),
        hasId: !!rowId
      });
    };
    if (req.mode === "all") {
      rows.forEach(function (r) {
        if (providerKey(r && r.provider)) { receipt.providerTaggedRows++; return; }
        receipt.unattributedRows++;
        noteUnattributed(r, "no-provider-identity", "", String(rowProviderId(r) || "").trim());
      });
      var verifiedEmpty = !!(resp && resp.receipt && resp.receipt.complete === true && resp.receipt.authoritativeEmpty === true && rows.length === 0);
      receipt.complete = receipt.scheduleComplete && (verifiedEmpty || receipt.unattributedRows === 0);
      receipt.reason = receipt.complete ? "all-providers" : (receipt.scheduleComplete ? "provider-incomplete" : "provider-unverified");
      return { complete: receipt.complete, reason: receipt.reason, rows: receipt.complete ? rows : [], receipt: receipt };
    }
    if (!req.key || !receipt.scheduleComplete) {
      receipt.reason = "provider-unverified";
      return { complete: false, reason: receipt.reason, rows: [], receipt: receipt };
    }
    /* pa-1.0.0 (owner escalation 2026-07-27, b744 follow-through): b744 stamped
       the requested provider onto columnless rows in the CREATE body, but THIS
       gate runs first and counted every such row as unattributed, so a scoped
       pull returned provider-incomplete and imported NOTHING - the stamp was
       unreachable for the exact one-column Day view it was written for
       (measured live: 400/400 stored rows provider-empty across 17 days).
       Attribution is legitimate here and ONLY here: the two-dimensional sweep
       finished, the grid carries NO provider column at all (zero rows tagged),
       the read never named a second clinician, and the user explicitly scoped
       to one provider that is either roster-verified or named by this very
       read. A MIXED grid stays fail-closed exactly as before. An all-scope
       pull is untouched and stays honestly empty. Every filled row is counted
       and disclosed on the receipt. */
    var anyRowTagged = rows.some(function (r) {
      return !!providerKey(r && r.provider) || !!String(rowProviderId(r) || "").trim();
    });
    var namedOthers = receipt.discoveredProviders.filter(function (p) {
      var pk = providerKey(p); return pk && pk !== req.key;
    });
    var targetNamedByRead = receipt.discoveredProviders.some(function (p) { return providerKey(p) === req.key; });
    var scopeFill = !anyRowTagged && rows.length > 0 && receipt.scheduleComplete === true &&
                    namedOthers.length === 0 && (req.rosterVerified === true || targetNamedByRead);
    receipt.scopeFilledRows = 0;
    receipt.attribution = scopeFill ? "requested-scope-columnless" : "row-provider";
    var matching = [];
    /* A detected-only entry is not a verified full-roster claim, but a real
       structured id on that exact selection is still identity evidence. Keep
       id matching strict so enabling partial-roster routing never degrades a
       selected clinician to display-name-only matching. */
    var requireStableId = !!(req.id && (req.rosterVerified || req.detectedOnly));
    var canonicalNameFallback = false;
    var fallbackBasis = "";
    var sameNameCount = 0;
    var conflictKinds = [];
    if (requireStableId) {
      var canonicalRoster = safe(function () {
        var api = window.__mlsProviderRoster;
        return api && isFn(api.list) ? (api.list() || []) : [];
      }, []) || [];
      var canonicalSameName = canonicalRoster.filter(function (entry) { return providerKey(entry && entry.name) === req.key; });
      sameNameCount = canonicalSameName.length;
      /* mdx-2.0.0 (field report #2, Mac, 2026-08-06, b894, ext 3.0.45): that
         athenaOne skin renders schedule rows AND roster strings with display
         names only - no structured provider id anywhere - so roster ingest
         keeps a credential-less display echo of the clinician beside the real
         entry. providerKey() strips credentials while the roster's own
         equivalentKey keeps them, so the echo can never collapse upstream, the
         old `length === 1` demand here was unsatisfiable on that machine, and
         every selected-mode pull refused provider-incomplete on a COMPLETE
         20/20 grid. Owner order 2026-08-06: "default to just name if it has
         to but make sure everything else still works." So: the name fallback
         engages when the requested clinician is listed and every OTHER
         same-name entry is provably a display echo of that same clinician -
         no independent structured id, no independent non-legacy stableKey,
         and no conflicting credential. The moment any same-name entry could
         be a second real clinician, this refuses exactly as before, and the
         receipt now names which arm decided. */
      var wantIdLc = String(req.id || "").trim().toLowerCase();
      var wantSk = String(req.stableKey || "");
      var requestedListed = false;
      var credSigs = {};
      canonicalSameName.forEach(function (entry) {
        var eId = String(entry && entry.id != null ? entry.id : "").trim().toLowerCase();
        var eSk = String(entry && (entry.stableKey || entry.stable_key) || "");
        var sig = providerCredentialSignature(entry);
        if (sig) credSigs[sig] = 1;
        if ((eId && eId === wantIdLc) || (wantSk && eSk && eSk === wantSk)) { requestedListed = true; return; }
        if (eId) { if (conflictKinds.indexOf("independent-id") < 0) conflictKinds.push("independent-id"); return; }
        /* mdx-2.0.1: an id-LESS entry is a second identity only when its key
           carries information beyond the display string. The roster module
           already owns this rule (stringEchoEquivalent, feat_athena_provider_
           roster.js:394) and mdx-2.0.0 got it wrong: it exempted `legacy-name:`
           ONLY, while ext 3.0.45 stamps every id-less schedule-header provider
           as `athena:<display text>` (background.js:6790/:6971). That is the
           exact shape on the reporting Mac, so b899 pushed
           independent-structured-key and refused identically to b894 - a
           NO-OP, proven by executing the real roster shape. A key body that
           canonicalizes to THIS clinician's own token set is display evidence
           of one person; an opaque body ("athena:prov-88217") does not and
           stays a distinct identity. Note this also TIGHTENS the legacy arm,
           which previously exempted any `legacy-name:` key regardless of
           whose name was in its body. */
        var echoBody = eSk.replace(/^(?:legacy-name:|athena:)/, "");
        var isDisplayEcho = !!eSk && echoBody !== eSk && providerKey(echoBody) === req.key;
        if (eSk && !isDisplayEcho && conflictKinds.indexOf("independent-structured-key") < 0) conflictKinds.push("independent-structured-key");
      });
      if (Object.keys(credSigs).length > 1 && conflictKinds.indexOf("credential-conflict") < 0) conflictKinds.push("credential-conflict");
      canonicalNameFallback = requestedListed && conflictKinds.length === 0;
      fallbackBasis = canonicalNameFallback
        ? (sameNameCount === 1 ? "roster-unique" : "roster-echo-collapsed")
        : (sameNameCount === 0 ? "requested-name-not-listed"
          : (requestedListed ? "same-name-identity-conflict" : "requested-entry-not-listed"));
    }
    receipt.requireStableId = requireStableId;
    receipt.canonicalNameFallback = canonicalNameFallback;
    receipt.canonicalNameFallbackBasis = fallbackBasis;
    receipt.rosterSameNameCount = sameNameCount;
    receipt.sameNameConflictKinds = conflictKinds;
    rows.forEach(function (r) {
      var k = providerKey(r && r.provider), rowId = String(rowProviderId(r) || "").trim().toLowerCase();
      var wantId = String(req.id || "").trim().toLowerCase();
      if (!k && !rowId) {
        if (!scopeFill) { receipt.unattributedRows++; noteUnattributed(r, "no-provider-identity", k, rowId); return; }
        /* pa-1.0.0: the columnless scoped fill - a COPY, so the caller's raw
           rows never mutate; the filled copy carries into both the create
           body and the enrich path downstream. */
        var filled = {}; for (var fk in r) if (Object.prototype.hasOwnProperty.call(r, fk)) filled[fk] = r[fk];
        filled.provider = req.name;
        receipt.providerTaggedRows++; receipt.scopeFilledRows++; matching.push(filled); return;
      }
      receipt.providerTaggedRows++;
      /* A canonical provider id is the selected-provider identity. Never fall
         back to a display-name token set when the row exposes an id: two real
         clinicians may have the same name/credentials. If the selected name
         appears on an id-less row, the row is unresolved rather than guessed;
         the complete provider pull must be retried with structured ids. */
      if (requireStableId) {
        if (rowId) {
          if (rowId === wantId) matching.push(r); else receipt.mismatchedRows++;
        } else if (k === req.key && canonicalNameFallback) matching.push(r);
        else if (k === req.key) { receipt.unattributedRows++; receipt.nameMatchedIdMissingRows++; noteUnattributed(r, "selected-name-no-structured-id", k, rowId); }
        else receipt.mismatchedRows++;
      } else if (k === req.key) matching.push(r);
      else receipt.mismatchedRows++;
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
  function validDobProof(s) {
    var normalized=normDob(s);
    if(!/^\d{8}$/.test(normalized))return "";
    var year=Number(normalized.slice(0,4)),month=Number(normalized.slice(4,6)),day=Number(normalized.slice(6,8));
    if(year<1900||year>new Date().getFullYear()||month<1||month>12||day<1||day>31)return "";
    var parsed=new Date(Date.UTC(year,month-1,day));
    if(parsed.getUTCFullYear()!==year||parsed.getUTCMonth()!==month-1||parsed.getUTCDate()!==day||parsed.getTime()>Date.now())return "";
    return normalized;
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
  function p1ExactCount(value) {
    var n = Number(value);
    return isFinite(n) && n >= 0 && Math.floor(n) === n ? n : -1;
  }
  function p1RowProviderName(a) {
    return firstField(a, ["provider", "providerName", "provider_name", "providerDisplayName", "provider_display_name", "renderingProvider", "rendering_provider", "renderingProviderName", "rendering_provider_name"]);
  }
  function p1ExactCensusRows(rows, targetDate, expectedCount) {
    rows = Array.isArray(rows) ? rows : [];
    var expected = p1ExactCount(expectedCount), seen = {};
    if (!targetDate || expected <= 0 || rows.length !== expected) return false;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {}, appointmentId = String(rowAppointmentId(row) || "").trim().toLowerCase();
      var ownDate = normDate(row.date || row.appt_date || "");
      var exactTime = normTime(row.start_local || row.time || row.time_display || "");
      if (!String(row.name || "").trim() || !appointmentId || !/^\d\d:\d\d$/.test(exactTime) || seen[appointmentId]) return false;
      if (ownDate && ownDate !== targetDate) return false;
      if (p1RowProviderName(row) || rowProviderId(row)) return false;
      seen[appointmentId] = 1;
    }
    return Object.keys(seen).length === expected;
  }
  function p1AppointmentCensusDecision(resp, targetDate, requestId, requestedProvider, currentRosterReceipt, laneToken) {
    var no = { ok: false, receipt: null, grant: null };
    if (laneToken !== P1_DAY_CENSUS_TOKEN || !resp || resp.ok !== true || resp.scheduleVerified !== true) return no;
    requestedProvider = requestedProvider || {};
    if (String(requestedProvider.mode || "") !== "all") return no;
    var scheduleReceipt = resp.receipt || {}, rawRoster = resp.providerRosterReceipt || {};
    var normalizedRoster = currentRosterReceipt || {}, coverage = rawRoster.attributionCoverage || {};
    var expected = p1ExactCount(scheduleReceipt.expectedCount);
    var parsed = p1ExactCount(scheduleReceipt.parsedCount);
    var candidates = p1ExactCount(scheduleReceipt.candidateCount);
    var rows = p1ExactCount(coverage.rows), unattributed = p1ExactCount(coverage.unattributedRows);
    var foreign = p1ExactCount(coverage.foreignRows), headers = p1ExactCount(coverage.headerCount);
    if (scheduleReceipt.complete !== true || scheduleReceipt.authoritativeEmpty === true || expected <= 0 ||
        expected !== parsed || expected !== candidates || expected !== rows) return no;
    if (!requestId || String(scheduleReceipt.requestId || "") !== requestId ||
        String(rawRoster.requestId || "") !== requestId || String(normalizedRoster.requestId || "") !== requestId) return no;
    if (normDate(resp.schedDate || "") !== targetDate || String(rawRoster.targetDate || "") !== targetDate ||
        String(normalizedRoster.targetDate || "") !== targetDate) return no;
    var rawProviderMode = String(rawRoster.providerMode || "");
    if (rawRoster.complete === true || rawRoster.partial !== true || String(rawRoster.reason || "") !== "legacy-unverified" ||
        (rawProviderMode && rawProviderMode !== "all") || String(rawRoster.requestedProviderId || "") !== "" || String(rawRoster.requestedProviderStableKey || "") !== "" ||
        normalizedRoster.complete === true || normalizedRoster.partial !== true || String(normalizedRoster.reason || "") !== "legacy-unverified" ||
        String(normalizedRoster.providerMode || "") !== "all" || String(normalizedRoster.requestedProviderId || "") !== "" || String(normalizedRoster.requestedProviderStableKey || "") !== "") return no;
    if (String(coverage.verdict || "") !== "row-unattributed" || headers < 1 || unattributed !== rows || foreign !== 0) return no;
    if (p1ExactCount(rawRoster.observedCount) !== headers || !p1ExactCensusRows(resp.appts, targetDate, rows)) return no;
    var receipt = {
      kind: "athena-appointment-census",
      complete: true,
      reason: "complete-provider-unknown",
      scope: "appointment-census-only",
      targetDate: targetDate,
      requestId: requestId,
      expectedCount: expected,
      parsedCount: parsed,
      candidateCount: candidates,
      rowCount: rows,
      uniqueAppointmentIds: rows,
      providerHeaderCount: headers,
      unattributedRows: unattributed,
      foreignRows: foreign,
      providerAttributionComplete: false,
      providerFieldsBlank: true,
      noProviderGuess: true,
      providerSnapshotAllowed: false
    };
    try { Object.freeze(receipt); } catch (eFreezeP1Receipt) {}
    return { ok: true, receipt: receipt, grant: { token: P1_CENSUS_IMPORT_TOKEN, response: resp, receipt: receipt } };
  }
  /* A partial practice roster may still contain one exact clinician identity
     that the user deliberately selected. Admit the fresh read to row-level
     verification only when that SAME identity is present in this response and
     every provenance field is bound to this request/day/scope. This is not a
     completion receipt and grants no import by itself: scopeProviderRows is
     still the authority. In particular, two visible headers plus columnless
     rows remains provider-incomplete and writes nothing. */
  function p1DetectedSelectedDecision(resp, targetDate, requestId, requestedProvider, currentRosterReceipt) {
    var no = { ok: false, reason: "detected-provider-unverified" };
    var req = providerRequest(requestedProvider), receipt = currentRosterReceipt || {};
    if (!resp || resp.ok !== true || req.mode !== "selected" || req.detectedOnly !== true || !req.stableKey) return no;
    if (!requestId || String(resp && resp.receipt && resp.receipt.requestId || "") !== requestId ||
        String(receipt.requestId || "") !== requestId || String(receipt.targetDate || "") !== targetDate ||
        String(receipt.providerMode || "") !== "selected" ||
        String(receipt.requestedProviderId || "") !== String(req.id || "") ||
        String(receipt.requestedProviderStableKey || "") !== String(req.stableKey || "")) return no;
    if (receipt.complete === true || receipt.partial !== true || String(receipt.reason || "") !== "legacy-unverified" ||
        Number(receipt.observedCount || 0) < 1) return no;
    var roster = Array.isArray(resp.providerRoster) ? resp.providerRoster : [], exact = 0;
    for (var i = 0; i < roster.length; i++) {
      var p = roster[i] || {}, pId = String(p.id || p.providerId || p.provider_id || ""),
          pStable = String(p.stableKey || p.stable_key || ""), pName = String(p.name || p.raw || p.provider || "");
      var same = req.id ? (pId === String(req.id)) : (pStable === String(req.stableKey));
      /* An id-less display-derived stable key can change punctuation between
         Athena surfaces. The exact canonical clinician token is acceptable
         only when no structured id was requested. */
      if (!same && !req.id && pName && providerKey(pName) === req.key) same = true;
      if (same) exact++;
    }
    if (exact !== 1) return no;
    return { ok: true, reason: "detected-provider-request-bound", observedCount: Number(receipt.observedCount || 0) };
  }
  function p1AppointmentCensusScope(grant, rows, rawProvider, providerResp, scopeDate) {
    if (!grant || grant.token !== P1_CENSUS_IMPORT_TOKEN || grant.response !== providerResp || !grant.receipt || grant.receipt.complete !== true) return null;
    var req = providerRequest(rawProvider), receipt = grant.receipt;
    if (req.mode !== "all" || normDate(scopeDate || "") !== receipt.targetDate ||
        String(providerResp && providerResp.receipt && providerResp.receipt.requestId || "") !== receipt.requestId ||
        !p1ExactCensusRows(rows, receipt.targetDate, receipt.rowCount)) return null;
    return {
      complete: true,
      reason: "appointment-census-only",
      rows: rows.slice(),
      receipt: {
        mode: "all",
        complete: false,
        reason: "provider-attribution-unavailable",
        scheduleComplete: true,
        sourceRows: rows.length,
        providerTaggedRows: 0,
        matchingRows: 0,
        mismatchedRows: 0,
        unattributedRows: rows.length,
        appointmentCensusComplete: true,
        providerAttributionComplete: false,
        attribution: "provider-blank-exact-appointment-census",
        censusKind: receipt.kind,
        targetDate: receipt.targetDate,
        requestId: receipt.requestId,
        noProviderGuess: true
      }
    };
  }
  function sourceProof(a) {
    /* A non-empty date-like string is not identity proof. Only a real,
       non-future DOB may bind a schedule row to a local patient. */
    return { dob: validDobProof(a && a.dob), mrn: rowMrn(a) };
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
  /* p1-metadata-durability-1.0: schedule ledgers, month ownership, and resume
     intents are small account-local metadata, but a swallowed quota/security
     exception is still a false durability claim. Every write is echoed before
     it can be reported as successful. The latch is in memory only so it cannot
     itself become another quota failure; the active pull turns it into a
     named receipt and refuses the next navigation until a verified write
     proves the metadata lane healthy again. */
  var p1MetadataFailureSerial = 0, p1MetadataFailures = [];
  function p1MetadataFailureKind(error) {
    var name = String(error && error.name || ""), code = Number(error && error.code || 0);
    return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014 ? "storage-full" : "metadata-persist-failed";
  }
  function p1PublishMetadataFailures() {
    if (!p1MetadataFailures.length) {
      safe(function () { window.__mlsP1MetadataWriteFailed = null; });
      return null;
    }
    var primary = p1MetadataFailures[0], newestAt = Number(primary.at || 0);
    for (var fi = 0; fi < p1MetadataFailures.length; fi++) {
      var item = p1MetadataFailures[fi];
      if (String(item.reason || "") === "storage-full") primary = item;
      newestAt = Math.max(newestAt, Number(item.at || 0));
    }
    var out = { v: 1, at: newestAt || Date.now(), serial: p1MetadataFailureSerial, scope: "pull-metadata", reason: String(primary.reason || "metadata-persist-failed"), pending: p1MetadataFailures.length };
    safe(function () { window.__mlsP1MetadataWriteFailed = out; });
    return out;
  }
  function p1RememberMetadataFailure(key, reason, error, operation, attemptedBytes) {
    p1MetadataFailureSerial++;
    /* The key can contain the account namespace and browser exceptions can
       contain implementation details. Neither belongs on the public pull
       receipt or in a physician-facing diagnostic surface. The fixed reason
       code plus a monotonic serial is enough to fail closed and correlate the
       failure without leaking either value. */
    key = String(key || "@missing-metadata-key"); operation = String(operation || "read");
    var bytes = Math.max(0, Number(attemptedBytes || 0)), slot = null;
    for (var fi = 0; fi < p1MetadataFailures.length; fi++) {
      if (p1MetadataFailures[fi].key === key && p1MetadataFailures[fi].operation === operation) { slot = p1MetadataFailures[fi]; break; }
    }
    if (!slot) {
      slot = { key: key, operation: operation, attemptedBytes: bytes, reason: String(reason || "metadata-persist-failed"), at: Date.now() };
      p1MetadataFailures.push(slot);
    } else {
      slot.attemptedBytes = Math.max(Number(slot.attemptedBytes || 0), bytes);
      if (String(reason || "") === "storage-full") slot.reason = "storage-full";
      slot.at = Date.now();
    }
    return p1PublishMetadataFailures();
  }
  function p1ProveMetadataRecovery(key, operation, provenBytes) {
    key = String(key || ""); operation = String(operation || ""); provenBytes = Math.max(0, Number(provenBytes || 0));
    if (!key || !p1MetadataFailures.length) return p1PublishMetadataFailures();
    var kept = [];
    for (var fi = 0; fi < p1MetadataFailures.length; fi++) {
      var item = p1MetadataFailures[fi], recovered = false;
      if (item.key === key) {
        if (operation === "set" && (item.operation === "set" || item.operation === "read") && provenBytes >= Number(item.attemptedBytes || 0)) recovered = true;
        else if (operation === "remove" && item.operation === "remove") recovered = true;
        else if (operation === "scope" && item.operation === "scope") recovered = true;
      }
      if (!recovered) kept.push(item);
    }
    p1MetadataFailures = kept;
    return p1PublishMetadataFailures();
  }
  function p1MetadataFailure() { return safe(function () { return window.__mlsP1MetadataWriteFailed || null; }, null); }
  function p1VerifiedMetadataSet(key, raw) {
    key = String(key || "");
    raw = String(raw == null ? "" : raw);
    if (!key) return { ok: false, reason: "metadata-persist-failed", receipt: p1RememberMetadataFailure(key, "metadata-persist-failed", null, "set", raw.length) };
    try {
      localStorage.setItem(key, raw);
      if (localStorage.getItem(key) !== raw) {
        var mismatch = p1RememberMetadataFailure(key, "metadata-persist-failed", null, "set", raw.length);
        return { ok: false, reason: mismatch.reason, receipt: mismatch };
      }
      p1ProveMetadataRecovery(key, "set", raw.length);
      return { ok: true };
    } catch (eMetadataSet) {
      var reason = p1MetadataFailureKind(eMetadataSet), failure = p1RememberMetadataFailure(key, reason, eMetadataSet, "set", raw.length);
      return { ok: false, reason: reason, receipt: failure };
    }
  }
  function p1VerifiedMetadataRemove(key) {
    key = String(key || "");
    if (!key) return { ok: false, reason: "metadata-persist-failed", receipt: p1RememberMetadataFailure(key, "metadata-persist-failed", null, "remove", 0) };
    try {
      localStorage.removeItem(key);
      if (localStorage.getItem(key) != null) {
        var mismatch = p1RememberMetadataFailure(key, "metadata-persist-failed", null, "remove", 0);
        return { ok: false, reason: mismatch.reason, receipt: mismatch };
      }
      p1ProveMetadataRecovery(key, "remove", 0);
      return { ok: true };
    } catch (eMetadataRemove) {
      var reason = p1MetadataFailureKind(eMetadataRemove), failure = p1RememberMetadataFailure(key, reason, eMetadataRemove, "remove", 0);
      return { ok: false, reason: reason, receipt: failure };
    }
  }
  function p1MetadataRefusal(onStatus) {
    var failure = p1MetadataFailure();
    if (!failure) return null;
    var storage = String(failure.reason || "") === "storage-full", reason = storage ? "storage-full" : "metadata-persist-failed";
    var error = storage
      ? "MLS local pull metadata is full, so this pull cannot prove its receipt will survive a reload. Free local storage, then try again."
      : "MLS local pull metadata could not be verified, so this pull was not started. Reload MLS and try again.";
    var out = { ok: false, complete: false, reason: reason, gate: "p1-metadata-preflight", error: error, metadataReceipt: failure, retry: {} };
    if (isFn(onStatus)) onStatus(error, "err");
    lastPullResult = out;
    safe(function () { window.__mlsPullLastOutcome = honestPullOutcome(out); });
    return out;
  }
  function indexKey(day) { return safe(function () { return isFn(window.uns) ? window.uns(IMPORT_INDEX_SUFFIX + "::" + String(day || "")) : ""; }, ""); }
  function daysKey() { return safe(function () { return isFn(window.uns) ? window.uns(IMPORT_DAYS_SUFFIX) : ""; }, ""); }
  function ensureDay(day) {
    day = String(day || ""); if (!day || knownDays[day]) return !!day;
    var k = daysKey(); if (!k) { p1RememberMetadataFailure(k, "metadata-persist-failed"); return false; }
    var days;
    try { days = JSON.parse(localStorage.getItem(k) || "[]"); } catch (eDaysRead) { p1RememberMetadataFailure(k, p1MetadataFailureKind(eDaysRead), eDaysRead); return false; }
    if (!Array.isArray(days)) days = [];
    if (days.indexOf(day) < 0) days.push(day);
    days.sort();
    var evicted = [];
    while (days.length > 45) evicted.push(days.shift());
    var saved = p1VerifiedMetadataSet(k, JSON.stringify(days));
    if (!saved.ok) return false;
    for (var ei = 0; ei < evicted.length; ei++) {
      var removed = p1VerifiedMetadataRemove(indexKey(evicted[ei]));
      if (!removed.ok) return false;
      delete knownDays[evicted[ei]];
    }
    knownDays[day] = 1;
    return true;
  }
  function readIndex(day) {
    var k = indexKey(day); if (!k) { p1RememberMetadataFailure(k, "metadata-persist-failed"); return { v: 1, rows: {}, _p1MetadataUnavailable: true }; }
    try {
      var x = JSON.parse(localStorage.getItem(k) || "null");
      if (!x || x.v !== 1 || !x.rows || typeof x.rows !== "object") x = { v: 1, rows: {} };
      return x;
    } catch (eIndexRead) {
      p1RememberMetadataFailure(k, p1MetadataFailureKind(eIndexRead), eIndexRead);
      return { v: 1, rows: {}, _p1MetadataUnavailable: true };
    }
  }
  function writeIndex(day, x) {
    var k = indexKey(day); if (!k || !x || x._p1MetadataUnavailable || !ensureDay(day)) { if (!k) p1RememberMetadataFailure(k, "metadata-persist-failed"); return false; }
    var copy = {}; for (var key in x) if (Object.prototype.hasOwnProperty.call(x, key) && key !== "_p1MetadataUnavailable") copy[key] = x[key];
    return p1VerifiedMetadataSet(k, JSON.stringify(copy)).ok;
  }
  /* b752: THE STORE CENSUS. The verdict was built entirely out of counts of
     rows the pull had WALKED, so it could not disagree with the store no
     matter what the store held. Measured live on the owner account, Wed
     2026-07-29: a pull walked all 19 appointments over 157 seconds and
     reported "history 19/19; failures 0" while writing ZERO characters -
     stamps 19, problems 6, meds 0, visits 18 before AND after, byte
     identical - and ten of those patients hold nothing but the ~32-character
     import stamp line. requested is rows.length + unresolved.length;
     processed++ fires for a pure failure and for every patient regardless of
     whether anything landed. Neither number can ever contradict the walk.
     These helpers ask the STORE instead: for every row of the day, resolve
     the immutable local patient id with the SAME resolver the history reader
     already uses (rowLocalPatientId -> patientById, no second resolver) and
     decide whether that record actually holds clinical content.
     It never fails a patient and it never writes. A genuinely empty Athena
     chart is a valid outcome and MLS cannot tell it apart from a read that
     missed the content, so the census reports WHAT IS HELD and says nothing
     about why. Honest reporting, not refusal. */
  /* The vocabulary of "nothing is documented here" is ALREADY OWNED by the app
     (isNoData in ScribeFlow._savePatientChart, and again in
     _athenaChartSnapshotList). Re-implementing it narrower let the census be
     silenced by a string the save deliberately KEEPS: merge retains the newest
     placeholder when no meaningful fact exists, so allergies of "None on file"
     is a normal stored state, and it made the gap vanish (19 of 19 held
     content, notice silent) on the very store that holds nothing else. This set
     is the union of both app sets plus the census-only additions. */
  var CENSUS_EMPTY_ITEM = /^(?:none(?: recorded| documented| known| on file)?|not recorded|not documented|not on file|not available|not applicable|unknown|deferred|n\s*\/\s*a|na|nil|no data|no known allergies|nka)$/i;
  /* Bullets and middots are structure, not text. The summary block is built
     with bullet characters and listItems strips exactly this set, so the census
     must strip them too or a placeholder hides behind its own bullet. */
  function censusTrim(v) { return String(v == null ? "" : v).replace(/^[\s\-\u2013\u2014\u2022\u00b7*.:;]+/, "").replace(/[\s\-\u2013\u2014\u2022\u00b7*.:;]+$/, ""); }
  function censusListHasContent(v) {
    if (v == null) return false;
    var parts = String(v).split(/[\r\n;,|]+/);
    for (var i = 0; i < parts.length; i++) {
      var t = censusTrim(parts[i]);
      if (t && !CENSUS_EMPTY_ITEM.test(t)) return true;
    }
    return false;
  }
  /* The bare import stamp is a receipt that a read HAPPENED, not content. Ten
     of nineteen patients received exactly that one line and nothing else, so a
     summary made only of stamp lines must never count as captured.
     Two further shapes of the same lie live in the SAME string. The block the
     chart save writes is stamp + chart summary + a "Prior history" section of
     LABEL: value bullets + a "Recent visits" section whose bullets are
     "<date> - <type>" INDEX LINES assembled from row metadata by
     _athenaChartSnapshotFromChart. A section heading is structure; a bullet
     whose value is a placeholder is not a fact; an encounter index is not a
     clinical body. None of the three may count, or the read that produced them
     closes its own gap. */
  var CENSUS_STAMP_LINE = /^(?:Pulled from Athena|Longitudinal summary refreshed)\b[\s\d\/\-.,:]*/i;
  var CENSUS_SECTION_HEAD = /^(?:prior history|recent visits?|history|visits|chart summary|athena chart)$/i;
  var CENSUS_INDEX_SECTION = /^recent visits?$/i;
  function censusSummaryHasContent(v) {
    if (v == null) return false;
    var lines = String(v).split(/[\r\n]+/), indexSection = false;
    for (var i = 0; i < lines.length; i++) {
      var line = String(lines[i] == null ? "" : lines[i]).replace(/^[\s\-\u2013\u2014\u2022\u00b7*]+/, "").replace(CENSUS_STAMP_LINE, "");
      var head = censusTrim(line);
      if (!head) continue;
      if (CENSUS_SECTION_HEAD.test(head)) { indexSection = CENSUS_INDEX_SECTION.test(head); continue; }
      if (indexSection) continue;
      /* A LABEL: prefix is structure supplied by the writer, so judge only the
         VALUE after it - otherwise the label alone reads as clinical text. */
      var m = /^([A-Za-z][A-Za-z0-9 _\/-]{0,40}):([\s\S]*)$/.exec(line);
      if (m) { if (censusListHasContent(m[2])) return true; continue; }
      if (censusListHasContent(head)) return true;
    }
    return false;
  }
  function censusHistoryHasContent(h) {
    if (!h) return false;
    if (typeof h === "string") return censusListHasContent(h);
    if (Array.isArray(h)) { for (var ai = 0; ai < h.length; ai++) if (censusListHasContent(h[ai])) return true; return false; }
    if (typeof h !== "object") return false;
    for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) { if (censusListHasContent(h[k])) return true; }
    return false;
  }
  /* MIRROR THE APPS OWN VISIT PREDICATE. _hasVisitContent in feat_visits.js
     judges text, codes and scores and deliberately ignores date and type, and
     _emptyPlaceholder treats indexOnly === true as a shell unconditionally -
     because _normVisit sets raw to "" for an index-only row BY CONSTRUCTION.
     A date is metadata: the briefing page that has no Active Problems section
     still yields a Recent visits list, so counting a dated shell as content let
     the failing read close its own gap (19 of 19, no gap sentence) on a store
     that had gained nothing. The strict persistence proof in this very file
     already agrees: indexOnly !== true && fullDetail && bodyComplete && raw. */
  function censusVisitsHaveContent(p) {
    var arr = Array.isArray(p && p.visits) ? p.visits : [];
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (!v) continue;
      if (typeof v === "string") { if (v.trim()) return true; continue; }
      if (typeof v !== "object") continue;
      if (v.indexOnly === true) continue;
      /* textHead is the INDEX LINE and aiSummary is derived from row metadata -
         feat_visits._emptyPlaceholder states that outright - so neither is proof
         that an encounter body was captured. What is left is the intersection of
         _hasVisitContent and the strict persistence proof in this file. */
      if (String(v.raw || v.text || v.note || v.detail || v.findings || v.plan || "").trim()) return true;
      if ((v.cpt && v.cpt.length) || (v.icd10 && v.icd10.length) || (v.meds && v.meds.length)) return true;
      if (v.scores && typeof v.scores === "object" && Object.keys(v.scores).length) return true;
    }
    return false;
  }
  /* VITALS ARE A CLINICAL FIELD and this module already says so - the chart
     reader counts problems, meds, allergies, VITALS, history as its clinical
     fields, and the save writes p.vitals and p.bmi. Leaving them out pointed
     the whole instrument the wrong way: a patient whose chart documented BP,
     height, weight and BMI and nothing else was reported to the doctor as
     holding nothing at all, which is the same defect as a false 19/19 with the
     sign flipped. takenAt is when the vitals were taken, i.e. metadata, and is
     excluded for the same reason a visit date is. */
  function censusVitalsHaveContent(p) {
    if (!p) return false;
    var v = p.vitals;
    if (typeof v === "string" && censusListHasContent(v)) return true;
    if (v && typeof v === "object") {
      for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) {
        if (k === "takenAt" || k === "taken_at" || k === "recordedAt" || k === "date") continue;
        var t = censusTrim(v[k]);
        if (t && !CENSUS_EMPTY_ITEM.test(t)) return true;
      }
    }
    return censusListHasContent(p.bmi);
  }
  /* ===== cap-1.0.0 (a captured chart is content, even before the AI runs) =====
     MEASURED on the owner's /1p 2026-08-17 (build p1-20260815-launch-r1, ext
     3.0.62, TODAY, bodies OFF, 16 rows): 9 rows read their chart out of athena
     successfully and then died on "502 Upstream request failed" - the BACKEND
     AI (aiCallRaw -> /api/complete, called by _parsePatientChart) was down
     because the OpenAI credit balance had gone negative. The store gained
     NOTHING for those nine patients: the whole capture was thrown away because
     a summariser was unavailable, and every one of them was reported as a
     failed history.

     The raw capture is the expensive, irreplaceable half (it needs athena, the
     tab, the lease and 15-30 s per chart); the AI post-processing is cheap and
     retryable and needs neither. So the capture is PERSISTED FIRST, under the
     same identity proof the six-card save uses, and the census counts it -
     otherwise a day that captured every chart but could not summarise one of
     them reads as a day that stored nothing (the scv-1.0.0 bar).
     A capture is only counted when it carries this pull's own verified
     identity echo AND real characters, so an empty or unbound capture can
     never manufacture content. */
  function censusRawCaptureHasContent(p) {
    var c = p && p.athenaRawCapture;
    if (!c || typeof c !== "object") return false;
    if (c.identityVerified !== true) return false;
    return Number(c.chars || 0) > 0 && !!String(c.text || "").trim();
  }
  /* ===== end cap-1.0.0 (census predicate) ===== */
  var CENSUS_FIELDS = ["problems", "meds", "allergies", "vitals", "history", "visits", "summary", "rawCapture"];
  /* b754: allergies are counted in the BREAKDOWN but must never, alone, mark a
     record as captured. mergeOwned preserves a prior allergy value whenever the
     fresh read is empty, and athenaOne prints that section as the literal string
     NKDA - so allergies came back present for 19 of 19 patients even on a pull
     that stored nothing, and on a SIGNED-OUT session. A field the broken path
     does not produce cannot be evidence that the path worked. This is the same
     exclusion the chart-import gate already makes, applied one level up. */
  var CENSUS_CONTENT_FIELDS = ["problems", "meds", "vitals", "history", "visits", "summary", "rawCapture"];
  function censusPatientContent(p) {
    return {
      problems: censusListHasContent(p && p.problems),
      meds: censusListHasContent(p && p.meds),
      allergies: censusListHasContent(p && p.allergies),
      rawCapture: censusRawCaptureHasContent(p), /* cap-1.0.0 */
      vitals: censusVitalsHaveContent(p),
      history: censusHistoryHasContent(p && p.history),
      visits: censusVisitsHaveContent(p),
      summary: censusSummaryHasContent(p && p.summary)
    };
  }
  /* ATTRIBUTION, recorded but never used as the headline. The fields above are
     the store, and the store is what the doctor asked about - but a fact he
     typed himself merges into problems/meds/summary and survives mergeOwned,
     so "MLS holds content" is not by itself "Athena gave us content".
     athenaChartSnapshot is the one slice the save stamps as Athena-owned, so
     count it separately for the ledger. Its visits array is the same index of
     "<date> - <type>" lines and is excluded here too. */
  function censusAthenaSourced(p) {
    var s = p && p.athenaChartSnapshot;
    if (!s || typeof s !== "object") return false;
    if (censusListHasContent(s.problems) || censusListHasContent(s.meds) || censusListHasContent(s.allergies)) return true;
    if (censusHistoryHasContent(s.history)) return true;
    if (censusVitalsHaveContent({ vitals: s.vitals })) return true;
    if (censusSummaryHasContent(s.summary)) return true;
    return false;
  }
  /* WHAT THIS PULL CAPTURED, as distinct from what MLS holds. A census taken
     only AFTER the walk cannot tell a record THIS pull filled from one an
     earlier pull filled, so the second zero-write pull of the same day would
     close its own gap and the lie would be back. The fingerprint is content
     SIZE only and deliberately excludes every save timestamp: a save that
     rewrote the identical characters and bumped athenaChartImportedAt must not
     read as a capture, because that is exactly what the measured pull did. */
  function censusLen(v) {
    if (v == null) return 0;
    if (Array.isArray(v)) { var n = 0; for (var ai = 0; ai < v.length; ai++) n += censusLen(v[ai]); return n; }
    if (typeof v === "object") { var m = 0; for (var k in v) if (Object.prototype.hasOwnProperty.call(v, k)) m += censusLen(v[k]); return m; }
    return String(v).length;
  }
  function censusFingerprint(p) {
    if (!p) return "";
    var arr = Array.isArray(p.visits) ? p.visits : [], bodies = 0, vchars = 0;
    for (var i = 0; i < arr.length; i++) {
      var v = arr[i];
      if (!v) continue;
      if (typeof v === "string") { vchars += v.length; if (v.trim()) bodies++; continue; }
      if (typeof v !== "object") continue;
      var body = String(v.raw || v.text || v.note || v.detail || v.findings || v.plan || "");
      vchars += body.length;
      if (v.indexOnly !== true && body.trim()) bodies++;
    }
    /* cap-1.0.0: a pull that captured raw chart text CHANGED the store, so the
       fingerprint must move - otherwise storeDelta.changed reports 0 on the
       very run whose capture is the thing being measured. Character COUNT
       only, in keeping with the "size, never timestamps" rule above. */
    return [censusLen(p.problems), censusLen(p.meds), censusLen(p.allergies), censusLen(p.history),
      censusLen(p.vitals), censusLen(p.bmi), arr.length, bodies, vchars, censusLen(p.summary),
      Number((p.athenaRawCapture && p.athenaRawCapture.chars) || 0)].join("|");
  }
  /* Descriptive only, and never a cause. An unchanged record can be perfectly
     legitimate - nothing new in Athena since the last pull - so this never
     fails anything. It is simply the one number that would have contradicted
     "history 19/19" on a day whose store was byte identical before and after. */
  function censusDelta(before, after) {
    var out = { measured: false, compared: 0, changed: 0, unchanged: 0 };
    if (!before || !after || before.measured !== true || after.measured !== true) return out;
    var bp = (before.prints && typeof before.prints === "object") ? before.prints : {};
    var ap = (after.prints && typeof after.prints === "object") ? after.prints : {};
    for (var pid in ap) if (Object.prototype.hasOwnProperty.call(ap, pid)) {
      out.compared++;
      if (String(bp[pid] == null ? "" : bp[pid]) === String(ap[pid])) out.unchanged++; else out.changed++;
    }
    out.measured = true;
    return out;
  }
  /* Measure what the store holds for THIS day. rows are the schedule rows the
     batch was built from and unresolved are the days patients whose identity
     never resolved, so the denominator is the day itself and never a number the
     walk chose for us. targets counts DISTINCT patients plus rows that carry no
     local patient id at all, so two appointments for one person can never
     manufacture a gap. */
  function storedContentCensus(rows, unresolvedList) {
    rows = Array.isArray(rows) ? rows : [];
    unresolvedList = Array.isArray(unresolvedList) ? unresolvedList : [];
    var out = {
      measured: false, rows: rows.length, targets: 0, resolved: 0, unresolved: 0, neverAttempted: 0,
      withContent: 0, withoutContent: 0, stampOnlySummary: 0, athenaSourced: 0, gap: 0,
      captureOnly: 0, /* cap-1.0.0: captured, not yet summarised - counted, never hidden */
      fields: { problems: 0, meds: 0, allergies: 0, vitals: 0, history: 0, visits: 0, summary: 0, rawCapture: 0 },
      emptyPatientIds: [], prints: {}
    };
    return safe(function () {
      var seen = {};
      for (var i = 0; i < rows.length; i++) {
        var pid = String(rowLocalPatientId(rows[i]) || "");
        if (!pid) { out.targets++; out.unresolved++; continue; }
        if (seen[pid]) continue;
        seen[pid] = 1; out.targets++;
        var p = patientById(pid);
        if (!p) { out.unresolved++; continue; }
        out.resolved++;
        out.prints[pid] = censusFingerprint(p);
        if (censusAthenaSourced(p)) out.athenaSourced++;
        var c = censusPatientContent(p), any = false;
        for (var fi = 0; fi < CENSUS_FIELDS.length; fi++) {
          var fk = CENSUS_FIELDS[fi];
          if (c[fk]) out.fields[fk]++;
        }
        for (var ci = 0; ci < CENSUS_CONTENT_FIELDS.length; ci++) {
          if (c[CENSUS_CONTENT_FIELDS[ci]]) { any = true; break; }
        }
        if (any) {
          out.withContent++;
          /* cap-1.0.0: a record whose ONLY content is this pull's raw capture
             is captured-but-unsummarised. It counts as content (the chart is
             saved and cannot be lost), and it is reported separately so the
             day never claims a summarised chart it does not have. */
          if (c.rawCapture) {
            var summarised = false;
            for (var qi = 0; qi < CENSUS_CONTENT_FIELDS.length; qi++) {
              if (CENSUS_CONTENT_FIELDS[qi] !== "rawCapture" && c[CENSUS_CONTENT_FIELDS[qi]]) { summarised = true; break; }
            }
            if (!summarised) out.captureOnly++;
          }
          continue;
        }
        out.withoutContent++;
        if (out.emptyPatientIds.length < 40) out.emptyPatientIds.push(pid);
        /* no content AND a non-empty summary can only mean stamp lines. */
        if (String(p.summary || "").trim()) out.stampOnlySummary++;
      }
      /* THE DENOMINATOR MUST BE THE DAY. requested is rows.length +
         unresolved.length, so counting only rows shrank the fraction to hide
         exactly the patients that were never attempted: a six-appointment day
         with four unresolved rows read "history 2/2" where it used to read 2/6.
         An unresolved patient is a target of the day, is not content, and is
         not a record we are entitled to call empty either - so it lands in the
         gap and in unresolved, never in withoutContent. */
      for (var ui = 0; ui < unresolvedList.length; ui++) {
        var upid = String((unresolvedList[ui] && unresolvedList[ui].patientId) || "");
        if (upid && seen[upid]) continue;
        if (upid) seen[upid] = 1;
        out.targets++; out.unresolved++; out.neverAttempted++;
      }
      /* THE INSTRUMENT LIES FIRST. Zero resolutions out of a non-empty day is
         far more likely a store read that never happened than a day on which
         every single record vanished, and a census that reports a false zero is
         the same class of defect as a walk count that reports a false 19. This
         also covers the day whose rows ALL failed identity resolution: the
         batch is handed zero rows and nineteen unresolved, which used to score
         a vacuous 0 of 0 with measured true. Report UNMEASURED and let every
         consumer say so out loud. */
      if (out.targets > 0 && out.resolved === 0) { out.gap = 0; return out; }
      out.gap = Math.max(0, out.targets - out.withContent);
      out.measured = true;
      return out;
    }, out);
  }
  /* b751: write the history verdict and every per-patient reason into the day
     ledger. The pull already KNOWS why each patient failed - frozenRetryEntry
     builds {patientId, reason} at all seven failure sites - but the receipt was
     in-memory only, so the reasons died with the pull. A store scan of the
     owner account found 220 keys and not one failure reason recorded, which is
     why "why did these patients get no history" has never been answerable after
     the fact. Additive: rides the existing ledger object and namespace, touches
     no row state, and readIndex preserves unknown top-level keys. */
  /* ===== onheal-1.0.0 (the ON lane's same-day proof) ======================
     The pulled day's own encounter has TWO honest sources. With Full visit
     notes OFF a separate scoped read stamps p.todayNote, and that derivation
     below is unchanged and still wins. With it ON there is no separate scoped
     read at all - both day-note lanes are OFF-only - so todayNote stayed null
     forever, this lane could only ever say "unknown", and
     rskAlreadyVerifiedToday rejected EVERY same-day re-pull with
     "same-day-lane-unproven": every re-pull re-walked every chart.
     The ON fallbacks below are receipts this pull actually earned - the scoped
     direct-bridge receipt, then the full walk's own sameDayProof - and both are
     validated against the SAME closed vocabulary the checker accepts, so an
     alien string can never travel. "unknown" remains the honest default. */
  function sameDayLaneStatus(p) {
    var base = (p && p.todayNote === true) ? "saved"
      : ((p && p.todayNoteSkipped === "future-day") ? "not-yet-available"
        : ((p && p.todayNote == null) ? "unknown" : "unread"));
    if (base !== "unknown") return base;
    var carried = String((p && p.sameDayReceipt && p.sameDayReceipt.status) || "");
    if (/^(saved|absent|not-yet-available)$/.test(carried)) return carried;
    if (/^(partial|refused)$/.test(carried)) return "unread";
    var proved = String((p && p.sameDayProof && p.sameDayProof.status) || "");
    if (/^(saved|absent|not-yet-available)$/.test(proved)) return proved;
    return "unknown";
  }
  function recordHistoryVerdict(day, receipt, dayRowCount) {
    day = String(day || ""); if (!day || !receipt) return;
    safe(function () {
      var x = readIndex(day);
      var reasons = {}, perPatient = {}, storedOk = 0;
      /* b752: the census is measured in finalizeVerdict and rides the receipt;
         an older receipt with none is recorded as unmeasured rather than as
         zero content, because zero would be a claim we did not measure. */
      var census = (receipt.storeCensus && typeof receipt.storeCensus === "object") ? receipt.storeCensus
        : { measured: false, rows: Number(dayRowCount || 0), targets: 0, resolved: 0, unresolved: 0, neverAttempted: 0, withContent: 0, withoutContent: 0, stampOnlySummary: 0, athenaSourced: 0, gap: 0, fields: {}, emptyPatientIds: [] };
      var delta = (receipt.storeDelta && typeof receipt.storeDelta === "object") ? receipt.storeDelta
        : { measured: false, compared: 0, changed: 0, unchanged: 0 };
      /* prints is the per-patient content fingerprint the delta is computed
         from. It exists for one comparison and must never be persisted: the
         ledger is bounded localStorage, and a fingerprint is not a finding. */
      var ledgerCensus = {};
      for (var ck in census) if (Object.prototype.hasOwnProperty.call(census, ck) && ck !== "prints") ledgerCensus[ck] = census[ck];
      var perPatientDiag = {};
      var perPatientLanes = {}; /* cachev-1.0.0: v2 per-lane proof receipts */
      (receipt.patients || []).forEach(function (p) {
        if (!p) return;
        var pid = String(p.patientId || "");
        if (p.complete === true) {
          storedOk++;
          if (pid) perPatient[pid] = "ok";
          /* cachev-1.0.0: the lanes this pull actually proved, recorded so a
             later same-day re-pull can skip HONESTLY. dfc-1.0.0: coverage is
             proven ONLY by this row's own athena-coverage-v1 receipt reading
             complete+saved; anything else (missing reader, refusal, partial)
             stays unproven with its own reason - no skip can bypass the
             clinical floor on an unproven lane. */
          if (pid) perPatientLanes[pid] = {
            v: 2,
            coverage: (p.coverageReceipt && p.coverageReceipt.kind === "athena-coverage-v1" && p.coverageReceipt.complete === true && p.coverageReceipt.status === "saved")
              ? { complete: true }
              : { complete: false, reason: String((p.coverageReceipt && (p.coverageReceipt.reason || p.coverageReceipt.status)) || "reader-not-shipped").slice(0, 60) },
            sameDayNote: { status: sameDayLaneStatus(p) }, /* onheal-1.0.0 */
            allHistory: { scope: receipt.visitNotesRequested === true ? "full" : "day-facts", complete: p.visitsComplete === true && p.visitsSkipped !== true ? true : (receipt.visitNotesRequested !== true && p.visitsComplete === true) }
          };
          /* fa-1.0: a row that cleared on re-check or redo keeps its
             first-attempt evidence IN THE LEDGER - first-attempt convergence
             is the bar, and until now the cure overwrote its own evidence
             (the split was capture-dependent and captures died three ways in
             one night). Bounded: reason head + the compact read receipt. */
          if (pid && (p.firstAttempt || p.axEntry === "body-depth")) {
            perPatientDiag[pid] = { fa: p.firstAttempt ? { reason: String(p.firstAttempt.reason || "").slice(0, 80), receipt: p.firstAttempt.visitsReadReceipt || null, hist: p.firstAttempt.hist || null } : null, redo: p.axEntry === "body-depth", cleared: true };
          }
          return;
        }
        var why = String(p.reason || "incomplete").slice(0, 120);
        if (pid) perPatient[pid] = why;
        reasons[why] = (reasons[why] || 0) + 1;
        /* mdx-1.1.0: persist the PHI-free sub-cause evidence beside the reason
           string - bounded (≤40 patients per day ledger by construction). */
        if (pid && (p.visitsFailedHistogram || p.visitsEnumDiag || p.visitsReadReceipt)) {
          perPatientDiag[pid] = { hist: p.visitsFailedHistogram || null, enumDiag: p.visitsEnumDiag || null, receipt: p.visitsReadReceipt || null };
        }
      });
      (receipt.retry || []).forEach(function (r) {
        if (!r) return;
        var why = String(r.reason || "history-partial").slice(0, 120);
        var pid = String(r.patientId || "");
        if (pid && !perPatient[pid]) perPatient[pid] = why;
        reasons[why] = (reasons[why] || 0) + 1;
      });
      x.history = {
        at: Date.now(),
        proofVersion: 2, /* cachev-1.0.0 */
        perPatientLanes: perPatientLanes,
        requestId: String(receipt.requestId || ""),
        /* dayRows is the DAYS OWN patient count. requested is only what the
           batch was handed, so the two disagreeing is itself the finding: it
           means patients were never queued for history at all. */
        dayRows: Number(dayRowCount || 0),
        requested: Number(receipt.requested || 0),
        processed: Number(receipt.processed || 0),
        storedOk: storedOk,
        failures: Number(receipt.failures || 0),
        timedOut: receipt.timedOut === true,
        complete: receipt.complete === true,
        verdict: String(receipt.reason || ""),
        reasons: reasons,
        perPatient: perPatient,
        perPatientDiag: perPatientDiag,
        /* b752: the CENSUS OF THE STORE, recorded next to the walk counts so
           the two can be compared after the fact. contentOk/contentNone are
           the answer to the question this ledger could not answer before:
           how many of the days patients actually hold clinical content. */
        contentOk: Number(census.withContent || 0),
        contentNone: Number(census.withoutContent || 0),
        contentGap: Number(census.gap || 0),
        contentMeasured: census.measured === true,
        contentVerified: receipt.contentVerified === true,
        /* WHAT THIS PULL ACTUALLY CHANGED, next to what the store holds. The
           measured pull left the store byte identical, so contentChanged 0
           beside contentOk 19 is the shape of the defect written down. An
           unchanged record is legitimate on its own - the pair is the finding.
           athenaSourced counts records holding an Athena-attributed snapshot,
           which is how a fact the clinician typed by hand can be told apart
           from a fact a chart read brought in. */
        contentChanged: Number(delta.changed || 0),
        contentUnchanged: Number(delta.unchanged || 0),
        contentCompared: Number(delta.compared || 0),
        changeMeasured: delta.measured === true,
        athenaSourced: Number(census.athenaSourced || 0),
        neverAttempted: Number(census.neverAttempted || 0),
        /* dn-1.0: persist the day-note lane's truth in the day ledger - count,
           reason histogram, and per-patient refusals (pid -> reason head).
           Bounded: <=40 patients/day by construction, reasons sliced. */
        todayNoteFailures: Number(receipt.todayNoteFailures || 0),
        todayNoteReasons: (function () { var oTn = {}; try { Object.keys(receipt.todayNoteReasons || {}).slice(0, 20).forEach(function (kTn) { oTn[String(kTn).slice(0, 80)] = Number(receipt.todayNoteReasons[kTn] || 0); }); } catch (eTn) {} return oTn; })(),
        todayNoteRefused: (function () { var oTr = {}; try { (receipt.patients || []).forEach(function (pTr) { if (pTr && pTr.todayNote === false && pTr.patientId) oTr[String(pTr.patientId)] = String(pTr.todayNoteReason || "unknown").slice(0, 80); }); } catch (eTr) {} return oTr; })(),
        /* dnrs-1.0.0: WHEN each patient's pulled-day note was last read and
           saved. This is what makes "a note already saved is never re-opened"
           an evidence test rather than a marker - a same-day re-pull reads it
           back, checks the 12 h / same-account-day bar, and skips the open.
           It MERGES with what a previous pull recorded: a second pull of the
           same day must not erase the first pull's reads. Bounded (<=40
           patients/day by construction) and PHI-free: ids and timestamps. */
        todayNoteReadAt: (function () {
          var oRa = {};
          try {
            var prior = (x.history && x.history.todayNoteReadAt) || {};
            for (var kP in prior) if (Object.prototype.hasOwnProperty.call(prior, kP) && Number(prior[kP]) > 0) oRa[String(kP)] = Number(prior[kP]);
            (receipt.patients || []).forEach(function (pRa) {
              if (!pRa || !pRa.patientId) return;
              if (pRa.todayNote === true) oRa[String(pRa.patientId)] = Date.now();
              else if (pRa.todayNote === "already-read" && Number(pRa.todayNoteReadAt || 0) > 0) oRa[String(pRa.patientId)] = Number(pRa.todayNoteReadAt);
            });
          } catch (eRa) {}
          return oRa;
        })(),
        /* p1-todaynote-deferred-retry-1.0.0: how many rows lost the lease race
           and what the ONE deferred round made of them. Counts only. */
        todayNoteDeferred: (function () { var d = receipt.todayNoteDeferred; if (!d || typeof d !== "object") return null; return { queued: Number(d.queued || 0), attempted: Number(d.attempted || 0), recovered: Number(d.recovered || 0), remaining: Number(d.remaining || 0), reason: String(d.reason || "").slice(0, 40) }; })(),
        census: ledgerCensus
      };
      writeIndex(day, x);
    });
  }
  function markDone(key, meta) {
    var day = String((meta && meta.date) || ""), x = readIndex(day);
    if (x._p1MetadataUnavailable) return { ok: false, reason: "metadata-persist-failed" };
    x.rows[key] = { state: "done", patientId: String((meta && meta.patientId) || ""), backendAppointmentId: String((meta && meta.backendAppointmentId) || ""), appt_date: String((meta && meta.date) || ""), updated: Date.now() };
    var saved = writeIndex(day, x); if (saved) delete inFlight[key];
    return saved ? { ok: true } : { ok: false, reason: String((p1MetadataFailure() || {}).reason || "metadata-persist-failed") };
  }
  function claim(key, meta) {
    if (inFlight[key]) return "";
    var day = String((meta && meta.date) || ""), now = Date.now(), x = readIndex(day), old = x.rows[key];
    if (x._p1MetadataUnavailable) return "";
    if (old && old.state === "done") return "";
    if (old && old.state === "pending" && now - Number(old.updated || 0) < PENDING_TTL) return "";
    var owner = now.toString(36) + Math.random().toString(36).slice(2);
    x.rows[key] = { state: "pending", owner: owner, patientId: String((meta && meta.patientId) || ""), appt_date: String((meta && meta.date) || ""), updated: now };
    if (!writeIndex(day, x)) return "";
    var check = readIndex(day).rows[key];
    if (!check || check.state !== "pending" || check.owner !== owner) return "";
    inFlight[key] = owner; return owner;
  }
  function rollback(key, owner, day) {
    var x = readIndex(day), old = x.rows[key];
    if (!x._p1MetadataUnavailable && old && old.state === "pending" && old.owner === owner) { delete x.rows[key]; writeIndex(day, x); }
    if (inFlight[key] === owner) delete inFlight[key];
  }
  function clearDone(key, day, backendAppointmentId) {
    var x = readIndex(day), old = x.rows[key];
    if (x._p1MetadataUnavailable) return false;
    if (!old || old.state !== "done") return false;
    if (backendAppointmentId && String(old.backendAppointmentId || "") !== String(backendAppointmentId)) return false;
    delete x.rows[key]; if (!writeIndex(day, x)) return false; delete inFlight[key]; return true;
  }

  /* ---- authoritative Athena day/provider snapshots ------------------------
   * The backend calendar is intentionally append/enrich-only because it can
   * also contain manually entered MLS rows. A verified Athena pull therefore
   * publishes a separate, account-local snapshot containing backend ids only
   * (no names, DOBs, or other PHI). Schedule-facing UI may consume that exact
   * slice while the raw calendar remains untouched. A snapshot is published
   * only when every source row maps 1:1 to one unique backend appointment. */
  function authoritativeKey() {
    return safe(function () { return isFn(window.uns) ? window.uns(AUTHORITATIVE_SNAPSHOT_SUFFIX) : ""; }, "");
  }
  function sanitizeAuthoritativeStore(value, report) {
    if (!value || value.v !== 1 || !value.days || typeof value.days !== "object" || Array.isArray(value.days)) return null;
    if (Object.keys(value).some(function (key) { return key !== "v" && key !== "days"; })) return null;
    var dayKeys = Object.keys(value.days);
    if (dayKeys.length > 90) return null;
    /* p1-authority-quarantine-1.0.0 (owner report 2026-08-16): this used to be
       whole-store all-or-nothing — one malformed day anywhere in the 45-day
       blob returned null, every consumer went fail-closed, and
       publishAuthoritativeSnapshot refused with "authority-store-invalid".
       Because writeAuthoritativeStore also sanitizes before writing, the bad
       bytes could never be replaced, so a single poisoned day wedged EVERY
       future pull permanently. A day that cannot be validated is now
       quarantined on its own: it is dropped from the returned store and named
       in report.dropped, so it still fails closed for its own date while the
       other days stay usable and the next clean write rewrites the blob
       without it. The whole-blob checks above are unchanged — a store whose
       shape is alien is still refused outright. */
    var clean = { v: 1, days: {} }, dropped = [];
    function cleanSnapshot(raw, day, expectedMode, expectedKey) {
      if (!raw || raw.v !== 1 || normDate(raw.date) !== day || raw.date !== day || raw.mode !== expectedMode) return null;
      var allowed = { v: 1, date: 1, mode: 1, providerKey: 1, backendIds: 1, sourceCount: 1, updated: 1 };
      if (Object.keys(raw).some(function (key) { return !allowed[key]; })) return null;
      var providerKeyRaw = String(raw.providerKey || ""), count = Number(raw.sourceCount), updated = Number(raw.updated);
      if (expectedMode === "all" ? !!providerKeyRaw : providerKeyRaw !== expectedKey) return null;
      if (!Array.isArray(raw.backendIds) || !isFinite(count) || count < 0 || Math.floor(count) !== count || count > 10000 || raw.backendIds.length !== count || !isFinite(updated) || updated <= 0) return null;
      var ids = [], seen = {};
      for (var i = 0; i < raw.backendIds.length; i++) {
        var id = appointmentCensusBackendId(raw.backendIds[i]);
        if (!id || seen[id]) return null;
        seen[id] = 1; ids.push(id);
      }
      return { v: 1, date: day, mode: expectedMode, providerKey: providerKeyRaw, backendIds: ids, sourceCount: count, updated: updated };
    }
    /* Validate ONE day in isolation. Returns the cleaned entry, or null when
       this day alone cannot be trusted. It must never reach outside its own
       day, so every refusal below is local. */
    function cleanDay(rawDay) {
      var day = normDate(rawDay), entry = value.days[rawDay];
      if (!day || day !== rawDay || !entry || typeof entry !== "object" || Array.isArray(entry)) return null;
      if (Object.keys(entry).some(function (key) { return key !== "all" && key !== "providers" && key !== "active"; })) return null;
      var providers = entry.providers;
      if (!providers || typeof providers !== "object" || Array.isArray(providers) || Object.keys(providers).length > 250) return null;
      var cleanEntry = { all: null, providers: {} }, bad = false;
      if (entry.all != null) {
        cleanEntry.all = cleanSnapshot(entry.all, day, "all", "");
        if (!cleanEntry.all) return null;
      }
      Object.keys(providers).forEach(function (key) {
        if (bad) return;
        if (!key || key.length > 240 || /[\x00-\x1f\x7f]/.test(key)) { bad = true; return; }
        var snap = cleanSnapshot(providers[key], day, "selected", key);
        if (!snap) { bad = true; return; }
        cleanEntry.providers[key] = snap;
      });
      if (bad) return null;
      if (entry.active != null) {
        var active = entry.active;
        if (!active || typeof active !== "object" || Array.isArray(active) || Object.keys(active).some(function (key) { return key !== "mode" && key !== "key"; })) return null;
        var mode = String(active.mode || ""), key = String(active.key || "");
        if (mode === "all") {
          if (key || !cleanEntry.all) return null;
          cleanEntry.active = { mode: "all", key: "" };
        } else if (mode === "provider") {
          if (!key || !cleanEntry.providers[key]) return null;
          cleanEntry.active = { mode: "provider", key: key };
        } else return null;
      }
      return { day: day, entry: cleanEntry };
    }
    dayKeys.forEach(function (rawDay) {
      var ok = cleanDay(rawDay);
      if (!ok) { dropped.push(String(rawDay)); return; }
      clean.days[ok.day] = ok.entry;
    });
    if (report && typeof report === "object") report.dropped = dropped.slice();
    return clean;
  }
  function loadAuthoritativeStore() {
    var k = authoritativeKey();
    if (!k) return { ok: false, reason: "authority-store-key-unavailable", store: null };
    try {
      var raw = localStorage.getItem(k);
      if (!raw) return { ok: true, reason: "empty", store: { v: 1, days: {} }, quarantined: [] };
      var report = {};
      var x = sanitizeAuthoritativeStore(JSON.parse(raw), report);
      if (!x) {
        return { ok: false, reason: "authority-store-invalid", store: null, quarantined: [] };
      }
      /* Days named here failed validation on their own and are absent from
         the returned store. Callers must keep serving those exact dates
         fail-closed; every other date is verified and usable. */
      var quarantined = (report.dropped || []).slice();
      return { ok: true, reason: quarantined.length ? "ok-quarantined" : "ok", store: x, quarantined: quarantined };
    } catch (eReadAuthorityStore) {
      /* Never let a fresh tab reinterpret unreadable provider authority as an
         empty store. Consumers must stay fail-closed and publishers must not
         overwrite bytes they could not validate. */
      return { ok: false, reason: "authority-store-read-failed", store: null };
    }
  }
  /* True when this exact date was dropped by the sanitizer and is therefore
     absent from the loaded store. Distinguishes "we could not verify this
     day" from "nothing was ever pulled for this day", which look identical
     once the day is missing. */
  function isQuarantinedDay(loaded, day) {
    var d = normDate(day) || String(day || "");
    if (!d || !loaded || !loaded.quarantined || !loaded.quarantined.length) return false;
    for (var i = 0; i < loaded.quarantined.length; i++) {
      if (String(loaded.quarantined[i]) === d) return true;
    }
    return false;
  }
  /* ===== p1-authority-repair-1.0.0 (the quarantine hole) =====
     p1-authority-quarantine-1.0.0 healed a store with ONE bad DAY. It does not
     heal a store whose TOP LEVEL is alien: v!==1, an extra root key, days not
     an object, or more than 90 day keys all return null from
     sanitizeAuthoritativeStore, so loadAuthoritativeStore reports
     "authority-store-invalid" and every consumer fails closed. And because
     writeAuthoritativeStore SANITISES BEFORE WRITING, the bad bytes can never
     be replaced - there is no removeItem for AUTHORITATIVE_SNAPSHOT_SUFFIX
     anywhere in this file. That is permanent: the owner's
     "snapshotPublished:false / authority-store-invalid" cannot clear itself.

     The repair is deliberately the SMALLEST thing that works, and it never
     wipes a day it could have kept:
       1. SALVAGE. Re-shape the raw blob to the only legal top level
          ({v:1, days}) and re-run the SAME per-day validator. Every day that
          validates on its own survives; only days that cannot be validated
          are dropped, exactly as the existing quarantine does. If more than
          90 days are present the NEWEST 90 are kept (the store is capped at
          45 on write, so >90 is already outside the contract).
       2. RESET, only when salvage is impossible - the bytes are not JSON, or
          days is not an object. In that state NO day can be attributed to
          anything, so there is no verified day to lose.
     Both paths are bounded (one pass, no retry, no loop), record a receipt,
     and carry no PHI: the store holds backend appointment ids and dates only. */
  function repairAuthoritativeStore(reason) {
    var out = { attempted: true, action: "none", ok: false, reason: String(reason || ""), salvagedDays: 0, droppedDays: 0, at: Date.now() };
    if (String(reason || "") !== "authority-store-invalid") { out.attempted = false; out.action = "not-applicable"; return out; }
    var k = authoritativeKey();
    if (!k) { out.action = "key-unavailable"; return out; }
    var raw = safe(function () { return localStorage.getItem(k); }, null);
    if (!raw) { out.action = "already-empty"; out.ok = true; return out; }
    var parsed = safe(function () { return JSON.parse(raw); }, null);
    var days = (parsed && typeof parsed === "object" && !Array.isArray(parsed) && parsed.days &&
      typeof parsed.days === "object" && !Array.isArray(parsed.days)) ? parsed.days : null;
    if (days) {
      var keys = Object.keys(days);
      out.droppedDays = 0;
      if (keys.length > 90) {
        /* keep the NEWEST 90 by their own updated stamps; the rest are already
           outside the 45-day write cap and cannot be the day being pulled. */
        keys = keys.slice().sort(function (a, b) {
          function t(d) { var e = days[d]; return Number((e && ((e.all && e.all.updated) || (e.active && e.providers && e.providers[e.active.key] && e.providers[e.active.key].updated))) || 0); }
          return t(b) - t(a);
        }).slice(0, 90);
        out.droppedDays += Object.keys(days).length - keys.length;
      }
      var shaped = { v: 1, days: {} };
      keys.forEach(function (d) { shaped.days[d] = days[d]; });
      var report = {};
      var cleaned = sanitizeAuthoritativeStore(shaped, report);
      if (cleaned) {
        out.droppedDays += (report.dropped || []).length;
        out.salvagedDays = Object.keys(cleaned.days).length;
        var wrote = safe(function () { return localStorage.setItem(k, JSON.stringify(cleaned)), true; }, false);
        if (!wrote) { out.action = "salvage-write-failed"; return out; }
        out.action = "salvaged"; out.ok = true;
        return out;
      }
    }
    /* Nothing in these bytes can be attributed to any day. */
    var removed = safe(function () { return localStorage.removeItem(k), true; }, false);
    out.action = removed ? "reset-unreadable" : "reset-failed";
    out.ok = removed;
    return out;
  }
  /* ===== end p1-authority-repair-1.0.0 ===== */
  function writeAuthoritativeStore(x) {
    x = sanitizeAuthoritativeStore(x);
    if (!x) return false;
    var k = authoritativeKey(); if (!k) return false;
    var raw = safe(function () { return JSON.stringify(x); }, "");
    if (!raw) return false;
    var stored = safe(function () {
      localStorage.setItem(k, raw);
      return localStorage.getItem(k) === raw;
    }, false);
    return stored;
  }
  /* p1-census-1.0.1: a provider-unknown census supersedes the appointment
     list for this day but cannot supersede provider attribution. Remove any
     older all/selected authoritative day before reporting census completion,
     otherwise provider consumers could keep serving stale assignments from a
     previous verified pull. This is fail-closed on persistence failure. */
  function invalidateAuthoritativeDayForCensus(day) {
    day = normDate(day);
    var out = { complete: false, invalidated: false, targetDate: day || "", reason: "unverified" };
    if (!day) { out.reason = "day-unverified"; return out; }
    var key = authoritativeKey(), store = null;
    if (!key) { out.reason = "authority-store-key-unavailable"; return out; }
    /* Read the durable source directly. readAuthoritativeStore intentionally
       falls back to memory on an exception, which is useful for display but
       unsafe for a destructive rewrite: an incomplete fallback could erase
       unrelated days. Missing storage is valid empty state; unreadable or
       malformed storage refuses the census completion. */
    try {
      var raw = localStorage.getItem(key);
      store = raw ? JSON.parse(raw) : { v: 1, days: {} };
    } catch (eReadAuthority) {
      out.reason = "authority-invalidation-read-failed";
      return out;
    }
    if (!store || store.v !== 1 || !store.days || typeof store.days !== "object" || Array.isArray(store.days)) {
      out.reason = "authority-invalidation-store-invalid";
      return out;
    }
    store = safe(function () { return JSON.parse(JSON.stringify(store)); }, null);
    if (!store || !store.days) { out.reason = "authority-invalidation-copy-failed"; return out; }
    var existed = Object.prototype.hasOwnProperty.call(store.days, day);
    if (existed) delete store.days[day];
    /* Always perform a verified write, even when the detached read appeared
       empty. readAuthoritativeStore deliberately falls back to memory on a
       storage read exception; treating that fallback as durable absence could
       leave an unread stale provider snapshot on disk. */
    if (!writeAuthoritativeStore(store)) { out.reason = "authority-invalidation-persist-failed"; return out; }
    out.complete = true; out.invalidated = existed; out.reason = existed ? "prior-authority-removed" : "no-prior-authority";
    if (existed) safe(function () {
      window.__mlsSIAuthoritativeChangedAt = Date.now();
      if (isFn(window.dispatchEvent) && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("mls-authoritative-schedule", { detail: { date: day, scope: "cleared-provider-unknown" } }));
    });
    return out;
  }
  function backendRowId(row) { return String(row && row.id != null ? row.id : "").trim(); }
  function localDayOf(row) {
    var d = normDate(row && row.appt_date); if (d) return d;
    return row && row.start_at ? accountDayFromInstant(row.start_at) : "";
  }
  function appointmentCensusDisplayKey() {
    return safe(function () { return isFn(window.uns) ? window.uns(APPOINTMENT_CENSUS_DISPLAY_SUFFIX) : ""; }, "");
  }
  function appointmentCensusBackendId(value) {
    var id = String(value == null ? "" : value).trim();
    /* Backend appointment IDs are opaque, never patient-facing text. Refuse
       spaces/control characters and cap them before they can enter storage. */
    return /^[A-Za-z0-9._:@\/-]{1,160}$/.test(id) ? id : "";
  }
  function sanitizeAppointmentCensusStore(value) {
    if (!value || value.v !== 1 || !value.days || typeof value.days !== "object" || Array.isArray(value.days)) return null;
    var rootKeys = Object.keys(value);
    if (rootKeys.some(function (key) { return key !== "v" && key !== "days"; })) return null;
    var rawDays = Object.keys(value.days);
    if (rawDays.length > 90) return null;
    var clean = { v: 1, days: {} }, invalid = false;
    rawDays.forEach(function (rawDay) {
      var day = normDate(rawDay), snap = value.days[rawDay];
      if (!day || day !== rawDay || !snap || snap.v !== 1 || snap.date !== day || snap.kind !== "appointment-census-only") { invalid = true; return; }
      var snapKeys = Object.keys(snap), allowed = { v: 1, date: 1, kind: 1, backendIds: 1, sourceCount: 1, providerAttributionComplete: 1, coversPractice: 1, updated: 1 };
      if (snapKeys.some(function (key) { return !allowed[key]; })) { invalid = true; return; }
      if (snap.providerAttributionComplete !== false || snap.coversPractice !== false || !Array.isArray(snap.backendIds)) { invalid = true; return; }
      var count = Number(snap.sourceCount), updated = Number(snap.updated), ids = [], seen = {};
      if (!isFinite(count) || count < 0 || Math.floor(count) !== count || count > 10000 || snap.backendIds.length !== count) { invalid = true; return; }
      for (var i = 0; i < snap.backendIds.length; i++) {
        var id = appointmentCensusBackendId(snap.backendIds[i]);
        if (!id || seen[id]) { invalid = true; return; }
        seen[id] = 1; ids.push(id);
      }
      if (invalid) return;
      if (!isFinite(updated) || updated <= 0) { invalid = true; return; }
      clean.days[day] = {
        v: 1, date: day, kind: "appointment-census-only", backendIds: ids,
        sourceCount: count, providerAttributionComplete: false,
        coversPractice: false, updated: updated
      };
    });
    return invalid ? null : clean;
  }
  function loadAppointmentCensusStore() {
    var key = appointmentCensusDisplayKey();
    if (!key) return { ok: false, reason: "snapshot-key-unavailable", store: { v: 1, days: {} } };
    try {
      var raw = localStorage.getItem(key), parsed = raw ? JSON.parse(raw) : { v: 1, days: {} };
      var clean = sanitizeAppointmentCensusStore(parsed);
      if (!clean) return { ok: false, reason: "snapshot-store-invalid", store: { v: 1, days: {} } };
      return { ok: true, reason: raw ? "ok" : "empty", store: clean };
    } catch (eReadCensus) {
      /* A detached in-memory copy is not durable authority after a storage
         read failure. Refuse it instead of resurrecting a stale day. */
      return { ok: false, reason: "snapshot-store-read-failed", store: { v: 1, days: {} } };
    }
  }
  function writeAppointmentCensusStore(value) {
    var key = appointmentCensusDisplayKey(); if (!key) return false;
    var clean = sanitizeAppointmentCensusStore(value);
    if (!clean) return false;
    var raw = safe(function () { return JSON.stringify(clean); }, "");
    if (!raw) return false;
    var stored = safe(function () {
      localStorage.setItem(key, raw);
      return localStorage.getItem(key) === raw;
    }, false);
    return stored;
  }
  function clearAppointmentCensusDisplayDay(day) {
    day = normDate(day);
    var out = { complete: false, cleared: false, date: day || "", reason: "unverified" };
    if (!day) { out.reason = "day-unverified"; return out; }
    var loaded = loadAppointmentCensusStore();
    if (!loaded.ok) { out.reason = loaded.reason; return out; }
    if (!Object.prototype.hasOwnProperty.call(loaded.store.days, day)) {
      out.complete = true; out.reason = "no-prior-census"; return out;
    }
    var next = safe(function () { return JSON.parse(JSON.stringify(loaded.store)); }, null);
    if (!next || !next.days) { out.reason = "snapshot-copy-failed"; return out; }
    delete next.days[day];
    if (!writeAppointmentCensusStore(next)) { out.reason = "snapshot-clear-persist-failed"; return out; }
    out.complete = true; out.cleared = true; out.reason = "prior-census-cleared";
    return out;
  }
  function publishAppointmentCensusDisplaySnapshot(input) {
    input = input || {};
    var day = normDate(input.date), census = input.appointmentCensusReceipt || null;
    var cal = input.calendarReceipt || null, mappings = Array.isArray(input.resolvedAppointments) ? input.resolvedAppointments : [];
    var expected = Number(census && census.rowCount);
    var out = {
      published: false, complete: false, date: day || "", kind: "appointment-census-only",
      sourceCount: isFinite(expected) ? expected : 0, providerAuthorityPublished: false,
      providerAttributionComplete: false, coversPractice: false, reason: "unverified"
    };
    if (!day || !census || census.complete !== true || census.kind !== "athena-appointment-census" || normDate(census.targetDate) !== day) { out.reason = "census-unverified"; return out; }
    if (!isFinite(expected) || expected < 1 || Math.floor(expected) !== expected || Number(census.uniqueAppointmentIds) !== expected) { out.reason = "census-count-unverified"; return out; }
    if (census.providerAttributionComplete !== false || census.providerSnapshotAllowed !== false || census.noProviderGuess !== true) { out.reason = "provider-boundary-unverified"; return out; }
    if (!cal || cal.complete !== true || cal.appointmentCensusComplete !== true || cal.providerAttributionComplete !== false) { out.reason = "calendar-unverified"; return out; }
    if (Number(cal.attempted) !== expected || Number(cal.accounted) !== expected || Number(cal.mapped) !== expected) { out.reason = "calendar-count-unverified"; return out; }
    if (mappings.length !== expected) { out.reason = "mapping-incomplete"; return out; }
    var sources = {}, backend = {}, backendIds = [];
    for (var i = 0; i < mappings.length; i++) {
      var sourceId = String(mappings[i] && mappings[i].sourceIdentity || "").trim();
      var backendId = appointmentCensusBackendId(mappings[i] && mappings[i].backendAppointmentId);
      if (!sourceId || sourceId.length > 240 || /[\x00-\x1f\x7f]/.test(sourceId) || !backendId || sources[sourceId] || backend[backendId]) { out.reason = "mapping-not-one-to-one"; return out; }
      sources[sourceId] = 1; backend[backendId] = 1; backendIds.push(backendId);
    }
    var loaded = loadAppointmentCensusStore();
    if (!loaded.ok) { out.reason = loaded.reason; return out; }
    var current = loaded.store;
    var next = safe(function () { return JSON.parse(JSON.stringify(current)); }, null);
    if (!next || !next.days) { out.reason = "snapshot-copy-failed"; return out; }
    next.days[day] = {
      v: 1, date: day, kind: "appointment-census-only", backendIds: backendIds,
      sourceCount: expected, providerAttributionComplete: false,
      coversPractice: false, updated: Date.now()
    };
    var days = Object.keys(next.days).sort(function (a, b) { return Number(next.days[a] && next.days[a].updated || 0) - Number(next.days[b] && next.days[b].updated || 0); });
    while (days.length > 45) delete next.days[days.shift()];
    if (!writeAppointmentCensusStore(next)) { out.reason = "snapshot-persist-failed"; return out; }
    out.published = true; out.complete = true; out.reason = "exact-appointment-census";
    out.backendCount = backendIds.length;
    safe(function () {
      window.__mlsSIAppointmentCensusChangedAt = Date.now();
      if (isFn(window.dispatchEvent) && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("mls-appointment-census-display", { detail: { date: day, scope: "appointment-census-only" } }));
    });
    return out;
  }
  function appointmentCensusStatusForDay(day) {
    day = normDate(day);
    var loaded = loadAppointmentCensusStore(), store = loaded.store, snap = day && store.days[day] || null;
    var status = {
      available: false, exactAppointments: false, date: day || "",
      kind: snap ? "appointment-census-only" : "", sourceCount: snap ? Number(snap.sourceCount || 0) : 0,
      activeCount: 0, missingCount: 0, unclassifiedCount: 0,
      providerAttributionComplete: false, coversPractice: false,
      reason: snap ? "backend-rows-pending" : "no-snapshot"
    };
    /* A corrupt or unreadable census store makes every queried day
       indeterminate after a fresh page load: memory cannot tell us whether a
       durable snapshot existed. Own the day as unavailable instead of
       returning "no-snapshot", which would reopen the append-only calendar
       fallback and could resurrect cancelled Athena rows. */
    if (!loaded.ok && day) {
      status.kind = "appointment-census-only";
      status.reason = loaded.reason;
      status.storeUnavailable = true;
      return status;
    }
    if (!snap) return status;
    var wanted = {}, consumed = {}, byId = {}, rows = [], unclassified = 0, duplicates = 0;
    snap.backendIds.forEach(function (id) { wanted[id] = 1; });
    (Array.isArray(window._calAppts) ? window._calAppts : []).forEach(function (row) {
      if (localDayOf(row) !== day) return;
      var id = backendRowId(row);
      if (id && wanted[id] && !consumed[id]) { consumed[id] = 1; byId[id] = row; }
      else { if (id && wanted[id]) duplicates++; unclassified++; }
    });
    snap.backendIds.forEach(function (id) { if (byId[id]) rows.push(byId[id]); });
    status.activeCount = rows.length;
    status.missingCount = snap.backendIds.length - rows.length;
    status.unclassifiedCount = unclassified;
    status.duplicateCount = duplicates;
    status.available = status.missingCount === 0 && duplicates === 0;
    status.exactAppointments = status.available;
    status.reason = status.available ? "exact-appointment-census" : (duplicates ? "duplicate-backend-rows" : "backend-rows-pending");
    status._rows = rows;
    return status;
  }
  function appointmentCensusRowsForDay(day) {
    var status = appointmentCensusStatusForDay(day);
    return status.available ? status._rows.slice() : null;
  }
  function selectedSnapshot(day, rawProvider) {
    var loaded = loadAuthoritativeStore();
    if (!loaded.ok) return { _storeUnavailable: true, _storeReason: loaded.reason };
    /* A quarantined date owns itself fail-closed exactly as an unreadable
       whole store used to, and reports the same reason, so a consumer can
       never mistake an unverifiable day for an unowned one. */
    if (isQuarantinedDay(loaded, day)) return { _storeUnavailable: true, _storeReason: "authority-store-invalid" };
    var store = loaded.store, entry = store.days[String(day || "")] || null;
    if (!entry) return null;
    var req = providerRequest(rawProvider);
    if (req.mode === "selected") {
      var selected = entry.providers && entry.providers[req.key] || null;
      if (selected) return selected;
      /* A complete all-provider snapshot proves the exact day membership even
         when this clinician has never been pulled separately. Reuse only that
         membership, then let authoritativeStatusForDay filter the hydrated
         rows by the requested canonical provider key. This never reopens the
         append-only raw calendar for a selected view. */
      if (entry.all) {
        var derived = {};
        for (var kAll in entry.all) if (Object.prototype.hasOwnProperty.call(entry.all, kAll)) derived[kAll] = entry.all[kAll];
        derived.mode = "provider-from-all";
        derived.providerKey = req.key;
        derived.membershipMode = "all";
        return derived;
      }
      return null;
    }
    /* An omitted provider means the unfiltered day, never whichever selected
       provider happened to publish most recently. This keeps a selected
       subset from masquerading as "All providers" in schedule consumers. */
    return entry.all || null;
  }
  function publishAuthoritativeSnapshot(input) {
    input = input || {};
    var date = normDate(input.date), scheduleReceipt = input.scheduleReceipt || null;
    var providerReceipt = input.providerReceipt || null, calendarReceipt = input.calendarReceipt || null;
    var req = providerRequest(input.provider), mappings = Array.isArray(input.resolvedAppointments) ? input.resolvedAppointments : [];
    var expected = Number(calendarReceipt && calendarReceipt.attempted);
    var out = { published: false, complete: false, date: date || "", scope: req.mode, providerKey: req.key || "", expected: isFinite(expected) ? expected : 0, mapped: mappings.length, reason: "unverified" };
    if (!date || !scheduleReceipt || scheduleReceipt.complete !== true) { out.reason = "schedule-unverified"; return out; }
    var emptyContract = authoritativeEmptyContract({
      scheduleReceipt: scheduleReceipt,
      returnedAppointments: input.returnedAppointments,
      diag: input.diag,
      providerDiag: input.providerDiag,
      calendarReceipt: calendarReceipt,
      resolvedAppointments: mappings
    });
    if (!emptyContract.ok) { out.reason = emptyContract.reason; out.contradiction = emptyContract; return out; }
    if (req.mode === "selected" && (!providerReceipt || providerReceipt.complete !== true)) { out.reason = "provider-unverified"; return out; }
    if (!calendarReceipt || calendarReceipt.complete !== true || !isFinite(expected) || expected < 0) { out.reason = "calendar-unverified"; return out; }
    if (expected > 0 && (!providerReceipt || providerReceipt.complete !== true)) { out.reason = "provider-unverified"; return out; }
    var verifiedEmpty = scheduleReceipt.authoritativeEmpty === true || (req.mode === "selected" && providerReceipt && providerReceipt.reason === "provider-empty");
    if (expected === 0 && !verifiedEmpty) { out.reason = "empty-unverified"; return out; }
    var sourceSeen = {}, backendSeen = {}, backendIds = [];
    for (var i = 0; i < mappings.length; i++) {
      var sourceIdentity = String(mappings[i] && mappings[i].sourceIdentity || ""), backendId = String(mappings[i] && mappings[i].backendAppointmentId || "");
      if (!sourceIdentity || !backendId || sourceSeen[sourceIdentity] || backendSeen[backendId]) { out.reason = "mapping-not-one-to-one"; return out; }
      sourceSeen[sourceIdentity] = 1; backendSeen[backendId] = 1; backendIds.push(backendId);
    }
    if (mappings.length !== expected || backendIds.length !== expected) { out.reason = "mapping-incomplete"; return out; }
    /* Work on a detached copy so a quota/storage failure cannot mutate the
       last verified in-memory snapshot by reference before persistence. */
    var loadedAuthority = loadAuthoritativeStore();
    /* p1-authority-repair-1.0.0: a whole-store refusal is the one failure that
       could never clear itself. Try the bounded repair ONCE and re-load; if it
       still refuses, the original reason is what the receipt reports - the
       repair may never invent a success. */
    if (!loadedAuthority.ok && loadedAuthority.reason === "authority-store-invalid") {
      var repair = safe(function () { return repairAuthoritativeStore(loadedAuthority.reason); }, null);
      out.authorityRepair = repair;
      if (repair && repair.ok === true) loadedAuthority = loadAuthoritativeStore();
    }
    if (!loadedAuthority.ok) { out.reason = loadedAuthority.reason; return out; }
    /* Refuse to publish over a date whose own stored bytes could not be
       validated, and do not attempt the write: those bytes may belong to
       another lane and this publisher is not the thing that gets to decide
       they are worthless. Every OTHER date still publishes normally, and
       that write rewrites the blob without the quarantined day — which is
       how a poisoned store heals instead of wedging forever. */
    if (isQuarantinedDay(loadedAuthority, date)) { out.reason = "authority-store-invalid"; return out; }
    out.quarantinedDays = (loadedAuthority.quarantined || []).length;
    var store = safe(function () { return JSON.parse(JSON.stringify(loadedAuthority.store)); }, null);
    if (!store || !store.days) { out.reason = "snapshot-copy-failed"; return out; }
    var entry = store.days[date] || { all: null, providers: {} };
    if (!entry.providers || typeof entry.providers !== "object") entry.providers = {};
    var snap = { v: 1, date: date, mode: req.mode, providerKey: req.key || "", backendIds: backendIds, sourceCount: expected, updated: Date.now() };
    if (req.mode === "selected") { entry.providers[req.key] = snap; entry.active = { mode: "provider", key: req.key }; }
    else { entry.all = snap; entry.active = { mode: "all", key: "" }; }
    store.days[date] = entry;
    var days = Object.keys(store.days).sort(function (a, b) {
      var aa = store.days[a], bb = store.days[b];
      var at = Number(aa && ((aa.all && aa.all.updated) || (aa.active && aa.providers && aa.providers[aa.active.key] && aa.providers[aa.active.key].updated)) || 0);
      var bt = Number(bb && ((bb.all && bb.all.updated) || (bb.active && bb.providers && bb.providers[bb.active.key] && bb.providers[bb.active.key].updated)) || 0);
      return at - bt;
    });
    while (days.length > 45) delete store.days[days.shift()];
    if (!writeAuthoritativeStore(store)) { out.reason = "snapshot-persist-failed"; return out; }
    /* Persist the stronger proof before touching the existing appointment
       census. If this write fails, the prior exact 26-ID display slice stays
       intact. Only an all-provider snapshot supersedes a whole-day census;
       a selected-provider snapshot is stronger for its subset only and must
       coexist so clearing the visible filter can still reveal the exact day. */
    var censusClear = req.mode === "all"
      ? clearAppointmentCensusDisplayDay(date)
      : { complete: true, cleared: false, date: date, reason: "selected-scope-coexists" };
    out.appointmentCensusDisplayClear = censusClear;
    if (!censusClear.complete) {
      out.providerSnapshotPersisted = true;
      out.reason = "census-display-clear-failed";
      return out;
    }
    out.published = true; out.complete = true; out.reason = expected ? "exact" : "authoritative-empty";
    out.backendCount = backendIds.length;
    safe(function () {
      window.__mlsSIAuthoritativeChangedAt = Date.now();
      if (isFn(window.dispatchEvent) && typeof CustomEvent === "function") window.dispatchEvent(new CustomEvent("mls-authoritative-schedule", { detail: { date: date, scope: req.mode } }));
    });
    return out;
  }
  function authoritativeStatusForDay(day, rawProvider) {
    day = normDate(day); var snap = selectedSnapshot(day, rawProvider);
    var status = { available: false, exact: false, date: day || "", scope: snap && snap.mode || "", sourceCount: snap && Number(snap.sourceCount || 0) || 0, activeCount: 0, missingCount: 0, unclassifiedCount: 0, reason: snap ? "backend-rows-pending" : "no-snapshot" };
    if (snap && snap._storeUnavailable) {
      status.scope = "authority-unavailable";
      status.reason = String(snap._storeReason || "authority-store-unavailable");
      status.storeUnavailable = true;
      return status;
    }
    if (!snap) return status;
    var wanted = {}, consumed = {}, byId = {}, ids = snap.backendIds || [], raw = Array.isArray(window._calAppts) ? window._calAppts : [], rows = [], unclassified = 0;
    ids.forEach(function (id) { wanted[String(id)] = 1; });
    raw.forEach(function (row) {
      if (localDayOf(row) !== day) return;
      var id = backendRowId(row);
      if (id && wanted[id] && !consumed[id]) { consumed[id] = 1; byId[id] = row; }
      else unclassified++;
    });
    ids.forEach(function (id) { if (byId[String(id)]) rows.push(byId[String(id)]); });
    var missing = ids.filter(function (id) { return !consumed[String(id)]; }).length;
    if (snap.mode === "provider-from-all") {
      rows = rows.filter(function (row) { return providerKey(p1RowProviderName(row)) === snap.providerKey; });
      status.scope = "all";
      status.requestedScope = "selected";
      status.sourceCount = rows.length;
      status.derivedFromAllMembership = true;
    }
    status.activeCount = rows.length; status.missingCount = missing; status.unclassifiedCount = unclassified;
    status.available = missing === 0; status.exact = status.available; status.reason = status.available ? (ids.length ? "exact" : "authoritative-empty") : "backend-rows-pending";
    status._rows = rows; return status;
  }
  function authoritativeRowsForDay(day, rawProvider) {
    var status = authoritativeStatusForDay(day, rawProvider);
    return status.available ? status._rows.slice() : null;
  }
  /* ===== padopt-1.0.0 (appointment -> chart adoption) =====================
     MEASURED on the owner's live account 2026-08-26: 25 of 29 appointment rows
     on one pulled day carried a freshly MINTED "p_sched_" identity while the
     same human already had a local chart, so the day's visit, the appointment
     binding and the profile the doctor opens all landed on different rows.
     Both zero-match tails of findPatient below were reached for rows that DID
     carry proof, because the MRN and DOB tiers compare normName(), which is
     byte-exact: "Brooks, Bernard P", "Bernard P Brooks" and "Bernard Brooks"
     are three different keys, so a real chart for the same human scored zero.

     This tier normalises the NAME SHAPE only. Identity still rests on a
     POSITIVELY AGREEING second factor (DOB or MRN), exactly one survivor, and
     a NATIVE local row preferred over capture debris when several agree. Every
     existing refusal is untouched and runs first: this tier can only turn a
     MISS into a match, never a refusal into a match. A merely ABSENT second
     factor proves nothing and never adopts; any conflicting one refuses. */
  var PADOPT_NAME_NOISE = /\b(jr|sr|ii|iii|iv|md|do|np|pa|dds|dmd|phd)\b/g;
  function padoptNameKey(s) {
    var t = String(s || "").toLowerCase().replace(/[.]/g, " ").replace(/[^a-z0-9,\s]/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return "";
    t = t.replace(PADOPT_NAME_NOISE, " ").replace(/\s+/g, " ").trim();
    var first = "", last = "";
    if (t.indexOf(",") >= 0) {
      var parts = t.split(",");
      last = String(parts[0] || "").trim().split(" ")[0] || "";
      first = String(parts[1] || "").trim().split(" ")[0] || "";
    } else {
      var w = t.split(" ").filter(function (x) { return !!x; });
      if (w.length < 2) return "";
      first = w[0]; last = w[w.length - 1];
    }
    if (!first || !last) return "";
    return first + "|" + last;
  }
  function padoptTokens(s) {
    var t = String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return [];
    t = t.replace(PADOPT_NAME_NOISE, " ").replace(/\s+/g, " ").trim();
    var out = [], w = t.split(" "), i;
    for (i = 0; i < w.length; i++) if (w[i] && w[i].length > 1 && out.indexOf(w[i]) < 0) out.push(w[i]);
    return out;
  }
  /* first+last canonical key, or full token containment in EITHER direction
     with at least two shared tokens - which is what reconciles a stored
     "Bernard Brooks" with an Athena "Brooks, Bernard P". */
  function padoptNameMatch(left, right) {
    var lk = padoptNameKey(left), rk = padoptNameKey(right);
    if (lk && rk && lk === rk) return true;
    var lt = padoptTokens(left), rt = padoptTokens(right), shared = 0, i;
    if (lt.length < 2 || rt.length < 2) return false;
    /* padopt-1.0.1 (refuter 2026-08-26): containment alone let order-swapped
       names match - "Robert James" and "James Robert" are two different
       humans. The LAST token must agree before containment counts. The
       comma-form "Brooks, Bernard P" still reconciles: padoptNameKey parses
       the comma order and matches on the first|last key above this gate. */
    if (lt[lt.length - 1] !== rt[rt.length - 1]) return false;
    for (i = 0; i < lt.length; i++) if (rt.indexOf(lt[i]) >= 0) shared++;
    if (shared < 2) return false;
    return shared === lt.length || shared === rt.length;
  }
  /* padopt-1.0.1: a placeholder is not proof. An MRN must carry at least four
     digits and may not be one digit repeated; a DOB must survive the strict
     calendar validation. Junk on BOTH sides can otherwise agree with itself
     and buy an adoption. */
  function padoptValidMrn(m) {
    var s = String(m == null ? "" : m).replace(/\D+/g, "");
    if (s.length < 4) return "";
    if (/^(\d)\1+$/.test(s)) return "";
    return s;
  }
  /* The live store holds the same human as several rows: a "p_sched_" schedule
     mint, an all-digits Athena capture, and a "_"+digits capture twin. The
     NATIVE row is the chart the doctor opens, so it wins - the same partition
     the backend's own adoption pick applies. */
  function padoptIsDebrisId(id) {
    var s = String(id == null ? "" : id).trim();
    if (!s) return true;
    return /^p_sched_/.test(s) || /^_?\d+$/.test(s);
  }
  /* A row bearing an Athena chart id that matched NOTHING falls through to the
     stricter MRN/DOB tiers, because a MISS is not a conflict. What it may
     never do is land on a local row PROVABLY stamped with a DIFFERENT Athena
     chart id: that is two charts, and it fails closed like every other
     conflict. Absent on either side proves nothing and refuses nothing. */
  function padoptSourceConflict(p, sourceId) {
    if (!sourceId) return false;
    var own = rowSourcePatientId(p);
    return !!own && own.toLowerCase() !== String(sourceId).toLowerCase();
  }
  /* Returns { id: "<local id>", why: "<code>" }. id is "" on every refusal.
     why is a closed, PHI-free vocabulary the receipt may carry. */
  function padoptResolve(pts, a) {
    pts = Array.isArray(pts) ? pts : [];
    /* padopt-1.0.1 (refuter): the second factor must be REAL proof. A
       placeholder DOB ("Unknown", an impossible date) or a placeholder MRN
       can agree with its own junk twin on the store row and buy a wrong-human
       adoption; both sides now pass the strict validators before they may
       count as proof OR as conflict. */
    var dk = validDobProof(a && a.dob), mk = padoptValidMrn(rowMrn(a)), sk = rowSourcePatientId(a), i, p;
    if (!dk && !mk) return { id: "", why: "no-dob-and-no-mrn" };
    if (!padoptTokens(a && a.name).length) return { id: "", why: "no-usable-name" };
    var nameMatches = [];
    for (i = 0; i < pts.length; i++) {
      p = pts[i];
      if (!p || p.id == null || !String(p.id).trim()) continue;
      if (padoptNameMatch(p.name, a && a.name)) nameMatches.push(p);
    }
    if (!nameMatches.length) return { id: "", why: "tolerant-name-no-match" };
    var eligible = [], conflicted = 0;
    for (i = 0; i < nameMatches.length; i++) {
      p = nameMatches[i];
      var pd = validDobProof(p.dob), pm = padoptValidMrn(rowMrn(p));
      if ((dk && pd && pd !== dk) || (mk && pm && pm !== mk) || padoptSourceConflict(p, sk)) { conflicted++; continue; }
      if ((dk && pd === dk) || (mk && pm === mk)) eligible.push(p);
    }
    if (!eligible.length) return { id: "", why: conflicted ? "tolerant-name-conflict" : "tolerant-name-unproven" };
    if (eligible.length > 1) {
      var native = eligible.filter(function (one) { return !padoptIsDebrisId(one && one.id); });
      if (native.length !== 1) return { id: "", why: "tolerant-name-ambiguous" };
      eligible = native;
    }
    /* THE INVARIANT: the adopted value is always the id of a row that is IN the
       local store. A raw Athena chart id, an MRN or any other source-side
       identifier can therefore never masquerade as a local id here - the only
       way one appears is if a real local row already carries it, in which case
       adopting that row is exactly right. padoptAdopt re-proves the membership
       before it hands the row back. */
    return { id: String(eligible[0].id), why: "tolerant-name-adopted" };
  }
  /* The exact-name tiers can legitimately land on CAPTURE DEBRIS - a p_sched_
     mint or an all-digits/underscore-digits capture twin - while the chart the
     doctor actually opens is a NATIVE row for the same human carrying the same
     proof. The native row wins, the same partition the backend's own adoption
     pick applies. Two hard limits: the tolerant tier must prove the native row
     unambiguously, and a source row that ALREADY carries a local id is never
     re-pointed (moving an existing binding is a different, riskier act, and
     the live store's p_sched rows are load-bearing). */
  function padoptPreferNative(pts, a, exact, notes) {
    if (!exact || exact.id == null || !padoptIsDebrisId(exact.id)) return exact;
    if (rowLocalPatientId(a)) return exact;
    var up = safe(function () { return padoptResolve(pts, a); }, null);
    if (!up || !up.id || up.id === String(exact.id) || padoptIsDebrisId(up.id)) return exact;
    for (var i = 0; i < pts.length; i++) {
      if (String(pts[i] && pts[i].id || "") === up.id) {
        if (notes) { notes.adopted = true; notes.why = "native-preferred-over-debris"; }
        return pts[i];
      }
    }
    return exact;
  }
  function padoptAdopt(pts, a, notes) {
    var verdict = safe(function () { return padoptResolve(pts, a); }, null);
    if (notes && verdict) notes.why = String(verdict.why || "");
    if (!verdict || !verdict.id) return null;
    for (var i = 0; i < pts.length; i++) {
      if (String(pts[i] && pts[i].id || "") === verdict.id) { if (notes) notes.adopted = true; return pts[i]; }
    }
    return null;
  }
  /* ===== end padopt-1.0.0 ================================================= */
  function findPatient(pts, a, notes) {
    /* padopt-1.0.1 (refuter): every tier's second factor passes the strict
       validators. normDob keeps unparseable text as a lowercased token, so
       "Unknown" on both sides used to agree with itself and bind a wrong
       human; validDobProof/padoptValidMrn turn every placeholder into "". */
    var mrn = padoptValidMrn(rowMrn(a)), nk = normName(a && a.name), dk = validDobProof(a && a.dob), i, p;
    var localId = rowLocalPatientId(a);
    if (localId) {
      for (i = 0; i < pts.length; i++) {
        p = pts[i];
        if (String(p && p.id || "") !== localId) continue;
        if (mrn && padoptValidMrn(rowMrn(p)) && padoptValidMrn(rowMrn(p)) !== mrn) return null;
        if (dk && validDobProof(p && p.dob) && validDobProof(p && p.dob) !== dk) return null;
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
      /* padopt-1.0.0: MORE THAN ONE local row stamped with this Athena chart id
         is real ambiguity and still fails closed. ZERO is a MISS, not a
         conflict - no locally created chart has ever been stamped with an
         Athena id, which is the ordinary case on this account - and the MRN and
         DOB tiers below are STRICTER proof than the id that was absent.
         Returning null here sent fully proven rows straight to the mint. */
      if (sourceMatches.length > 1) return null;
      if (sourceMatches.length === 1) {
        p = sourceMatches[0];
        if (mrn && padoptValidMrn(rowMrn(p)) && padoptValidMrn(rowMrn(p)) !== mrn) return null;
        if (dk && validDobProof(p && p.dob) && validDobProof(p && p.dob) !== dk) return null;
        return p;
      }
    }
    if (mrn) {
      var mrnMatches = pts.filter(function (one) { return padoptValidMrn(rowMrn(one)) === mrn; });
      if (mrnMatches.length > 1) return null;
      /* padopt-1.0.0: a row whose Athena chart id matched nothing may fall
         through to this stricter tier, but never onto a local row stamped with
         a DIFFERENT Athena chart id. */
      if (mrnMatches.length === 1) { p = mrnMatches[0]; if (padoptSourceConflict(p, sourceId)) return null; return (!dk || !validDobProof(p && p.dob) || validDobProof(p && p.dob) === dk) ? padoptPreferNative(pts, a, p, notes) : null; }
      if (dk) {
        var fallbackDobMatches = pts.filter(function (one) { return !padoptValidMrn(rowMrn(one)) && normName(one && one.name) === nk && validDobProof(one && one.dob) === dk; });
        if (fallbackDobMatches.length === 1) return padoptSourceConflict(fallbackDobMatches[0], sourceId) ? null : padoptPreferNative(pts, a, fallbackDobMatches[0], notes);
      }
      /* padopt-1.0.0: the exact-name compare found NOTHING. Try the tolerant
         name shape with the same second-factor proof; ambiguity still fails. */
      return padoptAdopt(pts, a, notes);
    }
    if (dk) {
      var dobMatches = pts.filter(function (one) { return normName(one && one.name) === nk && validDobProof(one && one.dob) === dk; });
      if (dobMatches.length === 1) return padoptSourceConflict(dobMatches[0], sourceId) ? null : padoptPreferNative(pts, a, dobMatches[0], notes);
      /* A supplied DOB that does not match must never degrade to name-only.
         padopt-1.0.0: a DOB that AGREES on a differently-shaped name is not a
         degrade - it is the same proof, read through a tolerant name key. */
      return padoptAdopt(pts, a, notes);
    }
    /* A unique display name is not an identity proof. In particular, never
       upgrade a name-only Athena row with DOB/MRN copied from a local record. */
    return null;
  }

  /* An explicit Athena empty-state marker is only authoritative when every
     independent appointment count agrees that the day is empty. A reader bug
     must not turn "authoritativeEmpty: true" into a success while its own
     candidate/parsed/canonical evidence (or returned rows) says otherwise. */
  function authoritativeEmptyContract(input) {
    input = input || {};
    var receipt = input.scheduleReceipt || input.receipt || null;
    var out = { applicable: !!(receipt && receipt.authoritativeEmpty === true), ok: true, reason: "not-empty", field: "", value: null };
    if (!out.applicable) return out;
    function reject(field, value) {
      out.ok = false; out.reason = "authoritative-empty-contradiction";
      out.field = field; out.value = value;
      return out;
    }
    function exactZero(obj, key, required, prefix) {
      var owns = !!(obj && Object.prototype.hasOwnProperty.call(obj, key));
      if (!owns) return required ? reject((prefix || "receipt") + "." + key, "missing") : null;
      var raw = obj[key];
      if (raw === null || raw === "" || typeof raw === "boolean") return reject((prefix || "receipt") + "." + key, raw);
      var n = Number(raw);
      return isFinite(n) && n === 0 ? null : reject((prefix || "receipt") + "." + key, raw);
    }
    if (receipt.complete !== true) return reject("receipt.complete", receipt.complete);
    var required = ["expectedCount", "candidateCount", "parsedCount"];
    for (var i = 0; i < required.length; i++) if (exactZero(receipt, required[i], true, "receipt")) return out;
    var evidenceKeys = [
      "declaredCount", "unnamedCount", "domValidRows", "textValidRows", "mergedRows",
      "canonicalCount", "canonicalRowCount", "reconciledCount", "reconciledRowCount",
      "returnedCount", "returnedRowCount", "appointmentCount", "apptCount"
    ];
    var evidence = [
      { value: receipt, name: "receipt" },
      { value: input.diag, name: "diag" },
      { value: input.providerDiag, name: "providerDiag" }
    ];
    for (var e = 0; e < evidence.length; e++) {
      for (var j = 0; j < evidenceKeys.length; j++) {
        if (exactZero(evidence[e].value, evidenceKeys[j], false, evidence[e].name)) return out;
      }
    }
    var returned = Object.prototype.hasOwnProperty.call(input, "returnedAppointments")
      ? input.returnedAppointments : input.appts;
    if (!Array.isArray(returned)) return reject("returnedAppointments", "missing");
    if (returned.length !== 0) return reject("returnedAppointments.length", returned.length);
    if (input.resolvedAppointments != null) {
      if (!Array.isArray(input.resolvedAppointments)) return reject("resolvedAppointments", "invalid");
      if (input.resolvedAppointments.length !== 0) return reject("resolvedAppointments.length", input.resolvedAppointments.length);
    }
    if (input.calendarReceipt != null) {
      var calendarKeys = [
        "attempted", "accounted", "mapped", "uniqueSources", "uniqueBackend",
        "unresolvedMappings", "created", "repaired", "skipped", "failed", "wrongDay", "invalidDate"
      ];
      for (var c = 0; c < calendarKeys.length; c++) {
        if (exactZero(input.calendarReceipt, calendarKeys[c], false, "calendarReceipt")) return out;
      }
    }
    out.reason = "authoritative-empty";
    return out;
  }

  /* ---- read-only capture of the latest schedule read (for DOM-scrape fallback) ---- */
  var lastResp = null, lastRespAt = 0;
  function onSchedMsg(e) {
    safe(function () {
      var d = e && e.data;
      if (!d || d.source !== "mls-ext" || d.type !== "mlsAppScheduleResult") return;
      var response = d.resp || null;
      if (!authoritativeEmptyContract(response).ok) return;
      lastResp = response; lastRespAt = Date.now(); // memory only; never logged or forwarded
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
    var requireProviderCoverage = requestedProvider.mode === "selected" || opts.requireProviderCoverage === true;
    /* A public/direct caller cannot turn a raw provider-unattributed Athena
       response into an unguarded import by setting requireProviderCoverage
       false. Only the private, request-bound Day grant below may reconcile
       that census. Other direct-import behavior remains unchanged. */
    var p1RawCoverage = providerResp && providerResp.providerRosterReceipt && providerResp.providerRosterReceipt.attributionCoverage;
    if (!requireProviderCoverage && requestedProvider.mode === "all" && p1RawCoverage &&
        String(p1RawCoverage.verdict || "") === "row-unattributed" && Number(p1RawCoverage.rows || 0) > 0) {
      requireProviderCoverage = true;
    }

    function emptyResult(reason, providerReceipt, wrongDay, invalidDate) {
      return { created: 0, repaired: 0, enrichedFields: 0, skipped: 0, failed: 0, attempted: 0,
        wrongDay: Number(wrongDay || 0), invalidDate: Number(invalidDate || 0),
        reason: reason || "empty", days: {}, target: normDate(opts.scopeDate || opts.date) || "",
        scope: normDate(opts.scopeDate) || "", historyTargets: [], historyUnresolved: [],
        resolvedAppointments: [], unresolvedMappings: [], failureReasons: {},
        providerReceipt: providerReceipt || null };
    }

    if (!signedIn()) { toast("Sign in to import the schedule.", "err"); return Promise.resolve({ created: 0, skipped: 0, reason: "signin", days: {} }); }

    /* DOM-scrape fallback: if nothing parsed but the live read has structured rows, use them */
    if (!appts.length) {
      var dom = domApptsFromResp(providerResp);
      if (dom.length) appts = dom;
    }
    if (!appts.length) {
      if (!requireProviderCoverage) return Promise.resolve(emptyResult("empty", null));
      var emptyScope = scopeProviderRows([], opts.provider, providerResp);
      return Promise.resolve(emptyResult(
        emptyScope.complete ? (requestedProvider.mode === "selected" ? "provider-empty" : "empty") : emptyScope.reason,
        emptyScope.receipt
      ));
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
    /* p1-census-1.0.0: only the private guarded-Day grant may substitute an
       appointment census for provider coverage. Its receipt remains
       provider-incomplete, while this internal scope verdict says the exact
       blank-provider rows are eligible for appointment reconciliation. */
    var p1CensusScope = requireProviderCoverage
      ? p1AppointmentCensusScope(opts.__p1AppointmentCensusGrant, appts, opts.provider, providerResp, scopeDate)
      : null;
    var providerScope = p1CensusScope || (requireProviderCoverage
      ? scopeProviderRows(appts, opts.provider, providerResp)
      : { complete: true, reason: "direct-import", rows: appts, receipt: { mode: "all", complete: true, reason: "direct-import", sourceRows: appts.length, providerTaggedRows: appts.filter(function (a0) { return !!providerKey(a0 && a0.provider); }).length, unattributedRows: appts.filter(function (a0) { return !providerKey(a0 && a0.provider); }).length } });
    if (!providerScope.complete) {
      return Promise.resolve(emptyResult(providerScope.reason, providerScope.receipt, wrongDay, invalidDate));
    }
    appts = providerScope.rows;
    if (!appts.length) {
      return Promise.resolve(emptyResult(requestedProvider.mode === "selected" ? "provider-empty" : "empty", providerScope.receipt, wrongDay, invalidDate));
    }

    var token = bkToken(), base = bkBase();
    var pts = (callG("getPatients") || []) || [];
    /* Large accounts can carry years of patients and appointments.  Build the
       immutable local-patient index once instead of repeating pts.find for
       every archived appointment.  First-id wins, exactly matching Array.find. */
    var patientByLocalId = Object.create(null);
    for (var pti = 0; pti < pts.length; pti++) {
      var localPatientId = String(pts[pti] && pts[pti].id || "");
      if (localPatientId && !Object.prototype.hasOwnProperty.call(patientByLocalId, localPatientId)) patientByLocalId[localPatientId] = pts[pti];
    }
    var existingRows = {}, existingAmbiguous = {}, backendById = {};

    function indexExisting(key, row) {
      if (!key || existingAmbiguous[key]) return;
      if (existingRows[key] && String(existingRows[key].id || "") !== String(row && row.id || "")) {
        delete existingRows[key]; existingAmbiguous[key] = 1; return;
      }
      existingRows[key] = row;
    }

    return safe(function () {
      /* The pre-reconcile calendar read stays fail-closed, but a SINGLE attempt
         aborted whole pulls on transient blips (live 2026-07-21: a pull during
         a backend restart hit one refusal and the day was refused with
         "could not verify the existing MLS calendar"). Retry briefly with
         backoff; a final failure still refuses the day exactly as before. */
      var readCalendarOnce = function () {
        return fetch(base + "/api/appointments", { headers: { Authorization: "Bearer " + token } })
          .then(function (r) {
            if (!r.ok) return { appointments: [], __mlsVerified: false, status: Number(r.status || 0) };
            return Promise.resolve(r.json()).then(function (data) {
              data = data && typeof data === "object" ? data : { appointments: [] };
              data.__mlsVerified = true; return data;
            });
          })
          .catch(function () { return { appointments: [], __mlsVerified: false }; });
      };
      var readCalendarAttempt = function (n) {
        return readCalendarOnce().then(function (ed0) {
          if (ed0 && ed0.__mlsVerified === true) return ed0;
          if (n >= 3) return ed0;
          return (window.__mlsBgSleep ? window.__mlsBgSleep(n === 1 ? 600 : 1500) : new Promise(function (res0) { setTimeout(res0, n === 1 ? 600 : 1500); }))
            .then(function () { return readCalendarAttempt(n + 1); });
        });
      };
      return readCalendarAttempt(1);
    }, Promise.resolve({ appointments: [], __mlsVerified: false })).then(async function (ed) {
      if (!ed || ed.__mlsVerified !== true) {
        /* A 401/403 here is an expired MLS session, not an unstable connection
           — name it so the clinician signs in instead of retrying forever. */
        var calReadReason = (ed && (ed.status === 401 || ed.status === 403)) ? "signin-expired" : "calendar-read-unverified";
        var calReadFailures = {}; calReadFailures[calReadReason] = appts.length;
        return { created: 0, repaired: 0, enrichedFields: 0, skipped: 0, failed: appts.length, attempted: appts.length,
          wrongDay: wrongDay, invalidDate: invalidDate, reason: calReadReason, days: {}, target: target,
          scope: scopeDate || "", historyTargets: [], historyUnresolved: [], resolvedAppointments: [],
          unresolvedMappings: appts.map(function (a) { return { sourceIdentity: importKey(a, a._date || normDate(a.date) || target, normTime(a.time)), reason: calReadReason, date: a._date || normDate(a.date) || target }; }),
          failureReasons: calReadFailures,
          providerReceipt: providerScope.receipt };
      }
      var backendAppointments = ed.appointments || [], ledgerByDay = Object.create(null);
      for (var eri = 0; eri < backendAppointments.length; eri++) {
        var x = backendAppointments[eri];
        var rawBackendId = backendRowId(x); if (rawBackendId) backendById[rawBackendId] = x;
        var lt = ""; safe(function () { if (x.start_at) lt = new Date(x.start_at).toTimeString().slice(0, 5); });
        var ld = x.appt_date || ""; if (!ld) safe(function () { if (x.start_at) { var dd = new Date(x.start_at); ld = dd.getFullYear() + "-" + ("0" + (dd.getMonth() + 1)).slice(-2) + "-" + ("0" + dd.getDate()).slice(-2); } });
        var linked = patientByLocalId[String(x && x.patient_external_id || "")] || null;
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
        var dayLedgerCache;
        if (Object.prototype.hasOwnProperty.call(ledgerByDay, ld)) dayLedgerCache = ledgerByDay[ld];
        else {
          var freshDayLedger = readIndex(ld), ledgerIdentityByBackendId = Object.create(null);
          Object.keys(freshDayLedger.rows || {}).forEach(function (ledgerIdentity) {
            var ledgerRow = freshDayLedger.rows[ledgerIdentity] || {}, ledgerBackendId = String(ledgerRow.backendAppointmentId || "");
            if (ledgerRow.state !== "done" || !ledgerBackendId) return;
            if (!ledgerIdentityByBackendId[ledgerBackendId]) ledgerIdentityByBackendId[ledgerBackendId] = [];
            ledgerIdentityByBackendId[ledgerBackendId].push(ledgerIdentity);
          });
          dayLedgerCache = ledgerByDay[ld] = { ledger: freshDayLedger, identitiesByBackendId: ledgerIdentityByBackendId };
        }
        var backendId = String(x && x.id || "");
        var ledgerIdentities = backendId && dayLedgerCache.identitiesByBackendId[backendId] || [];
        for (var li = 0; li < ledgerIdentities.length; li++) indexExisting(ledgerIdentities[li], x);
        /* Yield between bounded archive chunks so the recording/transcript UI,
           pull progress, and browser controls remain responsive.  The source
           snapshot and all exact-identity maps stay frozen for this scan.
           2026-07-15: a hidden MLS tab clamps main-thread setTimeout to ~one
           tick per MINUTE, so a bare setTimeout(0) yield froze the import for
           up to a minute per chunk (the live "stuck mid-pull" report). Yield
           through the worker-backed deadline scheduler, which is immune to
           background-tab throttling; its terminal/failure paths resolve
           immediately instead of parking the pull. */
        if (eri > 0 && eri % 200 === 0) await new Promise(function (resolveChunk) {
          var cancelYield = safe(function () { return absoluteDeadlines.arm(Date.now() + 1, resolveChunk); }, null);
          if (!cancelYield || (isFn(cancelYield.isTerminal) && cancelYield.isTerminal())) resolveChunk();
        });
      }

      var created = 0, repaired = 0, enrichedFields = 0, skipped = 0, failed = 0, days = {};
      /* pa-1.0.0: rows that were ALREADY stored provider-empty and got
         attributed by this re-pull. This is the backfill counter - the only
         honest number for how many of the 400 are fixed now. */
      var providerBackfilled = 0;
      /* PHI-free row-failure telemetry. The old receipt exposed only `failed:N`,
         so an unavailable calendar GET, a refused identity merge, a backend
         write error, and a one-to-one mapping refusal all looked identical.
         Keep counts by fixed reason code only; never retain a patient/row. */
      var failureReasons = Object.create(null);
      function noteImportFailure(reason, amount) {
        reason = String(reason || "calendar-row-unverified").toLowerCase();
        if (!CALENDAR_REASON_CODES[reason]) reason = "calendar-row-unverified";
        amount = Number(amount == null ? 1 : amount);
        if (!isFinite(amount) || amount <= 0) amount = 1;
        failed += amount;
        failureReasons[reason] = Number(failureReasons[reason] || 0) + amount;
        return reason;
      }
      var resolvedAppointments = [], unresolvedMappings = [];
      var requirePatientBinding = opts.requirePatientBinding === true || opts.includeHistory === true;
      function recordResolution(sourceIdentity, backendAppointmentId, date, kind, patientId) {
        sourceIdentity = String(sourceIdentity || ""); backendAppointmentId = String(backendAppointmentId || ""); patientId=String(patientId||"");
        if (!sourceIdentity || !backendAppointmentId || (requirePatientBinding && !patientId)) {
          unresolvedMappings.push({ sourceIdentity: sourceIdentity, reason: !sourceIdentity ? "source-identity-missing" : (!backendAppointmentId ? "backend-id-missing" : "patient-id-missing"), date: String(date || "") });
          return false;
        }
        resolvedAppointments.push({ sourceIdentity: sourceIdentity, backendAppointmentId: backendAppointmentId, patientId:patientId, date: String(date || ""), kind: String(kind || "existing") });
        return true;
      }
      function lastMappingReason(fallback) {
        var last = unresolvedMappings.length ? unresolvedMappings[unresolvedMappings.length - 1] : null;
        return String(last && last.reason || fallback || "mapping-unresolved");
      }
      /* Bind every imported/skipped appointment to one immutable MLS patient
         before any asynchronous chart work begins. The history pipeline uses
         these IDs (plus DOB/MRN proof), never a later name-only lookup. */
      var historyTargets = [], historyTargetState = {}, historyUnresolved = [];
      /* padopt-1.0.0: the adoption census. Counts and a closed reason
         vocabulary only - never a name, DOB or MRN - so a receipt can prove a
         mint was UNAVOIDABLE instead of a silent miss. */
      var adoptionReceipt = { kind: "padopt-1.0.0", adopted: 0, boundExact: 0, mintAttempted: 0, reasons: {} };
      function padoptNoteMint(code) {
        adoptionReceipt.mintAttempted++;
        var c = String(code || "unknown").slice(0, 40);
        adoptionReceipt.reasons[c] = (adoptionReceipt.reasons[c] || 0) + 1;
      }
      function supersedeMissingHistory(patientId) {
        historyUnresolved.forEach(function (item) {
          if (item && item.patientId === patientId && item.reason === "missing-source-dob-mrn-proof") item._superseded = true;
        });
      }
      function removeHistoryTarget(patientId) {
        for (var hi = historyTargets.length - 1; hi >= 0; hi--) if (String(historyTargets[hi] && historyTargets[hi]._mlsTargetPatientId || "") === patientId) historyTargets.splice(hi, 1);
      }
      function blockHistoryPatient(patientId, reason) {
        patientId = String(patientId || "").trim();
        if (!patientId) return;
        var state = historyTargetState[patientId] || null;
        if (!state || state.status !== "conflict") historyUnresolved.push({ patientId: patientId, reason: String(reason || "source-proof-conflict") });
        supersedeMissingHistory(patientId);
        removeHistoryTarget(patientId);
        historyTargetState[patientId] = { status: "conflict" };
      }
      function queueHistory(a, p, date) {
        var patientId = String(p && p.id || "").trim();
        if (!patientId) { historyUnresolved.push({ patientId: "", reason: "patient-not-resolved" }); return; }
        var rowProof = sourceProof(a), dob = rowProof.dob ? String(a && a.dob || "").trim() : "", mrn = rowProof.mrn ? String(a && (a.mrn || a.athenaId || a.athena_id) || "").trim() : "";
        /* History proof belongs to this frozen Athena schedule row. An old
           backend appointment may keep the schedule idempotent, but its stored
           DOB/MRN can be stale or belong to a same-name patient and therefore
           must never upgrade a current name-only row into a chart read. */
        var state = historyTargetState[patientId] || null;
        if (!dob && !mrn) {
          /* A later appointment row for this same immutable patient may carry
             explicit proof. Keep this provisional missing-proof result
             replaceable; an exact target or a genuine conflict is terminal. */
          if (!state) {
            historyTargetState[patientId] = { status: "missing" };
            historyUnresolved.push({ patientId: patientId, reason: "missing-source-dob-mrn-proof" });
          }
          return;
        }
        var proofConflict = (dob && normDob(p && p.dob) !== normDob(dob)) || (mrn && rowMrn(p) !== normMrn(mrn));
        if (proofConflict) {
          blockHistoryPatient(patientId, "source-proof-conflict");
          return;
        }
        if (state && state.status === "conflict") return;
        if (state && state.status === "exact" && state.target) {
          /* Separate exact rows can expose complementary proof (DOB on one,
             MRN on another). Merge only after each value independently agrees
             with the already-resolved local patient. */
          if (dob && !state.target._mlsTargetDob) { state.target._mlsTargetDob = dob; state.target.dob = dob; }
          if (mrn && !state.target._mlsTargetMrn) { state.target._mlsTargetMrn = mrn; state.target.mrn = mrn; state.target.athenaId = mrn; }
          /* dfc-1.1.0 (duplicate same-patient/day rows): the second booking's
             appointment id was DISCARDED here, so the bundle's one shared
             coverage read could never name both appointments and no receipt
             could bind the second encounter. The history row stays ONE
             patient/day bundle, but it now accumulates every distinct
             appointment id it stands for. */
          safe(function () {
            var addId = String(rowAppointmentId(a) || "");
            if (!addId) return;
            if (!Array.isArray(state.target.appointmentIds)) state.target.appointmentIds = state.target.appointmentId ? [String(state.target.appointmentId)] : [];
            if (state.target.appointmentIds.indexOf(addId) < 0) state.target.appointmentIds.push(addId);
          });
          return;
        }
        supersedeMissingHistory(patientId);
        var targetRow = {
          patient_external_id: patientId,
          _mlsTargetPatientId: patientId,
          _mlsTargetDob: dob,
          _mlsTargetMrn: mrn,
          name: String((p && p.name) || (a && a.name) || "").trim(),
          dob: dob,
           mrn: mrn,
           athenaId: mrn,
           appointmentId: rowAppointmentId(a),
           appointmentIds: rowAppointmentId(a) ? [String(rowAppointmentId(a))] : [],
           date: String(date || ""),
           scheduleDate: String(date || ""),
           source: "athena-schedule-history"
         };
        historyTargets.push(targetRow);
        historyTargetState[patientId] = { status: "exact", target: targetRow };
      }
      function materializePatient(a,name) {
        var found=safe(function(){return findPatient(pts,a);},null);
        if(found&&found.id)return found;
        /* padopt-1.0.0: the mint is the LAST resort and this is the only gate
           in front of it. Record - PHI-free - WHY no local chart could be
           proven, so the receipt can show the mint was unavoidable. */
        padoptNoteMint(safe(function(){var v=padoptResolve(pts,a);return v&&v.why;},"")||"unknown");
        var key=patientIdentity(a,false);
        if(!key||!isFn(window.upsertPatient))return null;
        var np={id:stableId(key),name:String(name||a&&a.name||"").trim(),dob:String(a&&a.dob||""),reason:String(a&&a.reason||""),source:"athena-schedule",created:Date.now()};
        if(rowMrn(a)){np.athenaId=String(a.mrn||a.athenaId||a.athena_id||"");np.mrn=np.athenaId;}
        /* stableId is deliberately deterministic for idempotency, but its
           compact hash is not an identity proof. A rare collision must never
           overwrite or merge a different exact Athena patient. */
        var colliding=pts.filter(function(p0){return String(p0&&p0.id||"")===String(np.id);});
        if(colliding.length){
          if(colliding.length!==1||findPatient(colliding,a)!==colliding[0])return null;
          return colliding[0];
        }
        var stored=safe(function(){window.upsertPatient(np);return true;},false);
        if(!stored)return null;
        var persisted=safe(function(){
          var fresh=isFn(window.getPatients)?(window.getPatients()||[]):[];
          for(var pi=0;pi<fresh.length;pi++)if(String(fresh[pi]&&fresh[pi].id||"")===String(np.id))return fresh[pi];
          return null;
        },null);
        if(!persisted||findPatient([persisted],a)!==persisted)return null;
        if(!pts.some(function(p0){return String(p0&&p0.id||"")===String(persisted.id||"");}))pts.push(persisted);
        return persisted;
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
          var padoptNotes = {};
          safe(function () {
            existing = findPatient(pts, a, padoptNotes);
            if (existing) ext = existing.id;
          });
          if (existing && existing.id) { if (padoptNotes.adopted === true) adoptionReceipt.adopted++; else adoptionReceipt.boundExact++; }
          /* An exact appointment id may locate an already-bound backend row.
             It can reconcile that appointment, but conflicting source proof is
             fatal and its local patient's DOB/MRN is never copied onto the row. */
          if (oldRow && oldRow.patient_external_id) {
            var boundPatient = pts.find(function (p0) { return String(p0 && p0.id || "") === String(oldRow.patient_external_id); }) || null;
            var frozenProof = sourceProof(a);
            var proofConflict = !!(boundPatient && ((frozenProof.dob && normDob(boundPatient.dob) && normDob(boundPatient.dob) !== frozenProof.dob) || (frozenProof.mrn && rowMrn(boundPatient) && rowMrn(boundPatient) !== frozenProof.mrn)));
            var boundDisagrees = !!(existing && String(existing.id || "") !== String(oldRow.patient_external_id || ""));
            /* padopt-1.0.1 (refuter): a backend row already bound to a
               p_sched_/digits DEBRIS id while adoption proves the NATIVE chart
               is the healing case this whole lane exists for - superseding the
               debris binding is an upgrade, not a patient change. Only a
               native-vs-native disagreement (or a real proof conflict) stays
               fatal and blocks both records. */
            var debrisUpgrade = boundDisagrees && !proofConflict && existing && !padoptIsDebrisId(existing.id) && padoptIsDebrisId(oldRow.patient_external_id);
            if (proofConflict || (boundDisagrees && !debrisUpgrade)) {
              if (boundPatient && boundPatient.id) blockHistoryPatient(boundPatient.id, "source-proof-conflict");
              if (existing && existing.id && (!boundPatient || String(existing.id) !== String(boundPatient.id))) blockHistoryPatient(existing.id, "source-proof-conflict");
              noteImportFailure("appointment-patient-identity-conflict");
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
                noteImportFailure("appointment-enrichment-ambiguous");
                if (onEach) safe(function () { onEach("error", { name: name, error: "appointment-enrichment-ambiguous" }); });
                return;
              }
              oldRow = coreRow || dayProviderRow || null;
            }
            if (oldRow && oldRow.patient_external_id && String(oldRow.patient_external_id) !== ext) {
              noteImportFailure("slot-patient-identity-conflict");
              if (onEach) safe(function () { onEach("error", { name: name, error: "slot-patient-identity-conflict" }); });
              return;
            }
          }
          if (!existing) existing=materializePatient(a,name);
          if(existing&&existing.id){ext=String(existing.id);a.patient_external_id=ext;}
          if (existing) {
            var dirty = false;
            if (a.dob && !existing.dob) { existing.dob = String(a.dob); dirty = true; }
            if (rowMrn(a) && !rowMrn(existing)) { existing.athenaId = String(a.mrn || a.athenaId || a.athena_id || ""); if (!existing.mrn) existing.mrn = existing.athenaId; dirty = true; }
            if (dirty) safe(function () { window.upsertPatient(existing); });
          }
          if(!existing||!existing.id){
            if(requirePatientBinding){
              historyUnresolved.push({patientId:"",reason:patientIdentity(a,false)?"local-patient-materialization-failed":"patient-not-resolved"});
              noteImportFailure("patient-not-resolved");
              if(onEach)safe(function(){onEach("error",{name:name,error:"patient-not-resolved"});});
              return;
            }
          }
          if (existing && existing.id) { ext = String(existing.id); a.patient_external_id = ext; }
          /* padopt-1.0.0: stamp the proven LOCAL id on the source row so every
             reader that ORs the two alias fields agrees by construction. An
             existing valid id is never overwritten - a row exposing two
             DIFFERENT local aliases is the ambiguity the pickers refuse, and
             that refusal must survive. Only a local store id ever lands here. */
          if (ext && !String(a._mlsTargetPatientId || "").trim() && !!patientById(ext)) a._mlsTargetPatientId = ext;
          var ledgerKey = importKey(a, date, nt);
          if (!ledgerKey) {
            noteImportFailure("appointment-identity-unresolved");
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
              noteImportFailure("appointment-source-identity-conflict");
              if (onEach) safe(function () { onEach("error", { name: name, error: "appointment-source-identity-conflict" }); });
              return;
            }
            /* The calendar row already exists, so its exact patient is eligible
               for history even if an optional missing-time repair later fails. */
            queueHistory(a, existing, date);
            /* A repeat pull is idempotent enrichment, not a blind skip. Fill only
               fields that are still empty on this exact existing appointment;
               conflicting nonempty values are preserved for human review. */
            var enrich = {}, enrichKeys = [];
            function addMissing(field, value) {
              if (String(oldRow && oldRow[field] || "").trim() || value == null || !String(value).trim()) return;
              enrich[field] = value; enrichKeys.push(field);
            }
            addMissing("dob", String(a.dob || ""));
            /* pa-1.0.0: the line that ATTRIBUTES an ALREADY-STORED
               provider-empty row. b744 only ever stamped the CREATE path, so
               no re-pull could fix a stored row; addMissing skips a non-empty
               stored provider, so this is idempotent and never overwrites. */
            var enrichProvider = String(a.provider || "");
            if (!enrichProvider && requestedProvider.mode === "selected") enrichProvider = requestedProvider.name;
            addMissing("provider", enrichProvider);
            if (enrich.provider) providerBackfilled++;
            if (!storedAppointmentId) addMissing("athena_appointment_id", incomingAppointmentId);
            if (!storedProviderId2) addMissing("athena_provider_id", incomingProviderId2);
            addMissing("reason", String(a.reason || ""));
            addMissing("patient_external_id", ext || "");
            /* 2026-07-15: the verified Athena wall time is the truth for an
               identity-matched imported row. Heal a stored instant that
               disagrees with it (e.g. start_at saved under a wrong practice
               timezone), not only a missing one. */
            if (desiredStart && String(oldRow.start_at || "").trim() !== desiredStart) { enrich.appt_date = date; enrich.start_at = desiredStart; enrichKeys.push("start_at"); }
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
                  if (!recordResolution(ledgerKey, oldRow.id, date, "repaired",ext||oldRow.patient_external_id)) { noteImportFailure(lastMappingReason()); return; }
                  enrichedFields += enrichKeys.length;
                  repaired++; days[date] = (days[date] || 0) + 1;
                  if (onEach) safe(function () { onEach("repaired", { name: name, fields: enrichKeys.slice() }); });
                } else {
                  noteImportFailure("appointment-update-http");
                  if (onEach) safe(function () { onEach("error", { name: name, error: "HTTP " + rr.status }); });
                }
              }).catch(function () {
                noteImportFailure("appointment-update-network");
                if (onEach) safe(function () { onEach("error", { name: name, error: "network" }); });
              });
            }
            markDone(ledgerKey, { patientId: ext || (oldRow && oldRow.patient_external_id) || "", backendAppointmentId: oldRow && oldRow.id, date: date });
            if (!recordResolution(ledgerKey, oldRow && oldRow.id, date, "existing",ext||(oldRow&&oldRow.patient_external_id))) { noteImportFailure(lastMappingReason()); if (onEach) safe(function () { onEach("error", { name: name, error: "backend-id-missing" }); }); return; }
            skipped++; if (onEach) safe(function () { onEach("skipped", { name: name }); }); return;
          }
          var owner = claim(ledgerKey, { date: date });
          if (!owner) {
            var ledgerState = safe(function () { return readIndex(date).rows[ledgerKey] || null; }, null);
            if (ledgerState && ledgerState.state === "done") {
              var ledgerBackendId = String(ledgerState.backendAppointmentId || ""), ledgerBackend = backendById[ledgerBackendId] || null;
              if (ledgerBackend && localDayOf(ledgerBackend) === date) {
                queueHistory(a, existing, date);
                if (recordResolution(ledgerKey, ledgerBackendId, date, "ledger-existing",ext||ledgerState.patientId||(ledgerBackend&&ledgerBackend.patient_external_id))) {
                  skipped++; if (onEach) safe(function () { onEach("skipped", { name: name }); });
                } else noteImportFailure(lastMappingReason());
                return;
              }
              if (ledgerBackend) {
                noteImportFailure("ledger-backend-day-mismatch");
                unresolvedMappings.push({ sourceIdentity: ledgerKey, reason: "ledger-backend-day-mismatch", date: date });
                if (onEach) safe(function () { onEach("error", { name: name, error: "ledger-backend-day-mismatch" }); });
                return;
              }
              /* A done ledger entry is only evidence when its backend id is
                 present in the fresh appointment GET. Clear a missing target
                 and reclaim this identity; otherwise stale browser storage
                 falsely reports a complete day forever. */
              clearDone(ledgerKey, date, ledgerBackendId);
              owner = claim(ledgerKey, { date: date });
            } else {
              /* A pending/unknown ledger row is not an imported appointment.
                 Mark the calendar partial and do not repeat the old bug where
                 history saved even though no appointment landed. */
              noteImportFailure("import-in-flight");
              if (onEach) safe(function () { onEach("error", { name: name, error: "import-in-flight" }); });
            }
            if (!owner) return;
          }
          var startIso = desiredStart;
          /* FIX 2026-07-01: carry the per-appointment PROVIDER into storage. The extension
             supplies it (a.provider e.g. "Matthew Schaeffer, MD") and the backend has a
             provider column, but it was being dropped here -> every stored appt had provider
             null -> doctor-scoped "Who's Next" excluded them (matchesDoctor returns false on
             an empty provider) and showed a stale set instead. This is the "doctors assigned
             to their correct patients" fix. */
          /* b744 (owner escalation: providers must be "assigned to their
             correct patients"): a ONE-COLUMN Athena Day view has no per-row
             provider column, so a provider-SCOPED pull stored every row with
             an empty provider (his real 18-appointment day: 18x unattributed).
             When the scrape row carries no provider and the pull was scoped to
             one selected provider, that provider IS the attribution. An
             'all'-scope pull with a columnless grid stays honestly empty -
             never guessed. */
          var rowProvider = String(a.provider || "");
          if (!rowProvider && requestedProvider.mode === "selected") rowProvider = requestedProvider.name;
          var body = { name: name, dob: String(a.dob || ""), reason: String(a.reason || ""), provider: rowProvider, patient_external_id: ext || null, appt_date: date, start_at: startIso };
          var sourceAppointmentId = rowAppointmentId(a), sourceProviderId = rowProviderId(a);
          if (sourceAppointmentId) body.athena_appointment_id = sourceAppointmentId;
          if (sourceProviderId) body.athena_provider_id = sourceProviderId;
          if (onEach) safe(function () { onEach("save", { name: name }); });
          var createRequest = safe(function () {
            return fetch(base + "/api/appointments", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify(body) })
              .then(function (r) {
                if (!r.ok) { rollback(ledgerKey, owner, date); noteImportFailure("appointment-create-http"); if (onEach) safe(function () { onEach("error", { name: name, error: "HTTP " + r.status }); }); return; }
                return Promise.resolve(safe(function () { return isFn(r.json) ? r.json() : null; }, null)).catch(function () { return null; }).then(function (saved) {
                  var backendAppointmentId = String((saved && (saved.id || (saved.appointment && saved.appointment.id) || (saved.data && saved.data.id))) || "");
                  markDone(ledgerKey, { patientId: ext, backendAppointmentId: backendAppointmentId, date: date });
                  if (!backendAppointmentId) {
                    unresolvedMappings.push({ sourceIdentity: ledgerKey, reason: "backend-id-missing", date: date }); noteImportFailure("backend-id-missing");
                    if (onEach) safe(function () { onEach("error", { name: name, error: "backend-id-missing" }); });
                    return;
                  }
                  var savedRow = {}; for (var sk in body) if (body.hasOwnProperty(sk)) savedRow[sk] = body[sk];
                  if (saved && typeof saved === "object") for (var rk in saved) if (saved.hasOwnProperty(rk)) savedRow[rk] = saved[rk];
                  savedRow.id = backendAppointmentId; backendById[backendAppointmentId] = savedRow; existingRows[ledgerKey] = savedRow;
                  if (!recordResolution(ledgerKey, backendAppointmentId, date, "created",ext)) {
                    noteImportFailure(lastMappingReason());
                    if (onEach) safe(function () { onEach("error", { name: name, error: "mapping-unresolved" }); });
                    return;
                  }
                  queueHistory(a, existing, date); created++; days[date] = (days[date] || 0) + 1;
                  if (onEach) safe(function () { onEach("saved", { name: name }); });
                });
              })
              .catch(function () { rollback(ledgerKey, owner, date); noteImportFailure("appointment-create-network"); if (onEach) safe(function () { onEach("error", { name: name, error: "network" }); }); });
          }, null);
          if (!createRequest) {
            rollback(ledgerKey, owner, date);
            unresolvedMappings.push({ sourceIdentity: ledgerKey, reason: "appointment-create-dispatch-failed", date: date });
            noteImportFailure("appointment-create-dispatch-failed");
            if (onEach) safe(function () { onEach("error", { name: name, error: "dispatch" }); });
            return Promise.resolve();
          }
          return createRequest;
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

      /* --------------------------------------------------------------------
         b749 HONEST COUNTS + REFRESH AFTER PULL.
         Measured 2026-07-27: the owner tab said 6 patients for Wednesday
         2026-07-29 while his account store held 19 rows for that day. Two
         separate holes made that possible:
           1. loadCalendar can REFUSE to apply its response (the b346
              newest-wins guard returns {applied:false, discarded:'superseded'}
              or 'session_changed'). Nothing here ever read that answer, so a
              tab could keep a pre-pull day list indefinitely.
           2. Nothing recorded whether the refresh had actually landed, so no
              surface could tell a backed count from a stale one.
         Now the refresh is verified and retried, every open surface is
         re-rendered from the store, and the outcome is receipted per day in
         window.__mlsDayPullStamp for the label logic to read.
         The AWAITED path is at most two loadCalendar calls: the suites stub
         setTimeout to an inert no-op, so anything behind a timer here is
         strictly fire-and-forget and can never hang a pull. */
      function siDayCount(day) {
        return safe(function () {
          var cal = window._calAppts; if (!Array.isArray(cal)) return null;
          var n = 0;
          for (var i = 0; i < cal.length; i++) {
            var r = cal[i]; if (!r) continue;
            var k = String(r.appt_date || r.day_local || r.start_at || "").slice(0, 10);
            if (k === day) n++;
          }
          return n;
        }, null);
      }
      function siReadStore() {
        return Promise.resolve(safe(function () {
          return isFn(window.loadCalendar) ? window.loadCalendar() : null;
        }, null)).then(function (r) { return r; }, function () { return null; });
      }
      /* Older loadCalendar builds return undefined. Only an explicit
         applied:false is a PROVEN refusal to apply; unknown is not stale. */
      function siApplied(r) { return !(r && typeof r === "object" && r.applied === false); }
      function siStampDays(refreshed) {
        safe(function () {
          var sr = (providerResp && providerResp.receipt) || null;
          /* declaredCountAuthoritative is the extension receipt field that says
             whether Athena's own day total may be trusted (a multi-provider
             column count and a legacy header count explicitly may NOT). No
             authoritative total means the label must hedge, not assert. */
          var declaredOk = !!(sr && sr.declaredCountAuthoritative === true && isFinite(Number(sr.declaredCount)));
          var keys = {};
          if (target) keys[target] = 1;
          Object.keys(days || {}).forEach(function (k) { if (k) keys[k] = 1; });
          var stamps = window.__mlsDayPullStamp = window.__mlsDayPullStamp || {};
          Object.keys(keys).forEach(function (day) {
            stamps[day] = {
              completedAt: Date.now(),
              storeRefreshed: refreshed === true,
              storeCount: siDayCount(day),
              declaredTotal: declaredOk ? Number(sr.declaredCount) : null,
              declaredReason: String((sr && sr.declaredCountReason) || (sr ? "" : "no-schedule-receipt")),
              parsedCount: (sr && isFinite(Number(sr.parsedCount))) ? Number(sr.parsedCount) : null,
              expectedCount: (sr && isFinite(Number(sr.expectedCount))) ? Number(sr.expectedCount) : null,
              attempted: appts.length
            };
          });
        });
      }
      /* Every OPEN surface re-reads the store, not just the hero. The calendar
           grid and check-in strip are the two that render day rows directly;
           refreshEasy is the one proven safe re-render of the Easy workspace
           (it refuses to touch an active visit, a recording, or a live pull). */
      function siRefreshSurfaces() {
        safe(function () { if (isFn(window.renderCalendar)) window.renderCalendar(); });
        safe(function () { if (isFn(window.renderCalCheckin)) window.renderCalCheckin(); });
        safe(function () {
          var prf = window.__mlsPullRecFix;
          if (prf && isFn(prf.refreshEasy)) prf.refreshEasy("si-pull-complete");
        });
      }
      return chain.then(function () {
        return siReadStore().then(function (first) {
          if (siApplied(first)) return true;
          /* A discarded read PROVES our rows are older than this completed
             pull. Re-read once immediately rather than leaving the tab to
             state a pre-pull count as fact. */
          return siReadStore().then(function (second) { return siApplied(second); });
        }).then(function (refreshed) {
          siStampDays(refreshed);
          if (refreshed !== true) {
            safe(function () { if (isFn(window.toast)) window.toast("Your schedule was saved, but this tab could not reload it \u2014 refresh the page to see every appointment for the day.", "err"); });
          }
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
          siRefreshSurfaces();
          [900, 2600].forEach(function (ms) {
            setTimeout(function () {
              safe(function () {
                siReadStore().then(function (r) {
                  if (!siApplied(r)) return;
                  siStampDays(true);
                  siRefreshSurfaces();
                }, function () {});
              });
            }, ms);
          });
          historyUnresolved = historyUnresolved.filter(function (item) { return !(item && item._superseded); });
          return { created: created, repaired: repaired, enrichedFields: enrichedFields, providerBackfilled: providerBackfilled, skipped: skipped, failed: failed, attempted: appts.length, wrongDay: wrongDay, invalidDate: invalidDate, days: days, target: target, scope: scopeDate || "", historyTargets: historyTargets, historyUnresolved: historyUnresolved, resolvedAppointments: resolvedAppointments, unresolvedMappings: unresolvedMappings, failureReasons: failureReasons, providerReceipt: providerScope.receipt, adoptionReceipt: adoptionReceipt };
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
    payload = payload || {};
    return new Promise(function (res) {
      var done = false, cancelDeadline = null;
      var requestId = String(payload.requestId || ("mlssi-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9))).slice(0, 100);
      var requestedDeadline = Number(payload.deadlineAt || 0);
      var deadlineAt = isFinite(requestedDeadline) && requestedDeadline > 0 ? requestedDeadline : Date.now() + Number(timeoutMs || 12000);
      function finish(v) { if (done) return; done = true; if (cancelDeadline) cancelDeadline(); window.removeEventListener("message", on); res(v); }
      function on(e) {
        if (!(e.data && e.data.source === "mls-ext") || e.data.type !== type) return;
        var gotId = String((e.data.resp && (e.data.resp.requestId || e.data.resp.id)) || e.data.requestId || e.data.id || "");
        /* Every stateful managed reply must prove it belongs to this exact
           request. Only the passive version ping intentionally has no ID.
           Accepting ID-less schedule/history traffic lets a late old result
           settle a newer pull. */
        if (type === "mlsPong") { if (gotId && gotId !== requestId) return; }
        else if (gotId !== requestId) return;
        finish(e.data.resp || e.data || null);
      }
      window.addEventListener("message", on);
      cancelDeadline = absoluteDeadlines.arm(deadlineAt, function () {
        finish({ ok: false, complete: false, reason: "bridge-deadline-exceeded", error: "MLS Assist did not finish before the immutable request deadline.", requestId: requestId, deadlineAt: deadlineAt });
      });
      if (cancelDeadline && isFn(cancelDeadline.isTerminal) && cancelDeadline.isTerminal()) return;
      if (Date.now() >= deadlineAt) { finish({ ok: false, complete: false, reason: "bridge-deadline-exceeded", error: "MLS Assist deadline elapsed before dispatch.", requestId: requestId, deadlineAt: deadlineAt }); return; }
      safe(function () {
        var msg = { source: "mls-app", type: reqType, id: requestId, requestId: requestId, deadlineAt: deadlineAt };
        for (var k in payload) { if (payload.hasOwnProperty(k)) msg[k] = payload[k]; }
        window.postMessage(msg, "*");
      });
    });
  }

  /* ===== p1-athena-presence-1.0.0 (a BUSY athena is not a MISSING athena) ====
     MEASURED live 2026-08-17 20:20-20:45Z on /cloned, ext 3.0.62, with THREE
     signed-in athenaOne tabs open: a mid-pull leg answered `no-athena-tab`
     (the extension picker's 1.2-1.5 s session ping was missed while athena was
     rendering) and the pull ended terminal with "sign in to athenaOne" - false,
     and unactionable. The lease-free presence verb answered
     `presence-verified` 5/5 within 80 ms immediately afterwards.

     So: a `no-athena-tab` answer on the goto/schedule leg is now a QUESTION,
     not a verdict. Ask the presence verb; if athena really is there, wait
     2s/4s/8s and re-run THAT leg (at most 3 retries for the whole pull), and
     count the retries in the receipt. Only when presence is genuinely absent
     does the honest sign-in text stand.

     The presence reply carries NO requestId (content.js:264-269 relays the
     background answer verbatim), so it cannot ride bridge() - bridge REJECTS
     an id-less stateful reply on purpose. This probe therefore listens for the
     type directly, exactly the way feat_athena_guard.js's presenceProbe does.
     PHI-free throughout: booleans, a reason code, and a tab COUNT. */
  var P1_ATHENA_BUSY_WAITS = [2000, 4000, 8000];
  var P1_ATHENA_BUSY_MAX = 3;
  var p1PresenceLast = { at: 0, resp: null };
  var p1AthenaTabsLast = { at: 0, tabs: -1 };
  function p1PresenceProbe(ms) {
    return new Promise(function (res) {
      var done = false, timer = null;
      function fin(v) {
        if (done) return;
        done = true;
        safe(function () { if (timer != null) clearTimeout(timer); });
        safe(function () { window.removeEventListener("message", on, false); });
        if (v && typeof v === "object") p1PresenceLast = { at: Date.now(), resp: v };
        res(v);
      }
      function on(e) {
        var d = e && e.data;
        if (!d || typeof d !== "object" || d.source !== "mls-ext" || d.type !== "mlsAthenaPresenceResult") return;
        fin(d.resp || {});
      }
      safe(function () { window.addEventListener("message", on, false); });
      timer = setTimeout(function () { fin(null); }, Number(ms) > 0 ? Number(ms) : 3500);
      safe(function () { window.postMessage({ source: "mls-app", type: "mlsAthenaPresence" }, "*"); });
    });
  }
  /* PHI-free athena tab COUNT. mlsExtHealth is the only verb that reports it
     ({tabs, discarded}, background.js:15142), and its reply IS request-bound,
     so this one rides bridge(). -1 means "not knowable", never 0. */
  function p1AthenaTabCount(ms) {
    return bridge("mlsExtHealthResult", "mlsExtHealth", Number(ms) > 0 ? Number(ms) : 2500).then(function (h) {
      var n = Number(h && h.athena && h.athena.tabs);
      if (!isFinite(n) || n < 0) return -1;
      p1AthenaTabsLast = { at: Date.now(), tabs: n };
      return n;
    }, function () { return -1; });
  }
  /* the count this pull already knows, without spending another round trip */
  function p1AthenaTabsKnown() {
    return (p1AthenaTabsLast.at && Date.now() - p1AthenaTabsLast.at < 120000) ? Number(p1AthenaTabsLast.tabs) : -1;
  }
  function p1PresenceSaysAthenaLives(resp) {
    if (!resp || typeof resp !== "object") return false;   /* no answer proves nothing */
    if (resp.athenaOpen === true) return true;             /* presence-verified */
    /* 'athena-tab-unverified' = raw athena tabs ARE present, the picker just
       could not prove a signed-in one this instant. That is precisely the
       busy-render case, so it earns a retry too. */
    return String(resp.reason || "") === "athena-tab-unverified";
  }
  function p1IsNoAthenaTabAnswer(r) {
    if (!r || typeof r !== "object") return false;
    if (r.ok !== false) return false;
    if (String(r.reason || "") === "no-athena-tab") return true;
    return /no athenaone tab open/i.test(String(r.error || ""));
  }
  function p1BusySleep(ms) {
    return safe(function () {
      return window.__mlsBgSleep ? window.__mlsBgSleep(ms) : new Promise(function (r) { setTimeout(r, ms); });
    }, new Promise(function (r) { setTimeout(r, ms); }));
  }
  /* Runs ONE athena leg, and re-runs it only while the presence verb proves
     athena is really there. `budget` is shared by every leg of one pull, so the
     whole pull can never spend more than P1_ATHENA_BUSY_MAX retries. */
  function p1AthenaBusyRetry(runLeg, onStatus, budget) {
    var say = isFn(onStatus) ? onStatus : function () {};
    budget = budget || {};
    function attempt() {
      return Promise.resolve().then(runLeg).then(function (r) {
        if (!p1IsNoAthenaTabAnswer(r)) return r;
        var used = Number(budget.athenaBusyRetries || 0);
        if (used >= P1_ATHENA_BUSY_MAX) { budget.athenaBusyExhausted = true; return r; }
        return p1PresenceProbe(3500).then(function (presence) {
          budget.athenaPresence = String((presence && presence.reason) || "no-answer");
          if (!p1PresenceSaysAthenaLives(presence)) { budget.athenaPresenceAbsent = true; return r; }
          budget.athenaPresenceAbsent = false;
          budget.athenaBusyRetries = used + 1;
          say("Athena is busy rendering — re-checking (" + (used + 1) + " of " + P1_ATHENA_BUSY_MAX + ")…", "");
          return p1BusySleep(P1_ATHENA_BUSY_WAITS[used] || P1_ATHENA_BUSY_WAITS[P1_ATHENA_BUSY_WAITS.length - 1]).then(attempt);
        });
      });
    }
    return attempt();
  }
  /* THE ONE-TAB SENTENCE. Measured on the owner's athena 2026-08-17: three
     tabs open, ONE with a rendered week strip (Sun 8/16 - Sat 8/22), TWO with
     .calendar-nav present but EMPTY - and the extension leased an empty one.
     Nothing about "the grid is still settling" is true there, so say what the
     diag actually shows and name the fix the doctor can perform. */
  function p1OneTabAdvice(tabs) {
    var n = Number(tabs);
    return "Athena's Day view isn't showing a week strip in the tab MLS is using." +
      (isFinite(n) && n > 1 ? (" " + n + " Athena tabs are open.") : "") +
      " Keep ONE signed-in Athena tab open on your Day view (close the extras) and Pull again.";
  }
  /* An EMPTY week strip is not a missing tab and not a slow render: the strip
     container answered, it just carried no day cells. The extension says so in
     its error text; the nav diag corroborates (rounds were spent, no init
     frame was ever found). */
  function p1NavEmptyStrip(nav, diag) {
    var err = String((nav && nav.error) || "");
    if (/no athenaone tab open/i.test(err)) return false;
    if (/week strip shows no selected day|no selected day/i.test(err)) return true;
    return !!(diag && Number(diag.rounds || 0) > 0 && diag.initFound === false);
  }
  /* ADVISORY, fire-and-forget: never blocks a pull, never refuses one. It
     speaks only when the extension reports more than one athena tab or cannot
     verify the one it has - the exact state that later dies as a 60 s
     nav-failed. Costs the pull zero latency because nothing awaits it. */
  function p1OneTabPreflight(onStatus) {
    var say = isFn(onStatus) ? onStatus : function () {};
    return safe(function () {
      return Promise.all([p1PresenceProbe(2500), p1AthenaTabCount(2500)]).then(function (pair) {
        var presence = pair[0], tabs = Number(pair[1]);
        var unverified = !!(presence && presence.athenaOpen !== true && String(presence.reason || "") === "athena-tab-unverified");
        var multi = isFinite(tabs) && tabs > 1;
        if (unverified || multi) say(p1OneTabAdvice(tabs), "");
        return { tabs: tabs, presence: String((presence && presence.reason) || "no-answer"), advised: unverified || multi };
      }, function () { return { tabs: -1, presence: "probe-failed", advised: false }; });
    }, Promise.resolve({ tabs: -1, presence: "probe-threw", advised: false }));
  }
  /* ===== end p1-athena-presence-1.0.0 ===== */

  /* Some athenaOne day grids render no demographics at all. The current React
     grid does, however, expose one immutable appointment id on every row. For
     a managed history pull, open ONLY that exact appointment row and accept a
     DOB only from the patient banner that the same open request proves. Never
     cache by name: two same-name patients may have different appointment ids. */
  async function hydrateMissingScheduleProof(rows, onStatus, scheduleDate) {
    rows = Array.isArray(rows) ? rows : [];
    onStatus = isFn(onStatus) ? onStatus : function () {};
    scheduleDate = normDate(scheduleDate) || "";
    var startedAt = Date.now(), cache = Object.create(null), idCounts = Object.create(null), receipt = {
      complete: false, attempted: rows.length, alreadyProven: 0, requested: 0,
      resolved: 0, failed: 0, appointmentBound: 0, reasons: {},
      /* PHI-free per-proof evidence: one entry per demographics-free row whose
         identity was proven through its exact appointment id. Each entry
         carries only booleans, the requested date, and the batch-encoded
         request id - never a name, DOB, MRN, or appointment id. */
      batchToken: startedAt.toString(36), proofs: []
    };
    function noteReason(reason) {
      reason = String(reason || "identity-proof-unavailable").slice(0, 80);
      receipt.reasons[reason] = Number(receipt.reasons[reason] || 0) + 1;
      return reason;
    }
    rows.forEach(function (candidate) {
      var candidateId = rowAppointmentId(candidate);
      if (candidateId) idCounts[candidateId] = Number(idCounts[candidateId] || 0) + 1;
    });
    var needsScheduleRestore = false;
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i] || {}, proof = sourceProof(row);
      /* Organized history and the visible patient cards require the chart DOB,
         so an MRN-only schedule row still takes the exact appointment path. */
      if (proof.dob) { receipt.alreadyProven++; continue; }
      receipt.requested++;
      var nameKey = normName(row.name), appointmentId = rowAppointmentId(row), cached = appointmentId && cache[appointmentId];
      if (!nameKey) {
        row._mlsIdentityProofReason = noteReason("patient-name-missing"); receipt.failed++; continue;
      }
      if (!appointmentId) {
        row._mlsIdentityProofReason = noteReason("appointment-id-missing"); receipt.failed++; continue;
      }
      if (idCounts[appointmentId] !== 1) {
        row._mlsIdentityProofReason = noteReason("appointment-id-duplicate"); receipt.failed++; continue;
      }
      if (!cached) {
        if (needsScheduleRestore) {
          var navRequestId = "schedule-restore-" + startedAt.toString(36) + "-p" + (i + 1);
          var navDeadlineAt = Date.now() + 60000;
          var nav = await bridge("mlsAppGotoDateResult", "mlsAppGotoDate", 62000, {
            date: scheduleDate, probe: false, requestId: navRequestId, deadlineAt: navDeadlineAt
          });
          if (!(nav && nav.ok === true && normDate(nav.schedDate) === scheduleDate)) {
            row._mlsIdentityProofReason = noteReason(String(nav && (nav.reason || nav.error) || "schedule-restore-failed"));
            receipt.failed++; needsScheduleRestore = true; continue;
          }
          needsScheduleRestore = false;
        }
        onStatus("Verifying patient identity " + (receipt.requested) + " of " + rows.length + " in Athena...", "");
        var requestId = "schedule-proof-" + startedAt.toString(36) + "-p" + (i + 1);
        var deadlineAt = Date.now() + 110000;
        var opened = await bridge("mlsAppChartResult", "mlsAppReadChart", 112000, {
          patient: String(row.name || ""), patientDob: "", patientMrn: String(row.mrn || row.athenaId || ""),
          appointmentId: appointmentId, bootstrapIdentity: true, scheduleDate: scheduleDate,
          requestId: requestId, deadlineAt: deadlineAt
        });
        /* Even an honestly failed banner read may have navigated away from the
           day grid. Re-ground before the next appointment-id lookup. */
        needsScheduleRestore = true;
        var identityReceipt = opened && opened.identityBootstrapReceipt || null;
        var dob = validDobProof(opened && opened.chartDob || "");
        var exact = !!(opened && opened.ok === true && identityReceipt &&
          identityReceipt.complete === true && identityReceipt.appointmentIdBound === true &&
          identityReceipt.navigationProven === true && identityReceipt.bannerIdentity === true &&
          identityReceipt.dobVerified === true &&
          identityReceipt.exactNameMatched === true && String(identityReceipt.appointmentId || "") === appointmentId &&
          String(identityReceipt.scheduleDate || "") === scheduleDate &&
          String(identityReceipt.requestId || "") === requestId &&
          String(opened.appointmentId || "") === appointmentId && dob);
        cached = exact
          ? { ok: true, dob: String(opened.chartDob || "").trim(), requestId: requestId }
          : { ok: false, reason: (opened && opened.sessionLikelyExpired === true) ? "athena-session-expired" : String(opened && (opened.findReason || opened.reason || opened.error) || "identity-proof-unavailable").slice(0, 80) };
        cache[appointmentId] = cached;
      }
      if (!cached.ok) {
        row._mlsIdentityProofReason = noteReason(cached.reason); receipt.failed++; continue;
      }
      row.dob = cached.dob;
      row._mlsIdentityProofVia = "athena-appointment-id-chart-banner";
      row._mlsIdentityProofRequestId = cached.requestId;
      receipt.resolved++; receipt.appointmentBound++;
      receipt.proofs.push({
        requestId: cached.requestId, scheduleDate: scheduleDate,
        appointmentIdBound: true, navigationProven: true, exactNameMatched: true,
        bannerIdentity: true, dobVerified: true, requestBound: true
      });
    }
    receipt.complete = receipt.failed === 0 && receipt.alreadyProven + receipt.resolved === rows.length;
    return { rows: rows, receipt: receipt };
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
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    var raw = roster && isFn(roster.list)
      ? (safe(function () { return roster.list(); }, []) || [])
      : (safe(function () { return window._calProviders || []; }, []) || []);
    var out = [];
    raw.forEach(function (p) {
      if (typeof p === "string") {
        var rs = String(p || "").trim(); if (rs) out.push({ fval: "nm:" + rs, id: "", name: rs, key: providerKey(rs) });
      } else if (p && typeof p === "object") {
        var n = String(p.name || p.displayName || "").trim();
        var stableKey = String(p.stableKey || p.stable_key || "");
        if (n) out.push({
          fval: p.id != null && String(p.id) ? String(p.id) : (stableKey ? ("pv:" + encodeURIComponent(stableKey)) : ("nm:" + n)),
          id: p.id != null ? String(p.id) : "",
          stableKey: stableKey,
          raw: String(p.raw || p.provider || n),
          name: n,
          key: providerKey(n),
          rosterVerified: p.rosterVerified === true
        });
      }
    });
    return out;
  }
  function calendarSelection() {
    var pf = safe(function () { return document.getElementById("calProvFilter"); }, null);
    var fval = pf ? String(pf.value || "") : "";
    if (!fval) return { ok: false, complete: false, reason: "provider-required", error: "Choose one provider in Calendar first." };
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    var rosterReceipt = roster && isFn(roster.getReceipt) ? safe(function () { return roster.getReceipt(); }, null) : null;
    var entries = calendarProviderRows();
    var matches = entries.filter(function (p) { return p.fval === fval; });
    /* Provider cleanup may collapse a legacy echo into one exact strong roster
       identity. Preserve an already-selected old value only through the
       canonical roster's unique alias resolution; ambiguity still fails. */
    if (!matches.length && roster && isFn(roster.resolve)) {
      var aliased = safe(function () { return roster.resolve(fval); }, null);
      if (aliased && aliased.stableKey) matches = entries.filter(function (p) { return p.stableKey === String(aliased.stableKey); });
    }
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
    var providerGate = resolveProviderRequest({ id: chosen.id, stableKey: chosen.stableKey, raw: chosen.raw, name: chosen.name, rosterVerified: chosen.rosterVerified }, { allowAll: false, allowDetectedProvider: true });
    if (!providerGate.ok) return { ok: false, complete: false, reason: providerGate.reason, error: providerGate.error, providerRosterReceipt: providerGate.receipt || rosterReceipt };
    return { ok: true, complete: true, date: date, source: "calendar", provider: providerGate.provider, providerRosterReceipt: rosterReceipt };
  }

  /* ---- exact-patient history + old-visits batch -------------------------
   * Schedule import returns immutable patient IDs. Process those IDs one at
   * a time, keep every Athena operation read-only, and return an honest
   * per-patient receipt. A partial/timeout never becomes a completed pull. */
  function boundedUntil(promise, deadlineAt, label, onTimeout) {
    return new Promise(function (resolve, reject) {
      var done = false, cancelDeadline = absoluteDeadlines.arm(deadlineAt, function () {
        if (done) return; done = true;
        try { if (isFn(onTimeout)) onTimeout(); } catch (e) {}
        var err = new Error(label || "deadline-exceeded"); err.code = "MLS_DEADLINE_EXCEEDED"; err.deadlineAt = Number(deadlineAt || 0); reject(err);
      });
      Promise.resolve(promise).then(function (v) {
        if (done) return; done = true; cancelDeadline(); resolve(v);
      }, function (e) {
        if (done) return; done = true; cancelDeadline(); reject(e);
      });
    });
  }
  function bounded(promise, ms, label, onTimeout) { return boundedUntil(promise, Date.now() + Number(ms || 0), label, onTimeout); }
  function patientById(id) {
    var pts = (callG("getPatients") || []) || [], sid = String(id || "");
    for (var i = 0; i < pts.length; i++) if (String(pts[i] && pts[i].id || "") === sid) return pts[i];
    return null;
  }
  function exactHistoryTarget(row) {
    row = row || {};
    var ref = { patientId: String(row._mlsTargetPatientId || row.patient_external_id || ""), name: String(row.name || ""), dob: String(row._mlsTargetDob || row.dob || ""), mrn: String(row._mlsTargetMrn || row.mrn || row.athenaId || ""), appointmentId: rowAppointmentId(row), scheduleDate: normDate(row.scheduleDate || row.date) };
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
    var exactSnap = {}; for (var sk in snap) if (Object.prototype.hasOwnProperty.call(snap, sk)) exactSnap[sk] = snap[sk];
    exactSnap.appointmentId = ref.appointmentId;
    exactSnap.scheduleDate = ref.scheduleDate;
    try { Object.freeze(exactSnap); } catch (eFreezeExactSnap) {}
    return exactSnap;
  }
  function frozenRetryEntry(row, target, reason, diagSource) {
    row = row || {}; target = target || {};
    var entry = {
      patientId: String(target.patientId || row._mlsTargetPatientId || row.patient_external_id || row.patientId || ""),
      reason: String(reason || row.reason || "history-partial").slice(0, 120),
      frozenDob: normDob(target.dob || row._mlsTargetDob || row.dob || row.frozenDob || ""),
      frozenMrn: normMrn(target.mrn || target.athenaId || row._mlsTargetMrn || row.mrn || row.athenaId || row.frozenMrn || ""),
      /* lpf-1.0.0 (live 2026-08-23): the automatic sweep rebuilt a failed
         schedule row without its strongest Athena binding. The retry then
         degraded from the exact appointment row to a lossy name search and
         could honestly report "No matching patient" for a patient that was on
         the pulled schedule. Freeze the opaque appointment id with the same
         identity/day evidence; it contains no patient demographics. */
      appointmentId: (function () { var rawAppointmentId = String(target.appointmentId || rowAppointmentId(row) || "").trim(); return /^[A-Za-z0-9_-]{2,40}$/.test(rawAppointmentId) ? rawAppointmentId : ""; })(),
      /* dnd-1.0.0 (owner 2026-08-17, "Pull Thursday the 27th": tnReasons
         {no-day-on-row:15}). A retry entry carried identity but NOT the day,
         so buildRetryRows rebuilt day-less rows and every sweep / Retry round
         reported no-day-on-row for the pulled day's own note - the one note
         the owner says must always be read with bodies OFF. The day is a
         property of the SCHEDULE ROW, so it is frozen with the identity. */
      scheduleDate: normDate(target.scheduleDate || row.scheduleDate || row.date || row.frozenDay || "") || ""
    };
    var sleepingTab = Number((diagSource && (diagSource.athenaTabId || diagSource.readTabId)) || row.athenaTabId || 0);
    if (sleepingTab > 0) entry.athenaTabId = sleepingTab;
    /* mdx-1.1.0: carry the PHI-free refusal evidence with the retry entry so
       the error report can name the sub-cause without the patient record. */
    if (diagSource && (diagSource.visitsFailedHistogram || diagSource.visitsEnumDiag || diagSource.visitsReadReceipt || diagSource.findDiag)) {
      entry.diag = {
        hist: diagSource.visitsFailedHistogram || null,
        enumDiag: diagSource.visitsEnumDiag || null,
        receipt: diagSource.visitsReadReceipt || null,
        /* fdx-1.0.0: the chart-open verdict travels with the retry entry so the
           error report can name WHICH of the four collapsed find outcomes the
           extension actually reported. */
        find: diagSource.findDiag || null
      };
    }
    return entry;
  }
  /* mdx-1.1.0: compact human suffix for the day panel row - names the top
     sub-causes so "visit-bodies-incomplete" stops being a dead end. */
  function historyDiagSuffix(one) {
    try {
      if (one && one.visitsFailedHistogram) {
        var hks = Object.keys(one.visitsFailedHistogram);
        hks.sort(function (a, b) { return one.visitsFailedHistogram[b] - one.visitsFailedHistogram[a]; });
        var hParts = [];
        for (var hi = 0; hi < hks.length && hi < 2; hi++) hParts.push(hks[hi] + "×" + one.visitsFailedHistogram[hks[hi]]);
        if (hks.length > 2) hParts.push("+" + (hks.length - 2) + " more");
        if (hParts.length) return " {" + hParts.join(", ") + "}";
      }
      if (one && one.visitsEnumDiag) {
        var hed = one.visitsEnumDiag;
        return " {passes:" + (hed.passes || 0) + ",identical:" + (hed.identicalPasses || 0) + ",noise:" + (hed.noiseDropped || 0) + "}";
      }
    } catch (eSuffix) {}
    return "";
  }
  /* ===== fdx-1.1.0 (the find-open deadline gets a name and a retry) =====
     MEASURED live 2026-08-17 on the owner's /1p: 2 of 16 rows died on
     background.js failOpenDeadline('find-patient open') - the extension's own
     absolute deadline for OPENING the chart from athena's patient search. The
     row printed the extension's English sentence, which (a) told the doctor
     nothing actionable and (b) matched no clause of SWEEPABLE_REASON, so the
     automatic end-of-batch sweep skipped exactly the two rows a second attempt
     heals most often. fdx-1.0.0 already records the extension's PHI-free
     verdict on one.findDiag; this turns that verdict into the row's reason
     code so both surfaces can act on it. Codes only. */
  function fdxRowReason(one) {
    var fd = one && one.findDiag;
    if (!fd) return "";
    if (String(fd.reason || "") === "open-deadline-exceeded") return "find-open-deadline";
    /* pcs-1.0.0 (systemic audit item 1): the extension's own CLOSED machine
       code is the classification - English strings never route retries. Any
       well-formed kebab code the open/pick verdict carried is promoted so
       the retry lane and the day line see the CAUSE, not a flattened
       no-athena-tab. */
    var fdCode = String(fd.code || fd.reason || "");
    if (/^[a-z][a-z0-9]*(-[a-z0-9]+)+$/.test(fdCode)) return fdCode.slice(0, 60);
    return "";
  }
  function fdxStampRoute(one) {
    var fd = one && one.findDiag;
    if (!fd) return;
    var route = String(fd.via || fd.route || "").slice(0, 40);
    if (route) one.findRoute = route;
    if (fd.findReason) one.findReason = String(fd.findReason).slice(0, 40);
  }
  /* ===== end fdx-1.1.0 ===== */
  /* lpfr-1.0.0 (live 2026-08-23): one recovery vocabulary, used both while
     painting an in-progress row and when selecting the automatic end-of-batch
     re-check. The bridge/content absolute-deadline results were missing from
     the old sweep regex. They therefore stopped the main walk, painted a
     final orange row, and were never given the larger re-check window even
     though both are transient transport deadlines. Identity, permission and
     wrong-patient refusals remain deliberately absent. */
  var AUTOMATIC_HISTORY_RETRY_REASON = /^(visit-bodies-incomplete|same-frame-name-mismatch|same-frame-name-missing|visits-time-budget-exceeded|visits-read-deadline-exceeded|bridge-deadline-exceeded|content-deadline-exceeded|chart-read-deadline-exceeded|find-open-deadline|stale-encounter-surface-open|encounter-surface-not-open|visits-total-not-readable|visits-list-still-rendering|visits-panel-not-open|no-athena-tab|no-candidates|lease-tab-gone|identity-not-proven|deferred-after-timeout)/;
  /* pcs-1.0.0: the three new pick-census subclasses of no-athena-tab retry
     exactly as their parent did; lease-sleeping stays OUT deliberately - the
     sleeping tab has its own wake lane and a blind retry only grinds. */
  /* ===== nav-1.0.0 (a landed schedule is a fact the re-pull must respect) =====
     The whole-pull automatic re-pull exists for ONE situation: athena's grid
     was still painting when the schedule was read. Once a day's schedule has
     been read complete (or proved authoritatively empty), that situation is
     over for that day, and a later nav-failed - which is a TAB problem, not a
     grid problem - must not restart the schedule leg. This is the record that
     makes the veto a measurement rather than a guess. Survives a reload via
     the same account-scoped local index every other pull receipt uses. */
  var navLandedMem = {};
  function navLandedKey(day) { return safe(function () { return isFn(window.uns) ? window.uns("p1NavScheduleLandedV1::" + String(day || "")) : ("p1NavScheduleLandedV1::" + String(day || "")); }, "p1NavScheduleLandedV1::" + String(day || "")); }
  function navMarkScheduleLanded(day, info) {
    var d = normDate(day || "") || "";
    if (!d) return null;
    var rec = {
      v: 1, day: d, at: Date.now(),
      rows: Number((info && info.rows) || 0),
      empty: !!(info && info.empty),
      complete: !!(info && info.complete)
    };
    navLandedMem[d] = rec;
    safe(function () { window.localStorage.setItem(navLandedKey(d), JSON.stringify(rec)); });
    return rec;
  }
  /* A landing is only usable while it is FRESH (12 h). An overnight record can
     never veto tomorrow morning's first real pull of the same weekday key. */
  var NAV_LANDED_MAX_AGE_MS = 12 * 3600 * 1000;
  function navScheduleLanded(day) {
    var d = normDate(day || "") || "";
    if (!d) return null;
    var rec = navLandedMem[d] || safe(function () { var raw = window.localStorage.getItem(navLandedKey(d)); return raw ? JSON.parse(raw) : null; }, null);
    if (!rec || rec.complete !== true) return null;
    if (!(Number(rec.at) > 0) || Date.now() - Number(rec.at) > NAV_LANDED_MAX_AGE_MS) return null;
    return rec;
  }
  /* ===== end nav-1.0.0 (landed record) ===== */
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
  /* ===== cap-1.0.0 (the capture is saved before, and independent of, the AI) =====
     THE ORDER IS THE WHOLE FIX. Before this block the sequence was
       chart read -> AI parse -> identity ref -> store,
     so a dead backend AI destroyed a completed, identity-verified athena read:
     measured live 2026-08-17 on the owner's /1p, 9 of 16 rows "502 Upstream
     request failed", store unchanged, all nine reported as FAILED histories.
     The sequence is now
       chart read -> identity ref -> STORE THE RAW CAPTURE -> AI parse -> store,
     and the AI half is a retryable follow-up over text that is already saved.

     Nothing is loosened. The capture is written only under the SAME verified
     identity echo (_athenaHistoryVerifiedRef: name + DOB/MRN proof against the
     frozen target) that gates the six-card save, only under a proven coverage
     receipt, and the write is read back before it is believed. No clinical
     text is invented, edited or deleted - the capture is the reader's own
     characters, stored verbatim. */
  var CAP_MAX_CHARS = 90000; /* the parse refuses above this, so nothing beyond it is usable */
  /* PHI-free reason class for a failed AI step. The new backend answers
     {error, code, retryable}; aiCallRaw carries those onto the Error as
     err.mlsAi. Codes and status numbers only - never the model's text. */
  function capAiFailure(err) {
    var msg = String((err && err.message) || err || "");
    if (/deadline|timeout/i.test(msg)) return null;            /* a timeout still stops the batch */
    if (/^clinical-field-coverage-unproven$/.test(msg)) return { code: "ai-empty-parse", retryable: true, status: 0 };
    var ai = err && err.mlsAi;
    if (ai && typeof ai === "object") {
      return {
        code: String(ai.code || ("ai-http-" + (Number(ai.status) || 0))).slice(0, 40),
        retryable: ai.retryable !== false,
        status: Number(ai.status) || 0
      };
    }
    /* pre-cap builds of the shell throw "<status> <detail>" with no fields */
    var m = /^([45]\d\d)\b/.exec(msg);
    if (m) return { code: "ai-http-" + m[1], retryable: true, status: Number(m[1]) };
    if (/failed to fetch|networkerror|load failed/i.test(msg)) return { code: "ai-network", retryable: true, status: 0 };
    return null;
  }
  function capBindRef(saveRef, requestId) {
    if (!saveRef || !requestId) return saveRef;
    var boundRef = {};
    for (var brk in saveRef) if (Object.prototype.hasOwnProperty.call(saveRef, brk)) boundRef[brk] = saveRef[brk];
    boundRef.requestId = String(requestId);
    return boundRef;
  }
  /* Persist the raw capture + the identity receipt, then PROVE it by reading
     the record back. Returns the stored capture or null; never throws. */
  function capPersistRawCapture(target, row, rd, parseText, coverage, requestId) {
    return safe(function () {
      var pid = String((target && target.patientId) || "");
      if (!pid) return null;
      var text = String(parseText || (rd && rd.text) || "");
      if (!text.trim()) return null;
      if (text.length > CAP_MAX_CHARS) text = text.slice(0, CAP_MAX_CHARS);
      /* QUOTA, fail-closed: the quota guard stamps __mlsStoreWriteFailed the
         moment a savePatients echo does not come back. A store that is already
         refusing writes must not be handed tens of KB of raw chart text per
         patient - that turns a summariser outage into a storage outage. The
         capture is simply not taken; the row then fails honestly on the
         ordinary AI path exactly as it did before cap-1.0.0. */
      var quotaFail = safe(function () { return window.__mlsStoreWriteFailed || null; }, null);
      if (quotaFail && Number(quotaFail.at || 0) > 0 && Date.now() - Number(quotaFail.at || 0) < 6 * 3600 * 1000) return null;
      var p = patientById(pid);
      if (!p) return null;
      var capture = {
        v: 1, at: Date.now(), requestId: String(requestId || ""),
        day: normDate((row && (row.scheduleDate || row.date)) || (target && target.scheduleDate) || ""),
        appointmentId: String((target && target.appointmentId) || ""),
        chars: text.length, text: text,
        readerVersion: String((coverage && coverage.readerVersion) || ""),
        frames: Number((coverage && coverage.readClinicalFrames) || 0),
        identityVerified: true,
        /* the echo the identity gate accepted, kept so the retry can rebuild
           the exact same verified ref without re-opening the chart */
        echo: {
          chartName: String((rd && rd.chartName) || ""),
          chartDob: String((rd && rd.chartDob) || ""),
          chartMrn: String((rd && rd.chartMrn) || "")
        },
        summaryPending: true, summaryCode: "", summaryAttempts: 0, summaryAt: 0
      };
      p.athenaRawCapture = capture;
      if (isFn(window.upsertPatient)) window.upsertPatient(p);
      else if (isFn(window.savePatients)) window.savePatients(window.getPatients() || []);
      safe(function () { if (isFn(window._pendingSyncAdd)) window._pendingSyncAdd(pid); });
      /* PRESENCE IS NOT PROVENANCE: read the store back and require THIS
         operation's request id, or the capture is not saved. */
      var back = patientById(pid);
      var stored = back && back.athenaRawCapture;
      if (!stored || String(stored.requestId || "") !== String(requestId || "") || Number(stored.chars || 0) !== text.length) return null;
      return stored;
    }, null);
  }
  /* ===== end cap-1.0.0 (capture persistence) ===== */
  function saveOrganizedHistory(target, row, rd, readStartedAt, deadlineAt, requestId) {
    var coverage = verifiedChartCoverage(rd, readStartedAt);
    if (!coverage) return Promise.reject(new Error("chart-coverage-unproven"));
    var aborter = typeof AbortController === "function" ? new AbortController() : null;
    /* rd.text is the coverage-receipted chart text and verifiedChartCoverage above
       already re-checked its exact character count. The appointment briefing text
       rides on rd.briefingText as its own field and is folded in ONLY here, below
       every gate, by the one shared combiner. This is the lane the day pull uses. */
    var parseText = safe(function () { return window._athenaChartTextForParse ? window._athenaChartTextForParse(rd) : String(rd.text || ""); }, null);
    if (typeof parseText !== "string" || !parseText) parseText = String(rd.text || "");
    /* ===== cap-1.0.0 (persist first) =====
       The identity echo is proven HERE, above the AI call, and the capture is
       written under it. When the echo cannot be proven nothing is written and
       the flow falls through unchanged, so the original refusal order (and its
       error text) survives exactly as before. */
    var capEarlyRef = safe(function () { return window._athenaHistoryVerifiedRef(target, rd); }, null);
    var capStored = capEarlyRef ? capPersistRawCapture(target, row, rd, parseText, coverage, requestId) : null;
    /* ===== end cap-1.0.0 (persist first) ===== */
    var parsePromise = Promise.resolve(safe(function () { return window._parsePatientChart(parseText, { signal: aborter && aborter.signal, deadlineAt: deadlineAt, requestId: requestId }); }, null));
    return boundedUntil(parsePromise, deadlineAt, "chart-parse-deadline-exceeded", function () { if (aborter) aborter.abort(); }).then(function (chart) {
      var parsedCoverage=safe(function(){return isFn(window._athenaChartProfileCoverage)?window._athenaChartProfileCoverage(chart):null;},null);
      if (!chart || !parsedCoverage || parsedCoverage.complete!==true) throw new Error("clinical-field-coverage-unproven");
      var saveRef = safe(function () { return window._athenaHistoryVerifiedRef(target, rd); }, null);
      requestId=String(requestId||"");
      if (saveRef && requestId) {
        /* _athenaHistoryVerifiedRef freezes its proof object. Stamping the
           operation id on the frozen object silently no-ops, so the sink could
           never bind the six-card receipt to this exact request (live
           2026-07-15: six-card-save-request-unproven on 10/16 patients). Bind
           the request on an unfrozen copy of the same verified proof. */
        var boundRef = {};
        for (var brk in saveRef) if (Object.prototype.hasOwnProperty.call(saveRef, brk)) boundRef[brk] = saveRef[brk];
        boundRef.requestId = requestId;
        saveRef = boundRef;
      }
      /* Distinguish the two historically-conflated refusals: a null verified
         ref means the READ's identity echo failed proof (the sink was never
         called); a sink false means _savePatientChart itself refused (its
         gate is recorded in window.__mlsChartSaveTrace). The echo evidence is
         PHI-free presence booleans. */
      if (!saveRef) {
        var echoErr = new Error("chart-read-identity-echo-unproven");
        echoErr.mlsEchoes = { name: !!String(rd && rd.chartName || ""), dob: !!String(rd && rd.chartDob || ""), mrn: !!String(rd && rd.chartMrn || "") };
        throw echoErr;
      }
      if (!requestId || !safe(function () { return window._savePatientChart(saveRef, row, chart) === true; }, false)) throw new Error("chart-identity-save-refused");
      function verifyStored(){
        var storedCoverage=safe(function(){return isFn(window._patientHistoryCardCoverage)?window._patientHistoryCardCoverage(target.patientId):null;},null);
        if(!storedCoverage||storedCoverage.complete!==true||storedCoverage.exactIdentityVerified!==true) throw new Error("clinical-field-save-unproven");
        /* A sink reporting success is not proof that this operation replaced the
           six-card profile. Without a current timestamp, yesterday's exact but
           stale receipt can mask a dropped save and make the patient green. The
           chart sink stamps capturedAt locally after this read begins, so require
           it to fall inside this exact operation before accepting the cards. */
        var profileCapturedRaw=storedCoverage.capturedAt;
        var profileCapturedAt=Number(profileCapturedRaw||0);
        if(!isFinite(profileCapturedAt)||profileCapturedAt<=0) profileCapturedAt=Date.parse(String(profileCapturedRaw||""))||0;
        if(!profileCapturedAt||profileCapturedAt<Number(readStartedAt||0)||profileCapturedAt>Date.now()+5000) throw new Error("six-card-profile-freshness-unproven");
        /* Timestamp freshness alone is not persistence proof: a failed sink could
           stamp a new receipt while leaving yesterday's clinical fields in place.
           Bind the receipt to this exact operation and compare the canonical
           Athena-owned snapshot actually stored for the patient with the snapshot
           derived from this operation's parsed chart. */
        if(String(storedCoverage.saveRequestId||"")!==requestId) throw new Error("six-card-save-request-unproven");
        var storedPatient=patientById(target.patientId);
        /* A chart may be safely identity-matched by MRN while the local DOB is
           still blank. That is not a complete patient import: the visible card,
           future exact-patient reads, and op-note binding all depend on the DOB
           surviving this operation. Require the requested, observed, and stored
           DOBs to be present and identical before the profile can turn green. */
        var readIdentity=rd&&rd.identity||{};
        var targetDobProof=validDobProof(target&&target.dob||"");
        var observedDobProof=validDobProof(readIdentity.dob||rd&&rd.chartDob||"");
        var storedDobProof=validDobProof(storedPatient&&storedPatient.dob||"");
        if(!targetDobProof||!observedDobProof||!storedDobProof||targetDobProof!==observedDobProof||storedDobProof!==targetDobProof) throw new Error("patient-dob-persistence-unproven");
        var expectedSnapshot=safe(function(){return isFn(window._athenaChartSnapshotFromChart)?window._athenaChartSnapshotFromChart(chart):null;},null);
        var expectedProof=safe(function(){return expectedSnapshot&&isFn(window._athenaChartSnapshotProof)?window._athenaChartSnapshotProof(expectedSnapshot):"";},"");
        var storedProof=safe(function(){return storedPatient&&storedPatient.athenaChartSnapshot&&isFn(window._athenaChartSnapshotProof)?window._athenaChartSnapshotProof(storedPatient.athenaChartSnapshot):"";},"");
        if(!expectedProof||!storedProof||storedProof!==expectedProof) throw new Error("six-card-persistence-unproven");
        var clinicalFieldCount=['problems','meds','allergies','vitals','history'].reduce(function(n,k){return n+(storedCoverage.cards&&storedCoverage.cards[k]&&storedCoverage.cards[k].populated?1:0);},0);
        return {chartCoverage:coverage,profileCoverage:storedCoverage,clinicalFieldCount:clinicalFieldCount,dobVerified:true};
      }
      /* si-1.7.15/16 (live 2026-07-20 night): the read-back can trail the
         post-save pipeline — under evening load the request-bound fresh stamp
         was measured becoming visible ~20s after the gate's first read while
         the store always converged to the newest verified data. Escalating
         bounded settle-rechecks close that window. This can NEVER false-pass:
         the verdict requires storedCoverage.saveRequestId === THIS operation's
         requestId, a stamp that exists only if this exact save persisted; a
         dropped or stale save keeps failing every recheck and refuses
         honestly. Non-race failures still throw immediately. */
      var verifySettleWaits = [150, 1000, 5000, 25000];
      function verifyWithSettle(round) {
        try { var v = verifyStored(); return Promise.resolve(v); }
        catch (vErr) {
          var racy = /save-unproven|freshness-unproven|save-request-unproven|persistence-unproven/.test(String(vErr && vErr.message || ""));
          if (!racy || round >= verifySettleWaits.length) return Promise.reject(vErr);
          return (window.__mlsBgSleep ? window.__mlsBgSleep(verifySettleWaits[round]) : new Promise(function (resSettle) { setTimeout(resSettle, verifySettleWaits[round]); })).then(function () { return verifyWithSettle(round + 1); });
        }
      }
      return verifyWithSettle(0);
    }).then(function (organizedResult) {
      /* ===== cap-1.0.0 (the summary landed) =====
         The six cards are stored, so the capture is no longer pending. The raw
         text itself is KEPT: it is the only local copy of what athena showed,
         and a later re-summarise must never need the tab again. */
      capClearPending(target && target.patientId);
      return organizedResult;
    }, function (aiErr) {
      /* ===== cap-1.0.0 (the AI half failed - the capture did not) ===== */
      var cls = capStored ? capAiFailure(aiErr) : null;
      if (!cls) throw aiErr;
      capMarkPending(target && target.patientId, cls);
      var pendErr = new Error("summary-pending: " + cls.code);
      pendErr.mlsCapture = {
        saved: true, pending: true, code: cls.code, retryable: cls.retryable !== false,
        status: Number(cls.status || 0), chars: Number(capStored.chars || 0),
        detail: String((aiErr && aiErr.message) || "").slice(0, 120)
      };
      throw pendErr;
    });
  }
  /* ===== cap-1.0.0 (pending bookkeeping on the stored capture) ===== */
  function capMarkPending(patientId, cls) {
    safe(function () {
      var p = patientById(patientId);
      if (!p || !p.athenaRawCapture) return;
      p.athenaRawCapture.summaryPending = true;
      p.athenaRawCapture.summaryCode = String((cls && cls.code) || "ai-unavailable").slice(0, 40);
      p.athenaRawCapture.summaryRetryable = !(cls && cls.retryable === false);
      p.athenaRawCapture.summaryAttempts = Number(p.athenaRawCapture.summaryAttempts || 0) + 1;
      p.athenaRawCapture.summaryAt = Date.now();
      if (isFn(window.upsertPatient)) window.upsertPatient(p);
    });
  }
  function capClearPending(patientId) {
    safe(function () {
      var p = patientById(patientId);
      if (!p || !p.athenaRawCapture || p.athenaRawCapture.summaryPending !== true) return;
      p.athenaRawCapture.summaryPending = false;
      p.athenaRawCapture.summaryCode = "";
      p.athenaRawCapture.summaryAt = Date.now();
      /* QUOTA: the raw text exists to survive an AI outage. Once the six cards
         are stored it has done its job, so the TEXT is released and only the
         PHI-free receipt (chars, when, request id, identity echo) is kept - a
         pull cannot grow the store by ~90 KB per patient per day. The store
         hit its ceiling once already; it will not be this that does it again. */
      p.athenaRawCapture.text = "";
      p.athenaRawCapture.released = true;
      if (isFn(window.upsertPatient)) window.upsertPatient(p);
    });
  }
  /* Re-run ONLY the AI half, over text that is already stored. No athena, no
     tab, no lease - which is why this can be retried in the background and
     again on the next pull. Every identity gate still runs: the verified ref
     is rebuilt from the frozen target and the SAME echo the capture was
     written under, so a drifted local record refuses exactly as it would on a
     fresh read. */
  function capResummarizeStored(patientId, deadlineMs) {
    var p = patientById(patientId);
    var cap = p && p.athenaRawCapture;
    if (!cap || cap.summaryPending !== true) return Promise.resolve({ ok: false, reason: "not-pending" });
    if (!String(cap.text || "").trim()) return Promise.resolve({ ok: false, reason: "no-stored-capture" });
    var target = {
      patientId: String(p.id), name: String(p.name || ""), dob: String(p.dob || ""),
      mrn: String(p.mrn || p.athenaId || ""),
      appointmentId: String(cap.appointmentId || ""), scheduleDate: String(cap.day || "")
    };
    var echo = cap.echo || {};
    var saveRef = safe(function () { return window._athenaHistoryVerifiedRef(target, echo); }, null);
    if (!saveRef) return Promise.resolve({ ok: false, reason: "identity-echo-unproven" });
    var requestId = "cap-resum-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
    var readStartedAt = Date.now();
    var deadlineAt = Date.now() + (Number(deadlineMs) > 0 ? Number(deadlineMs) : 120000);
    var parsePromise = Promise.resolve(safe(function () { return window._parsePatientChart(String(cap.text), { deadlineAt: deadlineAt, requestId: requestId }); }, null));
    return boundedUntil(parsePromise, deadlineAt, "chart-parse-deadline-exceeded").then(function (chart) {
      var parsedCoverage = safe(function () { return isFn(window._athenaChartProfileCoverage) ? window._athenaChartProfileCoverage(chart) : null; }, null);
      if (!chart || !parsedCoverage || parsedCoverage.complete !== true) throw new Error("clinical-field-coverage-unproven");
      var bound = capBindRef(saveRef, requestId);
      if (!safe(function () { return window._savePatientChart(bound, { name: target.name, dob: target.dob, mrn: target.mrn }, chart) === true; }, false)) throw new Error("chart-identity-save-refused");
      var storedCoverage = safe(function () { return isFn(window._patientHistoryCardCoverage) ? window._patientHistoryCardCoverage(target.patientId) : null; }, null);
      if (!storedCoverage || storedCoverage.complete !== true || storedCoverage.exactIdentityVerified !== true) throw new Error("clinical-field-save-unproven");
      if (String(storedCoverage.saveRequestId || "") !== requestId) throw new Error("six-card-save-request-unproven");
      capClearPending(target.patientId);
      return { ok: true, patientId: target.patientId, requestId: requestId };
    }, function (e) {
      var cls = capAiFailure(e);
      if (cls) capMarkPending(target.patientId, cls);
      return { ok: false, reason: String((e && e.message) || e || "resummarize-failed").slice(0, 120), code: cls ? cls.code : "" };
    });
  }
  /* Every patient this batch captured but could not summarise, read back from
     the STORE (never from a counter) so a reload or a second pull still finds
     them. */
  function capPendingPatientIds(rows) {
    return safe(function () {
      var out = [], seen = {};
      (Array.isArray(rows) ? rows : []).forEach(function (r) {
        var pid = String(rowLocalPatientId(r) || (r && r._mlsTargetPatientId) || "");
        if (!pid || seen[pid]) return;
        seen[pid] = 1;
        var p = patientById(pid);
        if (p && p.athenaRawCapture && p.athenaRawCapture.summaryPending === true && p.athenaRawCapture.summaryRetryable !== false) out.push(pid);
      });
      return out;
    }, []);
  }
  /* BOUNDED background retry: setTimeout only (rAF never fires in a hidden
     tab), exponential-ish backoff, at most CAP_RETRY_MAX rounds, one armed
     chain per page. It touches no athena surface at all, so it is safe to run
     after the pull has released everything. */
  var CAP_RETRY_MAX = 3;
  var CAP_RETRY_BACKOFF_MS = [20000, 60000, 180000];
  var capRetryArmed = false;
  function capArmBackgroundRetry(patientIds, onDone) {
    var ids = (Array.isArray(patientIds) ? patientIds : []).slice(0, 60);
    if (!ids.length) { if (isFn(onDone)) safe(function () { onDone({ armed: false, rounds: 0, recovered: 0 }); }); return false; }
    if (capRetryArmed) { if (isFn(onDone)) safe(function () { onDone({ armed: false, rounds: 0, recovered: 0, reason: "already-armed" }); }); return false; }
    capRetryArmed = true;
    var round = 0, recovered = 0;
    function finish(reason) {
      capRetryArmed = false;
      safe(function () { window.__mlsP1CapRetry = { at: Date.now(), rounds: round, recovered: recovered, remaining: capPendingPatientIds(ids.map(function (id) { return { patient_external_id: id }; })).length, reason: String(reason || "done") }; });
      if (isFn(onDone)) safe(function () { onDone({ armed: true, rounds: round, recovered: recovered, reason: String(reason || "done") }); });
    }
    function runRound() {
      round++;
      var live = capPendingPatientIds(ids.map(function (id) { return { patient_external_id: id }; }));
      if (!live.length) { finish("all-summarised"); return; }
      var i = 0;
      (function next() {
        if (i >= live.length) {
          if (round >= CAP_RETRY_MAX) { finish("retry-budget-spent"); return; }
          setTimeout(runRound, CAP_RETRY_BACKOFF_MS[Math.min(round, CAP_RETRY_BACKOFF_MS.length - 1)]);
          return;
        }
        var pid = live[i++];
        capResummarizeStored(pid, 120000).then(function (r) { if (r && r.ok) recovered++; next(); }, function () { next(); });
      })();
    }
    setTimeout(runRound, CAP_RETRY_BACKOFF_MS[0]);
    return true;
  }
  /* ===== end cap-1.0.0 (retry lane) ===== */
  /* si-facts-1.0 (owner 2026-08-19: "very important that history is also
     saved just like that when doing a day pull"): the organize pass already
     lands problems/history from the pulled encounter text, but MEDICATIONS
     live on the chart banner and never ride encounter bodies (measured
     2026-08-19: every day-pulled patient shows an empty meds card while the
     capture reply carries the full list). One bounded read-only capture per
     patient, taken while THAT patient's chart is still open, fills meds
     (append-missing) and problems/allergies when empty. Two-token name guard:
     a capture naming a different patient adds nothing. Non-fatal by design —
     a capture miss never voids the proven visit save; the verdict rides the
     per-patient ledger row as factsCapture. */
  function siCaptureFacts(patientId, ms) {
    return new Promise(function (resolve) {
      var done = false, t = 0;
      function settle(v) { if (done) return; done = true; try { clearTimeout(t); } catch (e0) {} try { window.removeEventListener('message', onR); } catch (e1) {} resolve(v); }
      function onR(e) {
        if (!(e.data && e.data.source === 'mls-ext' && e.data.type === 'mlsAppCaptureResult')) return;
        settle((e.data.resp && e.data.resp.ok === true && e.data.resp.captured) || null);
      }
      t = setTimeout(function () { settle(null); }, ms || 8000);
      window.addEventListener('message', onR);
      try { window.postMessage({ source: 'mls-app', type: 'mlsAppCapture' }, '*'); } catch (e2) { settle(null); }
    }).then(function (cap) {
      if (!cap) return 'no-capture';
      var p = patientById(patientId);
      if (!p) return 'no-patient';
      var capName = String(cap.name || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
      var rowName = String(p.name || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!capName || !rowName) return 'no-name';
      var capT = capName.split(' '), rowT = rowName.split(' ');
      var inter = capT.filter(function (w) { return w.length > 1 && rowT.indexOf(w) >= 0; }).length;
      if (inter < 2) return 'name-mismatch';
      var changed = false;
      var meds = Array.isArray(cap.medications) ? cap.medications.map(function (m) { return String(m || '').trim(); }).filter(Boolean) : [];
      if (meds.length) {
        var have = String(p.meds || '');
        var add = meds.filter(function (m) { return have.toLowerCase().indexOf(m.toLowerCase()) < 0; });
        if (add.length) { p.meds = (have.trim() ? have.trim() + '\n' : '') + add.join('\n'); changed = true; }
      }
      if (!String(p.problems || '').trim() && Array.isArray(cap.problems) && cap.problems.length) { p.problems = cap.problems.map(function (x) { return String(x || '').trim(); }).filter(Boolean).join('\n'); changed = true; }
      if (!String(p.allergies || '').trim() && Array.isArray(cap.allergies) && cap.allergies.length) { p.allergies = cap.allergies.map(function (x) { return String(x || '').trim(); }).filter(Boolean).join('\n'); changed = true; }
      if (changed) { try { if (isFn(window.upsertPatient)) window.upsertPatient(p); } catch (e3) {} }
      return changed ? 'saved' : 'nothing-new';
    }).catch(function () { return 'error'; });
  }
  /* si-facts-1.1: facts are useful enrichment, but they are not evidence that
     the visit-body receipt is complete. Queue the bounded capture only after
     that receipt is finalized. The follow-up may update factsCapture for
     reporting, but it can never change the already-stamped visit verdict or
     hold the next patient. The existing two-token chart-name guard remains the
     write gate for the best-effort result. */
  function siCaptureFactsFollowup(patientId, one) {
    try {
      /* Dispatch while this row's verified chart is still the active surface;
         only the response is deferred, so the next row is never blocked. */
      var pending = siCaptureFacts(patientId, 8000).then(function (verdict) {
        if (one && one.visitsComplete === true) one.factsCapture = verdict;
        return verdict;
      }, function () {
        if (one && one.visitsComplete === true) one.factsCapture = 'error';
        return 'error';
      });
      /* sicap-1.0.0: KEEP the handle so the batch can settle it after the last
         row and replace the non-verdict 'queued' with what really happened.
         Non-enumerable: a promise must never reach a receipt or the day ledger,
         and JSON.stringify of a receipt row must not change shape. */
      if (one) {
        try { Object.defineProperty(one, '__factsCaptureP', { value: pending, enumerable: false, writable: true, configurable: true }); }
        catch (eDefine) { one.__factsCaptureP = pending; }
      }
    } catch (e) {
      if (one && one.visitsComplete === true) one.factsCapture = 'error';
    }
    return 'queued';
  }
  function saveVerifiedVisits(target, r) {
    var identity = r && r.identity || {};
    var observed = { chartName: identity.name || r.chartName || "", chartDob: identity.dob || r.chartDob || "", chartMrn: identity.mrn || identity.athenaId || r.chartMrn || "" };
    var proof = safe(function () { return isFn(window._athenaHistoryProofMatches) && window._athenaHistoryProofMatches(target, observed); }, false);
    if (!proof) throw new Error("visits-identity-proof-failed");
    var expected = Number(r && r.receipt && r.receipt.expected), parsed = Number(r && r.receipt && r.receipt.parsed);
    var readerVersion = String(r && r.readerVersion || ""), receiptReaderVersion = String(r && r.receipt && r.receipt.readerVersion || "");
    /* dfc-1.0.0: the TOP-LEVEL version proves the READER (transport-stamped,
       refuses legacy readers that predate onlyDate scoping); the receipt's
       own readerVersion is that receipt's schema annotation and must merely
       exist - demanding echo-equality rejected honest receipts that declare
       their schema independently. Both absent stays fail-closed. */
    var provenReader = /^2\.9\.22-visits-r4-two-stage$/.test(readerVersion) && receiptReaderVersion.length > 0;
    if (!r.receipt || r.receipt.complete !== true || r.receipt.indexComplete !== true || r.receipt.bodyComplete !== true || r.receipt.fullDetail !== true || r.receipt.stableKeysComplete !== true || !provenReader || expected < 0 || parsed !== expected) throw new Error("visits-full-detail-unproven");
    /* A chart whose only encounter rows are administrative order groups has
       zero CLINICAL bodies to read; the reader reports them honestly as
       administrativeRows. That is verified evidence of emptiness-of-bodies,
       not an unproven zero. */
    if (expected === 0 && r.receipt.authoritativeEmpty !== true && !(Number(r.receipt.administrativeRows || 0) > 0)
      /* dfc-1.1.0: a SCOPED census that proved absence (complete, fully
         dated, calendar-authority-backed - scensus semantics) is verified
         emptiness OF THAT DAY, not an unproven zero. */
      && !(/^\d{4}-\d{2}-\d{2}$/.test(String((r.receipt.onlyDate || "")).slice(0, 10)) && r.receipt.absenceProven === true)) throw new Error("visits-empty-unproven");
    var p = patientById(target.patientId), cv = window.__mlsCopyVisits, vm = window.__mlsVisitModel, visits = Array.isArray(r.visits) ? r.visits : [];
    if (visits.length !== parsed) throw new Error("visits-count-mismatch");
    var sourceKeys = {};
    for (var vk = 0; vk < visits.length; vk++) {
      var sourceKey = String(visits[vk] && (visits[vk].encounterId || visits[vk].sourceVisitKey) || "").trim().toLowerCase();
      var sourceSlot = "visit|" + sourceKey;
      if (!sourceKey || sourceKeys[sourceSlot]) throw new Error("visits-source-key-unproven");
      sourceKeys[sourceSlot] = 1;
    }
    if (!p || !vm || !isFn(vm.addVisit) || !cv) throw new Error("visit-model-unavailable");
    /* ===== dscope-1.0.0 (scoped-visit-save contract, Codex ff0be547) ======
       A same-day slice is ADDITIVE EVIDENCE, never an authoritative
       replacement for the patient's complete Athena history. When the
       receipt declares an exact-day scope, this saver: validates the scope
       against the FROZEN target day and every row's own service date
       (no-substitution), persists through ONE bulk call with reconcile:false,
       never invokes the destructive full-history reconciliation, and proves
       only THIS slice's rows - older verified encounters are deliberately
       outside the census and must survive byte-identical. */
    /* dscope-1.0.2: ONLY the reader's own onlyDate scoping declares a slice.
       scopeDate is same-day-lane METADATA and legitimately rides on a FULL
       unscoped receipt (the ON walk derives its same-day proof from the one
       full read) - keying on it made a full save throw scoped-visit-date-
       mismatch on every multi-date history. */
    var dscopeDate = String((r.receipt && r.receipt.onlyDate) || "").slice(0, 10);
    var dscope = /^\d{4}-\d{2}-\d{2}$/.test(dscopeDate);
    if (dscope) {
      /* dscope-1.0.1 (Codex blocker 4 on 10f41d2d): an exact-day slice
         REQUIRES a canonical frozen row day - a missing/invalid target day
         refuses before any write instead of skipping the comparison. */
      var frozenDay = String(target && (target.scheduleDate || target.day) || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(frozenDay)) throw new Error("scoped-frozen-day-missing");
      if (frozenDay !== dscopeDate) throw new Error("scoped-date-target-mismatch");
      for (var dv = 0; dv < visits.length; dv++) {
        if (String(visits[dv] && visits[dv].date || "").slice(0, 10) !== dscopeDate) throw new Error("scoped-visit-date-mismatch");
      }
    }
    /* Prefer the established strict name+DOB ingest. MRN-verified charts may
       legitimately lack DOB; in that case retain the same per-row veto and
       write through the one visit model with immutable patient binding. */
    var savedCount = 0, reconcileReceipt = null, dsSameDayMeta = null;
    if (dscope) {
      /* Additive scoped persistence: one bulk call, reconcile OFF, and a
         verified absence saves nothing at all (never a fabricated row).
         dscope-1.0.2: where the bulk writer is absent, the copy-visits
         writer is the additive fallback - it stamps the same verified-source
         flags (source/identityVerified/identityBinding/fullDetail/
         bodyComplete) the persistence proof below demands, dedupes on
         sourceVisitKey, and never reconciles. A raw addVisit push cannot
         substitute: unstamped rows fail the persistence census by design. */
      if (!isFn(vm.saveVerifiedVisitBatch) && !isFn(cv._saveVisits)) throw new Error("visits-bulk-writer-unavailable");
      for (var dsi = 0; dsi < visits.length; dsi++) {
        if (isFn(cv._visitIdentityAgrees) && !cv._visitIdentityAgrees(p, visits[dsi], true)) throw new Error("visit-row-identity-mismatch");
      }
      if (visits.length) {
        if (isFn(vm.saveVerifiedVisitBatch)) {
          var dscopeSave = vm.saveVerifiedVisitBatch(p.id, visits, { source: "athena-schedule-history", bodyComplete: true, reconcile: false, scopeDate: dscopeDate });
          savedCount = Number(dscopeSave && dscopeSave.saved || 0);
        } else {
          savedCount = Number(cv._saveVisits(p, { name: observed.chartName || target.name, dob: observed.chartDob || target.dob }, visits, function () {}, r.receipt)) || 0;
        }
      }
      reconcileReceipt = { complete: true, scoped: true, removed: 0, retained: -1 }; /* reconciliation deliberately NOT run on a slice */
      /* dscope-1.0.1: the census status the reader hands back is validated
         against the CLOSED vocabulary before it enters this receipt. An
         alien string never travels: rows measurably persisted read saved;
         an unproveable claim with nothing persisted reads refused (absence
         is a proof, never a default). */
      var dsStatusRaw = String((r.receipt && r.receipt.sameDayStatus) || "");
      var dsSameDayStatus = /^(saved|partial|refused|absent|not-yet-available)$/.test(dsStatusRaw)
        ? dsStatusRaw : (parsed > 0 ? "saved" : "refused");
      dsSameDayMeta = { status: dsSameDayStatus, scopeDate: dscopeDate,
        noSubstitution: !r.receipt || r.receipt.noSubstitution !== false,
        appointmentBindings: (r.receipt && Array.isArray(r.receipt.appointmentBindings)) ? r.receipt.appointmentBindings.slice() : [] };
    } else if (target.dob && observed.chartDob && isFn(cv._saveVisits)) {
      savedCount = Number(cv._saveVisits(p, { name: observed.chartName || target.name, dob: observed.chartDob }, visits, function () {}, r.receipt));
    } else {
      var frozenMrn = normMrn(target.mrn), observedMrn = normMrn(observed.chartMrn), currentMrn = rowMrn(p);
      /* The patient can change while Athena is reading. The frozen target,
         returned chart, and freshly re-resolved store row must still name the
         same MRN immediately before the one atomic bulk write. */
      if (!frozenMrn || !observedMrn || frozenMrn !== observedMrn || currentMrn !== frozenMrn) throw new Error("visits-dob-mrn-proof-missing");
      for (var i = 0; i < visits.length; i++) {
        if (isFn(cv._visitIdentityAgrees) && !cv._visitIdentityAgrees(p, visits[i], true)) throw new Error("visit-row-identity-mismatch");
      }
      if (!isFn(vm.saveVerifiedVisitBatch)) throw new Error("visits-bulk-writer-unavailable");
      var batchSave = vm.saveVerifiedVisitBatch(p.id, visits, { source: "athena-schedule-history", bodyComplete: true, reconcile: true });
      savedCount = Number(batchSave && batchSave.saved || 0);
      reconcileReceipt = batchSave && batchSave.reconcile || null;
    }
    /* Saving without proving the exact stable encounter set can produce a
       dangerous false green: an inner wrapper may reject a row, or stored
       aliases may collide while older verified rows make the profile look
       populated. Reconcile once more and then prove that every r4 encounter is
       represented by exactly one body-complete row bound to this patient, with
       no extra verified Athena rows left behind. Manual/unverified rows are
       intentionally outside this check and are never deleted. */
    if (!reconcileReceipt) {
      if (!isFn(vm.reconcileVerifiedAthenaVisits)) throw new Error("visits-reconcile-unavailable");
      reconcileReceipt = vm.reconcileVerifiedAthenaVisits(p.id, visits);
    }
    if (!reconcileReceipt || reconcileReceipt.complete !== true) throw new Error("visits-reconcile-unproven");
    var fresh = patientById(target.patientId) || p;
    var storedVisits = safe(function () { return vm.getVisits(fresh); }, []) || [];
    function stableAliases(v) {
      var out = [], encounter = String(v && (v.encounterId || v.encounterID) || "").trim().toLowerCase(), source = String(v && (v.sourceVisitKey || v.rowKey) || "").trim().toLowerCase();
      if (encounter) out.push("encounter|" + encounter);
      if (source) out.push("source|" + source);
      return out;
    }
    function sourceBody(v) {
      return String(v && (v.raw || v.text || v.note || v.detail) || "").trim();
    }
    function sharesAlias(a, b) {
      for (var ai = 0; ai < a.length; ai++) if (b.indexOf(a[ai]) >= 0) return true;
      return false;
    }
    var acceptedAliases = visits.map(stableAliases);
    var acceptedBodies = visits.map(sourceBody);
    if (acceptedAliases.some(function (aliases) { return !aliases.length; })) throw new Error("visits-source-key-unproven");
    if (acceptedBodies.some(function (body) { return !body; })) throw new Error("visits-full-detail-unproven");
    var persisted = storedVisits.filter(function (v) {
      return !!(v && /athena|legacy|grab|pullrec/i.test(String(v.source || "")) && v.identityVerified === true &&
        String(v.identityBinding || "") === String(p.id) && v.indexOnly !== true && v.fullDetail === true &&
        v.bodyComplete === true && String(v.raw || "").trim() && stableAliases(v).length);
    });
    /* dscope-1.0.0: the whole-history census ("this read is the complete
       universe of verified rows") is exactly what a scoped slice must NOT
       assert - older encounters legitimately remain. The per-accepted-row
       proof below still runs in both modes. */
    if (!dscope && persisted.length !== parsed) throw new Error("visits-persistence-count-unproven");
    for (var pa = 0; pa < acceptedAliases.length; pa++) {
      var matches = 0, matchedIndex = -1;
      for (var ps = 0; ps < persisted.length; ps++) if (sharesAlias(acceptedAliases[pa], stableAliases(persisted[ps]))) { matches++; matchedIndex = ps; }
      if (matches !== 1) throw new Error("visits-persistence-alias-unproven");
      /* Stable aliases prove which encounter survived reconciliation, but not
         that this pull's clinical body survived. An optimistic inner save can
         otherwise leave yesterday's exact-alias row in place and still turn
         the current r4 receipt green. The visit model preserves the reader's
         trimmed body verbatim for a verified refresh, so equality is a strict
         postcondition rather than a fuzzy clinical-text comparison. */
      if (sourceBody(persisted[matchedIndex]) !== acceptedBodies[pa]) throw new Error("visits-persistence-body-unproven");
    }
    for (var pv = 0; pv < persisted.length; pv++) {
      var owners = 0, persistedAliases = stableAliases(persisted[pv]);
      for (var po = 0; po < acceptedAliases.length; po++) if (sharesAlias(persistedAliases, acceptedAliases[po])) owners++;
      /* dscope-1.0.0: on a scoped slice, older verified rows have zero owners
         by design; only a MULTI-owner row (alias collision) is ever a fault. */
      if (dscope ? owners > 1 : owners !== 1) throw new Error("visits-persistence-alias-collision");
    }
    /* v2.9.32 order-group entries: filed AFTER the strict clinical proof
       chain, as UNVERIFIED index-only rows (source athena-order-group-index)
       that reconcile intentionally never deletes. A failure here can never
       break the verified receipt - it only skips the extra entries. Re-pull
       is idempotent: an entry is added only when no stored visit already
       carries the same date + trimmed row text (or the same encounter id). */
    var administrativeSaved=0;
    safe(function(){
      var adminRows=Array.isArray(r.administrativeVisits)?r.administrativeVisits:[];
      if(!adminRows.length||!isFn(vm.addVisit)||!isFn(window.upsertPatient)) return;
      var adminCurrent=patientById(target.patientId);if(!adminCurrent)return;
      var adminStaged=JSON.parse(JSON.stringify(adminCurrent));
      var existing=safe(function(){return vm.getVisits(adminStaged)||[];},[]);
      function adminKey(v){var eid=String(v&&(v.encounterId||v.encounterID)||"").trim().toLowerCase();var body=String(v&&(v.raw||v.text||v.note||v.detail)||"").replace(/\s+/g," ").trim().toLowerCase();return (String(v&&v.date||"")+"|"+(eid||body)).slice(0,400);}
      var seenKeys={};
      existing.forEach(function(v){seenKeys[adminKey(v)]=1;});
      var stagedAdministrative=0;
      adminRows.forEach(function(row){
        if(!row||!String(row.raw||"").trim()) return;
        var key=adminKey(row); if(!key||seenKeys[key]) return; seenKeys[key]=1;
        if(vm.addVisit(target.patientId,row,{source:"athena-order-group-index",indexOnly:true,administrative:true,bodyComplete:false,persist:false,_patientRef:adminStaged})) stagedAdministrative++;
      });
      if(stagedAdministrative){var adminCommit=window.upsertPatient(adminStaged);if(adminCommit===false||(adminCommit&&adminCommit.ok===false))throw new Error("administrative-visit-commit-refused");administrativeSaved=stagedAdministrative;}
    });
    var responsiveOrganization=!!(r&&r.__mlsResponsiveOrganization===true&&isFn(vm.organizePatientHistoryResponsive));
    var organization=responsiveOrganization?{ok:true,deferred:true}:safe(function(){return isFn(vm.organizePatientHistory)?vm.organizePatientHistory(target.patientId):null;},null);
    if(!responsiveOrganization&&(!organization||organization.ok!==true)){
      /* px-6.1 (Elizabeth, 2026-08-08): a gate that discards the evidence of
         its own refusal makes every downstream failure unexplainable - the
         row said only "history-organization-unproven" while organize knew
         exactly which section refused and why. Carry organize's own reason
         and the missed-section list into the thrown message; the pull row
         renders this text, so the doctor sees what is actually missing. */
      var orgReason=String((organization&&organization.reason)||"organize-returned-no-result");
      var orgMissed=[];
      safe(function(){orgMissed=(organization&&organization.semanticCoverage&&organization.semanticCoverage.missedSections)||[];return null;});
      throw new Error("history-organization-unproven: "+orgReason+(orgMissed.length?(" - sections detected but not captured: "+orgMissed.join(", ")):""));
    }
    var refreshedCoverage=responsiveOrganization?null:safe(function(){return isFn(window._patientHistoryCardCoverage)?window._patientHistoryCardCoverage(target.patientId):null;},null);
    var clinicalFieldCount=['problems','meds','allergies','vitals','history'].reduce(function(n,k){return n+(refreshedCoverage&&refreshedCoverage.cards&&refreshedCoverage.cards[k]&&refreshedCoverage.cards[k].populated?1:0);},0);
    /* dfc-1.0.0: an UNSCOPED full walk may still carry same-day-lane metadata
       on its receipt (scopeDate + sameDayStatus + bindings) - ON derives its
       same-day proof from the one full read instead of a second scoped pass.
       Status passes the same closed vocabulary; no valid scopeDate = no claim. */
    if (!dsSameDayMeta) safe(function () {
      var rrMeta = r.receipt || {};
      var sdScope = String(rrMeta.scopeDate || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(sdScope)) return;
      var sdRaw = String(rrMeta.sameDayStatus || "");
      var sdSaved = visits.some(function (v) { return String(v && v.date || "").slice(0, 10) === sdScope; });
      dsSameDayMeta = {
        status: /^(saved|partial|refused|absent|not-yet-available)$/.test(sdRaw) ? sdRaw : (sdSaved ? "saved" : "refused"),
        scopeDate: sdScope,
        noSubstitution: rrMeta.noSubstitution !== false,
        appointmentBindings: Array.isArray(rrMeta.appointmentBindings) ? rrMeta.appointmentBindings.slice() : []
      };
    });
    return { visitCount: safe(function () { return vm.getVisits(fresh).length; }, visits.length), persistedVisits: dscope ? parsed : persisted.length, savedCount: savedCount, scopedAdditive: dscope === true, scopeDate: dscope ? dscopeDate : undefined, sameDayStatus: dscope ? dsSameDayStatus : undefined, sameDay: dsSameDayMeta || undefined, administrativeSaved: administrativeSaved, parsedVisits: parsed, expectedVisits: expected, visitsCoverageComplete: true, bodyComplete: true, fullDetail: true, readerVersion: readerVersion, authoritativeEmpty: expected===0&&r.receipt.authoritativeEmpty===true, reconcileReceipt: reconcileReceipt, organization:organization, profileCoverage:refreshedCoverage, clinicalFieldCount:clinicalFieldCount, surfaceResets: Number((r.receipt&&r.receipt.surfaceResets)||0), chartSurface: String((r.receipt&&r.receipt.chartSurface)||""), axRrWaitMs: Number((r.receipt&&r.receipt.axRrWaitMs)||0), axRrRecovered: (r.receipt&&r.receipt.axRrRecovered)===true, axEntry: String((r.receipt&&r.receipt.axEntry)||""), fatigueRefresh: (r.receipt&&r.receipt.fatigueRefresh)===true, hydStreak: Number((r.receipt&&r.receipt.hydStreak)||0) };
  }
  /* pvd-1.0.0 (Codex replies 24/27): every requested patient receives exactly
     ONE mutually exclusive final verdict, and the arithmetic CLOSES:
     requested === succeeded + failed + notAttempted + unaccounted. The walk
     counters cannot say this (processed++ fires for failures too, and a
     patient can sit in patients[] complete:true AND in retry[] at once - the
     measured double-count). Verdicts, closed vocabulary:
       succeeded      - walked, complete, and NOT re-queued
       failed         - walked and incomplete, or complete-but-requeued (the
                        conflict is COUNTED, never silently absorbed)
       not-attempted  - never walked (stop/deadline/unresolved-at-entry)
       unaccounted    - no evidence either way; counted so the sum still
                        closes and the gap is visible instead of vanishing.
     PHI-free: patient ids and reason codes only, never names. Pure; exposed
     as __mlsSI._historyVerdictCensus for extraction-executed tests. */
  function historyVerdictCensus(rows, unresolved, receipt) {
    rows = rows || []; unresolved = unresolved || [];
    var patients = (receipt && receipt.patients) || [], retry = (receipt && receipt.retry) || [];
    var NOT_ATTEMPTED = { "stopped-by-user": 1, "deferred-after-batch-deadline": 1 };
    var byPidPatient = {}, byPidRetry = {}, blankPatients = [], blankRetry = [], i, pid;
    for (i = 0; i < patients.length; i++) {
      pid = String((patients[i] && patients[i].patientId) || "");
      if (pid) { if (!byPidPatient[pid]) byPidPatient[pid] = patients[i]; }
      else blankPatients.push(patients[i]);
    }
    for (i = 0; i < retry.length; i++) {
      pid = String((retry[i] && retry[i].patientId) || "");
      if (pid) { if (!byPidRetry[pid]) byPidRetry[pid] = retry[i]; }
      else blankRetry.push(retry[i]);
    }
    var out = { requested: 0, succeeded: 0, failed: 0, omitted: 0, notAttempted: 0, unaccounted: 0, conflicts: 0, closed: false, perPatient: [] };
    var blankPatientAt = 0, blankRetryAt = 0;
    function judge(sourceRow, ordinal) {
      var rowPid = String((sourceRow && (sourceRow._mlsTargetPatientId || sourceRow.patient_external_id || sourceRow.patientId)) || "");
      var pe = null, re = null;
      if (rowPid) { pe = byPidPatient[rowPid] || null; re = byPidRetry[rowPid] || null; }
      else {
        /* pid-less rows consume pid-less entries in walk order - deterministic,
           and a row can never borrow another patient's identified evidence. */
        if (blankPatientAt < blankPatients.length) pe = blankPatients[blankPatientAt++];
        else if (blankRetryAt < blankRetry.length) re = blankRetry[blankRetryAt++];
      }
      var verdict, reason = "";
      if (pe && pe.complete === true && !re) { verdict = "succeeded"; }
      else if (pe && pe.complete === true && re) { verdict = "failed"; reason = String(re.reason || "requeued-after-success"); out.conflicts++; }
      /* tax-1.0.0: a reconciled named omission is its OWN terminal - proven
         chart, named missing detail, out of the retry pool, and NEVER a full
         visit-body success. Still re-queued means still failed. */
      else if (pe && pe.namedOmission && !re) { verdict = "complete-with-named-omissions"; reason = String((pe.namedOmission.detail || pe.namedOmission.reason || "")); }
      else if (pe) { verdict = "failed"; reason = String(pe.reason || (re && re.reason) || "incomplete"); }
      else if (re && NOT_ATTEMPTED[String(re.reason || "")]) { verdict = "not-attempted"; reason = String(re.reason); }
      else if (re) { verdict = "not-attempted"; reason = String(re.reason || "never-walked"); }
      else { verdict = "unaccounted"; reason = "no-entry"; }
      out.requested++;
      if (verdict === "succeeded") out.succeeded++;
      else if (verdict === "failed") out.failed++;
      else if (verdict === "complete-with-named-omissions") out.omitted++;
      else if (verdict === "not-attempted") out.notAttempted++;
      else out.unaccounted++;
      out.perPatient.push({ patientId: rowPid || ("row#" + ordinal), verdict: verdict, reason: String(reason).slice(0, 60) });
    }
    for (i = 0; i < rows.length; i++) judge(rows[i], i);
    for (i = 0; i < unresolved.length; i++) judge(unresolved[i], rows.length + i);
    out.closed = out.requested === out.succeeded + out.failed + out.omitted + out.notAttempted + out.unaccounted;
    return out;
  }
  /* tax-1.0.0 (Codex reply 27 p3): reconcile the refresh/day taxonomy ONLY
     where evidence permits. A chart whose identity, chart facts, and exact-
     day census were proven in THIS batch, but whose encounter body still
     binds nothing AFTER the capped reader re-attempted it (a retry pass),
     terminates as a NAMED OMISSION with the exact missing-detail sub-cause -
     it leaves the retry pool (the eternal "Retry failed histories (N)" burn)
     but it NEVER counts as a full visit-body success: one.complete stays
     false, ON-mode completeness stays partial, and the verdict census counts
     it in its own bucket. Transport/auth/identity/navigation/deadline
     failures stay failures and stay retryable - the sub-cause histogram must
     be pure content evidence or the entry is untouched (fail closed). */
  /* tax-1.0.1 (Codex reply 33): the classifier FAILS CLOSED. The transport
     blacklist regex treated every UNRECOGNIZED histogram key as content -
     background.js's real vocabulary carries safety/navigation/binding causes
     (identity-changed-before-detail, detail-binding-mismatch,
     encounter-surface-not-open, slideout-open-failed, click-failed, ...)
     that a blacklist can never enumerate ahead of time. This closed exact
     allowlist names the ONLY reviewed content/hydration-only causes that may
     become named omissions after the capped retry; every unknown, new,
     identity, binding, key-integrity, surface, frame, click, navigation,
     transport, auth, deadline, picker, or row-set cause stays retryable. */
  var TAX_CONTENT_ALLOW = { "accordion-not-open": 1, "no-bound-clinical-detail": 1 };
  function taxReconcileNamedOmissions(receipt) {
    var patients = (receipt && receipt.patients) || [], retry = (receipt && receipt.retry) || [];
    var byPid = {}, i, pid;
    for (i = 0; i < patients.length; i++) { pid = String((patients[i] && patients[i].patientId) || ""); if (pid && !byPid[pid]) byPid[pid] = patients[i]; }
    var keep = [], moved = [];
    for (i = 0; i < retry.length; i++) {
      var entry = retry[i];
      pid = String((entry && entry.patientId) || "");
      var pe = pid ? byPid[pid] : null;
      var reason = String((entry && entry.reason) || "");
      var eligible = false, detail = "";
      if (reason === "visit-bodies-incomplete" && pe && pe.identityVerified === true && pe.organized === true) {
        var rr = pe.visitsReadReceipt || null;
        var hist = pe.visitsFailedHistogram || null;
        var censusProven = !!(rr && Number(rr.expected || 0) > 0);
        var contentOnly = false;
        if (hist) {
          var keys = Object.keys(hist);
          contentOnly = keys.length > 0;
          for (var ki = 0; ki < keys.length; ki++) { if (TAX_CONTENT_ALLOW[String(keys[ki])] !== 1) { contentOnly = false; break; } }
          if (contentOnly) detail = keys.sort(function (a, b) { return Number(hist[b] || 0) - Number(hist[a] || 0); })[0];
        }
        eligible = censusProven && contentOnly;
      }
      if (eligible) {
        pe.namedOmission = { reason: reason, detail: String(detail).slice(0, 48), at: Date.now() };
        moved.push({ patientId: pid, reason: reason, detail: String(detail).slice(0, 48) });
      } else keep.push(entry);
    }
    if (moved.length) {
      receipt.retry = keep;
      receipt.namedOmissions = (Array.isArray(receipt.namedOmissions) ? receipt.namedOmissions : []).concat(moved);
    }
    return moved.length;
  }
  async function runHistoryBatch(rows, unresolved, onStatus, sweepOpts) {
    /* b744 #36: true only when the per-patient loop ran to completion; the
       finally uses it to close the progress reporter ONLY on the throw path
       (the normal close waits out the automatic sweeps below). */
    var batchBodyCompleted = false;
    /* si-1.9.1: sweeps inherit the OUTER frozen deadline (a sub-batch used to
       mint its own budget, which could keep the pull alive past the frozen
       deadline — never-immortal is the rule). Number form kept for callers. */
    /* si-2.1.0 (owner: "whatever happened to the amazing running icon"): the
       full-screen pull-progress panel and its pill (__mlsPullProgress, b113)
       watch window.__mlsDayHistoryPull.state — a contract the LEGACY
       day-history engine maintained and THIS engine never fed, so the panel
       has been structurally dead on every modern pull. Feed it honestly.
       Rules: never steal the state while the legacy engine is mid-run; a
       sub-batch (progressBase>0) NEVER resets the bar (the si-1.9.4 law —
       "when the bar resets it seems like nothing was done"); pipelined rows
       settle provisionally and are corrected at finalization; tallies are
       recomputed from rows so corrections can never drift. The
       patient-row-loss shield reads state.running and finally gets its
       signal on modern pulls too. */
    function ppState(){ try{ var g=window.__mlsDayHistoryPull=window.__mlsDayHistoryPull||{}; if(!g.state||g.state.__si!==1){ if(g.state&&g.state.running===true) return null; g.state={__si:1,running:false,total:0,done:0,ok:0,failed:0,current:'',rows:[]}; } return g.state; }catch(e){ return null; } }
    function ppTally(s){ try{ /* ppt-2.0 (owner 2026-08-09, watching day 9: "2 saved · 19 skipped"): the tally counted settle EVENTS, so a chart that failed three re-check passes then cleared counted 3 into "skipped" and 1 into "saved" forever. CHART-LEVEL truth: latest state per chart key wins; done = distinct charts seen (monotonic - the bar never moves backward, si-1.9.4). */ var latest={}; for(var ti=0;ti<s.rows.length;ti++){ var tr=s.rows[ti]; latest[tr.k||tr.name]=tr; } var tks=Object.keys(latest); var tok=0,tfail=0,tcs=0; for(var tj=0;tj<tks.length;tj++){ var tl=latest[tks[tj]]; if(tl.ok===true) tok++; else if(tl.pending!==true){ tfail++; if(tl.cs===true) tcs++; } } s.ok=tok; s.failed=tfail; s.chartOnly=tcs; s.done=tks.length; if((s.total||0)<tks.length) s.total=tks.length; }catch(e){} }
    function ppStart(total,base){ var s=ppState(); if(!s) return; if(base>0){ s.running=true; if(total>s.total) s.total=total; return; } s.running=true; s.total=total||0; s.done=0; s.ok=0; s.failed=0; s.current=''; s.rows=[]; s.runId='r'+Date.now().toString(36); /* srr-1.2: rows accumulate across sub-batches by the si-1.9.4 no-reset law - the runId lets readers slice the CURRENT run without resetting anything (the 22-rows-on-a-20-chart-day trap, 2026-08-08) */ }
    function ppCurrent(name){ var s=ppState(); if(s&&s.running) s.current=String(name||''); }
    function ppSettle(name,ok,reason,pending,extra){ var s=ppState(); if(!s||!s.running) return null; var r={name:String(name||''),ok:ok===true,reason:String(reason||''),pending:pending===true,runId:String(s.runId||'')}; if(extra){ r.sr=Number(extra.surfaceResets||0); r.surface=String(extra.chartSurface||''); if(extra.pid) r.pid=String(extra.pid); if(extra.axe) r.axe=String(extra.axe); if(extra.chartSaved===true) r.cs=true; /* qol-2.2 */ if(extra.sp===true) r.sp=true; /* cap-1.0.0 */ if(extra.dn) r.dn=String(extra.dn).slice(0,80); /* tny-1.0.0 */ if(extra.dnDay) r.dnd=String(extra.dnDay).slice(0,10); /* lcd-1.0.0: the note column's OWN day, so a receipt that lands later can prove it belongs to THIS row */ } /* ppt-2.0: rows key by name+pid so same-name patients stay distinct and re-settles REPLACE in the tally rather than double-count */ r.k=r.name+'|'+(r.pid||''); s.rows.push(r); ppTally(s); return r; }
    function ppResolve(rowRef,ok,reason,extra){ var s=ppState(); if(!s||!rowRef) return; rowRef.ok=ok===true; rowRef.pending=false; rowRef.reason=String(reason||''); if(extra){ if(extra.sp===true) rowRef.sp=true; /* cap-1.0.0 */ if(extra.chartSaved===true) rowRef.cs=true; if(extra.dn) rowRef.dn=String(extra.dn).slice(0,80); /* tny-1.0.0 */ if(extra.dnDay) rowRef.dnd=String(extra.dnDay).slice(0,10); /* lcd-1.0.0 */ } ppTally(s); }
    function ppEnd(){ var s=ppState(); if(s){ s.finishedAt=Date.now(); s.running=false; s.current=''; s.phase=null; } } /* dn-1.0: the DONE card freezes its clock on finishedAt */
    /* ===== dnp-1.0.0 (the day-note pass gets its OWN phase) =================
       Owner 2026-08-17: the bar sat at 100% with "18 saved · 5 not saved"
       painted while "saving the pulled day's note (7 of 23)" was still
       running. The history rows really WERE all settled - the bar was telling
       the truth about the wrong thing. The engine now publishes the day-note
       pass as a named phase with its own counts, so the surface that owns the
       dialog can show "reading today's notes 7 of 23" under the same bar and
       withhold "complete" until phase === null. PHI-free: a kind and two
       integers. */
    function ppPhase(kind, done, total){
      var s = ppState(); if (!s) return null;
      if (!kind) { s.phase = null; return null; }
      s.phase = { kind: String(kind), done: Number(done || 0), total: Number(total || 0), at: Date.now() };
      return s.phase;
    }
    var sweepDepth = Number(sweepOpts && sweepOpts.depth != null ? sweepOpts.depth : sweepOpts) || 0;
    var sweepDeadlineCapAt = Number(sweepOpts && sweepOpts.deadlineCapAt || 0);
    /* si-1.9.4 (owner 2026-07-22): "when the bar resets it makes it seem like
       nothing was done". The pull bar parses "N of M" from these statuses, so
       a sweep sub-batch reporting "1 of 2" visually threw away 14 finished
       charts. Sweeps now report their position INSIDE the whole pull
       (base + i of the original total) — the bar only ever moves forward. */
    var sweepProgressBase = Math.max(0, Math.floor(Number(sweepOpts && sweepOpts.progressBase || 0)));
    var sweepProgressTotal = Math.max(0, Math.floor(Number(sweepOpts && sweepOpts.progressTotal || 0)));
    /* ===== dnd-1.0.0 (day-note day resolution) =====
       Owner 2026-08-17, "Pull Thursday the 27th" (2026-08-27, 15 appts):
       dayVerdict tnReasons {no-day-on-row:15}. MEASURED CAUSE: the retry/sweep
       rows are rebuilt by buildRetryRows from frozenRetryEntry, which carried
       identity but no day, so `row.scheduleDate || row.date` was EMPTY and the
       pulled day's own note was never read for any row. The day is now frozen
       onto the retry entry (above) AND the batch keeps its own scope day, so a
       row can only be day-less when the pull itself has no day - which is the
       only case that may honestly settle "no-day-on-row". */
    var batchScopeDay = normDate((sweepOpts && sweepOpts.scopeDay) || "") || "";
    if (!batchScopeDay) {
      for (var bsdI = 0; bsdI < rows.length && !batchScopeDay; bsdI++) {
        batchScopeDay = normDate((rows[bsdI] && (rows[bsdI].scheduleDate || rows[bsdI].date)) || "") || "";
      }
    }
    function batchRowDay(row) {
      return normDate((row && (row.scheduleDate || row.date)) || "") || batchScopeDay;
    }
    /* ===== end dnd-1.0.0 (day-note day resolution) ===== */
    /* ===== dnf-1.0.0 (the day-note leg is bounded, and never asks a future day) =====
       MEASURED on the owner's PRODUCTION pull 2026-08-17 (b1027, ext 3.0.62,
       Tue 2026-08-18 = TOMORROW, 14 rows, bodies OFF): the batch sat at
       "Reading verified history 2 of 14" for more than 75 SECONDS with the
       day-note leg running - a scoped encounter read for a day that has not
       happened yet, where no note can exist. Two separate defects in one:
       (a) a FUTURE day has no note to read. That is not a failure and must not
           be counted as one: todayNote is stamped "future-day" (fd-1.0.0),
           which is neither true (nothing was read) nor false (nothing failed),
           so todayNoteFailures stays honest and the row is attempt-once.
           TODAY and every PAST day are unchanged - the owner's standing
           requirement that the pulled day's own note is read with bodies OFF
           holds exactly as before.
       (b) one row could stall the whole batch. Every day-note read is now
           bounded by its own absolute deadline and refuses with a named
           reason, so the slowest row costs DN_ROW_DEADLINE_MS, never the day.
       Codes only - no name, DOB or MRN reaches any reason string. */
    var DN_ROW_DEADLINE_MS = 45000;
    /* ===== dnb-1.0.0 (the day-note budget is MEASURED, never assumed) =======
       Owner watching live 2026-08-17 20:45-20:58Z (/cloned, bodies OFF, 24
       patients, athena tabs HIDDEN/occluded): histories 24/24 in ~4 min, then
       10 of 24 day-notes died `pulled-day-note-deadline-exceeded`. A hidden
       athena tab is slow — a flat 45 s is a guess about a machine we can
       measure instead. Every SUCCESSFUL day-note read feeds readStats.daynote,
       and the next row's deadline is 2.5x the median of what this machine has
       actually needed (floor 45 s so nothing gets tighter than today, cap
       150 s so one wedged row can still never own the pull). */
    var DN_ROW_DEADLINE_CAP_MS = 150000;
    /* ===== dnb2-1.0.0 (only a SUCCESS may raise the ceiling) ================
       MEASURED on the owner's same-day re-pull 2026-08-17: dnb-1.0.0's ceiling
       is max(45 s, 2.5 x median) and readStats.daynote was fed by every read
       that RESOLVED - including a slow REFUSAL. On a machine where the reads
       are failing that INFLATES the wait instead of shortening it: 19 unread
       rows x an inflated ceiling = 19 minutes for 6 recovered notes.
       A deadline is a bet that the NEXT read will finish, so only evidence
       that reads are finishing may raise it:
         - base 45 s (dnf-1.0.0's measured-sane default, unchanged);
         - each consecutive FAILURE takes 10 s off, floor 25 s;
         - the 150 s cap is reachable only after DN_RAISE_AFTER_OK consecutive
           SUCCESSFUL reads, and then only as 2.5 x their measured median.
       The streaks ride the receipt so "the ceiling moved, and why" is a
       number rather than an opinion. */
    var DN_ROW_DEADLINE_FLOOR_MS = 25000;
    var DN_ROW_DEADLINE_STEP_MS = 10000;
    var DN_RAISE_AFTER_OK = 3;
    var dnOkStreak = 0, dnFailStreak = 0;
    /* the ONE expression that decides a day-note read succeeded. It used to be
       written out at three call sites, which is how two of them could drift. */
    function tnReadOk(res) {
      return !!(res && (res.ok === true || typeof res === "number" || res.visits != null));
    }
    function tnRecordDayNoteOutcome(ok, ms) {
      if (ok === true) {
        dnOkStreak++; dnFailStreak = 0;
        safe(function () { recordReadMs("daynote", Number(ms || 0)); });
      } else { dnOkStreak = 0; dnFailStreak++; }
      safe(function () { receipt.todayNoteOkStreak = dnOkStreak; receipt.todayNoteFailStreak = dnFailStreak; });
    }
    function tnRowDeadlineMs() {
      return safe(function () {
        if (dnFailStreak > 0) return Math.max(DN_ROW_DEADLINE_FLOOR_MS, DN_ROW_DEADLINE_MS - (dnFailStreak * DN_ROW_DEADLINE_STEP_MS));
        if (dnOkStreak >= DN_RAISE_AFTER_OK) return adaptiveCeilingMs("daynote", DN_ROW_DEADLINE_MS, DN_ROW_DEADLINE_CAP_MS, DN_ROW_DEADLINE_MS);
        return DN_ROW_DEADLINE_MS;
      }, DN_ROW_DEADLINE_MS);
    }
    /* ===== end dnb2-1.0.0 ===== */
    /* ===== dnp2-1.0.0 (the day-note PASS has a total budget) ================
       MEASURED 2026-08-17 (owner, /cloned, 24 rows, three athena tabs, the
       leased one occluded): the fresh pull read 24 histories in ~4 min and
       then spent 943 s on the day-note leg (19 of 24 unread); the same-day
       re-pull skipped every history as verified-today and STILL spent ~19 min
       on the 19 unread rows, for 6 recovered. Done arrived at 20 minutes.
       A per-row bound cannot fix that - 19 rows x 60 s IS 19 minutes with
       every row inside its own deadline. So the PASS gets ONE frozen budget
       for the whole pull (the inline legs and the tail pass share it): 10 s a
       row, never under a minute, never over four. When it is spent the
       remaining rows are handed to the background backfill IMMEDIATELY with an
       honest code - they are not read, and they are not failures. */
    var DN_PASS_MS_PER_ROW = 10000;
    var DN_PASS_MIN_MS = 60000;
    var DN_PASS_MAX_MS = 240000;
    var DN_PASS_MIN_ROW_MS = 5000;   /* a row never gets a deadline below this */
    var dnPassBudgetFrozenMs = 0, dnPassSpentMs = 0;
    function dnPassBudget() {
      if (!dnPassBudgetFrozenMs) {
        var n = Math.max(1, (Array.isArray(rows) ? rows.length : 0) || 1);
        dnPassBudgetFrozenMs = Math.max(DN_PASS_MIN_MS, Math.min(DN_PASS_MAX_MS, n * DN_PASS_MS_PER_ROW));
        safe(function () { receipt.todayNotePassBudgetMs = dnPassBudgetFrozenMs; });
      }
      return dnPassBudgetFrozenMs;
    }
    function dnPassLeftMs() { return Math.max(0, dnPassBudget() - dnPassSpentMs); }
    function dnPassExhausted() { return dnPassLeftMs() <= 0; }
    /* ===== end dnp2-1.0.0 ===== */
    /* dnrs-1.0.0: "report chartOpens per pull" (owner deliverable 4). Every
       athena chart open this batch causes goes through one of exactly two
       doors: this wrapper (the history/visits legs) and tnBoundedRead (the
       day-note leg). Counting them at the door is the only count that cannot
       drift from what the tab actually did. The call is delegated verbatim so
       `this` is still window at the inner call. */
    function dnReadChart(target, say, opts) {
      safe(function () { receipt.chartOpensHistory = Number(receipt.chartOpensHistory || 0) + 1; });
      return window._assistReadChart(target, say, opts);
    }
    function tnDayApplicable(day) {
      var d = normDate(day || "") || "";
      if (!d) return { ok: false, future: false, reason: "no-day-on-row" };
      if (dayNoteFuture(d)) return { ok: false, future: true, reason: "future-day" }; /* fd-1.0.0 */
      return { ok: true, future: false, reason: "" };
    }
    function tnBoundedRead(vp, p, day, opts) {
      var budget = tnRowDeadlineMs();
      /* dnb2-1.0.0: the machine's own per-row bet, BEFORE the pass clip below.
         Recorded as a bounded trace of integers so "successes raised it,
         failures lowered it" is readable off the receipt rather than inferred
         from the single last value the clip may have overwritten. */
      var ceiling = budget;
      safe(function () {
        receipt.todayNoteRowCeilingMs = ceiling;
        receipt.todayNoteCeilings = receipt.todayNoteCeilings || [];
        if (receipt.todayNoteCeilings.length < 60) receipt.todayNoteCeilings.push(ceiling);
      });
      /* dnp2-1.0.0: the LAST row may not spend four minutes proving the pass
         is over. A row's own deadline is clipped to what the pass has left.
         The background backfill (opts.offPass) runs after the pull's Done and
         is deliberately NOT charged to the pull's budget. */
      if (!(opts && opts.offPass === true)) {
        var left = dnPassLeftMs();
        budget = Math.max(DN_PASS_MIN_ROW_MS, Math.min(budget, left));
      }
      var startedAt = Date.now(), at = startedAt + budget;
      safe(function () { receipt.todayNoteBudgetMs = budget; });
      /* dnrs-1.0.0: every scoped day-note read is ONE athena chart open (the
         reader re-verifies the surface through _assistReadChart before it
         reads). Counting them here is the only honest source for "how many
         charts did this pull open". */
      safe(function () { receipt.chartOpensDayNote = Number(receipt.chartOpensDayNote || 0) + 1; });
      return boundedUntil(
        Promise.resolve().then(function () { return vp.runForPatient(p, function () {}, { onlyDate: String(day) }); }),
        at, "pulled-day-note-deadline-exceeded").then(function (res) {
          /* dnb2-1.0.0: only a read that FINISHED **AND SUCCEEDED** tells us
             what this machine costs. A slow refusal used to feed the median
             and raise everyone else's wait. */
          tnRecordDayNoteOutcome(tnReadOk(res), Date.now() - startedAt);
          return res;
        }, function (err) {
          tnRecordDayNoteOutcome(false, Date.now() - startedAt);
          throw err;
        });
    }
    /* records the per-row cost of the day-note leg so "the day-note leg is
       what makes the pull slow" is a measurement, never an opinion. */
    function tnStamp(entry, ms, outcome) {
      if (!entry) return;
      entry.todayNoteMs = Number(ms || 0);
      receipt.todayNoteMsTotal = Number(receipt.todayNoteMsTotal || 0) + Number(ms || 0);
      receipt.todayNoteAttempts = Number(receipt.todayNoteAttempts || 0) + 1;
      if (Number(ms || 0) > Number(receipt.todayNoteMsMax || 0)) receipt.todayNoteMsMax = Number(ms || 0);
      /* dnp2-1.0.0: EVERY millisecond the pull spends on the day-note lane is
         charged to the one pass budget, wherever it was spent. */
      dnPassSpentMs += Number(ms || 0);
      safe(function () { receipt.todayNotePassSpentMs = dnPassSpentMs; receipt.todayNotePassLeftMs = dnPassLeftMs(); });
      if (outcome === "skipped") {
        receipt.todayNoteSkipped = Number(receipt.todayNoteSkipped || 0) + 1;
        if (entry.todayNoteSkipped === "future-day") receipt.todayNoteSkippedFutureDay = Number(receipt.todayNoteSkippedFutureDay || 0) + 1; /* fd-1.0.0 */
        if (entry.todayNoteSkipped === "not-yet-seen") receipt.todayNoteSkippedNotYet = Number(receipt.todayNoteSkippedNotYet || 0) + 1; /* tny-1.0.0 */
        if (entry.todayNoteSkipped === "already-read") receipt.todayNoteSkippedAlreadyRead = Number(receipt.todayNoteSkippedAlreadyRead || 0) + 1; /* dnrs-1.0.0 */
      }
    }
    /* ===== dnrs-1.0.0 (a note this account day already saved is never re-opened) =====
       Owner deliverable 4, measured shape: the same-day re-pull skipped every
       HISTORY as verified-today (instant, rsk-1.0.0) and then opened a chart
       for the day-note of every row - including the five whose notes the first
       pull had already read and saved. A note this account day already read
       and stored is the one read that is provably redundant, so it earns the
       same bar rsk-1.0.0 uses for charts, applied to the note column: the day
       ledger recorded it read, the record was written within 12 h, and on the
       SAME account day. `window.__mlsP1SkipReadDayNotes = false` turns it off
       for a live A/B. */
    function dnSkipReadEnabled() {
      return safe(function () { return window.__mlsP1SkipReadDayNotes !== false; }, true);
    }
    function dnAlreadyReadToday(day, patientId) {
      if (!dnSkipReadEnabled() || !day || !patientId) return null;
      return safe(function () {
        var x = readIndex(day), h = x && x.history;
        if (!h) return null;
        var at = Number((h.todayNoteReadAt || {})[String(patientId)] || 0);
        if (!(at > 0)) return null;
        if (Date.now() - at > 12 * 3600 * 1000) return null;
        if (accountDayFromInstant(at) !== acctTodayKey()) return null;
        return { at: at };
      }, null);
    }
    function tnStampAlreadyRead(entry, at) {
      if (!entry) return;
      entry.todayNote = "already-read";
      entry.todayNoteReason = "";
      entry.todayNoteSkipped = "already-read";
      entry.todayNoteReadAt = Number(at || 0);
      tnStamp(entry, 0, "skipped");
    }
    /* ===== end dnrs-1.0.0 ===== */
    /* dnp2-1.0.0: the pass budget is spent. This row is HANDED OVER - not read
       and not failed - and goes to the background backfill immediately. */
    function tnStampHandedOff(entry, day) {
      if (!entry) return;
      entry.todayNote = false;
      entry.todayNoteReason = "day-note-pass-budget-exhausted";
      entry.todayNoteHandedOff = true;
      tnStamp(entry, 0, "handed-off");
      safe(function () { receipt.todayNoteHandedOff = Number(receipt.todayNoteHandedOff || 0) + 1; });
      tnDeferRow(entry, day, true);
    }
    /* ===== end dnf-1.0.0 ===== */
    /* ===== tny-1.0.0 (TODAY's not-yet-seen appointments are not failures) =====
       fd-1.0.0 proved the shape for a FUTURE day: no encounter exists, so
       nothing was read and nothing failed. TODAY has the same hole in the
       middle of it. MEASURED live 2026-08-17 on the owner's /1p at 13:52 ET:
       16 rows, dayVerdict tnFailed 12, nine of them "Safety stop - Athena
       returned an encounter index without verified full detail" - which is
       what feat_visits.js throws (line 2355) when the scoped read finds NO
       verified encounter body for that date. A 3 pm patient at 1:52 pm has no
       note because the visit has not happened; calling that a failure both
       lies to the doctor and spends DN_ROW_DEADLINE_MS (45 s) per row proving
       it.

       Two independent detectors, both fail-CLOSED toward reading:
        (a) TIME - the appointment's own start time is later than now in the
            ACCOUNT zone. Deterministic, costs zero, and skips the read.
        (b) RECEIPT - the reader came back with the "index has no verified
            encounter for that date" refusal. Only on TODAY, and only for that
            exact refusal class; every other refusal stays a real failure.
       A row with no time and no such refusal is read exactly as before, and a
       PAST day is untouched: a missing note on a finished day is a real gap. */
    var TNY_NO_ENCOUNTER = /(encounter index without verified full detail|no encounter (?:body|note)?\s*(?:was\s*)?found|no-encounter-for-date|encounter-index-empty|index-empty|no-visits-for-date)/i;
    /* minutes past midnight for an appointment row, or -1 when unknown */
    function tnRowMinutes(row) {
      var raw = String((row && (row.time || row.start_local || row.time_display || row.startTime)) || "");
      var hhmm = normTime(raw) || "";
      var m = /^([0-9]{2}):([0-9]{2})$/.exec(hhmm);
      if (!m) return -1;
      return (Number(m[1]) * 60) + Number(m[2]);
    }
    /* minutes past midnight RIGHT NOW in the account zone. Never the browser
       zone: a clinician one timezone over would otherwise mark the whole
       morning as not-yet-seen (or none of it). */
    function tnNowMinutes() {
      return safe(function () {
        var parts = new Intl.DateTimeFormat("en-US", { timeZone: EST_TZ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
        var hh = "", mm = "";
        parts.forEach(function (p) { if (p.type === "hour") hh = p.value; else if (p.type === "minute") mm = p.value; });
        if (!/^[0-9]{1,2}$/.test(hh) || !/^[0-9]{2}$/.test(mm)) return -1;
        return (Number(hh) % 24) * 60 + Number(mm);
      }, -1);
    }
    /* has this appointment's slot arrived? A past day is always yes; an
       unknown time is treated as yes so a row can never be parked forever. */
    function tnApptPassed(day, row) {
      var d = normDate(day || "") || "";
      if (!d) return true;
      var t = acctTodayKey();
      if (!t || d !== t) return true;               /* past day (future is fd-1.0.0) */
      var mins = tnRowMinutes(row);
      if (mins < 0) return true;                    /* no time on the row */
      var now = tnNowMinutes();
      if (now < 0) return true;                     /* cannot prove it - read it */
      return now >= mins;
    }
    function tnStampNotYet(entry, from) {
      if (!entry) return;
      entry.todayNote = "not-yet";
      entry.todayNoteReason = "not-yet-seen";
      entry.todayNoteSkipped = "not-yet-seen";
      entry.todayNoteNotYetFrom = String(from || "time");
      tnStamp(entry, 0, "skipped");
    }
    /* the DAY-NOTE COLUMN. Deliberately separate from the row's history
       verdict: read / not-yet / unread-with-reason, never a row failure. */
    function tnColumn(entry) {
      if (!entry) return "";
      if (entry.todayNote === true) return "read";
      /* dnrs-1.0.0: the note IS on file - this pull simply did not need to
         re-open the chart to put it there. The doctor's column says read. */
      if (entry.todayNote === "already-read") return "read";
      if (entry.todayNote === "not-yet") return "not-yet";
      if (entry.todayNote === "future-day") return "future-day";
      /* dnw-1.0.0 (owner 2026-08-17: "comments like this would scare a user"):
         a row QUEUED for the deferred round has not failed - it has not
         finished. Say so, and keep "could not be read" for the end of the
         lane, after the retry has actually had its turn. */
      if (entry.todayNote === false && entry.todayNoteDeferred === true) return "retrying:" + String(entry.todayNoteReason || "unknown").slice(0, 60);
      if (entry.todayNote === false) return "unread:" + String(entry.todayNoteReason || "unknown").slice(0, 60);
      return "";
    }
    /* DELIVERABLE 3 (owner 2026-08-17): the day-note leg may NOT fail the row.
       Before this, every unread note pushed ppSettle(..., ok:false, ...) AFTER
       the row's own settle, and latest-state-wins made the day-note verdict the
       row's visible verdict - 12 "not saved" rows on a day whose charts were
       read. The row keeps its HISTORY verdict; the note rides in r.dn. */
    /* ===== dnw-1.0.0 (a fixed row must stop showing the failure) ============
       MEASURED here, in this suite: the deferred round DID recover rows and
       DID recompute the receipt, but the panel never changed - ppSettle
       refuses to touch a reporter that has ended (`!s.running`), and the
       deferred round by definition runs after ppEnd. So a doctor watching the
       DONE card kept reading "the note for the pulled day could not be read"
       about a note that had just been saved.
       Re-stamping mutates the row that is already on the card, in place: it
       adds no row, moves no saved/failed tally (the day-note lane stays
       verdict-neutral, dv3-1.0.0), and touches only the note cell. */
    /* ===== lcd-1.0.0 (the open result card is LIVE) =========================
       OWNER 2026-08-19, verbatim: "as the things in orange get pulled in the
       background they should turn to green."
       dnw-1.0.0 above already re-stamps the note cell in place, so the DATA
       half of this was half-built. Two things were missing and the card stayed
       a dead snapshot anyway:
         (a) the row carried no DAY. Without one, anything arriving later could
             only guess which row a receipt belonged to - and "the next orange
             row" is exactly the positional attribution that is never safe on a
             list of patients.
         (b) the notes-idle engine - the thing that actually reads the leftover
             notes in the background - never touched these rows at all. It
             pinned its own line and stopped. That half is niRestampCard(), in
             the notes-idle block below.
       This function supplies (a), and marks a cell that has genuinely FLIPPED
       from orange to green (dnLive) so the card's tally can subtract a PROVEN
       recovery rather than recount and risk inventing one. */
    function tnEntryDay(entry) {
      var pid = String((entry && entry.patientId) || ""), d = "";
      if (pid) {
        for (var i = 0; i < rows.length && !d; i++) {
          var r = rows[i];
          var rid = String((r && (r._mlsTargetPatientId || r.patient_external_id)) || "");
          if (rid && rid === pid) d = batchRowDay(r);
        }
      }
      return d || tnBatchDay() || "";
    }
    function ppRestampDayNote(entry) {
      var s = ppState();
      if (!s || !entry) return false;
      var col = tnColumn(entry);
      if (!col) return false;
      var pid = String(entry.patientId || ""), nm = String(entry.name || ""), hit = null;
      for (var i = (s.rows || []).length - 1; i >= 0; i--) {
        var r = s.rows[i];
        if (!r) continue;
        if (pid ? String(r.pid || "") === pid : String(r.name || "") === nm) { hit = r; break; }
      }
      if (!hit) return false;
      /* lcd-1.0.0: read the OLD value before overwriting it - the flip is the
         thing being recorded, not the destination. */
      var wasOrange = String(hit.dn || "").indexOf("unread:") === 0 || String(hit.dn || "").indexOf("retrying:") === 0;
      hit.dn = col;
      var day = tnEntryDay(entry);
      if (day) hit.dnd = day;
      if (wasOrange && col === "read") { hit.dnLive = 1; hit.dnLiveAt = Date.now(); }
      return true;
    }
    /* ===== end lcd-1.0.0 (row day + flip marker) ===== */
    function tnEmitDayNoteColumn(entry) {
      if (!entry || !entry.name || typeof ppSettle !== "function") return;
      var col = tnColumn(entry);
      if (!col) return;
      var ppLive = safe(function () { var s = ppState(); return !!(s && s.running === true); }, false);
      if (!ppLive) { safe(function () { ppRestampDayNote(entry); }); return; }
      safe(function () {
        ppSettle(entry.name, entry.complete === true,
          entry.complete === true ? (entry.summaryPending === true ? "saved · summary pending" : "") : ((entry.reason || "") + historyDiagSuffix(entry)),
          false,
          { pid: entry.patientId, sp: entry.summaryPending === true, dn: col, dnDay: tnEntryDay(entry), /* lcd-1.0.0 */
            chartSaved: ((entry.organized === true && entry.dobVerified === true) || entry.captureSaved === true) && !entry.storageFailure });
      });
    }
    /* ===== end tny-1.0.0 ===== */
    /* ===== rsk-1.0.0 (a re-run does not re-read what it already proved) =====
       Two requirements, one mechanism. (a) STOP: "a re-run must resume/skip
       verified rows" - after a stopped pull the doctor presses Pull again and
       the rows that already landed must not be read from scratch. (b) SPEED,
       measured not claimed: a chart this same account day already read,
       verified and STORED WITH CONTENT is the one read that is provably
       redundant.

       The bar is deliberately high and every clause is evidence, not a marker:
         - the DAY LEDGER records this patient as "ok" for THIS day (written by
           recordHistoryVerdict, i.e. a completed row of a real batch);
         - that verdict was written on the SAME account day and within 12 h;
         - the ledger says the day's content census was MEASURED and the day
           was contentVerified (no gap) - the scv-1.0.0 bar, not a counter;
         - the stored record STILL holds clinical content right now; and
         - the frozen target's DOB/MRN still equal the stored patient's.
       Any one of those missing means a full fresh read. Nothing is loosened:
       a skipped row is recorded as skipped, never as a fresh verified read,
       and window.__mlsP1SkipVerifiedToday = false turns it off for a live A/B. */
    function rskEnabled() {
      return safe(function () { return window.__mlsP1SkipVerifiedToday !== false; }, true);
    }
    function rskAlreadyVerifiedToday(day, target, wantScope) {
      if (!rskEnabled() || !day || !target || !target.patientId) return null;
      return safe(function () {
        var x = readIndex(day), h = x && x.history;
        if (!h || h.contentMeasured !== true || h.contentVerified !== true) return null;
        var at = Number(h.at || 0);
        if (!(at > 0) || Date.now() - at > 12 * 3600 * 1000) return null;
        if (accountDayFromInstant(at) !== acctTodayKey()) return null;
        var pid = String(target.patientId);
        if (String((h.perPatient || {})[pid] || "") !== "ok") return null;
        var p = findStorePatient(pid);
        if (!p) return null;
        if (normDob(target.dob) && normDob(p.dob) !== normDob(target.dob)) return null;
        if (normMrn(target.mrn) && rowMrn(p) !== normMrn(target.mrn)) return null;
        var c = censusPatientContent(p), any = false;
        for (var ci = 0; ci < CENSUS_CONTENT_FIELDS.length; ci++) if (c[CENSUS_CONTENT_FIELDS[ci]]) { any = true; break; }
        if (!any) return null;
        /* cachev-1.0.0: a bare "ok today" bit predates the mandatory
           coverage + exact-day-note floor and cannot prove those independent
           lanes completed. Only a v2 proof with per-lane receipts may skip
           the fresh read, and a narrow scope never satisfies a wider request
           (an OFF/day-facts proof cannot skip an ON/full pull). The
           validator is a pure closed-shape check: transport truthiness never
           substitutes for semantic proof. */
        var proofVersion = Number(h.proofVersion || 1);
        var lanes = (h.perPatientLanes && h.perPatientLanes[pid]) || null;
        if (proofVersion !== 2 || !lanes || Number(lanes.v) !== 2) return { rejectedReason: "legacy-proof-schema-unversioned", proofVersion: proofVersion };
        if (!(lanes.coverage && lanes.coverage.complete === true)) return { rejectedReason: "clinical-floor-coverage-unproven", proofVersion: proofVersion };
        if (!(lanes.sameDayNote && /^(saved|absent|not-yet-available)$/.test(String(lanes.sameDayNote.status || "")))) return { rejectedReason: "same-day-lane-unproven", proofVersion: proofVersion };
        var provedScope = String((lanes.allHistory && lanes.allHistory.scope) || "");
        var scopeOk = lanes.allHistory && lanes.allHistory.complete === true && (provedScope === "full" || provedScope === String(wantScope || ""));
        if (!scopeOk) return { rejectedReason: "scope-version-insufficient", proofVersion: proofVersion };
        /* onheal-1.0.0: the accepted same-day status travels WITH the skip.
           Without it the skip path wrote a ledger row carrying no same-day lane
           at all, the next write regressed that row to "unknown", and the THIRD
           pull re-walked the chart the second one had proven. */
        return { at: at, day: String(day), sameDayNoteStatus: String(lanes.sameDayNote.status) };
      }, null);
    }
    /* ===== end rsk-1.0.0 ===== */
    /* si-2.0.0 INCREMENTAL VERIFIED HISTORY (owner 2026-07-23: "43 minutes for
       a pull is way too slow"). The expensive stage is re-reading every
       encounter BODY for patients whose bodies this engine already read,
       verified, and identity-bound on a previous pull. Every completed body
       pass now stamps the patient (athenaVisitsProof: when + an index
       signature + the verified-body count; the stamp mirrors to the server
       with the record). A later pull still does the FRESH chart read and
       six-card organize — which refreshes the visit INDEX — and when that
       fresh index signature matches the stamp, the bodies are provably
       unchanged and the per-encounter re-read is skipped, recorded honestly
       as visitsVerifiedCarry on the receipt. Any new/changed index row, any
       missing verified body, or a stamp older than 72h forces the full
       re-read (which re-stamps). Evidence-based each pull — never a bare
       "pulled before" marker. */
    function visitIndexSig(p) {
      var rows = (Array.isArray(p && p.visits) ? p.visits : []).map(function (v) {
        return [String(v && v.date || ""), String(v && v.type || ""), String(v && v.encounterId || ""), String(v && v.sourceVisitKey || "")].join("|");
      }).sort();
      var s = rows.join("~"), h = 5381;
      for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
      return rows.length + ":" + (h >>> 0).toString(36);
    }
    function countVerifiedBodiesFor(p) {
      var n = 0;
      (Array.isArray(p && p.visits) ? p.visits : []).forEach(function (v) {
        if (v && v.bodyComplete === true && String(v.raw || "").trim() && v.identityVerified === true && String(v.identityBinding || "") === String(p.id)) n++;
      });
      return n;
    }
    function findStorePatient(patientId) {
      return safe(function () {
        var arr = isFn(window.getPatients) ? (window.getPatients() || []) : [];
        for (var i = 0; i < arr.length; i++) if (arr[i] && String(arr[i].id) === String(patientId)) return arr[i];
        return null;
      }, null);
    }
    function stampVisitsProof(patientId, savedVisits) {
      safe(function () {
        var arr = isFn(window.getPatients) ? (window.getPatients() || []) : [];
        for (var i = 0; i < arr.length; i++) if (arr[i] && String(arr[i].id) === String(patientId)) {
          /* mutate IN PLACE (callers hold live references mid-batch) and let
             the pending-sync queue mirror the stamped record to the server. */
          arr[i].athenaVisitsProof = {
            completeAt: Date.now(), indexSig: visitIndexSig(arr[i]), bodies: countVerifiedBodiesFor(arr[i]),
            organizationOk: !!(savedVisits && savedVisits.organization && savedVisits.organization.ok === true),
            expectedVisits: Number(savedVisits && savedVisits.expectedVisits || 0),
            parsedVisits: Number(savedVisits && savedVisits.parsedVisits || 0),
            visitCount: Number(savedVisits && savedVisits.visitCount || 0),
            persistedVisits: Number(savedVisits && savedVisits.persistedVisits || 0),
            readerVersion: String(savedVisits && savedVisits.readerVersion || ""),
            authoritativeEmpty: savedVisits && savedVisits.authoritativeEmpty === true
          };
          /* b744 #36: join the patient batch instead of forcing an unbatched
             full-store LZ compress per stamped patient (upsertPatient defers
             to the active pull batch; savePatients stays the fallback). */
          if (isFn(window.upsertPatient)) window.upsertPatient(arr[i]);
          else if (isFn(window.savePatients)) window.savePatients(arr);
          safe(function () { if (isFn(window._pendingSyncAdd)) window._pendingSyncAdd(String(patientId)); });
          return;
        }
      });
    }
    function visitsProofCarry(patientId) {
      return safe(function () {
        var p = findStorePatient(patientId);
        if (!p || !p.athenaVisitsProof) return null;
        var proof = p.athenaVisitsProof;
        if (!(Number(proof.completeAt) > 0) || Date.now() - Number(proof.completeAt) > 72 * 3600 * 1000) return null;
        if (String(proof.indexSig || "") !== visitIndexSig(p)) return null;
        var bodies = countVerifiedBodiesFor(p);
        if (!(bodies >= Number(proof.bodies || 0))) return null;
        return proof;
      }, null);
    }
    rows = Array.isArray(rows) ? rows : []; unresolved = Array.isArray(unresolved) ? unresolved : [];
    /* Resolve the frozen scope before the receipt is built or any chart door
       can open. An explicit operation override wins; otherwise the one shared
       tri-state preference is authoritative. Missing/unsettled state is
       fail-closed here because first-run admission owns asking the user. */
    var pullVisitBodies = safe(function () {
      if (typeof _pullBodiesOverride === "boolean") return _pullBodiesOverride;
      var pref = window.__mlsVisitNotesPref;
      var choice = pref && typeof pref.read === "function" ? pref.read() : null;
      return !!(choice && choice.on === true && choice.state !== "unset");
    }, false);
    /* dayfacts-1.0.0: the tri-state matters again at this door. An explicit
       operation override is an admitted choice; otherwise only a SETTLED
       stored on/off is. First-use (unset/unsettled) stays fail-closed right
       here because _runHistoryBatch is also a compatibility/test seam that
       can be reached without the public admission gate - an unchosen account
       must never have charts opened on its behalf. */
    var batchChoiceAdmitted = safe(function () {
      if (typeof _pullBodiesOverride === "boolean") return true;
      var pref = window.__mlsVisitNotesPref;
      var choice = pref && typeof pref.read === "function" ? pref.read() : null;
      return !!(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"));
    }, false);
    var batchStartedAt = Date.now();
    var batchRequestId = "history-batch-" + batchStartedAt.toString(36) + "-" + Math.random().toString(36).slice(2, 9);
    /* A normal 18-patient day has ample time, while no single stuck renderer
       can make the batch immortal. This timestamp is frozen once and is never
       reset by progress, navigation, parsing, or retries. */
    var batchBudgetMs = Math.max(12 * 60 * 1000, Math.min(45 * 60 * 1000, Math.max(1, rows.length) * 3 * 60 * 1000)); /* si-1.9.2 speed: owner directive 2026-07-22 evening - a day pull must never run an hour */
    /* si-1.9.3 ADAPTIVE ceilings (live b491 lesson, same evening): fixed 75s
       ceilings collapsed completeness on a slow-athena night (10/16 failed;
       reads genuinely needed >75s) while fixed 195s ceilings had wasted 40
       min on failures at midday. Deadlines only bite on SLOW/failing reads -
       successful awaits resolve early - so the ceiling should track what
       reads actually cost RIGHT NOW: 2.5x the batch's median successful
       duration, clamped to a floor and cap. First reads use a neutral prior. */
    var readStats = { chart: [], visits: [], daynote: [] }; /* dnb-1.0.0 */
    function recordReadMs(kind, ms) { if (isFinite(ms) && ms > 0) { readStats[kind].push(ms); if (readStats[kind].length > 40) readStats[kind].shift(); } }
    function adaptiveCeilingMs(kind, floorMs, capMs, priorMs) {
      var a = readStats[kind];
      if (!a.length) return Math.max(floorMs, Math.min(capMs, priorMs));
      var s = a.slice().sort(function (x, y) { return x - y; });
      var median = s[Math.floor(s.length / 2)];
      return Math.max(floorMs, Math.min(capMs, Math.round(median * 2.5)));
    }
    var batchDeadlineAt = batchStartedAt + batchBudgetMs;
    if (sweepDeadlineCapAt > 0) batchDeadlineAt = Math.min(batchDeadlineAt, sweepDeadlineCapAt);
    var visitNotesRequested = pullVisitBodies === true;
    /* ===== dayfacts-1.0.0 (superseding owner DAY contract, 2026-08-25) =====
       The Full-visit-notes boolean now selects HOW MUCH history a bulk pull
       reads, never WHETHER charts open. Every exact scheduled row gets the
       mandatory work in BOTH modes: the identity-verified chart open + facts
       save, and exactly the pulled-day encounter-note attempt (the proven tn
       onlyDate lane below - its tail pass already selects visitsSkipped rows,
       which is precisely what OFF rows are). ON additionally traverses every
       other dated historical body. The old OFF early-return (a schedule-only
       no-op, "visit-notes-off") is deliberately gone; its schedule-only
       acceptance was revoked with the contract. chartFactsRequired is the
       always-true mandatory floor; allVisitBodiesRequested is the checkbox.
       Insurance/benefits are declared honestly as not-yet-attempted until the
       provenance-bound coverage adapter ships (separate reviewed commit) -
       a missing reader is never reported as verified-none. */
    var chartFactsRequired = true;
    var allVisitBodiesRequested = visitNotesRequested;
    var receipt = { requestId: batchRequestId, startedAt: batchStartedAt, deadlineAt: batchDeadlineAt, timedOut: false, requested: rows.length + unresolved.length, processed: 0, complete: false, exactIdentityVerified: false, presenceRequested: __historyRetryForeground === true, presenceAssisted: false, presenceFrontedReads: 0, presenceQuietReads: 0, visitNotesRequested: visitNotesRequested, visitNotesMode: visitNotesRequested ? "full" : "day-facts", chartFactsRequired: chartFactsRequired, allVisitBodiesRequested: allVisitBodiesRequested, insuranceAttempted: 0, insuranceComplete: false, benefitsComplete: false, insuranceReason: "reader-not-shipped", patients: [], retry: unresolved.map(function (item) { return frozenRetryEntry(item, null, item && item.reason); }), failures: unresolved.length };
    if (!batchChoiceAdmitted) {
      /* First-use fail-closed: no chart, body, or day-note read for an
         account that has never made the Full-visit-notes choice. The
         admission gates own asking; this seam refuses honestly. */
      receipt.requested = 0;
      receipt.processed = 0;
      receipt.complete = true;
      receipt.historyRequested = false;
      receipt.failures = 0;
      receipt.reason = "visit-notes-unchosen";
      receipt.visitNotesMode = "blocked-unchosen";
      receipt.notRequestedRows = rows.length + unresolved.length;
      receipt.todayNoteNotRequested = receipt.notRequestedRows;
      receipt.todayNoteRead = 0;
      receipt.todayNoteFailures = 0;
      receipt.todayNoteReasons = {};
      receipt.todayNoteReasonCodes = {};
      receipt.retry = [];
      return receipt;
    }
    if (historyBatchRunning) {
      rows.forEach(function (r) { receipt.retry.push(frozenRetryEntry(r, null, "history-batch-busy")); });
      /* p1-busy-click-1.0.0 (extended to the batch door, 2026-08-17): a
         refusal to START is not a pull's verdict. The managed wrapper already
         marks its stub; this door did not, so a surface reading the receipt
         could still paint "the pull did not return a verified completion
         receipt" over a healthy pull running in this tab or another one. */
      receipt.busyInFlight = true; receipt.gate = "history-batch-busy";
      receipt.failures = receipt.retry.length; receipt.reason = "history-batch-busy"; return receipt;
    }
    /* 2026-07-28 cross-tab refusal: a pull running in ANOTHER tab owns the
       shared shield - starting a second engine here is exactly how "N saves
       not confirmed" happened (two rosters, one store, per-tab guards). The
       refusal reuses the busy lane so every caller already handles it. */
    if (safe(function () { return window.__mlsPullShieldForeign && window.__mlsPullShieldForeign(); }, false)) {
      rows.forEach(function (r) { receipt.retry.push(frozenRetryEntry(r, null, "history-batch-busy-other-tab")); });
      receipt.busyInFlight = true; receipt.gate = "history-batch-busy-other-tab"; /* p1-busy-click-1.0.0 */
      receipt.failures = receipt.retry.length; receipt.reason = "history-batch-busy-other-tab"; return receipt;
    }
    safe(function () { if (window.__mlsPullShieldTick) window.__mlsPullShieldTick(); });
    /* 2026-07-28: the athena-doctor toaster needs to know a managed batch is
       running - its per-row bridge results (including the post-sweep todayNote
       reads) are not mlssi-tagged, so a transient row failure inside a batch
       that ultimately succeeds used to toast "That Athena pull didn't work". */
    try { window.__mlsSIBatchActive = true; } catch (eBA) {}
    historyBatchRunning = true;
    /* si-1.7.9 (LIVE 2026-07-18, owner's machine): the MANUAL history retry
       enters this batch WITHOUT pull()'s __mlsPullBusyAt stamping, so the
       pm-1.0.1 deferred dup-merge timer fired MID-RETRY and rewrote the
       patient store over the retry's fresh saves — the retry honestly
       reported 5 recovered, then storage verification found only 2 kept.
       The batch itself now keeps the busy stamp fresh (start + every
       patient + finalization) so EVERY entry path defers the merge; the
       stamp ages out 90s after the last touch (pull() still zeroes its own). */
    safe(function () { window.__mlsPullBusyAt = Date.now(); });
    var stopAfterTimeout = false;
    /* si-1.8.1 (live 2026-07-22, twice in 35 min): a Chrome extension-host
       restart kills the runner MID-REQUEST; the read dies at its absolute
       deadline while Athena itself is healthy. That is indistinguishable
       from a grinding chart UNLESS the runner is probed — so a deadline
       failure may recover ONCE per patient (max 2 per batch) when a fast
       ping proves the runner answers again. A probe failure, exhausted
       budget, or a second deadline keeps the honest stop-and-defer. */
    var transientRunnerRecoveries = 0;
    async function runnerAnsweredProbe() {
      try {
        var pongR = await bridge("mlsPong", "mlsPing", 3500);
        return !!(pongR && pongR.reason !== "bridge-deadline-exceeded");
      } catch (ePongProbe) { return false; }
    }
    /* si-1.7.4 SPEED (evidence-driven): the live b319 timing run measured the
       server parse+persist at 16.6s/patient vs 9.7s for the Athena chart
       open+read — 63% of wall clock spent while the Athena tab sits idle.
       saveOrganizedHistory touches ONLY the parse server and the local store
       (never the Athena bridge), so when the visits stage is skipped the
       batch now OVERLAPS patient N's parse with patient N+1's chart open.
       Identity semantics are unchanged: every gate inside the parse/persist
       chain still runs and still fail-closes; a failed pipelined parse gets
       ONE deferred full re-run (fresh chart open + verify + sequential
       parse) after the main sweep — same retry budget the inline path had.
       si-1.8.0: with full visit bodies ON, the parse now overlaps the SAME
       patient's visits read instead (the parse never needs the screen) and is
       awaited before saveVerifiedVisits, whose history-organization proof
       reads what the parse persisted. */
    var pipelineParses = [];
    /* dn-1.0 FOLD-IN state (owner 2026-08-11): shared by the inline day-note
       capture in the main loop and the tail pass below. todayNoteExtOk is the
       one-pong-per-batch scoped-read capability verdict (declared here instead
       of inside the tail pass; semantics identical). inlineDayNoteFuse is a
       ONE-WAY fuse: the first timeout-class inline failure stops every later
       INLINE attempt, because an abandoned mid-batch scoped read keeps driving
       the athena tab and wrestles the tab-of-record away from the next chart
       open (measured live 2026-07-28: 10 ok, then 11 straight tab-unreachable).
       Fused patients keep todayNote null and fall through to the tail pass,
       which is byte-for-byte the old post-batch behavior.

       ===== dnf2-1.0.0 (the fuse is a COOLDOWN, not a kill switch) ==========
       MEASURED 2026-08-17 20:45-20:58Z: because the fuse was ONE-WAY, the
       FIRST timeout sent every remaining row to the tail pass — and the tail
       pass opens each chart a SECOND time (feat_visits.run always re-verifies
       through _assistReadChart). That is the 2N-chart-opens the owner watched
       for 13 minutes on an occluded tab: "all charts read — saving the pulled
       day's note (7 of 23)" is the fuse's shadow, not a design.
       The fuse's stated cause is real and is kept: an abandoned scoped read
       may still be driving the tab. But the NEXT row's own chart read is proof
       that it is not — that read opened and verified the tab-of-record. So the
       fuse now clears on the first successful chart read after it trips, and
       the one-open inline lane resumes. Every fuse trip is counted. */
    var todayNoteExtOk = null;
    var safeAsync = async function (fn, fb) { try { return await fn(); } catch (eSa) { return fb; } };
    var inlineDayNoteFuse = "";
    function dnClearFuseOnVerifiedChart() {
      if (!inlineDayNoteFuse) return;
      inlineDayNoteFuse = "";
      safe(function () {
        receipt.todayNoteInlineFuse = "";
        receipt.todayNoteFuseCleared = Number(receipt.todayNoteFuseCleared || 0) + 1;
      });
    }
    /* ===== cap-1.0.0 (one place decides what a summary-pending row looks like) =====
       The AI half failed but the capture is STORED. The row is saved with a
       pending summary and a PHI-free code; it is NOT a failed history, it does
       not enter receipt.retry, and it never earns a fresh athena chart open
       (the tab has nothing to add - the backend AI is what is missing). */
    function capApplyPending(one, err) {
      var cap = err && err.mlsCapture;
      if (!cap || cap.saved !== true) return false;
      one.captureSaved = true;
      one.summaryPending = true;
      one.summaryCode = String(cap.code || "ai-unavailable").slice(0, 40);
      one.summaryRetryable = cap.retryable !== false;
      one.captureChars = Number(cap.chars || 0);
      one.chartReason = "";
      one.reason = "";
      receipt.summariesPending = Number(receipt.summariesPending || 0) + 1;
      safe(function () {
        receipt.summaryPendingCodes = receipt.summaryPendingCodes || {};
        receipt.summaryPendingCodes[one.summaryCode] = Number(receipt.summaryPendingCodes[one.summaryCode] || 0) + 1;
      });
      return true;
    }
    /* ===== dfc-1.0.0 (Codex red contract day-pull-clinical-floor): the
       MANDATORY per-row insurance/benefits lane. Every scheduled row in BOTH
       modes owes exactly one provenance-bound coverage read through the
       versioned reader seam `window._assistReadCoverage(target, say, opts)`.
       Semantics fixed by the owner contract + accepted Qwen invariants:
       - fill-only merge: a non-empty clinician-manual value is NEVER
         overwritten; remote fills blanks only; nothing is ever erased.
       - the raw remote values are stored separately on
         patient.athenaCoverageSnapshot so the merge never destroys the
         Athena-observed truth.
       - patient.athenaCoverageReceipt carries field NAMES and counts only —
         never a value string (no payer names, no member ids in receipts).
       - a missing reader is never verified-none: it stamps an incomplete
         not-attempted receipt (reason reader-not-shipped) and mutates
         nothing; a failed read stamps refused and mutates nothing. Neither
         erases valid schedule/same-day data (the lane is non-transactional
         by design).
       ===== */
    var DFC_FIELDS = ["payer", "planName", "memberId", "deductibleRemaining", "coinsurancePct", "copay", "oopRemaining"];
    function dfcRowAppointmentIds(row, target) {
      var ids = [];
      safe(function () {
        [row && row.appointmentIds, target && target.appointmentIds].forEach(function (bundle) {
          if (Array.isArray(bundle)) bundle.forEach(function (id) { if (id && ids.indexOf(String(id)) < 0) ids.push(String(id)); });
        });
      });
      var own = safe(function () { return String(rowAppointmentId(row) || (target && target.appointmentId) || ""); }, "");
      if (own && ids.indexOf(own) < 0) ids.push(own);
      return ids;
    }
    function dfcApplyCoverage(target, res, apptIds, requestId) {
      var p = findStorePatient(target.patientId);
      if (!p) return { receipt: { kind: "athena-coverage-v1", complete: false, status: "refused", reason: "store-row-missing" } };
      var values = (res && res.values) || {};
      var rr = (res && res.receipt) || {};
      var cur = (p.insurance && typeof p.insurance === "object") ? p.insurance : {};
      var next = {}, filled = [], preserved = [], present = 0, empty = 0;
      DFC_FIELDS.forEach(function (k) {
        var local = String(cur[k] == null ? "" : cur[k]).trim();
        var remote = String(values[k] == null ? "" : values[k]).trim();
        if (remote) { present++; } else { empty++; }
        if (local) { next[k] = local; if (remote && remote !== local) preserved.push(k); }
        else if (remote) { next[k] = remote; filled.push(k); }
        else { next[k] = ""; }
      });
      /* unknown pre-existing insurance keys survive untouched */
      safe(function () { for (var k in cur) { if (Object.prototype.hasOwnProperty.call(cur, k) && !(k in next)) next[k] = cur[k]; } });
      p.insurance = next;
      var snap = { capturedAt: Date.now() };
      DFC_FIELDS.forEach(function (k) { snap[k] = String(values[k] == null ? "" : values[k]); });
      p.athenaCoverageSnapshot = snap;
      p.athenaCoverageReceipt = {
        kind: "athena-coverage-v1",
        complete: rr.complete === true,
        status: String(rr.status || "saved"),
        requestId: String(rr.requestId || requestId || ""),
        sourceSurface: String(rr.sourceSurface || ""),
        capturedAt: Number(rr.capturedAt || Date.now()),
        appointmentIds: apptIds.slice(),
        fieldsPresent: Number(rr.fieldsPresent != null ? rr.fieldsPresent : present),
        fieldsEmpty: Number(rr.fieldsEmpty != null ? rr.fieldsEmpty : empty),
        filled: filled,
        manualOverridesPreserved: preserved
      };
      /* persist through the store's own writers; a refused persist leaves the
         lane incomplete without failing the row (capPersistRawCapture pattern) */
      var persisted = safe(function () {
        if (isFn(window.upsertPatient)) { var r = window.upsertPatient(p); return !(r === false || (r && r.ok === false)); }
        if (isFn(window.savePatients) && isFn(window.getPatients)) { window.savePatients(window.getPatients()); return true; }
        return true; /* harness/store keeps the live reference */
      }, false);
      var rowReceipt = Object.assign({ kind: "athena-coverage-v1" }, rr);
      rowReceipt.kind = "athena-coverage-v1";
      if (!persisted) { rowReceipt.complete = false; rowReceipt.status = "partial"; rowReceipt.reason = "coverage-persist-refused"; }
      return { receipt: rowReceipt };
    }
    async function dfcCoverageStage(target, row, one, requestId) {
      var fn = safe(function () { return window._assistReadCoverage; }, null);
      if (typeof fn !== "function") {
        one.coverageReceipt = { kind: "athena-coverage-v1", complete: false, status: "not-attempted", reason: "reader-not-shipped" };
        return false; /* no reader, no attempt - never counted as one */
      }
      var apptIds = dfcRowAppointmentIds(row, target);
      try {
        var res = await Promise.resolve(fn({
          patientId: String(target.patientId), name: target.name, dob: target.dob || "", mrn: target.mrn || "",
          appointmentIds: apptIds, appointmentId: apptIds[0] || "",
          scheduleDate: String(target.scheduleDate || batchRowDay(row) || "")
        }, function () {}, { requestId: requestId + "-cov" }));
        if (!res || res.ok === false) throw new Error(String((res && res.reason) || "coverage-read-refused"));
        one.coverageReceipt = dfcApplyCoverage(target, res, apptIds, requestId + "-cov").receipt;
      } catch (covErr) {
        one.coverageReceipt = { kind: "athena-coverage-v1", complete: false, status: "refused", reason: String(covErr && covErr.message || covErr || "coverage-read-failed").slice(0, 120) };
      }
      return true; /* a live reader was consulted - success or refusal, it was an attempt */
    }
    /* ===== end dfc-1.0.0 helpers ===== */
    /* the row's HISTORY verdict. A captured chart whose summary is pending is
       a saved row - the capture is on disk, counted by the store census, and
       the summary lands on its own retry lane. */
    function capRowComplete(one) {
      if (!one || one.identityVerified !== true) return false;
      if (one.captureSaved === true && one.summaryPending === true) return one.visitsComplete === true;
      return !!(one.dobVerified === true && one.organized && one.organizationComplete && one.visitsComplete);
    }
    /* ===== end cap-1.0.0 (row verdict) ===== */
    function launchPipelinedParse(entry, parseArgs) {
      entry.one.parsePipelined = true;
      var t0 = Date.now();
      entry.promise = saveOrganizedHistory(parseArgs.target, parseArgs.row, parseArgs.rd, parseArgs.readStartedAt, parseArgs.deadlineAt, parseArgs.requestId).then(function (organizedResult) {
        entry.stageMs.parseSave += Date.now() - t0;
        entry.one.chartCoverage = organizedResult.chartCoverage; entry.one.profileCoverage = organizedResult.profileCoverage; entry.one.clinicalFieldCount = organizedResult.clinicalFieldCount; entry.one.dobVerified = organizedResult.dobVerified === true;
        entry.one.organized = !!(entry.one.profileCoverage && entry.one.profileCoverage.complete === true);
        entry.one.chartReason = "";
        ppProvisionalSaved(entry.one); /* dv3-1.0.0 */
      }, function (parseErr) {
        entry.stageMs.parseSave += Date.now() - t0;
        if (capApplyPending(entry.one, parseErr)) { ppProvisionalSaved(entry.one); return; } /* cap-1.0.0 */
        entry.one.chartReason = String(parseErr && parseErr.message || parseErr || "chart-parse-failed").slice(0, 200);
        if (parseErr && parseErr.mlsEchoes) entry.one.chartEchoes = parseErr.mlsEchoes;
        if (parseErr && parseErr.mlsFind) entry.one.findDiag = parseErr.mlsFind; /* fdx-1.0.0 */
      });
      pipelineParses.push(entry);
    }
    /* ===== dv3-1.0.0 (a saved chart says SAVED while the pull is still running) =====
       MEASURED live 2026-08-17, 23 rows, notes OFF, 21 minutes in: "13 done,
       0 saved, 8 not saved, 5 re-checking" on a pull whose charts WERE landing.
       Two causes, both here. (1) The day-note leg pushed its own ok:false settle
       AFTER the row's, and latest-state-wins made an unread note the row's
       verdict - that is the 8. (2) A PIPELINED row settled "finishing…" and was
       only resolved at end-of-batch finalization, so a chart proven saved 20
       minutes ago still read as in-flight - that is the 5, and it is why ok was
       0. A pipelined parse RESOLVES per row, so the row can say saved the
       moment its own save is proven. Only the UPGRADE is provisional here: a
       row that has not proven its save stays pending exactly as before, and
       finalization still owns receipt.retry and receipt.complete. */
    function ppProvisionalSaved(one) {
      if (!one || !one.__ppRow) return;
      var savedNow = one.organized === true || (one.captureSaved === true && one.summaryPending === true);
      if (!savedNow) return;
      safe(function () {
        ppResolve(one.__ppRow, true, one.summaryPending === true ? "saved · summary pending" : "", { sp: one.summaryPending === true, chartSaved: true, dn: tnColumn(one) });
      });
    }
    /* ===== end dv3-1.0.0 ===== */
    async function collectOverlapParse(overlap, one, stageMs, patientDeadlineAt) {
      /* Settle the overlapped parse; on a non-timeout failure give it ONE
         bounded sequential re-run (same rd - the chart was verified when it
         was read), then apply exactly what the inline path applied. */
      if (!overlap) return;
      var outcome = await overlap.settled;
      stageMs.parseSave += Date.now() - overlap.t0;
      /* cap-1.0.0: a summary-pending outcome never buys a fresh chart open.
         The capture is already saved and re-reading the same chart cannot
         revive a backend AI that is down - it only costs an athena read. */
      if (!outcome.ok && outcome.e && outcome.e.mlsCapture && outcome.e.mlsCapture.saved === true) {
        capApplyPending(one, outcome.e);
        return;
      }
      if (!outcome.ok && !/timeout|deadline/i.test(String(outcome.e && outcome.e.message || "")) && Date.now() + 300000 < batchDeadlineAt) {
        /* si-1.7.2 semantics preserved: the single bounded retry is a FULL
           fresh open+verify+parse (never a bare re-parse of a possibly stale
           read) - exactly what the inline path did, deferred post-visits. */
        one.chartRetried = true;
        var __rpChartT0 = Date.now(), __rpParseT0 = 0;
        try {
          var reChartDeadlineAt = Math.min(batchDeadlineAt, Date.now() + 110000);
          var reReadStartedAt = Date.now();
          var rdRetry = await boundedUntil(dnReadChart(overlap.args.target, function () {}, { requestId: overlap.args.requestId + "-r2chart", deadlineAt: reChartDeadlineAt, athenaOwnerToken: siAthenaOwnerToken }), reChartDeadlineAt, "chart-read-deadline-exceeded");
          stageMs.chart += Date.now() - __rpChartT0;
          __rpParseT0 = Date.now();
          var reParseDeadlineAt = Math.min(batchDeadlineAt, Date.now() + 120000);
          outcome = { ok: true, r: await saveOrganizedHistory(overlap.args.target, overlap.args.row, rdRetry, reReadStartedAt, reParseDeadlineAt, overlap.args.requestId + "-r2") };
          stageMs.parseSave += Date.now() - __rpParseT0;
        } catch (reParseErr) {
          if (__rpParseT0) { stageMs.parseSave += Date.now() - __rpParseT0; } else { stageMs.chart += Date.now() - __rpChartT0; }
          outcome = { ok: false, e: reParseErr };
        }
      }
      if (outcome.ok) {
        var organizedResult = outcome.r;
        one.chartCoverage = organizedResult.chartCoverage; one.profileCoverage = organizedResult.profileCoverage; one.clinicalFieldCount = organizedResult.clinicalFieldCount; one.dobVerified = organizedResult.dobVerified === true;
        one.organized = !!(one.profileCoverage && one.profileCoverage.complete === true);
        one.chartReason = "";
      } else {
        if (capApplyPending(one, outcome.e)) return; /* cap-1.0.0 */
        one.chartReason = String(outcome.e && outcome.e.message || outcome.e || "chart-parse-failed").slice(0, 200);
        if (outcome.e && outcome.e.mlsEchoes) one.chartEchoes = outcome.e.mlsEchoes;
        if (outcome.e && outcome.e.mlsFind) one.findDiag = outcome.e.mlsFind; /* fdx-1.0.0 */
        if (/timeout|deadline/i.test(one.chartReason)) { stopAfterTimeout = true; receipt.timedOut = true; }
        else if (/athena-session-expired/.test(one.chartReason)) { stopAfterTimeout = true; receipt.sessionExpired = true; } /* sx-1.1 */
      }
    }
    /* b752: THE BEFORE HALF OF THE MEASUREMENT, taken before the first chart is
       opened. A census taken only after the walk cannot tell a record THIS pull
       filled from one an earlier pull filled, so on the second zero-write pull of
       the same day the gap would close and the verdict would be back to claiming
       coverage it never captured. Pure read, no write, same resolver. */
    receipt.storeCensusBefore = storedContentCensus(rows, unresolved);
    ppStart((sweepProgressTotal > rows.length ? sweepProgressTotal : rows.length), sweepProgressBase);
    safe(function () { var scopeState = ppState(); if (scopeState) scopeState.visitNotesRequested = pullVisitBodies === true; });
    try {
      for (var i = 0; i < rows.length; i++) {
        safe(function () { window.__mlsPullBusyAt = Date.now(); }); /* si-1.7.9: keep the merge deferred for the whole batch */
        /* stp-1.0.0 (owner 2026-08-08: "there should be a stop pull button"):
           a COOPERATIVE abort between charts - the in-flight chart is never
           torn mid-write, every receipt collected so far persists through the
           normal return path, the remaining rows are marked and retryable,
           and the engine lease releases normally. This replaces the tab-reload
           kill that twice cost a run's receipts. */
        if (window.__mlsPullStopRequested === true) {
          receipt.stoppedByUser = true; stopAfterTimeout = true;
          for (var sbi = i; sbi < rows.length; sbi++) receipt.retry.push(frozenRetryEntry(rows[sbi], null, "stopped-by-user"));
          safe(function () { onStatus("Stopped by you after " + i + " of " + rows.length + " charts - everything read so far is saved; the rest stays in Retry.", "warn"); });
          break;
        }
        if (Date.now() >= batchDeadlineAt) {
          receipt.timedOut = true; stopAfterTimeout = true;
          for (var bi = i; bi < rows.length; bi++) receipt.retry.push(frozenRetryEntry(rows[bi], null, "deferred-after-batch-deadline"));
          break;
        }
        var row = rows[i] || {}, target = exactHistoryTarget(row), carryProof = null, one = { patientId: String(row._mlsTargetPatientId || row.patient_external_id || ""), name: String(row.name || ""), identityVerified: false, organized: false, organizationComplete: false, visitsComplete: false, complete: false };
        if (!target) {
          one.reason = "identity-target-unresolved"; ppSettle(row.name, false, one.reason, false, { pid: one.patientId }); receipt.patients.push(one); receipt.retry.push(frozenRetryEntry(row, null, one.reason)); receipt.processed++; continue;
        }
        one.patientId = String(target.patientId || one.patientId);
        one.identityVerified = true;
        one.identityProof = target.mrn ? "mrn" : (target.dob ? "dob" : "");
        /* rsk-1.0.0: a row this same account day already proved and STORED is
           complete without a second Athena read. Recorded as skipped so no
           surface can mistake it for a fresh read. */
        var rskProof = rskAlreadyVerifiedToday(batchRowDay(row), target, pullVisitBodies === true ? "full" : "day-facts");
        if (rskProof && rskProof.rejectedReason) {
          /* cachev-1.0.0 (Codex red contract pull-cache-proof-version): a
             proof that EXISTS but predates the mandatory coverage/same-day/
             all-history floor is rejected at the schema boundary and the row
             reads FRESH. The rejection receipt is closed-vocabulary and
             PHI-free - a reason code and a version number, nothing else. */
          one.cacheProof = { accepted: false, reason: String(rskProof.rejectedReason), proofVersion: Number(rskProof.proofVersion || 1) };
          rskProof = null;
        } else if (rskProof) {
          one.cacheProof = { accepted: true, reason: "versioned-lanes-proven" };
        }
        if (rskProof) {
          one.dobVerified = true; one.organized = true; one.organizationComplete = true;
          one.visitsComplete = true; one.visitsSkipped = pullVisitBodies !== true;
          one.complete = true;
          /* dfc-1.0.0: a versioned-lanes skip was ADMITTED only because the
             cachev validator proved coverage/same-day/all-history complete on
             this same account day — the receipts here carry that proof
             forward, they never invent a fresh read. */
          one.coverageReceipt = { kind: "athena-coverage-v1", complete: true, status: "saved", carriedFromProof: true };
          one.allHistoryReceipt = pullVisitBodies === true
            ? { kind: "athena-all-history-v1", requested: true, status: "saved", complete: true, carriedFromProof: true }
            : { kind: "athena-all-history-v1", requested: false, status: "not-requested" };
          /* onheal-1.0.0: carry the same-day lane the validator ACCEPTED, so a
             skip cannot decay the proof it was granted on. */
          if (/^(saved|absent|not-yet-available)$/.test(String(rskProof.sameDayNoteStatus || ""))) {
            one.sameDayProof = { status: String(rskProof.sameDayNoteStatus), day: String(rskProof.day || ""), from: "carried-proof", carriedFromProof: true };
          }
          one.chartSkippedVerifiedToday = rskProof.at;
          one.stageMs = { chartMs: 0, parseSaveMs: 0, visitsMs: 0, visitSaveMs: 0, totalMs: 0 };
          receipt.chartsSkippedVerifiedToday = Number(receipt.chartsSkippedVerifiedToday || 0) + 1;
          one.__ppRow = ppSettle(row.name, true, "", false, { pid: one.patientId, chartSaved: true });
          receipt.patients.push(one); receipt.processed++;
          continue;
        }
        var patientRequestId = batchRequestId + "-p" + (i + 1);
        /* si-1.9.1: sweep attempts get a tighter window — one glacial chart
           must not eat the whole remaining sweep budget. */
        var patientDeadlineAt = Math.min(batchDeadlineAt, Date.now() + (sweepDepth ? 5 : 6) * 60 * 1000);
        var patientReadStartedAt = Date.now();
        one.requestId = patientRequestId; one.deadlineAt = patientDeadlineAt;
        if (onStatus) onStatus("Reading verified history " + (sweepProgressBase + i + 1) + " of " + (sweepProgressTotal > rows.length ? sweepProgressTotal : rows.length) + (sweepDepth ? " (automatic re-check)" : "") + "...", "");
        ppCurrent(row.name || (target && target.name) || "");
        /* ppt-2.0: a chart entering a re-check pass reads as calm "re-checking",
           never as a final warning - IN-PROGRESS is not FAILED (owner, 2026-07-29,
           and again 2026-08-09 watching five orange rows mid-cycle). */
        if (sweepDepth) ppSettle(row.name, false, "re-checking…", true, { pid: one.patientId });
        /* An explicit pull always performs a fresh chart read. A legacy
           "Pulled from Athena" marker is not a coverage receipt and may be
           stale or partial, so it can never short-circuit this batch. */
        one.organized = false;
        /* Live 2026-07-16 (si-1.7.2): a stale Athena tab can make the whole
           chart OPEN land on the previous patient (wrong-chart / DOB-MRN proof
           failures). One bounded in-batch retry re-runs the full open+verify;
           every identity gate runs again from scratch. Timeouts never retry
           (they stop the batch), and the retry window is budgeted against the
           BATCH deadline so a second attempt genuinely fits. */
        /* si-1.7.3 SPEED EVIDENCE: PHI-free per-stage wall-clock stamps on
           every patient receipt (numbers only — no names, no chart text).
           chart = extension open+read (incl. bounded retries), parseSave =
           organize+persist of the six-card chart, visits = full encounter-
           body stage incl. retries/reopen, visitSave = synchronous visit
           persist. One graded run now shows exactly where the seconds go
           BEFORE any sleep is converted to a readiness poll. */
        var stageMs = { chart: 0, parseSave: 0, visits: 0, visitSave: 0 };
        var rd = null, chartAttempt = 0, overlapParse = null;
        /* cross-tab pull shield heartbeat: every patient renews the shared
           45s claim so no other tab's bulk write may remove rows mid-pull */
        safe(function () { if (window.__mlsPullShieldTick) window.__mlsPullShieldTick(); });
        while (true) {
          chartAttempt++;
          var __chartT0 = Date.now(), __parseT0 = 0;
          try {
            var chartReadStartedAt = chartAttempt > 1 ? Date.now() : patientReadStartedAt;
            var chartRequestId = patientRequestId + "-chart" + (chartAttempt > 1 ? "-a" + chartAttempt : "");
            var chartDeadlineAt = Math.min(patientDeadlineAt, Date.now() + ((chartAttempt === 1 && !sweepDepth) ? adaptiveCeilingMs('chart', 45000, 180000, 90000) : 180000));
            rd = await boundedUntil(dnReadChart(target, function () {}, { requestId: chartRequestId, deadlineAt: chartDeadlineAt, athenaOwnerToken: siAthenaOwnerToken }), chartDeadlineAt, "chart-read-deadline-exceeded");
            stageMs.chart += Date.now() - __chartT0;
            recordReadMs('chart', Date.now() - __chartT0);
            /* dnf2-1.0.0: this read just opened and VERIFIED the tab-of-record,
               which is exactly the proof the day-note fuse was waiting for. */
            dnClearFuseOnVerifiedChart();
            var parseDeadlineAt = Math.min(patientDeadlineAt, Date.now() + 120000);
            var parseRequestId = patientRequestId + "-parse" + (chartAttempt > 1 ? "-a" + chartAttempt : "");
            if (!stopAfterTimeout && pullVisitBodies !== true) {
              /* si-1.7.4: visits are skipped, so nothing after this point needs
                 THIS patient's chart on screen. Launch the parse+persist chain
                 (server + local store only) and move straight to the next
                 patient's chart open. Failures settle onto this receipt entry
                 and get one deferred full re-run after the sweep. */
              launchPipelinedParse({ one: one, row: row, target: target, stageMs: stageMs, startedAt: patientReadStartedAt },
                { target: target, row: row, rd: rd, readStartedAt: chartReadStartedAt, deadlineAt: parseDeadlineAt, requestId: parseRequestId });
              break;
            }
            /* si-1.8.0: launch the parse+persist chain now and let it run
               while the visits stage below reads THIS chart. It is awaited in
               collectOverlapParse before saveVerifiedVisits. */
            overlapParse = { t0: Date.now(), args: { target: target, row: row, rd: rd, readStartedAt: chartReadStartedAt, deadlineAt: parseDeadlineAt, requestId: parseRequestId } };
            overlapParse.settled = saveOrganizedHistory(target, row, rd, chartReadStartedAt, parseDeadlineAt, parseRequestId)
              .then(function (r) { return { ok: true, r: r }; }, function (e) { return { ok: false, e: e }; });
            break;
          } catch (chartErr) {
            if (__parseT0) { stageMs.parseSave += Date.now() - __parseT0; } else { stageMs.chart += Date.now() - __chartT0; }
            one.chartReason = String(chartErr && chartErr.message || chartErr || "chart-read-failed").slice(0, 200);
            if (chartErr && chartErr.mlsEchoes) one.chartEchoes = chartErr.mlsEchoes;
            /* fdx-1.0.0: keep the extension's own PHI-free open verdict, so a
               chart that never opened can be told apart from one athena has
               no record of. Codes/counts only - never a name or a DOB. */
            if (chartErr && chartErr.mlsFind) one.findDiag = chartErr.mlsFind;
            if (/timeout|deadline/i.test(one.chartReason)) {
              /* si-1.8.1: only a proven-alive runner earns a fresh attempt. */
              if (chartAttempt < 2 && transientRunnerRecoveries < 2 && Date.now() + 300000 < batchDeadlineAt && (await runnerAnsweredProbe())) {
                transientRunnerRecoveries++;
                one.chartTransientRecovered = true;
                one.chartRetried = true;
                patientDeadlineAt = Math.min(batchDeadlineAt, Date.now() + (sweepDepth ? 4 : 6) * 60 * 1000);
                one.deadlineAt = patientDeadlineAt;
                await new Promise(function (rWait) { var c = safe(function () { return absoluteDeadlines.arm(Date.now() + 1800, rWait); }, null); if (!c) rWait(); });
                continue;
              }
              stopAfterTimeout = true; receipt.timedOut = true; break;
            }
            /* Preserve the 3.0.77 pull timing: the bounded second open/read
               below remains the only in-row chart retry. */
            if (chartAttempt < 2 && Date.now() + 300000 < batchDeadlineAt) {
              patientDeadlineAt = Math.min(batchDeadlineAt, Date.now() + (sweepDepth ? 4 : 6) * 60 * 1000);
              one.deadlineAt = patientDeadlineAt;
              one.chartRetried = true;
              await new Promise(function (rWait) { var c = safe(function () { return absoluteDeadlines.arm(Date.now() + 1800, rWait); }, null); if (!c) rWait(); });
              continue;
            }
            break;
          }
        }
        /* dfc-1.0.0: the mandatory coverage lane runs once per row in BOTH
           modes, right after the verified chart open. Its failure classes
           land on the lane receipt only — never on the chart/visits verdicts. */
        if (!stopAfterTimeout && rd) {
          var __covT0 = Date.now();
          var covAttempted = await dfcCoverageStage(target, row, one, patientRequestId);
          one.coverageMs = Date.now() - __covT0;
          if (covAttempted === true) receipt.insuranceAttempted = Number(receipt.insuranceAttempted || 0) + 1;
        } else if (!one.coverageReceipt) {
          one.coverageReceipt = { kind: "athena-coverage-v1", complete: false, status: "not-attempted", reason: stopAfterTimeout ? "batch-stopped" : "chart-unread" };
        }
        /* Skipping visits is recorded honestly on the receipt — a skipped
           stage is never reported as verified encounter bodies. A pipelined
           entry's organizationComplete lands at finalization, after its
           parse settles. */
        if (!stopAfterTimeout && pullVisitBodies !== true) {
          one.visitsComplete = true;
          one.visitsSkipped = true;
          if (one.parsePipelined !== true) one.organizationComplete = one.organized;
          /* dfc-1.0.0: day-facts mode declares the historical walk honestly
             NOT REQUESTED — a typed receipt, never an implied absence. */
          one.allHistoryReceipt = { kind: "athena-all-history-v1", requested: false, status: "not-requested" };
          /* dfc-1.1.0: the MANDATORY exact-day encounter read now rides the
             same AllVisits bridge lane as the full walk, scoped by onlyDate
             and carrying the account-local todayKey. The site vp transport
             reduced the reader's answer to {ok, visits:n}, which can prove
             nothing about scope, bindings, or absence - the bridge receipt
             carries the full scoped census. ONE bounded read per row; every
             failure falls back to the legacy vp/defer/idle ladder below
             (todayNote stays unset so those lanes still try), so a reader
             that cannot answer this verb costs nothing. */
          var sdDay = String(batchRowDay(row) || "").slice(0, 10);
          if (rd && /^\d{4}-\d{2}-\d{2}$/.test(sdDay) && !dayNoteFuture(sdDay) && !dnAlreadyReadToday(sdDay, target.patientId)) {
            var __sdT0 = Date.now();
            try {
              var sdDeadlineAt = Math.min(patientDeadlineAt, Date.now() + adaptiveCeilingMs('visits', 60000, 195000, 100000));
              var sdVr = await boundedUntil(bridge("mlsAppAllVisitsResult", "mlsAppReadAllVisits", 190000, {
                requestId: patientRequestId + "-sdvisits", deadlineAt: sdDeadlineAt, managed: true, background: true, silent: true,
                initiator: "schedule-batch-same-day",
                hint: { patient: target.name, name: target.name, dob: target.dob || "", athenaId: target.mrn || target.athenaId || "",
                  mrn: target.mrn || "", patientId: String(target.patientId), onlyDate: sdDay, todayKey: acctTodayKey() }
              }), sdDeadlineAt, "same-day-read-deadline-exceeded");
              if (!(sdVr && sdVr.ok)) throw new Error(String((sdVr && (sdVr.reason || sdVr.error)) || "same-day-read-failed"));
              /* a reader that predates onlyDate scoping answers with EVERY
                 body and no scoped receipt - never day proof; fail closed to
                 the legacy ladder instead of mis-crediting an unscoped read */
              if (String((sdVr.receipt && sdVr.receipt.onlyDate) || "") !== sdDay) throw new Error("scoped-read-unsupported-by-reader");
              var sdSaved = saveVerifiedVisits(target, sdVr);
              stageMs.visits += Date.now() - __sdT0;
              one.visitCount = sdSaved.visitCount; one.persistedVisits = sdSaved.persistedVisits; one.parsedVisits = sdSaved.parsedVisits;
              if (sdSaved.sameDay) one.sameDayReceipt = Object.assign({ kind: "athena-same-day-note-v1" }, sdSaved.sameDay);
              one.todayNote = true; one.todayNoteReadAt = Date.now(); one.todayNoteMs = Date.now() - __sdT0;
              one.todayNoteDirectBridge = true; /* PHI-free provenance: which transport read it */
            } catch (sdErr) {
              stageMs.visits += Date.now() - __sdT0;
              one.sameDayDirectReason = String(sdErr && sdErr.message || sdErr || "same-day-read-failed").slice(0, 120);
            }
          }
        } else if (!stopAfterTimeout && (carryProof = visitsProofCarry(target.patientId))) {
          /* si-2.0.0: the fresh chart read just refreshed this patient's index
             and it matches the stamped verified-bodies pass — nothing new to
             read. Recorded honestly; the bodies remain identity-bound proof
             from a completed pass, re-attested against TODAY's index. The
             overlapped chart parse still lands on the receipt first — a carry
             must never mask a failed six-card save. */
          if (overlapParse) { try { await collectOverlapParse(overlapParse, one, stageMs, patientDeadlineAt); } catch (eCarryParse) {} overlapParse = null; }
          one.visitsComplete = true;
          one.visitsVerifiedCarry = true;
          receipt.bodiesCarried = (receipt.bodiesCarried || 0) + 1;
          one.organizationComplete = carryProof.organizationOk === true;
          one.visitsCoverageComplete = true;
          one.expectedVisits = Number(carryProof.expectedVisits || 0);
          one.parsedVisits = Number(carryProof.parsedVisits || 0);
          one.visitCount = Number(carryProof.visitCount || 0);
          one.persistedVisits = Number(carryProof.persistedVisits || 0);
          one.visitsReaderVersion = String(carryProof.readerVersion || "");
          one.authoritativeEmpty = carryProof.authoritativeEmpty === true;
          /* the ON lane's six-card freshness verdicts still apply under carry:
             carried bodies never mask a stale or unproven CURRENT chart. */
          (function () {
            var cov = safe(function () { var p = findStorePatient(target.patientId); return p && p.athenaProfileCoverage; }, null);
            if (!(cov && cov.complete === true && cov.exactIdentityVerified === true)) return;
            var capRaw = cov.capturedAt, capAt = Number(capRaw || 0);
            if (!isFinite(capAt) || capAt <= 0) capAt = Date.parse(String(capRaw || "")) || 0;
            var freshNow = capAt >= patientReadStartedAt && capAt <= Date.now() + 5000;
            one.profileCoverageFresh = freshNow;
            if (freshNow && one.organized) {
              one.profileCoverage = cov;
              one.clinicalFieldCount = safe(function () {
                var rc = isFn(window._patientHistoryCardCoverage) ? window._patientHistoryCardCoverage(target.patientId) : null;
                return ["problems", "meds", "allergies", "vitals", "history"].reduce(function (n, k) { return n + (rc && rc.cards && rc.cards[k] && rc.cards[k].populated ? 1 : 0); }, 0);
              }, Number(one.clinicalFieldCount || 0));
            } else if (!one.organized) {
              one.visitsReason = one.visitsReason || (freshNow ? "six-card-current-chart-unproven" : "six-card-profile-freshness-unproven");
            }
          })();
        } else if (!stopAfterTimeout && rd) {
          /* A failed chart open has no verified current-patient surface. Never
             ask the extension for visit bodies against whatever Athena may
             still be showing from the previous row. */
          var __visitsT0 = Date.now();
          try {
            /* Live 2026-07-16: after the chart read, the visits pane very
               occasionally still shows the PREVIOUS patient's encounter list
               (same-frame-name-mismatch — the identity gate refuses, which is
               correct). One bounded re-read re-opens the exact chart and
               re-verifies; every identity gate runs again in full. */
            var vr = null, visitsAttempt = 0;
            while (true) {
              visitsAttempt++;
              var __vAttemptT0 = Date.now();
              var visitsRequestId = patientRequestId + "-visits" + (visitsAttempt > 1 ? "-a" + visitsAttempt : "");
              /* si-1.9.1 fail-fast: quiet charts complete their visits read in
                 well under 2 minutes; a chart that cannot inside 110s is in an
                 edit burst and belongs to the end-of-batch sweep (where the
                 full 195s window applies). Grinding 195s per failure in the
                 MAIN pass starved the sweep of budget (live 15:11: 10 failures
                 burned ~40 min; only one sweep pass fit). */
              var __fgFullWindow = __historyRetryForeground === true && (typeof __mlsDoctorMidVisit === "function" ? __mlsDoctorMidVisit() !== true : true); /* pace-1.0 */ var visitsDeadlineAt = Math.min(patientDeadlineAt, Date.now() + (visitsAttempt === 1 && !sweepDepth && __fgFullWindow !== true ? adaptiveCeilingMs('visits', 60000, 195000, 100000) : 195000));
              try {
                vr = await boundedUntil(bridge("mlsAppAllVisitsResult", "mlsAppReadAllVisits", 190000, { requestId: visitsRequestId, deadlineAt: visitsDeadlineAt, managed: true, background: true, silent: true, initiator: "schedule-batch", foregroundOk: __historyRetryForeground === true && (typeof __mlsDoctorMidVisit === "function" ? __mlsDoctorMidVisit() !== true : true), foregroundBatchStart: (__historyRetryForeground === true && __presenceBatchAnnounced !== true) ? (__presenceBatchAnnounced = true) : false, hint: { patient: target.name, name: target.name, dob: target.dob || "", athenaId: target.mrn || target.athenaId || "" } }), visitsDeadlineAt, "visits-read-deadline-exceeded");
                if (vr && vr.fronted === true) { receipt.presenceAssisted = true; receipt.presenceFrontedReads = (receipt.presenceFrontedReads | 0) + 1; } else if (__historyRetryForeground === true) { receipt.presenceQuietReads = (receipt.presenceQuietReads | 0) + 1; } /* fg-1.3: per-read truth (was fg-1.2 batch-global) */
              } catch (vDeadlineErr) {
                var vdMsg = String(vDeadlineErr && vDeadlineErr.message || vDeadlineErr || "");
                /* si-1.8.1: same transient-runner-death recovery as the chart
                   open — only a proven-alive runner earns ONE fresh, fully
                   re-verified attempt; anything else keeps the honest throw. */
                if (!(/timeout|deadline/i.test(vdMsg) && visitsAttempt < 2 && transientRunnerRecoveries < 2 && Date.now() + 300000 < batchDeadlineAt && (await runnerAnsweredProbe()))) throw vDeadlineErr;
                transientRunnerRecoveries++;
                one.visitsTransientRecovered = true;
                one.visitsChartReopened = true;
                patientDeadlineAt = Math.min(batchDeadlineAt, Date.now() + (sweepDepth ? 4 : 6) * 60 * 1000);
                one.deadlineAt = patientDeadlineAt;
                try {
                  var trReopenDeadlineAt = Math.min(patientDeadlineAt, Date.now() + 100000);
                  await boundedUntil(dnReadChart(target, function () {}, { requestId: patientRequestId + "-trreopen" + visitsAttempt, deadlineAt: trReopenDeadlineAt, athenaOwnerToken: siAthenaOwnerToken }), trReopenDeadlineAt, "chart-reopen-deadline-exceeded");
                } catch (trReopenErr) {}
                await new Promise(function (rWait) { var c = safe(function () { return absoluteDeadlines.arm(Date.now() + 1800, rWait); }, null); if (!c) rWait(); });
                continue;
              }
              /* mdx-1.1.0: a fast EMPTY chart must not set the pace for deep
                 charts. recordReadMs feeds adaptiveCeilingMs (median x 2.5,
                 floor 60s); one authoritative-empty read in ~15s collapsed the
                 ceiling so later deep charts got a ~24s index phase - the
                 "first two fine, next five fail" shape from the 2026-08-05
                 field ledger. Only non-empty reads teach the pace. */
              if (vr && vr.ok) { if (!(vr.receipt && (vr.receipt.authoritativeEmpty === true || Number(vr.receipt.expected || 0) === 0))) recordReadMs('visits', Date.now() - __vAttemptT0); break; }
              var vErrText = String((vr && (vr.reason || vr.error)) || "visits-read-failed");
              if (vr && vr.reason === "athena-tab-sleeping") {
                one.athenaTabId = Number(vr.athenaTabId || vr.readTabId || (vr.receipt && vr.receipt.sleepingTabId) || 0) || null;
                one.readTabId = one.athenaTabId;
                one.visitsReason = "athena-tab-sleeping";
              }
              /* mdx-1.1.0 (field ledger 2026-08-05, second clinician's Mac):
                 the refusal's own evidence crossed the bridge and died on this
                 line for three straight field reports - failedIndexes (the
                 per-row reason histogram behind visit-bodies-incomplete),
                 enumDiag (the per-frame record behind
                 encounter-index-incomplete), and the read receipt. Capture
                 them PHI-free onto the per-patient record so the day ledger,
                 the panel row, and the emailed error report can name the
                 sub-cause. ecSeen/frames are NEVER copied - they carry a
                 patient-name field. */
              try {
                if (vr && typeof vr === "object") {
                  if (Array.isArray(vr.failedIndexes) && vr.failedIndexes.length) {
                    var fiHist = {};
                    for (var fiI = 0; fiI < vr.failedIndexes.length && fiI < 40; fiI++) {
                      var fiR = String(vr.failedIndexes[fiI] && vr.failedIndexes[fiI].reason || "unknown").slice(0, 48);
                      fiHist[fiR] = (fiHist[fiR] || 0) + 1;
                    }
                    one.visitsFailedHistogram = fiHist;
                  }
                  if (vr.receipt && typeof vr.receipt === "object") {
                    one.visitsReadReceipt = {
                      expected: Number(vr.receipt.expected || 0), parsed: Number(vr.receipt.parsed || 0),
                      attempted: Number(vr.receipt.attempted || 0), elapsedMs: Number(vr.receipt.elapsedMs || 0),
                      timeBudgetMs: Number(vr.receipt.timeBudgetMs || 0), retryCount: Number(vr.receipt.retryCount || 0),
                      minimalBodies: Number(vr.receipt.minimalBodies || 0),
                      axRrWaitMs: Number(vr.receipt.axRrWaitMs || 0), axRrRecovered: vr.receipt.axRrRecovered === true,
                      fatigueRefresh: vr.receipt.fatigueRefresh === true, hydStreak: Number(vr.receipt.hydStreak || 0)
                    };
                    /* axd-1.0 (2026-08-09): the extension now emits the per-row
                       failure records themselves (noRowDiag's liTotal/eidHit -
                       list-vanished vs row-left vs group-resolution-failed),
                       and this boundary was dropping them, leaving only the
                       reason histogram. In-app record only: NOT copied into
                       frozenRetryEntry's diag, which feeds the emailed report. */
                    if (Array.isArray(vr.receipt.failureDetails) && vr.receipt.failureDetails.length) one.visitsFailureDetails = vr.receipt.failureDetails.slice(0, 12);
                  }
                  if (vr.enumDiag && typeof vr.enumDiag === "object") {
                    one.visitsEnumDiag = {
                      answered: Array.isArray(vr.enumDiag.answered) ? vr.enumDiag.answered.slice(0, 8).map(function (aStr) { return String(aStr).slice(0, 90); }) : [],
                      noiseDropped: Number(vr.enumDiag.noiseDropped || 0),
                      passes: Number(vr.enumDiag.passes || 0),
                      identicalPasses: Number(vr.enumDiag.identicalPasses || 0),
                      gaveUpEarly: vr.enumDiag.gaveUpEarly === true
                    };
                  }
                }
              } catch (eDiagCap) {}
              /* sx-1.1: a probed-dead session must not burn the chart-reopen
                 retry or grind the rest of the batch — halt honestly now.
                 (Diagnostics above are captured first; they are PHI-free.) */
              if (vr && vr.sessionLikelyExpired === true) throw new Error("athena-session-expired");
              if (visitsAttempt < 2 && /same-frame-name-mismatch|same-frame-name-missing|no-athena-tab/.test(vErrText) && Date.now() + 300000 < batchDeadlineAt) {
                /* Live 2026-07-16 (si-1.7.2): a bare visits re-read is NOT
                   enough when the whole tab kept the previous patient (run 2
                   p1: both attempts read the same stale 38-row list). Re-run
                   the exact chart OPEN+VERIFY first so the re-read starts from
                   a proven fresh chart; the per-patient window is re-budgeted
                   against the batch deadline so the second attempt fits.
                   Every identity gate runs again in full. */
                patientDeadlineAt = Math.min(batchDeadlineAt, Date.now() + (sweepDepth ? 4 : 6) * 60 * 1000);
                one.deadlineAt = patientDeadlineAt;
                one.visitsChartReopened = true;
                try {
                  var reopenDeadlineAt = Math.min(patientDeadlineAt, Date.now() + 80000);
                  await boundedUntil(dnReadChart(target, function () {}, { requestId: patientRequestId + "-reopen" + visitsAttempt, deadlineAt: reopenDeadlineAt, athenaOwnerToken: siAthenaOwnerToken }), reopenDeadlineAt, "chart-reopen-deadline-exceeded");
                } catch (reopenErr) {}
                await new Promise(function (rWait) { var c = safe(function () { return absoluteDeadlines.arm(Date.now() + 1800, rWait); }, null); if (!c) rWait(); });
                continue;
              }
              throw new Error(vErrText);
            }
            await collectOverlapParse(overlapParse, one, stageMs, patientDeadlineAt); overlapParse = null;
            var __visitSaveT0 = Date.now();
            var saveInput=Object.assign({},vr,{__mlsResponsiveOrganization:true});
            var savedVisits = saveVerifiedVisits(target, saveInput);
            if(savedVisits.organization&&savedVisits.organization.deferred===true){
              var responsiveReceipt=await window.__mlsVisitModel.organizePatientHistoryResponsive(target.patientId);
              if(!responsiveReceipt||responsiveReceipt.ok!==true){
                var responsiveReason=String((responsiveReceipt&&responsiveReceipt.reason)||"organize-returned-no-result");
                var responsiveMissed=[];
                safe(function(){responsiveMissed=(responsiveReceipt&&responsiveReceipt.semanticCoverage&&responsiveReceipt.semanticCoverage.missedSections)||[];return null;});
                throw new Error("history-organization-unproven: "+responsiveReason+(responsiveMissed.length?(" - sections detected but not captured: "+responsiveMissed.join(", ")):""));
              }
              savedVisits.organization=responsiveReceipt;
              savedVisits.profileCoverage=safe(function(){return isFn(window._patientHistoryCardCoverage)?window._patientHistoryCardCoverage(target.patientId):null;},null);
              savedVisits.clinicalFieldCount=['problems','meds','allergies','vitals','history'].reduce(function(n,k){return n+(savedVisits.profileCoverage&&savedVisits.profileCoverage.cards&&savedVisits.profileCoverage.cards[k]&&savedVisits.profileCoverage.cards[k].populated?1:0);},0);
            }
            stageMs.visitSave = Date.now() - __visitSaveT0;
            one.visitsComplete = true; if (savedVisits.sameDay) one.sameDayReceipt = Object.assign({ kind: "athena-same-day-note-v1" }, savedVisits.sameDay); one.visitCount = savedVisits.visitCount; one.persistedVisits=savedVisits.persistedVisits; one.parsedVisits = savedVisits.parsedVisits; one.expectedVisits = savedVisits.expectedVisits; one.visitsCoverageComplete = savedVisits.visitsCoverageComplete; one.visitsReaderVersion = savedVisits.readerVersion; one.authoritativeEmpty=savedVisits.authoritativeEmpty===true; one.reconcileReceipt=savedVisits.reconcileReceipt; one.organizationComplete=!!(savedVisits.organization&&savedVisits.organization.ok===true); one.organizationReceipt=savedVisits.organization; one.surfaceResets=Number(savedVisits.surfaceResets||0); one.chartSurface=String(savedVisits.chartSurface||""); one.axRrWaitMs=Number(savedVisits.axRrWaitMs||0); one.axRrRecovered=savedVisits.axRrRecovered===true; one.axEntry=String(savedVisits.axEntry||""); one.fatigueRefresh=savedVisits.fatigueRefresh===true; one.hydStreak=Number(savedVisits.hydStreak||0);
            /* si-facts-1.1: enrichment is best-effort and must not delay the
               proven visit-body receipt or the next row. */
            one.factsCapture = siCaptureFactsFollowup(target.patientId, one);
            /* qv-1.0 (2026-08-09): a chart is only COMPLETE when its bytes are
               provably in storage. The quota guard (mls-connect) judges every
               savePatients by its stored echo and stamps a timestamped failure
               on window.__mlsStoreWriteFailed; a failure fresher than this
               chart's read means THIS chart's persist died - the row FAILS
               loudly instead of wearing an unearned green. Days 7/8/9 wore
               exactly that green over dead writes tonight. */
            var __qvFail = null;
            try { __qvFail = window.__mlsStoreWriteFailed || null; } catch (eQv) {}
            if (__qvFail && Number(__qvFail.at || 0) >= patientReadStartedAt) {
              one.complete = false;
              one.visitsComplete = false;
              one.reason = "storage-full-not-saved";
              one.storageFailure = { at: Number(__qvFail.at || 0), kind: String(__qvFail.reason || "").slice(0, 40) };
            }
            /* onheal-1.0.0: derive the ON lane's same-day proof from what THIS
               walk measured, and from nothing else. It is admitted only for an
               UNSCOPED, coverage-complete traversal - saveVerifiedVisits has
               already proved parsed === expected, persisted === parsed, one
               alias per row and body equality, so those rows ARE the complete
               verified universe for this chart. "absent" is therefore EARNED by
               that completeness, never defaulted. p.todayNote is deliberately
               NOT set: full mode makes no separate pulled-day read and must
               never report one (tests/1p-pull-resume-skip-and-cost-runtime
               pins todayNoteRead === 0 in full mode, and it is right). */
            if (pullVisitBodies === true && savedVisits.scopedAdditive !== true &&
                savedVisits.visitsCoverageComplete === true && one.visitsComplete === true) {
              var sdpDay = batchRowDay(row);
              if (/^\d{4}-\d{2}-\d{2}$/.test(String(sdpDay || ""))) {
                var sdpSeen = safe(function () {
                  var vrows = (vr && Array.isArray(vr.visits)) ? vr.visits : [];
                  for (var sdi = 0; sdi < vrows.length; sdi++) {
                    var vrow = vrows[sdi] || {};
                    if (normDate(vrow.date || vrow.serviceDate || vrow.dateISO || "") === sdpDay) return true;
                  }
                  return false;
                }, false) === true;
                /* onheal-1.0.1 (refuter): "absent" is a claim about a FINISHED
                   day. Today's walk is a point-in-time observation - the note
                   may simply not be written yet - so today and future days
                   report not-yet-available and never buy a same-day skip. */
                var sdpLocalToday = safe(function () { var d = new Date(); var mo = String(d.getMonth() + 1); var da = String(d.getDate()); return d.getFullYear() + "-" + (mo.length < 2 ? "0" + mo : mo) + "-" + (da.length < 2 ? "0" + da : da); }, "");
                var sdpFinishedDay = !!(sdpLocalToday && sdpDay < sdpLocalToday);
                one.sameDayProof = { status: (dayNoteFuture(sdpDay) || !sdpFinishedDay) ? (sdpSeen ? "saved" : "not-yet-available") : (sdpSeen ? "saved" : "absent"), day: sdpDay, from: "full-walk" };
              }
            }
            /* si-2.0.0: a COMPLETED body pass earns the carry stamp. */
            if (savedVisits.visitsCoverageComplete === true) stampVisitsProof(target.patientId, savedVisits);
            if(savedVisits.profileCoverage&&savedVisits.profileCoverage.complete===true&&savedVisits.profileCoverage.exactIdentityVerified===true){
              var profileCapturedRaw=savedVisits.profileCoverage.capturedAt;
              var profileCapturedAt=Number(profileCapturedRaw||0);
              if(!isFinite(profileCapturedAt)||profileCapturedAt<=0) profileCapturedAt=Date.parse(String(profileCapturedRaw||""))||0;
              var currentProfile=profileCapturedAt>=patientReadStartedAt&&profileCapturedAt<=Date.now()+5000;
              one.profileCoverageFresh=currentProfile;
              /* Full r4 encounter bodies prove visits, not the current chart's
                 problem/med/allergy/profile shell. Never let an older complete
                 six-card receipt mask a failed fresh chart-profile read. A
                 current exact receipt may still be accepted when another
                 current route saved it during this same patient operation. */
              if(currentProfile&&one.organized){
                one.profileCoverage=savedVisits.profileCoverage;one.clinicalFieldCount=savedVisits.clinicalFieldCount;
              }else if(!one.organized){
                /* Full encounter bodies may organize longitudinal facts, but
                   they cannot replace proof that this operation saved the
                   current chart shell. Never let visit persistence recover a
                   failed or metadata-only six-card save. */
                one.visitsReason=one.visitsReason||(currentProfile?"six-card-current-chart-unproven":"six-card-profile-freshness-unproven");
              }
            }
          } catch (visitErr) { if (one.visitsReason !== "athena-tab-sleeping") one.visitsReason = String(visitErr && visitErr.message || visitErr || "visits-read-failed").slice(0, 200); if (/timeout|deadline/i.test(one.visitsReason)) { stopAfterTimeout = true; receipt.timedOut = true; } else if (/athena-session-expired/.test(one.visitsReason)) { stopAfterTimeout = true; receipt.sessionExpired = true; } /* sx-1.1 */ }
          if (overlapParse) { try { await collectOverlapParse(overlapParse, one, stageMs, patientDeadlineAt); } catch (eOverlapLate) {} overlapParse = null; }
          stageMs.visits = Date.now() - __visitsT0;
        }
        if(one.visitsSkipped!==true&&one.visitsVerifiedCarry!==true&&one.organized&&one.visitsComplete&&Number(one.clinicalFieldCount||0)===0&&Number(one.parsedVisits||0)===0&&one.authoritativeEmpty!==true){one.organizationComplete=false;one.visitsReason="clinical-field-coverage-unproven";}
        /* dfc-1.0.0: the historical-bodies lane always answers with a TYPED
           receipt — requested/not-requested is a declaration, never an
           implied absence, and completion is the lane's own verdict. */
        if (!one.allHistoryReceipt) {
          one.allHistoryReceipt = pullVisitBodies === true
            ? { kind: "athena-all-history-v1", requested: true,
                status: one.visitsComplete === true ? "saved" : (one.visitsReason ? "refused" : "partial"),
                complete: one.visitsComplete === true,
                reason: one.visitsComplete === true ? undefined : (one.visitsReason || "history-partial") }
            : { kind: "athena-all-history-v1", requested: false, status: "not-requested" };
        }
        one.stageMs = { chartMs: stageMs.chart, parseSaveMs: stageMs.parseSave, visitsMs: stageMs.visits, visitSaveMs: stageMs.visitSave, totalMs: Date.now() - patientReadStartedAt };
        if (one.parsePipelined !== true) {
          one.complete = capRowComplete(one); /* cap-1.0.0 */
          if (!one.complete) {
            fdxStampRoute(one); /* fdx-1.1.0 */
            one.reason = fdxRowReason(one) || one.chartReason || one.visitsReason || "history-partial";
            receipt.retry.push(frozenRetryEntry(row, target, one.reason, one));
          }
        }
        /* lpfr-1.0.0: a transient first-pass miss is not a final failure while
           the outer batch still owns its automatic re-check. Keep it calm and
           pending; the final post-sweep settle below is the only place allowed
           to paint the terminal warning. */
        var oneQueuedForSweep = !sweepDepth && one.parsePipelined !== true && one.complete !== true && AUTOMATIC_HISTORY_RETRY_REASON.test(String(one.reason || ""));
        one.__ppRow = ppSettle(row.name, one.parsePipelined === true ? false : one.complete === true, one.parsePipelined === true ? "finishing…" : (oneQueuedForSweep ? "queued-for-automatic-recheck" : (one.complete === true ? (one.summaryPending === true ? "saved · summary pending" : "") : ((one.reason || "") && (one.reason + historyDiagSuffix(one))))), one.parsePipelined === true || oneQueuedForSweep, { surfaceResets: one.surfaceResets, chartSurface: one.chartSurface, pid: one.patientId, axe: one.axEntry, sp: one.summaryPending === true, chartSaved: ((one.organized === true && one.dobVerified === true) || one.captureSaved === true) && !one.storageFailure && one.visitsReason !== "clinical-field-coverage-unproven" });
        receipt.patients.push(one); receipt.processed++;
        /* dn-1.0 FOLD-IN (owner 2026-08-11: it "should save the days visit note
           when its already on that person"): with visit bodies OFF the pulled
           day's note is captured NOW, while THIS patient's verified chart is
           still the tab-of-record. The old serial re-open pass cost ~38s/note
           re-opening charts this loop had already opened (62.8s/chart combined,
           criterion-1 FAIL: tests/live-e2e-artifacts/2026-08-11-3061-acceptance-
           jul7.md). The read is sequential and FULLY AWAITED before the next
           chart opens (2026-07-28 law), and it runs through the SAME
           __mlsVisitSavePref.runForPatient chain as the tail pass - the chart
           re-open+verify, every identity gate, the refusal reasons, and the
           additive scoped save are byte-identical; only the MOMENT moved.
           Because the tab is already parked on this patient, the reader's own
           _assistReadChart re-verifies a chart it is already on - which is also
           the answer to the ~25-30s athena surface recycle: the day-note leg
           re-establishes a FRESH verified surface immediately before the scoped
           read instead of trusting the history capture's aging one. A failed
           chart read (rd null) leaves todayNote null for the tail pass and the
           sweep, exactly as before. */
        /* dnb2-1.0.0: THIS pull opened and verified this patient's chart. That
           is the observable progress the one retry is allowed to bet on, and
           it belongs HERE rather than inside the inline day-note leg below: a
           row the fuse sent to the tail pass had its chart opened just the
           same, and must not be misread as "no evidence". */
        if (rd) one.dayNoteChartOpen = true;
        /* dayfacts-1.0.1 (superseding owner DAY contract): the inline fold-in
           IS the day-facts same-day leg - it reads exactly the pulled-day
           encounter note while the row's chart is already open and verified.
           Its own condition (pullVisitBodies !== true && visitsSkipped) keeps
           it OFF-mode-only; ON rows get their bodies from the full traversal.
           The pre-contract fuse ("never enter it from this batch") is revoked
           together with schedule-only OFF. */
        var pulledDayNoteLaneEnabled = true;
        /* dfc-1.1.0: a row whose pulled-day note already landed through the
           DIRECT scoped bridge read owes nothing here - one scoped read per
           row per day. The fold-in remains the ladder's next rung for every
           direct-read failure (todayNote stays unset there). */
        if (pulledDayNoteLaneEnabled && !stopAfterTimeout && pullVisitBodies !== true && one.visitsSkipped === true && rd && !inlineDayNoteFuse && one.todayNote == null) {
          var dnDay = batchRowDay(row); /* dnd-1.0.0 */
          var dnGate = tnDayApplicable(dnDay); /* dnf-1.0.0 */
          var dnVp = safe(function () { return window.__mlsVisitSavePref; }, null);
          var dnP = dnGate.ok ? safe(function () { return findStorePatient(one.patientId); }, null) : null;
          if (dnGate.future) {
            /* fd-1.0.0: nothing exists to read on a day that has not happened.
               NOT a failure - the string is neither true nor false, so
               todayNoteFailures (which counts === false) stays honest and the
               row is attempt-once for the tail pass (todayNote != null). */
            one.todayNote = "future-day";
            one.todayNoteReason = "future-day";
            one.todayNoteSkipped = "future-day";
            tnStamp(one, 0, "skipped");
          }
          /* tny-1.0.0: TODAY, but this patient's slot has not arrived yet.
             Nothing to read, nothing failed, and the 45 s bound is not spent. */
          else if (dnGate.ok && !tnApptPassed(dnDay, row)) { tnStampNotYet(one, "time"); }
          /* dnrs-1.0.0: this account day already read and saved this note. */
          else if (dnGate.ok && dnAlreadyReadToday(dnDay, one.patientId)) { tnStampAlreadyRead(one, (dnAlreadyReadToday(dnDay, one.patientId) || {}).at); }
          /* dnp2-1.0.0: the pass budget is gone - hand the row over now rather
             than spend another deadline discovering the same thing. */
          else if (dnGate.ok && dnPassExhausted()) { tnStampHandedOff(one, dnDay); }
          else if (!(dnVp && typeof dnVp.runForPatient === "function" && dnP)) { one.todayNote = false; one.todayNoteReason = dnGate.ok ? "reader-unavailable" : dnGate.reason; }
          else {
            if (todayNoteExtOk === null) {
              /* one pong per batch decides scoped-read capability; the pong
                 version is the only honest source (2026-07-28 invariant). */
              todayNoteExtOk = await safeAsync(async function () {
                var pg = await bridge("mlsPong", "mlsPing", 3500);
                var m = String((pg && pg.version) || "").match(/^(\d+)\.(\d+)\.(\d+)/);
                if (!m) return false;
                return (Number(m[1]) > 3) || (Number(m[1]) === 3 && (Number(m[2]) > 0 || Number(m[3]) >= 30));
              }, false);
            }
            if (!todayNoteExtOk) { one.todayNote = false; one.todayNoteReason = "extension-predates-scoped-read"; }
            else {
              try { ppCurrent(String(one.name || "").split(" ")[0] + " \u2014 saving the pulled day's note"); } catch (eDnCur) {}
              safe(function () { if (window.__mlsPullShieldTick) window.__mlsPullShieldTick(); });
              var dnT0 = Date.now(); /* dnf-1.0.0: measure it, never guess */
              /* dnb2-1.0.0: THIS pull's own verified chart read for this row
                 landed a moment ago (the `rd` gate above) - that is the
                 observable progress a retry is allowed to bet on. */
              one.todayNoteAttempts = Number(one.todayNoteAttempts || 0) + 1;
              var dnProgress = "";
              try {
                var dnRes = await tnBoundedRead(dnVp, dnP, dnDay); /* dnf-1.0.0 */
                one.todayNote = tnReadOk(dnRes);
                dnProgress = tnProgressCode(one, dnRes);
                tnStamp(one, Date.now() - dnT0, one.todayNote ? "read" : "refused");
                if (!one.todayNote) one.todayNoteReason = String((dnRes && dnRes.reason) || "scoped-read-unverified").slice(0, 80);
              } catch (eDnRun) {
                one.todayNote = false; one.todayNoteReason = String((eDnRun && eDnRun.message) || eDnRun).slice(0, 80);
                dnProgress = tnProgressCode(one, null);
                tnStamp(one, Date.now() - dnT0, "refused");
                /* timeout-class failures mean the runner may still be driving
                   the tab: trip the fuse so no later INLINE attempt races the
                   next chart open; the tail pass (post-batch) inherits them. */
                if (/timeout|deadline|responding|unreachable|no-ext/i.test(one.todayNoteReason)) { inlineDayNoteFuse = one.todayNoteReason; receipt.todayNoteInlineFuse = inlineDayNoteFuse; }
              }
              /* tny-1.0.0: the reader answered "there is no verified encounter
                 for that date". On TODAY that is a visit that has not happened
                 yet, not a failed read. */
              if (one.todayNote === false && dnDay === acctTodayKey() && TNY_NO_ENCOUNTER.test(String(one.todayNoteReason || ""))) tnStampNotYet(one, "receipt");
              /* p1-todaynote-deferred-retry-1.0.0: a pull-in-flight refusal
                 lost to the lease this pull is still holding. Defer, do not
                 fail: the row is re-run once the lease is released.
                 dnb2-1.0.0 adds the progress condition - see tnProgressCode. */
              if (one.todayNote !== true && one.todayNote !== "not-yet" && tnIsDeferrable(one.todayNoteReason)) {
                if (dnProgress) { one.todayNoteProgress = dnProgress; tnDeferRow(one, dnDay); }
                else safe(function () { one.todayNoteNoProgress = true; receipt.todayNoteNoProgress = Number(receipt.todayNoteNoProgress || 0) + 1; });
              }
            }
          }
          /* qol-1.3 parity: an unread pulled-day note is VISIBLE on the row -
             pushed after the row's own settle so the day-note verdict wins the
             latest-state tally, exactly as the tail pass's emit did.
             tny-1.0.0 + deliverable 3 (owner 2026-08-17): this settle used to
             be `ok:false`, which is how the DAY-NOTE leg silently FAILED THE
             ROW - a chart that was read, organized and stored still painted
             "not saved" on the panel because a note the visit had not produced
             yet could not be read. The history verdict is the row's verdict;
             the day-note outcome rides along as its own column (r.dn). */
          /* dv3-1.0.0: a PIPELINED row's ok/failed verdict belongs to its own
             parse (and to finalization); the day note may only WRITE THE NOTE
             CELL on the row that already exists. Mutating the cell can never
             move the saved/failed tally - which is the whole defect. */
          if (one.parsePipelined === true) { if (one.__ppRow) safe(function () { var c = tnColumn(one); if (c) one.__ppRow.dn = c; }); }
          else tnEmitDayNoteColumn(one);
        }
        if (stopAfterTimeout) {
          for (var j = i + 1; j < rows.length; j++) receipt.retry.push(frozenRetryEntry(rows[j], null, "deferred-after-timeout"));
          break;
        }
      }
      /* si-1.7.4 finalization: settle every pipelined parse, give each failed
         one the SAME single full re-run the inline path had (fresh chart
         open + verify + sequential parse — the tab moved on since this
         patient's read), then evaluate completeness honestly in order. */
      for (var pw = 0; pw < pipelineParses.length; pw++) { try { await pipelineParses[pw].promise; } catch (ePipe) {} }
      for (var pf = 0; pf < pipelineParses.length; pf++) {
        safe(function () { window.__mlsPullBusyAt = Date.now(); }); /* si-1.7.9: finalization saves are still merge-unsafe */
        var pEntry = pipelineParses[pf], pOne = pEntry.one;
        /* cap-1.0.0: a row whose chart is CAPTURED and whose only gap is the
           AI summary never buys a second athena chart open here either. This
           is the measured 9-row case: nine extra full chart re-reads against a
           backend that was returning 502 to every one of them. */
        if (!pOne.organized && pOne.summaryPending !== true && !/timeout|deadline/i.test(String(pOne.chartReason || "")) && Date.now() + 300000 < batchDeadlineAt) {
          pOne.chartRetried = true; pOne.parseDeferredRetried = true;
          var pRetryDeadlineAt = Math.min(batchDeadlineAt, Date.now() + (sweepDepth ? 4 : 6) * 60 * 1000);
          var pRetryReadStartedAt = Date.now();
          var __dChartT0 = Date.now(), __dParseT0 = 0;
          try {
            var pRetryChartDeadlineAt = Math.min(pRetryDeadlineAt, Date.now() + 110000);
            var rdRetry = await boundedUntil(dnReadChart(pEntry.target, function () {}, { requestId: pOne.requestId + "-chart-d2", deadlineAt: pRetryChartDeadlineAt, athenaOwnerToken: siAthenaOwnerToken }), pRetryChartDeadlineAt, "chart-read-deadline-exceeded");
            pEntry.stageMs.chart += Date.now() - __dChartT0;
            __dParseT0 = Date.now();
            var pRetryParseDeadlineAt = Math.min(pRetryDeadlineAt, Date.now() + 120000);
            var organizedRetry = await saveOrganizedHistory(pEntry.target, pEntry.row, rdRetry, pRetryReadStartedAt, pRetryParseDeadlineAt, pOne.requestId + "-parse-d2");
            pEntry.stageMs.parseSave += Date.now() - __dParseT0;
            pOne.chartCoverage = organizedRetry.chartCoverage; pOne.profileCoverage = organizedRetry.profileCoverage; pOne.clinicalFieldCount = organizedRetry.clinicalFieldCount; pOne.dobVerified = organizedRetry.dobVerified === true;
            pOne.organized = !!(pOne.profileCoverage && pOne.profileCoverage.complete === true);
            pOne.chartReason = "";
          } catch (pRetryErr) {
            if (__dParseT0) { pEntry.stageMs.parseSave += Date.now() - __dParseT0; } else { pEntry.stageMs.chart += Date.now() - __dChartT0; }
            if (!capApplyPending(pOne, pRetryErr)) { /* cap-1.0.0 */
            pOne.chartReason = String(pRetryErr && pRetryErr.message || pRetryErr || "chart-read-failed").slice(0, 200);
            if (pRetryErr && pRetryErr.mlsEchoes) pOne.chartEchoes = pRetryErr.mlsEchoes;
            if (pRetryErr && pRetryErr.mlsFind) pOne.findDiag = pRetryErr.mlsFind; /* fdx-1.0.0 */
            if (/timeout|deadline/i.test(pOne.chartReason)) receipt.timedOut = true;
            else if (/athena-session-expired/.test(pOne.chartReason)) receipt.sessionExpired = true; /* sx-1.1 */
            }
          }
        }
        pOne.organizationComplete = pOne.organized;
        /* Pipelined totalMs is SELF time (chart + parse + visits stages), not
           wall time to finalization — wall time would double-count overlap. */
        pOne.stageMs = { chartMs: pEntry.stageMs.chart, parseSaveMs: pEntry.stageMs.parseSave, visitsMs: pEntry.stageMs.visits, visitSaveMs: pEntry.stageMs.visitSave, totalMs: pEntry.stageMs.chart + pEntry.stageMs.parseSave + pEntry.stageMs.visits };
        pOne.complete = capRowComplete(pOne); /* cap-1.0.0 */
        if (!pOne.complete) {
          fdxStampRoute(pOne); /* fdx-1.1.0 */
          pOne.reason = fdxRowReason(pOne) || pOne.chartReason || pOne.visitsReason || "history-partial";
          receipt.retry.push(frozenRetryEntry(pEntry.row, pEntry.target, pOne.reason, pOne)); /* fdx-1.0.0 */
        }
        ppResolve(pOne.__ppRow, pOne.complete === true, pOne.complete === true ? (pOne.summaryPending === true ? "saved · summary pending" : "") : (pOne.reason || ""), { sp: pOne.summaryPending === true, dn: tnColumn(pOne) /* tny-1.0.0 */, chartSaved: pOne.captureSaved === true || (pOne.organized === true && pOne.dobVerified === true) });
      }
      batchBodyCompleted = true;
    } finally {
      historyBatchRunning = false;
      try { window.__mlsSIBatchActive = false; } catch (eBA2) {}
      /* b744 #36: the progress reporter's lifecycle belongs to the OUTER
         batch AND outlives its automatic sweeps. Closing it here killed and
         re-created the whole panel at every sweep boundary - the elapsed
         clock restarted, a hidden panel slammed back open, and the pts
         pull shield dropped between passes. Inner (sweep) batches never
         close the reporter; the outer close lives after the sweep block.
         This finally only closes it on the THROW path, so an exception can
         never leave the panel running forever. */
      if (!batchBodyCompleted && !sweepDepth) safe(ppEnd);
    }
    /* ===== p1-todaynote-deferred-retry-1.0.0 (batch half) =====
       A today-note read refused with "pull-in-flight" lost to the lease THIS
       pull was holding. That is a deferral, not a verdict: queue the row and
       let it run once, after the pull releases. Everything below reuses the
       ordinary reader and the ordinary identity gates - nothing is bypassed
       and no clinical text is invented. */
    function tnRecomputeAggregate() {
      safe(function () { tnAggregate(); });
    }
    /* tny-1.0.0: ONE census of the day-note column, used by both recompute
       sites so the DONE card, the receipt and the ledger cannot disagree.
       not-yet and future-day are counted as their own outcomes and are NEVER
       failures - a failure is a note that should exist and could not be read. */
    function tnAggregate() {
      var tnF = 0, tnR = {}, tnRead = 0, tnNotYet = 0, tnFuture = 0, tnAlready = 0, tnQueuedNow = 0, tnCodes = {};
      /* dayfacts-1.0.1: the pulled-day note is MANDATORY in both modes now,
         so the old checkbox short-circuit ("OFF is a deliberate scope choice,
         not an unread note") is gone - the real per-row tally below runs for
         day-facts rows too. The only true not-requested case is the
         blocked-unchosen door, which returns before any tally exists. */
      receipt.todayNoteNotRequested = 0;
      (receipt.patients || []).forEach(function (p) {
        if (!p) return;
        if (p.todayNote === true) { tnRead++; return; }
        /* dnrs-1.0.0: read earlier TODAY and still on file - a read, and the
           reason this pull did not need to open the chart again. */
        if (p.todayNote === "already-read") { tnRead++; tnAlready++; return; }
        if (p.todayNote === "not-yet") { tnNotYet++; return; }
        if (p.todayNote === "future-day") { tnFuture++; return; }
        if (p.todayNote === false) {
          tnF++;
          var kR = String(p.todayNoteReason || "unknown").slice(0, 80); tnR[kR] = (tnR[kR] || 0) + 1;
          /* dnbf-1.0.0: the same census in a CLOSED code vocabulary, which is
             what a surface may safely render. */
          var kC = tnReasonCode(p.todayNoteReason); tnCodes[kC] = (tnCodes[kC] || 0) + 1;
          /* dnp2-1.0.0 honest counts: a row waiting on the background backfill
             has not failed - it has not finished. Reported separately so no
             surface has to guess. */
          if (p.todayNoteDeferred === true) tnQueuedNow++;
        }
      });
      receipt.todayNoteFailures = tnF; receipt.todayNoteReasons = tnR;
      receipt.todayNoteReasonCodes = tnCodes;
      receipt.todayNoteRead = tnRead;
      receipt.todayNoteAlreadyRead = tnAlready;
      receipt.todayNoteNotYet = tnNotYet;
      receipt.todayNoteFutureDay = tnFuture;
      receipt.todayNoteQueued = tnQueuedNow;
      receipt.todayNoteUnreadFinal = Math.max(0, tnF - tnQueuedNow);
      return { failed: tnF, read: tnRead, notYet: tnNotYet, future: tnFuture, alreadyRead: tnAlready,
        queued: tnQueuedNow, unreadFinal: receipt.todayNoteUnreadFinal, reasons: tnR, codes: tnCodes };
    }
    function tnBatchDay() {
      var day = "";
      for (var di = 0; di < rows.length && !day; di++) day = batchRowDay(rows[di]); /* dnd-1.0.0 */
      return day || batchScopeDay;
    }
    /* Re-publish the day's today-note truth after the deferred round so a
       FULLY RECOVERED day stops reporting a partial note lane: the receipt
       aggregate, the DONE card's dayVerdict stamp, and the persisted day
       ledger all move together. Verdict-neutral for the pull result itself,
       exactly as the inline lane is. */
    function tnSettleDay(summary) {
      tnRecomputeAggregate();
      safe(function () {
        receipt.todayNoteDeferred = {
          queued: Number((receipt.todayNoteDeferred && receipt.todayNoteDeferred.queued) || 0),
          rows: Number((summary && summary.rows) || 0),          /* dnbf-1.0.0 */
          attempted: Number((summary && summary.attempted) || 0),
          recovered: Number((summary && summary.recovered) || 0),
          remaining: Number(receipt.todayNoteFailures || 0),
          reason: String((summary && summary.reason) || "deferred-round"),
          at: Date.now()
        };
        /* dnbf-1.0.0: the PHI-free backfill receipt the dialog lane renders -
           reason CODES and counts, plus how many times the "open your
           athenaOne" verdict was disproved by the presence verb. */
        receipt.todayNoteBackfill = (summary && summary.backfill) || tnBackfillReceipt();
      });
      safe(function () {
        var sDv = ppState();
        if (!sDv || !sDv.dayVerdict) return;
        sDv.dayVerdict.tnFailed = Number(receipt.todayNoteFailures || 0);
        sDv.dayVerdict.tnReasons = receipt.todayNoteReasons || {};
        sDv.dayVerdict.tnRead = Number(receipt.todayNoteRead || 0);       /* tny-1.0.0 */
        sDv.dayVerdict.tnNotYet = Number(receipt.todayNoteNotYet || 0);   /* tny-1.0.0 */
        sDv.dayVerdict.tnFuture = Number(receipt.todayNoteFutureDay || 0); /* fd-1.0.0 */
        sDv.dayVerdict.tnDeferredRecovered = Number((summary && summary.recovered) || 0);
        sDv.dayVerdict.at = Date.now();
      });
      safe(function () { var day = tnBatchDay(); if (day) recordHistoryVerdict(day, receipt, rows.length); });
      /* notes-idle-1.0.0 (feed 2 of 2): the immediate round has now had its two
         bounded attempts, so every row it did NOT recover is a leftover. Rows it
         DID recover are dropped from the persistent queue by the same call. */
      safe(function () { niSyncFromReceipt(receipt, tnBatchDay()); });
    }
    function tnDeferRow(entry, day, force) {
      if (!entry || !day || sweepDepth) return false; /* dayfacts-1.0.1: the deferred round serves BOTH modes - a day-facts row's retryable note refusal queues exactly like a full-mode one */
      var pid = String(entry.patientId || "");
      if (!pid) return false;
      var queued = tnQueueDeferred({
        /* dnbf-1.0.0: NO NAME rides the queue. The backfill's receipt is
           reason codes and counts, and the cheapest way to keep it that way is
           for the name never to be there in the first place. */
        patientId: pid, day: String(day),
        code: tnReasonCode(force === true ? "day-note-pass-budget-exhausted" : entry.todayNoteReason),
        settleDay: tnSettleDay,
        /* dnbf-1.0.0: the round needs to know WHY the last turn refused (to
           choose backoff vs presence-probe vs stop) and needs to be able to
           put the row back into "retrying" before it tries again. Both are
           read-only views of this row - no clinical text, no name. */
        reasonOf: function () { return String(entry.todayNoteReason || ""); },
        retrying: function () { entry.todayNoteDeferred = true; safe(function () { tnEmitDayNoteColumn(entry); }); },
        /* nih-1.0.0 (2026-08-18): a row DROPPED from _tnDefer without its
           attempt() ever running kept todayNoteDeferred=true forever, and
           niSyncFromReceipt skips deferred rows — so every lease-wait or
           terminal drop stranded its rows outside BOTH queues (measured live:
           15 queued, 13 dropped mid-pull while the pull held the lease ~11
           min, notesidle gate read "nothing-due"). disown() releases the
           receipt row so the settle's sync can adopt it into the idle queue.
           Only attempt() and disown() may clear the flag; retrying() re-sets
           it, and a stopped-by-user drop still syncs into a guard that
           refuses enqueue, so Stop never re-drives Athena. */
        disown: function () { entry.todayNoteDeferred = false; if (!entry.todayNoteReason) entry.todayNoteReason = "deferred-dropped"; safe(function () { tnEmitDayNoteColumn(entry); }); },
        attempt: function () {
          var vp = safe(function () { return window.__mlsVisitSavePref; }, null);
          var p = safe(function () { return findStorePatient(pid); }, null);
          if (!(vp && isFn(vp.runForPatient) && p)) {
            entry.todayNote = false; entry.todayNoteDeferred = false; entry.todayNoteReason = "deferred-reader-unavailable";
            safe(function () { tnEmitDayNoteColumn(entry); });
            return Promise.resolve(false);
          }
          /* offPass: the backfill runs AFTER the pull's Done, so its reads are
             not charged to (and not clipped by) the pull's pass budget. */
          return tnBoundedRead(vp, p, String(day), { offPass: true }).then(function (res) { /* dnf-1.0.0 */
            var ok = tnReadOk(res);
            entry.todayNote = ok;
            /* dnw-1.0.0: the retry has had its turn - this row is no longer
               "retrying", it is read or it is honestly unread. */
            entry.todayNoteDeferred = false;
            if (ok) { entry.todayNoteRecovered = true; safe(function () { receipt.todayNoteRecovered = Number(receipt.todayNoteRecovered || 0) + 1; }); }
            entry.todayNoteReason = ok ? "" : String((res && res.reason) || "scoped-read-unverified").slice(0, 80);
            /* tny-1.0.0: the same not-yet classification applies to the
               deferred round - it runs after the pull, still on TODAY. */
            if (!ok && String(day) === acctTodayKey() && TNY_NO_ENCOUNTER.test(String(entry.todayNoteReason || ""))) tnStampNotYet(entry, "receipt");
            /* deliverable 3: the deferred day-note verdict updates the NOTE
               column only. It used to settle the whole row ok/failed, so a
               recovered note could green a failed history and a refused note
               could fail a saved one. */
            tnEmitDayNoteColumn(entry);
            return ok;
          }, function (err) {
            entry.todayNote = false;
            entry.todayNoteDeferred = false;   /* dnw-1.0.0: the retry is spent */
            entry.todayNoteReason = String((err && err.message) || err || "deferred-read-failed").slice(0, 80);
            safe(function () { tnEmitDayNoteColumn(entry); });
            return false;
          });
        }
      });
      if (queued) {
        /* the row stays FALSE until the deferred attempt says otherwise - a
           queued row is never reported as read. */
        entry.todayNoteDeferred = true;
        safe(function () {
          receipt.todayNoteDeferred = receipt.todayNoteDeferred || { queued: 0, attempted: 0, recovered: 0, remaining: 0, reason: "queued", at: Date.now() };
          receipt.todayNoteDeferred.queued = Number(receipt.todayNoteDeferred.queued || 0) + 1;
        });
      }
      return queued;
    }
    /* ===== end p1-todaynote-deferred-retry-1.0.0 (batch half) ===== */
    function finalizeVerdict(holdAutomaticRows) {
      /* ppt-2.1 (supervisor 2026-08-09): every row must be TERMINAL when the
         pull ends - a row still reading "re-checking" at close is unresolved
         and fails the owner's every-patient-saved bar. One final settle per
         receipt patient; the chart-level tally dedups, so this is idempotent
         (finalizeVerdict may run twice by design). */
      try {
        (receipt.patients || []).forEach(function (fp) {
          if (!fp) return;
          /* onheal-1.0.0 (the sweep label may only claim a re-check that can
             still happen). Two states made this sentence a lie on the doctor's
             screen: the automatic pass gave up on time (sweepBudgetExhausted),
             and the doctor pressed Stop - after which the sweep block is
             skipped entirely, so NOTHING was ever going to re-check the row.
             __stpStopped is a var in this same function scope and is assigned
             before the first finalizeVerdict call, so it reads undefined-safe
             on every earlier path. */
          var fpQueuedForSweep = holdAutomaticRows === true && !sweepDepth && fp.complete !== true &&
            receipt.sweepBudgetExhausted !== true && __stpStopped !== true &&
            AUTOMATIC_HISTORY_RETRY_REASON.test(String(fp.reason || ""));
          ppSettle(fp.name || "", fp.complete === true, fp.complete === true ? (fp.summaryPending === true ? "saved · summary pending" : "") : (fpQueuedForSweep ? "queued-for-automatic-recheck" : ((fp.reason || "incomplete") + historyDiagSuffix(fp))), fpQueuedForSweep, { surfaceResets: fp.surfaceResets, chartSurface: fp.chartSurface, pid: fp.patientId, axe: fp.axEntry, sp: fp.summaryPending === true /* cap-1.0.0 */, dn: tnColumn(fp) /* tny-1.0.0 */, chartSaved: ((fp.organized === true && fp.dobVerified === true) || fp.captureSaved === true) && !fp.storageFailure && fp.visitsReason !== "clinical-field-coverage-unproven" });
        });
      } catch (eTerm) {}
      /* dnd-1.0.0: the receipt states the day it read, so a later Retry round
         rebuilt from receipt.retry can stay on that day without guessing. */
      receipt.day = batchScopeDay;
      /* notes-idle-1.0.0 (feed 1 of 2): the rows the pass refused and did NOT
         hand to the immediate deferred round. A row _tnDefer still owns is
         skipped here by niSyncFromReceipt and reaches the queue at tnSettleDay,
         after its two bounded attempts are spent. */
      safe(function () { niSyncFromReceipt(receipt, tnBatchDay()); });
      receipt.exactIdentityVerified = receipt.retry.length === 0 && receipt.patients.length === rows.length && receipt.patients.every(function (p) { return p && p.identityVerified === true; });
      /* dfc-1.0.0: the batch-level insurance verdict is a census of the
         per-row lane receipts, never an assumption. reader-not-shipped is
         reported only when NO row reached a live reader. */
      safe(function () {
        var covRows = receipt.patients.filter(function (p) { return p && p.coverageReceipt; });
        var covOk = covRows.filter(function (p) { return p.coverageReceipt.complete === true && p.coverageReceipt.status === "saved"; });
        var covAbsent = covRows.filter(function (p) { return String(p.coverageReceipt.reason || "") === "reader-not-shipped"; });
        receipt.insuranceComplete = covRows.length > 0 && covOk.length === covRows.length;
        receipt.benefitsComplete = receipt.insuranceComplete;
        receipt.insuranceReason = receipt.insuranceComplete ? "" : (covRows.length > 0 && covAbsent.length === covRows.length ? "reader-not-shipped" : (covRows.length ? "coverage-incomplete" : "no-rows"));
      });
      /* An empty verified provider day has no patient history targets and is
         vacuously exact; unresolved/name-only rows remain in retry and fail. */
      if (receipt.requested === 0) receipt.exactIdentityVerified = true;
      /* tax-1.0.0: ONLY a retry pass (the capped reader re-attempting) may
         reconcile content-class leftovers into named omissions - a first
         pass's failure is still just a failure. Runs BEFORE failures and the
         verdict census so both see the drained pool. */
      if (sweepOpts && sweepOpts.retryPass === true) taxReconcileNamedOmissions(receipt);
      receipt.failures = receipt.retry.length;
      /* pvd-1.0.0: the closed per-patient verdict census, stamped at settle.
         succeeded is now a first-class receipt field - the walk counters
         (requested/processed) remain, but they no longer stand in for it. */
      receipt.verdicts = historyVerdictCensus(rows, unresolved, receipt);
      receipt.succeeded = receipt.verdicts.succeeded;
      var sleepingRows = receipt.retry.filter(function (entry) { return entry && String(entry.reason || "") === "athena-tab-sleeping"; });
      if (sleepingRows.length) {
        receipt.reason = "athena-tab-sleeping";
        receipt.failureReason = "athena-tab-sleeping";
        receipt.athenaTabSleeping = true;
        var sleepingIds = sleepingRows.map(function (entry) { return Number(entry.athenaTabId || 0); }).filter(function (x, i, a) { return x > 0 && a.indexOf(x) === i; });
        receipt.sleepingTabId = sleepingIds.length === 1 ? sleepingIds[0] : null;
      }
      /* b752: MEASURE THE STORE, then judge. Everything downstream that speaks
         about coverage in words now reads this census rather than the walk
         counters, because requested/processed are arithmetically incapable of
         contradicting the walk that produced them. A pull that stored nothing
         reported 19/19 with failures 0 for exactly that reason. */
      /* unresolved is passed so the DENOMINATOR IS THE DAY. Censusing rows alone
         shrank the fraction to hide exactly the patients that were never
         attempted (a six-appointment day with four unresolved rows read 2/2
         where the walk counters had at least said 2/6), and a day whose rows ALL
         failed identity resolution hands this batch zero rows - which scored a
         vacuous 0 of 0 with measured true. */
      /* rsk-1.0.0 / dnf-1.0.0: WHERE THE TIME GOES, measured per row and
         aggregated here so "the day-note leg is the slow step" is a number.
         chart = extension open+verify+read, parseSave = organize+persist,
         visits = encounter bodies (zero with bodies OFF), todayNote = the
         pulled day's own scoped note. Counts and milliseconds only. */
      safe(function () {
        var t = { chartMs: 0, parseSaveMs: 0, visitsMs: 0, visitSaveMs: 0, todayNoteMs: 0, rows: 0, maxChartMs: 0 };
        (receipt.patients || []).forEach(function (p) {
          if (!p) return;
          t.rows++;
          var sm = p.stageMs || {};
          t.chartMs += Number(sm.chartMs || 0);
          t.parseSaveMs += Number(sm.parseSaveMs || 0);
          t.visitsMs += Number(sm.visitsMs || 0);
          t.visitSaveMs += Number(sm.visitSaveMs || 0);
          t.todayNoteMs += Number(p.todayNoteMs || 0);
          if (Number(sm.chartMs || 0) > t.maxChartMs) t.maxChartMs = Number(sm.chartMs || 0);
        });
        t.perRowChartMs = t.rows ? Math.round(t.chartMs / t.rows) : 0;
        t.perRowTodayNoteMs = t.rows ? Math.round(t.todayNoteMs / t.rows) : 0;
        t.skippedVerifiedToday = Number(receipt.chartsSkippedVerifiedToday || 0);
        receipt.costBreakdown = t;
      });
      /* dnrs-1.0.0 (owner deliverable 4): CHART OPENS PER PULL, counted at the
         two doors that cause them. The measured defect was 2N - one open for
         the history and a second for the day note - so this number is the one
         that says whether a change actually cost the tab less. */
      safe(function () {
        var hOpens = Number(receipt.chartOpensHistory || 0), dOpens = Number(receipt.chartOpensDayNote || 0);
        receipt.chartOpens = {
          history: hOpens, dayNote: dOpens, total: hOpens + dOpens,
          rows: Number((receipt.patients || []).length || 0),
          perRow: (receipt.patients || []).length ? Math.round(((hOpens + dOpens) / receipt.patients.length) * 100) / 100 : 0,
          skippedVerifiedToday: Number(receipt.chartsSkippedVerifiedToday || 0),
          skippedNoteAlreadyRead: Number(receipt.todayNoteSkippedAlreadyRead || 0)
        };
      });
      receipt.storeCensus = storedContentCensus(rows, unresolved);
      receipt.storeDelta = censusDelta(receipt.storeCensusBefore, receipt.storeCensus);
      receipt.storedContent = Number(receipt.storeCensus.withContent || 0);
      receipt.storedNoContent = Number(receipt.storeCensus.withoutContent || 0);
      receipt.storedChanged = Number(receipt.storeDelta.changed || 0);
      receipt.storeChangeMeasured = receipt.storeDelta.measured === true;
      receipt.contentGap = receipt.storeCensus.measured === true ? Number(receipt.storeCensus.gap || 0) : 0;
      /* contentVerified is the ONLY completeness claim the census can support:
         every target of the day resolved to a stored record that holds real
         clinical content. A patient whose Athena chart is genuinely empty
         makes it false WITHOUT making the pull a failure - complete below
         keeps its meaning (every requested read finished and receipted) so a
         verified-empty chart is still a valid, saved outcome. The gap is
         reported, never refused, and never explained: from here an empty
         chart and a read that missed the content look identical. */
      receipt.contentVerified = receipt.storeCensus.measured === true && receipt.contentGap === 0;
      receipt.complete = receipt.exactIdentityVerified && receipt.retry.length === 0 && receipt.processed === rows.length && receipt.patients.every(function (p) { return p && p.complete === true; });
      /* stp-2.0.0: a stopped batch names itself. "history-partial" invited the
         auto-convergence lane to treat the doctor's Stop as a transient
         straggler and start the whole thing again. */
      receipt.reason = receipt.complete ? "complete" : (receipt.stoppedByUser === true ? "stopped-by-user" : "history-partial");
      /* qol-2.2 D4: the OFF lane's failure channel was write-only - todayNoteReason
         reached no aggregate, no day-end line, no error report. Verdict-neutral
         by design (L3677); recomputed idempotently on both finalize calls. */
      safe(function () { tnAggregate(); }); /* tny-1.0.0: one census, both sites */
      /* ===== cap-1.0.0 (the receipt says "saved · summaries pending N") ===== */
      safe(function () {
        var sp = 0, codes = {}, saved = 0;
        (receipt.patients || []).forEach(function (p) {
          if (!p) return;
          if (p.captureSaved === true) saved++;
          if (p.summaryPending === true) { sp++; var kc = String(p.summaryCode || "ai-unavailable").slice(0, 40); codes[kc] = (codes[kc] || 0) + 1; }
        });
        receipt.summariesPending = sp;
        receipt.summaryPendingCodes = codes;
        receipt.capturesSaved = saved;
      });
      /* ===== fdx-1.0.0 (chart-open find verdict census) =====
         The owner's 13-of-15 failure printed ONE sentence for FOUR different
         extension outcomes. Count them by the extension's own code so the next
         report says which one it was. noMatchingPatient is the count of rows
         that hit background.js:12596 - the collapsed sentence - broken out by
         findReason. Codes and counts only; PHI-free by construction. */
      safe(function () {
        var fR = {}, fV = {}, nmp = 0, seen = 0;
        (receipt.patients || []).forEach(function (p) {
          var fd = p && p.findDiag;
          if (!fd) return;
          seen++;
          var code = String(fd.findReason || fd.reason || "unreported").slice(0, 40) || "unreported";
          fR[code] = (fR[code] || 0) + 1;
          var via = String(fd.via || fd.route || "").slice(0, 40);
          if (via) fV[via] = (fV[via] || 0) + 1;
          if (/^(no-results|no-name-match|blank-error|rows-not-rendered)$/.test(code)) nmp++;
        });
        receipt.findReasons = fR;
        receipt.findVia = fV;
        receipt.findDiagRows = seen;
        receipt.noMatchingPatient = nmp;
        /* fdx-1.1.0: the find-OPEN deadline counted separately from the four
           no-matching-patient outcomes - it is a timing refusal, not an answer
           about the patient, and it is the one the sweep now re-tries. */
        receipt.findOpenDeadlineRows = (receipt.patients || []).filter(function (p) { return p && String(p.reason || "") === "find-open-deadline"; }).length;
        /* An honest, ACTIONABLE sentence for the one find outcome that is not
           about the patient at all: rows-not-rendered means athena printed
           "N results found" and then never hydrated the row links - the shape
           a background/non-painting athena tab produces. Never claim this for
           no-results/no-name-match, which are real athena answers. */
        if (Number(fR["rows-not-rendered"] || 0) >= 2 && Number(fR["rows-not-rendered"] || 0) >= nmp / 2) {
          receipt.findHint = "athenaOne found the search results but never finished drawing their rows on " +
            Number(fR["rows-not-rendered"] || 0) + " chart" + (Number(fR["rows-not-rendered"] || 0) === 1 ? "" : "s") +
            ". That is the athena tab, not the patient: click the athenaOne tab once so it paints, then retry.";
        }
      });
      /* dn-1.0 TERMINAL TRUTH: the pull panel's DONE card (mls-connect
         __mlsPullProgress) reads this stamp. Outer batch only - a sub-batch
         stamping day-level truth is the b752 subset trap. finalizeVerdict may
         run twice by design; the LAST call wins, which is the post-sweep truth. */
      safe(function () { if (sweepDepth) return; var sDv = ppState(); if (!sDv) return; sDv.dayVerdict = { ok: Number(sDv.ok || 0), failed: Number(sDv.failed || 0), chartOnly: Number(sDv.chartOnly || 0), total: Number(sDv.total || 0), complete: receipt.complete === true, tnFailed: Number(receipt.todayNoteFailures || 0), tnReasons: receipt.todayNoteReasons || {}, tnRead: Number(receipt.todayNoteRead || 0) /* tny-1.0.0 */, tnNotYet: Number(receipt.todayNoteNotYet || 0) /* tny-1.0.0 */, tnFuture: Number(receipt.todayNoteFutureDay || 0) /* fd-1.0.0 */, summaryPending: Number(receipt.summariesPending || 0) /* cap-1.0.0 */, capturesSaved: Number(receipt.capturesSaved || 0) /* cap-1.0.0 */, at: Date.now() }; });
      /* b751: persist it. finalizeVerdict runs at every exit and may run twice
         (before and after the end-of-batch re-sweep); the write is keyed by day
         so the LAST call wins, which is the post-sweep truth we want. */
      safe(function () {
        /* b752: A SUBSET RUN MUST NOT OVERWRITE THE DAY. The automatic sweep and
           the manual retry both walk a handful of the days patients through this
           same finalizeVerdict, and the record is keyed by day - so a sub-batch
           filed three swept patients under day-level field names, and on the
           break paths of the sweep loop (a throw, or a sub-receipt with no
           patients array) that subset record was the one left standing. The
           census fields now make this ledger the forensic answer to "how many of
           the days patients hold content", so a mis-scoped record is worse than
           none. The outer pre-sweep call has already written the full day. */
        if (sweepDepth) return;
        var day = "";
        for (var di = 0; di < rows.length && !day; di++) {
          day = batchRowDay(rows[di]); /* dnd-1.0.0 */
        }
        if (!day) day = batchScopeDay;
        if (day) recordHistoryVerdict(day, receipt, rows.length);
      });
    }
    /* 2026-07-28 owner directive (post-sweep lane): with "Full visit notes"
       off, the pulled day's OWN encounter note still saves — op-notes for
       that visit depend on it. This pass runs AFTER the sweep, sequential
       and FULLY AWAITED, because a mid-batch scoped read abandoned on a
       timer keeps DRIVING the athena tab and wrestles the tab-of-record
       away from the next patient's chart open (measured live 2026-07-28:
       10 ok, then 11 straight tab-unreachable). cv.run's own 240s timeout
       bounds each read; failures land on todayNoteReason and never change
       the pull verdict. */
    /* ===== stp-2.0.0 (STOP means stop) =====
       Owner 2026-08-17: "a couple issues like when STOPPING". A cooperative
       stop broke the CHART loop and then ran, in order: this whole today-note
       tail pass (one Athena read per visits-skipped row), the automatic
       convergence sweep, and finally a deferred today-note round - minutes of
       further Athena driving after the doctor pressed Stop, with the lease
       still held. Stop now ends every remaining Athena leg. Everything already
       read stays saved and the receipt says exactly what was and was not done. */
    var __stpStopped = receipt.stoppedByUser === true || safe(function () { return window.__mlsPullStopRequested === true; }, false);
    if (__stpStopped) {
      receipt.stoppedByUser = true;
      safe(function () {
        var tnSkipped = 0, tnNotRequested = 0;
        (receipt.patients || []).forEach(function (p) {
          if (!p || p.visitsSkipped !== true || p.todayNote != null) return;
          /* dayfacts-1.0.1: the pulled-day note is in scope in BOTH modes, so
             a stopped row's note is honestly "stopped before it was reached" -
             never the revoked visit-notes-off vocabulary. */
          p.todayNote = false;
          p.todayNoteReason = "stopped-by-user";
          tnSkipped++;
        });
        receipt.todayNoteStoppedRows = tnSkipped;
        receipt.todayNoteNotRequestedRows = tnNotRequested;
      });
      /* onheal-1.0.0: after a Stop the automatic sweep block is skipped
         entirely, so no row is queued for anything. Say so on the row. */
      safe(function () {
        var stoppedSkips = 0;
        (receipt.patients || []).forEach(function (p) {
          if (!p || p.complete === true) return;
          if (!AUTOMATIC_HISTORY_RETRY_REASON.test(String(p.reason || ""))) return;
          p.recheckSkipped = "stopped-by-user"; stoppedSkips++;
        });
        if (stoppedSkips) receipt.sweepSkippedByStop = stoppedSkips;
      });
      /* a stop must not leave a deferred round armed against a lease it will
         never see freed for this pull's rows. */
      safe(tnDropDeferredQueue);
    }
    /* dayfacts-1.0.1: the tail pass is the day-facts catch-up for rows the
       inline fold-in never reached (chart-read failures healed later, fuse
       hand-offs, deferred rows). Mandatory under the superseding contract. */
    var pulledDayNoteTailEnabled = true;
    if (pulledDayNoteTailEnabled && pullVisitBodies !== true && !__stpStopped) {
      /* qol-1.5: this block read the UNDECLARED todayNoteExtOk (and called an
         undefined safeAsync) OUTSIDE any try/catch - the first visits-skipped
         patient threw ReferenceError, the day verdict and sweep never ran, and
         the progress panel span forever. Both are now declared, and the whole
         pass is fenced so finalizeVerdict()/ppEnd are reachable on EVERY path. */
      /* dn-1.0: todayNoteExtOk + safeAsync now live at batch scope (shared
         with the inline fold-in in the main loop). This pass is the TAIL: it
         attempts ONLY patients the inline capture never reached (chart-read
         failures, fuse trips) - an inline verdict, success OR refusal, is
         attempt-once and is never re-run here, so a day where every inline
         capture succeeded performs ZERO second-pass re-opens. */
      try {
      var todayNoteDayById = {}, todayNoteRowById = {}; /* tny-1.0.0: the ROW carries the appointment time */
      try { rows.forEach(function (r) { var pid = String((r && (r._mlsTargetPatientId || r.patient_external_id)) || ""); if (pid) { todayNoteDayById[pid] = batchRowDay(r); todayNoteRowById[pid] = r; } }); } catch (eMap) {} /* dnd-1.0.0 */
      var vpToday = safe(function () { return window.__mlsVisitSavePref; }, null);
      /* qol-2.2 D3: rows settle before this pass, so the card read 100% and
         sat there grinding. ppCurrent is never number-parsed (safe from the
         si-1.9.4 bar regex), so narrate the pass live. */
      var tnTotal = 0; try { for (var tnc = 0; tnc < receipt.patients.length; tnc++) { if (receipt.patients[tnc] && receipt.patients[tnc].visitsSkipped === true && receipt.patients[tnc].todayNote == null && tnDayApplicable(todayNoteDayById[String(receipt.patients[tnc].patientId || "")] || "").ok) tnTotal++; } } catch (eTnc) {} var tnIdx = 0; /* dnf-1.0.0 */
      /* ===== dnpri-1.0.0 (the notes that EXIST are read first) ==============
         Owner deliverable 5. The schedule row the extension hands the engine
         carries NO status column - background.js strips "arrived / checked in
         / checked out" as grid noise (the STOP and reason-scrub lists) before
         a row is ever built, so `seen` is not a field the engine can read
         today. The signal that DOES reach it is the appointment TIME, and it
         answers the same question: a slot that finished hours ago has a note,
         a slot ten minutes old often does not, and a slot that has not arrived
         is skipped without a read at all (tny-1.0.0). The pass therefore walks
         EARLIEST-PASSED FIRST, so a spent pass budget (dnp2-1.0.0) costs the
         rows least likely to have a note to read.
         If a future extension DOES supply a status the field wins outright:
         checked-out/seen/completed sorts ahead of checked-in, which sorts
         ahead of an unknown status. Fail-open - an unreadable status is just
         "unknown" and falls back to the clock. */
      function tnSeenRank(row) {
        var st = String((row && (row.status || row.apptStatus || row.appointmentStatus)) || "").trim().toLowerCase();
        if (!st) return 2;
        if (/check(?:ed)?[ -]?out|completed|complete|seen|closed|discharged/.test(st)) return 0;
        if (/check(?:ed)?[ -]?in|arrived|roomed|in[ -]?room|intake|ready/.test(st)) return 1;
        return 3;
      }
      var tnOrder = [];
      try {
        for (var tnO = 0; tnO < receipt.patients.length; tnO++) tnOrder.push(tnO);
        tnOrder.sort(function (a, b) {
          var pa = receipt.patients[a], pb = receipt.patients[b];
          var ra = todayNoteRowById[String((pa && pa.patientId) || "")] || null;
          var rb = todayNoteRowById[String((pb && pb.patientId) || "")] || null;
          var sa = tnSeenRank(ra), sb = tnSeenRank(rb);
          if (sa !== sb) return sa - sb;
          /* an unknown time sorts LAST, never first: it is the one row we
             cannot say has been seen. */
          var ma = tnRowMinutes(ra), mb = tnRowMinutes(rb);
          if (ma < 0 && mb < 0) return a - b;
          if (ma < 0) return 1;
          if (mb < 0) return -1;
          if (ma !== mb) return ma - mb;
          return a - b;
        });
        receipt.todayNotePassOrdered = true;
      } catch (eTnOrd) { tnOrder = []; for (var tnF = 0; tnF < receipt.patients.length; tnF++) tnOrder.push(tnF); }
      /* ===== end dnpri-1.0.0 ===== */
      for (var tnQ = 0; tnQ < tnOrder.length; tnQ++) {
        var tn = tnOrder[tnQ];
        var oneTn = receipt.patients[tn];
        if (!oneTn || oneTn.visitsSkipped !== true) continue;
        var tnDay = todayNoteDayById[String(oneTn.patientId || "")] || "";
        var tnRow = todayNoteRowById[String(oneTn.patientId || "")] || null;
        /* dn-1.0: attempt-once - an inline verdict (success OR refusal, incl.
           identity-mismatch) is final; only never-attempted patients reach
           this tail. tny-1.0.0 adds exactly ONE re-entry: a row parked as
           not-yet whose appointment slot has since passed. */
        if (oneTn.todayNote != null && !(oneTn.todayNote === "not-yet" && tnApptPassed(tnDay, tnRow))) continue;
        tnIdx++;
        /* dnp-1.0.0 + dnw-1.0.0: the phase the dialog can render, and calm
           wording while the answer is still unknown. "could not be read" is
           reserved for the END of the lane, after the deferred round. */
        try { ppPhase("day-notes", tnIdx - 1, tnTotal); } catch (ePpPh) {}
        try { ppCurrent("reading today's notes (" + tnIdx + " of " + tnTotal + ") \u2014 " + String(oneTn.name || "").split(" ")[0]); } catch (ePpCur) {}
        safe(function () { if (window.__mlsPullShieldTick) window.__mlsPullShieldTick(); });
        var tnId = String(oneTn.patientId || "");
        var tnGate = tnDayApplicable(tnDay); /* dnf-1.0.0 */
        if (tnGate.future) { oneTn.todayNote = "future-day"; oneTn.todayNoteReason = "future-day"; oneTn.todayNoteSkipped = "future-day"; tnStamp(oneTn, 0, "skipped"); continue; } /* fd-1.0.0 */
        /* tny-1.0.0: TODAY and the slot has not arrived - skip, do not fail. */
        if (tnGate.ok && !tnApptPassed(tnDay, tnRow)) { tnStampNotYet(oneTn, "time"); continue; }
        /* dnrs-1.0.0: this account day already read and saved this note - the
           one chart open that is provably redundant. */
        var tnAlready = tnGate.ok ? dnAlreadyReadToday(tnDay, tnId) : null;
        if (tnAlready) { tnStampAlreadyRead(oneTn, tnAlready.at); tnEmitDayNoteColumn(oneTn); continue; }
        /* dnp2-1.0.0: the pass budget is spent. Every remaining row is handed
           to the background backfill NOW, with an honest code, so Done arrives
           at history time + the budget instead of twenty minutes. */
        if (tnGate.ok && dnPassExhausted()) { tnStampHandedOff(oneTn, tnDay); tnEmitDayNoteColumn(oneTn); continue; }
        var tnP = (tnGate.ok && tnId) ? safe(function () { return findStorePatient(tnId); }, null) : null;
        if (!(vpToday && typeof vpToday.runForPatient === "function" && tnP)) { oneTn.todayNote = false; oneTn.todayNoteReason = tnGate.ok ? "reader-unavailable" : tnGate.reason; tnEmitDayNoteColumn(oneTn); continue; }
        if (todayNoteExtOk === null) {
          /* 2026-07-28 invariant fix: an extension that predates the
             day-scoped reader ignores onlyDate and returns EVERY body -
             exactly what the fast lane promises not to pull. One pong per
             batch decides; the pong version is the only honest source. */
          todayNoteExtOk = await safeAsync(async function () {
            var pg = await bridge("mlsPong", "mlsPing", 3500);
            var m = String((pg && pg.version) || "").match(/^(\d+)\.(\d+)\.(\d+)/);
            if (!m) return false;
            return (Number(m[1]) > 3) || (Number(m[1]) === 3 && (Number(m[2]) > 0 || Number(m[3]) >= 30));
          }, false);
        }
        if (!todayNoteExtOk) { oneTn.todayNote = false; oneTn.todayNoteReason = "extension-predates-scoped-read"; tnEmitDayNoteColumn(oneTn); continue; }
        var tnT0 = Date.now(); /* dnf-1.0.0 */
        var tnProgress = "";
        oneTn.todayNoteAttempts = Number(oneTn.todayNoteAttempts || 0) + 1; /* dnrs-1.0.0: at most ONE per pull */
        try {
          var tnRes = await tnBoundedRead(vpToday, tnP, tnDay); /* dnf-1.0.0 */
          oneTn.todayNote = tnReadOk(tnRes);
          tnProgress = tnProgressCode(oneTn, tnRes); /* dnb2-1.0.0 */
          tnStamp(oneTn, Date.now() - tnT0, oneTn.todayNote ? "read" : "refused");
          if (!oneTn.todayNote) oneTn.todayNoteReason = String((tnRes && tnRes.reason) || "scoped-read-unverified").slice(0, 80);
        } catch (eTn2) { oneTn.todayNote = false; oneTn.todayNoteReason = String((eTn2 && eTn2.message) || eTn2).slice(0, 80); tnProgress = tnProgressCode(oneTn, null); tnStamp(oneTn, Date.now() - tnT0, "refused"); }
        /* tny-1.0.0: an index with no verified encounter for TODAY's date is a
           visit that has not happened yet, not a failed read. */
        if (oneTn.todayNote === false && tnDay === acctTodayKey() && TNY_NO_ENCOUNTER.test(String(oneTn.todayNoteReason || ""))) tnStampNotYet(oneTn, "receipt");
        /* p1-todaynote-deferred-retry-1.0.0: same deferral in the tail pass -
           this pass also runs inside the pull, so it loses the same race.
           dnb2-1.0.0: and only when the attempt made observable progress. */
        if (oneTn.todayNote !== true && oneTn.todayNote !== "not-yet" && tnIsDeferrable(oneTn.todayNoteReason)) {
          if (tnProgress) { oneTn.todayNoteProgress = tnProgress; tnDeferRow(oneTn, tnDay); }
          else safe(function () { oneTn.todayNoteNoProgress = true; receipt.todayNoteNoProgress = Number(receipt.todayNoteNoProgress || 0) + 1; });
        }
        /* qol-1.3 / deliverable 3: the day-note outcome is VISIBLE, but as its
           own column - it can no longer flip a saved history row to failed. */
        tnEmitDayNoteColumn(oneTn);
      }
      } catch (eTodayNotePass) { try { if (receipt) receipt.todayNotePassError = String((eTodayNotePass && eTodayNotePass.message) || eTodayNotePass).slice(0, 120); } catch (eR2) {} }
      /* dnp-1.0.0: the day-note pass is over - the bar may claim completion. */
      try { ppPhase(null); } catch (ePpPh2) {}
      try { ppCurrent("finishing \u2014 recording the day verdict"); } catch (ePpFin) {}
      /* dnrs-1.0.0: the day ledger is written BEFORE this pass (it is the
         pre-sweep write, above), so without this second write the ONLY notes
         it would ever record as read are the inline ones - and the same-day
         re-pull skip would then re-open every chart the TAIL pass had already
         read. todayNoteReadAt merges with what is already there, so writing
         twice adds ids and erases none. Sub-batches never write. */
      if (!sweepDepth) safe(function () {
        tnAggregate();
        var dnLedgerDay = tnBatchDay();
        if (dnLedgerDay) recordHistoryVerdict(dnLedgerDay, receipt, rows.length);
      });
    }
    finalizeVerdict(true);
    /* si-1.9.0 (owner directive 2026-07-22): pulls must COMPLETE during
       active clinic use. A chart under live documentation refuses honestly
       for the length of an edit burst (proven live: the same 1-encounter
       chart failed twice mid-intake, then read expected-1/parsed-1 in 12s
       once the burst passed). Re-sweep those patients automatically at the
       END of the batch — by then the earliest failure is many minutes old.
       Bounded: a sweep never sweeps (depth 1), max 2 passes, instability
       reasons only, >=5 min of the FROZEN batch budget required, and every
       attempt is a full fresh open+verify+read — no identity gate is
       loosened, and a patient still refusing keeps an honest retry entry. */
    /* fdx-1.1.0: find-open-deadline joins the sweepable set. It is a TIMING
       refusal from athena's patient search, never an identity or permission
       refusal, so the same bounded automatic re-read every other timing class
       already earns applies - and "once the batch is idle" is exactly when
       this sweep runs. */
    var SWEEPABLE_REASON = AUTOMATIC_HISTORY_RETRY_REASON;
    /* p1-athena-presence-1.0.0: the moment ANY row blames a missing athena
       tab, ask the lease-free presence verb once. Nothing waits on the answer;
       it only makes the day-end verdict tell the truth about whether athenaOne
       was actually signed out or merely busy rendering. */
    if (!sweepDepth) safe(function () {
      var blamesTab = (receipt.retry || []).some(function (entry) { return /no-athena-tab/.test(String(entry && entry.reason || "")); });
      if (blamesTab) p1PresenceProbe(3500);
    });
    if (!sweepDepth && !__stpStopped) try {   /* stp-2.0.0 */
      receipt.sweepPasses = 0;
      for (var sweepPass = 1; sweepPass <= 3 && !receipt.complete; sweepPass++) {
        var sweepable = receipt.retry.filter(function (entry) { return SWEEPABLE_REASON.test(String(entry && entry.reason || "")); });
        if (!sweepable.length) break;
        if (Date.now() + 240000 >= batchDeadlineAt) {
          /* onheal-1.0.0: name it, count it, and SAY it. The rows below keep
             their real verdict instead of a promise nothing will keep; their
             full-history retry stays in Retry, and (in ON mode) the day's own
             note is handed to the idle catch-up by niSyncFromReceipt. */
          receipt.sweepBudgetExhausted = true;
          receipt.sweepSkippedForTime = sweepable.length;
          safe(function () {
            var skippedIds = {};
            sweepable.forEach(function (entry) { skippedIds[String(entry && entry.patientId || "")] = 1; });
            (receipt.patients || []).forEach(function (fp) {
              if (fp && fp.complete !== true && skippedIds[String(fp.patientId || "")]) fp.recheckSkipped = "out-of-time";
            });
          });
          if (onStatus) safe(function () {
            onStatus("Out of time for the automatic re-check - " + sweepable.length + " chart" + (sweepable.length === 1 ? "" : "s") +
              " stay in Retry, and the idle catch-up will try the day's own note again.", "warn");
          });
          break;
        }
        /* si-1.9.4: lead with the held progress ("14 of 16") so the bar keeps
           its place; with zero finished there is no progress to hold, so the
           count-free wording leaves the bar untouched. */
        if (onStatus) onStatus((rows.length > sweepable.length ? (rows.length - sweepable.length) + " of " + rows.length + " charts finished — re-checking " : "Re-checking ") + sweepable.length + " in-use chart" + (sweepable.length === 1 ? "" : "s") + " (automatic pass " + sweepPass + ")...", "");
        var swept = buildRetryRows(sweepable, batchScopeDay); /* dnd-1.0.0 */
        var sub = null;
        try { sub = await runHistoryBatch(swept.rows, swept.unresolved, onStatus, { depth: 1, deadlineCapAt: batchDeadlineAt, progressBase: Math.max(0, rows.length - swept.rows.length), progressTotal: rows.length, scopeDay: batchScopeDay }); } catch (eSweep) { break; }
        receipt.sweepPasses = sweepPass;
        /* dnrs-1.0.0: a SWEEP is a whole sub-batch with its own receipt, so its
           chart opens were invisible to the outer count - measured here as
           chartCalls 8 against chartOpensHistory 2. "How many charts did this
           pull open" has to mean the pull, sweeps included. */
        safe(function () {
          if (!sub) return;
          receipt.chartOpensHistory = Number(receipt.chartOpensHistory || 0) + Number(sub.chartOpensHistory || 0);
          receipt.chartOpensDayNote = Number(receipt.chartOpensDayNote || 0) + Number(sub.chartOpensDayNote || 0);
        });
        if (!sub || !Array.isArray(sub.patients)) break;
        var recoveredIds = {};
        sub.patients.forEach(function (sp) {
          if (!sp) return;
          var pid = String(sp.patientId || "");
          if (!pid) return;
          if (sp.complete === true) { sp.sweepRecovered = sweepPass; recoveredIds[pid] = true; }
          var replaced = false;
          for (var ri = 0; ri < receipt.patients.length; ri++) {
            if (String(receipt.patients[ri] && receipt.patients[ri].patientId || "") === pid) { if (!sp.name && receipt.patients[ri].name) sp.name = receipt.patients[ri].name; /* fa-1.0 (supervisor 2026-08-09): the re-check that resolves a row must not destroy the evidence of its first attempt - first-attempt convergence is the bar and its receipts were being overwritten by the cure. Bounded compact copy. */ if (!sp.firstAttempt && receipt.patients[ri].complete !== true) { var faP = receipt.patients[ri]; sp.firstAttempt = { reason: String(faP.reason || "").slice(0, 120), visitsReadReceipt: faP.visitsReadReceipt || null, hist: faP.visitsFailedHistogram || null, axEntry: String(faP.axEntry || ""), hydStreak: Number(faP.hydStreak || 0) }; } receipt.patients[ri] = sp; replaced = true; break; }
          }
          /* deferred-after-timeout patients never entered receipt.patients in
             the main loop; adopting their swept entry must also count them
             processed so the verdict arithmetic stays honest. */
          if (!replaced) { receipt.patients.push(sp); receipt.processed++; }
        });
        var sweptIds = {};
        sweepable.forEach(function (entry) { sweptIds[String(entry && entry.patientId || "")] = true; });
        var freshRetry = receipt.retry.filter(function (entry) { return !sweptIds[String(entry && entry.patientId || "")]; });
        (Array.isArray(sub.retry) ? sub.retry : []).forEach(function (entry) {
          var pid = String(entry && entry.patientId || "");
          if (!pid || recoveredIds[pid]) return;
          freshRetry.push(entry);
        });
        receipt.retry = freshRetry;
        finalizeVerdict(true);
      }
    } finally {
      /* b744 #36: the OUTER batch closes the progress reporter exactly once,
         after every automatic sweep pass — the panel now lives continuously
         from first row to true finish (no teardown at sweep boundaries, no
         elapsed reset, the pts pull shield never drops mid-pull). */
      finalizeVerdict(false);
      safe(ppEnd);
    }
    /* onheal-1.0.0: the STOP path never reached that finally - the try/finally
       above is the BODY of `if (!sweepDepth && !__stpStopped)`, so after a Stop
       neither the terminal settle nor ppEnd ran: every sweepable row kept the
       "queued for automatic re-check" label forever and the DONE card never
       froze its clock (s.running stayed true). Stop now gets its own terminal
       settle. It deliberately does NOT set receipt.sweepPasses - no sweep ran,
       and tests/1p-pull-stop-and-find-census-runtime pins that it stays unset. */
    if (!sweepDepth && __stpStopped) {
      finalizeVerdict(false);
      safe(ppEnd);
    }
    /* ===== sicap-1.0.0 (settle the facts captures) ===================
       The capture verb carries NO patient argument anywhere in its chain
       (siCaptureFacts -> content.js -> background.js): it reads whatever chart
       the athenaOne tab is showing. Re-DISPATCHING it after the loop would
       therefore read the LAST row's banner for every queued target and the
       two-token name guard would refuse all but that one - measured, and a
       content REGRESSION. So the dispatch stays on the row whose verified chart
       is still the active surface, and only the SETTLE is deferred to here:
       the drain waits (bounded) for each capture and the BATCH RECEIPT reports
       the verdict census; the day ledger's row verdicts were already written
       by recordHistoryVerdict and carry no capture field. The promise handle
       is non-enumerable so it can never reach a receipt or the day ledger.
       A sub-batch never drains; the outer batch owns it (and by then it has
       already absorbed every swept row's entry). */
    if (!sweepDepth) {
      var sicapCounts = {}, sicapRows = receipt.patients || [];
      for (var sci = 0; sci < sicapRows.length; sci++) {
        var sicOne = sicapRows[sci] || {}, sicP = sicOne.__factsCaptureP;
        if (!sicP || !isFn(sicP.then)) continue;
        /* sicap-1.0.1 (refuter): the settle promise's only internal bound is a
           bare timer that a hidden tab can stretch - the drain itself now
           carries a hard 10s ceiling per row so a stuck capture can only ever
           delay the receipt tail, never wedge it. */
        try { await Promise.race([sicP, new Promise(function (sicR) { setTimeout(sicR, 10000); })]); } catch (eSicap) {}
        try { delete sicOne.__factsCaptureP; } catch (eSicapDel) {}
        var sicV = String(sicOne.factsCapture || "queued").slice(0, 24);
        sicapCounts[sicV] = (sicapCounts[sicV] || 0) + 1;
      }
      if (Object.keys(sicapCounts).length) receipt.factsCaptureVerdicts = sicapCounts;
    }
    /* ===== end sicap-1.0.0 ========================================== */
    /* ===== cap-1.0.0 (fill the pending summaries) =====
       Two lanes, both athena-free, so neither can cost a chart open or fight
       the lease:
        (1) ONE immediate pass right here over every pending capture belonging
            to this batch's rows - which is also the "again on the next pull"
            leg, because a capture left pending by an earlier pull is still
            pending in the store when the next pull's batch reaches this line;
        (2) a bounded background retry (setTimeout only - rAF never fires in a
            hidden tab), <= 3 rounds with backoff, for whatever is still
            pending after (1).
       A sub-batch (sweep/retry round) does neither: the outer batch owns it. */
    if (!sweepDepth) {
      var capPend = capPendingPatientIds(rows);
      if (capPend.length) {
        receipt.summaryFillAttempted = capPend.length;
        var capFilled = 0;
        for (var cfi = 0; cfi < capPend.length; cfi++) {
          var capOne = await capResummarizeStored(capPend[cfi], 120000).catch(function () { return { ok: false }; });
          if (capOne && capOne.ok) {
            capFilled++;
            safe(function () {
              var pid = String(capPend[cfi]);
              for (var ri = 0; ri < receipt.patients.length; ri++) {
                if (String(receipt.patients[ri] && receipt.patients[ri].patientId || "") === pid) {
                  receipt.patients[ri].summaryPending = false;
                  receipt.patients[ri].summaryFilled = true;
                  break;
                }
              }
            });
          }
        }
        receipt.summaryFilled = capFilled;
        finalizeVerdict();
        var capStillPending = capPendingPatientIds(rows);
        receipt.summaryBackgroundArmed = capArmBackgroundRetry(capStillPending);
      }
    }
    /* ===== end cap-1.0.0 (fill the pending summaries) ===== */
    safe(function () { if (isFn(window.renderHistory)) window.renderHistory(); });
    safe(function () { if (isFn(window.renderProfile)) window.renderProfile(); });
    safe(function () { if (isFn(window.loadPatients)) window.loadPatients(); });
    return receipt;
  }

  /* Manual continuation for an honest partial receipt. It rebuilds targets
     only from immutable local patient ids in that receipt; names alone never
     enter the reader. This is deliberately not called automatically after a
     timeout because the prior injected operation may finish late. */
  function releaseManagedAthenaWorkspace() {
    /* The quiet-pull lease is owned by the whole managed workflow, not by one
       individual background handler. Signal the extension at every terminal
       managed outcome so it restores Athena's original window immediately.
       In quiet-pull mode there is no focus debt, so this releases the work
       strip without activating or yanking either tab. */
    safe(function () {
      var targetOrigin = safe(function () { return String(window.location && window.location.origin || ""); }, "");
      window.postMessage({ source: "mls-app", type: "mlsAppFocusMlsTab", from: "mls-managed-pull" }, /^https?:\/\//i.test(targetOrigin) ? targetOrigin : "*");
    });
  }

  /* b346: si pulls and the EZ3 staff/month engine share ONE Athena tab but used
     to hold DIFFERENT locks (Web Lock here, window.__mlsSchedulePullLease in the
     engine) — a month pull and a day pull could interleave goto-date/reads and
     each would fail with "athena showed X instead of Y". si now (a) refuses to
     start while a fresh foreign page lease exists and (b) claims that same
     lease slot while running, so the engine's claimPullLease refuses in the
     other direction. Cross-tab exclusion stays on the Web Lock. */
  var SI_LEASE_ID = "mls-si-managed-" + Math.random().toString(36).slice(2, 8);
  var siAthenaOwnerToken = "";
  function foreignPullLease() {
    var l = safe(function () { return window.__mlsSchedulePullLease; }, null);
    if (!l || l.id === SI_LEASE_ID) return null;
    if (Date.now() - Number(l.at || 0) > 180000) return null;
    return l;
  }
  function claimSiLease() {
    safe(function () { window.__mlsSchedulePullLease = { id: SI_LEASE_ID, kind: "si-pull", at: Date.now() }; });
  }
  function releaseSiLease() {
    if (typeof monthOwnerToken !== "undefined" && monthOwnerToken) return;
    safe(function () { var l = window.__mlsSchedulePullLease; if (l && l.id === SI_LEASE_ID) delete window.__mlsSchedulePullLease; });
  }
  /* hs-1.0 (live 2026-08-12, b1017 proof-1 caveat): "resolved" is NOT
     "succeeded". The managed wrapper stamped __mlsPullLastOutcome ok:true on
     ANY resolve, so the named terminal failure the owner watched live ("no
     readable appointment rows ... Nothing was imported", roster
     no-provider-headers, zero imports) was recorded ok:true on the machine
     surface - a consumer reading only that surface calls the failure a
     success (the progress stage read it back as "Pull finished."). The stamp
     now carries the RUN'S OWN verdict - the same receipt lastPullResult
     stores and the visible narration speaks. A settled value without a
     verdict field (history-retry receipts) is judged by its own completeness
     contract: complete AND zero failures. PHI-free by construction: verdict
     booleans, reason/gate tokens, the narration string every visible surface
     already shows, and numeric counts only. */
  function honestPullOutcome(value) {
    var out = { ok: true, at: Date.now() };
    if (!value || typeof value !== "object") return out;
    if (typeof value.ok === "boolean") out.ok = value.ok === true;
    else if (typeof value.complete === "boolean") out.ok = value.complete === true && !(Number(value.failures || 0) > 0);
    else return out;
    if (typeof value.complete === "boolean") out.complete = value.complete === true;
    if (value.reason !== undefined && value.reason !== null && String(value.reason) !== "") out.reason = String(value.reason).slice(0, 80);
    if (!out.ok) {
      if (value.gate) out.gate = String(value.gate).slice(0, 80);
      var errText = value.error || value.narration || "";
      if (errText) out.error = String(errText).slice(0, 200);
      var counts = {}, names = ["created", "repaired", "skipped", "failed", "failures", "requested", "processed"], any = false;
      for (var ci = 0; ci < names.length; ci++) {
        var cv = value[names[ci]];
        if (typeof cv === "number" && isFinite(cv)) { counts[names[ci]] = cv; any = true; }
      }
      if (any) out.counts = counts;
      /* nvd-1.0.0 (pull matrix 2026-08-26): a nav-failed outcome said only
         "retry the pull" while the engine's bounded navDiag (home-click
         result, continue-interstitial, weekstrip attempts, tab counts) was
         DISCARDED by this whitelist - the first reproduced matrix failure
         was undiagnosable from its own stored receipt. Carry it through;
         closed shape, no page text, no PHI. */
      if (value.navDiag && typeof value.navDiag === "object") {
        try { out.navDiag = JSON.parse(JSON.stringify(value.navDiag)); } catch (eDg) {}
      }
      /* nvd-1.0.1: a calendar-partial outcome said failed:8 and nothing else -
         the engine's PHI-free reason-code counts (failureReasons, mapping
         reasons) were built for exactly this and then dropped here. Live run 2
         of the matrix was undiagnosable from its stored receipt again. */
      if (value.calendarReceipt && typeof value.calendarReceipt === "object") {
        try {
          var cr = value.calendarReceipt;
          out.calendarDiag = {
            complete: cr.complete === true,
            failed: Number(cr.failed || 0),
            unresolvedMappings: Number(cr.unresolvedMappings || 0),
            failureReasons: JSON.parse(JSON.stringify(cr.failureReasons || {})),
            mappingReasons: JSON.parse(JSON.stringify(cr.mappingReasons || {}))
          };
        } catch (eCr) {}
      }
      /* nvd-1.0.2: the reader's attribution-coverage census (which rows bound
         to which provider header, how many stayed unattributed/foreign) is the
         exact diagnosis for every second-provider calendar failure and for
         provider-less rows at rest - and it was dropped here too. */
      if (value.providerRosterReceipt && value.providerRosterReceipt.attributionCoverage) {
        try { out.attributionCoverage = JSON.parse(JSON.stringify(value.providerRosterReceipt.attributionCoverage)); } catch (eAc) {}
      }
      /* nvd-1.0.3: a stable 5-chart cohort failed the main walk, the
         second-read pass, AND both capped retry rounds (2026-08-26) - and
         the stored outcome said only history-partial because the retry
         entries' per-chart reason codes were dropped here. Summarize them as
         bounded reason counts; codes only, never names. */
      if (value.historyReceipt && Array.isArray(value.historyReceipt.retry) && value.historyReceipt.retry.length) {
        try {
          var hdCounts = {};
          value.historyReceipt.retry.forEach(function (entry) {
            var hdReason = String(entry && entry.reason || "unspecified").slice(0, 60);
            hdCounts[hdReason] = Number(hdCounts[hdReason] || 0) + 1;
          });
          out.historyRetryReasons = hdCounts;
        } catch (eHd) {}
      }
    }
    /* the matrix must attribute every run to its visit-notes mode; the engine
       already stamps it and this whitelist dropped it. */
    if (value.visitNotesMode !== undefined && value.visitNotesMode !== null && String(value.visitNotesMode) !== "") out.visitNotesMode = String(value.visitNotesMode).slice(0, 24);
    /* pvd-1.0.0: the closed per-patient verdict counts ride the machine
       outcome in BOTH verdict directions - succeeded matters on a good day
       too. Counts only (PHI-free); the per-patient list stays on the full
       receipt. */
    if (value.historyReceipt && value.historyReceipt.verdicts) {
      try {
        var vd = value.historyReceipt.verdicts;
        out.historyVerdicts = { requested: Number(vd.requested || 0), succeeded: Number(vd.succeeded || 0), failed: Number(vd.failed || 0), omitted: Number(vd.omitted || 0), notAttempted: Number(vd.notAttempted || 0), unaccounted: Number(vd.unaccounted || 0), conflicts: Number(vd.conflicts || 0), closed: vd.closed === true };
      } catch (eVd) {}
    }
    /* spd-1.0.0 (reply 24: speed LAST, measurement first): the settle's
       per-stage cost breakdown rides the machine outcome in BOTH verdict
       directions, so every matrix run names its slow step with numbers at
       rest instead of needing a live profiler. Milliseconds/counts only. */
    if (value.historyReceipt && value.historyReceipt.costBreakdown) {
      try {
        var cb = value.historyReceipt.costBreakdown;
        var cbNum = function (v) { v = Number(v); return isFinite(v) ? v : 0; }; /* a non-numeric stage time is 0, never NaN */
        out.costBreakdown = {
          chartMs: cbNum(cb.chartMs), parseSaveMs: cbNum(cb.parseSaveMs),
          visitsMs: cbNum(cb.visitsMs), visitSaveMs: cbNum(cb.visitSaveMs),
          todayNoteMs: cbNum(cb.todayNoteMs), rows: cbNum(cb.rows),
          maxChartMs: cbNum(cb.maxChartMs), perRowChartMs: cbNum(cb.perRowChartMs),
          perRowTodayNoteMs: cbNum(cb.perRowTodayNoteMs), skippedVerifiedToday: cbNum(cb.skippedVerifiedToday)
        };
      } catch (eCb) {}
    }
    return out;
  }
  /* ===== p1-todaynote-deferred-retry-1.0.0 =====
     Owner report 2026-08-16 (day 2026-08-21, ext 3.0.61): schedule 6/6, roster
     complete, history 6/6 processed - and todayNoteFailures:6, every one of
     them "pull-in-flight: another Athena read or schedule pull is active.
     Nothing started." The today-note reads were launched WHILE the day pull
     still held the Athena lease. p1-lease-loan-1.0.0 removed the cause; this
     removes the CONSEQUENCE, which the loan commit left open: the fuse only
     recognised timeout-class reasons, so a pull-in-flight refusal was
     attempt-once and terminal for all six rows.

     pull-in-flight is now a DEFERRED class, not a failure: the row is queued
     and re-run exactly ONCE after the pull's own completion, when the lease it
     lost to is free. Bounded and setTimeout-only (rAF never fires in a hidden
     tab): one attempt per row, at most TN_DEFER_LEASE_WAITS re-arms while the
     lease is still held, and the queue is dropped when it cannot be drained.
     Nothing here claims or releases a lease, and no clinical text is written
     that the normal reader would not have written. */
  var TN_DEFER_DELAY_MS = 1200;
  var TN_DEFER_LEASE_WAITS = 5;
  /* ===== dnbf-1.0.0 (the backfill re-checks presence before it blames the doctor) =====
     MEASURED 2026-08-17 on the owner's re-pull: the footer read
       "Visit backfill: <name> - open-failed: Open your signed-in athenaOne in
        another tab, then try again"
     WHILE THREE signed-in athenaOne tabs were open. p1-athena-presence-1.0.0
     already proved the cure for the pull's NAV leg - a missed 1.2-1.5 s ping
     is a busy renderer, not an absent athena - and the background note
     backfill never got it.

     Three things change here, all bounded:
      (a) a no-athena-tab-class refusal asks the LEASE-FREE presence verb
          (mlsAthenaPresence) before it stands. If athena is proven present the
          verdict is FALSE and the row is retried after a backoff; only a
          presence answer of "absent" lets the sign-in wording stand.
      (b) transient refusals get a SECOND attempt with backoff (2 s, 6 s), so
          the round is at most TN_BACKFILL_ROUNDS deep and at most
          TN_BACKFILL_ATTEMPTS per row - never a busy loop.
      (c) the receipt is a CLOSED VOCABULARY of reason codes plus counts. No
          name reaches the queue at all (tnDeferRow stopped carrying one), so
          a surface can render this receipt verbatim and stay PHI-free. */
  var TN_BACKFILL_ROUNDS = 2;
  var TN_BACKFILL_ATTEMPTS = 2;
  var TN_BACKFILL_WAITS = [2000, 6000];
  var TN_NO_TAB_REASON = /no-athena-tab|no athenaone tab|open your signed-in athenaone|open-failed|not responding|unreachable/i;
  /* the CLOSED code vocabulary. Anything unrecognised becomes "other" - a
     receipt can therefore never carry a free-text reader message. */
  var TN_REASON_CODES = ["pass-budget-exhausted", "no-athena-tab", "pull-in-flight", "deadline",
    "surface-race", "no-encounter", "safety-stop", "extension-too-old", "reader-unavailable", "other", "unknown"];
  function tnReasonCode(reason) {
    var r = String(reason || "");
    if (!r) return "unknown";
    if (/day-note-pass-budget-exhausted/i.test(r)) return "pass-budget-exhausted";
    if (/pull-in-flight/i.test(r)) return "pull-in-flight";
    if (TN_NO_TAB_REASON.test(r)) return "no-athena-tab";
    if (/extension-predates-scoped-read/i.test(r)) return "extension-too-old";
    if (/reader-unavailable/i.test(r)) return "reader-unavailable";
    if (/encounter index without verified full detail|no-encounter-for-date|encounter-index-empty|no-visits-for-date/i.test(r)) return "no-encounter";
    if (/safety stop|identifies a different patient|cannot all be verified/i.test(r)) return "safety-stop";
    if (/different patient/i.test(r)) return "surface-race";
    if (/deadline|timed out|timeout/i.test(r)) return "deadline";
    return "other";
  }
  function tnIsNoTabReason(reason) { return TN_NO_TAB_REASON.test(String(reason || "")); }
  /* ===== dnb2-1.0.0 (ONE retry, and only after observable progress) ======
     Owner deliverable 1. dnd2-1.0.0 made every TIMING refusal deferrable,
     which is right, but it made them ALL deferrable: a row whose chart never
     opened bought a second full-length wait on no evidence at all, and on
     the measured machine that is where the minutes went. A retry is only
     worth the doctor's clock when the FIRST attempt got somewhere:
       (a) chart-open    - this pull's own verified chart read for this row
                           landed moments earlier, so the tab really was on
                           this patient; or
       (b) encounter-index - the reader came back holding an index/receipt,
                           so it reached the encounter surface.
     Anything else is deferred ONLY when the pass budget handed it over
     (tnStampHandedOff), which is a queue decision, not a retry bet.
     Codes only - no name, DOB or MRN can reach these strings. */
  function tnProgressCode(entry, res) {
    if (entry && entry.dayNoteChartOpen === true) return "chart-open";
    var r = (res && typeof res === "object") ? res : null;
    if (r) {
      if (Number(r.expected || 0) > 0 || Number(r.indexCount || 0) > 0 || Number(r.visitCount || 0) > 0) return "encounter-index";
      var rec = (r.receipt && typeof r.receipt === "object") ? r.receipt : null;
      if (rec && (Number(rec.expected || 0) > 0 || Number(rec.parsed || 0) > 0 || rec.indexComplete === true)) return "encounter-index";
    }
    return "";
  }
  /* the backfill's PHI-free receipt. Counts and codes only, by construction. */
  var _tnBackfill = { queued: 0, attempted: 0, recovered: 0, remaining: 0, rounds: 0,
    presenceChecks: 0, presenceVerified: 0, presenceAbsent: 0, presenceUnknown: 0,
    retriedAfterPresence: 0, backoffWaits: 0, codes: {}, at: 0, reason: "" };
  function tnBackfillReceipt() {
    var codes = {};
    for (var k in _tnBackfill.codes) if (Object.prototype.hasOwnProperty.call(_tnBackfill.codes, k)) codes[k] = Number(_tnBackfill.codes[k] || 0);
    return { queued: Number(_tnBackfill.queued || 0), attempted: Number(_tnBackfill.attempted || 0),
      recovered: Number(_tnBackfill.recovered || 0), remaining: Number(_tnBackfill.remaining || 0),
      rounds: Number(_tnBackfill.rounds || 0), presenceChecks: Number(_tnBackfill.presenceChecks || 0),
      presenceVerified: Number(_tnBackfill.presenceVerified || 0), presenceAbsent: Number(_tnBackfill.presenceAbsent || 0),
      presenceUnknown: Number(_tnBackfill.presenceUnknown || 0), retriedAfterPresence: Number(_tnBackfill.retriedAfterPresence || 0),
      backoffWaits: Number(_tnBackfill.backoffWaits || 0), codes: codes,
      reason: String(_tnBackfill.reason || "").slice(0, 40), at: Number(_tnBackfill.at || 0) };
  }
  function tnBackfillCount(code) {
    var c = String(code || "unknown");
    if (TN_REASON_CODES.indexOf(c) < 0) c = "other";
    _tnBackfill.codes[c] = Number(_tnBackfill.codes[c] || 0) + 1;
  }
  /* ===== end dnbf-1.0.0 (state) ===== */
  var _tnDefer = { queue: [], timer: null, running: false, waits: 0 };
  /* ===== dnd2-1.0.0 (a TIMING refusal earns the deferred round) ============
     MEASURED 2026-08-17 (owner's /cloned pull, 24 patients, occluded athena):
     10 of 24 day-notes ended `pulled-day-note-deadline-exceeded` or "the
     Athena patient open reached its own deadline" — and NONE of them entered
     the deferred round, because this predicate only ever matched
     `pull-in-flight`. The doctor was told "the note for the pulled day could
     not be read" for rows that had never been retried once.
     Only TIMING and SURFACE-RACE classes are added. A refusal that is
     deterministic (an identity safety stop, the reader's own encounter-cap
     verdict, an extension too old) is NOT retryable and stays exactly where it
     was: retrying it would burn the doctor's time to re-fail. */
  var TN_DEFERRABLE_REASON = new RegExp([
    "pull-in-flight",
    "pulled-day-note-deadline-exceeded",
    "reached its own deadline",
    "deadline-exceeded",
    "\\btimed? ?out\\b|\\btimeout\\b",
    "is still showing a different patient",
    "not responding|unreachable",
    /* dnbf-1.0.0: a no-athena-tab refusal is the class p1-athena-presence-1.0.0
       already proved transient for the NAV leg - a missed 1.2-1.5 s ping while
       the tab renders, not an absent athena. It has to reach the backfill for
       the presence re-check to have anything to correct. SWEEPABLE_REASON has
       treated it this way for the history leg since fdx-1.1.0. */
    "no-athena-tab|no athenaone tab|open-failed"
  ].join("|"), "i");
  /* the deterministic refusals that must NEVER be re-driven */
  var TN_NOT_DEFERRABLE_REASON = /(safety stop|cannot all be verified|encounter index without verified full detail|extension-predates-scoped-read|identity|different patient than this read expects and could not)/i;
  function tnIsDeferrable(reason) {
    var r = String(reason || "");
    if (!r) return false;
    if (TN_NOT_DEFERRABLE_REASON.test(r) && !/reached its own deadline|deadline-exceeded/i.test(r)) return false;
    return TN_DEFERRABLE_REASON.test(r);
  }
  function tnAthenaFree() {
    if (pullRunning) return false;
    var mgr = safe(function () { return window.__mlsP1AthenaReadLease; }, null);
    if (mgr && isFn(mgr.busy)) return !safe(function () { return !!mgr.busy(); }, true);
    return !safe(function () { return !!window.__mlsSchedulePullLease; }, false);
  }
  function tnQueueDeferred(item) {
    if (!item || !item.patientId || !isFn(item.attempt)) return false;
    for (var i = 0; i < _tnDefer.queue.length; i++) {
      if (_tnDefer.queue[i].patientId === String(item.patientId) && _tnDefer.queue[i].day === String(item.day || "")) return false;
    }
    /* dnbf-1.0.0: no NAME on the queue - the backfill's receipt is codes and
       counts, and the cheapest guarantee is that the name is never present. */
    _tnDefer.queue.push({ patientId: String(item.patientId), day: String(item.day || ""),
      code: String(item.code || "unknown"),
      reasonOf: isFn(item.reasonOf) ? item.reasonOf : null,
      retrying: isFn(item.retrying) ? item.retrying : null,
      attempt: item.attempt, settleDay: isFn(item.settleDay) ? item.settleDay : null,
      disown: isFn(item.disown) ? item.disown : null, /* nih-1.0.0 */ attempts: 0 });
    safe(function () { _tnBackfill.queued = Number(_tnBackfill.queued || 0) + 1; _tnBackfill.at = Date.now(); });
    return true;
  }
  /* stp-2.0.0: STOP drops the deferred today-note queue and disarms its timer.
     Every dropped row keeps an honest reason on the receipt via settleDay, so
     a stopped day never reports the notes as read and never re-drives Athena
     after the doctor pressed Stop. */
  function tnDropDeferredQueue(reason) {
    if (_tnDefer.timer != null) { safe(function () { clearTimeout(_tnDefer.timer); }); _tnDefer.timer = null; }
    _tnDefer.waits = 0;
    if (!_tnDefer.queue.length) return 0;
    var dropped = _tnDefer.queue.splice(0, _tnDefer.queue.length);
    dropped.forEach(function (d) { safe(function () { if (d.disown) d.disown(); }); }); /* nih-1.0.0: a dropped row is adoptable, never stranded (the stop-path sync guard still refuses enqueue) */
    var seen = [];
    dropped.forEach(function (d) { if (d.settleDay && seen.indexOf(d.settleDay) < 0) seen.push(d.settleDay); });
    seen.forEach(function (fn) { safe(function () { fn({ attempted: 0, recovered: 0, remaining: dropped.length, reason: String(reason || "stopped-by-user") }); }); });
    return dropped.length;
  }
  function tnScheduleDeferredRound() {
    /* stp-2.0.0: never arm a round the doctor already stopped. */
    if (safe(function () { return window.__mlsPullStopRequested === true; }, false)) { tnDropDeferredQueue("stopped-by-user"); return false; }
    if (!_tnDefer.queue.length || _tnDefer.timer != null || _tnDefer.running) return false;
    _tnDefer.timer = setTimeout(function () { _tnDefer.timer = null; safe(runDeferredTodayNoteRound); }, TN_DEFER_DELAY_MS);
    return true;
  }
  function runDeferredTodayNoteRound() {
    if (_tnDefer.running || !_tnDefer.queue.length) return Promise.resolve(null);
    if (!tnAthenaFree()) {
      /* still held: re-arm a BOUNDED number of times, never a busy loop. */
      if (_tnDefer.waits >= TN_DEFER_LEASE_WAITS) {
        var dropped = _tnDefer.queue.splice(0, _tnDefer.queue.length);
        _tnDefer.waits = 0;
        dropped.forEach(function (d) { safe(function () { if (d.disown) d.disown(); }); }); /* nih-1.0.0: release before settle so the sync can adopt */
        var seenDrop = [];
        dropped.forEach(function (d) { if (d.settleDay && seenDrop.indexOf(d.settleDay) < 0) seenDrop.push(d.settleDay); });
        seenDrop.forEach(function (fn) { safe(function () { fn({ attempted: 0, recovered: 0, remaining: dropped.length, reason: "lease-still-held" }); }); });
        return Promise.resolve({ attempted: 0, recovered: 0, dropped: dropped.length, reason: "lease-still-held" });
      }
      _tnDefer.waits++;
      _tnDefer.timer = setTimeout(function () { _tnDefer.timer = null; safe(runDeferredTodayNoteRound); }, TN_DEFER_DELAY_MS);
      return Promise.resolve(null);
    }
    _tnDefer.waits = 0;
    _tnDefer.running = true;
    var batch = _tnDefer.queue.splice(0, _tnDefer.queue.length);
    var recovered = 0, attempted = 0;
    /* ===== dnbf-1.0.0 (the round: presence re-check + bounded backoff) ======
       One row's turn. It runs its attempt; if the refusal is a no-athena-tab
       class the LEASE-FREE presence verb decides whether that verdict is even
       true, and a proven-present athena earns a backoff retry instead of the
       "open your signed-in athenaOne" advice the owner watched be false. */
    function tnWait(ms) {
      return new Promise(function (res) {
        safe(function () { _tnBackfill.backoffWaits = Number(_tnBackfill.backoffWaits || 0) + 1; });
        setTimeout(res, Number(ms) > 0 ? Number(ms) : 0);
      });
    }
    function tnRowTurn(item, round) {
      if (item.attempts >= TN_BACKFILL_ATTEMPTS) return Promise.resolve(false);
      item.attempts++;
      attempted++;
      safe(function () { _tnBackfill.attempted = Number(_tnBackfill.attempted || 0) + 1; });
      return Promise.resolve().then(function () { return item.attempt(); }).then(function (ok) {
        if (ok === true) {
          recovered++;
          safe(function () { _tnBackfill.recovered = Number(_tnBackfill.recovered || 0) + 1; });
          return true;
        }
        var reason = safe(function () { return item.reasonOf ? String(item.reasonOf() || "") : ""; }, "");
        var code = tnReasonCode(reason);
        item.code = code;
        safe(function () { tnBackfillCount(code); });
        /* the retry decision. Only a TRANSIENT class earns another turn, and a
           no-athena-tab class must first be DISPROVED by the presence verb. */
        if (item.attempts >= TN_BACKFILL_ATTEMPTS || round >= TN_BACKFILL_ROUNDS) return false;
        if (tnIsNoTabReason(reason)) {
          safe(function () { _tnBackfill.presenceChecks = Number(_tnBackfill.presenceChecks || 0) + 1; });
          return p1PresenceProbe(3500).then(function (presence) {
            var open = !!(presence && presence.athenaOpen === true);
            var known = !!(presence && typeof presence === "object");
            if (!known) { safe(function () { _tnBackfill.presenceUnknown = Number(_tnBackfill.presenceUnknown || 0) + 1; }); return false; }
            if (!open) { safe(function () { _tnBackfill.presenceAbsent = Number(_tnBackfill.presenceAbsent || 0) + 1; }); return false; }
            /* THE FALSE FOOTER: athena is there. Retry, do not accuse. */
            safe(function () {
              _tnBackfill.presenceVerified = Number(_tnBackfill.presenceVerified || 0) + 1;
              _tnBackfill.retriedAfterPresence = Number(_tnBackfill.retriedAfterPresence || 0) + 1;
            });
            safe(function () { if (item.retrying) item.retrying(); });
            return tnWait(TN_BACKFILL_WAITS[Math.min(item.attempts - 1, TN_BACKFILL_WAITS.length - 1)])
              .then(function () { return tnRowTurn(item, round + 1); });
          }, function () { return false; });
        }
        if (!tnIsDeferrable(reason)) return false;
        safe(function () { if (item.retrying) item.retrying(); });
        return tnWait(TN_BACKFILL_WAITS[Math.min(item.attempts - 1, TN_BACKFILL_WAITS.length - 1)])
          .then(function () { return tnRowTurn(item, round + 1); });
      }, function () { return false; });
    }
    var chain = Promise.resolve();
    batch.forEach(function (item) {
      chain = chain.then(function () { return tnRowTurn(item, 1); });
    });
    return chain.then(function () {
      var settled = [];
      batch.forEach(function (d) { if (d.settleDay && settled.indexOf(d.settleDay) < 0) settled.push(d.settleDay); });
      /* dnbf-1.0.0: `attempted` counts ATTEMPTS (a transient refusal now earns
         one backoff retry), `rows` counts ROWS. Conflating them is how a
         receipt starts reporting more rows than the day has. */
      var summary = { rows: batch.length, attempted: attempted, recovered: recovered,
        remaining: batch.length - recovered, reason: "deferred-round" };
      safe(function () {
        _tnBackfill.rounds = Number(_tnBackfill.rounds || 0) + 1;
        _tnBackfill.remaining = Math.max(0, Number(_tnBackfill.queued || 0) - Number(_tnBackfill.recovered || 0));
        _tnBackfill.reason = "deferred-round";
        _tnBackfill.at = Date.now();
      });
      summary.backfill = tnBackfillReceipt();
      settled.forEach(function (fn) { safe(function () { fn(summary); }); });
      _tnDefer.running = false;
      return summary;
    }, function () { _tnDefer.running = false; return null; });
  }
  /* ===== end p1-todaynote-deferred-retry-1.0.0 ===== */
  /* ===== notes-idle-1.0.0 (the LEFTOVER visit notes fill in quietly) ========
     OWNER, 2026-08-18: "I want it to just do histories like it's doing and then
     when it's done and says done, secretly in the background it is going to get
     the day visit notes. But if the person goes to do something it will PAUSE
     the visit notes and then restart and get them all in background when idle."
     Re-scoped the same day, after the inline leg was measured working:
     "wait it worked so make sure not to jump me to athena but if u have a fix
     that's fast no need for background pulls."

     SO THIS IS THE LEFTOVER PATH, NOT A REPLACEMENT. The pull's own day-note
     leg is untouched: it still reads inside the pass, under dnp2-1.0.0's
     budget, and dnbf-1.0.0's immediate deferred round still gets its two
     bounded attempts the moment the pull releases the lease. What was missing
     is what happens to a row AFTER all of that has been spent: it was simply
     reported "could not be read" and forgotten, forever, until the doctor ran
     another pull. Those rows now land in ONE persistent queue that drains
     itself when the doctor is not using the machine.

     THERE IS NO THIRD QUEUE. Exactly three things can drive Athena from this
     app and each one refuses while another is driving:
       _tnDefer                (this file)  the IMMEDIATE round, 2 attempts,
                                            in-memory, owned by the pull.
       notes-idle (here)                    the PERSISTENT leftover, idle-gated.
       __mlsVisitsBackfill     (b121 pack)  whole visit LISTS, not day notes.
     notes-idle refuses while _tnDefer still owns rows, refuses while the b121
     backfill is running, and b121's own anyPullRunning() was taught to see
     notes-idle (cloned-feat_mls_b121_pack.js) - both directions, so neither can
     open a chart the other is reading.

     IT NEVER JUMPS THE DOCTOR TO ATHENA. Nothing in this block activates,
     focuses or navigates a tab. The ONLY two things it posts are the
     lease-free presence probe (mlsAthenaPresence) and the ordinary scoped read
     the pull itself uses (vp.runForPatient with onlyDate). A hidden athenaOne
     that refuses is a REFUSAL WITH A CODE, retried later - never a reason to
     bring a window forward.

     THE GATE IS FAIL-CLOSED. Read starts only when every one of these is true:
     no user input in this tab for NI_IDLE_MS, no pull running here or in
     another tab, the managed Web Lock is free, no recording, no op-note
     draft-all, no Athena review sheet open, no other engine on Athena, and
     presence proves athenaOne is alive. Any user input flips the state to
     `paused` on the very next tick; a read already in flight is NOT killed
     (it has its own absolute deadline and killing it would lose the work),
     but no further read starts until the doctor has been idle again.

     THE CLOCK IS A WORKER TIMER. Main-thread timers freeze in a hidden tab, and
     "in the background while you work" is exactly the hidden-tab case. Same
     pattern as p1-phone-sync-1.0.0, with setInterval as the fallback where
     Worker construction is refused. A hidden tab is still IDLE - visibility is
     deliberately not part of the gate.

     PHI-FREE BY CONSTRUCTION. The queue carries {patientId, day, attempts,
     code} and nothing else - no name, DOB or MRN, exactly like dnbf-1.0.0's
     receipt - and every visible string is counts plus a closed code vocabulary
     translated to plain words. ES5, ASCII, no rAF. */
  var NI_VERSION = "notes-idle-1.0.0";
  var NI_IDLE_MS = 20000;            /* the doctor is "idle" after this much quiet */
  var NI_TICK_MS = 3000;             /* the Worker clock; the brief's 2-5 s band */
  var NI_MAX_ATTEMPTS = 3;
  var NI_BACKOFF_MS = [30000, 120000, 600000];
  var NI_READ_DEADLINE_MS = 45000;   /* DN_ROW_DEADLINE_MS, off-pass */
  var NI_PRESENCE_MS = 3500;
  var NI_LOCK_QUERY_MS = 1200;
  var NI_MAX_ROWS = 200;
  var NI_KEEP_DAYS = 7;
  var NI_PULL_LOCK = "mls-managed-athena-pull";
  var NI_STORE_SUFFIX = "p1NotesIdleQueueV1";
  var NI_ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "input"];
  /* the ONLY code that stops a row for good: there is nothing in Athena to
     read, so a retry can only re-prove the same absence. Everything else is
     retried on the ladder and then honestly given up after NI_MAX_ATTEMPTS. */
  var NI_TERMINAL_CODES = { "no-encounter": 1 };
  /* the closed code vocabulary (tnReasonCode's, verbatim) in plain words. A
     surface may render these; it may never render a reader message. */
  var NI_PLAIN = {
    "no-encounter": "no visit note in Athena for that day",
    "safety-stop": "Athena showed the visit but not its full note; nothing stored",
    "deadline": "Athena was slow; will retry when idle",
    "no-athena-tab": "athenaOne was not open",
    "pull-in-flight": "MLS was busy with another Athena read",
    "pass-budget-exhausted": "the pull ran out of its note budget",
    "surface-race": "athenaOne was showing a different patient",
    "extension-too-old": "MLS Assist needs updating",
    "reader-unavailable": "the visit reader was not loaded",
    "other": "athenaOne did not return the note",
    "unknown": "athenaOne did not return the note"
  };
  function niPlain(code) {
    var c = String(code || "unknown");
    return NI_PLAIN[c] || NI_PLAIN.unknown;
  }
  var _ni = {
    rows: [], emitted: {}, stopped: false, loaded: false, key: null,
    state: "idle", gateReason: "nothing-due",
    lastActivityAt: 0, reading: false, listening: false,
    reads: 0, ticks: 0, lastCode: "", lastAt: 0,
    wk: null, wkUrl: null, iv: null
  };
  function niKey() {
    return safe(function () { return isFn(window.uns) ? String(window.uns(NI_STORE_SUFFIX) || "") : ""; }, "");
  }
  function niToday() { return safe(function () { return acctTodayKey() || ""; }, ""); }
  function niCutoffDay() {
    var t = niToday();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return "";
    var ms = Date.UTC(Number(t.slice(0, 4)), Number(t.slice(5, 7)) - 1, Number(t.slice(8, 10))) - (NI_KEEP_DAYS * 86400000);
    var d = new Date(ms);
    function two(n) { return (n < 10 ? "0" : "") + n; }
    return d.getUTCFullYear() + "-" + two(d.getUTCMonth() + 1) + "-" + two(d.getUTCDate());
  }
  var NI_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function niDayLabel(day) {
    var d = String(day || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    var mi = Number(d.slice(5, 7)) - 1;
    if (!(mi >= 0 && mi < 12)) return d;
    return NI_MONTHS[mi] + " " + String(Number(d.slice(8, 10)));
  }
  /* THE KEY IS RE-ASKED EVERY TIME, and a change means a different account.
     This module loads BEFORE anyone signs in, and `uns()` answers a device
     namespace until a session is owned - so caching "loaded" against the first
     answer would silently strand the doctor's real queue behind an anonymous
     one. On a change: stop, forget, and load the account whose key it now is.
     That is also the re-login path the owner asked to survive. */
  function niLoad() {
    var k = niKey();
    if (_ni.loaded && _ni.key === k) return _ni;
    if (_ni.loaded && _ni.key !== k) {
      niStopTimer();
      _ni.rows = []; _ni.emitted = {}; _ni.stopped = false;
      _ni.state = "idle"; _ni.gateReason = "nothing-due"; _ni.lastCode = ""; _ni.lastAt = 0;
    }
    _ni.loaded = true;
    _ni.key = k;
    if (!k) return _ni;
    var raw = safe(function () { return window.localStorage.getItem(k); }, null);
    var x = safe(function () { return JSON.parse(raw || "null"); }, null);
    if (!x || x.v !== 1) return _ni;
    var cutoff = niCutoffDay();
    _ni.rows = [];
    safe(function () {
      (x.rows || []).forEach(function (r) {
        if (!r || !r.p || !r.d) return;
        if (cutoff && String(r.d) < cutoff) return;
        if (_ni.rows.length >= NI_MAX_ROWS) return;
        _ni.rows.push({ p: String(r.p), d: String(r.d), a: Number(r.a || 0),
          c: String(r.c || "unknown"), s: String(r.s || "queued"), n: Number(r.n || 0) });
      });
    });
    safe(function () {
      var em = x.emitted || {};
      for (var kk in em) if (Object.prototype.hasOwnProperty.call(em, kk)) {
        if (!cutoff || String(kk) >= cutoff) _ni.emitted[String(kk)] = 1;
      }
    });
    _ni.stopped = x.stopped === true;
    return _ni;
  }
  function niSave() {
    var k = niKey();
    if (!k) return false;
    return safe(function () {
      window.localStorage.setItem(k, JSON.stringify({ v: 1, at: Date.now(), stopped: _ni.stopped === true,
        emitted: _ni.emitted,
        rows: _ni.rows.map(function (r) { return { p: r.p, d: r.d, a: r.a, c: r.c, s: r.s, n: r.n }; }) }));
      return true;
    }, false);
  }
  function niFind(pid, day) {
    for (var i = 0; i < _ni.rows.length; i++) {
      if (_ni.rows[i].p === String(pid) && _ni.rows[i].d === String(day)) return _ni.rows[i];
    }
    return null;
  }
  /* THE DROP RULE. A row leaves the queue the moment the day's note is proven
     to be on the record, whoever put it there - this pull, another tab, the
     b121 backfill, or a read the doctor did by hand. Two independent proofs,
     and the ledger one is checked FIRST because it is the reader's own receipt:
       (a) the day ledger recorded todayNoteReadAt for this patient on this day;
       (b) the patient record holds a DATED visit for that day that is not the
           pull's own {type:'Chart summary'} row (that row is written by the
           history leg and proves nothing about the note). */
  function niNoteOnFile(pid, day) {
    var d = normDate(day || "") || "";
    if (!d || !pid) return false;
    var byLedger = safe(function () {
      var x = readIndex(d), h = x && x.history;
      return !!(h && Number((h.todayNoteReadAt || {})[String(pid)] || 0) > 0);
    }, false);
    if (byLedger) return true;
    return safe(function () {
      var p = patientById(pid);
      if (!p || !Array.isArray(p.visits)) return false;
      for (var i = 0; i < p.visits.length; i++) {
        var v = p.visits[i];
        if (!v) continue;
        if (/^\s*chart summary\s*$/i.test(String(v.type || ""))) continue;
        if ((normDate(v.date || v.serviceDate || v.dateISO || "") || "") === d) return true;
      }
      return false;
    }, false);
  }
  function niEnqueue(pid, day, code) {
    niLoad();
    var p = String(pid || ""), d = normDate(day || "") || "";
    if (!p || !d) return false;
    var c = String(code || "unknown");
    if (NI_TERMINAL_CODES[c] === 1) {
      /* honest, and it stops here: there is no note to fetch. It still rides
         the queue so the receipt and the final line can COUNT it. */
      var t = niFind(p, d);
      if (t) { t.s = "no-note"; t.c = c; return false; }
      if (_ni.rows.length >= NI_MAX_ROWS) return false;
      _ni.rows.push({ p: p, d: d, a: 0, c: c, s: "no-note", n: 0 });
      niSave();
      return false;
    }
    if (niNoteOnFile(p, d)) { niDrop(p, d, "already-on-file"); return false; }
    var hit = niFind(p, d);
    if (hit) {
      if (hit.s === "read" || hit.s === "no-note") return false;
      hit.c = c;
      /* a row that gave up gets ONE fresh life per pull. A pull is a deliberate
         act by the doctor and a fresh refusal is fresh evidence; without this a
         row that lost three attempts on Monday could never be read again. The
         ladder starts over, so this can never become an unbounded retry. */
      if (hit.s === "gave-up") { hit.s = "queued"; hit.a = 0; hit.n = 0; delete _ni.emitted[d]; niSave(); niKick(); return true; }
      niSave();
      return false;
    }
    if (_ni.rows.length >= NI_MAX_ROWS) return false;
    _ni.rows.push({ p: p, d: d, a: 0, c: c, s: "queued", n: 0 });
    /* a day that gains new work has not finished, whatever it said before */
    delete _ni.emitted[d];
    niSave();
    niKick();
    return true;
  }
  function niDrop(pid, day, why) {
    niLoad();
    var hit = niFind(pid, day);
    if (!hit) return false;
    if (hit.s === "read" || hit.s === "no-note") return false;
    hit.s = "read";
    hit.c = String(why || "already-on-file");
    niSave();
    return true;
  }
  /* THE ONE FEED. Called from finalizeVerdict (the rows the pull refused and
     never deferred) and from tnSettleDay (the rows the immediate deferred round
     has now finished with). A row still OWNED by _tnDefer is skipped - it has
     not finished, and enqueuing it here would be the third queue this block
     exists to prevent. */
  function niSyncFromReceipt(receipt, day) {
    if (!receipt) return 0;
    /* dayfacts-1.0.1: day-facts receipts DO carry a per-row day-note stage;
       the old OFF-has-no-stage premise is revoked with its contract. */
    /* dayfacts-1.0.1: this is THE feed into the idle backfill, and day-facts
       receipts now carry a real per-row day-note stage - the old refusal
       ("A Full Notes OFF receipt intentionally contains no visit-body stage")
       is revoked with the contract that wrote it. */
    if (safe(function () { return window.__mlsPullStopRequested === true; }, false)) return 0;
    var d = normDate(day || receipt.day || "") || "";
    if (!d) return 0;
    var added = 0;
    safe(function () {
      (receipt.patients || []).forEach(function (p) {
        if (!p || !p.patientId) return;
        if (p.todayNote === true || p.todayNote === "already-read") { niDrop(p.patientId, d, "read-in-pull"); return; }
        if (p.todayNote === "not-yet" || p.todayNote === "future-day") return;
        /* onheal-1.0.0 (a row NOTHING read the day's note for). The blanket
           "!== false" return below dropped every row whose day-note stage never
           produced a verdict at all - which with Full visit notes ON is EVERY
           row, because there is no separate day-note leg in that mode and
           todayNote is null forever. A chart the walk could not finish was
           therefore never retried by anything. This branch is preference-BLIND
           by design (dayfacts-1.0.1): the same silence in day-facts mode - a
           failed chart read, a tripped fuse, a row the tail pass never reached
           - owes the day the same scoped read. Placed AFTER the three checks
           above so no existing verdict semantics move, and it queues nothing
           the walk already proved complete or that has not happened yet.
           Bounded by the same caps as every other queued row: NI_MAX_ROWS,
           NI_MAX_ATTEMPTS, the backoff ladder, the already-on-file drop rule
           and the terminal no-encounter code. */
        if (p.todayNote == null) {
          if (p.complete === true) return;
          if (dayNoteFuture(d)) return;
          if (niEnqueue(p.patientId, d, tnReasonCode(p.reason))) added++;
          return;
        }
        if (p.todayNote !== false) return;
        if (p.todayNoteDeferred === true) return;   /* still _tnDefer's row */
        if (niEnqueue(p.patientId, d, tnReasonCode(p.todayNoteReason))) added++;
      });
    });
    /* repaint on every sync, not only when rows were ADDED: a sync that only
       drops recovered rows is exactly the moment the surface should stop
       claiming those notes are still owed. */
    niSurface();
    return added;
  }
  /* ---- the gate ---------------------------------------------------------- */
  function niIdleMs() { return Math.max(0, Date.now() - Number(_ni.lastActivityAt || 0)); }
  function niDue(row, force) {
    if (!row || row.s !== "queued") return false;
    if (force === true) return true;
    return !(Number(row.n || 0) > Date.now());
  }
  function niNextRow(force) {
    for (var i = 0; i < _ni.rows.length; i++) if (niDue(_ni.rows[i], force)) return _ni.rows[i];
    return null;
  }
  function niOpenRows() {
    var n = 0;
    for (var i = 0; i < _ni.rows.length; i++) if (_ni.rows[i].s === "queued") n++;
    return n;
  }
  /* every synchronous refusal, in one place, in a closed vocabulary. `force`
     (the Read now button) waives the IDLE threshold and the backoff ladder and
     NOTHING else - a doctor asking is not permission to drive Athena while a
     pull, a recording or another engine is on it. */
  function niGate(force) {
    niLoad();
    if (_ni.stopped === true) return { open: false, reason: "stopped" };
    /* dayfacts-1.0.1: the idle backfill drains PULLED-DAY (onlyDate-scoped)
       notes, which are mandatory in both settled modes now. Only an account
       that has never made the choice stays fail-closed here. */
    if (safe(function () {
      var pref = window.__mlsVisitNotesPref;
      var choice = pref && isFn(pref.read) ? pref.read() : null;
      return !(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"));
    }, true)) return { open: false, reason: "visit-notes-unchosen" };
    if (_ni.reading === true) return { open: false, reason: "reading" };
    if (!niNextRow(force === true)) return { open: false, reason: "nothing-due" };
    if (force !== true && niIdleMs() < NI_IDLE_MS) return { open: false, reason: "user-active" };
    if (pullRunning === true || !tnAthenaFree()) return { open: false, reason: "pull-running" };
    if (safe(function () { return !!(window.__mlsDaySwitch && isFn(window.__mlsDaySwitch.isBusy) && window.__mlsDaySwitch.isBusy()); }, false)) return { open: false, reason: "day-switch-busy" };
    if (safe(function () { return !!(window.__mlsDayHistoryPull && window.__mlsDayHistoryPull.state && window.__mlsDayHistoryPull.state.running); }, false)) return { open: false, reason: "history-pull-running" };
    if (_tnDefer.running === true || _tnDefer.queue.length > 0) return { open: false, reason: "deferred-round-active" };
    if (safe(function () { var b = window.__mlsVisitsBackfill; return !!(b && b.state && (b.state.running || b.state.inFlight)); }, false)) return { open: false, reason: "visits-backfill-running" };
    if (safe(function () { var b = document.getElementById("captureBtn"); return !!(b && b.classList && b.classList.contains("recording")); }, false)) return { open: false, reason: "recording" };
    if (safe(function () { var t = window.__mlsTplPrepFix; return !!(t && isFn(t.isDrafting) && t.isDrafting()); }, false)) return { open: false, reason: "opnote-drafting" };
    if (safe(function () { return !!document.getElementById("mlsAthenaUnifiedConfirm"); }, false)) return { open: false, reason: "athena-review-open" };
    if (safe(function () { return resumeBusyElsewhere(); }, false)) return { open: false, reason: "pull-running-other-tab" };
    return { open: true, reason: "" };
  }
  /* the ASYNCHRONOUS half of the gate, asked immediately before a read and
     never cached: a Web Lock held by ANOTHER TAB is invisible to every
     synchronous signal above. An environment with no navigator.locks cannot
     prove the lock is held, and says so by answering false - the cross-tab
     busy stamp above is the fallback that still refuses in that case. */
  function niWebLockHeld() {
    return new Promise(function (res) {
      var lk = safe(function () { return window.navigator && window.navigator.locks; }, null);
      if (!lk || !isFn(lk.query)) { res(false); return; }
      var done = false;
      function fin(v) { if (done) return; done = true; res(v === true); }
      safe(function () { setTimeout(function () { fin(false); }, NI_LOCK_QUERY_MS); });
      safe(function () {
        Promise.resolve(lk.query()).then(function (q) {
          var held = false;
          safe(function () {
            ["held", "pending"].forEach(function (side) {
              ((q && q[side]) || []).forEach(function (h) { if (h && String(h.name) === NI_PULL_LOCK) held = true; });
            });
          });
          fin(held);
        }, function () { fin(false); });
      });
    });
  }
  /* ---- the read ---------------------------------------------------------- */
  function niReadOk(res) {
    return !!(res && (res.ok === true || typeof res === "number" || res.visits != null));
  }
  function niReadOnce(row) {
    /* Re-check immediately before the deferred reader opens Athena.  The
       synchronous gate above prevents normal starts; this second boundary
       covers a preference toggle racing with an already queued timer. */
    var choice = safe(function () {
      var pref = window.__mlsVisitNotesPref;
      return pref && isFn(pref.read) ? pref.read() : null;
    }, null);
    if (!(choice && choice.settled === true && (choice.state === "on" || choice.state === "off"))) {
      /* dayfacts-1.0.1: only an unchosen account refuses; settled OFF is
         day-facts mode and its onlyDate reads are the mandatory floor. */
      return Promise.resolve({ ok: false, reason: "visit-notes-unchosen" });
    }
    var vp = safe(function () { return window.__mlsVisitSavePref; }, null);
    var p = patientById(row.p);
    if (!(vp && isFn(vp.runForPatient) && p)) return Promise.resolve({ ok: false, reason: "reader-unavailable" });
    return boundedUntil(
      Promise.resolve().then(function () { return vp.runForPatient(p, function () {}, { onlyDate: String(row.d) }); }),
      Date.now() + NI_READ_DEADLINE_MS, "pulled-day-note-deadline-exceeded")
      .then(function (r) { return r; }, function (err) {
        return { ok: false, reason: String((err && err.message) || err || "deferred-read-failed").slice(0, 80) };
      });
  }
  function niSettleRow(row, ok, reason) {
    if (ok === true) {
      row.s = "read"; row.c = "read"; row.n = 0;
      _ni.lastCode = "read";
    } else {
      var code = tnReasonCode(reason);
      row.c = code;
      _ni.lastCode = code;
      if (NI_TERMINAL_CODES[code] === 1) { row.s = "no-note"; row.n = 0; }
      else if (row.a >= NI_MAX_ATTEMPTS) { row.s = "gave-up"; row.n = 0; }
      else { row.s = "queued"; row.n = Date.now() + NI_BACKOFF_MS[Math.min(row.a - 1, NI_BACKOFF_MS.length - 1)]; }
    }
    _ni.lastAt = Date.now();
    niSave();
  }
  function niRunOne(force) {
    var gate = niGate(force);
    _ni.gateReason = gate.reason;
    if (!gate.open) {
      _ni.state = (gate.reason === "stopped") ? "stopped"
        : (gate.reason === "user-active") ? "paused"
        : (gate.reason === "nothing-due") ? (niOpenRows() ? "waiting" : (_ni.rows.length ? "done" : "idle"))
        : (gate.reason === "reading") ? "reading"
        : (gate.reason === "visit-notes-unchosen") ? "paused" : "waiting";
      if (gate.reason === "visit-notes-unchosen") niStopTimer();
      niSurface();
      return Promise.resolve(null);
    }
    var row = niNextRow(force === true);
    if (!row) { _ni.state = "waiting"; return Promise.resolve(null); }
    /* the drop rule runs again HERE: minutes may have passed since the row was
       queued and somebody else may have filed the note in the meantime. */
    if (niNoteOnFile(row.p, row.d)) { row.s = "read"; row.c = "already-on-file"; niSave(); niSurface(); return Promise.resolve(null); }
    _ni.reading = true;
    _ni.state = "reading";
    niSurface();
    return niWebLockHeld().then(function (held) {
      if (held) { _ni.reading = false; _ni.state = "waiting"; _ni.gateReason = "web-lock-held"; niSurface(); return null; }
      /* re-ask the synchronous gate: the lock query is a round trip and the
         doctor may have touched the machine while it was in flight. */
      var g2 = niGate(force);
      if (!g2.open && g2.reason !== "reading") {
        _ni.reading = false; _ni.gateReason = g2.reason;
        _ni.state = (g2.reason === "user-active" || g2.reason === "visit-notes-unchosen") ? "paused" : "waiting";
        if (g2.reason === "visit-notes-unchosen") niStopTimer();
        niSurface();
        return null;
      }
      return p1PresenceProbe(NI_PRESENCE_MS).then(function (presence) {
        if (!p1PresenceSaysAthenaLives(presence)) {
          _ni.reading = false; _ni.state = "waiting"; _ni.gateReason = "athena-absent";
          /* NOT an attempt: nothing was asked of Athena, so nothing was spent
             and the row keeps its whole ladder. It IS pushed out by one rung of
             the ladder, though - otherwise an athenaOne that is simply closed
             for the afternoon would earn a presence probe every three seconds
             for hours. */
          row.n = Date.now() + NI_BACKOFF_MS[0];
          niSave();
          niSurface();
          return null;
        }
        row.a = Number(row.a || 0) + 1;
        _ni.reads++;
        niSave();
        return niReadOnce(row).then(function (res) {
          var ok = niReadOk(res);
          niSettleRow(row, ok, ok ? "" : String((res && res.reason) || "scoped-read-unverified"));
          _ni.reading = false;
          _ni.state = niOpenRows() ? "waiting" : "done";
          niSurface();
          return { ok: ok, code: row.c };
        }, function () {
          niSettleRow(row, false, "deferred-read-failed");
          _ni.reading = false;
          _ni.state = niOpenRows() ? "waiting" : "done";
          niSurface();
          return { ok: false, code: row.c };
        });
      }, function () { _ni.reading = false; _ni.state = "waiting"; _ni.gateReason = "athena-absent"; niSurface(); return null; });
    }, function () { _ni.reading = false; _ni.state = "waiting"; _ni.gateReason = "web-lock-held"; niSurface(); return null; });
  }
  function niTick() {
    _ni.ticks++;
    niLoad();
    if (!niOpenRows() && !_ni.reading) {
      var g = niGate(false);
      _ni.gateReason = g.reason;
      _ni.state = _ni.stopped ? "stopped" : (_ni.rows.length ? "done" : "idle");
      niSurface();
      niStopTimer();
      return Promise.resolve(null);
    }
    return niRunOne(false);
  }
  /* ---- the clock (Worker; a hidden tab is still idle) --------------------- */
  function niStartTimer() {
    if (_ni.wk || _ni.iv !== null) return;
    _ni.wkUrl = safe(function () {
      return window.URL.createObjectURL(new window.Blob(
        ["onmessage=function(e){setInterval(function(){postMessage(1)},e.data)}"],
        { type: "application/javascript" }));
    }, null);
    if (_ni.wkUrl) {
      _ni.wk = safe(function () {
        var w = new window.Worker(_ni.wkUrl);
        w.onmessage = function () { safe(niTick); };
        w.postMessage(NI_TICK_MS);
        return w;
      }, null);
    }
    if (!_ni.wk) {
      safe(function () { if (_ni.wkUrl) window.URL.revokeObjectURL(_ni.wkUrl); });
      _ni.wkUrl = null;
      var h = safe(function () { return setInterval(function () { safe(niTick); }, NI_TICK_MS); }, null);
      /* a timer handle of 0 is FALSY - compare with !== null, the phone-sync law */
      _ni.iv = (h === undefined || h === null) ? null : h;
    }
  }
  function niStopTimer() {
    safe(function () { if (_ni.wk) _ni.wk.terminate(); });
    _ni.wk = null;
    safe(function () { if (_ni.wkUrl) window.URL.revokeObjectURL(_ni.wkUrl); });
    _ni.wkUrl = null;
    if (_ni.iv !== null) { safe(function () { clearInterval(_ni.iv); }); _ni.iv = null; }
  }
  function niTimerKind() { return _ni.wk ? "worker" : (_ni.iv !== null ? "interval" : "none"); }
  function niOnActivity() {
    _ni.lastActivityAt = Date.now();
    if (_ni.state === "waiting" || _ni.state === "reading") { _ni.state = "paused"; _ni.gateReason = "user-active"; }
  }
  function niListen() {
    if (_ni.listening) return;
    _ni.listening = true;
    _ni.lastActivityAt = Date.now();   /* a page that just loaded is not idle yet */
    safe(function () {
      NI_ACTIVITY_EVENTS.forEach(function (t) {
        document.addEventListener(t, niOnActivity, { capture: true, passive: true });
      });
    });
  }
  function niKick() {
    if (_ni.stopped === true) return false;
    if (!niOpenRows()) return false;
    niListen();
    niStartTimer();
    return true;
  }
  /* ---- the surface (counts and codes; never a name) ----------------------- */
  function niDayOf() {
    var best = "";
    for (var i = 0; i < _ni.rows.length; i++) if (_ni.rows[i].d > best) best = _ni.rows[i].d;
    return best;
  }
  function niCensus(day) {
    var c = { total: 0, read: 0, noNote: 0, gaveUp: 0, queued: 0 };
    for (var i = 0; i < _ni.rows.length; i++) {
      var r = _ni.rows[i];
      if (day && r.d !== day) continue;
      c.total++;
      if (r.s === "read") c.read++;
      else if (r.s === "no-note") c.noNote++;
      else if (r.s === "gave-up") c.gaveUp++;
      else c.queued++;
    }
    return c;
  }
  function niLine() {
    var day = niDayOf();
    if (!day) return "";
    var c = niCensus(day);
    var head = "Visit notes for " + niDayLabel(day) + " — " + c.read + " of " + c.total + " read";
    if (_ni.stopped === true) return head + " · stopped";
    if (c.queued === 0) return head + " · done";
    if (_ni.state === "paused") return head + " · paused while you work";
    if (_ni.state === "reading") return head + " · reading now";
    if (_ni.gateReason === "athena-absent") return head + " · waiting for athenaOne";
    return head + " · waiting for a quiet moment";
  }
  function niFinalLine(day) {
    var c = niCensus(day);
    var bits = [c.read + " read"];
    if (c.noNote) bits.push(c.noNote + " had no note in Athena");
    if (c.gaveUp) bits.push(c.gaveUp + " could not be read (" + niPlain(_ni.lastCode) + ")");
    return "Visit notes for " + niDayLabel(day) + ": " + bits.join(", ");
  }
  /* ===== lcd-1.0.0 (a background read reaches the OPEN result card) ========
     OWNER 2026-08-19: "as the things in orange get pulled in the background
     they should turn to green."
     MEASURED GAP: a successful idle read set row.s = "read" and called
     niSurface(), which pinned a line and toasted - and never touched
     window.__mlsDayHistoryPull.state.rows, which is the array the finished
     pull card paints. So the doctor sat watching an orange "today's note not
     read this time" cell about a note that was already on file.
     THE IDENTITY LAW, one clause at a time, because every one of them is the
     difference between a live card and a wrong card:
       - a card row is found by its OWN patientId. Never by position, never
         "the next orange row" - the card shows FIRST NAMES, so two rows can
         look identical and be different people.
       - it must also match that row's OWN day (r.dnd, stamped where the
         column is emitted). This is what makes a day switch safe: a receipt
         for Tuesday cannot flip a card showing Monday.
       - a row with NO day stamped refuses to flip. Fail closed - an unproven
         match is not a match.
       - only an ORANGE cell (unread:/retrying:) flips, and only to "read".
         Nothing here can turn a green cell back, invent a verdict, or move the
         saved/failed tally: the day-note lane stays verdict-neutral (dv3).
       - it refuses entirely while a pull is RUNNING. That pass owns the
         column and publishes its own truth through ppSettle.
     NO TIMER IS ADDED. This runs on the notes-idle engine's own tick, which
     arms with the queue (niKick) and stops itself when the queue drains
     (niStopTimer) - and the card's repaint rides the panel's existing loop,
     which only paints while the panel is on screen. */
  function niRestampCard() {
    var s = safe(function () { return window.__mlsDayHistoryPull && window.__mlsDayHistoryPull.state; }, null);
    if (!s || s.running === true || !s.rows || !s.rows.length) return 0;
    var flips = 0;
    for (var i = 0; i < _ni.rows.length; i++) {
      var q = _ni.rows[i];
      if (!q || q.s !== "read") continue;          /* "no-note"/"gave-up" are not a saved note */
      var pid = String(q.p || ""), day = String(q.d || "");
      if (!pid || !day) continue;
      /* LAST row wins: ppSettle pushes a new row per settle and the card
         paints the latest per key, so the latest is the cell on screen. */
      for (var j = s.rows.length - 1; j >= 0; j--) {
        var r = s.rows[j];
        if (!r || String(r.pid || "") !== pid) continue;
        if (!r.dnd || String(r.dnd) !== day) break;
        var was = String(r.dn || "");
        if (was.indexOf("unread:") !== 0 && was.indexOf("retrying:") !== 0) break;
        r.dn = "read"; r.dnLive = 1; r.dnLiveAt = Date.now();
        flips++;
        break;
      }
    }
    if (flips) _ni.cardFlips = Number(_ni.cardFlips || 0) + flips;
    return flips;
  }
  /* ===== end lcd-1.0.0 (receipt -> card bridge) ===== */
  function niSurface() {
    safe(niRestampCard); /* lcd-1.0.0: before the early return - a card can be open on a day this engine has no line for */
    var day = niDayOf();
    if (!day) return false;
    var c = niCensus(day);
    safe(function () {
      var q = window.__mlsQuietNotify;
      if (q && isFn(q.pin)) {
        if (c.queued === 0 && _ni.emitted[day] === 1) q.unpin("notes-idle");
        else q.pin("notes-idle", niLine(), "");
      }
    });
    /* ONE toast per day, and only when the day is finished AND this engine
       actually did something. A day whose every row was "no visit note in
       Athena" was already stated in plain words on the DONE line, and a second
       line saying it again is the noise the owner asked to be rid of - so the
       toast is earned by at least one real attempt, never by bookkeeping. */
    var worked = false;
    for (var wi = 0; wi < _ni.rows.length; wi++) if (_ni.rows[wi].d === day && Number(_ni.rows[wi].a || 0) > 0) { worked = true; break; }
    if (c.queued === 0 && c.total > 0 && worked && _ni.emitted[day] !== 1) {
      _ni.emitted[day] = 1;
      niSave();
      safe(function () { if (isFn(window.toast)) window.toast(niFinalLine(day), ""); });
    }
    safe(function () { if (isFn(window.__mlsNotesIdleRender)) window.__mlsNotesIdleRender(); });
    return true;
  }
  function niReceipt() {
    niLoad();
    var day = niDayOf(), c = niCensus(day);
    return { version: NI_VERSION, state: _ni.state, gateReason: String(_ni.gateReason || ""),
      day: day, dayLabel: niDayLabel(day), line: niLine(),
      total: c.total, read: c.read, noNote: c.noNote, gaveUp: c.gaveUp, queued: c.queued,
      stopped: _ni.stopped === true, reading: _ni.reading === true,
      idleMs: niIdleMs(), idleThresholdMs: NI_IDLE_MS,
      reads: Number(_ni.reads || 0), ticks: Number(_ni.ticks || 0),
      cardFlips: Number(_ni.cardFlips || 0), /* lcd-1.0.0: orange note cells this engine turned green on the open result card */
      lastCode: String(_ni.lastCode || ""), lastPlain: _ni.lastCode ? niPlain(_ni.lastCode) : "",
      lastAt: Number(_ni.lastAt || 0), timerKind: niTimerKind(),
      rows: _ni.rows.map(function (r) { return { patientId: r.p, day: r.d, attempts: Number(r.a || 0), code: String(r.c || ""), state: String(r.s || ""), nextAt: Number(r.n || 0) }; }) };
  }
  function niStop(why) {
    niLoad();
    _ni.stopped = true;
    _ni.state = "stopped";
    _ni.gateReason = String(why || "stopped-by-user");
    niStopTimer();
    niSave();
    niSurface();
    return true;
  }
  function niResume() {
    niLoad();
    _ni.stopped = false;
    _ni.gateReason = "";
    _ni.state = niOpenRows() ? "waiting" : "idle";
    niSave();
    niKick();
    return niOpenRows();
  }
  /* Read now: waives the idle threshold and the backoff for ONE read. Every
     other refusal in niGate still stands, on purpose. */
  function niReadNow() {
    niLoad();
    if (_ni.stopped === true) { _ni.stopped = false; niSave(); }
    niKick();
    return niRunOne(true);
  }
  /* ===== end notes-idle-1.0.0 ===== */
  function runManagedAthenaOperation(task, busyFactory) {
    function busy(scope) {
      return isFn(busyFactory) ? busyFactory(scope || "same-tab") : { ok: false, complete: false, reason: "pull-in-flight", error: "Another explicit pull is already running." };
    }
    if (pullRunning) return Promise.resolve(busy("same-tab"));
    if (foreignPullLease()) return Promise.resolve(busy("same-tab"));
    pullRunning = true;
    var operationStarted = false, leaseTouch = null, athenaMgr = safe(function(){return window.__mlsP1AthenaReadLease;}, null), athenaToken = "", athenaTouch = null;
    function releaseAthenaOwner(){
      if(athenaTouch!=null){safe(function(){clearInterval(athenaTouch);});athenaTouch=null;}
      if(athenaToken&&athenaMgr&&isFn(athenaMgr.release))safe(function(){athenaMgr.release(athenaToken);});
      if(siAthenaOwnerToken===athenaToken)siAthenaOwnerToken="";
      /* Withdraw the loan on every exit path, and only ours: a later pull's
         loan must survive this one's teardown. */
      safe(function(){ if(window.__mlsP1AthenaLeaseLoan===athenaToken) window.__mlsP1AthenaLeaseLoan=""; });
      athenaToken="";
    }
    /* b490: cross-tab pull-busy stamp. The update banner's Refresh killed a
       75-minute pull twice on 2026-07-22 (the owner cannot know another tab
       is mid-pull). Every tab can read this stamp and defer reload-shaped
       actions while it is fresh (<90s). */
    function xtabBusyKey() { return safe(function () { return isFn(window.uns) ? window.uns("mlsPullBusyXTabV1") : "mlsPullBusyXTabV1"; }, "mlsPullBusyXTabV1"); }
    function xtabBusyStamp() { safe(function () { window.localStorage.setItem(xtabBusyKey(), String(Date.now())); }); }
    function xtabBusyClear() { safe(function () { window.localStorage.removeItem(xtabBusyKey()); }); }
    function start() {
      operationStarted = true;
      safe(function () { window.__mlsPullBusyAt = Date.now(); });
      xtabBusyStamp();
      claimSiLease();
      /* keep the page lease fresh for the whole run (history batches run for
         minutes; the engine treats >180s-old leases as stale) */
      leaseTouch = setInterval(function () { safe(function () { var l = window.__mlsSchedulePullLease; if (l && l.id === SI_LEASE_ID) { l.at = Date.now(); window.__mlsPullBusyAt = l.at; xtabBusyStamp(); } }); }, 25000);
      return Promise.resolve().then(task);
    }
    var operation;
    try {
      if(athenaMgr&&isFn(athenaMgr.claim)){
        athenaToken=athenaMgr.claim("p1-si-managed",420000)||"";
        if(!athenaToken){pullRunning=false;return Promise.resolve(busy("other-tab"));}
        siAthenaOwnerToken=athenaToken;
        /* p1-lease-loan-1.0.0 (owner report 2026-08-16, 6/6 today-notes refused).
           This pull passes siAthenaOwnerToken into its OWN five chart reads, but
           the today-note leg reaches the reader through feat_visits.js, which is
           frozen and calls _assistReadChart with no options object at all. With
           no token it tried a fresh claim(), lost to the lease this very pull was
           holding, and every row came back "pull-in-flight: another Athena read
           or schedule pull is active."
           Publishing the token as a LOAN lets an un-tokened read join the lease
           instead of fighting it. It is not a bypass: _assistReadChart honours a
           loan only while leaseMgr.owns(loan) is still true, so a stale loan
           grants nothing, and releaseAthenaOwner clears it on every exit. */
        safe(function(){ window.__mlsP1AthenaLeaseLoan = athenaToken; });
        athenaTouch=setInterval(function(){safe(function(){athenaMgr.touch(athenaToken);});},25000);
        operation=Promise.resolve().then(function(){return isFn(athenaMgr.ready)?athenaMgr.ready(athenaToken):true;}).then(function(ok){return ok?start():busy("other-tab");});
      }else if (safe(function () { return !!(navigator && navigator.locks && isFn(navigator.locks.request)); }, false)) {
        operation = navigator.locks.request("mls-managed-athena-pull", { mode: "exclusive", ifAvailable: true }, function (lock) { return lock ? start() : busy("other-tab"); });
      } else operation = start();
    } catch (lockError) {
      releaseAthenaOwner();
      operation = Promise.reject(lockError);
    }
    return Promise.resolve(operation).then(function (value) {
      pullRunning = false;
      if (leaseTouch != null) { safe(function () { clearInterval(leaseTouch); }); leaseTouch = null; }
      releaseSiLease();
      releaseAthenaOwner();
      /* the busy stamp is cleared identically on success and rejection, so the
         progress chip cannot tell them apart from its disappearance alone —
         record the real outcome BEFORE zeroing the stamp (finding #5) */
      /* hs-1.0: stamp the settled value's OWN verdict - a resolved terminal
         failure (ok:false receipt) must never be recorded as a success. */
      safe(function () { window.__mlsPullLastOutcome = honestPullOutcome(value); });
      safe(function () { window.__mlsPullBusyAt = 0; });
      if (operationStarted) xtabBusyClear();
      if (operationStarted) releaseManagedAthenaWorkspace();
      /* p1-todaynote-deferred-retry-1.0.0: the lease this pull held is now
         released, so the rows that lost to it get their one retry round. */
      safe(tnScheduleDeferredRound);
      return value;
    }, function (error) {
      pullRunning = false;
      if (leaseTouch != null) { safe(function () { clearInterval(leaseTouch); }); leaseTouch = null; }
      releaseSiLease();
      releaseAthenaOwner();
      safe(function () { window.__mlsPullLastOutcome = { ok: false, at: Date.now(), error: String(error && error.message || error || 'pull failed').slice(0, 200) }; });
      safe(function () { window.__mlsPullBusyAt = 0; });
      if (operationStarted) xtabBusyClear();
      if (operationStarted) releaseManagedAthenaWorkspace();
      safe(tnScheduleDeferredRound);
      throw error;
    });
  }

  /* Rebuild verifiable history-target rows from frozen retry entries. Frozen
     proofs (normDob/normMrn tokens) are re-checked against the CURRENT stored
     patient; any drift refuses. Downstream gets the stored separator forms
     (_athenaHistoryTargetSnapshot rejects bare tokens). Shared by the manual
     retry button and the si-1.9.0 automatic end-of-batch re-sweep. */
  function buildRetryRows(retryEntries, scopeDay) {
    var seen = {}, rows = [], unresolved = [];
    /* dnd-1.0.0: the day travels with the rebuilt row. scopeDay is the pull's
       own day and is used only when an older retry entry carries none, so a
       receipt written before this change still reaches the day-note leg. */
    scopeDay = normDate(scopeDay || "") || "";
    (Array.isArray(retryEntries) ? retryEntries : []).forEach(function (item) {
      var patientId = String(item && item.patientId || "");
      if (!patientId || seen[patientId]) return;
      seen[patientId] = true;
      var patient = patientById(patientId);
      var frozenDob = normDob(item && item.frozenDob || ""), frozenMrn = normMrn(item && item.frozenMrn || "");
      var currentDob = normDob(patient && patient.dob || ""), currentMrn = rowMrn(patient);
      if (!frozenDob && !frozenMrn) {
        unresolved.push({ patientId: patientId, reason: "retry-proof-missing", frozenDob: "", frozenMrn: "" });
        return;
      }
      if (!patient) {
        unresolved.push({ patientId: patientId, reason: "retry-target-unavailable", frozenDob: frozenDob, frozenMrn: frozenMrn });
        return;
      }
      if ((frozenDob && currentDob !== frozenDob) || (frozenMrn && currentMrn !== frozenMrn)) {
        unresolved.push({ patientId: patientId, reason: "retry-identity-changed", frozenDob: frozenDob, frozenMrn: frozenMrn });
        return;
      }
      /* The frozen proofs are normDob/normMrn tokens (YYYYMMDD digits). The
         base app's _athenaHistoryTargetSnapshot only accepts the patient's
         stored separator form, so a retry built from the tokens resolved NO
         target (identity-target-unresolved x N). Equality with the stored
         patient was just proven above; hand downstream the stored form. */
      var storedDob = String(patient.dob || ""), storedMrn = String(patient.mrn || patient.athenaId || "");
      var rowDay = normDate((item && item.scheduleDate) || "") || scopeDay;
      var rawFrozenAppointmentId = String(item && item.appointmentId || "").trim();
      var frozenAppointmentId = /^[A-Za-z0-9_-]{2,40}$/.test(rawFrozenAppointmentId) ? rawFrozenAppointmentId : "";
      rows.push({
        patient_external_id: patientId,
        _mlsTargetPatientId: patientId,
        _mlsTargetDob: frozenDob ? storedDob : "",
        _mlsTargetMrn: frozenMrn ? storedMrn : "",
        name: String(patient.name || ""),
        dob: frozenDob ? storedDob : "",
        mrn: frozenMrn ? storedMrn : "",
        athenaId: frozenMrn ? storedMrn : "",
        appointmentId: frozenAppointmentId,
        athenaAppointmentId: frozenAppointmentId,
        /* dnd-1.0.0: without these two fields the rebuilt row reached the
           day-note leg with no day and every row settled no-day-on-row. */
        date: rowDay,
        scheduleDate: rowDay
      });
    });
    return { rows: rows, unresolved: unresolved };
  }

  /* fg-1.0 (3.0.41): true only while the USER-INITIATED retry batch runs -
     batches are single-flight (withPatientBatch + the cross-tab shield), so a
     module flag cannot leak into a quiet pull. */
  var __historyRetryForeground = false;
  /* fg-1.3: ONE presence announce per user-initiated pull. The old latch lived
     on the batch receipt, so every automatic re-check sweep re-announced and
     re-armed an assist the doctor had already quieted. */
  var __presenceBatchAnnounced = false;
  /* fg-1.3: never yank athenaOne in front of a doctor who is mid-recording.
     Class-first truth copied from the visit lane (captureBtn .recording);
     the ez3 Go button text is the second lane's honest stop-state. */
  function __mlsDoctorMidVisit() {
    return safe(function () {
      var b = document.getElementById("captureBtn");
      if (b && (b.classList.contains("recording") || /stop/i.test(b.textContent || ""))) return true;
      var g = document.getElementById("ez3ActiveGo");
      if (g && /\bstop\b/i.test(g.textContent || "")) return true;
      return false;
    }, false);
  }
  function retryFailedHistory(source, onStatus) {
    var history = source && source.historyReceipt ? source.historyReceipt : (source || {});
    var retry = Array.isArray(history.retry) ? history.retry : [];
    /* dayfacts-1.0.1: the old wholesale OFF refusal ("retrying them would
       reopen every patient chart and violate schedule-only mode") is revoked
       with schedule-only itself - an OFF row's chart-facts read and pulled-day
       note are MANDATORY work, so its retry entries are actionable and the
       batch below re-runs them in day-facts mode via the frozen override.
       retryBodiesRequested still scopes the retry to the receipt's own mode
       (an OFF receipt never grows a full-history retry). */
    var retryBodiesRequested = typeof history.visitNotesRequested === "boolean"
      ? history.visitNotesRequested
      : (typeof _pullBodiesOverride === "boolean" ? _pullBodiesOverride : safe(function () {
          var pref = window.__mlsVisitNotesPref, choice = pref && isFn(pref.read) ? pref.read() : null;
          return choice && (choice.state === "off" || choice.state === "unset" || choice.on === false) ? false : true;
        }, true));
    /* dnd-1.0.0: the retry round is scoped to the SAME day the pull read. The
       receipt now states its own day; the pull result's target and schedule
       receipt are the fallbacks for a receipt written before this change. */
    var retryScopeDay = normDate(history.day || (source && source.target) ||
      (source && source.scheduleReceipt && source.scheduleReceipt.schedDate) || "") || "";
    var built = buildRetryRows(retry, retryScopeDay);
    var rows = built.rows, unresolved = built.unresolved;
    if (!retry.length) {
      var alreadyComplete = history && history.complete === true && history.exactIdentityVerified === true && Number(history.failures || 0) === 0;
      return Promise.resolve({
        requestId: "history-retry-empty-" + Date.now().toString(36),
        retryOf: String(history.requestId || ""), requested: 0, processed: 0,
        complete: alreadyComplete, exactIdentityVerified: alreadyComplete, visitNotesRequested: history.visitNotesRequested === true, patients: [], retry: [], failures: alreadyComplete ? 0 : 1,
        reason: alreadyComplete ? "nothing-to-retry" : "retry-receipt-invalid"
      });
    }
    function retryBusy(scope) {
      return {
        requestId: "history-retry-busy-" + Date.now().toString(36), retryOf: String(history.requestId || ""),
        requested: retry.length, processed: 0, complete: false, exactIdentityVerified: false,
        patients: [], retry: retry.slice(), failures: retry.length, reason: "history-partial",
        blockedReason: "pull-in-flight", error: scope === "other-tab"
          ? "Another MLS tab is already running an explicit pull. No retry was started."
          : "Another explicit pull is still running in this MLS tab. No retry was started."
      };
    }
    return runManagedAthenaOperation(function () {
      return withPatientBatch("history-retry", function () {
        __historyRetryForeground = true;
        __presenceBatchAnnounced = false;
        window.__mlsPullStopRequested = false; /* stp-2.0.0: an explicit retry is a NEW intent, never the stopped one */
        /* Freeze the original pull's scope for the retry. In particular, an
           OFF receipt must never become a visit-body read merely because the
           preference changed after the first attempt. */
        var priorBodiesOverride = _pullBodiesOverride;
        if (typeof history.visitNotesRequested === "boolean") _pullBodiesOverride = history.visitNotesRequested;
        function restoreBodiesOverride() { _pullBodiesOverride = priorBodiesOverride; }
        return runHistoryBatch(rows, unresolved, isFn(onStatus) ? onStatus : function () {}, { scopeDay: retryScopeDay, retryPass: true }).then(
          function (v) { __historyRetryForeground = false; restoreBodiesOverride(); return v; },
          function (e) { __historyRetryForeground = false; restoreBodiesOverride(); throw e; });
      });
    }, retryBusy).then(function (receipt) {
      receipt.retryOf = String(history.requestId || "");
      receipt.manualRetry = true;
      return receipt;
    });
  }

  /* A calendar-partial receipt is a safety result, not one single failure.
     Separate backend write failures from exact-identity refusals, mapping
     proof, snapshot publication, and accounting. The returned diagnostics are
     fixed reason-code counts only (no names, DOBs, MRNs, or source ids). */
  function phiFreeReasonCounts(raw) {
    var out = {}, src = raw && typeof raw === "object" ? raw : {};
    Object.keys(src).forEach(function (key) {
      var safeKey = String(key || "").toLowerCase();
      if (!CALENDAR_REASON_CODES[safeKey]) safeKey = "calendar-row-unverified";
      var n = Number(src[key] || 0);
      if (!isFinite(n) || n <= 0) return;
      out[safeKey] = Number(out[safeKey] || 0) + n;
    });
    return out;
  }
  function mappingReasonCounts(items) {
    var raw = {};
    (Array.isArray(items) ? items : []).forEach(function (item) {
      var reason = String(item && item.reason || "mapping-unresolved");
      raw[reason] = Number(raw[reason] || 0) + 1;
    });
    return phiFreeReasonCounts(raw);
  }
  function reasonPresent(counts, names) {
    for (var i = 0; i < names.length; i++) if (Number(counts && counts[names[i]] || 0) > 0) return true;
    return false;
  }
  function classifyCalendarFailure(res, receipt) {
    res = res || {}; receipt = receipt || {};
    if (receipt.complete === true) return "complete";
    var reasons = phiFreeReasonCounts(res.failureReasons || receipt.failureReasons);
    if (Number(receipt.wrongDay || 0) > 0 || Number(receipt.invalidDate || 0) > 0) return "date-unverified";
    if (reasonPresent(reasons, ["signin-expired"])) return "signin-expired";
    if (reasonPresent(reasons, ["calendar-read-unverified"])) return "calendar-read-unverified";
    if (reasonPresent(reasons, [
      "appointment-create-http", "appointment-create-network", "appointment-create-dispatch-failed",
      "appointment-update-http", "appointment-update-network"
    ])) return "save-failed";
    if (reasonPresent(reasons, ["import-in-flight"])) return "concurrent-import";
    if (reasonPresent(reasons, [
      "appointment-patient-identity-conflict", "appointment-enrichment-ambiguous",
      "slot-patient-identity-conflict", "patient-not-resolved",
      "appointment-identity-unresolved", "appointment-source-identity-conflict"
    ])) return "identity-unverified";
    if (receipt.mappingComplete === false || Number(receipt.unresolvedMappings || 0) > 0 ||
        reasonPresent(reasons, ["backend-id-missing", "patient-id-missing", "source-identity-missing", "ledger-backend-day-mismatch", "mapping-unresolved"])) return "mapping-unverified";
    if (receipt.accountingComplete === false || Number(receipt.accounted || 0) !== Number(receipt.attempted || 0)) return "accounting-unverified";
    if (receipt.snapshotPublished === false) return "snapshot-unverified";
    if (Number(receipt.failed || 0) > 0) return "row-unverified";
    return "calendar-unverified";
  }

  function pullUnlocked(opts) {
    opts = opts || {};
    var date = opts.date || estTodayKey();
    /* fvn-1.0.0 CANONICAL SEMANTICS (Codex reply 24): OFF is DAY-FACTS mode,
       not schedule-only - every pull opens each scheduled chart and saves
       identity + chart facts/coverage + exactly the pulled day's own visit
       note; ON additionally saves every dated PRIOR visit note. This flag
       decides HISTORY DEPTH only, and it must be frozen before identity
       hydration or the history batch can start. */
    var visitNotesRequested = typeof opts.pullVisitBodies === "boolean"
      ? opts.pullVisitBodies
      : (typeof opts.visitNotesRequested === "boolean" ? opts.visitNotesRequested
        : (typeof _pullBodiesOverride === "boolean" ? _pullBodiesOverride : null));
    var fullNotesOff = visitNotesRequested === false;
    /* First use is explicit: an unset visit-notes choice is schedule-only.
       Only the admission gate may pass includeHistory:true after a confirmed
       clinician choice; low-level callers cannot silently open charts. */
    /* The admission gate freezes the explicit choice as pullVisitBodies, but
       intentionally does not need to add a second includeHistory flag. An
       explicit ON choice therefore enters the full-history lane even when a
       normal day caller omitted includeHistory; explicit OFF and unset remain
       schedule-only/fail-closed. */
    /* dayfacts-1.0.0: the checkbox no longer decides WHETHER the per-patient
       batch runs - only how much history it traverses. includeHistory keeps
       its one remaining legitimate opt-out (the census phase-1 caller that
       explicitly passes false and batches its provable targets in phase 2);
       an OFF day pull now runs the batch in day-facts mode. */
    var includeHistory = opts.includeHistory !== false;
    var onStatus = isFn(opts.onStatus) ? opts.onStatus : function () {};
    var providerGate = resolveProviderRequest(opts.provider, {
      allowAll: true,
      requireRosterForAll: false,
      allowDetectedProvider: opts.__p1DetectedProvider === true
    });
    var providerTarget = providerGate.ok ? providerGate.provider : opts.provider;
    /* si-1.7.7: a receipt gate that fails EVERY pull on ONE machine is almost
       always an outdated MLS Assist there (old readers cannot produce the
       request-bound receipts these gates demand), but the doctor only ever
       saw "not verified" with no way out (live 2026-07-18, owner's father).
       When the answering extension is older than the published version, the
       failure carries an explicit update-this-computer hint. Fail-closed
       behavior is unchanged — this only explains it. */
    var RECEIPT_GATE_REASONS = { "no-read": 1, "schedule-incomplete": 1, "schedule-request-unbound": 1, "provider-roster-incomplete": 1, "provider-roster-unbound": 1, "unverified-day": 1 };
    function extUpdateHint() {
      var cur = String(extPong.version || ""), pub = String(publishedExt.v || "");
      if (!cur || !pub || !verLess(cur, pub)) return "";
      return "This computer runs MLS Assist v" + cur + " but the current version is v" + pub + " — update MLS Assist on THIS computer (Settings → Get the extension), then retry.";
    }
    function fail(reason, extra) {
      var out = { ok: false, complete: false, reason: reason || "failed", includeHistory: includeHistory, historyRequested: includeHistory, visitNotesRequested: visitNotesRequested !== null ? visitNotesRequested : undefined, visitNotesMode: fullNotesOff ? "day-facts" : (visitNotesRequested === true ? "full" : "unspecified"), created: 0, repaired: 0, skipped: 0, failed: 0, target: date, providerRosterReceipt: providerGate.receipt || null, scheduleReceipt: null, providerReceipt: null, calendarReceipt: null, historyReceipt: null, retry: {} };
      extra = extra || {}; for (var k in extra) if (extra.hasOwnProperty(k)) out[k] = extra[k];
      if (RECEIPT_GATE_REASONS[out.reason]) {
        var hint = [duplicateExtHint(), extUpdateHint()].filter(function (h) { return !!h; }).join(" ");
        if (hint) { out.extUpdateHint = hint; onStatus(hint, "err"); }
      } else if (out.reason === "nav-failed" || out.reason === "wrong-day") {
        /* two racing extension copies also fight over date navigation */
        var dupOnly = duplicateExtHint();
        if (dupOnly) { out.extUpdateHint = dupOnly; onStatus(dupOnly, "err"); }
      }
      return out;
    }
    /* si-1.7.8/si-1.7.10: TWO installed copies of MLS Assist (e.g. an old
       unpacked folder plus the store version) both answer every bridge
       request and both drive the same Athena tab, so navigation and receipts
       cross and every pull dies "not verified" with no visible cause.
       si-1.7.10 (live false-positive 2026-07-18 on the owner's machine, ONE
       healthy extension): background modules ping continuously, so a bare
       pong count in the window reads a post-reload probe storm as
       duplicates. Count PINGS and PONGS in the same window: one extension
       answers each ping once (pongs == pings), two answer twice
       (pongs == 2×pings). Warn only on pongs >= 4 AND pongs >= 2×pings —
       a single boundary-straddling pong can never fake that. Warning only,
       never blocks, and it never overwrites a failure status (it rides the
       fail() hints instead). */
    var pongProbe = { pings: 0, pongs: 0, versions: {} };
    function armPongProbe() {
      pongProbe = { pings: 0, pongs: 0, versions: {} };
      var onBridgeMsg = function (e) {
        var d = e && e.data;
        if (!d || typeof d !== "object") return;
        if (d.source === "mls-app" && d.type === "mlsPing") { pongProbe.pings++; return; }
        if (d.source !== "mls-ext" || d.type !== "mlsPong") return;
        pongProbe.pongs++;
        var v = String(d.version || d.extVersion || "unknown").trim() || "unknown";
        pongProbe.versions[v] = (pongProbe.versions[v] || 0) + 1;
      };
      window.addEventListener("message", onBridgeMsg, false);
      setTimeout(function () {
        safe(function () { window.removeEventListener("message", onBridgeMsg, false); });
      }, 1500);
    }
    function duplicateExtHint() {
      if (!(pongProbe.pongs >= 4 && pongProbe.pings >= 1 && pongProbe.pongs >= 2 * pongProbe.pings)) return "";
      var vs = Object.keys(pongProbe.versions);
      return pongProbe.pings + " check-in(s) got " + pongProbe.pongs + " answers" + (vs.length > 1 ? " (v" + vs.join(", v") + ")" : "") + " — TWO copies of MLS Assist look installed on this computer, and they read Athena at the same time so verification fails. Open chrome://extensions, keep exactly ONE MLS Assist (remove or toggle off the other), reload the Athena tab, then retry.";
    }
    /* FIX 2026-07-01: stamp "a user pull is in flight" so the connection prober pauses --
       the extension bridge has no request ids, so probe replies and pull replies can cross. */
    window.__mlsPullBusyAt = Date.now();
    if (!signedIn()) { onStatus("Sign in to import the schedule.", "err"); return Promise.resolve(fail("signin")); }
    if (!providerGate.ok) { onStatus(providerGate.error || "The selected provider could not be verified.", "err"); return Promise.resolve(fail(providerGate.reason, { error: providerGate.error || "", retry: { providerRoster: true } })); }

    /* si-1.7.15 (live 2026-07-21): an EXPIRED token still passes signedIn()
       (presence-only), so every pull from an idle tab ran the whole Athena read
       and then died minutes later as "calendar-read-unverified" — the owner saw
       "retry when the MLS connection is stable" on every attempt with no hint
       the session was gone. Verify the session up front and refuse honestly.
       A network blip (status 0) is NOT expiry; later reads keep their own
       fail-closed handling. */
    return safe(function () {
      return fetch(bkBase() + "/api/me", { headers: { Authorization: "Bearer " + bkToken() } })
        .then(function (meR) { return Number(meR && meR.status || 0); }, function () { return 0; });
    }, Promise.resolve(0)).then(function (meStatus) {
      if (meStatus === 401 || meStatus === 403) {
        onStatus("Your MLS sign-in expired on this device. Sign in to MLS again, then pull.", "err");
        return fail("signin-expired");
      }
      return pullAfterSession();
    });
    function pullAfterSession() {
    onStatus("Looking for MLS Assist...", "");
    fetchPublishedExtVersion(); /* pre-warm so a later receipt-gate failure can name the outdated version */
    armPongProbe(); /* count answers to THIS ping — 2+ means two installed copies */
    return bridge("mlsPong", "mlsPing", 3500).then(function (pong) {
      if (!pong || pong.reason === "bridge-deadline-exceeded") { onStatus("MLS Assist isn't responding. Enable it and open your athenaOne Day schedule, then try again.", "err"); return fail("no-ext"); }
      extPong.version = String(pong && (pong.version || pong.extVersion) || "").trim();
      onStatus("Opening " + date + " in athenaOne...", "");
      /* si-1.7.11 (live, reproduced 3x on 2026-07-18): the FIRST goto after an
         app-tab reload verifies against athena's week strip while it still
         reads "Today", so navigation honestly fails — and the SAME goto
         succeeds a moment later once the day view has re-rendered. Give
         navigation ONE settle-and-retry before failing the whole pull.
         si-1.7.14 (live 2026-07-20): with athena parked on the dashboard the
         first click can open the Day view so slowly that ONE 2.5s settle still
         misses it ("week strip shows no selected day"), while the very next
         manual pull succeeds. Escalate the settle waits (2.5s/5s/8s) so the
         first click absorbs that render lag instead of asking the clinician
         to click again. */
      /* ===== nav-1.0.0 (the nav refusal keeps its evidence) =====
         MEASURED live 2026-08-17 on the owner's /1p: after a COMPLETED first
         pass the day strip re-pulled and _lastPullResult() came back
         {reason:'nav-failed', target:'2026-08-17', retry:{}} - a bare verdict
         with nothing on it to reason about, while the athena tab was alive
         (22K chars, no re-login) and merely HIDDEN/backgrounded. The
         extension's own goto answer already carries the reason, the day it
         believes it is on, and the tab shape it saw; none of that reached the
         receipt. Codes, counts, a truncated URL PATH and a date - never a
         name, DOB, MRN or any chart text. */
      var navAttempts = 0;
      /* nvl-1.1.0: ONE bounded re-entry of the goto handler's own guarded
         recovery ladder, admitted only on closed alive-surface evidence;
         navDiag carries whether it ran so every receipt proves the ladder. */
      var navRecovery = { ran: false };
      function navDiagOf(nav, attempts) {
        return safe(function () {
          var d = (nav && nav.diag) || null;
          return {
            v: 1,
            /* nvl-1.3.0 (Codex reply 40): EXACT booleans - absence is never
               success. A malformed reply cannot mint a successful receipt. */
            ok: !!(nav && nav.ok === true),
            supported: !!(nav && nav.supported === true),
            reason: String((nav && nav.reason) || "").slice(0, 40),
            via: String((nav && nav.via) || "").slice(0, 40),
            observedDay: normDate(nav && nav.schedDate) || "",
            requestedDay: String(date || ""),
            attempts: Number(attempts || 0),
            sessionLikelyExpired: !!(nav && nav.sessionLikelyExpired),
            controlVisible: (nav && nav.controlVisible) === true,
            tabPath: String((d && d.tabPath) || "").slice(0, 40),
            initFrames: Number((d && d.initFrames) || 0),
            initFound: !!(d && d.initFound),
            rounds: Number((d && Array.isArray(d.rounds) && d.rounds.length) || 0),
            recoveryRan: navRecovery.ran === true, /* nvl-1.1.0: the guarded seam was re-entered */
            recoveryVia: navRecovery.ran === true ? "second-settled-goto" : "",
            sequences: navRecovery.ran === true ? 2 : 1 /* nvl-1.2.0: attempts above is the monotonic total across these */
          };
        }, { v: 1, ok: false, reason: "nav-diag-unreadable", attempts: Number(attempts || 0), recoveryRan: navRecovery.ran === true });
      }
      /* ===== end nav-1.0.0 (diag) ===== */
      /* p1-athena-presence-1.0.0: ONE busy budget for the whole pull. Both the
         goto leg and the schedule leg draw from it, so a busy athena can cost
         at most three re-checks per pull no matter which leg hit it. */
      var athenaBusy = { athenaBusyRetries: 0 };
      function gotoDateSettled() {
        var settleWaits = [2500, 5000, 8000];
        function attempt(round) {
          return p1AthenaBusyRetry(function () {
            /* nvl-1.3.0 (Codex reply 40): counted at the REAL bridge dispatch,
               INSIDE the busy-retry wrapper - its internal presence-admitted
               re-dispatches are real attempts too. Monotonic across the
               settle ladder and the recovery sequence alike. */
            navAttempts += 1;
            return bridge("mlsAppGotoDateResult", "mlsAppGotoDate", 60000, { date: date, probe: false });
          }, onStatus, athenaBusy).then(function (nav) {
            var day0 = normDate(nav && nav.schedDate);
            var bad = !nav || nav.ok === false || (day0 && day0 !== date);
            /* nvl-1.5.0 (Codex reply 44): a settle retry is spent ONLY under
               the same closed admission law the recovery re-entry uses - an
               exact ok:true wrong-day landing, or an exact ok:false
               reason-less supported:true reply with reviewed alive evidence.
               Every fail-closed shape (coded refusal, dead session,
               unsupported, null/empty, missing/null/string ok, alien via)
               returns from its FIRST settled call with one real dispatch and
               reaches the exact terminal gate. */
            if (!bad || round >= settleWaits.length || !navRecoveryAdmissible(nav)) return nav;
            onStatus("Athena is still switching days — re-checking in a moment...", "");
            return (window.__mlsBgSleep ? window.__mlsBgSleep(settleWaits[round]) : new Promise(function (resWait) { setTimeout(resWait, settleWaits[round]); })).then(function () {
              return attempt(round + 1);
            });
          });
        }
        return attempt(0);
      }
      /* ===== p1-onetab-nav-1.0.0 (the nav refusal says what the diag shows) ===
         Live 2026-08-17: nav-failed carried "athena week strip shows no
         selected day instead of <date>" on a NEXT-WEEK date while three athena
         tabs were open and only ONE of them had a rendered week strip. The
         doctor was told "keep the signed-in Athena tab open and try again" -
         which he had done, three times over. Name the real state instead, and
         carry the PHI-free tab count so the sentence can say how many. */
      function p1NavFailure(nav, diag) {
        var emptyStrip = p1NavEmptyStrip(nav, diag);
        var known = p1AthenaTabsKnown();
        var counted = (emptyStrip && known < 0) ? p1AthenaTabCount(2500) : Promise.resolve(known);
        return Promise.resolve(counted).then(function (tabs) {
          var extra = {
            error: (nav && nav.error) || "",
            navSessionLikelyExpired: !!(nav && nav.sessionLikelyExpired),
            navDiag: diag, /* nav-1.0.0 */
            athenaBusyRetries: Number(athenaBusy.athenaBusyRetries || 0),
            athenaPresenceAtFailure: String(athenaBusy.athenaPresence || (p1PresenceLast.resp && p1PresenceLast.resp.reason) || ""),
            athenaTabsAtFailure: Number(isFinite(Number(tabs)) ? tabs : -1),
            navEmptyStrip: emptyStrip
          };
          if (emptyStrip) extra.navAdvice = p1OneTabAdvice(tabs);
          onStatus(extra.navAdvice || (nav && nav.error) || "Couldn't open the requested athenaOne day.", "err");
          return fail("nav-failed", extra);
        });
      }
      /* ===== end p1-onetab-nav-1.0.0 ===== */
      /* nvl-1.1.0 (Codex reply 34): the escape IS the goto handler's own
         v1.91 recovery ladder - guard-threaded home-click, Continue-clear,
         round-1 reload, every action deadline-ceilinged and every late
         result discarded by its once-only funnel. The app drives NO separate
         GoHome verb any more, so there is nothing left to orphan; the one
         app-side retry simply re-enters that guarded seam - and ONLY on
         closed alive-surface evidence. Everything else keeps its first
         honest verdict. */
      function navBad(nav) {
        var d0 = normDate(nav && nav.schedDate);
        return !nav || nav.ok === false || (d0 && d0 !== date);
      }
      /* nvl-1.2.0 (Codex reply 37): via is a CLOSED exact handler vocabulary -
         the three reviewed success routes of mlsAthenaGotoDate - never any
         nonempty alien string. */
      var NVL_VIA_ALLOW = { weekstrip: 1, input: 1, arrows: 1 };
      function navRecoveryAdmissible(nav) {
        if (!nav || nav.sessionLikelyExpired === true) return false;
        /* every CODED refusal (busy, sleeping, deadline, picker, alien -
           anything that names itself) keeps its verdict: the alive-surface
           classes are exactly the reason-less supported:true failures. */
        if (String(nav.reason || "") !== "") return false;
        var d0 = normDate(nav.schedDate);
        /* nvl-1.4.0 (Codex reply 42): the wrong-day landing is alive by
           definition ONLY on an exact ok:true. A missing, null, or string ok
           beside a mismatched parseable date is a malformed reply and buys
           nothing - the same exact-boolean law as the terminal gate, one
           branch lower. */
        if (nav.ok === true) return !!(d0 && d0 !== date);
        if (nav.ok !== false) return false; /* ok-less/malformed: never admit */
        /* nvl-1.2.0: a failed response recovers only when the handler
           EXPLICITLY says supported:true - absence fails closed - and an
           alien via poisons the reply even beside positive diag evidence. */
        if (nav.supported !== true) return false;
        var via = String(nav.via || "");
        if (via !== "" && NVL_VIA_ALLOW[via] !== 1) return false;
        var dg = nav.diag || null;
        /* POSITIVE alive evidence only: a reviewed located-control route or
           frames that executed the injection (the encounter-parked shape). */
        return NVL_VIA_ALLOW[via] === 1 ||
          !!(dg && (Number(dg.initFrames || 0) > 0 || (Array.isArray(dg.rounds) && dg.rounds.length > 0)));
      }
      function gotoWithRecovery() {
        return gotoDateSettled().then(function (nav) {
          if (!navBad(nav) || navRecovery.ran || !navRecoveryAdmissible(nav)) return nav;
          navRecovery.ran = true;
          onStatus("athenaOne answered from a non-schedule screen - giving its own guarded recovery one more attempt...", "");
          return gotoDateSettled();
        });
      }
      return gotoWithRecovery().then(function (nav) {
        var navDay = normDate(nav && nav.schedDate);
        /* nvl-1.3.0 (Codex reply 40): EXACT success gate - a malformed,
           null, or ok-less reply can no longer fall through to the schedule
           leg as if navigation succeeded. Only nav.ok === true proceeds. */
        if (!nav || nav.ok !== true) {
          return p1NavFailure(nav, navDiagOf(nav, navAttempts));
        }
        if (navDay && navDay !== date) {
          onStatus("Athena opened " + navDay + " instead of " + date + ". Nothing was imported.", "err");
          return fail("wrong-day", { observedDay: navDay, navDiag: navDiagOf(nav, navAttempts) /* nav-1.0.0 */, athenaBusyRetries: Number(athenaBusy.athenaBusyRetries || 0) });
        }
        onStatus("Reading your athenaOne Day schedule...", "");
        /* Batch-bound receipt provenance (si-1.6.3): freeze THIS pull's schedule
           requestId and the exact requested provider scope, and arm them on the
           canonical roster BEFORE the read is dispatched. Every roster receipt
           attached to this batch must then prove it belongs to this exact
           request; a stale, replayed, or differently scoped receipt fails. */
        var scheduleRequestId = "mlssi-sched-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9);
        var frozenProviderRequest = providerRequest(providerTarget);
        var rosterOperation = {
          targetDate: date,
          requestId: scheduleRequestId,
          providerMode: frozenProviderRequest.mode,
          requestedProviderId: frozenProviderRequest.mode === "selected" ? String(frozenProviderRequest.id || "") : "",
          requestedProviderStableKey: frozenProviderRequest.mode === "selected" ? String(frozenProviderRequest.stableKey || "") : ""
        };
        var rosterOperationArmed = safe(function () {
          var roster = window.__mlsProviderRoster;
          return roster && isFn(roster.beginOperation) ? roster.beginOperation(rosterOperation) : null;
        }, null);
        function rosterReceiptBatchBound(receipt) {
          return !!(receipt && receipt.complete === true && receipt.partial !== true &&
            String(receipt.requestId || "") === scheduleRequestId &&
            String(receipt.targetDate || "") === date &&
            String(receipt.providerMode || "") === rosterOperation.providerMode &&
            String(receipt.requestedProviderId || "") === rosterOperation.requestedProviderId &&
            String(receipt.requestedProviderStableKey || "") === rosterOperation.requestedProviderStableKey);
        }
        /* p1-athena-presence-1.0.0: the schedule leg draws from the SAME busy
           budget as the goto leg. A schedule read that answers no-athena-tab
           while the presence verb proves athena is alive is a busy render, not
           a signed-out session. */
        return p1AthenaBusyRetry(function () {
          return bridge("mlsAppScheduleResult", "mlsAppPullSchedule", 30000, { requestId: scheduleRequestId });
        }, onStatus, athenaBusy).then(function (r) {
        if (!r || !r.ok) { onStatus((r && r.error) || "Couldn't read your athenaOne tab. Open your Day schedule and try again.", "err"); return fail((r && r.reason) || "no-read", { error: r && r.error || "", schedSessionLikelyExpired: !!(r && r.sessionLikelyExpired), scheduleReceipt: r && r.receipt || null, athenaBusyRetries: Number(athenaBusy.athenaBusyRetries || 0), athenaPresenceAtFailure: String(athenaBusy.athenaPresence || ""), athenaTabsAtFailure: p1AthenaTabsKnown(), retry: { schedule: true } }); }
        /* Normalize the roster from this exact schedule reply before any rows
           are imported. The raw extension receipt may legitimately omit a
           declared total even after a proven full sweep; the roster module
           derives expected=observed only with end/bounds/restoration proof and
           also rejects provider/patient contamination. Re-ingesting is
           idempotent and prevents a stale prior receipt from being attached. */
        var currentProviderRosterReceipt=safe(function(){
          var roster=window.__mlsProviderRoster;
          if(roster&&isFn(roster.ingestResp))roster.ingestResp(r);
          return roster&&isFn(roster.getReceipt)?roster.getReceipt():null;
        },null)||r.providerRosterReceipt||providerGate.receipt||null;
        /* A successful extension reply is not enough: require the row-count
           receipt. Older/incomplete readers must retry instead of importing a
           visually plausible subset. Structured rows do not require flat text. */
        if (!r.receipt || r.receipt.complete !== true) {
          onStatus((r && r.error) || "Athena's schedule was only partly readable. Nothing was imported; keep that day open and retry.", "err");
          return fail("schedule-incomplete", { error: r && r.error || "", scheduleReceipt: r && r.receipt || null, retry: { schedule: true } });
        }
        /* The schedule receipt itself must be stamped with this exact request.
           A receipt without the frozen requestId is unbound evidence: it could
           belong to any earlier read of any day, so nothing may import on it. */
        if (String(r.receipt.requestId || "") !== scheduleRequestId) {
          onStatus("Athena's schedule receipt did not prove it belongs to this exact pull request. Nothing was imported; retry.", "err");
          return fail("schedule-request-unbound", { scheduleReceipt: r.receipt, retry: { schedule: true } });
        }
        var emptyContract = authoritativeEmptyContract(r);
        if (!emptyContract.ok) {
          var emptyError = "Athena's empty-day receipt disagreed with its schedule rows (" + emptyContract.field + "). Nothing was imported; retry after the full day grid finishes loading.";
          onStatus(emptyError, "err");
          return fail(emptyContract.reason, { error: emptyError, scheduleReceipt: r.receipt, emptyContract: emptyContract, retry: { schedule: true } });
        }
        /* A VERIFIED-EMPTY day (holiday/closed clinic) legitimately renders no
           provider headers, so the roster can never corroborate there. The
           authoritative empty contract above already proved the emptiness is
           internally consistent; requiring a roster on top of it made every
           closed day fail 'provider-roster-incomplete' (live: 2026-07-03).
           Non-empty days keep the full fail-closed roster requirement. */
        var verifiedEmptyDay = r.receipt.authoritativeEmpty === true;
        /* p1-census-1.0.0: the owner's legacy Day grid has a complete,
           request-bound appointment census but exposes two headers with no
           row-to-header link. Retrying cannot create that missing relation.
           The private Day-only decision below may admit the exact appointment
           IDs with provider blank; it never upgrades either roster receipt. */
        var p1CensusDecision = p1AppointmentCensusDecision(
          r, date, scheduleRequestId, frozenProviderRequest,
          currentProviderRosterReceipt, opts.__p1DayCensusToken
        );
        var p1DetectedSelected = p1DetectedSelectedDecision(
          r, date, scheduleRequestId, frozenProviderRequest,
          currentProviderRosterReceipt
        );
        /* The live Day button requests full chart history. In this exception
           provider attribution is deliberately unavailable, so history/chart
           navigation cannot be part of the appointment-census completion
           contract. Save the exact schedule first with no patient-binding
           dependency and disclose the skipped history; ordinary verified
           pulls retain the full-history default unchanged. */
        /* ===== bob-1.0.0 (best of both worlds) =====
           OWNER, 2026-08-17 (verbatim): "1p pulls way faster but doesn't
           include history so if you can do best of both worlds that would be
           great." This line is the whole mechanism. On the provider-unknown
           appointment-census path 1p set includeHistory = false and NEVER put
           it back, so every per-patient chart read was silently dropped: fast,
           and nothing saved.

           The reason the census path lowered it is real and stays intact: the
           census import must run with requirePatientBinding FALSE, because a
           row whose patient cannot be bound must not fail the exact appointment
           census, and history must not be part of the census COMPLETION
           contract when provider attribution is unavailable.

           So the request is DEFERRED, not dropped. Phase 1 (schedule + patient
           landing) is byte-for-byte what it was - the fast part stays fast, the
           binding stays optional, the census contract is unchanged. Phase 2
           runs the ordinary history batch over the SAME res.historyTargets the
           import produced, with its own honest progress, and its result is
           reported separately from the census verdict. Nothing is loosened:
           every identity gate, the store census, and the day-note lane run
           exactly as they do on an attributed day. */
        var p1CensusHistoryRequested = p1CensusDecision.ok && includeHistory;
        var p1CensusHistoryDeferred = p1CensusHistoryRequested; /* bob-1.0.0: run it in phase 2 */
        if (p1CensusDecision.ok) includeHistory = false;
        if(!verifiedEmptyDay&&!p1CensusDecision.ok&&!p1DetectedSelected.ok&&!(currentProviderRosterReceipt&&currentProviderRosterReceipt.complete===true&&currentProviderRosterReceipt.partial!==true)){
          onStatus("Athena's full provider roster was not verified. Nothing was imported; keep the complete Day schedule open and retry.","err");
          return fail("provider-roster-incomplete",{scheduleReceipt:r.receipt,providerRosterReceipt:currentProviderRosterReceipt,retry:{schedule:true,providerRoster:true}});
        }
        if (!verifiedEmptyDay && !p1CensusDecision.ok && !p1DetectedSelected.ok && !rosterReceiptBatchBound(currentProviderRosterReceipt)) {
          onStatus("Athena's provider roster receipt was not bound to this exact pull request and scope. Nothing was imported; retry.", "err");
          return fail("provider-roster-unbound", { scheduleReceipt: r.receipt, providerRosterReceipt: currentProviderRosterReceipt, rosterOperationArmed: !!rosterOperationArmed, retry: { schedule: true, providerRoster: true } });
        }
        if (p1DetectedSelected.ok) {
          onStatus("Athena found the selected clinician in this exact Day read. Verifying every returned row belongs to that clinician before anything is imported.", "");
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
        if (p1CensusDecision.ok) {
          onStatus("Athena verified every appointment on " + date + ", but did not expose which provider owns each row. Importing the exact appointment census with provider left blank - no provider will be guessed.", "");
        }
        lastResp = r; lastRespAt = Date.now();
        /* nav-1.0.0 (c): THIS DAY'S SCHEDULE HAS LANDED. Everything past this
           line is per-patient work; re-navigating athena to the same day can
           add nothing to the schedule and is exactly what the "attempt N of 3"
           loop kept doing. A verified-EMPTY day counts as landed too - ed-1.0.0
           already proved there is nothing there. Recorded PHI-free (a date, a
           count and a timestamp) so the connect lane can veto a whole-pull
           re-run without guessing. */
        navMarkScheduleLanded(readDay, {
          rows: Number((r.appts && r.appts.length) || 0),
          empty: r.receipt.authoritativeEmpty === true,
          complete: r.receipt.complete === true
        });
        safe(function () { window.__schedRaw = {
          text: r.text || "", url: r.url || "", frames: r.frames, appts: r.appts || [], schedDate: readDay,
          providers: r.providers || [], providerRoster: r.providerRoster || [], providerRosterReceipt: r.providerRosterReceipt || null,
          providerDiag: r.providerDiag || null, receipt: r.receipt || null
        }; });
        onStatus("Finding patients on " + date + "...", "");
        /* Exact structured DOM rows are authoritative for time. The prior AI-first path
           could turn a real appointment into a guessed time (including the repeated 6 PM
           symptom). Only fall back to text parsing when the extension supplied no rows. */
        var exactRows = domApptsFromResp(r, readDay);
        /* b346: the text-parse fallback can call an async parser; a hung parser
           used to leave the pull at "Finding patients..." forever. Bound it to
           an absolute deadline so this stage always terminates. */
        /* ===== ed-1.0.0 (a verified-empty day never calls the AI parser) =====
           LIVE REPRO 2026-08-17 on PRODUCTION, Mon 2026-08-31, owner's report
           "grid still settling attempt 3 of 3": a day athena proved EMPTY
           (r.receipt.authoritativeEmpty===true, complete, 0 rows, empty text -
           already proven internally consistent by authoritativeEmptyContract
           above) still fell through to _parseScheduleText, which is an AI call
           (aiCallRaw -> /api/complete). A slow model blew the 25s bound ->
           schedule-parse-timeout -> retry.schedule:true -> the day strip's
           automatic re-pull ran it three times. There is nothing for a parser
           to find on a proven-empty day: resolve [] and let the unchanged
           empty-day success path ("Athena verified that <date> has no
           appointments") do its job. A non-empty text-only day is untouched. */
        var parsedP = verifiedEmptyDay
          ? Promise.resolve([])
          : exactRows.length
          ? Promise.resolve(exactRows)
          : boundedUntil(
              Promise.resolve(safe(function () { return isFn(window._parseScheduleText) ? window._parseScheduleText(r.text) : []; }, [])),
              Date.now() + 25000, "schedule-parse-deadline-exceeded"
            ).catch(function (parseErr) {
              onStatus("The schedule text parse did not finish in time. Nothing was imported; retry.", "err");
              return { __parseTimedOut: true };
            });
        return parsedP.then(function (parsed) {
          if (parsed && parsed.__parseTimedOut) return fail("schedule-parse-timeout", { scheduleReceipt: r.receipt, retry: { schedule: true } });
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
          var p1CensusPreScope = p1CensusDecision.ok
            ? p1AppointmentCensusScope(p1CensusDecision.grant, rows, providerTarget, r, date)
            : null;
          if (p1CensusDecision.ok && !p1CensusPreScope) {
            onStatus("Athena's exact appointment census changed before import. Nothing was imported; pull the day again.", "err");
            return fail("appointment-census-unverified", {
              scheduleReceipt: r.receipt,
              providerRosterReceipt: currentProviderRosterReceipt,
              appointmentCensusReceipt: p1CensusDecision.receipt,
              retry: { schedule: true }
            });
          }
          var preScoped = p1CensusPreScope || scopeProviderRows(rows, providerTarget, r);
          /* dfb-1.0.0 (measured live 2026-08-25, four consecutive 13/13
             identity-bootstrap-partial pulls): the chart-banner bootstrap
             binds a row by its EXACT appointment id + banner identity + the
             frozen request echo - it never consults provider attribution.
             Gating it on provider-scope proof turned an unattributed day
             grid (no provider column rendered) into a total silent failure:
             hydrate was skipped wholesale, the synthetic receipt carried an
             EMPTY reasons dict, and every row died downstream as
             patient-not-resolved. Bootstrap now runs whenever the SCHEDULE
             read itself proved complete; provider-scope enforcement still
             happens exactly where it always did - on importAppts' own
             receipt at the provider gate below. The skip path remains only
             for an unproven schedule, and it now names its reason per row
             instead of vanishing. */
          var dfbScheduleProven = !!(r.receipt && r.receipt.complete === true);
          var dfbBootstrapRows = preScoped.complete ? preScoped.rows : rows;
          var bootstrapP = includeHistory && (preScoped.complete || dfbScheduleProven)
            ? hydrateMissingScheduleProof(dfbBootstrapRows, onStatus, date)
            : Promise.resolve({ rows: preScoped.rows || [], receipt: {
                complete: includeHistory ? false : true,
                attempted: Number(preScoped.rows && preScoped.rows.length || 0),
                alreadyProven: 0, requested: 0, resolved: 0, failed: includeHistory ? Number(preScoped.rows && preScoped.rows.length || 0) : 0,
                exactNameUnique: 0, skipped: !includeHistory, reason: !includeHistory ? (p1CensusHistoryRequested ? "provider-attribution-unavailable" : "not-requested") : "schedule-unproven",
                reasons: includeHistory ? { "schedule-unproven": Number(preScoped.rows && preScoped.rows.length || 0) } : {},
                batchToken: "", proofs: []
              } });
          return bootstrapP.then(function (identityBootstrap) {
          /* si-1.7.6: the import/save phase used to emit NO status between
             "Finding patients..." and the first history read, so the visible
             progress bar sat at "Starting..." for minutes while patients
             saved (live 2026-07-18). Count each settled row through the
             existing per-row onEach hook — the painter reads "X of N". */
          var importSettled = 0;
          var importTotal = rows.length;
          var onEachImport = function (ev) {
            if (ev !== "saved" && ev !== "skipped" && ev !== "repaired" && ev !== "error") return;
            importSettled++;
            if (importSettled <= importTotal) onStatus("Saving the schedule — appointment " + importSettled + " of " + importTotal + "...", "");
          };
          return importAppts(rows, { date: date, scopeDate: date, provider: providerTarget, providerResponse: r, requireProviderCoverage: true, includeHistory: includeHistory, requirePatientBinding: includeHistory, onEach: onEachImport, __p1AppointmentCensusGrant: p1CensusDecision.ok ? p1CensusDecision.grant : null }).then(async function (res) {
            res = res || {};
            /* Crash-safe phase boundary: appointments and any materialized or
               enriched patient identities are durable before chart navigation
               starts. Later history saves remain coalesced in bounded groups. */
            await Promise.resolve(checkpointPatientBatch(opts.__patientStoreBatch, "schedule-import", true));
            res.identityBootstrapReceipt = identityBootstrap && identityBootstrap.receipt || null;
            var selectedProvider = providerRequest(providerTarget);
            var p1AppointmentCensusComplete = !!(p1CensusDecision.ok &&
              res.providerReceipt && res.providerReceipt.appointmentCensusComplete === true &&
              res.providerReceipt.providerAttributionComplete === false &&
              String(res.providerReceipt.requestId || "") === String(p1CensusDecision.receipt.requestId || "") &&
              String(res.providerReceipt.targetDate || "") === date);
            res.appointmentCensusReceipt = p1AppointmentCensusComplete ? p1CensusDecision.receipt : null;
            if (!p1AppointmentCensusComplete && (!res.providerReceipt || res.providerReceipt.complete !== true)) {
              var providerReason = res.reason || (res.providerReceipt && res.providerReceipt.reason) || "provider-unverified";
              /* mdx-1.0.0: provider-incomplete only fires AFTER the schedule
                 read proved complete (an unsettled grid reports
                 provider-unverified instead), so the old advice - "retry after
                 the full day grid finishes loading" - was wrong every time it
                 was shown and sent one clinician chasing a grid that was
                 already settled (field report, Mac, 2026-08-05). Name the
                 counts and the actual shape; the copyable error report now
                 carries the per-row detail. */
              var pRec = res.providerReceipt || {};
              var pUn = Number(pRec.unattributedRows || 0), pSrc = Number(pRec.sourceRows || 0), pNim = Number(pRec.nameMatchedIdMissingRows || 0);
              /* mdx-2.0.0: with the same-clinician echo collapse shipped, a
                 name-matched refusal that still fires means the roster truly
                 could not clear the name - say which way, honestly. */
              var pBasis = String(pRec.canonicalNameFallbackBasis || "");
              var incompleteMsg = pNim > 0 && pNim === pUn
                ? (pBasis === "same-name-identity-conflict"
                  ? (pNim + " of " + pSrc + " schedule rows show " + (pRec.requested || "the selected provider") + " by name only, and MLS's verified roster carries more than one distinct clinician under that name, so a name alone cannot pick between them. Nothing was imported. Choose the exact clinician in Choose a provider, or open the full Day view once so the rows carry structured ids, then pull again - and if this repeats, use the error-report button so the rows are named.")
                  : (pNim + " of " + pSrc + " schedule rows show " + (pRec.requested || "the selected provider") + " by name, but athenaOne exposed no structured provider id on them and MLS's roster could not clear the name (" + (pBasis || "no-basis") + "), so another clinician with the same display name cannot be ruled out. Nothing was imported. Open the full Day view once so the rows carry ids, then pull again - and if this repeats, use the error-report button so the rows are named."))
                : ((pUn || "Some") + " of " + (pSrc || "the") + " schedule rows carry no provider identity MLS can verify, even though the day grid finished loading. Nothing was imported - filing those rows would risk the wrong chart. Pull again with the provider column visible in the Day view; if this repeats, use the error-report button so the rows are named.");
              onStatus(providerReason === "provider-incomplete"
                ? incompleteMsg
                : (selectedProvider.mode === "selected" ? "MLS could not verify the selected provider on this Athena day. Nothing was imported; the pull was not widened to other providers." : "MLS could not prove complete provider coverage for this Athena day. Nothing was imported."), "err");
              return fail(providerReason, { scheduleReceipt: r.receipt, providerReceipt: res.providerReceipt || null, retry: { schedule: true, provider: selectedProvider.mode === "selected" ? selectedProvider.name : "all" } });
            }
            var attempted = Number(res.attempted != null ? res.attempted : rows.length), accounted = Number(res.created || 0) + Number(res.repaired || 0) + Number(res.skipped || 0);
            var mappings = Array.isArray(res.resolvedAppointments) ? res.resolvedAppointments : [];
            var uniqueSources = {}, uniqueBackend = {};
            mappings.forEach(function (m) {
              var sk = String(m && m.sourceIdentity || ""), bk = String(m && m.backendAppointmentId || "");
              if (sk) uniqueSources[sk] = 1; if (bk) uniqueBackend[bk] = 1;
            });
            var mappingComplete = mappings.length === attempted && Object.keys(uniqueSources).length === attempted && Object.keys(uniqueBackend).length === attempted && !(res.unresolvedMappings && res.unresolvedMappings.length);
            var rowFailuresAbsent = Number(res.failed || 0) === 0;
            var dateComplete = Number(res.wrongDay || 0) === 0 && Number(res.invalidDate || 0) === 0;
            var accountingComplete = accounted === attempted;
            var preSnapshotComplete = rowFailuresAbsent && dateComplete && accountingComplete && mappingComplete;
            var calendarReceipt = {
              complete: preSnapshotComplete,
              /* sfp-1.0.0: how current the Athena grid was when it was read.
                 Recorded on the receipt, NOT folded into `complete` - a stale
                 read is still a complete read, and conflating the two would
                 fail pulls that work today. */
              scheduleFreshness: freshnessReceipt(r),
              /* prs-1.0.0: WHOSE day this was. Recorded beside completeness, never
                 folded into it - a one-provider day is still a complete read of
                 that provider. */
              providerScope: p1AppointmentCensusComplete ? {
                stated: true,
                scope: "appointment-census-only",
                requestedMode: "all",
                knownCount: null,
                paintedCount: Number(p1CensusDecision.receipt.providerHeaderCount || 0),
                rosterVerifiedCount: 0,
                athenaListEnumerated: false,
                coversPractice: false,
                sources: {},
                statement: "Appointments verified by exact appointment ID; provider attribution unavailable."
              } : providerScopeReceipt(selectedProvider.mode),
              appointmentCensusComplete: p1AppointmentCensusComplete,
              providerAttributionComplete: p1AppointmentCensusComplete ? false : !!(res.providerReceipt && res.providerReceipt.complete === true),
              attempted: attempted, accounted: accounted, mapped: mappings.length,
              uniqueSources: Object.keys(uniqueSources).length, uniqueBackend: Object.keys(uniqueBackend).length,
              rowFailuresAbsent: rowFailuresAbsent, dateComplete: dateComplete,
              accountingComplete: accountingComplete, mappingComplete: mappingComplete,
              preSnapshotComplete: preSnapshotComplete,
              unresolvedMappings: Number(res.unresolvedMappings && res.unresolvedMappings.length || 0),
              failureReasons: phiFreeReasonCounts(res.failureReasons),
              mappingReasons: mappingReasonCounts(res.unresolvedMappings),
              created: Number(res.created || 0), repaired: Number(res.repaired || 0), skipped: Number(res.skipped || 0),
              providerBackfilled: Number(res.providerBackfilled || 0),
              failed: Number(res.failed || 0), wrongDay: Number(res.wrongDay || 0), invalidDate: Number(res.invalidDate || 0)
            };
            var p1AuthorityInvalidation = p1AppointmentCensusComplete
              ? invalidateAuthoritativeDayForCensus(date)
              : null;
            if (p1AppointmentCensusComplete) {
              calendarReceipt.authorityInvalidationComplete = !!(p1AuthorityInvalidation && p1AuthorityInvalidation.complete === true);
              calendarReceipt.authorityInvalidated = !!(p1AuthorityInvalidation && p1AuthorityInvalidation.invalidated === true);
              calendarReceipt.authorityInvalidationReason = String(p1AuthorityInvalidation && p1AuthorityInvalidation.reason || "unverified");
              if (!calendarReceipt.authorityInvalidationComplete) calendarReceipt.complete = false;
            }
            /* Publish the exact appointment slice only after both the 1:1
               backend mapping and durable removal of any older provider/day
               authority succeeded. A write failure makes this pull partial:
               falling back to the append-only calendar could resurrect a
               cancelled Athena row on the next render. */
            var p1DisplaySnapshotReceipt = p1AppointmentCensusComplete && calendarReceipt.complete
              ? publishAppointmentCensusDisplaySnapshot({
                  date: date,
                  appointmentCensusReceipt: p1CensusDecision.receipt,
                  calendarReceipt: calendarReceipt,
                  resolvedAppointments: mappings
                })
              : null;
            if (p1AppointmentCensusComplete) {
              calendarReceipt.appointmentCensusDisplayPublished = !!(p1DisplaySnapshotReceipt && p1DisplaySnapshotReceipt.published === true);
              calendarReceipt.appointmentCensusDisplayReason = String(p1DisplaySnapshotReceipt && p1DisplaySnapshotReceipt.reason || "prerequisite-unverified");
              if (!calendarReceipt.appointmentCensusDisplayPublished) calendarReceipt.complete = false;
              res.appointmentCensusDisplaySnapshot = p1DisplaySnapshotReceipt;
            }
            /* A provider-unknown census must never become the authoritative
               all-provider/practice snapshot. That snapshot is consumed by
               provider-scoped workflows and would turn blank attribution into
               a false coverage claim. Appointment reconciliation can still be
               complete and one-to-one without publishing that separate proof. */
            var snapshotReceipt = p1AppointmentCensusComplete ? {
              published: false,
              complete: false,
              date: date,
              scope: "appointment-census-only",
              expected: attempted,
              mapped: mappings.length,
              reason: calendarReceipt.authorityInvalidationComplete ? "provider-attribution-unavailable" : "authority-invalidation-persist-failed",
              providerSnapshotAllowed: false
            } : publishAuthoritativeSnapshot({ date: date, provider: providerTarget, scheduleReceipt: r.receipt, returnedAppointments: r.appts, providerDiag: r.providerDiag, providerReceipt: res.providerReceipt || null, calendarReceipt: calendarReceipt, resolvedAppointments: mappings });
            calendarReceipt.snapshotPublished = snapshotReceipt.published === true;
            calendarReceipt.snapshotReason = snapshotReceipt.reason;
            calendarReceipt.snapshotRequired = !p1AppointmentCensusComplete;
            if (calendarReceipt.complete && calendarReceipt.snapshotRequired && !calendarReceipt.snapshotPublished) calendarReceipt.complete = false;
            calendarReceipt.failureClass = classifyCalendarFailure(res, calendarReceipt);
            res.authoritativeSnapshot = snapshotReceipt;
            if (res.created > 0 || res.repaired > 0) {
              var parts = [];
              if (res.created > 0) parts.push("added " + res.created + " appointment" + (res.created === 1 ? "" : "s"));
              if (res.repaired > 0) parts.push("enriched " + res.repaired + " existing appointment" + (res.repaired === 1 ? "" : "s"));
              onStatus(parts.join(" and ") + " for " + date + ".", "ok");
            }
            else if (res.skipped > 0) onStatus("Those " + res.skipped + " appointment" + (res.skipped === 1 ? " is" : "s are") + " already on your calendar for " + date + ".", "");
            else if (res.reason === "provider-empty" && selectedProvider.mode === "selected" && calendarReceipt.snapshotPublished) onStatus("Athena verified no appointments for " + selectedProvider.name + " on " + date + ".", "ok");
            else if (r.receipt.authoritativeEmpty && calendarReceipt.snapshotPublished) onStatus("Athena verified that " + date + " has no appointments." + freshnessNotice(r) + providerScopeNotice(selectedProvider.mode), "ok");
            else onStatus("No verified patients could be imported for " + date + ".", "err");
            if (p1AppointmentCensusComplete && calendarReceipt.complete) {
              onStatus("The exact appointment census is saved for " + date + ". Provider is intentionally blank because Athena exposed no row-to-provider link; provider grouping is not being reported as complete.", "ok");
            }
            /* bob-1.0.0 PHASE 2: the census path defers history, it does not
               drop it. The schedule is already saved and visible at this point
               (phase 1 above), so this is additive work with its own progress
               line - "Reading history N of M" comes from runHistoryBatch's own
               onStatus, unchanged. */
            var p1CensusHistoryTargets = (p1CensusHistoryDeferred ? (res.historyTargets || []) : []);
            if (p1CensusHistoryDeferred) {
              onStatus(p1CensusHistoryTargets.length
                ? ("The schedule for " + date + " is saved. Reading chart history for " + p1CensusHistoryTargets.length + " patient" + (p1CensusHistoryTargets.length === 1 ? "" : "s") + " now - provider stays blank, nothing about the census changes.")
                : ("The schedule for " + date + " is saved. No patient on this day carries the DOB or MRN proof a chart read requires, so no history was attempted."), "");
            }
            /* dayfacts-1.0.0: Full Notes OFF is an abbreviated chart pass, by
               owner contract - every scheduled row still gets its verified
               chart open, its facts save, and exactly the pulled-day
               encounter-note attempt; only the OTHER dated historical bodies
               are out of scope. The old schedule-only meaning of OFF is
               revoked; the only remaining skips are the census phase-1 caller
               and a day with nothing provable to read. */
            var historySkipReason = p1CensusHistoryDeferred ? "provider-attribution-unavailable" : "not-requested";
            var historyReceipt = includeHistory
              ? await runHistoryBatch(res.historyTargets || [], res.historyUnresolved || [], onStatus, { scopeDay: date })
              : (p1CensusHistoryDeferred && p1CensusHistoryTargets.length
                ? await runHistoryBatch(p1CensusHistoryTargets, res.historyUnresolved || [], onStatus, { scopeDay: date })
                : { requested: 0, processed: 0, complete: true, exactIdentityVerified: true, skipped: true, reason: historySkipReason, visitNotesRequested: fullNotesOff ? false : (visitNotesRequested === true ? true : undefined), visitNotesMode: fullNotesOff ? "day-facts" : (visitNotesRequested === true ? "full" : "unspecified"), chartReads: 0, chartOpens: 0, visitBodyReads: 0, onlyDateReads: 0, deferredReads: 0, tailReads: 0, retryReads: 0, censusNoProvableTargets: p1CensusHistoryDeferred === true, patients: [], retry: [], failures: 0 });
            /* bob-1.0.0: phase 2 ran, so say so on the receipt. The census's
               OWN completion verdict is deliberately not derived from it. */
            if (p1CensusHistoryDeferred) {
              historyReceipt.censusPhaseTwo = true;
              historyReceipt.censusHistoryTargets = p1CensusHistoryTargets.length;
            }
            var providerComplete = !p1AppointmentCensusComplete && (selectedProvider.mode !== "selected" || !!(res.providerReceipt && res.providerReceipt.complete));
            var scheduleScopeComplete = p1AppointmentCensusComplete || providerComplete;
            var identityBootstrapComplete = !includeHistory || !!(res.identityBootstrapReceipt && res.identityBootstrapReceipt.complete === true);
            /* ===== scv-1.0.0 (the verdict is a STORE CENSUS, not a counter) =====
               Skeptic verdict 3, proven by tests/pull-verdict-is-a-store-census
               .test.js: requested/processed/failures are arithmetically
               incapable of contradicting the walk that produced them, so a pull
               that left the store BYTE-IDENTICAL still reported history N/N,
               complete. The counters stay necessary; they stop being
               sufficient. A day that requested history must ALSO have a
               MEASURED census before it may call itself complete, and a
               measured census that shows not one of the day's targets holding
               content is a day that did not land - never "verified complete".
               A patient with a genuinely empty Athena chart still passes: the
               bar is "SOME target holds content and the census was taken",
               not contentGap===0, so an honestly empty chart cannot be
               converted into a false failure. */
            var __scvCensus = historyReceipt.storeCensus || null;
            var __scvTargets = Number((__scvCensus && __scvCensus.targets) || 0);
            var __scvMeasured = !!(__scvCensus && __scvCensus.measured === true);
            var __scvHeld = Number((__scvCensus && __scvCensus.withContent) || 0);
            /* bob-1.0.0: history RAN if the caller asked for it OR if the census
               path deferred it into phase 2 and phase 2 actually read rows. A
               phase-2 read must face the same store bar as any other. */
            var __scvRan = includeHistory || (p1CensusHistoryDeferred === true && historyReceipt.skipped !== true);
            var __scvStoreOk = !__scvRan || __scvTargets === 0 || (__scvMeasured && __scvHeld > 0);
            var __scvReason = __scvStoreOk ? "" : (__scvMeasured ? "history-store-empty" : "history-store-unmeasured");
            historyReceipt.storeVerdict = { ok: __scvStoreOk, reason: __scvReason, measured: __scvMeasured,
              targets: __scvTargets, withContent: __scvHeld,
              contentVerified: historyReceipt.contentVerified === true,
              contentGap: Number(historyReceipt.contentGap || 0),
              changed: Number((historyReceipt.storeDelta && historyReceipt.storeDelta.changed) || 0),
              changeMeasured: !!(historyReceipt.storeDelta && historyReceipt.storeDelta.measured === true) };
            /* ===== end scv-1.0.0 ===== */
            var historyComplete = !includeHistory || !!(historyReceipt.complete && historyReceipt.exactIdentityVerified === true && __scvStoreOk);
            var __metadataFailure = p1MetadataFailure();
            if (!__metadataFailure && Number(opts.__p1MetadataStartSerial || 0) < p1MetadataFailureSerial) {
              __metadataFailure = { v: 1, at: Date.now(), reason: "metadata-persist-failed", error: "A local metadata write failed during this pull." };
            }
            if (__metadataFailure) {
              calendarReceipt.metadataPersistenceComplete = false;
              calendarReceipt.metadataPersistenceReason = String(__metadataFailure.reason || "metadata-persist-failed");
              res.metadataReceipt = __metadataFailure;
            }
            var complete = !!(r.receipt.complete && scheduleScopeComplete && identityBootstrapComplete && calendarReceipt.complete && historyComplete && !__metadataFailure);
            res.ok = complete; res.complete = complete;
            res.includeHistory = p1CensusHistoryRequested || includeHistory;
            res.historyRequested = p1CensusHistoryRequested || includeHistory;
            res.visitNotesRequested = visitNotesRequested !== null ? visitNotesRequested : (historyReceipt && typeof historyReceipt.visitNotesRequested === "boolean" ? historyReceipt.visitNotesRequested : undefined);
            res.visitNotesMode = fullNotesOff ? "day-facts" : (res.visitNotesRequested === true ? "full" : (historyReceipt && historyReceipt.visitNotesMode) || "unspecified"); /* dayfacts-1.0.1: one vocabulary at every level */
            /* bob-1.0.0: history is no longer skipped on the census path, so
               the field only fills when phase 2 genuinely had nothing to read. */
            res.historySkippedReason = (p1CensusHistoryDeferred && historyReceipt.skipped === true)
              ? String(historyReceipt.reason || "provider-attribution-unavailable") : "";
            res.censusHistoryPhaseTwo = p1CensusHistoryDeferred === true && historyReceipt.skipped !== true;
            /* bob-1.0.0: phase 2 reports its OWN verdict beside the census one.
               The census completion contract is unchanged by design - provider
               attribution is genuinely unavailable there - but a phase-2 that
               did not land must never hide behind the census green. */
            res.historyPhaseTwoComplete = res.censusHistoryPhaseTwo
              ? !!(historyReceipt.complete === true && historyReceipt.exactIdentityVerified === true && __scvStoreOk)
              : null;
            res.historyPhaseTwoFailures = res.censusHistoryPhaseTwo ? Number(historyReceipt.failures || 0) : 0;
            res.appointmentCensusOnly = p1AppointmentCensusComplete;
            res.providerAttributionComplete = providerComplete;
            res.reason = complete
              ? (p1AppointmentCensusComplete ? ((res.censusHistoryPhaseTwo && res.historyPhaseTwoComplete === true) ? "complete-appointment-census-with-history" : (res.censusHistoryPhaseTwo ? "complete-appointment-census-history-partial" : "complete-appointment-census-only")) : (res.reason === "provider-empty" ? "provider-empty" : (r.receipt.authoritativeEmpty ? "empty-day" : (includeHistory ? "complete" : "complete-schedule-only")))) /* bob-1.0.0 */
              : (__metadataFailure ? String(__metadataFailure.reason || "metadata-persist-failed") : (!scheduleScopeComplete ? "provider-unverified" : (!identityBootstrapComplete ? "identity-bootstrap-partial" : (!calendarReceipt.complete ? "calendar-partial" : (!__scvStoreOk && historyReceipt.complete === true ? __scvReason : (historyReceipt && historyReceipt.reason === "athena-tab-sleeping" ? "athena-tab-sleeping" : "history-partial"))))));
            res.scheduleVerified = r.scheduleVerified === true;
            res.providerRosterReceipt = currentProviderRosterReceipt;
            res.scheduleReceipt = r.receipt; res.providerReceipt = res.providerReceipt || null; res.calendarReceipt = calendarReceipt; res.historyReceipt = historyReceipt;
            res.retry = { schedule: false, calendarFailed: calendarReceipt.failed, calendarClass: calendarReceipt.failureClass, history: historyReceipt.retry || [] };
            if (p1AppointmentCensusComplete) res.retry.providerRoster = false;
            var scheduleSummary = calendarReceipt.accounted + "/" + calendarReceipt.attempted;
            /* b752: this fraction is the sentence the doctor acts on, so it must
               be MEASURED. processed and requested are both walk counters -
               requested is rows.length + unresolved.length and processed++ fires
               for a pure failure and for every patient regardless of whether the
               chart landed - so the pair reported 19/19 on a day that stored
               nothing. The census counts patients whose stored record actually
               holds clinical content, out of the days own targets. The walk
               counters remain the fallback for a receipt with no census (the
               schedule-only synthetic receipt), never a substitute for one. */
            var historyStoreCensus = historyReceipt.storeCensus || null;
            var historySummary = (historyStoreCensus && historyStoreCensus.measured === true)
              ? (Number(historyStoreCensus.withContent || 0) + "/" + Number(historyStoreCensus.targets || 0))
              : (historyReceipt.processed + "/" + historyReceipt.requested);
            var historyFailures = Number(historyReceipt.failures != null ? historyReceipt.failures : (historyReceipt.retry || []).length);
            /* tabhint-1.0.0 (2026-07-24, proven live): a run whose failures are
               mostly same-frame-name-mismatch is almost always MULTIPLE OPEN
               athenaOne TABS, not a reader problem. Evidence: a chart read
               proved "Joan Holliday" while the athenaOne tab in view showed a
               different chart entirely, and the following visits read resolved
               yet another tab parked on a third patient — so MLS opened the
               right chart in one tab and read a stale one in another. The
               identity gate refused correctly every time, which is exactly why
               no wrong-patient body was ever stored. The doctor cannot guess
               any of that from "same-frame-name-mismatch", so say the one thing
               that actually fixes it. */
            /* chartframe-1.0.0 (2026-07-24): the OTHER failure class a doctor
               cannot act on is the encounter index never being recognised —
               reasons no-chart-frame-candidate and encounter-index-incomplete.
               These are counted into "failures N" and then explained by
               nothing at all, which is worse than an ugly string: the doctor
               sees three patients missing with no statement of what happened,
               whether anything was saved, or whether a wrong chart was read.
               Confirmed live 2026-07-24: three of five patients failed this way
               for 93-160s each and the run reported only "failures 3".
               Deliberately makes NO repair suggestion. The mechanism is a
               reader defect (the real Visits frame is reached and refused
               inside the enumerate op), so telling the doctor to open or expand
               anything would be a guess, and a wrong instruction is worse than
               an honest "nothing you did caused this". Say only what is known:
               nothing was saved, nothing was misfiled, retrying is safe.
               These reasons are intentionally NOT in SWEEPABLE_REASON — the
               refusal is deterministic, so an automatic re-sweep would burn
               batch budget re-failing rather than recover anything. */
            /* qol-2.2 D6: the day-end line humanizes reason codes through the
               SAME mapper as the panel rows - two surfaces, one wording. */
            var __ppWhy = function (rWhy) { try { var pp = window.__mlsPullProgress; if (pp && typeof pp.humanWhy === "function") return pp.humanWhy(rWhy); } catch (eW) {} return String(rWhy || "").split(/[\[{]/)[0].trim() || "could not read"; };
            var __mismatch = 0, __noIndex = 0, __noTab = 0, __noStore = 0;
            try {
              (historyReceipt.patients || []).forEach(function (p) {
                var why = String((p && (p.visitsReason || p.chartReason || p.reason)) || "");
                if (/same-frame-name-mismatch/.test(why)) __mismatch++;
                else if (/storage-full-not-saved/.test(why)) __noStore++;
                else if (/no-chart-frame-candidate|encounter-index-incomplete/.test(why)) __noIndex++;
                else if (/no-athena-tab/.test(why)) __noTab++;
              });
            } catch (eMm) {}
            res.multiTabSuspected = __mismatch >= 2;
            res.encounterIndexUnreadable = __noIndex;
            /* sfp-1.0.1: NAME the signed-out session. `no-athena-tab` is what the
               picker returns when every athenaOne tab fails its session probe --
               i.e. athenaOne is signed out or timed out. It is in
               SWEEPABLE_REASON, so a dead session triggers up to three full
               automatic re-sweeps that re-fail every patient, and the clinician
               is finally told "deferred after timeout": a timing story for a
               sign-in problem. Nothing in this orchestrator ever said "athenaOne
               is signed out" -- "signin" and "signin-expired" above are the MLS
               backend session (/api/me), a different thing entirely.

               This pairs with the freshness notice: when athenaOne is signed
               out the SCHEDULE still scrapes (a painted grid needs no session)
               while every history read correctly refuses -- which is exactly
               the asymmetry the owner reported on 2026-07-25 and the shape
               recorded in tests/live-e2e-artifacts/2026-07-22-acceptance.md.
               Threshold 2, matching multiTabSuspected: one refusal can be a
               transient tab race, two in a row is the session. */
            /* p1-athena-presence-1.0.0: TWO no-athena-tab rows is the signal,
               but it is not the PROOF. On 2026-08-17 the lease-free presence
               verb answered presence-verified 5/5 within 80 ms while rows were
               failing this way, so "your athenaOne session has most likely
               signed out" was simply false. A presence answer newer than the
               batch outranks the count: claim the sign-out only when presence
               did NOT prove athena alive. No answer at all leaves the old
               behaviour exactly as it was. */
            res.athenaPresenceAtHistory = String((p1PresenceLast.resp && p1PresenceLast.resp.reason) || "");
            var __presenceAlive = !!(p1PresenceLast.at && Date.now() - p1PresenceLast.at < 300000 &&
              p1PresenceSaysAthenaLives(p1PresenceLast.resp));
            res.athenaSignedOutSuspected = __noTab >= 2 && !__presenceAlive;
            res.athenaBusySuspected = __noTab >= 2 && __presenceAlive;
            /* rr-1.1 + owner 2026-08-09 ("only 1 redo maybe"): a chart saved by
               the in-chart redo is a success WITH a redo, never a first-attempt
               success - the count rides the day line so it can never launder
               the first-attempt metric (supervisor rule). */
            var __redoN = 0;
            try { __redoN = ((historyReceipt && historyReceipt.patients) || []).filter(function (p) { return p && p.complete === true && p.axEntry === "body-depth"; }).length; } catch (eRedo) {}
            var __redoNote = __redoN ? " " + __redoN + " chart" + (__redoN === 1 ? " was" : "s were") + " saved on an automatic in-chart redo (counted separately, not first-attempt)." : "";
            var __p1ScopeNotice = p1AppointmentCensusComplete
              ? " Appointment census only: all exact appointment IDs were reconciled, but provider is blank and provider/practice coverage is not reported as complete."
              : providerScopeNotice(selectedProvider.mode);
            /* ===== notes-idle-1.0.0 (the DONE line stops sounding like a loss) =
               dn-1.0 named every refused day-note on the day line as "could not
               be read". Owner, 2026-08-18: "comments like this would scare a
               user" - and after this change it is also FALSE for most of those
               rows, because the leftover queue is going to read them the next
               time the doctor is idle. At DONE, a row is in exactly one of two
               honest states:
                 (a) there is NOTHING TO READ. tnReasonCode says `no-encounter`:
                     Athena has no visit note for that day. Finished, and said in
                     plain words - no reason code, no reader message.
                 (b) it is QUEUED. The pass ran out of budget, athenaOne was
                     slow, the tab was busy - all of which the idle catch-up
                     retries. It is not a failure; it has not finished.
               "could not be read" now belongs to exactly one place: the tray
               line the catch-up writes when a row has actually spent its
               attempts (niFinalLine). NAMES are gone from this line too - the
               day ledger still carries the per-patient detail, and this string
               rides a status surface that also reaches the quiet tray. */
            var __tnNote = "";
            try {
              var __tnList = ((historyReceipt && historyReceipt.patients) || []).filter(function (p) { return p && p.todayNote === false; });
              var __tnNoNote = __tnList.filter(function (p) { return tnReasonCode(p.todayNoteReason) === "no-encounter"; }).length;
              var __tnQueued = __tnList.length - __tnNoNote;
              var __tnBits = [];
              if (__tnQueued) __tnBits.push(__tnQueued + " visit note" + (__tnQueued === 1 ? "" : "s") + " will fill in quietly when you're idle \u2014 the charts themselves saved. Progress is under Integrations \u2192 Advanced integrations.");
              if (__tnNoNote) __tnBits.push(__tnNoNote + " appointment" + (__tnNoNote === 1 ? " had" : "s had") + " no visit note in Athena for that day.");
              if (__tnBits.length) __tnNote = " " + __tnBits.join(" ");
            } catch (eTnNote) {}
            var __chartOnly = 0; try { __chartOnly = ((historyReceipt && historyReceipt.patients) || []).filter(function (p) { return p && p.complete !== true && p.organized === true && p.dobVerified === true && !p.storageFailure; }).length; } catch (eCo) {}
            if (!complete) onStatus("Incomplete: schedule " + scheduleSummary + "; history " + historySummary + "; failures " + (calendarReceipt.failed + historyFailures) + ". It is safe to retry; MLS did not mark this pull complete." +
              (res.athenaSignedOutSuspected ? " " + __noTab + " charts could not be read because MLS could not find a signed-in athenaOne tab — your athenaOne session has most likely signed out or timed out. Sign in to athenaOne, then pull again. Note the schedule above was read off the grid athenaOne still had on screen, so treat it as of that moment rather than as of now." : "") +
              (res.athenaBusySuspected ? " " + __noTab + " charts could not be read at the moment MLS looked, but the athenaOne presence check answered '" + String(res.athenaPresenceAtHistory || "presence-verified").replace(/[^a-z-]/g, "") + "' — athenaOne is open and signed in, it was busy rendering. This is NOT a sign-out: retry those charts." : "") +
              (res.multiTabSuspected ? " " + __mismatch + " charts were refused because MLS read a DIFFERENT athenaOne tab than the one it opened — close every athenaOne tab except one and pull again. Nothing was saved to the wrong patient." : "") +
              (__noIndex ? " " + __noIndex + " chart" + (__noIndex === 1 ? "" : "s") + " could not be read (" + __ppWhy("no-chart-frame-candidate") + "), so " + (__noIndex === 1 ? "its" : "their") + " history was left untouched rather than saved as partial. Nothing was written to the wrong patient. This is an MLS reader limitation, not something you did." : "") +
              (__noStore ? " " + __noStore + " chart" + (__noStore === 1 ? " was" : "s were") + " read correctly, but MLS could not verify the latest save on this device. Keep this tab open, check available storage, then retry those charts." : "") +
              (function () { /* srr-1.2: name the failing set AT DAY END - a month run whose failures are invisible until completion cannot be stopped on sight (supervisor 2026-08-08) */ try { var fl = ((historyReceipt && historyReceipt.patients) || []).filter(function (p) { return p && p.complete !== true; }).slice(0, 8).map(function (p) { return (String(p.name || "").split(/\s+/)[0] || ("#" + String(p.patientId || "????").slice(-4))) + " (" + __ppWhy(String(p.reason || "unread")).slice(0, 40) + ")"; }); return fl.length ? " Charts needing retry: " + fl.join("; ") + "." : ""; } catch (eFl) { return ""; } })() + (__chartOnly ? " " + __chartOnly + " of the incomplete chart" + (__chartOnly === 1 ? "" : "s") + " DID save the six-card chart summary \u2014 only the visit notes are incomplete; Retry re-reads just those." : "") + contentNotice(historyReceipt) + __redoNote + __tnNote, "err");
            else if (!includeHistory && !res.censusHistoryPhaseTwo) onStatus("Schedule-only complete: " + scheduleSummary + " appointments accounted for; " + (p1CensusHistoryDeferred ? "chart history was intentionally skipped because provider attribution is unavailable for this appointment census." : "history was not requested by this caller.") + freshnessNotice(r) + __p1ScopeNotice, "ok"); /* dayfacts-1.0.0: !includeHistory no longer correlates with the checkbox - the OFF wording here would misattribute a census/caller skip */
            else if (!includeHistory) onStatus("Appointment census + history: schedule " + scheduleSummary + "; history " + historySummary + "; failures " + historyFailures + ". Provider stays blank for this census; the chart reads are reported on their own." + freshnessNotice(r) + __p1ScopeNotice + contentNotice(historyReceipt) + __tnNote, historyFailures ? "err" : "ok"); /* bob-1.0.0 */
            else onStatus("Verified complete: schedule " + scheduleSummary + "; history " + historySummary + "; failures 0." + freshnessNotice(r) + __p1ScopeNotice + contentNotice(historyReceipt) + __redoNote + __tnNote, "ok");
            return res;
          });
          });
        });
        });
      });
    });
    }
  }

  /* Hold one origin-scoped Web Lock for the managed pull lifetime. The lock is
     released by the platform when the returned promise settles, including all
     deadline failures. ifAvailable prevents an old/other MLS tab from queuing
     a surprise pull later; the user must explicitly retry instead. */
  /* ---------------------------------------------------------------------
     pr-1.0.0 — a pull survives a refresh or leaving the page.
     Owner 2026-07-24: "it should keep pulling and working even if I refresh or
     go to a different page." The pull engine lives in the page, so a reload
     used to kill it silently and throw away 15-45 minutes of work with no
     trace. The pull now records a RESUME INTENT before it starts and clears it
     only when the day is genuinely complete; the next load picks it up and
     continues where it left off. si-2.0.0 carries make that cheap — patients
     already verified are skipped in seconds, so a resume pays only for the
     work that was actually still outstanding.
     Bounded on purpose: a stale intent is dropped, at most 2 automatic
     resumes are attempted (a day that keeps failing must not loop forever), a
     pull running in another tab is never disturbed, and the doctor always sees
     the offer with a way to decline it.

     ===== p1-resume-honesty-1.0.0 (2026-08-17, MEASURED HIJACK) =============
     A pull of 2026-08-25 ended `nav-failed` and left its record behind. In
     ANOTHER tab whose selected day was 2026-08-17 the doctor pressed "Pull
     today" — and _lastPullResult().target came back 2026-08-25, repeatedly,
     with nothing on screen to explain why "pulling isn't working". The 10 s
     countdown card had IMPOSED the stale record's day.

     Four changes, each aimed at that mechanism:
       (a) the offer is only ever made for the day the doctor is looking at,
       (b) it is OFFERED, never imposed — no countdown, no auto-start, so a
           plain Pull click is always a fresh pull of the selected day,
       (c) a pull that reached a TERMINAL verdict clears its record (an honest
           partial still keeps it, which is the whole point of pr-1.0.0), and
           a record older than RESUME_MAX_AGE_MS expires,
       (d) the record carries the writing TAB's id (sessionStorage, so it
           survives that tab's reload and no other tab's), and a record stamped
           by a different tab is never adopted.
     --------------------------------------------------------------------- */
  var RESUME_MAX_AGE_MS = 6 * 60 * 60 * 1000, RESUME_MAX_ATTEMPTS = 2;
  /* p1-resume-honesty-1.0.0 (d): a per-TAB id. sessionStorage is scoped to one
     tab and survives that tab's reloads, which is exactly the lifetime an
     interrupted pull's record should have. When sessionStorage is unavailable
     the id is per page load, and a record with NO tabId at all (legacy, or
     seeded by a test) stays adoptable so nothing already durable is orphaned. */
  var P1_TAB_ID = "";
  function p1TabId() {
    if (P1_TAB_ID) return P1_TAB_ID;
    var got = safe(function () { return window.sessionStorage && window.sessionStorage.getItem("mlsP1PullTabV1"); }, null);
    if (got && /^[A-Za-z0-9_-]{1,64}$/.test(String(got))) { P1_TAB_ID = String(got); return P1_TAB_ID; }
    P1_TAB_ID = "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    safe(function () { if (window.sessionStorage) window.sessionStorage.setItem("mlsP1PullTabV1", P1_TAB_ID); });
    return P1_TAB_ID;
  }
  /* The day the doctor is LOOKING AT. The visit strip owns it; the calendar
     selection and the account day are the fallbacks, in that order. Never the
     record's own date — that is the value this gate exists to distrust. */
  function p1SelectedDayKey() {
    var fromStrip = safe(function () {
      var ds = window.__mlsDaySwitch;
      return (ds && isFn(ds.currentDay)) ? normDate(ds.currentDay()) : "";
    }, "");
    if (fromStrip) return fromStrip;
    var sel = normDate(safe(function () { return window._calSelDay; }, ""));
    if (sel) return sel;
    var ref = normDate(safe(function () { return window._calRefDate; }, ""));
    if (ref) return ref;
    return normDate(estTodayKey()) || "";
  }
  /* (c) THE TERMINAL SET. A verdict in here answered the doctor's question —
     keeping a resume record after it is what let a dead 2026-08-25 pull come
     back to life on a different day. Everything NOT in here (an honest
     partial, an attribution/census refusal, a provider scope that needs the
     clinician) stays resumable exactly as pr-1.0.0 intended. */
  var P1_RESUME_TERMINAL_REASONS = {
    "nav-failed": 1, "wrong-day": 1, "no-athena-tab": 1, "no-ext": 1,
    "signin": 1, "signin-expired": 1, "athena-session-expired": 1,
    "verified-empty": 1, "stopped-by-user": 0
  };
  function p1ResumeVerdictIsTerminal(value) {
    if (!value || typeof value !== "object") return false;
    if (value.complete === true) return true;                       /* complete */
    var reason = String(value.reason || "");
    if (P1_RESUME_TERMINAL_REASONS[reason] === 1) return true;
    /* a history-partial WITH a receipt has already told the doctor exactly
       which charts to retry, and Retry-failed-histories is the control for
       that — resuming the whole day on the next load is not. */
    if (reason === "history-partial" && value.historyReceipt && typeof value.historyReceipt === "object") return true;
    /* an authoritatively EMPTY day has nothing left to read */
    if (value.scheduleReceipt && value.scheduleReceipt.authoritativeEmpty === true) return true;
    return false;
  }
  function resumeKey() { return safe(function () { return isFn(window.uns) ? window.uns("pullResumeV1") : "pullResumeV1"; }, "pullResumeV1"); }
  function resumeGet() {
    var key = resumeKey();
    try { var r = window.localStorage.getItem(key); return r ? JSON.parse(r) : null; }
    catch (eResumeRead) { p1RememberMetadataFailure(key, p1MetadataFailureKind(eResumeRead), eResumeRead); return null; }
  }
  function resumeSave(rec) {
    var key = resumeKey(), raw = safe(function () { return JSON.stringify(rec); }, "");
    if (!raw) return { ok: false, reason: "metadata-persist-failed", receipt: p1RememberMetadataFailure(key, "metadata-persist-failed") };
    return p1VerifiedMetadataSet(key, raw);
  }
  function resumeClear() { return p1VerifiedMetadataRemove(resumeKey()); }
  var P1_RESUME_SCOPE_SOURCES = { "day-caller": 1, "day-account": 1, "month": 1, "direct": 1 };
  function p1ResumeScopeSource(value) {
    value = String(value || "direct");
    return P1_RESUME_SCOPE_SOURCES[value] === 1 ? value : "direct";
  }
  function p1ResumeIdentityField(value) {
    value = String(value == null ? "" : value).trim();
    if (!value || value.length > 160 || /[\x00-\x1f\x7f]/.test(value)) return "";
    return value;
  }
  function p1ResumeScopeForProvider(raw, source) {
    var req = providerRequest(raw), canonical = req;
    if (req.mode === "selected") {
      var gate = safe(function () { return resolveProviderRequest(raw, { allowAll: true, requireRosterForAll: false, allowDetectedProvider: true }); }, null);
      if (gate && gate.ok === true && providerRequest(gate.provider).mode === "selected") canonical = providerRequest(gate.provider);
    }
    if (req.mode === "all") return { v: 1, mode: "all", source: p1ResumeScopeSource(source) };
    return {
      v: 1, mode: "selected", source: p1ResumeScopeSource(source),
      id: p1ResumeIdentityField(canonical.id),
      stableKey: p1ResumeIdentityField(canonical.stableKey)
    };
  }
  function p1SanitizeResumeScope(raw) {
    if (!raw || typeof raw !== "object" || Number(raw.v) !== 1) return null;
    var source = String(raw.source || ""), mode = String(raw.mode || "");
    if (P1_RESUME_SCOPE_SOURCES[source] !== 1 || (mode !== "all" && mode !== "selected")) return null;
    var rawId = raw.id == null ? "" : String(raw.id), rawStable = raw.stableKey == null ? "" : String(raw.stableKey);
    if (rawId.length > 160 || rawStable.length > 160 || /[\x00-\x1f\x7f]/.test(rawId + rawStable)) return null;
    var id = p1ResumeIdentityField(rawId), stableKey = p1ResumeIdentityField(rawStable);
    if (mode === "all") return (id || stableKey) ? null : { v: 1, mode: "all", source: source };
    if (!id && !stableKey) return null;
    return { v: 1, mode: "selected", source: source, id: id, stableKey: stableKey };
  }
  function p1ResumeScopeSignature(scope) {
    return scope ? [scope.v, scope.mode, scope.source, scope.id || "", scope.stableKey || ""].join("|") : "";
  }
  function p1ResolveResumeProvider(scope) {
    if (!scope) return null;
    if (scope.mode === "all") return "all";
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    if (!(roster && isFn(roster.resolve))) return null;
    var entry = safe(function () { return roster.resolve(scope.stableKey || scope.id); }, null);
    if (!entry || !entry.name || !entry.stableKey) return null;
    var entryId = p1ResumeIdentityField(entry.id), entryStable = p1ResumeIdentityField(entry.stableKey);
    if ((scope.id && entryId !== scope.id) || (scope.stableKey && entryStable !== scope.stableKey)) return null;
    var gate = safe(function () {
      return resolveProviderRequest({ id: entryId, stableKey: entryStable, raw: String(entry.raw || entry.name), name: String(entry.name), rosterVerified: entry.rosterVerified === true },
        { allowAll: false, allowDetectedProvider: true });
    }, null);
    return gate && gate.ok === true ? gate.provider : null;
  }
  function p1PersistResumeIntent(date, opts, provider, source, censusEligible) {
    opts = opts || {};
    var prev = resumeGet();
    var rec = {
      date: String(date || ""), startedAt: Date.now(),
      attempts: (prev && prev.date === String(date || "")) ? Number(prev.attempts || 0) : 0,
      includeHistory: opts.includeHistory !== false,
      bodies: (typeof opts.pullVisitBodies === "boolean") ? opts.pullVisitBodies : null,
      providerScope: p1ResumeScopeForProvider(provider, source),
      p1CensusEligible: censusEligible === true,
      /* p1-resume-honesty-1.0.0 (d): whose interruption this was */
      tabId: p1TabId()
    };
    rec.persistence = resumeSave(rec);
    return rec;
  }
  function resumeBusyElsewhere() {
    var k = safe(function () { return isFn(window.uns) ? window.uns("mlsPullBusyXTabV1") : "mlsPullBusyXTabV1"; }, "mlsPullBusyXTabV1");
    var at = safe(function () { return Number(window.localStorage.getItem(k) || 0); }, 0);
    return !!(at && Date.now() - at < 90000);
  }

  /* N4: an explicit per-pull "Full visit notes" choice, in force for exactly one
     pull. null = no override, use this device's stored preference (the previous
     and still-default behaviour). Never persisted — a remote request must not
     rewrite the office computer's own saved setting. */
  var _pullBodiesOverride = null;

  /* ===== fnc-1.0.0 (one admission gate for every public pull entry) ========
     The visible day strip and Staff Prep already froze the Full Visit Notes
     choice, but several still-loaded alternate owners (Copilot actions,
     patient picker, Simple Visit, legal sync and calendar month controls)
     called __mlsSI directly. An unset account therefore inherited the old
     default-ON reader, and a month with no explicit boolean re-read mutable
     storage once per day. One public engine guard closes both holes:
       - no Athena work starts until the account has an explicit human choice;
       - the answer is copied onto this operation as a real boolean;
       - every retry/day in that operation receives the same frozen boolean.
     Explicit callers (including relay and durable resume) pay no extra read or
     dialog. The low-level history batch retains its diagnostic/test seam; all
     real day/month entrypoints pass through pull/dayPull/pullMonth below. */
  function visitNotesChoiceRefusal(opts, reason) {
    reason = String(reason || "choice-check-failed");
    var message = reason === "choice-cancelled"
      ? "Pull not started — choose how full visit notes should be handled, then try again."
      : (reason === "account-namespace-not-settled"
        ? "Pull not started — your account settings are still loading. Try again in a moment."
        : (reason === "choice-dialog-unavailable"
          ? "Pull not started — the full-visit-notes choice is not ready on this build. Refresh MLS and try again."
          : "Pull not started — MLS could not confirm your full-visit-notes choice. Nothing was read from Athena. Try again."));
    safe(function () { if (opts && isFn(opts.onStatus)) opts.onStatus(message, reason === "choice-cancelled" ? "" : "err"); });
    return {
      ok: false, complete: false, reason: reason, gate: "visit-notes-choice",
      error: message, includeHistory: !(opts && opts.includeHistory === false),
      target: String((opts && (opts.date || opts.month)) || ""), retry: {}
    };
  }
  function admitFrozenVisitNotesChoice(opts, owner) {
    opts = opts || {};
    if (typeof opts.pullVisitBodies === "boolean") return null;
    var pref = safe(function () { return window.__mlsVisitNotesPref; }, null);
    if (!(pref && isFn(pref.ensureChosenForBulkPull))) {
      return Promise.resolve(visitNotesChoiceRefusal(opts, "choice-dialog-unavailable"));
    }
    var request = null;
    try { request = pref.ensureChosenForBulkPull(); }
    catch (eChoiceStart) { return Promise.resolve(visitNotesChoiceRefusal(opts, "choice-check-failed")); }
    return Promise.resolve(request).then(function (choice) {
      if (!(choice && choice.ok === true && typeof choice.on === "boolean")) {
        return visitNotesChoiceRefusal(opts, choice && choice.reason);
      }
      var frozen = {};
      for (var key in opts) if (Object.prototype.hasOwnProperty.call(opts, key)) frozen[key] = opts[key];
      frozen.pullVisitBodies = choice.on === true;
      return owner(frozen);
    }, function () { return visitNotesChoiceRefusal(opts, "choice-check-failed"); });
  }
  /* ===== end fnc-1.0.0 ==================================================== */

  function pull(opts) {
    opts = opts || {};
    var __visitNotesAdmission = admitFrozenVisitNotesChoice(opts, pull);
    if (__visitNotesAdmission) return __visitNotesAdmission;
    var __monthOwned = !!(monthOwnerCapability && opts.__p1MonthOwnerToken === monthOwnerCapability);
    var __foreignMonth = p1MonthForeignOwner();
    if ((monthPullRunning && !__monthOwned) || (__foreignMonth && !__monthOwned)) return Promise.resolve(p1MonthOverlapRefusal(opts.onStatus, __foreignMonth && __foreignMonth.storageFailure ? "metadata-persist-failed" : "pull-in-flight"));
    var __metadataBefore = p1MetadataRefusal(opts.onStatus);
    if (__metadataBefore) return Promise.resolve(__metadataBefore);
    opts.__p1MetadataStartSerial = p1MetadataFailureSerial;
    var __resumeDate = String(opts.date || "");
    var __ownedPull = false;
    var run = function () {
      /* qol-2.2: only an explicit boolean overrides, and it is armed INSIDE
         the managed operation - a REFUSED second call used to overwrite the
         RUNNING pull's lane here and then clear it in its settle path. */
      __ownedPull = true;
      /* p1-resume-honesty-1.0.0: the intent is written by the pull that
         actually ACQUIRED the engine. It used to be written before the mutex,
         so a second click that was about to be refused re-stamped the RUNNING
         pull's record with its own day - the same overwrite qol-2.2 already
         had to fix for the bodies lane. */
      if (__resumeDate) {
        /* p1-resume-scope-1.0.0: the durable intent carries the same frozen
           provider scope as the interrupted pull. Only strong provider ids/keys
           are stored (never display names), and resume re-resolves them against
           the current complete roster instead of widening a selected pull. */
        var __resumeIntent = p1PersistResumeIntent(__resumeDate, opts, opts.provider,
          opts.__p1ResumeScopeSource || "direct",
          opts.__p1DayCensusToken === P1_DAY_CENSUS_TOKEN);
        if (!(__resumeIntent.persistence && __resumeIntent.persistence.ok === true)) {
          return p1MetadataRefusal(opts.onStatus) ||
            { ok: false, complete: false, reason: "metadata-persist-failed", includeHistory: opts.includeHistory !== false, retry: {} };
        }
      }
      _pullBodiesOverride = (typeof opts.pullVisitBodies === "boolean") ? opts.pullVisitBodies : null;
      return withPatientBatch("schedule-pull", function (token) {
        var runOpts = {};
        for (var k in opts) if (opts.hasOwnProperty(k)) runOpts[k] = opts[k];
        runOpts.__patientStoreBatch = token;
        return pullUnlocked(runOpts);
      });
    };
    return runManagedAthenaOperation(run, function (scope) {
      /* ===== p1-busy-click-1.0.0 (a second click is not a failed pull) =====
         MEASURED live 2026-08-17: a second Pull press during the schedule
         phase painted "The pull did not return a verified completion receipt
         (pull-in-flight). Nothing is being reported as complete." over a pull
         that was running perfectly well. Scary, and false. Say the calm true
         thing, and mark the stub so nothing downstream mistakes it for the
         running pull's verdict. */
      return { ok: false, complete: false, reason: "pull-in-flight", busyInFlight: true, gate: "engine-in-flight",
        error: scope === "other-tab"
        ? "Another MLS tab is already running an explicit pull. Nothing else was started."
        : "This pull is already running — watch the progress just below.", includeHistory: opts.includeHistory !== false, retry: {} };
    }).then(function (value) {
      if (__ownedPull) _pullBodiesOverride = null;          /* one pull only */
      /* p1-busy-click-1.0.0: a busy stub is a refusal to START, not a result.
         Overwriting lastPullResult with it destroyed the running pull's
         receipt for every surface that reads _lastPullResult(). */
      if (!(value && value.busyInFlight === true)) lastPullResult = value || null;
      /* p1-resume-honesty-1.0.0 (c): a TERMINAL verdict clears the record. An
         honest partial still keeps it, which is what pr-1.0.0 is for. */
      if (__resumeDate && __ownedPull && value && value.complete !== true && p1ResumeVerdictIsTerminal(value)) {
        safe(function () { resumeClear(); });
      }
      /* Clear the intent only when the day is genuinely finished. An honest
         partial keeps it, so the next load continues instead of forgetting. */
      if (__resumeDate && value && value.complete === true) {
        var __resumeClear = resumeClear();
        if (!(__resumeClear && __resumeClear.ok === true)) {
          value.ok = false; value.complete = false;
          value.reason = __resumeClear && __resumeClear.reason || "metadata-persist-failed";
          value.metadataReceipt = __resumeClear && (__resumeClear.receipt || __resumeClear) || p1MetadataFailure();
          if (isFn(opts.onStatus)) opts.onStatus("The pull finished, but its resume receipt could not be cleared safely. Reload MLS and try again after freeing local storage.", "err");
        }
      }
      return value;
    }, function (err) {
      /* A failed pull must not leave a remote caller's choice in force for the
         NEXT one, which could be a local pull by the doctor at that desk. */
      if (__ownedPull) _pullBodiesOverride = null;
      throw err;
    });
  }

  /* ql-1.0 (stale-quota-latch 2026-08-11): THE reality adjudicator for the
     __mlsStoreWriteFailed latch, shared by the day and month quota
     preflights. Returns true (and clears the latch + refreshes the qv chip)
     ONLY when the sj-2.0 store's own receipt proves current confirmed
     durable writes: idb mode, hydrated, gen==confirmedGen, wbFailures===0,
     degraded false. Anything less - ls mode, store absent or not ready,
     lagging or degraded write-behind - returns false and the loud refusal
     stands untouched. Keep the predicate in lockstep with qvStoreHealthy
     (mls-connect.js qv-1.2). */
  function _quotaLatchStale() {
    return safe(function () {
      var qg = window.__mlsQuotaGuard;
      return !!(qg && typeof qg._recover === "function" && qg._recover("pull-preflight") === true);
    }, false);
  }

  var monthPullRunning = false, monthOwnerToken = "", monthOwnerCapability = null, monthOwnerTimer = null, monthOwnerLost = false, monthLockRelease = null;
  var monthOwnerClaimPending = false, monthOwnerStorageKey = "", monthOwnerHeartbeatKey = "", monthOwnerScopeProof = "", monthOwnerScopeEpoch = 0;
  var P1_MONTH_OWNER_TTL_MS = 180000, P1_MONTH_OWNER_SETTLE_MS = 90, P1_MONTH_SCOPE_FAILURE_KEY = "@p1-month-account-scope";
  function p1MonthOwnerScope() {
    try {
      if (!isFn(window.uns)) return null;
      /* Keep the established owner key/version so a rolling/reloaded P1 bundle
         still sees an older live lease; the additive heartbeat is optional. */
      var suffix = "p1MonthPullOwnerV1", probeSuffix = "p1MonthPullScopeProbeV2";
      var key = String(window.uns(suffix) || ""), probe = String(window.uns(probeSuffix) || "");
      if (!key || !probe || key === suffix || probe === probeSuffix || key.slice(-suffix.length) !== suffix || probe.slice(-probeSuffix.length) !== probeSuffix) return null;
      var prefix = key.slice(0, key.length - suffix.length), probePrefix = probe.slice(0, probe.length - probeSuffix.length);
      /* `uns()` uses an underscore only before a session is owned. It is a
         placeholder, not an account namespace, and must never own a month. */
      if (!prefix || prefix !== probePrefix || /(?:^|::)_::$/.test(prefix)) return null;
      var accountKnown = Object.prototype.hasOwnProperty.call(window, "__mlsSessionAccount");
      var account = String(safe(function () { return window.__mlsSessionAccount; }, "") || "").trim().toLowerCase();
      if (accountKnown && (!account || prefix.toLowerCase().indexOf("::" + account + "::") < 0)) return null;
      p1ProveMetadataRecovery(P1_MONTH_SCOPE_FAILURE_KEY, "scope", 0);
      return { key: key, proof: prefix, epoch: Math.max(0, Number(safe(function () { return window.__mlsSessionEpoch; }, 0) || 0)) };
    } catch (eMonthScope) { return null; }
  }
  function p1MonthHeartbeatKey(key, token) { return String(key || "") + "::heartbeat::" + String(token || ""); }
  function p1MonthOwnerSnapshot(scope) {
    if (!scope || !scope.key) return { ok: false, reason: "account-scope-unverified" };
    var raw, parsed = null, heartbeat = null;
    try {
      raw = localStorage.getItem(scope.key);
      if (!raw) return { ok: true, owner: null, fresh: false };
      parsed = JSON.parse(raw);
      if (!parsed || (parsed.v !== 1 && parsed.v !== 2) || !/^p1-month-[a-z0-9]{6,24}$/.test(String(parsed.id || ""))) throw new Error("invalid month owner receipt");
    } catch (eMonthOwnerRead) {
      var reason = p1MetadataFailureKind(eMonthOwnerRead), failure = p1RememberMetadataFailure(scope.key, reason, eMonthOwnerRead, "read", 0);
      return { ok: false, reason: reason, receipt: failure };
    }
    var heartbeatKey = p1MonthHeartbeatKey(scope.key, parsed.id);
    try {
      var heartbeatRaw = localStorage.getItem(heartbeatKey);
      if (heartbeatRaw) heartbeat = JSON.parse(heartbeatRaw);
    } catch (eMonthHeartbeatRead) {
      var heartbeatReason = p1MetadataFailureKind(eMonthHeartbeatRead), heartbeatFailure = p1RememberMetadataFailure(heartbeatKey, heartbeatReason, eMonthHeartbeatRead, "read", 0);
      return { ok: false, reason: heartbeatReason, receipt: heartbeatFailure, owner: parsed };
    }
    var heartbeatValid = !!(heartbeat && heartbeat.v === 1 && String(heartbeat.id || "") === String(parsed.id));
    var stamp = heartbeatValid ? Number(heartbeat.at || 0) : (parsed.v === 1 ? Number(parsed.at || 0) : 0);
    var age = Date.now() - stamp, fresh = !!(isFinite(age) && age >= 0 && age < P1_MONTH_OWNER_TTL_MS);
    return { ok: true, owner: parsed, fresh: fresh, heartbeatKey: heartbeatKey, heartbeat: heartbeatValid ? heartbeat : null };
  }
  function p1MonthForeignOwner() {
    var scope = p1MonthOwnerScope();
    /* A day pull need not depend on month metadata when no account namespace
       exists: an unscoped month cannot be acquired in the first place. */
    if (!scope) return null;
    var snapshot = p1MonthOwnerSnapshot(scope);
    if (!snapshot.ok) return { storageFailure: true };
    if (!snapshot.owner || !snapshot.fresh) return null;
    if (monthOwnerToken && monthOwnerStorageKey === scope.key && String(snapshot.owner.id) === monthOwnerToken) return null;
    return snapshot.owner;
  }
  function p1MonthCandidateStillHeld(candidate) {
    if (!candidate || !candidate.token || !candidate.scope) return false;
    var current = p1MonthOwnerScope();
    if (!current || current.key !== candidate.scope.key || current.proof !== candidate.scope.proof || (candidate.scope.epoch > 0 && current.epoch > 0 && current.epoch !== candidate.scope.epoch)) return false;
    var snapshot = p1MonthOwnerSnapshot(candidate.scope);
    return !!(snapshot.ok && snapshot.fresh && snapshot.owner && String(snapshot.owner.id) === candidate.token);
  }
  function p1MonthOwnerStillHeld() {
    if (!monthOwnerToken || !monthOwnerStorageKey || !monthOwnerHeartbeatKey) return false;
    return p1MonthCandidateStillHeld({ token: monthOwnerToken, heartbeatKey: monthOwnerHeartbeatKey, scope: { key: monthOwnerStorageKey, proof: monthOwnerScopeProof, epoch: monthOwnerScopeEpoch } });
  }
  function p1CleanupMonthCandidate(candidate) {
    if (!candidate) return { ok: true };
    var ownerRemoval = { ok: true }, heartbeatRemoval = { ok: true };
    try {
      var raw = localStorage.getItem(candidate.scope.key), parsed = raw ? JSON.parse(raw) : null;
      if (parsed && String(parsed.id || "") === candidate.token) ownerRemoval = p1VerifiedMetadataRemove(candidate.scope.key);
    } catch (eCandidateCleanupRead) {
      var readReason = p1MetadataFailureKind(eCandidateCleanupRead), readFailure = p1RememberMetadataFailure(candidate.scope.key, readReason, eCandidateCleanupRead, "read", 0);
      ownerRemoval = { ok: false, reason: readReason, receipt: readFailure };
    }
    heartbeatRemoval = p1VerifiedMetadataRemove(candidate.heartbeatKey);
    return { ok: ownerRemoval.ok === true && heartbeatRemoval.ok === true, reason: ownerRemoval.ok !== true ? (ownerRemoval.reason || "metadata-persist-failed") : (heartbeatRemoval.reason || "metadata-persist-failed"), metadataReceipt: ownerRemoval.receipt || heartbeatRemoval.receipt || null };
  }
  function p1PrepareMonthCandidate(scope) {
    if (!scope) {
      var scopeFailure = p1RememberMetadataFailure(P1_MONTH_SCOPE_FAILURE_KEY, "metadata-persist-failed", null, "scope", 0);
      return { ok: false, reason: "account-scope-unverified", metadataReceipt: scopeFailure };
    }
    if (monthPullRunning || monthOwnerToken || pullRunning || foreignPullLease()) return { ok: false, reason: "pull-in-flight" };
    var snapshot = p1MonthOwnerSnapshot(scope);
    if (!snapshot.ok) return { ok: false, reason: snapshot.reason || "metadata-persist-failed", metadataReceipt: snapshot.receipt || null };
    if (snapshot.owner && snapshot.fresh) return { ok: false, reason: "pull-in-flight" };
    var token = "p1-month-" + (Math.random().toString(36).slice(2, 12) + "0000000000").slice(0, 10), now = Date.now();
    var candidate = { token: token, scope: scope, heartbeatKey: p1MonthHeartbeatKey(scope.key, token) };
    var heartbeat = p1VerifiedMetadataSet(candidate.heartbeatKey, JSON.stringify({ v: 1, id: token, at: now }));
    if (!heartbeat.ok) return { ok: false, reason: heartbeat.reason, metadataReceipt: heartbeat.receipt || null };
    var owner = p1VerifiedMetadataSet(scope.key, JSON.stringify({ v: 1, id: token, at: now, heartbeat: 1 }));
    if (!owner.ok) {
      p1VerifiedMetadataRemove(candidate.heartbeatKey);
      return { ok: false, reason: owner.reason, metadataReceipt: owner.receipt || null };
    }
    if (!p1MonthCandidateStillHeld(candidate)) {
      p1CleanupMonthCandidate(candidate);
      return { ok: false, reason: "pull-in-flight", metadataReceipt: p1MetadataFailure() };
    }
    return { ok: true, candidate: candidate };
  }
  function p1ActivateMonthCandidate(candidate) {
    if (!p1MonthCandidateStillHeld(candidate)) return { ok: false, reason: "pull-in-flight", metadataReceipt: p1MetadataFailure() };
    monthOwnerToken = candidate.token; monthOwnerStorageKey = candidate.scope.key; monthOwnerHeartbeatKey = candidate.heartbeatKey;
    monthOwnerScopeProof = candidate.scope.proof; monthOwnerScopeEpoch = candidate.scope.epoch; monthOwnerCapability = {}; monthOwnerLost = false; monthPullRunning = true; claimSiLease();
    monthOwnerTimer = setInterval(function () {
      if (!monthOwnerToken || monthOwnerLost) return;
      if (!p1MonthOwnerStillHeld()) { monthOwnerLost = true; safe(function () { window.__mlsPullStopRequested = true; }); return; }
      /* Heartbeats are token-specific. A stale tab can update only its own
         retired heartbeat; it can never overwrite a replacement owner in the
         compare-to-write gap. */
      var refreshed = p1VerifiedMetadataSet(monthOwnerHeartbeatKey, JSON.stringify({ v: 1, id: monthOwnerToken, at: Date.now() }));
      if (!refreshed.ok || !p1MonthOwnerStillHeld()) { monthOwnerLost = true; safe(function () { window.__mlsPullStopRequested = true; }); }
    }, 25000);
    return { ok: true, token: monthOwnerCapability };
  }
  function p1ClaimMonthOwnerCore(scope) {
    var prepared = p1PrepareMonthCandidate(scope);
    if (!prepared.ok) return prepared;
    var activated = p1ActivateMonthCandidate(prepared.candidate);
    if (activated && activated.ok) return activated;
    var cleanup = p1CleanupMonthCandidate(prepared.candidate);
    return {
      ok: false,
      reason: cleanup.ok === true ? String(activated && activated.reason || 'pull-in-flight') : String(cleanup.reason || 'metadata-persist-failed'),
      metadataReceipt: cleanup.metadataReceipt || (activated && activated.metadataReceipt) || p1MetadataFailure()
    };
  }
  function p1MonthSettle() { return new Promise(function (resolve) { setTimeout(resolve, P1_MONTH_OWNER_SETTLE_MS); }); }
  function p1ClaimMonthOwnerFallback(scope) {
    var prepared = p1PrepareMonthCandidate(scope);
    if (!prepared.ok) return Promise.resolve(prepared);
    var candidate = prepared.candidate;
    /* Two separated observations make a simultaneous last-writer visible.
       The protocol never refreshes the shared pointer afterward; if a browser
       cannot keep the same candidate visible through both observations, it
       fails closed instead of starting Athena navigation. */
    return p1MonthSettle().then(function () {
      if (!p1MonthCandidateStillHeld(candidate)) throw { p1Arbitration: true };
      return p1MonthSettle();
    }).then(function () {
      if (!p1MonthCandidateStillHeld(candidate)) throw { p1Arbitration: true };
      var activated = p1ActivateMonthCandidate(candidate);
      if (activated && activated.ok) return activated;
      var activationCleanup = p1CleanupMonthCandidate(candidate);
      return { ok: false, reason: activationCleanup.ok === true ? "pull-in-flight" : (activationCleanup.reason || "metadata-persist-failed"), metadataReceipt: activationCleanup.metadataReceipt || p1MetadataFailure() };
    }).catch(function (error) {
      var cleanup = p1CleanupMonthCandidate(candidate);
      return { ok: false, reason: cleanup.ok === true && error && error.p1Arbitration ? "pull-in-flight" : (cleanup.reason || "metadata-persist-failed"), metadataReceipt: cleanup.metadataReceipt || p1MetadataFailure() };
    });
  }
  function p1ClaimMonthOwner() {
    if (monthPullRunning || monthOwnerClaimPending || monthOwnerToken || monthLockRelease) return Promise.resolve({ ok: false, reason: "pull-in-flight" });
    var scope = p1MonthOwnerScope();
    if (!scope) {
      var scopeFailure = p1RememberMetadataFailure(P1_MONTH_SCOPE_FAILURE_KEY, "metadata-persist-failed", null, "scope", 0);
      return Promise.resolve({ ok: false, reason: "account-scope-unverified", metadataReceipt: scopeFailure });
    }
    monthOwnerClaimPending = true;
    var locks = safe(function () { return navigator && navigator.locks && isFn(navigator.locks.request) ? navigator.locks : null; }, null);
    if (!locks) return p1ClaimMonthOwnerFallback(scope).then(function (result) { monthOwnerClaimPending = false; return result; }, function () { monthOwnerClaimPending = false; return { ok: false, reason: "metadata-persist-failed", metadataReceipt: p1MetadataFailure() }; });
    var readyResolve, readySettled = false, heldResolve;
    var ready = new Promise(function (resolve) { readyResolve = resolve; });
    var held = new Promise(function (resolve) { heldResolve = resolve; });
    var attemptRelease = function () { if (heldResolve) { heldResolve(); heldResolve = null; } };
    function finish(result) { if (readySettled) return; readySettled = true; monthOwnerClaimPending = false; readyResolve(result); }
    try {
      Promise.resolve(locks.request("mls-p1-month-owner", { mode: "exclusive", ifAvailable: true }, function (lock) {
        if (!lock) { finish({ ok: false, reason: "pull-in-flight" }); return; }
        var result = p1ClaimMonthOwnerCore(scope);
        if (!result.ok) { finish(result); return; }
        /* Publish only this successfully acquired attempt's resolver. A later
           refused click cannot null or replace the active owner's release. */
        monthLockRelease = attemptRelease;
        finish(result);
        return held;
      })).catch(function () { if (!readySettled) finish({ ok: false, reason: "pull-in-flight" }); });
    } catch (eMonthLock) { finish({ ok: false, reason: "pull-in-flight" }); }
    return ready;
  }
  function p1ReleaseMonthOwner() {
    var token = monthOwnerToken, key = monthOwnerStorageKey, heartbeatKey = monthOwnerHeartbeatKey, lostBeforeRelease = monthOwnerLost === true;
    if (monthOwnerTimer != null) { safe(function () { clearInterval(monthOwnerTimer); }); monthOwnerTimer = null; }
    var ownerRemoval = { ok: false, reason: "metadata-persist-failed" }, heartbeatRemoval = { ok: false, reason: "metadata-persist-failed" }, ownerCurrent = false;
    try {
      var scope = { key: key, proof: monthOwnerScopeProof, epoch: monthOwnerScopeEpoch }, snapshot = p1MonthOwnerSnapshot(scope);
      if (!snapshot.ok) ownerRemoval = { ok: false, reason: snapshot.reason || "metadata-persist-failed", receipt: snapshot.receipt || null };
      else {
        ownerCurrent = !!(token && snapshot.owner && snapshot.fresh && String(snapshot.owner.id) === token);
        /* Even a stale copy of our own token is safe to remove. A replacement
           token is never touched. */
        if (token && snapshot.owner && String(snapshot.owner.id) === token) ownerRemoval = p1VerifiedMetadataRemove(key);
        else {
          var missing = p1RememberMetadataFailure(key, "metadata-persist-failed", null, "read", 0);
          ownerRemoval = { ok: false, reason: missing.reason, receipt: missing };
        }
      }
    } catch (eMonthOwnerRelease) {
      var releaseReason = p1MetadataFailureKind(eMonthOwnerRelease), releaseFailure = p1RememberMetadataFailure(key, releaseReason, eMonthOwnerRelease, "read", 0);
      ownerRemoval = { ok: false, reason: releaseReason, receipt: releaseFailure };
    }
    heartbeatRemoval = heartbeatKey ? p1VerifiedMetadataRemove(heartbeatKey) : { ok: false, reason: "metadata-persist-failed", receipt: p1RememberMetadataFailure(heartbeatKey, "metadata-persist-failed", null, "remove", 0) };
    monthOwnerToken = ""; monthOwnerCapability = null; monthOwnerLost = false; monthOwnerStorageKey = ""; monthOwnerHeartbeatKey = ""; monthOwnerScopeProof = ""; monthOwnerScopeEpoch = 0;
    if (monthLockRelease) { var unlock = monthLockRelease; monthLockRelease = null; unlock(); }
    releaseSiLease();
    var ok = !lostBeforeRelease && ownerCurrent && ownerRemoval.ok === true && heartbeatRemoval.ok === true;
    var failedRemoval = ownerRemoval.ok !== true ? ownerRemoval : heartbeatRemoval;
    return { ok: ok, reason: ok ? "released" : String(failedRemoval.reason || "month-owner-unverified"), ownerLost: lostBeforeRelease || !ownerCurrent, metadataReceipt: failedRemoval.ok === true ? null : (failedRemoval.receipt || null) };
  }
  function p1MonthOverlapRefusal(onStatus, reason) {
    var out = { ok: false, complete: false, reason: reason || "pull-in-flight", gate: "p1-month-owner", holder: "month pull", error: reason === "metadata-persist-failed" || reason === "storage-full"
      ? "MLS local pull metadata could not be verified, so no Athena navigation was started. Reload MLS and try again."
      : "A month pull is already running. Let it finish before starting another day or month pull.", retry: {} };
    if (reason === "storage-full") out.error = "MLS could not save pull coordination data on this device, so no Athena navigation was started. Keep this tab open, check available storage, then try again.";
    if (reason === "account-scope-unverified") out.error = "MLS could not prove which signed-in account owns this pull, so no Athena navigation was started. Sign in again and reload MLS.";
    if (isFn(onStatus)) onStatus(out.error, "err");
    lastPullResult = out;
    safe(function () { window.__mlsPullLastOutcome = honestPullOutcome(out); });
    return out;
  }
  function monthDateKeys(month) {
    var m = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
    if (!m) return null;
    var y = Number(m[1]), mo = Number(m[2]);
    if (mo < 1 || mo > 12) return null;
    var today = estTodayKey(), first = m[1] + "-" + m[2] + "-01";
    if (first > today) return null;
    var lastDay = new Date(y, mo, 0).getDate();
    var last = m[1] + "-" + m[2] + "-" + (lastDay < 10 ? "0" : "") + lastDay;
    if (last > today) last = today;
    var out = [];
    for (var d = 1; d <= lastDay; d++) {
      var key = m[1] + "-" + m[2] + "-" + (d < 10 ? "0" : "") + d;
      if (key > last) break;
      out.push(key);
    }
    return out;
  }

  /* ===== p1-month-signout-1.0.0 (a sign-out is not a generic read failure) ==
     A durable range caller has to tell "athenaOne signed you out" apart from
     "the grid did not paint": the first needs a sign-in and a Resume, the
     second needs a retry. The evidence already exists on the day receipt -
     the same bounded session probes ScribeFlow's day strip classifies on
     (sx-1.1) - but the PHI-free checkpoint dropped it. Forward ONE boolean;
     no error text, no identity, ever crosses this seam. */
  function p1MonthDaySignedOut(receipt) {
    if (!receipt || typeof receipt !== "object") return false;
    var history = receipt.historyReceipt && typeof receipt.historyReceipt === "object" ? receipt.historyReceipt : null;
    if (receipt.schedSessionLikelyExpired === true || receipt.navSessionLikelyExpired === true ||
        receipt.athenaSignedOutSuspected === true || (history && history.sessionExpired === true)) return true;
    return /sign-?in page|signed[- ]?out|sign in to athenaone|no signed-?in athenaone/i.test(String(receipt.error || ""));
  }
  /* ===== end p1-month-signout-1.0.0 ===== */
  function p1MonthDayCheckpoint(callback, date, outcome) {
    var reason = String(outcome && outcome.reason || "no-result");
    if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(reason)) reason = "unclassified";
    var checkpoint = {
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(date || "")) ? String(date) : "",
      ok: !!(outcome && outcome.ok === true),
      complete: !!(outcome && outcome.complete === true),
      reason: reason,
      sessionExpired: reason === "athena-session-expired" || reason === "no-athena-tab" ||
        p1MonthDaySignedOut(outcome && outcome.receipt)
    };
    /* This callback is a PHI-free durability seam for a caller that owns a
       larger range manifest. It is advisory to the month engine: a broken
       callback can never interrupt the clinical pull or its cleanup. */
    if (isFn(callback)) safe(function () { callback(checkpoint); });
    return checkpoint;
  }

  /* One exact month route for Staff prep and the chart-history continuation.
     It deliberately reuses pull() for every frozen day: same two-dimensional
     schedule receipt, same exact provider/appointment/patient identity, same
     idempotent importer, and the same explicitly chosen verified history batch. */
  function pullMonth(opts) {
    opts = opts || {};
    var __visitNotesAdmission = admitFrozenVisitNotesChoice(opts, pullMonth);
    if (__visitNotesAdmission) return __visitNotesAdmission;
    var month = String(opts.month || "");
    var dates = monthDateKeys(month);
    /* smp-1.2.0: an explicit opts.dates allow-list narrows the run to those
       days (used by Retry failed days). Entries are validated against the
       canonical month keys, so a stray date can never widen or shift the run. */
    if (Array.isArray(opts.dates) && opts.dates.length) {
      var onlyDates = {};
      opts.dates.forEach(function (d) { onlyDates[String(d || "").slice(0, 10)] = 1; });
      dates = dates.filter(function (d) { return onlyDates[d] === 1; });
    }
    var monthFullNotesOff = opts.pullVisitBodies === false;
    var includeHistory = opts.includeHistory !== false; /* dayfacts-1.0.0: OFF months still run the mandatory day-facts batch per day */
    var monthPullVisitBodies = (typeof opts.pullVisitBodies === "boolean") ? opts.pullVisitBodies : null;
    var onStatus = isFn(opts.onStatus) ? opts.onStatus : function () {};
    var onDayCheckpoint = isFn(opts.onDayCheckpoint) ? opts.onDayCheckpoint : null;
    var shouldStop = isFn(opts.shouldStop) ? opts.shouldStop : null;
    var gate = resolveProviderRequest(opts.provider, { allowAll: true, requireRosterForAll: true, allowDetectedProvider: true });
    function failed(reason, error) {
      return { ok: false, complete: false, reason: reason, error: error || "", month: month, includeHistory: includeHistory, historyRequested: includeHistory, visitNotesRequested: monthPullVisitBodies !== null ? monthPullVisitBodies : undefined, visitNotesMode: monthFullNotesOff ? "day-facts" : (monthPullVisitBodies === true ? "full" : "unspecified"), provider: gate.provider || null, providerRosterReceipt: gate.receipt || null, days: [], totals: { days: 0, completeDays: 0, scheduleAttempted: 0, scheduleAccounted: 0, historiesRequested: 0, historiesProcessed: 0, failures: 0 }, retry: { dates: [] } };
    }
    if (!dates || !dates.length) return Promise.resolve(failed("invalid-month", "Choose the current or a past month."));
    if (!gate.ok) { onStatus(gate.error || "The provider roster is incomplete.", "err"); return Promise.resolve(failed(gate.reason, gate.error)); }
    var __metadataBeforeMonth = p1MetadataRefusal(onStatus);
    if (__metadataBeforeMonth) return Promise.resolve(Object.assign(failed(__metadataBeforeMonth.reason, __metadataBeforeMonth.error), __metadataBeforeMonth));
    /* ql-1.0 (stale-quota-latch 2026-08-11, proof-2 disclosed gap): the MONTH
       lane bypassed the b1014 quota preflight entirely. Same gate as the day
       lane, same reality check first: a stale latch over a provably-healthy
       idb store clears and the month proceeds; genuinely failing writes
       refuse loudly BEFORE any Athena navigation, named gate, spoken
       through onStatus, outcome-stamped. */
    var _lrQuotaM = safe(function () { return window.__mlsStoreWriteFailed; }, null);
    if (_lrQuotaM && typeof _quotaLatchStale === "function" && _quotaLatchStale()) _lrQuotaM = null;
    if (_lrQuotaM) {
      var _lrQMRefusal = failed("storage-full-writes-failing", "MLS could not verify the latest save on this device, so new pull data might not survive a reload. No Athena navigation was started. Keep this tab open, check available storage, then retry the last action before pulling again.");
      _lrQMRefusal.gate = "quota-preflight";
      _lrQMRefusal.failures = Number(safe(function () { return window.__mlsQuotaGuard && window.__mlsQuotaGuard.failures; }, 0) || 0);
      _lrQMRefusal.lastFailAt = Number(_lrQuotaM.at || 0) || null;
      onStatus(_lrQMRefusal.error, "err");
      safe(function () { window.__mlsPullLastOutcome = { ok: false, at: Date.now(), error: _lrQMRefusal.error }; });
      return Promise.resolve(_lrQMRefusal);
    }
    /* Arm this admitted run before the asynchronous owner claim. A pause,
       cancel, or account-boundary stop that arrives while the claim settles
       must remain armed; resetting inside the continuation could erase it and
       start one more day after the caller explicitly stopped. */
    window.__mlsPullStopRequested = false;
    return Promise.resolve(p1ClaimMonthOwner()).then(function (monthOwner) {
      if (!monthOwner || !monthOwner.ok) {
        var ownerRefusal = p1MonthOverlapRefusal(onStatus, monthOwner && monthOwner.reason || "pull-in-flight");
        return Object.assign(failed(ownerRefusal.reason, ownerRefusal.error), ownerRefusal);
      }
    var frozenProvider = gate.provider === "all" ? "all" : {
      id: String(gate.provider.id || ""), stableKey: String(gate.provider.stableKey || ""), raw: String(gate.provider.raw || gate.provider.name || ""),
      name: String(gate.provider.name || ""), rosterVerified: gate.provider.rosterVerified === true,
      detectedOnly: gate.provider.detectedOnly === true
    };
    var result = {
      ok: false, complete: false, reason: "month-partial", month: month, includeHistory: includeHistory,
      historyRequested: includeHistory, visitNotesRequested: monthPullVisitBodies !== null ? monthPullVisitBodies : undefined,
      visitNotesMode: monthFullNotesOff ? "day-facts" : (monthPullVisitBodies === true ? "full" : "unspecified"),
      provider: frozenProvider, providerRosterReceipt: gate.receipt || null,
      /* prs-1.0.0: an ALL-provider MONTH pull inherits exactly the same
         painted-grid coverage limit as the day pull it repeats. */
      providerScope: providerScopeReceipt(frozenProvider === "all" ? "all" : "selected"), days: [],
      totals: { days: dates.length, completeDays: 0, scheduleAttempted: 0, scheduleAccounted: 0, created: 0, repaired: 0, skipped: 0, historiesRequested: 0, historiesProcessed: 0, failures: 0 },
      retry: { dates: [] }
    };
    /* A durable range owner can be paused/cancelled while this async month
       owner claim is still settling. Re-check its frozen control immediately
       after the normal new-run reset so that race starts zero Athena days. A
       broken predicate fails closed; ordinary month callers provide none. */
    if (shouldStop && safe(function () { return shouldStop() === true; }, true)) window.__mlsPullStopRequested = true;
    /* si-1.7.12 (live 2026-07-18): with athenaOne signed out, the month sweep
       machine-gunned all 30 days in five seconds — thirty identical failures
       and a bare "0/30 verified". A failure that repeats identically on
       consecutive days is SYSTEMIC (session, extension, lease, roster), not
       a per-day problem: after 3 consecutive days failing with the same
       systemic reason, stop the sweep, mark the remaining days not-attempted
       (they stay in Retry failed days), and say the one real cause. */
    var SYSTEMIC_REASONS = { "signin": 1, "signin-expired": 1, "no-ext": 1, "pull-in-flight": 1, "no-read": 1, "nav-failed": 1, "wrong-day": 1, "schedule-incomplete": 1, "schedule-request-unbound": 1, "provider-roster-incomplete": 1, "provider-roster-unbound": 1, "unverified-day": 1 };
    var SYSTEMIC_TEXT = {
      "signin": "MLS is signed out — sign in to MLS first.",
      "signin-expired": "your MLS sign-in expired — sign in to MLS again, then retry.",
      "no-ext": "MLS Assist is not answering — enable the extension and reload this tab.",
      "pull-in-flight": "another pull already holds the Athena engine — let it finish (or reload this tab if it crashed).",
      "no-read": "Athena is not returning a readable schedule — check the Athena tab is signed in and on the Day schedule.",
      "nav-failed": "Athena cannot be moved between days — check the Athena tab is signed in and responsive.",
      "wrong-day": "Athena keeps showing a different day — check the Athena tab.",
      "schedule-incomplete": "Athena's schedule grid never finishes loading — check the Athena tab (signed in, one tab, Day view).",
      "schedule-request-unbound": "Athena's replies are not binding to these requests — reload the Athena tab and this MLS tab.",
      "provider-roster-incomplete": "the provider roster cannot be verified — open the full Athena Day schedule once, then retry.",
      "provider-roster-unbound": "the provider roster receipt is not binding to this run — reload the Athena tab, then retry.",
      "unverified-day": "the date shown in Athena cannot be verified — check the Athena tab."
    };
    var breaker = { reason: "", streak: 0, tripped: false, hint: "" };
    var chain = Promise.resolve();
    dates.forEach(function (date, index) {
      chain = chain.then(function () {
        if (!monthOwnerLost && !p1MonthOwnerStillHeld()) {
          monthOwnerLost = true;
          safe(function () { window.__mlsPullStopRequested = true; });
        }
        if (monthOwnerLost) {
          var ownerLostDay = { date: date, ok: false, complete: false, reason: "metadata-persist-failed" };
          result.days.push(ownerLostDay);
          result.totals.failures++; result.retry.dates.push(date);
          onStatus(date + ": Month owner metadata could not be refreshed, so this day was not attempted and remains queued for retry.", "err");
          p1MonthDayCheckpoint(onDayCheckpoint, date, ownerLostDay);
          return;
        }
        if (window.__mlsPullStopRequested === true) {
          var stoppedDay = { date: date, ok: false, complete: false, reason: "stopped-by-user" };
          result.days.push(stoppedDay);
          result.stoppedByUser = true;
          result.retry.dates.push(date);
          onStatus(date + ": Not pulled — stop was requested. The day is queued for retry.", "warn");
          p1MonthDayCheckpoint(onDayCheckpoint, date, stoppedDay);
          return;
        }
        if (breaker.tripped) {
          var breakerDay = { date: date, ok: false, complete: false, reason: "not-attempted-after-systemic-failure" };
          result.days.push(breakerDay);
          result.totals.failures++; result.retry.dates.push(date);
          onStatus(date + ": Not attempted — three days in a row failed the same way (" + breaker.reason + "), so MLS stopped rather than repeat the failure. The day is queued for retry.", "err");
          p1MonthDayCheckpoint(onDayCheckpoint, date, breakerDay);
          return;
        }
        onStatus("Month pull " + (index + 1) + "/" + dates.length + ": " + date, "");
        return pull({
          date: date,
          provider: frozenProvider,
          __p1MonthOwnerToken: monthOwner.token,
          __p1DetectedProvider: !!(frozenProvider && frozenProvider !== "all" && frozenProvider.detectedOnly === true),
          __p1ResumeScopeSource: "month",
          includeHistory: includeHistory,
          pullVisitBodies: monthPullVisitBodies,
          onStatus: function (message, kind) { onStatus(date + ": " + String(message || ""), kind); }
        }).then(function (day) {
          day = day || { ok: false, complete: false, reason: "no-result" };
          var settledDay = { date: date, ok: day.ok === true, complete: day.complete === true, reason: day.reason || "no-result", receipt: day };
          result.days.push(settledDay);
          var cr = day.calendarReceipt || {}, hr = day.historyReceipt || {};
          result.totals.scheduleAttempted += Number(cr.attempted || 0);
          result.totals.scheduleAccounted += Number(cr.accounted || 0);
          result.totals.created += Number(day.created || 0);
          result.totals.repaired += Number(day.repaired || 0);
          result.totals.skipped += Number(day.skipped || 0);
          result.totals.historiesRequested += Number(hr.requested || 0);
          result.totals.historiesProcessed += Number(hr.processed || 0);
          result.totals.providerBackfilled = Number(result.totals.providerBackfilled || 0) + Number(cr.providerBackfilled || 0);
          if (day.ok === true && day.complete === true) result.totals.completeDays++;
          else { result.totals.failures++; result.retry.dates.push(date); }
          if (day.ok === true) { breaker.reason = ""; breaker.streak = 0; }
          else {
            var dr = String(day.reason || "");
            if (SYSTEMIC_REASONS[dr]) {
              if (dr === breaker.reason) breaker.streak++;
              else { breaker.reason = dr; breaker.streak = 1; }
              if (day.extUpdateHint) breaker.hint = String(day.extUpdateHint);
              if (breaker.streak >= 3) breaker.tripped = true;
            } else { breaker.reason = ""; breaker.streak = 0; }
          }
          p1MonthDayCheckpoint(onDayCheckpoint, date, settledDay);
        }, function (err) {
          /* A day must never close silently: this rejection path previously
             recorded the exception into result.days and emitted NOTHING, so a
             live observer only noticed when the date sequence jumped (day 6,
             2026-08-09). Same day-end shape as every other exit. */
          /* Exception messages can contain DOM text, chart fragments, URLs, or
             implementation details. The physician and durable range receipt
             need the failed date and retry state, not the raw exception. */
          var exceptionType = String(err && err.name || "Error").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "Error";
          var exceptionDay = { date: date, ok: false, complete: false, reason: "exception", errorType: exceptionType };
          result.days.push(exceptionDay);
          result.totals.failures++; result.retry.dates.push(date);
          onStatus(date + ": Day stopped before finishing. Nothing was marked complete, and this day is queued for retry.", "err");
          p1MonthDayCheckpoint(onDayCheckpoint, date, exceptionDay);
        });
      });
    });
    return chain.then(function () {
      /* Prove ownership once more after the final day. A suspended tab can
         lose its heartbeat during that last long read; checking only before
         each day would otherwise announce a false completed month. Cleanup
         is also verified, so a stuck owner record cannot hide behind green. */
      var ownerHeldAtFinish = !monthOwnerLost && p1MonthOwnerStillHeld();
      var ownerRelease = p1ReleaseMonthOwner();
      monthPullRunning = false;
      var ownerProofComplete = ownerHeldAtFinish && ownerRelease && ownerRelease.ok === true;
      if (!ownerProofComplete) {
        var finalRetryDate = dates.length ? dates[dates.length - 1] : "";
        if (finalRetryDate && result.retry.dates.indexOf(finalRetryDate) < 0) result.retry.dates.push(finalRetryDate);
        result.totals.failures++;
        result.monthOwnerReceipt = {
          complete: false,
          reason: ownerRelease && ownerRelease.reason || "month-owner-unverified",
          ownerLost: !ownerHeldAtFinish || !!(ownerRelease && ownerRelease.ownerLost)
        };
      }
      result.complete = ownerProofComplete && result.totals.completeDays === dates.length && result.retry.dates.length === 0;
      result.ok = result.complete;
      result.reason = result.complete ? "complete" : (!ownerProofComplete ? "month-owner-unverified" : (breaker.tripped ? "month-stopped-systemic" : "month-partial"));
      if (breaker.tripped) result.systemicReason = breaker.reason;
      onStatus(result.complete
        ? ("Verified month complete: " + result.totals.completeDays + "/" + dates.length + " days; schedule " + result.totals.scheduleAccounted + "/" + result.totals.scheduleAttempted + (monthFullNotesOff ? "; Full visit notes is off - each day saved chart facts and attempted only its own pulled-day note; no other historical bodies were read." : "; histories " + result.totals.historiesProcessed + "/" + result.totals.historiesRequested + "; failures 0.") + providerScopeNotice(frozenProvider === "all" ? "all" : "selected"))
        : (breaker.tripped
          ? ("Month pull STOPPED EARLY — every day was failing the same way: " + (SYSTEMIC_TEXT[breaker.reason] || breaker.reason.replace(/-/g, " ")) + (breaker.hint ? " " + breaker.hint : "") + " Fix that first, then use Retry failed days (" + result.retry.dates.length + " day" + (result.retry.dates.length === 1 ? "" : "s") + " remain; nothing was skipped silently).")
          : ("Month incomplete: " + result.totals.completeDays + "/" + dates.length + " days verified; retry " + result.retry.dates.length + " day" + (result.retry.dates.length === 1 ? "" : "s") + ".")), result.complete ? "ok" : "err");
      return result;
    }, function (err) {
      var ownerRelease = p1ReleaseMonthOwner();
      monthPullRunning = false;
      result.reason = ownerRelease && ownerRelease.ok === true ? "month-exception" : "month-owner-unverified";
      result.errorType = String(err && err.name || "Error").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "Error";
      if (!(ownerRelease && ownerRelease.ok === true)) result.monthOwnerReceipt = { complete: false, reason: ownerRelease && ownerRelease.reason || "month-owner-unverified", ownerLost: !!(ownerRelease && ownerRelease.ownerLost) };
      result.totals.failures++; return result;
    });
    }).catch(function (err) {
      var cleanup = monthOwnerToken ? p1ReleaseMonthOwner() : { ok: true };
      monthPullRunning = false;
      var out = failed(cleanup.ok === true ? "month-exception" : "month-owner-unverified", "The month pull stopped before it could start safely. Reload MLS and retry the remaining days.");
      if (cleanup.ok !== true) out.monthOwnerReceipt = { complete: false, reason: cleanup.reason || "month-owner-unverified", ownerLost: !!cleanup.ownerLost };
      return out;
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
    var frozenProvider = { id: sel.provider.id, stableKey: sel.provider.stableKey || "", raw: sel.provider.raw || sel.provider.name, name: sel.provider.name, key: sel.provider.key, rosterVerified: sel.provider.rosterVerified === true, detectedOnly: sel.provider.detectedOnly === true };
    var frozenDate = sel.date;
    onStatus("Pulling " + frozenProvider.name + " on " + frozenDate + "...", "");
    var calendarPullVisitBodies = (typeof opts.pullVisitBodies === "boolean") ? opts.pullVisitBodies : null;
    var includeHistory = opts.includeHistory !== false; /* dayfacts-1.0.1: the Calendar door was the third caller still coupling the checkbox in - an OFF Calendar pull now runs the mandatory day-facts batch like every other entry */
    /* si-1.6.4: every explicit user pull flows through the ONE public entry
       (window.__mlsSI.pull). The calendar route previously invoked the
       module-internal pull, so external observers wrapping the public seam
       (e.g. the PHI-free acceptance collector) never saw the run. The month
       route intentionally keeps its internal per-day calls: its own public
       pullMonth result carries the per-day receipts. */
    var publicPull = safe(function () {
      return window.__mlsSI && isFn(window.__mlsSI.pull) ? window.__mlsSI.pull : null;
    }, null) || pull;
    return publicPull({ date: frozenDate, provider: frozenProvider, __p1DetectedProvider: frozenProvider.detectedOnly === true, includeHistory: includeHistory, pullVisitBodies: calendarPullVisitBodies, onStatus: onStatus }).then(function (res) {
      res = res || {};
      res.source = "calendar";
      res.requestedProvider = { id: frozenProvider.id, stableKey: frozenProvider.stableKey, name: frozenProvider.name, key: frozenProvider.key, rosterVerified: frozenProvider.rosterVerified };
      return res;
    });
  }

  function revert() {
    safe(function () { window.removeEventListener("message", onSchedMsg); });
    safe(function () { if (window._importPulledSchedule && window._importPulledSchedule.__mlsSIReplaced && _prevImport) window._importPulledSchedule = _prevImport; });
    safe(function () { absoluteDeadlines.destroy(); if (window.__mlsAbsoluteDeadline === absoluteDeadlines) delete window.__mlsAbsoluteDeadline; });
    window.__mlsSI.installed = false;
  }

  function loadAuthoritativeNextUpConsumer() {
    safe(function () {
      if (window.__mlsNextUp && window.__mlsNextUp.version === "nextup-p1-2.1.0") return;
      var old = document.querySelector('script[data-mls-asset="feat_nextup_connect.js"]');
      if (old) {
        safe(function () { if (window.__mlsNextUp && isFn(window.__mlsNextUp.revert)) window.__mlsNextUp.revert(); });
        old.setAttribute("data-mls-retired-asset", "feat_nextup_connect.js");
        old.removeAttribute("data-mls-asset");
      }
      var s = document.createElement("script");
      s.src = "cloned-feat_nextup_connect.js?v=" + (window.__MLS_AV || "p1-preview");
      s.async = false; s.setAttribute("data-mls-asset", "feat_nextup_connect.js");
      (document.head || document.documentElement).appendChild(s);
    });
  }

  function boot() {
    safe(function () { window.addEventListener("message", onSchedMsg); });
    installImport();
    loadAuthoritativeNextUpConsumer();
    /* a light retry in case a later module re-wraps _importPulledSchedule after us */
    var n = 0, iv = setInterval(function () { installImport(); if (++n > 8) clearInterval(iv); }, 1200);
  }

  /* pr-1.0.0 resume driver: on load, continue a pull the page never finished. */
  var resumeTimer = null, resumeCard = null;
  function resumeDismiss(clearIntent) {
    if (resumeTimer) { safe(function () { clearInterval(resumeTimer); }); resumeTimer = null; }
    if (resumeCard) { safe(function () { resumeCard.remove(); }); resumeCard = null; }
    if (clearIntent) resumeClear();
  }
  function resumeStart(rec) {
    var prev = resumeGet();
    /* p1-resume-honesty-1.0.0 (a): a resume may only ever run the day the
       doctor is looking at. This is the exact hijack that shipped: a record
       for 2026-08-25 started while the selected day was 2026-08-17, and the
       receipt came back with target 2026-08-25. */
    var __selectedDay = p1SelectedDayKey();
    var __recDay = normDate(rec && rec.date || "");
    if (__selectedDay && __recDay && __recDay !== __selectedDay) {
      /* rsk-1.0.0 (owner 2026-08-26, "make sure this resume pull button
         works", measured live): the old order dismissed the chip BEFORE this
         gate, so a wrong-day click ATE the resume offer - the error flashed,
         the chip vanished, nothing resumed, and no outcome instrument was
         written. The chip must survive a refusal (the record is untouched and
         still resumable on the right day), and the refusal must reach the
         same instruments every other pull outcome reaches. */
      var __wrongDayRefusal = { ok: false, complete: false, reason: "resume-day-not-selected",
        gate: "resume-selected-day", target: __recDay, selectedDay: __selectedDay,
        error: "The unfinished pull was for " + __recDay + ", but " + __selectedDay + " is selected. Nothing was read; go to " + __recDay + " (the Today button, then the day arrows) and press Resume again - the offer stays.",
        created: 0, repaired: 0, skipped: 0, failed: 0, retry: {} };
      lastPullResult = __wrongDayRefusal;
      safe(function () { window.__mlsPullLastOutcome = honestPullOutcome(__wrongDayRefusal); });
      safe(function () { if (isFn(window.__mlsDsStatus)) window.__mlsDsStatus(__wrongDayRefusal.error, "err"); });
      return __wrongDayRefusal;
    }
    resumeDismiss(false);
    var capturedScope = p1SanitizeResumeScope(rec && rec.providerScope);
    var durableScope = p1SanitizeResumeScope(prev && prev.providerScope);
    var capturedDate = normDate(rec && rec.date || ""), durableDate = normDate(prev && prev.date || "");
    function refuseResume(reason, error, clearIntent) {
      var refusal = { ok: false, complete: false, reason: reason, gate: "resume-provider-scope", error: error,
        target: capturedDate || durableDate || "", created: 0, repaired: 0, skipped: 0, failed: 0, retry: {} };
      if (clearIntent) resumeClear();
      else if (prev) {
        var nextAttempts = Number(prev.attempts || 0) + 1;
        if (nextAttempts >= RESUME_MAX_ATTEMPTS) resumeClear();
        else {
          var boundedPrev = {};
          for (var pk in prev) if (Object.prototype.hasOwnProperty.call(prev, pk)) boundedPrev[pk] = prev[pk];
          boundedPrev.attempts = nextAttempts;
          boundedPrev.startedAt = Date.now();
          resumeSave(boundedPrev);
        }
      }
      lastPullResult = refusal;
      safe(function () { window.__mlsPullLastOutcome = honestPullOutcome(refusal); });
      safe(function () {
        var status = document.getElementById("mlsDsStatus");
        if (status) { status.textContent = error; status.style.display = ""; }
        if (isFn(window.__mlsDsStatus)) window.__mlsDsStatus(error, "err");
        else toast(error, "err");
      });
      return refusal;
    }
    if (!capturedScope || !durableScope || !capturedDate || capturedDate !== durableDate ||
        p1ResumeScopeSignature(capturedScope) !== p1ResumeScopeSignature(durableScope)) {
      return refuseResume("resume-scope-changed", "The saved pull scope changed before resume. Nothing was read or imported; start a new pull with the provider you want.", true);
    }
    var resumeProvider = p1ResolveResumeProvider(capturedScope);
    if (!resumeProvider) {
      return refuseResume("resume-provider-scope-unverified", "The selected provider from the unfinished pull is not uniquely verified in the current Athena roster. Nothing was read or imported; choose that clinician again.", false);
    }
    var p1ResumeCensusEligible = !!(capturedScope.mode === "all" && durableScope.mode === "all" &&
      rec && rec.p1CensusEligible === true && prev && prev.p1CensusEligible === true);
    resumeSave({ date: capturedDate, startedAt: Date.now(), attempts: Number(prev.attempts || 0) + 1,
      includeHistory: rec.includeHistory !== false, bodies: (typeof rec.bodies === 'boolean') ? rec.bodies : null,
      providerScope: capturedScope, p1CensusEligible: p1ResumeCensusEligible });
    safe(function () {
      var resumeOpts = { date: capturedDate, provider: resumeProvider, includeHistory: rec.includeHistory !== false,
        __p1DetectedProvider: !!(resumeProvider && resumeProvider !== "all" && resumeProvider.detectedOnly === true),
        __p1ResumeScopeSource: capturedScope.source, onStatus: function (m, k) {
        safe(function () { if (isFn(window.__mlsDsStatus)) window.__mlsDsStatus(m, k); });
      } };
      /* Resume the exception only when the original guarded all-Day call
         carried the private token. Missing/old/direct/selected intents stay
         fail-closed instead of silently widening to all providers. */
      if (p1ResumeCensusEligible) resumeOpts.__p1DayCensusToken = P1_DAY_CENSUS_TOKEN;
      if (typeof rec.bodies === 'boolean') resumeOpts.pullVisitBodies = rec.bodies;
      pull(resumeOpts);
    });
  }
  /* p1-resume-honesty-1.0.0 (b): OFFERED, never imposed. The countdown that
     used to sit here started a pull by itself — on the record's day, not the
     doctor's — so there is no timer any more. Two buttons, one honest line,
     and nothing happens until the doctor chooses. */
  function resumeOffer(rec) {
    if (resumeCard || typeof document === "undefined" || !document.body) return;
    var day = String(rec && rec.date || "").replace(/[<>&"]/g, "");
    var box = document.createElement("div");
    box.id = "mlsPullResumeCard";
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;left:16px;bottom:84px;z-index:9000;max-width:340px;background:#eef6f1;border:1px solid #cfe0d7;color:#204034;border-radius:12px;padding:11px 13px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.16)";
    box.innerHTML = '<div style="font-weight:700;margin-bottom:3px">↻ Unfinished pull for ' + day + '</div>' +
      '<div id="mlsPullResumeMsg" style="font-size:12.5px;line-height:1.35">An earlier pull of ' + day + ' was interrupted — Resume · Start over. Resume skips charts already verified today; nothing runs until you choose.</div>' +
      '<div style="margin-top:8px;display:flex;gap:6px"><button type="button" id="mlsPullResumeGo" style="border:1px solid #2e6a4b;background:#2e6a4b;color:#fff;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:700;cursor:pointer">Resume</button>' +
      '<button type="button" id="mlsPullResumeFresh" style="border:1px solid #bcd0c5;background:#fff;color:#204034;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:700;cursor:pointer">Start over</button>' +
      '<button type="button" id="mlsPullResumeNo" style="border:1px solid #bcd0c5;background:#fff;color:#204034;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:700;cursor:pointer">Not now</button></div>';
    document.body.appendChild(box);
    resumeCard = box;
    safe(function () { document.getElementById("mlsPullResumeGo").onclick = function () { resumeStart(rec); }; });
    /* "Start over" throws the record away and leaves the Pull button to do
       what it always does: a fresh pull of the SELECTED day. */
    safe(function () { document.getElementById("mlsPullResumeFresh").onclick = function () { resumeDismiss(true); }; });
    safe(function () { document.getElementById("mlsPullResumeNo").onclick = function () { resumeDismiss(false); }; });
  }
  var p1ResumeOfferState = { offered: false, date: "", reason: "not-checked", selectedDay: "" };
  function maybeResumePull() {
    var rec = resumeGet();
    var selectedDay = p1SelectedDayKey();
    function decline(reason) { p1ResumeOfferState = { offered: false, date: String((rec && rec.date) || ""), reason: reason, selectedDay: selectedDay }; }
    if (!rec || !rec.date) { decline("no-record"); return; }
    if (!(Date.now() - Number(rec.startedAt || 0) < RESUME_MAX_AGE_MS)) { resumeClear(); decline("expired"); return; }
    if (Number(rec.attempts || 0) >= RESUME_MAX_ATTEMPTS) { decline("attempts-exhausted"); return; }   // never loop on a day that keeps failing
    if (pullRunning || resumeBusyElsewhere()) { decline("pull-in-flight"); return; }                   // another tab owns it
    /* (d) another TAB's interruption is that tab's to resume. A record with no
       tabId (legacy/durable-before-this-change) is still adoptable here. */
    if (rec.tabId && String(rec.tabId) !== p1TabId()) { decline("foreign-tab"); return; }
    /* (a)+(b) THE HIJACK GATE: only offer for the day on screen. */
    if (selectedDay && normDate(rec.date) !== selectedDay) { decline("other-day"); return; }
    resumeOffer(rec);
    p1ResumeOfferState = { offered: true, date: normDate(rec.date), reason: "offered", selectedDay: selectedDay };
  }
  safe(function () {
    if (typeof document === "undefined") return;
    var tries = 0;
    var iv = setInterval(function () {
      tries++;
      if (tries > 10) { safe(function () { clearInterval(iv); }); return; }
      if (!document.body) return;
      var signedIn = safe(function () { return !isFn(window.backendMode) || !window.backendMode() || !!(isFn(window.bkToken) && window.bkToken()); }, true);
      if (!signedIn) return;                                        // never resume over a sign-in gate
      safe(function () { clearInterval(iv); });
      maybeResumePull();
    }, 3000);
  });

  /* ======================================================================
     cv-1.0.0  ONE GUARDED DAY LANE  (lane convergence 2026-07-27)

     There were THREE day-pull lanes and only one of them was guarded:

       staff-prep (mls-connect ez3)  resolves a canonical provider FIRST,
         and when that resolve fails it drives athenaOne to the Day view,
         re-reads the painted grid, re-ingests the canonical roster and
         retries the resolve ONCE. It then pulls WITH provider + history.
       selected-day strip (ds-2.0.2) passed NO provider at all, so every
         pull ran the all-providers branch of scopeProviderRows -- which is
         all-or-nothing: one unattributed row makes it return rows:[] and
         import ZERO. On a Day grid with no provider column that is EVERY
         row (measured live: 400/400 stored rows provider-empty, 17 days).
       the legacy hero enumeration (ScribeFlow pullScheduleViaAssist) parsed
         page text and filed rows through _importPulledSchedule, which dates
         undated rows from whatever the open Athena page happened to print.

     dayPull() is the single entry all three now use. It adds the staff-prep
     pre-flight and the account provider scope, and then calls pull(). It
     NEVER weakens pull(): every refusal, receipt and status pull() emits is
     returned untouched, and the pre-flight is ADVISORY -- it cannot refuse a
     pull and it never touches complete.
     ====================================================================== */
  /* One pre-flight per page lifetime is what absorbs the
     first-navigation-after-a-reload failure; after that it only runs when a
     provider scope cannot be resolved, exactly like the staff-prep lane. */
  var _dayPreflightDone = false;
  /* ===== p1-roster-settle-preflight-1.0.0 =====
     Owner report 2026-08-16: providerRosterReceipt {complete:true,partial:false}
     while preflightReceipt.rosterComplete:false and
     providerReceipt.rosterVerified:false. The roster DID complete - the
     pre-flight sampled roster.getReceipt() in the SAME turn its schedule read
     returned, before the receipt for that read was published, and that stale
     false travelled into rosterVerified via `detectedOnly = !rosterComplete`.
     The pre-flight now waits, BOUNDED, on the same
     'mls-provider-roster-updated' signal the receipt is published with, and
     re-samples before publishing. setTimeout is the only clock (rAF never
     fires in a hidden/non-compositing tab) and the wait is skipped entirely
     when the receipt is already complete or the warm-up read failed, so a
     healthy pull pays nothing. */
  var ROSTER_SETTLE_CEILING_MS = 1000;
  var ROSTER_SETTLE_STEP_MS = 50;
  var ROSTER_SETTLE_EVENT = "mls-provider-roster-updated";
  function rosterReceiptComplete() {
    return !!safe(function () {
      var roster = window.__mlsProviderRoster;
      var rec = roster && isFn(roster.getReceipt) ? roster.getReceipt() : null;
      return !!(rec && rec.complete === true && rec.partial !== true);
    }, false);
  }
  /* Resolves true as soon as the roster receipt reports complete, or false at
     the ceiling. At most ceil(ceiling/step) wakeups - never a busy loop, and
     never a wait when there is nothing to wait for. */
  function awaitRosterSettle(ceilingMs) {
    if (rosterReceiptComplete()) return Promise.resolve({ complete: true, waitedMs: 0, settled: false });
    var ceiling = Number(ceilingMs) > 0 ? Number(ceilingMs) : ROSTER_SETTLE_CEILING_MS;
    var startedAt = Date.now();
    return new Promise(function (resolve) {
      var done = false, tickTimer = null, deadlineTimer = null;
      function finish(complete) {
        if (done) return;
        done = true;
        safe(function () { if (tickTimer != null) clearTimeout(tickTimer); });
        safe(function () { if (deadlineTimer != null) clearTimeout(deadlineTimer); });
        safe(function () { if (isFn(window.removeEventListener)) window.removeEventListener(ROSTER_SETTLE_EVENT, onUpdate, false); });
        resolve({ complete: !!complete, waitedMs: Date.now() - startedAt, settled: !!complete });
      }
      function check() { if (!done && rosterReceiptComplete()) finish(true); }
      function onUpdate() { check(); }
      function tick() {
        if (done) return;
        check();
        if (done) return;
        tickTimer = setTimeout(tick, ROSTER_SETTLE_STEP_MS);
      }
      safe(function () { if (isFn(window.addEventListener)) window.addEventListener(ROSTER_SETTLE_EVENT, onUpdate, false); });
      deadlineTimer = setTimeout(function () { if (done) return; finish(rosterReceiptComplete()); }, ceiling);
      tickTimer = setTimeout(tick, ROSTER_SETTLE_STEP_MS);
    });
  }
  /* ===== end p1-roster-settle-preflight-1.0.0 ===== */
  function warmUpDay(date, onStatus) {
    var day = normDate(date) || "";
    var say = isFn(onStatus) ? onStatus : function () {};
    var out = { warmed: false, navOk: false, readOk: false, rosterComplete: false, observedDay: "", reason: "",
      rosterCompleteAtEntry: false, rosterSettled: false, rosterSettleMs: 0 };
    if (!day) { out.reason = "no-date"; return Promise.resolve(out); }
    /* p1-roster-settle-preflight-1.0.0: an ALREADY-verified roster is never
       flipped back to unverified by a sample taken later in this warm-up. */
    out.rosterCompleteAtEntry = rosterReceiptComplete();
    say("Opening " + day + " in athenaOne before the pull...", "");
    return bridge("mlsAppGotoDateResult", "mlsAppGotoDate", 60000, { date: day, probe: false }).then(function (nav) {
      out.navOk = !!(nav && nav.ok !== false);
      /* observedDay is the EXTENSION SELF-REPORT. On the weekstrip nav path it
         echoes the requested target, so it is NOT proof the schedule landed.
         This pre-flight therefore claims nothing about the day: it imports no
         rows, it stores nothing, and the real pull keeps its own day gates. */
      out.observedDay = normDate(nav && nav.schedDate) || "";
      if (!out.navOk) out.reason = String((nav && nav.reason) || "nav-failed");
      say("Re-reading the athenaOne Day schedule...", "");
      /* The date rides along so a date-aware read can refuse a wrong surface.
         Todays reader ignores it; nothing here depends on it being honoured. */
      return bridge("mlsAppScheduleResult", "mlsAppPullSchedule", 30000, { date: day });
    }).then(function (r) {
      out.readOk = !!(r && r.ok === true);
      if (!out.readOk && !out.reason) out.reason = String((r && r.reason) || "no-read");
      /* Re-ingesting is idempotent, and the real pull re-ingests its OWN
         batch-bound reply straight afterwards, so this can never leave an
         unbound receipt standing in for a bound one. */
      safe(function () {
        var roster = window.__mlsProviderRoster;
        if (out.readOk && roster && isFn(roster.ingestResp)) roster.ingestResp(r);
      });
      out.warmed = out.navOk && out.readOk;
      /* p1-roster-settle-preflight-1.0.0: sampling here - the same turn the
         read returned - is what published the stale rosterComplete:false. Wait
         (bounded) for the receipt this read produces, then re-sample. A failed
         read has nothing to settle, so it pays no wait at all. */
      if (!out.readOk) {
        out.rosterComplete = out.rosterCompleteAtEntry || rosterReceiptComplete();
        return out;
      }
      return awaitRosterSettle(ROSTER_SETTLE_CEILING_MS).then(function (settle) {
        out.rosterSettled = !!(settle && settle.settled);
        out.rosterSettleMs = Number((settle && settle.waitedMs) || 0);
        out.rosterComplete = !!((settle && settle.complete) || out.rosterCompleteAtEntry);
        return out;
      }, function () {
        out.rosterComplete = out.rosterCompleteAtEntry || rosterReceiptComplete();
        return out;
      });
    }, function (err) {
      out.reason = String((err && err.message) || err || "warmup-failed");
      return out;
    });
  }
  /* The scope a lane with no provider picker should pull as. Returns a roster
     ENTRY only when the signed-in clinician is uniquely present in the
     VERIFIED athenaOne roster; otherwise the string "all". Never a guess, and
     never a name that the roster cannot resolve. */
  function accountProviderRequest() {
    var roster = safe(function () { return window.__mlsProviderRoster; }, null);
    if (!(roster && isFn(roster.resolve))) return "all";
    var names = [];
    /* 1. the explicit "Pulling as" pick, read from its STORE not its chip */
    safe(function () {
      if (!isFn(window.uns)) return;
      var v = localStorage.getItem(window.uns("pullProvider"));
      if (v && String(v).trim()) names.push(String(v).trim());
    });
    /* 2. the signed-in account mapped through the app provider list */
    safe(function () {
      var me = window._calMe || null, list = window._calProviders || [];
      if (!me || me.id == null) return;
      for (var i = 0; i < list.length; i++) {
        if (list[i] && String(list[i].id) === String(me.id) && list[i].name) { names.push(String(list[i].name)); return; }
      }
    });
    safe(function () { var me = window._calMe || null; if (me && me.name) names.push(String(me.name)); });
    for (var n = 0; n < names.length; n++) {
      var nm = names[n];
      var entry = safe(function () { return roster.resolve(nm); }, null);
      if (entry && entry.name && entry.stableKey) return entry;
    }
    return "all";
  }
  function _resolveDayScope(scope) {
    return safe(function () {
      return resolveProviderRequest(scope, { allowAll: true, requireRosterForAll: false, allowDetectedProvider: true });
    }, null);
  }
  function dayPull(opts) {
    opts = opts || {};
    var __visitNotesAdmission = admitFrozenVisitNotesChoice(opts, dayPull);
    if (__visitNotesAdmission) return __visitNotesAdmission;
    /* fg-1.2 (3.0.43): a dayPull is BY DEFINITION user-initiated ("the ONE
       guarded day lane every visible pull owner calls"), so the doctor is
       present: its history reads get the same presence assist as the manual
       retry, behind the same gates (only when Chrome owns OS focus; the
       doctor's first move away quiets the rest of the batch). Auto/relay
       pulls never pass through here and stay strictly quiet. The flag rides
       the same single-flight protections as the retry lane. */
    /* qol-2.3: armed INSIDE __dayPullInner, only after its advisory in-flight
       check passes - a REFUSED dayPull used to flip presence assist onto a
       batch already reading in this tab and then strip it mid-batch on its
       own settle. Disarm and the end-of-op focus return fire only from the
       call that armed. */
    var __armedHere = false;
    var __armPresence = function () { __armedHere = true; __historyRetryForeground = true; __presenceBatchAnnounced = false; };
    return Promise.resolve().then(function () { return __dayPullInner(opts, __armPresence); }).then(
      function (v) { if (__armedHere) __historyRetryForeground = false; return v; },
      function (e) { if (__armedHere) __historyRetryForeground = false; throw e; });
  }
  /* qol-2.3c CORRECTION: the audit's "the end-of-op verb is sent by NO site
     file" was WRONG - runManagedAthenaOperation's release path (:3818,
     from:"mls-managed-pull") has sent mlsAppFocusMlsTab once per ACQUIRED op
     all along, and schedule-history-pipeline pins that it never fires for a
     refused caller. A duplicate settle-path sender added here briefly DOUBLED
     the signal and fired without lock ownership - the arm-outside-the-guard
     anti-pattern - and the old suite caught it. The mid-pull yank's real
     mechanism was the bg watchdog firing during bridge-silent reads; that
     deferral (qol-2.3, background.js) is the fix and stands. */
  function __dayPullInner(opts, __armPresence) {
    opts = opts || {};
    var say = isFn(opts.onStatus) ? opts.onStatus : function () {};
    var monthForeign = p1MonthForeignOwner();
    if (monthPullRunning || monthForeign) {
      var monthRefusal = p1MonthOverlapRefusal(say, monthForeign && monthForeign.storageFailure ? "metadata-persist-failed" : "pull-in-flight");
      return Promise.resolve(monthRefusal);
    }
    window.__mlsPullStopRequested = false; /* stp-1.0.0: each new run starts unarmed */
    var day = normDate(opts.date) || "";
    /* No date is not this lane to judge: hand it straight to the engine so its
        own refusal is the one the clinician reads. */
    if (!day) { if (isFn(__armPresence)) __armPresence(); return Promise.resolve(pull(opts)); }
    /* pace-1.0 (live 2026-08-03 17:11Z): a REFUSED pull must not navigate.
       The Monday click printed "Opening 2026-07-27..." and THEN hit the
       engine mutex, leaving a resumed Tuesday pass driving the wrong day
       grid (25 honest failures, ~15 min lost). Advisory check only - the
       engine's own single-flight stays the authoritative gate. */
    if (pullRunning || foreignPullLease()) {
      /* lr-1.0 (silent-refusal diagnosis 2026-08-11, click 2): this advisory
         refusal used to return an inline object NOBODY stored - the only
         zero-trace exit in the whole gate chain, un-adjudicable after the
         fact. It now names its gate and holder, speaks through onStatus, and
         stamps the same receipts every other refusal leaves. Advisory check
         only - the engine's own single-flight stays the authoritative gate. */
      var _lrLease = foreignPullLease();
      var _lrHolder = pullRunning ? "this tab's pull engine" : (_lrLease ? (String(_lrLease.kind || _lrLease.id || "foreign-lease") + " lease, " + Math.max(0, Math.round((Date.now() - Number(_lrLease.at || 0)) / 1000)) + "s old") : "a pull lease");
      /* ===== p1-busy-click-1.0.0 =====
         The wording is the mls-connect DS.startPull sentence, because a second
         click during the schedule phase is the same event: the pull the doctor
         is watching is fine. And this refusal must leave the RUNNING pull's
         evidence alone - overwriting lastPullResult / __mlsPullLastOutcome
         here is what made the strip paint "did not return a verified
         completion receipt" over a healthy run. */
      var _lrRefusal = { ok: false, complete: false, reason: "pull-in-flight", gate: "advisory-in-flight",
        busyInFlight: true, holder: _lrHolder, at: Date.now(),
        error: pullRunning
          ? "This pull is already running — watch the progress just below."
          : "Another explicit pull is already running (" + _lrHolder + "). No Athena navigation was started." };
      say(_lrRefusal.error, "");
      return Promise.resolve(_lrRefusal);
    }
    /* lr-1.0 QUOTA PREFLIGHT (diagnosis 2026-08-11 defect B): when the write
       verification guard has recorded a persist failure
       (window.__mlsStoreWriteFailed, qv-1.0 mls-connect) the durable store is
       no longer absorbing growth - pulling more would read charts into a
       store that silently drops them on reload. Refuse LOUDLY before any
       Athena navigation, name the gate, and leave the same receipts every
       other refusal leaves. The flag self-clears on the next verified write,
       so a healthy store is never blocked. */
    var _lrQuota = safe(function () { return window.__mlsStoreWriteFailed; }, null);
    /* ql-1.0 (stale-quota-latch 2026-08-11): judge CURRENT reality, not the
       latch. Post-migration the qv guard's "next verified write" self-clear
       could never fire (the localStorage key it verified was retired to
       IndexedDB), so this gate refused every pull off a flag armed by a boot
       flush that IndexedDB had CONFIRMED (live proof 1, 2026-08-11:
       gate:"quota-preflight" while the store receipt read gen==confirmedGen,
       wbFailures 0, 3.8MB free). When the store's own receipt proves healthy
       confirmed idb writes the latch is stale by proof: clear it and let the
       pull proceed. A store that is GENUINELY failing writes (ls mode,
       degraded or lagging idb) never satisfies the adjudicator and still
       refuses loudly below, unchanged. */
    if (_lrQuota && typeof _quotaLatchStale === "function" && _quotaLatchStale()) _lrQuota = null;
    if (_lrQuota) {
      var _lrQFails = Number(safe(function () { return window.__mlsQuotaGuard && window.__mlsQuotaGuard.failures; }, 0) || 0);
      var _lrQRefusal = { ok: false, complete: false, reason: "storage-full-writes-failing", gate: "quota-preflight",
        failures: _lrQFails, lastFailAt: Number(_lrQuota.at || 0) || null, at: Date.now(),
        error: "MLS could not verify the latest save on this device, so new pull data might not survive a reload. No Athena navigation was started. Keep this tab open, check available storage, then retry the last action before pulling again." };
      say(_lrQRefusal.error, "err");
      lastPullResult = _lrQRefusal;
      safe(function () { window.__mlsPullLastOutcome = { ok: false, at: Date.now(), error: _lrQRefusal.error }; });
      return Promise.resolve(_lrQRefusal);
    }
    if (isFn(__armPresence)) __armPresence(); /* qol-2.3: presence assist belongs to the call that passed the advisory */
    /* p1-onetab-nav-1.0.0 (b): the one-tab advice UP FRONT. Fire-and-forget on
       purpose - the pull must not pay a round trip for a diagnostic - so the
       advice lands within a couple of seconds of the click instead of after a
       60 s nav-failed. It refuses nothing and it is silent unless the
       extension actually reports multiple/unverified athena tabs. */
    safe(function () { p1OneTabPreflight(say); });
    var explicit = (opts.provider !== undefined && opts.provider !== null && opts.provider !== "");
    var scope0 = explicit ? opts.provider : accountProviderRequest();
    var originalProviderRequest = providerRequest(scope0);
    var gate0 = _resolveDayScope(scope0);
    /* Freeze the caller/account's ORIGINAL scope before warm-up. A selected
       request that later fails to resolve may fall back to reading the whole
       grid, but that fallback is not authority to enter the all-provider
       census exception. */
    var p1OriginalCensusAll = originalProviderRequest.mode === "all";
    var needWarm = (_dayPreflightDone !== true) || !(gate0 && gate0.ok === true);
    /* p1-roster-settle-preflight-1.0.0: a skipped pre-flight states the LIVE
       roster receipt, not a synthetic false. */
    var warmed = needWarm ? warmUpDay(day, say) : Promise.resolve({ warmed: false, navOk: false, readOk: false, rosterComplete: rosterReceiptComplete(), observedDay: "", reason: "skipped-already-warm", rosterCompleteAtEntry: rosterReceiptComplete(), rosterSettled: false, rosterSettleMs: 0 });
    return warmed.then(null, function () {
      return { warmed: false, navOk: false, readOk: false, rosterComplete: rosterReceiptComplete(), observedDay: "", reason: "warmup-threw", rosterCompleteAtEntry: false, rosterSettled: false, rosterSettleMs: 0 };
    }).then(function (warm) {
      if (needWarm) _dayPreflightDone = true;
      /* Re-resolve AFTER the pre-flight: that read is what makes a provider
         resolvable at all on a first pull after a reload. */
      /* A selected scope is immutable across the warm-up. Re-reading account
         preferences may safely narrow an original All request, but it must
         never turn an original selected clinician into All. */
      var scope = originalProviderRequest.mode === "selected"
        ? scope0
        : (explicit ? opts.provider : accountProviderRequest());
      var gate = _resolveDayScope(scope);
      /* p1-selected-no-widen-1.0.0: a selected clinician is a hard scope,
         never an invitation to fall back to the whole grid. The warm-up may
         make that clinician resolvable; if it still cannot, refuse before the
         real pull. The previous fallback to `all` could import every provider
         when the returned grid happened to carry complete row attribution. */
      if (originalProviderRequest.mode === "selected" &&
          (!(gate && gate.ok === true) || providerRequest(gate.provider).mode !== "selected")) {
        var selectedReason = String(gate && gate.reason || "provider-unverified");
        var selectedError = String(gate && gate.error || "The selected provider could not be verified after Athena's roster refresh. Nothing was imported; choose that clinician again.");
        var selectedRefusal = {
          ok: false, complete: false, reason: selectedReason, error: selectedError,
          includeHistory: opts.includeHistory !== false,
          created: 0, repaired: 0, skipped: 0, failed: 0, target: day,
          providerMode: "selected", providerRosterReceipt: gate && gate.receipt || null,
          scheduleReceipt: null, providerReceipt: null, calendarReceipt: null, historyReceipt: null,
          retry: { providerRoster: true }
        };
        say(selectedError, "err");
        p1PersistResumeIntent(day, opts, scope0, explicit ? "day-caller" : "day-account", false);
        lastPullResult = selectedRefusal;
        safe(function () { window.__mlsPullLastOutcome = honestPullOutcome(selectedRefusal); });
        return selectedRefusal;
      }
      var provider = (gate && gate.ok === true) ? gate.provider : "all";
      say(provider === "all"
        ? "Pulling every provider painted on the athenaOne Day grid."
        : ("Pulling " + day + " as " + String((provider && provider.name) || "") + "."), "");
      var runOpts = {};
      for (var k in opts) if (opts.hasOwnProperty(k)) runOpts[k] = opts[k];
      runOpts.date = day;
      runOpts.provider = provider;
      runOpts.__p1DetectedProvider = !!(provider && provider !== "all" && provider.detectedOnly === true);
      runOpts.__p1ResumeScopeSource = explicit ? "day-caller" : "day-account";
      if (p1OriginalCensusAll && provider === "all") runOpts.__p1DayCensusToken = P1_DAY_CENSUS_TOKEN;
      else delete runOpts.__p1DayCensusToken;
      if (runOpts.includeHistory === undefined) runOpts.includeHistory = true; /* dayfacts-1.0.0: the day pull's mandatory floor (chart facts + pulled-day note) always runs; the checkbox only widens it to full history */
      var preflight = {
        ran: !!needWarm,
        warmed: !!(warm && warm.warmed),
        navOk: !!(warm && warm.navOk),
        readOk: !!(warm && warm.readOk),
        /* p1-roster-settle-preflight-1.0.0: a SKIPPED pre-flight used to
           publish the synthetic rosterComplete:false unconditionally, so an
           already-verified roster was reported UNVERIFIED on every pull after
           the first. Never state less than the live receipt. */
        rosterComplete: !!(warm && warm.rosterComplete) || rosterReceiptComplete(),
        rosterSettled: !!(warm && warm.rosterSettled),
        rosterSettleMs: Number((warm && warm.rosterSettleMs) || 0),
        /* the field the owner's report compared against providerReceipt */
        rosterVerified: (provider && provider !== "all")
          ? provider.rosterVerified === true
          : rosterReceiptComplete(),
        observedDay: String((warm && warm.observedDay) || ""),
        reason: String((warm && warm.reason) || ""),
        providerMode: provider === "all" ? "all" : "selected",
        providerResolved: provider !== "all",
        scopeSource: explicit ? "caller" : "account"
      };
      var inner = pull(runOpts);
      /* The engine must hand back a settleable receipt. Keep the exact refusal
         the selected-day strip used to raise for a non-promise engine. */
      if (!(inner && isFn(inner.then))) {
        return { ok: false, complete: false, reason: "no-receipt",
          error: "The Athena pull engine did not return a verifiable completion receipt. Reload MLS and try again.",
          preflightReceipt: preflight };
      }
      return inner.then(function (res) {
        safe(function () {
          if (res && typeof res === "object" && res.preflightReceipt === undefined) res.preflightReceipt = preflight;
        });
        return res;
      });
    });
  }
  window.__mlsSI = {
    installed: true,
    version: VERSION,
    asset: "cloned-feat_mls_schedimport_exact.js",
    importAppts: importAppts,
    pull: pull,
    /* cv-1.0.0: the ONE guarded day lane every visible pull owner calls. */
    dayPull: dayPull,
    /* stp-2.0.0: Stop is one act with three consequences - the chart loop
       aborts cooperatively (stp-1.0.0), no further Athena leg starts, and the
       deferred today-note queue is dropped rather than left armed. The lease
       and every mutex still release through runManagedAthenaOperation's normal
       settle path, so nothing stays latched "already running". */
    stopPull: function () {
      window.__mlsPullStopRequested = true;
      var droppedNotes = 0;
      try { droppedNotes = tnDropDeferredQueue("stopped-by-user"); } catch (eStp) {}
      /* notes-idle-1.0.0: Stop means STOP. The idle catch-up is a background
         Athena driver too, so it stops with everything else rather than
         restarting five seconds after the doctor pressed the button. */
      try { niStop("stopped-by-user"); } catch (eNi) {}
      return { requested: true, deferredTodayNotesDropped: droppedNotes };
    },
    _dropDeferredTodayNotes: tnDropDeferredQueue,
    _warmUpDay: warmUpDay,
    /* p1-todaynote-deferred-retry-1.0.0: read-only view of the deferred
       today-note queue, plus a manual drain for diagnostics. Never starts a
       pull and never claims a lease. */
    _todayNoteDeferred: function () {
      return { queued: _tnDefer.queue.length, running: _tnDefer.running === true, waits: Number(_tnDefer.waits || 0),
        armed: _tnDefer.timer != null, athenaFree: tnAthenaFree(),
        /* dnbf-1.0.0: the PHI-free backfill receipt, for the dialog lane. */
        backfill: tnBackfillReceipt(),
        rows: _tnDefer.queue.map(function (q) { return { patientId: q.patientId, day: q.day, attempts: Number(q.attempts || 0), code: String(q.code || "unknown") }; }) };
    },
    _runDeferredTodayNotes: runDeferredTodayNoteRound,
    /* dnbf-1.0.0: the backfill receipt on its own, and the closed code
       vocabulary a surface may render. Both read-only. */
    _todayNoteBackfillReceipt: tnBackfillReceipt,
    _todayNoteReasonCodes: function () { return TN_REASON_CODES.slice(); },
    _todayNoteReasonCode: tnReasonCode,
    /* dnb2-1.0.0: the retry's progress predicate, so its contract can be
       EXECUTED rather than grepped for. Read-only, pure. */
    _todayNoteProgressCode: tnProgressCode,
    /* ===== notes-idle-1.0.0 (the persistent leftover catch-up) =============
       Read-only receipt plus the four verbs a surface needs. Every one of them
       goes through niGate, so none of them can drive Athena while a pull, a
       recording, a draft-all, a review sheet or another engine is on it. */
    notesIdle: niReceipt,
    notesIdleReadNow: niReadNow,
    notesIdleStop: function () { return niStop("stopped-by-user"); },
    notesIdleResume: niResume,
    _notesIdle: niReceipt,
    _notesIdleTick: niTick,
    _notesIdleEnqueue: niEnqueue,
    _notesIdleSyncFromReceipt: niSyncFromReceipt,
    _notesIdleRestampCard: niRestampCard, /* lcd-1.0.0 contract seam; the app reaches it through niSurface */
    _notesIdleGate: niGate,
    _notesIdleLine: niLine,
    _notesIdleFinalLine: niFinalLine,
    _notesIdlePlain: niPlain,
    _notesIdleActivity: niOnActivity,
    _notesIdleNoteOnFile: niNoteOnFile,
    _notesIdleConfig: function () {
      return { version: NI_VERSION, idleMs: NI_IDLE_MS, tickMs: NI_TICK_MS,
        maxAttempts: NI_MAX_ATTEMPTS, backoffMs: NI_BACKOFF_MS.slice(),
        readDeadlineMs: NI_READ_DEADLINE_MS, maxRows: NI_MAX_ROWS,
        keepDays: NI_KEEP_DAYS, storeSuffix: NI_STORE_SUFFIX, lockName: NI_PULL_LOCK,
        activityEvents: NI_ACTIVITY_EVENTS.slice(),
        terminalCodes: Object.keys(NI_TERMINAL_CODES) };
    },
    _accountProviderRequest: accountProviderRequest,
    resumeState: resumeGet,
    resumeDismiss: function () { resumeDismiss(true); return "resume intent cleared"; },
    _maybeResumePull: maybeResumePull,
    /* p1-resume-honesty-1.0.0: why the last offer was (not) made. Read-only. */
    _resumeOfferState: function () { var o = {}; for (var k in p1ResumeOfferState) if (p1ResumeOfferState.hasOwnProperty(k)) o[k] = p1ResumeOfferState[k]; return o; },
    _resumeTabId: p1TabId,
    _resumeSelectedDay: p1SelectedDayKey,
    _resumeVerdictIsTerminal: p1ResumeVerdictIsTerminal,
    /* p1-athena-presence-1.0.0: the lease-free presence probe and the PHI-free
       athena tab count, drivable from a test or the console. */
    _athenaPresenceProbe: p1PresenceProbe,
    _athenaTabCount: p1AthenaTabCount,
    _athenaOneTabAdvice: p1OneTabAdvice,
    _athenaOneTabPreflight: p1OneTabPreflight,
    pullMonth: pullMonth,
    pullCalendarSelection: pullCalendarSelection,
    calendarSelection: calendarSelection,
    /* b752: exported so every verdict surface says the census with ONE set of
       words. The Calendar provider-day surface rendered its own walk-count
       verdict over the top of this one after the promise resolved. */
    contentNotice: contentNotice,
    _providerKey: providerKey,
    _resolveProviderRequest: resolveProviderRequest,
    _monthDateKeys: monthDateKeys,
    _scopeProviderRows: scopeProviderRows,
    _hydrateMissingScheduleProof: hydrateMissingScheduleProof,
    _authoritativeEmptyContract: authoritativeEmptyContract,
    _repairAuthoritativeStore: repairAuthoritativeStore, /* p1-authority-repair-1.0.0 */
    _loadAuthoritativeStore: loadAuthoritativeStore,
    _patientIdentity: patientIdentity,
    _appointmentIdentity: appointmentIdentity,
    _findPatient: findPatient,
    _padoptResolve: padoptResolve, /* padopt-1.0.0: pure, extraction-executable */
    _padoptNameMatch: padoptNameMatch,
    authoritativeRowsForDay: authoritativeRowsForDay,
    authoritativeStatusForDay: function (day, provider) {
      var s = authoritativeStatusForDay(day, provider), out = {};
      for (var k in s) if (s.hasOwnProperty(k) && k !== "_rows") out[k] = s[k];
      return out;
    },
    appointmentCensusRowsForDay: appointmentCensusRowsForDay,
    appointmentCensusStatusForDay: function (day) {
      var s = appointmentCensusStatusForDay(day), out = {};
      for (var k in s) if (s.hasOwnProperty(k) && k !== "_rows") out[k] = s[k];
      return out;
    },
    _publishAppointmentCensusDisplaySnapshot: publishAppointmentCensusDisplaySnapshot,
    _publishAuthoritativeSnapshot: publishAuthoritativeSnapshot,
    _classifyCalendarFailure: classifyCalendarFailure,
    _phiFreeReasonCounts: phiFreeReasonCounts,
    _clearLedgerDone: clearDone,
    _verifiedChartCoverage: verifiedChartCoverage,
    _runHistoryBatch: runHistoryBatch,
    _historyVerdictCensus: historyVerdictCensus, /* pvd-1.0.0: pure, extraction-executable */
    _taxReconcileNamedOmissions: taxReconcileNamedOmissions, /* tax-1.0.0: evidence-gated, extraction-executable */
    _buildRetryRows: buildRetryRows,
    retryFailedHistory: retryFailedHistory,
    _boundedUntil: boundedUntil,
    _deadlineScheduler: absoluteDeadlines,
    _lastPullResult: function () { return lastPullResult; },
    /* nav-1.0.0: the connect lane asks this before it may restart a whole
       pull. cap-1.0.0: the summary lane is drivable from a test/console. */
    _scheduleLandedFor: function (day) { return navScheduleLanded(day); },
    _capResummarize: function (patientId, ms) { return capResummarizeStored(patientId, ms); },
    _capPendingFor: function (rows) { return capPendingPatientIds(rows); },
    _lastResp: function () { return lastResp; },
    _lastRespAt: function () { return lastRespAt; },
    isBusy: function () { return !!(pullRunning || monthPullRunning || historyBatchRunning); },
    revert: revert
  };

  /* ===== notes-idle-1.0.0 (the one-engine handshake + the boot restore) =====
     __mlsNotesIdle is what the OTHER engines read. b121's anyPullRunning() asks
     `reading()` before it opens a chart, and this block asks b121's own
     state.running in niGate - both directions, so a chart can never be opened
     twice at once by the two of them.

     The restore is deliberately LAZY and SILENT: it reads the persisted queue,
     re-arms the clock only if there is unfinished work, and does not touch
     Athena until the ordinary idle gate opens. A reload in the middle of a
     clinic therefore costs nothing and loses nothing. */
  window.__mlsNotesIdle = {
    version: NI_VERSION,
    reading: function () { return _ni.reading === true; },
    receipt: niReceipt,
    line: niLine,
    readNow: niReadNow,
    stop: function () { return niStop("stopped-by-user"); },
    resume: niResume,
    tick: niTick,
    plain: niPlain
  };
  safe(function () {
    niLoad();
    if (niOpenRows() > 0) { niKick(); niSurface(); }
  });

  if (!gateOn()) { window.__mlsSI.installed = false; window.__mlsSI.gated = true; return; }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
