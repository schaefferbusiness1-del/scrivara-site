/* feat_mls_easy_contrast.js -> window.__mlsEasyContrast (v1.0.0)
 *
 * CONTRAST FIX (CSS-only, additive, fully reversible).
 *
 * On the MLS Easy Step 1 "Who are you seeing?" blue hero, some helper/caption
 * text rendered in a dark slate (e.g. the ".mlsaa-intent" line that sits right
 * next to the green READ-ONLY chip: "READ-ONLY  Pull today's schedule -> brings
 * in today's patients from Athena."). Dark text on the blue background is hard
 * to read, especially at narrow / mobile widths.
 *
 * This injects ONE <style> that lifts that text to a high-contrast light color,
 * SCOPED to #mlsEasyPanel so we do not touch:
 *   - the white "Pull today's patients" primary card (its dark navy text stays),
 *   - the green READ-ONLY chip itself (kept readable on its light-green chip bg),
 *   - any readable light-card text elsewhere in the app (out of scope by id).
 *
 * SAFETY: no DOM behavior changes, no JS hooks, no network. Pure presentational
 * override. window.__mlsEasyContrast.revert() removes the style. ASCII-only.
 */
(function () {
  'use strict';
  try { if (window.__mlsEasyContrast && window.__mlsEasyContrast.installed) return; } catch (e) {}

  var VERSION = '1.0.0';
  var STYLE_ID = 'mlsEasyContrastFix';

  var CSS = [
    /* Caption/intent text next to the READ-ONLY chip on the blue hero */
    '#mlsEasyPanel .mlsaa-intent{color:#eaf2ff !important;}',
    '#mlsEasyPanel .mlsaa-intent b,#mlsEasyPanel .mlsaa-intent strong{color:#ffffff !important;}',
    /* Helper notes + the "Tip:" / provider hint lines on the blue hero */
    '#mlsEasyPanel .mlscp-note,#mlsEasyPanel .mlspp-hint{color:#eaf2ff !important;}',
    '#mlsEasyPanel .mlscp-note b,#mlsEasyPanel .mlscp-note strong,',
    '#mlsEasyPanel .mlspp-hint b,#mlsEasyPanel .mlspp-hint strong{color:#ffffff !important;}',
    /* KEEP the READ-ONLY chip: keep it dark-green on its light-green chip bg */
    '#mlsEasyPanel .mlsaa-intent [class*="tag"]{color:#0f5132 !important;}'
  ].join('\n');

  function inject() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      var st = document.createElement('style');
      st.id = STYLE_ID;
      st.type = 'text/css';
      st.textContent = CSS;
      (document.head || document.documentElement).appendChild(st);
    } catch (e) {}
  }

  function revert() {
    try { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
    try { window.__mlsEasyContrast.installed = false; } catch (e) {}
  }

  window.__mlsEasyContrast = { installed: true, version: VERSION, asset: 'feat_mls_easy_contrast.js', inject: inject, revert: revert };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', inject);
    else inject();
  } catch (e) { try { inject(); } catch (e2) {} }
})();
