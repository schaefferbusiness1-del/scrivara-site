'use strict';
/* =============================================================================
 * MLS on a phone -- feat_mls_phone_ui.js -> window.__mlsPhoneUI, ph3-1.0.0
 *
 * Owner, 2026-08-09, verbatim: "the phone app is suppost to do all these thigns
 * and be easy to use and it just sucks. Learn what it support to do remark from
 * scratch confirm everyhting works uplaod live."
 *
 * WHAT WAS ACTUALLY WRONG, MEASURED BEFORE ANY OF THIS WAS WRITTEN
 * ----------------------------------------------------------------
 * ph2-1.1.0 was not a bad drawing. It was a good drawing that other layers sat
 * on top of, and an information architecture that made the phone's one job the
 * long way round. All of the following was measured in a real browser at
 * 375x812 against the SHIPPED file, not reasoned about:
 *
 *   1. #mlsR46VerBanner -- "MLS Assist is not installed in this browser" --
 *      renders at z-index 2147483100, 230x332, in the MIDDLE of the screen,
 *      and elementFromPoint proves it swallows 3 of the 16 controls on the day
 *      screen: the pull button and THE FIRST PATIENT OF THE DAY. Its own
 *      instruction ("Download it from mlsscribe.com Settings") cannot be
 *      followed on a phone -- no phone can host the extension. It had a phone
 *      guard, `body.mls-phone`, and ph2 REMOVES that class when it mounts, so
 *      the guard has not fired since ph2 shipped. A banner that covers the app
 *      and eats the first patient is, by itself, "it just sucks".
 *   2. The Visit tab was a destination that, most of the time, held a card
 *      telling you to go to the other tab. One of three destinations was a
 *      signpost back to the first.
 *   3. The primary action scrolled. On the visit screen "Start recording" is
 *      the only thing the doctor came for, and it sat in the page flow with
 *      the quick history and the transcript below it.
 *   4. Setup was 161 words of prose across 1.7 screens for 8 controls -- a
 *      manual, not a control panel.
 *   5. During a recording the visit body was rebuilt every second (recSecs is
 *      in the repaint signature), so reading the quick history mid-visit threw
 *      you back to the top once a second.
 *   6. Typing into the transcript overwrote it: the phone's textarea value was
 *      written over #transcript wholesale on every keystroke while the caret
 *      guard stopped the engine's live appends from reaching the phone. Words
 *      the recognizer produced while you were correcting a word were deleted.
 *   7. The Today badge counted every check-in the endpoint returned forever --
 *      reading them did not clear it.
 *   8. "You can still record a walk-in from the Visit tab" was false. There is
 *      no unbound-recording path in the engine's remote whitelist at all.
 *
 * WHAT THIS IS
 * ------------
 * TWO screens and one sheet, not three tabs:
 *
 *   DAY     the list of patients, the day, the pull. The home screen.
 *   VISIT   pushed from a patient row, with a back button. Everything about
 *           one person: their check-in brief, their quick history, the
 *           transcript, the note.
 *   MENU    the ONE sheet holding account and device controls: Settings, this
 *           device, add to Home Screen, the full app, sign out.
 *
 * AND THE BOTTOM OF THE SCREEN IS THE ACTION, NOT THE NAVIGATION. A phone's
 * bottom bar is the only part of a 812px screen a thumb reaches without
 * re-gripping. ph2 spent it on three tabs, two of which were a signpost and a
 * settings manual. Here it holds exactly ONE button: the single thing this
 * screen is for right now, named for what it will do -- "Get today's patients"
 * on an empty day, "Start recording" on a visit, "Stop recording" during one,
 * "Write the note" after it. It never scrolls away and it is never ambiguous.
 *
 * IT PERFORMS NO CLINICAL WORK OF ITS OWN. Every action runs through the
 * engine's OWN published entry points, exactly as ph2 did -- same context lock,
 * same identity check, same phase machine as the desktop buttons:
 *
 *   __mlsEasyV32.remote   snapshot / startVisitFor / record / stopRecording /
 *                         generate / requestSendReview
 *   __mlsDaySwitch        currentDay / setDay / shiftDay / rowsFor / pullDay
 *   __mlsRelayLink        activeJob / cancelActive / shouldRelay / extPresent
 *   __mlsDeviceRole       role / name / deviceNoun / setLayoutPref
 *
 * So there is no second engine, no second pull path, no second recorder, and no
 * clinical rule stated twice. revert() puts the phone back exactly as it was.
 *
 * THE PULL, WHICH THE OWNER HAS SINGLED OUT TWICE
 * -----------------------------------------------
 * On a phone the pull is a relay: the phone asks, the OFFICE COMPUTER reads
 * athenaOne, the result syncs back. The card answers the only three questions a
 * phone can be asked about it -- do I have today's patients / is something
 * happening now / what do I press -- and the engine's own sentence is kept
 * underneath as the detail line. The headline is ours; the sentence is the
 * engine's. A plain-language headline that REPLACES the truth is how this
 * product has been burned before.
 *
 * WHAT IT OWNS, AND WHY THAT LIST IS LONGER THAN ph2's
 * ----------------------------------------------------
 * A phone app that does not own the whole screen is not a phone app. Anything
 * the desktop floats over the workspace lands on top of a 375px frame and
 * either covers content or eats taps. The hide list therefore now also carries
 * #mlsR46VerBanner (defect 1 above) and the version-nag family, and the boot
 * readiness strip is pinned below this header rather than over it.
 *
 * TIMERS: exactly ONE interval exists -- the 45s check-in watch -- and it
 * refuses to arm while the tab is hidden. The repaint ticker is a setTimeout
 * loop that runs only while something is genuinely live (recording, generating,
 * pulling) AND the tab is visible; it stops on hide and restarts on show. Idle,
 * mounted, screen off => zero timers. Both handles are cleared with `!== null`,
 * because a timer handle of 0 is FALSY and a truthiness test leaves the old
 * timer running forever while a second one is armed -- browsers rarely hand out
 * 0, which is exactly why that ships.
 * The MutationObserver is scoped to #mlsEz3Body, never the document.
 *
 * Reversible: window.__mlsPhoneUI.revert(). ES5.
 * ===========================================================================*/
(function () {
  if (window.__mlsPhoneUI) return;
  var VERSION = 'ph3-1.0.0';
  var api = { installed: true, version: VERSION };
  window.__mlsPhoneUI = api;

  /* ---------------------------------------------------------------------------
   * TINY HELPERS
   * -------------------------------------------------------------------------*/
  function $(id) { return document.getElementById(id); }
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;';
    });
  }
  function easy() { return safe(function () { return window.__mlsEasyV32; }, null); }
  function remote() { var e = easy(); return (e && e.remote) ? e.remote : null; }
  function daySwitch() { return safe(function () { return window.__mlsDaySwitch; }, null); }
  function relay() { return safe(function () { return window.__mlsRelayLink; }, null); }
  function deviceRole() { return safe(function () { return window.__mlsDeviceRole; }, null); }

  /* The host app's own globals. They are CALLED, never reimplemented:
     logout() signs out (and the argument matters -- see below), openSettings()
     opens the one settings modal, showView() switches the desktop view under
     this frame, toast() is the app's single message surface. */
  function hostFn(name) {
    return safe(function () { return typeof window[name] === 'function' ? window[name] : null; }, null);
  }

  /* MESSAGES. The app's toast is the one message surface in the product and it
     lives at z-index 99999, ABOVE this frame -- measured, not assumed. So the
     phone uses it rather than inventing a second one. What the phone adds is a
     STICKY line inside the frame for messages that must survive a repaint (a
     refusal the doctor has to act on); a toast is four seconds and gone. */
  function toast(m, k) { safe(function () { if (typeof window.toast === 'function') window.toast(m, k || ''); }); }

  /* ---------------------------------------------------------------------------
   * CHART READS (the patient record, never the appointment)
   * activePatient() returns the CHART. snapshot().active is an APPOINTMENT and
   * carries name/time/dob only. Reading chart fields off the appointment is how
   * a phone prints "no allergies recorded" for a chart nobody has ever read.
   * -------------------------------------------------------------------------*/
  function activeChart() {
    var f = hostFn('activePatient');
    return f ? safe(function () { return f() || null; }, null) : null;
  }
  function chartNotes(id) {
    var f = hostFn('patientNotes');
    if (!f || !id) return [];
    var out = safe(function () { return f(id); }, null);
    return (out && out.length != null) ? out : [];
  }
  /* Has athenaOne's chart ever landed for this patient? The app's own answer,
     because "no allergies recorded" and "we have never read this chart" render
     as the same empty field and are opposite claims. */
  function chartLanded(p) {
    var f = hostFn('_athenaChartLanded');
    if (f) return !!safe(function () { return f(p); }, false);
    return !!safe(function () { return String((p && p.athenaChartImportedAt) || '').trim(); }, false);
  }
  /* Chart fields arrive as newline/semicolon TEXT or as an ARRAY depending on
     which importer wrote them. String(array).split(/\n|;/) yields ONE line
     "a,b,c" and a count of 1 -- a four-drug list printed with no "+N more" and
     looking complete. Both shapes, one function. */
  function chartLines(v) {
    if (v == null) return [];
    var arr = [];
    if (Object.prototype.toString.call(v) === '[object Array]') arr = v.slice();
    else arr = String(v).split(/\r?\n|;/);
    var out = [];
    for (var i = 0; i < arr.length; i++) {
      var s = String(arr[i] == null ? '' : arr[i]).trim();
      if (s) out.push(s);
    }
    return out;
  }
  function usDate(key) {
    var k = String(key || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return String(key || '');
    var p = k.split('-');
    return p[1].replace(/^0/, '') + '/' + p[2].replace(/^0/, '') + '/' + p[0];
  }
  function ageFrom(dob) {
    var k = String(dob || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return '';
    var p = k.split('-');
    var b = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    if (isNaN(b.getTime())) return '';
    var n = new Date(), a = n.getFullYear() - b.getFullYear();
    var m = n.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && n.getDate() < b.getDate())) a--;
    return (a >= 0 && a < 130) ? (a + 'y') : '';
  }

  /* ---------------------------------------------------------------------------
   * CLIPBOARD -- navigator.clipboard.writeText returns a PROMISE. Reporting
   * success on the same tick means a refused write is announced as a success
   * and the doctor pastes the PREVIOUS clipboard into a chart.
   * -------------------------------------------------------------------------*/
  function legacyCopy(text) {
    return !!safe(function () {
      var ta = document.createElement('textarea');
      ta.value = String(text || '');
      ta.setAttribute('readonly', 'readonly');
      ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand && document.execCommand('copy');
      ta.parentNode.removeChild(ta);
      return !!ok;
    }, false);
  }
  function copyText(text, done) {
    var fin = function (ok) { safe(function () { done(!!ok); }); };
    var p = safe(function () {
      return (navigator.clipboard && navigator.clipboard.writeText) ? navigator.clipboard.writeText(String(text || '')) : null;
    }, null);
    if (p && typeof p.then === 'function') {
      p.then(function () { fin(true); }, function () { fin(legacyCopy(text)); });
      return;
    }
    fin(legacyCopy(text));
  }

  /* ---------------------------------------------------------------------------
   * THE DEVICE'S OWN NOUN. Every sentence about the device the doctor is
   * holding asks for the word. "Phone mode" printed on a laptop screen is the
   * same class of defect as any other line of UI that asserts something untrue.
   * -------------------------------------------------------------------------*/
  function deviceNoun() {
    var dr = deviceRole();
    if (dr && typeof dr.deviceNoun === 'function') {
      var n = safe(function () { return dr.deviceNoun(); }, '');
      if (n) return n;
    }
    var ua = safe(function () { return navigator.userAgent || ''; }, '');
    if (/iPhone|iPod/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) return 'Android phone';
    if (/Macintosh/i.test(ua)) return 'Mac';
    if (/Windows/i.test(ua)) return 'PC';
    return 'device';
  }
  function thisDevice() { return 'this ' + deviceNoun(); }
  api.deviceNoun = deviceNoun;

  /* ---------------------------------------------------------------------------
   * OWNERSHIP. One definition of "this device is a phone" in the product.
   * Window WIDTH never classifies a device -- that was a real bug once, putting
   * narrow-windowed laptops into phone mode.
   * -------------------------------------------------------------------------*/
  function owns() {
    var ph = safe(function () { return window.__mlsPhoneHome; }, null);
    if (ph && typeof ph.wantPhone === 'function') return !!safe(function () { return ph.wantPhone(); }, false);
    /* wantPhone() is closure-private in mls-connect.js, so in practice THIS is
       the operative definition and it has to answer identically. Same order,
       same clauses: the Settings layout preference is the most explicit
       statement of intent, then the session flag, then an explicit role, then
       handheld EVIDENCE -- and a handheld that reports MLS Assist is NOT given
       the phone app, because it can host the extension and is therefore the
       office computer. Window width never classifies anything. */
    var dr = deviceRole();
    var lp = (dr && typeof dr.layoutPref === 'function') ? safe(function () { return dr.layoutPref(); }, '') : '';
    if (lp === 'simple') return true;
    if (lp === 'full') return false;
    if (safe(function () { return sessionStorage.getItem('mls_phone_mode') === '1'; }, false)) return true;
    if (safe(function () { return sessionStorage.getItem('mls_phone_mode') === '0'; }, false)) return false;
    var r = dr && typeof dr.role === 'function' ? safe(function () { return dr.role(); }, null) : null;
    if (r) return r === 'phone';
    return !!safe(function () {
      var ua = navigator.userAgent || '';
      var handheld = /iPhone|iPod|Android.*Mobile|Mobile.*Android|Windows Phone/i.test(ua) &&
        ((navigator.maxTouchPoints || 0) > 0 || ('ontouchstart' in window));
      var rl = relay();
      var ext = !!(rl && typeof rl.extPresent === 'function' && safe(function () { return rl.extPresent(); }, false));
      return handheld && !ext;
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
  st.id = 'mlsPh3Css';
  st.textContent = [
    ':root{--ph3-ink:#12201A;--ph3-dim:#67736C;--ph3-line:#E3E8E4;--ph3-bg:#F6F8F6;--ph3-card:#FFFFFF;',
    '--ph3-green:#204034;--ph3-green2:#2E6A4B;--ph3-red:#A3231F;--ph3-amber:#8A5A00;--ph3-wash:#EDF3EF;}',

    /* ---- THE HIDE LIST -----------------------------------------------------
       Everything the desktop floats over the workspace. On a 375px frame a
       floating card is not "extra information", it is a lid: #mlsR46VerBanner
       was MEASURED at 230x332, z-index 2147483100, in the middle of the screen,
       swallowing the pull button and the first patient of the day by
       elementFromPoint. Its own advice -- install the extension -- cannot be
       followed on a phone, so there is nothing to weigh against that. It had a
       phone guard (`body.mls-phone`) and this module removes that class, so the
       guard has not fired since the phone app shipped. It is hidden HERE, where
       the module that removed the class can be held responsible for it. */
    'body.mls-ph3 #appHeader, body.mls-ph3 .mainnav, body.mls-ph3 #patientBar,',
    'body.mls-ph3 #mlsDock, body.mls-ph3 #mlsRightNow, body.mls-ph3 #mlsStages,',
    'body.mls-ph3 #mlsFab, body.mls-ph3 #mlsFabMenu, body.mls-ph3 #mlsDaDock,',
    'body.mls-ph3 #mlsAsstFab, body.mls-ph3 #mlsCopVoiceBtn, body.mls-ph3 #mlsTabPickerChip,',
    'body.mls-ph3 #mlsRdRailBtn, body.mls-ph3 #mlsRdNav, body.mls-ph3 #_patientFace,',
    'body.mls-ph3 #mlsVoiceCluster, body.mls-ph3 #mlsPhExit,',
    'body.mls-ph3 #mlsR46VerBanner, body.mls-ph3 #mlsA2hsCard{display:none!important}',

    /* The backup-failure badge is NOT hidden - it reports a real problem with
       saving the doctor's work. It is lifted clear of the action bar instead. */
    'body.mls-ph3 #_backupBadge{bottom:calc(96px + env(safe-area-inset-bottom))!important;z-index:7100!important}',

    /* The boot readiness strip pins itself under #appHeader, which is hidden
       here, so its anchor variable stops being published and it hangs over this
       header for up to 30 seconds. Pin it under THIS header instead. */
    'body.mls-ph3 #mlsBootReadiness{top:calc(env(safe-area-inset-top) + 58px)!important;z-index:7050!important}',

    /* `bottom` is the on-screen keyboard, not zero. iOS does not shrink the
       layout viewport when the keyboard opens, so a frame pinned to inset:0
       keeps its action bar and the bottom of its scroller UNDER the keys --
       including the transcript line being typed. --ph3-kbd is written from
       visualViewport ONLY while an editable element holds focus (see the
       keyboard section: a pixel threshold alone reads Safari's own collapsing
       chrome as a keyboard and makes the whole shell float). */
    '#mlsPh3{position:fixed;top:0;left:0;right:0;bottom:var(--ph3-kbd,0px);z-index:7000;display:flex;flex-direction:column;',
    'background:var(--ph3-bg);color:var(--ph3-ink);',
    "font-family:'Public Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;",
    '-webkit-tap-highlight-color:transparent;}',
    '#mlsPh3 *{box-sizing:border-box}',
    '#mlsPh3 button{font-family:inherit}',
    '#mlsPh3 button:focus-visible{outline:3px solid #7FC79E;outline-offset:2px}',

    /* ---- header ------------------------------------------------------------
       Left slot is the ONE navigational control and it changes meaning by
       screen: on the day it is the menu, on a visit it is Back. There is never
       both, because a phone header with two left-hand controls is a header the
       doctor has to read before pressing.
       Horizontal safe-area insets are real: viewport-fit=cover is declared
       page-wide, and cover WITHOUT inset padding is strictly worse than no
       cover at all -- in landscape on a notched iPhone the header title runs
       under the notch. */
    '#mlsPh3Hdr{flex:none;display:flex;align-items:center;gap:8px;background:var(--ph3-green);color:#fff;',
    'padding:calc(env(safe-area-inset-top) + 8px) calc(env(safe-area-inset-right) + 10px) 10px calc(env(safe-area-inset-left) + 10px);}',
    '#mlsPh3Hdr .ph3-t{font-weight:800;font-size:18px;line-height:1.2;letter-spacing:.2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#mlsPh3Hdr .ph3-s{font-weight:500;font-size:12px;line-height:1.3;opacity:.82;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '#mlsPh3Hdr .ph3-grow{flex:1;min-width:0}',
    '#mlsPh3Hdr .ph3-dot{flex:none;min-width:46px;height:46px;border:0;border-radius:16px;background:rgba(255,255,255,.16);',
    'color:#fff;font-weight:700;font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;padding:0 12px}',
    '#mlsPh3Hdr .ph3-dot:active{background:rgba(255,255,255,.28)}',
    '#mlsPh3Hdr .ph3-dot .ph3-gl{font-size:19px;line-height:1}',
    '#mlsPh3Hdr .ph3-pill{flex:none;min-width:46px;height:46px;border:0;border-radius:16px;background:#F0B429;color:#3B2C05;',
    'font-weight:800;font-size:13px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:5px;padding:0 11px}',
    /* EVERY author display rule in this stylesheet out-ranks the user-agent's
       [hidden]{display:none}, because author origin beats UA origin. Without
       this rule `alert.hidden = true` hides nothing and the unread pill is
       drawn as an empty 46px amber square in the header all day -- a live,
       unlabelled control that throws the doctor out of an open patient. Scoped
       to the frame and stated once, so no future element in here inherits the
       same trap. */
    '#mlsPh3 [hidden]{display:none!important}',

    /* ---- scrolling body ----------------------------------------------------
       overscroll-behavior stops the page underneath scrolling when this list
       reaches its end. */
    '#mlsPh3Body{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;',
    '-webkit-overflow-scrolling:touch;',
    'padding:13px calc(env(safe-area-inset-right) + 13px) 20px calc(env(safe-area-inset-left) + 13px);}',

    /* ---- the action bar ----------------------------------------------------
       ONE button. The only part of the screen a thumb reaches without
       re-gripping, so it holds the single thing this screen is for, named for
       what it will do. It never scrolls. When a screen genuinely has no action
       the bar is not drawn at all, rather than drawn empty or disabled. */
    '#mlsPh3Act{flex:none;background:var(--ph3-card);border-top:1px solid var(--ph3-line);',
    'padding:10px calc(env(safe-area-inset-right) + 13px) calc(env(safe-area-inset-bottom) + 10px) calc(env(safe-area-inset-left) + 13px);',
    'box-shadow:0 -2px 14px rgba(18,32,26,.06)}',
    '#mlsPh3Act .ph3-sub{font-weight:600;font-size:12px;line-height:1.35;color:var(--ph3-dim);margin:0 0 7px;text-align:center;',
    'display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}',
    '#mlsPh3Act .ph3-row{display:flex;gap:9px}',

    /* exactly one primary shape in the whole app */
    '#mlsPh3 .ph3-primary{display:flex;align-items:center;justify-content:center;gap:9px;width:100%;',
    'min-height:56px;border:0;border-radius:16px;background:var(--ph3-green);color:#fff;',
    'font-weight:800;font-size:17px;line-height:1.2;cursor:pointer;padding:12px 16px}',
    '#mlsPh3 .ph3-primary:active{transform:scale(.985)}',
    '#mlsPh3 .ph3-primary[disabled]{background:#C3CFC8;color:#F4F7F5;cursor:default;transform:none}',
    '#mlsPh3 .ph3-primary.ph3-stop{background:var(--ph3-red)}',
    '#mlsPh3 .ph3-secondary{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;',
    'min-height:52px;border:1.5px solid var(--ph3-line);border-radius:16px;background:var(--ph3-card);',
    'color:var(--ph3-ink);font-weight:700;font-size:15px;line-height:1.2;cursor:pointer;padding:11px 14px}',
    '#mlsPh3 .ph3-secondary:active{background:var(--ph3-wash)}',
    '#mlsPh3 .ph3-secondary.ph3-narrow{width:auto;flex:none;padding:11px 18px}',

    /* ---- cards -------------------------------------------------------------*/
    '#mlsPh3 .ph3-card{background:var(--ph3-card);border:1px solid var(--ph3-line);border-radius:16px;',
    'padding:14px 15px;margin:0 0 11px;box-shadow:0 1px 2px rgba(18,32,26,.04)}',
    '#mlsPh3 .ph3-card.ph3-flat{box-shadow:none;background:transparent;border:0;padding:0}',
    '#mlsPh3 .ph3-h{font-weight:800;font-size:16px;line-height:1.3;margin:0 0 3px}',
    '#mlsPh3 .ph3-p{font-weight:500;font-size:13.5px;line-height:1.5;color:var(--ph3-dim);margin:0}',
    '#mlsPh3 .ph3-p b{color:var(--ph3-ink)}',
    '#mlsPh3 .ph3-detail{font-weight:500;font-size:12px;line-height:1.45;color:var(--ph3-dim);margin:9px 0 0;',
    'padding-top:9px;border-top:1px solid var(--ph3-line);word-break:break-word}',
    '#mlsPh3 .ph3-sect{font-weight:800;font-size:12px;line-height:1.2;letter-spacing:.7px;text-transform:uppercase;',
    'color:var(--ph3-dim);margin:16px 2px 8px}',
    '#mlsPh3 .ph3-sect:first-child{margin-top:2px}',

    /* ---- the day strip -----------------------------------------------------*/
    '#mlsPh3Day{display:flex;align-items:center;gap:8px;margin:0 0 12px}',
    '#mlsPh3Day .ph3-arrow{flex:none;width:46px;height:46px;border:1px solid var(--ph3-line);border-radius:16px;',
    'background:var(--ph3-card);color:var(--ph3-ink);font-weight:700;font-size:19px;line-height:1;cursor:pointer}',
    '#mlsPh3Day .ph3-arrow[disabled]{opacity:.42;cursor:default}',
    '#mlsPh3Day .ph3-daylabel{flex:1;min-width:0;text-align:center}',
    '#mlsPh3Day .ph3-d1{font-weight:800;font-size:17px;line-height:1.2;margin:0}',
    '#mlsPh3Day .ph3-d2{font-weight:600;font-size:12px;line-height:1.3;color:var(--ph3-dim);margin:2px 0 0}',
    '#mlsPh3Day .ph3-today{flex:none;height:46px;border:1px solid var(--ph3-line);border-radius:16px;background:var(--ph3-card);',
    'color:var(--ph3-green2);font-weight:800;font-size:13px;line-height:1;cursor:pointer;padding:0 12px}',

    /* ---- patient rows ------------------------------------------------------
       The list IS the app. One row, one person, one tap. */
    '#mlsPh3 .ph3-rows{display:block;margin:0}',
    '#mlsPh3 .ph3-row{display:flex;align-items:center;gap:12px;width:100%;min-height:70px;text-align:left;',
    'border:1px solid var(--ph3-line);border-bottom:0;background:var(--ph3-card);color:var(--ph3-ink);',
    'cursor:pointer;padding:12px 13px;font:inherit}',
    '#mlsPh3 .ph3-row:first-child{border-radius:16px 16px 0 0}',
    '#mlsPh3 .ph3-row:last-child{border-radius:0 0 16px 16px;border-bottom:1px solid var(--ph3-line)}',
    '#mlsPh3 .ph3-row:only-child{border-radius:16px}',
    '#mlsPh3 .ph3-row:active{background:var(--ph3-wash)}',
    '#mlsPh3 .ph3-row .ph3-when{flex:none;width:64px;font-weight:800;font-size:13px;line-height:1.25;color:var(--ph3-green2)}',
    '#mlsPh3 .ph3-row .ph3-who{flex:1;min-width:0}',
    '#mlsPh3 .ph3-row .ph3-nm{font-weight:700;font-size:16px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#mlsPh3 .ph3-row .ph3-sub2{font-weight:500;font-size:12.5px;line-height:1.35;color:var(--ph3-dim);margin-top:2px;',
    'overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '#mlsPh3 .ph3-row .ph3-go{flex:none;color:#9AA8A0;font-size:20px;line-height:1}',
    '#mlsPh3 .ph3-row.ph3-live{background:#FBF3F3;border-color:#E9CFCF}',

    /* small state chips */
    '#mlsPh3 .ph3-chip{display:inline-flex;align-items:center;gap:4px;border-radius:999px;padding:2px 8px;',
    'font-weight:800;font-size:11px;line-height:1.5;letter-spacing:.2px;white-space:nowrap}',
    '#mlsPh3 .ph3-chip.ph3-ok{background:var(--ph3-wash);color:var(--ph3-green2)}',
    '#mlsPh3 .ph3-chip.ph3-warn{background:#FBF2DF;color:var(--ph3-amber)}',
    '#mlsPh3 .ph3-chip.ph3-bad{background:#FBECEC;color:var(--ph3-red)}',

    /* ---- the sticky in-frame message --------------------------------------
       A toast is four seconds and gone, which is right for "copied". A refusal
       the doctor has to act on has to still be there when they look up. */
    '#mlsPh3Note{flex:none;display:none;gap:10px;align-items:flex-start;background:#FBF2DF;color:#4A3708;',
    'border-bottom:1px solid #EBDCBB;padding:11px calc(env(safe-area-inset-right) + 13px) 11px calc(env(safe-area-inset-left) + 13px);',
    'font-weight:600;font-size:13px;line-height:1.45}',
    '#mlsPh3Note.ph3-show{display:flex}',
    '#mlsPh3Note.ph3-bad{background:#FBECEC;color:#5B1A18;border-bottom-color:#EDCFCF}',
    '#mlsPh3Note .ph3-nx{flex:none;width:30px;height:30px;border:0;border-radius:10px;background:rgba(0,0,0,.07);',
    'color:inherit;font-weight:700;font-size:15px;line-height:1;cursor:pointer;margin:-2px -4px 0 0}',
    '#mlsPh3Note .ph3-ntxt{flex:1;min-width:0}',

    /* ---- the menu sheet ----------------------------------------------------
       Appended to the FRAME, not to the scrolling body, so an engine repaint
       cannot blow it away under the doctor's thumb. */
    '#mlsPh3Sheet{position:absolute;inset:0;z-index:20;display:none}',
    '#mlsPh3Sheet.ph3-open{display:block}',
    '#mlsPh3Sheet .ph3-scrim{position:absolute;inset:0;background:rgba(12,22,17,.44)}',
    '#mlsPh3Sheet .ph3-panel{position:absolute;left:0;right:0;bottom:0;background:var(--ph3-card);',
    'border-radius:22px 22px 0 0;padding:8px 0 calc(env(safe-area-inset-bottom) + 10px);',
    'max-height:88%;overflow-y:auto;box-shadow:0 -10px 40px rgba(12,22,17,.24)}',
    '#mlsPh3Sheet .ph3-grab{width:42px;height:5px;border-radius:999px;background:#D8DFDA;margin:6px auto 4px}',
    '#mlsPh3Sheet .ph3-who2{font-weight:600;font-size:12.5px;line-height:1.4;color:var(--ph3-dim);padding:6px 20px 10px;',
    'border-bottom:1px solid var(--ph3-line);word-break:break-all}',
    '#mlsPh3Sheet .ph3-item{display:flex;align-items:center;gap:13px;width:100%;min-height:60px;text-align:left;',
    'border:0;border-bottom:1px solid var(--ph3-line);background:transparent;color:var(--ph3-ink);',
    'font:inherit;cursor:pointer;padding:11px 20px}',
    '#mlsPh3Sheet .ph3-item:last-child{border-bottom:0}',
    '#mlsPh3Sheet .ph3-item:active{background:var(--ph3-wash)}',
    '#mlsPh3Sheet .ph3-item .ph3-ig{flex:none;font-size:20px;line-height:1;width:24px;text-align:center}',
    '#mlsPh3Sheet .ph3-item .ph3-il{font-weight:700;font-size:15.5px;line-height:1.25}',
    '#mlsPh3Sheet .ph3-item .ph3-is{font-weight:500;font-size:12.5px;line-height:1.35;color:var(--ph3-dim);margin-top:2px}',
    '#mlsPh3Sheet .ph3-item.ph3-danger .ph3-il{color:var(--ph3-red)}',

    /* ---- the check-in brief ------------------------------------------------*/
    '#mlsPh3 .ph3-ck{border:1px solid #E4D9BE;background:#FDF8EC;border-radius:16px;margin:0 0 11px;overflow:hidden}',
    '#mlsPh3 .ph3-ck.ph3-ckflag{border-color:#E9CFCF;background:#FDF1F1}',
    '#mlsPh3 .ph3-ckhead{display:flex;align-items:flex-start;gap:10px;width:100%;text-align:left;border:0;',
    'background:transparent;color:var(--ph3-ink);cursor:pointer;padding:13px 14px;font:inherit}',
    '#mlsPh3 .ph3-ckhead:active{background:rgba(0,0,0,.03)}',
    '#mlsPh3 .ph3-ckttl{font-weight:700;font-size:14.5px;line-height:1.35}',
    '#mlsPh3 .ph3-ckmeta{font-weight:500;font-size:11.5px;line-height:1.35;color:var(--ph3-dim);margin-top:3px}',
    '#mlsPh3 .ph3-ckbody{padding:0 14px 14px;font-weight:500;font-size:13.5px;line-height:1.5}',
    '#mlsPh3 .ph3-ckbody ul{margin:0 0 10px;padding-left:19px}',
    '#mlsPh3 .ph3-ckbody li{margin:0 0 5px}',
    '#mlsPh3 .ph3-ckbody li.ph3-flag{color:var(--ph3-red);font-weight:700}',
    '#mlsPh3 .ph3-ckq{background:#fff;border:1px solid var(--ph3-line);border-radius:10px;padding:10px 12px;margin:0 0 10px}',
    '#mlsPh3 .ph3-cksum{white-space:pre-wrap;word-break:break-word;font-weight:500;font-size:13px;line-height:1.55;color:var(--ph3-ink);margin:0}',

    /* ---- quick history -----------------------------------------------------*/
    '#mlsPh3 .ph3-facts{font-weight:600;font-size:12.5px;line-height:1.45;color:var(--ph3-dim);margin:0 0 10px}',
    '#mlsPh3 .ph3-dl{display:grid;grid-template-columns:96px 1fr;gap:7px 12px;margin:0;font-weight:500;font-size:13.5px;line-height:1.45}',
    '#mlsPh3 .ph3-dt{font-weight:800;color:var(--ph3-dim);font-size:12.5px;margin:0}',
    '#mlsPh3 .ph3-dd{margin:0;word-break:break-word}',
    '#mlsPh3 .ph3-dd.ph3-none{color:#93A199;font-style:italic}',

    /* ---- transcript + note -------------------------------------------------*/
    '#mlsPh3 .ph3-ta{width:100%;min-height:132px;border:1px solid var(--ph3-line);border-radius:10px;',
    'padding:11px 12px;font-weight:500;font-size:16px;line-height:1.5;color:var(--ph3-ink);background:var(--ph3-card);resize:vertical}',
    '#mlsPh3 .ph3-ta[readonly]{background:#FAFBFA;color:#3D4A43}',
    '#mlsPh3 .ph3-ta:focus{outline:2px solid var(--ph3-green2);outline-offset:1px}',

    /* find box: 16px is the floor at which iOS stops zooming the page on focus */
    '#mlsPh3 .ph3-find{width:100%;min-height:50px;border:1px solid var(--ph3-line);border-radius:16px;',
    'padding:11px 14px;font-weight:500;font-size:16px;line-height:1.3;color:var(--ph3-ink);background:var(--ph3-card);margin:0 0 11px}',

    '#mlsPh3 .ph3-rec{display:inline-block;width:11px;height:11px;border-radius:50%;background:#fff;',
    'animation:ph3blink 1.1s steps(2,start) infinite}',
    '@keyframes ph3blink{50%{opacity:.25}}',
    '@media (prefers-reduced-motion: reduce){#mlsPh3 .ph3-rec{animation:none}#mlsPh3 .ph3-primary:active{transform:none}}',
    ''
  ].join('\n');

  /* ===========================================================================
   * STATE
   * `screen` is the whole navigation model: 'day' is home, 'visit' is pushed on
   * top of it and has a Back button. There is no third destination, because the
   * third destination was a settings manual and it is now the sheet.
   * =========================================================================*/
  var S = {
    mounted: false,
    screen: 'day',
    menu: false,
    q: '',                 /* the find box */
    lastSig: '',
    note: null,            /* {text, kind} sticky in-frame message, or null */
    ck: null,              /* check-in rows, or null before the first answer */
    ckErr: '',
    ckSeen: {},            /* id|state -> 1, so the SAME check-in finishing announces again */
    ckRead: {},            /* id -> 1 once the doctor has opened it: the badge is UNREAD */
    ckOpen: '',
    ckPing: 0,             /* how many arrived since the last render drew the banner */
    ckAt: 0,
    tick: null,
    ckTimer: null,
    obs: null,
    txMirror: '',          /* the engine transcript value we last mirrored */
    a2hs: null,            /* a captured beforeinstallprompt, or null */
    booted: false
  };
  api.state = function () { return { screen: S.screen, tab: S.screen, mounted: S.mounted, menu: S.menu }; };

  var frameEl = null, hdrEl = null, bodyEl = null, actEl = null, noteEl = null, sheetEl = null;

  /* ===========================================================================
   * MOUNT
   * =========================================================================*/
  function mount() {
    if (S.mounted) return;
    if (!document.body) return;
    if (!document.getElementById('mlsPh3Css')) (document.head || document.documentElement).appendChild(st);
    frameEl = document.createElement('div');
    frameEl.id = 'mlsPh3';
    frameEl.setAttribute('data-ph3', VERSION);
    frameEl.innerHTML =
      '<div id="mlsPh3Hdr">' +
        '<button type="button" id="mlsPh3Nav" class="ph3-dot"><span class="ph3-gl">&#9776;</span></button>' +
        '<div class="ph3-grow"><div class="ph3-t" id="mlsPh3Title">MLS</div><div class="ph3-s" id="mlsPh3Sub"></div></div>' +
        '<button type="button" id="mlsPh3Alert" class="ph3-pill" hidden></button>' +
      '</div>' +
      '<div id="mlsPh3Note"><div class="ph3-ntxt" id="mlsPh3NoteTxt"></div>' +
        '<button type="button" class="ph3-nx" data-act="note-x" aria-label="Dismiss">&#215;</button></div>' +
      '<div id="mlsPh3Body"></div>' +
      '<div id="mlsPh3Act"></div>';
    document.body.appendChild(frameEl);
    /* Guarded, both ways. classList.add()/remove() RE-SERIALISE and re-set the
       attribute even when nothing changes, which invalidates style for the
       whole document -- and this runs on every ensure() pass. */
    if (!document.body.classList.contains('mls-ph3')) document.body.classList.add('mls-ph3');
    standDownLegacyPhoneLayer();

    hdrEl = $('mlsPh3Hdr'); bodyEl = $('mlsPh3Body'); actEl = $('mlsPh3Act'); noteEl = $('mlsPh3Note');

    /* ONE delegated handler for the frame. Every control in every screen is
       identified by data-act, so a repaint can never leave a listener bound to
       a node that is no longer on the screen. */
    frameEl.addEventListener('click', onClick);
    frameEl.addEventListener('input', onInput);
    $('mlsPh3Nav').addEventListener('click', onNav);
    /* ROUTE TWO OF TWO to the check-ins screen: the notification itself is the
       way in. A pill that announces "3 check-ins" and then drops you on a
       different screen is a control whose press does not do what it says. */
    $('mlsPh3Alert').addEventListener('click', function () { goCheckins(); });

    S.mounted = true;
    S.lastSig = '';
    render(true);
  }

  /* THE LEGACY LAYER STANDS DOWN WHILE THIS MODULE OWNS THE SCREEN.
     __mlsPhoneHome ph-1.1.0 puts `mls-phone` on the body and with it 28 static
     hide rules written against a layout that has been rebuilt three times.
     Under an opaque frame they do nothing but cost style recalculation -- and
     leaving the class on means two owners are shaping one screen. mls-connect's
     own ensure() removes it too once newUiOwns() answers true, but it runs on
     its own schedule, so the class lingers for the first seconds of every
     session unless this module also asks. */
  function standDownLegacyPhoneLayer() {
    safe(function () {
      if (document.body.classList.contains('mls-phone')) document.body.classList.remove('mls-phone');
    });
  }

  function unmount() {
    if (!S.mounted) return;
    clearConfirm();
    closeMenu();
    safe(function () { frameEl.parentNode.removeChild(frameEl); });
    safe(function () { document.body.classList.remove('mls-ph3'); });
    frameEl = hdrEl = bodyEl = actEl = noteEl = null;
    /* sheetEl was a CHILD of the frame that just left the document. Leaving the
       handle set means a later openMenu() writes into a detached node and the
       menu is silently dead for the rest of the session. */
    sheetEl = null;
    S.mounted = false;
    S.menu = false;
    forgetSession();
  }

  /* EVERYTHING THIS MODULE HOLDS ABOUT A PERSON, DROPPED.
     Unmount happens when the doctor signs out, and the next person to pick this
     phone up may be a different doctor. S.ck holds patient headlines, bullets,
     summaries and portal ids fetched from /api/avatar/checkins; S.ckRead and
     S.ckSeen say which of THIS account's patients were read; api._presence names
     the office computer. None of it is written to disk, and none of it may
     survive the account boundary in memory either. */
  function forgetSession() {
    S.ck = null; S.ckErr = ''; S.ckSeen = {}; S.ckRead = {}; S.ckOpen = ''; S.ckPing = 0; S.ckAt = 0;
    S.q = ''; S.note = null; S.txMirror = ''; S.screen = 'day'; S.lastSig = '';
    api._presence = null; api._presenceErr = ''; presenceAt = 0;
  }

  function scrollTop() { safe(function () { if (bodyEl) bodyEl.scrollTop = 0; }); }

  /* ===========================================================================
   * THE STICKY MESSAGE
   * The app's toast is used for everything transient and is genuinely visible
   * over this frame (z-index 99999, measured). This is for the other kind: a
   * refusal the doctor has to do something about, which must still be on the
   * screen when they look back up. It survives repaints because it lives in the
   * frame, not in the body that gets rewritten.
   * =========================================================================*/
  function say(text, kind) {
    S.note = { text: String(text || ''), kind: kind === 'bad' ? 'bad' : 'warn' };
    paintNote();
  }
  function clearSay() { S.note = null; paintNote(); }
  function paintNote() {
    if (!noteEl) return;
    var t = $('mlsPh3NoteTxt');
    if (!S.note) { noteEl.className = ''; if (t) t.textContent = ''; return; }
    if (t) t.textContent = S.note.text;
    noteEl.className = 'ph3-show' + (S.note.kind === 'bad' ? ' ph3-bad' : '');
  }
  /* A refusal is said BOTH ways: the toast catches the eye now, the sticky line
     is still there in ten seconds. One without the other is how "nothing
     happened when I pressed it" happens. */
  function refuse(text) { toast(text, 'err'); say(text, 'bad'); }

  /* ---------------------------------------------------------------------------
   * DID IT ACTUALLY HAPPEN?
   * The engine's booleans mean "dispatched", not "done". record() returns true
   * once it has clicked the host capture button -- and a phone whose microphone
   * permission was refused, or whose page has lost the user-gesture chain, sits
   * at phase 'idle' afterwards with the engine reporting success. That is the
   * exact shape of the owner's complaint: press the button, nothing happens,
   * nothing is said. So every action that claims a phase CHECKS for that phase
   * a moment later and says so if it never arrived. One timer, cleared with
   * `!== null` because a handle of 0 is falsy.
   * -------------------------------------------------------------------------*/
  var confirmTimer = null;
  function clearConfirm() { if (confirmTimer !== null) { clearTimeout(confirmTimer); confirmTimer = null; } }

  /* snapshot.warn is NOT always a refusal. The engine writes it for the
     UNSCHEDULED-VISIT DEMOTION too -- "recording and note generation still work
     normally" -- and printing that as the reason a button just failed tells the
     doctor the opposite of what happened. Only a sentence that is actually
     about something not working is allowed to stand in for a refusal. */
  function warnAsRefusal(sn) {
    var w = String((sn && sn.warn) || '').trim();
    if (!w) return '';
    if (/still work|works normally|will stay in MLS/i.test(w)) return '';
    return w;
  }
  function expectPhase(wanted, ms, message) {
    clearConfirm();
    confirmTimer = setTimeout(function () {
      confirmTimer = null;
      if (!S.mounted) return;
      var sn = snap();
      var p = sn ? String(sn.phase || '') : '';
      for (var i = 0; i < wanted.length; i++) if (p === wanted[i]) return;
      /* The engine's own sentence wins when it has one. */
      refuse(warnAsRefusal(sn) || message);
      S.lastSig = ''; render(true);
    }, ms);
  }

  /* ===========================================================================
   * THE MENU SHEET -- account and device, the two things this app cannot do
   * without and cannot fit on a header.
   * =========================================================================*/
  function accountLine() {
    var who = safe(function () { var w = $('whoLabel'); return String((w && w.textContent) || '').trim(); }, '');
    if (who) return who;
    return safe(function () { return typeof window.getSessionEmail === 'function' ? String(window.getSessionEmail() || '') : ''; }, '');
  }
  /* '' = no route worth offering, 'prompt' = the browser has offered one,
     'ios' = no prompt exists on this platform and never will, but the Share
     sheet route does. Already installed => nothing to offer. */
  function installKind() {
    var standalone = safe(function () {
      return (window.navigator && window.navigator.standalone === true) ||
        (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches === true);
    }, false);
    if (standalone) return '';
    if (S.a2hs) return 'prompt';
    var ua = safe(function () { return navigator.userAgent || ''; }, '');
    if (/iPhone|iPod|iPad/i.test(ua)) return 'ios';
    return '';
  }
  function menuItem(act, glyph, label, sub, danger) {
    return '<button type="button" class="ph3-item' + (danger ? ' ph3-danger' : '') + '" data-act="' + act + '">' +
      '<span class="ph3-ig">' + glyph + '</span><span style="flex:1;min-width:0">' +
      '<span class="ph3-il" style="display:block">' + esc(label) + '</span>' +
      (sub ? '<span class="ph3-is" style="display:block">' + esc(sub) + '</span>' : '') +
      '</span></button>';
  }
  function menuHtml() {
    var who = accountLine();
    var dev = deviceNoun();
    var h = '<div class="ph3-scrim" data-act="menu-close"></div><div class="ph3-panel" role="dialog" aria-label="Menu">' +
      '<div class="ph3-grab"></div>' +
      (who ? '<div class="ph3-who2">Signed in as ' + esc(who) + '</div>' : '');
    /* ROUTE ONE OF TWO to the check-ins screen, and the one that is ALWAYS
       here. The unread pill is route two and it only exists while something is
       unread — so without this item a brief the doctor has already read would
       have no way back, which is how a "notification" becomes a thing you can
       only ever see once. Counted, and first, because on a clinic morning it is
       the reason the phone came out of the pocket. */
    var ckN = ckRows().length, ckU = ckUnread();
    h += menuItem('checkins', '&#128172;', 'Check-ins before the room' + (ckU ? '  (' + ckU + ' unread)' : ''),
      ckN ? (ckN + ' patient' + (ckN === 1 ? '' : 's') + ' have talked to the avatar') : 'What patients told the avatar in the waiting room');
    h += menuItem('refresh', '&#8635;', 'Refresh', 'Re-read the schedule and your charts from MLS');
    h += menuItem('settings', '&#9881;', 'Settings', 'Every setting for this account');
    h += menuItem('device', '&#128241;', 'This ' + dev, 'Name it, and choose what it is: Settings → Integrations → This device');
    /* Android fires beforeinstallprompt and the item installs. iOS never fires
       it and never will, but Share -> Add to Home Screen works there, so the
       item is still offered and TELLS the doctor the route. An item that
       explains is not a dead control; an item that is absent on the one
       platform this app is mostly used on is a missing feature. */
    var inst = installKind();
    if (inst) h += menuItem('install', '&#11015;', 'Add to Home Screen',
      inst === 'ios' ? 'Share → Add to Home Screen. It opens like an app, with no browser bars.'
                     : 'Opens like an app, with no browser bars');
    h += menuItem('fullapp', '&#128421;', 'Show the full app', 'Every screen, built for a big monitor. It will be cramped here.');
    h += menuItem('signout', '&#128682;', 'Sign out of ' + thisDevice(), 'Clears the patient information stored on this ' + dev, true);
    h += '</div>';
    return h;
  }
  function openMenu() {
    if (!S.mounted || S.menu) return;
    if (!sheetEl) {
      sheetEl = document.createElement('div');
      sheetEl.id = 'mlsPh3Sheet';
      frameEl.appendChild(sheetEl);
    }
    sheetEl.innerHTML = menuHtml();
    sheetEl.className = 'ph3-open';
    S.menu = true;
    safe(function () { var b = $('mlsPh3Nav'); if (b) b.setAttribute('aria-expanded', 'true'); });
    safe(function () {
      var first = sheetEl.querySelector('.ph3-item');
      if (first && first.focus) first.focus();
    });
  }
  function closeMenu() {
    if (!sheetEl) { S.menu = false; return; }
    sheetEl.className = '';
    sheetEl.innerHTML = '';
    if (S.menu) safe(function () { var b = $('mlsPh3Nav'); if (b) { b.setAttribute('aria-expanded', 'false'); if (b.focus) b.focus(); } });
    S.menu = false;
  }
  function toggleMenu() { if (S.menu) closeMenu(); else openMenu(); }
  api.menu = function (open) { if (open === false) closeMenu(); else openMenu(); };

  /* The left header control is the ONE navigational control and it changes
     meaning by screen. On a visit it is Back; on the day it is the menu. */
  function onNav() {
    if (S.screen === 'visit' || S.screen === 'checkins') { goDay(); return; }
    toggleMenu();
  }

  /* ===========================================================================
   * ENGINE READS
   * =========================================================================*/
  function snap() {
    var r = remote();
    if (!r || typeof r.snapshot !== 'function') return null;
    return safe(function () { return r.snapshot(); }, null);
  }
  /* ---------------------------------------------------------------------------
   * ONE DAY, NOT TWO. There are two day states in this product and they are
   * different variables: __mlsDaySwitch's DS.day (what the strip says) and the
   * Easy engine's S.visitDay (what the LIST is built from). setDay() keeps them
   * transactional, and both start from the practice-timezone key, so they agree
   * almost always -- but "almost always" is not a thing a schedule can be. When
   * they drift, the phone prints one date over another date's patients, and a
   * doctor reads a name that is not in the room.
   *
   * So: the label is taken from the SAME place the rows are (the engine), and a
   * disagreement is RECONCILED by pushing the strip's day through setDay() --
   * the one call that is allowed to move both. Once per distinct pair, never
   * while a pull or a recording is running (setDay refuses then, correctly), and
   * never from inside a repaint loop.
   * -------------------------------------------------------------------------*/
  function stripDay() {
    var d = daySwitch();
    return safe(function () { return d && d.currentDay ? d.currentDay() : ''; }, '');
  }
  function engineDay() {
    var sn = snap();
    return (sn && sn.day) || '';
  }
  var lastReconcile = '';
  function reconcileDay(strip, engine) {
    var pair = strip + '>' + engine;
    if (lastReconcile === pair) return;
    lastReconcile = pair;
    if (pulling()) return;
    var d = daySwitch();
    if (!d || typeof d.setDay !== 'function') return;
    safe(function () { d.setDay(strip); });
  }
  function today() {
    var e = engineDay(), s = stripDay();
    if (e && s && e !== s) reconcileDay(s, e);
    return e || s;
  }
  /* "Today" belongs to the PRACTICE time zone, never the device clock -- a phone
     carried across a time-zone line must not silently re-date the schedule. */
  function todayKey() {
    var k = safe(function () { return typeof window._acctTodayKey === 'function' ? window._acctTodayKey() : ''; }, '');
    if (/^\d{4}-\d{2}-\d{2}$/.test(k)) return k;
    var t = $('mlsDsTodayBtn');
    if (t && t.disabled) return today();   /* the strip disables it only on Today */
    return '';
  }
  /* The engine's own row model (snapshot.today) is preferred: it is provider-
     filtered and carries `seen`, which the raw appointment objects do not.
     rowsFor is the fallback for the window before the engine has mounted. */
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
    return !!activeRelayJob();
  }
  function activeRelayJob() {
    var rl = relay();
    if (!rl || typeof rl.activeJob !== 'function') return null;
    return safe(function () { return rl.activeJob(); }, null) || null;
  }
  /* Is THIS pull going through the office computer, or running on this device?
     Two different sentences and two different Stop buttons, so the question is
     asked of the relay itself rather than of whether the relay module exists. */
  function relaying() {
    var rl = relay();
    if (!rl || typeof rl.shouldRelay !== 'function') return false;
    return !!safe(function () { return rl.shouldRelay(); }, false);
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return { main: 'Today', sub: '', isToday: true };
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
  /* snapshot.today rows carry `type`; the raw appointment objects carry
     `reason`/`appt_type`. Both shapes reach this list, so both are read. */
  function rowReason(a) {
    return String((a && (a.reason || a.type || a.appt_type || a.visit_type)) || '').trim();
  }

  /* ===========================================================================
   * THE AVATAR PRE-VISIT CHECK-IN
   * ---------------------------------------------------------------------------
   * Owner: "the patient enters the room, the avatar starts recording them and
   * asking them questions, then their convo ends and the doctor should get a
   * notification that the patient intake convo is done and then give the doctor
   * the important summary on the phone app we have here."
   *
   * The interview already exists and already publishes its result to
   * /api/avatar/checkins. This is a second READER of one endpoint -- no new
   * interview, no new summary, no clinical rule stated twice.
   *
   * WHAT "NOTIFICATION" HONESTLY MEANS HERE. There is no APNs/FCM credential
   * and no server holding device tokens, so nothing can reach a phone asleep in
   * a pocket. This checks WHILE THE APP IS OPEN, vibrates once, and shows an
   * unread pill in the header. It must never say "we will notify you", because
   * a doctor who believes that stops looking.
   *
   * KEYED BY id AND STATE, not id alone: the endpoint deliberately returns a
   * FLAGGED interview that is still running alongside the finished ones, so a
   * red flag reaches the doctor before the patient has stopped answering. Keyed
   * by id alone, that first announcement burns the id and the FINISH -- a
   * different event, and the one carrying the summary -- never announces.
   *
   * THE BADGE COUNTS UNREAD. ph2 counted every ready row the endpoint returned,
   * so a doctor who read all five briefs at 8:05 carried a red 5 all morning
   * and the number stopped meaning anything. Read is tracked HERE, in memory,
   * and deliberately NOT written to the server: POST /api/avatar/checkins/:id/seen
   * exists, but the desktop avatar panel polls the same ?status=ready list, so
   * marking seen from the phone would delete the brief from the office screen
   * as a side effect of the doctor glancing at his phone. Whether a phone read
   * should clear the office is a product decision, not a repaint detail.
   *
   * Nothing from this endpoint is written to disk. It lives in memory and is
   * dropped on the session boundary with everything else.
   * =========================================================================*/
  var CK_POLL_MS = 45000;

  function ckKey(c) { return String(c && c.id || '') + '|' + (c && c.inProgress ? 'run' : 'done'); }
  function ckRows() { return (S.ck && S.ck.length != null) ? S.ck : []; }
  function ckReady() {
    var out = [], r = ckRows();
    for (var i = 0; i < r.length; i++) if (r[i] && !r[i].inProgress) out.push(r[i]);
    return out;
  }
  /* UNREAD only. A flagged interview still running has no summary to go and
     read, so it is not counted -- it is shown, in red, in the list. */
  function ckUnread() {
    var n = 0, r = ckReady();
    for (var i = 0; i < r.length; i++) if (!S.ckRead[String(r[i].id)]) n++;
    return n;
  }
  function ckPatientName(c) {
    var ext = String((c && c.patient_external_id) || '').trim();
    if (!ext) return '';
    /* Matched on the PORTAL ID through the schedule row, never on the name. */
    var ap = safe(function () { return window._calAppts || []; }, []) || [];
    for (var i = 0; i < ap.length; i++) {
      if (ap[i] && String(ap[i].patient_external_id || '') === ext) return rowName(ap[i]);
    }
    return '';
  }
  /* ready_at comes off a Postgres timestamp and does not always carry a zone.
     Date.parse on a bare "2026-08-09 07:41:02" is LOCAL time, so a phone in a
     clinic five hours behind UTC reads every brief as five hours in the future
     and prints "just now" for all of them -- the one number the doctor uses to
     decide whether a summary is still about the person in the room. Normalised
     to UTC when the string says nothing, which is what the server means. */
  function ckAgo(c) {
    var raw = String((c && c.ready_at) || '').trim();
    if (!raw) return '';
    if (!/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw)) raw = raw.replace(' ', 'T') + 'Z';
    var t = safe(function () { return Date.parse(raw); }, NaN);
    if (!t || isNaN(t)) return '';
    var s = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (s < 60) return 'just now';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    return h + (h === 1 ? ' hour ago' : ' hours ago');
  }
  function ckFetch() {
    if (!authed()) return;
    var base = safe(function () { return window.bkBase(); }, '');
    var tok = safe(function () { return window.bkToken(); }, '');
    if (!base || !tok) return;
    safe(function () {
      fetch(base + '/api/avatar/checkins?status=ready', { headers: { 'Authorization': 'Bearer ' + tok } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) {
          if (!d) { S.ckErr = 'MLS could not read the check-ins just now.'; renderBg(); return; }
          S.ckErr = '';
          var list = (d.checkins || d.items || d.rows || []);
          if (list.length == null) list = [];
          var firstAnswer = !S.ckAt;
          var fresh = [];
          for (var i = 0; i < list.length; i++) {
            var k = ckKey(list[i]);
            if (!S.ckSeen[k]) { S.ckSeen[k] = 1; fresh.push(list[i]); }
          }
          S.ck = list;
          S.ckAt = Date.now();
          /* THE FIRST ANSWER IS NOT AN ARRIVAL. Everything the endpoint holds
             when the app opens was produced before the doctor picked the phone
             up -- often yesterday's leftovers, since ready rows are not cleared
             server-side. Buzzing for those trains the doctor to ignore the buzz.
             The first fetch SEEDS what is known; only what appears after it is
             announced. It still shows, and it still counts as unread. */
          if (fresh.length && !firstAnswer) {
            S.ckPing += fresh.length;
            safe(function () { if (navigator.vibrate) navigator.vibrate(30); });
            /* Nothing is auto-expanded. ph2 opened a newly arrived brief under
               whatever the doctor was already reading, which both moved the
               page and left the unread count contradicting a summary that was
               plainly on screen. Arrival is announced by the header pill, the
               unread-first ordering and the "new" chip; opening is a decision. */
          }
          renderBg();
        })
        .catch(function () { S.ckErr = 'MLS could not read the check-ins just now.'; renderBg(); });
    });
  }
  api._ckPoll = ckFetch;

  function ckCard(c) {
    var id = String(c.id || '');
    var open = (S.ckOpen === id);
    var flagged = !!(c.flags && c.flags.length) || !!c.inProgress;
    var who = ckPatientName(c);
    var meta = [];
    if (who) meta.push(who);
    var ago = ckAgo(c); if (ago) meta.push(ago);
    if (c.inProgress) meta.push('STILL ANSWERING');
    else if (!S.ckRead[id]) meta.push('new');
    /* THE AUDIT VERDICT TRAVELS. This summary was written by a model from what
       a patient said, and a second pass checks it against the transcript. A
       brief the audit REJECTED, or never graded, must not read exactly like one
       that passed -- the doctor is about to walk into the room on it. */
    var aud = c.audited;
    if (aud === false || String(aud).toLowerCase() === 'rejected') meta.push('AUDIT REJECTED THIS SUMMARY');
    else if (aud == null || aud === '') meta.push('not audit-checked');
    var h = '<div class="ph3-ck' + (flagged ? ' ph3-ckflag' : '') + '">' +
      '<button type="button" class="ph3-ckhead" data-act="ck-open" data-id="' + esc(id) + '" aria-expanded="' + (open ? 'true' : 'false') + '">' +
        '<span style="flex:1;min-width:0">' +
          '<span class="ph3-ckttl" style="display:block">' + esc(String(c.headline || (c.inProgress ? 'A check-in is running now' : 'Check-in finished'))) + '</span>' +
          '<span class="ph3-ckmeta" style="display:block">' + esc(meta.join(' · ')) + '</span>' +
        '</span><span class="ph3-go" aria-hidden="true">' + (open ? '&#9662;' : '&#9656;') + '</span>' +
      '</button>';
    if (open) {
      h += '<div class="ph3-ckbody">';
      /* The flags are the reason the card is red. Colour alone is not a
         message: it does not survive a screenshot to a colleague, it does not
         reach a colour-blind reader, and it does not say WHAT was flagged. */
      var fl = c.flags || [];
      if (fl.length) {
        h += '<p class="ph3-p" style="color:#8C2F2F;font-weight:700;margin:0 0 9px">';
        for (var fi = 0; fi < fl.length; fi++) h += (fi ? '<br>' : '') + '&#9888; ' + esc(String(fl[fi]));
        h += '</p>';
      }
      var b = c.bullets || [];
      if (b.length) {
        h += '<ul>';
        for (var i = 0; i < b.length; i++) {
          var line = String(b[i] == null ? '' : b[i]);
          var isFlag = /^\s*(?:⚠|!)/.test(line);
          h += '<li' + (isFlag ? ' class="ph3-flag"' : '') + '>' + esc(line.replace(/^\s*[⚠!]\s*/, '')) + '</li>';
        }
        h += '</ul>';
      }
      var ask = c.askAbout || [];
      if (ask.length) {
        h += '<div class="ph3-ckq"><b>Worth asking</b><ul style="margin-top:6px">';
        for (var j = 0; j < ask.length; j++) h += '<li>' + esc(String(ask[j])) + '</li>';
        h += '</ul></div>';
      }
      if (c.summary) h += '<p class="ph3-cksum">' + esc(String(c.summary)) + '</p>';
      if (c.inProgress) {
        h += '<p class="ph3-p" style="margin-top:9px">This patient is still answering. What is here now is partial.</p>';
      }
      h += '</div>';
    }
    h += '</div>';
    return h;
  }

  /* ===========================================================================
   * SCREEN: CHECK-INS -- its own place, reached two ways.
   * ---------------------------------------------------------------------------
   * Owner, 2026-08-10: "the check ins before the room needs to be a completly
   * spreate tab that u can aget to both throgyuth thetop left 3 lines or
   * throguht ththe notifications".
   *
   * It used to be a section stacked on top of the day list, which is wrong two
   * ways: on a busy morning several open briefs push the patient list -- the
   * thing the day screen is FOR -- below the fold, and a brief the doctor has
   * already read has no home to go back to once it stops being new. So it is a
   * screen, pushed like a visit, with Back in the header, and there are exactly
   * two routes to it: the ☰ menu (always) and the unread pill (when there is
   * something unread). Nothing else changes about the briefs themselves.
   *
   * Every brief, unread first. ph2 sliced to 8 and told the doctor the rest were
   * "waiting in MLS on the office computer" -- they were not, they were already
   * downloaded onto the phone he was holding.
   * =========================================================================*/
  function ckSorted() {
    return ckRows().slice().sort(function (a, b) {
      var ua = S.ckRead[String(a.id)] ? 1 : 0, ub = S.ckRead[String(b.id)] ? 1 : 0;
      if (ua !== ub) return ua - ub;
      return (Date.parse(b && b.ready_at) || 0) - (Date.parse(a && a.ready_at) || 0);
    });
  }
  function checkinsScreen() {
    var r = ckSorted();
    var h = '';
    if (S.ckErr) {
      h += '<div class="ph3-card" style="border-color:#E9CFCF;background:#FDF1F1"><p class="ph3-p" style="color:#5B1A18">' + esc(S.ckErr) + '</p></div>';
    }
    if (!r.length) {
      /* "Nobody has checked in" and "we could not ask" are OPPOSITE claims, and
         one of them means a patient is sitting in a room having finished. When
         the read failed, the failure is the only thing this screen knows — so
         the empty state is not printed underneath it. */
      if (S.ckErr) return h;
      h += '<div class="ph3-card"><p class="ph3-h">Nobody has checked in yet</p>' +
        '<p class="ph3-p">When a patient talks to the avatar in the waiting room, the summary of what they said appears here — before you walk in.</p>' +
        '<p class="ph3-p" style="margin-top:9px">This ' + esc(deviceNoun()) + ' checks every ' + Math.round(CK_POLL_MS / 1000) +
        ' seconds while the app is open. It cannot reach you when the screen is off.</p></div>';
      return h;
    }
    var unread = ckUnread();
    h += '<p class="ph3-sect">' + r.length + ' check-in' + (r.length === 1 ? '' : 's') +
      (unread ? ' &middot; ' + unread + ' unread' : '') + '</p>';
    for (var i = 0; i < r.length; i++) h += ckCard(r[i]);
    return h;
  }
  /* The schedule row a brief belongs to, matched on the PORTAL ID through the
     day's own rows -- never on the name. Returns null when this day does not
     hold that patient, which is the ordinary case for yesterday's leftovers. */
  function ckRowFor(c) {
    var ext = String((c && c.patient_external_id) || '').trim();
    if (!ext) return null;
    var list = rows();
    for (var i = 0; i < list.length; i++) {
      var a = list[i];
      if (a && String(a.patient_external_id || '') === ext) return a;
      /* snapshot.today rows carry only id/name/dob/time, so fall back to the
         raw appointment that shares the id. */
      var raw = rawApptById(rowId(a));
      if (raw && String(raw.patient_external_id || '') === ext) return a;
    }
    return null;
  }
  function rawApptById(id) {
    if (!id) return null;
    var ap = safe(function () { return window._calAppts || []; }, []) || [];
    for (var i = 0; i < ap.length; i++) if (ap[i] && String(rowId(ap[i])) === String(id)) return ap[i];
    return null;
  }
  /* On a visit: only THIS patient's check-in, above their history. */
  function ckForPatient(ext) {
    var key = String(ext || '').trim();
    if (!key) return '';
    var r = ckRows();
    for (var i = 0; i < r.length; i++) {
      if (r[i] && String(r[i].patient_external_id || '') === key) {
        return '<p class="ph3-sect">Their check-in</p>' + ckCard(r[i]);
      }
    }
    return '';
  }

  /* ===========================================================================
   * PRESENCE -- the office computer's own verdict, read on demand, never polled.
   * A failed read is SAID, not swallowed: ph2 caught every error and left the
   * state null, which rendered as "Checking your office computer… One moment."
   * forever and silenced the pull warning at the same time.
   * =========================================================================*/
  api._presence = null;
  api._presenceErr = '';
  var presenceAt = 0;
  function refreshPresence(force) {
    if (!authed()) return;
    var now = Date.now();
    if (!force && now - presenceAt < 25000) return;
    presenceAt = now;
    safe(function () {
      fetch(window.bkBase() + '/api/relay/presence', { headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + window.bkToken() } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (p) {
          if (p) { api._presence = p; api._presenceErr = ''; }
          else { api._presenceErr = 'MLS did not answer when this ' + deviceNoun() + ' asked about your office computer.'; }
          renderBg();
        })
        .catch(function () {
          api._presenceErr = 'This ' + deviceNoun() + ' could not reach MLS to check your office computer.';
          renderBg();
        });
    });
  }

  /* Known-before-you-press reasons a relayed pull cannot succeed. A pull that
     is going to fail should say so BEFORE the press, not after the wait. */
  function relayBlock() {
    if (!relaying()) return null;
    if (!authed()) return 'Sign in first — the pull runs against your account.';
    var p = api._presence;
    if (!p) return api._presenceErr || null;
    /* Each of these names the machine AND the next move. ph2 put the
       remediation steps on a Setup screen this app no longer has, and a
       blocker with no next move is half a message: the doctor knows it will
       fail and not what to do. An iPhone can never BE the office computer, so
       none of these ask the doctor to fix it here. */
    if (!p.officeName) return 'No office computer is set up yet, so nothing can read athenaOne for you. On the Windows or Mac computer that has MLS Assist, open MLS and set its role to "Office computer" in Settings → Integrations → This device.';
    if (!p.online) return p.officeName + ' is not reachable right now. It has to be awake, unlocked, with MLS open in a tab.';
    if (!p.ext) return 'MLS Assist is not responding on ' + p.officeName + ', so it cannot read athenaOne. Reload the extension there (chrome://extensions → ↻) and reopen MLS.';
    if (p.officeAth === 'no-tab') return 'athenaOne is signed out on ' + p.officeName + '. Sign in there first — this ' + deviceNoun() + ' cannot sign in for it.';
    return null;
  }

  /* ===========================================================================
   * SCREEN: DAY -- the list of patients. The list IS the app.
   * =========================================================================*/
  function dayStrip() {
    var d = fmtDayLabel(today());
    var busy = pulling();
    var dis = busy ? ' disabled' : '';
    return '<div id="mlsPh3Day">' +
      '<button type="button" class="ph3-arrow" data-act="day-prev" aria-label="Previous day"' + dis + '>&#8249;</button>' +
      '<div class="ph3-daylabel"><p class="ph3-d1">' + esc(d.main) + '</p><p class="ph3-d2">' + esc(d.sub) + '</p></div>' +
      (d.isToday ? '' : '<button type="button" class="ph3-today" data-act="day-today"' + dis + '>Today</button>') +
      '<button type="button" class="ph3-arrow" data-act="day-next" aria-label="Next day"' + dis + '>&#8250;</button>' +
    '</div>';
  }

  function patientRows() {
    var all = rows();
    var q = String(S.q || '').trim().toLowerCase();
    var list = all;
    if (q) {
      list = [];
      for (var i = 0; i < all.length; i++) {
        if (rowName(all[i]).toLowerCase().indexOf(q) >= 0) list.push(all[i]);
      }
    }
    if (!list.length) return { html: '', shown: 0, total: all.length };
    var sn = snap();
    var activeId = safe(function () { return String((sn && sn.active && (sn.active.id || sn.active.appointmentId)) || ''); }, '');
    var recording = !!(sn && sn.phase === 'rec');
    /* The provider is printed on a row ONLY when the day actually holds more
       than one. snapshot.today is already filtered to the active provider, so
       on the normal path it is the same name on every line -- 375px of width
       spent restating something that cannot vary. */
    var provs = {}, provN = 0;
    for (var k = 0; k < list.length; k++) {
      var pk = String((list[k] && list[k].provider) || '').trim();
      if (pk && !provs[pk]) { provs[pk] = 1; provN++; }
    }
    var seenN = 0;
    for (var m = 0; m < list.length; m++) if (list[m] && list[m].seen) seenN++;
    var h = '<div class="ph3-rows">';
    for (var j = 0; j < list.length; j++) {
      var a = list[j], id = rowId(a);
      var live = recording && id && id === activeId;
      var reason = rowReason(a);
      var sub = [];
      if (provN > 1 && a && a.provider) sub.push(String(a.provider).replace(/_/g, ' '));
      if (reason) sub.push(reason);
      /* `seen` is the engine's own word for it and it is used unchanged, so the
         phone and the desktop do not develop two vocabularies for one fact.
         It means checked in or already seen -- it is NOT a claim that a note
         exists, and the chip does not say one. */
      var seen = !!(a && a.seen);
      var tail = live ? '<span class="ph3-chip ph3-bad">Recording</span>'
        : (seen ? '<span class="ph3-chip ph3-ok">Seen</span>' : '<span class="ph3-go" aria-hidden="true">&#8250;</span>');
      h += '<button type="button" class="ph3-row' + (live ? ' ph3-live' : '') + '" data-act="open" data-id="' + esc(id) + '">' +
        '<span class="ph3-when">' + esc(rowTime(a) || '—') + '</span>' +
        '<span class="ph3-who"><span class="ph3-nm">' + esc(rowName(a)) + '</span>' +
        (sub.length ? '<span class="ph3-sub2">' + esc(sub.join(' · ')) + '</span>' : '') + '</span>' +
        tail +
      '</button>';
    }
    h += '</div>';
    return { html: h, shown: list.length, total: all.length, seen: seenN };
  }

  /* How many patients are on a day OTHER than the one on screen. Read straight
     out of the appointments this device has already loaded (__mlsDaySwitch's
     own bucketing, so the count uses exactly the rule the list will use when
     the doctor gets there) -- no fetch, no second source of truth. */
  function shiftKey(key, n) {
    var k = String(key || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) return '';
    var p = k.split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]), 12, 0, 0);
    d.setDate(d.getDate() + n);
    var mm = d.getMonth() + 1, dd = d.getDate();
    return d.getFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
  }
  function countOn(key) {
    var d = daySwitch();
    if (!d || typeof d.rowsFor !== 'function' || !key) return 0;
    var out = safe(function () { return d.rowsFor(key); }, null);
    return (out && out.length != null) ? out.length : 0;
  }
  function nearbyDays() {
    var here = today();
    if (!here) return '';
    var out = '';
    /* Seven days each way is the whole of "this week and next" without turning
       into a calendar. The FIRST day in each direction that has anybody. */
    for (var dir = 1; dir >= -1; dir -= 2) {
      for (var i = 1; i <= 7; i++) {
        var k = shiftKey(here, dir * i);
        var n = countOn(k);
        if (!n) continue;
        var lab = fmtDayLabel(k);
        var when = (i === 1 && dir === 1) ? 'Tomorrow' : (i === 1 && dir === -1) ? 'Yesterday' : lab.main;
        out += '<button type="button" class="ph3-secondary" data-act="day-go" data-id="' + esc(k) + '" style="margin:0 0 9px">' +
          esc(when + ' · ' + n + ' patient' + (n === 1 ? '' : 's') + ' · ' + lab.sub) +
          ' <span aria-hidden="true">' + (dir === 1 ? '&#8250;' : '&#8249;') + '</span></button>';
        break;
      }
    }
    return out;
  }

  function dayScreen() {
    var h = dayStrip();
    /* The briefs are NOT here any more -- they are their own screen, reached
       from the ☰ menu and the unread pill. The day screen is the patient list;
       on a busy morning several open briefs pushed that list below the fold. */
    var r = patientRows();
    var d = fmtDayLabel(today());

    if (r.total) {
      /* Five is where a one-handed scroll between rooms starts costing more
         than the box does. Once it is on screen it stays while a query is
         typed, otherwise clearing the last character would delete the box. */
      if (r.total >= 5 || String(S.q || '')) {
        h += '<input id="mlsPh3Find" class="ph3-find" type="search" inputmode="search" autocomplete="off" ' +
          'placeholder="Find a patient" value="' + esc(S.q) + '" aria-label="Find a patient">';
      }
      /* "5 patients today · 2 seen" answers the question a doctor between rooms
         actually has -- how many are left -- without making them count rows. */
      h += '<p class="ph3-sect">' + r.total + ' patient' + (r.total === 1 ? '' : 's') +
        (d.isToday ? ' today' : ' on ' + esc(d.main)) +
        (r.shown !== r.total ? ' &middot; ' + r.shown + ' shown' : (r.seen ? ' &middot; ' + r.seen + ' seen' : '')) + '</p>';
      if (r.shown) h += r.html;
      else h += '<div class="ph3-card"><p class="ph3-p">No name here matches &ldquo;' + esc(S.q) + '&rdquo;.</p>' +
        '<button type="button" class="ph3-secondary" data-act="find-clear" style="margin-top:11px">Clear the search</button></div>';
    } else {
      /* ONE empty state, not two. ph2 printed "No patients loaded for today
         yet" and "Nothing scheduled here yet" one under the other -- two
         different claims about the same fact, stacked. */
      /* "There are no patients today but there are some tomorrow" is a real
         morning. The month is already loaded on this device, so the answer is
         one array scan away -- and an empty screen that does not mention the
         seven people on the next day is an empty screen the doctor has to go
         hunting behind. */
      h += '<p class="ph3-sect">' + (d.isToday ? 'Today' : esc(d.main)) + '</p>';
      h += nearbyDays();
      h += '<div class="ph3-card"><p class="ph3-h">Nobody on this day yet</p>' +
        '<p class="ph3-p">' + esc(relaying()
          ? 'Get the schedule from athenaOne with the button below. Your office computer does the reading and the list appears here.'
          : 'Get the schedule from athenaOne with the button below.') + '</p>' +
        /* ph2 said "you can still record a walk-in from the Visit tab" and then
           showed a card telling you to go back to Today. There is no unbound
           recording path in the engine's remote whitelist at all, so the honest
           sentence is the one that names where it can be done. */
        '<p class="ph3-p" style="margin-top:9px">A walk-in who is not on the schedule has to be started on the office computer — this ' +
        esc(deviceNoun()) + ' can only record someone who has an appointment.</p></div>';
    }
    return h;
  }

  /* ===========================================================================
   * SCREEN: VISIT -- one patient, pushed on top of the day, with a Back button.
   * =========================================================================*/

  /* The appointment row the engine has locked, in its RAW form, so the portal
     id is reachable. snapshot.active carries name/dob/time only. */
  function activeAppt() {
    var sn = snap();
    var id = safe(function () { return String(sn && sn.active && sn.active.id || ''); }, '');
    if (!id) return null;
    var ap = safe(function () { return window._calAppts || []; }, []) || [];
    for (var i = 0; i < ap.length; i++) if (ap[i] && String(rowId(ap[i])) === id) return ap[i];
    return null;
  }
  function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(); }

  /* THE IDENTITY GATE. ph2 printed the patient's name from snapshot.active and
     then printed allergies, medications and problems from window.activePatient()
     directly underneath, with NO assertion that the two were the same person.
     If the host's active-patient state lags or fails to re-bind, that renders
     one patient's drug list under another patient's name -- this repo's own
     cross-patient class, on the surface a doctor reads before walking in.
     The chart is shown ONLY when it can be tied to this appointment: by portal
     id, or failing that by name AND date of birth together. */
  function chartForVisit(sn) {
    var p = activeChart();
    if (!p) return { chart: null, why: 'no-chart' };
    var appt = activeAppt();
    var ext = String((appt && appt.patient_external_id) || '').trim();
    if (ext && String(p.id || '') === ext) return { chart: p, why: '' };
    var an = norm(sn && sn.active && sn.active.name), pn = norm(p.name);
    var ad = String((sn && sn.active && sn.active.dob) || '').slice(0, 10);
    var pd = String(p.dob || '').slice(0, 10);
    /* NAME AND DATE OF BIRTH, both, or nothing. A name on its own is not an
       identity in this product -- the repo has a standing rule against matching
       an EMR record by name equality, and a clinic with two Maria Garcias is
       the ordinary case, not the edge one. An earlier draft released the chart
       on a name match when NEITHER side had a date of birth, which is the
       weakest possible evidence dressed as a match. */
    if (an && an === pn && ad && ad === pd) return { chart: p, why: '' };
    return { chart: null, why: 'mismatch' };
  }

  function quickHistory(sn) {
    var got = chartForVisit(sn);
    var name = String((sn && sn.active && sn.active.name) || 'this patient');
    if (!got.chart) {
      var msg = got.why === 'mismatch'
        ? 'This ' + deviceNoun() + ' cannot confirm the chart it has open belongs to ' + name + ', so their history is not shown here. Open them from the day list again.'
        : 'No chart record is open for ' + name + ' on this ' + deviceNoun() + ' yet.';
      return '<p class="ph3-sect">Quick history</p><div class="ph3-card"><p class="ph3-p">' + esc(msg) + '</p></div>';
    }
    var p = got.chart;
    var landed = chartLanded(p);
    var notes = chartNotes(p.id);
    var facts = [];
    var age = ageFrom(p.dob); if (age) facts.push(age);
    if (p.sex) facts.push(String(p.sex));
    if (p.dob) facts.push('DOB ' + usDate(p.dob));
    if (p.mrn) facts.push('MRN ' + String(p.mrn));

    /* The absences ARE the feature. "No allergies recorded" and "we have never
       read this chart from athenaOne" render as the same empty field and are
       opposite claims. Three distinct states, in words. */
    function field(label, v) {
      var lines = chartLines(v);
      if (lines.length) {
        var head = lines.slice(0, 3).join(', ');
        if (lines.length > 3) head += ' +' + (lines.length - 3) + ' more';
        return '<dt class="ph3-dt">' + label + '</dt><dd class="ph3-dd">' + esc(head) + '</dd>';
      }
      var none = landed ? 'none recorded' : 'never read from athenaOne';
      return '<dt class="ph3-dt">' + label + '</dt><dd class="ph3-dd ph3-none">' + none + '</dd>';
    }

    /* The NEWEST note, found by comparing, not by trusting the array's order.
       patientNotes() returns the store's order, which is insertion order after
       any merge -- so notes[0] is an arbitrary visit, and "last seen" printed
       from it is a date the doctor will act on. */
    var last = '', lastPain = '';
    var newest = '';
    for (var ni = 0; ni < notes.length; ni++) {
      var d0 = safe(function () { return String(notes[ni].date || notes[ni].createdAt || '').slice(0, 10); }, '');
      if (/^\d{4}-\d{2}-\d{2}$/.test(d0) && d0 > newest) {
        newest = d0;
        var pn0 = safe(function () {
          var o = notes[ni];
          var v = (o && o.outcome && o.outcome.pain != null) ? o.outcome.pain : (o && o.pain != null ? o.pain : null);
          return (v == null || v === '') ? '' : String(v);
        }, '');
        if (pn0) lastPain = pn0;
      }
    }
    if (newest) last = 'last seen ' + usDate(newest);

    var h = '<p class="ph3-sect">Quick history</p><div class="ph3-card">';
    if (facts.length) h += '<p class="ph3-facts">' + esc(facts.join(' · ')) + '</p>';
    h += '<dl class="ph3-dl">';
    h += '<dt class="ph3-dt">Visits</dt><dd class="ph3-dd">' + notes.length + (last ? ' &middot; ' + esc(last) : '') + '</dd>';
    if (lastPain) h += '<dt class="ph3-dt">Last pain</dt><dd class="ph3-dd">' + esc(lastPain) + '/10</dd>';
    h += field('Allergies', p.allergies);
    h += field('Medications', p.medications || p.meds);
    h += field('Problems', p.problems);
    h += '</dl>';
    if (!landed) {
      h += '<p class="ph3-detail">athenaOne’s chart for this patient has never been read onto this account, so the three fields above are what MLS itself holds.</p>';
    }
    h += '<p class="ph3-detail">The full chart — every note, the profile and the op-note room — is on the office computer.</p>';
    h += '</div>';
    return h;
  }

  function visitScreen() {
    var sn = snap();
    if (!sn || !sn.active) {
      /* Reachable only if the engine drops the lock while this screen is up
         (a day change, a sign-out, a context guard). Say what happened and put
         the way back where the thumb already is. */
      return '<div class="ph3-card"><p class="ph3-h">No patient is open</p>' +
        '<p class="ph3-p">MLS is not holding a visit on this ' + esc(deviceNoun()) + ' any more. Go back and choose a name.</p></div>';
    }
    var phase = String(sn.phase || 'idle');
    var a = sn.active;
    var bits = [];
    if (a.time) bits.push(String(a.time));
    if (a.dob) bits.push('DOB ' + usDate(a.dob));
    var age = ageFrom(a.dob); if (age) bits.push(age);

    var h = '<div class="ph3-card"><p class="ph3-h" style="font-size:19px">' + esc(String(a.name || 'Patient')) + '</p>' +
      '<p class="ph3-p">' + esc(bits.join(' · ')) + '</p></div>';

    /* The engine's own refusal sentence, whenever it has one. This is the only
       explanation a control that just refused ever gives. */
    if (sn.warn) h += '<div class="ph3-card" style="border-color:#E9CFCF;background:#FDF1F1"><p class="ph3-p" style="color:#5B1A18">' + esc(String(sn.warn)) + '</p></div>';

    var appt = activeAppt();
    h += ckForPatient(appt && appt.patient_external_id);
    h += quickHistory(sn);

    h += '<p class="ph3-sect">What was said</p>';
    h += '<textarea id="mlsPh3Tx" class="ph3-ta" placeholder="This fills in as you speak. You can also type it." ' +
      'aria-label="Visit transcript">' + esc(transcriptText()) + '</textarea>';
    if (phase === 'rec') {
      h += '<p class="ph3-p" style="margin:7px 2px 0">Corrections you type here are kept — MLS keeps adding what it hears to the end.</p>';
    }

    if (phase === 'gen' || phase === 'note' || sn.noteLen) {
      h += '<p class="ph3-sect">The note</p>';
      h += '<textarea id="mlsPh3Note2" class="ph3-ta" readonly aria-label="Generated note">' + esc(noteText()) + '</textarea>';
      /* Copy is in the ACTION BAR during the note phase, where a thumb reaches
         it without scrolling past a long note. It is repeated here only when
         the phase has settled away from 'note' with a note still on screen --
         otherwise the only Copy would be one the doctor has to scroll to. */
      if (phase !== 'note') {
        h += '<button type="button" class="ph3-secondary" data-act="copy-note" style="margin-top:9px">Copy the note</button>';
      }
      h += '<p class="ph3-p" style="margin:7px 2px 0">Read it before it goes anywhere. Signing and sending to athenaOne happen on the office computer.</p>';
    }
    return h;
  }

  /* ===========================================================================
   * THE ACTION BAR -- one button, named for what it will do, in the one place a
   * thumb reaches without re-gripping. It never scrolls.
   * =========================================================================*/
  function mmss(n) {
    var s = Math.max(0, Number(n) || 0);
    var m = Math.floor(s / 60), r = s % 60;
    return m + ':' + (r < 10 ? '0' : '') + r;
  }
  function btn(act, label, kind, extra) {
    var cls = kind === 'secondary' ? 'ph3-secondary' : ('ph3-primary' + (kind === 'stop' ? ' ph3-stop' : ''));
    if (extra === 'narrow') cls += ' ph3-narrow';
    return '<button type="button" class="' + cls + '" data-act="' + act + '"' +
      (kind === 'off' ? ' disabled' : '') + ' id="mlsPh3Go">' + label + '</button>';
  }
  function actionBar() {
    if (S.screen === 'visit') return visitAction();
    if (S.screen === 'checkins') return checkinsAction();
    return dayAction();
  }
  /* The check-ins screen has ONE action worth a bar, and only sometimes: the
     open brief belongs to somebody on this day's schedule, and the next thing
     the doctor does is walk in and record them. When no brief is open, or the
     patient is not on this day, there is no action -- and the bar is not drawn
     at all rather than drawn empty or disabled. */
  function checkinsAction() {
    if (!S.ckOpen) return '';
    var r = ckRows(), open = null;
    for (var i = 0; i < r.length; i++) if (String(r[i].id) === S.ckOpen) { open = r[i]; break; }
    if (!open || open.inProgress) return '';
    var row = ckRowFor(open);
    if (!row) return '';
    var name = rowName(row);
    var first = name.split(/\s+/)[0] || name;
    /* Built inline rather than through btn(), because this one carries the
       appointment id the delegated 'open' handler binds the visit to. */
    return '<p class="ph3-sub">' + esc(name) + ' is on today’s list.</p>' +
      '<div class="ph3-row"><button type="button" class="ph3-primary" id="mlsPh3Go" data-act="open" data-id="' +
      esc(rowId(row)) + '">Open ' + esc(first) + '’s visit</button></div>';
  }
  function dayAction() {
    var busy = pulling();
    var n = rows().length;
    var d = fmtDayLabel(today());
    var sentence = pullSentence();
    var sub = '', row = '';

    if (busy) {
      sub = sentence || (relaying()
        ? 'Your office computer is reading athenaOne. You can leave this screen — it keeps going.'
        : 'Reading athenaOne now. You can leave this screen — it keeps going.');
      row = '<button type="button" class="ph3-primary" disabled id="mlsPh3Go">Getting your patients&hellip;</button>' +
        '<button type="button" class="ph3-secondary ph3-narrow" data-act="pull-stop">Stop</button>';
    } else {
      /* BOTH, never one instead of the other. The blocker is ours and it is
         what to do about it; the sentence is the ENGINE'S and it is what
         actually happened last time. Dropping the engine's words the moment we
         have an opinion is how a plain-language headline ends up replacing the
         truth -- the failure this product already knows by name. */
      var block = relayBlock();
      sub = block ? (sentence ? block + ' — ' + sentence : block) : sentence;
      if (n > 0) {
        /* Owner, 2026-08-10: "what does that check athena one again button do,
           get rid of that unless it really works." It really works — it is the
           SAME __mlsDaySwitch.pullDay() the primary button runs, verified live
           (pressing it started a relay job and the bar showed the engine's own
           "Asking <office computer> to pull <date>…"). What was wrong was the
           NAME: "check again" sounds like a cheap lookup, when it is the full
           athenaOne pull, done for you on the office computer. Named for what
           it does now, and the sub-line above says where it runs. */
        row = btn('pull-start', '&#8635; Pull ' + (d.isToday ? 'today' : esc(d.main)) + ' from athenaOne again', 'secondary');
      } else {
        row = btn('pull-start', '&#128229; Get ' + (d.isToday ? 'today&rsquo;s' : 'that day&rsquo;s') + ' patients', 'primary');
      }
    }
    return (sub ? '<p class="ph3-sub">' + esc(sub) + '</p>' : '') + '<div class="ph3-row">' + row + '</div>';
  }
  function visitAction() {
    var sn = snap();
    if (!sn || !sn.active) {
      return '<div class="ph3-row">' + btn('back', '&#8249; Back to the day', 'primary') + '</div>';
    }
    var phase = String(sn.phase || 'idle');
    var sub = '', row = '';
    if (phase === 'rec') {
      sub = 'Recording <span id="mlsPh3Timer">' + mmss(sn.recSecs) + '</span>';
      row = btn('stop', '<span class="ph3-rec"></span> Stop recording', 'stop');
    } else if (phase === 'stopped') {
      sub = 'Recording stopped. Nothing is written until you ask for the note.';
      row = btn('generate', '&#10024; Write the note', 'primary') +
        btn('record', '&#127908; Resume', 'secondary', 'narrow');
    } else if (phase === 'gen') {
      sub = 'MLS is writing the note.';
      row = '<button type="button" class="ph3-primary" disabled id="mlsPh3Go">Writing the note&hellip;</button>';
    } else if (phase === 'note') {
      sub = sn.signed ? 'Signed. Sending to athenaOne happens on the office computer.' : 'Read it before it goes anywhere.';
      row = btn('send', 'Send for review', 'primary') +
        btn('copy-note', 'Copy', 'secondary', 'narrow');
    } else {
      sub = 'MLS listens and writes the note. Stop whenever you like.';
      row = btn('record', '<span style="font-size:13px">&#9679;</span> Start recording', 'primary');
    }
    return (sub ? '<p class="ph3-sub">' + sub + '</p>' : '') + '<div class="ph3-row">' + row + '</div>';
  }

  /* ===========================================================================
   * NAVIGATION
   * =========================================================================*/
  function goDay() {
    S.screen = 'day';
    clearConfirm();
    closeMenu();
    S.lastSig = '';
    render(true);
    scrollTop();
  }
  function goVisit() {
    S.screen = 'visit';
    closeMenu();
    clearSay();
    S.lastSig = '';
    /* The desktop view underneath is switched too, so that when the doctor
       leaves phone mode -- or a modal opens over this frame -- the app behind
       is already on the same patient. */
    safe(function () { if (typeof window.showView === 'function') window.showView('visit'); });
    render(true);
    scrollTop();
  }
  function goCheckins() {
    S.screen = 'checkins';
    clearConfirm();
    closeMenu();
    S.lastSig = '';
    render(true);
    scrollTop();
    /* Arriving IS reading the list. The pill counts unread briefs, and leaving
       it lit over a screen that is showing them is the badge-that-never-clears
       defect in a new place. The individual cards still open one at a time. */
    var r = ckRows();
    for (var i = 0; i < r.length; i++) if (r[i] && !r[i].inProgress) S.ckRead[String(r[i].id)] = 1;
    S.ckPing = 0;
    paintHeader();
  }
  api.go = function (where) {
    if (where === 'visit') goVisit();
    else if (where === 'checkins') goCheckins();
    else goDay();
  };

  /* ===========================================================================
   * ONE DELEGATED CLICK HANDLER
   * Every control in every screen carries data-act, so a repaint can never
   * leave a listener bound to a node that is no longer on the screen.
   * =========================================================================*/
  function onClick(ev) {
    var t = ev.target;
    var el = null;
    while (t && t !== frameEl) {
      if (t.getAttribute && t.getAttribute('data-act')) { el = t; break; }
      t = t.parentNode;
    }
    if (!el) return;
    var act = el.getAttribute('data-act');
    var id = el.getAttribute('data-id') || '';

    if (act === 'menu-close') { closeMenu(); return; }
    if (act === 'note-x') { clearSay(); return; }
    if (act === 'back') { goDay(); return; }
    if (act === 'checkins') { goCheckins(); return; }
    if (act === 'find-clear') { S.q = ''; S.lastSig = ''; render(true); return; }

    /* ---- the menu ------------------------------------------------------- */
    if (act === 'refresh') {
      closeMenu();
      var cal = hostFn('loadCalendar');
      var pts = hostFn('loadPatientsFromServer');
      if (!cal && !pts) { refuse('MLS has not finished loading on this ' + deviceNoun() + ' yet.'); return; }
      /* ⛔ REFRESH USED TO FIRE AND FORGET. Owner, 2026-08-10: "make the refresh
         work." Both of these are ASYNC and the old code neither awaited them nor
         repainted afterwards, so the toast said "Refreshing…" and the screen sat
         there showing the same list until something unrelated triggered a
         render. The work was happening; the screen never admitted it. Now it
         waits for both, repaints, and SAYS WHAT IT FOUND — including when it
         found nothing, because "refreshed" over an unchanged list is the same
         silence in a different colour. */
      var before = rows().length;
      say('Refreshing from MLS…', 'warn');
      var jobs = [];
      if (cal) jobs.push(safe(function () { return Promise.resolve(cal({ fresh: true })); }, null));
      if (pts) jobs.push(safe(function () { return Promise.resolve(pts({})); }, null));
      refreshPresence(true);
      ckFetch();
      safe(function () {
        Promise.all(jobs.map(function (p) { return (p && p.then) ? p['catch'](function () { return null; }) : null; }))
          .then(function () {
            S.lastSig = '';
            render(true);
            var after = rows().length;
            var d = fmtDayLabel(today());
            var where = d.isToday ? 'today' : d.main;
            if (after > before) say(after + ' patient' + (after === 1 ? '' : 's') + ' for ' + where + ' — ' + (after - before) + ' new since you last looked.', 'warn');
            else if (after) say('Up to date — ' + after + ' patient' + (after === 1 ? '' : 's') + ' for ' + where + '.', 'warn');
            else say('MLS has nobody for ' + where + '. If athenaOne has patients, use the button below to pull them.', 'warn');
          });
      });
      return;
    }
    if (act === 'settings' || act === 'device') {
      closeMenu();
      var open = hostFn('openSettings');
      if (!open) { refuse('Settings has not finished loading on this ' + deviceNoun() + ' yet.'); return; }
      safe(function () { open(); });
      if (act === 'device') {
        /* The settings modal is the app's own surface; this only says where to
           look inside it, because a phone cannot see the section rail at once. */
        toast('Settings → Integrations → This device', '');
      }
      return;
    }
    if (act === 'install') {
      closeMenu();
      var p = S.a2hs;
      if (p) { S.a2hs = null; safe(function () { p.prompt(); }); S.lastSig = ''; render(true); return; }
      /* Not a refusal: on iOS this IS the route, and the sentence is the whole
         feature. Said as a sticky note so it is still there after the doctor
         has gone looking for the Share button. */
      say('Tap the Share button at the bottom of Safari, then "Add to Home Screen". MLS then opens like an app, with no browser bars.', 'warn');
      return;
    }
    if (act === 'fullapp') {
      closeMenu();
      var dr2 = deviceRole();
      if (dr2 && typeof dr2.setLayoutPref === 'function') {
        /* A DURABLE preference, not a session flag: a doctor who chooses the
           full app must still have it after the browser is closed, and the way
           back is the same control in Settings. */
        safe(function () { dr2.setLayoutPref('full'); });
        toast('Opening the full app. Settings → Integrations → This device brings this one back.', '');
        safe(function () { setTimeout(function () { location.reload(); }, 700); });
        return;
      }
      refuse('The layout control has not finished loading on this ' + deviceNoun() + ' yet.');
      return;
    }
    if (act === 'signout') {
      closeMenu();
      var out = hostFn('logout');
      if (!out) { refuse('Sign-out has not finished loading on this ' + deviceNoun() + ' yet.'); return; }
      /* NO ARGUMENT. logout(true) is the idle-timeout path and SKIPS the "N
         notes on this device have not been backed up" stop -- and signing out
         purges the local clinical state those notes live in. */
      safe(function () { out(); });
      watchForSignOut();
      return;
    }

    /* ---- the day -------------------------------------------------------- */
    if (act === 'day-prev' || act === 'day-next') {
      var ds = daySwitch();
      if (!ds || typeof ds.shiftDay !== 'function') { refuse('The schedule engine has not finished loading yet.'); return; }
      if (pulling()) { refuse('A pull is running. The day cannot change until it finishes.'); return; }
      S.q = '';
      safe(function () { ds.shiftDay(act === 'day-prev' ? -1 : 1); });
      S.lastSig = ''; render(true); scrollTop();
      return;
    }
    if (act === 'day-go') {
      var dsg = daySwitch();
      if (!dsg || typeof dsg.setDay !== 'function' || !id) { refuse('The schedule engine has not finished loading yet.'); return; }
      if (pulling()) { refuse('A pull is running. The day cannot change until it finishes.'); return; }
      S.q = '';
      safe(function () { dsg.setDay(id); });
      S.lastSig = ''; render(true); scrollTop();
      return;
    }
    if (act === 'day-today') {
      var ds0 = daySwitch(), tk0 = todayKey();
      if (!ds0 || typeof ds0.setDay !== 'function' || !tk0) { refuse('The schedule engine has not finished loading yet.'); return; }
      if (pulling()) { refuse('A pull is running. The day cannot change until it finishes.'); return; }
      S.q = '';
      safe(function () { ds0.setDay(tk0); });
      S.lastSig = ''; render(true); scrollTop();
      return;
    }
    if (act === 'pull-start') {
      var d2 = daySwitch();
      if (!d2 || typeof d2.pullDay !== 'function') { refuse('The athenaOne pull engine has not finished loading yet.'); return; }
      /* A double tap must not start two. pulling() cannot see the second press
         until the engine has disabled its own button, so the button is disabled
         here, in this tick, before anything else happens. */
      if (pulling()) return;
      safe(function () { el.disabled = true; });
      clearSay();
      safe(function () { d2.pullDay(); });
      S.lastSig = ''; render(true);
      return;
    }
    if (act === 'pull-stop') {
      /* Stop what is ACTUALLY running. A device with MLS Assist pulls locally,
         and cancelling a relay job it does not have would report "stopped" over
         a pull still going. */
      var job = activeRelayJob();
      var rl2 = relay();
      if (job && rl2 && typeof rl2.cancelActive === 'function') {
        safe(function () { rl2.cancelActive(); });
        /* "Stopped waiting", not "stopped the pull". Cancelling the job record
           stops THIS phone waiting; the office computer may already be reading
           athenaOne and will finish. Saying "stopped" would be a claim about
           another machine this one cannot see. */
        toast('Stopped waiting. If your office computer already started, it will finish there.', '');
        S.lastSig = ''; render(true);
        return;
      }
      if (relaying()) {
        /* Relayed, but no job record to cancel -- the sessionStorage entry is
           gone, expired past twelve minutes, or was never written. The old code
           reported this as a LOCAL pull, which is a confident sentence about the
           wrong machine. */
        say('This ' + deviceNoun() + ' cannot find the job to stop. If your office computer already started, it will finish there and the patients will appear.', 'warn');
        return;
      }
      refuse('This pull is running on this ' + deviceNoun() + ' and has to finish. It will stop on its own.');
      return;
    }
    if (act === 'open') {
      var r = remote();
      if (!r || typeof r.startVisitFor !== 'function') { refuse('The visit engine has not finished loading yet.'); return; }
      /* record:false ALWAYS. Opening a patient and starting a microphone are
         two different decisions and the doctor makes the second one. */
      var ok = safe(function () { return r.startVisitFor(id, { record: false }); }, false);
      if (!ok) { refuse('MLS could not open that patient. Their appointment may be on another day — check the date above the list.'); return; }
      goVisit();
      return;
    }

    /* ---- check-ins ------------------------------------------------------ */
    if (act === 'ck-open') {
      S.ckOpen = (S.ckOpen === id) ? '' : id;
      if (S.ckOpen) S.ckRead[id] = 1;
      S.ckPing = 0;
      S.lastSig = ''; render(true);
      return;
    }

    /* ---- the visit ------------------------------------------------------ */
    if (act === 'record') {
      var r2 = remote();
      if (!r2 || typeof r2.record !== 'function') { refuse('The visit engine has not finished loading yet.'); return; }
      clearSay();
      var started = safe(function () { return r2.record(); }, false);
      if (started) {
        expectPhase(['rec'], 1500,
          'MLS did not start recording. The most common reason is that this ' + deviceNoun() +
          ' has not given the browser permission to use the microphone — check the site settings and try again.');
      }
      if (!started) {
        /* The engine's own sentence lands in snapshot.warn when it has one --
           but a denied microphone is refused WITHOUT setting warn, and pointing
           at "the message on this screen" when there is no message is the
           instruction-points-nowhere defect. Say the concrete thing instead. */
        var sn0 = snap();
        refuse(warnAsRefusal(sn0) ||
          ('Recording did not start. The most common reason is that this ' + deviceNoun() +
            ' has not been given permission to use the microphone — check the browser’s site settings.'));
      }
      S.lastSig = ''; render(true);
      return;
    }
    if (act === 'stop') {
      var r3 = remote();
      if (!r3 || typeof r3.stopRecording !== 'function') { refuse('The visit engine has not finished loading yet.'); return; }
      var stopped = safe(function () { return r3.stopRecording(); }, false);
      /* A false here means the engine did not believe it was recording. Saying
         nothing leaves a Stop button over a screen that still says Recording. */
      if (stopped) expectPhase(['stopped', 'gen', 'note'], 1500, 'MLS is still recording. Try Stop once more.');
      else refuse('MLS did not stop the recording. It may already have stopped on its own — check the line above.');
      S.lastSig = ''; render(true);
      return;
    }
    if (act === 'generate') {
      var r4 = remote();
      if (!r4 || typeof r4.generate !== 'function') { refuse('The visit engine has not finished loading yet.'); return; }
      clearSay();
      var g = safe(function () { return r4.generate(); }, false);
      if (g) expectPhase(['gen', 'note'], 1500, 'MLS did not start writing the note. Check the patient above is the right one, then try again.');
      if (!g) {
        var sn1 = snap();
        refuse(warnAsRefusal(sn1) || 'MLS could not start writing the note. Make sure the patient above is the right one and there is something in the transcript.');
      }
      S.lastSig = ''; render(true);
      return;
    }
    if (act === 'send') {
      var r5 = remote();
      if (!r5 || typeof r5.requestSendReview !== 'function') { refuse('The visit engine has not finished loading yet.'); return; }
      if (!noteText().trim()) { refuse('There is no note to send yet.'); return; }
      var s = safe(function () { return r5.requestSendReview(); }, false);
      /* TRUE means "the send path was entered", nothing more. What happens next
         is one of three things and the phone cannot tell them apart from the
         return value: a confirm card opens ON THIS SCREEN (the app's modals sit
         at z-index 9000+, above this frame, which is exactly why this module
         stops at 7000); a name/DOB mismatch stops it with its own explanation;
         or a write blocker refuses. So the sentence says where to LOOK, and
         claims nothing about the outcome. An earlier draft of this line said
         the confirmation was "waiting on your office computer" -- a confident
         sentence about a machine this one cannot see, and wrong: the card is
         right here. */
      if (s) say('Look for the send confirmation on this screen — nothing goes to athenaOne until it is cleared.', 'warn');
      else refuse('MLS could not start the send. There may be no note yet, or the patient may need opening again.');
      return;
    }
    if (act === 'copy-note') {
      var text = noteText();
      if (!text.trim()) { refuse('There is no note to copy yet.'); return; }
      /* writeText returns a PROMISE. Announcing success on the same tick means
         a refused write is reported as a success and the doctor pastes the
         PREVIOUS clipboard into a chart. */
      copyText(text, function (ok) {
        if (ok) toast('The note is on this ' + deviceNoun() + '’s clipboard.', 'ok');
        else refuse('This browser refused to copy. Press and hold inside the note to select and copy it.');
      });
      return;
    }
  }

  /* ===========================================================================
   * INPUT: the find box, and the transcript
   * =========================================================================*/
  function onInput(ev) {
    var t = ev.target;
    if (!t || !t.id) return;
    if (t.id === 'mlsPh3Find') {
      S.q = String(t.value || '');
      paintList();
      return;
    }
    if (t.id === 'mlsPh3Tx') {
      pushTranscript(String(t.value || ''));
      return;
    }
  }

  /* Repaint ONLY the list, so a keystroke in the find box never rewrites the
     box the caret is sitting in. */
  function paintList() {
    if (S.screen !== 'day') return;
    var holder = bodyEl && bodyEl.querySelector('.ph3-rows');
    var r = patientRows();
    if (holder && r.html) {
      var tmp = document.createElement('div');
      tmp.innerHTML = r.html;
      holder.parentNode.replaceChild(tmp.firstChild, holder);
      return;
    }
    /* Falling from "some matches" to "none" (or back) changes the SHAPE of the
       screen, so the whole body is rebuilt -- and the caret is put back. */
    var find = $('mlsPh3Find');
    var pos = find && find.selectionStart != null ? find.selectionStart : null;
    S.lastSig = '';
    render(true);
    var again = $('mlsPh3Find');
    if (again && again.focus) {
      safe(function () { again.focus(); if (pos != null && again.setSelectionRange) again.setSelectionRange(pos, pos); });
    }
  }

  /* ---------------------------------------------------------------------------
   * THE TRANSCRIPT, AND WHY THIS IS A MERGE
   * ph2 wrote the phone textarea's ENTIRE value over #transcript on every
   * keystroke, while a caret guard stopped the engine's live appends from ever
   * reaching the phone. So the moment a finger touched the box the phone's copy
   * froze, and the next keystroke overwrote whatever the recognizer had added
   * in the meantime -- the doctor's words, silently deleted, in the middle of a
   * recording. Here the engine only ever APPENDS while recording, so the two
   * copies can be reconciled: the engine's new tail is appended to whatever the
   * doctor has typed, the caret is left where it was, and the merged value goes
   * back to the engine. Nothing is thrown away in either direction.
   * -------------------------------------------------------------------------*/
  function pushTranscript(value) {
    var real = transcriptEl();
    if (!real) return;
    if (real.value === value) { S.txMirror = value; return; }
    real.value = value;
    S.txMirror = value;
    safe(function () { real.dispatchEvent(new Event('input', { bubbles: true })); });
  }
  function syncTranscript() {
    var ours = $('mlsPh3Tx');
    var real = transcriptEl();
    if (!ours || !real) return;
    var engine = String(real.value || '');
    var mine = String(ours.value || '');
    if (engine === mine) { S.txMirror = engine; return; }
    var focused = safe(function () { return document.activeElement === ours; }, false);
    if (!focused) { ours.value = engine; S.txMirror = engine; return; }
    /* Focused: keep the doctor's text, take the engine's new tail. */
    var tail = '';
    if (S.txMirror && engine.length > S.txMirror.length && engine.indexOf(S.txMirror) === 0) tail = engine.slice(S.txMirror.length);
    else if (!S.txMirror && engine) tail = engine;
    if (!tail) { S.txMirror = engine; return; }
    var a = ours.selectionStart, b = ours.selectionEnd;
    var merged = mine + tail;
    ours.value = merged;
    safe(function () { if (a != null && ours.setSelectionRange) ours.setSelectionRange(a, b); });
    pushTranscript(merged);
  }

  /* ===========================================================================
   * RENDER
   * ---------------------------------------------------------------------------
   * The signature deliberately EXCLUDES the recording seconds. ph2 put recSecs
   * in it, so during a recording the whole visit body was rebuilt once a
   * second; replacing every child of a scroller resets scrollTop, and a doctor
   * reading the quick history mid-visit was thrown back to the patient card
   * every second. The clock is a text write into one node instead.
   * =========================================================================*/
  function signature() {
    var sn = snap();
    var ck = ckRows();
    var ckSig = ck.length + '|' + S.ckOpen + '|' + ckUnread();
    return [
      S.screen, today(), rows().length, pulling() ? 1 : 0, pullSentence(), S.q,
      sn ? sn.phase : '', sn ? (sn.active ? sn.active.id : '') : '',
      sn ? sn.warn : '', sn ? sn.noteLen : 0, sn ? (sn.signed ? 1 : 0) : 0,
      ckSig, S.ckErr, api._presence ? 1 : 0, api._presenceErr, installKind()
    ].join('~');
  }

  function paintHeader() {
    var t = $('mlsPh3Title'), s = $('mlsPh3Sub'), nav = $('mlsPh3Nav'), alert = $('mlsPh3Alert');
    var sn = snap();
    if (S.screen === 'visit' || S.screen === 'checkins') {
      if (S.screen === 'checkins') {
        var cn = ckRows().length;
        if (t) t.textContent = 'Check-ins';
        if (s) s.textContent = cn ? (cn + ' before the room') : 'Before the room';
      } else {
        var nm = safe(function () { return String(sn && sn.active && sn.active.name || ''); }, '');
        if (t) t.textContent = nm || 'Visit';
        if (s) s.textContent = safe(function () { return String(sn && sn.active && sn.active.time || ''); }, '') || 'One patient at a time';
      }
      if (nav) {
        nav.innerHTML = '<span class="ph3-gl">&#8249;</span><span>Day</span>';
        nav.setAttribute('aria-label', 'Back to the day');
        nav.removeAttribute('aria-haspopup');
        nav.removeAttribute('aria-expanded');
      }
    } else {
      var d = fmtDayLabel(today());
      if (t) t.textContent = d.isToday ? 'Today' : d.main;
      if (s) s.textContent = accountLine() || 'Your day';
      if (nav) {
        nav.innerHTML = '<span class="ph3-gl">&#9776;</span>';
        nav.setAttribute('aria-label', 'Menu');
        nav.setAttribute('aria-haspopup', 'dialog');
        nav.setAttribute('aria-expanded', S.menu ? 'true' : 'false');
      }
    }
    /* The unread pill lives in the HEADER, not in the scrolling body. ph2 drew
       an arrival banner inside the body and cleared the flag WHILE BUILDING the
       string, so the very next repaint erased the announcement -- and repaints
       are continuous while anything is live. A header pill survives every body
       repaint and is cleared by being acted on. */
    if (alert) {
      var n = ckUnread();
      if (n > 0) {
        alert.hidden = false;
        alert.innerHTML = '<span aria-hidden="true">&#9679;</span><span>' + n + ' check-in' + (n === 1 ? '' : 's') + '</span>';
        alert.setAttribute('aria-label', n + ' unread patient check-in' + (n === 1 ? '' : 's'));
      } else {
        alert.hidden = true;
        alert.innerHTML = '';
      }
    }
  }

  /* The one-second text writes: the recording clock, and nothing else. */
  function paintTick() {
    var sn = snap();
    if (!sn) return;
    var el = $('mlsPh3Timer');
    if (el && sn.phase === 'rec') el.textContent = mmss(sn.recSecs);
  }

  /* Is the doctor's caret inside one of OUR fields? A repaint replaces every
     child of the scroller, which destroys the element being typed into and
     takes the caret with it. */
  function caretIsOurs() {
    return safe(function () {
      var a = document.activeElement;
      return !!(a && (a.id === 'mlsPh3Tx' || a.id === 'mlsPh3Find'));
    }, false);
  }

  /* Repaints that the DOCTOR did not ask for. A background poll must never
     destroy the field a finger is in: ph2's whole transcript-loss defect came
     from a repaint arriving mid-word. The header still updates, so an unread
     check-in pill appears while typing. */
  function renderBg() {
    if (!S.mounted) return;
    if (caretIsOurs()) { paintHeader(); syncTranscript(); paintTick(); return; }
    S.lastSig = '';
    render(true);
  }

  var rendering = false;
  function render(force) {
    if (!S.mounted || !bodyEl) return;
    /* SIGN-OUT. ensure()'s retry chain is bounded, so it cannot be the only
       thing that notices the account went away -- and a phone shell left over
       the login screen hides the only way back in. This runs on every repaint,
       and repaints are driven by the app's own DOM through the observer, so the
       teardown that produces the login screen is itself the trigger. */
    if (!(owns() && authed())) { unmount(); return; }
    if (rendering) return;
    /* THE GUARD IS ON THE REBUILD, NEVER ON THE MERGE. ph2 guarded the whole
       render on the caret, so while a finger was in the transcript the engine's
       live appends stopped reaching the phone entirely -- and the next keystroke
       wrote the stale phone copy back over them. Here an unforced repaint that
       would destroy the field is skipped, and the transcript is reconciled
       anyway, so nothing the recognizer produced is ever lost. Forced repaints
       come from a control the doctor just pressed, which means they are not
       mid-word. */
    if (!force && caretIsOurs()) { syncTranscript(); paintTick(); return; }
    var sig = signature();
    if (!force && sig === S.lastSig) { syncTranscript(); paintTick(); return; }
    rendering = true;
    try {
      S.lastSig = sig;
      paintHeader();
      /* Preserve the reading position. A repaint the doctor did not ask for
         must not move the page under their eyes. */
      var top = bodyEl.scrollTop;
      bodyEl.innerHTML = S.screen === 'visit' ? visitScreen()
        : S.screen === 'checkins' ? checkinsScreen()
        : dayScreen();
      if (actEl) {
        var bar = actionBar();
        actEl.innerHTML = bar;
        /* A screen with no action gets no bar — not an empty one. An empty
           strip with a border and a shadow reads as a control that failed to
           load, and it costs 60px of an 812px screen for nothing. */
        actEl.hidden = !bar;
      }
      safe(function () { bodyEl.scrollTop = top; });
      syncTranscript();
      paintTick();
    } finally { rendering = false; }
    /* Whatever caused this repaint may also have started or ended the thing
       the ticker exists for. Re-deciding here means no caller has to remember. */
    armTicking();
  }
  api.render = function () { S.lastSig = ''; render(true); };

  /* ===========================================================================
   * TICKER -- setTimeout, not setInterval, and only while something is live.
   * A phone in a pocket runs no timers here at all. Both handles are cleared
   * with `!== null`, because a timer handle of 0 is FALSY and a truthiness test
   * leaves the old timer running forever while a second one is armed.
   * =========================================================================*/
  function live() {
    if (pulling()) return true;
    var sn = snap();
    var p = sn ? String(sn.phase || '') : '';
    return p === 'rec' || p === 'gen';
  }
  function stopTicking() {
    if (S.tick !== null) { clearTimeout(S.tick); S.tick = null; }
  }
  function startTicking() {
    if (S.tick !== null) return;
    if (safe(function () { return document.visibilityState === 'hidden'; }, false)) return;
    S.tick = setTimeout(function tickOnce() {
      S.tick = null;
      if (!S.mounted) return;
      render();
      if (live() && !safe(function () { return document.visibilityState === 'hidden'; }, false)) {
        S.tick = setTimeout(tickOnce, 1000);
      }
    }, 1000);
  }
  function armTicking() { if (live()) startTicking(); else stopTicking(); }

  function stopCheckinWatch() {
    if (S.ckTimer !== null) { safe(function () { clearInterval(S.ckTimer); }); S.ckTimer = null; }
  }
  function startCheckinWatch() {
    if (S.ckTimer !== null) return;
    if (safe(function () { return document.visibilityState === 'hidden'; }, false)) return;
    var h = safe(function () { return setInterval(ckFetch, CK_POLL_MS); }, null);
    S.ckTimer = (h === undefined) ? null : h;
  }

  /* ===========================================================================
   * KEYBOARD
   * ---------------------------------------------------------------------------
   * iOS does not shrink the layout viewport when the keyboard opens, so a frame
   * pinned to inset:0 keeps its action bar and the bottom of its scroller UNDER
   * the keys. The offset travels as a CUSTOM PROPERTY, never an inline style,
   * because the frame's `bottom` is set from that property in the stylesheet.
   *
   * THE FOCUS GATE IS LOAD-BEARING. Under viewport-fit=cover, Safari's own
   * collapsing chrome moves visualViewport by 178-212px with no keyboard on
   * screen at all, so a bare pixel threshold reads a scroll as a keyboard and
   * lifts the whole shell off the bottom of the display. It is only a keyboard
   * if something editable has focus.
   * =========================================================================*/
  function editableFocused() {
    return safe(function () {
      var a = document.activeElement;
      if (!a) return false;
      var tag = String(a.tagName || '').toUpperCase();
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || a.isContentEditable === true;
    }, false);
  }
  function syncKeyboard() {
    if (!S.mounted) return;
    var vv = safe(function () { return window.visualViewport; }, null);
    var px = 0;
    if (vv && editableFocused()) {
      var hidden = (window.innerHeight || 0) - (vv.height + vv.offsetTop);
      if (hidden > 90) px = Math.round(hidden);
    }
    safe(function () { frameEl.style.setProperty('--ph3-kbd', px + 'px'); });
  }

  /* ===========================================================================
   * LIFECYCLE
   * =========================================================================*/
  function onVisibility() {
    if (safe(function () { return document.visibilityState === 'hidden'; }, false)) {
      stopTicking(); stopCheckinWatch(); stopSignOutWatch();
      if (ensureTimer !== null) { clearTimeout(ensureTimer); ensureTimer = null; }
      return;
    }
    /* Back on screen: this is also where a sign-out that happened in another
       tab is noticed, so ensure() runs BEFORE the mounted check. */
    ensure();
    if (!S.mounted) return;
    S.lastSig = '';
    render(true);
    armTicking();
    startCheckinWatch();
    ckFetch();
    refreshPresence(true);
  }

  function onA2HS(ev) {
    safe(function () { ev.preventDefault(); });
    S.a2hs = ev;
    S.lastSig = '';
    render();
  }

  /* Scoped to the Easy shell, never to the document: a document-wide observer
     on a page this size fires on every unrelated repaint the app makes. */
  var obsHost = null;
  function watchEngine() {
    var host = $('mlsEz3Body') || $('appScreen');
    if (!host || typeof MutationObserver !== 'function') return;
    /* RE-SCOPE when the real host arrives. #mlsEz3Body is created by the Easy
       engine a beat after this module mounts, so the first bind often lands on
       #appScreen -- a far larger subtree, which means every unrelated repaint
       the app makes drives a phone repaint. Bound once and never revisited,
       that is permanent for the session. */
    if (S.obs && obsHost === host) return;
    if (S.obs) safe(function () { S.obs.disconnect(); });
    obsHost = host;
    S.obs = new MutationObserver(function () {
      if (!S.mounted) return;
      render();
      armTicking();
    });
    safe(function () { S.obs.observe(host, { childList: true, subtree: true, characterData: true }); });
  }

  var ensureTimer = null, ensureTries = 0, ensureStopped = false;
  function ensure() {
    if (!document.body) return;
    var want = owns() && authed();
    if (want && !S.mounted) {
      mount();
      watchEngine();
      startCheckinWatch();
      ckFetch();
      refreshPresence(true);
      syncKeyboard();
      ensureTries = 0;      /* mounted: the fast search is over */
    } else if (!want && S.mounted) {
      unmount();
      stopTicking();
      stopCheckinWatch();
      stopSignOutWatch();
      ensureTries = 0;      /* signed out: start looking for the next sign-in */
    } else if (want && S.mounted) {
      standDownLegacyPhoneLayer();
      watchEngine();
      render();
      armTicking();
    }
    armEnsure();
  }
  /* A MOUNTED, IDLE, VISIBLE PHONE HOLDS NO TIMERS AT ALL. That is the budget
     and it is not negotiable: a phone spends most of its life in a pocket.
     So the search runs only while the shell is NOT up — the login screen, where
     the app's own chrome is on display and this module has nothing to paint.
     It does not stop after a minute: ph2 ran a bounded 60-tick chain from page
     load, so a doctor whose sign-in took longer than that never got the phone
     app at all. Hidden: nothing, either way.
     Coming the other way — signed IN and then OUT — is NOT this timer's job.
     Three things notice that, none of them a poll: render() checks authed() on
     every repaint and the repaints are driven by the app's own DOM; returning
     to the tab runs ensure(); and pressing Sign out in this app's own menu arms
     a short bounded watch (watchForSignOut) that ends the moment it fires. */
  function armEnsure() {
    if (ensureTimer !== null || ensureStopped) return;
    if (S.mounted) return;
    if (safe(function () { return document.visibilityState === 'hidden'; }, false)) return;
    ensureTimer = setTimeout(function () {
      ensureTimer = null;
      ensureTries++;
      ensure();
    }, 1000);
  }

  /* Sign-out is asynchronous (logout() awaits the unsynced-note stop and a
     server call), so the frame cannot come down on the same tick as the press.
     Bounded: it stops on the first check that finds the account gone, and after
     twenty seconds regardless. */
  var signOutTimer = null, signOutTries = 0;
  function watchForSignOut() {
    if (signOutTimer !== null) return;
    signOutTries = 0;
    (function look() {
      signOutTimer = setTimeout(function () {
        signOutTimer = null;
        signOutTries++;
        if (!S.mounted) return;
        if (!authed()) { ensure(); return; }
        if (signOutTries < 40) look();
      }, 500);
    })();
  }
  function stopSignOutWatch() { if (signOutTimer !== null) { clearTimeout(signOutTimer); signOutTimer = null; } }
  api.ensure = ensure;

  /* Named handlers, so revert() can take back EVERY listener this module added.
     ph2's revert removed two of six and left four firing against a module that
     had declared itself gone. */
  function onFocusOut() { safe(function () { setTimeout(syncKeyboard, 60); }); }
  function onDayChanged() { S.q = ''; S.lastSig = ''; render(true); }

  api.revert = function () {
    ensureStopped = true;
    unmount();
    clearConfirm();
    stopTicking();
    stopCheckinWatch();
    stopSignOutWatch();
    if (ensureTimer !== null) { clearTimeout(ensureTimer); ensureTimer = null; }
    safe(function () { S.obs && S.obs.disconnect(); });
    S.obs = null; obsHost = null;
    safe(function () { document.removeEventListener('visibilitychange', onVisibility); });
    safe(function () { window.removeEventListener('beforeinstallprompt', onA2HS); });
    safe(function () { document.removeEventListener('focusin', syncKeyboard); });
    safe(function () { document.removeEventListener('focusout', onFocusOut); });
    safe(function () { window.removeEventListener('mls:visit-day-changed', onDayChanged); });
    safe(function () {
      var vv = window.visualViewport;
      if (!vv) return;
      vv.removeEventListener('resize', syncKeyboard);
      vv.removeEventListener('scroll', syncKeyboard);
    });
    safe(function () { st.parentNode.removeChild(st); });
    /* installed:false is what hands the screen back: mls-connect's newUiOwns()
       reads it, answers false, and the legacy phone layer resumes on its next
       pass. The object itself STAYS -- revert() is a diagnostic, and callers
       hold this handle to call it. */
    api.installed = false;
    return true;
  };

  /* ===========================================================================
   * BOOT
   * =========================================================================*/
  safe(function () { document.addEventListener('visibilitychange', onVisibility); });
  safe(function () { window.addEventListener('beforeinstallprompt', onA2HS); });
  safe(function () {
    var vv = window.visualViewport;
    if (!vv) return;
    vv.addEventListener('resize', syncKeyboard);
    vv.addEventListener('scroll', syncKeyboard);
  });
  safe(function () { document.addEventListener('focusin', syncKeyboard); });
  safe(function () { document.addEventListener('focusout', onFocusOut); });
  safe(function () { window.addEventListener('mls:visit-day-changed', onDayChanged); });

  if (document.readyState === 'loading') {
    safe(function () { document.addEventListener('DOMContentLoaded', ensure); });
  }
  ensure();
})();
