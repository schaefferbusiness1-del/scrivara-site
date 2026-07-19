/* feat_mls_topbar_unify.js  ->  window.__mlsTopbar  (v1.0.10)
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
 *    anything": clicking/focusing/typing opens the powerful Find (mlsQuickFind),
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
  var VERSION = "1.0.10";
  try {
    if (window.__mlsTopbar && window.__mlsTopbar.installed) {
      if (window.__mlsTopbar.version === VERSION) return;
      if (typeof window.__mlsTopbar.revert === "function") window.__mlsTopbar.revert();
    }
  } catch (e) {}
  var ASSET = "feat_mls_topbar_unify.js";
  var HIDE = "mlsTbHidden";
  var STYLE_ID = "mlsTbStyle";
  var MENU_ID = "mlsTbMenu";
  var BTN_ID = "mlsTbMenuBtn";
  var PANEL_ID = "mlsTbMenuPanel";
  /* Patients + screens are the guaranteed shared index in production and
     staging. Production may enrich that index with features/templates, but
     the persistent field never promises a category a deployment cannot find. */
  var PQS_PLACEHOLDER = "Find patients and screens…";
  var PQS_ARIA_LABEL = "Find patients and screens";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function tools() { return safe(function () { return document.querySelector(".tools"); }, null); }
  function menuHost() { return gid("mlsRdMenuSlot") || tools(); }
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
  /* Staff prep is intentionally owned by Menu. The active Easy workspace is
     the sole receiver of this private menu-intent event. No global Staff
     opener is published and no schedule pull is started here. */
  function activateStaffPrepFromMenu() {
    var requestId = "staff-menu-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
    var acknowledged = false;
    function onOpened(ev) {
      if (!ev || !ev.detail || ev.detail.requestId !== requestId) return;
      acknowledged = true;
      safe(function () { window.removeEventListener("mls:menu-staff-prep-opened", onOpened); });
    }
    safe(function () { window.addEventListener("mls:menu-staff-prep-opened", onOpened); });
    safe(function () {
      window.dispatchEvent(new CustomEvent("mls:menu-staff-prep-request", {
        detail: { source: "mls-topbar-menu", requestId: requestId }
      }));
    });
    setTimeout(function () {
      safe(function () { window.removeEventListener("mls:menu-staff-prep-opened", onOpened); });
      if (!acknowledged) safe(function () {
        if (typeof window.toast === "function") window.toast("Staff prep is still loading. Open Menu and try again.", "err");
      });
    }, 800);
  }
  var MENU_ITEMS = [
    { key: "staff-prep", capability: "standard", label: "Staff prep & Athena month pull", icon: "&#128451;", always: true, run: activateStaffPrepFromMenu },
    { key: "ask", capability: "standard", label: "Ask", icon: "✦", find: function () { return gid("askCopilotHdrBtn"); } },
    { key: "intake", capability: "clinician", label: "Patient intake", icon: "📝", find: function () { return gid("intakeBtn"); } },
    { key: "templates", capability: "clinician", label: "Templates", icon: "🗂", find: byOnclick("openTemplates") },
    { key: "custom-widget", capability: "clinician", label: "Custom widget", icon: "＋", find: function () { return gid("customWidgetHdrBtn"); } },
    { key: "athena-help", capability: "standard", label: "Troubleshoot Athena", icon: "🔧", find: function () { return gid("mlsAthenaDoctorBtn"); } },
    { key: "settings", capability: "signed", label: "Settings", icon: "⚙", find: byOnclick("openSettings") },
    { key: "logout", capability: "signed", label: "Log out", icon: "⏻", find: byOnclick("logout(") }
  ];
  function findBtnEl() { return byOnclick("mlsQuickFind")(); } // the standalone "Find" button (to hide)
  function pqsInput() { return gid("mlsPqsInput"); }
  function emailText() { var e = gid("whoLabel"); return e ? (e.textContent || "").trim() : ""; }
  function normalizeAccount(value) { return String(value || "").trim().toLowerCase(); }
  function authoritativeSessionState() {
    var explicit = safe(function () { return typeof window.__mlsSessionAccount === "string"; }, false);
    var bindingKnown = false, u = null, source = "none";
    /* ScribeFlow declares `let bkUser` in the global lexical environment.
       A top-level let is deliberately not a window property, but it is the
       authoritative /api/me identity visible to later classic scripts. Never
       prefer a mutable window.bkUser shadow when that lexical binding exists. */
    try {
      if (typeof bkUser !== "undefined") {
        bindingKnown = true;
        u = bkUser || null;
        source = "lexical-bkUser";
      }
    } catch (e0) {}
    /* Compatibility for standalone embeds/tests that do not declare the
       lexical binding. This fallback cannot override ScribeFlow's binding. */
    if (!bindingKnown) {
      u = safe(function () { return window.bkUser || null; }, null);
      if (u) source = "window-bkUser-compat";
    }
    var active = normalizeAccount(explicit ? window.__mlsSessionAccount :
      safe(function () { return (typeof window.getSessionEmail === "function" && window.getSessionEmail()) || (u && u.email) || ""; }, ""));
    var identity = normalizeAccount(u && u.email);
    /* Unknown mode defaults to hosted/strict. Only the explicit backend-off
       local evaluator may derive its fixed clinician role from its own signed
       account. Hosted mode always waits for an exact /api/me identity. */
    var hosted = safe(function () { return typeof backendMode === "function" ? !!backendMode() : true; }, true);
    var pending = false;
    if (!active) {
      u = null;
    } else if (u && identity !== active) {
      pending = true;
      u = null;
    } else if (!u && hosted) {
      pending = true;
    } else if (!u) {
      u = { email: active, role: "user", lite: false, localEvaluation: true };
      source = "local-session";
    }
    return { active: active, user: u, pending: pending, hosted: hosted, source: source };
  }
  function accountText() {
    return safe(function () {
      var state = authoritativeSessionState(), u = state.user;
      return String(state.active ? ((u && u.email) || state.active) : (emailText() || "")).trim();
    }, emailText());
  }
  function roleState() {
    var state = authoritativeSessionState(), u = state.user;
    var role = String((u && u.role) || "").toLowerCase();
    return {
      signed: !!state.active,
      pending: state.pending,
      lawyer: !!(u && (u.isLawyer || role === "lawyer")),
      receptionist: !!(u && role === "receptionist"),
      lite: !!(u && u.lite)
    };
  }
  function menuItemAllowed(it) {
    var r = roleState();
    if (!r.signed || r.pending) return false;
    if (it.capability === "signed") return true;
    if (it.capability === "clinician") return !r.lawyer && !r.receptionist && !r.lite;
    return !r.lawyer && !r.lite;
  }

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
        "display:flex;align-items:center;gap:10px;justify-content:flex-start !important;}" +
      "#" + PANEL_ID + " button.mlsTbItem:hover{background:#F0EEE7;}" +
      "#" + PANEL_ID + " button.mlsTbItem .mlsTbIco{width:18px;text-align:center;}" +
      /* rows other modules append (guided tour) inherit the same look */
      "#" + PANEL_ID + " #mlsObtMenuRow{width:100%;text-align:left;background:transparent;border:0;color:#1A211C !important;" +
        "font-family:inherit !important;font-size:14px !important;font-weight:600 !important;line-height:1.35 !important;cursor:pointer;border-radius:8px;padding:10px 12px !important;" +
        "display:flex !important;align-items:center;gap:10px;justify-content:flex-start !important;}" +
      "#" + PANEL_ID + " #mlsObtMenuRow:hover{background:#F0EEE7;}" +
      /* relocated navtab rows (Orders, Troubleshoot): never inherit the rail's
         .on dark-fill styling inside the white panel */
      "#" + PANEL_ID + " .navtab{color:#1A211C !important;background:transparent !important;}" +
      "#" + PANEL_ID + " .navtab:hover{background:#F0EEE7 !important;}" +
      "#" + PANEL_ID + " .navtab.on{color:#1A211C !important;background:transparent !important;box-shadow:none !important;}";
    var st = document.createElement("style");
    st.id = STYLE_ID; st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- build the menu ----
  function createMenuRow(it) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "mlsTbItem";
    b.setAttribute("data-mls-topbar-owned", "1");
    b.setAttribute("data-mls-menu-key", it.key);
    if (it.run === activateStaffPrepFromMenu) b.setAttribute("data-mls-action", "staff-prep");
    b.innerHTML = '<span class="mlsTbIco">' + it.icon + "</span><span></span>";
    b.lastChild.textContent = it.label;
    b.addEventListener("click", function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      closePanel();
      if (!menuItemAllowed(it)) { safe(apply); return; }
      if (typeof it.run === "function") {
        safe(it.run);
        return;
      }
      var target = it.find();
      if (target) safe(function () { target.click(); });
    });
    return b;
  }
  function reconcileMenuContent(panel) {
    if (!panel) return;
    var old = panel.querySelectorAll('[data-mls-topbar-owned="1"],.mlsTbWho,[data-mls-action="staff-prep"]');
    for (var i = 0; i < old.length; i++) if (old[i].parentNode === panel) old[i].parentNode.removeChild(old[i]);
    var anchor = panel.firstChild;
    var who = accountText();
    if (who) {
      var w = document.createElement("div");
      w.className = "mlsTbWho";
      w.setAttribute("data-mls-topbar-owned", "1");
      w.textContent = who;
      panel.insertBefore(w, anchor);
    }
    for (var j = 0; j < MENU_ITEMS.length; j++) {
      var it = MENU_ITEMS[j];
      if (!menuItemAllowed(it)) continue;
      if (!it.always && (!it.find || !it.find())) continue;
      panel.insertBefore(createMenuRow(it), anchor);
    }
  }
  function buildMenu() {
    var t = tools(), host = menuHost(); if (!t || !host) return;
    var existing = gid(MENU_ID);
    /* Editorial Calm intentionally relocates the live menu into its top-bar
       slot. Treat either host as canonical so Topbar and Redesign do not
       remove/recreate/move the same menu forever. */
    if (existing && (t.contains(existing) || host.contains(existing))) {
      reconcileMenuContent(existing.querySelector("#" + PANEL_ID));
      return existing;
    }
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
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
    reconcileMenuContent(panel);

    btn.addEventListener("click", function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      togglePanel();
    });

    wrap.appendChild(btn);
    wrap.appendChild(panel);
    host.appendChild(wrap);

    // rows other modules relocate into the panel don't know about closePanel
    panel.addEventListener("click", function (ev) {
      var row = ev.target && ev.target.closest && ev.target.closest(".navtab,#mlsObtMenuRow,#ez3flMenuStaff");
      if (row) setTimeout(closePanel, 60);
    });

    // close on outside click / Esc
    document.addEventListener("click", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }
  function panelEl() { return gid(PANEL_ID); }
  function openPanel() { var p = panelEl(); if (p) { if(!p.classList.contains("open"))p.classList.add("open"); var b = gid(BTN_ID); if (b&&b.getAttribute("aria-expanded")!=="true") b.setAttribute("aria-expanded", "true"); } }
  function closePanel() { var p = panelEl(); if (p) { if(p.classList.contains("open"))p.classList.remove("open"); var b = gid(BTN_ID); if (b&&b.getAttribute("aria-expanded")!=="false") b.setAttribute("aria-expanded", "false"); } }
  function togglePanel() { var p = panelEl(); if (p) { p.classList.contains("open") ? closePanel() : openPanel(); } }
  function outsideClose(ev) { var m = gid(MENU_ID); if (m && !m.contains(ev.target)) closePanel(); }
  function escClose(ev) { if (ev.key === "Escape") closePanel(); }

  // ---- hide the originals (cluster buttons, email, standalone Find) ----
  function hideOriginals() {
    MENU_ITEMS.forEach(function (it) { var el = it.find ? it.find() : null; if (el&&!el.classList.contains(HIDE)) el.classList.add(HIDE); });
    var email = gid("whoLabel"); if (email&&!email.classList.contains(HIDE)) email.classList.add(HIDE);
    var fb = findBtnEl(); if (fb&&!fb.classList.contains(HIDE)) fb.classList.add(HIDE);
  }

  // ---- unified find: the visible box launches the powerful Find ----
  var _boxFocus = null, _boxInput = null, _boxClick = null, _origPlaceholder = null;
  var _origAriaLabel = null, _origTitle = null;
  function findSurfaceVisible(el) {
    if (!el) return false;
    return safe(function () {
      var s = typeof getComputedStyle === "function" ? getComputedStyle(el) : null;
      var display = (s && s.display) || (el.style && el.style.display) || "";
      var visibility = (s && s.visibility) || (el.style && el.style.visibility) || "";
      return display !== "none" && visibility !== "hidden" && el.getAttribute("aria-hidden") !== "true";
    }, false);
  }
  function currentFindOwner() {
    var pro = !!(window.mlsQuickFind && window.mlsQuickFind.__fpWrap);
    return pro
      ? { overlay: "mlsFpQf", input: "mlsFpQfInput", other: "mlsQuickFindOv" }
      : { overlay: "mlsQuickFindOv", input: "mlsQfInput", other: "mlsFpQf" };
  }
  function retireClosedLegacyFind() {
    var legacy = gid("mlsQuickFindOv");
    if (!legacy || findSurfaceVisible(legacy)) return;
    /* The legacy launcher refuses to rebuild while any #mlsQuickFindOv exists,
       even when its close path left that node display:none. Remove only that
       closed node; a current owner will recreate its own surface on demand. */
    safe(function () { if (legacy.parentNode) legacy.parentNode.removeChild(legacy); else legacy.remove(); });
  }
  function wireFind() {
    var input = pqsInput(); if (!input) return;
    if (input.__mlsTbWired) return;
    Object.defineProperty(input, "__mlsTbWired", { value: true, configurable: true });
    _origPlaceholder = input.getAttribute("placeholder");
    _origAriaLabel = input.getAttribute("aria-label");
    _origTitle = input.getAttribute("title");
    safe(function () { input.setAttribute("placeholder", PQS_PLACEHOLDER); });
    safe(function () { input.setAttribute("aria-label", PQS_ARIA_LABEL); });
    safe(function () { input.setAttribute("title", PQS_ARIA_LABEL); });

    function openFind(seed) {
      if (typeof window.mlsQuickFind !== "function") return; // fall back: leave native box alone
      var owner = currentFindOwner();
      var competing = gid(owner.other);
      if (competing && findSurfaceVisible(competing)) safe(function () { competing.style.display = "none"; });
      retireClosedLegacyFind();
      if (!findSurfaceVisible(gid(owner.overlay))) safe(function () { window.mlsQuickFind(); });
      setTimeout(function () {
        var liveOwner = currentFindOwner();
        var qf = gid(liveOwner.input);
        if (!qf) {
          var proInput = gid("mlsFpQfInput"), legacyInput = gid("mlsQfInput");
          qf = findSurfaceVisible(gid("mlsFpQf")) ? proInput : legacyInput;
        }
        if (qf) {
          if (seed) { qf.value = seed; safe(function () { qf.dispatchEvent(new Event("input", { bubbles: true })); }); }
          safe(function () { qf.focus(); });
        }
      }, 60);
      safe(function () { input.value = ""; }); // reset the launcher box
    }
    _boxFocus = function () { openFind(input.value || ""); };
    _boxInput = function () { openFind(input.value || ""); };
    /* A launcher that was already focused does not emit another focus event
       when clicked. Keep click as an idempotent open signal so route changes
       and closed Find surfaces cannot leave a focused-but-inert launcher. */
    _boxClick = function () { openFind(input.value || ""); };
    input.addEventListener("focus", _boxFocus);
    input.addEventListener("input", _boxInput);
    input.addEventListener("click", _boxClick);
  }
  function unwireFind() {
    var input = pqsInput(); if (!input) return;
    safe(function () { if (_boxFocus) input.removeEventListener("focus", _boxFocus); });
    safe(function () { if (_boxInput) input.removeEventListener("input", _boxInput); });
    safe(function () { if (_boxClick) input.removeEventListener("click", _boxClick); });
    safe(function () { if (_origPlaceholder != null) input.setAttribute("placeholder", _origPlaceholder); });
    safe(function () { if (_origAriaLabel == null) input.removeAttribute("aria-label"); else input.setAttribute("aria-label", _origAriaLabel); });
    safe(function () { if (_origTitle == null) input.removeAttribute("title"); else input.setAttribute("title", _origTitle); });
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

  // ---- low-cost watcher: re-apply if the relevant header re-renders ----
  var _obs = null, _obsRoot = null, _toolsRoot = null;
  var _sentinelObs = null, _sentinelRoot = null;
  var _retryTimer = 0, _retryIndex = 0, _raf = 0, _rafIsNative = false;
  var _signalsBound = false, _reverted = false;
  var RETRY_DELAYS = [120, 300, 650, 1100, 1800, 2800, 4200, 6000];
  var TOPBAR_SELECTOR = ".tools,#mlsPqsInput,#whoLabel,#askCopilotHdrBtn,#intakeBtn,#customWidgetHdrBtn,#mlsAthenaDoctorBtn";

  function liveMenuMounted() {
    var host = menuHost(), menu = gid(MENU_ID), input = pqsInput();
    return !!(host && menu && host.contains(menu) && (!input || input.__mlsTbWired));
  }
  function isWithinOwnedMenu(node) {
    if (!node) return false;
    var el = node.nodeType === 1 ? node : node.parentElement;
    if (!el) return false;
    if (el.id === MENU_ID) return true;
    try { if (el.closest && el.closest("#" + MENU_ID)) return true; } catch (e) {}
    var menu = gid(MENU_ID);
    return !!(menu && (el === menu || menu.contains(el)));
  }
  function nodeContainsMenu(node) {
    if (!isEl(node)) return false;
    if (node.id === MENU_ID) return true;
    try { return !!node.querySelector("#" + MENU_ID); } catch (e) { return false; }
  }
  function nodeTouchesTopbar(node, liveTools) {
    if (!isEl(node) || isWithinOwnedMenu(node)) return false;
    if (liveTools && (node === liveTools || node.contains(liveTools))) return true;
    try { return node.matches(TOPBAR_SELECTOR) || !!node.querySelector(TOPBAR_SELECTOR); } catch (e) { return false; }
  }
  function mutationNeedsApply(records) {
    var liveTools = tools();
    if (liveTools !== _toolsRoot) return true;
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (isWithinOwnedMenu(record.target)) continue;
      for (var r = 0; r < record.removedNodes.length; r++) {
        if (nodeContainsMenu(record.removedNodes[r])) return true;
      }
      var targetInTools = !!(liveTools && (record.target === liveTools || liveTools.contains(record.target)));
      if (targetInTools) {
        var onlyOwnedAdds = record.addedNodes.length > 0 && record.removedNodes.length === 0;
        for (var a = 0; onlyOwnedAdds && a < record.addedNodes.length; a++) {
          if (!isWithinOwnedMenu(record.addedNodes[a])) onlyOwnedAdds = false;
        }
        if (!onlyOwnedAdds) return true;
        continue;
      }
      var lists = [record.addedNodes, record.removedNodes];
      for (var j = 0; j < lists.length; j++) {
        for (var k = 0; k < lists[j].length; k++) {
          if (nodeTouchesTopbar(lists[j][k], liveTools)) return true;
        }
      }
    }
    return false;
  }
  function headerRoot(t) {
    if (!t) return _obsRoot;
    return safe(function () { return t.closest("header,[role='banner'],#mlsRdTop,.topbar,.app-header") || t.parentElement; }, t.parentElement);
  }
  function bindObserver() {
    var t = tools();
    /* Do not tear down the stable parent sentinel while the header is briefly
       absent. It is what notices a later insertion after boot retries end. */
    if (!t) {
      _toolsRoot = null;
      safe(function () { if (_obs) _obs.disconnect(); });
      _obs = null;
      _obsRoot = null;
      return;
    }
    var root = headerRoot(t); if (!root) return;
    _toolsRoot = t;
    if (!_obs || root !== _obsRoot) {
      safe(function () { if (_obs) _obs.disconnect(); });
      safe(function () {
        _obs = new MutationObserver(function (records) { if (!_reverted && mutationNeedsApply(records)) schedule(); });
        _obs.observe(root, { childList: true, subtree: true });
        _obsRoot = root;
      });
    }

    /* The scoped root observer cannot see its own removal. Observe only its
       direct parent so wholesale #appHeader replacement reconnects us without
       a body-wide observer or a permanent poll. */
    var sentinel = root.parentNode;
    if (sentinel && (!_sentinelObs || sentinel !== _sentinelRoot)) {
      safe(function () { if (_sentinelObs) _sentinelObs.disconnect(); });
      safe(function () {
        _sentinelObs = new MutationObserver(function () {
          var liveTools = tools();
          var liveRoot = liveTools ? headerRoot(liveTools) : null;
          if (liveTools !== _toolsRoot || liveRoot !== _obsRoot || (_obsRoot && !_obsRoot.isConnected)) schedule();
        });
        _sentinelObs.observe(sentinel, { childList: true });
        _sentinelRoot = sentinel;
      });
    }
  }
  function applyAndObserve() {
    if (_reverted) return;
    safe(apply);
    safe(bindObserver);
  }
  function schedule() {
    if (_raf || _reverted) return;
    var run = function () { _raf = 0; if (!_reverted) applyAndObserve(); };
    if (typeof window.requestAnimationFrame === "function") {
      _rafIsNative = true;
      _raf = window.requestAnimationFrame(run);
    } else {
      _rafIsNative = false;
      _raf = setTimeout(run, 16);
    }
  }
  function retryMount() {
    _retryTimer = 0;
    applyAndObserve();
    if (_reverted || liveMenuMounted() || _retryIndex >= RETRY_DELAYS.length) return;
    _retryTimer = setTimeout(retryMount, RETRY_DELAYS[_retryIndex++]);
  }
  function startRetries() {
    if (_reverted) return;
    if (_retryTimer) clearTimeout(_retryTimer);
    _retryTimer = 0;
    _retryIndex = 0;
    retryMount();
  }
  function onTopbarSignal() { startRetries(); }
  function onTopbarVisible() { if (!document.hidden && !liveMenuMounted()) startRetries(); }
  function onTopbarActivity(ev) {
    if (liveMenuMounted()) return;
    var t = tools(), target = ev && ev.target;
    if (t && target && (target === t || t.contains(target))) startRetries();
  }
  function bindSignals() {
    if (_signalsBound) return;
    ["mls:ui-ready", "mls:topbar-ready", "mls:header-rendered", "mls:session-boundary"].forEach(function (type) { window.addEventListener(type, onTopbarSignal); });
    window.addEventListener("pageshow", onTopbarSignal);
    document.addEventListener("visibilitychange", onTopbarVisible);
    document.addEventListener("pointerdown", onTopbarActivity, true);
    _signalsBound = true;
  }
  function start() {
    if (_reverted) return;
    bindSignals();
    startRetries();
  }

  // ---- revert ----
  function revert() {
    _reverted = true;
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_sentinelObs) _sentinelObs.disconnect(); });
    safe(function () { if (_retryTimer) clearTimeout(_retryTimer); });
    safe(function () {
      if (_raf) {
        if (_rafIsNative && typeof window.cancelAnimationFrame === "function") window.cancelAnimationFrame(_raf);
        else clearTimeout(_raf);
      }
    });
    safe(function () { ["mls:ui-ready", "mls:topbar-ready", "mls:header-rendered", "mls:session-boundary"].forEach(function (type) { window.removeEventListener(type, onTopbarSignal); }); });
    safe(function () { window.removeEventListener("pageshow", onTopbarSignal); });
    safe(function () { document.removeEventListener("visibilitychange", onTopbarVisible); });
    safe(function () { document.removeEventListener("pointerdown", onTopbarActivity, true); });
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
    apply: function () { applyAndObserve(); },
    reconcile: function () { applyAndObserve(); },
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
