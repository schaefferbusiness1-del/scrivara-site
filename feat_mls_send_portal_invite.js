/* ============================================================================
 * feat_mls_send_portal_invite.js — STAGING
 * ----------------------------------------------------------------------------
 * "📧 Send portal login to patient" button pinned into the always-visible
 * patient context bar (#mlsCtxBar, legacy fallback #patientBar).
 *
 * WHAT IT DOES: one clinician click emails the ACTIVE patient a secure,
 * single-use link to their patient portal (mlsscribe.com/patient-portal.html),
 * where they log in and chat with AI about their own visits/history (the
 * existing hardened, ownership-scoped portal). Uses the email already on file;
 * if none, prompts the clinician to confirm one. Confirms BEFORE sending, calls
 * POST /api/patient/admin/send-portal-invite (clinician Bearer auth via
 * bkBase()/bkToken()), then shows a receipt toast. NEVER sends autonomously —
 * always a deliberate click + confirm.
 *
 * GUARDRAILS: additive & reversible (window.__mlsSendPortalInvite.revert()).
 * Self-contained IIFE, try/catch throughout. Display/trigger only — never
 * writes, edits, or deletes any chart/note/record; no PHI is placed in the
 * email (the backend builds a PHI-free body). Idempotent; never modifies
 * existing app functions; reads state via public globals only.
 * ==========================================================================*/
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsSendPortalInvite && window.__mlsSendPortalInvite.__booted) return;

  var BTN_ID = 'mlsSendPortalInviteBtn';
  var STYLE_ID = 'mlsSendPortalInvite-style';
  var WRAP_STYLE_ID = 'mls-ctxbar-wrap-style';
  var timer = null, origRenderBar = null, busy = false;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  function toast(m, kind) {
    safe(function () {
      if (window.toast) { window.toast(m, kind || 'ok'); return; }
      var d = document.createElement('div'); d.textContent = m;
      d.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1A211C;color:#fff;padding:9px 15px;border-radius:10px;z-index:2147483600;font-size:13px;max-width:80vw;text-align:center';
      document.body.appendChild(d); setTimeout(function () { d.remove(); }, 2600);
    });
  }

  function activeId() {
    return safe(function () { return (window.getActivePtId && window.getActivePtId()) || null; }, null);
  }
  function activePt() {
    return safe(function () {
      if (typeof window.activePatient === 'function') { var ap = window.activePatient(); if (ap) return ap; }
      var id = activeId(); if (id == null) return null;
      if (typeof window.findPatient === 'function') { var p = window.findPatient(id); if (p) return p; }
      var ps = (window.getPatients && window.getPatients()) || [];
      for (var i = 0; i < ps.length; i++) if (ps[i] && String(ps[i].id) === String(id)) return ps[i];
      return null;
    }, null);
  }
  function ptEmail(p) {
    if (!p) return '';
    var e = p.email || p.patient_email || (p.contact && p.contact.email) || (p.demographics && p.demographics.email) || '';
    return String(e || '').trim();
  }
  function ptName(p) { return (p && (p.name || p.fullName)) || 'this patient'; }

  function apiBase() { return safe(function () { return (window.bkBase && window.bkBase()) || ''; }, ''); }
  function apiTok() { return safe(function () { return (window.bkToken && window.bkToken()) || ''; }, ''); }

  function injectCss() {
    if (document.getElementById(STYLE_ID)) return;
    safe(function () {
      var s = document.createElement('style'); s.id = STYLE_ID;
      s.textContent =
        '#' + BTN_ID + '{display:inline-flex;align-items:center;gap:6px;margin-left:10px;' +
        'padding:3px 11px;border-radius:999px;font-size:12px;line-height:1.2;font-weight:600;' +
        'cursor:pointer;border:1px solid rgba(32,64,52,.42);background:rgba(32,64,52,.12);' +
        'color:#2E6A4B;vertical-align:middle;white-space:nowrap;transition:background .15s ease,box-shadow .15s ease;}' +
        '#' + BTN_ID + ':hover{background:rgba(32,64,52,.2);box-shadow:0 1px 6px rgba(32,64,52,.22);}' +
        '#' + BTN_ID + '[aria-disabled="true"]{opacity:.55;cursor:default;box-shadow:none;}' +
        '#' + BTN_ID + ' .spi-ico{font-size:13px;line-height:1;}' +
        'body.theme-dark #' + BTN_ID + '{background:rgba(59,130,246,.16);border-color:rgba(59,130,246,.5);color:#EAF1EE;}';
      document.head.appendChild(s);
    });
  }
  function ensureWrapStyle() {
    if (document.getElementById(WRAP_STYLE_ID)) return;
    safe(function () {
      var s = document.createElement('style'); s.id = WRAP_STYLE_ID;
      s.textContent = '#mlsCtxBar{flex-wrap:wrap;row-gap:6px;}';
      document.head.appendChild(s);
    });
  }

  // Locate the visible patient context bar + a stable insertion anchor.
  function visibleBar() {
    /* b742: not into the active-patient banner (owner 2026-07-27, "almost no
       buttons"). Sending a patient their portal login is a deliberate act, not
       something to keep one pixel from the patient's name on every screen. The
       capability is not lost: "Send to your patients" -> Patient portal access
       -> Send login does the same thing, prefilled from the active patient.
       Legacy #patientBar path unchanged. */
    var pb = document.getElementById('patientBar');
    if (pb) { try { if (pb.style.display !== 'none' && pb.offsetParent !== null) {
      var inner = document.getElementById('patientBarInner');
      return { bar: pb, anchor: pb.querySelector('.spacer') || (inner ? inner.nextSibling : null) }; } } catch (e) {} }
    return null;
  }

  /* non-blocking dialog helpers (native only when the in-app modals are absent) */
  function askPrompt(msg) { try { return (typeof window.mlsPrompt === 'function') ? window.mlsPrompt(msg, '') : Promise.resolve(safe(function () { return window.prompt(msg); }, null)); } catch (e) { return Promise.resolve(null); } }
  function askConfirm(msg) { try { return (typeof window.mlsConfirm === 'function') ? window.mlsConfirm(msg) : Promise.resolve(safe(function () { return window.confirm(msg); }, false)); } catch (e) { return Promise.resolve(false); } }
  async function send() {
    if (busy) return;
    var p = activePt();
    var ext = activeId();
    if (!p || ext == null || ext === '') { toast('Open a patient first.', 'err'); return; }

    var email = ptEmail(p);
    if (!email) {
      var typed = await askPrompt('No email on file for ' + ptName(p) + '. Enter the patient’s email to send their portal login:');
      if (typed == null) return;                 // cancelled
      email = String(typed).trim();
      if (!email || email.indexOf('@') < 0) { toast('That doesn’t look like a valid email.', 'err'); return; }
    }

    var ok = await askConfirm('Email a secure patient-portal login link to:\n\n' + email + '\n\n(' + ptName(p) + ')\n\nThe email contains no medical details — just a single-use sign-in link.');
    if (!ok) return;

    var base = apiBase(), tok = apiTok();
    if (!base || !tok) { toast('Not signed in to the server — can’t send right now.', 'err'); return; }

    busy = true; setBtnState();
    safe(function () {
      fetch(base + '/api/patient/admin/send-portal-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + tok },
        credentials: 'include',
        body: JSON.stringify({ external_id: String(ext), email: email })
      }).then(function (r) {
        return r.json().then(function (j) { return { status: r.status, body: j || {} }; })
                       .catch(function () { return { status: r.status, body: {} }; });
      }).then(async function (res) {
        busy = false; setBtnState();
        var b = res.body || {};
        if (res.status === 200 && b.ok) {
          if (b.sent) toast('✅ Portal login emailed to ' + (b.email || email));
          else toast('Link created, but email isn’t configured on the server yet — nothing was sent. Ask your admin to finish email setup.', 'err');
        } else if (res.status === 422 || b.error === 'no_email') {
          // backend says no usable email — re-prompt once.
          var typed = await askPrompt('The server has no email on file. Enter the patient’s email:');
          if (typed && typed.indexOf('@') > -1) { var p2 = activePt(); if (p2) { p2.email = String(typed).trim(); } send(); }
        } else if (res.status === 401 || res.status === 403) {
          toast('Not authorized to send portal invites.', 'err');
        } else if (res.status === 404) {
          toast('That patient chart wasn’t found on the server.', 'err');
        } else {
          toast('Couldn’t send the portal login (server said: ' + (b.error || res.status) + ').', 'err');
        }
      }).catch(function () {
        busy = false; setBtnState();
        toast('Network error — the portal login wasn’t sent.', 'err');
      });
    });
  }

  function setBtnState() {
    var btn = document.getElementById(BTN_ID); if (!btn) return;
    btn.setAttribute('aria-disabled', busy ? 'true' : 'false');
    btn.innerHTML = '<span class="spi-ico">' + (busy ? '⏳' : '📧') + '</span> ' + (busy ? 'Sending…' : 'Send portal login to patient');
  }

  function render() {
    var loc = visibleBar(); if (!loc) return;
    ensureWrapStyle(); injectCss();
    var hasPt = activeId() != null && activeId() !== '';
    var btn = document.getElementById(BTN_ID);

    if (!hasPt) { if (btn && btn.parentNode) btn.parentNode.removeChild(btn); return; }

    if (!btn) {
      btn = document.createElement('span');
      btn.id = BTN_ID; btn.setAttribute('role', 'button'); btn.tabIndex = 0;
      btn.title = 'Email this patient a secure one-time link to their patient portal';
      btn.addEventListener('click', function (ev) { ev.preventDefault(); ev.stopPropagation(); if (!busy) send(); });
      btn.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); if (!busy) send(); } });
    }
    // (re)mount in the right place without disturbing other chips/actions.
    if (loc.anchor && loc.anchor.parentNode === loc.bar) {
      if (btn.nextSibling !== loc.anchor || btn.parentNode !== loc.bar) loc.bar.insertBefore(btn, loc.anchor);
    } else if (btn.parentNode !== loc.bar) {
      loc.bar.appendChild(btn);
    }
    setBtnState();
  }

  function boot() {
    injectCss(); ensureWrapStyle();
    safe(function () { render(); });
    // re-render on active-patient changes via the app's own render path
    if (typeof window.renderPatientBar === 'function' && !origRenderBar) {
      origRenderBar = window.renderPatientBar;
      window.renderPatientBar = function () { var r; try { r = origRenderBar.apply(this, arguments); } catch (e) {} try { render(); } catch (e) {} return r; };
    }
    // belt-and-suspenders idempotent poll (also catches view switches)
    timer = setInterval(function () { safe(function () { render(); }); }, 1200);
  }

  window.__mlsSendPortalInvite = {
    __booted: true,
    send: function () { safe(function () { send(); }); },
    render: function () { safe(function () { render(); }); },
    revert: function () {
      try { if (timer) { clearInterval(timer); timer = null; } } catch (e) {}
      try { if (origRenderBar) { window.renderPatientBar = origRenderBar; origRenderBar = null; } } catch (e) {}
      [BTN_ID, STYLE_ID].forEach(function (id) { var n = document.getElementById(id); if (n && n.parentNode) n.parentNode.removeChild(n); });
      window.__mlsSendPortalInvite.__booted = false;
      return true;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
