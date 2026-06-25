/* ============================================================================
 * feat_mls_offtab_navhide.js  ->  window.__mlsOffTabHide   (oth-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 6b (nav half): when an App-tab (Settings -> App tabs: Orders / Legal
 * requests / Team) is toggled OFF, it must DISAPPEAR from the top nav AND be
 * reachable from the Menu dropdown.
 *
 * The Menu half already works: feat_mls_apptabs_menu.js adds Legal requests /
 * Team rows to #mlsTbMenuPanel when OFF, and feat_mls_header_exact relocates
 * Orders into the Menu. But the NAV half was incomplete -- toggling a tab OFF
 * only adds the ".nav-feat-off" class; the tab stayed visible in the nav
 * (the redesign's force-show / base .navtab display kept it at display:flex),
 * so Legal requests and Team appeared in BOTH the nav and the Menu.
 *
 * Fix (additive, reversible, idempotent): one scoped CSS rule that hides
 * ".navtab.nav-feat-off" INSIDE the top-nav container only, with enough
 * specificity (two ids: #appHeader #mlsRdNav) to beat the redesign's
 * single-id force-show rule. Scoping to the nav is essential: Orders' relocated
 * copy lives in #mlsTbMenuPanel and also carries ".nav-feat-off" -- we must NOT
 * hide that (it is the Menu entry). A ".mainnav" fallback covers non-redesign
 * layouts; both are still within #appHeader and never match the Menu panel.
 *
 * Behavior is automatic and symmetric: turning a tab back ON removes
 * ".nav-feat-off" (setNavFeat), so the rule stops matching and the tab returns
 * to the nav; apptabs_menu removes its Menu row. No JS state, no app data, no
 * network, no PHI. ASCII-only. Reversible: window.__mlsOffTabHide.revert().
 * ==========================================================================*/
;(function () {
  "use strict";
  try { if (window.__mlsOffTabHide && window.__mlsOffTabHide.installed) return; } catch (e) { return; }

  var VERSION = "oth-1.0.0";
  var STYLE_ID = "mlsOffTabHideStyle";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  function injectCSS() {
    if (safe(function () { return document.getElementById(STYLE_ID); }, null)) return;
    var css = [
      /* primary: redesign nav (#mlsRdNav) -- two ids beat the redesign force-show */
      "html #appHeader #mlsRdNav .navtab.nav-feat-off{display:none !important}",
      /* fallback: classic .mainnav nav row, still inside the header (never the Menu panel) */
      "html #appHeader .mainnav .navtab.nav-feat-off{display:none !important}"
    ].join("");
    var s = safe(function () { return document.createElement("style"); }, null);
    if (!s) return;
    s.id = STYLE_ID;
    s.textContent = css;
    safe(function () { (document.head || document.documentElement).appendChild(s); });
  }

  var _timer = null;
  function boot() {
    injectCSS();
    /* low-cost self-heal: if the header is rebuilt, re-add the style */
    _timer = setInterval(function () { safe(injectCSS); }, 800);
    /* stop the cheap poll after a while; the style persists once present */
    setTimeout(function () { if (_timer) { safe(function () { clearInterval(_timer); }); _timer = null; } }, 12000);
  }

  function revert() {
    if (_timer) { safe(function () { clearInterval(_timer); }); _timer = null; }
    safe(function () { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { window.__mlsOffTabHide.installed = false; });
  }

  window.__mlsOffTabHide = { installed: true, version: VERSION, reapply: boot, revert: revert };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
