/* ===========================================================================
   MLS — Expert marketplace listing: move to top of Legal requests view
   ---------------------------------------------------------------------------
   Additive progressive enhancement for ScribeFlow.html. Relocates the existing
   "Expert marketplace listing" card (#expertCard) so it renders as the FIRST
   card at the TOP of the Legal requests view (#legalReqView), above the
   incoming-requests-list card.

   - Moves the EXISTING DOM node (never duplicates it), so the opt-in form
     (#expertBody: "List me in the expert marketplace" checkbox, specialty /
     jurisdiction, short bio, Save listing) and the injected "Advertise
     yourself to attorneys / Build my advertisement" CTA — both live inside
     #expertCard — travel with it and stay fully functional.
   - Idempotent: only acts when the card is not already first; no-op otherwise.
   - Does not fight other observers: self-stabilizing (once the card is first,
     re-checks are no-ops, so there is no move/observe loop).
   - Fully reversible: window.__mlsExpertTop.revert() restores the original
     position (back above #connectCard / Direct payouts) and tears down timers.
   - Self-contained IIFE, try/catch everywhere; returns silently on any error
     so it can never break the host app.
   ======================================================================== */
(function () {
  if (window.__mlsExpertTop && window.__mlsExpertTop.installed) return;

  var VERSION = "20260629et1";
  var _origNext = null;     // original nextElementSibling, captured once, for revert
  var _captured = false;
  var _obs = null, _sched = null, _t = null, _moving = false;

  function $(id) { return document.getElementById(id); }

  function moveToTop() {
    var view = $("legalReqView");
    var card = $("expertCard");
    if (!view || !card) return;
    if (card.parentNode !== view) return;            // unexpected structure -> leave it alone
    if (!_captured) { _origNext = card.nextElementSibling; _captured = true; }  // remember home
    if (view.firstElementChild === card) return;      // already at top -> idempotent no-op
    _moving = true;
    try { view.insertBefore(card, view.firstElementChild); } catch (e) {}
    try { card.setAttribute("data-mls-expert-top", "1"); } catch (e) {}
    _moving = false;
  }

  function schedule() {
    if (_sched) return;
    _sched = setTimeout(function () { _sched = null; try { moveToTop(); } catch (e) {} }, 80);
  }

  function attachObserver() {
    if (_obs) return;
    try {
      var view = $("legalReqView"); if (!view) return;
      _obs = new MutationObserver(function () { if (_moving) return; schedule(); });
      // Only watch direct children of the view (not subtree), so host re-renders
      // inside the cards (#legalReqList, #expertBody) never trigger us.
      _obs.observe(view, { childList: true });
    } catch (e) {}
  }

  function boot() {
    try { moveToTop(); } catch (e) {}
    attachObserver();
    // A few light retries in case the view / cards are (re)built after load.
    var n = 0;
    try {
      _t = setInterval(function () {
        try { moveToTop(); } catch (e) {}
        attachObserver();
        if (++n > 12) { try { clearInterval(_t); } catch (e) {} _t = null; }
      }, 700);
    } catch (e) {}
  }

  function revert() {
    try { if (_obs) { _obs.disconnect(); _obs = null; } } catch (e) {}
    try { if (_t) { clearInterval(_t); _t = null; } } catch (e) {}
    try { if (_sched) { clearTimeout(_sched); _sched = null; } } catch (e) {}
    try {
      var view = $("legalReqView"), card = $("expertCard");
      if (view && card && card.parentNode === view && _captured) {
        if (_origNext && _origNext.parentNode === view) view.insertBefore(card, _origNext);
        else view.appendChild(card);
        try { card.removeAttribute("data-mls-expert-top"); } catch (e) {}
      }
    } catch (e) {}
    try { window.__mlsExpertTop.installed = false; } catch (e) {}
  }

  window.__mlsExpertTop = {
    installed: true,
    version: VERSION,
    reapply: boot,
    moveToTop: moveToTop,
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  } catch (e) { try { boot(); } catch (e2) {} }
})();
