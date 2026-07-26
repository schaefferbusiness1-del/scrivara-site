/* ============================================================================
 * feat_mls_audio_capture.js  ->  window.__mlsAudioCapture   (ac-1.0.0)
 * ---------------------------------------------------------------------------
 * ONE DELIBERATE AUDIO POLICY FOR AMBIENT EXAM-ROOM CAPTURE.
 *
 * Owner, 2026-07-26: "make the recording better by picking up voices better".
 *
 * READ THIS FIRST — THE HONEST LIMIT OF WHAT THIS CAN DO
 * -----------------------------------------------------
 * The live transcript is produced by the Web Speech API (SpeechRecognition).
 * **SpeechRecognition accepts no audio constraints and no deviceId.** It opens
 * its own capture, with the browser's own processing, on the browser's own
 * chosen input. Nothing in this file changes a single word of live
 * transcription. Anyone who says otherwise is guessing.
 *
 * What this file DOES change is every stream the app opens itself:
 *   - the local backup recording (feat_mls_record_backup.js) — the audio a
 *     doctor can play back, and the only artefact that could ever be
 *     re-transcribed if the live pass was poor;
 *   - the voice-activity analyser in mls-connect.js's recording guard, which
 *     decides whether the "transcription stalled" watchdog is trusting a
 *     VAD-confirmed 30s or a degraded 90s.
 * Better audio there is real and measurable. It is not a transcript claim.
 *
 * THE CONSTRAINT TRADEOFF, CHOSEN DELIBERATELY
 * --------------------------------------------
 * The three WebRTC audio constraints are tuned for a CALL: one near talker,
 * a loudspeaker to cancel, and a stationary noise floor. An exam room is the
 * opposite — two or three people, one of them across the room, and the
 * clinically important speech is often the quietest thing in it.
 *
 *   echoCancellation   AMBIENT: OFF   |  CLOSE-TALK: ON
 *     AEC exists to subtract the device's own loudspeaker output from the
 *     microphone. During an ambient visit recording the app plays nothing, so
 *     there is nothing to subtract — and AEC's non-linear residual suppressor
 *     and double-talk logic still run, attenuating far-field speech that looks
 *     to it like residual echo. OFF for the room.
 *     It goes back ON for close-talk because the assistant SPEAKS (TTS) while a
 *     microphone may be open; without AEC the app hears itself.
 *
 *   noiseSuppression   AMBIENT: OFF   |  CLOSE-TALK: ON
 *     This is the one that actually costs words. Chrome's suppressor is trained
 *     on a single near speaker over stationary noise; at the low SNR of a
 *     patient sitting two or three metres away it classifies soft consonants
 *     and sentence tails AS noise and gates them. Turning it off keeps the HVAC
 *     hiss in the file — and keeps the patient's quiet answer, which is the part
 *     the note is made of. A noisier recording that contains the words beats a
 *     clean one that does not.
 *     ON for a headset, where the speaker is close, the SNR is high, and there
 *     is nothing soft and distant left to protect.
 *
 *   autoGainControl    AMBIENT: ON    |  CLOSE-TALK: ON
 *     AGC lifts a distant, quiet talker toward usable level, which is exactly
 *     the ambient problem. Its cost is a raised noise floor between utterances
 *     and some pumping. Worth it in both modes; it is the only one of the three
 *     that helps the far speaker rather than hurting them.
 *
 *   channelCount: 1, sampleRate: 48000 — mono at the device's native rate.
 *     Resampling is a lossy step performed for no benefit here, and a second
 *     channel doubles the file for a source that is not stereo.
 *
 * NONE OF THE ABOVE IS ASSERTED AS APPLIED. Browsers silently ignore
 * constraints they do not honour. Everything this module reports comes from
 * MediaStreamTrack.getSettings() on the LIVE track — what the device actually
 * did, never what we asked for. requested and applied are reported separately
 * and are allowed to disagree out loud.
 *
 * DEVICE SELECTION. enumerateDevices() returns audio inputs; labels are blank
 * until a capture permission has been granted at least once, and this module
 * says so rather than rendering a list of anonymous ids as if it were a choice.
 * A selected deviceId is applied to the app's OWN streams. It does NOT move
 * SpeechRecognition — Chrome uses the site's default input for that, changed in
 * the browser's own microphone settings. That distinction is surfaced in
 * describe(), so no surface built on this module can imply otherwise.
 *
 * NOT WIRED TO ANY UI HERE, ON PURPOSE. There is no microphone section in
 * Settings today, and the Settings surfaces belong to another lane in this
 * rebuild. This module is headless and complete; the integration point is
 * documented in WORKER_G_REPORT.md.
 *
 * Additive, idempotent, reversible: window.__mlsAudioCapture.revert().
 * Opens nothing on its own — every capture here is requested by a caller that
 * already had a reason to open the microphone.
 * ==========================================================================*/
(function () {
  'use strict';

  var VERSION = 'ac-1.0.0';
  var ASSET = 'feat_mls_audio_capture.js';
  try {
    if (window.__mlsAudioCapture && window.__mlsAudioCapture.installed &&
        window.__mlsAudioCapture.version === VERSION) return;
  } catch (e0) { return; }

  var LS_DEVICE = 'mls.audio.deviceId';
  var LS_MODE = 'mls.audio.mode';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function S(x) { return x == null ? '' : String(x); }
  function lsGet(k) { return safe(function () { return localStorage.getItem(k); }, null); }
  function lsSet(k, v) { safe(function () { localStorage.setItem(k, v); }); }

  /* ===================== the policy ===================== */
  var MODES = {
    /* the exam room: two or three speakers, one of them far away */
    ambient: { echoCancellation: false, noiseSuppression: false, autoGainControl: true },
    /* a headset or a phone held to the mouth; also the mode to use whenever the
       app may be SPEAKING while the microphone is open */
    closetalk: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
  };
  var DEFAULT_MODE = 'ambient';

  function mode() {
    var m = S(lsGet(LS_MODE));
    return MODES[m] ? m : DEFAULT_MODE;
  }
  function setMode(m) {
    m = S(m);
    if (!MODES[m]) return false;
    lsSet(LS_MODE, m);
    return true;
  }
  function selected() { return S(lsGet(LS_DEVICE)); }
  function select(deviceId) {
    deviceId = S(deviceId);
    if (!deviceId) { safe(function () { localStorage.removeItem(LS_DEVICE); }); return true; }
    lsSet(LS_DEVICE, deviceId);
    return true;
  }

  /* The constraint object a caller should hand to getUserMedia.
     `exact` is deliberately NOT used on deviceId: an exact deviceId that has
     been unplugged makes getUserMedia REJECT, which would turn "your headset is
     gone" into "recording failed". A non-exact hint degrades to the default
     device, and report() then says which one actually opened. */
  function constraints(modeName) {
    var m = MODES[MODES[S(modeName)] ? S(modeName) : mode()];
    var audio = {
      echoCancellation: m.echoCancellation,
      noiseSuppression: m.noiseSuppression,
      autoGainControl: m.autoGainControl,
      channelCount: 1,
      sampleRate: 48000
    };
    var dev = selected();
    if (dev) audio.deviceId = dev;
    return { audio: audio };
  }

  /* ===================== receipts, never claims ===================== */
  var lastReport = null;

  function trackSettings(stream) {
    return safe(function () {
      var t = stream && isFn(stream.getAudioTracks) ? stream.getAudioTracks()[0] : null;
      if (!t) return null;
      var s = isFn(t.getSettings) ? t.getSettings() : null;
      return {
        label: S(t.label),
        deviceId: s ? S(s.deviceId) : '',
        echoCancellation: s ? s.echoCancellation : undefined,
        noiseSuppression: s ? s.noiseSuppression : undefined,
        autoGainControl: s ? s.autoGainControl : undefined,
        channelCount: s ? s.channelCount : undefined,
        sampleRate: s ? s.sampleRate : undefined
      };
    }, null);
  }

  /* What did the browser actually honour? Anything requested that came back
     different is listed — silently ignored constraints are the normal case and
     must never be presented as applied. */
  function diff(requested, applied) {
    var out = [];
    if (!requested || !applied) return out;
    ['echoCancellation', 'noiseSuppression', 'autoGainControl', 'channelCount'].forEach(function (k) {
      if (applied[k] === undefined) { out.push({ key: k, requested: requested[k], applied: 'not reported by this browser' }); return; }
      if (applied[k] !== requested[k]) out.push({ key: k, requested: requested[k], applied: applied[k] });
    });
    return out;
  }

  /* open(modeName) -> Promise<{ ok, stream, requested, applied, ignored, note }>
     The ONLY way this module touches the microphone, and only when a caller
     asked. Rejections are returned, never thrown, with the browser's reason. */
  function open(modeName) {
    var req = constraints(modeName);
    if (!navigator.mediaDevices || !isFn(navigator.mediaDevices.getUserMedia)) {
      return Promise.resolve({ ok: false, reason: 'This browser cannot open a microphone from a web page.', requested: req.audio });
    }
    return navigator.mediaDevices.getUserMedia(req).then(function (stream) {
      var applied = trackSettings(stream);
      var ignored = diff(req.audio, applied);
      lastReport = { at: Date.now(), mode: MODES[S(modeName)] ? S(modeName) : mode(), requested: req.audio, applied: applied, ignored: ignored };
      return { ok: true, stream: stream, requested: req.audio, applied: applied, ignored: ignored };
    }, function (err) {
      var name = S(err && err.name);
      var reason = name === 'NotAllowedError' ? 'Microphone access is blocked for this site. Allow it in your browser, then try again.'
        : name === 'NotFoundError' ? 'No microphone was found. Connect or enable one, then try again.'
        : name === 'NotReadableError' ? 'The microphone is in use by another program. Close it, then try again.'
        : ('The microphone could not be opened (' + (name || 'unknown error') + ').');
      lastReport = { at: Date.now(), mode: mode(), requested: req.audio, applied: null, ignored: [], error: name };
      return { ok: false, reason: reason, error: name, requested: req.audio };
    });
  }

  /* devices() -> Promise<{ ok, inputs:[{deviceId,label}], labelled, note }>
     Labels are empty strings until the site has been granted a capture at least
     once. A picker built on unlabelled ids is not a choice, so `labelled` says
     which case this is instead of leaving a surface to guess. */
  function devices() {
    if (!navigator.mediaDevices || !isFn(navigator.mediaDevices.enumerateDevices)) {
      return Promise.resolve({ ok: false, inputs: [], labelled: false, note: 'This browser cannot list audio devices.' });
    }
    return navigator.mediaDevices.enumerateDevices().then(function (list) {
      var inputs = (list || []).filter(function (d) { return d && d.kind === 'audioinput'; })
        .map(function (d) { return { deviceId: S(d.deviceId), label: S(d.label) }; });
      var labelled = inputs.length > 0 && inputs.some(function (d) { return !!d.label; });
      return {
        ok: true, inputs: inputs, labelled: labelled,
        note: labelled ? '' : 'Device names stay hidden until you have allowed the microphone once on this site.'
      };
    }, function () {
      return { ok: false, inputs: [], labelled: false, note: 'The audio device list could not be read.' };
    });
  }

  /* The sentence a UI is allowed to show. It states the limit rather than
     letting a surface imply that a device choice moves the transcript. */
  function describe() {
    var m = mode();
    var c = MODES[m];
    return {
      mode: m,
      summary: m === 'ambient'
        ? 'Room recording: noise reduction off so a patient across the room is not cut off, automatic level on.'
        : 'Close microphone: noise reduction and echo cancellation on, automatic level on.',
      appliesTo: 'The audio this app records and stores on your device.',
      doesNotApplyTo: 'Live transcription. The browser runs that on its own microphone stream and ignores these settings — change the default microphone in your browser settings to move it.',
      constraints: { echoCancellation: c.echoCancellation, noiseSuppression: c.noiseSuppression, autoGainControl: c.autoGainControl },
      lastMeasured: lastReport
    };
  }

  function report() { return lastReport; }

  function revert() { safe(function () { window.__mlsAudioCapture.installed = false; }); }

  window.__mlsAudioCapture = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    MODES: MODES,
    mode: mode,
    setMode: setMode,
    selected: selected,
    select: select,
    devices: devices,
    constraints: constraints,
    open: open,
    report: report,
    describe: describe,
    revert: revert
  };
})();
