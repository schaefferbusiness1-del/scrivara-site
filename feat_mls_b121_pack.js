/* ===== MLS b121 pack — 2026-07-10 (day shift) ==============================
 * ONE satellite carrying five additive, individually-revertible modules.
 * Loaded by a single loader line in mls-connect.js (build 2026-07-10-b121),
 * inserted after the feat_mls_asst_fix.js loader anchor.
 *
 * Order matters:
 *   1. __mlsAddVisitCycleGuard  — must claim __mlsVisitModel.addVisit before
 *                                 any satellite heartbeat re-wraps it (fixes
 *                                 the live "ingest: Maximum call stack size
 *                                 exceeded" mutual-recursion cycle).
 *   2. __mlsDayKeyFix           — schedule-import date keying (target-date,
 *                                 never the displayed day) + provider
 *                                 canonicalization (month-roster gate).
 *   3. __mlsDedupById           — athena-patient-ID-primary dedup; DRY-RUN
 *                                 by default; runOnce({confirm:'EXECUTE'}).
 *   4. __mlsVisitsBackfill      — background per-visit history backfill via
 *                                 the v1.89 mlsAppReadVisits bridge.
 *   5. __mlsPullAnyDay          — Staff-prep "Pull a specific day" UI under
 *                                 the month card (schedule + charts, one
 *                                 flow, idempotent).
 *
 * Revert (console): __mlsPullAnyDay.revert(); __mlsVisitsBackfill.revert();
 *   __mlsDedupById.revert(); __mlsDayKeyFix.revert();
 *   __mlsAddVisitCycleGuard.revert();
 * Removing the loader line from mls-connect.js removes the whole pack.
 * Zero writes to athenaOne originate here: every module is app/store-side;
 * the only athena interaction is the READ bridge (mlsAppReadVisits).
 * ========================================================================= */

/* =========================================================================
 * MLS Scribe - ADDVISIT RE-WRAP CYCLE GUARD  (__mlsAddVisitCycleGuard) v1.1.0
 * 2026-07-10 (b121 pack; ships inside feat_mls_b121_pack.js)
 *
 * FIX: the day/month history pull failed a patient with
 *   'ingest:Maximum call stack size exceeded'
 * (live repro: Bob Dunne, 2026-07-10, b120). The overflow is NOT in the
 * visit parser and NOT re-entry of any __mlsVisitModel public function -
 * it is a mutual-recursion CYCLE between the only two satellite wrappers
 * of __mlsVisitModel.addVisit, the exact defect class __mlsRunCycleGuard
 * (2026-07-08) fixed for __mlsCopyVisits.run but never covered for addVisit:
 *
 *   feat_visits_honest.js  wrapAddVisit (lines 83-92): captures its inner fn
 *     in a LOCAL (`var orig = M.addVisit.bind(M)`), marks ONLY
 *     `__honestWrapped`, does NOT carry the other module's marker forward.
 *   feat_source_clarity.js wrapAddVisit (lines 408-428): keeps its inner fn
 *     in a MODULE-LEVEL `_origAddVisit` that is re-read AT CALL TIME and
 *     OVERWRITTEN on every re-wrap, marks ONLY `__mlsSrcWrapped`, and
 *     re-checks on a 1200 ms heartbeat FOREVER (boot() also wraps
 *     synchronously at script evaluation).
 *
 *   Load-order race (clarity first): clarity wraps base -> c1. honest wraps
 *   c1 -> h1 (h1 lacks __mlsSrcWrapped). clarity's next tick re-wraps
 *   h1 -> c2 and OVERWRITES `_origAddVisit = h1` (the pointer to the real
 *   model function is lost). Any call then goes c2 -> h1 -> (h1's captured
 *   orig) c1 -> c1 reads the MODULE-LEVEL `_origAddVisit` AT CALL TIME
 *   = h1 -> h1 -> c1 -> ... infinite h1<->c1 mutual recursion that never
 *   passes through the public M.addVisit again - which is why re-entry
 *   guards placed on ALL public model functions never fired during the
 *   live crash. RangeError the moment the pull's ingest step files the
 *   visit (mls-connect.js 6024-6034: `M.addVisit(p.id, {type:'Chart
 *   summary', ...})` inside the 'ingest:' try/catch).
 *
 * WHY IT LOOKED BOB-SPECIFIC (two mechanisms, both consistent with the
 * live observation that other patients' addVisit calls completed):
 *   1. The pull's todo filter skips every patient hasPulled() already
 *      accepts (>400-char 'pulled from athena' summary, mls-connect.js
 *      5945) - those patients never call addVisit at all. Bob's minimal
 *      row (no summary) reached the poisoned wrapper.
 *   2. The cycle ARMS MID-SESSION on a clarity heartbeat tick (the
 *      re-wrap ~1.2 s after honest wraps a clarity-wrapped chain), so
 *      addVisit calls made EARLIER in the same session complete normally;
 *      every call AFTER the arming tick overflows. Residual uncertainty
 *      about which calls landed on which side of that tick is irrelevant
 *      to the fix: this guard is UNCONDITIONAL - it does not depend on
 *      patient data, timing, or load order.
 *
 * THE FIX (additive, reversible; per verdicts wf_16 + wf_17):
 *   1. UNCONDITIONAL INSTALL: on every guard tick, if the top of
 *      M.addVisit does not carry the guard marker, install ONE combined
 *      wrapper ON TOP OF WHATEVER FUNCTION IS CURRENT (pristine base OR a
 *      satellite-wrapped chain). The wrapper carries BOTH satellites'
 *      idempotency markers (__honestWrapped + __mlsSrcWrapped), so neither
 *      satellite ever wraps again above it - and ONLY the guard's own
 *      wrapper carries them: no marker is ever written onto someone
 *      else's function, so a satellite's FIRST legitimate wrap (and the
 *      safety behavior it installs) is never suppressed. Inner wrappers
 *      that already exist keep running unchanged beneath the guard.
 *   2. The combined wrapper re-provides both satellite behaviors even
 *      when a satellite never gets to wrap:
 *        (a) honest empty-visit gate - delegated LIVE to
 *            window.__mlsVisitsHonest._gating()/isRealVisit() (exported by
 *            the live satellite, verified), so gating semantics stay
 *            identical and disappear only if that satellite is unloaded
 *            (same as live today);
 *        (b) source-clarity's additive importedAt tag.
 *   3. TWO-ARG CALL SHAPE ON PURPOSE (the 3rd `opts` arg is dropped):
 *      this is byte-for-byte parity with the live b120 honest wrapper
 *      (`return orig(patient, visit)`), which is the addVisit surface
 *      every live caller has been running against. That parity is the
 *      SOLE rationale. (Whether __mlsChartStructure.addStructuredVisits'
 *      persist:false visits actually survive live is a SEPARATE open
 *      investigation - its caller later upserts its own pre-fetched clone
 *      over the store (mls-connect.js ~3925-3932 + ScribeFlow.html
 *      upsertPatient arr[i]=p) - do NOT 'fix' the opts pass-through as
 *      part of this guard.)
 *   4. HONEST LIMIT: the cycle CANNOT FORM ONCE THE GUARD ENGAGES; a
 *      cycle that armed BEFORE the guard loaded is DETECTED AND REPORTED,
 *      not repaired - repair is impossible (the pristine base pointer is
 *      unrecoverable once clarity overwrites _origAddVisit, and honest's
 *      __orig is a bound function that strips the target's own props).
 *      On detection the guard:
 *        - sets mode='armed-cycle-detected', installed=false,
 *          state.armedCycle=true, window.__mlsPullBlocked=
 *          'addvisit-cycle-armed' (flag any pull engine can check);
 *        - console.error's a reload advisory;
 *        - shows a fixed red banner in the MLS tab with a Reload button;
 *        - blocks the day-pull (#mlsDayHistBtn) and month-pull
 *          (#mlsPmpBtn) buttons via a capture-phase click listener
 *          (their onclick handlers call module-CLOSURE run() directly,
 *          so no public-surface wrap could intercept them);
 *        - replaces M.addVisit with a clean thrower so any pull path the
 *          buttons don't cover (e.g. programmatic pullMonth) fails
 *          per-row with 'ingest:addVisit disabled by
 *          __mlsAddVisitCycleGuard: ... RELOAD this tab' instead of an
 *          opaque stack overflow. The thrower changes nothing that
 *          works - every call into the armed chain already throws.
 *   5. TIMERS: ONE persistent Blob Worker posting interval messages
 *      (Worker timers are exempt from Chrome's background-tab throttling;
 *      main-thread timers are clamped to ~0 while athenaOne is
 *      foregrounded during pulls). Fast phase 100 ms x 1800 ticks
 *      (~3 min, beats honest's 500 ms and clarity's 1200 ms heartbeats),
 *      then a SLOW PERPETUAL 5 s cadence (clarity re-checks forever, so
 *      the guard must too - covers any future model re-creation). If
 *      Worker construction fails (CSP), the degradation is made VISIBLE
 *      via console.warn and capture-phase visibilitychange/focus hooks
 *      keep opportunistically ticking the guard.
 *   6. SELF-TEST triggered FROM THE TICK THAT INSTALLS the wrapper (plus
 *      one delayed retry ~12 s later, tick-counted, no wall-clock timer),
 *      so the deploy-verify criterion cannot false-fail on slow satellite
 *      loads; api.runSelfTest() re-runs it manually at any time.
 *      Probe safety (VERIFIED, the probe CANNOT write to localStorage):
 *      the probe patient id matches no record - window.findPatient
 *      (ScribeFlow.html:5671) matches by EXACT id and feat_visits.js
 *      addVisit line 109 (`var p=_findPatient(patientId); if(!p) return
 *      null;`) returns null BEFORE any _upsert/persist - so the full
 *      live wrapper chain is exercised (exactly where the b120 overflow
 *      lived) with zero store writes.
 *
 * DEPLOY (b121 pack):
 *   - This module is concatenated into feat_mls_b121_pack.js (one new
 *     satellite file, served next to the other feat_*.js satellites).
 *   - ONE loader line goes into mls-connect.js immediately AFTER the
 *     feat_mls_asst_fix.js loader anchor (live bundle line ~34087):
 *       ;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_b121_pack.js"]'))return;var s=document.createElement('script');s.src='feat_mls_b121_pack.js?v=20260710b121p1';s.setAttribute('data-mls-asset','feat_mls_b121_pack.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();
 *   - mls-connect.js is 2.15 MB and loads EMPTY in the GitHub web editor:
 *     make the loader-line edit via the proven fetch-raw ->
 *     transform-in-page -> SHA-verify -> dispatch-full-into-empty-editor
 *     path (CM6). Expect b113-style CRLF normalization (harmless).
 *   - This file is PURE ASCII on purpose (avoids the documented
 *     Invoke-WebRequest UTF-8 mis-decode and clipboard EOL gotchas).
 *
 * VERIFY AFTER DEPLOY (install is unconditional, so these lines ALWAYS
 * appear when the guard works - there is no second install mode):
 *   1. console shows '[MLS addvisit-cycle-guard] combined addVisit
 *      wrapper installed ...' and then 'self-test PASS ...';
 *   2. window.__mlsAddVisitCycleGuard.selfTest.addVisitProbe === 'pass'
 *      (if satellites load unusually slowly, run
 *      window.__mlsAddVisitCycleGuard.runSelfTest() manually);
 *   3. re-run the Bob Dunne pull: his row should file a 'Chart summary'
 *      visit and report ok instead of 'ingest:...'.
 *   If instead you see the red banner / 'ARMED WRAPPER CYCLE DETECTED':
 *   the session armed before the guard loaded - reload the tab (the
 *   fresh load installs the guard before the satellites can race) and
 *   verify again.
 *
 * READ-ONLY with respect to athenaOne and the patient store.
 * Revert: window.__mlsAddVisitCycleGuard.revert()
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsAddVisitCycleGuard) return; } catch (e0) { return; }

  var TAG = '[MLS addvisit-cycle-guard]';
  var FAST_MS = 100, FAST_TICKS = 1800, SLOW_MS = 5000;
  var RETRY_AFTER_MS = 12000;
  var BANNER_ID = 'mlsAvcgBanner';
  var ARMED_MSG = 'addVisit disabled by __mlsAddVisitCycleGuard: a wrapper re-wrap cycle armed before the guard loaded. RELOAD this MLS tab, then re-run the pull.';

  var api = {
    version: '1.1.0',
    build: '2026-07-10-b121-pack',
    installed: false,          /* guard wrapper is on the chain and no armed cycle detected */
    mode: '',                  /* '' | 'wrapped' | 'armed-cycle-detected' | 'reverted' | 'revert-refused-buried' */
    selfTest: null,            /* { normVisit, addVisitProbe, error, trigger, at } */
    state: {
      ticks: 0,                /* worker/fallback timer ticks only (events do not count) */
      phase: 'fast',           /* 'fast' (100ms) -> 'slow' (5s, perpetual) */
      workerOk: false,         /* true = Blob-Worker timer driving ticks */
      installs: 0,             /* how many times the combined wrapper was (re)installed */
      innerMarkers: null,      /* markers seen on the function we wrapped last */
      armedCycle: false,       /* pre-engagement cycle detected (sticky until reload/revert) */
      depthTrip: false,        /* the wrapper's own depth limiter fired (new top-passing cycle) */
      bannerShown: false,
      churnStopped: false,     /* re-install fuse blown (runaway third-party wrap churn) */
      log: []                  /* bounded event log (max 40) */
    },
    runSelfTest: null,         /* filled below */
    revert: null               /* filled below */
  };

  function log(m) {
    try { console.log(TAG, m); } catch (e) {}
    try {
      api.state.log.push(new Date().toISOString() + ' ' + m);
      if (api.state.log.length > 40) api.state.log.shift();
    } catch (e2) {}
  }

  /* ------------------------------------------------------------------ *
   *  Timer plumbing: ONE persistent Blob Worker posting interval ticks  *
   * ------------------------------------------------------------------ */
  var stopped = false;
  var _wk = null, _fbT = null, _curMs = FAST_MS;

  function startTimers() {
    try {
      var url = URL.createObjectURL(new Blob(
        ['var t=null;onmessage=function(e){if(t){clearInterval(t);t=null;}var ms=e.data;if(ms>0){t=setInterval(function(){postMessage(1)},ms);}};'],
        { type: 'application/javascript' }
      ));
      _wk = new Worker(url);
      _wk.onmessage = function () { timerTick(); };
      _wk.postMessage(_curMs);
      api.state.workerOk = true;
      try { URL.revokeObjectURL(url); } catch (e1) {}
    } catch (e) {
      _wk = null;
      api.state.workerOk = false;
      try {
        console.warn(TAG, 'Worker timers unavailable (' + ((e && e.message) || e) + ') - falling back to main-thread timers, which Chrome throttles to ~0 while this tab is hidden. Guard installation may be delayed until the tab is next visible; capture-phase visibility/focus hooks remain active.');
      } catch (e2) {}
      fbLoop();
    }
  }
  function fbLoop() {
    if (stopped) return;
    timerTick();
    try { _fbT = setTimeout(fbLoop, _curMs); } catch (e) {}
  }
  function setCadence(ms) {
    _curMs = ms;
    if (_wk) { try { _wk.postMessage(ms); } catch (e) {} }
    /* fallback loop picks _curMs up on its next self-schedule */
  }

  /* ------------------------------------------------------------------ *
   *  The combined wrapper                                               *
   * ------------------------------------------------------------------ */
  var INNER = null;   /* the function the guard wrapped last (for revert) */
  var W = null;       /* the guard's combined wrapper (latest install) */
  var THROWN = null;  /* the armed chain the clean thrower replaced */
  var THR = null;     /* the clean thrower itself */

  function makeWrapper(inner, M) {
    var depth = 0;
    var w = function (patientId, visit, opts) {
      if (!api._reverted) {
        /* (a) honest empty-visit gate (feat_visits_honest section 48),
           delegated LIVE so semantics are identical to the satellite's own
           wrapper: during a gated copy/cohort operation, a visit with no
           real content is refused. Runs even when the satellite never got
           to wrap addVisit itself (the guard's markers make it bail). */
        try {
          var H = window.__mlsVisitsHonest;
          if (H && H.installed && typeof H._gating === 'function' && H._gating() > 0 &&
              typeof H.isRealVisit === 'function' && !H.isRealVisit(visit)) return null;
        } catch (eGate) {}
      }
      /* Belt-and-braces: a re-entry of THIS wrapper 24 frames deep can only
         be a NEW cycle passing through the public surface (no legitimate
         addVisit path re-enters at all). Convert the coming stack overflow
         into an honest, actionable failure. */
      if (depth > 24) {
        onArmedCycle('depth-limiter (new top-passing cycle)');
        api.state.depthTrip = true;
        throw new Error(ARMED_MSG);
      }
      /* (b) TWO-ARG call ON PURPOSE - byte-for-byte parity with the live
         b120 honest wrapper (`return orig(patient, visit)`), the surface
         every live caller has been running against. Parity is the sole
         rationale; see header note 3 for the open chart-structure
         persist:false investigation. Do not pass opts through. */
      var r;
      depth++;
      try {
        r = inner.call(M, patientId, visit);
      } finally {
        depth--;
      }
      if (!api._reverted) {
        /* (c) source-clarity mirror: additive importedAt metadata only */
        try { if (r && typeof r === 'object' && r.captured && !r.importedAt) r.importedAt = r.captured; } catch (eTag) {}
      }
      return r;
    };
    /* Future-proofing: carry the inner chain's enumerable props forward
       (mirrors clarity's own prop-copy), so any third-party marker-checking
       wrapper beneath us still sees its marker on the top and never
       re-wraps into churn. Then assert the guard's own markers LAST so
       they always win. */
    try { for (var k in inner) { try { w[k] = inner[k]; } catch (eCp) {} } } catch (eFor) {}
    w.__honestWrapped = true;        /* feat_visits_honest idempotency marker  */
    w.__mlsSrcWrapped = true;        /* feat_source_clarity idempotency marker */
    w.__mlsAddVisitCycleGuard = true;/* the guard's own top marker             */
    w.__orig = inner;                /* chain-walkable */
    return w;
  }

  function describeFn(fn) {
    var h = false, s = false;
    try { h = !!fn.__honestWrapped; } catch (e1) {}
    try { s = !!fn.__mlsSrcWrapped; } catch (e2) {}
    if (h && s) return 'a chain already carrying BOTH markers (healthy honest-first chain OR an armed cycle - self-test decides)';
    if (h) return 'the honest-wrapped chain';
    if (s) return 'the clarity-wrapped chain';
    return 'the pristine model addVisit';
  }

  /* ------------------------------------------------------------------ *
   *  Install policy (wf_17 preferred): ALWAYS wrap whatever is current  *
   * ------------------------------------------------------------------ */
  var _retryDueTick = 0;

  function ensureTop() {
    if (stopped) return;
    try {
      if (api.state.armedCycle) return;   /* frozen: thrower holds the surface */
      var M = window.__mlsVisitModel;
      if (!M || typeof M.addVisit !== 'function') return;
      var cur = M.addVisit;
      if (cur.__mlsAddVisitCycleGuard) return;  /* guard already on (or propagated to) top */
      if (api.state.installs >= 50) {
        if (!api.state.churnStopped) {
          api.state.churnStopped = true;
          try { console.warn(TAG, 're-install fuse blown after 50 installs - some other module is churning M.addVisit; leaving the current chain alone (guard wrapper remains inside it). Investigate before the next deploy.'); } catch (eW) {}
        }
        return;
      }
      INNER = cur;
      W = makeWrapper(cur, M);
      M.addVisit = W;
      api.state.installs++;
      api.state.innerMarkers = {
        honest: (function () { try { return !!cur.__honestWrapped; } catch (e) { return false; } })(),
        src: (function () { try { return !!cur.__mlsSrcWrapped; } catch (e) { return false; } })()
      };
      api.installed = true;
      if (api.mode !== 'armed-cycle-detected') api.mode = 'wrapped';
      log('combined addVisit wrapper installed on top of ' + describeFn(cur) + ' (install #' + api.state.installs + ') - re-wrap cycle cannot form above the guard');
      /* Self-test FROM the installing tick (wf_16 change 3) + one delayed
         tick-counted retry (~12 s), so slow satellite loads cannot
         false-fail the deploy-verify criterion. */
      runSelfTest('install');
      _retryDueTick = api.state.ticks + Math.ceil(RETRY_AFTER_MS / _curMs);
    } catch (e) {}
  }

  function timerTick() {
    if (stopped) return;
    api.state.ticks++;
    ensureTop();
    if (_retryDueTick && api.state.ticks >= _retryDueTick) {
      _retryDueTick = 0;
      if (!api.state.armedCycle) runSelfTest('delayed-retry');
    }
    if (api.state.armedCycle && !api.state.bannerShown) showBanner();
    if (api.state.phase === 'fast' && api.state.ticks >= FAST_TICKS) {
      api.state.phase = 'slow';
      setCadence(SLOW_MS);   /* perpetual: clarity's heartbeat never stops, so neither does the guard */
    }
  }

  /* ------------------------------------------------------------------ *
   *  Armed-cycle handling (detect + report; repair is impossible)       *
   * ------------------------------------------------------------------ */
  function onArmedCycle(how) {
    if (api.state.armedCycle) return;
    api.state.armedCycle = true;
    api.mode = 'armed-cycle-detected';
    api.installed = false;
    try { window.__mlsPullBlocked = 'addvisit-cycle-armed'; } catch (eF) {}
    try {
      console.error(TAG, 'ARMED WRAPPER CYCLE DETECTED (' + how + '). ' +
        'M.addVisit was poisoned by the honest<->clarity re-wrap race BEFORE this guard loaded; the pristine model function is unrecoverable in this session. ' +
        'Every chart pull that reaches ingest will fail. RELOAD THIS TAB before running any pull - on the fresh load the guard installs first and the cycle cannot form.');
    } catch (eE) {}
    /* Clean thrower at the chokepoint: nothing that works is changed
       (every call into the armed chain already overflows); pulls that do
       run now fail per-row with actionable text instead of a RangeError. */
    try {
      var M = window.__mlsVisitModel;
      if (M && typeof M.addVisit === 'function' && !M.addVisit.__mlsAvcgThrower) {
        THROWN = M.addVisit;
        var th = function () { throw new Error(ARMED_MSG); };
        try { for (var k in THROWN) { try { th[k] = THROWN[k]; } catch (eCp) {} } } catch (eFor) {}
        th.__honestWrapped = true;
        th.__mlsSrcWrapped = true;
        th.__mlsAddVisitCycleGuard = true;
        th.__mlsAvcgThrower = true;
        th.__orig = THROWN;
        M.addVisit = th;
        THR = th;
        log('clean thrower installed over the armed chain (pull rows will read "ingest:addVisit disabled by __mlsAddVisitCycleGuard: ... RELOAD ...")');
      }
    } catch (eT) {}
    showBanner();
  }

  function showBanner() {
    try {
      if (document.getElementById(BANNER_ID)) { api.state.bannerShown = true; return; }
      var host = document.body || document.documentElement;
      if (!host) return;   /* timerTick retries while armedCycle && !bannerShown */
      var b = document.createElement('div');
      b.id = BANNER_ID;
      b.setAttribute('role', 'alert');
      b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#7f1d1d;color:#fff;font:600 13.5px/1.5 system-ui,Segoe UI,Arial,sans-serif;padding:10px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;box-shadow:0 4px 14px rgba(0,0,0,.35)';
      var span = document.createElement('span');
      span.style.cssText = 'flex:1;min-width:240px';
      span.textContent = 'MLS: visit filing is broken in this session - a wrapper cycle armed before the b121 guard loaded. Any chart pull will fail. Reload this tab, then start the pull again.';
      var reload = document.createElement('button');
      reload.type = 'button';
      reload.textContent = 'Reload now';
      reload.style.cssText = 'background:#fff;color:#7f1d1d;border:0;border-radius:8px;padding:6px 14px;font:700 12.5px system-ui,Segoe UI,Arial,sans-serif;cursor:pointer';
      reload.onclick = function () { try { location.reload(); } catch (eR) {} };
      var dismiss = document.createElement('button');
      dismiss.type = 'button';
      dismiss.textContent = 'Dismiss';
      dismiss.style.cssText = 'background:transparent;color:#fecaca;border:1px solid #fecaca;border-radius:8px;padding:6px 12px;font:600 12.5px system-ui,Segoe UI,Arial,sans-serif;cursor:pointer';
      dismiss.onclick = function () { try { b.parentNode.removeChild(b); } catch (eD) {} };
      b.appendChild(span); b.appendChild(reload); b.appendChild(dismiss);
      host.appendChild(b);
      api.state.bannerShown = true;
    } catch (e) {}
  }

  /* Capture-phase pull-button block: the day-pull button's onclick calls
     the module-CLOSURE run() directly (mls-connect.js ~6095), so no wrap of
     the public __mlsDayHistoryPull surface could intercept it - a capture
     listener fires before the target-phase onclick and can stop it. */
  function onCaptureClick(e) {
    try {
      if (!api.state.armedCycle) return;
      var t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      if (t.closest('#mlsDayHistBtn') || t.closest('#mlsPmpBtn')) {
        e.stopPropagation();
        e.preventDefault();
        showBanner();
        try { console.error(TAG, 'pull blocked: ' + ARMED_MSG); } catch (eE) {}
      }
    } catch (err) {}
  }
  try { document.addEventListener('click', onCaptureClick, true); } catch (eCl) {}

  /* Opportunistic event-driven ticks (capture-phase; no wall-clock timers):
     keep the guard responsive even if the Worker fallback path is throttled. */
  function eventNudge() { try { ensureTop(); } catch (e) {} }
  try { document.addEventListener('visibilitychange', eventNudge, true); } catch (eV) {}
  try { window.addEventListener('focus', eventNudge, true); } catch (eFo) {}

  /* ------------------------------------------------------------------ *
   *  SELF-TEST (no store writes - see header note 6 for the proof)      *
   * ------------------------------------------------------------------ */
  function runSelfTest(trigger) {
    var t = { normVisit: 'skip', addVisitProbe: 'skip', error: '', trigger: trigger || 'manual', at: new Date().toISOString() };
    try {
      var M = window.__mlsVisitModel;
      if (!M) { t.error = 'no-model-yet'; api.selfTest = t; log('self-test SKIP (' + t.trigger + ') - no __mlsVisitModel yet'); return t; }
      var pad = '';
      for (var i = 0; i < 20; i++) pad += 'Synthetic chart line for the Bob Dunne ingest probe. ';
      var payload = {
        type: 'Chart summary',
        date: '2026-07-10',
        raw: 'Robert (Bob) DUNNE  DOB 04/13/1951\nChief complaint: low back pain.\n' +
             'Assessment: lumbar radiculopathy M54.16. Plan: follow up 4 weeks.\n' + pad
      };
      /* 1) the parser alone: _normVisit is pure (no store access) */
      try {
        var v = (typeof M._normVisit === 'function') ? M._normVisit(payload, 'self-test') : null;
        t.normVisit = v ? 'pass' : 'skip';
      } catch (e1) { t.normVisit = 'fail'; t.error = 'normVisit:' + ((e1 && e1.message) || e1); }
      /* 2) the FULL live addVisit wrapper chain. The probe id matches no
            patient (window.findPatient is exact-id, ScribeFlow.html:5671),
            so the real addVisit returns null BEFORE any persist
            (feat_visits.js:109) - zero localStorage writes. This is
            exactly where the b120 overflow lived: an armed h1<->c1 cycle
            throws RangeError right here and is reported instead of
            corrupting a pull. */
      try {
        var pid = '__mlsAvcgProbe__' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
        var r = M.addVisit(pid, payload, { source: 'self-test', persist: false });
        t.addVisitProbe = (r === null || r === undefined) ? 'pass' : 'fail-unexpected-save';
      } catch (e2) {
        var msg = String((e2 && e2.message) || e2);
        if ((typeof RangeError !== 'undefined' && e2 instanceof RangeError) || /maximum call stack|stack size|out of stack/i.test(msg)) {
          t.addVisitProbe = 'armed-cycle';
          t.error = 'addVisit:' + msg;
          onArmedCycle('self-test probe overflow');
        } else {
          t.addVisitProbe = 'fail';
          t.error = 'addVisit:' + msg;
        }
      }
    } catch (e0) { t.error = String((e0 && e0.message) || e0); }
    api.selfTest = t;
    log('self-test ' + ((t.normVisit !== 'fail' && t.addVisitProbe === 'pass') ? 'PASS' : 'FAIL') +
        ' (' + t.trigger + ') - _normVisit("Robert (Bob) DUNNE"): ' + t.normVisit +
        '; addVisit chain probe: ' + t.addVisitProbe +
        (t.error ? ('; ' + t.error) : ''));
    return t;
  }
  api.runSelfTest = runSelfTest;

  /* ------------------------------------------------------------------ *
   *  REVERT (wf_16 change 4)                                            *
   * ------------------------------------------------------------------ */
  function dropGlobal() {
    try { delete window.__mlsAddVisitCycleGuard; }
    catch (e) { try { window.__mlsAddVisitCycleGuard = undefined; } catch (e2) {} }
  }
  api.revert = function () {
    stopped = true;
    try { if (_wk) { _wk.postMessage(0); _wk.terminate(); } } catch (e1) {}
    _wk = null;
    try { if (_fbT) clearTimeout(_fbT); } catch (e2) {}
    try { document.removeEventListener('click', onCaptureClick, true); } catch (e3) {}
    try { document.removeEventListener('visibilitychange', eventNudge, true); } catch (e4) {}
    try { window.removeEventListener('focus', eventNudge, true); } catch (e5) {}
    try { var b = document.getElementById(BANNER_ID); if (b && b.parentNode) b.parentNode.removeChild(b); } catch (e6) {}
    try { if (window.__mlsPullBlocked === 'addvisit-cycle-armed') delete window.__mlsPullBlocked; } catch (e7) {}

    var M = null;
    try { M = window.__mlsVisitModel; } catch (e8) {}

    if (M && THR && M.addVisit === THR) {
      /* armed mode: restoring means putting the BROKEN chain back */
      try { M.addVisit = THROWN; } catch (e9) {}
      api.installed = false; api.mode = 'reverted';
      dropGlobal();
      return 'reverted: the clean thrower was removed and addVisit is BACK TO THE BROKEN (armed) chain - it will overflow on the next call. RELOAD THIS TAB before any pull.';
    }
    if (M && W && M.addVisit === W) {
      try { M.addVisit = INNER; } catch (e10) {}
      api.installed = false; api.mode = 'reverted';
      dropGlobal();
      return 'reverted: addVisit restored to the function the guard wrapped. WARNING: satellite heartbeats are still live (feat_source_clarity re-checks every 1200 ms FOREVER; feat_visits_honest for ~30 s after its load) and can re-wrap and re-arm the original cycle race - RELOAD THIS TAB before the next pull.';
    }
    if (!W && !THR) {
      api.installed = false; api.mode = 'reverted';
      dropGlobal();
      return 'reverted: the guard had not wrapped addVisit yet; timers and listeners stopped.';
    }
    /* Buried: a later wrapper sits on top of the guard wrapper. Splicing
       through unknown foreign wrappers is unsafe, and deleting the global
       would make the buried guard unaddressable (wf_16 change 4b) - so we
       REFUSE to delete it, disable the guard's behaviors (pass-through
       only), and keep it reachable. */
    api._reverted = true;
    api.installed = false;
    api.mode = 'revert-refused-buried';
    return 'NOT fully reverted: a later wrapper sits on top of the guard wrapper (M.addVisit !== guard), so unwrapping in place is unsafe. Guard behaviors are disabled (pure pass-through), timers and listeners are stopped, and window.__mlsAddVisitCycleGuard REMAINS defined so the guard stays addressable. RELOAD THIS TAB to fully clear.';
  };

  /* ------------------------------------------------------------------ *
   *  Boot                                                               *
   * ------------------------------------------------------------------ */
  window.__mlsAddVisitCycleGuard = api;
  ensureTop();      /* immediate synchronous attempt (model usually exists by satellite load time) */
  startTimers();    /* Worker-driven cadence: 100 ms x 1800, then 5 s forever */
})();


/* =========================================================================
 * MLS Scribe - SCHEDULE DATE+PROVIDER KEYING FIX  (__mlsDayKeyFix) v1.1.0  2026-07-10 (b121)
 *
 * CORRECTED ROOT-CAUSE NARRATIVE (live-verified against the b120 bundle,
 * live ScribeFlow.html, feat_mls_pull_dateguard.js and feat_mls_provider_
 * passthrough.js on 2026-07-10; supersedes the v1.0.0 design draft):
 *
 * A) THE "FRIDAY 21" IS NOT A MIS-KEYED IMPORT. Live probe: all 21 rows on
 *    2026-07-10 are SERVER-synced staff bookings (source:'staff',
 *    patient_external_id 'p...', server created_at). Their appt_date is
 *    AUTHORITATIVE - this module never rewrites or drops staff-booking
 *    semantics; day_local is aligned TO their appt_date, nothing else.
 *
 * B) WRONG-DAY IMPORT HOLES (real, fixed here, but NOT via the old UTC/8pm
 *    story): the design draft claimed _nextClinicDay() keys evening pulls to
 *    TOMORROW via toISOString(). FALSE against the live composite -
 *    __mlsPullRecFix F2 (deployed, mls-connect.js ~line 15166) already
 *    replaces window._nextClinicDay with a LOCAL-date version, and
 *    _importPulledSchedule calls it as a bare global, which resolves to the
 *    wrapper. The draft quoted raw ScribeFlow source without checking the
 *    live wrapper stack. The redundant _nextClinicDay wrap is DROPPED.
 *    What survives (the true composite):
 *      1. The header "Pull today's patients" path never navigates athena; it
 *         keys every displayed row to _detectSchedDate(text)||_nextClinicDay().
 *         _detectSchedDate is wrapped live by item81's __mlsDateGuard, whose
 *         weekdayAdjacentDate only knows FULL month names - an athena header
 *         like "Thursday, Jul 9, 2026" parses to '' - so a pull run TODAY
 *         while athena displays ANOTHER day files the whole displayed day
 *         under local-today.
 *      2. _parseScheduleText is an AI call whose per-row a.date takes
 *         priority over fallbackDate (ScribeFlow ~11666) and resolves
 *         weekday-only labels against a TODAY anchor - another wrong-day
 *         source when athena shows a different week. importDay() below
 *         refuses AI rows dated to a different day than its target.
 *      3. The ez3 pullDay verify has a hole: gotoDate replies without a
 *         schedDate blind-default navConfirmed to the TARGET day, and the
 *         read-side check is skipped when the page date cannot be parsed
 *         (respSchedDate is full-month-names-only). The schedDate enrichment
 *         below makes provable page dates visible to every consumer, so the
 *         existing verifies fail HONESTLY instead of mis-keying.
 *
 * C) MONTH-CHART-PULL GATE FALSE-BLOCK ("No imported schedule rows for
 *    <provider-UI-text> in 2026-07" with 21 perfect rows in memory).
 *    rosterCount (__mlsMonthPullOne) and rosterFor (__mlsProvMonthPull)
 *    require a.day_local AND nrm(a.provider) === nrm(selfProvider()).
 *    THE PRIMARY LIVE KILL: selfProvider() reads
 *      document.getElementById('provSel') || querySelector('#mlsProvChip,...')
 *    and NO element with id "provSel" exists anywhere in live ScribeFlow.html
 *    (only a local JS variable of that name building #calNewDoc). It falls
 *    back to the item82 chip, whose textContent is
 *      "(stethoscope) Pulling as: Matthew Schaeffer, MD (arrow)"
 *    nrm() keeps the words "pulling as", so kp = "pulling as matthew
 *    schaeffer md" matches NOTHING - rosterCount is 0 even for perfect rows
 *    (staff bookings AND athena imports alike). That is the observed block.
 *    SECONDARY KILLS (real for athena-imported rows in other months):
 *      - saveRow only builds start_at when /^\d\d?:\d\d$/ matches row.time,
 *        but the extension returns "8:00 AM"-style times, so start_at stays
 *        NULL and b110-F1 never derives day_local (it skips rows without
 *        start_at) - those rows are invisible to the gate and the day pull.
 *      - provider form mismatches: athena scrapes "Schaeffer_Matthew_MD",
 *        the app displays "Matthew Schaeffer, MD"; nrm() keeps token ORDER
 *        so they never compare equal. Header-pull rows can lack provider
 *        entirely (item82 stamps only during its import window).
 *    FIXES (data/DOM level, so every closure-bound query is fixed at once):
 *      - a hidden <span id="provSel"> "bridge" carrying the canonical
 *        picked-doctor name (exactly the surface the gate authors assumed
 *        existed; synced from the item82 localStorage pick / _calProviders;
 *        removed on revert; never created over a real future #provSel).
 *      - in-place _calAppts normalization (journaled, revertible):
 *        day_local from appt_date under a CONDITIONAL rule (see below),
 *        provider filled from doctor_user_id, provider rewritten to the
 *        canonical display form only when the credential-stripped,
 *        order-insensitive token key matches AND that key is not collided
 *        between two DISTINCT server providers.
 *
 * day_local RULE (wf_18 hardening + staff-row carve-out):
 *   - source === 'staff'          -> day_local := appt_date (authoritative).
 *   - start_at null               -> day_local := appt_date.
 *   - appt_date == TZ-day(start_at) -> day_local := appt_date (agreement).
 *   - disagreement (non-staff)    -> day_local left alone (dayConflicts
 *     gauge counts them; probe live before trusting either side).
 *
 * DATE PARSE BELT (item81 lesson, kept): robustSchedDate accepts a date only
 * when (a) it is weekday-VALIDATED (the weekday word matches the date's real
 * weekday), (b) it is the ONLY distinct such date on the page (2+ distinct
 * day headers = week/multi-day view -> return '' and change nothing), and
 * (c) it is within 3 days of local today OR equals the current nav/import
 * target. Anchored-or-nothing: it never guesses.
 *
 * DATEGUARD COMPOSITION (asserted, documented): this module wraps
 * window._detectSchedDate only after item81's guard is on it (__dgWrap) or
 * once the document is complete and the guard is provably absent; the
 * composition actually installed is recorded in stats.detectComposition.
 * REVERT ORDER: run window.__mlsDayKeyFix.revert() FIRST, then
 * __mlsDateGuard.revert() (normal stack: dkf over guard over raw). If
 * __mlsDateGuard.revert() runs first it restores the RAW detector and this
 * module's wrapper simply drops out of the chain; our revert() then detects
 * the missing __dkf flag, skips the restore, and the killed-flag makes the
 * orphaned wrapper a pure passthrough. No order can strand a stale rescue.
 *
 * importDay(dateYMD, provider) -> Promise<result>: drives athena to the date
 * via the EXISTING bridge path (mlsAppGotoDate 60s -> settle -> pull), HARD
 * verifies the page date, awaits the ASYNC _parseScheduleText fallback
 * (raced with a Worker timer - it is an AI network call), never reports a
 * fake empty day, refuses while any other pull runs (day-history, provider-
 * month, ez3 schedule pull, bulk chain), refuses when Worker timers are
 * unavailable (a hidden MLS tab throttles setTimeout to ~0 - the importing
 * flag must never wedge), refuses when the requested provider mismatches the
 * app's "Pulling as" doctor (athenaOne renders only the signed-in doctor's
 * schedule), keys every row to dateYMD, dedupes per patient-per-day WITH
 * DOB awareness, and saves via the app's own POST /api/appointments.
 * READ-ONLY toward athenaOne. The athena all-providers day surface
 * viewdepartment.esp (DATE=MM/DD/YYYY&DEPARTMENTID=624) is a future import
 * leg - importDay stays on the proven single-provider bridge path.
 *
 * DEPLOY NOTE: this is a PREPEND module - it must be the FIRST executable
 * statement in mls-connect.js so its message listener registers before every
 * consumer. The CM6/web-editor path has previously mangled placement on the
 * 2.15MB file: VERIFY BYTE-0 PLACEMENT POST-DEPLOY. Bump build to b121.
 *
 * Timer rules respected: capture-phase listeners + MutationObserver for
 * mounting (setInterval is ~0 in a hidden MLS tab); Web-Worker timers for
 * pull waits. Additive; never deletes code; journal-overflow is HONEST
 * (stats.journalDropped, revert() returns {complete:false} on loss).
 * Revert: window.__mlsDayKeyFix.revert()
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsDayKeyFix) return; } catch (e) { return; }

  var api = {
    version: '1.1.0',
    build: '2026-07-10-b121',
    stats: {
      normRuns: 0, dayFixed: 0, dayConflicts: 0,
      provFilled: 0, provCanon: 0, provKeyCollisions: 0,
      schedDateEnriched: 0, schedDateAmbiguous: 0, schedDateBeltRejected: 0,
      detectRescues: 0, detectComposition: '',
      journalDropped: 0, journalPruned: 0, dobMismatchSkips: 0
    },
    state: { killed: false, lastGotoTarget: '', provBridge: '' },
    importing: false,
    lastImport: null
  };

  /* ------------------------------ tiny utils ------------------------------ */
  function p2(n) { n = String(n); return n.length < 2 ? '0' + n : n; }
  function nrm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

  /* ---- provider comparison key: strip credentials + 1-letter tokens, sort - */
  var CRED = { md: 1, 'do': 1, dpm: 1, pa: 1, pac: 1, np: 1, crnp: 1, aprn: 1, fnp: 1, dnp: 1, crna: 1, dds: 1, dmd: 1, phd: 1, psyd: 1, od: 1, rn: 1, ma: 1, dr: 1, pt: 1, cnm: 1, lcsw: 1, lpc: 1 };
  function provKey(s) {
    var t = nrm(s).split(' ').filter(function (w) { return w.length > 1 && !CRED[w]; });
    if (t.length < 2) return '';
    t.sort();
    return t.join(' ');
  }

  /* ---- robust, weekday-VALIDATED, unique+belted schedule-date parse ------ */
  var MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  var WD = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  function robustSchedDate(text, target) {
    /* Returns a date ONLY when: exactly ONE distinct weekday-validated date
       appears in the text (2+ distinct = week/multi-day view -> '') AND that
       date is within 3 days of LOCAL today or equals `target`. Never guesses. */
    try {
      text = String(text || '').slice(0, 30000); /* the day header is near the top */
      var found = {}, count = 0;
      function consider(y, mo, d, wd) {
        if (!mo || mo < 1 || mo > 12) return;
        var dt = new Date(y, mo - 1, d);
        if (isNaN(dt.getTime()) || dt.getDate() !== d || dt.getMonth() !== mo - 1) return;
        if (dt.getDay() !== WD[wd]) return; /* stray-date poison guard (item81 lesson) */
        var iso = y + '-' + p2(mo) + '-' + p2(d);
        if (!found[iso]) { found[iso] = 1; count++; }
      }
      var m;
      var re1 = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*[,.\s]\s{0,3}([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(20\d\d)\b/gi;
      while ((m = re1.exec(text)) && count < 9) {
        consider(+m[4], MON[m[2].slice(0, 3).toLowerCase()] || 0, +m[3], m[1].toLowerCase());
      }
      var re2 = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*[,.\s]\s{0,3}(\d{1,2})\/(\d{1,2})\/(20\d\d)\b/gi;
      while ((m = re2.exec(text)) && count < 9) {
        consider(+m[4], +m[2], +m[3], m[1].toLowerCase());
      }
      var isos = [], k;
      for (k in found) { if (found.hasOwnProperty(k)) isos.push(k); }
      if (isos.length !== 1) {
        if (isos.length > 1) api.stats.schedDateAmbiguous++;
        return ''; /* 0 = nothing provable; 2+ = week view: change NOTHING */
      }
      var iso1 = isos[0];
      if (target && iso1 === String(target).slice(0, 10)) return iso1;
      var t = new Date();
      var today = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
      var p = iso1.split('-');
      var that = new Date(+p[0], +p[1] - 1, +p[2]).getTime();
      if (Math.abs(Math.round((that - today) / 86400000)) <= 3) return iso1;
      api.stats.schedDateBeltRejected++;
      return ''; /* anchored-or-nothing: NEVER guess a day */
    } catch (e) { return ''; }
  }

  /* ---- schedDate enrichment: this module is PREPENDED, so this listener --
     registers before every consumer (ez3 respSchedDate reads r.schedDate
     FIRST; the base header-pull registers its listener per click, later).
     Only ADDS schedDate when absent - never overwrites the extension's.
     Also snoops OUTBOUND mlsAppGotoDate requests to learn the current nav
     target for the proximity belt. ------------------------------------- */
  function onMsg(ev) {
    try {
      if (api.state.killed) return;
      var d = ev && ev.data;
      if (!d) return;
      if (d.source === 'mls-app' && d.type === 'mlsAppGotoDate' && d.date && /^\d{4}-\d{2}-\d{2}$/.test(String(d.date))) {
        api.state.lastGotoTarget = String(d.date);
        return;
      }
      if (d.source !== 'mls-ext') return;
      if (d.type !== 'mlsAppScheduleResult' && d.type !== 'mlsAppGotoDateResult') return;
      var r = d.resp || d;
      if (r && !r.schedDate && r.text) {
        var sd = robustSchedDate(r.text, api.state.lastGotoTarget);
        if (sd) { r.schedDate = sd; r.schedDateVia = 'mlsDayKeyFix'; api.stats.schedDateEnriched++; }
      }
    } catch (e) {}
  }
  try { window.addEventListener('message', onMsg, false); } catch (e) {}

  /* ---- base-app wraps ----------------------------------------------------
     _detectSchedDate: rescue '' with the belted parser (files header-pull
     rows on the day athena actually SHOWED, never a guess). Composition with
     item81's __mlsDateGuard is asserted - we wrap only once the guard is on
     (normal stack: dkf(guard(raw))) or once the document is complete and the
     guard is provably absent. NO _nextClinicDay wrap: __mlsPullRecFix F2
     already made it local (the v1.0.0 draft's UTC/8pm claim was stale).
     loadCalendar: re-normalize + prune the journal after every reload
     (loadCalendar REPLACES _calAppts wholesale - old row generations become
     unreachable and their journal entries are pruned, counted honestly). */
  var wrapped = { detect: null, loadCal: null };
  function installWraps() {
    try {
      var f = window._detectSchedDate;
      if (typeof f === 'function' && !f.__dkf) {
        if (f.__dgWrap === true || document.readyState === 'complete') {
          var od = f;
          api.stats.detectComposition = (f.__dgWrap === true) ? 'over-dateguard' : 'over-raw(dateguard-absent-at-complete)';
          var wd2 = function (text) {
            var v = '';
            try { v = od.apply(this, arguments); } catch (e) { v = ''; }
            if (api.state.killed) return v;
            if (v) return v;
            var sd = robustSchedDate(text, null);
            if (sd) api.stats.detectRescues++;
            return sd;
          };
          wd2.__dkf = 1;
          wrapped.detect = od;
          window._detectSchedDate = wd2;
        }
      }
    } catch (e) {}
    try {
      if (typeof window.loadCalendar === 'function' && !window.loadCalendar.__dkf) {
        var ol = window.loadCalendar;
        var wl = function () {
          var r = ol.apply(this, arguments);
          if (api.state.killed) return r;
          return Promise.resolve(r).then(
            function (v) { try { normalizeRows(true); } catch (e) {} return v; },
            function (e) { try { normalizeRows(true); } catch (e2) {} throw e; }
          );
        };
        wl.__dkf = 1;
        wrapped.loadCal = ol;
        window.loadCalendar = wl;
      }
    } catch (e) {}
  }

  /* ------------------------------ data access ----------------------------- */
  function rows() {
    /* base-app per-visit state is global-lexical, NOT on window: read the
       bare identifier first, typeof-guarded (MLS prepend-module scope rule) */
    try { if (typeof _calAppts !== 'undefined' && _calAppts) { return (typeof _calAppts === 'function') ? (_calAppts() || []) : _calAppts; } } catch (e) {}
    try { return (typeof window._calAppts === 'function') ? (window._calAppts() || []) : (window._calAppts || []); } catch (e) { return []; }
  }
  function acctTz() {
    try { if (typeof window._acctTz === 'function') { var t = window._acctTz(); if (t) return String(t); } } catch (e) {}
    try { var t2 = (typeof window.uns === 'function') ? localStorage.getItem(window.uns('acctTz')) : null; if (t2 && t2.trim()) return t2.trim(); } catch (e) {}
    return 'America/New_York';
  }
  var _dtf = null, _dtfTz = '';
  function dayLocalOfIso(iso) {
    try {
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var tz = acctTz();
      if (!_dtf || _dtfTz !== tz) {
        _dtf = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
        _dtfTz = tz;
      }
      return _dtf.format(d);
    } catch (e) { return ''; }
  }
  function docNameById(id) {
    try {
      var l = window._calProviders || [];
      for (var i = 0; i < l.length; i++) { if (l[i] && String(l[i].id) === String(id)) return String(l[i].name || ''); }
    } catch (e) {}
    return '';
  }
  function chipProvider() {
    /* the item82 "Pulling as" pick - read its STORE, never the chip's
       decorated textContent ("Pulling as: ... ") */
    try { if (typeof window.uns === 'function') { var v = localStorage.getItem(window.uns('pullProvider')); if (v && v.trim()) return v.trim(); } } catch (e) {}
    try { var l = window._calProviders || []; if (l[0] && l[0].name) return String(l[0].name).trim(); } catch (e) {}
    return '';
  }

  /* ---- canonical provider list + collision refusal ------------------------
     Two DISTINCT server providers (different _calProviders ids) sharing one
     credential-stripped token-set key ("James Paul, MD" vs "Paul James, DO")
     would merge under canonicalization - those keys are detected and REFUSED
     (counted in stats.provKeyCollisions). Same-key entries across sources
     (rows vs dropdowns) are the same provider - that merge is the fix. */
  function collisionKeys() {
    var byKey = {}, bad = {};
    try {
      var l = window._calProviders || [];
      for (var i = 0; i < l.length; i++) {
        var p = l[i];
        if (!p) continue;
        var nmv = String((p && p.name) || (typeof p === 'string' ? p : '') || '').trim();
        if (!nmv) continue;
        var k = provKey(nmv);
        if (!k) continue;
        var idv = (p && p.id != null) ? ('i:' + String(p.id)) : ('n:' + nmv);
        if (byKey[k] && byKey[k] !== idv) bad[k] = 1;
        else byKey[k] = idv;
      }
    } catch (e) {}
    return bad;
  }
  function canonList() {
    var out = [], seen = {};
    function add(n) {
      n = String(n == null ? '' : n).trim();
      if (!n || /^all\b/i.test(n) || /pulling as/i.test(n)) return;
      var k = provKey(n);
      if (!k || seen[k]) return;
      seen[k] = 1;
      out.push({ key: k, disp: n });
    }
    /* order = display priority: server truth first, then the ez3 dropdown,
       then the item82 pick. The chip's decorated text is deliberately NOT
       a source (it carries "Pulling as:" noise). */
    try { (window._calProviders || []).forEach(function (p) { add(p && (p.name || p)); }); } catch (e) {}
    try {
      var ez = document.getElementById('ez3sPullProv');
      if (ez && ez.options) { for (var j = 0; j < ez.options.length; j++) { var v = ez.options[j].value; if (v && v !== 'all') add(v); } }
    } catch (e) {}
    try { add(chipProvider()); } catch (e) {}
    return out;
  }
  function canonDisp(p) {
    p = String(p == null ? '' : p).trim();
    if (!p) return p;
    var k = provKey(p);
    if (!k) return p;
    if (collisionKeys()[k]) return p; /* collided key: refuse to merge */
    var list = canonList();
    for (var i = 0; i < list.length; i++) { if (list[i].key === k) return list[i].disp; }
    return p;
  }

  /* ---- the #provSel bridge ------------------------------------------------
     __mlsMonthPullOne.selfProvider() and __mlsProvMonthPull.selfProvider()
     read getElementById('provSel') FIRST - an element that has never existed
     in live ScribeFlow.html - then fall back to the item82 chip whose text
     is "Pulling as: <name>" (the live gate killer: nrm keeps "pulling as").
     This hidden span IS the missing surface, carrying the clean canonical
     name. Never fights a real #provSel (only touches its own, flagged one);
     removed on revert. */
  function syncProvBridge(canon, collided) {
    try {
      var host = document.body || document.documentElement;
      if (!host) return;
      var el = document.getElementById('provSel');
      if (el && !el.__dkfBridge) return; /* a real #provSel appeared - stand down */
      var pick = chipProvider();
      var disp = '';
      if (pick) {
        var k = provKey(pick);
        if (k && !collided[k]) {
          for (var i = 0; i < canon.length; i++) { if (canon[i].key === k) { disp = canon[i].disp; break; } }
        }
        if (!disp) disp = pick;
      }
      if (!disp) {
        if (el) { try { el.remove(); } catch (e) {} }
        api.state.provBridge = '';
        return;
      }
      if (!el) {
        el = document.createElement('span');
        el.id = 'provSel';
        el.__dkfBridge = 1;
        el.setAttribute('data-mls-daykeyfix', '1');
        el.setAttribute('aria-hidden', 'true');
        el.style.display = 'none';
        host.appendChild(el);
      }
      if (el.textContent !== disp) el.textContent = disp;
      api.state.provBridge = disp;
    } catch (e) {}
  }

  /* ---- journal (honest overflow + generation pruning) --------------------- */
  var undoLog = [];
  var UNDO_CAP = 30000;
  function remember(a, f, old) {
    if (undoLog.length >= UNDO_CAP) { api.stats.journalDropped++; return; }
    undoLog.push([a, f, old]);
  }
  function pruneJournal(arr) {
    /* loadCalendar REPLACES _calAppts wholesale; entries for unreachable row
       objects restore nothing - prune them so the cap is spent on live rows */
    if (!undoLog.length) return;
    try {
      if (typeof Set !== 'function') return;
      var live = new Set(arr);
      var kept = [];
      for (var i = 0; i < undoLog.length; i++) {
        if (live.has(undoLog[i][0])) kept.push(undoLog[i]);
        else api.stats.journalPruned++;
      }
      if (kept.length !== undoLog.length) {
        undoLog.length = 0;
        Array.prototype.push.apply(undoLog, kept);
      }
    } catch (e) {}
  }

  /* ---- (2) in-place row normalization ------------------------------------ */
  var _lastNorm = 0;
  function normalizeRows(force) {
    if (api.state.killed) return;
    var now = Date.now();
    if (!force && now - _lastNorm < 1200) return;
    _lastNorm = now;
    var canon = canonList();
    var collided = collisionKeys();
    var nCollided = 0, ck;
    for (ck in collided) { if (collided.hasOwnProperty(ck)) nCollided++; }
    api.stats.provKeyCollisions = nCollided;
    syncProvBridge(canon, collided);
    var arr = rows();
    if (!arr || !arr.length) return;
    api.stats.normRuns++;
    if (force) pruneJournal(arr);
    var runConflicts = 0;
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      if (!a) continue;
      /* ---- DATE: conditional appt_date-wins + staff carve-out ---- */
      var ad = a.appt_date ? String(a.appt_date).slice(0, 10) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(ad)) {
        var cur = String(a.day_local || '').slice(0, 10);
        if (cur !== ad) {
          var isStaff = String(a.source || '').toLowerCase() === 'staff';
          var tzDay = a.start_at ? dayLocalOfIso(a.start_at) : '';
          if (isStaff || !a.start_at || tzDay === ad) {
            remember(a, 'day_local', a.day_local);
            a.day_local = ad;
            api.stats.dayFixed++;
          } else {
            runConflicts++;
            if (!a.day_local && tzDay) {
              remember(a, 'day_local', a.day_local);
              a.day_local = tzDay;
              api.stats.dayFixed++;
            }
          }
        }
      } else if (!a.day_local && a.start_at) {
        var dl = dayLocalOfIso(a.start_at);
        if (dl) { remember(a, 'day_local', a.day_local); a.day_local = dl; api.stats.dayFixed++; }
      }
      /* ---- PROVIDER: fill from doctor_user_id, then canonicalize ---- */
      if (!a.provider && a.doctor_user_id != null) {
        var dn = docNameById(a.doctor_user_id);
        if (dn) { remember(a, 'provider', a.provider); a.provider = dn; api.stats.provFilled++; }
      }
      if (a.provider) {
        var pk = provKey(a.provider);
        if (pk && !collided[pk]) {
          for (var c = 0; c < canon.length; c++) {
            if (canon[c].key === pk) {
              if (a.provider !== canon[c].disp) {
                remember(a, 'provider', a.provider);
                a.provider = canon[c].disp;
                api.stats.provCanon++;
              }
              break;
            }
          }
        }
      }
    }
    api.stats.dayConflicts = runConflicts; /* last-run gauge, not cumulative */
  }

  /* ---- diagnostics: reproduce the gate's query, fixed and unfixed --------- */
  function gateProvider() {
    /* what selfProvider() in the gate would return RIGHT NOW */
    try {
      var el = document.getElementById('provSel') || document.querySelector('#mlsProvChip, [data-mls-provider]');
      var t = el ? (el.value || el.textContent || '') : '';
      if (t && /\w/.test(t)) return String(t).trim();
    } catch (e) {}
    return 'Matthew Schaeffer, MD';
  }
  function rosterProbe(provider, ym) {
    var arr = rows(), kp = nrm(provider), kk = provKey(provider);
    var gp = gateProvider();
    var out = {
      gateText: gp,
      gateNrmEqualsProvider: nrm(gp) === kp,
      rowsInMonth: 0, staffRows: 0, withDayLocal: 0, withProvider: 0,
      exactNrmMatch: 0, tokenSetMatch: 0
    };
    for (var i = 0; i < arr.length; i++) {
      var a = arr[i];
      if (!a || !a.name) continue;
      var d = String(a.day_local || a.appt_date || '').slice(0, 7);
      if (d !== String(ym || '').slice(0, 7)) continue;
      out.rowsInMonth++;
      if (String(a.source || '').toLowerCase() === 'staff') out.staffRows++;
      if (a.day_local) out.withDayLocal++;
      if (a.provider) {
        out.withProvider++;
        if (nrm(a.provider) === kp) out.exactNrmMatch++;
        if (kk && provKey(a.provider) === kk) out.tokenSetMatch++;
      }
    }
    return out;
  }

  /* ---- mounting: NO timer reliance (setInterval ~0 in a hidden MLS tab) --- */
  var _lastKick = 0;
  function kick() {
    try {
      if (api.state.killed) return;
      var n = Date.now();
      if (n - _lastKick < 900) return;
      _lastKick = n;
      installWraps();
      normalizeRows(false);
    } catch (e) {}
  }
  var mo = null;
  try { document.addEventListener('click', kick, true); } catch (e) {}
  try { document.addEventListener('visibilitychange', kick, true); } catch (e) {}
  try {
    mo = new MutationObserver(function () { kick(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
  function onLoad() { try { _lastKick = 0; kick(); } catch (e) {} }
  try { if (document.readyState !== 'complete') window.addEventListener('load', onLoad, false); } catch (e) {}
  try { kick(); } catch (e) {}

  /* ---- Worker timers (throttling-proof waits) ----------------------------- */
  var _wkUrl = null, _wkOk = null;
  try { _wkUrl = URL.createObjectURL(new Blob(['onmessage=function(e){setTimeout(function(){postMessage(1)},e.data)}'], { type: 'application/javascript' })); } catch (e) {}
  function workerOk() {
    if (_wkOk !== null) return _wkOk;
    if (!_wkUrl) { _wkOk = false; return false; }
    try { var w = new Worker(_wkUrl); try { w.terminate(); } catch (e) {} _wkOk = true; }
    catch (e2) { _wkOk = false; }
    return _wkOk;
  }
  function wait(ms) {
    return new Promise(function (r) {
      if (_wkUrl) {
        try {
          var w = new Worker(_wkUrl);
          w.onmessage = function () { try { w.terminate(); } catch (e) {} r(); };
          w.postMessage(ms);
          return;
        } catch (e) {}
      }
      /* no-Worker fallback: setTimeout is throttled to ~0 in a hidden tab, so
         ALSO resolve on visibilitychange - this promise can never park forever.
         (importDay refuses to START without Worker timers; this path only
         serves incidental waits.) */
      var done = false;
      function fin() {
        if (done) return;
        done = true;
        try { document.removeEventListener('visibilitychange', fin, true); } catch (e) {}
        r();
      }
      try { document.addEventListener('visibilitychange', fin, true); } catch (e) {}
      setTimeout(fin, ms);
    });
  }
  function bridge(type, payload, respType, timeout) {
    return new Promise(function (resolve) {
      var done = false;
      function h(ev) {
        var d = ev && ev.data;
        if (!d || d.source !== 'mls-ext' || d.type !== respType) return;
        if (done) return;
        done = true;
        try { window.removeEventListener('message', h); } catch (e) {}
        resolve(d.resp || d);
      }
      try { window.addEventListener('message', h, false); } catch (e) {}
      try { window.postMessage(Object.assign({ type: type, source: 'mls-app', from: 'mls-app' }, payload || {}), '*'); } catch (e) {}
      wait(timeout || 15000).then(function () {
        if (done) return;
        done = true;
        try { window.removeEventListener('message', h); } catch (e) {}
        resolve({ __timeout: true });
      });
    });
  }

  /* ------------------------------ backend --------------------------------- */
  function bkB() {
    /* NO hardcoded fallback: a guessed write target is the wrong failure
       mode - callers refuse honestly when the app is not ready */
    try { if (typeof window.bkBase === 'function') { var b = window.bkBase(); if (b) return String(b); } } catch (e) {}
    return '';
  }
  function bkT() {
    try { if (typeof window.bkToken === 'function') return window.bkToken() || ''; } catch (e) {}
    return '';
  }

  /* ------------------------------ row hygiene ------------------------------ */
  function normTime(t) {
    t = String(t || '').trim();
    var m = /(\d{1,2}):(\d{2})/.exec(t);
    if (!m) return '';
    var h = +m[1];
    if (h > 23) return '';
    var tail = t.slice(m.index + m[0].length, m.index + m[0].length + 6);
    var mer = /^\s*([ap])\.?\s*m\b/i.exec(tail);
    if (mer) {
      if (/p/i.test(mer[1]) && h < 12) h += 12;
      if (/a/i.test(mer[1]) && h === 12) h = 0;
    }
    if (h > 23) return '';
    return p2(h) + ':' + m[2];
  }
  /* badName: WHOLE-STRING placeholder tests + credential detection that only
     fires on ", MD"-style comma tails, "Last_First_MD" underscore forms, or a
     "Dr." prefix - NEVER on a bare token, so patients surnamed Do / Ma / Pa
     (Emma, Fatima, Fernando, Bjorn, Wilma, Alma, "Nguyen Do") all import. */
  var PLACEHOLDER = /^(frozen|open(\s+slot)?|available|ht|wt|bp|held|blocked|lunch|break|no exam|tbd|walk\s*in|placeholder)$/i;
  var CRED_TAIL = /,\s*(md|do|dpm|pa-?c|pac|np|crnp|aprn|fnp|dnp|crna|dds|dmd|phd|psyd|od|rn|ma|pt|ot|staff|tech)\.?\s*$/i;
  var CRED_UNDERSCORE = /_(md|do|dpm|pa-?c|pac|np|crnp|aprn|fnp|dnp|crna|dds|dmd|phd|psyd|od|rn|ma|pt|ot)\.?\s*$/i;
  function badName(n) {
    n = String(n || '').trim();
    if (!n) return true;
    if (PLACEHOLDER.test(n)) return true;
    if (/^\S+ [A-Z]\.$/.test(n)) return true; /* truncated "First L." display names */
    if (CRED_TAIL.test(n)) return true;       /* "Matthew Schaeffer, MD" - a provider row */
    if (/_/.test(n) && CRED_UNDERSCORE.test(n)) return true; /* "Schaeffer_Matthew_MD" */
    if (/^dr\.?\s/i.test(n)) return true;
    return false;
  }
  function otherPullRunning() {
    try { var D = window.__mlsDayHistoryPull; if (D && D.state && D.state.running) return 'day-history-pull'; } catch (e) {}
    try { var M = window.__mlsProvMonthPull; if (M && M.running) return 'provider-month-pull'; } catch (e) {}
    try {
      var E = window.__mlsEasyV32;
      if (E && typeof E.state === 'function') {
        var st = E.state();
        if (st && st.pull && st.pull.running) return 'ez3-schedule-pull';
      }
    } catch (e) {}
    try { var C = window.__mlsImportChainFix; if (C && C.bulk && C.bulk.running) return 'bulk-history-pull'; } catch (e) {}
    return '';
  }
  function dobDigits(s) { return String(s || '').replace(/\D+/g, ''); }

  /* ---- (3) importDay(dateYMD, provider) ----------------------------------- */
  function _importDayBody(out) {
    return (async function () {
      try {
        var pong = await bridge('mlsPing', null, 'mlsPong', 3500);
        if (!pong || pong.__timeout) { out.reason = 'extension-not-answering'; return out; }

        /* signed-in-provider guard: athenaOne renders only the signed-in
           doctor's schedule; stamping another doctor onto column-less rows
           would mis-attribute the whole day */
        var want = provKey(out.provider);
        var chip = chipProvider();
        if (want && chip) {
          var ckp = provKey(chip);
          if (ckp && ckp !== want) {
            out.reason = 'provider-mismatch (app is pulling as "' + chip + '", not "' + out.provider + '")';
            return out;
          }
        }

        /* drive athena to the TARGET day - never trust whatever is displayed */
        var nav = await bridge('mlsAppGotoDate', { date: out.date }, 'mlsAppGotoDateResult', 60000);
        if (!nav || nav.__timeout) { out.reason = 'gotodate-timeout'; return out; }
        if (nav.supported === false) { out.reason = 'extension-cannot-navigate (update MLS Assist)'; return out; }
        out.navConfirmed = !!(nav.ok && String(nav.schedDate || '').slice(0, 10) === out.date);
        await wait(2500); /* weekstrip settle */

        var r = await bridge('mlsAppPullSchedule', null, 'mlsAppScheduleResult', 45000);
        if (!r || r.__timeout || r.ok !== true) { out.reason = (r && r.error) || 'schedule-read-failed'; return out; }

        /* HARD verify: rows are keyed to dateYMD only when the page is PROVEN on it */
        var sd = String(r.schedDate || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(sd)) sd = robustSchedDate(r.text || '', out.date);
        out.schedDate = sd;
        if (sd) {
          if (sd !== out.date) { out.reason = 'athena-showed-' + sd + '-not-' + out.date; return out; }
        } else if (!out.navConfirmed) {
          out.reason = 'page-date-unconfirmed';
          return out;
        }

        /* rows: structured first; the text-parse fallback is the app's ASYNC
           AI parser - await it, raced with a Worker timer. NEVER report a
           fake empty day when rows may exist but were not parsed. */
        var raw = (r.appts && r.appts.length) ? r.appts.slice() : [];
        var usedTextParse = false;
        if (!raw.length && typeof window._parseScheduleText === 'function') {
          usedTextParse = true;
          var parsed;
          try {
            parsed = await Promise.race([
              Promise.resolve(window._parseScheduleText(String(r.text || ''))),
              wait(90000).then(function () { return '__DKF_TIMEOUT__'; })
            ]);
          } catch (e) {
            out.reason = 'text-parse-failed:' + ((e && e.message) || e);
            return out;
          }
          if (parsed === '__DKF_TIMEOUT__') { out.reason = 'text-parse-timeout (AI parser did not answer in 90s)'; return out; }
          if (!Array.isArray(parsed)) { out.reason = 'text-parse-failed (no rows array)'; return out; }
          raw = parsed;
        }

        var provDisp = out.provider ? canonDisp(out.provider) : '';
        var list = [];
        for (var i = 0; i < raw.length; i++) {
          var x = raw[i] || {};
          var nm = String(x.name || '').trim();
          if (badName(nm)) { out.badNames++; continue; }
          /* AI text-parse rows carry their own per-row date (resolved against
             a TODAY anchor) - refuse rows the AI dated to ANOTHER day */
          if (usedTextParse && x.date) {
            var xd = String(x.date).trim();
            var mUs = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(xd);
            if (mUs) xd = mUs[3] + '-' + p2(+mUs[1]) + '-' + p2(+mUs[2]);
            xd = xd.slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(xd) && xd !== out.date) { out.skipped++; continue; }
          }
          var pv = String(x.provider || '').trim();
          if (want) {
            var pk = provKey(pv);
            if (pk && pk !== want) { out.skipped++; continue; } /* another provider's row */
            pv = provDisp || out.provider; /* column-less single-provider day view: stamp the (guard-verified) requested doctor */
          } else if (pv) {
            pv = canonDisp(pv);
          }
          list.push({ name: nm, dob: String(x.dob || ''), time: normTime(x.time), reason: String(x.reason || ''), provider: pv });
        }
        out.found = list.length;
        if (!list.length) {
          out.ok = true;
          out.reason = raw.length ? 'no-importable-rows (see badNames/skipped)' : 'empty-day';
          return out;
        }

        /* dedupe: one appointment per patient per day, DOB-aware - two same-
           name patients with DIFFERENT DOBs on one day both import */
        var existing = {}; /* 'D:name|day' -> [dobDigits...] ('' = unknown) */
        try {
          var er = await fetch(bkB() + '/api/appointments', { headers: { Authorization: 'Bearer ' + bkT() } });
          if (er.ok) {
            var ed = await er.json();
            (ed.appointments || []).forEach(function (xx) {
              var ld = xx.appt_date ? String(xx.appt_date).slice(0, 10) : '';
              if (!ld && xx.start_at) ld = dayLocalOfIso(xx.start_at);
              var kx = 'D:' + nrm(xx.name) + '|' + String(ld).slice(0, 10);
              (existing[kx] = existing[kx] || []).push(dobDigits(xx.dob));
            });
          }
        } catch (e) {}
        function isDup(nm2, dob2) {
          var have = existing['D:' + nrm(nm2) + '|' + out.date];
          if (!have || !have.length) return false;
          var dd = dobDigits(dob2);
          if (!dd) return true; /* new row has no DOB: conservative dup */
          for (var q = 0; q < have.length; q++) { if (!have[q] || have[q] === dd) return true; }
          return false; /* every existing same-name row has a DIFFERENT dob: different person */
        }
        function markExisting(nm2, dob2) {
          var kx2 = 'D:' + nrm(nm2) + '|' + out.date;
          (existing[kx2] = existing[kx2] || []).push(dobDigits(dob2));
        }

        for (var j = 0; j < list.length; j++) {
          var row = list[j];
          if (isDup(row.name, row.dob)) { out.dups++; continue; }
          markExisting(row.name, row.dob);
          /* REFETCH patients per row: upsertPatient replaces the whole stored
             record - a stale start-of-import snapshot would clobber edits */
          var pts = [];
          try { pts = (typeof window.getPatients === 'function') ? (window.getPatients() || []) : []; } catch (e) { pts = []; }
          var found = null, kn = nrm(row.name);
          for (var q2 = 0; q2 < pts.length; q2++) { if (pts[q2] && nrm(pts[q2].name) === kn) { found = pts[q2]; break; } }
          var ext = '';
          if (found) {
            var fd = dobDigits(found.dob), rd = dobDigits(row.dob);
            if (fd && rd && fd !== rd) {
              /* same name, DIFFERENT DOB: not the same person - do NOT link
                 patient_external_id and do NOT touch the existing record */
              api.stats.dobMismatchSkips++;
            } else {
              ext = found.id;
              if (row.dob && !found.dob && typeof window.upsertPatient === 'function') {
                found.dob = row.dob;
                try { window.upsertPatient(found); } catch (e) {}
              }
            }
          } else if (typeof window.upsertPatient === 'function') {
            var np = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: row.name, dob: row.dob, reason: row.reason, source: 'athena-schedule-daypick', created: Date.now() };
            try { window.upsertPatient(np); ext = np.id; } catch (e) {}
          }
          var startIso = null;
          if (row.time && typeof window._acctWallToUtcIso === 'function') {
            try { startIso = window._acctWallToUtcIso(out.date, row.time); } catch (e) { startIso = null; }
          }
          try {
            var pr = await fetch(bkB() + '/api/appointments', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bkT() },
              body: JSON.stringify({ name: row.name, dob: row.dob, reason: row.reason, patient_external_id: ext || null, appt_date: out.date, start_at: startIso, provider: row.provider || undefined })
            });
            if (pr.ok) out.saved++; else out.skipped++;
          } catch (e) { out.skipped++; }
        }
        out.ok = true;
        try { if (typeof window.loadCalendar === 'function') await window.loadCalendar(); } catch (e) {}
        try { normalizeRows(true); } catch (e) {}
        return out;
      } catch (e) {
        out.reason = 'error:' + ((e && e.message) || e);
        return out;
      }
    })();
  }
  function importDay(dateYMD, provider) {
    var out = { ok: false, date: String(dateYMD || ''), provider: String(provider || ''), found: 0, saved: 0, dups: 0, skipped: 0, badNames: 0, reason: '', schedDate: '', navConfirmed: false };
    if (api.state.killed) { out.reason = 'module-reverted'; return Promise.resolve(out); }
    if (api.importing) { out.reason = 'import-already-running'; return Promise.resolve(out); }
    var busy = otherPullRunning();
    if (busy) { out.reason = 'busy:' + busy; return Promise.resolve(out); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) { out.reason = 'bad-date (want YYYY-MM-DD)'; return Promise.resolve(out); }
    if (!workerOk()) {
      /* fail FAST: without Worker timers a hidden tab throttles setTimeout to
         ~0 ticks, bridge timeouts never fire, and api.importing would wedge
         true forever */
      out.reason = 'worker-timers-unavailable';
      return Promise.resolve(out);
    }
    if (!bkB()) { out.reason = 'app-not-ready (bkBase missing)'; return Promise.resolve(out); }
    if (!bkT()) { out.reason = 'not-signed-in'; return Promise.resolve(out); }
    api.importing = true;
    /* hard deadline: even a pathologically unsettled bridge cannot skip the
       release of api.importing (Worker timer - throttling-proof) */
    var hard = wait(8 * 60 * 1000).then(function () {
      if (!out.ok && !out.reason) out.reason = 'hard-deadline (8 min) - athena/extension never settled';
      return out;
    });
    return Promise.race([_importDayBody(out), hard]).then(
      function (res) { api.importing = false; api.lastImport = res || out; return res || out; },
      function (e) {
        api.importing = false;
        if (!out.reason) out.reason = 'error:' + ((e && e.message) || e);
        api.lastImport = out;
        return out;
      }
    );
  }

  /* ---- public handle + revert -------------------------------------------- */
  api.importDay = importDay;
  api.normalizeRows = function () { normalizeRows(true); return api.stats; };
  api.rosterProbe = rosterProbe;
  api.robustSchedDate = robustSchedDate;
  api.provKey = provKey;
  api.badName = badName;
  api.revert = function () {
    api.state.killed = true; /* orphaned wrappers become pure passthroughs */
    try { window.removeEventListener('message', onMsg, false); } catch (e) {}
    try { document.removeEventListener('click', kick, true); } catch (e) {}
    try { document.removeEventListener('visibilitychange', kick, true); } catch (e) {}
    try { window.removeEventListener('load', onLoad, false); } catch (e) {}
    try { if (mo) mo.disconnect(); } catch (e) {}
    /* restore wraps only when we are still the OUTERMOST layer (standard
       wrapper-stack rule; see header for the dateguard revert-order notes) */
    try { if (wrapped.detect && window._detectSchedDate && window._detectSchedDate.__dkf) window._detectSchedDate = wrapped.detect; } catch (e) {}
    try { if (wrapped.loadCal && window.loadCalendar && window.loadCalendar.__dkf) window.loadCalendar = wrapped.loadCal; } catch (e) {}
    try { var b = document.getElementById('provSel'); if (b && b.__dkfBridge) b.remove(); } catch (e) {}
    var restored = 0;
    try {
      for (var i = undoLog.length - 1; i >= 0; i--) {
        var u = undoLog[i];
        try { u[0][u[1]] = u[2]; restored++; } catch (e) {}
      }
      undoLog.length = 0;
    } catch (e) {}
    try { if (_wkUrl) URL.revokeObjectURL(_wkUrl); } catch (e) {}
    var result = {
      complete: api.stats.journalDropped === 0,
      restored: restored,
      journalDropped: api.stats.journalDropped,
      journalPruned: api.stats.journalPruned
    };
    try { delete window.__mlsDayKeyFix; } catch (e) { window.__mlsDayKeyFix = undefined; }
    return result;
  };
  window.__mlsDayKeyFix = api;
  try { console.log('[MLS] __mlsDayKeyFix v1.1.0 (b121) active - date/provider keying normalized, #provSel bridge up'); } catch (e) {}
})();


/* =========================================================================
 * MLS Scribe - NO-DUPLICATES / athena-patient-ID dedup  (__mlsDedupById)
 * v1.1.0  2026-07-10  build 2026-07-10-b121   PREPEND MODULE (very top of
 * mls-connect.js, before the __mlsProvMonthPull header comment)
 *
 * WHY (mapped live against b120 bundle + ScribeFlow.html on 2026-07-10):
 *  - The pull engine (__mlsDayHistoryPull v1.2.0) NEVER creates rows (it bails
 *    'no-record'), but FIVE creation funnels do, all keyed on EXACT lowercase
 *    name equality: (1) the schedule month-import saveRow() (source
 *    'athena-schedule-monthpick'), (2) _savePatientChart(), (3)
 *    pullPatientChartViaAssist(), (4) opPrepAutosaveDraft() (source
 *    'athena-schedule'), (5) the manual add-patient modal. Name-string drift
 *    ("DUNNE, Bob" vs "Bob Dunne") defeats exact equality and mints a second
 *    row for the same person.
 *  - ALL five funnels persist through window.upsertPatient (top-level function
 *    DECLARATION in ScribeFlow.html line 5672, so reassigning
 *    window.upsertPatient intercepts the bare-identifier calls too). That one
 *    choke point is where "never create a second row" is enforced - the wrap
 *    is ADDITIVE: it always call-forwards to the original, carries a marker
 *    property (__mlsDedupWrapped) + the original (__mlsDedupOrig), and revert()
 *    fully unwraps it.
 *  - Ext v1.89 adds chartMrn (the athena banner patient id) to the
 *    mlsAppReadChart response. CONFIRMED LIVE 2026-07-10: ident.mrn is the
 *    STABLE chart-level athena patient id (banner #7833832 == the findpatient
 *    row ID for the same patient), NOT a per-encounter number. We capture it
 *    off the mlsAppChartResult message (capture-phase, read-only) and stamp
 *    row.athenaId under strict identity gates (below).
 *
 * WHAT IT DOES
 *  (a) stamp: each ok chart read arms a ONE-SHOT expected-identity token
 *      {chartName, chartDob, chartMrn}. The very next upsert whose row matches
 *      STRICTLY (normDob equality + name-token overlap, OR exact sorted-token
 *      name equality with no DOB conflict) gets row.athenaId (and row.mrn when
 *      empty, for compat) - then the token is consumed. Bulk sweeps (e.g. the
 *      summary-sanitize scrubAll loop) can never qualify on loose name overlap,
 *      and stamping is suppressed during this module's own mirror upserts.
 *      Never overwrites an existing different athenaId. Every stamp is
 *      journaled and undone by revert().
 *  (b) create gate: on any upsert whose id is NOT in the store (= a create),
 *      match an existing row: [1] athenaId equality, gated on corroboration
 *      (no DOB conflict AND >=1 name-token overlap; uncorroborated same-id is
 *      REFUSED outright, never falls through to weaker legs) -> [2] exact
 *      sorted-token name + normDob equality -> [3] exact sorted-token name
 *      with no DOB conflict, EXACTLY ONE candidate in the whole store (any
 *      ambiguity refuses and lets a recoverable duplicate mint instead).
 *      HARD RULES everywhere: conflicting non-empty athenaIds VETO any pairing;
 *      single-token or single-letter names NEVER merge with anything; 1-char
 *      tokens are KEPT in the name key so middle initials still distinguish
 *      ("Mary A Smith" != "Mary B Smith", "Aaron S" != "Aaron Smith").
 *      On a hit: merge into the existing row and copy EVERY surviving field
 *      back onto the caller's object (id included) so a later wholesale
 *      re-upsert of the caller's reference cannot clobber the merged row.
 *  (c) migration (runOnce): DRY-RUN BY DEFAULT - report only, no mutations.
 *      Destructive merge requires runOnce({confirm:'EXECUTE'}) (junk-cleanup
 *      precedent). Groups rows via union-find on [athenaId + corroboration]
 *      OR [sorted-token name + normDob] - NEVER name-only - then VETOES any
 *      group holding >1 distinct non-empty athenaId or >1 distinct DOB
 *      (vetoed pairings are reported, not merged). Survivor = the row whose id
 *      is referenced by the most _calAppts appointments (so server appointment
 *      links keep resolving), tie-broken by earliest created. Before EACH
 *      merging run a FRESH rotated snapshot of the store is written (two
 *      generations kept); no snapshot -> NO merge (fail closed). Every merge
 *      is journaled with deep copies (dropped rows + their positions, field
 *      diffs on the survivor, appended visit keys, note remaps, active-pointer
 *      remap) so revert() can truly undo it - not a snapshot rewind.
 *  (d) references: ONLY store-internal references are remapped - note.patientId
 *      (getNotes/saveNotes) and the active-patient pointer (uns('activePt')).
 *      window._calAppts / server appointment rows (patient_external_id) are
 *      DELIBERATELY LEFT UNTOUCHED: they are rehydrated from server persistence
 *      after boot, so a local rewrite would not stick, and every live consumer
 *      of a dangling patient_external_id degrades safely (calStartVisit guards
 *      with findPatient() and falls back to an unassigned prefilled visit; the
 *      calendar peek bails; timeline/op-prep fall back to name matching).
 *      Survivor preference (c) minimizes dangling ids in the first place.
 *  (e) revert(): replays the journal in reverse (re-inserts dropped rows at
 *      their recorded positions, restores survivor field diffs only where the
 *      current value is still the merged value, removes appended visits,
 *      un-remaps notes + active pointer, un-stamps athenaIds), unwraps
 *      upsertPatient, unhooks the pull handles, removes BOTH document
 *      capture listeners and the message listener, disconnects the mount
 *      MutationObserver, revokes the worker blob URL, refreshes renders, and
 *      deletes the handle. revert({keepMerges:true}) tears down without
 *      undoing merges. NOTE: create-redirect entries do not re-mint the
 *      redirected row (its id was adopted by live references at creation
 *      time); their field/visit contributions to the survivor ARE undone.
 *
 * NAMESPACE: all reads/writes go through the app's own getPatients /
 * savePatients / getNotes / saveNotes / getActivePtId / setActivePtId, which
 * key storage via uns() - i.e. EXACTLY the active session's
 * sf_u::<email>::patients namespace, same as the base app. The snapshot key is
 * derived from window.uns('patients') ONLY; if uns() is unavailable we FAIL
 * CLOSED (no snapshot -> no merge). We never scan localStorage for sf_u:: keys
 * and never touch another account's namespace.
 *
 * TIMERS: none on the main thread. The bounded mount loop is Web-Worker-
 * clocked (worker timers are exempt from Chrome's hidden-tab clamp); if the
 * Worker cannot be constructed the loop STOPS and mounting rides the
 * capture-phase click/visibilitychange listeners + a MutationObserver +
 * a post-eval microtask instead. No bare setTimeout/setInterval anywhere.
 * Post-pull rescans are DRY (report + one toast when new groups appear);
 * they never merge, and never run while a pull/import is running
 * (day pull, cross-provider month pull, AND the Staff-prep month import).
 *
 * READ-ONLY in athenaOne (touches only the MLS store). Additive; no existing
 * code deleted. Revert: window.__mlsDedupById.revert()
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsDedupById) return; } catch (e) { return; }

  var DISABLED = false;
  var FLAGS = {
    /* athena-id merge leg. ident.mrn confirmed chart-level + stable live on
       2026-07-10 (banner id == findpatient row id). Left toggleable so it can
       be disabled at runtime without a redeploy:
       __mlsDedupById.state.flags.athenaIdMerges = false */
    athenaIdMerges: true
  };
  var JR = []; /* journal: {kind:'stamp'|'redirect'|'migration', ...} */
  var api = { version: '1.1.0', build: '2026-07-10-b121' };
  api.state = {
    mounted: false, wrapped: false, hooked: false, dryRunDefault: true,
    flags: FLAGS, journal: JR,
    stamped: 0, redirects: 0, mergedTotal: 0,
    lastScan: null, snapshotKeys: []
  };

  /* ------------------------------ utils ---------------------------------- */
  function S(x) { return x == null ? '' : String(x); }
  function nrm(s) { return S(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  /* 1-char tokens are KEPT so middle initials still distinguish rows */
  function toks(s) { return nrm(s).split(' ').filter(Boolean); }
  function tokset(s) { return toks(s).sort().join(' '); }
  function tokCount(s) { return toks(s).length; }
  function tokOverlap(a, b) { var ta = toks(a), tb = toks(b), o = 0, i; for (i = 0; i < ta.length; i++) { if (tb.indexOf(ta[i]) >= 0) o++; } return o; }
  function pad2(n) { n = String(+n); return n.length < 2 ? '0' + n : n; }
  function deep(x) { try { return x === undefined ? undefined : JSON.parse(JSON.stringify(x)); } catch (e) { return x; } }
  function log(m) { try { console.log('[MLS dedup]', m); } catch (e) {} }
  function say(m) { try { if (typeof window.toast === 'function') window.toast(m, ''); } catch (e) {} log(m); }
  function aidOf(r) { return S((r && r.athenaId) || '').trim().toLowerCase(); }
  function conflictAid(a, b) { return !!(a && b && a !== b); }
  function conflictDob(a, b) { return !!(a && b && a !== b); }
  function byId(arr, id) { for (var i = 0; i < arr.length; i++) { if (arr[i] && String(arr[i].id) === String(id)) return arr[i]; } return null; }

  /* mirrors __mlsVisitModel._normDob exactly (satellite may not be loaded yet) */
  function normDob(s) {
    try { var M = window.__mlsVisitModel; if (M && typeof M._normDob === 'function') { var r = M._normDob(s); if (r) return r; } } catch (e) {}
    s = S(s).trim(); if (!s) return '';
    var iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return [pad2(iso[2]), pad2(iso[3]), +iso[1]].join('/');
    var m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
      var mo = +m[1], d = +m[2], y = +m[3]; if (y < 100) y += (y > 40 ? 1900 : 2000);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return [pad2(mo), pad2(d), y].join('/');
    }
    return '';
  }
  /* mirrors __mlsVisitModel._svcToYMD / _visitKey (used only as fallback) */
  function svcToYMD(s) {
    s = S(s).trim(); if (!s) return '';
    var iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return [iso[1], pad2(iso[2]), pad2(iso[3])].join('-');
    var m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) { var mo = +m[1], d = +m[2], y = +m[3]; if (y < 100) y += (y > 40 ? 1900 : 2000); return [y, pad2(mo), pad2(d)].join('-'); }
    return '';
  }
  function visitKey(v) {
    try { var M = window.__mlsVisitModel; if (M && typeof M._visitKey === 'function') return M._visitKey(v); } catch (e) {}
    v = v || {};
    var d = svcToYMD(v.date) || S(v.date).trim();
    var t = S(v.type || v.procedure || '').trim().toLowerCase().slice(0, 40);
    var c = (Array.isArray(v.cpt) && v.cpt[0]) ? v.cpt[0] : '';
    return [d, t, c].join('|');
  }
  function getP() { try { return (typeof window.getPatients === 'function') ? (window.getPatients() || []) : []; } catch (e) { return []; } }
  function patientsKey() {
    /* mirror the bundle/app: uns('patients') is the ONLY namespace source.
       No localStorage scanning - multiple sf_u:: accounts exist on this
       machine and guessing could snapshot/restore the WRONG user's store.
       No key -> snapshot fails -> merge refuses (fail closed). */
    try { if (typeof window.uns === 'function') { var k = window.uns('patients'); if (k && /^sf_u::/.test(k)) return k; } } catch (e) {}
    return '';
  }
  function refreshRenders() {
    try { if (window.__mlsVisitUI && typeof window.__mlsVisitUI.render === 'function') window.__mlsVisitUI.render(true); } catch (e) {}
    try { if (typeof window.renderPatients === 'function') window.renderPatients(); } catch (e) {}
    try { if (typeof window.renderProfile === 'function') window.renderProfile(); } catch (e) {}
    try { if (typeof window.renderPatientBar === 'function') window.renderPatientBar(); } catch (e) {}
    try { if (typeof window.updateNavCounts === 'function') window.updateNavCounts(); } catch (e) {}
  }

  /* --------- (a) one-shot identity token from the extension read ----------- */
  var EXPECT = null; /* {mrn, name, tokset, tokn, ndob, at, used} */
  var _dirty = false; /* a chart read landed since the last dry rescan */
  function onMsg(ev) {
    try {
      var d = ev && ev.data;
      if (!d || d.source !== 'mls-ext' || d.type !== 'mlsAppChartResult' || !d.resp) return;
      var r = d.resp;
      if (!r.ok) return;
      _dirty = true; /* drives the post-pull DRY rescan even without chartMrn */
      var mrn = S(r.chartMrn || '').trim();
      if (!mrn) return; /* loaded ext build predates v1.89 - stamping inert, name+DOB legs still work */
      EXPECT = {
        mrn: mrn,
        name: S(r.chartName || ''),
        tokset: tokset(r.chartName || ''),
        tokn: tokCount(r.chartName || ''),
        ndob: normDob(r.chartDob || ''),
        at: Date.now(),
        used: false
      };
    } catch (e) {}
  }
  try { window.addEventListener('message', onMsg, true); } catch (e) {}

  var _busy = false; /* suppresses stamp + create-gate during our own mirror upserts */
  function stampIfExpected(p) {
    try {
      if (DISABLED || _busy) return false;
      if (!EXPECT || EXPECT.used) return false;
      if (Date.now() - EXPECT.at > 600000) { EXPECT = null; return false; } /* stale guard - a comparison, not a timer */
      if (!p || typeof p !== 'object' || p.id == null) return false;
      var pd = normDob(p.dob), ok = false;
      /* leg A: normDob equality (+ >=1 token overlap so a junk name can't ride a shared DOB) */
      if (EXPECT.ndob && pd && EXPECT.ndob === pd && tokOverlap(p.name, EXPECT.name) >= 1) ok = true;
      /* leg B: exact sorted-token name equality (>=2 tokens both sides), no DOB conflict */
      else if (EXPECT.tokn >= 2 && tokCount(p.name) >= 2 && tokset(p.name) === EXPECT.tokset && !conflictDob(EXPECT.ndob, pd)) ok = true;
      if (!ok) return false;
      var cur = S(p.athenaId || '').trim();
      if (cur) { /* never overwrite; consume the token if it already agrees */
        if (cur.toLowerCase() === EXPECT.mrn.toLowerCase()) EXPECT.used = true;
        return false;
      }
      var rec = { kind: 'stamp', at: Date.now(), id: p.id, changes: {} };
      p.athenaId = EXPECT.mrn;
      rec.changes.athenaId = { old: '', neu: EXPECT.mrn };
      if (!S(p.mrn || '').trim()) { rec.changes.mrn = { old: S(p.mrn || ''), neu: EXPECT.mrn }; p.mrn = EXPECT.mrn; }
      EXPECT.used = true; /* ONE-SHOT: consumed by the first matching upsert */
      JR.push(rec);
      api.state.stamped++;
      return true;
    } catch (e) { return false; }
  }
  /* public: stamp a row (or a store row by id) from the last chart read,
     under the same strict gates, and persist it */
  api.stampFromLastChart = function (pOrId) {
    try {
      var p = pOrId;
      if (p == null) return false;
      if (typeof p !== 'object') { p = byId(getP(), pOrId); if (!p) return false; }
      var did = stampIfExpected(p);
      if (did && typeof window.upsertPatient === 'function') {
        _busy = true;
        try { window.upsertPatient(p); } finally { _busy = false; }
      }
      return did;
    } catch (e) { return false; }
  };

  /* --------------------- (b) match order + create gate --------------------- */
  function matchRow(arr, name, dob, athenaId) {
    /* HARD RULE: single-token / single-letter names never merge with anything */
    if (tokCount(name) < 2) return null;
    var aid = S(athenaId || '').trim().toLowerCase();
    var db = normDob(dob);
    var i, r;
    /* leg 1: athenaId, corroboration-gated */
    if (aid && FLAGS.athenaIdMerges) {
      var aidHits = [];
      for (i = 0; i < arr.length; i++) { r = arr[i]; if (r && r.id != null && aidOf(r) === aid) aidHits.push(r); }
      if (aidHits.length) {
        if (aidHits.length === 1) {
          var h = aidHits[0];
          if (tokCount(h.name) >= 2 && tokOverlap(h.name, name) >= 1 && !conflictDob(normDob(h.dob), db)) return h;
        }
        /* same athenaId but uncorroborated (or multiple rows claim it):
           REFUSE ENTIRELY - do not fall through to weaker name legs while
           the strong key is contradictory. A duplicate mints (recoverable). */
        return null;
      }
    }
    /* candidates: exact sorted-token name equality, both sides >=2 tokens,
       and NO conflicting athenaId (hard veto) */
    var nk = tokset(name);
    var cands = [];
    for (i = 0; i < arr.length; i++) {
      r = arr[i];
      if (!r || r.id == null) continue;
      if (tokCount(r.name) < 2) continue;
      if (tokset(r.name) !== nk) continue;
      if (conflictAid(aidOf(r), aid)) continue;
      cands.push(r);
    }
    /* leg 2: name + DOB (both present, equal) - refuse on ambiguity */
    if (db) {
      var exact = [];
      for (i = 0; i < cands.length; i++) { if (normDob(cands[i].dob) === db) exact.push(cands[i]); }
      if (exact.length === 1) return exact[0];
      if (exact.length > 1) return null; /* ambiguous - migration will collapse them, not this gate */
    }
    /* leg 3: name-only, no DOB conflict, EXACTLY ONE candidate in the store */
    var loose = [];
    for (i = 0; i < cands.length; i++) { if (!conflictDob(normDob(cands[i].dob), db)) loose.push(cands[i]); }
    if (loose.length === 1) return loose[0];
    return null; /* zero or ambiguous: let a recoverable duplicate mint */
  }

  /* merge = union fields, visits concat+deduped by _visitKey, earliest
     created, latest updated; keep's id survives. Every mutation of `keep`
     is recorded on `rec` so revert() can undo it precisely. */
  var JOINY = { summary: '\n\n', problems: '; ', meds: '; ', allergies: '; ', reason: '; ', extra: '\n', outcome: '\n' };
  function arrKey(x) { try { return (x && typeof x === 'object' && x.id != null) ? ('#' + x.id) : JSON.stringify(x).slice(0, 220); } catch (e) { return String(x); } }
  function recField(rec, k, had, old, neu) { if (rec) rec.fieldChanges.push({ k: k, had: !!had, old: deep(old), neu: deep(neu) }); }
  function mergeRows(keep, drop, rec) {
    if (!keep || !drop || keep === drop) return keep;
    Object.keys(drop).forEach(function (k) {
      if (k === 'id' || k === 'visits' || k === 'created' || k === 'updated') return;
      var a = keep[k], b = drop[k];
      if (b == null || b === '') return;
      if (a == null || a === '' || (Array.isArray(a) && !a.length)) {
        recField(rec, k, Object.prototype.hasOwnProperty.call(keep, k), a, b);
        keep[k] = b; return;
      }
      if (Array.isArray(a) && Array.isArray(b)) {
        var before = deep(a);
        var seen = {}; a.forEach(function (x) { seen[arrKey(x)] = 1; });
        var added = false;
        b.forEach(function (x) { var kk = arrKey(x); if (!seen[kk]) { seen[kk] = 1; a.push(x); added = true; } });
        if (added) recField(rec, k, true, before, a);
        return;
      }
      if (typeof a === 'string' && typeof b === 'string' && a !== b) {
        var la = a.toLowerCase(), lb = b.toLowerCase();
        if (la.indexOf(lb) >= 0) return;                                             /* b already inside a */
        if (lb.indexOf(la) >= 0) { recField(rec, k, true, a, b); keep[k] = b; return; } /* b supersedes a */
        if (JOINY[k]) { var joined = a + JOINY[k] + b; recField(rec, k, true, a, joined); keep[k] = joined; }
        /* other scalars (dob, sex, mrn, athenaId, source...): keep's value wins.
           Conflicting athenaId/DOB pairs never reach here - vetoed upstream. */
      }
    });
    var vs = Array.isArray(keep.visits) ? keep.visits : (keep.visits = []);
    var vseen = {}; vs.forEach(function (v) { vseen[visitKey(v)] = 1; });
    (Array.isArray(drop.visits) ? drop.visits : []).forEach(function (v) {
      var kk = visitKey(v);
      if (!vseen[kk]) { vseen[kk] = 1; vs.push(v); if (rec) rec.visitsAdded.push({ key: kk, copy: deep(v) }); }
    });
    var c0 = keep.created, u0 = keep.updated;
    var c1 = Math.min(keep.created || Date.now(), drop.created || Date.now());
    var u1 = Math.max(keep.updated || 0, drop.updated || 0) || Date.now();
    if (c1 !== c0) recField(rec, 'created', Object.prototype.hasOwnProperty.call(keep, 'created'), c0, c1);
    if (u1 !== u0) recField(rec, 'updated', Object.prototype.hasOwnProperty.call(keep, 'updated'), u0, u1);
    keep.created = c1; keep.updated = u1;
    return keep;
  }

  var _wrapped = false;
  function wrapUpsert() {
    if (_wrapped) return true;
    var orig = window.upsertPatient;
    if (typeof orig !== 'function') return false;
    if (orig.__mlsDedupWrapped) { _wrapped = true; api.state.wrapped = true; return true; }
    var w = function (p) {
      if (!DISABLED && !_busy) {
        try {
          if (p && typeof p === 'object') {
            stampIfExpected(p);
            if (p.id != null) {
              var arr = getP();
              var exists = false;
              for (var i = 0; i < arr.length; i++) { if (arr[i] && arr[i].id === p.id) { exists = true; break; } }
              if (!exists) { /* this upsert would CREATE a row -> dedup gate */
                var hit = matchRow(arr, p.name, p.dob, p.athenaId);
                if (hit) {
                  var rec = { kind: 'redirect', at: Date.now(), keptId: hit.id, incoming: deep(p), fieldChanges: [], visitsAdded: [] };
                  mergeRows(hit, p, rec);
                  /* copy the merged SURVIVOR back onto the caller's reference,
                     id included, so any later wholesale re-upsert of this same
                     object writes the full merged row - never a thin clobber */
                  Object.keys(hit).forEach(function (k) { p[k] = hit[k]; });
                  JR.push(rec);
                  api.state.redirects++;
                  log('create redirected into existing record "' + S(hit.name) + '" (' + hit.id + ') - no duplicate row.');
                }
              }
            }
          }
        } catch (e) {}
      }
      return orig.apply(this, arguments);
    };
    w.__mlsDedupWrapped = true;
    w.__mlsDedupOrig = orig;
    window.upsertPatient = w;
    _wrapped = true;
    api.state.wrapped = true;
    return true;
  }

  /* --------------------- (c) migration scan + runOnce ---------------------- */
  function scan(arr) {
    arr = arr || getP();
    var i, parent = [], vetoed = [];
    function find(a) { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; }
    function uni(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra; }
    function veto(reason, A, B) { vetoed.push({ reason: reason, ids: [A.id, B.id], names: [S(A.name), S(B.name)] }); }
    for (i = 0; i < arr.length; i++) parent[i] = i;
    /* leg 1: same athenaId, corroboration-gated pairwise */
    var byAid = {};
    for (i = 0; i < arr.length; i++) {
      var p1 = arr[i]; if (!p1 || p1.id == null) continue;
      var a1 = aidOf(p1); if (!a1) continue;
      (byAid[a1] = byAid[a1] || []).push(i);
    }
    Object.keys(byAid).forEach(function (a) {
      var idx = byAid[a]; if (idx.length < 2) return;
      var anchor = arr[idx[0]];
      for (var j = 1; j < idx.length; j++) {
        var other = arr[idx[j]];
        if (!FLAGS.athenaIdMerges) { veto('athenaId-merges-disabled', anchor, other); continue; }
        if (tokCount(anchor.name) < 2 || tokCount(other.name) < 2) { veto('single-token-name-never-merges', anchor, other); continue; }
        if (tokOverlap(anchor.name, other.name) < 1) { veto('athenaId-equal-but-zero-name-overlap', anchor, other); continue; }
        if (conflictDob(normDob(anchor.dob), normDob(other.dob))) { veto('athenaId-equal-but-dob-conflict', anchor, other); continue; }
        uni(idx[0], idx[j]);
      }
    });
    /* leg 2: sorted-token name + normDob (both present) - NEVER name-only */
    var byNd = {};
    for (i = 0; i < arr.length; i++) {
      var p2 = arr[i]; if (!p2 || p2.id == null) continue;
      if (tokCount(p2.name) < 2) continue; /* single-token names never merge */
      var db = normDob(p2.dob); if (!db) continue;
      var key = tokset(p2.name) + '|' + db;
      (byNd[key] = byNd[key] || []).push(i);
    }
    Object.keys(byNd).forEach(function (k) {
      var idx = byNd[k]; if (idx.length < 2) return;
      var anchor = arr[idx[0]];
      for (var j = 1; j < idx.length; j++) {
        var other = arr[idx[j]];
        if (conflictAid(aidOf(anchor), aidOf(other))) { veto('conflicting-athenaIds', anchor, other); continue; }
        uni(idx[0], idx[j]);
      }
    });
    /* group + group-level consistency vetoes (union-find transitivity guard) */
    var groups = {}, out = [];
    for (i = 0; i < arr.length; i++) {
      if (!arr[i] || arr[i].id == null) continue;
      var r = find(i);
      (groups[r] = groups[r] || []).push(arr[i]);
    }
    Object.keys(groups).forEach(function (g) {
      var grp = groups[g]; if (grp.length < 2) return;
      var aids = {}, dobs = {}, na = 0, nd = 0;
      grp.forEach(function (p) {
        var a = aidOf(p); if (a && !aids[a]) { aids[a] = 1; na++; }
        var d = normDob(p.dob); if (d && !dobs[d]) { dobs[d] = 1; nd++; }
      });
      if (na > 1) { vetoed.push({ reason: 'group-athenaId-conflict', ids: grp.map(function (p) { return p.id; }), names: grp.map(function (p) { return S(p.name); }) }); return; }
      if (nd > 1) { vetoed.push({ reason: 'group-dob-conflict', ids: grp.map(function (p) { return p.id; }), names: grp.map(function (p) { return S(p.name); }) }); return; }
      out.push(grp);
    });
    return { groups: out, vetoed: vetoed };
  }

  function calRefCounts() {
    /* how many _calAppts appointments reference each store row id -
       used ONLY to pick merge survivors; _calAppts itself is never written */
    var m = {};
    try {
      var src = window._calAppts;
      var list = (typeof src === 'function') ? (src() || []) : (src || []);
      if (!Array.isArray(list)) list = [];
      list.forEach(function (a) {
        if (a && a.patient_external_id != null) {
          var k = String(a.patient_external_id);
          m[k] = (m[k] || 0) + 1;
        }
      });
    } catch (e) {}
    return m;
  }
  function pickSurvivor(g, refs) {
    var best = null, bestRefs = -1, bestCreated = 9e15;
    g.forEach(function (p) {
      var rc = refs[String(p.id)] || 0;
      var cr = p.created || 9e15;
      if (rc > bestRefs || (rc === bestRefs && cr < bestCreated)) { best = p; bestRefs = rc; bestCreated = cr; }
    });
    return best || g[0];
  }

  function snapshotRotate(key) {
    /* FRESH snapshot before EACH merging run; two generations kept.
       ::1 = newest (this run's pre-merge state), ::2 = previous run's. */
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return '';
      var b1 = key + '::b121backup::1', b2 = key + '::b121backup::2';
      try { var prev = localStorage.getItem(b1); if (prev != null) localStorage.setItem(b2, prev); } catch (e) {}
      localStorage.setItem(b1, JSON.stringify({ at: new Date().toISOString(), raw: raw }));
      api.state.snapshotKeys = [b1, b2];
      return b1;
    } catch (e) { return ''; } /* quota -> fail closed, caller refuses to merge */
  }
  api._clearBackups = function (o) {
    if (!o || o.confirm !== 'EXECUTE') return 'Backups kept. Pass {confirm:"EXECUTE"} to delete the rotated pre-merge backups once you are happy with a merge.';
    var key = patientsKey(); if (!key) return 'no-storage-key';
    var n = 0;
    [key + '::b121backup::1', key + '::b121backup::2', key + '::b121backup'].forEach(function (k) {
      try { if (localStorage.getItem(k) != null) { localStorage.removeItem(k); n++; } } catch (e) {}
    });
    api.state.snapshotKeys = [];
    return 'removed ' + n + ' backup snapshot(s)';
  };
  api._restoreSnapshot = function (o) {
    /* emergency whole-store rewind to the newest pre-merge snapshot.
       Prefer revert() - this rewinds EVERYTHING done since that snapshot. */
    if (!o || o.confirm !== 'EXECUTE') return 'Pass {confirm:"EXECUTE"} to rewind the patients store to the newest pre-merge snapshot. Prefer __mlsDedupById.revert() - it undoes ONLY what this module changed.';
    try {
      var key = patientsKey(); if (!key) return 'no-storage-key';
      var bk = JSON.parse(localStorage.getItem(key + '::b121backup::1') || 'null');
      if (!bk || typeof bk.raw !== 'string') return 'no-snapshot';
      localStorage.setItem(key, bk.raw);
      refreshRenders();
      return 'restored snapshot from ' + bk.at;
    } catch (e) { return 'restore-failed: ' + ((e && e.message) || e); }
  };

  function pullRunning() {
    try { var D = window.__mlsDayHistoryPull; if (D && D.state && D.state.running) return true; } catch (e) {}
    try { var M = window.__mlsProvMonthPull; if (M && M.running) return true; } catch (e) {}
    /* Staff-prep schedule month import (the ONE-month pull card lives here) */
    try {
      var E = window.__mlsEasyV32;
      if (E && typeof E.state === 'function') {
        var s = E.state();
        if (s && s.pull && s.pull.running) return true;
      }
    } catch (e) {}
    return false;
  }
  api._pullRunning = pullRunning;

  function runOnce(opts) {
    opts = opts || {};
    if (DISABLED) return { disabled: true };
    var execute = (opts.confirm === 'EXECUTE');
    var arr = getP();
    var sc = scan(arr);
    var wouldMerge = 0; sc.groups.forEach(function (g) { wouldMerge += g.length - 1; });
    api.state.lastScan = {
      at: new Date().toISOString(), rows: arr.length,
      dupGroups: sc.groups.length, wouldMerge: wouldMerge,
      groups: sc.groups.map(function (g) {
        return g.map(function (p) { return { id: p.id, name: S(p.name), dob: S(p.dob || ''), athenaId: S(p.athenaId || ''), visits: (p.visits || []).length, source: S(p.source || '') }; });
      }),
      vetoed: sc.vetoed
    };
    log('scan: ' + sc.groups.length + ' duplicate group(s), ' + wouldMerge + ' row(s) would merge, ' + sc.vetoed.length + ' vetoed pairing(s), store=' + arr.length + ' rows.' +
        (execute ? '' : ' DRY RUN - nothing was changed. Merge with __mlsDedupById.runOnce({confirm:"EXECUTE"}).'));
    if (!execute) return { dry: true, dupGroups: sc.groups.length, wouldMerge: wouldMerge, vetoed: sc.vetoed.length, merged: 0 };
    if (!sc.groups.length) return { dry: false, dupGroups: 0, merged: 0 };
    if (pullRunning()) { log('NOT merging - a pull/import is running. Re-run when it finishes.'); return { aborted: 'pull-running', dupGroups: sc.groups.length, merged: 0 }; }
    if (typeof window.savePatients !== 'function') { log('NOT merging - savePatients missing.'); return { aborted: 'no-savePatients', dupGroups: sc.groups.length, merged: 0 }; }
    var key = patientsKey();
    if (!key) { log('NOT merging - cannot determine the active session\'s patients key (uns() unavailable). Nothing changed.'); return { aborted: 'no-storage-key', dupGroups: sc.groups.length, merged: 0 }; }
    if (!snapshotRotate(key)) { log('NOT merging - fresh pre-merge backup snapshot could not be written (storage quota?). Nothing changed.'); return { aborted: 'no-snapshot', dupGroups: sc.groups.length, merged: 0 }; }
    var refs = calRefCounts();
    var entry = { kind: 'migration', at: Date.now(), merges: [], notes: [], activePt: null };
    var idMap = {}, dropIds = {}, survivors = [];
    sc.groups.forEach(function (g) {
      var keep = pickSurvivor(g, refs);
      var m = { keptId: keep.id, dropped: [], fieldChanges: [], visitsAdded: [] };
      g.forEach(function (p) {
        if (p === keep) return;
        var idx = arr.indexOf(p);
        m.dropped.push({ row: deep(p), index: idx < 0 ? arr.length : idx });
        mergeRows(keep, p, m);
        idMap[p.id] = keep.id;
        dropIds[p.id] = 1;
      });
      entry.merges.push(m);
      survivors.push(keep);
    });
    var out = arr.filter(function (p) { return !(p && dropIds[p.id]); });
    try { window.savePatients(out); }
    catch (e) { log('merge save FAILED: ' + ((e && e.message) || e) + ' - store untouched.'); return { aborted: 'save-failed', dupGroups: sc.groups.length, merged: 0 }; }
    /* STORE-INTERNAL reference remaps ONLY (journaled). _calAppts /
       patient_external_id is deliberately NOT rewritten - see header (d). */
    try {
      if (typeof window.getNotes === 'function' && typeof window.saveNotes === 'function') {
        var ns = window.getNotes() || [], ch = 0;
        ns.forEach(function (n, i) {
          if (n && n.patientId && idMap[n.patientId]) {
            entry.notes.push({ id: (n.id != null ? n.id : null), index: i, old: n.patientId, neu: idMap[n.patientId] });
            n.patientId = idMap[n.patientId]; ch++;
          }
        });
        if (ch) window.saveNotes(ns);
      }
    } catch (e) {}
    try {
      if (typeof window.getActivePtId === 'function' && typeof window.setActivePtId === 'function') {
        var a = window.getActivePtId();
        if (a && idMap[a]) { entry.activePt = { old: a, neu: idMap[a] }; window.setActivePtId(idMap[a]); }
      }
    } catch (e) {}
    JR.push(entry);
    /* mirror survivors to the server, same path as any edit; _busy suppresses
       our stamp/create-gate for these pass-through upserts */
    _busy = true;
    try {
      survivors.forEach(function (p) { try { if (typeof window.upsertPatient === 'function') window.upsertPatient(p); } catch (e) {} });
    } finally { _busy = false; }
    var merged = 0; for (var k in idMap) { if (Object.prototype.hasOwnProperty.call(idMap, k)) merged++; }
    api.state.mergedTotal += merged;
    say('Merged ' + merged + ' duplicate patient row' + (merged === 1 ? '' : 's') + ' into ' + survivors.length + ' record' + (survivors.length === 1 ? '' : 's') +
        (entry.notes.length ? ' (re-pointed ' + entry.notes.length + ' note' + (entry.notes.length === 1 ? '' : 's') + ')' : '') +
        '. Backup: ' + api.state.snapshotKeys[0] + ' - __mlsDedupById.revert() undoes it.');
    refreshRenders();
    return { dupGroups: sc.groups.length, merged: merged };
  }
  api.runOnce = runOnce;
  api._scan = function () { return scan(getP()); };
  api._find = function (name, dob, athenaId) { return matchRow(getP(), name, dob, athenaId); };
  api._last = function () { return EXPECT; };
  api.report = function () {
    var ls = api.state.lastScan;
    return {
      dupGroups: (ls && ls.groups) || [],
      vetoed: (ls && ls.vetoed) || [],
      merged: api.state.mergedTotal,
      stamped: api.state.stamped,
      redirects: api.state.redirects,
      journalEntries: JR.length,
      lastScan: ls
    };
  };

  /* ------------- pull-completion hooks (DRY rescans, no merging) ----------- */
  var _nudged = 0;
  function maybeRescan() {
    if (DISABLED || pullRunning()) return;
    if (!_dirty) return;
    _dirty = false;
    try {
      var r = runOnce({}); /* DRY - reports, never merges */
      if (r && r.dupGroups > _nudged) {
        _nudged = r.dupGroups;
        say('MLS found ' + r.dupGroups + ' possible duplicate patient group' + (r.dupGroups === 1 ? '' : 's') + ' after the last pull. Nothing was merged. Review: __mlsDedupById.report() - merge: __mlsDedupById.runOnce({confirm:"EXECUTE"}).');
      }
    } catch (e) {}
  }
  function afterPull() { try { if (!DISABLED) { _dirty = true; maybeRescan(); } } catch (e) {} }
  function hookOne(obj, key) {
    try {
      var f = obj && obj[key];
      if (typeof f !== 'function') return false;
      if (f.__mlsDedupHook) return true;
      var w = function () {
        var r = f.apply(this, arguments);
        try { Promise.resolve(r).then(afterPull, afterPull); } catch (e) {}
        return r;
      };
      w.__mlsDedupHook = true;
      w.__mlsDedupOrig = f;
      obj[key] = w;
      return true;
    } catch (e) { return false; }
  }
  function hookPulls() {
    var ok = true;
    var D = window.__mlsDayHistoryPull;
    if (D) { ok = hookOne(D, 'pullDay') && ok; ok = hookOne(D, 'pullMonth') && ok; } else ok = false;
    var P = window.__mlsProvMonthPull;
    if (P) { ok = hookOne(P, 'run') && ok; } else ok = false;
    /* the day-pull's floating button calls its CLOSURE run() (invisible to any
       wrapper) and the Staff-prep import never resolves through these handles -
       the _dirty + click/visibilitychange DRY rescan covers those paths. */
    api.state.hooked = ok;
    return ok;
  }

  /* ------------- self-mount: worker clock + events, no bare timers --------- */
  var _wkUrl = null;
  function wkUrl() {
    if (_wkUrl) return _wkUrl;
    try {
      _wkUrl = URL.createObjectURL(new Blob(
        ['onmessage=function(e){setTimeout(function(){postMessage(1)},e.data)}'],
        { type: 'application/javascript' }
      ));
    } catch (e) { _wkUrl = null; }
    return _wkUrl;
  }
  function wwait(ms) {
    /* resolves true after ~ms via a WORKER timer (hidden-tab safe); resolves
       false IMMEDIATELY when no worker is available - callers must then stop
       looping and rely on the event-driven fallbacks. NEVER a main-thread timer. */
    return new Promise(function (res) {
      var u = wkUrl();
      if (!u) return res(false);
      try {
        var w = new Worker(u);
        w.onmessage = function () { try { w.terminate(); } catch (e) {} res(true); };
        w.onerror = function () { try { w.terminate(); } catch (e) {} res(false); };
        w.postMessage(ms);
      } catch (e) { res(false); }
    });
  }
  var _ranInitial = false, _mountedAll = false, _mo = null;
  function mountTick() {
    if (DISABLED) return true;
    var okU = wrapUpsert();
    var okH = hookPulls();
    if (okU && !_ranInitial && typeof window.getPatients === 'function' && typeof window.savePatients === 'function') {
      _ranInitial = true;
      /* DRY-RUN ONLY on mount: report, toast if dups exist, mutate NOTHING. */
      try {
        var r = runOnce({});
        if (r && r.dupGroups > 0) {
          _nudged = r.dupGroups;
          say('MLS found ' + r.dupGroups + ' possible duplicate patient group' + (r.dupGroups === 1 ? '' : 's') + '. Nothing was merged. Review: __mlsDedupById.report() - merge: __mlsDedupById.runOnce({confirm:"EXECUTE"}).');
        }
      } catch (e) {}
    }
    _mountedAll = okU && okH && _ranInitial;
    api.state.mounted = _mountedAll;
    if (_mountedAll && _mo) { try { _mo.disconnect(); } catch (e) {} _mo = null; }
    return _mountedAll;
  }
  function onUserEvt() {
    try {
      if (DISABLED) return;
      if (!_mountedAll) mountTick();
      maybeRescan();
    } catch (e) {}
  }
  (function mount() {
    try { if (mountTick()) return; } catch (e) {}
    /* microtask: fires after the WHOLE bundle has evaluated, so the pull
       handles defined below us in the file are hookable immediately */
    try { Promise.resolve().then(function () { try { mountTick(); } catch (e) {} }); } catch (e) {}
    /* bounded worker-clocked loop for late-mounting satellites */
    (function () {
      (async function () {
        for (var i = 0; i < 90 && !DISABLED && !_mountedAll; i++) { /* <= ~90 worker ticks */
          var ticked = await wwait(1000);
          if (!ticked) break; /* no worker -> events + observer take over */
          try { if (mountTick()) break; } catch (e) {}
        }
      })();
    })();
    /* observer fallback: any DOM activity retries the mount until it lands */
    try {
      _mo = new MutationObserver(function () { try { if (!DISABLED && !_mountedAll) mountTick(); } catch (e) {} });
      _mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) { _mo = null; }
  })();
  try { document.addEventListener('click', onUserEvt, true); } catch (e) {}
  try { document.addEventListener('visibilitychange', onUserEvt, true); } catch (e) {}

  /* ------------------------------- revert ---------------------------------- */
  api.revert = function (opts) {
    opts = opts || {};
    DISABLED = true;
    var undone = 0;
    if (!opts.keepMerges) {
      /* journal replay, newest first: TRUE undo (re-insert dropped rows,
         un-remap references, restore survivor diffs, un-stamp ids) - each
         restore is guarded so it never clobbers unrelated later edits */
      try {
        var arr = getP(), dirty = false;
        var notesArr = null, notesDirty = false;
        for (var j = JR.length - 1; j >= 0; j--) {
          var e = JR[j];
          if (e.kind === 'stamp') {
            var row = byId(arr, e.id);
            if (row && e.changes) {
              Object.keys(e.changes).forEach(function (f) {
                var c = e.changes[f];
                if (S(row[f] || '') === S(c.neu || '')) {
                  if (c.old === '' || c.old == null) { try { delete row[f]; } catch (er) { row[f] = ''; } }
                  else row[f] = c.old;
                  dirty = true;
                }
              });
            }
          } else if (e.kind === 'redirect' || e.kind === 'migration') {
            var merges = (e.kind === 'migration') ? (e.merges || []) : [e];
            merges.forEach(function (m) {
              var keep = byId(arr, m.keptId);
              if (keep) {
                (m.visitsAdded || []).forEach(function (va) {
                  var vs = Array.isArray(keep.visits) ? keep.visits : [];
                  for (var i2 = vs.length - 1; i2 >= 0; i2--) {
                    if (visitKey(vs[i2]) === va.key) { vs.splice(i2, 1); dirty = true; break; }
                  }
                });
                (m.fieldChanges || []).slice().reverse().forEach(function (fc) {
                  try {
                    if (JSON.stringify(keep[fc.k]) === JSON.stringify(fc.neu)) {
                      if (!fc.had) { try { delete keep[fc.k]; } catch (er) { keep[fc.k] = undefined; } }
                      else keep[fc.k] = fc.old;
                      dirty = true;
                    }
                  } catch (er) {}
                });
              }
              (m.dropped || []).forEach(function (d) {
                if (d && d.row && d.row.id != null && !byId(arr, d.row.id)) {
                  arr.splice(Math.min(d.index || 0, arr.length), 0, deep(d.row));
                  dirty = true; undone++;
                }
              });
            });
            if (e.kind === 'migration') {
              (e.notes || []).forEach(function (nr) {
                if (notesArr === null) { try { notesArr = (typeof window.getNotes === 'function') ? (window.getNotes() || []) : null; } catch (er) { notesArr = null; } }
                if (!notesArr) return;
                var n = null;
                if (nr.id != null) { for (var i3 = 0; i3 < notesArr.length; i3++) { if (notesArr[i3] && notesArr[i3].id === nr.id) { n = notesArr[i3]; break; } } }
                if (!n && nr.index != null && notesArr[nr.index]) n = notesArr[nr.index];
                if (n && n.patientId === nr.neu) { n.patientId = nr.old; notesDirty = true; }
              });
              if (e.activePt) {
                try {
                  if (typeof window.getActivePtId === 'function' && typeof window.setActivePtId === 'function' &&
                      window.getActivePtId() === e.activePt.neu) window.setActivePtId(e.activePt.old);
                } catch (er) {}
              }
            }
          }
        }
        if (dirty && typeof window.savePatients === 'function') {
          try { window.savePatients(arr); } catch (er) { log('revert: patients save failed: ' + ((er && er.message) || er) + ' - emergency rewind available via _restoreSnapshot({confirm:"EXECUTE"}) using ' + (api.state.snapshotKeys[0] || '(no snapshot)')); }
        }
        if (notesDirty && typeof window.saveNotes === 'function') { try { window.saveNotes(notesArr); } catch (er) {} }
        JR.length = 0;
        log('revert: journal replayed; ' + undone + ' dropped row(s) re-inserted. Pre-merge snapshots kept at ' + (api.state.snapshotKeys.join(', ') || '(none)') + '.');
      } catch (e2) {
        log('revert: journal replay error: ' + ((e2 && e2.message) || e2) + ' - emergency rewind: __mlsDedupById-less console: localStorage snapshot at ' + (api.state.snapshotKeys[0] || '(none)'));
      }
    }
    /* teardown: listeners, observer, worker URL, wrappers, hooks, renders */
    try { window.removeEventListener('message', onMsg, true); } catch (e) {}
    try { document.removeEventListener('click', onUserEvt, true); } catch (e) {}
    try { document.removeEventListener('visibilitychange', onUserEvt, true); } catch (e) {}
    try { if (_mo) { _mo.disconnect(); _mo = null; } } catch (e) {}
    try { if (_wkUrl) { URL.revokeObjectURL(_wkUrl); _wkUrl = null; } } catch (e) {}
    try {
      var u = window.upsertPatient;
      if (u && u.__mlsDedupWrapped && u.__mlsDedupOrig) window.upsertPatient = u.__mlsDedupOrig;
      /* if a later module wrapped on top of ours, DISABLED already makes our
         layer a pure pass-through; the chain stays intact */
    } catch (e) {}
    try {
      var D = window.__mlsDayHistoryPull;
      if (D) {
        ['pullDay', 'pullMonth'].forEach(function (k) {
          try { if (D[k] && D[k].__mlsDedupHook && D[k].__mlsDedupOrig) D[k] = D[k].__mlsDedupOrig; } catch (e2) {}
        });
      }
    } catch (e) {}
    try {
      var Pm = window.__mlsProvMonthPull;
      if (Pm && Pm.run && Pm.run.__mlsDedupHook && Pm.run.__mlsDedupOrig) Pm.run = Pm.run.__mlsDedupOrig;
    } catch (e) {}
    refreshRenders();
    try { delete window.__mlsDedupById; } catch (e) { try { window.__mlsDedupById = undefined; } catch (e2) {} }
    return { undoneRows: undone };
  };

  window.__mlsDedupById = api;
})();


/* =========================================================================
 * MLS Scribe - INDIVIDUAL-VISITS BACKFILL  (__mlsVisitsBackfill) v1.1.0
 * 2026-07-10 (b121)   PREPEND MODULE - top of mls-connect.js
 *
 * WHY: a day/month chart pull files each patient's whole read as ONE
 * {type:'Chart summary'} row (__mlsDayHistoryPull._pullOne -> addVisit), and
 * ingestChart never splits text - so most pulled patients sit at 1-2 visits.
 * This module watches for a pull to FINISH (falling edge of
 * __mlsDayHistoryPull.state.running - the same state object pullDay, pullMonth
 * and __mlsProvMonthPull.run all drive), queues that run's patients that still
 * have fewer than 2 visits, and - one patient at a time - asks the extension
 * for the patient's INDIVIDUAL dated encounters via the bridge pair
 *   mlsAppReadVisits  ->  mlsAppReadVisitsResult
 * Contract (extension lane, verified 2026-07-10): request {name, dob, athenaId};
 * reply {ok, visits:[{date:'YYYY-MM-DD', type, provider, textHead}], reason}.
 * The EXTENSION opens the chart itself (findpatient route) and verifies
 * identity extension-side (name+dob+athenaId), refusing honestly with
 * 'wrong-chart' / 'unverified-dob' / 'no-rail' / 'busy'. Extension budget is
 * 90s per patient; our app-side timeout is 110s, ABSOLUTE-DEADLINE based.
 *
 * SAFETY / CORRECTNESS (wf_5 + wf_9 applied):
 *  - App-side identity gate is a fail-closed VETO, never an acceptance path:
 *    a chart name that fails token-match ALWAYS blocks (no DOB-only rescue),
 *    and a normalized-DOB mismatch ALWAYS blocks. Both DOB sides go through
 *    __mlsVisitModel._normDob so store-format DOBs ('1/2/1960', ISO) never
 *    false-block. Acceptance authority is the extension's own verification.
 *  - Pull rows that failed with identity-mismatch are NEVER enqueued.
 *  - Single-flight: one bridge read at a time; an in-flight read is ABORTED
 *    (result discarded, patient requeued) if a pull's state.running rises
 *    mid-read. anyPullRunning() covers the day/month pulls, the import-chain
 *    bulk pull, AND flagless athena-driving engines (cohort study builder /
 *    grab / copy-visits) via a capture-phase message listener that watches
 *    for foreign drive traffic (memory: capture-phase listeners, never timers).
 *  - Stable dedup: our own (date | type-40-lc) key is pre-checked against the
 *    patient's existing visits, so re-runs are idempotent regardless of CPT
 *    extraction; same-day same-type encounters get a deterministic rail-order
 *    suffix ' (2)' so both survive; cpt/icd10 are passed as EXPLICIT arrays
 *    (extracted deterministically from the exact filed text), never left to
 *    _normVisit's \b\d{5}\b auto-extraction for the _visitKey. Known bounded
 *    loss: if the extension ever returns same-day same-type rows in a
 *    different order, suffixed rows can swap raw text between them (both rows
 *    still exist; nothing is dropped).
 *  - Ingest is continue-not-break: one poison visit never drops the rest of
 *    a patient's encounters (cap: 3 CONSECUTIVE addVisit errors bails with an
 *    honest 'ingest-error-cap' reason; isolated errors are skipped).
 *  - Stop conditions: 2 consecutive 'timeout'/'no-ext'/'ext-error' failures
 *    stop the pump ('extension-not-answering'); a fast mlsPing probe stops
 *    immediately when no extension is loaded ('no-ext'); logged-out /
 *    no-athena-tab reasons stop as 'athena-session-lost'. 'busy' is transient
 *    (requeued at the back, max 2 retries).
 *  - _doneKeys uses ONE key everywhere: nrm() of the RESOLVED store-row name,
 *    computed once at enqueue and carried on the queue item. Only DEFINITIVE
 *    outcomes are marked done; transient failures stay retryable.
 *  - Schedule DOB (from _calAppts, same source the live pull trusts) is
 *    passed through enqueueFromRun in preference to the store row's DOB.
 *  - OPENAI-COST GUARDRAIL: ensureSummaries / summarizeVisit are NOT called
 *    (CFG.autoSummarize=false). Visits are filed with aiSummary EMPTY, which
 *    is exactly the flag the live chart UI keys on: feat_visits.js b84
 *    renders a per-visit 'Generate AI summary' button and a 'Summarize all
 *    (N)' header button for empty-aiSummary visits (verified in the live
 *    satellite; the UI does NOT auto-summarize on open - it is click-driven).
 *  - EVERY wait is a Web-Worker timer (main-thread timers throttle to ~0 in
 *    the hidden MLS tab). The per-read timeout is an absolute-deadline loop
 *    of one-shot 1s worker ticks, so no long-lived timer worker ever leaks
 *    on early resolve (wf_5 hardening, strengthened). revert() nulls _wkUrl
 *    after revoking it so any straggler wait() degrades to setTimeout
 *    instead of hanging on a revoked blob URL (wf_5 hardening).
 *  - READ-ONLY intent: only ever POSTS a read request; zero athena writes.
 *  - Purely ADDITIVE: wraps/replaces nothing. Revert:
 *    window.__mlsVisitsBackfill.revert() stops all loops and removes the API.
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsVisitsBackfill) return; } catch (e) { return; }

  var CFG = {
    minVisits: 2,            /* queue patients with fewer than this many visits */
    maxPerPatient: 40,       /* hard cap on visits filed per patient per run */
    maxVisitsAsk: 30,        /* how many encounters we ask the extension for */
    readTimeoutMs: 110000,   /* extension budget is 90s; app deadline 110s (absolute) */
    tickMs: 1000,            /* deadline-loop cadence inside a read (one-shot workers) */
    paceMs: 2500,            /* breather between patients */
    pollMs: 1500,            /* falling-edge watcher cadence */
    busyRetryWaitMs: 15000,  /* extra wait after an honest 'busy' refusal */
    foreignBusyMs: 45000,    /* rolling busy window after foreign athena-drive traffic */
    maxTextLen: 20000,       /* per-visit raw text cap (call-stack mitigation) */
    minTextLen: 25,          /* below this a returned row is junk */
    maxConsecFail: 2,        /* consecutive timeout/no-ext/ext-error -> stop */
    maxConsecIngestErr: 3,   /* consecutive addVisit throws -> bail that patient */
    autoSummarize: false     /* OPENAI GUARDRAIL: leave false; UI buttons are the lazy path */
  };

  /* ---------------------------- tiny helpers ------------------------------ */
  function S(x) { return (x == null ? '' : String(x)); }
  function nrm(s) { return S(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function collapse(s) { return S(s).replace(/\s+/g, ' ').trim(); }
  function tokset(s) { return nrm(s).split(' ').filter(function (x) { return x.length > 1; }).sort().join(' '); }
  function say(m) { try { if (typeof window.toast === 'function') window.toast(m, ''); } catch (e) {} try { console.log('[MLS visits-backfill]', m); } catch (e) {} }
  function strip(t) { try { return (window.__mlsSummarySanitize && typeof window.__mlsSummarySanitize.strip === 'function') ? window.__mlsSummarySanitize.strip(t) : t; } catch (e) { return t; } }
  function VM() { try { return window.__mlsVisitModel || null; } catch (e) { return null; } }

  /* _normDob: reuse the model's exported normalizer (wf_9 #2); identical local
   * replica as fallback for the window before the feat_visits satellite loads. */
  function normDob(s) {
    try { var M = VM(); if (M && typeof M._normDob === 'function') return M._normDob(s) || ''; } catch (e) {}
    s = S(s).trim(); if (!s) return '';
    var iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return [String(+iso[2]).length < 2 ? '0' + (+iso[2]) : String(+iso[2]), String(+iso[3]).length < 2 ? '0' + (+iso[3]) : String(+iso[3]), +iso[1]].join('/');
    var m = s.match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/);
    if (m) {
      var mo = +m[1], d = +m[2], y = +m[3]; if (y < 100) y += (y > 40 ? 1900 : 2000);
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return [('0' + mo).slice(-2), ('0' + d).slice(-2), y].join('/');
    }
    return '';
  }
  function svcToYMD(s) {
    try { var M = VM(); if (M && typeof M._svcToYMD === 'function') return M._svcToYMD(s) || ''; } catch (e) {}
    var iso = S(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (iso) return [iso[1], ('0' + (+iso[2])).slice(-2), ('0' + (+iso[3])).slice(-2)].join('-');
    return '';
  }

  /* Worker-timer wait: proven __mlsDayHistoryPull v1.2.0 pattern (one-shot,
   * self-terminating; exempt from hidden-tab throttling). */
  var _wkUrl = null;
  try { _wkUrl = URL.createObjectURL(new Blob(['onmessage=function(e){setTimeout(function(){postMessage(1)},e.data)}'], { type: 'application/javascript' })); } catch (e) {}
  function wait(ms) {
    return new Promise(function (r) {
      if (_wkUrl) { try { var w = new Worker(_wkUrl); w.onmessage = function () { try { w.terminate(); } catch (e) {} r(); }; w.postMessage(ms); return; } catch (e) {} }
      setTimeout(r, ms); /* last resort only (post-revert, or blob workers unavailable) */
    });
  }

  /* -------------------- app-store / schedule accessors --------------------- */
  function getPats() { try { return (typeof window.getPatients === 'function') ? (window.getPatients() || []) : []; } catch (e) { return []; } }
  function calRows() {
    /* base-app per-visit state can be global-LEXICAL, not on window (memory: prepend-module scope gotcha) */
    try { if (typeof _calAppts !== 'undefined' && _calAppts) { return (typeof _calAppts === 'function') ? (_calAppts() || []) : _calAppts; } } catch (e) {}
    try { return (typeof window._calAppts === 'function') ? (window._calAppts() || []) : (window._calAppts || []); } catch (e) { return []; }
  }
  function schedDobFor(name) {
    var k = nrm(name); if (!k) return '';
    var rows = calRows();
    for (var i = 0; i < rows.length; i++) { var a = rows[i]; if (a && a.name && a.dob && nrm(a.name) === k) return S(a.dob); }
    return '';
  }
  /* resolve a pull-row / caller name to the ONE store row it belongs to:
   * exact -> token-sorted ("Last, First" vs "First Last") -> bidirectional substring */
  function resolveStorePatient(name) {
    var k = nrm(name); if (!k) return null;
    var ps = getPats(), i, pn;
    for (i = 0; i < ps.length; i++) { if (ps[i] && nrm(ps[i].name) === k) return ps[i]; }
    var kt = tokset(name);
    if (kt) { for (i = 0; i < ps.length; i++) { if (ps[i] && tokset(ps[i].name) === kt) return ps[i]; } }
    for (i = 0; i < ps.length; i++) {
      pn = nrm(ps[i] && ps[i].name);
      if (pn && (pn.indexOf(k) >= 0 || k.indexOf(pn) >= 0)) return ps[i];
    }
    return null;
  }
  function byId(id) {
    if (!id) return null;
    var ps = getPats();
    for (var i = 0; i < ps.length; i++) { if (ps[i] && ps[i].id === id) return ps[i]; }
    return null;
  }
  function visitCount(p) { return (p && Array.isArray(p.visits)) ? p.visits.length : 0; }
  function pullState() { try { return (window.__mlsDayHistoryPull && window.__mlsDayHistoryPull.state) || null; } catch (e) { return null; } }

  /* --------------- athena-busy detection (wf_9 #3, app half) --------------- */
  var _foreignBusyUntil = 0;
  var DRIVE_REQ = { mlsAppGoHome: 1, mlsAppGotoDate: 1, mlsAppReadChart: 1, mlsAppReadAllVisits: 1, mlsAppSearchProcedure: 1, mlsAppSearchPatient: 1, mlsAppReadVisits: 1 };
  var DRIVE_PROG = { mlsAppVisitsProgress: 1, mlsAppSearchProgress: 1, mlsAppChartProgress: 1 };
  function onAnyMessage(ev) {
    try {
      var d = ev && ev.data; if (!d || !d.type) return;
      if (d.source === 'mls-app' && DRIVE_REQ[d.type] && !d.__vbf) { _foreignBusyUntil = Math.max(_foreignBusyUntil, Date.now() + CFG.foreignBusyMs); return; }
      if (d.source === 'mls-ext' && DRIVE_PROG[d.type]) { _foreignBusyUntil = Math.max(_foreignBusyUntil, Date.now() + 30000); }
    } catch (e) {}
  }
  try { window.addEventListener('message', onAnyMessage, true); } catch (e) {}

  function anyPullRunning() {
    var st = pullState(); if (st && st.running) return true;
    try { if (window.__mlsProvMonthPull && window.__mlsProvMonthPull.running) return true; } catch (e) {}
    try { if (window.__mlsImportChainFix && window.__mlsImportChainFix.bulk && window.__mlsImportChainFix.bulk.running) return true; } catch (e) {}
    if (Date.now() < _foreignBusyUntil) return true; /* cohort builder / grab / copy-visits etc. (flagless engines) */
    return false;
  }

  /* -------------------------------- state --------------------------------- */
  var STATE = {
    version: '1.1.0', build: '2026-07-10-b121',
    watching: true, running: false, stopped: false, stopReason: '',
    queue: [], current: '', progress: '', status: '', inFlight: false,
    done: 0, ok: 0, failed: 0, transient: 0,
    visitsAdded: 0, visitsSkippedExisting: 0, skippedUndated: 0,
    rows: [], consecFail: 0, lastEdgeAt: 0
  };
  var _alive = true;
  var _pumping = false;
  var _doneKeys = {};  /* nrm(RESOLVED store-row name) -> ts; one key everywhere (wf_9 #6) */

  /* ----------------------------- status line ------------------------------ */
  function statusLine(msg) {
    STATE.status = S(msg);
    try {
      var panel = document.getElementById('mlsPullProgPanel');
      var hostEl = panel && panel.querySelector('.ppc');
      if (hostEl) {
        var el = document.getElementById('mlsVbfStatus');
        if (!el) { el = document.createElement('div'); el.id = 'mlsVbfStatus'; el.style.cssText = 'margin-top:8px;font:12px system-ui;color:#9fb0d8'; }
        if (el.parentNode !== hostEl) hostEl.appendChild(el); /* panel re-renders wipe it; re-attach */
        el.textContent = 'Visit backfill: ' + STATE.status;
        return;
      }
    } catch (e) {}
    try { console.log('[MLS visits-backfill]', STATE.status); } catch (e) {}
  }

  /* ---------------------------- extension ping ---------------------------- */
  function pingExt() {
    return new Promise(function (resolve) {
      var settled = false, deadline = Date.now() + 3500;
      function fin(v) { if (settled) return; settled = true; try { window.removeEventListener('message', h); } catch (e) {} resolve(v); }
      function h(ev) { var d = ev && ev.data; if (d && d.type === 'mlsPong') fin(true); }
      try { window.addEventListener('message', h, false); } catch (e) {}
      try { window.postMessage({ type: 'mlsPing', source: 'mls-app', from: 'mls-app' }, '*'); } catch (e) { fin(false); return; }
      (function loop() {
        if (settled) return;
        if (Date.now() >= deadline) { fin(false); return; }
        wait(400).then(loop);
      })();
    });
  }

  /* --------------- bridge: read ONE patient's individual visits ------------
   * Single-flight. Absolute-deadline loop of ONE-SHOT worker ticks: nothing
   * long-lived leaks on early resolve (wf_5), and the read is ABORTED the
   * moment a pull's state.running rises mid-read (wf_9 #3). */
  function bridgeVisits(payload) {
    if (STATE.inFlight) return Promise.resolve({ __localBusy: true });
    STATE.inFlight = true;
    return new Promise(function (resolve) {
      var settled = false, deadline = Date.now() + CFG.readTimeoutMs;
      function fin(v) { if (settled) return; settled = true; STATE.inFlight = false; STATE.progress = ''; try { window.removeEventListener('message', h); } catch (e) {} resolve(v); }
      function h(ev) {
        var d = ev && ev.data; if (!d || d.source !== 'mls-ext' || !d.type) return;
        if (d.type === 'mlsAppReadVisitsProgress') { STATE.progress = S(d.message || (d.n != null ? ('visit ' + d.n + (d.total ? ' of ' + d.total : '')) : '')); return; }
        if (d.type !== 'mlsAppReadVisitsResult') return;
        fin(d.resp || d); /* tolerate resp-wrapped (main router) and flat (satellite) replies */
      }
      try { window.addEventListener('message', h, false); } catch (e) {}
      try {
        window.postMessage(Object.assign({ type: 'mlsAppReadVisits', source: 'mls-app', from: 'mls-app', __vbf: 1 }, payload || {}), '*');
      } catch (e) { fin({ ok: false, reason: 'ext-error', error: 'postMessage failed: ' + ((e && e.message) || e) }); }
      (function tickLoop() {
        if (settled) return;
        if (Date.now() >= deadline) { fin({ __timeout: true }); return; }
        var st = pullState();
        if (st && st.running) { fin({ __aborted: true }); return; } /* discard: a pull took the athena tab */
        wait(Math.min(CFG.tickMs, Math.max(50, deadline - Date.now()))).then(tickLoop);
      })();
    });
  }

  /* -------- open the patient's chart FIRST (live fix 2026-07-10) ------------
   * The v1.89 visits driver reads the OPEN chart (its rail click navigates the
   * chart frame) - it does NOT open patients itself; the pull's ground step
   * leaves athena on the dashboard between patients, where the identity gate
   * (correctly) refuses. So each backfill item first opens the chart through
   * the proven schedule-independent findpatient bridge, then reads visits.
   * Same in-flight/abort/timeout discipline as bridgeVisits. */
  function bridgeOpen(name, dob) {
    return new Promise(function (resolve) {
      var settled = false, deadline = Date.now() + 60000;
      function fin(v) { if (settled) return; settled = true; try { window.removeEventListener('message', h); } catch (e) {} resolve(v); }
      function h(ev) {
        var d = ev && ev.data; if (!d || d.source !== 'mls-ext' || !d.type) return;
        if (d.type !== 'mlsAppSearchOpenResult') return;
        fin(d.resp || d);
      }
      try { window.addEventListener('message', h, false); } catch (e) {}
      try {
        window.postMessage({ type: 'mlsAppSearchOpenPatient', source: 'mls-app', name: S(name).slice(0, 120), dob: S(dob).slice(0, 20), __vbf: 1 }, '*');
      } catch (e) { fin({ ok: false, error: 'postMessage failed: ' + ((e && e.message) || e) }); }
      (function tickLoop() {
        if (settled) return;
        if (Date.now() >= deadline) { fin({ __timeout: true }); return; }
        var st = pullState();
        if (st && st.running) { fin({ __aborted: true }); return; }
        wait(Math.min(CFG.tickMs, Math.max(50, deadline - Date.now()))).then(tickLoop);
      })();
    });
  }

  /* -------- identity gate: fail-closed VETO, never an acceptance path ------
   * The EXTENSION is the acceptance authority (it verified name+dob+athenaId
   * before ok:true). App-side we only VETO on contradiction (wf_9 #1):
   *  - chart name present but token-mismatched  -> BLOCK (no DOB-only rescue)
   *  - both DOBs present and normalized-unequal -> BLOCK
   * DOB equality alone never accepts anything; it is mere corroboration. */
  function identityVeto(targetName, targetDob, r) {
    r = r || {};
    var ident = (r.identity && typeof r.identity === 'object') ? r.identity : {};
    var cn = S(ident.name || r.chartName || '');
    var cdRaw = S(ident.dob || r.chartDob || '');
    if (!cn && !cdRaw) return { ok: true, via: 'ext-verified' };
    var pd = normDob(targetDob), cd = normDob(cdRaw);        /* wf_9 #2: _normDob BOTH sides */
    if (pd && cd && pd !== cd) return { ok: false, why: 'dob-mismatch' };
    if (cn) {
      var kt = nrm(targetName), kc = nrm(cn);
      var toks = kt.split(' ').filter(function (x) { return x.length > 1; });
      var overlap = 0;
      for (var i = 0; i < toks.length; i++) { if (kc.indexOf(toks[i]) >= 0) overlap++; }
      var nameOk = !!kc && (overlap >= 2 || kc.indexOf(kt) >= 0 || kt.indexOf(kc) >= 0);
      if (!nameOk) return { ok: false, why: 'name-mismatch:' + cn.slice(0, 60) };
      return { ok: true, via: (pd && cd) ? 'name+dob' : 'name' };
    }
    return { ok: true, via: cd ? 'dob-corroborated' : 'ext-verified' };
  }

  /* ------------- file one reply's visits through the model -----------------
   * Stable dedup (wf_9 #4): our OWN key (ymd | type-40-lc) pre-checked against
   * existing visits; deterministic rail-order suffix for same-day same-type;
   * explicit cpt/icd10 arrays so _visitKey never rides auto-extraction.
   * Continue-not-break with a consecutive-error cap (wf_9 #5). */
  function stableKey(ymd, type) { return ymd + '|' + collapse(type).toLowerCase().slice(0, 40); }
  function ingestVisits(p, visits) {
    var M = VM();
    if (!M || typeof M.addVisit !== 'function') return { added: 0, skipped: 0, reason: 'no-visit-model' };
    var have = {};
    (Array.isArray(p.visits) ? p.visits : []).forEach(function (x) {
      if (!x) return;
      var d = svcToYMD(x.date) || S(x.date);
      have[stableKey(d, S(x.type))] = 1;
    });
    var seen = {}, batch = [];
    for (var i = 0; i < visits.length; i++) {
      var v = visits[i] || {};
      var text = strip(S(v.textHead != null ? v.textHead : (v.text != null ? v.text : v.raw)));
      text = S(text);
      if (text.length < CFG.minTextLen) continue;                    /* junk row */
      if (text.length > CFG.maxTextLen) text = text.slice(0, CFG.maxTextLen);
      var ymd = svcToYMD(v.date);
      if (!ymd) { STATE.skippedUndated++; continue; }                /* dated encounters ONLY (undated rows sink in the UI) */
      var baseType = collapse(v.type).slice(0, 74) || 'Office visit'; /* never 'Chart summary' - keeps a distinct _visitKey from the pull blob */
      var sk = stableKey(ymd, baseType);
      var n = (seen[sk] = (seen[sk] || 0) + 1);
      var type = n > 1 ? baseType + ' (' + n + ')' : baseType;       /* <=80 chars; both same-day same-type rows survive */
      batch.push({ ymd: ymd, type: type, text: text, provider: collapse(v.provider).slice(0, 120) });
    }
    var added = 0, skippedExisting = 0, errs = 0, consecErr = 0, lastErr = '';
    for (var j = 0; j < batch.length; j++) {
      if (added >= CFG.maxPerPatient) break;
      var b = batch[j];
      if (have[stableKey(b.ymd, b.type)]) { skippedExisting++; continue; } /* idempotent re-runs, independent of cpt[0] */
      var cpt = [], icd = [];
      try { if (typeof M._cpt === 'function') cpt = M._cpt(b.text) || []; } catch (e) { cpt = []; }
      try { if (typeof M._icd10 === 'function') icd = M._icd10(b.text) || []; } catch (e) { icd = []; }
      try {
        var stored = M.addVisit(p.id, {
          date: b.ymd,
          type: b.type,
          raw: (b.provider ? 'Provider: ' + b.provider + '\n' : '') + b.text,  /* provider rides atop the collapsible raw pre (no provider field in the model/UI) */
          findings: b.text.replace(/\s+/g, ' ').slice(0, 160),                 /* at-a-glance chip before any summary exists */
          cpt: cpt, icd10: icd
          /* aiSummary left EMPTY on purpose: that is the flag the live chart UI
           * keys on - it renders 'Generate AI summary' / 'Summarize all (N)'
           * buttons for empty-aiSummary visits (feat_visits.js b84, verified).
           * No OpenAI call is made here (cost guardrail). */
        }, { source: 'athena-visits' });
        if (stored) { added++; have[stableKey(b.ymd, b.type)] = 1; consecErr = 0; }
      } catch (e) {
        errs++; consecErr++; lastErr = S((e && e.message) || e).slice(0, 120);
        if (consecErr >= CFG.maxConsecIngestErr) {
          return { added: added, skipped: skippedExisting, reason: 'ingest-error-cap:' + lastErr };
        }
        /* else CONTINUE: one poison visit never drops the rest (wf_9 #5) */
      }
    }
    return { added: added, skipped: skippedExisting, reason: errs ? 'ingest-partial(' + errs + '):' + lastErr : '' };
  }

  /* ------------------------- one patient's backfill ------------------------ */
  var SESSION_LOST = /logg?ed[ -]?out|log[ -]?in\b|session (?:expired|ended|timed|lost)|no-athena-tab/i;
  function backfillOne(item) {
    return (async function () {
      /* row.definitive: true -> _doneKeys marked (never re-hit); false -> retryable */
      var row = { name: item.name, key: item.key, ok: false, added: 0, skipped: 0, reason: '', definitive: false };
      var p = byId(item.pid) || resolveStorePatient(item.name);
      if (!p) { row.reason = 'no-record'; row.definitive = true; return row; }
      if (visitCount(p) >= CFG.minVisits && !item.force) { row.ok = true; row.reason = 'already-has-visits'; row.definitive = true; return row; }
      var dobOut = normDob(item.dob) || S(item.dob).slice(0, 20);
      /* live fix 2026-07-10: open the chart FIRST (the visits driver reads the
         OPEN chart; between patients athena sits on the dashboard where the
         identity gate honestly refuses). findpatient route: schedule-free. */
      var op = await bridgeOpen(item.name, dobOut);
      if (op && op.__aborted) { row.reason = 'aborted-pull-started'; return row; }
      if (op && op.__timeout) { row.reason = 'open-timeout'; return row; }
      if (!op || (!op.ok && !op.opened)) { row.reason = 'open-failed:' + S((op && (op.findReason || op.error)) || '').slice(0, 60); return row; }
      await wait(2500); /* let the chart's first paint land before the rail click */
      var r = await bridgeVisits({
        patient: S(item.name).slice(0, 120), /* the relay's canonical field */
        name: S(item.name).slice(0, 120),    /* belt+braces for older relays */
        dob: dobOut,
        athenaId: S(item.athenaId).slice(0, 40),
        max: CFG.maxVisitsAsk
      });
      if (r && r.__localBusy) { row.reason = 'busy'; return row; }             /* another read in flight (console misuse guard) */
      if (r && r.__aborted) { row.reason = 'aborted-pull-started'; return row; } /* discarded; requeued by the pump */
      if (r && r.__timeout) { row.reason = 'timeout'; return row; }
      if (!r || r.ok !== true) {
        var why = S((r && (r.reason || r.error)) || 'ext-error').slice(0, 200);
        row.reason = why;
        /* the extension's honest refusals are DEFINITIVE for this session */
        if (why === 'wrong-chart' || why === 'unverified-dob' || why === 'no-rail') row.definitive = true;
        return row;
      }
      /* app-side veto gate (kept per spec): blocks contradictions, accepts nothing on its own */
      var veto = identityVeto(item.name, item.dob || p.dob || '', r);
      if (!veto.ok) { row.reason = 'identity-veto:' + veto.why; row.definitive = true; return row; } /* fail-closed: nothing saved */
      var visits = Array.isArray(r.visits) ? r.visits : [];
      if (!visits.length) { row.ok = true; row.reason = 'no-visits-on-chart'; row.definitive = true; return row; }
      var ing = ingestVisits(p, visits);
      row.added = ing.added; row.skipped = ing.skipped;
      STATE.visitsAdded += ing.added; STATE.visitsSkippedExisting += ing.skipped;
      if (ing.reason) { row.reason = ing.reason; row.definitive = false; return row; } /* partial: retryable, reported honestly */
      row.ok = true; row.definitive = true;
      if (CFG.autoSummarize && ing.added) {
        var M = VM();
        if (M && typeof M.ensureSummaries === 'function') { try { await M.ensureSummaries(p.id); } catch (e) {} }
      }
      return row;
    })();
  }

  function stop(reason) { STATE.stopped = true; STATE.stopReason = S(reason || 'user'); }

  /* ------------------ the queue pump: 1 patient at a time ------------------ */
  var TRANSIENT_EXT = { timeout: 1, 'no-ext': 1, 'ext-error': 1, 'no-visit-model': 1 }; /* wf_9 #6: no-ext/ext-error join the stop counter */
  function kick() {
    if (_pumping || !_alive || STATE.stopped || !STATE.queue.length) return;
    _pumping = true;
    (async function () {
      STATE.running = true;
      say('Visit backfill: ' + STATE.queue.length + ' patient' + (STATE.queue.length === 1 ? '' : 's') + ' queued (fewer than ' + CFG.minVisits + ' visits on file).');
      statusLine(STATE.queue.length + ' queued');
      var pong = await pingExt();
      if (!pong) {
        stop('no-ext');
        statusLine('MLS Assist is not answering - backfill paused (queue kept; .runOnce() to retry).');
        say('Visit backfill paused: MLS Assist is not answering. The queue is kept.');
      }
      while (_alive && !STATE.stopped && STATE.queue.length) {
        if (anyPullRunning()) { STATE.current = ''; statusLine('waiting - athenaOne is busy (' + STATE.queue.length + ' queued)'); await wait(5000); continue; }
        var item = STATE.queue.shift();
        STATE.current = item.name;
        statusLine('reading ' + item.name + ' (' + STATE.queue.length + ' left)');
        var row;
        try { row = await backfillOne(item); }
        catch (e) { row = { name: item.name, key: item.key, ok: false, added: 0, skipped: 0, reason: 'error:' + ((e && e.message) || e), definitive: false }; }
        if (row.reason === 'aborted-pull-started') {
          /* a pull grabbed athena mid-read: discard the read, put the patient back */
          item.abortRetries = (item.abortRetries || 0) + 1;
          if (item.abortRetries <= 3) { STATE.queue.unshift(item); statusLine('paused - a pull started; ' + item.name + ' will retry after it'); continue; }
          row.reason = 'aborted-repeatedly';
        }
        if (row.reason === 'busy') {
          /* honest extension refusal: athena tab busy - requeue at the back, max 2 */
          item.busyRetries = (item.busyRetries || 0) + 1;
          if (item.busyRetries <= 2) { STATE.queue.push(item); statusLine('athena busy - ' + item.name + ' requeued'); await wait(CFG.busyRetryWaitMs); continue; }
        }
        if (row.definitive) _doneKeys[item.key] = Date.now();   /* SAME key as the enqueue check (wf_9 #6) */
        STATE.rows.push(row); STATE.done++;
        if (row.ok) { STATE.ok++; STATE.consecFail = 0; }
        else {
          if (TRANSIENT_EXT[row.reason]) {
            STATE.transient++; STATE.consecFail++;
            if (STATE.consecFail >= CFG.maxConsecFail) stop('extension-not-answering');
          } else {
            STATE.failed++; STATE.consecFail = 0;
          }
          if (SESSION_LOST.test(row.reason)) stop('athena-session-lost');
        }
        statusLine(row.name + ' - ' + (row.ok ? ('+' + row.added + ' visit' + (row.added === 1 ? '' : 's') + (row.skipped ? ' (' + row.skipped + ' already on file)' : '')) : row.reason));
        try { if (window.__mlsVisitUI && window.__mlsVisitUI.render) window.__mlsVisitUI.render(true); } catch (e) {}
        try { if (typeof window.renderProfile === 'function') window.renderProfile(); } catch (e) {}
        await wait(CFG.paceMs);
      }
      STATE.running = false; STATE.current = ''; _pumping = false;
      var tail = STATE.stopped ? ('stopped (' + STATE.stopReason + ')') : 'finished';
      statusLine(tail + ' - ' + STATE.ok + ' ok, ' + STATE.failed + ' failed, ' + STATE.transient + ' retryable, ' + STATE.visitsAdded + ' visits added');
      say('Visit backfill ' + tail + ': ' + STATE.ok + ' ok, ' + STATE.failed + ' failed, ' + STATE.visitsAdded + ' visit' + (STATE.visitsAdded === 1 ? '' : 's') + ' added. Summaries stay click-driven (no AI spend).');
      if (_alive && STATE.queue.length && !STATE.stopped) kick(); /* a pull may have queued more mid-pump */
    })().then(null, function (e) {
      _pumping = false; STATE.running = false; STATE.current = '';
      try { console.warn('[MLS visits-backfill] pump error', e); } catch (x) {}
    });
  }

  /* ------------------------------- enqueue --------------------------------- */
  function enqueueOne(entry, opts) {
    opts = opts || {};
    var name = S(entry && entry.name != null ? entry.name : entry).trim();
    if (!name) return false;
    var p = resolveStorePatient(name);
    if (!p || !p.id) return false;                              /* addVisit needs a store row */
    var key = nrm(p.name);                                      /* ONE key: resolved store-row name (wf_9 #6) */
    if (!key) return false;
    if (!opts.force && _doneKeys[key]) return false;
    for (var i = 0; i < STATE.queue.length; i++) { if (STATE.queue[i].key === key) return false; }
    if (!opts.force && visitCount(p) >= CFG.minVisits) return false;
    STATE.queue.push({
      name: p.name || name,
      pid: p.id,
      key: key,
      /* schedule DOB first (same source the live pull trusts), store DOB fallback (wf_9 #6) */
      dob: schedDobFor(name) || schedDobFor(p.name) || S((entry && entry.dob) || p.dob || ''),
      /* row.athenaId is stamped by the parallel dedup module; mrn is the legacy slot */
      athenaId: S((entry && entry.athenaId) || p.athenaId || p.mrn || ''),
      force: !!opts.force,
      busyRetries: 0, abortRetries: 0
    });
    return true;
  }

  /* enqueue a finished pull run's thin patients. rows default to the live
   * engine's state.rows. Rows the pull ALREADY refused for identity are
   * never retried here (wf_9 #1). ok rows first: their charts proved openable. */
  function enqueueFromRun(rows, opts) {
    opts = opts || {};
    if (!rows) { var st = pullState(); rows = (st && st.rows) ? st.rows.slice() : []; }
    var okRows = [], badRows = [], added = 0, i;
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || !r.name) continue;
      if (/^identity-mismatch/i.test(S(r.reason))) continue;    /* the proven gate already rejected this chart */
      (r.ok ? okRows : badRows).push(r);
    }
    for (i = 0; i < okRows.length; i++) { if (enqueueOne({ name: okRows[i].name, athenaId: okRows[i].athenaId }, opts)) added++; }
    for (i = 0; i < badRows.length; i++) { if (enqueueOne({ name: badRows[i].name, athenaId: badRows[i].athenaId }, opts)) added++; }
    if (added) {
      STATE.stopped = false; STATE.stopReason = ''; STATE.consecFail = 0;  /* a fresh pull re-arms a stopped pump */
      say('Pull finished - queueing ' + added + ' patient' + (added === 1 ? '' : 's') + ' for an individual-visits backfill.');
      kick();
    }
    return added;
  }

  /* manual trigger: runOnce() re-queues from the last finished pull;
   * runOnce(['Bob Dunne', {name:'Jane Roe'}], {force:true}) queues named patients. */
  function runOnce(names, opts) {
    opts = opts || {};
    STATE.stopped = false; STATE.stopReason = ''; STATE.consecFail = 0;
    var added = 0;
    if (Array.isArray(names) && names.length) {
      for (var i = 0; i < names.length; i++) { if (enqueueOne(names[i], opts)) added++; }
      if (added) kick();
    } else {
      added = enqueueFromRun(null, opts);
    }
    if (!added && STATE.queue.length) kick(); /* resume a kept queue */
    return added;
  }

  /* --------------- completion watcher: falling edge of running -------------
   * Covers pullDay, pullMonth AND __mlsProvMonthPull.run / __mlsMonthPullOne
   * (all drive the same state object). Worker-paced loop - NEVER setInterval. */
  (async function watch() {
    var was = false;
    while (_alive) {
      await wait(CFG.pollMs);
      if (!_alive) break;
      if (!STATE.watching) { was = false; continue; }
      var st = pullState();
      if (!st) { was = false; continue; }
      var now = !!st.running;
      if (was && !now) {
        STATE.lastEdgeAt = Date.now();
        try { enqueueFromRun((st.rows || []).slice()); } catch (e) {}
      }
      was = now;
    }
  })();

  /* -------------------------------- revert --------------------------------- */
  function revert() {
    _alive = false;
    STATE.watching = false; STATE.stopped = true; STATE.stopReason = 'reverted';
    STATE.queue.length = 0;
    try { window.removeEventListener('message', onAnyMessage, true); } catch (e) {}
    try { var el = document.getElementById('mlsVbfStatus'); if (el) el.remove(); } catch (e) {}
    try { if (_wkUrl) URL.revokeObjectURL(_wkUrl); } catch (e) {}
    _wkUrl = null; /* wf_5: stragglers degrade to setTimeout instead of hanging on a revoked blob URL */
    try { delete window.__mlsVisitsBackfill; } catch (e) { window.__mlsVisitsBackfill = undefined; }
    try { delete window.__mlsVisitsBackfill_revert; } catch (e) {}
  }

  window.__mlsVisitsBackfill = {
    version: STATE.version,
    state: STATE,
    cfg: CFG,
    enqueueFromRun: enqueueFromRun,
    runOnce: runOnce,
    stop: function () { stop('user'); statusLine('stopped by user (' + STATE.queue.length + ' left in queue)'); },
    revert: revert,
    /* console/test helpers */
    resume: function () { if (STATE.queue.length) { STATE.stopped = false; STATE.stopReason = ''; STATE.consecFail = 0; kick(); } return STATE.queue.length; },
    _identityVeto: identityVeto,
    _ingestVisits: ingestVisits,
    _bridgeVisits: bridgeVisits,
    _anyPullRunning: anyPullRunning
  };
  window.__mlsVisitsBackfill_revert = revert; /* deploy-convention alias */
})();


/* =========================================================================
 * MLS Scribe - PULL A SPECIFIC DAY  (__mlsPullAnyDay) v1.0.0  2026-07-10 (b121)
 *
 * Staff-prep gains ONE row under the month-pull section: pick a DATE, press
 * "Pull this day (schedule + charts)" and MLS does the whole flow:
 *   LEG 1 - import that day's athenaOne schedule for the Doctor picked above
 *           (exact replication of the proven month engine's per-day import:
 *           gotoDate -> read -> verify the read came FROM ATHENA -> verify the
 *           page date -> save rows. The month engine's pullDay/saveRow are
 *           unexported closures, but every primitive is a window global + two
 *           bridge messages, so this is the SAME keys, the SAME two badname
 *           guards - /^open$/i and the truncated "First L." form, NOTHING
 *           more - and the SAME POST body. Dedup'd, never doubles.)
 *   LEG 2 - chart-history pull for that day's roster via
 *           __mlsProvMonthPull.run(provider, 'YYYY-MM-DD') - rosterFor()
 *           prefix-matches day_local, so a full day IS a valid "month prefix".
 *           That engine carries the LIVE-PROVEN goHome->gotoDate shim for
 *           non-today days, skips already-pulled patients, and drives
 *           __mlsDayHistoryPull.state so __mlsPullProgress shows progress
 *           automatically. Runs once per provider SPELLING that matches the
 *           signed-in doctor (rows imported under Doctor='all' carry athena's
 *           own spelling, e.g. "SCHAEFFER, MATTHEW" - a union roster).
 *
 * HONEST GATES: not signed in; extension missing; the readable tab is not
 * athenaOne (host check on the read result URL, or resp.emr==='athena' -
 * same verification as the live engine's pullPrecheck; without it a junk
 * frame carrying today's date header would pass, the historical "junk-frame
 * phantoms" failure); athena on the wrong date (save NOTHING - wrong-day rows
 * are how rosters get mis-keyed); zero rows on athena for that day/provider
 * (no chart leg; staff-booked MLS rows are reported as legitimate, other
 * leftover rows are flagged as possibly mis-keyed ghosts); charts for a
 * doctor other than the signed-in one are refused with the reason (athenaOne
 * only renders your own schedule - verified live 2026-07-10).
 *
 * KNOWN INHERITED LIMIT (flagged, not silently inherited): the live
 * __mlsProvMonthPull.isPlaceholder (bundle b120 line 59) has a credential
 * regex with no LEFT word boundary, so patient names ENDING in md/do/ma/rn/
 * pt/np... (Sharma, Prado, Bjorn, Egypt, ...) are silently dropped from its
 * chart rosters. run() calls the CLOSURE rosterFor (line 174), not the
 * exported api.rosterFor, so this module cannot patch it from outside. It
 * therefore PREDICTS the exclusions for the chosen day, names the affected
 * patients in the status line, and console.warns once. Fix belongs in the
 * month-pull/dates-fix lane (b122).
 *
 * OTHER INHERITED BEHAVIOR (engine-exact, disclosed): the D:'name|day' and
 * N:'first|last|day' dedup keys treat two DIFFERENT patients with the same
 * (or same-first+last) name on one day as duplicates - the second is not
 * saved; and the DOB backfill matches patients by exact name, so a same-named
 * existing patient can receive the schedule row's DOB. Both are verbatim
 * live-engine semantics (b120 lines 21882-21890) kept so dedup against
 * month-pull-saved rows stays exact.
 *
 * STAFF BOOKINGS: _calAppts / /api/appointments rows with source:'staff'
 * (patient_external_id 'p...', often dob:'') never came from athena. They are
 * tolerated everywhere: dedup keys treat them as already-saved (never doubled,
 * never rewritten, never deleted), the ghost-row warning reports them as
 * legitimate instead of mis-keyed, and the chart leg simply attempts them
 * like any rostered patient (an unregistered one fails honestly).
 *
 * FUTURE DATES are allowed (tomorrow-prep is a real staff use case). The
 * month engine refuses future MONTHS; this module instead relies on the
 * date-verify + athena-host gates: if forward navigation fails, the run
 * reports it honestly and saves nothing.
 *
 * ALTERNATIVE IMPORT SURFACE (documented for a future leg, not used here):
 * athenaOne's all-providers day grid is URL-parameterized and enumerable -
 * /22724/6/schedule/viewdepartment.esp?DATE=MM%2FDD%2FYYYY&DEPARTMENTID=624
 * &SHOWCANCELLED=n (+CSRFPROTECT harvested from a live frame URL). One column
 * per provider, cells like "EP10 - PEARSON, ROBERT R (77yo M) #7697536" where
 * #number is the stable athena patient id; NO DOB on cells. A future leg
 * could import every provider's day in one read from it; the current leg
 * replicates the proven calendar-read flow instead.
 *
 * TIMERS: no setInterval/setTimeout ANYWHERE - mounting is MutationObserver +
 * capture-phase click + visibilitychange (page timers throttle to ~0 while
 * athenaOne is foregrounded), and all in-pull waits are Worker-backed. If the
 * Worker blob cannot be created the module console.warns ONCE and FAILS FAST
 * (refuses to start / stops the run) instead of silently degrading to
 * throttled setTimeout and stalling mid-pull.
 *
 * DATES-FIX INTEROP: feature-detects window.__mlsDayKeyFix (parallel lane:
 * provider canonicalization + day keying). When its helpers are present they
 * are preferred; everything below is self-sufficient without it.
 *
 * READ-ONLY in athenaOne. Idempotent (dedup keys + hasPulled skip + running
 * guards + mount marker). Revert: window.__mlsPullAnyDay.revert()
 * ------------------------------------------------------------------------- */
(function () {
  'use strict';
  try { if (window.__mlsPullAnyDay) return; } catch (e) { return; }

  var api = {
    version: '1.0.0',
    build: '2026-07-10-b121',
    state: { running: false, phase: 'idle', lastRun: null },
    running: false,   /* mirror of state.running (module convention) */
    lastRun: null,    /* mirror of state.lastRun */
    mounts: 0
  };

  /* ------------------------------ utils ---------------------------------- */
  function isFn(f) { return typeof f === 'function'; }
  function nrm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
  function pad2(n) { return ('0' + n).slice(-2); }
  function todayYMD() { var d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function prettyDay(k) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(k || '')); if (!m) return String(k || ''); return MONTHS[+m[2] - 1].slice(0, 3) + ' ' + (+m[3]) + ', ' + m[1]; }
  function say(m) { try { if (isFn(window.toast)) window.toast(m, ''); } catch (e) {} try { console.log('[MLS pull-any-day]', m); } catch (e) {} }

  /* ---------------- Worker-backed waits (honest fail-fast) -----------------
   * Page timers are throttled to ~0 while athenaOne is foregrounded, so every
   * in-pull wait runs on a Worker. If Worker creation fails (CSP change etc.)
   * we warn ONCE and REJECT - runFlow refuses to start (or its catch reports
   * the mid-run stop honestly) instead of silently stalling on setTimeout. */
  var _wkWarned = false;
  function warnWorkerOnce(reason) {
    if (_wkWarned) return; _wkWarned = true;
    try {
      console.warn('[MLS pull-any-day] Worker timers unavailable (' + (reason || 'Blob/Worker creation failed') +
        '). Page timers are throttled to ~0 while athenaOne is foregrounded, so a pull would stall silently mid-flight - failing fast instead of degrading to setTimeout.');
    } catch (e) {}
  }
  var _wkUrl = null;
  try {
    _wkUrl = URL.createObjectURL(new Blob(['onmessage=function(e){setTimeout(function(){postMessage(1)},e.data)}'], { type: 'application/javascript' }));
  } catch (e) { _wkUrl = null; warnWorkerOnce(String((e && e.message) || e)); }
  function wait(ms) {
    return new Promise(function (res, rej) {
      if (!_wkUrl) { warnWorkerOnce(); rej(new Error('worker-timers-unavailable')); return; }
      var w;
      try {
        w = new Worker(_wkUrl);
        w.onmessage = function () { try { w.terminate(); } catch (e) {} res(); };
        w.onerror = function () { try { w.terminate(); } catch (e) {} warnWorkerOnce('Worker runtime error'); rej(new Error('worker-timers-unavailable')); };
        w.postMessage(ms);
      } catch (e) {
        try { if (w) w.terminate(); } catch (e2) {}
        warnWorkerOnce(String((e && e.message) || e));
        rej(new Error('worker-timers-unavailable'));
      }
    });
  }

  /* -------------------- bridge (engine-exact message shape) ----------------
   * Progress passthrough exists ONLY for mlsAppGotoDate (mlsAppGotoDateProgress,
   * relayed by ext v1.49+). No extension version ever emits a
   * mlsAppScheduleProgress, so readSchedule takes no progress callback -
   * do NOT re-add one expecting streamed read progress. */
  function bridge(reqType, payload, replyType, timeoutMs, onProgress) {
    return new Promise(function (res) {
      var done = false;
      function fin(v) { if (done) return; done = true; try { window.removeEventListener('message', on, false); } catch (e) {} res(v); }
      function on(ev) {
        var d = ev && ev.data; if (!d || d.source !== 'mls-ext') return;
        if (onProgress && d.type === replyType.replace(/Result$/, 'Progress') && typeof d.message === 'string') { try { onProgress(d.message); } catch (e) {} return; }
        if (d.type !== replyType) return;
        fin(d.resp !== undefined ? d.resp : d);
      }
      try { window.addEventListener('message', on, false); } catch (e) {}
      var msg = { source: 'mls-app', type: reqType };
      if (payload) { for (var k in payload) { if (payload.hasOwnProperty(k)) msg[k] = payload[k]; } }
      try { window.postMessage(msg, '*'); } catch (e) {}
      /* a rejected wait (Worker failure) resolves the bridge as a timeout NOW
         instead of hanging forever - the caller reports it honestly */
      wait(timeoutMs || 15000).then(function () { fin(null); }, function () { fin(null); });
    });
  }
  function extPing() { return bridge('mlsPing', null, 'mlsPong', 3500).then(function (r) { return !!r; }); }
  function readSchedule() { return bridge('mlsAppPullSchedule', null, 'mlsAppScheduleResult', 45000); }
  function gotoDate(dateKey, probe, onProgress) { return bridge('mlsAppGotoDate', { date: dateKey, probe: !!probe }, 'mlsAppGotoDateResult', probe ? 6000 : 60000, onProgress); }
  function respSchedDate(r) {
    try {
      var sd = String((r && r.schedDate) || '').slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(sd)) return sd;
      var txt = String((r && r.text) || '');
      var m = /(sunday|monday|tuesday|wednesday|thursday|friday|saturday)[a-z]*[,.]?\s{0,3}([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})/i.exec(txt);
      if (m) {
        /* prefix match accepts "Jul" AND "July" - safe direction: this value is
           only ever compared for EQUALITY with the requested day (a parse miss
           returns '' and the caller refuses to save) */
        var want = String(m[2]).toLowerCase(), mo = -1;
        for (var i = 0; i < 12; i++) { if (MONTHS[i].toLowerCase().indexOf(want) === 0) { mo = i; break; } }
        if (mo >= 0) return m[4] + '-' + pad2(mo + 1) + '-' + pad2(+m[3]);
      }
    } catch (e) {}
    return '';
  }
  /* athena-tab verification - same check as the live engine's pullPrecheck
     (b120 lines 21914-21916). A read is only trusted when the readable tab's
     host is athena (or the extension says emr:'athena'). */
  function athenaVerdict(r) {
    var host = '';
    try { host = (r && r.url) ? new URL(r.url).host : ''; } catch (e) { host = ''; }
    var isAthena = !!(host && /athenahealth|athenanet|athenaone/i.test(host));
    if (!isAthena) { try { isAthena = String((r && r.emr) || '').toLowerCase() === 'athena'; } catch (e) {} }
    return { host: host, isAthena: isAthena };
  }

  /* --------------- backend/session plumbing (engine-exact guards) ---------- */
  function bkBase() { try { if (isFn(window.bkBase)) { var b = window.bkBase(); if (b) return b; } } catch (e) {} return 'https://scrivara-backend.onrender.com'; }
  function bkToken() { try { if (isFn(window.bkToken)) return window.bkToken() || ''; } catch (e) {} return ''; }
  function signedIn() { try { return !!(isFn(window.backendMode) && window.backendMode() && bkToken()); } catch (e) { return false; } }
  function apptKey(name, date, time) {
    try { if (isFn(window._apptKey)) return window._apptKey(name, date, time); } catch (e) {}
    return String(name || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + String(date || '');
  }

  /* ------------- dates-fix interop (feature-detect, never require) --------- */
  function KF() { try { var K = window.__mlsDayKeyFix; return (K && typeof K === 'object') ? K : null; } catch (e) { return null; } }
  function dayOf(row) {
    var K = KF();
    if (K) {
      try { if (isFn(K.rowDayKey)) { var v = K.rowDayKey(row); if (v) return String(v).slice(0, 10); } } catch (e) {}
      try { if (isFn(K.dayKeyOf)) { var v2 = K.dayKeyOf(row); if (v2) return String(v2).slice(0, 10); } } catch (e) {}
    }
    return String((row && row.day_local) || '').slice(0, 10);
  }
  function provTokens(p) {
    return nrm(p).split(' ').filter(function (t) { return t.length > 2 && !/^(md|do|dpm|pa|pac|np|crnp|dr|jr|sr|ii|iii)$/.test(t); });
  }
  function sameProv(a, b) {
    var K = KF();
    if (K) {
      try { if (isFn(K.sameProvider)) return !!K.sameProvider(a, b); } catch (e) {}
      try { if (isFn(K.provMatch)) return !!K.provMatch(a, b); } catch (e) {}
      try { if (isFn(K.canonProvider)) return nrm(K.canonProvider(a)) === nrm(K.canonProvider(b)); } catch (e) {}
    }
    if (nrm(a) === nrm(b)) return true;
    /* token overlap: "SCHAEFFER, MATTHEW" === "Matthew Schaeffer, MD" */
    var ta = provTokens(a), tb = provTokens(b);
    if (!ta.length || !tb.length) return false;
    var small = ta.length <= tb.length ? ta : tb;
    var big = (small === ta) ? tb : ta;
    var hit = 0;
    for (var i = 0; i < small.length; i++) { if (big.indexOf(small[i]) >= 0) hit++; }
    return hit >= Math.min(2, small.length);
  }
  /* leg-1 row filter: K helpers first, else the engine's exact first-token
     substring match (b120 line 21965) - never STRICTER than the engine */
  function provRowMatch(rowProv, filter) {
    var K = KF();
    if (K) {
      try { if (isFn(K.provMatch)) return !!K.provMatch(rowProv, filter); } catch (e) {}
      try { if (isFn(K.sameProvider) && K.sameProvider(rowProv, filter)) return true; } catch (e) {}
    }
    var want = String(filter || '').trim().toLowerCase().split(/[ ,]/)[0];
    return String(rowProv || '').toLowerCase().indexOf(want) >= 0;
  }

  /* -------------------------- calendar roster store ------------------------ */
  function calRows() {
    /* base-app per-visit state is global-LEXICAL (let/const), not on window -
       read the bare identifier, typeof-guarded (same pattern as the live
       __mlsProvMonthPull.calRows). Rows may be staff bookings (source:'staff',
       dob:'') - every consumer below tolerates them. */
    try { if (typeof _calAppts !== 'undefined' && _calAppts) { return (typeof _calAppts === 'function') ? (_calAppts() || []) : _calAppts; } } catch (e) {}
    try { return (typeof window._calAppts === 'function') ? (window._calAppts() || []) : (window._calAppts || []); } catch (e) { return []; }
  }
  function providerSpellingsFor(day) {
    var rows = calRows(), seen = {}, out = [];
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i];
      if (!a || !a.provider) continue;
      if (dayOf(a) !== day) continue;
      var p = String(a.provider), k = nrm(p);
      if (!k || seen[k]) continue;
      seen[k] = 1; out.push(p);
    }
    return out;
  }
  function ghostAndStaffFor(day, prov) {
    /* zero-athena-rows honesty probe. Deliberately does NOT use
       __mlsProvMonthPull.rosterFor: that would need an exact provider spelling
       AND runs the broken placeholder filter - both can silently hide the very
       rows we are warning about (verdict wf_7 #4/#5). */
    var rows = calRows(), ghost = 0, staff = 0;
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i]; if (!a) continue;
      if (dayOf(a) !== day) continue;
      if (prov !== 'all') { var p = String(a.provider || ''); if (p && !sameProv(p, prov)) continue; }
      if (String(a.source || '') === 'staff') staff++; else ghost++;
    }
    return { ghost: ghost, staff: staff };
  }

  /* ------------- inherited chart-engine name-filter bug (FLAGGED) ----------
   * Verbatim copy of the LIVE broken check (__mlsProvMonthPull, b120 line 59)
   * used ONLY to PREDICT which real patients its rosterFor will drop - it is
   * never used to filter anything in this module. */
  var PLACEHOLDER = /^(frozen|open|available|ht|wt|bp|held|blocked|lunch|break|no exam|tbd|walk\s*in|placeholder)$/i;
  var ENGINE_BROKEN_CRED = /,?\s*(md|do|dpm|pa-?c|np|crnp|staff|rn|ma|tech|phys|pt)\b/i; /* no LEFT boundary - the bug */
  var CORRECT_CRED = /(?:^|[\s,])(md|do|dpm|pa-?c|np|crnp|dr)\.?(?=$|[\s,])/i;            /* whole-token version */
  function engineWouldDrop(name) { var n = nrm(name); return !n || PLACEHOLDER.test(n) || ENGINE_BROKEN_CRED.test(String(name || '')); }
  function genuinelyPlaceholder(name) { var n = nrm(name); return !n || PLACEHOLDER.test(n) || CORRECT_CRED.test(String(name || '')); }
  function excludedByEngineBug(day, provList) {
    var rows = calRows(), out = [], seen = {};
    for (var i = 0; i < rows.length; i++) {
      var a = rows[i];
      if (!a || !a.name) continue;
      if (dayOf(a) !== day) continue;
      if (provList && provList.length) {
        var okp = false, p = String(a.provider || '');
        for (var j = 0; j < provList.length; j++) { if (sameProv(p, provList[j])) { okp = true; break; } }
        if (!okp) continue;
      }
      var nm = String(a.name);
      if (engineWouldDrop(nm) && !genuinelyPlaceholder(nm)) {
        var k = nrm(nm);
        if (!seen[k]) { seen[k] = 1; out.push(nm); }
      }
    }
    return out;
  }
  var _bugWarned = false;
  function warnEngineBugOnce(names) {
    if (_bugWarned) return; _bugWarned = true;
    try {
      console.warn('[MLS pull-any-day] KNOWN LIVE BUG (inherited from __mlsProvMonthPull, NOT fixable from this module): ' +
        'its isPlaceholder credential regex (b120 line 59) has no left word boundary, so patient names ending in ' +
        'md/do/dpm/np/rn/ma/pt... are dropped from chart rosters. run() uses the closure rosterFor (line 174), so the fix ' +
        'must land inside that module (month-pull/dates-fix lane). Affected on this day: ' + names.join(', '));
    } catch (e) {}
  }

  /* --------------------------- schedule read rows -------------------------- */
  function structuredRows(r) {
    try {
      var a = (r && r.appts) || [], out = [];
      for (var i = 0; i < a.length; i++) {
        var nm = String((a[i] && a[i].name) || '').trim(); if (!nm) continue;
        out.push({ name: nm, dob: String(a[i].dob || ''), time: String(a[i].time || ''), reason: String(a[i].reason || ''), provider: String(a[i].provider || '') });
      }
      return out;
    } catch (e) { return []; }
  }
  function parsedRows(r) {
    try {
      var parsed = isFn(window._parseScheduleText) ? window._parseScheduleText(String((r && r.text) || '')) : [];
      return (Array.isArray(parsed) ? parsed : []).map(function (a) { return { name: a.name, dob: a.dob || '', time: a.time || '', reason: a.reason || '', provider: a.provider || '' }; });
    } catch (e) { return []; }
  }

  /* -------------------- dedup keys + save (engine-exact) ------------------- */
  function loadExistingKeys() {
    return fetch(bkBase() + '/api/appointments', { headers: { Authorization: 'Bearer ' + bkToken() } })
      .then(function (r) { return r.ok ? r.json() : { appointments: [] }; })
      .then(null, function () { return { appointments: [] }; })
      .then(function (d) {
        var map = {};
        (d.appointments || []).forEach(function (x) {
          /* staff bookings land here too (source:'staff', dob:'') - keying them
             means an athena row for the same patient+day dedups as 'already on
             the calendar' instead of doubling or rewriting the staff row */
          var lt = ''; try { if (x.start_at) lt = new Date(x.start_at).toTimeString().slice(0, 5); } catch (e) {}
          var ld = x.appt_date || '';
          if (!ld) { try { var dd = new Date(x.start_at); ld = dd.getFullYear() + '-' + pad2(dd.getMonth() + 1) + '-' + pad2(dd.getDate()); } catch (e) {} }
          map[apptKey(x.name, ld, lt)] = 1;
          map['D:' + String(x.name || '').trim().toLowerCase().replace(/\s+/g, ' ') + '|' + ld] = 1;
          var nt = String(x.name || '').trim().toLowerCase().split(/\s+/);
          if (nt.length > 1) map['N:' + nt[0] + '|' + nt[nt.length - 1].replace(/\./g, '') + '|' + ld] = 1;
        });
        return map;
      });
  }
  function saveRow(dayKey, row, filter, existing) {
    var name = String(row.name || '').trim(); if (!name) return Promise.resolve('skip');
    /* EXACT live-engine badname guards (b120 lines 21880-21881) and NOTHING
       more. An earlier draft also ran a credential regex here; its missing
       left boundary silently dropped real patients (Sharma/Prado/Bjorn/...) -
       killed per verdicts wf_7 + wf_10. "SAME guards" is now literally true. */
    if (/^open$/i.test(name)) return Promise.resolve('badname');
    if (/^\S+ [A-Z]\.$/.test(name)) return Promise.resolve('badname');
    var key = apptKey(name, dayKey, row.time);
    var dayOnlyKey = 'D:' + name.toLowerCase().replace(/\s+/g, ' ') + '|' + dayKey;
    var nt = name.toLowerCase().split(/\s+/);
    var nKey = nt.length > 1 ? ('N:' + nt[0] + '|' + nt[nt.length - 1].replace(/\./g, '') + '|' + dayKey) : '';
    if (existing[key] || existing[dayOnlyKey] || (nKey && existing[nKey])) return Promise.resolve('dup');
    existing[key] = 1; existing[dayOnlyKey] = 1; if (nKey) existing[nKey] = 1;
    var pts = []; try { pts = (isFn(window.getPatients) ? window.getPatients() : []) || []; } catch (e) {}
    var ext = '', found = null;
    for (var i = 0; i < pts.length; i++) { if (String(pts[i].name || '').trim().toLowerCase() === name.toLowerCase()) { found = pts[i]; break; } }
    if (found) {
      ext = found.id;
      /* engine-exact DOB backfill: mutate the same object and re-upsert (keeps
         unknown fields). Disclosed limit: exact-name match can hit a same-named
         different patient. */
      if (row.dob && !found.dob && isFn(window.upsertPatient)) { try { found.dob = String(row.dob); window.upsertPatient(found); } catch (e) {} }
    } else if (isFn(window.upsertPatient)) {
      var np = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name, dob: String(row.dob || ''), reason: String(row.reason || ''), source: 'athena-schedule-daypick', created: Date.now() };
      try { window.upsertPatient(np); ext = np.id; } catch (e) {}
    }
    var startIso = null;
    try { if (/^\d\d?:\d\d$/.test(String(row.time || '')) && isFn(window._acctWallToUtcIso)) startIso = window._acctWallToUtcIso(dayKey, ('0' + row.time).slice(-5)); } catch (e) {}
    var provider = (filter && filter !== 'all') ? filter : String(row.provider || '').trim();
    var body = { name: name, dob: String(row.dob || ''), reason: String(row.reason || ''), patient_external_id: ext || null, appt_date: dayKey, start_at: startIso, provider: provider || undefined };
    return fetch(bkBase() + '/api/appointments', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + bkToken() }, body: JSON.stringify(body) })
      .then(function (r) { return r.ok ? 'created' : 'failed'; })
      .then(null, function () { return 'failed'; });
  }
  function selfProvider() {
    var K = KF();
    if (K) { try { if (isFn(K.selfProvider)) { var v = K.selfProvider(); if (v && /\w/.test(String(v))) return String(v).trim(); } } catch (e) {} }
    try {
      var el = document.getElementById('provSel') || document.querySelector('#mlsProvChip, [data-mls-provider]');
      var t = el ? (el.value || el.textContent || '') : '';
      if (t && /\w/.test(t)) return String(t).trim();
    } catch (e) {}
    /* same last-resort fallback as the live __mlsProvMonthPull (b120 line 250) */
    return 'Matthew Schaeffer, MD';
  }
  function refreshCalendar() {
    try { if (isFn(window.loadCalendar)) window.loadCalendar(); } catch (e) {}
    try { if (isFn(window._calLoadNextUp)) window._calLoadNextUp(); } catch (e) {}
    try { if (window.__mlsWhosNext && isFn(window.__mlsWhosNext.render)) window.__mlsWhosNext.render(); } catch (e) {}
  }

  /* ------------------------------ status line ----------------------------- */
  function note(html) { api._noteHtml = html; try { var n = document.getElementById('mlsPadNote'); if (n) n.innerHTML = html; } catch (e) {} }
  function setBusy(b) { try { var btn = document.getElementById('mlsPadBtn'); if (btn) btn.disabled = !!b; } catch (e) {} }

  /* --------------------- LEG 1: import the day's schedule ------------------ */
  function importDay(day, prov) {
    return (async function () {
      var pd = prettyDay(day);
      note('Checking the MLS Assist bridge&hellip;');
      var ping = await extPing();
      if (!ping) return { error: 'MLS Assist extension not detected - enable it in Chrome, keep an athenaOne tab open on Calendar › View Calendar, then click again.' };
      var probe = await gotoDate(day, true);
      var extNav = !!(probe && (probe.supported || probe.ok));
      var navConfirmed = '';
      if (extNav) {
        note('Moving athenaOne to ' + esc(pd) + '&hellip;');
        var nav = await gotoDate(day, false, function (m) { note(esc(m)); });
        if (!nav || nav.ok !== true) return { error: (nav && nav.error) || ('Could not navigate athenaOne to ' + pd + '. Nothing was saved.') };
        navConfirmed = (nav.schedDate && /^\d{4}-\d{2}-\d{2}$/.test(nav.schedDate)) ? nav.schedDate : day;
        await wait(2200); /* weekstrip settle */
      } else {
        note('This MLS Assist build has no hands-free date nav - put athenaOne on <b>' + esc(pd) + '</b> (Calendar › View Calendar); it is detected automatically.');
        var tries = 0, ok0 = false;
        while (tries++ < 30) {
          var pr = await readSchedule();
          var av0 = athenaVerdict(pr);
          var sd0 = respSchedDate(pr);
          if (pr && pr.ok === true && av0.isAthena && sd0 === day) { navConfirmed = day; ok0 = true; break; }
          if (pr && pr.ok === true && !av0.isAthena) {
            /* junk-frame guard: a non-athena page carrying the right date header
               must NEVER pass (the date input defaults to today, which any junk
               frame's header can match) */
            note('The readable tab is ' + esc(av0.host || 'not verifiably athenaOne') + ' - open athenaOne on Calendar › View Calendar showing ' + esc(pd) + ' (' + tries + '/30). Nothing is ever saved from a non-athena page.');
          } else {
            note('Waiting for athenaOne to show ' + esc(pd) + ' (' + tries + '/30)' + (sd0 && sd0 !== day ? ' - it is on ' + esc(prettyDay(sd0)) + ' right now.' : '.'));
          }
          await wait(4000);
        }
        if (!ok0) return { error: 'athenaOne never showed ' + pd + ' - move it to that day and click the button again. Nothing was saved.' };
      }
      note('Reading the ' + esc(pd) + ' schedule&hellip;');
      var r = await readSchedule();
      if (!r || r.ok !== true) return { error: (r && r.error) || 'The schedule read did not answer. Nothing was saved.' };
      var av = athenaVerdict(r);
      if (!av.isAthena) return { error: 'The readable tab is ' + (av.host ? av.host : 'not verifiably athenaOne') + ' - NOTHING was saved (rows from a non-athena page would be junk-frame phantoms).' };
      var sd = respSchedDate(r);
      if (sd && sd !== day) return { error: 'athenaOne showed ' + prettyDay(sd) + ' instead of ' + pd + ' - nothing was saved (saving wrong-day rows is how rosters get mis-keyed).' };
      if (!sd && navConfirmed !== day) return { error: 'Could not confirm the page date - nothing was saved.' };
      var rows = structuredRows(r); if (!rows.length) rows = parsedRows(r);
      if (prov !== 'all' && rows.length) {
        rows = rows.filter(function (x) { return provRowMatch(x.provider, prov); });
      }
      if (!rows.length) return { shown: 0, saved: 0, dup: 0, failed: 0, badname: 0, skippedEmpty: 0 };
      note('Saving ' + rows.length + ' appointment' + (rows.length === 1 ? '' : 's') + ' to your MLS calendar&hellip;');
      var existing = await loadExistingKeys();
      var saved = 0, dup = 0, failed = 0, badname = 0, skippedEmpty = 0;
      for (var i = 0; i < rows.length; i++) {
        note('Saving ' + (i + 1) + '/' + rows.length + ': ' + esc(rows[i].name || '') + '&hellip;');
        var res = await saveRow(day, rows[i], prov, existing);
        if (res === 'created') saved++;
        else if (res === 'dup') dup++;
        else if (res === 'failed') failed++;
        else if (res === 'badname') badname++;
        else if (res === 'skip') skippedEmpty++;
      }
      return { shown: rows.length, saved: saved, dup: dup, failed: failed, badname: badname, skippedEmpty: skippedEmpty };
    })();
  }

  /* ----------------- LEG 2: chart pull for that day's roster --------------- */
  function candidateProvidersFor(day, wantProv) {
    /* union roster: the exact wanted spelling PLUS every same-doctor spelling
       already on the calendar for that day (rows imported under Doctor='all'
       carry athena's own spelling, e.g. "SCHAEFFER, MATTHEW"). Each candidate
       gets its own M.run pass - hasPulled makes overlaps no-ops. */
    var M = window.__mlsProvMonthPull;
    var cand = [], seen = {};
    function push(p) {
      var k = nrm(p);
      if (!k || seen[k]) return;
      seen[k] = 1;
      var ro = [];
      try { ro = (M && isFn(M.rosterFor)) ? (M.rosterFor(p, day) || []) : []; } catch (e) { ro = []; }
      if (ro.length) cand.push({ provider: p, count: ro.length });
    }
    push(wantProv);
    var spellings = providerSpellingsFor(day);
    for (var i = 0; i < spellings.length; i++) { if (sameProv(spellings[i], wantProv)) push(spellings[i]); }
    return cand.slice(0, 3);
  }
  function chartLeg(day, wantProv) {
    return (async function () {
      var M = window.__mlsProvMonthPull, D = window.__mlsDayHistoryPull;
      if (!M || !isFn(M.run) || !isFn(M.rosterFor) || !D) {
        return { skipped: 'The chart-pull engine is not loaded on this build - the schedule IS imported; reload MLS and click again for the charts.', usedProvs: [] };
      }
      var pool = [];
      for (var t = 0; t < 20; t++) {
        pool = candidateProvidersFor(day, wantProv);
        if (pool.length) break;
        if (t % 5 === 0) refreshCalendar(); /* freshly POSTed rows land async */
        await wait(1500);
      }
      if (!pool.length) {
        return { skipped: 'No imported schedule rows for ' + esc(wantProv) + ' on ' + esc(prettyDay(day)) + ' showed up in the calendar yet - click the button again in a moment (already-saved rows are never doubled).', usedProvs: [] };
      }
      var agg = { total: 0, ok: 0, failed: 0, alreadyPulled: 0 }, statuses = [], usedProvs = [], ran = 0;
      for (var i = 0; i < pool.length; i++) {
        var pv = pool[i].provider;
        note('Pulling chart histories - ' + esc(pv) + ' - ' + pool[i].count + ' patient' + (pool[i].count === 1 ? '' : 's') + ' on the ' + esc(prettyDay(day)) + ' schedule (about 45s each; the progress screen shows each one; READ-ONLY in athenaOne).');
        var res;
        try { res = await M.run(pv, day); } catch (e) { res = 'error:' + ((e && e.message) || e); } /* full YYYY-MM-DD works: rosterFor prefix-matches day_local */
        usedProvs.push(pv);
        if (res && typeof res === 'object' && res.total != null) {
          ran++;
          agg.total += (res.total || 0); agg.ok += (res.ok || 0); agg.failed += (res.failed || 0); agg.alreadyPulled += (res.skippedAlreadyPulled || 0);
        } else {
          statuses.push(String(res));
        }
        if (i < pool.length - 1) await wait(1200);
      }
      return { agg: ran ? agg : null, statuses: statuses, usedProvs: usedProvs };
    })();
  }

  /* ------------------------------ whole flow ------------------------------- */
  function runFlow(day, prov) {
    return (async function () {
      if (api.state.running) { say('This day pull is already running.'); return 'already-running'; }
      try {
        var M0 = window.__mlsProvMonthPull, D0 = window.__mlsDayHistoryPull;
        if ((M0 && M0.running) || (D0 && D0.state && D0.state.running)) { note('Another pull is already running - let it finish (watch the progress screen).'); return 'busy'; }
      } catch (e) {}
      day = String(day || '').trim(); prov = String(prov || 'all');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { note('Pick a date first.'); return 'no-date'; }
      if (!signedIn()) { note('Sign in to MLS first - the pull saves to your MLS account.'); return 'not-signed-in'; }
      if (!_wkUrl) {
        warnWorkerOnce();
        note('⚠️ Cannot start: Worker timers are unavailable in this browser session, and page timers freeze while athenaOne is foregrounded - the pull would stall silently. Reload MLS and try again.');
        return 'no-worker-timers';
      }
      api.state.running = true; api.running = true; api.state.phase = 'checking'; setBusy(true);
      var pd = prettyDay(day);
      var out = { day: day, provider: prov, startedAt: Date.now() };
      try {
        api.state.phase = 'importing';
        var imp = await importDay(day, prov);
        out.imported = imp;
        if (imp.error) { api.state.phase = 'error'; note('⚠️ ' + esc(imp.error)); return out; }
        refreshCalendar();
        var head = esc(pd) + ': athenaOne showed ' + imp.shown + ' row' + (imp.shown === 1 ? '' : 's') + (prov !== 'all' ? ' for ' + esc(prov) : '') +
          ' - saved ' + imp.saved + ' new, ' + imp.dup + ' already on the calendar' +
          (imp.badname ? ', skipped ' + imp.badname + ' placeholder/truncated name' + (imp.badname === 1 ? '' : 's') : '') +
          (imp.skippedEmpty ? ', skipped ' + imp.skippedEmpty + ' blank row' + (imp.skippedEmpty === 1 ? '' : 's') : '') +
          (imp.failed ? ', ' + imp.failed + ' did NOT save (click again to retry)' : '') + '.';
        if (!imp.shown) {
          api.state.phase = 'done';
          var gs = ghostAndStaffFor(day, prov);
          note('athenaOne shows no appointments on ' + esc(pd) + (prov !== 'all' ? ' for ' + esc(prov) : '') + ' - nothing imported, no charts to pull.' +
            (gs.staff ? ' ' + gs.staff + ' staff-booked row' + (gs.staff === 1 ? '' : 's') + ' (booked inside MLS, not from athena) exist for that day - those are legitimate and untouched.' : '') +
            (gs.ghost ? ' <b>Heads-up:</b> the MLS calendar also holds ' + gs.ghost + ' imported row' + (gs.ghost === 1 ? '' : 's') + ' keyed to that day - possibly mis-keyed by an earlier import; don’t trust them for prep.' : ''));
          return out;
        }
        /* chart leg: athenaOne only renders the signed-in doctor's schedule
           (verified live 2026-07-10) - same-doctor check is FUZZY so athena's
           own spelling of the signed-in doctor is not refused */
        api.state.phase = 'charts';
        var self = selfProvider();
        var chartProv = (prov === 'all') ? self : prov;
        if (!sameProv(chartProv, self)) {
          api.state.phase = 'done';
          note(head + '<br>⚠️ Charts NOT pulled: athenaOne only shows the signed-in doctor’s schedule (' + esc(self) + '), so ' + esc(chartProv) + '’s charts cannot be opened from this login. The schedule rows are imported and comparable in Copilot.');
          return out;
        }
        if (prov === 'all') note(head + '<br>Charts can only be opened for the signed-in doctor - pulling charts for ' + esc(self) + '&hellip;');
        var cl = await chartLeg(day, chartProv);
        out.charts = cl.agg || (cl.statuses && cl.statuses.length ? cl.statuses : null) || null;
        /* inherited chart-engine name-filter bug: predict + surface, never hide */
        var bugNames = excludedByEngineBug(day, (cl.usedProvs && cl.usedProvs.length) ? cl.usedProvs : [chartProv]);
        var bugLine = '';
        if (bugNames.length) {
          warnEngineBugOnce(bugNames);
          out.chartEngineExcluded = bugNames.slice();
          bugLine = '<br>⚠️ ' + bugNames.length + ' real patient' + (bugNames.length === 1 ? '' : 's') + ' on this day (' +
            esc(bugNames.slice(0, 5).join(', ')) + (bugNames.length > 5 ? ', …' : '') +
            ') ' + (bugNames.length === 1 ? 'is' : 'are') + ' skipped by the chart engine’s name filter (a known bug: names ending in letters like -do/-ma/-rn/-pt trip its credential check). ' +
            'Their schedule rows ARE imported - pull those charts one-by-one from the patient list until the engine fix ships.';
        }
        if (cl.skipped) { api.state.phase = 'done'; note(head + '<br>⚠️ ' + cl.skipped + bugLine); return out; }
        var A = cl.agg;
        var extra = cl.statuses && cl.statuses.length ? ' (also: ' + esc(cl.statuses.join(', ')) + ')' : '';
        if (A && A.total) {
          note(head + '<br>📚 Charts (' + esc(cl.usedProvs.join(' + ')) + '): ' + A.ok + ' of ' + A.total + ' pulled' +
            (A.alreadyPulled ? ' - ' + A.alreadyPulled + ' already had history' : '') +
            (A.failed ? ' - ' + A.failed + ' could not be read (click again to retry; finished ones are skipped).' : '.') + extra + bugLine);
        } else if (cl.statuses.length && cl.statuses.every(function (s) { return s === 'nothing-to-do'; })) {
          note(head + '<br>📚 Every patient on that day already has chart history - nothing to re-pull.' + bugLine);
        } else {
          note(head + '<br>📚 Chart pull ended: ' + esc(cl.statuses.join(', ') || 'no result') + '.' + bugLine);
        }
        api.state.phase = 'done';
        return out;
      } catch (e) {
        out.error = String((e && e.message) || e);
        api.state.phase = 'error';
        if (/worker-timers-unavailable/.test(out.error)) {
          note('⚠️ Worker timers failed mid-pull - the pull was stopped rather than left to stall silently. Each appointment saves atomically, so nothing is half-written; reload MLS and click again (saved rows are skipped).');
        } else {
          note('⚠️ Unexpected error: ' + esc(out.error));
        }
        return out;
      } finally {
        api.state.lastRun = out; api.lastRun = out;
        api.state.running = false; api.running = false;
        setBusy(false);
        try { window.postMessage({ source: 'mls-app', type: 'mlsAppFocusMlsTab' }, '*'); } catch (e) {}
      }
    })();
  }

  /* --------------------------------- UI ------------------------------------ */
  var DEFAULT_NOTE = 'Imports that day’s schedule for the Doctor picked above, then pulls chart history (DOB + history + visits) for the day’s patients. Read-only in athenaOne; re-clicking never doubles anything. Heads-up: the chart engine currently skips a few name shapes (a known filter bug) - if that hits this day you’ll be told exactly which patients.';
  function css() {
    if (document.getElementById('mlsPadCss')) return;
    var s = document.createElement('style'); s.id = 'mlsPadCss';
    s.textContent = [
      '#mlsPadRow{margin-top:12px;padding-top:12px;border-top:1px dashed rgba(139,120,220,.4)}',
      '#mlsPadHead{font:800 13px system-ui;margin-bottom:6px}',
      '#mlsPadCtl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}',
      '#mlsPadDate{background:#141b3d;color:#e8ecff;border:1px solid rgba(139,120,220,.35);border-radius:8px;padding:7px 9px;font-size:13px}',
      '#mlsPadBtn{flex:1;min-width:230px;border:0;border-radius:9px;padding:9px 12px;font:700 12.5px system-ui;cursor:pointer;background:linear-gradient(135deg,#2E67EF,#1D46AF);color:#fff}',
      '#mlsPadBtn[disabled]{opacity:.55;cursor:default}',
      '#mlsPadNote{font-size:11.5px;color:#9fb0d8;margin-top:6px;line-height:1.45}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }
  function mount() {
    try {
      var existing = document.getElementById('mlsPadRow');
      if (existing && existing.getAttribute('data-mls-pad') === '1') {
        /* keep the row UNDER the month-pull section if another module appended
           after us (converges: __mlsMonthPullOne bails once #mlsMpoBtn exists) */
        var pc = existing.parentNode;
        if (pc && pc.lastElementChild !== existing) pc.appendChild(existing);
        return;
      }
      var card = document.querySelector('.ez3-card.ez3-pull');
      if (!card) return;
      css();
      api.mounts++;
      var row = document.createElement('div');
      row.id = 'mlsPadRow';
      row.setAttribute('data-mls-pad', '1'); /* idempotence marker */
      row.innerHTML =
        '<div id="mlsPadHead">📅 Pull a specific day</div>' +
        '<div id="mlsPadCtl">' +
          '<input type="date" id="mlsPadDate">' +
          '<button type="button" id="mlsPadBtn">📅 Pull this day (schedule + charts)</button>' +
        '</div>' +
        '<div id="mlsPadNote"></div>';
      card.appendChild(row);
      var inp = row.querySelector('#mlsPadDate');
      inp.value = api._date || todayYMD(); /* defaults to today, LOCAL time */
      inp.onchange = function () { api._date = inp.value; };
      var btn = row.querySelector('#mlsPadBtn');
      btn.disabled = !!api.state.running;
      btn.onclick = function () {
        /* the oldest Easy dupe renders the card WITHOUT #ez3sPullProv - read
           defensively and default to 'all' (chart leg then maps to the
           signed-in doctor) */
        var provEl = document.getElementById('ez3sPullProv');
        runFlow(inp.value, (provEl && provEl.value) || 'all');
      };
      row.querySelector('#mlsPadNote').innerHTML = api._noteHtml || DEFAULT_NOTE;
    } catch (e) {}
  }

  /* re-mount without timers: the staff card re-renders via wrap().innerHTML,
     and page timers are throttled to ~0 while athenaOne is foregrounded - use
     a MutationObserver plus interaction/visibility hooks (never setInterval). */
  var mo = null;
  function startObs() {
    if (mo) return;
    try {
      mo = new MutationObserver(function () { try { mount(); } catch (e) {} });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
  }
  function onClickCap() { try { mount(); } catch (e) {} }
  function onVis() { try { mount(); } catch (e) {} }
  try { document.addEventListener('click', onClickCap, true); } catch (e) {}
  try { document.addEventListener('visibilitychange', onVis, true); } catch (e) {}
  try { startObs(); } catch (e) {}
  if (document.readyState === 'loading') { try { document.addEventListener('DOMContentLoaded', function () { startObs(); mount(); }, { once: true }); } catch (e) {} }
  else { try { mount(); } catch (e) {} }

  api.run = runFlow;
  api.pull = runFlow; /* design-doc alias */
  api.mount = mount;
  api.revert = function () {
    try { if (mo) { mo.disconnect(); mo = null; } } catch (e) {}
    try { document.removeEventListener('click', onClickCap, true); } catch (e) {}
    try { document.removeEventListener('visibilitychange', onVis, true); } catch (e) {}
    try { var r = document.getElementById('mlsPadRow'); if (r) r.remove(); } catch (e) {}
    try { var s = document.getElementById('mlsPadCss'); if (s) s.remove(); } catch (e) {}
    try { if (_wkUrl) { URL.revokeObjectURL(_wkUrl); _wkUrl = null; } } catch (e) {}
    try { delete window.__mlsPullAnyDay_revert; } catch (e) {}
    try { delete window.__mlsPullAnyDay; } catch (e) {}
  };
  window.__mlsPullAnyDay = api;
  window.__mlsPullAnyDay_revert = api.revert;
})();


/* ==== __mlsProgressAlwaysOn (b121) =========================================
 * THE LOADING SCREEN MUST APPEAR ON EVERY PULL. Live finding 2026-07-10: the
 * b113 progress screen opens from isPullTrigger(), a capture-phase CLICK
 * matcher over a hardcoded list of button texts ("pull from athenaone",
 * "pull visits from athena", ...) — none of which match the CURRENT pull
 * controls ("Pull day histories" FAB, "Pull chart histories (this doctor,
 * this month)", "Pull today only"), so pulls ran all day with opens === 0.
 * Button-identity triggers rot every time a label changes.
 *
 * This module renders progress FROM THE ENGINE'S OWN STATE instead:
 * __mlsDayHistoryPull.state {running, done, ok, failed, total, current, rows}.
 * If the engine says a pull is running, the overlay is on screen — no matter
 * which button started it (day FAB, month card, Pull-Any-Day, console).
 *
 * - Worker-timer tick (~700ms): plain timers are throttled to ~0 in a hidden
 *   tab while athenaOne is foregrounded — exactly when pulls run.
 * - Defers to any OTHER visible fixed-position progress overlay (the b113
 *   screen, if its own trigger ever matches) — never doubles.
 * - Auto-hides ~4s after running flips false, leaving a final honest tally.
 * - Additive; window.__mlsProgressAlwaysOn.revert() removes everything.
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__mlsProgressAlwaysOn) return;
  var API = { version: '1.0.0', shows: 0, ticks: 0, deferred: 0, revert: revert };
  window.__mlsProgressAlwaysOn = API;
  var EL_ID = 'mlsPP2';
  var _wk = null, _wkUrl = null, _hideAt = 0, _lastRunning = false;

  function engineState() {
    try {
      var p = window.__mlsDayHistoryPull;
      if (p && p.state && typeof p.state === 'object') return p.state;
    } catch (e) {}
    return null;
  }
  /* another progress overlay already on screen? Defer ONLY to a genuine
     large MODAL progress panel (the b113 full-screen screen) — a big, roughly
     centered fixed element showing live "N of M" pull progress. The earlier
     loose heuristic (any fixed div >300x160 with an "N of M" + pull word)
     false-matched transient nodes and suppressed this overlay (live: 113
     spurious defers, zero shows) — which IS the "no loading UI" failure. Now
     it must be big AND central AND actively counting, or we show our own. */
  function otherOverlayVisible() {
    try {
      var vw = window.innerWidth || 1200, vh = window.innerHeight || 800;
      var els = document.querySelectorAll('div');
      for (var i = 0; i < els.length; i++) {
        var el = els[i];
        if (el.id === EL_ID) continue;
        var r = el.getBoundingClientRect();
        /* MODAL scale only: >=55% width AND >=45% height */
        if (r.width < vw * 0.55 || r.height < vh * 0.45) continue;
        /* roughly centered (a corner toast never qualifies) */
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        if (Math.abs(cx - vw / 2) > vw * 0.2 || Math.abs(cy - vh / 2) > vh * 0.25) continue;
        var s = getComputedStyle(el);
        if (s.position !== 'fixed') continue;
        if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity || '1') < 0.3) continue;
        var tx = (el.innerText || '').slice(0, 400);
        if (/\b\d+\s+of\s+\d+\b/i.test(tx) && /pull|patient|chart|reading|saving/i.test(tx)) return true;
      }
    } catch (e) {}
    return false;
  }
  function box() {
    var el = document.getElementById(EL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = EL_ID;
    el.setAttribute('data-mls-b121', '1');
    el.style.cssText = 'position:fixed;right:18px;bottom:86px;z-index:2147483000;background:#0f1e33;color:#eaf2ff;border:1px solid #2b4a77;border-radius:12px;padding:14px 18px;min-width:300px;max-width:380px;box-shadow:0 10px 30px rgba(0,0,0,.45);font:13px/1.45 system-ui,Segoe UI,sans-serif;display:none';
    el.innerHTML =
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<span id="mlsPP2Spin" style="width:12px;height:12px;border:2px solid #3f6ea8;border-top-color:#9fd0ff;border-radius:50%;display:inline-block;animation:mlsPP2r 1s linear infinite"></span>' +
        '<b id="mlsPP2Title">Pulling charts from athenaOne…</b>' +
      '</div>' +
      '<div id="mlsPP2Line" style="margin-bottom:6px">starting…</div>' +
      '<div style="background:#12305a;border-radius:6px;height:8px;overflow:hidden"><div id="mlsPP2Bar" style="height:8px;width:0%;background:linear-gradient(90deg,#2f7bd9,#63b3ff);transition:width .4s"></div></div>' +
      '<div id="mlsPP2Tally" style="margin-top:6px;color:#a9c3e4"></div>' +
      '<style>@keyframes mlsPP2r{to{transform:rotate(360deg)}}</style>';
    (document.body || document.documentElement).appendChild(el);
    return el;
  }
  function render(st) {
    var el = box();
    var running = !!st.running;
    var total = Number(st.total || 0), done = Number(st.done || 0);
    var ok = Number(st.ok || 0), failed = Number(st.failed || 0);
    var cur = String(st.current || '').trim();
    var pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
    try {
      document.getElementById('mlsPP2Line').textContent =
        running ? ((done + 1 <= total ? (done + 1) : total) + ' of ' + total + (cur ? ' — ' + cur : ''))
                : ('Finished — ' + done + ' of ' + total);
      document.getElementById('mlsPP2Bar').style.width = (running ? pct : 100) + '%';
      document.getElementById('mlsPP2Tally').textContent = '✓ ' + ok + ' saved · ✗ ' + failed + ' failed' + (running ? '' : ' · closing…');
      document.getElementById('mlsPP2Title').textContent = running ? 'Pulling charts from athenaOne…' : 'Pull finished';
      document.getElementById('mlsPP2Spin').style.display = running ? 'inline-block' : 'none';
    } catch (e) {}
    if (el.style.display === 'none') { el.style.display = 'block'; API.shows++; }
  }
  function hide() {
    var el = document.getElementById(EL_ID);
    if (el) el.style.display = 'none';
  }
  function tick() {
    API.ticks++;
    var st = engineState();
    if (!st) return;
    var running = !!st.running;
    if (running) {
      _hideAt = 0;
      if (otherOverlayVisible()) { API.deferred++; hide(); }
      else render(st);
    } else if (_lastRunning) {
      /* just finished: show the final tally, then hide after ~4s */
      if (!otherOverlayVisible()) render(st);
      _hideAt = Date.now() + 4000;
    } else if (_hideAt && Date.now() > _hideAt) {
      hide(); _hideAt = 0;
    }
    _lastRunning = running;
  }
  try {
    _wkUrl = URL.createObjectURL(new Blob(['setInterval(function(){postMessage(1)},700);'], { type: 'application/javascript' }));
    _wk = new Worker(_wkUrl);
    _wk.onmessage = tick;
  } catch (e) {
    /* no Worker (CSP?): fall back to event-driven checks only — still opens on
       the first bridge chatter of a pull, never a bare setInterval. */
    try { console.warn('[__mlsProgressAlwaysOn] Worker unavailable — event-driven fallback only'); } catch (e2) {}
  }
  /* event fallbacks/boosters: bridge results and visibility flips both mean
     "state may have changed" — cheap ticks, capture-phase, no timers. */
  function evTick() { try { tick(); } catch (e) {} }
  window.addEventListener('message', evTick, true);
  document.addEventListener('visibilitychange', evTick, true);
  function revert() {
    try { if (_wk) _wk.terminate(); } catch (e) {}
    try { if (_wkUrl) URL.revokeObjectURL(_wkUrl); } catch (e) {}
    _wk = null; _wkUrl = null;
    try { window.removeEventListener('message', evTick, true); } catch (e) {}
    try { document.removeEventListener('visibilitychange', evTick, true); } catch (e) {}
    try { var el = document.getElementById(EL_ID); if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
    try { delete window.__mlsProgressAlwaysOn; } catch (e) { window.__mlsProgressAlwaysOn = null; }
    return 'reverted';
  }
})();
