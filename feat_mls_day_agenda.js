/* feat_mls_day_agenda.js — item69 (STAGING)
 * Full-day agenda panel — the WHOLE clinic day in one place, click any patient to jump.
 * The Who's Next box only shows the next few patients; this adds a "Full day (N)"
 * toggle to its header that opens a clean, scrollable list of EVERY appointment on
 * the shared scoped schedule (window.__mlsPick.scopeList().list): time · name,
 * the next-up patient highlighted. Clicking a row selects that patient through the
 * app's OWN handler (window.__mlsPick.select(id)) — same source of truth, same
 * select path as the picker and the calendar. Lets the doctor see and jump to
 * anyone in the day without paging the picker.
 * Read-only list + the app's existing select(). No data mutation, no athenaOne writes.
 * Additive, reversible: window.__mlsDayAgenda.revert()
 */
(function () {
  if (window.__mlsDayAgenda && window.__mlsDayAgenda.__live) return;

  var BTN_ID = 'mlsDayAgendaBtn';
  var PANEL_ID = 'mlsDayAgendaPanel';
  var STYLE_ID = 'mlsDayAgenda-style';
  var timer = null;
  var open = false;

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + BTN_ID + '{cursor:pointer;border:1px solid rgba(148,163,184,.32);margin-left:8px;vertical-align:middle;',
      'background:rgba(15,23,42,.5);color:#dbeafe;font:700 12px/1 inherit;padding:5px 9px;border-radius:8px;',
      'display:inline-flex;align-items:center;gap:5px;transition:background .15s;}',
      '#' + BTN_ID + ':hover{background:rgba(59,130,246,.28);}',
      '#' + BTN_ID + '[aria-expanded="true"]{background:rgba(59,130,246,.3);color:#EAF1EE;}',
      '#' + PANEL_ID + '{margin:9px 0 2px;border-radius:11px;border:1px solid rgba(148,163,184,.22);',
      'background:rgba(15,23,42,.5);overflow:hidden;font:600 12px/1.3 inherit;color:#e2e8f0;}',
      '#' + PANEL_ID + ' .ag-hd{display:flex;align-items:center;gap:8px;padding:8px 11px;',
      'border-bottom:1px solid rgba(148,163,184,.16);font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.7;font-weight:800;}',
      '#' + PANEL_ID + ' .ag-list{max-height:230px;overflow:auto;}',
      '#' + PANEL_ID + ' .ag-row{display:flex;align-items:center;gap:10px;padding:7px 11px;cursor:pointer;',
      'border-top:1px solid rgba(148,163,184,.08);transition:background .12s;}',
      '#' + PANEL_ID + ' .ag-row:first-child{border-top:none;}',
      '#' + PANEL_ID + ' .ag-row:hover{background:rgba(59,130,246,.16);}',
      '#' + PANEL_ID + ' .ag-row.now{background:rgba(34,211,238,.14);}',
      '#' + PANEL_ID + ' .ag-row.now .ag-nm{color:#a5f3fc;}',
      '#' + PANEL_ID + ' .ag-t{flex:0 0 auto;font-weight:800;color:#C9DCD2;font-size:11.5px;width:74px;white-space:nowrap;}',
      '#' + PANEL_ID + ' .ag-nm{flex:1 1 auto;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
      '#' + PANEL_ID + ' .ag-go{flex:0 0 auto;opacity:0;font-size:11px;color:#EAF1EE;font-weight:800;}',
      '#' + PANEL_ID + ' .ag-row:hover .ag-go{opacity:1;}',
      '#' + PANEL_ID + ' .ag-empty{padding:14px 11px;opacity:.6;}'
    ].join('');
    document.head.appendChild(s);
  }

  function box() { return document.getElementById('heroToday'); }
  function header() { var b = box(); return b ? (b.querySelector('.wn-hd') || b) : null; }

  function list() {
    try {
      var sl = window.__mlsPick && window.__mlsPick.scopeList && window.__mlsPick.scopeList();
      if (sl && Array.isArray(sl.list)) {
        var l = sl.list.slice();
        l.sort(function (a, b2) { return (a.mins || 0) - (b2.mins || 0); });
        return { list: l, label: (sl.dateLabel && String(sl.dateLabel)) || 'Clinic day' };
      }
    } catch (e) {}
    return { list: [], label: 'Clinic day' };
  }

  function hhmm(mins) {
    if (mins == null || isNaN(mins)) return '';
    var m = ((mins % 1440) + 1440) % 1440, h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + (mm < 10 ? '0' + mm : mm) + ' ' + ap;
  }
  function nice(n) {
    n = (n == null ? '' : String(n)).trim();
    if (n.indexOf(',') > -1) { var p = n.split(','); return (p[1] || '').trim() + ' ' + (p[0] || '').trim(); }
    return n || 'patient';
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function dayIsToday(l) {
    if (!l.length) return false;
    var t = l[0].time ? new Date(l[0].time) : null;
    if (!t || isNaN(t.getTime())) return false;
    var n = new Date();
    return t.getFullYear() === n.getFullYear() && t.getMonth() === n.getMonth() && t.getDate() === n.getDate();
  }

  function ensureBtn() {
    var h = header(); if (!h) return null;
    var b = document.getElementById(BTN_ID);
    if (b && b.parentNode === h) return b;
    if (!b) {
      b = document.createElement('button');
      b.id = BTN_ID; b.type = 'button';
      b.setAttribute('aria-expanded', 'false');
      b.innerHTML = '<span>📋 Full day</span><span class="ag-n"></span>';
      b.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    }
    h.appendChild(b);
    return b;
  }

  function buildPanel() {
    var data = list();
    var l = data.list;
    var panel = document.getElementById(PANEL_ID);
    if (!panel) { panel = document.createElement('div'); panel.id = PANEL_ID; }
    var live = dayIsToday(l);
    var nowMins = (function () { var n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
    var nextIdx = -1;
    if (live) { for (var k = 0; k < l.length; k++) { if ((l[k].mins || 0) >= nowMins) { nextIdx = k; break; } } }

    var h = '<div class="ag-hd"><span>' + esc(data.label) + ' · ' + l.length + ' appointments</span></div>';
    if (!l.length) {
      h += '<div class="ag-empty">No appointments on the pulled schedule yet.</div>';
    } else {
      h += '<div class="ag-list">';
      for (var i = 0; i < l.length; i++) {
        var p = l[i];
        var cls = (i === nextIdx) ? ' now' : '';
        h += '<div class="ag-row' + cls + '" data-id="' + esc(p.id) + '">' +
          '<span class="ag-t">' + hhmm(p.mins) + '</span>' +
          '<span class="ag-nm">' + esc(nice(p.name)) + (i === nextIdx ? ' &middot; next' : '') + '</span>' +
          '<span class="ag-go">Open ▶</span></div>';
      }
      h += '</div>';
    }
    panel.innerHTML = h;
    Array.prototype.forEach.call(panel.querySelectorAll('.ag-row'), function (row) {
      row.addEventListener('click', function (e) {
        e.stopPropagation();
        var id = row.getAttribute('data-id');
        try { if (window.__mlsPick && window.__mlsPick.select) window.__mlsPick.select(id); } catch (err) {}
      });
    });
    return panel;
  }

  function toggle() {
    var b = box(); if (!b) return;
    open = !open;
    var btn = document.getElementById(BTN_ID);
    if (open) {
      var panel = buildPanel();
      if (panel.parentNode !== b) b.appendChild(panel);
      if (btn) btn.setAttribute('aria-expanded', 'true');
    } else {
      var p = document.getElementById(PANEL_ID); if (p) p.remove();
      if (btn) btn.setAttribute('aria-expanded', 'false');
    }
  }

  function tick() {
    if (window.__mlsDayAgenda && window.__mlsDayAgenda.__reverted) return;
    css();
    var b = ensureBtn();
    if (b) { var n = b.querySelector('.ag-n'); var l = list().list; if (n) n.textContent = l.length ? ('(' + l.length + ')') : ''; }
    if (open) {
      var host = box();
      var cur = document.getElementById(PANEL_ID);
      if (!cur || cur.parentNode !== host) {
        var panel = buildPanel();
        if (host) host.appendChild(panel);
        if (b) b.setAttribute('aria-expanded', 'true');
      } else {
        var fresh = buildPanel();
        cur.replaceWith(fresh);
      }
    }
  }

  function start() { css(); tick(); if (timer) clearInterval(timer); timer = setInterval(tick, 2000); }

  window.__mlsDayAgenda = {
    __live: true,
    __reverted: false,
    toggle: toggle,
    revert: function () {
      this.__reverted = true; this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      var p = document.getElementById(PANEL_ID); if (p) p.remove();
      var b = document.getElementById(BTN_ID); if (b) b.remove();
      var st = document.getElementById(STYLE_ID); if (st) st.remove();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
