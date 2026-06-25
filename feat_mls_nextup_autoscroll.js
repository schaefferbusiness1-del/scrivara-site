/* feat_mls_nextup_autoscroll.js
 * item26: Auto-scroll the NEXT UP / today's-patients picker (feat_mls_patientpick "mlspk" grid)
 * to the current-time patient.
 *
 * The picker already marks the focal current-time card with class ".mlspk-card.is-now" and
 * scrolls it into view when the focal CHANGES — but it deliberately skips the first paint
 * ("so the page doesn't jump on load"), so on load the list stays parked at the top instead of
 * landing on the patient whose appointment matches "now". This module performs that initial
 * scroll-into-view and re-checks periodically so the selector advances as time passes.
 *
 * Strictly additive + reversible: window.__mlsNextUpAutoScroll.revert()
 * Gentle: only scrolls when the focal card is offscreen; the initial landing centers the card,
 * later time-advances use "nearest"; after the initial landing it only re-scrolls when the focal
 * patient actually changes, and it backs off briefly after the user scrolls so it never fights
 * manual scrolling.
 */
;(function(){
  'use strict';
  try {
    if (window.__mlsNextUpAutoScroll && window.__mlsNextUpAutoScroll.__installed) return;
  } catch(e){ return; }

  var SEL = '.mlspk-card.is-now';
  var lastFocal = null;        // data-id (or data-mins) of the card we last scrolled to
  var initialDone = false;     // have we performed the load-time landing yet
  var lastUserScroll = 0;      // timestamp of the most recent user scroll
  var pollTimer = null, tickTimer = null, pollTries = 0;
  var MAX_POLL = 40;           // ~24s at 600ms — wait for the picker to render
  var USER_SCROLL_BACKOFF = 4000;

  function onUserScroll(){ lastUserScroll = Date.now(); }

  function laidOut(el){ try { var r = el.getBoundingClientRect(); return (r.width > 0 || r.height > 0); } catch(e){ return false; } }

  function inView(el, margin){
    try {
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return true;   // not laid out -> nothing to do
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      margin = margin || 0;
      return r.top >= margin && r.bottom <= vh - margin;
    } catch(e){ return true; }
  }

  function focalCard(){
    // First laid-out is-now card (handles the inline picker and a modal picker).
    try {
      var cs = document.querySelectorAll(SEL);
      for (var i = 0; i < cs.length; i++){ if (laidOut(cs[i])) return cs[i]; }
    } catch(e){}
    return null;
  }

  function cardKey(fc){ return (fc.getAttribute('data-id') || fc.getAttribute('data-mins') || '') + ''; }

  function doScroll(force){
    try {
      var fc = focalCard();
      if (!fc) return false;
      var key = cardKey(fc);
      var focalChanged = (key !== lastFocal);

      if (!(force || !initialDone || focalChanged)) return false;

      // After the initial landing, don't yank the page back while the user is scrolling,
      // unless the focal patient actually changed (time advanced to a new patient).
      if (initialDone && !focalChanged && (Date.now() - lastUserScroll < USER_SCROLL_BACKOFF)) return false;

      if (!inView(fc, 8)){
        // Initial landing: center the current-time card so it clearly "lands" on the patient and
        // shows the surrounding upcoming patients. Later time-advances are small -> "nearest" (gentle).
        var block = initialDone ? 'nearest' : 'center';
        try {
          fc.scrollIntoView({ block: block, inline: 'nearest', behavior: initialDone ? 'smooth' : 'auto' });
        } catch(e){ try { fc.scrollIntoView(); } catch(e2){} }
      }
      lastFocal = key;
      initialDone = true;
      return true;
    } catch(e){}
    return false;
  }

  function stopPoll(){ try { if (pollTimer){ clearInterval(pollTimer); pollTimer = null; } } catch(e){} }

  function startPoll(){
    pollTries = 0;
    try {
      pollTimer = setInterval(function(){
        pollTries++;
        doScroll(false);
        if (initialDone || pollTries >= MAX_POLL) stopPoll();
      }, 600);
    } catch(e){}
  }

  function startTick(){
    // Advance toward "now" over time (aligns with the picker's own ~45s refreshNow re-render).
    try { tickTimer = setInterval(function(){ doScroll(false); }, 30000); } catch(e){}
  }

  function start(){
    try { window.addEventListener('scroll', onUserScroll, { passive: true, capture: true }); } catch(e){}
    doScroll(false);   // try immediately in case the picker is already rendered
    startPoll();       // keep trying until the is-now card is rendered/laid out
    startTick();       // periodic advance as the clock moves
  }

  window.__mlsNextUpAutoScroll = {
    __installed: true,
    scrollNow: function(){ return doScroll(true); },   // manual/forced re-center (used for verification)
    revert: function(){
      try { stopPoll(); } catch(e){}
      try { if (tickTimer){ clearInterval(tickTimer); tickTimer = null; } } catch(e){}
      try { window.removeEventListener('scroll', onUserScroll, true); } catch(e){}
      try { delete window.__mlsNextUpAutoScroll; } catch(e){ try { window.__mlsNextUpAutoScroll = undefined; } catch(e2){} }
    },
    status: function(){
      var fc = focalCard();
      return {
        initialDone: initialDone,
        lastFocal: lastFocal,
        hasIsNow: !!fc,
        focalId: fc ? fc.getAttribute('data-id') : null,
        focalInView: fc ? inView(fc, 8) : null
      };
    }
  };

  try {
    if (document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', start, { once:true }); }
    else { start(); }
  } catch(e){ try { start(); } catch(e2){} }
})();
