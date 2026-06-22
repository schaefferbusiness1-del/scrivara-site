/* feat_mls_easy_pickfix.js -> window.__mlsEasyPickFix (v1.2.0)
 *
 * v1.2.0 (resilient picker: dead-button + name-glitch fix).
 *
 * ROOT CAUSE fixed here (proven live, synthetic patients):
 *   The §70 patient picker (#mlsProtoSlide2 -> #mlsProtoGrid / #mlsProtoStart) is
 *   injected INTO the easy panel. Each card carries an inline onclick="_heroPickPatient(N)"
 *   which writes #heroPtName; that write triggers a NATIVE re-render of the whole
 *   #mlsEasyPanel, which DESTROYS the injected picker DOM (cards + the big "Go to
 *   recording" button) and nothing rebuilds it. So: the patient names flicker/disappear,
 *   and the "Go to recording" button is gone -> clicking it does NOTHING. Separately the
 *   record-step scratch textbox only appeared if a later mutation happened to wake §70's
 *   observer, so it often never showed.
 *
 * THE FIX (additive, reversible; takes ownership of the picker on this step):
 *   1. SELECT WITHOUT WIPING — on the picker, strip each card's inline _heroPickPatient(N)
 *      so tapping a card no longer writes #heroPtName and no longer triggers the native
 *      re-render. Tapping now ONLY selects (records the patient index in a JS variable +
 *      highlights the card + enables the single button). No auto-pick, no auto-advance.
 *   2. SELECTION SURVIVES RE-RENDER — the choice lives in a JS variable, not just a DOM
 *      class, and is re-applied whenever the picker is (re)claimed, so the button never
 *      goes dead.
 *   3. SELF-HEAL — if any other native re-render still wipes the picker while we're on it,
 *      it is re-mounted (idempotently) and the selection re-applied. Render-once otherwise:
 *      claimed elements are flagged so we never rebuild/fight on idle observer ticks.
 *   4. ONE BUTTON THAT WORKS — the single big "Go to recording" button, on click, sets the
 *      chosen patient active (the real _heroPickPatient for the selected card), advances to
 *      the record step (§70 goRecord / __mlsEasy.goto(2)), AND guarantees the type/paste
 *      textbox appears (nudges §70's injectScratch on document.body until #mlsProtoScratch
 *      exists). A document-level capture backup runs the same advance even if the click
 *      lands on a freshly re-mounted button before it is re-claimed.
 *
 * Keeps the §74 native-step behavior (no auto-pick, no tiny #ezGoRec link, one big green
 * #mlsEzpfGo button that opens the picker). Partially supersedes §71 on the picker by
 * claiming #mlsProtoGrid / #mlsProtoStart (sets __ppfxRebound so §71 leaves them alone) —
 * §71 is NOT removed and still composes; this module is the picker authority on this step.
 *
 * Additive, reversible companion to feat_mls_easy.js (S57) / feat_mls_protocol.js (S70)
 * / feat_mls_protocol_pickfix.js (S71). Never Signs/writes a chart; read-only on clinical
 * data; no PHI in this file.
 */
;(function () {
  "use strict";
  try { if (window.__mlsEasyPickFix && window.__mlsEasyPickFix.installed) return; } catch (e) {}

  var VERSION = "1.2.0";
  var STYLE_ID = "mlsEzpfStyle";
  var BTN_ID = "mlsEzpfGo";
  var HINT_ID = "mlsEzpfHint";
  var PANEL_ID = "mlsEasyPanel";
  var ON_CLASS = "mlsezpf-on";
  var STEP_CLASS = "mlsezpf-step";
  var BIG_CLASS = "mlsppfx-bigbtn";        // reuse §71 styling if present
  var SELECTED_CLASS = "mlsppfx-selected"; // reuse §71 styling if present
  var CLAIM = "__ezpf2";                    // our ownership flag on claimed elements

  // selection state (survives any re-render of the picker)
  var _selIdx = null;   // original _heroPickPatient index of the chosen card
  var _selName = "";

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
      // self-sufficient styling for the big advance button + selected card (in case §71 is reverted)
      "#mlsProtoStart." + BIG_CLASS + "{display:block !important;width:100% !important;box-sizing:border-box !important;" +
        "min-height:60px !important;padding:16px 20px !important;margin:14px 0 6px !important;font-size:18px !important;" +
        "font-weight:800 !important;line-height:1.15 !important;border:0 !important;border-radius:14px !important;" +
        "cursor:pointer !important;text-align:center !important;white-space:normal !important;color:#fff !important;" +
        "background:#0a7d2c !important;box-shadow:0 3px 0 #075f21,0 6px 16px rgba(10,125,44,.35) !important;" +
        "transition:transform .04s ease,box-shadow .12s ease !important;}" +
      "#mlsProtoStart." + BIG_CLASS + ":not([disabled]):hover{background:#0b8a30 !important;}" +
      "#mlsProtoStart." + BIG_CLASS + "[disabled]{background:#9aa3ad !important;color:#eef2f6 !important;" +
        "cursor:not-allowed !important;opacity:.85 !important;box-shadow:none !important;}" +
      "#mlsProtoGrid button." + SELECTED_CLASS + "{outline:3px solid #0a7d2c !important;outline-offset:1px !important;" +
        "box-shadow:0 0 0 3px rgba(10,125,44,.25) !important;border-radius:12px !important;}" +
      "@media (max-width:560px){#" + BTN_ID + "{font-size:17px !important;min-height:58px !important;}" +
        "#mlsProtoStart." + BIG_CLASS + "{font-size:17px !important;min-height:58px !important;}}";
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }

  // ---- no-auto-pick on the native step: neutralize the up-now auto-loader ----
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

  // ---- the single big button on the native step (opens the picker) ----
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
    _selIdx = null; _selName = "";
    blankHeroName();
    var P = window.__mlsProtocol;
    if (P && isFn(P.enterSlide2)) {
      safe(function () { P.enterSlide2(); });
      if (pickerActive()) { removeBigButton(); setHint(""); safe(claimPicker); return; }
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

  // ================= PICKER OWNERSHIP =================
  function cardIndex(btn) {
    var v = btn.getAttribute("data-ezidx");
    if (v != null && v !== "") return +v;
    var oc = btn.getAttribute("onclick") || "";
    var m = /_heroPickPatient\(\s*(\d+)\s*\)/.exec(oc);
    return m ? +m[1] : -1;
  }
  function cardName(btn) {
    var txt = "";
    safe(function () { var s = btn.querySelector("span"); txt = (s ? s.textContent : btn.textContent) || ""; });
    return txt.replace(/\s+/g, " ").replace(/^[●•✓✔\s]+/, "").trim();
  }
  function setDisabled(btn, off) {
    if (!btn) return;
    if (off) { btn.setAttribute("disabled", "disabled"); btn.setAttribute("aria-disabled", "true"); }
    else { btn.removeAttribute("disabled"); btn.setAttribute("aria-disabled", "false"); }
  }
  function startBtn() { return gid("mlsProtoStart"); }

  function refreshStart() {
    var b = startBtn(); if (!b) return;
    b.classList.add(BIG_CLASS);
    if (_selIdx == null) {
      setDisabled(b, true);
      b.textContent = "🎙️ Go to recording";
    } else {
      setDisabled(b, false);
      b.textContent = _selName ? ("🎙️ Go to recording — " + _selName) : "🎙️ Go to recording";
    }
  }

  function selectCard(grid, btn) {
    safe(function () {
      var prev = grid.querySelector("button." + SELECTED_CLASS);
      if (prev) prev.classList.remove(SELECTED_CLASS);
    });
    btn.classList.add(SELECTED_CLASS);
    _selIdx = cardIndex(btn);
    _selName = cardName(btn);
    refreshStart();
  }

  function reapplySelection(grid) {
    if (_selIdx == null || !grid) { refreshStart(); return; }
    var btns = [].slice.call(grid.querySelectorAll("button"));
    var match = null;
    for (var i = 0; i < btns.length; i++) { if (cardIndex(btns[i]) === _selIdx) { match = btns[i]; break; } }
    safe(function () {
      var prev = grid.querySelector("button." + SELECTED_CLASS);
      if (prev) prev.classList.remove(SELECTED_CLASS);
    });
    if (match) { match.classList.add(SELECTED_CLASS); if (!_selName) _selName = cardName(match); }
    refreshStart();
  }

  function claimGrid() {
    var grid = gid("mlsProtoGrid");
    if (!grid) return null;
    if (grid[CLAIM]) { reapplySelection(grid); return grid; }
    // clone once -> drops §70 auto-advance + §71 listeners; we become the sole owner
    var fresh = grid.cloneNode(true);
    fresh[CLAIM] = true;
    fresh.__ppfxRebound = true; // tell §71 to leave it alone
    // strip the wipe-trigger: inline _heroPickPatient on tap (records index instead)
    [].slice.call(fresh.querySelectorAll('button')).forEach(function (b) {
      var idx = cardIndex(b);
      if (idx >= 0) b.setAttribute("data-ezidx", String(idx));
      safe(function () { b.removeAttribute("onclick"); });
      safe(function () { b.onclick = null; });
    });
    if (grid.parentNode) grid.parentNode.replaceChild(fresh, grid);
    grid = fresh;
    grid.addEventListener("click", function (e) {
      var b = e.target && e.target.closest ? e.target.closest("button") : null;
      if (!b || !grid.contains(b)) return;
      safe(function () { e.preventDefault(); });
      selectCard(grid, b);
      setHint("");
    });
    reapplySelection(grid);
    return grid;
  }

  function claimStart() {
    var b = startBtn();
    if (!b) return null;
    if (b[CLAIM]) { refreshStart(); return b; }
    var fresh = b.cloneNode(true);
    fresh[CLAIM] = true;
    fresh.__ppfxRebound = true;     // tell §71 to leave it alone
    fresh.classList.add(BIG_CLASS);
    fresh.classList.remove("ez-link");
    if (b.parentNode) b.parentNode.replaceChild(fresh, b);
    fresh.addEventListener("click", function (e) {
      safe(function () { e.preventDefault(); });
      safe(function () { e.stopPropagation(); });
      advance();
    });
    refreshStart();
    return fresh;
  }

  var _healing = false;
  function claimPicker() {
    if (!pickerActive()) return;
    // self-heal: if the picker was wiped by a native re-render but we're still on it, remount
    if (!gid("mlsProtoGrid") || !startBtn()) {
      var s = easyState();
      if (s && s.step === 1 && s.mode !== "full" && !s.manual && !_healing) {
        _healing = true;
        safe(function () { if (window.__mlsProtocol && isFn(window.__mlsProtocol.enterSlide2)) window.__mlsProtocol.enterSlide2(); });
        _healing = false;
      }
    }
    claimGrid();
    claimStart();
  }

  // ---- advance to the record step for the selected patient + guarantee the textbox ----
  function advance() {
    if (_selIdx == null) { setHint("👆 Tap who you’re seeing first."); return; }
    var idx = _selIdx;
    // set the chosen patient active via the app's real path (also fills hero name)
    safe(function () { if (isFn(window._heroPickPatient)) window._heroPickPatient(idx); });
    // advance to record
    var advanced = false;
    safe(function () {
      if (window.__mlsProtocol && isFn(window.__mlsProtocol.goRecord)) { window.__mlsProtocol.goRecord(); advanced = true; }
    });
    if (!advanced) safe(function () {
      if (window.__mlsProtocol && isFn(window.__mlsProtocol.exitSlide2)) window.__mlsProtocol.exitSlide2();
      if (window.__mlsEasy && isFn(window.__mlsEasy.goto)) window.__mlsEasy.goto(2);
      else { var g = gid("ezGoRec"); if (g) safe(function () { g.click(); }); }
    });
    ensureTextbox();
  }

  // guarantee the §70 scratch textbox: wake its document.body observer until it injects
  function ensureTextbox() {
    var tries = 0;
    function nudge() {
      safe(function () {
        var m = document.createElement("span");
        m.setAttribute("data-mlsezpf-nudge", "1");
        m.style.cssText = "position:absolute;width:0;height:0;overflow:hidden;";
        document.body.appendChild(m);
        (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () { safe(function () { m.remove(); }); });
      });
    }
    function tick() {
      if (gid("mlsProtoScratch")) return;
      tries++;
      var s = easyState();
      if (s && s.step === 2) nudge();           // on the record step -> wake injectScratch
      if (tries < 30) setTimeout(tick, 120);    // ~3.6s of retries, then give up quietly
    }
    tick();
  }

  // document-level backup: if a click reaches a not-yet-claimed #mlsProtoStart, still advance
  var _lastAdvance = 0;
  function backupClick(e) {
    var t = e.target;
    var b = t && t.closest ? t.closest("#mlsProtoStart") : null;
    if (!b) return;
    if (b[CLAIM]) return;            // our own claimed handler will run
    if (b.hasAttribute("disabled")) return;
    if (_selIdx == null) return;
    var now = Date.now();
    if (now - _lastAdvance < 600) return;
    _lastAdvance = now;
    safe(function () { e.preventDefault(); });
    safe(function () { e.stopPropagation(); });
    advance();
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
    if (pickerActive()) { removeBigButton(); markStep(true); safe(claimPicker); return; }
    if (!onTargetStep()) {
      // left the step entirely -> clear selection so a stale pick can't leak forward
      var s = easyState();
      if (!s || s.step !== 1) { _selIdx = null; _selName = ""; }
      markStep(false);
      return;
    }
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
    safe(function () { document.addEventListener("click", backupClick, true); });
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
    safe(function () { document.removeEventListener("click", backupClick, true); });
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
    claimPicker: function () { safe(claimPicker); },
    selection: function () { return { idx: _selIdx, name: _selName }; },
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  } catch (e) { safe(start); }
})();
