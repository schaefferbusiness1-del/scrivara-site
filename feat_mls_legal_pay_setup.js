/*! feat_mls_legal_pay_setup.js — item71
 * Adds a clean "Payments" subsection (Set up payments + live status line) to the
 * Legal Expert Profile settings panel, so a clinician can set up their Stripe
 * Express payout account right where they fill out their medical-legal report profile.
 *
 * REUSE (no duplicated flow): clicks call the EXISTING global startConnectOnboard()
 * (POST /api/connect/onboard -> redirect to Stripe -> returns ?connect=done), and the
 * status line uses the EXISTING /api/connect/status fetch (same bkBase()/bkToken()).
 *
 * If the backend reports Connect is not enabled (LIVE-mode activation still finishing),
 * the button shows a friendly "finishing activation — try again shortly" message instead
 * of a raw error or a dead button. It does NOT fake success.
 *
 * Additive & fully reversible:  window.__mlsLegalPaySetup.revert()
 */
(function(){
  "use strict";
  try {
    if (window.__mlsLegalPaySetup && window.__mlsLegalPaySetup.__installed) return;

    var SECTION_ID = 'mlsLegalPaySection';
    var STATUS_ID  = 'mlsLegalPayStatus';
    var BTN_ID     = 'mlsLegalPayBtn';

    var _obs = null;
    var _timers = [];
    var _inflight = false;

    function fnReady(){ return (typeof window.bkToken === 'function' && typeof window.bkBase === 'function'); }
    function signedIn(){
      try {
        if (typeof window.backendMode === 'function' && !window.backendMode()) return false;
        return !!(fnReady() && window.bkToken());
      } catch(e){ return false; }
    }

    /* ---------- status ---------- */
    function fetchStatus(){
      if (!signedIn()) return Promise.resolve({ role:'none' });
      return fetch(window.bkBase() + '/api/connect/status', {
        headers: { Authorization: 'Bearer ' + window.bkToken() }
      }).then(function(r){
        if (r.status === 401) return { role:'none' };
        if (!r.ok)            return { role:'nonclinician' };
        return r.json().catch(function(){ return {}; });
      }).catch(function(){ return { error:true }; });
    }

    // Map the account-status object to one of: Not started / Finish setup / In review / Payments ready
    function statusLine(d){
      if (!d || d.role === 'none')        return { txt:'',                                   color:'var(--muted)' };
      if (d.role === 'nonclinician')      return { txt:'Available to clinician accounts.',   color:'var(--muted)' };
      if (d.error)                        return { txt:'Couldn’t check status — reload to retry.', color:'var(--muted)' };
      if (d.ready)                        return { txt:'✅ Payments ready',                  color:'#127a55' };
      var review = d.in_review || d.pending || d.under_review ||
                   /pending|review/i.test(String(d.status || '')) ||
                   /pending|review/i.test(String(d.disabled_reason || ''));
      if (review)                         return { txt:'⏳ In review',                       color:'#9a6a00' };
      if (d.connected)                    return { txt:'⚠️ Finish setup',                    color:'#9a6a00' };
      return                                     { txt:'Not started',                        color:'var(--muted)' };
    }

    function applyStatus(d){
      var s = document.getElementById(STATUS_ID);
      var b = document.getElementById(BTN_ID);
      if (s){
        var info = statusLine(d);
        s.textContent = info.txt;
        s.style.color = info.color;
        s.style.display = info.txt ? '' : 'none';
      }
      if (b){
        if (d && d.ready)          b.textContent = 'Manage payout account';
        else if (d && d.connected) b.textContent = 'Finish payment setup';
        else                       b.textContent = 'Set up payments';
      }
    }

    function refresh(){
      var s = document.getElementById(STATUS_ID);
      if (s && !s.textContent) s.textContent = 'Checking…';
      return fetchStatus().then(applyStatus);
    }

    function showFriendlyActivating(){
      var s = document.getElementById(STATUS_ID);
      if (s){
        s.textContent = '⏳ Payments setup is finishing activation — please try again shortly.';
        s.style.color = '#9a6a00';
        s.style.display = '';
      }
    }

    /* ---------- onboarding (reuses startConnectOnboard) ---------- */
    function startPayments(){
      if (_inflight) return;
      var btn = document.getElementById(BTN_ID);
      var sco = window.startConnectOnboard;
      if (typeof sco !== 'function'){
        showFriendlyActivating();
        if (typeof window.toast === 'function') window.toast('Payments setup is finishing activation — try again shortly.','ok');
        return;
      }
      _inflight = true;

      // Temporarily upgrade the error message ONLY for the "Connect is not enabled" case,
      // then hand straight off to the existing flow (real endpoint, real redirect).
      var origToast = window.toast;
      var restored = false;
      function restore(){
        if (restored) return; restored = true; _inflight = false;
        if (origToast) window.toast = origToast;
      }
      window.toast = function(msg, kind){
        try {
          var t = String(msg || '');
          if (/connect[\s\S]{0,40}not[\s\S]{0,12}enabl|not[\s\S]{0,12}enabl[\s\S]{0,40}connect|connect[_\s-]*not[_\s-]*enabled/i.test(t)){
            showFriendlyActivating();
            if (origToast) origToast('Payments setup is finishing activation — try again shortly.','ok');
            return;
          }
        } catch(e){}
        return origToast ? origToast(msg, kind) : undefined;
      };

      var p;
      try { p = sco(btn); }
      catch(e){ restore(); if (origToast) origToast('Could not open Stripe.','err'); return; }

      if (p && typeof p.then === 'function'){
        p.then(function(){ setTimeout(restore, 0); refresh(); },
               function(){ setTimeout(restore, 0); });
      } else {
        // Success path normally navigates away before this fires; safety restore otherwise.
        setTimeout(function(){ restore(); refresh(); }, 4000);
      }
    }

    /* ---------- injection ---------- */
    function blockHtml(){
      return ''
        + '<div id="' + SECTION_ID + '" class="field" style="border-top:1px solid var(--line);padding-top:14px;margin-top:12px">'
        +   '<label style="font-size:15px">💳 Payments <span style="font-weight:400;color:var(--muted)">— get paid directly for your legal reports</span></label>'
        +   '<p class="note" style="margin:2px 0 10px">Set up your Stripe payout account so attorney report payments deposit to your bank automatically (you keep 95%, MLS’s 5% is taken at payment). About 2 minutes with Stripe.</p>'
        +   '<button id="' + BTN_ID + '" type="button" class="btn-primary" style="font-size:14px;padding:9px 15px">Set up payments</button>'
        +   '<div id="' + STATUS_ID + '" class="note" style="margin-top:8px;color:var(--muted)">Checking…</div>'
        + '</div>';
    }

    function findAnchor(){
      var cv = document.getElementById('legalCvText');
      if (!cv) return null;
      var sec = (cv.closest && cv.closest('.set-section')) || cv.parentElement;
      if (!sec) return null;
      var saveBtn = sec.querySelector('button[onclick*="saveLegalProfile"]');
      var footer  = document.getElementById('legalBillFooter');
      return { sec: sec, saveBtn: saveBtn, footer: footer };
    }

    function inject(){
      try {
        if (document.getElementById(SECTION_ID)) return true;
        var a = findAnchor();
        if (!a) return false;
        var tmp = document.createElement('div');
        tmp.innerHTML = blockHtml();
        var block = tmp.firstElementChild;
        // Place it as the final sub-block of the Legal expert profile panel (just after
        // "Save legal profile"), keeping it near the invoice/billing context.
        if (a.saveBtn && a.saveBtn.parentNode){
          a.saveBtn.insertAdjacentElement('afterend', block);
        } else if (a.footer){
          var ff = (a.footer.closest && a.footer.closest('.field')) || a.footer.parentElement;
          (ff || a.sec).appendChild(block);
        } else {
          a.sec.appendChild(block);
        }
        var btn = block.querySelector('#' + BTN_ID);
        if (btn) btn.addEventListener('click', startPayments);
        refresh();
        return true;
      } catch(e){ return false; }
    }

    /* ---------- boot ---------- */
    function boot(){
      if (!inject()){
        var n = 0;
        var iv = setInterval(function(){ n++; if (inject() || n > 40) clearInterval(iv); }, 500);
        _timers.push(iv);
      }
      try {
        _obs = new MutationObserver(function(){
          if (document.getElementById(SECTION_ID)) return; // cheap early-out
          inject();
        });
        if (document.body) _obs.observe(document.body, { childList:true, subtree:true });
      } catch(e){}

      if (/[?&]connect=done/.test(location.search)){
        var t = 0;
        var iv2 = setInterval(function(){ t++; refresh(); if (t >= 6) clearInterval(iv2); }, 1500);
        _timers.push(iv2);
      }
      document.addEventListener('visibilitychange', function(){ if (!document.hidden) refresh(); });
    }

    function revert(){
      try { if (_obs) _obs.disconnect(); } catch(e){}
      _obs = null;
      _timers.forEach(function(t){ try { clearInterval(t); } catch(e){} });
      _timers = [];
      var el = document.getElementById(SECTION_ID);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      try { window.__mlsLegalPaySetup.__installed = false; } catch(e){}
    }

    window.__mlsLegalPaySetup = { __installed:true, revert:revert, refresh:refresh, inject:inject };

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } catch(e){ /* never break the app */ }
})();
