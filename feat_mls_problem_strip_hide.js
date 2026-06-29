/* feat_mls_problem_strip_hide.js — item65
 * Remove the Active Problems strip from the VISIT SCREEN only.
 *
 * What this does: hides + quiets the Visit-view Active Problems strip
 * (#mlsProblemStrip, item48 / window.__mlsProblemStrip) so it no longer renders
 * above the Capture / Note / EMR columns (.vx-grid) on the Visit screen.
 *
 * What this deliberately does NOT touch:
 *   - The Allergy safety strip (item45, #mlsAllergyStrip / window.__mlsAllergyStrip)
 *     stays on the Visit screen exactly as before.
 *   - The Patient Snapshot popover (item49, window.__mlsPatientSnapshot) keeps
 *     showing BOTH Allergies AND Active problems — it reads
 *     window.activePatient().problems directly (parseList), independent of the
 *     #mlsProblemStrip DOM node, so quieting the strip does not affect it.
 *   - No patient data is read, written, or mutated. athenaOne untouched.
 *
 * Mechanism (additive, display-only, fully reversible):
 *   1. Inject a defensive stylesheet hiding #mlsProblemStrip.
 *   2. Call window.__mlsProblemStrip.revert() (item48's own reversible teardown:
 *      stops its 1100ms render loop and removes its node + style).
 *   3. A light watchdog re-hides the strip if anything re-injects it.
 *
 * Reversible: window.__mlsProblemStripHide.revert()
 *   revert() removes the defensive style, stops the watchdog, and re-enables
 *   item48 by re-injecting feat_mls_problem_strip.js (its IIFE re-initialises),
 *   restoring the Visit-screen Active Problems strip exactly as before.
 */
(function () {
  if (window.__mlsProblemStripHide && window.__mlsProblemStripHide.__live) return;

  var STYLE_ID = 'mlsProblemStripHide-style';
  var STRIP_ID = 'mlsProblemStrip';
  var ASSET = 'feat_mls_problem_strip.js';
  var timer = null;

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = '#' + STRIP_ID + '{display:none !important;}';
    (document.head || document.documentElement).appendChild(s);
  }

  // Reversibly silence item48: stop its render loop and drop its node.
  function quietModule() {
    try {
      var m = window.__mlsProblemStrip;
      if (m && typeof m.revert === 'function' && !m.__reverted) m.revert();
    } catch (e) {}
  }

  function sweep() {
    if (window.__mlsProblemStripHide && window.__mlsProblemStripHide.__reverted) return;
    quietModule();
    var n = document.getElementById(STRIP_ID);
    if (n) n.style.display = 'none';
  }

  function start() {
    addStyle();
    quietModule();
    sweep();
    if (timer) clearInterval(timer);
    timer = setInterval(sweep, 1500);
  }

  window.__mlsProblemStripHide = {
    __live: true,
    __reverted: false,
    sweep: sweep,
    revert: function () {
      this.__reverted = true;
      this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      var st = document.getElementById(STYLE_ID);
      if (st && st.parentNode) st.parentNode.removeChild(st);
      // Re-enable item48 by re-injecting its module; its IIFE re-initialises
      // because we clear __live below.
      try {
        if (window.__mlsProblemStrip) {
          window.__mlsProblemStrip.__reverted = false;
          window.__mlsProblemStrip.__live = false;
        }
        var ex = document.querySelector('script[data-mls-asset="' + ASSET + '"]');
        if (ex && ex.parentNode) ex.parentNode.removeChild(ex);
        var s = document.createElement('script');
        s.src = ASSET + '?v=revive' + Date.now();
        s.setAttribute('data-mls-asset', ASSET);
        s.async = false;
        (document.body || document.head || document.documentElement).appendChild(s);
      } catch (e) {}
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
