/* =====================================================================
 * mls-connection-truth.js  (v1.0.0)
 * ---------------------------------------------------------------------
 * ONE source of truth for "is athenaOne genuinely connected?"
 *
 * WHY THIS EXISTS
 *   Multiple Athena status surfaces have, in the past, asserted
 *   "connected / a signed-in athenaOne tab was found and is readable"
 *   without a live check, or treated a bare ping->pong as "connected"
 *   while the real operation channel was dead (see audit Group 2).
 *   This module is the single, honest probe that ALL Athena status UI
 *   must read from. It NEVER hard-codes or optimistically assumes
 *   "connected" — the only way to reach the CONNECTED state is for two
 *   real signals to both come back positive inside a timeout:
 *       (1) the MLS Assist extension answers mlsPing -> mlsPong, AND
 *       (2) a signed-in athenaOne tab is READABLE (mlsAppPullSchedule
 *           -> mlsAppScheduleResult with resp.ok === true).
 *   Anything else is reported DISCONNECTED, with an honest reason.
 *
 * PHI SAFETY
 *   The readability probe reuses the same passive mlsAppPullSchedule
 *   message the §56 status dot used. It reads ONLY the boolean resp.ok
 *   (and, at most, a short non-PHI control reason/error/code string,
 *   truncated and never logged). It NEVER reads, stores, or logs
 *   resp.text / resp.url / resp.title — so no patient data is touched.
 *   The probe is passive (the extension's schedule handler does not
 *   activate/focus/navigate the tab), so polling cannot disturb a
 *   doctor's athenaOne tab during a visit.
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
 *   .isConnected()        -> boolean : true ONLY if last state is connected.
 *   .assertReadable()     -> Promise<state> : resolves on a fresh probe;
 *                            REJECTS (honestly) if not connected, so callers
 *                            that need a real chart can gate on it.
 *   .describe(state?)     -> {status, color, label, detail} for UI binding
 *                            (color: 'green'|'red'|'grey').
 *   .subscribe(fn)        -> unsubscribe fn; fn(state) on every change.
 *   .start([ms]) / .stop()-> start/stop visibility-gated polling.
 *   .revert()             -> remove listeners/timers/state; installed=false.
 *
 * STATE object
 *   { status:'checking'|'connected'|'no-extension'|'no-tab'|'error',
 *     ext:boolean,        // extension answered pong
 *     tab:boolean,        // a signed-in athenaOne tab is readable
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
  var SCHED_TIMEOUT_MS = 4000;  // how long to wait for mlsAppScheduleResult
  var POLL_MS = 7000;           // re-probe cadence while tab is visible
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
    reason: 'Checking athenaOne connection…',
    at: Date.now()
  });

  function freezeState(s) {
    // shallow-immutable snapshot so subscribers can't mutate shared state
    return {
      status: String(s.status),
      ext: !!s.ext,
      tab: !!s.tab,
      reason: String(s.reason || ''),
      at: typeof s.at === 'number' ? s.at : Date.now()
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

  // Detect the PUBLIC athenaOne sign-in / landing page from a schedule read.
  // We match ONLY well-known PUBLIC marketing/login strings and keep just a
  // boolean -- no PHI is stored or transmitted. A signed-in schedule (which
  // WOULD contain PHI) is large and won't match these public markers, so it
  // is left untouched. This closes the "green connected while on the sign-in
  // page" lie: ok===true only means a tab was readable, not that it is signed in.
  function isSigninPage(resp) {
    try {
      var t = resp && typeof resp.text === 'string' ? resp.text : '';
      if (!t) return false;
      if (t.length > 4000) return false; // a real day schedule is large; the sign-in page is tiny
      var head = t.slice(0, 1200);
      if (/get more from athenaone|find trusted solutions/i.test(head)) return true;
      if (/athenahealth[\s\S]{0,40}sign\s*in/i.test(head)) return true;
      if (/\bsign\s*in\b/i.test(head) && /\b(password|username|log\s*in)\b/i.test(head)) return true;
      return false;
    } catch (e) { return false; }
  }

  // Post a request and resolve when a matching reply arrives or on timeout.
  // We DELIBERATELY never read resp.text/url/title.
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
        var ok, signin = false;
        if (replyType === 'mlsPong') {
          ok = true; // a pong at all means the extension is present
        } else {
          ok = !!(data.resp && data.resp.ok === true);
          signin = isSigninPage(data.resp); // ok+sign-in page = NOT genuinely connected
        }
        resolve({ ok: ok, signin: signin, timedOut: false, reason: safeReason(data && data.resp) });
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

  // The honest probe. Resolves to a state object. NEVER returns
  // 'connected' unless BOTH real signals came back positive.
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
        // 2) Readable signed-in athenaOne tab (passive, PHI-safe).
        return request('mlsAppPullSchedule', 'mlsAppScheduleResult', SCHED_TIMEOUT_MS)
          .then(function (schedRes) {
            if (schedRes.ok && !schedRes.signin) {
              return setState({
                status: 'connected',
                ext: true, tab: true,
                reason: 'athenaOne connected — a signed-in tab is readable.',
                at: Date.now()
              });
            }
            /* v1.2.0: an 'extension-error' control reply means chrome.runtime
               threw in the content bridge — the extension runtime is dead, NOT
               Athena. Telling the user to "sign in to athenaOne" here is wrong
               and has misled a real signed-in session. Name the real fix. */
            if (/extension-error|bridge-error|context invalidated|worker-unreachable/i.test(schedRes.reason || '')) {
              return setState({
                status: 'error',
                ext: false, tab: false,
                reason: 'MLS Assist hit an internal error and needs a reload — open chrome://extensions, find MLS Assist, press Reload. athenaOne itself may still be signed in.',
                at: Date.now()
              });
            }
            return setState({
              status: 'no-tab',
              ext: true, tab: false,
              reason: schedRes.signin
                ? 'Your athenaOne tab is on the sign-in page — sign in and open your Day schedule, then reload.'
                : (schedRes.reason
                    ? ('No readable athenaOne tab (' + schedRes.reason + ') — open a signed-in athenaOne tab.')
                    : 'No signed-in athenaOne tab is readable — open one and reload.'),
              at: Date.now()
            });
          });
      }).catch(function (e) {
        return setState({
          status: 'error',
          ext: false, tab: false,
          reason: 'Connection check failed — treating as disconnected.',
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

  // For callers that need a genuinely connected chart: resolve on a
  // fresh probe, but REJECT honestly if not connected — so no caller
  // can proceed on an optimistic assumption.
  function assertReadable() {
    return check().then(function (s) {
      if (s.status === 'connected') return s;
      var err = new Error(s.reason || 'athenaOne not connected');
      err.state = s;
      throw err;
    });
  }

  function describe(s) {
    s = s || state;
    var status = s ? s.status : 'checking';
    var map = {
      'connected':     { color: 'green', label: 'athenaOne connected' },
      'no-extension':  { color: 'red',   label: 'MLS Assist not detected' },
      'no-tab':        { color: 'red',   label: 'No signed-in athenaOne tab' },
      'error':         { color: 'red',   label: 'athenaOne disconnected' },
      'checking':      { color: 'grey',  label: 'Checking…' }
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
