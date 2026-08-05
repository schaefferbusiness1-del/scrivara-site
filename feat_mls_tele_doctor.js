/* ============================================================================
 * feat_mls_tele_doctor.js  ->  window.__mlsTeleDoctor  (td-1.0.0, 2026-08-05)
 * ----------------------------------------------------------------------------
 * The doctor's half of the post-op video visit. A patient home after a
 * procedure asks to talk; this surfaces the ask, lets the doctor ACCEPT it (the
 * owner's explicit choice — nothing rings through unaccepted), and runs the
 * call.
 *
 * SHIPS DARK, like the portal half. It polls /api/tele/requests only when the
 * app is signed in to the backend, and renders NOTHING unless that route
 * answers with a real pending request. The telehealth backend is on a branch at
 * the time of writing, so on today's production this module is silent — no
 * banner, no error, no dead control. It lights up when the backend deploys.
 *
 * IT DOES NOT PRESCRIBE. The patient's "I think I need something for the pain"
 * is shown as a SENTENCE THEY WROTE, deliberately styled as their words and not
 * as a pending order. The doctor prescribes in athenaOne by hand, as today.
 * Nothing here reaches a pharmacy or athenaOne.
 *
 * Additive and reversible: window.__mlsTeleDoctor.revert().
 * ES5. No dependencies.
 * ==========================================================================*/
;(function () {
  'use strict';
  try { if (window.__mlsTeleDoctor && window.__mlsTeleDoctor.installed) return; } catch (e) { return; }

  var VERSION = 'td-1.0.0';
  var BANNER = 'mlsTeleBanner', PANEL = 'mlsTelePanel', STYLE = 'mlsTeleDocCss';
  var LIST_MS = 15000, SIGNAL_MS = 1200;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function isFn(f) { return typeof f === 'function'; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function base() { return safe(function () { return window.BACKEND_URL || ''; }, ''); }
  function token() { return safe(function () { return isFn(window.bkToken) ? window.bkToken() : ''; }, ''); }
  function ready() { return !!(base() && token()); }

  function api(path, opts) {
    opts = opts || {};
    var headers = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token() };
    return fetch(base() + path, {
      method: opts.method || 'GET', headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return null; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
    });
  }

  /* ---------------------------------------------------------------- state */
  var listTimer = null, signalTimer = null;
  var active = null, pc = null, localStream = null, lastSeq = 0, killed = false;

  function stop(t) { if (t) { try { clearTimeout(t); } catch (e) {} } return null; }

  function css() {
    if ($(STYLE)) return;
    var st = document.createElement('style'); st.id = STYLE;
    st.textContent = [
      '#' + BANNER + '{position:fixed;left:50%;transform:translateX(-50%);top:12px;z-index:9600;max-width:min(560px,94vw);',
      '  background:#fff;border:1px solid #E7E5DD;border-radius:14px;box-shadow:0 14px 40px -12px rgba(20,33,28,.38);padding:13px 15px;',
      '  font:14px/1.5 "Public Sans",system-ui,sans-serif;color:#1A211C;}',
      '#' + BANNER + ' .tdh{font-weight:800;display:flex;align-items:center;gap:8px;margin-bottom:3px}',
      '#' + BANNER + ' .tdq{background:#FCFBF8;border:1px solid #EFEDE6;border-radius:10px;padding:8px 10px;margin:8px 0;font-size:13.5px;white-space:pre-wrap;overflow-wrap:anywhere}',
      '#' + BANNER + ' .tdrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:9px}',
      '#' + BANNER + ' button{min-height:44px;border-radius:999px;padding:10px 18px;font-weight:800;cursor:pointer;border:1px solid #DDD8CC;background:#fff}',
      '#' + BANNER + ' button.pri{background:#2E6A4B;color:#fff;border:0}',
      '#' + PANEL + '{position:fixed;right:16px;bottom:16px;z-index:9601;width:min(360px,92vw);background:#0d1512;border-radius:16px;',
      '  overflow:hidden;box-shadow:0 18px 50px -14px rgba(0,0,0,.55)}',
      '#' + PANEL + ' video.rem{width:100%;display:block;min-height:200px;background:#0d1512}',
      '#' + PANEL + ' video.loc{position:absolute;right:10px;bottom:56px;width:88px;border-radius:10px;border:2px solid rgba(255,255,255,.7)}',
      '#' + PANEL + ' .tdbar{display:flex;gap:8px;padding:9px;background:#111c18}',
      '#' + PANEL + ' .tdbar button{flex:1;min-height:44px;border:0;border-radius:999px;font-weight:800;cursor:pointer;background:#22322b;color:#fff}',
      '#' + PANEL + ' .tdbar button.end{background:#8d2f2f}',
      '@media (prefers-reduced-motion: reduce){#' + BANNER + '{transition:none}}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* --------------------------------------------------------------- banner */
  function clearBanner() { var b = $(BANNER); if (b && b.parentNode) b.parentNode.removeChild(b); }

  function showRequest(req) {
    css();
    var b = $(BANNER);
    if (!b) { b = document.createElement('div'); b.id = BANNER; b.setAttribute('role', 'alert'); document.body.appendChild(b); }
    var who = req.patientExternalId ? nameFor(req.patientExternalId) : '';
    var pain = (req.pain === null || req.pain === undefined) ? '' : (' · pain ' + req.pain + '/10');
    b.innerHTML =
      '<div class="tdh">📹 ' + esc(who || 'A post-op patient') + ' is asking to talk' + esc(pain) + '</div>' +
      '<div style="font-size:12.5px;color:#79837C">They are within the post-op window. Nothing starts until you accept.</div>' +
      '<div class="tdq">' + esc(req.reason || '') + '</div>' +
      (req.wantsMedication
        ? '<div style="font-size:12.5px;color:#7a5a16;background:#fff7e6;border:1px solid #f0d79a;border-radius:9px;padding:7px 10px">' +
          'They said they think they need something for the pain. <b>Their words, not an order</b> — prescribing stays in athenaOne.</div>'
        : '') +
      '<div class="tdrow">' +
        '<button type="button" class="pri" id="mlsTeleAccept">Accept and start video</button>' +
        '<button type="button" id="mlsTeleDecline">Can’t right now</button>' +
      '</div>';
    var a = $('mlsTeleAccept'); if (a) a.addEventListener('click', function () { accept(req.id); });
    var d = $('mlsTeleDecline'); if (d) d.addEventListener('click', function () { decline(req.id); });
  }

  /* the roster is the app's, not ours — never invent a name */
  function nameFor(externalId) {
    return safe(function () {
      var list = isFn(window.getPatients) ? window.getPatients() : [];
      for (var i = 0; i < list.length; i++) {
        if (String(list[i].id) === String(externalId) || String(list[i].externalId || '') === String(externalId)) return list[i].name || '';
      }
      return '';
    }, '');
  }

  function accept(id) {
    var btn = $('mlsTeleAccept'); if (btn) { btn.disabled = true; btn.textContent = 'Starting…'; }
    api('/api/tele/requests/' + id + '/accept', { method: 'POST' }).then(function (r) {
      if (!r.ok || !r.j || !r.j.request || !r.j.request.roomId) {
        if (btn) { btn.disabled = false; btn.textContent = 'Accept and start video'; }
        safe(function () { window.toast((r.j && r.j.error) || 'Could not start that visit.', 'err'); });
        return;
      }
      active = r.j.request;
      clearBanner();
      startCall();
    });
  }

  function decline(id) {
    clearBanner();
    api('/api/tele/requests/' + id + '/decline', { method: 'POST', body: { reason: 'The doctor could not take a video visit just now.' } });
    safe(function () { window.toast('Declined — the patient is told to call the office.', ''); });
  }

  /* ----------------------------------------------------------------- call */
  function panel() {
    css();
    var p = $(PANEL);
    if (p) return p;
    p = document.createElement('div'); p.id = PANEL;
    p.innerHTML =
      '<div style="position:relative">' +
        '<video class="rem" id="mlsTeleDocRemote" autoplay playsinline></video>' +
        '<video class="loc" id="mlsTeleDocLocal" autoplay playsinline muted></video>' +
      '</div>' +
      '<div class="tdbar">' +
        '<button type="button" id="mlsTeleDocMute">Mute</button>' +
        '<button type="button" class="end" id="mlsTeleDocEnd">End visit</button>' +
      '</div>';
    document.body.appendChild(p);
    var m = $('mlsTeleDocMute');
    if (m) m.addEventListener('click', function () {
      if (!localStream) return; var a = localStream.getAudioTracks()[0]; if (!a) return;
      a.enabled = !a.enabled; m.textContent = a.enabled ? 'Mute' : 'Unmute';
    });
    var e = $('mlsTeleDocEnd'); if (e) e.addEventListener('click', endVisit);
    return p;
  }

  function startCall() {
    if (!active || !active.roomId) return;
    panel();
    api('/api/tele/ice').then(function (r) {
      var cfg = { iceServers: (r.j && r.j.iceServers) || [{ urls: 'stun:stun.l.google.com:19302' }] };
      if (r.j && r.j.turn === false) {
        safe(function () { console.warn('[tele] no TURN credentials — a patient on mobile data may not connect (' + (r.j.degraded || '') + ')'); });
      }
      return navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then(function (stream) {
        localStream = stream;
        var lv = $('mlsTeleDocLocal'); if (lv) lv.srcObject = stream;
        pc = new RTCPeerConnection(cfg);
        stream.getTracks().forEach(function (t) { pc.addTrack(t, stream); });
        pc.ontrack = function (ev) {
          var rv = $('mlsTeleDocRemote');
          if (rv && ev.streams && ev.streams[0]) rv.srcObject = ev.streams[0];
        };
        pc.onicecandidate = function (ev) { if (ev.candidate) send({ candidate: ev.candidate }); };
        lastSeq = 0;
        signalTimer = stop(signalTimer);
        pump();
      });
    }).catch(function () {
      safe(function () { window.toast('Could not open the camera for this visit.', 'err'); });
      endVisit();
    });
  }

  function send(signal) {
    if (!active) return;
    api('/api/tele/room/' + active.roomId + '/signal', { method: 'POST', body: { signal: signal } });
  }

  function pump() {
    signalTimer = null;
    if (!active || !pc || killed) return;
    signalTimer = setTimeout(pump, SIGNAL_MS);
    api('/api/tele/room/' + active.roomId + '/signal?since=' + lastSeq).then(function (r) {
      if (!r.ok || !r.j) return;
      if (r.j.status === 'ended') { endVisit(true); return; }
      (r.j.signals || []).forEach(function (m) {
        lastSeq = Math.max(lastSeq, m.seq);
        var s = m.signal || {};
        if (s.sdp) {
          pc.setRemoteDescription(new RTCSessionDescription(s.sdp)).then(function () {
            if (s.sdp.type === 'offer') {
              return pc.createAnswer().then(function (a) { return pc.setLocalDescription(a); })
                .then(function () { send({ sdp: pc.localDescription }); });
            }
          }).catch(function () {});
        } else if (s.candidate) {
          try { pc.addIceCandidate(new RTCIceCandidate(s.candidate)); } catch (e) {}
        }
      });
    });
  }

  function endVisit(remote) {
    signalTimer = stop(signalTimer);
    try { if (pc) { pc.onicecandidate = null; pc.ontrack = null; pc.close(); } } catch (e) {}
    pc = null;
    try { if (localStream) localStream.getTracks().forEach(function (t) { t.stop(); }); } catch (e) {}
    localStream = null;
    var p = $(PANEL); if (p && p.parentNode) p.parentNode.removeChild(p);
    if (active && !remote) api('/api/tele/requests/' + active.id + '/end', { method: 'POST' });
    active = null;
  }

  /* ----------------------------------------------------------------- poll
   * NO STANDING INTERVAL. An interval never stops, and this one would run
   * forever on every doctor's tab for a backend that is not deployed yet.
   * Instead: a self-scheduling timeout that
   *   - stops PERMANENTLY the first time the route is absent (404/reject), so
   *     until the telehealth backend ships this module costs exactly one
   *     request per session and then nothing at all;
   *   - does not schedule while the tab is hidden — a hidden tab's timers are
   *     frozen anyway, so a running one is pure bookkeeping — and resumes on
   *     visibilitychange, which is also the moment a doctor comes back and
   *     most wants to see a waiting patient;
   *   - stands down entirely while a visit is live. */
  var absent = false, nextTimer = null;
  function schedule(ms) {
    if (killed || absent) return;
    if (nextTimer) { try { clearTimeout(nextTimer); } catch (e) {} }
    nextTimer = setTimeout(tick, ms || LIST_MS);
  }
  function tick() {
    nextTimer = null;
    if (killed || absent) return;
    if (active) { schedule(LIST_MS); return; }          /* a visit is running */
    if (safe(function () { return document.hidden; }, false)) return;  /* resume on visibilitychange */
    if (!ready()) { schedule(LIST_MS); return; }        /* not signed in to the backend yet */
    api('/api/tele/requests').then(function (r) {
      /* SHIPS DARK: the route not existing is a PERMANENT answer, not a retry. */
      if (r.status === 404 || r.status === 501) { absent = true; clearBanner(); return; }
      if (!r.ok || !r.j || !r.j.requests || !r.j.requests.length) { clearBanner(); schedule(LIST_MS); return; }
      var pending = null;
      for (var i = 0; i < r.j.requests.length; i++) { if (r.j.requests[i].status === 'pending') { pending = r.j.requests[i]; break; } }
      if (!pending) { clearBanner(); schedule(LIST_MS); return; }
      showRequest(pending);
      schedule(LIST_MS);
    }, function () { absent = true; clearBanner(); });   /* unreachable: stand down */
  }

  var api_ = {
    installed: true, version: VERSION, asset: 'feat_mls_tele_doctor.js',
    _tick: tick, killed: false,
    revert: function () {
      killed = true; api_.killed = true;
      listTimer = stop(listTimer); signalTimer = stop(signalTimer); nextTimer = stop(nextTimer);
      endVisit(true);
      clearBanner();
      var s = $(STYLE); if (s && s.parentNode) s.parentNode.removeChild(s);
      api_.installed = false;
      try { if (window.__mlsTeleDoctor === api_) delete window.__mlsTeleDoctor; } catch (e) { window.__mlsTeleDoctor = undefined; }
      return true;
    }
  };
  window.__mlsTeleDoctor = api_;

  function boot() {
    if (!window.RTCPeerConnection) return;
    safe(function () {
      document.addEventListener('visibilitychange', function () {
        if (!document.hidden && !killed && !absent && !nextTimer) schedule(300);
      });
    });
    tick();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
