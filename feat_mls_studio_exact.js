/* feat_mls_studio_exact.js  ->  window.__mlsSx  (AI Studio page, design-exact)
 *  STAGING ONLY. After other *_exact modules. Never prod. Runtime-gated.
 *
 *  Brings #studioView toward ScribeFlow AI Studio.dc.html: the Copilot card gets
 *  the design's deep-navy gradient hero + purple send affordance, and all studio
 *  .card panels pick up the design's white rounded tokens. This is a token /
 *  chrome restyle (no structural 2-col fixed-viewport move -- that exact grid
 *  needs live layout tuning and is deferred to live verification so we don't
 *  break the Copilot chat blind). Nothing moved/deleted; real controls keep
 *  their handlers. Reversible: window.__mlsSx.revert(). ASCII-only. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "sx-1.0.0";
  try { if (window.__mlsSx && window.__mlsSx.installed) return; } catch (e) { return; }
  function isStaging() { try { if (/staging/i.test(location.pathname)) return true; if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true; } catch (e) {} return false; }
  if (!isStaging()) { try { window.__mlsSx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }
  var STYLE_ID = "sxStyle"; var _obs = null, _t = null, _sched = null;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }
  function injectCSS() {
    var css = [
      "#studioView{max-width:1320px;margin:0 auto}",
      "#studioView,#studioView *{box-sizing:border-box}",
      "#studioView .card{border-radius:18px!important;border:1px solid #e4ebf3!important;box-shadow:0 1px 2px rgba(15,37,64,.04)!important}",
      "#studioView #copilotHero{background:linear-gradient(135deg,#0d2138,#143560)!important;border-radius:16px!important;padding:18px 20px!important;color:#fff!important}",
      "#studioView #copilotHero h2{color:#fff!important;font-family:'Newsreader',Georgia,serif!important;font-weight:500!important}",
      "#studioView #copilotHero .sub{color:#bcd2ed!important}",
      "#studioView #copilotOrb{background:linear-gradient(135deg,#7c3aed,#a855f7)!important;color:#fff!important;border-radius:10px!important}",
      "#studioView #copilotSendBtn{background:linear-gradient(135deg,#7c3aed,#a855f7)!important;color:#fff!important;border:0!important}",
      "#studioView #copilotInput{border-radius:11px!important;border:1px solid #e0e8f1!important;background:#f8fafc!important}",
      "#studioView input,#studioView select,#studioView textarea{max-width:100%}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }
  function build() { var v = $("studioView"); if (!v) return; injectCSS(); v.setAttribute("data-sx-built", VERSION); }
  function applyAll() { try { if (_obs) _obs.disconnect(); } catch (e) {} try { build(); } catch (e) {} try { if (_obs) _obs.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {} }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 160); }
  function boot() { try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {} applyAll(); var n = 0; _t = setInterval(function () { applyAll(); if (++n > 10) clearInterval(_t); }, 800); }
  function revert() { try { if (_obs) _obs.disconnect(); } catch (e) {} try { if (_t) clearInterval(_t); } catch (e) {} try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {} try { window.__mlsSx.installed = false; } catch (e) {} }
  window.__mlsSx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); } catch (e) { try { boot(); } catch (e2) {} }
})();
