/* feat_mls_uifix_20260624.js  ->  window.__mlsUiFix   (uifix-1.0.0)
 *
 *  Additive, reversible UI fix pack. Loaded by BOTH connect bundles (staging +
 *  prod). Pure corrective CSS + one idempotent DOM relocation; moves no app data,
 *  deletes nothing. ASCII-only. Idempotent (no flicker / no re-render loop).
 *
 *  FIX 2c  "Find anything" search results never appeared. feat_mls_header_exact
 *          relocated #mlsPqsInput into the blue-bar slot #mlsRdSearchSlot, but the
 *          results panel #mlsPqsPanel stayed inside the hidden original toolbar,
 *          and feat_mls_topbar_unify injected #mlsPqsPanel{display:none!important}.
 *          We move #mlsPqsPanel into the (position:relative) slot so it anchors
 *          under the input, and override the suppression with a higher-specificity
 *          rule so the dropdown shows on every use.
 *
 *  Also: minor Analysis tile tidy + smoother copilot-thread overscroll (CSS only).
 *  (The Analysis Expand/Collapse scroll-jump and the MLS Copilot scroll reset are
 *  fixed at the source in feat_mls_analysis_exact.js ax-2.1.4 and
 *  feat_mls_studio_exact.js sx-2.0.2 -- idempotent re-ordering.)
 *
 *  Reversible: window.__mlsUiFix.revert().
 */
;(function () {
  "use strict";
  try { if (window.__mlsUiFix && window.__mlsUiFix.installed) return; } catch (e) { return; }
  var VERSION = "uifix-1.0.0";
  var STYLE_ID = "mlsUiFixStyle";
  function $(id) { return document.getElementById(id); }

  function injectCSS() {
    if ($(STYLE_ID)) return;
    var css = [
      /* 2c: re-enable the native quick-find results panel inside the blue-bar slot */
      "#mlsRdSearchSlot{position:relative}",
      "#mlsRdSearchSlot #mlsPqsPanel{display:none}",
      "#mlsRdSearchSlot #mlsPqsPanel.show{display:block!important}",
      /* smoother copilot thread overscroll */
      "#studioView #copilotThread{overscroll-behavior:contain;-webkit-overflow-scrolling:touch}",
      /* gentle Analysis tile tidy (even collapsed previews, soft hover) */
      "#analysisView.ax-grid .ax-tile:not(.ax-exp){min-height:150px}",
      "#analysisView.ax-grid .ax-tile:not(.ax-exp):hover{box-shadow:0 8px 22px -14px rgba(13,33,56,.45);transform:translateY(-1px)}",
      "#analysisView.ax-grid .ax-prev{gap:2px}"
    ].join("");
    var s = document.createElement("style");
    s.id = STYLE_ID; s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
  }

  var _pqsOrigParent = null;
  function fixSearch() {
    var slot = $("mlsRdSearchSlot"), panel = $("mlsPqsPanel");
    if (!slot || !panel) return;
    if (panel.parentElement !== slot) {              /* idempotent: only when not already there */
      if (!_pqsOrigParent) _pqsOrigParent = panel.parentElement;
      try { if (getComputedStyle(slot).position === "static") slot.style.position = "relative"; } catch (e) {}
      slot.appendChild(panel);
    }
  }

  var _obs = null, _t = null;
  function apply() { try { injectCSS(); } catch (e) {} try { fixSearch(); } catch (e) {} }
  function boot() {
    apply();
    try { _obs = new MutationObserver(function () { fixSearch(); }); } catch (e) {}
    try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
    var n = 0; _t = setInterval(function () { apply(); if (++n > 12) clearInterval(_t); }, 800);
  }
  function revert() {
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_t) clearInterval(_t); } catch (e) {}
    try {
      var panel = $("mlsPqsPanel");
      if (panel && _pqsOrigParent && panel.parentElement !== _pqsOrigParent) _pqsOrigParent.appendChild(panel);
    } catch (e) {}
    try { window.__mlsUiFix.installed = false; } catch (e) {}
  }

  window.__mlsUiFix = { installed: true, version: VERSION, reapply: boot, revert: revert, apply: apply };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
