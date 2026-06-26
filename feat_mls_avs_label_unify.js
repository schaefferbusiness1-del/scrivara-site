/* feat_mls_avs_label_unify.js -> window.__mlsAvsLabelUnify (avslbl-1.0.0)
 * ITEM 34: Unify the NAME of the "After-visit summary" action across surfaces.
 *
 * The same action -- generate the patient after-visit summary -- is reachable
 * from three buttons that today read three different things:
 *   - #mlsavsBtn      (patient bar)        "After-visit summary"
 *   - #mlsHistAvsBtn  (History toolbar)    "<icon> After-visit summary"   (item16)
 *   - #avsBtn         (clinical tools row) "<icon> Patient summary"        <- outlier
 * So a clinician sees the same feature called both "After-visit summary" and
 * "Patient summary" depending on where they are. This module makes every AVS
 * trigger button read the one canonical NAME -- "After-visit summary" --
 * while PRESERVING each button's own existing leading icon (which is
 * surface-appropriate). It does NOT change any handler, styling, data, or
 * behaviour; purely the visible wording. One name for one action, everywhere.
 *
 * Strictly additive, display-only, idempotent, ASCII-only source, reversible:
 *   window.__mlsAvsLabelUnify.revert()
 * No patient data, no storage, no network.
 */
(function () {
  "use strict";
  try { if (window.__mlsAvsLabelUnify && window.__mlsAvsLabelUnify.installed) return; } catch (e) { return; }

  var VERSION = "avslbl-1.0.0";
  var CANON = "After-visit summary";          // the one canonical action name
  var IDS = ["mlsavsBtn", "mlsHistAvsBtn", "avsBtn"];
  // Words we will replace with the canonical name when found as the button's label.
  var ALIASES = [/patient\s+summary/i, /after-?visit\s+summary/i];

  var touched = [];   // { el, orig } for clean revert
  var obs = null;
  var timer = null;
  var ticks = 0;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  // Split a leading emoji/symbol + spaces from the start of a label, so we can
  // keep the icon and only rewrite the words. Returns { icon, rest }.
  function splitIcon(s) {
    if (typeof s !== "string") return { icon: "", rest: "" };
    // Match a leading run of non-letter, non-digit chars (emoji, symbols, spaces).
    var m = s.match(/^([^A-Za-z0-9]+)([\s\S]*)$/);
    if (m) return { icon: m[1], rest: m[2].trim() };
    return { icon: "", rest: s.trim() };
  }

  function isAvsLabel(rest) {
    for (var i = 0; i < ALIASES.length; i++) { if (ALIASES[i].test(rest)) return true; }
    return false;
  }

  function unifyOne(el) {
    if (!el || el.nodeType !== 1) return;
    // Only act on simple text-label buttons (no child elements that hold the icon
    // separately) -- all three targets render their label as a single text node.
    if (el.children && el.children.length) return;
    var cur = el.textContent;
    if (typeof cur !== "string" || !cur.trim()) return;
    var parts = splitIcon(cur);
    if (!isAvsLabel(parts.rest)) return;          // not an AVS label; leave alone
    var next = parts.icon ? (parts.icon.replace(/\s+$/, "") + " " + CANON) : CANON;
    if (next === cur) return;                       // already canonical
    if (el.__mlsAvsOrig == null) { el.__mlsAvsOrig = cur; touched.push(el); }
    el.textContent = next;
  }

  function apply() {
    for (var i = 0; i < IDS.length; i++) {
      var el = safe(function () { return document.getElementById(IDS[i]); });
      if (el) unifyOne(el);
    }
  }

  function boot() {
    apply();
    obs = safe(function () {
      return new MutationObserver(function () { apply(); });
    }, null);
    safe(function () {
      if (obs) obs.observe(document.body || document.documentElement,
        { childList: true, subtree: true, characterData: true });
    });
    // Re-apply for a short window to catch late renders, then stop polling.
    timer = setInterval(function () { ticks++; apply(); if (ticks >= 25) { clearInterval(timer); timer = null; } }, 400);
  }

  function revert() {
    safe(function () { if (obs) obs.disconnect(); }); obs = null;
    safe(function () { if (timer) clearInterval(timer); }); timer = null;
    for (var i = 0; i < touched.length; i++) {
      (function (el) {
        safe(function () {
          if (el && el.__mlsAvsOrig != null) { el.textContent = el.__mlsAvsOrig; el.__mlsAvsOrig = null; }
        });
      })(touched[i]);
    }
    touched = [];
    safe(function () { window.__mlsAvsLabelUnify.installed = false; });
  }

  window.__mlsAvsLabelUnify = { installed: true, version: VERSION, apply: apply, revert: revert,
    canonical: CANON, count: function () { return touched.length; } };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
