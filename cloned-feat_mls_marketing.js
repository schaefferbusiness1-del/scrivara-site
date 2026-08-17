/* MLS 1p Free Marketing workspace — mkt-p1-1.0.0
 *
 * Preview-only, local/session-memory drafting. This module never reads patient
 * data, never contacts a server, never stores a draft, and never publishes,
 * sends, schedules, connects, or spends. Its only exits are explicit copy and
 * plain-text download after the still-current account/session is revalidated.
 */
(function () {
  'use strict';

  var VERSION = 'mkt-p1-1.0.0';
  var LOADER_KEY = '__mlsP1MarketingLoader';
  var API_KEY = '__mlsP1Marketing';
  var installScript = document.currentScript;
  var installToken = installScript && installScript.getAttribute('data-mls-install-token');
  var loader = window[LOADER_KEY];
  var preview = window.__MLS_CLONED;
  if (!preview || preview.enabled !== true || !loader || loader.installed !== true ||
      loader.version !== VERSION || !installToken || loader.installToken !== installToken) return;

  var prior = window[API_KEY];
  if (prior && prior.installed === true) {
    if (prior.version === VERSION && prior.installToken === installToken) {
      if (typeof prior.reconcile !== 'function' || typeof prior.revert !== 'function' || typeof prior.isDirty !== 'function' ||
          typeof prior.open !== 'function' || typeof prior.close !== 'function') return;
      var sameOwner = prior;
      try { prior.reconcile(); } catch (_sameOwnerError) { return; }
      if (window[API_KEY] === sameOwner && sameOwner.installed === true) return;
      return;
    }
    if (typeof prior.isDirty !== 'function' || prior.isDirty()) return;
    if (typeof prior.revert !== 'function') return;
    try { prior.revert(); } catch (_priorError) { return; }
    if (prior.installed === true || (window[API_KEY] && window[API_KEY].installed === true)) return;
  }

  var D = document;
  var host = null, door = null, calmDoor = null, styleNode = null, menuObserver = null, backgroundNodes = [];
  var permanentListeners = [], workspaceListeners = [], generation = 0, workspaceOwner = null;
  var receipts = 0;
  var legacyNodes = [], reachOriginals = null, opener = null, dirty = false;

  function safe(fn, fallback) { try { return fn(); } catch (_e) { return fallback; } }
  function byId(id) { return D.getElementById(id); }
  function text(value) { return String(value == null ? '' : value).trim(); }
  function norm(value) { return text(value).toLowerCase(); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function on(target, name, fn, workspaceOwned) {
    if (!target || !target.addEventListener) return;
    target.addEventListener(name, fn); (workspaceOwned ? workspaceListeners : permanentListeners).push([target, name, fn]);
  }
  function clearListenerList(list) {
    list.forEach(function (item) { safe(function () { item[0].removeEventListener(item[1], item[2]); }); });
    list.length = 0;
  }
  function currentAccount() {
    var receipt = safe(function () { return window.__mlsP1MarketingIdentity && window.__mlsP1MarketingIdentity(); }, null);
    if (!receipt || receipt.resolved !== true) return null;
    var email = norm(receipt.email), role = norm(receipt.role), epoch = Number(receipt.epoch);
    if (!email || !role || !isFinite(epoch) || epoch < 1) return null;
    var blocked = receipt.isLawyer === true || role === 'lawyer' || role === 'patient' ||
      role === 'public' || role === 'receptionist';
    var allowed = !blocked && ['admin', 'owner', 'practice_owner', 'head', 'doctor', 'user'].indexOf(role) >= 0;
    if (!allowed) return null;
    return { email: email, role: role, epoch: epoch };
  }
  function accountMatches(owner) {
    if (!currentApi()) return false;
    var now = currentAccount(); return !!(owner && now && owner.email === now.email && owner.role === now.role && owner.epoch === now.epoch);
  }
  function currentApi() {
    var liveLoader = window[LOADER_KEY];
    return !!(api && api.installed === true && api.installToken === installToken && window[API_KEY] === api &&
      preview && preview.enabled === true && liveLoader && liveLoader.installed === true &&
      liveLoader.version === VERSION && liveLoader.installToken === installToken);
  }
  function practiceIdentity() {
    /* Canonical non-PHI practice getters may read account-namespaced Settings.
       This module never directly reads storage, patients, visits, notes, or AI. */
    return {
      practice: text(safe(function () { return window.getPracticeName && window.getPracticeName(); }, '')),
      provider: text(safe(function () { return window.getProviderName && window.getProviderName(); }, '')),
      credentials: text(safe(function () { return window.getProviderCred && window.getProviderCred(); }, '')),
      specialty: text(safe(function () { return window.getSpec && window.getSpec(); }, '')),
      phone: text(safe(function () { return window.getClinicPhone && window.getClinicPhone(); }, '')),
      address: text(safe(function () { return window.getClinicAddress && window.getClinicAddress(); }, '')),
      maps: text(safe(function () { return window.getGoogleBusinessUrl && window.getGoogleBusinessUrl(); }, ''))
    };
  }
  function displayPractice(identity) { return identity.practice || 'Your practice'; }
  function receipt(kind, ok, message) {
    if (!currentApi()) return;
    var box = byId('mlsP1MktReceipt'); if (!box) return;
    receipts += 1;
    box.hidden = false; box.className = 'mkt-receipt ' + (ok ? 'ok' : 'bad');
    box.textContent = (ok ? '✓ ' : 'Could not ') + kind + (message ? ' — ' + message : '') + ' · receipt ' + receipts;
  }
  function scrub() {
    generation += 1; receipts = 0; workspaceOwner = null;
    clearListenerList(workspaceListeners);
    if (host) {
      var fields = host.querySelectorAll && host.querySelectorAll('input,textarea,select');
      for (var i = 0; fields && i < fields.length; i++) {
        if (String(fields[i].type || '').toLowerCase() === 'checkbox' || String(fields[i].type || '').toLowerCase() === 'radio') fields[i].checked = false;
        else { fields[i].value = ''; if (fields[i].tagName === 'SELECT') fields[i].selectedIndex = 0; }
        if (fields[i].__fpFmt && fields[i].__fpFmt.mlsMarketingFence === true) delete fields[i].__fpFmt;
      }
      host.remove(); host = null;
    }
    backgroundNodes.forEach(function (record) {
      var node = record.node; if (!node) return;
      /* HTMLElement.inert is normally a prototype accessor. Deleting an own
         property does not restore it, so always write the recorded boolean. */
      try { node.inert = !!record.inert; } catch (_inertRestoreError) {}
      if (node.removeAttribute) {
        if (record.inertAttribute == null) node.removeAttribute('inert'); else node.setAttribute('inert', record.inertAttribute);
        if (record.ariaHidden == null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', record.ariaHidden);
      }
    });
    backgroundNodes = [];
    dirty = false;
  }
  function deny() {
    scrub(); reconcileDoor();
    safe(function () { if (window.toast) window.toast('Marketing is available to a signed-in clinician or practice owner. Nothing opened.', 'err'); });
    return false;
  }
  function setOutput(id, value) {
    var el = byId(id);
    if (el && el.value !== value) { el.value = value; dirty = true; }
  }
  function val(id) { var el = byId(id); return text(el && el.value); }
  function checked(id) { var el = byId(id); return !!(el && el.checked); }
  function copyText(value, label, owner, token) {
    if (!value) { receipt(label, false, 'nothing to copy'); return; }
    if (!accountMatches(owner) || token !== generation) return;
    var promise = safe(function () { return navigator.clipboard && navigator.clipboard.writeText(value); }, null);
    if (!promise || typeof promise.then !== 'function') { receipt(label, false, 'clipboard unavailable'); return; }
    Promise.resolve(promise).then(function () {
      /* A late completion belongs to the old workspace. Never write even an
         error receipt into a newly opened workspace for the same account. */
      if (!accountMatches(owner) || token !== generation) return;
      receipt(label, true, 'copied locally');
    }, function () { if (accountMatches(owner) && token === generation) receipt(label, false, 'clipboard unavailable'); });
  }
  function downloadText(value, label, filename, owner, token) {
    if (!value) { receipt(label, false, 'nothing to download'); return; }
    if (!accountMatches(owner) || token !== generation) return;
    var blob = new Blob([value], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    if (!accountMatches(owner) || token !== generation) { URL.revokeObjectURL(url); return; }
    var a = D.createElement('a'); a.href = url; a.download = filename; a.rel = 'noopener';
    (D.body || D.documentElement).appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    receipt(label, true, 'downloaded as text');
  }
  function bindExport(copyId, downloadId, outputId, label, filename, owner, token) {
    on(byId(copyId), 'click', function () { copyText(val(outputId), label, owner, token); }, true);
    on(byId(downloadId), 'click', function () { downloadText(val(outputId), label, filename, owner, token); }, true);
  }
  function fenceTextInputs() {
    if (!host || !host.querySelectorAll) return;
    var fields = host.querySelectorAll('textarea,input:not([type]),input[type="text"],input[type="url"],input[type="search"],input[type="email"],input[type="tel"]');
    for (var i = 0; i < fields.length; i++) {
      fields[i].setAttribute('data-mls-no-dictate', '1');
      fields[i].setAttribute('spellcheck', 'false');
      fields[i].setAttribute('autocomplete', 'off');
      if (fields[i].tagName === 'TEXTAREA' && !fields[i].__fpFmt) fields[i].__fpFmt = { mlsMarketingFence: true };
    }
  }
  function listingAudit(identity) {
    var items = [
      ['Practice name', !!identity.practice, 'Use the exact name patients see on signage and your website.'],
      ['Provider name', !!identity.provider, 'Add the clinician name patients actually search.'],
      ['Specialty', !!identity.specialty, 'Name your primary specialty in plain language.'],
      ['Phone', !!identity.phone, 'Use the same main phone everywhere.'],
      ['Address', !!identity.address, 'Match the exact street, suite, city, state, and ZIP.'],
      ['Google Business / Maps link', /^https?:\/\//i.test(identity.maps), 'Add the direct listing link in Settings.'],
      ['Website', !!val('mlsP1MktWebsite'), 'Enter the practice website used on listings.'],
      ['Office hours', !!val('mlsP1MktHours'), 'List regular and holiday hours consistently.'],
      ['Services', !!val('mlsP1MktServices'), 'Use patient-friendly services, not billing codes.'],
      ['Photos', checked('mlsP1MktPhotos'), 'Plan a current exterior, entrance, reception, and clinician photo.']
    ];
    var ready = items.filter(function (x) { return x[1]; }).length;
    var score = Math.round((ready / items.length) * 100);
    byId('mlsP1MktScore').textContent = score + '%';
    byId('mlsP1MktScoreNote').textContent = ready + ' of ' + items.length + ' essentials ready';
    byId('mlsP1MktChecklist').innerHTML = items.map(function (x) {
      return '<li class="' + (x[1] ? 'done' : 'todo') + '"><span aria-hidden="true">' + (x[1] ? '✓' : '○') + '</span><div><b>' + escapeHtml(x[0]) + '</b><small>' + escapeHtml(x[1] ? 'Ready — verify before publishing.' : x[2]) + '</small></div></li>';
    }).join('');
    var missing = items.filter(function (x) { return !x[1]; }).map(function (x) { return '- ' + x[0] + ': ' + x[2]; });
    setOutput('mlsP1MktListingOutput', displayPractice(identity) + ' — listing readiness snapshot\n' +
      'Score: ' + score + '% (' + ready + '/' + items.length + ')\n\nBefore publishing\n' +
      (missing.length ? missing.join('\n') : '- Recheck every field against the live listing and website.') +
      '\n- Confirm accessibility, parking, phone routing, and holiday hours.\n- Preview the listing on phone and desktop.\n\nDraft only — MLS did not update any listing.');
  }
  function draftReply(identity) {
    var sentiment = val('mlsP1MktReplySentiment') || 'neutral';
    var category = val('mlsP1MktReplyCategory') || 'general experience';
    var tone = val('mlsP1MktReplyTone') || 'warm';
    var positive = sentiment === 'positive';
    var concern = sentiment === 'critical';
    var practice = displayPractice(identity);
    var opening = positive ? 'Thank you for the kind words.' : concern ? 'Thank you for taking the time to share this feedback.' : 'Thank you for sharing your feedback.';
    var middle = concern ? 'We take concerns about ' + category + ' seriously and would welcome the chance to listen and help.' : 'Our team appreciates your thoughtful note about ' + category + '.';
    if (tone === 'concise') middle = concern ? 'We take this seriously and would welcome a private conversation.' : 'Our team truly appreciates it.';
    if (tone === 'formal') middle = concern ? 'Your concerns matter to us, and we invite you to contact our office so the appropriate team member can listen.' : 'We appreciate your thoughtful comments about the team.';
    var closing = concern ? (' Please contact ' + practice + (identity.phone ? ' at ' + identity.phone : ' directly') + ' so we can speak privately.') :
      (' Thank you for helping people learn more about ' + practice + '.');
    setOutput('mlsP1MktReplyOutput', opening + ' ' + middle + closing);
    byId('mlsP1MktReplyGuard').textContent = 'Privacy check: this draft does not confirm patient status, treatment, diagnosis, or visit details. Review it against the original public post before copying.';
  }
  function planCampaign(identity) {
    var channel = val('mlsP1MktCampaignChannel') || 'Email';
    var timing = val('mlsP1MktCampaignTiming') || '2 days after a completed visit';
    var link = val('mlsP1MktReviewLink') || '[add your review link]';
    var optout = channel === 'Text message' ? ' Reply STOP to opt out.' :
      channel === 'Email' ? ' Use the unsubscribe or communication-preference link to opt out.' :
      ' Contact the office if you prefer not to receive future review requests.';
    var message = val('mlsP1MktCampaignMessage') || ('Thank you for choosing ' + displayPractice(identity) + '. If you would like to share feedback, you can leave an honest review here: ' + link + '.' + optout);
    var rules = [
      checked('mlsP1MktConsent') ? '✓ Send only after documented permission for this channel is verified.' : '□ BLOCKED: documented contact permission has not been attested.',
      checked('mlsP1MktOptout') ? '✓ Exclude opt-outs, do-not-contact records, and prior requests.' : '□ BLOCKED: opt-out suppression has not been attested.',
      checked('mlsP1MktNoGate') ? '✓ Ask everyone by a neutral rule; never filter by satisfaction or offer incentives.' : '□ BLOCKED: neutral selection/no-incentive rule has not been attested.'
    ];
    setOutput('mlsP1MktCampaignOutput', displayPractice(identity) + ' — review campaign plan\n' +
      'Channel: ' + channel + '\nTiming: ' + timing + '\nAudience: no patient list is loaded; build recipients manually in your approved system.\n\nMessage draft\n' + message +
      '\n\nConsent and fairness gate\n' + rules.join('\n') +
      '\n\nManual next step\nCompliance-check the message and recipient rules, then copy this plan into an approved communication system. MLS did not select recipients, schedule, or send anything.');
  }
  function planAds(identity) {
    var service = val('mlsP1MktAdService') || 'your priority service';
    var area = val('mlsP1MktAdArea') || 'your service area';
    var daily = Math.min(10000, Math.max(0, Number(val('mlsP1MktAdBudget')) || 0));
    var days = Math.max(1, Math.min(365, Number(val('mlsP1MktAdDays')) || 30));
    var monthly = daily * days;
    var name = displayPractice(identity);
    var headline1 = (service + ' in ' + area).slice(0, 30);
    var headline2 = ('Meet ' + (identity.provider || name)).slice(0, 30);
    var headline3 = ('Call ' + (identity.phone || 'Our Office')).slice(0, 30);
    var description = ('Learn about ' + service + ' from ' + name + '. Review options and request an appointment.').slice(0, 90);
    setOutput('mlsP1MktAdsOutput', name + ' — Google Ads draft\n' +
      'Goal: qualified appointment inquiries\nService: ' + service + '\nLocation: ' + area + '\n\nHeadlines (30-character preview)\n1. ' + headline1 + '\n2. ' + headline2 + '\n3. ' + headline3 +
      '\n\nDescription (90-character preview)\n' + description +
      '\n\nBudget preview\nDaily cap: $' + daily.toFixed(2) + '\nPlanning days: ' + days + '\nMaximum planning envelope: $' + monthly.toFixed(2) +
      '\nThis is simple daily cap × days, not a forecast, quote, or Google charge.\n\nBefore you publish\n- Verify ad-policy, licensing, substantiation, landing-page, geography, and call-tracking requirements.\n- Avoid guarantees, superlatives, diagnosis targeting, and sensitive health-personalization.\n- Launch and budget approval are manual in your own Google Ads account. MLS did not connect, publish, launch, or spend.');
  }
  function css() {
    if (byId('mlsP1MktCss')) return;
    styleNode = D.createElement('style'); styleNode.id = 'mlsP1MktCss';
    styleNode.textContent =
      '#mlsP1MktWorkspace{position:fixed;inset:0;z-index:100060;background:#F6F4EE;color:#17382E;overflow:auto;font:15px/1.5 "Public Sans",system-ui,sans-serif}'+
      '#mlsP1MktWorkspace *{box-sizing:border-box}#mlsP1MktWorkspace .mkt-shell{max-width:1180px;margin:auto;padding:28px 22px 90px}'+
      '#mlsP1MktWorkspace .mkt-top{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:18px}'+
      '#mlsP1MktWorkspace h1{font:750 clamp(30px,5vw,52px)/1.04 Georgia,serif;margin:6px 0 8px}#mlsP1MktWorkspace h2{font-size:19px;margin:0 0 5px}'+
      '#mlsP1MktWorkspace .eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.12em;font-weight:800;color:#2E6A4B}'+
      '#mlsP1MktWorkspace .boundary{background:#204034;color:#fff;border-radius:15px;padding:13px 15px;margin:0 0 18px;font-weight:700}'+
      '#mlsP1MktWorkspace .identity{display:flex;gap:12px;flex-wrap:wrap;color:#5D6B65;margin-bottom:20px}#mlsP1MktWorkspace .identity span{background:#fff;border:1px solid #D8DDD7;border-radius:999px;padding:6px 10px}'+
      '#mlsP1MktWorkspace .mkt-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}'+
      '#mlsP1MktWorkspace .mkt-card{background:#fff;border:1px solid #DADFD9;border-radius:18px;padding:20px;box-shadow:0 10px 28px rgba(32,64,52,.06)}'+
      '#mlsP1MktWorkspace .mkt-card.wide{grid-column:1/-1}#mlsP1MktWorkspace .mkt-help{margin:0 0 14px;color:#607069}'+
      '#mlsP1MktWorkspace label{display:block;font-weight:700;margin:10px 0 5px}#mlsP1MktWorkspace input,#mlsP1MktWorkspace textarea,#mlsP1MktWorkspace select{width:100%;border:1px solid #BCC8C0;border-radius:10px;padding:10px 11px;font:inherit;color:#17382E;background:#fff}'+
      '#mlsP1MktWorkspace textarea{min-height:110px;resize:vertical}#mlsP1MktWorkspace textarea.output{min-height:190px;background:#FCFBF8}'+
      '#mlsP1MktWorkspace .mkt-row{display:flex;gap:9px;align-items:center;flex-wrap:wrap;margin-top:12px}#mlsP1MktWorkspace button{border:0;border-radius:10px;padding:10px 14px;font:700 14px inherit;cursor:pointer}'+
      '#mlsP1MktWorkspace .primary{background:#2E6A4B;color:#fff}#mlsP1MktWorkspace .secondary{background:#EDF3EF;color:#204034;border:1px solid #CEDAD2}#mlsP1MktWorkspace .close{background:#fff;color:#204034;border:1px solid #C9D2CC}'+
      '#mlsP1MktWorkspace .checks label{display:flex;gap:8px;align-items:flex-start;font-weight:500}#mlsP1MktWorkspace .checks input{width:auto;margin-top:5px}'+
      '#mlsP1MktWorkspace .score{display:flex;align-items:center;gap:16px;margin:12px 0}#mlsP1MktWorkspace .score strong{font:800 36px Georgia,serif}'+
      '#mlsP1MktChecklist{list-style:none;padding:0;margin:12px 0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}#mlsP1MktChecklist li{display:flex;gap:8px;border-radius:10px;padding:9px;background:#F7F8F5}#mlsP1MktChecklist li.done{color:#236647}#mlsP1MktChecklist li.todo{color:#7C5B18;background:#FFF8E8}#mlsP1MktChecklist small{display:block;color:#607069}'+
      '#mlsP1MktWorkspace .guard{font-size:12.5px;background:#EFF6F1;border:1px solid #CDE0D3;border-radius:10px;padding:9px;margin-top:10px;color:#355E4B}'+
      '#mlsP1MktWorkspace .mkt-receipt{position:sticky;bottom:12px;margin:18px auto 0;max-width:780px;border-radius:11px;padding:10px 13px;box-shadow:0 8px 22px rgba(32,64,52,.13);background:#E6F5EA;color:#1B633D;font-weight:700;text-align:center}#mlsP1MktWorkspace .mkt-receipt.bad{background:#FFF1EC;color:#9A3E2B}'+
      '#mlsP1MktDoor{min-height:44px}'+
      '#mlsP1MktCalmDoor{min-height:76px}'+
      '#mlsPtab_reviews,.mls-menu-reviews,#mlsEasyTools [data-target="mlsPtab_reviews"],#ez3sReviews{display:none!important}'+
      '@media(max-width:760px){#mlsP1MktWorkspace .mkt-grid{grid-template-columns:1fr}#mlsP1MktWorkspace .mkt-card.wide{grid-column:auto}#mlsP1MktChecklist{grid-template-columns:1fr}#mlsP1MktWorkspace .mkt-top{align-items:stretch}#mlsP1MktWorkspace .mkt-top button{flex:none}}'+
      '@media(prefers-reduced-motion:reduce){#mlsP1MktWorkspace *{scroll-behavior:auto!important;animation:none!important;transition:none!important}}';
    (D.head || D.documentElement).appendChild(styleNode);
  }
  function workspaceHtml(identity) {
    var name = displayPractice(identity);
    return '<div class="mkt-shell">'+
      '<div class="mkt-top"><div><div class="eyebrow">Preview · Free · Draft-only</div><h1 id="mlsP1MktTitle">Marketing workspace</h1><p class="mkt-help">Build polished, editable materials for ' + escapeHtml(name) + ' without connecting an ad, review, or messaging account.</p></div><div class="mkt-row"><button class="secondary" id="mlsP1MktClear" type="button">Clear drafts</button><button class="close" id="mlsP1MktClose" type="button">Close</button></div></div>'+
      '<div class="boundary" role="note">Draft only — nothing publishes, contacts patients, connects an account, or spends money. Do not enter patient or reviewer information. MLS keeps these drafts only in this open tab and clears them when the account changes.</div>'+
      '<div class="identity" aria-label="Practice identity"><span><b>Practice:</b> ' + escapeHtml(name) + '</span><span><b>Provider:</b> ' + escapeHtml(identity.provider || 'Add in Settings') + '</span><span><b>Location:</b> ' + escapeHtml(identity.address || 'Add in Settings') + '</span></div>'+
      '<div class="mkt-grid">'+
      '<section class="mkt-card wide" aria-labelledby="mktListingTitle"><h2 id="mktListingTitle">1. Practice listing snapshot</h2><p class="mkt-help">Score the essentials patients rely on, then use the before-you-publish checklist.</p><div class="mkt-row"><div style="flex:1;min-width:210px"><label for="mlsP1MktWebsite">Practice website</label><input id="mlsP1MktWebsite" type="url" maxlength="300" placeholder="https://yourpractice.example" autocomplete="off"></div><div style="flex:1;min-width:210px"><label for="mlsP1MktHours">Office hours</label><input id="mlsP1MktHours" maxlength="200" placeholder="Mon–Fri, 8:00 AM–5:00 PM" autocomplete="off"></div><div style="flex:1;min-width:210px"><label for="mlsP1MktServices">Core services</label><input id="mlsP1MktServices" maxlength="500" placeholder="Three patient-friendly services" autocomplete="off"></div></div><div class="checks"><label><input id="mlsP1MktPhotos" type="checkbox"> Current exterior, entrance, reception, and clinician photos are planned.</label></div><div class="mkt-row"><button class="primary" id="mlsP1MktAudit" type="button">Run completeness check</button></div><div class="score" aria-live="polite"><strong id="mlsP1MktScore">—</strong><span id="mlsP1MktScoreNote">Run the check to score 10 essentials</span></div><ul id="mlsP1MktChecklist"></ul><label for="mlsP1MktListingOutput">Editable listing plan</label><textarea class="output" maxlength="12000" id="mlsP1MktListingOutput"></textarea><div class="mkt-row"><button class="secondary" id="mlsP1MktListingCopy" type="button">Copy plan</button><button class="secondary" id="mlsP1MktListingDownload" type="button">Download .txt</button></div></section>'+
      '<section class="mkt-card" aria-labelledby="mktReplyTitle"><h2 id="mktReplyTitle">2. Public review reply</h2><p class="mkt-help">Choose only broad public context. MLS never asks for or imports review text, reviewer identity, visit details, or patient information.</p><label for="mlsP1MktReplySentiment">Review sentiment</label><select id="mlsP1MktReplySentiment"><option value="positive">Positive</option><option value="neutral">Neutral</option><option value="critical">Critical</option></select><label for="mlsP1MktReplyCategory">General topic</label><select id="mlsP1MktReplyCategory"><option value="general experience">General experience</option><option value="communication">Communication</option><option value="wait time">Wait time</option><option value="scheduling">Scheduling</option><option value="office experience">Office experience</option></select><label for="mlsP1MktReplyTone">Tone</label><select id="mlsP1MktReplyTone"><option value="warm">Warm</option><option value="concise">Concise</option><option value="formal">Formal</option></select><div class="mkt-row"><button class="primary" id="mlsP1MktDraftReply" type="button">Draft reply locally</button></div><label for="mlsP1MktReplyOutput">Editable reply</label><textarea class="output" maxlength="6000" id="mlsP1MktReplyOutput"></textarea><div class="guard" id="mlsP1MktReplyGuard">Never confirm the reviewer was a patient or mention care, diagnosis, treatment, or dates.</div><div class="mkt-row"><button class="secondary" id="mlsP1MktReplyCopy" type="button">Copy reply</button><button class="secondary" id="mlsP1MktReplyDownload" type="button">Download .txt</button></div></section>'+
      '<section class="mkt-card" aria-labelledby="mktCampaignTitle"><h2 id="mktCampaignTitle">3. Consent-aware review campaign</h2><p class="mkt-help">Plan the message and safeguards only. This preview never loads recipients or sends.</p><label for="mlsP1MktCampaignChannel">Channel</label><select id="mlsP1MktCampaignChannel"><option>Email</option><option>Text message</option><option>Printed card</option></select><label for="mlsP1MktCampaignTiming">Timing</label><input id="mlsP1MktCampaignTiming" maxlength="200" value="2 days after a completed visit" autocomplete="off"><label for="mlsP1MktReviewLink">Review link</label><input id="mlsP1MktReviewLink" type="url" maxlength="500" placeholder="https://..." autocomplete="off"><label for="mlsP1MktCampaignMessage">Editable message</label><textarea id="mlsP1MktCampaignMessage" maxlength="3000" placeholder="A neutral request for honest feedback"></textarea><div class="checks"><label><input id="mlsP1MktConsent" type="checkbox"> I will verify documented permission for the chosen channel.</label><label><input id="mlsP1MktOptout" type="checkbox"> I will suppress opt-outs, do-not-contact records, and prior requests.</label><label><input id="mlsP1MktNoGate" type="checkbox"> I will use a neutral rule, never satisfaction-gate or incentivize reviews.</label></div><div class="mkt-row"><button class="primary" id="mlsP1MktPlanCampaign" type="button">Build campaign plan</button></div><label for="mlsP1MktCampaignOutput">Editable plan</label><textarea class="output" maxlength="10000" id="mlsP1MktCampaignOutput"></textarea><div class="mkt-row"><button class="secondary" id="mlsP1MktCampaignCopy" type="button">Copy plan</button><button class="secondary" id="mlsP1MktCampaignDownload" type="button">Download .txt</button></div></section>'+
      '<section class="mkt-card wide" aria-labelledby="mktAdsTitle"><h2 id="mktAdsTitle">4. Google Ads draft & budget preview</h2><p class="mkt-help">Shape compliant campaign copy and a simple maximum planning envelope. No Google connection, forecast, launch, or spend.</p><div class="mkt-row"><div style="flex:2;min-width:220px"><label for="mlsP1MktAdService">Service to promote</label><input id="mlsP1MktAdService" maxlength="200" placeholder="e.g. Spine consultation" autocomplete="off"></div><div style="flex:2;min-width:220px"><label for="mlsP1MktAdArea">Service area</label><input id="mlsP1MktAdArea" maxlength="200" placeholder="e.g. Chester County" autocomplete="off"></div><div style="flex:1;min-width:140px"><label for="mlsP1MktAdBudget">Daily cap ($)</label><input id="mlsP1MktAdBudget" type="number" min="0" max="10000" step="1" value="20"></div><div style="flex:1;min-width:140px"><label for="mlsP1MktAdDays">Planning days</label><input id="mlsP1MktAdDays" type="number" min="1" max="365" value="30"></div></div><div class="mkt-row"><button class="primary" id="mlsP1MktPlanAds" type="button">Build ad & budget draft</button></div><label for="mlsP1MktAdsOutput">Editable ad plan</label><textarea class="output" maxlength="10000" id="mlsP1MktAdsOutput"></textarea><div class="mkt-row"><button class="secondary" id="mlsP1MktAdsCopy" type="button">Copy draft</button><button class="secondary" id="mlsP1MktAdsDownload" type="button">Download .txt</button></div></section>'+
      '</div><div class="mkt-receipt" id="mlsP1MktReceipt" role="status" aria-live="polite" hidden></div></div>';
  }
  function stableInvoker(preferred) {
    var candidates = [preferred, byId('mlsToolsBtn'), safe(function () { return D.querySelector && D.querySelector('#mlsDock button[data-dest="tools"]'); }, null), byId('mlsTbMenuBtn')];
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (node && node.focus && node.hidden !== true && node.disabled !== true && node.getAttribute && node.getAttribute('aria-hidden') !== 'true' && (typeof node.isConnected !== 'boolean' || node.isConnected)) return node;
    }
    return null;
  }
  function containBackgroundNode(node) {
    if (!node || node === host || backgroundNodes.some(function (record) { return record.node === node; })) return;
    backgroundNodes.push({ node: node, inert: !!node.inert,
      inertAttribute: node.getAttribute && node.getAttribute('inert'),
      ariaHidden: node.getAttribute && node.getAttribute('aria-hidden') });
    try { node.inert = true; } catch (_inertError) {}
    if (node.setAttribute) { node.setAttribute('inert', ''); node.setAttribute('aria-hidden', 'true'); }
  }
  function containWorkspace() {
    var children = D.body && D.body.children ? Array.prototype.slice.call(D.body.children) : [];
    children.forEach(containBackgroundNode);
  }
  function close() {
    if (!currentApi()) return false;
    if (dirty && !safe(function () { return window.confirm('Discard every unsaved Marketing draft in this tab?'); }, false)) return false;
    var restore = opener; scrub(); reconcileDoor();
    restore = stableInvoker(restore); if (restore) safe(function () { restore.focus(); });
    opener = null; return true;
  }
  function clearDrafts() {
    if (!host || !safe(function () { return window.confirm('Clear every Marketing draft in this open tab?'); }, false)) return false;
    var fields = host.querySelectorAll('input,textarea,select');
    for (var i = 0; i < fields.length; i++) {
      var kind = String(fields[i].type || '').toLowerCase();
      if (kind === 'checkbox' || kind === 'radio') fields[i].checked = false;
      else { fields[i].value = ''; if (fields[i].tagName === 'SELECT') fields[i].selectedIndex = 0; }
    }
    byId('mlsP1MktScore').textContent = '—';
    byId('mlsP1MktScoreNote').textContent = 'Run the check to score 10 essentials';
    byId('mlsP1MktChecklist').innerHTML = '';
    byId('mlsP1MktReplyGuard').textContent = 'Never confirm the reviewer was a patient or mention care, diagnosis, treatment, or dates.';
    dirty = false;
    safe(function () { var gate = window.__mlsUpgradeSafety; if (gate && typeof gate.clear === 'function') gate.clear('marketing-' + VERSION); });
    receipt('all drafts', true, 'cleared from this tab');
    return true;
  }
  function open(invoker) {
    if (!currentApi()) return false;
    var owner = currentAccount(); if (!owner) return deny();
    if (host && workspaceOwner && accountMatches(workspaceOwner)) {
      safe(function () { byId('mlsP1MktClose').focus(); }); return true;
    }
    if (host) scrub();
    opener = stableInvoker(invoker || D.activeElement);
    scrub(); generation += 1; var token = generation;
    workspaceOwner = owner;
    var identity = practiceIdentity();
    host = D.createElement('div'); host.id = 'mlsP1MktWorkspace'; host.setAttribute('role', 'dialog');
    host.setAttribute('aria-modal', 'true'); host.setAttribute('aria-labelledby', 'mlsP1MktTitle');
    host.innerHTML = workspaceHtml(identity); (D.body || D.documentElement).appendChild(host);
    containWorkspace();
    fenceTextInputs();
    on(byId('mlsP1MktClose'), 'click', close, true);
    on(byId('mlsP1MktClear'), 'click', clearDrafts, true);
    on(host, 'keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      var focusable = host.querySelectorAll('button,input,select,textarea'); if (!focusable.length) return;
      var first = focusable[0], last = focusable[focusable.length - 1];
      if (event.shiftKey && D.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && D.activeElement === last) { event.preventDefault(); first.focus(); }
    }, true);
    on(host, 'input', function () { dirty = true; }, true);
    on(host, 'change', function () { dirty = true; }, true);
    on(byId('mlsP1MktAudit'), 'click', function () { if (accountMatches(owner) && token === generation) listingAudit(identity); }, true);
    on(byId('mlsP1MktDraftReply'), 'click', function () { if (accountMatches(owner) && token === generation) draftReply(identity); }, true);
    on(byId('mlsP1MktPlanCampaign'), 'click', function () { if (accountMatches(owner) && token === generation) planCampaign(identity); }, true);
    on(byId('mlsP1MktPlanAds'), 'click', function () { if (accountMatches(owner) && token === generation) planAds(identity); }, true);
    bindExport('mlsP1MktListingCopy', 'mlsP1MktListingDownload', 'mlsP1MktListingOutput', 'listing plan', 'mls-listing-plan.txt', owner, token);
    bindExport('mlsP1MktReplyCopy', 'mlsP1MktReplyDownload', 'mlsP1MktReplyOutput', 'review reply', 'mls-review-reply.txt', owner, token);
    bindExport('mlsP1MktCampaignCopy', 'mlsP1MktCampaignDownload', 'mlsP1MktCampaignOutput', 'campaign plan', 'mls-review-campaign-plan.txt', owner, token);
    bindExport('mlsP1MktAdsCopy', 'mlsP1MktAdsDownload', 'mlsP1MktAdsOutput', 'ad plan', 'mls-google-ads-draft.txt', owner, token);
    safe(function () { byId('mlsP1MktClose').focus(); });
    return true;
  }
  function hideLegacyReviews() {
    var candidates = safe(function () { return D.querySelectorAll('#mlsPtab_reviews,.mls-menu-reviews,#mlsEasyTools [data-target="mlsPtab_reviews"],#ez3sReviews'); }, []) || [];
    for (var i = 0; i < candidates.length; i++) {
      var node = candidates[i];
      if (legacyNodes.some(function (record) { return record.node === node; })) continue;
      legacyNodes.push({ node: node, hidden: node.hidden, disabled: node.disabled, display: node.style && node.style.display,
        ariaHidden: node.getAttribute && node.getAttribute('aria-hidden'), tabindex: node.getAttribute && node.getAttribute('tabindex') });
      node.hidden = true; node.disabled = true; if (node.style) node.style.display = 'none';
      if (node.setAttribute) { node.setAttribute('aria-hidden', 'true'); node.setAttribute('tabindex', '-1'); node.setAttribute('data-mls-p1-marketing-retired', '1'); }
    }
    var reach = window.__mlsPatientReach;
    if (reachOriginals && reachOriginals.api !== reach) releaseReachOwner();
    if (!reach || typeof reach.open !== 'function' || typeof reach.openReviews !== 'function' || typeof reach.openContext !== 'function') return;
    if (reachOriginals && reach.open === reachOriginals.wrappedOpen && reach.openReviews === reachOriginals.wrappedOpenReviews && reach.openContext === reachOriginals.wrappedOpenContext) return;
    if (reachOriginals) releaseReachOwner();
    var record = { api: reach, open: reach.open, openReviews: reach.openReviews, openContext: reach.openContext };
    record.wrappedOpen = function (kind, options) { return kind === 'reviews' ? open(options && options.invoker) : record.open.call(reach, kind, options); };
    record.wrappedOpenReviews = function (options) { return open(options && options.invoker); };
    record.wrappedOpenContext = function (kind, options) { return kind === 'reviews' ? open(options && options.invoker) : record.openContext.call(reach, kind, options); };
    reachOriginals = record;
    reach.open = record.wrappedOpen; reach.openReviews = record.wrappedOpenReviews; reach.openContext = record.wrappedOpenContext;
  }
  function releaseReachOwner() {
    var record = reachOriginals; reachOriginals = null;
    if (!record || !record.api) return;
    if (record.api.open === record.wrappedOpen) record.api.open = record.open;
    if (record.api.openReviews === record.wrappedOpenReviews) record.api.openReviews = record.openReviews;
    if (record.api.openContext === record.wrappedOpenContext) record.api.openContext = record.openContext;
  }
  function restoreLegacyReviews() {
    releaseReachOwner();
    legacyNodes.forEach(function (record) {
      var node = record.node; if (!node) return; node.hidden = record.hidden; node.disabled = record.disabled;
      if (node.style) node.style.display = record.display || '';
      if (node.removeAttribute) { node.removeAttribute('data-mls-p1-marketing-retired');
        if (record.ariaHidden == null) node.removeAttribute('aria-hidden'); else node.setAttribute('aria-hidden', record.ariaHidden);
        if (record.tabindex == null) node.removeAttribute('tabindex'); else node.setAttribute('tabindex', record.tabindex); }
    });
    legacyNodes = [];
  }
  function reconcileCalmDoor(owner) {
    var menu = byId('mlsToolsMenu');
    if (!owner || !menu) {
      if (calmDoor) { calmDoor.hidden = true; calmDoor.setAttribute('aria-hidden', 'true'); calmDoor.setAttribute('tabindex', '-1'); }
      return false;
    }
    if (!calmDoor) {
      calmDoor = D.createElement('div'); calmDoor.id = 'mlsP1MktCalmDoor'; calmDoor.className = 'r';
      calmDoor.setAttribute('role', 'menuitem'); calmDoor.setAttribute('tabindex', '0');
      calmDoor.setAttribute('aria-label', 'Marketing');
      calmDoor.innerHTML = '<span class="ri" aria-hidden="true">📣</span><span class="rn">Marketing</span>';
      on(calmDoor, 'click', function (event) {
        if (event) event.stopPropagation();
        var invoke = stableInvoker(byId('mlsToolsBtn') || safe(function () { return D.querySelector('#mlsDock button[data-dest="tools"]'); }, null));
        var shell = window.__mlsCalmShell;
        if (shell && typeof shell.go === 'function') safe(function () { shell.go('tools'); });
        else if (calmDoor && calmDoor.parentNode) calmDoor.parentNode.removeChild(calmDoor);
        open(invoke);
      });
      on(calmDoor, 'keydown', function (event) {
        if (!event || !/^(Enter| |Spacebar)$/.test(event.key)) return;
        event.preventDefault(); event.stopPropagation(); calmDoor.click();
      });
    }
    var group = menu.querySelector && menu.querySelector('[role="group"][aria-label="Practice"]');
    var parent = group || menu;
    if (calmDoor.parentNode !== parent) parent.appendChild(calmDoor);
    calmDoor.hidden = false; calmDoor.removeAttribute('aria-hidden'); calmDoor.setAttribute('tabindex', '0');
    return true;
  }
  function reconcileDoor() {
    /* Retire the old server-backed Reviews routes for every preview role,
       including unresolved and denied identities. The replacement open()
       path then applies the exact authenticated practice-role guard. */
    hideLegacyReviews();
    var owner = currentAccount();
    if (!owner) {
      if (door) { door.hidden = true; door.disabled = true; door.setAttribute('aria-hidden', 'true'); door.setAttribute('tabindex', '-1'); }
      reconcileCalmDoor(null);
      if (host) scrub();
      return false;
    }
    var panel = byId('mlsTbMenuPanel');
    if (!door && panel) {
      door = D.createElement('button'); door.id = 'mlsP1MktDoor'; door.type = 'button'; door.className = 'mlsTbItem';
      door.innerHTML = '<span class="mlsTbIco" aria-hidden="true">📣</span><span>Marketing</span>';
      door.title = 'Open the free Marketing drafting workspace';
      on(door, 'click', function () { var invoke = stableInvoker(byId('mlsTbMenuBtn')); var topbar = window.__mlsTopbar; if (topbar && topbar.closeMenu) topbar.closeMenu(); open(invoke); });
    }
    if (door && panel && door.parentNode !== panel) {
      var athena = panel.querySelector && panel.querySelector('[data-mls-menu-key="athena-help"]');
      if (athena) panel.insertBefore(door, athena); else panel.appendChild(door);
    }
    if (door) { door.hidden = false; door.disabled = false; door.removeAttribute('aria-hidden'); door.removeAttribute('tabindex'); }
    reconcileCalmDoor(owner);
    return !!(door || calmDoor);
  }
  function reconcile() { if (!currentApi()) return false; css(); return reconcileDoor(); }
  function boundary(event) {
    opener = null; scrub();
    if (door) { door.hidden = true; door.disabled = true; door.setAttribute('aria-hidden', 'true'); door.setAttribute('tabindex', '-1'); }
    reconcileCalmDoor(null);
  }
  function revert() {
    if (!currentApi()) return false;
    if (dirty) return false;
    scrub(); restoreLegacyReviews();
    if (menuObserver) { safe(function () { menuObserver.disconnect(); }); menuObserver = null; }
    clearListenerList(permanentListeners); if (door) { door.remove(); door = null; } if (calmDoor) { calmDoor.remove(); calmDoor = null; }
    if (styleNode) { styleNode.remove(); styleNode = null; }
    api.installed = false;
    if (window[API_KEY] === api) { try { delete window[API_KEY]; } catch (_deleteError) { window[API_KEY] = null; } }
    return true;
  }

  css();
  on(window, 'mls:session-boundary', boundary);
  on(window, 'mls:p1-marketing-identity-ready', reconcile);
  on(window, 'mls:ui-ready', reconcile);
  on(D, 'click', function (event) {
    var target = event && event.target;
    if (target && target.closest && target.closest('#mlsDock [data-dest="tools"],#mlsToolsBtn')) Promise.resolve().then(function () { if (currentApi()) reconcileDoor(); });
    var legacy = target && target.closest && target.closest('#mlsPtab_reviews,.mls-menu-reviews,[data-target="mlsPtab_reviews"],#ez3sReviews');
    if (!legacy) return; event.preventDefault(); event.stopPropagation(); if (event.stopImmediatePropagation) event.stopImmediatePropagation(); open();
  });
  var api = { installed: true, version: VERSION, installToken: installToken, open: open, close: close,
    reconcile: reconcile,
    allowed: function () { return currentApi() && !!currentAccount(); }, isDirty: function () { return currentApi() && !!dirty; }, revert: revert };
  window[API_KEY] = api; loader.state = 'ready';
  if (window.MutationObserver && D.documentElement) {
    menuObserver = new window.MutationObserver(function () { if (currentApi()) { if (host) containWorkspace(); reconcileDoor(); } });
    safe(function () { menuObserver.observe(D.documentElement, { childList: true, subtree: true }); });
  }
  reconcile();
}());
