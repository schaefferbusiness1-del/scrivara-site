/* ============================================================================
 * feat_mls_calbox_uniform.js  ->  window.__mlsCalBox   (cb-1.1.0)
 * ---------------------------------------------------------------------------
 * ITEM 9: the blue appointment boxes in the Week and Day calendar views must be
 * CONSISTENT (uniform style), and each must show the time + the patient name.
 *
 * ROOT CAUSE: _calRenderWeek/_calRenderDay color every box via
 * _calStatusColor(a.status) -- scheduled=blue, completed=green, checked_in=
 * orange, roomed=blue-purple -- so identical appointments render in different
 * colors and look inconsistent. (The boxes already print "<time> <name>".)
 *
 * FIX (additive, reversible): wrap window._calStatusColor so every ACTIVE
 * appointment returns ONE uniform blue; cancelled / no-show stay visually
 * distinct (muted red) so a cancellation is never mistaken for an active visit.
 * The render functions then paint every active box the same blue, time + name
 * intact. A tiny CSS pass enforces uniform radius/contrast/overflow so the
 * boxes read cleanly. Re-renders the calendar once on install. Idempotent,
 * ASCII-only, reversible (window.__mlsCalBox.revert()).
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsCalBox && window.__mlsCalBox.installed) return; } catch (e) { return; }

  var VERSION = 'cb-1.1.0';
  var STYLE_ID = 'mlsCalBoxStyle';
  var _orig = null;

  // uniform "active" blue (matches the redesign palette) + the kept cancelled red
  var BLUE = { bg: '#e8f1fe', fg: '#204034' };
  var RED = { bg: '#fdeaea', fg: '#a12c2c' };

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }

  function injectCSS() {
    if (document.getElementById(STYLE_ID)) return;
    var css = [
      // uniform chrome on every appointment box in Week/Day (overrides nothing
      // critical -- bg/fg come from the wrapped _calStatusColor; this only makes
      // radius/contrast/overflow consistent so they read as one style).
      '#calGrid [data-appt]{border-radius:6px!important;font-weight:600!important;'
        + 'box-shadow:0 1px 3px rgba(20,60,120,.12)!important;white-space:nowrap!important;'
        + 'text-overflow:ellipsis!important}',
      '#calGrid [data-appt] b{font-weight:800!important}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = STYLE_ID; st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  function installWrap() {
    if (typeof window._calStatusColor !== 'function') return false;
    if (window._calStatusColor.__mlsCbWrapped) return true;
    _orig = window._calStatusColor;
    var wrapped = function (s) {
      s = s || '';
      if (s === 'cancelled' || s === 'no_show') return { bg: RED.bg, fg: RED.fg };
      return { bg: BLUE.bg, fg: BLUE.fg };   // every active status -> one uniform blue
    };
    wrapped.__mlsCbWrapped = true;
    wrapped.__mlsCbOrig = _orig;
    window._calStatusColor = wrapped;
    return true;
  }

  function rerender() {
    safe(function () {
      if (window.__mlsCurrentView === 'calendar' && typeof window.renderCalendar === 'function') window.renderCalendar();
    });
  }

  function boot() {
    injectCSS();
    if (installWrap()) { rerender(); return; }
    var n = 0, t = setInterval(function () {
      n++;
      if (installWrap()) { clearInterval(t); rerender(); }
      else if (n >= 40) clearInterval(t);
    }, 300);
  }

  function revert() {
    safe(function () { if (window._calStatusColor && window._calStatusColor.__mlsCbWrapped && _orig) window._calStatusColor = _orig; });
    safe(function () { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    rerender();
    safe(function () { window.__mlsCalBox.installed = false; });
  }

  window.__mlsCalBox = {
    installed: true,
    version: VERSION,
    rerender: rerender,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
