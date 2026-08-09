/* feat_mls_allergy_strip.js — item45
 * Allergy safety strip for the Visit view.
 * Surfaces the ACTIVE patient's allergies as a high-visibility strip directly
 * above the Capture/Note/EMR columns (.vx-grid) — the place where the doctor
 * reviews and signs — where allergies are currently NOT shown.
 * Single source of truth: window.activePatient().allergies (a string).
 * Read-only, display-only. Canonical route/patient/store signals update it without
 * an idle full-roster poll. Additive, reversible: window.__mlsAllergyStrip.revert()
 */
(function () {
  if (window.__mlsAllergyStrip && window.__mlsAllergyStrip.__live) return;

  var STRIP_ID = 'mlsAllergyStrip';
  var STYLE_ID = 'mlsAllergyStrip-style';
  var VERSION = 'allergy-strip-1.1.0';
  var pending = null;
  var storagePending = null;
  var storagePendingIsIdle = false;
  var listeners = [];
  var readyListener = null;
  var started = false;
  var stopped = false;
  var lastKey = '';
  var lastActiveId = '';

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
      '#' + STRIP_ID + '.mlsalg-unknown{border-color:rgba(154,107,0,.34);background:rgba(154,107,0,.08);}',
      '#' + STRIP_ID + '.mlsalg-unknown .mlsalg-pill{background:rgba(154,107,0,.14);color:#7a5a16;',
      'border-color:rgba(154,107,0,.32);}',
      '#' + STRIP_ID + ' .mlsalg-src{margin-left:auto;font-size:11px;opacity:.55;font-weight:500;}'
    ].join('');
    document.head.appendChild(s);
  }

  function activeP() {
    try { return (typeof window.activePatient === 'function') ? window.activePatient() : null; }
    catch (e) { return null; }
  }

  function activeId() {
    try { return (typeof window.getActivePtId === 'function') ? String(window.getActivePtId() || '') : null; }
    catch (e) { return null; }
  }

  function visitVisible(grid) {
    try {
      var current = window.__mlsCurrentView;
      if (typeof current === 'string' && current) return current === 'visit' && !!grid;
    } catch (e) {}
    return !!(grid && grid.offsetParent !== null);
  }

  // Parse the allergies string into a normalized list. Returns {none:true} for NKDA/empty.
  function parseAllergies(raw) {
    var t = (raw == null ? '' : String(raw)).trim();
    /* b749: an EMPTY allergy field is NOT a documented NKDA. Returning
       none:true here painted a green no-known-drug-allergies badge for every
       patient whose chart had simply never been read. */
    if (!t) return { unknown: true, none: false, items: [] };
    if (/^(nkda|nka|none|no known (drug )?allerg(y|ies)?|denies|n\/a|na)\.?$/i.test(t)) {
      return { none: true, items: [] };
    }
    var parts = t.split(/[;,\n•\|]+/).map(function (x) { return x.trim(); })
      .filter(function (x) { return x && x.length <= 80; });
    if (!parts.length) return { unknown: false, none: false, items: [t.slice(0, 80)] };
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
    if (stopped || (window.__mlsAllergyStrip && window.__mlsAllergyStrip.__reverted)) return;
    var grid = document.querySelector('.vx-grid');
    var strip = document.getElementById(STRIP_ID);

    if (!grid || !visitVisible(grid)) {
      if (strip) strip.style.display = 'none';
      return;
    }
    var id = activeId();
    if (id === '') { if (strip) strip.style.display = 'none'; return; }
    var ap = activeP();
    var hasPt = !!(ap && ap.name && String(ap.name).trim());
    if (!hasPt) { if (strip) strip.style.display = 'none'; return; }

    var info = parseAllergies(ap.allergies);
    lastActiveId = String((id == null ? ap.id : id) || '');
    var key = (ap.id || ap.name) + '|' + (ap.allergies || '') + '|1';
    if (strip && strip.style.display !== 'none' && key === lastKey) return; // no change
    lastKey = key;

    if (!strip) { strip = build(); }
    if (strip.parentNode !== grid.parentNode || strip.nextSibling !== grid) {
      grid.parentNode.insertBefore(strip, grid);
    }
    strip.style.display = '';
    if (info.unknown) {
      strip.className = 'mlsalg-unknown';
      strip.innerHTML = '<span class="mlsalg-lbl"><span class="mlsalg-ico">\u2753</span>Allergies</span>' +
        '<span class="mlsalg-pill">No allergy data pulled for this patient yet</span>' +
        '<span class="mlsalg-src">not reviewed \u2014 pull the chart from Athena</span>';
      return;
    }
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

  function listen(target, name, fn) {
    try {
      target.addEventListener(name, fn, false);
      listeners.push({ target: target, name: name, fn: fn });
    } catch (e) {}
  }

  function cancelPending() {
    if (!pending) return;
    try {
      if (pending.kind === 'raf' && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(pending.id);
      } else {
        clearTimeout(pending.id);
      }
    } catch (e) {}
    pending = null;
  }

  function cancelStoragePending() {
    if (storagePending === null) return;
    var task = storagePending;
    var wasIdle = storagePendingIsIdle;
    storagePending = null;
    storagePendingIsIdle = false;
    try {
      if (wasIdle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(task);
      else clearTimeout(task);
    } catch (e) {}
  }

  function inputPending() {
    try {
      return !!(navigator && navigator.scheduling &&
        typeof navigator.scheduling.isInputPending === 'function' &&
        navigator.scheduling.isInputPending());
    } catch (e) { return false; }
  }

  /* A cross-tab roster write has no patient id, so it cannot be filtered to
     the active patient. Keep the safety refresh, but admit its one cold lookup
     only in genuine browser idle time instead of the next animation frame. */
  function scheduleStorageRender() {
    if (stopped || storagePending !== null) return;
    var run = function () {
      storagePending = null;
      storagePendingIsIdle = false;
      if (stopped) return;
      if (inputPending()) {
        scheduleStorageRender();
        return;
      }
      scheduleRender();
    };
    try {
      if (typeof window.requestIdleCallback === 'function') {
        storagePendingIsIdle = true;
        storagePending = window.requestIdleCallback(run);
        return;
      }
    } catch (e) {}
    storagePending = setTimeout(run, 1000);
  }

  function scheduleRender() {
    if (stopped || pending) return;
    var run = function () {
      pending = null;
      if (!stopped) render();
    };
    try {
      if (typeof window.requestAnimationFrame === 'function') {
        pending = { kind: 'raf', id: window.requestAnimationFrame(run) };
        return;
      }
    } catch (e) {}
    pending = { kind: 'timeout', id: setTimeout(run, 0) };
  }

  function patientStoreKey() {
    try { return (typeof window.uns === 'function') ? String(window.uns('patients') || '') : ''; }
    catch (e) { return ''; }
  }

  function activeStoreKey() {
    try { return (typeof window.uns === 'function') ? String(window.uns('activePt') || '') : ''; }
    catch (e) { return ''; }
  }

  function samePatientRecord(ev) {
    if (!ev || !ev.detail) return true;
    try {
      var eventKey = ev.detail.patientStoreKey;
      var expectedKey = patientStoreKey();
      if (eventKey && expectedKey && String(eventKey) !== expectedKey) return false;
      var eventId = String(ev.detail.patientId || '');
      if (!eventId || typeof window.getActivePtId !== 'function') return true;
      return eventId === String(window.getActivePtId() || '');
    } catch (e) { return false; }
  }

  function patientStorageEvent(ev) {
    if (!ev) return false;
    try { if (ev.storageArea && window.localStorage && ev.storageArea !== window.localStorage) return false; }
    catch (e) { return false; }
    if (ev.key == null) return true;
    var expected = patientStoreKey();
    if (expected) return String(ev.key) === expected;
    return /(^|::)patients$/.test(String(ev.key));
  }

  function start() {
    if (started || stopped) return;
    started = true;
    css();
    listen(window, 'mls:view-changed', scheduleRender);
    listen(window, 'mls:active-patient-changed', scheduleRender);
    listen(window, 'mls:patient-record-updated', function (ev) {
      if (samePatientRecord(ev)) scheduleRender();
    });
    listen(window, 'mls:session-boundary', scheduleRender);
    listen(window, 'mls:ui-ready', scheduleRender);
    listen(window, 'pageshow', scheduleRender);
    listen(window, 'storage', function (ev) {
      var activeKey = activeStoreKey();
      if (ev && activeKey && String(ev.key || '') === activeKey) {
        /* The shared active id changes before this callback. Hide the old
           patient's allergies synchronously; the new record waits for idle. */
        var nextId = activeId();
        if (nextId == null || String(nextId) !== lastActiveId) {
          var strip = document.getElementById(STRIP_ID);
          if (strip) strip.style.display = 'none';
          lastKey = '';
          lastActiveId = String(nextId || '');
        }
        scheduleStorageRender();
        return;
      }
      if (patientStorageEvent(ev)) scheduleStorageRender();
    });
    listen(document, 'visibilitychange', function () {
      try { if (document.hidden) return; } catch (e) {}
      scheduleStorageRender();
    });
    render();
  }

  function stop() {
    stopped = true;
    cancelPending();
    cancelStoragePending();
    if (readyListener) {
      try { document.removeEventListener('DOMContentLoaded', readyListener, false); } catch (e) {}
      readyListener = null;
    }
    for (var i = 0; i < listeners.length; i++) {
      var row = listeners[i];
      try { row.target.removeEventListener(row.name, row.fn, false); } catch (e) {}
    }
    listeners = [];
  }

  window.__mlsAllergyStrip = {
    __live: true,
    __reverted: false,
    version: VERSION,
    render: render,
    revert: function () {
      this.__reverted = true;
      this.__live = false;
      stop();
      var s = document.getElementById(STRIP_ID); if (s) s.remove();
      var st = document.getElementById(STYLE_ID); if (st) st.remove();
    }
  };

  if (document.readyState === 'loading') {
    readyListener = function () { readyListener = null; start(); };
    document.addEventListener('DOMContentLoaded', readyListener, false);
  } else {
    start();
  }
})();
