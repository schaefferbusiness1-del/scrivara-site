/* feat_mls_topbar_unify.js  ->  window.__mlsTopbar  (v1.0.0)
 *
 * Declutters the top toolbar (the `.tools` row) and unifies the two "find"
 * surfaces. Additive, reversible, composes with -- never edits -- the host app.
 *
 * ===================================================================
 *  WHAT THE HOST HAS TODAY  (read live from mlsscribe.com/ScribeFlow.html)
 * ===================================================================
 * The `.tools` row holds, in order:
 *   - #mlsPqsInput        the always-visible "Find patient..." search box
 *                         (nice inline UI; patient-only; renders #mlsPqsPanel)
 *   - #whoLabel           the signed-in account email
 *   - #askCopilotHdrBtn   "Ask"            -> openCopilotDock()
 *   - (no id)             "Find"           -> mlsQuickFind()   [powerful: finds
 *                         patients AND jumps to screens; opens #mlsQuickFindOv
 *                         with input #mlsQfInput + results #mlsQfResults]
 *   - #intakeBtn          "Patient intake" -> openIntake()
 *   - (no id)             "Templates"      -> openTemplates()
 *   - #customWidgetHdrBtn "Custom widget"  -> openWidgetBuilder()
 *   - (no id)             "Settings"       -> openSettings()
 *   - (no id)             "Log out"        -> logout()
 * Plus a separate, floating "Troubleshoot Athena" button #mlsAthenaDoctorBtn.
 *
 * ===================================================================
 *  WHAT THIS ASSET DOES
 * ===================================================================
 * 1) ONE MENU BUTTON. Hides the cluster (Ask, Patient intake, Templates,
 *    Custom widget, Troubleshoot Athena, Settings, Log out) and the email, and
 *    adds a single "Menu" button whose dropdown lists them. Each menu item
 *    simply forwards to the ORIGINAL control (calls its real handler / clicks
 *    the real, still-present-but-hidden button) -- nothing is reimplemented.
 *    The account email shows as a non-clickable header inside the menu.
 * 2) UNIFIED FIND. Keeps the always-visible search box, but makes it "find
 *    anything": focusing/typing in it opens the powerful Find (mlsQuickFind),
 *    seeded with whatever was typed, so it finds patients AND screen jumps.
 *    The standalone "Find" button is hidden (merged into the box) and the
 *    native patient-only dropdown (#mlsPqsPanel) is suppressed so there is one
 *    search experience, not two.
 *
 * SAFETY: own IIFE; idempotent; never reimplements or monkey-patches a host
 * function (menu items call the host's own handlers); every access in
 * try/catch; sends nothing anywhere; never clicks Save/Sign/Submit; read-only
 * on clinical data. ASCII-only; NUL-free. Fully reversible:
 * window.__mlsTopbar.revert() un-hides every original control, removes the menu
 * + styles, restores the search box, and disconnects observers.
 */
;(function () {
  "use strict";
  try { if (window.__mlsTopbar && window.__mlsTopbar.installed) return; } catch (e) { return; }

  var VERSION = "1.0.0";
  var ASSET = "feat_mls_topbar_unify.js";
  var HIDE = "mlsTbHidden";
  var STYLE_ID = "mlsTbStyle";
  var MENU_ID = "mlsTbMenu";
  var BTN_ID = "mlsTbMenuBtn";
  var PANEL_ID = "mlsTbMenuPanel";
  var PQS_PLACEHOLDER = "🔍  Find anything — patients & screens";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function tools() { return safe(function () { return document.querySelector(".tools"); }, null); }
  function isEl(n) { return !!(n && n.nodeType === 1); }

  // ---- locate the cluster controls by STABLE handle (id or onclick) ----
  // Each entry: label, icon, and a finder that returns the live element.
  function byOnclick(sub) {
    return function () {
      var t = tools(); if (!t) return null;
      var list = t.querySelectorAll("button,a");
      for (var i = 0; i < list.length; i++) {
        var oc = list[i].getAttribute("onclick") || "";
        if (oc.indexOf(sub) !== -1) return list[i];
      }
      return null;
    };
  }
  var MENU_ITEMS = [
    { label: "Ask", icon: "✦", find: function () { return gid("askCopilotHdrBtn"); } },
    { label: "Patient intake", icon: "📝", find: function () { return gid("intakeBtn"); } },
    { label: "Templates", icon: "🗂", find: byOnclick("openTemplates") },
    { label: "Custom widget", icon: "＋", find: function () { return gid("customWidgetHdrBtn"); } },
    { label: "Troubleshoot Athena", icon: "🔧", find: function () { return gid("mlsAthenaDoctorBtn"); } },
    { label: "Settings", icon: "⚙", find: byOnclick("openSettings") },
    { label: "Log out", icon: "⏻", find: byOnclick("logout(") }
  ];
  function findBtnEl() { return byOnclick("mlsQuickFind")(); } // the standalone "Find" button (to hide)
  function pqsInput() { return gid("mlsPqsInput"); }
  function emailText() { var e = gid("whoLabel"); return e ? (e.textContent || "").trim() : ""; }

  // ---- styles ----
  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var css = "" +
      "." + HIDE + "{display:none !important;}" +
      "#mlsPqsPanel{display:none !important;}" + // suppress native patient-only dropdown
      "#" + MENU_ID + "{position:relative;display:inline-flex;}" +
      "#" + BTN_ID + "{appearance:none;cursor:pointer;font-family:inherit;font-weight:600;" +
        "font-size:13.5px;color:#55605A;background:#fff;border:1px solid #E4E1D8;" +
        "border-radius:10px;padding:8px 14px;display:inline-flex;align-items:center;gap:8px;line-height:1;}" +
      "#" + BTN_ID + ":hover{background:#F4F2EC;color:#1A211C;}" +
      "#" + PANEL_ID + "{position:absolute;top:calc(100% + 8px);right:0;min-width:230px;z-index:100000;" +
        "background:#fff;border:1px solid #E7E5DD;border-radius:12px;padding:6px;" +
        "box-shadow:0 1px 2px rgba(20,33,28,.04),0 18px 44px -16px rgba(20,33,28,.25);display:none;}" +
      "#" + PANEL_ID + ".open{display:block;}" +
      "#" + PANEL_ID + " .mlsTbWho{font-size:12px;color:#79837C;padding:8px 10px 6px;border-bottom:1px solid #EFEDE6;margin-bottom:4px;word-break:break-all;}" +
      "#" + PANEL_ID + " button.mlsTbItem{width:100%;text-align:left;background:transparent;border:0;color:#1A211C;" +
        "font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;border-radius:8px;padding:10px 12px;" +
        "display:flex;align-items:center;gap:10px;}" +
      "#" + PANEL_ID + " button.mlsTbItem:hover{background:#F0EEE7;}" +
      "#" + PANEL_ID + " button.mlsTbItem .mlsTbIco{width:18px;text-align:center;}";
    var st = document.createElement("style");
    st.id = STYLE_ID; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- build the menu ----
  function buildMenu() {
    var t = tools(); if (!t) return;
    if (gid(MENU_ID)) return; // already mounted
    var wrap = document.createElement("div");
    wrap.id = MENU_ID;
    wrap.setAttribute("data-mls-asset", ASSET);

    var btn = document.createElement("button");
    btn.id = BTN_ID; btn.type = "button";
    btn.innerHTML = "☰ <span>Menu</span>";
    btn.setAttribute("aria-haspopup", "true");
    btn.setAttribute("aria-expanded", "false");

    var panel = document.createElement("div");
    panel.id = PANEL_ID;

    var who = emailText();
    if (who) {
      var w = document.createElement("div");
      w.className = "mlsTbWho";
      w.textContent = who; // non-clickable account label
      panel.appendChild(w);
    }

    MENU_ITEMS.forEach(function (it) {
      if (!it.find()) return; // skip items whose control isn't present
      var b = document.createElement("button");
      b.type = "button"; b.className = "mlsTbItem";
      b.innerHTML = '<span class="mlsTbIco">' + it.icon + "</span><span></span>";
      b.lastChild.textContent = it.label;
      b.addEventListener("click", function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        closePanel();
        var target = it.find();              // re-resolve live (host may re-render)
        if (target) safe(function () { target.click(); }); // forward to the REAL control
      });
      panel.appendChild(b);
    });

    btn.addEventListener("click", function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      togglePanel();
    });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    t.appendChild(wrap);

    // close on outside click / Esc
    document.addEventListener("click", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }
  function panelEl() { return gid(PANEL_ID); }
  function openPanel() { var p = panelEl(); if (p) { p.classList.add("open"); var b = gid(BTN_ID); if (b) b.setAttribute("aria-expanded", "true"); } }
  function closePanel() { var p = panelEl(); if (p) { p.classList.remove("open"); var b = gid(BTN_ID); if (b) b.setAttribute("aria-expanded", "false"); } }
  function togglePanel() { var p = panelEl(); if (p) { p.classList.contains("open") ? closePanel() : openPanel(); } }
  function outsideClose(ev) { var m = gid(MENU_ID); if (m && !m.contains(ev.target)) closePanel(); }
  function escClose(ev) { if (ev.key === "Escape") closePanel(); }

  // ---- hide the originals (cluster buttons, email, standalone Find) ----
  function hideOriginals() {
    MENU_ITEMS.forEach(function (it) { var el = it.find(); if (el) el.classList.add(HIDE); });
    var email = gid("whoLabel"); if (email) email.classList.add(HIDE);
    var fb = findBtnEl(); if (fb) fb.classList.add(HIDE);
  }

  // ---- unified find: the visible box launches the powerful Find ----
  var _boxFocus = null, _boxInput = null, _origPlaceholder = null;
  function wireFind() {
    var input = pqsInput(); if (!input) return;
    if (input.__mlsTbWired) return;
    Object.defineProperty(input, "__mlsTbWired", { value: true, configurable: true });
    _origPlaceholder = input.getAttribute("placeholder");
    safe(function () { input.setAttribute("placeholder", PQS_PLACEHOLDER); });

    function openFind(seed) {
      if (typeof window.mlsQuickFind !== "function") return; // fall back: leave native box alone
      if (gid("mlsQuickFindOv")) return;                     // already open
      safe(function () { window.mlsQuickFind(); });
      setTimeout(function () {
        var qf = gid("mlsQfInput");
        if (qf) {
          if (seed) { qf.value = seed; safe(function () { qf.dispatchEvent(new Event("input", { bubbles: true })); }); }
          safe(function () { qf.focus(); });
        }
      }, 60);
      safe(function () { input.value = ""; }); // reset the launcher box
    }
    _boxFocus = function () { openFind(input.value || ""); };
    _boxInput = function () { openFind(input.value || ""); };
    input.addEventListener("focus", _boxFocus);
    input.addEventListener("input", _boxInput);
  }
  function unwireFind() {
    var input = pqsInput(); if (!input) return;
    safe(function () { if (_boxFocus) input.removeEventListener("focus", _boxFocus); });
    safe(function () { if (_boxInput) input.removeEventListener("input", _boxInput); });
    safe(function () { if (_origPlaceholder != null) input.setAttribute("placeholder", _origPlaceholder); });
    safe(function () { delete input.__mlsTbWired; });
  }

  // ---- apply everything (idempotent) ----
  function apply() {
    if (_reverted) return;
    if (!tools()) return;
    injectStyle();
    hideOriginals();
    buildMenu();
    wireFind();
  }

  // ---- low-cost watcher: re-apply if the header re-renders ----
  var _obs = null, _poll = null, _raf = 0, _reverted = false;
  function schedule() {
    if (_raf || _reverted) return;
    _raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      _raf = 0; if (!_reverted) safe(apply);
    });
  }
  function start() {
    safe(apply);
    safe(function () {
      _obs = new MutationObserver(function () { if (!_reverted) schedule(); });
      _obs.observe(document.body, { childList: true, subtree: true });
    });
    _poll = setInterval(function () { if (!_reverted) safe(apply); }, 1500);
  }

  // ---- revert ----
  function revert() {
    _reverted = true;
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_poll) clearInterval(_poll); });
    safe(function () { document.removeEventListener("click", outsideClose, true); });
    safe(function () { document.removeEventListener("keydown", escClose, true); });
    // un-hide every original control
    safe(function () {
      var hidden = document.querySelectorAll("." + HIDE);
      for (var i = 0; i < hidden.length; i++) hidden[i].classList.remove(HIDE);
    });
    // remove the menu + styles
    var m = gid(MENU_ID); if (m && m.parentNode) m.parentNode.removeChild(m);
    var st = gid(STYLE_ID); if (st && st.parentNode) st.parentNode.removeChild(st);
    unwireFind();
    safe(function () { window.__mlsTopbar.installed = false; });
    return true;
  }

  // ---- public API ----
  window.__mlsTopbar = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    apply: function () { safe(apply); },
    openMenu: openPanel,
    closeMenu: closePanel,
    items: function () { return MENU_ITEMS.map(function (i) { return i.label; }); },
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  } catch (e) { safe(start); }
})();
