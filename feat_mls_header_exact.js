/* feat_mls_header_exact.js  ->  window.__mlsHx  (hx-3.0.0, Editorial Calm)
 *
 *  Activated by the data:-marker (script src "data:,mls-connect.staging.js")
 *  that mls-connect.js plants, so it runs on prod. Loaded AFTER
 *  feat_mls_redesign.js v3 (which now builds the Editorial Calm shell:
 *  LIGHT left rail #mlsRdNav + 60px top bar #mlsRdTop).
 *
 *  hx-3.0.0: the v2 dark two-row header layout is GONE (superseded by the
 *  rail shell). This module now keeps ONLY its non-layout responsibilities:
 *   1. ACCOUNT GATING (unchanged, security-relevant): the personal accounts
 *      leeschaeffer@gmail.com / leeschaeffer41@gmail.com never get admin
 *      (isAdmin forced off + Admin hidden everywhere). Real-admin business
 *      accounts keep Admin, reachable via the Menu dropdown.
 *   2. MENU RELOCATION: Orders lives in the Menu dropdown (not the rail);
 *      Admin joins the Menu only for real admins.
 *   3. LABEL CLEANUP: de-emojify nav labels (the calm rail uses clean text;
 *      AI Studio keeps a single star prefix). Reversible via data-hx-orig.
 *  All tabs/controls remain the app's REAL elements. Reversible:
 *  window.__mlsHx.revert().  ASCII-only. Idempotent.
 */
;(function () {
  "use strict";
  var VERSION = "hx-3.0.0";
  var OWNER = "leeschaeffer41";
  /* Personal accounts that must NEVER have admin (admin = business account only). */
  var PERSONAL_EMAILS = ["leeschaeffer@gmail.com", "leeschaeffer41@gmail.com"];
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

  /* ---- identity / admin gating ---------------------------------------- */
  function getBk() {
    try { if (typeof bkUser !== "undefined" && bkUser) return bkUser; } catch (e) {}
    try { return window.bkUser || null; } catch (e) {}
    return null;
  }
  function curEmail() {
    var u = getBk();
    if (u && u.email) { try { return String(u.email).toLowerCase(); } catch (e) {} }
    return "";
  }
  function isPersonal() { return PERSONAL_EMAILS.indexOf(curEmail()) >= 0; }
  /* real admin = an account the server marked isAdmin AND not a personal account */
  function effectiveAdmin() {
    var u = getBk(); if (!u) return false;
    if (isPersonal()) return false;
    return !!u.isAdmin;
  }
  /* Defense in depth: if a personal account somehow carries isAdmin, force it off
   * in the app's own model and re-run the app's gating so every admin-only bit hides.
   * (The business account is untouched.) Runs once per state; idempotent. */
  function gateAccount() {
    try {
      var u = getBk();
      if (u && isPersonal() && u.isAdmin) {
        u.isAdmin = false;
        try { if (typeof applyAccessUI === "function") applyAccessUI(); } catch (e) {}
      }
    } catch (e) {}
  }

  /* hx-3.0.0: only two small rules remain — hide Orders/Admin from the rail
   * (they live in the Menu) and keep relocated Menu rows readable on the
   * LIGHT calm menu panel. No layout/geometry rules (the rail shell owns those). */
  function injectCSS() {
    var css = [
      "#mlsRdNav #nav_orders,#mlsRdNav #nav_admin{display:none!important}",
      "#mlsTbMenuPanel .navtab.hx-menurow[data-hx-relocated]{display:flex!important;width:100%!important;height:auto!important;align-items:center!important;justify-content:flex-start!important;gap:10px!important;padding:10px 12px!important;border-radius:8px!important;background:transparent!important;font-weight:600!important;font-size:14px!important;box-sizing:border-box!important;text-align:left!important;box-shadow:none!important}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  /* de-emojify a nav tab's leading label text node (calm rail = clean text).
   * studioStar=true keeps a single star prefix on AI Studio. Reversible. */
  function relabel(id, studioStar) {
    var t = $(id); if (!t) return;
    var node = null, i;
    for (i = 0; i < t.childNodes.length; i++) {
      var n = t.childNodes[i];
      if (n.nodeType === 3 && n.textContent && /\S/.test(n.textContent)) { node = n; break; }
    }
    if (!node) return;
    if (t.getAttribute("data-hx-orig") == null) t.setAttribute("data-hx-orig", node.textContent);
    var clean = node.textContent.replace(/^[^A-Za-z]+/, "");
    if (studioStar) clean = "✦ " + clean;
    if (node.textContent !== clean) node.textContent = clean;
  }
  function relabelAll() {
    ["nav_calendar", "nav_patients", "nav_visit", "nav_recs", "nav_history",
     "nav_legalreq", "nav_team", "nav_analysis", "nav_help"].forEach(function (id) { relabel(id, false); });
    relabel("nav_studio", true);
  }

  /* Relocated Menu rows: neutral inline styling that reads on a light OR dark
   * panel (inherit color; the CSS rule above handles shape). */
  var MENUROW_STYLE = {
    "display": "flex", "width": "100%", "height": "auto", "align-items": "center",
    "justify-content": "flex-start", "gap": "10px", "padding": "10px 12px", "border-radius": "8px",
    "background": "transparent", "font-weight": "600", "font-size": "14px",
    "box-sizing": "border-box", "text-align": "left"
  };
  function styleMenuRow(el) { for (var k in MENUROW_STYLE) { if (MENUROW_STYLE.hasOwnProperty(k)) imp(el, k, MENUROW_STYLE[k]); } try { el.style.removeProperty("color"); } catch (e) {} }
  function clearMenuRow(el) { for (var k in MENUROW_STYLE) { if (MENUROW_STYLE.hasOwnProperty(k)) { try { el.style.removeProperty(k); } catch (e) {} } } }

  /* Orders -> Menu dropdown always. Admin -> Menu ONLY for real-admin (business)
   * accounts; for personal/non-admin accounts Admin is hidden everywhere. */
  function placeInMenu(el, menu) {
    if (el.parentElement !== menu) {
      el.style.removeProperty("display"); menu.appendChild(el);
    }
    if (!el.classList.contains("hx-menurow")) el.classList.add("hx-menurow");
    el.setAttribute("data-hx-relocated", "1");
    styleMenuRow(el);
  }
  function relocateToMenu() {
    var menu = $("mlsTbMenuPanel") || $("mlsTbMenu"); if (!menu) return;
    var o = $("nav_orders");
    if (o) placeInMenu(o, menu);
    try {
      var __ask = null, __cw = null, __k = menu.children;
      for (var __i = 0; __i < __k.length; __i++) {
        var __tx = (__k[__i].textContent || "").trim();
        if (/Ask$/.test(__tx)) __ask = __k[__i];
        if (/Custom widget$/.test(__tx)) __cw = __k[__i];
      }
      if (__ask) {
        var __an = __ask;
        ["recs", "legalreq", "team"].forEach(function (kk) {
          var __row = document.getElementById("mlsNavRow_" + kk);
          if (__row && __row.parentNode === menu) {
            if (__an.nextSibling !== __row) menu.insertBefore(__row, __an.nextSibling);
            __an = __row;
          }
        });
      }
      if (__cw && o && o.parentElement === menu && __cw.nextSibling !== o) {
        menu.insertBefore(o, __cw.nextSibling);
      }
    } catch (e) {}
    var a = $("nav_admin");
    if (a) {
      if (effectiveAdmin()) {
        placeInMenu(a, menu);
      } else {
        /* personal / non-admin: never in the menu, never visible */
        if (a.parentElement === menu) { /* move back out of the menu */
          clearMenuRow(a); a.classList.remove("hx-menurow"); a.removeAttribute("data-hx-relocated");
          var navw = $("mlsRdNav"); if (navw) navw.appendChild(a);
        }
        a.style.setProperty("display", "none", "important");
      }
    }
  }

  function buildNav() {
    var nav = $("mlsRdNav"); if (!nav) return;
    var mainnav = nav.querySelector(".mainnav"); if (!mainnav) return;
    gateAccount();
    relocateToMenu();
    relabelAll();
    /* hx-3.0.0: no spacer, no per-tab inline styling — the rail shell owns layout.
     * Clean up any leftover v2 spacer so the vertical rail has no stray flex gap. */
    try { var sp = mainnav.querySelector(":scope > .hx-spacer"); if (sp) sp.remove(); } catch (e) {}
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
      ["nav_calendar", "nav_patients", "nav_visit", "nav_recs", "nav_history",
       "nav_legalreq", "nav_team", "nav_analysis", "nav_studio", "nav_help"].forEach(function (id) {
        var t = $(id); if (!t) return;
        var orig = t.getAttribute("data-hx-orig");
        if (orig != null) {
          for (var i = 0; i < t.childNodes.length; i++) {
            var n = t.childNodes[i];
            if (n.nodeType === 3 && n.textContent && /\S/.test(n.textContent)) { n.textContent = orig; break; }
          }
          t.removeAttribute("data-hx-orig");
        }
      });
    } catch (e) {}
    try {
      ["nav_orders", "nav_admin"].forEach(function (id) {
        var t = $(id); if (t) { clearMenuRow(t); t.classList.remove("hx-menurow"); t.removeAttribute("data-hx-relocated"); t.style.removeProperty("display"); }
      });
    } catch (e) {}
    try { window.__mlsHx.installed = false; } catch (e) {}
  }

  window.__mlsHx = { installed: true, version: VERSION, reapply: boot, revert: revert,
    effectiveAdmin: effectiveAdmin, isPersonal: isPersonal };
  try { injectCSS(); } catch (e) {}
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
