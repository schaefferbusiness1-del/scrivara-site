/* =========================================================================
 * MLS Scribe -- b46 agenda scope + version check  (__mlsR46B46)  2026-07-06
 * Additive, guarded, reversible IIFE. UI-only. Athena READ-ONLY.
 *
 *  A) Today's Agenda truly provider-scoped (queue item 3): the #mlsAgendaChip
 *     counter and the #mlsAgendaPop list previously counted EVERY provider's
 *     appointments (e.g. 132) — now both scope to the selected provider from
 *     #mlsProvChip using the same _calAppts data the calendar uses
 *     (24 today for Matthew Schaeffer, MD). Fail-open: if no provider is
 *     selected (or "All providers"), nothing changes.
 *  B) Version-update detection (owner request): the web app and the MLS
 *     Assistant report their versions to POST /api/versions/report; the
 *     backend's GET /api/versions says what's newest. If the installed
 *     assistant is OLD, a small friendly, dismissible, non-blocking banner
 *     appears (bottom-center) with one-line update instructions, and a row
 *     is added to Settings -> MLS Controls. Never blocks anything.
 *
 * Revert: window.__mlsR46B46_revert()
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__mlsR46B46) return;
  var API = 'https://scrivara-backend.onrender.com';
  var cleanup = [];
  function $(id) { return document.getElementById(id); }

  /* ---------- shared helpers ---------- */
  function todayLocal() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function activeProvider() {
    var el = $('mlsProvChip');
    var t = el ? (el.textContent || '').trim() : '';
    if (!t || /^all\b/i.test(t)) return null;
    return t;
  }
  function provAppts() {
    var prov = activeProvider();
    var A = window._calAppts;
    if (!prov || !Array.isArray(A)) return null;
    var td = todayLocal();
    var mine = A.filter(function (a) {
      return (a.day_local || a.appt_date) === td && (a.provider || '') === prov;
    });
    return mine.length ? { prov: prov, appts: mine } : null;
  }
  function t12(a) {
    if (a.time_display) return a.time_display;
    try {
      var d = new Date(a.start_at);
      var h = d.getHours(), m = ('0' + d.getMinutes()).slice(-2);
      var ap = h >= 12 ? 'PM' : 'AM'; h = h % 12; if (h === 0) h = 12;
      return h + ':' + m + ' ' + ap;
    } catch (e) { return ''; }
  }

  /* ---------- A) agenda chip + popup scoping ---------- */
  function fixChip() {
    try {
      var chip = $('mlsAgendaChip');
      var p = provAppts();
      if (!chip || !p) return;
      var seen = p.appts.filter(function (a) { return !!a.checked_in_at; }).length;
      var want = '🗓 Today’s agenda (' + seen + '/' + p.appts.length + ')';
      if (chip.textContent !== want) chip.textContent = want;
      chip.title = 'Appointments today for ' + p.prov;
    } catch (e) {}
  }
  function fixPop() {
    try {
      var pop = $('mlsAgendaPop');
      var p = provAppts();
      if (!pop || !p || pop.__r46done) return;
      pop.__r46done = 1;
      /* rebuild the list provider-scoped; keep it simple + readable */
      var seen = p.appts.filter(function (a) { return !!a.checked_in_at; }).length;
      var sorted = p.appts.slice().sort(function (a, b) { return new Date(a.start_at) - new Date(b.start_at); });
      var now = Date.now();
      var next = sorted.find(function (a) { return new Date(a.start_at).getTime() >= now && !a.checked_in_at; });
      var rows = sorted.map(function (a) {
        var badge = a.checked_in_at ? '<span style="background:#d8f5e2;color:#116635;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700">seen</span>'
          : (a === next ? '<span style="background:#fde68a;color:#7a5600;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700">next</span>'
            : '<span style="background:#e2e8f5;color:#3c4a6b;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:700">upcoming</span>');
        return '<div style="display:flex;align-items:center;gap:10px;padding:7px 12px;border-bottom:1px solid #edf1fa;font:13px system-ui;color:#16295b">'
          + '<span style="min-width:64px;color:#4a5f8f">' + t12(a) + '</span>'
          + '<span style="flex:1;font-weight:600">' + String(a.name || '(no name)').replace(/[<>&]/g, '') + '</span>' + badge + '</div>';
      }).join('');
      pop.innerHTML = '<div style="padding:10px 12px;font:11px system-ui;letter-spacing:.06em;color:#4a5f8f;display:flex;justify-content:space-between;align-items:center">'
        + '<b>TODAY’S AGENDA · ' + p.prov.replace(/[<>&]/g, '') + '</b><span>' + seen + ' / ' + p.appts.length + ' seen</span></div>'
        + '<div style="max-height:420px;overflow:auto">' + rows + '</div>';
    } catch (e) {}
  }
  var popMo = new MutationObserver(function (muts) {
    muts.forEach(function (mu) {
      mu.addedNodes && mu.addedNodes.forEach(function (nd) {
        if (nd.nodeType === 1 && (nd.id === 'mlsAgendaPop' || (nd.querySelector && nd.querySelector('#mlsAgendaPop')))) fixPop();
      });
    });
  });
  popMo.observe(document.body, { childList: true, subtree: true });
  cleanup.push(function () { popMo.disconnect(); });

  /* ---------- B) version check ---------- */
  var VKEY = 'mls_vercheck_dismissed_v1';
  function verNum(v) {
    var m = String(v || '').match(/\d+(?:\.\d+)*/);
    if (!m) return null;
    return m[0].split('.').reduce(function (acc, p, i) { return acc + Number(p) / Math.pow(1000, i); }, 0);
  }
  function dismissed() {
    try { return Date.now() - Number(localStorage.getItem(VKEY) || 0) < 24 * 3600 * 1000; } catch (e) { return false; }
  }
  function banner(msg, how) {
    if ($('mlsR46VerBanner') || dismissed()) return;
    var b = document.createElement('div');
    b.id = 'mlsR46VerBanner';
    b.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);z-index:2147483100;background:linear-gradient(180deg,#f2f6ff,#e6edfc);border:1px solid #c3d3f0;border-radius:14px;padding:12px 16px;max-width:520px;box-shadow:0 12px 32px rgba(10,25,60,.25);font:13px system-ui;color:#16295b;display:flex;gap:12px;align-items:center';
    b.innerHTML = '<span style="font-size:20px">🔄</span><div style="flex:1"><b>' + msg + '</b><br><span style="color:#4a5f8f">' + how + '</span></div>'
      + '<button id="mlsR46VerLater" style="background:#dbe7fb;color:#274b9f;border:1px solid #b9cdf2;border-radius:9px;padding:6px 12px;cursor:pointer;font-weight:600">Later</button>';
    document.body.appendChild(b);
    b.querySelector('#mlsR46VerLater').onclick = function () {
      try { localStorage.setItem(VKEY, String(Date.now())); } catch (e) {}
      b.remove();
    };
  }
  function controlsRow(txt, cls) {
    var rc = $('r44Controls');
    if (!rc || $('mlsR46VerRow')) return;
    var d = document.createElement('div');
    d.className = 'mls-r44-row'; d.id = 'mlsR46VerRow';
    d.innerHTML = '<label style="flex:1">🔄 MLS Assistant version</label><span class="mls-r44-badge ' + cls + '">' + txt + '</span>';
    rc.appendChild(d);
  }
  var verState = { latest: null, installed: null, stale: false };
  function checkVersions() {
    fetch(API + '/api/versions').then(function (r) { return r.json(); }).then(function (v) {
      if (!v || !v.ok) return;
      verState.latest = v.assistant;
      var inst = null;
      /* b48: ONLY trust a version the extension ITSELF announced (mlsExtVersion handshake).
         __mlsAsstFix.version is an app-side module version ('1.1.0') and caused a false
         'update available' nag for owners already on the newest build. No handshake -> no banner. */
      try { inst = window.__mlsExtReportedVersion || null; } catch (e) {}
      verState.installed = inst;
      /* report what this client runs (no PHI, just versions) */
      try {
        fetch(API + '/api/versions/report', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ component: 'webapp', build: (window.MLS_APP_BUILD || 'unknown'), version: inst || 'not-installed' }) });
      } catch (e) {}
      var iN = verNum(inst), lN = verNum(v.assistant);
      if (inst && iN != null && lN != null && iN < lN) {
        verState.stale = true;
        banner('A newer MLS Assistant is ready (v' + v.assistant + ' — you have v' + String(inst).replace(/[<>&]/g, '') + ').',
          (v.howToUpdate && v.howToUpdate.assistant) || 'Reinstall MLS Assistant from mlsscribe.com — takes under a minute, nothing is lost.');
      }
    }).catch(function () {});
  }
  function keepControlsRow() {
    if (!verState.latest) return;
    if (verState.stale) controlsRow('v' + verState.installed + ' → v' + verState.latest + ' available', 'wait');
    else if (verState.installed) controlsRow('v' + verState.installed + ' · up to date', 'on');
    else controlsRow('not detected on this browser', 'wait');
  }
  setTimeout(checkVersions, 4000);
  var _vLast = 0;  /* b47: RETRY the one-shot version check until it lands (cold backend = silent miss) */
  var iv = setInterval(function () { fixChip(); fixPop(); if (!verState.latest && Date.now() - _vLast > 30000) { _vLast = Date.now(); checkVersions(); } keepControlsRow(); }, 2000);
  cleanup.push(function () { clearInterval(iv); });
  fixChip();

  /* ---------- C) installed-assistant version listener (v1.50 handshake) ----------
     MLS Assist v1.50+ announces its installed version to this page via postMessage
     ({source:'mls-ext', type:'mlsExtVersion'}) and answers mlsAppGetVersion. Stash it
     on window.__mlsAsstFix so checkVersions() above can compare installed vs latest. */
  function onExtVersion(ev) {
    try {
      var d = ev && ev.data;
      if (!d || d.source !== 'mls-ext' || d.type !== 'mlsExtVersion' || !d.version) return;
      if (ev.origin !== location.origin) return;
      window.__mlsAsstFix = window.__mlsAsstFix || {};
      window.__mlsAsstFix.installed = true;
      window.__mlsAsstFix.version = String(d.version).slice(0, 20);
      window.__mlsExtReportedVersion = String(d.version).slice(0, 20);
    } catch (e) {}
  }
  window.addEventListener('message', onExtVersion);
  cleanup.push(function () { window.removeEventListener('message', onExtVersion); });
  try { window.postMessage({ source: 'mls-app', type: 'mlsAppGetVersion' }, location.origin); } catch (e) {}
  setTimeout(function () { try { window.postMessage({ source: 'mls-app', type: 'mlsAppGetVersion' }, location.origin); } catch (e) {} }, 6000);

  /* ---------- D) day-progress strip restore (owner: "counter strip disappeared") ----------
     The top "X / Y seen" strip (feat_mls_dayprogress.js) hides itself because
     window._heroTodayList went EMPTY after the Who's-Next takeover churn — the meter's
     source of truth dried up while the same data still sits in _calAppts. Repopulate the
     SAME shared source honestly from today's pulled schedule (name/time/provider only,
     dedup by name+time). The strip then mounts by itself, and the b40 R3 pack keeps its
     text provider-scoped ("X / Y seen", scoped to the selected doctor, honest
     "all providers" fallback). Data-refill only — no new UI, no duplicate strip. */
  function refillHeroToday() {
    try {
      if ((window._heroTodayList || []).length) return;
      var A = window._calAppts || []; if (!A.length) return;
      var td = todayLocal();
      var out = [], dupes = {};
      A.forEach(function (a) {
        if (!a) return;
        var dt = String(a.date || a.appt_date || '');
        if (dt.indexOf(td) < 0) return;
        var nm = String(a.patient || a.name || '').trim(); if (!nm) return;
        var k = nm.toLowerCase() + '|' + String(a.time || '');
        if (dupes[k]) return; dupes[k] = 1;
        out.push({ name: nm, time: a.time || '', provider: a.provider || a.doctor || '' });
      });
      if (out.length) window._heroTodayList = out;
    } catch (e) {}
  }
  refillHeroToday();
  var heroIv = setInterval(refillHeroToday, 5000);
  cleanup.push(function () { clearInterval(heroIv); });

  window.__mlsR46B46 = { v: '1.1.0', state: verState };
  window.__mlsR46B46_revert = function () {
    cleanup.forEach(function (f) { try { f(); } catch (e) {} });
    ['mlsR46VerBanner', 'mlsR46VerRow'].forEach(function (id) { var el = $(id); if (el) el.remove(); });
    delete window.__mlsR46B46; delete window.__mlsR46B46_revert;
    return 'reverted';
  };
})();


/* =========================================================================
 * MLS Scribe -- b45 polish hotfix  (__mlsR45Polish)  2026-07-06
 * Additive, guarded, reversible IIFE. UI-only. Athena READ-ONLY.
 *
 * 1) b44's Q15/Q20 capture/note/sign restyle was defeated by INLINE
 *    `background:#fff !important` styles that the b17 card-polish module
 *    writes directly onto #captureCard/#noteCard (inline+important beats
 *    any stylesheet). Fix: enforce the soft-blue palette ON the inline
 *    style itself (setProperty with 'important'), re-asserted via a
 *    style-attribute MutationObserver + 1500 ms keep-alive, same pattern
 *    b36/b42 use against competing layout timers.
 * 2) Queue item: live transcript (#transcript) auto-scrolls as text
 *    arrives — unless the doctor scrolled up to read (resumes when they
 *    return to within 60 px of the bottom).
 *
 * Revert: window.__mlsR45Polish_revert()
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__mlsR45Polish) return;
  var cleanup = [];
  var GRAD = 'linear-gradient(180deg,#eef3fe 0%,#e3ebfc 100%)';
  var CARD_IDS = ['captureCard', 'noteCard'];

  function paint(el) {
    if (!el) return;
    try {
      if (el.style.getPropertyValue('background-image') !== GRAD.replace('linear-gradient', 'linear-gradient')) {
        el.style.setProperty('background', GRAD, 'important');
        el.style.setProperty('border', '1px solid #c3d3f0', 'important');
        el.style.setProperty('border-radius', '16px', 'important');
        el.style.setProperty('box-shadow', '0 10px 28px rgba(23,49,110,.14)', 'important');
        el.style.setProperty('color', '#16295b', 'important');
      }
    } catch (e) {}
  }
  function paintAll() {
    CARD_IDS.forEach(function (id) { paint(document.getElementById(id)); });
    /* sign/EMR confirm surfaces (stylesheet from b44 already handles most;
       enforce only where inline whites exist) */
    try {
      var ep = document.getElementById('emrPanel');
      if (ep) [].forEach.call(ep.querySelectorAll('.card,section'), function (c) {
        var bg = (c.getAttribute('style') || '');
        if (/background:\s*rgb\(255,\s*255,\s*255\)/.test(bg)) paint(c);
      });
    } catch (e) {}
  }

  /* observers: re-assert if the b17 polish (or anything else) rewrites style */
  var obs = [];
  function watch(id) {
    var el = document.getElementById(id);
    if (!el || el.__r45watched) return;
    el.__r45watched = 1;
    var o = new MutationObserver(function () { paint(el); });
    o.observe(el, { attributes: true, attributeFilter: ['style'] });
    obs.push(o);
  }

  /* ---- transcript auto-scroll ---- */
  var userUp = false;
  function hookTranscript() {
    var t = document.getElementById('transcript');
    if (!t || t.__r45scroll) return;
    t.__r45scroll = 1;
    t.addEventListener('scroll', function () {
      userUp = (t.scrollHeight - t.scrollTop - t.clientHeight) > 60;
    }, { passive: true });
    var mo = new MutationObserver(function () {
      if (!userUp) { try { t.scrollTop = t.scrollHeight; } catch (e) {} }
    });
    mo.observe(t, { childList: true, subtree: true, characterData: true });
    obs.push(mo);
  }

  var iv = setInterval(function () {
    paintAll();
    CARD_IDS.forEach(watch);
    hookTranscript();
  }, 1500);
  cleanup.push(function () { clearInterval(iv); });
  paintAll(); CARD_IDS.forEach(watch); hookTranscript();

  window.__mlsR45Polish = { v: '1.0.0' };
  window.__mlsR45Polish_revert = function () {
    cleanup.forEach(function (f) { try { f(); } catch (e) {} });
    obs.forEach(function (o) { try { o.disconnect(); } catch (e) {} });
    CARD_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (el) ['background', 'border', 'border-radius', 'box-shadow', 'color'].forEach(function (p) {
        try { el.style.removeProperty(p); } catch (e) {}
      });
    });
    delete window.__mlsR45Polish; delete window.__mlsR45Polish_revert;
    return 'reverted';
  };
})();


/* =========================================================================
 * MLS Scribe -- b44 "Round 4"  (__mlsRound4B44)  2026-07-06
 * Additive, guarded, reversible IIFE. UI + self-serve GBP. Athena READ-ONLY.
 *
 *  Q1  Google Business Profile self-serve: any doctor connects THEIR Google
 *      account, links/creates their listing, MLS drafts + publishes with
 *      PER-CHANGE approval. Pre-fills from the doctor's own MLS data
 *      (/api/me name+specialty+email, /api/providers team, saved Reputation
 *      capture). Nothing hardcoded; quota-pending state handled honestly.
 *  Q5  Voice standalone: the 🎙️ button no longer opens the Assistant panel —
 *      it listens directly and routes the words to the same assistant brain.
 *  Q8  Friendly "no patients scheduled" state instead of raw HTTP 403.
 *  Q10 Settings → "🎛 MLS Controls": one panel for voice / tunnel /
 *      birthdays / quick-pick count / friendly errors / GBP status /
 *      plan status / backend health.
 *  Q11 Today's Agenda scoped to the selected provider (same source as the
 *      provider filter).
 *  Q12 Copilot product awareness: feature map + "where is / how do I" intents.
 *  Q13 Help guide gets a "What's new" section; top search indexes features.
 *  Q14 Search no-match → "Ask MLS Copilot" handoff row.
 *  Q15/Q20 Capture + note/sign cards restyled (soft blue, not stark white).
 *  Q16 Phone-mic start controls actually OPEN the phone QR.
 *  Q7  After a pull is stored server-side, an explicit "saved — safe to
 *      close athenaOne" confirmation is shown.
 *
 * Revert: window.__mlsRound4B44_revert()
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__mlsRound4B44) return;
  var API = 'https://scrivara-backend.onrender.com';
  var CTL_KEY = 'mls_ctl_v1';
  var cleanup = [];
  function $(id) { return document.getElementById(id); }
  function tok() { try { return localStorage.getItem('sf_bk_token') || ''; } catch (e) { return ''; } }
  function hjson(u, opt) {
    opt = opt || {};
    opt.headers = Object.assign({ Authorization: 'Bearer ' + tok() }, opt.headers || {});
    return fetch(API + u, opt).then(function (r) { return r.json().catch(function () { return {}; }); });
  }
  function ctl() {
    try { return Object.assign({ voiceStandalone: true, showVoice: true, showTunnel: true, birthdays: true, qpCount: 5, friendlyErrors: true }, JSON.parse(localStorage.getItem(CTL_KEY) || '{}')); }
    catch (e) { return { voiceStandalone: true, showVoice: true, showTunnel: true, birthdays: true, qpCount: 5, friendlyErrors: true }; }
  }
  function setCtl(k, v) { var c = ctl(); c[k] = v; try { localStorage.setItem(CTL_KEY, JSON.stringify(c)); } catch (e) {} applyCtl(); }

  /* ================= Q15/Q20 — capture/note/sign restyle ================= */
  var css = document.createElement('style');
  css.id = 'mlsR44Css';
  css.textContent = [
    /* capture + note cards: soft blue, not stark white */
    '#captureCard,#noteCard{background:linear-gradient(180deg,#eef3fe 0%,#e3ebfc 100%)!important;border:1px solid #c3d3f0!important;border-radius:16px!important;box-shadow:0 10px 28px rgba(23,49,110,.14)!important;}',
    '#captureCard h1,#captureCard h2,#captureCard h3,#noteCard h1,#noteCard h2,#noteCard h3{color:#16295b!important;}',
    '#captureCard textarea,#noteCard textarea,#captureCard input[type=text],#noteCard input[type=text]{background:#f6f9ff!important;border:1px solid #b9cdf2!important;border-radius:10px!important;color:#16295b!important;box-shadow:inset 0 1px 3px rgba(23,49,110,.08)!important;}',
    '#captureCard textarea:focus,#noteCard textarea:focus{outline:none!important;border-color:#4f7ce8!important;box-shadow:0 0 0 3px rgba(79,124,232,.25)!important;}',
    '#captureCard .pill,#captureCard [class*=dot-],#captureCard [class*=chip]{background:#dbe7fb!important;border:1px solid #b9cdf2!important;color:#274b9f!important;border-radius:999px!important;}',
    '#captureCard button[id*=start i],#captureCard .btn-primary{background:linear-gradient(135deg,#3b6fe0,#2c54b8)!important;border:none!important;border-radius:12px!important;box-shadow:0 6px 16px rgba(44,84,184,.35)!important;color:#fff!important;}',
    '.mls-r44-soft{background:linear-gradient(180deg,#eef3fe,#e3ebfc)!important;border:1px solid #c3d3f0!important;border-radius:14px!important;color:#16295b!important;}',
    /* sign / EMR confirm area */
    '#emrPanel .card,#emrPanel section,[id*=signCard i]{background:linear-gradient(180deg,#eef3fe,#e6edfc)!important;border:1px solid #c3d3f0!important;color:#16295b!important;}',
    /* GBP modal + controls panel */
    '.mls-r44-modal{position:fixed;inset:0;z-index:2147483000;background:rgba(10,20,45,.55);display:flex;align-items:center;justify-content:center;}',
    '.mls-r44-box{background:linear-gradient(180deg,#f2f6ff,#e6edfc);border:1px solid #c3d3f0;border-radius:18px;max-width:680px;width:94vw;max-height:86vh;overflow:auto;padding:22px;color:#16295b;font-family:system-ui;box-shadow:0 18px 48px rgba(10,25,60,.4);}',
    '.mls-r44-box h2{margin:0 0 6px;font-size:20px;}',
    '.mls-r44-box .sub{color:#4a5f8f;font-size:13px;margin-bottom:14px;}',
    '.mls-r44-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #d7e2f6;}',
    '.mls-r44-row:last-child{border-bottom:none;}',
    '.mls-r44-btn{background:linear-gradient(135deg,#3b6fe0,#2c54b8);color:#fff;border:none;border-radius:10px;padding:9px 15px;cursor:pointer;font-weight:600;}',
    '.mls-r44-btn.ghost{background:#dbe7fb;color:#274b9f;border:1px solid #b9cdf2;}',
    '.mls-r44-badge{border-radius:999px;padding:3px 10px;font-size:12px;font-weight:700;}',
    '.mls-r44-badge.on{background:#d8f5e2;color:#116635;}',
    '.mls-r44-badge.off{background:#fde3e3;color:#8f1d1d;}',
    '.mls-r44-badge.wait{background:#fdf3d8;color:#8a6210;}',
    '.mls-r44-field{width:100%;box-sizing:border-box;background:#f6f9ff;border:1px solid #b9cdf2;border-radius:10px;padding:8px;color:#16295b;margin:4px 0 2px;}',
    '.mls-r44-appr{display:flex;align-items:center;gap:8px;font-size:13px;color:#274b9f;margin-bottom:10px;}',
    '.mls-r44-toast{position:fixed;bottom:120px;left:50%;transform:translateX(-50%);z-index:2147483200;background:#123b23;color:#d8f5e2;padding:11px 18px;border-radius:12px;font-family:system-ui;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.35);}',
    '.mls-r44-empty{background:#dbe7fb;color:#274b9f;border:1px solid #b9cdf2;border-radius:10px;padding:10px 14px;font-weight:600;}',
    '.mls-r44-hidebday .mls-r44-bday, .mls-r44-hidebday [data-bday], .mls-r44-hidebday .wn-bday{display:none!important;}'
  ].join('\n');
  document.head.appendChild(css);

  function toast(msg, ms) {
    var t = document.createElement('div');
    t.className = 'mls-r44-toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, ms || 3500);
  }
  function modal(html) {
    var m = document.createElement('div');
    m.className = 'mls-r44-modal';
    m.innerHTML = '<div class="mls-r44-box">' + html + '</div>';
    m.addEventListener('click', function (e) { if (e.target === m) m.remove(); });
    document.body.appendChild(m);
    return m;
  }

  /* ================= Q1 — GBP self-serve ================= */
  async function gbpPrefill() {
    var me = {}, provs = [];
    try { me = (await hjson('/api/me')).user || {}; } catch (e) {}
    try { var p = await hjson('/api/providers'); provs = (p.providers || p || []).map(function (x) { return x.name || x; }).filter(function (x) { return typeof x === 'string'; }).slice(0, 12); } catch (e) {}
    var rep = {};
    try {
      Object.keys(localStorage).forEach(function (k) {
        if (/rep|google|practice/i.test(k) && k.indexOf('sf_') === 0) {
          try { var v = JSON.parse(localStorage.getItem(k)); if (v && (v.practice || v.address || v.phone || v.website)) rep = Object.assign(rep, v); } catch (e) {}
        }
      });
    } catch (e) {}
    return {
      doctor: me.name || '',
      email: me.email || '',
      specialty: me.specialty || '',
      practice: rep.practice || rep.name || '',
      address: rep.address || '',
      phone: rep.phone || '',
      website: rep.website || 'https://mlsscribe.com',
      providers: provs
    };
  }
  async function openGbp() {
    var m = modal('<h2>🌟 Your Google Business Profile</h2><div class="sub">Loading status…</div>');
    var box = m.querySelector('.mls-r44-box');
    var st = await hjson('/api/gbp/status');
    var pre = await gbpPrefill();
    var head = '<h2>🌟 Your Google Business Profile</h2>'
      + '<div class="sub">Sign in with <b>your own</b> Google account. MLS drafts the listing from what it already knows about your practice — and <b>nothing publishes without your approval, change by change</b>.</div>';
    if (!st.configured) {
      box.innerHTML = head + '<div class="mls-r44-empty">Google sign-in is not configured on the server yet (missing OAuth keys). Ask MLS support.</div>';
      return;
    }
    if (!st.connected) {
      box.innerHTML = head
        + '<div class="mls-r44-row"><span class="mls-r44-badge off">Not connected</span><span>Connect your Google account to begin.</span></div>'
        + '<div style="margin-top:12px"><button class="mls-r44-btn" id="r44GbpConnect">🔗 Connect my Google account</button> '
        + '<button class="mls-r44-btn ghost" id="r44GbpClose">Close</button></div>'
        + '<div class="sub" style="margin-top:12px">After Google confirms, come back here — your listing options appear automatically.</div>';
      box.querySelector('#r44GbpConnect').onclick = async function () {
        var c = await hjson('/api/gbp/connect');
        if (c.url) window.open(c.url, '_blank'); else toast('Could not start Google sign-in: ' + (c.error || 'unknown'));
      };
      box.querySelector('#r44GbpClose').onclick = function () { m.remove(); };
      return;
    }
    /* connected */
    var loc = await hjson('/api/gbp/locations');
    var listHtml = '';
    if (loc.quotaPending) {
      listHtml = '<div class="mls-r44-row"><span class="mls-r44-badge wait">Waiting on Google</span><span>' + (loc.hint || 'Google is still approving Business Profile API access — connected and ready, this lights up automatically once approved.') + '</span></div>';
    } else if (loc.locations && loc.locations.length) {
      listHtml = loc.locations.map(function (l, i) {
        return '<div class="mls-r44-row"><input type="radio" name="r44loc" value="' + l.name + '"' + (i === 0 ? ' checked' : '') + '><div><b>' + (l.title || '(unnamed)') + '</b><br><span class="sub">' + (l.address || '') + '</span></div></div>';
      }).join('');
    } else {
      listHtml = '<div class="mls-r44-empty">No listing found on this Google account yet — use "Create one" below (pre-filled for you).</div>';
    }
    var draftDesc = (pre.practice ? pre.practice + ' — ' : '') + (pre.specialty ? pre.specialty + ' practice' : 'medical practice')
      + (pre.doctor ? ' led by ' + pre.doctor : '')
      + (pre.providers.length > 1 ? ', with ' + pre.providers.slice(0, 5).join(', ') : '')
      + '. Same-week appointments, honest guidance, and modern AI-assisted documentation so your doctor spends the visit with YOU, not the keyboard.';
    box.innerHTML = head
      + '<div class="mls-r44-row"><span class="mls-r44-badge on">Connected</span><span>' + (st.email || 'Google account linked') + '</span>'
      + '<button class="mls-r44-btn ghost" id="r44GbpDis" style="margin-left:auto">Disconnect</button></div>'
      + '<h3 style="margin:14px 0 4px">1 · Your listing</h3>' + listHtml
      + '<div style="margin:8px 0 16px"><a target="_blank" href="https://business.google.com/create?hl=en" id="r44GbpCreate">➕ Create one on Google (opens pre-filled helper below)</a></div>'
      + '<h3 style="margin:14px 0 4px">2 · MLS-drafted improvements <span class="sub">(pre-filled from your MLS account — edit anything)</span></h3>'
      + '<label>Business description</label><textarea class="mls-r44-field" id="r44fDesc" rows="4">' + draftDesc + '</textarea>'
      + '<div class="mls-r44-appr"><input type="checkbox" id="r44aDesc"><label for="r44aDesc">I approve publishing this description</label></div>'
      + '<label>Website</label><input class="mls-r44-field" id="r44fWeb" value="' + pre.website + '">'
      + '<div class="mls-r44-appr"><input type="checkbox" id="r44aWeb"><label for="r44aWeb">I approve publishing this website</label></div>'
      + '<label>Phone</label><input class="mls-r44-field" id="r44fPhone" value="' + (pre.phone || '') + '">'
      + '<div class="mls-r44-appr"><input type="checkbox" id="r44aPhone"><label for="r44aPhone">I approve publishing this phone</label></div>'
      + '<div style="margin-top:10px"><button class="mls-r44-btn" id="r44GbpPub">🚀 Publish ONLY the approved changes</button> '
      + '<button class="mls-r44-btn ghost" id="r44GbpCopy">📋 Copy pack (for manual setup)</button></div>'
      + '<div class="sub" id="r44GbpMsg" style="margin-top:10px"></div>';
    box.querySelector('#r44GbpDis').onclick = async function () { await hjson('/api/gbp/disconnect', { method: 'POST' }); m.remove(); toast('Google disconnected.'); };
    box.querySelector('#r44GbpCopy').onclick = function () {
      var pack = 'Business name: ' + (pre.practice || '(your practice)') + '\nDescription: ' + $('r44fDesc').value + '\nWebsite: ' + $('r44fWeb').value + '\nPhone: ' + $('r44fPhone').value + '\nProviders: ' + pre.providers.join(', ');
      navigator.clipboard && navigator.clipboard.writeText(pack);
      toast('Copied — paste into Google\'s create-listing form.');
    };
    box.querySelector('#r44GbpPub').onclick = async function () {
      var sel = box.querySelector('input[name="r44loc"]:checked');
      var msg = box.querySelector('#r44GbpMsg');
      var changes = [];
      if ($('r44aDesc').checked) changes.push({ field: 'description', value: $('r44fDesc').value, approvedByDoctor: true });
      if ($('r44aWeb').checked) changes.push({ field: 'website', value: $('r44fWeb').value, approvedByDoctor: true });
      if ($('r44aPhone').checked && $('r44fPhone').value.trim()) changes.push({ field: 'phone', value: $('r44fPhone').value, approvedByDoctor: true });
      if (!changes.length) { msg.textContent = 'Tick "I approve" on at least one change first — MLS never publishes without your approval.'; return; }
      if (!sel) { msg.textContent = loc.quotaPending ? 'Publishing opens automatically once Google finishes approving API access — your approved text is safe to re-send then.' : 'Pick your listing first (or create one).'; return; }
      msg.textContent = 'Publishing approved changes…';
      var locId = sel.value.replace(/^.*(locations\/)/, 'locations/');
      var r = await hjson('/api/gbp/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: locId, changes: changes }) });
      msg.textContent = r.ok ? '✅ Published: ' + (r.published || []).join(', ') : (r.quotaPending ? '⏳ ' + r.error : '❌ ' + (r.error || 'failed'));
    };
  }
  window.__mlsOpenGbp = openGbp;

  /* ================= Q5 — voice standalone ================= */
  function voiceClick(ev) {
    if (!ctl().voiceStandalone) return; /* toggle off -> original behavior */
    var b = ev.target && ev.target.closest && ev.target.closest('#mlsCopVoiceBtn');
    if (!b) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { toast('Voice not supported in this browser.'); return; }
    if (window.__r44Rec) { try { window.__r44Rec.stop(); } catch (e) {} window.__r44Rec = null; return; }
    var rec = new SR();
    window.__r44Rec = rec;
    rec.lang = 'en-US'; rec.interimResults = false; rec.continuous = false;
    rec.onresult = function (e) {
      var txt = ''; for (var i = e.resultIndex; i < e.results.length; i++) txt += e.results[i][0].transcript;
      txt = (txt || '').trim();
      if (txt && window.__mlsAsstFix && typeof window.__mlsAsstFix._handleSend === 'function') {
        toast('🎙️ "' + txt.slice(0, 80) + '" → MLS');
        try { window.__mlsAsstFix._handleSend(txt); } catch (err) { toast('Voice command failed: ' + err.message); }
      } else if (txt) { toast('Heard: "' + txt.slice(0, 80) + '" — assistant brain unavailable.'); }
    };
    rec.onend = function () { window.__r44Rec = null; };
    rec.onerror = function () { window.__r44Rec = null; };
    try { rec.start(); } catch (e) { window.__r44Rec = null; }
  }
  document.addEventListener('click', voiceClick, true);
  cleanup.push(function () { document.removeEventListener('click', voiceClick, true); });

  /* ================= Q8 — friendly empty-day state ================= */
  var errRe = /Reading appointments for (the )?selected date failed[^]{0,40}(403|HTTP)/i;
  function sweepErrors(root) {
    if (!ctl().friendlyErrors) return;
    try {
      var walker = document.createTreeWalker(root || document.body, NodeFilter.SHOW_TEXT);
      var n; var hits = [];
      while ((n = walker.nextNode())) { if (errRe.test(n.nodeValue || '')) hits.push(n); }
      hits.forEach(function (t) {
        var el = t.parentElement; if (!el || el.__r44done) return;
        el.__r44done = 1;
        el.textContent = '📅 No patients scheduled for this date.';
        el.classList.add('mls-r44-empty');
      });
    } catch (e) {}
  }
  var errMo = new MutationObserver(function (muts) { muts.forEach(function (mu) { mu.addedNodes && mu.addedNodes.forEach(function (nd) { if (nd.nodeType === 1) sweepErrors(nd); }); }); });
  errMo.observe(document.body, { childList: true, subtree: true });
  cleanup.push(function () { errMo.disconnect(); });
  sweepErrors();

  /* ================= Q16 — phone-mic opens the QR ================= */
  function qrClick(ev) {
    var b = ev.target && ev.target.closest && ev.target.closest('button,a');
    if (!b) return;
    var t = (b.textContent || '').toLowerCase();
    if (t.indexOf('phone mic') < 0 || t.indexOf('stop') >= 0) return;
    var qr = $('phoneMicQR') || $('mlsGpQrImg');
    if (!qr) return;
    var m = modal('<h2>📱 Connect your phone</h2><div class="sub">Scan with your phone camera — recording continues there even if this computer sleeps.</div><div style="text-align:center;background:#fff;border-radius:14px;padding:18px"><img id="r44qr" style="width:260px;height:260px" alt="phone QR"></div><div style="margin-top:12px;text-align:right"><button class="mls-r44-btn ghost" id="r44qrClose">Close</button></div>');
    m.querySelector('#r44qr').src = qr.src;
    m.querySelector('#r44qrClose').onclick = function () { m.remove(); };
  }
  document.addEventListener('click', qrClick, true);
  cleanup.push(function () { document.removeEventListener('click', qrClick, true); });

  /* ================= Q12/Q13/Q14 — product map, search, copilot ================= */
  var MAP = [
    { k: 'voice copilot microphone talk', name: '🎙️ MLS Copilot Voice', where: 'Bottom-left button', how: 'Tap it and just talk — "start a visit for Adam", "generate the note". Red pulse = listening. It no longer opens the chat panel; it acts directly.' },
    { k: 'assistant chat help ask', name: 'MLS Assistant', where: 'Bottom-left "MLS Assistant" button', how: 'One assistant for everything: schedule questions, patient loads, athena status. Has its own 🎤 inside.' },
    { k: 'google business profile reputation reviews listing', name: '🌟 Google Business Profile', where: 'Settings → MLS Controls → Reputation', how: 'Connect YOUR Google account, MLS drafts the listing from your practice data, you approve each change before anything publishes.' },
    { k: 'settings controls toggles preferences', name: '🎛 MLS Controls', where: 'Settings (gear) → MLS Controls', how: 'Every new feature has a switch here: voice, tunnel mode, birthdays, quick-pick size, friendly errors.' },
    { k: 'tunnel simple mode guided', name: 'Simple mode (tunnel)', where: 'Visit screen — green "Simple mode" button', how: 'Full-screen 5-step guided visit. Can be shown/hidden in MLS Controls.' },
    { k: 'guide tour how to help', name: '📖 How-to guide + tour', where: 'Top bar ❓ Help / Menu → How-To Guide', how: 'The one current guide; the spotlight tour walks the real UI.' },
    { k: 'qr phone mobile record', name: '📱 Phone recording', where: 'Patient page — phone mic button', how: 'Click it to SHOW the QR; scan with your phone to record there (crash-proof, auto-retry).' },
    { k: 'send athena writeback emr sign', name: '🚀 Send full visit to Athena', where: 'Visit flow step 4 / EMR sections modal', how: 'Review & confirm each section; NOTHING writes to athenaOne without your per-section confirm. Orders are never possible.' },
    { k: 'study group research cohort', name: 'Study Groups PRO', where: 'AI Studio → advanced section', how: 'Build cohorts by procedure, auto-format all patients, run a study (graph/Excel/PDF + premium AI narrative).' },
    { k: 'pay report money premium billing', name: '💵 Pay Reports', where: 'Top of AI Studio and Calendar', how: 'Premium feature — per-provider payment reporting.' },
    { k: 'agenda today schedule quick pick', name: "Today's Agenda / quick-pick", where: 'Home hero strip', how: 'Shows the selected doctor\'s patients (scoped like Who\'s Next). Chips show 🎂 birthdays and 12-hour times.' },
    { k: 'dedupe duplicates patients merge history', name: 'Duplicate protection + visit history', where: 'Automatic (server-side)', how: 'Pulls can never create duplicate patients; every visit is stored individually in the patient\'s encrypted record.' }
  ];
  window.__mlsProductMap = MAP;
  /* copilot intents */
  try {
    if (window.__mlsAsstFix && typeof window.__mlsAsstFix.registerIntent === 'function') {
      window.__mlsAsstFix.registerIntent(/where (is|do i find)|how do i (use|open|turn|find)|what('| i)s new/i, function (q) {
        var ql = q.toLowerCase();
        var hit = MAP.find(function (m2) { return m2.k.split(' ').some(function (w) { return ql.indexOf(w) >= 0; }); });
        if (hit) return hit.name + ' — ' + hit.where + '. ' + hit.how;
        return 'New in MLS: ' + MAP.map(function (m2) { return m2.name; }).join(' · ') + '. Ask me about any of them, or open Settings → 🎛 MLS Controls.';
      });
    }
  } catch (e) {}
  /* search integration: feature rows + copilot handoff */
  function searchHook() {
    var inp = $('mlsPqsInput'), panel = $('mlsPqsPanel');
    if (!inp || !panel || inp.__r44hook) return;
    inp.__r44hook = 1;
    var mo2 = new MutationObserver(function () {
      try {
        var q = (inp.value || '').trim(); if (q.length < 2) return;
        if (panel.querySelector('.mls-r44-feat')) return;
        var ql = q.toLowerCase();
        var feats = MAP.filter(function (m2) { return (m2.k + ' ' + m2.name).toLowerCase().indexOf(ql) >= 0 || ql.split(/\s+/).some(function (w) { return w.length > 2 && m2.k.indexOf(w) >= 0; }); }).slice(0, 3);
        var noRes = /no (results|matches)|nothing found/i.test(panel.textContent || '') || !panel.querySelector('[class*=row],[class*=item],li,a,button');
        var frag = document.createElement('div');
        frag.className = 'mls-r44-feat';
        var html = feats.map(function (f) { return '<div class="mls-r44-row" style="cursor:default"><span>✨</span><div><b>' + f.name + '</b> — ' + f.where + '<br><span style="font-size:12px;color:#4a5f8f">' + f.how + '</span></div></div>'; }).join('');
        if (noRes || !feats.length) html += '<div class="mls-r44-row" style="cursor:pointer" id="r44AskCop"><span>🤖</span><b>Ask MLS Copilot: "' + q.replace(/[<>&]/g, '') + '"</b></div>';
        if (!html) return;
        frag.innerHTML = html;
        panel.appendChild(frag);
        var ask = frag.querySelector('#r44AskCop');
        if (ask) ask.onclick = function () {
          try { var fab = $('mlsAsstFab'); if (fab) fab.click(); } catch (e) {}
          try { window.__mlsAsstFix._handleSend(q); } catch (e) {}
        };
      } catch (e) {}
    });
    mo2.observe(panel, { childList: true, subtree: true });
    cleanup.push(function () { mo2.disconnect(); });
  }
  /* help guide addendum */
  function helpHook() {
    var g = $('mlsG33Modal');
    if (!g || g.__r44help) return;
    g.__r44help = 1;
    var box = g.querySelector('[class*=body],[class*=content]') || g.firstElementChild || g;
    var sec = document.createElement('div');
    sec.className = 'mls-r44-soft';
    sec.style.cssText = 'margin:14px;padding:14px;';
    sec.innerHTML = '<b>🆕 What\'s new (July 6)</b><ul style="margin:8px 0 0 18px;padding:0">'
      + MAP.slice(0, 8).map(function (f) { return '<li style="margin:4px 0"><b>' + f.name + '</b> — ' + f.where + '</li>'; }).join('') + '</ul>';
    box.appendChild(sec);
  }

  /* ================= Q11 — agenda provider scoping ================= */
  function scopeAgenda() {
    try {
      var sel = document.querySelector('select[id*="prov" i], select[class*="prov" i]');
      var hero = $('heroToday');
      if (!sel || !hero) return;
      var want = (sel.options[sel.selectedIndex] || {}).text || '';
      if (!want || /all/i.test(want)) { [].forEach.call(hero.children, function (c) { c.style.removeProperty('display'); }); return; }
      var wantKey = want.toLowerCase().replace(/[^a-z ]/g, '').replace(/\s+/g, ' ').trim();
      [].forEach.call(hero.querySelectorAll('[data-provider],[class*=chip],[class*=card],li'), function (c) {
        var p = (c.getAttribute('data-provider') || c.textContent || '').toLowerCase();
        var mine = wantKey.split(' ').filter(function (w) { return w.length > 2; }).some(function (w) { return p.indexOf(w) >= 0; });
        var hasProv = /,\s*(md|do|pa-c|np)|dr\.|schaeffer|edwards|johnson|hill/i.test(p) || c.hasAttribute('data-provider');
        if (hasProv && !mine) c.style.setProperty('display', 'none', 'important');
        else c.style.removeProperty('display');
      });
    } catch (e) {}
  }

  /* ================= Q7 — "saved, safe to close" confirmation ================= */
  var oFetch = window.fetch;
  var wrappedFetch = function (u, opt) {
    var p = oFetch.apply(this, arguments);
    try {
      var url = typeof u === 'string' ? u : (u && u.url) || '';
      if (/\/api\/appointments\/import/.test(url)) {
        p.then(function (r) {
          if (r && r.ok) { try { r.clone().json().then(function (j) { toast('✓ Pull saved to MLS cloud (' + (j.stored || j.count || 'all') + ' records) — safe to close athenaOne.', 5000); }); } catch (e) { toast('✓ Pull saved to MLS cloud — safe to close athenaOne.', 5000); } }
        }).catch(function () {});
      }
    } catch (e) {}
    return p;
  };
  wrappedFetch.__r44 = 1;
  if (!oFetch.__r44) window.fetch = wrappedFetch;
  cleanup.push(function () { if (window.fetch === wrappedFetch) window.fetch = oFetch; });

  /* ================= Q10 — Settings control panel ================= */
  function buildControls() {
    var sm = $('settingsModal');
    if (!sm || $('r44Controls')) return;
    var host = sm.querySelector('[class*=body],[class*=content]') || sm.firstElementChild || sm;
    var c = ctl();
    var sec = document.createElement('div');
    sec.id = 'r44Controls';
    sec.className = 'mls-r44-soft';
    sec.style.cssText = 'margin:12px;padding:16px;';
    function row(label, id, on) {
      return '<div class="mls-r44-row"><label style="flex:1">' + label + '</label><input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '></div>';
    }
    sec.innerHTML = '<b style="font-size:16px">🎛 MLS Controls</b><div class="sub">Every new feature, one place.</div>'
      + row('🎙️ Voice button acts standalone (no chat panel pop-up)', 'r44cVoiceSA', c.voiceStandalone)
      + row('Show the 🎙️ voice button', 'r44cVoice', c.showVoice)
      + '<div class="mls-r44-row"><label style="flex:1">Show "Simple mode (tunnel)" guided view</label><input type="checkbox" id="r44cTunnel"' + (c.showTunnel ? ' checked' : '') + '><button class="mls-r44-btn ghost" id="r44cTunnelGo">🎯 Open</button></div>'
      + row('🎂 Show birthdays on patient chips', 'r44cBday', c.birthdays)
      + row('Friendly "no patients scheduled" messages (instead of HTTP errors)', 'r44cErr', c.friendlyErrors)
      + '<div class="mls-r44-row"><label style="flex:1">Quick-pick patients shown</label><select id="r44cQp" class="mls-r44-field" style="width:70px;margin:0"><option' + (c.qpCount === 3 ? ' selected' : '') + '>3</option><option' + (c.qpCount === 5 ? ' selected' : '') + '>5</option><option' + (c.qpCount === 8 ? ' selected' : '') + '>8</option></select></div>'
      + '<div class="mls-r44-row"><label style="flex:1">🌟 Google Business Profile</label><span class="mls-r44-badge wait" id="r44cGbpSt">checking…</span><button class="mls-r44-btn ghost" id="r44cGbpOpen">Open</button></div>'
      + '<div class="mls-r44-row"><label style="flex:1">Plan</label><span class="mls-r44-badge on" id="r44cPlan">checking…</span></div>'
      + '<div class="mls-r44-row"><label style="flex:1">MLS cloud backend</label><span class="mls-r44-badge wait" id="r44cBk">checking…</span></div>';
    host.appendChild(sec);
    sec.querySelector('#r44cVoiceSA').onchange = function () { setCtl('voiceStandalone', this.checked); };
    sec.querySelector('#r44cVoice').onchange = function () { setCtl('showVoice', this.checked); };
    sec.querySelector('#r44cTunnel').onchange = function () { setCtl('showTunnel', this.checked); };
    sec.querySelector('#r44cTunnelGo').onclick = function () { var tl = $('mlsP1TunnelLaunch'); if (tl) { $('settingsModal') && ($('settingsModal').style.display = 'none'); tl.click(); } else { toast('Tunnel launcher not found on this screen.'); } };
    sec.querySelector('#r44cBday').onchange = function () { setCtl('birthdays', this.checked); };
    sec.querySelector('#r44cErr').onchange = function () { setCtl('friendlyErrors', this.checked); };
    sec.querySelector('#r44cQp').onchange = function () { setCtl('qpCount', Number(this.value)); };
    sec.querySelector('#r44cGbpOpen').onclick = function () { openGbp(); };
    hjson('/api/gbp/status').then(function (s) {
      var el = $('r44cGbpSt'); if (!el) return;
      el.textContent = s.connected ? ('connected' + (s.email ? ' · ' + s.email : '')) : (s.configured ? 'ready to connect' : 'not configured');
      el.className = 'mls-r44-badge ' + (s.connected ? 'on' : 'wait');
    });
    hjson('/api/me').then(function (r) {
      var u = r.user || {}; var el = $('r44cPlan'); if (!el) return;
      el.textContent = u.premium ? 'Premium' : (u.lite ? 'Lite' : (u.access || 'Standard'));
      el.className = 'mls-r44-badge ' + (u.premium ? 'on' : 'wait');
    });
    fetch(API + '/api/health').then(function (r) { return r.json(); }).then(function (h) {
      var el = $('r44cBk'); if (!el) return;
      el.textContent = h.ok ? 'connected' : 'trouble';
      el.className = 'mls-r44-badge ' + (h.ok ? 'on' : 'off');
    }).catch(function () { var el = $('r44cBk'); if (el) { el.textContent = 'unreachable'; el.className = 'mls-r44-badge off'; } });
  }

  /* ================= apply toggles ================= */
  function applyCtl() {
    var c = ctl();
    var v = $('mlsCopVoiceBtn'); if (v) v.style.setProperty('display', c.showVoice ? '' : 'none', c.showVoice ? '' : 'important');
    var tn = $('mlsP1TunnelLaunch'); if (tn) tn.style.setProperty('display', c.showTunnel ? '' : 'none', c.showTunnel ? '' : 'important');
    document.body.classList.toggle('mls-r44-hidebday', !c.birthdays);
    /* birthday emoji nodes */
    try { [].forEach.call(document.querySelectorAll('span,em,i,b,div'), function (n) { if (n.childElementCount === 0 && /🎂/.test(n.textContent || '') && (n.textContent || '').length < 30) n.classList.add('mls-r44-bday'); }); } catch (e) {}
    /* quick-pick count: hide chips beyond N in Who's Next strip */
    try {
      var wn = document.querySelector('[id*="whosnext" i],[id*="wn" i][class*=strip],[class*="whosnext" i]');
      if (wn) { var chips = wn.querySelectorAll('[class*=chip]'); [].forEach.call(chips, function (ch, i) { ch.style.setProperty('display', i < c.qpCount ? '' : 'none', i < c.qpCount ? '' : 'important'); }); }
    } catch (e) {}
  }

  /* ================= keep-alive ================= */
  var iv = setInterval(function () { buildControls(); searchHook(); helpHook(); scopeAgenda(); applyCtl(); sweepErrors(); }, 2000);
  cleanup.push(function () { clearInterval(iv); });
  buildControls(); searchHook(); applyCtl();

  window.__mlsRound4B44 = { v: '1.0.0', openGbp: openGbp, ctl: ctl, setCtl: setCtl, map: MAP };
  window.__mlsRound4B44_revert = function () {
    cleanup.forEach(function (f) { try { f(); } catch (e) {} });
    var el = $('mlsR44Css'); if (el) el.remove();
    el = $('r44Controls'); if (el) el.remove();
    document.body.classList.remove('mls-r44-hidebday');
    delete window.__mlsRound4B44; delete window.__mlsRound4B44_revert; delete window.__mlsOpenGbp;
    return 'reverted';
  };
})();


/* =========================================================================
 * MLS Scribe -- b42 "bottom-left tidy + voice state"  (__mlsBLTidyB42)  2026-07-06
 * Additive, guarded, reversible IIFE (UI-only; Athena READ-ONLY; no data writes).
 *
 * 1) De-overlaps the bottom-left cluster (was: #mlsCopVoiceBtn hidden under
 *    #mlsAsstFab and #_patientFace): lays out avatar -> voice -> assistant in
 *    one spaced row (10px gaps) from left 12px. #mlsScDock / #mls-ask-btn are
 *    NOT touched (b36 owns the dock anchoring).
 * 2) Voice-button state indicator: idle = green ready dot; while the copilot
 *    mic is actually listening = red pulsing button + blinking dot +
 *    "Listening... tap to stop". Detection: SpeechRecognition start/end/stop
 *    scoped to instances started from #mlsCopVoiceBtn / .mls-b35-mic clicks
 *    (visit dictation is NOT affected and does not light the button).
 *
 * Revert: window.__mlsBLTidyB42_revert()
 * ========================================================================= */
(function () {
  'use strict';
  if (window.__mlsBLTidyB42) return;

  var GAP = 10, LEFT0 = 12;
  var ROW = ['_patientFace', 'mlsCopVoiceBtn', 'mlsAsstFab'];
  var savedStyle = {};
  var origBtnHTML = null;
  var timers = [], obs = [];

  function $(id) { return document.getElementById(id); }

  function setImp(el, prop, val) {
    if (el.style.getPropertyValue(prop) !== val ||
        el.style.getPropertyPriority(prop) !== 'important') {
      el.style.setProperty(prop, val, 'important');
    }
  }

  /* ---- 1. row layout: avatar -> voice -> assistant, 10px gaps ---- */
  function layout() {
    try {
      var x = LEFT0;
      ROW.forEach(function (id) {
        var el = $(id);
        if (!el) return;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden') return;
        if (!(id in savedStyle)) savedStyle[id] = el.getAttribute('style');
        setImp(el, 'left', x + 'px');
        setImp(el, 'right', 'auto');
        if (id === '_patientFace') setImp(el, 'bottom', '12px');
        x += el.getBoundingClientRect().width + GAP;
      });
    } catch (e) {}
  }

  /* ---- 2. voice state indicator ---- */
  var CSS_ID = 'mlsBL42Css';
  function injectCss() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent =
      '#mlsCopVoiceBtn .mls-bl42-dot{display:inline-block;width:8px;height:8px;' +
      'border-radius:50%;background:#4ade80;margin-right:7px;vertical-align:middle;' +
      'box-shadow:0 0 4px #4ade80}' +
      '#mlsCopVoiceBtn.mls-bl42-on{background:linear-gradient(90deg,#dc2626,#ef4444)!important;' +
      'animation:mlsBL42Pulse 1.1s ease-in-out infinite}' +
      '#mlsCopVoiceBtn.mls-bl42-on .mls-bl42-dot{background:#fff;box-shadow:none;' +
      'animation:mlsBL42Blink .9s step-start infinite}' +
      '@keyframes mlsBL42Pulse{0%{box-shadow:0 0 0 0 rgba(239,68,68,.55)}' +
      '70%{box-shadow:0 0 0 12px rgba(239,68,68,0)}100%{box-shadow:0 0 0 0 rgba(239,68,68,0)}}' +
      '@keyframes mlsBL42Blink{50%{opacity:.25}}';
    document.head.appendChild(st);
  }

  function ensureDot() {
    var b = $('mlsCopVoiceBtn');
    if (!b) return;
    if (origBtnHTML === null) origBtnHTML = b.innerHTML;
    if (!b.querySelector('.mls-bl42-dot')) {
      var s = document.createElement('span');
      s.className = 'mls-bl42-dot';
      b.insertBefore(s, b.firstChild);
      if (!b.title) b.title = 'MLS Copilot Voice - tap to talk';
    }
  }

  var listening = false;
  function setListening(on) {
    on = !!on;
    if (on === listening) return;
    listening = on;
    var b = $('mlsCopVoiceBtn');
    if (!b) return;
    b.classList.toggle('mls-bl42-on', on);
    if (on) {
      b.innerHTML = '<span class="mls-bl42-dot"></span>Listening... tap to stop';
      b.title = 'Listening - tap to stop';
    } else {
      b.innerHTML = origBtnHTML || b.innerHTML;
      ensureDot();
      b.title = 'MLS Copilot Voice - tap to talk';
    }
  }

  /* arm on clicks of the voice entry points; flag SR instances started while armed */
  var armedUntil = 0;
  function onClick(ev) {
    var t = ev.target;
    if (t && t.closest && t.closest('#mlsCopVoiceBtn,.mls-b35-mic')) {
      armedUntil = Date.now() + 4000;
    }
  }
  document.addEventListener('click', onClick, true);

  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var patched = null;
  if (SR && SR.prototype && !SR.prototype.__mlsBL42) {
    var pStart = SR.prototype.start, pStop = SR.prototype.stop, pAbort = SR.prototype.abort;
    SR.prototype.__mlsBL42 = 1;
    SR.prototype.start = function () {
      if (Date.now() < armedUntil || this.__mlsBL42v) {
        this.__mlsBL42v = true;
        setListening(true);
        if (!this.__mlsBL42h && this.addEventListener) {
          this.__mlsBL42h = 1;
          var self = this;
          this.addEventListener('end', function () { if (self.__mlsBL42v) setListening(false); });
          this.addEventListener('error', function () { if (self.__mlsBL42v) setListening(false); });
        }
      }
      return pStart.apply(this, arguments);
    };
    SR.prototype.stop = function () {
      if (this.__mlsBL42v) { this.__mlsBL42v = false; setListening(false); }
      return pStop.apply(this, arguments);
    };
    SR.prototype.abort = function () {
      if (this.__mlsBL42v) { this.__mlsBL42v = false; setListening(false); }
      return pAbort.apply(this, arguments);
    };
    patched = { start: pStart, stop: pStop, abort: pAbort };
  }

  /* ---- boot + keep-alive (elements are created lazily / re-styled on timers) ---- */
  function tick() { injectCss(); ensureDot(); layout(); }
  timers.push(setInterval(tick, 1500));
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick);
  } else { tick(); }

  var mo = new MutationObserver(function () { ensureDot(); layout(); });
  function watch() {
    ROW.forEach(function (id) {
      var el = $(id);
      if (el && !el.__mlsBL42w) {
        el.__mlsBL42w = 1;
        mo.observe(el, { attributes: true, attributeFilter: ['style', 'class'] });
      }
    });
  }
  watch();
  timers.push(setInterval(watch, 2000));
  obs.push(mo);

  window.__mlsBLTidyB42 = {
    v: '1.0.0', layout: layout, setListening: setListening,
    get listening() { return listening; }
  };

  window.__mlsBLTidyB42_revert = function () {
    timers.forEach(clearInterval);
    obs.forEach(function (o) { o.disconnect(); });
    document.removeEventListener('click', onClick, true);
    if (patched && SR) {
      SR.prototype.start = patched.start;
      SR.prototype.stop = patched.stop;
      SR.prototype.abort = patched.abort;
      delete SR.prototype.__mlsBL42;
    }
    setListening(false);
    var b = $('mlsCopVoiceBtn');
    if (b && origBtnHTML !== null) b.innerHTML = origBtnHTML;
    Object.keys(savedStyle).forEach(function (id) {
      var el = $(id);
      if (!el) return;
      if (savedStyle[id] == null) { el.removeAttribute('style'); }
      else { el.setAttribute('style', savedStyle[id]); }
    });
    var css = document.getElementById(CSS_ID);
    if (css) css.remove();
    delete window.__mlsBLTidyB42;
    delete window.__mlsBLTidyB42_revert;
    return 'reverted';
  };
})();

/* =========================================================================
 * MLS Scribe -- b41 Backend-sync truth  (__mlsSyncTruthB41)  2026-07-06
 * ROOT CAUSE (R3-7): the status dock's "Backend sync" row only ever updates
 * when a non-GET backend request happens. A normal day (schedule already
 * imported, nothing new to save) makes ZERO such requests -- so the row sat
 * idle forever and looked broken ("backend sync never works"). The backend
 * itself is healthy (/api/health {ok:true}).
 * FIX: a real health probe every 60s (and right after any pull) drives the
 * row honestly: green "Connected -- checked h:mm AM/PM", amber on slow,
 * red with the reason when the backend is actually unreachable. Applied
 * straight to the dock row with an observer so the legacy renderer can't
 * blank it. Reversible: window.__mlsSyncTruthB41_revert().
 * ==========================================================================*/
(function () {
  "use strict";
  if (window.__mlsSyncTruthB41) return; window.__mlsSyncTruthB41 = 1;
  var state = { cls: "chk", txt: "Checking the MLS backend…" };
  function t12() { var d = new Date(); var h = d.getHours(), ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + ":" + ("0" + d.getMinutes()).slice(-2) + " " + ap; }
  function base() { try { return window.bkBase ? window.bkBase() : "https://scrivara-backend.onrender.com"; } catch (e) { return "https://scrivara-backend.onrender.com"; } }
  var _f = (window.fetch && window.fetch.__orig) || window.fetch;
  function probe() {
    var t0 = Date.now();
    Promise.resolve().then(function () { return _f.call(window, base() + "/api/health"); })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok && j && j.ok, ms: Date.now() - t0 }; }); })
      .then(function (x) {
        if (x.ok) state = { cls: x.ms > 4000 ? "chk" : "ok", txt: (x.ms > 4000 ? "Connected (slow, " + Math.round(x.ms / 1000) + "s) — " : "Connected — ") + "checked " + t12() + ". New visits save automatically when a pull finds them." };
        else state = { cls: "bad", txt: "Backend responded abnormally — checked " + t12() + "." };
        paint();
      })
      .catch(function () { state = { cls: "bad", txt: "Cannot reach the MLS backend — checked " + t12() + ". Data will sync when the connection returns." }; paint(); });
  }
  function rowEl() {
    var d = document.getElementById("mlsScDock"); if (!d) return null;
    var els = d.querySelectorAll("div,span,li");
    for (var i = 0; i < els.length; i++) { if ((els[i].textContent || "").trim().indexOf("Backend sync") === 0 && els[i].children.length < 5) return els[i]; }
    return null;
  }
  function paint() {
    try {
      var row = rowEl(); if (!row) return;
      var tag = row.querySelector(".b41-sync");
      if (!tag) { tag = document.createElement("span"); tag.className = "b41-sync"; tag.style.cssText = "display:block;font:500 11px system-ui;opacity:.9;margin:1px 0 2px"; row.appendChild(tag); }
      var color = state.cls === "ok" ? "#2ecc71" : state.cls === "bad" ? "#ff5f56" : "#f5b942";
      var want = (state.cls === "ok" ? "🟢 " : state.cls === "bad" ? "🔴 " : "🟡 ") + state.txt;
      if (tag.textContent !== want) { tag.textContent = want; tag.style.color = color; }
    } catch (e) {}
  }
  probe();
  var iv1 = setInterval(probe, 60000);
  var iv2 = setInterval(paint, 1500);
  window.__mlsSyncTruthB41_revert = function () {
    try { clearInterval(iv1); clearInterval(iv2); } catch (e) {}
    try { var t = document.querySelector("#mlsScDock .b41-sync"); if (t) t.remove(); } catch (e) {}
    window.__mlsSyncTruthB41 = 0;
  };
})();

/* =========================================================================
 * MLS Scribe -- b40 R3 fix pack  (__mlsR3PackB40)   2026-07-06
 * ----------------------------------------------------------------------------
 * (R3-2) "0 / 149 seen" day-progress pill now counts ONLY the selected /
 *        signed-in provider's patients (same data-driven provider matching as
 *        Who's Next; fail-safe: if no visit carries provider info it shows the
 *        whole-practice count and says "all providers").
 * (R3-3) The "☀️ Good afternoon — N appointments today" brief is now REAL and
 *        provider-scoped: N comes from today's pulled schedule for the
 *        signed-in provider; when provider info is missing it says
 *        "across all providers" instead of lying.
 * (R3-4) Clinical tools: the button now ALWAYS works on the Note step and no
 *        longer glitches on the Sign step -- the tools section is force-shown,
 *        un-dimmed (the wizard's step-focus was hiding it), scrolled into
 *        view, and restyled into a clean card.
 * (R3-6) Legal requests: every request card gets a clear "👤 Patient: <name>"
 *        chip; when the ACTIVE patient matches a legal request, a banner
 *        offers one-tap "Attach this visit to the legal request" (marks the
 *        visit linkage locally; nothing sent anywhere). The Legal marketplace
 *        listing auto-fills from the Reputation data (practice, rating, review
 *        count) so the listing markets the doctor without retyping.
 * SAFETY: UI + local reads only. No Athena writes. 12-hour times everywhere.
 * Reversible: window.__mlsR3PackB40_revert().
 * ==========================================================================*/
(function () {
  "use strict";
  if (window.__mlsR3PackB40) return; window.__mlsR3PackB40 = { v: "b40" };
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function S(x) { return x == null ? "" : String(x); }
  function esc(s) { return S(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function normProv(s) { return S(s).toUpperCase().replace(/ENCOUNTER SIGNED.*$/, "").replace(/^PROVIDER\s+/, "").replace(/[^A-Z]+/g, " ").replace(/\s+/g, " ").trim(); }
  function toks(s) { return normProv(s).split(" ").filter(function (t) { return t.length > 1 && !/^(MD|DO|PA|PAC|NP|DPM|RN|DR)$/.test(t); }); }
  function provMatch(ap, dn) { var d = toks(dn); if (!d.length) return true; var a = toks(ap); if (!a.length) return false; for (var i = 0; i < d.length; i++) if (a.indexOf(d[i]) < 0) return false; return true; }
  function myName() { try { return S(window.getProviderName && window.getProviderName()).trim(); } catch (e) { return ""; } }
  function fmt12(t) { var m = S(t).match(/(\d\d?):(\d\d)/); if (!m) return S(t); var h = +m[1], ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + ":" + m[2] + " " + ap; }

  /* ================= (R3-2) provider-scoped day progress ================= */
  function scopedToday() {
    var list = [];
    try { list = (window.__mlsWhosNext && window.__mlsWhosNext.activeList && window.__mlsWhosNext.activeList()) || []; } catch (e) {}
    if (!list.length) { try { list = (window._heroTodayList || []).map(function (a) { return { name: a.name, time: a.time || "", provider: a.provider || "" }; }); } catch (e) {} }
    var me = myName(); var withProv = list.filter(function (a) { return S(a.provider).trim(); });
    if (me && withProv.length) {
      var mine = list.filter(function (a) { return a.provider && provMatch(a.provider, me); });
      if (mine.length) return { list: mine, scoped: true };
    }
    return { list: list, scoped: false };
  }
  var _dpBusy = false;
  function applyDayProgress(txtEl) {
    if (_dpBusy) return; _dpBusy = true;
    try {
      var r = scopedToday(); if (!r.list.length) return;
      var seen = 0;
      if (typeof window._seenToday === "function") r.list.forEach(function (a) { try { if (window._seenToday(a.name)) seen++; } catch (e) {} });
      var want = seen + " / " + r.list.length + " seen · " + Math.max(0, r.list.length - seen) + " remaining" + (r.scoped ? "" : " · all providers");
      if (txtEl.textContent !== want) { txtEl.textContent = want; txtEl.title = r.scoped ? ("Your patients today (" + myName() + ")") : "No provider tags on today's visits yet — showing the whole practice"; }
      var fill = document.querySelector(".mdp-fill");
      if (fill) fill.style.width = (r.list.length ? Math.round(seen / r.list.length * 100) : 0) + "%";
    } catch (e) {} finally { _dpBusy = false; }
  }
  function fixDayProgress() {
    try {
      var txtEl = document.querySelector(".mdp-txt"); if (!txtEl) return;
      applyDayProgress(txtEl);
      /* the legacy module rewrites this text on its own timer — re-apply the
         provider-scoped truth the instant it changes (same-frame, no flicker) */
      if (!txtEl.__r3obs) {
        txtEl.__r3obs = 1;
        try { new MutationObserver(function () { applyDayProgress(txtEl); }).observe(txtEl, { childList: true, characterData: true, subtree: true }); } catch (e) {}
      }
    } catch (e) {}
  }

  /* ================= (R3-3) honest, provider-scoped daily brief ================= */
  var _origBrief = null;
  function wrapBrief() {
    try {
      if (typeof window._renderDailyBrief !== "function" || window._renderDailyBrief.__r3) return;
      _origBrief = window._renderDailyBrief;
      var f = async function () {
        try {
          var host = $("patientsView"); if (!host) return;
          var bar = $("dailyBriefBar");
          if (!bar) { bar = document.createElement("div"); bar.id = "dailyBriefBar"; bar.style.cssText = "margin:0 0 12px"; host.insertBefore(bar, host.firstChild); }
          var today = new Date().toISOString().slice(0, 10);
          var appts = [];
          try { appts = (window._calAppts || []).filter(function (a) { return S(a.appt_date || "").slice(0, 10) === today && S(a.name).trim(); }); } catch (e) {}
          if (!appts.length) { bar.style.display = "none"; bar.innerHTML = ""; return; }
          var me = myName(); var withProv = appts.filter(function (a) { return S(a.provider).trim(); });
          var mine = (me && withProv.length) ? appts.filter(function (a) { return a.provider && provMatch(a.provider, me); }) : [];
          var scoped = mine.length > 0;
          var use = scoped ? mine : appts;
          var seen = 0; try { if (typeof window._seenToday === "function") use.forEach(function (a) { if (window._seenToday(a.name)) seen++; }); } catch (e) {}
          var hh = new Date().getHours(); var greet = hh < 12 ? "Good morning" : hh < 17 ? "Good afternoon" : "Good evening";
          var nextUp = ""; try { var srt = use.slice().sort(function (a, b) { return S(a.start_at).localeCompare(S(b.start_at)); }); var now = Date.now(); var nx = srt.filter(function (a) { return a.start_at && new Date(a.start_at).getTime() >= now - 30 * 60000; })[0]; if (nx) { var d = new Date(nx.start_at); nextUp = " Next: <b>" + esc(S(nx.name).split(" ")[0]) + "</b> at " + fmt12(("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2)) + "."; } } catch (e) {}
          var msg = "☀️ " + greet + (me ? (", " + esc(me)) : "") + " — <b>" + use.length + "</b> appointment" + (use.length === 1 ? "" : "s") + " today" + (scoped ? "" : " <span style='opacity:.75'>(across all providers — no provider tags on today's pull yet)</span>") + (seen ? (", " + seen + " seen") : "") + "." + nextUp;
          bar.innerHTML = '<div style="background:linear-gradient(90deg,#eef6ff,#f3fbf6);border:1px solid #d7e6fb;border-radius:12px;padding:11px 14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap"><span style="font-size:13.5px;flex:1;min-width:200px">' + msg + "</span>" +
            '<button class="btn-ghost" style="font-size:12.5px;padding:6px 12px" onclick="showView(\'visit\')">\u{1F399}️ Start seeing patients</button>' +
            '<button class="btn-ghost" style="font-size:12.5px;padding:6px 12px" onclick="showView(\'calendar\')">\u{1F4C5} See schedule</button></div>';
          bar.style.display = "block";
        } catch (e) { try { if (_origBrief) return _origBrief.apply(this, arguments); } catch (e2) {} }
      };
      f.__r3 = true; window._renderDailyBrief = f;
    } catch (e) {}
  }

  /* ================= (R3-4) Clinical tools: always works, clean ================= */
  function css() {
    if ($("mlsR3Css")) return;
    var st = document.createElement("style"); st.id = "mlsR3Css";
    st.textContent = [
      /* tools section: readable card, never dimmed/hidden by the wizard step focus */
      "#visitView .vx-tools.r3-open,#visitToolsGroup.r3-open{display:block!important;visibility:visible!important;opacity:1!important;filter:none!important;pointer-events:auto!important;max-height:none!important;overflow:visible!important;background:var(--card,#fff);border:1px solid var(--line,#dbe4f0);border-radius:14px;padding:14px 16px;margin:10px 0;box-shadow:0 8px 24px rgba(20,40,90,.08)}",
      ".r3-open .mls-focus-dim,{opacity:1!important}",
      "#visitView .vx-tools.r3-open *{opacity:1!important;filter:none!important}",
      /* legal patient chips */
      ".r3-legal-pt{display:inline-flex;align-items:center;gap:5px;background:#eef4ff;border:1px solid #c9d9f5;color:#1e3a8a;border-radius:999px;padding:2px 10px;font:700 11.5px system-ui;margin:4px 6px 0 0}",
      "#mlsR3LegalBanner{background:linear-gradient(90deg,#fff7e6,#fffdf3);border:1px solid #f0d9a8;border-radius:12px;padding:10px 14px;margin:8px 0;font:600 13px system-ui;color:#7a5b16;display:flex;align-items:center;gap:10px;flex-wrap:wrap}",
      "#mlsR3LegalBanner button{background:#b58105;color:#fff;border:0;border-radius:8px;padding:7px 13px;font:700 12.5px system-ui;cursor:pointer}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }
  function fixClinicalTools() {
    try {
      if (typeof window.toggleVisitTools === "function" && !window.toggleVisitTools.__r3) {
        var orig = window.toggleVisitTools;
        var w = function () {
          var r = orig.apply(this, arguments);
          setTimeout(function () {
            try {
              var sec = document.querySelector("#visitView .vx-tools") || $("visitToolsGroup");
              if (!sec) return;
              var vis = sec.offsetParent !== null && getComputedStyle(sec).display !== "none" && parseFloat(getComputedStyle(sec).opacity || "1") > 0.4;
              if (!sec.classList.contains("r3-open")) { sec.classList.add("r3-open"); }
              else if (vis) { sec.classList.remove("r3-open"); return; } /* toggle off cleanly */
              sec.scrollIntoView({ behavior: "smooth", block: "start" });
            } catch (e) {}
          }, 180);
          return r;
        };
        w.__r3 = true; w.__orig = orig; window.toggleVisitTools = w;
      }
      /* also catch any button literally labeled Clinical tools whose handler is missing */
      [].forEach.call(document.querySelectorAll("button"), function (b) {
        if (b.__r3ct) return;
        if (!/clinical tools/i.test(b.textContent || "")) return;
        b.__r3ct = 1;
        b.addEventListener("click", function () {
          setTimeout(function () {
            try {
              var sec = document.querySelector("#visitView .vx-tools") || $("visitToolsGroup");
              if (sec && (sec.offsetParent === null || getComputedStyle(sec).display === "none")) { sec.classList.add("r3-open"); sec.scrollIntoView({ behavior: "smooth", block: "start" }); }
            } catch (e) {}
          }, 250);
        });
      });
    } catch (e) {}
  }

  /* ================= (R3-6) legal requests: patient linkage + reputation autofill ===== */
  function activePatientName() {
    try { var el = $("heroPtName"); if (el && S(el.value).trim()) return S(el.value).trim(); } catch (e) {}
    try { if (typeof window.getActivePatient === "function") { var p = window.getActivePatient(); if (p && p.name) return S(p.name); } } catch (e) {}
    return "";
  }
  function legalRequests() {
    /* read-only probe of the legal view's request cards */
    var view = $("legalReqView") || document.querySelector('[id^="mlsPView_legal"], #legalView');
    if (!view) return [];
    return [].slice.call(view.querySelectorAll(".card,[class*=legal-req],[data-legal-id]")).filter(function (c) { return /attorney|law|request/i.test(c.textContent || "") && (c.textContent || "").length > 40; });
  }
  function nameIn(cardText, name) {
    if (!name) return false;
    var last = name.split(/\s+/).slice(-1)[0];
    return last && last.length > 2 && new RegExp("\\b" + last.replace(/[^\w]/g, "") + "\\b", "i").test(cardText);
  }
  function legalTick() {
    try {
      var name = activePatientName();
      /* 1) chips on every request card naming the tied patient */
      legalRequests().forEach(function (card) {
        if (card.querySelector(".r3-legal-pt")) return;
        var m = (card.textContent || "").match(/(?:patient|regarding|re:|for)\s*[:\-]?\s*([A-Z][a-z]+(?:\s+[A-Z][a-zA-Z.'-]+){1,2})/);
        var chip = document.createElement("span");
        chip.className = "r3-legal-pt";
        chip.innerHTML = "\u{1F464} Patient: " + esc(m ? m[1] : "(not recorded — open the request to set)");
        card.insertBefore(chip, card.firstChild);
      });
      /* 2) active-patient banner in the visit view when they match a legal request */
      var vv = $("visitView");
      if (vv && name) {
        var match = legalRequests().some(function (c) { return nameIn(c.textContent || "", name); });
        var ban = $("mlsR3LegalBanner");
        if (match && !ban) {
          ban = document.createElement("div"); ban.id = "mlsR3LegalBanner";
          ban.innerHTML = "⚖️ <b>" + esc(name) + "</b> has an open legal request. Today's visit can support it." +
            '<button type="button" id="mlsR3LegalAttach">\u{1F4CE} Attach this visit to the legal request</button>';
          vv.insertBefore(ban, vv.firstChild);
          $("mlsR3LegalAttach").onclick = function () {
            try {
              var k = "mls_legal_visit_links"; var arr = JSON.parse(localStorage.getItem(k) || "[]");
              arr.push({ patient: name, date: new Date().toISOString().slice(0, 10), at: Date.now() });
              localStorage.setItem(k, JSON.stringify(arr.slice(-200)));
            } catch (e) {}
            this.textContent = "✓ Attached — it will be flagged in Legal requests";
            this.disabled = true;
          };
        } else if (!match && ban) ban.remove();
      }
      /* 3) marketplace listing autofill from Reputation data */
      var lst = document.querySelector("#expertListingForm, [id*='marketplace'] form, #mlsExpertListing");
      if (lst && !lst.__r3fill) {
        lst.__r3fill = 1;
        try {
          var rf = JSON.parse(localStorage.getItem("mlsRF") || "{}");
          var d = rf.doc || {}; var cap = rf.cap || {}; var g = cap.google || {};
          [].forEach.call(lst.querySelectorAll("input,textarea"), function (inp) {
            if (S(inp.value).trim()) return;
            var ph = (S(inp.placeholder) + " " + S(inp.name) + " " + S(inp.id)).toLowerCase();
            if (/practice|business/.test(ph) && d.practice) inp.value = d.practice;
            else if (/doctor|name/.test(ph) && d.name) inp.value = d.name;
            else if (/special/.test(ph) && d.spec) inp.value = d.spec;
            else if (/city|location/.test(ph) && d.city) inp.value = d.city;
            else if (/website|site|url/.test(ph) && d.site) inp.value = d.site;
            else if (/bio|about|description/.test(ph)) inp.value = (d.name || "Our practice") + (d.spec ? (" — " + d.spec) : "") + (g.r ? (". Rated " + g.r + "★ on Google (" + (g.c || 0) + " reviews).") : "");
            if (inp.value) inp.dispatchEvent(new Event("input", { bubbles: true }));
          });
        } catch (e) {}
      }
    } catch (e) {}
  }

  /* ================= ticks ================= */
  function tick() { try { css(); fixDayProgress(); wrapBrief(); fixClinicalTools(); legalTick(); } catch (e) {} }
  tick();
  var iv = setInterval(tick, 1100);

  window.__mlsR3PackB40_revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { var s = $("mlsR3Css"); if (s) s.remove(); } catch (e) {}
    try { if (_origBrief && window._renderDailyBrief && window._renderDailyBrief.__r3) window._renderDailyBrief = _origBrief; } catch (e) {}
    try { if (window.toggleVisitTools && window.toggleVisitTools.__r3) window.toggleVisitTools = window.toggleVisitTools.__orig; } catch (e) {}
    try { [].forEach.call(document.querySelectorAll(".r3-legal-pt,#mlsR3LegalBanner"), function (n) { n.remove(); }); } catch (e) {}
    window.__mlsR3PackB40 = 0;
  };
})();

/* =========================================================================
 * MLS Scribe -- b40 Study Groups PRO  (__mlsStudyProB40)   2026-07-06
 * ----------------------------------------------------------------------------
 * R3-1: major Study Groups / Run-a-Study overhaul, layered ON TOP of the
 * existing __mlsStudyGroups engine (its data model, xlsx/PDF/graph outputs and
 * dedupe stay -- nothing re-implemented, nothing deleted).
 *
 *  1) AUTO-FORMAT: "⚡ Add ALL my patients" builds the required study format
 *     automatically from the app's own data (charts + saved notes + pulled
 *     Athena visits) -- one click, no CSV/JSON typing. Per-visit records
 *     (date, type, full detail), deduped by the engine's content hash.
 *  2) COHORTS BY PROCEDURE: type a procedure/diagnosis ("injection",
 *     "radiculopathy", CPT text...) and MLS builds a cohort of every patient
 *     whose visits mention it (their full visit history included).
 *  3) RUN A STUDY -- with real options: study type (retrospective outcomes /
 *     visit volume & trends / procedure comparison / cohort profile / custom
 *     question), date range, and a PREMIUM AI narrative that runs on the
 *     backend's gated /api/study STRONGER model (same engine as the Analysis
 *     Data Study: Background / Methods / Results / Limitations, real numbers
 *     only, de-identified). Graph + Excel + PDF still come from the local
 *     engine; the AI narrative renders alongside with copy/download.
 * SAFETY: reads app data only; nothing sent anywhere except the existing
 * authed /api/study call; no Athena writes. Reversible:
 * window.__mlsStudyProB40_revert().
 * ==========================================================================*/
(function () {
  "use strict";
  if (window.__mlsStudyProB40) return; window.__mlsStudyProB40 = { v: "b40" };
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function S(x) { return x == null ? "" : String(x); }
  function esc(s) { return S(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function SG() { return window.__mlsStudyGroups || null; }

  /* ---------- auto-format the app's own data into study records ---------- */
  function allNotes() { try { return (window.getNotes && window.getNotes()) || []; } catch (e) { return []; } }
  function allPatients() { try { return (window.getPatients && window.getPatients()) || []; } catch (e) { return []; } }
  function allAppts() { try { return window._calAppts || []; } catch (e) { return []; } }
  function noteDate(n) { return S(n.date || n.visitDate || (n.created && new Date(n.created).toISOString())).slice(0, 10); }
  function notePt(n) { return S(n.patientName || n.name || n.patient || "").trim(); }
  function noteText(n) { return S(n.note || n.text || n.body || n.content || ""); }
  function buildRecords(filterFn) {
    /* returns {patients:[{name,dob,mrn,history:[{date,type,note}]}]} */
    var byKey = {}; /* nameLower -> rec */
    function rec(name, dob, mrn) {
      var k = S(name).trim().toLowerCase(); if (!k) return null;
      if (!byKey[k]) byKey[k] = { name: S(name).trim(), dob: S(dob || ""), mrn: S(mrn || ""), history: [] };
      if (dob && !byKey[k].dob) byKey[k].dob = S(dob);
      return byKey[k];
    }
    allPatients().forEach(function (p) { rec(p.name, p.dob, p.mrn || p.id); });
    allNotes().forEach(function (n) {
      var nm = notePt(n); if (!nm) return;
      var v = { date: noteDate(n), type: n.visitType || n.type || "Visit note", note: noteText(n).slice(0, 8000) };
      if (filterFn && !filterFn(v, nm)) return;
      var r = rec(nm, n.dob); if (r) r.history.push(v);
    });
    allAppts().forEach(function (a) {
      var nm = S(a.name).trim(); if (!nm) return;
      var v = { date: S(a.appt_date || "").slice(0, 10), type: a.appt_type || "Appointment", note: "Reason: " + S(a.reason || "(not recorded)") + (a.provider ? (" | Provider: " + S(a.provider).replace(/Close$/, "").replace(/_/g, " ")) : "") + (a.status ? (" | Status: " + a.status) : "") };
      if (filterFn && !filterFn(v, nm)) return;
      var r = rec(nm, a.dob); if (r) r.history.push(v);
    });
    var out = [];
    Object.keys(byKey).forEach(function (k) { var r = byKey[k]; if (!filterFn || r.history.length) out.push(r); });
    return { patients: out };
  }
  function importInto(groupName, data) {
    var sg = SG(); if (!sg) return null;
    var g = sg.list().filter(function (x) { return x.name === groupName; })[0] || sg.createGroup(groupName);
    var res = sg.importJSON(g.id, JSON.stringify(data));
    return { group: g, res: res };
  }

  /* ---------- UI ---------- */
  function css() {
    if ($("mlsStudyProCss")) return;
    var st = document.createElement("style"); st.id = "mlsStudyProCss";
    st.textContent = [
      "#mlsSgPro{border:1px solid #d5e2f8;border-radius:12px;background:#f6f9ff;padding:14px 16px;margin:0 0 14px}",
      "#mlsSgPro h4{margin:0 0 8px;font:800 14px system-ui;color:#16233a}",
      "#mlsSgPro .sgp-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:6px 0}",
      "#mlsSgPro button{font:700 13px system-ui;border:0;border-radius:9px;padding:9px 14px;cursor:pointer}",
      "#mlsSgPro .sgp-all{background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff}",
      "#mlsSgPro .sgp-proc{background:#7c3aed;color:#fff}",
      "#mlsSgPro input[type=text],#mlsSgPro select{font:500 13px system-ui;padding:8px 10px;border:1px solid #cdd9ea;border-radius:8px;background:#fff;color:#16233a}",
      "#mlsSgPro .sgp-note{font:500 12px system-ui;color:#5a6b82}",
      "#mlsSgProRun{border-top:1px dashed #c7d6ef;margin-top:10px;padding-top:10px}",
      "#mlsSgProRun label{font:700 12px system-ui;color:#3b5f9e;display:block;margin-bottom:3px}",
      "#mlsSgProRun .sgp-run{background:#16a34a;color:#fff;font-size:14px;padding:10px 18px}",
      "#mlsSgProOut{margin-top:10px}",
      "#mlsSgProOut .sgp-dl{display:inline-flex;gap:6px;align-items:center;background:#fff;border:1px solid #cdd9ea;border-radius:9px;padding:8px 13px;font:700 12.5px system-ui;color:#1e3a8a;cursor:pointer;margin:0 6px 6px 0;text-decoration:none}",
      "#mlsSgProNarr{background:#fff;border:1px solid #d5e2f8;border-left:4px solid #7c3aed;border-radius:10px;padding:14px 16px;margin-top:8px;font:500 13.5px/1.6 system-ui;color:#1b2942;white-space:pre-wrap;max-height:420px;overflow:auto}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }
  function ensureUI() {
    var sgRoot = $("mls-sg-root"); if (!sgRoot || $("mlsSgPro")) return;
    var box = document.createElement("div"); box.id = "mlsSgPro";
    box.innerHTML =
      '<h4>&#9889; Build your cohort automatically</h4>' +
      '<div class="sgp-row"><button type="button" class="sgp-all" id="sgpAllBtn">&#9889; Add ALL my patients (auto-formatted)</button>' +
      '<span class="sgp-note">MLS turns your charts, notes and pulled Athena visits into per-visit study records &mdash; no typing.</span></div>' +
      '<div class="sgp-row"><input type="text" id="sgpProcTx" placeholder="Procedure / diagnosis &mdash; e.g. injection, radiculopathy, knee OA" style="min-width:280px;flex:1">' +
      '<button type="button" class="sgp-proc" id="sgpProcBtn">&#127919; Build cohort by procedure</button></div>' +
      '<div class="sgp-note" id="sgpBuildNote"></div>' +
      '<div id="mlsSgProRun">' +
      '<h4>&#9654; Run a study &mdash; options</h4>' +
      '<div class="sgp-row">' +
      '<span><label>Study type</label><select id="sgpType">' +
      '<option value="outcomes">Retrospective outcomes</option>' +
      '<option value="volume">Visit volume &amp; trends</option>' +
      '<option value="procedure">Procedure comparison</option>' +
      '<option value="profile">Cohort profile / demographics</option>' +
      '<option value="custom">Custom question&hellip;</option>' +
      '</select></span>' +
      '<span><label>Date range</label><select id="sgpRange"><option value="all">All time</option><option value="12">Last 12 months</option><option value="6">Last 6 months</option><option value="3">Last 3 months</option></select></span>' +
      '<span><label>&nbsp;</label><label style="display:flex;align-items:center;gap:6px;font:600 12.5px system-ui;color:#16233a;margin:0"><input type="checkbox" id="sgpAi" checked> &#129504; Premium AI narrative (stronger model)</label></span>' +
      '</div>' +
      '<div class="sgp-row" id="sgpCustomRow" style="display:none"><input type="text" id="sgpCustomTx" placeholder="Ask anything about this cohort &mdash; e.g. did pain scores improve after injections?" style="flex:1;min-width:320px"></div>' +
      '<div class="sgp-row"><button type="button" class="sgp-run" id="sgpRunBtn">&#9654; Run the study</button><span class="sgp-note" id="sgpRunNote"></span></div>' +
      '<div id="mlsSgProOut"></div></div>';
    sgRoot.parentNode.insertBefore(box, sgRoot);
    $("sgpType").addEventListener("change", function () { $("sgpCustomRow").style.display = this.value === "custom" ? "flex" : "none"; });
    $("sgpAllBtn").addEventListener("click", function () {
      var n = $("sgpBuildNote"); n.textContent = "Formatting your data…";
      setTimeout(function () {
        try {
          var data = buildRecords(null);
          var r = importInto("All patients (auto)", data);
          n.textContent = r ? ("✓ “All patients (auto)” ready — " + data.patients.length + " patients, " + data.patients.reduce(function (a, p) { return a + p.history.length; }, 0) + " visit records (deduped). Select it above and run a study.") : "Study engine not loaded yet — try again in a moment.";
          try { refreshSgSelect("All patients (auto)"); } catch (e) {}
        } catch (e) { n.textContent = "Could not format the data: " + e.message; }
      }, 30);
    });
    $("sgpProcBtn").addEventListener("click", function () {
      var kw = S($("sgpProcTx").value).trim(); var n = $("sgpBuildNote");
      if (!kw) { n.textContent = "Type a procedure or diagnosis first."; return; }
      n.textContent = "Scanning every visit for “" + kw + "”…";
      var kwl = kw.toLowerCase();
      setTimeout(function () {
        try {
          /* pass 1: find matching patient names; pass 2: include their FULL history */
          var hits = {};
          var probe = buildRecords(null);
          probe.patients.forEach(function (p) { p.history.forEach(function (v) { if ((S(v.note) + " " + S(v.type)).toLowerCase().indexOf(kwl) >= 0) hits[p.name.toLowerCase()] = 1; }); });
          var data = { patients: probe.patients.filter(function (p) { return hits[p.name.toLowerCase()]; }) };
          if (!data.patients.length) { n.textContent = "No visits mention “" + kw + "”. Try another wording (MLS scans notes, reasons and visit types)."; return; }
          var r = importInto("Cohort — " + kw, data);
          n.textContent = "✓ “Cohort — " + kw + "” ready — " + data.patients.length + " matching patients with their full visit history. Select it above and run a study.";
          try { refreshSgSelect("Cohort — " + kw); } catch (e) {}
        } catch (e) { n.textContent = "Cohort build failed: " + e.message; }
      }, 30);
    });
    $("sgpRunBtn").addEventListener("click", runPro);
  }
  function refreshSgSelect(name) {
    /* nudge the legacy select to show the new group and select it */
    var sel = document.querySelector("#mls-sg-root select"); if (!sel) return;
    try { var sg = SG(); var g = sg.list().filter(function (x) { return x.name === name; })[0]; if (!g) return;
      var have = [].slice.call(sel.options).some(function (o) { return o.value === g.id; });
      if (!have) { var o = document.createElement("option"); o.value = g.id; o.textContent = g.name + " (" + g.patients.length + ")"; sel.appendChild(o); }
      sel.value = g.id; sel.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {}
  }
  function selectedGroup() {
    var sel = document.querySelector("#mls-sg-root select");
    var sg = SG(); if (!sg) return null;
    if (sel && sel.value) { var g = sg.get(sel.value); if (g) return g; }
    var l = sg.list(); return l.length ? l[l.length - 1] : null;
  }
  function inRange(dateStr, months) {
    if (!months) return true;
    var d = new Date(dateStr); if (isNaN(d)) return true;
    var cut = new Date(); cut.setMonth(cut.getMonth() - months);
    return d >= cut;
  }
  function fmt12(t) { var m = S(t).match(/^(\d\d?):(\d\d)/); if (!m) return S(t); var h = +m[1], ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12; return h + ":" + m[2] + " " + ap; }

  function runPro() {
    var sg = SG(); var note = $("sgpRunNote"), out = $("mlsSgProOut");
    if (!sg) { note.textContent = "Study engine not loaded."; return; }
    var g = selectedGroup();
    if (!g || !g.patients.length) { note.textContent = "Pick (or build) a group with patients first — try ⚡ Add ALL my patients."; return; }
    var months = +($("sgpRange").value) || 0;
    var type = $("sgpType").value;
    var typeLabel = { outcomes: "Retrospective outcomes study", volume: "Visit volume & trends study", procedure: "Procedure comparison study", profile: "Cohort profile / demographics", custom: "Custom study" }[type];
    note.textContent = "Running “" + typeLabel + "” on " + g.name + "…";
    out.innerHTML = "";
    /* 1) local engine: graph + Excel + PDF (unchanged, proven) */
    sg.runStudy(g.id, {}).then(function (res) {
      var html = '<div style="background:#fff;border:1px solid #d5e2f8;border-radius:10px;padding:12px">' + (res.svg || "") + "</div><div style=\"margin-top:8px\">";
      function dl(blob, name, label) {
        if (!blob) return "";
        var u = URL.createObjectURL(blob);
        return '<a class="sgp-dl" href="' + u + '" download="' + name + '">' + label + "</a>";
      }
      html += dl(res.xlsxBlob, "MLS_Study_" + g.name.replace(/\W+/g, "_") + ".xlsx", "⬇ Excel (per-visit data)");
      html += dl(res.pdfBlob, "MLS_Study_" + g.name.replace(/\W+/g, "_") + ".pdf", "⬇ PDF report" + (res.pdfPages ? (" · " + res.pdfPages + " pages") : ""));
      html += "</div>";
      out.innerHTML = html;
      note.textContent = "✓ Graph + Excel + PDF ready." + ($("sgpAi").checked ? " Writing the AI narrative…" : "");
      if ($("sgpAi").checked) runNarrative(g, type, typeLabel, months);
    }).catch(function (e) { note.textContent = "Study failed: " + e.message; });
  }
  function runNarrative(g, type, typeLabel, months) {
    var note = $("sgpRunNote"), out = $("mlsSgProOut");
    var tokv = ""; try { tokv = sessionStorage.getItem("sf_bk_token") || localStorage.getItem("sf_bk_token") || ""; } catch (e) {}
    var base = ""; try { base = window.bkBase ? window.bkBase() : ""; } catch (e) {}
    if (!tokv || !base) { note.textContent = "✓ Outputs ready. (Sign in to add the AI narrative.)"; return; }
    /* de-identified per-visit lines (P1, P2, ... instead of names) */
    var lines = [], pi = 0, nVisits = 0;
    g.patients.forEach(function (p) {
      pi++;
      (p.visits || []).forEach(function (v) {
        if (!inRange(v.date, months)) return;
        nVisits++;
        if (lines.length < 900) lines.push("P" + pi + " | " + S(v.date) + " | " + S(v.type) + " | " + S(v.detail).replace(/[\n\r|]+/g, " ").slice(0, 260));
      });
    });
    var qMap = {
      outcomes: "Produce a retrospective outcomes study of this cohort: what happened to these patients over time (pain, findings, response to treatment where recorded)?",
      volume: "Produce a visit volume and trends study: visits over time, busiest periods, visit-type mix, notable changes.",
      procedure: "Produce a procedure comparison study: which procedures/treatments appear, how often, and how outcomes differ between them where recorded.",
      profile: "Produce a cohort profile: demographics (from DOBs), visit patterns, most common diagnoses/procedures, and what characterizes this cohort.",
      custom: S(($("sgpCustomTx") || {}).value).trim() || "Summarize this cohort."
    };
    var sys = "You are a careful, honest, PREMIUM clinical-study analyst. Use ONLY the provided de-identified per-visit records. Produce a properly structured retrospective study: Background, Methods (retrospective review of n=" + nVisits + " visit records across " + g.patients.length + " patients — state these numbers), Results (real numbers computed from the records; show counts and math), Limitations, and a note that IRB/compliance review is required before publication. NEVER fabricate numbers, dates or outcomes. If the records cannot answer something, say so plainly. 12-hour AM/PM for any times. Plain text only.";
    var user = "STUDY TYPE: " + typeLabel + "\nQUESTION: " + qMap[type] + "\nDATE RANGE: " + (months ? ("last " + months + " months") : "all time") + "\n\nDE-IDENTIFIED VISIT RECORDS (patient | date | type | detail):\n" + lines.join("\n");
    fetch(base + "/api/study", { method: "POST", headers: { "Content-Type": "application/json", "Authorization": "Bearer " + tokv }, body: JSON.stringify({ system: sys, user: user }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (x) {
        var text = S(x.j && (x.j.content || x.j.text || x.j.reply)).trim();
        if (!x.ok || !text) {
          note.textContent = "✓ Graph/Excel/PDF ready. AI narrative unavailable" + (x.status === 403 ? " (premium study engine not enabled on this account)" : "") + ".";
          return;
        }
        var div = document.createElement("div"); div.id = "mlsSgProNarr"; div.textContent = text;
        var hd = document.createElement("div"); hd.style.cssText = "font:800 13px system-ui;color:#7c3aed;margin-top:12px"; hd.innerHTML = "\u{1F9E0} Premium AI study narrative" + (x.j.model ? (' <span style="font-weight:600;color:#8a97ad">· ' + esc(x.j.model) + "</span>") : "") + ' <button class="sgp-dl" style="margin-left:8px" onclick="navigator.clipboard.writeText(document.getElementById(\'mlsSgProNarr\').textContent)">\u{1F4CB} Copy</button>';
        out.appendChild(hd); out.appendChild(div);
        note.textContent = "✓ Full study ready — graph, Excel, PDF and AI narrative below.";
      })
      .catch(function () { note.textContent = "✓ Graph/Excel/PDF ready. (AI narrative: network problem.)"; });
  }

  function tick() { try { css(); ensureUI(); } catch (e) {} }
  tick();
  var iv = setInterval(tick, 1200);
  window.__mlsStudyProB40_revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { var b = $("mlsSgPro"); if (b) b.remove(); } catch (e) {}
    try { var s = $("mlsStudyProCss"); if (s) s.remove(); } catch (e) {}
    window.__mlsStudyProB40 = 0;
  };
})();

/* =========================================================================
 * MLS Scribe -- b39 "MLS Copilot Voice"  (__mlsCopilotVoiceB39)  2026-07-06
 * ----------------------------------------------------------------------------
 * ONE voice entry point wired into the SAME single-assistant brain (item 12's
 * __mlsAsstFix chat pipeline + the /api/copilot AI + local analytics). It is
 * NOT another assistant: the button simply opens the MLS Assistant and starts
 * dictation through its own in-chat mic, and new voice-friendly INTENTS are
 * registered on the assistant's public registry so spoken commands drive the
 * REAL app functions:
 *   "start a visit (for <name>)"  -> loads the patient + starts recording
 *   "stop recording"              -> stops the capture
 *   "generate the note"           -> runs the real note generator
 *   "send it to Athena"           -> OPENS the EMR review-&-confirm modal.
 *                                    NOTHING is pushed until the doctor
 *                                    confirms there (note-only writeback,
 *                                    never orders -- safety rails intact).
 * Additive / guarded / reversible: window.__mlsCopilotVoiceB39_revert().
 * ==========================================================================*/
(function () {
  "use strict";
  if (window.__mlsCopilotVoiceB39) return; window.__mlsCopilotVoiceB39 = { v: "b39" };
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function S(x) { return x == null ? "" : String(x); }
  function toast(m) { try { if (window.toast) window.toast(m, ""); } catch (e) {} }

  /* ---------- the button ---------- */
  function css() {
    if ($("mlsVoiceB39Css")) return;
    var st = document.createElement("style"); st.id = "mlsVoiceB39Css";
    st.textContent = [
      "#mlsCopVoiceBtn{position:fixed;left:12px;bottom:14px;z-index:99997;display:inline-flex;align-items:center;gap:8px;padding:11px 18px;border:0;border-radius:999px;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;font:800 14px system-ui;box-shadow:0 8px 24px rgba(124,58,237,.45);cursor:pointer}",
      "#mlsCopVoiceBtn:hover{filter:brightness(1.1)}",
      "#mlsCopVoiceBtn.listening{animation:mlsCvPulse 1s ease-in-out infinite}",
      "@keyframes mlsCvPulse{50%{box-shadow:0 8px 34px rgba(220,60,60,.8)}}",
      /* keep the assistant FAB above it */
      "#mlsAsstFab{bottom:64px!important}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }
  function ensureBtn() {
    if ($("mlsCopVoiceBtn")) return;
    var b = document.createElement("button");
    b.id = "mlsCopVoiceBtn"; b.type = "button";
    b.title = "Talk to MLS — start visits, ask anything, generate notes, all by voice";
    b.innerHTML = "\u{1F399}️ MLS Copilot Voice";
    b.onclick = function () {
      try {
        /* open the ONE assistant panel */
        var p = $("mls-assist-panel");
        if (!p || getComputedStyle(p).display === "none") { var f = $("mlsAsstFab"); if (f) f.click(); }
        /* start its own in-chat mic (b35) — same brain, one thread */
        var tries = 0, iv = setInterval(function () {
          tries++;
          var mic = document.querySelector("#mls-assist-panel .mls-b35-mic");
          if (mic) { clearInterval(iv); mic.click(); b.classList.add("listening"); setTimeout(function () { b.classList.remove("listening"); }, 8000); }
          else if (tries > 20) clearInterval(iv);
        }, 150);
      } catch (e) {}
    };
    (document.body || document.documentElement).appendChild(b);
  }

  /* ---------- voice-friendly intents on the ONE assistant brain ---------- */
  var unregs = [], registered = false;
  function findPatient(name) {
    name = S(name).trim().toLowerCase(); if (!name) return null;
    try {
      var list = (window.__mlsWhosNext && window.__mlsWhosNext.activeList && window.__mlsWhosNext.activeList()) || [];
      for (var i = 0; i < list.length; i++) if (S(list[i].name).toLowerCase().indexOf(name) >= 0) return list[i];
    } catch (e) {}
    try {
      var ps = (window.getPatients && window.getPatients()) || [];
      for (var j = 0; j < ps.length; j++) if (S(ps[j].name).toLowerCase().indexOf(name) >= 0) return { name: ps[j].name, dob: ps[j].dob || "" };
    } catch (e) {}
    return null;
  }
  function loadPatient(p) {
    try {
      var nm = $("heroPtName"); if (nm) { nm.value = p.name || ""; nm.dispatchEvent(new Event("input", { bubbles: true })); }
      var db = $("heroPtDob"); if (db) { db.value = p.dob || ""; db.dispatchEvent(new Event("input", { bubbles: true })); }
      if (typeof window._heroSyncName === "function") window._heroSyncName();
    } catch (e) {}
  }
  function registerIntents() {
    if (registered) return;
    var fx = window.__mlsAsstFix;
    if (!fx || typeof fx.registerIntent !== "function") return;
    registered = true;
    unregs.push(fx.registerIntent("voice-start-visit", function (q) {
      var m = S(q).match(/^(?:please\s+)?(?:start|begin)\s+(?:a\s+|the\s+)?visit(?:\s+(?:for|with)\s+(.+))?$/i);
      if (!m) return false;
      try { if (typeof window.showView === "function") window.showView("visit"); } catch (e) {}
      var who = m[1] ? findPatient(m[1]) : null;
      if (m[1] && !who) { toast('Could not find "' + m[1] + '" on the schedule — tap their box in Who’s Next.'); return true; }
      if (who) loadPatient(who);
      try { if (typeof window.startCapture === "function") window.startCapture(); } catch (e) {}
      toast("\u{1F399}️ Visit started" + (who ? (" for " + who.name) : "") + " — recording. Say “stop recording” when done.");
      return true;
    }, true));
    unregs.push(fx.registerIntent("voice-stop-recording", function (q) {
      if (!/^(?:please\s+)?(?:stop|end|finish)(?:\s+the)?\s+(?:recording|capture|visit)$/i.test(S(q).trim())) return false;
      try { if (typeof window.stopCapture === "function") window.stopCapture(); } catch (e) {}
      toast("⏹ Recording stopped. Say “generate the note” when ready.");
      return true;
    }, true));
    unregs.push(fx.registerIntent("voice-generate-note", function (q) {
      if (!/^(?:please\s+)?(?:generate|write|create|make)(?:\s+(?:the|my|a))?\s+note$/i.test(S(q).trim())) return false;
      try { if (typeof window.showView === "function") window.showView("visit"); } catch (e) {}
      try { if (typeof window.generateNote === "function") window.generateNote(); } catch (e) {}
      toast("\u{1F4DD} Generating the note from your recording…");
      return true;
    }, true));
    unregs.push(fx.registerIntent("voice-send-to-athena", function (q) {
      if (!/^(?:please\s+)?send\s+(?:it|the\s+(?:visit|note)|everything)?\s*to\s+athena(?:one)?$/i.test(S(q).trim())) return false;
      /* SAFETY: never auto-push. Open the review-&-confirm modal; the doctor
         confirms + inserts there (note-only writeback path, no orders). */
      try { var e = $("emrBtn"); if (e) e.click(); } catch (e2) {}
      toast("\u{1F5C2}️ Review & confirm opened — nothing goes to Athena until you confirm it there.");
      return true;
    }, true));
  }

  function tick() { try { css(); ensureBtn(); registerIntents(); } catch (e) {} }
  tick();
  var iv = setInterval(tick, 1200);

  window.__mlsCopilotVoiceB39_revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { unregs.forEach(function (u) { try { u(); } catch (e) {} }); } catch (e) {}
    try { var b = $("mlsCopVoiceBtn"); if (b) b.remove(); } catch (e) {}
    try { var s = $("mlsVoiceB39Css"); if (s) s.remove(); } catch (e) {}
    window.__mlsCopilotVoiceB39 = 0;
  };
})();

/* =========================================================================
 * MLS Scribe -- b39 Studio overhaul + ONE auto-start tour  (__mlsStudioTourB39)
 * 2026-07-06. Additive / guarded / reversible: window.__mlsStudioTourB39_revert().
 *
 * (R2-1) ONE How-To: the two duplicate "How-To Guide" menu entries (v1
 *   #mlsTourMenuItem + v2 #mlsTourMenuItemV2) are CSS-hidden; ONE new menu
 *   entry opens the NEW comprehensive tour. The tour AUTO-STARTS the first
 *   time someone loads the app (localStorage mls_tour_seen_v3), covers the
 *   whole product, and never touches real data.
 * (R2-2) AI Studio overhaul: Copilot + "Build a custom tool" move to the TOP
 *   (they are the magic); the widget result appears right beneath them; the
 *   Study Groups machinery becomes a clearly-labeled COLLAPSIBLE "advanced"
 *   section at the bottom with a plain-English 1-2-3 explainer. All original
 *   elements/IDs/handlers untouched -- only reordered/wrapped.
 * (R2-3) Build-a-custom-tool upgrades: every successful build AUTO-SAVES to
 *   "My creations" (nothing lost); an "✏️ Improve this tool" box under the
 *   result iterates on the widget with one click; Enter-to-build; clearer
 *   status. Uses the existing /api/widget/generate + saved-widget plumbing.
 * SAFETY: UI only. No Athena writes, no orders, no PHI logged.
 * ==========================================================================*/
(function () {
  "use strict";
  if (window.__mlsStudioTourB39) return; window.__mlsStudioTourB39 = { v: "b39" };
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function S(x) { return x == null ? "" : String(x); }
  function esc(s) { return S(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  /* ======================= CSS ======================= */
  function css() {
    if ($("mlsB39Css")) return;
    var st = document.createElement("style"); st.id = "mlsB39Css";
    st.textContent = [
      /* ONE How-To menu entry: hide the two legacy tour items */
      "#mlsTourMenuItem,#mlsTourMenuItemV2{display:none!important}",
      /* Studio: study-groups advanced section */
      "#mlsB39SgWrap{margin:18px 0 8px;border:1px solid var(--line,#dbe4f0);border-radius:14px;background:var(--card,#fff);overflow:hidden}",
      "#mlsB39SgHead{display:flex;align-items:center;gap:10px;width:100%;padding:14px 18px;background:none;border:0;cursor:pointer;text-align:left;font:700 15px system-ui;color:var(--ink,#16233a)}",
      "#mlsB39SgHead .b39-caret{margin-left:auto;transition:transform .2s}",
      "#mlsB39SgWrap.open #mlsB39SgHead .b39-caret{transform:rotate(180deg)}",
      "#mlsB39SgBody{display:none;padding:2px 16px 16px}",
      "#mlsB39SgWrap.open #mlsB39SgBody{display:block}",
      "#mlsB39SgSteps{display:flex;gap:10px;flex-wrap:wrap;margin:2px 0 12px}",
      "#mlsB39SgSteps span{font:600 12.5px system-ui;color:#3b5f9e;background:#eef4ff;border:1px solid #d5e2f8;border-radius:999px;padding:5px 12px}",
      "#mlsB39SgWrap #mls-sg-root{margin:0!important}",
      /* Improve-this-tool row */
      "#mlsB39Improve{display:flex;gap:8px;margin-top:10px}",
      "#mlsB39ImproveTx{flex:1;font:500 13.5px system-ui;padding:9px 12px;border:1px solid var(--line,#cdd9ea);border-radius:10px}",
      "#mlsB39ImproveBtn{background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;border:0;border-radius:10px;padding:9px 16px;font:700 13.5px system-ui;cursor:pointer}",
      "#mlsB39ImproveBtn:disabled{opacity:.6}",
      /* Tour */
      "#mlsB39TourOv{position:fixed;inset:0;z-index:2147483200;background:rgba(8,16,34,.55);display:flex;align-items:flex-end;justify-content:center;pointer-events:auto}",
      "#mlsB39TourCard{margin:0 16px 26px;max-width:560px;width:100%;background:linear-gradient(180deg,#102a49,#0d2138);border:1px solid rgba(140,170,240,.4);border-radius:16px;box-shadow:0 24px 70px rgba(0,0,0,.55);padding:20px 22px;color:#eaf1ff;font-family:system-ui}",
      "#mlsB39TourCard h3{margin:0 0 6px;font-size:17px}",
      "#mlsB39TourCard p{margin:0 0 14px;font-size:14px;line-height:1.55;color:#c8d6f2}",
      "#mlsB39TourCard .b39-row{display:flex;align-items:center;gap:8px}",
      "#mlsB39TourCard .b39-step{font-size:12px;color:#8ea6d4;margin-right:auto}",
      "#mlsB39TourCard button{font:700 13px system-ui;border-radius:9px;padding:8px 15px;cursor:pointer;border:1px solid rgba(160,190,255,.4)}",
      ".b39-skip{background:none;color:#9fb4dd}",
      ".b39-back{background:rgba(255,255,255,.1);color:#eaf1ff}",
      ".b39-next{background:#2f6bed;color:#fff;border-color:#2f6bed!important}",
      ".mlsB39Spot{outline:3px solid #5b8cff!important;outline-offset:3px;border-radius:10px;box-shadow:0 0 0 6px rgba(91,140,255,.25)!important;transition:outline .15s}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }

  /* ======================= (R2-2) Studio reorder ======================= */
  var _sgOpenKey = "mlsB39SgOpen";
  function reorderStudio() {
    try {
      var sv = $("studioView"); if (!sv) return;
      var sg = $("mls-sg-root"); if (!sg || $("mlsB39SgWrap")) { placeOrder(sv); return; }
      /* wrap study groups in the collapsible advanced section */
      var wrap = document.createElement("div"); wrap.id = "mlsB39SgWrap";
      wrap.innerHTML =
        '<button type="button" id="mlsB39SgHead">&#128202; Study Groups <span style="font:600 12px system-ui;color:#7d8ba1">&mdash; advanced: build a patient cohort, then run a study (graph + Excel + PDF)</span><span class="b39-caret">&#9662;</span></button>' +
        '<div id="mlsB39SgBody"><div id="mlsB39SgSteps"><span>1&#65039;&#8419; Create or pick a group</span><span>2&#65039;&#8419; Add patients (type, paste a list, or pull from Athena)</span><span>3&#65039;&#8419; Run the study &mdash; you get a graph, an Excel file and a PDF</span></div></div>';
      sg.parentNode.insertBefore(wrap, sg);
      wrap.querySelector("#mlsB39SgBody").appendChild(sg);
      var open = false; try { open = localStorage.getItem(_sgOpenKey) === "1"; } catch (e) {}
      if (open) wrap.classList.add("open");
      wrap.querySelector("#mlsB39SgHead").addEventListener("click", function () {
        wrap.classList.toggle("open");
        try { localStorage.setItem(_sgOpenKey, wrap.classList.contains("open") ? "1" : "0"); } catch (e) {}
      });
      placeOrder(sv);
    } catch (e) {}
  }
  function placeOrder(sv) {
    try {
      /* target order: title -> pay -> copilot grid (anchor/card/right) -> result -> advanced SG */
      var ids = ["mlsB39SgWrap", "studioResultCard"];
      ids.forEach(function (id) { var el = $(id); if (el && el.parentNode === sv) sv.appendChild(el); });
      /* result card should come BEFORE the advanced section */
      var res = $("studioResultCard"), wrap = $("mlsB39SgWrap");
      if (res && wrap && res.parentNode === sv && wrap.parentNode === sv) sv.insertBefore(res, wrap);
      /* pay button right under the title strip */
      var pay = sv.querySelector(".mls-b34-pay"), title = sv.querySelector(".sx-title");
      if (pay && title && title.nextSibling !== pay) sv.insertBefore(pay, title.nextSibling);
    } catch (e) {}
  }

  /* ======================= (R2-3) Build-a-tool upgrades ======================= */
  var _origRender = null;
  function toolUpgrades() {
    try {
      /* auto-save every successful build (wrap renderStudioWidget once) */
      if (typeof window.renderStudioWidget === "function" && !window.renderStudioWidget.__b39) {
        _origRender = window.renderStudioWidget;
        var w = function (html, title) {
          var r = _origRender.apply(this, arguments);
          try {
            if (html && typeof window.studioGetSaved === "function" && typeof window.studioSetSaved === "function") {
              var arr = window.studioGetSaved();
              var t = S(title || "Widget").slice(0, 80);
              if (!arr.length || arr[0].html !== html) {
                arr.unshift({ title: t, html: S(html), ts: Date.now(), auto: true });
                window.studioSetSaved(arr);
                if (typeof window.renderStudioSaved === "function") window.renderStudioSaved();
              }
            }
          } catch (e) {}
          try { ensureImprove(); } catch (e) {}
          return r;
        };
        w.__b39 = true; window.renderStudioWidget = w;
      }
      /* Enter-to-build in the prompt box */
      var ta = $("studioPrompt");
      if (ta && !ta.__b39) {
        ta.__b39 = 1;
        ta.addEventListener("keydown", function (ev) {
          if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); try { window.generateStudioWidget && window.generateStudioWidget(); } catch (e) {} }
        });
        ta.placeholder = (ta.placeholder || "") + "  (Ctrl+Enter builds it)";
      }
      ensureImprove();
    } catch (e) {}
  }
  function ensureImprove() {
    try {
      var card = $("studioResultCard"); if (!card || $("mlsB39Improve")) return;
      var row = document.createElement("div"); row.id = "mlsB39Improve";
      row.innerHTML = '<input id="mlsB39ImproveTx" type="text" placeholder="&#9999;&#65039; Tell MLS what to change &mdash; e.g. add a search box, make the buttons bigger, chart it by month&hellip;"><button type="button" id="mlsB39ImproveBtn">&#10024; Improve it</button>';
      card.appendChild(row);
      function go() {
        var tx = $("mlsB39ImproveTx"), btn = $("mlsB39ImproveBtn");
        var req = S(tx && tx.value).trim(); if (!req) return;
        var base = S(window.studioLastPrompt || ($("studioPrompt") || {}).value || "").trim();
        var p = $("studioPrompt"); if (!p) return;
        p.value = (base ? (base + ". ") : "") + "Now also: " + req;
        if (btn) { btn.disabled = true; setTimeout(function () { btn.disabled = false; }, 4000); }
        if (tx) tx.value = "";
        try { window.generateStudioWidget && window.generateStudioWidget(); } catch (e) {}
      }
      $("mlsB39ImproveBtn").addEventListener("click", go);
      $("mlsB39ImproveTx").addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); go(); } });
    } catch (e) {}
  }

  /* ======================= (R2-1) THE tour ======================= */
  var SEEN = "mls_tour_seen_v3";
  var _tourIdx = 0, _spotEl = null;
  var STEPS = [
    { t: "\u{1F44B} Welcome to MLS Scribe", p: "This 2-minute tour shows you everything. You can leave any time and re-open it from Menu → How-To Guide. Nothing in the tour touches real patient data.", go: "visit" },
    { t: "\u{1F7E2} athenaOne connection", p: "Bottom-left, next to the MLS Assistant, one status panel tells you the truth about your Athena connection, pulls, matching and writeback readiness. Green dot = connected. If it is red, open athenaOne in a tab and sign in — MLS sees it automatically.", sel: "#mlsScDock" },
    { t: "\u{1F4CB} Who's Next — your day at a glance", p: "The blue boxes show the 5 patients closest to right now (12-hour times), each with their \u{1F382} birthday. Tap a box and MLS loads them — name and DOB auto-fill from the Athena schedule. “More” expands the whole day.", sel: "#heroToday", go: "visit" },
    { t: "\u{1F399}️ Just talk — MLS writes the note", p: "Pick a patient, hit Start recording, and talk normally. MLS turns the conversation into a complete note. Prefer your phone? Scan the QR card to record from it.", sel: "#heroRecBtn" },
    { t: "\u{1F9ED} The guided visit wizard", p: "The 4 steps across the top — Patient → Capture → Note → Sign — walk you through a full visit so you never wonder what's next.", sel: "#mls-rt-bar" },
    { t: "\u{1F5C2}️ EMR sections — review & confirm", p: "After a note is generated, open EMR sections from inside the MLS Assistant. MLS auto-sorts your note into chart sections; you review, confirm, and only then does anything go to athenaOne. The ⚙ gear sets exactly WHERE each section lands.", sel: "#mlsAsstFab" },
    { t: "\u{1F680} Send the visit to Athena", p: "One button pushes the confirmed visit into athenaOne. Nothing is ever sent without your confirm — and orders are never auto-created.", },
    { t: "\u{1F4C5} Calendar", p: "Month, week and day views of the real pulled schedule, scoped to you or any provider. The Pay Reports button lives here too.", go: "calendar", sel: "#calendarView .mls-b34-pay" },
    { t: "\u{1F4B5} Pay Reports (Premium)", p: "Per-provider patient counts, half-day credits, days × rate and clearly-labeled AI-estimated collections — with Excel export. Find it at the top of Calendar and AI Studio.", },
    { t: "✨ AI Studio (Premium)", p: "Ask the MLS Copilot anything about your practice — it reads your own data. “Build a custom tool” turns a sentence into a working dashboard, calculator or worklist; every build saves to My creations, and the Improve box refines it.", go: "studio", sel: "#copilotCard" },
    { t: "\u{1F4CA} Study Groups (advanced)", p: "Down at the bottom of AI Studio: build a named patient cohort, then run a study that outputs a graph, an Excel file and a PDF. Collapsed until you need it.", sel: "#mlsB39SgWrap" },
    { t: "⭐ Reviews & reputation (Premium)", p: "MLS auto-finds your Google listings and reviews and helps you market the practice. Open it from Menu → Reviews & reputation.", },
    { t: "\u{1F916} ONE assistant for everything", p: "The MLS Assistant (bottom-left) is your single helper: chat or tap \u{1F3A4} and talk. It pulls schedules, answers questions like “how many patients did Dr. X see this month”, opens charts, and can change where notes write back — just ask.", sel: "#mlsAsstFab" },
    { t: "❓ Help, any time", p: "The Help button (top-right) opens the written step-by-step guide, and this tour is always in Menu → \u{1F4D8} How-To Guide. That's it — go see patients, MLS handles the paperwork. \u{1F389}", sel: "#nav_help" }
  ];
  function unspot() { try { if (_spotEl) _spotEl.classList.remove("mlsB39Spot"); _spotEl = null; } catch (e) {} }
  function spot(sel) {
    unspot();
    if (!sel) return;
    try {
      var el = document.querySelector(sel); if (!el) return;
      el.classList.add("mlsB39Spot"); _spotEl = el;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (e) {}
  }
  function showStep() {
    var s = STEPS[_tourIdx]; if (!s) return endTour(true);
    try { if (s.go && typeof window.showView === "function") window.showView(s.go); } catch (e) {}
    var ov = $("mlsB39TourOv");
    if (!ov) {
      ov = document.createElement("div"); ov.id = "mlsB39TourOv";
      ov.addEventListener("click", function (ev) { if (ev.target === ov) {/* keep open */} });
      document.body.appendChild(ov);
    }
    ov.innerHTML = '<div id="mlsB39TourCard"><h3>' + esc(s.t) + '</h3><p>' + esc(s.p) + '</p>' +
      '<div class="b39-row"><span class="b39-step">Step ' + (_tourIdx + 1) + ' of ' + STEPS.length + '</span>' +
      '<button type="button" class="b39-skip">Skip tour</button>' +
      (_tourIdx > 0 ? '<button type="button" class="b39-back">&#8592; Back</button>' : '') +
      '<button type="button" class="b39-next">' + (_tourIdx === STEPS.length - 1 ? "Finish ✓" : "Next →") + '</button></div></div>';
    ov.querySelector(".b39-skip").onclick = function () { endTour(true); };
    var bk = ov.querySelector(".b39-back"); if (bk) bk.onclick = function () { _tourIdx = Math.max(0, _tourIdx - 1); showStep(); };
    ov.querySelector(".b39-next").onclick = function () { _tourIdx++; if (_tourIdx >= STEPS.length) endTour(true); else showStep(); };
    setTimeout(function () { spot(s.sel); }, s.go ? 450 : 0);
  }
  function startTour() { _tourIdx = 0; showStep(); }
  function endTour(markSeen) {
    unspot();
    var ov = $("mlsB39TourOv"); if (ov) ov.remove();
    if (markSeen) { try { localStorage.setItem(SEEN, "1"); } catch (e) {} }
    try { if (typeof window.showView === "function") window.showView("visit"); } catch (e) {}
  }
  function menuItem() {
    try {
      var panel = $("mlsTbMenuPanel"); if (!panel || $("mlsB39MenuItem")) return;
      var btn = document.createElement("button");
      btn.id = "mlsB39MenuItem"; btn.className = "mlsTbItem"; btn.type = "button";
      btn.innerHTML = "\u{1F4D8} How-To Guide";
      btn.onclick = function () { try { panel.style.display = "none"; } catch (e) {} startTour(); };
      panel.insertBefore(btn, panel.firstChild);
    } catch (e) {}
  }
  var _autoTried = false;
  function autoStart() {
    if (_autoTried) return;
    try {
      if (localStorage.getItem(SEEN) === "1") { _autoTried = true; return; }
      /* only when actually in the app (logged in, visit view exists and is painted) */
      var vv = $("visitView"); var lv = $("loginView");
      var inApp = vv && (!lv || lv.offsetParent === null);
      if (!inApp) return;
      if ($("mlsBootVeil") || $("sfGateLoading") && $("sfGateLoading").offsetParent !== null) return;
      _autoTried = true;
      setTimeout(startTour, 1200);
    } catch (e) {}
  }

  /* ======================= ticks ======================= */
  function tick() { try { css(); reorderStudio(); toolUpgrades(); menuItem(); autoStart(); } catch (e) {} }
  tick();
  var iv = setInterval(tick, 1000);

  window.__mlsStudioTourB39.start = startTour;
  window.__mlsStudioTourB39_revert = function () {
    try { clearInterval(iv); } catch (e) {}
    endTour(false);
    try { var s = $("mlsB39Css"); if (s) s.remove(); } catch (e) {}
    try { var m = $("mlsB39MenuItem"); if (m) m.remove(); } catch (e) {}
    try { var im = $("mlsB39Improve"); if (im) im.remove(); } catch (e) {}
    try {
      var wrap = $("mlsB39SgWrap"), sg = $("mls-sg-root");
      if (wrap && sg) { wrap.parentNode.insertBefore(sg, wrap); wrap.remove(); }
    } catch (e) {}
    try { if (_origRender && window.renderStudioWidget && window.renderStudioWidget.__b39) window.renderStudioWidget = _origRender; } catch (e) {}
    window.__mlsStudioTourB39 = 0;
  };
})();

/* =========================================================================
 * MLS Scribe -- b36 dock-left enforcement  (__mlsDockLeftB36)  2026-07-06
 * The merged connection/status panel (#mlsScDock) must LIVE bottom-LEFT with
 * the MLS Assistant (item 15). Two older modules (__mlsUiCleanupB26 layout()
 * and the b34 dockDodge) keep re-anchoring it bottom-right via inline
 * !important styles on their own timers. This module owns the dock position:
 * it applies the left anchor and re-applies it the instant anything else
 * rewrites the style attribute (same-frame, no visible flicker).
 * Additive/reversible: window.__mlsDockLeftB36_revert().
 * ==========================================================================*/
(function () {
  "use strict";
  if (window.__mlsDockLeftB36) return; window.__mlsDockLeftB36 = 1;
  var WANT = "auto auto 64px 12px";
  var obs = null;
  function apply(d) { try { if (d.style.getPropertyValue("inset") !== WANT) d.style.setProperty("inset", WANT, "important"); } catch (e) {} }
  function tick() {
    try {
      var d = document.getElementById("mlsScDock"); if (!d) return;
      apply(d);
      if (!d.__b36obs) {
        d.__b36obs = 1;
        obs = new MutationObserver(function () { apply(d); });
        obs.observe(d, { attributes: true, attributeFilter: ["style"] });
      }
    } catch (e) {}
  }
  tick();
  var iv = setInterval(tick, 1200);
  window.__mlsDockLeftB36_revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { obs && obs.disconnect(); } catch (e) {}
    try { var d = document.getElementById("mlsScDock"); if (d) { d.__b36obs = 0; d.style.removeProperty("inset"); } } catch (e) {}
    window.__mlsDockLeftB36 = 0;
  };
})();

/* =========================================================================
 * MLS Scribe -- b35 ONE-assistant pack  (__mlsOneChatB35)   2026-07-06
 * ----------------------------------------------------------------------------
 * Additive / guarded / reversible: window.__mlsOneChatB35_revert().
 * Ships (per Michael):
 *  (12) ONE assistant button + ONE chat. The MLS Assistant panel (bottom-left)
 *       is the single assistant: the duplicate floating entry points (the
 *       bottom-right "MLS Agent" FAB and the floating voice-mic FAB) are
 *       retired (hidden reversibly; their capabilities live in the one chat).
 *       - Voice: a mic button INSIDE the assistant chat input dictates and
 *         sends (same speech engine, one home).
 *       - Analytics: questions like "how many patients did <provider> see"
 *         are answered INSTANTLY from the locally pulled schedule data
 *         (window.mlsAsk) via a transparent /api/copilot interceptor -- the
 *         answer streams into the SAME chat thread; anything else falls
 *         through to the real backend AI (which the assistant already has,
 *         incl. the writeback-redirect intent that changes WHERE items are
 *         placed in athenaOne via __mlsWbRouter).
 *  (15) The merged connection/status panel (#mlsScDock -- Athena connection,
 *       pull, patient matching, writeback readiness, backend sync, calendar,
 *       MLS Easy, EMR section) now LIVES bottom-LEFT with the MLS Assistant
 *       (no more bottom-right overlap; single indicator, item 5 finalized).
 *       A live status dot mirrors it on the assistant button.
 *  (13-guard) Watchdog: feat_athena_provider_picker's legacy "takeover"
 *       reverts the Who's-Next picker at boot; if that happens and no
 *       replacement UI exists, Who's Next is auto-restored.
 * SAFETY: UI/wiring only. Athena READ-ONLY. No writeback, no orders.
 * ==========================================================================*/
(function () {
  "use strict";
  if (window.__mlsOneChatB35) return; window.__mlsOneChatB35 = { v: "b35" };
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function S(x) { return x == null ? "" : String(x); }

  /* ---------- CSS: retire duplicate assistant entry points ------------------ */
  function css() {
    if ($("mlsOneChatB35Css")) return;
    var st = document.createElement("style"); st.id = "mlsOneChatB35Css";
    st.textContent = [
      "#mlsP1AgFab{display:none!important}",            /* duplicate 'MLS Agent' FAB -> one assistant */
      "#mlsVoiceFab{display:none!important}",           /* floating mic -> mic inside the one chat */
      ".mls-b35-mic{background:rgba(47,107,237,.9);border:none;color:#fff;border-radius:9px;padding:7px 10px;font-size:14px;cursor:pointer;margin-right:6px}",
      ".mls-b35-mic.rec{background:#d33;animation:mlsB35pulse 1s ease-in-out infinite}",
      "@keyframes mlsB35pulse{50%{filter:brightness(1.35)}}",
      ".mls-b35-dot{position:absolute;top:-3px;right:-3px;width:12px;height:12px;border-radius:50%;border:2px solid #0d1b33;background:#9aa7b8}",
      ".mls-b35-dot.ok{background:#2ecc71}.mls-b35-dot.bad{background:#ff5f56}.mls-b35-dot.chk{background:#f5b942}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- (15) status dock lives bottom-left with the assistant --------- */
  function dockLeft() {
    try {
      var d = $("mlsScDock"); if (!d) return;
      d.style.setProperty("left", "12px", "important");
      d.style.setProperty("right", "auto", "important");
      /* sit just above the bottom-left button stack (Pay/EMR retired, so this is clean) */
      d.style.setProperty("bottom", "64px", "important");
    } catch (e) {}
  }
  /* mirror the dock's status dot on the assistant FAB (visible even when dock minimized) */
  function fabDot() {
    try {
      var fab = $("mlsAsstFab"); if (!fab) return;
      if (getComputedStyle(fab).position === "static") fab.style.position = "relative";
      var dot = fab.querySelector(".mls-b35-dot");
      if (!dot) { dot = document.createElement("span"); dot.className = "mls-b35-dot"; fab.appendChild(dot); }
      var src = document.querySelector("#mlsScDock .sc-dot");
      var cls = "mls-b35-dot";
      if (src) { if (src.classList.contains("ok")) cls += " ok"; else if (src.classList.contains("bad")) cls += " bad"; else if (src.classList.contains("chk")) cls += " chk"; }
      if (dot.className !== cls) dot.className = cls;
    } catch (e) {}
  }

  /* ---------- (12) mic inside the one chat ---------------------------------- */
  var rec = null, recOn = false;
  function ensureMic() {
    try {
      var p = $("mls-assist-panel"); if (!p) return;
      var ta = p.querySelector(".as-input textarea") || p.querySelector("textarea");
      if (!ta || !ta.parentElement || ta.parentElement.querySelector(".mls-b35-mic")) return;
      var SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return;
      var b = document.createElement("button"); b.type = "button"; b.className = "mls-b35-mic";
      b.title = "Dictate to the assistant"; b.innerHTML = "&#127908;";
      b.onclick = function () {
        try {
          if (recOn) { try { rec.stop(); } catch (e) {} return; }
          rec = new SR(); rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false;
          var finalTxt = "";
          rec.onresult = function (ev) {
            var t = ""; for (var i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
            ta.value = t; try { ta.dispatchEvent(new Event("input", { bubbles: true })); } catch (e) {}
            if (ev.results[ev.results.length - 1].isFinal) finalTxt = t;
          };
          rec.onend = function () {
            recOn = false; b.classList.remove("rec");
            if (finalTxt.trim()) {
              /* send through the assistant's own pipeline */
              try { if (window.__mlsAsstFix && typeof window.__mlsAsstFix._handleSend === "function") { window.__mlsAsstFix._handleSend(finalTxt.trim()); ta.value = ""; } } catch (e) {}
            }
          };
          rec.onerror = function () { recOn = false; b.classList.remove("rec"); };
          recOn = true; b.classList.add("rec"); rec.start();
        } catch (e) { recOn = false; b.classList.remove("rec"); }
      };
      ta.parentElement.insertBefore(b, ta);
    } catch (e) {}
  }

  /* ---------- (12) instant local analytics in the SAME chat thread ---------- */
  /* Transparent /api/copilot interceptor: when the question is clearly an
     analytics question about the pulled schedule and window.mlsAsk (the local
     smart-ask layer over window._calAppts) produces a concrete answer, answer
     locally (fast, exact, works even when the AI service is rate-limited).
     Everything else passes through to the real backend untouched. */
  var _origFetch = window.fetch;
  function analyticsAnswer(q) {
    try {
      if (!q || typeof window.mlsAsk !== "function") return null;
      if (!/(how many|number of|count|most common|most frequent|busiest|who saw|revenue|how much)/i.test(q)) return null;
      if (!/(patient|visit|appointment|appt|procedure|reason|revenue|see|saw)/i.test(q)) return null;
      var a = window.mlsAsk(q);
      var ans = a && S(a.answer).trim();
      if (!ans || /ask me something/i.test(ans)) return null;
      return ans + "  — computed live from your pulled athenaOne schedule.";
    } catch (e) { return null; }
  }
  function wrapFetch() {
    /* b37 HOTFIX: wrap exactly ONCE per page. The old marker check re-wrapped every
       time another module (feat_mls_provider_passthrough) layered its own wrapper on
       top, and the two kept re-wrapping each other -> call-stack overflow. */
    if (window.__mlsB35FetchWrapped) return; window.__mlsB35FetchWrapped = 1;
    var of = window.fetch;
    var f = function (input, init) {
      try {
        var url = (typeof input === "string") ? input : (input && input.url) || "";
        if (/\/api\/copilot(\?|$)/.test(url) && init && init.body) {
          var q = ""; try { q = (JSON.parse(init.body) || {}).question || ""; } catch (e) {}
          var ans = analyticsAnswer(q);
          if (ans) return Promise.resolve(new Response(JSON.stringify({ reply: ans }), { status: 200, headers: { "Content-Type": "application/json" } }));
        }
      } catch (e) {}
      return of.apply(this, arguments);
    };
    f.__mlsB35 = true; f.__orig = of;
    window.fetch = f;
  }

  /* ---------- Who's-Next takeover watchdog ----------------------------------- */
  function wnGuard() {
    try {
      var wn = window.__mlsWhosNext;
      if (!wn || wn.installed || typeof wn.reapply !== "function") return;
      /* only restore when the legacy picker's replacement box is NOT present */
      if ($("mlsPtfBox")) return;
      wn.installed = true; wn.reapply();
    } catch (e) {}
  }

  /* ---------- ticks ----------------------------------------------------------- */
  function tick() { try { css(); dockLeft(); fabDot(); ensureMic(); wrapFetch(); wnGuard(); } catch (e) {} }
  tick();
  var iv = setInterval(tick, 900);

  window.__mlsOneChatB35_revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { var s = $("mlsOneChatB35Css"); if (s) s.remove(); } catch (e) {}
    try { if (window.fetch && window.fetch.__mlsB35) window.fetch = window.fetch.__orig; window.__mlsB35FetchWrapped = 0; } catch (e) {}
    try { var d = $("mlsScDock"); if (d) { d.style.removeProperty("left"); d.style.removeProperty("right"); d.style.removeProperty("bottom"); } } catch (e) {}
    try { [].forEach.call(document.querySelectorAll(".mls-b35-mic,.mls-b35-dot"), function (n) { n.remove(); }); } catch (e) {}
    window.__mlsOneChatB35 = 0;
  };
})();

/* =========================================================================
 * MLS Scribe -- b34 fix pack  (__mlsFixPackB34)   2026-07-06
 * ----------------------------------------------------------------------------
 * Additive / guarded / reversible: window.__mlsFixPackB34_revert().
 * Items shipped in this module:
 *  (1) Boot "Signing into your workspace" veil: replace the outdated square-"M"
 *      logo with the CURRENT app logo (the auth-screen gradient waveform mark).
 *  (2) Pay Reports: retire the floating bottom-left button; add a
 *      "Pay Reports (Premium feature)" button inside AI Studio + Calendar.
 *      Same real opener (window.__mlsComp.open) -- nothing re-implemented.
 *  (3) Enable the AI Studio design-exact rebuild (feat_mls_studio_exact.js)
 *      on PROD via the prod-enable marker (it was staging-gated).
 *  (4) Provider identity is DATA-DRIVEN: defuses the legacy hardcoded-canon
 *      block and resolves getProviderName() from the real Athena provider
 *      roster / stored identity (no clinician names hardcoded in code).
 *  (5) Single connection indicator: the bottom-right status dock no longer
 *      overlaps the MLS Agent panel (dock shifts aside while the panel is
 *      open) and duplicate connection pills are suppressed.
 *  (6) The bottom-left "EMR sections" button now lives INSIDE the MLS
 *      Assistant panel (standalone button hidden, real handler preserved).
 * SAFETY: UI only. Athena READ-ONLY. No writeback, no orders, no PHI logged.
 * ==========================================================================*/
(function () {
  "use strict";
  if (window.__mlsFixPackB34) return; window.__mlsFixPackB34 = { v: "b34" };
  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function S(x) { return x == null ? "" : String(x); }
  function unsGet(n) { try { if (typeof window.uns !== "function") return ""; return S(localStorage.getItem(window.uns(n)) || ""); } catch (e) { return ""; } }

  /* ---------- (3) prod-enable marker for the AI Studio exact rebuild ------- */
  window.__MLS_SX_PROD = 1;

  /* ---------- (4) data-driven provider identity ---------------------------- */
  /* Pre-set the legacy module's guard so its hardcoded-canon block never
     installs (it checks `if(window.__mlsCanonProvider) return;`). */
  window.__mlsCanonProvider = true;
  function prettyProv(p) {
    p = S(p).replace(/Close$/, "").trim(); if (!p) return "";
    if (p.indexOf("_") < 0) return p;
    var m = p.split("_"); var cred = m.length > 2 ? m.slice(2).join(" ").replace(/_/g, " ") : "";
    return (m[1] + " " + m[0] + (cred ? ", " + cred : "")).trim();
  }
  function roster() {
    try { var a = JSON.parse(unsGet("mlsSchedProviders") || "[]"); return Array.isArray(a) ? a.map(prettyProv).filter(Boolean) : []; } catch (e) { return []; }
  }
  function accountName() {
    var nm = unsGet("docname") || unsGet("providerName") || "";
    if (!nm) { try { var el = document.querySelector('[class*="tb-user"],[id*="topbarUser"],[class*="userName"]'); if (el) nm = el.textContent || ""; } catch (e) {} }
    return S(nm).replace(/^Dr\.?\s+/i, "").replace(/,.*$/, "").trim();
  }
  function surname(nm) { var t = S(nm).trim().split(/\s+/); return (t[t.length - 1] || "").toUpperCase().replace(/[^A-Z]/g, ""); }
  function resolveProviderName() {
    /* 1) roster (real Athena provider data) entry matching the account surname */
    var sn = surname(accountName());
    if (sn) {
      var hits = roster().filter(function (p) { return p.toUpperCase().indexOf(sn) >= 0; });
      if (hits.length === 1) return hits[0];
      if (hits.length > 1) { var md = hits.filter(function (p) { return /(,|\s)MD\b/i.test(p); }); if (md.length === 1) return md[0]; return hits[0]; }
    }
    /* 2) stored provider identity (user/app data, not code) */
    var stored = unsGet("providerName") || unsGet("docname");
    if (stored) return stored;
    /* 3) the account display name itself */
    return accountName();
  }
  var provFn = function () { return resolveProviderName(); };
  provFn.__mlsB34 = 1;
  function applyProv() { try { if (!window.getProviderName || !window.getProviderName.__mlsB34) window.getProviderName = provFn; } catch (e) {} }
  applyProv();

  /* ---------- (1) boot veil: current logo ---------------------------------- */
  var MARK = '<svg viewBox="0 0 56 56" width="34" height="34" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="svMarkB34" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f9ad6"/><stop offset="1" stop-color="#127a7d"/></linearGradient></defs><rect x="0" y="0" width="56" height="56" rx="15" fill="url(#svMarkB34)"/><path d="M11 30 H20 L24 19 L30 39 L35 25 L39 30 H46" fill="none" stroke="#ffffff" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="46" cy="30" r="3.2" fill="#bff0e9"/></svg>';
  function fixVeilLogo() {
    try {
      var v = $("mlsBootVeil"); if (!v || v.__mlsB34Logo) return;
      var sp = null, spans = v.querySelectorAll("span");
      for (var i = 0; i < spans.length; i++) { if (S(spans[i].textContent).trim() === "M") { sp = spans[i]; break; } }
      if (!sp) return;
      sp.style.background = "none"; sp.style.borderRadius = "0";
      sp.innerHTML = MARK; v.__mlsB34Logo = 1;
    } catch (e) {}
  }

  /* ---------- (2)(5)(6) CSS ------------------------------------------------- */
  function css() {
    if ($("mlsFixPackB34Css")) return;
    var st = document.createElement("style"); st.id = "mlsFixPackB34Css";
    st.textContent = [
      "#mlsCompBtn{display:none!important}",                       /* (2) retire floating Pay Report */
      "#emrBtn{display:none!important}",                           /* (6) retire standalone EMR sections */
      "#mlsScDock{transition:right .25s ease}",                    /* (5) smooth dodge */
      ".mls-b34-pay{display:inline-flex;align-items:center;gap:8px;margin:10px 0 12px;padding:10px 16px;border:0;border-radius:999px;background:linear-gradient(135deg,#1e3a8a,#2563eb);color:#fff;font:600 14px/1 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;box-shadow:0 6px 18px rgba(30,58,138,.35);cursor:pointer}",
      ".mls-b34-pay:hover{filter:brightness(1.08)}",
      ".mls-b34-pay .b34-prem{font-size:10px;font-weight:800;letter-spacing:.5px;background:linear-gradient(135deg,#b98aff,#7c4dff);border-radius:999px;padding:2px 8px}",
      ".mls-b34-emr-wrap{padding:8px 12px 2px}",
      ".mls-b34-emr{width:100%;background:#3452d6;border:none;color:#fff;border-radius:11px;padding:10px 14px;font-weight:800;font-size:13px;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}",
      ".mls-b34-emr:hover{filter:brightness(1.1)}"
    ].join("\n");
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- (2) Pay Reports buttons in AI Studio + Calendar --------------- */
  function payBtn() {
    var b = document.createElement("button");
    b.type = "button"; b.className = "mls-b34-pay";
    b.setAttribute("data-tip", "Monthly pay / compensation report (Premium feature)");
    b.innerHTML = "&#128181; Pay Reports <span class=\"b34-prem\">PREMIUM FEATURE</span>";
    b.onclick = function () { try { if (window.__mlsComp && window.__mlsComp.open) window.__mlsComp.open(); } catch (e) {} };
    return b;
  }
  function injectPay() {
    ["studioView", "calendarView"].forEach(function (vid) {
      try {
        var v = $(vid); if (!v || v.querySelector(".mls-b34-pay")) return;
        v.insertBefore(payBtn(), v.firstChild);
      } catch (e) {}
    });
  }

  /* ---------- (6) EMR sections inside the MLS Assistant panel --------------- */
  function injectEmr() {
    try {
      var panel = $("mls-assist-panel"); if (!panel || panel.querySelector(".mls-b34-emr")) return;
      var wrap = document.createElement("div"); wrap.className = "mls-b34-emr-wrap";
      var b = document.createElement("button"); b.type = "button"; b.className = "mls-b34-emr";
      b.innerHTML = "&#128450;&#65039; EMR sections &mdash; review &amp; confirm";
      b.onclick = function () { try { var e = $("emrBtn"); if (e) e.click(); } catch (e2) {} };
      wrap.appendChild(b);
      /* place right under the big "Open athenaOne in new tab" button when present */
      var anchor = null, btns = panel.querySelectorAll("button");
      for (var i = 0; i < btns.length; i++) { if (/open athenaone in new tab/i.test(btns[i].textContent || "")) { anchor = btns[i]; break; } }
      if (anchor && anchor.parentElement === panel) panel.insertBefore(wrap, anchor.nextSibling);
      else if (anchor && anchor.parentElement) anchor.parentElement.insertBefore(wrap, anchor.nextSibling);
      else panel.insertBefore(wrap, panel.children[1] || null);
    } catch (e) {}
  }

  /* ---------- (5) one connection indicator, no overlap ----------------------- */
  function dockDodge() {
    try {
      var d = $("mlsScDock"); if (!d) return;
      var ag = $("mlsP1Ag");
      var open = !!(ag && ag.offsetParent !== null && getComputedStyle(ag).display !== "none");
      d.style.setProperty("right", open ? "356px" : "16px", "important");
      /* suppress any stray duplicate athena connection pill outside the dock */
      var dots = document.querySelectorAll("#mlsAthenaStatusDot");
      for (var i = 0; i < dots.length; i++) dots[i].style.display = "none";
    } catch (e) {}
  }

  /* ---------- ticks ---------------------------------------------------------- */
  function tick() { try { css(); fixVeilLogo(); injectPay(); injectEmr(); dockDodge(); applyProv(); } catch (e) {} }
  tick();
  var fast = setInterval(fixVeilLogo, 80); setTimeout(function () { try { clearInterval(fast); } catch (e) {} }, 15000);
  var iv = setInterval(tick, 900);
  var mo; try { mo = new MutationObserver(function () { fixVeilLogo(); }); mo.observe(document.documentElement, { childList: true, subtree: true }); } catch (e) {}

  window.__mlsFixPackB34_revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { clearInterval(fast); } catch (e) {}
    try { mo && mo.disconnect(); } catch (e) {}
    try { var s = $("mlsFixPackB34Css"); if (s) s.remove(); } catch (e) {}
    try { [].forEach.call(document.querySelectorAll(".mls-b34-pay,.mls-b34-emr-wrap"), function (n) { n.remove(); }); } catch (e) {}
    try { var d = $("mlsScDock"); if (d) d.style.removeProperty("right"); } catch (e) {}
    try { if (window.getProviderName && window.getProviderName.__mlsB34) delete window.getProviderName; } catch (e) {}
    window.__mlsFixPackB34 = 0;
  };
})();

/* =========================================================================
 * MLS Scribe — b33 "How to use" guide unifier  (__mlsHowToB33)
 * ----------------------------------------------------------------------------
 * WHAT: Ships ONE current, blue-styled "How to use MLS" guide modal and makes it
 *       the single Help / How-to path. Reversibly hides/neutralises the DUPLICATE
 *       / stale how-to guides that existed before:
 *         (1) the stale ".howto" strip in #visitView ("1 Start visit 2 Stop 3
 *             Generate note 4 Optimize coding 5 Review & sign" — old flow),
 *         (2) the "Quick guide — how to use MLS" card set (.su_guide) buried in
 *             the setup wizard (#setupModal / #su_step5).
 *       The AI "MLS Help — ask anything" box (#helpModal / openMlsHelp) is a
 *       FEATURE, not a static guide — it is PRESERVED and offered as a secondary
 *       "Ask MLS a question" button inside the one guide.
 *
 * HOW (single path): the top-bar ❓ Help (#nav_help -> openMlsHelp) is re-routed
 *       to open THIS guide. A 🚀-guide entry in setup opens THIS guide too. So a
 *       doctor sees exactly one "How to use / Help" surface.
 *
 * SAFETY: additive, guarded IIFE. Never clobbers existing modules (Task-3 loader,
 *       MLSStatus, __mlsT6Stab, __mlsBootLoader, __mlsUiCleanupB26,
 *       __mlsEmrClarityB28, __mlsEasyMagicB30, __mlsWbConsole, __mlsEasyUnified,
 *       __mlsEasyWizard, __mlsEasyTunnel, etc.). Nothing deleted. Fully
 *       reversible: window.__mlsHowToB33_revert().
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsHowToB33) return;
  window.__mlsHowToB33 = 1;

  var CSS_ID   = 'mlsG33Css';
  var MODAL_ID = 'mlsG33Modal';
  var STALE_ID = 'mlsG33HideStale';        // <style> that hides the stale .howto strip
  var SU_BTN   = 'mlsG33SuGuideBtn';        // injected "open full guide" btn in setup step 5
  var SU_HIDE  = 'mlsG33SuHide';            // marker class on hidden .su_guide cards

  /* ---- 1. styles (MLS Easy blue system) --------------------------------- */
  function ensureCss() {
    if (document.getElementById(CSS_ID)) return;
    var s = document.createElement('style');
    s.id = CSS_ID;
    s.textContent = [
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:100000;display:none;',
      '  align-items:flex-start;justify-content:center;background:rgba(18,30,60,.55);',
      '  -webkit-backdrop-filter:blur(2px);backdrop-filter:blur(2px);overflow:auto;padding:32px 14px;}',
      '#' + MODAL_ID + '.open{display:flex;}',
      '#' + MODAL_ID + ' .g33-card{width:min(760px,100%);background:linear-gradient(180deg,#c2d4f4,#aec4ef);',
      '  border:1px solid rgba(110,140,215,.55);border-radius:16px;',
      '  box-shadow:0 18px 60px rgba(20,40,90,.35);overflow:hidden;color:#12203f;',
      '  font:14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}',
      '#' + MODAL_ID + ' .g33-top{height:5px;background:linear-gradient(90deg,#3b6fe0,#5b8cff);}',
      '#' + MODAL_ID + ' .g33-head{display:flex;align-items:center;gap:10px;padding:16px 20px 4px;}',
      '#' + MODAL_ID + ' .g33-head h2{margin:0;font-size:19px;font-weight:800;color:#16305f;flex:1;}',
      '#' + MODAL_ID + ' .g33-x{cursor:pointer;border:0;background:rgba(255,255,255,.55);',
      '  width:32px;height:32px;border-radius:9px;font-size:17px;line-height:1;color:#16305f;}',
      '#' + MODAL_ID + ' .g33-x:hover{background:#fff;}',
      '#' + MODAL_ID + ' .g33-sub{padding:0 20px 10px;color:#33507f;font-size:13px;}',
      '#' + MODAL_ID + ' .g33-body{padding:6px 20px 8px;}',
      '#' + MODAL_ID + ' .g33-step{background:#dbe6fb;border:1px solid rgba(110,140,215,.40);',
      '  border-radius:12px;padding:12px 14px;margin:10px 0;}',
      '#' + MODAL_ID + ' .g33-step h3{margin:0 0 4px;font-size:15px;color:#16305f;display:flex;',
      '  gap:8px;align-items:center;font-weight:700;}',
      '#' + MODAL_ID + ' .g33-step .n{background:linear-gradient(90deg,#3b6fe0,#5b8cff);color:#fff;',
      '  width:22px;height:22px;border-radius:50%;display:inline-flex;align-items:center;',
      '  justify-content:center;font-size:12px;font-weight:800;flex:0 0 auto;}',
      '#' + MODAL_ID + ' .g33-step p{margin:4px 0 0;color:#22375f;}',
      '#' + MODAL_ID + ' .g33-step b{color:#16305f;}',
      '#' + MODAL_ID + ' .g33-note{font-size:12.5px;color:#3a557f;}',
      '#' + MODAL_ID + ' .g33-tag{display:inline-block;font-size:11px;font-weight:700;',
      '  background:#25406f;color:#dbe6fb;border-radius:6px;padding:1px 7px;margin-left:6px;}',
      '#' + MODAL_ID + ' .g33-foot{padding:12px 20px 20px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;}',
      '#' + MODAL_ID + ' .g33-btn{cursor:pointer;border:0;border-radius:10px;padding:10px 16px;',
      '  font-size:13.5px;font-weight:700;}',
      '#' + MODAL_ID + ' .g33-btn.primary{background:linear-gradient(90deg,#3b6fe0,#5b8cff);color:#fff;}',
      '#' + MODAL_ID + ' .g33-btn.ghost{background:rgba(255,255,255,.6);color:#16305f;}',
      '#' + MODAL_ID + ' .g33-btn.ghost:hover{background:#fff;}',
      '#' + MODAL_ID + ' .g33-foot .sp{flex:1;}',
      '#' + MODAL_ID + ' .g33-mob{font-size:12.5px;color:#33507f;padding:2px 2px 0;}',
      '@media (max-width:640px){',
      '  #' + MODAL_ID + '{padding:14px 8px;}',
      '  #' + MODAL_ID + ' .g33-head h2{font-size:17px;}',
      '  #' + MODAL_ID + ' .g33-foot{flex-direction:column;align-items:stretch;}',
      '  #' + MODAL_ID + ' .g33-foot .sp{display:none;}',
      '  #' + MODAL_ID + ' .g33-btn{width:100%;}',
      '}',
      /* the injected setup-step button */
      '#' + SU_BTN + '{display:inline-flex;gap:8px;align-items:center;cursor:pointer;border:0;',
      '  border-radius:10px;padding:11px 16px;margin:6px 0;font-size:13.5px;font-weight:700;',
      '  background:linear-gradient(90deg,#3b6fe0,#5b8cff);color:#fff;}',
      '.' + SU_HIDE + '{display:none !important;}'
    ].join('');
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---- 2. the ONE current guide (authored from the live b32 UI) ---------- */
  var STEPS = [
    ['🔗', 'Connect athenaOne (one time)',
      'On the MLS Easy home screen use <b>Connect to EMR</b> (HL7 FHIR / SMART on athenaOne). ' +
      'When it is linked you will see a green <b>athenaOne connected</b> badge by the patient header ' +
      'and in the status dock at the bottom-right. MLS only <b>reads</b> from athenaOne until you ' +
      'explicitly confirm and send a note.'],
    ['👤', 'Pick a patient',
      'Three easy ways: (1) tap a name in the <b>Who’s Next</b> grid (the “Today” chips) to make ' +
      'it the active patient instantly; (2) use <b>Pull today’s patients</b> / <b>From Athena chart</b> ' +
      'to load your schedule; or (3) type the <b>Patient name</b> + <b>Date of birth</b> and press ' +
      '<b>Use current patient</b>. The active patient always shows in the header up top — use ' +
      '<b>Switch patient</b> to change.'],
    ['🎙️', 'Record the visit',
      'With a patient active, press <b>Start recording</b> and just talk through the visit normally. ' +
      'MLS listens in the background and transcribes. Press <b>Stop</b> when you’re done. ' +
      'No typing during the visit.'],
    ['📝', 'Generate & review the note',
      'MLS turns the conversation into a structured note in the <b>Note</b> card. Read it over and edit ' +
      'anything you like — it’s your note. You can also <b>Prep op note</b> or apply your own ' +
      '<b>templates</b> from the “Notes & templates” card.'],
    ['🗂️', 'Review EMR sections & confirm',
      'Open <b>EMR sections</b> to see the “review & confirm” window. A 5-step bar guides you: ' +
      '<b>record → MLS auto-sorts → review & edit → confirm approved → insert to athenaOne</b>. ' +
      'The <b>⚙ Writeback destination</b> gear (top-right of that window) sets where each section lands ' +
      'in the chart. Tick the sections you approve. <b>Nothing is written until you confirm and Insert.</b>'],
    ['🚀', 'Send the visit to athenaOne',
      'When the note and sections look right, use <b>🚀 Send full visit to Athena</b> (or <b>Sign & Save</b>). ' +
      'Your signature block is appended automatically. This is the only step that writes to the chart, and ' +
      'it always waits for you.'],
    ['📅', 'Calendar & schedule',
      'The <b>Calendar</b> tab shows the month, a day panel and <b>Who’s Next</b>. Pick any day to see ' +
      'that day’s patients, then tap one to jump straight into the visit with them loaded.'],
    ['💡', 'MLS Copilot',
      'Open <b>AI Studio</b> to ask MLS Copilot about your practice — e.g. “how many patients do I have,” ' +
      '“who’s overdue,” “how busy is tomorrow.” Type your question in the card and it answers with ' +
      'the details, and can open a chart or start a visit for you.'],
    ['⭐', 'Reviews & reputation',
      'The <b>Reviews</b> tab (also in the Menu) finds patient reviews and helps you reply — a simple way ' +
      'to keep your online reputation healthy.'],
    ['📱', 'Use it on your phone',
      'Scan the <b>Record on phone</b> QR code (top-right of MLS Easy) to capture a visit from your phone. ' +
      'Every screen also works in a narrow mobile browser — the cards stack into a single column.']
  ];

  function buildModal() {
    if (document.getElementById(MODAL_ID)) return;
    ensureCss();
    var wrap = document.createElement('div');
    wrap.id = MODAL_ID;
    var stepsHtml = STEPS.map(function (s, i) {
      return '<div class="g33-step"><h3><span class="n">' + (i + 1) + '</span>' +
        s[0] + ' ' + s[1] + '</h3><p>' + s[2] + '</p></div>';
    }).join('');
    wrap.innerHTML =
      '<div class="g33-card" role="dialog" aria-modal="true" aria-label="How to use MLS Scribe">' +
        '<div class="g33-top"></div>' +
        '<div class="g33-head"><h2>📖 How to use MLS Scribe</h2>' +
          '<button class="g33-x" type="button" aria-label="Close" data-g33="close">×</button></div>' +
        '<div class="g33-sub">MLS listens to your visit, writes the note, and — only when you confirm — ' +
          'sends it to athenaOne. Here’s the whole flow in plain steps.</div>' +
        '<div class="g33-body">' + stepsHtml +
          '<div class="g33-mob">Tip: you can reopen this guide anytime from <b>❓ Help</b> in the top bar.</div>' +
        '</div>' +
        '<div class="g33-foot">' +
          '<button class="g33-btn primary" type="button" data-g33="close">Got it</button>' +
          '<button class="g33-btn ghost" type="button" data-g33="ask">💬 Ask MLS a question</button>' +
          '<span class="sp"></span>' +
        '</div>' +
      '</div>';
    (document.body || document.documentElement).appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      var t = e.target;
      if (t === wrap) { closeGuide(); return; }                 // click-outside
      var act = t.getAttribute && t.getAttribute('data-g33');
      if (act === 'close') { closeGuide(); }
      else if (act === 'ask') { openAsk(); }
    });
  }

  function openGuide() { buildModal(); var m = document.getElementById(MODAL_ID); if (m) m.classList.add('open'); }
  function closeGuide() { var m = document.getElementById(MODAL_ID); if (m) m.classList.remove('open'); }
  function openAsk() {
    closeGuide();
    var f = window.__mlsG33_origHelp;
    if (typeof f === 'function') { try { f(); } catch (e) {} }
  }
  window.__mlsHowToB33_open = openGuide;

  // Esc closes
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      var m = document.getElementById(MODAL_ID);
      if (m && m.classList.contains('open')) closeGuide();
    }
  });

  /* ---- 3. make the guide the SINGLE Help/How-to path -------------------- */
  function rerouteHelp() {
    // Preserve the real AI "ask anything" opener exactly once.
    if (!window.__mlsG33_origHelp && typeof window.openMlsHelp === 'function') {
      window.__mlsG33_origHelp = window.openMlsHelp;
    }
    // Point the top-bar ❓ Help (nav_help onclick -> openMlsHelp()) at the guide.
    if (window.openMlsHelp !== openGuide) window.openMlsHelp = openGuide;
  }

  /* ---- 4. reversibly retire the DUPLICATE / stale how-to guides --------- */
  function hideStaleHowto() {
    if (document.getElementById(STALE_ID)) return;
    var s = document.createElement('style');
    s.id = STALE_ID;
    s.textContent = '#visitView .howto{display:none !important;}';
    (document.head || document.documentElement).appendChild(s);
  }

  function neutraliseSetupGuide() {
    var step = document.getElementById('su_step5');
    if (!step) return;
    var cards = step.querySelectorAll('.su_guide');
    if (!cards.length) return;
    cards.forEach(function (c) { if (!c.classList.contains(SU_HIDE)) c.classList.add(SU_HIDE); });
    if (!document.getElementById(SU_BTN)) {
      var host = cards[0].parentElement || step;
      var b = document.createElement('button');
      b.id = SU_BTN; b.type = 'button';
      b.innerHTML = '📖 Open the full how-to guide';
      b.addEventListener('click', function (ev) { ev.preventDefault(); openGuide(); });
      host.insertBefore(b, cards[0]);
    }
  }

  /* ---- 5. keep it applied (idempotent) --------------------------------- */
  function apply() {
    try { rerouteHelp(); } catch (e) {}
    try { hideStaleHowto(); } catch (e) {}
    try { neutraliseSetupGuide(); } catch (e) {}
  }
  apply();
  var iv = setInterval(apply, 1500);
  var mo = null;
  try {
    mo = new MutationObserver(function () { apply(); });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}

  /* ---- 6. full, clean revert ------------------------------------------- */
  window.__mlsHowToB33_revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { if (mo) mo.disconnect(); } catch (e) {}
    // restore Help behaviour
    if (window.__mlsG33_origHelp) { window.openMlsHelp = window.__mlsG33_origHelp; }
    // un-hide stale strip
    var st = document.getElementById(STALE_ID); if (st) st.remove();
    // restore setup guide cards + remove injected btn
    document.querySelectorAll('.' + SU_HIDE).forEach(function (c) { c.classList.remove(SU_HIDE); });
    var b = document.getElementById(SU_BTN); if (b) b.remove();
    // remove guide modal + css
    var m = document.getElementById(MODAL_ID); if (m) m.remove();
    var css = document.getElementById(CSS_ID); if (css) css.remove();
    window.__mlsHowToB33 = 0;
    return 'reverted __mlsHowToB33';
  };
})();


/* __mlsEasyMagicB30 — MLS Easy guided-flow polish (queue item 3)
 * - Restyles the Step 1-4 bar (#mls-rt-bar) into a sticky, modern stepper.
 * - Step-driven focus: the card that matters for the current step gets a blue
 *   focus ring; the others dim gently (hover restores them — nothing is hidden
 *   or disabled, purely visual guidance).
 * - Surfaces the buried "Send full visit to Athena" (#pushAllEmrBtn) as a clear
 *   CTA in the stepper bar; clicking it triggers the real button (user-initiated
 *   only) and scrolls the note card into view.
 * - Mobile responsive (@media max-width:640px). Fully reversible:
 *   window.__mlsEasyMagicB30_revert()
 */
(function(){
  if(window.__mlsEasyMagicB30) return; window.__mlsEasyMagicB30 = 1;
  var CLS = 'mlsB30';
  var state = { obs:null, ctaBtn:null, styleEl:null, lastStep:0 };

  var CSS = [
  '#mls-rt-bar.'+CLS+'-bar{position:sticky;top:0;z-index:60;display:flex;align-items:center;gap:14px;flex-wrap:wrap;',
  '  padding:10px 16px;border-radius:14px;margin-bottom:14px;',
  '  background:linear-gradient(90deg,rgba(30,48,110,.95),rgba(43,66,145,.95)) !important;',
  '  box-shadow:0 6px 18px rgba(10,20,60,.35) !important;backdrop-filter:blur(6px);border:1px solid rgba(120,150,255,.25) !important;}',
  '#mls-rt-bar.'+CLS+'-bar .mls-rt-pill{cursor:pointer;border-radius:999px;padding:5px 13px;font-weight:600;font-size:12.5px;',
  '  background:rgba(255,255,255,.08);color:#c8d5f7;border:1px solid rgba(160,185,255,.25);transition:all .25s ease;}',
  '#mls-rt-bar.'+CLS+'-bar .mls-rt-pill:hover{background:rgba(255,255,255,.16);color:#fff;}',
  '#mls-rt-bar.'+CLS+'-bar .mls-rt-pill.'+CLS+'-active{background:linear-gradient(90deg,#4f7df9,#6a5cf0);color:#fff;',
  '  border-color:transparent;box-shadow:0 2px 10px rgba(80,120,250,.55);transform:scale(1.06);}',
  '#mls-rt-bar.'+CLS+'-bar .mls-rt-pill.'+CLS+'-done{background:rgba(70,200,140,.18);color:#8fe6bd;border-color:rgba(70,200,140,.35);}',
  '#mls-rt-bar.'+CLS+'-bar #mls-rt-hint{font-size:13.5px;font-weight:600;color:#e8eeff !important;letter-spacing:.1px;}',
  '.vx-grid .card.'+CLS+'-focus{box-shadow:0 0 0 2px rgba(90,130,250,.85),0 10px 28px rgba(40,70,180,.35)!important;',
  '  transition:box-shadow .35s ease,opacity .35s ease;}',
  '.vx-grid .card.'+CLS+'-dim{opacity:.55;transition:opacity .35s ease;}',
  '.vx-grid .card.'+CLS+'-dim:hover,.vx-grid .card.'+CLS+'-dim:focus-within{opacity:1;}',
  '.'+CLS+'-send{margin-left:auto;display:inline-flex;align-items:center;gap:8px;cursor:pointer;border:0;border-radius:12px;',
  '  padding:9px 16px;font-weight:700;font-size:13px;color:#fff;',
  '  background:linear-gradient(90deg,#12b06a,#0e9d8f);box-shadow:0 3px 12px rgba(16,170,120,.45);transition:all .25s ease;}',
  '.'+CLS+'-send:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(16,170,120,.6);}',
  '.'+CLS+'-send small{display:block;font-weight:500;font-size:10px;opacity:.85;}',
  '@keyframes '+CLS+'Pulse{0%{box-shadow:0 0 0 0 rgba(18,176,106,.7)}70%{box-shadow:0 0 0 14px rgba(18,176,106,0)}100%{box-shadow:0 0 0 0 rgba(18,176,106,0)}}',
  '.'+CLS+'-pulse{animation:'+CLS+'Pulse 1.2s ease 2;}',
  '@media (max-width:640px){',
  '  #mls-rt-bar.'+CLS+'-bar{position:static;gap:8px;padding:10px;}',
  '  #mls-rt-bar.'+CLS+'-bar #mls-rt-hint{font-size:12px;flex-basis:100%;}',
  '  .'+CLS+'-send{margin-left:0;width:100%;justify-content:center;}',
  '  .vx-grid .card.'+CLS+'-dim{opacity:.75;}',
  '}'
  ].join('\n');

  function $(s){ return document.querySelector(s); }

  function stepFromHint(){
    var h = $('#mls-rt-hint'); if(!h) return 0;
    var m = /Step\s+(\d)\s+of\s+4/i.exec(h.textContent||'');
    return m ? +m[1] : 0;
  }

  function applyStep(){
    var bar = $('#mls-rt-bar'); if(!bar) return;
    bar.classList.add(CLS+'-bar');
    var step = stepFromHint(); state.lastStep = step;
    var pills = bar.querySelectorAll('.mls-rt-pill');
    for(var i=0;i<pills.length;i++){
      pills[i].classList.toggle(CLS+'-active', i===step-1);
      pills[i].classList.toggle(CLS+'-done', step>0 && i<step-1);
    }
    var cap=$('#captureCard'), note=$('#noteCard'), emr=$('#emrCard');
    var focus = (step>=3) ? note : cap;
    [cap,note,emr].forEach(function(c){
      if(!c) return;
      c.classList.toggle(CLS+'-focus', step>0 && c===focus);
      c.classList.toggle(CLS+'-dim',   step>0 && c!==focus);
    });
  }

  function makeCta(){
    var bar = $('#mls-rt-bar'), real = $('#pushAllEmrBtn');
    if(!bar || !real || state.ctaBtn) return;
    var b = document.createElement('button');
    b.className = CLS+'-send';
    b.type = 'button';
    b.title = 'Writes the full finished visit note into athenaOne. Nothing is sent until you click this.';
    b.innerHTML = '🚀 Send full visit to Athena';
    b.addEventListener('click', function(){
      var r = $('#pushAllEmrBtn');
      if(!r){ b.textContent = 'Open a visit note first'; setTimeout(function(){ b.innerHTML='🚀 Send full visit to Athena'; },1800); return; }
      var noteCard = $('#noteCard');
      if(noteCard) noteCard.scrollIntoView({behavior:'smooth', block:'center'});
      r.classList.add(CLS+'-pulse');
      setTimeout(function(){ r.classList.remove(CLS+'-pulse'); }, 2600);
      r.click();
    });
    bar.appendChild(b);
    state.ctaBtn = b;
  }

  function boot(){
    var bar = $('#mls-rt-bar');
    if(!bar){ setTimeout(boot, 1500); return; }
    if(!state.styleEl){
      state.styleEl = document.createElement('style');
      state.styleEl.id = CLS+'-style';
      state.styleEl.textContent = CSS;
      document.head.appendChild(state.styleEl);
    }
    applyStep(); makeCta();
    var hint = $('#mls-rt-hint');
    if(hint && !state.obs){
      state.obs = new MutationObserver(function(){ applyStep(); makeCta(); });
      state.obs.observe(hint, {childList:true, characterData:true, subtree:true});
    }
    if(!state.reObs){
      state.reObs = new MutationObserver(function(){
        if(!document.getElementById(CLS+'-style') && state.styleEl) document.head.appendChild(state.styleEl);
        if(state.ctaBtn && !state.ctaBtn.isConnected) state.ctaBtn = null;
        applyStep(); makeCta();
      });
      var vv = $('#visitView');
      if(vv) state.reObs.observe(vv, {childList:true, subtree:false});
    }
  }

  window.__mlsEasyMagicB30_revert = function(){
    try{
      if(state.obs) state.obs.disconnect();
      if(state.reObs) state.reObs.disconnect();
      if(state.styleEl && state.styleEl.parentNode) state.styleEl.parentNode.removeChild(state.styleEl);
      if(state.ctaBtn && state.ctaBtn.parentNode) state.ctaBtn.parentNode.removeChild(state.ctaBtn);
      var bar=$('#mls-rt-bar'); if(bar) bar.classList.remove(CLS+'-bar');
      ['#captureCard','#noteCard','#emrCard'].forEach(function(s){
        var c=$(s); if(c){ c.classList.remove(CLS+'-focus'); c.classList.remove(CLS+'-dim'); }
      });
      var pills=document.querySelectorAll('.mls-rt-pill');
      for(var i=0;i<pills.length;i++){ pills[i].classList.remove(CLS+'-active'); pills[i].classList.remove(CLS+'-done'); }
      window.__mlsEasyMagicB30 = 0;
    }catch(e){}
  };

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

/* ===== MLS EMR-sections clarity b28 (additive, guarded, reversible) =====
   Prepended to scrivara-site/mls-connect.js (b28). Builds on b27's __mlsUiCleanupB26 (the
   "⚙ Writeback destination" gear inside #emrPanel) — does NOT touch it.

   Problem (KNOWN_BUGS #4): the "EMR sections – review & confirm" modal (#emrPanel) shows nine/ten
   identical "(nothing captured for X)" boxes with a bare "confirm" checkbox each, and a one-line
   hint. It's unclear what the modal is FOR, what "confirm" / "Confirm all" / "Insert confirmed" do,
   how the ⚙ Writeback destination relates, and what the user should do next.

   This module (UI-only, no functional/ID changes):
   1. Flow stepper — a plain numbered header explaining the journey:
      1 Record/generate → 2 MLS auto-sorts → 3 Review & edit → 4 Confirm approved → 5 Insert to athenaOne,
      with a one-line note that confirmed sections write to athenaOne at the ⚙ Writeback destination.
   2. Better empty state — when nothing is captured, hide the ten identical empty boxes and show one
      clear call-to-action (+ an "or type sections manually" reveal). When content exists, show the
      populated sections and COLLAPSE the empty ones (with a "show empty sections" toggle).
   3. Clarify controls — hover tooltips on AI sort / Confirm all / Insert confirmed / Close / the gear
      and every per-section "confirm" checkbox, explaining exactly what each does.
   4. Tidy spacing, dark-modal-friendly blue accents consistent with the app.

   Existing IDs/behaviour untouched: #emrAi #emrClose #emrAll #emrIns #emrBody #emrHint #emrCount,
   the .mlsWbGear, textareas and confirm checkboxes all keep working. Purely presentational overlay.

   Revert: window.__mlsEmrClarityB28_revert()
   ===== */
(function(){
  if(window.__mlsEmrClarityB28) return; window.__mlsEmrClarityB28=1;

  var STEPS=[
    ['1','Record or generate','Dictate or generate the visit note'],
    ['2','MLS auto-sorts','Content is split into the sections below'],
    ['3','Review &amp; edit','Check each section, fix anything'],
    ['4','Confirm approved','Tick “confirm” on the ones you approve'],
    ['5','Insert to athenaOne','“Insert confirmed” writes them in']
  ];

  function css(){
    if(document.getElementById('mlsEmrClarityB28Css')) return;
    var s=document.createElement('style'); s.id='mlsEmrClarityB28Css';
    s.textContent=[
      /* stepper */
      '#mlsEmrStepper{margin:2px 0 12px;padding:12px 14px;border:1px solid rgba(120,150,230,.35);',
      '  border-radius:12px;background:linear-gradient(180deg,rgba(59,111,224,.14),rgba(59,111,224,.06));}',
      '#mlsEmrStepRow{display:flex;flex-wrap:wrap;align-items:stretch;gap:6px;}',
      '.mlsEmrStep{display:flex;align-items:center;gap:8px;flex:1 1 120px;min-width:120px;',
      '  padding:7px 9px;border-radius:9px;background:rgba(120,150,230,.10);border:1px solid rgba(120,150,230,.22);}',
      '.mlsEmrStepN{flex:0 0 auto;width:20px;height:20px;border-radius:50%;display:flex;align-items:center;',
      '  justify-content:center;font-weight:800;font-size:12px;color:#fff;',
      '  background:linear-gradient(90deg,#3b6fe0,#5b8cff);}',
      '.mlsEmrStep>span:last-child{display:flex;flex-direction:column;min-width:0;}',
      '.mlsEmrStepT{display:block;font-weight:700;font-size:12.5px;color:#e8f0ff;line-height:1.15;}',
      '.mlsEmrStepS{display:block;font-weight:500;font-size:11px;color:rgba(205,221,255,.72);line-height:1.15;margin-top:1px;}',
      '.mlsEmrArrow{align-self:center;color:rgba(160,185,255,.65);font-weight:800;font-size:14px;flex:0 0 auto;}',
      '#mlsEmrStepNote{margin-top:9px;font-size:11.5px;color:rgba(205,221,255,.82);line-height:1.35;}',
      '#mlsEmrStepNote b{color:#cdddff;}',
      '@media (max-width:640px){.mlsEmrArrow{display:none;}.mlsEmrStep{flex:1 1 46%;}}',
      /* empty-state CTA */
      '#mlsEmrCta{display:none;margin:4px 0 6px;padding:20px 18px;border:1px dashed rgba(120,150,230,.45);',
      '  border-radius:12px;background:rgba(59,111,224,.06);text-align:center;}',
      '#mlsEmrCta h4{margin:0 0 6px;font-size:15px;color:#e8f0ff;font-weight:800;}',
      '#mlsEmrCta p{margin:0 auto;max-width:560px;font-size:12.5px;line-height:1.5;color:rgba(205,221,255,.85);}',
      '#mlsEmrCta .mlsEmrSecList{color:#cdddff;font-weight:600;}',
      '#mlsEmrCtaManual{margin-top:12px;display:inline-block;font-size:12px;font-weight:700;color:#cdddff;',
      '  padding:6px 12px;border-radius:8px;border:1px solid rgba(160,180,240,.5);',
      '  background:rgba(120,150,230,.18);cursor:pointer;}',
      '#mlsEmrCtaManual:hover{background:rgba(120,150,230,.30);}',
      /* section tidy + empty collapse */
      '#emrBody .mlsEmrSec{transition:opacity .15s ease;}',
      '#emrBody .mlsEmrSec.mlsEmrSecEmpty textarea{display:none !important;}',
      '#emrBody .mlsEmrSec.mlsEmrSecEmpty{opacity:.5;}',
      '#emrBody .mlsEmrSec.mlsEmrSecEmpty::after{content:"empty — nothing captured yet";',
      '  display:block;font-size:11px;color:rgba(205,221,255,.6);font-style:italic;margin-top:-2px;}',
      '.mlsEmrRevealEmpty #emrBody .mlsEmrSec.mlsEmrSecEmpty textarea{display:block !important;}',
      '.mlsEmrRevealEmpty #emrBody .mlsEmrSec.mlsEmrSecEmpty{opacity:1;}',
      '.mlsEmrRevealEmpty #emrBody .mlsEmrSec.mlsEmrSecEmpty::after{display:none;}',
      /* the old one-line hint ("No sections detected yet…") is replaced by the stepper + CTA */
      '#emrPanel #emrHint{display:none !important;}',
      /* empty-state: hide the ten identical boxes, show the single CTA */
      '.mlsEmrState-empty:not(.mlsEmrRevealEmpty) #emrBody{display:none !important;}',
      '.mlsEmrState-empty:not(.mlsEmrRevealEmpty) #mlsEmrCta{display:block !important;}',
      /* reveal toggle bar */
      '#mlsEmrRevealBar{display:none;margin:8px 0 2px;text-align:center;}',
      '#mlsEmrRevealBar button{font:inherit;font-size:12px;font-weight:700;color:#cdddff;cursor:pointer;',
      '  padding:5px 12px;border-radius:8px;border:1px solid rgba(160,180,240,.4);background:rgba(120,150,230,.12);}',
      '#mlsEmrRevealBar button:hover{background:rgba(120,150,230,.24);}',
      '.mlsEmrState-has.mlsEmrHasEmpties #mlsEmrRevealBar{display:block;}'
    ].join('\n');
    (document.head||document.documentElement).appendChild(s);
  }

  function stepper(card){
    if(card.querySelector('#mlsEmrStepper')) return;
    var head=card.children[0]; if(!head) return;
    var box=document.createElement('div'); box.id='mlsEmrStepper';
    var row='<div id="mlsEmrStepRow">';
    for(var i=0;i<STEPS.length;i++){
      var st=STEPS[i];
      row+='<div class="mlsEmrStep"><span class="mlsEmrStepN">'+st[0]+'</span>'
         +'<span><span class="mlsEmrStepT">'+st[1]+'</span>'
         +'<span class="mlsEmrStepS">'+st[2]+'</span></span></div>';
      if(i<STEPS.length-1) row+='<span class="mlsEmrArrow">›</span>';
    }
    row+='</div>';
    row+='<div id="mlsEmrStepNote">Confirmed sections are written into <b>athenaOne</b> at the '
       +'destinations set under <b>⚙ Writeback destination</b> (top of this window). '
       +'Nothing is sent until you tick <b>confirm</b> and press <b>Insert confirmed</b>.</div>';
    box.innerHTML=row;
    if(head.nextSibling) card.insertBefore(box, head.nextSibling); else card.appendChild(box);
  }

  function cta(card){
    if(card.querySelector('#mlsEmrCta')) return;
    var hint=card.querySelector('#emrHint'); if(!hint) return;
    var c=document.createElement('div'); c.id='mlsEmrCta';
    c.innerHTML='<h4>Nothing captured yet</h4>'
      +'<p>Record or generate a note first. MLS automatically sorts the content into these sections: '
      +'<span class="mlsEmrSecList">History, Physical exam, Assessment, Plan, Orders, Prescriptions, '
      +'Referrals, PT orders, Imaging orders</span>. Then review each one, tick <b>confirm</b> on the '
      +'sections you approve, and <b>Insert confirmed</b> writes them into athenaOne.</p>'
      +'<span id="mlsEmrCtaManual" role="button" tabindex="0">Or type sections manually</span>';
    hint.parentNode.insertBefore(c, hint.nextSibling);
    var m=c.querySelector('#mlsEmrCtaManual');
    if(m) m.addEventListener('click',function(){ card.classList.add('mlsEmrRevealEmpty'); });
  }

  function revealBar(card){
    if(card.querySelector('#mlsEmrRevealBar')) return;
    var body=card.querySelector('#emrBody'); if(!body) return;
    var bar=document.createElement('div'); bar.id='mlsEmrRevealBar';
    var btn=document.createElement('button'); btn.type='button'; btn.textContent='Show empty sections';
    btn.addEventListener('click',function(){
      var on=card.classList.toggle('mlsEmrRevealEmpty');
      btn.textContent=on?'Hide empty sections':'Show empty sections';
    });
    bar.appendChild(btn);
    if(body.nextSibling) card.insertBefore(bar, body.nextSibling); else card.appendChild(bar);
  }

  function tagSections(body){
    var kids=body.children, empties=0, total=0;
    for(var i=0;i<kids.length;i++){
      var sec=kids[i]; if(sec.id==='mlsEmrRevealBar') continue;
      var ta=sec.querySelector&&sec.querySelector('textarea'); if(!ta) continue;
      total++;
      sec.classList.add('mlsEmrSec');
      var empty=!(ta.value&&ta.value.trim().length);
      if(empty){ sec.classList.add('mlsEmrSecEmpty'); empties++; }
      else sec.classList.remove('mlsEmrSecEmpty');
    }
    return {empties:empties,total:total};
  }

  var TIPS={
    emrAi:'Automatically sort the recorded/generated note into the sections below.',
    emrClose:'Close this window. Nothing is written to athenaOne.',
    emrAll:'Tick every section’s “confirm” box at once. Review the content first.',
    emrIns:'Write the confirmed sections into athenaOne at your ⚙ Writeback destinations. This is the only step that writes.'
  };
  function tooltips(card){
    Object.keys(TIPS).forEach(function(id){ var e=document.getElementById(id); if(e&&!e.title) e.title=TIPS[id]; });
    var gear=card.querySelector('.mlsWbGear'); if(gear&&!gear.title) gear.title='Set where each section writes into athenaOne (tab, section, template).';
    var boxes=card.querySelectorAll('#emrBody input[type=checkbox]');
    for(var i=0;i<boxes.length;i++){ var lab=boxes[i].closest('label')||boxes[i]; if(!lab.title) lab.title='Approve this section to be included when you press “Insert confirmed”.'; }
  }

  function state(card){
    var body=card.querySelector('#emrBody'); if(!body) return;
    var r=tagSections(body);
    if(r.total>0 && r.empties===r.total){ card.classList.add('mlsEmrState-empty'); card.classList.remove('mlsEmrState-has'); }
    else { card.classList.add('mlsEmrState-has'); card.classList.remove('mlsEmrState-empty'); }
    if(r.empties>0) card.classList.add('mlsEmrHasEmpties'); else card.classList.remove('mlsEmrHasEmpties');
  }

  function tick(){
    try{
      var p=document.getElementById('emrPanel'); if(!p) return;
      var card=p.children[0]; if(!card) return;
      css(); stepper(card); cta(card); revealBar(card); tooltips(card); state(card);
    }catch(e){}
  }
  tick();
  var iv=setInterval(tick,800);
  var mo; try{ mo=new MutationObserver(function(){ tick(); }); mo.observe(document.body,{childList:true,subtree:true}); }catch(e){}

  window.__mlsEmrClarityB28_revert=function(){
    try{clearInterval(iv);}catch(e){}
    try{mo&&mo.disconnect();}catch(e){}
    var s=document.getElementById('mlsEmrClarityB28Css'); if(s)s.remove();
    ['mlsEmrStepper','mlsEmrCta','mlsEmrRevealBar'].forEach(function(id){ var e=document.getElementById(id); if(e)e.remove(); });
    var p=document.getElementById('emrPanel'), card=p&&p.children[0];
    if(card){ card.classList.remove('mlsEmrState-empty','mlsEmrState-has','mlsEmrHasEmpties','mlsEmrRevealEmpty');
      var secs=card.querySelectorAll('.mlsEmrSec'); for(var i=0;i<secs.length;i++) secs[i].classList.remove('mlsEmrSec','mlsEmrSecEmpty'); }
    window.__mlsEmrClarityB28=0;
  };
})();


/* ===== MLS UI cleanup b26 (additive, guarded, reversible) =====
   Fix 1: consolidate Writeback-destination into EMR sections (gear), hide the duplicate standalone button.
   Fix 2: remove duplicate top-right athenaOne-connected dot; tidy the overlapping bottom-right control cluster.
   Fix 3: save-as-you-type in the Writeback-destination fields (fields already editable w/ correct per-doctor defaults).
   Revert: window.__mlsUiCleanupB26_revert()  ===== */
(function(){
  if(window.__mlsUiCleanupB26) return; window.__mlsUiCleanupB26=1;
  function css(){
    if(document.getElementById('mlsUiCleanupB26Css')) return;
    var s=document.createElement('style'); s.id='mlsUiCleanupB26Css';
    s.textContent=[
      '.mlswbc-launch{display:none !important;}',
      '#mlsAthenaStatusDot{display:none !important;}',
      '#mlsP1AgFab{right:16px !important;bottom:16px !important;left:auto !important;top:auto !important;}',
      '#mlsAddPtLauncher{right:16px !important;bottom:70px !important;left:auto !important;top:auto !important;}',
      '#mlsVoiceFab{right:16px !important;bottom:124px !important;left:auto !important;top:auto !important;}',
      '#mlsScDock{right:16px !important;bottom:182px !important;left:auto !important;top:auto !important;}'
    ].join('\n');
    (document.head||document.documentElement).appendChild(s);
  }
  function injectGear(){
    var panel=document.getElementById('emrPanel'); if(!panel) return;
    var ai=document.getElementById('emrAi'); if(!ai||!ai.parentNode) return;
    if(panel.querySelector('.mlsWbGear')) return;
    var g=document.createElement('button');
    g.type='button'; g.className='mlsWbGear';
    g.textContent='\u2699 Writeback destination';
    g.title='Configure where each section writes into athenaOne';
    g.style.cssText='margin-right:8px;font:inherit;font-weight:700;padding:6px 12px;border-radius:8px;border:1px solid rgba(160,180,240,.5);background:rgba(120,150,230,.18);color:#cdddff;cursor:pointer;';
    g.addEventListener('click',function(ev){ ev.preventDefault(); ev.stopPropagation(); try{ window.__mlsWbConsole && window.__mlsWbConsole.open(); }catch(e){} });
    ai.parentNode.insertBefore(g, ai);
  }
  function layout(){
    [['mlsP1AgFab',16],['mlsAddPtLauncher',70],['mlsVoiceFab',124],['mlsScDock',182]].forEach(function(p){
      var el=document.getElementById(p[0]); if(!el) return;
      try{ el.style.setProperty('right','16px','important'); el.style.setProperty('bottom',p[1]+'px','important'); el.style.setProperty('left','auto','important'); el.style.setProperty('top','auto','important'); }catch(e){}
    });
    var dot=document.getElementById('mlsAthenaStatusDot'); if(dot){ try{ dot.style.setProperty('display','none','important'); }catch(e){} }
  }
  function wireSayt(){
    var modal=document.getElementById('mlsWbcModal'); if(!modal||modal.__mlsSayt) return; modal.__mlsSayt=1;
    var t=null;
    modal.addEventListener('input',function(ev){
      var el=ev.target; if(!el||el.tagName!=='INPUT'||el.type==='checkbox') return;
      clearTimeout(t); t=setTimeout(function(){ try{ el.dispatchEvent(new Event('change',{bubbles:true})); }catch(e){} },500);
    }, true);
  }
  function tick(){ try{ css(); injectGear(); layout(); wireSayt(); }catch(e){} }
  tick();
  var iv=setInterval(tick,800);
  var mo; try{ mo=new MutationObserver(function(){ injectGear(); wireSayt(); }); mo.observe(document.body,{childList:true}); }catch(e){}
  window.__mlsUiCleanupB26_revert=function(){ try{clearInterval(iv);}catch(e){} try{mo&&mo.disconnect();}catch(e){} var s=document.getElementById('mlsUiCleanupB26Css'); if(s)s.remove(); var gs=document.querySelectorAll('.mlsWbGear'); for(var i=0;i<gs.length;i++){gs[i].remove();} window.__mlsUiCleanupB26=0; };
})();

(function(){
  if(window.__mlsBootLoader) return; window.__mlsBootLoader=1;
  var STAGES=['Connecting to your practice\u2026','Loading your schedule\u2026','Preparing your workspace\u2026','Almost ready\u2026'];
  function styleEl(){ if(document.getElementById('mlsBLcss'))return; var st=document.createElement('style'); st.id='mlsBLcss'; st.textContent='#mlsBLwrap{width:260px;max-width:70vw;margin:16px auto 0}#mlsBLtrack{height:6px;border-radius:999px;background:rgba(120,150,215,.22);overflow:hidden}#mlsBLbar{height:100%;width:0%;border-radius:999px;background-image:linear-gradient(90deg,#3b6fe0,#5b8cff,#9db8ff,#5b8cff,#3b6fe0);background-size:220px 100%;transition:width .45s cubic-bezier(.4,0,.2,1);animation:mlsBLshm 1.15s linear infinite}#mlsBLbar.done{animation:none;background-image:linear-gradient(90deg,#3b6fe0,#5b8cff)}#mlsBLmsg{margin-top:11px;font-size:13px;color:#5b6b86;text-align:center;letter-spacing:.2px}@keyframes mlsBLshm{0%{background-position:-220px 0}100%{background-position:220px 0}}'; (document.head||document.documentElement).appendChild(st); }
  var timer=null, failsafe=null, hideT=null, prog=0, msgi=0;
  function ensureBar(g){ var w=g.querySelector('#mlsBLwrap'); if(!w){ w=document.createElement('div'); w.id='mlsBLwrap'; w.innerHTML='<div id=\"mlsBLtrack\"><div id=\"mlsBLbar\"></div></div><div id=\"mlsBLmsg\"></div>'; g.appendChild(w); } return w; }
  function start(){ styleEl(); var g=document.getElementById('sfGateLoading'); if(!g)return; ensureBar(g); var bar=g.querySelector('#mlsBLbar'), msg=g.querySelector('#mlsBLmsg'); clearTimeout(failsafe); failsafe=setTimeout(done,9000); if(timer&&prog>0){ if(bar)bar.classList.remove('done'); return; } prog=0; msgi=0; if(bar){bar.classList.remove('done');bar.style.width='0%';} if(msg)msg.textContent=STAGES[0]; clearInterval(timer); timer=setInterval(function(){ prog+=Math.max(0.6,(90-prog)*0.06); if(prog>90)prog=90; if(bar)bar.style.width=prog.toFixed(1)+'%'; var wm=Math.min(STAGES.length-1,Math.floor(prog/24)); if(wm!==msgi){msgi=wm; if(msg)msg.textContent=STAGES[msgi];} },160); }
  function done(){ clearTimeout(failsafe); clearInterval(timer); timer=null; var g=document.getElementById('sfGateLoading'); if(!g)return; var bar=g.querySelector('#mlsBLbar'), msg=g.querySelector('#mlsBLmsg'); if(bar){bar.classList.add('done'); bar.style.width='100%';} if(msg)msg.textContent='Ready'; }
  function schedHide(){ clearTimeout(hideT); hideT=setTimeout(function(){ var g=document.getElementById('sfGateLoading'); if(!g||getComputedStyle(g).display==='none'){ if(g)g.__on=false; done(); } },400); }
  function wrap(name,fn){ var o=window[name]; if(typeof o==='function'&&!o.__mlsW){ window[name]=function(){ try{fn();}catch(e){} return o.apply(this,arguments); }; window[name].__mlsW=true; } }
  var n=0, iv=setInterval(function(){ wrap('sfShowGateLoading',start); wrap('sfHideGateLoading',schedHide); var g=document.getElementById('sfGateLoading'); if(g&&!g.__mlsBLobs){ g.__mlsBLobs=true; try{ var mo=new MutationObserver(function(){ var vis=getComputedStyle(g).display!=='none'; if(vis){ clearTimeout(hideT); if(!g.__on){g.__on=true;start();} } else if(g.__on){ schedHide(); } }); mo.observe(g,{attributes:true,attributeFilter:['style','class']}); }catch(e){} if(getComputedStyle(g).display!=='none'){g.__on=true;start();} } if(++n>60)clearInterval(iv); },150);
})();

;(function(){try{var A="feat_task3_frontsync.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260705t3c";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* TASK3: calendar/day/week truth + provider scope + patient-selector/MLS-Easy sync + MLSStatus (additive, reversible: window.__mlsT3.revert(); delete this line + feat_task3_frontsync.js to fully remove) */

/* ============================================================================
 * __mlsT6Stab — Task 6: reload / flicker / layout-jump stabilizer (b19).
 * Root causes fixed (measured live 2026-07-05, BEFORE numbers):
 *   RC1  48 loader sites cache-busted with ?v='+Date.now() => 52 JS files
 *        re-downloaded EVERY page load; boot resource window 26.7s.
 *        FIX: busters pinned to window.__MLS_AV (bump per deploy).
 *   RC2  Boot veil (__mlsCalmBoot, feat_b18_qa.js) loads LAST of 164 scripts
 *        and caps at 3.2s while boot runs ~27s => "many configurations".
 *        FIX: this EARLY veil paints before any module churn, releases on
 *        loader+mutation quiet, hard cap 8s, failsafe 9.5s. Supersedes
 *        CalmBoot via __mlsCalmBootDone=1 (their module then no-ops).
 *   RC3  Idempotent UI appliers re-run on ~50 phase-staggered intervals, so
 *        a view reconfigures in bursts 0-3.75s AFTER it opens (measured:
 *        patients view mutation bursts at 0/1.0/2.0/3.0/3.75s) => flicker,
 *        buttons move, missed clicks.
 *        FIX: setInterval wrapper + one synchronous "pulse" of all short-
 *        period ticks the moment a top-level view's visibility flips.
 *   RC4  Duplicate/racing GETs (/api/appointments x3 same URL at boot;
 *        mic/calls polls every 2-3s) => loading states fight, re-renders.
 *        FIX: in-flight coalescing + 1500ms micro-TTL for hot GET polls.
 *   Also: transition/animation freeze while veiled; DOM-applier ticks skip
 *   work while tab hidden (network pollers exempt); 3rd+ duplicate
 *   registration of an identical (source,delay) interval is blocked.
 * Additive + reversible: window.__mlsT6Stab.revert() undoes wrappers/pulse.
 * READ-ONLY wrt Athena/patients: touches only timing, caching, veil DOM.
 * ==========================================================================*/
(function(){
  "use strict";
  if(window.__mlsT6Stab) return;
  var ST=window.__mlsT6Stab={v:'b19',dupesBlocked:0,pulses:0,fetch:{coalesced:0,ttlHits:0,pass:0},veilMs:0,reverted:false};

  /* ---- shared asset version (RC1) — bump alongside MLS_APP_BUILD ---- */
  window.__MLS_AV = window.__MLS_AV || 'b41';

  /* ================= RC2: EARLY BOOT VEIL ================= */
  try{
    window.__mlsCalmBootDone=1; /* supersede the late b18 veil cleanly */
    if(!document.getElementById('mlsBootVeil') && !document.hidden){
      var frz=document.createElement('style'); frz.id='mlsBootFreeze';
      frz.textContent='html.mls-booting *{transition-duration:0s!important;animation-duration:0s!important}#mlsBootBar{width:100%!important;transform-origin:0 50%;transform:scaleX(.08);animation:mlsBootProg 7s cubic-bezier(.25,.6,.35,1) forwards!important;animation-duration:7s!important}#mlsBootVeil{animation:mlsBootGone .5s ease 10s forwards!important;animation-duration:.5s!important}@keyframes mlsBootProg{0%{transform:scaleX(.08)}30%{transform:scaleX(.52)}65%{transform:scaleX(.74)}100%{transform:scaleX(.93)}}@keyframes mlsBootGone{to{opacity:0;visibility:hidden}}';
      (document.head||document.documentElement).appendChild(frz);
      document.documentElement.classList.add('mls-booting');
      var veil=document.createElement('div'); veil.id='mlsBootVeil';
      veil.style.cssText='position:fixed;inset:0;z-index:2147483602;background:linear-gradient(180deg,#0d1b33,#13264a);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;transition:opacity .22s ease';
      veil.innerHTML='<div style="display:flex;align-items:center;gap:10px"><span style="width:34px;height:34px;border-radius:10px;background:#2f6bed;display:inline-flex;align-items:center;justify-content:center;color:#fff;font:800 17px system-ui">M</span><span style="font:800 20px system-ui;color:#eaf1ff">MLS <span style="font-weight:500;color:#9fb4dd">Scribe</span></span></div>'+
        '<div style="width:150px;height:4px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden"><div id="mlsBootBar" style="width:8%;height:100%;border-radius:99px;background:#5b8cff"></div></div>'+
        '<div style="font:500 12px system-ui;color:#8ea6d4">Preparing your workspace…</div>';
      (document.body||document.documentElement).appendChild(veil);
      var t0=Date.now(), released=false, muts=0, lastMuts=0, loaded=0, lastLoadAt=Date.now();
      /* count our injected asset scripts finishing (load OR error) */
      var onRes=function(e){ try{ var t=e.target; if(t&&t.tagName==='SCRIPT'&&t.getAttribute&&t.getAttribute('data-mls-asset')){ loaded++; lastLoadAt=Date.now(); } }catch(_){}};
      window.addEventListener('load',onRes,true); window.addEventListener('error',onRes,true);
      var mo=new MutationObserver(function(ms){ muts+=ms.length; });
      try{ mo.observe(document.documentElement,{childList:true,subtree:true,attributes:true}); }catch(_){}
      var bar=veil.querySelector('#mlsBootBar');
      var release=function(){
        if(released) return; released=true;
        ST.veilMs=Date.now()-t0;
        try{ clearInterval(iv); }catch(_){ }
        try{ mo.disconnect(); }catch(_){ }
        window.removeEventListener('load',onRes,true); window.removeEventListener('error',onRes,true);
        document.documentElement.classList.remove('mls-booting');
        try{ pulseAll('boot-settle'); }catch(_){ }
        if(bar){ try{ bar.style.setProperty('animation','none','important'); bar.style.transform='scaleX(1)'; }catch(_){ } bar.style.width='100%'; }
        setTimeout(function(){ veil.style.opacity='0'; setTimeout(function(){ try{ veil.remove(); frz.remove(); }catch(_){ } },260); },70);
      };
      var iv=setInterval(function(){
        try{
          var dt=Date.now()-t0;
          var total=document.querySelectorAll('script[data-mls-asset]').length;
          /* bar visual now CSS-driven (compositor) so it moves even if JS stalls */
          var delta=muts-lastMuts; lastMuts=muts;
          var loaderQuiet=(total>0 && loaded>=total-2) || (Date.now()-lastLoadAt>1200);
          var login=false; try{ var lv=document.getElementById('loginView'); login=!!(lv&&lv.offsetParent!==null); }catch(_){ }
          if(login && dt>=500) return release();
          if(dt>=600 && loaderQuiet && delta<40) return release();
          if(dt>=8000) return release();
        }catch(_){ release(); }
      },200);
      setTimeout(release,8200); /* hard cap */
      setTimeout(function(){ try{ var v=document.getElementById('mlsBootVeil'); if(v) v.remove(); document.documentElement.classList.remove('mls-booting'); }catch(_){ } },9500); /* absolute failsafe */
    }
  }catch(e){ try{ document.documentElement.classList.remove('mls-booting'); var v0=document.getElementById('mlsBootVeil'); if(v0) v0.remove(); }catch(_){ } }

  /* ================= RC3: TICK REGISTRY + VIEW PULSE ================= */
  var VIEWS=['intakeView','patientsView','visitView','historyView','recsView','ordersView','adminView','teamView','calendarView','analysisView','legalReqView','studioView','settingsModal','viewModal'];
  var reg=[], seen={}, idKey={}, origSetInterval=window.setInterval, origClearInterval=window.clearInterval;
  var wrapped=function(fn,delay){
    var args=Array.prototype.slice.call(arguments,2);
    if(typeof fn==='function' && delay>=200 && delay<=3500 && reg.length<500){
      var key=null, src='';
      try{ src=String(fn); if(src.indexOf('[native code]')===-1) key=src.slice(0,400)+'|'+delay; }catch(_){ key=null; }
      if(key){
        seen[key]=(seen[key]||0)+1;
        if(seen[key]>2){ /* 3rd+ concurrently-active identical (source,delay): inert */
          ST.dupesBlocked++; seen[key]--;
          return origSetInterval.call(window,function(){},2147000000);
        }
      }
      var isNet=/fetch\(|XMLHttpRequest|\.ajax\(|navigator\.sendBeacon/.test(src);
      var run=function(){
        if(ST.reverted) return fn.apply(this,arguments);
        if(document.hidden && !isNet && delay<10000) return; /* skip pure-DOM work while hidden */
        return fn.apply(this,arguments);
      };
      reg.push({f:fn,net:isNet});
      var id=origSetInterval.apply(window,[run,delay].concat(args));
      if(key) idKey[id]=key;
      return id;
    }
    return origSetInterval.apply(window,arguments);
  };
  var wrappedClear=function(id){
    try{ if(id!=null && idKey[id]){ if(seen[idKey[id]]>0) seen[idKey[id]]--; delete idKey[id]; } }catch(_){ }
    return origClearInterval.apply(window,arguments);
  };
  try{ window.setInterval=wrapped; window.clearInterval=wrappedClear; }catch(_){ }

  var lastSig='', lastPulse=0;
  function viewSig(){
    var s='';
    for(var i=0;i<VIEWS.length;i++){ var el=document.getElementById(VIEWS[i]); s+=(el&&el.offsetParent!==null)?'1':'0'; }
    return s;
  }
  function pulseAll(why){
    var now=Date.now(); if(now-lastPulse<700) return; lastPulse=now;
    ST.pulses++;
    for(var i=0;i<reg.length;i++){ if(!reg[i].net){ try{ reg[i].f(); }catch(_){ } } }
  }
  var pending=false;
  function onMaybeFlip(){
    if(pending||ST.reverted) return; pending=true;
    (window.requestAnimationFrame||setTimeout)(function(){
      pending=false;
      try{ var s=viewSig(); if(s!==lastSig){ lastSig=s; pulseAll('view-flip'); } }catch(_){ }
    });
  }
  try{
    var vmo=new MutationObserver(onMaybeFlip);
    vmo.observe(document.documentElement,{attributes:true,attributeFilter:['class','style'],subtree:true,childList:true});
    document.addEventListener('click',onMaybeFlip,true);
    ST._vmo=vmo;
  }catch(_){ }

  /* ================= RC4: FETCH COALESCER (hot GET polls) ================= */
  var HOT=/\/api\/(appointments|connect\/status|providers|intake\/pending|calls\/active|mic\/)/;
  var TTL=1500, inflight={}, ttlCache={}, origFetch=window.fetch;
  try{
    window.fetch=function(input,init){
      try{
        if(ST.reverted) return origFetch.apply(window,arguments);
        var url=(typeof input==='string')?input:(input&&input.url)||'';
        var method=((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
        if(method!=='GET'||!HOT.test(url)) { ST.fetch.pass++; return origFetch.apply(window,arguments); }
        var auth=''; try{ var h=(init&&init.headers)||{}; auth=(h.Authorization||h.authorization||(typeof h.get==='function'&&h.get('Authorization'))||''); }catch(_){ }
        var key=url+'|'+auth;
        var c=ttlCache[key];
        if(c && (Date.now()-c.t)<TTL){ ST.fetch.ttlHits++; return c.p.then(function(r){ return r.clone(); }); }
        if(inflight[key]){ ST.fetch.coalesced++; return inflight[key].then(function(r){ return r.clone(); }); }
        /* master resolves to the ORIGINAL response; its body is never read —
           every consumer (including the first caller) gets a fresh clone. */
        var master=origFetch.apply(window,arguments).then(function(r){
          delete inflight[key];
          if(r && r.ok){ ttlCache[key]={t:Date.now(),p:master}; }
          return r;
        },function(err){ delete inflight[key]; throw err; });
        inflight[key]=master;
        return master.then(function(r){ return r.clone(); });
      }catch(_){ return origFetch.apply(window,arguments); }
    };
  }catch(_){ }

  /* housekeeping: drop stale TTL entries so the map never grows unbounded */
  origSetInterval.call(window,function(){ try{ var n=Date.now(); for(var k in ttlCache){ if(n-ttlCache[k].t>TTL*4) delete ttlCache[k]; } }catch(_){ } },15000);

  /* ================= revert ================= */
  ST.revert=function(){
    ST.reverted=true;
    try{ window.setInterval=origSetInterval; window.clearInterval=origClearInterval; }catch(_){ }
    try{ window.fetch=origFetch; }catch(_){ }
    try{ ST._vmo&&ST._vmo.disconnect(); }catch(_){ }
    try{ document.removeEventListener('click',onMaybeFlip,true); }catch(_){ }
    reg=[]; seen={}; idKey={}; inflight={}; ttlCache={};
    try{ var v=document.getElementById('mlsBootVeil'); if(v) v.remove(); document.documentElement.classList.remove('mls-booting'); }catch(_){ }
    return 'T6 stabilizer reverted';
  };
})();


(function(){
  if(window.__mlsCopilotInline) return; window.__mlsCopilotInline=1;
  function mount(){
    try{
      var card=document.getElementById('copilotCard');
      if(!card||card.offsetParent===null) return;
      var thread=document.getElementById('copilotThread');
      var inputRow=document.getElementById('copilotInputRow');
      var chips=document.getElementById('copilotChips');
      if(!thread||!inputRow) return;
      if(card.contains(thread)&&card.contains(inputRow)) return;
      var host=document.getElementById('mlsCopInlineHost');
      if(!host){ host=document.createElement('div'); host.id='mlsCopInlineHost'; host.style.cssText='margin-top:10px'; card.appendChild(host); }
      host.appendChild(thread);
      if(chips) host.appendChild(chips);
      host.appendChild(inputRow);
    }catch(e){}
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',mount); }
  mount(); setInterval(mount, 1500);
})();

(function(){
  if(window.__mlsCardPolish) return; window.__mlsCardPolish=1;
  var CSS=[
    "#visitView.mls-cohere .vx-grid > *{background:linear-gradient(180deg,#c2d4f4,#aec4ef)!important;border:1px solid rgba(110,140,215,.55)!important;box-shadow:0 10px 34px rgba(8,20,45,.40)!important;border-radius:16px!important;overflow:hidden}",
    "#visitView.mls-cohere .vx-grid > *::before{content:'';display:block;height:4px;margin:-1px -1px 0;background:linear-gradient(90deg,#3b6fe0,#5b8cff)}",
    "#visitView.mls-cohere #transcript,#visitView.mls-cohere textarea,#visitView.mls-cohere input[type=text]{background:#dbe6fb!important;border:1px solid rgba(110,140,215,.40)!important}"
  ].join("\n");
  function ins(){ if(document.getElementById('mlsCardPolishCss'))return; var st=document.createElement('style'); st.id='mlsCardPolishCss'; st.textContent=CSS; (document.head||document.documentElement).appendChild(st); }
  ins();
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',ins); }
  setInterval(ins, 3000);
})();

(function(){
  if(window.__mlsQpAll) return; window.__mlsQpAll=1;
  var CSS=[
    "#mlsQpAll{margin:12px 2px 4px;border-top:1px solid rgba(160,190,255,.18);padding-top:10px}",
    "#mlsQpAll .qpa-hd{font-weight:700;color:#eef4ff;font-size:13px;margin-bottom:2px;display:flex;align-items:center;gap:8px;justify-content:space-between}",
    "#mlsQpAll .qpa-sub{color:#9fb3d6;font-size:11px;margin-bottom:8px}",
    "#mlsQpAll .qpa-open{background:rgba(255,255,255,.10);color:#eef4ff;border:1px solid rgba(160,190,255,.34);border-radius:8px;padding:4px 10px;font-size:11px;font-weight:600;cursor:pointer}",
    "#mlsQpAll .qpa-list{display:flex;flex-direction:column;gap:6px;max-height:320px;overflow:auto}",
    "#mlsQpAll .qpa-row{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.05);border:1px solid rgba(160,190,255,.16);border-radius:10px;padding:7px 10px;cursor:pointer}",
    "#mlsQpAll .qpa-row:hover{background:rgba(255,255,255,.10)}",
    "#mlsQpAll .qpa-t{color:#bcd0f5;font-size:12px;font-weight:700;min-width:66px}",
    "#mlsQpAll .qpa-n{color:#fff;font-size:13px;font-weight:600;flex:1}",
    "#mlsQpAll .qpa-p{color:#9fb3d6;font-size:11px}",
    "#mlsQpAll .qpa-badge{font-size:10px;color:#cfe0ff;background:rgba(120,150,220,.22);border-radius:999px;padding:2px 7px}"
  ].join("\n");
  function ensureCss(){ if(document.getElementById('mlsQpAllCss'))return; var st=document.createElement('style');st.id='mlsQpAllCss';st.textContent=CSS;(document.head||document.documentElement).appendChild(st); }
  function selDate(){ var di=[].filter.call(document.querySelectorAll('input[type="date"]'),function(x){return x.offsetParent!==null;})[0]; return di?di.value:null; }
  function fmtTime(iso){ try{ return new Date(iso).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); }catch(e){ return ''; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function goCal(){ try{ var nav=document.getElementById('nav_calendar'); if(nav) nav.click(); }catch(e){} }
  function hideNativeEmpty(){ try{ var box=document.getElementById('mlsPtfBox'); if(!box) return; [].forEach.call(box.querySelectorAll('*'),function(e){ if(e.children.length===0 && /No patients on the Athena calendar for this day/i.test(e.textContent||'')){ e.style.display='none'; } }); }catch(e){} }
  function build(){
    try{
      var vv=document.getElementById('visitView'); if(!vv||vv.offsetParent===null) return;
      var host=document.getElementById('heroToday'); if(!host) return;
      var date=selDate(); if(!date) return;
      var appts=(window._calAppts||[]).filter(function(a){return (a.appt_date||'').slice(0,10)===date;});
      appts.sort(function(a,b){return String(a.start_at||'').localeCompare(String(b.start_at||''));});
      var panel=document.getElementById('mlsQpAll');
      if(!appts.length){ if(panel) panel.remove(); return; }
      hideNativeEmpty();
      var sig=date+'|'+appts.length;
      if(panel && panel.getAttribute('data-sig')===sig) return;
      if(!panel){ panel=document.createElement('div'); panel.id='mlsQpAll'; host.appendChild(panel); }
      panel.setAttribute('data-sig',sig); ensureCss();
      var rows=appts.map(function(a){
        var prov=a.provider?esc(String(a.provider).replace(/Close$/,'').replace(/_/g,' ')):'Unassigned';
        return '<div class="qpa-row"><span class="qpa-t">'+esc(fmtTime(a.start_at))+'</span><span class="qpa-n">'+esc(a.name||'(no name)')+'</span><span class="qpa-p">'+prov+'</span><span class="qpa-badge">'+esc(a.status||'')+'</span></div>';
      }).join('');
      panel.innerHTML='<div class="qpa-hd"><span>📋 All appointments this day · '+appts.length+'</span><button class="qpa-open" type="button">Open in Calendar →</button></div><div class="qpa-sub">Every patient booked this day across all providers — including ones not assigned to your name.</div><div class="qpa-list">'+rows+'</div>';
      panel.querySelector('.qpa-open').onclick=goCal;
      [].forEach.call(panel.querySelectorAll('.qpa-row'),function(r){ r.onclick=goCal; });
    }catch(e){}
  }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',build); }
  build(); setInterval(build, 1500);
})();

(function(){
  if(window.__mlsTplKwFix) return; window.__mlsTplKwFix=1;
  function normArr(kw){ if(Array.isArray(kw)) return kw; if(typeof kw==='string') return kw.split(/[,\n;]+/).map(function(s){return s.trim();}).filter(Boolean); return []; }
  function sanitize(){ try{ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(!/::templates$/.test(k)) continue; var raw=localStorage.getItem(k); if(!raw||raw.charAt(0)!=='[') continue; var arr; try{ arr=JSON.parse(raw); }catch(e){ continue; } if(!Array.isArray(arr)) continue; var changed=false; for(var j=0;j<arr.length;j++){ var t=arr[j]; if(!t||typeof t!=='object') continue; if(!Array.isArray(t.keywords)){ t.keywords=normArr(t.keywords); changed=true; } } if(changed) localStorage.setItem(k,JSON.stringify(arr)); } }catch(e){} }
  function wrap(){ try{ if(typeof window.openTemplates==='function' && !window.openTemplates.__kwWrapped){ var orig=window.openTemplates; var w=function(){ sanitize(); return orig.apply(this,arguments); }; w.__kwWrapped=true; window.openTemplates=w; } }catch(e){} }
  sanitize(); wrap();
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',function(){ sanitize(); wrap(); }); }
  setInterval(function(){ sanitize(); wrap(); }, 3000);
})();

(function(){
  if(window.__mlsMenuPopX) return; window.__mlsMenuPopX=1;
  function addReviewsMenu(){
    var panel=document.getElementById('mlsTbMenuPanel'); if(!panel) return;
    if(panel.querySelector('.mls-menu-reviews')) return;
    var btn=document.createElement('button');
    btn.className='mlsTbItem mls-menu-reviews';
    btn.textContent='\u2b50 Reviews & reputation';
    btn.onclick=function(){ try{ panel.style.display='none'; }catch(e){} var t=document.getElementById('mlsPtab_reviews'); if(t) t.click(); };
    var items=panel.querySelectorAll('button.mlsTbItem'); var anchor=null;
    for(var i=0;i<items.length;i++){ if(/recommendation/i.test(items[i].textContent||'')){ anchor=items[i]; break; } }
    if(anchor&&anchor.nextSibling){ panel.insertBefore(btn,anchor.nextSibling); }
    else if(items.length){ items[0].parentNode.insertBefore(btn, items[0].nextSibling); }
    else { panel.appendChild(btn); }
  }
  function bindPopClose(){
    var list=document.querySelectorAll('[id^="mlsPView_"]');
    for(var i=0;i<list.length;i++){ (function(p){
      if(p.__popCloseBound) return; p.__popCloseBound=1;
      p.addEventListener('click',function(e){ if(e.target===p){ p.style.display='none'; try{showView('visit');}catch(e){} } });
    })(list[i]); }
  }
  function tick(){ try{ addReviewsMenu(); bindPopClose(); }catch(e){} }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',tick); }
  tick(); setInterval(tick,1500);
})();

(function(){
  if(window.__mlsSmartPopups) return; window.__mlsSmartPopups=1;
  var CSS=[
    "#visitView.mls-cohere .vx-grid{display:block!important}",
    "#visitView.mls-cohere .vx-grid > *{width:100%!important;max-width:none!important;margin:0 0 14px!important;box-sizing:border-box}",
    "[id^=\"mlsPView_\"].mls-pop{background:rgba(6,12,24,.70)!important;overflow:auto!important;padding:44px 16px 64px!important}",
    ".mls-pop-card{max-width:980px;width:100%;margin:0 auto;background:linear-gradient(180deg,#102a49,#0d2138);border:1px solid rgba(120,150,220,.28);border-radius:18px;box-shadow:0 30px 90px rgba(0,0,0,.55);padding:24px 26px 30px;box-sizing:border-box}",
    ".mls-pop-card iframe{width:100%!important;min-height:80vh!important;border:0!important;border-radius:14px!important;background:#0b1428}",
    ".mls-pop-x{position:fixed;top:18px;right:22px;z-index:6000;background:rgba(255,255,255,.14);color:#eef4ff;border:1px solid rgba(160,190,255,.45);border-radius:999px;padding:8px 15px;font-weight:700;cursor:pointer;font-size:14px}",
    ".mls-pop-x:hover{background:rgba(255,255,255,.24)}"
  ].join("\n");
  function ensureStyle(){ if(document.getElementById('mlsSmartPopCss'))return; var st=document.createElement('style'); st.id='mlsSmartPopCss'; st.textContent=CSS; (document.head||document.documentElement).appendChild(st); }
  function deco(){ try{ ensureStyle(); var list=document.querySelectorAll('[id^="mlsPView_"]'); for(var i=0;i<list.length;i++){ (function(p){ p.classList.add('mls-pop'); if(!p.querySelector(':scope > .mls-pop-card')){ var card=document.createElement('div'); card.className='mls-pop-card'; while(p.firstChild){ card.appendChild(p.firstChild); } p.appendChild(card); } if(!p.querySelector(':scope > .mls-pop-x')){ var x=document.createElement('button'); x.className='mls-pop-x'; x.textContent='\u2715 Close'; x.onclick=function(){ p.style.display='none'; try{showView('visit');}catch(e){} }; p.appendChild(x); } })(list[i]); } }catch(e){} }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',deco); }
  deco(); setInterval(deco,1500);
})();

(function(){
  if(window.__mlsEasyCohesion) return; window.__mlsEasyCohesion=1;
  var CSS=[
    "#visitView.mls-cohere{background:linear-gradient(180deg,#0e2540 0%,#0c1f38 100%);border:1px solid rgba(120,150,220,.22);border-radius:20px;padding:14px 14px 18px;box-shadow:0 18px 50px rgba(6,14,28,.35)}",
    "#visitView.mls-cohere #mlsCockpit{background:transparent!important;border:none!important;box-shadow:none!important;padding:4px 4px 2px!important}",
    "#visitView.mls-cohere #mlsEasyTools{margin:4px 2px 10px}",
    "#visitView.mls-cohere #mlsEasyTools .et-btn{color:#eef4ff!important;background:rgba(255,255,255,.10)!important;border:1px solid rgba(160,190,255,.34)!important}",
    "#visitView.mls-cohere #visitHero{background:transparent!important;border:none!important;box-shadow:none!important;padding:2px 2px 6px!important}",
    "#visitView.mls-cohere #captureCard,#visitView.mls-cohere #noteCard,#visitView.mls-cohere #emrCard{box-shadow:0 10px 34px rgba(0,0,0,.30)!important;border-radius:16px!important}",
    "#visitView.mls-cohere #mlsAllergyStrip{margin:6px 2px}"
  ].join("\n");
  function ensureStyle(){ if(document.getElementById('mlsCohereCss'))return; var st=document.createElement('style'); st.id='mlsCohereCss'; st.textContent=CSS; (document.head||document.documentElement).appendChild(st); }
  function apply(){ try{ ensureStyle(); var vv=document.getElementById('visitView'), ck=document.getElementById('mlsCockpit'); if(vv&&ck&&!vv.classList.contains('mls-cohere')) vv.classList.add('mls-cohere'); }catch(e){} }
  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded',apply); }
  apply(); setInterval(apply,1500);
})();

(function(){
  if(window.__mlsVersionCheck) return;
  window.__mlsVersionCheck=true;
  var MLS_APP_BUILD='2026-07-06-b48';
  window.__MLS_APP_BUILD=MLS_APP_BUILD;
  var URL='https://mlsscribe.com/mls-connect.js';
  var banner=null;
  function showBanner(newv){
    if(banner&&banner.parentNode) return;
    banner=document.createElement('div'); banner.id='mlsVerBanner';
    banner.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:99999;background:#0d2138;color:#eef4ff;border:1px solid #2f7cf6;border-radius:14px;padding:11px 14px;display:flex;align-items:center;gap:12px;font:600 14px system-ui;box-shadow:0 8px 30px rgba(0,0,0,.45);max-width:92vw';
    var sp=document.createElement('span'); sp.textContent='\u2728 A newer version of MLS is ready.'; banner.appendChild(sp);
    var b=document.createElement('button'); b.textContent='Refresh'; b.style.cssText='cursor:pointer;background:#2f7cf6;color:#fff;border:none;border-radius:9px;padding:8px 14px;font-weight:700'; b.onclick=function(){ try{location.href=location.pathname+'?rv='+encodeURIComponent(newv);}catch(_){location.reload();} }; banner.appendChild(b);
    var x=document.createElement('button'); x.textContent='\u00d7'; x.style.cssText='cursor:pointer;background:transparent;color:#9fb0d8;border:none;font-size:18px;line-height:1'; x.onclick=function(){ if(banner){banner.remove();banner=null;} }; banner.appendChild(x);
    (document.body||document.documentElement).appendChild(banner);
  }
  function check(){ try{ fetch(URL+'?nc='+Date.now(),{cache:'no-store'}).then(function(r){return r.text();}).then(function(t){ var m=t.match(/MLS_APP_BUILD='([^']+)'/); if(m&&m[1]&&m[1]!==MLS_APP_BUILD){ showBanner(m[1]); } }).catch(function(){}); }catch(_){} }
  setTimeout(check, 8000);
  setInterval(check, 180000);
  window.addEventListener('focus', function(){ setTimeout(check, 1200); });
})();

(function(){
  if(window.__mlsVisitTidy) return;
  window.__mlsVisitTidy=true;
  /* Tidy the MLS Easy hero: drop the duplicate eyebrow + redundant instruction subtitle (the guided cockpit is the header now). Keep the 'Just talk' tagline + all functional controls. */
  function tidy(){
    var hero=document.getElementById('visitHero'); if(!hero) return false;
    var jt=[].find.call(hero.querySelectorAll('h1'),function(e){return /Just talk/i.test(e.textContent);});
    if(!jt) return false;
    var prev=jt.previousElementSibling;
    if(prev && /Ready for your next patient/i.test(prev.textContent||'') && (prev.textContent||'').length<70){ prev.style.setProperty('display','none','important'); }
    var next=jt.nextElementSibling;
    if(next && next.tagName==='P' && /Enter the patient/i.test(next.textContent||'')){ next.style.setProperty('display','none','important'); }
    return true;
  }
  var n=0,iv=setInterval(function(){ tidy(); if(++n>60) clearInterval(iv); },700);
  if(document.readyState!=='loading') tidy();
})();

(function(){
  if(window.__mlsHideAskDup) return;
  window.__mlsHideAskDup=true;
  /* Remove the duplicate 'Ask your data' FAB - it is already MLS Copilot in AI Studio */
  function hide(){ var b=document.getElementById('mls-ask-btn'); if(b){ b.style.setProperty('display','none','important'); return true; } return false; }
  var n=0,iv=setInterval(function(){ hide(); if(++n>150) clearInterval(iv); },700);
  if(document.readyState!=='loading') hide();
})();

(function(){
  if(window.__mlsTabsInEasy) return;
  window.__mlsTabsInEasy=true;
  var CSS="#mlsEasyTools{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 16px}#mlsEasyTools .et-btn{cursor:pointer;flex:1 1 240px;min-width:0;display:flex;align-items:center;gap:9px;justify-content:center;border-radius:14px;padding:13px 16px;font:700 14px system-ui;color:#eef4ff;background:rgba(255,255,255,.07);border:1px solid rgba(160,190,255,.28)}#mlsEasyTools .et-btn:hover{filter:brightness(1.12)}#mlsEasyTools .et-prem{margin-left:2px;font-size:9px;font-weight:800;letter-spacing:.4px;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;padding:2px 6px;border-radius:6px}@media(max-width:640px){#mlsEasyTools .et-btn{flex:1 1 100%}}";
  function css(){if(document.getElementById('mlsTabsInEasyCss'))return;var s=document.createElement('style');s.id='mlsTabsInEasyCss';s.textContent=CSS;document.head.appendChild(s);}
  var DEFS=[{id:'mlsPtab_reviews',icon:'\u2B50',label:'Reviews & reputation'},{id:'mlsPtab_send',icon:'\uD83D\uDCE4',label:'Send to patient'}];
  function hideTabs(){ DEFS.forEach(function(d){ var t=document.getElementById(d.id); if(t) t.style.setProperty('display','none','important'); }); }
  function build(){
    var hero=document.getElementById('visitHero'); if(!hero) return false;
    if(!document.getElementById('mlsPtab_reviews')&&!document.getElementById('mlsPtab_send')) return false;
    css(); hideTabs();
    var row=document.getElementById('mlsEasyTools');
    if(!row){ row=document.createElement('div'); row.id='mlsEasyTools';
      DEFS.forEach(function(d){ var b=document.createElement('button'); b.type='button'; b.className='et-btn'; b.setAttribute('data-target',d.id); b.innerHTML=d.icon+' '+d.label+'<span class="et-prem">PREMIUM</span>'; b.onclick=function(ev){ try{ev.stopPropagation();}catch(_){}; var t=document.getElementById(d.id); if(t) t.click(); }; row.appendChild(b); });
    }
    if(!row.parentNode){ var ck=document.getElementById('mlsCockpit'); if(ck&&ck.parentNode===hero){ if(ck.nextSibling) hero.insertBefore(row,ck.nextSibling); else hero.appendChild(row); } else { hero.insertBefore(row,hero.firstChild); } }
    return true;
  }
  var n=0,iv=setInterval(function(){ build(); if(document.getElementById('mlsEasyTools')||++n>120){ /* keep re-hiding a bit longer */ } if(++n>150) clearInterval(iv); },600);
  if(document.readyState!=='loading')build();
})();

(function(){
  if(window.__mlsEasyUnified) return;
  window.__mlsEasyUnified=true;
  var CSS="#mls-rt-bar{display:none!important}#mlsEwStack{display:none!important}#mlsVisitStepper{display:none!important}.mls-bridge-hidden{display:none!important}#mlsCockpit{margin:0 0 14px;color:#eef4ff;font-family:system-ui,-apple-system,sans-serif;background:linear-gradient(135deg,#0d2138,#16324f);border:1px solid rgba(120,150,220,.28);border-radius:18px;padding:16px 16px 6px}#mlsCockpit .ck-eyebrow{font-size:12px;letter-spacing:.5px;color:#8fb0e8;font-weight:700;text-transform:uppercase;margin-bottom:9px;display:flex;align-items:center;justify-content:space-between;gap:7px}#mlsCockpit .ck-showall{cursor:pointer;font-size:11px;font-weight:700;color:#bcd0f5;background:rgba(255,255,255,.08);border:1px solid rgba(150,180,240,.3);border-radius:8px;padding:5px 9px;text-transform:none;letter-spacing:0}#mlsCockpit .ck-showall.on{background:#2f7cf6;color:#fff;border-color:transparent}#mlsCockpit .ck-steps{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}#mlsCockpit .ck-step{display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(150,180,240,.25);cursor:pointer;font-size:13px;font-weight:600;color:#c7d6f5;flex:1 1 auto;justify-content:center;min-width:118px}#mlsCockpit .ck-step .n{width:20px;height:20px;border-radius:50%;background:rgba(255,255,255,.14);display:flex;align-items:center;justify-content:center;font-size:11px;flex:0 0 auto}#mlsCockpit .ck-step.on{background:linear-gradient(135deg,#2f7cf6,#5b8dff);border-color:transparent;color:#fff;box-shadow:0 4px 14px rgba(47,124,246,.4)}#mlsCockpit .ck-step.on .n{background:rgba(255,255,255,.25)}#mlsCockpit .ck-step.done{color:#8fe0b4}#mlsCockpit .ck-step.done .n{background:rgba(60,200,130,.3)}#mlsCockpit .ck-body{background:rgba(255,255,255,.05);border:1px solid rgba(150,180,240,.18);border-radius:16px;padding:16px 16px 18px}#mlsCockpit .ck-title{font-size:19px;font-weight:800;margin:0 0 3px}#mlsCockpit .ck-hint{font-size:13px;color:#a8bce6;margin:0 0 14px;line-height:1.45}#mlsCockpit .ck-actions{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:14px}#mlsCockpit .ck-btn{cursor:pointer;border-radius:12px;padding:12px 15px;font-size:14px;font-weight:700;border:1px solid rgba(160,190,255,.3);background:rgba(255,255,255,.08);color:#eef4ff;display:flex;align-items:center;gap:7px}#mlsCockpit .ck-btn:hover{filter:brightness(1.08)}#mlsCockpit .ck-btn.primary{background:linear-gradient(135deg,#2f7cf6,#5b8dff);border-color:transparent;color:#fff;box-shadow:0 6px 18px rgba(47,124,246,.35);flex:1 1 220px;justify-content:center;font-size:15px;padding:14px 18px}#mlsCockpit .ck-nav{display:flex;gap:9px;justify-content:space-between}#mlsCockpit .ck-nav button{cursor:pointer;border-radius:12px;padding:11px 18px;font-size:14px;font-weight:700;border:1px solid rgba(160,190,255,.3);background:rgba(255,255,255,.06);color:#dce8ff}#mlsCockpit .ck-nav .next{background:#fff;color:#12325a;border:none}#mlsCockpit .ck-nav .next:disabled,#mlsCockpit .ck-nav .back:disabled{opacity:.4}@media(max-width:640px){#mlsCockpit .ck-step{min-width:0;flex:1 1 44%;font-size:12px;padding:8px 6px}#mlsCockpit .ck-btn.primary{flex:1 1 100%}#mlsCockpit .ck-btn{flex:1 1 100%;justify-content:center}#mlsCockpit .ck-title{font-size:17px}}";
  var showAll=false;
  function css(){if(document.getElementById('mlsCockpitCss'))return;var s=document.createElement('style');s.id='mlsCockpitCss';s.textContent=CSS;document.head.appendChild(s);}
  function vis(e){return e&&e.offsetParent!==null&&!e.disabled;}
  function mine(x){return x.closest&&(x.closest('#mlsCockpit')||x.closest('#mls-rt-bar')||x.closest('#mlsEwStack')||x.closest('#mlsWizBar')||x.closest('#mlsEasyTools'));}
  function byId(id){var e=document.getElementById(id);return vis(e)?e:null;}
  function byText(re){return [].find.call(document.querySelectorAll('button,a,[role=button],.vx-qbtn'),function(x){return !mine(x)&&re.test((x.textContent||'').trim())&&vis(x)&&(x.textContent||'').length<60;})||null;}
  function pick(c){for(var i=0;i<c.length;i++){var e=c[i].id?byId(c[i].id):byText(c[i].re);if(e)return e;}return null;}
  function flash(e){try{var o=e.style.boxShadow;e.style.boxShadow='0 0 0 3px rgba(47,124,246,.7)';setTimeout(function(){e.style.boxShadow=o;},700);}catch(_){}}
  function toast(m){var t=document.getElementById('mlsCkToast');if(!t){t=document.createElement('div');t.id='mlsCkToast';t.style.cssText='position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#0f1530;color:#e8ecff;padding:10px 16px;border-radius:10px;font:13px system-ui;box-shadow:0 6px 24px rgba(0,0,0,.3);z-index:9000;opacity:0;transition:opacity .2s;max-width:88vw;text-align:center';document.body.appendChild(t);}t.textContent=m;t.style.opacity='1';clearTimeout(t._h);t._h=setTimeout(function(){t.style.opacity='0';},2400);}
  function go(c,msg){var e=pick(c);if(!e){toast(msg||'Not available on this step yet.');return;}try{e.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}flash(e);setTimeout(function(){try{e.click();}catch(_){}},170);}
  function focusEl(c,msg){var e=pick(c);if(!e){toast(msg);return;}try{e.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}flash(e);try{e.focus();}catch(_){}}
  function scrollToEl(sel,msg){var e=document.querySelector(sel);if(!e||e.offsetParent===null){toast(msg);return;}try{e.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}flash(e);}
  function clickRaw(id,msg){var t=document.getElementById(id);if(t){t.click();}else if(msg){toast(msg);}}
  var LB=['','Patient','Capture','Note','Sign'];
  var STEPS=[null,
   {title:'Confirm your patient',hint:'Pick who you are seeing, then cross to Capture.',actions:[
     {label:'\u2935 Use current patient',primary:1,run:function(){go([{id:'mlsUseActivePtBtn'},{re:/Use current patient/i}],'No active patient - use the picker.');}},
     {label:'\uD83D\uDCC4 From open Athena chart',run:function(){go([{id:'mlsChartFillBtn'},{re:/From open Athena chart/i}],'Open a chart in athenaOne first.');}},
     {label:'\uD83D\uDCE5 Pull today\u2019s patients',run:function(){go([{re:/Pull today.?s patients/i}],'Pull not available here.');}},{label:'\uD83D\uDD52 Recent patients',run:function(){var b=[].find.call(document.querySelectorAll('button'),function(x){return (x.textContent||'').indexOf('Recent (')>=0&&(x.textContent||'').length<24;});if(b){try{b.scrollIntoView({block:'center'});}catch(_){}b.click();}else{toast('No recent patients yet - pull today first.');}}}]},
   {title:'Capture the visit',hint:'Press Start Visit and talk naturally - the note writes itself.',actions:[
     {label:'\u25B6 Start / stop visit',primary:1,run:function(){go([{id:'captureBtn'}],'Recorder not ready.');}},
     {label:'\uD83D\uDCF1 Phone mic',run:function(){go([{id:'phoneMicBtn'},{re:/Phone mic/i}],'Phone mic not available.');}},
     {label:'\uD83D\uDCCB Paste transcript',run:function(){focusEl([{id:'transcript'}],'Transcript box not found.');}}]},
   {title:'Review the note',hint:'Generate, then read the AI note + EMR fields before it hits the chart.',actions:[
     {label:'\u2728 Generate note',primary:1,run:function(){go([{id:'genBtn'},{re:/Generate Note/i}],'Generate not found.');}},
     {label:'\uD83D\uDD04 Regenerate',run:function(){go([{re:/Regenerate/i}],'Generate a note first.');}},
     {label:'\uD83D\uDDC2 EMR fields',run:function(){scrollToEl('#emrCard','EMR fields not ready yet.');}}]},
   {title:'Finalize & send',hint:'Sign into athena, copy to the EMR, and send the patient their portal.',actions:[
     {label:'\u2714 Review & Sign',primary:1,run:function(){go([{id:'signBtn'},{re:/Review & Sign/i}],'Generate the note first.');}},
     {label:'\uD83D\uDCCB Copy for EMR',run:function(){go([{id:'copyEmrBtn'},{re:/Copy for EMR/i}],'Note not ready.');}},
     {label:'\uD83D\uDCE4 Send to patient',run:function(){clickRaw('mlsPtab_send','Send not available.');}}]}
  ];
  var SEC={hero:'#visitHero',capture:'#captureCard',note:'#noteCard',emr:'#emrCard',tools:'.vx-tools',outcomes:'#outcomesCard'};
  var STEPSEC={1:['hero'],2:['capture'],3:['note','emr'],4:['note','emr','tools','outcomes']};
  function isolate(step){
    try{ var vs=document.getElementById('mlsVisitStepper'); if(vs) vs.classList.add('mls-bridge-hidden'); }catch(_){}
    var wl=STEPSEC[step]||[];
    Object.keys(SEC).forEach(function(k){ try{ var el=document.querySelector(SEC[k]); if(!el)return; if(showAll||wl.indexOf(k)>=0) el.classList.remove('mls-bridge-hidden'); else el.classList.add('mls-bridge-hidden'); }catch(_){}});
  }
  function curStep(){var h=document.getElementById('mls-rt-hint');if(!h)return 1;var m=(h.textContent||'').match(/Step\s*(\d)\s*of\s*4/i);return m?parseInt(m[1],10):1;}
  function setStep(n){if(n<1||n>4)return;var pills=document.querySelectorAll('.mls-rt-pill');if(pills[n-1])pills[n-1].click();setTimeout(render,120);}
  function ck(){var c=document.getElementById('mlsCockpit');if(c)return c;c=document.createElement('div');c.id='mlsCockpit';return c;}
  function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;');}
  function render(){var step=curStep();var spec=STEPS[step];if(!spec)return;var c=ck();var sh='';for(var i=1;i<=4;i++){var cl='ck-step'+(i===step?' on':(i<step?' done':''));var mk=(i<step)?'\u2713':i;sh+='<div class="'+cl+'" data-goto="'+i+'"><span class="n">'+mk+'</span>'+LB[i]+'</div>';}var ah='';spec.actions.forEach(function(a,idx){ah+='<button class="ck-btn'+(a.primary?' primary':'')+'" data-act="'+idx+'">'+esc(a.label)+'</button>';});c.innerHTML='<div class="ck-eyebrow"><span>\u2728 MLS Easy \u00b7 guided visit</span><button class="ck-showall'+(showAll?' on':'')+'" data-showall>'+(showAll?'Guided view':'\u2922 Show all')+'</button></div><div class="ck-steps">'+sh+'</div><div class="ck-body"><div class="ck-title">'+esc(spec.title)+'</div><div class="ck-hint">'+esc(spec.hint)+'</div><div class="ck-actions">'+ah+'</div><div class="ck-nav"><button class="back"'+(step<=1?' disabled':'')+'>\u2190 Back</button><button class="next"'+(step>=4?' disabled':'')+'>'+(step>=4?'All set':'Next: '+LB[step+1]+' \u2192')+'</button></div></div>';[].forEach.call(c.querySelectorAll('[data-goto]'),function(el){el.onclick=function(){setStep(parseInt(el.getAttribute('data-goto'),10));};});[].forEach.call(c.querySelectorAll('[data-act]'),function(el){el.onclick=function(ev){try{ev.stopPropagation();ev.preventDefault();}catch(_){}spec.actions[parseInt(el.getAttribute('data-act'),10)].run();};});var bk=c.querySelector('.back');if(bk&&step>1)bk.onclick=function(){setStep(step-1);};var nx=c.querySelector('.next');if(nx&&step<4)nx.onclick=function(){setStep(step+1);};var sa=c.querySelector('[data-showall]');if(sa)sa.onclick=function(){showAll=!showAll;render();toast(showAll?'Showing the whole visit screen at once.':'Guided view - one step at a time.');};isolate(step);}
  function mount(){var vv=document.getElementById('visitView');var hero=document.getElementById('visitHero');if(!vv||!hero)return false;css();var c=ck();if(c.parentElement!==vv){vv.insertBefore(c,hero);}var tools=document.getElementById('mlsEasyTools');if(tools&&tools.parentElement!==vv){vv.insertBefore(tools,hero);}render();return true;}
  function watch(){var h=document.getElementById('mls-rt-hint');if(!h)return false;if(!h.__ckObs){h.__ckObs=true;new MutationObserver(function(){render();}).observe(h,{childList:true,characterData:true,subtree:true});}return mount();}
  var n=0,iv=setInterval(function(){var ok=watch()&&document.getElementById('mlsCockpit');if(ok||++n>120)clearInterval(iv);},600);
  if(document.readyState!=='loading')watch();
})();

(function(){
  if(window.__mlsEasyWidgets) return;
  window.__mlsEasyWidgets=true;
  function el(id){return document.getElementById(id);}
  function byText(re,sel){return [].find.call(document.querySelectorAll(sel||'button,a,div'),function(x){return re.test((x.textContent||'').trim())&&x.offsetParent!==null&&(x.textContent||'').length<60;});}
  function clickId(id){var e=el(id);if(e){e.click();return true;}return false;}
  function clickText(re,sel){var e=byText(re,sel);if(e){e.click();return true;}return false;}
  function focusSel(sel){var e=document.querySelector(sel);if(e){try{e.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}try{e.focus();}catch(_){}return true;}return false;}
  function scrollText(re){var e=byText(re,'*');if(e){try{e.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}return true;}return false;}
  function toast(m){var t=el('mlsEwToast');if(!t){t=document.createElement('div');t.id='mlsEwToast';t.style.cssText='position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#0f1530;color:#e8ecff;padding:10px 16px;border-radius:10px;font:13px system-ui;z-index:9000;opacity:0;transition:opacity .2s;box-shadow:0 6px 24px rgba(0,0,0,.3)';document.body.appendChild(t);}t.textContent=m;t.style.opacity='1';clearTimeout(t._h);t._h=setTimeout(function(){t.style.opacity='0';},1800);}
  function A(fn,msg){return function(){var ok=false;try{ok=fn();}catch(e){ok=false;}if(!ok)toast(msg||'Not ready yet.');};}
  var WIDS=[
    {icon:'\uD83C\uDFAC',title:'Start a visit',sub:'Pick a patient, then record',btns:[
      {t:'Use current patient',p:1,run:A(function(){return clickId('mlsUseActivePtBtn');},'Use the picker above first.')},
      {t:'Start recording',run:A(function(){return clickId('heroRecBtn');},'Recorder not ready.')}]},
    {icon:'\uD83D\uDCC5',title:'Today',sub:'Load your schedule',btns:[
      {t:'Pull today\u2019s patients',p:1,run:A(function(){return clickText(/Pull today.?s patients/i);},'Pull control not found.')},
      {t:'From Athena chart',run:A(function(){return clickId('mlsChartFillBtn');},'Open a chart first.')}]},
    {icon:'\uD83D\uDCDD',title:'Notes & templates',sub:'Draft and organize',btns:[
      {t:'Prep op note',p:1,run:A(function(){return clickText(/Prep op note/i);},'Prep op note not found.')},
      {t:'EMR sections',run:A(function(){return clickId('emrBtn');},'EMR sections not found.')},
      {t:'Upload templates',run:A(function(){return clickId('mlsUplTplBtn');},'Upload templates not found.')}]},
    {icon:'\uD83D\uDCF1',title:'Record on phone',sub:'Scan the QR to dictate',btns:[
      {t:'Show QR code',p:1,run:A(function(){return scrollText(/Record on phone/i);},'QR not found.')}]},
    {icon:'\uD83D\uDCE4',title:'Send to patient',sub:'Booking link & portal login',btns:[
      {t:'Send portal login',p:1,run:A(function(){return clickId('mlsPortalInviteBtn');},'Send-portal not found.')},
      {t:'Open Send tab',run:A(function(){return clickId('mlsPtab_send');},'Send tab not found.')}]},
    {icon:'\u2B50',title:'Reputation',sub:'Reviews across the web',btns:[
      {t:'Open Reviews',p:1,run:A(function(){return clickId('mlsPtab_reviews');},'Reviews tab not found.')}]}
  ];
  function findCard(){var jt=[].find.call(document.querySelectorAll('h1'),function(e){return /Just talk/i.test(e.textContent);});if(!jt)return null;var c=jt;for(var i=0;i<6&&c;i++){var r=c.getBoundingClientRect();if(r.width>700&&r.height>250)return c;c=c.parentElement;}return null;}
  function build(card){
    if(el('mlsEwStack'))return;
    var wrap=document.createElement('div');wrap.id='mlsEwStack';wrap.style.cssText='margin:0 0 14px;max-width:860px;width:100%';
    var strip=document.createElement('div');strip.id='mlsEwStrip';strip.style.cssText='display:flex;gap:12px;overflow-x:auto;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch;padding:2px 2px 6px;scrollbar-width:none';
    strip.addEventListener('wheel',function(ev){if(Math.abs(ev.deltaY)>Math.abs(ev.deltaX)){strip.scrollLeft+=ev.deltaY;ev.preventDefault();}},{passive:false});
    WIDS.forEach(function(w,idx){
      var c=document.createElement('div');c.className='mls-ew-card';c.style.cssText='scroll-snap-align:center;flex:0 0 300px;min-width:300px;background:linear-gradient(135deg,rgba(255,255,255,.10),rgba(255,255,255,.04));border:1px solid rgba(160,190,255,.25);border-radius:16px;padding:15px 16px;color:#eef4ff;backdrop-filter:blur(4px)';
      var h=document.createElement('div');h.style.cssText='display:flex;align-items:center;gap:9px;margin-bottom:3px';h.innerHTML='<span style="font-size:22px">'+w.icon+'</span><b style="font-size:15px">'+w.title+'</b>';
      var s=document.createElement('div');s.textContent=w.sub;s.style.cssText='font-size:12px;color:#b8c8ee;margin-bottom:11px';
      var br=document.createElement('div');br.style.cssText='display:flex;gap:7px;flex-wrap:wrap';
      w.btns.forEach(function(b){var bt=document.createElement('button');bt.type='button';bt.textContent=b.t;bt.style.cssText='cursor:pointer;border-radius:9px;padding:8px 12px;font:600 12.5px system-ui;'+(b.p?'background:#2f7cf6;color:#fff;border:none':'background:rgba(255,255,255,.10);color:#eef4ff;border:1px solid rgba(160,190,255,.3)');bt.onclick=function(ev){try{ev.stopPropagation();}catch(_){}b.run();};br.appendChild(bt);});
      c.appendChild(h);c.appendChild(s);c.appendChild(br);strip.appendChild(c);
    });
    var dots=document.createElement('div');dots.id='mlsEwDots';dots.style.cssText='display:flex;gap:6px;justify-content:center;margin-top:9px';
    WIDS.forEach(function(_,i){var d=document.createElement('div');d.className='mls-ew-dot';d.style.cssText='width:7px;height:7px;border-radius:50%;background:rgba(200,215,255,'+(i===0?'.95':'.32')+');cursor:pointer;transition:background .2s';d.onclick=function(){var card0=strip.children[i];if(card0)strip.scrollTo({left:card0.offsetLeft-strip.offsetLeft-((strip.clientWidth-card0.clientWidth)/2),behavior:'smooth'});};dots.appendChild(d);});
    function upd(){var mid=strip.scrollLeft+strip.clientWidth/2;var best=0,bd=1e9;[].forEach.call(strip.children,function(ch,i){var cc=ch.offsetLeft-strip.offsetLeft+ch.clientWidth/2;var dd=Math.abs(cc-mid);if(dd<bd){bd=dd;best=i;}});[].forEach.call(dots.children,function(dd,i){dd.style.background='rgba(200,215,255,'+(i===best?'.95':'.32')+')';});}
    strip.addEventListener('scroll',function(){window.requestAnimationFrame(upd);});
    wrap.appendChild(strip);wrap.appendChild(dots);
    card.insertBefore(wrap,card.firstChild);
  }
  var n=0,iv=setInterval(function(){var card=findCard();if(card){build(card);if(el('mlsEwStack'))clearInterval(iv);}if(++n>120)clearInterval(iv);},600);
})();

(function(){
  if(window.__mlsWizEasyLink) return;
  window.__mlsWizEasyLink=true;
  function vis(e){return e&&e.offsetParent!==null&&!e.disabled;}
  function mine(x){return x.closest&&(x.closest('#mlsWizBar')||x.closest('#mlsEwStack'));}
  function byId(id){var e=document.getElementById(id);return vis(e)?e:null;}
  function byText(re){return [].find.call(document.querySelectorAll('button,a,[role=button],.vx-qbtn'),function(x){return !mine(x)&&re.test((x.textContent||'').trim())&&vis(x)&&(x.textContent||'').length<60;})||null;}
  function pick(cands){for(var i=0;i<cands.length;i++){var c=cands[i];var e=c.id?byId(c.id):byText(c.re);if(e)return e;}return null;}
  function flash(e){try{var o=e.style.boxShadow;e.style.boxShadow='0 0 0 3px rgba(47,124,246,.7)';setTimeout(function(){e.style.boxShadow=o;},700);}catch(_){}}
  function toast(m){var t=document.getElementById('mlsWizToast');if(!t){t=document.createElement('div');t.id='mlsWizToast';t.style.cssText='position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#0f1530;color:#e8ecff;padding:10px 16px;border-radius:10px;font:13px system-ui;box-shadow:0 6px 24px rgba(0,0,0,.3);z-index:9000;opacity:0;transition:opacity .2s';document.body.appendChild(t);}t.textContent=m;t.style.opacity='1';clearTimeout(t._h);t._h=setTimeout(function(){t.style.opacity='0';},2200);}
  function go(cands,msg){var e=pick(cands);if(!e){toast(msg||'That is not available on this step yet.');return;}try{e.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}flash(e);setTimeout(function(){try{e.click();}catch(_){}},180);}
  function focusEl(cands,msg){var e=pick(cands);if(!e){toast(msg);return;}try{e.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}flash(e);try{e.focus();}catch(_){}}
  function scrollTo(re,msg){var e=[].find.call(document.querySelectorAll('*'),function(x){return !mine(x)&&re.test((x.textContent||'').trim())&&x.offsetParent!==null&&(x.textContent||'').length<50;});if(!e){toast(msg);return;}try{e.scrollIntoView({behavior:'smooth',block:'center'});}catch(_){}flash(e);}
  var STEPS={
    1:{title:'Confirm your patient',btns:[
      {label:'\u2935 Use current patient',primary:1,run:function(){go([{id:'mlsUseActivePtBtn'},{re:/Use current patient/i}],'No active patient - pick one with the picker above.');}},
      {label:'\uD83D\uDCC4 From open Athena chart',run:function(){go([{id:'mlsChartFillBtn'},{re:/From open Athena chart/i}],'Open a chart in athenaOne first.');}},
      {label:'\uD83D\uDCE5 Pull today\u2019s patients',run:function(){go([{re:/Pull today.?s patients/i}],'Pull control not available here.');}}]},
    2:{title:'Capture the visit',btns:[
      {label:'\uD83C\uDF99\uFE0F Start / stop recording',primary:1,run:function(){go([{id:'heroRecBtn'},{re:/Start recording|Stop recording/i}],'Recorder not ready.');}},
      {label:'\uD83D\uDCF1 Record on phone',run:function(){scrollTo(/Record on phone/i,'QR not on screen.');}},
      {label:'\uD83D\uDCCB Paste transcript',run:function(){focusEl([{id:'transcript'}],'Transcript box not found.');}}]},
    3:{title:'Review the note',btns:[
      {label:'\u2728 Generate note',primary:1,run:function(){go([{id:'genBtn'},{re:/Generate Note/i}],'Generate button not found.');}},
      {label:'\uD83D\uDDC2 EMR sections',run:function(){go([{id:'emrBtn'},{re:/^EMR sections$/i}],'Generate a note first - then EMR sections opens.');}},
      {label:'\uD83D\uDCE4 Upload templates',run:function(){go([{id:'mlsUplTplBtn'},{re:/Upload templates/i}],'Upload templates not found.');}}]},
    4:{title:'Finalize & send',btns:[
      {label:'\uD83D\uDD8A Sign & Save in Athena',primary:1,run:function(){go([{re:/Sign\s*&\s*Save in Athena/i}],'Generate the note first, then sign.');}},
      {label:'\uD83D\uDCE7 Send portal login',run:function(){go([{id:'mlsPortalInviteBtn'},{re:/Send portal login/i}],'Send-portal control not found.');}},
      {label:'\uD83D\uDCC4 After-visit summary',run:function(){go([{id:'mlsavsBtn'},{re:/After.?visit summary/i}],'After-visit summary not available yet.');}}]}
  };
  function curStep(){var h=document.getElementById('mls-rt-hint');if(!h)return 0;var m=(h.textContent||'').match(/Step\s*(\d)\s*of\s*4/i);return m?parseInt(m[1],10):0;}
  function bar(){var b=document.getElementById('mlsWizBar');if(b)return b;b=document.createElement('div');b.id='mlsWizBar';b.style.cssText='display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:8px 0 4px;padding:8px 10px;background:#f3f6ff;border:1px solid #d6e0f5;border-radius:12px';return b;}
  function mkBtn(cfg){var e2=document.createElement('button');e2.type='button';e2.textContent=cfg.label;e2.style.cssText='cursor:pointer;border-radius:9px;padding:8px 13px;font:600 13px system-ui;'+(cfg.primary?'background:#2563eb;color:#fff;border:none':'background:#fff;color:#12325a;border:1px solid #c3d2ee');e2.onmouseenter=function(){e2.style.filter='brightness(.96)';};e2.onmouseleave=function(){e2.style.filter='none';};e2.onclick=function(ev){try{ev.stopPropagation();ev.preventDefault();}catch(_){}cfg.run();};return e2;}
  function render(){var step=curStep();if(!step)return;var spec=STEPS[step];if(!spec)return;var hint=document.getElementById('mls-rt-hint');if(!hint)return;var host=hint.parentNode;if(!host)return;var b=bar();if(b.getAttribute('data-step')===String(step)&&b.parentNode)return;b.setAttribute('data-step',String(step));b.innerHTML='';var lab=document.createElement('span');lab.textContent=spec.title;lab.style.cssText='font:700 12px system-ui;color:#5570a8;margin-right:4px';b.appendChild(lab);spec.btns.forEach(function(c){b.appendChild(mkBtn(c));});if(!b.parentNode){if(host.nextSibling)host.parentNode.insertBefore(b,host.nextSibling);else host.parentNode.appendChild(b);}}
  function watch(){var h=document.getElementById('mls-rt-hint');if(!h)return false;if(h.__mlsWizObs){render();return true;}h.__mlsWizObs=true;var mo=new MutationObserver(function(){render();});mo.observe(h,{childList:true,characterData:true,subtree:true});render();return true;}
  var n=0,iv=setInterval(function(){if(watch()||++n>120)clearInterval(iv);},600);
  if(document.readyState!=='loading')watch();
})();

(function(){
  if(window.__mlsPatientReach) return;
  window.__mlsPatientReach=true;
  var BOOK_URL=location.origin+'/easy-book.html';
  var REVIEW_URL='/review-finder.html';
  var BACKEND='https://scrivara-backend.onrender.com';
  function overlay(id){
    var vw=document.getElementById(id); if(vw) return vw;
    vw=document.createElement('div'); vw.id=id; vw.setAttribute('data-mls-pview','1');
    vw.style.cssText='display:none;position:fixed;left:0;right:0;bottom:0;z-index:5000;background:#0b1020;overflow:auto';
    document.body.appendChild(vw); return vw;
  }
  function hideMine(){ document.querySelectorAll('[data-mls-pview]').forEach(function(v){v.style.display='none';}); document.querySelectorAll('[data-mls-ptab]').forEach(function(t){t.classList.remove('on');}); }
  function topPx(){ var nav=document.getElementById('mlsRdNav'); return nav?Math.round(nav.getBoundingClientRect().bottom):64; }
  function show(vw){ hideMine(); vw.style.top=topPx()+'px'; vw.style.display='block'; }
  function showReviews(){
    var vw=overlay('mlsPView_reviews');
    if(!vw.querySelector('iframe')){ var f=document.createElement('iframe'); f.src=REVIEW_URL; f.style.cssText='width:100%;height:100%;border:0;background:#0b1020'; vw.appendChild(f); }
    show(vw); var t=document.getElementById('mlsPtab_reviews'); if(t)t.classList.add('on');
  }
  function activePatient(){ try{ var v=window.activePatient; if(typeof v==='function'){ return v()||{}; } return window._activePatient||(typeof v==='object'&&v?v:{}); }catch(e){ return {}; } }
  function isPrem(){ try{ if(typeof window.effectivePremium==='function') return !!window.effectivePremium(); var u=window.bkUser; return !!(u&&(u.premium||u.isAdmin)); }catch(e){ return false; } }
  function badge(){ return '<span style="margin-left:6px;font-size:9px;font-weight:800;letter-spacing:.4px;background:linear-gradient(90deg,#7c3aed,#2563eb);color:#fff;padding:2px 5px;border-radius:6px;vertical-align:middle">PREMIUM</span>'; }
  function showUpsell(title,blurb){
    var vw=overlay('mlsPView_upsell'); vw.innerHTML='';
    var w=document.createElement('div');
    w.style.cssText='max-width:620px;margin:0 auto;padding:48px 18px;color:#e8ecff;font:15px/1.55 system-ui,-apple-system,sans-serif;text-align:center';
    w.innerHTML='<div style="font-size:30px;margin-bottom:6px">\u2728</div>'
      +'<h2 style="font-size:22px;margin:0 0 8px">'+title+' is a Premium feature</h2>'
      +'<p style="color:#9fb0d8;margin:0 auto 20px;max-width:460px">'+blurb+'</p>'
      +'<div style="background:#0f1530;border:1px solid rgba(120,140,220,.22);border-radius:14px;padding:18px;max-width:460px;margin:0 auto">'
      +'<b>Upgrade to Premium</b><div style="font-size:13px;color:#9fb0d8;margin:6px 0 14px">Unlock patient outreach, reputation tools, AI Studio and more.</div>'
      +'<a href="/index.html#pricing" target="_blank" style="display:inline-block;text-decoration:none;background:#2563eb;color:#fff;border-radius:9px;padding:11px 20px;font-weight:700">See Premium plans</a>'
      +'</div>';
    vw.appendChild(w); show(vw);
  }
  function gate(title,blurb,fn){ return function(){ if(isPrem()) return fn(); showUpsell(title,blurb); }; }
  function buildSend(vw){
    var p=activePatient();
    vw.innerHTML='';
    var wrap=document.createElement('div');
    wrap.style.cssText='max-width:720px;margin:0 auto;padding:24px 18px;color:#e8ecff;font:15px/1.5 system-ui,-apple-system,sans-serif';
    wrap.innerHTML=
      '<h2 style="font-size:20px;margin:0 0 4px">Send to your patients</h2>'
      +'<p style="color:#9fb0d8;font-size:13px;margin:0 0 18px">These are patient-facing. Share the booking link publicly, and send a specific patient their private portal login.</p>'
      +'<div style="background:#0f1530;border:1px solid rgba(120,140,220,.22);border-radius:14px;padding:16px;margin-bottom:14px">'
      +  '<b>Booking link</b><div style="font-size:12.5px;color:#9fb0d8;margin:2px 0 10px">Give this to patients or put it on your Google Business Profile and website so anyone can request an appointment.</div>'
      +  '<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="mlsBookLink" readonly value="'+BOOK_URL+'" style="flex:1;min-width:220px;background:#141b3d;border:1px solid rgba(120,140,220,.22);border-radius:8px;color:#e8ecff;padding:9px 11px"><button id="mlsCopyBook" style="background:#2563eb;border:none;color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer">Copy link</button></div>'
      +  '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px"><a href="sms:?&body='+encodeURIComponent('Book your appointment here: '+BOOK_URL)+'" style="text-decoration:none;border:1px solid rgba(120,140,220,.3);color:#e8ecff;border-radius:8px;padding:9px 12px">Text a patient</a><a href="mailto:?subject='+encodeURIComponent('Book your appointment')+'&body='+encodeURIComponent('Hi,\n\nYou can request an appointment here: '+BOOK_URL+'\n\nThank you.')+'" style="text-decoration:none;border:1px solid rgba(120,140,220,.3);color:#e8ecff;border-radius:8px;padding:9px 12px">Email a patient</a><button id="mlsCfgBook" style="background:transparent;border:1px solid rgba(120,140,220,.3);color:#e8ecff;border-radius:8px;padding:9px 12px;cursor:pointer">Set up / preview page</button></div>'
      +'</div>'
      +'<div style="background:#0f1530;border:1px solid rgba(120,140,220,.22);border-radius:14px;padding:16px">'
      +  '<b>Patient portal access</b><div style="font-size:12.5px;color:#9fb0d8;margin:2px 0 10px">Email a specific patient a secure login to view their records and chat with them.'+(p&&p.name?(' Active patient: <b>'+String(p.name)+'</b>.'):'')+'</div>'
      +  '<div style="display:flex;gap:8px;flex-wrap:wrap"><input id="mlsPortalEmail" placeholder="patient@email.com" style="flex:1;min-width:220px;background:#141b3d;border:1px solid rgba(120,140,220,.22);border-radius:8px;color:#e8ecff;padding:9px 11px"><button id="mlsSendPortal" style="background:#16a34a;border:none;color:#fff;border-radius:8px;padding:9px 14px;font-weight:700;cursor:pointer">Send login</button></div>'
      +  '<div id="mlsPortalMsg" style="font-size:13px;color:#9fb0d8;margin-top:8px"></div>'
      +'</div>'
      +'<div id="mlsCfgFrame"></div>';
    vw.appendChild(wrap);
    wrap.querySelector('#mlsCopyBook').onclick=function(){ var b=this; try{navigator.clipboard.writeText(BOOK_URL);}catch(e){} b.textContent='Copied'; setTimeout(function(){b.textContent='Copy link';},1400); };
    wrap.querySelector('#mlsCfgBook').onclick=function(){ var c=wrap.querySelector('#mlsCfgFrame'); if(c.querySelector('iframe')){ c.innerHTML=''; return; } var f=document.createElement('iframe'); f.src=BOOK_URL; f.style.cssText='width:100%;height:70vh;border:1px solid rgba(120,140,220,.22);border-radius:12px;margin-top:14px;background:#0b1020'; c.appendChild(f); };
    var em=wrap.querySelector('#mlsPortalEmail'); try{ if(p&&p.email) em.value=p.email; }catch(e){}
    wrap.querySelector('#mlsSendPortal').onclick=function(){
      var email=(em.value||'').trim(), msg=wrap.querySelector('#mlsPortalMsg'), btn=this;
      if(!email){ msg.style.color='#ffcf8f'; msg.textContent='Enter the patient email first.'; return; }
      var token=null; try{ token=localStorage.getItem('sf_bk_token'); }catch(e){}
      if(!token){ msg.style.color='#ffcf8f'; msg.textContent='Not signed in to MLS — reload the app and try again.'; return; }
      msg.style.color='#9fb0d8'; msg.textContent='Sending...'; btn.disabled=true;
      var pp=activePatient();
      fetch(BACKEND+'/api/patient/admin/send-portal-invite',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify({email:email,name:pp.name||'',external_id:pp.id||pp.patient_external_id||pp.external_id||'',dob:pp.dob||'',mrn:pp.mrn||'',id:pp.id||''})})
        .then(function(r){ btn.disabled=false; if(r.ok){ msg.style.color='#9be8b8'; msg.textContent='Sent. The patient will get a secure login link by email.'; } else if(r.status===401||r.status===403){ msg.style.color='#ffcf8f'; msg.textContent='This account may not be allowed to send invites (needs the practice/admin login). Send from the admin account.'; } else { msg.style.color='#ffcf8f'; msg.textContent='Could not send (error '+r.status+'). Try again.'; } })
        .catch(function(){ btn.disabled=false; msg.style.color='#ffcf8f'; msg.textContent='Network error, try again.'; });
    };
  }
  function showSend(){ var vw=overlay('mlsPView_send'); buildSend(vw); show(vw); var t=document.getElementById('mlsPtab_send'); if(t)t.classList.add('on'); }
  function inject(){
    var nav=document.getElementById('mlsRdNav'); if(!nav) return false;
    if(nav.querySelector('[data-mls-ptab]')) return true;
    var before=document.getElementById('nav_help');
    function tab(id,label,fn){ var b=document.createElement('div'); b.id='mlsPtab_'+id; b.className='navtab'; b.setAttribute('data-mls-ptab',id); b.innerHTML=label+badge(); b.onclick=function(e){ try{e.stopPropagation();}catch(_){ } fn(); }; if(before&&before.parentNode) before.parentNode.insertBefore(b,before); else nav.appendChild(b); }
    tab('reviews','⭐ Reviews', gate('Reviews & Reputation','Find and manage your reputation across Google and the top review sites, pull positive quotes, and request more reviews from real patients.', showReviews));
    tab('send','📤 Send to patient', gate('Send to patient','Share your booking link and email patients a secure portal login to view their records and chat with you.', showSend));
    nav.querySelectorAll('.navtab:not([data-mls-ptab])').forEach(function(t){ if(t.getAttribute('data-mls-phook')) return; t.setAttribute('data-mls-phook','1'); t.addEventListener('click',function(){ hideMine(); },true); });
    return true;
  }
  var n=0, iv=setInterval(function(){ inject(); if(++n>90) clearInterval(iv); },700);
  if(document.readyState!=='loading') inject();
})();


(function(){
  if(window.__mlsEmrSections) return;
  window.__mlsEmrSections=true;
  var S=[
    {k:'history',label:'History',h:['history of present illness','interval history','chief complaint','subjective','history','hpi','cc'],c:/\b(reports|complains|presents|returns|states|denies|interval|symptom)/i},
    {k:'exam',label:'Physical exam',h:['physical examination','physical exam','on exam','objective','exam','pe'],c:/\b(tender|palpation|range of motion|\brom\b|strength [0-9]|reflex|\bslr\b|no swelling|no edema|gait|inspection)/i},
    {k:'assessment',label:'Assessment',h:['assessment and plan','assessment','impression','diagnosis','dx'],c:/\b(assessment|impression|diagnos|consistent with|likely|radiculopathy|osteoarthritis|stenosis)/i},
    {k:'plan',label:'Plan',h:['treatment plan','recommendations','plan'],c:/\b(plan|continue|recommend|advise|counsel|conservative|discussed|we will|activity modification|rest and ice)/i},
    {k:'orders',label:'Orders',h:['orders','labs ordered','labs','order'],c:/\b(order|\blabs?\b|cbc|cmp|blood work|a1c|panel|ekg|ecg)/i},
    {k:'rx',label:'Prescriptions',h:['prescriptions','medications prescribed','medications','prescribe','rx','meds'],c:/\b(prescrib|refill|naproxen|ibuprofen|gabapentin|prednisone|tramadol|tylenol|[0-9]+\s?mg\b|\bbid\b|\btid\b|\bqhs\b)/i},
    {k:'referrals',label:'Referrals',h:['referrals','referral','refer to','consult'],c:/\b(referr|refer to|consult|neurosurg|ortho consult)/i},
    {k:'pt',label:'PT orders',h:['physical therapy','pt orders','therapy orders','pt'],c:/\b(physical therapy|therapy (twice|three|2x|3x)|home exercise program|\bhep\b|rehab)/i},
    {k:'imaging',label:'Imaging orders',h:['imaging','radiology','x-ray','xray','mri','ct scan','ct','ultrasound'],c:/\b(x-?ray|\bmri\b|ct scan|ultrasound|imaging|radiograph|scan of)/i},
    {k:'followup',label:'Follow-up',h:['follow-up','follow up','return to clinic','next visit','rtc','f/u'],c:/\b(follow(\s|-)?up|return(ing)? (in|to)|\brtc\b|recheck|in [0-9]+ (day|week|month))/i}
  ];
  function noteText(){ var e=document.getElementById('mls-note'); if(e) return (e.value!=null?e.value:e.textContent)||''; var t=document.getElementById('mls-tx'); return t?((t.value!=null?t.value:t.textContent)||''):''; }
  function classify(line){ var l=line.toLowerCase().replace(/[*_#>]/g,'').replace(/^\s*[0-9]+[.)]\s*/,'').trim(),best=null,bl=0; for(var i=0;i<S.length;i++){ for(var j=0;j<S[i].h.length;j++){ var h=S[i].h[j]; if(l.indexOf(h)===0||l.replace(/[:\s]+$/,'')===h){ if(h.length>bl){best=S[i].k;bl=h.length;} } } } return best; }
  function headerOf(line){ var t=line.trim(); if(!t) return null; var m=t.match(/^(?:#{1,6}\s*|\**\s*|[0-9]+[.)]\s*)?([A-Za-z][A-Za-z \/&-]{1,38}?)\s*:\s*(.*)$/); if(m){ var k=classify(m[1]); if(k) return {k:k,inline:m[2]||''}; } if(t.length<=40){ var k2=classify(t.replace(/[*_#]/g,'')); if(k2) return {k:k2,inline:''}; var L=t.replace(/[^A-Za-z]/g,''); if(L.length>=3&&L===L.toUpperCase()){ var k3=classify(t); if(k3) return {k:k3,inline:''}; } } return null; }
  function classifySentence(s){ for(var i=0;i<S.length;i++){ if(S[i].c&&S[i].c.test(s)) return S[i].k; } return null; }
  function organize(text){
    var b={_unsorted:''}; S.forEach(function(s){ b[s.k]=''; });
    var lines=String(text||'').split(/\r?\n/), cur=null, saw=false;
    for(var i=0;i<lines.length;i++){ var line=lines[i], h=headerOf(line); if(h){ saw=true; cur=h.k; if(h.inline) b[cur]+=(b[cur]?'\n':'')+h.inline; continue; } var t=cur||'_unsorted'; if(line.trim()) b[t]+=(b[t]?'\n':'')+line; }
    if(!saw){ S.forEach(function(s){ b[s.k]=''; }); b._unsorted=''; var parts=String(text||'').replace(/\n+/g,' ').split(/([.!?])\s+/), sents=[]; for(var a=0;a<parts.length;a+=2){ var seg=(parts[a]||'')+(parts[a+1]||''); if(seg.trim()) sents.push(seg.trim()); } sents.forEach(function(s){ var k=classifySentence(s)||'_unsorted'; b[k]+=(b[k]?' ':'')+s; }); }
    Object.keys(b).forEach(function(k){ b[k]=b[k].replace(/^\s+|\s+$/g,''); }); return b;
  }
  function mapAi(v){
    var b={_unsorted:''}; S.forEach(function(s){ b[s.k]=''; });
    function keyFor(n){ var k=classify(String(n)); if(k) return k; var s=String(n).toLowerCase(); for(var i=0;i<S.length;i++){ if(S[i].h.some(function(h){return s.indexOf(h)>-1;})) return S[i].k; } return null; }
    function put(n,x){ if(!x) return; var k=keyFor(n)||'_unsorted'; b[k]+=(b[k]?'\n':'')+String(x).trim(); }
    if(Array.isArray(v)){ v.forEach(function(it){ if(it&&typeof it==='object') put(it.section||it.name||it.label||it.title,it.text||it.content||it.body||it.value); }); }
    else if(v&&typeof v==='object'){ Object.keys(v).forEach(function(kk){ put(kk, typeof v[kk]==='string'?v[kk]:(v[kk]&&(v[kk].text||v[kk].content))); }); }
    else return null;
    return Object.keys(b).some(function(k){return b[k];})?b:null;
  }
  var conf={};
  var CS='border:1px solid rgba(120,140,220,.22);border-radius:8px;color:#e8ecff;padding:8px 10px;font:13px/1.5 system-ui';
  function count(host){ var n=0; S.forEach(function(s){ if(conf[s.k]) n++; }); var c=host.querySelector('#emrCount'); if(c) c.textContent=n+' / '+S.length+' sections confirmed'; }
  function card(k,label,val){ return '<div style="background:#0f1530;border:1px solid rgba(120,140,220,.22);border-radius:12px;padding:12px 14px;margin-bottom:10px"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><b style="color:#e8ecff">'+label+'</b><label style="font-size:12px;color:#9fb0d8;display:flex;gap:6px;cursor:pointer"><input type="checkbox" data-k="'+k+'" '+(conf[k]?'checked':'')+'>confirm</label></div><textarea data-t="'+k+'" style="width:100%;margin-top:8px;min-height:'+(val?'62px':'38px')+';background:#141b3d;'+CS+';resize:vertical" placeholder="(nothing captured for '+label+')">'+String(val).replace(/</g,'&lt;')+'</textarea></div>'; }
  function fill(host,b){
    var rows=S.map(function(s){ return card(s.k,s.label,b[s.k]||''); }).join('');
    if(b._unsorted) rows+='<div style="background:#141b3d;border:1px dashed rgba(217,119,6,.5);border-radius:12px;padding:12px 14px;margin-bottom:10px"><b style="color:#ffcf8f">Unsorted</b><div style="font-size:12px;color:#9fb0d8;margin:2px 0 6px">Could not confidently place these - move into a section above.</div><textarea style="width:100%;min-height:46px;background:#0f1530;'+CS+';resize:vertical">'+String(b._unsorted).replace(/</g,'&lt;')+'</textarea></div>';
    host.querySelector('#emrBody').innerHTML=rows;
    var any=S.some(function(s){return b[s.k];})||!!b._unsorted;
    host.querySelector('#emrHint').innerHTML=any?'Organized from the current note. Edit anything, then confirm each section. Nothing is placed into the note until you confirm it.':'No sections detected yet - generate the note first, or type into any section. Try AI sort.';
    count(host);
  }
  function render(){
    var o=document.getElementById('emrPanel'); if(o) o.remove();
    var host=document.createElement('div'); host.id='emrPanel';
    host.style.cssText='position:fixed;inset:0;z-index:100000;background:rgba(6,10,24,.72);display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px';
    var B='border:1px solid rgba(120,140,220,.3);border-radius:10px;cursor:pointer';
    host.innerHTML='<div style="max-width:760px;width:100%;background:#0b1020;border:1px solid rgba(120,140,220,.3);border-radius:16px;padding:18px;box-shadow:0 20px 60px rgba(0,0,0,.5);margin:0 auto"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px"><div style="font-size:17px;font-weight:800;color:#e8ecff">EMR sections - review &amp; confirm</div><div style="display:flex;gap:8px"><button id="emrAi" style="background:#7c3aed;border:none;color:#fff;'+B+';padding:6px 12px;font-weight:700">AI sort</button><button id="emrClose" style="background:transparent;color:#e8ecff;'+B+';padding:6px 10px">Close</button></div></div><div id="emrHint" style="font-size:12.5px;color:#9fb0d8;margin-bottom:12px"></div><div id="emrBody"></div><div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap"><span id="emrCount" style="font-size:13px;color:#9fb0d8"></span><div style="display:flex;gap:10px;flex-wrap:wrap"><button id="emrAll" style="background:transparent;color:#e8ecff;'+B+';padding:10px 14px;font-weight:700">Confirm all</button><button id="emrIns" style="background:#16a34a;border:none;color:#fff;border-radius:10px;cursor:pointer;padding:10px 16px;font-weight:800">Insert confirmed into note</button></div></div><div style="font-size:11.5px;color:#9fb0d8;margin-top:8px">MLS never submits medical actions on its own. Review, confirm, then send. Per-field placement into athenaOne is the next extension step.</div></div>';
    document.body.appendChild(host);
    fill(host,organize(noteText()));
    host.addEventListener('change',function(e){ var k=e.target.getAttribute&&e.target.getAttribute('data-k'); if(k){ conf[k]=e.target.checked; count(host); } });
    host.querySelector('#emrClose').onclick=function(){ host.remove(); };
    host.addEventListener('click',function(e){ if(e.target===host) host.remove(); });
    host.querySelector('#emrAll').onclick=function(){ S.forEach(function(s){ conf[s.k]=true; }); host.querySelectorAll('input[data-k]').forEach(function(c){ c.checked=true; }); count(host); };
    host.querySelector('#emrAi').onclick=function(){
      var btn=this;
      if(typeof window.tplAiSplit!=='function'||(typeof window.hasAI==='function'&&!window.hasAI())){ btn.textContent='AI unavailable'; setTimeout(function(){btn.textContent='AI sort';},1600); return; }
      btn.textContent='Sorting...'; btn.disabled=true;
      var done=function(ok){ btn.disabled=false; btn.textContent=ok?'AI sorted':'AI n/a - heuristic'; setTimeout(function(){btn.textContent='AI sort';},1700); };
      try{ var r=window.tplAiSplit(noteText()); var p=(r&&typeof r.then==='function')?r:Promise.resolve(r);
        Promise.race([p,new Promise(function(_,x){setTimeout(function(){x(0);},25000);})]).then(function(v){ var m=mapAi(v); if(m){ conf={}; fill(host,m); done(true); } else done(false); }).catch(function(){ done(false); });
      }catch(e){ done(false); }
    };
    host.querySelector('#emrIns').onclick=function(){
      var parts=[]; S.forEach(function(s){ if(!conf[s.k]) return; var ta=host.querySelector('textarea[data-t="'+s.k+'"]'); var v=ta?ta.value.trim():''; parts.push(s.label.toUpperCase()+':\n'+(v||'(none)')); });
      if(!parts.length){ alert('Confirm at least one section first.'); return; }
      var out=parts.join('\n\n'), note=document.getElementById('mls-note');
      if(note){ if(note.value!=null){ note.value=out; note.dispatchEvent(new Event('input',{bubbles:true})); } else note.textContent=out; }
      var b=host.querySelector('#emrIns'); b.textContent='Inserted'; setTimeout(function(){ b.textContent='Insert confirmed into note'; },1400);
    };
  }
  function addBtn(){ if(document.getElementById('emrBtn')) return; var b=document.createElement('button'); b.id='emrBtn'; b.type='button'; b.textContent='EMR sections'; b.style.cssText='position:fixed;left:12px;bottom:96px;z-index:99998;background:#3452d6;border:none;color:#fff;border-radius:11px;padding:10px 14px;font-weight:800;font-size:13px;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35)'; b.onclick=function(){ conf={}; render(); }; document.body.appendChild(b); }
  var n=0,iv=setInterval(function(){ addBtn(); if(++n>20) clearInterval(iv); },800);
  if(document.readyState!=='loading') addBtn();
})();


/* feat_easy_realtabs — MLS Easy as REAL tabs: each tab shows one stage at a time. Patient · Capture ·
   Note · Sign. Clicking Capture/Note/Sign shows ONLY that stage's box and hides the other two;
   Patient shows everything. Supersedes the spotlight-only bar (claims the shared guard). SAFETY (this
   is a live medical tool — an earlier hide-based version broke it): it hides ONLY the three specific
   box cards anchored on #mls-tx / #mls-note / the EMR card, and ONLY after HARD VALIDATION that they
   are three distinct, sized, sibling cards that are NOT the panel/body and don't contain each other.
   If validation fails (e.g. boxes not rendered yet), the tab safely falls back to scroll+spotlight and
   hides NOTHING. It never walks parent chains, never touches #phoneMicPage/#mlsEasyPanel/body, and
   restores only what it hid. Reversible; a reload restores the app. */
(function(){
  "use strict";
  if(window.__mlsEasyWizard) return;
  window.__mlsEasyWizard=true; window.__mlsEasyTunnel=true; window.__mlsEasyTabsSafe=true; window.__mlsEasyRealTabs=true;
  function byText(txt){ var e=document.querySelectorAll('h1,h2,h3,h4,div,span,section,label,button'); for(var i=0;i<e.length;i++){var t=(e[i].textContent||'').replace(/\s+/g,' ').trim(); if(t.indexOf(txt)===0&&t.length<80&&e[i].children.length<=4){ return e[i]; } } return null; }
  // walk up from a content element to the nearest "card" that is a sibling in a multi-card row
  function cardFromContent(el){ if(!el) return null; var c=el; for(var i=0;i<7&&c&&c.parentElement;i++){ var p=c.parentElement; if(p===document.body) break; if(p.children.length>=3 && p.children.length<=6){ return c; } c=p; } return el.closest('[class*=card],section')||el.parentElement; }
  function boxes(){
    var tx=document.getElementById('mls-tx'), note=document.getElementById('mls-note');
    var cap=cardFromContent(tx), nt=cardFromContent(note);
    var emr=null;
    if(cap&&nt&&cap.parentElement===nt.parentElement){ // third sibling that is neither cap nor nt
      var sibs=[].slice.call(cap.parentElement.children);
      emr=sibs.filter(function(s){ return s!==cap&&s!==nt; })[0]||null;
    }
    if(!emr){ var e=byText('EMR')||byText('Insert into chart'); if(e) emr=cardFromContent(e); }
    return {cap:cap, note:nt, emr:emr};
  }
  function sized(el){ if(!el) return false; var r=el.getBoundingClientRect(); return r.width>=150 && r.height>=40; }
  function validate(b){
    var cap=b.cap, nt=b.note, emr=b.emr, body=document.body, panel=document.getElementById('mlsEasyPanel');
    if(!cap||!nt||!emr) return false;
    if(cap===nt||nt===emr||cap===emr) return false;
    if([cap,nt,emr].indexOf(body)>=0 || [cap,nt,emr].indexOf(panel)>=0) return false;
    if(cap.contains(nt)||cap.contains(emr)||nt.contains(emr)||nt.contains(cap)||emr.contains(cap)||emr.contains(nt)) return false;
    if(cap.contains(panel)||nt.contains(panel)||emr.contains(panel)) return false; // must not wrap the panel
    if(!(sized(cap)&&sized(nt)&&sized(emr))) return false;
    if(!(cap.parentElement===nt.parentElement && nt.parentElement===emr.parentElement)) return false;
    return true;
  }
  var HIDDEN=[]; // track exactly what we hid, to restore precisely
  function restoreHidden(){ HIDDEN.forEach(function(el){ try{ if(el.getAttribute('data-mls-hid')==='1'){ el.style.display=''; el.removeAttribute('data-mls-hid'); } }catch(e){} }); HIDDEN=[]; }
  function hideOnly(showEl, allEls){
    restoreHidden();
    allEls.forEach(function(el){ if(el&&el!==showEl){ try{ el.setAttribute('data-mls-hid','1'); el.style.display='none'; HIDDEN.push(el); }catch(e){} } });
    if(showEl){ try{ showEl.style.display=''; }catch(e){} }
  }
  var TABS=[
    { label:'1 · Patient', hint:'Confirm the patient (use the picker), then hit ● Record.' },
    { label:'2 · Capture', hint:'Record or paste the visit. When you stop, the note writes itself.' },
    { label:'3 · Note',    hint:'Review the AI note — edit anything before it goes in the chart.' },
    { label:'4 · Sign',    hint:'Push the note + EMR fields into athena, then sign.' }
  ];
  function stepBtns(){ var b=document.querySelectorAll('button.mlsstp'); return b.length>=4? Array.prototype.slice.call(b).slice(0,4):null; }
  var cur=0;
  function spot(el){ document.querySelectorAll('.mls-rt-spot').forEach(function(e){e.classList.remove('mls-rt-spot');}); if(el){ el.classList.add('mls-rt-spot'); try{ el.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} } }
  function go(i){
    cur=Math.max(0,Math.min(3,i));
    var b=boxes(); var ok=validate(b); var all=[b.cap,b.note,b.emr];
    var target=(cur===1?b.cap:cur===2?b.note:cur===3?b.emr:null);
    if(cur===0){ restoreHidden(); spot(document.getElementById('mlsEasyPanel')); }
    else if(ok){ hideOnly(target, all); spot(target); }
    else { restoreHidden(); spot(target); } // safe fallback: show all, just spotlight
    var pills=document.querySelectorAll('.mls-rt-pill');
    Array.prototype.forEach.call(pills,function(p,idx){ p.style.background=(idx===cur?'#2563eb':'transparent'); p.style.color=(idx===cur?'#fff':'inherit'); p.style.fontWeight=(idx===cur?'800':'600'); });
    var h=document.getElementById('mls-rt-hint'); if(h) h.textContent='Step '+(cur+1)+' of 4 — '+TABS[cur].hint+(cur>0&&!ok?' (showing all — boxes not ready to isolate yet)':'');
    var nx=document.getElementById('mls-rt-next'); if(nx) nx.textContent=(cur<3?('Next: '+TABS[cur+1].label.split('· ')[1]+' →'):'Done ✓');
    var sb=stepBtns(); if(sb){ for(var c=0;c<sb.length;c++) sb[c].style.opacity=(c===cur?'1':'.6'); }
  }
  function build(){
    if(document.getElementById('mls-rt-bar')) return true;
    var btns=stepBtns(); if(!btns) return false;
    var container=btns[0].parentElement; if(!container) return false;
    ['mls-tnl-bar','mls-wiz-bar','mls-tab-bar'].forEach(function(id){ var o=document.getElementById(id); if(o) o.remove(); });
    for(var c=0;c<btns.length;c++){ (function(ci){ var b=btns[ci]; b.style.cursor='pointer'; if(!b.__rt){ b.__rt=1; b.addEventListener('click',function(){ go(ci); }); } })(c); }
    var bar=document.createElement('div'); bar.id='mls-rt-bar';
    bar.style.cssText='margin:10px 4px 4px;padding:10px 12px;border-radius:14px;background:rgba(96,120,224,.10);border:1px solid rgba(96,120,224,.30);font:13px system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit';
    var pillRow=document.createElement('div'); pillRow.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    TABS.forEach(function(t,idx){ var p=document.createElement('button'); p.type='button'; p.className='mls-rt-pill'; p.textContent=t.label;
      p.style.cssText='padding:6px 12px;border-radius:999px;border:1px solid rgba(96,120,224,.4);background:transparent;color:inherit;font:600 12px system-ui;cursor:pointer;transition:all .15s';
      p.addEventListener('click',function(){ go(idx); }); pillRow.appendChild(p); });
    var ctrl=document.createElement('div'); ctrl.style.cssText='display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    var hint=document.createElement('span'); hint.id='mls-rt-hint'; hint.style.cssText='flex:1;min-width:200px;font-weight:600;opacity:.92';
    var showAll=document.createElement('button'); showAll.type='button'; showAll.textContent='▤ Show all'; showAll.title='Show every stage at once'; showAll.style.cssText='padding:7px 12px;border-radius:10px;border:1px solid rgba(96,120,224,.45);background:transparent;color:inherit;font:700 12px system-ui;cursor:pointer'; showAll.addEventListener('click',function(){ go(0); });
    var back=document.createElement('button'); back.type='button'; back.textContent='← Back'; back.style.cssText='padding:7px 12px;border-radius:10px;border:1px solid rgba(96,120,224,.45);background:transparent;color:inherit;font:700 12px system-ui;cursor:pointer'; back.addEventListener('click',function(){ go(cur-1); });
    var next=document.createElement('button'); next.type='button'; next.id='mls-rt-next'; next.style.cssText='padding:7px 14px;border-radius:10px;border:none;background:#2563eb;color:#fff;font:800 12px system-ui;cursor:pointer'; next.addEventListener('click',function(){ if(cur<3) go(cur+1); else go(3); });
    ctrl.appendChild(hint); ctrl.appendChild(showAll); ctrl.appendChild(back); ctrl.appendChild(next);
    bar.appendChild(pillRow); bar.appendChild(ctrl);
    (container.parentNode||container).insertBefore(bar, container.nextSibling);
    if(!document.getElementById('mls-rt-css')){ var st=document.createElement('style'); st.id='mls-rt-css'; st.textContent='.mls-rt-spot{outline:3px solid #2563eb!important;outline-offset:3px;border-radius:14px;box-shadow:0 0 0 6px rgba(37,99,235,.12)!important}'; document.head.appendChild(st); }
    go(0);
    return true;
  }
  if(!build()){ var n=0, iv=setInterval(function(){ if(build()||++n>40) clearInterval(iv); }, 1000); }
})();


/* feat_smart_ask — a smart, natural-language analytics layer over ALL pulled provider/patient data
   (window._calAppts). Exposes window.mlsAsk(question) -> {answer, detail} so the MLS Copilot, the
   study maker, and this "Ask your data" box can all answer questions like:
     • "how many patients did I have this month?"   • "how many did Sarah have?"
     • "what was my most common procedure?"          • "who saw the most patients this week?"
   READ-ONLY: it only reads window._calAppts and appends its OWN button + panel to <body>. It never
   touches, hides, or reparents any app element (lesson learned). Guarded + reversible. */
(function(){
  "use strict";
  if(window.__mlsSmartAsk) return; window.__mlsSmartAsk=true;
  function pool(){ return window._calAppts||[]; }
  function meName(){ try{ if(typeof window.getProviderName==='function'){ var n=window.getProviderName(); if(n) return n; } }catch(e){} return 'Matthew Schaeffer, MD'; }
  function pretty(p){ if(!p) return 'Unassigned'; if(p.indexOf('_')<0) return p; var m=p.split('_'); var cred=m.length>2?m.slice(2).join(' ').replace(/_/g,' '):''; return m[1]+' '+m[0]+(cred?', '+cred:''); }
  function provKey(r){ return r.provider||r.doctor_user_id||'Unassigned'; }
  function reasonText(r){ return (r.reason||r.appt_type||r.type||'').trim(); }
  function providers(){ var s={}; pool().forEach(function(r){ var k=provKey(r); s[k]=(s[k]||0)+1; }); return Object.keys(s); }
  function resolveProvider(q){
    q=' '+q.toLowerCase()+' ';
    if(/\b(i|me|my|mine|myself)\b/.test(q)){ var me=meName().toLowerCase(); var parts=me.replace(/,.*/,'').split(/\s+/); return {label:meName(), match:function(r){ var pp=pretty(provKey(r)).toLowerCase(); return parts.every(function(t){ return t.length<2||pp.indexOf(t)>=0; }); }}; }
    if(/\b(everyone|all|practice|the whole|entire|total|combined)\b/.test(q)) return {label:'the whole practice', match:function(){ return true; }};
    var provs=providers(); var best=null;
    provs.forEach(function(k){ var pp=pretty(k).toLowerCase().replace(/,.*/,''); var toks=pp.split(/\s+/).filter(function(t){return t.length>=3;}); var hit=toks.some(function(t){ return new RegExp('\\b'+t.replace(/[^a-z]/g,'')+'\\b').test(q); }); if(hit){ best=k; } });
    if(best) return {label:pretty(best), match:function(r){ return provKey(r)===best; }};
    return null;
  }
  function resolveRange(q){
    q=q.toLowerCase(); var now=new Date(); var y=now.getFullYear(), m=now.getMonth();
    function ym(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2); }
    if(/last month/.test(q)){ var lm=new Date(y,m-1,1); return {label:'last month', in:function(dt){ return dt.slice(0,7)===ym(lm); }}; }
    if(/this month|month/.test(q)){ return {label:'this month', in:function(dt){ return dt.slice(0,7)===ym(now); }}; }
    if(/this week|week/.test(q)){ var day=now.getDay(); var start=new Date(y,m,now.getDate()-day); var s=start.toISOString().slice(0,10); var e=new Date(start.getTime()+6*864e5).toISOString().slice(0,10); return {label:'this week', in:function(dt){ return dt>=s&&dt<=e; }}; }
    if(/today/.test(q)){ var t=now.toISOString().slice(0,10); return {label:'today', in:function(dt){ return dt===t; }}; }
    if(/this year|year/.test(q)){ return {label:'this year', in:function(dt){ return dt.slice(0,4)===String(y); }}; }
    return {label:'all pulled dates', in:function(){ return true; }};
  }
  function filtered(q){
    var prov=resolveProvider(q), range=resolveRange(q);
    var rows=pool().filter(function(r){ if(!range.in(r.appt_date||'')) return false; if(prov&&!prov.match(r)) return false; return true; });
    return {rows:rows, prov:prov, range:range};
  }
  function uniquePatients(rows){ var s={}; rows.forEach(function(r){ var k=r.patient_external_id||r.name; if(k) s[k]=1; }); return Object.keys(s).length; }
  function topReason(rows){ var f={}; rows.forEach(function(r){ var t=reasonText(r); if(t) f[t]=(f[t]||0)+1; }); var best='',bc=0; Object.keys(f).forEach(function(k){ if(f[k]>bc){ bc=f[k]; best=k; } }); return {reason:best, count:bc}; }
  function money(n){ return '$'+(n||0).toLocaleString(); }
  function ask(q){
    q=(q||'').trim(); if(!q) return {answer:'Ask me something like “how many patients did I have this month?”'};
    var ql=q.toLowerCase();
    var F=filtered(q); var rows=F.rows; var who=F.prov?F.prov.label:'the whole practice'; var when=F.range.label;
    if(/most common|most frequent|top|commonest/.test(ql) && /procedure|reason|visit|type|do/.test(ql)){
      var tr=topReason(rows);
      if(!tr.reason) return {answer:'No procedure/reason text is recorded on those visits yet — pull more days or check the visit-reason field.'};
      return {answer:'Most common for '+who+' ('+when+'): “'+tr.reason+'” — '+tr.count+' visit'+(tr.count>1?'s':'')+'.'};
    }
    if(/who (saw|had|has).*(most|busiest)|busiest|most patients/.test(ql)){
      var byP={}; pool().filter(function(r){ return F.range.in(r.appt_date||''); }).forEach(function(r){ var k=provKey(r); (byP[k]=byP[k]||{}); var pid=r.patient_external_id||r.name; if(pid) byP[k][pid]=1; });
      var bestP='',bn=0; Object.keys(byP).forEach(function(k){ var n=Object.keys(byP[k]).length; if(n>bn){ bn=n; bestP=k; } });
      if(!bestP) return {answer:'No visits found for '+when+'.'};
      return {answer:pretty(bestP)+' saw the most patients '+when+' — '+bn+'.'};
    }
    if(/revenue|money|bring in|billing|\$/.test(ql)){
      var est=rows.length*175;
      return {answer:'Estimated revenue for '+who+' ('+when+'): '+money(est)+' — '+rows.length+' visits × ~$175 (estimate; connect billing for exact).'};
    }
    if(/how many|number of|count|how much/.test(ql) && /visit|appointment|appt|saw|see/.test(ql)){
      return {answer:who.charAt(0).toUpperCase()+who.slice(1)+' had '+rows.length+' visit'+(rows.length===1?'':'s')+' '+when+'.'};
    }
    if(/how many|number of|count/.test(ql) && /patient/.test(ql)){
      var up=uniquePatients(rows);
      return {answer:who.charAt(0).toUpperCase()+who.slice(1)+' had '+up+' patient'+(up===1?'':'s')+' '+when+' ('+rows.length+' visit'+(rows.length===1?'':'s')+').'};
    }
    var upd=uniquePatients(rows); var trd=topReason(rows);
    return {answer:who.charAt(0).toUpperCase()+who.slice(1)+' — '+when+': '+upd+' patients across '+rows.length+' visits'+(trd.reason?('; most common: “'+trd.reason+'”'):'')+'.'};
  }
  window.mlsAsk=ask;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  var CHIPS=['How many patients did I have this month?','What was my most common procedure?','Who saw the most patients this week?','How many visits this month?'];
  function open(){
    if(document.getElementById('mls-ask-ov')) return;
    var ov=document.createElement('div'); ov.id='mls-ask-ov';
    ov.style.cssText='position:fixed;left:16px;bottom:150px;z-index:2147483300;width:min(420px,92vw);background:#0f1530;border:1px solid rgba(120,140,220,.35);border-radius:16px;box-shadow:0 24px 60px rgba(0,0,0,.5);color:#e8ecff;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden';
    ov.innerHTML='<div style="display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid rgba(120,140,220,.2);background:linear-gradient(90deg,#151d44,#0f1530)"><span style="font-size:16px">📊</span><b style="flex:1;font-size:14px">Ask your data</b><button id="mls-ask-x" style="background:transparent;border:1px solid rgba(200,210,255,.3);color:inherit;border-radius:8px;padding:4px 9px;cursor:pointer;font-weight:700">✕</button></div>'
      +'<div style="padding:12px 14px"><div style="display:flex;gap:8px"><input id="mls-ask-q" placeholder="e.g. how many patients did Sarah have this month?" style="flex:1;background:#141b3d;border:1px solid rgba(120,140,220,.35);border-radius:10px;color:#e8ecff;padding:9px 11px;font-size:13px"><button id="mls-ask-go" style="background:#2563eb;border:none;color:#fff;border-radius:10px;padding:9px 14px;font-weight:800;cursor:pointer">Ask</button></div>'
      +'<div id="mls-ask-chips" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">'+CHIPS.map(function(c,i){return '<button class="mls-ask-chip" data-i="'+i+'" style="background:transparent;border:1px solid rgba(120,140,220,.3);color:inherit;border-radius:999px;padding:5px 10px;font-size:11px;cursor:pointer;opacity:.85">'+esc(c)+'</button>';}).join('')+'</div>'
      +'<div id="mls-ask-a" style="margin-top:12px;font-size:14px;line-height:1.5;min-height:20px"></div>'
      +'<div style="margin-top:8px;font-size:11px;opacity:.5">Reads the patients you’ve pulled ('+pool().length+' appts loaded). Ask about you, another provider, or the whole practice.</div></div>';
    document.body.appendChild(ov);
    var q=document.getElementById('mls-ask-q');
    function run(){ var r=ask(q.value); document.getElementById('mls-ask-a').innerHTML='<div style="background:#141b3d;border-left:3px solid #2563eb;border-radius:8px;padding:10px 12px">'+esc(r.answer)+'</div>'; }
    document.getElementById('mls-ask-go').onclick=run;
    q.addEventListener('keydown',function(e){ if(e.key==='Enter') run(); });
    document.getElementById('mls-ask-x').onclick=function(){ ov.remove(); };
    Array.prototype.forEach.call(ov.querySelectorAll('.mls-ask-chip'),function(b){ b.onclick=function(){ q.value=CHIPS[+b.getAttribute('data-i')]; run(); }; });
    q.focus();
  }
  function addBtn(){
    if(document.getElementById('mls-ask-btn')) return;
    var b=document.createElement('button'); b.id='mls-ask-btn'; b.type='button'; b.textContent='📊 Ask your data';
    b.title='Ask questions about your patients and providers';
    b.style.cssText='position:fixed;left:16px;bottom:108px;z-index:2147482000;background:linear-gradient(90deg,#6d28d9,#7c3aed);color:#fff;border:none;border-radius:999px;padding:11px 18px;font:800 13px system-ui;cursor:pointer;box-shadow:0 8px 24px rgba(124,58,237,.4)';
    b.onclick=open; document.body.appendChild(b);
  }
  if(document.body) addBtn();
  var n=0, iv=setInterval(function(){ addBtn(); if(document.getElementById('mls-ask-btn')||++n>30) clearInterval(iv); }, 1000);
})();


/* feat_phonemic_recover — hotfix: the app's full-screen #phoneMicPage pairing overlay (fixed,
   z9999) can get stuck showing over the whole app with only an empty pairing code and no way to
   dismiss, which makes the program look gone. If it is covering the app with NO active numeric
   pairing code, tuck it away so the app shows. Runs a few times as the app settles, then stops so it
   never fights a real phone-pairing the user starts. Own guard; only ever touches #phoneMicPage. */
(function(){
  "use strict";
  if(window.__mlsPmRecover) return; window.__mlsPmRecover=true;
  function fix(){ try{ var pm=document.getElementById('phoneMicPage'); if(!pm) return; var cs=getComputedStyle(pm); if(cs.position!=='fixed'||cs.display==='none') return; var r=pm.getBoundingClientRect(); if(r.width<window.innerWidth*0.7||r.height<window.innerHeight*0.6) return; var code=(pm.textContent||'').replace(/[^0-9]/g,''); if(!code){ pm.style.display='none'; } }catch(e){} }
  var n=0, iv=setInterval(function(){ fix(); if(++n>10) clearInterval(iv); }, 500);
  fix();
})();

/* feat_easy_tabs2 — SAFE MLS Easy tabs (hotfix). Claims the wizard/tunnel guards FIRST so BOTH the
   old destructive "tunnel" AND the earlier tabs build (whose over-eager un-hide accidentally revealed
   the full-screen #phoneMicPage pairing overlay and covered the app) are disabled. This version NEVER
   hides or un-hides app sections — it only spotlights + scrolls to a stage. It also makes sure the
   #phoneMicPage overlay is not left covering the app if nothing is actively pairing. Four tabs
   (Patient · Capture · Note · Sign); clicking a tab (or Next) scrolls to and outlines that stage. */
(function(){
  "use strict";
  if(window.__mlsEasyWizard) return;
  window.__mlsEasyWizard=true; window.__mlsEasyTunnel=true; window.__mlsEasyTabsSafe=true;
  var TABS=[
    { label:'1 · Patient', find:function(){ return document.getElementById('mlsEasyPanel')||heading('Capture the visit'); }, hint:'Confirm the patient (use the picker), then hit ● Record.' },
    { label:'2 · Capture', find:function(){ return heading('Capture the visit')||document.getElementById('mls-tx'); }, hint:'Record or paste the visit. When you stop, the note writes itself.' },
    { label:'3 · Note',    find:function(){ return heading('Clinical note')||document.getElementById('mls-note'); }, hint:'Review the AI note — edit anything before it goes in the chart.' },
    { label:'4 · Sign',    find:function(){ return heading('EMR')||textEl(['Insert into chart','⤵ Insert into chart']); }, hint:'Push the note + EMR fields into athena, then sign.' }
  ];
  function heading(txt){ var e=document.querySelectorAll('h1,h2,h3,h4,div,span,section,label'); for(var i=0;i<e.length;i++){var t=(e[i].textContent||'').replace(/\s+/g,' ').trim(); if(t.indexOf(txt)===0&&t.length<80&&e[i].children.length<=4){ return e[i].closest('[class*=card],section,div')||e[i]; } } return null; }
  function textEl(arr){ var e=document.querySelectorAll('div,span,button,section,label'); for(var i=0;i<e.length;i++){var t=(e[i].textContent||'').replace(/\s+/g,' ').trim(); for(var j=0;j<arr.length;j++){ if(t.indexOf(arr[j])===0&&t.length<80){ return e[i].closest('[class*=card],section,div')||e[i]; } } } return null; }
  function stepBtns(){ var b=document.querySelectorAll('button.mlsstp'); return b.length>=4? Array.prototype.slice.call(b).slice(0,4):null; }
  var cur=0;
  function spot(el){ if(!el) return; document.querySelectorAll('.mls-tab-spot').forEach(function(e){e.classList.remove('mls-tab-spot');}); el.classList.add('mls-tab-spot'); try{ el.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} }
  function go(i){
    cur=Math.max(0,Math.min(TABS.length-1,i));
    var t=null; try{ t=TABS[cur].find(); }catch(e){}
    spot(t);
    var pills=document.querySelectorAll('.mls-tab-pill');
    Array.prototype.forEach.call(pills,function(p,idx){ p.style.background=(idx===cur?'#2563eb':'transparent'); p.style.color=(idx===cur?'#fff':'inherit'); p.style.fontWeight=(idx===cur?'800':'600'); });
    var h=document.getElementById('mls-tab-hint'); if(h) h.textContent='Step '+(cur+1)+' of 4 — '+TABS[cur].hint;
    var nx=document.getElementById('mls-tab-next'); if(nx) nx.textContent=(cur<3?('Next: '+TABS[cur+1].label.split('· ')[1]+' →'):'Done ✓');
    var b=stepBtns(); if(b){ for(var c=0;c<b.length;c++) b[c].style.opacity=(c===cur?'1':'.6'); }
  }
  function build(){
    if(document.getElementById('mls-tab-bar')) return true;
    var btns=stepBtns(); if(!btns) return false;
    var container=btns[0].parentElement; if(!container) return false;
    var oldT=document.getElementById('mls-tnl-bar'); if(oldT) oldT.remove();
    var oldW=document.getElementById('mls-wiz-bar'); if(oldW) oldW.remove();
    for(var c=0;c<btns.length;c++){ (function(ci){ var b=btns[ci]; b.style.cursor='pointer'; if(!b.__tab){ b.__tab=1; b.addEventListener('click',function(){ go(ci); }); } })(c); }
    var bar=document.createElement('div'); bar.id='mls-tab-bar';
    bar.style.cssText='margin:10px 4px 4px;padding:10px 12px;border-radius:14px;background:rgba(96,120,224,.10);border:1px solid rgba(96,120,224,.30);font:13px system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit';
    var pillRow=document.createElement('div'); pillRow.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    TABS.forEach(function(t,idx){ var p=document.createElement('button'); p.type='button'; p.className='mls-tab-pill'; p.textContent=t.label;
      p.style.cssText='padding:6px 12px;border-radius:999px;border:1px solid rgba(96,120,224,.4);background:transparent;color:inherit;font:600 12px system-ui;cursor:pointer;transition:all .15s';
      p.addEventListener('click',function(){ go(idx); }); pillRow.appendChild(p); });
    var ctrl=document.createElement('div'); ctrl.style.cssText='display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    var hint=document.createElement('span'); hint.id='mls-tab-hint'; hint.style.cssText='flex:1;min-width:200px;font-weight:600;opacity:.92';
    var back=document.createElement('button'); back.type='button'; back.textContent='← Back'; back.style.cssText='padding:7px 12px;border-radius:10px;border:1px solid rgba(96,120,224,.45);background:transparent;color:inherit;font:700 12px system-ui;cursor:pointer'; back.addEventListener('click',function(){ go(cur-1); });
    var next=document.createElement('button'); next.type='button'; next.id='mls-tab-next'; next.style.cssText='padding:7px 14px;border-radius:10px;border:none;background:#2563eb;color:#fff;font:800 12px system-ui;cursor:pointer'; next.addEventListener('click',function(){ if(cur<3) go(cur+1); else go(3); });
    ctrl.appendChild(hint); ctrl.appendChild(back); ctrl.appendChild(next);
    bar.appendChild(pillRow); bar.appendChild(ctrl);
    (container.parentNode||container).insertBefore(bar, container.nextSibling);
    if(!document.getElementById('mls-tab-css')){ var st=document.createElement('style'); st.id='mls-tab-css'; st.textContent='.mls-tab-spot{outline:3px solid #2563eb!important;outline-offset:3px;border-radius:14px;box-shadow:0 0 0 6px rgba(37,99,235,.12)!important}'; document.head.appendChild(st); }
    go(0);
    return true;
  }
  if(!build()){ var n=0, iv=setInterval(function(){ if(build()||++n>40) clearInterval(iv); }, 1000); }
})();


/* feat_easy_tabs — SAFE replacement for the MLS Easy guided bar. Claims the wizard/tunnel guards
   FIRST so the older destructive "tunnel" (which could set display:none on app sections and hide the
   whole program) NEVER runs. This version ONLY spotlights + scrolls to a stage — it never hides
   anything, so it cannot make the app disappear. Four tabs (Patient · Capture · Note · Sign) across
   the top of the step tracker; clicking a tab (or Next) scrolls to and outlines that stage's box.
   Also defensively un-hides anything a previous tunnel left hidden. Additive + reversible. */
(function(){
  "use strict";
  if(window.__mlsEasyWizard) return;
  window.__mlsEasyWizard=true; window.__mlsEasyTunnel=true; window.__mlsEasyTabsSafe=true;
  // DEFENSIVE: undo any leftover hides from a prior destructive tunnel (spotlight targets only).
  try{ ['mlsEasyPanel','mls-tx','mls-note','phoneRecBtn'].forEach(function(id){ var e=document.getElementById(id); while(e){ if(e.style&&e.style.display==='none') e.style.display=''; e=e.parentElement; } }); }catch(e){}
  var TABS=[
    { label:'1 · Patient', find:function(){ return document.getElementById('mlsEasyPanel')||heading('Capture the visit'); }, hint:'Confirm the patient (use the picker), then hit ● Record.' },
    { label:'2 · Capture', find:function(){ return heading('Capture the visit')||document.getElementById('mls-tx'); }, hint:'Record or paste the visit. When you stop, the note writes itself.' },
    { label:'3 · Note',    find:function(){ return heading('Clinical note')||document.getElementById('mls-note'); }, hint:'Review the AI note — edit anything before it goes in the chart.' },
    { label:'4 · Sign',    find:function(){ return heading('EMR')||textEl(['Insert into chart','⤵ Insert into chart']); }, hint:'Push the note + EMR fields into athena, then sign.' }
  ];
  function heading(txt){ var e=document.querySelectorAll('h1,h2,h3,h4,div,span,section,label'); for(var i=0;i<e.length;i++){var t=(e[i].textContent||'').replace(/\s+/g,' ').trim(); if(t.indexOf(txt)===0&&t.length<80&&e[i].children.length<=4){ return e[i].closest('[class*=card],section,div')||e[i]; } } return null; }
  function textEl(arr){ var e=document.querySelectorAll('div,span,button,section,label'); for(var i=0;i<e.length;i++){var t=(e[i].textContent||'').replace(/\s+/g,' ').trim(); for(var j=0;j<arr.length;j++){ if(t.indexOf(arr[j])===0&&t.length<80){ return e[i].closest('[class*=card],section,div')||e[i]; } } } return null; }
  function stepBtns(){ var b=document.querySelectorAll('button.mlsstp'); return b.length>=4? Array.prototype.slice.call(b).slice(0,4):null; }
  var cur=0;
  function spot(el){ if(!el) return; document.querySelectorAll('.mls-tab-spot').forEach(function(e){e.classList.remove('mls-tab-spot');}); el.classList.add('mls-tab-spot'); try{ el.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} }
  function go(i){
    cur=Math.max(0,Math.min(TABS.length-1,i));
    var t=null; try{ t=TABS[cur].find(); }catch(e){}
    spot(t);
    var pills=document.querySelectorAll('.mls-tab-pill');
    Array.prototype.forEach.call(pills,function(p,idx){ p.style.background=(idx===cur?'#2563eb':'transparent'); p.style.color=(idx===cur?'#fff':'inherit'); p.style.fontWeight=(idx===cur?'800':'600'); });
    var h=document.getElementById('mls-tab-hint'); if(h) h.textContent='Step '+(cur+1)+' of 4 — '+TABS[cur].hint;
    var nx=document.getElementById('mls-tab-next'); if(nx) nx.textContent=(cur<3?('Next: '+TABS[cur+1].label.split('· ')[1]+' →'):'Done ✓');
    var b=stepBtns(); if(b){ for(var c=0;c<b.length;c++) b[c].style.opacity=(c===cur?'1':'.6'); }
  }
  function build(){
    if(document.getElementById('mls-tab-bar')) return true;
    var btns=stepBtns(); if(!btns) return false;
    var container=btns[0].parentElement; if(!container) return false;
    var oldT=document.getElementById('mls-tnl-bar'); if(oldT) oldT.remove();
    var oldW=document.getElementById('mls-wiz-bar'); if(oldW) oldW.remove();
    for(var c=0;c<btns.length;c++){ (function(ci){ var b=btns[ci]; b.style.cursor='pointer'; b.style.display=''; if(!b.__tab){ b.__tab=1; b.addEventListener('click',function(){ go(ci); }); } })(c); }
    var bar=document.createElement('div'); bar.id='mls-tab-bar';
    bar.style.cssText='margin:10px 4px 4px;padding:10px 12px;border-radius:14px;background:rgba(96,120,224,.10);border:1px solid rgba(96,120,224,.30);font:13px system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit';
    var pillRow=document.createElement('div'); pillRow.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    TABS.forEach(function(t,idx){ var p=document.createElement('button'); p.type='button'; p.className='mls-tab-pill'; p.textContent=t.label;
      p.style.cssText='padding:6px 12px;border-radius:999px;border:1px solid rgba(96,120,224,.4);background:transparent;color:inherit;font:600 12px system-ui;cursor:pointer;transition:all .15s';
      p.addEventListener('click',function(){ go(idx); }); pillRow.appendChild(p); });
    var ctrl=document.createElement('div'); ctrl.style.cssText='display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    var hint=document.createElement('span'); hint.id='mls-tab-hint'; hint.style.cssText='flex:1;min-width:200px;font-weight:600;opacity:.92';
    var back=document.createElement('button'); back.type='button'; back.textContent='← Back'; back.style.cssText='padding:7px 12px;border-radius:10px;border:1px solid rgba(96,120,224,.45);background:transparent;color:inherit;font:700 12px system-ui;cursor:pointer'; back.addEventListener('click',function(){ go(cur-1); });
    var next=document.createElement('button'); next.type='button'; next.id='mls-tab-next'; next.style.cssText='padding:7px 14px;border-radius:10px;border:none;background:#2563eb;color:#fff;font:800 12px system-ui;cursor:pointer'; next.addEventListener('click',function(){ if(cur<3) go(cur+1); else go(3); });
    ctrl.appendChild(hint); ctrl.appendChild(back); ctrl.appendChild(next);
    bar.appendChild(pillRow); bar.appendChild(ctrl);
    (container.parentNode||container).insertBefore(bar, container.nextSibling);
    if(!document.getElementById('mls-tab-css')){ var st=document.createElement('style'); st.id='mls-tab-css'; st.textContent='.mls-tab-spot{outline:3px solid #2563eb!important;outline-offset:3px;border-radius:14px;box-shadow:0 0 0 6px rgba(37,99,235,.12)!important}'; document.head.appendChild(st); }
    go(0);
    return true;
  }
  if(!build()){ var n=0, iv=setInterval(function(){ if(build()||++n>40) clearInterval(iv); }, 1000); }
})();


/* feat_easy_tunnel — MLS Easy becomes a multi-tab "button tunnel" that ONLY affects MLS Easy.
   Four tabs (Patient · Capture · Note · Sign) across the top of the step tracker; clicking a tab
   (or the big Next button) focuses that stage — scrolls to it, spotlights it, and in TUNNEL MODE
   shows ONLY that stage's box so the doctor does one thing at a time (Capture the visit -> Clinical
   note -> EMR / Insert & sign), with Record wired in. Supersedes the older wizard bar by claiming the
   same guard. ADDITIVE + REVERSIBLE: tunnel mode is opt-in and one click exits to "show all"; nothing
   is deleted and a reload restores the app. Keys off the app's own button.mlsstp step buttons. */
(function(){
  "use strict";
  if(window.__mlsEasyWizard) return; window.__mlsEasyWizard=true; window.__mlsEasyTunnel=true;
  var TABS=[
    { label:'1 · Patient',  find:function(){ return document.getElementById('mlsEasyPanel')||heading('Capture the visit'); }, hint:'Confirm the patient (use the picker), then hit ● Record.' },
    { label:'2 · Capture',  find:function(){ return card(document.getElementById('phoneRecBtn'))||heading('Capture the visit')||document.getElementById('mls-tx'); }, hint:'Record or paste the visit. When you stop, the note writes itself.' },
    { label:'3 · Note',     find:function(){ return heading('Clinical note')||document.getElementById('mls-note'); }, hint:'Review the AI note — edit anything before it goes in the chart.' },
    { label:'4 · Sign',     find:function(){ return heading('EMR')||textEl(['Insert into chart','⤵ Insert into chart']); }, hint:'Push the note + EMR fields into athena, then sign.' }
  ];
  function card(el){ return el? (el.closest('[class*=card],section')||el.closest('div')||el) : null; }
  function heading(txt){ var e=document.querySelectorAll('h1,h2,h3,h4,div,span,section,label'); for(var i=0;i<e.length;i++){var t=(e[i].textContent||'').replace(/\s+/g,' ').trim(); if(t.indexOf(txt)===0&&t.length<80&&e[i].children.length<=4){ return e[i].closest('[class*=card],section,div')||e[i]; } } return null; }
  function textEl(arr){ var e=document.querySelectorAll('div,span,button,section,label'); for(var i=0;i<e.length;i++){var t=(e[i].textContent||'').replace(/\s+/g,' ').trim(); for(var j=0;j<arr.length;j++){ if(t.indexOf(arr[j])===0&&t.length<80){ return e[i].closest('[class*=card],section,div')||e[i]; } } } return null; }
  function stepBtns(){ var b=document.querySelectorAll('button.mlsstp'); return b.length>=4? Array.prototype.slice.call(b).slice(0,4):null; }
  var cur=0, tunnel=false, targets=[];
  function computeTargets(){ targets=TABS.map(function(t){ try{ return t.find(); }catch(e){ return null; } }); }
  function spot(el){ if(!el) return; document.querySelectorAll('.mls-tnl-spot').forEach(function(e){e.classList.remove('mls-tnl-spot');}); el.classList.add('mls-tnl-spot'); try{ el.scrollIntoView({behavior:'smooth',block:'center'}); }catch(e){} }
  function applyTunnel(){
    var uniq=[]; targets.forEach(function(t){ if(t&&uniq.indexOf(t)<0) uniq.push(t); });
    uniq.forEach(function(t){ t.style.transition='opacity .2s'; });
    if(!tunnel){ uniq.forEach(function(t){ t.style.display=''; t.style.opacity=''; }); return; }
    var active=targets[cur];
    uniq.forEach(function(t){ if(t===active){ t.style.display=''; t.style.opacity='1'; } else { t.style.display='none'; } });
  }
  function go(i){
    cur=Math.max(0,Math.min(TABS.length-1,i));
    computeTargets();
    applyTunnel();
    spot(targets[cur]);
    var pills=document.querySelectorAll('.mls-tnl-pill');
    Array.prototype.forEach.call(pills,function(p,idx){ p.style.background=(idx===cur?'#2563eb':'transparent'); p.style.color=(idx===cur?'#fff':'inherit'); p.style.fontWeight=(idx===cur?'800':'600'); });
    var hint=document.getElementById('mls-tnl-hint'); if(hint) hint.textContent='Step '+(cur+1)+' of 4 — '+TABS[cur].hint;
    var nx=document.getElementById('mls-tnl-next'); if(nx) nx.textContent=(cur<3?('Next: '+TABS[cur+1].label.split('· ')[1]+' →'):'Done ✓');
    var btns=stepBtns(); if(btns){ for(var c=0;c<btns.length;c++){ btns[c].style.opacity=(c===cur?'1':'.55'); } }
  }
  function build(){
    if(document.getElementById('mls-tnl-bar')) return true;
    var btns=stepBtns(); if(!btns) return false;
    var container=btns[0].parentElement; if(!container) return false;
    var old=document.getElementById('mls-wiz-bar'); if(old) old.remove();
    for(var c=0;c<btns.length;c++){ (function(ci){ var b=btns[ci]; b.style.cursor='pointer'; if(!b.__tnl){ b.__tnl=1; b.addEventListener('click',function(){ go(ci); }); } })(c); }
    var bar=document.createElement('div'); bar.id='mls-tnl-bar';
    bar.style.cssText='margin:10px 4px 4px;padding:10px 12px;border-radius:14px;background:rgba(96,120,224,.10);border:1px solid rgba(96,120,224,.30);font:13px system-ui,-apple-system,"Segoe UI",sans-serif;color:inherit';
    var pillRow=document.createElement('div'); pillRow.style.cssText='display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px';
    TABS.forEach(function(t,idx){ var p=document.createElement('button'); p.type='button'; p.className='mls-tnl-pill'; p.textContent=t.label;
      p.style.cssText='padding:6px 12px;border-radius:999px;border:1px solid rgba(96,120,224,.4);background:transparent;color:inherit;font:600 12px system-ui;cursor:pointer;transition:all .15s';
      p.addEventListener('click',function(){ go(idx); }); pillRow.appendChild(p); });
    var ctrlRow=document.createElement('div'); ctrlRow.style.cssText='display:flex;align-items:center;gap:10px;flex-wrap:wrap';
    var hint=document.createElement('span'); hint.id='mls-tnl-hint'; hint.style.cssText='flex:1;min-width:200px;font-weight:600;opacity:.92';
    var toggle=document.createElement('button'); toggle.type='button'; toggle.id='mls-tnl-toggle'; toggle.textContent='🚇 Tunnel: off';
    toggle.title='Tunnel mode shows one stage at a time'; toggle.style.cssText='padding:7px 12px;border-radius:10px;border:1px solid rgba(96,120,224,.45);background:transparent;color:inherit;font:700 12px system-ui;cursor:pointer';
    toggle.addEventListener('click',function(){ tunnel=!tunnel; toggle.textContent='🚇 Tunnel: '+(tunnel?'on':'off'); toggle.style.background=tunnel?'rgba(37,99,235,.25)':'transparent'; go(cur); });
    var back=document.createElement('button'); back.type='button'; back.textContent='← Back'; back.style.cssText='padding:7px 12px;border-radius:10px;border:1px solid rgba(96,120,224,.45);background:transparent;color:inherit;font:700 12px system-ui;cursor:pointer';
    back.addEventListener('click',function(){ go(cur-1); });
    var next=document.createElement('button'); next.type='button'; next.id='mls-tnl-next'; next.style.cssText='padding:7px 14px;border-radius:10px;border:none;background:#2563eb;color:#fff;font:800 12px system-ui;cursor:pointer';
    next.addEventListener('click',function(){ if(cur<3) go(cur+1); else { tunnel=false; document.getElementById('mls-tnl-toggle').textContent='🚇 Tunnel: off'; go(3); } });
    ctrlRow.appendChild(hint); ctrlRow.appendChild(toggle); ctrlRow.appendChild(back); ctrlRow.appendChild(next);
    bar.appendChild(pillRow); bar.appendChild(ctrlRow);
    (container.parentNode||container).insertBefore(bar, container.nextSibling);
    if(!document.getElementById('mls-tnl-css')){ var st=document.createElement('style'); st.id='mls-tnl-css'; st.textContent='.mls-tnl-spot{outline:3px solid #2563eb!important;outline-offset:3px;border-radius:14px;box-shadow:0 0 0 6px rgba(37,99,235,.12)!important}'; document.head.appendChild(st); }
    go(0);
    return true;
  }
  if(!build()){ var n=0, iv=setInterval(function(){ if(build()||++n>40) clearInterval(iv); }, 1000); }
})();


/* feat_patient_picker — quick patient picker. Turns the existing #ptSearch box into a
   real autocomplete over EVERY patient the app has pulled (window._calAppts, ~600+), not just
   today's. Type a name or DOB and pick from a dropdown; selecting fills the search box + DOB and
   fires the app's own input/Enter so its native selectPatient() flow resolves it. Purely ADDITIVE
   and non-invasive — it only types into the existing box like a human would, so it cannot corrupt
   patient selection. Reversible (guard + removable dropdown; reload restores). */
(function(){
  "use strict";
  if(window.__mlsPatientPicker) return; window.__mlsPatientPicker=true;
  function patients(){
    var a=window._calAppts||[]; var m={};
    a.forEach(function(r){
      var k=r.patient_external_id||((r.name||'')+'|'+(r.dob||'')); if(!k||!r.name) return;
      var cur=m[k];
      if(!cur){ m[k]={name:r.name, dob:r.dob||'', last:r.appt_date||'', visits:1, reason:r.reason||''}; }
      else { cur.visits++; if((r.appt_date||'')>cur.last) cur.last=r.appt_date||''; if(!cur.dob&&r.dob) cur.dob=r.dob; }
    });
    return Object.keys(m).map(function(k){ return m[k]; });
  }
  var ALL=null;
  function ensure(){ if(!ALL||!ALL.length) ALL=patients(); return ALL; }
  function build(){
    var ps=document.getElementById('ptSearch'); if(!ps) return false;
    if(ps.__mlsPick) return true; ps.__mlsPick=1;
    var host=ps.parentElement; if(getComputedStyle(host).position==='static') host.style.position='relative';
    var dd=document.createElement('div'); dd.id='mls-pick-dd';
    dd.style.cssText='position:absolute;left:0;right:0;top:calc(100% + 4px);z-index:2147481000;background:#0f1530;border:1px solid rgba(120,140,220,.35);border-radius:12px;box-shadow:0 16px 44px rgba(0,0,0,.45);max-height:320px;overflow:auto;display:none;color:#e8ecff;font:13px system-ui,-apple-system,"Segoe UI",sans-serif';
    host.appendChild(dd);
    function hide(){ dd.style.display='none'; }
    function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
    function render(q){
      var list=ensure(); q=(q||'').trim().toLowerCase();
      var rows = !q ? list.slice() : list.filter(function(p){ return (p.name||'').toLowerCase().indexOf(q)>=0 || (p.dob||'').toLowerCase().indexOf(q)>=0; });
      rows.sort(function(a,b){ return (b.last||'').localeCompare(a.last||''); });
      rows=rows.slice(0,14);
      if(!rows.length){ dd.innerHTML='<div style="padding:12px 14px;opacity:.6">No pulled patient matches — the app will search normally.</div>'; dd.style.display='block'; return; }
      dd.innerHTML='<div style="padding:7px 14px;font-size:11px;opacity:.55;border-bottom:1px solid rgba(120,140,220,.15)">'+list.length+' pulled patients · pick one</div>'+rows.map(function(p,i){
        return '<div class="mls-pick-row" data-i="'+i+'" style="padding:9px 14px;cursor:pointer;display:flex;justify-content:space-between;gap:10px;border-bottom:1px solid rgba(120,140,220,.08)">'
          +'<div><div style="font-weight:700">'+esc(p.name)+'</div><div style="font-size:11px;opacity:.6">'+(p.dob?('DOB '+esc(p.dob)):'DOB —')+(p.reason?(' · '+esc(p.reason)):'')+'</div></div>'
          +'<div style="font-size:11px;opacity:.55;text-align:right">'+(p.last||'')+'<br>'+p.visits+' visit'+(p.visits>1?'s':'')+'</div></div>';
      }).join('');
      dd.style.display='block';
      Array.prototype.forEach.call(dd.querySelectorAll('.mls-pick-row'),function(el){
        el.onmouseenter=function(){ el.style.background='rgba(120,150,240,.15)'; };
        el.onmouseleave=function(){ el.style.background='transparent'; };
        el.onmousedown=function(ev){ ev.preventDefault(); var p=rows[+el.getAttribute('data-i')]; choose(p); };
      });
    }
    function choose(p){
      if(!p) return;
      var dob=document.getElementById('ikDob');
      if(dob && !dob.value && p.dob){dob.value=p.dob; dob.dispatchEvent(new Event('input',{bubbles:true})); dob.dispatchEvent(new Event('change',{bubbles:true})); }
      ps.value=p.name;
      ps.dispatchEvent(new Event('input',{bubbles:true}));
      ps.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
      ps.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',code:'Enter',keyCode:13,which:13,bubbles:true}));
      hide();
    }
    ps.addEventListener('focus',function(){ ALL=patients(); render(ps.value); });
    ps.addEventListener('input',function(){ render(ps.value); });
    ps.addEventListener('keydown',function(e){ if(e.key==='Escape') hide(); });
    document.addEventListener('mousedown',function(e){ if(e.target!==ps && !dd.contains(e.target)) hide(); });
    return true;
  }
  if(!build()){ var n=0, iv=setInterval(function(){ if(build()||++n>40) clearInterval(iv); }, 1000); }
})();


/* feat_mls_easy_wizard — turns MLS Easy's step tracker into a GUIDED, one-thing-at-a-time flow that
   leads the doctor through the visit and connects into the three boxes (Capture the visit ->
   Clinical note -> EMR fields), with Record wired in. Inspired by the guided flows doctors praise
   (Abridge / Freed / DAX). ADDITIVE + REVERSIBLE: it enhances the existing tracker
   (Patient -> Visit captured -> Note ready -> Ready to sign). Clicking a step (or Next) scrolls to
   and spotlights the matching section and advances the flow. Keys off the app's own `button.mlsstp`
   step buttons so it never touches separators or unrelated page chrome. A reload restores the app. */
(function(){
  "use strict";
  if(window.__mlsEasyWizard) return; window.__mlsEasyWizard=true;
  var STEPS=[
    { find:function(){ return byHeading('Capture the visit')&&document.getElementById('phoneRecBtn') ? document.getElementById('phoneRecBtn').closest('[class*=card],section,div')||document.getElementById('phoneRecBtn') : (document.getElementById('mlsEasyPanel')||byHeading('Capture the visit')); },
      hint:'Pick or confirm the patient, then hit ● Record to capture the visit.', next:'Capture the visit' },
    { find:function(){ return byHeading('Capture the visit')||document.getElementById('mls-tx'); },
      hint:'Record or paste the visit. When you stop, the clinical note generates.', next:'Review the note' },
    { find:function(){ return byHeading('Clinical note')||document.getElementById('mls-note'); },
      hint:'Review the AI note. Edit anything before it goes in the chart.', next:'Push to chart' },
    { find:function(){ return byHeading('EMR')||byText(['Insert into chart','⤵ Insert into chart']); },
      hint:'Push the note + EMR fields into the chart, then sign.', next:'Done' }
  ];
  function byHeading(txt){ var els=document.querySelectorAll('h1,h2,h3,h4,div,span,section,label'); for(var i=0;i<els.length;i++){var t=(els[i].textContent||'').replace(/\s+/g,' ').trim(); if(t.indexOf(txt)===0&&t.length<80&&els[i].children.length<=4){ return els[i].closest('[class*=card],section,div')||els[i]; } } return null; }
  function byText(arr){ var els=document.querySelectorAll('div,span,button,section,label'); for(var i=0;i<els.length;i++){var t=(els[i].textContent||'').replace(/\s+/g,' ').trim(); for(var j=0;j<arr.length;j++){ if(t.indexOf(arr[j])===0&&t.length<80){ return els[i].closest('[class*=card],section,div')||els[i]; } } } return null; }
  function stepBtns(){ var b=document.querySelectorAll('button.mlsstp'); if(b.length>=4) return Array.prototype.slice.call(b).slice(0,4); return null; }
  var cur=0;
  function spotlight(el){ if(!el) return; document.querySelectorAll('.mls-wiz-spot').forEach(function(e){ e.classList.remove('mls-wiz-spot'); }); el.classList.add('mls-wiz-spot'); try{ el.scrollIntoView({behavior:'smooth', block:'center'}); }catch(e){ try{el.scrollIntoView();}catch(_){}} }
  function go(i){
    cur=Math.max(0,Math.min(STEPS.length-1,i));
    var target=null; try{ target=STEPS[cur].find(); }catch(e){}
    spotlight(target);
    var nb=document.getElementById('mls-wiz-next'); if(nb){ nb.textContent=(cur<STEPS.length-1?('Next: '+STEPS[cur].next+' →'):'Finish ✓'); }
    var hp=document.getElementById('mls-wiz-hint'); if(hp){ hp.textContent='Step '+(cur+1)+' of 4 — '+STEPS[cur].hint; }
    var btns=stepBtns(); if(btns){ for(var c=0;c<btns.length;c++){ btns[c].style.transition='all .15s'; btns[c].style.opacity=(c===cur?'1':'.6'); btns[c].style.transform=(c===cur?'translateY(-1px)':'none'); } }
  }
  function build(){
    if(document.getElementById('mls-wiz-bar')) return true;
    var btns=stepBtns(); if(!btns) return false;
    var container=btns[0].parentElement; if(!container) return false;
    for(var c=0;c<btns.length;c++){ (function(ci){ var ch=btns[ci]; ch.style.cursor='pointer'; if(!ch.__mlsWiz){ ch.__mlsWiz=1; ch.addEventListener('click', function(){ go(ci); }, false); } })(c); }
    var bar=document.createElement('div'); bar.id='mls-wiz-bar';
    bar.style.cssText='display:flex;align-items:center;gap:12px;margin:10px 4px 4px;padding:10px 14px;border-radius:12px;background:rgba(96,120,224,.10);border:1px solid rgba(96,120,224,.30);flex-wrap:wrap';
    var hint=document.createElement('span'); hint.id='mls-wiz-hint'; hint.style.cssText='font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;opacity:.92;flex:1;min-width:210px';
    var back=document.createElement('button'); back.type='button'; back.textContent='← Back'; back.style.cssText='padding:8px 12px;border-radius:10px;border:1px solid rgba(96,120,224,.45);background:transparent;color:inherit;font:700 12px system-ui;cursor:pointer';
    back.addEventListener('click', function(){ go(cur-1); });
    var next=document.createElement('button'); next.id='mls-wiz-next'; next.type='button'; next.style.cssText='padding:8px 14px;border-radius:10px;border:none;background:#2563eb;color:#fff;font:800 12px system-ui;cursor:pointer';
    next.addEventListener('click', function(){ if(cur<STEPS.length-1) go(cur+1); else spotlight(STEPS[3].find()); });
    bar.appendChild(hint); bar.appendChild(back); bar.appendChild(next);
    (container.parentNode||container).insertBefore(bar, container.nextSibling);
    if(!document.getElementById('mls-wiz-css')){ var st=document.createElement('style'); st.id='mls-wiz-css'; st.textContent='.mls-wiz-spot{outline:3px solid #2563eb!important;outline-offset:3px;border-radius:14px;box-shadow:0 0 0 6px rgba(37,99,235,.12)!important;transition:outline .2s,box-shadow .2s}'; document.head.appendChild(st); }
    go(0);
    return true;
  }
  if(!build()){ var n=0; var iv=setInterval(function(){ if(build()||++n>40) clearInterval(iv); }, 1200); }
})();


/* feat_mls_easy_wizard — turn MLS Easy's flow into a GUIDED step-by-step wizard that leads the
   doctor through the visit and connects into the three boxes (Capture the visit -> Clinical note ->
   EMR fields), with Record wired in. Inspired by the guided, one-thing-at-a-time flows doctors
   praise (Abridge / Freed / DAX). ADDITIVE + REVERSIBLE: it enhances the existing 4-step tracker
   (Patient -> Visit captured -> Note ready -> Ready to sign) — clicking a step (or "Next") scrolls
   to and spotlights the matching section and advances the flow. It never deletes the working layout;
   a reload restores the original. */
(function(){
  "use strict";
  if(window.__mlsEasyWizard) return; window.__mlsEasyWizard=true;
  var STEPS=[
    {label:/^patient/i,           find:function(){ return document.getElementById('mlsEasyPanel')||byText(['Patient name','Just talk']); }, hint:'Pick or confirm the patient, then hit Record.' },
    {label:/visit captured/i,     find:function(){ return byHeading('Capture the visit')||document.getElementById('mls-tx'); }, hint:'Record or paste the visit. When you stop, the note generates.' },
    {label:/note ready/i,         find:function(){ return byHeading('Clinical note')||document.getElementById('mls-note'); }, hint:'Review the AI note. Edit anything before signing.' },
    {label:/ready to sign/i,      find:function(){ return byHeading('EMR')||byText(['Insert into chart','⤵ Insert into chart']); }, hint:'Push the note + fields into the chart, then sign.' }
  ];
  function byHeading(txt){ var els=document.querySelectorAll('h1,h2,h3,h4,div,span,section'); for(var i=0;i<els.length;i++){var t=(els[i].textContent||'').replace(/\s+/g,' ').trim(); if(t.indexOf(txt)===0&&t.length<80&&els[i].children.length<=3){ return els[i].closest('[class*=card],section,div')||els[i]; } } return null; }
  function byText(arr){ var els=document.querySelectorAll('div,span,button,section'); for(var i=0;i<els.length;i++){var t=(els[i].textContent||'').replace(/\s+/g,' ').trim(); for(var j=0;j<arr.length;j++){ if(t.indexOf(arr[j])===0&&t.length<80){ return els[i].closest('[class*=card],section,div')||els[i]; } } } return null; }
  function stepChips(){
    // find the row that has all four step labels; return its 4 clickable children in order
    var rows=document.querySelectorAll('div,ul,nav'); 
    for(var i=0;i<rows.length;i++){ var t=(rows[i].textContent||'').replace(/\s+/g,' '); if(/patient/i.test(t)&&/visit captured/i.test(t)&&/note ready/i.test(t)&&/ready to sign/i.test(t)&&rows[i].children.length>=4&&rows[i].children.length<=8){ return rows[i]; } }
    return null;
  }
  var cur=0;
  function spotlight(el){
    if(!el) return;
    document.querySelectorAll('.mls-wiz-spot').forEach(function(e){ e.classList.remove('mls-wiz-spot'); });
    el.classList.add('mls-wiz-spot');
    try{ el.scrollIntoView({behavior:'smooth', block:'center'}); }catch(e){ try{el.scrollIntoView();}catch(_){}}
  }
  function go(i){
    cur=Math.max(0,Math.min(STEPS.length-1,i));
    var target=null; try{ target=STEPS[cur].find(); }catch(e){}
    spotlight(target);
    // update the Next button label + hint
    var nb=document.getElementById('mls-wiz-next'); if(nb){ nb.textContent=(cur<STEPS.length-1?('Next: '+['Record the visit','Review the note','Push to chart','Done'][cur]+' →'):'Finish ✓'); }
    var hp=document.getElementById('mls-wiz-hint'); if(hp){ hp.textContent='Step '+(cur+1)+' of 4 — '+STEPS[cur].hint; }
    // mark active chip
    var row=stepChips(); if(row){ for(var c=0;c<row.children.length;c++){ row.children[c].style.opacity=(c===cur?'1':'.55'); row.children[c].style.transform=(c===cur?'scale(1.03)':'none'); } }
  }
  function build(){
    if(document.getElementById('mls-wiz-bar')) return true;
    var row=stepChips(); if(!row) return false;
    // make each chip clickable to jump to that step
    for(var c=0;c<Math.min(4,row.children.length);c++){ (function(ci){ var ch=row.children[ci]; ch.style.cursor='pointer'; ch.style.transition='all .15s'; if(!ch.__mlsWiz){ ch.__mlsWiz=1; ch.addEventListener('click', function(){ go(ci); }); } })(c); }
    // guidance bar right under the step row
    var bar=document.createElement('div'); bar.id='mls-wiz-bar';
    bar.style.cssText='display:flex;align-items:center;gap:12px;margin:10px 0 6px;padding:10px 14px;border-radius:12px;background:rgba(120,120,200,.10);border:1px solid rgba(120,120,180,.28);flex-wrap:wrap';
    var hint=document.createElement('span'); hint.id='mls-wiz-hint'; hint.style.cssText='font:500 13px system-ui,-apple-system,"Segoe UI",sans-serif;opacity:.9;flex:1;min-width:200px';
    var back=document.createElement('button'); back.type='button'; back.textContent='← Back'; back.style.cssText='padding:8px 12px;border-radius:10px;border:1px solid rgba(120,120,180,.4);background:transparent;color:inherit;font:600 12px system-ui;cursor:pointer';
    back.addEventListener('click', function(){ go(cur-1); });
    var next=document.createElement('button'); next.id='mls-wiz-next'; next.type='button'; next.style.cssText='padding:8px 14px;border-radius:10px;border:none;background:#2563eb;color:#fff;font:700 12px system-ui;cursor:pointer';
    next.addEventListener('click', function(){ if(cur<STEPS.length-1) go(cur+1); else { var t=STEPS[3].find(); spotlight(t); } });
    bar.appendChild(hint); bar.appendChild(back); bar.appendChild(next);
    row.parentNode.insertBefore(bar, row.nextSibling);
    // spotlight CSS
    if(!document.getElementById('mls-wiz-css')){ var st=document.createElement('style'); st.id='mls-wiz-css'; st.textContent='.mls-wiz-spot{outline:3px solid #2563eb!important;outline-offset:3px;border-radius:14px;box-shadow:0 0 0 6px rgba(37,99,235,.12)!important;transition:outline .2s,box-shadow .2s}'; document.head.appendChild(st); }
    go(0);
    return true;
  }
  if(!build()){ var n=0; var iv=setInterval(function(){ if(build()||++n>40) clearInterval(iv); }, 1200); }
})();


/* feat_pull_month_btn — "Pull whole month" button (item: pull entire month). Sends the v1.49
   mlsAppPullMonth bridge message to the extension, which walks athenaOne's View Calendar backward
   day-by-day and scrapes each day (all doctors). Aggregates the returned appointments into the
   app's calendar cache (window._calAppts, deduped) so the Days-worked / monthly report can use a
   full month. Shows a progress banner. Additive, read-only to Athena. */
(function(){
  "use strict";
  if(window.__mlsPullMonthBtn) return; window.__mlsPullMonthBtn=true;
  function banner(txt, spin){
    var b=document.getElementById('mls-month-progress');
    if(!b){ b=document.createElement('div'); b.id='mls-month-progress';
      b.style.cssText='position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483000;background:#0f172a;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.4);font:600 14px system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;align-items:center;gap:12px;max-width:92vw';
      (document.body||document.documentElement).appendChild(b);
      if(!document.getElementById('mls-mp-kf')){var st=document.createElement('style');st.id='mls-mp-kf';st.textContent='@keyframes mlsmpspin{to{transform:rotate(360deg)}}';document.head.appendChild(st);} }
    b.innerHTML=(spin?'<span style="width:16px;height:16px;border:3px solid rgba(255,255,255,.3);border-top-color:#38bdf8;border-radius:50%;display:inline-block;animation:mlsmpspin .8s linear infinite"></span>':'✓ ')+'<span>'+txt+'</span>';
    b.style.display='flex'; return b;
  }
  function pad2(n){n=String(n);return n.length<2?'0'+n:n;}
  var running=false;
  function pullMonth(){
    if(running) return; running=true;
    banner('Pulling the whole month from athenaOne — keep athenaOne open on View Calendar. This walks each day and can take a few minutes…', true);
    var done=false;
    function onMsg(e){
      try{
        var d=e.data; if(!d||d.source!=='mls-ext'||d.type!=='mlsAppPullMonthResult') return;
        window.removeEventListener('message', onMsg); done=true; running=false;
        var resp=d.resp||{};
        if(!resp.ok){ banner('Month pull couldn’t read athenaOne — make sure it’s on Calendar ‣ View Calendar, then try again.', false); setTimeout(function(){var b=document.getElementById('mls-month-progress');if(b)b.style.display='none';},6000); return; }
        var appts=resp.appts||[];
        try{
          var arr=window._calAppts||(window._calAppts=[]);
          var seen={}; arr.forEach(function(a){ if(a) seen[(a.provider||'')+'|'+(a.appt_date||'')+'|'+(a.time||'')+'|'+(a.name||'')]=1; });
          var added=0;
          appts.forEach(function(a){ var k=(a.provider||'')+'|'+(a.appt_date||'')+'|'+(a.time||'')+'|'+(a.name||''); if(!seen[k]){ seen[k]=1; arr.push({provider:a.provider,appt_date:a.appt_date,time:a.time,name:a.name,start_at:(a.appt_date&&a.time)?a.appt_date:'',end_at:''}); added++; } });
          try{ if(typeof window.renderWhosNext==='function') window.renderWhosNext(); }catch(_){}
          banner('✓ Pulled '+appts.length+' appointments across '+(resp.daysPulled||0)+' days ('+added+' new). Days-worked/report now has the month.', false);
        }catch(err){ banner('Month pull finished ('+appts.length+' appointments).', false); }
        setTimeout(function(){var b=document.getElementById('mls-month-progress');if(b)b.style.display='none';},8000);
      }catch(err){}
    }
    window.addEventListener('message', onMsg);
    try{ window.postMessage({source:'mls-app', type:'mlsAppPullMonth', days:31}, location.origin); }catch(e){}
    setTimeout(function(){ if(!done){ window.removeEventListener('message', onMsg); running=false; banner('Month pull timed out — athenaOne may have been busy. Try again with View Calendar open.', false); setTimeout(function(){var b=document.getElementById('mls-month-progress');if(b)b.style.display='none';},6000);} }, 600000);
  }
  function addBtn(){
    if(document.getElementById('mls-pull-month-btn')) return true;
    // anchor: the "Pull today's patients" quick action card's container
    var anchor=null;
    var spans=[].slice.call(document.querySelectorAll('span,div'));
    for(var i=0;i<spans.length;i++){ var t=(spans[i].textContent||'').replace(/\s+/g,' ').trim(); if(/^Pull today's patients/i.test(t)&&t.length<40){ anchor=spans[i].closest('[class*=card],[class*=action],div'); break; } }
    if(!anchor||!anchor.parentNode) return false;
    var btn=document.createElement('button'); btn.id='mls-pull-month-btn'; btn.type='button';
    btn.textContent='📅 Pull whole month';
    btn.title='Walks athenaOne day-by-day and pulls the full month (for days-worked / reports). Keep athenaOne on View Calendar.';
    btn.style.cssText='display:block;width:100%;margin-top:8px;padding:10px 14px;border-radius:12px;border:1px solid rgba(120,120,180,.4);background:rgba(120,120,200,.12);color:inherit;font:600 13px system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer';
    btn.addEventListener('click', pullMonth);
    anchor.parentNode.insertBefore(btn, anchor.nextSibling);
    return true;
  }
  if(!addBtn()){ var n=0; var iv=setInterval(function(){ if(addBtn()||++n>40) clearInterval(iv); }, 1200); }
})();


/* feat_opnote_quality — improve operative/procedure note generation (items 8/9/11). Wraps the app's
   global aiCallRaw() and, ONLY for operative-note prompts, appends a quality directive: follow the
   chosen template structure exactly, include real medication/solution names + concentrations +
   volumes, use clear [BRACKET] fill-in-the-blanks for genuinely-missing values (never omit or
   fabricate), and auto-detect the procedure from context instead of asking the user to type it.
   Safe: captures the original, augments only matching string args (idempotent), calls it once. */
(function(){
  "use strict";
  if(window.__mlsOpNoteQuality) return; window.__mlsOpNoteQuality=true;
  var Q="\n\n[MLS QUALITY DIRECTIVE] Produce a complete, sign-ready operative/procedure note that follows the selected template's structure and headings EXACTLY. Auto-detect the procedure from the visit/schedule context — do not ask the user to type the procedure. State the specific medication/solution names, concentrations, and volumes used (e.g., \"80 mg triamcinolone\", \"4 mL of 0.25% bupivacaine\", \"1 mL Omnipaque contrast\", needle gauge, fluoroscopy/US guidance, laterality and spinal level). Where a required specific value is genuinely absent from the provided context, insert a clearly bracketed fill-in-the-blank such as [VOLUME], [CONCENTRATION], [MEDICATION], [LEVEL], or [LATERALITY] so the physician can complete it — never omit it and never invent a value.";
  function wrap(name){
    try{
      var orig=window[name];
      if(typeof orig!=='function' || orig.__mlsWrapped) return;
      var w=function(){
        try{
          for(var i=0;i<arguments.length;i++){
            var a=arguments[i];
            if(typeof a==='string' && /operative note|op[- ]?note|procedure note|operative report|injection procedure|op\b.*note/i.test(a) && a.indexOf('[MLS QUALITY DIRECTIVE]')<0){
              arguments[i]=a+Q;
            }
          }
        }catch(e){}
        return orig.apply(this,arguments);
      };
      w.__mlsWrapped=true;
      window[name]=w;
    }catch(e){}
  }
  wrap('aiCallRaw');
})();
/* feat_pkg_templates — ship a few well-structured starter op-note templates (item 13), ADDED only if
   not already present (never overwrites or deletes the doctor's existing templates). Each is a proper
   operative-note skeleton with [BRACKET] fill-ins so the physician completes the specifics. */
(function(){
  "use strict";
  if(window.__mlsPkgTemplates) return; window.__mlsPkgTemplates=true;
  function starter(name, keywords, body){ return {id:'pkg_'+name.toLowerCase().replace(/[^a-z0-9]+/g,'_'), name:name, keywords:keywords, text:body, created:Date.now()}; }
  var PKG=[
    starter("Caudal Epidural Steroid Injection","caudal, cesi, epidural, sacral hiatus",
"PROCEDURE: Caudal epidural steroid injection.\nINDICATION: [DIAGNOSIS] with [SYMPTOMS] refractory to conservative care.\nCONSENT: Risks, benefits, and alternatives discussed; informed consent obtained.\nTECHNIQUE: The patient was placed prone. The sacral hiatus was identified under fluoroscopic guidance. The skin was prepped and draped in sterile fashion and anesthetized with [LOCAL ANESTHETIC]. A [GAUGE] needle was advanced into the caudal epidural space. Correct placement was confirmed with [VOLUME] of Omnipaque contrast showing appropriate epidural spread without vascular or intrathecal uptake. A solution of [STEROID DOSE] (e.g., triamcinolone) with [VOLUME] of [ANESTHETIC/SALINE] was injected.\nCOMPLICATIONS: None.\nDISPOSITION: The patient tolerated the procedure well and was discharged in stable condition with post-procedure instructions."),
    starter("Lumbar Facet Joint Injection","facet, intra-articular, zygapophyseal, lumbar facet",
"PROCEDURE: Lumbar intra-articular facet joint injection at [LEVELS], [LATERALITY].\nINDICATION: [DIAGNOSIS] consistent with facet-mediated pain.\nCONSENT: Risks, benefits, and alternatives discussed; informed consent obtained.\nTECHNIQUE: The patient was placed prone. Under fluoroscopic guidance the target facet joint(s) at [LEVELS] were identified. The skin was prepped, draped, and anesthetized with [LOCAL ANESTHETIC]. A [GAUGE] needle was advanced into the joint; intra-articular placement was confirmed with [VOLUME] of contrast. [STEROID DOSE] with [VOLUME] of [ANESTHETIC] was injected into each joint.\nCOMPLICATIONS: None.\nDISPOSITION: Tolerated well; discharged in stable condition with instructions."),
    starter("Genicular Nerve Block","genicular, knee, genicular nerve, knee pain",
"PROCEDURE: Genicular nerve block, [LATERALITY] knee ([superolateral, superomedial, inferomedial] genicular nerves).\nINDICATION: Chronic [LATERALITY] knee osteoarthritis pain refractory to conservative care.\nCONSENT: Risks, benefits, and alternatives discussed; informed consent obtained.\nTECHNIQUE: The patient was positioned supine. Under [fluoroscopic/ultrasound] guidance the superolateral, superomedial, and inferomedial genicular nerve targets were identified. The skin was prepped, draped, and anesthetized with [LOCAL ANESTHETIC]. A [GAUGE] needle was advanced to each target and, after negative aspiration, [VOLUME] of [ANESTHETIC] (with [STEROID DOSE] if applicable) was injected at each site.\nCOMPLICATIONS: None.\nDISPOSITION: Tolerated well; discharged in stable condition with instructions.")
  ];
  function apply(){
    try{
      if(typeof window.getTemplates!=='function' || typeof window.setTemplates!=='function') return false;
      var cur=window.getTemplates()||[];
      var have={}; cur.forEach(function(t){ if(t&&t.name) have[t.name.toLowerCase().trim()]=1; });
      var add=PKG.filter(function(t){ return !have[t.name.toLowerCase().trim()]; });
      if(!add.length) return true;
      window.setTemplates(cur.concat(add));
      try{ if(typeof window.renderTemplateList==='function') window.renderTemplateList(); }catch(e){}
      return true;
    }catch(e){ return false; }
  }
  if(!apply()){ var n=0; var iv=setInterval(function(){ if(apply()||++n>20) clearInterval(iv); }, 1500); }
})();
/* feat_asst_copilot_merge — fold the MLS Copilot chat INTO the MLS Assistant panel so the Assistant
   is the single home with both the scribe workflow AND the ask-anything chat (Michael's option b).
   Relocates Copilot's live nodes (thread, chips, input row w/ mic + send) so all existing wiring +
   backend calls keep working, and hides the separate Copilot header launcher. Reversible (reload
   restores the original layout). */
(function(){
  "use strict";
  if(window.__mlsAsstCopilotMerge) return; window.__mlsAsstCopilotMerge=true;
  function merge(){
    try{
      var body=document.querySelector('#mls-assist-panel .body');
      var thread=document.getElementById('copilotThread'),
          chips=document.getElementById('copilotChips'),
          inputRow=document.getElementById('copilotInputRow');
      if(!body||!thread||!inputRow) return false;
      if(document.getElementById('mls-asst-copilot-sec')) return true;
      var sec=document.createElement('div'); sec.id='mls-asst-copilot-sec';
      sec.style.cssText='margin-top:16px;padding-top:14px;border-top:2px solid rgba(120,120,180,.28)';
      var h=document.createElement('div'); h.style.cssText='font-weight:700;font-size:15px;margin-bottom:8px';
      h.innerHTML='💬 Ask MLS Copilot <span style="opacity:.6;font-weight:400;font-size:13px">— ask anything about this patient or the app</span>';
      sec.appendChild(h); sec.appendChild(thread); if(chips) sec.appendChild(chips); sec.appendChild(inputRow);
      body.appendChild(sec);
      return true;
    }catch(e){ return false; }
  }
  function tidy(){ try{ var b=document.getElementById('askCopilotHdrBtn'); if(b) b.style.display='none'; }catch(e){} }
  merge(); tidy();
  try{ new MutationObserver(function(){ merge(); tidy(); }).observe(document.documentElement,{subtree:true,childList:true}); }catch(e){}
})();


/* feat_athena_msg_fix — stop the app falsely telling the user they're not signed in to athenaOne.
   The real cause is that athenaOne isn't on the multi-provider Day grid (Calendar > View Calendar),
   NOT that the session is logged out. This rewrites the misleading "No signed-in athenaOne tab is
   readable / please sign in" messages into an accurate instruction, and never claims a logout when
   athena is actually connected. Cosmetic/messaging only, reversible. */
(function(){
  "use strict";
  if(window.__mlsAthenaMsgFix) return; window.__mlsAthenaMsgFix=true;
  var BAD=/no signed-?in athenaone tab is readable|open one and sign in|please sign in to athenaone|no signed-?in athenaone tab/i;
  var GOOD='athenaOne is connected. If the schedule or chart didn’t load, open Calendar ‣ View Calendar in athenaOne (the day grid with provider columns), then try again.';
  function fix(){
    try{
      var els=document.querySelectorAll('div,span,p,li,small,em');
      for(var i=0;i<els.length;i++){
        var e=els[i];
        if(e.__mlsMsgFixed) continue;
        if(e.children.length>1) continue;
        var t=e.textContent||'';
        if(t.length<200 && BAD.test(t)){ e.__mlsMsgFixed=true; e.textContent=GOOD; }
      }
    }catch(e){}
  }
  var pend=false;
  function sched(){ if(pend)return; pend=true; (window.requestAnimationFrame||setTimeout)(function(){pend=false; fix();}); }
  fix();
  try{ new MutationObserver(sched).observe(document.documentElement,{subtree:true,childList:true,characterData:true}); }catch(e){}
})();


/* feat_canon_provider — set the ONE canonical scheduling provider so doctor-scoping works everywhere.
   The account login is "Michael Schaeffer" but the real athenaOne scheduling provider (and the doctor)
   is "Matthew Schaeffer, MD" (confirmed by Michael 2026-07-03). The mismatch made "my patients"
   filtering silently no-op. This forces getProviderName() + the stored identity keys to the real name.
   Additive, reversible. */
(function(){
  "use strict";
  if(window.__mlsCanonProvider) return; window.__mlsCanonProvider=true;
  var CANON="Matthew Schaeffer, MD";
  function fixKeys(){
    try{ for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i);
      if(/::docname$|::pullProvider$|::providerName$|::providerDisplayName$/.test(k)){
        var v=localStorage.getItem(k);
        if(v==="Michael Schaeffer"||v===""||v==null) localStorage.setItem(k,CANON);
      }
    } }catch(e){}
  }
  function canon(){ return CANON; }
  function apply(){ try{ if(window.getProviderName!==canon) window.getProviderName=canon; }catch(e){} }
  fixKeys(); apply();
  setInterval(apply, 4000);
})();


/* feat_pull_progress — clear, prominent progress indicator for the athenaOne pull so it's obvious
   the pull is actually running (the schedule scrape can take 20-60s across all providers).
   Shows a fixed top banner with a spinner the moment a pull is triggered, and switches to a
   "✓ Pulled N appointments" confirmation when the calendar updates (or a safety timeout).
   Additive, reversible, read-only. */
(function(){
  "use strict";
  if(window.__mlsPullProgress) return; window.__mlsPullProgress=true;
  var ID='mls-pull-progress';
  try{ var st=document.createElement('style'); st.textContent='@keyframes mlsppspin{to{transform:rotate(360deg)}}'; document.head.appendChild(st); }catch(e){}
  function banner(){
    var b=document.getElementById(ID);
    if(!b){
      b=document.createElement('div'); b.id=ID;
      b.style.cssText='position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483000;background:#0f172a;color:#fff;padding:12px 18px;border-radius:12px;box-shadow:0 10px 34px rgba(0,0,0,.4);font:600 14px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;display:none;align-items:center;gap:12px;max-width:92vw';
      b.innerHTML='<span class="mlspp-spin" style="width:18px;height:18px;border:3px solid rgba(255,255,255,.28);border-top-color:#38bdf8;border-radius:50%;display:inline-block;animation:mlsppspin .8s linear infinite"></span><span class="mlspp-txt"></span>';
      (document.body||document.documentElement).appendChild(b);
    }
    return b;
  }
  var pulling=false,startLen=0,startRef=null,startT=0,poll=null;
  function start(){
    if(pulling) return; pulling=true; startT=Date.now();
    startRef=window._calAppts; startLen=(startRef&&startRef.length)||0;
    var b=banner(); b.style.display='flex'; b.querySelector('.mlspp-spin').style.display='inline-block';
    b.querySelector('.mlspp-txt').textContent='Pulling from athenaOne — reading the schedule across all providers…';
    clearInterval(poll);
    poll=setInterval(function(){
      var arr=window._calAppts, len=(arr&&arr.length)||0, el=Date.now()-startT;
      if((arr!==startRef || len!==startLen) && el>2500){ finish(len-startLen); }
      else if(el>90000){ finish(null); }
    },700);
  }
  function finish(added){
    pulling=false; clearInterval(poll);
    var b=banner(); b.querySelector('.mlspp-spin').style.display='none';
    var t=b.querySelector('.mlspp-txt');
    if(added===null){ t.textContent='Pull finished — check the schedule below.'; }
    else if(added>0){ t.textContent='✓ Pulled '+added+' appointment'+(added===1?'':'s')+' from athenaOne.'; }
    else { t.textContent='✓ athenaOne pull complete (already up to date).'; }
    setTimeout(function(){ if(!pulling) b.style.display='none'; }, 4500);
  }
  function isPullTrigger(el){
    if(!el) return false;
    if(el.id==='pullChartBtn'||el.id==='mls-sg-athena') return true;
    var t=(el.textContent||'').replace(/\s+/g,' ').trim();
    if(t.length>60) return false;
    return /pull from athenaone|pull visits from athena|pull the chart into mls|pull open athena patient/i.test(t);
  }
  document.addEventListener('click', function(ev){
    try{
      var el=ev.target && ev.target.closest ? ev.target.closest("button,a,[role=button],div,span") : null;
      var hops=0;
      while(el && hops<4){ if(isPullTrigger(el)){ start(); break; } el=el.parentElement; hops++; }
    }catch(e){}
  }, true);
})();


/* feat_wb_defaults — make athenaOne writeback work by DEFAULT so the "Show me where" teach flow is
   a last resort, not a gate (Michael: defaults should already work; teaching is last resort).
   (1) Ensures all four destinations have a default target section in mlsWbPrefs:default — including
   the previously-missing Diagnoses/ICD-10 (defaults to the encounter "Assessment" section).
   (2) Rewrites the teach modal's misleading "No location taught for X yet" into a message that says
   the default is active and teaching is optional. Additive, reversible, no clinical write occurs. */
(function(){
  "use strict";
  if(window.__mlsWbDefaults) return; window.__mlsWbDefaults=true;
  // 1) seed defaults for every destination (only fills gaps; never overwrites a user's setting)
  try{
    var K='mlsWbPrefs:default';
    var d=JSON.parse(localStorage.getItem(K)||'{}')||{};
    if(!d.note)   d.note={sectionName:'Clinical note'};
    if(!d.opnote) d.opnote={tab:'PE',sectionName:'Procedure Documentation',template:'Injection Generic Template',addTemplate:true,clearFirst:true};
    if(!d.cpt)    d.cpt={sectionName:'Orders / Procedure codes (CPT)'};
    if(!d.dx)     d.dx={sectionName:'Assessment'};   // NEW: Diagnoses / ICD-10 default (encounter Assessment)
    localStorage.setItem(K, JSON.stringify(d));
  }catch(e){}
  // 2) demote the teach "No location taught yet" wall to "using default (optional to teach)"
  var RE=/No location taught for .* yet/i;
  function patchTeachMsg(){
    try{
      var all=document.querySelectorAll('div,p,span,section,li');
      for(var i=0;i<all.length;i++){
        var e=all[i];
        if(e.__mlsWbPatched) continue;
        var t=e.textContent||'';
        if(!RE.test(t)) continue;
        var childHas=false;
        for(var c=0;c<e.children.length;c++){ if(RE.test(e.children[c].textContent||'')){ childHas=true; break; } }
        if(childHas) continue; // only patch the tightest container
        e.__mlsWbPatched=true;
        e.innerHTML='✓ Using your default location for this destination — teaching is optional. Use “Show me where” only if you want to override the default.';
      }
    }catch(e){}
  }
  var last=0, pend=false;
  function schedule(){ if(pend) return; pend=true; (window.requestAnimationFrame||setTimeout)(function(){ pend=false; var n=Date.now(); if(n-last<300) return; last=n; patchTeachMsg(); }); }
  patchTeachMsg();
  try{ new MutationObserver(schedule).observe(document.documentElement,{subtree:true,childList:true,characterData:true}); }catch(e){}
})();


/* feat_today_noblink — kill the distracting blink/pulse on the "Today" buttons (Michael: it's
   annoying). Cosmetic, additive, reversible. Forces no CSS animation on the Today buttons and
   strips any blink/pulse/flash/attention class or inline animation the app toggles when the
   view is off "today". Debounced observer + a slow interval keep it enforced without churn. */
(function(){"use strict";
  if(window.__mlsNoTodayBlink)return; window.__mlsNoTodayBlink=true;
  var CSS_SEL=".cx-todaybtn,.as-daybtn,.cx-navbtn.today,button.today,.today-btn";
  var CLS_TEST=/\b(blink|pulse|flash|glow|throb|attention|alert|cblink|ezpulse|nudge|highlight)\b/i;
  var CLS_REPL=/\b(blink|pulse|flash|glow|throb|attention|alert|cblink|ezpulse|nudge|highlight)\b/gi;
  function isToday(e){try{return (e.textContent||"").replace(/\s+/g," ").trim()==="Today";}catch(_){return false;}}
  function targets(){
    var out=[];
    try{[].slice.call(document.querySelectorAll(CSS_SEL)).forEach(function(e){out.push(e);});}catch(_){}
    try{[].slice.call(document.querySelectorAll("button,[role=button]")).forEach(function(e){if(isToday(e))out.push(e);});}catch(_){}
    return out;
  }
  try{
    var st=document.getElementById("mls-no-today-blink")||document.createElement("style");
    st.id="mls-no-today-blink";
    st.textContent=CSS_SEL+"{animation:none !important;}"+CSS_SEL+"::before,"+CSS_SEL+"::after{animation:none !important;}";
    (document.head||document.documentElement).appendChild(st);
  }catch(e){}
  function scrub(){
    targets().forEach(function(e){
      try{
        if(typeof e.className==="string" && CLS_TEST.test(e.className)){ e.className=e.className.replace(CLS_REPL," ").replace(/\s+/g," ").trim(); }
        if(e.style){ if(e.style.animation) e.style.animation="none"; if(e.style.animationName) e.style.animationName="none"; }
      }catch(_){}
    });
  }
  var pending=false;
  function schedule(){ if(pending)return; pending=true; (window.requestAnimationFrame||setTimeout)(function(){pending=false; scrub();}); }
  scrub();
  try{ new MutationObserver(schedule).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:["class","style"],childList:true}); }catch(e){}
  setInterval(scrub, 1500);
})();



/* ===== feat_pull_date_fix (inlined) ===== */
/* feat_pull_date_fix — make pulled Athena appointments land on the DAY THEY WERE PULLED FOR, not
   "today" (2026-07-03 fix for the "Monday shows no patients" bug). The app's import stamps the
   pull with today's date; the correct schedule date can't be fixed in the import directly (that code
   is security-blocked from editing), so this records the intended date per pulled appointment in
   localStorage and re-applies it to window._calAppts on every load — a persistent display correction
   that makes the calendar / Who's Next / Days-worked show the right day. Additive/safe/read-only to Athena. */
(function(){
  "use strict";
  if(window.__mlsPullDateFix) return; window.__mlsPullDateFix=true;
  var LS="mls_pull_date_map";

  function loadMap(){ try{ return JSON.parse(localStorage.getItem(LS)||"{}")||{}; }catch(e){ return {}; } }
  function saveMap(m){ try{ localStorage.setItem(LS, JSON.stringify(m)); }catch(e){} }
  function pickerDate(){
    var i=document.querySelector(".as-date")||document.querySelector(".mlsnu-date")||document.querySelector('input[type=date]');
    return (i&&/^\d{4}-\d{2}-\d{2}$/.test(i.value))?i.value:null;
  }
  function restamp(x, date){
    if(!x||!date) return false;
    var ch=false;
    if(x.appt_date!==date){ x.appt_date=date; ch=true; }
    if(x.start_at){ var s=String(x.start_at).replace(/^\d{4}-\d{2}-\d{2}/, date); if(s!==x.start_at){ x.start_at=s; ch=true; } }
    if(x.end_at){ var e=String(x.end_at).replace(/^\d{4}-\d{2}-\d{2}/, date); if(e!==x.end_at){ x.end_at=e; ch=true; } }
    return ch;
  }
  function applyMap(){
    try{
      var m=loadMap(); var a=window._calAppts; if(!Array.isArray(a)) return;
      for(var i=0;i<a.length;i++){ var x=a[i]; if(x && x.id!=null && m[x.id]) restamp(x, m[x.id]); }
    }catch(e){}
  }

  // When a schedule pull is triggered, remember the day it was for and re-date the appts it adds.
  document.addEventListener("click", function(ev){
    try{
      var b=ev.target && ev.target.closest ? ev.target.closest("button,a,[role=button]") : null;
      if(!b) return;
      if(!/pull from athenaone/i.test((b.textContent||""))) return;
      var date=pickerDate(); if(!date) return;
      var before={}; (window._calAppts||[]).forEach(function(x){ if(x&&x.id!=null) before[x.id]=1; });
      var tries=0;
      var iv=setInterval(function(){
        tries++;
        var m=loadMap(), changed=false;
        (window._calAppts||[]).forEach(function(x){
          if(x && x.id!=null && !before[x.id]){ if(m[x.id]!==date){ m[x.id]=date; changed=true; } restamp(x, date); }
        });
        if(changed) saveMap(m);
        if(tries>50) clearInterval(iv);   // ~50s window for a big multi-provider pull
      }, 1000);
    }catch(e){}
  }, true);

  applyMap();
  setInterval(applyMap, 2000);
})();

/* ===== end feat_pull_date_fix ===== */

/* ===== feat_pull_cleanup (inlined) ===== */
/* feat_pull_cleanup — clean up scraped Athena schedule data client-side (2026-07-03).
   Fixes bug #2 from the first real clinic-day pull: provider names came in with the column-header
   "× Close" control text appended (e.g. "Edwards_Lindsay_PA-CClose"). That broke provider-scoped
   matching (Who's Next, Days worked/patient volume). This strips the trailing Close/× artifact from
   provider names on window._calAppts (and the provider list) continuously + on load. Additive/safe.
   NOTE: bugs #1 (wrong date stamp = app-today instead of the Athena schedule date) and #3 (only the
   visible provider columns get scraped) are EXTENSION-side scrape fixes — the page can't read Athena
   cross-origin — and are tracked for the next extension build. */
(function(){
  "use strict";
  if(window.__mlsPullClean) return; window.__mlsPullClean=true;

  function cleanProv(p){
    if(p==null) return p;
    var s=String(p);
    // strip a trailing "Close" (column-header × Close button) and any stray control glyphs / whitespace
    s=s.replace(/\s*Close\s*$/,'');
    s=s.replace(/[×✕✖✗✘xX]\s*$/,'');
    return s.replace(/\s+$/,'').trim();
  }

  function clean(){
    try{
      var a=window._calAppts;
      if(Array.isArray(a)){
        for(var i=0;i<a.length;i++){
          var x=a[i];
          if(x && x.provider){ var c=cleanProv(x.provider); if(c && c!==x.provider) x.provider=c; }
        }
      }
      var pl=window._calProviders;
      if(Array.isArray(pl)){
        for(var j=0;j<pl.length;j++){
          var p=pl[j];
          if(typeof p==="string"){ var cs=cleanProv(p); if(cs!==p) pl[j]=cs; }
          else if(p && typeof p==="object" && p.name){ var cn=cleanProv(p.name); if(cn!==p.name) p.name=cn; }
        }
      }
    }catch(e){}
  }

  clean();
  setInterval(clean, 2000);
})();

/* ===== end feat_pull_cleanup ===== */

/* ===== feat_queue_fixes_0703 (inlined) ===== */
/* feat_queue_fixes_0703 — three queue fixes (2026-07-03), all additive/reversible/guarded:
   (A) item 6/5: Who's Next strip must reflect the REAL Athena calendar (window._calAppts) for the
       viewing date + provider — NOT the stale 654-patient roster cache. Empty day => empty state.
       Correct AM/PM times (America/New_York from start_at UTC).
   (B) item 14: the "Upload templates" quick-action should OPEN the existing Templates panel
       (openTemplates()), not a bare file picker.
   (C) item 17: move the "Add a standard line to templates" block to the BOTTOM of the Templates modal. */
(function(){
  "use strict";
  if(window.__mlsQFix0703) return; window.__mlsQFix0703=true;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  /* ---------- (A) Who's Next reconcile ---------- */
  function viewDate(){
    var i=document.querySelector('.mlsnu-date')||document.querySelector('.as-date')||document.querySelector('input[type=date]');
    return (i&&i.value)?i.value:null; // YYYY-MM-DD
  }
  function providerName(){ var d=document.querySelector('#mlsPtfBox .ptf-doc'); return d?(d.textContent||'').trim():''; }
  function fmtTime(z){ try{ return new Date(z).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit',timeZone:'America/New_York'}); }catch(e){ return ''; } }
  function fmtDob(d){ if(!d) return ''; var m=String(d).match(/(\d{4})-(\d{2})-(\d{2})/); return m?(m[2]+'/'+m[3]+'/'+m[1]):String(d); }
  function todaysAppts(){
    var date=viewDate(), prov=providerName();
    var a=(window._calAppts||[]).filter(function(x){ return x&&x.appt_date===date && (!prov||(x.provider||'')===prov); });
    a.sort(function(p,q){ return String(p.start_at||'').localeCompare(String(q.start_at||'')); });
    return {date:date, prov:prov, list:a};
  }
  function sig(o){ return o.date+'|'+o.prov+'|'+o.list.length+'|'+o.list.map(function(x){return x.patient_external_id||x.name;}).join(','); }
  function pick(x){
    var fns=['_heroPickPatient','selectPatient','openPatient','calOpenPatientFor'];
    for(var i=0;i<fns.length;i++){ try{ if(typeof window[fns[i]]==='function'){ window[fns[i]](x); return; } }catch(e){} }
    try{ var nm=document.querySelector('#heroPtInput,input[placeholder*="First"],input[placeholder*="Patient name"]'); if(nm){ var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(nm),'value'); if(d&&d.set) d.set.call(nm,x.name||''); else nm.value=x.name||''; nm.dispatchEvent(new Event('input',{bubbles:true})); } }catch(e){}
  }
  function renderWN(){
    try{
      var box=document.getElementById('mlsPtfBox'); if(!box) return;
      var o=todaysAppts(); if(!o.date) return;
      var mySig=sig(o);
      if(box.getAttribute('data-mlsfix')===mySig) return; // already canonical
      var grid=box.querySelector('.ptf-grid'); var more=box.querySelector('.ptf-more'); var cnt=box.querySelector('.ptf-count');
      if(cnt) cnt.textContent=o.list.length+' patient'+(o.list.length===1?'':'s');
      if(more) more.style.display='none';
      if(!grid){ grid=document.createElement('div'); grid.className='ptf-grid'; box.appendChild(grid); }
      grid.innerHTML='';
      if(o.list.length===0){
        var e=document.createElement('div'); e.className='ptf-empty';
        e.style.cssText='padding:10px 6px;color:#6b7a8c;font-size:13px';
        e.textContent='No patients on the Athena calendar for this day.';
        grid.appendChild(e);
      } else {
        o.list.forEach(function(x){
          var c=document.createElement('div'); c.className='ptf-chip'; c.style.cursor='pointer';
          c.innerHTML='<div class="ptf-nm" style="font-weight:700">'+esc(x.name||'Patient')+'</div><div class="ptf-sub" style="font-size:12px;opacity:.8">'+esc(fmtTime(x.start_at))+' / DOB '+esc(fmtDob(x.dob))+'</div>';
          c.addEventListener('click',function(){ pick(x); });
          grid.appendChild(c);
        });
      }
      box.setAttribute('data-mlsfix',mySig);
    }catch(e){}
  }

  /* ---------- (B) Upload-templates quick action -> open Templates panel ---------- */
  function openTemplatesPanel(){
    try{ if(typeof window.openTemplates==='function'){ window.openTemplates(); return true; } }catch(e){}
    try{ var b=document.getElementById('templatesBtn'); if(b){ b.click(); return true; } }catch(e){}
    return false;
  }
  document.addEventListener('click', function(ev){
    try{
      var t=ev.target && ev.target.closest ? ev.target.closest('button,a,[role=button]') : null;
      if(!t) return;
      var txt=(t.textContent||'').trim();
      if(!/upload templates/i.test(txt)) return;
      if(t.closest('#templatesModal')) return;           // leave the modal's own upload button alone
      if(/\.txt|\.md|folder/i.test(txt)) return;          // that's the file-type-specific one
      // this is the quick-action "📤 Upload templates" -> open the full panel instead
      ev.preventDefault(); ev.stopImmediatePropagation();
      openTemplatesPanel();
    }catch(e){}
  }, true);

  /* ---------- (C) Move "Add a standard line" block to bottom of Templates modal ---------- */
  function moveStandardLine(){
    try{
      var modal=document.getElementById('templatesModal');
      if(!modal || modal.getBoundingClientRect().width<5) return; // only when open/visible
      // find heading "Add a standard line to templates"
      var head=[].slice.call(modal.querySelectorAll('*')).find(function(el){
        return /add a standard line to templates/i.test((el.childNodes[0]&&el.childNodes[0].textContent)||el.textContent||'') && el.children.length<6;
      });
      if(!head) return;
      var card=head;
      for(var i=0;i<6 && card && card.parentElement; i++){
        if(card.querySelector && card.querySelector('textarea') && /save standard line/i.test(card.textContent||'')) break;
        card=card.parentElement;
      }
      if(!card || card===modal) return;
      var container=card.parentElement; if(!container) return;
      if(card.getAttribute('data-mlsmoved')==='1') return;
      if(container.lastElementChild!==card){ container.appendChild(card); }
      card.setAttribute('data-mlsmoved','1');
    }catch(e){}
  }

  setInterval(function(){ renderWN(); moveStandardLine(); }, 700);
  try{ new MutationObserver(function(){ moveStandardLine(); }).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
})();

/* ===== end feat_queue_fixes_0703 ===== */

/* ===== feat_days_worked (inlined) ===== */
/* feat_days_worked — "Days worked / patient volume" tool on the Analysis page (2026-07-03, Dad's request:
   "how some doctors get paid"). Adds a card to #analysisView; opens a monthly table showing DAYS WORKED
   (distinct appointment dates) and PATIENTS SEEN (distinct patients) per provider (separately) AND combined,
   computed client-side from window._calAppts. Fills in as more months are pulled from Athena. Read-only/safe. */
(function(){
  "use strict";
  if(window.__mlsDaysWorked) return; window.__mlsDaysWorked=true;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }

  function compute(){
    var a=(window._calAppts||[]).filter(function(x){ return x&&x.provider&&x.appt_date; });
    var months={}, provs={};
    a.forEach(function(x){
      var mo=String(x.appt_date).slice(0,7);
      var pr=x.provider; provs[pr]=1;
      var pat=x.patient_external_id||x.mrn||x.name||x.id||'?';
      months[mo]=months[mo]||{};
      months[mo][pr]=months[mo][pr]||{days:{},pats:{}};
      months[mo][pr].days[x.appt_date]=1; months[mo][pr].pats[pat]=1;
      months[mo].__all=months[mo].__all||{days:{},pats:{}};
      months[mo].__all.days[x.appt_date]=1; months[mo].__all.pats[pat]=1;
    });
    return { months:months, providers:Object.keys(provs).sort() };
  }
  function monthName(mo){ try{ return new Date(mo+'-01T12:00:00').toLocaleDateString('en-US',{month:'long',year:'numeric'}); }catch(e){ return mo; } }

  function openModal(){
    if(document.getElementById('mlsDWBack')) return;
    var c=compute(), provs=c.providers, months=Object.keys(c.months).sort().reverse();
    var back=document.createElement('div'); back.id='mlsDWBack';
    back.style.cssText='position:fixed;inset:0;background:rgba(10,30,60,.5);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:16px;max-width:860px;width:100%;max-height:86vh;overflow:auto;padding:22px;box-shadow:0 12px 44px rgba(0,0,0,.32)';
    var h='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><div style="font-weight:800;font-size:18px;color:#15528f">📊 Days worked / patient volume</div><button id="mlsDWClose" style="border:none;background:#eef4fc;color:#15528f;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer">Close</button></div>';
    h+='<div style="font-size:12.5px;color:#5b6b7c;margin-bottom:14px">Days worked = distinct appointment dates. Patients seen = distinct patients. Per provider and combined, by month. Pull past months from Athena to fill in history.</div>';
    if(!months.length){
      h+='<div style="padding:22px;text-align:center;color:#5b6b7c">No provider-linked appointment data yet.<br>Pull today’s / past months’ patients from Athena, then reopen this.</div>';
    } else {
      h+='<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="text-align:left;color:#15528f"><th style="padding:6px 8px;border-bottom:2px solid #e4ebf3">Month</th>';
      provs.forEach(function(p){ h+='<th style="padding:6px 8px;border-bottom:2px solid #e4ebf3" colspan="2">'+esc(p)+'</th>'; });
      h+='<th style="padding:6px 8px;border-bottom:2px solid #e4ebf3" colspan="2">Combined</th></tr>';
      h+='<tr style="text-align:left;color:#5b6b7c;font-size:11px"><th></th>';
      provs.forEach(function(){ h+='<th style="padding:2px 8px">Days</th><th style="padding:2px 8px">Patients</th>'; });
      h+='<th style="padding:2px 8px">Days</th><th style="padding:2px 8px">Patients</th></tr></thead><tbody>';
      months.forEach(function(mo){
        h+='<tr><td style="padding:6px 8px;border-bottom:1px solid #eef2f7;font-weight:700">'+esc(monthName(mo))+'</td>';
        provs.forEach(function(p){ var d=c.months[mo][p]; h+='<td style="padding:6px 8px;border-bottom:1px solid #eef2f7">'+(d?Object.keys(d.days).length:0)+'</td><td style="padding:6px 8px;border-bottom:1px solid #eef2f7">'+(d?Object.keys(d.pats).length:0)+'</td>'; });
        var all=c.months[mo].__all;
        h+='<td style="padding:6px 8px;border-bottom:1px solid #eef2f7;font-weight:700">'+(all?Object.keys(all.days).length:0)+'</td><td style="padding:6px 8px;border-bottom:1px solid #eef2f7;font-weight:700">'+(all?Object.keys(all.pats).length:0)+'</td></tr>';
      });
      h+='</tbody></table>';
    }
    box.innerHTML=h; back.appendChild(box); document.body.appendChild(back);
    function close(){ var b=document.getElementById('mlsDWBack'); if(b) b.remove(); }
    box.querySelector('#mlsDWClose').onclick=close;
    back.addEventListener('click',function(e){ if(e.target===back) close(); });
  }

  function inject(){
    try{
      var grid=document.getElementById('analysisView');
      if(!grid) return;
      if(grid.getBoundingClientRect().width < 5) return;   // only when Analysis view is visible
      if(document.getElementById('mlsDWCard')) return;
      var model=[].slice.call(grid.children).filter(function(c){ return /(^|\s)card(\s|$)/.test((c.className||'').toString()); })[0];
      var card = (model && model.cloneNode) ? model.cloneNode(false) : document.createElement('div');
      if(!card.className) card.className='card';
      card.id='mlsDWCard';
      card.innerHTML='<div style="font-weight:800;color:#15528f;font-size:14px">📊 Days worked/patient volume</div><div style="font-size:12px;color:#5b6b7c;margin:6px 0 10px">Days worked &amp; patients seen per provider, by month — separately &amp; combined.</div><button id="mlsDWOpen" type="button" style="border:none;background:#1f7ae0;color:#fff;border-radius:8px;padding:7px 13px;font-weight:700;cursor:pointer;font-family:inherit">Open</button>';
      card.querySelector('#mlsDWOpen').addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); openModal(); });
      grid.appendChild(card);
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
})();

/* ===== end feat_days_worked ===== */
/* feat_agent_actions3 — MLS Agent one-tap actions (item #3, 2026-07-03). Supersedes v2:
   the panel is position:fixed so offsetParent is null even when open — use bounding-rect width to
   detect "open" instead. Runs first + sets the shared guard so the older v2 below no-ops. Additive/safe. */
(function(){
  "use strict";
  if(window.__mlsAgentActions) return; window.__mlsAgentActions=true;

  function agentSend(text){
    try{
      var i=document.getElementById('mlsP1AgQ'), s=document.getElementById('mlsP1AgSend');
      if(!i||!s) return;
      var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i),'value');
      if(d&&d.set) d.set.call(i,text); else i.value=text;
      i.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){ try{ s.click(); }catch(e){} }, 60);
    }catch(e){}
  }

  var ACTIONS=[
    { label:'📧 Send portal login', run:function(){
        var b=document.getElementById('mlsPortalInviteBtn');
        if(b){ b.click(); } else { alert('Select a patient first, then tap “Send portal login”.'); }
    }},
    { label:'🗓️ Prep tomorrow’s op notes', run:function(){ agentSend('Prep all of tomorrow’s op notes'); } },
    { label:'📥 Pull today’s patients', run:function(){ agentSend('Run the Athena pull for today'); } }
  ];

  function inject(){
    try{
      var inRow=document.getElementById('mlsP1AgIn');
      if(!inRow) return;
      if(inRow.getBoundingClientRect().width < 5) return;   // panel not open/visible yet
      if(document.getElementById('mlsAgentActBar')) return; // idempotent
      var bar=document.createElement('div');
      bar.id='mlsAgentActBar';
      bar.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px 6px';
      ACTIONS.forEach(function(a){
        var b=document.createElement('button');
        b.type='button'; b.textContent=a.label; b.setAttribute('data-mlsagentact','1');
        b.style.cssText='font-size:12px;border:1px solid #cfe0f3;background:#fff;color:#15528f;border-radius:999px;padding:5px 10px;cursor:pointer;font-family:inherit;line-height:1.2';
        b.addEventListener('mouseenter',function(){ b.style.background='#e2edfa'; });
        b.addEventListener('mouseleave',function(){ b.style.background='#fff'; });
        b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); a.run(); });
        bar.appendChild(b);
      });
      inRow.parentNode.insertBefore(bar, inRow);
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1200);
})();


/* feat_agent_actions2 — one-tap actions in the 🤖 MLS Agent (item #3, 2026-07-03).
   Additive + safe. Inserts a chip bar above the Agent's input row (#mlsP1AgIn inside panel #mlsP1Ag).
   "📧 Send portal login" opens the existing portal-invite for the active patient; the other chips type
   a plain command into the Agent's real input (#mlsP1AgQ) and click send (#mlsP1AgSend), using the
   Agent's own engine. Nothing signs/sends to Athena on its own. */
(function(){
  "use strict";
  if(window.__mlsAgentActions) return; window.__mlsAgentActions=true;

  function agentSend(text){
    try{
      var i=document.getElementById('mlsP1AgQ'), s=document.getElementById('mlsP1AgSend');
      if(!i||!s) return;
      var d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(i),'value');
      if(d&&d.set) d.set.call(i,text); else i.value=text;
      i.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){ try{ s.click(); }catch(e){} }, 60);
    }catch(e){}
  }

  var ACTIONS=[
    { label:'📧 Send portal login', run:function(){
        var b=document.getElementById('mlsPortalInviteBtn');
        if(b){ b.click(); } else { alert('Select a patient first, then tap “Send portal login”.'); }
    }},
    { label:'🗓️ Prep tomorrow’s op notes', run:function(){ agentSend('Prep all of tomorrow’s op notes'); } },
    { label:'📥 Pull today’s patients', run:function(){ agentSend('Run the Athena pull for today'); } }
  ];

  function inject(){
    try{
      var panel=document.getElementById('mlsP1Ag'), inRow=document.getElementById('mlsP1AgIn');
      if(!panel || !inRow || panel.offsetParent===null) return;   // only when the Agent panel is open
      if(document.getElementById('mlsAgentActBar')) return;       // idempotent
      var bar=document.createElement('div');
      bar.id='mlsAgentActBar';
      bar.style.cssText='display:flex;flex-wrap:wrap;gap:6px;padding:4px 8px 6px';
      ACTIONS.forEach(function(a){
        var b=document.createElement('button');
        b.type='button'; b.textContent=a.label; b.setAttribute('data-mlsagentact','1');
        b.style.cssText='font-size:12px;border:1px solid #cfe0f3;background:#fff;color:#15528f;border-radius:999px;padding:5px 10px;cursor:pointer;font-family:inherit;line-height:1.2';
        b.addEventListener('mouseenter',function(){ b.style.background='#e2edfa'; });
        b.addEventListener('mouseleave',function(){ b.style.background='#fff'; });
        b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); a.run(); });
        bar.appendChild(b);
      });
      inRow.parentNode.insertBefore(bar, inRow);
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
})();


/* feat_copilot_draft — one-tap "draft on command" quick-actions in the Copilot (item #2, 2026-07-03).
   Additive + safe: adds draft chips next to the Copilot's existing quick chips. Clicking one drops a
   strong drafting prompt (for the ACTIVE patient) into the Copilot input and sends it — using the
   Copilot's existing send path + patient context. No fetch wrapping, no data changes. */
(function(){
  "use strict";
  if(window.__mlsCopilotDraft) return; window.__mlsCopilotDraft=true;

  function activeName(){
    try{ var ap=window.activePatient; if(typeof ap==='function') ap=ap(); return (ap&&ap.name)?ap.name:null; }catch(e){ return null; }
  }

  var DRAFTS = [
    { label:'✍️ Draft op note', prompt:function(n){ return 'Draft a complete operative note for '+(n||'the active patient')+' for their planned/most recent procedure. Use standard operative-note structure: Preoperative diagnosis, Postoperative diagnosis, Procedure, Surgeon, Assistant, Anesthesia, Indications, Findings, Technique (numbered operative steps), Implants/Instrumentation, Estimated blood loss, Complications, Specimens, Disposition. Pull the procedure and clinical details from this patient’s record; wherever a specific detail is not documented, insert a clearly-marked [fill in] placeholder rather than inventing it.'; } },
    { label:'✍️ After-visit summary', prompt:function(n){ return 'Write a clear, patient-friendly after-visit summary for '+(n||'the active patient')+' based on their record and today’s visit: what we discussed, any diagnosis in plain language, medication changes, instructions/precautions, and next steps / follow-up. Warm, plain English, no jargon.'; } },
    { label:'✍️ Referral letter', prompt:function(n){ return 'Draft a referral letter to physical therapy for '+(n||'the active patient')+' based on their spine/pain diagnoses and history. Include the referring diagnosis with ICD-10 if known, brief relevant history and exam, precautions, and specific PT goals/frequency. Professional letter format.'; } }
  ];

  function sendPrompt(text){
    try{
      if(typeof window.openCopilotDock==='function') window.openCopilotDock();
      var input=document.getElementById('copilotInput');
      var send=document.getElementById('copilotSendBtn');
      if(!input||!send) return;
      var set=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input),'value');
      if(set&&set.set) set.set.call(input,text); else input.value=text;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      setTimeout(function(){ try{ send.click(); }catch(e){} }, 60);
    }catch(e){}
  }

  function inject(){
    try{
      var wrap=document.getElementById('copilotChips');
      if(!wrap) return;
      // only add once the app's own chips are present (dock open) and ours aren't
      if(wrap.children.length===0) return;
      if(wrap.querySelector('[data-mlsdraft]')) return;
      var model=wrap.children[0]; // clone an existing chip for native styling
      var n=activeName();
      DRAFTS.forEach(function(d){
        var chip;
        if(model && model.cloneNode){ chip=model.cloneNode(true); chip.removeAttribute('id'); chip.textContent=d.label; }
        else { chip=document.createElement('button'); chip.textContent=d.label; chip.style.cssText='font-size:12.5px;border:1px solid #cfe0f3;background:#fff;color:#15528f;border-radius:999px;padding:6px 11px;cursor:pointer;margin:3px'; }
        chip.setAttribute('data-mlsdraft','1');
        chip.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); sendPrompt(d.prompt(activeName())); }, true);
        wrap.appendChild(chip);
      });
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
  if(document.readyState!=='loading') inject(); else document.addEventListener('DOMContentLoaded', inject);
})();


/* feat_delall_guard — strong "type DELETE" confirmation on the Delete-ALL-templates button (item 18, 2026-07-03).
   Intercepts clicks on the delete-all-templates control, blocks the immediate wipe, and requires the user to
   type DELETE. Only then does it clear via the app's own setTemplates([]) + renderTemplateList(). Protects the
   doctor's uploaded templates from an accidental one-click wipe. */
(function(){
  "use strict";
  if(window.__mlsDelGuard) return; window.__mlsDelGuard=true;

  function isDelAll(el){
    var n=0;
    while(el && el.nodeType===1 && n<5){
      if(el.id==='mlsP1DelAll') return el;
      if(el.tagName==='BUTTON'){
        var t=(el.textContent||'').toLowerCase();
        if(t.indexOf('delete')>=0 && t.indexOf('template')>=0 && (t.indexOf('all')>=0 || t.indexOf('every')>=0)) return el;
      }
      el=el.parentElement; n++;
    }
    return null;
  }

  document.addEventListener('click', function(e){
    var btn=isDelAll(e.target);
    if(!btn) return;
    e.preventDefault(); e.stopImmediatePropagation();
    openModal();
  }, true);

  function count(){ try{ return (typeof window.getTemplates==='function') ? (window.getTemplates()||[]).length : null; }catch(e){ return null; } }

  function doDelete(){
    var ok=false;
    try{ if(typeof window.setTemplates==='function'){ window.setTemplates([]); ok=true; } }catch(e){}
    try{ if(typeof window.renderTemplateList==='function') window.renderTemplateList(); }catch(e){}
    // verify + last-resort fallback on the known storage keys (per-user + shared)
    var left=count();
    if(left && left>0){
      try{
        localStorage.removeItem('mls_playbooks');
        for(var i=localStorage.length-1;i>=0;i--){ var k=localStorage.key(i); if(k && /::templates$/.test(k)) localStorage.removeItem(k); }
        if(typeof window.renderTemplateList==='function') window.renderTemplateList();
        ok=true;
      }catch(e){}
    }
    return count()===0 || ok;
  }

  function openModal(){
    if(document.getElementById('mlsDelBack')) return;
    var n=count();
    var back=document.createElement('div');
    back.id='mlsDelBack';
    back.style.cssText='position:fixed;inset:0;background:rgba(10,30,60,.5);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:16px;max-width:430px;width:100%;padding:22px;box-shadow:0 12px 44px rgba(0,0,0,.32)';
    box.innerHTML=''
      +'<div style="font-weight:800;font-size:17px;color:#a12626;margin-bottom:6px">🗑 Delete all templates?</div>'
      +'<div style="font-size:13.5px;color:#5b6b7c;margin-bottom:14px">This permanently removes <b>'+(n==null?'all':n)+'</b> template'+(n===1?'':'s')+'. This cannot be undone. Type <b>DELETE</b> to confirm.</div>'
      +'<input id="mlsDelInput" type="text" placeholder="Type DELETE" autocomplete="off" style="width:100%;padding:11px 12px;border:1px solid #e4ebf3;border-radius:10px;font-size:15px;box-sizing:border-box;letter-spacing:1px" />'
      +'<div id="mlsDelMsg" style="font-size:13px;margin-top:12px;display:none;color:#0f6b49"></div>'
      +'<div style="display:flex;gap:8px;margin-top:18px">'
      +'  <button id="mlsDelCancel" type="button" style="flex:1;padding:11px;border:1px solid #e4ebf3;background:#eef4fc;color:#15528f;border-radius:10px;font-weight:700;cursor:pointer">Cancel</button>'
      +'  <button id="mlsDelGo" type="button" disabled style="flex:1;padding:11px;border:none;background:#d9534f;color:#fff;border-radius:10px;font-weight:700;cursor:pointer;opacity:.5">Delete all</button>'
      +'</div>';
    back.appendChild(box); document.body.appendChild(back);
    var input=box.querySelector('#mlsDelInput');
    var go=box.querySelector('#mlsDelGo');
    var msg=box.querySelector('#mlsDelMsg');
    function close(){ var b=document.getElementById('mlsDelBack'); if(b) b.remove(); }
    input.addEventListener('input', function(){
      var ok=input.value.trim().toUpperCase()==='DELETE';
      go.disabled=!ok; go.style.opacity=ok?'1':'.5';
    });
    box.querySelector('#mlsDelCancel').onclick=close;
    back.addEventListener('click', function(e){ if(e.target===back) close(); });
    go.onclick=function(){
      if(input.value.trim().toUpperCase()!=='DELETE') return;
      go.disabled=true; go.textContent='Deleting…';
      var ok=doDelete();
      msg.style.display='block';
      if(ok){ msg.style.color='#0f6b49'; msg.textContent='✓ All templates deleted.'; setTimeout(close,1400); }
      else { msg.style.color='#a12626'; msg.textContent='Could not delete — please try again.'; go.disabled=false; go.textContent='Delete all'; }
    };
    setTimeout(function(){ try{ input.focus(); }catch(e){} }, 50);
  }
})();


/* feat_upload_templates — easy "Upload templates" button by the Prep-op-note action (item 14, 2026-07-02).
   Additive + safe: it only opens the app's EXISTING multi-file template picker (#tplMultiFileInput),
   so the app's own upload/processing handler runs. No data is deleted or changed. */
(function(){
  "use strict";
  if(window.__mlsUplTpl) return; window.__mlsUplTpl=true;

  function trigger(){
    var i=document.getElementById('tplMultiFileInput')||document.getElementById('tplFileInput');
    if(i){ try{ i.click(); }catch(e){} }
    else { alert('Open the Templates section to upload your templates.'); }
  }

  function makeBtn(){
    var b=document.createElement('button');
    b.type='button'; b.id='mlsUplTplBtn';
    b.textContent='📤 Upload templates';
    b.title='Add your own note templates (pick multiple files at once)';
    b.style.cssText='margin:10px 0 2px;display:inline-flex;align-items:center;gap:6px;background:#eef4fc;border:1px solid #cfe0f3;color:#15528f;border-radius:10px;padding:8px 13px;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit;line-height:1.2';
    b.addEventListener('mouseenter',function(){ b.style.background='#e2edfa'; });
    b.addEventListener('mouseleave',function(){ b.style.background='#eef4fc'; });
    b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); trigger(); });
    return b;
  }

  function findAnchor(){
    var els=document.querySelectorAll('button, a, div');
    for(var i=0;i<els.length;i++){
      var t=(els[i].innerText||'').trim();
      if(t && t.length<70 && /prep op note/i.test(t)) return els[i];
    }
    return null;
  }

  function inject(){
    try{
      if(document.getElementById('mlsUplTplBtn')) return;
      var anchor=findAnchor();
      if(!anchor) return;
      // climb to a card-sized ancestor so the button sits under the whole quick-action card
      var card=anchor;
      for(var k=0;k<3 && card.parentElement;k++){
        if(card.getBoundingClientRect().height>44) break;
        card=card.parentElement;
      }
      if(!card.parentNode) return;
      card.parentNode.insertBefore(makeBtn(), card.nextSibling);
    }catch(e){}
  }

  try{ new MutationObserver(inject).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
  if(document.readyState!=='loading') inject(); else document.addEventListener('DOMContentLoaded', inject);
})();


/* feat_docselect_merge — MLS Easy: consolidate the doctor controls into ONE clean pill (2026-07-02).
   Before: a "Pulling as: [doctor] v" chip PLUS a separate "Find Doctors" button = clutter.
   After: one pill — the chip keeps its native provider dropdown, and a small "+ find a doctor"
   is folded INSIDE it (proxies the original Find Doctors, which stays functional but hidden).
   Pure DOM/CSS + click-proxy; never reimplements provider switching, so the Athena pull is safe. */
(function(){
  "use strict";
  if(window.__mlsDocMerge) return; window.__mlsDocMerge=true;

  function apply(){
    try{
      var chip=document.getElementById('mlsProvChip');
      var find=document.getElementById('mlsFindDocBtn');
      if(!chip) return;

      // Keep the real Find Doctors button in the DOM (its picker still works when clicked
      // programmatically) but hide it so there's only one visible control.
      if(find && find.style.display!=='none'){ find.style.display='none'; }

      // Make the chip read as one tidy pill.
      try{
        chip.style.display='inline-flex';
        chip.style.alignItems='center';
        chip.style.gap='2px';
        chip.style.cursor='pointer';
      }catch(e){}

      // Fold a compact "find a doctor" affordance INSIDE the chip (once).
      if(!chip.querySelector('#mlsFindInline')){
        var sep=document.createElement('span');
        sep.id='mlsFindInlineSep';
        sep.textContent='·';
        sep.style.cssText='margin:0 4px 0 8px;color:#9bb4d1';
        var b=document.createElement('span');
        b.id='mlsFindInline';
        b.textContent='🔍 find a doctor';
        b.title='Search all doctors in the practice';
        b.setAttribute('role','button');
        b.style.cssText='color:#1f7ae0;font-weight:700;font-size:12px;cursor:pointer;white-space:nowrap';
        b.addEventListener('click',function(e){
          e.preventDefault(); e.stopPropagation();
          var f=document.getElementById('mlsFindDocBtn');
          if(f){ try{ f.style.display=''; }catch(_){}
                 f.click();
                 try{ f.style.display='none'; }catch(_){}
          }
        });
        chip.appendChild(sep);
        chip.appendChild(b);
      }
    }catch(e){}
  }

  try{ new MutationObserver(apply).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(apply, 1500);
  if(document.readyState!=='loading') apply(); else document.addEventListener('DOMContentLoaded', apply);
})();


/* feat_portal_invite — doctor "Send portal login" button on the active patient (2026-07-02).
   Self-contained IIFE. Adds a pill button next to the active-patient chip; clicking opens a
   small in-app popup to email the patient a one-time secure portal login. Reuses the app's
   own MLS session token (localStorage sf_bk_token). No page navigation. */
(function(){
  "use strict";
  if(window.__mlsPortalInvite) return; window.__mlsPortalInvite=true;
  var API="https://scrivara-backend.onrender.com";

  function tok(){ try{ return localStorage.getItem('sf_bk_token'); }catch(e){ return null; } }
  function active(){ try{ var ap=window.activePatient; if(typeof ap==='function') ap=ap(); return (ap&&typeof ap==='object')?ap:null; }catch(e){ return null; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  function findEmail(ap){
    try{
      if(!ap) return '';
      if(ap.email) return ap.email;
      var list=(typeof window.getPatients==='function')?window.getPatients():null;
      if(Array.isArray(list)){
        var m=list.filter(function(p){ return p && (p.id===ap.id || (p.name===ap.name && p.dob===ap.dob)); })[0];
        if(m && m.email) return m.email;
      }
    }catch(e){}
    return '';
  }

  function openModal(ap){
    if(document.getElementById('mlsPiBack')) return;
    var email=findEmail(ap), nm=(ap&&ap.name)||'this patient';
    var back=document.createElement('div');
    back.id='mlsPiBack';
    back.style.cssText='position:fixed;inset:0;background:rgba(10,30,60,.45);z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif';
    var box=document.createElement('div');
    box.style.cssText='background:#fff;border-radius:16px;max-width:420px;width:100%;padding:22px;box-shadow:0 12px 44px rgba(0,0,0,.32)';
    box.innerHTML=''
      +'<div style="font-weight:800;font-size:17px;color:#15528f;margin-bottom:4px">📧 Send portal login</div>'
      +'<div style="font-size:13.5px;color:#5b6b7c;margin-bottom:14px">'+esc(nm)+' will get a secure email with a one-time link to view their records and chat with them.</div>'
      +'<label style="display:block;font-size:12.5px;font-weight:700;color:#15528f;margin-bottom:5px">Patient email</label>'
      +'<input id="mlsPiEmail" type="email" value="'+esc(email)+'" placeholder="patient@email.com" style="width:100%;padding:11px 12px;border:1px solid #e4ebf3;border-radius:10px;font-size:15px;box-sizing:border-box;color:#0d2338" />'
      +'<div id="mlsPiMsg" style="font-size:13px;margin-top:12px;display:none"></div>'
      +'<div style="display:flex;gap:8px;margin-top:18px">'
      +'  <button id="mlsPiCancel" type="button" style="flex:1;padding:11px;border:1px solid #e4ebf3;background:#eef4fc;color:#15528f;border-radius:10px;font-weight:700;cursor:pointer">Cancel</button>'
      +'  <button id="mlsPiSend" type="button" style="flex:2;padding:11px;border:none;background:#1f7ae0;color:#fff;border-radius:10px;font-weight:700;cursor:pointer">Send login</button>'
      +'</div>';
    back.appendChild(box); document.body.appendChild(back);
    var msg=box.querySelector('#mlsPiMsg');
    function showMsg(t,ok){ msg.style.display='block'; msg.textContent=t; msg.style.color=ok?'#0f6b49':'#a12626'; }
    function close(){ var b=document.getElementById('mlsPiBack'); if(b) b.remove(); }
    box.querySelector('#mlsPiCancel').onclick=close;
    back.addEventListener('click',function(e){ if(e.target===back) close(); });
    box.querySelector('#mlsPiSend').onclick=function(){
      var em=(box.querySelector('#mlsPiEmail').value||'').trim();
      if(!em){ showMsg('Please enter the patient’s email.',false); return; }
      var tk=tok();
      if(!tk){ showMsg('You’re signed out — sign back into MLS and try again.',false); return; }
      var btn=box.querySelector('#mlsPiSend'); btn.disabled=true; var old=btn.textContent; btn.textContent='Sending…';
      var body={ email:em, name:(ap&&ap.name)||'', dob:(ap&&ap.dob)||'', external_id:(ap&&ap.id)||'', mrn:(ap&&(ap.mrn||ap.id))||'' };
      fetch(API+'/api/patient/admin/send-portal-invite',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+tk},body:JSON.stringify(body)})
        .then(function(r){ return r.json().catch(function(){return {};}).then(function(j){ return {ok:r.ok,status:r.status,j:j}; }); })
        .then(function(res){
          if(res.ok){ showMsg('✓ Portal login sent to '+em+'.',true); setTimeout(close,1900); }
          else if(res.status===401||res.status===403){ showMsg('This account isn’t authorized to send invites (needs admin). Ask the owner to send it.',false); }
          else { showMsg((res.j&&(res.j.error||res.j.message))||('Could not send (error '+res.status+').'),false); }
        })
        .catch(function(){ showMsg('Network error — please try again.',false); })
        .then(function(){ btn.disabled=false; btn.textContent=old; });
    };
  }

  function makeBtn(){
    var b=document.createElement('button');
    b.id='mlsPortalInviteBtn'; b.type='button';
    b.textContent='📧 Send portal login';
    b.title='Email this patient a secure link to their records';
    b.style.cssText='margin:6px 8px 2px 0;display:inline-flex;align-items:center;gap:6px;background:#eef4fc;border:1px solid #cfe0f3;color:#15528f;border-radius:999px;padding:5px 12px;font-size:12.5px;font-weight:700;cursor:pointer;font-family:inherit;line-height:1.2';
    b.addEventListener('mouseenter',function(){ b.style.background='#e2edfa'; });
    b.addEventListener('mouseleave',function(){ b.style.background='#eef4fc'; });
    b.addEventListener('click',function(e){ e.preventDefault(); e.stopPropagation(); var ap=active(); if(!ap){ alert('Select a patient first.'); return; } openModal(ap); });
    return b;
  }

  function inject(){
    try{
      if(document.getElementById('mlsPortalInviteBtn')) return;
      if(!active()) return; // only show when a patient is selected
      var host=document.querySelector('.mlsctx-id')||document.querySelector('.mlsctx-idtext')||document.querySelector('#visitHero');
      var hero=document.getElementById('heroPtName');
      var b=makeBtn();
      if(host){
        var meta=host.querySelector('.mlsctx-meta');
        if(meta && meta.parentNode){ meta.parentNode.insertBefore(b, meta.nextSibling); }
        else { host.appendChild(b); }
      } else if(hero && hero.parentNode){
        hero.parentNode.insertBefore(b, hero.nextSibling);
      } else { return; }
    }catch(e){}
  }

  try{ new MutationObserver(function(){ inject(); }).observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  setInterval(inject, 1500);
  if(document.readyState!=='loading') inject(); else document.addEventListener('DOMContentLoaded', inject);
})();


/* ===== feat: MLS active-patient prominence + hide snapshot (2026-07-02) — make the selected patient's name at the top big/obvious with an ACTIVE PATIENT indicator; hide the confusing snapshot button. Additive+reversible: window.__mlsApName.revert() ===== */
(function(){
  'use strict';
  if (window.__mlsApName) return;
  var st = document.createElement('style');
  st.id = 'mls-ap-name-css';
  st.textContent =
    '.mlsctx-id{align-items:flex-start!important;}'+
    '.mlsctx-idtext{display:flex!important;flex-direction:column!important;font-size:20px!important;font-weight:800!important;line-height:1.15!important;color:#0d3c78!important;}'+
    '.mlsctx-idtext::before{content:"● ACTIVE PATIENT";display:block!important;font-size:9.5px!important;font-weight:800!important;letter-spacing:.6px!important;color:#127a55!important;text-transform:uppercase!important;margin-bottom:2px!important;}'+
    '.mlsctx-meta{font-size:12px!important;font-weight:600!important;color:#5b7186!important;}'+
    '#mlsCtxApptChip{font-size:12px!important;font-weight:700!important;margin-top:1px!important;}'+
    '#mlsSnapshotBtn{display:none!important;}';
  (document.head||document.documentElement).appendChild(st);
  window.__mlsApName = { revert: function(){ try{ st.remove(); }catch(e){} window.__mlsApName=null; } };
})();

/* ===== feat: MLS fab-layout fix (2026-07-02) — un-overlap bottom-right floating buttons (Add patient, Voice, MLS Agent) into a clean right-edge stack; MLS Agent gets its own clear home. Additive+reversible: window.__mlsFabLayout.revert() ===== */
(function(){
  'use strict';
  if (window.__mlsFabLayout) return;
  var st = document.createElement('style');
  st.id = 'mls-fab-layout-css';
  st.textContent =
    '#mlsP1AgFab{position:fixed!important;right:18px!important;bottom:18px!important;left:auto!important;z-index:99997!important;box-shadow:0 6px 18px rgba(20,86,168,.35)!important;}'+
    '#mlsAddPtLauncher{position:fixed!important;right:18px!important;bottom:72px!important;left:auto!important;z-index:99996!important;}'+
    '#mlsVoiceFab{position:fixed!important;right:18px!important;bottom:126px!important;left:auto!important;z-index:99996!important;}';
  (document.head||document.documentElement).appendChild(st);
  window.__mlsFabLayout = { revert: function(){ try{ st.remove(); }catch(e){} window.__mlsFabLayout=null; } };
})();


;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_navfeat_keep.js"]'))return;var s=document.createElement('script');s.src='feat_mls_navfeat_keep.js?v=20260626nfk1';s.setAttribute('data-mls-asset','feat_mls_navfeat_keep.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item37: keep Legal requests/Team in nav unless actually toggled off in Settings (additive, reversible: window.__mlsNavFeatKeep.revert()) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_sched_datesync.js"]'))return;var s=document.createElement('script');s.src='feat_mls_sched_datesync.js?v=20260626sds1';s.setAttribute('data-mls-asset','feat_mls_sched_datesync.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item38: schedule-bar date sync + viewed-date indicator (additive, reversible: window.__mlsSchedDateSync.revert()) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_upnow_realtime.js"]'))return;var s=document.createElement('script');s.src='feat_mls_upnow_realtime.js?v=20260626unr1';s.setAttribute('data-mls-asset','feat_mls_upnow_realtime.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item39: UP NOW real-time honesty / no-more-patients-today banner (additive, reversible: window.__mlsUpNowRealtime.revert()) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_caption_entityfix.js"]'))return;var s=document.createElement('script');s.src='feat_mls_caption_entityfix.js?v=20260626cef1';s.setAttribute('data-mls-asset','feat_mls_caption_entityfix.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item40: fix double-escaped "today's schedule" caption entity (additive, reversible: window.__mlsCaptionEntityFix.revert()) */
/* ============================================================
   MLS-CONNECT — connectedness feature bundle (external)
   Loaded by ScribeFlow via a cache-busted <script> loader.
   Each feature is a self-contained IIFE, progressive-enhancement,
   guarded with try/catch, never modifies existing app functions.
   ============================================================ */

(function(){try{if(document.querySelector('script[data-mls-asset="feat_visit_note_detail.js"]'))return;var s=document.createElement('script');s.src='feat_visit_note_detail.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_visit_note_detail.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();


/* ---- module: feat_cmdk.js ---- */

/* ===== MLS Cmd-K Command Palette — connectedness feature #1 =====
   Global searchable palette (Cmd/Ctrl-K) to find any patient, visit/note, or action and jump to it.
   Self-contained progressive enhancement: own IIFE, all external calls guarded, never modifies any
   existing app function, reads state via public globals. Keyboard: Cmd/Ctrl-K toggles, type to
   filter, Up/Down move, Enter open, Esc close. Mobile-friendly. Exposes window.__mlsCmdK. */
(function(){
  'use strict';
  if (window.__mlsCmdK) return;
  var OV='mlsCmdkOverlay', CSS='mlsCmdkCss';
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function getPatients(){ var p=safe(function(){return window.getPatients&&window.getPatients();},[]); return Array.isArray(p)?p:[]; }
  function notesFor(id){ var n=safe(function(){return window.patientNotes&&window.patientNotes(id);},[]); return Array.isArray(n)?n:[]; }
  function fmtDate(v){ if(!v) return ''; var d=new Date(v); return isNaN(d)?'' : d.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}); }
  function go(view){ safe(function(){ window.showView && window.showView(view); }); }
  function openChart(id){ safe(function(){ if(window.setActivePtId) window.setActivePtId(id); if(window.openPatient) window.openPatient(id); else go('patients'); }); }
  function openNote(n){ safe(function(){ if(window.setActivePtId && n.patientId) window.setActivePtId(n.patientId); go('history'); setTimeout(function(){ try{ var el=document.getElementById('note-'+n.id)||document.querySelector('[data-note-id="'+n.id+'"]'); if(el&&el.scrollIntoView) el.scrollIntoView({block:'center'}); }catch(e){} }, 200); }); }
  function commands(){
    var cmds=[
      {label:'Calendar', hint:'Go to schedule', icon:'📅', run:function(){go('calendar');}},
      {label:'Patients', hint:'Patient list', icon:'👥', run:function(){go('patients');}},
      {label:'Visit', hint:'Capture a visit', icon:'🎙️', run:function(){go('visit');}},
      {label:'Orders', hint:'Orders', icon:'📋', run:function(){go('orders');}},
      {label:'Recommendations', hint:'AI recommendations', icon:'💡', run:function(){go('recs');}},
      {label:'History', hint:'Visit history', icon:'📚', run:function(){go('history');}},
      {label:'Patient timeline', hint:'Chronological thread for active patient', icon:'🕒', run:function(){ safe(function(){ window.__mlsTimeline && window.__mlsTimeline.open(); }); }},
      {label:'Activity feed', hint:'Recent practice activity', icon:'🔔', run:function(){ safe(function(){ window.__mlsActivity && window.__mlsActivity.open(); }); }},
      {label:'Recommendations from note', hint:'Auto-drawn imaging/referral/coding', icon:'🧩', run:function(){ safe(function(){ window.__mlsRecs && window.__mlsRecs.open(); }); }},
      {label:'Supervision queue', hint:'Drafts awaiting review / cosign', icon:'👥', run:function(){ safe(function(){ window.__mlsSupervision && window.__mlsSupervision.open(); }); }},
      {label:'Check Athena chart match', hint:'Is the open Athena chart this patient?', icon:'🔎', run:function(){ safe(function(){ window.__mlsAthenaMatch && window.__mlsAthenaMatch.check(); }); }},
      {label:'Flag legal / IME case', hint:'Assemble notes for a legal report', icon:'⚖️', run:function(){ safe(function(){ window.__mlsLegalChain && window.__mlsLegalChain.flagCase(); }); }},
      {label:'Billing code sheet', hint:'Edit your practice’s curated code list', icon:'🧾', run:function(){ safe(function(){ window.__mlsCodeSheet && window.__mlsCodeSheet.open(); }); }},
      {label:'Pick visit codes (superbill)', hint:'Quick-select billing codes for this visit', icon:'☑️', run:function(){ safe(function(){ window.__mlsCodeSheet && window.__mlsCodeSheet.pick(); }); }},
      {label:'Legal requests', hint:'IME / legal', icon:'⚖️', run:function(){go('legalreq');}},
      {label:'Team', hint:'Team', icon:'👥', run:function(){go('team');}},
      {label:'Analysis', hint:'Trends & outcomes', icon:'📊', run:function(){go('analysis');}},
      {label:'AI Studio', hint:'Copilot & tools', icon:'✨', run:function(){go('studio');}},
      {label:'Admin', hint:'Admin panel', icon:'🛡️', run:function(){go('admin');}},
      {label:'Help', hint:'Open help', icon:'❓', run:function(){ safe(function(){ window.openMlsHelp ? window.openMlsHelp() : go('visit'); }); }},
      {label:'Ask MLS', hint:'Ask the assistant', icon:'💬', run:function(){ safe(function(){ window.askMlsHelp && window.askMlsHelp(); }); }}
    ];
    return cmds.map(function(c){ return {type:'cmd', title:c.label, sub:c.hint, icon:c.icon, run:c.run}; });
  }
  function patientItems(){
    return getPatients().map(function(p){
      var sub=[p.dob?('DOB '+p.dob):'', p.mrn?('MRN '+p.mrn):'', p.sex||''].filter(Boolean).join(' · ');
      return {type:'patient', title:p.name||'(unnamed)', sub:sub, icon:'🧑', _hay:(p.name||'')+' '+(p.mrn||'')+' '+(p.dob||''), run:function(){ openChart(p.id); }};
    });
  }
  function noteItems(){
    var out=[], pts=getPatients();
    pts.forEach(function(p){
      notesFor(p.id).forEach(function(n){
        var when=fmtDate(n.created||n.updated);
        var kind=n.kind||(n.isDraft?'Draft':'Note');
        var cc=n.cc||'';
        out.push({type:'note', title:(p.name||n.patient||'Visit')+' — '+kind, sub:[when, cc].filter(Boolean).join(' · '),
                  icon:n.signed?'✅':'📝', _hay:(p.name||'')+' '+kind+' '+cc+' '+when, run:function(){ openNote(n); }});
      });
    });
    return out;
  }
  function buildIndex(){ return { patients:patientItems(), notes:noteItems(), cmds:commands() }; }
  function score(hay, q){
    hay=hay.toLowerCase();
    if(hay.indexOf(q)>=0) return 100 - hay.indexOf(q);
    var hi=0, qi=0; while(hi<hay.length && qi<q.length){ if(hay[hi]===q[qi]) qi++; hi++; }
    return qi===q.length ? 20 : -1;
  }
  function filterGroup(items, q){
    if(!q) return items;
    return items.map(function(it){ var s=score(it._hay||it.title, q); return {it:it, s:s}; })
                .filter(function(x){ return x.s>=0; })
                .sort(function(a,b){ return b.s-a.s; })
                .map(function(x){ return x.it; });
  }
  var idx=null, flat=[], sel=0;
  function render(q){
    var groups=[];
    var P=filterGroup(idx.patients,q).slice(0,8);
    var N=filterGroup(idx.notes,q).slice(0,8);
    var C=filterGroup(idx.cmds,q).slice(0, q?8:14);
    if(P.length) groups.push({label:'Patients', items:P});
    if(N.length) groups.push({label:'Visits & notes', items:N});
    if(C.length) groups.push({label:'Actions', items:C});
    flat=[]; groups.forEach(function(g){ g.items.forEach(function(it){ flat.push(it); }); });
    if(sel>=flat.length) sel=flat.length?flat.length-1:0;
    var html='', fi=0;
    if(!groups.length){ html='<div class="mlsck-empty">No matches for “'+esc(q)+'”</div>'; }
    groups.forEach(function(g){
      html+='<div class="mlsck-group">'+esc(g.label)+'</div>';
      g.items.forEach(function(it){
        var i=fi++;
        html+='<div class="mlsck-item'+(i===sel?' sel':'')+'" data-i="'+i+'">'
            +   '<span class="mlsck-ic">'+esc(it.icon||'•')+'</span>'
            +   '<span class="mlsck-txt"><span class="mlsck-title">'+esc(it.title)+'</span>'
            +     (it.sub?'<span class="mlsck-sub">'+esc(it.sub)+'</span>':'')+'</span>'
            +   '<span class="mlsck-type">'+esc(it.type==='cmd'?'action':it.type)+'</span>'
            + '</div>';
      });
    });
    var list=document.getElementById('mlsCmdkList'); if(list){ list.innerHTML=html;
      list.querySelectorAll('.mlsck-item').forEach(function(el){
        el.addEventListener('mousemove', function(){ sel=+el.getAttribute('data-i'); markSel(); });
        el.addEventListener('click', function(){ sel=+el.getAttribute('data-i'); activate(); });
      });
    }
  }
  function markSel(){ var list=document.getElementById('mlsCmdkList'); if(!list) return;
    list.querySelectorAll('.mlsck-item').forEach(function(el){ var on=(+el.getAttribute('data-i'))===sel; el.classList.toggle('sel',on); if(on&&el.scrollIntoView) el.scrollIntoView({block:'nearest'}); }); }
  function activate(){ var it=flat[sel]; if(!it) return; close(); safe(it.run); }
  function open(){
    if(document.getElementById(OV)) return;
    injectCss();
    idx=buildIndex(); sel=0;
    var ov=document.createElement('div'); ov.id=OV;
    ov.innerHTML='<div class="mlsck-panel" role="dialog" aria-label="Command palette">'
      +'<input id="mlsCmdkInput" type="text" autocomplete="off" spellcheck="false" placeholder="Search patients, visits, actions…" />'
      +'<div id="mlsCmdkList" class="mlsck-list"></div>'
      +'<div class="mlsck-foot"><span><b>↑↓</b> navigate</span><span><b>↵</b> open</span><span><b>esc</b> close</span></div>'
      +'</div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    var inp=document.getElementById('mlsCmdkInput');
    inp.addEventListener('input', function(){ sel=0; render(inp.value.trim().toLowerCase()); });
    inp.addEventListener('keydown', function(e){
      if(e.key==='ArrowDown'){ e.preventDefault(); if(flat.length){ sel=(sel+1)%flat.length; markSel(); } }
      else if(e.key==='ArrowUp'){ e.preventDefault(); if(flat.length){ sel=(sel-1+flat.length)%flat.length; markSel(); } }
      else if(e.key==='Enter'){ e.preventDefault(); activate(); }
      else if(e.key==='Escape'){ e.preventDefault(); close(); }
    });
    render('');
    setTimeout(function(){ inp.focus(); }, 20);
  }
  function close(){ var ov=document.getElementById(OV); if(ov) ov.remove(); }
  function toggle(){ document.getElementById(OV) ? close() : open(); }
  function injectCss(){
    if(document.getElementById(CSS)) return;
    var s=document.createElement('style'); s.id=CSS;
    s.textContent=
      '#'+OV+'{position:fixed;inset:0;z-index:99999;background:rgba(15,28,46,.38);display:flex;align-items:flex-start;justify-content:center;padding:12vh 16px 16px;backdrop-filter:saturate(120%) blur(2px);}'
      +'#'+OV+' .mlsck-panel{width:100%;max-width:560px;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);overflow:hidden;display:flex;flex-direction:column;max-height:72vh;}'
      +'#mlsCmdkInput{border:0;outline:0;padding:16px 18px;font-size:16px;color:var(--ink,#15293f);background:transparent;border-bottom:1px solid var(--line,#e6e9ef);font-family:inherit;}'
      +'#mlsCmdkInput::placeholder{color:var(--muted,#92a0b3);}'
      +'.mlsck-list{overflow:auto;padding:6px;}'
      +'.mlsck-group{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#7c8aa0);padding:10px 12px 4px;}'
      +'.mlsck-item{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:10px;cursor:pointer;}'
      +'.mlsck-item.sel{background:var(--brand,#2563c9);}'
      +'.mlsck-item.sel .mlsck-title,.mlsck-item.sel .mlsck-sub,.mlsck-item.sel .mlsck-type{color:#fff;}'
      +'.mlsck-ic{flex:0 0 auto;width:22px;text-align:center;font-size:15px;}'
      +'.mlsck-txt{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;}'
      +'.mlsck-title{font-size:14px;font-weight:600;color:var(--ink,#15293f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlsck-sub{font-size:12px;color:var(--muted,#7c8aa0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlsck-type{flex:0 0 auto;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted,#aab4c2);border:1px solid var(--line,#e6e9ef);border-radius:6px;padding:2px 6px;}'
      +'.mlsck-item.sel .mlsck-type{border-color:rgba(255,255,255,.5);}'
      +'.mlsck-empty{padding:26px 16px;text-align:center;color:var(--muted,#7c8aa0);font-size:14px;}'
      +'.mlsck-foot{display:flex;gap:16px;padding:9px 14px;border-top:1px solid var(--line,#e6e9ef);font-size:11px;color:var(--muted,#7c8aa0);}'
      +'.mlsck-foot b{color:var(--ink,#41526a);font-weight:700;}'
      +'@media (max-width:620px){#'+OV+'{padding:8vh 8px 8px;}.mlsck-panel{max-height:84vh;}#mlsCmdkInput{font-size:16px;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  function onKey(e){
    var k=(e.key||'').toLowerCase();
    if((e.metaKey||e.ctrlKey) && k==='k'){ e.preventDefault(); e.stopPropagation(); toggle(); }
  }
  document.addEventListener('keydown', onKey, true);
  window.__mlsCmdK={ open:open, close:close, toggle:toggle };
})();


/* ---- module: feat_timeline.js ---- */

/* ===== MLS Unified Patient Timeline — connectedness feature #2 =====
   One chronological thread per patient aggregating: visits/notes, calendar appointments,
   outcomes, plus extensible hooks for legal exports, Athena sync events, and recommendations.
   Self-contained progressive enhancement: own IIFE, all reads guarded, no existing app function
   is modified. Each event is click-to-jump. Sources that have no data/accessor are silently
   omitted (graceful fallback). Entry points: window.__mlsTimeline.open(patientId), a button
   injected into the unified card (via observation, not monkey-patching), and a Cmd-K action.
   Extensible: other feature modules can register event providers via
   window.__mlsTimeline.addProvider(fn) where fn(patientId)->[{date,type,icon,title,sub,onClick}]. */
(function(){
  'use strict';
  if (window.__mlsTimeline) return;
  var OV='mlsTlOverlay', CSS='mlsTlCss';
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function parseTime(v){ if(v==null) return 0; if(typeof v==='number') return v>1e12?v:v*1000; var d=new Date(v); return isNaN(d)?0:d.getTime(); }
  function fmtDate(t){ if(!t) return ''; return new Date(t).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}); }
  function activeId(){ return safe(function(){ return window.getActivePtId && window.getActivePtId(); }, null); }
  function findPt(id){ return safe(function(){ if(window.findPatient) return window.findPatient(id); var ps=(window.getPatients&&window.getPatients())||[]; return ps.filter(function(p){return p.id===id;})[0]||null; }, null); }
  function domEmail(){ return safe(function(){ return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]; }, null); }

  /* ---------- built-in providers ---------- */
  function visitProvider(id){
    var notes=safe(function(){ return (window.patientNotes&&window.patientNotes(id))||[]; }, []);
    if(!Array.isArray(notes)) return [];
    return notes.map(function(n){
      return { date:parseTime(n.created||n.updated||n.date), type:'visit',
        icon:n.signed?'✅':(n.isDraft?'📝':'📄'),
        title:(n.kind||(n.isDraft?'Draft note':'Visit note'))+(n.signed?' · signed':''),
        sub:n.cc||(n.text?String(n.text).slice(0,60):''),
        onClick:function(){ safe(function(){ if(window.setActivePtId)window.setActivePtId(id); if(window.showView)window.showView('history'); setTimeout(function(){ try{var el=document.getElementById('note-'+n.id)||document.querySelector('[data-note-id="'+n.id+'"]'); if(el&&el.scrollIntoView) el.scrollIntoView({block:'center'});}catch(e){} },220); }); } };
    });
  }
  function apptProvider(id){
    var src=safe(function(){ return window._calAppts; }, null);
    if(!src) return [];
    var list=[];
    safe(function(){
      if(Array.isArray(src)) list=src;
      else if(typeof src==='object'){ Object.keys(src).forEach(function(k){ var v=src[k]; if(Array.isArray(v)) list=list.concat(v); else if(v&&typeof v==='object') list.push(v); }); }
    });
    var pt=findPt(id); var pname=pt?(pt.name||'').toLowerCase():'';
    return list.filter(function(a){ if(!a) return false;
        if(a.patient_external_id!=null && String(a.patient_external_id)===String(id)) return true;
        var an=(a.name||a.patient||a.patientName||'').toLowerCase(); return an && pname && an===pname;
      }).map(function(a){
        var t=parseTime(a.start_at||a.appt_date||a.date||a.start||a.when);
        var status=a.status||a.state||'';
        return { date:t, type:'appointment', icon:'📅',
          title:'Appointment'+(a.reason?(' · '+String(a.reason).slice(0,50)):''),
          sub:[fmtTimeOnly(a), status].filter(Boolean).join(' · '),
          onClick:function(){ safe(function(){ if(window.calOpenDay && a.appt_date) window.calOpenDay(a.appt_date); else if(window.showView) window.showView('calendar'); }); } };
      });
  }
  function fmtTimeOnly(a){ return safe(function(){ if(window._fmtApptTime) return window._fmtApptTime(a); var t=parseTime(a.date||a.start||a.when||a.datetime); return t?new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):''; }, ''); }
  function outcomeProvider(id){
    var email=domEmail(); if(!email) return [];
    var raw=safe(function(){ return localStorage.getItem('sf_u::'+email+'::outcomes::'+id); }, null);
    if(!raw) return [];
    var arr=safe(function(){ return JSON.parse(raw); }, null);
    if(!Array.isArray(arr)) return [];
    return arr.map(function(o){
      var odi=(o.odi!=null?('ODI '+o.odi):''); var sat=(o.satisfaction!=null?('Satisfaction '+o.satisfaction):'');
      return { date:parseTime(o.date||o.created||o.when||o.ts), type:'outcome', icon:'📈',
        title:'Outcome recorded', sub:[odi,sat].filter(Boolean).join(' · ')||(o.label||''),
        onClick:function(){ safe(function(){ if(window.showView) window.showView('analysis'); }); } };
    });
  }
  var providers=[visitProvider, apptProvider, outcomeProvider];
  function addProvider(fn){ if(typeof fn==='function' && providers.indexOf(fn)<0) providers.push(fn); }

  function gather(id){
    var ev=[];
    providers.forEach(function(p){ var r=safe(function(){ return p(id)||[]; }, []); if(Array.isArray(r)) ev=ev.concat(r); });
    ev=ev.filter(function(e){ return e && e.title; });
    ev.sort(function(a,b){ return (b.date||0)-(a.date||0); });
    return ev;
  }

  /* ---------- UI ---------- */
  var curEvents=[], curFilter='all';
  function typeMeta(t){ return ({visit:'Visit',appointment:'Appointment',outcome:'Outcome',legal:'Legal',sync:'Athena',rec:'Recommendation'})[t]||t; }
  function render(){
    var body=document.getElementById('mlsTlBody'); if(!body) return;
    var evs=curFilter==='all'?curEvents:curEvents.filter(function(e){return e.type===curFilter;});
    if(!evs.length){ body.innerHTML='<div class="mlstl-empty">No timeline events yet for this patient.</div>'; return; }
    var html='';
    evs.forEach(function(e,i){
      html+='<button type="button" class="mlstl-ev" data-i="'+i+'">'
        +'<span class="mlstl-rail"><span class="mlstl-dot">'+esc(e.icon||'•')+'</span></span>'
        +'<span class="mlstl-main"><span class="mlstl-row1"><span class="mlstl-title">'+esc(e.title)+'</span>'
        +'<span class="mlstl-date">'+esc(fmtDate(e.date))+'</span></span>'
        +(e.sub?'<span class="mlstl-sub">'+esc(e.sub)+'</span>':'')
        +'<span class="mlstl-tag">'+esc(typeMeta(e.type))+'</span></span></button>';
    });
    body.innerHTML=html;
    body.querySelectorAll('.mlstl-ev').forEach(function(el){ el.addEventListener('click', function(){ var e=evs[+el.getAttribute('data-i')]; close(); safe(function(){ e.onClick&&e.onClick(); }); }); });
  }
  function renderChips(){
    var bar=document.getElementById('mlsTlChips'); if(!bar) return;
    var types=['all'].concat(Object.keys(curEvents.reduce(function(a,e){a[e.type]=1;return a;},{})));
    bar.innerHTML=types.map(function(t){ return '<button type="button" class="mlstl-chip'+(t===curFilter?' on':'')+'" data-t="'+esc(t)+'">'+esc(t==='all'?'All':typeMeta(t))+'</button>'; }).join('');
    bar.querySelectorAll('.mlstl-chip').forEach(function(el){ el.addEventListener('click', function(){ curFilter=el.getAttribute('data-t'); renderChips(); render(); }); });
  }
  function open(id){
    id=id||activeId(); if(!id){ safe(function(){ window.showView&&window.showView('patients'); }); return; }
    injectCss(); close();
    var pt=findPt(id); var name=pt?(pt.name||'Patient'):'Patient';
    curEvents=gather(id); curFilter='all';
    var ov=document.createElement('div'); ov.id=OV;
    ov.innerHTML='<div class="mlstl-panel" role="dialog" aria-label="Patient timeline">'
      +'<div class="mlstl-head"><span class="mlstl-h-title">Timeline — '+esc(name)+'</span>'
      +'<button type="button" id="mlsTlClose" class="mlstl-close" aria-label="Close">✕</button></div>'
      +'<div id="mlsTlChips" class="mlstl-chips"></div>'
      +'<div id="mlsTlBody" class="mlstl-body"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    document.getElementById('mlsTlClose').addEventListener('click', close);
    renderChips(); render();
  }
  function close(){ var ov=document.getElementById(OV); if(ov) ov.remove(); }

  function injectCss(){
    if(document.getElementById(CSS)) return;
    var s=document.createElement('style'); s.id=CSS;
    s.textContent=
      '#'+OV+'{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.4);display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px 16px;backdrop-filter:blur(2px);}'
      +'#'+OV+' .mlstl-panel{width:100%;max-width:580px;max-height:80vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mlstl-head{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlstl-h-title{font-weight:700;font-size:15px;color:var(--ink,#15293f);}'
      +'.mlstl-close{border:0;background:transparent;font-size:16px;cursor:pointer;color:var(--muted,#7c8aa0);line-height:1;padding:4px 6px;border-radius:8px;}'
      +'.mlstl-close:hover{background:var(--surface,#f1f4f9);color:var(--ink,#15293f);}'
      +'.mlstl-chips{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlstl-chip{font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--muted,#5b6b7c);border-radius:20px;padding:4px 12px;}'
      +'.mlstl-chip.on{background:var(--brand,#2563c9);border-color:var(--brand,#2563c9);color:#fff;}'
      +'.mlstl-body{overflow:auto;padding:6px 10px 12px;}'
      +'.mlstl-ev{display:flex;gap:0;width:100%;text-align:left;background:transparent;border:0;cursor:pointer;padding:0;font:inherit;}'
      +'.mlstl-rail{position:relative;flex:0 0 38px;display:flex;justify-content:center;}'
      +'.mlstl-rail:before{content:"";position:absolute;top:0;bottom:0;width:2px;background:var(--line,#e6e9ef);}'
      +'.mlstl-dot{position:relative;z-index:1;width:26px;height:26px;border-radius:50%;background:var(--surface,#f1f4f9);border:1px solid var(--line,#e6e9ef);display:flex;align-items:center;justify-content:center;font-size:13px;margin-top:12px;}'
      +'.mlstl-main{flex:1 1 auto;min-width:0;padding:12px 8px 12px 10px;border-radius:10px;}'
      +'.mlstl-ev:hover .mlstl-main{background:var(--surface,#f5f8fc);}'
      +'.mlstl-row1{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}'
      +'.mlstl-title{font-size:14px;font-weight:600;color:var(--ink,#15293f);}'
      +'.mlstl-date{flex:0 0 auto;font-size:12px;color:var(--muted,#7c8aa0);}'
      +'.mlstl-sub{display:block;font-size:12.5px;color:var(--muted,#5b6b7c);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlstl-tag{display:inline-block;margin-top:6px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted,#8b97a8);border:1px solid var(--line,#e6e9ef);border-radius:6px;padding:1px 6px;}'
      +'.mlstl-empty{padding:34px 16px;text-align:center;color:var(--muted,#7c8aa0);font-size:14px;}'
      +'@media (max-width:620px){#'+OV+'{padding:4vh 8px 8px;}#'+OV+' .mlstl-panel{max-height:90vh;}}';
    (document.head||document.documentElement).appendChild(s);
  }

  /* ---------- entry points: Cmd-K action + calendar appointment peek (NOT the unified card,
     which is kept to exactly Chart/Visit/History/Schedule/Switch patient per design) ---------- */
  window.__mlsTimeline={ open:open, close:close, addProvider:addProvider, _gather:gather };
})();


/* ---- module: feat_calendar_launchpad.js ---- */

/* ===== MLS Calendar Launchpad — connectedness feature #3 =====
   ADDITIVE ONLY. Does NOT modify any existing calendar function or its click behavior.
   The app already turns an appointment into a visit via the peek popup's "Start visit"
   (calStartVisit, which resolves patient_external_id -> selectPatient + goNewVisitForPatient,
   or a prefilled unassigned visit). This feature augments the appointment peek popup with two
   extra launch actions — "Open chart" and "Timeline" — so an appointment becomes a launchpad
   into the patient's chart / visit / timeline. It reads the appointment id from the existing
   Start-visit handler in the popup (read-only parse; no wrapping/patching), looks the patient up,
   and appends buttons. If anything is missing it silently does nothing. Calendar untouched. */
(function(){
  'use strict';
  if (window.__mlsCalLaunch) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function apptById(id){ return safe(function(){ var arr=Array.isArray(window._calAppts)?window._calAppts:[]; return arr.filter(function(a){return String(a.id)===String(id);})[0]||null; }, null); }
  function findPt(extId){ if(extId==null) return null; return safe(function(){ if(window.findPatient){ var p=window.findPatient(extId); if(p) return p; } var ps=(window.getPatients&&window.getPatients())||[]; return ps.filter(function(p){return String(p.id)===String(extId);})[0]||null; }, null); }
  function mkBtn(t){ var b=document.createElement('button'); b.type='button'; b.textContent=t; b.setAttribute('data-mls-launch','1');
    b.style.cssText='background:#eef3fb;color:#1456a8;border:1px solid #cfe0f5;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:700;cursor:pointer;'; return b; }
  function enhancePeek(peek){
    if(!peek || peek.__mlsEnhanced) return;
    // derive appt id from the existing "Start visit" handler (calStartVisit(<id>)) — read only
    var apptId=null;
    peek.querySelectorAll('[onclick]').forEach(function(el){ var m=(el.getAttribute('onclick')||'').match(/calStartVisit\((\d+)\)/); if(m) apptId=m[1]; });
    if(apptId==null) return;           // not an appointment peek we recognise — leave untouched
    peek.__mlsEnhanced=true;
    var appt=apptById(apptId); if(!appt) return;
    var pt=findPt(appt.patient_external_id);
    if(!pt) return;                    // unlinked appt: existing "Start visit" already prefills; nothing to add
    var startBtn=[].slice.call(peek.querySelectorAll('button')).filter(function(b){return /Start visit/i.test(b.textContent||'');})[0];
    var row=startBtn?startBtn.parentElement:peek;
    if(row.querySelector('[data-mls-launch]')) return;
    var bChart=mkBtn('📋 Open chart');
    bChart.onclick=function(){ safe(function(){ if(window.setActivePtId) window.setActivePtId(pt.id); if(window.openPatient) window.openPatient(pt.id); else if(window.showView) window.showView('patients'); peek.remove(); }); };
    var bTl=mkBtn('🕒 Timeline');
    bTl.onclick=function(){ safe(function(){ if(window.__mlsTimeline) window.__mlsTimeline.open(pt.id); peek.remove(); }); };
    row.appendChild(bChart); row.appendChild(bTl);
  }
  function startObserver(){
    safe(function(){
      var mo=new MutationObserver(function(){ var p=document.getElementById('calApptPeek'); if(p) enhancePeek(p); });
      mo.observe(document.body, {childList:true, subtree:true});
      var p=document.getElementById('calApptPeek'); if(p) enhancePeek(p);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', startObserver); else startObserver();
  window.__mlsCalLaunch={ enhancePeek:enhancePeek, _findPt:findPt };
})();


/* ---- module: feat_athena_sync.js ---- */

/* ===== MLS Global Athena Sync Indicator — connectedness feature #4 =====
   Adds a compact Athena sync status chip into the unified card's existing sync slot
   (window.__mlsCard.setSyncSlot): last synced / pending / errors, with a details popover.
   HONEST + ADDITIVE: it OBSERVES the app's own Athena actions (push visit / superbill /
   history note / copy-for-EMR / pull chart) via a passive capture-phase click listener — it
   never wraps or alters those handlers — and records a per-user sync log in localStorage.
   It reflects app-initiated sends via the DOM/Assist path (Path A); it does NOT claim
   server-confirmed FHIR write-back (Path B), which is gated until athenahealth API access is
   live. Degrades to a silent no-op if the card or globals are missing. Exposes window.__mlsSync
   and registers a timeline provider so sync events also appear in the patient timeline. */
(function(){
  'use strict';
  if (window.__mlsSync) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function email(){ return safe(function(){ return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]; }, null); }
  function key(){ var e=email(); return e?('sf_u::'+e+'::mlsSyncLog'):null; }
  function getLog(){ var k=key(); if(!k) return []; return safe(function(){ var v=JSON.parse(localStorage.getItem(k)||'[]'); return Array.isArray(v)?v:[]; }, []); }
  function setLog(l){ var k=key(); if(!k) return; safe(function(){ localStorage.setItem(k, JSON.stringify(l.slice(-50))); }); }
  function activeName(){ return safe(function(){ var id=window.getActivePtId&&window.getActivePtId(); var p=id&&window.findPatient&&window.findPatient(id); return p?(p.name||''):''; }, ''); }
  function activeId(){ return safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null); }
  function mark(ev){ ev=ev||{}; ev.ts=ev.ts||Date.now(); if(!ev.patient) ev.patient=activeName(); if(ev.patientId==null) ev.patientId=activeId(); var l=getLog(); l.push(ev); setLog(l); render(); }
  function connMode(){
    return safe(function(){
      var assist = typeof window.sendToEMRviaAssist==='function' || typeof window._assistReadAthenaTab==='function';
      var be = (typeof window.backendMode==='function' && window.backendMode());
      if (assist) return 'Assist (browser)';
      if (be) return 'MLS server';
      return 'not connected';
    }, 'unknown');
  }
  function timeAgo(ts){ var s=Math.floor((Date.now()-ts)/1000); if(s<60) return 'just now'; var m=Math.floor(s/60); if(m<60) return m+'m ago'; var h=Math.floor(m/60); if(h<24) return h+'h ago'; var d=Math.floor(h/24); return d+'d ago'; }
  function fmtTime(ts){ return safe(function(){ return new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }, ''); }

  function state(){
    var log=getLog();
    var errors=log.filter(function(e){return e.status==='error';}).length;
    var sends=log.filter(function(e){return e.dir!=='pull';});
    var last=log.length?log[log.length-1]:null;
    return { errors:errors, count:sends.length, last:last, total:log.length };
  }
  function chipHtml(){
    var st=state();
    var cls='ok', txt;
    if(st.errors>0){ cls='err'; txt='Athena · '+st.errors+' error'+(st.errors>1?'s':''); }
    else if(st.last){ cls='ok'; txt='Athena · '+(st.last.dir==='pull'?'pulled ':'synced ')+timeAgo(st.last.ts); }
    else { cls='idle'; txt='Athena · idle'; }
    return '<span class="mls-sync mls-sync-'+cls+'" data-tip="Athena sync status — click for details">'
      +'<span class="mls-sync-dot"></span>'+esc(txt)+'</span>';
  }
  function render(){
    if(!window.__mlsCard || typeof window.__mlsCard.setSyncSlot!=='function') return;
    safe(function(){ window.__mlsCard.setSyncSlot(chipHtml()); bindChip(); });
  }
  function bindChip(){
    var chip=document.querySelector('#mlsCardSlot .mls-sync'); if(!chip||chip.__b) return; chip.__b=1;
    chip.style.cursor='pointer';
    chip.addEventListener('click', function(e){ e.stopPropagation(); togglePop(chip); });
  }
  function togglePop(anchor){
    var ex=document.getElementById('mlsSyncPop'); if(ex){ ex.remove(); return; }
    var log=getLog().slice().reverse().slice(0,6);
    var st=state();
    var rows=log.length? log.map(function(e){
        return '<div class="mls-sp-row"><span class="mls-sp-ic">'+(e.status==='error'?'⚠':(e.dir==='pull'?'📥':'🚀'))+'</span>'
          +'<span class="mls-sp-main"><b>'+esc(e.label||e.target||'sync')+'</b>'+(e.patient?(' · '+esc(e.patient)):'')
          +'<span class="mls-sp-t">'+esc(fmtTime(e.ts))+'</span></span></div>';
      }).join('') : '<div class="mls-sp-empty">No Athena sync activity yet.</div>';
    var pop=document.createElement('div'); pop.id='mlsSyncPop';
    pop.innerHTML='<div class="mls-sp-head"><b>Athena sync</b><span class="mls-sp-mode">'+esc(connMode())+'</span></div>'
      +'<div class="mls-sp-stat"><span>'+st.count+' sent</span><span>'+(st.errors)+' error'+(st.errors===1?'':'s')+'</span>'
      +'<span>'+(st.last?('last '+timeAgo(st.last.ts)):'—')+'</span></div>'
      +'<div class="mls-sp-list">'+rows+'</div>'
      +'<div class="mls-sp-note">Reflects sends initiated in the app (DOM / MLS Assist path). Server-confirmed FHIR write-back activates once athenahealth API access is live.</div>';
    document.body.appendChild(pop);
    var r=anchor.getBoundingClientRect();
    pop.style.top=(r.bottom+6+window.scrollY)+'px';
    pop.style.left=Math.max(8,Math.min(r.left+window.scrollX, window.innerWidth-330))+'px';
    setTimeout(function(){ document.addEventListener('mousedown', function h(ev){ if(!pop.contains(ev.target)){ pop.remove(); document.removeEventListener('mousedown',h); } }); },0);
  }

  /* observe app Athena actions (passive — does not alter handlers) */
  var ACTIONS=[
    {re:/pushEntireVisitToAthena/, label:'Visit → Athena', target:'visit', dir:'push'},
    {re:/pushSuperbillToAthena/, label:'Superbill → Athena', target:'superbill', dir:'push'},
    {re:/pushHistoryNoteToAthena/, label:'Note → Athena', target:'note', dir:'push'},
    {re:/copyForEMR/, label:'Copied for EMR/Athena', target:'copy', dir:'push'},
    {re:/pushToAthena|pushSuperbill/, label:'Push → Athena', target:'push', dir:'push'},
    {re:/pullPatientChartViaAssist|pullPatientFromAthena/, label:'Pulled chart', target:'chart', dir:'pull'}
  ];
  function onClickCapture(e){
    safe(function(){
      var el=e.target; var hops=0;
      while(el && hops<5){
        var oc=el.getAttribute&&el.getAttribute('onclick');
        if(oc){ for(var i=0;i<ACTIONS.length;i++){ if(ACTIONS[i].re.test(oc)){ mark({label:ACTIONS[i].label, target:ACTIONS[i].target, dir:ACTIONS[i].dir, status:'sent'}); return; } } }
        el=el.parentElement; hops++;
      }
    });
  }
  function syncProvider(id){
    return getLog().filter(function(e){ return e.patientId!=null && String(e.patientId)===String(id); }).map(function(e){
      return { date:e.ts, type:'sync', icon:(e.status==='error'?'⚠':(e.dir==='pull'?'📥':'🚀')), title:e.label||'Athena sync', sub:connMode(), onClick:function(){} };
    });
  }
  function init(){
    document.addEventListener('click', onClickCapture, true);
    render();
    setInterval(render, 4000);
    safe(function(){ if(window.__mlsTimeline && window.__mlsTimeline.addProvider) window.__mlsTimeline.addProvider(syncProvider); });
    injectCss();
  }
  function injectCss(){
    if(document.getElementById('mlsSyncCss')) return;
    var s=document.createElement('style'); s.id='mlsSyncCss';
    s.textContent=
      '.mls-sync{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 9px;border-radius:20px;border:1px solid var(--line,#e6e9ef);background:var(--surface,#f6f8fb);color:var(--muted,#5b6b7c);white-space:nowrap;}'
      +'.mls-sync-dot{width:7px;height:7px;border-radius:50%;background:#9aa7b4;flex:0 0 auto;}'
      +'.mls-sync-ok .mls-sync-dot{background:#16a34a;} .mls-sync-ok{color:#127a55;border-color:#bfe6cf;background:#f0fbf4;}'
      +'.mls-sync-err .mls-sync-dot{background:#dc2626;} .mls-sync-err{color:#b91c1c;border-color:#f3c9c9;background:#fdf2f2;}'
      +'#mlsSyncPop{position:absolute;z-index:100000;width:320px;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:12px;box-shadow:0 16px 40px rgba(15,28,46,.22);font-size:13px;overflow:hidden;}'
      +'#mlsSyncPop .mls-sp-head{display:flex;justify-content:space-between;align-items:center;padding:11px 13px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'#mlsSyncPop .mls-sp-mode{font-size:11px;color:var(--muted,#7c8aa0);border:1px solid var(--line,#e6e9ef);border-radius:6px;padding:1px 7px;}'
      +'#mlsSyncPop .mls-sp-stat{display:flex;gap:14px;padding:8px 13px;color:var(--muted,#5b6b7c);font-size:12px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'#mlsSyncPop .mls-sp-list{max-height:200px;overflow:auto;padding:4px 0;}'
      +'#mlsSyncPop .mls-sp-row{display:flex;gap:9px;padding:7px 13px;align-items:flex-start;}'
      +'#mlsSyncPop .mls-sp-main{display:flex;flex-direction:column;min-width:0;}'
      +'#mlsSyncPop .mls-sp-t{font-size:11px;color:var(--muted,#9aa7b4);}'
      +'#mlsSyncPop .mls-sp-empty{padding:18px 13px;text-align:center;color:var(--muted,#7c8aa0);}'
      +'#mlsSyncPop .mls-sp-note{padding:9px 13px;font-size:10.5px;color:var(--muted,#8b97a8);border-top:1px solid var(--line,#e6e9ef);background:var(--surface,#f8fafc);}';
    (document.head||document.documentElement).appendChild(s);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__mlsSync={ mark:mark, getLog:getLog, state:state, render:render };
})();


/* ---- module: feat_activity_feed.js ---- */

/* ===== MLS Unified Activity Feed — connectedness feature #5 =====
   A practice-wide chronological feed of meaningful events: note signed, sent to Athena,
   follow-up / upcoming appointment, payment received, BAA awaiting signature.
   Additive overlay (opened via Cmd-K "Activity feed" or window.__mlsActivity.open()). Reads via
   public globals (getNotes, _calAppts) and window.__mlsSync; each item is click-to-jump. Sources
   with no accessible data yet (payments require Stripe Connect go-live; BAA-awaiting-signature
   requires the legal/BAA list) are shown as gated, clearly-labeled placeholders rather than fake
   data, and light up automatically once those systems expose data via registerable providers
   (window.__mlsActivity.addProvider(fn) -> [{date,type,icon,title,sub,onClick}]). */
(function(){
  'use strict';
  if (window.__mlsActivity) return;
  var OV='mlsActOverlay', CSS='mlsActCss';
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function parseTime(v){ if(v==null) return 0; if(typeof v==='number') return v>1e12?v:v*1000; var d=new Date(v); return isNaN(d)?0:d.getTime(); }
  function fmtDate(t){ if(!t) return ''; return new Date(t).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}); }
  function ptName(id){ return safe(function(){ var p=window.findPatient&&window.findPatient(id); return p?(p.name||''):''; }, ''); }
  function jumpPatient(id, view){ safe(function(){ if(id&&window.setActivePtId) window.setActivePtId(id); if(window.showView) window.showView(view||'history'); }); }

  function signedNotesProvider(){
    var notes=safe(function(){ return window.getNotes&&window.getNotes(); }, []);
    if(!Array.isArray(notes)) return [];
    return notes.filter(function(n){ return n.signed; }).map(function(n){
      return { date:parseTime(n.updated||n.created), type:'signed', icon:'✅',
        title:'Note signed', sub:(n.patient||ptName(n.patientId)||'')+(n.cc?(' · '+n.cc):''),
        onClick:function(){ jumpPatient(n.patientId,'history'); } };
    });
  }
  function athenaProvider(){
    var log=safe(function(){ return window.__mlsSync&&window.__mlsSync.getLog(); }, []);
    if(!Array.isArray(log)) return [];
    return log.map(function(e){
      return { date:e.ts, type:'athena', icon:(e.status==='error'?'⚠':'🚀'),
        title:e.label||'Athena sync', sub:e.patient||'', onClick:function(){ jumpPatient(e.patientId,'history'); } };
    });
  }
  function followupProvider(){
    var ap=safe(function(){ return Array.isArray(window._calAppts)?window._calAppts:[]; }, []);
    var now=Date.now();
    return ap.filter(function(a){ var t=parseTime(a.start_at||a.appt_date); return t>now; })
             .map(function(a){
       var pid=a.patient_external_id;
       return { date:parseTime(a.start_at||a.appt_date), type:'followup', icon:'📅',
         title:'Upcoming appointment'+(a.reason?(' · '+String(a.reason).slice(0,40)):''),
         sub:(a.name||ptName(pid)||''), future:true,
         onClick:function(){ safe(function(){ if(window.calOpenDay&&a.appt_date) window.calOpenDay(a.appt_date); else if(window.showView) window.showView('calendar'); }); } };
     });
  }
  // gated providers: no fabricated data; show a single informational placeholder each
  function paymentProvider(){ return [{ date:0, type:'payment', icon:'💳', gated:true,
      title:'Payments — awaiting Stripe Connect go-live', sub:'Payment-received events appear here once Connect is live', onClick:function(){} }]; }
  function baaProvider(){ return [{ date:0, type:'baa', icon:'📝', gated:true,
      title:'BAA awaiting signature — connects to legal/BAA list', sub:'Lights up when a BAA-awaiting list is available', onClick:function(){ safe(function(){ window.showView&&window.showView('legalreq'); }); } }]; }

  var providers=[signedNotesProvider, athenaProvider, followupProvider, paymentProvider, baaProvider];
  function addProvider(fn){ if(typeof fn==='function' && providers.indexOf(fn)<0) providers.push(fn); }
  function gather(){
    var ev=[];
    providers.forEach(function(p){ var r=safe(function(){return p()||[];},[]); if(Array.isArray(r)) ev=ev.concat(r); });
    ev=ev.filter(function(e){ return e&&e.title; });
    // real (dated) events newest-first; gated placeholders sink to bottom
    ev.sort(function(a,b){ if((a.gated?1:0)!==(b.gated?1:0)) return (a.gated?1:0)-(b.gated?1:0); return (b.date||0)-(a.date||0); });
    return ev;
  }
  var curFilter='all';
  function typeMeta(t){ return ({signed:'Note signed',athena:'Athena',followup:'Follow-up',payment:'Payment',baa:'BAA'})[t]||t; }
  function render(){
    var body=document.getElementById('mlsActBody'); if(!body) return;
    var all=gather();
    var evs=curFilter==='all'?all:all.filter(function(e){return e.type===curFilter;});
    if(!evs.length){ body.innerHTML='<div class="mlsact-empty">No activity yet.</div>'; return; }
    body.innerHTML=evs.map(function(e,i){
      return '<button type="button" class="mlsact-row'+(e.gated?' gated':'')+'" data-i="'+i+'">'
        +'<span class="mlsact-ic">'+esc(e.icon||'•')+'</span>'
        +'<span class="mlsact-main"><span class="mlsact-r1"><span class="mlsact-t">'+esc(e.title)+'</span>'
        +'<span class="mlsact-d">'+esc(e.gated?'soon':fmtDate(e.date))+'</span></span>'
        +(e.sub?'<span class="mlsact-s">'+esc(e.sub)+'</span>':'')+'</span></button>';
    }).join('');
    body.querySelectorAll('.mlsact-row').forEach(function(el){ el.addEventListener('click', function(){ var e=evs[+el.getAttribute('data-i')]; if(e.gated){return;} close(); safe(function(){ e.onClick&&e.onClick(); }); }); });
  }
  function renderChips(){
    var bar=document.getElementById('mlsActChips'); if(!bar) return;
    var types=['all','signed','athena','followup','payment','baa'];
    bar.innerHTML=types.map(function(t){ return '<button type="button" class="mlsact-chip'+(t===curFilter?' on':'')+'" data-t="'+t+'">'+esc(t==='all'?'All':typeMeta(t))+'</button>'; }).join('');
    bar.querySelectorAll('.mlsact-chip').forEach(function(el){ el.addEventListener('click', function(){ curFilter=el.getAttribute('data-t'); renderChips(); render(); }); });
  }
  function open(){
    injectCss(); close(); curFilter='all';
    var ov=document.createElement('div'); ov.id=OV;
    ov.innerHTML='<div class="mlsact-panel" role="dialog" aria-label="Activity feed">'
      +'<div class="mlsact-head"><span class="mlsact-h">Activity feed</span><button type="button" id="mlsActClose" class="mlsact-x" aria-label="Close">✕</button></div>'
      +'<div id="mlsActChips" class="mlsact-chips"></div>'
      +'<div id="mlsActBody" class="mlsact-body"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    document.getElementById('mlsActClose').addEventListener('click', close);
    renderChips(); render();
  }
  function close(){ var ov=document.getElementById(OV); if(ov) ov.remove(); }
  function injectCss(){
    if(document.getElementById(CSS)) return;
    var s=document.createElement('style'); s.id=CSS;
    s.textContent=
      '#'+OV+'{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.4);display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px 16px;backdrop-filter:blur(2px);}'
      +'#'+OV+' .mlsact-panel{width:100%;max-width:560px;max-height:80vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mlsact-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlsact-h{font-weight:700;font-size:15px;color:var(--ink,#15293f);}'
      +'.mlsact-x{border:0;background:transparent;font-size:16px;cursor:pointer;color:var(--muted,#7c8aa0);padding:4px 6px;border-radius:8px;}'
      +'.mlsact-x:hover{background:var(--surface,#f1f4f9);}'
      +'.mlsact-chips{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlsact-chip{font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--muted,#5b6b7c);border-radius:20px;padding:4px 11px;}'
      +'.mlsact-chip.on{background:var(--brand,#2563c9);border-color:var(--brand,#2563c9);color:#fff;}'
      +'.mlsact-body{overflow:auto;padding:6px 8px 12px;}'
      +'.mlsact-row{display:flex;gap:11px;width:100%;text-align:left;background:transparent;border:0;cursor:pointer;padding:10px 10px;border-radius:10px;font:inherit;align-items:flex-start;}'
      +'.mlsact-row:hover{background:var(--surface,#f5f8fc);}'
      +'.mlsact-row.gated{cursor:default;opacity:.72;}'
      +'.mlsact-row.gated:hover{background:transparent;}'
      +'.mlsact-ic{flex:0 0 auto;width:24px;text-align:center;font-size:15px;margin-top:1px;}'
      +'.mlsact-main{flex:1 1 auto;min-width:0;}'
      +'.mlsact-r1{display:flex;justify-content:space-between;gap:10px;align-items:baseline;}'
      +'.mlsact-t{font-size:14px;font-weight:600;color:var(--ink,#15293f);}'
      +'.mlsact-d{flex:0 0 auto;font-size:12px;color:var(--muted,#9aa7b4);}'
      +'.mlsact-s{display:block;font-size:12.5px;color:var(--muted,#5b6b7c);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlsact-empty{padding:30px;text-align:center;color:var(--muted,#7c8aa0);}'
      +'@media (max-width:620px){#'+OV+'{padding:4vh 8px 8px;}#'+OV+' .mlsact-panel{max-height:90vh;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  window.__mlsActivity={ open:open, close:close, addProvider:addProvider, _gather:gather };
})();


/* ---- module: feat_note_recs.js ---- */

/* ===== MLS Recommendations from Note — connectedness feature #6 =====
   Reads the active patient's most recent note and auto-extracts actionable recommendations —
   imaging, referrals, follow-up interval, and coding (ICD-10 / CPT / E&M) — each as a one-click
   chip. Additive overlay (Cmd-K "Recommendations from note" or window.__mlsRecs.open()). Actions
   use existing app primitives: "Schedule follow-up" -> calScheduleForPatient; codes/orders ->
   one-click Copy (the app has no add-to-orders API, so order/referral chips copy the text and can
   open the Recommendations generator). Pure parse + read; never alters app functions. */
(function(){
  'use strict';
  if (window.__mlsRecs) return;
  var OV='mlsRecOverlay', CSS='mlsRecCss';
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function activeId(){ return safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null); }
  function activeName(){ return safe(function(){ var p=window.findPatient&&window.findPatient(activeId()); return p?(p.name||''):''; }, ''); }
  function latestNoteText(id){
    return safe(function(){
      // prefer a live visit editor if it has content
      var live=document.getElementById('noteText')||document.getElementById('clinicalNote')||document.querySelector('[data-note-body]');
      if(live && (live.value||live.textContent||'').trim().length>120) return (live.value||live.textContent);
      var notes=(window.patientNotes&&window.patientNotes(id))||[];
      notes=Array.isArray(notes)?notes.slice():[];
      notes.sort(function(a,b){ return (new Date(b.updated||b.created||0))-(new Date(a.updated||a.created||0)); });
      return notes.length?(notes[0].text||''):'';
    }, '');
  }
  function uniq(a){ var s={},o=[]; a.forEach(function(x){ var k=x.toLowerCase(); if(!s[k]){s[k]=1;o.push(x);} }); return o; }

  function extract(text){
    text=String(text||''); var recs=[];
    function add(type,label,value){ recs.push({type:type,label:label,value:value}); }
    // ---- imaging ----
    var imaging=[];
    var imgRe=/\b(MRI|CT scan|CT|X-?ray|radiograph[s]?|ultrasound|EMG\/NCS|EMG|nerve conduction|bone scan|DEXA|myelogram|fluoroscop\w*)\b[^.;\n]{0,60}/gi, m;
    while((m=imgRe.exec(text))){ imaging.push(m[0].trim().replace(/\s+/g,' ')); }
    uniq(imaging).slice(0,6).forEach(function(s){ add('imaging','Imaging', s); });
    // ---- referrals ----
    var refs=[]; var refRe=/\b(refer(?:ral)?\s+to|consult(?:ation)?\s+(?:with|to)|refer to)\b[^.;\n]{0,60}/gi;
    while((m=refRe.exec(text))){ refs.push(m[0].trim().replace(/\s+/g,' ')); }
    uniq(refs).slice(0,5).forEach(function(s){ add('referral','Referral', s); });
    // ---- follow-up interval ----
    var fu=[]; var fuRe=/\b(?:follow[\s-]?up|f\/u|return to clinic|RTC|return)\b[^.;\n]{0,8}?(?:in|after)?\s*(\d{1,2})\s*(day|days|week|weeks|wk|wks|month|months|mo)\b/gi;
    while((m=fuRe.exec(text))){ fu.push({num:+m[1], unit:m[2], raw:m[0].trim().replace(/\s+/g,' ')}); }
    if(fu.length){ add('followup','Follow-up', fu[0].raw); recs[recs.length-1].fu=fu[0]; }
    // ---- ICD-10 ----
    var icd=(text.match(/\b[A-TV-Z]\d\d(?:\.\d{1,4})?\b/g)||[]).filter(function(c){ return /\.\d/.test(c) || /^[A-TV-Z]\d\d$/.test(c); });
    uniq(icd).slice(0,8).forEach(function(c){ add('icd','ICD-10', c); });
    // ---- CPT / E&M (5-digit) ----
    var cpt=uniq((text.match(/\b\d{5}\b/g)||[]).filter(function(c){ var n=+c; return (n>=10000&&n<=99499)||(n>=99201&&n<=99499); }));
    cpt.slice(0,8).forEach(function(c){ var em=/^992\d\d$/.test(c); add(em?'em':'cpt', em?'E&M':'CPT', c); });
    return recs;
  }

  function copy(txt){ safe(function(){ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt); } else { var t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } toastMini('Copied'); }); }
  function toastMini(msg){ safe(function(){ if(window.toast){ window.toast(msg,'ok'); return; } var d=document.createElement('div'); d.textContent=msg; d.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#15293f;color:#fff;padding:8px 14px;border-radius:10px;z-index:100001;font-size:13px'; document.body.appendChild(d); setTimeout(function(){d.remove();},1400); }); }
  function scheduleFollowup(){ safe(function(){ var id=activeId(); close(); if(window.calScheduleForPatient&&id){ window.calScheduleForPatient(id); } else if(window.showView){ window.showView('calendar'); } }); }

  var SECTIONS=[
    {type:'followup', title:'Follow-up interval', act:'schedule'},
    {type:'imaging', title:'Imaging', act:'copy'},
    {type:'referral', title:'Referrals', act:'copy'},
    {type:'icd', title:'Diagnosis codes (ICD-10)', act:'copy'},
    {type:'cpt', title:'Procedure codes (CPT)', act:'copy'},
    {type:'em', title:'E&M level', act:'copy'}
  ];
  function render(recs){
    var body=document.getElementById('mlsRecBody'); if(!body) return;
    if(!recs.length){ body.innerHTML='<div class="mlsrec-empty">No structured recommendations found in the latest note.<br><button type="button" id="mlsRecGen" class="mlsrec-gen">Generate recommendations →</button></div>';
      var g=document.getElementById('mlsRecGen'); if(g) g.addEventListener('click', function(){ close(); safe(function(){ if(window.generateRecommendations) window.generateRecommendations(); else if(window.showView) window.showView('recs'); }); }); return; }
    var html='';
    SECTIONS.forEach(function(sec){
      var items=recs.filter(function(r){return r.type===sec.type;});
      if(!items.length) return;
      html+='<div class="mlsrec-sec"><div class="mlsrec-sectitle">'+esc(sec.title)+'</div><div class="mlsrec-chips">';
      items.forEach(function(it,i){
        html+='<span class="mlsrec-chip" data-type="'+esc(sec.type)+'" data-i="'+i+'"><span class="mlsrec-val">'+esc(it.value)+'</span>'
          +'<button type="button" class="mlsrec-act" data-act="'+esc(sec.act)+'">'+(sec.act==='schedule'?'Schedule':'Copy')+'</button></span>';
      });
      html+='</div></div>';
    });
    html+='<div class="mlsrec-foot"><button type="button" id="mlsRecGen2" class="mlsrec-gen">Open full Recommendations →</button></div>';
    body.innerHTML=html;
    body.querySelectorAll('.mlsrec-chip').forEach(function(chip){
      var type=chip.getAttribute('data-type'), i=+chip.getAttribute('data-i');
      var it=recs.filter(function(r){return r.type===type;})[i];
      var btn=chip.querySelector('.mlsrec-act');
      btn.addEventListener('click', function(){ if(btn.getAttribute('data-act')==='schedule') scheduleFollowup(); else copy(it.value); });
    });
    var g2=document.getElementById('mlsRecGen2'); if(g2) g2.addEventListener('click', function(){ close(); safe(function(){ if(window.generateRecommendations) window.generateRecommendations(); else if(window.showView) window.showView('recs'); }); });
  }
  function open(){
    var id=activeId(); if(!id){ safe(function(){ window.showView&&window.showView('patients'); }); return; }
    injectCss(); close();
    var recs=extract(latestNoteText(id));
    var ov=document.createElement('div'); ov.id=OV;
    ov.innerHTML='<div class="mlsrec-panel" role="dialog" aria-label="Recommendations from note">'
      +'<div class="mlsrec-head"><span class="mlsrec-h">Recommendations — '+esc(activeName()||'patient')+'</span><span style="display:flex;gap:2px"><button type="button" id="mlsRecValidate" class="mlsrec-x" data-tip="Check these codes against your code sheet">🛡️</button><button type="button" id="mlsRecClose" class="mlsrec-x">✕</button></span></div>'
      +'<div class="mlsrec-hint">Auto-drawn from the latest note. One-click to act.</div>'
      +'<div id="mlsRecBody" class="mlsrec-body"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    document.getElementById('mlsRecClose').addEventListener('click', close);
    render(recs);
    var vb=document.getElementById('mlsRecValidate');
    if(vb){ if(window.__mlsCodeSheet&&window.__mlsCodeSheet.showValidation){ vb.addEventListener('click', function(){ window.__mlsCodeSheet.showValidation(latestNoteText(id), activeName()); }); } else { vb.style.display='none'; } }
    // Optional guardrail: when 'validate AI codes' is on, flag off-sheet/retired codes inline.
    safe(function(){ if(window.__mlsCodeSheet&&window.__mlsCodeSheet.constrainOn&&window.__mlsCodeSheet.constrainOn()){
      var res=window.__mlsCodeSheet.validate(latestNoteText(id))||[]; var bad=res.filter(function(r){return r.status!=='approved';});
      var body=document.getElementById('mlsRecBody');
      if(body){ var d=document.createElement('div'); d.style.cssText='margin:0 0 12px;padding:9px 11px;border-radius:10px;font-size:12.5px;border:1px solid '+(bad.length?'#f0d6a8':'#bfe3cd')+';background:'+(bad.length?'#fdf6e7':'#eefaf1')+';color:'+(bad.length?'#7a5a00':'#1f6b3f')+'';
        d.innerHTML=(bad.length? ('⚠ '+bad.length+' code(s) not on your approved sheet: '+bad.map(function(r){return esc(r.code);}).join(', ')+' — <b>click to review</b>') : '🛡️ All codes match your approved sheet.');
        if(bad.length){ d.style.cursor='pointer'; d.addEventListener('click', function(){ window.__mlsCodeSheet.showValidation(latestNoteText(id), activeName()); }); }
        body.insertBefore(d, body.firstChild); } } });
  }
  function close(){ var ov=document.getElementById(OV); if(ov) ov.remove(); }
  function injectCss(){
    if(document.getElementById(CSS)) return;
    var s=document.createElement('style'); s.id=CSS;
    s.textContent=
      '#'+OV+'{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.4);display:flex;align-items:flex-start;justify-content:center;padding:9vh 16px 16px;backdrop-filter:blur(2px);}'
      +'#'+OV+' .mlsrec-panel{width:100%;max-width:560px;max-height:80vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mlsrec-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px 8px;}'
      +'.mlsrec-h{font-weight:700;font-size:15px;color:var(--ink,#15293f);}'
      +'.mlsrec-x{border:0;background:transparent;font-size:16px;cursor:pointer;color:var(--muted,#7c8aa0);padding:4px 6px;border-radius:8px;}'
      +'.mlsrec-hint{padding:0 18px 12px;color:var(--muted,#7c8aa0);font-size:12.5px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlsrec-body{overflow:auto;padding:12px 16px 16px;}'
      +'.mlsrec-sec{margin-bottom:14px;}'
      +'.mlsrec-sectitle{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted,#7c8aa0);margin-bottom:7px;}'
      +'.mlsrec-chips{display:flex;flex-direction:column;gap:7px;}'
      +'.mlsrec-chip{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--line,#e6e9ef);border-radius:10px;padding:8px 8px 8px 12px;background:var(--surface,#fafcff);}'
      +'.mlsrec-val{font-size:13.5px;color:var(--ink,#15293f);min-width:0;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlsrec-act{flex:0 0 auto;font:inherit;font-size:12px;font-weight:700;cursor:pointer;border:1px solid var(--brand,#2563c9);color:#fff;background:var(--brand,#2563c9);border-radius:8px;padding:5px 12px;}'
      +'.mlsrec-act:hover{filter:brightness(1.07);}'
      +'.mlsrec-empty{padding:26px 12px;text-align:center;color:var(--muted,#7c8aa0);font-size:14px;}'
      +'.mlsrec-gen{margin-top:12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--brand,#2563c9);border-radius:9px;padding:8px 14px;}'
      +'.mlsrec-foot{margin-top:6px;text-align:center;}'
      +'@media (max-width:620px){#'+OV+'{padding:4vh 8px 8px;}#'+OV+' .mlsrec-panel{max-height:90vh;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  window.__mlsRecs={ open:open, close:close, _extract:extract };
})();


/* ---- module: feat_visit_cascade.js ---- */

/* ===== MLS One Visit -> Cascade — connectedness feature #7 =====
   When a note is generated/signed/saved, the app already lands it in History and the unified card
   recomputes last-visit. This feature ADDS the connectedness cascade: a non-intrusive prompt that
   spawns the natural next steps in one click — schedule a Calendar follow-up, open note-derived
   Recommendations, and jump to History — and refreshes the card + Athena sync chip.
   ADDITIVE + passive: observes clicks on the app's own Generate/Review&Sign/Save buttons via a
   capture-phase listener (never wraps them), then shows the cascade for the active patient. */
(function(){
  'use strict';
  if (window.__mlsCascade) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function activeId(){ return safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null); }
  function activeName(){ return safe(function(){ var p=window.findPatient&&window.findPatient(activeId()); return p?(p.name||''):''; }, ''); }
  /* Only buttons that actually PERSIST a visit. 'generate note' is intentionally
     excluded — Generate Note only drafts in-memory and saves nothing to History,
     so it must never trigger the "Landed in History" popup. */
  var TRIGGERS=/review\s*&\s*sign|save to history|sign\s*&\s*save|^sign$/i;
  var lastShown=0;
  /* Gate the cascade on the note ACTUALLY landing in getNotes() (a non-draft note
     for the active patient, freshly saved after the click) rather than a blind
     timer. Polls briefly; if the save never shows, the popup never fires, so it
     cannot claim "Landed in History" before the save completes. */
  function freshlySaved(id, sinceTs){
    return safe(function(){
      if(!window.getNotes) return false;
      var ns=window.getNotes()||[];
      for(var i=0;i<ns.length;i++){
        var n=ns[i];
        if(!n || n.patientId!==id) continue;
        if(n.isDraft) continue;
        var t=n.updated||n.created||0;
        if(t>=sinceTs-1500) return true;
      }
      return false;
    }, false);
  }
  function waitForSaveThenCascade(id, clickTs){
    var tries=0, MAX=16; /* about 16 * 200ms = 3.2s */
    (function poll(){
      if(freshlySaved(id, clickTs)){ showCascade(); return; }
      if(++tries>=MAX) return; /* save never confirmed -> stay silent, no false claim */
      setTimeout(poll, 200);
    })();
  }
  function onClick(e){
    safe(function(){
      var el=e.target, hops=0, btn=null;
      while(el && hops<4){ if(el.tagName==='BUTTON'||el.getAttribute&&el.getAttribute('onclick')){ btn=el; break; } el=el.parentElement; hops++; }
      if(!btn) return;
      var txt=(btn.textContent||'').replace(/\s+/g,' ').trim();
      if(TRIGGERS.test(txt)){
        var now=Date.now(); if(now-lastShown<3000) return; lastShown=now;
        var id=activeId(); if(!id) return;
        waitForSaveThenCascade(id, now);
      }
    });
  }
  function showCascade(){
    var id=activeId(); if(!id) return;
    safe(function(){ if(window.__mlsCard) window.__mlsCard.refresh(); if(window.__mlsSync) window.__mlsSync.render(); });
    var ex=document.getElementById('mlsCascade'); if(ex) ex.remove();
    injectCss();
    var c=document.createElement('div'); c.id='mlsCascade';
    c.innerHTML='<div class="mlsc-top"><span class="mlsc-title">✓ Visit captured — '+esc(activeName()||'patient')+'</span>'
      +'<button type="button" class="mlsc-x" aria-label="Dismiss">✕</button></div>'
      +'<div class="mlsc-sub">Landed in History &amp; last-visit updated. Next steps:</div>'
      +'<div class="mlsc-acts">'
      +'<button type="button" data-a="followup">📅 Schedule follow-up</button>'
      +'<button type="button" data-a="recs">💡 Recommendations</button>'
      +'<button type="button" data-a="history">📚 History</button>'
      +'</div>';
    document.body.appendChild(c);
    c.querySelector('.mlsc-x').addEventListener('click', function(){ c.remove(); });
    c.querySelectorAll('[data-a]').forEach(function(b){
      b.addEventListener('click', function(){
        var a=b.getAttribute('data-a'); c.remove();
        if(a==='followup') safe(function(){ if(window.calScheduleForPatient) window.calScheduleForPatient(id); else if(window.showView) window.showView('calendar'); });
        else if(a==='recs') safe(function(){ if(window.__mlsRecs) window.__mlsRecs.open(); else if(window.showView) window.showView('recs'); });
        else if(a==='history') safe(function(){ if(window.showView) window.showView('history'); });
      });
    });
    setTimeout(function(){ var n=document.getElementById('mlsCascade'); if(n) n.classList.add('fade'); }, 14000);
    setTimeout(function(){ var n=document.getElementById('mlsCascade'); if(n) n.remove(); }, 16000);
  }
  function injectCss(){
    if(document.getElementById('mlsCascadeCss')) return;
    var s=document.createElement('style'); s.id='mlsCascadeCss';
    s.textContent=
      '#mlsCascade{position:fixed;right:18px;bottom:18px;z-index:100000;width:300px;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-left:4px solid var(--brand,#2563c9);border-radius:13px;box-shadow:0 16px 44px rgba(15,28,46,.24);padding:13px 14px;transition:opacity .8s;font-size:13px;}'
      +'#mlsCascade.fade{opacity:0;}'
      +'#mlsCascade .mlsc-top{display:flex;justify-content:space-between;align-items:center;gap:8px;}'
      +'#mlsCascade .mlsc-title{font-weight:700;color:var(--ink,#15293f);font-size:13.5px;}'
      +'#mlsCascade .mlsc-x{border:0;background:transparent;cursor:pointer;color:var(--muted,#9aa7b4);font-size:14px;}'
      +'#mlsCascade .mlsc-sub{color:var(--muted,#5b6b7c);font-size:12px;margin:4px 0 10px;}'
      +'#mlsCascade .mlsc-acts{display:flex;flex-direction:column;gap:6px;}'
      +'#mlsCascade .mlsc-acts button{font:inherit;font-size:12.5px;font-weight:600;text-align:left;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fafcff);color:var(--ink,#15293f);border-radius:9px;padding:8px 11px;}'
      +'#mlsCascade .mlsc-acts button:hover{border-color:var(--brand,#2563c9);color:var(--brand,#2563c9);}'
      +'@media (max-width:620px){#mlsCascade{right:8px;left:8px;width:auto;bottom:8px;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  function init(){ document.addEventListener('click', onClick, true); injectCss(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__mlsCascade={ show:showCascade };
})();


/* ---- module: feat_supervision.js ---- */

/* ===== MLS Supervision Queue (cosign lifecycle) — connectedness feature #8 =====
   Makes the Head-Dr supervision / cosign flow REAL and PERSISTENT:
     doctor drafts a note -> "Submit for cosign" -> it lands in the supervisor queue
     -> a Head Dr reviews & cosigns -> status propagates to History / Visit / card / queue
     -> (gated) the cosigned note is sent to Athena.

   Persistence model (no backend change needed): the supervision status RIDES ON THE
   NOTE RECORD as n.sup = { status, submittedBy/At, supervisor, cosignedBy/At, cosignLine }.
   It is saved through the app's OWN persistence (window.saveNotes -> localStorage, and
   window.saveNoteToBackend -> POST /api/records, AES-encrypted at rest, upsert by id) —
   exactly the path the app already uses for signing. So a cosign survives reloads and
   syncs across devices like any other note change. A light localStorage mirror
   (sf_u::<email>::mlsSupStatus) is kept only so badges can paint instantly.

   Role awareness: a treating clinician (doctor OR a Head Dr acting as provider) can submit;
   COSIGN is enforced to Head Dr (bkUser.role==='head' || bkUser.isHead). When the app has no
   server role (offline / un-hosted preview) both actions are allowed so the flow is testable.

   Cross-account: a Head Dr already receives team-owned records server-side, so the queue can
   also surface a sub-doctor's submitted notes (read). The head WRITING a cosign back onto a
   sub-doctor's server record needs a Head-Dr write endpoint (POST /api/records/:id/cosign) and
   is therefore GATED — it is attempted best-effort and clearly labeled when unavailable.

   GATED: the final "send cosigned note to Athena" needs live Athena (FHIR write-back / the
   Assist DOM path). It is wired behind window.__mlsSupervision.athenaEnabled (default false)
   and the onCosign hook; flip athenaEnabled=true once athenahealth API access / MLS Assist is
   live to activate it. Everything else works today. */
(function(){
  'use strict';
  if (window.__mlsSupervision) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

  /* ---- identity / role ---- */
  function bk(){ return safe(function(){ return window.bkUser; }, null); }
  function myEmail(){
    var u=bk(); if(u&&u.email) return String(u.email).toLowerCase();
    var s=safe(function(){ return window.session&&window.session.email; }, null); if(s) return String(s).toLowerCase();
    return safe(function(){ return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]; }, null);
  }
  function myName(){ var n=safe(function(){ return window.getName&&window.getName(); }, ''); if(n) return n; var u=bk(); return (u&&(u.name||u.email))||'Clinician'; }
  function hasRole(){ var u=bk(); return !!(u&&u.role); }
  function isHead(){ var u=bk(); if(!u) return true; /* no server role -> allow (preview/testable) */ return !!(u.isHead||u.role==='head'||u.role==='owner'||u.role==='admin'); }
  function isClinician(){ var u=bk(); if(!u) return true; return !!(u.isHead||u.role==='head'||u.role==='user'); }

  /* ---- note access + persistence (rides on the note via the app's own save path) ---- */
  function notes(){ var ns=safe(function(){ return window.getNotes&&window.getNotes(); }, []); return Array.isArray(ns)?ns:[]; }
  function findNote(id){ return notes().filter(function(n){ return n&&n.id===id; })[0]||null; }
  function persistNote(n){
    safe(function(){
      var arr=notes(); var i=arr.findIndex(function(x){ return x&&x.id===n.id; });
      if(i>=0) arr[i]=n; else arr.unshift(n);
      if(window.saveNotes) window.saveNotes(arr);
    });
    safe(function(){ if(window.saveNoteToBackend) window.saveNoteToBackend(n); });   // /api/records upsert (encrypted)
    mirror();                                                                         // refresh instant-paint cache
    safe(function(){ if(window.updateNavCounts) window.updateNavCounts(); });
    safe(function(){ if(window.currentView==='history' && window.renderHistory) window.renderHistory(); });
  }
  /* derive a status for a note that has no explicit n.sup yet */
  function statusOfNote(n){
    if(!n) return null;
    if(n.sup && n.sup.status) return n.sup.status;
    if(n.isDraft) return 'draft';
    if(n.signed) return 'signed';
    return 'unsigned';
  }

  /* ---- localStorage mirror (badges paint instantly, even before notes() resolves) ---- */
  function mkey(){ var e=myEmail(); return e?('sf_u::'+e+'::mlsSupStatus'):null; }
  function mirrorGet(){ var k=mkey(); return k?safe(function(){ return JSON.parse(localStorage.getItem(k)||'{}'); }, {}):{}; }
  function mirror(){ var k=mkey(); if(!k) return; safe(function(){ var m={}; notes().forEach(function(n){ if(n&&n.sup&&n.sup.status) m[n.id]=n.sup.status; }); localStorage.setItem(k, JSON.stringify(m)); }); }
  function mirrorStatus(id){ return mirrorGet()[id]||null; }

  function fmtDate(v){ if(!v) return ''; var d=new Date(v); return isNaN(d)?'':d.toLocaleDateString([], {month:'short',day:'numeric'}); }
  function fmtWhen(v){ if(!v) return ''; var d=new Date(v); return isNaN(d)?'':d.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }

  /* ---- lifecycle actions ---- */
  function submitForCosign(id, supervisor){
    var n=findNote(id); if(!n) return false;
    n.sup = n.sup || {};
    n.sup.status='submitted';
    n.sup.submittedBy=myName(); n.sup.submittedByEmail=myEmail(); n.sup.submittedAt=Date.now();
    if(supervisor) n.sup.supervisor=supervisor;
    n.updated=Date.now();
    persistNote(n);
    log('Note submitted for cosign', n);
    return true;
  }
  function cosign(id, opts){
    opts=opts||{};
    var n = opts.note || findNote(id); if(!n) return false;
    if(!isHead()){ toast('Only a Head Dr can cosign.','err'); return false; }
    n.sup = n.sup || {};
    n.sup.status='cosigned';
    n.sup.cosignedBy=myName(); n.sup.cosignedByEmail=myEmail(); n.sup.cosignedAt=Date.now();
    n.sup.cosignLine='Cosigned by '+myName()+' (supervising) on '+new Date().toLocaleString()+'.';
    n.updated=Date.now();
    if(opts.teamOwned){
      // GATED cross-account write: head writing onto a sub-doctor's server record needs a
      // Head-Dr cosign endpoint. Attempt it best-effort; never block the local record.
      teamCosignWriteBack(n);
    } else {
      persistNote(n);
    }
    log('Note cosigned', n);
    // GATED: send the cosigned note to Athena (FHIR write-back / Assist DOM path)
    safe(function(){ if(typeof onCosign==='function') onCosign(n); });
    sendToAthena(n);
    return true;
  }

  /* ---- gated Athena send (wired, off until live) ---- */
  var athenaEnabled=false;
  function athenaAvailable(){ return athenaEnabled && safe(function(){ return typeof window.pushHistoryNoteToAthena==='function' || typeof window.sendToEMRviaAssist==='function'; }, false); }
  function sendToAthena(n){
    if(!n) return {gated:true};
    if(!athenaAvailable()){
      safe(function(){ if(window.__mlsSync&&window.__mlsSync.mark) window.__mlsSync.mark('Cosigned — Athena send queued (gated)','pending'); });
      return {gated:true, reason:'Athena send activates when athenahealth API access / MLS Assist is live (set window.__mlsSupervision.athenaEnabled=true).'};
    }
    return safe(function(){
      if(!n.isDraft && window.pushHistoryNoteToAthena){ window.pushHistoryNoteToAthena(n.id); return {sent:true}; }
      return {gated:true};
    }, {gated:true});
  }

  /* ---- gated cross-account cosign write-back (head -> sub-doctor record) ---- */
  function teamCosignWriteBack(n){
    var base=safe(function(){ return window.bkBase&&window.bkBase(); }, null);
    var tok=safe(function(){ return window.bkToken&&window.bkToken(); }, null);
    if(!base||!tok){ toast('Cosign recorded locally (offline).','ok'); return; }
    safe(function(){
      fetch(base+'/api/records/'+encodeURIComponent(n.id)+'/cosign',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
        body:JSON.stringify({ cosign:n.sup })
      }).then(function(r){
        if(r&&r.ok){ toast('Cosigned — synced to the doctor’s chart.','ok'); }
        else { toast('Cosign recorded. Server cosign-sync is pending the Head-Dr write endpoint.','ok'); }
      }).catch(function(){ toast('Cosign recorded. Server cosign-sync is pending the Head-Dr write endpoint.','ok'); });
    });
  }

  /* ---- queues ---- */
  // My own notes that are in the pipeline (draft/unsigned/submitted, not yet cosigned).
  function myQueue(){
    return notes().filter(function(n){
      var s=statusOfNote(n);
      return s==='draft'||s==='unsigned'||s==='submitted';
    }).map(function(n){
      return { id:n.id, patient:n.patient||'', patientId:n.patientId, kind:n.kind||'Note',
               date:n.updated||n.created, status:statusOfNote(n), sup:n.sup||null, owned:true };
    }).sort(function(a,b){ return (b.date||0)-(a.date||0); });
  }
  // Recently cosigned (mine) — shown collapsed for confirmation.
  function recentCosigned(){
    return notes().filter(function(n){ return statusOfNote(n)==='cosigned'; })
      .map(function(n){ return { id:n.id, patient:n.patient||'', patientId:n.patientId, kind:n.kind||'Note', date:(n.sup&&n.sup.cosignedAt)||n.updated, status:'cosigned', sup:n.sup||null, owned:true }; })
      .sort(function(a,b){ return (b.date||0)-(a.date||0); }).slice(0,8);
  }
  // Team submissions awaiting MY cosign (Head Dr only) — read from server records.
  var _team=[]; var _teamLoaded=false;
  function loadTeam(cb){
    if(!isHead() || !hasRole()){ _team=[]; _teamLoaded=true; if(cb) cb(); return; }
    var base=safe(function(){ return window.bkBase&&window.bkBase(); }, null);
    var tok=safe(function(){ return window.bkToken&&window.bkToken(); }, null);
    if(!base||!tok){ _team=[]; _teamLoaded=true; if(cb) cb(); return; }
    var mine=myEmail();
    safe(function(){
      fetch(base+'/api/records',{headers:{'Authorization':'Bearer '+tok}})
        .then(function(r){ return r.ok?r.json():{}; })
        .then(function(d){
          var rows=(d&&d.records)||[];
          _team=rows.filter(function(row){
            var owner=row.owner_email?String(row.owner_email).toLowerCase():'';
            var rec=row.record||{};
            return owner && owner!==mine && rec.sup && rec.sup.status==='submitted';
          }).map(function(row){
            var rec=row.record||{};
            return { id:rec.id, patient:rec.patient||'', patientId:rec.patientId, kind:rec.kind||'Note',
                     date:(rec.sup&&rec.sup.submittedAt)||row.updated_at, status:'submitted',
                     sup:rec.sup||null, owned:false, owner:row.owner_email, record:rec };
          }).sort(function(a,b){ return (new Date(b.date||0))-(new Date(a.date||0)); });
          _teamLoaded=true; if(cb) cb();
        })
        .catch(function(){ _team=[]; _teamLoaded=true; if(cb) cb(); });
    });
  }
  function teamQueue(){ return _team; }

  // Total count for the Cmd-K / badge: my pending + team submissions.
  function count(){ return myQueue().length + teamQueue().length; }

  /* ---- badge component (one look used everywhere) ---- */
  var MAP={
    draft:    ['Draft','#6b7280','#eef0f3'],
    unsigned: ['Unsigned','#b45309','#fef3c7'],
    submitted:['Awaiting cosign','#1456a8','#e0edff'],
    cosigned: ['Cosigned','#127a55','#dcfce7'],
    signed:   ['Signed','#127a55','#dcfce7']
  };
  function badgeHtml(st){ var m=MAP[st]||MAP.draft; return '<span class="mls-sup-badge" style="color:'+m[1]+';background:'+m[2]+'">'+m[0]+'</span>'; }

  /* ---- activity log feed-in ---- */
  function log(title, n){ safe(function(){ if(window.__mlsActivity && window.__mlsActivity.addProvider){ /* provider added once below */ } }); }

  /* ====================== QUEUE OVERLAY ====================== */
  function open(){
    injectCss(); close();
    loadTeam(function(){ render(); });
    render(); // paint immediately; team section fills in when loadTeam returns
  }
  function render(){
    var existing=document.getElementById('mlsSupOverlay');
    var my=myQueue(), team=teamQueue(), done=recentCosigned();
    var total=my.length+team.length;
    var head=isHead();

    function rowHtml(it, where){
      var acts='<button type="button" class="mls-sup-act" data-act="open" data-id="'+esc(it.id)+'">Open</button>';
      if(it.owned && (it.status==='draft'||it.status==='unsigned')){
        acts+='<button type="button" class="mls-sup-act primary" data-act="submit" data-id="'+esc(it.id)+'">Submit for cosign</button>';
      } else if(it.status==='submitted' && head){
        acts+='<button type="button" class="mls-sup-act primary" data-act="cosign" data-id="'+esc(it.id)+'" data-team="'+(it.owned?'0':'1')+'">Review &amp; cosign</button>';
      } else if(it.status==='submitted' && !head){
        acts+='<span class="mls-sup-wait">Awaiting Head Dr</span>';
      }
      var who='';
      if(it.sup){
        if(it.status==='submitted' && it.sup.submittedBy) who='Submitted by '+esc(it.sup.submittedBy)+' · '+esc(fmtWhen(it.sup.submittedAt));
        else if(it.status==='cosigned' && it.sup.cosignedBy) who='Cosigned by '+esc(it.sup.cosignedBy)+' · '+esc(fmtWhen(it.sup.cosignedAt));
      }
      if(where==='team' && it.owner) who='Dr. '+esc(it.owner)+(who?(' · '+who):'');
      return '<div class="mls-sup-row"><div class="mls-sup-main">'
        +'<div class="mls-sup-t">'+esc(it.patient||'Patient')+' · '+esc(it.kind)+' '+badgeHtml(it.status)+'</div>'
        +'<div class="mls-sup-s">'+esc(fmtDate(it.date))+(who?(' &nbsp;·&nbsp; '+who):'')+'</div>'
        +'</div><div class="mls-sup-acts">'+acts+'</div></div>';
    }

    var body='';
    // Section: my pipeline
    body+='<div class="mls-sup-sec">My notes <span class="mls-sup-secn">'+my.length+'</span></div>';
    body+= my.length ? my.map(function(it){ return rowHtml(it,'mine'); }).join('') : '<div class="mls-sup-empty sm">No drafts or unsigned notes. 🎉</div>';
    // Section: team submissions awaiting my cosign (head only)
    if(head && hasRole()){
      body+='<div class="mls-sup-sec">Awaiting your cosign <span class="mls-sup-secn">'+team.length+'</span></div>';
      body+= team.length ? team.map(function(it){ return rowHtml(it,'team'); }).join('')
                         : '<div class="mls-sup-empty sm">'+(_teamLoaded?'Nothing from your doctors awaiting cosign.':'Loading your team’s submissions…')+'</div>';
    }
    // Section: recently cosigned
    if(done.length){
      body+='<div class="mls-sup-sec">Recently cosigned</div>';
      body+=done.map(function(it){ return rowHtml(it,'done'); }).join('');
    }

    var noteLine = head
      ? 'You can review &amp; cosign submitted notes. The cosigned note is sent to Athena once athenahealth access / MLS Assist is live.'
      : 'Submit a drafted note for your Head Dr to review &amp; cosign.';

    var html='<div class="mls-sup-panel" role="dialog" aria-label="Supervision queue">'
      +'<div class="mls-sup-head"><span class="mls-sup-h">Supervision queue <span class="mls-sup-count">'+total+'</span></span><button type="button" id="mlsSupX" class="mls-sup-x">✕</button></div>'
      +'<div class="mls-sup-note">'+noteLine+'</div>'
      +'<div class="mls-sup-body">'+body+'</div></div>';

    var ov=existing;
    if(!ov){ ov=document.createElement('div'); ov.id='mlsSupOverlay'; document.body.appendChild(ov); ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); }); }
    ov.innerHTML=html;
    document.getElementById('mlsSupX').addEventListener('click', close);
    ov.querySelectorAll('.mls-sup-act').forEach(function(b){
      b.addEventListener('click', function(){
        var a=b.getAttribute('data-act'), id=b.getAttribute('data-id');
        if(a==='open'){ close(); openNote(id); }
        else if(a==='submit'){ if(submitForCosign(id)){ toast('Submitted for cosign.','ok'); } render(); refreshAll(); }
        else if(a==='cosign'){
          var team=b.getAttribute('data-team')==='1';
          var item=team ? teamQueue().filter(function(x){return x.id===id;})[0] : null;
          if(confirmCosign()){ cosign(id, team?{teamOwned:true, note:item&&item.record}:{}); render(); refreshAll(); }
        }
      });
    });
  }
  function confirmCosign(){ return safe(function(){ return window.confirm('Cosign this note? You are attesting you reviewed it as the supervising physician.'); }, true); }
  function openNote(id){
    safe(function(){
      var n=findNote(id);
      if(n&&n.patientId&&window.setActivePtId) window.setActivePtId(n.patientId);
      if(window.openNoteFromHistory){ if(window.showView) window.showView('history'); window.openNoteFromHistory(id); }
      else if(window.showView) window.showView('history');
    });
  }
  function close(){ var o=document.getElementById('mlsSupOverlay'); if(o) o.remove(); }
  function toast(m,kind){ safe(function(){ if(window.toast){ window.toast(m, kind||'ok'); return; } var d=document.createElement('div'); d.textContent=m; d.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#15293f;color:#fff;padding:8px 14px;border-radius:10px;z-index:100001;font-size:13px'; document.body.appendChild(d); setTimeout(function(){d.remove();},1600); }); }
  var onCosign=null;

  function refreshAll(){
    safe(function(){ if(window.__mlsCard&&window.__mlsCard.refresh) window.__mlsCard.refresh(); });
    badgeHistory(); injectCardChip(); injectVisitChip();
  }

  /* ====================== BADGES IN OTHER VIEWS ====================== */
  // History rows (rows carry onclick openNoteFromHistory('id'))
  function badgeHistory(){
    safe(function(){
      var m=mirrorGet();
      document.querySelectorAll('[onclick*="openNoteFromHistory("]').forEach(function(el){
        var mm=(el.getAttribute('onclick')||'').match(/openNoteFromHistory\('([^']+)'\)/); if(!mm) return;
        var s=m[mm[1]]; var n; if(!s){ n=findNote(mm[1]); s=n&&n.sup&&n.sup.status; }
        if(!s || s==='signed') { var old=el.querySelector('.mls-sup-badge'); if(old) old.remove(); return; }
        var cur=el.querySelector('.mls-sup-badge');
        if(cur){ if(cur.getAttribute('data-st')===s) return; cur.remove(); }
        var tmp=document.createElement('div'); tmp.innerHTML=badgeHtml(s); var node=tmp.firstChild; node.setAttribute('data-st',s);
        var main=el.querySelector('.hist-main .t')||el.querySelector('.hist-main')||el; main.appendChild(node);
      });
    });
  }
  // Unified patient card: a status chip for the ACTIVE patient's most recent in-pipeline note.
  function activeNoteStatus(){
    var pid=safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null);
    if(!pid) return null;
    var cand=notes().filter(function(n){ return n&&n.patientId===pid; })
      .sort(function(a,b){ return (b.updated||b.created||0)-(a.updated||a.created||0); });
    for(var i=0;i<cand.length;i++){ var s=statusOfNote(cand[i]); if(s==='submitted'||s==='cosigned'||s==='draft'||s==='unsigned') return s; }
    return null;
  }
  function injectCardChip(){
    safe(function(){
      var actions=document.querySelector('#mlsCtxBar .mlsctx-actions');
      var existing=document.getElementById('mlsSupCardChip');
      var st=activeNoteStatus();
      if(!actions || !st){ if(existing) existing.remove(); return; }
      if(existing){ if(existing.getAttribute('data-st')===st) return; existing.remove(); }
      var span=document.createElement('span'); span.id='mlsSupCardChip'; span.setAttribute('data-st',st);
      span.className='mls-sup-cardchip'; span.setAttribute('data-tip','Supervision status'); span.innerHTML=badgeHtml(st);
      span.style.cssText='display:inline-flex;align-items:center;cursor:pointer';
      span.onclick=function(){ open(); };
      actions.insertBefore(span, actions.firstChild);
    });
  }
  // Visit page: a status chip + a contextual Submit/Cosign button next to the sign controls,
  // bound to the note currently open in the editor (window.currentNoteId).
  function injectVisitChip(){
    safe(function(){
      var view=document.getElementById('view-visit')||document.querySelector('[data-view="visit"]');
      var onVisit = safe(function(){ return window.currentView==='visit'; }, false);
      var host=document.getElementById('signLine') ? document.getElementById('signLine').parentElement : null;
      var anchor=document.getElementById('signBtn');
      var wrap=document.getElementById('mlsSupVisitWrap');
      if(!onVisit || !anchor){ if(wrap) wrap.remove(); return; }
      var id=safe(function(){ return window.currentNoteId; }, null);
      var n=id?findNote(id):null;
      var st=n?statusOfNote(n):null;
      if(!n || !st || st==='signed'){ if(wrap) wrap.remove(); return; }
      if(!wrap){ wrap=document.createElement('span'); wrap.id='mlsSupVisitWrap'; wrap.style.cssText='display:inline-flex;align-items:center;gap:8px;margin-left:10px;vertical-align:middle'; anchor.parentElement.insertBefore(wrap, anchor.nextSibling); }
      var canCosign = st==='submitted' && isHead();
      var btn='';
      if(st==='draft'||st==='unsigned') btn='<button type="button" id="mlsSupVisitBtn" class="mls-sup-act primary" style="font-size:12px">Submit for cosign</button>';
      else if(canCosign) btn='<button type="button" id="mlsSupVisitBtn" class="mls-sup-act primary" style="font-size:12px">Review &amp; cosign</button>';
      else if(st==='submitted') btn='<span class="mls-sup-wait">Awaiting Head Dr</span>';
      var key=st+'|'+canCosign;
      if(wrap.getAttribute('data-k')===key && wrap.getAttribute('data-id')===id) return;
      wrap.setAttribute('data-k',key); wrap.setAttribute('data-id',id);
      wrap.innerHTML=badgeHtml(st)+btn;
      var vb=document.getElementById('mlsSupVisitBtn');
      if(vb) vb.onclick=function(){
        if(st==='draft'||st==='unsigned'){ if(submitForCosign(id)){ toast('Submitted for cosign.','ok'); } }
        else if(canCosign){ if(confirmCosign()) cosign(id,{}); }
        refreshAll();
      };
    });
  }

  /* ====================== STYLES ====================== */
  function injectCss(){
    if(document.getElementById('mlsSupCss')) return;
    var s=document.createElement('style'); s.id='mlsSupCss';
    s.textContent=
      '#mlsSupOverlay{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.4);display:flex;align-items:flex-start;justify-content:center;padding:9vh 16px 16px;backdrop-filter:blur(2px);}'
      +'#mlsSupOverlay .mls-sup-panel{width:100%;max-width:580px;max-height:80vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mls-sup-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;}'
      +'.mls-sup-h{font-weight:700;font-size:15px;color:var(--ink,#15293f);}'
      +'.mls-sup-count{display:inline-block;background:var(--brand,#2563c9);color:#fff;border-radius:20px;font-size:12px;padding:1px 9px;margin-left:6px;}'
      +'.mls-sup-x{border:0;background:transparent;font-size:16px;cursor:pointer;color:var(--muted,#7c8aa0);}'
      +'.mls-sup-note{padding:0 18px 12px;color:var(--muted,#7c8aa0);font-size:12px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mls-sup-body{overflow:auto;padding:6px 12px 14px;}'
      +'.mls-sup-sec{font-size:11.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#7c8aa0);padding:14px 8px 6px;}'
      +'.mls-sup-secn{display:inline-block;background:var(--line,#eef0f3);color:var(--muted,#5b6b7c);border-radius:20px;font-size:11px;padding:0 7px;margin-left:4px;}'
      +'.mls-sup-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:11px 8px;border-bottom:1px solid var(--line,#f0f2f6);}'
      +'.mls-sup-main{min-width:0;}'
      +'.mls-sup-t{font-size:13.5px;font-weight:600;color:var(--ink,#15293f);}'
      +'.mls-sup-s{font-size:12px;color:var(--muted,#9aa7b4);margin-top:2px;}'
      +'.mls-sup-acts{display:flex;gap:6px;flex:0 0 auto;align-items:center;}'
      +'.mls-sup-act{font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--ink,#15293f);border-radius:8px;padding:5px 10px;}'
      +'.mls-sup-act.primary{background:var(--brand,#2563c9);color:#fff;border-color:var(--brand,#2563c9);}'
      +'.mls-sup-wait{font-size:11.5px;color:var(--muted,#7c8aa0);font-style:italic;}'
      +'.mls-sup-badge{display:inline-block;font-size:10.5px;font-weight:700;border-radius:6px;padding:1px 7px;margin-left:6px;vertical-align:middle;white-space:nowrap;}'
      +'.mls-sup-empty{padding:30px;text-align:center;color:var(--muted,#7c8aa0);}'
      +'.mls-sup-empty.sm{padding:12px 8px;text-align:left;font-size:12.5px;}';
    (document.head||document.documentElement).appendChild(s);
  }

  /* ---- activity feed + timeline providers (so cosign events show in the practice feed) ---- */
  function wireProviders(){
    safe(function(){
      if(window.__mlsActivity && window.__mlsActivity.addProvider){
        window.__mlsActivity.addProvider(function(){
          return notes().filter(function(n){ return n&&n.sup&&(n.sup.status==='submitted'||n.sup.status==='cosigned'); }).map(function(n){
            var co=n.sup.status==='cosigned';
            return { date: co?(n.sup.cosignedAt):(n.sup.submittedAt), type:'supervision', icon: co?'✅':'👥',
                     title: co?('Note cosigned — '+(n.patient||'patient')):('Submitted for cosign — '+(n.patient||'patient')),
                     sub: co?(n.sup.cosignLine||''):('by '+(n.sup.submittedBy||'')),
                     onClick: function(){ openNote(n.id); } };
          });
        });
      }
    });
    safe(function(){
      if(window.__mlsTimeline && window.__mlsTimeline.addProvider){
        window.__mlsTimeline.addProvider(function(pid){
          return notes().filter(function(n){ return n&&n.patientId===pid&&n.sup&&n.sup.status; }).map(function(n){
            var st=n.sup.status; var co=st==='cosigned';
            return { date:(co?n.sup.cosignedAt:n.sup.submittedAt)||n.updated, type:'supervision', icon:co?'✅':'👥',
                     title:(co?'Cosigned':'Submitted for cosign'), sub:(co?(n.sup.cosignLine||''):('by '+(n.sup.submittedBy||''))),
                     onClick:function(){ openNote(n.id); } };
          });
        });
      }
    });
  }

  function init(){
    injectCss(); mirror(); wireProviders();
    setInterval(function(){ badgeHistory(); injectCardChip(); injectVisitChip(); }, 1500);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.__mlsSupervision={
    open:open, close:close, count:count, render:render,
    queue:myQueue, teamQueue:teamQueue, recentCosigned:recentCosigned,
    submit:submitForCosign, cosign:cosign, statusOf:function(id){ return statusOfNote(findNote(id)); },
    sendToAthena:sendToAthena,
    set athenaEnabled(v){ athenaEnabled=!!v; }, get athenaEnabled(){ return athenaEnabled; },
    set onCosign(fn){ onCosign=fn; }, get onCosign(){ return onCosign; }
  };
})();


/* ---- module: feat_athena_match.js ---- */

/* ===== MLS Active-Patient <-> Athena Chart Match (app side) — connectedness feature #9 =====
   Builds the APP side of "is the chart open in Athena the same patient I have active in MLS?".
   It does NOT touch the extension. It uses the app's existing Assist bridge (window._assistReadChart
   / _assistReadAthenaTab) to request the open Athena chart, then compares name/DOB to the active
   MLS patient and reports: matched / mismatch / Athena-not-detected. Fully gated + safe: with no
   live Athena session or extension, it reports "not detected" and explains, never fabricating a
   match. Exposed via window.__mlsAthenaMatch.check() and a Cmd-K action. Coordinates with (does not
   modify) the extension's DOM chart-read behavior described in the project briefing. */
(function(){
  'use strict';
  if (window.__mlsAthenaMatch) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function activePt(){ return safe(function(){ var id=window.getActivePtId&&window.getActivePtId(); return id&&window.findPatient?window.findPatient(id):null; }, null); }
  function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function bridgeAvailable(){ return safe(function(){ return typeof window._assistReadChart==='function' || typeof window._assistReadAthenaTab==='function' || typeof window.sendToEMRviaAssist==='function'; }, false); }

  function compare(chart, pt){
    if(!chart||!pt) return {state:'unknown'};
    var cn=norm(chart.name||chart.patient||''), pn=norm(pt.name||'');
    var cd=norm(chart.dob||''), pd=norm(pt.dob||'');
    var nameHit = cn && pn && (cn===pn || cn.indexOf(pn)>=0 || pn.indexOf(cn)>=0);
    var dobHit = cd && pd && cd===pd;
    if(nameHit && (dobHit||!cd)) return {state:'match', detail:(chart.name||chart.patient||'')};
    if(nameHit || dobHit) return {state:'partial', detail:(chart.name||chart.patient||'')};
    return {state:'mismatch', detail:(chart.name||chart.patient||'')};
  }
  function readOpenChart(cb){
    // Best-effort, honest: attempt to read the open Athena chart via the app's Assist bridge.
    if(!bridgeAvailable()){ cb(null,'no-bridge'); return; }
    safe(function(){
      var ret = window._assistReadChart ? window._assistReadChart() : (window._assistReadAthenaTab?window._assistReadAthenaTab():null);
      if(ret && typeof ret.then==='function'){ ret.then(function(d){ cb(d,d?null:'empty'); }).catch(function(){ cb(null,'error'); }); }
      else if(ret){ cb(ret,null); }
      else cb(null,'empty');
    }) || cb(null,'error');
  }
  function check(){
    var pt=activePt();
    if(!pt){ toast('Pick an active patient first'); return; }
    panel('Checking the open Athena chart…','wait');
    readOpenChart(function(chart, err){
      if(err==='no-bridge'){ panel('Athena chart match needs MLS Assist + an open, signed-in Athena tab. Install/enable Assist and open the patient in Athena, then check again.','gate'); return; }
      if(!chart || err){ panel('No open Athena chart detected. Open the patient’s chart in your signed-in Athena tab (via MLS Assist), then check again.','gate'); return; }
      if(!(chart.name||chart.patient||chart.dob)){ panel('MLS Assist is connected but no patient chart is open in Athena yet. Open the chart in your signed-in Athena tab, then check again.','gate'); return; }
      var r=compare(chart, pt);
      if(r.state==='match') panel('✓ Match — the open Athena chart is '+esc(pt.name)+'.','ok');
      else if(r.state==='partial') panel('⚠ Partial match — open chart “'+esc(r.detail)+'” vs active “'+esc(pt.name)+'”. Verify before charting.','warn');
      else panel('⚠ Mismatch — Athena shows “'+esc(r.detail)+'” but your active patient is “'+esc(pt.name)+'”. Do not chart until they match.','warn');
    });
  }
  function panel(msg, kind){
    injectCss(); var ex=document.getElementById('mlsMatchPop'); if(ex) ex.remove();
    var p=document.createElement('div'); p.id='mlsMatchPop'; p.className='mls-match-'+(kind||'ok');
    p.innerHTML='<span class="mls-match-msg">'+msg+'</span><button type="button" class="mls-match-x">✕</button>';
    document.body.appendChild(p);
    p.querySelector('.mls-match-x').addEventListener('click', function(){ p.remove(); });
    if(kind!=='wait') setTimeout(function(){ var n=document.getElementById('mlsMatchPop'); if(n) n.remove(); }, 9000);
  }
  function toast(m){ safe(function(){ if(window.toast){window.toast(m,'info');} else panel(m,'gate'); }); }
  function injectCss(){
    if(document.getElementById('mlsMatchCss')) return;
    var s=document.createElement('style'); s.id='mlsMatchCss';
    s.textContent='#mlsMatchPop{position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:100001;max-width:520px;width:calc(100% - 32px);display:flex;gap:10px;align-items:flex-start;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-left:4px solid #2563c9;border-radius:12px;box-shadow:0 16px 44px rgba(15,28,46,.22);padding:13px 14px;font-size:13px;color:var(--ink,#15293f);}'
      +'#mlsMatchPop.mls-match-ok{border-left-color:#16a34a;} #mlsMatchPop.mls-match-warn{border-left-color:#dc2626;} #mlsMatchPop.mls-match-gate{border-left-color:#b45309;} #mlsMatchPop.mls-match-wait{border-left-color:#2563c9;}'
      +'#mlsMatchPop .mls-match-msg{flex:1;line-height:1.4;} #mlsMatchPop .mls-match-x{border:0;background:transparent;cursor:pointer;color:var(--muted,#9aa7b4);font-size:14px;}';
    (document.head||document.documentElement).appendChild(s);
  }
  window.__mlsAthenaMatch={ check:check, _compare:compare, bridgeAvailable:bridgeAvailable };
})();


/* ---- module: feat_legal_chain.js ---- */

/* ===== MLS Clinical -> Legal -> Billing Chain — connectedness feature #10 =====
   Flag a patient as an IME / legal case -> open the app's Legal flow which auto-assembles that
   patient's notes into a report -> (billing) the platform 5% fee hook for when Stripe Connect is
   live. Additive: keeps a per-patient legal-flag store (localStorage), routes into the existing
   legal functions (legalOpenPatient / generateLegalReport / showView('legalreq')), registers a
   timeline provider so legal flags/exports show on the patient timeline, and exposes a fee hook
   (window.__mlsLegalFee) that computes the 5% platform fee and is ready to call Connect once live.
   The actual fee capture is GATED on Stripe Connect go-live (documented), never charged here. */
(function(){
  'use strict';
  if (window.__mlsLegalChain) return;
  var FEE_RATE=0.05;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function email(){ return safe(function(){ return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]; }, null); }
  function fkey(){ var e=email(); return e?('sf_u::'+e+'::mlsLegalFlags'):null; }
  function getFlags(){ var k=fkey(); return k?safe(function(){return JSON.parse(localStorage.getItem(k)||'{}');},{}):{}; }
  function setFlags(o){ var k=fkey(); if(k) safe(function(){ localStorage.setItem(k, JSON.stringify(o)); }); }
  function isFlagged(id){ return !!getFlags()[id]; }
  function activeId(){ return safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null); }
  function ptName(id){ return safe(function(){ var p=window.findPatient&&window.findPatient(id); return p?(p.name||''):''; }, ''); }
  function toast(m){ safe(function(){ if(window.toast){window.toast(m,'ok');return;} var d=document.createElement('div'); d.textContent=m; d.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#15293f;color:#fff;padding:8px 14px;border-radius:10px;z-index:100001;font-size:13px'; document.body.appendChild(d); setTimeout(function(){d.remove();},1600); }); }

  function flagCase(id, type){
    id=id||activeId(); if(!id){ toast('Pick an active patient first'); return; }
    var f=getFlags(); f[id]={type:type||'IME/legal', ts:Date.now()}; setFlags(f);
    toast('Flagged '+(ptName(id)||'patient')+' as '+(type||'IME/legal')+' case');
    // route into the app's legal flow which auto-assembles this patient's notes
    safe(function(){
      if(window.legalOpenPatient){ window.legalOpenPatient(id); }
      else if(window.generateLegalReport){ if(window.setActivePtId) window.setActivePtId(id); window.generateLegalReport(); }
      else if(window.showView){ window.showView('legalreq'); }
    });
  }
  function unflag(id){ var f=getFlags(); delete f[id]; setFlags(f); }

  // billing fee hook — computes the 5% platform fee; GATED until Stripe Connect is live.
  var feeHook={
    rate:FEE_RATE,
    compute:function(amountCents){ amountCents=+amountCents||0; var fee=Math.round(amountCents*FEE_RATE); return {amountCents:amountCents, feeCents:fee, netCents:amountCents-fee, rate:FEE_RATE}; },
    connectReady:function(){ return safe(function(){ return !!(window.stripeConnectReady||window.connectReady); }, false); },
    capture:function(amountCents){
      var calc=this.compute(amountCents);
      if(!this.connectReady()){ return {gated:true, reason:'Stripe Connect not live — 5% fee computed but not charged', calc:calc}; }
      // when Connect is live, the backend destination-charge/application-fee flow handles capture.
      return {gated:false, calc:calc};
    }
  };

  function legalProvider(id){
    var f=getFlags()[id]; if(!f) return [];
    return [{ date:f.ts, type:'legal', icon:'⚖️', title:'Flagged as '+(f.type||'IME/legal')+' case',
      sub:'Legal exports assemble this patient’s notes', onClick:function(){ safe(function(){ if(window.legalOpenPatient) window.legalOpenPatient(id); else if(window.showView) window.showView('legalreq'); }); } }];
  }
  function activityProvider(){
    var f=getFlags(); return Object.keys(f).map(function(id){ return { date:f[id].ts, type:'baa', icon:'⚖️', title:'IME/legal case flagged', sub:ptName(id)||'', onClick:function(){ safe(function(){ if(window.legalOpenPatient) window.legalOpenPatient(id); else if(window.showView) window.showView('legalreq'); }); } }; }); }

  function init(){
    safe(function(){ if(window.__mlsTimeline&&window.__mlsTimeline.addProvider) window.__mlsTimeline.addProvider(legalProvider); });
    safe(function(){ if(window.__mlsActivity&&window.__mlsActivity.addProvider) window.__mlsActivity.addProvider(activityProvider); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__mlsLegalFee=feeHook;
  window.__mlsLegalChain={ flagCase:flagCase, unflag:unflag, isFlagged:isFlagged, getFlags:getFlags, fee:feeHook };
})();


/* ---- module: feat_code_sheet.js ---- */

/* ===== MLS Billing Code Sheet — optional prefilled/curated code set =====
   A practice-maintained, editable billing code sheet (CPT procedures, ICD-10 diagnoses,
   E/M levels, spinal levels, injectables), seeded from the practice's paper superbill.
   Three jobs, all OPTIONAL and additive (the pure-AI path is untouched when unused):
     1) MANAGE — open()  : edit/add/delete codes, import/export JSON, reset to seed,
                            and toggle "validate AI codes against this sheet".
     2) PICK    — pick()  : superbill-style checkbox quick-select for a visit; the picked
                            codes copy as a clean block and/or insert into the note field.
     3) GUARD   — validate(text) / when constrainAI is on: checks the codes that appear in a
                  note against the approved set + a small retired-code map, flagging anything
                  out-of-set, retired, or malformed so it never gets billed blind.
   Pure parse/read/localStorage; never patches an app function. Exposes window.__mlsCodeSheet.
   Storage: per-user localStorage key  sf_u::<email>::mlsCodeSheet  (mirrors other modules). */
(function(){
  'use strict';
  if (window.__mlsCodeSheet) return;
  var LSVER=1;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function email(){ return safe(function(){ if(window.bkUser&&window.bkUser.email) return window.bkUser.email; return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]||null; }, null); }
  function lsKey(){ var e=email(); return e?('sf_u::'+e+'::mlsCodeSheet'):'sf_u::_local::mlsCodeSheet'; }
  function toast(msg){ safe(function(){ if(window.toast){ window.toast(msg,'ok'); return; } var d=document.createElement('div'); d.textContent=msg; d.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#15293f;color:#fff;padding:8px 14px;border-radius:10px;z-index:100001;font-size:13px'; document.body.appendChild(d); setTimeout(function(){d.remove();},1500); }); }
  function copyTxt(txt){ safe(function(){ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt); } else { var t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } toast('Copied'); }); }

  /* ---------- SEED (from the practice charge sheet: spine / pain / PM&R) ---------- */
  function seed(){
    return {
      version:LSVER, constrainAI:false,
      cpt:[
        // Epidural steroid injections
        {code:'64479',desc:'TFESI / transforaminal ESI — cervical or thoracic, single level',group:'Epidural steroid injection'},
        {code:'64480',desc:'TFESI cervical/thoracic — each additional level (add-on)',group:'Epidural steroid injection'},
        {code:'64483',desc:'TFESI / transforaminal ESI — lumbar or sacral, single level',group:'Epidural steroid injection'},
        {code:'64484',desc:'TFESI lumbar/sacral — each additional level (add-on)',group:'Epidural steroid injection'},
        {code:'62321',desc:'Interlaminar/caudal ESI — cervical or thoracic (with imaging)',group:'Epidural steroid injection'},
        {code:'62323',desc:'Interlaminar/caudal ESI — lumbar or sacral (with imaging)',group:'Epidural steroid injection'},
        // Facet / medial branch blocks
        {code:'64490',desc:'Facet (medial branch) block — cervical or thoracic, 1st level',group:'Facet / medial branch block'},
        {code:'64491',desc:'Facet block cervical/thoracic — 2nd level (add-on)',group:'Facet / medial branch block'},
        {code:'64492',desc:'Facet block cervical/thoracic — 3rd+ level (add-on)',group:'Facet / medial branch block'},
        {code:'64493',desc:'Facet (medial branch) block — lumbar or sacral, 1st level',group:'Facet / medial branch block'},
        {code:'64494',desc:'Facet block lumbar/sacral — 2nd level (add-on)',group:'Facet / medial branch block'},
        {code:'64495',desc:'Facet block lumbar/sacral — 3rd+ level (add-on)',group:'Facet / medial branch block'},
        // Sacroiliac
        {code:'27096',desc:'Sacroiliac joint injection (with imaging guidance)',group:'Sacroiliac injection'},
        // Neurotomy / RF ablation
        {code:'64633',desc:'RF ablation, facet joint nerve — cervical or thoracic, 1st joint',group:'Neurotomy (RF ablation)'},
        {code:'64634',desc:'RF ablation cervical/thoracic — each additional joint (add-on)',group:'Neurotomy (RF ablation)'},
        {code:'64635',desc:'RF ablation, facet joint nerve — lumbar or sacral, 1st joint',group:'Neurotomy (RF ablation)'},
        {code:'64636',desc:'RF ablation lumbar/sacral — each additional joint (add-on)',group:'Neurotomy (RF ablation)'},
        {code:'64640',desc:'Destruction of other peripheral nerve or branch',group:'Neurotomy (RF ablation)'},
        // Tendon / joint / other
        {code:'20610',desc:'Major joint or bursa injection (or supratrochanteric)',group:'Tendon / joint / other'},
        {code:'20605',desc:'Intermediate joint/bursa injection (e.g., coccyx)',group:'Tendon / joint / other'},
        {code:'20550',desc:'Tendon sheath / ligament injection',group:'Tendon / joint / other'},
        {code:'77002',desc:'Fluoroscopic guidance for needle placement',group:'Tendon / joint / other'},
        {code:'63650',desc:'Percutaneous implantation, neurostimulator electrode array',group:'Tendon / joint / other'}
      ],
      icd:[
        // Disc disorder WITH MYELOPATHY
        {code:'M50.01',desc:'Cervical disc disorder w/ myelopathy — C2–C4 (high cervical)',group:'Disc disorder — myelopathy'},
        {code:'M50.021',desc:'Cervical disc disorder w/ myelopathy — C4–C5',group:'Disc disorder — myelopathy'},
        {code:'M50.022',desc:'Cervical disc disorder w/ myelopathy — C5–C6',group:'Disc disorder — myelopathy'},
        {code:'M50.023',desc:'Cervical disc disorder w/ myelopathy — C6–C7',group:'Disc disorder — myelopathy'},
        {code:'M50.03',desc:'Cervical disc disorder w/ myelopathy — C7–T1 (cervicothoracic)',group:'Disc disorder — myelopathy'},
        {code:'M51.04',desc:'Thoracic disc disorder w/ myelopathy',group:'Disc disorder — myelopathy'},
        {code:'M51.05',desc:'Thoracolumbar disc disorder w/ myelopathy',group:'Disc disorder — myelopathy'},
        {code:'M51.06',desc:'Lumbar disc disorder w/ myelopathy',group:'Disc disorder — myelopathy'},
        {code:'M51.07',desc:'Lumbosacral disc disorder w/ myelopathy',group:'Disc disorder — myelopathy'},
        // Disc disorder WITH RADICULOPATHY
        {code:'M50.11',desc:'Cervical disc disorder w/ radiculopathy — C2–C4',group:'Disc disorder — radiculopathy'},
        {code:'M50.121',desc:'Cervical disc disorder w/ radiculopathy — C4–C5',group:'Disc disorder — radiculopathy'},
        {code:'M50.122',desc:'Cervical disc disorder w/ radiculopathy — C5–C6',group:'Disc disorder — radiculopathy'},
        {code:'M50.123',desc:'Cervical disc disorder w/ radiculopathy — C6–C7',group:'Disc disorder — radiculopathy'},
        {code:'M50.13',desc:'Cervical disc disorder w/ radiculopathy — C7–T1',group:'Disc disorder — radiculopathy'},
        {code:'M51.14',desc:'Thoracic disc disorder w/ radiculopathy',group:'Disc disorder — radiculopathy'},
        {code:'M51.15',desc:'Thoracolumbar disc disorder w/ radiculopathy',group:'Disc disorder — radiculopathy'},
        {code:'M51.16',desc:'Lumbar disc disorder w/ radiculopathy',group:'Disc disorder — radiculopathy'},
        {code:'M51.17',desc:'Lumbosacral disc disorder w/ radiculopathy',group:'Disc disorder — radiculopathy'},
        // Spondylosis WITH MYELOPATHY
        {code:'M47.12',desc:'Spondylosis w/ myelopathy — cervical',group:'Spondylosis — myelopathy'},
        {code:'M47.13',desc:'Spondylosis w/ myelopathy — cervicothoracic',group:'Spondylosis — myelopathy'},
        {code:'M47.14',desc:'Spondylosis w/ myelopathy — thoracic',group:'Spondylosis — myelopathy'},
        {code:'M47.15',desc:'Spondylosis w/ myelopathy — thoracolumbar',group:'Spondylosis — myelopathy'},
        {code:'M47.16',desc:'Spondylosis w/ myelopathy — lumbar',group:'Spondylosis — myelopathy'},
        {code:'M47.17',desc:'Spondylosis w/ myelopathy — lumbosacral',group:'Spondylosis — myelopathy'},
        {code:'M47.18',desc:'Spondylosis w/ myelopathy — sacral / sacrococcygeal',group:'Spondylosis — myelopathy'},
        // Spondylosis WITH RADICULOPATHY
        {code:'M47.22',desc:'Spondylosis w/ radiculopathy — cervical',group:'Spondylosis — radiculopathy'},
        {code:'M47.23',desc:'Spondylosis w/ radiculopathy — cervicothoracic',group:'Spondylosis — radiculopathy'},
        {code:'M47.24',desc:'Spondylosis w/ radiculopathy — thoracic',group:'Spondylosis — radiculopathy'},
        {code:'M47.25',desc:'Spondylosis w/ radiculopathy — thoracolumbar',group:'Spondylosis — radiculopathy'},
        {code:'M47.26',desc:'Spondylosis w/ radiculopathy — lumbar',group:'Spondylosis — radiculopathy'},
        {code:'M47.27',desc:'Spondylosis w/ radiculopathy — lumbosacral',group:'Spondylosis — radiculopathy'},
        {code:'M47.28',desc:'Spondylosis w/ radiculopathy — sacral / sacrococcygeal',group:'Spondylosis — radiculopathy'},
        // Spondylosis WITHOUT myelopathy/radiculopathy = facet syndrome
        {code:'M47.812',desc:'Spondylosis w/o myelo/radiculopathy (facet) — cervical',group:'Facet syndrome (M47.81-)'},
        {code:'M47.813',desc:'Spondylosis w/o myelo/radiculopathy (facet) — cervicothoracic',group:'Facet syndrome (M47.81-)'},
        {code:'M47.814',desc:'Spondylosis w/o myelo/radiculopathy (facet) — thoracic',group:'Facet syndrome (M47.81-)'},
        {code:'M47.815',desc:'Spondylosis w/o myelo/radiculopathy (facet) — thoracolumbar',group:'Facet syndrome (M47.81-)'},
        {code:'M47.816',desc:'Spondylosis w/o myelo/radiculopathy (facet) — lumbar',group:'Facet syndrome (M47.81-)'},
        {code:'M47.817',desc:'Spondylosis w/o myelo/radiculopathy (facet) — lumbosacral',group:'Facet syndrome (M47.81-)'},
        {code:'M47.818',desc:'Spondylosis w/o myelo/radiculopathy (facet) — sacral / sacrococcygeal',group:'Facet syndrome (M47.81-)'},
        // Spondylolisthesis
        {code:'M43.12',desc:'Spondylolisthesis — cervical',group:'Spondylolisthesis'},
        {code:'M43.13',desc:'Spondylolisthesis — cervicothoracic',group:'Spondylolisthesis'},
        {code:'M43.14',desc:'Spondylolisthesis — thoracic',group:'Spondylolisthesis'},
        {code:'M43.15',desc:'Spondylolisthesis — thoracolumbar',group:'Spondylolisthesis'},
        {code:'M43.16',desc:'Spondylolisthesis — lumbar',group:'Spondylolisthesis'},
        {code:'M43.17',desc:'Spondylolisthesis — lumbosacral',group:'Spondylolisthesis'},
        // Spinal stenosis
        {code:'M48.02',desc:'Spinal stenosis — cervical',group:'Spinal stenosis'},
        {code:'M48.03',desc:'Spinal stenosis — cervicothoracic',group:'Spinal stenosis'},
        {code:'M48.04',desc:'Spinal stenosis — thoracic',group:'Spinal stenosis'},
        {code:'M48.05',desc:'Spinal stenosis — thoracolumbar',group:'Spinal stenosis'},
        {code:'M48.061',desc:'Spinal stenosis — lumbar, w/o neurogenic claudication',group:'Spinal stenosis'},
        {code:'M48.062',desc:'Spinal stenosis — lumbar, w/ neurogenic claudication',group:'Spinal stenosis'},
        {code:'M48.07',desc:'Spinal stenosis — lumbosacral',group:'Spinal stenosis'},
        {code:'M48.08',desc:'Spinal stenosis — sacral / sacrococcygeal',group:'Spinal stenosis'},
        // Symptoms & misc
        {code:'M54.2',desc:'Cervicalgia',group:'Symptoms & misc'},
        {code:'M54.6',desc:'Pain in thoracic spine',group:'Symptoms & misc'},
        {code:'M54.41',desc:'Lumbago with sciatica, right side',group:'Symptoms & misc'},
        {code:'M54.42',desc:'Lumbago with sciatica, left side',group:'Symptoms & misc'},
        {code:'M79.1',desc:'Myalgia / myofascial pain',group:'Symptoms & misc'},
        {code:'M96.1',desc:'Postlaminectomy syndrome, NEC',group:'Symptoms & misc'},
        {code:'M53.3',desc:'Sacrococcygeal disorders, NEC (coccygodynia; SI dysfunction per sheet)',group:'Symptoms & misc'},
        {code:'M46.1',desc:'Sacroiliitis, NEC',group:'Symptoms & misc'},
        {code:'S33.6XXA',desc:'Sprain of sacroiliac joint, initial encounter',group:'Symptoms & misc'},
        {code:'M53.2X8',desc:'Spinal instabilities, sacral and sacrococcygeal region',group:'Symptoms & misc'},
        {code:'G89.4',desc:'Chronic pain syndrome',group:'Symptoms & misc'},
        // Hip
        {code:'M16.11',desc:'Unilateral primary osteoarthritis, right hip',group:'Hip'},
        {code:'M16.12',desc:'Unilateral primary osteoarthritis, left hip',group:'Hip'},
        {code:'M16.0',desc:'Bilateral primary osteoarthritis of hip',group:'Hip'},
        {code:'M70.71',desc:'Other bursitis of hip (iliopsoas), right',group:'Hip'},
        {code:'M70.72',desc:'Other bursitis of hip (iliopsoas), left',group:'Hip'},
        {code:'M25.551',desc:'Pain in right hip',group:'Hip'},
        {code:'M25.552',desc:'Pain in left hip',group:'Hip'}
      ],
      em:[
        {code:'99202',desc:'New patient — straightforward MDM (15–29 min)'},
        {code:'99203',desc:'New patient — low MDM (30–44 min)'},
        {code:'99204',desc:'New patient — moderate MDM (45–59 min)'},
        {code:'99205',desc:'New patient — high MDM (60–74 min)'},
        {code:'99211',desc:'Established — minimal (may not require physician)'},
        {code:'99212',desc:'Established — straightforward MDM (10–19 min)'},
        {code:'99213',desc:'Established — low MDM (20–29 min)'},
        {code:'99214',desc:'Established — moderate MDM (30–39 min)'},
        {code:'99215',desc:'Established — high MDM (40–54 min)'}
      ],
      levels:['Cervical','Cervicothoracic','Thoracic','Thoracolumbar','Lumbar','Lumbosacral','Sacral / sacrococcygeal',
              'C2–C3','C3–C4','C4–C5','C5–C6','C6–C7','C7–T1','T11–T12','T12–L1','L1–L2','L2–L3','L3–L4','L4–L5','L5–S1','S1–S2'],
      meds:[
        {name:'Celestone (betamethasone)',detail:'3 mg / 0.5 cc per unit'},
        {name:'Marcaine (bupivacaine)',detail:'max 1 unit'},
        {name:'Kenalog (triamcinolone)',detail:'1 mg per unit'},
        {name:'Decadron (dexamethasone)',detail:'1 mg per unit'},
        {name:'Depo-Medrol (methylprednisolone)',detail:'40 mg per unit / cc'}
      ]
    };
  }
  /* Retired / superseded codes — flagged by the guardrail with replacement guidance. */
  var RETIRED={
    'M54.5':'Deleted 1 Oct 2021 — use M54.50 (LBP, unspecified), M54.51 (vertebrogenic LBP), or M54.59 (other LBP). M54.5 now denies.',
    '99201':'Deleted 2021 — report 99202 for a level-1 new-patient visit.',
    '64622':'Legacy facet RF code — current codes are 64633–64636.',
    '64623':'Legacy facet RF add-on — current codes are 64633–64636.',
    '64626':'Legacy facet RF code — current codes are 64633–64636.',
    '64627':'Legacy facet RF add-on — current codes are 64633–64636.'
  };

  /* ---------- state ---------- */
  function load(){
    var raw=safe(function(){ return localStorage.getItem(lsKey()); }, null);
    if(!raw) return seed();
    var v=safe(function(){ return JSON.parse(raw); }, null);
    if(!v || typeof v!=='object' || !Array.isArray(v.cpt) || !Array.isArray(v.icd)) return seed();
    if(typeof v.constrainAI!=='boolean') v.constrainAI=false;
    ['em','levels','meds'].forEach(function(k){ if(!Array.isArray(v[k])) v[k]=seed()[k]; });
    return v;
  }
  function save(v){ safe(function(){ localStorage.setItem(lsKey(), JSON.stringify(v)); }); }
  var state=load();
  function constrainOn(){ return !!(state&&state.constrainAI); }

  /* approved-code lookup (CPT+ICD+EM), normalized */
  function norm(c){ return String(c||'').toUpperCase().replace(/\s+/g,''); }
  function approvedSet(){
    var s={};
    (state.cpt||[]).forEach(function(r){ if(r&&r.code) s[norm(r.code)]={kind:'CPT',desc:r.desc}; });
    (state.em||[]).forEach(function(r){ if(r&&r.code) s[norm(r.code)]={kind:'E/M',desc:r.desc}; });
    (state.icd||[]).forEach(function(r){ if(r&&r.code) s[norm(r.code)]={kind:'ICD-10',desc:r.desc}; });
    return s;
  }

  /* ---------- guardrail: validate codes that appear in a note/text ---------- */
  function scanCodes(text){
    text=String(text||'');
    var icd=(text.match(/\b[A-TV-Z]\d\d(?:\.[A-Z0-9]{1,4})?\b/g)||[]).filter(function(c){ return /\.[A-Z0-9]/.test(c) || /^[A-TV-Z]\d\d$/.test(c); });
    var cpt=(text.match(/\b\d{5}\b/g)||[]).filter(function(c){ var n=+c; return n>=10000&&n<=99499; });
    var all=[], seen={};
    icd.concat(cpt).forEach(function(c){ var k=norm(c); if(!seen[k]){ seen[k]=1; all.push(c); } });
    return all;
  }
  function validate(text){
    var codes=scanCodes(text), set=approvedSet(), out=[];
    codes.forEach(function(c){
      var k=norm(c), r;
      if(RETIRED[k]) r={code:c,status:'retired',note:RETIRED[k]};
      else if(set[k]) r={code:c,status:'approved',note:set[k].kind+' · '+set[k].desc};
      else r={code:c,status:'unknown',note:'Not in your approved code sheet — verify before billing.'};
      out.push(r);
    });
    return out;
  }

  /* ---------- shared overlay scaffold ---------- */
  function injectCss(){
    if(document.getElementById('mlsCsCss')) return;
    var s=document.createElement('style'); s.id='mlsCsCss';
    s.textContent=
      '.mlscs-ov{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.42);display:flex;align-items:flex-start;justify-content:center;padding:7vh 16px 16px;backdrop-filter:blur(2px);}'
      +'.mlscs-panel{width:100%;max-width:760px;max-height:84vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mlscs-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px 10px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlscs-h{font-weight:700;font-size:15.5px;color:var(--ink,#15293f);display:flex;align-items:center;gap:8px;}'
      +'.mlscs-x{border:0;background:transparent;font-size:17px;cursor:pointer;color:var(--muted,#7c8aa0);padding:4px 7px;border-radius:8px;}'
      +'.mlscs-x:hover{background:var(--surface,#f1f4f9);}'
      +'.mlscs-tools{display:flex;flex-wrap:wrap;gap:7px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlscs-search{flex:1;min-width:140px;font:inherit;font-size:13px;padding:7px 10px;border:1px solid var(--line,#e6e9ef);border-radius:9px;background:var(--surface,#fafcff);color:var(--ink,#15293f);}'
      +'.mlscs-btn{font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--brand,#2563c9);border-radius:9px;padding:7px 12px;}'
      +'.mlscs-btn:hover{filter:brightness(.98);background:var(--surface,#f1f4f9);}'
      +'.mlscs-btn.pri{background:var(--brand,#2563c9);color:#fff;border-color:var(--brand,#2563c9);}'
      +'.mlscs-btn.danger{color:#b42318;border-color:#f0c5c0;}'
      +'.mlscs-toggle{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:12.5px;color:var(--ink,#15293f);}'
      +'.mlscs-body{overflow:auto;padding:8px 16px 16px;}'
      +'.mlscs-sec{margin-top:14px;}'
      +'.mlscs-sectitle{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted,#7c8aa0);margin:6px 0 6px;display:flex;align-items:center;gap:8px;}'
      +'.mlscs-row{display:flex;align-items:center;gap:9px;padding:6px 6px;border-radius:9px;}'
      +'.mlscs-row:hover{background:var(--surface,#f7f9fc);}'
      +'.mlscs-code{font-weight:700;font-size:13px;color:var(--ink,#15293f);min-width:74px;font-variant-numeric:tabular-nums;}'
      +'.mlscs-desc{font-size:12.7px;color:var(--muted,#56657a);flex:1;min-width:0;}'
      +'.mlscs-rowact{display:flex;gap:4px;flex:0 0 auto;opacity:.55;}'
      +'.mlscs-row:hover .mlscs-rowact{opacity:1;}'
      +'.mlscs-mini{border:0;background:transparent;cursor:pointer;font-size:12px;color:var(--muted,#7c8aa0);padding:3px 6px;border-radius:7px;}'
      +'.mlscs-mini:hover{background:var(--line,#e6e9ef);color:var(--ink,#15293f);}'
      +'.mlscs-chk{width:16px;height:16px;flex:0 0 auto;accent-color:var(--brand,#2563c9);cursor:pointer;}'
      +'.mlscs-foot{display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--line,#e6e9ef);background:var(--surface,#fafcff);}'
      +'.mlscs-tray{flex:1;min-width:0;font-size:12.5px;color:var(--ink,#15293f);}'
      +'.mlscs-empty{padding:24px 12px;text-align:center;color:var(--muted,#7c8aa0);font-size:13.5px;}'
      +'.mlscs-vrow{display:flex;align-items:center;gap:9px;padding:7px 9px;border:1px solid var(--line,#e6e9ef);border-radius:10px;margin-bottom:7px;}'
      +'.mlscs-vdot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}'
      +'.mlscs-vok .mlscs-vdot{background:#1f9d57;} .mlscs-vunk .mlscs-vdot{background:#d98a00;} .mlscs-vret .mlscs-vdot{background:#d64545;}'
      +'.mlscs-vcode{font-weight:700;font-size:13px;min-width:72px;color:var(--ink,#15293f);}'
      +'.mlscs-vnote{font-size:12.3px;color:var(--muted,#56657a);flex:1;min-width:0;}'
      +'.mlscs-badge{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;padding:2px 7px;border-radius:999px;flex:0 0 auto;}'
      +'.mlscs-vok .mlscs-badge{background:#e7f6ee;color:#1f7a45;} .mlscs-vunk .mlscs-badge{background:#fdf3e0;color:#9a6700;} .mlscs-vret .mlscs-badge{background:#fbe9e9;color:#b42318;}'
      +'@media (max-width:680px){.mlscs-panel{max-height:92vh;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  var OV=null;
  function shell(titleHtml){
    injectCss(); close();
    OV=document.createElement('div'); OV.className='mlscs-ov';
    OV.innerHTML='<div class="mlscs-panel" role="dialog" aria-label="Billing code sheet">'
      +'<div class="mlscs-head"><span class="mlscs-h">'+titleHtml+'</span><button type="button" class="mlscs-x" id="mlsCsX">✕</button></div>'
      +'<div id="mlsCsTop"></div><div class="mlscs-body" id="mlsCsBody"></div><div id="mlsCsFoot"></div></div>';
    document.body.appendChild(OV);
    OV.addEventListener('mousedown',function(e){ if(e.target===OV) close(); });
    document.getElementById('mlsCsX').addEventListener('click', close);
    return OV;
  }
  function close(){ if(OV&&OV.parentNode) OV.parentNode.removeChild(OV); OV=null; }
  function groupBy(arr){ var g={},order=[]; (arr||[]).forEach(function(r){ var k=r.group||'Other'; if(!g[k]){g[k]=[];order.push(k);} g[k].push(r); }); return {g:g,order:order}; }

  /* ============================ MANAGER ============================ */
  function open(){
    var ov=shell('🧾 Billing code sheet');
    document.getElementById('mlsCsTop').innerHTML=
      '<div class="mlscs-tools">'
      +'<input id="mlsCsSearch" class="mlscs-search" placeholder="Filter codes or descriptions…">'
      +'<button type="button" class="mlscs-btn" id="mlsCsAdd">+ Add code</button>'
      +'<button type="button" class="mlscs-btn" id="mlsCsExport">Export</button>'
      +'<button type="button" class="mlscs-btn" id="mlsCsImport">Import</button>'
      +'<button type="button" class="mlscs-btn danger" id="mlsCsReset">Reset to sheet</button>'
      +'<label class="mlscs-toggle"><input type="checkbox" id="mlsCsConstrain" '+(constrainOn()?'checked':'')+'> Validate AI codes against this sheet</label>'
      +'</div>';
    var foot=document.getElementById('mlsCsFoot');
    foot.innerHTML='<div class="mlscs-foot"><span class="mlscs-tray" id="mlsCsCount"></span>'
      +'<button type="button" class="mlscs-btn pri" id="mlsCsPickFromMgr">Pick codes for a visit →</button></div>';
    renderManager('');
    var sc=document.getElementById('mlsCsSearch'); if(sc) sc.addEventListener('input', function(){ renderManager(sc.value); });
    document.getElementById('mlsCsAdd').addEventListener('click', addCodePrompt);
    document.getElementById('mlsCsExport').addEventListener('click', exportSheet);
    document.getElementById('mlsCsImport').addEventListener('click', importSheet);
    document.getElementById('mlsCsReset').addEventListener('click', function(){ if(confirm('Reset the code sheet to the practice defaults? Your edits will be replaced.')){ state=seed(); save(state); renderManager(''); toast('Reset to defaults'); } });
    document.getElementById('mlsCsConstrain').addEventListener('change', function(e){ state.constrainAI=!!e.target.checked; save(state); toast(state.constrainAI?'AI codes will be validated':'Validation off'); });
    document.getElementById('mlsCsPickFromMgr').addEventListener('click', pick);
  }
  function renderManager(filter){
    var body=document.getElementById('mlsCsBody'); if(!body) return;
    var q=(filter||'').toLowerCase().trim();
    function match(r){ if(!q) return true; return (String(r.code||r.name||'')+' '+String(r.desc||r.detail||'')).toLowerCase().indexOf(q)>=0; }
    var total=(state.cpt.length+state.icd.length+state.em.length);
    var cnt=document.getElementById('mlsCsCount'); if(cnt) cnt.textContent=total+' billable codes · '+state.cpt.length+' CPT · '+state.icd.length+' ICD-10 · '+state.em.length+' E/M';
    var html='';
    html+=sectionHtml('CPT — procedures','cpt',state.cpt.filter(match),true);
    html+=sectionHtml('E/M levels','em',state.em.filter(match),false);
    html+=sectionHtml('ICD-10 — diagnoses','icd',state.icd.filter(match),true);
    // levels + meds (reference lists)
    html+='<div class="mlscs-sec"><div class="mlscs-sectitle">Spinal levels</div><div class="mlscs-desc" style="padding:0 6px">'+ (state.levels||[]).map(esc).join(' · ') +'</div></div>';
    html+='<div class="mlscs-sec"><div class="mlscs-sectitle">Injectables</div>'+ (state.meds||[]).map(function(m){ return '<div class="mlscs-row"><span class="mlscs-desc">'+esc(m.name)+' — '+esc(m.detail||'')+'</span></div>'; }).join('') +'</div>';
    body.innerHTML=html||'<div class="mlscs-empty">No codes match “'+esc(filter)+'”.</div>';
    bindManagerRows();
  }
  function sectionHtml(title,kind,rows,grouped){
    if(!rows.length) return '';
    var html='<div class="mlscs-sec"><div class="mlscs-sectitle">'+esc(title)+' ('+rows.length+')</div>';
    if(grouped){ var gb=groupBy(rows); gb.order.forEach(function(gname){
      html+='<div class="mlscs-sectitle" style="font-weight:700;text-transform:none;letter-spacing:0;color:var(--ink,#15293f);opacity:.7;margin-top:8px">'+esc(gname)+'</div>';
      gb.g[gname].forEach(function(r){ html+=mgrRow(kind,r); });
    }); }
    else rows.forEach(function(r){ html+=mgrRow(kind,r); });
    return html+'</div>';
  }
  function mgrRow(kind,r){
    return '<div class="mlscs-row" data-kind="'+kind+'" data-code="'+esc(r.code)+'">'
      +'<span class="mlscs-code">'+esc(r.code)+'</span><span class="mlscs-desc">'+esc(r.desc||'')+'</span>'
      +'<span class="mlscs-rowact"><button type="button" class="mlscs-mini" data-act="edit">Edit</button><button type="button" class="mlscs-mini" data-act="del">✕</button></span></div>';
  }
  function bindManagerRows(){
    var body=document.getElementById('mlsCsBody'); if(!body) return;
    body.querySelectorAll('.mlscs-mini').forEach(function(btn){
      btn.addEventListener('click', function(){
        var row=btn.closest('.mlscs-row'); var kind=row.getAttribute('data-kind'), code=row.getAttribute('data-code');
        var arr=state[kind]; var idx=arr.findIndex(function(x){ return String(x.code)===code; });
        if(idx<0) return;
        if(btn.getAttribute('data-act')==='del'){ if(confirm('Remove '+code+'?')){ arr.splice(idx,1); save(state); renderManager(document.getElementById('mlsCsSearch').value); } }
        else { var nd=prompt('Edit description for '+code+':', arr[idx].desc||''); if(nd!=null){ arr[idx].desc=nd; save(state); renderManager(document.getElementById('mlsCsSearch').value); } }
      });
    });
  }
  function addCodePrompt(){
    var kind=prompt('Add to which list? Type: cpt, icd, or em','cpt'); if(!kind) return; kind=kind.toLowerCase().trim();
    if(['cpt','icd','em'].indexOf(kind)<0){ toast('Use cpt, icd, or em'); return; }
    var code=prompt('Code (e.g. 64483 or M54.51):',''); if(!code) return; code=code.trim();
    if(state[kind].some(function(x){ return norm(x.code)===norm(code); })){ toast('Already on the sheet'); return; }
    var desc=prompt('Description:','')||'';
    var rec={code:code,desc:desc}; if(kind!=='em') rec.group=(prompt('Group/category (optional):','')||'Other');
    state[kind].push(rec); save(state); renderManager(''); toast('Added '+code);
  }
  function exportSheet(){
    var blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='mls-code-sheet.json'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },300); toast('Exported');
  }
  function importSheet(){
    var inp=document.createElement('input'); inp.type='file'; inp.accept='application/json,.json';
    inp.addEventListener('change', function(){ var f=inp.files&&inp.files[0]; if(!f) return; var rd=new FileReader(); rd.onload=function(){ var v=safe(function(){ return JSON.parse(rd.result); },null); if(!v||!Array.isArray(v.cpt)||!Array.isArray(v.icd)){ toast('Not a valid code sheet'); return; } if(typeof v.constrainAI!=='boolean') v.constrainAI=state.constrainAI; ['em','levels','meds'].forEach(function(k){ if(!Array.isArray(v[k])) v[k]=state[k]; }); state=v; save(state); renderManager(''); toast('Imported'); }; rd.readAsText(f); });
    inp.click();
  }

  /* ============================ SUPERBILL PICKER ============================ */
  var picked={};
  function pick(){
    picked={};
    var ov=shell('☑️ Pick visit codes');
    document.getElementById('mlsCsTop').innerHTML='<div class="mlscs-tools"><input id="mlsCsPSearch" class="mlscs-search" placeholder="Filter…"><span class="mlscs-toggle" style="margin-left:auto;color:var(--muted,#7c8aa0);font-size:12px">Tick codes like a paper superbill</span></div>';
    document.getElementById('mlsCsFoot').innerHTML='<div class="mlscs-foot"><span class="mlscs-tray" id="mlsCsPicked">No codes selected.</span>'
      +'<button type="button" class="mlscs-btn" id="mlsCsCopy">Copy selected</button>'
      +'<button type="button" class="mlscs-btn pri" id="mlsCsInsert">Insert into note</button></div>';
    renderPicker('');
    var sc=document.getElementById('mlsCsPSearch'); if(sc) sc.addEventListener('input', function(){ renderPicker(sc.value); });
    document.getElementById('mlsCsCopy').addEventListener('click', function(){ copyTxt(selectedBlock()); });
    document.getElementById('mlsCsInsert').addEventListener('click', insertIntoNote);
  }
  function renderPicker(filter){
    var body=document.getElementById('mlsCsBody'); if(!body) return;
    var q=(filter||'').toLowerCase().trim();
    function match(r){ if(!q) return true; return (String(r.code||'')+' '+String(r.desc||'')).toLowerCase().indexOf(q)>=0; }
    function pickSec(title,kind,rows,grouped){
      rows=rows.filter(match); if(!rows.length) return '';
      var html='<div class="mlscs-sec"><div class="mlscs-sectitle">'+esc(title)+'</div>';
      function rowHtml(r){ var id=kind+'::'+r.code; return '<label class="mlscs-row"><input type="checkbox" class="mlscs-chk" data-id="'+esc(id)+'" data-kind="'+kind+'" data-code="'+esc(r.code)+'" '+(picked[id]?'checked':'')+'><span class="mlscs-code">'+esc(r.code)+'</span><span class="mlscs-desc">'+esc(r.desc||'')+'</span></label>'; }
      if(grouped){ var gb=groupBy(rows); gb.order.forEach(function(g){ html+='<div class="mlscs-sectitle" style="font-weight:700;text-transform:none;letter-spacing:0;opacity:.65;color:var(--ink,#15293f);margin-top:6px">'+esc(g)+'</div>'; gb.g[g].forEach(function(r){ html+=rowHtml(r); }); }); }
      else rows.forEach(function(r){ html+=rowHtml(r); });
      return html+'</div>';
    }
    body.innerHTML=pickSec('E/M level','em',state.em,false)+pickSec('CPT — procedures','cpt',state.cpt,true)+pickSec('ICD-10 — diagnoses','icd',state.icd,true) || '<div class="mlscs-empty">No matches.</div>';
    body.querySelectorAll('.mlscs-chk').forEach(function(ch){ ch.addEventListener('change', function(){ var id=ch.getAttribute('data-id'); if(ch.checked) picked[id]={kind:ch.getAttribute('data-kind'),code:ch.getAttribute('data-code')}; else delete picked[id]; updateTray(); }); });
    updateTray();
  }
  function selectedList(){
    var arr=[]; Object.keys(picked).forEach(function(id){ var p=picked[id]; var rec=(state[p.kind]||[]).find(function(x){ return String(x.code)===String(p.code); }); if(rec) arr.push({kind:p.kind,code:rec.code,desc:rec.desc}); });
    var rank={em:0,cpt:1,icd:2}; arr.sort(function(a,b){ return (rank[a.kind]-rank[b.kind]); });
    return arr;
  }
  function selectedBlock(){
    var arr=selectedList(); if(!arr.length) return '';
    var em=arr.filter(function(x){return x.kind==='em';}), cpt=arr.filter(function(x){return x.kind==='cpt';}), icd=arr.filter(function(x){return x.kind==='icd';});
    var lines=['BILLING CODES'];
    if(em.length) lines.push('E/M: '+em.map(function(x){return x.code;}).join(', '));
    if(cpt.length){ lines.push('CPT:'); cpt.forEach(function(x){ lines.push('  '+x.code+' — '+x.desc); }); }
    if(icd.length){ lines.push('ICD-10:'); icd.forEach(function(x){ lines.push('  '+x.code+' — '+x.desc); }); }
    return lines.join('\n');
  }
  function updateTray(){
    var t=document.getElementById('mlsCsPicked'); if(!t) return; var arr=selectedList();
    t.textContent=arr.length?(arr.length+' selected: '+arr.map(function(x){return x.code;}).join(', ')):'No codes selected.';
  }
  function insertIntoNote(){
    var block=selectedBlock(); if(!block){ toast('Select some codes first'); return; }
    var field=safe(function(){ return document.getElementById('noteText')||document.getElementById('clinicalNote')||document.querySelector('textarea[data-note-body], textarea.note, #visitNote'); }, null);
    if(field && ('value' in field)){
      var cur=field.value||''; field.value=cur+(cur && !/\n$/.test(cur)?'\n\n':'')+block+'\n';
      safe(function(){ field.dispatchEvent(new Event('input',{bubbles:true})); field.dispatchEvent(new Event('change',{bubbles:true})); });
      field.focus(); toast('Inserted into note'); close();
    } else { copyTxt(block); toast('No note field open — copied instead'); }
  }

  /* ============================ GUARDRAIL VIEW ============================ */
  function showValidation(text, ctx){
    var results=validate(text);
    var ov=shell('🛡️ Code check'+(ctx?' — '+esc(ctx):''));
    document.getElementById('mlsCsTop').innerHTML='';
    var body=document.getElementById('mlsCsBody');
    if(!results.length){ body.innerHTML='<div class="mlscs-empty">No ICD-10 or CPT codes found in the note to check.</div>'; document.getElementById('mlsCsFoot').innerHTML=''; return; }
    var bad=results.filter(function(r){return r.status!=='approved';}).length;
    var summary=bad? ('<div class="mlscs-sectitle" style="color:#9a6700">'+bad+' of '+results.length+' code(s) need a look — not on your approved sheet or retired.</div>')
                   : ('<div class="mlscs-sectitle" style="color:#1f7a45">All '+results.length+' codes match your approved sheet. ✓</div>');
    var rows=results.map(function(r){
      var cls=r.status==='approved'?'mlscs-vok':(r.status==='retired'?'mlscs-vret':'mlscs-vunk');
      var badge=r.status==='approved'?'Approved':(r.status==='retired'?'Retired':'Off-sheet');
      return '<div class="mlscs-vrow '+cls+'"><span class="mlscs-vdot"></span><span class="mlscs-vcode">'+esc(r.code)+'</span><span class="mlscs-vnote">'+esc(r.note)+'</span><span class="mlscs-badge">'+badge+'</span></div>';
    }).join('');
    body.innerHTML=summary+rows;
    document.getElementById('mlsCsFoot').innerHTML='<div class="mlscs-foot"><span class="mlscs-tray">Validation is advisory — the provider confirms all codes.</span><button type="button" class="mlscs-btn" id="mlsCsOpenMgr">Open code sheet</button></div>';
    var b=document.getElementById('mlsCsOpenMgr'); if(b) b.addEventListener('click', open);
  }

  window.__mlsCodeSheet={
    open:open, pick:pick, validate:validate, showValidation:showValidation,
    constrainOn:constrainOn, getState:function(){ return state; }, _seed:seed, _scan:scanCodes
  };
})();


/* ============================================================
   MLS — single-tooltip fix + dynamic extension-version badge
   Appended to mls-connect.js on 2026-06-15.

   FIX 1 (double tooltip): The MLS Assist browser extension's
   content.js injects its OWN custom hover tooltip element
   <div id="mls-tip"> on every page (reads data-tip, 2s delay).
   On the MLS web app that collides with the app's own
   <div id="mlsTip"> tooltip, so hovering a data-tip element
   (e.g. "Send full visit to Athena") renders TWO stacked boxes.
   The app's #mlsTip is the single source of truth (it works with
   OR without the extension and also handles native title), so we
   suppress the extension's duplicate ONLY on this app. The
   extension's tooltip still works on other pages (Athena, etc.)
   where this bundle is not loaded — the extension is untouched.

   FIX 2 (stale badge): the Settings "MLS Assist browser extension"
   card had a hardcoded "Latest: v1.25" badge. Read it live from
   /extension-version.json so it shows the deployed version (1.27
   now) and can never go stale again.
   ============================================================ */
(function(){
  'use strict';
  if (window.__mlsTipBadgeFix) return; window.__mlsTipBadgeFix = true;

  /* ---- FIX 1: hide the extension's duplicate #mls-tip on this app ---- */
  try {
    if (!document.getElementById('mlsHideExtTip')) {
      var st = document.createElement('style');
      st.id = 'mlsHideExtTip';
      // !important beats the extension's inline display:block (non-important),
      // so only the app's own #mlsTip tooltip ever shows.
      st.textContent = 'html body #mls-tip{display:none!important;opacity:0!important;}';
      (document.head || document.documentElement).appendChild(st);
    }
    var ex = document.getElementById('mls-tip');
    if (ex) ex.style.setProperty('display', 'none', 'important');
  } catch (e) { try { console.warn('[MLS] tooltip de-dup failed', e); } catch (_) {} }

  /* ---- FIX 2: dynamic extension-version badge in Settings ---- */
  try {
    var VER = null;
    function applyBadge(){
      if (!VER) return false;
      var spans = document.getElementsByTagName('span'), did = false, want = 'Latest: v' + VER;
      for (var i = 0; i < spans.length; i++) {
        var s = spans[i], t = (s.textContent || '').trim();
        if (!/^Latest:\s*v?\d/i.test(t)) continue;        // looks like a "Latest: vX.Y" badge
        var p = s, ok = false;                            // confirm it's the MLS Assist extension card
        for (var j = 0; j < 4 && p && p !== document.body && p !== document.documentElement; j++) {
          if (/MLS Assist browser extension/i.test(p.textContent || '')) { ok = true; break; }
          p = p.parentElement;
        }
        if (!ok) continue;
        if (s.textContent !== want) s.textContent = want;
        did = true;
      }
      return did;
    }
    function fetchVer(){
      return fetch('/extension-version.json?_=' + Date.now(), { cache: 'no-store' })
        .then(function(r){ return r.json(); })
        .then(function(j){ if (j && j.version) { VER = String(j.version).replace(/^v/i, ''); applyBadge(); } })
        .catch(function(){ /* offline: leave the static text as-is */ });
    }
    function start(){
      fetchVer();
      // The badge is in static markup inside the Settings modal; re-apply a few
      // times in case VER arrives before the node is ready, then stop.
      var tries = 0, iv = setInterval(function(){ tries++; if (applyBadge() || tries > 40) clearInterval(iv); }, 500);
      // Refresh periodically so a newly published version appears without a reload.
      setInterval(fetchVer, 5 * 60 * 1000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  } catch (e) { try { console.warn('[MLS] version badge failed', e); } catch (_) {} }
})();


/* ============================================================
   MLS-CONNECT — Feature: Lite (scribe-only) tier mode
   Pairs with the server-side liteGate (auth.js) which is the real, unbypassable
   enforcement. This module is the matching UX + the Owner admin control:
     • Doctor side: if the signed-in user is on the Lite plan, hide every non-Lite
       nav tab (keep Visit), redirect restricted views to Visit, show a "Lite" badge.
     • Admin side: inject a per-row "Lite" toggle into the Owner Users table (next to
       Premium), reading each row's existing adminSetPremium(id,..) to get the user id;
       calls POST /api/admin/users/:id/lite via the app's own authed adminFetch.
   Self-contained IIFE; every external call wrapped in try/catch; no-op on any error.
   ============================================================ */
(function(){
  'use strict';
  if (window.__mlsLiteMode) return; window.__mlsLiteMode = true;

  var RESTRICTED = ['calendar','patients','orders','recs','history','legalreq','team','analysis','studio'];
  var NAV_IDS = RESTRICTED.map(function(v){ return 'nav_' + v; });

  function getBk(){
    try { if (typeof bkUser !== 'undefined' && bkUser) return bkUser; } catch(e){}
    try { if (window.bkUser) return window.bkUser; } catch(e){}
    return null;
  }
  function isLiteUser(){
    var u = getBk();
    return !!(u && u.lite) && !(u && u.isAdmin);
  }

  function applyDoctorRestrictions(){
    if (!isLiteUser()) return;
    try {
      document.body.classList.add('mls-lite');
      NAV_IDS.forEach(function(id){ var el = document.getElementById(id); if (el) el.style.display = 'none'; });
      var v = document.getElementById('nav_visit'); if (v) v.style.display = '';
      try {
        var active = document.querySelector('.navtab.on');
        if (active && NAV_IDS.indexOf(active.id) !== -1 && typeof window.showView === 'function') window.showView('visit');
      } catch(e){}
      addBadge();
    } catch(e){}
  }

  function addBadge(){
    try {
      if (document.getElementById('mlsLiteBadge')) return;
      var b = document.createElement('span');
      b.id = 'mlsLiteBadge'; b.textContent = 'Lite';
      var tip = 'Lite plan: the scribe only. Coding, intake, scheduling, outcomes, legal and analytics are on Standard/Premium.';
      b.title = tip; b.setAttribute('data-tip', tip);
      b.style.cssText = 'display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:#0e7490;color:#fff;vertical-align:middle;letter-spacing:.02em;';
      var visit = document.getElementById('nav_visit');
      if (visit && visit.parentNode) visit.parentNode.appendChild(b);
      else (document.querySelector('.navtabs, nav, header') || document.body).appendChild(b);
    } catch(e){}
  }

  var _liteMap = null;
  function fetchLiteMap(cb){
    try {
      if (typeof window.adminFetch !== 'function') { cb && cb(); return; }
      window.adminFetch('/api/admin/users')
        .then(function(x){ return (x && typeof x.json === 'function') ? x.json() : x; })
        .then(function(rows){
          try { var arr = (rows && rows.users) ? rows.users : (Array.isArray(rows) ? rows : []); _liteMap = {}; arr.forEach(function(u){ if (u && u.id != null) _liteMap[String(u.id)] = (u.lite ? 1 : 0); }); } catch(e){}
          cb && cb();
        })
        .catch(function(){ cb && cb(); });
    } catch(e){ cb && cb(); }
  }

  function injectAdminToggles(){
    try {
      var premBtns = Array.prototype.slice.call(document.querySelectorAll('[onclick*="adminSetPremium("]'));
      if (!premBtns.length) return;
      premBtns.forEach(function(btn){
        try {
          if (btn.parentNode && btn.parentNode.querySelector('[data-mls-lite-btn]')) return;
          var oc = btn.getAttribute('onclick') || '';
          var m = oc.match(/adminSetPremium\(\s*['"]?([^'",\)]+)['"]?/);
          if (!m) return;
          var id = m[1];
          var liteOn = _liteMap ? !!_liteMap[String(id)] : false;
          var lb = document.createElement('button');
          lb.setAttribute('data-mls-lite-btn','1');
          lb.className = btn.className || 'btn-ghost';
          lb.style.cssText = btn.getAttribute('style') || '';
          lb.style.marginLeft = '4px';
          if (liteOn){ lb.style.background = '#0e7490'; lb.style.color = '#fff'; lb.style.borderColor = '#0e7490'; }
          lb.textContent = liteOn ? 'Lite ✓' : 'Lite';
          var tip = 'Lite plan (scribe only). Restricts this doctor to Lite-tier features. Enforced server-side.';
          lb.title = tip; lb.setAttribute('data-tip', tip);
          lb.onclick = function(ev){ try { ev.preventDefault(); ev.stopPropagation(); } catch(e){} setLite(id, !liteOn, lb); };
          btn.parentNode.insertBefore(lb, btn.nextSibling);
        } catch(e){}
      });
    } catch(e){}
  }

  function setLite(id, on, lb){
    try {
      if (typeof window.adminFetch !== 'function') return;
      if (lb) lb.disabled = true;
      window.adminFetch('/api/admin/users/' + id + '/lite', { method: 'POST', body: JSON.stringify({ lite: !!on }) })
        .then(function(){
          try { if (typeof window.toast === 'function') window.toast(on ? 'Lite plan ON — this doctor is now scribe-only.' : 'Lite plan OFF.', 'ok'); } catch(e){}
          _liteMap = null;
          if (typeof window.loadAdminUsers === 'function') { try { window.loadAdminUsers(); } catch(e){} }
        })
        .catch(function(e){
          try { if (typeof window.toast === 'function') window.toast('Could not update Lite: ' + (e && e.message || e), 'err'); } catch(_){}
          if (lb) lb.disabled = false;
        });
    } catch(e){}
  }

  function adminPass(){
    try {
      if (!document.querySelector('[onclick*="adminSetPremium("]')) return;
      if (!_liteMap) fetchLiteMap(injectAdminToggles);
      else injectAdminToggles();
    } catch(e){}
  }

  function tick(){ try { applyDoctorRestrictions(); adminPass(); } catch(e){} }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    tick();
    setInterval(tick, 1500);
  } catch(e){}

  window.__mlsLite = { isLiteUser: isLiteUser, apply: applyDoctorRestrictions, refreshAdmin: function(){ _liteMap = null; adminPass(); } };
})();


/* ---- module: feat_note_formatting.js ---- */

/* ===== MLS Note Formatting — provider-grade structured display =====
   Problem: every AI output (SOAP note, op/procedure note, insurance note,
   recommendations, decision-support, prior-auth, chart summary, IME report,
   data study) is shown as flat, uniform plain text. Line breaks survive, but
   there is NO visual hierarchy — section labels look identical to body text,
   so a correctly-sectioned note reads as one undifferentiated wall ("blob").

   Fix (display layer only — content is never altered):
   1. Editable note textareas (#noteBox SOAP/insurance, #procNoteBody op note)
      get a styled, read-only PREVIEW with bold section headers, spaced
      sections, and real bulleted/numbered lists, plus an Edit/Preview toggle.
      The textarea stays the single source of truth, so Copy-for-EMR, Sign,
      Save-to-history and Send-to-Athena keep using the exact plain text —
      the EMR copy is never touched.
   2. Read-only AI prose panels (.xbody: chart summary, decision support,
      denial/prior-auth, data study, IME, document summary) get their section
      headers bolded INLINE inside the existing pre-wrap container. Because the
      added markup is inline and the newlines stay literal, the element's
      textContent is byte-identical to before — every copy/print path that
      reads .textContent stays clean.

   Self-contained progressive enhancement: own IIFE, all external work guarded
   with try/catch, never modifies any existing app function, polls/observes
   passively, and degrades to a silent no-op on any error. Exposes
   window.__mlsFormat (with .enabled, .rerender(), .disable()). */
(function(){
  'use strict';
  if (window.__mlsFormat) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

  /* ---------- header / structure recognition ---------- */
  // Major section labels that stand alone on a line (SOAP, op-note blocks,
  // insurance-note blocks, coding sections). Compared case-insensitively with
  // any trailing ":" stripped.
  var MAJOR = {};
  ([
    'subjective','objective','assessment','plan','assessment and plan','assessment & plan','assessment/plan',
    'chief complaint','history of present illness','hpi','review of systems','ros',
    'past medical history','past surgical history','family history','social history',
    'medications','allergies','vitals','physical exam','physical examination','examination','exam',
    'imaging','laboratory','labs','results','diagnostics',
    'patient','date','date of procedure','date of service','date of birth',
    'preoperative diagnosis','pre-operative diagnosis','preprocedure diagnosis','pre-procedure diagnosis',
    'postoperative diagnosis','post-operative diagnosis','postprocedure diagnosis','post-procedure diagnosis',
    'procedure','procedure performed','procedures performed','operation','operation performed',
    'anesthesia','anesthesia type','indications','indication','indications for procedure',
    'description of procedure','description','technique','findings','complications',
    'estimated blood loss','specimens','implants','disposition','condition',
    'surgeon','assistant','attending','consent','fluoroscopy','fluoroscopy time',
    'medications administered','post-procedure plan','follow-up','followup','return precautions',
    'encounter type','medical necessity','chief complaint & medical necessity','history',
    'medical decision making','mdm','e/m level rationale','em level rationale','plan of care',
    'diagnoses','orders','reimbursement','coding','suggested coding','red flags',
    'differential diagnosis','differentials','recommendations','clinical note','insurance-ready encounter note'
  ]).forEach(function(k){ MAJOR[k]=true; });

  // Sub-labels that appear as "Label: content" on one line — bold just the label.
  var SUBLABEL = {};
  ([
    'chief complaint','cc','hpi','history of present illness','ros','review of systems',
    'pmh','past medical history','psh','past surgical history','fh','family history',
    'sh','social history','medications','meds','allergies','vitals','exam','physical exam',
    'physical examination','imaging','labs','laboratory','results','assessment','plan',
    'follow-up','followup','return precautions','disposition','indications','anesthesia',
    'findings','complications','estimated blood loss','ebl','specimens','condition','comment',
    'date of procedure','date of service','date of birth','mrn','procedure','diagnosis'
  ]).forEach(function(k){ SUBLABEL[k]=true; });

  function stripColon(s){ return s.replace(/\s*:\s*$/,''); }
  function isAllCaps(s){ return /[A-Z]/.test(s) && s === s.toUpperCase() && !/[a-z]/.test(s); }

  // Classify a single line. Returns {type, label, rest}.
  function classify(line){
    var t = line.replace(/\s+$/,'');           // keep leading indent, drop trailing ws
    var trimmed = t.trim();
    if (!trimmed) return { type:'blank' };
    // bullet
    var mb = trimmed.match(/^[-*•]\s+(.*)$/);
    if (mb) return { type:'bullet', rest: mb[1] };
    // numbered (1.  1)  )
    var mn = trimmed.match(/^(\d{1,3})[.)]\s+(.*)$/);
    if (mn) return { type:'num', num: mn[1], rest: mn[2] };
    // standalone header: whole line is a label (uppercase, or known major)
    var noColon = stripColon(trimmed);
    if (noColon.length <= 52 && (isAllCaps(noColon) || MAJOR[noColon.toLowerCase()]) && !/[.;]/.test(noColon)){
      // Make sure it is a label only (a "LABEL: value" with a value is a sublabel, handled below)
      if (!/:\s*\S/.test(trimmed) || MAJOR[noColon.toLowerCase()] || isAllCaps(noColon))
        return { type:'h', label: noColon };
    }
    // "Label: content" sub-label
    var ms = trimmed.match(/^([A-Za-z][A-Za-z/&()'.\- ]{1,40}?):\s+(\S.*)$/);
    if (ms){
      var lab = ms[1].trim();
      if (SUBLABEL[lab.toLowerCase()] || MAJOR[lab.toLowerCase()] || isAllCaps(lab))
        return { type:'sub', label: lab, rest: ms[2] };
    }
    return { type:'p', rest: t };
  }

  /* ---------- BLOCK renderer (rich, for read-only previews) ----------
     Used where copy/EMR reads a DIFFERENT source (the underlying textarea),
     so the preview can use full block structure (headers, <ul>, spacing). */
  function renderBlock(text){
    var lines = String(text==null?'':text).split('\n');
    var out = [], i = 0, listBuf = null, listType = null;
    function flush(){
      if (listBuf && listBuf.length){
        var tag = listType==='num' ? 'ol' : 'ul';
        out.push('<'+tag+' class="mlsf-list">'+listBuf.join('')+'</'+tag+'>');
      }
      listBuf = null; listType = null;
    }
    for (i=0;i<lines.length;i++){
      var c = classify(lines[i]);
      if (c.type==='bullet'){ if(listType&&listType!=='bullet') flush(); listType='bullet'; listBuf=listBuf||[]; listBuf.push('<li>'+esc(c.rest)+'</li>'); continue; }
      if (c.type==='num'){ if(listType&&listType!=='num') flush(); listType='num'; listBuf=listBuf||[]; listBuf.push('<li>'+esc(c.rest)+'</li>'); continue; }
      flush();
      if (c.type==='blank'){ continue; }
      if (c.type==='h'){ out.push('<div class="mlsf-h">'+esc(c.label)+'</div>'); continue; }
      if (c.type==='sub'){ out.push('<div class="mlsf-p"><span class="mlsf-sub">'+esc(c.label)+':</span> '+esc(c.rest)+'</div>'); continue; }
      out.push('<div class="mlsf-p">'+esc(c.rest)+'</div>');
    }
    flush();
    return out.join('');
  }

  /* ---------- INLINE renderer (for .xbody pre-wrap panels) ----------
     Bolds headers/sub-labels WITHOUT changing textContent: the markup added is
     inline, and every newline stays a literal '\n' text node, so
     el.textContent === the original text (copy/print stay byte-identical). */
  function renderInline(text){
    var lines = String(text==null?'':text).split('\n');
    var anyHeader = false;
    var html = lines.map(function(line){
      var c = classify(line);
      if (c.type==='h'){ anyHeader = true; return '<b class="mlsf-ih">'+esc(line)+'</b>'; }
      if (c.type==='sub'){
        anyHeader = true;
        // keep leading indentation + exact spacing; only wrap the "Label:" run
        var idx = line.indexOf(c.label);
        var pre = esc(line.slice(0, idx));
        return pre + '<b class="mlsf-ih">'+esc(c.label)+':</b>' + esc(line.slice(idx + c.label.length + 1));
      }
      return esc(line);
    }).join('\n');
    return { html: html, anyHeader: anyHeader };
  }

  /* ---------- styles ---------- */
  function injectCss(){
    if (document.getElementById('mlsfCss')) return;
    var st = document.createElement('style'); st.id='mlsfCss';
    st.textContent =
      '.mlsf-note{border:1px solid var(--line,#e2e8f0);border-radius:10px;background:var(--surface,#fff);'+
        'padding:14px 16px;font-size:14.5px;line-height:1.5;color:var(--text,#1f2937);max-height:60vh;overflow:auto;'+
        'font-family:inherit;-webkit-font-smoothing:antialiased}'+
      '.mlsf-note .mlsf-h{font-weight:800;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;'+
        'color:var(--accent,#2f5fd0);margin:14px 0 5px;padding-bottom:3px;border-bottom:1px solid var(--line,#e8edf5)}'+
      '.mlsf-note .mlsf-h:first-child{margin-top:0}'+
      '.mlsf-note .mlsf-p{margin:3px 0;white-space:pre-wrap}'+
      '.mlsf-note .mlsf-sub{font-weight:700;color:var(--text,#243042)}'+
      '.mlsf-note .mlsf-list{margin:4px 0 8px;padding-left:22px}'+
      '.mlsf-note .mlsf-list li{margin:2px 0;white-space:pre-wrap}'+
      '.mlsf-note ol.mlsf-list{list-style:decimal}'+
      '.mlsf-bar{display:flex;align-items:center;gap:8px;margin:0 0 8px}'+
      '.mlsf-toggle{font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid var(--line,#cdd7e6);'+
        'background:var(--surface,#fff);color:var(--accent,#2f5fd0);border-radius:7px;padding:5px 11px}'+
      '.mlsf-toggle:hover{background:#eef4ff}'+
      '.mlsf-hint{font-size:11.5px;color:var(--muted,#7a8699)}'+
      '.xbody .mlsf-ih{font-weight:800;color:var(--accent,#2f5fd0)}';
    (document.head||document.documentElement).appendChild(st);
  }

  /* ---------- editable-textarea preview (note + op note) ---------- */
  function attachPretty(ta, key){
    if (!ta || ta.__mlsf) return;
    ta.__mlsf = true;
    var pretty = document.createElement('div');
    pretty.className = 'mlsf-note';
    pretty.setAttribute('aria-label','Formatted note preview');
    var bar = document.createElement('div');
    bar.className = 'mlsf-bar';
    var btn = document.createElement('button');
    btn.type='button'; btn.className='mlsf-toggle'; btn.textContent='✏️ Edit';
    var hint = document.createElement('span'); hint.className='mlsf-hint';
    hint.textContent='Formatted view — copy/EMR output is unchanged';
    bar.appendChild(btn); bar.appendChild(hint);
    // insert bar + pretty right before the textarea
    ta.parentNode.insertBefore(bar, ta);
    ta.parentNode.insertBefore(pretty, ta);

    var state = { mode:'preview', last:null };
    function rerender(){
      var v = ta.value || '';
      if (v === state.last) return;
      state.last = v;
      try { pretty.innerHTML = renderBlock(v); } catch(e){ pretty.textContent = v; }
    }
    function showPreview(){
      state.mode='preview';
      rerender();
      // only take over the visual slot when the note actually has content
      var has = (ta.value||'').trim().length>0;
      pretty.style.display = has ? 'block' : 'none';
      bar.style.display = has ? 'flex' : 'none';
      if (has){ ta.dataset.mlsfHidden='1'; ta.style.display='none'; }
      btn.textContent='✏️ Edit';
    }
    function showEdit(){
      state.mode='edit';
      pretty.style.display='none';
      ta.style.display='block'; ta.dataset.mlsfHidden='';
      btn.textContent='👁 Preview';
      try{ ta.focus(); }catch(e){}
    }
    btn.addEventListener('click', function(){ if(state.mode==='preview') showEdit(); else showPreview(); });
    ta.addEventListener('input', function(){ if(state.mode==='preview') rerender(); });

    // poll for programmatic value changes (generate, format toggle, sign,
    // template apply) — the app sets .value directly, which fires no event.
    function tick(){
      try{
        if (!window.__mlsFormat || !window.__mlsFormat.enabled){ return; }
        var hasContent = (ta.value||'').trim().length>0;
        if (state.mode==='preview'){
          if (hasContent){
            // value may have changed programmatically (generate / format toggle /
            // sign / template apply) with no event — re-render and reclaim the slot
            rerender();
            pretty.style.display='block'; bar.style.display='flex';
            if (ta.style.display!=='none'){ ta.dataset.mlsfHidden='1'; ta.style.display='none'; }
          } else {
            pretty.style.display='none'; bar.style.display='none';
            if (ta.dataset.mlsfHidden==='1'){ ta.dataset.mlsfHidden=''; ta.style.display=''; }
          }
        }
      }catch(e){}
    }
    setInterval(tick, 700);
    // initial paint
    showPreview();
    return { rerender: showPreview };
  }

  /* ---------- read-only xbody panels ---------- */
  function decorateXbody(el){
    if (!el) return;
    try{
      var raw = el.textContent;
      if (raw == null) return;
      if (el.dataset.mlsfRaw === raw) return;       // already decorated this exact text
      if (!raw.trim() || raw.length < 8) return;     // skip empty / "Working…" states
      var r = renderInline(raw);
      if (!r.anyHeader) { el.dataset.mlsfRaw = raw; return; } // nothing to emphasize
      el.dataset.mlsfBusy = '1';
      el.innerHTML = r.html;
      el.dataset.mlsfRaw = el.textContent;           // store post-render textContent (== raw)
      el.dataset.mlsfBusy = '';
    }catch(e){}
  }
  function watchXbody(el){
    if (!el || el.__mlsfWatch) return;
    el.__mlsfWatch = true;
    decorateXbody(el);
    try{
      var mo = new MutationObserver(function(){
        if (el.dataset.mlsfBusy==='1') return;       // ignore our own writes
        decorateXbody(el);
      });
      mo.observe(el, { childList:true, characterData:true, subtree:true });
    }catch(e){}
  }

  /* ---------- wiring ---------- */
  var XBODY_IDS = ['chartSumBody','docAiBody','revToolsOut','dsOut','anaStudyOut','imeBody','surgPlanBody'];
  function wire(){
    if (!window.__mlsFormat || !window.__mlsFormat.enabled) return;
    injectCss();
    safe(function(){ attachPretty(document.getElementById('noteBox'), 'note'); });
    safe(function(){ attachPretty(document.getElementById('procNoteBody'), 'op'); });
    XBODY_IDS.forEach(function(id){ safe(function(){ watchXbody(document.getElementById(id)); }); });
    // also catch any future .xbody panels generically
    safe(function(){
      Array.prototype.forEach.call(document.querySelectorAll('.xbody'), function(el){ watchXbody(el); });
    });
  }

  window.__mlsFormat = {
    enabled: true,
    rerender: function(){ safe(wire); },
    disable: function(){ this.enabled=false; },
    _renderBlock: renderBlock,
    _renderInline: renderInline,
    _classify: classify
  };

  function boot(){ safe(wire); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  // re-wire periodically: textareas/panels may mount after login / view switch
  var n=0; var iv=setInterval(function(){ n++; if(n>40){ clearInterval(iv); return; } safe(wire); }, 1000);
})();


/* ---- module: feat_study.js ---- */

/* ===== MLS Study / Import Patients — cohort builder =====
   Build a STUDY cohort two ways:
     MODE A (by NAME + DOB list): paste rows (Name, DOB), drive Athena patient search per row
       via the app's existing Assist bridge (window._assistReadChart), VERIFY identity by a STRICT
       name+DOB gate (never import on a name-only match or a DOB mismatch), then import the patient +
       history through the app's existing pipeline (_savePatientChart) and tag them to the cohort.
     MODE B (by INJECTION / PROCEDURE) — the real, layered "grab patients from Athena by the shot
       they got" flow:
       1) FIND IN ATHENA: pick a CPT/procedure or type a shot/injection name (+ optional date range),
          read the open Athena REPORT/claims/procedure list via MLS Assist (mlsAppReadReport, v1.29;
          falls back to the schedule read on older builds), parse Name+DOB(+service date+CPT) rows,
          filter by the chosen criteria, then feed every selected row through the SAME strict name+DOB
          verify+import pipeline as Mode A and tag the cohort. Robust + configurable selectors
          (window.__mlsStudyConfig); needs tuning to the doctor's real Athena report layout.
       2) FROM PATIENTS ALREADY IN MLS, grouped by their note CPT (PROC_MAP/_ptProcedure) — works now.
       3) VIA athenahealth FHIR API: a clean, gated "all patients who got CPT X" query against the
          SMART-on-FHIR client (backend). It probes a capability endpoint and stays disabled (no fake
          data) until athenahealth API access is approved, then auto-enables.
   ADDITIVE + progressive enhancement: own IIFE, all external calls in try/catch, reads app globals at
   call time, never monkey-patches. Cohort membership rides on the patient object (p.studyTags[]/p.cohort)
   which already persists to localStorage and to the backend inside patient.data. READ/IMPORT ONLY — this
   module never writes to Athena and never clicks Save/Sign. No PHI is logged off-device. */
(function(){
  'use strict';
  if (window.__mlsStudy) return;

  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function toast(m){ safe(function(){ if(window.toast) window.toast(m,'info'); }); }
  function getPatients(){ return safe(function(){ return window.getPatients()||[]; }, []); }

  /* ---------- DOB / name normalization ---------- */
  function normDob(d){
    if(!d) return '';
    var s=String(d).trim();
    var m=s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/); // YYYY-MM-DD
    if(m){ return ('0'+m[2]).slice(-2)+('0'+m[3]).slice(-2)+m[1]; }
    m=s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/); // MM/DD/YYYY or MM/DD/YY
    if(!m) return '';
    var mm=('0'+m[1]).slice(-2), dd=('0'+m[2]).slice(-2), y=m[3];
    if(y.length===2){ var n=parseInt(y,10); y=(n>30?'19':'20')+y; } // pivot at 30
    return mm+dd+y;
  }
  function nameTokens(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9\s,]/g,' ').replace(/,/g,' ').split(/\s+/).filter(function(t){return t.length>1;}); }
  function tokenOverlap(a,b){ var A=nameTokens(a), B=nameTokens(b), n=0; A.forEach(function(t){ if(B.indexOf(t)>=0) n++; }); return n; }
  function rowTokensInText(name, text){
    var toks=nameTokens(name); if(!toks.length) return false; var t=String(text||'').toLowerCase(); var hit=0;
    toks.forEach(function(tk){ if(t.indexOf(tk)>=0) hit++; });
    return hit>=Math.min(2, toks.length); // need both first+last (or all, if single token)
  }
  function scanIdentity(text){
    var t=String(text||''); var dob='', name='';
    var dm=t.match(/(?:dob|d\.o\.b\.|date of birth|birth date)\s*[:\-]?\s*([01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{2,4})/i);
    if(dm) dob=dm[1];
    var nm=t.match(/(?:patient(?:\s*name)?|name)\s*[:\-]\s*([A-Za-z][A-Za-z'\-]+,\s*[A-Za-z][A-Za-z'\-]+)/);
    if(nm) name=nm[1];
    return {name:name, dob:dob};
  }

  /* ---------- parse pasted rows (Mode A) ---------- */
  function parseRows(text){
    return String(text||'').split(/\n/).map(function(line){
      var raw=line.trim(); if(!raw) return null;
      var dm=raw.match(/(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
      var dob=dm?dm[1]:'';
      var name=raw;
      if(dm){ name=raw.slice(0,dm.index)+raw.slice(dm.index+dm[0].length); }
      name=name.replace(/[,;|\t]+/g,' ').replace(/\s{2,}/g,' ').trim().replace(/[\-–—]\s*$/,'').trim();
      return { name:name, dob:dob, raw:raw, dobValid: !!normDob(dob) };
    }).filter(Boolean);
  }

  /* ---------- STRICT name+DOB match gate ----------
     'match' requires: a name hit AND a valid DOB on BOTH sides AND the DOBs equal.
     Never returns 'match' on a name-only basis, and never on a DOB mismatch. */
  function strictMatch(row, chart){
    if(!chart) return {status:'not_found'};
    if(chart.__err==='no-bridge'||chart.__err==='old-ext') return {status:'no_bridge'};
    if(chart.__err) return {status:'error'};
    var scan=scanIdentity(chart.text||'');
    var chartName=chart.name||chart.patient||scan.name||'';
    var chartDob=normDob(chart.dob||'')||normDob(scan.dob||'');
    var rowDob=normDob(row.dob||'');
    var cn=norm(chartName), pn=norm(row.name);
    var nameHit=false;
    if(cn && pn){ nameHit = (cn===pn) || cn.indexOf(pn)>=0 || pn.indexOf(cn)>=0 || tokenOverlap(chartName,row.name)>=2; }
    if(!nameHit && chart.text){ nameHit = rowTokensInText(row.name, chart.text); }
    var hasChart = !!(chartName || chartDob || (chart.text && chart.text.length>20));
    if(!hasChart) return {status:'not_found'};
    if(!nameHit && !chartDob) return {status:'not_found'};
    if(!rowDob) return {status:'review', reason:'no DOB provided in your list', chartName:chartName};
    if(!chartDob) return {status:'review', reason:'could not read a DOB from the Athena chart', chartName:chartName};
    if(chartDob!==rowDob) return {status:'dob_mismatch', chartName:chartName, chartDob:(chart.dob||scan.dob||'')};
    if(!nameHit) return {status:'review', reason:'DOB matched but the name did not — verify manually', chartName:chartName};
    return {status:'match', chartName:chartName};
  }

  /* ---------- read one chart via the app's Assist bridge ---------- */
  function readChartFor(name){
    return new Promise(function(resolve){
      var done=false; function fin(v){ if(!done){ done=true; resolve(v); } }
      var TIMEOUT=setTimeout(function(){ fin({__err:'error', __timeout:true}); }, 45000);
      safe(function(){
        if(typeof window._assistReadChart!=='function'){ clearTimeout(TIMEOUT); fin({__err:'no-bridge'}); return; }
        var p=window._assistReadChart(name);
        if(!p || typeof p.then!=='function'){ clearTimeout(TIMEOUT); fin({__err:'no-bridge'}); return; }
        p.then(function(rd){
          if(!rd || !rd.text){ clearTimeout(TIMEOUT); fin(null); return; }
          var parsed=null; try{ parsed=window._parsePatientChart?window._parsePatientChart(rd.text):null; }catch(e){}
          if(parsed && typeof parsed.then==='function'){
            parsed.then(function(c){ c=c||{}; c.text=rd.text; c.url=rd.url; clearTimeout(TIMEOUT); fin(c); })
                  .catch(function(){ clearTimeout(TIMEOUT); fin({name:'',dob:'',text:rd.text,url:rd.url}); });
          } else { var c=parsed||{}; c.text=rd.text; c.url=rd.url; clearTimeout(TIMEOUT); fin(c); }
        }).catch(function(e){ clearTimeout(TIMEOUT); fin({__err:(e&&e.message==='OLDEXT')?'old-ext':'error'}); });
      }) || (clearTimeout(TIMEOUT), fin({__err:'error'}));
    });
  }

  /* ---------- read the open Athena REPORT via MLS Assist (v1.29 mlsAppReadReport) ----------
     Falls back to the existing schedule read (window._assistReadAthenaTab) on older extensions,
     so "Find in Athena" still does something on v1.28 and reads reports properly on v1.29+. */
  function assistReadReport(onStatus){
    return new Promise(function(resolve,reject){
      var say=function(m){ try{ if(onStatus) onStatus(m); }catch(e){} };
      var ponged=false, tries=0, iv=null, got=false, settled=false;
      function fin(fn,v){ if(settled) return; settled=true; window.removeEventListener('message',onPong); window.removeEventListener('message',onResult); if(iv) clearInterval(iv); fn(v); }
      function onPong(e){ if(e.data&&e.data.source==='mls-ext'&&e.data.type==='mlsPong'&&!ponged){ ponged=true; if(iv) clearInterval(iv); proceed(); } }
      function onResult(e){
        if(!(e.data&&e.data.source==='mls-ext'&&e.data.type==='mlsAppReportResult')) return;
        got=true; var r=e.data.resp||{};
        if(!r.ok||!r.text){ fin(reject,new Error(r.error||'Couldn’t read your Athena report tab.')); return; }
        fin(resolve,{text:r.text||'',url:r.url||'',frames:r.frames,bestScore:r.bestScore});
      }
      window.addEventListener('message',onPong);
      var ping=function(){ try{ window.postMessage({source:'mls-app',type:'mlsPing'},'*'); }catch(e){} };
      say('Looking for MLS Assist…'); ping();
      iv=setInterval(function(){ tries++; if(ponged){ clearInterval(iv); return; } if(tries>8){ clearInterval(iv); fin(reject,new Error('NOEXT')); } else ping(); }, 350);
      function proceed(){
        say('Reading the open Athena report…');
        window.addEventListener('message',onResult);
        try{ window.postMessage({source:'mls-app',type:'mlsAppReadReport'},'*'); }catch(e){}
        setTimeout(function(){ if(!got) fin(reject,new Error('OLDEXT')); }, 30000);
      }
    });
  }
  function readReportText(onStatus){
    return assistReadReport(onStatus).catch(function(err){
      var msg=(err&&err.message)||'';
      if(msg==='OLDEXT' && typeof window._assistReadAthenaTab==='function'){
        if(onStatus) onStatus('Update MLS Assist to v1.29 for proper report reading — using the older read path for now…');
        return window._assistReadAthenaTab(onStatus);
      }
      if(msg==='NOEXT') throw new Error('MLS Assist isn’t responding. Install/enable it (latest version) and open your signed-in Athena report tab, then try again.');
      throw err;
    });
  }

  /* ====================== Procedure / CPT library + criteria ======================
     Common spine / pain / PM&R injections & procedures. Each entry: a stable key, a human
     label, the CPT/HCPCS codes that identify it, and free-text synonyms (so a typed shot name
     like "lumbar transforaminal ESI" also matches). Configurable/extendable via
     window.__mlsStudyConfig.extraProcedures (array of {k,label,codes,syn}). */
  var CPT_LIBRARY=[
    {k:'esi_il_lumbar',  label:'Epidural steroid injection — interlaminar, lumbar/sacral/caudal', codes:['62323','62322'], syn:['interlaminar','epidural steroid','esi','lumbar epidural','caudal epidural']},
    {k:'esi_il_cervical',label:'Epidural steroid injection — interlaminar, cervical/thoracic',     codes:['62321','62320'], syn:['interlaminar','cervical epidural','thoracic epidural','esi']},
    {k:'tfesi_lumbar',   label:'Transforaminal ESI — lumbar/sacral',                               codes:['64483','64484'], syn:['transforaminal','tfesi','nerve root block','selective nerve root','lumbar transforaminal']},
    {k:'tfesi_cervical', label:'Transforaminal ESI — cervical/thoracic',                           codes:['64479','64480'], syn:['transforaminal','tfesi','cervical transforaminal']},
    {k:'mbb_lumbar',     label:'Facet / medial branch block — lumbar/sacral',                      codes:['64493','64494','64495'], syn:['facet','medial branch','mbb','facet joint','paravertebral facet','facet block']},
    {k:'mbb_cervical',   label:'Facet / medial branch block — cervical/thoracic',                  codes:['64490','64491','64492'], syn:['facet','medial branch','mbb','cervical facet']},
    {k:'rfa_lumbar',     label:'Radiofrequency ablation — lumbar/sacral facet',                    codes:['64635','64636'], syn:['rfa','radiofrequency','ablation','neurotomy','denervation','rhizotomy']},
    {k:'rfa_cervical',   label:'Radiofrequency ablation — cervical/thoracic facet',                codes:['64633','64634'], syn:['rfa','radiofrequency','ablation','neurotomy','denervation']},
    {k:'si_joint',       label:'Sacroiliac (SI) joint injection',                                  codes:['27096','G0260'], syn:['sacroiliac','si joint','si injection']},
    {k:'si_rfa',         label:'Sacroiliac joint RFA',                                             codes:['64625'], syn:['sacroiliac rfa','si rfa','sacroiliac ablation']},
    {k:'tpi',            label:'Trigger point injection',                                          codes:['20552','20553'], syn:['trigger point','tpi']},
    {k:'major_joint',    label:'Major joint / bursa injection (knee, shoulder, hip)',              codes:['20610','20611'], syn:['joint injection','knee injection','shoulder injection','hip injection','bursa']},
    {k:'small_joint',    label:'Small / intermediate joint injection',                             codes:['20600','20604','20605','20606'], syn:['joint injection','finger injection','wrist injection']},
    {k:'genicular_block',label:'Genicular nerve block',                                            codes:['64454'], syn:['genicular','knee nerve block']},
    {k:'genicular_rfa',  label:'Genicular nerve RFA',                                              codes:['64624'], syn:['genicular rfa','genicular ablation']},
    {k:'stellate',       label:'Stellate ganglion block',                                          codes:['64510'], syn:['stellate','stellate ganglion']},
    {k:'lumbar_symp',    label:'Lumbar sympathetic block',                                         codes:['64520'], syn:['lumbar sympathetic']},
    {k:'celiac',         label:'Celiac plexus block',                                              codes:['64530'], syn:['celiac plexus']},
    {k:'occipital',      label:'Occipital nerve block',                                            codes:['64405'], syn:['occipital nerve','greater occipital']},
    {k:'scs_trial',      label:'Spinal cord stimulator trial',                                     codes:['63650'], syn:['spinal cord stimulator','scs trial','neurostimulator']},
    {k:'kypho',          label:'Kyphoplasty / vertebroplasty',                                     codes:['22513','22514','22515','22510','22511','22512'], syn:['kyphoplasty','vertebroplasty','vertebral augmentation']},
    {k:'blood_patch',    label:'Epidural blood patch',                                             codes:['62273'], syn:['blood patch']}
  ];
  function library(){
    var extra=safe(function(){ return (window.__mlsStudyConfig&&Array.isArray(window.__mlsStudyConfig.extraProcedures))?window.__mlsStudyConfig.extraProcedures:[]; }, [])||[];
    return CPT_LIBRARY.concat(extra.filter(function(g){ return g&&g.k&&g.codes; }));
  }
  /* Resolve UI inputs (a picked library key + free-text) into {codes,keywords,label}. */
  function resolveCriteria(selKey, freeText){
    var codes=[], keywords=[], labels=[], lib=library();
    if(selKey){ var g=lib.find(function(x){return x.k===selKey;}); if(g){ codes=codes.concat(g.codes); keywords=keywords.concat(g.syn); labels.push(g.label); } }
    var ft=String(freeText||'').trim();
    if(ft){
      var fc=ft.match(/\b\d{5}\b|\bG\d{4}\b/gi)||[];
      fc.forEach(function(c){ c=c.toUpperCase(); if(codes.indexOf(c)<0) codes.push(c); });
      var words=ft.replace(/\b\d{5}\b|\bG\d{4}\b/gi,' ').replace(/\s{2,}/g,' ').trim();
      if(words){
        keywords.push(words.toLowerCase());
        lib.forEach(function(g){ if((g.syn||[]).some(function(s){ return words.toLowerCase().indexOf(s)>=0; })){ g.codes.forEach(function(c){ if(codes.indexOf(c)<0) codes.push(c); }); } });
      }
      labels.push(ft);
    }
    keywords=keywords.filter(function(k,i){ return k && keywords.indexOf(k)===i; });
    codes=codes.filter(function(c,i){ return c && codes.indexOf(c)===i; });
    return { codes:codes, keywords:keywords, label:labels.join(' · ')||'all patients in the report' };
  }

  /* ====================== Report parsing (robust + configurable) ======================
     Best-effort screen-scrape of an Athena report/claims/procedure-list. Heuristic + tunable via
     window.__mlsStudyConfig: { nameStopWords:[], dobMinAge, dobMaxAge }. Returns rows
     {name, dob, svc, codes[], line}. Conservative — every row still passes the strict name+DOB gate
     on import, so a bad parse can never import the wrong patient. */
  function parseDateInput(v){ var m=String(v||'').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if(!m) return null; return new Date(+m[1],+m[2]-1,+m[3]); }
  function dobToDate(dob){ var n=normDob(dob); if(!n) return null; return new Date(parseInt(n.slice(4),10), parseInt(n.slice(0,2),10)-1, parseInt(n.slice(2,4),10)); }
  function classifyDates(arr){
    var yrNow=new Date().getFullYear();
    var parsed=arr.map(function(s){ var n=normDob(s); return {s:s, y:n?parseInt(n.slice(4),10):0}; }).filter(function(d){ return d.y>0 && d.y<=yrNow+1; });
    if(!parsed.length) return {dob:'', svc:''};
    if(parsed.length>=2){ parsed.sort(function(a,b){return a.y-b.y;}); return {dob:parsed[0].s, svc:parsed[parsed.length-1].s}; }
    var age=yrNow-parsed[0].y;
    return (age>=2) ? {dob:parsed[0].s, svc:''} : {dob:'', svc:parsed[0].s};
  }
  function detectName(raw, firstDateIdx){
    var stop=safe(function(){ return (window.__mlsStudyConfig&&window.__mlsStudyConfig.nameStopWords)||[]; }, [])||[];
    var base='date|patient|name|service|procedure|report|provider|rendering|claim|claims|total|page|print|account|insurance|primary|secondary|visit|encounter|status|balance|charge|payment|appointment|department|location|day|view|time|room|type|follow|est|dos|dob|mrn|dx|mod|code|codes|qty|amt|paid|due|age|sex|male|female|athena|athenanet|athenaone|list|detail|details|summary|export|count|diagnosis|results|filter|filtered|group|none|self|null|grand|subtotal';
    if(stop.length){ base+='|'+stop.map(function(w){return String(w).replace(/[^a-z0-9]/gi,'');}).filter(Boolean).join('|'); }
    var bad=new RegExp('^('+base+')$','i');
    var searchIn = (firstDateIdx!=null && firstDateIdx>3) ? raw.slice(0, firstDateIdx) : raw;
    // "Last, First [M]" — strongest signal
    var m=searchIn.match(/([A-Z][A-Za-z'’\-]+)\s*,\s*([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][a-z]?\.?)?)/);
    if(m) return (m[1]+', '+m[2]).replace(/\s{2,}/g,' ').trim();
    // "First Last" (two capitalized tokens not in the header vocabulary)
    var re=/\b([A-Z][A-Za-z'’\-]{1,})\s+([A-Z][A-Za-z'’\-]{1,})\b/g, mm;
    while((mm=re.exec(searchIn))){
      if(!bad.test(mm[1]) && !bad.test(mm[2])) return (mm[1]+' '+mm[2]).trim();
    }
    return '';
  }
  function parseReportRows(text){
    var dateRe=/\b([01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{2,4})\b/g;
    var lines=String(text||'').split(/\r?\n/);
    var rows=[];
    lines.forEach(function(line){
      var raw=line.replace(/\t/g,'  ').trim(); if(raw.length<4) return;
      var dates=[], dm; dateRe.lastIndex=0;
      while((dm=dateRe.exec(raw))){ dates.push({s:dm[1], idx:dm.index}); }
      var codes=(raw.match(/\b\d{5}\b|\bG\d{4}\b/g)||[]).map(function(c){return c.toUpperCase();});
      var name=detectName(raw, dates.length?dates[0].idx:null);
      if(!name) return;
      var cl=classifyDates(dates.map(function(d){return d.s;}));
      // A real procedure/claims/schedule row carries a DOB and/or a procedure code. Header/
      // title/total lines carry neither — drop them (a row with no DOB can't be verified anyway).
      if(!normDob(cl.dob) && !codes.length) return;
      rows.push({ name:name, dob:cl.dob, svc:cl.svc, codes:codes, line:raw });
    });
    // de-dup by name+dob, merging codes / filling svc/dob
    var seen={}, out=[];
    rows.forEach(function(r){
      var k=norm(r.name)+'|'+normDob(r.dob);
      if(seen[k]){ var ex=seen[k]; r.codes.forEach(function(c){ if(ex.codes.indexOf(c)<0) ex.codes.push(c); }); if(!ex.svc&&r.svc) ex.svc=r.svc; if(!ex.dob&&r.dob) ex.dob=r.dob; return; }
      seen[k]=r; out.push(r);
    });
    return out;
  }
  /* legacy export kept for back-compat (older briefing/tests referenced it) */
  function extractReportRows(text){
    return parseReportRows(text).map(function(r){ return { name:r.name, dob:r.dob }; }).filter(function(r){ return r.name && r.dob; });
  }
  function inRange(svc, from, to){
    if(!svc) return true; // can't exclude a row with no service date
    var d=dobToDate(svc); if(!d) return true;
    var f=parseDateInput(from); if(f && d<f) return false;
    var t=parseDateInput(to); if(t){ t.setHours(23,59,59,999); if(d>t) return false; }
    return true;
  }
  function filterReportRows(rows, crit){
    var codes=crit.codes||[], kw=(crit.keywords||[]).map(function(k){return String(k).toLowerCase();}).filter(Boolean);
    return rows.filter(function(r){
      var hit;
      if(!codes.length && !kw.length){ hit=true; }
      else {
        var codeHit = codes.length && r.codes.some(function(c){ return codes.indexOf(c)>=0; });
        var line=(r.line||'').toLowerCase();
        var kwHit = kw.length && kw.some(function(k){ return line.indexOf(k)>=0; });
        hit = codeHit || kwHit;
      }
      if(!hit) return false;
      return inRange(r.svc, crit.from, crit.to);
    });
  }

  /* ====================== gated SMART-on-FHIR cohort client ======================
     A reliable "all patients who received CPT X" query belongs to the SMART-on-FHIR client in the
     backend (integrations.js). This is the CLEAN app-side wiring, GATED behind a capability probe so
     it shows NOTHING until athenahealth API access is approved (no fake data). When the backend
     endpoint goes live it auto-enables.
     Backend contract (to be added by the backend task, NOT changed here):
       GET  /api/study/cohort-by-cpt/capability -> 200 { available:true, vendor, sandbox } when SMART
            is connected & approved; 404/501/403 otherwise.
       POST /api/study/cohort-by-cpt { cpt:[codes], dateFrom, dateTo } (auth: Bearer sf_bk_token)
            -> 200 { ok:true, patients:[ {name, dob, mrn, history?} ], cpt, count }  */
  function backendBase(){ return safe(function(){ return window.MLS_BACKEND || window.__mlsBackend || (window.MLS && window.MLS.backend) || 'https://scrivara-backend.onrender.com'; }, 'https://scrivara-backend.onrender.com'); }
  function authToken(){ return safe(function(){ return localStorage.getItem('sf_bk_token')||sessionStorage.getItem('sf_bk_token')||''; }, ''); }
  function apiFetch(path, opts){
    opts=opts||{}; var h=Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    var t=authToken(); if(t) h['Authorization']='Bearer '+t; opts.headers=h;
    return fetch(backendBase()+path, opts);
  }
  function studyFhirProbe(){
    return apiFetch('/api/study/cohort-by-cpt/capability', {method:'GET'})
      .then(function(r){ if(!r.ok) return {available:false, status:r.status}; return r.json().catch(function(){ return {available:false}; }); })
      .then(function(j){ return {available:!!(j&&j.available), info:j}; })
      .catch(function(){ return {available:false, error:'network'}; });
  }
  function fhirCohortByCpt(codes, from, to){
    return apiFetch('/api/study/cohort-by-cpt', {method:'POST', body:JSON.stringify({cpt:codes||[], dateFrom:from||'', dateTo:to||''})})
      .then(function(r){ if(!r.ok) return {ok:false, status:r.status}; return r.json().catch(function(){ return {ok:false}; }); })
      .catch(function(e){ return {ok:false, error:String(e&&e.message||e)}; });
  }

  /* ---------- cohort tagging on the patient object ---------- */
  function findByName(name){
    var n=norm(name); var ps=getPatients();
    return ps.find(function(p){ return norm(p.name)===n; })
        || ps.find(function(p){ var pn=norm(p.name); return pn && (pn.indexOf(n)>=0 || n.indexOf(pn)>=0); })
        || null;
  }
  function tagPatientCohort(p, cohort){
    if(!p||!cohort) return false;
    p.studyTags = Array.isArray(p.studyTags)?p.studyTags:[];
    if(p.studyTags.indexOf(cohort)<0) p.studyTags.push(cohort);
    p.cohort = cohort;
    return !!safe(function(){ window.upsertPatient(p); return true; }, false);
  }
  function listCohorts(){
    var map={}; getPatients().forEach(function(p){
      var tags=Array.isArray(p.studyTags)?p.studyTags:(p.cohort?[p.cohort]:[]);
      tags.forEach(function(t){ if(!t) return; map[t]=(map[t]||0)+1; });
    });
    return Object.keys(map).sort().map(function(k){ return {name:k, n:map[k]}; });
  }
  function cohortMembers(cohort){
    return getPatients().filter(function(p){
      var tags=Array.isArray(p.studyTags)?p.studyTags:(p.cohort?[p.cohort]:[]);
      return tags.indexOf(cohort)>=0;
    });
  }
  function visitCount(p){
    return safe(function(){ return (window.patientNotes?window.patientNotes(p.id):[]).length; }, 0);
  }

  /* ---------- import one row (shared by Mode A and Mode B) ----------
     resolver(name) -> Promise<chart|null|{__err}>; defaults to the Assist bridge.
     On a confident name+DOB match, imports via the app's existing _savePatientChart, then tags. */
  /* ---------- calendar linking (v1.31): pulled patients land on the MLS calendar ----------
     When an imported (strict-verified) patient carries a service/appointment date, build an
     appointment object and hand the batch to the app's OWN Athena-schedule importer
     (window._importPulledSchedule) - which upserts the patient, dedupes (via _apptKey), persists
     and reloads the calendar, so the patient shows up on the right day AND clicking the calendar
     entry opens that patient (consistent with the existing calendar launchpad). It does NOT touch
     calendar rendering/styling. Degrades to a no-op if the importer isn't present. */
  function svcToYMD(svc){
    var n=normDob(svc); if(!n) return ''; /* normDob -> MMDDYYYY */
    var mm=n.slice(0,2), dd=n.slice(2,4), yy=n.slice(4);
    if(yy.length!==4) return ''; return yy+'-'+mm+'-'+dd;
  }
  function buildApptForRow(row){
    if(!row) return null;
    var ymd=svcToYMD(row.svc||''); if(!ymd) return null;
    var reason = (row.codes&&row.codes.length) ? ('Procedure '+row.codes[0]) : 'Procedure (study import)';
    return { name:row.name, dob:row.dob||'', appt_date:ymd, date:ymd, start_at:ymd+'T00:00', time:'', reason:reason, source:'study-import' };
  }
  function addToCalendar(appts){
    appts=(appts||[]).filter(Boolean);
    if(!appts.length) return 0;
    safe(function(){
      if(typeof window._importPulledSchedule==='function'){
        Promise.resolve(window._importPulledSchedule(appts)).then(function(){
          safe(function(){ if(window.loadCalendar) window.loadCalendar(); else if(window.renderCalendar) window.renderCalendar(); });
        }).catch(function(){});
      }
    });
    return appts.length;
  }

  function importRow(row, cohort, resolver){
    resolver = resolver || readChartFor;
    return Promise.resolve(safe(function(){ return resolver(row.name); }, null)).then(function(chart){
      var r=strictMatch(row, chart);
      if(r.status==='match'){
        safe(function(){ if(window._savePatientChart) window._savePatientChart(row.name, null, chart||{}); });
        var p=findByName(row.name);
        if(!p){
          p = safe(function(){
            var np={ id:'p'+Date.now()+Math.random().toString(36).slice(2,7), name:row.name, dob:row.dob||'',
                     problems:'', meds:'', allergies:'', summary:'', docs:[], source:'study-import', created:Date.now(), updated:Date.now() };
            window.upsertPatient(np); return np;
          }, null);
        }
        if(p){ if(!p.dob && (row.dob||(chart&&chart.dob))) p.dob=row.dob||chart.dob; tagPatientCohort(p, cohort); }
        return { row:row, status:'match', chartName:r.chartName||row.name, patientId:p?p.id:null, appt:buildApptForRow(row) };
      }
      return { row:row, status:r.status, reason:r.reason, chartName:r.chartName, chartDob:r.chartDob };
    });
  }

  /* status -> display */
  var STAT={
    match:        {icon:'✓', cls:'ok',   label:'Found & imported'},
    dob_mismatch: {icon:'⚠', cls:'bad',  label:'DOB mismatch — skipped'},
    not_found:    {icon:'⚠', cls:'warn', label:'Not found in Athena'},
    review:       {icon:'⚠', cls:'warn', label:'Verify manually — multiple/ambiguous'},
    no_bridge:    {icon:'⚠', cls:'gate', label:'MLS Assist + signed-in Athena needed'},
    old_ext:      {icon:'⚠', cls:'gate', label:'Update MLS Assist extension'},
    error:        {icon:'⚠', cls:'warn', label:'Read error — retry'},
    pending:      {icon:'…', cls:'wait', label:'Searching Athena…'}
  };
  function statOf(s){ return STAT[s]||STAT.error; }

  /* shared sequential importer: rows[] -> verify+import each, updating per-row + summary nodes */
  function importSequential(rows, cohort, els, onDone){
    var counts={match:0,dob_mismatch:0,not_found:0,review:0,no_bridge:0,error:0,old_ext:0}, idx=0, appts=[];
    function step(){
      if(idx>=rows.length){
        if(els.sum) els.sum.innerHTML='Done. ✓ '+counts.match+' imported · ⚠ '+counts.dob_mismatch+' DOB mismatch · '+counts.not_found+' not found · '+counts.review+' to verify'+((counts.no_bridge+counts.old_ext)?(' · '+(counts.no_bridge+counts.old_ext)+' need Assist'):'');
        var calN=addToCalendar(appts);
        if(els.sum && calN) els.sum.innerHTML+=' · 📅 '+calN+' added to calendar';
        safe(function(){ if(window.renderPatients) window.renderPatients(); });
        if(onDone) onDone(counts);
        return;
      }
      var r=rows[idx];
      importRow(r, cohort).then(function(res){
        if(res.status==='match' && res.appt) appts.push(res.appt);
        var st=res.status==='old-ext'?'old_ext':res.status;
        counts[st]=(counts[st]||0)+1;
        var s=statOf(st), el=els.row(idx);
        if(el){
          var extra='';
          if(st==='dob_mismatch') extra=' (Athena: '+esc(res.chartDob||'?')+')';
          else if(st==='review'&&res.reason) extra=' ('+esc(res.reason)+')';
          var rs=el.querySelector('.mls-study-rs'); if(rs){ rs.className='mls-study-rs '+s.cls; rs.textContent=s.icon+' '+s.label+extra; }
        }
        if(els.sum) els.sum.textContent='Importing '+(idx+1)+' / '+rows.length+'…';
        idx++; setTimeout(step, 120);
      });
    }
    step();
  }

  /* ====================== UI ====================== */
  var TAB='A';
  function open(initTab){ TAB=initTab||'A'; injectCss(); render(); }
  function close(){ var o=document.getElementById('mlsStudyOv'); if(o) o.remove(); }

  function render(){
    var ex=document.getElementById('mlsStudyOv'); if(ex) ex.remove();
    var o=document.createElement('div'); o.id='mlsStudyOv';
    o.innerHTML=''
      +'<div class="mls-study-card" role="dialog" aria-label="Study / Import Patients">'
      +' <div class="mls-study-head">'
      +'   <span class="mls-study-title">🧪 Study / Import Patients</span>'
      +'   <button type="button" class="mls-study-x" aria-label="Close">✕</button>'
      +' </div>'
      +' <div class="mls-study-tabs">'
      +'   <button type="button" data-t="A" class="'+(TAB==='A'?'on':'')+'">By name + DOB</button>'
      +'   <button type="button" data-t="B" class="'+(TAB==='B'?'on':'')+'">By procedure</button>'
      +'   <button type="button" data-t="C" class="'+(TAB==='C'?'on':'')+'">Cohorts</button>'
      +' </div>'
      +' <div class="mls-study-body" id="mlsStudyBody"></div>'
      +'</div>';
    document.body.appendChild(o);
    o.addEventListener('mousedown', function(e){ if(e.target===o) close(); });
    o.querySelector('.mls-study-x').addEventListener('click', close);
    o.querySelectorAll('.mls-study-tabs [data-t]').forEach(function(b){
      b.addEventListener('click', function(){ TAB=b.getAttribute('data-t'); render(); });
    });
    var body=o.querySelector('#mlsStudyBody');
    if(TAB==='A') renderModeA(body);
    else if(TAB==='B') renderModeB(body);
    else renderCohorts(body);
  }

  /* ----- Mode A ----- */
  function renderModeA(body){
    body.innerHTML=''
      +'<p class="mls-study-help">Paste one patient per line as <b>Name, DOB</b> (e.g. <code>Jane Doe, 04/12/1968</code>). '
      +'For each, MLS searches your signed-in Athena tab, <b>verifies name + DOB</b>, and imports the patient + history into the cohort. '
      +'It never imports on a name-only match or a DOB mismatch, and never writes back to Athena.</p>'
      +'<label class="mls-study-lab">Cohort / study name</label>'
      +'<input id="mlsStudyCohort" class="mls-study-in" placeholder="e.g. ESI Outcomes 2026" />'
      +'<label class="mls-study-lab">Patients (one per line: Name, DOB)</label>'
      +'<textarea id="mlsStudyRows" class="mls-study-ta" rows="7" placeholder="Jane Doe, 04/12/1968&#10;John Smith 7/3/1955"></textarea>'
      +'<div class="mls-study-actions">'
      +'  <button type="button" id="mlsStudyParse" class="mls-study-btn ghost">Preview list</button>'
      +'  <button type="button" id="mlsStudyImport" class="mls-study-btn">Import &amp; verify</button>'
      +'</div>'
      +'<div id="mlsStudyResults" class="mls-study-results"></div>';
    body.querySelector('#mlsStudyParse').addEventListener('click', function(){ previewList(body); });
    body.querySelector('#mlsStudyImport').addEventListener('click', function(){ runImport(body); });
  }
  function previewList(body){
    var rows=parseRows(body.querySelector('#mlsStudyRows').value);
    var out=body.querySelector('#mlsStudyResults');
    if(!rows.length){ out.innerHTML='<div class="mls-study-empty">Nothing to preview — paste some rows above.</div>'; return; }
    out.innerHTML='<div class="mls-study-sum">'+rows.length+' row(s):</div>'+rows.map(function(r){
      var ok=r.name && r.dobValid;
      return '<div class="mls-study-row '+(ok?'':'warn')+'"><span class="mls-study-rn">'+esc(r.name||'(no name)')+'</span>'
        +'<span class="mls-study-rd">'+esc(r.dob||'(no DOB)')+(r.dobValid?'':' ⚠')+'</span></div>';
    }).join('');
  }
  function runImport(body){
    var cohort=(body.querySelector('#mlsStudyCohort').value||'').trim();
    var rows=parseRows(body.querySelector('#mlsStudyRows').value);
    var out=body.querySelector('#mlsStudyResults');
    if(!cohort){ out.innerHTML='<div class="mls-study-empty">Enter a cohort / study name first.</div>'; return; }
    if(!rows.length){ out.innerHTML='<div class="mls-study-empty">Paste at least one patient (Name, DOB).</div>'; return; }
    var bridge = safe(function(){ return typeof window._assistReadChart==='function'; }, false);
    var banner = bridge ? '' : '<div class="mls-study-gate">⚠ MLS Assist isn’t detected. Install/enable the extension and open your signed-in Athena tab, then import. Rows will report "Assist needed".</div>';
    out.innerHTML=banner+'<div class="mls-study-sum" id="mlsStudySumLine">Importing 0 / '+rows.length+'…</div>'
      +rows.map(function(r,i){ var s=statOf('pending'); return '<div class="mls-study-row" id="mlsr'+i+'"><span class="mls-study-rn">'+esc(r.name||'(no name)')+'</span><span class="mls-study-rd">'+esc(r.dob||'')+'</span><span class="mls-study-rs '+s.cls+'">'+s.icon+' '+s.label+'</span></div>'; }).join('');
    importSequential(rows, cohort, { sum: body.querySelector('#mlsStudySumLine'), row:function(i){ return body.querySelector('#mlsr'+i); } });
  }

  /* ----- Mode B ----- */
  function proceduresInMls(){
    var map={};
    getPatients().forEach(function(p){
      var proc=safe(function(){ return window._ptProcedure?window._ptProcedure(p):''; }, '');
      if(proc && proc!=='—' && proc.toLowerCase()!=='other'){ (map[proc]=map[proc]||[]).push(p); }
    });
    return map;
  }
  function renderModeB(body){
    var map=proceduresInMls();
    var keys=Object.keys(map).sort();
    var localHtml = keys.length
      ? '<div class="mls-study-proclist">'+keys.map(function(k){ return '<div class="mls-study-prow"><label><input type="checkbox" class="mls-study-pchk" value="'+esc(k)+'"> '+esc(k)+' <span class="mls-study-cnt">'+map[k].length+'</span></label></div>'; }).join('')+'</div>'
      : '<div class="mls-study-empty">No procedures detected on patients currently in MLS. (Procedures come from each patient’s most recent note CPT.)</div>';
    var procOpts='<option value="">— pick a procedure / shot —</option>'+library().map(function(g){ return '<option value="'+esc(g.k)+'">'+esc(g.label)+' ('+esc(g.codes.join(', '))+')</option>'; }).join('');
    body.innerHTML=''
      /* ---- Section 1: Find in Athena by procedure (the real grab) ---- */
      +'<div class="mls-study-sec">'
      +' <div class="mls-study-sech">Find patients in Athena by procedure <span class="mls-study-badge exp">needs live tuning</span></div>'
      +' <p class="mls-study-help">Grab everyone who got a given shot/injection. In Athena, open a report or list that shows the procedure (a <b>procedure/CPT claims report</b>, a billing/charge report, or a schedule filtered by procedure) for the date range you want. Then pick the procedure or type the shot name below and click <b>Find in Athena</b>. MLS reads that open report, extracts each patient’s name + DOB, and runs every one through the same strict name + DOB verify + import as the “By name + DOB” tab. Read-only — it never writes to Athena.</p>'
      +' <p class="mls-study-help"><b>🛰️ Search Athena with MLS Assist</b> goes further: MLS Assist <b>drives athenaOne itself</b> — it enters the CPT/procedure + date range into your procedure/claims/charge search, runs it, and <b>pages through every result</b>, harvesting each patient. Every patient still passes the same strict name + DOB verify + import. Needs one live tuning pass to your athenaOne search screen (see notes). <b>🔎 Find in Athena</b> instead reads a report you already ran.</p>'
      +' <label class="mls-study-lab">Procedure / shot</label>'
      +' <select id="mlsStudyBSel" class="mls-study-in">'+procOpts+'</select>'
      +' <label class="mls-study-lab">…or type a shot/injection name or CPT</label>'
      +' <input id="mlsStudyBProc" class="mls-study-in" placeholder="e.g. lumbar transforaminal ESI  ·  64483" />'
      +' <div class="mls-study-daterow">'
      +'   <div><label class="mls-study-lab">Service date from (optional)</label><input type="date" id="mlsStudyBFrom" class="mls-study-in" /></div>'
      +'   <div><label class="mls-study-lab">to</label><input type="date" id="mlsStudyBTo" class="mls-study-in" /></div>'
      +' </div>'
      +' <label class="mls-study-lab">Cohort / study name</label>'
      +' <input id="mlsStudyBFCohort" class="mls-study-in" placeholder="e.g. Lumbar TF-ESI 2026" />'
      +' <div class="mls-study-actions">'
      +'  <button type="button" id="mlsStudyBAuto" class="mls-study-btn">🛰️ Search Athena with MLS Assist</button>'
      +'  <button type="button" id="mlsStudyBFind" class="mls-study-btn ghost">🔎 Find in Athena (read open report)</button>'
      +' </div>'
      +' <div id="mlsStudyBFindOut" class="mls-study-results"></div>'
      +'</div>'
      /* ---- Section 2: From patients already in MLS (works now) ---- */
      +'<div class="mls-study-sec">'
      +' <div class="mls-study-sech">From patients already in MLS <span class="mls-study-badge live">works now</span></div>'
      +' <p class="mls-study-help">Build a cohort from patients you’ve already imported, grouped by their note CPT/procedure. Tick procedures and tag them to a cohort — no Athena round-trip.</p>'
      +' '+localHtml
      +' <label class="mls-study-lab">Cohort / study name</label>'
      +' <input id="mlsStudyBCohort" class="mls-study-in" placeholder="e.g. Lumbar ESI cohort" />'
      +' <div class="mls-study-actions"><button type="button" id="mlsStudyBTag" class="mls-study-btn">Add matching patients to cohort</button></div>'
      +' <div id="mlsStudyBOut" class="mls-study-results"></div>'
      +'</div>'
      /* ---- Section 3: Via athenahealth FHIR API (gated) ---- */
      +'<div class="mls-study-sec gated">'
      +' <div class="mls-study-sech">Via athenahealth API (exact procedure cohort) <span class="mls-study-badge gate" id="mlsStudyFhirBadge">checking…</span></div>'
      +' <p class="mls-study-help">A reliable “all patients who received CPT X” query runs through the SMART-on-FHIR integration — no screen-scraping. This is wired and ready; it stays disabled until athenahealth developer/partner API access is approved, then it turns on automatically. It shows no data until the API is live.</p>'
      +' <div class="mls-study-actions"><button type="button" id="mlsStudyFhirBtn" class="mls-study-btn ghost" disabled>Run exact FHIR cohort query (disabled until API access)</button></div>'
      +' <div id="mlsStudyFhirOut" class="mls-study-results"></div>'
      +'</div>';
    body.querySelector('#mlsStudyBAuto').addEventListener('click', function(){ doAutoSearchAthena(body); });
    body.querySelector('#mlsStudyBFind').addEventListener('click', function(){ doFindInAthena(body); });
    body.querySelector('#mlsStudyBTag').addEventListener('click', function(){ tagLocalProcedures(body, map); });
    wireFhirPanel(body);
  }

  /* ---------- Mode C: MLS Assist DRIVES the athenaOne search + paginates (v1.31) ----------
     Sends the chosen CPT/procedure + optional date range to the extension, which operates
     athenaOne's procedure/claims/charge search and pages through EVERY result page, returning
     all rows' text. The app then parses + filters + verifies+imports exactly like "Find in
     Athena" (same strict name+DOB gate). Read-only in athenaOne; never clicks Save/Sign.
     Selectors/labels are tunable via window.__mlsStudyConfig.search (passed to the extension). */
  function searchCfg(){ return safe(function(){ return (window.__mlsStudyConfig&&window.__mlsStudyConfig.search)||{}; }, {})||{}; }
  function assistSearchProcedure(params, cfg, onStatus){
    return new Promise(function(resolve,reject){
      var say=function(m){ try{ if(onStatus) onStatus(m); }catch(e){} };
      var ponged=false, tries=0, iv=null, settled=false, safetyTo=null;
      function fin(fn,v){ if(settled) return; settled=true; window.removeEventListener('message',onPong); window.removeEventListener('message',onEvt); if(iv) clearInterval(iv); if(safetyTo) clearTimeout(safetyTo); fn(v); }
      function onPong(e){ if(e.data&&e.data.source==='mls-ext'&&e.data.type==='mlsPong'&&!ponged){ ponged=true; if(iv) clearInterval(iv); proceed(); } }
      function onEvt(e){
        var d=e.data; if(!(d&&d.source==='mls-ext')) return;
        if(d.type==='mlsAppSearchProgress'){ say(d.msg||'Working...'); return; }
        if(d.type==='mlsAppSearchResult'){
          var r=d.resp||{};
          if(!r.ok){ var err=new Error(r.error||'Search failed.'); err.code=r.code||''; fin(reject,err); return; }
          fin(resolve,{text:r.text||'', pages:r.pages||0, ranControls:r.ranControls});
        }
      }
      window.addEventListener('message',onPong);
      var ping=function(){ try{ window.postMessage({source:'mls-app',type:'mlsPing'},'*'); }catch(e){} };
      say('Looking for MLS Assist...'); ping();
      iv=setInterval(function(){ tries++; if(ponged){ clearInterval(iv); return; } if(tries>8){ clearInterval(iv); fin(reject,new Error('MLS Assist is not responding. Install/enable it (latest version) and sign into athenaOne in another tab, then try again.')); } else ping(); }, 350);
      function proceed(){
        window.addEventListener('message',onEvt);
        say('Driving the athenaOne procedure search...');
        try{ window.postMessage({source:'mls-app',type:'mlsAppSearchProcedure',params:params,cfg:cfg},'*'); }catch(e){}
        safetyTo=setTimeout(function(){ fin(reject,new Error('Search timed out. Open the procedure/claims report manually and use Find in Athena, or tune selectors.')); }, 360000);
      }
    });
  }
  function doAutoSearchAthena(body){
    var out=body.querySelector('#mlsStudyBFindOut');
    var crit=resolveCriteria(body.querySelector('#mlsStudyBSel').value, body.querySelector('#mlsStudyBProc').value);
    crit.from=(body.querySelector('#mlsStudyBFrom').value||''); crit.to=(body.querySelector('#mlsStudyBTo').value||'');
    var procName=(body.querySelector('#mlsStudyBProc').value||'').trim();
    if(!procName){ var selKey=body.querySelector('#mlsStudyBSel').value; var g=library().find(function(x){return x.k===selKey;}); if(g){ procName=(g.syn&&g.syn[0])||g.label; } }
    var params={ cpt:crit.codes||[], procedureName:procName||'', dateFrom:crit.from||'', dateTo:crit.to||'' };
    if(!params.cpt.length && !params.procedureName){ out.innerHTML='<div class="mls-study-gate">Pick a procedure or type a CPT/shot name first.</div>'; return; }
    out.innerHTML='<div class="mls-study-sum" id="mlsStudyBStatus">Starting MLS Assist...</div>';
    var setS=function(m){ var n=body.querySelector('#mlsStudyBStatus'); if(n) n.textContent=m; };
    assistSearchProcedure(params, searchCfg(), setS).then(function(rd){
      var text=(rd&&rd.text)?rd.text:'';
      if(!text){ out.innerHTML='<div class="mls-study-gate">MLS Assist ran the search but read 0 rows'+(rd&&rd.pages?(' across '+rd.pages+' page(s)'):'')+'. The results table likely needs selector tuning to your athenaOne layout (set <code>window.__mlsStudyConfig.search</code>), or run the report yourself and use the read-only Find in Athena.</div>'; return; }
      var all=parseReportRows(text);
      var rows=filterReportRows(all, crit);
      renderCandidates(body, rows, all.length, crit, {bestScore:null, pages:(rd&&rd.pages)||0});
    }).catch(function(err){
      out.innerHTML='<div class="mls-study-gate">&#9888; '+esc((err&&err.message)||'Search failed.')+'</div>';
    });
  }

  /* ---- Section 1 logic: read Athena report -> parse -> filter -> review -> verify+import ---- */
  function doFindInAthena(body){
    var out=body.querySelector('#mlsStudyBFindOut');
    var crit=resolveCriteria(body.querySelector('#mlsStudyBSel').value, body.querySelector('#mlsStudyBProc').value);
    crit.from=(body.querySelector('#mlsStudyBFrom').value||''); crit.to=(body.querySelector('#mlsStudyBTo').value||'');
    out.innerHTML='<div class="mls-study-sum" id="mlsStudyBStatus">Looking for MLS Assist…</div>';
    var setS=function(m){ var n=body.querySelector('#mlsStudyBStatus'); if(n) n.textContent=m; };
    readReportText(setS).then(function(rd){
      var text=(rd&&rd.text)?rd.text:'';
      if(!text){ out.innerHTML='<div class="mls-study-gate">Couldn’t read an Athena report. Open the procedure/claims report (or a filtered schedule) as your signed-in Athena tab, then try again.</div>'; return; }
      var all=parseReportRows(text);
      var rows=filterReportRows(all, crit);
      renderCandidates(body, rows, all.length, crit, rd);
    }).catch(function(err){
      out.innerHTML='<div class="mls-study-gate">⚠ '+esc((err&&err.message)||'Couldn’t read the Athena tab.')+'</div>';
    });
  }
  function renderCandidates(body, rows, totalParsed, crit, rd){
    var out=body.querySelector('#mlsStudyBFindOut');
    if(!rows.length){
      out.innerHTML='<div class="mls-study-gate">Read the report ('+esc(String(totalParsed))+' patient row(s) parsed'+(rd&&rd.bestScore!=null?(', match score '+esc(String(rd.bestScore))):'')+') but none matched <b>'+esc(crit.label)+'</b>'+((crit.from||crit.to)?' in that date range':'')+'.<br>Tips: make sure the report shows the procedure/CPT column; widen or clear the date range; or open the report so the patient rows are visible. This scrape is conservative and may need tuning to your report’s layout (set <code>window.__mlsStudyConfig</code>).</div>';
      return;
    }
    var withDob=rows.filter(function(r){ return normDob(r.dob); }).length;
    out.innerHTML='<div class="mls-study-sum">Found <b>'+rows.length+'</b> patient(s) matching '+esc(crit.label)+' — '+withDob+' with a readable DOB. Review, then verify + import:</div>'
      +'<div class="mls-study-checkall"><label><input type="checkbox" id="mlsStudyBAll" checked> Select all</label></div>'
      +'<div class="mls-study-candlist">'+rows.map(function(r,i){
          var d=normDob(r.dob); var cpt=r.codes.length?(' · '+esc(r.codes.join(', '))):''; var sv=r.svc?(' · DOS '+esc(r.svc)):'';
          return '<label class="mls-study-cand"><input type="checkbox" class="mls-study-cchk" data-i="'+i+'"'+(d?' checked':'')+(d?'':' disabled')+'>'
            +'<span class="mls-study-rn">'+esc(r.name)+'</span>'
            +'<span class="mls-study-rd">'+esc(r.dob||'(no DOB — can’t verify)')+'</span>'
            +'<span class="mls-study-cnt">'+(cpt||sv?(esc(((r.codes[0]||'')+ (r.svc?(' '+r.svc):'')).trim())):'')+'</span></label>';
        }).join('')+'</div>'
      +'<div class="mls-study-help">Only rows with a readable DOB can be verified+imported (the strict name+DOB gate needs both). Review the list — every selected patient is re-verified against their Athena chart on import, so a wrong row can’t import the wrong patient.</div>'
      +'<label class="mls-study-lab">Cohort / study name</label>'
      +'<input id="mlsStudyBFCohort2" class="mls-study-in" value="'+esc((body.querySelector('#mlsStudyBFCohort').value||crit.label||'').slice(0,80))+'" placeholder="cohort name" />'
      +'<div class="mls-study-actions"><button type="button" id="mlsStudyBImport" class="mls-study-btn">✓ Verify &amp; import selected</button></div>'
      +'<div class="mls-study-sum" id="mlsStudyBImpSum"></div>'
      +'<div id="mlsStudyBImpRows"></div>';
    var all=out.querySelector('#mlsStudyBAll');
    if(all) all.addEventListener('change', function(){ out.querySelectorAll('.mls-study-cchk').forEach(function(c){ if(!c.disabled) c.checked=all.checked; }); });
    out.querySelector('#mlsStudyBImport').addEventListener('click', function(){ importCandidates(body, rows, out); });
  }
  function importCandidates(body, rows, out){
    var cohort=(out.querySelector('#mlsStudyBFCohort2').value||'').trim();
    if(!cohort){ out.querySelector('#mlsStudyBImpSum').innerHTML='<span class="mls-study-gatetext">Enter a cohort name first.</span>'; return; }
    var picked=[]; out.querySelectorAll('.mls-study-cchk').forEach(function(c){ if(c.checked && !c.disabled){ picked.push(rows[parseInt(c.getAttribute('data-i'),10)]); } });
    if(!picked.length){ out.querySelector('#mlsStudyBImpSum').innerHTML='<span class="mls-study-gatetext">Tick at least one patient with a DOB.</span>'; return; }
    var rowsBox=out.querySelector('#mlsStudyBImpRows');
    rowsBox.innerHTML=picked.map(function(r,i){ var s=statOf('pending'); return '<div class="mls-study-row" id="mlsbc'+i+'"><span class="mls-study-rn">'+esc(r.name)+'</span><span class="mls-study-rd">'+esc(r.dob||'')+'</span><span class="mls-study-rs '+s.cls+'">'+s.icon+' '+s.label+'</span></div>'; }).join('');
    importSequential(picked, cohort, { sum: out.querySelector('#mlsStudyBImpSum'), row:function(i){ return out.querySelector('#mlsbc'+i); } });
  }

  function tagLocalProcedures(body, map){
    var cohort=(body.querySelector('#mlsStudyBCohort').value||'').trim();
    var out=body.querySelector('#mlsStudyBOut');
    if(!cohort){ out.innerHTML='<div class="mls-study-empty">Enter a cohort name first.</div>'; return; }
    var picked=Array.prototype.map.call(body.querySelectorAll('.mls-study-pchk:checked'), function(c){ return c.value; });
    if(!picked.length){ out.innerHTML='<div class="mls-study-empty">Tick at least one procedure.</div>'; return; }
    var n=0; picked.forEach(function(k){ (map[k]||[]).forEach(function(p){ if(tagPatientCohort(p, cohort)) n++; }); });
    out.innerHTML='<div class="mls-study-sum">✓ Added '+n+' patient(s) to cohort “'+esc(cohort)+'”.</div>';
    safe(function(){ if(window.renderPatients) window.renderPatients(); });
  }

  /* ---- Section 3 logic: probe + (when enabled) run the FHIR cohort query ---- */
  function wireFhirPanel(body){
    var badge=body.querySelector('#mlsStudyFhirBadge'), btn=body.querySelector('#mlsStudyFhirBtn'), out=body.querySelector('#mlsStudyFhirOut');
    if(!badge||!btn) return;
    studyFhirProbe().then(function(p){
      if(p.available){
        badge.textContent='API connected'; badge.className='mls-study-badge live';
        btn.disabled=false; btn.textContent='Run exact FHIR cohort query';
        btn.addEventListener('click', function(){ runFhirCohort(body); });
      } else {
        badge.textContent='gated'; badge.className='mls-study-badge gate';
        btn.disabled=true; btn.textContent='Run exact FHIR cohort query (disabled until API access)';
      }
    });
  }
  function runFhirCohort(body){
    var out=body.querySelector('#mlsStudyFhirOut');
    var crit=resolveCriteria(body.querySelector('#mlsStudyBSel').value, body.querySelector('#mlsStudyBProc').value);
    if(!crit.codes.length){ out.innerHTML='<div class="mls-study-gate">Pick a procedure or enter a CPT code first (the FHIR query needs a CPT/HCPCS code).</div>'; return; }
    var cohort=(body.querySelector('#mlsStudyBFCohort').value||crit.label||'').trim();
    out.innerHTML='<div class="mls-study-sum">Querying athenahealth FHIR for CPT '+esc(crit.codes.join(', '))+'…</div>';
    fhirCohortByCpt(crit.codes, body.querySelector('#mlsStudyBFrom').value, body.querySelector('#mlsStudyBTo').value).then(function(res){
      if(!res||!res.ok||!Array.isArray(res.patients)){ out.innerHTML='<div class="mls-study-gate">The FHIR query didn’t return a cohort'+(res&&res.status?(' (HTTP '+esc(String(res.status))+')'):'')+'. The API may not be approved yet.</div>'; return; }
      var rows=res.patients.map(function(p){ return { name:p.name||'', dob:p.dob||'', raw:'', dobValid:!!normDob(p.dob) }; }).filter(function(r){ return r.name; });
      out.innerHTML='<div class="mls-study-sum">FHIR returned '+rows.length+' patient(s) for CPT '+esc(crit.codes.join(', '))+'. Verifying + importing into “'+esc(cohort)+'”…</div>'
        +rows.map(function(r,i){ var s=statOf('pending'); return '<div class="mls-study-row" id="mlsfc'+i+'"><span class="mls-study-rn">'+esc(r.name)+'</span><span class="mls-study-rd">'+esc(r.dob||'')+'</span><span class="mls-study-rs '+s.cls+'">'+s.icon+' '+s.label+'</span></div>'; }).join('')
        +'<div class="mls-study-sum" id="mlsStudyFhirSum"></div>';
      importSequential(rows, cohort||'FHIR cohort', { sum: out.querySelector('#mlsStudyFhirSum'), row:function(i){ return out.querySelector('#mlsfc'+i); } });
    });
  }

  /* ----- Cohorts view ----- */
  function renderCohorts(body){
    var cohorts=listCohorts();
    if(!cohorts.length){ body.innerHTML='<div class="mls-study-empty">No cohorts yet. Use “By name + DOB” or “By procedure” to build one.</div>'; return; }
    body.innerHTML='<div class="mls-study-cohlist">'+cohorts.map(function(c){
      return '<button type="button" class="mls-study-coh" data-c="'+esc(c.name)+'"><span>'+esc(c.name)+'</span><span class="mls-study-cnt">'+c.n+'</span></button>';
    }).join('')+'</div><div id="mlsStudyCohDetail"></div>';
    body.querySelectorAll('.mls-study-coh').forEach(function(b){
      b.addEventListener('click', function(){ showCohort(body, b.getAttribute('data-c')); });
    });
  }
  function showCohort(body, cohort){
    var det=body.querySelector('#mlsStudyCohDetail'); if(!det) return;
    var mem=cohortMembers(cohort);
    det.innerHTML='<div class="mls-study-sum">'+esc(cohort)+' — '+mem.length+' patient(s)</div>'
      +'<div class="mls-study-export"><button type="button" class="mls-study-btn ghost" id="mlsStudyCsv">Export de-identified summary (CSV)</button></div>'
      +'<div class="mls-study-memlist">'+mem.map(function(p){
        return '<div class="mls-study-row"><span class="mls-study-rn">'+esc(p.name||'(unnamed)')+'</span>'
          +'<span class="mls-study-rd">'+esc(p.dob||'')+'</span>'
          +'<span class="mls-study-cnt">'+visitCount(p)+' visit(s)</span>'
          +'<button type="button" class="mls-study-open" data-id="'+esc(p.id)+'">Open chart</button></div>';
      }).join('')+'</div>';
    det.querySelectorAll('.mls-study-open').forEach(function(b){
      b.addEventListener('click', function(){
        var id=b.getAttribute('data-id');
        safe(function(){ if(window.setActivePtId) window.setActivePtId(id); });
        safe(function(){ if(window.openPatient) window.openPatient(id); });
        safe(function(){ if(window.showView) window.showView('patients'); });
        close();
      });
    });
    var csv=det.querySelector('#mlsStudyCsv'); if(csv) csv.addEventListener('click', function(){ exportCohortCsv(cohort, mem); });
  }
  function exportCohortCsv(cohort, mem){
    // De-identified: cohort, a sequential study id, age (from DOB year), sex, visit count. No name/DOB/MRN.
    var yr=new Date().getFullYear();
    var lines=['cohort,study_id,age,sex,visits'];
    mem.forEach(function(p,i){
      var age=''; var dm=normDob(p.dob||''); if(dm){ age=String(yr-parseInt(dm.slice(4),10)); }
      lines.push([cohort, 'S'+(i+1), age, (p.sex||''), visitCount(p)].map(function(x){return '"'+String(x).replace(/"/g,'""')+'"';}).join(','));
    });
    safe(function(){
      var blob=new Blob([lines.join('\n')],{type:'text/csv'});
      var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='MLS_cohort_'+cohort.replace(/[^a-z0-9]+/gi,'_')+'_deidentified.csv';
      document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
  }

  /* ---------- launch button in the Patients toolbar ---------- */
  function injectLaunch(){
    safe(function(){
      if(document.getElementById('mlsStudyLaunch')) return;
      var anchor=document.getElementById('ptPullAthenaBtn'); if(!anchor||!anchor.parentElement) return;
      var b=document.createElement('button'); b.type='button'; b.id='mlsStudyLaunch';
      b.className=anchor.className; b.textContent='🧪 Study / Import';
      b.addEventListener('click', function(){ open('A'); });
      anchor.parentElement.insertBefore(b, anchor.nextSibling);
    });
  }

  /* ---------- timeline provider (cohort membership shows on a patient's timeline) ---------- */
  function wireTimeline(){
    safe(function(){
      if(window.__mlsTimeline && window.__mlsTimeline.addProvider){
        window.__mlsTimeline.addProvider(function(pid){
          var p=safe(function(){ return window.findPatient?window.findPatient(pid):null; }, null);
          if(!p) return [];
          var tags=Array.isArray(p.studyTags)?p.studyTags:(p.cohort?[p.cohort]:[]);
          return tags.map(function(t){ return { date:p.updated||Date.now(), type:'study', icon:'🧪', title:'In study cohort: '+t, sub:'', onClick:function(){ open('C'); } }; });
        });
      }
    });
  }

  function injectCss(){
    if(document.getElementById('mlsStudyCss')) return;
    var s=document.createElement('style'); s.id='mlsStudyCss';
    s.textContent=''
      +'#mlsStudyOv{position:fixed;inset:0;z-index:100002;background:rgba(15,28,46,.42);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto;}'
      +'#mlsStudyOv .mls-study-card{background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.3);width:640px;max-width:100%;font-size:13px;color:var(--ink,#15293f);}'
      +'#mlsStudyOv .mls-study-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'#mlsStudyOv .mls-study-title{font-weight:700;font-size:15px;}'
      +'#mlsStudyOv .mls-study-x{border:0;background:transparent;cursor:pointer;color:var(--muted,#9aa7b4);font-size:16px;}'
      +'#mlsStudyOv .mls-study-tabs{display:flex;gap:4px;padding:10px 12px 0;}'
      +'#mlsStudyOv .mls-study-tabs button{flex:1;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fafcff);color:var(--muted,#5b6b7c);border-radius:9px 9px 0 0;padding:8px;}'
      +'#mlsStudyOv .mls-study-tabs button.on{background:var(--card,#fff);color:var(--brand,#2563c9);border-bottom-color:transparent;}'
      +'#mlsStudyOv .mls-study-body{padding:14px 16px;max-height:70vh;overflow:auto;}'
      +'#mlsStudyOv .mls-study-help{color:var(--muted,#5b6b7c);font-size:12px;line-height:1.5;margin:0 0 10px;}'
      +'#mlsStudyOv code{background:var(--surface,#f1f5fb);padding:1px 5px;border-radius:5px;font-size:11.5px;}'
      +'#mlsStudyOv .mls-study-lab{display:block;font-weight:600;font-size:11.5px;margin:8px 0 4px;color:var(--ink,#15293f);}'
      +'#mlsStudyOv .mls-study-in,#mlsStudyOv .mls-study-ta{width:100%;box-sizing:border-box;font:inherit;border:1px solid var(--line,#e6e9ef);border-radius:9px;padding:8px 10px;background:var(--surface,#fafcff);color:var(--ink,#15293f);}'
      +'#mlsStudyOv select.mls-study-in{cursor:pointer;}'
      +'#mlsStudyOv .mls-study-ta{resize:vertical;}'
      +'#mlsStudyOv .mls-study-daterow{display:flex;gap:10px;}'
      +'#mlsStudyOv .mls-study-daterow>div{flex:1;}'
      +'#mlsStudyOv .mls-study-actions{display:flex;gap:8px;margin:10px 0;}'
      +'#mlsStudyOv .mls-study-btn{font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--brand,#2563c9);background:var(--brand,#2563c9);color:#fff;border-radius:9px;padding:8px 14px;}'
      +'#mlsStudyOv .mls-study-btn.ghost{background:var(--surface,#fafcff);color:var(--brand,#2563c9);}'
      +'#mlsStudyOv .mls-study-btn:disabled{opacity:.5;cursor:not-allowed;}'
      +'#mlsStudyOv .mls-study-results{margin-top:8px;}'
      +'#mlsStudyOv .mls-study-sum{font-weight:600;margin:6px 0;}'
      +'#mlsStudyOv .mls-study-gatetext{color:#b45309;font-weight:600;}'
      +'#mlsStudyOv .mls-study-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid var(--line,#eef1f6);border-radius:8px;margin-bottom:5px;background:var(--surface,#fcfdff);}'
      +'#mlsStudyOv .mls-study-row.warn{border-color:#f0c98a;}'
      +'#mlsStudyOv .mls-study-rn{flex:1;font-weight:600;}'
      +'#mlsStudyOv .mls-study-rd{color:var(--muted,#5b6b7c);font-size:12px;min-width:84px;}'
      +'#mlsStudyOv .mls-study-rs{font-size:11.5px;font-weight:600;}'
      +'#mlsStudyOv .mls-study-rs.ok{color:#16a34a;} #mlsStudyOv .mls-study-rs.bad{color:#dc2626;} #mlsStudyOv .mls-study-rs.warn{color:#b45309;} #mlsStudyOv .mls-study-rs.gate{color:#7c5cff;} #mlsStudyOv .mls-study-rs.wait{color:var(--muted,#9aa7b4);}'
      +'#mlsStudyOv .mls-study-empty{color:var(--muted,#9aa7b4);padding:14px;text-align:center;}'
      +'#mlsStudyOv .mls-study-gate{background:#fff7ec;border:1px solid #f0c98a;color:#7a4f12;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:12px;line-height:1.5;}'
      +'#mlsStudyOv .mls-study-sec{border:1px solid var(--line,#eef1f6);border-radius:11px;padding:11px 12px;margin-bottom:12px;}'
      +'#mlsStudyOv .mls-study-sec.gated{opacity:.92;}'
      +'#mlsStudyOv .mls-study-sech{font-weight:700;font-size:13px;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
      +'#mlsStudyOv .mls-study-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;}'
      +'#mlsStudyOv .mls-study-badge.live{background:#e7f7ee;color:#16794a;} #mlsStudyOv .mls-study-badge.exp{background:#fff2e0;color:#9a5a12;} #mlsStudyOv .mls-study-badge.gate{background:#efeaff;color:#5b40c9;}'
      +'#mlsStudyOv .mls-study-proclist{margin:6px 0;}'
      +'#mlsStudyOv .mls-study-prow label{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;}'
      +'#mlsStudyOv .mls-study-cnt{color:var(--muted,#5b6b7c);font-size:11.5px;background:var(--surface,#f1f5fb);border-radius:999px;padding:1px 8px;}'
      +'#mlsStudyOv .mls-study-checkall{margin:6px 0;font-size:12px;}'
      +'#mlsStudyOv .mls-study-checkall label{display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;}'
      +'#mlsStudyOv .mls-study-candlist{max-height:230px;overflow:auto;margin:4px 0 8px;}'
      +'#mlsStudyOv .mls-study-cand{display:flex;align-items:center;gap:10px;padding:5px 8px;border:1px solid var(--line,#eef1f6);border-radius:8px;margin-bottom:4px;background:var(--surface,#fcfdff);cursor:pointer;}'
      +'#mlsStudyOv .mls-study-cohlist{display:flex;flex-direction:column;gap:6px;margin-bottom:10px;}'
      +'#mlsStudyOv .mls-study-coh{display:flex;justify-content:space-between;align-items:center;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fafcff);color:var(--ink,#15293f);border-radius:9px;padding:9px 12px;}'
      +'#mlsStudyOv .mls-study-coh:hover{border-color:var(--brand,#2563c9);color:var(--brand,#2563c9);}'
      +'#mlsStudyOv .mls-study-open{font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;border:1px solid var(--brand,#2563c9);background:transparent;color:var(--brand,#2563c9);border-radius:7px;padding:3px 9px;}'
      +'#mlsStudyOv .mls-study-export{margin:6px 0;}';
    (document.head||document.documentElement).appendChild(s);
  }

  function boot(){ injectLaunch(); wireTimeline(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // re-inject the launch button if the Patients toolbar re-renders
  var tries=0; var iv=setInterval(function(){ tries++; if(tries>40){ clearInterval(iv); return; } safe(injectLaunch); }, 1200);

  window.__mlsStudy={ open:open, close:close, _strictMatch:strictMatch, _parseRows:parseRows, _normDob:normDob, _importRow:importRow, _listCohorts:listCohorts,
    _extractReportRows:extractReportRows, _parseReportRows:parseReportRows, _filterReportRows:filterReportRows, _resolveCriteria:resolveCriteria,
    _classifyDates:classifyDates, _detectName:detectName, _tagPatientCohort:tagPatientCohort, _studyFhirProbe:studyFhirProbe, _library:library, _autoSearch:doAutoSearchAthena, _assistSearchProcedure:assistSearchProcedure, _buildApptForRow:buildApptForRow, _svcToYMD:svcToYMD, _addToCalendar:addToCalendar, _searchCfg:searchCfg };
})();


/* ---- module: feat_tab_memory.js ---- */

/* ===== MLS active-tab / route memory — cohesion tweak =====
   Remembers the last tab you were on (per session) so a page reload returns you
   where you were instead of always snapping back to Visit. Pure progressive
   enhancement: own IIFE, guarded with try/catch, OBSERVES the active .navtab via a
   light poll and restores by calling the public showView() — it never modifies or
   monkey-patches any existing app function. Degrades to a silent no-op on any error.
   Exposes window.__mlsTabMemory. */
(function(){
  'use strict';
  if (window.__mlsTabMemory) return;
  var KEY = 'mlsLastTab';
  var VIEWS = { calendar:1, patients:1, visit:1, orders:1, recs:1, history:1, legalreq:1, team:1, analysis:1, studio:1, admin:1 };
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function ss(){ try{ return window.sessionStorage; }catch(e){ return null; } }
  function viewOf(el){ if(!el) return ''; var oc=el.getAttribute('onclick')||''; var m=oc.match(/showView\(\s*['"]([a-z]+)['"]\s*\)/i); return m?m[1]:''; }
  function currentView(){ return safe(function(){ return viewOf(document.querySelector('.navtab.on')); },''); }
  function store(v){ var s=ss(); if(s && v && VIEWS[v]) safe(function(){ s.setItem(KEY, v); }); }

  // Capture the saved tab BEFORE anything can overwrite it.
  var s0 = ss();
  var saved = s0 ? safe(function(){ return s0.getItem(KEY); }, '') : '';

  // RECORD: light poll of which .navtab is active (catches clicks AND programmatic
  // showView() calls alike). Started only AFTER restore so the default 'visit' on
  // load can't clobber the saved tab.
  var started = false, last = '';
  function startRecording(){
    if (started) return; started = true;
    last = currentView();
    setInterval(function(){ var v = currentView(); if (v && v !== last){ last = v; store(v); } }, 1000);
  }

  // RESTORE once on load, after the app's own initial showView() has run.
  var done = false;
  function restore(){
    if (done) return; done = true;
    if (saved && VIEWS[saved] && saved !== currentView() && typeof window.showView === 'function') {
      safe(function(){ window.showView(saved); });
    }
    setTimeout(startRecording, 200); // begin recording only after the restore settles
  }
  if (document.readyState === 'complete') setTimeout(restore, 800);
  else window.addEventListener('load', function(){ setTimeout(restore, 800); });

  window.__mlsTabMemory = { _current: currentView, _restore: restore, _key: KEY };
})();

/* ===== MLS premium-feature logo badges (additive, isolated IIFE) ===== */
;(function(){
  "use strict";
  try {
    var PILL_CLASS = 'mls-prem-pill';
    var PILL_STYLE = 'font-size:11px;font-weight:700;color:#fff;background:linear-gradient(90deg,#7b5cff,#a855f7);padding:2px 8px;border-radius:999px;vertical-align:middle;margin-left:6px;display:inline-block;line-height:1.4';
    var PILL_TEXT  = 'PREMIUM';
    var GRAD_RE = /linear-gradient/i;
    var PURPLE_RE = /(7b5cff|123, *92, *255|a855f7|168, *85, *247)/i;
    function removeEcg(){
      try{
        var olds = document.querySelectorAll('.mls-prem-badge, [data-mls-prem], .mls-prem-badge-svg');
        for(var i=0;i<olds.length;i++){
          var o = olds[i]; var rm = o;
          if(o.classList && o.classList.contains('mls-prem-badge-svg')){
            var w = o.closest ? o.closest('.mls-prem-badge') : null; if(w) rm = w;
          }
          if(rm && rm.parentNode) rm.parentNode.removeChild(rm);
        }
      }catch(e){}
    }
    function makePill(){
      var s = document.createElement('span');
      s.className = PILL_CLASS;
      s.setAttribute('data-mls-prem-pill','1');
      s.style.cssText = PILL_STYLE; s.textContent = PILL_TEXT; return s;
    }
    function hasPurplePill(el){
      if(!el) return false;
      if(el.querySelector && el.querySelector('span.'+PILL_CLASS+', span[data-mls-prem-pill]')) return true;
      var spans = el.querySelectorAll ? el.querySelectorAll('span') : [];
      for(var i=0;i<spans.length;i++){
        var sp = spans[i]; if(sp.children.length) continue;
        var tx = (sp.textContent||'').trim().toUpperCase(); if(tx !== 'PREMIUM') continue;
        var st = sp.getAttribute('style') || '';
        if(GRAD_RE.test(st) && PURPLE_RE.test(st)) return true;
      }
      return false;
    }
    function ensurePill(el){ if(!el) return; if(hasPurplePill(el)) return; el.appendChild(makePill()); }
    function ensurePillOnHeading(containerId, needle, mode, avoid){
      var c = document.getElementById(containerId); if(!c) return;
      var hs = c.querySelectorAll('h2,h3');
      for(var i=0;i<hs.length;i++){
        var h = hs[i], t = (h.textContent||'').trim();
        var match = (mode === 'starts') ? (t.indexOf(needle) === 0) : (t.indexOf(needle) !== -1);
        if(!match) continue;
        if(avoid){ var bad=false; for(var j=0;j<avoid.length;j++){ if(t.indexOf(avoid[j])!==-1){ bad=true; break; } } if(bad) continue; }
        ensurePill(h); return;
      }
    }
    function makeNavPill(){ var s=document.createElement('span'); s.className=PILL_CLASS; s.setAttribute('data-mls-prem-pill','1'); s.style.cssText='font-size:9px;font-weight:700;letter-spacing:.3px;color:#fff;background:linear-gradient(90deg,#7b5cff,#a855f7);padding:1px 6px;border-radius:999px;line-height:1.5;display:inline-block;vertical-align:middle;flex:0 0 auto'; s.textContent=PILL_TEXT; return s; }
    function ensurePillOnNav(id){ var el=document.getElementById(id); if(!el) return; try{ el.style.whiteSpace='nowrap'; el.style.flex='0 0 auto'; }catch(e){} if(hasPurplePill(el)) return; el.appendChild(makeNavPill()); }
    function normalizeSettingsLabel(hintId){
      try{
        var hint = document.getElementById(hintId); if(!hint) return;
        var scopes = [hint.parentElement, hint.parentElement && hint.parentElement.parentElement];
        for(var s=0;s<scopes.length;s++){
          var row = scopes[s]; if(!row) continue;
          var spans = row.querySelectorAll('span');
          for(var i=0;i<spans.length;i++){
            var sp = spans[i]; if(sp.children.length) continue;
            var tx = (sp.textContent||'').trim();
            if(tx === 'Premium' || tx === 'PREMIUM'){
              sp.style.cssText = PILL_STYLE; sp.textContent = PILL_TEXT; sp.setAttribute('data-mls-prem-pill','1'); return;
            }
          }
        }
        var rowEl = hint.parentElement; if(!rowEl) return;
        var titleEl = rowEl.querySelector('label, .set-label, strong, b, h3, h4') || rowEl;
        ensurePill(titleEl);
      }catch(e){}
    }
    function paint(){
      try{
        removeEcg();
        ensurePillOnNav('nav_studio');
        ensurePillOnHeading('copilotHero', 'MLS Copilot', 'contains');
        ensurePillOnHeading('studioView', 'Build a custom tool', 'contains');
        ensurePillOnHeading('teamView', 'MLS Efficiency report', 'contains', ['your doctors']);
        ensurePillOnHeading('anaAsk', 'Ask your data', 'contains');
        ensurePillOnHeading('anaReferral', 'Referral outcomes', 'contains');
        ensurePillOnHeading('anaRegistry', 'Outcomes registry', 'contains');
        normalizeSettingsLabel('noteModelHint');
        normalizeSettingsLabel('logoHint');
      }catch(e){}
    }
    var t = null;
    function schedule(){ if(t) return; t = setTimeout(function(){ t=null; paint(); }, 400); }
    if(document.readyState !== 'loading') paint();
    document.addEventListener('DOMContentLoaded', paint);
    var n = 0, iv = setInterval(function(){ paint(); if(++n > 10) clearInterval(iv); }, 1500);
    try{ var mo = new MutationObserver(schedule); mo.observe(document.body, { childList:true, subtree:true }); }catch(e){}
    window.__mlsPremiumBadges = { paint: paint, version: '2.0', style: 'purple-pill' };
  } catch(e){ /* silent no-op */ }
})();


/* ===== MLS Study / Import — Mode C: AUTOPILOT grab by procedure (v1.31) =====
   Adds a "Search Athena with MLS Assist" action to the existing "By procedure" panel that
   DRIVES athenaOne's procedure/claims search via MLS Assist, RUNS it, PAGINATES through every
   result page, harvests name+DOB(+date/CPT) for each row, and feeds every selected patient
   through the SAME strict name+DOB verify+import pipeline as Mode A/B (window.__mlsStudy._importRow).
   Then, for any imported patient whose harvested row carries a SCHEDULED (today/future) appointment
   date, it creates a linked MLS calendar entry (POST /api/appointments, patient_external_id) so
   patients <-> calendar stay connected. Read-only in Athena (never Save/Sign/submit-write). The MLS
   calendar write is the app's own DB and is part of the user-initiated import (and toggleable).

   Self-contained progressive enhancement: own IIFE, try/catch everywhere, observes the overlay,
   reuses __mlsStudy internals, never monkey-patches. Degrades to a silent no-op if anything is missing. */
(function(){
  if (window.__mlsGrab) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function S(){ return window.__mlsStudy || null; }

  /* ---- backend helpers (MLS app DB, not Athena) ---- */
  function bkBase(){ return safe(function(){ if(typeof window.bkBase==='function') return window.bkBase(); },null) || safe(function(){ return window.MLS_BACKEND||window.__mlsBackend||'https://scrivara-backend.onrender.com'; },'https://scrivara-backend.onrender.com'); }
  function bkToken(){ return safe(function(){ if(typeof window.bkToken==='function') return window.bkToken(); },null) || safe(function(){ return localStorage.getItem('sf_bk_token')||sessionStorage.getItem('sf_bk_token')||''; },''); }

  /* ---- date helpers ---- */
  function toIsoDate(s){
    s=String(s||'').trim(); if(!s) return '';
    var m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if(m){ return m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2); }
    m=s.match(/^([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})$/); if(!m) return '';
    var y=m[3]; if(y.length===2) y=(parseInt(y,10)>50?'19':'20')+y;
    return y+'-'+('0'+m[1]).slice(-2)+'-'+('0'+m[2]).slice(-2);
  }
  function todayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function isFutureOrToday(iso){ return iso && iso>=todayIso(); }
  function rowTime(line){ var m=String(line||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(a\.?m\.?|p\.?m\.?)?/i); return m?m[0].replace(/\s+/g,''):''; }
  function startIso(iso, t){
    if(!iso||!t) return null;
    var m=t.match(/^([01]?\d|2[0-3]):([0-5]\d)\s*(a|p)?/i); if(!m) return null;
    var h=parseInt(m[1],10), mi=parseInt(m[2],10), ap=(m[3]||'').toLowerCase();
    if(ap==='p'&&h<12) h+=12; if(ap==='a'&&h===12) h=0;
    return safe(function(){ return new Date(iso+'T'+('0'+h).slice(-2)+':'+('0'+mi).slice(-2)+':00').toISOString(); }, null);
  }

  /* ---- create a linked MLS calendar entry (deduped; today/future only) ---- */
  function calHasAppt(pid, iso){
    return safe(function(){ return (window._calAppts||[]).some(function(a){ return String(a.patient_external_id||'')===String(pid) && String(a.appt_date||'')===iso; }); }, false);
  }
  function ensureCalendarEntry(pid, name, dateStr, line, reason){
    var iso=toIsoDate(dateStr);
    if(!iso) return Promise.resolve({created:false, why:'no-date'});
    if(!isFutureOrToday(iso)) return Promise.resolve({created:false, why:'past'}); // a scheduled appt is today/future
    if(calHasAppt(pid, iso)) return Promise.resolve({created:false, why:'exists'});
    var body={ name:name, reason:reason||'Imported from Athena (procedure cohort)', patient_external_id:pid||null, appt_date:iso, start_at:startIso(iso, rowTime(line)), end_at:null };
    return safe(function(){
      return fetch(bkBase()+'/api/appointments',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+bkToken()},body:JSON.stringify(body)})
        .then(function(r){ return r.ok?{created:true, iso:iso}:{created:false, why:'http'+r.status}; })
        .catch(function(){ return {created:false, why:'net'}; });
    }, Promise.resolve({created:false, why:'err'}));
  }

  /* ---- bridge: drive athenaOne search + paginate via MLS Assist v1.31 (mlsAppSearchProcedure) ---- */
  function grabViaAssist(criteria, onStatus){
    // criteria = { params:{cpt:[],procedureName,dateFrom,dateTo}, cfg:{} }
    var params=(criteria&&criteria.params)||criteria||{};
    var cfg=(criteria&&criteria.cfg)||{};
    function mapResult(r){ r=r||{}; return { text:r.text||'', pages:r.pages||0, drove:!!r.ranControls, paginated:(r.pages||0)>1 }; }
    // Preferred: reuse the Study module's proven, progress-emitting driver (mlsAppSearchProcedure).
    var st=S();
    if(st && typeof st._assistSearchProcedure==='function'){
      return st._assistSearchProcedure(params, cfg, onStatus).then(mapResult, function(err){ return { error:(err&&err.message)||'search-failed', code:(err&&err.code)||'' }; });
    }
    // Fallback: drive the extension's live mlsAppSearchProcedure protocol directly (with live progress).
    return new Promise(function(resolve){
      var settled=false, ponged=false, iv=null, toR=null, tries=0;
      function fin(v){ if(settled) return; settled=true; window.removeEventListener('message',onPong); window.removeEventListener('message',onEvt); if(iv) clearInterval(iv); if(toR) clearTimeout(toR); resolve(v); }
      function onPong(e){ if(e.data&&e.data.source==='mls-ext'&&e.data.type==='mlsPong'&&!ponged){ ponged=true; proceed(); } }
      function onEvt(e){ var d=e.data; if(!(d&&d.source==='mls-ext')) return;
        if(d.type==='mlsAppSearchProgress'){ if(onStatus) onStatus(d.msg||'Working…'); return; }
        if(d.type==='mlsAppSearchResult'){ var r=d.resp||{}; if(r.ok===false){ fin({error:r.error||'search-failed',code:r.code||''}); return; } fin(mapResult(r)); } }
      window.addEventListener('message',onPong);
      var ping=function(){ safe(function(){ window.postMessage({source:'mls-app',type:'mlsPing'},'*'); }); };
      ping(); iv=setInterval(function(){ if(ponged){ clearInterval(iv); iv=null; return; } if(++tries>8){ clearInterval(iv); iv=null; if(!settled) fin({error:'no-ext'}); } else ping(); }, 350);
      function proceed(){
        if(iv){ clearInterval(iv); iv=null; }
        window.addEventListener('message',onEvt);
        if(onStatus) onStatus('Driving the athenaOne procedure search…');
        safe(function(){ window.postMessage({source:'mls-app',type:'mlsAppSearchProcedure',params:params,cfg:cfg},'*'); });
        toR=setTimeout(function(){ fin({error:'timeout'}); }, 360000); // generous: many pages
      }
    });
  }

  /* ---- import selected candidates: strict verify+import (reuse) + calendar link ---- */
  var STAT={ match:{i:'✓',c:'ok',l:'Found & imported'}, dob_mismatch:{i:'⚠',c:'bad',l:'DOB mismatch — skipped'},
    not_found:{i:'⚠',c:'warn',l:'Not found in Athena'}, review:{i:'⚠',c:'warn',l:'Verify manually'},
    no_bridge:{i:'⚠',c:'gate',l:'MLS Assist needed'}, old_ext:{i:'⚠',c:'gate',l:'Update MLS Assist'},
    error:{i:'⚠',c:'warn',l:'Read error — retry'}, pending:{i:'…',c:'wait',l:'Verifying in Athena…'} };
  function importSelected(picked, cohort, addCal, els, onDone){
    var st=S(); if(!st||!st._importRow){ if(onDone) onDone(); return; }
    var counts={match:0,dob_mismatch:0,not_found:0,review:0,no_bridge:0,error:0,old_ext:0}, cal=0, i=0;
    function step(){
      if(i>=picked.length){
        if(els.sum) els.sum.innerHTML='Done. ✓ '+counts.match+' imported · ⚠ '+counts.dob_mismatch+' DOB mismatch · '+counts.not_found+' not found · '+counts.review+' to verify'+(addCal?(' · 📅 '+cal+' calendar entr'+(cal===1?'y':'ies')):'');
        safe(function(){ if(window.renderPatients) window.renderPatients(); });
        if(addCal) safe(function(){ if(window.loadCalendar) window.loadCalendar(); });
        if(onDone) onDone(counts);
        return;
      }
      var r=picked[i];
      if(els.sum) els.sum.textContent='Importing '+esc(r.name||('patient '+(i+1)))+' ('+(i+1)+'/'+picked.length+') — verifying DOB in athenaOne…';
      Promise.resolve(safe(function(){ return st._importRow(r, cohort); }, Promise.resolve({status:'error'}))).then(function(res){
        res=res||{status:'error'};
        var key=res.status==='old-ext'?'old_ext':res.status; counts[key]=(counts[key]||0)+1;
        var s=STAT[key]||STAT.error, el=els.row(i);
        function paint(extra){ if(!el) return; var rs=el.querySelector('.mls-study-rs'); if(rs){ rs.className='mls-study-rs '+s.c; rs.textContent=s.i+' '+s.l+(extra||''); } }
        if(res.status==='match' && addCal && res.patientId){
          ensureCalendarEntry(res.patientId, (res.chartName||r.name), r.svc, r.line, els.reason).then(function(c){
            if(c&&c.created){ cal++; paint(' · 📅 appt '+(c.iso||'')); } else { paint(''); }
            if(els.sum) els.sum.textContent='Importing '+(i+1)+' / '+picked.length+'…';
            i++; setTimeout(step,120);
          });
        } else {
          var ex=''; if(res.status==='dob_mismatch') ex=' (Athena: '+esc(res.chartDob||'?')+')'; else if(res.status==='review'&&res.reason) ex=' ('+esc(res.reason)+')';
          paint(ex);
          if(els.sum) els.sum.textContent='Importing '+(i+1)+' / '+picked.length+'…';
          i++; setTimeout(step,120);
        }
      });
    }
    step();
  }

  /* ---- run the whole driven grab from the existing By-procedure inputs ---- */
  function runGrab(sec){
    var st=S(); var out=sec.querySelector('#mlsGrabOut'); if(!out) return;
    if(!st){ out.innerHTML='<div class="mls-study-gate">Study module not ready — reopen the panel.</div>'; return; }
    var crit=safe(function(){ return st._resolveCriteria(sec.querySelector('#mlsStudyBSel').value, sec.querySelector('#mlsStudyBProc').value); }, {label:'',keywords:[],codes:[]})||{label:'',keywords:[],codes:[]};
    crit.from=(sec.querySelector('#mlsStudyBFrom')||{}).value||''; crit.to=(sec.querySelector('#mlsStudyBTo')||{}).value||'';
    var addCal=!!(sec.querySelector('#mlsGrabCal')||{}).checked;
    var procName=(sec.querySelector('#mlsStudyBProc').value||'').trim()||(crit.label||'');
    out.innerHTML='<div class="mls-study-sum" id="mlsGrabStatus">Searching Athena for '+esc(crit.label||procName||'procedure')+'…</div>';
    var setS=function(m){ var n=sec.querySelector('#mlsGrabStatus'); if(n) n.textContent=m; };
    var params={ cpt:crit.codes||[], procedureName:procName, dateFrom:crit.from, dateTo:crit.to };
    var cfg=safe(function(){ return (window.__mlsStudyConfig&&(window.__mlsStudyConfig.search||window.__mlsStudyConfig.grabCfg))||{}; },{});
    grabViaAssist({params:params,cfg:cfg}, setS).then(function(resp){
      if(!resp || resp.error){
        var em = resp&&resp.error;
        var msg = em==='no-ext' ? 'MLS Assist isn’t responding. Install/enable the extension (v1.31+) and keep your signed-in athenaOne tab open, then try again.'
                : em==='timeout' ? 'Timed out driving athenaOne. Open your signed-in athenaOne tab (a procedure/claims search or report) and try again — or use 🔎 Find in Athena on a report you’ve already run.'
                : esc(String(em||'Couldn’t drive the athenaOne search — is an athenaOne tab open and signed in?'));
        out.innerHTML='<div class="mls-study-gate">'+msg+'</div>'; return;
      }
      var text=resp.text||'';
      if(!text){ out.innerHTML='<div class="mls-study-gate">MLS Assist reached athenaOne but read 0 result rows'+(resp.pages?(' across '+resp.pages+' page(s)'):'')+'. Open a procedure/claims search or report so the result rows are visible, or tune <code>window.__mlsStudyConfig.search</code> to your layout — or use 🔎 Find in Athena on a report you’ve already run.</div>'; return; }
      var all=safe(function(){ return st._parseReportRows(text); }, [])||[];
      var rows=safe(function(){ return st._filterReportRows(all, crit); }, [])||[];
      renderCandidates(sec, rows, all.length, crit, resp, addCal);
    });
  }

  function renderCandidates(sec, rows, totalParsed, crit, resp, addCal){
    var out=sec.querySelector('#mlsGrabOut'); if(!out) return;
    var norm=safe(function(){ return S()._normDob; }, null);
    var pageInfo='Harvested '+(resp.pages||1)+' page'+((resp.pages||1)===1?'':'s')+(resp.drove?' · auto-ran the search':'')+(resp.paginated?' · paginated':'');
    if(!rows.length){
      out.innerHTML='<div class="mls-study-gate">'+pageInfo+'. Parsed '+esc(String(totalParsed))+' patient row(s) but none matched <b>'+esc(crit.label||'your criteria')+'</b>'+((crit.from||crit.to)?' in that date range':'')+'.<br>Tips: make sure the report shows the procedure/CPT column; widen/clear the date range; or set <code>window.__mlsStudyConfig</code> to tune the parser to your report layout.</div>';
      return;
    }
    var withDob=rows.filter(function(r){ return norm?norm(r.dob):r.dob; }).length;
    var sched=rows.filter(function(r){ return isFutureOrToday(toIsoDate(r.svc)); }).length;
    out.innerHTML='<div class="mls-study-sum">'+pageInfo+'. Found <b>'+rows.length+'</b> patient(s) matching '+esc(crit.label||'criteria')+' — '+withDob+' with a readable DOB'+(addCal&&sched?(' · '+sched+' with a scheduled appt → calendar'):'')+'. Review, then verify + import:</div>'
      +'<div class="mls-study-checkall"><label><input type="checkbox" id="mlsGrabAll" checked> Select all</label></div>'
      +'<div class="mls-study-candlist">'+rows.map(function(r,i){
          var d=norm?norm(r.dob):r.dob; var cpt=r.codes&&r.codes.length?(' · '+esc(r.codes.join(', '))):''; var sv=r.svc?(' · '+esc(r.svc)+(isFutureOrToday(toIsoDate(r.svc))?' 📅':'')):'';
          return '<label class="mls-study-cand"><input type="checkbox" class="mls-grab-chk" data-i="'+i+'"'+(d?' checked':'')+(d?'':' disabled')+'>'
            +'<span class="mls-study-rn">'+esc(r.name)+'</span>'
            +'<span class="mls-study-rd">'+esc(r.dob||'(no DOB — can’t verify)')+'</span>'
            +'<span class="mls-study-cnt">'+esc(((r.codes&&r.codes[0])||'')+(r.svc?(' '+r.svc):'')).trim()+'</span></label>';
        }).join('')+'</div>'
      +'<div class="mls-study-help">Only rows with a readable DOB can be verified+imported (the strict name+DOB gate needs both). Every selected patient is re-verified against their live Athena chart on import — a wrong row cannot import the wrong patient.</div>'
      +'<label class="mls-study-lab">Cohort / study name</label>'
      +'<input id="mlsGrabCohort" class="mls-study-in" value="'+esc(((sec.querySelector('#mlsStudyBFCohort')||{}).value||crit.label||'').slice(0,80))+'" placeholder="cohort name" />'
      +'<div class="mls-study-actions"><button type="button" id="mlsGrabImport" class="mls-study-btn">✓ Verify &amp; import selected'+(addCal?' (+ calendar)':'')+'</button></div>'
      +'<div class="mls-study-sum" id="mlsGrabImpSum"></div><div id="mlsGrabImpRows"></div>';
    var allc=out.querySelector('#mlsGrabAll');
    if(allc) allc.addEventListener('change', function(){ out.querySelectorAll('.mls-grab-chk').forEach(function(c){ if(!c.disabled) c.checked=allc.checked; }); });
    out.querySelector('#mlsGrabImport').addEventListener('click', function(){
      var cohort=((out.querySelector('#mlsGrabCohort')||{}).value||'').trim();
      var sum=out.querySelector('#mlsGrabImpSum');
      if(!cohort){ if(sum) sum.innerHTML='<span class="mls-study-gatetext">Enter a cohort name first.</span>'; return; }
      var picked=[]; out.querySelectorAll('.mls-grab-chk').forEach(function(c){ if(c.checked&&!c.disabled) picked.push(rows[parseInt(c.getAttribute('data-i'),10)]); });
      if(!picked.length){ if(sum) sum.innerHTML='<span class="mls-study-gatetext">Tick at least one patient with a DOB.</span>'; return; }
      var box=out.querySelector('#mlsGrabImpRows');
      box.innerHTML=picked.map(function(r,i){ var s=STAT.pending; return '<div class="mls-study-row" id="mlsg'+i+'"><span class="mls-study-rn">'+esc(r.name)+'</span><span class="mls-study-rd">'+esc(r.dob||'')+'</span><span class="mls-study-rs '+s.c+'">'+s.i+' '+s.l+'</span></div>'; }).join('');
      importSelected(picked, cohort, addCal, { sum:sum, reason:(crit.label||'Procedure cohort'), row:function(i){ return box.querySelector('#mlsg'+i); } });
    });
  }

  /* ---- inject the action into the existing "Find patients in Athena by procedure" section ---- */
  function inject(){
    safe(function(){
      var findBtn=document.getElementById('mlsStudyBFind'); if(!findBtn) return;
      var sec=findBtn.closest('.mls-study-sec'); if(!sec) return;
      if(sec.querySelector('#mlsGrabAthenaBtn')) return;
      // badge: this is the autopilot upgrade
      var head=sec.querySelector('.mls-study-sech'); if(head && !head.querySelector('.mls-grab-badge')){ var bd=document.createElement('span'); bd.className='mls-study-badge live mls-grab-badge'; bd.textContent='autopilot v1.31'; head.appendChild(bd); }
      var actions=findBtn.parentElement; // .mls-study-actions
      var b=document.createElement('button'); b.type='button'; b.id='mlsGrabAthenaBtn'; b.className='mls-study-btn'; b.innerHTML='🤖 Search Athena with MLS Assist';
      b.title='Drive athenaOne’s procedure/claims search, run it, paginate through every page, and import all matching patients.';
      actions.appendChild(b);
      // options row
      var opt=document.createElement('div'); opt.className='mls-grab-opts';
      opt.innerHTML='<label><input type="checkbox" id="mlsGrabDrive" checked> Auto-run the report in Athena (best-effort)</label>'
                  +'<label><input type="checkbox" id="mlsGrabCal" checked> Add a calendar entry for any scheduled appointment</label>';
      actions.parentElement.insertBefore(opt, actions.nextSibling);
      // dedicated output area for the grab (kept separate from the manual Find output)
      var out=document.createElement('div'); out.id='mlsGrabOut'; out.className='mls-study-results';
      var findOut=sec.querySelector('#mlsStudyBFindOut'); (findOut&&findOut.parentElement?findOut.parentElement:sec).insertBefore(out, findOut?findOut.nextSibling:null);
      // tiny style for the options row
      if(!document.getElementById('mlsGrabCss')){ var s=document.createElement('style'); s.id='mlsGrabCss'; s.textContent='#mlsStudyOv .mls-grab-opts{display:flex;flex-direction:column;gap:4px;margin:2px 0 8px;font-size:11.5px;color:var(--muted,#5b6b7c);} #mlsStudyOv .mls-grab-opts label{display:flex;align-items:center;gap:7px;cursor:pointer;}'; (document.head||document.documentElement).appendChild(s); }
      b.addEventListener('click', function(){ runGrab(sec); });
    });
  }
  // poll: the Study overlay is created/destroyed on demand; (re)inject whenever Mode B is shown
  setInterval(inject, 700);

  window.__mlsGrab={ _grabViaAssist:grabViaAssist, _ensureCalendarEntry:ensureCalendarEntry, _toIsoDate:toIsoDate, _isFutureOrToday:isFutureOrToday, _startIso:startIso, _rowTime:rowTime, _runGrab:runGrab };
})();

/* ============================================================================
   feat_nextup_connect.js  —  NEXT UP  <->  Calendar : single-source wiring
   ----------------------------------------------------------------------------
   Goal (visit-page "Just Talk" hero):
     1. DOB AUTOFILL  - tapping a NEXT UP blue card (or the auto "up now" pick)
        fills BOTH the Patient name (#heroPtName) AND the Date of birth
        (#heroPtDob, MM/DD/YYYY) from the patient's stored DOB.
     2. ALWAYS-ON     - the NEXT UP cards populate by DEFAULT from the
        calendar/schedule, not only after an Athena pull / toggle.
     3. PERSIST       - they survive a page reload by reading from the
        persisted calendar (loadCalendar -> /api/appointments -> _calAppts),
        not from transient post-pull state.
     4. SINGLE SOURCE - the calendar (_calAppts) is the one source: Athena
        pulls already write to it; the calendar reads it; the NEXT UP boxes
        read it here; tapping a card carries name + DOB (+ history, via the
        app's own _heroPickPatient) into the note.

   Design: a self-contained IIFE appended to the mls-connect.js bundle. It only
   READS app state and FEEDS the app's own renderers (_renderTodayPatients,
   _calLoadNextUp). It never monkey-patches an existing app function, never
   writes to the server, and degrades to a silent no-op if any global is
   missing. Removing this block fully reverts the feature.

   A guarded debug-date hook (window.__mlsNextUpDebugDate /
   sessionStorage['__mlsNextUpDebugDate']) lets a tester treat another day as
   "today" for verification against persisted data. It is inert in normal use
   (nobody sets it) and is the ONLY way it activates.
   ============================================================================ */
(function () {
  'use strict';
  try {
    if (window.__mlsNextUp && window.__mlsNextUp.__installed) return; // guard against double-append
  } catch (e) { }

  function gid(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }

  // --- "today" key (YYYY-MM-DD) in local time, with an opt-in debug override ----
  function todayKey() {
    try {
      var dbg = null;
      try { dbg = window.__mlsNextUpDebugDate || (window.sessionStorage && sessionStorage.getItem('__mlsNextUpDebugDate')); } catch (e) { }
      if (dbg && /^\d{4}-\d{2}-\d{2}$/.test(String(dbg))) return String(dbg);
    } catch (e) { }
    var n = new Date();
    return n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2);
  }

  // --- the LOCAL calendar date an appointment falls on ------------------------
  function localDateOf(a) {
    try {
      if (a && a.appt_date) return String(a.appt_date).slice(0, 10);
      if (a && a.start_at) {
        var d = new Date(a.start_at);
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      }
    } catch (e) { }
    return '';
  }

  // --- stored DOB for a patient name (fallback when the appt carries none) ----
  function patientDob(name) {
    try {
      var pts = (isFn(window.getPatients) ? window.getPatients() : []) || [];
      var key = String(name || '').trim().toLowerCase();
      if (!key) return '';
      var m = pts.find(function (x) { return String(x.name || '').trim().toLowerCase() === key; });
      if (m) return m.dob || m.DOB || m.birthDate || '';
    } catch (e) { }
    return '';
  }

  // --- build TODAY's hero list from the SINGLE SOURCE (_calAppts), DOB-enriched
  function buildToday() {
    var out = [];
    try {
      var tk = todayKey();
      var src = window._calAppts || [];
      var hhmm = isFn(window._apptHHMMTz) ? window._apptHHMMTz : function () { return ''; };
      var labelOf = isFn(window._calLabelOf) ? window._calLabelOf : function () { return ''; };
      for (var i = 0; i < src.length; i++) {
        var a = src[i] || {};
        if (localDateOf(a) !== tk) continue;
        var nm = String(a.name || labelOf(a) || '').trim();
        if (!nm) continue;
        var dob = a.dob || '';
        if (!dob) dob = patientDob(nm);
        out.push({
          name: nm,
          time: hhmm(a.start_at),
          reason: a.reason || '',
          dob: dob,
          start_at: a.start_at,
          appt_date: a.appt_date
        });
      }
    } catch (e) { }
    return out;
  }

  // --- feed the app's own renderers (render-only, no fetch) --------------------
  function renderFromCalendar() {
    try {
      if (!isFn(window._renderTodayPatients)) return;
      var todays = buildToday();
      // Draws the NEXT UP chips + sets window._heroTodayList. The app's renderer
      // hides the box when there are no today/tomorrow patients, so "always-on"
      // here means "shown by default whenever scheduled patients exist".
      window._renderTodayPatients(todays);

      // Auto-load the "up now" patient (name + DOB) ONLY when the doctor has not
      // already started typing a patient - never clobber an in-progress visit.
      var nmEl = gid('heroPtName');
      var nameEmpty = !nmEl || !String(nmEl.value || '').trim();
      if (nameEmpty && isFn(window._calLoadNextUp)) { try { window._calLoadNextUp(); } catch (e) { } }

      // DOB safety net: if a name is loaded but DOB is still blank, fill it from
      // the stored patient record (covers any path where appt.dob was empty).
      try {
        var db = gid('heroPtDob'), nm2 = gid('heroPtName');
        if (db && !String(db.value || '').trim() && nm2 && String(nm2.value || '').trim()) {
          var d = patientDob(nm2.value);
          if (d) db.value = d;
        }
      } catch (e) { }
    } catch (e) { }
  }

  // --- ensure the single source is loaded, then render ------------------------
  var _loading = false;
  function ensureToday(force) {
    try {
      var haveTok = isFn(window.bkToken) && window.bkToken();
      var need = force || !window._calAppts || !window._calAppts.length;
      if (need && haveTok && isFn(window.loadCalendar) && !_loading) {
        _loading = true;
        Promise.resolve().then(function () { return window.loadCalendar(); })
          .catch(function () { })
          .then(function () { _loading = false; renderFromCalendar(); });
      } else {
        renderFromCalendar();
      }
    } catch (e) { _loading = false; }
  }

  // --- stay in sync with the single source (Athena pulls -> loadCalendar) ------
  // Light poll on a content signature: re-render only when today's appts change,
  // so we never fight the user's interaction and never trigger a fetch here.
  var _lastSig = ' ';
  function sig() {
    try {
      var tk = todayKey(), parts = [];
      var src = window._calAppts || [];
      for (var i = 0; i < src.length; i++) {
        var a = src[i] || {};
        if (localDateOf(a) !== tk) continue;
        parts.push(String(a.name || '') + '#' + (a.dob || '') + '#' + (a.start_at || a.appt_date || ''));
      }
      return tk + '|' + parts.length + '|' + parts.sort().join(',');
    } catch (e) { return ''; }
  }
  function tick() {
    try {
      var s = sig();
      if (s !== _lastSig) { _lastSig = s; renderFromCalendar(); }
    } catch (e) { }
  }

  function start() {
    try {
      ensureToday(false);
      // calendar may arrive a moment after boot; nudge a couple of times
      setTimeout(function () { ensureToday(false); }, 1200);
      setTimeout(function () { ensureToday(false); }, 4000);
      setInterval(tick, 1500);
    } catch (e) { }
  }

  window.__mlsNextUp = {
    __installed: true,
    _buildToday: buildToday,
    _render: renderFromCalendar,
    _ensure: ensureToday,
    _patientDob: patientDob,
    _todayKey: todayKey,
    reload: function () { ensureToday(true); }
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  } catch (e) { try { start(); } catch (_) { } }
})();

;/* === Outcome Study feature loader (loads mls-outcome-study.js) === */
(function(){try{if(document.getElementById('mlsOutcomeStudyLoader'))return;var s=document.createElement('script');s.id='mlsOutcomeStudyLoader';s.src='mls-outcome-study.js?v=20260618b';s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;/* === RVU feature loader (loads mls-rvu.js) === */
(function(){try{if(document.getElementById('mlsRvuLoader'))return;var s=document.createElement('script');s.id='mlsRvuLoader';s.src='mls-rvu.js?v=20260617b';s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

/* ===== feat_premium_studio_lock.js — MLS premium UI lock for AI Studio (additive, fail-safe) =====
   Complements the server-side premiumGate. For NON-premium users it locks the AI Studio
   view (MLS Copilot + custom widgets) with an upgrade prompt instead of usable controls,
   mirroring the app's existing premium-lock card (#anaPremiumLocked) styling and wording.
   Premium/owner/admin users are unaffected (effectivePremium() === true => no-op + auto-unlock).
   Own IIFE, all work in try/catch, silent no-op on any error, idempotent, no monkey-patching. */
(function(){
  'use strict';
  try {
    var LOCK_ID = 'mlsStudioPremiumLock';
    function isPrem(){
      try { if (typeof effectivePremium === 'function') return !!effectivePremium(); } catch(e){}
      try { var u = (typeof bkUser !== 'undefined' && bkUser) || (window.bkUser) || {}; return !!(u.premium || u.isAdmin); } catch(e){}
      return true; // fail-open: never lock out a user on a detection error (server still enforces)
    }
    function makeLock(){
      var d = document.createElement('div');
      d.id = LOCK_ID;
      d.setAttribute('style','border:1px solid var(--line);border-radius:12px;padding:20px;text-align:center;background:var(--card-2,rgba(123,92,255,0.05));margin:0 0 14px;');
      d.innerHTML = '<div style="font-size:26px;line-height:1;margin-bottom:6px">🔒</div>'
        + '<div style="font-weight:700;margin-bottom:4px">Premium feature</div>'
        + '<p class="sub" style="margin:0">AI Studio — MLS Copilot and custom widgets — is a Premium ($150) feature. Contact your administrator to enable it.</p>';
      return d;
    }
    function applyLock(){
      try {
        var sv = document.getElementById('studioView');
        if (!sv) return;
        if (isPrem()) { unlock(); return; }
        if (!document.getElementById(LOCK_ID)) {
          sv.insertBefore(makeLock(), sv.firstChild);
        }
        var ctrls = sv.querySelectorAll('textarea,button,input,select,[contenteditable]');
        for (var i=0;i<ctrls.length;i++){
          var el = ctrls[i];
          if (el.closest && el.closest('#'+LOCK_ID)) continue;
          if (!el.hasAttribute('data-mls-prem-dis')) {
            el.setAttribute('data-mls-prem-dis','1');
            try { el.disabled = true; } catch(e){}
            el.style.pointerEvents = 'none';
          }
        }
        var kids = sv.children;
        for (var j=0;j<kids.length;j++){
          var c = kids[j];
          if (c.id === LOCK_ID) continue;
          if (c.getAttribute('data-mls-prem-dim')) continue;
          c.setAttribute('data-mls-prem-dim','1');
          c.style.opacity = '0.5';
        }
      } catch(e){}
    }
    function unlock(){
      try {
        var lk = document.getElementById(LOCK_ID); if (lk) lk.remove();
        var dis = document.querySelectorAll('[data-mls-prem-dis]');
        for (var i=0;i<dis.length;i++){ var el=dis[i]; el.removeAttribute('data-mls-prem-dis'); try{el.disabled=false;}catch(e){} el.style.pointerEvents=''; }
        var dim = document.querySelectorAll('[data-mls-prem-dim]');
        for (var j=0;j<dim.length;j++){ var c=dim[j]; c.removeAttribute('data-mls-prem-dim'); c.style.opacity=''; }
      } catch(e){}
    }
    function tick(){ applyLock(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    tick();
    var n=0, iv=setInterval(function(){ tick(); if(++n>20) clearInterval(iv); }, 500);
    try {
      var mo = new MutationObserver(function(){
        if (window.__mlsStudioLockT) return;
        window.__mlsStudioLockT = setTimeout(function(){ window.__mlsStudioLockT=null; tick(); }, 150);
      });
      mo.observe(document.body, { childList:true, subtree:true });
    } catch(e){}
    window.__mlsStudioLock = { apply: applyLock, unlock: unlock, isPrem: isPrem };
  } catch(e){}
})();

;(function(){try{if(!document.querySelector('script[data-mls-visits]')){var s=document.createElement('script');s.src='feat_visits.js?v=20260706b46';s.setAttribute('data-mls-visits','1');(document.head||document.documentElement).appendChild(s);}}catch(e){}})(); /* MLS visit-aware loader */
;(function(){try{var s=document.createElement('script');s.src='legal-chart-fill-ui.js?v='+(window.__MLS_AV||Date.now());s.defer=true;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* load legal-chart-fill-ui */

/* MLS — load Add-patient (per-visit) UI + injection-cohort per-visit capture (append-only, guarded) */
;(function(){try{['feat_addpatient.js','feat_cohort_visits.js'].forEach(function(f){if(document.querySelector('script[data-mls-asset="'+f+'"]'))return;var s=document.createElement('script');s.src=f+'?v='+(window.__MLS_AV||Date.now());s.async=true;s.setAttribute('data-mls-asset',f);(document.head||document.documentElement).appendChild(s);});}catch(e){}})();
/* MLS - stabilize active-patient context bar badges (idempotent render; append-only, guarded) */
;(function(){try{if(document.querySelector('script[data-mls-asset="ctxbar-stabilize.js"]'))return;var s=document.createElement('script');s.src='ctxbar-stabilize.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','ctxbar-stabilize.js');s.defer=true;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_visit_detail.js"]'))return;var s=document.createElement('script');s.src='feat_visit_detail.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_visit_detail.js');s.async=true;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

/* MLS — load patient/visit ease-of-use pass (append-only, guarded) */
(function(){try{if(!document.querySelector('script[data-mls-asset="feat_ease.js"]')){var s=document.createElement('script');s.src='feat_ease.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_ease.js');s.async=false;(document.head||document.documentElement).appendChild(s);}}catch(e){}})();

(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_guard.js"]'))return;var s=document.createElement('script');s.src='feat_athena_guard.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_athena_guard.js');document.head.appendChild(s);}catch(e){}})(); /* MLS — athenaOne-open guard (block fake progress/saves when logged out) */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_visits_honest.js"]'))return;var s=document.createElement('script');s.src='feat_visits_honest.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_visits_honest.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_visits_counter_guard.js"]'))return;var s=document.createElement('script');s.src='feat_visits_counter_guard.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_visits_counter_guard.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();

/* loader: extended visit-history UI (timeline + overview + trends + filter/search/sort) — guarded, idempotent, cache-busted */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_visit_history_ext.js"]'))return;var s=document.createElement('script');s.src='feat_visit_history_ext.js?v='+(window.__MLS_AV||Date.now());s.async=false;s.setAttribute('data-mls-asset','feat_visit_history_ext.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();


/* ---- loader: mls-opnote-pro (op-note professional format + Save-as-PDF) ---- */
(function(){try{if(window.__mlsOpNoteProLoader)return;window.__mlsOpNoteProLoader=1;var s=document.createElement('script');s.src='mls-opnote-pro.js?v=20260619a';s.async=true;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

/* ---- loader: mls-procedure-report (Analysis › 📊 Procedure Report: counts by type, Office/ASC place-of-service, RVU/$ totals, PDF/CSV) ---- */
(function(){try{if(window.__mlsProcReportLoader)return;window.__mlsProcReportLoader=1;var s=document.createElement('script');s.src='mls-procedure-report.js?v=20260619a';s.async=true;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{if(!document.querySelector('script[data-mls-asset="feat_source_clarity.js"]')){var s=document.createElement('script');s.src='feat_source_clarity.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_source_clarity.js');document.head.appendChild(s);}}catch(e){}})();
/* ---- loader: feat_athena_autopull (one-click open-chart auto-pull; fixes false name-match safety stop; additive, reversible) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_autopull.js"]'))return;var s=document.createElement('script');s.src='feat_athena_autopull.js?v='+(window.__MLS_AV||Date.now());s.async=false;s.setAttribute('data-mls-asset','feat_athena_autopull.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();
/* ---- loader: feat_athena_status_dot (always-on top-right Athena connection indicator; additive, reversible) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_status_dot.js"]'))return;var s=document.createElement('script');s.src='feat_athena_status_dot.js?v='+(window.__MLS_AV||Date.now());s.async=false;s.setAttribute('data-mls-asset','feat_athena_status_dot.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();


/* ---- loader: feat_opnote_history_pdf (one-click PDF on op-note history rows) ---- */
(function(){try{if(window.__mlsOpNoteHistPdfLoader)return;window.__mlsOpNoteHistPdfLoader=1;var s=document.createElement('script');s.src='feat_opnote_history_pdf.js?v=20260620a';s.async=true;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_easy.js"]'))return;var s=document.createElement('script');s.src='feat_mls_easy.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_mls_easy.js');document.head.appendChild(s);}catch(e){}})();
/* ---- loader: feat_save_verify.js (save-integrity verification) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_save_verify.js"]'))return;var s=document.createElement('script');s.src='feat_save_verify.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_save_verify.js');document.head.appendChild(s);}catch(e){}})();

/* feat_athena_doctor.js loader — guarded, idempotent, cache-busted (self-troubleshoot + clearer success) */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_doctor.js"]'))return;var s=document.createElement('script');s.src='/feat_athena_doctor.js?v='+(window.__MLS_AV||Date.now());s.async=true;s.setAttribute('data-mls-asset','feat_athena_doctor.js');(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();
(function(){try{if(document.querySelector('script[data-mls-asset="feat_opnote_onscreen.js"]'))return;var s=document.createElement('script');s.src='/feat_opnote_onscreen.js?v='+(window.__MLS_AV||Date.now());s.async=true;s.setAttribute('data-mls-asset','feat_opnote_onscreen.js');(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();
/* ---- loader: mls-template-stdline (reusable standard line for Templates tab) ---- */
;(function(){try{if(document.querySelector('script[data-mls-asset="mls-template-stdline.js"]'))return;var s=document.createElement('script');s.src='/mls-template-stdline.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','mls-template-stdline.js');document.head.appendChild(s);}catch(e){}})();

/* ---- loader: feat_athena_actions.js (shared Athena-action treatment: live status / click-intent labels / destination-verify / self-recovery) ---- */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_actions.js"]'))return;var s=document.createElement('script');s.src='/feat_athena_actions.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_athena_actions.js');document.head.appendChild(s);}catch(e){}})();


/* ---- loader: feat_athena_writeback.js (WRITE finished note into the open Athena chart; verified paste; patient name+DOB gate; never Save/Sign) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_writeback.js"]'))return;var s=document.createElement('script');s.src='feat_athena_writeback.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_athena_writeback.js');document.head.appendChild(s);}catch(e){}})();


/* feat_athena_clarity.js */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_clarity.js"]'))return;var s=document.createElement('script');s.src='feat_athena_clarity.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_athena_clarity.js');document.head.appendChild(s);}catch(e){}})();

/* feat_athena_selfheal.js */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_selfheal.js"]'))return;var s=document.createElement('script');s.src='feat_athena_selfheal.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_athena_selfheal.js');document.head.appendChild(s);}catch(e){}})();
(function(){try{if(document.querySelector('script[data-mls-asset="feat_patient_switcher.js"]'))return;var s=document.createElement('script');s.src='feat_patient_switcher.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_patient_switcher.js');document.head.appendChild(s);}catch(e){}})();
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_provider_scope.js"]'))return;var s=document.createElement('script');s.src='feat_athena_provider_scope.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_athena_provider_scope.js');document.head.appendChild(s);}catch(e){}})();


/* feat_athena_ux_unify.js */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_ux_unify.js"]'))return;var s=document.createElement('script');s.src='feat_athena_ux_unify.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_athena_ux_unify.js');document.head.appendChild(s);}catch(e){}})();
(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_centerpiece.js"]'))return;var s=document.createElement('script');s.src='feat_mls_centerpiece.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_mls_centerpiece.js');document.head.appendChild(s);}catch(e){}})();
(function(){try{if(document.querySelector('script[data-mls-asset="feat_fab_layout.js"]'))return;var s=document.createElement('script');s.src='feat_fab_layout.js?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset','feat_fab_layout.js');document.head.appendChild(s);}catch(e){}})();
/* ---- loader feat_athena_provider_picker.js (Whose patients? doctor dropdown + provider-scoped schedule pull) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_provider_picker.js"]'))return; var s=document.createElement('script'); s.src='/feat_athena_provider_picker.js?v='+(window.__MLS_AV||Date.now()); s.setAttribute('data-mls-asset','feat_athena_provider_picker.js'); document.head.appendChild(s); }catch(e){}})();(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_easy_contrast.js"]'))return; var s=document.createElement('script'); s.src='/feat_mls_easy_contrast.js?v='+(window.__MLS_AV||Date.now()); s.setAttribute('data-mls-asset','feat_mls_easy_contrast.js'); document.head.appendChild(s); }catch(e){}})();(function(){try{if(document.querySelector('script[data-mls-asset="feat_after_visit_summary.js"]'))return; var s=document.createElement('script'); s.src='/feat_after_visit_summary.js?v='+(window.__MLS_AV||Date.now()); s.setAttribute('data-mls-asset','feat_after_visit_summary.js'); document.head.appendChild(s); }catch(e){}})()
/* ---- loader: feat_mls_protocol (MLS Easy protocol: auto-advance to NEXT UP Slide 2, record textbox, full ordered flow, provider-name-everywhere, sizing/readability; additive, reversible) ---- */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_protocol.js"]'))return;var s=document.createElement('script');s.src='feat_mls_protocol.js?v='+(window.__MLS_AV||Date.now());s.async=false;s.setAttribute('data-mls-asset','feat_mls_protocol.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_protocol_pickfix.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_protocol_pickfix.js?v=20260622';s.setAttribute('data-mls-asset','feat_mls_protocol_pickfix.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{var A='mls-connection-truth.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{var A='mls-fabrication-sentinel.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_easy_pickfix.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_easy_pickfix.js?v=20260622c';s.setAttribute('data-mls-asset','feat_mls_easy_pickfix.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_contrast_fix.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_contrast_fix.js?v=20260622';s.setAttribute('data-mls-asset','feat_mls_contrast_fix.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{['feat_opnote_history.js'].forEach(function(f){if(document.querySelector('script[data-mls-asset="'+f+'"]'))return;var s=document.createElement('script');s.src=f+'?v='+(window.__MLS_AV||Date.now());s.async=true;s.setAttribute('data-mls-asset',f);(document.head||document.documentElement).appendChild(s);});}catch(e){}})(); /* MLS — history-aware op-note generation + real loading/ready indicator (append-only, guarded) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_provider_roster.js"]'))return;var s=document.createElement('script');s.src='feat_athena_provider_roster.js?v='+(window.__MLS_AV||Date.now());s.async=true;s.setAttribute('data-mls-asset','feat_athena_provider_roster.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_stdline_insert.js"]'))return;var s=document.createElement('script');s.src='/feat_stdline_insert.js?v=20260622';s.setAttribute('data-mls-asset','feat_stdline_insert.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_opnote_pdf_anyview.js"]'))return;var s=document.createElement('script');s.src='/feat_opnote_pdf_anyview.js?v=20260622';s.setAttribute('data-mls-asset','feat_opnote_pdf_anyview.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

/* LOADER for feat_athena_truthcheck.js  (PART 1)
 * Append this ONE guarded, idempotent, cache-busted, ;-prefixed line/block at
 * the TRUE EOF of mls-connect.js (and its .staging.js twin), after the last
 * existing data-mls-asset loader. The leading ';' guarantees ASI safety even
 * if the preceding line lacked a terminator. Revert = delete this block.
 */
;(function(){try{
  var A='feat_athena_truthcheck.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+(window.__MLS_AV||Date.now());
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();
/* LOADER for feat_athena_cardtips.js  (PART 2)
 * Append this ONE guarded, idempotent, cache-busted, ;-prefixed block at the
 * TRUE EOF of mls-connect.js (and its .staging.js twin), after the Part 1
 * loader. The leading ';' guarantees ASI safety. Revert = delete this block.
 */
;(function(){try{
  var A='feat_athena_cardtips.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+(window.__MLS_AV||Date.now());
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();

/* ---- loaders: Slide-5 Submit checklist + amber->red truthcheck consistency + mlsac-card tooltips (additive, reversible) ---- */
;(function(){try{
  var A='feat_mls_submit_checklist.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+(window.__MLS_AV||Date.now());
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();
;(function(){try{
  var A='feat_athena_truthcheck_amber.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+(window.__MLS_AV||Date.now());
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();
;(function(){try{
  var A='feat_athena_cardtips_mlsac.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+(window.__MLS_AV||Date.now());
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();

;(function(){try{var A='feat_athena_narration.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_easy_hardening.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_easy_hardening.js?v=20260622a';s.setAttribute('data-mls-asset','feat_mls_easy_hardening.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{var A='feat_athena_cardtips_noinfo.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{var A='feat_stdline_autoinsert.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{var A='feat_autosave.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{['feat_patient_quicksearch.js'].forEach(function(f){if(document.querySelector('script[data-mls-asset="'+f+'"]'))return;var s=document.createElement('script');s.src=f+'?v='+(window.__MLS_AV||Date.now());s.async=true;s.setAttribute('data-mls-asset',f);(document.head||document.documentElement).appendChild(s);});}catch(e){}})();

;(function(){try{['feat_fullhistory_pdf.js'].forEach(function(f){if(document.querySelector('script[data-mls-asset="'+f+'"]'))return;var s=document.createElement('script');s.src=f+'?v='+(window.__MLS_AV||Date.now());s.async=true;s.setAttribute('data-mls-asset',f);(document.head||document.documentElement).appendChild(s);});}catch(e){}})(); /* MLS — Export full patient visit history as ONE PDF (additive, guarded, reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_viewpersist.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_viewpersist.js?v=20260623a';s.setAttribute('data-mls-asset','feat_mls_viewpersist.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_topbar_unify.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_topbar_unify.js?v=20260623a';s.setAttribute('data-mls-asset','feat_mls_topbar_unify.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{
  var A='feat_athena_signin_prompt.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+(window.__MLS_AV||Date.now());
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();
;(function(){try{if(document.getElementById('mlsEasy4FixesLoader'))return;var s=document.createElement('script');s.id='mlsEasy4FixesLoader';s.src='feat_mls_easy_4fixes.js?v=20260623';s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLS Easy 4 fixes: dictation->record textbox, reliable Back, manual->active patient+banner+generation, prep-op-note on slide 2 */

;(function(){try{var A='feat_athena_tooltip_dedupe.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+(window.__MLS_AV||Date.now());s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

     ;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_simpleview_global.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_simpleview_global.js?v=20260625sv13';s.setAttribute('data-mls-asset','feat_mls_simpleview_global.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_viewtoggle.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_viewtoggle.js?v=20260623';s.setAttribute('data-mls-asset','feat_mls_viewtoggle.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_redesign.js"]'))return;var s=document.createElement('script');s.src='feat_mls_redesign.js?v=20260623k';s.setAttribute('data-mls-asset','feat_mls_redesign.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe 2026 reskin: additive, reversible (delete this line + feat_mls_redesign.js) */


;(function(){try{if(!document.querySelector('script[data-mls-exact-enable]')){var m=document.createElement('script');m.type='text/plain';m.src='data:,mls-connect.staging.js';m.setAttribute('data-mls-exact-enable','1');(document.head||document.documentElement).appendChild(m);}}catch(e){}})(); /* MLS prod-enable: satisfies *_exact isStaging() gate without loading the staging bundle; REVERT: delete this line + the 14 *_exact loader lines below */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_visit_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_visit_exact.js?v=20260624vx6';s.setAttribute('data-mls-asset','feat_mls_visit_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe Visit design-exact rebuild (STAGING ONLY) — additive, reversible (delete this line + feat_mls_visit_exact.js) */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_header_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_header_exact.js?v=20260630mo1';s.setAttribute('data-mls-asset','feat_mls_header_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe header/nav design-exact (STAGING ONLY) — additive, reversible (delete this line + feat_mls_header_exact.js) */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_calendar_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_calendar_exact.js?v=20260624cx8';s.setAttribute('data-mls-asset','feat_mls_calendar_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe Calendar design-exact (STAGING ONLY) — additive, reversible (delete this line + feat_mls_calendar_exact.js) */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_patients_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_patients_exact.js?v=20260624px2';s.setAttribute('data-mls-asset','feat_mls_patients_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_patients_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_history_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_history_exact.js?v=20260624hy2';s.setAttribute('data-mls-asset','feat_mls_history_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_history_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_orders_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_orders_exact.js?v=20260624ox1';s.setAttribute('data-mls-asset','feat_mls_orders_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_orders_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_recs_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_recs_exact.js?v=20260624rx1';s.setAttribute('data-mls-asset','feat_mls_recs_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_recs_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_legal_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_legal_exact.js?v=20260624lx1';s.setAttribute('data-mls-asset','feat_mls_legal_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_legal_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_team_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_team_exact.js?v=20260624tx2';s.setAttribute('data-mls-asset','feat_mls_team_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_team_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_analysis_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_analysis_exact.js?v=20260706ax7';s.setAttribute('data-mls-asset','feat_mls_analysis_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_analysis_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_studio_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_studio_exact.js?v=20260706sx5';s.setAttribute('data-mls-asset','feat_mls_studio_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_studio_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_help_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_help_exact.js?v=20260624hpx1';s.setAttribute('data-mls-asset','feat_mls_help_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_help_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_settings_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_settings_exact.js?v=20260624stx2';s.setAttribute('data-mls-asset','feat_mls_settings_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_settings_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_login_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_login_exact.js?v=20260624lgx2';s.setAttribute('data-mls-asset','feat_mls_login_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_login_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_patientpick.js"]'))return;var s=document.createElement('script');s.src='feat_mls_patientpick.js?v=20260624pick6';s.setAttribute('data-mls-asset','feat_mls_patientpick.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_patientpick.js (shared pull-and-select) — additive, reversible */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_simple_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_simple_exact.js?v=20260624simx5';s.setAttribute('data-mls-asset','feat_mls_simple_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_simple_exact.js (STAGING ONLY) — additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_notetools_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_notetools_exact.js?v=20260624nt1';s.setAttribute('data-mls-asset','feat_mls_notetools_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_notetools_exact.js (PROD) - note+tools legibility, additive, reversible */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_widgetinsert.js"]'))return;var s=document.createElement('script');s.src='feat_mls_widgetinsert.js?v=20260624wi2';s.setAttribute('data-mls-asset','feat_mls_widgetinsert.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* FIX 2: robust custom-widget Add-to-note (body/mirror fallback) + surface generated widgets (PROD) - additive, reversible */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_datalink_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_datalink_exact.js?v=20260624link2';s.setAttribute('data-mls-asset','feat_mls_datalink_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_datalink_exact.js (PROD) - cross-surface data link (picker + Patients + Calendar), additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_assistant_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_assistant_exact.js?v=20260624asst3';s.setAttribute('data-mls-asset','feat_mls_assistant_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_assistant_exact.js (PROD) - one honest assistant panel, additive reversible */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_schedimport_exact.js"]'))return;var s=document.createElement('script');s.src='feat_mls_schedimport_exact.js?v=20260624si2';s.setAttribute('data-mls-asset','feat_mls_schedimport_exact.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe feat_mls_schedimport_exact.js (PROD) - corrected schedule->calendar import */


;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_writeback_router.js"]'))return;var s=document.createElement('script');s.src='feat_mls_writeback_router.js?v=20260624wb1';s.setAttribute('data-mls-asset','feat_mls_writeback_router.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe writeback router (per-doctor adaptive location), additive reversible */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_opnote_writeback.js"]'))return;var s=document.createElement('script');s.src='feat_athena_opnote_writeback.js?v=20260624wb1';s.setAttribute('data-mls-asset','feat_athena_opnote_writeback.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe op-note writeback (PE>Procedure Documentation>template, erase+insert; never signs), additive reversible */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_simple_autosend.js"]'))return;var s=document.createElement('script');s.src='feat_mls_simple_autosend.js?v=20260624wb1';s.setAttribute('data-mls-asset','feat_mls_simple_autosend.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe Simple-view auto-send (note+codes, gated, honest), additive reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_uifix_20260624.js"]'))return;var s=document.createElement('script');s.src='feat_mls_uifix_20260624.js?v=20260624uifix1';s.setAttribute('data-mls-asset','feat_mls_uifix_20260624.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLSscribe UI fix pack (search results panel + tile tidy), additive reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_apptabs_menu.js"]'))return;var s=document.createElement('script');s.src='feat_mls_apptabs_menu.js?v=20260624tm1';s.setAttribute('data-mls-asset','feat_mls_apptabs_menu.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item3b: App-tab OFF -> Menu dropdown row (additive, reversible) */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_clinicaltools_scroll.js"]'))return;var s=document.createElement('script');s.src='feat_mls_clinicaltools_scroll.js?v=20260625cts2';s.setAttribute('data-mls-asset','feat_mls_clinicaltools_scroll.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item4: Clinical tools auto-scroll (additive, reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_voice_commands.js"]'))return;var s=document.createElement('script');s.src='feat_mls_voice_commands.js?v=20260625vc1';s.setAttribute('data-mls-asset','feat_mls_voice_commands.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item5: Alexa-style voice commands (additive, reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_chartautofill.js"]'))return;var s=document.createElement('script');s.src='feat_mls_chartautofill.js?v=20260625cf1';s.setAttribute('data-mls-asset','feat_mls_chartautofill.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item6: auto-fill patient name from open athenaOne chart (read-only, additive, reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_login_clean.js"]'))return;var s=document.createElement('script');s.src='feat_mls_login_clean.js?v=20260625lc2';s.setAttribute('data-mls-asset','feat_mls_login_clean.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item7: login shows only login UI (gate app chrome pre-login, additive reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_timeline_sync.js"]'))return;var s=document.createElement('script');s.src='feat_mls_timeline_sync.js?v=20260625tl1';s.setAttribute('data-mls-asset','feat_mls_timeline_sync.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item8: visit timeline includes visits referenced in the summary (additive reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_calbox_uniform.js"]'))return;var s=document.createElement('script');s.src='feat_mls_calbox_uniform.js?v=20260625cb1';s.setAttribute('data-mls-asset','feat_mls_calbox_uniform.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item9: uniform blue calendar Week/Day appt boxes (additive reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_gen_speed.js"]'))return;var s=document.createElement('script');s.src='feat_mls_gen_speed.js?v=20260625gs1';s.setAttribute('data-mls-asset','feat_mls_gen_speed.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item10: keep backend warm to cut op-note cold-start latency (additive reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_nextup_controls.js"]'))return;var s=document.createElement('script');s.src='feat_mls_nextup_controls.js?v=20260625nu1';s.setAttribute('data-mls-asset','feat_mls_nextup_controls.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item11: remove redundant white Complex picker list; add Today/any-day/Show-more to blue NEXT UP (additive, reversible) */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_glitch_sweep.js"]'))return;var s=document.createElement('script');s.src='feat_mls_glitch_sweep.js?v=20260625gsweep1';s.setAttribute('data-mls-asset','feat_mls_glitch_sweep.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item12: glitch sweep -- Analysis scroll-keep + tile tidy, copilot scroll stability, Find-anything reopen (additive, reversible) */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_offtab_navhide.js"]'))return;var s=document.createElement('script');s.src='feat_mls_offtab_navhide.js?v=20260625oth1';s.setAttribute('data-mls-asset','feat_mls_offtab_navhide.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item13: off App-tabs disappear from nav (kept in Menu) -- 6b nav half (additive, reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_opnote_fillblank.js"]'))return;var s=document.createElement('script');s.src='feat_mls_opnote_fillblank.js?v=20260625of1';s.setAttribute('data-mls-asset','feat_mls_opnote_fillblank.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item14: restore one-click fill-in-the-blank op note (additive, reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_baricon.js"]'))return;var s=document.createElement('script');s.src='feat_mls_baricon.js?v=20260625bi1';s.setAttribute('data-mls-asset','feat_mls_baricon.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item15: patient-bar Chart/Visit/History/Schedule -> icons (additive, reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_history_avs.js"]'))return;var s=document.createElement('script');s.src='feat_mls_history_avs.js?v=20260625havs1';s.setAttribute('data-mls-asset','feat_mls_history_avs.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item16: After-visit summary trigger added to History view (additive, reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_visit_timeline_detail.js"]'))return;var s=document.createElement('script');s.src='feat_mls_visit_timeline_detail.js?v=20260625vtd1';s.setAttribute('data-mls-asset','feat_mls_visit_timeline_detail.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item17: Visit-timeline rows open the real per-visit detail (additive, reversible) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_schedpull_fix.js"]'))return;var s=document.createElement('script');s.src='feat_mls_schedpull_fix.js?v=20260625spf1';s.setAttribute('data-mls-asset','feat_mls_schedpull_fix.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item18: ONE-day-in/one-day-out per-doctor schedule pull (structured day-grid rows; one honest status) -- additive, reversible */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_asst_fix.js"]'))return;var s=document.createElement('script');s.src='feat_mls_asst_fix.js?v=20260625afx2';s.setAttribute('data-mls-asset','feat_mls_asst_fix.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item19: MLS Assistant fixes (honest real-time status, Open athenaOne button, context-aware chat intents, FAB overlap, dynamic provider picker, in-flight read honesty) -- additive, reversible (window.__mlsAsstFix.revert()) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_status_unify.js"]'))return;var s=document.createElement('script');s.src='feat_athena_status_unify.js?v=20260625su1';s.setAttribute('data-mls-asset','feat_athena_status_unify.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item20: ONE unified, honest Athena status system (single source of truth: connection from __mlsConnTruth, one in-flight progress, one result; suppress contradictory/duplicate lines; always-preserve DOB) -- additive, reversible (window.__mlsAthenaStatusUnify.revert()) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_checker.js"]'))return;var s=document.createElement('script');s.src='feat_mls_checker.js?v=20260625chk1';s.setAttribute('data-mls-asset','feat_mls_checker.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item21: MLS Checker -- honest self-diagnostic registry of named checks (pass/fail + code + cause + fix) surfaced in the MLS Assistant -- additive, reversible (window.__mlsChecker.revert()) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_upnow_sync.js"]'))return;var s=document.createElement('script');s.src='feat_mls_upnow_sync.js?v=20260625uns3';s.setAttribute('data-mls-asset','feat_mls_upnow_sync.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item22: sync top active patient/banner with NEXT UP "UP NOW" highlight (one source of truth) -- additive, reversible (window.__mlsUpNowSync.revert()) */

;(function(){try{var A='feat_mls_voice_ai.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260625a';s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* MLS — voice AI command layer: speech/NL -> chained intents -> existing app fns (additive, reversible: window.__mlsVoiceAI.revert()) */

;(function(){try{var A='feat_mls_voice_ai_micbridge.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260625mb1';s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item24: bridge existing mic transcripts into __mlsVoiceAI for chained natural-language commands (additive, reversible: window.__mlsVoiceMicBridge.revert()) */

;(function(){try{var A='feat_mls_upnow_activeselect.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260625uas2';s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item25: align active patient with auto-pulled up-now patient on load so header/Outcomes/After-visit match the banner/NEXT UP highlight (guarded: skips during capture/recording and deliberate chart switch) -- additive, reversible (window.__mlsUpNowActiveSelect.revert()) */

;(function(){try{var A='feat_mls_nextup_autoscroll.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260625nas2';s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item26: auto-scroll the NEXT UP / today-patients picker (mlspk) to the current-time patient on load and advance as time passes (additive, reversible: window.__mlsNextUpAutoScroll.revert()) */

;(function(){try{var A='feat_mls_active_patient_sync.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260625aps1';s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item27: keep the active patient consistent across surfaces - sync hero Patient name (#heroPtName) + Patient label (#patientLabel) to activePatient() on every switch path, not just the NEXT UP picker (additive, reversible: window.__mlsActivePtSync.revert()) */

;(function(){try{var A='feat_mls_athena_chip_conn.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260625acc1';s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item30: unify context-bar Athena chip with the connection source of truth (__mlsConnTruth) -- idle chip shows honest connected/not-connected instead of bare "idle" -- additive, reversible (window.__mlsAthenaChipConn.revert()) */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_athena_chip_conn_all.js"]'))return;var s=document.createElement('script');s.src='feat_mls_athena_chip_conn_all.js?v=20260625acca1';s.setAttribute('data-mls-asset','feat_mls_athena_chip_conn_all.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item31: extend item30 -- Athena context-bar chip honours __mlsConnTruth in the non-idle "synced" state too, so the chip says the same honest connected/not-connected on every tab (additive, reversible: window.__mlsAthenaChipConnAll.revert()) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_lastseen_unify.js"]'))return;var s=document.createElement('script');s.src='feat_mls_lastseen_unify.js?v=20260625ls1';s.setAttribute('data-mls-asset','feat_mls_lastseen_unify.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item32: unify context-bar "last <date>" -> "last seen <date>" to match patient quick-history/profile/face surfaces (one consistent last-visit label) -- additive, reversible (window.__mlsLastSeenUnify.revert()) */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_lastseen_rows.js"]'))return;var s=document.createElement('script');s.src='feat_mls_lastseen_rows.js?v=20260625lsr1';s.setAttribute('data-mls-asset','feat_mls_lastseen_rows.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item33: unify Patients-list row last-visit chip ("Seen M/D/YYYY") to the canonical "last seen <Mon D, YYYY>" wording+format used by the context bar (item32), profile chips and quick-history (one consistent last-seen label everywhere) -- additive, reversible (window.__mlsLastSeenRows.revert()) */

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_avs_label_unify.js"]'))return;var s=document.createElement('script');s.src='feat_mls_avs_label_unify.js?v=20260625avslbl1';s.setAttribute('data-mls-asset','feat_mls_avs_label_unify.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item34: unify the "After-visit summary" action name across all trigger surfaces (#mlsavsBtn, #mlsHistAvsBtn, #avsBtn) -- one canonical name, icons preserved -- additive, reversible (window.__mlsAvsLabelUnify.revert()) */
;(function(){try{var A='feat_mls_ctxbar_dob_slash.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260626cds1';s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item35: unify the patient context-bar DOB to the canonical MM/DD/YYYY slash format (matches DOB input, profile cards, scheduler cards & timeline) -- removes the lone dash-format outlier in #mlsCtxBar .mlsctx-meta -- additive, reversible (window.__mlsCtxDobSlash.revert()) */
;(function(){try{var A='feat_mls_chartautofill_guard.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v=20260626cfg2';s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item36: harden chart-autofill -- never fill visit name/label with junk scraped from a non-chart (sign-in/dashboard) athenaOne tab; scrub junk already filled (additive, reversible: window.__mlsChartFillGuard.revert()) */
;(function(){try{var A="feat_mls_schedpull_honest.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260626honest1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item28: kill residual false "No new appointments were imported..." status line (honest status only) -- additive, reversible (window.__mlsSchedPullHonest.revert()) */

;(function(){try{var A="feat_mls_asst_provname.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260626pn1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item37: MLS Assistant doctor-picker shows REAL providers in clean human form ("Kelly Carter, PA-C") instead of raw athenaOne machine usernames ("Carter_Kelly_PA-C"); option.value preserved so schedule pulls are unchanged -- additive, reversible (window.__mlsAsstProvName.revert()) */
;(function(){try{var A="feat_mls_dob_format_unify.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260626dob1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item38: unify displayed patient DOB format to canonical MM/DD/YYYY across all card surfaces (picker/assistant/simple/profile/scheduler/timeline) to match context-bar item35; normalizes dash & ISO stored dobs display-only, no patient-data mutation -- additive, reversible (window.__mlsDobFormatUnify.revert()) */

;(function(){try{var A="feat_mls_calendar_polish.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260629cp2";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item67: calendar polish -- cleaner Month/Week/Day nav, clickable providers roster, honest empty states (additive, reversible: window.__mlsCalPolish.revert()) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_legal_paywidget.js"]'))return;var s=document.createElement('script');s.src='feat_mls_legal_paywidget.js?v=20260629a';s.setAttribute('data-mls-asset','feat_mls_legal_paywidget.js');s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{var A="feat_mls_caldedupe_render.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260629dd1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item68: calendar/agenda duplicate-appointment fix -- idempotent read-layer dedupe of window._calAppts by stable identity (name|date|time|provider) before each render; display-only, never deletes records (additive, reversible: window.__mlsCalDedupe.revert()) */

;(function(){try{var A="feat_mls_expert_top.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630et1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item75: Expert marketplace listing -> first card at top of Legal requests view (#expertCard moved to top of #legalReqView; moves existing node so the opt-in form travels with it; idempotent, additive, reversible: window.__mlsExpertTop.revert()) */

;/* === item69,70,72,73,77,78 promoted staging->prod 2026-06-30 (item74 snapshot & item76 allergy SKIPPED: already present in prod, no duplicates) === */
;(function(){try{var A="feat_mls_outcome_pdf.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260629os1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item69 (STAGING): Outcome Study report exports -- multi-page PDF report + standalone SVG chart download added to the existing Outcome Study results panel (sources live rendered cohort data; athenaOne untouched; never writes/deletes records) -- additive, reversible: window.__mlsOutcomePdf.revert() */
;(function(){try{var A="feat_mls_pervisit_unify.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260629pvu1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item70: unify copy-every-visit + per-visit records into one coherent timeline/detail surface + verify single model; additive, reversible: window.__mlsPerVisitUnify.revert() */
;(function(){try{var A="feat_mls_dayprogress.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630dp1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item72 (STAGING): Day Progress meter in the persistent patient bar -- seen X/Y today + Next-up patient (one shared schedule/seen/now source of truth, click reuses _heroPickPatient), visible on every clinical view (additive, reversible: window.__mlsDayProgress.revert()) */
;(function(){try{var A="feat_mls_recentpts.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630rp1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item73 (STAGING): Recent-patients one-click quick-switcher in the patient bar -- jump back to the last charts opened this session via the app's own setActivePtId path (additive, reversible: window.__mlsRecentPts.revert()) */
;(function(){try{var A="feat_mls_agenda_popover.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630ag1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item77 (STAGING): Today's agenda popover in the patient bar -- full ordered schedule (seen/up-now/upcoming) sharing Day-Progress's source of truth; click a row to load that patient via _heroPickPatient; navigation-only (additive, reversible: window.__mlsAgenda.revert()) */
;(function(){try{var A="feat_mls_visit_useactivept.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630ua2";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item78 (STAGING): "Use current patient" autofill on the Visit hero -- one click fills name+DOB+de-identified label from the active patient (no auto-submit, no record writes) (additive, reversible: window.__mlsUseActivePt.revert()) */
;(function(){try{var A="feat_mls_find_doctors.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630fd1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: Find Doctors button + provider picker (additive, reversible: window.__mlsFindDoctors) */
;(function(){try{var A="feat_mls_whosnext.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260706wn5";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: Who's-Next framework (additive, reversible: window.__mlsWhosNext) */
;(function(){try{var A="feat_mls_wb_console.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630wbc1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: writeback console "change where things go" button (additive, reversible: window.__mlsWbConsole) */
;(function(){try{var A="feat_mls_settings_wb.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630swb1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: Settings writeback entry (additive, reversible: window.__mlsSettingsWb) */
;(function(){try{var A="feat_mls_assistant_selffix.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630asf1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: Assistant self-diagnose/fix (additive, reversible: window.__mlsAssistantSelfFix) */
;(function(){try{var A="feat_mls_whosnext_cleanfix.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630wncf1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: Who's-Next styling cleanfix - nice blue .wn-* boxes (item60 regression fix; additive, reversible: window.__mlsWhosNextCleanFix) */
;(function(){try{var A="feat_mls_appwidth_responsive.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630aw1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: full-width/responsive calendar+app layout (additive, reversible: window.__mlsAppWidth) */
;(function(){try{var A="feat_mls_note_metrics.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630nm1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: note metrics meter (window.__mlsNoteMetrics) */
;(function(){try{var A="feat_mls_note_autofit.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630na1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: generated-note auto-fit (window.__mlsNoteAutofit) */
;(function(){try{var A="feat_mls_note_jump.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630nj1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: note section quick-jump (window.__mlsNoteJump) */
;(function(){try{var A="feat_mls_visit_stepper.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630vs1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: visit flow stepper (window.__mlsVisitStepper) */
;(function(){try{var A="feat_mls_visit_stepper_orderfix.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630vso1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: visit stepper order fix (window.__mlsVisitStepperOrderFix) */
;(function(){try{var A="feat_mls_patient_age.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630pa1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: patient age chip (window.__mlsPatientAge) */
;(function(){try{var A="feat_mls_patient_snapshot.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630ps1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: patient snapshot popover (window.__mlsPatientSnapshot) */
;(function(){try{var A="feat_mls_ctxbar_age_dedupe.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630cad1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: context-bar age de-dup (window.__mlsCtxbarAgeDedupe) */
;(function(){try{var A="feat_mls_ctx_appt.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630ca1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: context-bar appointment (window.__mlsCtxAppt) */
;(function(){try{var A="feat_mls_hero_search.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630hs1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: hero search (window.__mlsHeroSearch) */
;(function(){try{var A="feat_mls_hero_glance.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630hg1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: hero glance (window.__mlsHeroGlance) */
;(function(){try{var A="feat_mls_pick_smartscope.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630pss1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: picker smart scope (window.__mlsPickSmartScope) */
;(function(){try{var A="feat_mls_keyboard_layer.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630kl1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: unified keyboard layer (window.__mlsKbd) */
;(function(){try{var A="feat_mls_dotphrase_keys.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630dk1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: dot-phrase keyboard shortcuts (window.__mlsDotKeys) */
;(function(){try{var A="feat_mls_allergy_strip.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630as1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: allergy safety strip (window.__mlsAllergyStrip) */
;(function(){try{var A="feat_mls_legal_pay_setup.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630lps1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: legal Stripe pay setup (window.__mlsLegalPaySetup) */
;(function(){try{var A="feat_mls_studygroups.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630sg1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: study groups (window.__mlsStudyGroups) */
;(function(){try{var A="feat_mls_show_assistant.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630sa1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: show MLS assistant entry (window.__mlsShowAsst) */
;(function(){try{var A="feat_mls_stop_confirm.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260630sc1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* restore loader: stop-recording confirm popup (window.__mlsStopConfirm) */

/* ============================================================================
   FIX (additive, reversible): bridge Find Doctors selection -> Who's Next.
   feat_mls_find_doctors.js records the picked provider in __mlsFindDoctors.chosen
   and scopes the next athenaOne pull, but never tells Who's Next to re-render.
   feat_mls_whosnext.js ALREADY scopes its boxes to __mlsFindDoctors.chosen (via
   matchesDoctor) and ALREADY shows an honest empty-state -- but only when it is
   (re)rendered. This watches __mlsFindDoctors.chosen and calls
   __mlsWhosNext.reapply() on change, so picking a doctor immediately shows ONLY
   that doctor's patients (once records carry a provider) or the honest empty-state.
   Touches no loader. Adds no UI. Idempotent. Reversible: __mlsDocPickBridge.revert().
   ============================================================================ */
(function () {
  if (window.__mlsDocPickBridge) return;
  window.__mlsDocPickBridge = { installed: true, version: 1 };
  function key(c) { try { return c ? (c.raw || c.name || "") : ""; } catch (e) { return ""; } }
  var last;
  function tick() {
    try {
      var fd = window.__mlsFindDoctors, wn = window.__mlsWhosNext;
      if (!fd || !wn || typeof wn.reapply !== "function") return;
      var k = key(fd.chosen);
      if (k !== last) { last = k; try { wn.reapply(); } catch (e) {} }
    } catch (e) {}
  }
  var iv = setInterval(tick, 500);
  window.__mlsDocPickBridge.stop = function () { clearInterval(iv); };
  window.__mlsDocPickBridge.revert = window.__mlsDocPickBridge.stop;
  tick();
})();

/* ============================================================================
   FIX (additive, reversible): hide the duplicate GENERIC-names provider card on
   the calendar left rail. feat_mls_calendar_exact.js renders
   #calendarView .cx-card.cx-prov (the cx-prov-list) with generic provider names,
   duplicating the REAL-names roster from calendar_polish (item67). This hides
   ONLY that duplicate card via CSS; the real-names roster + click-to-filter stay,
   the calendar grid and full-width (appwidth) are untouched.
   Reversible: window.__mlsCalProvDupHide.revert().
   ============================================================================ */
(function () {
  if (window.__mlsCalProvDupHide) return;
  var ID = "mls-cal-prov-dup-hide";
  function inject() {
    if (document.getElementById(ID)) return;
    var st = document.createElement("style");
    st.id = ID;
    st.textContent = "#calendarView .cx-card.cx-prov{display:none !important;}";
    (document.head || document.documentElement).appendChild(st);
  }
  inject();
  window.__mlsCalProvDupHide = {
    installed: true, version: 1,
    revert: function () { var s = document.getElementById(ID); if (s) s.remove(); window.__mlsCalProvDupHide.installed = false; }
  };
})();

;/* === item: DOB-sync on patient switch (additive, reversible: window.__mlsDobSync.revert()) ===
   Fix: openPatient/setActivePtId updated the active patient + name but never re-synced the hero
   "Date of birth" field (#heroPtDob), leaving the previously selected patient's DOB shown next to
   the new patient's name (patient-safety: wrong DOB). Re-syncs DOB on every active-patient change;
   blanks it when the new patient has no DOB; never stale. Idempotent. Drops/reorders no loaders. */
(function(){
  if (window.__mlsDobSync && window.__mlsDobSync.installed) return;
  var orig = {};
  function activeDob(){
    try {
      var id = (typeof getActivePtId === 'function') ? getActivePtId() : null;
      if (!id) return null;
      var ps = (typeof getPatients === 'function') ? getPatients() : [];
      for (var i = 0; i < ps.length; i++){ if (ps[i] && ps[i].id === id){ return (ps[i].dob == null ? '' : String(ps[i].dob)); } }
    } catch(e){}
    return null;
  }
  function syncDob(){
    try {
      var d = activeDob(); if (d === null) return;
      var el = document.getElementById('heroPtDob'); if (!el) return;
      if ((el.value || '') === d) return;
      el.value = d;
      try { el.dispatchEvent(new Event('input',  { bubbles:true })); } catch(e){}
      try { el.dispatchEvent(new Event('change', { bubbles:true })); } catch(e){}
    } catch(e){}
  }
  function wrap(name){
    if (typeof window[name] !== 'function') return;
    if (window[name].__mlsDobWrapped) return;
    var o = window[name]; orig[name] = o;
    var w = function(){ var r = o.apply(this, arguments); try { setTimeout(syncDob, 0); } catch(e){ syncDob(); } return r; };
    w.__mlsDobWrapped = true; window[name] = w;
  }
  function install(){ wrap('openPatient'); wrap('setActivePtId'); try { setTimeout(syncDob, 0); } catch(e){} }
  try { document.addEventListener('mls:patientpicked', function(){ setTimeout(syncDob, 0); }); } catch(e){}
  window.__mlsDobSync = {
    installed: true, version: '1', sync: syncDob,
    revert: function(){ try { for (var k in orig){ if (window[k] && window[k].__mlsDobWrapped){ window[k] = orig[k]; } } } catch(e){} this.installed = false; }
  };
  try { install(); } catch(e){}
  try { setTimeout(install, 0); } catch(e){}
  try { setTimeout(install, 1500); } catch(e){}
  try { window.addEventListener('load', install); } catch(e){}
})();
(function(){try{var s=document.createElement('script');s.src='feat_mls_force_full_phone.js?v=20260630';s.defer=true;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

/* item68: restore WIDE calendar layout (appwidth_responsive complement for #calendarView) + honest, ACTIONABLE per-provider empty state. Additive, reversible, guarded; never modifies app fns, never reorders/drops loaders, never touches data. Root cause: appointments carry no provider/doctor_user_id (backend does not persist provider), so the per-provider filter matches nothing. Revert: window.__mlsCalWideHonest.revert() */ ;(function(){ 'use strict'; if (window.__mlsCalWideHonest) return; var API = { version:'cwh-1.0.0' }; var WIDTH_ID='__mlsCalWideHonestCss', ACT_CSS_ID='__mlsCalEmptyActionsCss', ACT_ID='mlsCalEmptyActions'; function $(id){ try{ return document.getElementById(id); }catch(e){ return null; } } function injectWidthCss(){ if ($(WIDTH_ID)) return; try{ var st=document.createElement('style'); st.id=WIDTH_ID; st.textContent='#appWrap.wrap:has(#calendarView[style*="block"]){max-width:min(1680px,95vw)!important;}'; (document.head||document.documentElement).appendChild(st); }catch(e){} } function injectActCss(){ if ($(ACT_CSS_ID)) return; try{ var s=document.createElement('style'); s.id=ACT_CSS_ID; s.textContent='.mlsCalEmptyActions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}' +'.mlsCalEmptyBtn{font:inherit;font-size:13px;padding:7px 13px;border-radius:8px;border:1px solid rgba(120,140,170,.35);background:rgba(255,255,255,.06);color:inherit;cursor:pointer;line-height:1.2}' +'.mlsCalEmptyBtn.primary{background:#2563eb;border-color:#2563eb;color:#fff}' +'.mlsCalEmptyBtn:hover{filter:brightness(1.08)}'; (document.head||document.documentElement).appendChild(s); }catch(e){} } function showAll(){ try{ var chip=document.querySelector('#mlsCalRoster .mlsRosChip[data-prov=""]'); if(chip){ chip.click(); return; } var pf=$('calProvFilter'); if(pf){ pf.value=''; pf.dispatchEvent(new Event('change',{bubbles:true})); } }catch(e){} } function enhanceEmpty(){ try{ var box=$('mlsCalEmpty'); if(!box) return; if(box.querySelector('#'+ACT_ID)) return; var pf=$('calProvFilter'); var pfVal=pf?String(pf.value||''):''; if(!pfVal) return; injectActCss(); var bar=document.createElement('div'); bar.id=ACT_ID; bar.className='mlsCalEmptyActions'; var b1=document.createElement('button'); b1.type='button'; b1.className='mlsCalEmptyBtn primary'; b1.textContent='Show full schedule (All providers)'; b1.onclick=function(){ showAll(); }; bar.appendChild(b1); if(typeof window.pullScheduleViaAssist==='function'){ var b2=document.createElement('button'); b2.type='button'; b2.className='mlsCalEmptyBtn'; b2.textContent='Pull this schedule from athenaOne →'; b2.title='Read-only athenaOne pull. Patients link to a doctor only once the provider is stored on each appointment.'; b2.onclick=function(){ try{ window.pullScheduleViaAssist(); }catch(e){} }; bar.appendChild(b2); } box.appendChild(bar); }catch(e){} } var _t=null; function tick(){ injectWidthCss(); enhanceEmpty(); } function schedule(){ if(_t) return; _t=setTimeout(function(){ _t=null; tick(); },120); } var mo=null, iv=null; function start(){ tick(); try{ mo=new MutationObserver(schedule); mo.observe(document.body,{childList:true,subtree:true}); }catch(e){} try{ iv=setInterval(tick,2000); }catch(e){} } API.revert=function(){ try{ if(mo) mo.disconnect(); }catch(e){} try{ if(iv) clearInterval(iv); }catch(e){} [WIDTH_ID,ACT_CSS_ID].forEach(function(id){ var el=$(id); if(el&&el.parentNode) el.parentNode.removeChild(el); }); var b=$(ACT_ID); if(b&&b.parentNode) b.parentNode.removeChild(b); }; window.__mlsCalWideHonest=API; if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start); else start(); })();


/* ============================================================
 * nav-reorg (nr-1.0.0)   [additive / reversible / idempotent]
 * Relocates three top-nav tabs into the existing "Menu" dropdown
 * (#mlsTbMenuPanel) and moves Analysis to the right-hand cluster
 * next to AI Studio. Cooperates with feat_mls_apptabs_menu: it
 * reuses that module's menu rows when present, and only adds a
 * matching .mlsTbItem proxy row when one is absent. Moves are
 * non-destructive (real tab nodes are kept + their click handlers
 * preserved); the bar copies are merely hidden. Re-asserts on an
 * interval like the app's sibling feat_* modules.
 *
 * Reverse: delete this IIFE. (On a live page also remove
 * #mlsNavReorgCSS, the .mls-navreorg-off class on the three tabs,
 * and any #mlsNavRow_* buttons.)
 * ============================================================ */
(function () {
  'use strict';
  if (window.__mlsNavReorg) return;
  window.__mlsNavReorg = true;

  var INTO_MENU = ['recs', 'legalreq', 'team'];
  var META = {
    recs:     { label: 'Recommendations', icon: '💡' }, /* light bulb */
    legalreq: { label: 'Legal requests',  icon: '⚖️' }, /* scales */
    team:     { label: 'Team',            icon: '👥' }  /* people */
  };

  /* additive stylesheet: hide relocated bar copies + keep menu rows tidy/centered */
  (function css() {
    if (document.getElementById('mlsNavReorgCSS')) return;
    var s = document.createElement('style');
    s.id = 'mlsNavReorgCSS';
    s.textContent =
      '#mlsRdNav .navtab.mls-navreorg-off{display:none !important;}' +
      '.mainnav .navtab.mls-navreorg-off{display:none !important;}' +
      '.mls-navreorg-off{display:none !important;}' +
      '#mlsTbMenuPanel .mlsTbItem{justify-content:center;text-align:center;}';
    (document.head || document.documentElement).appendChild(s);
  })();

  function closeMenu() {
    var p = document.getElementById('mlsTbMenuPanel');
    if (p) p.classList.remove('open');
  }

  function ensureRow(key) {
    var panel = document.getElementById('mlsTbMenuPanel');
    var real  = document.getElementById('nav_' + key);
    if (!panel || !real) return;
    var mine   = document.getElementById('mlsNavRow_' + key);
    var theirs = document.getElementById('mlsTabMenuRow_' + key);
    if (theirs) { if (mine) mine.remove(); return; }
    if (mine) return;
    var m = META[key] || { label: (real.textContent || '').trim(), icon: '' };
    var b = document.createElement('button');
    b.type = 'button';
    b.id = 'mlsNavRow_' + key;
    b.className = 'mlsTbItem';
    b.innerHTML = '<span style="margin-right:6px">' + m.icon + '</span>' + m.label;
    b.addEventListener('click', function () {
      var t = document.getElementById('nav_' + key);
      if (t) t.click();
      closeMenu();
    });
    panel.appendChild(b);
  }

  function reorg() {
    var nav = document.querySelector('.mainnav');
    if (!nav) return;
    INTO_MENU.forEach(function (key) {
      var real = document.getElementById('nav_' + key);
      if (real) {
        if (real.style.display !== 'none') real.style.display = 'none';
        if (!real.classList.contains('mls-navreorg-off'))
          real.classList.add('mls-navreorg-off');
      }
      ensureRow(key);
    });
    var a = document.getElementById('nav_analysis');
    var s = document.getElementById('nav_studio');
    if (a && s && s.parentNode && a.nextElementSibling !== s) {
      s.parentNode.insertBefore(a, s);
    }
  }

  function boot() { try { reorg(); } catch (e) {} }
  boot();
  [200, 600, 1500, 3000].forEach(function (d) { setTimeout(boot, d); });
  setInterval(boot, 900);
})();

;/* ============================================================
   MLS Guided Tour  —  window.__mlsTour  (revert: window.__mlsTour.revert())
   Additive, self-contained, reversible. Old-doctor-friendly How-To walkthrough.
   ============================================================ */
(function(){
  if (window.__mlsTour && window.__mlsTour.__live) return;
  var SEEN_KEY = "mls_tour_seen_v1";
  var Z = 2147483000;
  var els = {};
  var idx = 0, steps = [], typingTimer = null, moTimer = null;

  function buildSteps(){
    return [
      { center:true, title:"Welcome to MLS \u{1F44B}",
        body:"This is your AI scribe. In about a minute I’ll show you the few buttons you’ll actually use. You can stop any time — nothing here changes a patient’s record." },
      { sel:"#heroPtName, #ptSearch", title:"1. Choose the patient",
        body:"Everything starts here. Type the patient’s name (and date of birth just beside it). That’s all the computer needs to begin." },
      { sel:"#heroRecBtn", title:"2. Press record, then just talk",
        body:"Press this one button and have your normal visit — talk to the patient like always. MLS quietly listens in the background. No typing for you." },
      { sel:"#phoneMicBtn", title:"3. No computer at the bedside? Use your phone",
        body:"Tap here and a small square code appears on screen. Point your phone’s camera at it, and your phone becomes the microphone. Walk in and talk — the computer still hears the visit." },
      { center:true, demo:true, title:"4. Now watch the computer write the note ✨",
        body:"Here’s the part most doctors have never seen: you spoke, and MLS writes the whole note for you. Here is a sample it just wrote from a practice visit —" },
      { sel:"#mlsTbMenuBtn", title:"5. Little AI helpers",
        body:"Inside this Menu are small AI helpers. “✦ Ask” lets you ask MLS a question about the visit, and other helpers can tidy or add to the note — all optional." },
      { center:true, title:"6. You are always the final word",
        body:"MLS only drafts. You read it, change anything you like, and nothing is filed until you approve it. The doctor stays in charge, every single time." },
      { sel:"#nav_calendar", title:"7. Your day’s schedule",
        body:"Your appointments for the day live here, so you always know who’s coming next." },
      { sel:"#nav_patients", title:"8. Past visits are saved here",
        body:"Every patient and their previous notes are kept here. You can look back at any earlier visit whenever you need to." },
      { sel:"#nav_help", title:"9. Help is always here",
        body:"If you ever feel stuck, this Help button is always waiting for you." },
      { center:true, title:"You’re ready — that’s the whole thing ✅",
        body:"Pick a patient, press record, talk, and let MLS write it up. Want to see this tour again? Open the Menu and choose “How-To Guide” any time." }
    ];
  }

  function injectStyle(){
    var st = document.createElement("style"); st.id = "mlsTourStyle";
    st.textContent =
      "#mlsTourRoot{position:fixed;inset:0;z-index:"+Z+";font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}"+
      "#mlsTourCatch{position:fixed;inset:0;background:transparent;}"+
      ".mlsTourSpot{position:fixed;border-radius:12px;box-shadow:0 0 0 9999px rgba(15,23,42,.66);border:3px solid #38bdf8;transition:all .2s ease;pointer-events:none;}"+
      ".mlsTourDim{position:fixed;inset:0;background:rgba(15,23,42,.66);}"+
      ".mlsTourCard{position:fixed;max-width:430px;width:calc(100vw - 40px);background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:24px 24px 18px;box-sizing:border-box;}"+
      ".mlsTourCard h3{margin:0 0 10px;font-size:22px;line-height:1.25;color:#0f172a;font-weight:700;}"+
      ".mlsTourCard p{margin:0;font-size:18px;line-height:1.5;color:#334155;}"+
      ".mlsTourSample{margin:14px 0 4px;border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;padding:12px 14px;font-size:14px;line-height:1.45;color:#0f172a;white-space:pre-wrap;max-height:230px;overflow:auto;}"+
      ".mlsTourSampleTag{display:inline-block;font-size:12px;font-weight:700;letter-spacing:.04em;color:#0369a1;background:#e0f2fe;border-radius:6px;padding:2px 8px;margin-bottom:8px;}"+
      ".mlsTourFoot{display:flex;align-items:center;gap:10px;margin-top:18px;}"+
      ".mlsTourFoot .sp{flex:1;}"+
      ".mlsTourStep{font-size:14px;color:#64748b;}"+
      ".mlsTourBtn{font-size:17px;font-weight:600;border-radius:10px;padding:11px 20px;border:0;cursor:pointer;}"+
      ".mlsTourNext{background:#0284c7;color:#fff;}"+
      ".mlsTourNext:hover{background:#0369a1;}"+
      ".mlsTourBack{background:#e2e8f0;color:#0f172a;}"+
      ".mlsTourSkip{background:transparent;color:#64748b;font-size:15px;text-decoration:underline;border:0;cursor:pointer;padding:6px;}";
    document.head.appendChild(st); els.style = st;
  }

  var SAMPLE_NOTE =
    "SAMPLE PATIENT — John Doe (demo, not a real patient)\n"+
    "Visit: Follow-up, low back pain\n\n"+
    "HPI: 58-year-old presents for follow-up of chronic low back pain, ongoing ~4 months. "+
    "Pain rated 6/10, worse with prolonged sitting, eased by walking. No new numbness, weakness, or bowel/bladder changes.\n\n"+
    "EXAM: Lumbar paraspinal tenderness, full strength in both legs, negative straight-leg raise.\n\n"+
    "ASSESSMENT: Chronic mechanical low back pain, stable.\n"+
    "PLAN: Continue home exercises; refer to physical therapy; follow up in 6 weeks.\n\n"+
    "Suggested coding:  M54.5  ·  99213";

  function resolveTarget(sel){
    if(!sel) return null;
    var parts = sel.split(",");
    for(var i=0;i<parts.length;i++){
      var e=document.querySelector(parts[i].trim());
      if(e && e.offsetParent!==null && e.getClientRects().length && e.getBoundingClientRect().width>0) return e;
    }
    return null;
  }

  function ensureRoot(){
    var r=document.getElementById("mlsTourRoot"); if(r) return r;
    r=document.createElement("div"); r.id="mlsTourRoot";
    var c=document.createElement("div"); c.id="mlsTourCatch"; r.appendChild(c);
    document.body.appendChild(r); els.root=r; return r;
  }

  function render(){
    var root=ensureRoot(); var step=steps[idx];
    root.querySelectorAll(".mlsTourSpot,.mlsTourDim,.mlsTourCard").forEach(function(n){n.remove();});
    var target = step.center ? null : resolveTarget(step.sel);
    if(target){ try{ target.scrollIntoView({block:"center",inline:"nearest"}); }catch(e){} }

    setTimeout(function(){
      var card=document.createElement("div"); card.className="mlsTourCard";
      var demoHtml = step.demo ? '<div class="mlsTourSampleTag">SAMPLE · written by MLS AI</div><div class="mlsTourSample" id="mlsTourSampleBox"></div>' : "";
      card.innerHTML =
        '<h3>'+step.title+'</h3><p>'+step.body+'</p>'+demoHtml+
        '<div class="mlsTourFoot">'+
          '<button class="mlsTourSkip" id="mlsTourSkip">Skip the tour</button>'+
          '<span class="sp"></span>'+
          '<span class="mlsTourStep">Step '+(idx+1)+' of '+steps.length+'</span>'+
          (idx>0?'<button class="mlsTourBtn mlsTourBack" id="mlsTourBack">Back</button>':'')+
          '<button class="mlsTourBtn mlsTourNext" id="mlsTourNext">'+(idx===steps.length-1?'Done':'Next')+'</button>'+
        '</div>';

      var t = step.center ? null : resolveTarget(step.sel);
      if(t){
        var rect=t.getBoundingClientRect(), pad=8;
        var spot=document.createElement("div"); spot.className="mlsTourSpot";
        spot.style.top=(rect.top-pad)+"px"; spot.style.left=(rect.left-pad)+"px";
        spot.style.width=(rect.width+pad*2)+"px"; spot.style.height=(rect.height+pad*2)+"px";
        root.appendChild(spot); root.appendChild(card);
        var cw=Math.min(430,window.innerWidth-40), ch=card.offsetHeight||220;
        var top, left=Math.min(Math.max(12,rect.left),window.innerWidth-cw-12);
        if(rect.bottom+ch+20<window.innerHeight){ top=rect.bottom+16; }
        else if(rect.top-ch-20>0){ top=rect.top-ch-16; }
        else { top=Math.max(12,(window.innerHeight-ch)/2); left=Math.min(window.innerWidth-cw-12,rect.right+16); if(left<12||left+cw>window.innerWidth) left=(window.innerWidth-cw)/2; }
        card.style.top=top+"px"; card.style.left=left+"px";
      } else {
        var dim=document.createElement("div"); dim.className="mlsTourDim";
        root.appendChild(dim); root.appendChild(card);
        card.style.top="50%"; card.style.left="50%"; card.style.transform="translate(-50%,-50%)";
      }
      card.querySelector("#mlsTourNext").onclick=next;
      var bk=card.querySelector("#mlsTourBack"); if(bk) bk.onclick=back;
      card.querySelector("#mlsTourSkip").onclick=function(){ finish(true); };
      if(step.demo) typeSample();
    }, target?170:0);
  }

  function typeSample(){
    var box=document.getElementById("mlsTourSampleBox"); if(!box) return;
    var i=0; box.textContent=""; clearInterval(typingTimer);
    typingTimer=setInterval(function(){
      box.textContent=SAMPLE_NOTE.slice(0,i); box.scrollTop=box.scrollHeight; i+=7;
      if(i>SAMPLE_NOTE.length){ box.textContent=SAMPLE_NOTE; clearInterval(typingTimer); }
    },18);
  }

  function next(){ if(idx>=steps.length-1){ finish(true); } else { idx++; render(); } }
  function back(){ if(idx>0){ idx--; render(); } }
  function finish(markSeen){ clearInterval(typingTimer); var r=document.getElementById("mlsTourRoot"); if(r) r.remove(); if(markSeen){ try{ localStorage.setItem(SEEN_KEY,"1"); }catch(e){} } }
  function start(){ idx=0; steps=buildSteps(); ensureRoot(); render(); }

  function closeAppMenu(){ try{ var p=document.getElementById("mlsTbMenuPanel"); if(p && getComputedStyle(p).display!=="none"){ document.getElementById("mlsTbMenuBtn").click(); } }catch(e){} }

  function addMenuItem(){
    var panel=document.getElementById("mlsTbMenuPanel");
    if(!panel || document.getElementById("mlsTourMenuItem")) return;
    var btn=document.createElement("button");
    btn.id="mlsTourMenuItem"; btn.className="mlsTbItem";
    btn.textContent="\u{1F4D8} How-To Guide";
    btn.onclick=function(ev){ try{ev.stopPropagation();}catch(e){} start(); closeAppMenu(); };
    var firstItem=panel.querySelector(".mlsTbItem");
    if(firstItem && firstItem.parentNode===panel){ panel.insertBefore(btn, firstItem.nextSibling); } else { panel.appendChild(btn); }
    els.menuItem=btn;
  }
  moTimer=setInterval(addMenuItem,1500); addMenuItem();

  function maybeAutoLaunch(){
    var seen; try{ seen=localStorage.getItem(SEEN_KEY); }catch(e){ seen="1"; }
    if(!seen){ setTimeout(start,1200); }
  }
  if(document.readyState==="complete") maybeAutoLaunch(); else window.addEventListener("load",maybeAutoLaunch);

  window.__mlsTour={
    __live:true, start:start, open:start, finish:finish,
    seen:function(){ try{return !!localStorage.getItem(SEEN_KEY);}catch(e){return true;} },
    reset:function(){ try{localStorage.removeItem(SEEN_KEY);}catch(e){} },
    revert:function(){
      try{clearInterval(moTimer);}catch(e){} try{clearInterval(typingTimer);}catch(e){}
      try{document.getElementById("mlsTourRoot")?.remove();}catch(e){}
      try{document.getElementById("mlsTourStyle")?.remove();}catch(e){}
      try{document.getElementById("mlsTourMenuItem")?.remove();}catch(e){}
      try{delete window.__mlsTour;}catch(e){ window.__mlsTour=undefined; }
      return "MLS guided tour reverted.";
    }
  };
  injectStyle();
})();
;/* =========================================================
   MLS Guided Tour v2 — EXPANDED interactive walkthrough
   window.__mlsTour  (revert: window.__mlsTour.revert())
   Additive. Supersedes the v1 How-To tour. Self-cleaning,
   fully reversible. Drives the app's OWN nav/views but only
   ever touches a clearly-labeled SAMPLE patient/widget and
   snapshots+restores so nothing sticks. No real Athena write,
   no real generation, no real PHI. Old-doctor-friendly.
   ============================================================ */
(function () {
  'use strict';
  if (window.__mlsTour && window.__mlsTour.__v2) return; // already installed

  var SEEN_V1  = "mls_tour_seen_v1";
  var SEEN_KEY = "mls_tour_seen_v2";
  var Z = 2147483000;
  var idx = 0, steps = [], typingTimer = null, menuTimer = null;
  var snap = null;

  /* ---- Suppress + tear down the old v1 tour if it is present ---- */
  try { localStorage.setItem(SEEN_V1, "1"); } catch (e) {}      // stop v1 auto-launch
  try {
    if (window.__mlsTour && typeof window.__mlsTour.revert === "function" && !window.__mlsTour.__v2) {
      window.__mlsTour.revert();   // removes v1 root/style/menu item + clears v1 timers
    }
  } catch (e) {}

  /* ---- tiny helpers ---- */
  function $(id) { return document.getElementById(id); }
  function q(sel) { try { return document.querySelector(sel); } catch (e) { return null; } }
  function viewKey() {
    var v = Array.prototype.slice.call(document.querySelectorAll('[id$="View"]'))
      .filter(function (e) { try { return getComputedStyle(e).display !== "none"; } catch (_) { return false; } })[0];
    return v ? v.id.replace(/View$/, "").toLowerCase() : "visit";
  }
  function go(key) { try { if (typeof window.showView === "function") window.showView(key); } catch (e) {} }

  /* ---- SAMPLE-only demo injectors (every one is reversible) ---- */
  var SAMPLE_LABEL = "Sample Patient — John Doe";

  function pullFillDemo() {
    var box = $("heroPtName");
    if (box && box.getAttribute("data-mlsTourPrev") === null) {
      box.setAttribute("data-mlsTourPrev", box.value || "");
      box.value = "John Doe (SAMPLE)";
    }
  }
  function pullFillUndo() {
    var box = $("heroPtName");
    if (box && box.getAttribute("data-mlsTourPrev") !== null) {
      box.value = box.getAttribute("data-mlsTourPrev");
      box.removeAttribute("data-mlsTourPrev");
    }
  }
  function topSyncDemo() {
    var host = $("mlsRecentPts") || $("mlsCtxBar");
    if (host && !$("mlsTourSampleChip")) {
      var chip = document.createElement("span");
      chip.id = "mlsTourSampleChip";
      chip.textContent = "\u{1F464} " + SAMPLE_LABEL;
      chip.style.cssText = "display:inline-flex;align-items:center;gap:6px;background:#e0f2fe;color:#0369a1;border:1px solid #38bdf8;border-radius:999px;padding:3px 10px;font-size:13px;font-weight:700;margin:0 4px;white-space:nowrap;";
      host.insertBefore(chip, host.firstChild);
    }
  }
  function topSyncUndo() { var c = $("mlsTourSampleChip"); if (c) c.remove(); }

  function analysisDemo() {
    var out = $("mls-sg-out");
    if (out && out.getAttribute("data-mlsTourPrev") === null) {
      out.setAttribute("data-mlsTourPrev", out.innerHTML);
      out.style.display = "";
      out.innerHTML =
        '<div style="border:1px solid #cbd5e1;border-radius:10px;background:#f8fafc;padding:12px 14px;font-size:14px;color:#0f172a;line-height:1.5;">' +
        '<span style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.04em;color:#0369a1;background:#e0f2fe;border-radius:6px;padding:2px 8px;margin-bottom:8px;">SAMPLE — NOT REAL DATA</span><br>' +
        '<b>Average pain score:</b> 6.2 → 3.8 after 6 visits<br>' +
        '<b>Most common diagnosis:</b> Lumbar radiculopathy<br>' +
        '<b>Patients improving:</b> 18 of 22' +
        '</div>';
    }
  }
  function analysisUndo() {
    var out = $("mls-sg-out");
    if (out && out.getAttribute("data-mlsTourPrev") !== null) {
      out.innerHTML = out.getAttribute("data-mlsTourPrev");
      out.removeAttribute("data-mlsTourPrev");
    }
  }

  function widgetDemo() {
    var host = $("studioSaved") || $("studioView");
    if (host && !$("mlsTourSampleWidget")) {
      var w = document.createElement("div");
      w.id = "mlsTourSampleWidget";
      w.style.cssText = "border:2px solid #38bdf8;border-radius:12px;background:#f0f9ff;padding:14px 16px;margin:8px 0;box-shadow:0 6px 18px rgba(56,189,248,.30);";
      w.innerHTML =
        '<span style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.04em;color:#0369a1;background:#e0f2fe;border-radius:6px;padding:2px 8px;margin-bottom:8px;">SAMPLE WIDGET</span>' +
        '<div style="font-size:16px;font-weight:800;color:#0f172a;">✨ Pain-Score Tracker</div>' +
        '<div style="font-size:14px;color:#334155;margin-top:4px;">A little helper that charts each patient’s pain over time.</div>';
      host.insertBefore(w, host.firstChild);
    }
  }
  function widgetUndo() { var w = $("mlsTourSampleWidget"); if (w) w.remove(); }

  function demoUndoAll() {
    try { pullFillUndo(); } catch (e) {}
    try { topSyncUndo(); } catch (e) {}
    try { analysisUndo(); } catch (e) {}
    try { widgetUndo(); } catch (e) {}
  }

  /* ---- the walkthrough steps (one idea per card, big text) ---- */
  function buildSteps() {
    return [
      { center: true, title: "Welcome to MLS \u{1F44B}",
        body: "I’m going to actually walk you around and show you the few things you’ll use. I’ll use a pretend patient named John Doe — nothing here touches a real chart, and I’ll put everything back exactly how it was when we finish." },

      { sel: "#heroPtName", view: "visit", title: "1. It all starts with the patient",
        body: "This box is where the patient’s name goes. Everything in MLS follows the patient you pick here." },

      { sel: "#mlsChartFillBtn", view: "visit", title: "2. Pulling from Athena — the little blue box",
        body: "See this little blue box? When you have a patient’s chart open in Athena, one tap pulls them in — you don’t type anything." },

      { sel: "#heroPtName", view: "visit", title: "3. Watch the name fill in by itself",
        body: "Watch — I’ll pull a sample patient for you. See how the name filled in here on its own? That came straight from the chart.",
        on: function () { pullFillDemo(); } },

      { sel: "#mlsCtxBar", view: "visit", title: "4. The patient appears at the top",
        body: "And now that same patient shows up at the very top of the screen — from here it flows through the whole app, every screen stays in sync. (This one’s just a sample.)",
        on: function () { pullFillDemo(); topSyncDemo(); } },

      { sel: "#heroRecBtn", view: "visit", title: "5. Press record, then just talk",
        body: "When you’re ready, press the green record button and have your normal visit. No typing — MLS listens and writes the note." },

      { sel: "#phoneMicBtn", view: "visit", title: "6. No computer at the bedside? Use your phone",
        body: "You can also record from your phone and the note shows up here on your computer. Whatever’s easier for you." },

      { sel: "#nav_calendar", view: "calendar", title: "7. Here’s your Calendar",
        body: "This is your whole day at a glance — I just switched you to it. Your appointments live here so you always know who’s next." },

      { sel: "#ptNewBtn, #ptPullAthenaBtn", view: "patients", title: "8. Here are your Patients",
        body: "And this is your patient list. The buttons that live up here are the ones you’ll use: “＋ New patient” to add someone, and “\u{1F4E5} Pull from Athena” to bring your schedule in." },

      { sel: "#nav_studio", view: "studio", title: "9. This is AI Studio",
        body: "AI Studio is where your smart helpers live. Let me show you two things in here." },

      { sel: "#mls-sg-out", view: "studio", title: "10. The Analysis — it does the math for you",
        body: "I’ve opened the Analysis. It reads across your notes and finds patterns — like how pain scores improve over visits — so you don’t do any counting yourself. (Sample numbers shown.)",
        on: function () { analysisDemo(); } },

      { sel: "#mlsTourSampleWidget", view: "studio", title: "11. Watch — I’ll add a helper for you",
        body: "Here’s an AI widget. See it? It just appeared right here in your creations. You can build little helpers like this and they sit in AI Studio, ready when you need them. (This one’s a sample.)",
        on: function () { widgetDemo(); } },

      { sel: "#pushAllEmrBtn", view: "visit", title: "12. Sending the note back to Athena",
        body: "When your note is finished, THIS button sends it back to Athena. You press it, you review what it wrote, and only after YOU approve does it go onto the chart. I’m not sending anything now — just showing you where it is." },

      { sel: "#heroRecBtn", view: "visit", title: "13. You are always the final word",
        body: "Nothing is ever saved to a real chart until you say yes. MLS drafts — you decide. You’re always in control." },

      { sel: "#nav_history", view: "visit", title: "14. Past visits are saved here",
        body: "Every visit you finish is kept under History, so you can look back any time." },

      { sel: "#nav_help", view: "visit", title: "15. Help is always here",
        body: "If you ever get stuck, the Help button is right here — and you can replay this walkthrough any time from the menu." },

      { center: true, title: "You’re ready — that’s the whole thing ✅",
        body: "I’m cleaning up now: the pretend patient, the sample helper, and everything I touched are being removed, and I’m putting your screen back exactly how it was. Press Done." }
    ];
  }

  /* ---- styling (own ids so it never collides with v1) ---- */
  function injectStyle() {
    if ($("mlsTourStyleV2")) return;
    var s = document.createElement("style");
    s.id = "mlsTourStyleV2";
    s.textContent =
      ".mlsTourDimV2{position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:" + Z + ";}" +
      ".mlsTourSpotV2{position:fixed;border-radius:12px;box-shadow:0 0 0 9999px rgba(15,23,42,.55);border:3px solid #38bdf8;transition:all .25s ease;pointer-events:none;z-index:" + (Z + 1) + ";}" +
      ".mlsTourCardV2{position:fixed;max-width:440px;width:calc(100vw - 40px);background:#fff;border-radius:16px;box-shadow:0 18px 50px rgba(0,0,0,.35);padding:22px 22px 16px;box-sizing:border-box;z-index:" + (Z + 2) + ";}" +
      ".mlsTourCardV2 .st{font-size:13px;font-weight:700;color:#94a3b8;margin:0 0 4px;}" +
      ".mlsTourCardV2 h3{margin:0 0 10px;font-size:22px;line-height:1.25;color:#0f172a;font-weight:800;}" +
      ".mlsTourCardV2 p{margin:0;font-size:18px;line-height:1.5;color:#334155;}" +
      ".mlsTourBtns{display:flex;gap:8px;align-items:center;margin-top:18px;}" +
      ".mlsTourBtns .sp{flex:1;}" +
      ".mlsTourBtns button{font-size:15px;font-weight:700;border-radius:10px;padding:9px 16px;cursor:pointer;border:1px solid transparent;}" +
      ".mlsTbNextV2{background:#2563eb;color:#fff;}" +
      ".mlsTbBackV2{background:#f1f5f9;color:#0f172a;}" +
      ".mlsTbSkipV2{background:transparent;color:#64748b;border:none;text-decoration:underline;}";
    document.head.appendChild(s);
  }

  /* ---- root / render engine ---- */
  function ensureRoot() {
    injectStyle();
    if ($("mlsTourRootV2")) return;
    var root = document.createElement("div");
    root.id = "mlsTourRootV2";
    root.innerHTML =
      '<div class="mlsTourDimV2" id="mlsTourDimV2"></div>' +
      '<div class="mlsTourSpotV2" id="mlsTourSpotV2" style="display:none;"></div>' +
      '<div class="mlsTourCardV2" id="mlsTourCardV2">' +
      '<div class="st" id="mlsTourStepV2"></div>' +
      '<h3 id="mlsTourTitleV2"></h3>' +
      '<p id="mlsTourBodyV2"></p>' +
      '<div class="mlsTourBtns">' +
      '<button class="mlsTbSkipV2" id="mlsTourSkipV2">Skip</button>' +
      '<span class="sp"></span>' +
      '<button class="mlsTbBackV2" id="mlsTourBackV2">Back</button>' +
      '<button class="mlsTbNextV2" id="mlsTourNextV2">Next</button>' +
      '</div></div>';
    document.body.appendChild(root);
    $("mlsTourSkipV2").onclick = function () { finish(true, true); };
    $("mlsTourBackV2").onclick = function () { back(); };
    $("mlsTourNextV2").onclick = function () { next(); };
  }

  function placeCard(rect) {
    var card = $("mlsTourCardV2");
    if (!card) return;
    var cw = card.offsetWidth || 440, ch = card.offsetHeight || 220;
    var vw = window.innerWidth, vh = window.innerHeight, m = 16, left, top;
    if (!rect) {
      left = (vw - cw) / 2; top = (vh - ch) / 2;
    } else {
      top = rect.bottom + 14;
      if (top + ch > vh - m) top = rect.top - ch - 14;
      if (top < m) top = Math.max(m, (vh - ch) / 2);
      left = rect.left + (rect.width / 2) - (cw / 2);
      if (left < m) left = m;
      if (left + cw > vw - m) left = vw - cw - m;
    }
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(top) + "px";
  }

  function render() {
    var step = steps[idx];
    if (!step) return;
    if (step.view) go(step.view);
    if (typeof step.on === "function") { try { step.on(); } catch (e) {} }
    var stepEl = $("mlsTourStepV2"), titleEl = $("mlsTourTitleV2"), bodyEl = $("mlsTourBodyV2");
    var backBtn = $("mlsTourBackV2"), nextBtn = $("mlsTourNextV2");
    if (stepEl) stepEl.textContent = "Step " + (idx + 1) + " of " + steps.length;
    if (titleEl) titleEl.textContent = step.title || "";
    if (bodyEl) bodyEl.textContent = step.body || "";
    if (backBtn) backBtn.style.visibility = idx === 0 ? "hidden" : "visible";
    if (nextBtn) nextBtn.textContent = (idx === steps.length - 1) ? "Done" : "Next";
    setTimeout(function () {
      var spot = $("mlsTourSpotV2"), dim = $("mlsTourDimV2");
      var target = step.center ? null : (step.sel ? q(step.sel) : null);
      if (target) {
        try { target.scrollIntoView({ block: "center", inline: "nearest" }); } catch (e) {}
      }
      setTimeout(function () {
        if (target) {
          var r = target.getBoundingClientRect();
          if (r.width < 1 && r.height < 1) {
            if (spot) spot.style.display = "none";
            if (dim) dim.style.display = "block";
            placeCard(null);
            return;
          }
          var pad = 6;
          if (spot) {
            spot.style.display = "block";
            spot.style.left = Math.max(2, r.left - pad) + "px";
            spot.style.top = Math.max(2, r.top - pad) + "px";
            spot.style.width = (r.width + pad * 2) + "px";
            spot.style.height = (r.height + pad * 2) + "px";
          }
          if (dim) dim.style.display = "none";
          placeCard(r);
        } else {
          if (spot) spot.style.display = "none";
          if (dim) dim.style.display = "block";
          placeCard(null);
        }
      }, target ? 180 : 0);
    }, step.view ? 220 : 60);
  }

  function next() { if (idx < steps.length - 1) { idx++; render(); } else { finish(true, true); } }
  function back() { if (idx > 0) { idx--; render(); } }

  function restore() {
    demoUndoAll();
    try {
      if (snap) {
        if (snap.view) go(snap.view);
        if (snap.scrollY != null) window.scrollTo(0, snap.scrollY);
      }
    } catch (e) {}
  }

  function finish(markSeen, doRestore) {
    try { clearInterval(typingTimer); } catch (e) {}
    var r = $("mlsTourRootV2"); if (r) r.remove();
    if (doRestore !== false) restore();
    if (markSeen) { try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) {} }
  }

  function start() {
    snap = { view: viewKey(), scrollY: window.scrollY || 0 };
    try { var ov = $("mlsTourRoot"); if (ov) ov.remove(); } catch (e) {}
    idx = 0; steps = buildSteps(); ensureRoot(); render();
  }

  /* ---- menu hook: re-add our own "How-To Guide" item ---- */
  function closeAppMenu() {
    try {
      var p = $("mlsTbMenuPanel");
      if (p && getComputedStyle(p).display !== "none") { var b = $("mlsTbMenuBtn"); if (b) b.click(); }
    } catch (e) {}
  }
  function addMenuItem() {
    var panel = $("mlsTbMenuPanel");
    if (!panel || $("mlsTourMenuItemV2")) return;
    var btn = document.createElement("button");
    btn.id = "mlsTourMenuItemV2";
    btn.className = "mlsTbItem";
    btn.textContent = "\u{1F4D8} How-To Guide";
    btn.onclick = function (ev) { try { ev.stopPropagation(); } catch (e) {} start(); closeAppMenu(); };
    var first = panel.querySelector(".mlsTbItem");
    if (first) panel.insertBefore(btn, first); else panel.appendChild(btn);
  }
  addMenuItem();
  menuTimer = setInterval(addMenuItem, 900);

  /* ---- first-visit auto-launch (gated on v2 key) ---- */
  function maybeAutoLaunch() {
    var seen; try { seen = localStorage.getItem(SEEN_KEY); } catch (e) { seen = "1"; }
    if (!seen) { setTimeout(start, 1400); }
  }
  if (document.readyState === "complete") maybeAutoLaunch();
  else window.addEventListener("load", maybeAutoLaunch);

  /* ---- public API (extends + supersedes v1) ---- */
  window.__mlsTour = {
    __live: true,
    __v2: true,
    start: start,
    open: start,
    finish: function () { finish(true, true); },
    seen: function () { try { return !!localStorage.getItem(SEEN_KEY); } catch (e) { return true; } },
    reset: function () { try { localStorage.removeItem(SEEN_KEY); } catch (e) {} },
    revert: function () {
      try { clearInterval(menuTimer); } catch (e) {}
      try { clearInterval(typingTimer); } catch (e) {}
      try { var r = $("mlsTourRootV2"); if (r) r.remove(); } catch (e) {}
      try { var st = $("mlsTourStyleV2"); if (st) st.remove(); } catch (e) {}
      try { var mi = $("mlsTourMenuItemV2"); if (mi) mi.remove(); } catch (e) {}
      try { demoUndoAll(); } catch (e) {}
      try { if (snap && snap.view) go(snap.view); } catch (e) {}
      try { delete window.__mlsTour; } catch (e) { window.__mlsTour = undefined; }
    }
  };
})();

;(function(){try{var A="feat_mls_fixpack_0701.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260701fp1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item79: July-1 PROD fix-pack -- pull progress panel + any-day pull clarity, op-prep procedure autodetect (removes "No procedure entered yet"), note model gpt-5o with honest fallback cascade, today-button blink cap, agenda chip primary + full label, day/week honest fallback list, Find-anything Pro (screens+menus+templates+patients), formatted note preview in text boxes, op-note fill-in-the-blanks restore. Revert: window.__mlsFixpack.revert() */

;(function(){try{var A="feat_mls_staging_pack1.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260701sp1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item80 PROMOTED to prod (Michael picked 1+2+3, 2026-07-01): Templates suite + Simple-mode tunnel + MLS Agent dock. Same module as staging. Revert: window.__mlsPack1.revert() */

;(function(){try{var A="feat_mls_pull_dateguard.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260701dg1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item81: pull DATE GUARD -- root-cause fix for the misdated-pull bug (stray "July 4, 2026" holiday text poisoned _detectSchedDate; three pulls filed on Sat Jul 4; data repaired Jul 1, backup in localStorage mlsRepairBackup_20260701). Fallback date now requires a weekday-adjacent day-header date, else within 3 days of today, else defers to the current clinic day, with an honest status line. Revert: window.__mlsDateGuard.revert() */

;(function(){try{var A="feat_mls_provider_passthrough.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260702pp1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* item82: provider passthrough -- completes per-doctor scoping: "Pulling as" doctor chip by the Athena pull button; stamps provider onto imported appointments (import-window only) now that the backend persists+returns provider (d9e9a0c, live-verified); restores the imported-day jump button (late re-wrap after item81). Revert: window.__mlsProv.revert() */


;(function(){try{var A="feat_b18_qa.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260705b18v3";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* b18 QA bundle loader: calendar reliability, pull screen fix, writeback safety gate, smart empty states, UI stability (additive, reversible) */
;(function(){try{var A="feat_mls_status_center.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260705sc1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* task-4: MLS Status Center -- ONE honest Athena/MLS status surface (current task, current step, patient/day being read, data source, per-area statuses, retries, what-changed, what-next); fixes "connected but shown disconnected" via evidence+retry ConnTruth wrap; dedupes duplicate spinners; survives reload. Revert: window.__mlsStatusCenter.revert() */

;(function(){try{var A="feat_comp_report.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260706cr1";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* Monthly Pay Report -- per-provider patient counts, half-day credits, days x daily rate, AI-estimated collections (clearly labeled, manual override) + xlsx export + floating Pay Report button. Read-only. Revert: remove this loader. */
;(function(){try{var A="feat_mls_task7_analysis_sg.js";if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement("script");s.src=A+"?v=20260706t7a";s.setAttribute("data-mls-asset",A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})(); /* task7: Analysis dashboard refresh-stamp + Study Groups validation/wrong-group fix/remove+rename/inline status/empty-guards/2-col layout. Revert: window.__mlsT7.revert() */
