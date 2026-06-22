/*! feat_athena_truthcheck.js  ->  window.__mlsAthenaTruthCheck  (v1.0.0)
 * =====================================================================
 * PART 1 FIX - kill the false-GREEN readiness checklist when no signed-in
 * athenaOne tab is open.
 *
 * ROOT CAUSE (diagnosed from source, not guessed):
 *   The MLS Assist extension's background `mlsAppScheduleRequest` handler,
 *   when it cannot find a real athenaOne tab, FALLS BACK to "the most
 *   recently-active non-MLS http(s) tab" and returns { ok:true, ... } from
 *   that arbitrary tab (e.g. Gmail). It only returns ok:false when there is
 *   no http(s) tab open AT ALL. So `resp.ok === true` does NOT mean "a
 *   signed-in athenaOne tab is readable" - it can be any random tab.
 *   Both site-side truth sources (the s59 doctor checklist and the s72
 *   Connection-Truth utility) read ONLY `resp.ok`, so the phantom positive
 *   propagates: __mlsConnTruth.isConnected() returns true, the s72-gated
 *   doctor branch fires, and the checklist shows the green "tab is open /
 *   page readable" lines + the "MLS Assist is ready" banner - a lie.
 *
 * THE FIX (this file - additive, reversible, no edit to existing assets):
 *   Harden the ONE source of truth. We wrap window.__mlsConnTruth so that
 *   "connected" additionally requires the schedule reply to have come from a
 *   genuine athenaOne HOST (host string only - never resp.text / resp.title,
 *   so still no PHI). A reply that is ok:true but from a non-athena host is a
 *   phantom and is reported DISCONNECTED ('no-tab'), honestly.
 *   Because the live s59 doctor checklist and the s56 status dot already gate
 *   their green state on __mlsConnTruth.isConnected() (commits 64433d8557 /
 *   c1793b0905), hardening this single function cascades: the checklist's
 *   "tab is open" + "page readable" lines go RED and the "ready / good to
 *   pull" banner does NOT show, whenever the athenaOne tab is closed.
 *
 *   "Extension is responding" (the mlsPing/mlsPong line) is intentionally NOT
 *   affected - the extension can honestly be OK while no athenaOne tab is
 *   open. Only "tab open & readable" is gated on a real, host-verified probe.
 *
 *   Defense-in-depth: a conservative, downgrade-only corrector forces BOTH
 *   the doctor's "tab open" and "page readable" lines to RED and removes the
 *   "ready" banner, but ONLY on a confirmed phantom (a fresh ok:true reply
 *   from a non-athena host). It never touches a genuine connection.
 *
 * THIS IS A STOPGAP AT THE SITE LAYER. The durable fix lives in the
 * extension (see EXTENSION_FIX_NEEDED.md): the extension must stop returning
 * ok:true for a fallback tab. Until v1.36 ships, this file makes the site
 * refuse to trust the phantom.
 *
 * PHI SAFETY: reads ONLY resp.ok (boolean) and the HOST of resp.url
 *   (e.g. "athenanet.athenahealth.com"). Never reads/stores/logs resp.text,
 *   resp.url path/query, or resp.title. Host of a schedule frame is not PHI.
 * SHAPE: additive own-scope IIFE, idempotent boot, fully reversible via
 *   window.__mlsAthenaTruthCheck.revert(). Touches no existing function body;
 *   only wraps __mlsConnTruth's public methods and restores them on revert.
 * ===================================================================== */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W) return;
  if (W.__mlsAthenaTruthCheck && W.__mlsAthenaTruthCheck.installed) return;

  var VERSION = '1.0.0';
  var ASSET = 'feat_athena_truthcheck.js';

  // Same athena host allow-list the extension itself uses to recognise an
  // athenaOne tab (background.js mlsAppScheduleRequest). Kept identical so a
  // genuinely-open athena tab is accepted and only non-athena phantoms fail.
  var ATHENA_RE = /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i;

  var FRESH_MS = 15000;      // a host sample older than this is treated as unknown
  var PROBE_TIMEOUT_MS = 4000;
  var PROBE_THROTTLE_MS = 3000;

  // Last schedule reply we observed, reduced to non-PHI control fields only.
  var lastSched = { responded: false, ok: false, host: '', isAthena: false, at: 0 };
  var _lastProbeAt = 0;
  var _msgHandler = null;
  var _attachTimer = null;
  var _attachTries = 0;
  var _wrapped = false;
  var _orig = { isConnected: null, check: null, describe: null };

  // ---- helpers (PHI-safe) -------------------------------------------------
  function hostFromUrl(u) {
    try {
      if (!u || typeof u !== 'string') return '';
      // Prefer the URL parser; fall back to a host-only regex. Never keep
      // path/query (those could, in theory, carry identifiers).
      try { return new URL(u).host || ''; } catch (e) {}
      var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#]+)/i.exec(u);
      return m ? m[1] : '';
    } catch (e) { return ''; }
  }
  function isAthenaHost(host) {
    return !!host && ATHENA_RE.test(host);
  }

  // Pure evaluator (used by the probe, the listener, and the offline tests).
  // Input: a schedule reply object { ok, url } (or { resp:{ok,url} }).
  // Output: { ok, host, isAthena } - host derived ONLY from url's host.
  function evaluate(reply) {
    var r = (reply && reply.resp && typeof reply.resp === 'object') ? reply.resp : reply;
    r = r || {};
    var host = hostFromUrl(r.url);
    return { ok: r.ok === true, host: host, isAthena: r.ok === true && isAthenaHost(host) };
  }

  function recordReply(reply) {
    var ev = evaluate(reply);
    lastSched = { responded: true, ok: ev.ok, host: ev.host, isAthena: ev.isAthena, at: Date.now() };
    return lastSched;
  }

  function athenaFresh() {
    return lastSched.responded === true &&
           lastSched.isAthena === true &&
           (Date.now() - lastSched.at) < FRESH_MS;
  }
  // A reply came back ok:true but from a NON-athena host, recently - a
  // confirmed phantom (the exact tab-closed-but-other-tab-open situation).
  function phantomFresh() {
    return lastSched.responded === true &&
           lastSched.ok === true &&
           lastSched.isAthena === false &&
           (Date.now() - lastSched.at) < FRESH_MS;
  }

  // ---- passive listener: capture host from any schedule reply -------------
  function installListener() {
    if (_msgHandler) return;
    _msgHandler = function (ev) {
      try {
        var d = ev && ev.data;
        if (!d || d.source !== 'mls-ext' || !d.type) return;
        if (!/Schedule(Result)?$/i.test(d.type)) return;
        recordReply(d);
      } catch (e) {}
    };
    try { W.addEventListener('message', _msgHandler, true); } catch (e) {}
  }

  // ---- active probe (throttled): refresh the host sample on demand --------
  // Posts the SAME passive mlsAppPullSchedule message the status dot uses and
  // reads ONLY ok + url-host from the reply. Never reads chart text.
  function probe(timeoutMs) {
    timeoutMs = timeoutMs || PROBE_TIMEOUT_MS;
    return new Promise(function (resolve) {
      var done = false;
      var id = 'mlstc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
      function onMsg(ev) {
        var d = ev && ev.data;
        if (!d || d.source !== 'mls-ext' || !d.type) return;
        if (!/Schedule(Result)?$/i.test(d.type)) return;
        if (done) return;
        done = true;
        try { W.removeEventListener('message', onMsg, true); } catch (e) {}
        resolve(recordReply(d));
      }
      try { W.addEventListener('message', onMsg, true); } catch (e) {}
      try { W.postMessage({ source: 'mls-app', type: 'mlsAppPullSchedule', id: id }, '*'); } catch (e) {}
      setTimeout(function () {
        if (done) return;
        done = true;
        try { W.removeEventListener('message', onMsg, true); } catch (e) {}
        // No reply: leave lastSched as-is but do not refresh `at`.
        resolve(lastSched);
      }, timeoutMs);
    });
  }
  function maybeRefresh() {
    var now = Date.now();
    if (now - _lastProbeAt < PROBE_THROTTLE_MS) return;
    _lastProbeAt = now;
    try { probe(); } catch (e) {}
  }

  // ---- corrected state object for a downgraded (phantom) connection -------
  function correctedState(s) {
    return {
      status: 'no-tab',
      ext: true,
      tab: false,
      reason: 'A tab replied but it is not a signed-in athenaOne tab - open a signed-in athenaOne tab and reload.',
      at: Date.now()
    };
  }

  // ---- harden window.__mlsConnTruth --------------------------------------
  function harden(CT) {
    if (!CT || _wrapped) return false;
    if (typeof CT.isConnected !== 'function') return false;

    _orig.isConnected = CT.isConnected.bind(CT);
    _orig.check = (typeof CT.check === 'function') ? CT.check.bind(CT) : null;
    _orig.describe = (typeof CT.describe === 'function') ? CT.describe.bind(CT) : null;

    // The authoritative gate every downstream surface reads at render time.
    CT.isConnected = function () {
      var raw = false;
      try { raw = !!_orig.isConnected(); } catch (e) { raw = false; }
      if (!raw) return false;                 // already disconnected -> honest
      if (athenaFresh()) return true;         // confirmed real athena host
      // raw says connected but we have no fresh athena host confirmation.
      // That means either a phantom (non-athena reply) or a not-yet-confirmed
      // sample. Refuse to claim connected, and kick a refresh. Honest default
      // is DISCONNECTED - never an optimistic green.
      maybeRefresh();
      return false;
    };
    CT.__mlsTcHardened = true;

    if (_orig.check) {
      CT.check = function () {
        return _orig.check().then(function (s) {
          try {
            if (s && s.status === 'connected' && !athenaFresh()) {
              var c = correctedState(s);
              try { CT.state = c; } catch (e) {}
              return c;
            }
          } catch (e) {}
          return s;
        });
      };
    }

    if (_orig.describe) {
      CT.describe = function (s) {
        var st = s || CT.state;
        try {
          if (phantomFresh() || (st && st.status === 'connected' && !athenaFresh())) {
            st = correctedState(st);
          }
        } catch (e) {}
        return _orig.describe(st);
      };
    }

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

  // ---- defense-in-depth: honest-RED corrector for the s59 doctor panel ----
  // Hardening isConnected() already makes the live (s72-gated) checklist show
  // the "tab is open" line RED and suppresses the green "ready" banner. But
  // the doctor's own "page readable" line can land on amber "couldn't check",
  // and an ungated (pre-s72) build could still show optimistic green. To
  // guarantee the user's exact requirement - BOTH "tab open" and "page
  // readable" go RED and the banner never says "ready / good to pull" - we
  // make a single, conservative correction to the doctor panel, and ONLY when
  // we have POSITIVE proof of a phantom: a fresh ok:true schedule reply from a
  // NON-athena host. It is downgrade-only (it can turn a pass/warn into fail,
  // never the reverse) so it can never invent green, and it never touches a
  // genuinely-connected panel (phantomFresh() is false whenever a real athena
  // tab answered). Fully removed on revert.
  var DOC_PANEL_ID = 'mlsAthenaDoctorPanel';
  var _docObs = null, _docRaf = 0;
  var TAB_LBL = /tab is open/i;
  var PERM_LBL = /read the athenaOne page/i;
  var READY_RE = /MLS Assist is ready/i;
  var X_MARK = '✗';     // heavy ballot X
  var WARN_EMOJI = '⚠️';

  function correctDoctorPanel() {
    try {
      var panel = document.getElementById(DOC_PANEL_ID);
      if (!panel) return;
      if (!phantomFresh()) return;               // only on a confirmed phantom
      // Don't touch a panel that is still mid-check (grey icons present).
      if (panel.querySelector('.mlsdoc-ic.ic-check')) return;

      // 1) the two lines -> RED (flip from pass/warn only; never upward)
      var rows = panel.querySelectorAll('li.mlsdoc-step');
      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var lblEl = row.querySelector('.mlsdoc-lbl');
        var ic = row.querySelector('.mlsdoc-ic');
        if (!lblEl || !ic) continue;
        var lbl = lblEl.textContent || '';
        if (!(TAB_LBL.test(lbl) || PERM_LBL.test(lbl))) continue;
        if (ic.classList.contains('ic-fail')) continue;   // already RED
        ic.classList.remove('ic-pass', 'ic-warn', 'ic-check');
        ic.classList.add('ic-fail');
        ic.textContent = X_MARK;
        var det = row.querySelector('.mlsdoc-det');
        if (!det) { det = document.createElement('span'); det.className = 'mlsdoc-det'; lblEl.parentNode.appendChild(det); }
        det.textContent = TAB_LBL.test(lbl)
          ? 'No signed-in, readable athenaOne tab is open (a different tab answered).'
          : 'There is no athenaOne page to read - open a signed-in athenaOne tab.';
      }

      // 2) banner must NOT say "ready / good to pull"
      var head = panel.querySelector('.mlsdoc-h');
      var okBox = panel.querySelector('.mlsdoc-ok');
      if (okBox || (head && READY_RE.test(head.textContent || ''))) {
        if (head) head.innerHTML = '<span>' + WARN_EMOJI + '</span><span>No signed-in athenaOne tab</span>';
        if (okBox) {
          var fix = document.createElement('div');
          fix.className = 'mlsdoc-fix';
          fix.textContent = 'Do this: open a signed-in athenaOne tab in this browser, then re-check.';
          okBox.parentNode.replaceChild(fix, okBox);
        }
      }
    } catch (e) {}
  }
  function scheduleDocCorrect() {
    if (_docRaf) return;
    var run = function () { _docRaf = 0; correctDoctorPanel(); };
    if (W.requestAnimationFrame) _docRaf = W.requestAnimationFrame(run); else _docRaf = setTimeout(run, 16);
  }
  function startDocObserver() {
    try {
      _docObs = new MutationObserver(function () { scheduleDocCorrect(); });
      _docObs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }

  // ---- attach when __mlsConnTruth is available ----------------------------
  function tryAttach() {
    var CT = W.__mlsConnTruth;
    if (CT && typeof CT.isConnected === 'function') {
      harden(CT);
      // prime a host sample so the first render has truth to read
      maybeRefresh();
      return true;
    }
    return false;
  }
  function scheduleAttach() {
    if (tryAttach()) return;
    _attachTimer = setInterval(function () {
      _attachTries++;
      if (tryAttach() || _attachTries > 120) {  // ~ up to 60s, then give up quietly
        try { clearInterval(_attachTimer); } catch (e) {}
        _attachTimer = null;
      }
    }, 500);
  }

  // ---- boot ---------------------------------------------------------------
  function boot() {
    installListener();
    scheduleAttach();
    startDocObserver();
  }

  function revert() {
    try { if (_attachTimer) { clearInterval(_attachTimer); _attachTimer = null; } } catch (e) {}
    try { if (_msgHandler) { W.removeEventListener('message', _msgHandler, true); _msgHandler = null; } } catch (e) {}
    try { if (_docObs) { _docObs.disconnect(); _docObs = null; } } catch (e) {}
    try { if (_docRaf && W.cancelAnimationFrame) W.cancelAnimationFrame(_docRaf); } catch (e) {}
    _docRaf = 0;
    unharden();
    lastSched = { responded: false, ok: false, host: '', isAthena: false, at: 0 };
    if (W.__mlsAthenaTruthCheck) W.__mlsAthenaTruthCheck.installed = false;
  }

  // ---- public API (also drives the offline tests) -------------------------
  W.__mlsAthenaTruthCheck = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    ATHENA_RE: ATHENA_RE,
    hostFromUrl: hostFromUrl,
    isAthenaHost: isAthenaHost,
    evaluate: evaluate,
    probe: probe,
    harden: harden,                 // exposed for tests (idempotent)
    recordReply: recordReply,       // exposed for tests
    athenaFresh: athenaFresh,
    phantomFresh: phantomFresh,
    correctedState: correctedState,
    correctDoctorPanel: correctDoctorPanel,   // exposed for tests
    state: function () { return lastSched; },
    revert: revert
  };

  try {
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else {
      boot();
    }
  } catch (e) { try { boot(); } catch (e2) {} }
})();
