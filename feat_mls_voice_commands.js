/* ============================================================================
 * feat_mls_voice_commands.js  ->  window.__mlsVoice   (vc-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 5: Alexa-style, hands-free voice commands using the Web Speech API.
 *
 *   "MLS Assistant, start recording"  (or plain "start recording")
 *        -> starts recording for the CURRENT active patient (heroStartVisit /
 *           startCapture path), scoping the note to that patient first.
 *   "start my visit"  (or "start visit" / "new visit")
 *        -> starts the visit flow for the active patient (goNewVisitForPatient).
 *
 * GATING: the microphone is NEVER opened automatically. The user must click the
 * voice control (a mic FAB grouped with the "+" Add-patient launcher, and a row
 * injected into the Add-patient modal = the "+ button / menu") to ENABLE voice.
 * Once enabled, the choice persists (localStorage 'mlsVoiceEnabled') so it
 * resumes on reload -- because the user already opted in. Disabling stops the
 * recognizer and releases the mic.
 *
 * MIC CONFLICT: the app's dictation uses its own SpeechRecognition ('recog')
 * while window.capturing is true. Only one recognizer may hold the mic, so this
 * module YIELDS: it stops its command recognizer before triggering dictation
 * and resumes only after dictation ends (watched via the #captureBtn 'recording'
 * class, since 'capturing' is lexically scoped and not on window).
 *
 * Additive, idempotent, reversible (window.__mlsVoice.revert()), ASCII-only.
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsVoice && window.__mlsVoice.installed) return; } catch (e) { return; }

  var VERSION = 'vc-1.0.0';
  var LS_KEY = 'mlsVoiceEnabled';
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;

  var rec = null;            // our command recognizer
  var enabled = false;       // user opted in
  var listening = false;     // recognizer currently running
  var yielding = false;      // paused because dictation owns the mic
  var lastCmd = '';          // debounce
  var lastAt = 0;
  var buf = '';              // rolling transcript buffer for matching
  var bufClearT = 0;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }
  function lsGet(k) { return safe(function () { return localStorage.getItem(k); }, null); }
  function lsSet(k, v) { safe(function () { localStorage.setItem(k, v); }); }
  function toast(msg, kind) {
    safe(function () { if (typeof window.toast === 'function') { window.toast(msg, kind || ''); } });
  }

  /* ---- is the app currently dictating? (capturing is not on window) ---- */
  function appCapturing() {
    var b = gid('captureBtn');
    if (b && /(^|\s)recording(\s|$)/.test(b.className || '')) return true;
    return false;
  }

  /* ---- find/fill the active patient into the record-first hero ---- */
  function fillHeroFromActive() {
    safe(function () {
      var p = (typeof window.activePatient === 'function') ? window.activePatient() : null;
      if (!p) return;
      var n = gid('heroPtName');
      if (n && !String(n.value || '').trim()) {
        n.value = p.name || '';
        n.dispatchEvent(new Event('input', { bubbles: true }));
        n.dispatchEvent(new Event('change', { bubbles: true }));
      }
      var d = gid('heroPtDob');
      if (d && !String(d.value || '').trim() && p.dob) {
        d.value = p.dob;
        d.dispatchEvent(new Event('input', { bubbles: true }));
        d.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  /* ===================== COMMAND ACTIONS ===================== */
  function doStartRecording() {
    // make sure we are on the visit view so the recorder UI exists
    safe(function () { if (typeof window.showView === 'function') window.showView('visit'); });
    fillHeroFromActive();
    // yield the mic to the app's dictation recognizer, then start it
    yieldMicThen(function () {
      var started = safe(function () {
        if (typeof window.heroStartVisit === 'function') { window.heroStartVisit(); return true; }
        if (typeof window.startCapture === 'function') { window.startCapture(); return true; }
        return false;
      }, false);
      var p = safe(function () { return (typeof window.activePatient === 'function') ? window.activePatient() : null; }, null);
      toast(started ? ('Recording started' + (p && p.name ? ' for ' + p.name : '') + '.') : 'Could not start recording here.', started ? 'ok' : 'err');
      // resume command listening once dictation ends
      watchCaptureEnd();
    });
  }

  function doStartVisit() {
    safe(function () {
      var p = (typeof window.activePatient === 'function') ? window.activePatient() : null;
      if (p && typeof window.goNewVisitForPatient === 'function') {
        window.goNewVisitForPatient();
        toast('Started a visit for ' + (p.name || 'the active patient') + '.', 'ok');
      } else {
        if (typeof window.showView === 'function') window.showView('visit');
        if (typeof window.newVisit === 'function') window.newVisit();
        toast(p ? 'Opened the visit.' : 'Opened a new visit. Pick a patient to scope it.', '');
      }
    });
  }

  /* ===================== MIC YIELD / RESUME ===================== */
  function yieldMicThen(cb) {
    yielding = true;
    stopRec();
    // give the OS/browser a moment to release the mic before the app grabs it
    setTimeout(function () { safe(cb); }, 320);
  }

  function watchCaptureEnd() {
    var btn = gid('captureBtn');
    if (!btn) { yielding = false; maybeStart(); return; }
    var obs = new MutationObserver(function () {
      if (!appCapturing()) {
        try { obs.disconnect(); } catch (e) {}
        yielding = false;
        maybeStart();
      }
    });
    try { obs.observe(btn, { attributes: true, attributeFilter: ['class'] }); } catch (e) {}
    // safety backstop: also poll for a while in case the button is replaced
    var n = 0;
    var t = setInterval(function () {
      n++;
      if (!appCapturing()) {
        clearInterval(t);
        if (yielding) { yielding = false; maybeStart(); }
      } else if (n >= 600) { // ~5 min cap
        clearInterval(t);
      }
    }, 500);
  }

  /* ===================== COMMAND MATCHING ===================== */
  function normalize(s) {
    return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function matchCommand(text) {
    var t = normalize(text);
    if (!t) return null;
    // visit flow first (so "start my visit" is not swallowed by a record match)
    if (/(^|\s)(start|begin|open|new)\s+(my\s+|a\s+|the\s+)?visit(\s|$)/.test(t)) return 'visit';
    // recording (with or without the "mls assistant" wake word)
    if (/(^|\s)(start|begin|stop)\s+(the\s+)?record(ing)?(\s|$)/.test(t)) return 'record';
    if (/(^|\s)(start|begin)\s+(the\s+)?capture(\s|$)/.test(t)) return 'record';
    return null;
  }

  function fire(cmd) {
    var now = Date.now();
    if (cmd === lastCmd && (now - lastAt) < 4000) return; // debounce repeats
    lastCmd = cmd; lastAt = now;
    buf = '';
    if (cmd === 'visit') doStartVisit();
    else if (cmd === 'record') doStartRecording();
  }

  function onResult(e) {
    var chunk = '';
    for (var i = e.resultIndex; i < e.results.length; i++) {
      chunk += e.results[i][0].transcript + ' ';
    }
    buf = (buf + ' ' + chunk).slice(-200);
    // rolling buffer clears if no speech for a bit (avoids stale stitching)
    clearTimeout(bufClearT);
    bufClearT = setTimeout(function () { buf = ''; }, 6000);
    var cmd = matchCommand(buf);
    if (cmd) fire(cmd);
  }

  /* ===================== RECOGNIZER LIFECYCLE ===================== */
  function buildRec() {
    if (!SR) return null;
    var r = new SR();
    r.continuous = true; r.interimResults = true; r.lang = 'en-US';
    r.onresult = onResult;
    r.onerror = function (ev) {
      var err = ev && ev.error;
      if (err === 'not-allowed' || err === 'service-not-allowed') {
        // permission denied -> turn the feature off honestly
        setEnabled(false);
        toast('Microphone was blocked. Allow mic access, then enable voice again.', 'err');
      }
      // 'no-speech'/'aborted'/'network' -> onend will restart if appropriate
    };
    r.onend = function () {
      listening = false;
      // auto-restart unless disabled or the app is dictating
      if (enabled && !yielding && !appCapturing()) {
        setTimeout(maybeStart, 400);
      }
    };
    return r;
  }

  function startRec() {
    if (!SR) return;
    if (listening) return;
    if (appCapturing()) return; // never fight dictation for the mic
    if (!rec) rec = buildRec();
    if (!rec) return;
    try { rec.start(); listening = true; }
    catch (e) { listening = false; } // start() throws if already started; ignore
  }

  function stopRec() {
    if (!rec) { listening = false; return; }
    try { rec.stop(); } catch (e) {}
    try { rec.abort(); } catch (e) {}
    listening = false;
  }

  function maybeStart() {
    if (enabled && !yielding && !appCapturing()) startRec();
    paintFab();
  }

  /* ===================== ENABLE / DISABLE ===================== */
  function setEnabled(on) {
    enabled = !!on;
    lsSet(LS_KEY, enabled ? '1' : '0');
    if (enabled) {
      maybeStart();
      toast('Voice commands on. Say "MLS Assistant, start recording" or "start my visit".', 'ok');
    } else {
      stopRec();
    }
    paintFab();
  }

  function toggleEnabled() {
    if (!SR) { toast('Voice commands need Chrome or Edge.', 'err'); return; }
    setEnabled(!enabled);
  }

  /* ===================== UI: mic FAB grouped with the "+" launcher ===== */
  var fab = null;

  function micSvg(on) {
    var col = on ? '#fff' : '#1f2d40';
    return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">'
      + '<path fill="' + col + '" d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3z"/>'
      + '<path fill="' + col + '" d="M19 11a1 1 0 1 0-2 0 5 5 0 0 1-10 0 1 1 0 1 0-2 0 7 7 0 0 0 6 6.92V21H8a1 1 0 1 0 0 2h8a1 1 0 1 0 0-2h-3v-3.08A7 7 0 0 0 19 11z"/>'
      + '</svg>';
  }

  function ensureFab() {
    if (fab && document.body.contains(fab)) return fab;
    fab = document.createElement('button');
    fab.id = 'mlsVoiceFab';
    fab.type = 'button';
    fab.setAttribute('aria-label', 'Voice commands');
    fab.style.cssText = 'position:fixed;z-index:99991;right:18px;bottom:74px;width:48px;height:48px;'
      + 'border-radius:999px;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;'
      + 'box-shadow:0 6px 20px rgba(20,60,120,.28);background:#e8eef7;transition:background .15s,box-shadow .15s;';
    fab.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); toggleEnabled(); });
    document.body.appendChild(fab);
    paintFab();
    positionFab();
    return fab;
  }

  function positionFab() {
    // sit just ABOVE the "+" Add-patient launcher so it reads as part of that control group
    safe(function () {
      var add = gid('mlsAddPtLauncher');
      if (!add || !fab) return;
      var r = add.getBoundingClientRect();
      if (!r || (!r.width && !r.height)) return;
      var rightGap = Math.max(0, (window.innerWidth || 0) - r.right);
      fab.style.right = Math.round(rightGap) + 'px';
      fab.style.bottom = Math.round((window.innerHeight || 0) - r.top + 10) + 'px';
    });
  }

  function paintFab() {
    if (!fab) return;
    var on = enabled;
    var active = on && listening && !appCapturing();
    fab.innerHTML = micSvg(on);
    fab.style.background = on ? 'linear-gradient(135deg,#2E6A4B,#1456a8)' : '#e8eef7';
    fab.title = !SR
      ? 'Voice commands need Chrome or Edge'
      : (on ? 'Voice commands ON - say "MLS Assistant, start recording" or "start my visit" (click to turn off)'
            : 'Turn on voice commands (uses your microphone)');
    fab.style.outline = active ? '3px solid rgba(31,122,224,.35)' : 'none';
    fab.style.opacity = SR ? '1' : '.5';
  }

  /* ----- inject a toggle row into the Add-patient modal = the "+ menu" ----- */
  function injectModalRow() {
    safe(function () {
      var modal = gid('mlsAddPtModal');
      if (!modal) return;
      if (gid('mlsVoiceModalRow')) return;
      var hd = modal.querySelector('.ap-hd');
      var row = document.createElement('div');
      row.id = 'mlsVoiceModalRow';
      row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:10px 18px;border-bottom:1px solid var(--line,#e8edf4);font:600 13px/1.3 system-ui,sans-serif;color:#1f2d40';
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'mlsVoiceModalBtn';
      btn.style.cssText = 'border:0;border-radius:8px;padding:7px 12px;cursor:pointer;font-weight:700;color:#fff;background:linear-gradient(135deg,#2E6A4B,#1456a8)';
      btn.textContent = enabled ? 'Voice commands: ON' : 'Enable voice commands';
      btn.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        toggleEnabled();
        btn.textContent = enabled ? 'Voice commands: ON' : 'Enable voice commands';
      });
      var lbl = document.createElement('span');
      lbl.innerHTML = 'Hands-free: say <b>"MLS Assistant, start recording"</b> or <b>"start my visit"</b>.';
      row.appendChild(btn); row.appendChild(lbl);
      if (hd && hd.parentNode) { hd.parentNode.insertBefore(row, hd.nextSibling); }
      else { modal.insertBefore(row, modal.firstChild); }
    });
  }

  /* ===================== BOOT ===================== */
  var tickT = 0;
  function tick() {
    ensureFab();
    positionFab();
    paintFab();
    injectModalRow();
  }

  function boot() {
    enabled = (lsGet(LS_KEY) === '1');
    ensureFab();
    // resume listening if the user previously opted in (their mic grant persists)
    if (enabled) maybeStart();
    tickT = setInterval(tick, 1200);
    window.addEventListener('resize', positionFab);
  }

  function revert() {
    safe(function () { clearInterval(tickT); });
    setEnabledSilent(false);
    safe(function () { if (fab && fab.parentNode) fab.parentNode.removeChild(fab); });
    safe(function () { var r = gid('mlsVoiceModalRow'); if (r && r.parentNode) r.parentNode.removeChild(r); });
    safe(function () { window.removeEventListener('resize', positionFab); });
    safe(function () { window.__mlsVoice.installed = false; });
  }
  function setEnabledSilent(on) { enabled = !!on; stopRec(); }

  window.__mlsVoice = {
    installed: true,
    version: VERSION,
    enable: function () { setEnabled(true); },
    disable: function () { setEnabled(false); },
    toggle: toggleEnabled,
    isEnabled: function () { return enabled; },
    isListening: function () { return listening; },
    test: function (phrase) { var c = matchCommand(phrase); if (c) fire(c); return c; },
    supported: !!SR,
    revert: revert
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
