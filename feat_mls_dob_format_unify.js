/* feat_mls_dob_format_unify.js -- item38
 * Unify how a patient's date of birth is DISPLAYED across every surface.
 *
 * The roster stores DOB in mixed formats: most as MM/DD/YYYY, but ~31 patients
 * as MM-DD-YYYY (dashes) and a handful as YYYY-MM-DD (ISO). The patient picker,
 * MLS Assistant cards, Simple-view banner, profile cards, scheduler cards and
 * timeline all render the RAW stored value ("DOB " + esc(p.dob)), so for those
 * patients the same person's DOB shows as "DOB 08-24-1943" on a card while the
 * top context bar (item35) shows the canonical "DOB 08/24/1943". Two formats for
 * one value, depending where you look.
 *
 * This installs one canonical DOB formatter (window.__mlsFmtDob) and applies it
 * display-only to every "DOB <date>" token in the document, normalizing dashes
 * and ISO to the same MM/DD/YYYY slash format used by the context bar -- so a
 * doctor sees one DOB format everywhere. The #mlsCtxBar is left to item35 to
 * avoid two observers touching the same node.
 *
 * Purely cosmetic: same date value, no PHI added, NO patient-record mutation,
 * no network, no storage writes. Only rewrites visible text-node separators.
 * Additive + reversible: window.__mlsDobFormatUnify.revert()
 */
;(function () {
  'use strict';
  if (window.__mlsDobFormatUnify) return;

  function p2(x) { x = String(x); return x.length < 2 ? '0' + x : x; }

  // Canonical formatter: accepts a bare date string, returns MM/DD/YYYY or null
  // if it is not a recognizable M-D-Y / D separated or ISO date.
  function fmtDob(s) {
    if (s == null) return null;
    var m = String(s).trim().match(/^(\d{1,4})([\/-])(\d{1,2})\2(\d{1,4})$/);
    if (!m) return null;
    var a = m[1], b = m[3], c = m[4];
    if (a.length === 4) {            // ISO: YYYY-MM-DD
      return p2(b) + '/' + p2(c) + '/' + a;
    }
    if (c.length === 4) {            // M-D-YYYY or M/D/YYYY
      return p2(a) + '/' + p2(b) + '/' + c;
    }
    return null;                      // ambiguous / not a 4-digit-year date
  }
  window.__mlsFmtDob = fmtDob;

  // Matches a "DOB <date>" token inside visible text. Same-separator backref so
  // it only catches real dates, never prose with stray digits.
  var RE = /\bDOB\s+(\d{1,4})([\/-])(\d{1,2})\2(\d{1,4})\b/g;

  var orig = new Map();   // textNode -> original nodeValue (for exact revert)
  var obs = null, iv = null, applying = false, applied = 0;

  function inCtxBar(node) {
    // item35 owns the context bar; do not double-handle it.
    var el = node && node.parentElement;
    while (el) { if (el.id === 'mlsCtxBar') return true; el = el.parentElement; }
    return false;
  }

  function fixNode(node) {
    var v = node.nodeValue;
    if (!v || v.indexOf('DOB') === -1) return false;
    if (v.indexOf('-') === -1 && v.indexOf('/') === -1) return false;
    if (inCtxBar(node)) return false;
    RE.lastIndex = 0;
    var nv = v.replace(RE, function (m, a, sep, b, c) {
      var canon = fmtDob(a + sep + b + sep + c);
      return canon ? ('DOB ' + canon) : m;
    });
    if (nv === v) return false;
    if (!orig.has(node)) orig.set(node, v);
    node.nodeValue = nv;
    return true;
  }

  function scanSubtree(root) {
    if (!root) return;
    if (root.nodeType === 3) { if (fixNode(root)) applied++; return; }
    if (root.nodeType !== 1) return;
    try {
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var n;
      while ((n = w.nextNode())) { if (fixNode(n)) applied++; }
    } catch (e) {}
  }

  function scanAll() {
    applying = true;
    try { scanSubtree(document.body); } catch (e) {}
    applying = false;
  }

  function start() {
    if (!document.body) return;
    scanAll();
    if (!obs) {
      try {
        obs = new MutationObserver(function (recs) {
          if (applying) return;
          applying = true;
          try {
            for (var i = 0; i < recs.length; i++) {
              var r = recs[i];
              if (r.type === 'characterData') { if (fixNode(r.target)) applied++; }
              else if (r.addedNodes) {
                for (var j = 0; j < r.addedNodes.length; j++) scanSubtree(r.addedNodes[j]);
              }
            }
          } catch (e) {}
          applying = false;
        });
        obs.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (e) {}
    }
  }

  // body may not exist yet; poll briefly then rely on the observer.
  var tries = 0;
  iv = setInterval(function () {
    tries++;
    if (document.body) start();
    if (obs || tries > 40) { clearInterval(iv); iv = null; }
  }, 500);

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  window.__mlsDobFormatUnify = {
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
      try { delete window.__mlsFmtDob; } catch (e) { window.__mlsFmtDob = undefined; }
      try { delete window.__mlsDobFormatUnify; } catch (e) { window.__mlsDobFormatUnify = undefined; }
    },
    _info: function () { return { applied: applied, observing: !!obs }; }
  };
})();
