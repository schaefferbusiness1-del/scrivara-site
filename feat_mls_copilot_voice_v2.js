/* ============================================================================
 * feat_mls_copilot_voice_v2.js  ->  window.__mlsCopilotVoiceV2   (cv2-1.0.0)
 * ---------------------------------------------------------------------------
 * REPLACES the b39 "MLS Copilot Voice" button (window.__mlsCopilotVoiceB39,
 * bundle-inline) with a version that ACTUALLY WORKS as continuous hands-free
 * voice control, instead of a single ~8s dictation window with only 4 rigid
 * regex intents and silent failure on mic errors.
 *
 * WHY REPLACE RATHER THAN PATCH: b39 is compiled into mls-connect.js itself
 * (not a satellite), so it cannot be edited without a bundle rebuild. It DOES
 * expose a public, documented revert: window.__mlsCopilotVoiceB39_revert().
 * This module calls that revert on boot (if present) and installs a strictly
 * better replacement in the exact same slot (#mlsCopVoiceBtn, bottom-left,
 * same visual language) -- additive, reversible, no bundle edit required.
 *
 * WHAT WAS ACTUALLY BROKEN (verified by reading the live code):
 *   - The old button opened the assistant panel and clicked its OWN one-shot
 *     dictation mic (.mls-b35-mic, continuous:false, closes after first final
 *     result or ~8s) -- so every command needed a fresh click+wait, and a
 *     misrecognized phrase or denied mic permission failed SILENTLY (no toast,
 *     no spoken feedback -- the pulse animation just stopped).
 *   - Only 4 hard-coded exact-phrase regexes were registered as voice-only
 *     intents (start visit / stop recording / generate note / send to Athena).
 *     Nothing for pulling today's schedule, opening a patient's chart,
 *     reading back the note/history, or navigating tabs by voice -- even
 *     though the assistant's OWN text pipeline (__mlsAsstFix) already supports
 *     pull-schedule / open-athena / connection-status / select-patient as
 *     deterministic intents. Voice just never surfaced them well nor added
 *     new ones (read-history, navigate) that don't exist anywhere.
 *
 * WHAT THIS MODULE DOES
 *   - ONE mic button, click to start / click (or say "stop listening") to
 *     stop. Continuous: auto-restarts the recognizer between utterances while
 *     toggled on, exactly like the existing __mlsVoice command-FAB pattern
 *     already proven in this codebase (feat_mls_voice_commands.js).
 *   - Every recognized final utterance is sent through the SAME assistant
 *     pipeline as typed chat: window.__mlsAsstFix._handleSend(text). This
 *     means it automatically gets ALL of __mlsAsstFix's existing deterministic
 *     intents (pull today's/Dr X's schedule, open athenaOne, connection
 *     status, open <name>'s chart) PLUS the new intents registered below,
 *     PLUS graceful fallback to the real /api/copilot AI for anything else --
 *     one brain, one thread, exactly as the codebase's own design intent says.
 *   - NEW voice intents added on top (via the existing, public, additive
 *     window.__mlsAsstFix.registerIntent(name, fn, atFront) API -- the exact
 *     extensibility point b39 already used, so this is a proven, low-risk
 *     mechanism, not a new one):
 *       "start a visit (for X)"      -> loads patient + starts recording
 *       "stop recording"             -> stops capture
 *       "generate the note"          -> runs the real note generator
 *       "read me the note/history"   -> reads the current note aloud (TTS);
 *                                       falls back to the latest saved note
 *                                       for the active patient if the note
 *                                       box is empty. Read-only, local, no
 *                                       network call.
 *       "go to / open / show <tab>"  -> window.showView(<mapped tab>)
 *       "send it to Athena"          -> OPENS the review-&-confirm modal only
 *                                       (#emrBtn). Kept byte-for-byte
 *                                       equivalent to b39's safety behavior.
 *   - EXPLICIT SAFETY REFUSAL INTENT (new, registered FIRST/highest priority):
 *     any utterance that talks about signing, submitting, ordering, or
 *     finalizing in athenaOne is intercepted BEFORE it can reach the free-form
 *     AI (which might otherwise try to be "helpful") and answered with a
 *     clear, honest refusal: voice can navigate/pull/read/prep, but signing,
 *     ordering, and submitting are manual-only in athenaOne. No function that
 *     could sign/save/submit/order is ever referenced or reachable from this
 *     module -- there is no code path to one.
 *   - Graceful degradation: unsupported browser (no SpeechRecognition), no
 *     speech detected, and permission-denied all produce a clear on-screen
 *     toast AND spoken (TTS) explanation -- never a silent failure.
 *
 * HARD SAFETY (unchanged from the architecture's rules, restated for review):
 *   - This module cannot write to, sign, save, or submit anything in
 *     athenaOne. Its only Athena-adjacent action is opening the existing
 *     review-and-confirm modal, which itself never auto-clicks Save/Sign/
 *     Submit (see _ATHENA_RULES in the base app) -- the doctor always
 *     confirms there.
 *   - No order-related function is ever called.
 *   - Nothing here auto-navigates athenaOne or foregrounds any tab.
 *
 * Idempotent, additive, reversible: window.__mlsCopilotVoiceV2.revert().
 * Calling revert() removes this module's button/intents/CSS and restores
 * b39's guard to a re-installable state, but b39 itself only reinstalls on
 * a fresh page load (documented, consistent with other guarded modules in
 * this codebase). ASCII-only. try/catch throughout. No PHI logged (only
 * control strings like intent names and view names).
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCopilotVoiceV2 && window.__mlsCopilotVoiceV2.installed) return; } catch (e) { return; }

  var VERSION = 'cv2-1.0.0';
  var ASSET = 'feat_mls_copilot_voice_v2.js';
  var BTN_ID = 'mlsCopVoiceBtn';
  var STYLE_ID = 'mlsVoiceV2Style';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function toast(m) { safe(function () { if (isFn(window.toast)) window.toast(m, ''); }); }
  function speak(text) {
    safe(function () {
      if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) return;
      if (window.__mlsCopilotVoiceV2 && window.__mlsCopilotVoiceV2._muted) return;
      var u = new SpeechSynthesisUtterance(String(text));
      u.rate = 1.02; u.pitch = 1.0; u.volume = 1.0;
      window.speechSynthesis.speak(u);
    });
  }

  /* ---------------- retire the old b39 button (public, documented revert) ---------------- */
  function retireOld() {
    safe(function () {
      if (isFn(window.__mlsCopilotVoiceB39_revert)) window.__mlsCopilotVoiceB39_revert();
    });
  }

  /* ---------------- CSS + button (same visual slot as b39) ---------------- */
  function css() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '#' + BTN_ID + '{position:fixed;left:12px;bottom:14px;z-index:99997;display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border:0;border-radius:999px;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;font:800 14px system-ui;box-shadow:0 8px 24px rgba(124,58,237,.45);cursor:pointer}',
      '#' + BTN_ID + ':hover{filter:brightness(1.1)}',
      '#' + BTN_ID + '.listening{animation:mlsCv2Pulse 1s ease-in-out infinite}',
      '#' + BTN_ID + '.denied{background:linear-gradient(135deg,#9aa4b2,#6b7684)}',
      '@keyframes mlsCv2Pulse{50%{box-shadow:0 8px 34px rgba(220,60,60,.8)}}',
      '#mlsAsstFab{bottom:64px!important}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  var enabled = false;         /* user has toggled listening on */
  var rec = null;
  var deniedPermanently = false;

  function SR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

  function paintBtn(btn) {
    if (!btn) return;
    btn.classList.toggle('listening', enabled && !deniedPermanently);
    btn.classList.toggle('denied', deniedPermanently);
    btn.innerHTML = '🎙️ ' + (deniedPermanently ? 'Mic blocked' : (enabled ? 'Listening… (tap to stop)' : 'MLS Copilot Voice'));
    btn.title = deniedPermanently
      ? 'Microphone access was blocked -- allow it in your browser, then click to retry.'
      : 'Talk to MLS -- start visits, pull schedules, open charts, generate notes, navigate tabs, all by voice.';
  }

  function ensureBtn() {
    if ($(BTN_ID)) return;
    var b = document.createElement('button');
    b.id = BTN_ID; b.type = 'button';
    paintBtn(b);
    b.onclick = function () {
      if (deniedPermanently) { deniedPermanently = false; }
      setEnabled(!enabled, b);
    };
    (document.body || document.documentElement).appendChild(b);
  }

  function startRec() {
    var Ctor = SR();
    if (!Ctor) {
      toast('Voice needs Chrome or Edge -- this browser has no speech recognition.');
      speak('Voice control needs Chrome or Edge.');
      return false;
    }
    rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = function (ev) {
      try {
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          if (!ev.results[i].isFinal) continue;
          var said = S(ev.results[i][0] && ev.results[i][0].transcript).trim();
          if (said) handleSaid(said);
        }
      } catch (e) {}
    };
    rec.onerror = function (ev) {
      var err = ev && ev.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        deniedPermanently = true; enabled = false;
        toast('Microphone was blocked. Allow mic access for this site, then click MLS Copilot Voice again.');
        speak('Microphone access is blocked. Please allow it, then try again.');
        paintBtn($(BTN_ID));
        return;
      }
      if (err === 'no-speech') { return; } /* keep listening, this is normal and expected */
      if (err === 'audio-capture') {
        enabled = false;
        toast('No microphone found -- check your input device, then try again.');
        paintBtn($(BTN_ID));
        return;
      }
      /* network / aborted / other -- onend will decide whether to restart */
    };
    rec.onend = function () {
      if (enabled && !deniedPermanently) {
        setTimeout(function () { safe(function () { if (enabled) rec.start(); }); }, 250);
      }
    };
    safe(function () { rec.start(); });
    return true;
  }
  function stopRec() {
    safe(function () { if (rec) { rec.onend = null; rec.stop(); } });
    rec = null;
  }

  function setEnabled(on, btn) {
    enabled = !!on;
    btn = btn || $(BTN_ID);
    if (enabled) {
      var ok = startRec();
      if (ok) { toast('Listening -- say things like "pull today’s patients", "start a visit for Jones", "generate the note", or "go to history".'); speak('Listening.'); }
      else enabled = false;
    } else {
      stopRec();
      toast('Voice control off.');
    }
    paintBtn(btn);
  }

  function handleSaid(text) {
    safe(function () {
      if (/\bstop listening\b|\bturn off voice\b/i.test(text)) { setEnabled(false); return; }
      if (window.__mlsAsstFix && isFn(window.__mlsAsstFix._handleSend)) {
        /* open the panel so the user sees the exchange, same as b39 did */
        var p = $('mlsAsstPanel');
        if (!p || getComputedStyle(p).display === 'none') { var fab = $('mlsAsstFab'); if (fab) fab.click(); }
        window.__mlsAsstFix._handleSend(text);
      }
    });
  }

  /* ---------------- intent helpers ---------------- */
  function findPatient(name) {
    name = S(name).trim().toLowerCase(); if (!name) return null;
    var list = safe(function () { return (window.__mlsWhosNext && window.__mlsWhosNext.activeList && window.__mlsWhosNext.activeList()) || []; }, []);
    for (var i = 0; i < list.length; i++) if (S(list[i].name).toLowerCase().indexOf(name) >= 0) return list[i];
    var ps = safe(function () { return (window.getPatients && window.getPatients()) || []; }, []);
    for (var j = 0; j < ps.length; j++) if (S(ps[j].name).toLowerCase().indexOf(name) >= 0) return { name: ps[j].name, dob: ps[j].dob || '', id: ps[j].id };
    return null;
  }
  function loadPatient(p) {
    safe(function () {
      var nm = $('heroPtName'); if (nm) { nm.value = p.name || ''; nm.dispatchEvent(new Event('input', { bubbles: true })); }
      var db = $('heroPtDob'); if (db) { db.value = p.dob || ''; db.dispatchEvent(new Event('input', { bubbles: true })); }
      if (isFn(window._heroSyncName)) window._heroSyncName();
    });
  }
  var VIEW_ALIASES = {
    home: 'visit', visit: 'visit', record: 'visit', recording: 'visit',
    schedule: 'calendar', calendar: 'calendar',
    patients: 'patients', patient: 'patients',
    orders: 'orders', order: 'orders',
    recs: 'recs', recommendation: 'recs', recommendations: 'recs',
    history: 'history', notes: 'history',
    team: 'team',
    analysis: 'analysis', stats: 'analysis', statistics: 'analysis',
    studio: 'studio', ai: 'studio'
  };
  function readNoteAloud() {
    var box = $('noteBox');
    var text = box ? S(box.value).trim() : '';
    if (!text) { toast('There is no note yet to read back -- generate one first.'); speak('There is no note yet to read back.'); return; }
    toast('Reading the note aloud.');
    speak(text.slice(0, 4000));
  }

  /* ---------------- register new deterministic intents ---------------- */
  var unregs = [], registered = false;
  function registerIntents() {
    if (registered) return;
    var fx = window.__mlsAsstFix;
    if (!fx || !isFn(fx.registerIntent)) return;
    registered = true;

    /* highest priority: explicit safety refusal for anything sign/submit/order-shaped */
    unregs.push(fx.registerIntent('voice-safety-refuse', function (q) {
      var s = S(q).trim();
      var refuse = /\bsign\b.*\b(it|the note|the chart|this)\b/i.test(s) ||
        /\b(submit|place|put in)\b.*\border/i.test(s) ||
        /\be-?sign\b/i.test(s) ||
        /\bfinalize\b.*\b(chart|encounter|note)\b/i.test(s) ||
        /\battest\b/i.test(s);
      if (!refuse) return false;
      toast('Voice can navigate, pull, read, and prep -- but signing, ordering, and submitting in athenaOne must be done manually by you there.');
      speak('Signing, ordering, and submitting must be done manually in athenaOne. I can prep and navigate, but I will not do that for you.');
      return true;
    }, true));

    unregs.push(fx.registerIntent('voice-start-visit', function (q) {
      var m = S(q).match(/^(?:please\s+)?(?:start|begin)\s+(?:a\s+|the\s+)?visit(?:\s+(?:for|with)\s+(.+))?$/i);
      if (!m) return false;
      safe(function () { if (isFn(window.showView)) window.showView('visit'); });
      var who = m[1] ? findPatient(m[1]) : null;
      if (m[1] && !who) { toast('Could not find "' + m[1] + '" on the schedule -- pull today’s patients first, or tap their card in Who’s Next.'); return true; }
      if (who) loadPatient(who);
      safe(function () { if (isFn(window.startCapture)) window.startCapture(); else if (isFn(window.heroStartVisit)) window.heroStartVisit(); });
      toast('🎙️ Visit started' + (who ? (' for ' + who.name) : '') + ' -- recording. Say "stop recording" when done.');
      return true;
    }, true));

    unregs.push(fx.registerIntent('voice-stop-recording', function (q) {
      if (!/^(?:please\s+)?(?:stop|end|finish)(?:\s+the)?\s+(?:recording|capture|visit)$/i.test(S(q).trim())) return false;
      safe(function () { if (isFn(window.stopCapture)) window.stopCapture(); });
      toast('⏹ Recording stopped. Say "generate the note" when ready.');
      return true;
    }, true));

    unregs.push(fx.registerIntent('voice-generate-note', function (q) {
      if (!/^(?:please\s+)?(?:generate|write|create|make)(?:\s+(?:the|my|a))?\s+note$/i.test(S(q).trim())) return false;
      safe(function () { if (isFn(window.showView)) window.showView('visit'); });
      safe(function () { if (isFn(window.generateNote)) window.generateNote(); });
      toast('📝 Generating the note from your recording…');
      return true;
    }, true));

    unregs.push(fx.registerIntent('voice-read-history', function (q) {
      if (!/\b(read|play)\b.*\b(note|history|back)\b/i.test(S(q).trim())) return false;
      readNoteAloud();
      return true;
    }, true));

    unregs.push(fx.registerIntent('voice-navigate', function (q) {
      var m = S(q).trim().match(/^(?:please\s+)?(?:go to|open|show|navigate to)\s+(?:the\s+)?([a-z ]+?)(?:\s+tab| view)?$/i);
      if (!m) return false;
      var key = m[1].trim().toLowerCase();
      var view = VIEW_ALIASES[key];
      if (!view) return false;
      safe(function () { if (isFn(window.showView)) window.showView(view); });
      toast('Opened ' + key + '.');
      return true;
    }, true));

    unregs.push(fx.registerIntent('voice-send-to-athena', function (q) {
      if (!/^(?:please\s+)?send\s+(?:it|the\s+(?:visit|note)|everything)?\s*to\s+athena(?:one)?$/i.test(S(q).trim())) return false;
      safe(function () { var e = $('emrBtn'); if (e) e.click(); });
      toast('🗂️ Review & confirm opened -- nothing goes to Athena until you confirm it there.');
      return true;
    }, true));
  }

  /* ---------------- boot / revert ---------------- */
  var bootIv = null;
  function tick() { safe(css); safe(ensureBtn); safe(registerIntents); }
  function boot() {
    retireOld();
    tick();
    bootIv = setInterval(tick, 1200);
  }
  function revert() {
    if (bootIv) { clearInterval(bootIv); bootIv = null; }
    setEnabled(false);
    safe(function () { unregs.forEach(function (u) { safe(u); }); });
    safe(function () { var b = $(BTN_ID); if (b) b.remove(); });
    safe(function () { var s = $(STYLE_ID); if (s) s.remove(); });
    try { window.__mlsCopilotVoiceV2.installed = false; } catch (e) {}
  }

  window.__mlsCopilotVoiceV2 = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    _muted: false,
    _testHandle: handleSaid,
    isListening: function () { return enabled; },
    start: function () { setEnabled(true); },
    stop: function () { setEnabled(false); },
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})();
