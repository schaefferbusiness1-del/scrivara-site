/* feat_mls_studio_exact.js  ->  window.__mlsSx  (AI Studio page, design-exact rebuild)
 *  STAGING ONLY (loaded by mls-connect.staging.js; on prod activated via prod-enable
 *  marker). Runtime-gated. Production app logic untouched.
 *
 *  Rebuilds #studioView into the design dashboard (design_renders/ScribeFlow AI Studio.dc.html):
 *  a title strip (AI Studio + PREMIUM) over a 2-col grid -> LEFT a full-height MLS Copilot
 *  chat (light gradient header, scrolling thread, quick-reply chips, input row with mic +
 *  send), RIGHT a stacked "Build a custom tool" card over "My creations". Every interactive
 *  element is the app's REAL element MOVED in BY ID (handlers intact): #copilotCard with
 *  #copilotHero/#copilotThread/#copilotChips/#copilotInputRow (#copilotInput/#copilotMicBtn/
 *  #copilotSendBtn), the build card (#studioPrompt/#studioGenBtn/#studioTemplates) and the
 *  creations card (#studioSaved). The generated-widget panel (#studioResultCard) is placed
 *  full-width below the grid when shown. Nothing cloned/deleted.
 *
 *  Reversible: window.__mlsSx.revert(). ASCII-only (emoji as HTML entities). Idempotent.
 *  View-isolated. Render-once (guards prevent re-layout thrash on observer re-runs).
 */
;(function () {
  "use strict";
  var VERSION = "sx-2.4.0-prod";
  try { if (window.__mlsSx && window.__mlsSx.installed) return; } catch (e) { return; }
  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  /* b34: PROD-ENABLED via marker set by __mlsFixPackB34 (window.__MLS_SX_PROD). */
  if (!isStaging() && window.__MLS_SX_PROD !== 1) { try { window.__mlsSx = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "sxStyle", GRID_CLASS = "sx-grid";
  var _obs = null, _sched = null, _bootTimers = [];
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { if (el) el.style.setProperty(p, v, "important"); } catch (e) {} }

  function injectCSS() {
    var css = [
      "#studioView." + GRID_CLASS + "{max-width:1320px;margin:0 auto;display:grid!important;grid-template-columns:1.35fr 1fr;grid-template-rows:auto 1fr;gap:16px;align-items:stretch}",
      "#studioView." + GRID_CLASS + ",#studioView." + GRID_CLASS + " *{box-sizing:border-box}",
      "#studioView." + GRID_CLASS + " .sx-title{grid-column:1 / -1;display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin:0}",
      "#studioView." + GRID_CLASS + " #copilotCard{grid-column:1;grid-row:2;display:flex!important;flex-direction:column;min-width:0;min-height:0;height:auto;align-self:start;max-height:calc(100vh - 188px);overflow:hidden;margin:0!important;padding:0!important;border:1px solid #E7E5DD!important;border-radius:18px!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important;background:#fff!important}",
      "#studioView." + GRID_CLASS + " .sx-right{grid-column:2;grid-row:2;display:flex;flex-direction:column;gap:16px;min-width:0;min-height:0;height:calc(100vh - 188px);max-height:820px}",
      /* copilot internals */
      "#studioView #copilotHero{flex-shrink:0;display:flex!important;align-items:center;gap:11px;margin:0!important;padding:15px 20px!important;background:linear-gradient(120deg,#f6effd,#EAF1EE)!important;border:0!important;border-bottom:1px solid #F4F2EC!important;border-radius:0!important;color:#1A211C!important}",
      "#studioView #copilotHero h2{color:#1A211C!important;font-size:15px!important;font-weight:700!important;margin:0!important;border:0!important;padding:0!important}",
      "#studioView #copilotHero .sub{color:var(--muted)!important;font-size:11.5px!important;margin:2px 0 0!important}",
      "#studioView #copilotOrb{width:32px;height:32px;border-radius:9px!important;background:linear-gradient(135deg,#7A5CC0,#2E6A4B)!important;color:#fff!important;display:flex;align-items:center;justify-content:center;font-size:15px;flex-shrink:0}",
      "#studioView #copilotThread{flex:1 1 auto!important;min-height:0!important;overflow-y:auto!important;padding:16px 20px!important;margin:0!important}",
      "#studioView #copilotChips{flex-shrink:0;padding:10px 20px 0!important;margin:0!important;display:flex;gap:7px;flex-wrap:wrap}",
      "#studioView #copilotInputRow{flex-shrink:0;display:flex!important;gap:9px;align-items:center;padding:12px 20px 16px!important;border-top:1px solid #F4F2EC;margin:0!important}",
      "#studioView #copilotInput{flex:1;min-height:46px!important;height:46px;border-radius:12px!important;border:1px solid #e0e8f1!important;background:#FCFBF8!important;padding:12px 15px!important;font-size:13.5px!important;resize:none;color:#1A211C!important}",
      "#studioView #copilotMicBtn{width:46px;height:46px;border-radius:12px!important;border:1px solid #e0e8f1!important;background:var(--card)!important;color:var(--muted)!important;font-size:15px;flex-shrink:0;padding:0!important}",
      "#studioView #copilotSendBtn{width:46px;height:46px;border-radius:12px!important;border:0!important;background:linear-gradient(135deg,#2E6A4B,#204034)!important;color:#fff!important;font-size:17px;flex-shrink:0;box-shadow:0 10px 22px -10px rgba(32,64,52,.6);padding:0!important}",
      "#studioView .copilot-note{flex-shrink:0;padding:0 20px 12px!important;margin:0!important}",
      /* right cards */
      "#studioView .sx-right > .card{margin:0!important;border:1px solid #E7E5DD!important;border-radius:18px!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important;background:#fff!important;min-height:0}",
      "#studioView .sx-right > .sx-buildcard{flex:1 1 auto;display:flex;flex-direction:column;overflow:hidden;padding:18px 20px!important}",
      "#studioView .sx-right > .sx-buildcard #studioTemplates{flex:1 1 auto;min-height:0;overflow-y:auto}",
      "#studioView .sx-right > .sx-creations{flex-shrink:0;padding:16px 20px!important}",
      "#studioView #studioResultCard{grid-column:1 / -1;grid-row:3;margin:0!important;border:1px solid #E7E5DD!important;border-radius:18px!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important}",
      "#studioView input,#studioView select,#studioView textarea{max-width:100%}",
      /* responsive: single column below 980, natural heights with bounded thread scroll */
      "@media (max-width:980px){#studioView." + GRID_CLASS + "{grid-template-columns:1fr;grid-template-rows:auto auto auto}#studioView." + GRID_CLASS + " #copilotCard{grid-column:1;grid-row:2;height:auto;max-height:none}#studioView #copilotThread{max-height:46vh}#studioView." + GRID_CLASS + " .sx-right{grid-column:1;grid-row:3;height:auto;max-height:none}#studioView #studioResultCard{grid-row:4}}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}",
      /* ---- sx-2.1.0: Study Groups (#mls-sg-root from feat_mls_studygroups.js) used to land
         in grid column 1 only (749px, pushed the title down). Give it its own full-width row
         of three matched cards above the Copilot/Build row, and restyle its controls to the
         app design. Pure CSS, additive. ---- */
      "#studioView." + GRID_CLASS + "{grid-template-rows:auto auto 1fr!important}",
      "#studioView." + GRID_CLASS + " .sx-title{grid-row:1}",
      "#studioView." + GRID_CLASS + " #mls-sg-root{grid-column:1 / -1;grid-row:2;display:grid;grid-template-columns:1.2fr 1.4fr .8fr;gap:16px;align-items:stretch;min-width:0}",
      "#studioView." + GRID_CLASS + " #copilotCard{grid-row:3!important;height:auto!important;min-height:0}",
      "#studioView." + GRID_CLASS + " .sx-right{grid-row:3!important;height:auto!important;min-height:520px}",
      "#studioView #studioResultCard{grid-row:4!important}",
      "#mls-sg-root .mls-sg-card{margin:0!important;background:#fff!important;border:1px solid #E7E5DD!important;border-radius:18px!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important;padding:18px 20px!important;min-width:0}",
      "#mls-sg-root .mls-sg-card h3{margin:0 0 4px!important;font-size:15px!important;font-weight:700!important;color:#1A211C!important}",
      "#mls-sg-root .mls-sg-pill{background:#f3eefb;color:#7A5CC0;border:1px solid #e4d9f7;border-radius:20px;font-size:10px;font-weight:700;padding:2px 8px;vertical-align:middle}",
      "#mls-sg-root .mls-sg-muted{color:#79837C!important;font-size:12px!important}",
      "#mls-sg-root input,#mls-sg-root select,#mls-sg-root textarea{border:1px solid #e0e8f1!important;background:#FCFBF8!important;border-radius:10px!important;padding:9px 12px!important;font-size:13px!important;color:#1A211C!important}",
      "#mls-sg-root textarea{min-height:64px!important}",
      "#mls-sg-root .mls-sg-btn{border:0;border-radius:10px;background:linear-gradient(135deg,#2E6A4B,#204034);color:#fff;font-weight:600;font-size:12.5px;padding:9px 14px;cursor:pointer}",
      "#mls-sg-root .mls-sg-btn.gray{background:#fff;color:#79837C;border:1px solid #e0e8f1}",
      "#mls-sg-root .mls-sg-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}",
      "@media (max-width:1100px){#studioView." + GRID_CLASS + " #mls-sg-root{grid-template-columns:1fr}}",
      "@media (max-width:980px){#studioView." + GRID_CLASS + " #copilotCard{grid-row:3!important}#studioView." + GRID_CLASS + " .sx-right{grid-row:4!important}#studioView #studioResultCard{grid-row:5!important}}",
      /* ---- sx-2.4.0 (owner 2026-07-16): tidy tiles - no more auto-placed strays.
         (a) The Copilot/right-column row stretches to ONE shared height, so the
             two tiles frame each other instead of leaving a ragged hole.
         (b) Any study-builder host that lands as a direct grid child gets the
             full-width study row (2) - same slot as #mls-sg-root/#mlsB39SgWrap.
         (c) The premium-lock card and the Pay Reports tile form one matched
             row (4) under the main tiles; the pay tile fills its cell.
         (d) The generated-widget panel moves below them (row 5).
         Layout only - no component is altered, moved, or re-parented. ---- */
      "#studioView." + GRID_CLASS + " .stp-head{grid-row:2!important}",
      "#studioView." + GRID_CLASS + ">#mlsSgPro,#studioView." + GRID_CLASS + ">#mlsStudyRequest,#studioView." + GRID_CLASS + ">#mls-sg-root,#studioView." + GRID_CLASS + ">#mlsB39SgWrap{grid-column:1/-1!important;grid-row:3!important;min-width:0}",
      "#studioView." + GRID_CLASS + " #copilotCard{grid-row:4!important;align-self:stretch!important;height:auto!important;max-height:none!important}",
      "#studioView." + GRID_CLASS + " .sx-right{grid-row:4!important;align-self:stretch!important;height:auto!important;max-height:none!important;min-height:520px}",
      "#studioView." + GRID_CLASS + ">#mlsStudioPremiumLock{grid-column:1!important;grid-row:5!important;align-self:stretch;margin:0!important;min-width:0}",
      "#studioView." + GRID_CLASS + ">.uc1-pay-wrap{grid-column:2!important;grid-row:5!important;align-self:stretch;margin:0!important;display:flex;min-width:0}",
      "#studioView." + GRID_CLASS + ">.uc1-pay-wrap .uc1-pay{width:100%;height:100%;box-sizing:border-box}",
      "#studioView." + GRID_CLASS + " #studioResultCard{grid-row:6!important}",
      "@media (max-width:980px){#studioView." + GRID_CLASS + " #copilotCard{grid-row:4!important}#studioView." + GRID_CLASS + " .sx-right{grid-column:1!important;grid-row:5!important}#studioView." + GRID_CLASS + ">#mlsStudioPremiumLock{grid-column:1!important;grid-row:6!important}#studioView." + GRID_CLASS + ">.uc1-pay-wrap{grid-column:1!important;grid-row:7!important}#studioView." + GRID_CLASS + " #studioResultCard{grid-row:8!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  function buildTitle(v) {
    if (v.querySelector(":scope > .sx-title")) return;
    var t = mk("div"); t.className = "sx-title";
    t.innerHTML =
      '<span style="width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#7A5CC0,#2E6A4B);display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff">&#10022;</span>' +
      '<h1 style="font-family:\'Newsreader\',Georgia,serif;font-weight:500;font-size:23px;letter-spacing:-.01em;margin:0">AI Studio</h1>' +
      '<span style="color:var(--muted);font-size:13px">Ask your data, or build a tool &mdash; everything on one screen.</span>' +
      '<span style="flex:1"></span>' +
      '<span style="font-size:9.5px;font-weight:700;letter-spacing:.04em;color:#fff;background:linear-gradient(135deg,#7A5CC0,#9B82D4);padding:4px 10px;border-radius:20px">PREMIUM</span>';
    v.insertBefore(t, v.firstChild);
  }

  function build() {
    var v = $("studioView"); if (!v) return;
    injectCSS();
    if (v.style.display === "none") { v.classList.remove(GRID_CLASS); return; }
    v.classList.add(GRID_CLASS);
    buildTitle(v);

    var copilot = $("copilotCard");
    var prompt = $("studioPrompt"), saved = $("studioSaved");
    var buildCard = prompt && prompt.closest ? prompt.closest(".card") : null;
    var creations = saved && saved.closest ? saved.closest(".card") : null;
    var result = $("studioResultCard");

    /* right column wrapper holds build + creations, stacked */
    var right = v.querySelector(":scope > .sx-right");
    if (!right) { right = mk("div"); right.className = "sx-right"; }
    if (buildCard) { buildCard.classList.add("sx-buildcard"); if (buildCard.parentElement !== right) right.appendChild(buildCard); }
    if (creations) { creations.classList.add("sx-creations"); if (creations.parentElement !== right) right.appendChild(creations); }

    /* idempotent ordering: title, copilot, right, result. Re-appending #copilotCard
       on every observer tick was resetting #copilotThread.scrollTop to 0 -- the
       glitchy MLS Copilot scroll. Only reorder when the sequence actually differs,
       and preserve the thread scroll position if a reorder is needed. */
    var titleEl = v.querySelector(":scope > .sx-title");
    var seq = [];
    if (titleEl) seq.push(titleEl);
    if (copilot) seq.push(copilot);
    if (right) seq.push(right);
    if (result) seq.push(result);
    var cur = Array.prototype.filter.call(v.children, function (c) { return seq.indexOf(c) >= 0; });
    var same = cur.length === seq.length && cur.every(function (c, i) { return c === seq[i]; });
    if (!same) {
      var _th = $("copilotThread"); var _tt = _th ? _th.scrollTop : 0;
      seq.forEach(function (el) { v.appendChild(el); });
      if (_th && _th.scrollTop !== _tt) _th.scrollTop = _tt;
    }

    /* mark the note paragraph under copilot so CSS can pad it */
    if (copilot) {
      var notes = copilot.querySelectorAll(":scope > .note");
      Array.prototype.forEach.call(notes, function (n) { n.classList.add("copilot-note"); });
    }
    if (v.getAttribute("data-sx-built") !== VERSION) v.setAttribute("data-sx-built", VERSION);
  }

  function applyAll() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { build(); } catch (e) {}
    try {
      var v = $("studioView");
      if (_obs && v) _obs.observe(v, { childList: true, subtree: true });
    } catch (e) {}
  }
  function schedule() { if (_sched) return; _sched = setTimeout(function () { _sched = null; applyAll(); }, 160); }
  function onViewChanged(ev) {
    var d = ev && ev.detail;
    if (!d || d.view === "studio" || d.previousView === "studio") schedule();
  }
  function clearBootTimers() {
    try { _bootTimers.forEach(function (timer) { clearTimeout(timer); }); } catch (e) {}
    _bootTimers = [];
  }
  function boot() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_sched) clearTimeout(_sched); } catch (e) {} _sched = null;
    clearBootTimers();
    try { window.removeEventListener("mls:view-changed", onViewChanged); } catch (e) {}
    try { _obs = new MutationObserver(function () { schedule(); }); } catch (e) {}
    try { window.addEventListener("mls:view-changed", onViewChanged); } catch (e) {}
    applyAll();
    /* Bounded late-mount retries cover the initial asset wave. Normal updates are
       owned by the Studio root observer and the canonical view event. */
    [400, 1000, 2200, 4200, 7200].forEach(function (delay) {
      _bootTimers.push(setTimeout(applyAll, delay));
    });
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_sched) clearTimeout(_sched); } catch (e) {} _sched = null;
    clearBootTimers();
    try { window.removeEventListener("mls:view-changed", onViewChanged); } catch (e) {}
    var v = $("studioView");
    if (v) {
      /* move build + creations back to studioView (un-nest from sx-right), keep order sane */
      var right = v.querySelector(":scope > .sx-right");
      if (right) { while (right.firstChild) { v.appendChild(right.firstChild); } right.remove(); }
      var t = v.querySelector(":scope > .sx-title"); if (t) t.remove();
      v.classList.remove(GRID_CLASS);
    }
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { window.__mlsSx.installed = false; } catch (e) {}
  }
  window.__mlsSx = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
