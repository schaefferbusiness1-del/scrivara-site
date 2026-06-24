/* feat_mls_header_exact.js  ->  window.__mlsHx  (Header / nav bar, design-exact)
 *
 *  STAGING ONLY. Loaded by mls-connect.staging.js AFTER feat_mls_redesign.js
 *  (the overlay that builds the dark top bar #mlsRdTop + nav #mlsRdNav) and
 *  AFTER feat_mls_visit_exact.js. Never loaded by the prod loader mls-connect.js.
 *  Runtime-gated to the staging page. Production untouched.
 *
 *  Brings the top nav to design_renders/ScribeFlow.dc.html exactly:
 *    - left: the 8 design tabs (Calendar, Patients, Visit, Recommendations,
 *      History, Legal requests, Team, Analysis) styled with design tokens
 *    - a flex spacer, then RIGHT-aligned: "AI Studio" purple pill + "Help" ghost
 *    - Orders + Admin (not in the design top bar) RELOCATED into the Menu
 *      dropdown (nothing deleted; still one click away; onclick=showView intact)
 *    - nav row scroll-contained so it never overflows/overlaps at any width
 *
 *  All tabs are the app's REAL .navtab elements (onclick=showView preserved);
 *  this only moves/restyles them. Reversible: window.__mlsHx.revert().
 *  ASCII-only. Idempotent.
 */
;(function () {
  "use strict";
  var VERSION = "hx-1.0.0";
  try { if (window.__mlsHx && window.__mlsHx.installed) return; } catch (e) { return; }

  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsHx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "hxStyle";
  var _obs = null, _t = null, _sched = null;

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }

  function injectCSS() {
    var css = [
      /* nav row: single line, scroll-contained, never overflows the viewport */
      "#mlsRdNav{max-width:100vw!important;overflow-x:auto!important;overflow-y:hidden!important;-ms-overflow-style:none;scrollbar-width:none}",
      "#mlsRdNav::-webkit-scrollbar{height:0!important;display:none}",
      "#mlsRdNav .mainnav{flex-wrap:nowrap!important;min-width:0!important}",
      /* contain the other top chrome bars too (no overlap/overflow in tablet band) */
      "@media (max-width:1100px){#mlsRdTop,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}",
      /* design tab tokens */
      "#mlsRdNav .navtab{height:32px!important;padding:0 13px!important;border-radius:9px!important;font-size:13.5px!important;display:flex!important;align-items:center!important;gap:7px!important;white-space:nowrap!important;border:none!important;flex:0 0 auto!important}",
      "#mlsRdNav .navtab:not(.on){background:transparent!important;color:#adc2dd!important;font-weight:600!important}",
      "#mlsRdNav .navtab.on{background:rgba(95,227,207,.16)!important;color:#7ff0de!important;font-weight:700!important}",
      /* hidden (relocated) tabs */
      "#mlsRdNav #nav_orders,#mlsRdNav #nav_admin{display:none!important}",
      /* relocated tabs rendered as menu rows inside the Menu dropdown */
      "#mlsTbMenuPanel .navtab.hx-menurow{display:flex!important;width:100%!important;height:auto!important;justify-content:flex-start!important;padding:9px 12px!important;border-radius:9px!important;background:transparent!important;color:#1f2d40!important;font-weight:600!important;font-size:13.5px!important;box-sizing:border-box!important}",
      "#mlsTbMenuPanel .navtab.hx-menurow:hover{background:#f1f5fb!important}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  function styleStudio(el) {
    imp(el, "height", "30px"); imp(el, "padding", "0 12px"); imp(el, "border-radius", "8px");
    imp(el, "background", "linear-gradient(135deg,#7c3aed,#a855f7)"); imp(el, "color", "#fff");
    imp(el, "font-weight", "700"); imp(el, "font-size", "12.5px"); imp(el, "border", "none");
    imp(el, "white-space", "nowrap");
    var badge = el.querySelector(".nbadge, [class*='badge'], [class*='pill']");
    if (badge) { imp(badge, "background", "rgba(255,255,255,.25)"); imp(badge, "color", "#fff"); }
  }
  function styleHelp(el) {
    imp(el, "height", "30px"); imp(el, "padding", "0 12px"); imp(el, "border-radius", "8px");
    imp(el, "background", "transparent"); imp(el, "color", "#9fb4ce"); imp(el, "font-weight", "600");
    imp(el, "font-size", "13px"); imp(el, "border", "none");
  }

  /* relocate Orders + Admin tabs into the Menu dropdown panel (keep + reachable) */
  function relocateToMenu() {
    var menu = $("mlsTbMenuPanel") || $("mlsTbMenu"); if (!menu) return;
    ["nav_orders", "nav_admin"].forEach(function (id) {
      var t = $(id); if (!t) return;
      if (t.parentElement === menu) return; /* already relocated */
      t.classList.add("hx-menurow");
      t.setAttribute("data-hx-relocated", "1");
      menu.appendChild(t);
    });
  }

  function buildNav() {
    var nav = $("mlsRdNav"); if (!nav) return;
    var mainnav = nav.querySelector(".mainnav"); if (!mainnav) return;

    relocateToMenu();

    /* spacer pushes AI Studio + Help to the right (design layout) */
    var studio = $("nav_studio"), help = $("nav_help");
    if (studio && studio.parentElement === mainnav && !mainnav.querySelector(":scope > .hx-spacer")) {
      var sp = mk("div", "flex:1 1 auto;min-width:8px"); sp.className = "hx-spacer";
      mainnav.insertBefore(sp, studio);
    }
    if (studio) styleStudio(studio);
    if (help) styleHelp(help);
  }

  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { injectCSS(); buildNav(); } catch (e) {}
    try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}
  }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 160); }
  function boot() {
    try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {}
    applyAll();
    var n = 0; _t = setInterval(function () { applyAll(); if (++n > 12) clearInterval(_t); }, 700);
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_t) clearInterval(_t); } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try {
      ["nav_orders", "nav_admin"].forEach(function (id) {
        var t = $(id); if (t) { t.classList.remove("hx-menurow"); t.removeAttribute("data-hx-relocated"); }
      });
    } catch (e) {}
    try { window.__mlsHx.installed = false; } catch (e) {}
  }

  window.__mlsHx = { installed: true, version: VERSION, reapply: boot, revert: revert };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
