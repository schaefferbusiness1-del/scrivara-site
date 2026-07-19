/* feat_mls_voice_ai.js  ->  window.__mlsVoiceAI  (v1.1.2)
 * ==========================================================================
 * VOICE-DRIVEN COMMAND LAYER for the MLSscribe app (mlsscribe.com / ScribeFlow).
 *
 * Turns a spoken (or programmatic) natural-language utterance — including
 * MULTI-STEP chained commands like:
 *     "MLS Assistant, generate note and then save to Athena"
 * into an ORDERED list of intents that are executed in sequence by calling the
 * app's OWN existing functions, with spoken + on-screen feedback between steps.
 *
 * IT WIRES TO THE FUNCTIONS THAT ACTUALLY EXIST IN THE APP (feature-detected):
 *   start recording   -> heroStartVisit()
 *   stop recording    -> stopCapture()
 *   generate the note -> generateNote()           (backend-dependent: degrades honestly)
 *   save draft        -> saveDraft()
 *   pull from Athena  -> pullPatientFromAthenaPrompt()
 *   save to Athena    -> pushEntireVisitToAthena()
 *                        (opens the exact-patient review/confirmation surface;
 *                         voice never bypasses the clinician's final confirm.)
 *
 * HARD SAFETY RAILS (enforced here):
 *   - NEVER bypasses the visible Athena action review. Voice can only open the
 *     exact-patient confirmation surface; the clinician must choose and confirm
 *     any write, save, sign, or billing action on screen.
 *   - HONEST status only. If a step's function is missing, or generation fails
 *     (e.g. AI backend down), the step is reported as failed/skipped with a
 *     truthful reason — it NEVER fabricates success.
 *   - The chain reports per-step which steps succeeded, failed, or were skipped.
 *   - Microphone listening is OPT-IN (window.__mlsVoiceAI.start()). The module
 *     never grabs the mic on load. The parse+execute path is fully usable
 *     WITHOUT audio via window.__mlsVoiceAI.handleUtterance(text) for testing.
 *   - No network calls of its own, no PHI, no keys. It only dispatches to the
 *     app's existing functions.
 *
 * Self-contained, idempotent, additive, reversible:
 *     window.__mlsVoiceAI.revert()
 * Wraps NO existing function (it only calls them), so it cannot recurse with or
 * break any other module. All work in try/catch.
 * ==========================================================================
 */
(function () {
  'use strict';
  var VERSION = '1.1.2';
  var previous = null;
  try { previous = window.__mlsVoiceAI; } catch (e0) {}
  if (previous && previous.installed && previous.version === VERSION) return;
  if (previous) {
    try { if (typeof previous.revert === 'function') previous.revert(); } catch (e1) {}
    try { previous.installed = false; if (window.__mlsVoiceAI === previous) delete window.__mlsVoiceAI; } catch (e2) {}
    try {
      ['mlsVoiceAiToast', 'mlsVoiceAiStyle'].forEach(function (id) {
        var node = document.getElementById(id); if (node && node.remove) node.remove();
      });
    } catch (e3) {}
  }
  var ASSET = 'feat_mls_voice_ai.js';
  var WAKE = 'mls assistant';
  var STYLE_ID = 'mlsVoiceAiStyle';
  var TOAST_ID = 'mlsVoiceAiToast';

  /* ---------------- tiny utils ---------------- */
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function isFn(f) { return typeof f === 'function'; }
  function now() { return Date.now(); }
  function norm(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')   // drop punctuation
      .replace(/\s+/g, ' ')
      .trim();
  }
  function captureVisitToken(actionLabel) {
    var binding = safe(function () { return (typeof currentVisitAthenaBinding !== 'undefined') ? currentVisitAthenaBinding : null; });
    var epoch = safe(function () { return (typeof currentVisitAthenaEpoch !== 'undefined') ? Number(currentVisitAthenaEpoch) : null; });
    if (!binding || !binding.id || epoch == null || !isFinite(epoch)) return null;
    if (!isFn(window._athenaGuardBoundEditor) || window._athenaGuardBoundEditor(actionLabel || 'voice action') !== true) return null;
    return { binding: binding, epoch: epoch };
  }
  function visitTokenStillSafe(token, actionLabel) {
    return !!(token && token.binding && isFn(window._athenaAsyncBindingStillSafe)
      && safe(function () { return window._athenaAsyncBindingStillSafe(token.binding, actionLabel || 'voice action', token.epoch) === true; }));
  }
  var unregisterVoiceSpeech = null;
  function voiceSpeechHub() {
    return safe(function () {
      if (isFn(window.mlsSpeechHub)) return window.mlsSpeechHub();
      if (window.__mlsSpeechHub && isFn(window.__mlsSpeechHub.claim)) return window.__mlsSpeechHub;
      return null;
    });
  }
  function claimVoiceSpeech() {
    var h = voiceSpeechHub();
    if (!h) return { ok: true, previous: null };
    if (!unregisterVoiceSpeech && isFn(h.register)) unregisterVoiceSpeech = h.register('voice-ai', 'MLS Assistant', function (handoff) {
      var previous = rec;
      if (handoff && handoff.pending) return stop();
      if (previous && isFn(h.waitForEnd)) return h.waitForEnd(previous, stop);
      return stop();
    });
    return h.claim('voice-ai');
  }
  function releaseVoiceSpeech() { safe(function () { var h = voiceSpeechHub(); if (h) h.release('voice-ai'); }); }

  /* ---------------- on-screen toast (reversible) ---------------- */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '#' + TOAST_ID + '{position:fixed;right:18px;bottom:18px;z-index:2147483600;' +
      'max-width:340px;font:600 13.5px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'color:#1E2B24;background:#fff;border:1px solid #EAF1EE;border-radius:12px;' +
      'box-shadow:0 8px 28px rgba(8,40,80,.18);padding:12px 14px;display:none}' +
      '#' + TOAST_ID + ' .mlsva-h{font-weight:800;color:#204034;margin-bottom:4px;display:flex;align-items:center;gap:7px}' +
      '#' + TOAST_ID + ' .mlsva-row{margin:3px 0;white-space:normal}' +
      '#' + TOAST_ID + ' .ok{color:#137a3a}#' + TOAST_ID + ' .bad{color:#b42318}#' + TOAST_ID + ' .skip{color:#92690a}';
    (document.head || document.documentElement).appendChild(st);
  }
  function toastEl() {
    var t = document.getElementById(TOAST_ID);
    if (t) return t;
    ensureStyle();
    t = document.createElement('div');
    t.id = TOAST_ID;
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    (document.body || document.documentElement).appendChild(t);
    return t;
  }
  function showToast(title, rows) {
    var t = toastEl();
    var html = '<div class="mlsva-h">🎙 ' + esc(title) + '</div>';
    (rows || []).forEach(function (r) {
      var cls = r.cls || '';
      html += '<div class="mlsva-row ' + cls + '">' + esc(r.text) + '</div>';
    });
    t.innerHTML = html;
    t.style.display = 'block';
    return t;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c];
    });
  }

  /* ---------------- spoken feedback (best-effort) ---------------- */
  function speak(text) {
    safe(function () {
      if (!('speechSynthesis' in window) || !window.SpeechSynthesisUtterance) return;
      if (window.__mlsVoiceAI && window.__mlsVoiceAI._muted) return;
      var u = new SpeechSynthesisUtterance(String(text));
      u.rate = 1.02; u.pitch = 1.0; u.volume = 1.0;
      window.speechSynthesis.speak(u);
    });
  }

  /* ============================================================
   *  INTENT REGISTRY  — each intent feature-detects + dispatches
   *  to the app's REAL function and resolves an honest result:
   *      { ok:boolean, status:'ok'|'failed'|'skipped'|'unavailable', msg:string }
   * ============================================================ */
  function R(ok, status, msg) { return { ok: !!ok, status: status, msg: msg }; }

  var INTENTS = [
    {
      name: 'start_recording',
      label: 'Start recording',
      patterns: [/\bstart(ing)?\b.*\b(record|recording|visit|capture)\b/, /\bbegin\b.*\b(record|recording|visit)\b/, /\b(start|begin) (the )?(visit|recording)\b/, /^record(ing)?$/],
      run: function () {
        var fn = window.heroStartVisit;
        if (!isFn(fn)) return R(false, 'unavailable', 'Recording control not found on this page.');
        return safe(function () { fn(); return R(true, 'ok', 'Recording started.'); })
          || R(false, 'failed', 'Could not start recording.');
      }
    },
    {
      name: 'stop_recording',
      label: 'Stop recording',
      patterns: [/\bstop\b.*\b(record|recording|visit|capture)\b/, /\b(stop|end) (the )?(visit|recording|capture)\b/, /^stop( recording)?$/, /\bend recording\b/],
      run: function () {
        var fn = window.stopCapture;
        if (!isFn(fn)) return R(false, 'unavailable', 'Stop-recording control not found on this page.');
        return safe(function () { fn(); return R(true, 'ok', 'Recording stopped.'); })
          || R(false, 'failed', 'Could not stop recording.');
      }
    },
    {
      name: 'generate_note',
      label: 'Generate note',
      patterns: [/\b(generate|create|make|write|draft|produce)\b.*\bnote\b/, /\bgenerate\b/, /\bnote\b.*\b(generate|create)\b/],
      run: function (chain) {
        var fn = window.generateNote;
        if (!isFn(fn)) return R(false, 'unavailable', 'Generate-Note function not found on this page.');
        var token = captureVisitToken('voice note generation');
        if (!token) return R(false, 'failed', 'Open the correct patient visit before generating. Nothing changed in Athena.');
        if (chain) chain.visitToken = token;
        var verifiedRun;
        try { verifiedRun = fn(); }
        catch (e) { return R(false, 'failed', 'Could not generate the note because the AI request failed.'); }
        return Promise.resolve(verifiedRun).then(function (accepted) {
          if (accepted !== true) return R(false, 'failed', 'Could not confirm a note was generated. The visit may have changed; nothing was sent to Athena.');
          if (!visitTokenStillSafe(token, 'voice note generation')) return R(false, 'failed', 'The patient or visit changed, so the voice chain stopped. Nothing was sent to Athena.');
          return R(true, 'ok', 'Note generated.');
        }, function () { return R(false, 'failed', 'Could not generate the note because the AI request failed.'); });

      }
    },
    {
      name: 'save_draft',
      label: 'Save draft',
      patterns: [/\bsave\b.*\bdraft\b/, /\bsave (the )?draft\b/, /\bdraft\b.*\bsave\b/, /^save draft$/],
      run: function (chain) {
        var fn = window.saveDraft;
        if (!isFn(fn)) return R(false, 'unavailable', 'Save-Draft function not found on this page.');
        var token = (chain && chain.visitToken) || captureVisitToken('voice draft save');
        if (!visitTokenStillSafe(token, 'voice draft save')) return R(false, 'failed', 'The patient or visit changed, so the voice chain stopped before saving.');
        return safe(function () { return fn() === true ? R(true, 'ok', 'Draft saved.') : R(false, 'failed', 'Could not save draft.'); })
          || R(false, 'failed', 'Could not save draft.');

      }
    },
    {
      name: 'pull_patient',
      label: 'Pull patient from Athena',
      patterns: [/\bpull\b.*\bathena\b/, /\bpull\b.*\bpatient\b/, /\bget\b.*\bpatient\b.*\bathena\b/, /\bload\b.*\bathena\b.*\bpatient\b/],
      run: function (chain) {
        if (chain) chain.visitToken = null;
        var fn = window.pullPatientFromAthenaPrompt;
        if (!isFn(fn)) return R(false, 'unavailable', 'Pull-from-Athena function not found on this page.');
        return safe(function () { fn(); return R(true, 'ok', 'Pulling patient from Athena…'); })
          || R(false, 'failed', 'Could not start pull-from-Athena.');
      }
    },
    {
      name: 'save_to_athena',
      label: 'Save to Athena (writeback)',
      patterns: [/\b(save|write|put|insert|send|push)\b.*\bathena\b/, /\bathena\b.*\b(writeback|write back|chart)\b/, /\bto athena\b/],
      run: function (chain) {
        var review = window.pushEntireVisitToAthena;
        if (!isFn(review)) return R(false, 'unavailable', 'Athena review is not available on this page. Nothing was written.');
        var token = (chain && chain.visitToken) || captureVisitToken('voice Athena review');
        if (!visitTokenStillSafe(token, 'voice Athena review')) return R(false, 'failed', 'The patient or visit changed, so the voice chain stopped. Nothing was written.');
        var reviewBox = document.getElementById('noteBox');
        if (reviewBox && !String(reviewBox.value || '').trim()) return R(false, 'skipped', 'No note to review yet. Nothing was written.');
        return safe(function () { review(); return R(true, 'ok', 'Opened the exact-patient Athena review. Choose the action and make the final confirmation on screen.'); })
          || R(false, 'failed', 'Could not open the Athena review. Nothing was written.');

      }
    }
  ];

  function intentByName(n) {
    for (var i = 0; i < INTENTS.length; i++) if (INTENTS[i].name === n) return INTENTS[i];
    return null;
  }

  /* ============================================================
   *  PARSER — utterance -> ordered intents (supports chaining)
   * ============================================================ */
  function stripWake(t) {
    return t.replace(new RegExp('\\b' + WAKE + '\\b[,\\s]*', 'g'), ' ').replace(/\s+/g, ' ').trim();
  }

  function splitSegments(t) {
    // chain connectors: "and then", "then", "after that", "and", commas, semicolons
    var parts = t.split(/\b(?:and then|then|after that|followed by|next)\b|[,;]|\band\b/);
    return parts.map(function (s) { return s.trim(); }).filter(function (s) { return s.length > 0; });
  }

  function matchSegment(seg) {
    for (var i = 0; i < INTENTS.length; i++) {
      var it = INTENTS[i];
      for (var p = 0; p < it.patterns.length; p++) {
        if (it.patterns[p].test(seg)) return it;
      }
    }
    return null;
  }

  /**
   * parse(utterance) -> { wake, body, segments, intents, matched, unmatched }
   */
  function parse(utterance) {
    // Lowercase + drop punctuation EXCEPT comma/semicolon, which are segment
    // delimiters for chaining. (Stripping them before the split would merge steps.)
    var delim = String(utterance == null ? '' : utterance)
      .toLowerCase()
      .replace(/[^a-z0-9\s,;]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    var hadWake = new RegExp('\\b' + WAKE + '\\b').test(delim);
    var body = stripWake(delim);
    var segs = splitSegments(body).map(function (s) { return norm(s); }).filter(Boolean);
    var matched = [], unmatched = [], intents = [];
    segs.forEach(function (seg) {
      var it = matchSegment(seg);
      if (it) { matched.push({ seg: seg, intent: it.name }); intents.push(it.name); }
      else unmatched.push(seg);
    });
    // de-dupe consecutive identical intents
    intents = intents.filter(function (n, i) { return i === 0 || intents[i - 1] !== n; });
    return { wake: hadWake, body: body, segments: segs, intents: intents, matched: matched, unmatched: unmatched };
  }

  /* ============================================================
   *  EXECUTOR — run intents in order, honest per-step feedback
   * ============================================================ */
  function executeChain(intentNames, opts) {
    opts = opts || {};
    var chainContext = { visitToken: null };
    var results = [];
    var rows = [];
    showToast('Running ' + intentNames.length + ' step(s)…', intentNames.map(function (n) {
      var it = intentByName(n); return { text: '• ' + (it ? it.label : n) + ' — queued', cls: '' };
    }));

    return new Promise(function (resolve) {
      var i = 0;
      function step() {
        if (i >= intentNames.length) {
          var okCount = results.filter(function (r) { return r.ok; }).length;
          var summary = okCount + ' of ' + results.length + ' step(s) succeeded.';
          rows.push({ text: '— ' + summary, cls: okCount === results.length ? 'ok' : 'bad' });
          showToast('Done', rows.slice());
          speak(summary);
          return resolve({ ok: okCount === results.length, okCount: okCount, total: results.length, results: results });
        }
        var name = intentNames[i];
        var it = intentByName(name);
        rows.push({ text: '▶ ' + (it ? it.label : name) + '…', cls: '' });
        showToast('Step ' + (i + 1) + ' of ' + intentNames.length, rows.slice());
        speak((it ? it.label : name));

        Promise.resolve(safe(function () { return it ? it.run(chainContext) : R(false, 'failed', 'Unknown intent.'); }))
          .then(function (res) {
            res = res || R(false, 'failed', 'No result.');
            results.push({ intent: name, ok: res.ok, status: res.status, msg: res.msg });
            rows[rows.length - 1] = {
              text: (res.ok ? '✓ ' : (res.status === 'skipped' ? '⤼ ' : '✕ ')) + (it ? it.label : name) + ' — ' + res.msg,
              cls: res.ok ? 'ok' : (res.status === 'skipped' ? 'skip' : 'bad')
            };
            showToast('Step ' + (i + 1) + ' of ' + intentNames.length, rows.slice());
            if (!res.ok) speak(res.msg);
            i++;
            if (!res.ok) {
              /* Stop after a failed prerequisite. Never offer an older note
                 for Athena review after generation or validation was rejected. */
              while (i < intentNames.length) {
                var skippedName = intentNames[i], skippedIntent = intentByName(skippedName);
                var skippedMsg = 'Skipped because the previous step did not complete.';
                results.push({ intent: skippedName, ok: false, status: 'skipped', msg: skippedMsg });
                rows.push({ text: '- ' + (skippedIntent ? skippedIntent.label : skippedName) + ' - ' + skippedMsg, cls: 'skip' });
                i++;
              }
            }
            setTimeout(step, 350);
          });
      }
      step();
    });
  }

  /* ============================================================
   *  PUBLIC ENTRY: handleUtterance(text)  (audio OR programmatic)
   * ============================================================ */
  function handleUtterance(text, opts) {
    opts = opts || {};
    var p = parse(text);
    if (opts.requireWake && !p.wake) return Promise.resolve({ ignored: true, reason: 'no wake word', parse: p });

    if (!p.intents.length) {
      var msg = "Sorry — I couldn't match that to an action.";
      showToast('Heard you, no action matched', [{ text: '“' + (p.body || text) + '”', cls: '' }, { text: msg, cls: 'bad' }]);
      speak(msg);
      return Promise.resolve({ ok: false, parse: p, results: [] });
    }
    return executeChain(p.intents, opts).then(function (r) {
      r.parse = p;
      return r;
    });
  }

  /* ============================================================
   *  MIC MODE (opt-in) — Web Speech API recognition
   * ============================================================ */
  var rec = null, listening = false, voiceSessionEpoch = 0;
  function SR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

  function start() {
    if (listening) return true;
    var Ctor = SR();
    if (!Ctor) {
      showToast('Voice unavailable', [{ text: 'This browser has no Web Speech API. Use Chrome/Edge, or call __mlsVoiceAI.handleUtterance(text).', cls: 'bad' }]);
      return false;
    }
    var lease = claimVoiceSpeech();
    if (!lease || lease.ok === false) return false;
    var instance;
    try { instance = new Ctor(); } catch (e0) { releaseVoiceSpeech(); return false; }
    rec = instance;
    var sessionEpoch = ++voiceSessionEpoch;
    instance.lang = 'en-US';
    instance.continuous = true;
    instance.interimResults = false;
    instance.onresult = function (ev) {
      if (instance !== rec || !listening || sessionEpoch !== voiceSessionEpoch) return;
      try {
        for (var k = ev.resultIndex; k < ev.results.length; k++) {
          if (!ev.results[k].isFinal) continue;
          var said = ev.results[k][0].transcript || '';
          handleUtterance(said, { requireWake: true });
        }
      } catch (e) {}
    };
    instance.onend = function () {
      if (instance === rec && listening && sessionEpoch === voiceSessionEpoch) {
        setTimeout(function () {
          if (instance === rec && listening && sessionEpoch === voiceSessionEpoch) safe(function () { instance.start(); });
        }, 200);
      }
    };
    instance.onerror = function () {};
    /* Publish the active session before start() so immediate result/end events
       cannot be dropped or leave a ghost microphone owner. */
    listening = true;
    showToast('Listening', [{ text: 'Say “MLS Assistant, …”. e.g. “generate note and then save to Athena”.', cls: '' }]);
    var beginFailed = false;
    var begin = function () {
      if (instance !== rec || !listening || sessionEpoch !== voiceSessionEpoch) return;
      try { instance.start(); }
      catch (e1) {
        beginFailed = true;
        if (instance === rec) rec = null;
        listening = false; voiceSessionEpoch++; releaseVoiceSpeech();
      }
    };
    if (lease && isFn(lease.whenReady)) {
      if (!lease.whenReady(begin)) { beginFailed = true; stop(); }
    } else begin();
    return !beginFailed && listening && rec === instance;
  }
  function stop() {
    var old = rec;
    voiceSessionEpoch++;
    listening = false;
    rec = null;
    releaseVoiceSpeech();
    safe(function () { if (old) old.stop(); });
    return true;
  }

  /* ---------------- revert ---------------- */
  function revert() {
    safe(stop);
    safe(function () { if (unregisterVoiceSpeech) unregisterVoiceSpeech(); unregisterVoiceSpeech = null; });
    safe(function () { var t = document.getElementById(TOAST_ID); if (t && t.parentNode) t.parentNode.removeChild(t); });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    try { window.__mlsVoiceAI.installed = false; } catch (e) {}
  }

  /* ---------------- public API ---------------- */
  window.__mlsVoiceAI = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    wakeWord: WAKE,
    _muted: false,
    handleUtterance: handleUtterance,
    parse: parse,
    executeChain: executeChain,
    intents: INTENTS.map(function (i) { return { name: i.name, label: i.label }; }),
    start: start,
    stop: stop,
    revert: revert
  };
})();
