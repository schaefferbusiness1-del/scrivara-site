/* feat_mls_easy_pickfix.js -> window.__mlsEasyPickFix (v1.1.0)
 *
 * v1.1.0 (dedup + anti-flicker): the big "Go to recording" button now exists ONLY on
 * the native step. The instant the §71 picker overlay opens it is removed, so the
 * §71-gated picker button (#mlsProtoStart) is the SINGLE advance control on the picker
 * screen (no two coexisting buttons). Picker state is detected via the protocol's
 * stable JS flag window.__mlsProtocol._s2.active (NOT the flickery .mlsproto-s2 DOM
 * class), so a mid-render false reading can no longer make us re-blank the hero name or
 * re-inject the button while the doctor is tapping a card -> no flicker/glitch loop.
 *
 * Additive, reversible companion to feat_mls_easy.js (S57) / feat_mls_protocol.js (S70)
 * / feat_mls_protocol_pickfix.js (S71). Fixes the NATIVE MLS Easy "Who are you seeing?"
 * step (__mlsEasy.state.step === 1, easy mode, NOT manual).
 */
;(function () {
  "use strict";
  try { if (window.__mlsEasyPickFix && window.__mlsEasyPickFix.installed) return; } catch (e) {}

  var VERSION = "1.1.0";
  var STYLE_ID = "mlsEzpfStyle";
  var BTN_ID = "mlsEzpfGo";
  var HINT_ID = "mlsEzpfHint";
  var PANEL_ID = "mlsEasyPanel";
  var ON_CLASS = "mlsezpf-on";
  var STEP_CLASS = "mlsezpf-step";

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function panel() { return gid(PANEL_ID); }
  function easyState() { return safe(function () { return window.__mlsEasy && window.__mlsEasy.state; }, null) || null; }

  function onTargetStep() {
    var s = easyState();
    if (!s || s.step !== 1 || s.mode === "full" || s.manual) return false;
    var p = panel();
    if (!p || !(p.offsetParent || p.getClientRects().length)) return false;
    var title = p.querySelector(".ez-title");
    var titled = title && /who are you seeing/i.test(title.textContent || "");
    return !!(titled || gid("ezGoRec") || p.querySelector(".ez-actions"));
  }

  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var css =
      "#" + PANEL_ID + "." + STEP_CLASS + " .ez-hint{display:none !important;}" +
      "html." + ON_CLASS + " .mlscp-acting,html." + ON_CLASS + " #mlscpActing{display:none !important;}" +
      "#" + BTN_ID + "{display:block !important;width:100% !important;box-sizing:border-box !important;" +
        "min-height:60px !important;padding:16px 20px !important;margin:14px 0 4px !important;" +
        "font-family:inherit !important;font-size:18px !important;font-weight:800 !important;line-height:1.15 !important;" +
        "letter-spacing:.2px !important;border:0 !important;border-radius:14px !important;cursor:pointer !important;" +
        "text-align:center !important;white-space:normal !important;color:#ffffff !important;background:#0a7d2c !important;" +
        "box-shadow:0 3px 0 #075f21,0 6px 16px rgba(10,125,44,.35) !important;" +
        "transition:transform .04s ease,box-shadow .12s ease !important;}" +
      "#" + BTN_ID + ":hover{background:#0b8a30 !important;}" +
      "#" + BTN_ID + ":active{transform:translateY(2px) !important;box-shadow:0 1px 0 #075f21 !important;}" +
      "#" + BTN_ID + ":focus-visible{outline:3px solid #ffd34d !important;outline-offset:2px !important;}" +
      "#" + HINT_ID + "{margin:4px 2px 2px;font-size:13px;line-height:1.35;color:#cfe0ff;opacity:.95;text-align:center;}" +
      "#" + PANEL_ID + ".mlsproto-s2 #" + BTN_ID + ",#" + PANEL_ID + ".mlsproto-s2 #" + HINT_ID + "{display:none !important;}" +
      "@media (max-width:560px){#" + BTN_ID + "{font-size:17px !important;min-height:58px !important;}}";
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  var _origCal = null, _wrapCal = null;
  function wrapCal() {
    if (_wrapCal) return;
    if (!isFn(window._calLoadNextUp)) return;
    if (window._calLoadNextUp.__mlsEzpfWrapped) { _wrapCal = window._calLoadNextUp; return; }
    _origCal = window._calLoadNextUp;
    _wrapCal = function () {
      if (onTargetStep()) return;
      return _origCal.apply(this, arguments);
    };
    _wrapCal.__mlsEzpfWrapped = true;
    window._calLoadNextUp = _wrapCal;
  }
  function blankHeroName() {
    ["heroPtName", "heroPtDob"].forEach(function (id) {
      var e = gid(id);
      if (e && e.value) {
        e.value = "";
        safe(function () { e.dispatchEvent(new Event("input", { bubbles: true })); });
      }
    });
    safe(function () { if (isFn(window._heroSyncName)) window._heroSyncName(); });
  }

  function ensureBigButton() {
    var p = panel();
    if (!p) return;
    if (gid(BTN_ID)) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = BTN_ID;
    btn.textContent = "🎙️ Go to recording";
    btn.setAttribute("aria-label", "Go to recording");
    var hint = document.createElement("div");
    hint.id = HINT_ID;
    hint.textContent = "Press to choose who you’re seeing, then start recording.";
    var body = p.querySelector(".ez-body") || p;
    var actions = body.querySelector(".ez-actions");
    if (actions && actions.parentNode) {
      actions.parentNode.insertBefore(btn, actions.nextSibling);
      btn.parentNode.insertBefore(hint, btn.nextSibling);
    } else {
      body.appendChild(btn);
      body.appendChild(hint);
    }
    btn.addEventListener("click", function (ev) {
      safe(function () { ev.preventDefault(); });
      openPicker();
    });
  }

  function pickerActive() {
    var byFlag = safe(function () { return !!(window.__mlsProtocol && window.__mlsProtocol._s2 && window.__mlsProtocol._s2.active); }, false);
    if (byFlag) return true;
    var p = panel();
    return !!(gid("mlsProtoSlide2") && p && /(^|\s)mlsproto-s2(\s|$)/.test(p.className));
  }
  function removeBigButton() {
    var b = gid(BTN_ID); if (b) b.remove();
    var h = gid(HINT_ID); if (h) h.remove();
  }
  function openPicker() {
    blankHeroName();
    var P = window.__mlsProtocol;
    if (P && isFn(P.enterSlide2)) {
      safe(function () { P.enterSlide2(); });
      if (pickerActive()) { removeBigButton(); setHint(""); return; }
    }
    var ht = gid("heroToday");
    if (ht) {
      safe(function () { ht.classList.remove("mlsEasyHidden"); });
      safe(function () { ht.scrollIntoView({ block: "nearest" }); });
    }
    setHint("Tap who you’re seeing below. If the list is empty, pull today’s patients first.");
  }
  function setHint(text) {
    var h = gid(HINT_ID);
    if (h) h.textContent = text || "";
  }

  function markStep(on) {
    var p = panel();
    var root = document.documentElement;
    if (on) {
      if (p && p.classList) p.classList.add(STEP_CLASS);
      if (root && root.classList) root.classList.add(ON_CLASS);
    } else {
      if (p && p.classList) p.classList.remove(STEP_CLASS);
      if (root && root.classList) root.classList.remove(ON_CLASS);
      removeBigButton();
    }
  }
  function apply() {
    safe(wrapCal);
    if (pickerActive()) { removeBigButton(); return; }
    if (!onTargetStep()) { markStep(false); return; }
    injectStyle();
    markStep(true);
    blankHeroName();
    var go = gid("ezGoRec");
    if (go) { var hint = go.closest ? go.closest(".ez-hint") : null; if (hint) hint.style.display = "none"; }
    ensureBigButton();
  }

  var _obs = null, _poll = null, _raf = 0, _reverted = false;
  function schedule() {
    if (_raf) return;
    _raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { _raf = 0; safe(apply); });
  }
  function start() {
    injectStyle();
    safe(wrapCal);
    safe(function () {
      _obs = new MutationObserver(function () { if (!_reverted) schedule(); });
      _obs.observe(document.documentElement, { childList: true, subtree: true });
    });
    _poll = setInterval(function () { if (!_reverted) safe(apply); }, 1200);
    safe(apply);
  }

  function revert() {
    _reverted = true;
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_poll) clearInterval(_poll); });
    safe(function () {
      if (_wrapCal && window._calLoadNextUp === _wrapCal && _origCal) window._calLoadNextUp = _origCal;
    });
    safe(function () { markStep(false); });
    safe(function () { var s = gid(STYLE_ID); if (s) s.remove(); });
    safe(function () { window.__mlsEasyPickFix.installed = false; });
    return true;
  }

  window.__mlsEasyPickFix = {
    installed: true,
    version: VERSION,
    apply: function () { safe(apply); },
    onTargetStep: onTargetStep,
    pickerActive: pickerActive,
    openPicker: openPicker,
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  } catch (e) { safe(start); }
})();
