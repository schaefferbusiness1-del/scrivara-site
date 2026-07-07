/* =========================================================================
 * MLS Scribe -- b51 "Pull Last Month" + honest month-pull naming  (__mlsLastMonthB51)
 * 2026-07-06. Additive, guarded, reversible IIFE. Athena READ-ONLY.
 *
 * WHY THIS EXISTS (Michael's bug list, items 5-8):
 *   (5) The existing "Pull whole month" button (feat_pull_month_btn) actually
 *       pulls the trailing 31 days from today, NOT a calendar month - confusing
 *       name. Relabeled here to "Pull last 30 days" (behavior UNCHANGED).
 *   (6) NEW distinct button: "Pull last month" - pulls the actual PREVIOUS
 *       CALENDAR MONTH (e.g. run in July -> June 1-30) for reporting / cost-
 *       estimate workflows, which need a real calendar month, not a rolling
 *       window.
 *   (7) Per-day progress with live counts (found/saved/already-there/failed),
 *       specific status messages (never a bare "loading"), and a final honest
 *       summary - not a silent spinner.
 *   (8) Explicit reminder (before AND during the pull) that athenaOne must be
 *       open on Calendar view, plus a live check that upgrades from "checking"
 *       to a clear amber warning if the schedule can't be read yet.
 *
 * IMPORTANT ENGINEERING NOTE (read before touching this again):
 *   An earlier draft of a full-month puller (dispatch-work/task-1, mp-1.1.0)
 *   was built and unit-tested against window.__mlsSI.importAppts(), which no
 *   longer exists in this build - it would have silently saved ZERO
 *   appointments while showing a "successful" progress bar. This module does
 *   NOT depend on that removed API. It also deliberately does NOT wrap or
 *   call window._importPulledSchedule (already wrapped 3x by item81/item82/
 *   b49 - stacking a 4th wrap on that function is how the b35/item82 fetch-
 *   wrap stack-overflow regression happened). Instead this module posts
 *   appointments itself, directly, with the CORRECT per-row provider
 *   attached (item82's passthrough only stamps ONE global "pulling as"
 *   doctor onto every row, which would mislabel a multi-provider month pull -
 *   see providerFor() below). Dedupe key matches the app's own _apptKey
 *   scheme exactly so re-runs and the existing calendar never double up.
 *
 * SAFETY (hard rules, enforced here):
 *   - READ-ONLY in Athena: only ever asks the extension to READ the schedule
 *     and to NAVIGATE the calendar date (both allowed, read-only). Never
 *     writes/saves/signs/submits anything in athenaOne; never touches orders.
 *   - Only ADDS appointments that don't already exist (name+day[+time] key);
 *     never deletes or overwrites an existing appointment.
 *   - No PHI in console logs; patient names appear only in the on-screen UI.
 *
 * Revert: window.__mlsLastMonthB51.revert()
 * ========================================================================= */
(function () {
  "use strict";
  if (window.__mlsLastMonthB51) return;
  var VERSION = "1.0.0-b51";
  var cleanup = [];
  /* window.__mlsLastMonthTuning lets a test harness speed up the between-day pacing and
     follow-mode poll interval without touching production defaults. */
  var TUNE = (function () { try { return window.__mlsLastMonthTuning || {}; } catch (e) { return {}; } })();
  function tune(k, d) { var v = TUNE[k]; return (typeof v === "number" && v >= 0) ? v : d; }
  var BETWEEN_DAYS_MS = tune("betweenDaysMs", 1100);
  var FOLLOW_POLL_MS = tune("followPollMs", 4000);
  var FOLLOW_MAX_POLLS = tune("followMaxPolls", 40);
  function $(id) { return document.getElementById(id); }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad2(n) { n = String(n); return n.length < 2 ? "0" + n : n; }
  var MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

  /* ---------------- item 5: relabel the existing rolling-31-day button (behavior unchanged) ---------------- */
  function relabelOldButton() {
    var b = $("mls-pull-month-btn");
    if (!b) return false;
    if (b.getAttribute("data-mlsb51") === "1") return true;
    b.textContent = "📅 Pull last 30 days";
    b.title = "Rolling 31-day pull (today backward). For a real calendar month (e.g. all of June), use “Pull last month” instead. Keep athenaOne on View Calendar.";
    b.setAttribute("data-mlsb51", "1");
    return true;
  }

  /* ---------------- dates ---------------- */
  function estToday() {
    var s = safe(function () { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }, null);
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function prevMonthRange() {
    var t = estToday().split("-"); var y = +t[0], m = +t[1];
    var py = (m === 1) ? y - 1 : y, pm = (m === 1) ? 12 : m - 1;
    var lastDay = new Date(py, pm, 0).getDate();
    return { from: py + "-" + pad2(pm) + "-01", to: py + "-" + pad2(pm) + "-" + pad2(lastDay), y: py, m: pm, days: lastDay };
  }
  function prettyDay(key) { var p = key.split("-"); return MONTH_NAMES[+p[1] - 1] + " " + (+p[2]); }
  function prettyRange(r) { return MONTH_NAMES[r.m - 1] + " 1 to " + MONTH_NAMES[r.m - 1] + " " + r.days + ", " + r.y; }
  function dayKeys(r) { var out = [], i; for (i = 1; i <= r.days; i++) out.push(r.y + "-" + pad2(r.m) + "-" + pad2(i)); return out; }
  function normDate(d) {
    if (isFn(window._normDate)) { var v = safe(function () { return window._normDate(d); }, ""); if (v) return v; }
    d = String(d || "").trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
  }
  function apptKey(name, date, time) {
    if (isFn(window._apptKey)) return safe(function () { return window._apptKey(name, date, time); }, name + "|" + date);
    return String(name || "").trim().toLowerCase().replace(/\s+/g, " ") + "|" + String(date || "");
  }

  /* ---------------- backend ---------------- */
  function bkBase() { return safe(function () { return window.bkBase(); }, "") || "https://scrivara-backend.onrender.com"; }
  function bkToken() { return safe(function () { return window.bkToken(); }, "") || ""; }
  function signedIn() { return !!(safe(function () { return isFn(window.backendMode) && window.backendMode(); }, false) && bkToken()); }

  /* ---------------- extension bridge (read-only: schedule read + date nav) ---------------- */
  function bridge(reqType, payload, replyType, timeoutMs, onProgress) {
    return new Promise(function (res) {
      var done = false;
      function fin(v) { if (done) return; done = true; try { window.removeEventListener("message", on, false); } catch (e) {} res(v); }
      function on(ev) {
        var d = ev && ev.data; if (!d || d.source !== "mls-ext") return;
        if (onProgress && d.type === replyType.replace(/Result$/, "Progress") && typeof d.message === "string") { safe(function () { onProgress(d.message); }); return; }
        if (d.type !== replyType) return;
        fin(d.resp !== undefined ? d.resp : d);
      }
      window.addEventListener("message", on, false);
      var msg = { source: "mls-app", type: reqType };
      if (payload) { for (var k in payload) if (payload.hasOwnProperty(k)) msg[k] = payload[k]; }
      safe(function () { window.postMessage(msg, "*"); });
      setTimeout(function () { fin(null); }, timeoutMs || 15000);
    });
  }
  function ping() { return bridge("mlsPing", null, "mlsPong", 3500).then(function (r) { return !!r; }); }
  function readSchedule(onProgress) { return bridge("mlsAppPullSchedule", null, "mlsAppScheduleResult", 45000, onProgress); }
  function gotoDate(dateKey, probe, onProgress) { return bridge("mlsAppGotoDate", { date: dateKey, probe: !!probe }, "mlsAppGotoDateResult", probe ? 6000 : 60000, onProgress); }

  function respSchedDate(r) {
    var sd = safe(function () { return String((r && r.schedDate) || "").slice(0, 10); }, "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) return sd;
    var txt = safe(function () { return String((r && r.text) || ""); }, "");
    var m = /(sunday|monday|tuesday|wednesday|thursday|friday|saturday)[a-z]*[,.]?\s{0,3}([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/i.exec(txt);
    if (m) { var mo = MONTH_NAMES.map(function (x) { return x.toLowerCase(); }).indexOf(String(m[2]).toLowerCase()); if (mo >= 0) return m[4] + "-" + pad2(mo + 1) + "-" + pad2(+m[3]); }
    return "";
  }
  function structuredRows(r) {
    return safe(function () {
      var a = (r && r.appts) || [], out = [];
      for (var i = 0; i < a.length; i++) { var nm = String((a[i] && a[i].name) || "").trim(); if (!nm) continue;
        out.push({ name: nm, dob: String(a[i].dob || ""), time: String(a[i].time || ""), reason: String(a[i].reason || ""), provider: String(a[i].provider || "") }); }
      return out;
    }, []);
  }
  function parsedRows(r) {
    return safe(function () {
      var parsed = isFn(window._parseScheduleText) ? window._parseScheduleText(String((r && r.text) || "")) : [];
      return (Array.isArray(parsed) ? parsed : []).map(function (a) { return { name: a.name, dob: a.dob || "", time: a.time || "", reason: a.reason || "", provider: a.provider || "" }; });
    }, []);
  }
  function providersIn(r) {
    return safe(function () {
      var seen = {}, out = []; function add(p) { p = String(p == null ? "" : p).trim(); if (!p) return; var k = p.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(p); } }
      ((r && r.providers) || []).forEach(add); ((r && r.appts) || []).forEach(function (a) { add(a && a.provider); });
      return out.slice(0, 60);
    }, []);
  }

  /* ---------------- isolated, direct import (does NOT touch _importPulledSchedule) ---------------- */
  var existingKeys = null; /* built once per run */
  function loadExisting() {
    return fetch(bkBase() + "/api/appointments", { headers: { Authorization: "Bearer " + bkToken() } })
      .then(function (r) { return r.ok ? r.json() : { appointments: [] }; })
      .catch(function () { return { appointments: [] }; })
      .then(function (d) {
        var map = {};
        (d.appointments || []).forEach(function (x) {
          var lt = ""; try { if (x.start_at) lt = new Date(x.start_at).toTimeString().slice(0, 5); } catch (e) {}
          var ld = x.appt_date || ""; if (!ld) { try { var dd = new Date(x.start_at); ld = dd.getFullYear() + "-" + pad2(dd.getMonth() + 1) + "-" + pad2(dd.getDate()); } catch (e) {} }
          map[apptKey(x.name, ld, lt)] = 1;
          map["D:" + String(x.name || "").trim().toLowerCase().replace(/\s+/g, " ") + "|" + ld] = 1;
        });
        existingKeys = map;
      });
  }
  /* per-row provider: honor an explicit provider filter for this run; otherwise use whatever
     the athenaOne schedule grid actually showed for that row (never a single global guess). */
  function providerFor(row, runProviderFilter) { return (runProviderFilter && runProviderFilter !== "all") ? runProviderFilter : String(row.provider || "").trim(); }
  function saveRow(dayKey, row, runProviderFilter) {
    var name = String(row.name || "").trim(); if (!name) return Promise.resolve("skip");
    var key = apptKey(name, dayKey, row.time);
    var dayOnlyKey = "D:" + name.toLowerCase().replace(/\s+/g, " ") + "|" + dayKey;
    if (existingKeys[key] || existingKeys[dayOnlyKey]) return Promise.resolve("dup");
    existingKeys[key] = 1; existingKeys[dayOnlyKey] = 1;
    var pts = safe(function () { return (isFn(window.getPatients) ? window.getPatients() : []) || []; }, []);
    var ext = ""; var found = pts.find(function (x) { return String(x.name || "").trim().toLowerCase() === name.toLowerCase(); });
    if (found) { ext = found.id; if (row.dob && !found.dob && isFn(window.upsertPatient)) { found.dob = String(row.dob); safe(function () { window.upsertPatient(found); }); } }
    else if (isFn(window.upsertPatient)) {
      var np = { id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, dob: String(row.dob || ""), reason: String(row.reason || ""), source: "athena-schedule-lastmonth", created: Date.now() };
      safe(function () { window.upsertPatient(np); }); ext = np.id;
    }
    var startIso = null;
    if (/^\d\d?:\d\d$/.test(String(row.time || "")) && isFn(window._acctWallToUtcIso)) { startIso = safe(function () { return window._acctWallToUtcIso(dayKey, ("0" + row.time).slice(-5)); }, null); }
    var provider = providerFor(row, runProviderFilter);
    var body = { name: name, dob: String(row.dob || ""), reason: String(row.reason || ""), patient_external_id: ext || null, appt_date: dayKey, start_at: startIso, provider: provider || undefined };
    return fetch(bkBase() + "/api/appointments", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + bkToken() }, body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? "created" : "failed"; })
      .catch(function () { return "failed"; });
  }

  /* ---------------- state ---------------- */
  var S = null;
  function freshState(range) {
    return { range: range, keys: dayKeys(range), keysToRun: [], provider: "all", running: false, cancelled: false,
      dayStatus: {}, found: 0, saved: 0, dups: 0, failedRows: 0, emptyDays: [], failedDays: [], providersSeen: {},
      startedAt: 0, finishedAt: 0, extNav: null, backend: { verified: false, count: 0, days: 0 } };
  }

  /* ---------------- UI (modeled on the app's own modal styling) ---------------- */
  var STYLE_ID = "mlsLM51Css";
  function injectCss() {
    if ($(STYLE_ID)) return;
    var css = [
      "#mlsLM51back{position:fixed;inset:0;background:rgba(10,20,35,.55);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px;}",
      "#mlsLM51modal{width:600px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 18px 60px rgba(0,0,0,.4);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#12263f;overflow:hidden;}",
      "#mlsLM51modal .mp-head{background:#0f2740;color:#fff;padding:13px 18px;display:flex;align-items:center;gap:10px;}",
      "#mlsLM51modal .mp-head b{font-size:15.5px;font-weight:800;}",
      "#mlsLM51modal .mp-x{margin-left:auto;cursor:pointer;border:0;background:transparent;color:#cfe0f5;font-size:19px;font-weight:800;padding:2px 8px;border-radius:8px;}",
      "#mlsLM51modal .mp-body{padding:14px 18px;overflow:auto;}",
      "#mlsLM51modal .mp-row{display:flex;align-items:center;gap:9px;margin:7px 0;flex-wrap:wrap;}",
      "#mlsLM51modal .mp-dot{width:10px;height:10px;border-radius:50%;background:#9aa9bd;flex:none;}",
      "#mlsLM51modal .mp-dot.g{background:#16a34a;}#mlsLM51modal .mp-dot.r{background:#dc2626;}#mlsLM51modal .mp-dot.a{background:#f59e0b;}",
      "#mlsLM51modal .mp-dot.spin{background:#2f6bed;animation:mlsLM51pulse 1s ease-in-out infinite;}",
      "@keyframes mlsLM51pulse{0%,100%{opacity:1}50%{opacity:.35}}",
      "#mlsLM51modal .mp-conn{font-weight:700;}",
      "#mlsLM51modal .mp-sub{color:#54708c;font-size:12.5px;}",
      "#mlsLM51modal .mp-range{background:#eef4ff;border:1px solid #c6d8f7;border-radius:10px;padding:9px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
      "#mlsLM51modal .mp-range b{color:#123a6b;}",
      "#mlsLM51modal .mp-warn{background:#fff7ed;border:1px solid #fcd9b0;color:#7c3f00;border-radius:10px;padding:8px 12px;font-size:12.5px;margin:8px 0;font-weight:700;}",
      "#mlsLM51modal select{border:1px solid #c6d3e4;border-radius:8px;padding:5px 8px;font:600 13px system-ui;color:#12263f;background:#fff;}",
      "#mlsLM51modal .mp-barwrap{background:#e8eef7;border-radius:999px;height:14px;overflow:hidden;margin:10px 0 4px;}",
      "#mlsLM51modal .mp-bar{height:100%;width:0%;background:linear-gradient(90deg,#2f6bed,#4f8bff);transition:width .35s;}",
      "#mlsLM51modal .mp-counts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0;}",
      "#mlsLM51modal .mp-c{background:#f4f7fc;border:1px solid #e1e9f5;border-radius:10px;padding:7px 10px;text-align:center;}",
      "#mlsLM51modal .mp-c b{display:block;font-size:17px;color:#123a6b;}",
      "#mlsLM51modal .mp-c span{font-size:11px;color:#54708c;font-weight:700;text-transform:uppercase;}",
      "#mlsLM51modal .mp-now{background:#f8fafd;border:1px solid #e1e9f5;border-radius:10px;padding:9px 12px;min-height:52px;}",
      "#mlsLM51modal .mp-now .l1{font-weight:800;color:#123a6b;}",
      "#mlsLM51modal .mp-now .l2{color:#33506e;font-size:13px;margin-top:2px;}",
      "#mlsLM51modal .mp-log{background:#0f2740;color:#d7e6f8;border-radius:10px;padding:9px 12px;height:120px;overflow:auto;font:12px/1.5 ui-monospace,Consolas,monospace;margin-top:10px;white-space:pre-wrap;}",
      "#mlsLM51modal .mp-log .err{color:#ffb4b4;}#mlsLM51modal .mp-log .ok{color:#9ff2bf;}",
      "#mlsLM51modal .mp-days{display:none;margin-top:10px;background:#fff7ed;border:1px solid #fcd9b0;border-radius:10px;padding:8px 12px;font-size:12.5px;color:#7c3f00;}",
      "#mlsLM51modal .mp-foot{display:flex;gap:9px;padding:12px 18px;border-top:1px solid #e6edf6;background:#fbfdff;align-items:center;flex-wrap:wrap;}",
      "#mlsLM51modal .mp-btn{cursor:pointer;border-radius:9px;padding:8px 15px;font:700 13.5px system-ui;border:1px solid #2f6bed;background:#2f6bed;color:#fff;}",
      "#mlsLM51modal .mp-btn[disabled]{opacity:.45;cursor:default;}",
      "#mlsLM51modal .mp-btn.sec{background:#fff;color:#1d4ed8;border-color:#9db9ee;}",
      "#mlsLM51modal .mp-btn.warn{background:#fff;color:#b45309;border-color:#e5b46b;}",
      "#mls-pull-lastmonth-btn{display:block;width:100%;margin-top:8px;padding:10px 14px;border-radius:12px;border:1px solid rgba(120,120,180,.4);background:rgba(120,120,200,.12);color:inherit;font:600 13px system-ui,-apple-system,sans-serif;cursor:pointer;}"
    ].join("\n");
    var s = document.createElement("style"); s.id = STYLE_ID; s.textContent = css; (document.head || document.documentElement).appendChild(s); cleanup.push(function () { s.remove(); });
  }

  function buildModal() {
    if ($("mlsLM51back")) return;
    injectCss();
    var range = prevMonthRange();
    var back = document.createElement("div"); back.id = "mlsLM51back";
    back.innerHTML =
      '<div id="mlsLM51modal" role="dialog" aria-label="Pull last month from Athena">' +
        '<div class="mp-head"><b>🗓️ Pull last month</b><span class="mp-sub" style="color:#9fc0e8">read-only in Athena</span><button class="mp-x" id="mlsLM51close">&times;</button></div>' +
        '<div class="mp-body">' +
          '<div class="mp-warn">⚠️ Keep athenaOne open on <b>Calendar › View Calendar</b> (day/week grid) before you click Start - if it is not on that screen the pull cannot read the schedule.</div>' +
          '<div class="mp-row"><span class="mp-dot spin" id="mlsLM51connDot"></span><span class="mp-conn" id="mlsLM51conn">Checking Athena connection</span></div>' +
          '<div class="mp-sub" id="mlsLM51connSub" style="margin:-3px 0 6px 19px;">Verifying the extension and that athenaOne’s calendar can be read.</div>' +
          '<div class="mp-range"><span>Pulling:</span><b id="mlsLM51range">' + esc(prettyRange(range)) + '</b> <span class="mp-sub">(the full previous calendar month)</span>' +
            '<span style="margin-left:auto">Provider:</span><select id="mlsLM51prov"><option value="all">All providers (each row tagged as scheduled)</option></select></div>' +
          '<div class="mp-barwrap"><div class="mp-bar" id="mlsLM51bar"></div></div>' +
          '<div class="mp-sub" id="mlsLM51barLbl">0 of ' + range.days + ' days</div>' +
          '<div class="mp-counts">' +
            '<div class="mp-c"><b id="mlsLM51cFound">0</b><span>found</span></div>' +
            '<div class="mp-c"><b id="mlsLM51cSaved">0</b><span>saved</span></div>' +
            '<div class="mp-c"><b id="mlsLM51cDup">0</b><span>already there</span></div>' +
            '<div class="mp-c"><b id="mlsLM51cFail">0</b><span>failed days</span></div>' +
          '</div>' +
          '<div class="mp-now"><div class="l1" id="mlsLM51now">Ready.</div><div class="l2" id="mlsLM51now2">Click Start to pull ' + esc(prettyRange(range)) + '. Appointments already on your MLS calendar are skipped, never doubled.</div></div>' +
          '<div class="mp-days" id="mlsLM51failBox"></div>' +
          '<div class="mp-log" id="mlsLM51log" aria-live="polite"></div>' +
        '</div>' +
        '<div class="mp-foot">' +
          '<button class="mp-btn" id="mlsLM51start">Start pull</button>' +
          '<button class="mp-btn warn" id="mlsLM51retry" style="display:none">Retry failed days</button>' +
          '<button class="mp-btn sec" id="mlsLM51cancel" style="display:none">Cancel</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(back); cleanup.push(function () { back.remove(); });
    $("mlsLM51close").addEventListener("click", closeModal);
    $("mlsLM51start").addEventListener("click", function () { startRun(false); });
    $("mlsLM51retry").addEventListener("click", function () { startRun(true); });
    $("mlsLM51cancel").addEventListener("click", function () { if (S) { S.cancelled = true; log("Cancelling - finishing the current step only.", "err"); } });
    back.addEventListener("mousedown", function (ev) { if (ev.target === back && !(S && S.running)) closeModal(); });
    fillProviders();
  }
  function closeModal() { if (S && S.running) log("The pull keeps running in the background - reopen from the same button.", ""); var b = $("mlsLM51back"); if (b) b.style.display = "none"; }
  function showModal() { buildModal(); var b = $("mlsLM51back"); if (b) b.style.display = "flex"; }
  function fillProviders() {
    var sel = $("mlsLM51prov"); if (!sel) return;
    var names = {};
    safe(function () { var roster = window.__mlsProviderRoster && isFn(window.__mlsProviderRoster.list) ? window.__mlsProviderRoster.list() : null; (roster || []).forEach(function (p) { var n = String((p && (p.name || p)) || "").trim(); if (n) names[n] = 1; }); });
    safe(function () { ((window._calAppts) || []).forEach(function (a) { var n = String((a && a.provider) || "").trim(); if (n) names[n] = 1; }); });
    Object.keys(names).sort().forEach(function (n) { var o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o); });
  }
  function setConn(kind, label, sub) { var d = $("mlsLM51connDot"), c = $("mlsLM51conn"), s2 = $("mlsLM51connSub"); if (d) d.className = "mp-dot " + kind; if (c) c.textContent = label; if (s2 && sub != null) s2.textContent = sub; }
  function log(msg, cls) {
    var l = $("mlsLM51log"); if (!l) return;
    var line = document.createElement("div"); if (cls) line.className = cls;
    var t = new Date(); line.textContent = pad2(t.getHours()) + ":" + pad2(t.getMinutes()) + ":" + pad2(t.getSeconds()) + "  " + msg;
    l.appendChild(line); while (l.childNodes.length > 400) l.removeChild(l.firstChild); l.scrollTop = l.scrollHeight;
  }
  function now1(m) { var n = $("mlsLM51now"); if (n) n.textContent = m; }
  function now2(m) { var n = $("mlsLM51now2"); if (n) n.textContent = m; }
  function counts() {
    if (!S) return;
    var done = 0; S.keys.forEach(function (k) { var st = S.dayStatus[k]; if (st && /^(done|empty|failed)$/.test(st.status)) done++; });
    var el;
    el = $("mlsLM51cFound"); if (el) el.textContent = S.found;
    el = $("mlsLM51cSaved"); if (el) el.textContent = S.saved;
    el = $("mlsLM51cDup"); if (el) el.textContent = S.dups;
    el = $("mlsLM51cFail"); if (el) el.textContent = S.failedDays.length;
    el = $("mlsLM51bar"); if (el) el.style.width = Math.round(done * 100 / S.keys.length) + "%";
    el = $("mlsLM51barLbl"); if (el) el.textContent = done + " of " + S.keys.length + " days" + (S.emptyDays.length ? (" - " + S.emptyDays.length + " empty") : "");
    var fb = $("mlsLM51failBox");
    if (fb) { if (S.failedDays.length) { fb.style.display = "block"; fb.innerHTML = "<b>Needs another try:</b> " + S.failedDays.map(function (k) { var st = S.dayStatus[k] || {}; return esc(prettyDay(k)) + (st.error ? (" (" + esc(st.error) + ")") : ""); }).join(" &middot; "); } else fb.style.display = "none"; }
  }
  function setButtons(running) {
    var st = $("mlsLM51start"), ca = $("mlsLM51cancel"), re = $("mlsLM51retry");
    if (st) { st.disabled = !!running; st.style.display = running ? "none" : ""; }
    if (ca) ca.style.display = running ? "" : "none";
    if (re) re.style.display = (!running && S && S.failedDays.length) ? "" : "none";
    var pv = $("mlsLM51prov"); if (pv) pv.disabled = !!running;
  }

  /* honest 3-state connection precheck (never claims connected without a live read;
     never claims disconnected on a single weak signal) */
  function precheck() {
    setConn("spin", "Checking Athena connection", "Verifying the extension and that athenaOne's calendar can be read.");
    log("Checking Athena connection");
    return ping().then(function (ok) {
      if (!ok) { setConn("r", "MLS Assist extension not detected", "Enable MLS Assist in Chrome, then reopen this screen."); log("Extension did not answer - cannot pull.", "err"); return { ok: false }; }
      log("Extension bridge reachable");
      return readSchedule().then(function (r) {
        var host = safe(function () { return (r && r.url) ? new URL(r.url).host : ""; }, "");
        var isAthena = (host && /athenahealth|athenanet|athenaone/i.test(host)) || safe(function () { return String((r && r.emr) || "").toLowerCase() === "athena"; }, false);
        if (r && r.ok === true && host && !isAthena) { setConn("r", "No signed-in athenaOne tab", "The readable tab is " + esc(host) + ", not athenaOne."); log("Non-athena tab detected - not connected.", "err"); return { ok: false }; }
        if (r && r.ok === true && isAthena) {
          setConn("g", "Athena connected", "Verified by a real schedule read.");
          log("Athena connected", "ok");
          return gotoDate(estToday(), true).then(function (nav) { return { ok: true, extNav: !!(nav && (nav.supported || nav.ok)) }; });
        }
        setConn("a", "Checking Athena connection", "The athenaOne schedule hasn't answered yet. Open your signed-in athenaOne tab on Calendar › View Calendar, then press Start again.");
        log("Athena tab not readable yet - staying in 'checking', not calling it disconnected.", "err");
        return gotoDate(estToday(), true).then(function (nav) { return { ok: false, extNav: !!(nav && (nav.supported || nav.ok)) }; });
      });
    });
  }

  function pullDay(dayKey) {
    var pd = prettyDay(dayKey);
    S.dayStatus[dayKey] = { status: "reading" };
    now1("Reading " + pd); now2(""); log("Reading " + pd); counts();
    var navP;
    if (S.extNav) {
      navP = gotoDate(dayKey, false, function (m) { now2(m); }).then(function (nav) {
        if (!nav || nav.ok !== true) return { navFail: (nav && nav.error) || ("Could not navigate athenaOne to " + pd + ".") };
        return { navConfirmed: (nav.schedDate && /^\d{4}-\d{2}-\d{2}$/.test(nav.schedDate)) ? nav.schedDate : dayKey };
      });
    } else {
      now2("Put your athenaOne calendar on " + pd + " - I will detect it and pull automatically.");
      var polls = 0;
      navP = (function waitFor() {
        if (S.cancelled) return Promise.resolve({ navFail: "cancelled" });
        if (polls++ >= FOLLOW_MAX_POLLS) return Promise.resolve({ navFail: "could not confirm athenaOne was on " + pd + " - use Retry once it's on that day." });
        return readSchedule().then(function (r) {
          var sd = respSchedDate(r);
          if (r && r.ok === true && sd === dayKey) return { preRead: r, navConfirmed: dayKey };
          now2(sd && sd !== dayKey ? ("Athena is on " + prettyDay(sd) + " - please move it to " + pd + " (" + polls + "/" + FOLLOW_MAX_POLLS + ").") : ("Waiting for athenaOne to show " + pd + " (" + polls + "/" + FOLLOW_MAX_POLLS + ")."));
          return new Promise(function (res) { setTimeout(res, FOLLOW_POLL_MS); }).then(waitFor);
        });
      })();
    }
    return navP.then(function (st) {
      if (S.cancelled) { S.dayStatus[dayKey] = { status: "failed", error: "cancelled" }; S.failedDays.push(dayKey); return "cancelled"; }
      if (st.navFail) { S.dayStatus[dayKey] = { status: "failed", error: st.navFail }; S.failedDays.push(dayKey); log("FAILED " + pd + ": " + st.navFail, "err"); return "failed"; }
      log("Reading visits for " + pd); now1("Reading visits for " + pd);
      var readP = st.preRead ? Promise.resolve(st.preRead) : readSchedule(function (m) { now2(m); });
      return readP.then(function (r) {
        if (!r || r.ok !== true) { var e = (r && r.error) || "The schedule read did not answer."; S.dayStatus[dayKey] = { status: "failed", error: e }; S.failedDays.push(dayKey); log("FAILED " + pd + ": " + e, "err"); return "failed"; }
        var sd = respSchedDate(r);
        if (sd && sd !== dayKey) { var e2 = "athena showed " + sd + " instead of " + dayKey; S.dayStatus[dayKey] = { status: "failed", error: e2 }; S.failedDays.push(dayKey); log("FAILED " + pd + ": " + e2, "err"); return "failed"; }
        if (!sd && st.navConfirmed !== dayKey) { var e3 = "could not confirm the page date"; S.dayStatus[dayKey] = { status: "failed", error: e3 }; S.failedDays.push(dayKey); log("FAILED " + pd + ": " + e3, "err"); return "failed"; }
        providersIn(r).forEach(function (p) { S.providersSeen[p] = 1; });
        var rows = structuredRows(r); if (!rows.length) rows = parsedRows(r);
        var provSel = $("mlsLM51prov"); var provider = S.provider = (provSel ? provSel.value : "all");
        if (provider !== "all" && rows.length) { var want = provider.trim().toLowerCase().split(/[ ,]/)[0]; rows = rows.filter(function (x) { return String(x.provider || "").toLowerCase().indexOf(want) >= 0; }); }
        if (!rows.length) { S.dayStatus[dayKey] = { status: "empty" }; S.emptyDays.push(dayKey); log(pd + ": no appointments" + (provider !== "all" ? (" for " + provider) : "") + " - empty day, moving on.", ""); counts(); return "empty"; }
        S.found += rows.length;
        log(pd + ": " + rows.length + " appointment" + (rows.length === 1 ? "" : "s") + " found" + (provider !== "all" ? (" (provider filter: " + provider + ")") : ""));
        counts();
        var i = 0, saved = 0, dup = 0, failed = 0;
        function next() {
          if (S.cancelled) return Promise.resolve();
          if (i >= rows.length) return Promise.resolve();
          var row = rows[i++];
          now2("Saving " + (i) + "/" + rows.length + ": " + row.name + (row.time ? (" at " + row.time) : "") + (row.provider ? (" - " + row.provider) : ""));
          return saveRow(dayKey, row, provider).then(function (res) {
            if (res === "created") { saved++; S.saved++; } else if (res === "dup") { dup++; S.dups++; } else if (res === "failed") { failed++; S.failedRows++; }
            return next();
          });
        }
        return next().then(function () {
          S.dayStatus[dayKey] = { status: "done", found: rows.length, saved: saved, skipped: dup, failed: failed };
          log(pd + ": saved " + saved + ", already on calendar " + dup + (failed ? (", NOT saved " + failed + " (needs retry)") : ""), failed ? "err" : "ok");
          if (failed) { S.dayStatus[dayKey].status = "failed"; S.dayStatus[dayKey].error = failed + " appointment" + (failed === 1 ? "" : "s") + " did not save"; S.failedDays.push(dayKey); }
          counts(); return "done";
        });
      });
    });
  }

  function startRun(retryOnly) {
    if (S && S.running) return;
    var range = prevMonthRange();
    if (!S || !retryOnly) S = freshState(range);
    if (retryOnly) { var redo = S.failedDays.slice(); if (!redo.length) return; redo.forEach(function (k) { delete S.dayStatus[k]; }); S.failedDays = []; S.keysToRun = redo; }
    else S.keysToRun = S.keys.slice();
    if (!signedIn()) { now1("Sign in to MLS first."); now2("The pull saves to your MLS account."); log("Not signed in - stopped before touching Athena.", "err"); return; }
    S.running = true; S.cancelled = false; S.startedAt = Date.now(); setButtons(true);
    loadExisting().then(function () {
      return precheck();
    }).then(function (pc) {
      if (!pc.ok) { S.running = false; setButtons(false); return; }
      S.extNav = !!pc.extNav;
      log(S.extNav ? "Extension date navigation available - running hands-free." : "No hands-free date nav (older extension) - running in follow mode.", S.extNav ? "ok" : "");
      log("Pulling Athena calendar: " + prettyRange(S.range)); now1("Pulling Athena calendar: " + prettyRange(S.range));
      var chain = Promise.resolve();
      S.keysToRun.forEach(function (dayKey) { chain = chain.then(function () { if (S.cancelled) return; return pullDay(dayKey).then(function () { counts(); return new Promise(function (res) { setTimeout(res, BETWEEN_DAYS_MS); }); }); }); });
      return chain.then(finishRun);
    }).catch(function (e) { log("Unexpected error: " + String((e && e.message) || e), "err"); S.running = false; setButtons(false); });
  }

  function finishRun() {
    S.finishedAt = Date.now();
    if (S.cancelled) { now1("Cancelled."); now2("Days already saved stay saved. Re-running later is safe."); log("Cancelled.", "err"); S.running = false; setButtons(false); return; }
    log("Updating calendar and patient lists");
    safe(function () { if (isFn(window.loadCalendar)) window.loadCalendar(); });
    safe(function () { if (isFn(window._calLoadNextUp)) window._calLoadNextUp(); });
    safe(function () { if (window.__mlsWhosNext && isFn(window.__mlsWhosNext.render)) window.__mlsWhosNext.render(); });
    safe(function () { if (window.__mlsPick && isFn(window.__mlsPick.reapply)) window.__mlsPick.reapply(); });
    var provs = Object.keys(S.providersSeen), okDays = 0;
    S.keys.forEach(function (k) { var st = S.dayStatus[k]; if (st && st.status === "done") okDays++; });
    var failed = S.failedDays.length, emptyDays = S.emptyDays.length;
    log("Finished pulling " + prettyRange(S.range), "ok");
    now1("Finished pulling " + prettyRange(S.range));
    now2("Found " + S.found + " - saved " + S.saved + " new - " + S.dups + " already on your calendar - " + okDays + " days with visits, " + emptyDays + " empty" + (failed ? (", " + failed + " days need a retry") : ", no failed days") + (provs.length ? (" - providers seen: " + provs.join(", ")) : ""));
    S.running = false; setButtons(false);
  }

  /* ---------------- entry point / button ---------------- */
  function open() { showModal(); }
  function addBtn() {
    if ($("mls-pull-lastmonth-btn")) return true;
    var old = $("mls-pull-month-btn");
    if (!old || !old.parentNode) return false;
    var btn = document.createElement("button"); btn.id = "mls-pull-lastmonth-btn"; btn.type = "button";
    btn.textContent = "🗓️ Pull last month";
    btn.title = "Pulls the FULL previous calendar month (e.g. all of June) for reporting / cost-estimate workflows. Keep athenaOne on View Calendar.";
    btn.addEventListener("click", open);
    old.parentNode.insertBefore(btn, old.nextSibling);
    return true;
  }
  var timers = [];
  function boot() {
    relabelOldButton();
    if (!addBtn()) { var n = 0; var iv = setInterval(function () { relabelOldButton(); if (addBtn() || ++n > 60) clearInterval(iv); }, 1200); timers.push(iv); }
    else { var iv2 = setInterval(relabelOldButton, 3000); timers.push(iv2); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();

  function revert() {
    timers.forEach(function (t) { clearInterval(t); });
    cleanup.forEach(function (f) { safe(f); });
    safe(function () { var b = $("mls-pull-lastmonth-btn"); if (b) b.remove(); });
    window.__mlsLastMonthB51.installed = false;
  }
  window.__mlsLastMonthB51 = { installed: true, version: VERSION, open: open, revert: revert };
})();
