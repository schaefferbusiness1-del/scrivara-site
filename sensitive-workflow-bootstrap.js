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

  window.mlsSensitiveFetch = function (input, init) {
    var options = {};
    Object.keys(init || {}).forEach(function (key) { options[key] = init[key]; });
    options.cache = 'no-store';
    options.referrerPolicy = 'no-referrer';
    return window.fetch.call(window, input, options);
  };
})();
