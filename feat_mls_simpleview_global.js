/* feat_mls_simpleview_global.js  ->  window.__mlsSimpleViewGlobal  (v1.1.0)
 *
 * Make "simple view" a PROGRAM-WIDE mode. When MLS Easy is in simple view
 * (window.__mlsEasy.state.mode === 'easy'), restrict the whole app so ONLY
 * the simple sections are available across the top nav: Patients, Calendar,
 * History and Visit. Every other top-level section/nav entry (Orders,
 * Recommendations, Legal requests, Team, Analysis, AI Studio, Admin,
 * Templates, Custom widget, Outcome study, etc.) is HIDDEN. When in
 * complex/full view (mode === 'full'), nothing is restricted -- the app
 * behaves exactly as it does today (current behavior, unchanged).
 *
 * CHANGELOG:
 *   v1.1.0 - add "visit" (the scribe capture screen) to the simple allow-list,
 *            so simple view now shows Patients, Calendar, History and Visit.
 *            No other behavior changed; complex/full view stays unrestricted.
 *   v1.0.0 - initial: simple view limited to Patients, Calendar, History.
 *
 * Additive, reversible, composes with -- never edits -- feat_mls_easy.js
 * (window.__mlsEasy) and feat_mls_viewpersist.js (window.__mlsViewPersist).
 *
 * ===================================================================
 *  WHAT THE HOST DOES TODAY  (read live from the deployed app)
 * ===================================================================
 *  - The view lives in ONE flag: window.__mlsEasy.state.mode, either
 *    'easy' (simple guided view, the default on every load) or 'full'
 *    (the original complex UI). The "Switch to full view" link sets
 *    mode='full'; "Use MLS Easy" sets mode='easy'.
 *  - feat_mls_viewpersist.js persists that choice across reload/login by
 *    saving the string "complex" | "simple" under localStorage key
 *    "mls.easy.viewPref" and re-applying it to state.mode before first
 *    render. This asset reads the SAME key so its first paint matches.
 *  - The top nav is a row of `.navtab` elements, each wired with
 *    onclick="showView('<token>')" (e.g. showView('patients'),
 *    showView('calendar'), showView('history'), showView('visit'),
 *    showView('orders'), showView('studio'), ...). Some tabs are
 *    role-gated and start hidden (the host sets their inline display:none
 *    and reveals them on login for head/owner accounts).
 *
 * ===================================================================
 *  HOW THIS ASSET RESTRICTS  (reversible, host-display-preserving)
 * ===================================================================
 *  - Strategy: never clobber the host's own inline styles. Instead we
 *    inject ONE <style> rule:  html.<active> .<hide>{display:none}  and
 *    (a) tag every disallowed nav tab with the <hide> class, and
 *    (b) toggle the <active> class on <html> to switch the whole mode on/off.
 *    In full view we simply REMOVE the <active> class, so the rule goes
 *    inert and each tab returns to EXACTLY the host's own display value
 *    (role-gated tabs stay hidden, normal tabs reappear) -- no snapshot to
 *    drift, nothing to restore wrongly. revert() removes the style, the
 *    class, and the tags, leaving the DOM byte-equivalent to baseline.
 *  - "Allowed in simple" is decided by VIEW TOKEN, not by hard-coded IDs,
 *    so it adapts to whatever nav the live app actually ships. Allowed set:
 *    { patients, calendar, history, visit }. Any navtab whose parsed token
 *    is NOT in that set is hidden in simple view. Tabs whose token can't be
 *    parsed are left alone (conservative: never hide something we can't
 *    classify).
 *  - If, in simple view, the currently-shown view is a disallowed one
 *    (e.g. the default landed on Orders, or a deep link opened Studio), we
 *    call the host's own showView('patients') once so the user is never
 *    stranded on a section whose tab we just hid.
 *  - Late-revealed tabs (role-gating after login) are re-tagged on the
 *    steady poll, so they get hidden within one tick while in simple view.
 *
 * REACTIVITY:
 *  - On load: first paint matches the persisted pref (same localStorage key
 *    as viewpersist) so simple-on-load hides the extras with no flash.
 *  - Steady state: a cheap poll reads __mlsEasy.state.mode (the single source
 *    of truth) and flips the mode live when the doctor toggles the view.
 *
 * SAFETY: own IIFE; idempotent (won't double-install); never reimplements,
 * monkey-patches, or removes any host function or element; only adds a style
 * tag + CSS classes and calls the host's own showView(); every access in
 * try/catch; sends nothing to any extension or network; never clicks
 * Save/Sign/Submit; read-only on clinical data. ASCII-only; NUL-free.
 * Fully reversible: window.__mlsSimpleViewGlobal.revert() stops the watcher,
 * removes the style/class/tags, and restores every section to the host's own
 * state. Non-PHI: reads only the view-pref string; stores nothing new.
 */
;(function () {
  "use strict";
  try { if (window.__mlsSimpleViewGlobal && window.__mlsSimpleViewGlobal.installed) return; } catch (e) { return; }

  var VERSION = "1.2.0";
  var ASSET = "feat_mls_simpleview_global.js";
  var PERSIST_KEY = "mls.easy.viewPref";     // shared with viewpersist; "complex" | "simple"
  var STYLE_ID = "mls-sv-style";
  var ACTIVE_CLASS = "mls-sv-active";        // toggled on <html>
  var HIDE_CLASS = "mls-sv-hide";            // tagged on disallowed nav tabs
  var MARK_ATTR = "data-mls-sv";

  // The simple set: only these view tokens stay available in simple view.
  var ALLOW = { patients: 1, calendar: 1, history: 1, visit: 1 };
  // Where to land if simple view is active and the current view is disallowed.
  var FALLBACK_VIEW = "patients";

  var _reverted = false;
  var _poll = null, _fast = null, _fastTries = 0;
  var _lastMode = null;   // "simple" | "full" we last applied (de-dupe transitions)

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  // ---- host accessors -------------------------------------------------------
  function easy() { return safe(function () { return window.__mlsEasy; }, null); }
  function curMode() {
    var e = easy();
    return (e && e.state && e.state.mode) ? String(e.state.mode) : null;
  }
  function readPref() {
    return safe(function () {
      var v = window.localStorage.getItem(PERSIST_KEY);
      return (v === "complex" || v === "simple") ? v : null;
    }, null);
  }
  // Effective desire: the live mode flag is the source of truth when present;
  // otherwise fall back to the saved pref; otherwise the host default (easy).
  function wantSimple() {
    var m = curMode();
    if (m) return m === "easy";
    var p = readPref();
    if (p) return p === "simple";
    return true; // host default view is 'easy' (simple)
  }

  function currentViewName() {
    var v = safe(function () { return window.currentView; }, null);
    return v ? String(v).toLowerCase() : null;
  }

  // ---- nav discovery + token parsing ---------------------------------------
  function navTabs() {
    var out = [];
    safe(function () {
      var nl = document.querySelectorAll('.navtab, .mainnav [id^="nav_"], [id^="nav_"]');
      for (var i = 0; i < nl.length; i++) { if (out.indexOf(nl[i]) === -1) out.push(nl[i]); }
    });
    return out;
  }
  // Parse the view token a tab targets: onclick="showView('x')" first, then id="nav_x".
  function tokenOf(el) {
    var tok = null;
    var oc = safe(function () { return el.getAttribute("onclick") || ""; }, "");
    var m = oc && oc.match(/showView\(\s*['"]([a-z0-9_-]+)['"]\s*\)/i);
    if (m) tok = m[1];
    if (!tok) {
      var id = safe(function () { return el.id || ""; }, "");
      var mm = id.match(/^nav_([a-z0-9_-]+)$/i);
      if (mm) tok = mm[1];
    }
    return tok ? String(tok).toLowerCase() : null;
  }
  function isAllowedToken(tok) { return !!(tok && ALLOW[tok]); }

  // ---- style injection ------------------------------------------------------
  function ensureStyle() {
    safe(function () {
      if (document.getElementById(STYLE_ID)) return;
      var s = document.createElement("style");
      s.id = STYLE_ID;
      s.type = "text/css";
      /* v1.2.0: feat_mls_header_exact adds "#mlsRdNav .navtab{display:flex!important}"
         (id-scoped + !important) which OUTRANKS a plain .mls-sv-hide hide -> the advanced
         tabs stayed visible in simple view. Add id+class-scoped !important selectors that
         beat it (same id #mlsRdNav, one extra class), keeping the generic rule as fallback. */
      s.textContent =
        "html." + ACTIVE_CLASS + " ." + HIDE_CLASS + "{display:none !important;}" +
        "html." + ACTIVE_CLASS + " #mlsRdNav ." + HIDE_CLASS + "{display:none !important;}" +
        "html." + ACTIVE_CLASS + " #mlsRdNav .navtab." + HIDE_CLASS + "{display:none !important;}" +
        "html." + ACTIVE_CLASS + " .mainnav ." + HIDE_CLASS + "{display:none !important;}";
      (document.head || document.documentElement).appendChild(s);
    });
  }

  // Tag every disallowed nav tab so the CSS rule can hide it while active.
  // Returns the list of hidden tokens (for the public API / tests).
  function tagTabs() {
    var hidden = [];
    var tabs = navTabs();
    for (var i = 0; i < tabs.length; i++) {
      var el = tabs[i];
      var tok = tokenOf(el);
      if (tok && !isAllowedToken(tok)) {
        (function (node, t) {
          safe(function () { node.classList.add(HIDE_CLASS); node.setAttribute(MARK_ATTR, "1"); });
          if (hidden.indexOf(t) === -1) hidden.push(t);
        })(el, tok);
      }
    }
    return hidden;
  }

  // If simple view is active and the visible view is disallowed, land on the fallback.
  function redirectIfNeeded() {
    var v = currentViewName();
    if (v && !isAllowedToken(v)) {
      safe(function () {
        if (typeof window.showView === "function") window.showView(FALLBACK_VIEW);
      });
    }
  }

  function activate() {
    ensureStyle();
    tagTabs();
    safe(function () { document.documentElement.classList.add(ACTIVE_CLASS); });
    redirectIfNeeded();
  }
  function deactivate() {
    // Remove only OUR mode switch -> the CSS rule goes inert -> every tab
    // returns to the host's own display value. Tags are left in place
    // (harmless, idempotent) so re-entering simple view is instant; revert()
    // strips them entirely.
    safe(function () { document.documentElement.classList.remove(ACTIVE_CLASS); });
  }

  // ---- main apply -----------------------------------------------------------
  function apply() {
    if (_reverted) return;
    if (!document || !document.documentElement) return;
    if (wantSimple()) {
      if (_lastMode !== "simple") { activate(); _lastMode = "simple"; }
      else { tagTabs(); redirectIfNeeded(); } // catch late role-gated tabs / deep links
    } else {
      if (_lastMode !== "full") { deactivate(); _lastMode = "full"; }
    }
  }

  // ---- watchers -------------------------------------------------------------
  function tick() { if (_reverted) return; apply(); }

  function startFast() {
    // Tag + apply as early as possible once the nav exists, to avoid any flash.
    _fast = setInterval(function () {
      if (_reverted) { clearInterval(_fast); _fast = null; return; }
      if (navTabs().length) { apply(); }
      if (++_fastTries > 300) { clearInterval(_fast); _fast = null; } // ~6s safety cap
    }, 20);
  }

  function start() {
    apply();                       // synchronous best-effort (host usually ready)
    if (!navTabs().length) startFast();
    _poll = setInterval(tick, 500); // steady-state: react to live toggles + late tabs
  }

  // ---- revert ---------------------------------------------------------------
  function revert() {
    _reverted = true;
    safe(function () { if (_poll) clearInterval(_poll); });
    safe(function () { if (_fast) clearInterval(_fast); });
    safe(function () { document.documentElement.classList.remove(ACTIVE_CLASS); });
    safe(function () {
      var els = document.querySelectorAll("." + HIDE_CLASS + ",[" + MARK_ATTR + "]");
      for (var i = 0; i < els.length; i++) {
        els[i].classList.remove(HIDE_CLASS);
        els[i].removeAttribute(MARK_ATTR);
      }
    });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { window.__mlsSimpleViewGlobal.installed = false; });
    return true;
  }

  // ---- public API (also exercised by the offline jsdom tests) ---------------
  window.__mlsSimpleViewGlobal = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    allow: Object.keys(ALLOW),
    fallback: FALLBACK_VIEW,
    apply: function () { _lastMode = null; apply(); },
    isSimpleActive: function () {
      return safe(function () { return document.documentElement.classList.contains(ACTIVE_CLASS); }, false);
    },
    hiddenTokens: function () {
      var out = [];
      safe(function () {
        var els = document.querySelectorAll("[" + MARK_ATTR + "]");
        for (var i = 0; i < els.length; i++) {
          var t = tokenOf(els[i]);
          if (t && out.indexOf(t) === -1) out.push(t);
        }
      });
      return out;
    },
    _tokenOf: tokenOf,
    _wantSimple: wantSimple,
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  } catch (e) { safe(start); }

  // Kick a synchronous apply right now in case the host is already up.
  safe(apply);
})();
