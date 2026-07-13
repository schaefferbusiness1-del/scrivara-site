/* feat_mls_patient_snapshot.js — item49
 * Patient Snapshot popover — one-click, in-place clinical context.
 * Adds a single "Snapshot" icon button to the active-patient context bar
 * (#mlsCtxBar .mlsctx-actions, alongside Chart / Visit / History / Schedule).
 * Clicking it opens a clean, read-only popover that consolidates the patient's
 * key facts pulled from the SAME source of truth used everywhere else
 * (window.activePatient()): age + DOB, allergies, active-problem count + list,
 * and the most recent visits parsed from the Athena-pulled summary.
 * This lets the doctor glance at the whole patient picture WITHOUT navigating
 * away to the History view and back — fewer clicks, one cohesive card.
 * Read-only, display-only. No patient-data mutation, no athenaOne writes.
 * Additive, reversible: window.__mlsPatientSnapshot.revert()
 */
(function () {
  if (window.__mlsPatientSnapshot && window.__mlsPatientSnapshot.__live) return;

  var BTN_ID = 'mlsSnapshotBtn';
  var POP_ID = 'mlsSnapshotPop';
  var STYLE_ID = 'mlsSnapshot-style';
  var timer = null;
  var open = false;

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + POP_ID + '{position:fixed;z-index:99999;width:340px;max-width:92vw;',
      'max-height:70vh;overflow:auto;border-radius:14px;padding:14px 16px;',
      'background:#0f172a;color:#e2e8f0;border:1px solid rgba(148,163,184,.28);',
      'box-shadow:0 18px 50px rgba(0,0,0,.45);font:500 13px/1.45 inherit;}',
      '#' + POP_ID + ' .mlssnap-h{display:flex;align-items:center;gap:8px;margin:0 0 10px;}',
      '#' + POP_ID + ' .mlssnap-nm{font-weight:800;font-size:15px;letter-spacing:.01em;}',
      '#' + POP_ID + ' .mlssnap-x{margin-left:auto;cursor:pointer;border:none;background:none;',
      'color:#94a3b8;font-size:18px;line-height:1;padding:2px 4px;border-radius:6px;}',
      '#' + POP_ID + ' .mlssnap-x:hover{background:rgba(148,163,184,.16);color:#e2e8f0;}',
      '#' + POP_ID + ' .mlssnap-sec{margin:10px 0 0;}',
      '#' + POP_ID + ' .mlssnap-k{font-size:11px;text-transform:uppercase;letter-spacing:.06em;',
      'opacity:.55;font-weight:700;margin:0 0 4px;}',
      '#' + POP_ID + ' .mlssnap-pill{display:inline-flex;align-items:center;margin:0 6px 6px 0;',
      'padding:3px 9px;border-radius:999px;font-weight:600;font-size:12px;',
      'background:rgba(59,130,246,.16);color:#C9DCD2;border:1px solid rgba(59,130,246,.30);}',
      '#' + POP_ID + ' .mlssnap-pill.alg{background:rgba(220,38,38,.16);color:#fca5a5;border-color:rgba(220,38,38,.34);}',
      '#' + POP_ID + ' .mlssnap-pill.ok{background:rgba(16,185,129,.16);color:#6ee7b7;border-color:rgba(16,185,129,.32);}',
      '#' + POP_ID + ' .mlssnap-v{font-weight:600;}',
      '#' + POP_ID + ' .mlssnap-visit{display:flex;gap:8px;padding:5px 0;border-top:1px solid rgba(148,163,184,.12);}',
      '#' + POP_ID + ' .mlssnap-visit:first-of-type{border-top:none;}',
      '#' + POP_ID + ' .mlssnap-vd{flex:0 0 auto;font-weight:700;color:#C9DCD2;font-size:12px;white-space:nowrap;}',
      '#' + POP_ID + ' .mlssnap-vt{flex:1 1 auto;opacity:.9;font-size:12px;}',
      '#' + POP_ID + ' .mlssnap-foot{margin-top:12px;font-size:11px;opacity:.5;}',
      '#' + BTN_ID + '[aria-pressed="true"]{color:#2E6A4B;}'
    ].join('');
    document.head.appendChild(s);
  }

  function activeP() {
    try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; }
    catch (e) { return null; }
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function computeAge(dob) {
    if (!dob) return null;
    var d = null, t = String(dob).trim();
    var m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) d = new Date(+m[3], +m[1] - 1, +m[2]);
    else { var iso = t.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); if (iso) d = new Date(+iso[1], +iso[2] - 1, +iso[3]); }
    if (!d || isNaN(d.getTime())) return null;
    var now = new Date(), age = now.getFullYear() - d.getFullYear();
    var mo = now.getMonth() - d.getMonth();
    if (mo < 0 || (mo === 0 && now.getDate() < d.getDate())) age--;
    return (age >= 0 && age < 130) ? age : null;
  }

  function parseList(raw) {
    var t = (raw == null ? '' : String(raw)).trim();
    if (!t) return [];
    if (/^(none|n\/a|na|nil)\.?$/i.test(t)) return [];
    var parts = t.split(/[;\n•\|]+|,(?![^()]*\))/).map(function (x) { return x.trim().replace(/\.$/, ''); })
      .filter(function (x) { return x && x.length <= 90; });
    var seen = {}, out = [];
    parts.forEach(function (p) { var k = p.toLowerCase(); if (!seen[k]) { seen[k] = 1; out.push(p); } });
    return out;
  }

  function isNKDA(raw) {
    var t = (raw == null ? '' : String(raw)).trim();
    return !t || /^(nkda|nka|none|no known (drug )?allerg(y|ies)?|denies|n\/a|na)\.?$/i.test(t);
  }

  // Parse "Recent visits:" bullet lines out of the pulled summary text.
  function parseRecentVisits(summary) {
    var t = (summary == null ? '' : String(summary));
    if (!t) return [];
    var idx = t.search(/recent visits?\s*:/i);
    var block = idx >= 0 ? t.slice(idx) : t;
    var lines = block.split(/\n+/);
    var out = [];
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      var mm = ln.match(/^[•\-\*]\s*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})\s*[—\-:]?\s*(.*)$/);
      if (mm) { out.push({ date: mm[1], text: mm[2] || '' }); }
      if (out.length >= 5) break;
    }
    return out;
  }

  function actionsRow() { return document.querySelector('#mlsCtxBar .mlsctx-actions'); }

  function ensureBtn() {
    var row = actionsRow();
    if (!row) return null;
    var btn = document.getElementById(BTN_ID);
    if (btn && btn.parentNode === row) return btn;
    if (!btn) {
      btn = document.createElement('button');
      btn.id = BTN_ID;
      btn.type = 'button';
      btn.className = 'mls-baricon';
      btn.setAttribute('aria-label', 'Patient snapshot');
      btn.setAttribute('aria-pressed', 'false');
      btn.setAttribute('data-tip', 'Snapshot');
      btn.innerHTML = '<svg class="mls-baricon-svg" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="12" cy="12" r="9"></circle><path d="M12 11v5"></path><circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none"></circle></svg>';
      btn.addEventListener('click', function (e) { e.stopPropagation(); toggle(); });
    }
    // place as the first action so it's easy to find
    row.insertBefore(btn, row.firstChild);
    return btn;
  }

  function closePop() {
    open = false;
    var p = document.getElementById(POP_ID); if (p) p.remove();
    var b = document.getElementById(BTN_ID); if (b) b.setAttribute('aria-pressed', 'false');
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('click', onDocClick, true);
  }

  function onKey(e) { if (e.key === 'Escape') closePop(); }
  function onDocClick(e) {
    var p = document.getElementById(POP_ID); var b = document.getElementById(BTN_ID);
    if (!p) return;
    if (p.contains(e.target) || (b && b.contains(e.target))) return;
    closePop();
  }

  function buildPop() {
    var ap = activeP();
    if (!ap) return null;
    var name = (ap.name && String(ap.name).trim()) || 'Patient';
    var age = computeAge(ap.dob);
    var problems = parseList(ap.problems);
    var nkda = isNKDA(ap.allergies);
    var allergies = nkda ? [] : parseList(ap.allergies);
    var visits = parseRecentVisits(ap.summary);

    var pop = document.createElement('div');
    pop.id = POP_ID;
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', 'Patient snapshot');

    var h = '<div class="mlssnap-h"><span class="mlssnap-nm">' + esc(name) + '</span>';
    h += '<button class="mlssnap-x" type="button" aria-label="Close">×</button></div>';

    // identity row
    h += '<div class="mlssnap-sec"><div class="mlssnap-k">At a glance</div>';
    h += '<span class="mlssnap-v">' + (age != null ? ('Age ' + age) : 'Age —');
    if (ap.dob) h += ' · DOB ' + esc(String(ap.dob));
    h += '</span></div>';

    // allergies
    h += '<div class="mlssnap-sec"><div class="mlssnap-k">Allergies</div>';
    if (nkda) h += '<span class="mlssnap-pill ok">NKDA</span>';
    else if (allergies.length) allergies.forEach(function (a) { h += '<span class="mlssnap-pill alg">' + esc(a) + '</span>'; });
    else h += '<span class="mlssnap-pill ok">NKDA</span>';
    h += '</div>';

    // problems
    h += '<div class="mlssnap-sec"><div class="mlssnap-k">Active problems' +
      (problems.length ? ' (' + problems.length + ')' : '') + '</div>';
    if (problems.length) problems.slice(0, 10).forEach(function (p) { h += '<span class="mlssnap-pill">' + esc(p) + '</span>'; });
    else h += '<span class="mlssnap-v" style="opacity:.6">None on file</span>';
    h += '</div>';

    // recent visits
    if (visits.length) {
      h += '<div class="mlssnap-sec"><div class="mlssnap-k">Recent visits</div>';
      visits.forEach(function (v) {
        h += '<div class="mlssnap-visit"><span class="mlssnap-vd">' + esc(v.date) + '</span>' +
          '<span class="mlssnap-vt">' + esc(v.text || '—') + '</span></div>';
      });
      h += '</div>';
    }

    h += '<div class="mlssnap-foot">Read-only · single source: active patient</div>';
    pop.innerHTML = h;
    pop.querySelector('.mlssnap-x').addEventListener('click', closePop);
    return pop;
  }

  function positionPop(pop, btn) {
    var r = btn.getBoundingClientRect();
    var w = 340, vw = window.innerWidth, vh = window.innerHeight;
    var left = Math.min(Math.max(8, r.right - w), vw - w - 8);
    var top = r.bottom + 8;
    pop.style.left = left + 'px';
    // if it would overflow bottom, clamp; max-height handles the rest
    if (top + 200 > vh) top = Math.max(8, vh - Math.min(pop.offsetHeight || 300, vh * 0.7) - 8);
    pop.style.top = top + 'px';
  }

  function toggle() {
    if (open) { closePop(); return; }
    if (window.__mlsPatientSnapshot && window.__mlsPatientSnapshot.__reverted) return;
    var btn = document.getElementById(BTN_ID);
    if (!btn) return;
    var pop = buildPop();
    if (!pop) return;
    document.body.appendChild(pop);
    positionPop(pop, btn);
    open = true;
    btn.setAttribute('aria-pressed', 'true');
    setTimeout(function () {
      document.addEventListener('keydown', onKey, true);
      document.addEventListener('click', onDocClick, true);
    }, 0);
  }

  function tick() {
    if (window.__mlsPatientSnapshot && window.__mlsPatientSnapshot.__reverted) return;
    css();
    ensureBtn();
    if (open) { var p = document.getElementById(POP_ID), b = document.getElementById(BTN_ID); if (p && b) positionPop(p, b); }
  }

  function start() { css(); tick(); if (timer) clearInterval(timer); timer = setInterval(tick, 1200); }

  window.__mlsPatientSnapshot = {
    __live: true,
    __reverted: false,
    open: toggle,
    revert: function () {
      this.__reverted = true;
      this.__live = false;
      if (timer) { clearInterval(timer); timer = null; }
      closePop();
      var b = document.getElementById(BTN_ID); if (b) b.remove();
      var st = document.getElementById(STYLE_ID); if (st) st.remove();
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
