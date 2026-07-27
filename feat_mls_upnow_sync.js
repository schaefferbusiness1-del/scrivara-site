/* feat_mls_upnow_sync.js  ->  window.__mlsUpNowSync  (upnowsync-1.1.0)
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
 *  Two independent "who is up now" calculations over an inconsistent list:
 *    - TOP / banner: _calLoadNextUp() picks via _calPickNowIdx(appts) over the
 *      FULL today list (window._heroTodayList) -> #heroPtName + the banner.
 *    - NEXT UP highlight: _renderTodayPatients() picks via _heroAutoPos(pending)
 *      over the UNSEEN-ONLY subset.
 *  In live data the same person can appear twice in _heroTodayList: a "clean"
 *  entry ("Thomas B.") and an appointment-code entry ("Cheryl W. EP10"). The top
 *  may land on a clean/stale entry that has NO card in NEXT UP, while the cards
 *  render the code entries -> top and highlight name different people. (Manual
 *  card clicks go through _heroPickPatient, which sets BOTH, so that path is fine.)
 *
 *  FIX (additive, reversible, one source of truth)
 *  -----------------------------------------------
 *  One current patient, matched by PERSON (appointment-code suffix ignored):
 *    1. If the TOP patient has a NEXT UP card -> move the highlight to that card
 *       (the top is authoritative: "when the top loads/advances, the highlight
 *       matches it").
 *    2. If the TOP patient's card is just outside the visible window -> ask the
 *       app to window onto it (set _heroSelIdx, re-render once), then highlight.
 *    3. If the TOP patient has NO card at all (a stale duplicate) -> adopt the
 *       currently-highlighted card into the TOP field + banner, so both agree on a
 *       real, tappable patient.
 *  Reverse direction already holds: clicking a NEXT UP card runs _heroPickPatient,
 *  which sets the top to that patient and re-renders; this module then sees
 *  agreement and is a no-op.
 *
 *  HOW
 *  ---
 *  - Wraps window._renderTodayPatients (original render runs unchanged, then sync).
 *  - Watches #heroPtName (input), a guarded MutationObserver on #heroToday, and a
 *    light interval, so the highlight tracks the top through any path.
 *  - Person match: strip a trailing appointment-code token (e.g. " EP10", " PO20",
 *    " VSC1") and a trailing initial dot, then compare case-insensitively. A card
 *    maps to its appointment via the index in its existing
 *    onclick="_heroPickPatient(N)" -> window._heroTodayList[N].
 *
 *  SAFETY
 *  ------
 *  Additive. Idempotent. Fully reversible via window.__mlsUpNowSync.revert()
 *  (restores the original _renderTodayPatients, disconnects observers, repaints
 *  natively). Never pulls athenaOne, never clicks Save/Sign/Submit, never writes a
 *  chart, sends NOTHING to the extension. It only re-styles existing cards, sets the
 *  visible name field/banner to a card the app itself surfaced, and drives the app's
 *  own renderer. It does NOT create or persist patient records (no upsertPatient /
 *  setActivePtId). No PHI is logged or transmitted -- names are read from live app
 *  state purely to match top<->card. ASCII source. Runs on prod AND staging (the bug
 *  is in the core renderer), and is a silent no-op if the hero/NEXT UP elements are
 *  absent.
 */
;(function () {
  "use strict";
  var VERSION = "upnowsync-1.2.0";
  try { if (window.__mlsUpNowSync && window.__mlsUpNowSync.installed && window.__mlsUpNowSync.version === VERSION) return; } catch (e) { return; }
  try { if (window.__mlsUpNowSync && window.__mlsUpNowSync.installed && window.__mlsUpNowSync.revert) { window.__mlsUpNowSync.revert(); } } catch (e) {}

  var HERO = "heroToday";
  var NAME_IN = "heroPtName";
  var DOB_IN = "heroPtDob";
  var BANNER = "heroPullStatus";

  var LABEL_STYLE = "font-size:9.5px;font-weight:800;color:#204034;letter-spacing:.4px";
  var _busy = false;          /* guard: our own DOM writes / re-render */
  var _depth = 0;             /* guard: bounded re-render recursion */
  var _origRender = null;
  var _obs = null, _poll = null, _t = null;
  var _chartCap = null;       /* capture-phase Chart-button interceptor */

  /* ---------------------------------------------------------------------------
   * CHART BUTTON FIX (same single-source-of-truth domain)
   * The patient-bar (#mlsCtxBar) Chart button is wired in renderInto() as
   *   b.onclick = function(){ if (act==='chart') openChart(id); }
   * where `id` is a CLOSURE captured at render time. When the active patient is
   * changed via the schedule "Select" path, the bar's name/meta re-renders but the
   * onclick closure can lag (the heartbeat re-render is throttled by
   * ctxbar-stabilize's idempotent-innerHTML guard), so openChart(id) ->
   * openPatient(id) opens/activates the STALE patient -- the wrong chart.
   * Fix: intercept the Chart click in the CAPTURE phase and route it through the
   * ONE active-patient source of truth (getActivePtId at click time), pre-empting
   * the stale closure. Schedule reads activePt() live (already correct);
   * Visit/History carry no id. Additive, reversible.
   * ------------------------------------------------------------------------- */
  function chartCapHandler(e) {
    try {
      var t = e && e.target;
      if (!t || !t.closest) return;
      /* b742: the banner rework deleted the action row this used to match, and
         the NAME is now the chart link. The bar's own handler already reads
         getActivePtId() at click time, so this interceptor is belt-and-braces
         rather than the only guard — but it must still match, or a future
         renderer that reintroduces a captured id would silently reopen the
         stale-closure bug with nothing watching. Match any chart control in
         the bar, wherever it lives. */
      var btn = t.closest('#mlsCtxBar [data-act="chart"]');
      if (!btn) return;
      var id = (typeof window.getActivePtId === "function") ? window.getActivePtId() : null;
      if (!id) return;                       /* no active patient -> let the app's default run */
      e.stopImmediatePropagation();          /* pre-empt the stale-closure onclick */
      e.preventDefault();
      if (typeof window.openPatient === "function") window.openPatient(id);   /* active = the ONE source of truth */
      else if (typeof window.setActivePtId === "function") window.setActivePtId(id);
      if (typeof window.showView === "function") window.showView("patients");  /* open the chart view */
    } catch (err) {}
  }
  function installChartFix() {
    try { if (_chartCap) return; _chartCap = chartCapHandler; document.addEventListener("click", _chartCap, true); } catch (e) {}
  }
  function uninstallChartFix() {
    try { if (_chartCap) { document.removeEventListener("click", _chartCap, true); _chartCap = null; } } catch (e) {}
  }

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function lc(s) { return String(s == null ? "" : s).trim().toLowerCase(); }
  /* person identity: drop a trailing appointment-code token + a trailing dot */
  function person(s) {
    s = String(s == null ? "" : s).trim();
    s = s.replace(/\s+[A-Z]{2,}\d+\.?$/, "");   /* e.g. " EP10", " PO20", " VSC1", " NP20" */
    return lc(s).replace(/\.+$/, "").trim();
  }
  function escHtml(s) {
    try { if (typeof window.esc === "function") return window.esc(s); } catch (e) {}
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function heroBox() { return $(HERO); }
  function heroVisible() {
    try { var h = heroBox(); if (!h) return false; if (getComputedStyle(h).display === "none") return false; return true; }
    catch (e) { return false; }
  }
  function topVal() { try { var n = $(NAME_IN); return n ? (n.value || "") : ""; } catch (e) { return ""; } }

  function chipNodes() {
    var box = heroBox(); if (!box) return [];
    try { return Array.prototype.slice.call(box.querySelectorAll('button[onclick^="_heroPickPatient("]')); }
    catch (e) { return []; }
  }
  function chipIdx(chip) {
    try {
      var m = (chip.getAttribute("onclick") || "").match(/_heroPickPatient\((\d+)\)/);
      return m ? parseInt(m[1], 10) : -1;
    } catch (e) { return -1; }
  }
  function nameAt(k) { try { return ((window._heroTodayList || [])[k] || {}).name || ""; } catch (e) { return ""; } }
  function chipPerson(chip) { return person(nameAt(chipIdx(chip))); }
  function firstChildIsLabel(chip) {
    try { var c = chip.firstElementChild; return !!(c && c.tagName === "SPAN" && /^\s*●/.test(c.textContent || "")); }
    catch (e) { return false; }
  }

  /* make a chip look "current" (white) or not, managing the leading label span */
  function setCurrent(chip, on) {
    if (!chip) return;
    try {
      if (on) {
        chip.style.background = "#fff";
        chip.style.border = "2px solid #fff";
        chip.style.color = "#204034";
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

  /* set the TOP field + banner to a card the app itself surfaced (no persistence) */
  function adoptTopFromChip(chip) {
    var k = chipIdx(chip); if (k < 0) return;
    var a = (window._heroTodayList || [])[k] || {};
    if (!a.name) return;
    try { var nm = $(NAME_IN); if (nm) nm.value = a.name; } catch (e) {}
    try { var db = $(DOB_IN); if (db && a.dob) db.value = a.dob; } catch (e) {}
    try { window._heroSelIdx = k; } catch (e) {}
    try { if (typeof window._heroSyncName === "function") window._heroSyncName(); } catch (e) {}
    try {
      var el = $(BANNER);
      if (el) {
        var t = "";
        try { if (typeof window._fmtApptTime === "function") t = window._fmtApptTime(a.time || ""); } catch (e) {}
        el.innerHTML = "⏰ Up now: <b>" + escHtml(a.name) + "</b>" + (t ? (" at " + escHtml(t)) : "") +
          " — loaded &amp; ready. Hit 🎙️ Start recording.";
        el.style.display = "block";
      }
    } catch (e) {}
  }

  /* core: make the highlighted card and the top patient name the SAME person */
  function sync() {
    if (_busy) return;
    if (!heroVisible()) return;
    var chips = chipNodes(); if (!chips.length) return;

    var cur = null, j;
    for (j = 0; j < chips.length; j++) { if (firstChildIsLabel(chips[j])) { cur = chips[j]; break; } }

    var tp = person(topVal());

    if (tp) {
      /* 1) top patient has a rendered card -> move highlight there (top wins) */
      var target = null;
      for (j = 0; j < chips.length; j++) { if (chipPerson(chips[j]) === tp) { target = chips[j]; break; } }
      if (target) {
        if (target === cur) return;          /* already in sync */
        _busy = true;
        try { if (cur) setCurrent(cur, false); setCurrent(target, true); } catch (e) {}
        _busy = false;
        return;
      }

      /* 2) top patient's card may be outside the visible window -> window onto it */
      if (_depth < 1) {
        var list = window._heroTodayList || [], li = -1;
        for (j = 0; j < list.length; j++) {
          var nm = (list[j] || {}).name || "";
          if (person(nm) === tp && /\s+[A-Z]{2,}\d+\.?$/.test(nm)) { li = j; break; }  /* a real appt card */
        }
        if (li >= 0) {
          _busy = true; _depth++;
          try {
            window._heroSelIdx = li; window._heroWinOff = 0;
            if (typeof _origRender === "function") _origRender(window._heroTodayList || []);
          } catch (e) {}
          _busy = false;
          try { sync(); } catch (e) {}
          _depth = 0;
          return;
        }
      }
      /* 3) top patient has no card at all -> fall through to adopt the highlight */
    }

    /* 3) adopt: make the TOP follow the highlighted card so both agree */
    if (cur && chipPerson(cur) !== tp) {
      _busy = true;
      try { adoptTopFromChip(cur); } catch (e) {}
      _busy = false;
    }
  }

  function scheduleSync() {
    if (_t) return;
    _t = setTimeout(function () { _t = null; try { sync(); } catch (e) {} }, 60);
  }

  function wrapRender() {
    try {
      if (typeof window._renderTodayPatients !== "function") return false;
      if (window._renderTodayPatients.__mlsUpNowWrapped) { _origRender = _origRender || window._renderTodayPatients.__mlsUpNowOrig; return true; }
      _origRender = window._renderTodayPatients;
      var wrapped = function () {
        var r = _origRender.apply(this, arguments);
        if (!_busy) { try { sync(); } catch (e) {} }
        return r;
      };
      wrapped.__mlsUpNowWrapped = true;
      wrapped.__mlsUpNowOrig = _origRender;
      window._renderTodayPatients = wrapped;
      return true;
    } catch (e) { return false; }
  }

  function bindName() {
    try { var nm = $(NAME_IN); if (nm && !nm.__mlsUpNowBound) { nm.addEventListener("input", scheduleSync); nm.__mlsUpNowBound = true; } } catch (e) {}
  }

  function boot() {
    var ok = wrapRender();
    if (!ok) { try { setTimeout(boot, 800); } catch (e) {} }
    bindName();
    installChartFix();
    try {
      _obs = new MutationObserver(function () { if (_busy) return; scheduleSync(); });
      _obs.observe(heroBox() || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    try {
      _poll = setInterval(function () {
        if (!window._renderTodayPatients || !window._renderTodayPatients.__mlsUpNowWrapped) wrapRender();
        bindName(); try { sync(); } catch (e) {}
      }, 1500);
    } catch (e) {}
    try { sync(); } catch (e) {}
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_poll) { clearInterval(_poll); _poll = null; } } catch (e) {}
    try { if (_t) { clearTimeout(_t); _t = null; } } catch (e) {}
    uninstallChartFix();
    try {
      if (_origRender && window._renderTodayPatients && window._renderTodayPatients.__mlsUpNowWrapped) {
        window._renderTodayPatients = _origRender;
        try { window._renderTodayPatients(window._heroTodayList || []); } catch (e) {}
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
