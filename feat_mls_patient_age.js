/* feat_mls_patient_age.js -- item41
 * Patient age at-a-glance.
 * A busy clinician constantly needs the patient's age (it drives the
 * differential, dosing and the note) but MLS only ever shows a date of birth --
 * the doctor has to do the math in their head. This adds a small, clean,
 * read-only "Age N" chip in two places:
 *   (A) live underneath any DOB input (the Complex hero #heroPtDob and the
 *       Simple-view "Enter manually" DOB field) -- it updates as the doctor
 *       types the date of birth, so age appears the instant a valid DOB exists;
 *   (B) on the active-patient context bar (#mlsCtxBar) whenever the active
 *       patient has a DOB, so age stays visible all visit long.
 * Purely derived + display-only: it reads a DOB that is already on screen / in
 * activePatient(), computes whole years, and shows them. No PHI is added, no
 * patient data is mutated, no network, no storage. The chip is hidden whenever
 * the DOB is empty, malformed, in the future, or implausible (>140y).
 * Additive + reversible: window.__mlsPatientAge.revert()
 */
;(function () {
  'use strict';
  if (window.__mlsPatientAge) return;

  var STYLE_ID = 'mls-age-style';
  var chips = new Set();            // every chip element we create (for revert)
  var inputMap = new WeakMap();     // input -> { chip, handler }
  var boundInputs = [];             // inputs we attached a handler to (for revert)
  var obs = null, iv = null;

  /* ---- styling: matches app pill badges (Plus Jakarta Sans, 999px radius) ---- */
  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '.mls-age-chip{display:inline-flex;align-items:center;gap:4px;' +
      'font-family:"Plus Jakarta Sans",system-ui,sans-serif;font-weight:700;' +
      'font-size:11px;line-height:1;letter-spacing:.2px;color:#2f6bed;' +
      'background:#e7eefc;border:1px solid #d4e0fb;border-radius:999px;' +
      'padding:3px 9px;white-space:nowrap;vertical-align:middle;}' +
      '.mls-age-hint{margin-top:6px;}' +
      '.mls-age-ctx{margin-left:8px;}' +
      '.mls-age-chip .mls-age-dot{width:5px;height:5px;border-radius:50%;' +
      'background:#2f6bed;display:inline-block;opacity:.75;}';
    (document.head || document.documentElement).appendChild(st);
  }

  /* ---- compute whole-year age from a DOB string in common formats ---- */
  function computeAge(raw) {
    if (!raw) return null;
    var s = String(raw).trim();
    if (!s) return null;
    var y, mo, d, m;
    if ((m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/))) {        // MM/DD/YYYY or MM-DD-YYYY
      mo = +m[1]; d = +m[2]; y = +m[3];
    } else if ((m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/))) { // YYYY-MM-DD (ISO)
      y = +m[1]; mo = +m[2]; d = +m[3];
    } else {
      return null;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 1900) return null;
    var dob = new Date(y, mo - 1, d);
    if (!dob || dob.getFullYear() !== y || dob.getMonth() !== mo - 1 || dob.getDate() !== d) return null; // reject invalid calendar dates
    var now = new Date();
    if (dob > now) return null;                                           // future DOB -> ignore
    var age = now.getFullYear() - dob.getFullYear();
    var mdiff = now.getMonth() - dob.getMonth();
    if (mdiff < 0 || (mdiff === 0 && now.getDate() < dob.getDate())) age--;
    if (age < 0 || age > 140) return null;
    return age;
  }

  function ageLabel(age) {
    if (age === 0) return 'Age <1 yr';
    return 'Age ' + age + (age === 1 ? ' yr' : ' yrs');
  }

  function makeChip(extraClass) {
    var c = document.createElement('span');
    c.className = 'mls-age-chip' + (extraClass ? ' ' + extraClass : '');
    c.setAttribute('data-mls-age', '1');
    c.setAttribute('aria-live', 'polite');
    var dot = document.createElement('span');
    dot.className = 'mls-age-dot';
    var txt = document.createElement('span');
    txt.className = 'mls-age-txt';
    c.appendChild(dot);
    c.appendChild(txt);
    chips.add(c);
    return c;
  }

  function setChip(chip, age) {
    if (!chip) return;
    if (age == null) { chip.style.display = 'none'; return; }
    var t = chip.querySelector('.mls-age-txt');
    if (t) t.textContent = ageLabel(age);
    chip.style.display = 'inline-flex';
  }

  /* ---- (A) DOB inputs: live age hint beneath the field ---- */
  function isDobInput(inp) {
    if (!inp || inp.tagName !== 'INPUT') return false;
    var hay = (inp.id || '') + ' ' + (inp.name || '') + ' ' + (inp.placeholder || '');
    return /MM\/DD\/YYYY/i.test(inp.placeholder || '') || /\bdob\b|birth/i.test(hay);
  }

  function wireInput(inp) {
    if (!inp || inputMap.has(inp) || !isDobInput(inp)) return;
    var chip = makeChip('mls-age-hint');
    chip.style.display = 'none';
    // place as a block-level hint directly after the input (no horizontal overlap)
    var wrap = document.createElement('div');
    wrap.setAttribute('data-mls-age-wrap', '1');
    wrap.style.cssText = 'margin-top:6px;';
    wrap.appendChild(chip);
    chips.add(wrap);
    try {
      if (inp.parentNode) inp.parentNode.insertBefore(wrap, inp.nextSibling);
    } catch (e) { return; }
    var handler = function () { setChip(chip, computeAge(inp.value)); };
    inp.addEventListener('input', handler);
    inp.addEventListener('change', handler);
    inputMap.set(inp, { chip: chip, wrap: wrap, handler: handler });
    boundInputs.push(inp);
    handler(); // seed from any prefilled value
  }

  function scanInputs(root) {
    try {
      var nodes = (root || document).querySelectorAll('input');
      for (var i = 0; i < nodes.length; i++) {
        if (isDobInput(nodes[i])) wireInput(nodes[i]);
      }
    } catch (e) {}
  }

  /* ---- (B) context bar age chip ---- */
  function ctxDob() {
    // prefer the structured active patient, fall back to a DOB token in the bar
    try {
      if (typeof window.activePatient === 'function') {
        var p = window.activePatient();
        if (p && p.dob) return p.dob;
      }
    } catch (e) {}
    try {
      var meta = document.querySelector('#mlsCtxBar .mlsctx-meta');
      if (meta) {
        var m = (meta.textContent || '').match(/\b(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4})\b/);
        if (m) return m[1];
      }
    } catch (e) {}
    return null;
  }

  function syncCtx() {
    var bar = document.getElementById('mlsCtxBar');
    if (!bar) return;
    var nameEl = bar.querySelector('.mlsctx-name');
    var anchor = nameEl || bar.querySelector('.mlsctx-idtext') || bar;
    var chip = bar.querySelector('.mls-age-ctx');
    var age = computeAge(ctxDob());
    if (age == null) { if (chip) chip.style.display = 'none'; return; }
    if (!chip) {
      chip = makeChip('mls-age-ctx');
      try {
        if (nameEl && nameEl.parentNode) nameEl.parentNode.insertBefore(chip, nameEl.nextSibling);
        else anchor.appendChild(chip);
      } catch (e) { return; }
    }
    setChip(chip, age);
  }

  /* ---- wiring / lifecycle ---- */
  var applying = false;
  function tick() {
    if (applying) return;
    applying = true;
    try { injectStyle(); scanInputs(document); syncCtx(); } catch (e) {}
    applying = false;
  }

  function start() {
    tick();
    try {
      obs = new MutationObserver(function () { if (!applying) tick(); });
      obs.observe(document.body || document.documentElement,
        { childList: true, subtree: true });
    } catch (e) {}
  }

  // poll briefly for the app to mount, then rely on the observer
  var tries = 0;
  iv = setInterval(function () {
    tries++;
    tick();
    if (obs || tries > 40) { clearInterval(iv); iv = null; }
    if (!obs && (document.getElementById('mlsCtxBar') || document.querySelector('input'))) start();
  }, 500);

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  window.__mlsPatientAge = {
    revert: function () {
      try { if (obs) obs.disconnect(); } catch (e) {}
      obs = null;
      if (iv) { clearInterval(iv); iv = null; }
      // remove input listeners
      boundInputs.forEach(function (inp) {
        try {
          var rec = inputMap.get(inp);
          if (rec) {
            inp.removeEventListener('input', rec.handler);
            inp.removeEventListener('change', rec.handler);
          }
        } catch (e) {}
      });
      boundInputs = [];
      // remove every element we created
      chips.forEach(function (el) {
        try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {}
      });
      chips.clear();
      try { var st = document.getElementById(STYLE_ID); if (st) st.parentNode.removeChild(st); } catch (e) {}
      try { delete window.__mlsPatientAge; } catch (e) { window.__mlsPatientAge = undefined; }
    },
    _info: function () {
      return { inputs: boundInputs.length, chips: chips.size, observing: !!obs };
    }
  };
})();
