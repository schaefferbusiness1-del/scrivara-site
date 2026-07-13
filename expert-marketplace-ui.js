/* ===========================================================================
   MLS — Expert Marketplace editor (doctor-facing)
   ---------------------------------------------------------------------------
   Additive progressive enhancement loaded inside the MLS app (ScribeFlow.html).
   Gives a physician a full "List yourself on the attorney marketplace" editor:
   rich profile fields, headshot + document uploads, AI-polished advertising
   copy, licensed-state selection, and an opt-in toggle (OFF by default). Wires
   to the backend /api/expert/* routes. Only opted-in profiles appear publicly.

   Self-contained: own IIFE, own scoped styles, try/catch everywhere, no
   monkey-patching of existing app functions. It injects a launcher next to the
   existing "Expert marketplace" opt-in box (#expertBody) and also exposes
   window.openExpertMarketplaceEditor(). Returns silently on any error so it can
   never break the host app.

   Photo policy: we use the physician's REAL uploaded photo (resized only). We
   never generate a synthetic/AI likeness — this is a legal-credibility context.
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
      '#mlsExpertAdCta{margin-top:12px;background:linear-gradient(135deg,#eef4ff,#eafaf4);border:1px solid #d6e6fb;border-radius:14px;padding:16px 18px;display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
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
      '.mx-optin{display:flex;gap:12px;align-items:flex-start;background:var(--soft2,#FCFBF8);border:1px solid var(--line,#e7edf4);border-radius:12px;padding:14px;margin-bottom:18px}',
      '.mx-optin input{margin-top:3px;width:18px;height:18px;flex:0 0 auto}',
      '.mx-optin b{font-size:14.5px}.mx-optin p{margin:3px 0 0;font-size:12.5px;color:var(--muted,#79837C)}',
      '.mx-sec{margin:0 0 20px}',
      '.mx-sec>h3{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--brand,#2E6A4B);font-weight:800;margin:0 0 10px;border-bottom:1px solid var(--line,#F4F2EC);padding-bottom:6px}',
      '.mx-row{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
      '@media(max-width:560px){.mx-row{grid-template-columns:1fr}.mx-bd{padding:16px}}',
      '.mx-f{margin-bottom:12px}',
      '.mx-f label{display:block;font-size:12.5px;font-weight:700;color:var(--ink2,#3a5575);margin-bottom:5px}',
      '.mx-f .hint{font-weight:500;color:var(--muted,#79837C)}',
      '.mx-f input,.mx-f textarea,.mx-f select{width:100%;border:1.5px solid var(--line,#e7edf4);border-radius:10px;padding:10px 12px;font-size:14px;font-family:inherit;color:var(--ink,#0e2238);background:var(--field-bg,#fff);box-sizing:border-box}',
      '.mx-f textarea{resize:vertical;min-height:64px}',
      '.mx-f input:focus,.mx-f textarea:focus,.mx-f select:focus{outline:none;border-color:var(--brand,#2E6A4B);box-shadow:0 0 0 3px rgba(32,64,52,.14)}',
      '.mx-states{display:grid;grid-template-columns:repeat(auto-fill,minmax(132px,1fr));gap:4px 10px;max-height:168px;overflow:auto;border:1.5px solid var(--line,#e7edf4);border-radius:10px;padding:10px 12px}',
      '.mx-states label{display:flex;gap:7px;align-items:center;font-size:13px;font-weight:500;color:var(--ink,#0e2238);cursor:pointer;margin:0}',
      '.mx-states input{width:15px;height:15px;margin:0}',
      '.mx-photo{display:flex;gap:14px;align-items:center;flex-wrap:wrap}',
      '.mx-photo .pv{width:84px;height:84px;border-radius:14px;object-fit:cover;border:1px solid var(--line,#e7edf4);background:var(--soft,#f3f6fa)}',
      '.mx-photo .ph{width:84px;height:84px;border-radius:14px;border:1px dashed var(--line,#cdd9e8);background:var(--soft,#f3f6fa);display:flex;align-items:center;justify-content:center;color:var(--muted,#90a4bd);font-size:26px}',
      '.mx-note{font-size:12px;color:var(--muted,#79837C);margin-top:6px;line-height:1.4}',
      '.mx-docs{list-style:none;margin:10px 0 0;padding:0;display:flex;flex-direction:column;gap:7px}',
      '.mx-docs li{display:flex;gap:10px;align-items:center;background:var(--soft,#f6f8fb);border:1px solid var(--line,#e7edf4);border-radius:9px;padding:8px 11px;font-size:13px}',
      '.mx-docs li .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.mx-docs li .rm{cursor:pointer;color:#c0392b;border:none;background:transparent;font-weight:700;font-size:16px}',
      '.mx-ai{background:linear-gradient(135deg,#f3eeff,#eef6ff);border:1px solid #e0d8f6;border-radius:12px;padding:13px 15px;margin-bottom:14px}',
      '.mx-ai b{font-size:13.5px}.mx-ai p{margin:3px 0 9px;font-size:12.5px;color:var(--muted,#79837C)}',
      '.mx-msg{font-size:13px;margin-right:auto}',
      '.mx-msg.ok{color:#1f7a4d}.mx-msg.err{color:#c0392b}',
      '.mx-live{font-size:12.5px;color:var(--muted,#79837C)}',
      '.mx-live a{color:var(--brand,#2E6A4B);font-weight:700}'
    ].join('');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- launcher injection (sibling of #expertBody so re-renders don't wipe it) ---------- */
  function placeLauncher() {
    try {
      var body = document.getElementById('expertBody');
      if (!body) return;
      if (document.getElementById('mlsExpertAdCta')) return;
      var cta = document.createElement('div');
      cta.id = 'mlsExpertAdCta';
      cta.innerHTML =
        '<div class="mx-ico">📣</div>' +
        '<div class="mx-txt"><b>Advertise yourself to attorneys</b>' +
        '<span>Build a full marketplace profile — photo, AI-polished bio, credentials, documents and licensed states — and choose to list publicly.</span></div>' +
        '<button class="mx-btn" type="button" id="mlsExpertAdOpen">Build my advertisement →</button>';
      if (body.parentNode) body.parentNode.insertBefore(cta, body.nextSibling);
      else body.appendChild(cta);
      var btn = document.getElementById('mlsExpertAdOpen');
      if (btn) btn.addEventListener('click', openEditor);
    } catch (e) { /* best effort */ }
  }

  /* ---------- file helpers ---------- */
  function readAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () { resolve(fr.result); };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(file);
    });
  }
  // Resize a photo client-side (real photo, just smaller). Returns JPEG data URL.
  function resizePhoto(file, maxDim) {
    return new Promise(function (resolve, reject) {
      var fr = new FileReader();
      fr.onload = function () {
        var img = new Image();
        img.onload = function () {
          try {
            var w = img.width, h = img.height;
            var scale = Math.min(1, maxDim / Math.max(w, h));
            var cw = Math.round(w * scale), ch = Math.round(h * scale);
            var cv = document.createElement('canvas');
            cv.width = cw; cv.height = ch;
            var ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0, cw, ch);
            resolve(cv.toDataURL('image/jpeg', 0.85));
          } catch (e) { reject(e); }
        };
        img.onerror = function () { reject(new Error('image load failed')); };
        img.src = fr.result;
      };
      fr.onerror = function () { reject(fr.error); };
      fr.readAsDataURL(file);
    });
  }

  /* ---------- modal ---------- */
  var STATE = { profile: null, docs: [], photoUrl: '', dirtyPhoto: false };

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

  function renderDocs() {
    var ul = document.getElementById('mxDocList');
    if (!ul) return;
    if (!STATE.docs.length) { ul.innerHTML = '<li style="color:var(--muted,#79837C);border-style:dashed">No documents yet — add your CV, a de-identified sample report, or board certificates.</li>'; return; }
    ul.innerHTML = STATE.docs.map(function (d) {
      return '<li data-id="' + d.id + '"><span>📄</span><span class="nm">' + esc(d.label || d.filename || 'Document') + '</span>' +
        '<button class="rm" type="button" title="Remove" data-id="' + d.id + '">✕</button></li>';
    }).join('');
    Array.prototype.forEach.call(ul.querySelectorAll('.rm'), function (b) {
      b.addEventListener('click', function () { removeDoc(b.getAttribute('data-id')); });
    });
  }

  function buildModal(p) {
    injectStyle();
    var ov = document.createElement('div');
    ov.id = 'mlsExpertOverlay';
    var statesSel = p.states || [];
    ov.innerHTML =
      '<div id="mlsExpertModal" role="dialog" aria-modal="true" aria-label="Attorney marketplace profile">' +
      '<div class="mx-hd"><span style="font-size:22px">⚖️</span><h2>List yourself on the attorney marketplace</h2>' +
      '<button class="mx-x" id="mxClose" aria-label="Close">×</button></div>' +
      '<div class="mx-bd">' +

        '<label class="mx-optin"><input type="checkbox" id="mxListed"' + (p.listed ? ' checked' : '') + '>' +
        '<span><b>List me publicly on the attorney marketplace</b>' +
        '<p>Off by default. When on, your profile appears in the public /lawyers directory and gets its own advertising page. Turn it off any time to go private.</p></span></label>' +

        '<div class="mx-sec"><h3>Photo</h3>' +
        '<div class="mx-photo">' +
        '<img id="mxPhotoPv" class="pv" alt="Headshot preview" style="display:' + (p.has_photo ? 'block' : 'none') + '" src="">' +
        '<div id="mxPhotoPh" class="ph" style="display:' + (p.has_photo ? 'none' : 'flex') + '">🩺</div>' +
        '<div><input type="file" id="mxPhotoFile" accept="image/png,image/jpeg,image/webp" style="display:none">' +
        '<button class="mx-btn ghost sm" type="button" id="mxPhotoBtn">Upload headshot</button> ' +
        '<button class="mx-btn ghost sm" type="button" id="mxPhotoRm" style="display:' + (p.has_photo ? 'inline-block' : 'none') + '">Remove</button>' +
        '<div class="mx-note">We use your <b>real</b> photo (resized only). We never create a fake or AI-generated likeness — authenticity matters for credibility.</div>' +
        '</div></div></div>' +

        '<div class="mx-sec"><h3>Who you are</h3>' +
        '<div class="mx-row">' +
        field('mxName', 'Full name', p.full_name, { ph: 'Jane A. Smith, MD' }) +
        field('mxCred', 'Credentials & board certifications', p.credentials, { ph: 'MD; Board-certified PM&R, Pain Medicine' }) +
        '</div><div class="mx-row">' +
        field('mxSpec', 'Specialty', p.specialty, { ph: 'Pain Management' }) +
        field('mxSub', 'Subspecialty', p.subspecialty, { ph: 'Interventional spine' }) +
        '</div>' +
        field('mxYears', 'Years in / actively practicing', p.years, { ph: 'e.g. 14 years; actively practicing' }) +
        '</div>' +

        '<div class="mx-sec"><h3>Licensed states / jurisdictions <span style="font-weight:600;color:var(--muted,#79837C);text-transform:none;letter-spacing:0">— attorneys see physicians in their state first</span></h3>' +
        statesGrid(statesSel) +
        '</div>' +

        '<div class="mx-sec"><h3>Testimony experience & availability</h3>' +
        field('mxDepoExp', 'Deposition experience', p.depo_experience, { textarea: true, rows: 2, ph: 'e.g. 30+ depositions for plaintiff and defense' }) +
        field('mxTrialExp', 'Trial / testimony experience', p.trial_experience, { textarea: true, rows: 2, ph: 'e.g. testified at trial 8 times' }) +
        field('mxAvail', 'Availability', p.availability, { ph: 'e.g. Reports in 24h; depo/trial by arrangement' }) +
        '</div>' +

        '<div class="mx-sec"><h3>Fees</h3>' +
        '<div class="mx-row">' +
        field('mxDepo', 'Deposition rate (USD/hr)', dollars(p.depo_rate_cents), { type: 'number', ph: '500' }) +
        field('mxTrial', 'Trial rate (USD/hr)', dollars(p.trial_rate_cents), { type: 'number', ph: '750' }) +
        '</div>' +
        field('mxFee', 'Fee notes', p.fee_info, { textarea: true, rows: 2, ph: 'Report fee $X; or "fees on request". Leave blank for "fees on request."' }) +
        '</div>' +

        '<div class="mx-sec"><h3>Your advertisement</h3>' +
        '<div class="mx-ai"><b>✨ Let AI polish your profile</b>' +
        '<p>Generates a professional headline and advertising copy from the facts you entered above. Nothing is fabricated — review and edit before saving.</p>' +
        '<button class="mx-btn sm" type="button" id="mxGen">Generate professional copy</button> ' +
        '<span id="mxGenMsg" class="mx-note" style="display:none"></span></div>' +
        field('mxHeadline', 'Headline', p.headline, { ph: 'Board-certified pain physician · IME & causation · 24-hour reports' }) +
        field('mxAdCopy', 'Advertising copy', p.ad_copy, { textarea: true, rows: 6, ph: 'A few short paragraphs attorneys will read on your page.' }) +
        field('mxBio', 'Short bio (directory card)', p.bio, { textarea: true, rows: 3, ph: 'One or two sentences shown on your directory card.' }) +
        '</div>' +

        '<div class="mx-sec"><h3>Documents</h3>' +
        '<input type="file" id="mxDocFile" accept=".pdf,.doc,.docx,.txt,image/*" style="display:none">' +
        '<button class="mx-btn ghost sm" type="button" id="mxDocBtn">+ Add document (CV, sample report, certificate)</button>' +
        '<ul class="mx-docs" id="mxDocList"></ul>' +
        '<div class="mx-note">Published documents are downloadable from your public ad page. Only upload de-identified material — no PHI.</div>' +
        '</div>' +

        '<div class="mx-sec"><h3>Links & contact</h3>' +
        field('mxCv', 'CV link (optional)', p.cv_url, { ph: 'https://…' }) +
        field('mxContact', 'Contact / booking preference', p.contact_pref, { ph: 'Request via portal; or email; or phone for scheduling' }) +
        '</div>' +

      '</div>' +
      '<div class="mx-ft">' +
        '<span id="mxMsg" class="mx-msg"></span>' +
        '<span id="mxLive" class="mx-live"></span>' +
        '<button class="mx-btn ghost" type="button" id="mxCancel">Close</button>' +
        '<button class="mx-btn" type="button" id="mxSave">Save profile</button>' +
      '</div>' +
      '</div>';
    document.body.appendChild(ov);

    // wire
    document.getElementById('mxClose').addEventListener('click', closeEditor);
    document.getElementById('mxCancel').addEventListener('click', closeEditor);
    ov.addEventListener('click', function (e) { if (e.target === ov) closeEditor(); });
    document.getElementById('mxSave').addEventListener('click', saveProfile);
    document.getElementById('mxGen').addEventListener('click', generateCopy);
    document.getElementById('mxPhotoBtn').addEventListener('click', function () { document.getElementById('mxPhotoFile').click(); });
    document.getElementById('mxPhotoFile').addEventListener('change', onPhotoPick);
    document.getElementById('mxPhotoRm').addEventListener('click', removePhoto);
    document.getElementById('mxDocBtn').addEventListener('click', function () { document.getElementById('mxDocFile').click(); });
    document.getElementById('mxDocFile').addEventListener('change', onDocPick);
    updateLiveLink();
    renderDocs();
    if (p.has_photo) loadPhotoPreview();
  }

  // The clinician preview endpoint requires a Bearer token, which an <img src>
  // cannot send — so fetch it with auth and show it as an object URL.
  async function loadPhotoPreview() {
    try {
      var pv = document.getElementById('mxPhotoPv');
      if (!pv) return;
      var r = await fetch(base() + '/api/expert/me/photo', { headers: authHeaders(false) });
      if (!r.ok) return;
      var blob = await r.blob();
      if (pv.__url) { try { URL.revokeObjectURL(pv.__url); } catch (e) {} }
      pv.__url = URL.createObjectURL(blob);
      pv.src = pv.__url;
      pv.style.display = 'block';
      var ph = document.getElementById('mxPhotoPh'); if (ph) ph.style.display = 'none';
    } catch (e) { /* preview is best-effort */ }
  }

  function updateLiveLink() {
    var el = document.getElementById('mxLive');
    if (!el || !STATE.profile) return;
    var listed = document.getElementById('mxListed');
    if (listed && listed.checked && STATE.profile.public_url) {
      // public_url is /lawyers/expert.html?id=NN -> link on the live site origin
      var href = (location.origin && location.origin.indexOf('http') === 0)
        ? (location.origin + STATE.profile.public_url)
        : STATE.profile.public_url;
      el.innerHTML = '🔗 <a href="' + esc(href) + '" target="_blank" rel="noopener">View my public page</a>';
    } else {
      el.textContent = '';
    }
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
      var r = await fetch(base() + '/api/expert/me', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'Save failed');
      STATE.profile.public_url = d.public_url || STATE.profile.public_url;
      STATE.profile.listed = d.listed;
      msg(d.listed ? '✓ Saved — you are listed on the marketplace.' : '✓ Saved (not listed publicly).', 'ok');
      updateLiveLink();
      try { if (typeof window.loadExpertProfile === 'function') window.loadExpertProfile(); } catch (e) {}
    } catch (e) {
      msg(e.message || 'Could not save.', 'err');
    } finally { if (btn) btn.disabled = false; }
  }

  async function generateCopy() {
    var btn = document.getElementById('mxGen');
    var gm = document.getElementById('mxGenMsg');
    if (btn) btn.disabled = true;
    if (gm) { gm.style.display = 'inline'; gm.textContent = 'Generating professional copy…'; }
    try {
      var body = collect();
      var r = await fetch(base() + '/api/expert/me/generate-bio', { method: 'POST', headers: authHeaders(true), body: JSON.stringify(body) });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'Generation failed');
      if (d.headline) document.getElementById('mxHeadline').value = d.headline;
      if (d.ad_copy) document.getElementById('mxAdCopy').value = d.ad_copy;
      if (d.summary && !document.getElementById('mxBio').value.trim()) document.getElementById('mxBio').value = d.summary;
      if (gm) gm.textContent = '✓ Draft created — review and edit, then Save.';
    } catch (e) {
      if (gm) gm.textContent = (e.message || 'Could not generate.') + ' You can write your bio manually.';
    } finally { if (btn) btn.disabled = false; }
  }

  async function onPhotoPick(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    msg('Uploading photo…');
    try {
      var dataUrl = await resizePhoto(file, 800);
      var r = await fetch(base() + '/api/expert/me/photo', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ data: dataUrl, mimetype: 'image/jpeg', filename: (file.name || 'headshot').replace(/\.[^.]+$/, '') + '.jpg' })
      });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      var pv = document.getElementById('mxPhotoPv'), ph = document.getElementById('mxPhotoPh'), rm = document.getElementById('mxPhotoRm');
      pv.style.display = 'block'; ph.style.display = 'none'; rm.style.display = 'inline-block';
      loadPhotoPreview();
      STATE.profile.has_photo = true;
      msg('✓ Photo uploaded.', 'ok');
    } catch (e) { msg(e.message || 'Photo upload failed.', 'err'); }
    finally { ev.target.value = ''; }
  }

  async function removePhoto() {
    msg('Removing photo…');
    try {
      await fetch(base() + '/api/expert/me/photo', { method: 'DELETE', headers: authHeaders(false) });
      var pv = document.getElementById('mxPhotoPv'), ph = document.getElementById('mxPhotoPh'), rm = document.getElementById('mxPhotoRm');
      pv.style.display = 'none'; pv.src = ''; ph.style.display = 'flex'; rm.style.display = 'none';
      STATE.profile.has_photo = false;
      msg('Photo removed.', 'ok');
    } catch (e) { msg('Could not remove photo.', 'err'); }
  }

  async function onDocPick(ev) {
    var file = ev.target.files && ev.target.files[0];
    if (!file) return;
    msg('Uploading document…');
    try {
      if (file.size > 12 * 1024 * 1024) throw new Error('File too large (12MB max).');
      var dataUrl = await readAsDataURL(file);
      var r = await fetch(base() + '/api/expert/me/documents', {
        method: 'POST', headers: authHeaders(true),
        body: JSON.stringify({ data: dataUrl, mimetype: file.type || 'application/octet-stream', filename: file.name || 'document', label: file.name || 'Document' })
      });
      var d = await r.json().catch(function () { return {}; });
      if (!r.ok) throw new Error(d.error || 'Upload failed');
      STATE.docs.push({ id: d.id, label: d.label || file.name, filename: file.name, mimetype: file.type, size: d.size });
      renderDocs();
      msg('✓ Document added.', 'ok');
    } catch (e) { msg(e.message || 'Document upload failed.', 'err'); }
    finally { ev.target.value = ''; }
  }

  async function removeDoc(id) {
    try {
      await fetch(base() + '/api/expert/me/documents/' + encodeURIComponent(id), { method: 'DELETE', headers: authHeaders(false) });
      STATE.docs = STATE.docs.filter(function (d) { return String(d.id) !== String(id); });
      renderDocs();
    } catch (e) { msg('Could not remove document.', 'err'); }
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
      var r = await fetch(base() + '/api/expert/me', { headers: authHeaders(false) });
      if (!r.ok) {
        shell.querySelector('.mx-bd').innerHTML = 'This editor is available to clinician accounts. (' + r.status + ')';
        setTimeout(closeEditor, 1800);
        return;
      }
      var p = await r.json();
      STATE.profile = p;
      STATE.docs = Array.isArray(p.documents) ? p.documents.slice() : [];
      closeEditor();
      buildModal(p);
      // keep the live link in sync when toggling listed
      var lc = document.getElementById('mxListed');
      if (lc) lc.addEventListener('change', updateLiveLink);
    } catch (e) {
      if (shell.querySelector('.mx-bd')) shell.querySelector('.mx-bd').textContent = 'Could not load your profile.';
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
