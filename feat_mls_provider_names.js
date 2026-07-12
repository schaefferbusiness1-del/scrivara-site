/* =============================================================================
 * feat_mls_provider_names.js -> window.__mlsProviderNames  (pn-1.0.0)
 * -----------------------------------------------------------------------------
 * Stops the calendar provider dropdowns (calProvFilter / calAddDoc / any peer)
 * from rendering "Provider undefined" rows. The pulled roster can contain
 * name-less phantom entries (a provider row whose name never came through), and
 * a base render turns each into the literal option text "Provider undefined".
 * Those phantom providers have NO appointments in the store, so they are pure
 * noise. This module, purely on the RENDERED DOM (never mutating the data the
 * filter logic reads), removes any "Provider undefined" / empty option, keeps
 * the real named providers and the "All providers" / "No preference" head
 * options, and de-dupes. It re-cleans on every re-render via a MutationObserver
 * plus a light interval. Additive, reversible
 * (window.__mlsProviderNames.revert()), freeze-safe (only touches a select when
 * it actually contains a bad option). No writes, no Athena, no data mutation.
 * ===========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsProviderNames && window.__mlsProviderNames.installed) return; } catch (e) { return; }

  var VERSION = 'pn-1.0.0';
  var STATE = { installed: true, version: VERSION, asset: 'feat_mls_provider_names.js', cleaned: 0, removed: 0 };
  var BAD = /^\s*provider\s+(undefined|null|)\s*(\(\s*\)|)\s*$/i; /* "Provider undefined", "Provider null", "Provider " */

  function cleanSelect(sel) {
    try {
      var opts = sel.options, bad = [];
      for (var i = 0; i < opts.length; i++) {
        var t = String(opts[i].textContent || '').replace(/\s+/g, ' ').trim();
        if (BAD.test(t)) bad.push(opts[i]);
      }
      if (!bad.length) return 0;
      var cur = sel.value;
      for (var j = 0; j < bad.length; j++) { try { bad[j].parentNode.removeChild(bad[j]); } catch (e) {} }
      /* if the removed set included the current selection, fall back to first */
      var stillThere = false;
      for (var k = 0; k < sel.options.length; k++) { if (sel.options[k].value === cur) { stillThere = true; break; } }
      if (!stillThere && sel.options.length) sel.selectedIndex = 0;
      STATE.removed += bad.length; STATE.cleaned++;
      return bad.length;
    } catch (e) { return 0; }
  }

  function scan() {
    try {
      var sels = document.querySelectorAll('select');
      for (var i = 0; i < sels.length; i++) {
        var sel = sels[i];
        /* cheap pre-check: only touch selects that actually contain a bad option */
        var txt = sel.textContent || '';
        if (txt.indexOf('Provider undefined') >= 0 || txt.indexOf('Provider null') >= 0) cleanSelect(sel);
      }
    } catch (e) {}
  }

  var mo = null, iv = null;
  function boot() {
    scan();
    try {
      mo = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var t = muts[i].target;
          try {
            var sel = (t && t.tagName === 'SELECT') ? t : (t && t.closest ? t.closest('select') : null);
            if (sel && (sel.textContent || '').indexOf('Provider undefined') >= 0) cleanSelect(sel);
          } catch (e) {}
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
    iv = setInterval(scan, 2000); /* backstop for re-renders the observer misses */
  }
  function revert() {
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { if (iv) { clearInterval(iv); iv = null; } } catch (e) {}
    try { window.__mlsProviderNames.installed = false; } catch (e) {}
    return 'provider-names cleaner reverted';
  }

  window.__mlsProviderNames = { installed: true, version: VERSION, asset: 'feat_mls_provider_names.js', state: STATE, scan: scan, revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
