/* =========================================================================
   MLS Seamless Pop-up  —  OFFSCREEN audio recorder  (Increment 3, gap A)

   An MV3 offscreen document that hosts the PROVEN §35 segmented recorder so
   audio capture works while the doctor stays on athenaOne. (Mic + MediaRecorder
   inside a content script over Athena's CSP, or inside a service worker, is
   unreliable; an offscreen document is the supported MV3 host for getUserMedia.)

   THE §35 LOOP, UNCHANGED IN SPIRIT:
     - Each segment is its OWN short-lived MediaRecorder, stopped after ~8s so it
       flushes a COMPLETE, self-contained file (its own header). That is the fix
       that made every uploaded clip independently decodable by Whisper.
     - We DO NOT use a single timeslice recorder (rec.start(8000)) — that was the
       exact bug that returned 502 for clips #2..N.

   HARD HONESTY RAIL (Verification Protocol Rule 1 & 5):
     - This module NEVER produces transcript text. It only captures audio and
       hands COMPLETE segment blobs to background.js, which uploads them to the
       backend (the doctor's authenticated session) and relays the REAL transcript
       back. If the mic is denied or a segment fails, it emits an honest error —
       never a fabricated chunk, never a fake "listening…" that becomes text.

   Self-contained + testable: the segment loop is exposed as createRecorder() with
   injectable getUserMedia / RecorderCtor / isTypeSupported, so the jsdom/node
   suite drives it with fakes (no real mic, no real DOM).
   ========================================================================= */
(function () {
  'use strict';

  var SEGMENT_MS = 8000;                 // §35: ~8s complete-file segments
  // Preference order mirrors the app's pickMime(): Opus/WebM on Chrome, mp4 on iOS.
  var MIME_CANDIDATES = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus'
  ];

  function pickMime(isSupported) {
    if (typeof isSupported !== 'function') return '';
    for (var i = 0; i < MIME_CANDIDATES.length; i++) {
      try { if (isSupported(MIME_CANDIDATES[i])) return MIME_CANDIDATES[i]; } catch (e) {}
    }
    return '';                           // let the platform default decide
  }

  // ====================================================================== //
  //  createRecorder — the testable §35 segmented loop.                      //
  //  deps: { getUserMedia(constraints)->Promise<stream>,                    //
  //          RecorderCtor (MediaRecorder-like),                             //
  //          isTypeSupported(mime)->bool,                                   //
  //          onSegment(blobOrBytes, mime, seqNo),                           //
  //          onError(reason),                                               //
  //          segmentMs }                                                    //
  // ====================================================================== //
  function createRecorder(deps) {
    deps = deps || {};
    var getUserMedia = deps.getUserMedia;
    var RecorderCtor = deps.RecorderCtor;
    var isSupported  = deps.isTypeSupported;
    var onSegment    = deps.onSegment || function () {};
    var onError      = deps.onError   || function () {};
    var segmentMs    = deps.segmentMs || SEGMENT_MS;
    var setTimer     = deps.setTimeout || (typeof setTimeout !== 'undefined' ? setTimeout : null);
    var clearTimer   = deps.clearTimeout || (typeof clearTimeout !== 'undefined' ? clearTimeout : null);

    var stream = null;
    var rec = null;
    var running = false;
    var seq = 0;
    var stopTimer = null;
    var mime = '';

    function startSegment() {
      if (!running || !stream) return;
      var opts = mime ? { mimeType: mime } : undefined;
      try { rec = new RecorderCtor(stream, opts); }
      catch (e) { try { rec = new RecorderCtor(stream); } catch (e2) { onError('recorder-init-failed'); return; } }

      var chunk = null;
      rec.ondataavailable = function (ev) {
        // a stopped single-segment recorder fires once with the COMPLETE file
        if (ev && ev.data && (ev.data.size === undefined || ev.data.size > 0)) chunk = ev.data;
      };
      rec.onstop = function () {
        if (chunk) { seq += 1; try { onSegment(chunk, mime, seq); } catch (e) {} }
        if (running) startSegment();     // immediately begin the next complete segment
      };
      rec.onerror = function () { onError('recorder-error'); };

      try { rec.start(); } catch (e) { onError('recorder-start-failed'); return; }
      // stop after ~8s to FLUSH a complete file (NOT timeslice)
      if (setTimer) stopTimer = setTimer(function () {
        try { if (rec && rec.state !== 'inactive') rec.stop(); } catch (e) {}
      }, segmentMs);
    }

    function start() {
      if (running) return Promise.resolve({ ok: true, already: true });
      if (typeof getUserMedia !== 'function' || typeof RecorderCtor !== 'function') {
        onError('no-recorder'); return Promise.resolve({ ok: false, reason: 'no-recorder' });
      }
      return Promise.resolve()
        .then(function () { return getUserMedia({ audio: true }); })
        .then(function (s) {
          stream = s;
          mime = pickMime(isSupported);
          running = true;
          startSegment();
          return { ok: true, mime: mime };
        })
        .catch(function (e) {
          var reason = (e && /denied|NotAllowed|Permission/i.test(String(e && e.name || e))) ? 'mic-denied' : 'mic-unavailable';
          onError(reason);
          return { ok: false, reason: reason };
        });
    }

    function stop() {
      running = false;
      if (stopTimer && clearTimer) { try { clearTimer(stopTimer); } catch (e) {} stopTimer = null; }
      // flush the final in-flight segment, then release the mic
      try { if (rec && rec.state && rec.state !== 'inactive') rec.stop(); } catch (e) {}
      try {
        if (stream && stream.getTracks) stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) {} });
      } catch (e) {}
      stream = null;
      return Promise.resolve({ ok: true, segments: seq });
    }

    return {
      start: start, stop: stop,
      isRunning: function () { return running; },
      segmentCount: function () { return seq; },
      _mime: function () { return mime; }
    };
  }

  // ====================================================================== //
  //  BOOT — wire the recorder to the real platform + chrome.runtime.        //
  //  Only runs inside the actual offscreen document (chrome + navigator).   //
  //  background.js talks to us with MLS_OFFSCREEN_START / _STOP and we emit  //
  //  MLS_OFFSCREEN_SEGMENT (complete file) / MLS_OFFSCREEN_ERROR.            //
  // ====================================================================== //
  var hasChrome = (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage);
  var hasMedia  = (typeof navigator !== 'undefined' && navigator.mediaDevices &&
                   typeof navigator.mediaDevices.getUserMedia === 'function' &&
                   typeof MediaRecorder !== 'undefined');

  function blobToBytes(blob) {
    // hand background.js a transferable, JSON-safe array of byte values
    if (typeof blob.arrayBuffer === 'function') {
      return blob.arrayBuffer().then(function (buf) { return Array.from(new Uint8Array(buf)); });
    }
    return new Promise(function (resolve) {
      try {
        var fr = new FileReader();
        fr.onload = function () { resolve(Array.from(new Uint8Array(fr.result))); };
        fr.onerror = function () { resolve(null); };
        fr.readAsArrayBuffer(blob);
      } catch (e) { resolve(null); }
    });
  }

  if (hasChrome) {
    var recorder = null;

    function send(type, extra) {
      try { chrome.runtime.sendMessage(Object.assign({ type: type, from: 'mls-offscreen' }, extra || {})); } catch (e) {}
    }

    chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
      if (!msg || msg.type !== 'MLS_OFFSCREEN_START' && msg.type !== 'MLS_OFFSCREEN_STOP') return;

      if (msg.type === 'MLS_OFFSCREEN_START') {
        if (!hasMedia) { send('MLS_OFFSCREEN_ERROR', { reason: 'no-recorder' }); sendResponse && sendResponse({ ok: false, reason: 'no-recorder' }); return true; }
        recorder = createRecorder({
          getUserMedia: function (c) { return navigator.mediaDevices.getUserMedia(c); },
          RecorderCtor: MediaRecorder,
          isTypeSupported: function (m) { return MediaRecorder.isTypeSupported(m); },
          onSegment: function (blob, mime, seqNo) {
            blobToBytes(blob).then(function (bytes) {
              if (bytes && bytes.length) send('MLS_OFFSCREEN_SEGMENT', { bytes: bytes, mime: mime, seq: seqNo });
            });
          },
          onError: function (reason) { send('MLS_OFFSCREEN_ERROR', { reason: reason }); }
        });
        recorder.start().then(function (r) { sendResponse && sendResponse(r); });
        return true;
      }

      if (msg.type === 'MLS_OFFSCREEN_STOP') {
        if (recorder) recorder.stop().then(function (r) { recorder = null; sendResponse && sendResponse(r); });
        else sendResponse && sendResponse({ ok: true, segments: 0 });
        return true;
      }
    });
  }

  // export the testable core
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createRecorder: createRecorder, pickMime: pickMime, SEGMENT_MS: SEGMENT_MS, MIME_CANDIDATES: MIME_CANDIDATES };
  }
})();
