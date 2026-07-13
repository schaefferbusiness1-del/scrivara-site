/* feat_mls_pick_smartscope.js  ->  window.__mlsPickSmartScope  (v1.0.0)  [item52]
 *
 * FIX #1 -- the patient picker (the row/grid of selectable patient cards) used to
 * VANISH after a schedule pull and on any day that has no appointments dated for the
 * literal calendar "today".
 *
 * ROOT CAUSE (verified live on mlsscribe.com/ScribeFlow.html, 2026-06-29):
 *   feat_mls_patientpick.js (window.__mlsPick) renders its inline Complex-view grid
 *   (#mlsPickComplexWrap) with a HARDCODED scope of "today". When the schedule pull
 *   files each appointment on ITS OWN clinic day (_importPulledSchedule:
 *   _normDate(a.date) || fallbackDate), the freshly-pulled patients almost never land
 *   on the literal "today" -> scopeList("today") returns 0 -> the grid paints its
 *   empty state -> the picker appears to disappear. Confirmed: today had 0 appts while
 *   500 real appts existed on recent clinic days (scopeList("recent") = 122).
 *
 * THE FIX (additive, reversible, no source edit of the original):
 *   - Hide ONLY the original inline grid container (#mlsPickComplexWrap) via a CSS
 *     !important rule (its inline display="" cannot override it -> zero JS tug-of-war;
 *     the original modal + #mlsCtxBar pinning keep working untouched).
 *   - Render an identical-looking grid into our OWN host using the original's PUBLIC,
 *     battle-tested renderer window.__mlsPick.renderGrid(host, {...}) -- same cards,
 *     same single-click select, same now/next advance -- but with a SMART scope:
 *       smartScope() = "today" when today actually has patients, otherwise "recent"
 *       (the most recent clinic day that has appointments -- i.e. the day just pulled).
 *   - Re-render after every schedule pull by wrapping window._importPulledSchedule
 *     (same chokepoint feat_mls_centerpiece.js uses), plus an observer + light timer,
 *     so the picker is ALWAYS present after a pull with the pulled patients selectable.
 *
 * SAFETY: read-only; never writes a chart, never touches athenaOne, never deletes or
 * mutates any patient/appointment record; no PHI logged or sent. ASCII-only. Idempotent.
 * Gated exactly like __mlsPick (only acts when __mlsPick is installed). Reversible:
 * window.__mlsPickSmartScope.revert() removes our host/CSS/observer and unhides the
 * original inline grid.
 */
;(function () {
  "use strict";

  var VERSION = "1.0.0";
  var ASSET = "feat_mls_pick_smartscope.js";
  var WRAP_ID = "mlsPickSmartWrap";
  var STYLE_ID = "mlsPickSmartStyle";

  try { if (window.__mlsPickSmartScope && window.__mlsPickSmartScope.installed) return; } catch (e) { return; }

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function pickApi() { try { return (window.__mlsPick && window.__mlsPick.installed === true) ? window.__mlsPick : null; } catch (e) { return null; } }

  /* show only in the Complex visit view (mirror of the original onVisitComplex) */
  function onVisitComplex() {
    try {
      var v = $("visitView");
      if (!v || getComputedStyle(v).display === "none") return false;
      return !document.documentElement.classList.contains("mls-sv-active");
    } catch (e) { return false; }
  }

  function scopeCount(scope) {
    var api = pickApi(); if (!api) return 0;
    try { var r = api.scopeList(scope); return (r && r.list && r.list.length) ? r.list.length : 0; }
    catch (e) { return 0; }
  }
  /* today when today has patients, otherwise the most recent clinic day that has any
     (this is exactly the day a pull just landed on) -> the picker never goes blank
     just because nothing is dated for the literal calendar "today". */
  function smartScope() { return scopeCount("today") > 0 ? "today" : "recent"; }

  function injectCSS() {
    var css = [
      "#mlsPickComplexWrap{display:none!important}",
      "#" + WRAP_ID + "{margin:0 0 18px;font-family:'Plus Jakarta Sans',system-ui,sans-serif;max-width:100%;overflow:hidden;box-sizing:border-box}",
      "#" + WRAP_ID + " .mlspk-grid{grid-template-columns:repeat(3,minmax(0,1fr))}",
      "@media(max-width:900px){#" + WRAP_ID + " .mlspk-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}",
      "@media(max-width:560px){#" + WRAP_ID + " .mlspk-grid{grid-template-columns:minmax(0,1fr)}}",
      "#" + WRAP_ID + " .mlsps-cx-hd{display:flex;align-items:baseline;gap:10px;margin:0 0 10px}",
      "#" + WRAP_ID + " .mlsps-cx-hd h4{font-family:'Newsreader',Georgia,serif;font-weight:500;font-size:19px;margin:0;color:#1A211C}",
      "#" + WRAP_ID + " .mlsps-cx-hd span{font-size:12px;color:#8a9cb2}",
      "html.mls-sv-active #" + WRAP_ID + "{display:none!important}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = document.createElement("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  function ensureHost() {
    var v = $("visitView"); if (!v) return null;
    var w = $(WRAP_ID);
    if (!w || w.parentElement !== v) {
      if (w) { try { w.parentElement.removeChild(w); } catch (e) {} }
      w = document.createElement("div");
      w.id = WRAP_ID;
      w.setAttribute("data-mls-asset", ASSET);
      w.innerHTML =
        '<div class="mlsps-cx-hd"><h4>Today&#39;s patients</h4>' +
        '<span>in time order &middot; tap one to open their chart</span></div>' +
        '<div class="mlsps-host"></div>';
      var hero = $("visitHero");
      if (hero && hero.parentElement === v && hero.nextSibling) v.insertBefore(w, hero.nextSibling);
      else if (hero && hero.parentElement === v) v.appendChild(w);
      else v.insertBefore(w, v.firstChild);
    }
    return w;
  }

  function render() {
    var api = pickApi(); if (!api || typeof api.renderGrid !== "function") return;
    injectCSS();
    if (!onVisitComplex()) { var w0 = $(WRAP_ID); if (w0) w0.style.display = "none"; return; }
    var w = ensureHost(); if (!w) return;
    w.style.display = "";
    var host = w.querySelector(".mlsps-host"); if (!host) return;
    try { api.renderGrid(host, { scope: smartScope(), limit: 6, showNote: true }); } catch (e) {}
  }

  /* ---- re-render after a schedule pull (same chokepoint centerpiece uses) ---- */
  var _wrapped = false, _origImport = null, _reverted = false, _timers = [];
  function schedule(fn, ms) { var t = setTimeout(function () { try { fn(); } catch (e) {} }, ms || 0); _timers.push(t); return t; }
  function wrapImport() {
    try {
      if (_wrapped) return;
      if (typeof window._importPulledSchedule !== "function") return;
      if (window._importPulledSchedule.__pssWrapped) { _wrapped = true; return; }
      _origImport = window._importPulledSchedule;
      var f = function () {
        var r; try { r = _origImport.apply(this, arguments); } catch (e) { r = undefined; }
        if (!_reverted) { schedule(render, 900); schedule(render, 1900); schedule(render, 3200); }
        return r;
      };
      f.__pssWrapped = true;
      window._importPulledSchedule = f;
      _wrapped = true;
    } catch (e) {}
  }

  /* ---- keep present without flicker (observer coalesced via rAF) + slow safety poll ---- */
  var _obs = null, _raf = 0, _poll = null;
  function scheduleRender() {
    if (_raf) return;
    var run = function () { _raf = 0; try { render(); } catch (e) {} };
    if (window.requestAnimationFrame) _raf = window.requestAnimationFrame(run); else _raf = setTimeout(run, 16);
  }
  function boot() {
    if (!pickApi()) return false;
    injectCSS();
    wrapImport();
    render();
    try {
      _obs = new MutationObserver(function () { scheduleRender(); });
      _obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    _poll = setInterval(function () { try { wrapImport(); render(); } catch (e) {} }, 4000);
    try { [250, 700, 1500, 3000, 5000].forEach(function (ms) { setTimeout(render, ms); }); } catch (e) {}
    return true;
  }

  function revert() {
    _reverted = true;
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_poll) clearInterval(_poll); } catch (e) {}
    try { _timers.forEach(function (t) { clearTimeout(t); }); } catch (e) {}
    try { if (_origImport && window._importPulledSchedule && window._importPulledSchedule.__pssWrapped) window._importPulledSchedule = _origImport; } catch (e) {}
    try { var w = $(WRAP_ID); if (w) w.remove(); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { if (window.__mlsPick && typeof window.__mlsPick.reapply === "function") window.__mlsPick.reapply(); } catch (e) {}
    try { window.__mlsPickSmartScope.installed = false; } catch (e) {}
  }

  window.__mlsPickSmartScope = {
    installed: true, version: VERSION, asset: ASSET,
    smartScope: smartScope, render: render, reapply: boot, revert: revert
  };

  /* the base picker may load slightly after us; retry boot until it's present */
  (function start() {
    try {
      if (boot()) return;
      var tries = 0;
      var iv = setInterval(function () {
        tries++;
        if (boot() || tries > 40) { clearInterval(iv); }
      }, 500);
    } catch (e) {}
  })();
})();
