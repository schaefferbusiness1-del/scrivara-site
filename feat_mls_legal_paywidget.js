/* feat_mls_legal_paywidget.js  (MLS additive feature; reversible)
   Persistent "Set up payments" banner pinned to the TOP of the Legal section.
   - Shows whenever the doctor's Stripe Connect is NOT charges-enabled
     (GET /api/connect/status -> { ready:false }).
   - Auto-clears itself the moment Connect becomes ready (ready:true / charges_enabled).
   - Button launches the EXISTING Connect onboarding (POST /api/connect/onboard -> { url }).
   Performance: one status timer plus a scoped Legal-view observer. Remove this
   file + its loader line (or call revert()) to revert.
*/
(function () {
  'use strict';
  if (window.__mlsLegalPayWidget) return;            // dedupe across reloads
  var api = window.__mlsLegalPayWidget = { version: '1.1.0' };

  var BASE = 'https://scrivara-backend.onrender.com';
  var BANNER_ID = 'mlsLegalPayBanner';
  var MOUNT_IDS = ['legalCard', 'legalReqView'];     // top of the legal section
  var POLL_MS = 20000;                               // connect-status poll cadence
  var state = { ready: null, checking: false, lastPoll: 0 };
  var pollTimer = null, mountTimer = null, observer = null, stopped = false, mountTries = 0;

  function token() {
    try { return sessionStorage.getItem('sf_bk_token') || localStorage.getItem('sf_bk_token'); }
    catch (e) { return null; }
  }

  function pollStatus() {
    var t = token();
    if (!t || state.checking) return;
    state.checking = true;
    fetch(BASE + '/api/connect/status', { headers: { 'Authorization': 'Bearer ' + t } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        if (j && typeof j.ready !== 'undefined') state.ready = (j.ready === true);
        else if (j && typeof j.charges_enabled !== 'undefined') state.ready = (j.charges_enabled === true);
      })
      .catch(function () {})
      .then(function () { state.checking = false; state.lastPoll = Date.now(); upkeep(); schedulePoll(); });
  }

  function startOnboarding(btn) {
    var t = token();
    if (!t) { alert('Please sign in first.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Opening Stripe…'; }
    fetch(BASE + '/api/connect/onboard', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + t, 'Content-Type': 'application/json' },
      body: '{}'
    })
      .then(function (r) { return r.json(); })
      .then(function (j) {
        if (j && j.url) { window.location.href = j.url; }
        else { reset(btn); alert('Could not start Stripe onboarding. Please try again.'); }
      })
      .catch(function () { reset(btn); alert('Could not reach the payments service. Please try again.'); });
  }
  function reset(btn) { if (btn) { btn.disabled = false; btn.textContent = 'Set up payments'; } }

  function buildBanner() {
    var d = document.createElement('div');
    d.id = BANNER_ID;
    d.setAttribute('role', 'alert');
    d.style.cssText = 'margin:0 0 12px 0;padding:12px 14px;border:1px solid #f0c36d;background:#fff8e6;border-radius:10px;display:flex;align-items:center;gap:12px;font-size:14px;color:#5a4300;line-height:1.4;box-shadow:0 1px 2px rgba(0,0,0,.05)';
    var txt = document.createElement('div');
    txt.style.cssText = 'flex:1';
    txt.innerHTML = '<strong>Set up payments to create legal reports.</strong><br>You must connect Stripe and enable payouts before you can generate or deliver legal reports.';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Set up payments';
    btn.style.cssText = 'flex:0 0 auto;cursor:pointer;border:0;border-radius:8px;padding:9px 14px;background:#2E6A4B;color:#fff;font-weight:600;font-size:14px';
    btn.addEventListener('click', function () { startOnboarding(btn); });
    d.appendChild(txt);
    d.appendChild(btn);
    return d;
  }

  function mount() {
    var all = document.querySelectorAll('#' + BANNER_ID);
    if (all.length) { for (var j = 1; j < all.length; j++) all[j].remove(); return; }
    var host = null;
    for (var i = 0; i < MOUNT_IDS.length; i++) { host = document.getElementById(MOUNT_IDS[i]); if (host) break; }
    if (host) host.insertBefore(buildBanner(), host.firstChild);
  }

  function removeAll() {
    var nodes = document.querySelectorAll('#' + BANNER_ID);
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].parentNode) nodes[i].parentNode.removeChild(nodes[i]);
    }
  }

  function upkeep() {
    if (state.ready === true) { removeAll(); }        // connected + charges enabled -> auto-clear
    else if (state.ready === false) { mount(); }      // not ready -> keep pinned at top of legal section
    // state.ready === null: wait for first poll
  }

  function schedulePoll() {
    if (stopped || pollTimer) return;
    pollTimer = setTimeout(function () { pollTimer = null; if (!stopped) pollStatus(); }, POLL_MS);
  }

  function retryMount() {
    if (stopped) return;
    upkeep();
    if (++mountTries < 60 && !document.getElementById('legalCard') && !document.getElementById('legalReqView')) mountTimer = setTimeout(retryMount, 500);
  }
  function observeLegal() {
    var host = document.getElementById('legalReqView') || document.getElementById('legalCard');
    if (!host || observer) return;
    try {
      observer = new MutationObserver(function () { if (!stopped) setTimeout(upkeep, 0); });
      observer.observe(host, { childList: true, subtree: true });
    } catch (e) {}
  }
  function onClick(ev) {
    try { var t = ev.target && ev.target.closest ? ev.target.closest('#nav_legalreq,[data-view="legalreq"]') : null; if (t) setTimeout(function () { upkeep(); observeLegal(); }, 0); } catch (e) {}
  }
  document.addEventListener('click', onClick, true);
  pollStatus(); schedulePoll(); retryMount(); observeLegal();

  api.state = state;
  api.refresh = function () { state.lastPoll = 0; pollStatus(); };
  api.revert = function () {
    stopped = true;
    try { if (pollTimer) clearTimeout(pollTimer); if (mountTimer) clearTimeout(mountTimer); } catch (e) {}
    try { if (observer) observer.disconnect(); } catch (e) {}
    try { document.removeEventListener('click', onClick, true); } catch (e) {}
    removeAll();
    try { delete window.__mlsLegalPayWidget; } catch (e) {}
  };
})();
