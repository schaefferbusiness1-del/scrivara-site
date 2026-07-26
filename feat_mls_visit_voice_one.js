/* =============================================================================
 * feat_mls_visit_voice_one.js — vo-1.0.0
 * ONE in-visit voice control that EXPANDS. It never DECIDES.
 *
 * Owner, 2026-07-26, with a screenshot of the visit chip row:
 *   "combine these 3 things gradually into 1 amazing thing"
 *
 * The three are Copilot Voice, MLS Assistant and Dictate — rendered in the
 * visit lane as #ez3flCopilotVoice / #ez3flAssistant / #ez3flDictate, and in
 * the canonical engine renderer as #ez3QVoice / #ez3QAssistant / #ez3QDictate.
 *
 * ---------------------------------------------------------------------------
 * THE TWO WAYS THIS SHIPS BROKEN, AND WHY NEITHER IS ALLOWED HERE
 * ---------------------------------------------------------------------------
 *
 * 1. ONE BUTTON THAT GUESSES. Copilot Voice and Dictate are DIFFERENT
 *    recognizers under an explicit one-recognizer truce (mls-connect.js F11).
 *    Starting the wrong one mid-encounter is a clinical harm, not a glitch —
 *    dictation lands in the transcript, Copilot Voice does not. The app even
 *    ships a help entry whose only job is to say these are three different
 *    things. So this control expands to three NAMED options and picks nothing.
 *
 * 2. ONE BUTTON THAT FLOATS. The floating version of exactly this merge shipped
 *    as vc-1.0.0 (b651) and was retired at b676 after three builds of fighting
 *    the product: its closed state ate clicks meant for the page beneath (b658),
 *    and it sat precisely where scrollIntoView({block:'nearest'}) parks the
 *    review control — the last human gate before anything reaches Athena was on
 *    screen, focused, and 78% unclickable by mouse (b669). Contract law 5:
 *    nothing floats, ever. This control is IN FLOW, inside the chip row it
 *    replaces, and its fan pushes the page instead of covering it.
 *
 * ---------------------------------------------------------------------------
 * THE PROPERTIES THAT KEEP IT HONEST (each has its own assertion in
 * tests/visit-voice-one-expands-never-decides.test.js)
 * ---------------------------------------------------------------------------
 *
 * - It owns NO recognizer. No SpeechRecognition, no getUserMedia, no
 *   MediaRecorder, no .start(). The only way it acts is by clicking the REAL
 *   control, so the truce, the mic permission prompt and every failure message
 *   stay exactly where they live today.
 * - A CLOSED CONTROL MAY NEVER HIDE A HOT MIC. Collapsing three chips into one
 *   is the exact place "is my mic live?" gets lost. When anything is listening
 *   the face turns live and NAMES it — "Copilot Voice · listening" — because a
 *   generic dot cannot tell Copilot Voice from Dictate.
 * - Live state is READ from the app's own truth (the chips' aria-pressed/.on,
 *   the recognizers' own isListening(), the assistant panel's .open), never
 *   from a flag this module keeps, which could disagree with the truce.
 * - The three originals are hidden BY CLASS. available() reads INLINE display,
 *   so an inline hide would silently delete three features from the Calm Shell
 *   Tools menu. Reach: this control's fan, plus dock > Tools ("Copilot Voice",
 *   "MLS Assistant", "Dictate" are all in TOOLS_SOURCES).
 * - Fewer than two tools available -> it does not render at all. A disclosure
 *   that gathers up nothing is the accumulation this change exists to remove.
 * - No setInterval. State is mirrored from a MutationObserver coalesced into
 *   one animation frame, and every attribute write is guarded by a change
 *   check — a no-op write still invalidates style, and this surface has a
 *   documented idle-churn history (86 no-op body-class writes in 44s).
 * - Only transform and opacity animate, and all motion is off under
 *   prefers-reduced-motion. Animating a layout property here would cost a
 *   reflow on the busiest screen in the product.
 * - Reversible: window.__mlsVisitVoiceOne.revert(); describe() reports mounted,
 *   visible and live separately, because "mounted:true" was once truthfully
 *   reported about a state the owner is never in.
 * ==========================================================================*/
;(function () {
  'use strict';

  var W = window, D = document;
  var VERSION = 'vo-1.0.0';

  var prior = null;
  try { prior = W.__mlsVisitVoiceOne || null; } catch (e0) {}
  if (prior && prior.version === VERSION) return;
  if (prior && typeof prior.revert === 'function') { try { prior.revert(); } catch (e1) {} }

  var STYLE_ID = 'mlsVoStyle';
  var ROOT_ID = 'mlsVoiceOne', FACE_ID = 'mlsVoiceOneFace', FAN_ID = 'mlsVoiceOneFan';
  var BODY_ON = 'mls-voice-one';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return D.getElementById(id); }, null); }
  function isFn(f) { return typeof f === 'function'; }

  /* ---------------------------------------------------------------- items --
   * `controls` is an ORDERED list of REAL controls, best first. The lane chip
   * is preferred over the canonical pill because it does the in-visit work the
   * pill cannot: Dictate focuses #ez3flTranscript before toggling, so the
   * dictation lands in the visit transcript rather than wherever focus was.
   * Clicking a real control — rather than re-implementing what it does — is
   * what keeps the one-recognizer truce, the permission prompt and the failure
   * toasts in one place. */
  var ITEMS = [
    {
      key: 'voice', label: 'Copilot Voice', icon: '🎙',
      hint: 'hands-free commands during the visit',
      controls: ['ez3flCopilotVoice', 'ez3QVoice', 'mlsCopVoiceBtn'],
      live: function () {
        return chipOn('ez3flCopilotVoice') || chipOn('mlsCopVoiceBtn') ||
          safe(function () {
            var v = W.__mlsCopilotVoiceV2;
            return !!(v && isFn(v.isListening) && v.isListening());
          }, false);
      }
    },
    {
      key: 'assistant', label: 'MLS Assistant', icon: '🤖',
      hint: 'ask about this visit without leaving it',
      controls: ['ez3flAssistant', 'ez3QAssistant', 'mlsAsstFab'],
      live: function () {
        return chipOn('ez3flAssistant') ||
          safe(function () { var p = $('mlsAsstPanel'); return !!(p && p.classList.contains('open')); }, false);
      }
    },
    {
      key: 'dictate', label: 'Dictate', icon: '🎤',
      hint: 'speak straight into the transcript',
      controls: ['ez3flDictate', 'ez3QDictate', 'mlsDaDock'],
      live: function () {
        return chipOn('ez3flDictate') ||
          safe(function () {
            var d = W.__mlsDictateAnywhere;
            return !!(d && isFn(d.isListening) && d.isListening());
          }, false);
      }
    }
  ];

  /* Read pressed state off the real control. aria-pressed is what
     setTopVoiceChip writes; .on is what the older pills use. A private flag
     here could disagree with the truce, and the disagreement would be silent. */
  function chipOn(id) {
    var el = $(id);
    if (!el) return false;
    if (el.getAttribute && el.getAttribute('aria-pressed') === 'true') return true;
    return !!(el.classList && el.classList.contains('on'));
  }

  /* Controls that may only be operated by a REAL human gesture. None of the
     three tools here is one today — but startPhoneMic and its siblings refuse
     untrusted callers SILENTLY, and a guard can be added to any control later.
     If a target ever becomes gesture-gated this control SHOWS it and says so
     rather than firing a synthetic click the gate would refuse without a word.
     Never synthesize an event to make a proxy work. */
  var GESTURE_GATED = ['phoneMicBtn', 'phoneMicStopBtn', 'mlsSyncVerifyNow'];

  function resolve(item) {
    for (var i = 0; i < item.controls.length; i++) {
      var el = $(item.controls[i]);
      if (el) return el;
    }
    return null;
  }
  function available(item) { return !!resolve(item); }

  function toast(msg) {
    safe(function () { if (isFn(W.toast)) W.toast(msg, 'err'); });
  }

  /* ------------------------------------------------------------------ CSS --
   * In flow, never over content. Only transform/opacity transition. The fan is
   * a normal block that takes its own height, so the page reflows around it
   * once on open — it never covers a control, which is the whole reason the
   * floating version had to be retired. */
  function css() {
    if ($(STYLE_ID)) return;
    var s = D.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      /* the three originals leave the row — BY CLASS, so Tools reach survives */
      'html body.' + BODY_ON + ' #ez3flCopilotVoice,',
      'html body.' + BODY_ON + ' #ez3flAssistant,',
      'html body.' + BODY_ON + ' #ez3flDictate,',
      'html body.' + BODY_ON + ' #ez3QVoice,',
      'html body.' + BODY_ON + ' #ez3QAssistant,',
      'html body.' + BODY_ON + ' #ez3QDictate{display:none!important;}',

      '#' + ROOT_ID + '{display:inline-flex;flex-direction:column;align-items:stretch;position:relative;}',
      '#' + ROOT_ID + '.open{flex-basis:100%;}',

      /* the face: a quiet chip in the same family as its neighbours, so it
         never competes with the state hero above it */
      '#' + FACE_ID + '{display:inline-flex;align-items:center;gap:8px;',
      'background:#fff;border:1px solid #D9D6CD;border-radius:11px;color:#1A211C;',
      'font:600 12.5px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;',
      /* 44px, not the 38px its neighbours use. Measured at 390x844 a 38px
         control is under the touch-target floor, and this is the one control
         on the visit surface a doctor reaches for mid-encounter with one hand.
         The extra 6px is deliberate and is the only way it differs in size
         from the quiet chips beside it. */
      'cursor:pointer;padding:11px 14px;min-height:44px;',
      'transition:opacity var(--mls-dur-1) linear,transform var(--mls-dur-2) var(--mls-ease-out);}',
      '#' + FACE_ID + ':hover{background:#F4F2EC;}',
      '#' + FACE_ID + ':active{transform:scale(.97);}',
      '#' + FACE_ID + ':focus-visible{outline:2px solid #2E6A4B;outline-offset:2px;}',
      '#' + FACE_ID + ' .vo-dot{width:9px;height:9px;border-radius:50%;background:#B9C2BB;flex:0 0 auto;}',
      '#' + FACE_ID + ' .vo-name{white-space:nowrap;}',
      '#' + FACE_ID + ' .vo-caret{color:#79837C;font-size:11px;}',

      /* LIVE: a closed control must never hide a hot mic, and must say WHICH */
      '#' + FACE_ID + '.live{background:#FCF1F1;border-color:#E7BFC1;color:#8E2F33;font-weight:700;}',
      '#' + FACE_ID + '.live .vo-dot{background:#B83D42;animation:mlsVoPulse 1.6s ease-in-out infinite;}',
      '#' + FACE_ID + '.live .vo-caret{color:#B07C7E;}',
      '@keyframes mlsVoPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.45;transform:scale(.82)}}',

      /* the fan: in flow, full width of the row, pushes content down */
      '#' + FAN_ID + '{display:none;flex-direction:column;gap:6px;margin-top:8px;',
      'background:#FBFAF7;border:1px solid #E4E1D8;border-radius:14px;padding:8px;',
      'box-shadow:0 1px 2px rgba(20,33,28,.04);}',
      '#' + ROOT_ID + '.open #' + FAN_ID + '{display:flex;',
      'animation:mlsVoIn .18s cubic-bezier(.2,.8,.3,1) both;}',
      '@keyframes mlsVoIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}',

      '#' + FAN_ID + ' .vo-item{display:flex;align-items:center;gap:11px;text-align:left;width:100%;',
      'background:#fff;border:1px solid #E7E5DD;border-radius:11px;color:#1A211C;',
      'font:600 13px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;',
      'cursor:pointer;padding:11px 13px;min-height:44px;box-sizing:border-box;',
      'transition:transform var(--mls-dur-1) var(--mls-ease-out),opacity var(--mls-dur-1) linear;}',
      '#' + FAN_ID + ' .vo-item:hover{transform:translateX(2px);}',
      '#' + FAN_ID + ' .vo-item:focus-visible{outline:2px solid #2E6A4B;outline-offset:2px;}',
      '#' + FAN_ID + ' .vo-ic{font-size:16px;line-height:1;flex:0 0 auto;}',
      '#' + FAN_ID + ' .vo-txt{display:flex;flex-direction:column;gap:2px;min-width:0;}',
      '#' + FAN_ID + ' .vo-hint{color:#5F6A63;font-weight:500;font-size:11.5px;}',
      '#' + FAN_ID + ' .vo-state{margin-left:auto;flex:0 0 auto;color:#79837C;font-weight:700;font-size:11px;',
      'letter-spacing:.04em;text-transform:uppercase;}',
      '#' + FAN_ID + ' .vo-item[aria-pressed="true"]{border-color:#E7BFC1;background:#FCF1F1;}',
      '#' + FAN_ID + ' .vo-item[aria-pressed="true"] .vo-state{color:#B83D42;}',

      /* PHONE MODE, and the one rule that must survive it.
         mls-connect.js ships `body.mls-phone .ez3fl-quick{display:none}` — the
         whole chip row is deliberately dropped on a handheld to keep the
         record CTA alone on screen. That is right for three idle chips and
         WRONG for a live microphone: it would leave a doctor holding a phone
         with a recognizer running and nothing on screen saying so. So the row
         comes back for exactly as long as something is listening, carrying
         nothing but this control. Idle, phone mode is untouched. */
      'html body.mls-phone .ez3fl-quick:has(#' + ROOT_ID + '.live){display:flex!important;}',
      'html body.mls-phone .ez3fl-quick:has(#' + ROOT_ID + '.live) > *:not(#' + ROOT_ID + '){display:none!important;}',
      'html body.mls-phone #' + ROOT_ID + '.live{display:inline-flex!important;}',

      'body.theme-dark #' + FACE_ID + '{background:#1D2621;border-color:#31413A;color:#E8EFE9;}',
      'body.theme-dark #' + FACE_ID + ':hover{background:#243029;}',
      'body.theme-dark #' + FAN_ID + '{background:#161D19;border-color:#31413A;}',
      'body.theme-dark #' + FAN_ID + ' .vo-item{background:#1D2621;border-color:#31413A;color:#E8EFE9;}',
      'body.theme-dark #' + FAN_ID + ' .vo-hint{color:#9DB0A4;}',

      /* motion here is decoration; the control must work identically without it */
      '@media (prefers-reduced-motion: reduce){',
      '#' + FACE_ID + ',#' + FAN_ID + ' .vo-item{transition:none!important;}',
      '#' + ROOT_ID + '.open #' + FAN_ID + '{animation:none!important;}',
      '#' + FACE_ID + '.live .vo-dot{animation:none!important;}}'
    ].join('');
    (D.head || D.documentElement).appendChild(s);
  }

  /* --------------------------------------------------------------- mount --
   * The row is `.ez3fl-quick` — the lane's own chip row and the engine's
   * #ez3QuickTools are the same class and are mutually exclusive on screen, so
   * mount into whichever one is actually rendered inside #visitView. */
  var root = null, face = null, faceDot = null, faceName = null, faceCaret = null, fan = null;
  var open = false, items = [], mountedIn = null;

  function quickRow() {
    var view = $('visitView'); if (!view) return null;
    var rows = safe(function () { return view.querySelectorAll('.ez3fl-quick'); }, null);
    if (!rows || !rows.length) return null;
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i].getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return rows[i];
    }
    return rows[0];
  }

  function build() {
    root = D.createElement('div');
    root.id = ROOT_ID;

    face = D.createElement('button');
    face.type = 'button';
    face.id = FACE_ID;
    face.setAttribute('aria-expanded', 'false');
    face.setAttribute('aria-controls', FAN_ID);
    faceDot = D.createElement('span'); faceDot.className = 'vo-dot'; faceDot.setAttribute('aria-hidden', 'true');
    faceName = D.createElement('span'); faceName.className = 'vo-name';
    faceCaret = D.createElement('span'); faceCaret.className = 'vo-caret'; faceCaret.setAttribute('aria-hidden', 'true');
    face.appendChild(faceDot); face.appendChild(faceName); face.appendChild(faceCaret);
    face.addEventListener('click', function (ev) { ev.preventDefault(); toggle(); });

    fan = D.createElement('div');
    fan.id = FAN_ID;
    fan.setAttribute('role', 'group');
    fan.setAttribute('aria-label', 'Voice and assistant tools');

    root.appendChild(face);
    root.appendChild(fan);
  }

  /* Rebuild the fan ONLY when the set of available tools actually changes.
     The observer fires on every mutation inside #visitView, and a transcript
     streaming in mutates it continuously — rewriting innerHTML on each of
     those would be a worse churn defect than the one this merge removes. */
  var lastFanSig = null;
  function fanSig() {
    var out = [];
    for (var i = 0; i < ITEMS.length; i++) if (available(ITEMS[i])) out.push(ITEMS[i].key);
    return out.join(',');
  }

  function fanItems() {
    var sig = fanSig();
    if (sig === lastFanSig && items.length && fan.firstChild) return items.length;
    lastFanSig = sig;
    fan.innerHTML = '';
    items = [];
    for (var i = 0; i < ITEMS.length; i++) {
      var def = ITEMS[i];
      if (!available(def)) continue;
      var b = D.createElement('button');
      b.type = 'button';
      b.className = 'vo-item';
      b.id = 'mlsVoiceOne_' + def.key;
      b.setAttribute('aria-pressed', 'false');
      var ic = D.createElement('span'); ic.className = 'vo-ic'; ic.setAttribute('aria-hidden', 'true'); ic.textContent = def.icon;
      var txt = D.createElement('span'); txt.className = 'vo-txt';
      var lbl = D.createElement('span'); lbl.textContent = def.label;
      var hint = D.createElement('span'); hint.className = 'vo-hint'; hint.textContent = def.hint;
      txt.appendChild(lbl); txt.appendChild(hint);
      var state = D.createElement('span'); state.className = 'vo-state';
      b.appendChild(ic); b.appendChild(txt); b.appendChild(state);
      /* Forward the doctor's OWN event. `run` never synthesizes one. */
      (function (d) {
        b.addEventListener('click', function (ev) { ev.preventDefault(); run(d, ev); });
      })(def);
      fan.appendChild(b);
      items.push({ def: def, btn: b, state: state });
    }
    return items.length;
  }

  /* The ONLY way this module acts: click the real control. It re-implements
     nothing, so the recognizer truce, the mic prompt and every failure message
     stay where they already live and already work. */
  function run(def, ev) {
    var target = resolve(def);
    if (!target) { toast(def.label + ' is still loading. Try again in a moment.'); return; }
    if (GESTURE_GATED.indexOf(target.id) !== -1) {
      /* Refuse to fake a gesture. Show the real control and say so — a
         synthetic click here is refused SILENTLY, which reads as a dead
         button forever. */
      safe(function () { target.scrollIntoView({ block: 'center', behavior: 'smooth' }); });
      toast(def.label + ' needs a direct tap on its own button — it is highlighted above.');
      return;
    }
    /* A trusted user gesture is in progress on THIS button; clicking the
       canonical control inside that gesture is the sanctioned path the
       retired cluster used and the one the lane chips use today. */
    if (!ev || ev.isTrusted !== true) { toast(def.label + ' needs a direct tap.'); return; }
    safe(function () { target.click(); });
    setOpen(false);
    schedule();
  }

  /* ------------------------------------------------------------- live sync -
   * Every write is guarded by a change check. A no-op attribute write still
   * invalidates style, and this is the screen with the documented churn. */
  function sync() {
    if (!root || !root.isConnected) return;
    var liveNames = [], anyLive = false;
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var on = !!safe(it.def.live, false);
      if (on) { anyLive = true; liveNames.push(it.def.label); }
      var was = it.btn.getAttribute('aria-pressed') === 'true';
      if (on !== was) it.btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      var stateTxt = on ? 'live' : '';
      if (it.state.textContent !== stateTxt) it.state.textContent = stateTxt;
    }
    if (face.classList.contains('live') !== anyLive) face.classList.toggle('live', anyLive);
    /* the ROOT carries it too, because the phone-mode override below has to
       select on an ancestor of the row to bring the row back */
    if (root.classList.contains('live') !== anyLive) root.classList.toggle('live', anyLive);

    /* NAME what is running. "listening" alone cannot tell Copilot Voice from
       Dictate, and those are different recognizers writing to different
       places. */
    var name = anyLive ? (liveNames.join(' + ') + ' · listening') : 'Voice tools';
    if (faceName.textContent !== name) faceName.textContent = name;
    var caret = open ? '▴' : '▾';
    if (faceCaret.textContent !== caret) faceCaret.textContent = caret;
    var al = anyLive ? (liveNames.join(' and ') + ' is listening. Open voice and assistant tools.')
                     : 'Voice and assistant tools';
    if (face.getAttribute('aria-label') !== al) face.setAttribute('aria-label', al);
    var ttl = anyLive ? (liveNames.join(' and ') + ' is listening right now.')
                      : 'Copilot Voice, MLS Assistant and Dictate — pick one, nothing starts on its own.';
    if (face.getAttribute('title') !== ttl) face.setAttribute('title', ttl);
  }

  function setOpen(want) {
    want = !!want;
    if (open === want) { sync(); return; }
    open = want;
    root.classList.toggle('open', open);
    face.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      var first = fan.querySelector('.vo-item');
      if (first) safe(function () { first.focus(); });
    }
    sync();
  }
  function toggle() { setOpen(!open); return open; }

  /* Escape closes; a click elsewhere closes. Both are document listeners
     installed once, removed by revert(). */
  function onKey(ev) {
    if (!open) return;
    if (ev.key !== 'Escape' && ev.keyCode !== 27) return;
    setOpen(false);
    safe(function () { face.focus(); });
  }
  function onDocClick(ev) {
    if (!open || !root) return;
    var t = ev.target;
    if (t && root.contains(t)) return;
    setOpen(false);
  }

  /* ---- mount / unmount ---------------------------------------------------
   * Fewer than two tools available means there is nothing to disclose, and a
   * disclosure over one item is chrome pretending to be a feature. */
  function mount() {
    var host = quickRow();
    if (!host) { unmount(); return false; }
    if (!root) build();
    if (!fanItems()) { unmount(); return false; }
    if (items.length < 2) { unmount(); return false; }
    if (root.parentNode !== host) {
      host.appendChild(root);
      mountedIn = host;
    }
    if (D.body && !D.body.classList.contains(BODY_ON)) D.body.classList.toggle(BODY_ON, true);
    sync();
    return true;
  }
  function unmount() {
    if (root && root.parentNode) safe(function () { root.parentNode.removeChild(root); });
    mountedIn = null;
    open = false;
    lastFanSig = null;
    /* The originals come straight back the moment this control is not there —
       the class is the only thing hiding them. */
    if (D.body && D.body.classList.contains(BODY_ON)) D.body.classList.toggle(BODY_ON, false);
  }

  /* ---- observer, coalesced into one frame; NEVER a timer ----------------- */
  var frame = 0, obs = null;
  function schedule() {
    if (frame) return;
    frame = safe(function () {
      return W.requestAnimationFrame(function () { frame = 0; safe(mount); });
    }, 0);
    if (!frame) safe(mount);
  }
  function observe() {
    if (obs) return;
    var target = $('visitView') || D.body;
    if (!target) return;
    obs = safe(function () {
      var o = new MutationObserver(schedule);
      o.observe(target, { childList: true, subtree: true });
      return o;
    }, null);
  }

  function boot() {
    if (!D.body) { safe(function () { W.requestAnimationFrame(boot); }); return; }
    css();
    D.addEventListener('keydown', onKey, true);
    D.addEventListener('click', onDocClick, true);
    observe();
    schedule();
  }

  W.__mlsVisitVoiceOne = {
    version: VERSION,
    installed: true,
    toggle: function () { if (!root || !root.isConnected) mount(); return root && root.isConnected ? toggle() : false; },
    /* mounted, visible and live are DIFFERENT questions. Reporting only
       "mounted" once described, truthfully, a state the owner is never in. */
    describe: function () {
      var r = root && root.isConnected ? root.getBoundingClientRect() : null;
      return {
        version: VERSION,
        mounted: !!(root && root.isConnected),
        visible: !!(r && r.width > 0 && r.height > 0),
        open: open,
        host: mountedIn ? (mountedIn.id || mountedIn.className) : null,
        items: items.map(function (i) { return i.def.label; }),
        live: items.filter(function (i) { return safe(i.def.live, false); }).map(function (i) { return i.def.label; }),
        hiddenOriginals: ['ez3flCopilotVoice', 'ez3flAssistant', 'ez3flDictate', 'ez3QVoice', 'ez3QAssistant', 'ez3QDictate']
      };
    },
    revert: function () {
      try { D.removeEventListener('keydown', onKey, true); } catch (e) {}
      try { D.removeEventListener('click', onDocClick, true); } catch (e) {}
      try { if (obs) obs.disconnect(); } catch (e) {}
      obs = null;
      try { if (frame) W.cancelAnimationFrame(frame); } catch (e) {}
      frame = 0;
      unmount();
      try { var s = $(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
      root = face = fan = faceDot = faceName = faceCaret = null;
      items = [];
      W.__mlsVisitVoiceOne.installed = false;
      return 'the three in-visit voice chips are back (ez3flCopilotVoice, ez3flAssistant, ez3flDictate)';
    }
  };

  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
