/*!
 * feat_mls_asst_provname.js  (item37)
 * -----------------------------------------------------------------------------
 * MLS Assistant chat -- doctor-picker REAL-provider name normalization.
 *
 * PROBLEM (verified live on mlsscribe.com/ScribeFlow.html):
 *   The Assistant panel doctor picker (.as-prov, built by item19 / __mlsAsstFix)
 *   IS populated from the real provider roster -- but most real providers arrive
 *   in athenaOne's raw machine-username format ("Carter_Kelly_PA-C",
 *   "Benner_John_MD", "Mizrahi_Yona_DPM" ...) and are shown verbatim, sitting
 *   inconsistently next to already-human names ("Michael Schaeffer",
 *   "Matthew Schaeffer, MD"). Underscores + Last_First_Credential order is
 *   unreadable / unprofessional in a clinician-facing picker.
 *
 * FIX (additive, reversible, display-only):
 *   - Normalize each <option> in .as-prov so the *displayed* text is a clean
 *     human label "First Last, CRED" (e.g. "Carter_Kelly_PA-C" -> "Kelly
 *     Carter, PA-C").  Already-human names and "All doctors" are left as-is.
 *   - PRESERVE pull correctness: the schedule pull reads option.value
 *     (curSelDateProv -> pr.value). We set option.value to the ORIGINAL raw
 *     string before changing the visible text, so the exact provider identifier
 *     sent to si.pull() is unchanged. Pure cosmetic relabel; zero behavior drift.
 *   - Re-apply after item19 rebuilds the dropdown (it stamps data-mlsfix-prov
 *     and bails when unchanged) via a MutationObserver on the panel.
 *
 * Reversible: window.__mlsAsstProvName.revert() restores original option text,
 *   clears injected values, disconnects the observer.
 *
 * No PHI, no network, no athenaOne writes. Synthetic-safe, read-only of DOM.
 */
;(function () {
  'use strict';
  if (window.__mlsAsstProvName && window.__mlsAsstProvName.installed) return;

  var ASSET = 'feat_mls_asst_provname.js';
  var DATA_ORIG = 'data-mlspn-orig';   // marks an option we relabeled; holds raw text
  var observer = null;
  var rafPending = false;

  var CREDS = ['PA-C', 'NP-C', 'DNP', 'DPM', 'DPT', 'PA', 'NP', 'MD', 'DO', 'PHD', 'PSYD', 'CRNA', 'CNM', 'RN'];

  function titleCasePart(p) {
    if (!p) return p;
    // keep internal caps like McCafferty / O'Brien reasonably; only fix all-lower / all-upper
    if (/[a-z]/.test(p) && /[A-Z]/.test(p)) return p; // already mixed-case -> trust it
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }

  function normCred(c) {
    if (!c) return '';
    var up = c.toUpperCase().replace(/\s+/g, '');
    for (var i = 0; i < CREDS.length; i++) {
      if (CREDS[i].replace(/-/g, '') === up.replace(/-/g, '')) return CREDS[i];
    }
    return c; // unknown credential -> leave as-is
  }

  /* Convert "Last_First_Credential" (athenaOne username style) -> "First Last, CRED".
     Returns null if the string isn't in that raw underscore format (leave untouched). */
  function humanize(raw) {
    if (typeof raw !== 'string') return null;
    var s = raw.trim();
    if (!s || s.indexOf('_') === -1) return null;          // not raw machine format
    if (/^all\s+doctors$/i.test(s)) return null;
    var parts = s.split('_').filter(function (x) { return x !== ''; });
    if (parts.length < 2) return null;

    var last = parts[0];
    var first = parts[1];
    var credRaw = parts.slice(2).join('-'); // e.g. "PA-C" survives split as ["PA","C"]
    // If there were exactly 2 parts, there is no credential.
    var cred = parts.length >= 3 ? normCred(credRaw) : '';

    last = titleCasePart(last);
    first = titleCasePart(first);
    if (!first || !last) return null;

    var label = first + ' ' + last;
    if (cred) label += ', ' + cred;
    return label;
  }

  function panel() {
    try { return document.getElementById('mlsAsstPanel'); } catch (e) { return null; }
  }

  function relabel() {
    var p = panel(); if (!p) return;
    var sel = p.querySelector('.as-prov'); if (!sel) return;
    var opts = sel.options;
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      if (o.getAttribute(DATA_ORIG) != null) continue; // already handled this exact node
      var rawText = (o.textContent || '').trim();
      var human = humanize(rawText);
      if (!human || human === rawText) continue;
      // preserve exact pull identifier
      if (!o.hasAttribute('value') || o.value === rawText) {
        try { o.value = rawText; } catch (e) {}
      }
      try { o.setAttribute(DATA_ORIG, rawText); } catch (e) {}
      o.textContent = human;
    }
  }

  function schedule() {
    if (rafPending) return;
    rafPending = true;
    (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(function () {
      rafPending = false;
      try { relabel(); } catch (e) {}
    });
  }

  function start() {
    relabel();
    try {
      var p = panel(); if (!p) { setTimeout(start, 600); return; }
      observer = new MutationObserver(function () { schedule(); });
      observer.observe(p, { childList: true, subtree: true });
    } catch (e) {}
  }

  function revert() {
    try { if (observer) { observer.disconnect(); observer = null; } } catch (e) {}
    try {
      var p = panel();
      if (p) {
        var sel = p.querySelector('.as-prov');
        if (sel) {
          var opts = sel.options;
          for (var i = 0; i < opts.length; i++) {
            var o = opts[i];
            var orig = o.getAttribute(DATA_ORIG);
            if (orig != null) {
              o.textContent = orig;
              try { o.removeAttribute('value'); } catch (e) {}
              try { o.removeAttribute(DATA_ORIG); } catch (e) {}
            }
          }
        }
      }
    } catch (e) {}
    try { window.__mlsAsstProvName.installed = false; } catch (e) {}
  }

  window.__mlsAsstProvName = {
    installed: true,
    version: '1.0.0',
    asset: ASSET,
    humanize: humanize,
    relabel: relabel,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { setTimeout(start, 300); });
  } else {
    setTimeout(start, 300);
  }
})();
