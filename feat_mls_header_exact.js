/* feat_mls_header_exact.js  ->  window.__mlsHx  (Header / nav bar, design-exact)
 *
 *  STAGING ONLY. Loaded by mls-connect.staging.js AFTER feat_mls_redesign.js
 *  (the overlay that builds the dark top bar #mlsRdTop + nav #mlsRdNav) and
 *  AFTER feat_mls_visit_exact.js. Never loaded by the prod loader mls-connect.js.
 *  Runtime-gated to the staging page. Production untouched.
 *
 *  Brings the WHOLE header to design_renders/ScribeFlow.dc.html exactly:
 *    ROW 1 (68px): logo + Simple|Complex toggle + search (380) + spacer +
 *                  Menu + avatar(MS / name / plan)
 *    ROW 2 (46px): 8 left tabs (Calendar, Patients, Visit, Recommendations,
 *                  History, Legal requests, Team, Analysis) + spacer +
 *                  AI Studio (purple PREMIUM pill) + Help
 *  The app's #appHeader was a flex ROW that placed #mlsRdTop (squished) beside
 *  #mlsRdNav; v2 makes #appHeader a COLUMN so the two design rows stack, and
 *  lays #mlsRdTop out as the design's single inline 68px row.
 *  Nav labels de-emojified to match the design (plain text + badge pill);
 *  AI Studio keeps the design star; originals saved for revert.
 *  Orders + Admin (not in the design top bar) RELOCATED into the Menu dropdown.
 *
 *  All tabs/controls are the app's REAL elements (onclick=showView, the real
 *  toggle/search/menu) - this only moves/restyles/relabels them. Nothing deleted.
 *  Reversible: window.__mlsHx.revert().  ASCII-only. Idempotent.
 */
;(function () {
  "use strict";
  var VERSION = "hx-2.0.1";
  var OWNER = "leeschaeffer41";
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
      /* ROW STACK: appHeader becomes a column so top row + nav row stack (design) */
      "#appHeader{flex-direction:column!important;align-items:stretch!important;height:auto!important;gap:0!important;padding:0!important;max-width:100vw!important}",
      /* ROW 1: design single inline 68px row, centered max-width 1500, 28 padding */
      "#mlsRdTop{display:flex!important;align-items:center!important;gap:22px!important;width:100%!important;max-width:1500px!important;margin:0 auto!important;padding:0 28px!important;height:68px!important;box-sizing:border-box!important;flex:0 0 auto!important}",
      /* logo block keeps its width; search takes the flexible middle (design 380) */
      "#mlsRdTop>div:first-child{flex:0 0 auto!important}",
      "#mlsRdToggleSlot{flex:0 0 auto!important}",
      "#mlsRdSearchSlot{flex:1 1 auto!important;max-width:380px!important;margin-left:8px!important}",
      "#mlsRdMenuSlot{flex:0 0 auto!important}",
      /* ROW 2: nav full-width, centered, 28 padding (so tabs start under the logo) */
      "#mlsRdNav{width:100%!important;max-width:1500px!important;margin:0 auto!important;padding:0 28px!important;height:46px!important;box-sizing:border-box!important;overflow-x:auto!important;overflow-y:hidden!important;-ms-overflow-style:none;scrollbar-width:none}",
      "#mlsRdNav::-webkit-scrollbar{height:0!important;display:none}",
      "#mlsRdNav .mainnav{flex-wrap:nowrap!important;min-width:0!important;gap:4px!important;height:46px!important;align-items:center!important}",
      /* tablet/phone: keep top chrome contained, no horizontal overflow */
      "@media (max-width:1100px){#mlsRdTop,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}",
      "@media (max-width:760px){#mlsRdTop{flex-wrap:wrap!important;height:auto!important;gap:10px!important;padding:8px 14px!important}#mlsRdSearchSlot{order:5!important;max-width:100%!important;flex:1 1 100%!important;margin-left:0!important}}",
      /* design tab tokens (plain pill, no icon) */
      "#mlsRdNav .navtab{height:32px!important;padding:0 13px!important;border-radius:9px!important;font-size:13.5px!important;display:flex!important;align-items:center!important;gap:7px!important;white-space:nowrap!important;border:none!important;flex:0 0 auto!important}",
      "#mlsRdNav .navtab:not(.on){background:transparent!important;color:#adc2dd!important;font-weight:600!important}",
      "#mlsRdNav .navtab.on{background:rgba(95,227,207,.16)!important;color:#7ff0de!important;font-weight:700!important}",
      /* design badge pill (counts) */
      "#mlsRdNav .navtab .nbadge{font-size:10.5px!important;font-weight:700!important;line-height:1!important;padding:3px 7px!important;border-radius:20px!important;background:rgba(159,192,255,.18)!important;color:#cfe0ff!important;margin-left:1px!important}",
      "#mlsRdNav .navtab.on .nbadge{background:rgba(95,227,207,.22)!important;color:#9ff3e3!important}",
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
    var badge = el.querySelector(".mls-prem-pill, .nbadge, [class*='badge'], [class*='pill']");
    if (badge) {
      imp(badge, "background", "rgba(255,255,255,.25)"); imp(badge, "color", "#fff");
      imp(badge, "font-size", "9.5px"); imp(badge, "padding", "1px 6px");
      imp(badge, "border-radius", "20px"); imp(badge, "letter-spacing", ".04em");
    }
  }
  function styleHelp(el) {
    imp(el, "height", "30px"); imp(el, "padding", "0 12px"); imp(el, "border-radius", "8px");
    imp(el, "background", "transparent"); imp(el, "color", "#9fb4ce"); imp(el, "font-weight", "600");
    imp(el, "font-size", "13px"); imp(el, "border", "none");
  }

  /* de-emojify a nav tab's leading label text node to match the design (plain text).
   * studioStar=true keeps a single design star prefix on AI Studio. Reversible. */
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
    if (studioStar) clean = "\u2726 " + clean;
    if (node.textContent !== clean) node.textContent = clean;
  }
  function relabelAll() {
    ["nav_calendar", "nav_patients", "nav_visit", "nav_recs", "nav_history",
     "nav_legalreq", "nav_team", "nav_analysis", "nav_help"].forEach(function (id) { relabel(id, false); });
    relabel("nav_studio", true);
  }

  /* avatar: design shows the logged-in provider name + plan. Only relabel for the
   * account owner (his explicit request); other accounts keep their real text. */
  function fixAvatar() {
    var box = document.querySelector(".mlsRdAvName"); if (!box || box.children.length < 1) return;
    var line1 = box.children[0];
    var cur = (line1.textContent || "").toLowerCase();
    var isOwner = cur.indexOf(OWNER) >= 0 || cur.indexOf("michael") >= 0;
    if (!isOwner) return;
    if (line1.textContent !== "Dr. Michael L. Schaeffer") {
      if (line1.getAttribute("data-hx-orig") == null) line1.setAttribute("data-hx-orig", line1.textContent);
      line1.textContent = "Dr. Michael L. Schaeffer";
    }
    var line2 = box.children[1];
    /* only relabel the sub-line if it is NOT an interactive control */
    if (line2 && !line2.getAttribute("onclick") && !line2.onclick && line2.tagName !== "A" && line2.tagName !== "BUTTON") {
      if (line2.textContent !== "Standard plan") {
        if (line2.getAttribute("data-hx-orig") == null) line2.setAttribute("data-hx-orig", line2.textContent);
        line2.textContent = "Standard plan";
      }
    }
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
    relabelAll();
    fixAvatar();

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
      var avbox = document.querySelector(".mlsRdAvName");
      if (avbox) Array.prototype.forEach.call(avbox.children, function (c) {
        var o = c.getAttribute && c.getAttribute("data-hx-orig");
        if (o != null) { c.textContent = o; c.removeAttribute("data-hx-orig"); }
      });
    } catch (e) {}
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
