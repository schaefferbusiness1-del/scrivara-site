/* ============================================================================
 * feat_mls_navfeat_keep.js  ->  window.__mlsNavFeatKeep  (nfk-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 34 -- LEGAL/TEAM NAV REGRESSION FIX (additive, reversible)
 *
 * SYMPTOM
 *   The "Legal requests" and "Team" top-nav tabs showed on load, then vanished
 *   (display:none) on the first tab click or Simple/Complex toggle -- while
 *   still being reachable from the Menu. They reappeared on reload, then hid
 *   again. Jarring and inconsistent.
 *
 * ROOT CAUSE
 *   App-tab gating (applyNavFeatureGates) adds the ".nav-feat-off" class to a
 *   tab whenever navFeatOn(key) is false. navFeatOn() returns false for BOTH
 *   "explicitly turned off in Settings" (localStorage value === '0') AND a
 *   never-touched default. item13 (feat_mls_offtab_navhide) then hides any
 *   ".navtab.nav-feat-off" inside the nav. So a tab the doctor never actually
 *   turned off still gets hidden on every re-gate (which runs on each nav).
 *
 * FIX
 *   Distinguish a GENUINE Settings toggle from a pre-existing/default '0':
 *     - Wrap window.setNavFeat so a real Settings interaction records an
 *       "explicit" marker (mls_navfeatx_<key>) AND, when turned back ON, clears
 *       it. (Genuine off => marker present + value '0'.)
 *     - For 'legalreq' and 'team' ONLY: a tab should carry .nav-feat-off in the
 *       nav ONLY when it is EXPLICITLY off (marker present AND value '0').
 *       Otherwise (default '0' that the doctor never set, or value '1') keep the
 *       tab in the nav by removing the stray .nav-feat-off.
 *   This is exactly "stay in the nav unless ACTUALLY toggled off in Settings;
 *   do not re-hide on every nav."
 *
 *   Applies to the original tabs (#nav_legalreq / #nav_team) AND the redesign
 *   clones in #mlsRdNav (matched by their data-hx-orig label). Leaves Orders and
 *   every other tab, the Menu entries, and Simple-view's separate ".mls-sv-hide"
 *   system entirely untouched. Kept healed via a wrap of applyNavFeatureGates,
 *   a scoped MutationObserver, and a short bounded poll.
 *
 * SAFETY: additive, idempotent, ASCII-only. No network, no PHI, no athenaOne.
 *   Reversible: window.__mlsNavFeatKeep.revert().
 * ==========================================================================*/
;(function () {
  "use strict";
  try { if (window.__mlsNavFeatKeep && window.__mlsNavFeatKeep.installed) return; } catch (e) { return; }

  var VERSION = "nfk-1.0.0";
  var KEYS = ["legalreq", "team"];           /* scope: ONLY these two tabs */
  var LABELS = { legalreq: /legal request/i, team: /(^|\s)team(\s|$)/i };

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function unsKey(k) {
    return safe(function () {
      if (typeof window.uns === "function") return window.uns("navfeat_" + k);
      return "navfeat_" + k;
    }, "navfeat_" + k);
  }
  function rawVal(k) { return safe(function () { return localStorage.getItem(unsKey(k)); }, null); }
  function explicitMarkerKey(k) {
    return safe(function () {
      if (typeof window.uns === "function") return window.uns("navfeatx_" + k);
      return "navfeatx_" + k;
    }, "navfeatx_" + k);
  }
  function isExplicitlyOff(k) {
    var v = rawVal(k);
    if (v !== "0") return false;                 /* not off at all */
    var marker = safe(function () { return localStorage.getItem(explicitMarkerKey(k)); }, null);
    return marker === "1";                        /* off AND the doctor actually set it */
  }

  /* ---- collect the nav tab nodes for a given key (originals + redesign clones) ---- */
  function tabsFor(k) {
    var out = [];
    safe(function () {
      var orig = document.getElementById("nav_" + k);
      if (orig) out.push(orig);
    });
    safe(function () {
      var rd = document.querySelectorAll('#mlsRdNav .navtab, #appHeader .mainnav .navtab');
      var re = LABELS[k];
      for (var i = 0; i < rd.length; i++) {
        var t = rd[i];
        var lbl = (t.getAttribute && t.getAttribute("data-hx-orig")) || t.textContent || "";
        if (re.test(lbl) && out.indexOf(t) === -1) out.push(t);
      }
    });
    return out;
  }

  function fix() {
    KEYS.forEach(function (k) {
      var off = isExplicitlyOff(k);
      var tabs = tabsFor(k);
      for (var i = 0; i < tabs.length; i++) {
        var t = tabs[i];
        if (!t || !t.classList) continue;
        if (off) {
          /* genuine Settings-off: leave the app's gating in place */
        } else if (t.classList.contains("nav-feat-off")) {
          safe(function () { t.classList.remove("nav-feat-off"); });
        }
      }
    });
  }

  /* ---- wrap setNavFeat so genuine Settings toggles are recorded as explicit ---- */
  var _origSetNavFeat = null;
  function wrapSetNavFeat() {
    safe(function () {
      if (typeof window.setNavFeat !== "function") return;
      if (window.setNavFeat.__mlsNfkWrapped) return;
      _origSetNavFeat = window.setNavFeat;
      var wrapped = function (key, on) {
        try {
          if (KEYS.indexOf(key) !== -1) {
            if (on) { try { localStorage.removeItem(explicitMarkerKey(key)); } catch (e) {} }
            else { try { localStorage.setItem(explicitMarkerKey(key), "1"); } catch (e) {} }
          }
        } catch (e) {}
        var r = _origSetNavFeat.apply(this, arguments);
        try { fix(); } catch (e) {}
        return r;
      };
      wrapped.__mlsNfkWrapped = true;
      wrapped.__mlsNfkOrig = _origSetNavFeat;
      window.setNavFeat = wrapped;
    });
  }

  /* ---- wrap applyNavFeatureGates so our heal runs right after each re-gate ---- */
  var _origGates = null;
  function wrapGates() {
    safe(function () {
      if (typeof window.applyNavFeatureGates !== "function") return;
      if (window.applyNavFeatureGates.__mlsNfkWrapped) return;
      _origGates = window.applyNavFeatureGates;
      var wrapped = function () {
        var r = _origGates.apply(this, arguments);
        try { fix(); } catch (e) {}
        return r;
      };
      wrapped.__mlsNfkWrapped = true;
      wrapped.__mlsNfkOrig = _origGates;
      window.applyNavFeatureGates = wrapped;
    });
  }

  var _obs = null, _poll = null, _t = null, _polls = 0;
  function schedule() { if (_t) return; _t = setTimeout(function () { _t = null; fix(); }, 60); }

  function boot() {
    wrapSetNavFeat();
    wrapGates();
    fix();
    safe(function () {
      _obs = new MutationObserver(function (muts) {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === "attributes" && m.attributeName === "class") { schedule(); return; }
          if (m.type === "childList" && (m.addedNodes.length)) { schedule(); return; }
        }
      });
      var host = document.getElementById("appHeader") || document.documentElement;
      _obs.observe(host, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    });
    /* bounded self-heal: re-wrap if the app (re)defines the fns late, then settle */
    safe(function () {
      _poll = setInterval(function () {
        _polls++;
        wrapSetNavFeat(); wrapGates(); fix();
        if (_polls > 40) { try { clearInterval(_poll); _poll = null; } catch (e) {} }
      }, 800);
    });
  }

  function revert() {
    safe(function () { if (_obs) _obs.disconnect(); _obs = null; });
    safe(function () { if (_poll) { clearInterval(_poll); _poll = null; } });
    safe(function () { if (_t) { clearTimeout(_t); _t = null; } });
    safe(function () {
      if (_origGates && window.applyNavFeatureGates && window.applyNavFeatureGates.__mlsNfkWrapped) {
        window.applyNavFeatureGates = _origGates;
      }
    });
    safe(function () {
      if (_origSetNavFeat && window.setNavFeat && window.setNavFeat.__mlsNfkWrapped) {
        window.setNavFeat = _origSetNavFeat;
      }
    });
    safe(function () { try { window.applyNavFeatureGates && window.applyNavFeatureGates(); } catch (e) {} });
    safe(function () { window.__mlsNavFeatKeep.installed = false; });
  }

  window.__mlsNavFeatKeep = { installed: true, version: VERSION, reapply: boot, revert: revert, fix: fix };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

