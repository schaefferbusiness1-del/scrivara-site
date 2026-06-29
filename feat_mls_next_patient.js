/* feat_mls_next_patient.js — item68 (STAGING)
 * One-click "Next patient" advance — move through the clinic day without hunting.
 * Adds a compact ◀ Prev / Next ▶ control (with a live "Patient i of N" read) to the
 * Who's Next box header (#heroToday .wn-hd). It walks the SAME shared scoped
 * schedule the picker uses (window.__mlsPick.scopeList().list) and selects the
 * next/previous patient via the app's OWN handler (window.__mlsPick.select(id)),
 * so the active patient, context bar, and picker all stay in agreement — one
 * source of truth, one shared select path. Saves the doctor opening the picker
 * and finding the next slot between every patient.
 * Read-only navigation: only calls the app's existing select(). No data mutation,
 * no athenaOne writes.
 * Additive, reversible: window.__mlsNextPatient.revert()
 */
(function () {
  if (window.__mlsNextPatient && window.__mlsNextPatient.__live) return;

  var WRAP_ID = 'mlsNextPatient';
  var STYLE_ID = 'mlsNextPatient-style';
  var timer = null;
  var idx = -1;

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + WRAP_ID + '{display:inline-flex;align-items:center;gap:6px;margin-left:8px;vertical-align:middle;}',
      '#' + WRAP_ID + ' button{cursor:pointer;border:1px solid rgba(148,163,184,.32);',
      'background:rgba(15,23,42,.5);color:#dbeafe;font:700 12px/1 inherit;padding:5px 9px;',
      'border-radius:8px;display:inline-flex;align-items:center;gap:4px;transition:background .15s,opacity .15s;}',
      '#' + WRAP_ID + ' button:hover{background:rgba(59,130,246,.28);}',
      '#' + WRAP_ID + ' button[disabled]{opacity:.4;cursor:default;}',
      '#' + WRAP_ID + ' .np-pos{font-weight:700;font-size:11.5px;opacity:.85;min-width:74px;text-align:center;}',
      '#' + WRAP_ID + ' .np-next{background:rgba(59,130,246,.22);border-color:rgba(59,130,246,.4);color:#bfdbfe;}'
    ].join('');
    document.head.appendChild(s);
  }

  function header() {
    var b = document.getElementById('heroToday'); if (!b) return null;
    return b.querySelector('.wn-hd') || b;
  }

  function list() {
    try {
      var sl = window.__mlsPick && window.__mlsPick.scopeList && window.__mlsPick.scopeList();
      if (sl && Array.isArray(sl.list)) {
        var l = sl.list.slice();
        l.sort(function (a, b2) { return (a.mins || 0) - (b2.mins || 0); });
        return l;
      }
    } catch (e) {}
    return [];
  }

  function norm(n) { return (n == null ? '' : String(n)).toLowerCase().replace(/[^a-z]/g, ''); }

  function sameNameSet(a, b) {
    function toks(x) { return (x == null ? '' : String(x)).toLowerCase().split(/[^a-z]+/).filter(Boolean).sort().join(' '); }
    var ta = toks(a), tb = toks(b);
    return ta && ta === tb;
  }

  function syncIdx(l) {
    var ap = null;
    try { ap = window.activePatient && window.activePatient(); } catch (e) {}
    if (!ap || !ap.name) return;
    var target = norm(ap.name);
    for (var i = 0; i < l.length; i++) {
      var nm = norm(l[i].name);
      if (nm === target || sameNameSet(l[i].name, ap.name)) { idx = i; return; }
    }
  }

  function nice(n) {
    n = (n == null ? '' : String(n)).trim();
    if (n.indexOf(',') > -1) { var p = n.split(','); return (p[1] || '').trim() + ' ' + (p[0] || '').trim(); }
    return n || 'patient';
  }

  function select(i) {
    var l = list(); if (!l.length) return;
    i = Math.max(0, Math.min(l.length - 1, i));
    idx = i;
    var id = l[i].id;
    try { if (window.__mlsPick && window.__mlsPick.select) window.__mlsPick.select(id); } catch (e) {}
    update();
  }

  function ensure() {
    var h = header(); if (!h) return null;
    var w = document.getElementById(WRAP_ID);
    if (w && w.parentNode === h) return w;
    if (!w) {
      w = document.createElement('span');
      w.id = WRAP_ID;
      w.innerHTML =
        '<button type="button" class="np-prev" aria-label="Previous patient">◀</button>' +
        '<span class="np-pos">—</span>' +
        '<button type="button" class="np-next" aria-label="Next patient">Next ▶</button>';
      w.querySelector('.np-prev').addEventListener('click', function (e) { e.stopPropagation(); var l = list(); if (idx < 0) syncIdx(l); select((idx < 0 ? 0 : idx) - 1); });
      w.querySelector('.np-next').addEventListener('click', function (e) { e.stopPropagation(); var l = list(); if (idx < 0) syncIdx(l); select((idx < 0 ? -1 : idx) + 1); });
    }
    h.appendChild(w);
    return w;
  }

  function update() {
    if (window.__mlsNextPatient && window.__mlsNextPatient.__reverted) return;
    css();
    var w = ensure(); if (!w) return;
    var l = list();
    var pos = w.querySelector('.np-pos');
    var prev = w.querySelector('.np-prev'), next = w.querySelector('.np-next');
    if (!l.length) { pos.textContent = 'No schedule'; prev.disabled = true; next.disabled = true; return; }
    if (idx < 0) syncIdx(l);
    var shown = idx < 0 ? 0 : idx;
    pos.textContent = (shown + 1) + ' of ' + l.length;
    prev.disabled = shown <= 0;
    next.disabled = shown >= l.length - 1;
    var nx = l[Math.min(l.length - 1, shown + 1)];
    if (nx) next.title = 'Go to ' + nice(nx.name);
  }

  function start() { update(); if (timer) clearInterval(timer); timer = setInterval(update, 1500); }

  window.__mlsNextPatient = {
    __live: true,
    __reverted: false,
    next: function () { var l = list(); if (idx < 0) syncIdx(l); select((idx < 0 ? -1 : idx) + 1); },
    prev: function () { var l = list(); if (idx < 0) syncIdx(l); select((idx < 0 ? 0 : idx) - 1); },
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
