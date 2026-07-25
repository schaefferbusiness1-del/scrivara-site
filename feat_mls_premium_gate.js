/* feat_mls_premium_gate.js -> window.__mlsPremiumGate (pmg-1.0.0)
 *
 * pmg-1.0.1: this told the doctor to "upgrade to Premium in Settings".
 * Settings has no upgrade control - measured on the running page at b600:
 * the settings modal holds 12,935 characters of text, the word "upgrade"
 * does not appear in it once, and a scan of every button, link and select
 * inside it for upgrade/plan/premium/billing returns ZERO controls. So the
 * one message a blocked doctor is given pointed at a dead end.
 * The app DOES have a working route - showUpsell() in mls-connect.js opens
 * an overlay linking to /index.html#pricing - but it is module-local and
 * not exported (window.__mlsShowUpsell is undefined), so this module cannot
 * call it. Naming the destination is the honest fix available here; wiring
 * the toast to that overlay needs the export and belongs with that module.
 *
 * Plan levels now match their labels. Pay Reports and Reviews & reputation
 * carried PREMIUM badges but never checked the plan, so Lite and Standard
 * accounts could open them anyway. This satellite closes that gap in the UI
 * (the backend premiumGate now also refuses /api/payreport and /api/reviews
 * server-side, so this is the friendly layer, not the enforcement layer).
 *
 * Rules:
 *  - Signed-in account with Premium or the owner/admin flag: nothing changes.
 *  - Signed-in Lite/Standard: clicking a Pay Report or Reviews control shows
 *    an upgrade toast instead of opening the tool. Everything else is
 *    untouched — all non-premium features keep working.
 *  - Not signed in / demo (`bkUser` absent): nothing is blocked, so demos and
 *    the logged-out tour keep showing the full product.
 *
 * Base-app state is read as typeof-guarded BARE identifiers (bkUser,
 * effectivePremium, toast are script-scope globals of ScribeFlow.html).
 */
;(function () {
  "use strict";
  var NS = "__mlsPremiumGate", VERSION = "pmg-1.1.0";
  try { if (window[NS] && window[NS].installed) return; } catch (e) { return; }

  var disposed = false, lastToast = 0;

  function safe(fn, fb) { try { return fn(); } catch (e) { return fb; } }
  function signedInNonPremium() {
    return safe(function () {
      if (typeof bkUser === "undefined" || !bkUser) return false;   // demo / logged out: never block
      if (typeof effectivePremium !== "function") return false;
      return !effectivePremium();
    }, false);
  }
  function upsell(featureName) {
    var now = Date.now();
    if (now - lastToast < 1200) return;
    lastToast = now;
    safe(function () {
      if (typeof toast === "function") toast(featureName + " is a Premium feature. Your plan keeps everything else — see plans on the MLS home page to upgrade.", "err");
    });
  }

  /* A control counts as a gated opener by id or by its own visible label —
     robust to the several re-homed copies of these buttons.
     pmg-1.1.0 adds the Visit-view widget-deck builder openers: the deck lives
     OUTSIDE #studioView, so the Studio premium lock never covered it, and
     /api/widget/* is premium-only server-side — a Standard account reached a
     builder whose generate step could only 403. Same friendly-layer rule:
     signed-in non-premium only; demo/logged-out never blocked. */
  var PAY_IDS = { mlsCompBtn: 1, mlsPrvbBtn: 1 };
  var REV_IDS = { ez3sReviews: 1, mlsPtab_reviews: 1 };
  var WIDGET_IDS = { mlsWdNew: 1, mlsWdStudio: 1 };
  function gateTarget(el) {
    var b = el && el.closest ? el.closest("button, [role=button], .navtab, a") : null;
    if (!b) return "";
    var id = String(b.id || "");
    if (PAY_IDS[id]) return "Pay Report";
    if (REV_IDS[id]) return "Reviews & reputation";
    if (WIDGET_IDS[id]) return "The custom widget builder";
    var t = String(b.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
    if (t.length > 60) return "";
    if (/pay report/.test(t)) return "Pay Report";
    if (/reviews\s*&\s*reputation/.test(t)) return "Reviews & reputation";
    return "";
  }

  function onClick(ev) {
    if (disposed) return;
    var what = gateTarget(ev && ev.target);
    if (!what) return;
    if (!signedInNonPremium()) return;
    ev.preventDefault();
    ev.stopImmediatePropagation ? ev.stopImmediatePropagation() : ev.stopPropagation();
    upsell(what);
  }

  function boot() {
    if (disposed) return;
    safe(function () { document.addEventListener("click", onClick, true); });
  }

  var api = {
    installed: true, version: VERSION,
    _test: { gateTarget: gateTarget, signedInNonPremium: signedInNonPremium },
    revert: function () {
      disposed = true;
      safe(function () { document.removeEventListener("click", onClick, true); });
      try { delete window[NS]; } catch (e) { window[NS] = null; }
    }
  };
  window[NS] = api;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true }); else boot();
})();
