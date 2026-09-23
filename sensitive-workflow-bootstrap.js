/* MLS sensitive public-workflow boundary.
 * Runs synchronously in <head>: captures only the configured one-time URL
 * values, removes them from the address bar/history, and provides a fetch
 * wrapper that never caches or emits a Referer header. */
(function () {
  'use strict';
  var script = document.currentScript;
  var data = (script && script.dataset) || {};
  var queryKeys = String(data.queryKeys || '').split(/\s+/).filter(Boolean);
  var fragmentKeys = String(data.fragmentKeys || '').split(/\s+/).filter(Boolean);
  var captured = { query: Object.create(null), fragment: Object.create(null) };

  function captureAndDelete(params, keys, bucket) {
    var changed = false;
    keys.forEach(function (key) {
      if (!params.has(key)) return;
      bucket[key] = params.get(key) || '';
      params.delete(key);
      changed = true;
    });
    return changed;
  }

  try {
    var url = new URL(window.location.href);
    var queryChanged = captureAndDelete(url.searchParams, queryKeys, captured.query);
    if (data.scrubQuery === 'all') url.search = '';
    else if (queryChanged) {
      var safeQuery = url.searchParams.toString();
      url.search = safeQuery ? '?' + safeQuery : '';
    }

    var rawFragment = String(url.hash || '').replace(/^#/, '');
    if (rawFragment) {
      var fragmentParams = new URLSearchParams(rawFragment);
      var fragmentChanged = captureAndDelete(fragmentParams, fragmentKeys, captured.fragment);
      if (data.scrubFragment === 'all') url.hash = '';
      else if (fragmentChanged) {
        var safeFragment = fragmentParams.toString();
        url.hash = safeFragment ? '#' + safeFragment : '';
      }
    }

    var clean = url.pathname + url.search + url.hash;
    var current = window.location.pathname + window.location.search + window.location.hash;
    if (clean !== current) window.history.replaceState(null, '', clean);
  } catch (_) {
    /* Downstream code treats missing captured values as an invalid link. */
  }

  captured.query = Object.freeze(captured.query);
  captured.fragment = Object.freeze(captured.fragment);
  window.__mlsSensitiveUrl = Object.freeze(captured);

  /* portalfix-1.0.0 (2026-09-23): fetch has no timeout of its own, so a backend
   * that never answered (a cold start that stalls, a proxy holding the socket)
   * left intake, booking and appointment on "Loading..." with no button, for
   * good. A read (GET/HEAD) now gives up after 45 s - long enough for the
   * backend host's cold start (30-60 s), which used to succeed on the first
   * try and must keep doing so - the timer also covers
   * reading the body - and rejects like a lost connection, which every page
   * already turns into its "could not reach the office / Try again" state.
   * A write keeps waiting unless the caller sets init.timeoutMs (0 = no limit):
   * an op-note rewrite can legitimately run longer, and abandoning a booking
   * that did land would invite a duplicate. A caller's own init.signal still
   * cancels the request. */
  var READ_TIMEOUT_MS = 45000;
  window.mlsSensitiveFetch = function (input, init) {
    var options = {};
    Object.keys(init || {}).forEach(function (key) { options[key] = init[key]; });
    var method = String(options.method || (input && typeof input === 'object' && input.method) || 'GET').toUpperCase();
    var timeoutMs = ('timeoutMs' in options) ? Number(options.timeoutMs)
      : ((method === 'GET' || method === 'HEAD') ? READ_TIMEOUT_MS : 0);
    delete options.timeoutMs;
    options.cache = 'no-store';
    options.referrerPolicy = 'no-referrer';
    var later = window.setTimeout, Controller = window.AbortController;
    if (!(timeoutMs > 0) || typeof later !== 'function' || typeof Controller !== 'function') {
      return window.fetch.call(window, input, options);
    }
    var controller = new Controller(), callerSignal = options.signal;
    if (callerSignal) {
      if (callerSignal.aborted) controller.abort(callerSignal.reason);
      else if (callerSignal.addEventListener) callerSignal.addEventListener('abort', function () { controller.abort(callerSignal.reason); });
    }
    options.signal = controller.signal;
    later.call(window, function () {
      var reason;
      try { reason = new DOMException('The request took too long.', 'TimeoutError'); } catch (_) { reason = undefined; }
      controller.abort(reason);
    }, timeoutMs);
    return window.fetch.call(window, input, options);
  };
})();
