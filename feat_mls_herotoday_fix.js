/* feat_mls_herotoday_fix.js  ->  window.__mlsHeroToday  (v1.0.0)  [item53]
 *
 * FIX #1 (correct surface) + #3 (one source of truth into the picker / Up-now).
 *
 * Michael's note: the REAL patient picker is the "NEXT UP" strip inside the BLUE hero
 * (#heroToday), not a separate white grid. Two things were breaking it:
 *
 *  A) INFINITE RECURSION (the real "it's not working"): feat_mls_upnow_realtime.js and
 *     feat_mls_upnow_sync.js each wrap window._renderTodayPatients. On a re-boot,
 *     upnow_realtime overwrote its single module-level _origRender to point at
 *     upnow_sync's wrapper, so at runtime the two wrappers call each other forever
 *     -> "Maximum call stack size exceeded" EVERY time _renderTodayPatients runs.
 *     _renderTodayPatients runs at the end of _importPulledSchedule (NOT in a try/catch),
 *     so every pull threw -> the blue NEXT-UP picker never rendered and the pull looked
 *     like it failed. The clean original is still reachable on the static .__mlsUnrOrig /
 *     .__mlsUpNowOrig chain; we restore it and mark it so neither buggy module re-wraps it.
 *
 *  B) WRONG SCOPE: #heroToday was only ever fed appts dated for the literal "today".
 *     We feed it from the unified calendar source (window._calAppts): today's patients
 *     when today has any, otherwise the most recent clinic day that does (the day a pull
 *     just landed on) -> the blue picker shows the pulled patients and never goes blank.
 *
 * Also retires the earlier white grid (item52 #mlsPickSmartWrap) and the original white
 * inline grid (#mlsPickComplexWrap) so the picker lives ONLY in the blue, as intended.
 *
 * SAFETY: read-only; no chart writes, no athenaOne writes, no record deletes/mutations;
 * no PHI logged. ASCII-only. Idempotent. Reversible: window.__mlsHeroToday.revert().
 */
;(function () {
  "use strict";
  var VERSION = "1.0.0", ASSET = "feat_mls_herotoday_fix.js", STYLE_ID = "mlsHeroTodayFixStyle";
  try { if (window.__mlsHeroToday && window.__mlsHeroToday.installed) return; } catch (e) { return; }

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }

  /* ---- A) restore a clean, non-recursive _renderTodayPatients ---- */
  function findClean() {
    var f = window._renderTodayPatients, seen = [], guard = 0;
    while (typeof f === "function" && guard++ < 60) {
      if (seen.indexOf(f) >= 0) break;            /* defensive: cycle in static chain */
      seen.push(f);
      var next = f.__mlsUnrOrig || f.__mlsUpNowOrig || null;
      if (!f.__mlsUnrGuard && !f.__mlsUpNowWrapped && !next) return f;   /* the true original */
      if (!next) return f;                        /* best effort: deepest reachable */
      f = next;
    }
    return null;
  }
  var _restored = false, _prevRender = null;
  function restoreRender() {
    try {
      var cur = window._renderTodayPatients;
      if (cur && cur.__mlsHtClean) return;        /* already ours */
      var R = findClean();
      if (typeof R !== "function") return;
      if (!_restored) { _prevRender = cur; _restored = true; }
      /* mark so upnow_realtime (checks __mlsUnrGuard) and upnow_sync (checks __mlsUpNowWrapped)
         both skip re-wrapping -> the recursion cannot re-form */
      try { R.__mlsUnrGuard = true; R.__mlsUpNowWrapped = true; R.__mlsHtClean = true; } catch (e) {}
      window._renderTodayPatients = R;
    } catch (e) {}
  }

  /* ---- B) smart list from the unified calendar source ---- */
  function dOf(a) { return a.appt_date || String(a.start_at || "").slice(0, 10); }
  function hhmm(a) {
    try { var d = new Date(a.start_at); if (!isNaN(d.getTime())) return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); } catch (e) {}
    return "";
  }
  function smartList() {
    var ap = window._calAppts || []; if (!ap.length) return [];
    var today = new Date().toISOString().slice(0, 10);
    var hasToday = ap.some(function (a) { return dOf(a) === today; });
    var day = today;
    if (!hasToday) { var ds = {}; ap.forEach(function (a) { var d = dOf(a); if (d) ds[d] = 1; }); var keys = Object.keys(ds).sort(); day = keys[keys.length - 1]; }
    if (!day) return [];
    var seen = {}, out = [];
    ap.filter(function (a) { return dOf(a) === day && String(a.name || "").trim(); })
      .sort(function (a, b) { return String(a.start_at || "").localeCompare(String(b.start_at || "")); })
      .forEach(function (a) { var k = (a.name || "").toLowerCase() + "|" + (a.dob || ""); if (seen[k]) return; seen[k] = 1; out.push({ name: a.name, dob: a.dob || "", reason: a.reason || "", time: hhmm(a), date: day }); });
    return out;
  }

  function onVisit() { try { return (typeof window.currentView === "undefined") || window.currentView === "visit"; } catch (e) { return true; } }

  function paint() {
    try {
      restoreRender();
      if (typeof window._renderTodayPatients !== "function") return;
      var hero = $("heroToday"); if (!hero) return;
      if (!onVisit()) return;
      var showing = getComputedStyle(hero).display !== "none" && hero.innerHTML.trim() !== "";
      if (showing) return;                         /* a real list is already up -> don't disturb */
      var list = smartList();
      if (list.length) { try { window._renderTodayPatients(list); } catch (e) {} }
    } catch (e) {}
  }

  /* ---- retire the white grids (picker lives in the blue only) ---- */
  function killWhite() {
    try { if (window.__mlsPickSmartScope && window.__mlsPickSmartScope.installed && typeof window.__mlsPickSmartScope.revert === "function") window.__mlsPickSmartScope.revert(); } catch (e) {}
    var s = $(STYLE_ID);
    if (!s) { s = document.createElement("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    var css = "#mlsPickComplexWrap{display:none!important}#mlsPickSmartWrap{display:none!important}";
    if (s.textContent !== css) s.textContent = css;
  }

  /* ---- re-render after a schedule pull (post-import) ---- */
  var _wrapped = false, _origImport = null, _reverted = false, _timers = [];
  function schedule(fn, ms) { var t = setTimeout(function () { try { fn(); } catch (e) {} }, ms || 0); _timers.push(t); return t; }
  function wrapImport() {
    try {
      if (_wrapped) return;
      if (typeof window._importPulledSchedule !== "function") return;
      if (window._importPulledSchedule.__htWrapped) { _wrapped = true; return; }
      _origImport = window._importPulledSchedule;
      var f = function () {
        restoreRender();                            /* ensure the inner _renderTodayPatients call won't recurse */
        var r; try { r = _origImport.apply(this, arguments); } catch (e) { r = undefined; }
        if (!_reverted) { schedule(paint, 800); schedule(paint, 1800); schedule(paint, 3200); }
        return r;
      };
      f.__htWrapped = true;
      window._importPulledSchedule = f;
      _wrapped = true;
    } catch (e) {}
  }

  var _obs = null, _poll = null;
  function boot() {
    restoreRender();
    killWhite();
    wrapImport();
    paint();
    try { _obs = new MutationObserver(function () { killWhite(); paint(); }); _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    _poll = setInterval(function () { try { restoreRender(); wrapImport(); killWhite(); paint(); } catch (e) {} }, 4000);
    try { [250, 700, 1500, 3000, 5000].forEach(function (ms) { setTimeout(function () { killWhite(); paint(); }, ms); }); } catch (e) {}
    return true;
  }

  function revert() {
    _reverted = true;
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_poll) clearInterval(_poll); } catch (e) {}
    try { _timers.forEach(function (t) { clearTimeout(t); }); } catch (e) {}
    try { if (_origImport && window._importPulledSchedule && window._importPulledSchedule.__htWrapped) window._importPulledSchedule = _origImport; } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}   /* unhides the white grids again */
    try { window.__mlsHeroToday.installed = false; } catch (e) {}
    /* note: the restored clean _renderTodayPatients is intentionally LEFT in place on revert
       (reinstating the recursive wrappers would only re-break it). */
  }

  window.__mlsHeroToday = {
    installed: true, version: VERSION, asset: ASSET,
    paint: paint, smartList: smartList, restoreRender: restoreRender, reapply: boot, revert: revert
  };

  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
