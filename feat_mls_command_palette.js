/* =========================================================================
 * MLS -- Command Palette  (feat_mls_command_palette.js -> window.__mlsCmdPalette, cpal-1.0.0)
 * 2026-07-12, final integration sweep (demo polish lane).
 * ----------------------------------------------------------------------------
 * Ctrl+K / Cmd+K (or the header "Search" pill) opens a fast fuzzy palette over:
 *   - PATIENTS (name / MRN / DOB; rows always show name + DOB + MRN so a
 *     same-name pick is identity-labeled, never name-alone) -> verified
 *     id-based selectPatient + Patients view
 *   - ACTIONS (start/stop recording, generate note, dictate a letter, guided
 *     tour, legal requests, reviews, every main view) -- this is also the
 *     coherence bridge for features that were only reachable via the Menu
 *   - NOTES full-text search (>=3 chars) -> opens that patient's History
 * Safety: no writeback, no orders, no signing; "start recording" refuses
 * honestly when no patient is open. Everything is additive and reversible:
 *   window.__mlsCmdPalette.revert()
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCmdPalette && window.__mlsCmdPalette.installed) return; } catch (e) { return; }

  var VERSION = 'cpal-1.0.0';
  var OV_ID = 'mlsCpalOverlay', BTN_ID = 'mlsCpalBtn', STYLE_ID = 'mlsCpalStyle';

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isFn(f) { return typeof f === 'function'; }
  function $(id) { return safe(function () { return document.getElementById(id); }, null); }
  function S(x) { return x == null ? '' : String(x); }
  function esc(s) { return S(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function toast(m, k) { safe(function () { if (isFn(window.toast)) window.toast(m, k || ''); }); }

  /* ---------------- css ---------------- */
  function css() {
    if ($(STYLE_ID)) return;
    var st = document.createElement('style'); st.id = STYLE_ID;
    st.textContent = [
      '#' + OV_ID + '{position:fixed;inset:0;z-index:2147483000;background:rgba(10,22,44,.38);backdrop-filter:blur(3px);display:flex;align-items:flex-start;justify-content:center;padding:9vh 16px 16px}',
      '#' + OV_ID + ' .cpal-card{width:100%;max-width:640px;background:#fff;border-radius:16px;box-shadow:0 30px 90px rgba(8,20,45,.45);overflow:hidden;font:500 14px/1.45 "Plus Jakarta Sans",system-ui,sans-serif;color:#16324f}',
      '#' + OV_ID + ' .cpal-inp{width:100%;box-sizing:border-box;border:0;outline:none;padding:16px 18px;font:600 16px/1.4 inherit;color:#1A211C;border-bottom:1px solid #e6edf6;background:#fbfdff}',
      '#' + OV_ID + ' .cpal-list{max-height:52vh;overflow-y:auto;padding:6px}',
      '#' + OV_ID + ' .cpal-row{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;cursor:pointer}',
      '#' + OV_ID + ' .cpal-row.sel{background:#EAF1EC}',
      '#' + OV_ID + ' .cpal-row .ic{width:22px;text-align:center;flex:none}',
      '#' + OV_ID + ' .cpal-row .main{flex:1;min-width:0}',
      '#' + OV_ID + ' .cpal-row .t{font-weight:700;color:#12294a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#' + OV_ID + ' .cpal-row .d{font-size:12px;color:#65788f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '#' + OV_ID + ' .cpal-sec{font:700 11px/1 inherit;letter-spacing:.08em;text-transform:uppercase;color:#8296ad;padding:10px 12px 4px}',
      '#' + OV_ID + ' .cpal-empty{padding:22px 16px;color:#65788f;text-align:center}',
      '#' + OV_ID + ' .cpal-foot{display:flex;gap:14px;padding:9px 14px;border-top:1px solid #e6edf6;background:#f8fbff;color:#7d90a8;font-size:11.5px}',
      '#' + OV_ID + ' .cpal-foot kbd{background:#eef3fa;border:1px solid #d9e4f0;border-bottom-width:2px;border-radius:5px;padding:1px 5px;font:700 10.5px/1.3 inherit;color:#3d5877}',
      '#' + BTN_ID + '{display:inline-flex;align-items:center;gap:7px;margin-left:10px;padding:6px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.28);background:rgba(255,255,255,.12);color:#dbe7ff;font:600 12px/1 "Plus Jakarta Sans",system-ui,sans-serif;cursor:pointer;transition:background .15s}',
      '#' + BTN_ID + ':hover{background:rgba(255,255,255,.22)}',
      '#' + BTN_ID + ' kbd{background:rgba(255,255,255,.16);border-radius:4px;padding:1px 5px;font-size:10.5px}',
      '@media (max-width:700px){#' + BTN_ID + '{display:none}}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---------------- data sources ---------------- */
  function patients() { return safe(function () { return isFn(window.getPatients) ? (window.getPatients() || []) : []; }, []); }
  function notes() { return safe(function () { return isFn(window.getNotes) ? (window.getNotes() || []) : []; }, []); }
  function activePt() { return safe(function () { return isFn(window.activePatient) ? window.activePatient() : null; }, null); }
  function nav(view) { var b = $('nav_' + view); if (b) { b.click(); return true; } return safe(function () { if (isFn(window.showView)) { window.showView(view); return true; } return false; }, false); }

  function actionList() {
    var acts = [
      { icon: '🎙️', title: 'Start recording', desc: 'Begin capturing this visit (needs an open patient)', kw: 'start recording record visit capture', run: function () {
          var ap = activePt();
          if (!ap || !ap.name) { toast('No patient is open -- pick one first (try typing their name here).', 'err'); return; }
          nav('visit');
          safe(function () { if (isFn(window.startCapture)) window.startCapture(); else if (isFn(window.heroStartVisit)) window.heroStartVisit(); });
        } },
      { icon: '⏹', title: 'Stop recording', desc: 'Stop the current capture', kw: 'stop recording end finish', run: function () { safe(function () { if (isFn(window.stopCapture)) window.stopCapture(); }); } },
      { icon: '📝', title: 'Generate note', desc: 'Draft the note from the recording', kw: 'generate note write create', run: function () { nav('visit'); safe(function () { if (isFn(window.generateNote)) window.generateNote(); }); } },
      { icon: '✉️', title: 'Dictate a letter', desc: 'Draft-and-preview letter tool (never sends)', kw: 'dictate letter referral work excuse', run: function () {
          var b = $('mlsdlLaunch'); if (b) { b.click(); } else { toast('The letter tool has not loaded yet.', 'err'); }
        } },
      { icon: '🎓', title: 'Guided tour', desc: 'Open the onboarding walkthrough', kw: 'tour help onboarding how to guide', run: function () { safe(function () { var t = window.__mlsOnboardingTour || window.__mlsGuidedTour; if (t && isFn(t.open)) t.open(); }); } },
      { icon: '⚖️', title: 'Legal requests', desc: 'Attorney requests and medical-legal reports', kw: 'legal attorney lawyer report narrative', run: function () { var r = $('mlsNavRow_legalreq'); if (r) r.click(); else nav('legalreq'); } },
      { icon: '⭐', title: 'Reviews & reputation', desc: 'Practice reviews dashboard', kw: 'reviews reputation google rating', run: function () { if (!nav('reviews')) toast('Reviews opens from the Menu on this build.', ''); } }
    ];
    var views = [['visit', '🏠', 'Visit'], ['patients', '👥', 'Patients'], ['calendar', '📅', 'Calendar'], ['history', '🗃', 'History'], ['analysis', '📊', 'Analysis'], ['studio', '✨', 'AI Studio'], ['settings', '⚙️', 'Settings']];
    for (var i = 0; i < views.length; i++) {
      (function (v) {
        acts.push({ icon: v[1], title: 'Go to ' + v[2], desc: 'Open the ' + v[2] + ' view', kw: 'go open view tab ' + v[0] + ' ' + v[2].toLowerCase(), run: function () { nav(v[0]); } });
      })(views[i]);
    }
    return acts;
  }

  /* ---------------- search ---------------- */
  function scoreText(hay, q) {
    hay = hay.toLowerCase(); q = q.toLowerCase();
    if (!q) return 1;
    var idx = hay.indexOf(q);
    if (idx === 0) return 100;
    if (idx > 0) return 60 - Math.min(40, idx);
    /* all words present? */
    var words = q.split(/\s+/), all = true;
    for (var i = 0; i < words.length; i++) if (hay.indexOf(words[i]) < 0) { all = false; break; }
    return all ? 30 : 0;
  }
  function search(q) {
    q = S(q).trim();
    var out = { patients: [], actions: [], notes: [] };
    var ps = patients();
    for (var i = 0; i < ps.length; i++) {
      var p = ps[i]; if (!p || !p.name) continue;
      var sc = Math.max(scoreText(S(p.name), q), scoreText(S(p.mrn || ''), q), q.length >= 4 ? scoreText(S(p.dob || ''), q) : 0);
      if (sc > 0) out.patients.push({ p: p, sc: sc });
    }
    out.patients.sort(function (a, b) { return b.sc - a.sc || S(a.p.name).localeCompare(S(b.p.name)); });
    out.patients = out.patients.slice(0, q ? 7 : 5);
    var acts = actionList();
    for (var j = 0; j < acts.length; j++) {
      var a = acts[j];
      var asc = Math.max(scoreText(a.title, q), scoreText(a.kw, q));
      if (asc > 0) out.actions.push({ a: a, sc: asc });
    }
    out.actions.sort(function (x, y) { return y.sc - x.sc; });
    out.actions = out.actions.slice(0, q ? 6 : 7);
    if (q.length >= 3) {
      var ns = notes(), hits = 0;
      for (var k = 0; k < ns.length && hits < 5; k++) {
        var n = ns[k]; if (!n || !n.note) continue;
        var pos = S(n.note).toLowerCase().indexOf(q.toLowerCase());
        if (pos >= 0) {
          hits++;
          var snip = S(n.note).slice(Math.max(0, pos - 24), pos + q.length + 40).replace(/\s+/g, ' ');
          out.notes.push({ n: n, snip: snip });
        }
      }
    }
    return out;
  }

  /* ---------------- overlay ---------------- */
  var selIdx = 0, flatRows = [];
  function close() { var ov = $(OV_ID); if (ov && ov.parentNode) ov.parentNode.removeChild(ov); }
  function open() {
    css(); close();
    var ov = document.createElement('div'); ov.id = OV_ID;
    ov.innerHTML = '<div class="cpal-card">' +
      '<input class="cpal-inp" id="mlsCpalInp" type="text" placeholder="Search patients, notes, or type an action…" autocomplete="off" spellcheck="false">' +
      '<div class="cpal-list" id="mlsCpalList"></div>' +
      '<div class="cpal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> navigate</span><span><kbd>Enter</kbd> select</span><span><kbd>Esc</kbd> close</span></div>' +
      '</div>';
    ov.addEventListener('mousedown', function (e) { if (e.target === ov) close(); });
    document.body.appendChild(ov);
    var inp = $('mlsCpalInp');
    var deb = null;
    inp.addEventListener('input', function () { if (deb) clearTimeout(deb); deb = setTimeout(function () { render(inp.value); }, 70); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); pick(selIdx); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    render('');
    setTimeout(function () { safe(function () { inp.focus(); }); }, 30);
  }
  function move(d) {
    if (!flatRows.length) return;
    selIdx = (selIdx + d + flatRows.length) % flatRows.length;
    paintSel();
  }
  function paintSel() {
    var list = $('mlsCpalList'); if (!list) return;
    var rows = list.querySelectorAll('.cpal-row');
    for (var i = 0; i < rows.length; i++) rows[i].classList.toggle('sel', i === selIdx);
    var el = rows[selIdx]; if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  }
  function pick(i) {
    var r = flatRows[i]; if (!r) return;
    close();
    setTimeout(function () { safe(r.run); }, 20);
  }
  function render(q) {
    var list = $('mlsCpalList'); if (!list) return;
    var res = search(q);
    flatRows = []; selIdx = 0;
    var html = '';
    function row(icon, title, desc, run) {
      var idx = flatRows.length;
      flatRows.push({ run: run });
      html += '<div class="cpal-row' + (idx === 0 ? ' sel' : '') + '" data-i="' + idx + '"><span class="ic">' + icon + '</span><span class="main"><span class="t">' + title + '</span><br><span class="d">' + desc + '</span></span></div>';
    }
    if (res.patients.length) {
      html += '<div class="cpal-sec">Patients</div>';
      res.patients.forEach(function (x) {
        var p = x.p;
        row('👤', esc(p.name), 'DOB ' + esc(p.dob || '?') + ' · ' + esc(p.mrn || 'no MRN'),
          function () { safe(function () { if (isFn(window.selectPatient)) window.selectPatient(p.id); }); nav('patients'); toast('Opened ' + p.name + ' (DOB ' + (p.dob || '?') + ')', 'ok'); });
      });
    }
    if (res.actions.length) {
      html += '<div class="cpal-sec">Actions</div>';
      res.actions.forEach(function (x) { row(x.a.icon, esc(x.a.title), esc(x.a.desc), x.a.run); });
    }
    if (res.notes.length) {
      html += '<div class="cpal-sec">Notes</div>';
      res.notes.forEach(function (x) {
        var n = x.n;
        row('📄', esc(S(n.patient || 'Unassigned')) + ' · ' + esc(S(n.date || '')), '…' + esc(x.snip) + '…',
          function () {
            var pid = n.patientId || n.ptId;
            if (pid) safe(function () { if (isFn(window.selectPatient)) window.selectPatient(pid); });
            nav('history');
          });
      });
    }
    if (!flatRows.length) html = '<div class="cpal-empty">No matches — try a patient name, an action like “generate note”, or text from a past visit.</div>';
    list.innerHTML = html;
    var rows = list.querySelectorAll('.cpal-row');
    for (var i = 0; i < rows.length; i++) {
      (function (el) {
        el.addEventListener('mouseenter', function () { selIdx = parseInt(el.getAttribute('data-i'), 10) || 0; paintSel(); });
        el.addEventListener('click', function () { pick(parseInt(el.getAttribute('data-i'), 10) || 0); });
      })(rows[i]);
    }
  }

  /* ---------------- global hotkey + header button ---------------- */
  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === 'k') {
      e.preventDefault(); e.stopPropagation();
      if ($(OV_ID)) close(); else open();
    }
  }
  function ensureBtn() {
    if ($(BTN_ID)) return;
    var host = document.querySelector('#appHeader .nav, #appHeader nav, #appHeader') || null;
    if (!host) return;
    var b = document.createElement('button');
    b.id = BTN_ID; b.type = 'button';
    b.innerHTML = '🔍 Search <kbd>Ctrl K</kbd>';
    b.title = 'Search patients, notes and actions (Ctrl+K / ⌘K)';
    b.addEventListener('click', function () { open(); });
    host.appendChild(b);
  }

  var tickIv = null;
  function boot() {
    css();
    safe(ensureBtn);
    document.addEventListener('keydown', onKey, true);
    tickIv = setInterval(function () { safe(ensureBtn); }, 2500);
  }
  function revert() {
    try { document.removeEventListener('keydown', onKey, true); } catch (e) {}
    if (tickIv) { clearInterval(tickIv); tickIv = null; }
    close();
    ['mlsCpalBtn', STYLE_ID].forEach(function (id) { var n = $(id); if (n && n.parentNode) n.parentNode.removeChild(n); });
    try { window.__mlsCmdPalette.installed = false; } catch (e) {}
    return 'command palette reverted';
  }

  window.__mlsCmdPalette = { installed: true, version: VERSION, asset: 'feat_mls_command_palette.js', open: open, close: close, _search: search, revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
