/* feat_mls_note_autofit.js -- item43
 * Generated-note auto-fit (read the whole note without scrolling a tiny box).
 * The generated clinical note lands in a fixed-height textarea, so when the
 * note is more than a few lines the doctor has to scroll inside a small box to
 * review it before signing -- easy to miss a line. This makes the generated
 * note box grow to fit its content (up to a sensible cap, then it scrolls), so
 * the whole note is visible at once for review & sign. As the note shrinks the
 * box shrinks back. Behaviour is identical to a normal textarea otherwise --
 * fully editable, no content changed.
 * Display/layout-only: it only sets the textarea height (capped). No PHI is
 * added, no patient data is mutated, no network, no storage. Originals are
 * captured so revert restores the exact prior styling.
 * Additive + reversible: window.__mlsNoteAutofit.revert()
 */
;(function () {
  'use strict';
  if (window.__mlsNoteAutofit) return;

  var MIN_PX = 120;                 // never collapse below this
  var MAX_VH = 0.70;                // cap growth at 70% of viewport height
  var boundMap = new WeakMap();     // textarea -> { handler, prev:{height,minHeight,maxHeight,overflowY,boxSizing} }
  var bound = [];
  var obs = null, mountIv = null, refreshIv = null, applying = false;

  /* the GENERATED clinical note textarea(s) only (not comment / transcript) */
  function isNoteBox(ta) {
    if (!ta || ta.tagName !== 'TEXTAREA') return false;
    if (ta.id === 'noteBox') return true;
    var ph = (ta.placeholder || '');
    if (/generated note/i.test(ph)) return true;
    if (/your note will appear here/i.test(ph)) return true;
    return false;
  }

  function capPx() {
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    return Math.max(MIN_PX, Math.round(vh * MAX_VH));
  }

  function fit(ta) {
    if (!ta) return;
    try {
      var cap = capPx();
      var rec = boundMap.get(ta), value = String(ta.value || '');
      if (rec && rec.lastValue === value && rec.lastCap === cap) return;
      // measure natural content height: briefly shrink then read scrollHeight
      var prevH = ta.style.height;
      ta.style.height = 'auto';
      var needed = ta.scrollHeight;
      var target = Math.min(cap, Math.max(MIN_PX, needed + 2));
      ta.style.height = target + 'px';
      ta.style.overflowY = (needed > cap) ? 'auto' : 'hidden';
      if (rec) { rec.lastValue = value; rec.lastCap = cap; }
      if (prevH && ta.style.height === prevH) { /* unchanged */ }
    } catch (e) {}
  }

  function wire(ta) {
    if (!ta || boundMap.has(ta) || !isNoteBox(ta)) return;
    var prev = {
      height: ta.style.height || '',
      minHeight: ta.style.minHeight || '',
      maxHeight: ta.style.maxHeight || '',
      overflowY: ta.style.overflowY || '',
      boxSizing: ta.style.boxSizing || ''
    };
    ta.style.boxSizing = 'border-box';
    ta.style.maxHeight = capPx() + 'px';
    var handler = function () { fit(ta); };
    ta.addEventListener('input', handler);
    boundMap.set(ta, { handler: handler, prev: prev, lastValue: null, lastCap: 0 });
    bound.push(ta);
    fit(ta);
  }

  function scan(root) {
    try {
      if (root && root.nodeType === 1 && root.tagName === 'TEXTAREA') wire(root);
      var nodes = (root || document).querySelectorAll('textarea');
      for (var i = 0; i < nodes.length; i++) if (isNoteBox(nodes[i])) wire(nodes[i]);
    } catch (e) {}
  }

  function refreshAll() {
    if (document.hidden) return;
    try { for (var i = 0; i < bound.length; i++) fit(bound[i]); } catch (e) {}
  }

  function tick() {
    if (applying) return;
    applying = true;
    try { scan(document); } catch (e) {}
    applying = false;
  }

  function onResize() { try { bound.forEach(function (ta) { var rec=boundMap.get(ta); if(rec) rec.lastCap=0; ta.style.maxHeight = capPx() + 'px'; fit(ta); }); } catch (e) {} }

  function start() {
    tick();
    try {
      obs = new MutationObserver(function (records) {
        if (applying) return;
        for (var i = 0; i < records.length; i++) {
          var added = records[i].addedNodes || [];
          for (var j = 0; j < added.length; j++) if (added[j] && added[j].nodeType === 1) scan(added[j]);
        }
      });
      obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
    } catch (e) {}
    if (!refreshIv) refreshIv = setInterval(refreshAll, 2000); // value guard prevents idle layout reads
    window.addEventListener('resize', onResize);
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

  window.__mlsNoteAutofit = {
    revert: function () {
      try { if (obs) obs.disconnect(); } catch (e) {}
      obs = null;
      if (mountIv) { clearInterval(mountIv); mountIv = null; }
      if (refreshIv) { clearInterval(refreshIv); refreshIv = null; }
      try { window.removeEventListener('resize', onResize); } catch (e) {}
      bound.forEach(function (ta) {
        try {
          var rec = boundMap.get(ta);
          if (rec) {
            ta.removeEventListener('input', rec.handler);
            ta.style.height = rec.prev.height;
            ta.style.minHeight = rec.prev.minHeight;
            ta.style.maxHeight = rec.prev.maxHeight;
            ta.style.overflowY = rec.prev.overflowY;
            ta.style.boxSizing = rec.prev.boxSizing;
          }
        } catch (e) {}
      });
      bound = [];
      try { delete window.__mlsNoteAutofit; } catch (e) { window.__mlsNoteAutofit = undefined; }
    },
    _info: function () { return { boxes: bound.length, cap: capPx(), observing: !!obs }; }
  };
})();
