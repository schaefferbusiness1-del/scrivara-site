/* feat_mls_settings_exact.js  ->  window.__mlsStx  (Settings modal, design-exact rebuild)
 *  STAGING ONLY (loaded by mls-connect.staging.js; on prod activated via prod-enable
 *  marker). Runtime-gated. Production app logic untouched. No credential ever read/written.
 *
 *  Rebuilds #settingsModal to design_renders/ScribeFlow Settings.dc.html: a 1040px white
 *  rounded card on a navy backdrop, a sticky header (gear + "Settings" + square close X),
 *  a 2-col body (scrolling content column on the left + a 248px gray section-nav panel on
 *  the right whose tabs are the app's REAL #settingsTabBar .set-tab buttons -- built/wired
 *  by the app's mlsBuildSettingsTabs/mlsSelectSettingsTab; active tab = blue gradient), and
 *  a sticky footer (full-width gradient Save + Close). Every field/section/handler stays the
 *  app's real wired element; this is layout + design tokens via CSS line-placement only --
 *  NO DOM is moved (the .set-section blocks stay direct children of .modal, which the app's
 *  tab logic depends on). Pure restyle => no re-render thrash.
 *
 *  Reversible: window.__mlsStx.revert(). ASCII-only. Idempotent. Scoped to #settingsModal.
 */
;(function () {
  "use strict";
  var VERSION = "stx-2.0.0";
  try { if (window.__mlsStx && window.__mlsStx.installed) return; } catch (e) { return; }
  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsStx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "stxStyle"; var _t = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }

  var FIELD = "#settingsModal .modal .field input:not([type=checkbox]):not([type=radio]),#settingsModal .modal .field select,#settingsModal .modal .field textarea,#settingsModal .modal .set-section input:not([type=checkbox]):not([type=radio]),#settingsModal .modal .set-section select,#settingsModal .modal .set-section textarea";

  function injectCSS() {
    var css = [
      /* navy backdrop */
      "#settingsModal.show{background:linear-gradient(135deg,rgba(13,33,56,.92),rgba(20,53,96,.92))!important}",
      /* the card: 2-col grid (content | 248 nav), sticky header/footer, design chrome */
      "#settingsModal .modal{width:1040px!important;max-width:96vw!important;max-height:90vh!important;border-radius:20px!important;box-shadow:0 40px 90px -30px rgba(0,0,0,.6)!important;overflow:auto!important;padding:0!important;display:grid!important;grid-template-columns:1fr 248px!important;align-content:start!important;background:#fff!important}",
      "#settingsModal .modal,#settingsModal .modal *{box-sizing:border-box}",
      /* header bar (h3 spans both cols, sticky) + square X (sticky, top-right) */
      "#settingsModal .modal > h3{grid-area:1 / 1 / 2 / 3!important;position:sticky!important;top:0!important;z-index:5!important;background:#fff!important;margin:0!important;padding:22px 28px!important;border-bottom:1px solid #eef2f7!important;font-size:22px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#settingsModal .modal-x{grid-area:1 / 2 / 2 / 3!important;position:sticky!important;top:0!important;z-index:6!important;justify-self:end!important;align-self:center!important;margin:0 18px 0 0!important;width:36px!important;height:36px!important;border-radius:10px!important;border:1px solid #e0e8f1!important;background:#fff!important;color:#6b7d93!important;font-size:17px!important;line-height:1!important;display:flex!important;align-items:center!important;justify-content:center!important;cursor:pointer}",
      /* intro + sections live in the LEFT content column */
      "#settingsModal #settingsIntro{grid-column:1!important;margin:0!important;padding:18px 30px 0!important;color:#6b7d93!important;font-size:13px!important}",
      "#settingsModal .modal > .set-section{grid-column:1!important;border:0!important;background:#fff!important;margin:0!important;padding:14px 30px 6px!important}",
      "#settingsModal .modal > .set-section .set-head{font-size:13px!important;font-weight:700!important;letter-spacing:.04em!important;color:#0f2540!important;margin:0 0 6px!important}",
      "#settingsModal .modal > .set-section .set-desc{color:#6b7d93!important;font-size:13px!important;line-height:1.5!important;margin:0 0 14px!important}",
      "#settingsModal .modal > .set-section .field{margin-bottom:14px!important}",
      "#settingsModal .modal > .set-section .field label{display:block!important;font-size:13px!important;font-weight:700!important;margin-bottom:8px!important;color:#0f2540!important}",
      FIELD + "{width:100%!important;min-height:46px!important;border-radius:11px!important;border:1px solid #e0e8f1!important;background:#f8fafc!important;padding:11px 15px!important;font-size:14px!important;font-family:inherit!important;color:#0f2540!important;outline:none!important;max-width:100%}",
      "#settingsModal .modal > .set-section textarea{min-height:90px!important}",
      "#settingsModal .modal .btn-primary{border:0!important;background:linear-gradient(135deg,#2f6bed,#2257cf)!important;color:#fff!important;border-radius:11px!important;font-weight:700!important}",
      /* right section-nav panel (the app's real #settingsTabBar) */
      "#settingsModal #settingsTabBar{grid-area:2 / 2 / 9999 / 3!important;position:sticky!important;top:65px!important;align-self:start!important;display:flex!important;flex-direction:column!important;gap:4px!important;width:auto!important;max-height:calc(90vh - 150px)!important;overflow-y:auto!important;background:#f3f6fb!important;border-left:1px solid #eef2f7!important;padding:20px 16px!important;margin:0!important;border-radius:0!important}",
      "#settingsModal #settingsTabBar .set-tab{display:flex!important;align-items:center!important;gap:10px!important;width:100%!important;height:44px!important;padding:0 14px!important;border:0!important;border-radius:11px!important;background:transparent!important;color:#42566e!important;font-family:inherit!important;font-weight:600!important;font-size:13.5px!important;text-align:left!important;cursor:pointer!important;margin:0!important}",
      "#settingsModal #settingsTabBar .set-tab:hover{background:rgba(47,107,237,.07)!important}",
      "#settingsModal #settingsTabBar .set-tab.on{background:linear-gradient(135deg,#2f6bed,#2257cf)!important;color:#fff!important;font-weight:700!important;box-shadow:0 8px 18px -8px rgba(47,107,237,.6)!important}",
      /* sticky footer (Save/Close) spanning full width */
      "#settingsModal .modal > .row{grid-column:1 / -1!important;position:sticky!important;bottom:0!important;z-index:7!important;display:flex!important;gap:12px!important;padding:16px 28px!important;border-top:1px solid #eef2f7!important;background:#fbfcfe!important;margin:0!important}",
      "#settingsModal .modal > .row .btn-primary{flex:1!important;height:50px!important;font-size:15px!important}",
      "#settingsModal .modal > .row .btn-ghost{height:50px!important;padding:0 28px!important;border-radius:12px!important;border:1px solid #e0e8f1!important;background:#fff!important;color:#3d5168!important;font-weight:600!important;font-size:15px!important}",
      "#settingsModal .modal > #keyHint,#settingsModal .modal > .mini{grid-column:1 / -1!important;padding:0 28px 14px!important;margin:0!important}",
      /* responsive: stack nav under content below 820 */
      "@media (max-width:820px){#settingsModal .modal{grid-template-columns:1fr!important}#settingsModal .modal > h3{grid-area:auto!important}#settingsModal .modal-x{grid-area:auto!important;position:absolute!important;top:14px!important;right:14px!important}#settingsModal #settingsTabBar{grid-area:auto!important;position:static!important;flex-direction:row!important;flex-wrap:wrap!important;border-left:0!important;border-bottom:1px solid #eef2f7!important;max-height:none!important;order:-1}#settingsModal #settingsTabBar .set-tab{width:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  function build() { injectCSS(); var m = $("settingsModal"); if (m) m.setAttribute("data-stx-built", VERSION); }
  function boot() { build(); var n = 0; _t = setInterval(function () { build(); if (++n > 6) clearInterval(_t); }, 1000); }
  function revert() { try { if (_t) clearInterval(_t); } catch (e) {} try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {} try { window.__mlsStx.installed = false; } catch (e) {} }
  window.__mlsStx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); } catch (e) { try { boot(); } catch (e2) {} }
})();
