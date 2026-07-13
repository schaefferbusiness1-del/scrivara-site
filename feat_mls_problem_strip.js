/* feat_mls_problem_strip.js — item48
 * Active Problem List strip for the Visit view.
 * Surfaces the ACTIVE patient's active problems / comorbidities as a compact
 * read-only chip strip directly above the Capture / Note / EMR columns (.vx-grid)
 * — the surface where the doctor reviews and signs — so the patient's known
 * problem list (pulled from Athena) is visible at a glance while writing the note.
 * Sits just ABOVE the allergy safety strip (item45) so the two clinical context
 * strips read as one cohesive band; allergies stay closest to the columns.
 * Single source of truth: window.activePatient().problems (a string, usually
 * comma-separated). Read-only, display-only. No patient-data mutation.
 * Additive, reversible: window.__mlsProblemStrip.revert()
 */
(function () {
  if (window.__mlsProblemStrip && window.__mlsProblemStrip.__live) return;

  var STRIP_ID = 'mlsProblemStrip';
  var STYLE_ID = 'mlsProblemStrip-style';
  var ALLERGY_ID = 'mlsAllergyStrip';
  var timer = null;
  var lastKey = '';
  var expanded = false;

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + STRIP_ID + '{display:flex;align-items:center;gap:10px;flex-wrap:wrap;',
      'margin:0 0 8px 0;padding:8px 14px;border-radius:12px;font:500 13px/1.3 inherit;',
      'border:1px solid rgba(59,130,246,.26);background:rgba(59,130,246,.07);}',
      '#' + STRIP_ID + ' .mlspx-lbl{display:inline-flex;align-items:center;gap:6px;',
      'font-weight:700;letter-spacing:.01em;opacity:.92;}',
      '#' + STRIP_ID + ' .mlspx-ico{font-size:15px;line-height:1;}',
      '#' + STRIP_ID + ' .mlspx-pill{display:inline-flex;align-items:center;',
      'padding:3px 10px;border-radius:999px;font-weight:600;font-size:12.5px;',
      'background:rgba(59,130,246,.13);color:#2E6A4B;border:1px solid rgba(59,130,246,.30);}',
      '#' + STRIP_ID + '.mlspx-none{border-color:rgba(120,120,140,.20);background:rgba(255,255,255,.03);}',
      '#' + STRIP_ID + '.mlspx-none .mlspx-pill{background:rgba(120,120,140,.10);color:inherit;',
      'opacity:.7;border-color:rgba(120,120,140,.22);}',
      '#' + STRIP_ID + ' .mlspx-more{cursor:pointer;background:rgba(59,130,246,.06);',
      'color:#2E6A4B;text-decoration:none;}',
      '#' + STRIP_ID + ' .mlspx-more:hover{background:rgba(59,130,246,.18);}',
      '#' + STRIP_ID + ' .mlspx-src{margin-left:auto;font-size:11px;opacity:.55;font-weight:500;}'
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

  function parseProblems(raw) {
    var t = (raw == null ? '' : String(raw)).trim();
    if (!t) return { none: true, items: [] };
    if (/^(none|no (known |active )?problems?|n\/a|na|nil|denies)\.?$/i.test(t)) {
      return { none: true, items: [] };
    }
    var parts = t.split(/[;\n•\|]+|,(?![^()]*\))/).map(function (x) { return x.trim().replace(/\.$/, ''); })
      .filter(function (x) { return x && x.length <= 90; });
    if (!parts.length) return { none: true, items: [] };
    var seen = {}, out = [];
    parts.forEach(function (p) { var k = p.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(p); } });
    return { none: false, items: out };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function build() {
    var el = document.createElement('div');
    el.id = STRIP_ID;
    el.setAttribute('aria-live', 'polite');
    el.addEventListener('click', function (e) {
      var m = e.target.closest && e.target.closest('.mlspx-more');
      if (m) { expanded = !expanded; lastKey = ''; render(); }
    });
    return el;
  }

  // Place strip above the allergy strip if present, else immediately above .vx-grid.
  function place(strip, grid) {
    var allergy = document.getElementById(ALLERGY_ID);
    var anchor = (allergy && allergy.parentNode === grid.parentNode) ? allergy : grid;
    if (strip.nextSibling !== anchor || strip.parentNode !== grid.parentNode) {
      grid.parentNode.insertBefore(strip, anchor);
    }
  }

  function render() {
    if (window.__mlsProblemStrip && window.__mlsProblemStrip.__reverted) return;
    var grid = document.querySelector('.vx-grid');
    var strip = document.getElementById(STRIP_ID);

    if (!visitVisible() || !grid) { if (strip) strip.style.display = 'none'; return; }

    var ap = activeP();
    var hasPt = !!(ap && ap.name && String(ap.name).trim());
    if (!hasPt) { if (strip) strip.style.display = 'none'; return; }

    var info = parseProblems(ap.problems);
    var key = (ap.id || ap.name) + '|' + (ap.problems || '') + '|' + expanded + '|' + visitVisible();
    if (strip && strip.style.display !== 'none' && key === lastKey) { place(strip, grid); return; }
    lastKey = key;

    if (!strip) strip = build();
    place(strip, grid);
    strip.style.display = '';
    strip.className = info.none ? 'mlspx-none' : '';

    var html = '<span class="mlspx-lbl"><span class="mlspx-ico">' +
      (info.none ? '🩺' : '🩺') + '</span>Active problems</span>';
    if (info.none) {
      html += '<span class="mlspx-pill">No active problems on file</span>';
    } else {
      var CAP = 6;
      var show = expanded ? info.items : info.items.slice(0, CAP);
      show.forEach(function (p) { html += '<span class="mlspx-pill">' + esc(p) + '</span>'; });
      var extra = info.items.length - CAP;
      if (!expanded && extra > 0) {
        html += '<span class="mlspx-pill mlspx-more" role="button" tabindex="0">+' + extra + ' more</span>';
      } else if (expanded && info.items.length > CAP) {
        html += '<span class="mlspx-pill mlspx-more" role="button" tabindex="0">show less</span>';
      }
      html += '<span class="mlspx-src">' + info.items.length + ' on file · active patient</span>';
    }
    if (info.none) html += '<span class="mlspx-src">active patient</span>';
    strip.innerHTML = html;
  }

  function start() {
    css();
    render();
    if (timer) clearInterval(timer);
    timer = setInterval(render, 1100);
  }

  window.__mlsProblemStrip = {
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
