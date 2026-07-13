/* feat_mls_day_pace.js — item67 (STAGING)
 * Clinic Day Pace meter — one connective at-a-glance status for the whole clinic day.
 * Reads the SAME shared scoped schedule the Who's Next picker uses
 * (window.__mlsPick.scopeList().list) so the count here always agrees with the
 * picker, the calendar and the "day" everything else is scoped to — one source
 * of truth, surfaced as the doctor's place-in-the-day.
 * Renders a slim strip at the bottom of the Who's Next box (#heroToday):
 *   • a progress bar across the clinic day
 *   • "N done · M to go · T total" when the scoped day is TODAY (live),
 *     or "T appointments · first–last" when viewing another clinic day (honest, no fake live status)
 *   • the next patient + time
 *   • an honest on-time / running-behind read when live
 * Read-only, display-only. No patient-data mutation, no athenaOne writes.
 * Additive, reversible: window.__mlsDayPace.revert()
 */
(function () {
  if (window.__mlsDayPace && window.__mlsDayPace.__live) return;

  var WRAP_ID = 'mlsDayPace';
  var STYLE_ID = 'mlsDayPace-style';
  var timer = null;

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + WRAP_ID + '{margin:10px 0 2px;padding:9px 11px;border-radius:11px;',
      'background:rgba(15,23,42,.42);border:1px solid rgba(148,163,184,.22);',
      'font:600 12px/1.35 inherit;color:#e2e8f0;}',
      '#' + WRAP_ID + ' .dp-top{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 7px;}',
      '#' + WRAP_ID + ' .dp-ttl{font-weight:800;letter-spacing:.02em;font-size:11px;text-transform:uppercase;opacity:.7;}',
      '#' + WRAP_ID + ' .dp-counts{font-weight:800;font-size:12.5px;color:#EAF1EE;}',
      '#' + WRAP_ID + ' .dp-state{margin-left:auto;font-weight:700;font-size:11.5px;padding:2px 9px;border-radius:999px;',
      'background:rgba(16,185,129,.16);color:#6ee7b7;border:1px solid rgba(16,185,129,.30);}',
      '#' + WRAP_ID + ' .dp-state.behind{background:rgba(234,179,8,.16);color:#fde68a;border-color:rgba(234,179,8,.34);}',
      '#' + WRAP_ID + ' .dp-state.view{background:rgba(59,130,246,.16);color:#C9DCD2;border-color:rgba(59,130,246,.30);}',
      '#' + WRAP_ID + ' .dp-bar{position:relative;height:7px;border-radius:999px;overflow:hidden;',
      'background:rgba(148,163,184,.18);}',
      '#' + WRAP_ID + ' .dp-fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;',
      'background:linear-gradient(90deg,#2E6A4B,#C9DCD2);transition:width .5s ease;}',
      '#' + WRAP_ID + ' .dp-next{margin-top:7px;font-weight:600;font-size:12px;opacity:.92;}',
      '#' + WRAP_ID + ' .dp-next b{color:#EAF1EE;font-weight:800;}'
    ].join('');
    document.head.appendChild(s);
  }

  function box() { return document.getElementById('heroToday'); }

  function hhmm(mins) {
    if (mins == null || isNaN(mins)) return '';
    var m = ((mins % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60, ap = h < 12 ? 'AM' : 'PM';
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + (mm < 10 ? '0' + mm : mm) + ' ' + ap;
  }

  function scoped() {
    try {
      var sl = window.__mlsPick && window.__mlsPick.scopeList && window.__mlsPick.scopeList();
      if (sl && Array.isArray(sl.list)) return sl;
    } catch (e) {}
    return null;
  }

  function dayIsToday(list) {
    if (!list || !list.length) return false;
    var t = list[0].time ? new Date(list[0].time) : null;
    if (!t || isNaN(t.getTime())) return false;
    var now = new Date();
    return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate();
  }

  function ensure() {
    var b = box(); if (!b) return null;
    var w = document.getElementById(WRAP_ID);
    if (!w) { w = document.createElement('div'); w.id = WRAP_ID; }
    if (w.parentNode !== b) {
      var grid = b.querySelector('.wn-grid');
      if (grid && grid.nextSibling) b.insertBefore(w, grid.nextSibling);
      else b.appendChild(w);
    }
    return w;
  }

  function nice(n) {
    n = (n == null ? '' : String(n)).trim();
    if (!n) return 'patient';
    if (n.indexOf(',') > -1) { var p = n.split(','); return (p[1] || '').trim() + ' ' + (p[0] || '').trim(); }
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function render() {
    if (window.__mlsDayPace && window.__mlsDayPace.__reverted) return;
    css();
    var w = ensure(); if (!w) return;
    var sl = scoped();
    var list = sl ? sl.list.slice() : [];
    if (!list.length) {
      w.innerHTML = '<div class="dp-top"><span class="dp-ttl">Clinic day</span>' +
        '<span class="dp-counts">No appointments pulled yet</span></div>' +
        '<div class="dp-bar"><div class="dp-fill" style="width:0%"></div></div>';
      return;
    }
    list.sort(function (a, b2) { return (a.mins || 0) - (b2.mins || 0); });
    var total = list.length;
    var first = list[0].mins || 0, last = list[total - 1].mins || 0;
    var label = (sl.dateLabel && String(sl.dateLabel)) || 'Clinic day';
    var live = dayIsToday(list);

    var pct, countsHTML, stateHTML, nextHTML;
    if (live) {
      var now = new Date(), nowMins = now.getHours() * 60 + now.getMinutes();
      var done = list.filter(function (x) { return (x.mins || 0) < nowMins; }).length;
      var togo = total - done;
      var span = Math.max(1, last - first);
      pct = Math.max(0, Math.min(100, Math.round(((nowMins - first) / span) * 100)));
      countsHTML = '<span class="dp-counts">' + done + ' done · ' + togo + ' to go · ' + total + ' total</span>';
      var nxt = list.filter(function (x) { return (x.mins || 0) >= nowMins; })[0];
      if (nxt) {
        nextHTML = 'Next: <b>' + esc(nice(nxt.name)) + '</b> at ' + hhmm(nxt.mins);
        if ((nxt.mins || 0) < nowMins) { stateHTML = '<span class="dp-state behind">Running behind</span>'; }
        else { stateHTML = '<span class="dp-state">On track</span>'; }
      } else {
        nextHTML = 'All ' + total + ' appointments are in the past · last ' + hhmm(last);
        stateHTML = '<span class="dp-state">Day complete</span>';
        pct = 100;
      }
    } else {
      pct = 0;
      countsHTML = '<span class="dp-counts">' + total + ' appointments · ' + hhmm(first) + '–' + hhmm(last) + '</span>';
      stateHTML = '<span class="dp-state view">Viewing ' + esc(label) + '</span>';
      nextHTML = 'First: <b>' + esc(nice(list[0].name)) + '</b> at ' + hhmm(first);
    }

    w.innerHTML =
      '<div class="dp-top"><span class="dp-ttl">Clinic pace · ' + esc(label) + '</span>' +
      countsHTML + stateHTML + '</div>' +
      '<div class="dp-bar"><div class="dp-fill" style="width:' + pct + '%"></div></div>' +
      '<div class="dp-next">' + nextHTML + '</div>';
  }

  function start() { render(); if (timer) clearInterval(timer); timer = setInterval(render, 1500); }

  window.__mlsDayPace = {
    __live: true,
    __reverted: false,
    refresh: render,
    revert: function () {
      this.__reverted = true; this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      var w = document.getElementById(WRAP_ID); if (w) w.remove();
      var st = document.getElementById(STYLE_ID); if (st) st.remove();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
