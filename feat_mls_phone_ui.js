'use strict';
/* =============================================================================
 * MLS on a phone -- feat_mls_phone_ui.js -> window.__mlsPhoneUI, ph2-1.1.0
 *
 * Owner, 2026-08-07, verbatim: "The phone version needs a lot of fixing like it
 * needs to be way simpler to use and the pulls needs to be better and simpler
 * to understand. Don't change the desktop app UI but completely change the
 * PHONE app UI from scratch."
 *
 * ph2-1.1.0 (owner, 2026-08-08): "the UI looks great but get rid of the
 * Scrivara stuff and make all the buttons and settings actually work and add
 * any quality of life features it needs also the top right 3 lined button
 * doesn't work."
 *
 * THE THREE-LINED BUTTON. It drew the universal sign for "there is a menu
 * here" and then did the one thing already sitting in the tab bar six
 * millimetres below it (go('setup')). Pressed from the Setup tab -- where a
 * person looking for account controls has usually already landed -- it
 * produced no change at all, which is indistinguishable from a dead control.
 * It is now the menu it always claimed to be.
 *
 * AND THE MENU IS NOT DECORATION: it carries the six things this phone app
 * could not reach by ANY route. Sign out and Settings are the load-bearing
 * two. The desktop keeps both in #appHeader, which body.mls-ph2 hides, so
 * until now a doctor could not sign this phone out of a PHI workspace or open
 * Settings from it -- while the Setup screen printed "Go to Settings ->
 * Integrations" twice, an instruction that pointed at nothing reachable from
 * the device reading it (the-instruction-points-nowhere class).
 *
 * THE OTHER APP. app.html (lane 014) is a separate store-shipped app. This
 * workspace advertised it in a Setup card and sent "Open the full setup guide"
 * to phone-setup.html, which is that app's install guide -- so the two routes
 * out of MLS on a phone both left MLS. Both are gone.
 *
 * It was called "Scrivara" until 2026-08-08, when the owner read "Put Scrivara
 * on your iPhone" on his own phone and said: "this should save mlsscribe
 * everywhere, fix everywhere what it says the wrong thing to." It is "MLS
 * Scribe" now, in every string a person can read -- not bare "MLS", because
 * this workspace already installs under that name and two icons reading "MLS"
 * on one Home Screen are indistinguishable. The backend host
 * (scrivara-backend.onrender.com) and the bundle id (com.scrivara.app) are
 * NOT renamed: one is a live address and the other is permanent once a store
 * build is uploaded under it.
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
 * app.html ("MLS Scribe", lane 014) is a separate, small, store-shipped phone app
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
  var VERSION = 'ph2-1.1.0';
  var api = { installed: true, version: VERSION };
  window.__mlsPhoneUI = api;

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
  /* The host app's own globals. They are called, never reimplemented: logout()
     carries the unsynced-note warning and the session-boundary scrub, and
     openSettings() re-reads every stored value into the form. A phone copy of
     either would be a second, quieter version of a thing that must not have
     two versions. */
  function hostFn(name) {
    return safe(function () { return typeof window[name] === 'function' ? window[name] : null; }, null);
  }

  /* ---------------------------------------------------------------------------
   * Copy, which must not claim more than it did.
   * navigator.clipboard.writeText returns a PROMISE. The old code toasted
   * "Note copied." on the same tick and swallowed the rejection, so a browser
   * that refused the write said it had succeeded -- and the doctor pasted the
   * previous clipboard into a chart. Report the settled result, and fall back
   * to the selection path before reporting failure.
   * -------------------------------------------------------------------------*/
  function legacyCopy(text) {
    return !!safe(function () {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'readonly');
      ta.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
      document.body.appendChild(ta);
      ta.focus(); ta.select();
      try { ta.setSelectionRange(0, text.length); } catch (e) {}
      var ok = document.execCommand('copy');
      try { ta.parentNode.removeChild(ta); } catch (e2) {}
      return ok === true;
    }, false);
  }
  function copyText(text, done) {
    var fin = function (ok) { safe(function () { done(!!ok); }); };
    var p = safe(function () {
      return (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(text) : null;
    }, null);
    if (p && typeof p.then === 'function') {
      p.then(function () { fin(true); }, function () { fin(legacyCopy(text)); });
      return;
    }
    fin(legacyCopy(text));
  }

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

    /* `bottom` is the on-screen keyboard, not zero. iOS does not shrink the
       layout viewport when the keyboard opens, so a frame pinned to inset:0
       keeps its tab bar and the bottom of its scroller UNDER the keys --
       including the transcript line being typed. --ph2-kbd is written from
       visualViewport (0 unless a real keyboard is up), so the whole frame
       shortens and its own flex layout does the rest. */
    '#mlsPh2{position:fixed;top:0;left:0;right:0;bottom:var(--ph2-kbd,0px);z-index:7000;display:flex;flex-direction:column;',
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
    '#mlsPh2 .ph2-kv b{flex:none;width:104px;color:var(--ph2-ink);font-weight:700}',

    /* find a patient. The list is the only screen that can carry twenty rows,
       and scrolling twenty names one-handed between rooms is the thing a
       search box exists for. */
    '#mlsPh2 .ph2-find{position:relative;margin:0 0 10px}',
    '#mlsPh2 .ph2-find input{width:100%;min-height:48px;border:1px solid var(--ph2-line);border-radius:13px;',
    'background:#fff;color:var(--ph2-ink);padding:12px 40px 12px 14px;font:500 16px/1.2 inherit;-webkit-appearance:none}',
    '#mlsPh2 .ph2-find .ph2-clear{position:absolute;top:50%;right:5px;transform:translateY(-50%);width:38px;height:38px;',
    'border:0;background:transparent;color:var(--ph2-dim);font-size:19px;line-height:1;cursor:pointer}',
    '#mlsPh2 .ph2-count{font:600 12px/1.4 inherit;color:var(--ph2-dim);margin:0 0 8px;padding:0 2px}',

    /* Today, beside the arrows. Walking back from Friday one tap at a time is
       not a way home. */
    '#mlsPh2 .ph2-day .ph2-todaybtn{flex:none;width:auto;padding:0 13px;font:700 13.5px/1 inherit;color:var(--ph2-green2)}',

    /* THE MENU. A sheet, not a nav: it is a list of one-shot destinations, and
       it lives on the FRAME rather than in the scrolling body so an engine
       repaint underneath can never blow it away mid-tap. */
    '#mlsPh2Sheet{position:absolute;inset:0;z-index:20;display:flex;flex-direction:column;justify-content:flex-end}',
    '#mlsPh2Sheet .ph2-scrim{position:absolute;inset:0;background:rgba(9,20,14,.44);border:0;padding:0;',
    'width:100%;height:100%;cursor:pointer}',
    '#mlsPh2Sheet .ph2-panel{position:relative;background:var(--ph2-card);border-radius:20px 20px 0 0;',
    'padding:8px 12px calc(env(safe-area-inset-bottom) + 12px);box-shadow:0 -8px 34px rgba(9,20,14,.22);',
    'max-height:88%;overflow-y:auto;overscroll-behavior:contain}',
    '#mlsPh2Sheet .ph2-grab{width:38px;height:4px;border-radius:99px;background:var(--ph2-line);margin:6px auto 10px}',
    '#mlsPh2Sheet .ph2-who{font:600 12.5px/1.4 inherit;color:var(--ph2-dim);padding:0 10px 10px;',
    'border-bottom:1px solid var(--ph2-line);margin:0 0 6px;word-break:break-word}',
    '#mlsPh2Sheet .ph2-item{display:flex;align-items:center;gap:13px;width:100%;text-align:left;min-height:56px;',
    'border:0;background:transparent;color:var(--ph2-ink);font:700 15.5px/1.3 inherit;padding:10px 10px;cursor:pointer;',
    'border-radius:13px}',
    '#mlsPh2Sheet .ph2-item:active{background:#F1F4F2}',
    '#mlsPh2Sheet .ph2-item .ph2-ig{flex:none;width:26px;font-size:19px;line-height:1;text-align:center}',
    '#mlsPh2Sheet .ph2-item small{display:block;font:500 12px/1.35 inherit;color:var(--ph2-dim);margin-top:2px}',
    '#mlsPh2Sheet .ph2-item.ph2-danger{color:var(--ph2-red)}',
    '#mlsPh2Sheet .ph2-sep{height:1px;background:var(--ph2-line);margin:6px 10px}',
    '@media (prefers-reduced-motion: no-preference){',
    '  #mlsPh2Sheet .ph2-panel{animation:ph2Rise .18s ease-out}',
    '  @keyframes ph2Rise{from{transform:translateY(14px)}to{transform:none}}',
    '}'
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
    installEvt: null,
    q: '',            /* the patient filter, kept in state so a repaint restores it */
    menu: false,
    pullAt: 0         /* the last accepted pull press, for the double-tap guard */
  };
  api.state = function () { return { tab: S.tab, mounted: S.mounted, menu: S.menu }; };

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
        '<button type="button" class="ph2-dot" id="mlsPh2Help" aria-label="Menu" aria-haspopup="true" aria-expanded="false">☰</button>' +
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
    $('mlsPh2Help').addEventListener('click', function () { toggleMenu(); });
    document.body.classList.add('mls-ph2');
    S.mounted = true;
    return frame;
  }

  function unmount() {
    closeMenu();
    try { if (frame && frame.parentNode) frame.parentNode.removeChild(frame); } catch (e) {}
    frame = bodyEl = hdrEl = tabsEl = null;
    try { document.body.classList.remove('mls-ph2'); } catch (e) {}
    S.mounted = false; S.lastSig = '';
  }

  /* ===========================================================================
   * THE MENU
   * Six destinations, and every one of them is a thing this app could not reach
   * from any other control. Sign out and Settings are why it exists: the
   * desktop keeps both in #appHeader, which body.mls-ph2 hides.
   * =========================================================================*/
  function accountLine() {
    var who = safe(function () { var w = $('whoLabel'); return String((w && w.textContent) || '').trim(); }, '');
    if (who) return who;
    return safe(function () { return typeof window.getSessionEmail === 'function' ? String(window.getSessionEmail() || '') : ''; }, '');
  }
  function menuItem(act, glyph, label, sub, danger) {
    return '<button type="button" class="ph2-item' + (danger ? ' ph2-danger' : '') + '" data-act="' + act + '">' +
      '<span class="ph2-ig" aria-hidden="true">' + glyph + '</span>' +
      '<span>' + esc(label) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</span>' +
      '</button>';
  }
  function menuHtml() {
    var who = accountLine();
    var tk = todayKey();
    var offToday = !!(tk && today() && today() !== tk);
    var h = '<button type="button" class="ph2-scrim" data-act="menu-close" aria-label="Close the menu"></button>' +
      '<div class="ph2-panel" role="dialog" aria-modal="true" aria-label="Menu">' +
      '<div class="ph2-grab" aria-hidden="true"></div>' +
      (who ? '<p class="ph2-who">Signed in as ' + esc(who) + '</p>' : '');
    h += menuItem('refresh', '↻', 'Refresh', 'Re-read your schedule and your office computer');
    if (offToday) h += menuItem('today-jump', '📅', 'Jump back to today', '');
    h += menuItem('settings', '⚙️', 'Settings', 'Note defaults, display, security');
    h += menuItem('device-settings', '📱', 'This ' + deviceNoun() + ' and where pulls run', 'Role, layout and your other devices');
    h += menuItem('setup', '🛟', 'Setup and help', '');
    h += '<div class="ph2-sep"></div>';
    h += menuItem('signout', '🚪', 'Sign out', 'Clears this ' + deviceNoun() + "'s local copy of your day", true);
    h += '</div>';
    return h;
  }
  var sheetEl = null;
  function openMenu() {
    if (!frame) return;
    closeMenu();
    sheetEl = document.createElement('div');
    sheetEl.id = 'mlsPh2Sheet';
    sheetEl.innerHTML = menuHtml();
    frame.appendChild(sheetEl);
    S.menu = true;
    /* An inline style, deliberately: the body-class tripwire counts every
       classList write in this file, and a scroll lock is not a thing worth
       spending one of those sites on. */
    safe(function () { if (bodyEl) bodyEl.style.overflow = 'hidden'; });
    safe(function () { var b = $('mlsPh2Help'); if (b) b.setAttribute('aria-expanded', 'true'); });
    safe(function () {
      var first = sheetEl.querySelector('.ph2-item');
      if (first && first.focus) first.focus();
    });
  }
  function closeMenu() {
    if (sheetEl) { try { if (sheetEl.parentNode) sheetEl.parentNode.removeChild(sheetEl); } catch (e) {} }
    sheetEl = null;
    if (S.menu) safe(function () { var b = $('mlsPh2Help'); if (b) { b.setAttribute('aria-expanded', 'false'); if (b.focus) b.focus(); } });
    S.menu = false;
    safe(function () { if (bodyEl) bodyEl.style.overflow = ''; });
  }
  function toggleMenu() { if (S.menu) closeMenu(); else openMenu(); }
  api.menu = function (open) { if (open === false) closeMenu(); else openMenu(); };

  /* Settings is one modal with a runtime-built section rail, and "This device"
     lives in Integrations. Land ON it rather than dropping the doctor at the
     top of a long form and asking them to hunt -- the tab is matched by its
     own text, because the rail is built at runtime and an index would rot the
     first time a section is added. Failing to find it leaves Settings open,
     which is still better than where this button used to go (nowhere). */
  function showDeviceSection() {
    safe(function () {
      var bar = $('settingsTabBar');
      if (bar && bar.querySelectorAll) {
        var btns = bar.querySelectorAll('button, .set-tab');
        for (var i = 0; i < btns.length; i++) {
          if (/integration/i.test(String(btns[i].textContent || ''))) { btns[i].click(); break; }
        }
      }
      var seg = $('mlsDrSeg') || $('mlsDrLayout') || $('mlsDrHead');
      if (seg && seg.scrollIntoView) seg.scrollIntoView({ block: 'center' });
    });
  }

  function go(tab) {
    if (tab !== 'today' && tab !== 'visit' && tab !== 'setup') tab = 'today';
    closeMenu();
    S.tab = tab;
    S.lastSig = '';
    /* The engine's own view must follow, or a Send confirm card would open on a
       screen the doctor is not looking at. */
    if (tab === 'visit') safe(function () { if (typeof window.showView === 'function') window.showView('visit'); });
    /* FORCED. A press is a person asking for a different screen, and it must
       out-rank the caret guard in render(): with a transcript field focused,
       the guard used to refuse the repaint and the tap did nothing at all. */
    render(true);
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

  /* The patient list, rendered on its own so a keystroke in the find box can
     repaint it WITHOUT repainting the box the caret is sitting in. */
  function listHtml() {
    var list = rows();
    var total = list.length;
    var q = String(S.q || '').trim().toLowerCase();
    var sn = snap();
    var activeId = sn && sn.active ? String(sn.active.id || '') : '';

    if (q) {
      list = list.filter(function (a) {
        return (rowName(a) + ' ' + String((a && a.provider) || '') + ' ' + rowTime(a)).toLowerCase().indexOf(q) >= 0;
      });
    }

    if (!total) {
      return '<div class="ph2-empty">Nothing scheduled here yet.<br>You can still record a walk-in from the Visit tab.</div>';
    }
    var h = '';
    if (q) {
      h += '<p class="ph2-count">Showing ' + list.length + ' of ' + total + '</p>';
      if (!list.length) {
        return h + '<div class="ph2-empty">No one on this day matches “' + esc(S.q) + '”.</div>';
      }
    }
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
    return h;
  }

  function todayScreen() {
    var d = fmtDayLabel(today());
    var count = rows().length;
    var tk = todayKey();
    var offToday = !!(tk && today() && today() !== tk);
    var busy = pulling();

    /* The arrows are disabled DURING a pull because the engine refuses a day
       change while one is running -- an enabled control whose only outcome is
       an error toast is a control that lies about being available. */
    var h = '<div class="ph2-day">' +
      '<button type="button" data-act="day-prev" aria-label="Previous day"' + (busy ? ' disabled' : '') + '>‹</button>' +
      '<span class="ph2-dl">' + esc(d.main) + '<small>' + esc(d.sub) + '</small></span>' +
      (offToday ? '<button type="button" class="ph2-todaybtn" data-act="today-jump"' + (busy ? ' disabled' : '') + '>Today</button>' : '') +
      '<button type="button" data-act="day-next" aria-label="Next day"' + (busy ? ' disabled' : '') + '>›</button>' +
      '</div>';
    h += pullCard();

    /* Five is where a one-handed scroll between rooms starts costing more than
       the box does. Below it the box would be the largest thing on a screen
       whose whole job is the list underneath. */
    if (count >= 5 || String(S.q || '')) {
      h += '<div class="ph2-find">' +
        '<input type="search" id="mlsPh2Find" inputmode="search" enterkeyhint="search" autocomplete="off" ' +
        'autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Find a patient on this day" ' +
        'placeholder="Find a patient" value="' + esc(S.q) + '">' +
        (String(S.q || '') ? '<button type="button" class="ph2-clear" data-act="find-clear" aria-label="Clear the search">✕</button>' : '') +
        '</div>';
    }
    h += '<div id="mlsPh2List">' + listHtml() + '</div>';
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
      /* The row above is a READING. Until ph2-1.1.0 it was the whole story --
         the screen stated what the device was and offered no way to change it,
         while two paragraphs below sent the reader to a Settings screen this
         app had no route to. Both are buttons now. */
      '<button type="button" class="ph2-secondary" data-act="device-settings">Change what this ' + esc(noun) + ' is, and see your other devices →</button>' +
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
        'Open the ☰ menu there, or Settings → Integrations.',
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
      /* Not a handheld: this is a computer running the simple layout on
         purpose. It has a Home Screen for nothing, so it is told the truth
         rather than sent to a guide about a different device. */
      h += '<p class="ph2-p">This is a ' + esc(noun) + ', so there is no Home Screen to add MLS to. ' +
        'To put MLS on a phone, open MLS in that phone\'s browser and use its own “Add to Home Screen”.</p>';
    }
    h += '</div>';

    /* Your account. Both of these were unreachable from this app: the desktop
       keeps them in #appHeader, which body.mls-ph2 hides. They are in the ☰
       menu too -- a control a person can find by looking belongs on the screen
       that is about it, not only behind a glyph. */
    h += '<div class="ph2-card">' +
      '<p class="ph2-h">Your account</p>' +
      '<p class="ph2-p">' + esc(accountLine() ? 'Signed in as ' + accountLine() + '.' : 'Signed in on this ' + noun + '.') + '</p>' +
      '<button type="button" class="ph2-secondary" data-act="settings">⚙️ Open Settings</button>' +
      '<button type="button" class="ph2-secondary" data-act="signout">🚪 Sign out of this ' + esc(noun) + '</button>' +
      '</div>';

    h += '<div class="ph2-card">' +
      '<p class="ph2-h">Need the desktop layout?</p>' +
      '<p class="ph2-p">The full app has every screen, built for a big monitor. It will be cramped here — and this ' +
      esc(noun) + ' will keep opening it until you switch back, which is the “Layout” control on the button above.</p>' +
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

    if (act === 'menu-close') { closeMenu(); return; }
    if (act === 'tab-today') { go('today'); return; }
    if (act === 'setup') { go('setup'); return; }

    /* ---- the menu's own destinations ------------------------------------ */
    if (act === 'settings' || act === 'device-settings') {
      closeMenu();
      var open = hostFn('openSettings');
      if (!open) { toast('Settings has not finished loading yet. Try again in a moment.', 'err'); return; }
      safe(function () { open(); });
      if (act === 'device-settings') safe(function () { setTimeout(showDeviceSection, 80); });
      return;
    }
    if (act === 'signout') {
      closeMenu();
      var out = hostFn('logout');
      if (!out) { toast('Sign-out has not finished loading yet. Try again in a moment.', 'err'); return; }
      /* No argument: logout(force) treats a bare call as the human path, which
         is the one that warns about notes this device has not backed up yet.
         Passing force here would skip that warning and silently destroy them. */
      safe(function () { out(); });
      return;
    }
    if (act === 'refresh') {
      closeMenu();
      refreshPresence(true);
      var did = 0;
      var cal = hostFn('loadCalendar');
      if (cal) { safe(function () { cal({ fresh: true }); }); did++; }
      var pts = hostFn('loadPatientsFromServer');
      if (pts) { safe(function () { pts(); }); did++; }
      S.lastSig = ''; render(true);
      toast(did ? 'Refreshing your day…' : 'Checked your office computer. The schedule reloads when the app is ready.', '');
      return;
    }
    if (act === 'today-jump') {
      closeMenu();
      var ds0 = daySwitch(), tk0 = todayKey();
      if (!ds0 || typeof ds0.setDay !== 'function' || !tk0) { toast('The day selector has not finished loading yet.', 'err'); return; }
      safe(function () { ds0.setDay(tk0); });
      S.lastSig = ''; render(true); return;
    }
    if (act === 'find-clear') {
      S.q = '';
      S.lastSig = ''; render(true);
      safe(function () { var f = $('mlsPh2Find'); if (f && f.focus) f.focus(); });
      return;
    }

    if (act === 'day-prev' || act === 'day-next') {
      var ds = daySwitch();
      if (!ds || typeof ds.shiftDay !== 'function') { toast('The day selector has not finished loading yet.', 'err'); return; }
      safe(function () { ds.shiftDay(act === 'day-prev' ? -1 : 1); });
      /* A day the doctor did not choose must not inherit the previous day's
         filter -- "Showing 0 of 6" on a list nobody searched reads as an empty
         day. */
      S.q = '';
      S.lastSig = ''; render(true); return;
    }

    if (act === 'pull-start') {
      var d2 = daySwitch();
      if (!d2 || typeof d2.pullDay !== 'function') { toast('The Athena pull engine has not finished loading yet.', 'err'); return; }
      /* A phone registers a double-tap as two clicks far more often than a
         mouse does, and pulling() cannot see the second one until the engine
         has disabled its own button. Two pulls over one store is the exact
         shape the cross-tab shield exists to refuse; do not hand it the case. */
      var now = Date.now();
      if (now - (S.pullAt || 0) < 1500) return;
      S.pullAt = now;
      /* Same call the desktop button makes: the cross-tab shield, the session
         serial, the receipt check and the relay routing all still apply. */
      safe(function () { d2.pullDay(); });
      S.lastSig = ''; render(true); startTicking(); return;
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
      if (!r3) { toast('The visit engine has not finished loading yet.', 'err'); return; }
      /* stopRecording() returns false when the engine believes nothing is
         running. That disagreement is exactly what the doctor is looking at --
         a Stop button over a screen that says Recording -- so it has to be
         said out loud rather than absorbed. */
      var stopped = safe(function () { return r3.stopRecording(); }, false);
      if (stopped === false) toast('There was no live recording to stop. If this screen still says Recording, reload MLS.', 'err');
      S.lastSig = ''; render(true); startTicking(); return;
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
      copyText(n, function (ok) {
        toast(ok ? 'Note copied.' : 'This browser would not let MLS use the clipboard. Press and hold the note above, then choose Copy.',
          ok ? 'ok' : 'err');
      });
      return;
    }

    if (act === 'install') {
      var evt = S.installEvt;
      if (!evt) return;
      S.installEvt = null;
      safe(function () {
        evt.prompt();
        /* The card disappears the moment prompt() is called, so a doctor who
           taps "Cancel" in the system sheet would be left with no button and
           no explanation. Say where it went. */
        if (evt.userChoice && typeof evt.userChoice.then === 'function') {
          evt.userChoice.then(function (c) {
            if (!c || c.outcome !== 'accepted') {
              toast('Not added. You can still add MLS to your Home Screen from your browser\'s own menu.', '');
            }
          }, function () {});
        }
      });
      S.lastSig = ''; render(true); return;
    }

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
    if (t.id === 'mlsPh2Find') {
      S.q = String(t.value || '');
      /* Repaint the LIST ONLY. Rewriting the whole screen would destroy the
         input the caret is in on every keystroke, which is the same bug as
         repainting under a transcript -- just faster to notice. */
      var host = $('mlsPh2List');
      if (host) host.innerHTML = listHtml();
      S.lastSig = '';
      return;
    }
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
  /* The caret guard, as its own question. It used to live INSIDE signature(),
     returning S.lastSig -- so a caller that had just cleared lastSig to force a
     repaint (every go(), every action) compared '' with '' and rendered
     NOTHING. Pressing a tab while the transcript held focus did nothing at all.
     It is a separate gate now, and force() overrides it. */
  function caretIsOurs() {
    var focusId = safe(function () { return (document.activeElement && document.activeElement.id) || ''; }, '');
    return focusId === 'mlsPh2Tx' || focusId === 'mlsPh2Note' || focusId === 'mlsPh2Find';
  }
  function signature() {
    var sn = snap();
    var p = api._presence;
    return [
      S.tab, today(), rows().length, pulling() ? 1 : 0, pullSentence(), S.q,
      sn ? sn.phase : '-', sn && sn.active ? sn.active.id : '-', sn ? sn.recSecs : 0,
      transcriptText().length, noteText().length,
      p ? [p.online, p.ext, p.officeName, p.officeAth].join('|') : '-',
      S.installEvt ? 1 : 0
    ].join('');
  }

  function render(force) {
    if (!frame || !bodyEl) return;
    if (!force && caretIsOurs()) return;   /* never repaint under the caret */
    var sig = signature();
    if (!force && sig === S.lastSig) return;
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
  api.render = function () { S.lastSig = ''; render(true); };

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
    S.lastSig = ''; render(true); startTicking();
  }

  /* ---------------------------------------------------------------------------
   * THE ON-SCREEN KEYBOARD
   * iOS does not shrink the layout viewport when the keyboard opens, so a frame
   * pinned to the bottom of it keeps its tab bar -- and the last lines of the
   * transcript being dictated into -- underneath the keys. visualViewport is
   * the only surface that reports the real occlusion. Nothing here runs on a
   * timer: the events fire only while a keyboard is actually moving.
   * -------------------------------------------------------------------------*/
  var vv = safe(function () { return window.visualViewport || null; }, null);
  function onViewport() {
    if (!frame) return;
    var hidden = 0;
    hidden = safe(function () {
      return Math.max(0, Math.round((window.innerHeight || 0) - (vv.height + vv.offsetTop)));
    }, 0);
    /* A threshold, because browser chrome (the collapsing Safari toolbar) moves
       this number by tens of pixels with no keyboard anywhere. No keyboard is
       90px tall. */
    safe(function () { frame.style.setProperty('--ph2-kbd', (hidden > 90 ? hidden : 0) + 'px'); });
  }
  if (vv && vv.addEventListener) {
    safe(function () { vv.addEventListener('resize', onViewport); });
    safe(function () { vv.addEventListener('scroll', onViewport); });
  }

  /* Escape closes the menu. A dialog that cannot be dismissed from the keyboard
     is not a dialog -- and an external keyboard on an iPad is ordinary. */
  function onKey(ev) {
    if (!S.menu) return;
    if (ev && ev.key === 'Escape') { safe(function () { ev.preventDefault(); }); closeMenu(); }
  }
  safe(function () { document.addEventListener('keydown', onKey); });

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
    try { document.removeEventListener('keydown', onKey); } catch (e) {}
    try { if (vv && vv.removeEventListener) { vv.removeEventListener('resize', onViewport); vv.removeEventListener('scroll', onViewport); } } catch (e) {}
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
