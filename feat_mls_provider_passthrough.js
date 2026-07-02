/* ============================================================================
 * feat_mls_provider_passthrough.js  ->  window.__mlsProv   (v1.0.1)   [item82]
 *
 * COMPLETES THE PER-DOCTOR SCOPING CHAIN (prod fix).
 * Backend (scrivara-backend d9e9a0c/2592675, deployed + live-verified today):
 * GET /api/appointments is uncapped w/ ?date= filtering, and POST persists +
 * returns a `provider` field. But the FRONTEND Athena import never sent one -
 * so every imported appointment stays provider-untagged and per-doctor
 * filtering matches nothing (the "Provider 2..18" / empty-calendar family).
 *
 * What this module does (additive, reversible):
 *  1. "Pulling as:" chip next to the Athena pull button - a provider picker
 *     defaulting to the signed-in clinician (bkUser), with the calendar
 *     roster's providers and an Other... option. Choice persists.
 *  2. While an Athena import is running, any POST /api/appointments that has
 *     NO provider gets stamped with the chosen provider. (Fetch wrapper is
 *     active ONLY during the import window; manual API use is untouched.)
 *  3. Restores the item79 day-summary UX that item81's replacement of
 *     _importPulledSchedule unhooked: after an import, if the imported day is
 *     not today it says so and offers "View that day in Calendar". This wrap
 *     is applied LATE (after item81 boots) and calls whatever import fn is
 *     current - the date-guard logic is preserved untouched.
 *
 * Honest by design: the stamp only applies what the doctor picked, only
 * during the import, and the chip shows exactly what will be stamped.
 * No signing, no Athena writes, no deletes. Revert: window.__mlsProv.revert()
 * ==========================================================================*/
;(function () {
  'use strict';
  try { if (window.__mlsProv && window.__mlsProv.installed) return; } catch (e) { return; }
  var PR = { installed: true, v: '1.0.1', state: {}, _ivs: [], _nodes: [], _orig: {} };
  window.__mlsProv = PR;

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function remember(n) { if (n) PR._nodes.push(n); return n; }
  function safeToast(m, k) { try { if (typeof toast === 'function') toast(m, k || ''); } catch (e) {} }
  function todayISO() { return new Date().toISOString().slice(0, 10); }
  function dayLabel(iso) { try { return new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }); } catch (e) { return iso; } }
  function provKey() { try { return (typeof uns === 'function') ? uns('pullProvider') : 'pullProvider'; } catch (e) { return 'pullProvider'; } }

  function myName() {
    /* bkUser is a top-level let (not on window) - reference it bare, guarded */
    try { if (typeof bkUser !== 'undefined' && bkUser && (bkUser.name || bkUser.full_name || bkUser.display_name)) return String(bkUser.name || bkUser.full_name || bkUser.display_name); } catch (e) {}
    try { var r = (window._calProviders || [])[0]; if (r && r.name) return String(r.name); } catch (e) {}
    try { var m = String((document.querySelector('header') || document.body).innerText || '').match(/Dr\.?\s+([A-Z][A-Za-z.\s]{2,40})/); if (m) return m[1].trim().split('\n')[0]; } catch (e) {}
    return '';
  }
  function rosterNames() {
    var out = [];
    try { (window._calProviders || []).forEach(function (p) { if (p && p.name) out.push(String(p.name)); }); } catch (e) {}
    return out;
  }
  function currentProvider() {
    var v = '';
    try { v = localStorage.getItem(provKey()) || ''; } catch (e) {}
    return v || myName() || '';
  }
  function setProvider(v) {
    try { localStorage.setItem(provKey(), String(v || '')); } catch (e) {}
    paintChip();
  }

  /* ---------- 1. the "Pulling as" chip ---------- */
  var STYLE_ID = 'mlsProvStyle';
  (function () {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '#mlsProvChip{display:inline-flex;align-items:center;gap:6px;margin:6px 0 0;padding:6px 11px;border-radius:9px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.4);color:#fff;font-size:12px;font-weight:700;cursor:pointer;max-width:280px}' +
      '#mlsProvChip .pv-name{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
      '#mlsProvMenu{position:absolute;z-index:99999;background:var(--card,#fff);color:var(--ink,#15243a);border:1px solid var(--line,#d8e1ec);border-radius:11px;box-shadow:0 14px 40px rgba(15,25,40,.3);padding:6px;min-width:230px;display:none}' +
      '#mlsProvMenu .pv-it{padding:8px 11px;border-radius:8px;cursor:pointer;font-size:13px}' +
      '#mlsProvMenu .pv-it:hover{background:rgba(33,104,201,.1)}' +
      '#mlsProvMenu .pv-h{font-size:10.5px;font-weight:800;opacity:.55;padding:6px 11px 2px;text-transform:uppercase;letter-spacing:.6px}';
    document.head.appendChild(st); remember(st);
  })();
  function paintChip() {
    var chip = $('mlsProvChip'); if (!chip) return;
    var v = currentProvider();
    chip.innerHTML = '🩺 Pulling as: <span class="pv-name">' + esc(v || 'pick a doctor') + '</span> ▾';
    chip.title = 'Appointments imported from Athena get tagged with this doctor so per-doctor filtering works. Click to change.';
  }
  function buildMenu(anchor) {
    var old = $('mlsProvMenu'); if (old) old.remove();
    var m = document.createElement('div');
    m.id = 'mlsProvMenu';
    var names = [];
    var mine = myName(); if (mine) names.push(mine);
    rosterNames().forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
    var html = '<div class="pv-h">Tag imported appointments as</div>';
    names.slice(0, 14).forEach(function (n) { html += '<div class="pv-it" data-v="' + esc(n) + '">' + esc(n) + '</div>'; });
    html += '<div class="pv-it" data-v="__other">Other…</div>';
    m.innerHTML = html;
    document.body.appendChild(m); remember(m);
    var r = anchor.getBoundingClientRect();
    m.style.left = Math.max(8, r.left) + 'px';
    m.style.top = (r.bottom + 6 + window.scrollY) + 'px';
    m.style.display = 'block';
    m.addEventListener('click', function (e) {
      var it = e.target.closest('.pv-it'); if (!it) return;
      var v = it.getAttribute('data-v');
      if (v === '__other') { var t = window.prompt('Doctor name to tag pulled appointments with:'); if (t && t.trim()) setProvider(t.trim()); }
      else setProvider(v);
      m.remove();
    });
    setTimeout(function () {
      document.addEventListener('click', function once(ev) { if (!m.contains(ev.target) && ev.target !== anchor) { try { m.remove(); } catch (e) {} document.removeEventListener('click', once); } });
    }, 50);
  }
  function mountChip() {
    if ($('mlsProvChip')) { paintChip(); return; }
    /* anchor chain: pull button -> pull status line -> fixed bottom-left */
    var anchor = document.querySelector('button[onclick^="pullScheduleViaAssist"]');
    var mode = 'after';
    if (!anchor) { anchor = $('heroPullStatus'); }
    var fixed = false;
    if (!anchor) { anchor = document.body; fixed = true; }
    if (!anchor) return;
    var chip = document.createElement('span');
    chip.id = 'mlsProvChip';
    if (fixed) chip.style.cssText = 'position:fixed;left:18px;bottom:18px;z-index:99995;background:linear-gradient(135deg,#0d3c78,#2168c9);border:0';
    chip.addEventListener('click', function (e) { e.stopPropagation(); buildMenu(chip); });
    if (fixed) anchor.appendChild(chip); else anchor.insertAdjacentElement('afterend', chip);
    remember(chip);
    paintChip();
  }
  var chipIv = setInterval(mountChip, 2000); PR._ivs.push(chipIv); mountChip();

  /* ---------- 2 + 3. late wrap of the CURRENT import fn + fetch stamp ---------- */
  function installWraps() {
    /* fetch stamp - only while an import is active */
    if (!window.fetch.__provWrap) {
      PR._orig.fetch = window.fetch;
      var pf = function (input, init) {
        try {
          var url = (typeof input === 'string') ? input : (input && input.url) || '';
          if (PR.state.importActive && init && init.method === 'POST' && /\/api\/appointments(\?|$)/.test(url) && typeof init.body === 'string') {
            var o = JSON.parse(init.body);
            if (o && !String(o.provider || '').trim()) {
              var v = currentProvider();
              if (v) {
                o.provider = v;
                var init2 = {}; for (var k in init) init2[k] = init[k];
                init2.body = JSON.stringify(o);
                PR.state.stamped = (PR.state.stamped || 0) + 1;
                return PR._orig.fetch.call(window, input, init2);
              }
            }
          }
        } catch (e) {}
        return PR._orig.fetch.apply(window, arguments);
      };
      pf.__provWrap = true;
      window.fetch = pf;
    }
    /* wrap whatever _importPulledSchedule is CURRENT (item81's date-guard version) */
    if (typeof window._importPulledSchedule === 'function' && !window._importPulledSchedule.__provWrap) {
      PR._orig.importSched = window._importPulledSchedule;
      var wrap = function (appts) {
        PR.state.importActive = true; PR.state.stamped = 0;
        var tally = {};
        try {
          (appts || []).forEach(function (a) {
            if (!a || !String(a.name || '').trim()) return;
            var d = ''; try { d = (typeof _normDate === 'function' ? _normDate(a.date) : '') || ''; } catch (e) {}
            if (d) tally[d] = (tally[d] || 0) + 1;
          });
        } catch (e) {}
        var fin = function () {
          PR.state.importActive = false;
          try {
            if (PR.state.stamped > 0) safeToast('🩺 Tagged ' + PR.state.stamped + ' imported appointment' + (PR.state.stamped === 1 ? '' : 's') + ' as ' + currentProvider() + '.', 'ok');
            var days = Object.keys(tally);
            if (days.length) {
              var dom = days.reduce(function (m, k) { return tally[k] > (tally[m] || 0) ? k : m; }, days[0]);
              if (dom && dom !== todayISO()) {
                var st = $('heroPullStatus');
                if (st) {
                  var b = document.createElement('button');
                  b.type = 'button';
                  b.textContent = '📅 Imported for ' + dayLabel(dom) + ' — view that day';
                  b.style.cssText = 'display:block;margin-top:6px;background:#fff;color:#0d3c78;border:0;border-radius:9px;padding:7px 12px;font-size:12.5px;font-weight:800;cursor:pointer';
                  b.onclick = function () { try { if (typeof showView === 'function') showView('calendar'); } catch (e) {} try { if (typeof calOpenDay === 'function') calOpenDay(dom); } catch (e) {} };
                  st.insertAdjacentElement('afterend', b); remember(b);
                  setTimeout(function () { try { b.remove(); } catch (e) {} }, 120000);
                }
              }
            }
          } catch (e) {}
        };
        var p;
        try { p = PR._orig.importSched.apply(this, arguments); } catch (e) { fin(); throw e; }
        try { if (p && typeof p.then === 'function') p.then(fin, fin); else setTimeout(fin, 1500); } catch (e) { fin(); }
        return p;
      };
      wrap.__provWrap = true;
      window._importPulledSchedule = wrap;
    }
  }
  /* boot LATE so item81's replacement is already in place, and keep watching
     in case a later module swaps the import fn again (idempotent re-wrap). */
  setTimeout(installWraps, 2500);
  var wrapIv = setInterval(installWraps, 5000); PR._ivs.push(wrapIv);

  PR.revert = function () {
    try { PR._ivs.forEach(function (i) { clearInterval(i); }); } catch (e) {}
    try { if (PR._orig.fetch) window.fetch = PR._orig.fetch; } catch (e) {}
    try { if (PR._orig.importSched) window._importPulledSchedule = PR._orig.importSched; } catch (e) {}
    try { PR._nodes.forEach(function (n) { if (n && n.parentElement) n.parentElement.removeChild(n); }); } catch (e) {}
    PR.installed = false;
    try { delete window.__mlsProv; } catch (e) { window.__mlsProv = undefined; }
  };

  try { console.log('[MLS provider passthrough item82] installed'); } catch (e) {}
})();
