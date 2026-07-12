/* =========================================================================
 * MLS -- Theme Polish  (feat_mls_theme_polish.js -> window.__mlsThemePolish, thm-1.0.0)
 * 2026-07-12, final integration sweep (owner-requested visual pass).
 * ----------------------------------------------------------------------------
 * 1. LIGHTER-BLUE scheme for MLS Easy: the app header and the visit hero move
 *    from near-navy (rgb(13,33,56)...) to a lighter clinical blue family
 *    (#2f6fe4 -> #4b8ef5). Deliberately NOT pastel: white text on every
 *    recolored surface keeps >= 4.5:1 (checked against #2f6fe4 / #3b7ceb).
 *    The base --accent lightens #2f5fd0 -> #3b76e8.
 * 2. BUTTON polish across the app: consistent depth (soft shadow), hover lift,
 *    pressed state, and a visible keyboard focus ring; the flat green/ghost
 *    button pair gets a fresher, less-default gradient. Known button classes
 *    only -- no universal selectors that could disturb layouts.
 * 3. Smooth VIEW TRANSITIONS: a 160 ms fade+rise when switching main views
 *    (wraps showView additively). Honors prefers-reduced-motion.
 * All CSS lives in ONE style node; the showView wrap is guarded; everything is
 * reversible: window.__mlsThemePolish.revert().
 * Overrides use stylesheet !important, which beats the redesign module's
 * inline (non-important) styles without fighting its re-assertion ticks.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsThemePolish && window.__mlsThemePolish.installed) return; } catch (e) { return; }

  /* thm-1.1.0: MLS Easy visual pass -- consistent card treatment on the Visit
   *   view (uniform radius, calmer borders, soft elevation + gentle hover),
   *   tidier section headers, and a subtle polish on the collapsible extra
   *   cards, so the Easy flow reads as one designed surface rather than a
   *   stack of differently-styled boxes. */
  /* thm-1.1.1: LIVE FREEZE FIX -- keepLast() style-node re-append removed (full
   *   document style recalc every 3 s on big DOMs); permanent will-change
   *   compositor layers on button classes removed. Visuals unchanged. */
  var VERSION = 'thm-1.1.1';
  var STYLE_ID = 'mlsThemePolishStyle';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }

  function css() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      /* ---------- 1. lighter blue surfaces ----------
         "html" prefix keeps specificity above the sibling styling modules'
         !important rules; keepLast() (below) wins any residual order battles. */
      ':root{--accent:#3b76e8;}',
      'html body #appHeader#appHeader{background:linear-gradient(180deg,#2456c8 0%,#2f6fe4 100%)!important;border-bottom:1px solid rgba(255,255,255,.14)!important;box-shadow:0 2px 14px rgba(30,80,180,.28)!important}',
      'html body #visitHero#visitHero#visitHero{background:linear-gradient(135deg,#3b7ceb 0%,#2f66d6 60%,#2a5cc4 100%)!important;box-shadow:0 8px 26px rgba(43,92,196,.30)!important}',
      /* nav pills sit on the lighter header: keep them readable */
      'html #appHeader [id^="nav_"]{transition:background .15s,color .15s}',

      /* ---------- 2. button polish ---------- */
      'html .btn-green,html .btn-ghost,html .btn-blue,html .btn-red,html button.edit,html #authBtn{transition:transform .13s ease,box-shadow .13s ease,filter .13s ease!important}',
      'html body .btn-green.btn-green.btn-green{background:linear-gradient(135deg,#17a56c 0%,#0d8a58 100%)!important;box-shadow:0 3px 10px rgba(16,150,98,.28)!important;border:0!important}',
      'html body .btn-green.btn-green:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(16,150,98,.36)!important;filter:brightness(1.04)}',
      'html body .btn-green.btn-green:active{transform:translateY(0);box-shadow:0 2px 6px rgba(16,150,98,.3)!important}',
      'html body .btn-ghost.btn-ghost.btn-ghost{border:1px solid #c9dcf5!important;color:#2d63d6!important;box-shadow:0 1px 4px rgba(40,80,160,.08)!important}',
      'html body .btn-ghost.btn-ghost:hover{background:#eef5ff!important;transform:translateY(-1px);box-shadow:0 4px 12px rgba(40,80,160,.14)!important}',
      'html body .btn-ghost.btn-ghost:active{transform:translateY(0)}',
      'html body .btn-blue.btn-blue.btn-blue{background:linear-gradient(135deg,#4b8ef5 0%,#2f6fe4 100%)!important;box-shadow:0 3px 10px rgba(47,111,228,.30)!important;border:0!important;color:#fff!important}',
      'html body .btn-blue.btn-blue:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(47,111,228,.38)!important}',
      'html body .btn-red:hover{transform:translateY(-1px)}',
      'html body button.edit:hover{transform:translateY(-1px)}',
      'html .btn-green:focus-visible,html .btn-ghost:focus-visible,html .btn-blue:focus-visible,html #authBtn:focus-visible{outline:3px solid rgba(75,142,245,.45)!important;outline-offset:2px!important}',

      /* ---------- 2b. MLS Easy card consistency (visit view) ---------- */
      'html body #visitView .card,html body #visitView .extra-card{border-radius:16px!important;border-color:#dbe7f5!important;box-shadow:0 3px 14px rgba(25,60,130,.07)!important;transition:box-shadow .18s ease}',
      'html body #visitView .card:hover,html body #visitView .extra-card:hover{box-shadow:0 6px 20px rgba(25,60,130,.11)!important}',
      'html body #visitView .extra-card h3{letter-spacing:.01em}',
      'html body #visitView .card h1,html body #visitView .card h2{letter-spacing:-.01em}',

      /* ---------- 3. view transitions + micro polish ---------- */
      '@keyframes mlsThmViewIn{from{opacity:.35;transform:translateY(5px)}to{opacity:1;transform:none}}',
      '.mls-thm-viewin{animation:mlsThmViewIn .16s ease-out}',
      '@media (prefers-reduced-motion: reduce){.mls-thm-viewin{animation:none}.btn-green,.btn-ghost,.btn-blue,.btn-red,button.edit{transition:none!important}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  /* view-transition wrap: additive, guarded, restorable */
  var wrapped = false;
  function wrapShowView() {
    if (wrapped) return;
    if (!isFn(window.showView) || window.showView.__thmWrapped) { wrapped = !!(window.showView && window.showView.__thmWrapped); return; }
    var orig = window.showView;
    var w = function (view) {
      var r;
      try { r = orig.apply(this, arguments); } catch (e) {}
      safe(function () {
        var el = document.getElementById(String(view) + 'View');
        if (el && el.offsetParent) {
          el.classList.remove('mls-thm-viewin');
          void el.offsetWidth;               /* restart the animation */
          el.classList.add('mls-thm-viewin');
        }
      });
      return r;
    };
    w.__thmWrapped = true; w.__thmOrig = orig;
    window.showView = w;
    wrapped = true;
  }

  /* thm-1.1.1 FREEZE FIX: the old keepLast() re-appended this style node every
     3 s to stay last in <head>. Re-inserting a <style> invalidates the ENTIRE
     document's styles -- imperceptible on a small test DOM, a heavy recurring
     synchronous hit on a clinic-scale DOM (the owner's live freeze, 07-12).
     It was also unnecessary: every contested rule here is specificity-stacked
     (#id#id / .cls.cls.cls + !important), which beats the sibling modules'
     rules regardless of document order. So: insert the node ONCE, never move
     it, and keep the tick to cheap existence checks only. */

  var tickIv = null;
  function boot() {
    css();
    wrapShowView();
    tickIv = setInterval(function () { safe(css); safe(wrapShowView); }, 3000);
  }
  function revert() {
    if (tickIv) { clearInterval(tickIv); tickIv = null; }
    var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s);
    try { if (window.showView && window.showView.__thmWrapped && window.showView.__thmOrig) window.showView = window.showView.__thmOrig; } catch (e) {}
    try { window.__mlsThemePolish.installed = false; } catch (e) {}
    return 'theme polish reverted';
  }

  window.__mlsThemePolish = { installed: true, version: VERSION, asset: 'feat_mls_theme_polish.js', revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
