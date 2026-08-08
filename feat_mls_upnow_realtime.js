/* ============================================================================
 * feat_mls_upnow_realtime.js  ->  window.__mlsUpNowRealtime  (unr-1.2.2)
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

  var VERSION = "unr-1.2.2";
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
  function nowMin() {
    try { if (typeof window._acctNowMinutes === "function") return window._acctNowMinutes(); } catch (e) {}
    var d = new Date(); return d.getHours() * 60 + d.getMinutes();
  }

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
    /* `getComputedStyle()` here forced a full style/layout flush while the
       startup module train was still mutating a multi-thousand-node document.
       Two UP-NOW owners called this check thousands of times and could consume
       tens of seconds without changing any UI. The app's route + inline shell
       state are the visibility source of truth and are cheap, layout-free reads. */
    return safe(function () {
      var app = $("appScreen");
      if (app && app.style && app.style.display === "none") return false;
      if (!onVisit()) return false;
      if (h.hidden || h.getAttribute("aria-hidden") === "true") return false;
      return !h.style || h.style.display !== "none";
    }, false);
  }

  /* unr-1.1.0: "No more patients today." was time-only truth — with a clinic
     running late it contradicted the agenda strip ("1 remaining") while an
     unseen patient was still waiting. When appointment times have all passed
     but unseen patients remain on the list, say THAT instead. */
  function unseenPastCount() {
    return safe(function () {
      if (typeof window._seenToday !== "function") return 0;
      var list = window._heroTodayList || [], n = 0;
      for (var i = 0; i < list.length; i++) {
        var a = list[i] || {};
        if (!a.name) continue;
        if (window.__mlsStaffMark && window.__mlsStaffMark.isStaff && window.__mlsStaffMark.isStaff(a.name)) continue;
        if (!window._seenToday(a.name)) n++;
      }
      return n;
    }, 0) || 0;
  }
  function bannerText() {
    var n = unseenPastCount();
    if (n > 0) return "All appointment times have passed — " + n + (n === 1 ? " patient on today's list is" : " patients on today's list are") + " not marked seen yet.";
    return NOMORE;
  }
  function setNoMoreBanner() {
    var el = $(BANNER); if (!el) return;
    safe(function () {
      var want = bannerText();
      if (el.textContent === want && el.style.display === "block") return;
      el.textContent = want;
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
  var _autoGuard = null, _loadGuard = null, _renderGuard = null;
  /* Later wrapper-cycle hardening: once an owner is found or installed, do not
     let lifecycle retries stack another copy over a co-wrapper. Revert clears
     these flags so the documented reapply path can install a fresh owner. */
  var _didAutoPos = false, _didLoadNextUp = false, _didRenderGuard = false;

  function wrapperChainHas(fn, marker) {
    var seen = [], depth = 0;
    while (typeof fn === "function" && depth++ < 12 && seen.indexOf(fn) < 0) {
      if (fn[marker] && !fn.__mlsWrapperDisposed) return true;
      seen.push(fn);
      fn = fn.__mlsUnrOrig || fn.__t3Orig || fn.__mlsUpNowOrig || fn.__mlsOrig || null;
    }
    return false;
  }

  function installAutoPos() {
    safe(function () {
      if (_didAutoPos) return;
      if (typeof window._heroAutoPos !== "function") return;
      if (wrapperChainHas(window._heroAutoPos, "__mlsUnrWrapped")) { _didAutoPos = true; return; }
      var orig = window._heroAutoPos;
      _origAutoPos = orig;
      var fn = function (pending) {
        if (fn.__mlsWrapperDisposed) return orig.apply(this, arguments);
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
      fn.__mlsUnrWrapped = true; fn.__mlsUnrOrig = orig;
      /* Preserve co-wrapper ownership markers so their retry loops do not
         build a redundant head over this guard. */
      try { fn.__mlsEzpfWrapped = orig.__mlsEzpfWrapped; } catch (e) {}
      _autoGuard = fn;
      window._heroAutoPos = fn;
      _didAutoPos = true;
    });
  }

  function installLoadNextUp() {
    safe(function () {
      if (_didLoadNextUp) return;
      if (typeof window._calLoadNextUp !== "function") return;
      if (wrapperChainHas(window._calLoadNextUp, "__mlsUnrWrapped")) { _didLoadNextUp = true; return; }
      var orig = window._calLoadNextUp;
      _origLoadNextUp = orig;
      var fn = function () {
        if (fn.__mlsWrapperDisposed) return orig.apply(this, arguments);
        try {
          var appts = window._heroTodayList || [];
          if (appts.length && pastAllList(appts)) {
            try { if (typeof window._renderTodayPatients === "function") window._renderTodayPatients(appts); } catch (e) {}
            setNoMoreBanner();
            stripUpNow();
            return;
          }
        } catch (e) {}
        return orig.apply(this, arguments);
      };
      fn.__mlsUnrWrapped = true; fn.__mlsUnrOrig = orig;
      if (orig.__mlsWrapped) fn.__mlsWrapped = true;
      try { fn.__mlsEzpfWrapped = orig.__mlsEzpfWrapped; } catch (e) {}
      _loadGuard = fn;
      window._calLoadNextUp = fn;
      _didLoadNextUp = true;
    });
  }

  function installRenderGuard() {
    safe(function () {
      if (_didRenderGuard) return;
      if (typeof window._renderTodayPatients !== "function") return;
      if (wrapperChainHas(window._renderTodayPatients, "__mlsUnrGuard")) { _didRenderGuard = true; return; }
      var orig = window._renderTodayPatients;
      _origRender = orig;
      var fn = function () {
        var r = orig.apply(this, arguments);
        try {
          if (!fn.__mlsWrapperDisposed && _started) {
            if (heroVisible() && pastAllList(window._heroTodayList || [])) { stripUpNow(); setNoMoreBanner(); }
            scheduleClock();
          }
        } catch (e) {}
        return r;
      };
      fn.__mlsUnrGuard = true; fn.__mlsUnrOrig = orig;
      try { fn.__mlsUpNowWrapped = orig.__mlsUpNowWrapped; } catch (e) {}
      try { fn.__mlsUpNowOrig = orig.__mlsUpNowOrig; } catch (e) {}
      _renderGuard = fn;
      window._renderTodayPatients = fn;
      _didRenderGuard = true;
    });
  }

  var _obs = null, _clock = null, _last = 0, _started = false;
  var _retryTimers = [], _startTimer = null, _startFallback = null;
  var _loaderReadyListener = null, _loaderStartListener = null, _sessionBoundaryListener = null, _domReadyListener = null, _signals = false;
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

  function clockDelay() {
    return safe(function () {
      var list = window._heroTodayList || [], nm = nowMin(), best = Infinity;
      var wall = new Date(), intoMinute = wall.getSeconds() * 1000 + (wall.getMilliseconds ? wall.getMilliseconds() : 0);
      for (var i = 0; i < list.length; i++) {
        var m = mins(list[i]); if (m == null) continue;
        var delta = (m + 31 - nm) * 60000 - intoMinute;
        if (delta > 0 && delta < best) best = delta;
      }
      if (!isFinite(best)) best = 6 * 60 * 60000;
      return Math.max(15000, Math.min(best + 1100, 6 * 60 * 60000));
    }, 6 * 60 * 60000);
  }
  function scheduleClock() {
    if (!_started) return;
    if (_clock) { clearTimeout(_clock); _clock = null; }
    _clock = setTimeout(function () { _clock = null; guard(); scheduleClock(); }, clockDelay());
  }
  function observeHero() {
    if (_obs) return;
    safe(function () {
      var hero = $(HERO); if (!hero) return;
      _obs = new MutationObserver(function () { guard(); scheduleClock(); });
      _obs.observe(hero, { childList: true, subtree: true });
    });
  }
  function reconcile() {
    if (!_started) return;
    installAutoPos(); installLoadNextUp(); installRenderGuard();
    observeHero(); guard(); scheduleClock();
  }
  function onSignal() { reconcile(); }
  function addSignals() {
    if (_signals) return; _signals = true;
    safe(function () { window.addEventListener("mls:ui-ready", onSignal); window.addEventListener("mls:view-changed", onSignal); window.addEventListener("focus", onSignal); document.addEventListener("visibilitychange", onSignal); });
  }
  function removeSignals() {
    if (!_signals) return; _signals = false;
    safe(function () { window.removeEventListener("mls:ui-ready", onSignal); window.removeEventListener("mls:view-changed", onSignal); window.removeEventListener("focus", onSignal); document.removeEventListener("visibilitychange", onSignal); });
  }
  function boot() {
    if (window.__mlsUpNowRealtime && window.__mlsUpNowRealtime.installed === false) return;
    if (_started) { reconcile(); return; }
    _started = true;
    if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; }
    if (_startFallback) { clearTimeout(_startFallback); _startFallback = null; }
    if (_loaderReadyListener) { safe(function () { window.removeEventListener("mls:loader-ready", _loaderReadyListener); }); _loaderReadyListener = null; }
    addSignals(); reconcile();
    [250, 1000, 3000, 8000].forEach(function (ms) {
      _retryTimers.push(setTimeout(function () { reconcile(); }, ms));
    });
  }
  function queueBoot(delay) {
    if (_started || _startTimer) return;
    _startTimer = setTimeout(function () { _startTimer = null; boot(); }, delay == null ? 180 : delay);
  }
  function startupBusy() {
    return safe(function () {
      var gateBusy = window.sfGateLoadingVisible === true || document.documentElement.classList.contains("mls-secure-loading");
      var auth = $("authScreen"), app = $("appScreen");
      var signedOut = !!(auth && auth.style.display !== "none" && (!app || app.style.display === "none"));
      return !!(gateBusy || signedOut);
    }, false);
  }
  function fallbackCheck() {
    _startFallback = null;
    var auth = $("authScreen"), app = $("appScreen");
    if (auth && auth.style.display !== "none" && (!app || app.style.display === "none")) return;
    if (startupBusy()) { _startFallback = setTimeout(fallbackCheck, 1000); return; }
    queueBoot(window.__mlsLoaderReadyAt ? 180 : 0);
  }
  function armReady() {
    if (!_loaderReadyListener) {
      _loaderReadyListener = function () { _loaderReadyListener = null; queueBoot(180); };
      safe(function () { window.addEventListener("mls:loader-ready", _loaderReadyListener, { once: true }); });
    }
    if (!_startFallback) _startFallback = setTimeout(fallbackCheck, 12000);
  }
  function pause() {
    if (window.__mlsUpNowRealtime && window.__mlsUpNowRealtime.installed === false) return;
    _started = false;
    safe(function () { if (_obs) _obs.disconnect(); _obs = null; if (_clock) clearTimeout(_clock); _clock = null; if (_startTimer) clearTimeout(_startTimer); _startTimer = null; });
    if (_domReadyListener) { safe(function () { document.removeEventListener("DOMContentLoaded", _domReadyListener); }); _domReadyListener = null; }
    while (_retryTimers.length) safe(function () { clearTimeout(_retryTimers.pop()); });
    armReady();
  }

  function revert() {
    _started = false;
    safe(function () { if (_autoGuard) _autoGuard.__mlsWrapperDisposed = true; if (_loadGuard) _loadGuard.__mlsWrapperDisposed = true; if (_renderGuard) _renderGuard.__mlsWrapperDisposed = true; });
    safe(function () { if (_obs) _obs.disconnect(); _obs = null; });
    safe(function () { if (_clock) { clearTimeout(_clock); _clock = null; } });
    safe(function () { if (_startTimer) { clearTimeout(_startTimer); _startTimer = null; } if (_startFallback) { clearTimeout(_startFallback); _startFallback = null; } });
    while (_retryTimers.length) { safe(function () { clearTimeout(_retryTimers.pop()); }); }
    if (_loaderReadyListener) { safe(function () { window.removeEventListener("mls:loader-ready", _loaderReadyListener); }); _loaderReadyListener = null; }
    if (_loaderStartListener) { safe(function () { window.removeEventListener("mls:loader-start", _loaderStartListener); }); _loaderStartListener = null; }
    if (_sessionBoundaryListener) { safe(function () { window.removeEventListener("mls:session-boundary", _sessionBoundaryListener); }); _sessionBoundaryListener = null; }
    if (_domReadyListener) { safe(function () { document.removeEventListener("DOMContentLoaded", _domReadyListener); }); _domReadyListener = null; }
    removeSignals();
    safe(function () { if (_origAutoPos && _autoGuard && window._heroAutoPos === _autoGuard) window._heroAutoPos = _origAutoPos; _autoGuard = null; });
    safe(function () { if (_origLoadNextUp && _loadGuard && window._calLoadNextUp === _loadGuard) window._calLoadNextUp = _origLoadNextUp; _loadGuard = null; });
    safe(function () { if (_origRender && _renderGuard && window._renderTodayPatients === _renderGuard) window._renderTodayPatients = _origRender; _renderGuard = null; });
    _didAutoPos = false; _didLoadNextUp = false; _didRenderGuard = false;
    safe(function () { try { if (typeof window._calLoadNextUp === "function") window._calLoadNextUp(); } catch (e) {} });
    safe(function () { window.__mlsUpNowRealtime.installed = false; });
  }

  function beginLifecycle() {
    if (!_loaderStartListener) {
      _loaderStartListener = pause;
      safe(function () { window.addEventListener("mls:loader-start", _loaderStartListener); });
    }
    if (!_sessionBoundaryListener) {
      _sessionBoundaryListener = pause;
      safe(function () { window.addEventListener("mls:session-boundary", _sessionBoundaryListener); });
    }
    if (startupBusy()) {
      armReady();
    } else if (window.__mlsLoaderReadyAt) {
      queueBoot(180);
    } else if (document.readyState === "loading") {
      if (!_domReadyListener) {
        _domReadyListener = function () { _domReadyListener = null; boot(); };
        document.addEventListener("DOMContentLoaded", _domReadyListener, { once: true });
      }
    } else {
      boot();
    }
  }
  function reapply() {
    if (!window.__mlsUpNowRealtime) return;
    window.__mlsUpNowRealtime.installed = true;
    installAutoPos(); installLoadNextUp(); installRenderGuard();
    beginLifecycle();
  }

  window.__mlsUpNowRealtime = { installed: true, version: VERSION, reapply: reapply, revert: revert, pastAll: function () { return pastAllList(window._heroTodayList || []); } };
  /* Correctness wrappers are cheap and must protect schedule hydration itself.
     Only the observer, retries, DOM reconciliation, and clock wait for reveal. */
  installAutoPos(); installLoadNextUp(); installRenderGuard();
  beginLifecycle();
})();
