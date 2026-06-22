/*!
 * feat_mls_contrast_fix.js  ->  window.__mlsContrastFix  (v1.1.0)
 * ---------------------------------------------------------------------------
 * PURPOSE (contrast regression fix, additive + reversible)
 *   MLS Easy renders description sub-text as <span class="mlscp-sub"> INSIDE
 *   light/near-white <button class="ez-btn ..."> cards (dark-blue titles). These
 *   appear in two places:
 *     - 67 centerpiece (feat_mls_centerpiece.js): the four "Pull ..." cards in
 *       #mlscpPulls  (today / this week / pull-open / find).
 *     - 70 protocol  (feat_mls_protocol.js): the finish-tail buttons
 *       "Write note to Athena chart" (#mlsProtoWrite) and "After-visit summary"
 *       (#mlsProtoAvs).
 *
 *   The 70 sizing/readability pass globally forced
 *       .mlscp-sub { color:#eef5ff !important; ... }   (near-WHITE)
 *   which is correct for the .mlscp-note / .mlscp-or lines that sit on the BLUE
 *   container, but makes EVERY in-button .mlscp-sub description WHITE-ON-(near)
 *   WHITE inside the light cards -> unreadable.
 *
 * WHAT THIS DOES
 *   Injects ONE higher-specificity !important rule that re-colors EVERY .mlscp-sub
 *   that lives INSIDE a light .ez-btn (pull cards AND finish-tail, anywhere in the
 *   app), to a dark, high-contrast navy (#13243a; ~14:1 on white):
 *       .ez-btn .mlscp-sub { color:#13243a !important; opacity:1 !important; }
 *
 *   It deliberately does NOT touch .mlscp-note / .mlscp-or (on the BLUE
 *   container), the disabled "athenaOne not detected" warning .mlscp-sub (inside
 *   .mlscp-note, no .ez-btn ancestor), .mlspp-wrap / .mlspp-hint, the
 *   .mlscp-acting / .mlscp-walk banners, or #mlsProtoGrid spans (already dark).
 *
 *   Pure CSS via one <style> tag => applies to all current AND future buttons.
 *
 * SAFETY / INTEGRITY
 *   - Additive own-IIFE. Touches nothing but its own <style> element.
 *   - Idempotent; fully reversible via window.__mlsContrastFix.revert().
 *   - No network, no extension messages, no app-DOM mutation, no data read or
 *     written, no PHI. Never clicks Save/Sign and never writes a chart.
 *   - Higher specificity than the 70 rule (0,2,0 vs 0,1,0) AND loads after it,
 *     so it wins deterministically among !important declarations.
 */
(function () {
  'use strict';

  var VERSION = '1.1.0';
  var STYLE_ID = 'mlsContrastFixStyle';

  // Dark, high-contrast navy - the app's existing dark-text token
  // (used by .mlspp-wrap select and #mlsProtoScratch). ~14:1 on a white card.
  var INK = '#13243a';

  // EVERY description span INSIDE a light .ez-btn (pull cards AND finish-tail).
  // Two classes => specificity (0,2,0) with !important, which beats 70's bare
  // ".mlscp-sub" (0,1,0); and this asset loads after 70 -> deterministic win.
  // The only .mlscp-sub NOT matched is the disabled-athenaOne warning, which is
  // inside .mlscp-note (no .ez-btn ancestor) on the blue container -> stays light.
  var CSS = [
    '.ez-btn .mlscp-sub{',
      'color:', INK, ' !important;',
      'opacity:1 !important;',
    '}'
  ].join('');

  function injectStyle() {
    try {
      var doc = document;
      var existing = doc.getElementById(STYLE_ID);
      if (existing) {
        if (existing.textContent !== CSS) existing.textContent = CSS;
        return existing;
      }
      var st = doc.createElement('style');
      st.id = STYLE_ID;
      st.setAttribute('data-mls-asset', 'feat_mls_contrast_fix.js');
      st.textContent = CSS;
      (doc.head || doc.documentElement).appendChild(st);
      return st;
    } catch (e) {
      return null;
    }
  }

  function removeStyle() {
    try {
      var st = document.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
    } catch (e) {}
  }

  var api = {
    version: VERSION,
    installed: false,
    css: CSS,
    ink: INK,
    install: function () {
      var st = injectStyle();
      this.installed = !!st;
      return this.installed;
    },
    revert: function () {
      removeStyle();
      this.installed = false;
      return true;
    }
  };

  try {
    var prev = window.__mlsContrastFix;
    if (prev && prev.installed && prev.version === VERSION) {
      // already installed by an earlier load of the same version - no-op
    } else {
      if (prev && typeof prev.revert === 'function') {
        try { prev.revert(); } catch (e) {}
      }
      window.__mlsContrastFix = api;
      api.install();
    }
  } catch (e) {
    try { window.__mlsContrastFix = api; } catch (e2) {}
  }
})();
