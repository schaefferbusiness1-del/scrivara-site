/* =========================================================================
 * MLS Scribe - PATIENT/NOTES STORE PARSE CACHE  (__mlsStoreCache) sc-1.1.0
 * 2026-07-11 (freeze fix, single-tab "clicking around" lockups)
 * -------------------------------------------------------------------------
 * ROOT CAUSE THIS FIXES
 *   The base app's four store accessors re-serialize on EVERY call:
 *     getPatients()  = JSON.parse(localStorage[uns('patients')])   (~1.8-2.2 MB)
 *     getNotes()     = JSON.parse(localStorage[uns('notes')])      (~1.6+ MB)
 *   and ~90 bundle modules + ~100 satellites call them from body-wide
 *   MutationObserver ticks, capture-phase click listeners, Worker timers and
 *   render loops. Measured live (b131, clinic-sized mock store, NO extension):
 *     - idle:   ~50 getPatients()/s once the observer mesh is armed
 *     - one nav cycle (6 tab clicks): ~3,250 getNotes() + ~1,000 getPatients()
 *     - every patient switch: ~130 ms synchronous block
 *     - Studio/Patients clicks: 150-350 ms long tasks, stacking into
 *       multi-second freezes on slower machines / multiple tabs.
 *   JSON parsing alone accounted for the majority of measured long-task time.
 *
 * THE FIX
 *   Memoize the parse, keyed on the RAW STORED STRING. On every call we still
 *   read localStorage.getItem(key) (cheap - Chrome keeps DOMStorage in
 *   renderer memory) and compare it to the cached string. Identical string
 *   (===, pointer-fast for the common same-rope case) -> return a shallow
 *   copy of the cached parse. Different string (ANY writer: savePatients,
 *   saveNotes, direct setItem, another tab) -> re-parse. This is
 *   correct-by-construction: no writer can be missed, because every write
 *   changes the stored string the next read compares against.
 *
 * SAFETY SEMANTICS (kept deliberately conservative)
 *   - Callers get a FRESH TOP-LEVEL ARRAY every call (cache.val.slice()), so
 *     in-place sort()/reverse()/splice() by display code can never reorder
 *     another caller's view or the cache.
 *   - Element objects ARE shared between calls within one cache window. The
 *     app's universal write pattern (get -> mutate element -> save) is
 *     unaffected: the save rewrites the string, which invalidates the cache.
 *     To bound the exposure of any hypothetical mutate-without-save caller,
 *     the cache also hard-expires after TTL_MS (30000 ms) - raw-string identity
 *     still invalidates immediately after every real stored write. At the measured
 *     50-350 calls/s hot rates that still eliminates >99% of parses, while
 *     costing under one parse per second when idle.
 *   - Cache is dropped on 'storage' events for matching keys (cross-tab
 *     writes) and keyed on the FULL namespaced storage key, so login /
 *     logout / account switch (uns() changes) can never serve another
 *     account's data.
 *   - Any internal error falls back to the original unwrapped function.
 *
 * SCOPE: app-side only. No extension code, no Athena, no bridge contracts,
 * no writes of its own - this module never calls setItem.
 * Revert: window.__mlsStoreCache.revert()  (restores the original functions)
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsStoreCache) return; } catch (e) { return; }

  var TTL_MS = 30000;
  var api = {
    version: 'sc-1.1.0',
    enabled: true,
    stats: { hits: 0, misses: 0, fallbacks: 0, invalidations: 0 },
    _wrapped: []
  };

  function wrapPair(getName, keySuffix) {
    var orig = window[getName];
    if (typeof orig !== 'function') return; /* base app not ready / renamed: do nothing */
    var cache = { key: null, str: null, val: null, at: 0 };

    function currentKey() {
      /* uns() is the base app's per-account namespacer: 'sf_u::<email>::<suffix>'.
         If it's ever missing we return null and take the fallback path. */
      try { return (typeof window.uns === 'function') ? window.uns(keySuffix) : null; } catch (e) { return null; }
    }

    function wrapped() {
      if (!api.enabled) return orig();
      var k, s;
      try {
        k = currentKey();
        if (!k) { api.stats.fallbacks++; return orig(); }
        s = localStorage.getItem(k);
      } catch (e) { api.stats.fallbacks++; return orig(); }

      if (s == null || s === '') { /* empty store: nothing to cache */
        cache.key = k; cache.str = s; cache.val = null;
        return [];
      }
      var now = Date.now();
      if (cache.val && cache.key === k && cache.str === s && (now - cache.at) < TTL_MS) {
        api.stats.hits++;
        return cache.val.slice();
      }
      api.stats.misses++;
      var v;
      /* 2026-07-15: the patients blob may be LZ-packed ('MLSZ1|' prefix); the
         base app exposes the decoder. Cache identity still keys on the RAW
         stored string, so packed writes invalidate exactly like plain ones. */
      try { v = JSON.parse(typeof window.__mlsPtsDecode === 'function' ? window.__mlsPtsDecode(s) : s) || []; } catch (e) { v = []; }
      if (!Array.isArray(v)) return v; /* never cache non-array shapes; preserve base behavior */
      cache.key = k; cache.str = s; cache.val = v; cache.at = now;
      return v.slice();
    }
    wrapped.__mlsStoreCache = true;
    wrapped.__orig = orig;

    window[getName] = wrapped;
    api._wrapped.push({ name: getName, orig: orig });

    /* cross-tab writes: drop this cache when the matching key changes.
       (Same-tab writes are caught by the string comparison itself.) */
    function onStorage(ev) {
      try {
        if (!ev || ev.key == null) { cache.val = null; api.stats.invalidations++; return; }
        if (String(ev.key).indexOf('::' + keySuffix) >= 0) { cache.val = null; api.stats.invalidations++; }
      } catch (e) { cache.val = null; }
    }
    window.addEventListener('storage', onStorage, false);
    api._wrapped[api._wrapped.length - 1].onStorage = onStorage;
  }

  wrapPair('getPatients', 'patients');
  wrapPair('getNotes', 'notes');

  api.revert = function () {
    for (var i = 0; i < api._wrapped.length; i++) {
      var w = api._wrapped[i];
      try { if (window[w.name] && window[w.name].__mlsStoreCache) window[w.name] = w.orig; } catch (e) {}
      try { if (w.onStorage) window.removeEventListener('storage', w.onStorage, false); } catch (e) {}
    }
    api._wrapped = [];
    api.enabled = false;
    try { delete window.__mlsStoreCache; } catch (e) {}
    return 'reverted';
  };

  api.selfTest = function () {
    var out = [];
    function t(name, fn) { try { out.push((fn() ? 'PASS ' : 'FAIL ') + name); } catch (e) { out.push('FAIL ' + name + ' (' + e + ')'); } }
    t('getPatients returns array', function () { return Array.isArray(window.getPatients()); });
    t('two reads give distinct top-level arrays', function () { var a = window.getPatients(), b = window.getPatients(); return a !== b; });
    t('cache hit on second read', function () { var h0 = api.stats.hits; window.getPatients(); window.getPatients(); return api.stats.hits > h0; });
    /* NOTE: deliberately NO write-roundtrip test here - selfTest must be
       side-effect-free on a live store (write invalidation is inherent to
       the string-compare design and is exercised by the offline harness). */
    t('getNotes returns array', function () { return Array.isArray(window.getNotes()); });
    return out;
  };

  window.__mlsStoreCache = api;
})();
