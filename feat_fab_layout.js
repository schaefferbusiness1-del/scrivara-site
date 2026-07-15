/* feat_fab_layout.js  ->  window.__mlsFabLayout  (v1.0.0)
 *
 * Fixes the overlapping bottom-right floating launchers:
 *   #mlsAddPtLauncher ("Add patient")  and  #mls-assist-badge ("MLS Assist")
 * both shipped anchored at right:18px; bottom:18px, so they sat on top of
 * each other. This asset:
 *   1. Gives them a sane, NON-OVERLAPPING default layout (stacked in the
 *      bottom-right: MLS Assist on the bottom row, Add patient just above it).
 *   2. Makes each one draggable by the user, and remembers (persists) where
 *      they were dropped (localStorage), restoring on the next load.
 *   3. Clamps any saved/!default position back on-screen, so a position saved
 *      at one window size can never strand a button off-screen.
 * Self-contained, additive, fully reversible (window.__mlsFabLayout.revert()).
 * Touches nothing else; never calls the extension; no PHI.
 */
(function () {
  'use strict';
  try { if (window.__mlsFabLayout && window.__mlsFabLayout.installed) return; } catch (e) {}

  var VERSION = '1.0.0', ASSET = 'feat_fab_layout.js';
  var GAP = 10, EDGE = 18;
  // id -> { key:localStorage key, defRightFn, defBottomFn }
  var ITEMS = [
    { id: 'mls-assist-badge', key: 'mls_assist_pos', row: 0 }, // bottom row
    { id: 'mlsAddPtLauncher', key: 'mls_addpt_pos', row: 1 }   // stacked above
  ];
  var _bound = [], _styleEl = null, _obs = null, _raf = 0, _onResize = null;

  function el(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function vw() { return window.innerWidth || document.documentElement.clientWidth || 1200; }
  function vh() { return window.innerHeight || document.documentElement.clientHeight || 800; }

  function readPos(key) {
    try { var v = JSON.parse(localStorage.getItem(key) || 'null'); if (v && typeof v.right === 'number' && typeof v.bottom === 'number') return v; } catch (e) {}
    return null;
  }
  function savePos(key, right, bottom) { try { localStorage.setItem(key, JSON.stringify({ right: Math.round(right), bottom: Math.round(bottom) })); } catch (e) {}}

  // default stacked layout: row 0 at the bottom, each higher row clears the one below
  function defaultBottom(row) {
    var b = EDGE;
    for (var i = 0; i < row; i++) {
      var below = el(ITEMS[i].id);
      b += (below ? Math.max(28, below.getBoundingClientRect().height) : 36) + GAP;
    }
    return b;
  }
  function clamp(node, right, bottom) {
    var r = node.getBoundingClientRect();
    var w = r.width || 160, h = r.height || 36;
    var maxRight = Math.max(0, vw() - w);   // keep fully on-screen horizontally
    var maxBottom = Math.max(0, vh() - h);  // and vertically
    return { right: Math.min(Math.max(0, right), maxRight), bottom: Math.min(Math.max(0, bottom), maxBottom) };
  }

  function place(item) {
    var node = el(item.id);
    if (!node) return;
    var saved = readPos(item.key);
    var right = saved ? saved.right : EDGE;
    var bottom = saved ? saved.bottom : defaultBottom(item.row);
    var c = clamp(node, right, bottom);
    var rightPx = c.right + 'px', bottomPx = c.bottom + 'px';
    if (node.style.position !== 'fixed') node.style.position = 'fixed';
    if (node.style.right !== rightPx) node.style.right = rightPx;
    if (node.style.bottom !== bottomPx) node.style.bottom = bottomPx;
    if (node.style.left !== 'auto') node.style.left = 'auto';
    if (node.style.top !== 'auto') node.style.top = 'auto';
    if (item.id === 'mlsAddPtLauncher' && node.style.cursor !== 'grab') node.style.cursor = 'grab';
  }

  function rectsOverlap(a, b) {
    var A = a.getBoundingClientRect(), B = b.getBoundingClientRect();
    return A.left < B.right && A.right > B.left && A.top < B.bottom && A.bottom > B.top;
  }

  function ensureLayout() {
    var a = el(ITEMS[0].id), b = el(ITEMS[1].id);
    if (!a && !b) return;
    // Always place the badge to its anchor; place Add patient to its (stacked) anchor.
    // If a saved position makes them overlap, drop the saved Add-patient position and re-stack.
    place(ITEMS[0]);
    place(ITEMS[1]);
    if (a && b && rectsOverlap(a, b)) {
      try { localStorage.removeItem(ITEMS[1].key); } catch (e) {}
      place(ITEMS[1]);
    }
  }

  // ---- drag + persist ----
  function makeDraggable(item) {
    var node = el(item.id);
    if (!node || node.__mlsDragBound) return;
    node.__mlsDragBound = true;
    var drag = null;
    function down(ev) {
      var p = ev.touches ? ev.touches[0] : ev;
      var r = node.getBoundingClientRect();
      drag = { sx: p.clientX, sy: p.clientY, right: vw() - r.right, bottom: vh() - r.bottom, moved: false };
      node.style.cursor = 'grabbing';
      try { ev.preventDefault(); } catch (e) {}
      window.addEventListener('mousemove', move, true);
      window.addEventListener('mouseup', up, true);
      window.addEventListener('touchmove', move, { capture: true, passive: false });
      window.addEventListener('touchend', up, true);
    }
    function move(ev) {
      if (!drag) return;
      var p = ev.touches ? ev.touches[0] : ev;
      var dx = p.clientX - drag.sx, dy = p.clientY - drag.sy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
      var c = clamp(node, drag.right - dx, drag.bottom - dy);
      node.style.right = c.right + 'px';
      node.style.bottom = c.bottom + 'px';
      node.style.left = 'auto'; node.style.top = 'auto';
      try { ev.preventDefault(); } catch (e) {}
    }
    function up() {
      window.removeEventListener('mousemove', move, true);
      window.removeEventListener('mouseup', up, true);
      window.removeEventListener('touchmove', move, true);
      window.removeEventListener('touchend', up, true);
      node.style.cursor = 'grab';
      if (drag && drag.moved) {
        var r = node.getBoundingClientRect();
        savePos(item.key, vw() - r.right, vh() - r.bottom);
        // suppress the click that follows a real drag
        var swallow = function (e) { e.stopPropagation(); e.preventDefault(); node.removeEventListener('click', swallow, true); };
        node.addEventListener('click', swallow, true);
        setTimeout(function () { try { node.removeEventListener('click', swallow, true); } catch (e) {} }, 60);
      }
      drag = null;
    }
    node.addEventListener('mousedown', down, true);
    node.addEventListener('touchstart', down, { capture: true, passive: false });
    _bound.push({ node: node, down: down });
  }

  function scheduleLayout() {
    if (_raf) return;
    var raf = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    _raf = raf(function () { _raf = 0; ITEMS.forEach(makeDraggable); ensureLayout(); });
  }

  function touchesLauncher(node, includeDescendants) {
    if (!node) return false;
    if (node.nodeType !== 1) node = node.parentElement;
    if (!node) return false;
    var selector = '#mls-assist-badge,#mlsAddPtLauncher';
    try { return !!(node.matches(selector) || (node.closest && node.closest(selector)) || (includeDescendants && node.querySelector && node.querySelector(selector))); } catch (e) { return false; }
  }

  function boot() {
    ITEMS.forEach(makeDraggable);
    ensureLayout();
    _onResize = scheduleLayout;
    window.addEventListener('resize', _onResize);
    try {
      _obs = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var m = mutations[i], nodes = Array.prototype.slice.call(m.addedNodes || []).concat(Array.prototype.slice.call(m.removedNodes || []));
          if (touchesLauncher(m.target, false) || nodes.some(function (node) { return touchesLauncher(node, true); })) { scheduleLayout(); return; }
        }
      });
      _obs.observe(document.body, { childList: true, subtree: true });
    } catch (e) {}
  }

  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { if (_raf) (window.cancelAnimationFrame || clearTimeout)(_raf); } catch (e) {}
    try { if (_onResize) window.removeEventListener('resize', _onResize); } catch (e) {}
    try { _bound.forEach(function (b) { b.node.removeEventListener('mousedown', b.down, true); b.node.removeEventListener('touchstart', b.down, true); b.node.__mlsDragBound = false; }); } catch (e) {}
    try { if (_styleEl) _styleEl.remove(); } catch (e) {}
    // leave nodes where they are (positions are harmless); just clear cursor
    try { var a = el('mlsAddPtLauncher'); if (a) a.style.cursor = ''; } catch (e) {}
    try { window.__mlsFabLayout.installed = false; } catch (e) {}
  }

  window.__mlsFabLayout = { installed: true, version: VERSION, asset: ASSET, ensureLayout: ensureLayout, revert: revert };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  } catch (e) { try { boot(); } catch (e2) {} }
})();
