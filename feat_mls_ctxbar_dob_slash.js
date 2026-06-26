/* feat_mls_ctxbar_dob_slash.js -- item35
 * Unify the patient context-bar DOB to the canonical MM/DD/YYYY slash format.
 * The top context bar (#mlsCtxBar .mlsctx-meta) is the lone surface that renders
 * a patient's date of birth with dashes (e.g. "DOB 01-05-1984") while every other
 * surface -- the DOB input placeholder, profile cards (.prof-*), scheduler patient
 * cards (.as-pmeta) and the patient timeline -- uses slashes ("DOB 01/05/1984").
 * This rewrites only that DOB token's separators so a busy doctor sees one
 * consistent date format everywhere. Purely cosmetic: same date value, no PHI added,
 * no data mutation, no network, no storage writes.
 * Additive + reversible: window.__mlsCtxDobSlash.revert()
 */
;(function () {
  'use strict';
  if (window.__mlsCtxDobSlash) return;

  // Match "DOB MM-DD-YYYY" only -- never touches "last seen Jun 24, 2026", visit
  // counts, ages, or anything else.
  var RE = /\bDOB\s+(\d{2})-(\d{2})-(\d{4})\b/g;

  var orig = new Map();   // textNode -> original nodeValue (for exact revert)
  var obs = null, iv = null, applying = false, applied = 0;

  function fixNode(node) {
    var v = node.nodeValue;
    if (!v || v.indexOf('DOB') === -1 || v.indexOf('-') === -1) return false;
    var nv = v.replace(RE, function (m, a, b, c) { return 'DOB ' + a + '/' + b + '/' + c; });
    if (nv === v) return false;
    if (!orig.has(node)) orig.set(node, v);
    node.nodeValue = nv;
    return true;
  }

  function scan() {
    var bar = document.getElementById('mlsCtxBar');
    if (!bar) return;
    applying = true;
    try {
      var w = document.createTreeWalker(bar, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = w.nextNode())) { if (fixNode(n)) applied++; }
    } catch (e) {}
    applying = false;
  }

  function start() {
    scan();
    var bar = document.getElementById('mlsCtxBar');
    if (bar && !obs) {
      try {
        obs = new MutationObserver(function () { if (!applying) scan(); });
        obs.observe(bar, { childList: true, subtree: true, characterData: true });
      } catch (e) {}
    }
  }

  // The context bar can mount after this module loads; poll briefly until it
  // appears, then rely on the observer. Caps at ~20s so it is a no-op on pages
  // (e.g. the marketing site) that have no context bar.
  var tries = 0;
  iv = setInterval(function () {
    tries++;
    if (document.getElementById('mlsCtxBar')) start();
    if (obs || tries > 40) { clearInterval(iv); iv = null; }
  }, 500);

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  window.__mlsCtxDobSlash = {
    revert: function () {
      try { if (obs) obs.disconnect(); } catch (e) {}
      obs = null;
      if (iv) { clearInterval(iv); iv = null; }
      applying = true;
      orig.forEach(function (v, node) {
        try { if (node && node.isConnected !== false) node.nodeValue = v; } catch (e) {}
      });
      applying = false;
      orig.clear();
      try { delete window.__mlsCtxDobSlash; } catch (e) { window.__mlsCtxDobSlash = undefined; }
    },
    _info: function () { return { applied: applied, observing: !!obs }; }
  };
})();
