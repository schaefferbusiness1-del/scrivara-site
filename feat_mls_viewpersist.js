/* feat_mls_viewpersist.js  ->  window.__mlsViewPersist  (v1.0.0)
 *
 * Persist the doctor's MLS Easy view choice (simple vs. complex/full) across
 * page reloads and re-logins. Additive, reversible, composes with -- never
 * edits -- feat_mls_easy.js (S57, window.__mlsEasy).
 *
 * ===================================================================
 *  WHAT THE HOST DOES TODAY (read live from mlsscribe.com/feat_mls_easy.js)
 * ===================================================================
 * MLS Easy keeps its view in ONE flag: window.__mlsEasy.state.mode, which is
 * either 'easy' (the simple guided wizard -- the DEFAULT on every load) or
 * 'full' (the original complex UI: all cards revealed, original hero restored).
 *   - The "Switch to full view" link runs:  state.mode = 'full'; render();
 *   - The "Use MLS Easy" link runs:         state.mode = 'easy'; render();
 *   - "Edit the note" (step 4) also sets state.mode = 'full'.
 * The exposed object window.__mlsEasy.state IS that same `state` object (same
 * reference the module mutates internally), so we can both READ the current
 * mode and SET it before the first render -- without touching the module.
 * On every fresh load the module starts at mode:'easy', so today the doctor's
 * choice of full view is lost on reload/login. This asset fixes exactly that.
 *
 * ===================================================================
 *  WHAT THIS ASSET ADDS
 * ===================================================================
 *  1) PERSIST: poll __mlsEasy.state.mode (a cheap property read, no DOM writes)
 *     and, when it changes because the doctor toggled the view, save the choice
 *     to localStorage as a tiny non-PHI flag: "complex" or "simple".
 *  2) APPLY (no flash): as soon as __mlsEasy exists -- and before MLS Easy's
 *     first panel render -- if the saved flag is "complex", set
 *     state.mode = 'full' so the very first render paints the complex view
 *     directly (no simple -> complex flash). If a panel already rendered, we
 *     call the module's own render() once to correct it immediately.
 *  3) Switching back to simple updates the saved flag too (handled by 1).
 *     With no saved flag, behavior is unchanged (default stays simple).
 *
 * NON-PHI: the only thing stored is the string "complex" or "simple" under a
 * fixed key. No patient data, no names, no secrets -- just a view preference.
 *
 * SAFETY: own IIFE; idempotent (won't double-install); never reimplements or
 * monkey-patches any host function; only reads/sets one documented flag and
 * calls the host's own render(); every access in try/catch; sends nothing to
 * any extension or network; never clicks Save/Sign/Submit; read-only on
 * clinical data. ASCII-only; NUL-free. Fully reversible:
 * window.__mlsViewPersist.revert() stops the watcher and detaches (it does NOT
 * change the doctor's current view, and leaves the saved flag intact unless
 * you call .clearSaved()).
 */
;(function () {
  "use strict";
  try { if (window.__mlsViewPersist && window.__mlsViewPersist.installed) return; } catch (e) { return; }

  var VERSION = "1.0.0";
  var ASSET = "feat_mls_viewpersist.js";
  var KEY = "mls.easy.viewPref";   // stores "complex" | "simple"

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  // ---- localStorage helpers (defensive; storage can throw in private mode) ----
  function readPref() {
    return safe(function () {
      var v = window.localStorage.getItem(KEY);
      return (v === "complex" || v === "simple") ? v : null;
    }, null);
  }
  function writePref(p) {
    if (p !== "complex" && p !== "simple") return;
    safe(function () { window.localStorage.setItem(KEY, p); });
  }
  function clearSaved() { safe(function () { window.localStorage.removeItem(KEY); }); }

  // ---- mode <-> pref mapping (the one place the vocabulary is defined) ----
  function modeToPref(mode) { return mode === "full" ? "complex" : "simple"; }
  function prefToMode(pref) { return pref === "complex" ? "full" : "easy"; }

  function easy() { return safe(function () { return window.__mlsEasy; }, null); }
  function curMode() {
    var e = easy();
    return (e && e.state && e.state.mode) ? e.state.mode : null;
  }

  var _applied = false;     // saved pref applied to state at most once per load
  var _last = null;         // last mode we have already persisted (de-dupe writes)
  var _reverted = false;

  // ===========================================================
  //  APPLY the saved view to the host's state flag.
  //  Setting state.mode BEFORE the first render makes the first
  //  paint the correct view (no simple->complex flash). If a panel
  //  already exists, call the host's own render() once to correct.
  // ===========================================================
  function apply() {
    if (_applied || _reverted) return;
    var e = easy();
    if (!e || !e.state) return;           // host not ready yet; existence poll will retry
    _applied = true;

    var pref = readPref();
    if (!pref) {                          // no saved choice -> leave default untouched
      _last = e.state.mode;
      return;
    }
    var wantMode = prefToMode(pref);
    _last = wantMode;                     // we are about to make state match the saved pref
    if (e.state.mode !== wantMode) {
      safe(function () { e.state.mode = wantMode; });
      // If a panel was already mounted/rendered, repaint immediately via the
      // host's own render so the corrected view shows without a lingering flash.
      safe(function () {
        if (typeof e.render === "function" && document.getElementById("mlsEasyPanel")) {
          e.render();
        }
      });
    }
  }

  // ===========================================================
  //  PERSIST: when the doctor toggles the view, the host mutates
  //  __mlsEasy.state.mode. We notice the change and save the flag.
  //  Pure reads + a localStorage write; no DOM mutation -> no churn.
  // ===========================================================
  function persistIfChanged() {
    if (_reverted) return;
    var m = curMode();
    if (!m) return;                       // host not ready yet
    if (m !== _last) {
      _last = m;
      writePref(modeToPref(m));
    }
  }

  // ===========================================================
  //  watcher: an existence/apply + persist tick. Cheap property
  //  reads only; no DOM writes here, so it can never loop or flicker.
  // ===========================================================
  var _poll = null, _fast = null, _fastTries = 0;

  function tick() {
    if (_reverted) return;
    if (!_applied) apply();               // keep trying until host exists, then once
    persistIfChanged();
  }

  function startFastApply() {
    // Apply as early as possible (before first render) by checking on a tight
    // micro-poll until __mlsEasy appears, then stop the fast loop.
    _fast = setInterval(function () {
      if (_reverted || _applied) { clearInterval(_fast); _fast = null; return; }
      apply();
      if (++_fastTries > 600) { clearInterval(_fast); _fast = null; } // ~12s safety cap
    }, 20);
  }

  function start() {
    apply();                              // synchronous best-effort (host usually ready)
    if (!_applied) startFastApply();      // otherwise race the first render
    _poll = setInterval(tick, 1500);      // steady-state persist + late-apply (b366: 600ms was permanent idle churn)
  }

  // ===========================================================
  //  revert -- stop the watcher, detach. Does NOT change the
  //  current view or the saved flag (use clearSaved() for that).
  // ===========================================================
  function revert() {
    _reverted = true;
    safe(function () { if (_poll) clearInterval(_poll); });
    safe(function () { if (_fast) clearInterval(_fast); });
    safe(function () { window.__mlsViewPersist.installed = false; });
    return true;
  }

  // ---- public API (also exercised by the offline jsdom tests) ----
  window.__mlsViewPersist = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    key: KEY,
    apply: function () { _applied = false; apply(); },
    persist: persistIfChanged,
    readPref: readPref,
    writePref: writePref,
    clearSaved: clearSaved,
    _modeToPref: modeToPref,
    _prefToMode: prefToMode,
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  } catch (e) { safe(start); }

  // Also kick a synchronous apply right now (in case the host is already up and
  // a panel is about to render this very tick).
  safe(apply);
})();
