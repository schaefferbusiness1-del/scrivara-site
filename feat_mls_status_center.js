/* =====================================================================
 * feat_mls_status_center.js  ->  window.__mlsStatusCenter  (v1.0.0)
 * ---------------------------------------------------------------------
 * ONE polished, honest, MLS-Scribe-style STATUS CENTER for MLS Assistant
 * and the Athena pull — plus the root-cause fix for "Athena is connected
 * but MLS says it is not."
 *
 * WHY (task-4, 2026-07-05)
 *   Status today is split across many small surfaces (hero status line,
 *   item79 pull card, ux-unify mirror, context-bar chip, status dot,
 *   sign-in banner, doctor panel, assistant panel). They sample the
 *   connection at different moments, so they can disagree; and the
 *   connection verdict itself (feat_mls_asst_fix connCheck) declares
 *   DISCONNECTED from ONE failed probe with a 4s timeout — a discarded /
 *   sleeping Athena tab or a cold extension service-worker misses that
 *   window easily, so a genuinely-connected Athena shows red until the
 *   next 30s poll. This module fixes the verdict (evidence + retries +
 *   "checking" in between) and gives the user ONE clear surface that
 *   says exactly what MLS is doing, step by step.
 *
 * WHAT IT DOES
 *   1. CONNECTION TRUTH v2 (wraps window.__mlsConnTruth, reversible):
 *      - verdict = connected | checking | disconnected, from EVIDENCE:
 *        (a) passive proof — any real extension result that came from an
 *            athena host (a user pull, chart read, etc.) marks connected
 *            with a freshness timestamp; no probe needed while real
 *            results keep landing.
 *        (b) active probe — mlsPing (3 tries; wakes a cold service
 *            worker) then a schedule probe with escalating timeouts
 *            (9s/14s/20s), never while a user pull is in flight.
 *        (c) v1.42+ extension fast path — mlsAppConnCheck (tab presence
 *            by host, no page read) when the loaded extension supports
 *            it; feature-detected, falls back silently on v1.40/1.41.
 *      - A single failed/slow probe NEVER flips the app to red. Failures
 *        show "Checking Athena connection…" and retry; DISCONNECTED is
 *        declared only when retries are exhausted AND there is no fresh
 *        positive evidence (or the extension truly does not answer, or
 *        Athena is truly signed out — those are definitive).
 *      - isConnected()/describe()/check()/state are wrapped so every
 *        consumer (context chip, status dot, sign-in banner, assistant,
 *        status-unify) reads the SAME verdict. A visible-surface
 *        corrector repaints the chip/dot/banner if an old subscriber
 *        briefly renders a contradictory state, so pages can no longer
 *        disagree. Downgrade-safe: "connected" is never invented — it
 *        always traces to a real athena-host reply.
 *   2. STATUS CENTER DOCK (one surface, fixed position, no layout shift):
 *      current task · current step · current patient/date · data source ·
 *      completed / running / failed / retry steps · per-area statuses
 *      (Athena connection, Athena reading, Athena pull, Backend sync,
 *      Patient matching, Calendar, Patient selector, MLS Easy, Writeback
 *      readiness, EMR section) · "What changed in MLS Scribe" ·
 *      "What to do next" · Retry buttons. Collapses to a small pill.
 *      position:fixed => zero reflow of app content; rows have fixed
 *      heights => no flicker/jumping; buttons never move while visible.
 *   3. HONEST NARRATION of the pull, driven ONLY by real events:
 *      "Checking Athena connection" → "Athena connection confirmed" →
 *      "Reading Athena calendar" → "Reading provider schedule" →
 *      "Reading visits for <real date>" → "Loading patient: <name>" →
 *      "Pulling appointment data" → "Updating MLS calendar" →
 *      "Updating Who's Next" → "Updating patient selector" →
 *      "Updating MLS Easy" → "Checking for missing visits" →
 *      "Finished pulling Athena data".
 *      Counts appear ONLY from real result arrays (§39/§50 honesty rules,
 *      same as feat_athena_narration): never from progress text. If a
 *      backend/DOM confirmation is missing the line says so — the UI is
 *      never faked.
 *   4. DE-DUPLICATION: while the dock is live it hides the two duplicate
 *      floating surfaces (#mlsFpPullCard log card and the ux-unify
 *      mirror panel) and, ONLY while the verdict is "checking", the
 *      #mlsSignInPrompt banner (it returns instantly if the verdict
 *      becomes truly disconnected). Their engines keep running; nothing
 *      is removed; revert restores everything.
 *   5. RELOAD SAFETY: a compact, PHI-free snapshot (labels only, patient
 *      names replaced with "(patient)") is kept in sessionStorage; after
 *      a reload the dock restores the last task, marks any step that was
 *      running as "interrupted by reload", and re-checks the connection
 *      honestly. Loading states cannot dangle forever: every running
 *      step has a watchdog ("taking longer than usual" at 90s, failed
 *      with a Retry at 240s).
 *   6. SAFE BLOCKED-ACTION status: when a guard refuses an action the
 *      dock says what was blocked and why (e.g. writeback attempted
 *      while not ready). This module itself NEVER writes to athenaOne,
 *      never clicks Save/Sign, never posts write messages — it is a
 *      read-only observer plus the same read-only probes the app
 *      already uses (ping + schedule read).
 *
 * PHI SAFETY
 *   On screen it may show a patient display name the app itself is
 *   already showing (e.g. "Loading patient: …" from the app's own
 *   request payload) — same surface, same user. It never LOGS and never
 *   PERSISTS patient text: console output is generic, and the
 *   sessionStorage snapshot replaces every patient string with
 *   "(patient)". Backend observation records method + path + HTTP status
 *   only — never request/response bodies.
 *
 * SHAPE
 *   Additive, own-scope IIFE, idempotent boot, zero edits to existing
 *   assets, fully reversible: window.__mlsStatusCenter.revert() restores
 *   wrapped methods, unhooks every listener/observer/timer, removes all
 *   DOM/styles, and un-hides the legacy surfaces. Any internal error
 *   no-ops (try/catch everywhere) — worst case the page behaves exactly
 *   as before this file loaded.
 * ===================================================================== */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W || !W.document) return;
  if (W.__mlsStatusCenter && W.__mlsStatusCenter.installed) return;

  var VERSION = '1.0.0';
  var ASSET = 'feat_mls_status_center.js';
  var DOCK_ID = 'mlsScDock';
  var STYLE_ID = 'mlsScStyle';
  var SS_KEY = 'mlsStatusCenter_v1';

  /* -------------------- tunables -------------------- */
  /* __MLS_SC_TEST_TUNING is a TEST-ONLY override hook (jsdom suite shortens the
   * waits). It is never set in production; when absent, the defaults apply. */
  var TUNE = (function () { try { return W.__MLS_SC_TEST_TUNING || {}; } catch (e) { return {}; } })();
  function tn(key, dflt) { return (typeof TUNE[key] === 'number' && TUNE[key] > 0) ? TUNE[key] : dflt; }
  var EVIDENCE_TTL_MS = tn('EVIDENCE_TTL_MS', 180000);   // positive proof stays valid this long
  var GRACE_MS = tn('GRACE_MS', 120000);          // recent-connected grace: fail->checking, not red
  var PING_TIMEOUT_MS = tn('PING_TIMEOUT_MS', 2500);
  var PING_TRIES = tn('PING_TRIES', 3);             // wakes a cold MV3 service worker
  var SCHED_TIMEOUTS = TUNE.SCHED_TIMEOUTS || [9000, 14000, 20000]; // escalating probe timeouts
  var FASTCHECK_TIMEOUT_MS = tn('FASTCHECK_TIMEOUT_MS', 1600);// v1.42 mlsAppConnCheck
  var PROBE_MIN_GAP_MS = tn('PROBE_MIN_GAP_MS', 20000);   // never probe more often than this
  var POLL_MS = tn('POLL_MS', 45000);            // background re-verdict cadence (visible only)
  var STEP_SLOW_MS = tn('STEP_SLOW_MS', 90000);       // running step -> "taking longer than usual"
  var STEP_FAIL_MS = tn('STEP_FAIL_MS', 240000);      // running step -> failed + Retry
  var TASK_FAIL_MS = tn('TASK_FAIL_MS', 300000);      // whole task watchdog
  var DOM_CONFIRM_MS = tn('DOM_CONFIRM_MS', 12000);     // wait for calendar/selector/easy to visibly update
  var RETRY_GAP_MS = tn('RETRY_GAP_MS', 1500);        // gap between probe retries
  var WATCHDOG_TICK_MS = tn('WATCHDOG_TICK_MS', 15000);

  /* -------------------- tiny utils -------------------- */
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function now() { return Date.now(); }
  function $id(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function fmtClock(t) {
    var d = new Date(t || now());
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  }
  var cleanups = [];   // fns run on revert
  var timers = [];     // interval ids
  var timeouts = [];   // timeout ids
  var observers = [];  // MutationObservers
  function remember(fn) { cleanups.push(fn); }
  function every(ms, fn) { var id = setInterval(function () { safe(fn); }, ms); timers.push(id); return id; }
  function later(ms, fn) { var id = setTimeout(function () { safe(fn); }, ms); timeouts.push(id); return id; }
  function listen(target, ev, fn, opts) {
    target.addEventListener(ev, fn, opts || false);
    remember(function () { safe(function () { target.removeEventListener(ev, fn, opts || false); }); });
  }
  function observe(node, fn, cfg) {
    var mo = new MutationObserver(function (m) { safe(function () { fn(m); }); });
    mo.observe(node, cfg);
    observers.push(mo);
    return mo;
  }

  /* =====================================================================
   * SECTION A — CONNECTION TRUTH v2 (evidence + retries + coherence)
   * =================================================================== */
  var conn = {
    verdict: 'checking',            // connected | checking | disconnected
    reason: 'Checking Athena connection',
    detailStatus: 'checking',       // connected|no-extension|no-tab|error|checking (legacy vocab)
    lastConnectedAt: 0,
    evidence: { pong: 0, athenaResult: 0, probeOk: 0, probeFail: 0, fastCheck: 0 },
    probing: false,
    attempt: 0,
    attemptsMax: PING_TRIES,
    lastProbeAt: 0,
    fastCheckSupported: null,       // null = unknown, true/false after first try
    extVersion: ''
  };
  var connSubs = [];
  function connNotify() {
    var st = connPublicState();
    for (var i = 0; i < connSubs.length; i++) safe(function () { connSubs[i](st); });
    safe(renderConn);
    safe(correctLegacySurfaces);
    safe(persist);
  }
  function connPublicState() {
    return {
      status: conn.verdict === 'connected' ? 'connected' : (conn.verdict === 'checking' ? 'checking' : conn.detailStatus),
      verdict: conn.verdict,
      reason: conn.reason,
      ext: conn.detailStatus !== 'no-extension',
      tab: conn.verdict === 'connected',
      at: conn.lastConnectedAt || conn.lastProbeAt || 0,
      source: 'status-center'
    };
  }
  function setVerdict(v, detailStatus, reason) {
    var changed = (v !== conn.verdict) || (reason !== conn.reason);
    conn.verdict = v;
    conn.detailStatus = detailStatus || (v === 'connected' ? 'connected' : (v === 'checking' ? 'checking' : 'error'));
    conn.reason = reason || '';
    if (v === 'connected') conn.lastConnectedAt = now();
    if (changed) connNotify();
  }

  /* ---- bridge messaging (read-only requests the app already uses) ---- */
  var pullBusy = { active: false, at: 0 };
  function pullIsBusy() {
    if (pullBusy.active) return true;
    var t = safe(function () { return W.__mlsPullBusyAt || 0; }, 0);
    return (now() - t) < 45000;
  }
  var bridgeReqSeq = 0;
  function bridgeRequest(type, replyType, timeoutMs, extra) {
    return new Promise(function (resolve) {
      var done = false;
      /* Correlate: the content bridge echoes requestId on schedule/goto
         replies (b346). Without this, a probe could consume ANOTHER
         surface's reply — e.g. a concurrent pull's lease refusal — and
         report a false disconnect. Id-less replies (mlsPong) still pass. */
      var reqId = 'mlssc' + (++bridgeReqSeq) + '_' + Date.now().toString(36);
      function onMsg(e) {
        var d = e && e.data;
        if (!d || typeof d !== 'object' || d.source !== 'mls-ext' || d.type !== replyType) return;
        if (d.requestId && d.requestId !== reqId) return; /* someone else's reply */
        if (done) return;
        done = true;
        safe(function () { W.removeEventListener('message', onMsg); });
        resolve({ ok: true, data: d });
      }
      W.addEventListener('message', onMsg);
      later(timeoutMs, function () {
        if (done) return;
        done = true;
        safe(function () { W.removeEventListener('message', onMsg); });
        resolve({ ok: false, timeout: true });
      });
      var payload = { source: 'mls-app', type: type };
      if (extra) { for (var k in extra) { if (Object.prototype.hasOwnProperty.call(extra, k)) payload[k] = extra[k]; } }
      payload.requestId = reqId;
      safe(function () { W.postMessage(payload, W.location.origin); });
    });
  }
  function classifyScheduleReply(d) {
    // Reads ONLY: resp.ok (bool), resp.signin (bool), host of resp.url. Never text/title. No PHI.
    var resp = d && d.data && d.data.resp;
    if (!resp || typeof resp !== 'object') return { state: 'unknown', why: 'Empty reply from the extension.' };
    /* Extension RUNTIME failure ≠ Athena signed out. The content bridge answers
       'extension-error' the instant chrome.runtime throws (worker crashed /
       Chrome invalidated the extension). Blaming Athena here sent the owner to
       sign in to a session that was fine — name the real fix instead. */
    var ctl = (String(resp.reason || '') + ' ' + String(resp.error || '')).slice(0, 200);
    if (/extension-error|bridge-error|context invalidated|worker-unreachable/i.test(ctl)) {
      return { state: 'ext-crashed', why: 'MLS Assist hit an internal error and needs a reload — open chrome://extensions, find MLS Assist, press ↻ Reload. athenaOne itself may still be signed in.' };
    }
    if (resp.error) {
      var em = String(resp.error).slice(0, 160);
      if (/no athena|no tab|not found|no http/i.test(em)) return { state: 'no-tab', why: 'No athenaOne tab found.' };
      return { state: 'unknown', why: 'Athena page not ready, retrying' };
    }
    var host = '';
    safe(function () { var u = typeof resp.url === 'string' ? resp.url : ''; host = u ? String(u).replace(/^[a-z]+:\/\//i, '').split('/')[0] : ''; });
    var isAthena = host ? /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(host) : null;
    var signin = !!resp.signin;
    if (signin) return { state: 'no-tab', why: 'athenaOne is showing a sign-in page — sign in, then retry.' };
    if (resp.ok && (isAthena === true || isAthena === null)) return { state: 'connected', why: 'athenaOne connected — a signed-in tab is readable.' };
    if (resp.ok && isAthena === false) return { state: 'no-tab', why: 'No athenaOne tab found (another site answered).' };
    return { state: 'unknown', why: 'Athena page not ready, retrying' };
  }

  /* ---- the orchestrated probe: never one-shot-red ---- */
  var probeChain = null;
  function probeConnection(force) {
    if (probeChain) return probeChain;
    if (!force && (now() - conn.lastProbeAt) < PROBE_MIN_GAP_MS) return Promise.resolve(connPublicState());
    if (pullIsBusy()) {
      // A real user pull IS the best evidence stream; never race it with probes.
      return Promise.resolve(connPublicState());
    }
    conn.lastProbeAt = now();
    conn.probing = true;
    if (conn.verdict !== 'connected') setVerdict('checking', 'checking', 'Checking Athena connection');
    else safe(renderConn);

    probeChain = (function () {
      // Step 1: extension alive? Ping up to 3x (wakes a cold service worker).
      var p = Promise.resolve(false);
      for (var i = 0; i < PING_TRIES; i++) {
        (function (attempt) {
          p = p.then(function (ok) {
            if (ok) return true;
            conn.attempt = attempt + 1;
            safe(renderConn);
            return bridgeRequest('mlsPing', 'mlsPong', PING_TIMEOUT_MS).then(function (r) {
              if (r.ok) conn.evidence.pong = now();
              return r.ok;
            });
          });
        })(i);
      }
      return p.then(function (pong) {
        if (!pong) {
          conn.probing = false;
          setVerdict('disconnected', 'no-extension', 'MLS Assist did not answer after ' + PING_TRIES + ' tries — load/enable the extension, then Recheck.');
          return connPublicState();
        }
        // Step 2 (fast path, v1.42+): cheap tab check — no page read at all.
        return tryFastCheck().then(function (fc) {
          if (fc && fc.answered) {
            if (fc.present && fc.loggedIn !== false) {
              conn.evidence.fastCheck = now();
              conn.probing = false;
              setVerdict('connected', 'connected', 'athenaOne connected' + (fc.host ? ' (' + fc.host + ')' : '') + '.');
              return connPublicState();
            }
            if (fc.present === false) {
              conn.probing = false;
              setVerdict('disconnected', 'no-tab', 'No athenaOne tab is open — open athenaOne and sign in.');
              return connPublicState();
            }
            // present but maybe on a login page -> fall through to the real read probe
          }
          // Step 3: schedule probe with escalating timeouts.
          var attempt = 0;
          function tryOnce() {
            if (pullIsBusy()) { conn.probing = false; return Promise.resolve(connPublicState()); }
            if (evidenceFresh()) { // real data landed while we were probing — that wins
              conn.probing = false;
              setVerdict('connected', 'connected', 'athenaOne connected — live data came back while rechecking.');
              return Promise.resolve(connPublicState());
            }
            conn.attempt = attempt + 1;
            conn.attemptsMax = SCHED_TIMEOUTS.length;
            safe(renderConn);
            return bridgeRequest('mlsAppPullSchedule', 'mlsAppScheduleResult', SCHED_TIMEOUTS[attempt]).then(function (r) {
              var cls = r.ok ? classifyScheduleReply(r) : { state: 'unknown', why: 'Athena page not ready, retrying' };
              if (cls.state === 'connected') {
                conn.evidence.probeOk = now();
                conn.probing = false;
                setVerdict('connected', 'connected', cls.why);
                return connPublicState();
              }
              if (cls.state === 'no-tab') {
                // definitive negative (real reply said sign-in / wrong host / no tab)
                conn.evidence.probeFail = now();
                conn.probing = false;
                setVerdict('disconnected', 'no-tab', cls.why);
                return connPublicState();
              }
              if (cls.state === 'ext-crashed') {
                // definitive, but the culprit is the EXTENSION RUNTIME — say so.
                conn.evidence.probeFail = now();
                conn.probing = false;
                setVerdict('disconnected', 'no-extension', cls.why);
                return connPublicState();
              }
              attempt++;
              if (attempt < SCHED_TIMEOUTS.length) {
                setVerdict('checking', 'checking', 'Athena page not ready, retrying (' + (attempt + 1) + '/' + SCHED_TIMEOUTS.length + ')');
                return new Promise(function (res) { later(RETRY_GAP_MS, function () { res(tryOnce()); }); });
              }
              // Retries exhausted. Only now may we go red — unless fresh positive evidence exists.
              conn.evidence.probeFail = now();
              conn.probing = false;
              if (evidenceFresh()) {
                setVerdict('connected', 'connected', 'athenaOne connected — live data came back while rechecking.');
                return connPublicState();
              }
              if ((now() - conn.lastConnectedAt) < GRACE_MS) {
                setVerdict('checking', 'checking', 'Athena was connected moments ago but is not answering — rechecking. If this persists, click the athenaOne tab once to wake it.');
              } else {
                setVerdict('disconnected', 'error', 'athenaOne did not answer after ' + SCHED_TIMEOUTS.length + ' attempts — click the athenaOne tab once to wake it, then Recheck.');
              }
              return connPublicState();
            });
          }
          return tryOnce();
        });
      }).then(function (st) { probeChain = null; return st; },
              function ()   { probeChain = null; conn.probing = false; return connPublicState(); });
    })();
    return probeChain;
  }
  function tryFastCheck() {
    if (conn.fastCheckSupported === false) return Promise.resolve(null);
    return bridgeRequest('mlsAppConnCheck', 'mlsAppConnCheckResult', FASTCHECK_TIMEOUT_MS).then(function (r) {
      if (!r.ok) {
        if (conn.fastCheckSupported === null) conn.fastCheckSupported = false; // old extension — never ask again
        return { answered: false };
      }
      conn.fastCheckSupported = true;
      var resp = (r.data && r.data.resp) || {};
      var a = resp.athena || {};
      safe(function () { conn.extVersion = String(resp.extVersion || '').slice(0, 12); });
      return { answered: true, present: !!a.present, loggedIn: (a.loggedIn === undefined ? null : !!a.loggedIn), host: typeof a.host === 'string' ? a.host.slice(0, 60) : '' };
    });
  }

  /* ---- passive evidence: real results ARE connection proof ---- */
  function feedEvidenceFromResult(type, resp) {
    if (!resp || typeof resp !== 'object') return;
    if (resp.signin) { // a real reply that says "sign-in page" is definitive
      setVerdict('disconnected', 'no-tab', 'athenaOne is showing a sign-in page — sign in, then retry.');
      return;
    }
    if (resp.error) return; // neutral: page-not-ready etc.; probes decide
    var host = '';
    safe(function () { var u = typeof resp.url === 'string' ? resp.url : ''; host = u ? String(u).replace(/^[a-z]+:\/\//i, '').split('/')[0] : ''; });
    var isAthena = host ? /athenahealth|athenanet|athenaone|athena\.io|\.px\.athena/i.test(host) : null;
    if (resp.ok && isAthena !== false) {
      conn.evidence.athenaResult = now();
      if (conn.verdict !== 'connected') setVerdict('connected', 'connected', 'athenaOne connected — live data just came back from your athenaOne tab.');
      else conn.lastConnectedAt = now();
    }
  }
  function evidenceFresh() {
    var newest = Math.max(conn.evidence.athenaResult, conn.evidence.probeOk, conn.evidence.fastCheck);
    return (now() - newest) < EVIDENCE_TTL_MS;
  }
  function backgroundReverdict() {
    if (document.visibilityState === 'hidden') return;
    if (pullIsBusy()) return;
    if (evidenceFresh()) { if (conn.verdict !== 'connected') setVerdict('connected', 'connected', 'athenaOne connected.'); return; }
    if (conn.verdict === 'connected') {
      // evidence went stale -> honestly demote to checking and re-probe (never straight to red)
      setVerdict('checking', 'checking', 'Checking Athena connection');
    }
    probeConnection(false);
  }

  /* ---- wrap window.__mlsConnTruth so every consumer agrees ---- */
  var ctWrap = { done: false, orig: null, target: null };
  function wrapConnTruth() {
    var ct = W.__mlsConnTruth;
    if (!ct || ctWrap.done) return !!ctWrap.done;
    ctWrap.target = ct;
    ctWrap.orig = {
      isConnected: ct.isConnected, describe: ct.describe, check: ct.check,
      subscribe: ct.subscribe, start: ct.start, stop: ct.stop,
      stateDesc: safe(function () { return Object.getOwnPropertyDescriptor(ct, 'state'); }, null),
      stateVal: ct.state
    };
    safe(function () { if (isFn(ct.stop)) ct.stop(); }); // stop the old flappy 30s poll; we drive cadence now
    ct.isConnected = function () { return conn.verdict === 'connected'; };
    /* de-dupe (2026-07-09, BROKEN-4): conn.reason often BEGINS with the same
       label the panel renders right next to it ("athenaOne connected — ..."),
       which painted the doubled "athenaOne connectedathenaOne connected — ..."
       status text. Strip the leading duplicate at the one place label+detail meet. */
    function scDedupDetail(lbl, txt) {
      txt = String(txt || '');
      var l = String(lbl || '').replace(/[.…]+\s*$/, '');
      if (l && txt.toLowerCase().indexOf(l.toLowerCase()) === 0) {
        txt = txt.slice(l.length).replace(/^[\s.,:—–-]+/, '');
        if (txt) txt = txt.charAt(0).toUpperCase() + txt.slice(1);
      }
      return txt;
    }
    ct.describe = function (s) {
      var v = (s && s.verdict) ? s.verdict : conn.verdict;
      if (v === 'connected') return { status: 'connected', color: 'green', label: 'athenaOne connected', detail: scDedupDetail('athenaOne connected', conn.reason) };
      if (v === 'checking') return { status: 'checking', color: 'grey', label: 'Checking Athena connection…', detail: scDedupDetail('Checking Athena connection', conn.reason) };
      var lbl = conn.detailStatus === 'no-extension' ? 'MLS Assist not detected' : 'No signed-in athenaOne tab';
      return { status: conn.detailStatus, color: 'red', label: lbl, detail: scDedupDetail(lbl, conn.reason) };
    };
    ct.check = function () { return probeConnection(true).then(function () { return connPublicState(); }); };
    ct.subscribe = function (fn) {
      if (!isFn(fn)) return function () {};
      connSubs.push(fn);
      safe(function () { fn(connPublicState()); });
      return function () { var i = connSubs.indexOf(fn); if (i >= 0) connSubs.splice(i, 1); };
    };
    ct.start = function () { /* our poller is already running */ };
    ct.stop = function () { /* keep coherence; real stop happens on revert */ };
    safe(function () {
      Object.defineProperty(ct, 'state', {
        configurable: true,
        get: function () { return connPublicState(); },
        set: function (v) { // old layers may still write their view — take it as EVIDENCE, don't let it clobber
          safe(function () {
            if (v && v.status === 'connected') { conn.evidence.athenaResult = Math.max(conn.evidence.athenaResult, now()); if (conn.verdict !== 'connected') setVerdict('connected', 'connected', String(v.reason || 'athenaOne connected.')); }
            // negative writes are ignored here on purpose: negatives must come from OUR retried probes or definitive replies
          });
        }
      });
    });
    ct.__scWrapped = VERSION;
    ctWrap.done = true;
    remember(function () {
      safe(function () {
        var c = ctWrap.target, o = ctWrap.orig;
        if (!c || !o) return;
        if (o.stateDesc) Object.defineProperty(c, 'state', o.stateDesc); else { safe(function () { delete c.state; }); c.state = o.stateVal; }
        c.isConnected = o.isConnected; c.describe = o.describe; c.check = o.check;
        c.subscribe = o.subscribe; c.start = o.start; c.stop = o.stop;
        delete c.__scWrapped;
        safe(function () { if (isFn(c.start)) c.start(); });
      });
    });
    return true;
  }

  /* ---- visible-surface corrector: chip / dot / sign-in banner ----------
   * Old subscribers registered BEFORE this module loaded still get raw
   * notifications from the legacy layers. If one paints a contradiction
   * (e.g. red chip while our verdict is connected/checking), repaint it
   * within ~300ms. Downgrade-and-upgrade both allowed ONLY because the
   * verdict is evidence-backed; text is corrected to the same honest
   * label everywhere. Reversible: we only touch textContent/inline style
   * of the tiny label nodes, and we re-correct rather than store state.
   * -------------------------------------------------------------------- */
  function correctLegacySurfaces() {
    var v = conn.verdict;
    // sign-in banner: visible ONLY when truly disconnected
    safe(function () {
      var b = $id('mlsSignInPrompt');
      if (b) {
        if (v !== 'disconnected') { if (b.style.display !== 'none') { b.setAttribute('data-sc-hidden', '1'); b.style.display = 'none'; } }
        else if (b.getAttribute('data-sc-hidden')) { b.removeAttribute('data-sc-hidden'); b.style.display = ''; }
      }
    });
    // context-bar chips + status dot labels: normalize contradictory text
    safe(function () {
      var nodes = document.querySelectorAll('[data-mls-athena-chip], .mls-athena-chip, #mlsAthenaStatusDot, .mlsasd-dot');
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i]; var txt = String(n.textContent || '');
        var saysDisc = /not connected|disconnected|no signed-in|not detected/i.test(txt);
        var saysConn = /connected/i.test(txt) && !saysDisc;
        if (v === 'connected' && saysDisc) { n.textContent = 'athenaOne connected'; }
        else if (v === 'checking' && (saysDisc || /idle/i.test(txt))) { n.textContent = 'Checking Athena connection…'; }
        else if (v === 'disconnected' && saysConn) { n.textContent = conn.detailStatus === 'no-extension' ? 'MLS Assist not detected' : 'No signed-in athenaOne tab'; }
      }
    });
  }

  /* =====================================================================
   * SECTION B — STATUS STORE (task / steps / sources)
   * =================================================================== */
  var SOURCES = [
    ['athena',   'Athena connection'],
    ['reading',  'Athena reading'],
    ['pull',     'Athena pull'],
    ['backend',  'Backend sync'],
    ['matching', 'Patient matching'],
    ['calendar', 'Calendar update'],
    ['selector', 'Patient selector'],
    ['easy',     'MLS Easy'],
    ['writeback','Writeback readiness'],
    ['emr',      'EMR section']
  ];
  var store = {
    task: null,        // {id,label,source,startedAt,patient,date,finishedAt,outcome}
    steps: [],         // {id,label,state:pending|running|done|fail|retry|slow,detail,at,retryFn}
    sources: {},       // key -> {state:idle|working|ok|warn|fail, text, at}
    changes: [],       // "What changed in MLS Scribe" bullets (strings)
    next: '',          // "What the user should do next"
    blocked: []        // {action, why, at}
  };
  for (var si = 0; si < SOURCES.length; si++) store.sources[SOURCES[si][0]] = { state: 'idle', text: 'Idle', at: 0 };

  function srcSet(key, state, text) {
    var s = store.sources[key]; if (!s) return;
    if (s.state === state && s.text === text) return;
    s.state = state; s.text = text; s.at = now();
    renderSources(); persist();
  }
  function findStep(id) { for (var i = 0; i < store.steps.length; i++) if (store.steps[i].id === id) return store.steps[i]; return null; }
  function stepUpsert(id, label, state, detail, retryFn) {
    var st = findStep(id);
    if (!st) { st = { id: id, label: label, state: 'pending', detail: '', at: now(), retryFn: null }; store.steps.push(st); }
    if (label) st.label = label;
    if (state) st.state = state;
    st.detail = detail || '';
    st.at = now();
    if (retryFn) st.retryFn = retryFn;
    renderSteps(); persist();
    return st;
  }
  function taskBegin(label, sourceText) {
    store.task = { id: 't' + now(), label: label, source: sourceText || 'athenaOne', startedAt: now(), patient: '', date: '', finishedAt: 0, outcome: '' };
    store.steps = [];
    store.changes = [];
    store.next = '';
    dockShow(true);
    renderAll(); persist();
    // whole-task watchdog
    (function (tid) {
      later(TASK_FAIL_MS, function () {
        if (store.task && store.task.id === tid && !store.task.finishedAt) {
          taskFinish('Did not finish within ' + Math.round(TASK_FAIL_MS / 60000) + ' minutes.', 'fail');
          store.next = 'Click Retry to run it again, or check the athenaOne tab.';
          renderAll();
        }
      });
    })(store.task.id);
  }
  function taskMeta(patch) {
    if (!store.task) return;
    if (patch.patient !== undefined) store.task.patient = patch.patient;
    if (patch.date !== undefined) store.task.date = patch.date;
    renderTask(); persist();
  }
  function taskFinish(outcome, kind) {
    if (!store.task) return;
    store.task.finishedAt = now();
    store.task.outcome = outcome || 'Done.';
    store.task.outcomeKind = kind || 'ok';
    for (var i = 0; i < store.steps.length; i++) if (store.steps[i].state === 'running' || store.steps[i].state === 'slow') store.steps[i].state = (kind === 'fail' ? 'fail' : 'done');
    renderAll(); persist();
  }
  function addChange(line) { if (store.changes.indexOf(line) === -1) { store.changes.push(line); renderChanges(); persist(); } }
  function blockedAction(action, why) {
    store.blocked.push({ action: action, why: why, at: now() });
    if (store.blocked.length > 6) store.blocked.shift();
    stepUpsert('blocked' + now(), 'Blocked (safe): ' + action, 'fail', why);
    store.next = why;
    renderAll();
  }

  /* step watchdogs */
  every(WATCHDOG_TICK_MS, function () {
    var changed = false;
    for (var i = 0; i < store.steps.length; i++) {
      var st = store.steps[i];
      if (st.state === 'running' && (now() - st.at) > STEP_SLOW_MS) { st.state = 'slow'; st.detail = 'Still working — taking longer than usual.'; changed = true; }
      else if (st.state === 'slow' && (now() - st.at) > STEP_FAIL_MS) { st.state = 'fail'; st.detail = 'Did not finish. Use Retry, or check the athenaOne tab.'; changed = true; }
    }
    if (changed) { renderSteps(); persist(); }
  });

  /* =====================================================================
   * SECTION C — EVENT TAPS (passive; the real pull/chart/search streams)
   * =================================================================== */
  var lastPatientShown = ''; // display-only, never persisted/logged
  listen(W, 'message', function (e) {
    var d = e && e.data;
    if (!d || typeof d !== 'object' || typeof d.type !== 'string') return;

    if (d.source === 'mls-app') { // the app asking the extension for something
      if (d.type === 'mlsAppPullSchedule' && pullBusy.active) {
        stepUpsert('sched', 'Reading Athena calendar', 'running', 'Reading the day open in your athenaOne tab…');
        srcSet('reading', 'working', 'Reading Athena calendar');
      }
      if (d.type === 'mlsAppReadChart') {
        var nm = typeof d.patient === 'string' && d.patient.trim() ? d.patient.trim().slice(0, 60) : '';
        lastPatientShown = nm;
        taskMeta({ patient: nm || '(open chart)' });
        stepUpsert('chart', nm ? ('Loading patient: ' + nm) : 'Reading the open athenaOne chart', 'running', 'Reading name, DOB and visit history…');
        srcSet('reading', 'working', nm ? ('Loading patient: ' + nm) : 'Reading open chart');
      }
      return;
    }
    if (d.source !== 'mls-ext') return;
    var resp = d.resp;

    // Every extension reply is connection EVIDENCE first:
    if (d.type !== 'mlsPong' && d.type !== 'mlsAppConnCheckResult') safe(function () { feedEvidenceFromResult(d.type, resp); });

    if (d.type === 'mlsAppScheduleResult') {
      if (!pullBusy.active) return; // probe replies (ours or legacy) — connection layer already consumed them
      var ok = resp && resp.ok && !resp.error;
      if (ok) {
        stepUpsert('sched', 'Reading Athena calendar', 'done', 'Schedule page read.');
        var provN = safe(function () { return (resp.providers && resp.providers.length) || 0; }, 0);
        stepUpsert('prov', 'Reading provider schedule', 'done', provN ? ('Saw ' + provN + ' provider' + (provN === 1 ? '' : 's') + ' on the schedule.') : 'Provider list read.');
        if (!provN) stepUpsert('provwarn', 'Provider filter missing, using View all providers', 'done', 'No provider filter detected on the page — reading all providers.');
        stepUpsert('parse', 'Pulling appointment data', 'running', 'Turning the schedule into visits…');
        srcSet('reading', 'ok', 'Schedule read');
        srcSet('pull', 'working', 'Pulling appointment data');
      } else {
        var why = resp && resp.error ? String(resp.error).slice(0, 140) : 'Athena page not ready, retrying';
        stepUpsert('sched', 'Reading Athena calendar', 'fail', why, retryLastPull);
        srcSet('reading', 'fail', 'Could not read the schedule');
        srcSet('pull', 'fail', 'Pull stopped');
        store.next = /sign.?in/i.test(why) ? 'Sign in to athenaOne, then click Retry.' : 'Click the athenaOne tab once to wake it, then click Retry.';
        renderNext();
      }
      return;
    }
    if (d.type === 'mlsAppVisitsProgress') {
      // HONESTY: progress events carry optimistic pre-enumerated counts — show a count-FREE line (§50 rule).
      stepUpsert('visits', 'Reading visit history from the chart', 'running', 'Reading past visits — the real count appears when the read finishes.');
      srcSet('reading', 'working', 'Reading visit history');
      return;
    }
    if (d.type === 'mlsAppAllVisitsResult') {
      var n = safe(function () { return (resp && resp.visits && resp.visits.length) || 0; }, 0);
      if (resp && !resp.error) {
        stepUpsert('visits', 'Reading visit history from the chart', 'done', 'Read ' + n + ' real visit' + (n === 1 ? '' : 's') + ' from the chart.');
        if (lastPatientShown) addChange('Pulled ' + n + ' visit' + (n === 1 ? '' : 's') + ' for ' + lastPatientShown + ' into MLS.');
        srcSet('reading', 'ok', 'Visit history read');
      } else {
        stepUpsert('visits', 'Reading visit history from the chart', 'fail', 'Visit data incomplete, checking backend');
        srcSet('reading', 'warn', 'Visit data incomplete, checking backend');
      }
      return;
    }
    if (d.type === 'mlsAppChartResult') {
      if (resp && !resp.error) {
        stepUpsert('chart', lastPatientShown ? ('Loading patient: ' + lastPatientShown) : 'Reading the open athenaOne chart', 'done', 'Chart read.');
        srcSet('reading', 'ok', 'Chart read');
      } else if (resp) {
        stepUpsert('chart', 'Reading the open athenaOne chart', 'fail', String(resp.error || 'Could not read the chart').slice(0, 140));
        srcSet('reading', 'fail', 'Could not read the chart');
      }
      return;
    }
    if (d.type === 'mlsAppSearchOpenProgress') {
      stepUpsert('searchopen', 'Patient list not visible yet, waiting', 'running', 'Waiting for the athenaOne patient list…');
      return;
    }
    if (d.type === 'mlsAppSearchOpenResult' || d.type === 'mlsAppSearchResult') {
      var okS = resp && !resp.error;
      stepUpsert('searchopen', okS ? 'Patient search finished' : 'Patient search failed', okS ? 'done' : 'fail', okS ? '' : String((resp && resp.error) || '').slice(0, 140));
      return;
    }
    if (d.type === 'mlsAppPushProgress' || d.type === 'mlsAppPushResult' || d.type === 'mlsAppPasteResult' || d.type === 'mlsAppSignAndSaveResult') {
      // Writeback surfaces (user-initiated elsewhere; we only REPORT here)
      var okW = resp && !resp.error;
      if (d.type === 'mlsAppPushProgress') { srcSet('emr', 'working', 'Writing into the open encounter…'); return; }
      srcSet('emr', okW ? 'ok' : 'fail', okW ? 'Write-back reported success (verify in athenaOne)' : ('Write-back failed: ' + String((resp && resp.error) || 'unknown').slice(0, 100)));
      return;
    }
  }, true);

  /* =====================================================================
   * SECTION D — PULL WRAPPER (the user's real "Pull" becomes a narrated task)
   * =================================================================== */
  var wrapped = { pull: null };
  var lastPullArgs = null;
  function retryLastPull() {
    var f = wrapped.pull || safe(function () { return W.pullScheduleViaAssist; }, null);
    if (isFn(f)) { safe(function () { f.apply(W, lastPullArgs || []); }); }
  }
  function wrapPull() {
    var orig = W.pullScheduleViaAssist;
    if (!isFn(orig) || orig.__scWrapped) return !!(orig && orig.__scWrapped);
    wrapped.pull = orig;
    var w = function () {
      lastPullArgs = Array.prototype.slice.call(arguments);
      pullBusy.active = true; pullBusy.at = now();
      safe(function () { W.__mlsPullBusyAt = now(); });
      taskBegin('Pulling patients from athenaOne', 'athenaOne (your signed-in tab)');
      stepUpsert('conn', 'Checking Athena connection', 'running', '');
      srcSet('athena', 'working', 'Checking Athena connection');
      srcSet('pull', 'working', 'Starting pull');
      // Evidence-first: if fresh, confirm instantly; else quick ping only (never a schedule
      // probe here — the pull ITSELF is about to do the schedule read; racing it would cross replies).
      var connGate = evidenceFresh()
        ? Promise.resolve(true)
        : bridgeRequest('mlsPing', 'mlsPong', PING_TIMEOUT_MS).then(function (r) {
            if (r.ok) { conn.evidence.pong = now(); return true; }
            return bridgeRequest('mlsPing', 'mlsPong', PING_TIMEOUT_MS).then(function (r2) { if (r2.ok) { conn.evidence.pong = now(); } return r2.ok; });
          });
      connGate.then(function (extOk) {
        if (extOk) {
          stepUpsert('conn', evidenceFresh() ? 'Athena connection confirmed' : 'Extension responding — confirming with the live read', 'done', '');
          srcSet('athena', conn.verdict === 'connected' ? 'ok' : 'working', conn.verdict === 'connected' ? 'Athena connection confirmed' : 'Confirming during the read…');
        } else {
          stepUpsert('conn', 'Checking Athena connection', 'fail', 'MLS Assist did not answer — load/enable the extension, then Retry.', retryLastPull);
          srcSet('athena', 'fail', 'MLS Assist not detected');
          store.next = 'Enable the MLS Assist extension, then click Retry.';
          renderNext();
        }
      });
      var out;
      try { out = orig.apply(this, arguments); }
      catch (err) {
        stepUpsert('parse', 'Pulling appointment data', 'fail', 'The pull crashed: ' + String(err && err.message || err).slice(0, 120), retryLastPull);
        srcSet('pull', 'fail', 'Pull crashed');
        pullBusy.active = false;
        throw err;
      }
      armPullCompletionWatch();
      return out;
    };
    w.__scWrapped = VERSION;
    W.pullScheduleViaAssist = w;
    remember(function () { safe(function () { if (W.pullScheduleViaAssist === w) W.pullScheduleViaAssist = orig; }); });
    return true;
  }

  /* ---- pull completion: watch the app's own status line + backend + DOM --- */
  var heroWatch = { armed: false, node: null };
  function armPullCompletionWatch() {
    // watch DOM areas so "updated" is EVIDENCE, not hope
    watchArea('calendar', ['#calDayPanel', '#calendarView', '[id*="calendar" i]'], 'Updating MLS calendar', 'Calendar updated with the pulled visits', 'Calendar did not update, refreshing appointment data');
    watchArea('selector', ['#patientSelect', '#patientPicker', '[id*="patientsel" i]', '[id*="patientpick" i]'], 'Updating patient selector', 'Patient selector updated', 'Patient selector did not refresh — switch views once if a patient is missing');
    watchArea('easy', ['#mlsEasy', '[id*="mlseasy" i]', '[id*="easyview" i]'], 'Updating MLS Easy', 'MLS Easy updated', 'MLS Easy did not receive patient, retrying sync');
    watchWhosNext();
    hookHero(0);
  }
  function hookHero(tries) {
    var st = $id('heroPullStatus');
    if (heroWatch.armed) return;
    if (!st) { if ((tries || 0) < 12) later(1200, function () { hookHero((tries || 0) + 1); }); return; }
    heroWatch.armed = true; heroWatch.node = st;
    var mo = observe(st, function () {
      var txt = String(st.textContent || '').trim();
      if (!txt) return;
      mirrorHero(txt);
    }, { childList: true, characterData: true, subtree: true });
    remember(function () { heroWatch.armed = false; });
  }
  var lastHero = '';
  function mirrorHero(txt) {
    if (txt === lastHero) return;
    lastHero = txt;
    // date lines from the app's own honest status (e.g. "…for Wed, Jul 1")
    safe(function () {
      var m = txt.match(/for\s+((Mon|Tue|Wed|Thu|Fri|Sat|Sun)[a-z]*,?\s+)?((Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2})(,?\s*\d{4})?/i);
      if (m && m[3]) { taskMeta({ date: m[3] }); stepUpsert('day', 'Reading visits for ' + m[3], 'running', ''); }
    });
    var fin = /✅|Finished|already on your calendar|No new appointments found/i.test(txt);
    var bad = /isn['’]t responding|Couldn['’]t|failed|try again|OLDER version|not connected/i.test(txt);
    if (fin) {
      stepUpsert('parse', 'Pulling appointment data', 'done', '');
      var dayStep = findStep('day'); if (dayStep && dayStep.state === 'running') dayStep.state = 'done';
      stepUpsert('missing', 'Checking for missing visits', 'done', 'Compared the pulled day against your calendar.');
      stepUpsert('fin', 'Finished pulling Athena data', 'done', txt.slice(0, 160));
      srcSet('pull', 'ok', 'Finished pulling Athena data');
      var mm = txt.match(/(\d+)\s+(new\s+)?(patients?|appointments?|visits?)/i);
      addChange(mm ? ('Calendar: ' + mm[0] + ' from athenaOne.') : ('Pull finished: ' + txt.slice(0, 120)));
      store.next = 'Open the Calendar day to review the pulled visits.';
      taskFinish(txt.slice(0, 160), 'ok');
      pullBusy.active = false;
    } else if (bad) {
      stepUpsert('parse', 'Pulling appointment data', 'fail', txt.slice(0, 160), retryLastPull);
      srcSet('pull', 'fail', txt.slice(0, 90));
      store.next = /sign.?in|connect/i.test(txt) ? 'Open the athenaOne tab and sign in, then click Retry.' : 'Click Retry, or open the athenaOne tab once to wake it.';
      taskFinish(txt.slice(0, 160), 'fail');
      pullBusy.active = false;
    } else {
      stepUpsert('parse', 'Pulling appointment data', 'running', txt.slice(0, 160));
    }
    renderAll();
  }
  function watchArea(key, selectors, workingLabel, okLabel, warnLabel) {
    var node = null;
    for (var i = 0; i < selectors.length && !node; i++) safe(function () { node = document.querySelector(selectors[i]); });
    srcSet(key, 'working', workingLabel);
    if (!node) {
      later(DOM_CONFIRM_MS, function () { if (store.sources[key].state === 'working') srcSet(key, 'warn', 'Could not confirm on this screen — open that tab to verify.'); });
      return;
    }
    var fired = false;
    var mo = observe(node, function () {
      if (fired) return; fired = true;
      srcSet(key, 'ok', okLabel);
      stepUpsert('upd_' + key, okLabel, 'done', '');
      safe(function () { mo.disconnect(); });
    }, { childList: true, subtree: true });
    later(DOM_CONFIRM_MS, function () {
      if (!fired) {
        srcSet(key, 'warn', warnLabel);
        stepUpsert('upd_' + key, warnLabel, 'retry', 'No visible change yet — it may update when you open that view.');
      }
    });
  }
  function watchWhosNext() {
    var node = null;
    safe(function () {
      var cands = document.querySelectorAll('[id*="whosnext" i], [class*="whosnext" i], [class*="whos-next" i]');
      if (cands.length) node = cands[0];
      if (!node) { // heuristic: a heading that says "Who's Next"
        var hs = document.querySelectorAll('h1,h2,h3,h4,.card-title,[class*="title" i]');
        for (var i = 0; i < hs.length; i++) if (/who'?s\s+next/i.test(hs[i].textContent || '')) { node = hs[i].parentElement || hs[i]; break; }
      }
    });
    srcSet('matching', 'working', 'Matching pulled visits to your patients');
    if (!node) { later(DOM_CONFIRM_MS, function () { if (store.sources.matching.state === 'working') srcSet('matching', 'warn', 'Could not confirm on this screen — open Who’s Next to verify.'); }); return; }
    var fired = false;
    var mo = observe(node, function () {
      if (fired) return; fired = true;
      srcSet('matching', 'ok', 'Who’s Next updated');
      stepUpsert('upd_wn', 'Updating Who’s Next', 'done', '');
      safe(function () { mo.disconnect(); });
    }, { childList: true, subtree: true });
    later(DOM_CONFIRM_MS, function () { if (!fired) srcSet('matching', 'warn', 'Who’s Next shows older data — pull again or open it to refresh.'); });
  }

  /* =====================================================================
   * SECTION E — BACKEND SYNC OBSERVER (real fetch outcomes; no bodies)
   * =================================================================== */
  function wrapFetch() {
    var orig = W.fetch;
    if (!isFn(orig) || orig.__scWrapped) return;
    var w = function (input, init) {
      var url = '';
      safe(function () { url = typeof input === 'string' ? input : (input && input.url) || ''; });
      var isBackend = /scrivara-backend\.onrender\.com/i.test(url) || (/^\/?api\//i.test(String(url).replace(/^https?:\/\/[^/]+/i, '').replace(/^\//, '')));
      var method = 'GET';
      safe(function () { method = ((init && init.method) || (input && input.method) || 'GET').toUpperCase(); });
      var path = '';
      if (isBackend) {
        safe(function () { path = String(url).replace(/^https?:\/\/[^/]+/i, '').split('?')[0].slice(0, 80); });
        if (method !== 'GET') srcSet('backend', 'working', 'Syncing with the MLS backend… (' + method + ' ' + path + ')');
      }
      var p = orig.apply(this, arguments);
      if (isBackend && method !== 'GET') {
        p.then(function (res) {
          safe(function () {
            if (res && res.ok) srcSet('backend', 'ok', 'Backend saved (' + method + ' ' + path + ' → HTTP ' + res.status + ')');
            else srcSet('backend', 'fail', 'Backend rejected ' + method + ' ' + path + ' (HTTP ' + (res && res.status) + ')');
          });
        }, function () { srcSet('backend', 'fail', 'Network error talking to the MLS backend'); });
      }
      return p;
    };
    w.__scWrapped = VERSION;
    W.fetch = w;
    remember(function () { safe(function () { if (W.fetch === w) W.fetch = orig; }); });
  }

  /* =====================================================================
   * SECTION F — WRITEBACK READINESS (report-only; never initiates)
   * =================================================================== */
  function refreshWritebackReadiness() {
    var connected = conn.verdict === 'connected';
    var wb = safe(function () { return W.__mlsAthenaWriteback; }, null);
    var hasPatient = !!(lastPatientShown || safe(function () { return (W.activePatient && (W.activePatient.name || W.activePatient.display)) || document.querySelector('[data-active-patient]'); }, null));
    if (!connected) { srcSet('writeback', 'warn', 'Not ready — athenaOne connection is ' + (conn.verdict === 'checking' ? 'still being checked' : 'down') + '.'); return; }
    if (!wb) { srcSet('writeback', 'idle', 'Write-back module not on this screen.'); return; }
    if (!hasPatient) { srcSet('writeback', 'warn', 'Not ready — no active patient loaded.'); return; }
    srcSet('writeback', 'ok', 'Ready — every write still needs your explicit approval.');
  }
  every(20000, refreshWritebackReadiness);

  /* =====================================================================
   * SECTION G — DOCK UI
   * =================================================================== */
  var ui = { dock: null, minimized: safe(function () { return localStorage.getItem('mlsScMin') === '1'; }, false) };
  function addStyles() {
    if ($id(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '#' + DOCK_ID + '{position:fixed;right:14px;bottom:96px;width:334px;z-index:2147481000;font:500 12.5px/1.45 system-ui,Segoe UI,Roboto,sans-serif;color:#1A211C;pointer-events:auto}' +
      '#' + DOCK_ID + ' *{box-sizing:border-box}' +
      '#' + DOCK_ID + ' .sc-card{background:#FFFFFF;border:1px solid #E7E5DD;border-radius:14px;box-shadow:0 1px 2px rgba(20,33,28,.04),0 18px 44px -18px rgba(20,33,28,.25);overflow:hidden;backdrop-filter:blur(6px)}' +
      '#' + DOCK_ID + ' .sc-head{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none;min-height:38px}' +
      '#' + DOCK_ID + ' .sc-dot{width:11px;height:11px;border-radius:50%;flex:0 0 11px;background:#79837C;transition:background .25s}' +
      '#' + DOCK_ID + ' .sc-dot.ok{background:#2E6A4B}#' + DOCK_ID + ' .sc-dot.bad{background:#B23B3B}' +
      '#' + DOCK_ID + ' .sc-dot.chk{background:#B07636;animation:mlsscpulse 1.1s ease-in-out infinite}' +
      '@keyframes mlsscpulse{0%,100%{opacity:1}50%{opacity:.35}}' +
      '#' + DOCK_ID + ' .sc-title{font-weight:800;font-size:12.5px;letter-spacing:.3px;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#' + DOCK_ID + ' .sc-min{opacity:.75;padding:2px 6px;border-radius:6px;font-weight:800}' +
      '#' + DOCK_ID + ' .sc-min:hover{background:#F2F0E9}' +
      '#' + DOCK_ID + ' .sc-body{padding:0 12px 10px;display:block}' +
      '#' + DOCK_ID + '.sc-mini .sc-body{display:none}' +
      '#' + DOCK_ID + ' .sc-task{font-weight:800;font-size:13px;min-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#' + DOCK_ID + ' .sc-meta{opacity:.85;font-size:11.5px;min-height:17px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#' + DOCK_ID + ' .sc-steps{margin:7px 0 0;max-height:168px;overflow-y:auto;overflow-x:hidden;border-top:1px dashed #EFEDE6;padding-top:6px}' +
      '#' + DOCK_ID + ' .sc-step{display:flex;gap:7px;align-items:flex-start;padding:2.5px 0;min-height:21px}' +
      '#' + DOCK_ID + ' .sc-ic{flex:0 0 15px;width:15px;text-align:center;font-weight:900;font-size:11.5px;line-height:17px}' +
      '#' + DOCK_ID + ' .sc-ic.done{color:#2E6A4B}#' + DOCK_ID + ' .sc-ic.fail{color:#B23B3B}#' + DOCK_ID + ' .sc-ic.retry{color:#B07636}' +
      '#' + DOCK_ID + ' .sc-ic.run{color:#204034}' +
      '#' + DOCK_ID + ' .sc-ic.run .sc-spin{display:inline-block;width:10px;height:10px;border-radius:50%;border:2px solid #E7E5DD;border-top-color:#204034;animation:mlsscspin .8s linear infinite;vertical-align:1px}' +
      '@keyframes mlsscspin{to{transform:rotate(360deg)}}' +
      '#' + DOCK_ID + ' .sc-lb{flex:1;min-width:0}' +
      '#' + DOCK_ID + ' .sc-lb .l{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#' + DOCK_ID + ' .sc-lb .d{opacity:.7;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#' + DOCK_ID + ' .sc-lb .l,#' + DOCK_ID + ' .sc-lb .d{display:block}' +
      '#' + DOCK_ID + ' .sc-rt{flex:0 0 auto;background:#204034;color:#fff;border:0;border-radius:7px;padding:2px 8px;font-size:11px;font-weight:800;cursor:pointer}' +
      '#' + DOCK_ID + ' .sc-srcs{display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;margin-top:8px;border-top:1px dashed #EFEDE6;padding-top:6px}' +
      '#' + DOCK_ID + ' .sc-src{display:flex;gap:6px;align-items:center;min-height:18px;font-size:11px}' +
      '#' + DOCK_ID + ' .sc-src .b{width:7px;height:7px;border-radius:50%;flex:0 0 7px;background:#79837C}' +
      '#' + DOCK_ID + ' .sc-src .b.ok{background:#2E6A4B}#' + DOCK_ID + ' .sc-src .b.fail{background:#B23B3B}' +
      '#' + DOCK_ID + ' .sc-src .b.warn{background:#B07636}#' + DOCK_ID + ' .sc-src .b.working{background:#204034;animation:mlsscpulse 1.1s ease-in-out infinite}' +
      '#' + DOCK_ID + ' .sc-src .t{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.92}' +
      '#' + DOCK_ID + ' .sc-block{margin-top:8px;border-top:1px dashed #EFEDE6;padding-top:6px}' +
      '#' + DOCK_ID + ' .sc-block .h{font-weight:800;font-size:11px;letter-spacing:.4px;opacity:.75;text-transform:uppercase}' +
      '#' + DOCK_ID + ' .sc-block .c{font-size:11.5px;margin-top:2px}' +
      '#' + DOCK_ID + ' .sc-block .c div{padding:1px 0}' +
      '#' + DOCK_ID + ' .sc-foot{display:flex;gap:6px;margin-top:9px}' +
      '#' + DOCK_ID + ' .sc-btn{flex:1;background:#fff;border:1px solid #D9D6CD;color:#1A211C;border-radius:8px;padding:5px 6px;font-size:11.5px;font-weight:800;cursor:pointer;white-space:nowrap}' +
      '#' + DOCK_ID + ' .sc-btn:hover{background:#F2F0E9}' +
      '#' + DOCK_ID + ' .sc-btn.pri{background:#204034;color:#fff;border-color:#204034}' +
      /* de-dupe while the dock is live: the two duplicate floating surfaces */
      'body.mls-sc-live #mlsFpPullCard{display:none !important}' +
      'body.mls-sc-live .mlsux-mirror{display:none !important}';
    (document.head || document.documentElement).appendChild(st);
    remember(function () { safe(function () { var n = $id(STYLE_ID); if (n) n.remove(); }); });
  }
  function buildDock() {
    if ($id(DOCK_ID)) return $id(DOCK_ID);
    var d = document.createElement('div');
    d.id = DOCK_ID;
    if (ui.minimized) d.className = 'sc-mini';
    d.innerHTML =
      '<div class="sc-card">' +
        '<div class="sc-head" title="MLS status — click to expand/collapse">' +
          '<span class="sc-dot chk"></span>' +
          '<span class="sc-title">Checking Athena connection…</span>' +
          '<span class="sc-min">–</span>' +
        '</div>' +
        '<div class="sc-body">' +
          '<div class="sc-task">Idle — no task running</div>' +
          '<div class="sc-meta"></div>' +
          '<div class="sc-steps" role="status" aria-live="polite"></div>' +
          '<div class="sc-srcs"></div>' +
          '<div class="sc-block sc-chg" style="display:none"><div class="h">What changed in MLS Scribe</div><div class="c"></div></div>' +
          '<div class="sc-block sc-nxt" style="display:none"><div class="h">What to do next</div><div class="c"></div></div>' +
          '<div class="sc-foot">' +
            '<button type="button" class="sc-btn pri" data-act="recheck">Recheck connection</button>' +
            '<button type="button" class="sc-btn" data-act="retry">Retry last failure</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(d);
    ui.dock = d;
    document.body.classList.add('mls-sc-live');
    listen(d.querySelector('.sc-head'), 'click', function () {
      ui.minimized = !ui.minimized;
      d.classList.toggle('sc-mini', ui.minimized);
      safe(function () { localStorage.setItem('mlsScMin', ui.minimized ? '1' : '0'); });
    });
    listen(d, 'click', function (e) {
      var b = e.target && e.target.closest ? e.target.closest('button') : null;
      if (!b) return;
      e.stopPropagation();
      var act = b.getAttribute('data-act');
      if (act === 'recheck') { setVerdict('checking', 'checking', 'Checking Athena connection'); probeConnection(true); }
      if (act === 'retry') {
        var target = null;
        for (var i = store.steps.length - 1; i >= 0; i--) if ((store.steps[i].state === 'fail' || store.steps[i].state === 'retry') && store.steps[i].retryFn) { target = store.steps[i]; break; }
        if (target) { target.state = 'running'; target.at = now(); target.detail = 'Retrying…'; renderSteps(); safe(target.retryFn); }
        else if (lastPullArgs) retryLastPull();
      }
    });
    remember(function () {
      safe(function () { var n = $id(DOCK_ID); if (n) n.remove(); });
      safe(function () { document.body.classList.remove('mls-sc-live'); });
    });
    return d;
  }
  function dockShow(expand) {
    if (!ui.dock) return;
    if (expand && ui.minimized) {
      ui.minimized = false;
      ui.dock.classList.remove('sc-mini');
      safe(function () { localStorage.setItem('mlsScMin', '0'); });
    }
  }

  function renderConn() {
    if (!ui.dock) return;
    var dot = ui.dock.querySelector('.sc-dot');
    var title = ui.dock.querySelector('.sc-title');
    if (!dot || !title) return;
    var v = conn.verdict;
    dot.className = 'sc-dot ' + (v === 'connected' ? 'ok' : (v === 'checking' ? 'chk' : 'bad'));
    var label;
    if (v === 'connected') label = 'athenaOne connected';
    else if (v === 'checking') label = conn.probing && conn.attempt > 1 ? ('Checking Athena connection… (attempt ' + conn.attempt + '/' + conn.attemptsMax + ')') : 'Checking Athena connection…';
    else label = conn.detailStatus === 'no-extension' ? 'MLS Assist not detected' : 'athenaOne not connected';
    if (store.task && !store.task.finishedAt) label = store.task.label + ' — ' + label;
    title.textContent = label;
    title.title = conn.reason || label;
    srcSet('athena', v === 'connected' ? 'ok' : (v === 'checking' ? 'working' : 'fail'),
      v === 'connected' ? 'Athena connection confirmed' : (v === 'checking' ? 'Checking Athena connection' : (conn.detailStatus === 'no-extension' ? 'MLS Assist not detected' : 'No signed-in athenaOne tab')));
  }
  function renderTask() {
    if (!ui.dock) return;
    var t = ui.dock.querySelector('.sc-task');
    var m = ui.dock.querySelector('.sc-meta');
    if (!t || !m) return;
    if (!store.task) { t.textContent = 'Idle — no task running'; m.textContent = ''; return; }
    var running = !store.task.finishedAt;
    t.textContent = (running ? '' : (store.task.outcomeKind === 'fail' ? '✗ ' : '✓ ')) + store.task.label;
    var bits = [];
    if (store.task.patient) bits.push('Patient: ' + store.task.patient);
    if (store.task.date) bits.push('Day: ' + store.task.date);
    bits.push('Source: ' + store.task.source);
    m.textContent = bits.join('  ·  ');
    m.title = m.textContent;
  }
  function renderSteps() {
    if (!ui.dock) return;
    var box = ui.dock.querySelector('.sc-steps');
    if (!box) return;
    var html = '';
    for (var i = 0; i < store.steps.length; i++) {
      var s = store.steps[i];
      var ic, cls;
      if (s.state === 'done') { ic = '✓'; cls = 'done'; }
      else if (s.state === 'fail') { ic = '✗'; cls = 'fail'; }
      else if (s.state === 'retry') { ic = '↻'; cls = 'retry'; }
      else if (s.state === 'slow') { ic = '<span class="sc-spin"></span>'; cls = 'run'; }
      else if (s.state === 'running') { ic = '<span class="sc-spin"></span>'; cls = 'run'; }
      else { ic = '·'; cls = ''; }
      html += '<div class="sc-step" data-i="' + i + '">' +
        '<span class="sc-ic ' + cls + '">' + ic + '</span>' +
        '<span class="sc-lb"><span class="l" title="' + esc(s.label) + '">' + esc(s.label) + '</span>' +
        (s.detail ? '<span class="d" title="' + esc(s.detail) + '">' + esc(s.detail) + '</span>' : '') + '</span>' +
        ((s.state === 'fail' || s.state === 'retry') && s.retryFn ? '<button type="button" class="sc-rt" data-retry="' + i + '">Retry</button>' : '') +
        '</div>';
    }
    if (!html) html = '<div class="sc-step"><span class="sc-ic">·</span><span class="sc-lb"><span class="l" style="opacity:.6">Steps will appear here when a task runs.</span></span></div>';
    if (box.__scSig === html) return;   // sig-guard: identical steps = leave the DOM (and its spinners) alone
    box.__scSig = html;
    box.innerHTML = html;
    var btns = box.querySelectorAll('[data-retry]');
    for (var b = 0; b < btns.length; b++) {
      (function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var st = store.steps[parseInt(btn.getAttribute('data-retry'), 10)];
          if (st && st.retryFn) { st.state = 'running'; st.at = now(); st.detail = 'Retrying…'; renderSteps(); safe(st.retryFn); }
        });
      })(btns[b]);
    }
    box.scrollTop = box.scrollHeight;
  }
  function renderSources() {
    if (!ui.dock) return;
    var box = ui.dock.querySelector('.sc-srcs');
    if (!box) return;
    var html = '';
    for (var i = 0; i < SOURCES.length; i++) {
      var k = SOURCES[i][0], lbl = SOURCES[i][1], s = store.sources[k];
      html += '<div class="sc-src" title="' + esc(lbl + ': ' + s.text) + '"><span class="b ' + esc(s.state) + '"></span><span class="t">' + esc(lbl) + '</span></div>';
    }
    /* sig-guard (live-caught b414): heartbeat updates re-rendered identical
       HTML ~2x/sec, destroying/recreating every node — visible flicker and
       the pulse animation restarting. Only touch the DOM on real change. */
    if (box.__scSig === html) return;
    box.__scSig = html;
    box.innerHTML = html;
  }
  function renderChanges() {
    if (!ui.dock) return;
    var blk = ui.dock.querySelector('.sc-chg');
    if (!blk) return;
    var c = blk.querySelector('.c');
    if (!store.changes.length) { blk.style.display = 'none'; return; }
    blk.style.display = '';
    var html = '';
    for (var i = 0; i < store.changes.length; i++) html += '<div>• ' + esc(store.changes[i]) + '</div>';
    if (c.__scSig !== html) { c.__scSig = html; c.innerHTML = html; }
  }
  function renderNext() {
    if (!ui.dock) return;
    var blk = ui.dock.querySelector('.sc-nxt');
    if (!blk) return;
    if (!store.next) { blk.style.display = 'none'; return; }
    blk.style.display = '';
    blk.querySelector('.c').textContent = store.next;
  }
  function renderAll() { renderConn(); renderTask(); renderSteps(); renderSources(); renderChanges(); renderNext(); }

  /* =====================================================================
   * SECTION H — PERSISTENCE (PHI-free snapshot; survive reloads honestly)
   * =================================================================== */
  var persistT = 0;
  function persist() {
    if (persistT) return;
    persistT = later(500, function () {
      persistT = 0;
      safe(function () {
        var snap = {
          v: VERSION, at: now(),
          conn: { verdict: conn.verdict, detailStatus: conn.detailStatus, lastConnectedAt: conn.lastConnectedAt },
          task: store.task ? { label: store.task.label, source: store.task.source, date: store.task.date, startedAt: store.task.startedAt, finishedAt: store.task.finishedAt, outcome: scrubPHI(store.task.outcome || ''), outcomeKind: store.task.outcomeKind || '' } : null,
          steps: store.steps.slice(-14).map(function (s) { return { id: s.id, label: scrubPHI(s.label), state: s.state, detail: scrubPHI(s.detail || '') }; }),
          changes: store.changes.slice(-6).map(scrubPHI),
          next: scrubPHI(store.next || '')
        };
        sessionStorage.setItem(SS_KEY, JSON.stringify(snap));
      });
    });
  }
  function scrubPHI(s) {
    s = String(s == null ? '' : s);
    if (lastPatientShown && lastPatientShown.length > 2) { while (s.indexOf(lastPatientShown) !== -1) s = s.replace(lastPatientShown, '(patient)'); }
    return s.replace(/Loading patient:\s*[^—·]+/gi, 'Loading patient: (patient)')
            .replace(/\bfor\s+[A-Z][a-z]+\s+[A-Z]\s+[A-Z][A-Za-z'-]+\b/g, 'for (patient)');
  }
  function restore() {
    var snap = safe(function () { return JSON.parse(sessionStorage.getItem(SS_KEY) || 'null'); }, null);
    if (!snap || !snap.at || (now() - snap.at) > 1800000) return;
    if (snap.task) {
      store.task = { id: 'restored', label: snap.task.label, source: snap.task.source || 'athenaOne', startedAt: snap.task.startedAt || now(), patient: '', date: snap.task.date || '', finishedAt: snap.task.finishedAt || 0, outcome: snap.task.outcome || '', outcomeKind: snap.task.outcomeKind || '' };
      store.steps = [];
      for (var i = 0; i < (snap.steps || []).length; i++) {
        var s = snap.steps[i];
        var interrupted = (s.state === 'running' || s.state === 'slow') && !snap.task.finishedAt;
        store.steps.push({ id: s.id, label: s.label, state: interrupted ? 'retry' : s.state, detail: interrupted ? 'Interrupted by the page reload — run it again if needed.' : (s.detail || ''), at: now(), retryFn: interrupted ? retryLastPull : null });
      }
      if (!snap.task.finishedAt) {
        store.next = 'This page reloaded while a task was running. The task did not survive the reload — start it again when ready.';
        store.task.finishedAt = now();
        store.task.outcome = 'Interrupted by page reload.';
        store.task.outcomeKind = 'fail';
      } else {
        store.next = snap.next || '';
      }
      store.changes = snap.changes || [];
    }
    if (snap.conn && snap.conn.lastConnectedAt) conn.lastConnectedAt = snap.conn.lastConnectedAt;
  }

  /* =====================================================================
   * SECTION I — NARRATION FEED (reuse the honest narrator when present)
   * =================================================================== */
  function hookNarration() {
    var nar = W.__mlsAthenaNarration;
    if (!nar || !isFn(nar.onNarrate)) return;
    var un = safe(function () {
      return nar.onNarrate(function (line) {
        var txt = String((line && line.text) || line || '').trim();
        if (!txt || txt === lastHero) return;
        if (store.task && !store.task.finishedAt) stepUpsert('nar_' + (txt.length % 7), txt.slice(0, 140), 'done', '');
      });
    }, null);
    if (isFn(un)) remember(un);
  }

  /* =====================================================================
   * BOOT (app pages only; marketing page stays untouched)
   * =================================================================== */
  var bootTries = 0;
  function boot() {
    bootTries++;
    var appish = $id('heroPullStatus') || document.querySelector('.mlscp-pulls, [id*="calendarView" i], #mlsAsstFab');
    if (!appish) {
      if (bootTries < 40) { later(1500, boot); }
      return; // never render on the marketing/login page
    }
    addStyles();
    buildDock();
    restore();
    wrapConnTruth();
    wrapPull();
    wrapFetch();
    hookNarration();
    renderAll();
    // seed the verdict from any current truth, then verify with evidence rules
    safe(function () {
      var cur = ctWrap.orig && ctWrap.orig.stateVal;
      if (cur && cur.status === 'connected' && cur.at && (now() - cur.at) < EVIDENCE_TTL_MS) {
        conn.evidence.probeOk = cur.at;
        setVerdict('connected', 'connected', String(cur.reason || 'athenaOne connected.'));
      }
    });
    probeConnection(true);
    every(POLL_MS, backgroundReverdict);
    listen(W, 'focus', function () { later(400, function () { backgroundReverdict(); }); });
    listen(document, 'visibilitychange', function () { if (document.visibilityState === 'visible') later(400, backgroundReverdict); });
    every(2500, correctLegacySurfaces);
    every(30000, function () { if (!ctWrap.done) wrapConnTruth(); if (!isFn(W.pullScheduleViaAssist) || !W.pullScheduleViaAssist.__scWrapped) wrapPull(); });
  }

  /* =====================================================================
   * PUBLIC API + REVERT
   * =================================================================== */
  W.__mlsStatusCenter = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    // read-only views (no PHI in these snapshots beyond what is on screen)
    getState: function () { return { conn: connPublicState(), task: store.task, steps: store.steps.slice(), sources: store.sources, changes: store.changes.slice(), next: store.next }; },
    // programmatic status API for other modules (additive; safe no-ops on bad input)
    begin: function (label, source) { safe(function () { taskBegin(String(label || 'Working…').slice(0, 90), String(source || 'MLS').slice(0, 60)); }); },
    step: function (id, label) { safe(function () { stepUpsert(String(id).slice(0, 40), String(label).slice(0, 140), 'running', ''); }); },
    stepDone: function (id, detail) { safe(function () { stepUpsert(String(id).slice(0, 40), null, 'done', String(detail || '').slice(0, 160)); }); },
    stepFail: function (id, detail, retryFn) { safe(function () { stepUpsert(String(id).slice(0, 40), null, 'fail', String(detail || '').slice(0, 160), isFn(retryFn) ? retryFn : null); }); },
    finish: function (outcome, kind) { safe(function () { taskFinish(String(outcome || 'Done.').slice(0, 160), kind === 'fail' ? 'fail' : 'ok'); }); },
    blocked: function (action, why) { safe(function () { blockedAction(String(action || 'action').slice(0, 90), String(why || 'Blocked by a safety rule.').slice(0, 160)); }); },
    setSource: function (key, state, text) { safe(function () { srcSet(String(key), String(state), String(text || '').slice(0, 120)); }); },
    note: function (line) { safe(function () { addChange(String(line || '').slice(0, 160)); }); },
    recheck: function () { return probeConnection(true); },
    _conn: conn,           // introspection for tests
    _classify: classifyScheduleReply,
    _scrub: scrubPHI,
    revert: function () {
      for (var i = cleanups.length - 1; i >= 0; i--) safe(cleanups[i]);
      for (var t = 0; t < timers.length; t++) safe(function () { clearInterval(timers[t]); });
      for (var o = 0; o < timeouts.length; o++) safe(function () { clearTimeout(timeouts[o]); });
      for (var m = 0; m < observers.length; m++) safe(function () { observers[m].disconnect(); });
      safe(function () { sessionStorage.removeItem(SS_KEY); });
      W.__mlsStatusCenter.installed = false;
    }
  };

  if (document.readyState === 'loading') listen(document, 'DOMContentLoaded', function () { later(300, boot); });
  else later(300, boot);
})();
