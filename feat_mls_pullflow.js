/* ============================================================================
 * feat_mls_pullflow.js  —  window.__mlsPullFlow  (pf-1.0.0)
 * ----------------------------------------------------------------------------
 * "Getting today's patients ready…" — never an endless loading state.
 *
 * WHAT THIS IS (and is NOT):
 *   This is an ADDITIVE, REVERSIBLE app-side satellite. It sits ON TOP of the
 *   app's already-bounded pull flow (Layer A pullScheduleViaAssist() 30s hard
 *   timeout + Layer B EZ3 startTodayPull() 120s cap) and gives the doctor a
 *   state-driven progress + recovery + debug surface. It:
 *     • OBSERVES app-side signals only (#heroPullStatus text/colour, the EZ3
 *       loadcard, window.__mlsEasyV32.state(), window.__mlsConnTruth,
 *       window.__schedRaw, the once-per-day sessionStorage guard).
 *     • CLASSIFIES the detected state into the 11 workflow steps and picks the
 *       next safe action (state-driven, not a fragile fixed sequence).
 *     • EARLY-ABORTS the perceived "endless spinner": the moment Layer A writes
 *       a definitive error into #heroPullStatus (seconds), we stop showing the
 *       spinner and show a clear terminal card — instead of spinning up to 120s.
 *     • Offers explicit Retry / Cancel / Restart actions, passive status on
 *       refresh, and a "What happened?" debug panel.
 *
 *   It does NOT change what the extension does, does NOT add/alter any mlsApp*
 *   bridge, and does NOT touch athenaOne. The extension is permanently frozen
 *   and Athena is immutable/off-limits (README.md / DO_NOT_CHANGE_THE_EXTENSION).
 *   Recovery actions call ONLY existing app entry points
 *   (window.pullScheduleViaAssist / window.__mlsEasyV32).
 *
 *   HONESTY about the extension boundary: steps 4-6 (open calendar / select
 *   provider / navigate to date) happen INSIDE the frozen extension's schedule
 *   reader and are opaque to the app — the app posts mlsAppPullSchedule and
 *   waits for one reply. We therefore group 4-6 as "MLS Assist is reading
 *   athenaOne" and advance them together when the reply arrives; we never
 *   fabricate per-step progress we cannot observe.
 *
 * Revert:  window.__mlsPullFlow.revert()
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsPullFlow) return;
  var VER = 'pf-1.1.0';

  /* ---- tiny helpers -------------------------------------------------------- */
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }
  function esc(s) {
    s = (s == null ? '' : String(s));
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function nowMs() { try { return new Date().getTime(); } catch (e) { return 0; } }
  function todayKey() {
    try {
      var d = new Date();
      return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
    } catch (e) { return 'na'; }
  }
  function ss(k, v) {
    try {
      if (v === undefined) { var r = sessionStorage.getItem(k); return r; }
      if (v === null) { sessionStorage.removeItem(k); return null; }
      sessionStorage.setItem(k, v); return v;
    } catch (e) { return null; }
  }

  /* ---- the 11 workflow steps (spec order) ---------------------------------- */
  /* group: 'ext' | 'athena' | 'read' | 'patients' | 'ready'
     ext-opaque steps (open calendar / select provider / navigate date) are
     flagged extOpaque so the UI states honestly that MLS Assist handles them. */
  var STEPS = [
    { key: 'ext',       label: 'Checking MLS Assist connection',      group: 'ext' },
    { key: 'avail',     label: 'Checking athenaOne availability',     group: 'athena' },
    { key: 'login',     label: 'Checking athenaOne sign-in',          group: 'athena' },
    { key: 'calendar',  label: 'Opening the calendar',                group: 'read', extOpaque: true },
    { key: 'provider',  label: 'Selecting the provider',              group: 'read', extOpaque: true },
    { key: 'date',      label: 'Navigating to the date',              group: 'read', extOpaque: true },
    { key: 'appts',     label: 'Reading appointments',                group: 'read' },
    { key: 'match',     label: 'Matching patients',                   group: 'patients' },
    { key: 'details',   label: 'Loading patient details',             group: 'patients' },
    { key: 'prepare',   label: 'Preparing MLS Easy',                  group: 'ready' },
    { key: 'ready',     label: 'Ready',                               group: 'ready' }
  ];
  function stepIndex(key) { for (var i = 0; i < STEPS.length; i++) if (STEPS[i].key === key) return i; return -1; }

  /* step statuses: waiting | running | completed | attention | retrying | failed */

  /* ---- terminal classification -------------------------------------------- */
  /* kind: 'ext-missing' | 'ext-outdated' | 'signed-out' | 'wrong-page' |
           'empty-schedule' | 'parse-fail' | 'timeout' | 'generic'            */
  var TERMINAL_COPY = {
    'ext-missing': {
      title: 'MLS Assist isn’t responding',
      body: 'MLS couldn’t reach the MLS Assist browser extension. No athenaOne data was accessed, and nothing in your records was written or changed.',
      hint: 'Make sure MLS Assist is installed and enabled, and that your athenaOne tab is open — then retry.',
      retry: 'Retry',
      transient: true
    },
    'ext-outdated': {
      title: 'MLS Assist needs updating',
      body: 'Your MLS Assist extension is an older version that can’t read the schedule yet. No data was accessed, and nothing was written or changed.',
      hint: 'Update it from Settings → Download MLS Assist (latest), reload this page, then retry.',
      retry: 'Retry',
      transient: false
    },
    'signed-out': {
      title: 'athenaOne sign-in required',
      body: 'MLS couldn’t read your athenaOne schedule. The most common cause is that athenaOne isn’t open and signed in. <b>No patient data was accessed, and nothing in your records was written or changed.</b>',
      hint: 'Open athenaOne in another tab, sign in, then use “Retry after signing in”. Your place in the workflow is saved — it will pick up where it left off.',
      retry: 'Retry after signing in',
      transient: false
    },
    'wrong-page': {
      title: 'athenaOne isn’t on the Day schedule',
      body: 'MLS read your athenaOne tab but didn’t find a patient day schedule on it. No patient data was accessed, and nothing was written or changed.',
      hint: 'Open athenaOne’s DAY schedule (not the dashboard) with patients on it, then retry.',
      retry: 'Retry',
      transient: false
    },
    'empty-schedule': {
      title: 'No appointments on the day in view',
      body: 'athenaOne shows 0 appointments for the day currently in view. Nothing was written or changed.',
      hint: 'Open a clinic day that has patients in athenaOne’s Day view, then retry. If patients should be there, check the provider filter.',
      retry: 'Retry',
      transient: false
    },
    'parse-fail': {
      title: 'Couldn’t read the schedule',
      body: 'MLS reached athenaOne but couldn’t make sense of the schedule page. No patient data was filed, and nothing was written or changed.',
      hint: 'Open athenaOne’s Day schedule view and retry. If it keeps happening, use “What happened?” below and share the code with support.',
      retry: 'Retry',
      transient: false
    },
    'timeout': {
      title: 'The pull is taking too long',
      body: 'MLS didn’t get today’s patients back in time. No data was written or changed.',
      hint: 'Make sure athenaOne is open and signed in on its own tab, then retry.',
      retry: 'Retry',
      transient: true
    },
    'generic': {
      title: 'Couldn’t get today’s patients',
      body: 'Something interrupted the pull. No data was written or changed.',
      hint: 'Make sure athenaOne is open and signed in, then retry.',
      retry: 'Retry',
      transient: true
    }
  };

  /* ---- internal state ------------------------------------------------------ */
  var ST = {
    phase: 'idle',           /* idle | running | terminal | done | cancelled */
    stepKey: null,           /* current step */
    lastGoodKey: null,       /* last completed step */
    failedKey: null,         /* step that failed, if any */
    terminalKind: null,      /* one of TERMINAL_COPY keys when phase==='terminal' */
    retryCount: 0,
    autoRetried: false,
    dataAccessed: false,     /* did we ever get non-empty schedule text back? */
    lastStatus: '',          /* raw #heroPullStatus text */
    at: 0,
    code: ''
  };
  var tickIv = null, mo = null, statusMo = null, styleEl = null, cancelledThisCycle = false;

  var PKEY = function () { return 'mlsPullFlow.v1.' + todayKey(); };

  function persist() {
    try {
      ss(PKEY(), JSON.stringify({
        phase: ST.phase, stepKey: ST.stepKey, lastGoodKey: ST.lastGoodKey,
        failedKey: ST.failedKey, terminalKind: ST.terminalKind, retryCount: ST.retryCount,
        autoRetried: ST.autoRetried, dataAccessed: ST.dataAccessed, at: ST.at, code: ST.code
      }));
    } catch (e) {}
  }
  function restore() {
    try {
      var raw = ss(PKEY()); if (!raw) return;
      var o = JSON.parse(raw); if (!o) return;
      /* Only restore a *terminal* state on refresh — a "running" snapshot is
         stale after a reload (the in-page pull machinery is gone). Restoring
         status must never restart an Athena read. */
      if (o.phase === 'terminal') {
        ST.phase = 'terminal'; ST.terminalKind = o.terminalKind || 'generic';
        ST.stepKey = o.stepKey; ST.lastGoodKey = o.lastGoodKey; ST.failedKey = o.failedKey;
        ST.retryCount = o.retryCount || 0; ST.autoRetried = !!o.autoRetried;
        ST.dataAccessed = !!o.dataAccessed; ST.at = o.at || 0; ST.code = o.code || '';
      }
    } catch (e) {}
  }

  /* ---- signal readers (all app-side, all optional) ------------------------- */
  function heroStatus() {
    var el = $('heroPullStatus');
    if (!el) return { text: '', err: false, present: false };
    var text = (el.textContent || '').trim();
    var col = (el.style && el.style.color) || '';
    /* Layer A paints errors #ffe0e0 (rgb(255,224,224)) */
    var err = /255,\s*224,\s*224|#ffe0e0/i.test(col);
    return { text: text, err: err, present: true };
  }
  function ez3AutoPull() {
    try { var s = window.__mlsEasyV32 && window.__mlsEasyV32.state && window.__mlsEasyV32.state(); return s ? s.autoPull : null; }
    catch (e) { return null; }
  }
  function ez3Running() {
    /* the EZ3 "Getting today's patients ready…" loadcard is on screen */
    try {
      var cards = document.querySelectorAll('.ez3-loadcard');
      for (var i = 0; i < cards.length; i++) { if (cards[i].offsetParent !== null) return true; }
    } catch (e) {}
    return ez3AutoPull() === 'running';
  }
  function ez3Note() {
    /* Layer B (EZ3 120s cap) writes its honest failure note into #ez3LoadNote,
       NOT into #heroPullStatus — read it so a slow timeout is never masked. */
    var el = $('ez3LoadNote'); return el ? (el.textContent || '').trim() : '';
  }
  function connState() {
    try {
      var ct = window.__mlsConnTruth;
      if (ct && ct.state) return { status: ct.state.status || 'unknown', ext: !!ct.state.ext, tab: !!ct.state.tab, reason: ct.state.reason || '' };
      if (ct && isFn(ct.describe)) { var d = ct.describe(); if (d) return { status: d.status || 'unknown', ext: !!d.ext, tab: !!d.tab, reason: d.reason || '' }; }
    } catch (e) {}
    return null;
  }
  function selectedProvider() {
    try { var el = $('ez3Prov') || $('calProvFilter'); if (el && el.value) return el.options && el.selectedIndex >= 0 ? el.options[el.selectedIndex].text : el.value; } catch (e) {}
    return 'All providers';
  }
  function schedRaw() { try { return window.__schedRaw || null; } catch (e) { return null; } }
  function todayCount() {
    /* best-effort read of how many of today's patients are loaded */
    try {
      var s = window.__mlsEasyV32 && window.__mlsEasyV32.remote && window.__mlsEasyV32.remote.snapshot && window.__mlsEasyV32.remote.snapshot();
      if (s && s.today) return s.today.length;
    } catch (e) {}
    return null;
  }
  function pullActive() {
    /* Are we in a user-requested pull cycle? Either EZ3 says running or Layer A
       left an in-flight status. Merely observing these signals never starts one. */
    if (cancelledThisCycle) return false;
    if (ez3Running()) return true;
    var hs = heroStatus();
    if (hs.present && hs.text && !hs.err) {
      /* an in-flight status line that isn't an error */
      if (/looking for mls assist|reading|finding today|schedule/i.test(hs.text)) return true;
    }
    return false;
  }

  /* ---- the classifier: detected signals -> step + terminal ----------------- */
  function classify() {
    var hs = heroStatus();
    ST.lastStatus = hs.text;
    var text = hs.text || '';
    var lo = text.toLowerCase();
    var apState = ez3AutoPull();

    /* ---- 1. explicit hero error (fastest, richest — early-abort lives here) */
    if (hs.err && text) {
      var kind = null;
      if (/isn.?t responding|not responding/.test(lo)) kind = 'ext-missing';
      else if (/older version/.test(lo)) kind = 'ext-outdated';
      else if (/0\s*appointments|0 appointment|shows 0/.test(lo)) kind = 'empty-schedule';
      else if (/no patient appointments|day schedule.*not the dashboard|dashboard/.test(lo)) kind = 'wrong-page';
      else if (/couldn.?t parse|parse the schedule/.test(lo)) kind = 'parse-fail';
      else if (/couldn.?t read|open your athena|open it in another tab|signed in|sign in|log ?in/.test(lo)) kind = 'signed-out';
      else kind = 'generic';
      return { terminal: kind, running: false };
    }

    /* ---- 2. EZ3 (Layer B) reached its OWN terminal 'failed' state ----------
       Takes priority over any stale non-error "Reading…" line still sitting in
       #heroPullStatus, so the 120 s cap is never masked as "still running". */
    if (apState === 'failed') {
      var note = ez3Note().toLowerCase();
      var k = 'timeout';
      if (/isn.?t available|ask staff|could not start/.test(note)) k = 'generic';
      else if (/no patients came back|tap pull again|taking|open.*athena|signed in|sign in/.test(note)) k = 'timeout';
      return { terminal: k, running: false };
    }

    /* ---- 3. running-phase step detection ---------------------------------- */
    if (/read (your )?athena schedule|finding today|found .*patients|matching|loading .*(chart|history|detail)/.test(lo)) {
      /* schedule text came back → reading appointments done, now patients */
      ST.dataAccessed = true;
      if (/matching|loading .*(chart|history|detail)/.test(lo)) return { step: 'details', running: true };
      return { step: 'match', running: true };
    }
    if (/reading (today|from)/.test(lo)) return { step: 'appts', running: true };  /* ext reading the tab */
    if (/looking for mls assist/.test(lo)) return { step: 'ext', running: true };

    /* ---- 4. no status line yet -> infer from other signals ---------------- */
    var tc = todayCount();
    if (tc != null && tc > 0 && !pullActive()) return { done: true };
    if (apState === 'done') return { done: true };
    if (ez3Running()) return { step: 'appts', running: true };
    return { step: 'ext', running: true };
  }

  /* map a running step key to the step status array */
  function stepStatuses(curKey, terminalKind, failedKey) {
    var curIdx = curKey ? stepIndex(curKey) : -1;
    var out = [];
    for (var i = 0; i < STEPS.length; i++) {
      var st = 'waiting';
      if (terminalKind) {
        if (failedKey && STEPS[i].key === failedKey) st = 'failed';
        else if (curIdx >= 0 && i < curIdx) st = 'completed';
        else if (curIdx >= 0 && i === curIdx) st = 'attention';
        else st = 'waiting';
      } else {
        if (curIdx >= 0 && i < curIdx) st = 'completed';
        else if (i === curIdx) st = 'running';
        else st = 'waiting';
      }
      out.push({ step: STEPS[i], status: st });
    }
    return out;
  }

  /* ---- code/summary for the debug panel ------------------------------------ */
  function makeCode(kind) {
    var k = (kind || ST.terminalKind || 'run').toUpperCase().replace(/[^A-Z]/g, '');
    return 'PF-' + k + '-' + todayKey().replace(/-/g, '') + '-' + String((ST.at || nowMs()) % 100000);
  }
  function debugSnapshot() {
    var cs = connState();
    var sr = schedRaw();
    return {
      code: ST.code || makeCode(),
      version: VER,
      when: new Date().toString(),
      phase: ST.phase,
      currentStep: ST.stepKey,
      lastSuccessfulStep: ST.lastGoodKey,
      failedStep: ST.failedKey,
      terminalKind: ST.terminalKind,
      athenaLoginState: (function () {
        if (ST.terminalKind === 'signed-out') return 'likely signed OUT (read failed)';
        if (ST.dataAccessed) return 'reachable (schedule read OK)';
        return 'unknown (not yet read)';
      })(),
      extensionConnection: cs ? (cs.status + (cs.ext ? ' · ext=yes' : ' · ext=no') + (cs.tab ? ' · tab=yes' : ' · tab=no')) : 'unknown (no __mlsConnTruth)',
      selectedProvider: selectedProvider(),
      selectedDate: todayKey(),
      retryCount: ST.retryCount,
      autoRetried: ST.autoRetried,
      dataAccessed: ST.dataAccessed,
      anythingWritten: false,   /* the pull flow is read-only — MLS never writes during a pull */
      lastStatusLine: ST.lastStatus,
      schedUrl: sr ? (sr.url || '') : '',
      schedChars: sr && sr.text ? sr.text.length : 0
    };
  }

  /* ---- recovery actions ---------------------------------------------------- */
  function doRetry(isAuto) {
    /* Fail closed against stale timers or restored state. Every Athena retry
       requires a fresh click on this panel. */
    if (isAuto) return;
    cancelledThisCycle = false;
    ST.retryCount += (isAuto ? 0 : 1);
    if (isAuto) ST.autoRetried = true;
    ST.phase = 'running'; ST.terminalKind = null; ST.failedKey = null;
    removeSpinnerHide();
    persist();
    try {
      if (isFn(window.pullScheduleViaAssist)) window.pullScheduleViaAssist();
      else if (window.__mlsEasyV32 && isFn(window.__mlsEasyV32.open)) window.__mlsEasyV32.open('home');
    } catch (e) {}
    scheduleTick();
    render();
  }
  function doCancel() {
    cancelledThisCycle = true;
    ST.phase = 'cancelled';
    removeSpinnerHide();
    persist();
    render();
  }
  function doRestart() {
    /* Clear the legacy once-per-day marker, then honor the user's explicit
       Restart click with one fresh pull. */
    try { ss('mlsEz3AutoPull.' + todayKey(), null); } catch (e) {}
    ST.dataAccessed = false; ST.autoRetried = false;
    doRetry(false);
  }

  /* ---- spinner early-abort (scoped, reversible CSS) ------------------------ */
  function injectSpinnerHide() {
    if (styleEl) return;
    try {
      styleEl = document.createElement('style');
      styleEl.id = 'mpfSpinnerHide';
      /* Only hides the EZ3 loading spinner card while we show a terminal state.
         Fully removed by removeSpinnerHide()/revert(). */
      styleEl.textContent = '.ez3-loadcard{display:none !important;}';
      (document.head || document.documentElement).appendChild(styleEl);
    } catch (e) {}
  }
  function removeSpinnerHide() {
    try { if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl); } catch (e) {}
    styleEl = null;
  }

  /* ---- render -------------------------------------------------------------- */
  function host() {
    /* stable parent that survives the EZ3 render loop (EZ3 rewrites its own
       host innerHTML; we live as a sibling in #visitView). */
    return $('visitView') || $('appScreen') || document.body;
  }
  function panel() {
    var p = $('mlsPullFlowPanel');
    if (!p) {
      p = document.createElement('div');
      p.id = 'mlsPullFlowPanel';
      p.setAttribute('role', 'status');
      p.setAttribute('aria-live', 'polite');
      var h = host();
      /* place at the very top of the visit view so it reads before the fold */
      if (h && h.firstChild) h.insertBefore(p, h.firstChild); else if (h) h.appendChild(p);
      ensureStyle();
    }
    return p;
  }
  function ensureStyle() {
    if ($('mpfStyle')) return;
    try {
      var s = document.createElement('style');
      s.id = 'mpfStyle';
      s.textContent = [
        '#mlsPullFlowPanel{margin:0 0 14px;font-family:inherit;}',
        '.mpf-card{background:#fff;border:1px solid #E7E5DD;border-radius:16px;padding:18px 18px 15px;color:#1A211C;box-shadow:0 1px 2px rgba(20,33,28,.04),0 14px 34px -18px rgba(20,33,28,.18);}',
        '.mpf-card.attention{border-color:#EFE4CE;background:linear-gradient(180deg,#FCF8EF,#fff 55%);}',
        '.mpf-card.fail{border-color:#EAD3CE;}',
        '.mpf-h{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:700;margin:0 0 4px;font-family:Newsreader,Georgia,serif;letter-spacing:-.01em;}',
        '.mpf-h .ico{font-size:18px;}',
        '.mpf-body{font-size:13px;line-height:1.55;color:#55605A;margin:2px 0 8px;}',
        '.mpf-hint{font-size:12.5px;line-height:1.5;color:#55605A;background:#F6FBF8;border:1px solid #EFEDE6;border-radius:9px;padding:8px 10px;margin:8px 0 10px;}',
        '.mpf-steps{list-style:none;margin:8px 0 4px;padding:0;}',
        '.mpf-step{display:flex;align-items:flex-start;gap:9px;font-size:12.6px;line-height:1.5;padding:3px 0;color:#79837C;}',
        '.mpf-step .dot{flex:0 0 auto;width:16px;height:16px;border-radius:50%;margin-top:1px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;border:1.5px solid #D6D2C6;color:#8A8F86;background:transparent;}',
        '.mpf-step.completed .dot{background:#2E6A4B;border-color:#2E6A4B;color:#fff;}',
        '.mpf-step.running .dot{background:#2E6A4B;border-color:#8FD8BE;color:#fff;animation:mpfPulse 1.2s infinite;}',
        '.mpf-step.attention .dot{background:#B07636;border-color:#B07636;color:#fff;}',
        '.mpf-step.retrying .dot{background:#7A5CC0;border-color:#EFEAF8;color:#fff;animation:mpfPulse 1.2s infinite;}',
        '.mpf-step.failed .dot{background:#B23B3B;border-color:#B23B3B;color:#fff;}',
        '.mpf-step.completed .lab{color:#3D453E;}',
        '.mpf-step.running .lab{color:#1A211C;font-weight:700;}',
        '.mpf-step.failed .lab{color:#B23B3B;font-weight:700;}',
        '.mpf-step .sub{display:block;font-size:11px;color:var(--muted);font-weight:500;}',
        '@keyframes mpfPulse{0%,100%{box-shadow:0 0 0 0 rgba(46,106,75,.35)}50%{box-shadow:0 0 0 6px rgba(46,106,75,0)}}',
        '.mpf-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px;}',
        '.mpf-btn{appearance:none;border:0;border-radius:10px;padding:10px 15px;font-size:13px;font-weight:600;cursor:pointer;transition:transform .12s ease;}',
        '.mpf-btn.primary{background:#204034;color:#fff;box-shadow:0 8px 20px -8px rgba(32,64,52,.6);}',
        '.mpf-btn.ghost{background:#fff;color:#1A211C;border:1px solid #D9D6CD;}',
        '.mpf-btn:active{transform:translateY(1px);}',
        '.mpf-dbg{margin-top:10px;font-size:12px;}',
        '.mpf-dbg summary{cursor:pointer;color:#79837C;font-weight:700;list-style:none;user-select:none;}',
        '.mpf-dbg summary::-webkit-details-marker{display:none;}',
        '.mpf-dbg[open] summary{color:#1A211C;}',
        '.mpf-kv{margin:8px 0 0;border-top:1px solid #EFEDE6;padding-top:8px;}',
        '.mpf-kv div{display:flex;gap:8px;padding:2px 0;font-size:11.6px;color:#1A211C;}',
        '.mpf-kv .k{flex:0 0 44%;color:#79837C;}',
        '.mpf-kv .v{flex:1 1 auto;color:#3D453E;word-break:break-word;}',
        '.mpf-code{margin-top:8px;display:flex;gap:8px;align-items:center;}',
        '.mpf-code code{flex:1 1 auto;background:#FCFBF8;border:1px solid #E7E5DD;border-radius:7px;padding:6px 8px;font-size:11px;color:#1A211C;overflow:auto;}',
        '@media (max-width:600px){.mpf-kv .k{flex-basis:52%;}}'
      ].join('');
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {}
  }

  function stepListHtml(rows) {
    var items = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], s = r.status;
      var mark = s === 'completed' ? '✓' : (s === 'failed' ? '✕' : (s === 'attention' ? '!' : (s === 'running' || s === 'retrying' ? '' : (i + 1))));
      var sub = r.step.extOpaque ? '<span class="sub">· handled inside MLS Assist</span>' : '';
      items += '<li class="mpf-step ' + s + '"><span class="dot">' + esc(mark) + '</span>' +
               '<span class="lab">' + esc(r.step.label) + sub + '</span></li>';
    }
    return '<ul class="mpf-steps">' + items + '</ul>';
  }

  function debugHtml() {
    var d = debugSnapshot();
    ST.code = d.code;
    function row(k, v) { return '<div><span class="k">' + esc(k) + '</span><span class="v">' + esc(v == null ? '—' : String(v)) + '</span></div>'; }
    var kv = row('Current step', d.currentStep) +
             row('Last successful step', d.lastSuccessfulStep) +
             row('Failed step', d.failedStep) +
             row('athenaOne sign-in', d.athenaLoginState) +
             row('MLS Assist connection', d.extensionConnection) +
             row('Selected provider', d.selectedProvider) +
             row('Selected date', d.selectedDate) +
             row('Retry count', d.retryCount + (d.autoRetried ? ' (incl. 1 auto)' : '')) +
             row('Data accessed', d.dataAccessed ? 'Yes — schedule text was read' : 'No') +
             row('Anything written / changed', 'No — the pull is read-only') +
             row('Last status line', d.lastStatusLine || '—');
    var summary = JSON.stringify(d, null, 2);
    return '<details class="mpf-dbg"><summary>What happened? (details for support)</summary>' +
           '<div class="mpf-kv">' + kv + '</div>' +
           '<div class="mpf-code"><code id="mpfCode">' + esc(d.code) + '</code>' +
           '<button type="button" class="mpf-btn ghost" id="mpfCopy" data-copy="' + esc(summary) + '">Copy</button></div>' +
           '</details>';
  }

  function render() {
    var p = panel();
    if (!p) return;

    if (ST.phase === 'idle' || ST.phase === 'cancelled' || ST.phase === 'done') {
      /* No-op-write discipline. This branch runs twice a second for the whole
         life of the page — scheduleTick() installs setInterval(step, 500) and
         never clears it — and both writes were unconditional. MEASURED: 80
         byte-identical innerHTML writes per 40 idle seconds on a panel that is
         display:none throughout. Same class as the b849 pull-progress card fix
         ("the old render() rebuilt the WHOLE card via innerHTML every 900ms
         tick"), one file over. */
      if (p.style.display !== 'none') p.style.display = 'none';
      if (p.innerHTML !== '') p.innerHTML = '';
      removeSpinnerHide();
      return;
    }
    p.style.display = 'block';

    if (ST.phase === 'terminal') {
      injectSpinnerHide();  /* early-abort: stop the stale EZ3 spinner */
      var c = TERMINAL_COPY[ST.terminalKind] || TERMINAL_COPY.generic;
      var ico = ST.terminalKind === 'signed-out' ? '🔑' : (ST.terminalKind === 'empty-schedule' ? '📭' : (ST.terminalKind === 'ext-missing' || ST.terminalKind === 'ext-outdated' ? '🧩' : '⚠️'));
      var rows = stepStatuses(ST.stepKey, ST.terminalKind, ST.failedKey);
      var actions = '<button type="button" class="mpf-btn primary" id="mpfRetry">' + esc(c.retry) + '</button>' +
                    '<button type="button" class="mpf-btn ghost" id="mpfRestart">Restart from scratch</button>' +
                    '<button type="button" class="mpf-btn ghost" id="mpfCancel">Dismiss</button>';
      p.className = '';
      p.innerHTML =
        '<div class="mpf-card ' + (ST.terminalKind === 'empty-schedule' || ST.terminalKind === 'signed-out' ? 'attention' : 'fail') + '">' +
          '<div class="mpf-h"><span class="ico">' + ico + '</span>' + esc(c.title) + '</div>' +
          '<div class="mpf-body">' + c.body + '</div>' +
          '<div class="mpf-hint">' + esc(c.hint) + '</div>' +
          stepListHtml(rows) +
          '<div class="mpf-actions">' + actions + '</div>' +
          debugHtml() +
        '</div>';
      wire(p);
      return;
    }

    /* running — become the SINGLE progress surface: hide the plain EZ3 spinner
       (both bundle copies of .ez3-loadcard) so there aren't two "Getting today's
       patients ready…" cards. Our card carries the same headline + the step
       tracker + the live sub-status. */
    injectSpinnerHide();
    var rrows = stepStatuses(ST.stepKey, null, null);
    var subnote = ST.lastStatus ? '<div class="mpf-body">' + esc(ST.lastStatus) + '</div>' : '<div class="mpf-body">Reading your schedule and chart history from athenaOne — this takes a moment.</div>';
    p.className = '';
    p.innerHTML =
      '<div class="mpf-card">' +
        '<div class="mpf-h"><span class="ico">⏳</span>Getting today’s patients ready…</div>' +
        subnote +
        stepListHtml(rrows) +
        '<div class="mpf-actions">' +
          '<button type="button" class="mpf-btn ghost" id="mpfCancel">Cancel</button>' +
          '<button type="button" class="mpf-btn ghost" id="mpfRetry">Start over</button>' +
        '</div>' +
        debugHtml() +
      '</div>';
    wire(p);
  }

  function wire(p) {
    try {
      var r = p.querySelector('#mpfRetry'); if (r) r.onclick = function () { doRetry(false); };
      var rs = p.querySelector('#mpfRestart'); if (rs) rs.onclick = function () { doRestart(); };
      var c = p.querySelector('#mpfCancel'); if (c) c.onclick = function () { doCancel(); };
      var cp = p.querySelector('#mpfCopy');
      if (cp) cp.onclick = function () {
        var txt = cp.getAttribute('data-copy') || '';
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(txt); }
          else { var ta = document.createElement('textarea'); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch (e) {} document.body.removeChild(ta); }
          cp.textContent = 'Copied ✓'; setTimeout(function () { try { cp.textContent = 'Copy'; } catch (e) {} }, 1500);
        } catch (e) {}
      };
    } catch (e) {}
  }

  /* ---- the observe/classify tick ------------------------------------------- */
  function step() {
    var active = pullActive();

    /* HIGHEST PRIORITY: if today's patients are loaded and no pull is in
       flight, we are DONE — never leave a spinner sitting on top of a schedule
       that actually arrived. A TERMINAL failure card is exempt: it carries the
       diagnosis + Retry and must survive until the user acts (a partial day can
       load patients while the failure still matters). */
    var tc = todayCount();
    if (tc != null && tc > 0 && !active && ST.phase !== 'terminal') {
      if (ST.phase !== 'done') { ST.phase = 'done'; ST.stepKey = 'ready'; ST.lastGoodKey = 'prepare'; removeSpinnerHide(); persist(); }
      render(); return;
    }

    /* Not in a pull cycle and not showing a terminal state → idle/hide. */
    if (ST.phase === 'terminal') {
      /* stay terminal until the user acts OR a fresh pull clearly restarts */
      if (active) { ST.phase = 'running'; }   /* a new pull began under us */
      else { render(); persist(); return; }
    }
    if (ST.phase === 'cancelled') {
      if (active) { cancelledThisCycle = false; ST.phase = 'running'; }
      else { render(); return; }
    }

    if (!active && ST.phase === 'idle') { render(); return; }

    var res = classify();
    ST.at = ST.at || nowMs();

    /* SAFETY hand-back: if a pull is no longer in flight (no spinner, no in-flight
       status) and there is neither a terminal error nor a confirmable patient
       count, don't sit on a stale "running" card — return control to the app's
       own surfaces so we never hide the EZ3 UI on an unconfirmable state. */
    if (res.step && !active && ST.phase === 'running') {
      ST.phase = 'idle'; removeSpinnerHide(); render(); persist(); return;
    }

    if (res.done) { ST.phase = 'done'; ST.stepKey = 'ready'; render(); persist(); return; }

    if (res.terminal) {
      ST.phase = 'terminal';
      ST.terminalKind = res.terminal;
      ST.failedKey = terminalToStep(res.terminal);
      ST.at = nowMs();
      ST.code = makeCode(res.terminal);
      /* pf-1.1.0: never blame the extension without asking it first. If the
         extension answers a real ping, move the failure marker to the reading
         step (the honest earliest-unproven step) and record the live version. */
      if (ST.failedKey === 'ext') {
        (function (kindAtCheck) {
          verifyExt(function (ok) {
            try {
              if (ok && ST.phase === 'terminal' && ST.terminalKind === kindAtCheck && ST.failedKey === 'ext') {
                ST.failedKey = 'appts';
                render(); persist();
              }
            } catch (e) {}
          });
        })(res.terminal);
      }
      /* Terminal states are passive. A retry may read Athena only after the
         user presses the visible Retry or Restart button. */
      render(); persist(); return;
    }

    /* running */
    ST.phase = 'running';
    if (res.step) {
      var idx = stepIndex(res.step);
      var curIdx = ST.stepKey ? stepIndex(ST.stepKey) : -1;
      if (idx >= curIdx) { if (curIdx >= 0 && idx > curIdx) ST.lastGoodKey = ST.stepKey; ST.stepKey = res.step; }
    }
    render(); persist();
  }

  function markRetrying() {
    try {
      var p = $('mlsPullFlowPanel'); if (!p) return;
      var steps = p.querySelectorAll('.mpf-step');
      for (var i = 0; i < steps.length; i++) {
        if (steps[i].className.indexOf('attention') >= 0 || steps[i].className.indexOf('failed') >= 0) {
          steps[i].className = 'mpf-step retrying';
        }
      }
    } catch (e) {}
  }

  function terminalToStep(kind) {
    switch (kind) {
      case 'ext-missing': case 'ext-outdated': return 'ext';
      case 'signed-out': return 'login';
      case 'wrong-page': return 'appts';
      case 'empty-schedule': return 'appts';
      case 'parse-fail': return 'appts';
      case 'timeout': return 'match';
      default: return 'ext';
    }
  }

  /* ---- pf-1.1.0: VERIFIED ext blame ----------------------------------------
     The old flow blamed "MLS Assist connection" for any unclassified failure
     (default -> 'ext'), which showed a false red X while the extension was
     actually alive (its service worker just wakes slower than a single ping).
     Before we pin a failure on the extension, actually ASK it: up to 3 pings
     over ~3 s. If it answers, the connection row must NOT be the failure —
     reclassify the blame to the reading step so the card stays honest. */
  var _extPing = { at: 0, ok: null, ver: null, busy: false };
  function verifyExt(done) {
    var now = nowMs();
    if (_extPing.ok !== null && (now - _extPing.at) < 30000) { done(_extPing.ok); return; }
    if (_extPing.busy) { done(null); return; }
    _extPing.busy = true;
    var tries = 0, settled = false;
    function finish(ok, ver) {
      if (settled) return; settled = true;
      _extPing.busy = false; _extPing.at = nowMs(); _extPing.ok = ok; _extPing.ver = ver || null;
      try { window.removeEventListener('message', onMsg); } catch (e) {}
      done(ok);
    }
    function onMsg(e) {
      try {
        if (e && e.data && e.data.source === 'mls-ext' && e.data.type === 'mlsPong') finish(true, e.data.version);
      } catch (err) {}
    }
    try { window.addEventListener('message', onMsg); } catch (e) { finish(null); return; }
    function ping() {
      if (settled) return;
      if (tries >= 3) { finish(false); return; }
      tries++;
      try { window.postMessage({ source: 'mls-app', type: 'mlsPing' }, '*'); } catch (e) {}
      setTimeout(ping, 1000);
    }
    ping();
  }

  /* ---- lifecycle ----------------------------------------------------------- */
  function scheduleTick() {
    if (tickIv) return;
    tickIv = setInterval(function () { try { step(); } catch (e) {} }, 500);
  }
  function watchStatus() {
    var el = $('heroPullStatus');
    if (!el || statusMo) return;
    try {
      statusMo = new MutationObserver(function () { try { step(); } catch (e) {} });
      statusMo.observe(el, { childList: true, subtree: true, characterData: true, attributes: true });
    } catch (e) {}
  }

  function boot() {
    restore();
    scheduleTick();
    watchStatus();
    /* a DOM observer so we (re)attach the status watcher + re-run when the
       visit view mounts/re-renders */
    try {
      mo = new MutationObserver(function () { watchStatus(); });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    step();
  }

  /* ---- public API ---------------------------------------------------------- */
  var api = {
    version: VER,
    state: function () { var o = {}; for (var k in ST) if (ST.hasOwnProperty(k)) o[k] = ST[k]; return o; },
    debug: function () { return debugSnapshot(); },
    retry: function () { doRetry(false); },
    cancel: function () { doCancel(); },
    restart: function () { doRestart(); },
    /* test seam: force a classification pass now */
    _tick: function () { step(); },
    _classify: classify,
    revert: function () {
      try { if (tickIv) clearInterval(tickIv); } catch (e) {} tickIv = null;
      try { if (mo) mo.disconnect(); } catch (e) {} mo = null;
      try { if (statusMo) statusMo.disconnect(); } catch (e) {} statusMo = null;
      removeSpinnerHide();
      try { var p = $('mlsPullFlowPanel'); if (p && p.parentNode) p.parentNode.removeChild(p); } catch (e) {}
      try { var s = $('mpfStyle'); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
      try { ss(PKEY(), null); } catch (e) {}
      try { delete window.__mlsPullFlow; } catch (e) { window.__mlsPullFlow = undefined; }
    }
  };
  window.__mlsPullFlow = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { try { boot(); } catch (e) {} });
  } else {
    try { boot(); } catch (e) {}
  }
})();
