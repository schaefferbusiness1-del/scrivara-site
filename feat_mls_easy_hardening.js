/* feat_mls_easy_hardening.js  ->  window.__mlsEasyHarden  (v1.0.0)
 *
 * Smoothness/anti-glitch hardening for the ENTIRE MLS Easy flow (steps 1-5).
 * Additive, reversible, and composes with -- never edits -- the existing modules:
 *   - feat_mls_centerpiece.js  (S67, __mlsCenterpiece)  -- Step 1 pulls + walk
 *   - feat_mls_protocol.js     (S70, __mlsProtocol)     -- the step machine
 *   - feat_mls_protocol_pickfix.js (S71, __mlsProtoPickFix)
 *   - feat_mls_easy_pickfix.js (S71/S75 v1.2.0, __mlsEasyPickFix) -- the picker
 *
 * ===================================================================
 *  WHY (the real, audited glitch engine -- proven by reading the code)
 * ===================================================================
 * All three modules above keep their injected UI alive with a MutationObserver
 * scoped `{childList:true, subtree:true}` plus a slow poll. Each observer fires
 * on EVERY childList change anywhere in the subtree -- including the changes the
 * modules make THEMSELVES. Three re-render paths rewrite identical DOM on every
 * tick, and because each rewrite is a *childList* mutation it re-wakes every
 * module's observer, producing a continuous ~60fps idle re-render loop (the
 * exact S44/S55 "idle mutations / render loop" failure class) and the visible
 * flicker / re-injection churn / dropped clicks Michael reported:
 *
 *   1. STEP 1  centerpiece refreshActing():  `#mlscpActing` (the "Working on:"
 *      banner) is REPLACED via node.replaceWith(freshNode) on every observer
 *      tick + every 1.5s poll, even when the content is byte-identical. The
 *      replaceWith is a childList mutation -> re-triggers all observers ->
 *      loops; also drops hover/focus on the banner each frame.
 *
 *   2. STEP 1  centerpiece renderWalkStrip():  `#mlscpWalk` (Today's-patients
 *      Prev/Open/Next strip) is rebuilt via `existing.outerHTML = html` every
 *      tick while a walk is active, even when identical -> recreates the three
 *      buttons every frame (a click can land on a button about to be destroyed)
 *      -> loops.
 *
 *   3. STEP 2 (picker)  pickfix refreshStart():  `#mlsProtoStart.textContent`
 *      is written every `apply` tick while on the picker, even when unchanged.
 *      Writing textContent replaces the button's child text node -> a childList
 *      mutation -> re-wakes the picker's own childList observer -> loops.
 *      (reapplySelection's class/aria churn are *attribute* mutations and do
 *      NOT feed the childList-only observers, so they do not loop -- confirmed.)
 *
 * Steps 3 (record + scratch textbox), 4 (generate/review) and 5 (write-to-chart,
 * after-visit summary, submit checklist) inject render-once, id-guarded elements
 * (injectScratch/injectFinishTail return early when their node already exists),
 * so they do NOT emit steady-state childList churn and need no change. Protocol
 * S70's provider-name sync is already pick-change-gated. This module leaves all
 * of that -- and the entire proven S71/S75 picker behaviour (no auto-pick,
 * selection-survives-re-render, self-heal, one big button) -- untouched.
 *
 * ===================================================================
 *  WHAT (the fix: signature-gated, idempotent, no-op-skipping writes)
 * ===================================================================
 * For each of the three churny nodes we install an INSTANCE-LEVEL, signature-
 * gated guard on exactly the one write API that module uses on it:
 *   - `#mlscpActing`     -> guard replaceWith  (skip if new node === current)
 *   - `#mlscpWalk`       -> guard outerHTML set (skip if normalised html equal)
 *   - `#mlsProtoStart`   -> guard textContent set (skip if string equal)
 * "Skip" means: when the incoming content is identical to what is already on
 * screen, the write is suppressed -> NO childList mutation is emitted -> the
 * idle loop dies and the steady state is genuinely quiet (0 idle mutations).
 * When the content GENUINELY changes (new patient, walk index, selection name)
 * the write proceeds normally and the guard re-arms on the replacement node, so
 * every real update still renders exactly once. Behaviour is preserved; only
 * redundant identical re-renders are removed.
 *
 * The guards are re-armed on the live instances by our own LOW-COST watcher
 * (a childList observer + 1s poll). Re-arming only DEFINES instance properties
 * (no DOM writes), so the watcher itself never emits a mutation and never loops.
 *
 * SAFETY: own IIFE; idempotent (won't double-install); every hook in try/catch
 * with a hard fallback to the ORIGINAL native behaviour, so a guard can never
 * block a real update or break the flow (worst case it is a no-op). Sends
 * NOTHING to the extension; never clicks Save/Sign/Submit; never writes a chart;
 * read-only on clinical data. ASCII-only; NUL-free; no PHI. Fully reversible:
 * window.__mlsEasyHarden.revert() restores every native property and stops the
 * watcher. Nothing here changes layout, copy, colours, or any visible element --
 * it only removes redundant identical re-renders.
 */
;(function () {
  "use strict";
  try { if (window.__mlsEasyHarden && window.__mlsEasyHarden.installed) return; } catch (e) { return; }

  var VERSION = "1.0.0";
  var ASSET = "feat_mls_easy_hardening.js";

  // ---------------- tiny safe helpers ----------------
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function isEl(n) { return !!(n && n.nodeType === 1); }

  // counters so live verification can prove the loops are gone
  var stats = { armed: 0, skippedReplace: 0, skippedOuter: 0, skippedText: 0, passedReplace: 0, passedOuter: 0, passedText: 0 };

  // normalise an HTML/outerHTML string to a stable signature (collapse whitespace)
  function norm(s) { return String(s == null ? "" : s).replace(/\s+/g, " ").trim(); }
  function sigOuter(el) { return safe(function () { return norm(el.outerHTML); }, ""); }

  // native accessors captured once (instance overrides delegate to these)
  var OUTER_DESC = safe(function () { return Object.getOwnPropertyDescriptor(Element.prototype, "outerHTML"); }, null);
  var TEXT_DESC = safe(function () { return Object.getOwnPropertyDescriptor(Node.prototype, "textContent"); }, null);
  var NATIVE_REPLACE_WITH = safe(function () { return Element.prototype.replaceWith; }, null);

  // ============================================================
  //  GUARD 1 -- replaceWith (centerpiece "Working on:" banner)
  //    Skip when the replacement node renders identically.
  // ============================================================
  function guardReplaceWith(el) {
    if (!isEl(el) || el.__hardRW || !NATIVE_REPLACE_WITH) return;
    try {
      Object.defineProperty(el, "__hardRW", { value: true, configurable: true });
      Object.defineProperty(el, "replaceWith", {
        configurable: true, writable: true,
        value: function () {
          var args = arguments, self = this;
          var nn = args[0];
          if (isEl(nn) && args.length === 1) {
            // identical re-render -> suppress (no childList mutation emitted)
            if (sigOuter(nn) === sigOuter(self)) { stats.skippedReplace++; return; }
          }
          stats.passedReplace++;
          var r = safe(function () { return NATIVE_REPLACE_WITH.apply(self, args); });
          // re-arm on the node that took our place (same id, real content change)
          safe(function () { if (isEl(nn)) guardReplaceWith(nn); });
          return r;
        }
      });
      stats.armed++;
    } catch (e) {}
  }
  function unguardReplaceWith(el) {
    safe(function () { if (el && el.__hardRW) { delete el.replaceWith; delete el.__hardRW; } });
  }

  // ============================================================
  //  GUARD 2 -- outerHTML setter (centerpiece walk strip #mlscpWalk)
  //    Skip when the new html normalises to the current outerHTML.
  // ============================================================
  function guardOuterHTML(el) {
    if (!isEl(el) || el.__hardOH || !OUTER_DESC || !OUTER_DESC.set) return;
    try {
      Object.defineProperty(el, "__hardOH", { value: true, configurable: true });
      Object.defineProperty(el, "outerHTML", {
        configurable: true,
        get: function () { return OUTER_DESC.get.call(this); },
        set: function (v) {
          var self = this, id = self.id;
          var cur = safe(function () { return OUTER_DESC.get.call(self); }, "");
          if (norm(v) === norm(cur)) { stats.skippedOuter++; return; }
          stats.passedOuter++;
          safe(function () { OUTER_DESC.set.call(self, v); });
          // outerHTML set detaches `self`; re-find the replacement by id + re-arm
          safe(function () { if (id) { var nn = gid(id); if (nn) guardOuterHTML(nn); } });
        }
      });
      stats.armed++;
    } catch (e) {}
  }
  function unguardOuterHTML(el) {
    safe(function () { if (el && el.__hardOH) { delete el.outerHTML; delete el.__hardOH; } });
  }

  // ============================================================
  //  GUARD 3 -- textContent setter (picker start button #mlsProtoStart)
  //    Skip when the same string is written again.
  // ============================================================
  function guardTextContent(el) {
    if (!isEl(el) || el.__hardTC || !TEXT_DESC || !TEXT_DESC.set) return;
    try {
      Object.defineProperty(el, "__hardTC", { value: true, configurable: true });
      Object.defineProperty(el, "textContent", {
        configurable: true,
        get: function () { return TEXT_DESC.get.call(this); },
        set: function (v) {
          var self = this;
          var cur = safe(function () { return TEXT_DESC.get.call(self); }, null);
          if (String(v) === String(cur)) { stats.skippedText++; return; }
          stats.passedText++;
          safe(function () { TEXT_DESC.set.call(self, v); });
        }
      });
      stats.armed++;
    } catch (e) {}
  }
  function unguardTextContent(el) {
    safe(function () { if (el && el.__hardTC) { delete el.textContent; delete el.__hardTC; } });
  }

  // ============================================================
  //  re-arm the guards on whatever live instances exist right now
  //  (these calls only DEFINE instance props -> emit no DOM mutation)
  // ============================================================
  function arm() {
    guardReplaceWith(gid("mlscpActing"));
    guardOuterHTML(gid("mlscpWalk"));
    guardTextContent(gid("mlsProtoStart"));
  }

  // ============================================================
  //  low-cost watcher: re-arm when nodes are (re)created/cloned.
  //  childList observer (debounced) + a slow poll. No DOM writes here.
  // ============================================================
  var _obs = null, _poll = null, _raf = 0, _reverted = false;
  function schedule() {
    if (_raf || _reverted) return;
    _raf = (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(function () {
      _raf = 0; if (!_reverted) safe(arm);
    });
  }
  function start() {
    safe(arm);
    safe(function () {
      _obs = new MutationObserver(function () { if (!_reverted) schedule(); });
      _obs.observe(document.documentElement, { childList: true, subtree: true });
    });
    _poll = setInterval(function () { if (!_reverted) safe(arm); }, 1000);
  }

  // ============================================================
  //  revert -- restore every native property, stop the watcher
  // ============================================================
  function revert() {
    _reverted = true;
    safe(function () { if (_obs) _obs.disconnect(); });
    safe(function () { if (_poll) clearInterval(_poll); });
    // restore any node we may currently hold a guard on
    unguardReplaceWith(gid("mlscpActing"));
    unguardOuterHTML(gid("mlscpWalk"));
    unguardTextContent(gid("mlsProtoStart"));
    safe(function () { window.__mlsEasyHarden.installed = false; });
    return true;
  }

  // ============================================================
  //  public API (also used by the offline jsdom tests)
  // ============================================================
  window.__mlsEasyHarden = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    arm: function () { safe(arm); },
    stats: function () { var o = {}; for (var k in stats) if (stats.hasOwnProperty(k)) o[k] = stats[k]; return o; },
    // exposed for tests/diagnostics (operate on a given element)
    _guardReplaceWith: guardReplaceWith,
    _guardOuterHTML: guardOuterHTML,
    _guardTextContent: guardTextContent,
    revert: revert
  };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
  } catch (e) { safe(start); }
})();
