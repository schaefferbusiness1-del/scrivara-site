/* feat_mls_easy_pickfix.js -> window.__mlsEasyPickFix (v1.0.0)
 *
 * Additive, reversible companion to feat_mls_easy.js (S57) / feat_mls_protocol.js (S70)
 * / feat_mls_protocol_pickfix.js (S71). It fixes the NATIVE MLS Easy
 * "Who are you seeing?" step (__mlsEasy.state.step === 1, easy mode, NOT manual) —
 * the screen S70/S71 never intercept, because S71's pickfix only decorates the
 * protocol overlay (#mlsProtoStart / #mlsProtoGrid), which is not rendered on this
 * native path (the protocol auto-advance only fires inside the _importPulledSchedule
 * wrap; on a normal landing the app shows its own Step-1 instead).
 *
 * The native step renders, when a patient has been AUTO-PICKED into #heroPtName
 * (by the app's own _calLoadNextUp up-now auto-loader):
 *     ...<div class="ez-hint">: Ready: <b>NAME</b>. <a class="ez-link" id="ezGoRec">Go to recording -></a></div>
 * i.e. a tiny text link, with a patient pre-selected; and the centerpiece
 * (feat_mls_centerpiece.js) shows "Working on: NAME" from activePatient().
 *
 * Michael's ask (exact screen): the "Go to recording" control must be a BIG,
 * prominent button (not the tiny bottom link), and it must NOT auto-pick a patient —
 * after pressing it, the doctor PICKS who they're seeing, and only a tapped patient
 * proceeds to recording.
 *
 * What this asset does, ONLY while on that native step:
 *   (1) NO AUTO-PICK: neutralizes the app's _calLoadNextUp auto-loader (so it stops
 *       re-filling #heroPtName on this step) and blanks any already-auto-filled
 *       #heroPtName / #heroPtDob. With #heroPtName empty, feat_mls_easy.js natively
 *       renders NO "Ready: NAME" hint and NO #ezGoRec link (and, when athenaOne is
 *       connected, NO warning — connWarn is '' ). The centerpiece "Working on: NAME"
 *       banner (.mlscp-acting) is hidden on this step via CSS.
 *   (2) BIG BUTTON: injects exactly one full-width, >=56px, high-contrast green
 *       "Go to recording" button where the tiny link used to be; the native #ezGoRec
 *       link is hidden defensively if it ever appears.
 *   (3) PICK-THEN-RECORD: the big button opens the patient picker
 *       __mlsProtocol.enterSlide2() — the S71-decorated "tap who you're seeing" card
 *       grid (nothing pre-selected; advances to recording only when a card is tapped).
 *       This makes S71's intent finally apply to the path the user actually hits.
 *       If the protocol/cards aren't available it reveals the app's own #heroToday
 *       grid and nudges the doctor to pull first.
 *
 * SAFETY: own IIFE; every external call wrapped in try/catch; sends NOTHING to the
 * MLS Assist extension; never clicks Save/Sign/attest/submit and never writes a chart;
 * read-only on clinical data. The ONLY app function it wraps is window._calLoadNextUp,
 * and ONLY to no-op it while on this one step (restored on revert). Idempotent — no
 * double-build, no render loop (blanking only fires when a value is present).
 * window.__mlsEasyPickFix.revert() removes the button + styles + class, unwraps
 * _calLoadNextUp, and disconnects observers. No PHI in this file or any log.
 */
;(function () {
  "use strict";
  try { if (window.__mlsEasyPickFix && window.__mlsEasyPickFix.installed) return; } catch (e) {}

  var VERSION = "1.0.0";
  var STYLE_ID = "mlsEzpfStyle";
  var BTN_ID = "mlsEzpfGo";
  var HINT_ID = "mlsEzpfHint";
  var PANEL_ID = "mlsEasyPanel";
  var ON_CLASS = "mlsezpf-on";      // set on <html> while we are on the target step
  var STEP_CLASS = "mlsezpf-step";  // set on #mlsEasyPanel while we are on the target step

  // ---------- tiny safe helpers ----------
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function panel() { return gid(PANEL_ID); }
  function easyState() { return safe(function () { return window.__mlsEasy && window.__mlsEasy.state; }, null) || null; }

  // True only on the native MLS Easy "Who are you seeing?" patient step (pull flow,
  // not manual entry, not the full UI).
  function onTargetStep() {
    var s = easyState();
    if (!s || s.step !== 1 || s.mode === "full" || s.manual) return false;
    var p = panel();
    if (!p || !(p.offsetParent || p.getClientRects().length)) return false;
    // it's the patient step iff the title is the "Who are you seeing?" prompt OR
    // the native ready-link / pull-actions are present.
    var title = p.querySelector(".ez-title");
    var titled = title && /who are you seeing/i.test(title.textContent || "");
    return !!(titled || gid("ezGoRec") || p.querySelector(".ez-actions"));
  }

  // ---------- styles (idempotent) ----------
  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var css =
      // hide the native tiny "Ready: NAME. Go to recording ->" hint on this step
      "#" + PANEL_ID + "." + STEP_CLASS + " .ez-hint{display:none !important;}" +
      // hide the centerpiece "Working on: NAME" banner while picking on this step
      "html." + ON_CLASS + " .mlscp-acting,html." + ON_CLASS + " #mlscpActing{display:none !important;}" +
      // the big green button
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
      "@media (max-width:560px){#" + BTN_ID + "{font-size:17px !important;min-height:58px !important;}}";
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---------- (1) neutralize the native auto-pick ----------
  var _origCal = null, _wrapCal = null;
  function wrapCal() {
    if (_wrapCal) return;
    if (!isFn(window._calLoadNextUp)) return;
    if (window._calLoadNextUp.__mlsEzpfWrapped) { _wrapCal = window._calLoadNextUp; return; }
    _origCal = window._calLoadNextUp;
    _wrapCal = function () {
      // suppress the up-now auto-loader ONLY while on the target step; pass through
      // everywhere else (full view, other steps) so normal behaviour is untouched.
      if (onTargetStep()) return;
      return _origCal.apply(this, arguments);
    };
    _wrapCal.__mlsEzpfWrapped = true;
    window._calLoadNextUp = _wrapCal;
  }
  function blankHeroName() {
    // only acts when a value is present -> no churn, no render loop
    ["heroPtName", "heroPtDob"].forEach(function (id) {
      var e = gid(id);
      if (e && e.value) {
        e.value = "";
        safe(function () { e.dispatchEvent(new Event("input", { bubbles: true })); });
      }
    });
    safe(function () { if (isFn(window._heroSyncName)) window._heroSyncName(); });
  }

  // ---------- (2) the big button ----------
  function ensureBigButton() {
    var p = panel();
    if (!p) return;
    if (gid(BTN_ID)) return; // idempotent
    var btn = document.createElement("button");
    btn.type = "button";
    btn.id = BTN_ID;
    btn.textContent = "🎙️ Go to recording";
    btn.setAttribute("aria-label", "Go to recording");
    var hint = document.createElement("div");
    hint.id = HINT_ID;
    hint.textContent = "Press to choose who you’re seeing, then start recording.";
    // place it where the doctor expects the advance control: after the body's actions
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

  // ---------- (3) pick-then-record ----------
  function pickerOpen() {
    var p = panel();
    return !!(gid("mlsProtoSlide2") && p && /(^|\s)mlsproto-s2(\s|$)/.test(p.className));
  }
  function openPicker() {
    // make sure nothing is pre-selected before the picker opens
    blankHeroName();
    var P = window.__mlsProtocol;
    if (P && isFn(P.enterSlide2)) {
      safe(function () { P.enterSlide2(); });
      if (pickerOpen()) { setHint(""); return; }
    }
    // fallback: reveal the app's own NEXT UP grid and nudge to pull
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

  // ---------- apply / teardown per render ----------
  function markStep(on) {
    var p = panel();
    var root = document.documentElement;
    if (on) {
      if (p && p.classList) p.classList.add(STEP_CLASS);
      if (root && root.classList) root.classList.add(ON_CLASS);
    } else {
      if (p && p.classList) p.classList.remove(STEP_CLASS);
      if (root && root.classList) root.classList.remove(ON_CLASS);
      var b = gid(BTN_ID); if (b) b.remove();
      var h = gid(HINT_ID); if (h) h.remove();
    }
  }
  function apply() {
    safe(wrapCal);
    if (!onTargetStep()) {
      // only tear down our step decorations when we are genuinely off the step AND
      // the picker overlay is not the thing covering it
      if (!pickerOpen()) markStep(false);
      return;
    }
    if (pickerOpen()) return; // picker is showing over the step; leave it to S70/S71
    injectStyle();
    markStep(true);
    blankHeroName();
    // hide native tiny link defensively (CSS already hides .ez-hint, but be explicit)
    var go = gid("ezGoRec");
    if (go) { var hint = go.closest ? go.closest(".ez-hint") : null; if (hint) hint.style.display = "none"; }
    ensureBigButton();
  }

  // ---------- keep applied across native re-renders ----------
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

  // ---------- revert ----------
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
    openPicker: openPicker,
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  } catch (e) { safe(start); }
})();
