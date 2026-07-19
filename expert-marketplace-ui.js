/* ===========================================================================
   MLS — Expert Marketplace review draft (doctor-facing)
   ---------------------------------------------------------------------------
   Additive progressive enhancement loaded inside the MLS app (ScribeFlow.html).
   Gives a physician a profile-draft editor and an opt-in request for independent
   publication review. Opting in never publishes a profile by itself. Public
   release is a separate backend-held approval, and this synthetic evaluation
   does not accept real-person photos, documents, case information, or PHI.

   Self-contained: own IIFE, own scoped styles, try/catch everywhere, no
   monkey-patching of existing app functions. It injects a launcher next to the
   existing "Expert marketplace" opt-in box (#expertBody) and also exposes
   window.openExpertMarketplaceEditor(). Returns silently on any error so it can
   never break the host app.

   All requests in this surface explicitly bypass browser caches, cookies, and
   referrer disclosure. The bearer token remains the only authentication input.
   ======================================================================== */
(function () {
  if (window.__mlsExpertMktInit) return;
  window.__mlsExpertMktInit = true;

  var BACKEND_FALLBACK = 'https://scrivara-backend.onrender.com';
  function base() {
    try { if (typeof window.bkBase === 'function') return window.bkBase(); } catch (e) {}
    try { if (typeof BACKEND_URL === 'string') return BACKEND_URL.replace(/\/$/, ''); } catch (e) {}
    return BACKEND_FALLBACK;
  }
  function token() {
    try { if (typeof window.bkToken === 'function') return window.bkToken(); } catch (e) {}
    try { return sessionStorage.getItem('sf_bk_token') || localStorage.getItem('sf_bk_token') || ''; } catch (e) { return ''; }
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function authHeaders(json) {
    var h = { 'Authorization': 'Bearer ' + token() };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }
  function expertFetch(path, opts) {
    var safe = opts || {};
    var request = {};
    Object.keys(safe).forEach(function (key) { request[key] = safe[key]; });
    request.cache = 'no-store';
    request.credentials = 'omit';
    request.referrerPolicy = 'no-referrer';
    return fetch(base() + path, request);
  }

  var US_STATES = [
    ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
    ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['DC','District of Columbia'],['FL','Florida'],
    ['GA','Georgia'],['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],
    ['IA','Iowa'],['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],
    ['MD','Maryland'],['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],
    ['MO','Missouri'],['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],
    ['NJ','New Jersey'],['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],
    ['OH','Ohio'],['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],
    ['SC','South Carolina'],['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],
    ['VT','Vermont'],['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],
    ['WY','Wyoming'],['PR','Puerto Rico']
  ];

  /* ---------- styles ---------- */
  function injectStyle() {
    if (document.getElementById('mls-expert-mkt-style')) return;
    var st = document.createElement('style');
    st.id = 'mls-expert-mkt-style';
    st.textContent = [
      '#mlsExpertAdCta{margin-top:12px;background:linear-gradient(135deg,#F6FBF8,#F4F2EC);border:1px solid #E4E1D8;border-radius:14px;padding:16px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
      '#mlsExpertAdCta .mx-ico{font-size:26px;line-height:1}',
      '#mlsExpertAdCta .mx-txt{flex:1;min-width:200px}',
      '#mlsExpertAdCta .mx-txt b{display:block;font-size:15px;color:var(--ink,#0e2238)}',
      '#mlsExpertAdCta .mx-txt span{font-size:13px;color:var(--muted,#79837C)}',
      '.mx-btn{cursor:pointer;border:none;border-radius:10px;font-weight:700;font-size:14px;padding:11px 16px;background:var(--brand,#2E6A4B);color:#fff;transition:.15s}',
      '.mx-btn:hover{filter:brightness(1.06);transform:translateY(-1px)}',
      '.mx-btn.ghost{background:#fff;color:var(--ink,#0e2238);border:1.5px solid var(--line,#e7edf4)}',
      '.mx-btn.sm{padding:8px 12px;font-size:13px}',
      '.mx-btn[disabled]{opacity:.55;cursor:default;transform:none}',
      '#mlsExpertOverlay{position:fixed;inset:0;background:rgba(12,26,46,.55);backdrop-filter:blur(3px);z-index:99999;display:flex;align-items:flex-start;justify-content:center;padding:24px 14px;overflow:auto}',
      '#mlsExpertModal{background:var(--card,#fff);color:var(--ink,#0e2238);width:100%;max-width:760px;border-radius:18px;box-shadow:0 24px 70px rgba(8,22,40,.4);overflow:hidden;font-family:inherit;margin:auto}',
      '.mx-hd{display:flex;align-items:center;gap:12px;padding:18px 22px;border-bottom:1px solid var(--line,#e7edf4);position:sticky;top:0;background:var(--card,#fff);z-index:2}',
      '.mx-hd h2{font-size:18px;margin:0;font-weight:800;flex:1}',
      '.mx-x{cursor:pointer;border:none;background:transparent;font-size:22px;color:var(--muted,#79837C);line-height:1;padding:4px 8px;border-radius:8px}',
      '.mx-x:hover{background:var(--soft,#f3f6fa)}',
      '.mx-bd{padding:18px 22px;max-height:calc(100vh - 190px);overflow:auto}',
      '.mx-ft{display:flex;gap:10px;align-items:center;justify-content:flex-end;flex-wrap:wrap;padding:14px 22px;border-top:1px solid var(--line,#e7edf4);background:var(--soft,#FCFBF8)}',
      '.mx-ft .mx-spacer{flex:1}',
      '.mx-boundary{background:#f6fbf8;border:1px solid #cfe5d8;border-radius:12px;padding:12px 14px;margin-bottom:14px;font-size:13px;line-height:1.5;color:var(--ink2,#204034)}',
      '.mx-boundary b{display:block;margin-bottom:2px}',
      '.mx-pub-status{border-radius:10px;padding:10px 12px;margin:-6px 0 18px;font-size:13px;line-height:1.45;background:var(--soft,#f3f6fa);border:1px solid var(--line,#e7edf4);color:var(--ink2,#204034)}',
      '.mx-pub-status.pending{background:#fff8e8;border-color:#efd9a0;color:#76551a}',
      '.mx-pub-status.released{background:#edf8f1;border-color:#c7e4d1;color:#1f6a43}',
      '.mx-optin{display:flex;gap:12px;align-items:flex-start;background:var(--soft2,#FCFBF8);border:1px solid var(--line,#e7edf4);border-radius:12px;padding:14px;margin-bottom:18px}',
      '.mx-optin input{margin-top:3px;width:18px;height:18px;flex:0 0 auto}',
      '.mx-optin b{font-size:14.5px}.mx-optin p{margin:3px 0 0;font-size:12.5px;color:var(--muted,#79837C)}',
      '.mx-sec{margin:0 0 20px}',
      '.mx-sec>h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--brand,#2E6A4B);font-weight:800;margin:0 0 10px;border-bottom:1px solid var(--line,#F4F2EC);padding-bottom:6px}',
      '.mx-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '@media(max-width:560px){.mx-row{grid-template-columns:1fr}.mx-bd{padding:16px}}',
      '.mx-f{margin-bottom:12px}',
      '.mx-f label{display:block;font-size:12.5px;font-weight:700;color:var(--ink2,#204034);margin-bottom:5px}',
      '.mx-f .hint{font-weight:500;color:var(--muted,#79837C)}',
      '.mx-f input,.mx-f textarea,.mx-f select{width:100%;border:1.5px solid var(--line,#e7edf4);border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;color:var(--ink,#0e2238);background:var(--field-bg,#fff);box-sizing:border-box}',
      '.mx-f textarea{resize:vertical;min-height:64px}',
      '.mx-f input:focus,.mx-f textarea:focus,.mx-f select:focus{outline:none;border-color:var(--brand,#2E6A4B);box-shadow:0 0 0 3px rgba(32,64,52,.14)}',
      '.mx-states{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:4px 10px;max-height:168px;overflow:auto;border:1.5px solid var(--line,#e7edf4);border-radius:10px;padding:10px 12px}',
      '.mx-states label{display:flex;gap:7px;align-items:center;font-size:13px;font-weight:500;color:var(--ink,#0e2238);cursor:pointer;margin:0}',
      '.mx-states input{width:15px;height:15px;margin:0}',
      '.mx-note{font-size:12px;color:var(--muted,#79837C);margin-top:6px;line-height:1.4}',
      '.mx-msg{font-size:13px;margin-right:auto}',
      '.mx-msg.ok{color:#1f7a4d}.mx-msg.err{color:#c0392b}',
      '.mx-live{font-size:12.5px;color:var(--muted,#79837C)}',
      '.mx-live a{color:var(--brand,#2E6A4B);font-weight:700}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- launcher injection (sibling of #expertBody so re-renders don't wipe it) ---------- */
  function placeLauncher() {
    injectStyle();   /* the CTA renders long before the editor opens */
    try {
      var body = document.getElementById('expertBody');
      if (!body) return;
      if (document.getElementById('mlsExpertAdCta')) return;
      var cta = document.createElement('div');
      cta.id = 'mlsExpertAdCta';
      cta.innerHTML =
        '<div class="mx-ico">📝</div>' +
        '<div class="mx-txt"><b>Prepare an expert profile draft</b>' +
        '<span>Synthetic evaluation only. Draft your profile and choose whether to request independent publication review; saving never publishes it.</span></div>' +
        '<button class="mx-btn" type="button" id="mlsExpertAdOpen">Open profile draft →</button>';
      if (body.parentNode) body.parentNode.insertBefore(cta, body.nextSibling);
      else body.appendChild(cta);
      var btn = document.getElementById('mlsExpertAdOpen');
      if (btn) btn.addEventListener('click', openEditor);
    } catch (e) { /* best effort */ }
  }

  /* ---------- modal ---------- */
  var STATE = { profile: null };

  function field(id, label, val, opts) {
    opts = opts || {};
    var hint = opts.hint ? ' <span class="hint">' + esc(opts.hint) + '</span>' : '';
    var input;
    if (opts.textarea) {
      input = '<textarea id="' + id + '" rows="' + (opts.rows || 3) + '" placeholder="' + esc(opts.ph || '') + '">' + esc(val || '') + '</textarea>';
    } else {
      input = '<input id="' + id + '" type="' + (opts.type || 'text') + '" value="' + esc(val || '') + '" placeholder="' + esc(opts.ph || '') + '">';
    }
    return '<div class="mx-f"><label for="' + id + '">' + esc(label) + hint + '</label>' + input + '</div>';
  }

  function statesGrid(selected) {
    var sel = {};
    (selected || []).forEach(function (c) { sel[c] = true; });
    return '<div class="mx-states">' + US_STATES.map(function (st) {
      return '<label><input type="checkbox" class="mx-state" value="' + st[0] + '"' + (sel[st[0]] ? ' checked' : '') + '> ' + esc(st[0]) + ' · ' + esc(st[1]) + '</label>';
    }).join('') + '</div>';
  }

  function dollars(cents) { var n = Number(cents); return (n && !isNaN(n)) ? (n / 100) : ''; }

  function isReleased(p) {
    return !!p && p.public_ready === true && p.publication_status === 'released';
  }

  function publicationSummary(p) {
    if (isReleased(p)) return { kind: 'released', text: 'Released after independent review. Editing this profile will return it to pending review.' };
    if (p && p.listed) return { kind: 'pending', text: 'Review requested. This draft is not public while independent review is pending.' };
    return { kind: '', text: 'No public review requested. This profile remains a private draft.' };
  }

  function publicationStatusHtml(p) {
    var status = publicationSummary(p);
    return '<div id="mxPubStatus" class="mx-pub-status' + (status.kind ? ' ' + status.kind : '') + '" role="status" aria-live="polite">' + esc(status.text) + '</div>';
  }

  function buildModal(p) {
    injectStyle();
    var ov = document.createElement('div');
    ov.id = 'mlsExpertOverlay';
    var statesSel = p.states || [];
    ov.innerHTML =
      '<div id="mlsExpertModal" role="dialog" aria-modal="true" aria-label="Expert profile review draft">' +
      '<div class="mx-hd"><span style="font-size:22px">📝</span><h2>Prepare an expert profile for review</h2>' +
      '<button class="mx-x" id="mxClose" aria-label="Close">×</button></div>' +
      '<div class="mx-bd">' +

        '<div class="mx-boundary" role="note"><b>Synthetic evaluation only</b>Use invented profile details. Do not enter patient information, real-person identity media, credentials documents, case files, or other sensitive material. Saving creates a draft; it does not publish a profile.</div>' +

        '<label class="mx-optin"><input type="checkbox" id="mxListed"' + (p.listed ? ' checked' : '') + '>' +
        '<span><b>Request independent review for public release</b>' +
        '<p>Off by default. Selecting this records an opt-in request only. MLS must separately review and release the profile before anyone can see it publicly. Clear it to withdraw the request.</p></span></label>' +
        publicationStatusHtml(p) +

        '<div class="mx-sec"><h3>Photo</h3>' +
        '<div class="mx-note">Headshot uploads are unavailable in this synthetic evaluation build. Do not add a real-person image.</div></div>' +

        '<div class="mx-sec"><h3>Who you are</h3>' +
        '<div class="mx-row">' +
        field('mxName', 'Full name', p.full_name, { ph: 'Jane A. Smith, MD' }) +
        field('mxCred', 'Credentials summary', p.credentials, { ph: 'Synthetic credentials for evaluation' }) +
        '</div><div class="mx-row">' +
        field('mxSpec', 'Specialty', p.specialty, { ph: 'Pain Management' }) +
        field('mxSub', 'Subspecialty', p.subspecialty, { ph: 'Interventional spine' }) +
        '</div>' +
        field('mxYears', 'Practice experience summary', p.years, { ph: 'Synthetic experience summary for evaluation' }) +
        '</div>' +

        '<div class="mx-sec"><h3>Jurisdictions for the synthetic draft</h3>' +
        statesGrid(statesSel) +
        '</div>' +

        '<div class="mx-sec"><h3>Experience & scheduling notes</h3>' +
        field('mxDepoExp', 'Deposition experience', p.depo_experience, { textarea: true, rows: 2, ph: 'Synthetic experience summary (optional)' }) +
        field('mxTrialExp', 'Trial / testimony experience', p.trial_experience, { textarea: true, rows: 2, ph: 'Synthetic experience summary (optional)' }) +
        field('mxAvail', 'Scheduling notes', p.availability, { ph: 'Synthetic scheduling notes (optional)' }) +
        '</div>' +

        '<div class="mx-sec"><h3>Synthetic fee draft</h3>' +
        '<div class="mx-row">' +
        field('mxDepo', 'Deposition rate draft (USD/hr)', dollars(p.depo_rate_cents), { type: 'number', ph: 'Synthetic amount' }) +
        field('mxTrial', 'Trial rate draft (USD/hr)', dollars(p.trial_rate_cents), { type: 'number', ph: 'Synthetic amount' }) +
        '</div>' +
        field('mxFee', 'Fee notes draft', p.fee_info, { textarea: true, rows: 2, ph: 'Synthetic fee notes for evaluation (optional)' }) +
        '</div>' +

        '<div class="mx-sec"><h3>Profile draft</h3>' +
        field('mxHeadline', 'Headline', p.headline, { ph: 'Synthetic specialty profile for review' }) +
        field('mxAdCopy', 'Profile summary', p.ad_copy, { textarea: true, rows: 6, ph: 'Synthetic draft text for independent review.' }) +
        field('mxBio', 'Short directory summary', p.bio, { textarea: true, rows: 3, ph: 'Synthetic draft summary for review.' }) +
        '</div>' +

        '<div class="mx-sec"><h3>Documents</h3>' +
        '<div class="mx-note">Document uploads and public downloads are unavailable in this synthetic evaluation build. Do not add CVs, certificates, clinical files, or other real-world documents.</div>' +
        '</div>' +

        '<div class="mx-sec"><h3>Links & contact</h3>' +
        field('mxCv', 'Reference link (synthetic evaluation only)', p.cv_url, { ph: 'Leave blank unless using an invented test URL' }) +
        field('mxContact', 'Contact preference draft', p.contact_pref, { ph: 'Synthetic contact preference for review' }) +
        '</div>' +

      '</div>' +
      '<div class="mx-ft">' +
        '<span id="mxMsg" class="mx-msg"></span>' +
        '<span id="mxLive" class="mx-live"></span>' +
        '<button class="mx-btn ghost" type="button" id="mxCancel">Close</button>' +
        '<button class="mx-btn" type="button" id="mxSave">Save draft and review choice</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(ov);

    // wire
    document.getElementById('mxClose').addEventListener('click', closeEditor);
    document.getElementById('mxCancel').addEventListener('click', closeEditor);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeEditor(); });
    document.getElementById('mxSave').addEventListener('click', saveProfile);
    updateLiveLink();
  }

  function updateLiveLink() {
    var el = document.getElementById('mxLive');
    if (!el || !STATE.profile) return;
    var raw = isReleased(STATE.profile) && typeof STATE.profile.public_url === 'string' ? STATE.profile.public_url.trim() : '';
    if (!raw || raw.charAt(0) !== '/' || raw.indexOf('//') === 0 || raw.indexOf('\\') !== -1) { el.textContent = ''; return; }
    var href = (location.origin && location.origin.indexOf('http') === 0) ? (location.origin + raw) : raw;
    el.innerHTML = '🔗 <a href="' + esc(href) + '" target="_blank" rel="noopener noreferrer">View released public profile</a>';
  }

  function updatePublicationStatus() {
    var el = document.getElementById('mxPubStatus');
    if (!el || !STATE.profile) return;
    var status = publicationSummary(STATE.profile);
    el.textContent = status.text;
    el.className = 'mx-pub-status' + (status.kind ? ' ' + status.kind : '');
    updateLiveLink();
  }

  function msg(text, kind) {
    var m = document.getElementById('mxMsg');
    if (!m) return;
    m.textContent = text || '';
    m.className = 'mx-msg' + (kind ? ' ' + kind : '');
  }

  function collect() {
    function v(id) { var e = document.getElementById(id); return e ? e.value : ''; }
    var states = [];
    Array.prototype.forEach.call(document.querySelectorAll('.mx-state'), function (c) { if (c.checked) states.push(c.value); });
    var depo = parseFloat(v('mxDepo')); var trial = parseFloat(v('mxTrial'));
    return {
      listed: !!document.getElementById('mxListed').checked,
      full_name: v('mxName'), credentials: v('mxCred'), specialty: v('mxSpec'), subspecialty: v('mxSub'),
      years: v('mxYears'), states: states,
      depo_experience: v('mxDepoExp'), trial_experience: v('mxTrialExp'), availability: v('mxAvail'),
      depo_rate_cents: (depo && !isNaN(depo)) ? Math.round(depo * 100) : 0,
      trial_rate_cents: (trial && !isNaN(trial)) ? Math.round(trial * 100) : 0,
      fee_info: v('mxFee'), headline: v('mxHeadline'), ad_copy: v('mxAdCopy'), bio: v('mxBio'),
      cv_url: v('mxCv'), contact_pref: v('mxContact')
    };
  }

  async function saveProfile() {
    var btn = document.getElementById('mxSave');
    msg('Saving…');
    if (btn) { btn.disabled = true; }
    try {
      var body = collect();
      var r = await expertFetch('/api/expert/me', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'Save failed');
      STATE.profile.listed = d.listed === true;
      STATE.profile.public_ready = d.public_ready === true;
      STATE.profile.publication_status = typeof d.publication_status === 'string' ? d.publication_status : (STATE.profile.listed ? 'pending_review' : 'not_requested');
      STATE.profile.public_url = isReleased(d) && typeof d.public_url === 'string' ? d.public_url : '';
      var requestBox = document.getElementById('mxListed');
      if (requestBox) requestBox.checked = STATE.profile.listed;
      var requested = STATE.profile.listed && !isReleased(STATE.profile);
      msg(requested ? '✓ Draft saved. Independent review requested; this profile is not public.' :
        (isReleased(STATE.profile) ? '✓ Released profile unchanged.' : '✓ Draft saved. No public review requested.'), 'ok');
      updatePublicationStatus();
      try { if (typeof window.loadExpertProfile === 'function') window.loadExpertProfile(); } catch (e) {}
    } catch (e) {
      msg(e.message || 'Could not save.', 'err');
    } finally { if (btn) btn.disabled = false; }
  }

  function closeEditor() {
    var ov = document.getElementById('mlsExpertOverlay');
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
  }

  async function openEditor() {
    if (document.getElementById('mlsExpertOverlay')) return;
    injectStyle();
    // loading shell
    var shell = document.createElement('div');
    shell.id = 'mlsExpertOverlay';
    shell.innerHTML = '<div id="mlsExpertModal"><div class="mx-bd" style="padding:40px;text-align:center;color:var(--muted,#79837C)">Loading your profile…</div></div>';
    document.body.appendChild(shell);
    try {
      var r = await expertFetch('/api/expert/me', { headers: authHeaders(false) });
      if (!r.ok) {
        shell.querySelector('.mx-bd').textContent = 'This profile draft is available to signed-in clinician accounts.';
        setTimeout(closeEditor, 1800);
        return;
      }
      var p = await r.json();
      STATE.profile = p;
      closeEditor();
      buildModal(p);
    } catch (e) {
      if (shell.querySelector('.mx-bd')) shell.querySelector('.mx-bd').textContent = 'Your profile draft could not be loaded. Nothing was changed.';
      setTimeout(closeEditor, 1800);
    }
  }
  window.openExpertMarketplaceEditor = openEditor;

  /* poll for the opt-in box and attach the launcher (survives re-renders) */
  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    placeLauncher();
    if (tries > 120) clearInterval(iv); // ~3 min then stop
  }, 1500);
  if (document.readyState === 'complete' || document.readyState === 'interactive') placeLauncher();
  else document.addEventListener('DOMContentLoaded', placeLauncher);
})();
