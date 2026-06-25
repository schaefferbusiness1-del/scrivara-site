/* ============================================================================
 * feat_mls_gen_speed.js  ->  window.__mlsGenSpeed   (gs-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 10 (part 1, frontend lever): FASTER op-note / note drafting.
 *
 * The note model is chosen + run on the backend (Standard plan always uses the
 * fast model; model choice is Premium-only and backend-validated), so the
 * frontend cannot pick a faster model. The ONE latency the frontend CAN cut is
 * the hosted backend's COLD START: scrivara-backend (Render) spins its dyno down
 * when idle, so the FIRST Generate after a pause pays a multi-second wake-up.
 *
 * FIX (additive, reversible): keep the backend WARM during an active session by
 * sending a cheap, credential-less HEAD ping to the backend origin (a) when the
 * doctor opens the Visit / op-note surface (so the dyno is awake before they hit
 * Generate) and (b) on a gentle interval while a session exists. Debounced so it
 * never spams. No PHI, no auth header, no LLM call -- just wakes the dyno.
 * ASCII-only, idempotent, reversible (window.__mlsGenSpeed.revert()).
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsGenSpeed && window.__mlsGenSpeed.installed) return; } catch (e) { return; }

  var VERSION = 'gs-1.0.0';
  var MIN_GAP_MS = 90 * 1000;     // never ping more than once per 90s
  var INTERVAL_MS = 4 * 60 * 1000; // gentle keep-warm every 4 min
  var _lastPing = 0;
  var _timer = 0;
  var _origShowView = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  function backendBase() {
    return safe(function () { return (typeof window.bkBase === 'function') ? window.bkBase() : ''; }, '');
  }
  function hasSession() {
    // only keep warm for a signed-in, hosted session
    var bm = safe(function () { return (typeof window.backendMode === 'function') ? window.backendMode() : false; }, false);
    var tok = safe(function () { return (typeof window.bkToken === 'function') ? !!window.bkToken() : false; }, false);
    return !!(bm && tok);
  }

  function warm(reason) {
    if (!hasSession()) return;
    var base = backendBase();
    if (!base) return;
    var now = Date.now();
    if (now - _lastPing < MIN_GAP_MS) return;   // debounce
    _lastPing = now;
    // credential-less, body-less wake-up; ignore the result entirely.
    safe(function () {
      fetch(base, { method: 'HEAD', mode: 'no-cors', cache: 'no-store', keepalive: true })
        .catch(function () {});
    });
  }

  // wake on entering the visit / op-note surface
  function hookShowView() {
    if (typeof window.showView !== 'function') return false;
    if (window.showView.__mlsGsWrapped) return true;
    _origShowView = window.showView;
    var wrapped = function (v) {
      var r = _origShowView.apply(this, arguments);
      if (v === 'visit') safe(function () { warm('visit'); });
      return r;
    };
    wrapped.__mlsGsWrapped = true;
    wrapped.__mlsGsOrig = _origShowView;
    window.showView = wrapped;
    return true;
  }

  function boot() {
    // initial warm + hook + interval
    warm('boot');
    if (!hookShowView()) {
      var n = 0, t = setInterval(function () { n++; if (hookShowView() || n >= 40) clearInterval(t); }, 300);
    }
    _timer = setInterval(function () { warm('interval'); }, INTERVAL_MS);
    // also wake when the op-note prep modal opens (best-effort, by clicking the prep button)
    safe(function () {
      document.addEventListener('click', function (e) {
        var t = e.target;
        if (!t || !t.closest) return;
        var b = t.closest('[onclick*="openOpPrep"],[onclick*="OpNote"],#heroRecBtn,#captureBtn');
        if (b) warm('opnote-intent');
      }, true);
    });
  }

  function revert() {
    safe(function () { clearInterval(_timer); });
    safe(function () { if (window.showView && window.showView.__mlsGsWrapped && _origShowView) window.showView = _origShowView; });
    safe(function () { window.__mlsGenSpeed.installed = false; });
  }

  window.__mlsGenSpeed = {
    installed: true,
    version: VERSION,
    warm: warm,
    lastPingAt: function () { return _lastPing; },
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
