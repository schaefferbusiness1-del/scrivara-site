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
 * -----------------------------------------------------------------------------
 * legboffer-1.0.0 (2026-09-11) -- LEG B MAY OFFER. IT MAY NOT TAKE THE DOCTOR
 * OFF THE CHART HE IS WRITING ABOUT.
 *
 * MEASURED live on b1231 (owner's tab, synthetic test patient): he pressed the
 * note step's own primary button, "Next: Review & send to Athena". That opens
 * the unified Send sheet, and the sheet's READ-ONLY probe DRIVES athenaOne
 * itself (mlsAppGotoDate + mlsAppSearchOpenPatient, the 'auto-open' /
 * 'auto-open-encounter' stages) to prove the encounter. athenaOne is left
 * parked on a SCHEDULED chart. He comes back to the MLS tab, Leg B asks which
 * chart is open, hears that other person, and calls setActivePtId - which
 * aborts the generation, resets the AI outputs, stops capture and drops the
 * engine back to Home: "Start Recording - <other patient>". His draft is gone.
 *
 * Nothing above was wrong about WHO athenaOne was showing. What was wrong is
 * that following is a SWITCH. The owner's ruling is that the header patient is
 * the patient for the day and an automatic caller never switches the active
 * patient and never prompts; a doctor's own switch asks once. So:
 *
 *   - MLS'S OWN NAVIGATION IS IGNORED OUTRIGHT. Leg B now consults the two
 *     shipped answers to "is MLS driving athenaOne" -
 *     window._mlsCaptureKeepsSelection(lane, false) (capsel-1.0.0) and the
 *     write lane's own window.__mlsWriteFlow.state.athenaBusy /.athenaBusyAt
 *     (wfnav-1.0.0, which also finally makes dnote-1.1.0's long-dead
 *     "write-lane" claim fire) - and an arrival MLS caused moves nothing and
 *     says nothing. The grace stamp covers the seconds AFTER the hop, while
 *     the doctor is still arriving back on this tab.
 *   - WITH VISIT WORK IN FLIGHT, LEG B OFFERS INSTEAD OF SWITCHING. A chart is
 *     already active and there is a transcript, a note, an open Send sheet or
 *     the review step on screen -> it renders the SAME offer the schedule
 *     anchor renders (window.__mlsPtAnchor.offer: "You are working in a
 *     different chart, so nothing was switched", plus a Switch button that is
 *     a human press). One painter, one wording, one behaviour.
 *   - EVERYTHING ELSE IS UNCHANGED. No chart active and the editors empty -
 *     the case Leg B was built for - still follows athenaOne exactly as before.
 * ==========================================================================*/
(function () {
  'use strict';
  var VERSION = 'af-1.1.0';
  var OFFER_VERSION = 'legboffer-1.0.0';
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
  /* legboffer-1.0.0 receipt. PHI-FREE: counts and timestamps, never a person. */
  var stats = { follows: 0, offers: 0, offersPainted: 0, drivenIgnored: 0,
    lastOfferAt: 0, lastDrivenAt: 0 };

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
    var xtabFresh = safe(function () {
      /* qol-1.4: the per-tab checks are blind to a pull running in another
         MLS tab; the managed pull stamps uns('mlsPullBusyXTabV1') with a
         timestamp - honor it here so Follow can never search-open a chart
         into a drive it cannot see. */
      var k = (typeof window.uns === 'function') ? window.uns('mlsPullBusyXTabV1') : 'mlsPullBusyXTabV1';
      var v = Number(localStorage.getItem(k) || 0);
      return v > 0 && (Date.now() - v) < 120000;
    }, false);
    return stampFresh || btnBusy || xtabFresh;
  }
  function recording() {
    return safe(function () { var b = $('captureBtn'); return !!b && /stop/i.test(S(b.textContent)); }, false);
  }

  /* ---- legboffer-1.0.0 guards -------------------------------------------- */
  /* WAS IT MLS THAT MOVED ATHENAONE? Two shipped answers, both read-only, and
     neither is invented here. capsel-1.0.0's predicate is the ambient "is some
     MLS lane driving athenaOne" (scopedOnly false is the right question for
     Follow: nothing a human presses reaches this code). The write lane's own
     wfnav-1.0.0 stamp answers for the Send sheet's probe, including the grace
     seconds after its last hop - the exact moments the doctor spends coming
     back to this tab. With neither present nothing is driving, which is the
     same fail-open toward the doctor the rest of this module uses. */
  var WF_NAV_FALLBACK_GRACE_MS = 12000;
  function mlsDrivingAthena() {
    var keep = safe(function () {
      return isFn(window._mlsCaptureKeepsSelection) &&
        window._mlsCaptureKeepsSelection('athena-follow-legb', false) === true;
    }, false);
    if (keep) return true;
    return safe(function () {
      var wf = window.__mlsWriteFlow;
      if (!wf) return false;
      var nav = wf.athenaNav;
      if (nav && isFn(nav.driving)) return nav.driving() === true;
      var st = wf.state;
      if (!st || typeof st !== 'object') return false;
      if (st.athenaBusy === true) return true;
      var at = Number(st.athenaBusyAt || 0);
      return at > 0 && (Date.now() - at) < WF_NAV_FALLBACK_GRACE_MS;
    }, false);
  }
  /* IS THERE VISIT WORK ON SCREEN THAT A SWITCH WOULD THROW AWAY? Read the
     doctor's own surfaces, never a flag somebody else maintains: the words he
     captured, the note that came out, the Send sheet he opened, the review
     step he is standing on. */
  function fieldText(id) {
    return safe(function () {
      var el = $(id);
      if (!el) return '';
      return S(el.value != null ? el.value : el.textContent).trim();
    }, '');
  }
  function bodyHas(cls) {
    return safe(function () {
      var b = document.body;
      return !!(b && b.classList && b.classList.contains(cls));
    }, false);
  }
  function visitWorkInFlight() {
    if (fieldText('transcript')) return true;
    if (fieldText('noteBox')) return true;
    if ($('mlsAthenaUnifiedConfirm')) return true;
    if (bodyHas('mls-review-step')) return true;
    if (bodyHas('ez3adv')) return true;
    return false;
  }
  /* THE OFFER IS THE SCHEDULE ANCHOR'S OFFER. __mlsPtAnchor.offer is the one
     painter (1p-mls-connect.js, revwork) - same markup, same sentence, same
     Switch button, which is a human press and the only thing that moves the
     patient. No host to paint into (the doctor is not on the visit screen) =>
     the toast alone. Either way NOTHING is switched. */
  var OFFER_SAY_AGAIN_MS = 60000;
  var lastOfferId = '', lastSaidAt = 0;
  function offerInstead(p) {
    var now = Date.now();
    stats.offers++;
    stats.lastOfferAt = now;
    var painted = safe(function () {
      var a = window.__mlsPtAnchor;
      return !!(a && isFn(a.offer) && a.offer(S(p.name), S(p.id)) === true);
    }, false);
    if (painted) stats.offersPainted++;
    /* The offer itself is idempotent and stays on screen; the SENTENCE is not
       repeated at a doctor who flips tabs. Same person inside a minute = the
       standing offer already says it. */
    if (S(p.id) !== lastOfferId || (now - lastSaidAt) > OFFER_SAY_AGAIN_MS) {
      lastOfferId = S(p.id); lastSaidAt = now;
      toast('athenaOne is showing ' + S(p.name) + '. Nothing was switched - your work here is safe.');
    }
    return painted;
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
      /* legboffer-1.0.0: the same rule the pull guard states one line above -
         a lane that is DRIVING athenaOne owns that tab, and a search-open on
         top of it wrecks the drive. The Send sheet's read-only probe is such a
         lane; it just never said so until wfnav-1.0.0. */
      if (mlsDrivingAthena()) return;
      if (!(await extReady())) return;
      if (pullBusy() || recording() || mlsDrivingAthena()) return; /* re-check after awaits */
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
      /* legboffer-1.0.0: an arrival MLS itself caused is not the doctor
         navigating athenaOne. Checked before the ask and again after the
         awaits, because the Send sheet's probe starts a hop at any moment. */
      if (mlsDrivingAthena()) { stats.drivenIgnored++; stats.lastDrivenAt = Date.now(); return; }
      if (!(await extReady())) return;
      var identity = await openChartIdentity();
      if (!identity) return;
      var p = resolveLocal(identity);
      if (!p) return;                                             /* ambiguous / unknown = silence */
      var cur = safe(function () { return isFn(window.getActivePtId) ? S(window.getActivePtId()) : ''; }, '');
      if (S(p.id) === cur) return;
      if (pullBusy() || recording() || !enabled()) return;
      if (mlsDrivingAthena()) { stats.drivenIgnored++; stats.lastDrivenAt = Date.now(); return; }
      /* legboffer-1.0.0: a chart is already up and there is visit work on
         screen. OFFER, NEVER SWITCH - a switch here throws away the draft. */
      if (cur && visitWorkInFlight()) { offerInstead(p); return; }
      suppressUntil = Date.now() + 5000;
      stats.follows++;
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
    offerVersion: OFFER_VERSION,
    minExt: MIN_EXT,
    enabled: enabled,
    setEnabled: setEnabled,
    _samePerson: samePerson,
    _normDob: normDob,
    _resolveLocal: resolveLocal,
    _resetExtCache: function () { pongVersion = null; lastPingAt = 0; },
    _guards: { pullBusy: pullBusy, recording: recording,
      mlsDriving: mlsDrivingAthena, visitWork: visitWorkInFlight },
    /* legboffer-1.0.0 receipt: PHI-free counts. How often Leg B followed, how
       often it offered instead, and how often it ignored our own navigation. */
    receipt: function () {
      return { version: VERSION, offerVersion: OFFER_VERSION,
        follows: stats.follows, offers: stats.offers, offersPainted: stats.offersPainted,
        drivenIgnored: stats.drivenIgnored, lastOfferAt: stats.lastOfferAt,
        lastDrivenAt: stats.lastDrivenAt,
        drivingNow: mlsDrivingAthena(), visitWorkNow: visitWorkInFlight() };
    },
    describe: function () {
      return 'bidirectional Athena<->MLS patient follow: Leg A posts the proven ' +
        'search-open lane on doctor-driven banner changes (visible tab only, ' +
        'skip-if-already-open); Leg B follows the open athenaOne chart on tab ' +
        'arrival via ext ' + MIN_EXT + '\'s read-only chart-identity verb. ' +
        'Guards: off-switch, pong>=' + MIN_EXT + ', never during a pull, never ' +
        'while recording, loop suppression, exact unique identity only. ' +
        OFFER_VERSION + ': an arrival MLS itself caused moves nothing, and with ' +
        'a chart up and visit work on screen Leg B renders the schedule ' +
        'anchor\'s offer instead of switching the doctor off his draft.';
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
