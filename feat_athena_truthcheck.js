/*! feat_athena_truthcheck.js -> window.__mlsAthenaTruthCheck (v1.0.0)
 *
 * Compatibility hardener for Athena readiness. Older versions sampled a
 * schedule reply and inspected its URL host to reject arbitrary-tab false
 * positives. A status check must never request clinical data, so this version
 * uses only mlsExtHealth operational metadata:
 *   - extension worker answered
 *   - exact athenaOne product-tab count
 *   - discarded-tab count
 *
 * `connected` remains an internal compatibility state. In user-facing terms it
 * means only "MLS Assist ready; usable Athena tab detected." It never means
 * signed in, chart readable, or that a patient/encounter was verified.
 */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W) return;
  if (W.__mlsAthenaTruthCheck && W.__mlsAthenaTruthCheck.installed) return;

  var VERSION = '1.0.0';
  var ASSET = 'feat_athena_truthcheck.js';
  var FRESH_MS = 15000;
  var PROBE_TIMEOUT_MS = 4000;
  var PROBE_THROTTLE_MS = 3000;
  var lastHealth = { responded: false, ok: false, tabs: 0, discarded: 0, usable: false, at: 0 };
  var _lastProbeAt = 0;
  var _msgHandler = null;
  var _attachTimer = null;
  var _attachTries = 0;
  var _wrapped = false;
  var _orig = { isConnected: null, check: null, describe: null };

  function isAthenaHost(host) {
    return String(host || '').toLowerCase() === 'athenanet.athenahealth.com';
  }
  function hostFromUrl(u) {
    try { return new URL(String(u || '')).host || ''; } catch (e) { return ''; }
  }
  function evaluate(reply) {
    var r = (reply && reply.resp && typeof reply.resp === 'object') ? reply.resp : (reply || {});
    var a = r.athena && typeof r.athena === 'object' ? r.athena : {};
    var tabs = Math.max(0, Number(a.tabs || 0));
    var discarded = Math.max(0, Number(a.discarded || 0));
    return { ok: r.ok === true, tabs: tabs, discarded: discarded, usable: r.ok === true && tabs > discarded };
  }
  function recordReply(reply) {
    var e = evaluate(reply);
    lastHealth = { responded: true, ok: e.ok, tabs: e.tabs, discarded: e.discarded, usable: e.usable, at: Date.now() };
    return lastHealth;
  }
  function healthFresh() {
    return lastHealth.responded === true && lastHealth.usable === true && (Date.now() - lastHealth.at) < FRESH_MS;
  }
  function missingFresh() {
    return lastHealth.responded === true && lastHealth.usable === false && (Date.now() - lastHealth.at) < FRESH_MS;
  }

  function installListener() {
    if (_msgHandler) return;
    _msgHandler = function (ev) {
      try {
        var d = ev && ev.data;
        if (!d || d.source !== 'mls-ext' || d.type !== 'mlsExtHealthResult') return;
        recordReply(d);
      } catch (e) {}
    };
    try { W.addEventListener('message', _msgHandler, true); } catch (e) {}
  }

  function probe(timeoutMs) {
    timeoutMs = timeoutMs || PROBE_TIMEOUT_MS;
    return new Promise(function (resolve) {
      var done = false, timer = null;
      var id = 'mlstc_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
      function finish(value) {
        if (done) return;
        done = true;
        if (timer != null) { try { clearTimeout(timer); } catch (e) {} }
        try { W.removeEventListener('message', onMsg, true); } catch (e) {}
        resolve(value);
      }
      function onMsg(ev) {
        var d = ev && ev.data;
        if (!d || d.source !== 'mls-ext' || d.type !== 'mlsExtHealthResult') return;
        if (d.requestId && d.requestId !== id) return;
        finish(recordReply(d));
      }
      try { W.addEventListener('message', onMsg, true); } catch (e) {}
      timer = setTimeout(function () { finish(lastHealth); }, timeoutMs);
      try { W.postMessage({ source: 'mls-app', type: 'mlsExtHealth', requestId: id }, '*'); } catch (e) {}
    });
  }
  function maybeRefresh() {
    var t = Date.now();
    if (t - _lastProbeAt < PROBE_THROTTLE_MS) return;
    _lastProbeAt = t;
    try { probe(); } catch (e) {}
  }

  function correctedState() {
    var allDiscarded = lastHealth.tabs > 0 && lastHealth.discarded >= lastHealth.tabs;
    return {
      status: 'no-tab', ext: lastHealth.ok, tab: false,
      reason: allDiscarded
        ? 'Athena tab detected but discarded by Memory Saver — activate it before a clinical action.'
        : 'No usable Athena product tab detected. Athena was not read.',
      at: Date.now(), scope: 'readiness', patientVerified: false, encounterVerified: false
    };
  }

  function harden(CT) {
    if (!CT || _wrapped || typeof CT.isConnected !== 'function') return false;
    _orig.isConnected = CT.isConnected.bind(CT);
    _orig.check = (typeof CT.check === 'function') ? CT.check.bind(CT) : null;
    _orig.describe = (typeof CT.describe === 'function') ? CT.describe.bind(CT) : null;

    CT.isConnected = function () {
      var raw = false;
      try { raw = !!_orig.isConnected(); } catch (e) {}
      if (!raw) return false;
      if (healthFresh()) return true;
      maybeRefresh();
      return false;
    };
    if (_orig.check) {
      CT.check = function () {
        return Promise.resolve(_orig.check()).then(function (s) {
          if (!s || s.status !== 'connected' || healthFresh()) return s;
          return probe().then(function () { return healthFresh() ? s : correctedState(); });
        });
      };
    }
    if (_orig.describe) {
      CT.describe = function (s) {
        var st = s || CT.state;
        if (st && st.status === 'connected' && !healthFresh()) st = correctedState();
        return _orig.describe(st);
      };
    }
    CT.__mlsTcHardened = true;
    _wrapped = true;
    return true;
  }

  function unharden() {
    try {
      var CT = W.__mlsConnTruth;
      if (CT && _wrapped) {
        if (_orig.isConnected) CT.isConnected = _orig.isConnected;
        if (_orig.check) CT.check = _orig.check;
        if (_orig.describe) CT.describe = _orig.describe;
        try { delete CT.__mlsTcHardened; } catch (e) { CT.__mlsTcHardened = false; }
      }
    } catch (e) {}
    _wrapped = false;
  }

  function tryAttach() {
    var CT = W.__mlsConnTruth;
    if (CT && typeof CT.isConnected === 'function') {
      harden(CT);
      maybeRefresh();
      return true;
    }
    return false;
  }
  function scheduleAttach() {
    if (tryAttach()) return;
    _attachTimer = setInterval(function () {
      _attachTries++;
      if (tryAttach() || _attachTries > 120) {
        try { clearInterval(_attachTimer); } catch (e) {}
        _attachTimer = null;
      }
    }, 500);
  }
  function boot() { installListener(); scheduleAttach(); }
  function revert() {
    try { if (_attachTimer) clearInterval(_attachTimer); } catch (e) {}
    _attachTimer = null;
    try { if (_msgHandler) W.removeEventListener('message', _msgHandler, true); } catch (e) {}
    _msgHandler = null;
    unharden();
    lastHealth = { responded: false, ok: false, tabs: 0, discarded: 0, usable: false, at: 0 };
    if (W.__mlsAthenaTruthCheck) W.__mlsAthenaTruthCheck.installed = false;
  }

  W.__mlsAthenaTruthCheck = {
    installed: true, version: VERSION, asset: ASSET,
    hostFromUrl: hostFromUrl, isAthenaHost: isAthenaHost,
    evaluate: evaluate, recordReply: recordReply, probe: probe, harden: harden,
    healthFresh: healthFresh, athenaFresh: healthFresh,
    missingFresh: missingFresh, phantomFresh: missingFresh,
    correctedState: correctedState,
    state: function () { return lastHealth; },
    revert: revert
  };

  try {
    if (typeof document !== 'undefined' && document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
  } catch (e) { try { boot(); } catch (e2) {} }
})();
