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

  var VERSION = "si-1.7.16";
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
  var PENDING_TTL = 5 * 60 * 1000;
  var inFlight = {};
  var knownDays = {};
  var authoritativeMemory = { v: 1, days: {} };
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
    /* b744 #36: 4/5000 flushed a ~1.4s full-store LZ compress every 4 upserts
       during a pull - the owner's once-a-second freezes. 12/15000 is the
       clamp ceiling (ScribeFlow.html batch API); the forced checkpoint before
       chart navigation and withPatientBatch's terminal flush keep durability. */
    return api ? api.begin({ label: String(label || "managed-pull"), maxChanges: 12, maxDelayMs: 15000 }) : null;
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
      var receipt = endPatientBatch(token, "receipt");
      if (value && typeof value === "object") value.patientPersistenceReceipt = receipt;
      return value;
    }, function (error) {
      try { endPatientBatch(token, "error"); }
      catch (flushError) { try { flushError.originalError = String(error && error.message || error || "").slice(0, 180); } catch (_) {} throw flushError; }
      throw error;
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
    var stableKey = obj ? String(obj.stableKey || obj.stable_key || "") : "";
    var providerRaw = obj ? String(obj.raw || obj.provider_raw || obj.provider || name || "") : String(raw || "");
    var rosterVerified = !!(obj && obj.rosterVerified === true && (id || stableKey));
    if (!name || /^all(?:\s+(?:providers?|doctors?))?$/i.test(name)) return { mode: "all", name: "All providers", id: id, stableKey: stableKey, raw: providerRaw, key: "", rosterVerified: rosterVerified };
    return { mode: "selected", name: name, id: id, stableKey: stableKey, raw: providerRaw, key: providerKey(name), rosterVerified: rosterVerified };
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
    if (!(roster && isFn(roster.resolve) && receipt && receipt.complete === true)) {
      return no("provider-roster-incomplete", "The full Athena provider roster is not verified yet. Re-pull the Day schedule before pulling one provider.");
    }
    var entry = safe(function () { return roster.resolve(raw); }, null);
    if (!entry || !entry.name || !entry.stableKey) {
      return no("provider-unverified", "That provider is not uniquely present in the verified Athena roster. Choose the clinician again.");
    }
    var resolved = {
      id: entry.id != null ? String(entry.id) : "",
      stableKey: String(entry.stableKey),
      raw: String(entry.raw || entry.name),
      name: String(entry.name),
      key: providerKey(entry.name),
      rosterVerified: true
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
      discoveredProviders: providerDiagLabels(resp, rows)
    };
    if (req.mode === "all") {
      receipt.providerTaggedRows = rows.filter(function (r) { return !!providerKey(r && r.provider); }).length;
      receipt.unattributedRows = rows.length - receipt.providerTaggedRows;
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
    var requireStableId = !!(req.id && req.rosterVerified);
    var canonicalNameFallback = false;
    if (requireStableId) {
      var canonicalRoster = safe(function () {
        var api = window.__mlsProviderRoster;
        return api && isFn(api.list) ? (api.list() || []) : [];
      }, []) || [];
      var canonicalSameName = canonicalRoster.filter(function (entry) { return providerKey(entry && entry.name) === req.key; });
      canonicalNameFallback = canonicalSameName.length === 1 && (
        (req.id && String(canonicalSameName[0].id || "").trim().toLowerCase() === String(req.id).trim().toLowerCase()) ||
        (req.stableKey && String(canonicalSameName[0].stableKey || canonicalSameName[0].stable_key || "") === req.stableKey)
      );
    }
    rows.forEach(function (r) {
      var k = providerKey(r && r.provider), rowId = String(rowProviderId(r) || "").trim().toLowerCase();
      var wantId = String(req.id || "").trim().toLowerCase();
      if (!k && !rowId) {
        if (!scopeFill) { receipt.unattributedRows++; return; }
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
        else if (k === req.key) receipt.unattributedRows++;
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
  var CENSUS_FIELDS = ["problems", "meds", "allergies", "vitals", "history", "visits", "summary"];
  /* b754: allergies are counted in the BREAKDOWN but must never, alone, mark a
     record as captured. mergeOwned preserves a prior allergy value whenever the
     fresh read is empty, and athenaOne prints that section as the literal string
     NKDA - so allergies came back present for 19 of 19 patients even on a pull
     that stored nothing, and on a SIGNED-OUT session. A field the broken path
     does not produce cannot be evidence that the path worked. This is the same
     exclusion the chart-import gate already makes, applied one level up. */
  var CENSUS_CONTENT_FIELDS = ["problems", "meds", "vitals", "history", "visits", "summary"];
  function censusPatientContent(p) {
    return {
      problems: censusListHasContent(p && p.problems),
      meds: censusListHasContent(p && p.meds),
      allergies: censusListHasContent(p && p.allergies),
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
    return [censusLen(p.problems), censusLen(p.meds), censusLen(p.allergies), censusLen(p.history),
      censusLen(p.vitals), censusLen(p.bmi), arr.length, bodies, vchars, censusLen(p.summary)].join("|");
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
      fields: { problems: 0, meds: 0, allergies: 0, vitals: 0, history: 0, visits: 0, summary: 0 },
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
        if (any) { out.withContent++; continue; }
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
      (receipt.patients || []).forEach(function (p) {
        if (!p) return;
        var pid = String(p.patientId || "");
        if (p.complete === true) { storedOk++; if (pid) perPatient[pid] = "ok"; return; }
        var why = String(p.reason || "incomplete").slice(0, 120);
        if (pid) perPatient[pid] = why;
        reasons[why] = (reasons[why] || 0) + 1;
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
        census: ledgerCensus
      };
      writeIndex(day, x);
    });
  }
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
  function clearDone(key, day, backendAppointmentId) {
    var x = readIndex(day), old = x.rows[key];
    if (!old || old.state !== "done") return false;
    if (backendAppointmentId && String(old.backendAppointmentId || "") !== String(backendAppointmentId)) return false;
    delete x.rows[key]; writeIndex(day, x); delete inFlight[key]; return true;
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
  function readAuthoritativeStore() {
    var k = authoritativeKey();
    if (!k) return authoritativeMemory;
    return safe(function () {
      var x = JSON.parse(localStorage.getItem(k) || "null");
      if (!x || x.v !== 1 || !x.days || typeof x.days !== "object") x = { v: 1, days: {} };
      authoritativeMemory = x; return x;
    }, authoritativeMemory);
  }
  function writeAuthoritativeStore(x) {
    x = x && x.days ? x : { v: 1, days: {} };
    var k = authoritativeKey(); if (!k) return false;
    var raw = safe(function () { return JSON.stringify(x); }, "");
    if (!raw) return false;
    var stored = safe(function () {
      localStorage.setItem(k, raw);
      return localStorage.getItem(k) === raw;
    }, false);
    if (stored) authoritativeMemory = x;
    return stored;
  }
  function backendRowId(row) { return String(row && row.id != null ? row.id : "").trim(); }
  function localDayOf(row) {
    var d = normDate(row && row.appt_date); if (d) return d;
    return safe(function () {
      if (!row || !row.start_at) return "";
      var x = new Date(row.start_at);
      return x.getFullYear() + "-" + ("0" + (x.getMonth() + 1)).slice(-2) + "-" + ("0" + x.getDate()).slice(-2);
    }, "");
  }
  function selectedSnapshot(day, rawProvider) {
    var store = readAuthoritativeStore(), entry = store.days[String(day || "")] || null;
    if (!entry) return null;
    var req = providerRequest(rawProvider);
    if (req.mode === "selected") return entry.providers && entry.providers[req.key] || null;
    if (rawProvider != null && req.mode === "all") return entry.all || null;
    if (entry.active && entry.active.mode === "provider") return entry.providers && entry.providers[entry.active.key] || null;
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
    var store = safe(function () { return JSON.parse(JSON.stringify(readAuthoritativeStore())); }, { v: 1, days: {} });
    if (!store || !store.days) store = { v: 1, days: {} };
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
    status.activeCount = rows.length; status.missingCount = missing; status.unclassifiedCount = unclassified;
    status.available = missing === 0; status.exact = status.available; status.reason = status.available ? (ids.length ? "exact" : "authoritative-empty") : "backend-rows-pending";
    status._rows = rows; return status;
  }
  function authoritativeRowsForDay(day, rawProvider) {
    var status = authoritativeStatusForDay(day, rawProvider);
    return status.available ? status._rows.slice() : null;
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
  var lastResp = null;
  function onSchedMsg(e) {
    safe(function () {
      var d = e && e.data;
      if (!d || d.source !== "mls-ext" || d.type !== "mlsAppScheduleResult") return;
      var response = d.resp || null;
      if (!authoritativeEmptyContract(response).ok) return;
      lastResp = response;   // kept in memory only; never logged or forwarded
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
    var providerScope = requireProviderCoverage
      ? scopeProviderRows(appts, opts.provider, providerResp)
      : { complete: true, reason: "direct-import", rows: appts, receipt: { mode: "all", complete: true, reason: "direct-import", sourceRows: appts.length, providerTaggedRows: appts.filter(function (a0) { return !!providerKey(a0 && a0.provider); }).length, unattributedRows: appts.filter(function (a0) { return !providerKey(a0 && a0.provider); }).length } };
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
          return { created: created, repaired: repaired, enrichedFields: enrichedFields, providerBackfilled: providerBackfilled, skipped: skipped, failed: failed, attempted: appts.length, wrongDay: wrongDay, invalidDate: invalidDate, days: days, target: target, scope: scopeDate || "", historyTargets: historyTargets, historyUnresolved: historyUnresolved, resolvedAppointments: resolvedAppointments, unresolvedMappings: unresolvedMappings, failureReasons: failureReasons, providerReceipt: providerScope.receipt };
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
          : { ok: false, reason: String(opened && (opened.findReason || opened.reason || opened.error) || "identity-proof-unavailable").slice(0, 80) };
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
    if (!(rosterReceipt && rosterReceipt.complete === true)) {
      return { ok: false, complete: false, reason: "provider-roster-incomplete", error: "The full Athena provider roster is not verified yet. Re-pull the Day schedule before selecting one provider.", providerRosterReceipt: rosterReceipt };
    }
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
    var providerGate = resolveProviderRequest({ id: chosen.id, stableKey: chosen.stableKey, raw: chosen.raw, name: chosen.name, rosterVerified: chosen.rosterVerified }, { allowAll: false });
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
  function frozenRetryEntry(row, target, reason) {
    row = row || {}; target = target || {};
    return {
      patientId: String(target.patientId || row._mlsTargetPatientId || row.patient_external_id || row.patientId || ""),
      reason: String(reason || row.reason || "history-partial").slice(0, 120),
      frozenDob: normDob(target.dob || row._mlsTargetDob || row.dob || row.frozenDob || ""),
      frozenMrn: normMrn(target.mrn || target.athenaId || row._mlsTargetMrn || row.mrn || row.athenaId || row.frozenMrn || "")
    };
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
    });
  }
  function saveVerifiedVisits(target, r) {
    var identity = r && r.identity || {};
    var observed = { chartName: identity.name || r.chartName || "", chartDob: identity.dob || r.chartDob || "", chartMrn: identity.mrn || identity.athenaId || r.chartMrn || "" };
    var proof = safe(function () { return isFn(window._athenaHistoryProofMatches) && window._athenaHistoryProofMatches(target, observed); }, false);
    if (!proof) throw new Error("visits-identity-proof-failed");
    var expected = Number(r && r.receipt && r.receipt.expected), parsed = Number(r && r.receipt && r.receipt.parsed);
    var readerVersion = String(r && r.readerVersion || ""), receiptReaderVersion = String(r && r.receipt && r.receipt.readerVersion || "");
    var provenReader = /^2\.9\.22-visits-r4-two-stage$/.test(readerVersion) && receiptReaderVersion === readerVersion;
    if (!r.receipt || r.receipt.complete !== true || r.receipt.indexComplete !== true || r.receipt.bodyComplete !== true || r.receipt.fullDetail !== true || r.receipt.stableKeysComplete !== true || !provenReader || expected < 0 || parsed !== expected) throw new Error("visits-full-detail-unproven");
    /* A chart whose only encounter rows are administrative order groups has
       zero CLINICAL bodies to read; the reader reports them honestly as
       administrativeRows. That is verified evidence of emptiness-of-bodies,
       not an unproven zero. */
    if (expected === 0 && r.receipt.authoritativeEmpty !== true && !(Number(r.receipt.administrativeRows || 0) > 0)) throw new Error("visits-empty-unproven");
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
    /* Prefer the established strict name+DOB ingest. MRN-verified charts may
       legitimately lack DOB; in that case retain the same per-row veto and
       write through the one visit model with immutable patient binding. */
    var savedCount = 0, reconcileReceipt = null;
    if (target.dob && observed.chartDob && isFn(cv._saveVisits)) {
      savedCount = Number(cv._saveVisits(p, { name: observed.chartName || target.name, dob: observed.chartDob }, visits, function () {}, r.receipt));
    } else {
      if (!target.mrn || !observed.chartMrn || normMrn(target.mrn) !== normMrn(observed.chartMrn)) throw new Error("visits-dob-mrn-proof-missing");
      for (var i = 0; i < visits.length; i++) {
        if (isFn(cv._visitIdentityAgrees) && !cv._visitIdentityAgrees(p, visits[i], true)) throw new Error("visit-row-identity-mismatch");
      }
      visits.forEach(function (raw) {
        if (vm.addVisit(p.id, raw, { source: "athena-schedule-history", identityVerified: true, identityBinding: String(p.id), bodyComplete: true })) savedCount++;
      });
    }
    /* Saving without proving the exact stable encounter set can produce a
       dangerous false green: an inner wrapper may reject a row, or stored
       aliases may collide while older verified rows make the profile look
       populated. Reconcile once more and then prove that every r4 encounter is
       represented by exactly one body-complete row bound to this patient, with
       no extra verified Athena rows left behind. Manual/unverified rows are
       intentionally outside this check and are never deleted. */
    if (!isFn(vm.reconcileVerifiedAthenaVisits)) throw new Error("visits-reconcile-unavailable");
    reconcileReceipt = vm.reconcileVerifiedAthenaVisits(p.id, visits);
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
    if (persisted.length !== parsed) throw new Error("visits-persistence-count-unproven");
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
      if (owners !== 1) throw new Error("visits-persistence-alias-collision");
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
      if(!adminRows.length||!isFn(vm.addVisit)) return;
      var existing=safe(function(){return vm.getVisits(patientById(target.patientId))||[];},[]);
      function adminKey(v){var eid=String(v&&(v.encounterId||v.encounterID)||"").trim().toLowerCase();var body=String(v&&(v.raw||v.text||v.note||v.detail)||"").replace(/\s+/g," ").trim().toLowerCase();return (String(v&&v.date||"")+"|"+(eid||body)).slice(0,400);}
      var seenKeys={};
      existing.forEach(function(v){seenKeys[adminKey(v)]=1;});
      adminRows.forEach(function(row){
        if(!row||!String(row.raw||"").trim()) return;
        var key=adminKey(row); if(!key||seenKeys[key]) return; seenKeys[key]=1;
        if(vm.addVisit(target.patientId,row,{source:"athena-order-group-index",indexOnly:true,administrative:true,bodyComplete:false})) administrativeSaved++;
      });
    });
    var organization=safe(function(){return isFn(vm.organizePatientHistory)?vm.organizePatientHistory(target.patientId):null;},null);
    if(!organization||organization.ok!==true) throw new Error("history-organization-unproven");
    var refreshedCoverage=safe(function(){return isFn(window._patientHistoryCardCoverage)?window._patientHistoryCardCoverage(target.patientId):null;},null);
    var clinicalFieldCount=['problems','meds','allergies','vitals','history'].reduce(function(n,k){return n+(refreshedCoverage&&refreshedCoverage.cards&&refreshedCoverage.cards[k]&&refreshedCoverage.cards[k].populated?1:0);},0);
    return { visitCount: safe(function () { return vm.getVisits(fresh).length; }, visits.length), persistedVisits: persisted.length, savedCount: savedCount, administrativeSaved: administrativeSaved, parsedVisits: parsed, expectedVisits: expected, visitsCoverageComplete: true, bodyComplete: true, fullDetail: true, readerVersion: readerVersion, authoritativeEmpty: expected===0&&r.receipt.authoritativeEmpty===true, reconcileReceipt: reconcileReceipt, organization:organization, profileCoverage:refreshedCoverage, clinicalFieldCount:clinicalFieldCount };
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
    function ppTally(s){ try{ s.ok=s.rows.filter(function(r){return r.ok===true;}).length; s.failed=s.rows.filter(function(r){return r.ok!==true&&r.pending!==true;}).length; }catch(e){} }
    function ppStart(total,base){ var s=ppState(); if(!s) return; if(base>0){ s.running=true; if(total>s.total) s.total=total; return; } s.running=true; s.total=total||0; s.done=0; s.ok=0; s.failed=0; s.current=''; s.rows=[]; }
    function ppCurrent(name){ var s=ppState(); if(s&&s.running) s.current=String(name||''); }
    function ppSettle(name,ok,reason,pending){ var s=ppState(); if(!s||!s.running) return null; var r={name:String(name||''),ok:ok===true,reason:String(reason||''),pending:pending===true}; s.rows.push(r); s.done=(s.done||0)+1; if(s.total&&s.done>s.total) s.total=s.done; ppTally(s); return r; }
    function ppResolve(rowRef,ok,reason){ var s=ppState(); if(!s||!rowRef) return; rowRef.ok=ok===true; rowRef.pending=false; rowRef.reason=String(reason||''); ppTally(s); }
    function ppEnd(){ var s=ppState(); if(s){ s.running=false; s.current=''; } }
    var sweepDepth = Number(sweepOpts && sweepOpts.depth != null ? sweepOpts.depth : sweepOpts) || 0;
    var sweepDeadlineCapAt = Number(sweepOpts && sweepOpts.deadlineCapAt || 0);
    /* si-1.9.4 (owner 2026-07-22): "when the bar resets it makes it seem like
       nothing was done". The pull bar parses "N of M" from these statuses, so
       a sweep sub-batch reporting "1 of 2" visually threw away 14 finished
       charts. Sweeps now report their position INSIDE the whole pull
       (base + i of the original total) — the bar only ever moves forward. */
    var sweepProgressBase = Math.max(0, Math.floor(Number(sweepOpts && sweepOpts.progressBase || 0)));
    var sweepProgressTotal = Math.max(0, Math.floor(Number(sweepOpts && sweepOpts.progressTotal || 0)));
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
    var readStats = { chart: [], visits: [] };
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
    var receipt = { requestId: batchRequestId, startedAt: batchStartedAt, deadlineAt: batchDeadlineAt, timedOut: false, requested: rows.length + unresolved.length, processed: 0, complete: false, exactIdentityVerified: false, patients: [], retry: unresolved.map(function (item) { return frozenRetryEntry(item, null, item && item.reason); }), failures: unresolved.length };
    if (historyBatchRunning) {
      rows.forEach(function (r) { receipt.retry.push(frozenRetryEntry(r, null, "history-batch-busy")); });
      receipt.failures = receipt.retry.length; receipt.reason = "history-batch-busy"; return receipt;
    }
    /* 2026-07-28 cross-tab refusal: a pull running in ANOTHER tab owns the
       shared shield - starting a second engine here is exactly how "N saves
       not confirmed" happened (two rosters, one store, per-tab guards). The
       refusal reuses the busy lane so every caller already handles it. */
    if (safe(function () { return window.__mlsPullShieldForeign && window.__mlsPullShieldForeign(); }, false)) {
      rows.forEach(function (r) { receipt.retry.push(frozenRetryEntry(r, null, "history-batch-busy-other-tab")); });
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
    /* User preference: pull the six-card chart history WITHOUT opening every
       encounter body (much faster day prep). Default ON (full visits). Read
       once per batch so one mid-batch toggle flip cannot split semantics. */
    var pullVisitBodies = safe(function () {
      /* N4 (2026-07-25, phone lane): an EXPLICIT per-pull choice outranks this
         device's own stored preference.
         This read is the whole reason the phone's "Full visit notes" checkbox
         did nothing. A relay pull is COMMANDED BY THE PHONE but EXECUTED on the
         office computer, and this line reads the EXECUTING device's
         localStorage — so the office machine's checkbox silently decided how
         much of the patient's record came back, no matter what the clinician
         chose on the phone in their hand.
         Scoped override rather than threading a parameter: sweepOpts does not
         reach here on either main call path (2 of 3 call sites pass nothing),
         so plumbing it would mean editing a recursive batch in a large
         PHI-scope module. pull() sets this for the duration of one pull and
         always clears it, so behaviour is IDENTICAL unless a caller explicitly
         asked. */
      if (typeof _pullBodiesOverride === "boolean") return _pullBodiesOverride;
      var k = typeof window.uns === "function" ? window.uns("pullVisitBodies") : "";
      var sk = typeof window.uns === "function" ? window.uns("pullVisitBodiesSet") : "";
      var v = k ? localStorage.getItem(k) : null;
      var chosen = sk ? localStorage.getItem(sk) === "1" : false;
      /* 2026-07-28: default ON — an index-only pull is not complete history
         (owner bar: first-pull completeness). Only an explicit human choice
         (the ...Set marker, written by the toggles from this build on) can
         select the fast no-bodies lane; the code-authored legacy '0' that
         accumulated while the toggle never rendered is ignored. */
      return chosen ? v !== "0" : true;
    }, true);
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
    function launchPipelinedParse(entry, parseArgs) {
      entry.one.parsePipelined = true;
      var t0 = Date.now();
      entry.promise = saveOrganizedHistory(parseArgs.target, parseArgs.row, parseArgs.rd, parseArgs.readStartedAt, parseArgs.deadlineAt, parseArgs.requestId).then(function (organizedResult) {
        entry.stageMs.parseSave += Date.now() - t0;
        entry.one.chartCoverage = organizedResult.chartCoverage; entry.one.profileCoverage = organizedResult.profileCoverage; entry.one.clinicalFieldCount = organizedResult.clinicalFieldCount; entry.one.dobVerified = organizedResult.dobVerified === true;
        entry.one.organized = !!(entry.one.profileCoverage && entry.one.profileCoverage.complete === true);
        entry.one.chartReason = "";
      }, function (parseErr) {
        entry.stageMs.parseSave += Date.now() - t0;
        entry.one.chartReason = String(parseErr && parseErr.message || parseErr || "chart-parse-failed").slice(0, 120);
        if (parseErr && parseErr.mlsEchoes) entry.one.chartEchoes = parseErr.mlsEchoes;
      });
      pipelineParses.push(entry);
    }
    async function collectOverlapParse(overlap, one, stageMs, patientDeadlineAt) {
      /* Settle the overlapped parse; on a non-timeout failure give it ONE
         bounded sequential re-run (same rd - the chart was verified when it
         was read), then apply exactly what the inline path applied. */
      if (!overlap) return;
      var outcome = await overlap.settled;
      stageMs.parseSave += Date.now() - overlap.t0;
      if (!outcome.ok && !/timeout|deadline/i.test(String(outcome.e && outcome.e.message || "")) && Date.now() + 300000 < batchDeadlineAt) {
        /* si-1.7.2 semantics preserved: the single bounded retry is a FULL
           fresh open+verify+parse (never a bare re-parse of a possibly stale
           read) - exactly what the inline path did, deferred post-visits. */
        one.chartRetried = true;
        var __rpChartT0 = Date.now(), __rpParseT0 = 0;
        try {
          var reChartDeadlineAt = Math.min(batchDeadlineAt, Date.now() + 110000);
          var reReadStartedAt = Date.now();
          var rdRetry = await boundedUntil(window._assistReadChart(overlap.args.target, function () {}, { requestId: overlap.args.requestId + "-r2chart", deadlineAt: reChartDeadlineAt }), reChartDeadlineAt, "chart-read-deadline-exceeded");
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
        one.chartReason = String(outcome.e && outcome.e.message || outcome.e || "chart-parse-failed").slice(0, 120);
        if (outcome.e && outcome.e.mlsEchoes) one.chartEchoes = outcome.e.mlsEchoes;
        if (/timeout|deadline/i.test(one.chartReason)) { stopAfterTimeout = true; receipt.timedOut = true; }
      }
    }
    /* b752: THE BEFORE HALF OF THE MEASUREMENT, taken before the first chart is
       opened. A census taken only after the walk cannot tell a record THIS pull
       filled from one an earlier pull filled, so on the second zero-write pull of
       the same day the gap would close and the verdict would be back to claiming
       coverage it never captured. Pure read, no write, same resolver. */
    receipt.storeCensusBefore = storedContentCensus(rows, unresolved);
    ppStart((sweepProgressTotal > rows.length ? sweepProgressTotal : rows.length), sweepProgressBase);
    try {
      for (var i = 0; i < rows.length; i++) {
        safe(function () { window.__mlsPullBusyAt = Date.now(); }); /* si-1.7.9: keep the merge deferred for the whole batch */
        if (Date.now() >= batchDeadlineAt) {
          receipt.timedOut = true; stopAfterTimeout = true;
          for (var bi = i; bi < rows.length; bi++) receipt.retry.push(frozenRetryEntry(rows[bi], null, "deferred-after-batch-deadline"));
          break;
        }
        var row = rows[i] || {}, target = exactHistoryTarget(row), carryProof = null, one = { patientId: String(row._mlsTargetPatientId || row.patient_external_id || ""), identityVerified: false, organized: false, organizationComplete: false, visitsComplete: false, complete: false };
        if (!target) {
          one.reason = "identity-target-unresolved"; ppSettle(row.name, false, one.reason); receipt.patients.push(one); receipt.retry.push(frozenRetryEntry(row, null, one.reason)); receipt.processed++; continue;
        }
        one.patientId = String(target.patientId || one.patientId);
        one.identityVerified = true;
        one.identityProof = target.mrn ? "mrn" : (target.dob ? "dob" : "");
        var patientRequestId = batchRequestId + "-p" + (i + 1);
        /* si-1.9.1: sweep attempts get a tighter window — one glacial chart
           must not eat the whole remaining sweep budget. */
        var patientDeadlineAt = Math.min(batchDeadlineAt, Date.now() + (sweepDepth ? 5 : 6) * 60 * 1000);
        var patientReadStartedAt = Date.now();
        one.requestId = patientRequestId; one.deadlineAt = patientDeadlineAt;
        if (onStatus) onStatus("Reading verified history " + (sweepProgressBase + i + 1) + " of " + (sweepProgressTotal > rows.length ? sweepProgressTotal : rows.length) + (sweepDepth ? " (automatic re-check)" : "") + "...", "");
        ppCurrent(row.name || (target && target.name) || "");
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
            rd = await boundedUntil(window._assistReadChart(target, function () {}, { requestId: chartRequestId, deadlineAt: chartDeadlineAt }), chartDeadlineAt, "chart-read-deadline-exceeded");
            stageMs.chart += Date.now() - __chartT0;
            recordReadMs('chart', Date.now() - __chartT0);
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
            one.chartReason = String(chartErr && chartErr.message || chartErr || "chart-read-failed").slice(0, 120);
            if (chartErr && chartErr.mlsEchoes) one.chartEchoes = chartErr.mlsEchoes;
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
        /* Skipping visits is recorded honestly on the receipt — a skipped
           stage is never reported as verified encounter bodies. A pipelined
           entry's organizationComplete lands at finalization, after its
           parse settles. */
        if (!stopAfterTimeout && pullVisitBodies !== true) {
          one.visitsComplete = true;
          one.visitsSkipped = true;
          if (one.parsePipelined !== true) one.organizationComplete = one.organized;
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
        } else if (!stopAfterTimeout) {
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
              var visitsDeadlineAt = Math.min(patientDeadlineAt, Date.now() + (visitsAttempt === 1 && !sweepDepth ? adaptiveCeilingMs('visits', 60000, 195000, 100000) : 195000));
              try {
                vr = await boundedUntil(bridge("mlsAppAllVisitsResult", "mlsAppReadAllVisits", 190000, { requestId: visitsRequestId, deadlineAt: visitsDeadlineAt, managed: true, background: true, silent: true, initiator: "schedule-batch", hint: { patient: target.name, name: target.name, dob: target.dob || "", athenaId: target.mrn || target.athenaId || "" } }), visitsDeadlineAt, "visits-read-deadline-exceeded");
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
                  await boundedUntil(window._assistReadChart(target, function () {}, { requestId: patientRequestId + "-trreopen" + visitsAttempt, deadlineAt: trReopenDeadlineAt }), trReopenDeadlineAt, "chart-reopen-deadline-exceeded");
                } catch (trReopenErr) {}
                await new Promise(function (rWait) { var c = safe(function () { return absoluteDeadlines.arm(Date.now() + 1800, rWait); }, null); if (!c) rWait(); });
                continue;
              }
              if (vr && vr.ok) { recordReadMs('visits', Date.now() - __vAttemptT0); break; }
              var vErrText = String((vr && (vr.reason || vr.error)) || "visits-read-failed");
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
                  await boundedUntil(window._assistReadChart(target, function () {}, { requestId: patientRequestId + "-reopen" + visitsAttempt, deadlineAt: reopenDeadlineAt }), reopenDeadlineAt, "chart-reopen-deadline-exceeded");
                } catch (reopenErr) {}
                await new Promise(function (rWait) { var c = safe(function () { return absoluteDeadlines.arm(Date.now() + 1800, rWait); }, null); if (!c) rWait(); });
                continue;
              }
              throw new Error(vErrText);
            }
            await collectOverlapParse(overlapParse, one, stageMs, patientDeadlineAt); overlapParse = null;
            var __visitSaveT0 = Date.now();
            var savedVisits = saveVerifiedVisits(target, vr);
            stageMs.visitSave = Date.now() - __visitSaveT0;
            one.visitsComplete = true; one.visitCount = savedVisits.visitCount; one.persistedVisits=savedVisits.persistedVisits; one.parsedVisits = savedVisits.parsedVisits; one.expectedVisits = savedVisits.expectedVisits; one.visitsCoverageComplete = savedVisits.visitsCoverageComplete; one.visitsReaderVersion = savedVisits.readerVersion; one.authoritativeEmpty=savedVisits.authoritativeEmpty===true; one.reconcileReceipt=savedVisits.reconcileReceipt; one.organizationComplete=!!(savedVisits.organization&&savedVisits.organization.ok===true); one.organizationReceipt=savedVisits.organization;
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
          } catch (visitErr) { one.visitsReason = String(visitErr && visitErr.message || visitErr || "visits-read-failed").slice(0, 120); if (/timeout|deadline/i.test(one.visitsReason)) { stopAfterTimeout = true; receipt.timedOut = true; } }
          if (overlapParse) { try { await collectOverlapParse(overlapParse, one, stageMs, patientDeadlineAt); } catch (eOverlapLate) {} overlapParse = null; }
          stageMs.visits = Date.now() - __visitsT0;
        }
        if(one.visitsSkipped!==true&&one.visitsVerifiedCarry!==true&&one.organized&&one.visitsComplete&&Number(one.clinicalFieldCount||0)===0&&Number(one.parsedVisits||0)===0&&one.authoritativeEmpty!==true){one.organizationComplete=false;one.visitsReason="clinical-field-coverage-unproven";}
        one.stageMs = { chartMs: stageMs.chart, parseSaveMs: stageMs.parseSave, visitsMs: stageMs.visits, visitSaveMs: stageMs.visitSave, totalMs: Date.now() - patientReadStartedAt };
        if (one.parsePipelined !== true) {
          one.complete = !!(one.identityVerified && one.dobVerified===true && one.organized && one.organizationComplete && one.visitsComplete);
          if (!one.complete) {
            one.reason = one.chartReason || one.visitsReason || "history-partial";
            receipt.retry.push(frozenRetryEntry(row, target, one.reason));
          }
        }
        one.__ppRow = ppSettle(row.name, one.parsePipelined === true ? false : one.complete === true, one.parsePipelined === true ? "finishing…" : (one.complete === true ? "" : (one.reason || "")), one.parsePipelined === true);
        receipt.patients.push(one); receipt.processed++;
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
        if (!pOne.organized && !/timeout|deadline/i.test(String(pOne.chartReason || "")) && Date.now() + 300000 < batchDeadlineAt) {
          pOne.chartRetried = true; pOne.parseDeferredRetried = true;
          var pRetryDeadlineAt = Math.min(batchDeadlineAt, Date.now() + (sweepDepth ? 4 : 6) * 60 * 1000);
          var pRetryReadStartedAt = Date.now();
          var __dChartT0 = Date.now(), __dParseT0 = 0;
          try {
            var pRetryChartDeadlineAt = Math.min(pRetryDeadlineAt, Date.now() + 110000);
            var rdRetry = await boundedUntil(window._assistReadChart(pEntry.target, function () {}, { requestId: pOne.requestId + "-chart-d2", deadlineAt: pRetryChartDeadlineAt }), pRetryChartDeadlineAt, "chart-read-deadline-exceeded");
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
            pOne.chartReason = String(pRetryErr && pRetryErr.message || pRetryErr || "chart-read-failed").slice(0, 120);
            if (pRetryErr && pRetryErr.mlsEchoes) pOne.chartEchoes = pRetryErr.mlsEchoes;
            if (/timeout|deadline/i.test(pOne.chartReason)) receipt.timedOut = true;
          }
        }
        pOne.organizationComplete = pOne.organized;
        /* Pipelined totalMs is SELF time (chart + parse + visits stages), not
           wall time to finalization — wall time would double-count overlap. */
        pOne.stageMs = { chartMs: pEntry.stageMs.chart, parseSaveMs: pEntry.stageMs.parseSave, visitsMs: pEntry.stageMs.visits, visitSaveMs: pEntry.stageMs.visitSave, totalMs: pEntry.stageMs.chart + pEntry.stageMs.parseSave + pEntry.stageMs.visits };
        pOne.complete = !!(pOne.identityVerified && pOne.dobVerified === true && pOne.organized && pOne.organizationComplete && pOne.visitsComplete);
        if (!pOne.complete) {
          pOne.reason = pOne.chartReason || pOne.visitsReason || "history-partial";
          receipt.retry.push(frozenRetryEntry(pEntry.row, pEntry.target, pOne.reason));
        }
        ppResolve(pOne.__ppRow, pOne.complete === true, pOne.complete === true ? "" : (pOne.reason || ""));
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
    function finalizeVerdict() {
      receipt.exactIdentityVerified = receipt.retry.length === 0 && receipt.patients.length === rows.length && receipt.patients.every(function (p) { return p && p.identityVerified === true; });
      /* An empty verified provider day has no patient history targets and is
         vacuously exact; unresolved/name-only rows remain in retry and fail. */
      if (receipt.requested === 0) receipt.exactIdentityVerified = true;
      receipt.failures = receipt.retry.length;
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
      receipt.reason = receipt.complete ? "complete" : "history-partial";
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
          day = normDate((rows[di] && (rows[di].scheduleDate || rows[di].date)) || "");
        }
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
    if (pullVisitBodies !== true) {
      var todayNoteDayById = {};
      try { rows.forEach(function (r) { var pid = String((r && (r._mlsTargetPatientId || r.patient_external_id)) || ""); if (pid) todayNoteDayById[pid] = normDate((r && (r.scheduleDate || r.date)) || "") || ""; }); } catch (eMap) {}
      var vpToday = safe(function () { return window.__mlsVisitSavePref; }, null);
      for (var tn = 0; tn < receipt.patients.length; tn++) {
        var oneTn = receipt.patients[tn];
        if (!oneTn || oneTn.visitsSkipped !== true) continue;
        safe(function () { if (window.__mlsPullShieldTick) window.__mlsPullShieldTick(); });
        var tnDay = todayNoteDayById[String(oneTn.patientId || "")] || "";
        var tnId = String(oneTn.patientId || "");
        var tnP = (tnDay && tnId) ? safe(function () { return findStorePatient(tnId); }, null) : null;
        if (!(vpToday && typeof vpToday.runForPatient === "function" && tnP)) { oneTn.todayNote = false; oneTn.todayNoteReason = tnDay ? "reader-unavailable" : "no-day-on-row"; continue; }
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
        if (!todayNoteExtOk) { oneTn.todayNote = false; oneTn.todayNoteReason = "extension-predates-scoped-read"; continue; }
        try {
          var tnRes = await vpToday.runForPatient(tnP, function () {}, { onlyDate: tnDay });
          oneTn.todayNote = !!(tnRes && (tnRes.ok === true || typeof tnRes === "number" || tnRes.visits != null));
          if (!oneTn.todayNote) oneTn.todayNoteReason = String((tnRes && tnRes.reason) || "scoped-read-unverified").slice(0, 80);
        } catch (eTn2) { oneTn.todayNote = false; oneTn.todayNoteReason = String((eTn2 && eTn2.message) || eTn2).slice(0, 80); }
      }
    }
    finalizeVerdict();
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
    var SWEEPABLE_REASON = /^(visit-bodies-incomplete|same-frame-name-mismatch|same-frame-name-missing|visits-time-budget-exceeded|visits-read-deadline-exceeded|chart-read-deadline-exceeded|stale-encounter-surface-open|encounter-surface-not-open|visits-total-not-readable|visits-list-still-rendering|visits-panel-not-open|no-athena-tab|deferred-after-timeout)/;
    if (!sweepDepth) try {
      receipt.sweepPasses = 0;
      for (var sweepPass = 1; sweepPass <= 3 && !receipt.complete; sweepPass++) {
        var sweepable = receipt.retry.filter(function (entry) { return SWEEPABLE_REASON.test(String(entry && entry.reason || "")); });
        if (!sweepable.length) break;
        if (Date.now() + 240000 >= batchDeadlineAt) { receipt.sweepBudgetExhausted = true; break; }
        /* si-1.9.4: lead with the held progress ("14 of 16") so the bar keeps
           its place; with zero finished there is no progress to hold, so the
           count-free wording leaves the bar untouched. */
        if (onStatus) onStatus((rows.length > sweepable.length ? (rows.length - sweepable.length) + " of " + rows.length + " charts finished — re-checking " : "Re-checking ") + sweepable.length + " in-use chart" + (sweepable.length === 1 ? "" : "s") + " (automatic pass " + sweepPass + ")...", "");
        var swept = buildRetryRows(sweepable);
        var sub = null;
        try { sub = await runHistoryBatch(swept.rows, swept.unresolved, onStatus, { depth: 1, deadlineCapAt: batchDeadlineAt, progressBase: Math.max(0, rows.length - swept.rows.length), progressTotal: rows.length }); } catch (eSweep) { break; }
        receipt.sweepPasses = sweepPass;
        if (!sub || !Array.isArray(sub.patients)) break;
        var recoveredIds = {};
        sub.patients.forEach(function (sp) {
          if (!sp) return;
          var pid = String(sp.patientId || "");
          if (!pid) return;
          if (sp.complete === true) { sp.sweepRecovered = sweepPass; recoveredIds[pid] = true; }
          var replaced = false;
          for (var ri = 0; ri < receipt.patients.length; ri++) {
            if (String(receipt.patients[ri] && receipt.patients[ri].patientId || "") === pid) { receipt.patients[ri] = sp; replaced = true; break; }
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
        finalizeVerdict();
      }
    } finally {
      /* b744 #36: the OUTER batch closes the progress reporter exactly once,
         after every automatic sweep pass — the panel now lives continuously
         from first row to true finish (no teardown at sweep boundaries, no
         elapsed reset, the pts pull shield never drops mid-pull). */
      safe(ppEnd);
    }
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
    safe(function () { var l = window.__mlsSchedulePullLease; if (l && l.id === SI_LEASE_ID) delete window.__mlsSchedulePullLease; });
  }
  function runManagedAthenaOperation(task, busyFactory) {
    function busy(scope) {
      return isFn(busyFactory) ? busyFactory(scope || "same-tab") : { ok: false, complete: false, reason: "pull-in-flight", error: "Another explicit pull is already running." };
    }
    if (pullRunning) return Promise.resolve(busy("same-tab"));
    if (foreignPullLease()) return Promise.resolve(busy("same-tab"));
    pullRunning = true;
    var operationStarted = false, leaseTouch = null;
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
      if (safe(function () { return !!(navigator && navigator.locks && isFn(navigator.locks.request)); }, false)) {
        operation = navigator.locks.request("mls-managed-athena-pull", { mode: "exclusive", ifAvailable: true }, function (lock) {
          return lock ? start() : busy("other-tab");
        });
      } else operation = start();
    } catch (lockError) {
      operation = Promise.reject(lockError);
    }
    return Promise.resolve(operation).then(function (value) {
      pullRunning = false;
      if (leaseTouch != null) { safe(function () { clearInterval(leaseTouch); }); leaseTouch = null; }
      releaseSiLease();
      /* the busy stamp is cleared identically on success and rejection, so the
         progress chip cannot tell them apart from its disappearance alone —
         record the real outcome BEFORE zeroing the stamp (finding #5) */
      safe(function () { window.__mlsPullLastOutcome = { ok: true, at: Date.now() }; });
      safe(function () { window.__mlsPullBusyAt = 0; });
      if (operationStarted) xtabBusyClear();
      if (operationStarted) releaseManagedAthenaWorkspace();
      return value;
    }, function (error) {
      pullRunning = false;
      if (leaseTouch != null) { safe(function () { clearInterval(leaseTouch); }); leaseTouch = null; }
      releaseSiLease();
      safe(function () { window.__mlsPullLastOutcome = { ok: false, at: Date.now(), error: String(error && error.message || error || 'pull failed').slice(0, 200) }; });
      safe(function () { window.__mlsPullBusyAt = 0; });
      if (operationStarted) xtabBusyClear();
      if (operationStarted) releaseManagedAthenaWorkspace();
      throw error;
    });
  }

  /* Rebuild verifiable history-target rows from frozen retry entries. Frozen
     proofs (normDob/normMrn tokens) are re-checked against the CURRENT stored
     patient; any drift refuses. Downstream gets the stored separator forms
     (_athenaHistoryTargetSnapshot rejects bare tokens). Shared by the manual
     retry button and the si-1.9.0 automatic end-of-batch re-sweep. */
  function buildRetryRows(retryEntries) {
    var seen = {}, rows = [], unresolved = [];
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
      rows.push({
        patient_external_id: patientId,
        _mlsTargetPatientId: patientId,
        _mlsTargetDob: frozenDob ? storedDob : "",
        _mlsTargetMrn: frozenMrn ? storedMrn : "",
        name: String(patient.name || ""),
        dob: frozenDob ? storedDob : "",
        mrn: frozenMrn ? storedMrn : "",
        athenaId: frozenMrn ? storedMrn : ""
      });
    });
    return { rows: rows, unresolved: unresolved };
  }

  function retryFailedHistory(source, onStatus) {
    var history = source && source.historyReceipt ? source.historyReceipt : (source || {});
    var retry = Array.isArray(history.retry) ? history.retry : [];
    var built = buildRetryRows(retry);
    var rows = built.rows, unresolved = built.unresolved;
    if (!retry.length) {
      var alreadyComplete = history && history.complete === true && history.exactIdentityVerified === true && Number(history.failures || 0) === 0;
      return Promise.resolve({
        requestId: "history-retry-empty-" + Date.now().toString(36),
        retryOf: String(history.requestId || ""), requested: 0, processed: 0,
        complete: alreadyComplete, exactIdentityVerified: alreadyComplete, patients: [], retry: [], failures: alreadyComplete ? 0 : 1,
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
        return runHistoryBatch(rows, unresolved, isFn(onStatus) ? onStatus : function () {});
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
    var includeHistory = opts.includeHistory !== false; /* safe default: full verified workflow */
    var onStatus = isFn(opts.onStatus) ? opts.onStatus : function () {};
    var providerGate = resolveProviderRequest(opts.provider, { allowAll: true, requireRosterForAll: false });
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
      var out = { ok: false, complete: false, reason: reason || "failed", includeHistory: includeHistory, created: 0, repaired: 0, skipped: 0, failed: 0, target: date, providerRosterReceipt: providerGate.receipt || null, scheduleReceipt: null, providerReceipt: null, calendarReceipt: null, historyReceipt: null, retry: {} };
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
      function gotoDateSettled() {
        var settleWaits = [2500, 5000, 8000];
        function attempt(round) {
          return bridge("mlsAppGotoDateResult", "mlsAppGotoDate", 60000, { date: date, probe: false }).then(function (nav) {
            var day0 = normDate(nav && nav.schedDate);
            var bad = !nav || nav.ok === false || (day0 && day0 !== date);
            if (!bad || round >= settleWaits.length) return nav;
            onStatus("Athena is still switching days — re-checking in a moment...", "");
            return (window.__mlsBgSleep ? window.__mlsBgSleep(settleWaits[round]) : new Promise(function (resWait) { setTimeout(resWait, settleWaits[round]); })).then(function () {
              return attempt(round + 1);
            });
          });
        }
        return attempt(0);
      }
      return gotoDateSettled().then(function (nav) {
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
        return bridge("mlsAppScheduleResult", "mlsAppPullSchedule", 30000, { requestId: scheduleRequestId }).then(function (r) {
        if (!r || !r.ok) { onStatus((r && r.error) || "Couldn't read your athenaOne tab. Open your Day schedule and try again.", "err"); return fail((r && r.reason) || "no-read", { error: r && r.error || "", scheduleReceipt: r && r.receipt || null, retry: { schedule: true } }); }
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
        if(!verifiedEmptyDay&&!(currentProviderRosterReceipt&&currentProviderRosterReceipt.complete===true&&currentProviderRosterReceipt.partial!==true)){
          onStatus("Athena's full provider roster was not verified. Nothing was imported; keep the complete Day schedule open and retry.","err");
          return fail("provider-roster-incomplete",{scheduleReceipt:r.receipt,providerRosterReceipt:currentProviderRosterReceipt,retry:{schedule:true,providerRoster:true}});
        }
        if (!verifiedEmptyDay && !rosterReceiptBatchBound(currentProviderRosterReceipt)) {
          onStatus("Athena's provider roster receipt was not bound to this exact pull request and scope. Nothing was imported; retry.", "err");
          return fail("provider-roster-unbound", { scheduleReceipt: r.receipt, providerRosterReceipt: currentProviderRosterReceipt, rosterOperationArmed: !!rosterOperationArmed, retry: { schedule: true, providerRoster: true } });
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
        var parsedP = exactRows.length
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
          var preScoped = scopeProviderRows(rows, providerTarget, r);
          var bootstrapP = includeHistory && preScoped.complete
            ? hydrateMissingScheduleProof(preScoped.rows, onStatus, date)
            : Promise.resolve({ rows: preScoped.rows || [], receipt: {
                complete: includeHistory ? false : true,
                attempted: Number(preScoped.rows && preScoped.rows.length || 0),
                alreadyProven: 0, requested: 0, resolved: 0, failed: includeHistory ? Number(preScoped.rows && preScoped.rows.length || 0) : 0,
                exactNameUnique: 0, skipped: !includeHistory, reason: !includeHistory ? "not-requested" : "provider-scope-unverified", reasons: {},
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
          return importAppts(rows, { date: date, scopeDate: date, provider: providerTarget, providerResponse: r, requireProviderCoverage: true, includeHistory: includeHistory, requirePatientBinding: includeHistory, onEach: onEachImport }).then(async function (res) {
            res = res || {};
            /* Crash-safe phase boundary: appointments and any materialized or
               enriched patient identities are durable before chart navigation
               starts. Later history saves remain coalesced in bounded groups. */
            checkpointPatientBatch(opts.__patientStoreBatch, "schedule-import", true);
            res.identityBootstrapReceipt = identityBootstrap && identityBootstrap.receipt || null;
            var selectedProvider = providerRequest(providerTarget);
            if (!res.providerReceipt || res.providerReceipt.complete !== true) {
              var providerReason = res.reason || (res.providerReceipt && res.providerReceipt.reason) || "provider-unverified";
              onStatus(providerReason === "provider-incomplete"
                ? "Some Athena schedule rows did not identify their provider. Nothing was imported; retry after the full day grid finishes loading."
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
              providerScope: providerScopeReceipt(selectedProvider.mode),
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
            var snapshotReceipt = publishAuthoritativeSnapshot({ date: date, provider: providerTarget, scheduleReceipt: r.receipt, returnedAppointments: r.appts, providerDiag: r.providerDiag, providerReceipt: res.providerReceipt || null, calendarReceipt: calendarReceipt, resolvedAppointments: mappings });
            calendarReceipt.snapshotPublished = snapshotReceipt.published === true;
            calendarReceipt.snapshotReason = snapshotReceipt.reason;
            if (calendarReceipt.complete && !calendarReceipt.snapshotPublished) calendarReceipt.complete = false;
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
            var historyReceipt = includeHistory
              ? await runHistoryBatch(res.historyTargets || [], res.historyUnresolved || [], onStatus)
              : { requested: 0, processed: 0, complete: true, exactIdentityVerified: true, skipped: true, reason: "not-requested", patients: [], retry: [], failures: 0 };
            var providerComplete = selectedProvider.mode !== "selected" || !!(res.providerReceipt && res.providerReceipt.complete);
            var identityBootstrapComplete = !includeHistory || !!(res.identityBootstrapReceipt && res.identityBootstrapReceipt.complete === true);
            var historyComplete = !includeHistory || !!(historyReceipt.complete && historyReceipt.exactIdentityVerified === true);
            var complete = !!(r.receipt.complete && providerComplete && identityBootstrapComplete && calendarReceipt.complete && historyComplete);
            res.ok = complete; res.complete = complete;
            res.includeHistory = includeHistory;
            res.reason = complete ? (res.reason === "provider-empty" ? "provider-empty" : (r.receipt.authoritativeEmpty ? "empty-day" : (includeHistory ? "complete" : "complete-schedule-only"))) : (!providerComplete ? "provider-unverified" : (!identityBootstrapComplete ? "identity-bootstrap-partial" : (!calendarReceipt.complete ? "calendar-partial" : "history-partial")));
            res.scheduleVerified = r.scheduleVerified === true;
            res.providerRosterReceipt = currentProviderRosterReceipt;
            res.scheduleReceipt = r.receipt; res.providerReceipt = res.providerReceipt || null; res.calendarReceipt = calendarReceipt; res.historyReceipt = historyReceipt;
            res.retry = { schedule: false, calendarFailed: calendarReceipt.failed, calendarClass: calendarReceipt.failureClass, history: historyReceipt.retry || [] };
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
            var __mismatch = 0, __noIndex = 0, __noTab = 0;
            try {
              (historyReceipt.patients || []).forEach(function (p) {
                var why = String((p && (p.visitsReason || p.chartReason || p.reason)) || "");
                if (/same-frame-name-mismatch/.test(why)) __mismatch++;
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
            res.athenaSignedOutSuspected = __noTab >= 2;
            if (!complete) onStatus("Incomplete: schedule " + scheduleSummary + "; history " + historySummary + "; failures " + (calendarReceipt.failed + historyFailures) + ". It is safe to retry; MLS did not mark this pull complete." +
              (res.athenaSignedOutSuspected ? " " + __noTab + " charts could not be read because MLS could not find a signed-in athenaOne tab — your athenaOne session has most likely signed out or timed out. Sign in to athenaOne, then pull again. Note the schedule above was read off the grid athenaOne still had on screen, so treat it as of that moment rather than as of now." : "") +
              (res.multiTabSuspected ? " " + __mismatch + " charts were refused because MLS read a DIFFERENT athenaOne tab than the one it opened — close every athenaOne tab except one and pull again. Nothing was saved to the wrong patient." : "") +
              (__noIndex ? " " + __noIndex + " chart" + (__noIndex === 1 ? "" : "s") + " could not be read: MLS could not confirm a complete visit list for " + (__noIndex === 1 ? "it" : "them") + ", so " + (__noIndex === 1 ? "its" : "their") + " history was left untouched rather than saved as partial. Nothing was written to the wrong patient. This is an MLS reader limitation, not something you did." : "") + contentNotice(historyReceipt), "err");
            else if (!includeHistory) onStatus("Schedule-only complete: " + scheduleSummary + " appointments accounted for; history was not requested." + freshnessNotice(r) + providerScopeNotice(selectedProvider.mode), "ok");
            else onStatus("Verified complete: schedule " + scheduleSummary + "; history " + historySummary + "; failures 0." + freshnessNotice(r) + providerScopeNotice(selectedProvider.mode) + contentNotice(historyReceipt), "ok");
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
     Bounded on purpose: an intent older than 2h is dropped, at most 2 automatic
     resumes are attempted (a day that keeps failing must not loop forever), a
     pull running in another tab is never disturbed, and the doctor always sees
     the countdown with a way to stop it.
     --------------------------------------------------------------------- */
  var RESUME_MAX_AGE_MS = 2 * 60 * 60 * 1000, RESUME_MAX_ATTEMPTS = 2, RESUME_COUNTDOWN_S = 10;
  function resumeKey() { return safe(function () { return isFn(window.uns) ? window.uns("pullResumeV1") : "pullResumeV1"; }, "pullResumeV1"); }
  function resumeGet() { return safe(function () { var r = window.localStorage.getItem(resumeKey()); return r ? JSON.parse(r) : null; }, null); }
  function resumeSave(rec) { safe(function () { window.localStorage.setItem(resumeKey(), JSON.stringify(rec)); }); }
  function resumeClear() { safe(function () { window.localStorage.removeItem(resumeKey()); }); }
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

  function pull(opts) {
    opts = opts || {};
    /* Only an explicit boolean overrides; anything else leaves the device
       preference in charge, so a caller that says nothing changes nothing. */
    _pullBodiesOverride = (typeof opts.pullVisitBodies === "boolean") ? opts.pullVisitBodies : null;
    var __resumeDate = String(opts.date || "");
    if (__resumeDate) {
      var __prev = resumeGet();
      resumeSave({
        date: __resumeDate,
        startedAt: Date.now(),
        attempts: (__prev && __prev.date === __resumeDate) ? Number(__prev.attempts || 0) : 0,
        includeHistory: opts.includeHistory !== false,
        /* 2026-07-28 invariant fix: a resumed pull must keep the ORIGINAL
           bodies choice - a phone-commanded fast-lane pull that reloads must
           not resume as a full-bodies pull on the office default. */
        bodies: (typeof _pullBodiesOverride === 'boolean') ? _pullBodiesOverride : null
      });
    }
    var run = function () {
      return withPatientBatch("schedule-pull", function (token) {
        var runOpts = {};
        for (var k in opts) if (opts.hasOwnProperty(k)) runOpts[k] = opts[k];
        runOpts.__patientStoreBatch = token;
        return pullUnlocked(runOpts);
      });
    };
    return runManagedAthenaOperation(run, function (scope) {
      return { ok: false, complete: false, reason: "pull-in-flight", error: scope === "other-tab"
        ? "Another MLS tab is already running an explicit pull. Nothing else was started."
        : "Another explicit pull is still running in this MLS tab.", includeHistory: opts.includeHistory !== false, retry: {} };
    }).then(function (value) {
      _pullBodiesOverride = null;          /* one pull only */
      lastPullResult = value || null;
      /* Clear the intent only when the day is genuinely finished. An honest
         partial keeps it, so the next load continues instead of forgetting. */
      if (__resumeDate && value && value.complete === true) resumeClear();
      return value;
    }, function (err) {
      /* A failed pull must not leave a remote caller's choice in force for the
         NEXT one, which could be a local pull by the doctor at that desk. */
      _pullBodiesOverride = null;
      throw err;
    });
  }

  var monthPullRunning = false;
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

  /* One exact month route for Staff prep and the chart-history continuation.
     It deliberately reuses pull() for every frozen day: same two-dimensional
     schedule receipt, same exact provider/appointment/patient identity, same
     idempotent importer, and the same default-on verified history batch. */
  function pullMonth(opts) {
    opts = opts || {};
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
    var includeHistory = opts.includeHistory !== false;
    var onStatus = isFn(opts.onStatus) ? opts.onStatus : function () {};
    var gate = resolveProviderRequest(opts.provider, { allowAll: true, requireRosterForAll: true });
    function failed(reason, error) {
      return { ok: false, complete: false, reason: reason, error: error || "", month: month, includeHistory: includeHistory, provider: gate.provider || null, providerRosterReceipt: gate.receipt || null, days: [], totals: { days: 0, completeDays: 0, scheduleAttempted: 0, scheduleAccounted: 0, historiesRequested: 0, historiesProcessed: 0, failures: 0 }, retry: { dates: [] } };
    }
    if (!dates || !dates.length) return Promise.resolve(failed("invalid-month", "Choose the current or a past month."));
    if (!gate.ok) { onStatus(gate.error || "The provider roster is incomplete.", "err"); return Promise.resolve(failed(gate.reason, gate.error)); }
    if (monthPullRunning) return Promise.resolve(failed("pull-in-flight", "Another exact month pull is already running."));
    var frozenProvider = gate.provider === "all" ? "all" : {
      id: String(gate.provider.id || ""), stableKey: String(gate.provider.stableKey || ""), raw: String(gate.provider.raw || gate.provider.name || ""),
      name: String(gate.provider.name || ""), rosterVerified: true
    };
    var result = {
      ok: false, complete: false, reason: "month-partial", month: month, includeHistory: includeHistory,
      provider: frozenProvider, providerRosterReceipt: gate.receipt || null,
      /* prs-1.0.0: an ALL-provider MONTH pull inherits exactly the same
         painted-grid coverage limit as the day pull it repeats. */
      providerScope: providerScopeReceipt(frozenProvider === "all" ? "all" : "selected"), days: [],
      totals: { days: dates.length, completeDays: 0, scheduleAttempted: 0, scheduleAccounted: 0, created: 0, repaired: 0, skipped: 0, historiesRequested: 0, historiesProcessed: 0, failures: 0 },
      retry: { dates: [] }
    };
    monthPullRunning = true;
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
        if (breaker.tripped) {
          result.days.push({ date: date, ok: false, complete: false, reason: "not-attempted-after-systemic-failure" });
          result.totals.failures++; result.retry.dates.push(date);
          return;
        }
        onStatus("Month pull " + (index + 1) + "/" + dates.length + ": " + date, "");
        return pull({
          date: date,
          provider: frozenProvider,
          includeHistory: includeHistory,
          onStatus: function (message, kind) { onStatus(date + ": " + String(message || ""), kind); }
        }).then(function (day) {
          day = day || { ok: false, complete: false, reason: "no-result" };
          result.days.push({ date: date, ok: day.ok === true, complete: day.complete === true, reason: day.reason || "", receipt: day });
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
        }, function (err) {
          result.days.push({ date: date, ok: false, complete: false, reason: "exception", error: String(err && err.message || err || "") });
          result.totals.failures++; result.retry.dates.push(date);
        });
      });
    });
    return chain.then(function () {
      monthPullRunning = false;
      result.complete = result.totals.completeDays === dates.length && result.retry.dates.length === 0;
      result.ok = result.complete;
      result.reason = result.complete ? "complete" : (breaker.tripped ? "month-stopped-systemic" : "month-partial");
      if (breaker.tripped) result.systemicReason = breaker.reason;
      onStatus(result.complete
        ? ("Verified month complete: " + result.totals.completeDays + "/" + dates.length + " days; schedule " + result.totals.scheduleAccounted + "/" + result.totals.scheduleAttempted + "; histories " + result.totals.historiesProcessed + "/" + result.totals.historiesRequested + "; failures 0." + providerScopeNotice(frozenProvider === "all" ? "all" : "selected"))
        : (breaker.tripped
          ? ("Month pull STOPPED EARLY — every day was failing the same way: " + (SYSTEMIC_TEXT[breaker.reason] || breaker.reason.replace(/-/g, " ")) + (breaker.hint ? " " + breaker.hint : "") + " Fix that first, then use Retry failed days (" + result.retry.dates.length + " day" + (result.retry.dates.length === 1 ? "" : "s") + " remain; nothing was skipped silently).")
          : ("Month incomplete: " + result.totals.completeDays + "/" + dates.length + " days verified; retry " + result.retry.dates.length + " day" + (result.retry.dates.length === 1 ? "" : "s") + ".")), result.complete ? "ok" : "err");
      return result;
    }, function (err) {
      monthPullRunning = false;
      result.reason = "month-exception"; result.error = String(err && err.message || err || "");
      result.totals.failures++; return result;
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
    var frozenProvider = { id: sel.provider.id, stableKey: sel.provider.stableKey || "", raw: sel.provider.raw || sel.provider.name, name: sel.provider.name, key: sel.provider.key, rosterVerified: sel.provider.rosterVerified === true };
    var frozenDate = sel.date;
    onStatus("Pulling " + frozenProvider.name + " on " + frozenDate + "...", "");
    var includeHistory = opts.includeHistory !== false;
    /* si-1.6.4: every explicit user pull flows through the ONE public entry
       (window.__mlsSI.pull). The calendar route previously invoked the
       module-internal pull, so external observers wrapping the public seam
       (e.g. the PHI-free acceptance collector) never saw the run. The month
       route intentionally keeps its internal per-day calls: its own public
       pullMonth result carries the per-day receipts. */
    var publicPull = safe(function () {
      return window.__mlsSI && isFn(window.__mlsSI.pull) ? window.__mlsSI.pull : null;
    }, null) || pull;
    return publicPull({ date: frozenDate, provider: frozenProvider, includeHistory: includeHistory, onStatus: onStatus }).then(function (res) {
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
      if (window.__mlsNextUp && window.__mlsNextUp.version === "nextup-2.0.0") return;
      if (document.querySelector('script[data-mls-asset="feat_nextup_connect.js"]')) return;
      var s = document.createElement("script");
      s.src = "feat_nextup_connect.js?v=20260714auth1";
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
    resumeDismiss(false);
    var prev = resumeGet() || rec;
    resumeSave({ date: rec.date, startedAt: Date.now(), attempts: Number(prev.attempts || 0) + 1, includeHistory: rec.includeHistory !== false, bodies: (typeof rec.bodies === 'boolean') ? rec.bodies : null });
    safe(function () {
      var resumeOpts = { date: rec.date, includeHistory: rec.includeHistory !== false, onStatus: function (m, k) {
        safe(function () { if (isFn(window.__mlsDsStatus)) window.__mlsDsStatus(m, k); });
      } };
      if (typeof rec.bodies === 'boolean') resumeOpts.pullVisitBodies = rec.bodies;
      pull(resumeOpts);
    });
  }
  function resumeOffer(rec) {
    if (resumeCard || typeof document === "undefined" || !document.body) return;
    var left = RESUME_COUNTDOWN_S;
    var box = document.createElement("div");
    box.id = "mlsPullResumeCard";
    box.setAttribute("role", "status");
    box.style.cssText = "position:fixed;left:16px;bottom:84px;z-index:9000;max-width:340px;background:#eef6f1;border:1px solid #cfe0d7;color:#204034;border-radius:12px;padding:11px 13px;font-size:13px;box-shadow:0 6px 20px rgba(0,0,0,.16)";
    box.innerHTML = '<div style="font-weight:700;margin-bottom:3px">↻ Unfinished pull for ' + String(rec.date).replace(/[<>&"]/g, "") + '</div>' +
      '<div id="mlsPullResumeMsg" style="font-size:12.5px;line-height:1.35">This page reloaded before the pull finished. Continuing in ' + left + 's — already-verified charts are skipped.</div>' +
      '<div style="margin-top:8px;display:flex;gap:6px"><button type="button" id="mlsPullResumeGo" style="border:1px solid #2e6a4b;background:#2e6a4b;color:#fff;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:700;cursor:pointer">Continue now</button>' +
      '<button type="button" id="mlsPullResumeNo" style="border:1px solid #bcd0c5;background:#fff;color:#204034;border-radius:8px;padding:6px 11px;font-size:12.5px;font-weight:700;cursor:pointer">Not now</button></div>';
    document.body.appendChild(box);
    resumeCard = box;
    safe(function () { document.getElementById("mlsPullResumeGo").onclick = function () { resumeStart(rec); }; });
    safe(function () { document.getElementById("mlsPullResumeNo").onclick = function () { resumeDismiss(true); }; });
    resumeTimer = setInterval(function () {
      left--;
      if (left <= 0) { resumeStart(rec); return; }
      safe(function () { var m = document.getElementById("mlsPullResumeMsg"); if (m) m.textContent = "This page reloaded before the pull finished. Continuing in " + left + "s — already-verified charts are skipped."; });
    }, 1000);
  }
  function maybeResumePull() {
    var rec = resumeGet();
    if (!rec || !rec.date) return;
    if (!(Date.now() - Number(rec.startedAt || 0) < RESUME_MAX_AGE_MS)) { resumeClear(); return; }
    if (Number(rec.attempts || 0) >= RESUME_MAX_ATTEMPTS) return;   // never loop on a day that keeps failing
    if (pullRunning || resumeBusyElsewhere()) return;               // another tab owns it
    resumeOffer(rec);
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
  function warmUpDay(date, onStatus) {
    var day = normDate(date) || "";
    var say = isFn(onStatus) ? onStatus : function () {};
    var out = { warmed: false, navOk: false, readOk: false, rosterComplete: false, observedDay: "", reason: "" };
    if (!day) { out.reason = "no-date"; return Promise.resolve(out); }
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
        var rec = roster && isFn(roster.getReceipt) ? roster.getReceipt() : null;
        out.rosterComplete = !!(rec && rec.complete === true);
      });
      out.warmed = out.navOk && out.readOk;
      return out;
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
      return resolveProviderRequest(scope, { allowAll: true, requireRosterForAll: false });
    }, null);
  }
  function dayPull(opts) {
    opts = opts || {};
    var say = isFn(opts.onStatus) ? opts.onStatus : function () {};
    var day = normDate(opts.date) || "";
    /* No date is not this lane to judge: hand it straight to the engine so its
        own refusal is the one the clinician reads. */
    if (!day) return Promise.resolve(pull(opts));
    var explicit = (opts.provider !== undefined && opts.provider !== null && opts.provider !== "");
    var scope0 = explicit ? opts.provider : accountProviderRequest();
    var gate0 = _resolveDayScope(scope0);
    var needWarm = (_dayPreflightDone !== true) || !(gate0 && gate0.ok === true);
    var warmed = needWarm ? warmUpDay(day, say) : Promise.resolve({ warmed: false, navOk: false, readOk: false, rosterComplete: false, observedDay: "", reason: "skipped-already-warm" });
    return warmed.then(null, function () {
      return { warmed: false, navOk: false, readOk: false, rosterComplete: false, observedDay: "", reason: "warmup-threw" };
    }).then(function (warm) {
      if (needWarm) _dayPreflightDone = true;
      /* Re-resolve AFTER the pre-flight: that read is what makes a provider
         resolvable at all on a first pull after a reload. */
      var scope = explicit ? opts.provider : accountProviderRequest();
      var gate = _resolveDayScope(scope);
      var provider = (gate && gate.ok === true) ? gate.provider : "all";
      say(provider === "all"
        ? "Pulling every provider painted on the athenaOne Day grid."
        : ("Pulling " + day + " as " + String((provider && provider.name) || "") + "."), "");
      var runOpts = {};
      for (var k in opts) if (opts.hasOwnProperty(k)) runOpts[k] = opts[k];
      runOpts.date = day;
      runOpts.provider = provider;
      if (runOpts.includeHistory === undefined) runOpts.includeHistory = true;
      var preflight = {
        ran: !!needWarm,
        warmed: !!(warm && warm.warmed),
        navOk: !!(warm && warm.navOk),
        readOk: !!(warm && warm.readOk),
        rosterComplete: !!(warm && warm.rosterComplete),
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
    asset: "feat_mls_schedimport_exact.js",
    importAppts: importAppts,
    pull: pull,
    /* cv-1.0.0: the ONE guarded day lane every visible pull owner calls. */
    dayPull: dayPull,
    _warmUpDay: warmUpDay,
    _accountProviderRequest: accountProviderRequest,
    resumeState: resumeGet,
    resumeDismiss: function () { resumeDismiss(true); return "resume intent cleared"; },
    _maybeResumePull: maybeResumePull,
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
    _patientIdentity: patientIdentity,
    _appointmentIdentity: appointmentIdentity,
    _findPatient: findPatient,
    authoritativeRowsForDay: authoritativeRowsForDay,
    authoritativeStatusForDay: function (day, provider) {
      var s = authoritativeStatusForDay(day, provider), out = {};
      for (var k in s) if (s.hasOwnProperty(k) && k !== "_rows") out[k] = s[k];
      return out;
    },
    _publishAuthoritativeSnapshot: publishAuthoritativeSnapshot,
    _classifyCalendarFailure: classifyCalendarFailure,
    _phiFreeReasonCounts: phiFreeReasonCounts,
    _clearLedgerDone: clearDone,
    _verifiedChartCoverage: verifiedChartCoverage,
    _runHistoryBatch: runHistoryBatch,
    retryFailedHistory: retryFailedHistory,
    _boundedUntil: boundedUntil,
    _deadlineScheduler: absoluteDeadlines,
    _lastPullResult: function () { return lastPullResult; },
    _lastResp: function () { return lastResp; },
    revert: revert
  };

  if (!gateOn()) { window.__mlsSI.installed = false; window.__mlsSI.gated = true; return; }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
