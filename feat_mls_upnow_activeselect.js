/* feat_mls_upnow_activeselect.js
 * item25: On initial ScribeFlow load, align the ACTIVE patient with the auto-pulled
 * "up-now" patient so the main header, Outcomes panel and After-visit summary stop
 * showing a stale/different patient than the MLS Easy card / "loaded & ready" banner /
 * NEXT UP highlight / capture label.
 *
 * Root cause: the hero auto-load (_calLoadNextUp) fills heroPtName/heroPtDob and prints
 * "Up now ... loaded & ready" but never calls selectPatient() for that patient, so the
 * rest of the app keeps the old active-patient id. Pressing Start (heroStartVisit) already
 * does the exact-name -> selectPatient(p.id) link correctly; this module performs the same
 * link at auto-load time, guarded.
 *
 * Strictly additive + reversible: window.__mlsUpNowActiveSelect.revert()
 * Does NOT change behavior when a capture/recording is in progress, or when the user has
 * deliberately opened a different chart after load (only fixes the initial-load stale display).
 */
;(function(){
  'use strict';
  try {
    if (window.__mlsUpNowActiveSelect && window.__mlsUpNowActiveSelect.__installed) return;
  } catch(e){ return; }

  var TAG = '[mls upnow-activeselect]';
  var done = false;                 // set once we've aligned (or confirmed alignment / deferred to user)
  var capturedInitial = false;      // have we snapshotted the initial active id yet
  var initialActiveId = null;       // the (possibly stale) active patient id at the moment we first looked
  var origCalLoadNextUp = null, wrappedCalLoadNextUp = null;
  var retryTimers = [], pollTries = 0;
  var disposed = false, started = false, domReadyListener = null;
  var loaderReadyListener = null, loaderStartListener = null, sessionBoundaryListener = null, startTimer = null, fallbackTimer = null;
  var RETRY_DELAYS = [500, 1500, 3500, 7000, 12000, 20000];

  function captureInProgress(){
    // True if the user is actively capturing/recording or has unsaved visit work.
    // In those states the active patient is already correct (Start sets it) and must not move.
    try {
      if (typeof window.capturing !== 'undefined' && window.capturing) return true;
      var pr = window.phoneRec;
      if (pr && typeof pr.state !== 'undefined' && pr.state && pr.state !== 'inactive') return true;
      if (typeof window._visitDirty !== 'undefined' && window._visitDirty) return true;
    } catch(e){}
    return false;
  }

  function getActiveId(){
    try { if (typeof window.getActivePtId === 'function') return window.getActivePtId(); } catch(e){}
    return null;
  }

  function upNowName(){
    try{var _hpn=(document.getElementById('heroPtName')||{}).value||'';_hpn=String(_hpn).trim();if(_hpn)return _hpn;}catch(_e){}
    // Prefer the structured today list at the current "now" index (the same source the banner
    // and NEXT UP highlight use); fall back to the hero name input the auto-load filled.
    try {
      var list = window._heroTodayList || [];
      var idx = (typeof window._heroNowIdx === 'number') ? window._heroNowIdx : -1;
      if (idx >= 0 && list[idx] && list[idx].name) return String(list[idx].name).trim();
    } catch(e){}
    try {
      var nm = (document.getElementById('heroPtName') || {}).value || '';
      return String(nm).trim();
    } catch(e){}
    return '';
  }

  function findExactChart(name){
    // Exact (case-insensitive, trimmed) name match against existing charts — identical to the
    // link logic in heroStartVisit / _heroPickPatient. Read-only; never creates a chart.
    try {
      if (!name || typeof window.getPatients !== 'function') return null;
      var key = name.trim().toLowerCase();
      if (!key) return null;
      var arr = window.getPatients() || [];
      for (var i = 0; i < arr.length; i++){
        var x = arr[i];
        if (x && String(x.name || '').trim().toLowerCase() === key) return x;
      }
    } catch(e){}
    return null;
  }

  function stopPoll(){
    while (retryTimers.length){
      try { clearTimeout(retryTimers.pop()); } catch(e){}
    }
  }

  function maybeSelect(reason){
    try {
      if (done) return;
      if (typeof window.selectPatient !== 'function') return;   // app not ready yet
      if (captureInProgress()) return;                          // never move active during capture

      var cur = getActiveId();

      // Snapshot the initial (possibly stale) active id exactly once.
      if (!capturedInitial){ initialActiveId = cur; capturedInitial = true; }

      // If the active patient has changed away from the initial stale id, the user (or Start)
      // deliberately chose a chart — respect that and never override it.
      if (cur !== initialActiveId){ done = true; stopPoll(); return; }

      var name = upNowName();
      if (!name) return;                       // banner/list not populated yet -> retry later

      var p = findExactChart(name);
      if (!p || !p.id) return;                 // no exact-name chart yet -> retry later (don't burn flag)

      if (String(p.id) === String(cur)){ done = true; stopPoll(); return; } // already aligned

      // THE FIX: make every panel agree on the up-now patient.
      window.selectPatient(p.id);
      done = true; stopPoll();
      try { console.debug(TAG, 'aligned active patient to up-now "' + name + '" id=' + p.id + ' (' + reason + ')'); } catch(e){}
    } catch(e){}
  }

  function wrapperChainHas(fn){
    var seen = [], depth = 0;
    while (typeof fn === 'function' && depth++ < 16 && seen.indexOf(fn) < 0){
      if (fn.__mlsActiveSelectWrapped && !fn.__mlsWrapperDisposed) return true;
      seen.push(fn);
      fn = fn.__mlsUnrOrig || fn.__t3Orig || fn.__mlsUpNowOrig || fn.__mlsOrig || null;
    }
    return false;
  }

  function wrap(){
    // Wrap the auto-load so any future invocation re-checks alignment, idempotently.
    try {
      var fn = window._calLoadNextUp;
      if (typeof fn === 'function' && !wrapperChainHas(fn)){
        var orig = fn;
        origCalLoadNextUp = orig;
        var wrapped = function(){
          if (wrapped.__mlsWrapperDisposed || disposed || !started) return orig.apply(this, arguments);
          var r;
          try { r = orig.apply(this, arguments); } catch(e){ r = undefined; }
          try { maybeSelect('calLoadNextUp'); } catch(e){}
          return r;
        };
        wrapped.__mlsWrapped = true;
        wrapped.__mlsActiveSelectWrapped = true;
        wrapped.__mlsOrig = orig;
        wrappedCalLoadNextUp = wrapped;
        window._calLoadNextUp = wrapped;
      }
    } catch(e){}
  }

  function start(){
    if (disposed || started) return;
    started = true;
    if (startTimer){ try { clearTimeout(startTimer); } catch(e){} startTimer = null; }
    if (fallbackTimer){ try { clearTimeout(fallbackTimer); } catch(e){} fallbackTimer = null; }
    if (loaderReadyListener){ try { window.removeEventListener('mls:loader-ready', loaderReadyListener); } catch(e){} loaderReadyListener = null; }
    wrap();
    maybeSelect('install');   // catch the case where auto-load already ran before we loaded
    if (done) return;
    pollTries = 0;
    RETRY_DELAYS.forEach(function(delay){
      try {
        var timer = setTimeout(function(){
          var index = retryTimers.indexOf(timer);
          if (index >= 0) retryTimers.splice(index, 1);
          if (!started || disposed || done) return;
          pollTries++;
          try { wrap(); } catch(e){}   // in case _calLoadNextUp is defined after us
          maybeSelect('retry-' + pollTries);
        }, delay);
        retryTimers.push(timer);
      } catch(e){}
    });
  }

  function startupBusy(){
    try {
      var gateBusy = window.sfGateLoadingVisible === true || document.documentElement.classList.contains('mls-secure-loading');
      var signedOut = false;
      try { var auth = document.getElementById('authScreen'), app = document.getElementById('appScreen'); signedOut = !!(auth && auth.style.display !== 'none' && (!app || app.style.display === 'none')); } catch(e){}
      return !!(gateBusy || signedOut);
    } catch(e){ return false; }
  }
  function queueStart(delay){
    if (disposed || started || startTimer) return;
    if (fallbackTimer){ try { clearTimeout(fallbackTimer); } catch(e){} fallbackTimer = null; }
    startTimer = setTimeout(function(){ startTimer = null; start(); }, delay == null ? 180 : delay);
  }
  function fallbackCheck(){
    fallbackTimer = null;
    try {
      var auth = document.getElementById('authScreen'), app = document.getElementById('appScreen');
      if (auth && auth.style.display !== 'none' && (!app || app.style.display === 'none')) return;
    } catch(e){}
    if (startupBusy()) { fallbackTimer = setTimeout(fallbackCheck, 1000); return; }
    queueStart(window.__mlsLoaderReadyAt ? 180 : 0);
  }
  function armReady(){
    if (!loaderReadyListener){
      loaderReadyListener = function(){ loaderReadyListener = null; queueStart(180); };
      try { window.addEventListener('mls:loader-ready', loaderReadyListener, { once:true }); } catch(e){}
    }
    if (!fallbackTimer) fallbackTimer = setTimeout(fallbackCheck, 12000);
  }
  function pause(){
    if (disposed) return;
    started = false;
    stopPoll();
    if (startTimer){ try { clearTimeout(startTimer); } catch(e){} startTimer = null; }
    if (fallbackTimer){ try { clearTimeout(fallbackTimer); } catch(e){} fallbackTimer = null; }
    if (loaderReadyListener){ try { window.removeEventListener('mls:loader-ready', loaderReadyListener); } catch(e){} loaderReadyListener = null; }
    if (domReadyListener){ try { document.removeEventListener('DOMContentLoaded', domReadyListener); } catch(e){} domReadyListener = null; }
    done = false; capturedInitial = false; initialActiveId = null; pollTries = 0;
    armReady();
  }

  window.__mlsUpNowActiveSelect = {
    __installed: true,
    revert: function(){
      disposed = true;
      started = false;
      try { stopPoll(); } catch(e){}
      try { if (startTimer) clearTimeout(startTimer); startTimer = null; if (fallbackTimer) clearTimeout(fallbackTimer); fallbackTimer = null; } catch(e){}
      try { if (loaderReadyListener) window.removeEventListener('mls:loader-ready', loaderReadyListener); loaderReadyListener = null; } catch(e){}
      try { if (loaderStartListener) window.removeEventListener('mls:loader-start', loaderStartListener); loaderStartListener = null; } catch(e){}
      try { if (sessionBoundaryListener) window.removeEventListener('mls:session-boundary', sessionBoundaryListener); sessionBoundaryListener = null; } catch(e){}
      try { if (domReadyListener) document.removeEventListener('DOMContentLoaded', domReadyListener); domReadyListener = null; } catch(e){}
      try {
        if (wrappedCalLoadNextUp) wrappedCalLoadNextUp.__mlsWrapperDisposed = true;
        if (window._calLoadNextUp === wrappedCalLoadNextUp && origCalLoadNextUp){
          window._calLoadNextUp = origCalLoadNextUp;
        }
      } catch(e){}
      done = true;
      try { delete window.__mlsUpNowActiveSelect; } catch(e){ try { window.__mlsUpNowActiveSelect = undefined; } catch(e2){} }
    },
    status: function(){
      return {
        done: done,
        started: started,
        capturedInitial: capturedInitial,
        initialActiveId: initialActiveId,
        currentActiveId: getActiveId(),
        upNowName: upNowName(),
        wrapped: wrapperChainHas(window._calLoadNextUp)
      };
    }
  };

  /* Keep load order deterministic with a pass-through wrapper during secure
     hydration. Patient scans and bounded retries begin only after reveal. */
  wrap();
  loaderStartListener = pause;
  sessionBoundaryListener = pause;
  try { window.addEventListener('mls:loader-start', loaderStartListener); } catch(e){}
  try { window.addEventListener('mls:session-boundary', sessionBoundaryListener); } catch(e){}
  try {
    if (startupBusy()){
      armReady();
    } else if (window.__mlsLoaderReadyAt){
      queueStart(180);
    } else if (document.readyState === 'loading'){
      domReadyListener = function(){ domReadyListener = null; start(); };
      document.addEventListener('DOMContentLoaded', domReadyListener, { once:true });
    }
    else { start(); }
  } catch(e){ try { start(); } catch(e2){} }
})();
