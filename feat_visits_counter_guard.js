/* ============================================================================
   feat_visits_counter_guard.js  — kill the fabricated "Reading N of M" counter
   v1.0.0  (§50)
   ----------------------------------------------------------------------------
   PROBLEM it fixes: the "Copy every visit from athenaOne" button (and the
   injection-cohort per-visit capture) still streamed a fabricated
   "Reading visit N of M ..." counter on screen, even after §48
   (feat_visits_honest.js). Root cause: §48 wraps window.__mlsCopyVisits.run,
   but the Copy-every-visit BUTTON calls the module's INTERNAL run() closure
   directly  ->  run(function(m){ status.textContent = m; })  <-  and the
   cohort path calls the internal _driveRequest closure directly. Both bypass
   the window-level wrap, so the extension driver's optimistic progress
   string (event.data.message of an mlsAppVisitsProgress / mlsAppSearchProgress
   message) reaches the status element unfiltered.

   FIX: a single CAPTURE-PHASE window 'message' listener (installed at load,
   so it runs BEFORE driveRequest's own bubble-phase listener registers a read
   of event.data). For any per-visit progress event whose human-readable text
   looks like an optimistic enumerated counter ("N of M", "reading visit N",
   "visit N", "reading N"), it rewrites the text in place to a neutral,
   count-free status. The mutation is visible to every later listener because
   MessageEvent.data returns the same object reference. This covers ALL paths
   (button, window.__mlsCopyVisits.run, and the cohort capture) because they
   all consume the same progress message events.

   WHAT IT DOES NOT TOUCH:
   - The RESULT event (mlsAppAllVisitsResult) and its visits[] payload -> real
     visits still save and render normally.
   - Honest-failure / non-counter status text -> passed through unchanged.
   - The final "Saved N visits" message (emitted app-side from saveVisits via
     onStatus, NOT a progress message event) -> untouched, so the genuine
     saved count still shows at completion.

   Net effect: the live page NEVER shows a streamed "N of M" total. During the
   read it shows a neutral spinner; the only number the user ever sees is the
   real saved-visit count produced after real content is actually stored.

   Self-contained, idempotent, reversible via window.__mlsCounterGuard.revert().
   ========================================================================== */
(function () {
  try {
    if (window.__mlsCounterGuard && window.__mlsCounterGuard.installed) return;

    var PROGRESS_TYPES = { mlsAppVisitsProgress: 1, mlsAppSearchProgress: 1 };

    /* optimistic enumerated-counter patterns (NOT real saved-counts) */
    var FAKE = /(\b\d+\s*of\s*\d+\b)|(\breading\s+visit\s*\d+)|(\bvisit\s*\d+\b)|(\breading\s+\d+)/i;

    /* neutral, count-free status (magnifier + ellipsis, ASCII-escaped) */
    var NEUTRAL = '🔍 Reading your visits from athenaOne…';

    var TEXT_FIELDS = ['message', 'status', 'text', 'msg'];

    function looksOptimistic(s) {
      return typeof s === 'string' && s.length > 0 && FAKE.test(s);
    }

    function sanitize(d) {
      var hit = false, i;
      for (i = 0; i < TEXT_FIELDS.length; i++) {
        if (looksOptimistic(d[TEXT_FIELDS[i]])) { hit = true; break; }
      }
      if (!hit) return false;
      for (i = 0; i < TEXT_FIELDS.length; i++) {
        if (typeof d[TEXT_FIELDS[i]] === 'string') d[TEXT_FIELDS[i]] = '';
      }
      d.message = NEUTRAL;          /* first fallback driveRequest reads */
      d.__mlsCounterSanitized = true;
      return true;
    }

    function onMsg(e) {
      try {
        var d = e && e.data;
        if (!d || typeof d !== 'object') return;
        if (!PROGRESS_TYPES[d.type]) return;
        sanitize(d);
      } catch (_) {}
    }

    /* capture phase => runs before driveRequest's listener consumes the event */
    window.addEventListener('message', onMsg, true);

    window.__mlsCounterGuard = {
      installed: true,
      version: '1.0.0',
      _fake: FAKE,
      /* exposed so other modules / tests can reuse the same judgement */
      isOptimistic: looksOptimistic,
      sanitizeText: function (s) { return looksOptimistic(s) ? NEUTRAL : s; },
      revert: function () {
        try { window.removeEventListener('message', onMsg, true); } catch (_) {}
        try { delete window.__mlsCounterGuard; }
        catch (_) { window.__mlsCounterGuard = undefined; }
      }
    };
  } catch (e) { /* never break the app */ }
})();
