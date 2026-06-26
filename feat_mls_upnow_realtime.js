/* ============================================================================
 * feat_mls_upnow_realtime.js  ->  window.__mlsUpNowRealtime  (unr-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 36 -- "UP NOW" REAL-TIME HONESTY (additive, reversible)
 *
 * SYMPTOM
 *   The Complex Visit "Up now" banner (#heroPullStatus) and the NEXT UP
 *   highlight showed the FIRST appointment of the day (e.g. 7:30 AM) rather
 *   than the appointment matching the actual current time. When the clock is
 *   already past every appointment (end of day), it still surfaced an early
 *   patient as "up now" instead of saying so honestly.
 *
 * ROOT CAUSE
 *   - _heroAutoPos(pending): when no appt is in-room (started <=30 min ago) and
 *     none is upcoming (>= now), it falls back to index 0 -> the day's FIRST
 *     patient gets highlighted.
 *   - _calLoadNextUp(): writes the "Up now: <name> at <time>" banner from that
 *     pick, so the banner shows an early/over time.
 *
 * FIX
 *   When today's schedule has timed appointments but the current time is past
 *   ALL of them (none in-room, none upcoming):
 *     - _heroAutoPos returns -1 so NO card is auto-flagged "UP NOW";
 *     - _calLoadNextUp shows an honest "No more patients today." banner and does
 *       NOT auto-load an early patient;
 *     - a thin post-render guard keeps the banner honest and clears any stray
 *       "UP NOW" label that another module might re-add in this state.
 *   Before the first appt -> the next upcoming patient is highlighted (unchanged).
 *   In-room within 30 min -> that patient (unchanged). Untimed lists -> unchanged.
 *
 * SAFETY: additive, idempotent, ASCII-only. Saves & restores the originals on
 *   revert. No network, no PHI, no athenaOne writes.
 *   Reversible: window.__mlsUpNowRealtime.revert().
 * =========================================================================*/
;(function () {
  "use strict";
  try { if (window.__mlsUpNowRealtime && window.__mlsUpNowRealtime.installed) return; } catch (e) { return; }

  var VERSION = "unr-1.0.0";
  var BANNER = "heroPullStatus";
  var HERO = "heroToday";
  var NOMORE = "No more patients today.";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function mins(a) {
    return safe(function () {
      if (typeof window._calApptMins === "function") return window._calApptMins(a);
      var t = String((a && a.time) || "");
      if (/^\d\d?:\d\d$/.test(t)) { var p = t.split(":"); return parseInt(p[0], 10) * 60 + parseInt(p[1], 10); }
      return null;
    }, null);
  }
  function nowMin() { var d = new Date(); return d.getHours() * 60 + d.getMinutes(); }

  /* timed appts exist, but now is past every one (none in-room <=30 min, none upcoming) */
  function pastAllList(appts) {
    if (!appts || !appts.length) return false;
    var nm = nowMin(), anyTimed = false;
    for (var i = 0; i < appts.length; i++) {
      var m = mins(appts[i]); if (m == null) continue;
      anyTimed = true;
      if (m >= nm) return false;            /* an upcoming appt -> not past-all */
      if (m <= nm && nm - m <= 30) return false; /* in the room now -> not past-all */
    }
    return anyTimed;
  }

  function onVisit() {
    return safe(function () { return window.currentView === "visit" || (typeof currentView !== "undefined" && currentView === "visit"); }, false);
  }
  function heroVisible() {
    var h = $(HERO); if (!h) return false;
    return safe(function () { return getComputedStyle(h).display !== "none"; }, false);
  }

  function setNoMoreBanner() {
    var el = $(BANNER); if (!el) return;
    safe(function () {
      if (el.textContent === NOMORE && el.style.display === "block") return;
      el.textContent = NOMORE;
      el.style.color = "rgba(255,255,255,.95)";
      el.style.display = "block";
    });
  }

  /* remove any leading "UP NOW"/"SELECTED" label + reset a chip to non-current look */
  function stripUpNow() {
    var box = $(HERO); if (!box) return;
    safe(function () {
      var chips = box.querySelectorAll('button[onclick^="_heroPickPatient("]');
      for (var i = 0; i < chips.length; i++) {
        var c = chips[i], f = c.firstElementChild;
        if (f && f.tagName === "SPAN" && /^\s*●/.test(f.textContent || "")) {
          try { c.removeChild(f); } catch (e) {}
          c.style.background = "rgba(255,255,255,.15)";
          c.style.border = "2px solid rgba(255,255,255,.30)";
          c.style.color = "#fff";
          c.style.boxShadow = "none";
        }
      }
    });
  }

  /* ---- overrides ---- */
  var _origAutoPos = null, _origLoadNextUp = null, _origRender = null;

  function installAutoPos() {
    safe(function () {
      if (typeof window._heroAutoPos !== "function") return;
      if (window._heroAutoPos.__mlsUnrWrapped) return;
      _origAutoPos = window._heroAutoPos;
      var fn = function (pending) {
        if (!pending || !pending.length) return 0;
        var nm = nowMin(), inRoom = -1, next = -1, anyTimed = false;
        for (var k = 0; k < pending.length; k++) {
          var m = mins(pending[k] && pending[k].a); if (m == null) continue;
          anyTimed = true;
          if (m <= nm && nm - m <= 30) inRoom = k;
          if (m >= nm && next < 0) next = k;
        }
        if (inRoom >= 0) return inRoom;
        if (next >= 0) return next;
        if (anyTimed) return -1;            /* past all timed appts -> no one up now */
        return 0;                            /* untimed -> original default */
      };
      fn.__mlsUnrWrapped = true; fn.__mlsUnrOrig = _origAutoPos;
      window._heroAutoPos = fn;
    });
  }

  function installLoadNextUp() {
    safe(function () {
      if (typeof window._calLoadNextUp !== "function") return;
      if (window._calLoadNextUp.__mlsUnrWrapped) return;
      _origLoadNextUp = window._calLoadNextUp;
      var fn = function () {
        try {
          var appts = window._heroTodayList || [];
          if (appts.length && pastAllList(appts)) {
            try { if (typeof window._renderTodayPatients === "function") window._renderTodayPatients(appts); } catch (e) {}
            setNoMoreBanner();
            stripUpNow();
            return;
          }
        } catch (e) {}
        return _origLoadNextUp.apply(this, arguments);
      };
      fn.__mlsUnrWrapped = true; fn.__mlsUnrOrig = _origLoadNextUp;
      window._calLoadNextUp = fn;
    });
  }

  function installRenderGuard() {
    safe(function () {
      if (typeof window._renderTodayPatients !== "function") return;
      if (window._renderTodayPatients.__mlsUnrGuard) return;
      _origRender = window._renderTodayPatients;
      var fn = function () {
        var r = _origRender.apply(this, arguments);
        try {
          if (heroVisible() && pastAllList(window._heroTodayList || [])) { stripUpNow(); setNoMoreBanner(); }
        } catch (e) {}
        return r;
      };
      fn.__mlsUnrGuard = true; fn.__mlsUnrOrig = _origRender;
      try { fn.__mlsUpNowWrapped = _origRender.__mlsUpNowWrapped; } catch (e) {}
      window._renderTodayPatients = fn;
    });
  }

  var _obs = null, _poll = null, _polls = 0, _last = 0;
  function guard() {
    try {
      if (!onVisit() || !heroVisible()) return;
      if (pastAllList(window._heroTodayList || [])) {
        var t = Date.now();
        if (t - _last < 600) return;
        _last = t;
        stripUpNow(); setNoMoreBanner();
      }
    } catch (e) {}
  }

  function boot() {
    installAutoPos();
    installLoadNextUp();
    installRenderGuard();
    safe(function () {
      _poll = setInterval(function () {
        _polls++;
        installAutoPos(); installLoadNextUp(); installRenderGuard(); guard();
        if (_polls > 60) { try { clearInterval(_poll); _poll = setInterval(guard, 2000); _polls = -1; } catch (e) {} }
      }, 1000);
    });
    safe(function () {
      _obs = new MutationObserver(function () { guard(); });
      _obs.observe($(HERO) || document.documentElement, { childList: true, subtree: true });
    });
    guard();
  }

  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); _obs = null; });
    safe(function () { if (_poll) { clearInterval(_poll); _poll = null; } });
    safe(function () { if (_origAutoPos && window._heroAutoPos && window._heroAutoPos.__mlsUnrWrapped) window._heroAutoPos = _origAutoPos; });
    safe(function () { if (_origLoadNextUp && window._calLoadNextUp && window._calLoadNextUp.__mlsUnrWrapped) window._calLoadNextUp = _origLoadNextUp; });
    safe(function () { if (_origRender && window._renderTodayPatients && window._renderTodayPatients.__mlsUnrGuard) window._renderTodayPatients = _origRender; });
    safe(function () { try { if (typeof window._calLoadNextUp === "function") window._calLoadNextUp(); } catch (e) {} });
    safe(function () { window.__mlsUpNowRealtime.installed = false; });
  }

  window.__mlsUpNowRealtime = { installed: true, version: VERSION, reapply: boot, revert: revert, pastAll: function () { return pastAllList(window._heroTodayList || []); } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
