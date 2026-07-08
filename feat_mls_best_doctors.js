/* ============================================================================
 * feat_mls_best_doctors.js -- __mlsBestDoctors v1.0.0 (2026-07-08)
 * ----------------------------------------------------------------------------
 * The DOCTOR-SIDE tie-in for the per-visit RATING engine + Best Doctors listing.
 * Loaded as a satellite by mls-connect.js (one guarded/reversible loader line).
 *
 * WHAT IT DOES (earned + passive, by design):
 *   When a visit is completed (the same sign / save-to-history signal
 *   __mlsCascade + feat_mls_review_request already key on), it sends the visit
 *   TRANSCRIPT (the same text /api/generate already receives) to the server
 *   scorer POST /api/ratings/visit. The SERVER de-identifies + scores it; this
 *   module never computes or sends a score. There is deliberately NO control for
 *   the doctor to set or raise the number -- the rating is EARNED from the real
 *   visit and immutable to the doctor.
 *   It shows a small, dismissible confirmation ("visit sentiment recorded") with
 *   a link to the doctor's own rating dashboard (mls-best-doctors-admin.html).
 *
 * PRIVACY: the transcript leaves the page ONLY to the same backend that already
 * generates the note from it; the server stores no transcript text, only numbers
 * (see visitRatings.js / RATING_METHODOLOGY.md). Patient name/DOB are passed
 * ONLY as redaction hints and are not stored. If not signed in (no token), it
 * no-ops silently -- nothing is sent, nothing is faked.
 *
 * Client-side de-dupe: a transcript is sent at most once per session (hash in
 * sessionStorage); the server de-dupes again by content hash regardless.
 *
 * Guard: window.__mlsBestDoctors. Revert: window.__mlsBestDoctors.revert().
 * Pure-ASCII, ES5/ES3 (JScript new Function validated). READ-ONLY wrt Athena.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsBestDoctors) return;

  var VER = '1.0.0';
  var BK = (function () { try { return (window.bkBase && window.bkBase()) || 'https://scrivara-backend.onrender.com'; } catch (e) { return 'https://scrivara-backend.onrender.com'; } })();
  var ADMIN_PAGE = 'mls-best-doctors-admin.html';
  var TRIGGERS = /review\s*&\s*sign|save to history|sign\s*&\s*save|^\s*sign\s*$/i;
  var MIN_CHARS = 220;                 // skip trivially short transcripts (server also gates)
  var TOAST_ID = 'mlsBdToast';
  var SENT_KEY = 'mlsBdSentHashes';

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function tok() { try { return sessionStorage.getItem('sf_bk_token') || localStorage.getItem('sf_bk_token') || ''; } catch (e) { return ''; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  function transcriptText() {
    var t = $('transcript');
    var v = t ? (t.value || t.textContent || '') : '';
    return String(v || '').replace(/^\s+|\s+$/g, '');
  }
  function activePt() {
    try { var p = window.activePatient; if (typeof p === 'function') p = p(); return (p && typeof p === 'object') ? p : {}; } catch (e) { return {}; }
  }
  /* small, dependency-free 32-bit hash for client-side de-dupe only */
  function hash32(s) {
    var h = 5381, i;
    for (i = 0; i < s.length; i++) { h = ((h << 5) + h + s.charCodeAt(i)) & 0xffffffff; }
    return (h >>> 0).toString(16);
  }
  function sentHashes() { try { return JSON.parse(sessionStorage.getItem(SENT_KEY) || '[]') || []; } catch (e) { return []; } }
  function rememberHash(h) { try { var a = sentHashes(); if (a.indexOf(h) === -1) { a.push(h); if (a.length > 200) a.shift(); sessionStorage.setItem(SENT_KEY, JSON.stringify(a)); } } catch (e) {} }

  function toast(html) {
    try {
      css();
      var old = $(TOAST_ID); if (old && old.parentNode) old.parentNode.removeChild(old);
      var d = document.createElement('div'); d.id = TOAST_ID;
      d.innerHTML = html + ' <button type="button" id="mlsBdX" aria-label="dismiss">&times;</button>';
      document.body.appendChild(d);
      var x = $('mlsBdX'); if (x) x.onclick = function () { if (d.parentNode) d.parentNode.removeChild(d); };
      setTimeout(function () { if (d && d.parentNode) d.parentNode.removeChild(d); }, 12000);
    } catch (e) {}
  }
  function css() {
    if ($('mlsBdCss')) return;
    var s = document.createElement('style'); s.id = 'mlsBdCss';
    s.textContent = [
      '#' + TOAST_ID + '{position:fixed;right:18px;bottom:132px;z-index:2147481200;max-width:320px;background:#0f2038;color:#eaf1ff;',
      'border:1px solid #24406e;border-radius:12px;padding:11px 13px;font:600 12.5px system-ui,Segoe UI,Arial;box-shadow:0 8px 24px rgba(10,25,55,.32)}',
      '#' + TOAST_ID + ' a{color:#7db4ff;text-decoration:none;font-weight:800}',
      '#' + TOAST_ID + ' button#mlsBdX{background:transparent;border:0;color:#9db6df;font-size:16px;cursor:pointer;float:right;margin:-2px -2px 0 6px;line-height:1}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- send the transcript for server-side scoring (earned; no score sent) ---- */
  function submitVisit(silent) {
    var t = tok();
    if (!t) return;                                  // not signed in -> no-op, nothing faked
    var text = transcriptText();
    if (text.length < MIN_CHARS) return;             // too little to score meaningfully
    var h = hash32(text);
    if (sentHashes().indexOf(h) !== -1) return;      // already sent this session

    var p = activePt();
    var body = {
      transcript: text,
      patient_external_id: (p && (p.external_id || p.id)) || '',
      patient_name: (p && p.name) || '',             // redaction HINT only (server does not store it)
      patient_dob: (p && p.dob) || '',
      occurred_at: (function () { try { return new Date().toISOString().slice(0, 10); } catch (e) { return ''; } })()
    };
    rememberHash(h);                                  // optimistic: avoid double-send races
    try {
      fetch(BK + '/api/ratings/visit', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
        body: JSON.stringify(body) })
        .then(function (r) { return (r && r.ok) ? r.json() : null; }, function () { return null; })
        .then(function (j) {
          if (!j || !j.ok) return;
          if (silent) return;
          var d = j.doctor || {};
          var msg;
          if (j.countsToward === false && j.reason) {
            msg = '\uD83D\uDCDD Visit recorded. ' + reasonText(j.reason);
          } else {
            var prog = (d.published ? ('Rating: ' + d.stars + '\u2605') : ('Earned rating in progress \u2014 ' + (d.countedVisits || 0) + '/' + (d.minVisits || '?') + ' visits'));
            msg = '\u2B50 Visit sentiment recorded (earned, server-computed). ' + prog + '. <a href="' + ADMIN_PAGE + '" target="_blank">View</a>';
          }
          toast(msg);
        }, function () {});
    } catch (e) {}
  }
  function reasonText(reason) {
    if (reason === 'too_short') return 'Too brief to score this time.';
    if (reason === 'not_engaged') return 'Not enough back-and-forth to score.';
    if (reason === 'dup_same_day') return 'Already counted for this patient today.';
    return 'It will count toward your earned rating. <a href="' + ADMIN_PAGE + '" target="_blank">View</a>';
  }

  /* ---- fire on the visit-completion signal (capture phase, same as review req) ---- */
  function onDocClick(e) {
    try {
      var el = e.target; if (!el) return;
      var btn = el.closest ? el.closest('button,a,[role="button"]') : null;
      var label = (btn ? (btn.textContent || '') : (el.textContent || '')).replace(/\s+/g, ' ');
      if (btn && TRIGGERS.test(label)) { setTimeout(function () { submitVisit(false); }, 1500); }
    } catch (err) {}
  }
  document.addEventListener('click', onDocClick, true);

  window.__mlsBestDoctors = {
    version: VER,
    submit: submitVisit,           /* manual trigger / exposed for tests */
    _hash: hash32,                 /* exposed for tests */
    _transcript: transcriptText,   /* exposed for tests */
    revert: function () {
      try { document.removeEventListener('click', onDocClick, true); } catch (e) {}
      try { var s = $('mlsBdCss'); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
      try { var d = $(TOAST_ID); if (d && d.parentNode) d.parentNode.removeChild(d); } catch (e) {}
      try { delete window.__mlsBestDoctors; } catch (e) { window.__mlsBestDoctors = undefined; }
      return 'reverted';
    }
  };
})();
