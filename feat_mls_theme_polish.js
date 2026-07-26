/* =========================================================================
 * MLS -- Theme Polish  (feat_mls_theme_polish.js -> window.__mlsThemePolish)
 * ----------------------------------------------------------------------------
 * thm-2.3.0 (2026-07-18, stable navigation): this module is now the
 * final "calm polish + micro-interaction" layer that loads LAST and wins any
 * residual specificity battles (specificity-stacked selectors + !important,
 * NO style-node re-appending -- see thm-1.1.1 freeze lesson below).
 *  1. BUTTON polish: consistent calm depth, gentle hover lift, pressed state,
 *     green keyboard focus ring. No gradients -- flat deep-green primaries.
 *  2. STABLE VIEW CHANGES: routes render immediately at full opacity. The old
 *     whole-view fade/rise made every navigation visibly dim and pop.
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

  var VERSION = 'thm-2.3.0';
  var STYLE_ID = 'mlsThemePolishStyle';
  /* thm-2.1.0: (a) serif display headers inside modals (Editorial Calm), and
   * (b) a UNIVERSAL, guarded dismiss for .modal-bg overlays: Escape closes the
   * topmost visible modal, clicking the backdrop closes it too. This fixes the
   * long-standing "overlay can't be dismissed" bug class (reviews/send modals)
   * in ONE place instead of per-modal patches. A modal can opt out by setting
   * data-mls-no-esc="1" on its .modal-bg. Prefers the modal's own close control
   * so app state stays consistent; only force-hides as a last resort. */

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
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

      /* ---------- 3. loading micro-interactions ---------- */
      '.mls-busy{position:relative;pointer-events:none;opacity:.75}',
      '.mls-busy::after{content:"";position:absolute;right:10px;top:50%;width:13px;height:13px;margin-top:-7px;border:2px solid rgba(46,106,75,.25);border-top-color:#2E6A4B;border-radius:50%;animation:mlsThmSpin .7s linear infinite}',
      '@keyframes mlsThmSpin{to{transform:rotate(360deg)}}',
      'html button:disabled{opacity:.62;cursor:default}',
      /* ---------- 4. calm modal typography ---------- */
      'html body .modal>h2:first-child,html body .modal>h3:first-child,html body .modal .mls-modal-title{font-family:Newsreader,Georgia,serif!important;font-weight:600!important;letter-spacing:-.012em!important;font-size:21px!important}',
      '@media (prefers-reduced-motion: reduce){.mls-busy::after{animation:none}.btn-green,.btn-ghost,.btn-blue,.btn-red,button.edit{transition:none!important}}'
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

  /* ---------- universal modal FOCUS (thm-2.1.0) ----------
   * This file already owns universal dismiss for every .modal-bg, and that made
   * a gap: Escape now closes a dialog and leaves focus NOWHERE — on <body>,
   * with the next Tab starting from the top of the document.
   *
   * Audited across ScribeFlow.html: only #patientModal handles focus properly
   * (stash activeElement, trap Tab, restore on close). #helpModal focuses a
   * field but never restores. The other TWELVE — settings, teamPt, setup,
   * opPrep, templates, doc, view, share, legal, countersign, legalFill,
   * widgetBuilder — are a bare classList.add('show'): a keyboard user opens a
   * dialog and their focus is still behind it, so Tab walks the page underneath
   * a modal they cannot see past.
   *
   * Fixed HERE rather than at the twelve call sites, for the same reason the
   * dismiss lives here: one writer, and it covers every modal including ones
   * nobody has written yet. Editing twelve openers would have missed the
   * thirteenth.
   *
   * Reuses the app's own _patientModalFocusables() when present, so "what counts
   * as focusable" has exactly one definition. */
  var focusWired = false;
  var returnTo = null;

  function focusablesIn(modal) {
    try {
      if (typeof window._patientModalFocusables === 'function') {
        var rows = window._patientModalFocusables(modal);
        if (rows && rows.length) return rows;
      }
    } catch (e) {}
    try {
      return [].slice.call(modal.querySelectorAll(
        'button,a[href],input:not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])'
      )).filter(function (el) {
        if (el.disabled || el.getAttribute('aria-hidden') === 'true') return false;
        var r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      });
    } catch (e) { return []; }
  }

  function onModalShown(bg) {
    /* remember where the keyboard was, once — a re-render must not overwrite it
       with something inside the modal */
    if (!returnTo) {
      var a = document.activeElement;
      returnTo = (a && a !== document.body && a !== document.documentElement && !bg.contains(a)) ? a : null;
    }
    if (bg.contains(document.activeElement)) return;   /* already inside */
    var rows = focusablesIn(bg);
    try {
      if (rows.length) rows[0].focus();
      else { bg.setAttribute('tabindex', '-1'); bg.focus(); }
    } catch (e) {}
  }

  function onModalHidden() {
    var back = returnTo; returnTo = null;
    /* only if it still exists and is still focusable — a closed modal often
       destroys the row that opened it */
    try {
      if (back && document.contains(back) && back.getBoundingClientRect().width > 0) back.focus();
    } catch (e) {}
  }

  /* PER-ELEMENT observers, deliberately NOT a document-wide subtree one.
   *
   * The first version used one observer on document.documentElement with
   * subtree:true, and boot-script-budget rejected it as the 60th such observer
   * against a ceiling of 59. That guard was right, and raising the ceiling would
   * have been the lazy read: a document-wide subtree observer watching class and
   * style fires on EVERY DOM change every other module makes, and this app has
   * documented idle churn. Watching fourteen elements costs a rounding error;
   * watching the document costs a callback per mutation forever.
   *
   * A modal opening is an attribute change on the modal ITSELF, so subtree was
   * never needed — it was reach for elements that do not exist yet, and a
   * childList watch on body (no subtree) covers those far more cheaply. */
  var watched = new WeakSet();
  var seen = new WeakMap();

  function watchModal(bg) {
    if (!bg || watched.has(bg)) return;
    watched.add(bg);
    try { seen.set(bg, getComputedStyle(bg).display !== 'none'); } catch (e) {}
    try {
      new MutationObserver(function () {
        var open = false;
        try { open = getComputedStyle(bg).display !== 'none'; } catch (e) {}
        if (open === seen.get(bg)) return;      /* no change — never re-focus */
        seen.set(bg, open);
        if (open) onModalShown(bg); else onModalHidden();
      }).observe(bg, { attributes: true, attributeFilter: ['class', 'style'] });
    } catch (e) {}
  }

  function scanModals() {
    try {
      var els = document.querySelectorAll('.modal-bg');
      for (var i = 0; i < els.length; i++) watchModal(els[i]);
    } catch (e) {}
  }

  function wireFocus() {
    if (focusWired) return; focusWired = true;
    scanModals();
    try {
      /* modals appended later — body childList only, NO subtree */
      new MutationObserver(scanModals).observe(document.body, { childList: true });
    } catch (e) {}
  }

  /* thm-1.1.1 FREEZE LESSON (kept in 2.0.0): never re-append the style node --
     re-inserting a <style> invalidates the ENTIRE document's styles, a heavy
     recurring synchronous hit on a clinic-scale DOM. Insert ONCE; the tick is
     a cheap existence check only. */

  function boot() {
    css();
    wireDismiss();
    wireFocus();
  }
  function revert() {
    var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s);
    try { window.__mlsThemePolish.installed = false; } catch (e) {}
    return 'theme polish reverted';
  }

  window.__mlsThemePolish = { installed: true, version: VERSION, asset: 'feat_mls_theme_polish.js', revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
