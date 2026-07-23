/* ============================================================================
 * feat_mls_copilot_voice_v2.js  ->  window.__mlsCopilotVoiceV2   (cv2-1.1.6)
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
  var VERSION = 'cv2-1.2.0';
  var previous = null;
  try { previous = window.__mlsCopilotVoiceV2; } catch (e0) {}
  if (previous && previous.installed && previous.version === VERSION) return;
  if (previous) {
    try { if (typeof previous.revert === 'function') previous.revert(); } catch (e1) {}
    try { previous.installed = false; if (window.__mlsCopilotVoiceV2 === previous) delete window.__mlsCopilotVoiceV2; } catch (e2) {}
    try {
      ['mlsCopVoiceBtn', 'mlsVoiceV2Style'].forEach(function (id) {
        var node = document.getElementById(id); if (node && node.remove) node.remove();
      });
    } catch (e3) {}
  }

  /* cv2-1.1.0 (2026-07-12, final integration sweep) -- CHAINED VOICE COMMANDS + SAFE PATIENT OPEN:
   *   - NEW "open <patient>" intent: id-based REAL selection (window.selectPatient first --
   *     the live asst_fix builtin only tried __mlsPick/openPatient, which no-op on the
   *     current build, so "Opened X's chart" could lie), exact-name-first matching, and a
   *     HARD ambiguity refusal (multiple name matches -> list candidates with DOB, never
   *     guess). Confirms name + DOB out loud after a verified switch.
   *   - NEW "record"/"start recording" intent on the currently open patient (refuses
   *     honestly when no patient is open).
   *   - NEW chained commands: "open James Smith and record", "open Jones then start a
   *     visit", up to 3 legs split on and/then. The WHOLE chain is refused if ANY leg is
   *     sign/order/submit-shaped (safety first). Unrecognized legs get an honest
   *     "didn't catch" instead of silent drops.
   *   - voice-start-visit now uses the same verified id-based open (was: hero-label fill
   *     only, which left the active-patient pointer -- and therefore Copilot context --
   *     on the PREVIOUS patient).
   */
  /* cv2-1.1.1: intent replies echo into the shared conversation thread (chat feel on
   *   both surfaces, not toast-only), and speech output only plays while voice mode is
   *   actually listening (typed commands no longer talk back unexpectedly). */
  var ASSET = 'feat_mls_copilot_voice_v2.js';
  var BTN_ID = 'mlsCopVoiceBtn';
  var STYLE_ID = 'mlsVoiceV2Style';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function activePatientId() {
    return S(safe(function () {
      if (isFn(window.getActivePtId)) return window.getActivePtId() || '';
      var p = isFn(window.activePatient) ? window.activePatient() : null;
      return p && p.id != null ? p.id : '';
    }, ''));
  }
  function captureVoiceActionToken() {
    var binding = safe(function () { return (typeof currentVisitAthenaBinding !== 'undefined') ? currentVisitAthenaBinding : null; }, null);
    var epoch = safe(function () { return (typeof currentVisitAthenaEpoch !== 'undefined') ? Number(currentVisitAthenaEpoch) : null; }, null);
    return {
      patientId: activePatientId(),
      binding: binding,
      bindingId: S((binding && binding.id) || ''),
      epoch: epoch
    };
  }
  function voiceActionTokenStillSafe(token) {
    if (!token || activePatientId() !== token.patientId) return false;
    var current = safe(function () { return (typeof currentVisitAthenaBinding !== 'undefined') ? currentVisitAthenaBinding : null; }, null);
    var epoch = safe(function () { return (typeof currentVisitAthenaEpoch !== 'undefined') ? Number(currentVisitAthenaEpoch) : null; }, null);
    if (S((current && current.id) || '') !== token.bindingId) return false;
    if ((token.epoch == null) !== (epoch == null)) return false;
    if (token.epoch != null && Number(token.epoch) !== Number(epoch)) return false;
    if (token.binding) {
      if (!isFn(window._athenaAsyncBindingStillSafe)) return false;
      return safe(function () { return window._athenaAsyncBindingStillSafe(token.binding, 'voice command chain', token.epoch) === true; }, false);
    }
    return true;
  }
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
      '#' + BTN_ID + '{position:fixed;left:12px;bottom:14px;z-index:99997;display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border:0;border-radius:999px;background:linear-gradient(135deg,#7A5CC0,#2E6A4B);color:#fff;font:800 14px system-ui;box-shadow:0 8px 24px rgba(124,58,237,.45);cursor:pointer}',
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
  var recSessionEpoch = 0;
  var deniedPermanently = false;
  var unregisterSpeech = null;
  /* A cold page can hear speech before the enhanced assistant bridge is
     ready. Keep a small, short-lived FIFO instead of dropping the utterance.
     Every entry freezes its patient/visit owner and recognition session; it
     is removed before its one permitted dispatch, so a thrown/late handler
     can never cause an automatic duplicate action. */
  var ASSISTANT_QUEUE_MAX = 4;
  var ASSISTANT_QUEUE_TTL_MS = 10000;
  var pendingAssistant = [];
  var pendingAssistantSeq = 0;

  function assistantBridge() {
    return safe(function () {
      var fx = window.__mlsAsstFix;
      return fx && fx.installed === true && isFn(fx._handleSend) && isFn(fx.registerIntent) ? fx : null;
    }, null);
  }
  function clearPendingAssistant() {
    var count = pendingAssistant.length;
    pendingAssistant.length = 0;
    return count;
  }
  function queueAssistantText(text) {
    text = S(text).trim();
    if (!text) return false;
    var dropped = 0;
    while (pendingAssistant.length >= ASSISTANT_QUEUE_MAX) {
      pendingAssistant.shift();
      dropped++;
    }
    pendingAssistant.push({
      id: ++pendingAssistantSeq,
      text: text,
      owner: captureVoiceActionToken(),
      sessionEpoch: recSessionEpoch,
      expiresAt: Date.now() + ASSISTANT_QUEUE_TTL_MS
    });
    if (dropped) speakToast('The assistant queue was full, so I did not run the oldest command. I saved the newest command while setup finishes.');
    else speakToast('The full assistant is finishing setup. I saved that command and will run it once if the assistant becomes ready.');
    return true;
  }
  /* Returns sent / not-ready / failed. A failed call is never retried because
     the receiver may have started an action before throwing. */
  function chainParts(text) {
    var s = S(text).trim();
    if (refusalShaped(s)) return null;
    var parts = s.split(/\s+(?:and\s+then|then|and)\s+/i).map(function (p) { return p.trim(); }).filter(Boolean);
    if (parts.length < 2 || parts.length > 3) return null;
    var probe = parts[0];
    var understood = refusalShaped(probe) ||
      /^(?:please\s+)?(?:open|pull up|bring up|switch to|select|show me|show|load|record|start|begin|stop|end|finish|generate|write|create|make|go to|navigate to|read|play)\b/i.test(probe);
    return understood ? parts : null;
  }
  function dispatchAssistantText(text) {
    var fx = assistantBridge();
    if (!fx) return 'not-ready';
    registerIntents();
    /* cv2-1.2.0: deterministic visit commands run LOCALLY and never enter the
       chat path. Routing them through the assistant meant the panel popped
       open on every spoken command, and any intent-registry reset dropped the
       words into the Copilot AI, which would REPLY "started recording"
       without starting anything. Only text no local leg understands is a real
       chat question, and only that still opens the assistant panel. */
    var parts = chainParts(text);
    if (parts) { runVoiceChain(parts); return 'sent'; }
    var local = runLeg(text);
    if (local !== 'unknown') return 'sent';
    try {
      var p = $('mlsAsstPanel');
      if (!p || getComputedStyle(p).display === 'none') { var fab = $('mlsAsstFab'); if (fab) fab.click(); }
    } catch (e0) {}
    try { fx._handleSend(text); return 'sent'; }
    catch (e1) { return 'failed'; }
  }
  function flushPendingAssistant() {
    var now = Date.now(), expired = 0, ownerChanged = 0;
    while (pendingAssistant.length) {
      var head = pendingAssistant[0];
      if (now >= head.expiresAt) { pendingAssistant.shift(); expired++; continue; }
      if (head.sessionEpoch !== recSessionEpoch || !voiceActionTokenStillSafe(head.owner)) {
        pendingAssistant.shift(); ownerChanged++; continue;
      }
      break;
    }
    if (expired) speakToast('The assistant did not finish loading in time, so I did not run ' + (expired === 1 ? 'that command' : 'those commands') + '. Refresh MLS and try again. Recording controls still work.');
    if (ownerChanged) speakToast('The patient, visit, or voice session changed, so I canceled ' + (ownerChanged === 1 ? 'the queued assistant command' : 'the queued assistant commands') + ' before anything ran.');
    if (!pendingAssistant.length || !assistantBridge()) return false;

    /* Remove before dispatch: exactly one call is allowed for this entry. */
    var item = pendingAssistant.shift();
    var outcome = dispatchAssistantText(item.text);
    if (outcome === 'not-ready') {
      /* No receiver was called, so placing it back at the head is safe. */
      pendingAssistant.unshift(item);
      return false;
    }
    if (outcome === 'failed') speakToast('The assistant handoff failed after it started, so I did not retry the command and risk running it twice. Please check the assistant panel.');
    return outcome === 'sent';
  }

  function SR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }
  function speechHub() {
    try { if (typeof window.mlsSpeechHub === 'function') return window.mlsSpeechHub(); } catch (e) {}
    try { if (window.__mlsSpeechHub && isFn(window.__mlsSpeechHub.claim)) return window.__mlsSpeechHub; } catch (e2) {}
    return null;
  }
  function registerSpeech() {
    var h = speechHub();
    if (!h || unregisterSpeech) return h;
    unregisterSpeech = h.register('copilot', 'MLS Copilot Voice', function (handoff) {
      enabled = false;
      var previous = rec;
      var stopNow = function () {
        var canceled = stopRec(true);
        if (canceled) toast('Copilot Voice stopped, so the queued assistant command was canceled before anything ran.');
        paintBtn($(BTN_ID));
      };
      if (handoff && handoff.pending) { stopNow(); return; }
      if (previous && typeof h.waitForEnd === 'function') return h.waitForEnd(previous, stopNow);
      stopNow();
    });
    return h;
  }
  function releaseSpeech() { safe(function () { var h = speechHub(); if (h) h.release('copilot'); }); }

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
    var h = registerSpeech();
    var lease = h ? h.claim('copilot') : { ok: true, previous: null };
    if (!lease || lease.ok === false) {
      toast('Copilot Voice could not take control of the microphone. Try again.');
      return false;
    }
    if (lease.previous) toast('Stopped ' + lease.previous.label + ' so Copilot Voice can use the microphone. Any visit transcript already captured is safe.');
    var instance;
    try { instance = new Ctor(); rec = instance; }
    catch (e0) {
      rec = null; releaseSpeech();
      toast('Copilot Voice could not create the microphone listener. Try again.');
      return false;
    }
    var sessionEpoch = ++recSessionEpoch;
    instance.lang = 'en-US';
    instance.continuous = true;
    instance.interimResults = false;
    instance.onresult = function (ev) {
      if (!enabled || instance !== rec || sessionEpoch !== recSessionEpoch) return;
      try {
        for (var i = ev.resultIndex; i < ev.results.length; i++) {
          if (!enabled || instance !== rec || sessionEpoch !== recSessionEpoch) break;
          if (!ev.results[i].isFinal) continue;
          var said = S(ev.results[i][0] && ev.results[i][0].transcript).trim();
          if (said) handleSaid(said);
        }
      } catch (e) {}
    };
    instance.onerror = function (ev) {
      if (instance !== rec || sessionEpoch !== recSessionEpoch) return;
      var err = ev && ev.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        deniedPermanently = true; enabled = false;
        recSessionEpoch++; releaseSpeech(); rec = null;
        var deniedCanceled = clearPendingAssistant();
        toast('Microphone was blocked. Allow mic access for this site, then click MLS Copilot Voice again.' + (deniedCanceled ? ' The queued assistant command was canceled.' : ''));
        speak('Microphone access is blocked. Please allow it, then try again.');
        paintBtn($(BTN_ID));
        return;
      }
      if (err === 'no-speech') { return; } /* keep listening, this is normal and expected */
      if (err === 'audio-capture') {
        enabled = false;
        recSessionEpoch++; releaseSpeech(); rec = null;
        var audioCanceled = clearPendingAssistant();
        toast('No microphone found -- check your input device, then try again.' + (audioCanceled ? ' The queued assistant command was canceled.' : ''));
        paintBtn($(BTN_ID));
        return;
      }
      /* network / aborted / other -- onend will decide whether to restart */
    };
    instance.onend = function () {
      if (instance === rec && sessionEpoch === recSessionEpoch && enabled && !deniedPermanently) {
        setTimeout(function () {
          if (!enabled || instance !== rec || sessionEpoch !== recSessionEpoch) return;
          try { instance.start(); }
          catch (e) {
            if (instance !== rec || sessionEpoch !== recSessionEpoch) return;
            enabled = false; rec = null; recSessionEpoch++; releaseSpeech();
            var restartCanceled = clearPendingAssistant();
            toast('Copilot Voice could not restart the microphone. Wait a moment, then tap it again.' + (restartCanceled ? ' The queued assistant command was canceled.' : ''));
            paintBtn($(BTN_ID));
          }
        }, 250);
      }
    };
    var beginFailed = false;
    var begin = function () {
      if (!enabled || instance !== rec || sessionEpoch !== recSessionEpoch) return;
      try { instance.start(); }
      catch (e1) {
        beginFailed = true;
        if (instance === rec) rec = null;
        enabled = false; recSessionEpoch++; releaseSpeech();
        var startCanceled = clearPendingAssistant();
        toast('Copilot Voice could not start the microphone. Wait a moment, then tap it again.' + (startCanceled ? ' The queued assistant command was canceled.' : ''));
        paintBtn($(BTN_ID));
      }
    };
    if (lease && typeof lease.whenReady === 'function') {
      if (!lease.whenReady(begin)) {
        beginFailed = true;
        enabled = false;
        stopRec();
      }
    } else begin();
    return !beginFailed && enabled && rec === instance;
  }
  function stopRec(preserveEndHandler) {
    var old = rec;
    recSessionEpoch++;
    rec = null;
    var canceled = clearPendingAssistant();
    safe(function () { if (old) { if (!preserveEndHandler) old.onend = null; old.onresult = null; old.onerror = null; old.stop(); } });
    releaseSpeech();
    return canceled;
  }

  function setEnabled(on, btn) {
    enabled = !!on;
    btn = btn || $(BTN_ID);
    if (enabled) {
      var ok = startRec();
      if (ok) { toast('Listening -- say things like "open James Smith and record", "pull today’s patients", "start a visit for Jones", "generate the note", or "go to history".'); speak('Listening.'); }
      else enabled = false;
    } else {
      var canceled = stopRec();
      toast(canceled ? 'Voice control off. The queued assistant command was canceled before anything ran.' : 'Voice control off.');
    }
    paintBtn(btn);
  }

  function handleSaid(text) {
    safe(function () {
      if (/\bstop listening\b|\bturn off voice\b/i.test(text)) { setEnabled(false); return; }
      var dispatched = dispatchAssistantText(text);
      if (dispatched === 'sent') return;
      if (dispatched === 'failed') {
        speakToast('The assistant handoff failed after it started, so I did not retry the command and risk running it twice. Please check the assistant panel.');
        return;
      }
      /* The assistant bridge can load after the mic. Deterministic voice
         controls must still work during that window instead of dropping the
         utterance or claiming the assistant is unavailable. */
      if (/^(?:hello|hi|hey)(?:\s+(?:there|mls))?|^(?:hello\s+)?are\s+you\s+working\??$/i.test(S(text).trim())) {
        speakToast('I am here. You can say "start recording", "stop recording", "generate the note", or "open" and a patient name.');
        return;
      }
      var local = runLeg(text);
      if (local === 'unknown') {
        queueAssistantText(text);
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
  function latestSavedNote() {
    var ap = safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null);
    if (!ap || ap.id == null) return null;
    var notes = safe(function () {
      if (isFn(window.patientNotes)) return window.patientNotes(ap.id) || [];
      if (isFn(window.getNotes)) return (window.getNotes() || []).filter(function (n) { return String(n.patientId || '') === String(ap.id); });
      return [];
    }, []) || [];
    notes = notes.slice().sort(function (a, b) { return Number(b.updated || b.created || 0) - Number(a.updated || a.created || 0); });
    /* Prefer an actual generated/saved note over a newer transcript-only draft.
       A draft is still a useful fallback when it is all this patient has. */
    var finished = notes.filter(function (n) { return n && !n.isDraft; });
    if (finished.length) notes = finished;
    for (var i = 0; i < notes.length; i++) {
      var n = notes[i] || {};
      var text = S(n.soap || n.text || n.note || n.transcript || '').trim();
      if (text) return { text: text, patient: S(ap.name || n.patient || ''), draft: !!n.isDraft };
    }
    return null;
  }
  function readNoteAloud() {
    var box = $('noteBox');
    var text = box ? S(box.value).trim() : '';
    var saved = null;
    if (!text) { saved = latestSavedNote(); text = saved ? saved.text : ''; }
    if (!text) { toast('There is no current or saved note for this patient to read back.'); speak('There is no current or saved note for this patient to read back.'); return false; }
    toast(saved ? 'Reading the latest saved note for ' + (saved.patient || 'this patient') + '.' : 'Reading the current note aloud.');
    speak(text.slice(0, 4000));
    return true;
  }

  function visitRecordingNow() {
    return safe(function () {
      if (typeof capturing !== 'undefined' && capturing) return true;
      var b = $('captureBtn');
      return !!(b && (b.classList.contains('recording') || /recording|stop visit|stop recording/i.test(b.textContent || '')));
    }, false);
  }
  function monitorVoiceGeneration(before) {
    var started = Date.now(), iv = setInterval(function () {
      var gb = $('genBtn');
      if (gb && gb.disabled) {
        if (Date.now() - started < 120000) return;
        clearInterval(iv);
        speakToast('The note is still generating. Keep this page open and watch the status message.');
        return;
      }
      clearInterval(iv);
      var after = S(($('noteBox') || {}).value || '').trim();
      if (after && after !== before) speakToast('The note is ready. Review it before signing or sending anything.');
      else if (!after) speakToast('Generation ended without a note. Check the on-screen status, then try again.');
      else speakToast('Generation finished, but the note text did not change. Review the on-screen status before continuing.');
    }, 500);
  }
  function requestVoiceGeneration() {
    if (visitRecordingNow()) {
      speakToast('Stop recording first. Your transcript will stay safe, then say "generate the note" again.');
      return 'fail';
    }
    var transcript = S(($('transcript') || {}).value || '').trim();
    if (!transcript) {
      speakToast('There is no visit text yet. Record, dictate, type, or paste the visit first.');
      return 'fail';
    }
    var gb = $('genBtn');
    if (!isFn(window.generateNote) || !gb || gb.disabled) {
      speakToast(gb && gb.disabled ? 'A note is already generating. Wait for it to finish.' : 'Note generation is not ready yet. Try again in a moment.');
      return 'fail';
    }
    var before = S(($('noteBox') || {}).value || '').trim();
    try { window.generateNote(); }
    catch (e) {
      speakToast('The note could not start generating. Your transcript is still safe.');
      return 'fail';
    }
    var after = S(($('noteBox') || {}).value || '').trim();
    if (gb.disabled) {
      speakToast('Note generation started from the saved transcript.');
      monitorVoiceGeneration(before);
      return 'ok';
    }
    if (after && after !== before) {
      speakToast('The note is ready. Review it before signing or sending anything.');
      return 'ok';
    }
    speakToast('Note generation did not start. Check the on-screen message or account settings, then try again.');
    return 'fail';
  }

  /* ---------------- cv2-1.1.0: smart patient matching + verified open ---------------- */
  function allKnownPatients() {
    var out = [], seen = {};
    safe(function () {
      var ps = (window.getPatients && window.getPatients()) || [];
      for (var i = 0; i < ps.length; i++) {
        var p = ps[i]; if (!p || p.id == null || !p.name) continue;
        var k = S(p.id); if (seen[k]) continue; seen[k] = 1;
        out.push({ id: p.id, name: S(p.name), dob: S(p.dob || '') });
      }
    });
    safe(function () {
      var list = (window.__mlsWhosNext && window.__mlsWhosNext.activeList && window.__mlsWhosNext.activeList()) || [];
      for (var i = 0; i < list.length; i++) {
        var p = list[i]; if (!p || !p.name) continue;
        var k = S(p.id == null ? ('wn:' + p.name) : p.id); if (seen[k]) continue; seen[k] = 1;
        out.push({ id: p.id, name: S(p.name), dob: S(p.dob || '') });
      }
    });
    return out;
  }
  function normName(s) {
    s = S(s).toLowerCase().replace(/[^a-z ,'-]/g, ' ').replace(/\s+/g, ' ').trim();
    /* fold "last, first" into "first last" so both storage shapes compare equal */
    var m = s.match(/^([a-z' -]+),\s*([a-z' -]+)$/);
    if (m) s = (m[2].trim() + ' ' + m[1].trim()).replace(/\s+/g, ' ');
    return s;
  }
  /* -> { match: p|null, candidates: [p,...] } ; exact full-name beats substring;
     multiple hits are returned for an explicit refusal, NEVER first-match-wins. */
  function findPatientsSmart(nameRaw) {
    var want = normName(nameRaw);
    if (!want) return { match: null, candidates: [] };
    var all = allKnownPatients(), exact = [], partial = [];
    for (var i = 0; i < all.length; i++) {
      var have = normName(all[i].name);
      if (!have) continue;
      if (have === want) exact.push(all[i]);
      else if (have.indexOf(want) >= 0 || want.indexOf(have) >= 0) partial.push(all[i]);
    }
    var pool = exact.length ? exact : partial;
    if (pool.length === 1) return { match: pool[0], candidates: pool };
    return { match: null, candidates: pool };
  }
  /* REAL, verified selection: the base selectPatient() first (proven live), then the
     older pick surfaces; hero fields synced after so the EZ3 label agrees. */
  function openPatientVerified(p) {
    var ok = false;
    safe(function () { if (isFn(window.selectPatient)) { window.selectPatient(p.id); ok = true; } });
    if (!ok) safe(function () { if (window.__mlsPick && isFn(window.__mlsPick.select)) { window.__mlsPick.select(p.id); ok = true; } });
    if (!ok) safe(function () { if (isFn(window.openPatient)) { window.openPatient(p.id); ok = true; } });
    loadPatient(p);
    var active = safe(function () { return isFn(window.getActivePtId) ? S(window.getActivePtId()) : ''; }, '');
    return ok && (!active || active === S(p.id)) ? (active === S(p.id) ? 'verified' : 'opened') : (ok ? 'unverified' : 'failed');
  }
  function describeCandidates(cands) {
    var bits = [];
    for (var i = 0; i < Math.min(3, cands.length); i++) bits.push(cands[i].name + (cands[i].dob ? (' (DOB ' + cands[i].dob + ')') : ''));
    return bits.join(', ') + (cands.length > 3 ? (' and ' + (cands.length - 3) + ' more') : '');
  }

  /* ---------------- cv2-1.1.0: leg handlers (single commands, chainable) ---------------- */
  function refusalShaped(s) {
    s = S(s);
    return /\bsign\b.*\b(it|the note|the chart|this)\b/i.test(s) ||
      /\b(submit|place|put in)\b.*\border/i.test(s) ||
      /\be-?sign\b/i.test(s) ||
      /\bfinalize\b.*\b(chart|encounter|note)\b/i.test(s) ||
      /\battest\b/i.test(s);
  }
  /* cv2-1.1.1: intent replies must feel like CHAT, not just toasts -- echo into the
     shared conversation so both surfaces show an answer bubble (matches the asst_fix
     builtins' addAi behavior), and only speak aloud when voice mode is actually on. */
  function speakToast(msg) {
    toast(msg);
    safe(function () {
      var c = window.__mlsCopilotConvo;
      if (c && isFn(c.append)) c.append('ai', msg);
    });
    if (enabled) speak(msg);
  }
  function legOpenPatient(q) {
    var m = S(q).trim().match(/^(?:please\s+)?(?:open|pull up|bring up|switch to|select|show me|show|load)\s+(?:the\s+)?(?:patient\s+|chart\s+(?:for|of)\s+)?(.+?)(?:'s)?(?:\s+(?:chart|file|record|profile|page))?\s*$/i);
    if (!m) return false;
    var token = m[1].trim();
    if (VIEW_ALIASES[token.toLowerCase()]) return false;          /* "open history" etc. -> navigation intent */
    if (/^athena(one)?$/i.test(token)) return false;               /* "open athena" -> builtin */
    var r = findPatientsSmart(token);
    if (!r.match && r.candidates.length === 0) {
      speakToast('I could not find a patient named "' + token + '". Say the full name, or pull the schedule first.');
      return 'fail';   /* handled, but the open did NOT happen -- a chain must abort */
    }
    if (!r.match) {
      speakToast('I found ' + r.candidates.length + ' patients matching "' + token + '": ' + describeCandidates(r.candidates) + '. Say the full name so I open the right chart.');
      return 'fail';
    }
    var how = openPatientVerified(r.match);
    if (how !== 'verified' && how !== 'opened') {
      /* NEVER claim an open that did not land (the active pointer must agree) */
      speakToast('I could not switch to ' + r.match.name + ' -- open the Patients tab and tap their card, then say "record".');
      return 'fail';
    }
    speakToast('Opened ' + r.match.name + (r.match.dob ? (', date of birth ' + r.match.dob) : '') + '.');
    return 'ok';
  }
  function consentGatePending() {
    return safe(function () {
      var d = document.getElementById('_mlsAskDialog');
      return !!(d && /consent/i.test(d.textContent || ''));
    }, false);
  }
  /* cv2-1.2.0: never claim "recording" without looking. startCapture() fails
     closed into the consent dialog (and the scheduled-appointment gates) and
     returns without capturing; the old unconditional success line told the
     user recording had started when nothing was running. */
  function startCaptureVerified(apName) {
    safe(function () { if (isFn(window.startCapture)) window.startCapture(); else if (isFn(window.heroStartVisit)) window.heroStartVisit(); });
    setTimeout(function () {
      if (visitRecordingNow()) { speakToast('Recording for ' + apName + '. Say "stop recording" when done.'); return; }
      if (consentGatePending()) { speakToast('One step first: confirm the on-screen consent for ' + apName + ', then recording will start.'); return; }
      speakToast('Recording did not start for ' + apName + '. Check the on-screen message, then use the Record button.');
    }, 900);
    return 'ok';
  }
  function legRecordNow(q) {
    if (!/^(?:please\s+)?(?:record|start\s+recording|begin\s+recording|(?:start|begin)\s+(?:a\s+|the\s+)?(?:visit|capture|recording)|record\s+(?:the\s+)?visit)$/i.test(S(q).trim())) return false;
    var ap = safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null);
    if (!ap || !ap.name) { speakToast('No patient is open yet -- say "open" and the patient\'s name first.'); return 'fail'; }
    safe(function () { if (isFn(window.showView)) window.showView('visit'); });
    return startCaptureVerified(ap.name);
  }
  function legStop(q) {
    if (!/^(?:please\s+)?(?:stop|end|finish)(?:\s+the)?\s+(?:recording|capture|visit)$/i.test(S(q).trim())) return false;
    safe(function () { if (isFn(window.stopCapture)) window.stopCapture(); });
    speakToast('Recording stopped. Say "generate the note" when ready.');
    return true;
  }
  function legGenerate(q) {
    if (!/^(?:please\s+)?(?:generate|write|create|make)(?:\s+(?:the|my|a))?\s+note$/i.test(S(q).trim())) return false;
    safe(function () { if (isFn(window.showView)) window.showView('visit'); });
    return requestVoiceGeneration();
  }
  function legNavigate(q) {
    var m = S(q).trim().match(/^(?:please\s+)?(?:go to|open|show|navigate to)\s+(?:the\s+)?([a-z ]+?)(?:\s+tab| view)?$/i);
    if (!m) return false;
    var view = VIEW_ALIASES[m[1].trim().toLowerCase()];
    if (!view) return false;
    safe(function () { if (isFn(window.showView)) window.showView(view); });
    toast('Opened ' + m[1].trim() + '.');
    return true;
  }
  function legRead(q) {
    if (!/\b(read|play)\b.*\b(note|history|back)\b/i.test(S(q).trim())) return false;
    readNoteAloud();
    return true;
  }
  function runLeg(text) {
    if (refusalShaped(text)) {
      speakToast('Signing, ordering, and submitting must be done manually in athenaOne. I will not do that part.');
      return 'refused';
    }
    var r;
    r = legOpenPatient(text); if (r) return r === 'ok' ? 'ok' : 'fail';
    r = legRecordNow(text); if (r) return r === 'ok' ? 'ok' : 'fail';
    if (legStop(text)) return 'ok';
    r = legGenerate(text); if (r) return r === 'ok' ? 'ok' : 'fail';
    if (legRead(text)) return 'ok';
    if (legNavigate(text)) return 'ok';
    return 'unknown';
  }

  function runVoiceChain(parts) {
    var i = 0, expectedToken = null;
    var step = function () {
      if (expectedToken && !voiceActionTokenStillSafe(expectedToken)) {
        speakToast('The patient or visit changed, so I stopped the rest of that command.');
        return;
      }
      if (i >= parts.length) return;
      var leg = parts[i]; i++;
      var out = runLeg(leg);
      if (out === 'refused') return;
      if (out === 'fail') {
        if (i < parts.length) speakToast('I stopped there, so the rest of that command did not run.');
        return;
      }
      if (out === 'unknown') speakToast('I did not catch the part "' + leg + '" -- try it as its own command.');
      expectedToken = captureVoiceActionToken();
      if (i < parts.length) setTimeout(step, 600);
    };
    step();
    return true;
  }

  /* ---------------- register new deterministic intents ---------------- */
  var unregs = [], registered = false;
  function registerIntents() {
    if (registered) return true;
    var fx = assistantBridge();
    if (!fx) return false;
    var registrationStart = unregs.length;
    try {

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
      if (m[1]) {
        /* cv2-1.1.0: verified id-based open with ambiguity refusal (was hero-label
           fill only, which left the active-patient pointer on the previous patient) */
        var r = findPatientsSmart(m[1]);
        if (!r.match && r.candidates.length === 0) { speakToast('Could not find "' + m[1] + '" -- pull today’s patients first, or tap their card in Who’s Next.'); return true; }
        if (!r.match) { speakToast('I found ' + r.candidates.length + ' patients matching "' + m[1] + '": ' + describeCandidates(r.candidates) + '. Say the full name.'); return true; }
        var how = openPatientVerified(r.match);
        if (how !== 'verified' && how !== 'opened') { speakToast('I could not switch to ' + r.match.name + ' -- tap their card, then say "record".'); return true; }
      }
      var apName = safe(function () {
        var ap = isFn(window.activePatient) ? window.activePatient() : null;
        return (ap && ap.name) ? S(ap.name) : '';
      }, '') || (m[1] ? S(m[1]).trim() : 'this visit');
      startCaptureVerified(apName);
      return true;
    }, true));

    /* cv2-1.1.0: single "open <patient>" (no "chart" keyword needed), verified + ambiguity-safe */
    unregs.push(fx.registerIntent('voice-open-patient', function (q) {
      if (refusalShaped(q)) return false; /* let the safety intent answer */
      return legOpenPatient(q);
    }, true));

    /* cv2-1.1.0: "record" / "start recording" on the currently open patient */
    unregs.push(fx.registerIntent('voice-record-now', function (q) {
      if (refusalShaped(q)) return false;
      return legRecordNow(q);
    }, true));

    /* cv2-1.1.0: CHAINED commands -- "open James Smith and record", up to 3 legs.
       Registered last-with-atFront so it runs FIRST; a non-chain returns false fast. */
    unregs.push(fx.registerIntent('voice-chain', function (q) {
      var s = S(q).trim();
      if (refusalShaped(s)) return false;                       /* whole chain refusal-shaped -> safety intent */
      var parts = s.split(/\s+(?:and\s+then|then|and)\s+/i).map(function (p) { return p.trim(); }).filter(Boolean);
      if (parts.length < 2 || parts.length > 3) return false;
      /* the first leg must be something we understand, else this isn't a command chain */
      var probe = parts[0];
      var understood = refusalShaped(probe) ||
        /^(?:please\s+)?(?:open|pull up|bring up|switch to|select|show me|show|load|record|start|begin|stop|end|finish|generate|write|create|make|go to|navigate to|read|play)\b/i.test(probe);
      if (!understood) return false;
      return runVoiceChain(parts);
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
      requestVoiceGeneration();
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
      for (var i = registrationStart; i < unregs.length; i++) {
        if (!isFn(unregs[i])) throw new Error('assistant intent registration did not return an unregister function');
      }
      registered = true;
      return true;
    } catch (e) {
      /* Roll back every registration from this attempt before the next tick
         retries, so partial startup cannot create duplicate intent actions. */
      for (var j = unregs.length - 1; j >= registrationStart; j--) safe(unregs[j]);
      unregs.length = registrationStart;
      registered = false;
      return false;
    }
  }

  /* ---------------- boot / revert ---------------- */
  var bootIv = null;
  function tick() {
    safe(css); safe(ensureBtn); safe(registerIntents); safe(flushPendingAssistant);
    /* Consume a click made during the legacy-shell -> V2 hand-off. This keeps
       one voice controller and one microphone lease while making the very
       first click reliable on a cold asset load. */
    if (window.__mlsVoiceStartWhenReady) {
      window.__mlsVoiceStartWhenReady = false;
      var queuedBtn = $(BTN_ID);
      if (queuedBtn && !enabled) safe(function () { queuedBtn.click(); });
    }
  }
  function boot() {
    retireOld();
    tick();
    bootIv = setInterval(tick, 1200);
  }
  function revert() {
    if (bootIv) { clearInterval(bootIv); bootIv = null; }
    safe(function () { document.removeEventListener('DOMContentLoaded', boot); });
    setEnabled(false);
    safe(function () { if (unregisterSpeech) unregisterSpeech(); });
    unregisterSpeech = null;
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
    _test: {
      runLeg: runLeg,
      runVoiceChain: runVoiceChain,
      findPatientsSmart: findPatientsSmart,
      legOpenPatient: legOpenPatient,
      openPatientVerified: openPatientVerified,
      captureVoiceActionToken: captureVoiceActionToken,
      voiceActionTokenStillSafe: voiceActionTokenStillSafe,
      assistantBridgeReady: function () { return !!assistantBridge(); },
      registerIntents: registerIntents,
      queueAssistantText: queueAssistantText,
      flushPendingAssistant: flushPendingAssistant,
      pendingAssistant: function () { return pendingAssistant.slice(); },
      tick: tick
    },
    isListening: function () { return enabled; },
    start: function () { setEnabled(true); },
    stop: function () { setEnabled(false); },
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else { boot(); }
})();
