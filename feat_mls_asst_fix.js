/* feat_mls_asst_fix.js  ->  window.__mlsAsstFix  (v1.4.1)  [item19 + Task 2]
 *
 * v1.2.0 (Task 2 -- unified Copilot conversation): FIX 3's chat now shares ONE
 * conversation store with AI Studio via window.__mlsCopilotConvo (feat_mls_copilot_unify.js).
 * The private `chatLog` is used ONLY as a fallback when the unify module is absent,
 * so a message asked here appears in Studio and vice-versa, and both persist across
 * refresh. All other v1.1.0 behavior (capture-phase send, MutationObserver self-render
 * guard, honest connection status, intents, provider picker) is unchanged.
 * ORIGINAL v1.1.0 header follows:
 *
 * SIX additive, reversible fixes to the MLS Assistant panel/chat. Web-app only
 * (no extension reload). Read-only with respect to athenaOne -- NEVER writes, signs,
 * saves, navigates, or focuses an athenaOne tab; NEVER logs the user out. No PHI is
 * read, stored, or logged (only non-PHI control fields: resp.ok, url host, title,
 * provider names, and a sign-in boolean). ASCII-only. Idempotent. try/catch throughout.
 *
 * FIX 1 -- PHI-FREE, REAL-TIME READINESS STATUS
 *   Green means MLS Assist responds and operational health reports an exact,
 *   non-discarded Athena product tab. It never reads a schedule/chart to poll,
 *   and never claims sign-in, patient, encounter, or chart-read verification.
 *   Re-checks on focus/pageshow/visibilitychange and on a bounded interval.
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
  var VERSION = "1.4.1";
  /* Task 2: the shared Copilot conversation store (feat_mls_copilot_unify.js).
     When present, the panel's history reads/writes go through it so Studio and
     this panel are ONE conversation. Absent -> fall back to the private chatLog. */
  function CONVO() { try { var c = window.__mlsCopilotConvo; return (c && typeof c.append === "function") ? c : null; } catch (e) { return null; } }
  /* The extension-version handshake historically reused this namespace and
     could leave {installed:true, version:"<extension>"} here before this
     asset executed. Treat only the complete assistant bridge as installed;
     an incomplete marker must be replaced so voice/chat can self-heal on the
     same page load. */
  try {
    var priorApi = window[NS];
    if (priorApi && priorApi.installed &&
        typeof priorApi._handleSend === "function" &&
        typeof priorApi.registerIntent === "function") return;
  } catch (e) { return; }

  /* ---------- self-gate: production MLS plus staging marker/pages ---------- */
  function gateOn() {
    try {
      if (/(^|\.)mlsscribe\.com$/i.test(String(location.hostname || ""))) return true;
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
  /* Health polling is operational metadata only; it never reads Athena DOM. */
  var PING_TIMEOUT_MS = 2500, HEALTH_TIMEOUT_MS = 4000, POLL_MS = 30000;

  var COLOR = {
    "connected":    { color: "green", label: "MLS Assist ready · Athena tab detected" },
    "no-extension": { color: "red",   label: "MLS Assist not detected" },
    "no-tab":       { color: "red",   label: "No usable Athena tab detected" },
    "error":        { color: "red",   label: "MLS Assist health unavailable" },
    "checking":     { color: "grey",  label: "Checking readiness..." }
  };

  var connReqSeq = 0;
  function connRequest(type, replyType, timeoutMs) {
    return new Promise(function (resolve) {
      var done = false;
      /* 2026-07-17: stamp + correlate. The bridge echoes requestId (b346), so a
         probe can no longer settle on ANOTHER surface's reply (the old comment
         in connCheck describes exactly this hazard). Id-less replies (mlsPong)
         still pass. */
      var reqId = "mlsaf" + (++connReqSeq) + "_" + Date.now().toString(36);
      var handler = function (ev) {
        var d = ev && ev.data;
        if (!d || typeof d !== "object" || d.source !== "mls-ext" || d.type !== replyType) return;
        if (d.requestId && d.requestId !== reqId) return; /* someone else's reply */
        if (done) return; done = true;
        try { window.removeEventListener("message", handler, false); } catch (e) {}
        clearTimeout(t);
        if (replyType === "mlsPong") { resolve({ ok: true }); }
        else {
          var r = d.resp || {}, a = r.athena || {};
          var tabs = Math.max(0, Number(a.tabs || 0)), discarded = Math.max(0, Number(a.discarded || 0));
          resolve({ ok: r.ok === true, tabs: tabs, discarded: discarded, usable: r.ok === true && tabs > discarded, reason: String(r.reason || r.error || "").slice(0, 120) });
        }
      };
      var t = setTimeout(function () {
        if (done) return; done = true;
        try { window.removeEventListener("message", handler, false); } catch (e) {}
        resolve({ ok: false, timedOut: true });
      }, timeoutMs);
      window.addEventListener("message", handler, false);
      try { window.postMessage({ source: "mls-app", type: type, requestId: reqId }, "*"); }
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
    /* Health replies have their own correlated message type and cannot consume
       or be consumed by an explicit clinician-started schedule pull. */
    connInFlight = connRequest("mlsPing", "mlsPong", PING_TIMEOUT_MS).then(function (ping) {
      if (!ping.ok) { connInFlight = null; return connSetState("no-extension", "MLS Assist not detected -- load the extension and reload."); }
      return connRequest("mlsExtHealth", "mlsExtHealthResult", HEALTH_TIMEOUT_MS).then(function (s) {
        connInFlight = null;
        if (s.usable) {
          return connSetState("connected", "MLS Assist ready -- Athena tab detected; patient and encounter not yet verified.");
        }
        /* A failed health reply names the extension worker as the problem. A
           passive check never infers anything about Athena sign-in state. */
        if (!s.ok || /extension-error|bridge-error|context invalidated|worker-unreachable|no-response/i.test(s.reason || "")) {
          return connSetState("error", "MLS Assist was detected, but its worker health check failed -- reload MLS Assist at chrome://extensions. Athena was not read.");
        }
        if (s.tabs > 0 && s.discarded >= s.tabs) return connSetState("no-tab", "Athena tab detected but discarded by Memory Saver -- activate it before a clinical action.");
        return connSetState("no-tab", "MLS Assist ready -- no usable Athena product tab detected.");
      });
    }).catch(function () { connInFlight = null; return connSetState("error", "Readiness check failed -- Athena was not read."); });
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
    btn.style.cssText = "width:100%;height:34px;border-radius:9px;border:1px solid #2E6A4B;" +
      "background:linear-gradient(180deg,#2E6A4B,#2E6A4B);color:#fff;font:600 12.5px/1 'Plus Jakarta Sans',system-ui,sans-serif;" +
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
      chatBusy = false, chatSelfRender = false, chatBoundEls = null, convoUnsub = null;
  var aiRequestSeq = 0, activeAiRequest = null, aiOwnerEvents = [];
  var THREAD_MARK = "data-mlsfix";

  var GREETING = "Hi -- I'm the MLS Assistant. I can pull your athenaOne schedule, open athenaOne, and answer questions. Try \"pull today's patients\", \"pull Dr <name>'s schedule\", or \"are we connected?\".";
  /* the messages to render: shared store when present (so Studio + panel are one
     conversation), else the private chatLog fallback. */
  function convoMessages() {
    var s = CONVO();
    if (s) { return safe(function () { return s.all(); }, []) || []; }
    return chatLog;
  }
  /* what renderThread actually paints -- shared store turns, or a display-only
     greeting when the store is present but still empty. The MutationObserver
     compares against THIS count so its self-render guard stays in sync. */
  function displayMsgs() {
    var msgs = convoMessages();
    if (CONVO() && !msgs.length) return [{ role: "ai", text: GREETING }];
    return msgs;
  }
  function seedChatLog() {
    var s = CONVO();
    if (s) {
      /* shared store present: DO NOT seed a greeting into it -- the greeting is
         panel-only presentation and must not pollute the shared conversation (or the
         /api/copilot history payload, or Studio's thread). renderThread() shows the
         greeting as a display-only bubble when the store has no real turns yet. */
      return;
    }
    var a = ASST();
    var h = safe(function () { return a && isFn(a._history) ? a._history() : null; }, null);
    if (h && h.length) {
      chatLog = h.filter(function (m) { return m.role === "user" || m.role === "ai"; })
                 .map(function (m) { return { role: m.role, text: m.text }; });
    }
    if (!chatLog.length) { chatLog = [{ role: "ai", text: GREETING }]; }
  }
  function renderThread() {
    var t = threadEl(); if (!t) return;
    var msgs = displayMsgs();
    var html = "";
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var role = m.role === "user" ? "user" : (m.role === "pending" ? "ai pending" : "ai");
      html += '<div class="as-msg ' + role + '"><div class="as-bub">' + esc(m.text) + "</div></div>";
    }
    chatSelfRender = true;
    t.innerHTML = html;
    try { t.setAttribute(THREAD_MARK, String(msgs.length)); } catch (e) {}
    chatSelfRender = false;
    var b = bodyEl(); if (b) b.scrollTop = b.scrollHeight;
  }
  function addUser(text) { var s = CONVO(); if (s) { safe(function () { s.append("user", text); }); } else { chatLog.push({ role: "user", text: text }); renderThread(); } }
  function dropPending(target) {
    var s = CONVO();
    if (s) { return safe(function () { return s.dropPending(target); }, false); }
    var changed = false;
    for (var i = chatLog.length - 1; i >= 0; i--) {
      if (chatLog[i] && chatLog[i].role === "pending" && (!target || chatLog[i] === target)) {
        chatLog.splice(i, 1); changed = true; if (target) break;
      }
    }
    if (changed) renderThread();
    return changed;
  }
  function addAi(text, extra, pending) {
    var s = CONVO();
    if (s) {
      safe(function () { if (pending) s.dropPending(pending); s.append("ai", text, extra || null); });
    } else {
      if (pending) dropPending(pending);
      var msg = { role: "ai", text: text };
      if (extra && typeof extra === "object") for (var k in extra) if (k !== "role" && k !== "text") msg[k] = extra[k];
      chatLog.push(msg); renderThread();
    }
  }
  function addPending(text, extra) {
    var s = CONVO();
    if (s) return safe(function () { return s.pushPending(text || "Thinking…", extra || null); }, null);
    var pending = { role: "pending", text: text || "Thinking…" };
    if (extra && typeof extra === "object") for (var k in extra) if (k !== "role" && k !== "text") pending[k] = extra[k];
    chatLog.push(pending); renderThread(); return pending;
  }

  function norm(v) { return v == null ? "" : String(v); }
  function activePatientId() {
    return safe(function () {
      if (isFn(window.getActivePtId)) return norm(window.getActivePtId());
      var p = isFn(window.activePatient) ? window.activePatient() : null;
      return p ? norm(p.id) : "";
    }, "");
  }
  function contextOwnerId() {
    return safe(function () {
      var owner = window.__mlsPtCtxSafety;
      return owner && isFn(owner.owner) ? norm(owner.owner()) : activePatientId();
    }, activePatientId());
  }
  function visitBindingId() {
    return safe(function () {
      var b = (typeof currentVisitAthenaBinding !== "undefined") ? currentVisitAthenaBinding : null;
      return b ? norm(b.id) : "";
    }, "");
  }
  function visitBindingEpoch() {
    return safe(function () { return (typeof currentVisitAthenaEpoch !== "undefined") ? Number(currentVisitAthenaEpoch || 0) : 0; }, 0);
  }
  function reconcilePatient(reason) {
    safe(function () {
      var owner = window.__mlsPtCtxSafety;
      if (owner && isFn(owner.reconcile)) owner.reconcile(reason || "assistant-copilot");
    });
  }
  function cloneJson(value) {
    return safe(function () { return JSON.parse(JSON.stringify(value == null ? {} : value)); }, {});
  }
  function convoHistoryRef() {
    return safe(function () { return Array.isArray(window._copilotHistory) ? window._copilotHistory : chatLog; }, chatLog);
  }
  function captureAiOwner() {
    reconcilePatient("assistant-copilot-send");
    var store = CONVO();
    return {
      id: ++aiRequestSeq,
      activeId: activePatientId(),
      ownerId: contextOwnerId(),
      bindingId: visitBindingId(),
      epoch: visitBindingEpoch(),
      history: convoHistoryRef(),
      rev: store && isFn(store.rev) ? Number(store.rev()) : -1,
      context: cloneJson(safe(function () { return isFn(window.copilotSnapshot) ? window.copilotSnapshot() : {}; }, {})),
      controller: (typeof AbortController === "function") ? new AbortController() : null,
      pending: null,
      stale: false,
      reverted: false
    };
  }
  function aiOwnerStillCurrent(req, includeRev) {
    if (!req || activeAiRequest !== req || convoHistoryRef() !== req.history) return false;
    if (activePatientId() !== req.activeId || contextOwnerId() !== req.ownerId || visitBindingId() !== req.bindingId || visitBindingEpoch() !== req.epoch) return false;
    if (includeRev) {
      var store = CONVO();
      if (store && isFn(store.rev) && Number(store.rev()) !== Number(req.rev)) return false;
    }
    return true;
  }
  function setAiBusy(on) {
    chatBusy = !!on;
    safe(function () { window._copilotBusy = !!on; });
    var p = panel(), send = p ? p.querySelector(".as-send") : null;
    if (send) { send.disabled = !!on; send.setAttribute("aria-busy", on ? "true" : "false"); }
    var studioSend = $("copilotSendBtn");
    if (studioSend) { studioSend.disabled = !!on; studioSend.setAttribute("aria-busy", on ? "true" : "false"); }
  }
  function abortCurrentIfStale() {
    var req = activeAiRequest;
    if (!req || aiOwnerStillCurrent(req, false)) return;
    req.stale = true;
    safe(function () { if (req.controller) req.controller.abort(); });
  }
  /* Only these two names have a production dispatcher; the poll below covers
     any owner change that emits no event at all. */
  function bindAiOwnerEvents() {
    if (aiOwnerEvents.length) return;
    ["mls:active-patient-changed", "mls:view-changed"].forEach(function (name) {
      safe(function () { window.addEventListener(name, abortCurrentIfStale, false); aiOwnerEvents.push([name, abortCurrentIfStale]); });
    });
  }
  /* Bounded fallback while a request is in flight: an owner switch that emits
     no event must not leave the busy latch held until the fetch settles. */
  var AI_STALE_POLL_MS = 2000;
  function startAiStalePoll(req) {
    req.staleT = (typeof setInterval === "function") && setInterval(function () {
      if (activeAiRequest !== req) { stopAiStalePoll(req); return; }
      abortCurrentIfStale();
    }, AI_STALE_POLL_MS);
  }
  function stopAiStalePoll(req) {
    safe(function () { if (req && req.staleT && typeof clearInterval === "function") { clearInterval(req.staleT); req.staleT = 0; } });
  }
  function unbindAiOwnerEvents() {
    for (var i = 0; i < aiOwnerEvents.length; i++) safe(function (row) { window.removeEventListener(row[0], row[1], false); }.bind(null, aiOwnerEvents[i]));
    aiOwnerEvents = [];
  }

  function parseIntent(q) {
    var s = String(q || "").toLowerCase().trim();
    if (!s) return null;
    if (/\b(open|launch|connect)\b[^.]*\bathena/.test(s) || /\bathena(one|net)?\b[^.]*\b(tab|open|new tab)\b/.test(s)) return { type: "open" };
    if (/are (we|you) connected|is athena (connected|up|working)|\bconnection status\b|\bdisconnected?\b/.test(s) ||
        (/\bstatus\b/.test(s) && /athena/.test(s)) || (/\bconnected\b/.test(s) && /athena/.test(s))) return { type: "status" };
    if ((/\bpull\b|\bimport\b|\bload\b|\bfetch\b/.test(s)) &&
        (/patient|schedule|today|tomorrow|appointment|chart|athena|\bdr\b|doctor|\bmonth\b/.test(s))) {
      /* Owner 2026-07-23: "pull my last month" must just work. Month scope
         wins before day parsing; routed to the month engine, not the day one. */
      var mScope = s.match(/\b(last|past|previous|this)\s+month\b/);
      if (mScope) return { type: "pullMonth", scope: (mScope[1] === "this" ? "this" : "last"), raw: q };
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
    token = String(token || "").toLowerCase().trim();
    if (!token) return null;
    var list = rosterProviderEntries(), matches = [];
    for (var i = 0; i < list.length; i++) {
      var e = list[i], hay = (String(e.name || "") + " " + String(e.raw || "")).toLowerCase();
      if (hay.indexOf(token) >= 0) matches.push(e);
    }
    /* A one-word request such as "Dr Schaeffer" is unsafe when two distinct
       provider identities share that name/token. Never pick the first row. */
    return matches.length === 1 ? matches[0] : null;
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
    if (d.status === "connected") addAi("MLS Assist is ready. " + (d.detail || "An Athena tab was detected; no patient or encounter has been verified yet.") + " You can start an explicit schedule pull when needed.");
    else addAi("Not ready. " + (d.detail || d.label) + " Tap \"Open athenaOne in new tab\" above before a clinical action.");
    safe(function () { if (c && isFn(c.check)) c.check(); });
  }
  function monthKeyFor(scope) {
    var d = new Date();
    if (scope === "last") d.setMonth(d.getMonth() - 1);
    return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2);
  }
  function runPullMonth(intent) {
    var c = CT(), si = SI();
    var connected = safe(function () { return c && isFn(c.isConnected) && c.isConnected(); }, false);
    if (!connected) {
      var d = safe(function () { return c && isFn(c.describe) ? c.describe() : null; }, null);
      addAi("I can't pull yet -- " + ((d && (d.detail || d.label)) || "no usable Athena product tab was detected.") + " Tap \"Open athenaOne in new tab\" above, sign in and open your Day schedule, then ask again.");
      safe(function () { if (c && isFn(c.check)) c.check(); });
      return;
    }
    if (!(si && isFn(si.pullMonth))) { addAi("The month pull isn't available right now. Open Menu -> Staff prep & Athena month pull and use the \"Pull a month from Athena\" card."); return; }
    var mk = monthKeyFor(intent.scope);
    addAi("On it -- pulling your " + (intent.scope === "this" ? "current" : "last") + " month (" + mk + ") from athenaOne now, read-only. Already-saved appointments are skipped, never doubled; the month card shows live day-by-day progress.");
    safe(function () {
      si.pullMonth({ month: mk, onStatus: function () {} })
        .then(function (res) {
          addAi(res && res.complete === false
            ? "The month pull finished with some days still retryable -- the month card lists them with a Retry button."
            : "Month pull finished -- " + mk + " is on your calendar.");
        }, function (e) {
          addAi("The month pull did not finish -- " + ((e && e.message) || "check the Athena tab") + ". Nothing was marked complete; it is safe to retry.");
        });
    });
  }
  function runPull(intent) {
    var a = ASST(), c = CT(), si = SI();
    var ds = intent.day === "tomorrow" ? addDaysStr(todayStr(), 1) : todayStr();
    var pv = intent.provider ? (matchProvider(intent.provider) || null) : null;
    if (intent.provider && !pv) {
      addAi("I couldn't uniquely match that provider. Choose the exact clinician in the provider list, then try the pull again.");
      return;
    }
    safe(function () { if (a && isFn(a.setTab)) a.setTab("schedule"); });
    safe(function () { if (a && isFn(a.setDate)) a.setDate(ds); });
    if (pv) safe(function () { if (a && isFn(a.setProvider)) a.setProvider(providerValue(pv)); });
    var connected = safe(function () { return c && isFn(c.isConnected) && c.isConnected(); }, false);
    if (!connected) {
      var d = safe(function () { return c && isFn(c.describe) ? c.describe() : null; }, null);
      addAi("I can't pull yet -- " + ((d && (d.detail || d.label)) || "no usable Athena product tab was detected.") + " Tap \"Open athenaOne in new tab\" above, sign in and open your Day schedule, then ask again.");
      safe(function () { if (c && isFn(c.check)) c.check(); });
      return;
    }
    if (!(si && isFn(si.pull))) { addAi("Schedule pull isn't available right now."); return; }
    addAi("On it -- pulling the " + (intent.day || "today's") + " schedule" + (pv ? (" for " + pv.name) : "") + " from athenaOne now. You can keep working; I'll store them when done.");
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
  function uniqueResponseMeta(d, requestId) {
    var seen = {}, actions = [], followups = [];
    var rawActions = d && Array.isArray(d.actions) ? d.actions : [];
    for (var i = 0; i < rawActions.length; i++) {
      var a = rawActions[i]; if (!a || typeof a !== "object") continue;
      var ak = [a.kind || "", a.arg || "", a.label || ""].join("|");
      if (seen["a:" + ak]) continue; seen["a:" + ak] = true; actions.push(a);
    }
    var rawFollowups = d && Array.isArray(d.followups) ? d.followups : [];
    for (var j = 0; j < rawFollowups.length; j++) {
      var f = String(rawFollowups[j] || "").trim(); if (!f) continue;
      var fk = f.toLowerCase(); if (seen["f:" + fk]) continue; seen["f:" + fk] = true; followups.push(f);
    }
    return {
      requestId: requestId,
      actions: actions,
      followups: followups,
      artifact: d && d.artifact && typeof d.artifact === "object" ? d.artifact : null
    };
  }
  function busyNotice() {
    safe(function () { if (isFn(window.toast)) window.toast("Copilot is finishing the current answer. Please wait a moment.", ""); });
  }
  function aiAsk(q) {
    if (chatBusy || safe(function () { return !!window._copilotBusy; }, false)) { busyNotice(); return false; }
    var ready = safe(function () {
      var bm = isFn(window.backendMode) && window.backendMode();
      var tok = isFn(window.bkToken) && window.bkToken();
      return !!(bm && tok);
    }, false);
    if (!ready) { addAi("Sign in to your MLS account to use AI answers. Schedule, patient, and connection commands still work here."); return true; }
    var req = captureAiOwner();
    activeAiRequest = req;
    startAiStalePoll(req);
    setAiBusy(true);
    req.pending = addPending("Reading the selected patient and practice context...", { requestId: req.id, requestOwner: req.ownerId, requestEpoch: req.epoch });
    var storeAtSend = CONVO();
    req.rev = storeAtSend && isFn(storeAtSend.rev) ? Number(storeAtSend.rev()) : -1;
    var base = safe(function () { return window.bkBase(); }, "");
    var tok = safe(function () { return window.bkToken(); }, "");
    /* history from the shared store when present (so it matches Studio exactly),
       else the private chatLog. Exclude any pending; drop the just-added user turn. */
    var s = CONVO();
    var src = s ? (safe(function () { return s.messages(); }, []) || []) : chatLog;
    var hist = src.filter(function (m) { return m.role === "user" || m.role === "ai"; })
                  .map(function (m) { return { role: m.role, text: m.text }; });
    hist = hist.slice(0, -1);
    var body = { question: q, history: hist, context: req.context };
    var options = {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tok },
      body: JSON.stringify(body)
    };
    if (req.controller) options.signal = req.controller.signal;
    fetch(base + "/api/copilot", options).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) { return { response: r, data: d || {} }; });
    }).then(function (result) {
      if (!aiOwnerStillCurrent(req, true)) { req.stale = true; return; }
      var r = result.response, d = result.data || {}, message = "";
      if (r.status === 401) message = "Your MLS session expired. Sign in again, then resend this question.";
      else if (r.status === 403) message = "Copilot is available on clinician accounts.";
      else if (r.status === 429) message = "Copilot is handling unusually high demand. Nothing was run; wait a moment and try again.";
      else if (r.status === 503) message = "Copilot's AI service is temporarily unavailable. Your local schedule and patient commands still work.";
      else if (!r.ok) message = String(d.error || ("Copilot could not answer (server status " + r.status + "). Try again."));
      else message = String(d.reply || d.text || d.answer || "").trim() || "Copilot returned no answer. Try rephrasing the question.";
      addAi(message, r.ok ? uniqueResponseMeta(d, req.id) : { requestId: req.id, actions: [], followups: [], artifact: null }, req.pending);
      req.pending = null;
    }).catch(function (err) {
      if (!aiOwnerStillCurrent(req, false) || req.stale || (err && err.name === "AbortError")) { req.stale = !req.reverted; return; }
      addAi("Network error reaching Copilot. Nothing was run; check your connection and try again.", { requestId: req.id, actions: [], followups: [], artifact: null }, req.pending);
      req.pending = null;
    }).then(function () {
      stopAiStalePoll(req);
      dropPending(req.pending); req.pending = null;
      if (activeAiRequest === req) {
        activeAiRequest = null;
        setAiBusy(false);
      }
      reconcilePatient("assistant-copilot-finished");
      renderThread();
      if (req.stale && !req.reverted) safe(function () { if (isFn(window.toast)) window.toast("The patient, visit, or conversation changed, so that Copilot answer was discarded.", ""); });
    }, function () {
      stopAiStalePoll(req);
      dropPending(req.pending); req.pending = null;
      if (activeAiRequest === req) { activeAiRequest = null; setAiBusy(false); }
    });
    return true;
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
    registerIntent("pull-month", function (q) {
      var it = parseIntent(q); if (!it || it.type !== "pullMonth") return false;
      runPullMonth(it); return true;
    });
    registerIntent("select-patient", function (q) {
      var it = parseIntent(q); if (!it || it.type !== "select") return false;
      selectByName(q); return true;
    });
  }

  function handleSend(raw) {
    var q = String(raw || "").trim();
    if (!q) return false;
    if (chatBusy || safe(function () { return !!window._copilotBusy; }, false)) { busyNotice(); return false; }
    addUser(q);
    registerBuiltins();
    for (var i = 0; i < intentRegistry.length; i++) {
      var entry = intentRegistry[i];
      var handled = safe(function () { return entry.run(q); }, false);
      if (handled) return true;
    }
    return aiAsk(q);
  }
  function takeoverChat() {
    var p = panel(); if (!p) return false;
    var ta = p.querySelector(".as-input textarea") || p.querySelector("textarea");
    var send = p.querySelector(".as-send");
    if (!ta || !send) return false;
    if (send.getAttribute("data-mlsfix-bound")) return true;
    seedChatLog();
    renderThread();
    /* Task 2: repaint this panel whenever the shared conversation changes
       (a turn asked in AI Studio, or a cross-surface reset). Idempotent + guarded
       by the store's own re-entrancy flag; single subscription. */
    var s0 = CONVO();
    if (s0 && !convoUnsub) { convoUnsub = safe(function () { return s0.subscribe(function () { renderThread(); }); }, null); }
    sendCapture = function (e) {
      var v = ta.value;
      try { e.stopImmediatePropagation(); e.preventDefault(); } catch (er) {}
      if (handleSend(v) !== false) ta.value = "";
    };
    keyCapture = function (e) {
      if (e.key === "Enter" && !e.shiftKey) {
        var v = ta.value;
        try { e.stopImmediatePropagation(); e.preventDefault(); } catch (er) {}
        if (handleSend(v) !== false) ta.value = "";
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
        if (cur !== String(displayMsgs().length)) { renderThread(); }
      });
      try { chatObserver.observe(t, { childList: true }); } catch (e) {}
    }
    return true;
  }
  function revertChat() {
    if (convoUnsub) { try { convoUnsub(); } catch (e) {} convoUnsub = null; }
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
  var providerEvents = [], providerRetryTimer = null, providerRetryTries = 0, providerLateStarted = false;
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
  function provName(p) {
    // _calProviders entries may be strings OR objects ({id,name,specialty,...}).
    if (p && typeof p === "object") return String(p.name || p.displayName || p.label || p.raw || p.provider || "").trim();
    return String(p == null ? "" : p).trim();
  }
  function providerStableKey(p) {
    if (p && typeof p === "object") {
      if (p.stableKey) return String(p.stableKey);
      var id = p.id || p.providerId || p.provider_id || p.doctor_user_id;
      if (id !== undefined && id !== null && String(id).trim()) return "backend:" + String(id).trim();
      var raw = p.raw || p.provider_raw || p.provider_key || p.provider;
      if (raw) return "athena:" + String(raw).replace(/\s+/g, " ").trim().toLowerCase();
    }
    var s = provName(p); return s ? "legacy-name:" + s.toLowerCase() : "";
  }
  function providerEntry(p, source) {
    var rp = safe(function () { return window.__mlsProviderRoster; }, null);
    if (rp && isFn(rp._makeEntry)) {
      var made = safe(function () { return rp._makeEntry(p, source); }, null);
      if (made) return made;
    }
    var labelApi = safe(function () { return window.__mlsProviderLabel; }, null);
    var nm = labelApi && isFn(labelApi) ? safe(function () { return labelApi(p); }, "") : cleanProviderName(provName(p));
    var key = providerStableKey(p);
    if (!nm || !key || /^all doctors$/i.test(nm)) return null;
    var obj = p && typeof p === "object" ? p : {};
    return { stableKey: key, id: String(obj.id || obj.providerId || obj.provider_id || ""), raw: String(obj.raw || obj.provider_raw || obj.provider || nm), name: nm, source: source || "legacy", rosterVerified: obj.rosterVerified === true };
  }
  function rosterProviderEntries() {
    var seen = {}, out = [];
    function add(p, source, filtered) {
      var e = providerEntry(p, source); if (!e) return;
      if (filtered && !isProviderName(e.raw || e.name) && !isProviderName(e.name)) return;
      if (seen[e.stableKey]) return;
      seen[e.stableKey] = 1; out.push(e);
    }
    var rp = safe(function () { return window.__mlsProviderRoster; }, null);
    if (rp && isFn(rp.list)) {
      var canonical = safe(function () { return rp.list(); }, []) || [];
      for (var r = 0; r < canonical.length; r++) add(canonical[r], "canonical", false);
    }
    var cal = providers(); for (var k = 0; k < cal.length; k++) add(cal[k], "calendar", !(rp && isFn(rp._makeEntry)));
    /* Compatibility only: older pages may not have the structured roster yet. */
    if (!(rp && isFn(rp.list))) {
      var pk = safe(function () { return window.__mlsProviderPicker; }, null);
      if (pk && isFn(pk.cachedProviders)) { var c = safe(function () { return pk.cachedProviders(); }, []) || []; for (var i = 0; i < c.length; i++) add(c[i], "legacy-picker", true); }
      if (rp && isFn(rp.providers)) { var c2 = safe(function () { return rp.providers(); }, []) || []; for (var j = 0; j < c2.length; j++) add(c2[j], "legacy-roster", true); }
    }
    return out;
  }
  function rosterProviders() { return rosterProviderEntries().map(function (e) { return e.name; }); }
  function providerValue(e) { return e && e.stableKey ? ("pv:" + encodeURIComponent(e.stableKey)) : ""; }
  function resolveProviderValue(v) {
    if (!v || v === "all" || /^all doctors$/i.test(v)) return null;
    var rp = safe(function () { return window.__mlsProviderRoster; }, null);
    if (rp && isFn(rp.resolve)) {
      var hit = safe(function () { return rp.resolve(v); }, null); if (hit) return hit;
    }
    var raw = String(v); if (raw.indexOf("pv:") === 0) { try { raw = decodeURIComponent(raw.slice(3)); } catch (e) { return null; } }
    var list = rosterProviderEntries(), hits = list.filter(function (e) { return e.stableKey === raw || e.id === raw || String(e.raw).toLowerCase() === raw.toLowerCase() || String(e.name).toLowerCase() === raw.toLowerCase(); });
    return hits.length === 1 ? hits[0] : null;
  }
  function renderProviderReceipt() {
    var p = panel(); if (!p) return;
    var sel = p.querySelector(".as-prov"); if (!sel) return;
    var line = p.querySelector(".as-provstatus");
    if (!line) { line = document.createElement("div"); line.className = "as-provstatus"; line.style.cssText = "font-size:11px;line-height:1.35;color:#5d6b64;margin:-5px 0 9px;"; sel.parentNode.insertAdjacentElement("afterend", line); }
    var rp = safe(function () { return window.__mlsProviderRoster; }, null);
    var rec = rp && isFn(rp.getReceipt) ? safe(function () { return rp.getReceipt(); }, null) : null;
    var n = rosterProviderEntries().length;
    if (rec && rec.complete) { line.textContent = n + " provider" + (n === 1 ? "" : "s") + " verified from the full Athena schedule."; line.style.color = "#2E6A4B"; }
    else if (n) { line.textContent = "Provider list may be partial" + (rec && rec.reason ? " (" + rec.reason.replace(/-/g, " ") + ")" : "") + ". Pull the schedule again to finish loading it."; line.style.color = "#8A5A22"; }
    else { line.textContent = "Provider list is unavailable. Open the Athena Day schedule and pull it again."; line.style.color = "#9A3E38"; }
  }
  function rebuildProvDropdown(real) {
    var p = panel(); if (!p) return;
    var sel = p.querySelector(".as-prov"); if (!sel) return;
    if (document.activeElement === sel) return;
    real = real || rosterProviderEntries();
    var nameCounts = {}; real.forEach(function (e) { var k = String(e.name || "").toLowerCase(); nameCounts[k] = (nameCounts[k] || 0) + 1; });
    var html = '<option value="all">All doctors</option>';
    for (var i = 0; i < real.length; i++) {
      var e = real[i], label = e.name;
      if (nameCounts[String(e.name || "").toLowerCase()] > 1) label += " - " + (e.id ? ("ID " + e.id) : (e.raw && e.raw !== e.name ? e.raw : e.source));
      html += '<option value="' + esc(providerValue(e)) + '">' + esc(label) + '</option>';
    }
    if (sel.getAttribute("data-mlsfix-prov") === html) return;
    var cur = sel.value;
    sel.innerHTML = html;
    try { sel.setAttribute("data-mlsfix-prov", html); } catch (e) {}
    if (cur && cur !== "all") { var old = resolveProviderValue(cur); if (old) cur = providerValue(old); }
    var opts = sel.options, restored = false;
    for (var j = 0; j < opts.length; j++) { if (opts[j].value === cur) { sel.value = cur; restored = true; break; } }
    if (!restored) sel.value = "all";
    renderProviderReceipt();
  }
  function syncProviders() {
    var real = rosterProviderEntries();
    try {
      var cal = Array.isArray(window._calProviders) ? window._calProviders : [];
      var have = {}; for (var i = 0; i < cal.length; i++) have[providerStableKey(cal[i])] = 1;
      for (var j = 0; j < real.length; j++) { var k = real[j].stableKey; if (!have[k]) { cal.push(real[j]); have[k] = 1; } }
      window._calProviders = cal;
    } catch (e) {}
    rebuildProvDropdown(real);
  }
  function providerRefresh() { safe(syncProviders); }
  function bindProviderEvents() {
    if (providerEvents.length || !isFn(window.addEventListener)) return;
    ["mls:provider-roster-changed", "mls:providers-changed", "mls:calendar-changed", "mls:schedule-changed",
     "mls:connection-changed", "mls:ui-ready", "mls:view-changed", "mls:panel-open", "focus"].forEach(function (name) {
      safe(function () { window.addEventListener(name, providerRefresh, false); providerEvents.push([name, providerRefresh]); });
    });
  }
  function unbindProviderEvents() {
    for (var i = 0; i < providerEvents.length; i++) safe(function (row) { window.removeEventListener(row[0], row[1], false); }.bind(null, providerEvents[i]));
    providerEvents = [];
  }
  function stopProviderLateRetry() {
    if (providerRetryTimer != null) { safe(function () { clearTimeout(providerRetryTimer); }); providerRetryTimer = null; }
  }
  function providerLateStep() {
    providerRetryTimer = null; providerRetryTries++; providerRefresh();
    if (providerRetryTries < 12) providerRetryTimer = setTimeout(providerLateStep, 250);
  }
  function startProviderLateRetry() {
    if (providerLateStarted) return;
    providerLateStarted = true; providerRetryTries = 0; stopProviderLateRetry(); providerLateStep();
  }

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
    var p = panel(), ds = todayStr(), pv = "all", ref = "all", entry = null;
    if (p) {
      var di = p.querySelector(".as-date"); if (di && di.value) ds = di.value;
      var pr = p.querySelector(".as-prov"); if (pr && pr.value) ref = pr.value;
    }
    if (ref !== "all" && !/^all doctors$/i.test(ref)) { entry = resolveProviderValue(ref); if (entry) pv = entry; }
    return { date: ds, provider: pv, providerRef: ref, providerEntry: entry, invalidProvider: ref !== "all" && !entry };
  }
  function doPullHonest(btn) {
    if (pullBusy) return;
    var c = CT(), si = SI();
    var connected = safe(function () { return c && isFn(c.isConnected) && c.isConnected(); }, false);
    if (!connected) {
      var d = safe(function () { return c && isFn(c.describe) ? c.describe() : null; }, null);
      setPullStatus((d && (d.detail || d.label)) || "No usable Athena product tab was detected -- open Athena, sign in, and show the Day schedule before pulling.", false);
      safe(function () { if (c && isFn(c.check)) c.check(); });
      return;
    }
    if (!(si && isFn(si.pull))) { setPullStatus("Schedule pull is unavailable right now.", false); return; }
    var sel = curSelDateProv();
    if (sel.invalidProvider) {
      setPullStatus("That provider selection is no longer verifiable. Choose the clinician again; MLS will not silently pull everyone.", false);
      safe(syncProviders);
      return;
    }
    if (isFn(si._resolveProviderRequest)) {
      var gate = safe(function () { return si._resolveProviderRequest(sel.provider, { allowAll: true, requireRosterForAll: false }); }, null);
      if (!gate || !gate.ok) {
        setPullStatus((gate && gate.error) || "The full Athena provider roster is not verified yet. Re-pull the Day schedule before pulling one provider.", false);
        safe(syncProviders);
        return;
      }
      sel.provider = gate.provider;
    }
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
        if (res && res.complete === false) {
          setPullStatus((res.error || "The provider/day pull could not be verified. Nothing was imported; reopen the full Athena Day schedule and retry."), false);
        } else if (created > 0) setPullStatus("Imported " + created + " appointment" + (created === 1 ? "" : "s") + " for " + sel.date + ".", true);
        else if (res && res.providerReceipt && res.providerReceipt.complete && res.reason === "provider-empty") setPullStatus("Athena verified no appointments for " + (sel.providerEntry && sel.providerEntry.name || "that provider") + " on " + sel.date + ".", true);
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
      startProviderLateRetry();
    } else wiredAll = false;
    return wiredAll && connInstalled;
  }
  function boot() {
    bindAiOwnerEvents();
    bindProviderEvents();
    if (tryWire()) return;
    bootIv = setInterval(function () {
      bootTries++;
      if (tryWire() || bootTries > 60) { clearInterval(bootIv); bootIv = null; }
    }, 500);
  }

  function revert() {
    if (bootIv) { clearInterval(bootIv); bootIv = null; }
    if (activeAiRequest) {
      activeAiRequest.reverted = true;
      stopAiStalePoll(activeAiRequest);
      safe(function () { if (activeAiRequest.controller) activeAiRequest.controller.abort(); });
      dropPending(activeAiRequest.pending);
      activeAiRequest = null;
      setAiBusy(false);
    }
    safe(unbindAiOwnerEvents);
    safe(stopProviderLateRetry);
    safe(unbindProviderEvents);
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
