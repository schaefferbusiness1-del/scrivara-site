/* feat_mls_settings_exact.js  ->  window.__mlsStx  (Settings modal, design-exact)
 *  STAGING ONLY. After other *_exact modules. Never prod. Runtime-gated.
 *  Brings #settingsModal toward ScribeFlow Settings.dc.html: the modal becomes
 *  the design's wide (1040) rounded card with a clean header, design section
 *  headings (.set-head/.set-desc), pill inputs, and a pill tab bar. Token
 *  restyle only (the exact 2-col content/nav split is deferred to live tuning so
 *  the settings form isn't broken blind). Nothing moved/deleted; every field +
 *  handler stays the app's real wired element. No credential is ever touched.
 *  Reversible: window.__mlsStx.revert(). ASCII-only. Idempotent. Scoped.
 */
;(function () {
  "use strict";
  var VERSION = "stx-1.0.0";
  try { if (window.__mlsStx && window.__mlsStx.installed) return; } catch (e) { return; }
  function isStaging() { try { if (/staging/i.test(location.pathname)) return true; if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true; } catch (e) {} return false; }
  if (!isStaging()) { try { window.__mlsStx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }
  var STYLE_ID = "stxStyle"; var _t = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function injectCSS() {
    var css = [
      "#settingsModal .modal{width:1040px!important;max-width:100%!important;max-height:90vh!important;border-radius:20px!important;box-shadow:0 40px 90px -30px rgba(0,0,0,.6)!important;overflow:auto!important}",
      "#settingsModal .modal,#settingsModal .modal *{box-sizing:border-box}",
      "#settingsModal .modal > h3{font-size:22px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#settingsModal .set-section{border:1px solid #e4ebf3!important;border-radius:14px!important;background:#fff!important;padding:18px 18px!important;margin-bottom:14px!important}",
      "#settingsModal .set-head{font-size:15px!important;font-weight:700!important;letter-spacing:-.01em!important;color:#0f2540!important}",
      "#settingsModal .set-desc{color:#6b7d93!important;font-size:13px!important}",
      "#settingsModal .field input,#settingsModal .field select,#settingsModal .field textarea{border-radius:10px!important;border:1px solid #e0e8f1!important;background:#fff!important;font-size:14px!important;max-width:100%}",
      "#settingsModal #settingsTabBar{display:flex!important;flex-wrap:wrap!important;gap:7px!important;margin-bottom:14px!important}",
      "#settingsModal #settingsTabBar button,#settingsModal #settingsTabBar [role=tab]{border-radius:9px!important;border:1px solid #e0e8f1!important;background:#fff!important;font-weight:600!important;font-size:12.5px!important;padding:8px 13px!important}",
      "#settingsModal #settingsTabBar [aria-selected=true]{background:rgba(47,107,237,.12)!important;color:#2f6bed!important;border-color:#cfe0fb!important}"
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
