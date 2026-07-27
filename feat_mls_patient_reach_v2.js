/*! MLS Patient Reach v2.0.4 — one site-only owner for Reviews and secure portal invitations. */
(function (W, D) {
  'use strict';

  var prior = W.__mlsPatientReach;
  if (prior && prior.version === '2.0.4') return;

  var VERSION = '2.0.4';
  var REVIEW_URL = '/review-finder.html';
  var KINDS = { reviews: 1, send: 1 };
  var labels = {
    reviews: { icon: '\u2605', short: 'Reviews', title: 'Reviews & reputation', description: 'See and manage your patient-review workflow in one place.' },
    send: { icon: '\ud83d\udce4', short: 'Send to patient', title: 'Send to patient', description: 'Open the secure, exact-patient portal-invite flow for the selected patient.' }
  };
  var state = {
    open: false,
    kind: '',
    mode: '',
    invoker: null,
    returnView: '',
    frozenPatient: null,
    bodyOverflow: '',
    bodyLocked: false,
    initialized: false,
    initObserver: null,
    initDeadline: 0
  };
  var ui = {};
  var panels = {};

  function byId(id) { return D.getElementById(id); }
  function remove(node) { if (node && node.parentNode) node.parentNode.removeChild(node); }
  function text(node, value) { if (node) node.textContent = value == null ? '' : String(value); }
  function setHidden(node, yes) {
    if (!node) return;
    node.hidden = !!yes;
    if (yes) node.setAttribute('hidden', ''); else node.removeAttribute('hidden');
  }
  function addClass(node, name) { if (node && node.classList) node.classList.add(name); }
  function removeClass(node, name) { if (node && node.classList) node.classList.remove(name); }
  function contains(root, node) { return !!(root && node && (root === node || (root.contains && root.contains(node)))); }
  function safeFocus(node) { try { if (node && typeof node.focus === 'function') node.focus({ preventScroll: true }); } catch (_) { try { node.focus(); } catch (__) {} } }

  function make(tag, attrs, value) {
    var node = D.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (key) {
      if (key === 'className') node.className = attrs[key];
      else if (key === 'type') node.type = attrs[key];
      else node.setAttribute(key, attrs[key]);
    });
    if (value != null) node.textContent = value;
    return node;
  }

  function installStyle() {
    if (byId('mls-pr-v2-css')) return;
    var style = make('style', { id: 'mls-pr-v2-css' });
    style.textContent = [
      '#mlsPatientReachWorkspace[hidden],#mlsPatientReachDialog[hidden],#mlsPatientReachParking[hidden]{display:none!important}',
      '#mlsRdNav [data-mls-pr-tab],.mainnav [data-mls-pr-tab]{box-sizing:border-box;appearance:none;border:0;font:inherit;cursor:pointer;flex:0 0 auto!important;min-height:38px;max-height:44px}',
      '#mlsRdNav [data-mls-pr-tab] .mls-pr-prem,.mainnav [data-mls-pr-tab] .mls-pr-prem{margin-left:auto;font-size:9px;font-weight:800;letter-spacing:.04em;padding:2px 6px;border-radius:999px;background:#EAF1EE;color:#2E6A4B}',
      '#mlsPatientReachWorkspace{box-sizing:border-box;width:100%;min-height:calc(100vh - 120px);padding:22px;color:#1A211C;background:#FBFAF7}',
      '.mls-pr-page-head{max-width:1180px;margin:0 auto 14px;padding:0 2px}',
      '.mls-pr-page-head h1{margin:0 0 3px;font:800 clamp(22px,2.4vw,31px)/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:#183E2D}',
      '.mls-pr-page-head p{margin:0;color:#5C6A62;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.mls-pr-page-body{max-width:1180px;margin:0 auto}',
      '#mlsPatientReachDialog{position:fixed;inset:0;z-index:2147482600;display:flex;align-items:center;justify-content:center;padding:18px;background:rgba(17,33,25,.52);backdrop-filter:blur(3px)}',
      '.mls-pr-dialog-card{box-sizing:border-box;display:flex;flex-direction:column;width:min(820px,100%);max-height:min(84vh,850px);overflow:hidden;border:1px solid #D9DED9;border-radius:18px;background:#FBFAF7;box-shadow:0 24px 80px rgba(13,35,25,.32);outline:0}',
      '.mls-pr-dialog-head{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;padding:17px 18px 14px;border-bottom:1px solid #E3E6E1;background:#fff}',
      '.mls-pr-dialog-head h2{margin:0 0 2px;font:800 19px/1.25 system-ui,-apple-system,"Segoe UI",sans-serif;color:#183E2D}',
      '.mls-pr-dialog-head p{margin:0;color:#617068;font:13px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif}',
      '.mls-pr-dialog-actions{display:flex;align-items:flex-start;gap:8px}',
      '.mls-pr-action{min-height:44px;border:1px solid #CAD4CD;border-radius:10px;padding:9px 13px;background:#fff;color:#183E2D;font:750 13px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;cursor:pointer}',
      '.mls-pr-action.primary{border-color:#2E6A4B;background:#2E6A4B;color:#fff}',
      '.mls-pr-action:hover{filter:brightness(.97)}.mls-pr-action:focus-visible,[data-mls-pr-tab]:focus-visible{outline:3px solid rgba(46,106,75,.28);outline-offset:2px}',
      '.mls-pr-dialog-body{min-height:0;overflow:auto;padding:16px}',
      '.mls-pr-panel{box-sizing:border-box;width:100%;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1A211C}',
      '.mls-pr-review-frame{display:block;box-sizing:border-box;width:100%;height:min(72vh,760px);min-height:440px;border:1px solid #DDE2DD;border-radius:14px;background:#fff}',
      '.mls-pr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}',
      '.mls-pr-card{box-sizing:border-box;border:1px solid #DDE2DD;border-radius:15px;padding:17px;background:#fff;box-shadow:0 4px 16px rgba(24,62,45,.05)}',
      '.mls-pr-card h3{margin:0 0 5px;font-size:16px;color:#183E2D}.mls-pr-card p{margin:0 0 13px;color:#607067}',
      '.mls-pr-book-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.mls-pr-book-row input{box-sizing:border-box;flex:1 1 250px;min-width:0;min-height:44px;border:1px solid #CDD5CF;border-radius:10px;padding:10px 11px;background:#F9FAF8;color:#1A211C;font:14px system-ui}',
      '.mls-pr-muted{font-size:12px;color:#69776F}.mls-pr-status{min-height:20px;margin-top:9px;font-size:13px;color:#5C6A62}.mls-pr-status.err{color:#A33A32}.mls-pr-status.ok{color:#227348}',
      '.mls-pr-patient{margin:9px 0 13px;padding:10px 12px;border-radius:10px;background:#F0F5F1;color:#244D3A;font-weight:750}',
      '.mls-pr-upgrade{text-align:center;padding:44px 20px;border:1px solid #DDE2DD;border-radius:15px;background:#fff}.mls-pr-upgrade h3{font-size:20px;margin:0 0 7px;color:#183E2D}.mls-pr-upgrade p{max-width:540px;margin:0 auto 16px;color:#607067}',
      '@media(max-width:720px){#mlsPatientReachWorkspace{padding:14px 10px}.mls-pr-grid{grid-template-columns:1fr}#mlsPatientReachDialog{align-items:flex-end;padding:0}.mls-pr-dialog-card{width:100%;max-height:92vh;border-radius:18px 18px 0 0}.mls-pr-dialog-head{grid-template-columns:1fr;padding:14px}.mls-pr-dialog-actions{width:100%}.mls-pr-dialog-actions .mls-pr-action{flex:1}.mls-pr-dialog-body{padding:10px}.mls-pr-review-frame{min-height:58vh}}',
      '@media(prefers-reduced-motion:reduce){#mlsPatientReachDialog,.mls-pr-action{transition:none!important;scroll-behavior:auto!important}}'
    ].join('\n');
    (D.head || D.documentElement).appendChild(style);
  }

  function buildChrome() {
    if (ui.workspace && ui.dialog) return;
    installStyle();

    ui.parking = make('div', { id: 'mlsPatientReachParking', hidden: '' });
    setHidden(ui.parking, true);

    ui.workspace = make('section', { id: 'mlsPatientReachWorkspace', 'aria-live': 'polite', hidden: '' });
    setHidden(ui.workspace, true);
    var pageHead = make('header', { className: 'mls-pr-page-head' });
    ui.pageTitle = make('h1', { id: 'mlsPatientReachPageTitle' });
    ui.pageDescription = make('p');
    pageHead.appendChild(ui.pageTitle); pageHead.appendChild(ui.pageDescription);
    ui.pageBody = make('div', { className: 'mls-pr-page-body' });
    ui.workspace.appendChild(pageHead); ui.workspace.appendChild(ui.pageBody);

    ui.dialog = make('div', { id: 'mlsPatientReachDialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'mlsPatientReachDialogTitle', 'aria-describedby': 'mlsPatientReachDialogDescription', hidden: '' });
    setHidden(ui.dialog, true);
    ui.dialogCard = make('div', { className: 'mls-pr-dialog-card', tabindex: '-1' });
    var dialogHead = make('header', { className: 'mls-pr-dialog-head' });
    var dialogWords = make('div');
    ui.dialogTitle = make('h2', { id: 'mlsPatientReachDialogTitle' });
    ui.dialogDescription = make('p', { id: 'mlsPatientReachDialogDescription' });
    dialogWords.appendChild(ui.dialogTitle); dialogWords.appendChild(ui.dialogDescription);
    var actions = make('div', { className: 'mls-pr-dialog-actions' });
    ui.fullButton = make('button', { type: 'button', className: 'mls-pr-action primary' }, 'Open full screen');
    ui.closeButton = make('button', { type: 'button', className: 'mls-pr-action', 'aria-label': 'Close' }, 'Close');
    actions.appendChild(ui.fullButton); actions.appendChild(ui.closeButton);
    dialogHead.appendChild(dialogWords); dialogHead.appendChild(actions);
    ui.dialogBody = make('div', { className: 'mls-pr-dialog-body' });
    ui.dialogCard.appendChild(dialogHead); ui.dialogCard.appendChild(ui.dialogBody); ui.dialog.appendChild(ui.dialogCard);

    (D.body || D.documentElement).appendChild(ui.parking);
    var app = byId('appWrap') || byId('appScreen') || D.body || D.documentElement;
    app.appendChild(ui.workspace);
    (D.body || D.documentElement).appendChild(ui.dialog);

    ui.fullButton.addEventListener('click', function () { fullscreen(); });
    ui.closeButton.addEventListener('click', function () { close({ restore: true }); });
    ui.dialog.addEventListener('mousedown', function (event) { if (event.target === ui.dialog) close({ restore: true }); });
  }

  function isPremium() {
    try { if (typeof W.effectivePremium === 'function') return !!W.effectivePremium(); } catch (_) {}
    try { return !!(W.bkUser && (W.bkUser.premium || W.bkUser.isAdmin)); } catch (_) { return false; }
  }

  function upgradePanel(kind) {
    var panel = make('section', { className: 'mls-pr-panel mls-pr-upgrade', 'data-mls-pr-kind': kind, 'data-mls-pr-upgrade': '1' });
    panel.appendChild(make('h3', null, labels[kind].title + ' is a Premium feature'));
    panel.appendChild(make('p', null, kind === 'reviews' ? 'Premium brings review discovery and reputation tools into your MLS workspace.' : 'Premium unlocks secure patient outreach and portal access.'));
    var link = make('a', { className: 'mls-pr-action primary', href: '/index.html#pricing', target: '_blank', rel: 'noopener' }, 'See Premium plans');
    panel.appendChild(link);
    return panel;
  }

  function reviewPanel() {
    if (panels.reviews) return panels.reviews;
    var panel = make('section', { className: 'mls-pr-panel', 'data-mls-pr-kind': 'reviews' });
    var frame = make('iframe', { className: 'mls-pr-review-frame', src: REVIEW_URL, title: 'MLS Reviews and reputation', loading: 'lazy' });
    panel.appendChild(frame);
    panels.reviews = panel;
    return panel;
  }

  function normalizeName(value) { return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase(); }
  function cleanValue(value) {
    var s = String(value == null ? '' : value).trim();
    return (!s || /^(?:undefined|null)$/i.test(s)) ? '' : s;
  }
  function normalizeDob(value) {
    var raw = cleanValue(value), match;
    if ((match = raw.match(/^(\d{4})[-\/]?(\d{2})[-\/]?(\d{2})(?:\D|$)/))) raw = match[1] + match[2] + match[3];
    else if ((match = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/))) raw = match[3] + ('0' + match[1]).slice(-2) + ('0' + match[2]).slice(-2);
    else {
      raw = raw.replace(/\D/g, '');
      if (/^\d{8}$/.test(raw) && !/^(?:18|19|20|21)/.test(raw)) raw = raw.slice(4) + raw.slice(0, 4);
    }
    if (!/^\d{8}$/.test(raw)) return '';
    var year = Number(raw.slice(0, 4)), month = Number(raw.slice(4, 6)), day = Number(raw.slice(6, 8));
    var date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? raw : '';
  }
  function identity(patient) {
    if (!patient || typeof patient !== 'object') return null;
    var refs = [];
    [['id', patient.id], ['athenaId', patient.athenaId], ['mrn', patient.mrn]].forEach(function (pair) {
      var value = cleanValue(pair[1]);
      if (value) refs.push({ namespace: pair[0], value: value });
    });
    var name = normalizeName(patient.name), dob = normalizeDob(patient.dob), demo = name && dob ? name + '|' + dob : '';
    if (!refs.length && !demo) return null;
    return { refs: refs, demo: demo, stable: refs.length > 0, key: refs.length ? ('ref:' + refs[0].namespace + ':' + refs[0].value) : ('demo:' + demo) };
  }
  function sameIdentity(left, right) {
    var a = identity(left), b = identity(right), i, j;
    if (!a || !b) return false;
    if (a.stable || b.stable) {
      if (!a.stable || !b.stable) return false;
      /* A shared reference is not enough when another shared namespace says
         these are different charts.  Fail closed before delegating any
         patient-facing action: stale local IDs must never override a changed
         Athena ID/MRN. */
      for (i = 0; i < a.refs.length; i += 1) for (j = 0; j < b.refs.length; j += 1) {
        if (a.refs[i].namespace === b.refs[j].namespace && a.refs[i].value !== b.refs[j].value) return false;
      }
      for (i = 0; i < a.refs.length; i += 1) for (j = 0; j < b.refs.length; j += 1) {
        if (a.refs[i].namespace === b.refs[j].namespace && a.refs[i].value === b.refs[j].value) return true;
      }
      return false;
    }
    return a.demo === b.demo;
  }
  function activePatient() {
    try {
      var patient = W.activePatient;
      if (typeof patient === 'function') patient = patient();
      if (!patient || typeof patient !== 'object') patient = W._activePatient;
      return patient && typeof patient === 'object' ? patient : null;
    } catch (_) { return null; }
  }
  function validDemographicFallback(patient) {
    var proof = identity(patient), list;
    if (!proof || proof.stable || !proof.demo) return !!(proof && proof.stable);
    try { list = typeof W.getPatients === 'function' ? W.getPatients() : null; } catch (_) { list = null; }
    if (!Array.isArray(list)) return false;
    return list.filter(function (candidate) { var p = identity(candidate); return p && !p.stable && p.demo === proof.demo; }).length === 1;
  }
  function freezeActivePatient() {
    var patient = activePatient(), proof = identity(patient);
    if (!proof || (!proof.stable && !validDemographicFallback(patient))) return null;
    return {
      id: cleanValue(patient.id), athenaId: cleanValue(patient.athenaId), mrn: cleanValue(patient.mrn),
      name: cleanValue(patient.name), dob: cleanValue(patient.dob), email: cleanValue(patient.email),
      __mlsPatientReachKey: proof.key
    };
  }

  function bookingUrl() {
    /* Public self-booking is held until a reviewed server-issued booking URL
       is available. Never manufacture a URL from client-side practice data. */
    return '';
  }

  function sendPanel() {
    if (panels.send) return panels.send;
    var panel = make('section', { className: 'mls-pr-panel', 'data-mls-pr-kind': 'send' });
    var grid = make('div', { className: 'mls-pr-grid' });

    var portal = make('section', { className: 'mls-pr-card' });
    portal.appendChild(make('h3', null, 'Patient portal access'));
    portal.appendChild(make('p', null, 'Open the existing secure portal-invite flow for the patient selected when this panel opened. Nothing sends until you review and confirm it.'));
    ui.patientName = make('div', { className: 'mls-pr-patient', 'aria-live': 'polite' });
    ui.inviteButton = make('button', { type: 'button', className: 'mls-pr-action primary' }, 'Open secure invite');
    ui.sendStatus = make('div', { className: 'mls-pr-status', role: 'status' });
    portal.appendChild(ui.patientName); portal.appendChild(ui.inviteButton); portal.appendChild(ui.sendStatus);

    var booking = make('section', { className: 'mls-pr-card' });
    booking.appendChild(make('h3', null, 'Appointment requests'));
    booking.appendChild(make('p', null, 'Use the secure portal invite. After signing in, the patient can send an appointment request for the practice to confirm.'));
    var row = make('div', { className: 'mls-pr-book-row' });
    ui.bookingInput = make('input', { type: 'text', readonly: 'readonly', 'aria-label': 'Public booking link' });
    ui.copyButton = make('button', { type: 'button', className: 'mls-pr-action' }, 'Copy link');
    ui.textLink = make('a', { className: 'mls-pr-action', href: '#' }, 'Text');
    ui.emailLink = make('a', { className: 'mls-pr-action', href: '#' }, 'Email');
    row.appendChild(ui.bookingInput); row.appendChild(ui.copyButton); row.appendChild(ui.textLink); row.appendChild(ui.emailLink);
    booking.appendChild(row);
    /* b742: this used to send the doctor to a "Patient portal" button in the
       patient header. The banner rework (owner 2026-07-27) took every control
       off that bar, so the instruction pointed at nothing — and the same
       secure flow is one card to the left, on this very panel. */
    booking.appendChild(make('div', { className: 'mls-pr-muted' }, 'Use Open secure invite above for the same secure invite flow.'));

    grid.appendChild(portal); grid.appendChild(booking); panel.appendChild(grid);
    panels.send = panel;

    ui.inviteButton.addEventListener('click', delegatePortalInvite);
    ui.copyButton.addEventListener('click', function () {
      var value = ui.bookingInput.value;
      if (W.navigator && W.navigator.clipboard && typeof W.navigator.clipboard.writeText === 'function') {
        Promise.resolve(W.navigator.clipboard.writeText(value)).then(function () {
          text(ui.copyButton, 'Copied'); setTimeout(function () { text(ui.copyButton, 'Copy link'); }, 1200);
        }, function () { ui.bookingInput.select(); text(ui.copyButton, 'Select and copy'); });
      } else {
        ui.bookingInput.select();
        var copied = false; try { copied = !!(D.execCommand && D.execCommand('copy')); } catch (_) {}
        text(ui.copyButton, copied ? 'Copied' : 'Select and copy');
        if (copied) setTimeout(function () { text(ui.copyButton, 'Copy link'); }, 1200);
      }
    });
    return panel;
  }

  function setStatus(message, kind) {
    if (!ui.sendStatus) return;
    ui.sendStatus.className = 'mls-pr-status' + (kind ? ' ' + kind : '');
    text(ui.sendStatus, message || '');
  }
  function updateSendPanel(refreeze) {
    sendPanel();
    if (refreeze) state.frozenPatient = freezeActivePatient();
    var patient = state.frozenPatient;
    if (!patient) {
      text(ui.patientName, 'No patient selected');
      ui.patientName.removeAttribute('data-patient-key');
      ui.inviteButton.disabled = true;
      setStatus('Select a real patient first, then open Send to patient again.', 'err');
    } else {
      text(ui.patientName, patient.name || 'Selected patient');
      ui.patientName.setAttribute('data-patient-key', patient.__mlsPatientReachKey);
      ui.inviteButton.disabled = false;
      setStatus('This action is locked to ' + (patient.name || 'the selected patient') + '.', 'ok');
    }
    var url = bookingUrl();
    ui.bookingInput.value = url;
    ui.bookingInput.placeholder = 'Public booking link not released';
    ui.copyButton.disabled = true;
    ui.textLink.removeAttribute('href'); ui.textLink.setAttribute('aria-disabled', 'true');
    ui.emailLink.removeAttribute('href'); ui.emailLink.setAttribute('aria-disabled', 'true');
  }
  function delegatePortalInvite() {
    var frozen = state.frozenPatient, current = activePatient();
    if (!frozen) { setStatus('Select a patient before opening the secure invite.', 'err'); return false; }
    if (!current || !sameIdentity(current, frozen)) {
      ui.inviteButton.disabled = true;
      setStatus('The active patient changed. Close this panel and reopen Send to patient before continuing.', 'err');
      return false;
    }
    var hardened = byId('mlsPortalInviteBtn');
    if (!hardened || typeof hardened.click !== 'function') {
      /* b742: no longer "return to Visit and try Patient portal" — that button
         is off the banner. This is a load-order failure, so say so honestly. */
      setStatus('The secure portal invite is still loading. Open a patient, wait a moment, and try again.', 'err');
      return false;
    }
    setStatus('Opening the secure invite for ' + (frozen.name || 'the selected patient') + '\u2026', 'ok');
    hardened.click();
    return true;
  }

  function panelFor(kind) {
    if (!isPremium()) {
      var key = 'upgrade_' + kind;
      if (!panels[key]) panels[key] = upgradePanel(kind);
      return panels[key];
    }
    return kind === 'reviews' ? reviewPanel() : sendPanel();
  }

  function cleanupLegacy() {
    var selectors = ['[data-mls-pview]', '#mlsPView_reviews', '#mlsPView_send', '#mlsPView_upsell'];
    selectors.forEach(function (selector) {
      try { Array.prototype.slice.call(D.querySelectorAll(selector)).forEach(remove); } catch (_) {}
    });
  }

  function navHost() {
    /* 2.0.3: mount INSIDE the rail's .mainnav list, never as a direct child of
       the fixed-height #mlsRdNav flex column. The base app's .navtab{flex:1}
       (from the old horizontal tab bar) made direct rail children stretch to
       fill the leftover rail height — the giant Reviews / Send blocks. */
    var rail = byId('mlsRdNav');
    var railList = rail ? rail.querySelector('.mainnav') : null;
    return railList || (byId('nav_help') && byId('nav_help').parentNode) || byId('mainnav') || D.querySelector('.mainnav') || rail;
  }
  function ensureTab(kind) {
    var id = 'mlsPtab_' + kind, old = byId(id), host = navHost(), tab;
    if (!host) return null;
    if (old && old.getAttribute('data-mls-pr-tab') === kind) {
      old.style.removeProperty('display');
      return old;
    }
    tab = make('button', { id: id, type: 'button', className: 'navtab', 'data-mls-ptab': kind, 'data-mls-pr-tab': kind, 'aria-label': labels[kind].title });
    tab.appendChild(make('span', { 'aria-hidden': 'true' }, labels[kind].icon));
    tab.appendChild(make('span', null, labels[kind].short));
    tab.appendChild(make('span', { className: 'mls-pr-prem' }, 'PREMIUM'));
    if (old && old.parentNode) old.parentNode.replaceChild(tab, old);
    else {
      var help = byId('nav_help');
      if (help && help.parentNode === host) host.insertBefore(tab, help); else host.appendChild(tab);
    }
    try {
      Array.prototype.slice.call(D.querySelectorAll('[data-mls-ptab="' + kind + '"]')).forEach(function (candidate) { if (candidate !== tab) remove(candidate); });
    } catch (_) {}
    return tab;
  }

  function init() {
    buildChrome(); cleanupLegacy();
    var a = ensureTab('reviews'), b = ensureTab('send');
    if (!a || !b) return false;
    state.initialized = true;
    if (state.initObserver) { try { state.initObserver.disconnect(); } catch (_) {} state.initObserver = null; }
    return true;
  }

  function startBoundedInit() {
    if (init()) return;
    state.initDeadline = Date.now() + 12000;
    if (typeof W.MutationObserver === 'function' && D.documentElement) {
      state.initObserver = new W.MutationObserver(function () {
        if (init() || Date.now() >= state.initDeadline) {
          if (state.initObserver) state.initObserver.disconnect();
          state.initObserver = null;
        }
      });
      state.initObserver.observe(D.documentElement, { childList: true, subtree: true });
      setTimeout(function () { if (state.initObserver) { state.initObserver.disconnect(); state.initObserver = null; } }, 12100);
    }
  }

  function updateTitles(kind) {
    text(ui.pageTitle, labels[kind].title); text(ui.pageDescription, labels[kind].description);
    text(ui.dialogTitle, labels[kind].title); text(ui.dialogDescription, labels[kind].description);
  }
  function parkPanels(except) {
    Object.keys(panels).forEach(function (key) {
      var panel = panels[key];
      if (panel && panel !== except && panel.parentNode !== ui.parking) ui.parking.appendChild(panel);
    });
  }
  function lockBody() {
    if (!D.body) return;
    if (state.bodyLocked) return;
    state.bodyOverflow = D.body.style.overflow || '';
    D.body.style.overflow = 'hidden';
    state.bodyLocked = true;
  }
  function unlockBody() {
    if (!D.body || !state.bodyLocked) return;
    D.body.style.overflow = state.bodyOverflow || '';
    state.bodyLocked = false;
    state.bodyOverflow = '';
  }
  function currentReturnView() {
    var value = String(W.__mlsCurrentView || '');
    if (!value) {
      try {
        var active = D.querySelector('.navtab.on[id^="nav_"]');
        value = active ? String(active.id || '').replace(/^nav_/, '') : '';
      } catch (_) {}
    }
    if (!value || /^patient-reach-/.test(value) || value === '__patientReach') value = 'visit';
    return value;
  }
  function activateTab(kind) {
    try { Array.prototype.slice.call(D.querySelectorAll('.navtab.on')).forEach(function (tab) { removeClass(tab, 'on'); tab.removeAttribute('aria-current'); }); } catch (_) {}
    var active = byId('mlsPtab_' + kind);
    addClass(active, 'on'); if (active) active.setAttribute('aria-current', 'page');
  }

  function enterFullscreen(kind, panel) {
    if (state.mode !== 'full') state.returnView = currentReturnView();
    setHidden(ui.dialog, true); unlockBody();
    if (typeof W.showView === 'function') {
      try { W.showView('__patientReach'); } catch (_) {}
    } else {
      try { Array.prototype.slice.call(D.querySelectorAll('#appWrap > [id$="View"]')).forEach(function (view) { if (view !== ui.workspace) view.style.display = 'none'; }); } catch (_) {}
    }
    var patientBar = byId('patientBar'); if (patientBar) patientBar.style.display = 'none';
    ui.pageBody.appendChild(panel); setHidden(ui.workspace, false); activateTab(kind);
    W.currentView = 'patient-reach-' + kind;
    state.open = true; state.kind = kind; state.mode = 'full';
    safeFocus(byId('mlsPtab_' + kind));
  }

  function enterDialog(kind, panel) {
    if (state.mode === 'full') close({ restore: true, focus: false, park: false });
    setHidden(ui.workspace, true);
    ui.dialogBody.appendChild(panel); lockBody(); setHidden(ui.dialog, false);
    state.open = true; state.kind = kind; state.mode = 'dialog';
    safeFocus(ui.dialogCard);
  }

  function open(kind, options) {
    options = options || {};
    kind = String(kind || '').toLowerCase();
    if (!KINDS[kind]) return false;
    init(); buildChrome(); cleanupLegacy();
    var mode = options.mode === 'full' || options.mode === 'fullscreen' || options.fullscreen ? 'full' : 'dialog';
    var sameOpen = state.open && state.kind === kind;
    /* A context shortcut cannot demote an already-open workspace into a modal
       over itself. Keep the real tab active and leave its frozen patient alone. */
    if (state.open && state.mode === 'full' && mode === 'dialog') {
      safeFocus(byId('mlsPtab_' + state.kind));
      return true;
    }
    if (sameOpen && state.mode === mode) {
      safeFocus(mode === 'dialog' ? ui.dialogCard : byId('mlsPtab_' + kind));
      return true;
    }
    if (!sameOpen) {
      state.invoker = options.invoker || D.activeElement || null;
      if (kind === 'send') state.frozenPatient = freezeActivePatient();
    }
    updateTitles(kind);
    var panel = panelFor(kind);
    parkPanels(panel);
    if (kind === 'send' && isPremium()) updateSendPanel(!sameOpen);
    if (mode === 'full') enterFullscreen(kind, panel); else enterDialog(kind, panel);
    return true;
  }

  function fullscreen() {
    if (!state.open || !state.kind) return false;
    return open(state.kind, { mode: 'full', invoker: state.invoker, preservePatient: true });
  }

  function close(options) {
    options = options || {};
    if (!state.open && !options.park) return false;
    var wasDialog = state.mode === 'dialog', invoker = state.invoker, returnView = state.returnView;
    setHidden(ui.dialog, true); setHidden(ui.workspace, true); unlockBody();
    if (options.park !== false) parkPanels(null);
    try { Array.prototype.slice.call(D.querySelectorAll('[data-mls-pr-tab].on')).forEach(function (tab) { removeClass(tab, 'on'); tab.removeAttribute('aria-current'); }); } catch (_) {}
    state.open = false; state.kind = ''; state.mode = ''; state.frozenPatient = null;
    if (options.restore !== false && returnView && typeof W.showView === 'function') { try { W.showView(returnView); } catch (_) {} }
    state.returnView = '';
    if (options.focus !== false && wasDialog) safeFocus(invoker);
    return true;
  }

  function onClick(event) {
    var target = event.target && event.target.closest ? event.target.closest('[data-mls-pr-tab],.navtab') : null;
    if (!target) return;
    var kind = target.getAttribute && target.getAttribute('data-mls-pr-tab');
    if (kind && KINDS[kind]) {
      event.preventDefault(); event.stopPropagation(); if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      /* The rail is an unambiguous full-page destination. Do not infer intent
         from Event.isTrusted: keyboard automation and assistive technology can
         produce synthetic activation even though the user chose the rail.
         Context buttons call open/openReviews/openSend with dialog mode. */
      open(kind, { mode: 'full', invoker: target, source: 'left-navigation' });
      return;
    }
    if (state.mode === 'full') close({ restore: false, focus: false });
  }

  function onKeydown(event) {
    if (!state.open || state.mode !== 'dialog') return;
    if (event.key === 'Escape' || event.key === 'Esc') { event.preventDefault(); close({ restore: true }); return; }
    if (event.key !== 'Tab') return;
    var focusable = Array.prototype.slice.call(ui.dialogCard.querySelectorAll('button:not([disabled]),a[href],input:not([disabled]),iframe,[tabindex]:not([tabindex="-1"])'));
    if (!focusable.length) { event.preventDefault(); safeFocus(ui.dialogCard); return; }
    var first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && D.activeElement === first) { event.preventDefault(); safeFocus(last); }
    else if (!event.shiftKey && D.activeElement === last) { event.preventDefault(); safeFocus(first); }
  }

  function onViewChanged(event) {
    var next = event && event.detail ? String(event.detail.view || '') : '';
    /* Sidebar links are not the only navigation path: Help, Find, Copilot and
       workflow buttons call showView directly.  A full Reach workspace must
       leave with that route instead of remaining painted over the next page. */
    if (state.open && state.mode === 'full' && next && next !== '__patientReach') {
      close({ restore: false, focus: false });
    }
  }

  D.addEventListener('click', onClick, true);
  D.addEventListener('keydown', onKeydown, true);
  W.addEventListener('mls:view-changed', onViewChanged, false);
  ['mls:ui-ready', 'mls:nav-ready', 'sf:ready'].forEach(function (name) { W.addEventListener(name, init); });
  if (D.readyState === 'loading') D.addEventListener('DOMContentLoaded', startBoundedInit, { once: true }); else startBoundedInit();

  W.__mlsPatientReach = {
    version: VERSION,
    init: init,
    open: open,
    openReviews: function (options) { return open('reviews', options); },
    openSend: function (options) { return open('send', options); },
    openContext: function (kind, options) {
      options = options || {};
      options.mode = 'dialog';
      options.source = options.source || 'context-action';
      return open(kind, options);
    },
    fullscreen: fullscreen,
    close: close,
    getState: function () { return { open: state.open, kind: state.kind, mode: state.mode, frozenPatientKey: state.frozenPatient && state.frozenPatient.__mlsPatientReachKey || '' }; },
    samePatient: sameIdentity,
    delegatePortalInvite: delegatePortalInvite
  };
})(window, document);
