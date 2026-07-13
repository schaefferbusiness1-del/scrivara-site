/* feat_mls_help_exact.js  ->  window.__mlsHpx  (Help modal, design-exact)
 *  STAGING ONLY. After other *_exact modules. Never prod. Runtime-gated.
 *  Brings #helpModal to ScribeFlow Help.dc.html: the modal becomes the design's
 *  rounded 560px white card -- soft note box, pill textarea with focus ring,
 *  big green Ask button, design accent links. Pure CSS restyle scoped to
 *  #helpModal; nothing moved/deleted; #helpQ / #helpAskBtn / askMlsHelp() etc.
 *  keep working. Reversible: window.__mlsHpx.revert(). ASCII-only. Idempotent.
 */
;(function () {
  "use strict";
  var VERSION = "hpx-1.0.0";
  try { if (window.__mlsHpx && window.__mlsHpx.installed) return; } catch (e) { return; }
  function isStaging() { try { if (/staging/i.test(location.pathname)) return true; if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true; } catch (e) {} return false; }
  if (!isStaging()) { try { window.__mlsHpx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }
  var STYLE_ID = "hpxStyle"; var _t = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function injectCSS() {
    var css = [
      "#helpModal .modal{max-width:560px!important;border-radius:20px!important;box-shadow:0 40px 90px -30px rgba(0,0,0,.6)!important;padding:20px 24px 24px!important}",
      "#helpModal .modal,#helpModal .modal *{box-sizing:border-box}",
      "#helpModal .modal > h3{font-size:20px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#helpModal .note{background:#f3f6fb!important;border:1px solid #e8edf4!important;border-radius:12px!important;padding:13px 15px!important;color:#5a6b80!important;font-size:13px!important;line-height:1.5!important}",
      "#helpModal #helpQ{min-height:92px!important;border-radius:12px!important;border:1px solid #d8e6f8!important;background:#fff!important;padding:13px 15px!important;font-size:14px!important;line-height:1.55!important;box-shadow:0 0 0 3px rgba(32,64,52,.08)!important;max-width:100%}",
      "#helpModal #helpAskBtn{height:48px!important;padding:0 24px!important;border-radius:12px!important;border:0!important;background:linear-gradient(135deg,#2E6A4B,#204034)!important;color:#fff!important;font-weight:700!important;font-size:15px!important;box-shadow:0 10px 22px -10px rgba(46,106,75,.6)!important}",
      "#helpModal a{color:#2E6A4B!important;font-weight:600!important}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  function build() { injectCSS(); var m = $("helpModal"); if (m) m.setAttribute("data-hpx-built", VERSION); }
  function boot() { build(); var n = 0; _t = setInterval(function () { build(); if (++n > 6) clearInterval(_t); }, 1000); }
  function revert() { try { if (_t) clearInterval(_t); } catch (e) {} try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {} try { window.__mlsHpx.installed = false; } catch (e) {} }
  window.__mlsHpx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); } catch (e) { try { boot(); } catch (e2) {} }
})();
