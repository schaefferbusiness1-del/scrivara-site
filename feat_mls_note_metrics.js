/* feat_mls_note_metrics.js -- item42
 * Generated-note metrics at-a-glance.
 * When MLS generates a clinical note the doctor has to eyeball whether it is
 * the right length before signing -- a two-line note is usually too thin, a
 * wall of text takes a while to read in a packed clinic. This adds a small,
 * clean, read-only meter directly under the generated-note box showing the
 * word count and an estimated reading time (e.g. "~320 words  -  ~2 min read").
 * It updates live as the note is generated/edited so the doctor gets an
 * instant sense of the note before review & sign.
 * Purely derived + display-only: it reads the text already sitting in the note
 * textarea(s), counts words, and shows them. No PHI is added, no patient data
 * is mutated, no network, no storage. The meter is hidden whenever the note is
 * empty (placeholder only).
 * Additive + reversible: window.__mlsNoteMetrics.revert()
 */
;(function () {
  'use strict';
  if (window.__mlsNoteMetrics) return;

  var STYLE_ID = 'mls-notemetrics-style';
  var WPM = 200;                    // average clinical reading speed
  var created = new Set();          // every element we create (for revert)
  var boundMap = new WeakMap();     // textarea -> { wrap, txt, handler }
  var bound = [];                   // textareas we attached to (for revert)
  var obs = null, mountIv = null, refreshIv = null, applying = false;

  function injectStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.textContent =
      '.mls-nm-meter{display:flex;align-items:center;gap:8px;margin-top:6px;' +
      'font-family:"Plus Jakarta Sans",system-ui,sans-serif;font-weight:600;' +
      'font-size:11px;line-height:1;letter-spacing:.2px;color:#5a6b86;}' +
      '.mls-nm-pill{display:inline-flex;align-items:center;gap:5px;' +
      'background:#eef2f9;border:1px solid #e0e7f2;border-radius:999px;' +
      'padding:3px 9px;white-space:nowrap;color:#3a4a63;}' +
      '.mls-nm-pill b{font-weight:800;color:#2f3b52;}' +
      '.mls-nm-dot{width:5px;height:5px;border-radius:50%;background:#2E6A4B;' +
      'display:inline-block;opacity:.7;}';
    (document.head || document.documentElement).appendChild(st);
  }

  /* is this the GENERATED clinical note textarea (not the comment box)? */
  function isNoteBox(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return false;
    if (ta.id === 'noteBox') return true;
    var ph = (ta.placeholder || '');
    if (/generated note/i.test(ph)) return true;
    if (/your note will appear here/i.test(ph)) return true;
    return false;
  }

  function countWords(s) {
    if (!s) return 0;
    var t = String(s).trim();
    if (!t) return 0;
    var m = t.match(/\S+/g);
    return m ? m.length : 0;
  }

  function readLabel(words) {
    if (words <= 0) return '';
    var mins = words / WPM;
    if (mins < 1) return '~&lt;1 min read';
    return '~' + Math.round(mins) + ' min read';
  }

  function makeMeter() {
    var row = document.createElement('div');
    row.className = 'mls-nm-meter';
    row.setAttribute('data-mls-nm', '1');
    var p1 = document.createElement('span');
    p1.className = 'mls-nm-pill';
    p1.innerHTML = '<span class="mls-nm-dot"></span><b class="mls-nm-w">0</b> words';
    var p2 = document.createElement('span');
    p2.className = 'mls-nm-pill mls-nm-read';
    p2.innerHTML = '~&lt;1 min read';
    row.appendChild(p1);
    row.appendChild(p2);
    created.add(row);
    return { row: row, wEl: p1.querySelector('.mls-nm-w'), rEl: p2 };
  }

  function update(ta) {
    var rec = boundMap.get(ta);
    if (!rec) return;
    var words = countWords(ta.value);
    if (words <= 0) {
      if (rec.wrap.style.display !== 'none') rec.wrap.style.display = 'none';
      return;
    }
    if (rec.wrap.style.display !== 'flex') rec.wrap.style.display = 'flex';
    if (rec.wEl && rec.wEl.textContent !== String(words)) rec.wEl.textContent = String(words);
    var rl = readLabel(words);
    if (rec.rEl && rec.rEl.innerHTML !== rl) rec.rEl.innerHTML = rl;
  }

  function wire(ta) {
    if (!ta || boundMap.has(ta) || !isNoteBox(ta)) return;
    var meter = makeMeter();
    meter.row.style.display = 'none';
    try {
      if (ta.parentNode) ta.parentNode.insertBefore(meter.row, ta.nextSibling);
      else return;
    } catch (e) { return; }
    var handler = function () { update(ta); };
    ta.addEventListener('input', handler);
    ta.addEventListener('change', handler);
    boundMap.set(ta, { wrap: meter.row, wEl: meter.wEl, rEl: meter.rEl, handler: handler });
    bound.push(ta);
    update(ta);
  }

  function scan(root) {
    try {
      var nodes = (root || document).querySelectorAll('textarea');
      for (var i = 0; i < nodes.length; i++) if (isNoteBox(nodes[i])) wire(nodes[i]);
    } catch (e) {}
  }

  function refreshAll() {
    try { for (var i = 0; i < bound.length; i++) update(bound[i]); } catch (e) {}
  }

  function tick() {
    if (applying) return;
    applying = true;
    try { injectStyle(); scan(document); refreshAll(); } catch (e) {}
    applying = false;
  }

  function start() {
    tick();
    try {
      obs = new MutationObserver(function () { if (!applying) tick(); });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    if (!refreshIv) refreshIv = setInterval(refreshAll, 1000); // catch programmatic note fills
  }

  var tries = 0;
  mountIv = setInterval(function () {
    tries++;
    tick();
    if (!obs && document.querySelector('textarea')) start();
    if (obs || tries > 40) { clearInterval(mountIv); mountIv = null; }
  }, 500);

  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);

  window.__mlsNoteMetrics = {
    revert: function () {
      try { if (obs) obs.disconnect(); } catch (e) {}
      obs = null;
      if (mountIv) { clearInterval(mountIv); mountIv = null; }
      if (refreshIv) { clearInterval(refreshIv); refreshIv = null; }
      bound.forEach(function (ta) {
        try {
          var rec = boundMap.get(ta);
          if (rec) { ta.removeEventListener('input', rec.handler); ta.removeEventListener('change', rec.handler); }
        } catch (e) {}
      });
      bound = [];
      created.forEach(function (el) { try { if (el && el.parentNode) el.parentNode.removeChild(el); } catch (e) {} });
      created.clear();
      try { var st = document.getElementById(STYLE_ID); if (st) st.parentNode.removeChild(st); } catch (e) {}
      try { delete window.__mlsNoteMetrics; } catch (e) { window.__mlsNoteMetrics = undefined; }
    },
    _info: function () { return { boxes: bound.length, meters: created.size, observing: !!obs }; }
  };
})();
