/* feat_mls_asst_fix.js  ->  window.__mlsAsstFix  (v1.1.0)  [item19]
 *
 * SIX additive, reversible fixes to the MLS Assistant panel/chat. Web-app only
 * (no extension reload). Read-only with respect to athenaOne -- NEVER writes, signs,
 * saves, navigates, or focuses an athenaOne tab; NEVER logs the user out. No PHI is
 * read, stored, or logged (only non-PHI control fields: resp.ok, url host, title,
 * provider names, and a sign-in boolean). ASCII-only. Idempotent. try/catch throughout.
 *
 * FIX 1 -- HONEST, REAL-TIME CONNECTION STATUS
 *   Green "athenaOne connected" only when a genuinely open, signed-in athenanet tab is
 *   readable -- NOT on a sign-in / prompt=login wall, NOT lingering after the tab closes.
 *   Hardens window.__mlsConnTruth with URL/title sign-in detection (original sniffed body
 *   text only), requires an athenahealth host, re-checks on focus/pageshow/visibilitychange,
 *   and polls on a short interval. Fully reversible.
 *
 * FIX 2 -- "OPEN ATHENAONE" BUTTON: clear, always-visible button that opens athenaOne in a
 *   NEW tab on the user's click (never auto-opens).
 *
 * FIX 3 -- CONTEXT-AWARE CHAT: deterministic action intents (pull today's / Dr X's schedule,
 *   pull this patient, open athenaOne, connection status, open <name>'s chart) run the REAL
 *   functions (reuse __mlsSI.pull + assistant setTab/setDate/setProvider + __mlsPick.select)
 *   WITHOUT the AI, so they work while /api/copilot is 429. Free-form questions still hit the
 *   AI but degrade gracefully + honestly on 429/network error.
 *
 * FIX 4 -- FAB/PANEL OVERLAP: shift the FAB + panel right to left:80 so they never cover the
 *   bottom-left patient indicator (#_patientFace, 50x50 at left:18/bottom:18).
 *
 * FIX 5 -- DYNAMIC DOCTOR PICKER: the assistant .as-prov dropdown read only window._calProviders
 *   ("All doctors + you"). The roster (feat_athena_provider_roster -> __mlsProviderPicker) already
 *   recovers REAL providers from each schedule read; we union that roster into _calProviders and
 *   rebuild the dropdown (generic, never hardcoded).
 *
 * FIX 6 -- NO FAILURE DURING IN-FLIGHT READ: take over the Schedule-tab pull button; show an
 *   honest "Reading..." state while reading; the "no appointments" text appears only AFTER the
 *   read completes and only if genuinely nothing was found. Never a failure message mid-read.
 *
 * PUBLIC API (window.__mlsAsstFix): installed, version, revert(), _state(), _check(), _handleSend().
 */
;(function () {
  "use strict";
  var NS = "__mlsAsstFix";
  var VERSION = "1.1.0";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  /* ---------- self-gate: same as the assistant (staging page OR prod staging-marker) ---------- */
  function gateOn() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window[NS] = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  /* ---------- tiny helpers ---------- */
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function localDateStr(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayStr() { return localDateStr(new Date()); }
  function addDaysStr(ds, n) {
    var m = String(ds || "").match(/^(\d{4})-(\d{2})-(\d{2})/); if (!m) return ds;
    var d = new Date(+m[1], +m[2] - 1, +m[3]); d.setDate(d.getDate() + n); return localDateStr(d);
  }
  function getPatients() { try { return (window.getPatients && window.getPatients()) || []; } catch (e) { return []; } }
  function providers() { try { return Array.isArray(window._calProviders) ? window._calProviders : []; } catch (e) { return []; } }
  function ASST() { return safe(function () { return window.__mlsAsst || null; }, null); }
  function CT() { return safe(function () { return window.__mlsConnTruth || null; }, null); }
  function SI() { return safe(function () { return window.__mlsSI || null; }, null); }

  var PANEL_ID = "mlsAsstPanel", FAB_ID = "mlsAsstFab";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function panel() { return $(PANEL_ID); }
  function threadEl() { var p = panel(); return p ? p.querySelector(".as-thread") : null; }
  function bodyEl() { var p = panel(); return p ? p.querySelector(".as-body") : null; }

  /* =====================================================================
   * FIX 1 -- harden window.__mlsConnTruth (override + fast/focus re-probe)
   * ===================================================================== */
  var connOrig = null, connState = null, connSubs = [], connPoll = null,
      connFocusHandlers = [], connInstalled = false, connVis = null, connInFlight = null;
  var PING_TIMEOUT_MS = 2500, SCHED_TIMEOUT_MS = 4000, POLL_MS = 4000;

  var COLOR = {
    "connected":    { color: "green", label: "athenaOne connected" },
    "no-extension": { color: "red",   label: "MLS Assist not detected" },
    "no-tab":       { color: "red",   label: "No signed-in athenaOne tab" },
    "error":        { color: "red",   label: "athenaOne disconnected" },
    "checking":     { color: "grey",  label: "Checking..." }
  };

  function looksSignin(resp) {
    try {
      if (!resp || typeof resp !== "object") return false;
      var url = typeof resp.url === "string" ? resp.url : "";
      var title = typeof resp.title === "string" ? resp.title : "";
      var text = typeof resp.text === "string" ? resp.text : "";
      if (url && /(prompt=login|[?&]login|\/login\b|\/logon\b|sign[-_]?in|signin|\/oauth|\/authorize|\/authn|fedsignin|samlsso|\/idp\/)/i.test(url)) return true;
      if (title && /(sign\s*in|log\s*in|logon|sign-on)/i.test(title) && !/athenacollector|athenanet/i.test(title)) return true;
      if (text && text.length < 4000) {
        var head = text.slice(0, 1500);
        if (/get more from athenaone|find trusted solutions/i.test(head)) return true;
        if (/\bsign\s*in\b/i.test(head) && /\b(password|username|log\s*in)\b/i.test(head)) return true;
      }
      return false;
    } catch (e) { return false; }
  }
  function hostIsAthena(resp) {
    try {
      var url = resp && typeof resp.url === "string" ? resp.url : "";
      if (!url) return null;
      return /athenahealth|athenanet/i.test(url);
    } catch (e) { return null; }
  }

  function connRequest(type, replyType, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      var handler = function (ev) {
        var d = ev && ev.data;
        if (!d || typeof d !== "object" || d.source !== "mls-ext" || d.type !== replyType) return;
        if (done) return; done = true;
        try { window.removeEventListener("message", handler, false); } catch (e) {}
        clearTimeout(t);
        if (replyType === "mlsPong") { resolve({ ok: true }); }
        else {
          var r = d.resp || {};
          resolve({ ok: r.ok === true, signin: looksSignin(r), athena: hostIsAthena(r) });
        }
      };
      var t = setTimeout(function () {
        if (done) return; done = true;
        try { window.removeEventListener("message", handler, false); } catch (e) {}
        resolve({ ok: false, timedOut: true });
      }, timeoutMs);
      window.addEventListener("message", handler, false);
      try { window.postMessage({ source: "mls-app", type: type }, "*"); }
      catch (e) { if (!done) { done = true; clearTimeout(t); try { window.removeEventListener("message", handler, false); } catch (e2) {} resolve({ ok: false }); } }
    });
  }

  function connSetState(status, reason) {
    var prev = connState;
    connState = { status: status, ext: (status !== "no-extension" && status !== "checking"), tab: (status === "connected"), reason: reason || "", at: Date.now() };
    var c = CT(); if (c) { try { c.state = connState; } catch (e) {} }
    var changed = !prev || prev.status !== connState.status || prev.reason !== connState.reason;
    if (changed) {
      for (var i = 0; i < connSubs.length; i++) { try { connSubs[i](connState); } catch (e) {} }
      var a = ASST(); if (a && isFn(a._renderStatus)) { try { a._renderStatus(); } catch (e) {} }
    }
    return connState;
  }

  function connCheck() {
    if (connInFlight) return connInFlight;
    connInFlight = connRequest("mlsPing", "mlsPong", PING_TIMEOUT_MS).then(function (ping) {
      if (!ping.ok) { connInFlight = null; return connSetState("no-extension", "MLS Assist not detected -- load the extension and reload."); }
      return connRequest("mlsAppPullSchedule", "mlsAppScheduleResult", SCHED_TIMEOUT_MS).then(function (s) {
        connInFlight = null;
        var athenaOk = (s.athena === null) ? true : !!s.athena;
        if (s.ok && !s.signin && athenaOk) {
          return connSetState("connected", "athenaOne connected -- a signed-in tab is readable.");
        }
        if (s.signin) {
          return connSetState("no-tab", "Your athenaOne tab is on the sign-in page -- sign in and open your Day schedule, then it will connect.");
        }
        if (s.ok && !athenaOk) {
          return connSetState("no-tab", "No signed-in athenaOne tab is readable -- open athenaOne and sign in.");
        }
        return connSetState("no-tab", "No signed-in athenaOne tab is readable -- open one and sign in.");
      });
    }).catch(function () { connInFlight = null; return connSetState("error", "Connection check failed -- treating as disconnected."); });
    return connInFlight;
  }

  function connDescribe(s) {
    s = s || connState || { status: "checking", reason: "" };
    var m = COLOR[s.status] || COLOR["checking"];
    return { status: s.status, color: m.color, label: m.label, detail: s.reason || "" };
  }

  function startConnPoll() {
    stopConnPoll();
    connPoll = setInterval(function () {
      try { if (document.visibilityState !== "hidden") connCheck(); } catch (e) {}
    }, POLL_MS);
  }
  function stopConnPoll() { if (connPoll) { clearInterval(connPoll); connPoll = null; } }

  function installConnHardening() {
    var c = CT();
    if (!c) return false;
    if (connInstalled) return true;
    connOrig = {
      isConnected: c.isConnected, describe: c.describe, check: c.check,
      start: c.start, stop: c.stop, subscribe: c.subscribe, state: c.state
    };
    safe(function () { if (isFn(c.stop)) c.stop(); });
    connState = (c.state && c.state.status) ? { status: c.state.status, ext: !!c.state.ext, tab: !!c.state.tab, reason: c.state.reason || "", at: Date.now() }
                                            : { status: "checking", ext: false, tab: false, reason: "Checking athenaOne connection...", at: Date.now() };
    c.isConnected = function () { return !!(connState && connState.status === "connected"); };
    c.describe = function (s) { return connDescribe(s === undefined ? connState : s); };
    c.check = function () { return connCheck().then(function () { return connState; }); };
    c.subscribe = function (fn) {
      if (!isFn(fn)) return function () {};
      connSubs.push(fn); try { fn(connState); } catch (e) {}
      return function () { var i = connSubs.indexOf(fn); if (i >= 0) connSubs.splice(i, 1); };
    };
    c.start = function () { startConnPoll(); return c; };
    c.stop = function () { stopConnPoll(); return c; };
    c.state = connState;
    var refire = function () { try { connCheck(); } catch (e) {} };
    connFocusHandlers = [ ["focus", refire], ["pageshow", refire] ];
    for (var i = 0; i < connFocusHandlers.length; i++) {
      try { window.addEventListener(connFocusHandlers[i][0], connFocusHandlers[i][1], false); } catch (e) {}
    }
    connVis = function () { try { if (document.visibilityState !== "hidden") connCheck(); } catch (e) {} };
    try { document.addEventListener("visibilitychange", connVis, false); } catch (e) {}
    connInstalled = true;
    startConnPoll();
    connCheck();
    return true;
  }

  function revertConn() {
    stopConnPoll();
    var c = CT();
    for (var i = 0; i < connFocusHandlers.length; i++) {
      try { window.removeEventListener(connFocusHandlers[i][0], connFocusHandlers[i][1], false); } catch (e) {}
    }
    connFocusHandlers = [];
    if (connVis) { try { document.removeEventListener("visibilitychange", connVis, false); } catch (e) {} connVis = null; }
    if (c && connOrig) {
      try {
        c.isConnected = connOrig.isConnected; c.describe = connOrig.describe; c.check = connOrig.check;
        c.start = connOrig.start; c.stop = connOrig.stop; c.subscribe = connOrig.subscribe;
        if (isFn(c.start)) c.start();
      } catch (e) {}
    }
    connSubs = []; connInstalled = false; connOrig = null;
  }

  /* =====================================================================
   * FIX 2 -- "Open athenaOne" button (and shared open helper)
   * ===================================================================== */
  var OPEN_ROW_ID = "mlsAsstOpenAthenaRow";
  function openAthena() {
    var sp = safe(function () { return window.__mlsAthenaSignInPrompt; }, null);
    if (sp && isFn(sp._openAthena)) { safe(function () { sp._openAthena(true); }); }
    else {
      var url = (sp && isFn(sp._athenaUrl)) ? safe(function () { return sp._athenaUrl(); }, null) : null;
      safe(function () { window.open(url || "https://athenanet.athenahealth.com/", "_blank", "noopener"); });
    }
    setTimeout(function () { try { connCheck(); } catch (e) {} }, 1500);
  }
  function injectOpenButton() {
    var p = $(PANEL_ID); if (!p) return false;
    if ($(OPEN_ROW_ID)) return true;
    var status = p.querySelector(".as-status"); if (!status) return false;
    var row = document.createElement("div");
    row.id = OPEN_ROW_ID;
    row.style.cssText = "padding:0 18px 11px;";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = "mlsAsstOpenAthenaBtn";
    btn.textContent = "Open athenaOne in new tab";
    btn.style.cssText = "width:100%;height:34px;border-radius:9px;border:1px solid #2563eb;" +
      "background:linear-gradient(180deg,#3b82f6,#2563eb);color:#fff;font:600 12.5px/1 'Plus Jakarta Sans',system-ui,sans-serif;" +
      "cursor:pointer;letter-spacing:.2px;";
    btn.addEventListener("click", function () { openAthena(); });
    row.appendChild(btn);
    if (status.nextSibling) status.parentNode.insertBefore(row, status.nextSibling);
    else status.parentNode.appendChild(row);
    return true;
  }
  function removeOpenButton() { var r = $(OPEN_ROW_ID); if (r && r.parentNode) r.parentNode.removeChild(r); }

  /* =====================================================================
   * FIX 4 -- reposition FAB + panel so they never cover #_patientFace
   * ===================================================================== */
  var FIX_STYLE_ID = "mlsAsstFixStyle";
  function injectStyle() {
    if ($(FIX_STYLE_ID)) return;
    var css = "#" + FAB_ID + "{left:80px !important;bottom:18px !important;}" +
              "#" + PANEL_ID + "{left:80px !important;}";
    var s = document.createElement("style");
    s.id = FIX_STYLE_ID; s.type = "text/css";
    s.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(s);
  }
  function removeStyle() { var s = $(FIX_STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); }

  /* =====================================================================
   * FIX 3 -- context-aware chat with real deterministic action intents
   * ===================================================================== */
  var chatLog = [], chatObserver = null, sendCapture = null, keyCapture = null,
      chatBusy = false, chatSelfRender = false, chatBoundEls = null;
  var THREAD_MARK = "data-mlsfix";

  function seedChatLog() {
    var a = ASST();
    var h = safe(function () { return a && isFn(a._history) ? a._history() : null; }, null);
    if (h && h.length) {
      chatLog = h.filter(function (m) { return m.role === "user" || m.role === "ai"; })
                 .map(function (m) { return { role: m.role, text: m.text }; });
    }
    if (!chatLog.length) {
      chatLog = [{ role: "ai", text: "Hi -- I'm the MLS Assistant. I can pull your athenaOne schedule, open athenaOne, and answer questions. Try \"pull today's patients\", \"pull Dr <name>'s schedule\", or \"are we connected?\"." }];
    }
  }
  function renderThread() {
    var t = threadEl(); if (!t) return;
    var html = "";
    for (var i = 0; i < chatLog.length; i++) {
      var m = chatLog[i];
      var role = m.role === "user" ? "user" : (m.role === "pending" ? "ai pending" : "ai");
      html += '<div class="as-msg ' + role + '"><div class="as-bub">' + esc(m.text) + "</div></div>";
    }
    chatSelfRender = true;
    t.innerHTML = html;
    try { t.setAttribute(THREAD_MARK, String(chatLog.length)); } catch (e) {}
    chatSelfRender = false;
    var b = bodyEl(); if (b) b.scrollTop = b.scrollHeight;
  }
  function addUser(text) { chatLog.push({ role: "user", text: text }); renderThread(); }
  function addAi(text) { dropPending(); chatLog.push({ role: "ai", text: text }); renderThread(); }
  function addPending(text) { chatLog.push({ role: "pending", text: text || "Thinking..." }); renderThread(); }
  function dropPending() { chatLog = chatLog.filter(function (m) { return m.role !== "pending"; }); }

  function parseIntent(q) {
    var s = String(q || "").toLowerCase().trim();
    if (!s) return null;
    if (/\b(open|launch|connect)\b[^.]*\bathena/.test(s) || /\bathena(one|net)?\b[^.]*\b(tab|open|new tab)\b/.test(s)) return { type: "open" };
    if (/are (we|you) connected|is athena (connected|up|working)|\bconnection status\b|\bdisconnected?\b/.test(s) ||
        (/\bstatus\b/.test(s) && /athena/.test(s)) || (/\bconnected\b/.test(s) && /athena/.test(s))) return { type: "status" };
    if ((/\bpull\b|\bimport\b|\bload\b|\bfetch\b/.test(s)) &&
        (/patient|schedule|today|tomorrow|appointment|chart|athena|\bdr\b|doctor/.test(s))) {
      var day = null;
      if (/tomorrow/.test(s)) day = "tomorrow";
      else if (/today|this morning|right now/.test(s)) day = "today";
      var prov = null, m = s.match(/\b(?:dr\.?|doctor)\s+([a-z][a-z'\-]+)/);
      if (!m) m = s.match(/\b([a-z][a-z'\-]+)(?:'s)?\s+(?:schedule|patients|clinic|list)\b/);
      if (m && !/today|tomorrow|this|the|my/.test(m[1])) prov = m[1];
      var patient = /\bthis patient\b|\bcurrent patient\b|\bthis chart\b|\bopen chart\b|\bactive patient\b/.test(s);
      return { type: "pull", day: day, provider: prov, patient: patient, raw: q };
    }
    if (/\b(select|open|pull up|switch to|show)\b[^.]*\b(chart|patient)\b/.test(s)) return { type: "select", raw: q };
    return null;
  }
  function matchProvider(token) {
    token = String(token || "").toLowerCase();
    var list = rosterProviders();
    for (var i = 0; i < list.length; i++) {
      var p = String(list[i] || "");
      if (p.toLowerCase().indexOf(token) >= 0) return p;
    }
    return null;
  }
  function selectByName(q) {
    var ps = getPatients(), s = String(q || "").toLowerCase(), found = null;
    for (var i = 0; i < ps.length; i++) {
      var nm = String(ps[i].name || "").toLowerCase(); if (!nm) continue;
      var last = nm.split(",")[0].trim();
      var first = (nm.split(",")[1] || "").trim().split(" ")[0];
      if ((last && last.length > 2 && s.indexOf(last) >= 0) || (first && first.length > 2 && s.indexOf(first) >= 0)) { found = ps[i]; break; }
    }
    if (found) {
      safe(function () {
        if (window.__mlsPick && isFn(window.__mlsPick.select)) window.__mlsPick.select(found.id);
        else if (isFn(window.openPatient)) window.openPatient(found.id);
      });
      addAi("Opened " + found.name + "'s chart.");
    } else {
      addAi("I couldn't match that patient by name. Open the Schedule tab and tap their card, or pull the day's schedule first.");
    }
  }
  function reportStatus() {
    var c = CT();
    var d = safe(function () { return c && isFn(c.describe) ? c.describe() : null; }, null);
    if (!d) { addAi("I can't read the connection right now."); return; }
    if (d.status === "connected") addAi("Connected. " + (d.detail || "A signed-in athenaOne tab is readable.") + " You can ask me to pull a schedule.");
    else addAi("Not connected. " + (d.detail || d.label) + " Tap \"Open athenaOne in new tab\" above to sign in, then I'll see it automatically.");
    safe(function () { if (c && isFn(c.check)) c.check(); });
  }
  function runPull(intent) {
    var a = ASST(), c = CT(), si = SI();
    var ds = intent.day === "tomorrow" ? addDaysStr(todayStr(), 1) : todayStr();
    var pv = intent.provider ? (matchProvider(intent.provider) || null) : null;
    safe(function () { if (a && isFn(a.setTab)) a.setTab("schedule"); });
    safe(function () { if (a && isFn(a.setDate)) a.setDate(ds); });
    if (pv) safe(function () { if (a && isFn(a.setProvider)) a.setProvider(pv); });
    var connected = safe(function () { return c && isFn(c.isConnected) && c.isConnected(); }, false);
    if (!connected) {
      var d = safe(function () { return c && isFn(c.describe) ? c.describe() : null; }, null);
      addAi("I can't pull yet -- " + ((d && (d.detail || d.label)) || "athenaOne isn't connected.") + " Tap \"Open athenaOne in new tab\" above, sign in and open your Day schedule, then ask again.");
      safe(function () { if (c && isFn(c.check)) c.check(); });
      return;
    }
    if (!(si && isFn(si.pull))) { addAi("Schedule pull isn't available right now."); return; }
    addAi("On it -- pulling the " + (intent.day || "today's") + " schedule" + (pv ? (" for " + pv) : "") + " from athenaOne now. You can keep working; I'll store them when done.");
    safe(function () {
      si.pull({ date: ds, provider: pv || "All doctors", onStatus: function () {} })
        .then(function (res) {
          var created = (res && res.created) || 0;
          safe(function () { if (a && isFn(a._renderSchedule)) a._renderSchedule(); });
          safe(syncProviders);
          if (created > 0) addAi("Done -- imported " + created + " appointment" + (created === 1 ? "" : "s") + " for " + ds + ". They're in the Schedule tab now.");
          else addAi("I reached athenaOne but found no new appointments for " + ds + ". Make sure that day's Day-schedule grid (the patient list) is open in athenaOne, then ask again.");
          if (intent.patient) {
            var ap = safe(function () { return (window.__mlsPick && isFn(window.__mlsPick.activePatient)) ? window.__mlsPick.activePatient() : null; }, null);
            if (ap && ap.name) addAi("Active patient: " + ap.name + ". Open the Schedule tab to pick another.");
          }
        })
        .catch(function () { addAi("Couldn't finish the pull -- open your athenaOne Day schedule and ask again."); });
    });
  }
  function aiAsk(q) {
    var ready = safe(function () {
      var bm = isFn(window.backendMode) && window.backendMode();
      var tok = isFn(window.bkToken) && window.bkToken();
      return !!(bm && tok);
    }, false);
    if (!ready) { addAi("AI chat needs you signed in to your MLS account. I can still pull schedules, open athenaOne, and report your connection status -- try \"pull today's patients\"."); return; }
    addPending("Thinking...");
    var base = safe(function () { return window.bkBase(); }, "");
    var tok = safe(function () { return window.bkToken(); }, "");
    var ctx = safe(function () { return isFn(window.copilotSnapshot) ? window.copilotSnapshot() : null; }, null);
    var hist = chatLog.filter(function (m) { return m.role === "user" || m.role === "ai"; })
                      .map(function (m) { return { role: m.role, text: m.text }; });
    hist = hist.slice(0, -1);
    var body = { question: q, history: hist };
    if (ctx) body.context = ctx;
    var degraded = "The AI assistant is temporarily unavailable (the AI service is rate-limited right now). That part is being fixed. In the meantime I can still pull schedules, open athenaOne, and report your connection -- try \"pull today's patients\" or \"are we connected?\".";
    fetch(base + "/api/copilot", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify(body)
    }).then(function (r) {
      if (r.status === 429 || r.status === 503) { addAi(degraded); return null; }
      return r.json().catch(function () { return {}; });
    }).then(function (d) {
      if (d === null) return;
      var reply = (d && (d.reply || d.text || d.answer)) || "";
      reply = String(reply).trim();
      if (!reply) { addAi(degraded); return; }
      addAi(reply);
    }).catch(function () {
      addAi("Couldn't reach the AI just now (network or backend). My actions still work -- try \"pull today's patients\".");
    });
  }
  /* ---- EXTENSIBLE intent registry (intents -> actions + persisted settings) ----
   * Michael's design: the chat is a smart command surface wired to the data layer.
   * Each entry { name, run(q) -> true if handled }. First match wins; otherwise the
   * message falls through to the AI. Add more without touching core via
   * window.__mlsAsstFix.registerIntent(name, fn[, atFront]). Persisted prefs live in
   * settingsGet/settingsSet (localStorage, namespaced) so an intent can REMEMBER a
   * choice across sessions -- e.g. the future "redirect writeback" intent that
   * permanently changes where an op-note is written back into athenaOne. */
  var SETTINGS_KEY = "mlsAsstFixSettings";
  function settingsAll() { return safe(function () { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") || {}; }, {}) || {}; }
  function settingsGet(k, dflt) { var a = settingsAll(); return (k in a) ? a[k] : dflt; }
  function settingsSet(k, v) { safe(function () { var a = settingsAll(); a[k] = v; localStorage.setItem(SETTINGS_KEY, JSON.stringify(a)); }); return v; }

  var intentRegistry = [], builtinsRegistered = false;
  function registerIntent(name, fn, atFront) {
    if (!isFn(fn)) return function () {};
    var entry = { name: String(name || "intent"), run: fn };
    if (atFront) intentRegistry.unshift(entry); else intentRegistry.push(entry);
    return function () { var i = intentRegistry.indexOf(entry); if (i >= 0) intentRegistry.splice(i, 1); };
  }
  function registerBuiltins() {
    if (builtinsRegistered) return; builtinsRegistered = true;
    /* 1) WRITEBACK-REDIRECT HOOK -- permanently change where something writes back
     *    into athenaOne via conversation ("from now on put injection op-notes under X").
     *    Delegates to the existing smart-adaptive writeback router, which PERSISTS the
     *    per-doctor/per-item destination. Clean, extensible hook: richer redirect
     *    phrasings can grow in __mlsWbRouter without touching this module. */
    registerIntent("writeback-redirect", function (q) {
      var wbr = safe(function () { return window.__mlsWbRouter; }, null);
      if (wbr && isFn(wbr.parseCommand)) {
        var pc = safe(function () { return wbr.parseCommand(q); }, null);
        if (pc && pc.matched) { addAi(pc.reply || "Updated where that writes back in athenaOne -- I'll remember it going forward."); return true; }
      }
      return false;
    });
    registerIntent("open-athena", function (q) {
      var it = parseIntent(q); if (!it || it.type !== "open") return false;
      openAthena(); addAi("Opening athenaOne in a new tab. Sign in there and open your Day schedule -- the status above will update on its own."); return true;
    });
    registerIntent("connection-status", function (q) {
      var it = parseIntent(q); if (!it || it.type !== "status") return false;
      reportStatus(); return true;
    });
    registerIntent("pull-schedule", function (q) {
      var it = parseIntent(q); if (!it || it.type !== "pull") return false;
      runPull(it); return true;
    });
    registerIntent("select-patient", function (q) {
      var it = parseIntent(q); if (!it || it.type !== "select") return false;
      selectByName(q); return true;
    });
  }

  function handleSend(raw) {
    var q = String(raw || "").trim();
    if (!q || chatBusy) return;
    addUser(q);
    registerBuiltins();
    for (var i = 0; i < intentRegistry.length; i++) {
      var entry = intentRegistry[i];
      var handled = safe(function () { return entry.run(q); }, false);
      if (handled) return;
    }
    aiAsk(q);
  }
  function takeoverChat() {
    var p = panel(); if (!p) return false;
    var ta = p.querySelector(".as-input textarea") || p.querySelector("textarea");
    var send = p.querySelector(".as-send");
    if (!ta || !send) return false;
    if (send.getAttribute("data-mlsfix-bound")) return true;
    seedChatLog();
    renderThread();
    sendCapture = function (e) {
      var v = ta.value;
      try { e.stopImmediatePropagation(); e.preventDefault(); } catch (er) {}
      ta.value = "";
      handleSend(v);
    };
    keyCapture = function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        var v = ta.value;
        try { e.stopImmediatePropagation(); e.preventDefault(); } catch (er) {}
        ta.value = "";
        handleSend(v);
      }
    };
    send.addEventListener("click", sendCapture, true);
    ta.addEventListener("keydown", keyCapture, true);
    send.setAttribute("data-mlsfix-bound", "1");
    chatBoundEls = { ta: ta, send: send };
    var t = threadEl();
    if (t && window.MutationObserver) {
      chatObserver = new MutationObserver(function () {
        if (chatSelfRender) return;
        var cur = t.getAttribute(THREAD_MARK);
        if (cur !== String(chatLog.length)) { renderThread(); }
      });
      try { chatObserver.observe(t, { childList: true }); } catch (e) {}
    }
    return true;
  }
  function revertChat() {
    if (chatObserver) { try { chatObserver.disconnect(); } catch (e) {} chatObserver = null; }
    if (chatBoundEls) {
      try { chatBoundEls.send.removeEventListener("click", sendCapture, true); } catch (e) {}
      try { chatBoundEls.ta.removeEventListener("keydown", keyCapture, true); } catch (e) {}
      try { chatBoundEls.send.removeAttribute("data-mlsfix-bound"); } catch (e) {}
      chatBoundEls = null;
    }
    sendCapture = keyCapture = null;
  }

  /* =====================================================================
   * FIX 5 -- dynamic doctor picker from the REAL athena providers
   * ===================================================================== */
  var providerPoll = null;
  /* Sanitize roster-recovered names. The roster's flat-text extractor over-captures
   * (dates, locations, "Appointment Type", resource codes, UI "Close" artifacts), so
   * we admit a recovered name only if it actually LOOKS like a provider: athena's
   * "Last_First_Cred" underscore format, "Name, CRED", or a clean "Last, First".
   * App-provided _calProviders entries (e.g. the user's own name) are trusted verbatim. */
  var PROV_CRED = /\b(MD|DO|DPM|PA-?C|CRNP|DNP|NP-?C|PsyD|PhD|MBBS|DDS|DC|OD|MSN|DPT)\b/;
  function cleanProviderName(n) {
    n = String(n == null ? "" : n).replace(/\s+/g, " ").trim();
    n = n.replace(/\s*Close$/, "").trim();
    return n;
  }
  function isProviderName(n) {
    n = String(n || "");
    if (n.length < 4 || n.length > 40) return false;
    if (/^[A-Za-z]{1,4}\d/.test(n)) return false; // resource codes (NP10, RM5...)
    if (/appointment|encounter|request|performed|documented|schedule|\btype\b|provider$|patient$|status|reason|resource|department|rendering|location/i.test(n)) return false;
    if (/\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i.test(n)) return false;
    if (/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(n)) return false;
    if (/\d{4}/.test(n)) return false;
    var underscoreFmt = /^[A-Za-z][A-Za-z'\-]+_[A-Za-z][A-Za-z'\-. ]+_[A-Za-z\-]+$/.test(n);
    var commaCred = /,/.test(n) && PROV_CRED.test(n);
    var nameComma = /^[A-Z][a-z'\-]+,\s*[A-Z][a-z'\-]+$/.test(n);
    return underscoreFmt || commaCred || nameComma;
  }
  function rosterProviders() {
    var set = {}, out = [];
    function addRaw(n) { // trusted, verbatim
      n = String(n == null ? "" : n).trim();
      if (!n || /^all doctors$/i.test(n)) return;
      var k = n.toLowerCase(); if (!set[k]) { set[k] = 1; out.push(n); }
    }
    function addFiltered(n) { // roster-recovered, sanitized
      n = cleanProviderName(n);
      if (!n || /^all doctors$/i.test(n) || !isProviderName(n)) return;
      var k = n.toLowerCase(); if (!set[k]) { set[k] = 1; out.push(n); }
    }
    var cal = providers(); for (var k = 0; k < cal.length; k++) addRaw(cal[k]);
    var pk = safe(function () { return window.__mlsProviderPicker; }, null);
    if (pk && isFn(pk.cachedProviders)) { var c = safe(function () { return pk.cachedProviders(); }, []) || []; for (var i = 0; i < c.length; i++) addFiltered(c[i]); }
    var rp = safe(function () { return window.__mlsProviderRoster; }, null);
    if (rp && isFn(rp.providers)) { var c2 = safe(function () { return rp.providers(); }, []) || []; for (var j = 0; j < c2.length; j++) addFiltered(c2[j]); }
    return out;
  }
  function rebuildProvDropdown(real) {
    var p = panel(); if (!p) return;
    var sel = p.querySelector(".as-prov"); if (!sel) return;
    if (document.activeElement === sel) return;
    real = real || rosterProviders();
    var html = '<option>All doctors</option>';
    for (var i = 0; i < real.length; i++) html += '<option>' + esc(real[i]) + '</option>';
    if (sel.getAttribute("data-mlsfix-prov") === html) return;
    var cur = sel.value;
    sel.innerHTML = html;
    try { sel.setAttribute("data-mlsfix-prov", html); } catch (e) {}
    var opts = sel.options, restored = false;
    for (var j = 0; j < opts.length; j++) { if (opts[j].value === cur) { sel.value = cur; restored = true; break; } }
    if (!restored) sel.value = "All doctors";
  }
  function syncProviders() {
    var real = rosterProviders();
    try {
      var cal = Array.isArray(window._calProviders) ? window._calProviders : [];
      var have = {}; for (var i = 0; i < cal.length; i++) have[String(cal[i]).toLowerCase()] = 1;
      for (var j = 0; j < real.length; j++) { var k = real[j].toLowerCase(); if (!have[k]) { cal.push(real[j]); have[k] = 1; } }
      window._calProviders = cal;
    } catch (e) {}
    rebuildProvDropdown(real);
  }
  function startProviderPoll() { stopProviderPoll(); providerPoll = setInterval(function () { safe(syncProviders); }, 5000); }
  function stopProviderPoll() { if (providerPoll) { clearInterval(providerPoll); providerPoll = null; } }

  /* =====================================================================
   * FIX 6 -- never show a failure message during an in-flight read
   * ===================================================================== */
  var pullBtnEl = null, pullCapture = null, pullBusy = false;
  function setPullStatus(msg, ok) {
    var p = panel(); if (!p) return;
    var el = p.querySelector(".as-pullstatus"); if (!el) return;
    el.textContent = msg || "";
    try { el.classList.toggle("ok", !!ok); } catch (e) {}
  }
  function curSelDateProv() {
    var p = panel(), ds = todayStr(), pv = "All doctors";
    if (p) {
      var di = p.querySelector(".as-date"); if (di && di.value) ds = di.value;
      var pr = p.querySelector(".as-prov"); if (pr && pr.value) pv = pr.value;
    }
    return { date: ds, provider: pv };
  }
  function doPullHonest(btn) {
    if (pullBusy) return;
    var c = CT(), si = SI();
    var connected = safe(function () { return c && isFn(c.isConnected) && c.isConnected(); }, false);
    if (!connected) {
      var d = safe(function () { return c && isFn(c.describe) ? c.describe() : null; }, null);
      setPullStatus((d && (d.detail || d.label)) || "athenaOne isn't connected yet -- sign in and open your Day schedule, then pull.", false);
      safe(function () { if (c && isFn(c.check)) c.check(); });
      return;
    }
    if (!(si && isFn(si.pull))) { setPullStatus("Schedule pull is unavailable right now.", false); return; }
    var sel = curSelDateProv();
    pullBusy = true; if (btn) btn.disabled = true;
    setPullStatus("Reading your athenaOne Day schedule...", false);
    safe(function () {
      si.pull({ date: sel.date, provider: sel.provider, onStatus: function (msg, kind) {
        if (!pullBusy) return;
        if (kind === "ok") return;
        var m = String(msg || "");
        if (/no patient|didn'?t|couldn'?t|try again|open (your )?athena|no new|unavailable|isn'?t responding|enable/i.test(m)) return;
        if (m) setPullStatus(m, false);
      } })
      .then(function (res) {
        pullBusy = false; if (btn) btn.disabled = false;
        var created = (res && res.created) || 0;
        var a = ASST(); safe(function () { if (a && isFn(a._renderSchedule)) a._renderSchedule(); });
        safe(syncProviders);
        if (created > 0) setPullStatus("Imported " + created + " appointment" + (created === 1 ? "" : "s") + " for " + sel.date + ".", true);
        else setPullStatus("No new appointments for " + sel.date + ". Open that day's Day-schedule grid (the patient list) in athenaOne, then pull again.", false);
      })
      .catch(function () { pullBusy = false; if (btn) btn.disabled = false; setPullStatus("Couldn't finish the import -- open your athenaOne Day schedule and try again.", false); });
    });
  }
  function takeoverPullButton() {
    var p = panel(); if (!p) return false;
    var btn = p.querySelector(".as-pullbtn"); if (!btn) return false;
    if (btn.getAttribute("data-mlsfix-pull")) return true;
    pullCapture = function (e) {
      try { e.stopImmediatePropagation(); e.preventDefault(); } catch (er) {}
      doPullHonest(btn);
    };
    btn.addEventListener("click", pullCapture, true);
    try { btn.setAttribute("data-mlsfix-pull", "1"); } catch (e) {}
    pullBtnEl = btn;
    return true;
  }
  function revertPullButton() {
    if (pullBtnEl && pullCapture) {
      try { pullBtnEl.removeEventListener("click", pullCapture, true); } catch (e) {}
      try { pullBtnEl.removeAttribute("data-mlsfix-pull"); } catch (e) {}
    }
    pullBtnEl = null; pullCapture = null; pullBusy = false;
  }

  /* =====================================================================
   * boot -- wait for the panel, then wire everything up
   * ===================================================================== */
  var bootIv = null, bootTries = 0;
  function tryWire() {
    var wiredAll = true;
    if (CT()) { try { installConnHardening(); } catch (e) {} } else wiredAll = false;
    if (panel()) {
      injectStyle();
      injectOpenButton();
      takeoverChat();
      takeoverPullButton();
      syncProviders();
      if (!providerPoll) startProviderPoll();
    } else wiredAll = false;
    return wiredAll && connInstalled;
  }
  function boot() {
    if (tryWire()) return;
    bootIv = setInterval(function () {
      bootTries++;
      if (tryWire() || bootTries > 60) { clearInterval(bootIv); bootIv = null; }
    }, 500);
  }

  function revert() {
    if (bootIv) { clearInterval(bootIv); bootIv = null; }
    safe(stopProviderPoll);
    safe(revertPullButton);
    safe(revertChat);
    safe(removeOpenButton);
    safe(removeStyle);
    safe(revertConn);
    try { window[NS].installed = false; } catch (e) {}
  }

  window[NS] = {
    installed: true,
    version: VERSION,
    asset: "feat_mls_asst_fix.js",
    _state: function () { return connState; },
    _check: function () { return connCheck(); },
    _handleSend: handleSend,
    _syncProviders: syncProviders,
    registerIntent: registerIntent,
    settingsGet: settingsGet,
    settingsSet: settingsSet,
    revert: revert
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () { safe(boot); }, { once: true });
  } else { safe(boot); }
})();
