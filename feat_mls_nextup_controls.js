/* feat_mls_nextup_controls.js  ->  window.__mlsNuCtl  (pick-7.0.0)
 *
 *  GOAL (single, narrow, reversible UI cleanup)
 *  --------------------------------------------
 *  On the Visit page (Complex view) the patient-selection UI showed TWO stacked
 *  lists that were the same thing:
 *    (A) the BLUE "NEXT UP -- tap whoever you're seeing" cards in #heroToday
 *        (rendered by the app's own _renderTodayPatients(); selection via
 *         _heroPickPatient(): sets the active patient + fills heroPtName/heroPtDob),
 *    (B) a redundant WHITE list "Today's patients - in time order - tap one to
 *        select" in #mlsPickComplexWrap (rendered by feat_mls_patientpick.js ->
 *        __mlsPick.renderComplexInline()).
 *
 *  This module removes (B) and makes sure (A) loses NOTHING by surfacing the
 *  picker's own Today / any-day / full-list (Show more) capability right on the
 *  blue section:
 *    - "Today"          -> reasserts ONLY today's patients on the blue cards,
 *                          straight from the one shared source.
 *    - a date picker    -> "pick any day": opens the shared picker scoped to the
 *                          chosen day (full list, in time order).
 *    - "Show more"      -> reveals the FULL day's list (the shared picker modal,
 *                          which has its own Show more + Today/Tomorrow/Week tabs).
 *
 *  WIRING / SOURCE OF TRUTH
 *  ------------------------
 *  Everything reads the ONE shared data link: window.__mlsPick.scopeList(scope)
 *  (the exact source feat_mls_datalink_exact.js uses -- getPatients() + _calAppts),
 *  and selection always goes through the app's blessed funnels (_heroPickPatient
 *  on the blue cards; window.openPatient via __mlsPick.select in the modal), so a
 *  pick sets the active patient and populates name/DOB everywhere. The redundant
 *  white list is only HIDDEN (display:none) -- the node stays in the DOM so the
 *  data-link and assistant modules, which already guard their access to it
 *  (`if (cx) ...`), keep working untouched.
 *
 *  SAFETY
 *  ------
 *  Additive. Idempotent. Fully reversible via window.__mlsNuCtl.revert()
 *  (re-shows the white list, removes the control bar + styles, disconnects the
 *  observer/timer). Sends NOTHING to the extension; never pulls athenaOne; never
 *  clicks Save/Sign/Submit; never writes a chart. No PHI is read, logged, or sent
 *  anywhere -- it only drives existing renderers/handlers. Gated identically to the
 *  *_exact modules (staging page, or prod via the data: mls-connect.staging marker)
 *  so it activates exactly where the white list does. ASCII-only.
 */
;(function () {
  "use strict";
  var VERSION = "pick-7.0.0";
  try { if (window.__mlsNuCtl && window.__mlsNuCtl.installed) return; } catch (e) { return; }

  /* same gate as feat_mls_patientpick.js / *_exact: staging page OR prod staging marker */
  function gateOn() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!gateOn()) { try { window.__mlsNuCtl = { installed: false, skipped: "gate" }; } catch (e) {} return; }

  var STYLE_ID = "mlsNuCtlStyle";
  var BAR_ID = "mlsNuCtl";
  var CX_WRAP = "mlsPickComplexWrap";   /* the redundant white list */
  var HERO = "heroToday";               /* the blue NEXT UP host */
  var _scope = "today";                 /* current blue-section scope */

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function pick() { try { return window.__mlsPick || null; } catch (e) { return null; } }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function todayKey() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }

  /* ---- CSS: hide the redundant white list + style the blue control bar ---- */
  function injectCSS() {
    if ($(STYLE_ID)) return;
    var css = [
      /* (B) the redundant white Complex list -- hidden, node left intact + reversible */
      "html #" + CX_WRAP + "{display:none!important}",
      /* the control bar that sits with the blue NEXT UP */
      "#" + BAR_ID + "{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:8px 0 2px;",
      "font-family:'Plus Jakarta Sans',system-ui,sans-serif}",
      "#" + BAR_ID + " .mlsnu-lbl{font-size:11.5px;font-weight:700;letter-spacing:.3px;color:#5b6b80;margin-right:2px}",
      "#" + BAR_ID + " .mlsnu-btn{background:#1A211C;border:1px solid #19365b;color:#fff;border-radius:8px;",
      "padding:5px 12px;font-size:12px;font-weight:600;cursor:pointer;line-height:1.1}",
      "#" + BAR_ID + " .mlsnu-btn:hover{background:#16335a}",
      "#" + BAR_ID + " .mlsnu-btn.on{background:#2E6A4B;border-color:#2E6A4B}",
      "#" + BAR_ID + " .mlsnu-btn.ghost{background:#EAF1EE;border-color:#cfe0f5;color:#1A211C}",
      "#" + BAR_ID + " .mlsnu-btn.ghost:hover{background:#e0ecfb}",
      "#" + BAR_ID + " input.mlsnu-date{border:1px solid #cfe0f5;border-radius:8px;padding:4px 8px;",
      "font-size:12px;color:#1A211C;font-family:inherit;background:#fff;cursor:pointer}"
    ].join("");
    var s = document.createElement("style");
    s.id = STYLE_ID;
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- is the blue NEXT UP currently on screen? ---- */
  function heroVisible() {
    try {
      var h = $(HERO);
      if (!h) return false;
      if (getComputedStyle(h).display === "none") return false;
      return true;
    } catch (e) { return false; }
  }

  /* ---- reassert ONLY today's patients on the blue cards, from the shared source ---- */
  function setToday() {
    _scope = "today";
    var P = pick();
    try {
      if (P && typeof P.scopeList === "function" && typeof window._renderTodayPatients === "function") {
        var r = P.scopeList("today");
        if (r && r.list) {
          window._heroTodayList = r.list;       /* the one shared source's today set */
          window._heroWinOff = 0;
          window._heroSelIdx = -1;
          window._renderTodayPatients(r.list);
        }
      }
    } catch (e) {}
    paintActive();
  }

  /* ---- "pick any day": open the shared picker scoped to the chosen date ---- */
  function pickDay(key) {
    if (!key) return;
    var P = pick();
    try {
      if (P && typeof P.openModal === "function") { P.openModal({ scope: "date:" + key }); return; }
    } catch (e) {}
    /* fallback: render the day's full list inline through the picker's own grid */
    try {
      if (P && typeof P.renderGrid === "function") {
        var host = ensureFallbackHost();
        if (host) P.renderGrid(host, { scope: "date:" + key, limit: 6 });
      }
    } catch (e) {}
  }

  /* ---- "Show more": reveal the FULL day's list (shared picker modal) ---- */
  function showFull() {
    var P = pick();
    try {
      if (P && typeof P.openModal === "function") { P.openModal({ scope: _scope || "today" }); return; }
    } catch (e) {}
    try {
      if (P && typeof P.renderGrid === "function") {
        var host = ensureFallbackHost();
        if (host) { host.__mlspkExpanded = true; P.renderGrid(host, { scope: _scope || "today", limit: 6 }); }
      }
    } catch (e) {}
  }

  /* fallback inline host (only used if the picker modal is unavailable) */
  function ensureFallbackHost() {
    var bar = $(BAR_ID); if (!bar) return null;
    var h = document.getElementById("mlsNuFallback");
    if (!h) { h = document.createElement("div"); h.id = "mlsNuFallback"; h.style.cssText = "width:100%;margin-top:8px"; bar.parentNode.insertBefore(h, bar.nextSibling); }
    return h;
  }

  function paintActive() {
    var bar = $(BAR_ID); if (!bar) return;
    var t = bar.querySelector('[data-mlsnu="today"]');
    if (t) t.classList.toggle("on", _scope === "today");
  }

  /* ---- build / keep the control bar mounted next to the blue NEXT UP ---- */
  function mountBar() {
    if (!heroVisible()) { var ex = $(BAR_ID); if (ex) ex.style.display = "none"; return; }
    var hero = $(HERO); if (!hero || !hero.parentNode) return;
    var bar = $(BAR_ID);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = BAR_ID;
      bar.setAttribute("data-mls-asset", "feat_mls_nextup_controls.js");
      bar.innerHTML =
        '<span class="mlsnu-lbl">Schedule:</span>' +
        '<button type="button" class="mlsnu-btn on" data-mlsnu="today">Today</button>' +
        '<input type="date" class="mlsnu-date" data-mlsnu="day" aria-label="Pick any day">' +
        '<button type="button" class="mlsnu-btn ghost" data-mlsnu="more">Show more &#8594;</button>';
      /* place the bar directly UNDER the blue NEXT UP cards */
      if (hero.nextSibling) hero.parentNode.insertBefore(bar, hero.nextSibling);
      else hero.parentNode.appendChild(bar);
      /* bind */
      try {
        bar.querySelector('[data-mlsnu="today"]').addEventListener("click", function () { setToday(); });
        var di = bar.querySelector('[data-mlsnu="day"]');
        di.value = todayKey();
        di.addEventListener("change", function () { pickDay(this.value); });
        bar.querySelector('[data-mlsnu="more"]').addEventListener("click", function () { showFull(); });
      } catch (e) {}
    } else if (bar.previousSibling !== hero) {
      /* keep it pinned right after the hero if the DOM reflowed */
      try { if (hero.nextSibling) hero.parentNode.insertBefore(bar, hero.nextSibling); else hero.parentNode.appendChild(bar); } catch (e) {}
    }
    bar.style.display = "";
    paintActive();
  }

  /* ---- lifecycle ---- */
  var _obs = null, _t = null, _poll = null;
  function tick() { injectCSS(); mountBar(); }
  function boot() {
    injectCSS();
    tick();
    try {
      _obs = new MutationObserver(function () { if (_t) return; _t = setTimeout(function () { _t = null; tick(); }, 200); });
      _obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    /* safety net for late hero mounts */
    try { _poll = setInterval(tick, 1500); } catch (e) {}
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_poll) { clearInterval(_poll); _poll = null; } } catch (e) {}
    try { var b = $(BAR_ID); if (b) b.remove(); } catch (e) {}
    try { var f = document.getElementById("mlsNuFallback"); if (f) f.remove(); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}   /* removing the style re-shows the white list */
    try { window.__mlsNuCtl.installed = false; } catch (e) {}
  }

  window.__mlsNuCtl = {
    installed: true, version: VERSION,
    setToday: setToday, pickDay: pickDay, showFull: showFull,
    reapply: boot, revert: revert
  };

  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
