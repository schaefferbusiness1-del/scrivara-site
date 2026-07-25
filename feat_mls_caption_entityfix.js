/* ============================================================================
 * feat_mls_caption_entityfix.js  ->  window.__mlsCaptionEntityFix  (cef-1.0.0)
 * ---------------------------------------------------------------------------
 * COSMETIC FIX (item38): the patient-picker note (Simple-view Visit Step 1 /
 * NEXT UP "Show more" modal) rendered the raw HTML entity:
 *    "122 patients on today&#39;s schedule"
 * instead of "122 patients on today's schedule".
 *
 * ROOT CAUSE
 *   In feat_mls_patientpick.js the note string literal already contains the
 *   pre-escaped apostrophe ("today&#39;s schedule"), and that literal is then
 *   passed through esc(), which re-escapes the leading "&" to "&amp;". The
 *   browser parses "&amp;#39;" back to the literal text "&#39;", so the user
 *   sees the raw entity. (The double-escape only affects the .mlspk-note text;
 *   the modal/header "Today's patients" use single-escaped literals and render
 *   correctly, so they are intentionally left untouched.)
 *
 * FIX (additive, reversible, idempotent)
 *   Watch for .mlspk-note text and replace the literal sequence "&#39;" with a
 *   real apostrophe in those nodes only. Narrowly scoped to .mlspk-note so no
 *   other content is affected. No app logic, no network, no PHI. ASCII-only.
 *   Reversible: window.__mlsCaptionEntityFix.revert() (stops the observer).
 * ===========================================================================*/
;(function () {
  "use strict";
  try { if (window.__mlsCaptionEntityFix && window.__mlsCaptionEntityFix.installed) return; } catch (e) { return; }

  var VERSION = "cef-1.0.0";
  var NEEDLE = "&#39;";
  var _obs = null, _t = null;

  function safe(fn) { try { return fn(); } catch (e) { return null; } }

  function fixNote(noteEl) {
    if (!noteEl) return;
    safe(function () {
      // only rewrite text nodes that actually carry the literal entity
      var walker = document.createTreeWalker(noteEl, NodeFilter.SHOW_TEXT, null, false);
      var n;
      while ((n = walker.nextNode())) {
        if (n.nodeValue && n.nodeValue.indexOf(NEEDLE) !== -1) {
          n.nodeValue = n.nodeValue.split(NEEDLE).join("'");
        }
      }
    });
  }

  function sweep() {
    safe(function () {
      var notes = document.querySelectorAll(".mlspk-note");
      for (var i = 0; i < notes.length; i++) fixNote(notes[i]);
    });
  }

  function schedule() {
    if (_t) return;
    _t = setTimeout(function () { _t = null; sweep(); }, 80);
  }

  /* Bounded, not permanent. The source double-escape this module worked around
     is fixed in feat_mls_patientpick.js, so there is nothing left to react to;
     what remains is a safety net for a late-rendering picker. A document-wide
     {subtree,characterData} observer woke on EVERY text change in the whole app
     for the life of the session - the most expensive observer kind there is -
     to correct one apostrophe. Settling passes cost nothing after they finish. */
  var _timers = [];
  function boot() {
    sweep();
    safe(function () {
      [400, 1200, 3000].forEach(function (d) { _timers.push(setTimeout(sweep, d)); });
    });
  }

  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); _obs = null; });
    safe(function () { _timers.forEach(function (t) { clearTimeout(t); }); _timers = []; });
    safe(function () { if (_t) { clearTimeout(_t); _t = null; } });
    safe(function () { window.__mlsCaptionEntityFix.installed = false; });
  }

  window.__mlsCaptionEntityFix = { installed: true, version: VERSION, reapply: boot, revert: revert, sweep: sweep };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

