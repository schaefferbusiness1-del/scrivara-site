/* feat_mls_copilot_unify.js  ->  window.__mlsCopilotUnify  (unify-1.1.0)  [Task 2]
 *
 * ONE shared Copilot conversation across the two front-ends that used to keep
 * independent histories:
 *   A. AI Studio inline + slide-in dock  -> base `_copilotHistory` / copilotAsk()
 *   B. Floating "MLS Assistant" panel     -> feat_mls_asst_fix.js `chatLog` / aiAsk()
 * Both already POST the same /api/copilot with the same copilotSnapshot() context,
 * so context was unified; conversation was not. This module makes the base
 * `_copilotHistory` the ONE canonical store and exposes a tiny pub/sub over it, so
 * a message added on either surface appears on both, survives refresh (A already
 * persists to localStorage[uns('copilotHist')]), and never spawns a 2nd conversation.
 *
 * It ALSO:
 *   - flags "no active patient" in copilotSnapshot() so the AI never silently reuses
 *     a stale patient, and surfaces a "No patient selected" hint on both threads (G4);
 *   - provides an open-state coordinator: when AI Studio is the active view, opening
 *     the assistant prefers the Studio dock (a thin view of the SAME conversation)
 *     rather than a competing panel; never auto-opens anything on refresh (G2).
 *
 * SAFETY: app-side only. Never touches the Chrome extension, never reads/writes/
 *   navigates/focuses athenaOne, never signs anyone out, no PHI logged. Additive,
 *   reversible (.revert()), ASCII-only, try/catch throughout, idempotent.
 *   Staging-gated exactly like the surfaces it augments (feat_mls_asst_fix gateOn()).
 *
 * PUBLIC (window.__mlsCopilotConvo): all(), messages(), append(role,text,extra),
 *   pushPending(), dropPending(), reset(), subscribe(fn)->unsub, rev(), size(),
 *   activePatient(), noActivePatient().
 * PUBLIC (window.__mlsCopilotUnify): installed, version, route(reason), revert(),
 *   _diag().
 */
;(function () {
  "use strict";
  var NS = "__mlsCopilotUnify", STORE = "__mlsCopilotConvo", VERSION = "unify-1.1.0";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  /* ---- self-gate: identical to feat_mls_asst_fix / the assistant panel ---- */
  function gateOn() {
    try {
      if (/(^|\.)mlsscribe\.com$/i.test(location.hostname)) return true; /* PROD ENABLE - 2026-07-11 final integration sweep (was staging-gated) */
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window[NS] = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }

  /* ===================================================================
   * 1. Canonical store over window._copilotHistory  (G1 / G5)
   * =================================================================== */
  function arr() {
    try { if (!Array.isArray(window._copilotHistory)) window._copilotHistory = []; return window._copilotHistory; }
    catch (e) { return []; }
  }
  var subs = [], _rev = 0, _inNotify = false, _wrapNotify = false;
  var _origRenderThread = null; /* captured base render (unwrapped) */

  function baseRender() { try { if (isFn(_origRenderThread)) _origRenderThread(); else if (isFn(window._copilotRenderThread)) window._copilotRenderThread(); } catch (e) {} }
  function baseSave() { try { if (isFn(window._copilotSaveHist)) window._copilotSaveHist(); } catch (e) {} }
  function baseChips() { try { if (isFn(window._copilotRenderChips)) window._copilotRenderChips(); } catch (e) {} }

  /* notify is re-entrancy guarded: a subscriber that repaints its own surface
     must never re-trigger the notify cycle. */
  function notify() {
    if (_inNotify) return;
    _inNotify = true; _rev++;
    try {
      for (var i = 0; i < subs.length; i++) { try { subs[i](_rev); } catch (e) {} }
      updateNoPatientHints();
    } finally { _inNotify = false; }
  }

  var store = {
    /* every stored message, incl. a transient {role:'pending'} */
    all: function () { return arr().slice(); },
    /* just the real turns both surfaces render + send as history */
    messages: function () { return arr().filter(function (m) { return m && (m.role === "user" || m.role === "ai"); }); },
    size: function () { return this.messages().length; },
    append: function (role, text, extra) {
      var m = { role: (role === "user" ? "user" : "ai"), text: String(text == null ? "" : text) };
      if (extra && typeof extra === "object") { for (var k in extra) { if (k !== "role" && k !== "text") m[k] = extra[k]; } }
      try { arr().push(m); } catch (e) {}
      baseSave(); notify();
      return m;
    },
    /* Return a concrete pending token and allow callers to remove only their
       own request.  Omitting target preserves the legacy "drop all" behavior.
       This prevents one Copilot surface from clearing another in-flight turn. */
    pushPending: function (text, extra) {
      var pending = { role: "pending", text: text || "" };
      if (extra && typeof extra === "object") {
        for (var k in extra) if (k !== "role" && k !== "text") pending[k] = extra[k];
      }
      try { arr().push(pending); } catch (e) {}
      notify();
      return pending;
    },
    dropPending: function (target) {
      var changed = false;
      try {
        var a = arr(), i = a.length;
        while (i--) {
          if (a[i] && a[i].role === "pending" && (!target || a[i] === target)) {
            a.splice(i, 1); changed = true;
            if (target) break;
          }
        }
      } catch (e) {}
      if (changed) { baseSave(); notify(); }
      return changed;
    },
    reset: function () {
      try { window._copilotHistory = []; } catch (e) {}
      try { if (isFn(window.uns)) localStorage.removeItem(window.uns("copilotHist")); } catch (e) {}
      baseSave(); notify();
    },
    subscribe: function (fn) {
      if (!isFn(fn)) return function () {};
      subs.push(fn); try { fn(_rev); } catch (e) {}
      return function () { var i = subs.indexOf(fn); if (i >= 0) subs.splice(i, 1); };
    },
    rev: function () { return _rev; },
    activePatient: function () {
      return safe(function () {
        var ap = (isFn(window.activePatient)) ? window.activePatient() : null;
        return ap ? { id: ap.id, name: String(ap.name || "") } : null;
      }, null);
    },
    noActivePatient: function () { return !this.activePatient(); }
  };
  try { window[STORE] = store; } catch (e) {}

  /* ---- wire Surface A: wrap _copilotRenderThread so any A change notifies B,
     and subscribe A's ORIGINAL render so any B change repaints A. The wrap is
     idempotent and self-cleaning on revert. ---- */
  var renderWrapped = false;
  function wireStudio() {
    try {
      if (renderWrapped) return true;
      if (!isFn(window._copilotRenderThread)) return false;
      if (window._copilotRenderThread.__unifyWrapped) { _origRenderThread = window._copilotRenderThread.__unifyOrig || window._copilotRenderThread; renderWrapped = true; return true; }
      _origRenderThread = window._copilotRenderThread;
      var w = function () {
        var r;
        try { r = _origRenderThread.apply(this, arguments); } catch (e) {}
        /* Studio already painted itself; mark the notify so the Studio subscriber
           below skips a redundant second render (B still repaints). */
        _wrapNotify = true;
        try { notify(); } finally { _wrapNotify = false; }
        return r;
      };
      w.__unifyWrapped = true; w.__unifyOrig = _origRenderThread;
      window._copilotRenderThread = w;
      renderWrapped = true;
      /* repaint Studio whenever the shared store changes from ELSEWHERE (a turn
         asked in the floating panel, or a reset) -- but not when Studio itself
         just rendered (guarded by _wrapNotify). */
      store.subscribe(function () { if (_wrapNotify) return; baseRender(); });
      return true;
    } catch (e) { return false; }
  }
  function unwireStudio() {
    try { if (renderWrapped && window._copilotRenderThread && window._copilotRenderThread.__unifyWrapped) window._copilotRenderThread = window._copilotRenderThread.__unifyOrig; } catch (e) {}
    renderWrapped = false;
  }

  /* ===================================================================
   * 2. No-active-patient clarity  (G4)
   *   - copilotSnapshot(): add res.noActivePatient so the AI can't reuse a
   *     stale patient (context is rebuilt each call, but the flag is explicit).
   *   - a small "No patient selected" hint above BOTH threads.
   * =================================================================== */
  var snapWrapped = false, _origSnap = null;
  function wireSnapshot() {
    try {
      if (snapWrapped) return true;
      if (!isFn(window.copilotSnapshot)) return false;
      if (window.copilotSnapshot.__unifyWrapped) { snapWrapped = true; return true; }
      _origSnap = window.copilotSnapshot;
      var w = function () {
        var res = _origSnap.apply(this, arguments) || {};
        try { if (!res.activePatient) res.noActivePatient = true; } catch (e) {}
        return res;
      };
      w.__unifyWrapped = true; w.__unifyOrig = _origSnap;
      window.copilotSnapshot = w;
      snapWrapped = true;
      return true;
    } catch (e) { return false; }
  }
  function unwireSnapshot() {
    try { if (snapWrapped && window.copilotSnapshot && window.copilotSnapshot.__unifyWrapped) window.copilotSnapshot = window.copilotSnapshot.__unifyOrig; } catch (e) {}
    snapWrapped = false;
  }

  var HINT_ID_A = "mlsCopilotNoPtA", HINT_ID_B = "mlsCopilotNoPtB", HINT_STYLE_ID = "mlsCopilotUnifyStyle";
  function injectHintStyle() {
    try {
      if (document.getElementById(HINT_STYLE_ID)) return;
      var css = ".mls-nopt-hint{margin:0 0 8px;padding:7px 11px;border-radius:9px;border:1px dashed #c8d2e6;" +
        "background:#f3f6fc;color:#2E6A4B;font:600 12px/1.35 'Plus Jakarta Sans',system-ui,sans-serif;}";
      var s = document.createElement("style"); s.id = HINT_STYLE_ID; s.type = "text/css";
      s.appendChild(document.createTextNode(css));
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }
  function mkHint(id) {
    var d = document.createElement("div");
    d.id = id; d.className = "mls-nopt-hint";
    d.textContent = "No patient selected - pick one to ground answers to a specific chart.";
    return d;
  }
  function updateNoPatientHints() {
    try {
      injectHintStyle();
      var none = store.noActivePatient();
      /* Surface A: above #copilotThread (inside #copilotCard) */
      var thread = document.getElementById("copilotThread");
      if (thread && thread.parentNode) {
        var hA = document.getElementById(HINT_ID_A);
        if (none) { if (!hA) { hA = mkHint(HINT_ID_A); thread.parentNode.insertBefore(hA, thread); } }
        else if (hA && hA.parentNode) hA.parentNode.removeChild(hA);
      }
      /* Surface B: above .as-thread in #mlsAsstPanel */
      var panel = document.getElementById("mlsAsstPanel");
      var t2 = panel ? panel.querySelector(".as-thread") : null;
      if (t2 && t2.parentNode) {
        var hB = document.getElementById(HINT_ID_B);
        if (none) { if (!hB) { hB = mkHint(HINT_ID_B); t2.parentNode.insertBefore(hB, t2); } }
        else if (hB && hB.parentNode) hB.parentNode.removeChild(hB);
      }
    } catch (e) {}
  }
  function removeHints() {
    try { ["mlsCopilotNoPtA", "mlsCopilotNoPtB", "mlsCopilotUnifyStyle"].forEach(function (id) { var n = document.getElementById(id); if (n && n.parentNode) n.parentNode.removeChild(n); }); } catch (e) {}
  }

  /* ===================================================================
   * 3. Open-state coordinator  (G2)
   *   The shared store (1) already guarantees "the panel shows the SAME
   *   conversation, never a new one". This coordinator adds the preference:
   *   when AI Studio is the active view, route an "open assistant" request to
   *   the Studio DOCK (a thin view of the same #copilotThread) instead of the
   *   floating panel, so the two never compete for the same conversation.
   *   Never auto-opens anything (refresh restores the conversation, not an
   *   open panel).
   * =================================================================== */
  function studioActive() {
    try { var v = document.getElementById("studioView"); return !!(v && v.style && v.style.display !== "none" && v.offsetParent !== null); }
    catch (e) { return false; }
  }
  function route(reason) {
    /* Returns "dock" if it opened/kept the Studio dock, "panel" to let the
       caller open the floating panel, "noop" if nothing to do. Purely additive:
       callers that don't consult this keep working (the store still unifies). */
    try {
      if (studioActive() && isFn(window.openCopilotDock)) {
        try { window.openCopilotDock(); } catch (e) {}
        return "dock";
      }
    } catch (e) {}
    return "panel";
  }

  /* ===================================================================
   * boot
   * =================================================================== */
  var bootIv = null, tries = 0, lifecycleEvents = [];
  function tryWire() {
    var ok = true;
    if (!wireStudio()) ok = false;
    if (!wireSnapshot()) ok = false;
    try { if (isFn(window._copilotLoadHist) && !arr().length) window._copilotLoadHist(); } catch (e) {}
    try { updateNoPatientHints(); } catch (e) {}
    return ok;
  }
  function boot() {
    bindLifecycleEvents();
    if (tryWire()) return;
    bootIv = setInterval(function () {
      tries++;
      if (tryWire() || tries >= 40) { clearInterval(bootIv); bootIv = null; }
    }, 250);
  }
  /* Canonical lifecycle events replace the old permanent 1.5s patient-hint
     poll.  Late dependency recovery stays bounded; later UI-ready events can
     still retry without keeping a timer alive forever. */
  function bindLifecycleEvents() {
    if (lifecycleEvents.length || !isFn(window.addEventListener)) return;
    function onReady() { tryWire(); }
    function onContext() { updateNoPatientHints(); }
    [["mls:ui-ready", onReady], ["mls:copilot-ready", onReady], ["mls:view-changed", onReady],
     ["mls:active-patient-changed", onContext], ["mls:patient-changed", onContext]].forEach(function (row) {
      safe(function () { window.addEventListener(row[0], row[1], false); lifecycleEvents.push(row); });
    });
  }
  function unbindLifecycleEvents() {
    for (var i = 0; i < lifecycleEvents.length; i++) safe(function (row) { window.removeEventListener(row[0], row[1], false); }.bind(null, lifecycleEvents[i]));
    lifecycleEvents = [];
  }

  function revert() {
    if (bootIv) { clearInterval(bootIv); bootIv = null; }
    unbindLifecycleEvents();
    unwireStudio();
    unwireSnapshot();
    removeHints();
    subs = [];
    try { delete window[STORE]; } catch (e) { try { window[STORE] = undefined; } catch (e2) {} }
    try { window[NS].installed = false; } catch (e) {}
  }

  window[NS] = {
    installed: true,
    version: VERSION,
    asset: "feat_mls_copilot_unify.js",
    route: route,
    revert: revert,
    _diag: function () {
      return {
        renderWrapped: renderWrapped, snapWrapped: snapWrapped, subs: subs.length, rev: _rev,
        size: store.size(), noActivePatient: store.noActivePatient(),
        studioActive: studioActive()
      };
    }
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { safe(boot); }, { once: true });
  else safe(boot);
})();
