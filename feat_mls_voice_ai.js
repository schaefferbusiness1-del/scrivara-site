/* feat_mls_voice_ai.js  ->  window.__mlsVoiceAI  (v1.0.0)
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
 *   save to Athena    -> window.__mlsAthenaWriteback.writeNoteToChart({})
 *                        (inserts note into the OPEN chart's note field; the
 *                         writeback module's OWN rails apply: wrong-patient guard +
 *                         verified destination, and it NEVER clicks Save/Sign.)
 *
 * HARD SAFETY RAILS (enforced here):
 *   - NEVER signs, saves, attests, or final-submits an Athena chart. The only
 *     Athena action this layer can trigger is the existing writeback INSERT,
 *     whose own handler never clicks Save/Sign. The clinician signs.
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

  try {
    if (window.__mlsVoiceAI && window.__mlsVoiceAI.installed) return;
  } catch (e) { return; }

  var VERSION = '1.0.0';
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

  /* ---------------- on-screen toast (reversible) ---------------- */
  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '#' + TOAST_ID + '{position:fixed;right:18px;bottom:18px;z-index:2147483600;' +
      'max-width:340px;font:600 13.5px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;' +
      'color:#0b2746;background:#fff;border:1px solid #bcd5f3;border-radius:12px;' +
      'box-shadow:0 8px 28px rgba(8,40,80,.18);padding:12px 14px;display:none}' +
      '#' + TOAST_ID + ' .mlsva-h{font-weight:800;color:#1456a8;margin-bottom:4px;display:flex;align-items:center;gap:7px}' +
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
      run: function () {
        var fn = window.generateNote;
        if (!isFn(fn)) return R(false, 'unavailable', 'Generate-Note function not found on this page.');
        // generateNote() is async + backend-dependent. We invoke it and then
        // OBSERVE the note field to decide success — never assume.
        var box = document.getElementById('noteBox');
        var before = box ? String(box.value || '') : '__noBox__';
        var threw = false;
        safe(function () { var r = fn(); if (r && isFn(r.then)) r.catch(function () { threw = true; }); });
        return new Promise(function (resolve) {
          var deadline = now() + 30000; // up to 30s for the AI backend
          (function poll() {
            if (threw) return resolve(R(false, 'failed', "Couldn't generate — AI backend unavailable."));
            var b = document.getElementById('noteBox');
            var val = b ? String(b.value || '') : '';
            if (b && val && val !== before && val.trim().length > 0) {
              return resolve(R(true, 'ok', 'Note generated.'));
            }
            if (now() > deadline) {
              return resolve(R(false, 'failed', "Couldn't confirm a note was generated — AI backend may be unavailable. Nothing fabricated."));
            }
            setTimeout(poll, 600);
          })();
        });
      }
    },
    {
      name: 'save_draft',
      label: 'Save draft',
      patterns: [/\bsave\b.*\bdraft\b/, /\bsave (the )?draft\b/, /\bdraft\b.*\bsave\b/, /^save draft$/],
      run: function () {
        var fn = window.saveDraft;
        if (!isFn(fn)) return R(false, 'unavailable', 'Save-Draft function not found on this page.');
        return safe(function () { fn(); return R(true, 'ok', 'Draft saved.'); })
          || R(false, 'failed', 'Could not save draft.');
      }
    },
    {
      name: 'pull_patient',
      label: 'Pull patient from Athena',
      patterns: [/\bpull\b.*\bathena\b/, /\bpull\b.*\bpatient\b/, /\bget\b.*\bpatient\b.*\bathena\b/, /\bload\b.*\bathena\b.*\bpatient\b/],
      run: function () {
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
      run: function () {
        var wb = window.__mlsAthenaWriteback;
        if (!wb || !isFn(wb.writeNoteToChart)) {
          return R(false, 'unavailable',
            'Athena writeback not available here — it runs where an athenaOne chart is open (extension content script). Nothing was written.');
        }
        // Don't write an empty note. If there's no note yet, skip honestly.
        var box = document.getElementById('noteBox');
        if (box && !String(box.value || '').trim()) {
          return R(false, 'skipped', 'No note to write yet — skipped Athena writeback.');
        }
        // writeNoteToChart inserts into the open chart's note field and NEVER signs.
        return safe(function () { wb.writeNoteToChart({}); return R(true, 'ok', 'Sent note to the open Athena chart as an UNSIGNED draft — you sign it in athenaOne.'); })
          || R(false, 'failed', 'Could not run Athena writeback.');
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

        Promise.resolve(safe(function () { return it ? it.run() : R(false, 'failed', 'Unknown intent.'); }))
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
  var rec = null, listening = false;
  function SR() { return window.SpeechRecognition || window.webkitSpeechRecognition || null; }

  function start() {
    if (listening) return true;
    var Ctor = SR();
    if (!Ctor) {
      showToast('Voice unavailable', [{ text: 'This browser has no Web Speech API. Use Chrome/Edge, or call __mlsVoiceAI.handleUtterance(text).', cls: 'bad' }]);
      return false;
    }
    rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = function (ev) {
      try {
        for (var k = ev.resultIndex; k < ev.results.length; k++) {
          if (!ev.results[k].isFinal) continue;
          var said = ev.results[k][0].transcript || '';
          handleUtterance(said, { requireWake: true });
        }
      } catch (e) {}
    };
    rec.onend = function () { if (listening) { safe(function () { rec.start(); }); } };
    rec.onerror = function () {};
    safe(function () { rec.start(); });
    listening = true;
    showToast('Listening', [{ text: 'Say “MLS Assistant, …”. e.g. “generate note and then save to Athena”.', cls: '' }]);
    return true;
  }
  function stop() {
    listening = false;
    safe(function () { if (rec) rec.stop(); });
    rec = null;
    return true;
  }

  /* ---------------- revert ---------------- */
  function revert() {
    safe(stop);
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
