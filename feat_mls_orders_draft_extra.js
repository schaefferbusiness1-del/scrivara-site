/* =============================================================================
 * feat_mls_orders_draft_extra.js -> window.__mlsOrdersDraftExtra   (ode-1.0.0)
 * -----------------------------------------------------------------------------
 * TASK 9 — Orders Draft Workspace, missing categories (APP-SIDE ONLY).
 *
 * The live EMR-sections panel (#emrPanel) already ships draft-only support for
 * imaging, PT, procedures/orders, injections (suggested chips), referrals,
 * medications (rx), and follow-up — all order-class keys are held target-only
 * and NEVER sent (extension force-holds them too). This module adds the FOUR
 * remaining requested categories as additive DRAFT-ONLY cards:
 *
 *     Surgery-center scheduling  ·  Consent  ·  Handouts  ·  Patient instructions
 *
 * Each card is a labeled textarea + "confirm" checkbox that is DRAFT / never
 * sent to athenaOne. Safety by construction: these keys are unknown to every
 * write path, so:
 *   - feat_mls_writeflow.js gatherSections(): execute = EXEC_KEYS[k] && !ORDER_CLASS[k]
 *     -> false for these keys -> target-only, never executed.
 *   - __mlsEmrSectionsWrite gather(): not in SEND_HEADERS -> never added to the
 *     send payload at all.
 *   - feat_mls_writeback_safety.js: these keys are in its ORDER_CLASS/draft set
 *     -> counted as DRAFT, never satisfy the "clinical content to write" rule.
 * So confirming one of these can never place an order or write to Athena.
 *
 * The cards are injected as a sibling AFTER #emrBody so the panel's own
 * fill()/innerHTML rebuild (which replaces #emrBody only) does not wipe them;
 * a MutationObserver re-injects if the panel is re-rendered.
 *
 * NOTE (product taxonomy — flagged for the Fable sweep / Michael): consent,
 * handouts, and patient instructions are patient-facing DOCUMENTS rather than
 * athenaOne orders. They are treated here as draft/never-auto-sent (safest
 * default; the clinician prints/attaches them). If a future decision wants them
 * to drive a print/attach action, that is a separate build.
 *
 * Additive; revert(): window.__mlsOrdersDraftExtra.revert(). ASCII-only.
 * ===========================================================================*/
(function () {
  'use strict';
  if (window.__mlsOrdersDraftExtra && window.__mlsOrdersDraftExtra.installed) return;

  var VERSION = 'ode-1.0.0';
  var CARDS = [
    { k: 'surgctr', label: 'Surgery-center scheduling', ph: '(surgical procedure, preferred facility/date, pre-op needs — DRAFT; schedule in athenaOne / the surgery center yourself)' },
    { k: 'consent', label: 'Consent', ph: '(consent items to review/obtain — DRAFT; capture the signed consent in athenaOne yourself)' },
    { k: 'handouts', label: 'Handouts', ph: '(education handouts to give the patient — DRAFT; print/attach as needed)' },
    { k: 'instructions', label: 'Patient instructions', ph: '(home-care / return-precaution instructions for the patient — DRAFT; not sent to athenaOne)' }
  ];
  var KEYS = { surgctr: 1, consent: 1, handouts: 1, instructions: 1 };
  var stopped = false;

  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;'); }

  function cardHtml(c) {
    return '<div style="background:#141b3d;border:1px dashed rgba(217,119,6,.5);border-radius:12px;padding:12px 14px;margin-bottom:10px" data-ode-card="' + c.k + '">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
      '<b style="color:#ffcf8f">' + esc(c.label) + '</b>' +
      '<label style="font-size:12px;color:#9fb0d8;display:flex;gap:6px;cursor:pointer"><input type="checkbox" data-k="' + c.k + '">confirm</label></div>' +
      '<textarea data-t="' + c.k + '" style="width:100%;margin-top:8px;min-height:38px;background:#0f1530;border:1px solid rgba(120,140,220,.22);border-radius:8px;color:#e8ecff;padding:8px 10px;font:13px/1.5 system-ui;resize:vertical" placeholder="' + esc(c.ph) + '"></textarea>' +
      '<div style="font-size:11px;color:#ffcf8f;margin-top:4px">DRAFT &mdash; kept here for your reference; <b>never sent to athenaOne</b>.</div>' +
      '</div>';
  }

  function inject(panel) {
    try {
      if (stopped || !panel) return;
      var body = panel.querySelector('#emrBody');
      if (!body) return;
      /* already present and still attached? */
      var host = panel.querySelector('#mlsOrdersDraftExtra');
      if (host && host.parentElement) return;
      host = document.createElement('div');
      host.id = 'mlsOrdersDraftExtra';
      host.innerHTML = '<div style="font:700 12.5px system-ui;color:#ffcf8f;margin:4px 0 8px">Draft-only (never sent to athenaOne)</div>' +
        CARDS.map(cardHtml).join('');
      /* insert right AFTER #emrBody so the panel's own #emrBody rebuild can't wipe it */
      if (body.nextSibling) body.parentElement.insertBefore(host, body.nextSibling);
      else body.parentElement.appendChild(host);
    } catch (e) {}
  }

  /* classify(key): 'draft' for these keys, else null. Consumed by tests + docs. */
  function classify(k) { return KEYS[k] ? 'draft' : null; }

  var mo = null, iv = null;
  function tick() { var p = document.getElementById('emrPanel'); if (p) inject(p); }
  function boot() {
    tick();
    try { mo = new MutationObserver(function () { if (!stopped) tick(); }); mo.observe(document.body, { childList: true, subtree: true }); } catch (e) {}
    try { iv = setInterval(function () { if (!stopped) tick(); }, 1500); } catch (e) {}
  }
  function revert() {
    stopped = true;
    try { if (mo) mo.disconnect(); } catch (e) {}
    try { if (iv) clearInterval(iv); } catch (e) {}
    try { var h = document.querySelectorAll('#mlsOrdersDraftExtra'); for (var i = 0; i < h.length; i++) h[i].remove(); } catch (e) {}
    window.__mlsOrdersDraftExtra.installed = false;
  }

  window.__mlsOrdersDraftExtra = {
    installed: true, version: VERSION, keys: KEYS, cards: CARDS,
    classify: classify, inject: inject, revert: revert
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
