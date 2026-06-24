/* feat_mls_login_exact.js  ->  window.__mlsLgx  (Login / auth screen, design-exact)
 *  STAGING ONLY. After other *_exact modules. Never prod. Runtime-gated.
 *  Brings #authScreen to the design system (the login dc render is a JS-rendered
 *  bundler shell, so we apply the same dark-navy backdrop + white rounded card +
 *  pill inputs + gradient primary button used across the rebuilt pages). Pure
 *  CSS restyle scoped to #authScreen -- NO auth logic touched, NO credential
 *  ever read or filled; #authEmail/#authPass/#authBtn/doAuth() keep working
 *  exactly as-is. Reversible: window.__mlsLgx.revert(). ASCII-only. Idempotent.
 */
;(function () {
  "use strict";
  var VERSION = "lgx-1.0.0";
  try { if (window.__mlsLgx && window.__mlsLgx.installed) return; } catch (e) { return; }
  function isStaging() { try { if (/staging/i.test(location.pathname)) return true; if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true; } catch (e) {} return false; }
  if (!isStaging()) { try { window.__mlsLgx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }
  var STYLE_ID = "lgxStyle"; var _t = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function injectCSS() {
    var css = [
      "#authScreen.auth-wrap{background:linear-gradient(135deg,#0d2138,#143560)!important;min-height:100vh!important;display:flex!important;align-items:center!important;justify-content:center!important;padding:36px 20px!important}",
      "#authScreen .auth-card{width:420px!important;max-width:100%!important;background:#fff!important;border-radius:20px!important;box-shadow:0 40px 90px -30px rgba(0,0,0,.6)!important;padding:30px 30px 26px!important;border:0!important}",
      "#authScreen .auth-card,#authScreen .auth-card *{box-sizing:border-box}",
      "#authScreen .auth-logo{font-family:'Newsreader',Georgia,serif!important;font-weight:600!important;display:flex!important;align-items:center!important;gap:10px!important;font-size:24px!important}",
      "#authScreen .auth-sub{color:#6b7d93!important;font-size:13.5px!important}",
      "#authScreen .auth-tabs{display:flex!important;gap:6px!important;background:#f1f4f8!important;border-radius:11px!important;padding:4px!important;margin:14px 0!important}",
      "#authScreen .auth-tab{flex:1!important;text-align:center!important;padding:9px 0!important;border-radius:8px!important;font-weight:600!important;font-size:13.5px!important;color:#6b7d93!important;cursor:pointer}",
      "#authScreen .auth-tab.on{background:#fff!important;color:#0f2540!important;box-shadow:0 1px 2px rgba(15,37,64,.08)!important}",
      "#authScreen .field input{width:100%!important;height:46px!important;border-radius:11px!important;border:1px solid #e0e8f1!important;background:#f8fafc!important;padding:0 14px!important;font-size:14px!important}",
      "#authScreen #authBtn{height:48px!important;border-radius:12px!important;border:0!important;background:linear-gradient(135deg,#2f6bed,#2257cf)!important;color:#fff!important;font-weight:700!important;font-size:15px!important;box-shadow:0 12px 26px -10px rgba(47,107,237,.6)!important;margin-top:6px}",
      "#authScreen .local-note{background:#f3f6fb!important;border:1px solid #e8edf4!important;border-radius:12px!important;padding:12px 14px!important;color:#5a6b80!important;font-size:12px!important;line-height:1.5!important;margin-top:14px!important}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  function build() { injectCSS(); var a = $("authScreen"); if (a) a.setAttribute("data-lgx-built", VERSION); }
  function boot() { build(); var n = 0; _t = setInterval(function () { build(); if (++n > 6) clearInterval(_t); }, 1000); }
  function revert() { try { if (_t) clearInterval(_t); } catch (e) {} try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {} try { window.__mlsLgx.installed = false; } catch (e) {} }
  window.__mlsLgx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); } catch (e) { try { boot(); } catch (e2) {} }
})();
