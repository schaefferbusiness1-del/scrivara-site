/* ============================================================
   MLS — Legal request "chart filled" confirmation
   ------------------------------------------------------------
   Additive, self-contained UI module. When a clinician clicks
   "Open chart" inside a legal request (legalOpenPatient ->
   selectPatient + setActivePtId), this:
     1. Records, per legal request, that the client's chart was
        pulled, which patient (name) + a light record detail.
        Persisted in localStorage (user-scoped via uns()) so it
        survives refresh / navigation.
     2. Flips that request's "Open chart" control, in the same
        spot, to "Chart filled with <patient>'s data". The
        flipped control stays clickable to re-open / refresh.
     3. Shows a banner inside the fulfill dialog (legalModal)
        / report card ("Using <patient>'s chart") so the data
        source feeding "fulfill request" is unambiguous. The
        name is read from the live active patient the report
        actually uses, falling back to the request record.

   No PHI leaves the device; everything reads the doctor's own
   local app state. Touches nothing in the existing bundles.
   ============================================================ */
(function () {
  'use strict';
  if (window.__mlsLegalChartFill) return; // idempotent
  var NS = 'mlsLegalChartFill';

  /* ---------- storage (reuse the app's user-scoped keys) ---------- */
  function uns(k) {
    try { return (typeof window.uns === 'function') ? window.uns(k) : ('mls::' + k); }
    catch (e) { return 'mls::' + k; }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(uns(NS)) || '{}') || {}; }
    catch (e) { return {}; }
  }
  function save(o) {
    try { localStorage.setItem(uns(NS), JSON.stringify(o)); } catch (e) {}
  }
  function patients() {
    try {
      if (typeof window.getPatients === 'function') return window.getPatients() || [];
      /* sj-2.0 ROGUE RE-ROUTE (design: tests/live-e2e-artifacts/2026-08-11-sj2-patients-idb-design.md):
         post-migration the patients blob key is RETIRED, so the raw read below
         returns null and this fallback silently serves ZERO patients. When the
         primitive is live, serve its in-memory roster; the legacy raw
         read+decode stays for contexts where the primitive never loads. */
      var sjStore = window.__mlsPtsStore;
      if (sjStore && typeof sjStore.isReady === 'function' && sjStore.isReady()) {
        try { return (sjStore.getRoster() || []).slice(); } catch (eSj) { return []; }
      }
      var raw = localStorage.getItem(uns('patients')) || '[]';
      if (typeof window.__mlsPtsDecode === 'function') raw = window.__mlsPtsDecode(raw);
      return JSON.parse(raw) || [];
    }
    catch (e) { return []; }
  }
  function patientById(id) {
    if (id == null) return null;
    var list = patients();
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }
  function activePatient() {
    try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; }
    catch (e) { return null; }
  }

  /* ---------- helpers ---------- */
  function prettyName(n) {
    n = (n || '').trim();
    if (n.indexOf(',') > -1) {
      var parts = n.split(',');
      return ((parts[1] || '').trim() + ' ' + (parts[0] || '').trim()).trim();
    }
    return n;
  }
  function recordDetail(p) {
    if (!p) return '';
    var vc = 0;
    try { if (typeof window.patientNotes === 'function') vc = (window.patientNotes(p.id) || []).length; } catch (e) {}
    if (!vc) vc = Array.isArray(p.visits) ? p.visits.length
           : (Array.isArray(p.notes) ? p.notes.length : 0);
    return vc ? (vc + ' visit' + (vc === 1 ? '' : 's')) : '';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  /* ---------- request <-> row mapping ---------- */
  function reqIdFromRow(rowEl) {
    if (!rowEl || !rowEl.querySelector) return null;
    var b = rowEl.querySelector('[onclick*="openLegalRequest("]')
         || rowEl.querySelector('[onclick*="deleteLegalRequest("]');
    if (!b) return null;
    var m = (b.getAttribute('onclick') || '')
      .match(/(?:openLegalRequest|deleteLegalRequest)\(\s*'([^']+)'/);
    return m ? m[1] : null;
  }
  function pidFromBtn(btn) {
    if (!btn) return null;
    var m = (btn.getAttribute('onclick') || '').match(/legalOpenPatient\(\s*'([^']+)'/);
    return m ? m[1] : null;
  }
  function rowForReq(reqId) {
    var list = document.getElementById('legalReqList');
    if (!list) return null;
    var rows = list.children;
    for (var i = 0; i < rows.length; i++) {
      if (reqIdFromRow(rows[i]) === String(reqId)) return rows[i];
    }
    return null;
  }

  /* ---------- record a fill ---------- */
  function recordFill(reqId, pid) {
    if (!reqId) return;
    var p = patientById(pid);
    var name = p ? p.name : (function () { var a = activePatient(); return a && a.name || ''; })();
    var store = load();
    store[reqId] = {
      pid: pid,
      name: name,
      detail: recordDetail(p),
      ts: Date.now()
    };
    save(store);
  }

  /* ---------- flip the "Open chart" button to filled state ---------- */
  function decorateRow(rowEl) {
    if (!rowEl || !rowEl.querySelector) return;
    var reqId = reqIdFromRow(rowEl);
    if (!reqId) return;
    var rec = load()[reqId];
    var ocBtn = rowEl.querySelector('button[onclick*="legalOpenPatient("]');

    // wire a one-time listener so a fresh click records the fill
    if (ocBtn && !ocBtn.__mlsWired) {
      ocBtn.__mlsWired = true;
      var pid = pidFromBtn(ocBtn);
      ocBtn.addEventListener('click', function () {
        window.__mlsActiveLegalReq = reqId;
        setTimeout(function () {
          recordFill(reqId, pid);
          decorateRow(rowForReq(reqId) || rowEl);
          updateBanner();
        }, 60);
      });
    }

    if (!rec || !ocBtn) return;

    // already flipped for this exact record? skip (avoids observer loops)
    if (ocBtn.getAttribute('data-mls-cf') === String(rec.ts)) return;

    var pretty = prettyName(rec.name) || 'the client';
    ocBtn.classList.add('mls-chart-filled-btn');
    ocBtn.setAttribute('data-mls-cf', String(rec.ts));
    ocBtn.setAttribute('title',
      pretty + "'s chart is loaded and feeds this report. Click to re-open / refresh.");
    ocBtn.innerHTML = '✓ Chart filled with ' + escapeHtml(pretty) + "'s data"
      + (rec.detail ? ' <span class="mls-cf-detail">(' + escapeHtml(rec.detail) + ')</span>' : '')
      + ' <span class="mls-cf-refresh" aria-hidden="true">↻</span>';
  }

  function decorateAll() {
    var list = document.getElementById('legalReqList');
    if (!list) return;
    var rows = list.children;
    for (var i = 0; i < rows.length; i++) decorateRow(rows[i]);
  }

  /* ---------- banner inside the fulfill dialog / report card ---------- */
  function fulfillSurface() {
    var modal = document.getElementById('legalModal');
    if (modal && /(^|\s)show(\s|$)/.test(modal.className || '')) {
      return modal.querySelector('.modal') || modal;
    }
    var card = document.getElementById('legalCard');
    if (card && card.offsetParent !== null) return card;
    return null;
  }
  function fulfillName() {
    // Only the explicit Legal attachment is a valid report source. Never describe
    // an unrelated chart that merely happens to be active elsewhere in the app.
    var attached = null;
    try {
      var id = (typeof legalAttachedPatientId !== 'undefined') ? legalAttachedPatientId : null;
      if (id) attached = patientById(id);
    } catch (e) {}
    if (attached && attached.name) return { name: attached.name, detail: recordDetail(attached) };
    var reqId = window.__mlsActiveLegalReq;
    var rec = reqId ? load()[reqId] : null;
    if (rec && rec.pid) {
      var recorded = patientById(rec.pid);
      try {
        var explicitId = (typeof legalAttachedPatientId !== 'undefined') ? legalAttachedPatientId : null;
        if (explicitId && recorded && String(explicitId) === String(rec.pid)) return { name: recorded.name || rec.name, detail: recordDetail(recorded) || rec.detail || '' };
      } catch (e) {}
    }
    return null;
  }
  function updateBanner() {
    var banner = document.getElementById('mlsUsingChartBanner');
    var surface = fulfillSurface();
    var who = surface ? fulfillName() : null;
    if (!surface || !who) { if (banner) banner.style.display = 'none'; return; }
    var pretty = prettyName(who.name) || 'the client';
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'mlsUsingChartBanner';
      banner.className = 'mls-using-chart';
    }
    if (banner.parentElement !== surface) {
      var note = surface.querySelector('p.note');
      if (note && note.nextSibling) surface.insertBefore(banner, note.nextSibling);
      else if (note) surface.appendChild(banner);
      else surface.insertBefore(banner, surface.firstChild);
    }
    banner.style.display = '';
    banner.innerHTML = '📄 Using <b>' + escapeHtml(pretty)
      + "'s chart</b>" + (who.detail ? ' (' + escapeHtml(who.detail) + ')' : '')
      + ' — this is the patient data feeding this report.';
  }

  /* ---------- hook fulfill open so we know the active request ---------- */
  function hookFulfill() {
    if (typeof window.openLegalRequest !== 'function'
        || window.openLegalRequest.__mlsWrapped) return;
    var orig = window.openLegalRequest;
    window.openLegalRequest = function (reqId) {
      window.__mlsActiveLegalReq = reqId;
      var r = orig.apply(this, arguments);
      try { setTimeout(updateBanner, 90); } catch (e) {}
      return r;
    };
    window.openLegalRequest.__mlsWrapped = true;
  }

  /* ---------- styles ---------- */
  function injectStyle() {
    if (document.getElementById('mls-chart-fill-style')) return;
    var st = document.createElement('style');
    st.id = 'mls-chart-fill-style';
    st.textContent =
      '.mls-chart-filled-btn{background:#e7f6ec!important;border:1px solid #38a169!important;'
      + 'color:#22683f!important;font-weight:600!important;}'
      + '.mls-chart-filled-btn .mls-cf-detail{font-weight:400;opacity:.8;}'
      + '.mls-chart-filled-btn .mls-cf-refresh{opacity:.7;margin-left:2px;}'
      + '.mls-using-chart{background:#eef4ff;border:1px solid #2E6A4B;color:#204034;'
      + 'border-radius:8px;padding:8px 12px;font-size:13px;margin:6px 0 10px;}';
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------- observe re-renders ---------- */
  function scheduleDecorate() {
    if (window.__mlsCfRaf) cancelAnimationFrame(window.__mlsCfRaf);
    window.__mlsCfRaf = requestAnimationFrame(decorateAll);
  }
  function observe() {
    // Anchor on the stable parent container so we still catch re-renders
    // even if loadLegalRequests replaces the #legalReqList node itself
    // (e.g. when the doctor returns to the Legal tab and it refetches).
    var view = document.getElementById('legalReqView');
    if (view && !view.__mlsCfViewObs) {
      var mo0 = new MutationObserver(scheduleDecorate);
      mo0.observe(view, { childList: true, subtree: true });
      view.__mlsCfViewObs = mo0;
    }
    var list = document.getElementById('legalReqList');
    if (list && !list.__mlsCfObs) {
      var mo = new MutationObserver(scheduleDecorate);
      mo.observe(list, { childList: true, subtree: true });
      list.__mlsCfObs = mo;
    }
    var modal = document.getElementById('legalModal');
    if (modal && !modal.__mlsCfObs) {
      var mo2 = new MutationObserver(function () { updateBanner(); });
      mo2.observe(modal, { attributes: true, attributeFilter: ['class', 'style'] });
      modal.__mlsCfObs = mo2;
    }
    var card = document.getElementById('legalCard');
    if (card && !card.__mlsCfObs) {
      var mo3 = new MutationObserver(function () { updateBanner(); });
      mo3.observe(card, { attributes: true, attributeFilter: ['style', 'class'] });
      card.__mlsCfObs = mo3;
    }
  }

  /* ---------- boot ---------- */
  function boot() {
    injectStyle();
    hookFulfill();
    decorateAll();
    observe();
  }

  var tries = 0;
  var iv = setInterval(function () {
    tries++;
    if (document.getElementById('legalReqList') || document.getElementById('legalCard')
        || document.getElementById('legalModal')) {
      boot();
    }
    if (tries > 120) clearInterval(iv);
  }, 500);

  if (document.readyState !== 'loading') setTimeout(boot, 0);
  else document.addEventListener('DOMContentLoaded', boot);

  window.__mlsLegalChartFill = {
    decorateAll: decorateAll,
    updateBanner: updateBanner,
    recordFill: recordFill,
    _load: load
  };
})();
