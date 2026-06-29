/* feat_mls_ctxbar_age_dedupe.js -- item71
 * De-duplicate the patient age on the active-patient context bar.
 * item41 (feat_mls_patient_age) adds a blue "Age N yrs" chip (.mls-age-ctx)
 * right after the patient name on #mlsCtxBar. But the context bar's own detail
 * line (.mlsctx-meta) already prints the age inline -- e.g. "53y - DOB
 * 03/02/1973 - 1 visit - last seen ...". So the age shows TWICE on the bar.
 * This hides ONLY that redundant context-bar chip, and ONLY while the adjacent
 * meta line already carries the age ("<N>y") or a DOB -- i.e. only when it is
 * genuinely a duplicate. If the meta line ever lacks both, the chip is allowed
 * to show again, so we never strip the age where it is the sole source.
 * It does NOT touch item41's other chips (the live "Age N" hints under the DOB
 * inputs on the hero / manual-entry, class .mls-age-hint), where the age is not
 * otherwise shown.
 * Implementation: a single injected stylesheet rule
 *   #mlsCtxBar[data-mls-age-dup="1"] .mls-age-ctx{display:none!important}
 * plus a tiny watcher that sets/clears that one data attribute when the meta's
 * age/DOB state changes. The !important rule overrides item41's inline
 * display flips, so the chip stays hidden without any DOM churn or fighting.
 * Purely display-only: no PHI added, no patient data read or mutated beyond
 * checking whether the bar's own text already shows an age/DOB, no network,
 * no storage.
 * Additive + reversible: window.__mlsCtxbarAgeDedupe.revert()
 */
;(function () {
  'use strict';
  if (window.__mlsCtxbarAgeDedupe) return;

  var STYLE_ID = 'mls-ctxbar-age-dedupe-style';
  var ATTR = 'data-mls-age-dup';
  var AGE_RE = /\b\d{1,3}\s*y\b/i;   // "53y" inline age token
  var DOB_RE = /DOB/i;
  var obs = null, iv = null;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    // Only hide the context-bar age chip; never the DOB-input hint chips.
    st.textContent =
      '#mlsCtxBar[' + ATTR + '="1"] .mls-age-ctx{display:none !important;}';
    (document.head || document.documentElement).appendChild(st);
  }

  // The meta line already shows the age if it contains a "<N>y" token or a DOB.
  function metaShowsAge(bar) {
    try {
      var meta = bar.querySelector('.mlsctx-meta');
      if (!meta) return false;
      var t = meta.textContent || '';
      return AGE_RE.test(t) || DOB_RE.test(t);
    } catch (e) { return false; }
  }

  function sync() {
    try {
      var bar = document.getElementById('mlsCtxBar');
      if (!bar) return;
      var dup = metaShowsAge(bar) ? '1' : '0';
      if (bar.getAttribute(ATTR) !== dup) bar.setAttribute(ATTR, dup);
    } catch (e) {}
  }

  function start() {
    injectStyle();
    sync();
    try {
      obs = new MutationObserver(function () { sync(); });
      obs.observe(document.body || document.documentElement,
        { childList: true, subtree: true, characterData: true });
    } catch (e) {}
    // steady, cheap fallback (a couple of regex tests; only writes the attr on change)
    if (!iv) iv = setInterval(sync, 1000);
  }

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  window.__mlsCtxbarAgeDedupe = {
    revert: function () {
      try { if (obs) obs.disconnect(); } catch (e) {}
      obs = null;
      if (iv) { clearInterval(iv); iv = null; }
      try {
        var bar = document.getElementById('mlsCtxBar');
        if (bar) bar.removeAttribute(ATTR);
      } catch (e) {}
      try {
        var st = document.getElementById(STYLE_ID);
        if (st && st.parentNode) st.parentNode.removeChild(st);
      } catch (e) {}
      try { delete window.__mlsCtxbarAgeDedupe; }
      catch (e) { window.__mlsCtxbarAgeDedupe = undefined; }
    },
    _info: function () {
      var bar = document.getElementById('mlsCtxBar');
      return {
        barPresent: !!bar,
        deduping: bar ? bar.getAttribute(ATTR) === '1' : false,
        observing: !!obs,
        styleInjected: !!document.getElementById(STYLE_ID)
      };
    }
  };
})();
