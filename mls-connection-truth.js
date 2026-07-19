/* =====================================================================
 * mls-connection-truth.js  (v1.0.0)
 * ---------------------------------------------------------------------
 * ONE source of truth for PHI-free MLS Assist / Athena readiness.
 *
 * WHY THIS EXISTS
 *   Multiple Athena status surfaces have, in the past, asserted
 *   Older builds treated an automatic schedule read as a harmless connection
 *   check. That still fetched clinical data, could contend with a clinician's
 *   real pull, and made "connected" sound like patient/encounter verification.
 *   This module now uses only two operational signals:
 *       (1) mlsPing -> mlsPong (the content bridge is installed), AND
 *       (2) mlsExtHealth -> mlsExtHealthResult (the worker responds and an
 *           exact, non-discarded athenaOne product tab exists).
 *   The legacy status string `connected` is retained for callers, but means
 *   READY ONLY. It never means signed in, chart-readable, or patient verified.
 *
 * PHI SAFETY
 *   Health replies contain operational metadata only: worker status plus
 *   exact Athena tab and discarded-tab counts. This file never requests or
 *   receives schedule/chart text, patient identity, encounter data, URLs, or
 *   page titles. It never activates, focuses, or navigates Athena.
 *
 * SHAPE
 *   Additive, own-scope IIFE. Idempotent boot. Fully reversible via
 *   window.__mlsConnTruth.revert(). Does NOT modify any existing app
 *   function. Worst case (any error) it no-ops and the page is
 *   byte-identical to not having loaded it.
 *
 * PUBLIC API  (window.__mlsConnTruth)
 *   .installed            -> true
 *   .version              -> "1.0.0"
 *   .state                -> last known state object (see STATE below);
 *                            starts as {status:'checking'} and is NEVER
 *                            optimistically 'connected'.
 *   .check()              -> Promise<state> : run a fresh real probe now.
 *   .isConnected()        -> compatibility boolean: extension ready + usable
 *                            Athena tab detected; no clinical verification.
 *   .assertReady()        -> Promise<state> : resolves after fresh readiness.
 *   .assertReadable()     -> always rejects; a passive probe cannot prove a
 *                            chart readable. Explicit actions verify their own
 *                            exact patient/encounter context.
 *   .describe(state?)     -> {status, color, label, detail} for UI binding
 *                            (color: 'green'|'red'|'grey').
 *   .subscribe(fn)        -> unsubscribe fn; fn(state) on every change.
 *   .start([ms]) / .stop()-> start/stop visibility-gated polling.
 *   .revert()             -> remove listeners/timers/state; installed=false.
 *
 * STATE object
 *   { status:'checking'|'connected'|'no-extension'|'no-tab'|'error',
 *     ext:boolean,        // extension answered pong
 *     tab:boolean,        // an exact, non-discarded Athena tab was detected
 *     reason:string,      // short, non-PHI, human reason
 *     at:number }         // Date.now() of this reading
 * ===================================================================== */
(function () {
  'use strict';

  var NS = '__mlsConnTruth';
  var VERSION = '1.2.0';

  // Idempotent boot — never install twice.
  if (typeof window !== 'undefined' && window[NS] && window[NS].installed) {
    return;
  }

  // ---- tunables (conservative, honest-by-default) ----
  var PING_TIMEOUT_MS = 2500;   // how long to wait for mlsPong
  var HEALTH_TIMEOUT_MS = 4000; // how long to wait for operational health
  var POLL_MS = 30000;          // re-probe cadence while tab is visible
  var MAX_REASON_LEN = 80;      // truncate any control reason string

  var win = window;
  var listeners = [];           // subscribers
  var pollTimer = null;
  var inFlight = null;          // de-dupe concurrent probes
  var messageHandler = null;    // the single window 'message' listener
  var visHandler = null;
  var pending = {};             // id -> resolver for outstanding requests
  var seq = 0;

  // The canonical state. Starts 'checking' — NEVER 'connected'.
  var state = freezeState({
    status: 'checking',
    ext: false,
    tab: false,
    reason: 'Checking MLS Assist readiness…',
    at: Date.now()
  });

  function freezeState(s) {
    // shallow-immutable snapshot so subscribers can't mutate shared state
    return {
      status: String(s.status),
      ext: !!s.ext,
      tab: !!s.tab,
      reason: String(s.reason || ''),
      at: typeof s.at === 'number' ? s.at : Date.now(),
      tabs: Math.max(0, Number(s.tabs || 0)),
      discarded: Math.max(0, Number(s.discarded || 0)),
      scope: 'readiness',
      patientVerified: false,
      encounterVerified: false
    };
  }

  function setState(next) {
    var s = freezeState(next);
    var changed = !state ||
      s.status !== state.status ||
      s.ext !== state.ext ||
      s.tab !== state.tab ||
      s.reason !== state.reason;
    state = s;
    win[NS].state = state;
    if (changed) {
      for (var i = 0; i < listeners.length; i++) {
        try { listeners[i](state); } catch (e) { /* a bad subscriber must not break the probe */ }
      }
    }
    return state;
  }

  // Sanitize a control reason: short strings only, never anything that
  // could be PHI. We accept only a small, bounded string and truncate it.
  function safeReason(resp) {
    try {
      if (!resp || typeof resp !== 'object') return '';
      var r = resp.reason || resp.error || resp.code;
      if (typeof r !== 'string') return '';
      r = r.replace(/\s+/g, ' ').trim();
      if (!r) return '';
      if (r.length > MAX_REASON_LEN) r = r.slice(0, MAX_REASON_LEN) + '…';
      return r;
    } catch (e) { return ''; }
  }

  // Post a request and resolve when a matching reply arrives or on timeout.
  // We DELIBERATELY accept only operational fields from mlsExtHealth.
  function request(type, replyType, timeoutMs) {
    return new Promise(function (resolve) {
      var id = 'ct' + (++seq) + '_' + Date.now();
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        delete pending[id];
        resolve({ ok: false, timedOut: true, reason: '' });
      }, timeoutMs);

      pending[id] = function (data) {
        if (done) return;
        if (!data || data.type !== replyType) return;
        /* v1.2.0: the bridge echoes requestId (b346) — a reply stamped with a
           DIFFERENT id belongs to another surface (e.g. a live pull) and must
           not settle this probe. Id-less replies (mlsPong) still pass. */
        if (data.requestId && data.requestId !== id) return;
        done = true;
        clearTimeout(timer);
        delete pending[id];
        // Read ONLY non-PHI control fields.
        var ok, tabs = 0, discarded = 0;
        if (replyType === 'mlsPong') {
          ok = true; // a pong at all means the extension is present
        } else {
          ok = !!(data.resp && data.resp.ok === true);
          tabs = Math.max(0, Number(data.resp && data.resp.athena && data.resp.athena.tabs || 0));
          discarded = Math.max(0, Number(data.resp && data.resp.athena && data.resp.athena.discarded || 0));
        }
        resolve({ ok: ok, tabs: tabs, discarded: discarded, usable: ok && tabs > discarded, timedOut: false, reason: safeReason(data && data.resp) });
      };

      try {
        win.postMessage({ source: 'mls-app', type: type, __mlsConnTruthId: id, requestId: id }, '*');
      } catch (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        delete pending[id];
        resolve({ ok: false, timedOut: false, reason: 'postMessage failed' });
      }
    });
  }

  function installMessageHandler() {
    if (messageHandler) return;
    messageHandler = function (ev) {
      var data = ev && ev.data;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'mls-ext') return;
      // Fan the reply out to every pending resolver; each ignores
      // replies whose type it doesn't expect.
      var keys = Object.keys(pending);
      for (var i = 0; i < keys.length; i++) {
        var fn = pending[keys[i]];
        if (fn) { try { fn(data); } catch (e) {} }
      }
    };
    win.addEventListener('message', messageHandler, false);
  }

  // The honest readiness probe. The compatibility status `connected` means
  // only worker-ready + an exact non-discarded Athena tab detected.
  function check() {
    if (inFlight) return inFlight;
    installMessageHandler();

    inFlight = (function () {
      // 1) Extension presence.
      return request('mlsPing', 'mlsPong', PING_TIMEOUT_MS).then(function (pingRes) {
        if (!pingRes.ok) {
          return setState({
            status: 'no-extension',
            ext: false, tab: false,
            reason: 'MLS Assist not detected — load the extension and reload.',
            at: Date.now()
          });
        }
        // 2) Operational worker/tab health only (no page or clinical read).
        return request('mlsExtHealth', 'mlsExtHealthResult', HEALTH_TIMEOUT_MS)
          .then(function (healthRes) {
            if (healthRes.usable) {
              return setState({
                status: 'connected',
                ext: true, tab: true,
                tabs: healthRes.tabs, discarded: healthRes.discarded,
                reason: 'MLS Assist ready — Athena tab detected; patient and encounter not yet verified.',
                at: Date.now()
              });
            }
            if (!healthRes.ok || /extension-error|bridge-error|context invalidated|worker-unreachable|no-response/i.test(healthRes.reason || '')) {
              return setState({
                status: 'error',
                ext: true, tab: false,
                tabs: healthRes.tabs, discarded: healthRes.discarded,
                reason: 'MLS Assist was detected, but its worker health check failed — reload MLS Assist at chrome://extensions. Athena was not read.',
                at: Date.now()
              });
            }
            return setState({
              status: 'no-tab',
              ext: true, tab: false,
              tabs: healthRes.tabs, discarded: healthRes.discarded,
              reason: healthRes.tabs > 0 && healthRes.discarded >= healthRes.tabs
                ? 'Athena tab detected but discarded by Memory Saver — activate it before a clinical action.'
                : 'MLS Assist ready — no usable Athena product tab detected.',
              at: Date.now()
            });
          });
      }).catch(function (e) {
        return setState({
          status: 'error',
          ext: false, tab: false,
          reason: 'Readiness check failed — Athena was not read.',
          at: Date.now()
        });
      }).then(function (s) {
        inFlight = null;
        return s;
      });
    })();

    return inFlight;
  }

  function isConnected() {
    return state && state.status === 'connected';
  }

  function assertReady() {
    return check().then(function (s) {
      if (s.status === 'connected') return s;
      var err = new Error(s.reason || 'MLS Assist is not ready');
      err.state = s;
      throw err;
    });
  }

  // Passive operational metadata can never prove chart readability.
  function assertReadable() {
    var err = new Error('Passive readiness cannot verify a chart. Start an explicit clinical action to verify the exact patient and encounter.');
    err.code = 'passive-readability-not-verified';
    err.state = state;
    return Promise.reject(err);
  }

  function describe(s) {
    s = s || state;
    var status = s ? s.status : 'checking';
    var map = {
      'connected':     { color: 'green', label: 'MLS Assist ready · Athena tab detected' },
      'no-extension':  { color: 'red',   label: 'MLS Assist not detected' },
      'no-tab':        { color: 'red',   label: 'No usable Athena tab detected' },
      'error':         { color: 'red',   label: 'MLS Assist health unavailable' },
      'checking':      { color: 'grey',  label: 'Checking readiness…' }
    };
    var m = map[status] || map['checking'];
    return { status: status, color: m.color, label: m.label, detail: (s && s.reason) || '' };
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    listeners.push(fn);
    try { fn(state); } catch (e) {}
    return function unsubscribe() {
      var i = listeners.indexOf(fn);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function visible() {
    try {
      return typeof document === 'undefined' || document.visibilityState !== 'hidden';
    } catch (e) { return true; }
  }

  function start(ms) {
    stop();
    var period = typeof ms === 'number' && ms > 0 ? ms : POLL_MS;
    // Probe now (only if visible), then on a visibility-gated interval.
    if (visible()) check();
    pollTimer = setInterval(function () {
      if (visible()) check();
    }, period);
    if (!visHandler && typeof document !== 'undefined' && document.addEventListener) {
      visHandler = function () { if (visible()) check(); };
      document.addEventListener('visibilitychange', visHandler, false);
    }
    return win[NS];
  }

  function stop() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    return win[NS];
  }

  function revert() {
    stop();
    if (messageHandler) { try { win.removeEventListener('message', messageHandler, false); } catch (e) {} messageHandler = null; }
    if (visHandler && typeof document !== 'undefined' && document.removeEventListener) {
      try { document.removeEventListener('visibilitychange', visHandler, false); } catch (e) {}
      visHandler = null;
    }
    listeners = [];
    pending = {};
    inFlight = null;
    if (win[NS]) { win[NS].installed = false; }
  }

  // ---- publish the single source of truth ----
  win[NS] = {
    installed: true,
    version: VERSION,
    state: state,
    check: check,
    isConnected: isConnected,
    assertReady: assertReady,
    assertReadable: assertReadable,
    describe: describe,
    subscribe: subscribe,
    start: start,
    stop: stop,
    revert: revert,
    // exposed for tests / advanced callers (non-PHI helpers only)
    _safeReason: safeReason,
    _request: request
  };

  // Begin probing automatically (visibility-gated). Honest default
  // state ('checking') is already published above; the first real
  // probe will move it to connected/no-extension/no-tab.
  try { start(); } catch (e) { /* never throw out of boot */ }

})();
