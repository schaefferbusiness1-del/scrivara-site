/* feat_mls_history_exact.js  ->  window.__mlsHy  (History page, design-exact rebuild)
 *
 *  STAGING ONLY. Loaded by mls-connect.staging.js after the other *_exact modules.
 *  Never loaded by prod (mls-connect.js). Runtime-gated to the staging page.
 *
 *  Brings #historyView to design_renders/ScribeFlow History.dc.html (single
 *  1080px column): the existing #historyCard becomes the design's white rounded
 *  card -- icon-square header, design action pills, a pill search + filter, and
 *  design-styled visit rows (.hist-item). Pure restyle: no elements are moved
 *  or deleted; every control stays the app's real wired element. The visit rows
 *  are the app's real renderHistory() output, restyled via CSS only.
 *
 *  Reversible: window.__mlsHy.revert().  ASCII-only. Idempotent. View-isolated.
 */
;(function () {
  "use strict";
  var VERSION = "hy-1.1.1";
  try { if (window.__mlsHy && window.__mlsHy.installed) return; } catch (e) { return; }
  function isStaging() {
    try {
      if (/staging/i.test(location.pathname)) return true;
      if (document.querySelector('script[src*="mls-connect.staging.js"]')) return true;
    } catch (e) {}
    return false;
  }
  if (!isStaging()) { try { window.__mlsHy = { installed: false, skipped: "not-staging" }; } catch (e) {} return; }

  var STYLE_ID = "hyStyle";
  var _obs = null, _mountObs = null, _historyRoot = null, _historyHost = null;
  var _t = null, _sched = 0, _schedIsRaf = false;
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function mk(t, c, h) { var e = document.createElement(t); if (c) e.style.cssText = c; if (h != null) e.innerHTML = h; return e; }
  function imp(el, p, v) { try { el.style.setProperty(p, v, "important"); } catch (e) {} }

  function injectCSS() {
    var css = [
      "#historyView #historyCard{max-width:1080px;margin:0 auto!important;border-radius:18px!important;border:1px solid #E7E5DD!important;box-shadow:0 1px 2px rgba(20,33,28,.04)!important;padding:24px 26px!important}",
      "#historyView #historyCard,#historyView #historyCard *{box-sizing:border-box}",
      "#historyView #historyCard > h2{display:flex!important;align-items:center!important;gap:12px!important;flex-wrap:wrap!important;font-size:20px!important;font-weight:700!important;letter-spacing:-.01em!important}",
      "#historyView #histSearch{height:46px!important;border-radius:11px!important;border:1px solid #e0e8f1!important;background:#FCFBF8!important;padding:0 14px!important;font-size:13.5px!important}",
      "#historyView #histFilter{height:46px!important;border-radius:11px!important;border:1px solid #e0e8f1!important;background:#fff!important;padding:0 14px!important;font-size:13px!important;font-weight:600!important;color:#1A211C!important}",
      "#historyView #histFilter{display:none!important}",
      "#historyView #hyChips{display:flex!important;flex-wrap:wrap!important;gap:8px!important;margin:0 0 16px!important}",
      "#historyView .hy-chip{height:34px!important;padding:0 15px!important;border-radius:20px!important;font-weight:600!important;font-size:12.5px!important;font-family:inherit!important;cursor:pointer!important;border:1px solid #e0e8f1!important;background:#fff!important;color:#3d5168!important;transition:background .12s,color .12s,border-color .12s!important}",
      "#historyView .hy-chip[data-on=\"1\"]{background:#2E6A4B!important;color:#fff!important;border-color:#2E6A4B!important}",
      "#historyView .hy-chip:hover{border-color:#EAF1EE!important}",
      "#historyView .hist-list{display:flex!important;flex-direction:column!important;gap:10px!important}",
      "#historyView .hist-item{border:1px solid #E7E5DD!important;border-radius:14px!important;background:#fff!important;padding:15px 17px!important;box-shadow:none!important}",
      "#historyView .hist-item:hover{border-color:#EAF1EE!important;background:#fbfdff!important}",
      "@media (max-width:1100px){#mlsRdTop,#mlsRdNav,#mlsCtxBar{max-width:100vw!important;overflow-x:auto!important}}"
    ].join("\n");
    var s = $(STYLE_ID);
    if (!s) { s = mk("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
    if (s.textContent !== css) s.textContent = css;
  }

  /* icon square in the header (design), and design pills for the action buttons */
  function styleHeader() {
    var card = $("historyCard"); if (!card) return;
    var h2 = card.querySelector(":scope > h2"); if (!h2) return;
    if (!h2.getAttribute("data-hy")) {
      h2.setAttribute("data-hy", "1");
      var ic = h2.querySelector(".ic");
      var sq = mk("span", "width:38px;height:38px;border-radius:10px;background:#EAF1EE;display:flex;align-items:center;justify-content:center;font-size:18px;flex:0 0 auto", "&#128451;");
      if (ic) h2.replaceChild(sq, ic); else h2.insertBefore(sq, h2.firstChild);
    }
    var btns = h2.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i], t = (b.textContent || "");
      imp(b, "height", "40px"); imp(b, "border-radius", "11px"); imp(b, "font-size", "13px");
      if (/New visit/i.test(t)) {
        imp(b, "background", "linear-gradient(135deg,#2E6A4B,#204034)"); imp(b, "color", "#fff");
        imp(b, "border", "0"); imp(b, "font-weight", "700");
        imp(b, "box-shadow", "0 10px 22px -10px rgba(46,106,75,.6)");
      } else if (/Pull chart/i.test(t)) {
        imp(b, "background", "#EAF1EE"); imp(b, "color", "#2E6A4B"); imp(b, "border", "1px solid #EAF1EE"); imp(b, "font-weight", "700");
      } else {
        imp(b, "background", "#fff"); imp(b, "color", "#3d5168"); imp(b, "border", "1px solid #e0e8f1"); imp(b, "font-weight", "600");
      }
    }
  }

  /* Design filter CHIPS wired to the real #histFilter select (renderHistory reads its value). */
  function syncChips() {
    var wrap = $("hyChips"), f = $("histFilter"); if (!wrap || !f) return;
    var kids = wrap.children;
    for (var i = 0; i < kids.length; i++) {
      var next = kids[i].getAttribute("data-val") === f.value ? "1" : "0";
      if (kids[i].getAttribute("data-on") !== next) kids[i].setAttribute("data-on", next);
    }
  }
  function buildChips() {
    var f = $("histFilter"); if (!f) return;
    var row = $("histSearchRow"); if (!row) return;
    var sig = "";
    for (var k = 0; k < f.options.length; k++) { sig += f.options[k].value + "|" + f.options[k].textContent + "~"; }
    var wrap = $("hyChips");
    if (wrap && wrap.getAttribute("data-sig") === sig) { syncChips(); return; }
    if (wrap && wrap.parentNode) wrap.parentNode.removeChild(wrap);
    wrap = mk("div"); wrap.id = "hyChips"; wrap.setAttribute("data-sig", sig);
    function strip(t) { return (t || "").replace(/^[^\x00-\x7F\s]+\s*/, "").trim(); }
    for (var j = 0; j < f.options.length; j++) {
      (function (o) {
        var b = mk("button"); b.type = "button"; b.className = "hy-chip";
        b.setAttribute("data-val", o.value);
        b.textContent = strip(o.textContent) || o.textContent || o.value;
        b.addEventListener("click", function () {
          try { f.value = o.value; } catch (e) {}
          try { if (typeof window.renderHistory === "function") window.renderHistory(); else f.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
          syncChips();
        });
        wrap.appendChild(b);
      })(f.options[j]);
    }
    if (row.parentNode) row.parentNode.insertBefore(wrap, row.nextSibling);
    syncChips();
  }

  function build() {
    var v = $("historyView"); if (!v) return;
    injectCSS(); styleHeader(); buildChips();
    if (v.getAttribute("data-hy-built") !== VERSION) v.setAttribute("data-hy-built", VERSION);
  }
  function historyHost(v) {
    try { return v && v.closest ? (v.closest("#appScreen,main,[role='main']") || v.parentElement) : (v && v.parentElement); }
    catch (e) { return v && v.parentElement; }
  }
  function nodeHasHistoryView(node) {
    if (!node || node.nodeType !== 1) return false;
    if (node === _historyRoot || node.id === "historyView") return true;
    try { return !!node.querySelector("#historyView"); } catch (e) { return false; }
  }
  function remountMutation(records) {
    var live = $("historyView");
    if (live !== _historyRoot) { schedule(); return; }
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (_historyRoot && (record.target === _historyRoot || _historyRoot.contains(record.target))) continue;
      var lists = [record.addedNodes, record.removedNodes];
      for (var j = 0; j < lists.length; j++) {
        for (var k = 0; k < lists[j].length; k++) {
          if (nodeHasHistoryView(lists[j][k])) { schedule(); return; }
        }
      }
    }
  }
  function bindObservers() {
    var v = $("historyView");
    if (!v) { _historyRoot = null; return; }
    if (v !== _historyRoot) {
      try { if (_obs) _obs.disconnect(); } catch (e) {}
      try { if (!_obs) _obs = new MutationObserver(schedule); _obs.observe(v, { childList: true, subtree: true }); } catch (e) {}
      _historyRoot = v;
    }
    var host = historyHost(v);
    if (host && host !== _historyHost) {
      try { if (_mountObs) _mountObs.disconnect(); } catch (e) {}
      try { if (!_mountObs) _mountObs = new MutationObserver(remountMutation); _mountObs.observe(host, { childList: true, subtree: true }); } catch (e) {}
      _historyHost = host;
    }
  }
  function applyAll() {
    try { build(); } catch (e) {}
    try { bindObservers(); } catch (e) {}
  }
  function schedule() {
    if (_sched) return;
    var run = function () { _sched = 0; applyAll(); };
    if (typeof window.requestAnimationFrame === "function") {
      _schedIsRaf = true;
      _sched = window.requestAnimationFrame(run);
    } else {
      _schedIsRaf = false;
      _sched = setTimeout(run, 16);
    }
  }
  function boot() {
    applyAll();
    try { if (_t) clearInterval(_t); } catch (e) {}
    var n = 0; _t = setInterval(function () {
      applyAll();
      if (++n > 12) { clearInterval(_t); _t = null; }
    }, 700);
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_mountObs) _mountObs.disconnect(); } catch (e) {}
    try { if (_t) clearInterval(_t); } catch (e) {}
    try {
      if (_sched) {
        if (_schedIsRaf && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(_sched);
        else clearTimeout(_sched);
      }
    } catch (e) {}
    try { var s = $(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { var w = $("hyChips"); if (w && w.parentNode) w.parentNode.removeChild(w); } catch (e) {}
    try { window.__mlsHy.installed = false; } catch (e) {}
  }
  window.__mlsHy = { installed: true, version: VERSION, reapply: boot, revert: revert, build: build };
  try { if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot(); }
  catch (e) { try { boot(); } catch (e2) {} }
})();
