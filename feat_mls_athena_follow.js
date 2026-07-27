/* =============================================================================
 * __mlsAthenaFollow  af-1.0.0  (2026-07-27 — owner-approved 2026-07-26/27:
 * "Automatic with context", then made BIDIRECTIONAL by his follow-up.)
 * -----------------------------------------------------------------------------
 * The banner patient and the open athenaOne chart follow each other:
 *
 *   LEG A (MLS -> Athena): when the doctor picks a patient in MLS (the
 *   first-party 'mls:active-patient-changed' event), the extension navigates
 *   athenaOne to that patient via the PROVEN search-open lane
 *   (mlsAppSearchOpenPatient — the same identity-gated machinery Verify-in-
 *   Athena and the write flow use). Before navigating we ask which chart is
 *   already open and skip when it is already the right person.
 *
 *   LEG B (Athena -> MLS): the moment the doctor ARRIVES on the MLS tab
 *   (visibilitychange/focus — the event IS the tab switch; no polling, which
 *   an occluded tab throttles to uselessness anyway), MLS asks the extension
 *   which chart is open (mlsAppChartIdentity, new in ext 3.0.23, read-only,
 *   trusted-origin-gated) and follows it — EXACT resolution only.
 *
 * GUARDRAILS (each one load-bearing):
 *   - OFF SWITCH: #athenaFollowToggle in Settings -> Integrations; stored as
 *     uns('athenaFollowOff') so absent = ON (the owner chose automatic).
 *   - Extension gate: both legs require a real mlsPong >= 3.0.23. No pong, no
 *     follow — never a guess about what the extension can do.
 *   - Never while a pull is running (the pull DRIVES the athena tab; a
 *     search-open would wreck the drive): __mlsPullBusyAt fresh or the pull
 *     button off idle = busy.
 *   - Never while recording (captureBtn shows "Stop" — the first-party probe
 *     idiom feat_mls_easy uses).
 *   - Leg A fires only while MLS is VISIBLE (doctor-driven changes; an
 *     auto-writer changing the banner in a hidden tab must not yank Athena).
 *   - Loop suppression: when Leg B sets the banner it stamps a 5s window in
 *     which Leg A ignores the resulting change event.
 *   - Debounce 1500ms (Leg A) / 800ms dedupe (Leg B). Timers only run in a
 *     visible tab by construction (both triggers imply visibility).
 *   - Identity: Leg B resolves by FULL normalized-name equality against the
 *     local patient list, requires uniqueness, and requires DOB agreement
 *     whenever both sides have one. Ambiguity = do nothing (fail closed).
 *   - No setInterval, no observers. Everything removable via revert().
 * ==========================================================================*/
(function () {
  'use strict';
  var VERSION = 'af-1.0.0';
  var MIN_EXT = '3.0.23';
  var previous = null;
  try { previous = window.__mlsAthenaFollow; } catch (e0) {}
  if (previous && previous.installed && previous.version === VERSION) return;
  if (previous && typeof previous.revert === 'function') { try { previous.revert(); } catch (e1) {} }

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function isFn(f) { return typeof f === 'function'; }
  function toast(msg) { safe(function () { if (isFn(window.toast)) window.toast(msg, ''); }); }

  /* ------------------------------ state ---------------------------------- */
  var legATimer = null;
  var suppressUntil = 0;      /* Leg A ignores banner changes until this time */
  var lastArrival = 0;        /* Leg B dedupe */
  var pongVersion = null;     /* cached ONLY on success; a missed ping retries */
  var lastPingAt = 0;         /* ...but at most every 30s, not per keystroke */
  var seq = 0;

  /* ---------------------------- guards ----------------------------------- */
  function enabled() {
    return safe(function () { return localStorage.getItem(uns('athenaFollowOff')) !== '1'; }, false);
  }
  function setEnabled(on) {
    safe(function () {
      if (on) localStorage.removeItem(uns('athenaFollowOff'));
      else localStorage.setItem(uns('athenaFollowOff'), '1');
    });
    syncToggle();
  }
  function pullBusy() {
    var stampFresh = safe(function () { return (Date.now() - (window.__mlsPullBusyAt || 0)) < 120000; }, false);
    var btnBusy = safe(function () {
      var b = $('mlsDsPullBtn');
      if (!b) return false;
      var t = S(b.textContent).trim();
      return !!t && !/^📥?\s*Pull\b/i.test(t);
    }, false);
    return stampFresh || btnBusy;
  }
  function recording() {
    return safe(function () { var b = $('captureBtn'); return !!b && /stop/i.test(S(b.textContent)); }, false);
  }

  /* --------------------------- bridge helpers ---------------------------- */
  function bridgeOnce(sendType, payload, resultType, timeoutMs) {
    return new Promise(function (resolve) {
      var rid = 'af' + Date.now().toString(36) + (seq++);
      var done = false;
      function finish(v) { if (done) return; done = true; try { window.removeEventListener('message', onMsg); } catch (e) {} resolve(v); }
      function onMsg(e) {
        var d = e && e.data;
        if (!d || d.source !== 'mls-ext' || d.type !== resultType) return;
        if (d.requestId && d.requestId !== rid) return;
        finish(d.resp || d);
      }
      try { window.addEventListener('message', onMsg); } catch (e) { return finish(null); }
      var body = { source: 'mls-app', type: sendType, requestId: rid };
      if (payload) for (var k in payload) { if (Object.prototype.hasOwnProperty.call(payload, k)) body[k] = payload[k]; }
      try { window.postMessage(body, location.origin); } catch (e2) { return finish(null); }
      setTimeout(function () { finish(null); }, timeoutMs || 4000);
    });
  }
  function cmpVer(a, b) {
    var x = S(a).split('.').map(Number), y = S(b).split('.').map(Number);
    for (var i = 0; i < 3; i++) { var d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
    return 0;
  }
  async function extReady() {
    /* success is cached; a MISSED ping is not — an extension that was asleep
       at boot must not disable follow for the whole page life. Re-ask on the
       next trigger, throttled to one ping per 30s. */
    if (pongVersion && cmpVer(pongVersion, MIN_EXT) >= 0) return true;
    if (pongVersion && cmpVer(pongVersion, MIN_EXT) < 0) return false;
    var now = Date.now();
    if (now - lastPingAt < 30000) return false;
    lastPingAt = now;
    var pong = await bridgeOnce('mlsPing', null, 'mlsPong', 2500);
    pongVersion = (pong && pong.version) ? S(pong.version) : null;
    return !!pongVersion && cmpVer(pongVersion, MIN_EXT) >= 0;
  }
  async function openChartIdentity() {
    var r = await bridgeOnce('mlsAppChartIdentity', null, 'mlsAppChartIdentityResult', 6000);
    return (r && r.ok && r.identity && r.identity.name) ? r.identity : null;
  }

  /* --------------------------- identity math ------------------------------ */
  function normName(s) {
    return S(s).toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(function (w) { return w.length > 1; }).sort().join(' ');
  }
  function normDob(s) {
    var m = S(s).match(/(\d{1,4})[\/\-.](\d{1,2})[\/\-.](\d{1,4})/);
    if (!m) return '';
    var a = +m[1], b = +m[2], c = +m[3];
    if (m[1].length === 4) return a + '-' + b + '-' + c;      /* YYYY-M-D */
    return c + '-' + a + '-' + b;                              /* M/D/YYYY */
  }
  function samePerson(aName, aDob, bName, bDob) {
    if (!aName || !bName || normName(aName) !== normName(bName)) return false;
    var da = normDob(aDob), db = normDob(bDob);
    if (da && db && da !== db) return false;
    return true;
  }
  function resolveLocal(identity) {
    var list = safe(function () { return isFn(window.getPatients) ? (window.getPatients() || []) : []; }, []);
    var hits = list.filter(function (p) { return p && samePerson(identity.name, identity.dob, p.name, p.dob); });
    return hits.length === 1 ? hits[0] : null;   /* unique or nothing */
  }

  /* ------------------------------ LEG A ----------------------------------- */
  function onActiveChanged(ev) {
    if (!enabled()) return;
    if (Date.now() < suppressUntil) return;                       /* Leg B just wrote */
    if (safe(function () { return document.visibilityState; }, '') !== 'visible') return;
    var id = safe(function () { return S(ev && ev.detail && ev.detail.patientId); }, '');
    if (!id) return;
    if (legATimer) { try { clearTimeout(legATimer); } catch (e) {} }
    legATimer = setTimeout(function () { legATimer = null; legAFire(id); }, 1500);
  }
  async function legAFire(id) {
    try {
      if (!enabled() || pullBusy() || recording()) return;
      if (Date.now() < suppressUntil) return;
      var cur = safe(function () { return isFn(window.getActivePtId) ? S(window.getActivePtId()) : ''; }, '');
      if (cur !== id) return;                                     /* stale debounce */
      var p = safe(function () { return isFn(window.findPatient) ? window.findPatient(id) : null; }, null);
      if (!p || !S(p.name).trim()) return;
      if (!(await extReady())) return;
      if (pullBusy() || recording()) return;                      /* re-check after awaits */
      var open = await openChartIdentity();
      if (open && samePerson(open.name, open.dob, p.name, p.dob)) return;   /* already there */
      if (pullBusy() || recording() || !enabled()) return;
      window.postMessage({ source: 'mls-app', type: 'mlsAppSearchOpenPatient', name: S(p.name).slice(0, 120), dob: S(p.dob || '').slice(0, 20) }, location.origin);
      toast('↔ Opening ' + S(p.name).split(' ')[0] + ' in athenaOne…');
    } catch (e) {}
  }

  /* ------------------------------ LEG B ----------------------------------- */
  function onArrive() {
    if (!enabled()) return;
    var now = Date.now();
    if (now - lastArrival < 800) return;
    lastArrival = now;
    legBFire();
  }
  async function legBFire() {
    try {
      if (pullBusy() || recording()) return;
      if (!(await extReady())) return;
      var identity = await openChartIdentity();
      if (!identity) return;
      var p = resolveLocal(identity);
      if (!p) return;                                             /* ambiguous / unknown = silence */
      var cur = safe(function () { return isFn(window.getActivePtId) ? S(window.getActivePtId()) : ''; }, '');
      if (S(p.id) === cur) return;
      if (pullBusy() || recording() || !enabled()) return;
      suppressUntil = Date.now() + 5000;
      safe(function () { if (isFn(window.setActivePtId)) window.setActivePtId(S(p.id)); });
      toast('↔ Following athenaOne: ' + S(p.name));
    } catch (e) {}
  }
  function onVisibility() { if (safe(function () { return document.visibilityState; }, '') === 'visible') onArrive(); }

  /* --------------------------- settings toggle ---------------------------- */
  function syncToggle() {
    safe(function () { var t = $('athenaFollowToggle'); if (t) t.checked = enabled(); });
  }
  function onToggle() {
    safe(function () { var t = $('athenaFollowToggle'); if (t) setEnabled(!!t.checked); });
  }
  function wireToggle() {
    var t = $('athenaFollowToggle');
    if (t && !t.__afWired) { t.__afWired = 1; t.addEventListener('change', onToggle); }
    syncToggle();
  }

  window.addEventListener('mls:active-patient-changed', onActiveChanged);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onArrive);
  wireToggle();
  /* first arrival: if the page loads already-visible (doctor came straight
     here), one identity check now — same guard set as any arrival. */
  if (safe(function () { return document.visibilityState; }, '') === 'visible') onArrive();

  var api = {
    installed: true,
    version: VERSION,
    minExt: MIN_EXT,
    enabled: enabled,
    setEnabled: setEnabled,
    _samePerson: samePerson,
    _normDob: normDob,
    _resolveLocal: resolveLocal,
    _resetExtCache: function () { pongVersion = null; lastPingAt = 0; },
    _guards: { pullBusy: pullBusy, recording: recording },
    describe: function () {
      return 'bidirectional Athena<->MLS patient follow: Leg A posts the proven ' +
        'search-open lane on doctor-driven banner changes (visible tab only, ' +
        'skip-if-already-open); Leg B follows the open athenaOne chart on tab ' +
        'arrival via ext ' + MIN_EXT + '\'s read-only chart-identity verb. ' +
        'Guards: off-switch, pong>=' + MIN_EXT + ', never during a pull, never ' +
        'while recording, loop suppression, exact unique identity only.';
    },
    revert: function () {
      api.installed = false;
      try { window.removeEventListener('mls:active-patient-changed', onActiveChanged); } catch (e2) {}
      try { document.removeEventListener('visibilitychange', onVisibility); } catch (e3) {}
      try { window.removeEventListener('focus', onArrive); } catch (e4) {}
      try { if (legATimer) clearTimeout(legATimer); } catch (e5) {}
      try { var t = $('athenaFollowToggle'); if (t && t.__afWired) { t.removeEventListener('change', onToggle); t.__afWired = 0; } } catch (e6) {}
      try { if (window.__mlsAthenaFollow === api) delete window.__mlsAthenaFollow; } catch (e7) {}
    }
  };
  window.__mlsAthenaFollow = api;
})();
