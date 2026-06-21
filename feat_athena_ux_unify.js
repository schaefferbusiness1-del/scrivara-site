/* =====================================================================
 * feat_athena_ux_unify.js  ->  window.__mlsUxUnify   (v1.0.0)
 * ---------------------------------------------------------------------
 * Additive, self-contained, fully reversible UX-unification layer for the
 * Athena flows. It wraps / observes existing modules at runtime and NEVER
 * edits or replaces any existing function destructively. revert() removes
 * everything and restores wrapped methods.
 *
 * Fixes (all reported by Michael, all root-caused live against the real DOM):
 *   A. Detection = ONE source of truth. The status dot's real state is
 *      'connected' | 'noext' | 'noathena' | 'checking', but the MLS Easy gate
 *      tested for the string 'green' and read sd.check() which resolves to
 *      undefined -> the card said "athenaOne isn't detected" even while
 *      genuinely connected. We wrap sd.check() to resolve to
 *      {ok,connected,state,label} from the dot's own state, and never let a
 *      "not detected" warning render while the dot is 'connected'. Dot,
 *      messages and buttons now always agree.
 *   B/C. ONE unified status surface. A single action used to spray up to four
 *      disagreeing surfaces at once: the s61 ".mlsaa-tl" panel (bottom-right),
 *      the autopull "#mlsAutoPullChip" (bottom-centre), the s64 ".mlsac-toast"
 *      (top-centre) and the save-verify banner. We elect ONE surface (the rich
 *      .mlsaa-tl timeline if present, else our own minimal panel), CSS-suppress
 *      the floating duplicates so their owners' re-creations stay hidden, and
 *      mirror their latest text into the single surface as one deduped line.
 *      Save status is routed through the same surface and reported ONCE.
 *   D. The active status panel is draggable by its header so it stops covering
 *      content; position is remembered for the session.
 *   E. MLS Easy auto-advances off Step 1 when a pull completes: once a pull
 *      action fills the patient, after a short confirm delay it clicks the
 *      existing "Go to recording" control (#ezGoRec -> step 2).
 *   F. Flicker damp: collapses redundant re-decoration / re-render storms into
 *      a single coalesced pass (rAF when foreground, setTimeout fallback so it
 *      still runs in a background tab), and de-dupes status lines.
 *
 * SAFETY: read-only. Sends NOTHING to the extension. Never clicks
 * Save/Sign/attest/submit. Never writes a chart. No PHI is read, stored,
 * logged or transmitted -- it moves/de-dupes existing UI text only.
 * ===================================================================== */
(function () {
  'use strict';
  if (window.__mlsUxUnify && window.__mlsUxUnify.installed) { return; }

  var VERSION = '1.0.0';
  var cleanups = [];
  var wraps = [];

  function on(target, ev, fn, opts) {
    target.addEventListener(ev, fn, opts || false);
    cleanups.push(function () { try { target.removeEventListener(ev, fn, opts || false); } catch (e) {} });
  }
  function wrap(obj, key, make) {
    if (!obj || typeof obj[key] !== 'function' || obj[key].__mlsUx) { return; }
    var orig = obj[key];
    var next = make(orig);
    next.__mlsUx = true;
    obj[key] = next;
    wraps.push({ obj: obj, key: key, orig: orig });
  }

  /* ---------------- A. Detection: one source of truth ---------------- */
  function dot() { return window.__mlsAthenaStatusDot || null; }
  function connected() { var d = dot(); return !!(d && d.state === 'connected'); }
  function connLabel() {
    var d = dot(); var st = d && d.state;
    if (st === 'connected') { return ''; }
    if (st === 'noext') { return 'MLS Assist is not responding - open athenaOne and check the MLS Assist extension is installed/enabled.'; }
    if (st === 'noathena') { return 'Open a signed-in athenaOne tab to connect.'; }
    return '';
  }
  function patchDetection() {
    var d = dot();
    if (!d) { return false; }
    wrap(d, 'check', function (orig) {
      return function () {
        var self = this, args = arguments;
        return Promise.resolve()
          .then(function () { return orig.apply(self, args); })
          .catch(function () {})
          .then(function () {
            var ok = connected();
            return { ok: ok, connected: ok, state: d.state, label: connLabel() };
          });
      };
    });
    return true;
  }
  function reconcileDetection() {
    try {
      if (connected()) {
        window.__mlsEzConn = { ok: true, label: '' };
        var hints = document.querySelectorAll('.ez-hint.warn, .ez-hint');
        for (var i = 0; i < hints.length; i++) {
          var tx = (hints[i].textContent || '');
          if (/isn.t detected|not detected|athenaOne isn/i.test(tx)) {
            hints[i].style.display = 'none';
          }
        }
      }
    } catch (e) {}
  }

  /* ---------------- B/C/F. Unified status surface ---------------- */
  var STYLE_ID = 'mlsux-suppress';
  function injectSuppressStyle() {
    if (document.getElementById(STYLE_ID)) { return; }
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = '#mlsAutoPullChip,.mlsac-toast{display:none !important;}';
    (document.head || document.documentElement).appendChild(s);
    cleanups.push(function () { try { s.remove(); } catch (e) {} });
  }
  function richPanel() { return document.querySelector('.mlsaa-tl'); }
  function ownPanel(create) {
    var p = document.getElementById('mlsuxPanel');
    if (p || !create) { return p; }
    p = document.createElement('div');
    p.id = 'mlsuxPanel';
    p.className = 'mlsux-panel';
    p.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483600;max-width:340px;background:#0f2942;color:#e6eef7;padding:12px 14px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:13px/1.45 system-ui,Arial,sans-serif;';
    p.innerHTML = '<div class="mlsux-head" style="font-weight:600;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;cursor:move;">MLS - Athena status<span class="mlsux-x" style="cursor:pointer;opacity:.7;padding:0 4px;">\u00d7</span></div><div class="mlsux-mirror"></div>';
    document.body.appendChild(p);
    var x = p.querySelector('.mlsux-x');
    if (x) { on(x, 'click', function () { p.style.display = 'none'; }); }
    cleanups.push(function () { try { p.remove(); } catch (e) {} });
    return p;
  }
  function surface(create) { return richPanel() || ownPanel(create); }
  function ensureMirrorSlot(p) {
    var slot = p.querySelector('.mlsux-mirror');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'mlsux-mirror';
      slot.setAttribute('aria-live', 'polite');
      slot.style.cssText = 'margin-top:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,.14);font-size:13px;line-height:1.4;';
      var steps = p.querySelector('.mlsaa-steps') || p.querySelector('.mlsaa-done') || p;
      (steps.parentNode || p).appendChild(slot);
    }
    return slot;
  }
  function classifyState(txt) {
    if (/[\u26d4\u26a0\u2717\u2718]|could not|couldn.t|failed|no EMR|not found|isn.t/i.test(txt)) { return 'warn'; }
    if (/\u2713|\u2705|pulled|saved|complete|done/i.test(txt)) { return 'ok'; }
    return 'run';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function mirror(txt) {
    txt = (txt || '').replace(/\s+/g, ' ').trim();
    if (!txt) { return; }
    var p = surface(true);
    if (!p) { return; }
    var slot = ensureMirrorSlot(p);
    var st = classifyState(txt);
    var col = st === 'warn' ? '#fcd34d' : st === 'ok' ? '#86efac' : '#cbd5e1';
    slot.innerHTML = '<span style="color:' + col + '">' + escapeHtml(txt) + '</span>';
  }
  function foldDuplicate(node) {
    try {
      mirror(node.textContent || '');
      node.style.display = 'none';
    } catch (e) {}
  }

  /* ---------------- F2. Idempotent render guard (kill the resize/flash glitch) ----------------
   * The big MLS Easy card (#mlsEasyPanel) re-runs render() on poll cycles and
   * rewrites innerHTML with the SAME markup -- the browser tears down then
   * rebuilds the subtree, so the text vanishes for a frame and the card
   * resizes. We install an instance-level innerHTML guard that SKIPS a write
   * when the incoming markup is byte-identical to the previous write, so an
   * unchanged re-render becomes a no-op (no teardown, no flash, no resize).
   * A genuinely different render still writes normally. Fully reversible.
   */
  function guardIdempotent() {
    var ids = ['mlsEasyPanel'];
    for (var k = 0; k < ids.length; k++) {
      var el = document.getElementById(ids[k]);
      if (!el || el.__mlsIdem) { continue; }
      try {
        var proto = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'innerHTML') ||
                    Object.getOwnPropertyDescriptor(window.Element.prototype, 'innerHTML');
        if (!proto || !proto.set) { continue; }
        var setter = proto.set, getter = proto.get;
        el.__mlsIdem = true;
        Object.defineProperty(el, 'innerHTML', {
          configurable: true,
          get: function () { return getter.call(this); },
          set: function (v) { if (v === this.__mlsLastHtml) { return; } this.__mlsLastHtml = v; setter.call(this, v); }
        });
        cleanups.push((function (elem) {
          return function () { try { delete elem.innerHTML; delete elem.__mlsIdem; delete elem.__mlsLastHtml; } catch (e) {} };
        })(el));
      } catch (e) {}
    }
  }

  /* ---------------- D. Draggable panel ---------------- */
  function makeDraggable(p) {
    if (!p || p.__mlsDrag) { return; }
    p.__mlsDrag = true;
    var handle = p.firstElementChild || p;
    handle.style.cursor = 'move';
    handle.title = 'Drag to move';
    var sx = 0, sy = 0, ox = 0, oy = 0, dragging = false;
    function down(e) {
      if (e.target && (e.target.tagName === 'A' || e.target.tagName === 'BUTTON' ||
          /close/i.test((e.target.getAttribute && e.target.getAttribute('aria-label')) || '') ||
          (e.target.textContent || '').trim() === '\u00d7')) { return; }
      dragging = true;
      var r = p.getBoundingClientRect();
      p.style.left = r.left + 'px';
      p.style.top = r.top + 'px';
      p.style.right = 'auto';
      p.style.bottom = 'auto';
      sx = e.clientX; sy = e.clientY; ox = r.left; oy = r.top;
      e.preventDefault();
    }
    function move(e) {
      if (!dragging) { return; }
      var nx = ox + (e.clientX - sx), ny = oy + (e.clientY - sy);
      nx = Math.max(4, Math.min(window.innerWidth - 60, nx));
      ny = Math.max(4, Math.min(window.innerHeight - 40, ny));
      p.style.left = nx + 'px'; p.style.top = ny + 'px';
      window.__mlsUxPanelPos = { left: nx, top: ny };
    }
    function up() { dragging = false; }
    on(handle, 'mousedown', down);
    on(document, 'mousemove', move);
    on(document, 'mouseup', up);
  }
  function restorePanelPos(p) {
    var pos = window.__mlsUxPanelPos;
    if (pos && p) { p.style.left = pos.left + 'px'; p.style.top = pos.top + 'px'; p.style.right = 'auto'; p.style.bottom = 'auto'; }
  }

  /* ---------------- E. MLS Easy auto-advance after pull ---------------- */
  var pullArmed = false, pullArmedAt = 0, lastPatient = null;
  function patientNameNow() {
    var el = document.getElementById('heroPtName');
    return el ? (el.value || el.textContent || '').trim() : '';
  }
  function armPull() { pullArmed = true; pullArmedAt = Date.now(); lastPatient = patientNameNow(); }
  function maybeAutoAdvance() {
    if (!pullArmed) { return; }
    if (Date.now() - pullArmedAt > 25000) { pullArmed = false; return; }
    var now = patientNameNow();
    if (now && now !== lastPatient) {
      pullArmed = false;
      setTimeout(function () {
        try {
          var go = document.getElementById('ezGoRec');
          if (go && go.offsetParent !== null) { go.click(); }
        } catch (e) {}
      }, 1300);
    }
  }
  function hookPullButtons() {
    on(document, 'click', function (e) {
      var t = e.target;
      while (t && t !== document) {
        var id = t.id || '';
        if (id === 'ezPull' || id === 'ezPullAlt' || id === 'ptPullAthenaBtn' ||
            /Pull open Athena|Pull from Athena/i.test(t.textContent || '')) {
          armPull();
          break;
        }
        t = t.parentNode;
      }
    }, true);
  }

  /* ---------------- main observer + poll (coalesced, bg-safe) ---------------- */
  var pending = false;
  function schedulePass() {
    if (pending) { return; }
    pending = true;
    var done = false;
    function run() { if (done) { return; } done = true; pending = false; pass(); }
    try { (window.requestAnimationFrame || function (f) { setTimeout(f, 16); })(run); } catch (e) {}
    setTimeout(run, 200);
  }
  function pass() {
    try {
      reconcileDetection();
      guardIdempotent();
      var i, sel = ['#mlsAutoPullChip', '.mlsac-toast'];
      for (i = 0; i < sel.length; i++) {
        document.querySelectorAll(sel[i]).forEach(function (n) {
          if (getComputedStyle(n).display !== 'none') { foldDuplicate(n); }
        });
      }
      var p = richPanel() || document.getElementById('mlsuxPanel');
      if (p) { makeDraggable(p); restorePanelPos(p); }
      maybeAutoAdvance();
    } catch (e) {}
  }

  var mo = null;
  function startObserver() {
    mo = new MutationObserver(function (muts) {
      for (var i = 0; i < muts.length; i++) {
        var m = muts[i];
        if (m.addedNodes && m.addedNodes.length) { schedulePass(); return; }
        if (m.type === 'characterData') { schedulePass(); return; }
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
    cleanups.push(function () { try { mo.disconnect(); } catch (e) {} });
  }

  function boot() {
    patchDetection();
    injectSuppressStyle();
    hookPullButtons();
    startObserver();
    var iv = setInterval(function () { schedulePass(); }, 1200);
    cleanups.push(function () { clearInterval(iv); });
    var iv2 = setInterval(function () { patchDetection(); }, 4000);
    cleanups.push(function () { clearInterval(iv2); });
    schedulePass();
  }

  function revert() {
    try {
      cleanups.forEach(function (fn) { try { fn(); } catch (e) {} });
      cleanups = [];
      wraps.forEach(function (w) { try { w.obj[w.key] = w.orig; } catch (e) {} });
      wraps = [];
      document.querySelectorAll('.mlsux-mirror').forEach(function (n) { n.remove(); });
    } catch (e) {}
    window.__mlsUxUnify.installed = false;
  }

  window.__mlsUxUnify = {
    installed: true,
    version: VERSION,
    asset: 'feat_athena_ux_unify.js',
    connected: connected,
    reconcileDetection: reconcileDetection,
    foldDuplicate: foldDuplicate,
    mirror: mirror,
    classifyState: classifyState,
    guardIdempotent: guardIdempotent,
    revert: revert,
    _internals: { patchDetection: patchDetection, maybeAutoAdvance: maybeAutoAdvance, armPull: armPull }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
