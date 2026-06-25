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
  var origCalLoadNextUp = null;
  var pollTimer = null, pollTries = 0;
  var MAX_TRIES = 40;               // ~20s at 500ms — covers late-arriving patient/schedule data

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
    try { if (pollTimer){ clearInterval(pollTimer); pollTimer = null; } } catch(e){}
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

  function wrap(){
    // Wrap the auto-load so any future invocation re-checks alignment, idempotently.
    try {
      var fn = window._calLoadNextUp;
      if (typeof fn === 'function' && !fn.__mlsWrapped){
        origCalLoadNextUp = fn;
        var wrapped = function(){
          var r;
          try { r = origCalLoadNextUp.apply(this, arguments); } catch(e){ r = undefined; }
          try { maybeSelect('calLoadNextUp'); } catch(e){}
          return r;
        };
        wrapped.__mlsWrapped = true;
        wrapped.__mlsOrig = origCalLoadNextUp;
        window._calLoadNextUp = wrapped;
      }
    } catch(e){}
  }

  function start(){
    wrap();
    maybeSelect('install');   // catch the case where auto-load already ran before we loaded
    pollTries = 0;
    try {
      pollTimer = setInterval(function(){
        pollTries++;
        try { wrap(); } catch(e){}   // in case _calLoadNextUp is defined after us
        maybeSelect('poll');
        if (done || pollTries >= MAX_TRIES) stopPoll();
      }, 500);
    } catch(e){}
  }

  window.__mlsUpNowActiveSelect = {
    __installed: true,
    revert: function(){
      try { stopPoll(); } catch(e){}
      try {
        if (window._calLoadNextUp && window._calLoadNextUp.__mlsWrapped && origCalLoadNextUp){
          window._calLoadNextUp = origCalLoadNextUp;
        }
      } catch(e){}
      done = true;
      try { delete window.__mlsUpNowActiveSelect; } catch(e){ try { window.__mlsUpNowActiveSelect = undefined; } catch(e2){} }
    },
    status: function(){
      return {
        done: done,
        capturedInitial: capturedInitial,
        initialActiveId: initialActiveId,
        currentActiveId: getActiveId(),
        upNowName: upNowName(),
        wrapped: !!(window._calLoadNextUp && window._calLoadNextUp.__mlsWrapped)
      };
    }
  };

  try {
    if (document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', start, { once:true }); }
    else { start(); }
  } catch(e){ try { start(); } catch(e2){} }
})();
