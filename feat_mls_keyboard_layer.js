/* feat_mls_keyboard_layer.js — item47
 * Unified keyboard layer for the core note loop + a discoverable help overlay.
 * Builds cohesively on the existing Alt+1/2/3 dot-phrase keys (item44) so the
 * whole keyboard story is ONE consistent, discoverable system. Hands stay on
 * the keyboard for the most common note actions.
 *   Alt+G  -> Generate note   (clicks existing #genBtn)
 *   Alt+C  -> Copy note       (clicks existing #copyBtn)
 *   Alt+P  -> Print note      (clicks existing #printBtn)
 *   ?      -> Toggle shortcuts overlay (when not typing in a field)
 *   Esc    -> Close overlay
 * Every action REUSES the app's own buttons — no new behavior, fully reversible.
 * window.__mlsKbd.revert()
 */
(function () {
  if (window.__mlsKbd && window.__mlsKbd.__live) return;

  var STYLE_ID = 'mlsKbd-style';
  var OVL_ID = 'mlsKbdOverlay';
  var HINT_ID = 'mlsKbdHint';
  var keyHandler = null;

  var SHORTCUTS = [
    { keys: 'Alt + 1', desc: 'Insert .normal-exam dot phrase' },
    { keys: 'Alt + 2', desc: 'Insert .ros-neg dot phrase' },
    { keys: 'Alt + 3', desc: 'Insert .return-precautions dot phrase' },
    { keys: 'Alt + G', desc: 'Generate note' },
    { keys: 'Alt + C', desc: 'Copy note' },
    { keys: 'Alt + P', desc: 'Print note' },
    { keys: '?',       desc: 'Show / hide this list' },
    { keys: 'Esc',     desc: 'Close this list' }
  ];

  function css() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = [
      '#' + OVL_ID + '{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;',
      'justify-content:center;background:rgba(8,10,20,.55);backdrop-filter:blur(2px);}',
      '#' + OVL_ID + ' .mlskbd-card{width:min(440px,92vw);max-height:84vh;overflow:auto;border-radius:16px;',
      'background:#11141f;color:#e8eaf2;border:1px solid rgba(140,140,170,.25);',
      'box-shadow:0 24px 70px rgba(0,0,0,.5);padding:20px 22px;font:500 14px/1.45 system-ui,Segoe UI,Roboto,sans-serif;}',
      '#' + OVL_ID + ' h3{margin:0 0 4px;font-size:16px;font-weight:800;display:flex;align-items:center;gap:8px;}',
      '#' + OVL_ID + ' .mlskbd-sub{margin:0 0 14px;font-size:12px;opacity:.6;}',
      '#' + OVL_ID + ' .mlskbd-row{display:flex;align-items:center;justify-content:space-between;gap:14px;',
      'padding:7px 0;border-top:1px solid rgba(140,140,170,.10);}',
      '#' + OVL_ID + ' .mlskbd-row:first-of-type{border-top:0;}',
      '#' + OVL_ID + ' .mlskbd-keys{flex:0 0 auto;font:700 12px/1 ui-monospace,Menlo,Consolas,monospace;',
      'background:rgba(127,127,160,.16);border:1px solid rgba(140,140,170,.25);border-radius:7px;padding:5px 9px;white-space:nowrap;}',
      '#' + OVL_ID + ' .mlskbd-desc{flex:1 1 auto;text-align:left;opacity:.92;}',
      '#' + OVL_ID + ' .mlskbd-close{margin-top:16px;width:100%;padding:9px;border-radius:10px;cursor:pointer;',
      'border:1px solid rgba(140,140,170,.25);background:rgba(127,127,160,.12);color:inherit;font-weight:700;}',
      '#' + OVL_ID + ' .mlskbd-close:hover{background:rgba(127,127,160,.22);}',
      '#' + HINT_ID + '{position:fixed;right:14px;bottom:84px;z-index:2147483500;font:600 11.5px/1 system-ui,sans-serif;',
      'background:rgba(17,20,31,.9);color:#cfd3e6;border:1px solid rgba(140,140,170,.25);border-radius:999px;',
      'padding:6px 11px;cursor:pointer;opacity:.0;transition:opacity .4s ease;box-shadow:0 6px 18px rgba(0,0,0,.25);}',
      '#' + HINT_ID + '.show{opacity:.85;}',
      '#' + HINT_ID + ':hover{opacity:1;}'
    ].join('');
    document.head.appendChild(s);
  }

  function isTyping(t) {
    if (!t) return false;
    var tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || t.isContentEditable;
  }

  function clickIf(sel) {
    var el = document.querySelector(sel);
    if (el && el.offsetParent !== null && !el.disabled) { el.click(); return true; }
    return false;
  }

  function closeOverlay() {
    var o = document.getElementById(OVL_ID);
    if (o) o.remove();
  }

  function toggleOverlay() {
    var existing = document.getElementById(OVL_ID);
    if (existing) { existing.remove(); return; }
    var o = document.createElement('div');
    o.id = OVL_ID;
    var rows = SHORTCUTS.map(function (s) {
      return '<div class="mlskbd-row"><span class="mlskbd-desc">' + s.desc +
        '</span><span class="mlskbd-keys">' + s.keys + '</span></div>';
    }).join('');
    o.innerHTML = '<div class="mlskbd-card" role="dialog" aria-label="Keyboard shortcuts">' +
      '<h3>⌨ Keyboard shortcuts</h3>' +
      '<p class="mlskbd-sub">Faster notes without leaving the keyboard.</p>' +
      rows +
      '<button type="button" class="mlskbd-close">Close (Esc)</button></div>';
    o.addEventListener('click', function (e) { if (e.target === o) o.remove(); });
    o.querySelector('.mlskbd-close').addEventListener('click', closeOverlay);
    document.body.appendChild(o);
  }

  function onKey(e) {
    if (window.__mlsKbd && window.__mlsKbd.__reverted) return;
    // Esc closes overlay
    if (e.key === 'Escape' && document.getElementById(OVL_ID)) { closeOverlay(); return; }
    // "?" overlay — only when not typing in a field
    if ((e.key === '?' || (e.key === '/' && e.shiftKey)) && !isTyping(e.target)) {
      e.preventDefault(); toggleOverlay(); return;
    }
    // Alt combos — safe even while focused in a field (Alt avoids text conflicts)
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      var k = (e.key || '').toLowerCase();
      if (k === 'g') { if (clickIf('#genBtn')) e.preventDefault(); }
      else if (k === 'c') { if (clickIf('#copyBtn')) e.preventDefault(); }
      else if (k === 'p') { if (clickIf('#printBtn')) e.preventDefault(); }
    }
  }

  /* ph-kbdhint-1.0.0 — a keyboard hint has nothing to say to a device with no
     keyboard. Measured on a 402x874 iPhone repro: this pill renders at
     bottom:84px (the CSS above), which is the BYTE-IDENTICAL anchor ph-safe-1.0.0
     gives #mlsA2hsCard (ScribeFlow.html:1870), and it wins the stack at z-index
     2147483500 against the card's 99997 — a 181.2 x 25.5 CSS px overlap sitting
     on top of the Home Screen card's own action. On top of covering something
     useful, it advertises a key ("?") that a touch device cannot type.

     (hover:none) AND (pointer:coarse) together are what actually mean "finger":
     a mouse reports hover/fine, and a touchscreen LAPTOP reports pointer:fine,
     so every device that can really press ? keeps the hint byte-for-byte as
     today. If matchMedia is missing or throws we fall through to SHOWING it, so
     an old browser loses nothing. */
  function touchOnlyDevice() {
    try {
      return !!(window.matchMedia &&
        window.matchMedia('(hover:none)').matches &&
        window.matchMedia('(pointer:coarse)').matches);
    } catch (e) { return false; }
  }

  function showHintOnce() {
    if (touchOnlyDevice()) return;
    if (sessionStorageSafe('mlsKbdHintShown')) return;
    var h = document.createElement('div');
    h.id = HINT_ID;
    h.textContent = '⌨ Press ? for shortcuts';
    h.addEventListener('click', function () { toggleOverlay(); fade(); });
    document.body.appendChild(h);
    requestAnimationFrame(function () { h.classList.add('show'); });
    var t1 = setTimeout(function () { fade(); }, 6500);
    function fade() {
      clearTimeout(t1);
      var el = document.getElementById(HINT_ID);
      if (el) { el.classList.remove('show'); setTimeout(function () { if (el) el.remove(); }, 500); }
      try { sessionStorage.setItem('mlsKbdHintShown', '1'); } catch (e) {}
    }
  }
  function sessionStorageSafe(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }

  function start() {
    css();
    keyHandler = onKey;
    document.addEventListener('keydown', keyHandler, true);
    // gentle one-time discovery hint
    setTimeout(showHintOnce, 1500);
  }

  window.__mlsKbd = {
    __live: true,
    __reverted: false,
    open: toggleOverlay,
    revert: function () {
      this.__reverted = true;
      this.__live = false;
      if (keyHandler) document.removeEventListener('keydown', keyHandler, true);
      closeOverlay();
      var h = document.getElementById(HINT_ID); if (h) h.remove();
      var s = document.getElementById(STYLE_ID); if (s) s.remove();
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
