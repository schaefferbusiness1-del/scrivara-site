/* ============================================================================
 * feat_mls_apptabs_menu.js  ->  window.__mlsTabMenu   (tm-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 3b: when an advanced App-tab (Settings -> App tabs: Orders / Legal
 * requests / Team) is toggled OFF, it should DISAPPEAR from the top nav (the
 * app already does this via the .nav-feat-off class) AND be ADDED to the Menu
 * (hamburger) dropdown so it stays reachable -- not vanish entirely.
 *
 * Orders is ALREADY relocated into the Menu unconditionally by
 * feat_mls_header_exact (the real #nav_orders is moved into #mlsTbMenuPanel),
 * so this module handles the remaining two: Legal requests and Team.
 *
 * Mechanism (additive, reversible, idempotent, no fabrication):
 *  - For each handled key, when the feature is OFF *and* the tab is
 *    role-permitted (its inline style.display !== 'none' -- i.e. the ONLY
 *    reason it is hidden is the App-tab gate, not the account's role), add a
 *    native-styled button.mlsTbItem row to #mlsTbMenuPanel that forwards a
 *    click to the REAL (hidden) nav tab -> its own onclick="showView('<tok>')".
 *  - When the feature is ON (tab back in the nav) or the tab is role-hidden,
 *    remove our Menu row. Never duplicated (create-if-missing / remove-if-present).
 *  - Re-syncs on boot, whenever setNavFeat() runs (the Settings toggle), and via
 *    a MutationObserver on the panel (self-heal if the panel is rebuilt).
 *
 * SAFETY: only reads navFeatOn() + the tab's own display; only appends/removes
 * our own rows (data-mls-asset tagged). No app state written, no network, no
 * credentials. ASCII-only (emoji via \u escapes). Reversible: __mlsTabMenu.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsTabMenu && window.__mlsTabMenu.installed) return; } catch (e) { return; }

  var VERSION = 'tm-1.0.0';
  var PANEL_ID = 'mlsTbMenuPanel';
  var ROW_PREFIX = 'mlsTabMenuRow_';
  var _origSetNavFeat = null;
  var _obs = null;
  var _syncing = false;

  /* keys handled here (Orders is owned by feat_mls_header_exact). icon via \u escapes. */
  var ITEMS = [
    { key: 'legalreq', token: 'legalreq', label: 'Legal requests', icon: '\u2696\ufe0f' }, /* scales */
    { key: 'team',     token: 'team',     label: 'Team',           icon: '\u{1F465}'     }  /* busts */
  ];

  function $(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }
  function navOn(key) {
    try { return isFn(window.navFeatOn) ? !!window.navFeatOn(key) : true; } catch (e) { return true; }
  }
  function panel() { return $(PANEL_ID); }

  /* role-permitted = the tab is NOT hidden by the account's role; the App-tab
   * gate hides via the .nav-feat-off CLASS, leaving inline display untouched
   * (''/'flex'). A role-forbidden tab has inline style.display === 'none'. */
  function rolePermitted(tab) {
    if (!tab) return false;
    var d = tab.style && tab.style.display;
    return d !== 'none';
  }

  function makeRow(it) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mlsTbItem';
    b.id = ROW_PREFIX + it.key;
    b.setAttribute('data-mls-asset', 'feat_mls_apptabs_menu.js');
    var ico = document.createElement('span'); ico.className = 'mlsTbIco'; ico.textContent = it.icon;
    var lbl = document.createElement('span'); lbl.textContent = it.label;
    b.appendChild(ico); b.appendChild(lbl);
    b.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      var p = panel(); if (p) { p.classList.remove('open'); }     // close the dropdown
      var tab = $('nav_' + it.key);
      if (tab) { try { tab.click(); } catch (e) { try { if (isFn(window.showView)) window.showView(it.token); } catch (_) {} } }
      else if (isFn(window.showView)) { try { window.showView(it.token); } catch (e) {} }
    });
    return b;
  }

  function sync() {
    if (_syncing) return;
    _syncing = true;
    try {
      var p = panel(); if (!p) return;
      ITEMS.forEach(function (it) {
        var tab = $('nav_' + it.key);
        var shouldShow = !!tab && rolePermitted(tab) && !navOn(it.key);
        var existing = $(ROW_PREFIX + it.key);
        if (shouldShow && !existing) {
          p.appendChild(makeRow(it));               // append after the native rows + Orders
        } else if (!shouldShow && existing) {
          try { existing.parentNode.removeChild(existing); } catch (e) {}
        }
      });
    } catch (e) { /* never block */ }
    finally { _syncing = false; }
  }

  function hookSetNavFeat() {
    if (!isFn(window.setNavFeat) || window.setNavFeat.__mlsTmWrapped) return;
    _origSetNavFeat = window.setNavFeat;
    var wrapped = function () {
      var r = _origSetNavFeat.apply(this, arguments);
      try { setTimeout(sync, 0); } catch (e) { sync(); }
      return r;
    };
    wrapped.__mlsTmWrapped = true;
    wrapped.__mlsTmOrig = _origSetNavFeat;
    window.setNavFeat = wrapped;
  }

  function observePanel() {
    var p = panel(); if (!p || _obs) return;
    try {
      _obs = new MutationObserver(function () { if (!_syncing) setTimeout(sync, 0); });
      _obs.observe(p, { childList: true });
    } catch (e) {}
  }

  function boot() {
    hookSetNavFeat();
    observePanel();
    sync();
  }

  function bootWithRetry() {
    boot();
    var n = 0;
    var t = setInterval(function () {
      n++;
      hookSetNavFeat();
      observePanel();
      sync();
      if ((panel() && isFn(window.setNavFeat)) || n >= 40) clearInterval(t);
    }, 300);
  }

  function revert() {
    try { if (_obs) { _obs.disconnect(); _obs = null; } } catch (e) {}
    try {
      if (window.setNavFeat && window.setNavFeat.__mlsTmWrapped && _origSetNavFeat) window.setNavFeat = _origSetNavFeat;
    } catch (e) {}
    ITEMS.forEach(function (it) {
      var r = $(ROW_PREFIX + it.key);
      if (r && r.parentNode) { try { r.parentNode.removeChild(r); } catch (e) {} }
    });
    try { window.__mlsTabMenu.installed = false; } catch (e) {}
  }

  window.__mlsTabMenu = { installed: true, version: VERSION, sync: sync, revert: revert };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootWithRetry);
  } else {
    bootWithRetry();
  }
})();
