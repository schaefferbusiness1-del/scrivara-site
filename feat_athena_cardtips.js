/*! feat_athena_cardtips.js  ->  window.__mlsCardTips  (v1.0.0)
 * =====================================================================
 * PART 2 (UI polish) — move the long descriptive text under the day-pull
 * cards into a HOVER / FOCUS / TAP tooltip, so the cards read clean.
 *
 * The §67 centerpiece (feat_mls_centerpiece.js) renders each day-pull card as
 *   <button class="ez-btn ..." id="mlscpToday">Label
 *     <span class="mlscp-sub">long description...</span>
 *   </button>
 * The .mlscp-sub text currently sits always-visible under the label. This
 * module relocates that text into an accessible tooltip:
 *   - the descriptive text is preserved verbatim (moved, not rewritten),
 *   - it shows on mouse hover, on keyboard focus, and on tap (mobile),
 *   - a small "ⓘ" affordance marks that more info is available,
 *   - aria-describedby links the button to the tip for screen readers.
 *
 * It does NOT touch:
 *   - the READ-ONLY pill / "WRITES TO CHART" tag (owned by feat_athena_actions),
 *   - the "Whose patients?" / provider hint or the .mlscp-note tip line,
 *   - any button id, handler, or the pull logic.
 * Only elements with class `.mlscp-sub` inside the centerpiece cards are
 * converted. Everything else is left byte-for-byte alone.
 *
 * SHAPE: additive own-scope IIFE, idempotent, fully reversible via
 *   window.__mlsCardTips.revert() (restores the original inline text). No PHI
 *   is read or written — it only relocates existing static UI copy.
 * ===================================================================== */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W) return;
  if (W.__mlsCardTips && W.__mlsCardTips.installed) return;

  var VERSION = '1.0.0';
  var ASSET = 'feat_athena_cardtips.js';
  var STYLE_ID = 'mlsCardTipsStyle';
  var SUB = 'mlscp-sub';            // class the centerpiece uses for descriptions
  var DONE_ATTR = 'data-mlstip';    // marks a sub we've already converted
  var seq = 0;
  var _obs = null, _raf = 0, _pollT = null;
  var converted = [];               // {sub, btn, tip, prevHtml, prevDisplay} for revert

  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = ce('style'); st.id = STYLE_ID;
    st.textContent = [
      /* the card needs to anchor the popover */
      '.mlscp-pulls .ez-btn.mlstip-host{position:relative;}',
      /* the little info affordance appended to the label */
      '.mlstip-info{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;',
        'margin-left:7px;border-radius:50%;font-size:11px;font-weight:700;line-height:1;',
        'background:rgba(255,255,255,.28);color:#fff;vertical-align:middle;cursor:help;flex:0 0 auto;}',
      '.ez-btn.ez-secondary .mlstip-info{background:rgba(15,41,66,.18);color:#0f2942;}',
      /* the popover */
      '.mlstip-pop{position:absolute;left:12px;right:12px;top:calc(100% - 4px);z-index:30;',
        'background:#0f2942;color:#eaf2ff;border:1px solid rgba(255,255,255,.22);',
        'border-radius:10px;padding:9px 11px;font-size:11.5px;font-weight:400;line-height:1.4;',
        'box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:0;visibility:hidden;transform:translateY(-4px);',
        'transition:opacity .12s ease,transform .12s ease,visibility .12s;pointer-events:none;text-align:left;}',
      '.mlstip-pop:before{content:"";position:absolute;left:18px;top:-6px;width:10px;height:10px;',
        'background:#0f2942;border-left:1px solid rgba(255,255,255,.22);border-top:1px solid rgba(255,255,255,.22);',
        'transform:rotate(45deg);}',
      /* shown on hover of the card, keyboard focus, or tap-toggle (open class) */
      '.mlstip-host:hover .mlstip-pop,',
      '.mlstip-host:focus-within .mlstip-pop,',
      '.mlstip-host.mlstip-open .mlstip-pop{opacity:1;visibility:visible;transform:translateY(0);}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function convertOne(sub) {
    try {
      if (!sub || sub.getAttribute(DONE_ATTR)) return;
      var btn = sub.closest ? sub.closest('.ez-btn') : null;
      if (!btn) {
        // fall back: nearest button ancestor
        var p = sub.parentNode;
        while (p && p !== document && !(p.tagName === 'BUTTON')) p = p.parentNode;
        btn = (p && p.tagName === 'BUTTON') ? p : null;
      }
      if (!btn) return;

      var text = (sub.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) { sub.setAttribute(DONE_ATTR, '1'); return; }

      var prevHtml = sub.innerHTML;
      var prevDisplay = sub.style.display;

      // 1) hide the always-visible inline description
      sub.style.display = 'none';
      sub.setAttribute(DONE_ATTR, '1');

      // 2) mark the button as the popover anchor
      btn.classList.add('mlstip-host');

      // 3) add a tiny info affordance after the label (skip if one exists)
      if (!btn.querySelector('.mlstip-info')) {
        var info = ce('span', 'mlstip-info');
        info.textContent = 'ⓘ'; // circled i
        info.setAttribute('aria-hidden', 'true');
        // place the affordance right before the (now-hidden) sub so it sits by the label
        if (sub.parentNode === btn) btn.insertBefore(info, sub);
        else btn.appendChild(info);
      }

      // 4) build the popover with the preserved text
      var tipId = 'mlstip-' + (++seq);
      var pop = ce('span', 'mlstip-pop');
      pop.id = tipId;
      pop.setAttribute('role', 'tooltip');
      pop.textContent = text;
      btn.appendChild(pop);

      // 5) wire accessibility + tap-to-toggle on touch devices
      btn.setAttribute('aria-describedby', tipId);
      var onTouch = function () { try { btn.classList.toggle('mlstip-open'); } catch (e) {} };
      btn.addEventListener('touchstart', onTouch, { passive: true });

      converted.push({ sub: sub, btn: btn, pop: pop, prevHtml: prevHtml, prevDisplay: prevDisplay, onTouch: onTouch, tipId: tipId });
    } catch (e) {}
  }

  // close any open tap-tooltip when tapping elsewhere
  var _docTouch = null;
  function installOutsideClose() {
    if (_docTouch) return;
    _docTouch = function (ev) {
      try {
        for (var i = 0; i < converted.length; i++) {
          var b = converted[i].btn;
          if (b && b.classList.contains('mlstip-open') && !b.contains(ev.target)) {
            b.classList.remove('mlstip-open');
          }
        }
      } catch (e) {}
    };
    try { document.addEventListener('touchstart', _docTouch, true); } catch (e) {}
  }

  function pass() {
    try {
      injectStyle();
      var subs = document.querySelectorAll('.' + SUB + ':not([' + DONE_ATTR + '])');
      for (var i = 0; i < subs.length; i++) convertOne(subs[i]);
    } catch (e) {}
  }

  function schedulePass() {
    if (_raf) return;
    var run = function () { _raf = 0; pass(); };
    if (W.requestAnimationFrame) _raf = W.requestAnimationFrame(run); else _raf = setTimeout(run, 16);
  }

  function startObserver() {
    try {
      _obs = new MutationObserver(function () { schedulePass(); });
      _obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    // slow safety poll: re-decorate if the centerpiece re-renders its cards
    _pollT = setInterval(function () { schedulePass(); }, 1500);
  }

  function boot() {
    injectStyle();
    installOutsideClose();
    pass();
    startObserver();
  }

  function revert() {
    try { if (_obs) { _obs.disconnect(); _obs = null; } } catch (e) {}
    try { if (_pollT) { clearInterval(_pollT); _pollT = null; } } catch (e) {}
    try { if (_raf && W.cancelAnimationFrame) W.cancelAnimationFrame(_raf); } catch (e) {}
    _raf = 0;
    try { if (_docTouch) { document.removeEventListener('touchstart', _docTouch, true); _docTouch = null; } } catch (e) {}
    // restore every converted sub + remove the tooltip scaffolding
    converted.forEach(function (c) {
      try {
        if (c.pop && c.pop.parentNode) c.pop.parentNode.removeChild(c.pop);
        var info = c.btn && c.btn.querySelector ? c.btn.querySelector('.mlstip-info') : null;
        if (info && info.parentNode) info.parentNode.removeChild(info);
        if (c.btn) {
          c.btn.classList.remove('mlstip-host', 'mlstip-open');
          if (c.btn.getAttribute('aria-describedby') === c.tipId) c.btn.removeAttribute('aria-describedby');
          if (c.onTouch) { try { c.btn.removeEventListener('touchstart', c.onTouch, { passive: true }); } catch (e) {} }
        }
        if (c.sub) {
          c.sub.style.display = c.prevDisplay || '';
          c.sub.removeAttribute(DONE_ATTR);
        }
      } catch (e) {}
    });
    converted = [];
    try { var st = document.getElementById(STYLE_ID); if (st) st.remove(); } catch (e) {}
    if (W.__mlsCardTips) W.__mlsCardTips.installed = false;
  }

  W.__mlsCardTips = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    pass: pass,
    convertOne: convertOne,
    _converted: function () { return converted; },
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
