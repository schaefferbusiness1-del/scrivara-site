/*! feat_athena_cardtips_noinfo.js  ->  window.__mlsCardTipsNoInfo  (v1.0.0)
 * =====================================================================
 * UI POLISH — remove the small grey "info circle" affordance that the
 * day-pull card tooltip features inject next to each pull button label.
 *
 * The two cardtip features relocate the long inline card description into a
 * hover/focus/tap tooltip and, as a marker, inject a tiny circled-i element:
 *   - feat_athena_cardtips.js  (window.__mlsCardTips)       -> .mlstip-info
 *       on the §67 `.mlscp` centerpiece pull cards.
 *   - feat_athena_cardtips_mlsac.js (window.__mlsCardTipsMlsac) -> .mlsactip-info
 *       on the LIVE §64 `mlsac-*` day-pull cards the doctor actually sees.
 * Each is a ~16px translucent grey/white circle ("ⓘ"). It reads as
 * unproportional / ugly on the pull buttons. Michael wants it GONE.
 *
 * IMPORTANT — the tooltip does NOT depend on the circle. In both features the
 * tooltip is bound to the BUTTON, not the circle:
 *   `.mlstip-host:hover .mlstip-pop`, `:focus-within`, and a `.mlstip-open`
 *   class toggled on the BUTTON's `touchstart` (same shape for `.mlsactip-*`).
 * The circle carried only `cursor:help` decoration and `aria-hidden="true"`;
 * it fires no events. Therefore removing the circle leaves the description
 * fully reachable on button hover / keyboard focus / mobile tap. Nothing is
 * rebound because nothing was ever bound to the circle.
 *
 * WHAT THIS DOES (additive, own-scope, reversible):
 *   1) injects a CSS rule hiding `.mlstip-info, .mlsactip-info` (prevents any
 *      flash before the JS removal pass on a card re-render),
 *   2) physically removes every `.mlstip-info` / `.mlsactip-info` element so
 *      no circle element remains in the DOM,
 *   3) keeps removing them on re-render (MutationObserver + slow safety poll),
 *      because the §64/§66/§67 owners re-create cards (and thus circles).
 *
 * It does NOT touch the tooltip popover (`.mlstip-pop` / `.mlsactip-pop`), the
 * `.mlstip-host` anchor class, `aria-describedby`, the READ-ONLY / WRITES
 * pills, any button id/handler, or the pull logic. It only deletes the circle.
 *
 * revert() disconnects, removes the injected CSS, and re-creates the circles
 * it had removed for any host button still in the DOM — restoring the prior
 * state. (Any not restorable because its button was re-rendered away will be
 * re-added by the owner feature on its next pass.) No PHI is read or written;
 * this only deletes a static decorative element. NUL-free.
 * ===================================================================== */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W) return;
  if (W.__mlsCardTipsNoInfo && W.__mlsCardTipsNoInfo.installed) return;

  var VERSION = '1.0.0';
  var ASSET = 'feat_athena_cardtips_noinfo.js';
  var STYLE_ID = 'mlsCardTipsNoInfoStyle';
  var SEL = '.mlstip-info, .mlsactip-info';   // both variants' circle classes
  var removed = [];                            // {parent, before, cls} for revert

  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = ce('style'); st.id = STYLE_ID;
    // belt-and-suspenders: hide instantly if an owner re-adds a circle between
    // our removal passes. Physical removal (below) handles steady state.
    st.textContent = '.mlstip-info,.mlsactip-info{display:none !important;}';
    (document.head || document.documentElement).appendChild(st);
  }

  function removeCircle(el) {
    try {
      if (!el || !el.parentNode) return;
      var cls = (el.classList && el.classList.contains('mlstip-info')) ? 'mlstip-info' : 'mlsactip-info';
      removed.push({ parent: el.parentNode, before: el.nextSibling, cls: cls });
      el.parentNode.removeChild(el);
    } catch (e) {}
  }

  function pass() {
    try {
      injectStyle();
      var els = document.querySelectorAll(SEL);
      for (var i = 0; i < els.length; i++) removeCircle(els[i]);
    } catch (e) {}
  }

  var _raf = 0, _obs = null, _pollT = null;

  function schedulePass() {
    if (_raf) return;
    var run = function () { _raf = 0; pass(); };
    _raf = (W.requestAnimationFrame ? W.requestAnimationFrame(run) : setTimeout(run, 16));
  }

  function startObserver() {
    try {
      _obs = new MutationObserver(function () { schedulePass(); });
      _obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    // slow safety poll mirrors the owners' 1500ms re-render cadence
    _pollT = setInterval(function () { schedulePass(); }, 1500);
  }

  function boot() {
    injectStyle();
    pass();
    startObserver();
  }

  function revert() {
    try { if (_obs) { _obs.disconnect(); _obs = null; } } catch (e) {}
    try { if (_pollT) { clearInterval(_pollT); _pollT = null; } } catch (e) {}
    try { if (_raf && W.cancelAnimationFrame) W.cancelAnimationFrame(_raf); } catch (e) {}
    _raf = 0;
    try { var st = document.getElementById(STYLE_ID); if (st) st.remove(); } catch (e) {}
    // restore the circles we removed, for host buttons still in the DOM
    removed.forEach(function (r) {
      try {
        var p = r.parent;
        if (!p || !p.ownerDocument || !p.ownerDocument.contains(p)) return;
        if (p.querySelector && p.querySelector('.' + r.cls)) return; // already present
        var info = ce('span', r.cls);
        info.textContent = 'ⓘ'; // circled i
        info.setAttribute('aria-hidden', 'true');
        if (r.before && r.before.parentNode === p) p.insertBefore(info, r.before);
        else p.appendChild(info);
      } catch (e) {}
    });
    removed = [];
    if (W.__mlsCardTipsNoInfo) W.__mlsCardTipsNoInfo.installed = false;
  }

  W.__mlsCardTipsNoInfo = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    pass: pass,
    _removed: function () { return removed; },
    revert: revert
  };

  try {
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  } catch (e) { try { boot(); } catch (e2) {} }
})();
