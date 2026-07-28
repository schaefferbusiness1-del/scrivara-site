/* =============================================================================
 * feat_mls_firstrun.js  ->  window.__mlsFirstRun   (fr-1.0.0, 2026-07-28)
 * -----------------------------------------------------------------------------
 * A new doctor signs in and has to discover three separate things before MLS
 * can do anything at all: the MLS Assist extension has to be installed and
 * answering, athenaOne has to be open and signed in, and the day has to be
 * pulled. Nothing on the screen said that, so a first run could look broken
 * when it was only unconfigured.
 *
 * SURFACE A -- a small setup checklist card (#mlsFrCard) mounted above
 * #visitHero in the Visit view. That is the same slot the MLS Assist install
 * banner already uses, so it inherits a placement the app has proven.
 * Each row reads LIVE TRUTH, never a stored guess:
 *
 *   1. "MLS Assist installed and answering"
 *        window.__mlsConnTruth.isConnected() / .check()  (readiness only)
 *        fallback window.__mlsUxUnify.connected()
 *        fallback #mlsAthenaStatusDot[data-state="connected"]
 *   2. "athenaOne signed in"
 *        window.__mlsAthenaGuard.probeAthenaOpen() + .classify(resp)
 *        Readiness NEVER implies signed in -- they are different questions and
 *        this card asks both. Only a CERTAIN negative is allowed to show red;
 *        anything ambiguous or in flight stays neutral.
 *   3. "Pull your first day"
 *        window.__mlsSI.authoritativeStatusForDay(todayIso()).available===true
 *        fallback: any row in window._calAppts
 *
 * SURFACE B -- a 5 step on-demand tour, __mlsFirstRun.tour(). Steps point at
 * the real controls (sign in, pull, dictate, generate, review). A target that
 * is missing or not rendered degrades to a centered card; a highlight is never
 * drawn at a guessed position. NO AUTO LAUNCH EVER: the policy flag
 * window.__mlsManualToursOnly is the standing rule in this app, and this module
 * registers no automatic path at all. The tour opens from the card button or
 * from an explicit __mlsFirstRun.tour() call, and from nowhere else.
 *
 * GATES (all must hold BEFORE the card is created):
 *   - uns('firstRunDone') !== '1'          (per account, permanent)
 *   - a signed in session exists           (degrades to a visible #appScreen)
 *   - #setupModal is not showing           (never stack on the setup dialog)
 *   - no pull is running                   (__mlsAthenaFollow._guards.pullBusy
 *     first, then the inline stamp/lease/pack fallbacks)
 *   - not recording                        (#captureBtn)
 *   - once per browser session             (sessionStorage mls_fr_shown)
 * Gates are re-checked on 'mls:loader-ready' and 'mls:view-changed' plus a
 * bounded [800, 2500, 6000]ms timeout ladder. No setInterval, no
 * MutationObserver -- nothing here keeps running after the ladder drains.
 *
 * SAFETY: no PHI is read, stored or rendered (the athena probe inspects only a
 * tab url/title strip inside the guard itself); no Athena writes; no network
 * calls of any kind; no existing app function is modified. Everything is
 * additive and reversible via window.__mlsFirstRun.revert().
 *
 * The card is a normal in-flow block at the TOP of the Visit view, so it can
 * never overlap the fixed bottom dock; the tour card is clamped to leave dock
 * clearance explicitly.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__mlsFirstRun) return;

  var VERSION = 'fr-1.0.0';
  var CARD_ID = 'mlsFrCard';
  var CSS_ID = 'mlsFrCss';
  var TOUR_ID = 'mlsFrTour';
  var TCARD_ID = 'mlsFrTourCard';
  var RING_ID = 'mlsFrRing';
  var DIM_ID = 'mlsFrDim';
  var SESSION_KEY = 'mls_fr_shown';
  var DONE_KEY = 'firstRunDone';
  var DOCK_CLEAR = 96;          /* px of bottom clearance for the fixed dock */
  var LADDER = [800, 2500, 6000];
  var ATH_CACHE_MS = 30000;
  var CONN_CHECK_MS = 20000;

  /* ------------------------------ tiny helpers ---------------------------- */
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function byId(id) { return safe(function () { return document.getElementById(id); }, null); }
  function qs(sel) { return safe(function () { return document.querySelector(sel); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function isFn(f) { return typeof f === 'function'; }

  var listeners = [];
  var timers = [];
  function on(el, type, fn, opts) {
    if (!el || !isFn(el.addEventListener)) return;
    try { el.addEventListener(type, fn, opts); listeners.push([el, type, fn, opts]); } catch (e) {}
  }
  function offAll() {
    for (var i = 0; i < listeners.length; i++) {
      var L = listeners[i];
      try { L[0].removeEventListener(L[1], L[2], L[3]); } catch (e) {}
    }
    listeners.length = 0;
  }
  function offOne(el, type, fn) {
    for (var i = listeners.length - 1; i >= 0; i--) {
      var L = listeners[i];
      if (L[0] === el && L[1] === type && L[2] === fn) {
        try { L[0].removeEventListener(L[1], L[2], L[3]); } catch (e) {}
        listeners.splice(i, 1);
      }
    }
  }
  function later(fn, ms) {
    var t = safe(function () {
      return setTimeout(function () {
        dropTimer(t);
        try { fn(); } catch (e) {}
      }, ms);
    }, null);
    if (t != null) timers.push(t);
    return t;
  }
  function dropTimer(t) {
    for (var i = 0; i < timers.length; i++) { if (timers[i] === t) { timers.splice(i, 1); return; } }
  }
  function clearTimers() {
    for (var i = 0; i < timers.length; i++) { try { clearTimeout(timers[i]); } catch (e) {} }
    timers.length = 0;
  }
  /* Judge visibility from computed style up the chain: a 0x0 viewport makes
     every offset measurement lie, and offsetParent is null for fixed nodes. */
  function visible(el) {
    if (!el || el.nodeType !== 1) return false;
    var n = el;
    while (n && n.nodeType === 1) {
      var cs = safe(function () { return window.getComputedStyle(n); }, null);
      if (!cs) return true;
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      n = n.parentNode;
    }
    return true;
  }
  /* Guarded write: an unconditional className assignment re-commits style and
     costs a whole document recalc even when nothing changed. */
  function setClass(el, next) { if (el && el.className !== next) el.className = next; }
  function setText(el, next) { if (el && el.textContent !== next) el.textContent = next; }
  function todayIso() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }

  /* ------------------------- per account persistence ---------------------- */
  /* uns() is the per-account localStorage namespacer the app installs as a top
     level function declaration, so it IS a window property. If it is somehow
     absent we mirror its exact no-session shape rather than invent a key. */
  function unsKey(name) {
    var k = null;
    try { if (isFn(window.uns)) k = window.uns(name); } catch (e) {}
    if (!k) { try { if (typeof uns === 'function') k = uns(name); } catch (e2) {} }
    if (!k) k = 'sf_u::_::' + name;
    return S(k);
  }
  function isDone() {
    return safe(function () { return localStorage.getItem(unsKey(DONE_KEY)) === '1'; }, false);
  }
  function markDone() {
    safe(function () { localStorage.setItem(unsKey(DONE_KEY), '1'); });
  }
  function sessionShown() {
    return safe(function () { return sessionStorage.getItem(SESSION_KEY) === '1'; }, false);
  }
  function markSessionShown() {
    safe(function () { sessionStorage.setItem(SESSION_KEY, '1'); });
  }

  /* --------------------------------- gates -------------------------------- */
  function signedIn() {
    var email = '';
    try { if (window.session && window.session.email) email = S(window.session.email); } catch (e) {}
    if (!email) { try { if (typeof session !== 'undefined' && session && session.email) email = S(session.email); } catch (e2) {} }
    if (!email) { try { if (isFn(window.getSessionEmail)) email = S(window.getSessionEmail() || ''); } catch (e3) {} }
    if (!email) { try { if (window.__mlsSessionAccount) email = S(window.__mlsSessionAccount); } catch (e4) {} }
    if (email) return true;
    /* Degrade: the app screen is only revealed after sign in. */
    return visible(byId('appScreen'));
  }
  function setupOpen() {
    var m = byId('setupModal');
    if (!m) return false;
    var has = safe(function () { return !!(m.classList && m.classList.contains('show')); }, false);
    if (has) return true;
    return safe(function () { return /(^|\s)show(\s|$)/.test(S(m.className)); }, false);
  }
  function pullBusy() {
    var g = safe(function () { return window.__mlsAthenaFollow && window.__mlsAthenaFollow._guards; }, null);
    if (g && isFn(g.pullBusy)) {
      var v = safe(function () { return !!g.pullBusy(); }, null);
      if (v !== null) return v;
    }
    if (safe(function () { return (Date.now() - (window.__mlsPullBusyAt || 0)) < 120000; }, false)) return true;
    if (safe(function () { return !!window.__mlsSchedulePullLease; }, false)) return true;
    if (safe(function () {
      var p = window.__mlsB121Pack;
      return !!(p && isFn(p._pullRunning) && p._pullRunning());
    }, false)) return true;
    return false;
  }
  function recording() {
    var b = byId('captureBtn');
    if (!b) return false;
    if (safe(function () { return !!(b.classList && b.classList.contains('recording')); }, false)) return true;
    return safe(function () { return /stop/i.test(S(b.textContent)); }, false);
  }
  function gatesPass() {
    if (isDone()) return false;
    if (!signedIn()) return false;
    if (setupOpen()) return false;
    if (pullBusy()) return false;
    if (recording()) return false;
    return true;
  }

  /* ------------------------------- live truth ----------------------------- */
  /* Row states are 'ok' (proven true), 'bad' (a CERTAIN negative) or 'wait'
     (unknown, in flight, or merely ambiguous). 'wait' is never dressed as a
     failure -- an ambiguous reading is not evidence of anything. */
  var lastConnCheck = 0;

  function connTruth() {
    var ct = safe(function () { return window.__mlsConnTruth; }, null);
    if (ct && ct.installed) {
      if (isFn(ct.isConnected) && safe(function () { return !!ct.isConnected(); }, false)) return 'ok';
      var st = safe(function () { return ct.state && ct.state.status; }, '');
      if (st === 'no-extension') return 'bad';
      if (st === 'checking' || st === 'error' || st === 'no-tab' || !st) return 'wait';
      return 'wait';
    }
    if (safe(function () {
      var u = window.__mlsUxUnify;
      return !!(u && isFn(u.connected) && u.connected());
    }, false)) return 'ok';
    var dot = qs('#mlsAthenaStatusDot[data-state="connected"]');
    if (dot) return 'ok';
    return 'wait';
  }
  function kickConnCheck() {
    var ct = safe(function () { return window.__mlsConnTruth; }, null);
    if (!ct || !ct.installed || !isFn(ct.check)) return;
    var now = Date.now();
    if (now - lastConnCheck < CONN_CHECK_MS) return;
    lastConnCheck = now;
    var p = safe(function () { return ct.check(); }, null);
    if (p && isFn(p.then)) {
      p.then(function () { refresh(); }, function () { refresh(); });
    }
  }

  var athState = 'wait', athAt = 0, athInFlight = false;
  function kickAthProbe() {
    if (athInFlight) return;
    if (athAt && (Date.now() - athAt) < ATH_CACHE_MS) return;
    /* The probe drives a round trip through the extension. Never contend with
       a running pull or a live recording for it. */
    if (pullBusy() || recording()) return;
    var g = safe(function () { return window.__mlsAthenaGuard; }, null);
    if (!g || !isFn(g.probeAthenaOpen)) return;
    athInFlight = true;
    var p = safe(function () { return g.probeAthenaOpen(); }, null);
    if (!p || !isFn(p.then)) { athInFlight = false; return; }
    p.then(function (resp) { settleAth(g, resp); }, function () { settleAth(g, null); });
  }
  function settleAth(g, resp) {
    athInFlight = false;
    athAt = Date.now();
    var v = resp;
    /* probeAthenaOpen already returns a classified verdict; a raw chart reply
       is classified here through the same pure classifier. */
    if (v && typeof v.open !== 'boolean' && isFn(g.classify)) {
      v = safe(function () { return g.classify(resp); }, null);
    }
    if (v && v.open === true) athState = 'ok';
    else if (v && v.open === false && v.certain === true) athState = 'bad';
    else athState = 'wait';
    refresh();
  }

  function dayTruth() {
    var si = safe(function () { return window.__mlsSI; }, null);
    if (si && isFn(si.authoritativeStatusForDay)) {
      var st = safe(function () { return si.authoritativeStatusForDay(todayIso()); }, null);
      if (st && st.available === true) return 'ok';
    }
    var rows = safe(function () {
      return isFn(window._calAppts) ? (window._calAppts() || []) : (window._calAppts || []);
    }, null);
    if (rows && rows.length) return 'ok';
    return 'wait';
  }

  /* --------------------------------- styles ------------------------------- */
  function css() {
    if (byId(CSS_ID)) return;
    var s = safe(function () { return document.createElement('style'); }, null);
    if (!s) return;
    s.id = CSS_ID;
    s.textContent = [
      /* --- checklist card: in normal flow at the top of the Visit view, so it
             is structurally incapable of overlapping the fixed bottom dock --- */
      '#mlsFrCard{position:static;box-sizing:border-box;background:var(--card,#ffffff);',
      'color:var(--ink,#1A211C);border:1px solid var(--line,#E7E5DD);',
      'border-left:3px solid var(--brand,#2E6A4B);border-radius:12px;',
      'padding:12px 14px;margin:0 0 14px;max-width:640px;',
      'font:400 13.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
      '#mlsFrCard .mlsfr-head{display:flex;align-items:center;gap:10px;margin:0 0 8px}',
      '#mlsFrCard .mlsfr-title{flex:1;min-width:0;font-weight:700;font-size:14px}',
      '#mlsFrCard .mlsfr-rows{display:block;margin:0}',
      '#mlsFrCard .mlsfr-row{display:flex;align-items:flex-start;gap:9px;padding:4px 0}',
      '#mlsFrCard .mlsfr-mark{flex:0 0 auto;position:relative;width:15px;height:15px;margin-top:2px;',
      'border:2px solid var(--line,#E7E5DD);border-radius:50%;background:transparent}',
      '#mlsFrCard .mlsfr-row.ok .mlsfr-mark{background:var(--brand,#2E6A4B);border-color:var(--brand,#2E6A4B)}',
      '#mlsFrCard .mlsfr-row.ok .mlsfr-mark:after{content:"";position:absolute;left:3px;top:0px;',
      'width:4px;height:7px;border:2px solid #ffffff;border-top:0;border-left:0;transform:rotate(42deg)}',
      '#mlsFrCard .mlsfr-row.bad .mlsfr-mark{border-color:#B4472E}',
      '#mlsFrCard .mlsfr-row.bad .mlsfr-mark:after{content:"";position:absolute;left:4px;top:2px;',
      'width:3px;height:7px;background:#B4472E;border-radius:1px}',
      '#mlsFrCard .mlsfr-text{flex:1;min-width:0}',
      '#mlsFrCard .mlsfr-label{color:var(--muted,#636E66)}',
      '#mlsFrCard .mlsfr-row.ok .mlsfr-label{color:var(--ink,#1A211C)}',
      '#mlsFrCard .mlsfr-hint{display:none;font-size:12.5px;color:var(--muted,#636E66);margin-top:1px}',
      '#mlsFrCard .mlsfr-row.bad .mlsfr-hint{display:block;color:#B4472E}',
      '#mlsFrCard .mlsfr-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:9px 0 0}',
      '#mlsFrCard button{font:inherit;cursor:pointer;border-radius:9px;padding:6px 12px;',
      'border:1px solid var(--line,#E7E5DD);background:transparent;color:var(--muted,#636E66)}',
      '#mlsFrCard button:hover{color:var(--ink,#1A211C)}',
      '#mlsFrCard button.mlsfr-primary{border-color:var(--brand,#2E6A4B);color:var(--brand,#2E6A4B);font-weight:700}',
      '#mlsFrCard .mlsfr-pull{padding:3px 10px;font-size:12.5px;margin-left:8px;white-space:nowrap}',
      /* --- tour --- */
      '#mlsFrTour{position:fixed;left:0;top:0;right:0;bottom:0;z-index:100000;',
      'font:400 14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}',
      '#mlsFrDim{position:fixed;left:0;top:0;right:0;bottom:0;background:rgba(0,0,0,.40)}',
      '#mlsFrRing{position:fixed;display:none;border-radius:12px;pointer-events:none;',
      'box-shadow:0 0 0 9999px rgba(0,0,0,.40),inset 0 0 0 2px var(--brand,#2E6A4B)}',
      '#mlsFrTourCard{position:fixed;box-sizing:border-box;width:340px;max-width:calc(100vw - 24px);',
      'background:var(--card,#ffffff);color:var(--ink,#1A211C);border:1px solid var(--line,#E7E5DD);',
      'border-top:3px solid var(--brand,#2E6A4B);border-radius:12px;padding:14px 16px;',
      'box-shadow:0 10px 30px rgba(0,0,0,.20);outline:none}',
      '#mlsFrTourCard .mlsfr-tstep{font-size:12px;font-weight:700;letter-spacing:.02em;',
      'text-transform:uppercase;color:var(--brand,#2E6A4B);margin:0 0 4px}',
      '#mlsFrTourCard .mlsfr-ttitle{font-size:15.5px;font-weight:700;margin:0 0 6px}',
      '#mlsFrTourCard .mlsfr-tbody{font-size:13.5px;color:var(--muted,#636E66)}',
      '#mlsFrTourCard .mlsfr-tnav{display:flex;align-items:center;gap:8px;margin:12px 0 0}',
      '#mlsFrTourCard .mlsfr-spacer{flex:1}',
      '#mlsFrTourCard button{font:inherit;font-size:13px;cursor:pointer;border-radius:9px;padding:6px 12px;',
      'border:1px solid var(--line,#E7E5DD);background:transparent;color:var(--muted,#636E66)}',
      '#mlsFrTourCard button:hover{color:var(--ink,#1A211C)}',
      '#mlsFrTourCard button.mlsfr-primary{border-color:var(--brand,#2E6A4B);color:var(--brand,#2E6A4B);font-weight:700}',
      '@media (max-width:520px){#mlsFrCard{padding:11px 12px}}'
    ].join('');
    safe(function () { (document.head || document.documentElement).appendChild(s); });
  }

  /* ------------------------------ checklist card -------------------------- */
  var ROWS = [
    { key: 'conn', label: 'MLS Assist installed and answering', hint: 'Install or enable the MLS Assist extension, then reload this page.' },
    { key: 'ath', label: 'athenaOne signed in', hint: 'Open athenaOne in another tab and sign in there.' },
    { key: 'day', label: 'Pull your first day', hint: '' }
  ];

  function mount() {
    if (byId(CARD_ID)) return true;
    var view = byId('visitView');
    if (!view) return false;
    css();
    var card = safe(function () { return document.createElement('div'); }, null);
    if (!card) return false;
    card.id = CARD_ID;
    card.setAttribute('role', 'region');
    card.setAttribute('aria-label', 'MLS setup checklist');
    var html = '<div class="mlsfr-head">' +
      '<div class="mlsfr-title" id="mlsFrTitle">Get MLS working - 0 of 3 done</div>' +
      '<button type="button" id="mlsFrDismiss">Dismiss</button>' +
      '</div><div class="mlsfr-rows">';
    for (var i = 0; i < ROWS.length; i++) {
      html += '<div class="mlsfr-row" id="mlsFrRow_' + ROWS[i].key + '">' +
        '<span class="mlsfr-mark" aria-hidden="true"></span>' +
        '<span class="mlsfr-text"><span class="mlsfr-label">' + ROWS[i].label + '</span>' +
        (ROWS[i].key === 'day' ? '<button type="button" class="mlsfr-pull" id="mlsFrPullBtn">Pull today</button>' : '') +
        '<span class="mlsfr-hint">' + ROWS[i].hint + '</span></span></div>';
    }
    html += '</div><div class="mlsfr-foot">' +
      '<button type="button" class="mlsfr-primary" id="mlsFrTourBtn">Show me how (2 min)</button>' +
      '</div>';
    card.innerHTML = html;

    var hero = byId('visitHero');
    var placed = safe(function () {
      if (hero && hero.parentNode === view) { view.insertBefore(card, hero); return true; }
      if (view.firstChild) { view.insertBefore(card, view.firstChild); return true; }
      view.appendChild(card); return true;
    }, false);
    if (!placed) return false;

    on(byId('mlsFrDismiss'), 'click', onDismiss);
    on(byId('mlsFrTourBtn'), 'click', onTourClick);
    on(byId('mlsFrPullBtn'), 'click', onPullClick);
    return true;
  }

  function removeCard() {
    var card = byId(CARD_ID);
    if (!card) return;
    offOne(byId('mlsFrDismiss'), 'click', onDismiss);
    offOne(byId('mlsFrTourBtn'), 'click', onTourClick);
    offOne(byId('mlsFrPullBtn'), 'click', onPullClick);
    safe(function () { card.parentNode.removeChild(card); });
  }

  function refresh() {
    var card = byId(CARD_ID);
    if (!card) return null;
    var states = { conn: connTruth(), ath: athState, day: dayTruth() };
    var done = 0, k;
    for (k in states) { if (states.hasOwnProperty(k) && states[k] === 'ok') done++; }
    setText(byId('mlsFrTitle'), 'Get MLS working - ' + done + ' of 3 done');
    for (var i = 0; i < ROWS.length; i++) {
      var key = ROWS[i].key;
      var row = byId('mlsFrRow_' + key);
      if (!row) continue;
      var st = states[key];
      setClass(row, 'mlsfr-row' + (st === 'ok' ? ' ok' : (st === 'bad' ? ' bad' : '')));
    }
    var pull = byId('mlsFrPullBtn');
    if (pull) { var wantHide = (states.day === 'ok'); if (pull.hidden !== wantHide) pull.hidden = wantHide; }

    if (done === 3) { markDone(); removeCard(); return states; }
    kickConnCheck();
    kickAthProbe();
    return states;
  }

  function onDismiss() { markDone(); removeCard(); closeTour(); }
  function onTourClick() { openTour(); }
  function onPullClick() {
    if (pullBusy() || recording()) return;
    var b = byId('mlsDsPullBtn');
    if (b) { clickPull(b); return; }
    /* The pull control lives in the Visit view; if we are elsewhere, go there
       and try once more. One bounded retry, no polling. */
    safe(function () { if (isFn(window.showView)) window.showView('visit'); });
    later(function () {
      var b2 = byId('mlsDsPullBtn');
      if (b2 && !pullBusy() && !recording()) clickPull(b2);
    }, 400);
  }
  function clickPull(b) {
    safe(function () { b.scrollIntoView({ block: 'center', inline: 'nearest' }); });
    safe(function () { b.click(); });
  }

  /* ----------------------------------- tour -------------------------------- */
  var STEPS = [
    {
      key: 'connect',
      targets: ['#assistInstallBanner', '#mlsAthenaStatusDot'],
      title: 'Sign in to athenaOne through MLS Assist',
      body: 'MLS reads your schedule and charts through the MLS Assist browser extension. Install it, open athenaOne in another tab, and sign in there. The status here turns green once MLS can see it.'
    },
    {
      key: 'pull',
      targets: ['#mlsDsPullBtn'],
      title: 'Pull today',
      body: 'One tap brings the day schedule and each patient chart from athenaOne into MLS. Pulling again later the same day updates rows, it never duplicates them.'
    },
    {
      key: 'dictate',
      targets: ['#ez3Rec', '#ez3Rec2', '#ez3QDictate'],
      title: 'Dictate',
      body: 'Pick the patient, press record, and talk to them as you normally would. No mic in the room? Use Dictate and speak the note yourself instead.'
    },
    {
      key: 'generate',
      targets: ['#ez3Adv'],
      title: 'Generate',
      body: 'When the visit ends, Generate writes the structured note from what was heard, with codes, ready for you to read.'
    },
    {
      key: 'review',
      targets: ['#noteCard', '#ez3Note'],
      title: 'Review and send',
      body: 'Read it, edit anything inline, then sign. Nothing is final until you sign it, and nothing goes back to the chart until you send it.'
    }
  ];

  var tourOpen = false, tourIdx = 0, tourReturnView = '', rafPending = false;

  function targetOf(step) {
    if (!step || !step.targets) return null;
    for (var i = 0; i < step.targets.length; i++) {
      var el = qs(step.targets[i]);
      if (!el || !visible(el)) continue;
      var r = safe(function () { return el.getBoundingClientRect(); }, null);
      if (!r || r.width <= 0 || r.height <= 0) continue;
      return el;
    }
    return null;
  }

  function positionStep() {
    var card = byId(TCARD_ID), ring = byId(RING_ID), dim = byId(DIM_ID);
    if (!card || !ring || !dim) return;
    var step = STEPS[tourIdx];
    var el = targetOf(step);
    var vw = safe(function () { return window.innerWidth || 0; }, 0);
    var vh = safe(function () { return window.innerHeight || 0; }, 0);

    /* Capture the rect and place in ONE pass: a subtree that re-renders between
       two measurements makes the second reading describe a different box. */
    var r = null;
    if (el) {
      safe(function () { el.scrollIntoView({ block: 'center', inline: 'nearest' }); });
      r = safe(function () { return el.getBoundingClientRect(); }, null);
      if (r && (r.width <= 0 || r.height <= 0)) r = null;
    }
    var onScreen = !!(r && vw > 0 && vh > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw);

    if (onScreen) {
      ring.style.display = 'block';
      ring.style.left = Math.max(0, r.left - 6) + 'px';
      ring.style.top = Math.max(0, r.top - 6) + 'px';
      ring.style.width = (r.width + 12) + 'px';
      ring.style.height = (r.height + 12) + 'px';
      dim.style.background = 'transparent';
    } else {
      ring.style.display = 'none';
      dim.style.background = 'rgba(0,0,0,.40)';
    }

    var cr = safe(function () { return card.getBoundingClientRect(); }, null);
    var cw = cr ? cr.width : 340, ch = cr ? cr.height : 200;
    var maxTop = Math.max(12, vh - ch - DOCK_CLEAR);   /* never over the dock */

    /* A missing or off-screen target degrades to a centered card. A highlight
       is never drawn at a guessed position. */
    if (!onScreen || vw < 380 || vh < 320) {
      card.style.left = Math.max(12, Math.round((vw - cw) / 2)) + 'px';
      card.style.top = Math.max(12, Math.min(maxTop, Math.round((vh - ch) / 2))) + 'px';
      return;
    }
    var top = r.bottom + 14;
    if (top > maxTop) {
      var above = r.top - ch - 14;
      top = (above >= 12) ? above : Math.min(maxTop, Math.max(12, top));
    }
    var left = r.left;
    if (left + cw > vw - 12) left = vw - cw - 12;
    if (left < 12) left = 12;
    card.style.left = Math.round(left) + 'px';
    card.style.top = Math.round(Math.max(12, top)) + 'px';
  }

  function renderStep() {
    var total = STEPS.length;
    if (tourIdx < 0) tourIdx = 0;
    if (tourIdx > total - 1) tourIdx = total - 1;
    var step = STEPS[tourIdx];
    setText(byId('mlsFrTourStep'), 'Step ' + (tourIdx + 1) + ' of ' + total);
    setText(byId('mlsFrTourTitle'), step.title);
    setText(byId('mlsFrTourBody'), step.body);
    var back = byId('mlsFrTourBack'), next = byId('mlsFrTourNext');
    if (back) { var hb = (tourIdx === 0); if (back.hidden !== hb) back.hidden = hb; }
    if (next) { var hn = (tourIdx === total - 1); if (next.hidden !== hn) next.hidden = hn; }
    positionStep();
  }

  function onKey(e) {
    if (!e) return;
    if (e.key === 'Escape' || e.keyCode === 27) { closeTour(); }
  }
  function onReflow() {
    if (!tourOpen || rafPending) return;
    rafPending = true;
    var raf = safe(function () { return window.requestAnimationFrame; }, null);
    var run = function () { rafPending = false; if (tourOpen) positionStep(); };
    if (isFn(raf)) { safe(function () { window.requestAnimationFrame(run); }); }
    else { later(run, 16); }
  }
  function onNext() { tourIdx++; renderStep(); }
  function onBack() { tourIdx--; renderStep(); }
  function onDone() { closeTour(); }

  function openTour(startAt) {
    if (tourOpen) { tourIdx = 0; renderStep(); return true; }
    css();
    var host = safe(function () { return document.body || document.documentElement; }, null);
    if (!host) return false;
    var wrap = safe(function () { return document.createElement('div'); }, null);
    if (!wrap) return false;
    wrap.id = TOUR_ID;
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', 'MLS quick tour');
    wrap.innerHTML = '<div id="' + DIM_ID + '"></div><div id="' + RING_ID + '"></div>' +
      '<div id="' + TCARD_ID + '" tabindex="-1">' +
      '<div class="mlsfr-tstep" id="mlsFrTourStep"></div>' +
      '<div class="mlsfr-ttitle" id="mlsFrTourTitle"></div>' +
      '<div class="mlsfr-tbody" id="mlsFrTourBody"></div>' +
      '<div class="mlsfr-tnav">' +
      '<button type="button" id="mlsFrTourBack">Back</button>' +
      '<span class="mlsfr-spacer"></span>' +
      '<button type="button" id="mlsFrTourDone">Done</button>' +
      '<button type="button" class="mlsfr-primary" id="mlsFrTourNext">Next</button>' +
      '</div></div>';
    safe(function () { host.appendChild(wrap); });
    tourOpen = true;
    tourIdx = (typeof startAt === 'number' && startAt >= 0 && startAt < STEPS.length) ? startAt : 0;

    /* Every step after the first points at a Visit view control. Take the user
       there for the tour and put the previous view back on close. */
    tourReturnView = safe(function () { return S(window.__mlsCurrentView); }, '');
    if (tourReturnView && tourReturnView !== 'visit') {
      safe(function () { if (isFn(window.showView)) window.showView('visit'); });
    }

    on(byId('mlsFrTourNext'), 'click', onNext);
    on(byId('mlsFrTourBack'), 'click', onBack);
    on(byId('mlsFrTourDone'), 'click', onDone);
    on(document, 'keydown', onKey, true);
    on(window, 'resize', onReflow);
    on(window, 'scroll', onReflow, true);

    renderStep();
    safe(function () { byId(TCARD_ID).focus(); });
    /* one bounded settle pass: a view switch can relayout after this frame */
    later(function () { if (tourOpen) positionStep(); }, 120);
    return true;
  }

  function closeTour() {
    if (!tourOpen) { var stray = byId(TOUR_ID); if (stray) safe(function () { stray.parentNode.removeChild(stray); }); return; }
    tourOpen = false;
    offOne(byId('mlsFrTourNext'), 'click', onNext);
    offOne(byId('mlsFrTourBack'), 'click', onBack);
    offOne(byId('mlsFrTourDone'), 'click', onDone);
    offOne(document, 'keydown', onKey);
    offOne(window, 'resize', onReflow);
    offOne(window, 'scroll', onReflow);
    var wrap = byId(TOUR_ID);
    if (wrap) safe(function () { wrap.parentNode.removeChild(wrap); });
    if (tourReturnView && tourReturnView !== 'visit') {
      var back = tourReturnView;
      safe(function () { if (isFn(window.showView)) window.showView(back); });
    }
    tourReturnView = '';
  }

  /* --------------------------------- ensure -------------------------------- */
  function ensure() {
    try {
      var card = byId(CARD_ID);
      if (isDone()) { if (card) removeCard(); return false; }
      if (!card) {
        /* Gates guard CREATION only. A card already on screen is not yanked
           away because a pull started underneath it. */
        if (sessionShown()) return false;
        if (!gatesPass()) return false;
        if (!mount()) return false;
        markSessionShown();
      }
      refresh();
      return !!byId(CARD_ID);
    } catch (e) { return false; }
  }

  function onSignal() { ensure(); }

  /* ------------------------------- boot / api ------------------------------ */
  on(window, 'mls:loader-ready', onSignal);
  on(window, 'mls:view-changed', onSignal);
  for (var li = 0; li < LADDER.length; li++) { later(ensure, LADDER[li]); }

  var api = {
    installed: true,
    version: VERSION,
    ensure: ensure,
    tour: function (startAt) { return openTour(startAt); },
    revert: function () {
      api.installed = false;
      try { closeTour(); } catch (e) {}
      try { removeCard(); } catch (e2) {}
      try { offAll(); } catch (e3) {}
      try { clearTimers(); } catch (e4) {}
      try { var s = byId(CSS_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e5) {}
      try { if (window.__mlsFirstRun === api) delete window.__mlsFirstRun; } catch (e6) {}
    },
    /* read-only internals for the contract tests */
    _steps: STEPS,
    _rows: ROWS,
    _closeTour: closeTour,
    _gates: {
      isDone: isDone, signedIn: signedIn, setupOpen: setupOpen,
      pullBusy: pullBusy, recording: recording,
      sessionShown: sessionShown, pass: gatesPass
    },
    _truth: { conn: connTruth, athena: function () { return athState; }, day: dayTruth, todayIso: todayIso },
    _refresh: refresh,
    /* drops the throttles so a caller can force a fresh readiness/signed-in
       reading; a cached verdict is not evidence of the current state */
    _resetProbeCache: function () { athAt = 0; athInFlight = false; athState = 'wait'; lastConnCheck = 0; },
    describe: function () {
      return 'first run setup checklist (#mlsFrCard above #visitHero) plus a 5 step ' +
        'on demand tour. Rows read live truth only: __mlsConnTruth readiness, ' +
        '__mlsAthenaGuard signed in probe (certain negatives only), and ' +
        '__mlsSI.authoritativeStatusForDay for the day pull. Gated on done flag, ' +
        'session, setup modal, pull busy, recording and once per browser session. ' +
        'No auto launch, no setInterval, no observers, no network, no PHI.';
    }
  };
  window.__mlsFirstRun = api;
})();
