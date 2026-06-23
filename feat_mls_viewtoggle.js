/* feat_mls_viewtoggle.js  ->  window.__mlsViewToggle  (v1.0.0)
 *
 * Add a clear, always-visible Simple / Complex view switch in the TOP-LEFT of
 * the app header, right next to the MLS logo/branding. It reflects the current
 * view and switches it on click. Additive, reversible, composes with -- never
 * edits -- feat_mls_easy.js (window.__mlsEasy), feat_mls_viewpersist.js
 * (window.__mlsViewPersist) and feat_mls_simpleview_global.js
 * (window.__mlsSimpleViewGlobal).
 *
 * ===================================================================
 *  WHAT THE HOST DOES TODAY  (read live from the deployed app)
 * ===================================================================
 *  - The view lives in ONE flag: window.__mlsEasy.state.mode, either
 *    'easy' (simple guided view) or 'full' (the original complex UI).
 *  - The host's own controls switch the view with exactly two lines:
 *        __mlsEasy.state.mode = 'full';  __mlsEasy.render();   // -> complex
 *        __mlsEasy.state.mode = 'easy';  __mlsEasy.render();   // -> simple
 *    ("Switch to full view" / "Use MLS Easy" do precisely this.)
 *  - feat_mls_viewpersist.js polls __mlsEasy.state.mode and SAVES the choice
 *    ("complex" | "simple") under localStorage "mls.easy.viewPref", so it
 *    persists across reload/login.
 *  - feat_mls_simpleview_global.js polls __mlsEasy.state.mode and restricts /
 *    unrestricts the top nav accordingly.
 *  - The header is <header id="appHeader"> with two children:
 *        .logo   (top-left: brand mark + "MLS / Ambient AI medical scribe /
 *                 <name>")  <-- we anchor here
 *        .tools  (top-right toolbar; the unified "Menu" lives here)
 *
 * ===================================================================
 *  WHAT THIS ASSET DOES
 * ===================================================================
 *  - Mounts ONE segmented control ("Simple | Complex") inside .logo, so it is
 *    prominent in the top-left next to the branding.
 *  - It is a MIRROR of the host's existing switch: clicking a segment drives
 *    the SAME host code path -- set __mlsEasy.state.mode then call the host's
 *    own __mlsEasy.render(). It reimplements nothing. Because it sets the same
 *    flag, __mlsViewPersist saves the choice (persists across reload/login)
 *    and __mlsSimpleViewGlobal applies/relaxes the nav restriction. No second
 *    source of truth is introduced; the host's inline links keep working.
 *  - The control reflects the live mode: a cheap poll reads
 *    __mlsEasy.state.mode and marks the active segment, so it stays in sync
 *    whether the user switches here, via the host's links, or after reload.
 *  - If __mlsEasy isn't ready yet (or its state can't be read), the control
 *    falls back to clicking the host's own visible switch link if one exists,
 *    so it degrades gracefully and never strands the user.
 *
 * SAFETY: own IIFE; idempotent (won't double-install or double-mount); never
 * reimplements, monkey-patches, or removes any host function or element; only
 * adds one container + a <style> tag, and calls the host's own render();
 * every access in try/catch; sends nothing to any extension or network; never
 * clicks Save/Sign/Submit; read-only on clinical data. ASCII-only; NUL-free.
 * Fully reversible: window.__mlsViewToggle.revert() stops the watcher, removes
 * the control + styles, and disconnects observers, leaving the DOM
 * byte-equivalent to baseline. Non-PHI: reads only the view-mode flag.
 */
;(function () {
  "use strict";
  try { if (window.__mlsViewToggle && window.__mlsViewToggle.installed) return; } catch (e) { return; }

  var VERSION = "1.0.0";
  var ASSET = "feat_mls_viewtoggle.js";
  var STYLE_ID = "mls-vt-style";
  var WRAP_ID = "mlsViewToggle";
  var BTN_SIMPLE_ID = "mlsVtSimple";
  var BTN_FULL_ID = "mlsVtFull";

  var _reverted = false;
  var _obs = null, _poll = null, _raf = 0;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }

  // ---- host accessors -------------------------------------------------------
  function easy() { return safe(function () { return window.__mlsEasy; }, null); }
  function curMode() {
    var e = easy();
    return (e && e.state && e.state.mode) ? String(e.state.mode) : null;
  }
  function logoBox() {
    return safe(function () {
      var h = document.getElementById("appHeader");
      if (h) { var l = h.querySelector(".logo"); if (l) return l; }
      return document.querySelector("#appHeader .logo, header .logo");
    }, null);
  }

  // ---- the switch (reuses the host's own code path) -------------------------
  // Primary: set the documented mode flag + call the host's own render().
  // This is exactly what the host's "Switch to full view" / "Use MLS Easy"
  // links do, so viewpersist + simpleview both react and the choice persists.
  // Fallback: if the flag/render isn't reachable, click the host's own link.
  function setMode(target) {            // target: "easy" | "full"
    var done = safe(function () {
      var e = easy();
      if (e && e.state) {
        e.state.mode = target;
        if (typeof e.render === "function") { e.render(); }
        return true;
      }
      return false;
    }, false);
    if (!done) clickHostLink(target);
    // reflect immediately (the poll will also keep it in sync)
    paint(target);
  }

  // Last-resort: click whatever host control matches the desired direction.
  function clickHostLink(target) {
    safe(function () {
      var wantFull = (target === "full");
      var nodes = document.querySelectorAll("a,button,span,div");
      var reFull = /switch to full|full view|complex view/i;
      var reSimple = /mls easy|simple guided|simple view/i;
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (n.id === WRAP_ID || (n.closest && n.closest("#" + WRAP_ID))) continue; // skip our own UI
        var tx = (n.textContent || "").trim();
        if (tx.length > 60) continue;
        if (wantFull ? reFull.test(tx) : reSimple.test(tx)) { n.click(); return; }
      }
    });
  }

  // ---- styles ---------------------------------------------------------------
  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var css = "" +
      "#" + WRAP_ID + "{display:inline-flex;align-items:center;gap:0;margin-left:14px;" +
        "vertical-align:middle;border-radius:999px;padding:3px;background:rgba(255,255,255,.12);" +
        "border:1px solid rgba(255,255,255,.28);line-height:1;}" +
      "#" + WRAP_ID + " button.mlsVtSeg{appearance:none;cursor:pointer;font-family:inherit;" +
        "font-weight:700;font-size:12px;letter-spacing:.2px;color:#dce8fb;background:transparent;" +
        "border:0;border-radius:999px;padding:6px 13px;line-height:1;transition:background .12s,color .12s;}" +
      "#" + WRAP_ID + " button.mlsVtSeg:hover{color:#fff;}" +
      "#" + WRAP_ID + " button.mlsVtSeg.mlsVtOn{background:#fff;color:#12243d;box-shadow:0 1px 3px rgba(0,0,0,.25);}" +
      "#" + WRAP_ID + " button.mlsVtSeg:focus-visible{outline:2px solid #8fc0ff;outline-offset:1px;}";
    var st = document.createElement("style");
    st.id = STYLE_ID; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- build + mount --------------------------------------------------------
  function build() {
    var wrap = document.createElement("span");
    wrap.id = WRAP_ID;
    wrap.setAttribute("data-mls-asset", ASSET);
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "View mode");

    var bs = document.createElement("button");
    bs.id = BTN_SIMPLE_ID; bs.type = "button"; bs.className = "mlsVtSeg";
    bs.textContent = "Simple"; bs.title = "Simple guided view";
    bs.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); setMode("easy"); });

    var bf = document.createElement("button");
    bf.id = BTN_FULL_ID; bf.type = "button"; bf.className = "mlsVtSeg";
    bf.textContent = "Complex"; bf.title = "Full / complex view";
    bf.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); setMode("full"); });

    wrap.appendChild(bs);
    wrap.appendChild(bf);
    return wrap;
  }

  function mount() {
    if (_reverted) return;
    if (gid(WRAP_ID)) return;        // already mounted
    var box = logoBox();
    if (!box) return;                // header not ready yet; watcher will retry
    injectStyle();
    safe(function () { box.appendChild(build()); });
    paint(curMode());
  }

  // ---- reflect current mode -------------------------------------------------
  function paint(mode) {
    safe(function () {
      var m = mode || curMode();
      // default visual when unknown: treat as 'easy' (the host default)
      var isFull = (m === "full");
      var bs = gid(BTN_SIMPLE_ID), bf = gid(BTN_FULL_ID);
      if (bs) { bs.classList.toggle("mlsVtOn", !isFull); bs.setAttribute("aria-pressed", String(!isFull)); }
      if (bf) { bf.classList.toggle("mlsVtOn", isFull); bf.setAttribute("aria-pressed", String(isFull)); }
    });
  }

  // ---- watcher: keep mounted + in sync (cheap reads only) -------------------
  function schedule() {
    if (_raf || _reverted) return;
    _raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      _raf = 0; if (!_reverted) { mount(); paint(curMode()); }
    });
  }
  function start() {
    mount();
    safe(function () {
      _obs = new MutationObserver(function () { if (!_reverted) schedule(); });
      _obs.observe(document.documentElement, { childList: true, subtree: true });
    });
    _poll = setInterval(function () { if (!_reverted) { mount(); paint(curMode()); } }, 600);
  }

  // ---- revert ---------------------------------------------------------------
  function revert() {
    _reverted = true;
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_poll) clearInterval(_poll); });
    safe(function () { var w = gid(WRAP_ID); if (w && w.parentNode) w.parentNode.removeChild(w); });
    safe(function () { var s = gid(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { window.__mlsViewToggle.installed = false; });
    return true;
  }

  // ---- public API (also exercised by the offline jsdom tests) ---------------
  window.__mlsViewToggle = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    mount: function () { mount(); },
    setMode: setMode,
    currentMode: function () { return curMode(); },
    isMounted: function () { return !!gid(WRAP_ID); },
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  } catch (e) { safe(start); }

  // Kick a synchronous mount right now in case the host is already up.
  safe(mount);
})();
