'use strict';
/* =============================================================================
 * MLS on a phone -- feat_mls_phone_ui.js -> window.__mlsPhoneUI, ph2-1.0.0
 *
 * Owner, 2026-08-07, verbatim: "The phone version needs a lot of fixing like it
 * needs to be way simpler to use and the pulls needs to be better and simpler
 * to understand. Don't change the desktop app UI but completely change the
 * PHONE app UI from scratch."
 *
 * WHAT WAS THERE BEFORE, AND WHY REPLACING IT WAS THE ONLY HONEST FIX
 * ------------------------------------------------------------------
 * The phone did not have a UI. It had the DESKTOP UI with 28 static CSS hide
 * rules pointed at it (__mlsPhoneHome ph-1.1.0, mls-connect.js), written at
 * b261 against a layout that has since been rebuilt three times (calm shell,
 * redesign, visit focus). Every one of the six defects in
 * PHONE_AUDIT_2026-07-27.md is a direct consequence of that shape:
 *
 *   - a hide list cannot know what the layers below it moved, so the transcript
 *     was killed in three different places at once (B2);
 *   - it hid a container whose children were the ONLY recovery controls, so
 *     stopping a recording was a dead end (B3);
 *   - it left an 8-item dock that overflows a 375px screen by 48px (B1);
 *   - it hid the box every microphone error was written into (B5);
 *   - it left a burger that opens a scrim over a nav the calm shell had already
 *     removed (B4).
 *
 * Each of those was fixed by ADDING another rule to the same list, which is how
 * the list got to 28 rules. Subtracting a desktop app can never converge on a
 * phone app, because the thing you are subtracting keeps moving.
 *
 * THE OTHER PHONE APP, AND WHY THIS IS NOT IT
 * -------------------------------------------
 * app.html ("Scrivara", lane 014) is a separate, small, store-shipped phone app
 * built in parallel for the two verbs the owner named there: PULL a day, and
 * SEE a patient. It does not record, does not write notes, does not load
 * mls-connect.js, and its lane claim states plainly that it is "not fixing that
 * hide-list" and leaves ScribeFlow's phone shell "exactly as it is, still owned
 * by whoever wants it."
 *
 * This is that. The two surfaces do not overlap and must not be merged:
 *
 *   app.html                 the small app. Installed from the Home Screen or a
 *                            store. Pull, patients, read a chart. No microphone.
 *   ScribeFlow.html?phone=1  the FULL workspace on a phone — the only one of the
 *                            two that can record a visit, edit a transcript and
 *                            generate a note. That is what this module rebuilds.
 *
 * A doctor at a bedside who needs to record has to be here, and until today
 * "here" was the desktop app with a hide list on it. The Setup screen names the
 * small app and links to it, so the two are presented as a choice rather than
 * as two answers to the same question.
 *
 * WHAT THIS IS
 * ------------
 * A phone app, written for the phone, that OWNS the screen: one opaque frame,
 * three destinations, one primary action visible at a time. It is presentation
 * and navigation only. It performs no clinical work of its own -- every action
 * runs through the engine's OWN published entry points:
 *
 *   __mlsEasyV32.remote   snapshot / startVisitFor / record / stopRecording /
 *                         generate / requestSendReview  (the whitelist the
 *                         engine already exposes for exactly this purpose --
 *                         same context lock, same identity check, same phase
 *                         machine as the on-screen desktop buttons)
 *   __mlsDaySwitch        currentDay / setDay / shiftDay / rowsFor / pullDay
 *   __mlsRelayLink        activeJob / cancelActive / extPresent
 *   __mlsDeviceRole       role / name / os / deviceNoun
 *
 * So there is no second engine, no second pull path, no second recorder, and no
 * clinical rule stated twice. Reverting this module (revert()) puts the old
 * phone experience back untouched, because nothing it does is destructive.
 *
 * THE PULL, WHICH IS THE PART THE OWNER SINGLED OUT
 * ------------------------------------------------
 * On a phone the pull is a relay: the phone asks, the OFFICE COMPUTER reads
 * Athena, and the result syncs back. The old phone surface expressed that as a
 * button labelled "Pull today" beside a raw engine sentence, inside a strip
 * built for a 1440px toolbar. A doctor holding a phone could not tell whether
 * "Waiting for your office computer... (MLS must be open there)" meant working,
 * stuck, or broken.
 *
 * The card here answers, in order, the only three questions a phone can be
 * asked about a pull:
 *   1. Do I have today's patients?     ("7 patients ready for today")
 *   2. Is something happening now?     (a live line + a Stop that really cancels)
 *   3. If not, what do I press?        (exactly ONE button, named for the state)
 * The engine's own sentence is never hidden -- it is kept underneath as the
 * detail line, because a plain-language headline that replaces the truth is how
 * this product has been burned before (a toast announcing a save over a silent
 * refusal). The headline is ours; the sentence is the engine's.
 *
 * WHY IT NEVER TOUCHES A DESKTOP
 * ------------------------------
 * owns() delegates to __mlsPhoneHome.wantPhone(), so there is exactly one
 * definition of "this device is a phone" in the product, and it is the one
 * device-role-contract.test.js already pins (window size never classifies; an
 * explicit role always wins). The loader in mls-connect.js additionally refuses
 * to even REQUEST this file unless the device is a handheld, an explicit phone
 * role is stored, or ?phone=1 was used -- so on the office computer this module
 * costs zero bytes and zero milliseconds.
 *
 * AND IT NEVER CALLS A DESKTOP A PHONE
 * ------------------------------------
 * Every sentence that refers to the device the doctor is holding asks
 * __mlsDeviceRole.deviceNoun() for the word. On an iPhone it says "iPhone", on
 * a MacBook opened with ?phone=1 it says "Mac". "Phone mode" as a fixed label
 * on a laptop screen is the same class of defect as any other line of UI that
 * asserts something untrue.
 *
 * TIMERS: this module installs NO setInterval. A phone spends most of its life
 * in a pocket, and an interval keeps firing there. The ticker is a setTimeout
 * loop that runs only while something is genuinely live (recording, generating,
 * or pulling) AND the tab is visible; it stops on hide and restarts on show.
 * Idle, mounted, screen off => zero timers. The MutationObserver is scoped to
 * #mlsEz3Body, never to the document.
 *
 * Reversible: window.__mlsPhoneUI.revert(). ES5.
 * ===========================================================================*/
(function () {
  if (window.__mlsPhoneUI) return;
  var VERSION = 'ph2-1.0.0';
  var api = { installed: true, version: VERSION };
  window.__mlsPhoneUI = api;

  var SETUP_URL = 'https://mlsscribe.com/phone-setup.html';
  var SMALL_APP_URL = 'https://mlsscribe.com/app.html';

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function toast(m, k) { safe(function () { if (typeof window.toast === 'function') window.toast(m, k || ''); }); }
  function easy() { return safe(function () { return window.__mlsEasyV32; }, null); }
  function remote() { var e = easy(); return (e && e.remote) ? e.remote : null; }
  function daySwitch() { return safe(function () { return window.__mlsDaySwitch; }, null); }
  function relay() { return safe(function () { return window.__mlsRelayLink; }, null); }
  function deviceRole() { return safe(function () { return window.__mlsDeviceRole; }, null); }

  /* ---------------------------------------------------------------------------
   * The word for the thing in the doctor's hand.
   * __mlsDeviceRole.deviceNoun() is canonical. The fallback exists only for the
   * window between this module landing and that module landing, and it makes the
   * same promise: it says "phone" only when the evidence says handheld.
   * -------------------------------------------------------------------------*/
  function deviceNoun() {
    var dr = deviceRole();
    if (dr && typeof dr.deviceNoun === 'function') { var n = safe(function () { return dr.deviceNoun(); }, ''); if (n) return n; }
    var ua = safe(function () { return navigator.userAgent || ''; }, '');
    if (/iPhone|iPod/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android phone' : 'Android tablet';
    if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'Windows PC';
    return 'device';
  }
  function thisDevice() { return 'this ' + deviceNoun(); }
  api.deviceNoun = deviceNoun;

  /* ---------------------------------------------------------------------------
   * Ownership. ONE definition of "phone", borrowed from the module that already
   * owns it, so the two surfaces can never disagree about which UI is correct.
   * -------------------------------------------------------------------------*/
  function owns() {
    var ph = safe(function () { return window.__mlsPhoneHome; }, null);
    if (ph && typeof ph.wantPhone === 'function') return !!safe(function () { return ph.wantPhone(); }, false);
    /* Pre-mount fallback: the same evidence rule, never window width. */
    return !!safe(function () {
      if (sessionStorage.getItem('mls_phone_mode') === '1') return true;
      if (sessionStorage.getItem('mls_phone_mode') === '0') return false;
      var dr = deviceRole();
      if (dr && typeof dr.role === 'function') { var r = dr.role(); if (r) return r === 'phone'; }
      return /iPhone|iPod|Android.*Mobile|Mobile.*Android|Windows Phone/i.test(navigator.userAgent || '') &&
        ((navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window);
    }, false);
  }
  api.owns = owns;

  /* Signed in? Before that the app owns the screen with its own login surface,
     and covering it with a phone shell would hide the only way in. */
  function authed() {
    return !!safe(function () {
      return typeof window.backendMode === 'function' && window.backendMode() &&
        typeof window.bkToken === 'function' && !!window.bkToken();
    }, false);
  }

  /* ===========================================================================
   * STYLE
   * z-index 7000 sits ABOVE every app view (5000/6000) and the dock (920), and
   * BELOW every modal, overlay and toast (9000+). That is deliberate: a confirm
   * card, the settings modal and every toast must still reach the doctor, and
   * they are the surfaces this module is not allowed to reinvent.
   * =========================================================================*/
  var st = document.createElement('style');
  st.id = 'mlsPh2Css';
  st.textContent = [
    ':root{--ph2-ink:#12201A;--ph2-dim:#67736C;--ph2-line:#E3E8E4;--ph2-bg:#F6F8F6;--ph2-card:#FFFFFF;',
    '--ph2-green:#204034;--ph2-green2:#2E6A4B;--ph2-red:#A3231F;--ph2-amber:#8A5A00;}',

    /* The one structural rule. Everything the desktop puts on top of the app is
       chrome this screen does not have room for; the frame below replaces it. */
    'body.mls-ph2 #appHeader, body.mls-ph2 .mainnav, body.mls-ph2 #patientBar,',
    'body.mls-ph2 #mlsDock, body.mls-ph2 #mlsRightNow, body.mls-ph2 #mlsStages,',
    'body.mls-ph2 #mlsFab, body.mls-ph2 #mlsFabMenu, body.mls-ph2 #mlsDaDock,',
    'body.mls-ph2 #mlsAsstFab, body.mls-ph2 #mlsCopVoiceBtn, body.mls-ph2 #mlsTabPickerChip,',
    'body.mls-ph2 #mlsRdRailBtn, body.mls-ph2 #mlsRdNav, body.mls-ph2 #_patientFace,',
    'body.mls-ph2 #mlsVoiceCluster, body.mls-ph2 #mlsPhExit{display:none!important}',
    /* The backup-failure badge is NOT hidden - it reports a real problem with
       saving the doctor's work. It is lifted clear of the tab bar instead. */
    'body.mls-ph2 #_backupBadge{bottom:calc(84px + env(safe-area-inset-bottom))!important;z-index:7100!important}',

    '#mlsPh2{position:fixed;inset:0;z-index:7000;display:flex;flex-direction:column;',
    'background:var(--ph2-bg);color:var(--ph2-ink);',
    "font-family:'Public Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;",
    '-webkit-tap-highlight-color:transparent;}',
    '#mlsPh2 *{box-sizing:border-box}',
    '#mlsPh2 button{font-family:inherit}',

    /* header */
    '#mlsPh2Hdr{flex:none;display:flex;align-items:center;gap:10px;background:var(--ph2-green);color:#fff;',
    'padding:calc(env(safe-area-inset-top) + 10px) 16px 12px;}',
    '#mlsPh2Hdr .ph2-t{font:800 17px/1.2 inherit;letter-spacing:.2px}',
    '#mlsPh2Hdr .ph2-s{font:500 12px/1.3 inherit;opacity:.82;margin-top:2px}',
    '#mlsPh2Hdr .ph2-grow{flex:1;min-width:0}',
    '#mlsPh2Hdr .ph2-dot{flex:none;width:44px;height:44px;border:0;border-radius:14px;background:rgba(255,255,255,.16);',
    'color:#fff;font-size:19px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center}',

    /* scrolling body. overscroll-behavior stops the page underneath scrolling
       when this list reaches its end. */
    '#mlsPh2Body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;',
    '-webkit-overflow-scrolling:touch;padding:14px 14px 22px;}',

    /* tab bar - three destinations, 64px tall, nothing else competes */
    '#mlsPh2Tabs{flex:none;display:flex;background:var(--ph2-card);border-top:1px solid var(--ph2-line);',
    'padding-bottom:env(safe-area-inset-bottom);box-shadow:0 -2px 14px rgba(18,32,26,.06)}',
    '#mlsPh2Tabs button{flex:1;min-width:0;min-height:64px;border:0;background:transparent;cursor:pointer;',
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;',
    'color:var(--ph2-dim);font:600 11.5px/1.1 inherit;padding:6px 4px}',
    '#mlsPh2Tabs button .ph2-ic{font-size:21px;line-height:1}',
    '#mlsPh2Tabs button[aria-current="page"]{color:var(--ph2-green);font-weight:800}',
    '#mlsPh2Tabs button:active{background:#EEF3EF}',

    /* cards */
    '#mlsPh2 .ph2-card{background:var(--ph2-card);border:1px solid var(--ph2-line);border-radius:16px;',
    'padding:15px 16px;margin:0 0 12px;box-shadow:0 1px 2px rgba(18,32,26,.04)}',
    '#mlsPh2 .ph2-h{font:800 16px/1.3 inherit;margin:0 0 4px}',
    '#mlsPh2 .ph2-p{font:500 13.5px/1.5 inherit;color:var(--ph2-dim);margin:0}',
    '#mlsPh2 .ph2-detail{font:500 12px/1.45 inherit;color:var(--ph2-dim);margin:9px 0 0;',
    'padding-top:9px;border-top:1px solid var(--ph2-line);word-break:break-word}',

    /* exactly one primary shape in the whole app */
    '#mlsPh2 .ph2-primary{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;',
    'min-height:56px;margin:13px 0 0;border:0;border-radius:14px;background:var(--ph2-green);color:#fff;',
    'font:800 16.5px/1.2 inherit;cursor:pointer;padding:12px 16px}',
    '#mlsPh2 .ph2-primary:active{transform:scale(.985)}',
    '#mlsPh2 .ph2-primary[disabled]{background:#C3CFC8;color:#F4F7F5;cursor:default}',
    '#mlsPh2 .ph2-primary.ph2-stop{background:var(--ph2-red)}',
    '#mlsPh2 .ph2-secondary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;',
    'min-height:48px;margin:9px 0 0;border:1px solid var(--ph2-line);border-radius:13px;background:#fff;',
    'color:var(--ph2-ink);font:700 14.5px/1.2 inherit;cursor:pointer;padding:10px 14px}',
    '#mlsPh2 .ph2-secondary:active{background:#F1F4F2}',

    /* day switcher */
    '#mlsPh2 .ph2-day{display:flex;align-items:center;gap:8px;margin:0 0 12px}',
    '#mlsPh2 .ph2-day button{flex:none;width:48px;height:48px;border:1px solid var(--ph2-line);',
    'border-radius:13px;background:#fff;color:var(--ph2-ink);font-size:20px;line-height:1;cursor:pointer}',
    '#mlsPh2 .ph2-day .ph2-dl{flex:1;min-width:0;text-align:center;font:700 14.5px/1.25 inherit}',
    '#mlsPh2 .ph2-day .ph2-dl small{display:block;font:500 12px/1.3 inherit;color:var(--ph2-dim);margin-top:2px}',

    /* patient rows - the whole row is the target */
    '#mlsPh2 .ph2-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;',
    'background:var(--ph2-card);border:1px solid var(--ph2-line);border-radius:14px;padding:13px 14px;',
    'margin:0 0 9px;min-height:66px;cursor:pointer;color:inherit;font:inherit}',
    '#mlsPh2 .ph2-row:active{background:#F1F4F2}',
    '#mlsPh2 .ph2-row .ph2-time{flex:none;width:62px;font:700 13px/1.3 inherit;color:var(--ph2-green2)}',
    '#mlsPh2 .ph2-row .ph2-nm{flex:1;min-width:0;font:700 15px/1.3 inherit;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#mlsPh2 .ph2-row .ph2-nm small{display:block;font:500 12px/1.35 inherit;color:var(--ph2-dim);margin-top:2px;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#mlsPh2 .ph2-row .ph2-go{flex:none;color:var(--ph2-dim);font-size:19px;line-height:1}',
    '#mlsPh2 .ph2-row.ph2-on{border-color:var(--ph2-green2);box-shadow:0 0 0 1px var(--ph2-green2) inset}',
    '#mlsPh2 .ph2-seen{flex:none;font:700 11px/1 inherit;color:var(--ph2-green2);background:#E8F2EC;',
    'border-radius:999px;padding:5px 8px}',

    /* the recording surface */
    '#mlsPh2 .ph2-rec{display:flex;flex-direction:column;align-items:center;gap:10px;padding:6px 0 2px}',
    '#mlsPh2 .ph2-timer{font:800 34px/1 ui-monospace,Menlo,monospace;letter-spacing:1px}',
    '#mlsPh2 .ph2-live{display:inline-flex;align-items:center;gap:8px;font:700 13px/1 inherit;color:var(--ph2-red)}',
    '#mlsPh2 .ph2-blip{width:11px;height:11px;border-radius:50%;background:var(--ph2-red)}',
    '@media (prefers-reduced-motion: no-preference){',
    '  #mlsPh2 .ph2-blip{animation:ph2Blip 1.4s ease-in-out infinite}',
    '  @keyframes ph2Blip{0%,100%{opacity:1}50%{opacity:.25}}',
    '}',
    '#mlsPh2 .ph2-tx{width:100%;min-height:190px;border:1px solid var(--ph2-line);border-radius:13px;',
    'padding:12px 13px;font:500 14.5px/1.6 inherit;color:var(--ph2-ink);background:#fff;resize:vertical;',
    '-webkit-appearance:none}',
    /* 16px minimum, or iOS Safari zooms the whole page on focus and the doctor
       loses the layout mid-visit. */
    '#mlsPh2 textarea, #mlsPh2 input{font-size:16px}',

    /* status colours - never colour alone, always with words */
    '#mlsPh2 .ph2-ok{color:var(--ph2-green2)}',
    '#mlsPh2 .ph2-warn{color:var(--ph2-amber)}',
    '#mlsPh2 .ph2-bad{color:var(--ph2-red)}',
    '#mlsPh2 .ph2-empty{text-align:center;padding:26px 12px;color:var(--ph2-dim);font:500 14px/1.6 inherit}',
    '#mlsPh2 .ph2-steps{margin:10px 0 0;padding:0 0 0 20px;font:500 13.5px/1.7 inherit;color:var(--ph2-ink)}',
    '#mlsPh2 .ph2-steps li{margin:0 0 4px}',
    '#mlsPh2 .ph2-kv{display:flex;gap:10px;font:500 13px/1.6 inherit;color:var(--ph2-dim);margin:2px 0}',
    '#mlsPh2 .ph2-kv b{flex:none;width:104px;color:var(--ph2-ink);font-weight:700}'
  ].join('\n');
  (document.head || document.documentElement).appendChild(st);

  /* ===========================================================================
   * FRAME
   * =========================================================================*/
  var S = {
    tab: 'today',
    mounted: false,
    lastSig: '',
    pullDetail: '',
    installEvt: null
  };
  api.state = function () { return { tab: S.tab, mounted: S.mounted }; };

  var frame = null, bodyEl = null, hdrEl = null, tabsEl = null;

  function mount() {
    if (frame && frame.isConnected) return frame;
    frame = document.createElement('div');
    frame.id = 'mlsPh2';
    frame.setAttribute('role', 'application');
    frame.setAttribute('aria-label', 'MLS');
    frame.innerHTML =
      '<div id="mlsPh2Hdr">' +
        '<div class="ph2-grow"><div class="ph2-t" id="mlsPh2Title">MLS</div><div class="ph2-s" id="mlsPh2Sub"></div></div>' +
        '<button type="button" class="ph2-dot" id="mlsPh2Help" aria-label="Setup and help">☰</button>' +
      '</div>' +
      '<div id="mlsPh2Body"></div>' +
      '<div id="mlsPh2Tabs" role="tablist">' +
        '<button type="button" data-tab="today" role="tab"><span class="ph2-ic" aria-hidden="true">📋</span>Today</button>' +
        '<button type="button" data-tab="visit" role="tab"><span class="ph2-ic" aria-hidden="true">🎙️</span>Visit</button>' +
        '<button type="button" data-tab="setup" role="tab"><span class="ph2-ic" aria-hidden="true">⚙️</span>Setup</button>' +
      '</div>';
    document.body.appendChild(frame);
    bodyEl = $('mlsPh2Body'); hdrEl = $('mlsPh2Hdr'); tabsEl = $('mlsPh2Tabs');
    tabsEl.addEventListener('click', function (ev) {
      var b = ev.target && ev.target.closest ? ev.target.closest('button[data-tab]') : null;
      if (!b) return;
      go(b.getAttribute('data-tab'));
    });
    $('mlsPh2Help').addEventListener('click', function () { go('setup'); });
    document.body.classList.add('mls-ph2');
    S.mounted = true;
    return frame;
  }

  function unmount() {
    try { if (frame && frame.parentNode) frame.parentNode.removeChild(frame); } catch (e) {}
    frame = bodyEl = hdrEl = tabsEl = null;
    try { document.body.classList.remove('mls-ph2'); } catch (e) {}
    S.mounted = false; S.lastSig = '';
  }

  function go(tab) {
    if (tab !== 'today' && tab !== 'visit' && tab !== 'setup') tab = 'today';
    S.tab = tab;
    S.lastSig = '';
    /* The engine's own view must follow, or a Send confirm card would open on a
       screen the doctor is not looking at. */
    if (tab === 'visit') safe(function () { if (typeof window.showView === 'function') window.showView('visit'); });
    render();
    safe(function () { if (bodyEl) bodyEl.scrollTop = 0; });
    tick();
  }
  api.go = go;

  /* ===========================================================================
   * ENGINE READS
   * =========================================================================*/
  function snap() {
    var r = remote();
    if (!r || typeof r.snapshot !== 'function') return null;
    return safe(function () { return r.snapshot(); }, null);
  }
  function today() {
    var d = daySwitch();
    var k = safe(function () { return d && d.currentDay ? d.currentDay() : ''; }, '');
    if (k) return k;
    var sn = snap();
    return (sn && sn.day) || '';
  }
  /* "Today" belongs to the PRACTICE time zone, never the device clock — a phone
     carried across a time-zone line must not silently re-date the schedule. */
  function todayKey() {
    var k = safe(function () { return typeof window._acctTodayKey === 'function' ? window._acctTodayKey() : ''; }, '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return k;
    var t = $('mlsDsTodayBtn');
    if (t && t.disabled) return today();   /* the strip disables it only on Today */
    return '';
  }
  /* The engine's own row model (snapshot.today) is preferred: it is the shape
     built for exactly this caller, and it carries `seen`, which the raw
     appointment objects do not. rowsFor is the fallback for the window before
     the engine has mounted. */
  function rows() {
    var sn = snap();
    if (sn && sn.today && sn.today.length != null) return sn.today;
    var d = daySwitch();
    if (d && typeof d.rowsFor === 'function') {
      var out = safe(function () { return d.rowsFor(d.currentDay()); }, null);
      if (out && out.length != null) return out;
    }
    return [];
  }
  function transcriptEl() { return $('transcript'); }
  function transcriptText() { var t = transcriptEl(); return t ? String(t.value || '') : ''; }
  function noteText() { var n = $('noteBox'); return n ? String(n.value || '') : ''; }

  /* Pulling? The day-switch engine disables its own button for the whole run
     (local AND relay), and the relay records an active job. Either is proof. */
  function pulling() {
    var b = $('mlsDsPullBtn');
    if (b && b.disabled) return true;
    var rl = relay();
    return !!(rl && typeof rl.activeJob === 'function' && safe(function () { return rl.activeJob(); }, null));
  }
  /* The engine's own sentence. Never rewritten - only ever shown underneath. */
  function pullSentence() {
    var s = $('mlsDsStatus');
    if (!s) return '';
    if (s.style && s.style.display === 'none') return '';
    return String(s.textContent || '').trim();
  }

  function fmtDayLabel(key) {
    var k = String(key || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return { main: 'Today', sub: '' };
    var parts = k.split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    var names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    var isToday = (k === todayKey());
    return {
      main: (isToday ? 'Today' : names[d.getDay()]),
      sub: months[d.getMonth()] + ' ' + d.getDate() + ', ' + parts[0],
      isToday: isToday
    };
  }
  function rowName(a) { return String((a && a.name) || '').trim() || 'Unnamed patient'; }
  function rowTime(a) {
    if (!a) return '';
    var t = String(a.time || a.time_display || a.start_local || '').trim();
    if (!t) return '';
    var m = t.match(/(\d{1,2}):(\d{2})/);
    if (!m) return t.slice(0, 8);
    var h = Number(m[1]), mm = m[2];
    if (/[AaPp][Mm]/.test(t)) return (h % 13 || h) + ':' + mm + (/[Pp][Mm]/.test(t) ? ' PM' : ' AM');
    var ap = h >= 12 ? 'PM' : 'AM', h12 = h % 12; if (!h12) h12 = 12;
    return h12 + ':' + mm + ' ' + ap;
  }
  function rowId(a) {
    return String((a && (a.id || a.appointmentId || a.appointment_id || a.apptId || a.appt_id)) || '');
  }

  /* ===========================================================================
   * SCREEN: TODAY  -- the day, the pull, the patients. Nothing else.
   * =========================================================================*/
  function pullCard() {
    var sentence = pullSentence();
    var n = rows().length;
    var busy = pulling();
    var d = fmtDayLabel(today());
    var head, sub, btn, cls = '';

    if (busy) {
      head = 'Getting your patients…';
      sub = relaying()
        ? 'Your office computer is reading Athena. You can leave this screen — it keeps going.'
        : 'Reading Athena now. You can leave this screen — it keeps going.';
      btn = { label: '■ Stop', act: 'pull-stop', stop: true };
    } else if (n > 0) {
      head = n + ' patient' + (n === 1 ? '' : 's') + ' ready for ' + (d.isToday ? 'today' : d.main);
      sub = 'Tap a name below to start their visit.';
      btn = { label: '↻ Check Athena again', act: 'pull-start', secondary: true };
    } else {
      head = 'No patients loaded for ' + (d.isToday ? 'today' : d.main) + ' yet';
      sub = relaying()
        ? 'Get them from Athena. The reading happens on your office computer and the list appears here.'
        : 'Get them from Athena.';
      btn = { label: '📥 Get ' + (d.isToday ? "today's" : "that day's") + ' patients', act: 'pull-start' };
    }

    /* A blocked relay is the single most common reason a pull does nothing, and
       it is knowable BEFORE the doctor presses anything. Say it here. */
    var block = relayBlock();
    if (!busy && block) { cls = 'ph2-warn'; sub = block.why; }

    var h = '<div class="ph2-card">' +
      '<p class="ph2-h ' + cls + '">' + esc(head) + '</p>' +
      '<p class="ph2-p">' + esc(sub) + '</p>';
    if (!busy && block) {
      h += '<button type="button" class="ph2-secondary" data-act="setup">What to do →</button>';
    }
    h += '<button type="button" class="ph2-' + (btn.secondary ? 'secondary' : 'primary') + (btn.stop ? ' ph2-stop' : '') +
      '" data-act="' + btn.act + '">' + esc(btn.label) + '</button>';
    /* The engine's own words, kept verbatim under a rule. A headline that
       REPLACES the truth is the failure mode this product already knows. */
    if (sentence) h += '<p class="ph2-detail">' + esc(sentence) + '</p>';
    h += '</div>';
    return h;
  }

  function relaying() {
    var rl = relay();
    return !!(rl && typeof rl.shouldRelay === 'function' && safe(function () { return rl.shouldRelay(); }, false));
  }
  /* Known-before-you-press reasons a relayed pull cannot succeed. Kept to what
     THIS device can actually observe; the live presence line in Setup owns the
     detailed office-computer verdict. */
  function relayBlock() {
    if (!relaying()) return null;
    if (!authed()) return { why: 'Sign in first — the pull runs against your account.' };
    var p = api._presence;
    if (!p) return null;
    if (!p.officeName) {
      return { why: 'No office computer is set up yet, so there is nothing to read Athena for you.' };
    }
    if (!p.online) {
      return { why: p.officeName + ' is not reachable right now. It has to be awake with MLS open.' };
    }
    if (p.online && !p.ext) {
      return { why: 'MLS Assist is not responding on ' + p.officeName + ', so it cannot read Athena.' };
    }
    if (p.officeAth === 'no-tab') {
      return { why: 'athenaOne is signed out on ' + p.officeName + '. Sign in there first.' };
    }
    return null;
  }

  function todayScreen() {
    var d = fmtDayLabel(today());
    var list = rows();
    var sn = snap();
    var activeId = sn && sn.active ? String(sn.active.id || '') : '';

    var h = '<div class="ph2-day">' +
      '<button type="button" data-act="day-prev" aria-label="Previous day">‹</button>' +
      '<span class="ph2-dl">' + esc(d.main) + '<small>' + esc(d.sub) + '</small></span>' +
      '<button type="button" data-act="day-next" aria-label="Next day">›</button>' +
      '</div>';
    h += pullCard();

    if (!list.length) {
      h += '<div class="ph2-empty">Nothing scheduled here yet.<br>You can still record a walk-in from the Visit tab.</div>';
    } else {
      for (var i = 0; i < list.length; i++) {
        var a = list[i], id = rowId(a);
        var seen = !!(a && (a.seen === true));
        h += '<button type="button" class="ph2-row' + (id && id === activeId ? ' ph2-on' : '') + '" data-act="open" data-id="' + esc(id) + '">' +
          '<span class="ph2-time">' + esc(rowTime(a) || '—') + '</span>' +
          '<span class="ph2-nm">' + esc(rowName(a)) +
            (a && a.provider ? '<small>' + esc(String(a.provider)) + '</small>' : '') +
          '</span>' +
          (seen ? '<span class="ph2-seen">done</span>' : '') +
          '<span class="ph2-go" aria-hidden="true">›</span>' +
          '</button>';
      }
    }
    return h;
  }

  /* ===========================================================================
   * SCREEN: VISIT -- one primary action, chosen by the engine's own phase.
   * idle -> record | rec -> stop | stopped -> write the note | gen -> waiting |
   * note -> the note, and the send the desktop confirms.
   * =========================================================================*/
  function visitScreen() {
    var sn = snap();
    if (!sn) {
      return '<div class="ph2-card"><p class="ph2-h">Still starting up</p>' +
        '<p class="ph2-p">The visit engine has not finished loading yet. This screen fills in on its own.</p></div>';
    }
    if (!sn.active) {
      return '<div class="ph2-card">' +
        '<p class="ph2-h">Pick a patient first</p>' +
        '<p class="ph2-p">Choose a name on the Today tab, and this screen becomes their visit.</p>' +
        '<button type="button" class="ph2-primary" data-act="tab-today">📋 Go to Today</button>' +
        '</div>';
    }

    var phase = String(sn.phase || 'idle');
    var name = String(sn.active.name || 'This patient');
    var h = '<div class="ph2-card">' +
      '<p class="ph2-h">' + esc(name) + '</p>' +
      '<p class="ph2-p">' + esc([sn.active.time || '', sn.active.dob ? 'DOB ' + sn.active.dob : ''].filter(Boolean).join(' · ') || 'Visit in progress') + '</p>';

    if (phase === 'rec') {
      var secs = Number(sn.recSecs || 0);
      h += '<div class="ph2-rec">' +
        '<span class="ph2-live"><span class="ph2-blip" aria-hidden="true"></span>Recording</span>' +
        '<span class="ph2-timer">' + pad2(Math.floor(secs / 60)) + ':' + pad2(secs % 60) + '</span>' +
        '</div>' +
        '<button type="button" class="ph2-primary ph2-stop" data-act="stop">■ Stop recording</button>';
    } else if (phase === 'gen') {
      h += '<button type="button" class="ph2-primary" disabled>✨ Writing the note…</button>' +
        '<p class="ph2-p" style="margin-top:9px">This takes a few seconds. Your transcript is safe below.</p>';
    } else if (phase === 'note') {
      h += '<button type="button" class="ph2-primary" data-act="send">📤 Send for review</button>' +
        '<button type="button" class="ph2-secondary" data-act="copy-note">⧉ Copy the note</button>' +
        '<button type="button" class="ph2-secondary" data-act="record">🎙 Record more</button>';
    } else if (phase === 'stopped') {
      h += '<button type="button" class="ph2-primary" data-act="generate">✨ Write the note</button>' +
        '<button type="button" class="ph2-secondary" data-act="record">🎙 Keep recording</button>';
    } else {
      h += '<button type="button" class="ph2-primary" data-act="record">● Start recording</button>';
    }

    /* The engine's binding/refusal notice. It is the sentence that explains why
       a control just refused, and on the old phone it lived inside chrome the
       hide list had removed — a refusal with no visible reason. */
    if (sn.warn) h += '<p class="ph2-detail ph2-warn">' + esc(String(sn.warn)) + '</p>';
    h += '</div>';

    /* The transcript. It is EDITABLE here, always. Its absence on the phone was
       audit defect B2, and a read-only copy would only be defect B3 again. */
    var tx = transcriptText();
    h += '<div class="ph2-card">' +
      '<p class="ph2-h">What was said</p>' +
      '<p class="ph2-p">' + (tx.trim() ? 'Tap to correct anything before the note is written.' : 'This fills in as you speak. You can also type it.') + '</p>' +
      '<textarea class="ph2-tx" id="mlsPh2Tx" aria-label="Visit transcript" placeholder="The conversation appears here as you speak.">' + esc(tx) + '</textarea>' +
      '</div>';

    if (phase === 'note') {
      h += '<div class="ph2-card">' +
        '<p class="ph2-h">The note</p>' +
        '<textarea class="ph2-tx" id="mlsPh2Note" aria-label="Generated note" style="min-height:240px">' + esc(noteText()) + '</textarea>' +
        '</div>';
    }
    return h;
  }
  function pad2(n) { n = Number(n) || 0; return (n < 10 ? '0' : '') + n; }

  /* ===========================================================================
   * SCREEN: SETUP -- what this device is, where pulls run, how to install.
   * =========================================================================*/
  function setupScreen() {
    var dr = deviceRole();
    var noun = deviceNoun();
    var role = safe(function () { return dr && dr.role ? dr.role() : null; }, null);
    /* The role's own registry calls this one "Phone / remote", which reads as a
       claim about the hardware on a MacBook that legitimately holds it. Name
       what the role DOES instead — that sentence is true on every device that
       can carry it. */
    var roleWord = role === 'office' ? 'Office computer — it reads Athena'
      : role === 'secondary' ? 'Second computer — pulls relay to the office'
      : role === 'phone' ? 'Remote — the simple layout'
      : 'Not chosen yet';
    var name = safe(function () { return dr && dr.name ? dr.name() : ''; }, '');

    var h = '<div class="ph2-card">' +
      '<p class="ph2-h">This ' + esc(noun) + '</p>' +
      '<div class="ph2-kv"><b>Name</b><span>' + esc(name || noun) + '</span></div>' +
      '<div class="ph2-kv"><b>Set up as</b><span>' + esc(roleWord) + '</span></div>' +
      '</div>';

    /* Where pulls run. The live presence line, in sentences. */
    var p = api._presence;
    var head, why, steps = [];
    if (!relaying()) {
      head = 'Athena reads run on this ' + noun;
      why = 'MLS Assist is installed here, so there is nothing to relay.';
    } else if (!p) {
      head = 'Checking your office computer…';
      why = 'One moment.';
    } else if (!p.officeName) {
      head = 'No office computer yet';
      why = 'Pulls you start here need one computer that reads Athena for you.';
      steps = ['On the Windows or Mac computer that has the MLS Assist extension, open MLS.',
        'Go to Settings → Integrations.',
        'Set that computer\'s role to "Office computer".'];
    } else if (p.online && p.ext && p.officeAth === 'no-tab') {
      head = 'athenaOne is signed out on ' + p.officeName;
      why = 'MLS can reach that computer, but Athena will not let it read anything.';
      steps = ['On ' + p.officeName + ', open athenaOne and sign in.', 'Come back here and pull again.'];
    } else if (p.online && p.ext) {
      head = p.officeName + ' is ready';
      why = 'Pulls you start here run there' + (p.ageSec != null ? ' (last checked in ' + p.ageSec + 's ago)' : '') + '.';
    } else if (p.online && !p.ext && /^(iOS|iPadOS|Android)$/.test(String(p.officeOs || ''))) {
      head = p.officeName + ' cannot run pulls';
      why = 'It is set as your office computer, but MLS Assist is a Chrome desktop extension and ' + p.officeOs + ' cannot install one.';
      steps = ['On the Windows or Mac computer that has MLS Assist, open Settings → Integrations.',
        'Set THAT computer\'s role to "Office computer".'];
    } else if (p.online && !p.ext) {
      head = 'MLS Assist is not responding on ' + p.officeName;
      why = 'The computer is awake, but the extension that reads Athena is not answering.';
      steps = ['On ' + p.officeName + ', open chrome://extensions.', 'Find MLS Assist and press ↻ Reload.', 'Leave MLS open there.'];
    } else {
      head = p.officeName + ' is not reachable';
      why = 'It was last seen ' + (p.ageSec != null ? Math.round(p.ageSec / 60) + ' minutes ago' : 'a while ago') + '. A sleeping computer cannot read Athena.';
      steps = ['Wake ' + p.officeName + '.', 'Open MLS there and leave it open.'];
    }
    h += '<div class="ph2-card">' +
      '<p class="ph2-h">Where Athena pulls run</p>' +
      '<p class="ph2-p" style="color:var(--ph2-ink);font-weight:700;margin:0 0 4px">' + esc(head) + '</p>' +
      '<p class="ph2-p">' + esc(why) + '</p>';
    if (steps.length) {
      h += '<ol class="ph2-steps">';
      for (var i = 0; i < steps.length; i++) h += '<li>' + esc(steps[i]) + '</li>';
      h += '</ol>';
    }
    h += '</div>';

    /* Install. On Android beforeinstallprompt gives a REAL install button; on
       iOS no such API exists, so the steps are the honest answer. */
    var plat = platform();
    h += '<div class="ph2-card"><p class="ph2-h">Keep MLS on your Home Screen</p>';
    if (S.installEvt) {
      h += '<p class="ph2-p">One tap and MLS gets its own icon, with no browser bars.</p>' +
        '<button type="button" class="ph2-primary" data-act="install">⤓ Add MLS to my Home Screen</button>';
    } else if (standalone()) {
      h += '<p class="ph2-p">✓ Already installed — you are running the app version right now.</p>';
    } else if (plat === 'ios') {
      h += '<p class="ph2-p">Three taps, and MLS opens like an app with no browser bars.</p>' +
        '<ol class="ph2-steps"><li>Tap the Share button <b>⬆︎</b> at the bottom of Safari.</li>' +
        '<li>Scroll down and tap <b>Add to Home Screen</b>.</li>' +
        '<li>Tap <b>Add</b>.</li></ol>';
    } else if (plat === 'android') {
      h += '<p class="ph2-p">Three taps, and MLS opens like an app with no browser bars.</p>' +
        '<ol class="ph2-steps"><li>Tap the <b>⋮</b> menu at the top right of Chrome.</li>' +
        '<li>Tap <b>Add to Home screen</b> (or <b>Install app</b>).</li>' +
        '<li>Tap <b>Install</b>.</li></ol>';
    } else {
      h += '<p class="ph2-p">Open <b>' + esc(SETUP_URL.replace(/^https?:\/\//, '')) + '</b> on your phone for the exact steps.</p>';
    }
    h += '<button type="button" class="ph2-secondary" data-act="setup-guide">Open the full setup guide</button></div>';

    /* Name the other app rather than compete with it. Somebody who only ever
       pulls and reads charts should be using the small one; hiding that here
       would leave them carrying the whole workspace for two verbs. */
    h += '<div class="ph2-card">' +
      '<p class="ph2-h">Only need your day and the pull?</p>' +
      '<p class="ph2-p">Scrivara is the smaller phone app — your patients and one pull button, ' +
      'nothing else. This workspace is the one that records a visit and writes the note.</p>' +
      '<button type="button" class="ph2-secondary" data-act="small-app">Open Scrivara</button>' +
      '</div>';

    h += '<div class="ph2-card">' +
      '<p class="ph2-h">Need the desktop layout?</p>' +
      '<p class="ph2-p">The full app has every screen, built for a big monitor. It will be cramped here — and this ' +
      esc(noun) + ' will keep opening it until you switch back in Settings → Integrations → This device.</p>' +
      '<button type="button" class="ph2-secondary" data-act="full-app">Show the full app on this ' + esc(noun) + '</button>' +
      '</div>';
    return h;
  }

  function platform() {
    var ua = safe(function () { return navigator.userAgent || ''; }, '');
    if (/iPhone|iPad|iPod/i.test(ua)) return 'ios';
    if (/Macintosh/i.test(ua) && (navigator.maxTouchPoints || 0) > 1) return 'ios';
    if (/Android/i.test(ua)) return 'android';
    return 'other';
  }
  function standalone() {
    return !!safe(function () {
      return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
    }, false);
  }

  /* ===========================================================================
   * ACTIONS
   * =========================================================================*/
  function onAct(ev) {
    var el = ev.target && ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!el) return;
    var act = el.getAttribute('data-act');

    if (act === 'tab-today') { go('today'); return; }
    if (act === 'setup') { go('setup'); return; }

    if (act === 'day-prev' || act === 'day-next') {
      var ds = daySwitch();
      if (ds && typeof ds.shiftDay === 'function') safe(function () { ds.shiftDay(act === 'day-prev' ? -1 : 1); });
      S.lastSig = ''; render(); return;
    }

    if (act === 'pull-start') {
      var d2 = daySwitch();
      if (!d2 || typeof d2.pullDay !== 'function') { toast('The Athena pull engine has not finished loading yet.', 'err'); return; }
      /* Same call the desktop button makes: the cross-tab shield, the session
         serial, the receipt check and the relay routing all still apply. */
      safe(function () { d2.pullDay(); });
      S.lastSig = ''; render(); startTicking(); return;
    }
    if (act === 'pull-stop') {
      var rl = relay();
      if (rl && typeof rl.cancelActive === 'function') {
        safe(function () { rl.cancelActive(); });
        toast('Stopped waiting. Anything your office computer already finished still syncs here.', '');
      } else {
        toast('This pull is running on this ' + deviceNoun() + ' and finishes on its own.', '');
      }
      S.lastSig = ''; render(); return;
    }

    if (act === 'open') {
      var id = el.getAttribute('data-id') || '';
      var r = remote();
      if (!r || typeof r.startVisitFor !== 'function') { toast('The visit engine has not finished loading yet.', 'err'); return; }
      /* record:false -- opening a patient must never start a microphone. */
      var ok = safe(function () { return r.startVisitFor(id, { record: false }); }, false);
      if (!ok) { toast('That appointment could not be opened. Pull the day again and try once more.', 'err'); return; }
      go('visit'); return;
    }

    if (act === 'record') {
      var r2 = remote();
      if (!r2) return;
      var started = safe(function () { return r2.record(); }, false);
      if (!started) toast('Recording did not start. Check the message on this screen, then try again.', 'err');
      S.lastSig = ''; render(); startTicking(); return;
    }
    if (act === 'stop') {
      var r3 = remote();
      if (r3) safe(function () { r3.stopRecording(); });
      S.lastSig = ''; render(); return;
    }
    if (act === 'generate') {
      var r4 = remote();
      if (!r4) return;
      var g = safe(function () { return r4.generate(); }, false);
      if (!g) toast('The note could not be started. Check the message on this screen.', 'err');
      S.lastSig = ''; render(); startTicking(); return;
    }
    if (act === 'send') {
      var r5 = remote();
      if (!r5) return;
      var s = safe(function () { return r5.requestSendReview(); }, false);
      if (!s) toast('Nothing to send yet.', 'err');
      return;
    }
    if (act === 'copy-note') {
      var n = noteText();
      if (!n.trim()) { toast('There is no note to copy yet.', 'err'); return; }
      safe(function () { navigator.clipboard.writeText(n); toast('Note copied.', 'ok'); });
      return;
    }

    if (act === 'install') {
      var evt = S.installEvt;
      if (!evt) return;
      S.installEvt = null;
      safe(function () { evt.prompt(); });
      S.lastSig = ''; render(); return;
    }
    if (act === 'setup-guide') { safe(function () { window.open(SETUP_URL, '_blank', 'noopener'); }); return; }
    if (act === 'small-app') { safe(function () { window.open(SMALL_APP_URL, '_blank', 'noopener'); }); return; }

    if (act === 'full-app') {
      /* dr-1.5.0: this used to write a SESSION flag, so the choice evaporated
         on the next launch and the doctor had to find this button again every
         time — and there was no way back to it except a URL parameter. It now
         sets the stored layout preference, which is the same control Settings
         offers, so the choice persists and is reversible from a place a person
         can find. */
      var dr2 = deviceRole();
      if (dr2 && typeof dr2.setLayoutPref === 'function') { safe(function () { dr2.setLayoutPref('full'); }); }
      else { safe(function () { sessionStorage.setItem('mls_phone_mode', '0'); }); }
      unmount();
      safe(function () { if (window.__mlsPhoneHome && window.__mlsPhoneHome.ensure) window.__mlsPhoneHome.ensure(); });
      toast('Full app shown on this ' + deviceNoun() + '. Settings → Integrations → This device → Layout switches back.', '');
      stopTicking();
      return;
    }
  }

  /* Transcript and note edits go straight to the canonical elements, with the
     input event the rest of the app listens for. There is no second copy. */
  function onEdit(ev) {
    var t = ev.target;
    if (!t || !t.id) return;
    if (t.id === 'mlsPh2Tx') {
      var real = transcriptEl();
      if (real && real.value !== t.value) {
        real.value = t.value;
        safe(function () { real.dispatchEvent(new Event('input', { bubbles: true })); });
      }
    } else if (t.id === 'mlsPh2Note') {
      var nb = $('noteBox');
      if (nb && nb.value !== t.value) {
        nb.value = t.value;
        safe(function () { nb.dispatchEvent(new Event('input', { bubbles: true })); });
      }
    }
  }

  /* ===========================================================================
   * RENDER
   * A signature guard, because this screen carries two textareas the doctor may
   * be typing into. Re-rendering identical HTML would move the caret.
   * =========================================================================*/
  function signature() {
    var sn = snap();
    var focusId = safe(function () { return document.activeElement && document.activeElement.id; }, '');
    if (focusId === 'mlsPh2Tx' || focusId === 'mlsPh2Note') return S.lastSig; /* never repaint under the caret */
    var p = api._presence;
    return [
      S.tab, today(), rows().length, pulling() ? 1 : 0, pullSentence(),
      sn ? sn.phase : '-', sn && sn.active ? sn.active.id : '-', sn ? sn.recSecs : 0,
      transcriptText().length, noteText().length,
      p ? [p.online, p.ext, p.officeName, p.officeAth].join('|') : '-',
      S.installEvt ? 1 : 0
    ].join('');
  }

  function render() {
    if (!frame || !bodyEl) return;
    var sig = signature();
    if (sig === S.lastSig) return;
    S.lastSig = sig;

    var t = $('mlsPh2Title'), s = $('mlsPh2Sub');
    if (t) t.textContent = S.tab === 'visit' ? 'Visit' : S.tab === 'setup' ? 'Setup' : 'MLS';
    if (s) {
      var who = safe(function () { var w = $('whoLabel'); return w ? String(w.textContent || '').trim() : ''; }, '');
      s.textContent = S.tab === 'today' ? (who || 'Your day') : (S.tab === 'visit' ? 'One patient at a time' : 'This ' + deviceNoun());
    }
    var btns = tabsEl ? tabsEl.querySelectorAll('button[data-tab]') : [];
    for (var i = 0; i < btns.length; i++) {
      if (btns[i].getAttribute('data-tab') === S.tab) btns[i].setAttribute('aria-current', 'page');
      else btns[i].removeAttribute('aria-current');
    }

    bodyEl.innerHTML = S.tab === 'visit' ? visitScreen() : S.tab === 'setup' ? setupScreen() : todayScreen();
  }
  api.render = function () { S.lastSig = ''; render(); };

  /* ===========================================================================
   * PRESENCE -- read once on mount and refreshed only when the Setup or Today
   * screen actually needs it. No poller.
   * =========================================================================*/
  api._presence = null;
  var presenceAt = 0;
  function refreshPresence(force) {
    if (!authed()) return;
    var now = Date.now();
    if (!force && now - presenceAt < 25000) return;
    presenceAt = now;
    safe(function () {
      fetch(window.bkBase() + '/api/relay/presence', { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.bkToken() } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) { if (p) { api._presence = p; render(); } })
        .catch(function () {});
    });
  }

  /* ===========================================================================
   * TICKER -- setTimeout, not setInterval, and only while something is live.
   * A phone in a pocket runs no timers here at all.
   * =========================================================================*/
  var tickTimer = null;
  function live() {
    if (document.visibilityState === 'hidden') return false;
    if (pulling()) return true;
    var sn = snap();
    return !!(sn && (sn.phase === 'rec' || sn.phase === 'gen'));
  }
  function tick() {
    tickTimer = null;
    if (!S.mounted) return;
    render();
    if (live()) tickTimer = setTimeout(tick, 1000);
  }
  function startTicking() { if (!tickTimer && S.mounted) tickTimer = setTimeout(tick, 250); }
  function stopTicking() { if (tickTimer) { clearTimeout(tickTimer); tickTimer = null; } }

  /* Engine repaints are the other source of truth. Scoped to the visit body, so
     it never sees the rest of the document's churn. */
  var mo = null, moHost = null;
  function watchEngine() {
    var host = $('mlsEz3Body');
    if (!host || host === moHost) return;
    try { if (mo) mo.disconnect(); } catch (e) {}
    moHost = host;
    try {
      mo = new MutationObserver(function () { render(); startTicking(); });
      mo.observe(host, { childList: true, subtree: true, characterData: true });
    } catch (e) { mo = null; }
  }

  /* ===========================================================================
   * LIFECYCLE
   * =========================================================================*/
  var settleTries = 0, settleTimer = null;
  function ensure() {
    if (!owns() || !authed()) {
      if (S.mounted) { unmount(); stopTicking(); }
      /* Not a phone (or not signed in yet): try again for a bounded while, then
         stop. Sign-in fires its own event below. */
      if (settleTries++ < 60 && !settleTimer) settleTimer = setTimeout(function () { settleTimer = null; ensure(); }, 1000);
      return;
    }
    settleTries = 0;
    if (!S.mounted) {
      mount();
      frame.addEventListener('click', onAct);
      frame.addEventListener('input', onEdit);
      refreshPresence(true);
    }
    watchEngine();
    render();
    startTicking();
    /* The legacy subtractive layer has nothing left to do while this owns the
       screen; leaving its class on would only run 28 hide rules underneath an
       opaque frame. Compared before it commits: remove() re-serialises <body
       class> even when the token was already absent, and that invalidates style
       for the whole document (body-class-writes-only-on-change.test.js). */
    safe(function () {
      if (document.body.classList.contains('mls-phone')) document.body.classList.remove('mls-phone');
    });
  }
  api.ensure = ensure;

  function onVisible() {
    if (document.visibilityState !== 'visible') { stopTicking(); return; }
    refreshPresence(true);
    S.lastSig = ''; render(); startTicking();
  }

  safe(function () { document.addEventListener('visibilitychange', onVisible); });
  safe(function () {
    window.addEventListener('beforeinstallprompt', function (ev) {
      try { ev.preventDefault(); } catch (e) {}
      S.installEvt = ev; S.lastSig = ''; render();
    });
  });
  safe(function () { window.addEventListener('appinstalled', function () { S.installEvt = null; S.lastSig = ''; render(); }); });
  /* The engine announces both of these; they are the moments this UI is wrong. */
  safe(function () { window.addEventListener('mls:easy-mode-changed', function () { S.lastSig = ''; ensure(); }); });
  safe(function () { window.addEventListener('mls:easy-visit-day-changed', function () { S.lastSig = ''; render(); }); });
  safe(function () { window.addEventListener('mls:session-boundary', function () { S.lastSig = ''; api._presence = null; ensure(); }); });

  api.revert = function () {
    stopTicking();
    try { if (settleTimer) clearTimeout(settleTimer); } catch (e) {}
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { document.removeEventListener('visibilitychange', onVisible); } catch (e) {}
    unmount();
    try { st.remove(); } catch (e) {}
    /* Hand the screen back to the layer this replaced, exactly as it was. */
    safe(function () { if (window.__mlsPhoneHome && window.__mlsPhoneHome.ensure) window.__mlsPhoneHome.ensure(); });
    api.installed = false;
    try { delete window.__mlsPhoneUI; } catch (e) { window.__mlsPhoneUI = undefined; }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ensure);
  else ensure();
})();
