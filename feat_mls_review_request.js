/* ============================================================================
 * feat_mls_review_request.js -- __mlsReviewRequest v1.0.0 (2026-07-07)
 * ----------------------------------------------------------------------------
 * DOCTOR-SIDE trigger for "auto-review from a visit" (COMPLIANT).
 * Loaded as a satellite by mls-connect.js (one loader line; guarded/reversible)
 * OR callable directly by MLS Easy v3 / the visit cascade via
 *   window.__mlsReviewRequest.open(ctx).
 *
 * WHAT IT DOES (one tap after a good visit):
 *   - When a note is signed / saved to history (same signal __mlsCascade uses:
 *     a capture-phase click on Review&Sign / Save / Sign), it surfaces a small
 *     "Ask patient for a review" chip.
 *   - open() shows a DOCTOR-APPROVAL modal: an AI-suggested STARTING DRAFT for
 *     the patient (generated via /api/widget/ai), the patient's contact +
 *     channel, and a Send button. The doctor approves before anything is sent.
 *   - Send -> POST /api/reviews/request (flagged backend hook) which emails /
 *     portals the patient a link to patient-review.html carrying the editable
 *     draft. Fallbacks with NO backend: open patient-review.html with the draft
 *     (localStorage handoff) for the office to send, and offer a mailto.
 *
 * COMPLIANCE (enforced + surfaced in the UI; see FINAL_REPORT):
 *   - The PATIENT edits and posts their OWN review, on the platform THEY pick.
 *   - MLS NEVER posts as/for the patient and NEVER fabricates a review; the
 *     draft is a clearly-labeled optional starting point.
 *   - NO incentives. NO review-gating: the request is a plain ask; sentiment is
 *     never used to suppress the public path.
 *   - No PHI in links; the draft carries no clinical detail.
 *
 * Guard: window.__mlsReviewRequest. Revert: window.__mlsReviewRequest.revert().
 * Pure-ASCII, ES5/ES3-parseable (JScript new Function validated). READ-ONLY wrt
 * Athena. Athena is never touched.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsReviewRequest) return;

  var VER = '1.0.0';
  var BK = (function () { try { return (window.bkBase && window.bkBase()) || 'https://scrivara-backend.onrender.com'; } catch (e) { return 'https://scrivara-backend.onrender.com'; } })();
  var PATIENT_PAGE = 'patient-review.html';
  var CHIP_ID = 'mlsRevReqChip';
  var MODAL_ID = 'mlsRevReqModal';
  var TRIGGERS = /review\s*&\s*sign|save to history|sign\s*&\s*save|^\s*sign\s*$/i;

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tok() { try { return sessionStorage.getItem('sf_bk_token') || localStorage.getItem('sf_bk_token') || ''; } catch (e) { return ''; } }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function jget(k) { try { return JSON.parse(lsGet(k) || 'null'); } catch (e) { return null; } }

  /* ---- context gatherers (best-effort, all guarded) ---- */
  function activePt() {
    try { var p = window.activePatient; if (typeof p === 'function') p = p(); return (p && typeof p === 'object') ? p : {}; } catch (e) { return {}; }
  }
  function providerName() {
    try {
      var chip = $('mlsProvChip'); if (chip && chip.textContent) { var m = chip.textContent.replace(/pulling as:?/i, '').replace(/^\s+|\s+$/g, ''); if (m) return m; }
    } catch (e) {}
    try { return (window.bkUser && (window.bkUser.name || window.bkUser.docname)) || ''; } catch (e) { return ''; }
  }
  function practiceName() { try { return lsGet('practiceName') || (window.bkUser && window.bkUser.practice) || ''; } catch (e) { return ''; } }
  function visitType() {
    try { var s = $('specialtyPreset'); if (s && s.value) return s.value; } catch (e) {}
    return '';
  }
  /* doctor's own review destinations, from the reputation tools */
  function reviewLinks() {
    var out = {}, i;
    var sc = jget('mlsRFScrapeCache');
    if (sc && sc.payload && sc.payload.listings) {
      for (i = 0; i < sc.payload.listings.length; i++) {
        var L = sc.payload.listings[i];
        if (L.scope === 'doctor' && L.url && !out[L.source]) out[L.source] = L.url;
      }
    }
    var raw = (lsGet('mlsRFLinks') || '').split(/\r?\n/);
    for (i = 0; i < raw.length; i++) {
      var u = raw[i].replace(/^\s+|\s+$/g, ''); if (!/^https?:/i.test(u)) continue;
      if (/healthgrades\.com/i.test(u) && !out.healthgrades) out.healthgrades = u;
      else if (/vitals\.com/i.test(u) && !out.vitals) out.vitals = u;
      else if (/webmd\.com/i.test(u) && !out.webmd) out.webmd = u;
      else if (/ratemds\.com/i.test(u) && !out.ratemds) out.ratemds = u;
      else if (/zocdoc\.com/i.test(u) && !out.zocdoc) out.zocdoc = u;
      else if (/(google\.[a-z.]+\/maps|maps\.app\.goo\.gl|g\.page)/i.test(u) && !out.google) out.google = u;
    }
    return out;
  }
  function patientContact(p) {
    return { email: (p && (p.email || p.contactEmail)) || '', phone: (p && (p.phone || p.mobile)) || '' };
  }

  /* ---- AI starting draft (compliant scaffold) ---- */
  var SYS = 'You draft a SHORT first-person STARTING POINT that a PATIENT may edit and post as their OWN online review of their doctor. Rules: 2-3 sentences, warm and plain; about the patient EXPERIENCE only (communication, feeling heard, the staff, wait time); NEVER invent specific outcomes, diagnoses, treatments, numbers, or clinical claims; NEVER put words in the patient\'s mouth about results. Make it obviously easy to personalize. Output only the draft text.';
  function templateDraft(ctx) {
    var d = ctx.doctor || 'my doctor';
    return 'I had a good experience with ' + d + '. They listened, took time to explain things, and the staff was kind. (Please edit this into your own words.)';
  }
  function makeDraft(ctx, cb) {
    var t = tok();
    if (!t) { cb(templateDraft(ctx)); return; }
    var pr = 'Draft a starting-point review a patient could edit.\nDoctor: ' + (ctx.doctor || '') + '\nPractice: ' + (ctx.practice || '') + '\nVisit type (generic): ' + (ctx.visitType || 'office visit') + '\nKeep it about the experience, not clinical results.';
    try {
      fetch(BK + '/api/widget/ai', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
        body: JSON.stringify({ prompt: pr, system: SYS }) })
        .then(function (r) { return r.ok ? r.json() : null; }, function () { return null; })
        .then(function (j) { var x = j && (j.text || j.reply || j.content); cb(x ? String(x).slice(0, 600) : templateDraft(ctx)); }, function () { cb(templateDraft(ctx)); });
    } catch (e) { cb(templateDraft(ctx)); }
  }

  /* ---- patient link builder (no PHI; carries draft + links inline) ---- */
  function patientUrl(ctx) {
    var qp = [];
    function add(k, v) { if (v) qp.push(k + '=' + encodeURIComponent(String(v).slice(0, 800))); }
    add('doctor', ctx.doctor); add('practice', ctx.practice); add('city', ctx.city); add('draft', ctx.draft);
    var L = ctx.links || {}; add('g', L.google); add('hg', L.healthgrades); add('vt', L.vitals); add('wm', L.webmd); add('rm', L.ratemds); add('zd', L.zocdoc);
    return PATIENT_PAGE + (qp.length ? ('?' + qp.join('&')) : '');
  }

  /* ---- modal ---- */
  function css() {
    if ($('mlsRevReqCss')) return;
    var s = document.createElement('style'); s.id = 'mlsRevReqCss';
    s.textContent = [
      '#' + CHIP_ID + '{position:fixed;right:18px;bottom:78px;z-index:2147481000;background:linear-gradient(90deg,#3B7C5A,#2E6A4B);color:#fff;border:0;border-radius:999px;padding:11px 16px;font:700 13px system-ui,Segoe UI,Arial;box-shadow:0 6px 18px rgba(20,60,120,.28);cursor:pointer}',
      '#' + MODAL_ID + '{position:fixed;inset:0;z-index:2147482000;background:rgba(15,25,45,.5);display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,Segoe UI,Arial}',
      '#' + MODAL_ID + ' .box{background:#fff;max-width:520px;width:100%;border-radius:16px;padding:20px;max-height:90vh;overflow:auto}',
      '#' + MODAL_ID + ' h3{margin:0 0 6px;font-size:18px;color:#15243c}',
      '#' + MODAL_ID + ' .note{font-size:12.5px;color:#5b6b83}',
      '#' + MODAL_ID + ' .own{background:#eef4ff;border:1px solid #cfe0ff;border-radius:10px;padding:9px 11px;font-size:12px;color:#274b8f;margin:8px 0}',
      '#' + MODAL_ID + ' textarea{width:100%;min-height:96px;border:1px solid #d7e0ef;border-radius:9px;padding:9px;font:14px system-ui;box-sizing:border-box}',
      '#' + MODAL_ID + ' input{width:100%;border:1px solid #d7e0ef;border-radius:9px;padding:9px;font-size:14px;box-sizing:border-box}',
      '#' + MODAL_ID + ' label{display:block;font-size:12px;font-weight:700;margin:10px 0 4px;color:#15243c}',
      '#' + MODAL_ID + ' .btn{cursor:pointer;border:0;border-radius:10px;padding:11px 16px;font-weight:800;font-size:14px}',
      '#' + MODAL_ID + ' .btn.primary{background:linear-gradient(90deg,#3B7C5A,#2E6A4B);color:#fff}',
      '#' + MODAL_ID + ' .btn.ghost{background:#eef2fa;color:#24406e}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }
  function close() { var m = $(MODAL_ID); if (m && m.parentNode) m.parentNode.removeChild(m); }

  function open(ctx) {
    ctx = ctx || {};
    var p = ctx.patient || activePt();
    var c = patientContact(p);
    var context = {
      doctor: ctx.doctor || providerName(),
      practice: ctx.practice || practiceName(),
      city: ctx.city || (lsGet('clinicCity') || ''),
      visitType: ctx.visitType || visitType(),
      links: ctx.links || reviewLinks(),
      patientName: (p && p.name) || '',
      email: c.email, phone: c.phone,
      patientId: (p && (p.external_id || p.id)) || ''
    };
    css(); close();
    var m = document.createElement('div'); m.id = MODAL_ID;
    m.innerHTML =
      '<div class="box">' +
        '<h3>\u2B50 Ask ' + (esc(context.patientName) || 'the patient') + ' for a review</h3>' +
        '<div class="note">MLS sends the patient a link with this editable starting point. <b>They</b> write it in their own words and post it themselves \u2014 MLS never posts for them, and there\u2019s no reward for a review.</div>' +
        '<div class="own">\u270D\uFE0F The patient owns and edits this. It is only a starting point.</div>' +
        '<label>Suggested starting draft (the patient can change or clear it)</label>' +
        '<textarea id="mrrDraft">Generating a starting point\u2026</textarea>' +
        '<label>Send to the patient by</label>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><select id="mrrChannel" style="flex:1;min-width:120px;border:1px solid #d7e0ef;border-radius:9px;padding:9px"><option value="email">Email</option><option value="portal">Patient portal</option><option value="sms">Text</option><option value="link">Just give me the link</option></select>' +
        '<input id="mrrContact" style="flex:2;min-width:160px" placeholder="patient email or phone" value="' + esc(context.email || context.phone) + '"></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">' +
          '<button class="btn primary" id="mrrSend">Send the request</button>' +
          '<button class="btn ghost" id="mrrPreview">Preview patient page</button>' +
          '<button class="btn ghost" id="mrrClose">Cancel</button>' +
          '<span class="note" id="mrrNote" style="align-self:center"></span>' +
        '</div>' +
      '</div>';
    document.body.appendChild(m);
    $('mrrClose').onclick = close;
    m.addEventListener('click', function (e) { if (e.target === m) close(); });

    makeDraft(context, function (draft) { var ta = $('mrrDraft'); if (ta) ta.value = draft; context.draft = draft; });

    $('mrrPreview').onclick = function () {
      context.draft = $('mrrDraft').value;
      try { localStorage.setItem('mlsReviewReq', JSON.stringify({ doctor: context.doctor, practice: context.practice, city: context.city, draft: context.draft, links: context.links })); } catch (e) {}
      try { window.open(patientUrl(context), '_blank'); } catch (e) {}
    };
    $('mrrSend').onclick = function () { sendRequest(context); };
    return true;
  }

  function sendRequest(context) {
    context.draft = $('mrrDraft').value;
    var channel = ($('mrrChannel') || {}).value || 'email';
    var contact = ($('mrrContact') || {}).value || '';
    var note = $('mrrNote');
    try { localStorage.setItem('mlsReviewReq', JSON.stringify({ doctor: context.doctor, practice: context.practice, city: context.city, draft: context.draft, links: context.links })); } catch (e) {}

    function linkFallback(reason) {
      var url = patientUrl(context);
      if (channel === 'email' && /@/.test(contact)) {
        var subj = encodeURIComponent('A quick review, if you have a moment');
        var body = encodeURIComponent('Thank you for your visit. If you\'d like to share your experience, here\'s a starting point you can edit and post yourself:\n\n' + location.origin.replace(/\/$/, '') + '/' + url + '\n\nThere\'s no obligation and no reward \u2014 only post if you\'d like to.');
        try { window.open('mailto:' + encodeURIComponent(contact) + '?subject=' + subj + '&body=' + body, '_blank'); } catch (e) {}
        note.innerHTML = 'Opened an email to the patient with their editable link. (Live send turns on with the backend.)';
      } else {
        try { window.open(url, '_blank'); } catch (e) {}
        note.innerHTML = 'Opened the patient\u2019s review page \u2014 share this link with them. (Live send turns on with the backend.)';
      }
    }

    var t = tok();
    if (!t) { linkFallback('not signed in'); return; }
    note.textContent = 'Sending\u2026';
    try {
      fetch(BK + '/api/reviews/request', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
        body: JSON.stringify({ patient_external_id: context.patientId || '', contact: contact, channel: channel,
          visitType: context.visitType || '', provider: context.doctor || '', draft: context.draft || '', links: context.links || {} }) })
        .then(function (r) { return (r && r.ok) ? r.json() : { __status: r ? r.status : 0 }; }, function () { return { __status: 0 }; })
        .then(function (j) {
          if (j && j.ok) { note.textContent = '\u2713 Sent \u2014 the patient will get their editable link.'; setTimeout(close, 1400); }
          else { linkFallback('route not live (' + ((j && j.__status) || 'n/a') + ')'); }
        }, function () { linkFallback('network'); });
    } catch (e) { linkFallback('exception'); }
  }

  /* ---- chip on sign/save ---- */
  var chipTimer = null;
  function showChip() {
    css();
    if ($(CHIP_ID)) return;
    var b = document.createElement('button'); b.id = CHIP_ID; b.type = 'button';
    b.innerHTML = '\u2B50 Ask patient for a review';
    b.onclick = function () { hideChip(); open({}); };
    document.body.appendChild(b);
    if (chipTimer) clearTimeout(chipTimer);
    chipTimer = setTimeout(hideChip, 20000);
  }
  function hideChip() { var c = $(CHIP_ID); if (c && c.parentNode) c.parentNode.removeChild(c); }

  function onDocClick(e) {
    try {
      var el = e.target; if (!el) return;
      var btn = el.closest ? el.closest('button,a,[role="button"]') : null;
      var label = (btn ? (btn.textContent || '') : (el.textContent || '')).replace(/\s+/g, ' ');
      if (btn && TRIGGERS.test(label)) { setTimeout(showChip, 1200); }
    } catch (err) {}
  }
  document.addEventListener('click', onDocClick, true);

  window.__mlsReviewRequest = {
    version: VER,
    open: open,
    _draftFor: makeDraft,       /* exposed for tests */
    _patientUrl: patientUrl,    /* exposed for tests */
    _links: reviewLinks,        /* exposed for tests */
    revert: function () {
      try { document.removeEventListener('click', onDocClick, true); } catch (e) {}
      hideChip(); close();
      try { var s = $('mlsRevReqCss'); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
      try { delete window.__mlsReviewRequest; } catch (e) { window.__mlsReviewRequest = undefined; }
      return 'reverted';
    }
  };
})();
