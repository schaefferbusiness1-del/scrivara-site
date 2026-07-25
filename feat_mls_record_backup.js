/* feat_mls_record_backup.js — v rb-1.0.1 (2026-07-14)
 *
 * RECORDING SAFETY NET (additive, reversible — window.__mlsRecBackup.revert()).
 * The visit recorder is Web Speech recognition only: if the recognizer hiccups or the tab
 * sleeps, spoken audio is gone and the note with it. This module adds three protections:
 *
 *   1. AUDIO BACKUP — while the doctor records, a parallel MediaRecorder captures the mic
 *      to IndexedDB in 5-second chunks (survives tab crash/reload). Last 10 sessions kept,
 *      on THIS device only — nothing is uploaded anywhere.
 *   2. CUT-OUT SENTINEL — if the speech recognizer silently ends while the app still says
 *      "recording", it is restarted within ~2s and the doctor sees a small notice, so
 *      dictation never quietly stops mid-visit.
 *   3. RECOVERY — a tiny 🎧 button next to the record button lists the backups; one tap
 *      downloads the audio (webm) so a lost note can always be re-transcribed.
 *
 * No PHI leaves the device. No writes to athenaOne. All failure paths are silent-safe:
 * if the mic/DB is unavailable the normal recording flow is completely untouched.
 */
(function () {
  "use strict";
  if (window.__mlsRecBackup && window.__mlsRecBackup.installed) return;

  var VERSION = "rb-1.0.1";
  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === "function"; }

  /* ---------------- IndexedDB ---------------- */
  var DB_NAME = "mls_rec_backup", CHUNKS = "chunks", SESS = "sessions";
  var _db = null;
  function db() {
    return new Promise(function (res) {
      if (_db) return res(_db);
      try {
        var r = indexedDB.open(DB_NAME, 1);
        r.onupgradeneeded = function () {
          var d = r.result;
          if (!d.objectStoreNames.contains(CHUNKS)) d.createObjectStore(CHUNKS, { keyPath: ["sess", "seq"] });
          if (!d.objectStoreNames.contains(SESS)) d.createObjectStore(SESS, { keyPath: "sess" });
        };
        r.onsuccess = function () { _db = r.result; res(_db); };
        r.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
  }
  function putChunk(sess, seq, blob) {
    db().then(function (d) { if (!d) return; safe(function () { d.transaction(CHUNKS, "readwrite").objectStore(CHUNKS).put({ sess: sess, seq: seq, blob: blob, size: blob.size }); }); });
  }
  function putSess(meta) {
    db().then(function (d) { if (!d) return; safe(function () { d.transaction(SESS, "readwrite").objectStore(SESS).put(meta); }); });
  }
  function allSess() {
    return db().then(function (d) {
      return new Promise(function (res) {
        if (!d) return res([]);
        safe(function () {
          var q = d.transaction(SESS, "readonly").objectStore(SESS).getAll();
          q.onsuccess = function () { res((q.result || []).sort(function (a, b) { return b.sess - a.sess; })); };
          q.onerror = function () { res([]); };
        }, res([]));
      });
    });
  }
  function sessChunks(sess) {
    return db().then(function (d) {
      return new Promise(function (res) {
        if (!d) return res([]);
        safe(function () {
          var q = d.transaction(CHUNKS, "readonly").objectStore(CHUNKS).getAll(IDBKeyRange.bound([sess, 0], [sess, 1e9]));
          q.onsuccess = function () { res((q.result || []).sort(function (a, b) { return a.seq - b.seq; })); };
          q.onerror = function () { res([]); };
        }, res([]));
      });
    });
  }
  function dropSess(sess) {
    db().then(function (d) {
      if (!d) return;
      safe(function () {
        d.transaction(SESS, "readwrite").objectStore(SESS)["delete"](sess);
        d.transaction(CHUNKS, "readwrite").objectStore(CHUNKS)["delete"](IDBKeyRange.bound([sess, 0], [sess, 1e9]));
      });
    });
  }
  function prune(keep) {
    allSess().then(function (list) { for (var i = keep; i < list.length; i++) dropSess(list[i].sess); });
  }
  function purge() {
    stopBackup();
    safe(function () { if (_db) _db.close(); });
    _db = null;
    return new Promise(function (resolve) {
      if (!window.indexedDB || typeof indexedDB.deleteDatabase !== "function") { resolve(false); return; }
      var settled = false;
      function done(ok) { if (settled) return; settled = true; resolve(ok); }
      try {
        var request = indexedDB.deleteDatabase(DB_NAME);
        request.onsuccess = function () { done(true); };
        request.onerror = function () { done(false); };
        request.onblocked = function () { done(false); };
        setTimeout(function () { done(false); }, 1500);
      } catch (e) { done(false); }
    });
  }

  /* ---------------- backup recorder ---------------- */
  var rec = null, stream = null, sessId = null;
  /* getUserMedia can resolve after Stop/New Visit/a patient switch. Every
     request therefore owns one epoch. stopBackup() invalidates that epoch even
     when MediaRecorder has not been created yet, and a stale resolved stream is
     closed before it can construct or start a recorder. */
  var backupRequestEpoch = 0, pendingBackupEpoch = 0;
  function stopStreamTracks(s) {
    safe(function () { if (s && isFn(s.getTracks)) s.getTracks().forEach(function (t) { if (t && isFn(t.stop)) t.stop(); }); });
  }
  function invalidatePendingBackup() {
    backupRequestEpoch++;
    pendingBackupEpoch = 0;
  }
  function pickMime() {
    var c = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", ""];
    for (var i = 0; i < c.length; i++) { if (!c[i] || safe(function () { return MediaRecorder.isTypeSupported(c[i]); }, false)) return c[i]; }
    return "";
  }
  function ptLabel() {
    return safe(function () {
      var el = document.getElementById("heroPtName");
      var v = (el && (el.value || el.textContent)) || "";
      v = String(v).trim();
      return v ? v.slice(0, 40) : "patient";
    }, "patient");
  }
  function startBackup() {
    if (rec) return true; /* already running */
    if (!window.MediaRecorder || !navigator.mediaDevices || !isFn(navigator.mediaDevices.getUserMedia)) return false;
    var requestEpoch = ++backupRequestEpoch;
    pendingBackupEpoch = requestEpoch;
    var micRequest;
    try { micRequest = navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch (e) {
      if (pendingBackupEpoch === requestEpoch) pendingBackupEpoch = 0;
      chip("Backup mic unavailable — dictation still works normally.", true);
      return false;
    }
    Promise.resolve(micRequest).then(function (s) {
      if (requestEpoch !== backupRequestEpoch || pendingBackupEpoch !== requestEpoch) {
        stopStreamTracks(s);
        return;
      }
      pendingBackupEpoch = 0;
      var nextRec = null, nextSessId = null, nextSeq = 0;
      try {
        var mt = pickMime();
        nextRec = new MediaRecorder(s, mt ? { mimeType: mt } : undefined);
        nextSessId = Date.now();
        var mime = nextRec.mimeType || mt || "audio/webm";
        /* Keep chunk ownership local to this recorder. A final dataavailable
           event from a stopped visit must never use the next visit's globals. */
        nextRec.ondataavailable = function (ev) { if (ev.data && ev.data.size) putChunk(nextSessId, nextSeq++, ev.data); };
        nextRec.onerror = function () { chip("Audio backup hit an error — dictation itself is unaffected.", true); };
        rec = nextRec; stream = s; sessId = nextSessId;
        nextRec.start(5000); /* one durable chunk every 5s */
        putSess({ sess: nextSessId, at: nextSessId, patient: ptLabel(), mime: mime, open: 1 });
        prune(10);
        chip("Backup recording ✓ (audio kept on this device)");
      } catch (e) {
        if (rec === nextRec) { rec = null; stream = null; sessId = null; }
        safe(function () { if (nextRec && nextRec.state !== "inactive") nextRec.stop(); });
        stopStreamTracks(s);
      }
    })["catch"](function () {
      if (requestEpoch !== backupRequestEpoch || pendingBackupEpoch !== requestEpoch) return;
      pendingBackupEpoch = 0;
      chip("Backup mic unavailable — dictation still works normally.", true);
    });
    return true;
  }
  function stopBackup() {
    invalidatePendingBackup();
    var r = rec, s = stream, id = sessId; rec = null; stream = null; sessId = null;
    if (!r) { if (s) stopStreamTracks(s); return; }
    safe(function () { r.stop(); });
    setTimeout(function () { stopStreamTracks(s); }, 400);
    if (id) { putSessOpen(id, 0); chip("Audio backup saved ✓ — tap 🎧 to recover it any time"); }
  }
  function putSessOpen(id, open) {
    allSess().then(function (list) {
      for (var i = 0; i < list.length; i++) { if (list[i].sess === id) { list[i].open = open; putSess(list[i]); return; } }
    });
  }

  /* ---------------- wrap startCapture / stopCapture ---------------- */
  var wrapped = null, wrapPoll = null, wrapTries = 0;
  function wrapCore() {
    if (wrapped) return true;
    var sc = window.startCapture, xc = window.stopCapture;
    if (!isFn(sc) || !isFn(xc)) return false;
    wrapped = { sc: sc, xc: xc };
    window.startCapture = function () {
      /* A new base attempt supersedes any pending/active backup. Run the base
         start first so a refused microphone/visit binding never owns backup
         audio; only a successful capture receives one request epoch. */
      safe(stopBackup);
      var result;
      try { result = sc.apply(this, arguments); }
      catch (e) { safe(stopBackup); throw e; }
      if (result === false) { safe(stopBackup); return result; }
      safe(startBackup);
      return result;
    };
    window.stopCapture = function () { safe(stopBackup); return xc.apply(this, arguments); };
    return true;
  }

  /* ---------------- recognizer cut-out sentinel ---------------- */
  var lastRec = null, restarts = 0, protoWrapped = [];
  function wrapProto() {
    var names = ["SpeechRecognition", "webkitSpeechRecognition"];
    for (var i = 0; i < names.length; i++) {
      var C = window[names[i]];
      if (!C || !C.prototype || C.prototype.__mlsRbWrapped) continue;
      (function (proto) {
        var oStart = proto.start, oStop = proto.stop, oAbort = proto.abort;
        proto.__mlsRbWrapped = true;
        protoWrapped.push({ proto: proto, start: oStart, stop: oStop, abort: oAbort });
        proto.start = function () {
          var inst = this;
          if (!inst.__mlsRbSeen) {
            inst.__mlsRbSeen = true;
            safe(function () {
              inst.addEventListener("end", function () { inst.__mlsRbEnded = Date.now(); });
              inst.addEventListener("result", function () { inst.__mlsRbLastResult = Date.now(); });
            });
          }
          inst.__mlsRbEnded = 0; inst.__mlsRbStopped = false;
          lastRec = inst;
          return oStart.apply(this, arguments);
        };
        proto.stop = function () { this.__mlsRbStopped = true; return oStop.apply(this, arguments); };
        proto.abort = function () { this.__mlsRbStopped = true; return oAbort.apply(this, arguments); };
      })(C.prototype);
    }
  }
  function capturingNow() {
    return safe(function () {
      if (window.capturing) return true;
      var b = document.getElementById("captureBtn");
      return !!(b && (b.classList.contains("recording") || /stop/i.test(b.textContent || "")));
    }, false);
  }
  /* ---------------- screen wake lock (ph-wake-1.0.0, 2026-07-25) -------------
   * Verified at b621: the signed-in app contained ZERO `wakeLock` and ZERO
   * `visibilitychange` references across ScribeFlow.html and mls-connect.js.
   * On a phone that means the screen sleeps mid-visit, the Web Speech
   * recognizer is torn down with it, and dictation stops SILENTLY — the app
   * still shows "recording". This is the difference between a phone that can
   * take a visit and one that cannot.
   *
   * phone.html already solved exactly this and is proven in the field
   * (phone.html:545 wake lock, :547 visibilitychange re-arm). This ports that
   * pattern rather than inventing a second one.
   *
   * Deliberately NO new setInterval: tests/boot-script-budget.test.js caps
   * setInterval occurrences across every root feat_*.js (INTERVAL_CEILING) and
   * counts files whether or not the loader pulls them in. The lock is acquired
   * and released from the sentinel tick that already runs, plus one
   * visibilitychange listener — a wake lock is auto-released whenever the page
   * is hidden, so it MUST be re-requested on return, not merely held. */
  var wakeLock = null;
  function wakeSupported() {
    return safe(function () { return !!(navigator.wakeLock && navigator.wakeLock.request); }, false);
  }
  function grabWake() {
    if (wakeLock || !wakeSupported()) return;
    safe(function () {
      navigator.wakeLock.request("screen").then(function (lock) {
        wakeLock = lock;
        safe(function () {
          lock.addEventListener("release", function () { wakeLock = null; });
        });
      }, function () { wakeLock = null; });
    });
  }
  function dropWake() {
    if (!wakeLock) return;
    var lock = wakeLock; wakeLock = null;
    safe(function () { lock.release(); });
  }
  safe(function () {
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      if (!capturingNow()) { dropWake(); return; }
      grabWake();   /* released automatically while hidden — re-take it */
      safe(sentinel); /* the recognizer may have been torn down meanwhile */
    });
  });

  function sentinel() {
    safe(wrapProto);
    if (!capturingNow()) { dropWake(); return; }
    grabWake();
    var r = lastRec;
    if (!r || r.__mlsRbStopped) return;
    var endedAt = r.__mlsRbEnded || 0;
    if (!endedAt) return;
    if (Date.now() - endedAt < 2000) return;
    r.__mlsRbEnded = 0;
    var ok = safe(function () { r.start(); return true; }, false);
    if (ok) {
      restarts++;
      chip("Dictation restarted automatically — backup audio has everything.", false);
    }
  }

  /* ---------------- tiny UI: status chip + 🎧 recovery list ---------------- */
  var CHIP_ID = "mlsRecBkChip", BTN_ID = "mlsRecBkBtn", LIST_ID = "mlsRecBkList", chipT = null;
  function host() {
    return safe(function () { var b = document.getElementById("captureBtn"); return b ? b.parentElement : null; }, null);
  }
  function chip(msg, warn) {
    var h = host(); if (!h) return;
    var c = document.getElementById(CHIP_ID);
    if (!c) {
      c = document.createElement("span"); c.id = CHIP_ID;
      c.style.cssText = "display:inline-block;margin-left:8px;padding:2px 8px;border-radius:10px;font-size:11px;line-height:1.5;vertical-align:middle;background:#eef6ee;color:#1b5e20;border:1px solid #c9e3c9;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      h.appendChild(c);
    }
    c.style.background = warn ? "#fdf3e7" : "#eef6ee";
    c.style.color = warn ? "#8a5200" : "#1b5e20";
    c.style.borderColor = warn ? "#f0d9b8" : "#c9e3c9";
    c.textContent = msg;
    c.title = msg;
    if (chipT) clearTimeout(chipT);
    chipT = setTimeout(function () { safe(function () { c.textContent = ""; c.style.background = "transparent"; c.style.borderColor = "transparent"; }); }, 12000);
  }
  function fmtWhen(ts) { return safe(function () { return new Date(ts).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }, String(ts)); }
  function download(sess, meta) {
    sessChunks(sess).then(function (chs) {
      if (!chs.length) { chip("That backup is empty.", true); return; }
      var mime = (meta && meta.mime) || "audio/webm";
      var blob = new Blob(chs.map(function (c) { return c.blob; }), { type: mime });
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      var ext = /mp4/.test(mime) ? "m4a" : "webm";
      a.download = "MLS-recording-backup-" + new Date(sess).toISOString().slice(0, 16).replace(/[:T]/g, "-") + "." + ext;
      document.body.appendChild(a); a.click();
      setTimeout(function () { safe(function () { URL.revokeObjectURL(a.href); a.remove(); }); }, 4000);
    });
  }
  function toggleList() {
    var old = document.getElementById(LIST_ID);
    if (old) { old.remove(); return; }
    allSess().then(function (list) {
      var b = document.getElementById(BTN_ID); if (!b) return;
      var box = document.createElement("div"); box.id = LIST_ID;
      box.style.cssText = "position:absolute;z-index:99999;background:#fff;border:1px solid #d5dde6;border-radius:10px;box-shadow:0 8px 24px rgba(20,33,28,.18);padding:8px;min-width:240px;max-height:260px;overflow:auto;font-size:12.5px;color:#1f2f42;";
      var r = b.getBoundingClientRect();
      box.style.left = Math.max(8, r.left - 180) + "px";
      box.style.top = (r.bottom + 6 + (window.scrollY || 0)) + "px";
      var head = document.createElement("div");
      head.textContent = "Recording backups (this device)";
      head.style.cssText = "font-weight:600;margin:2px 4px 6px;";
      box.appendChild(head);
      if (!list.length) {
        var no = document.createElement("div"); no.textContent = "No backups yet — they appear after your next recording."; no.style.cssText = "color:#5b6b7d;margin:4px;";
        box.appendChild(no);
      }
      list.slice(0, 10).forEach(function (m) {
        var row = document.createElement("button");
        row.type = "button";
        row.style.cssText = "display:block;width:100%;text-align:left;background:#f6f9fc;border:1px solid #e3eaf2;border-radius:8px;padding:6px 8px;margin:4px 0;cursor:pointer;";
        row.textContent = "⬇ " + fmtWhen(m.at) + " — " + (m.patient || "patient") + (m.open ? " (interrupted)" : "");
        row.addEventListener("click", function () { download(m.sess, m); });
        box.appendChild(row);
      });
      document.body.appendChild(box);
      setTimeout(function () {
        var close = function (ev) { if (!box.contains(ev.target) && ev.target.id !== BTN_ID) { safe(function () { box.remove(); }); document.removeEventListener("click", close, true); } };
        document.addEventListener("click", close, true);
      }, 50);
    });
  }
  function ensureBtn() {
    var h = host(); if (!h || document.getElementById(BTN_ID)) return;
    var b = document.createElement("button");
    b.id = BTN_ID; b.type = "button"; b.title = "Recording backups — every visit is audio-backed-up on this device";
    b.textContent = "🎧";
    b.style.cssText = "margin-left:6px;padding:2px 8px;border-radius:10px;border:1px solid #d5dde6;background:#f6f9fc;cursor:pointer;font-size:13px;vertical-align:middle;";
    b.addEventListener("click", function (ev) { safe(function () { ev.preventDefault(); ev.stopPropagation(); }); toggleList(); });
    h.appendChild(b);
  }

  /* ---------------- boot / revert ---------------- */
  function tick() {
    if (!wrapCore()) { wrapTries++; if (wrapTries > 300) stopPolls(); }
    safe(wrapProto);
    safe(ensureBtn);
    safe(sentinel);
  }
  function stopPolls() { if (wrapPoll) { clearInterval(wrapPoll); wrapPoll = null; } }
  wrapPoll = setInterval(function () { safe(tick); }, 2000);
  safe(tick);

  function revert() {
    stopPolls();
    safe(function () { if (wrapped) { window.startCapture = wrapped.sc; window.stopCapture = wrapped.xc; wrapped = null; } });
    safe(function () { protoWrapped.forEach(function (w) { w.proto.start = w.start; w.proto.stop = w.stop; w.proto.abort = w.abort; delete w.proto.__mlsRbWrapped; }); protoWrapped = []; });
    safe(stopBackup);
    safe(function () { var e1 = document.getElementById(CHIP_ID); if (e1) e1.remove(); });
    safe(function () { var e2 = document.getElementById(BTN_ID); if (e2) e2.remove(); });
    safe(function () { var e3 = document.getElementById(LIST_ID); if (e3) e3.remove(); });
    safe(function () { window.__mlsRecBackup.installed = false; });
    return true;
  }

  window.__mlsRecBackup = {
    installed: true,
    version: VERSION,
    asset: "feat_mls_record_backup.js",
    list: allSess,
    download: download,
    restarts: function () { return restarts; },
    /* ph-wake-1.0.0: observable so a test can assert the lock is actually held
       while recording, rather than merely that the code exists. */
    wakeSupported: wakeSupported,
    wakeHeld: function () { return !!wakeLock; },
    _grabWake: grabWake,
    _dropWake: dropWake,
    _startBackup: startBackup,
    _stopBackup: stopBackup,
    purge: purge,
    revert: revert
  };
})();
