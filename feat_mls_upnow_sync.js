/* feat_mls_upnow_sync.js  ->  window.__mlsUpNowSync  (upnowsync-1.0.0)
 *
 *  BUG (Complex Visit page)
 *  ------------------------
 *  The TOP active patient -- the #heroPtName field + the "Up now: <name> ...
 *  loaded & ready" banner (#heroPullStatus) -- and the highlighted "UP NOW" card
 *  in the blue NEXT UP section (#heroToday) could DISAGREE (e.g. top shows
 *  "Thomas B." while the highlighted card is "Cheryl W.").
 *
 *  ROOT CAUSE
 *  ----------
 *  Two independent "who is up now" calculations:
 *    - TOP / banner: _calLoadNextUp() picks via _calPickNowIdx(appts) over the
 *      FULL today list (window._heroTodayList) and sets #heroPtName + the banner.
 *    - NEXT UP highlight: _renderTodayPatients() picks via _heroAutoPos(pending)
 *      over the UNSEEN-ONLY subset -- a different list / index space.
 *  When any patient has been seen, or the time-window logic differs, the two
 *  point at different appointments, so top and highlight diverge. (Manual card
 *  clicks go through _heroPickPatient, which sets BOTH, so that path is fine.)
 *
 *  FIX (additive, reversible, one source of truth)
 *  -----------------------------------------------
 *  Single source of truth = the active TOP patient (the name in #heroPtName,
 *  which the "Up now" banner reflects). After every NEXT UP render, this module
 *  makes the highlighted card match that top patient; and whenever the top
 *  patient changes (load / advance / any path that sets #heroPtName) it re-asserts
 *  the highlight. The reverse direction already holds: clicking a NEXT UP card
 *  runs _heroPickPatient, which sets the top to that patient and re-renders, after
 *  which top == highlight (this module is then a no-op for that paint).
 *
 *  HOW
 *  ---
 *  - Wraps window._renderTodayPatients: runs the app's original render unchanged,
 *    then re-points the highlight to the top patient's card.
 *  - Watches #heroPtName (input) + a light interval, and a guarded MutationObserver
 *    on #heroToday, so the highlight tracks the top even if a paint happens without
 *    a name change (or a name change without a paint).
 *  - Highlight transfer is pure presentation: it moves the "UP NOW" label + the
 *    white "current" chip styling from whichever card the app marked to the card
 *    whose name matches the top. It maps a card to its appointment via the index in
 *    its existing onclick="_heroPickPatient(N)" -> window._heroTodayList[N].name.
 *    If the matching card is outside the visible 5-card window, it sets
 *    window._heroSelIdx to that index and re-renders once so the app brings it into
 *    view (guarded against recursion).
 *
 *  SAFETY
 *  ------
 *  Additive. Idempotent. Fully reversible via window.__mlsUpNowSync.revert()
 *  (restores the original _renderTodayPatients, disconnects observers, repaints
 *  natively). It never pulls athenaOne, never clicks Save/Sign/Submit, never writes
 *  a chart, sends NOTHING to the extension. It only re-styles existing cards and
 *  drives the app's own renderer. No PHI is read, logged, or sent anywhere -- patient
 *  names are read from the live DOM/app state purely to match top<->card and are
 *  never persisted or transmitted. ASCII-only. Runs on prod AND staging (the bug is
 *  in the core renderer, present everywhere), and degrades to a silent no-op if the
 *  hero/NEXT UP elements are absent.
 */
;(function () {
  "use strict";
  var VERSION = "upnowsync-1.0.0";
  try { if (window.__mlsUpNowSync && window.__mlsUpNowSync.installed) return; } catch (e) { return; }

  var HERO = "heroToday";
  var NAME_IN = "heroPtName";

  var LABEL_STYLE = "font-size:9.5px;font-weight:800;color:#1456a8;letter-spacing:.4px";
  var _busy = false;          /* guard: our own DOM writes / re-render */
  var _depth = 0;             /* guard: bounded re-render recursion */
  var _origRender = null;
  var _obs = null, _poll = null, _t = null;

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function norm(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  function heroBox() { return $(HERO); }
  function heroVisible() {
    try { var h = heroBox(); if (!h) return false; if (getComputedStyle(h).display === "none") return false; return true; }
    catch (e) { return false; }
  }
  function topName() { try { var n = $(NAME_IN); return n ? norm(n.value) : ""; } catch (e) { return ""; } }

  function chipNodes() {
    var box = heroBox(); if (!box) return [];
    try { return Array.prototype.slice.call(box.querySelectorAll('button[onclick^="_heroPickPatient("]')); }
    catch (e) { return []; }
  }
  function chipIdx(chip) {
    try {
      var oc = chip.getAttribute("onclick") || "";
      var m = oc.match(/_heroPickPatient\((\d+)\)/);
      return m ? parseInt(m[1], 10) : -1;
    } catch (e) { return -1; }
  }
  function firstChildIsLabel(chip) {
    try {
      var c = chip.firstElementChild;
      return !!(c && c.tagName === "SPAN" && /^\s*●/.test(c.textContent || ""));
    } catch (e) { return false; }
  }

  /* make a chip look "current" (white) or not, managing the leading label span */
  function setCurrent(chip, on) {
    if (!chip) return;
    try {
      if (on) {
        chip.style.background = "#fff";
        chip.style.border = "2px solid #fff";
        chip.style.color = "#1456a8";
        chip.style.boxShadow = "0 2px 12px rgba(0,0,0,.20)";
        if (!firstChildIsLabel(chip)) {
          var lab = document.createElement("span");
          lab.setAttribute("style", LABEL_STYLE);
          lab.setAttribute("data-mls-upnow-label", "1");
          lab.textContent = "● UP NOW";
          chip.insertBefore(lab, chip.firstChild);
        }
      } else {
        chip.style.background = "rgba(255,255,255,.15)";
        chip.style.border = "2px solid rgba(255,255,255,.30)";
        chip.style.color = "#fff";
        chip.style.boxShadow = "none";
        if (firstChildIsLabel(chip)) { try { chip.removeChild(chip.firstElementChild); } catch (e) {} }
      }
    } catch (e) {}
  }

  /* core: make the highlighted card agree with the top patient */
  function sync() {
    if (_busy) return;
    if (!heroVisible()) return;
    var tn = topName(); if (!tn) return;
    var list = (window._heroTodayList || []);
    var targetIdx = -1;
    for (var i = 0; i < list.length; i++) { if (norm((list[i] || {}).name) === tn) { targetIdx = i; break; } }
    if (targetIdx < 0) return;                     /* top isn't one of today's cards (e.g. tomorrow / typed) */

    var chips = chipNodes(); if (!chips.length) return;
    var cur = null, target = null, j;
    for (j = 0; j < chips.length; j++) {
      if (firstChildIsLabel(chips[j])) cur = chips[j];
      if (chipIdx(chips[j]) === targetIdx) target = chips[j];
    }

    if (!target) {
      /* matching card is outside the visible window -> ask the app to window onto it */
      if (_depth >= 2) return;
      _busy = true; _depth++;
      try {
        window._heroSelIdx = targetIdx;
        window._heroWinOff = 0;
        if (typeof _origRender === "function") _origRender(window._heroTodayList || []);
      } catch (e) {}
      _busy = false;
      try { sync(); } catch (e) {}     /* re-run now that the card should be in view */
      _depth = 0;
      return;
    }

    if (target === cur) return;        /* already in sync */

    _busy = true;
    try { if (cur) setCurrent(cur, false); setCurrent(target, true); } catch (e) {}
    _busy = false;
  }

  function scheduleSync() {
    if (_t) return;
    _t = setTimeout(function () { _t = null; try { sync(); } catch (e) {} }, 60);
  }

  function wrapRender() {
    try {
      if (typeof window._renderTodayPatients !== "function") return false;
      if (window._renderTodayPatients.__mlsUpNowWrapped) return true;
      _origRender = window._renderTodayPatients;
      var wrapped = function () {
        var r = _origRender.apply(this, arguments);
        if (!_busy) { try { sync(); } catch (e) {} }
        return r;
      };
      wrapped.__mlsUpNowWrapped = true;
      window._renderTodayPatients = wrapped;
      return true;
    } catch (e) { return false; }
  }

  function boot() {
    var ok = wrapRender();
    /* retry the wrap if the renderer isn't defined yet */
    if (!ok) { try { setTimeout(boot, 800); } catch (e) {} }

    try {
      var nm = $(NAME_IN);
      if (nm && !nm.__mlsUpNowBound) { nm.addEventListener("input", scheduleSync); nm.__mlsUpNowBound = true; }
    } catch (e) {}

    try {
      _obs = new MutationObserver(function () { if (_busy) return; scheduleSync(); });
      var box = heroBox();
      _obs.observe(box || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}

    /* safety net: late mounts, name set without a render, hero re-created */
    try { _poll = setInterval(function () { if (!window._renderTodayPatients || !window._renderTodayPatients.__mlsUpNowWrapped) wrapRender(); try { var nm = $(NAME_IN); if (nm && !nm.__mlsUpNowBound) { nm.addEventListener("input", scheduleSync); nm.__mlsUpNowBound = true; } } catch (e) {} sync(); }, 1500); } catch (e) {}

    try { sync(); } catch (e) {}
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_poll) { clearInterval(_poll); _poll = null; } } catch (e) {}
    try { if (_t) { clearTimeout(_t); _t = null; } } catch (e) {}
    try {
      if (_origRender && window._renderTodayPatients && window._renderTodayPatients.__mlsUpNowWrapped) {
        window._renderTodayPatients = _origRender;
        try { window._renderTodayPatients(window._heroTodayList || []); } catch (e) {}  /* repaint natively */
      }
    } catch (e) {}
    try { window.__mlsUpNowSync.installed = false; } catch (e) {}
  }

  window.__mlsUpNowSync = {
    installed: true, version: VERSION,
    sync: function () { try { sync(); } catch (e) {} },
    reapply: boot, revert: revert
  };

  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
