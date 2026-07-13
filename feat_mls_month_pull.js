/* ============================================================================
 * feat_mls_month_pull.js  ->  window.__mlsMonthPull   (mp-1.0.0)
 * ---------------------------------------------------------------------------
 * TASK-1: FULL PREVIOUS-MONTH ATHENA CALENDAR PULL (read-only in Athena).
 *
 * WHAT THIS IS
 *   One polished MLS-style workflow that pulls the ENTIRE previous calendar
 *   month (e.g. run in July 2026 -> June 1 to June 30, 2026) from the signed-in
 *   athenaOne tab into the MLS calendar, day by day, with:
 *     - a real progress screen (connection, range, current day, current patient,
 *       provider filter, live counters, failed/empty day lists, backend sync,
 *       Retry / Cancel / final summary),
 *     - specific status messages (never a bare "loading"),
 *     - NO early stop: every day in the range is attempted; one bad day never
 *       aborts the run,
 *     - honest per-day verification: a day is only imported when the athena
 *       page header REALLY shows that day (no misdating, ever),
 *     - dedupe-safe re-runs (existing appointments are skipped, never doubled).
 *
 * HOW IT NAVIGATES
 *   MLS Assist v1.49 adds a read-only date-navigation bridge (mlsAppGotoDate).
 *   When the loaded extension supports it, the whole month runs hands-free.
 *   With an older extension (<= v1.48) the module runs in FOLLOW MODE: it asks
 *   you to put the athenaOne tab on the next needed day, detects it, pulls it,
 *   and asks for the next one - same verification, same importing, no lies.
 *
 * SAFETY (hard rules, enforced here)
 *   - READ-ONLY in Athena: this module only ever asks the extension to READ the
 *     schedule and to NAVIGATE the schedule date (allowed). It never writes,
 *     saves, signs, submits, or places anything, and never touches orders.
 *   - Never deletes or modifies existing appointments; duplicates are skipped
 *     client-side (name+date[+time] keys), updates are additive only.
 *   - No PHI in logs: patient names appear only in the on-screen status UI.
 *
 * Additive, idempotent, reversible: window.__mlsMonthPull.revert().
 * ==========================================================================*/
;(function () {
  "use strict";
  if (window.__mlsMonthPull && window.__mlsMonthPull.installed) return;

  var VERSION = "mp-1.0.0";
  var EST_TZ = "America/New_York";
  var LS_LAST = "mlsMonthPullLast";          /* last successful sync summary */
  var READ_TIMEOUT_MS = 45000;               /* schedule scrape can scroll a big grid */
  var NAV_TIMEOUT_MS = 60000;                /* worst-case multi-step date navigation */
  var PING_TIMEOUT_MS = 3500;
  var BETWEEN_DAYS_MS = 1100;                /* be gentle with the athena tab */
  var FOLLOW_POLL_MS = 4000;                 /* follow-mode: how often we re-read the tab */

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* ---------------- dates ---------------- */
  function estToday() {
    var s = safe(function () {
      return new Intl.DateTimeFormat("en-CA", { timeZone: EST_TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    }, null);
    if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    var d = new Date(); return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  /* previous calendar month relative to today (EST): [firstKey, lastKey] */
  function prevMonthRange() {
    var t = estToday().split("-");
    var y = +t[0], m = +t[1]; /* 1-12 */
    var py = (m === 1) ? y - 1 : y, pm = (m === 1) ? 12 : m - 1;
    var lastDay = new Date(py, pm, 0).getDate(); /* day 0 of this month = last of prev */
    return { from: py + "-" + pad2(pm) + "-01", to: py + "-" + pad2(pm) + "-" + pad2(lastDay), y: py, m: pm, days: lastDay };
  }
  var MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function prettyDay(key) { var p = key.split("-"); return MONTH_NAMES[+p[1] - 1] + " " + (+p[2]); }
  function prettyRange(r) { return MONTH_NAMES[r.m - 1] + " 1 to " + MONTH_NAMES[r.m - 1] + " " + r.days + ", " + r.y; }
  function dayKeys(r) { var out = [], i; for (i = 1; i <= r.days; i++) out.push(r.y + "-" + pad2(r.m) + "-" + pad2(i)); return out; }

  /* ---------------- backend ---------------- */
  function bkBase() { return safe(function () { return window.bkBase(); }, "") || "https://scrivara-backend.onrender.com"; }
  function bkToken() { return safe(function () { return window.bkToken(); }, "") || ""; }
  function signedIn() { return !!(safe(function () { return isFn(window.backendMode) && window.backendMode(); }, false) && bkToken()); }

  /* ---------------- extension bridge (typed request/reply with timeout) ---------------- */
  function bridge(reqType, payload, replyType, timeoutMs, onProgress) {
    return new Promise(function (res) {
      var done = false;
      function fin(v) { if (done) return; done = true; try { window.removeEventListener("message", on, false); } catch (e) {} res(v); }
      function on(ev) {
        var d = ev && ev.data;
        if (!d || d.source !== "mls-ext") return;
        if (onProgress && d.type === replyType.replace(/Result$/, "Progress") && typeof d.message === "string") { safe(function () { onProgress(d.message); }); return; }
        if (d.type !== replyType) return;
        fin(d.resp !== undefined ? d.resp : d);
      }
      window.addEventListener("message", on, false);
      var msg = { source: "mls-app", type: reqType };
      if (payload) { for (var k in payload) { if (payload.hasOwnProperty(k)) msg[k] = payload[k]; } }
      safe(function () { window.postMessage(msg, "*"); });
      setTimeout(function () { fin(null); }, timeoutMs || 15000);
    });
  }
  function ping() { return bridge("mlsPing", null, "mlsPong", PING_TIMEOUT_MS).then(function (r) { return !!r; }); }
  function readSchedule(onProgress) {
    window.__mlsPullBusyAt = Date.now(); /* pause the background prober while we read */
    return bridge("mlsAppPullSchedule", null, "mlsAppScheduleResult", READ_TIMEOUT_MS, onProgress);
  }
  function gotoDate(dateKey, probe, onProgress) {
    window.__mlsPullBusyAt = Date.now();
    return bridge("mlsAppGotoDate", { date: dateKey, probe: !!probe }, "mlsAppGotoDateResult", probe ? 6000 : NAV_TIMEOUT_MS, onProgress);
  }

  /* ---------------- schedule response helpers ---------------- */
  function respSchedDate(r) {
    var sd = safe(function () { return String(r && r.schedDate || "").slice(0, 10); }, "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) return sd;
    /* fall back to a weekday-adjacent header date in the page text (same idea as the
       dateguard): only trust a date that sits right after a weekday word. */
    var txt = safe(function () { return String(r && r.text || ""); }, "");
    if (!txt) return "";
    var m = /(sunday|monday|tuesday|wednesday|thursday|friday|saturday)[a-z]*[,.]?\s{0,3}([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/i.exec(txt);
    if (m) {
      var mo = MONTH_NAMES.map(function (x) { return x.toLowerCase(); }).indexOf(String(m[2]).toLowerCase());
      if (mo >= 0) return m[4] + "-" + pad2(mo + 1) + "-" + pad2(+m[3]);
    }
    return "";
  }
  function structuredRows(r) {
    return safe(function () {
      var a = (r && r.appts) || [];
      var out = [];
      for (var i = 0; i < a.length; i++) {
        var nm = String((a[i] && a[i].name) || "").trim();
        if (!nm) continue;
        out.push({ name: nm, dob: String(a[i].dob || ""), date: "", time: String(a[i].time || ""), reason: String(a[i].reason || ""), provider: String(a[i].provider || "") });
      }
      return out;
    }, []);
  }
  function parsedRows(r) {
    return safe(function () {
      var parsed = isFn(window._parseScheduleText) ? window._parseScheduleText(String(r && r.text || "")) : [];
      parsed = Array.isArray(parsed) ? parsed : [];
      return parsed.map(function (a) { return { name: a.name, dob: a.dob || "", date: a.date || "", time: a.time || "", reason: a.reason || "", provider: a.provider || "" }; });
    }, []);
  }
  function providersIn(r) { return safe(function () { return ((r && r.providers) || []).slice(0, 30); }, []); }

  /* ---------------- state ---------------- */
  var S = null; /* current run state */
  function freshState(range) {
    return {
      range: range, keys: dayKeys(range),
      mode: "checking",              /* checking | auto | follow */
      provider: "all",
      running: false, cancelled: false,
      dayStatus: {},                 /* key -> {status:'pending|reading|done|empty|failed|skipped-dup', found,saved,skipped,failed, error} */
      found: 0, saved: 0, dups: 0, failedRows: 0,
      emptyDays: [], failedDays: [],
      providersSeen: {},
      startedAt: 0, finishedAt: 0,
      extNav: null,                  /* true when v1.49 gotoDate is available */
      backend: { verified: false, count: 0, days: 0, at: 0 }
    };
  }

  /* ---------------- UI ---------------- */
  var STYLE_ID = "mlsMonthPullCss";
  function injectCss() {
    if ($(STYLE_ID)) return;
    var css = [
      "#mlsMPback{position:fixed;inset:0;background:rgba(26,33,28,.45);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:18px;}",
      "#mlsMPmodal{width:600px;max-width:96vw;max-height:92vh;display:flex;flex-direction:column;background:#fff;border-radius:14px;box-shadow:0 1px 2px rgba(20,33,28,.04),0 18px 44px -18px rgba(20,33,28,.25);font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#1A211C;overflow:hidden;}",
      "#mlsMPmodal .mp-head{background:#FCFBF8;color:#1A211C;border-bottom:1px solid #E7E5DD;padding:13px 18px;display:flex;align-items:center;gap:10px;}",
      "#mlsMPmodal .mp-head b{font-size:15.5px;font-weight:800;letter-spacing:.2px;}",
      "#mlsMPmodal .mp-x{margin-left:auto;cursor:pointer;border:0;background:transparent;color:#8A8F86;font-size:19px;font-weight:800;padding:2px 8px;border-radius:8px;}",
      "#mlsMPmodal .mp-x:hover{background:#F2F0E9;color:#1A211C;}",
      "#mlsMPmodal .mp-body{padding:14px 18px;overflow:auto;}",
      "#mlsMPmodal .mp-row{display:flex;align-items:center;gap:9px;margin:7px 0;flex-wrap:wrap;}",
      "#mlsMPmodal .mp-dot{width:10px;height:10px;border-radius:50%;background:#79837C;flex:none;}",
      "#mlsMPmodal .mp-dot.g{background:#2E6A4B;}#mlsMPmodal .mp-dot.r{background:#B23B3B;}#mlsMPmodal .mp-dot.a{background:#B07636;}",
      "#mlsMPmodal .mp-dot.spin{background:#2E6A4B;animation:mlsMPpulse 1s ease-in-out infinite;}",
      "@keyframes mlsMPpulse{0%,100%{opacity:1}50%{opacity:.35}}",
      "#mlsMPmodal .mp-conn{font-weight:700;}",
      "#mlsMPmodal .mp-sub{color:#55605A;font-size:12.5px;}",
      "#mlsMPmodal .mp-range{background:#FCFBF8;border:1px solid #E7E5DD;border-radius:10px;padding:9px 12px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;}",
      "#mlsMPmodal .mp-range b{color:#204034;}",
      "#mlsMPmodal select{border:1px solid #D9D6CD;border-radius:8px;padding:5px 8px;font:600 13px system-ui;color:#1A211C;background:#fff;}",
      "#mlsMPmodal .mp-barwrap{background:#EFEDE6;border-radius:999px;height:14px;overflow:hidden;margin:10px 0 4px;}",
      "#mlsMPmodal .mp-bar{height:100%;width:0%;background:#204034;transition:width .35s;}",
      "#mlsMPmodal .mp-counts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:10px 0;}",
      "#mlsMPmodal .mp-c{background:#FCFBF8;border:1px solid #EFEDE6;border-radius:10px;padding:7px 10px;text-align:center;}",
      "#mlsMPmodal .mp-c b{display:block;font-size:17px;color:#204034;}",
      "#mlsMPmodal .mp-c span{font-size:11px;color:#79837C;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}",
      "#mlsMPmodal .mp-now{background:#FCFBF8;border:1px solid #EFEDE6;border-radius:10px;padding:9px 12px;min-height:52px;}",
      "#mlsMPmodal .mp-now .l1{font-weight:800;color:#204034;}",
      "#mlsMPmodal .mp-now .l2{color:#204034;font-size:13px;margin-top:2px;}",
      "#mlsMPmodal .mp-log{background:#FCFBF8;color:#55605A;border:1px solid #EFEDE6;border-radius:10px;padding:9px 12px;height:130px;overflow:auto;font:12px/1.5 ui-monospace,Consolas,monospace;margin-top:10px;white-space:pre-wrap;}",
      "#mlsMPmodal .mp-log .err{color:#B23B3B;}#mlsMPmodal .mp-log .ok{color:#2E6A4B;}",
      "#mlsMPmodal .mp-days{display:none;margin-top:10px;background:#FCF8EF;border:1px solid #EFE4CE;border-radius:10px;padding:8px 12px;font-size:12.5px;color:#B07636;}",
      "#mlsMPmodal .mp-foot{display:flex;gap:9px;padding:12px 18px;border-top:1px solid #E7E5DD;background:#FCFBF8;align-items:center;flex-wrap:wrap;}",
      "#mlsMPmodal .mp-btn{cursor:pointer;border-radius:9px;padding:8px 15px;font:700 13.5px system-ui;border:1px solid #204034;background:#204034;color:#fff;box-shadow:0 8px 20px -8px rgba(32,64,52,.6);}",
      "#mlsMPmodal .mp-btn[disabled]{opacity:.45;cursor:default;}",
      "#mlsMPmodal .mp-btn.sec{background:#fff;color:#1A211C;border-color:#D9D6CD;box-shadow:none;}",
      "#mlsMPmodal .mp-btn.warn{background:#FCF8EF;color:#B07636;border-color:#EFE4CE;box-shadow:none;}",
      "#mlsMPmodal .mp-sync{margin-left:auto;font-size:12px;color:#79837C;text-align:right;}",
      "#mlsMPmodal .mp-note{display:none;background:#FCF8EF;border:1px solid #EFE4CE;color:#B07636;border-radius:10px;padding:8px 12px;font-size:12.5px;margin:8px 0;}"
    ].join("\n");
    var s = document.createElement("style"); s.id = STYLE_ID; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  function buildModal() {
    if ($("mlsMPback")) return;
    injectCss();
    var range = prevMonthRange();
    var back = document.createElement("div"); back.id = "mlsMPback";
    back.innerHTML =
      '<div id="mlsMPmodal" role="dialog" aria-label="Full month Athena pull">' +
        '<div class="mp-head"><b>Full-month Athena pull</b><span class="mp-sub" style="color:#79837C">read-only in Athena</span><button class="mp-x" id="mlsMPclose" title="Close">&times;</button></div>' +
        '<div class="mp-body">' +
          '<div class="mp-row"><span class="mp-dot spin" id="mlsMPconnDot"></span><span class="mp-conn" id="mlsMPconn">Checking Athena connection</span></div>' +
          '<div class="mp-sub" id="mlsMPconnSub" style="margin:-3px 0 6px 19px;">Verifying the extension, the athenaOne tab, and that the schedule can actually be read.</div>' +
          '<div class="mp-range"><span>Pulling:</span><b id="mlsMPrange">' + esc(prettyRange(range)) + '</b>' +
            '<span style="margin-left:auto">Provider:</span><select id="mlsMPprov"><option value="all">View all providers</option></select></div>' +
          '<div class="mp-note" id="mlsMPnote"></div>' +
          '<div class="mp-barwrap"><div class="mp-bar" id="mlsMPbar"></div></div>' +
          '<div class="mp-sub" id="mlsMPbarLbl">0 of ' + range.days + ' days</div>' +
          '<div class="mp-counts">' +
            '<div class="mp-c"><b id="mlsMPcFound">0</b><span>found</span></div>' +
            '<div class="mp-c"><b id="mlsMPcSaved">0</b><span>saved</span></div>' +
            '<div class="mp-c"><b id="mlsMPcDup">0</b><span>already there</span></div>' +
            '<div class="mp-c"><b id="mlsMPcFail">0</b><span>failed days</span></div>' +
          '</div>' +
          '<div class="mp-now"><div class="l1" id="mlsMPnow">Ready.</div><div class="l2" id="mlsMPnow2">Click Start to pull the whole month. Days already on your MLS calendar are skipped automatically, never doubled.</div></div>' +
          '<div class="mp-days" id="mlsMPfailBox"></div>' +
          '<div class="mp-log" id="mlsMPlog" aria-live="polite"></div>' +
        '</div>' +
        '<div class="mp-foot">' +
          '<button class="mp-btn" id="mlsMPstart">Start full-month pull</button>' +
          '<button class="mp-btn warn" id="mlsMPretry" style="display:none">Retry failed days</button>' +
          '<button class="mp-btn sec" id="mlsMPcancel" style="display:none">Cancel</button>' +
          '<div class="mp-sync" id="mlsMPsync"></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(back);
    $("mlsMPclose").addEventListener("click", function () { closeModal(); });
    $("mlsMPstart").addEventListener("click", function () { startRun(false); });
    $("mlsMPretry").addEventListener("click", function () { startRun(true); });
    $("mlsMPcancel").addEventListener("click", function () { if (S) { S.cancelled = true; log("Cancelling - finishing the current step, nothing else will be pulled.", "err"); } });
    back.addEventListener("mousedown", function (ev) { if (ev.target === back && !(S && S.running)) closeModal(); });
    fillProviders();
    renderLastSync();
  }
  function closeModal() {
    if (S && S.running) { log("The pull keeps running in the background - reopen from the Assistant panel.", ""); }
    var b = $("mlsMPback"); if (b) b.style.display = "none";
  }
  function showModal() { buildModal(); var b = $("mlsMPback"); if (b) b.style.display = "flex"; }

  function fillProviders() {
    var sel = $("mlsMPprov"); if (!sel) return;
    var names = {};
    safe(function () {
      var roster = window.__mlsProviderRoster && isFn(window.__mlsProviderRoster.list) ? window.__mlsProviderRoster.list() : null;
      (roster || []).forEach(function (p) { var n = (window.__mlsProviderLabel ? window.__mlsProviderLabel(p) : String(p && (p.name || p) || "")).trim(); if (n) names[n] = 1; });
    });
    safe(function () { ((window._calAppts) || []).forEach(function (a) { var n = (window.__mlsProviderLabel ? window.__mlsProviderLabel(a && a.provider) : String(a && a.provider || "")).trim(); if (n) names[n] = 1; }); });
    Object.keys(names).sort().forEach(function (n) {
      var o = document.createElement("option"); o.value = n; o.textContent = n; sel.appendChild(o);
    });
  }

  function setConn(kind, label, sub) {
    var d = $("mlsMPconnDot"), c = $("mlsMPconn"), s2 = $("mlsMPconnSub");
    if (d) d.className = "mp-dot " + kind;
    if (c) c.textContent = label;
    if (s2 && sub != null) s2.textContent = sub;
  }
  function note(html) { var n = $("mlsMPnote"); if (n) { if (html) { n.innerHTML = html; n.style.display = "block"; } else { n.style.display = "none"; } } }
  function log(msg, cls) {
    var l = $("mlsMPlog"); if (!l) return;
    var line = document.createElement("div");
    if (cls) line.className = cls;
    var t = new Date();
    line.textContent = pad2(t.getHours()) + ":" + pad2(t.getMinutes()) + ":" + pad2(t.getSeconds()) + "  " + msg;
    l.appendChild(line);
    while (l.childNodes.length > 400) l.removeChild(l.firstChild);
    l.scrollTop = l.scrollHeight;
  }
  function now1(msg) { var n = $("mlsMPnow"); if (n) n.textContent = msg; }
  function now2(msg) { var n = $("mlsMPnow2"); if (n) n.textContent = msg; }
  function counts() {
    if (!S) return;
    var done = 0; S.keys.forEach(function (k) { var st = S.dayStatus[k]; if (st && /^(done|empty|failed)$/.test(st.status)) done++; });
    var el;
    el = $("mlsMPcFound"); if (el) el.textContent = S.found;
    el = $("mlsMPcSaved"); if (el) el.textContent = S.saved;
    el = $("mlsMPcDup"); if (el) el.textContent = S.dups;
    el = $("mlsMPcFail"); if (el) el.textContent = S.failedDays.length;
    el = $("mlsMPbar"); if (el) el.style.width = Math.round(done * 100 / S.keys.length) + "%";
    el = $("mlsMPbarLbl"); if (el) el.textContent = done + " of " + S.keys.length + " days" + (S.emptyDays.length ? (" - " + S.emptyDays.length + " empty") : "");
    var fb = $("mlsMPfailBox");
    if (fb) {
      if (S.failedDays.length) {
        fb.style.display = "block";
        fb.innerHTML = "<b>Needs another try:</b> " + S.failedDays.map(function (k) {
          var st = S.dayStatus[k] || {};
          return esc(prettyDay(k)) + (st.error ? (" (" + esc(st.error) + ")") : "");
        }).join(" &middot; ");
      } else fb.style.display = "none";
    }
  }
  function renderLastSync() {
    var el = $("mlsMPsync"); if (!el) return;
    var v = safe(function () { return JSON.parse(localStorage.getItem(LS_LAST) || "null"); }, null);
    if (v && v.at) {
      el.innerHTML = "Last successful sync:<br>" + esc(new Date(v.at).toLocaleString()) + " - " + esc(String(v.count)) + " appts / " + esc(String(v.days)) + " days";
    } else el.textContent = "";
  }
  function setButtons(running) {
    var st = $("mlsMPstart"), ca = $("mlsMPcancel"), re = $("mlsMPretry");
    if (st) { st.disabled = !!running; st.style.display = running ? "none" : ""; }
    if (ca) ca.style.display = running ? "" : "none";
    if (re) re.style.display = (!running && S && S.failedDays.length) ? "" : "none";
    var pv = $("mlsMPprov"); if (pv) pv.disabled = !!running;
  }

  /* ---------------- connection precheck (multi-signal, honest) ---------------- */
  function precheck() {
    setConn("spin", "Checking Athena connection", "Verifying the extension, the athenaOne tab, and that the schedule can actually be read.");
    log("Checking Athena connection");
    return ping().then(function (ok) {
      if (!ok) {
        setConn("r", "MLS Assist extension not detected", "Enable MLS Assist in Chrome, then reopen this screen.");
        log("MLS Assist extension did not answer - cannot pull.", "err");
        return { ok: false, why: "no-extension" };
      }
      log("Extension bridge is reachable");
      /* one real read proves: tab open + signed in + page readable + data accessible */
      return readSchedule().then(function (r) {
        if (!r || r.timedOut || r.ok !== true) {
          var why = (r && r.error) || "No signed-in athenaOne tab answered the read.";
          setConn("r", "Athena is not answering", why + " Open your signed-in athenaOne tab, then press Start again.");
          log("Schedule read failed: " + why, "err");
          return { ok: false, why: "no-read" };
        }
        var host = safe(function () { return new URL(r.url).host; }, "");
        if (host && !/athenahealth|athenanet/i.test(host)) {
          setConn("r", "No signed-in athenaOne tab", "The readable tab is not athenaOne. Open athenaOne and sign in.");
          log("Read came from a non-athena tab (" + host + ") - not connected.", "err");
          return { ok: false, why: "wrong-tab" };
        }
        setConn("g", "Athena connected", "Signed-in athenaOne tab verified by a real schedule read.");
        log("Athena connected", "ok");
        log("Athena page ready");
        /* mark the shared truth so every surface agrees with what we just PROVED */
        safe(function () {
          var c = window.__mlsConnTruth;
          if (c && c.state) { c.state.status = "connected"; c.state.reason = "Verified by a live schedule read."; c.state.at = Date.now(); }
        });
        /* capability: does the loaded extension have v1.49 date navigation? */
        return gotoDate(estToday(), true).then(function (nav) {
          /* any reply at all means the v1.49 bridge is loaded (older builds stay silent) */
          if (nav && nav.version) log("MLS Assist v" + nav.version + " detected");
          return { ok: true, read: r, extNav: !!(nav && (nav.supported || nav.ok)) };
        });
      });
    });
  }

  /* ---------------- import one day's rows (through the corrected importer) ---------------- */
  function importDay(dayKey, rows, provider) {
    var si = window.__mlsSI;
    if (!si || !isFn(si.importAppts)) return Promise.resolve({ created: 0, skipped: 0, failed: 0, reason: "no-importer" });
    var opts = {
      date: dayKey, scopeDate: dayKey,
      provider: "", /* provider is filtered HARD in pullDay (the importer's soft filter
                       falls back to everyone when a day has none for that provider) */
      onEach: function (phase, info) {
        var nm = info && info.name ? String(info.name) : "";
        if (phase === "patient") { now2("Loading patient: " + nm); log("Loading patient: " + nm); }
        else if (phase === "fields") { now2("Reading appointment time, provider and visit reason for " + nm); }
        else if (phase === "dedupe") { now2("Checking duplicate appointment: " + nm); }
        else if (phase === "save") { now2("Saving appointment to MLS calendar: " + nm); }
        else if (phase === "error") { log("Could not save " + nm + " - " + (info && info.error || "server error"), "err"); }
      }
    };
    /* stamp each row with the verified day so the importer files it exactly there */
    rows = rows.map(function (x) { var o = {}; for (var k in x) { if (x.hasOwnProperty(k)) o[k] = x[k]; } o.date = dayKey; return o; });
    return Promise.resolve(si.importAppts(rows, opts));
  }

  /* ---------------- pull one day (nav -> verify -> read -> import) ---------------- */
  function pullDay(dayKey) {
    var pd = prettyDay(dayKey);
    S.dayStatus[dayKey] = { status: "reading" };
    now1("Reading " + pd);
    now2("");
    log("Reading " + pd);
    counts();

    var navP;
    if (S.extNav) {
      navP = gotoDate(dayKey, false, function (m) { now2(m); }).then(function (nav) {
        if (!nav || nav.ok !== true) {
          var e = (nav && nav.error) || "Could not navigate the athenaOne calendar to " + pd + ".";
          return { navFail: e };
        }
        return {};
      });
    } else {
      /* FOLLOW MODE: wait until the athena tab is actually ON this day (you drive, we verify) */
      now2("Put your athenaOne calendar on " + pd + " - I will detect it and pull automatically.");
      navP = (function waitFor() {
        if (S.cancelled) return Promise.resolve({ navFail: "cancelled" });
        return readSchedule().then(function (r) {
          var sd = respSchedDate(r);
          if (r && r.ok === true && sd === dayKey) return { preRead: r };
          if (r && r.ok === true && sd && sd !== dayKey) now2("Athena is on " + prettyDay(sd) + " - please move it to " + pd + " (or Cancel).");
          return new Promise(function (res) { setTimeout(res, FOLLOW_POLL_MS); }).then(waitFor);
        });
      })();
    }

    return navP.then(function (st) {
      if (S.cancelled) { S.dayStatus[dayKey] = { status: "failed", error: "cancelled" }; return "cancelled"; }
      if (st.navFail) {
        S.dayStatus[dayKey] = { status: "failed", error: st.navFail };
        S.failedDays.push(dayKey);
        log("FAILED " + pd + ": " + st.navFail, "err");
        return "failed";
      }
      log("Reading visits for " + pd);
      now1("Reading visits for " + pd);
      var readP = st.preRead ? Promise.resolve(st.preRead) : readSchedule(function (m) { now2(m); });
      return readP.then(function (r) {
        if (!r || r.ok !== true) {
          var e = (r && r.error) || "The schedule read did not answer.";
          S.dayStatus[dayKey] = { status: "failed", error: e };
          S.failedDays.push(dayKey);
          log("FAILED " + pd + ": " + e, "err");
          return "failed";
        }
        /* HARD verification: the page must really be on this day. No misdating, ever. */
        var sd = respSchedDate(r);
        if (sd && sd !== dayKey) {
          var e2 = "athena page showed " + sd + " instead of " + dayKey;
          S.dayStatus[dayKey] = { status: "failed", error: e2 };
          S.failedDays.push(dayKey);
          log("FAILED " + pd + ": " + e2, "err");
          return "failed";
        }
        if (!sd) {
          if (S.extNav) {
            /* navigation reported ok but the header could not be read - do not guess */
            var e3 = "could not confirm the page date";
            S.dayStatus[dayKey] = { status: "failed", error: e3 };
            S.failedDays.push(dayKey);
            log("FAILED " + pd + ": " + e3, "err");
            return "failed";
          }
          /* follow mode only reaches here when sd matched, so this branch is auto-mode only */
        }
        providersIn(r).forEach(function (p) { S.providersSeen[p] = 1; });
        var rows = structuredRows(r);
        if (!rows.length) rows = parsedRows(r);
        var provSel = $("mlsMPprov");
        var provider = S.provider = (provSel ? provSel.value : "all");
        if (provider !== "all" && rows.length) {
          /* HARD provider scope: keep only that provider's rows for this day.
             A day where they have nothing is an EMPTY day, never everyone's day. */
          var want = provider.trim().toLowerCase().split(/[ ,]/)[0];
          rows = rows.filter(function (x) { return String(x.provider || "").toLowerCase().indexOf(want) >= 0; });
        }
        if (!rows.length) {
          S.dayStatus[dayKey] = { status: "empty", found: 0 };
          S.emptyDays.push(dayKey);
          log(pd + ": no appointments" + (provider !== "all" ? (" for " + provider) : "") + " (empty day) - that is fine, moving on.", "");
          counts();
          return "empty";
        }
        S.found += rows.length;
        var provNote = (provider !== "all") ? (" (provider filter: " + provider + ")") : "";
        log(pd + ": " + rows.length + " appointments found" + provNote);
        counts();
        return importDay(dayKey, rows, provider).then(function (res) {
          res = res || {};
          var saved = res.created || 0, skipped = res.skipped || 0, failedRows = res.failed || 0;
          S.saved += saved; S.dups += skipped; S.failedRows += failedRows;
          S.dayStatus[dayKey] = { status: "done", found: rows.length, saved: saved, skipped: skipped, failed: failedRows };
          log(pd + ": saved " + saved + ", already on calendar " + skipped + (failedRows ? (", FAILED rows " + failedRows) : ""), failedRows ? "err" : "ok");
          if (failedRows) { S.failedDays.push(dayKey); S.dayStatus[dayKey].status = "failed"; S.dayStatus[dayKey].error = failedRows + " rows did not save"; }
          counts();
          return "done";
        });
      });
    });
  }

  /* ---------------- the full run ---------------- */
  function startRun(retryOnly) {
    if (S && S.running) return;
    var range = prevMonthRange();
    if (!S || !retryOnly) S = freshState(range);
    if (retryOnly) {
      var redo = S.failedDays.slice();
      if (!redo.length) return;
      redo.forEach(function (k) { delete S.dayStatus[k]; });
      S.failedDays = [];
      S.keysToRun = redo;
    } else {
      S.keysToRun = S.keys.slice();
    }
    if (!signedIn()) { now1("Sign in to MLS first."); now2("The pull saves to your MLS account, so you need to be signed in."); log("Not signed in to MLS - stopped before touching Athena.", "err"); return; }
    S.running = true; S.cancelled = false; S.startedAt = Date.now();
    setButtons(true);
    note("");
    window.__mlsMonthPullActive = true;

    precheck().then(function (pc) {
      if (!pc.ok) { S.running = false; setButtons(false); window.__mlsMonthPullActive = false; return; }
      S.extNav = !!pc.extNav;
      if (!S.extNav) {
        note("<b>Hands-free navigation needs MLS Assist v1.49.</b> Your loaded extension cannot move the athena calendar by itself yet, so this run is in <b>follow mode</b>: put athena on each day I ask for and I do the rest. Update the extension (Settings &rarr; Get the extension &rarr; reload) for the fully automatic pull.");
        log("Extension has no date navigation (v1.48 or older) - running in FOLLOW mode.", "");
      } else {
        log("Extension date navigation available - running hands-free.", "ok");
      }
      log("Pulling Athena calendar: " + prettyRange(S.range));
      now1("Pulling Athena calendar: " + prettyRange(S.range));

      var chain = Promise.resolve();
      S.keysToRun.forEach(function (dayKey) {
        chain = chain.then(function () {
          if (S.cancelled) return;
          return pullDay(dayKey).then(function () {
            counts();
            return new Promise(function (res) { setTimeout(res, BETWEEN_DAYS_MS); });
          });
        });
      });

      return chain.then(function () { return finishRun(); });
    }).catch(function (e) {
      log("Unexpected error: " + String(e && e.message || e), "err");
      S.running = false; setButtons(false); window.__mlsMonthPullActive = false;
    });
  }

  function finishRun() {
    S.finishedAt = Date.now();
    window.__mlsMonthPullActive = false;
    if (S.cancelled) {
      now1("Cancelled.");
      now2("Days already saved stay saved. Re-running later is safe - duplicates are skipped.");
      log("Cancelled - nothing else was pulled.", "err");
      S.running = false; setButtons(false);
      return;
    }
    log("Updating patient selector");
    safe(function () { if (window.__mlsPick && isFn(window.__mlsPick.reapply)) window.__mlsPick.reapply(); });
    log("Updating MLS Easy");
    safe(function () { if (window.__mlsAsst && isFn(window.__mlsAsst._renderSchedule)) window.__mlsAsst._renderSchedule(); });
    safe(function () { if (isFn(window._calLoadNextUp)) window._calLoadNextUp(); });
    safe(function () { if (window.__mlsWhosNext && isFn(window.__mlsWhosNext.render)) window.__mlsWhosNext.render(); });

    /* backend verification: count what the server REALLY has for the month */
    now1("Verifying backend sync");
    now2("Counting " + prettyRange(S.range) + " appointments on the MLS server.");
    log("Checking backend sync status");
    return fetch(bkBase() + "/api/appointments?from=" + S.range.from + "&to=" + S.range.to, { headers: { Authorization: "Bearer " + bkToken() } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; })
      .then(function (d) {
        var n = 0, days = {};
        safe(function () { (d.appointments || []).forEach(function (a) { n++; if (a.appt_date) days[a.appt_date] = 1; }); });
        if (d) {
          S.backend = { verified: true, count: n, days: Object.keys(days).length, at: Date.now() };
          log("Backend sync OK: the server now holds " + n + " appointments across " + Object.keys(days).length + " days of " + MONTH_NAMES[S.range.m - 1] + ".", "ok");
          safe(function () { localStorage.setItem(LS_LAST, JSON.stringify({ at: Date.now(), count: n, days: Object.keys(days).length, range: S.range })); });
          renderLastSync();
        } else {
          log("Could not verify the backend count (network) - the per-day saves above still happened.", "err");
        }
        var provs = Object.keys(S.providersSeen);
        var okDays = 0, emptyDays = S.emptyDays.length, failed = S.failedDays.length;
        S.keys.forEach(function (k) { var st = S.dayStatus[k]; if (st && st.status === "done") okDays++; });
        log("Finished full-month Athena calendar pull", "ok");
        now1("Finished full-month Athena calendar pull");
        now2("Found " + S.found + " - saved " + S.saved + " new - " + S.dups + " were already on your calendar - " +
             okDays + " days with visits, " + emptyDays + " empty days" + (failed ? (", " + failed + " days need a retry") : ", no failed days") +
             (provs.length ? (" - providers seen: " + provs.join(", ")) : ""));
        if (failed) { note("<b>" + failed + " day" + (failed > 1 ? "s" : "") + " did not complete.</b> Click <b>Retry failed days</b> - only those days are re-pulled; everything already saved is kept."); }
        S.running = false;
        setButtons(false);
        safe(function () { if (isFn(window.loadCalendar)) window.loadCalendar(); });
      });
  }

  /* ---------------- entry points ---------------- */
  function open(opts) {
    opts = opts || {};
    showModal();
    renderLastSync();
    if (opts.autostart) startRun(false);
  }

  /* Assistant panel button (single control, id-guarded, no duplicates) */
  function addAsstButton() {
    var p = $("mlsAsstPanel");
    if (!p || $("mlsMPasstBtn")) return;
    var host = p.querySelector(".as-pane-schedule") || p;
    var btn = document.createElement("button");
    btn.id = "mlsMPasstBtn"; btn.type = "button";
    btn.textContent = "Pull last month from Athena";
    btn.style.cssText = "display:block;width:100%;margin:8px 0 4px;cursor:pointer;border:1px solid #D9D6CD;background:#fff;color:#1A211C;font:700 12.5px system-ui;border-radius:9px;padding:8px 10px;";
    btn.addEventListener("click", function () { open({}); });
    host.insertBefore(btn, host.firstChild);
  }

  /* Assistant chat intent: "pull last month", "fill last month's calendar", etc. */
  var INTENT = /\b(pull|fill|import|sync|load)\b[^.?!]{0,40}\b(last|previous|prior)\s+month\b|\blast\s+month\b[^.?!]{0,30}\b(calendar|schedule|athena)\b/i;
  var wrappedParse = null, stubInstalled = false;
  function installIntent() {
    var r = window.__mlsWbRouter;
    if (r && isFn(r.parseCommand)) {
      if (r.parseCommand.__mlsMPwrap) return;
      var orig = r.parseCommand;
      var w = function (q) {
        if (INTENT.test(String(q || ""))) {
          setTimeout(function () { open({ autostart: true }); }, 250);
          var rng = prettyRange(prevMonthRange());
          return { matched: true, reply: "Starting the full-month Athena pull for " + rng + " - the pull screen is opening now. It reads every day of the month (read-only in Athena), shows live progress, and skips anything already on your calendar." };
        }
        return orig.apply(this, arguments);
      };
      w.__mlsMPwrap = true; w.__orig = orig;
      r.parseCommand = w;
      wrappedParse = { router: r, orig: orig };
    } else if (!stubInstalled && !r) {
      window.__mlsWbRouter = { parseCommand: function (q) {
        if (INTENT.test(String(q || ""))) {
          setTimeout(function () { open({ autostart: true }); }, 250);
          return { matched: true, reply: "Starting the full-month Athena pull - the pull screen is opening now." };
        }
        return { matched: false };
      } };
      window.__mlsWbRouter.parseCommand.__mlsMPwrap = true;
      stubInstalled = true;
    }
  }

  var timers = [];
  function boot() {
    timers.push(setInterval(addAsstButton, 2500));
    timers.push(setInterval(installIntent, 3000));
    addAsstButton();
    installIntent();
  }

  function revert() {
    timers.forEach(function (t) { clearInterval(t); });
    timers = [];
    safe(function () { var b = $("mlsMPback"); if (b) b.remove(); });
    safe(function () { var s = $(STYLE_ID); if (s) s.remove(); });
    safe(function () { var b = $("mlsMPasstBtn"); if (b) b.remove(); });
    safe(function () { if (wrappedParse && wrappedParse.router && wrappedParse.router.parseCommand && wrappedParse.router.parseCommand.__mlsMPwrap) wrappedParse.router.parseCommand = wrappedParse.orig; });
    window.__mlsMonthPull.installed = false;
  }

  window.__mlsMonthPull = {
    installed: true, version: VERSION, asset: "feat_mls_month_pull.js",
    open: open, start: function () { open({ autostart: true }); }, cancel: function () { if (S) S.cancelled = true; },
    state: function () { return S; }, range: prevMonthRange, revert: revert
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
