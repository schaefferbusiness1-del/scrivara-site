/* =========================================================================
 * MLS -- Theme Polish  (feat_mls_theme_polish.js -> window.__mlsThemePolish)
 * ----------------------------------------------------------------------------
 * thm-2.2.0 (2026-07-15, Editorial Calm redesign): this module is now the
 * final "calm polish + micro-interaction" layer that loads LAST and wins any
 * residual specificity battles (specificity-stacked selectors + !important,
 * NO style-node re-appending -- see thm-1.1.1 freeze lesson below).
 *  1. BUTTON polish: consistent calm depth, gentle hover lift, pressed state,
 *     green keyboard focus ring. No gradients -- flat deep-green primaries.
 *  2. Smooth VIEW TRANSITIONS: 160ms fade+rise on showView (additive wrap,
 *     guarded, restorable). Honors prefers-reduced-motion.
 *  3. LOADING STATES: any element carrying .mls-busy shows a calm inline
 *     spinner; .mlsRdSkel shimmer (defined in the redesign layer) is the
 *     shared skeleton primitive. Buttons that disable while working keep
 *     their width (no layout pop).
 *  4. Card consistency on the Visit view: uniform radius, calm borders,
 *     soft elevation + gentle hover.
 * thm-1.1.1 lesson KEPT: the style node is inserted ONCE and never moved
 * (re-appending forces whole-document style recalc on clinic-scale DOMs --
 * that was a real live freeze). No permanent will-change layers.
 * Reversible: window.__mlsThemePolish.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsThemePolish && window.__mlsThemePolish.installed) return; } catch (e) { return; }

  var VERSION = 'thm-2.2.0';
  var STYLE_ID = 'mlsThemePolishStyle';
  /* thm-2.1.0: (a) serif display headers inside modals (Editorial Calm), and
   * (b) a UNIVERSAL, guarded dismiss for .modal-bg overlays: Escape closes the
   * topmost visible modal, clicking the backdrop closes it too. This fixes the
   * long-standing "overlay can't be dismissed" bug class (reviews/send modals)
   * in ONE place instead of per-modal patches. A modal can opt out by setting
   * data-mls-no-esc="1" on its .modal-bg. Prefers the modal's own close control
   * so app state stays consistent; only force-hides as a last resort. */

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }

  function css() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      /* ---------- 1. calm button polish ---------- */
      'html .btn-green,html .btn-ghost,html .btn-blue,html .btn-red,html button.edit,html #authBtn{transition:transform .13s ease,box-shadow .13s ease,filter .13s ease,background .18s ease!important}',
      'html body .btn-green.btn-green:hover{transform:translateY(-1px);filter:brightness(1.05)}',
      'html body .btn-green.btn-green:active{transform:translateY(0);filter:brightness(.97)}',
      'html body .btn-ghost.btn-ghost:hover{transform:translateY(-1px)}',
      'html body .btn-ghost.btn-ghost:active{transform:translateY(0)}',
      'html body .btn-blue.btn-blue:hover{transform:translateY(-1px)}',
      'html body .btn-blue.btn-blue:active{transform:translateY(0)}',
      'html body .btn-red:hover{transform:translateY(-1px)}',
      'html body button.edit:hover{transform:translateY(-1px)}',
      'html .btn-green:focus-visible,html .btn-ghost:focus-visible,html .btn-blue:focus-visible,html .btn-primary:focus-visible,html #authBtn:focus-visible{outline:3px solid rgba(46,106,75,.35)!important;outline-offset:2px!important}',

      /* ---------- 2. Visit view card consistency ---------- */
      'html body #visitView .card,html body #visitView .extra-card{border-radius:16px!important;border-color:#E7E5DD!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important;transition:box-shadow .18s ease}',
      'html body #visitView .card:hover,html body #visitView .extra-card:hover{box-shadow:0 6px 20px rgba(20,33,28,.08)!important}',
      'html body.theme-dark #visitView .card,html body.theme-dark #visitView .extra-card{border-color:#2B342D!important}',
      'html body #visitView .extra-card h3{letter-spacing:.01em}',
      'html body #visitView .card h1,html body #visitView .card h2{letter-spacing:-.01em}',

      /* ---------- 3. view transitions + loading micro-interactions ---------- */
      '@keyframes mlsThmViewIn{from{opacity:.35;transform:translateY(5px)}to{opacity:1;transform:none}}',
      '.mls-thm-viewin{animation:mlsThmViewIn .16s ease-out}',
      '.mls-busy{position:relative;pointer-events:none;opacity:.75}',
      '.mls-busy::after{content:"";position:absolute;right:10px;top:50%;width:13px;height:13px;margin-top:-7px;border:2px solid rgba(46,106,75,.25);border-top-color:#2E6A4B;border-radius:50%;animation:mlsThmSpin .7s linear infinite}',
      '@keyframes mlsThmSpin{to{transform:rotate(360deg)}}',
      'html button:disabled{opacity:.62;cursor:default}',
      /* ---------- 4. calm modal typography ---------- */
      'html body .modal>h2:first-child,html body .modal>h3:first-child,html body .modal .mls-modal-title{font-family:Newsreader,Georgia,serif!important;font-weight:600!important;letter-spacing:-.012em!important;font-size:21px!important}',
      '@media (prefers-reduced-motion: reduce){.mls-thm-viewin{animation:none}.mls-busy::after{animation:none}.btn-green,.btn-ghost,.btn-blue,.btn-red,button.edit{transition:none!important}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- universal modal dismiss (Escape + backdrop click) ---------- */
  function visibleModals() {
    var out = [];
    try {
      var els = document.querySelectorAll('.modal-bg');
      for (var i = 0; i < els.length; i++) {
        var e = els[i];
        if (e.getAttribute('data-mls-no-esc') === '1') continue;
        var cs = getComputedStyle(e);
        if (cs.display !== 'none' && cs.visibility !== 'hidden') out.push(e);
      }
    } catch (e) {}
    return out;
  }
  function closeModal(bg) {
    try {
      /* prefer the modal's own close control so app state stays consistent */
      var btn = bg.querySelector('[data-close], .modal-close, .mdl-close, .x, [aria-label="Close"], [title="Close"]');
      if (!btn) {
        var cands = bg.querySelectorAll('button, [onclick]');
        for (var i = 0; i < cands.length; i++) {
          var t = (cands[i].textContent || '').trim();
          var oc = String(cands[i].getAttribute && cands[i].getAttribute('onclick') || '');
          if (t === '×' || t === 'x' || t === 'X' || /close[A-Za-z]*\(/.test(oc)) { btn = cands[i]; break; }
        }
      }
      if (btn) { btn.click(); return true; }
      /* last resort: hide the backdrop (display-toggled modals) */
      bg.classList.remove('show');
      bg.style.display = 'none';
      return true;
    } catch (e) { return false; }
  }
  var dismissWired = false;
  function wireDismiss() {
    if (dismissWired) return; dismissWired = true;
    try {
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape' && e.key !== 'Esc') return;
        var open = visibleModals();
        if (!open.length) return;
        e.preventDefault();
        closeModal(open[open.length - 1]);   /* topmost = last visible */
      }, true);
      document.addEventListener('mousedown', function (e) {
        try {
          var t = e.target;
          if (t && t.classList && t.classList.contains('modal-bg') && t.getAttribute('data-mls-no-esc') !== '1') {
            var cs = getComputedStyle(t);
            if (cs.display !== 'none') closeModal(t);
          }
        } catch (err) {}
      }, true);
    } catch (e) {}
  }

  /* view-transition wrap: additive, guarded, restorable */
  var wrapped = false, viewRaf = null;
  function wrapShowView() {
    if (wrapped) return;
    if (!isFn(window.showView) || window.showView.__thmWrapped) { wrapped = !!(window.showView && window.showView.__thmWrapped); return; }
    var orig = window.showView;
    var w = function (view) {
      var r;
      try { r = orig.apply(this, arguments); } catch (e) {}
      safe(function () {
        var el = document.getElementById(String(view) + 'View');
        if (el && !el.hidden && el.style.display !== 'none') {
          el.classList.remove('mls-thm-viewin');
          if (viewRaf != null && window.cancelAnimationFrame) window.cancelAnimationFrame(viewRaf);
          viewRaf = window.requestAnimationFrame(function () {
            viewRaf = window.requestAnimationFrame(function () {
              viewRaf = null;
              if (!el.hidden && el.style.display !== 'none') el.classList.add('mls-thm-viewin');
            });
          });
        }
      });
      return r;
    };
    w.__thmWrapped = true; w.__thmOrig = orig;
    window.showView = w;
    wrapped = true;
  }

  /* thm-1.1.1 FREEZE LESSON (kept in 2.0.0): never re-append the style node --
     re-inserting a <style> invalidates the ENTIRE document's styles, a heavy
     recurring synchronous hit on a clinic-scale DOM. Insert ONCE; the tick is
     a cheap existence check only. */

  var retryT = null, retryCount = 0;
  function retryBoot() {
    css(); wrapShowView();
    if (!wrapped && retryCount++ < 8) retryT = setTimeout(retryBoot, 500);
  }
  function boot() {
    retryBoot();
    wireDismiss();
  }
  function revert() {
    if (retryT) { clearTimeout(retryT); retryT = null; }
    if (viewRaf != null && window.cancelAnimationFrame) { window.cancelAnimationFrame(viewRaf); viewRaf = null; }
    var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s);
    try { if (window.showView && window.showView.__thmWrapped && window.showView.__thmOrig) window.showView = window.showView.__thmOrig; } catch (e) {}
    try { window.__mlsThemePolish.installed = false; } catch (e) {}
    return 'theme polish reverted';
  }

  window.__mlsThemePolish = { installed: true, version: VERSION, asset: 'feat_mls_theme_polish.js', revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
