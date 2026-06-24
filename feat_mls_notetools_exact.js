/* feat_mls_notetools_exact.js  ->  window.__mlsNt  (Visit note + clinical-tools legibility)
 *
 *  STAGING-GATED, additive, reversible, idempotent, ASCII-only, NUL-free.
 *  Loaded AFTER feat_mls_visit_exact.js. Does NOT move any DOM and does NOT
 *  run any MutationObserver/append loop (so it can never reintroduce the
 *  vx flicker / spinner-restart / dropped-click churn). It is PURE CSS:
 *  one <style> injected once, kept present by a couple of late idempotent
 *  passes only.
 *
 *  WHY (root causes found live on ScribeFlow-staging.html):
 *   Fix 4  The vx grid is "1fr 1fr 360px" so the Clinical-note column renders
 *          ~326px wide -> the note box + the widgets that live in it are
 *          cramped and hard to read. As the note is the centerpiece, give it
 *          the most room and make the note box taller/legible.
 *   Fix 1  feat_mls_visit_exact.js buildTools() relocates the result panels +
 *          the ~100-card #visitToolsGroup OUT of #noteCard into a full-width
 *          ".vx-tools" strip below the grid (correct), but the section label
 *          (.vx-tools-lbl) is display:none until a panel opens, and the rows
 *          are small -> the area reads as empty/missing ("the widgets are
 *          gone"). Make the "Clinical tools & reports" header ALWAYS visible,
 *          give the tools area card chrome, and make every relocated panel
 *          (incl. the collapsible accordion rows and codeCard/optCard) legible
 *          and styled to match the redesign. Nothing is moved or deleted.
 *
 *  Reversible: window.__mlsNt.revert().
 */
;(function () {
  "use strict";
  var VERSION = "nt-1.0.0";
  try { if (window.__mlsNt && window.__mlsNt.installed) return; } catch (e) { return; }

  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsNt = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "mlsNtStyle";

  function css() {
    return [
      /* ===== Fix 4: give the Clinical note the most room + a taller, more
         readable note box. Desktop only; vx's <=1100 / <=820 collapses (which
         use the same selector) still apply unchanged at smaller widths. ===== */
      "@media (min-width:1101px){",
      "  #visitView .vx-grid{grid-template-columns:minmax(0,0.9fr) minmax(0,1.42fr) 344px!important}",
      "}",
      "#visitView #noteCard{min-width:0}",
      "#visitView #noteBox{min-height:440px!important;font-size:14.5px!important;line-height:1.62!important;letter-spacing:.005em}",
      "#visitView #noteCard #visitComment{font-size:14px!important;line-height:1.55!important}",
      /* the in-note coding readouts stay readable when the column widens */
      "#visitView #codeCard,#visitView #optCard{font-size:14px!important}",

      /* ===== Fix 1: surface the relocated tools as a real, always-labelled
         "Clinical tools & reports" area, styled to match the redesign, with
         legible rows. CSS only -- the panels remain the app's real, wired
         elements moved into .vx-tools-host by the visit module. ===== */
      /* the section wrapper reads as a panel */
      "#visitView .vx-tools{margin-top:24px!important}",
      /* header always visible (vx hides it until a panel opens) */
      "#visitView .vx-tools .vx-tools-lbl{display:block!important;font-size:12px!important;font-weight:800!important;letter-spacing:.08em!important;text-transform:uppercase!important;color:#5b6b82!important;margin:0 0 14px!important;padding-bottom:10px!important;border-bottom:1px solid #e4ebf3!important}",
      /* a soft container around the tool host so it feels part of the note workflow */
      "#visitView .vx-tools-host{gap:14px!important}",
      /* every relocated result panel + accordion row: card chrome to match */
      "#visitView .vx-tools-host .extra-card,#visitView .vx-tools-host .code-card,#visitView .vx-tools-host .opt-card{background:#fff!important;border:1px solid #e4ebf3!important;border-radius:14px!important;box-shadow:0 1px 2px rgba(15,37,64,.04)!important}",
      /* collapsible accordion rows: bigger tap targets + readable titles */
      "#visitView .vx-tools-host .extra-card.collapsible{padding:0!important;overflow:hidden!important}",
      "#visitView .vx-tools-host .extra-card.collapsible>h3{font-size:15.5px!important;font-weight:700!important;padding:15px 18px!important;margin:0!important;cursor:pointer;display:flex;align-items:center;gap:9px}",
      "#visitView .vx-tools-host .extra-card.collapsible:hover>h3{background:#f7f9fc!important}",
      "#visitView .vx-tools-host .extra-card .xbody,#visitView .vx-tools-host .extra-card textarea{font-size:14px!important;line-height:1.55!important}",
      /* keep the host contents from forcing horizontal overflow */
      "#visitView .vx-tools-host,#visitView .vx-tools-host *{box-sizing:border-box}",
      "#visitView .vx-tools-host input,#visitView .vx-tools-host textarea,#visitView .vx-tools-host select{max-width:100%}",
      /* the inline "Clinical tools" reveal button in the note reads as a clear affordance */
      "#visitView #visitToolsToggleRow #visitToolsBtn{font-weight:700!important}",
      /* hide the tools area entirely in Simple/Easy view (matches vx behaviour) */
      "html.mls-sv-active #visitView .vx-tools{display:none!important}"
    ].join("\n");
  }

  function apply() {
    var s = document.getElementById(STYLE_ID);
    if (!s) {
      s = document.createElement("style");
      s.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(s);
    }
    var c = css();
    if (s.textContent !== c) s.textContent = c;
  }

  function revert() {
    try { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
    try { window.__mlsNt.installed = false; } catch (e) {}
  }

  function boot() {
    try { apply(); } catch (e) {}
    /* a couple of late idempotent passes in case head is rebuilt after us */
    try { setTimeout(apply, 500); } catch (e) {}
    try { setTimeout(apply, 1800); } catch (e) {}
  }

  window.__mlsNt = { installed: true, version: VERSION, apply: apply, revert: revert };
  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
  } catch (e) { try { boot(); } catch (e2) {} }
})();
