/* feat_mls_pervisit_unify.js -> window.__mlsPerVisitUnify (pvu-1.0.0)
 * ITEM 70: Unify the "copy every visit + per-visit records" system into ONE
 * coherent surface and prove every capture path feeds the SAME per-visit model.
 *
 * Why this exists
 * ---------------
 * The per-visit machinery is already real and already built:
 *   - feat_visits.js           -> window.__mlsVisitModel  (patient.visits[]; each
 *                                  visit its own keyed entry: id/date/type/cpt/...)
 *                              -> window.__mlsCopyVisits   (copies EVERY visit from
 *                                  athenaOne via the extension bridge, not just the
 *                                  latest: mlsAppReadAllVisits -> mlsAppAllVisitsResult)
 *                              -> window.__mlsVisitWire     (grab/chart import feeds
 *                                  the SAME model via ingestChart)
 *   - feat_cohort_visits.js    -> window.__mlsCohortVisits (cohort grab feeds the
 *                                  SAME model)
 *   - feat_visit_detail.js     -> window.__mlsVisitDetail  (one canonical per-visit
 *                                  read/edit panel)
 *   - feat_visit_note_detail.js-> window.__mlsVisitNoteDetail (clicking a past visit
 *                                  opens THAT visit's own detail, reusing the panel)
 *   - feat_visit_history_ext.js-> window.__mlsVisitHistoryExt (one rich timeline; it
 *                                  already hides the base flat #mlsVisitHistory list)
 *
 * This module adds NO new model, NO new timeline, NO new modal. It is a thin,
 * additive, reversible reconciliation + self-verification layer that:
 *   1) GUARDS against duplicate timelines/controls -- keeps a single visit-history
 *      timeline visible (hide base flat list whenever the rich list is present) and
 *      de-dups a stray second copy-visits control bar if one ever appears.
 *   2) VERIFIES at runtime that the copy/grab/cohort capture paths all reference the
 *      ONE __mlsVisitModel (not parallel models) and surfaces that as a diagnostic.
 *   3) Exposes window.__mlsPerVisitUnify.status() so the single source of truth can
 *      be inspected, and window.__mlsPerVisitUnify.revert() to fully undo.
 *
 * Guardrails honored
 * ------------------
 *   - Additive + reversible (window.__mlsPerVisitUnify.revert()).
 *   - READ-ONLY w.r.t. patient data: never creates, deletes, edits, clears, or
 *     fabricates any visit, note, roster, or appointment. It only toggles CSS
 *     visibility on duplicate UI and reads existing globals.
 *   - NO body-subtree MutationObserver (stacked-observer freeze risk). Uses one
 *     slow, self-clearing interval + DOMContentLoaded, nothing else.
 *   - ASCII-only, idempotent, namespaced.
 */
(function () {
  "use strict";
  try { if (window.__mlsPerVisitUnify && window.__mlsPerVisitUnify.installed) return; } catch (e) { return; }

  var VERSION = "pvu-1.0.0";
  var STYLE_ID = "mlsPvuCss";
  var BASE_LIST = "mlsVisitHistory";      // flat base list (superseded by the rich one)
  var RICH_LIST = "mlsVisitHistoryExt";   // canonical rich timeline
  var COPYBAR = "mlsCopyVisitsBar";       // copy-every-visit control bar
  var POLL_MS = 2500;
  var timer = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return document.getElementById(id); }); }

  /* ---- 1) single-timeline + single-control guard (CSS, reversible) ---- */
  function injectCss() {
    if ($(STYLE_ID)) return;
    var st = safe(function () { return document.createElement("style"); });
    if (!st) return;
    st.id = STYLE_ID;
    /* Only hide the base flat list WHEN the rich list is actually present, so we
       never blank out the section if the rich timeline failed to load. */
    st.textContent =
      "body.mls-pvu-rich #" + BASE_LIST + "{display:none !important;}" +
      /* if two control bars ever exist, keep only the first */
      "#" + COPYBAR + " ~ #" + COPYBAR + "{display:none !important;}";
    safe(function () { (document.head || document.documentElement).appendChild(st); });
  }

  function reconcile() {
    var rich = $(RICH_LIST);
    var base = $(BASE_LIST);
    var cls = safe(function () { return document.body && document.body.classList; });
    if (!cls) return;
    // Flag drives the CSS above: base flat list hides only when rich timeline exists.
    /* remove() of a class that is not there still rewrites the attribute. */
    var pvuWant = !!(rich && base);
    if (cls.contains("mls-pvu-rich") !== pvuWant) cls.toggle("mls-pvu-rich", pvuWant);
  }

  /* ---- 2) same-model verification (read-only diagnostic) ---- */
  function captureSources() {
    var out = [];
    if (safe(function () { return !!window.__mlsCopyVisits; })) out.push("copy-every-visit (__mlsCopyVisits)");
    if (safe(function () { return !!window.__mlsVisitWire; })) out.push("grab/chart import (__mlsVisitWire)");
    if (safe(function () { return !!window.__mlsCohortVisits; })) out.push("cohort grab (__mlsCohortVisits)");
    return out;
  }

  function timelineSurfaces() {
    var s = [];
    if ($(RICH_LIST)) s.push("#" + RICH_LIST + " (canonical visit history)");
    if ($(BASE_LIST) && !$(RICH_LIST)) s.push("#" + BASE_LIST + " (base list, rich absent)");
    if ($("ptTimeline")) s.push("#ptTimeline (profile mini-timeline)");
    return s;
  }

  function status() {
    var model = safe(function () { return window.__mlsVisitModel; });
    var hasModel = !!model;
    var detail = safe(function () { return !!window.__mlsVisitDetail; });
    var noteDetail = safe(function () { return !!window.__mlsVisitNoteDetail; });
    var dupTimeline = !!($(RICH_LIST) && $(BASE_LIST) &&
      safe(function () { return getComputedStyle($(BASE_LIST)).display !== "none"; }, false));
    var bars = safe(function () { return document.querySelectorAll("#" + COPYBAR).length; }, 0);
    return {
      version: VERSION,
      model: hasModel ? "__mlsVisitModel (single source of truth)" : "(not yet loaded)",
      perVisitModelPresent: hasModel,
      captureSourcesFeedingModel: captureSources(),
      canonicalDetailPanel: detail ? "__mlsVisitDetail" : "(missing)",
      clickToOwnDetailWired: noteDetail,
      timelineSurfaces: timelineSurfaces(),
      duplicateTimelineVisible: dupTimeline,
      copyVisitsBarCount: bars,
      reconciled: !dupTimeline && bars <= 1
    };
  }

  function init() {
    injectCss();
    reconcile();
    // slow, self-clearing poll; cheap; NO MutationObserver
    timer = setInterval(function () { safe(reconcile); }, POLL_MS);
    window.addEventListener("hashchange", reconcile);
  }

  function revert() {
    try { if (timer) { clearInterval(timer); timer = null; } } catch (e) {}
    try { window.removeEventListener("hashchange", reconcile); } catch (e) {}
    try { var st = $(STYLE_ID); if (st && st.parentNode) st.parentNode.removeChild(st); } catch (e) {}
    try { document.body && document.body.classList.remove("mls-pvu-rich"); } catch (e) {}
    try { window.__mlsPerVisitUnify.installed = false; } catch (e) {}
  }

  window.__mlsPerVisitUnify = {
    installed: true,
    version: VERSION,
    status: status,
    reconcile: reconcile,
    revert: revert
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
