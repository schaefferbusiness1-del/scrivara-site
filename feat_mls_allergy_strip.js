/* feat_mls_allergy_strip.js — item45
 * Allergy safety strip for the Visit view.
 * Surfaces the ACTIVE patient's allergies as a high-visibility strip directly
 * above the Capture/Note/EMR columns (.vx-grid) — the place where the doctor
 * reviews and signs — where allergies are currently NOT shown.
 * Single source of truth: window.activePatient().allergies (a string).
 * Read-only, display-only. Additive, reversible: window.__mlsAllergyStrip.revert()
 */
(function () {
  if (window.__mlsAllergyStrip && window.__mlsAllergyStrip.__live) return;

  var STRIP_ID = 'mlsAllergyStrip';
  var STYLE_ID = 'mlsAllergyStrip-style';
  var timer = null;
  var lastKey = '';

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + STRIP_ID + '{display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
      'margin:0 0 12px 0;padding:8px 14px;border-radius:12px;font:500 13px/1.3 inherit;',
      'border:1px solid rgba(120,120,140,.18);background:rgba(255,255,255,.04);}',
      '#' + STRIP_ID + ' .mlsalg-lbl{display:inline-flex;align-items:center;gap:6px;',
      'font-weight:700;letter-spacing:.01em;opacity:.92;text-transform:none;}',
      '#' + STRIP_ID + ' .mlsalg-ico{font-size:15px;line-height:1;}',
      '#' + STRIP_ID + ' .mlsalg-pill{display:inline-flex;align-items:center;',
      'padding:3px 10px;border-radius:999px;font-weight:600;font-size:12.5px;',
      'background:rgba(220,38,38,.14);color:#dc2626;border:1px solid rgba(220,38,38,.30);}',
      '#' + STRIP_ID + '.mlsalg-none{border-color:rgba(16,185,129,.28);background:rgba(16,185,129,.08);}',
      '#' + STRIP_ID + '.mlsalg-none .mlsalg-pill{background:rgba(16,185,129,.14);color:#2E6A4B;',
      'border-color:rgba(16,185,129,.30);}',
      '#' + STRIP_ID + '.mlsalg-has{border-color:rgba(220,38,38,.28);background:rgba(220,38,38,.06);}',
      '#' + STRIP_ID + ' .mlsalg-src{margin-left:auto;font-size:11px;opacity:.55;font-weight:500;}'
    ].join('');
    document.head.appendChild(s);
  }

  function activeP() {
    try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; }
    catch (e) { return null; }
  }

  function visitVisible() {
    var g = document.querySelector('.vx-grid');
    return !!(g && g.offsetParent !== null);
  }

  // Parse the allergies string into a normalized list. Returns {none:true} for NKDA/empty.
  function parseAllergies(raw) {
    var t = (raw == null ? '' : String(raw)).trim();
    if (!t) return { none: true, items: [] };
    if (/^(nkda|nka|none|no known (drug )?allerg(y|ies)?|denies|n\/a|na)\.?$/i.test(t)) {
      return { none: true, items: [] };
    }
    var parts = t.split(/[;,\n•\|]+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x && x.length <= 80; });
    if (!parts.length) return { none: true, items: [] };
    // de-dup, cap to keep the strip clean
    var seen = {}, out = [];
    parts.forEach(function (p) { var k = p.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(p); } });
    return { none: false, items: out.slice(0, 12), extra: Math.max(0, out.length - 12) };
  }

  function build() {
    var el = document.createElement('div');
    el.id = STRIP_ID;
    el.setAttribute('aria-live', 'polite');
    return el;
  }

  function render() {
    if (window.__mlsAllergyStrip && window.__mlsAllergyStrip.__reverted) return;
    var grid = document.querySelector('.vx-grid');
    var strip = document.getElementById(STRIP_ID);

    if (!visitVisible() || !grid) {
      if (strip) strip.style.display = 'none';
      return;
    }
    var ap = activeP();
    var hasPt = !!(ap && ap.name && String(ap.name).trim());
    if (!hasPt) { if (strip) strip.style.display = 'none'; return; }

    var info = parseAllergies(ap.allergies);
    var key = (ap.id || ap.name) + '|' + (ap.allergies || '') + '|' + visitVisible();
    if (strip && strip.style.display !== 'none' && key === lastKey) return; // no change
    lastKey = key;

    if (!strip) { strip = build(); }
    if (strip.parentNode !== grid.parentNode || strip.nextSibling !== grid) {
      grid.parentNode.insertBefore(strip, grid);
    }
    strip.style.display = '';
    strip.className = info.none ? 'mlsalg-none' : 'mlsalg-has';

    var html = '<span class="mlsalg-lbl"><span class="mlsalg-ico">' +
      (info.none ? '✅' : '⚠️') + '</span>Allergies</span>';
    if (info.none) {
      html += '<span class="mlsalg-pill">NKDA · No known drug allergies</span>';
    } else {
      info.items.forEach(function (a) {
        html += '<span class="mlsalg-pill">' + esc(a) + '</span>';
      });
      if (info.extra) html += '<span class="mlsalg-pill">+' + info.extra + ' more</span>';
    }
    html += '<span class="mlsalg-src">active patient</span>';
    strip.innerHTML = html;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function start() {
    css();
    render();
    if (timer) clearInterval(timer);
    timer = setInterval(render, 1100);
  }

  window.__mlsAllergyStrip = {
    __live: true,
    __reverted: false,
    render: render,
    revert: function () {
      this.__reverted = true;
      this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      var s = document.getElementById(STRIP_ID); if (s) s.remove();
      var st = document.getElementById(STYLE_ID); if (st) st.remove();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
