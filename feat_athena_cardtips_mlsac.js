/*! feat_athena_cardtips_mlsac.js  ->  window.__mlsCardTipsMlsac  (v1.0.0)
 * =====================================================================
 * SECONDARY 2 — extend the day-pull card tooltip treatment to the variant
 * the doctor actually sees.
 *
 * The §cardtips fix (feat_athena_cardtips.js / __mlsCardTips) relocates the
 * long inline description into a hover/focus/tap tooltip, but it ONLY targets
 * the §67 centerpiece `.mlscp-sub`. On the LIVE day-pull screen the cards are
 * the §64 clarity variant: `<button data-mlsac ...> Label
 *   <span class="mlsac-tag">READ-ONLY</span>
 *   <span class="mlsac-sub">long inline description…</span></button>`
 * — and `.mlsac-sub` is shown INLINE (display:block), so those cards still read
 * cluttered. (Verified live: 7 `.mlsac-sub`, 0 `.mlscp-sub` on the day-pull
 * screen.)
 *
 * This companion applies the SAME treatment to `.mlsac-sub` only:
 *   - the descriptive text is preserved verbatim (moved, not rewritten),
 *   - shown on hover, keyboard focus, and tap (mobile),
 *   - a small "ⓘ" affordance marks more info is available,
 *   - aria-describedby links the button to the tip.
 *
 * It does NOT touch:
 *   - the `.mlsac-tag` READ-ONLY / WRITES-TO-CHART pill (left exactly as-is),
 *   - the `.mlscp-*` centerpiece (owned by __mlsCardTips),
 *   - any button id, handler, or the pull logic.
 *
 * SHAPE: additive own-scope IIFE, idempotent, observer+poll driven (coexists
 * with the §61/§64 observers that re-render these buttons), fully reversible
 * via window.__mlsCardTipsMlsac.revert() (restores the original inline text).
 * No PHI is read or written — it only relocates existing static UI copy. NUL-free.
 * ===================================================================== */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W) return;
  if (W.__mlsCardTipsMlsac && W.__mlsCardTipsMlsac.installed) return;

  var VERSION = '1.0.0';
  var ASSET = 'feat_athena_cardtips_mlsac.js';
  var STYLE_ID = 'mlsCardTipsMlsacStyle';
  var SUB = 'mlsac-sub';             // the inline description class (NOT mlsac-tag)
  var DONE_ATTR = 'data-mlsactip';   // marks a sub we've already converted
  var seq = 0;
  var _obs = null, _raf = 0, _pollT = null, _docTouch = null;
  var converted = []; // {sub, btn, pop, info, prevDisplay, onTouch, tipId, hadDescribedBy, prevDescribedBy}

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function ce(tag, cls) { var el = document.createElement(tag); if (cls) el.className = cls; return el; }

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = ce('style'); st.id = STYLE_ID;
    st.textContent = [
      '.mlsactip-host{position:relative;}',
      '.mlsactip-info{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;',
        'margin-left:7px;border-radius:50%;font-size:11px;font-weight:700;line-height:1;',
        'background:rgba(15,41,66,.16);color:#0f2942;vertical-align:middle;cursor:help;flex:0 0 auto;}',
      '.mlsactip-pop{position:absolute;left:12px;right:12px;top:calc(100% - 4px);z-index:30;',
        'background:#0f2942;color:#eaf2ff;border:1px solid rgba(255,255,255,.22);',
        'border-radius:10px;padding:9px 11px;font-size:11.5px;font-weight:400;line-height:1.4;',
        'box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:0;visibility:hidden;transform:translateY(-4px);',
        'transition:opacity .12s ease,transform .12s ease,visibility .12s;pointer-events:none;text-align:left;white-space:normal;}',
      '.mlsactip-pop:before{content:"";position:absolute;left:18px;top:-6px;width:10px;height:10px;',
        'background:#0f2942;border-left:1px solid rgba(255,255,255,.22);border-top:1px solid rgba(255,255,255,.22);',
        'transform:rotate(45deg);}',
      '.mlsactip-host:hover .mlsactip-pop,',
      '.mlsactip-host:focus-within .mlsactip-pop,',
      '.mlsactip-host.mlsactip-open .mlsactip-pop{opacity:1;visibility:visible;transform:translateY(0);}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  function hostButton(sub) {
    var btn = sub.closest ? sub.closest('button,[data-mlsac]') : null;
    if (btn) return btn;
    var p = sub.parentNode;
    while (p && p !== document && !(p.tagName === 'BUTTON')) p = p.parentNode;
    return (p && p.tagName === 'BUTTON') ? p : null;
  }

  function convertOne(sub) {
    try {
      if (!sub || sub.getAttribute(DONE_ATTR)) return;
      // Never touch the READ-ONLY / WRITES pill.
      if (sub.classList && sub.classList.contains('mlsac-tag')) { sub.setAttribute(DONE_ATTR, '1'); return; }
      var btn = hostButton(sub);
      if (!btn) return;
      var text = (sub.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text) { sub.setAttribute(DONE_ATTR, '1'); return; }

      var prevDisplay = sub.style.display;

      // 1) hide the always-visible inline description
      sub.style.display = 'none';
      sub.setAttribute(DONE_ATTR, '1');

      // 2) mark the button as the popover anchor
      btn.classList.add('mlsactip-host');

      // 3) add a tiny info affordance (skip if one exists)
      var info = null;
      if (!btn.querySelector('.mlsactip-info')) {
        info = ce('span', 'mlsactip-info');
        info.textContent = 'ⓘ';
        info.setAttribute('aria-hidden', 'true');
        // sit it next to the label: insert before the (now hidden) sub if it is a direct child
        if (sub.parentNode === btn) btn.insertBefore(info, sub);
        else btn.appendChild(info);
      }

      // 4) build the popover with the preserved text
      var tipId = 'mlsactip-' + (++seq);
      var pop = ce('span', 'mlsactip-pop');
      pop.id = tipId;
      pop.setAttribute('role', 'tooltip');
      pop.textContent = text;
      btn.appendChild(pop);

      // 5) accessibility + tap-to-toggle
      var hadDescribedBy = btn.hasAttribute('aria-describedby');
      var prevDescribedBy = hadDescribedBy ? btn.getAttribute('aria-describedby') : null;
      btn.setAttribute('aria-describedby', (prevDescribedBy ? (prevDescribedBy + ' ') : '') + tipId);
      var onTouch = function () { try { btn.classList.toggle('mlsactip-open'); } catch (e) {} };
      btn.addEventListener('touchstart', onTouch, { passive: true });

      converted.push({ sub: sub, btn: btn, pop: pop, info: info, prevDisplay: prevDisplay, onTouch: onTouch, tipId: tipId, hadDescribedBy: hadDescribedBy, prevDescribedBy: prevDescribedBy });
    } catch (e) {}
  }

  function installOutsideClose() {
    if (_docTouch) return;
    _docTouch = function (ev) {
      try {
        for (var i = 0; i < converted.length; i++) {
          var b = converted[i].btn;
          if (b && b.classList.contains('mlsactip-open') && !b.contains(ev.target)) b.classList.remove('mlsactip-open');
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
    _raf = (W.requestAnimationFrame ? W.requestAnimationFrame(run) : setTimeout(run, 16));
  }

  function startObserver() {
    try {
      _obs = new MutationObserver(function () { schedulePass(); });
      _obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
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
    converted.forEach(function (c) {
      try {
        if (c.pop && c.pop.parentNode) c.pop.parentNode.removeChild(c.pop);
        if (c.info && c.info.parentNode) c.info.parentNode.removeChild(c.info);
        if (c.btn) {
          c.btn.classList.remove('mlsactip-host', 'mlsactip-open');
          if (c.hadDescribedBy) c.btn.setAttribute('aria-describedby', c.prevDescribedBy);
          else c.btn.removeAttribute('aria-describedby');
          if (c.onTouch) { try { c.btn.removeEventListener('touchstart', c.onTouch, { passive: true }); } catch (e) {} }
        }
        if (c.sub) { c.sub.style.display = c.prevDisplay || ''; c.sub.removeAttribute(DONE_ATTR); }
      } catch (e) {}
    });
    converted = [];
    try { var st = document.getElementById(STYLE_ID); if (st) st.remove(); } catch (e) {}
    if (W.__mlsCardTipsMlsac) W.__mlsCardTipsMlsac.installed = false;
  }

  W.__mlsCardTipsMlsac = {
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
    } else { boot(); }
  } catch (e) { try { boot(); } catch (e2) {} }
})();
