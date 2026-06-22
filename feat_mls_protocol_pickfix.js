/* feat_mls_protocol_pickfix.js -> window.__mlsProtoPickFix (v1.0.0)
 * Additive, reversible companion to feat_mls_protocol.js (S70).
 * Two doctor-requested MLS Easy fixes, applied to the protocol Slide 2 (NEXT UP picker):
 *   (1) BIG "Go to recording" button: replaces the small advance control with a large,
 *       high-contrast, full-width, >=56px button.
 *   (2) DOCTOR PICKS THE PATIENT (no auto-pick): the big button is DISABLED until the
 *       doctor taps a patient card. Tapping a card sets that patient active (via the card's
 *       own _heroPickPatient) and ENABLES the big button labelled "Go to recording - <name>".
 *       Tapping a card no longer auto-advances; only the big button advances.
 * Keeps everything else from S70 intact (auto-advance after pull lands on the picker,
 * record textbox, generate/review/save/summary, provider-name binding, sizing, switch-to-full-view).
 * Never Signs/writes a chart. Read-only on clinical data. No PHI in this file.
 */
;(function () {
  "use strict";
  if (window.__mlsProtoPickFix && window.__mlsProtoPickFix.installed) return;

  var VERSION = "1.0.0";
  var STYLE_ID = "mlsProtoPickFixStyle";
  var HINT_ID = "mlsProtoPickFixHint";
  var SELECTED_CLASS = "mlsppfx-selected";
  var BIG_CLASS = "mlsppfx-bigbtn";

  function safe(fn) { try { return fn(); } catch (e) { /* swallow */ } }
  function gid(id) { return document.getElementById(id); }

  // ---- injected styles (idempotent) -------------------------------------
  function injectStyle() {
    if (gid(STYLE_ID)) return;
    var css =
      "#mlsProtoStart." + BIG_CLASS + "{" +
        "display:block!important;width:100%!important;box-sizing:border-box!important;" +
        "min-height:60px!important;padding:16px 20px!important;margin:14px 0 6px!important;" +
        "font-size:18px!important;font-weight:800!important;line-height:1.15!important;" +
        "letter-spacing:.2px!important;border:0!important;border-radius:14px!important;" +
        "cursor:pointer!important;text-align:center!important;white-space:normal!important;" +
        "color:#ffffff!important;background:#0a7d2c!important;" +
        "box-shadow:0 3px 0 #075f21,0 6px 16px rgba(10,125,44,.35)!important;" +
        "transition:transform .04s ease,box-shadow .12s ease!important;}" +
      "#mlsProtoStart." + BIG_CLASS + ":not([disabled]):hover{background:#0b8a30!important;}" +
      "#mlsProtoStart." + BIG_CLASS + ":not([disabled]):active{transform:translateY(2px)!important;box-shadow:0 1px 0 #075f21!important;}" +
      "#mlsProtoStart." + BIG_CLASS + "[disabled]{" +
        "background:#9aa3ad!important;color:#eef2f6!important;cursor:not-allowed!important;" +
        "opacity:.85!important;box-shadow:none!important;}" +
      "#" + HINT_ID + "{margin:2px 2px 8px;font-size:13.5px;line-height:1.3;color:#cfe0ff;opacity:.95;text-align:center;}" +
      "#mlsProtoGrid button." + SELECTED_CLASS + "{" +
        "outline:3px solid #0a7d2c!important;outline-offset:1px!important;" +
        "box-shadow:0 0 0 3px rgba(10,125,44,.25)!important;border-radius:12px!important;}" +
      "@media (max-width:560px){#mlsProtoStart." + BIG_CLASS + "{font-size:17px!important;min-height:58px!important;}}";
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- helpers ----------------------------------------------------------
  // Read a card's patient display name (first line). Used only for the button label
  // on the doctor's own screen; never logged or persisted by this module.
  function cardName(btn) {
    var txt = "";
    safe(function () {
      var span = btn.querySelector("span");
      txt = (span ? span.textContent : btn.textContent) || "";
    });
    txt = txt.replace(/\s+/g, " ").trim();
    // strip a leading bullet/status glyph if present
    txt = txt.replace(/^[●•✓✔\s]+/, "").trim();
    return txt;
  }

  function setDisabled(btn, disabled) {
    if (!btn) return;
    if (disabled) {
      btn.setAttribute("disabled", "disabled");
      btn.setAttribute("aria-disabled", "true");
    } else {
      btn.removeAttribute("disabled");
      btn.setAttribute("aria-disabled", "false");
    }
  }

  function setHint(text) {
    var overlay = gid("mlsProtoSlide2");
    if (!overlay) return;
    var hint = gid(HINT_ID);
    if (!hint) {
      hint = document.createElement("div");
      hint.id = HINT_ID;
      var startBtn = gid("mlsProtoStart");
      if (startBtn && startBtn.parentNode) {
        startBtn.parentNode.insertBefore(hint, startBtn);
      } else {
        overlay.appendChild(hint);
      }
    }
    hint.textContent = text;
  }

  // ---- the decoration applied after each enterSlide2() ------------------
  function decorate() {
    injectStyle();
    var grid = gid("mlsProtoGrid");
    var startBtn = gid("mlsProtoStart");
    if (!grid || !startBtn) return; // slide 2 not present yet

    // (A) Drop the protocol's delegated auto-advance-on-card-tap listener by
    //     replacing the grid with a clone. Inline onclick="_heroPickPatient(N)"
    //     attributes are preserved (they set the active patient), but the
    //     addEventListener-based advance is removed.
    if (!grid.__ppfxRebound) {
      var fresh = grid.cloneNode(true);
      fresh.__ppfxRebound = true;
      grid.parentNode.replaceChild(fresh, grid);
      grid = fresh;
      // our own select-only listener (bubble phase: runs AFTER the card's inline onclick)
      grid.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest("button") : null;
        if (!btn || !grid.contains(btn)) return;
        // mark selection
        safe(function () {
          var prev = grid.querySelector("button." + SELECTED_CLASS);
          if (prev) prev.classList.remove(SELECTED_CLASS);
        });
        btn.classList.add(SELECTED_CLASS);
        var name = cardName(btn);
        var bb = gid("mlsProtoStart");
        if (bb) {
          bb.classList.add(BIG_CLASS);
          setDisabled(bb, false);
          bb.textContent = name ? ("🎙️ Go to recording — " + name) : "🎙️ Go to recording";
        }
        setHint("Selected. Tap the green button to start recording — or tap a different patient.");
      });
    }

    // (B) Make the advance button BIG and gated. Replace it with a clone to drop the
    //     protocol's goRecord-on-click listener, then bind our own gated advance.
    if (!startBtn.__ppfxRebound) {
      var freshBtn = startBtn.cloneNode(true);
      freshBtn.__ppfxRebound = true;
      freshBtn.classList.add(BIG_CLASS);
      freshBtn.classList.remove("ez-link");
      startBtn.parentNode.replaceChild(freshBtn, startBtn);
      startBtn = freshBtn;
      startBtn.addEventListener("click", function (e) {
        if (startBtn.hasAttribute("disabled")) { e.preventDefault(); e.stopPropagation(); return; }
        // advance to the record step for the (already-active) selected patient,
        // reusing the protocol's own advance path.
        var advanced = false;
        safe(function () {
          if (window.__mlsProtocol && typeof window.__mlsProtocol.goRecord === "function") {
            window.__mlsProtocol.goRecord();
            advanced = true;
          }
        });
        if (!advanced) safe(function () {
          if (window.__mlsProtocol && typeof window.__mlsProtocol.exitSlide2 === "function") window.__mlsProtocol.exitSlide2();
          if (window.__mlsEasy && typeof window.__mlsEasy.goto === "function") window.__mlsEasy.goto(2);
        });
      });
    }

    // (C) No auto-pick: on (re)entry nothing is selected; button disabled.
    startBtn.classList.add(BIG_CLASS);
    if (!grid.querySelector("button." + SELECTED_CLASS)) {
      setDisabled(startBtn, true);
      startBtn.textContent = "🎙️ Go to recording";
      setHint("👆 Tap who you’re seeing above first — then this button turns green.");
    }
  }

  // ---- wrap __mlsProtocol.enterSlide2 so we re-decorate every render ----
  var wrapped = false;
  function wrap() {
    if (wrapped) return true;
    var P = window.__mlsProtocol;
    if (!P || typeof P.enterSlide2 !== "function") return false;
    var orig = P.enterSlide2;
    P.enterSlide2 = function () {
      var r = orig.apply(this, arguments);
      // decorate after the synchronous build; also a microtask retry for safety
      safe(decorate);
      setTimeout(function () { safe(decorate); }, 0);
      return r;
    };
    P.__mlsProtoPickFixWrapped = { orig: orig };
    wrapped = true;
    // if slide 2 is already on-screen, decorate now
    safe(decorate);
    return true;
  }

  // ---- boot: wait (poll) for __mlsProtocol, then wrap ------------------
  var tries = 0, timer = null;
  function boot() {
    if (wrap()) { stopPoll(); return; }
    tries++;
    if (tries > 60) { stopPoll(); return; } // ~12s max
  }
  function stopPoll() { if (timer) { clearInterval(timer); timer = null; } }
  safe(boot);
  if (!wrapped) timer = setInterval(boot, 200);

  // also catch a late protocol install via DOM appearance of slide 2
  var obs = null;
  safe(function () {
    obs = new MutationObserver(function () {
      if (!wrapped) wrap();
      if (gid("mlsProtoStart") && gid("mlsProtoStart").__ppfxRebound !== true) safe(decorate);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });

  // ---- public API + revert ---------------------------------------------
  window.__mlsProtoPickFix = {
    installed: true,
    version: VERSION,
    decorate: function () { safe(decorate); },
    revert: function () {
      safe(stopPoll);
      safe(function () { if (obs) obs.disconnect(); });
      // unwrap enterSlide2
      safe(function () {
        var P = window.__mlsProtocol;
        if (P && P.__mlsProtoPickFixWrapped && P.__mlsProtoPickFixWrapped.orig) {
          P.enterSlide2 = P.__mlsProtoPickFixWrapped.orig;
          delete P.__mlsProtoPickFixWrapped;
        }
      });
      // remove style + hint
      safe(function () { var s = gid(STYLE_ID); if (s) s.remove(); });
      safe(function () { var h = gid(HINT_ID); if (h) h.remove(); });
      // if slide 2 is currently shown, re-render the original protocol version
      safe(function () {
        if (gid("mlsProtoSlide2") && window.__mlsProtocol && typeof window.__mlsProtocol.enterSlide2 === "function") {
          window.__mlsProtocol.enterSlide2();
        }
      });
      window.__mlsProtoPickFix.installed = false;
      return true;
    }
  };
})();
