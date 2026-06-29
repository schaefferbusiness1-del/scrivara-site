/* feat_mls_settings_wb.js  ->  window.__mlsSettingsWb  (swb-1.0.0)
 *
 * item70 (STAGING): add a SECOND entry point to the existing "Writeback
 * destination" panel (item61, window.__mlsWbConsole) from the Settings area.
 *
 *  - Adds a clean, on-theme row inside the Settings modal's existing
 *    "Integrations" section (#settingsModal, the athenahealth/EMR section),
 *    with a button "Open writeback destination..." that simply calls the
 *    EXISTING window.__mlsWbConsole.open(). No panel markup is duplicated.
 *  - The Visit-screen "Writeback destination..." launchers (item61, injected
 *    into #emrCard / #procNoteCard) are NOT touched. The panel is reachable
 *    from BOTH the Visit cards and Settings.
 *  - Idempotent (single row, guarded), re-asserts on settings open / DOM
 *    churn, and fully reversible: window.__mlsSettingsWb.revert() removes the
 *    row + observers and leaves the app exactly as before.
 *
 * Additive, reversible, ASCII-only. Never deletes/modifies patient records;
 * no athenaOne writes here (the underlying panel owns all gated writers).
 */
(function () {
  'use strict';
  try { if (window.__mlsSettingsWb && window.__mlsSettingsWb.installed) return; } catch (e) { return; }

  var ASSET = 'feat_mls_settings_wb.js';
  var VERSION = 'swb-1.0.0';
  var ROW_ID = 'mlsSettingsWbRow';
  var MARK = 'data-mls-settings-wb';

  function isFn(f) { return typeof f === 'function'; }
  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function $(id) { return document.getElementById(id); }

  /* The item61 console. We REUSE its open() - never re-implement the panel. */
  function console61() {
    var c = window.__mlsWbConsole;
    return (c && isFn(c.open)) ? c : null;
  }

  /* Locate the Settings modal's "Integrations" section (the athenahealth/EMR
   * block), matched by its .set-head text so we ride along with the app's own
   * structure rather than hard-coding fragile positions. */
  function findIntegrationsSection() {
    var modal = $('settingsModal');
    if (!modal) return null;
    var secs = modal.querySelectorAll('.set-section');
    for (var i = 0; i < secs.length; i++) {
      var head = secs[i].querySelector('.set-head');
      var txt = head ? (head.textContent || '') : '';
      if (/integration/i.test(txt)) return secs[i];
    }
    return null;
  }

  function buildRow() {
    var field = document.createElement('div');
    field.className = 'field';
    field.id = ROW_ID;
    field.setAttribute(MARK, '1');
    field.style.borderTop = '1px solid var(--line)';
    field.style.paddingTop = '14px';
    field.style.marginTop = '4px';

    var label = document.createElement('label');
    label.style.fontSize = '15px';
    label.textContent = '🎯 Athena writeback destination';
    field.appendChild(label);

    var note = document.createElement('p');
    note.className = 'note';
    note.style.margin = '2px 0 10px';
    note.textContent = 'Choose where each output lands in athenaOne (op-note tab/section/template, note/dx/cpt). Opens the same panel as the "Writeback destination..." button on the visit screen.';
    field.appendChild(note);

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-primary';
    btn.id = ROW_ID + 'Btn';
    btn.style.fontSize = '14px';
    btn.style.padding = '9px 15px';
    btn.textContent = 'Open writeback destination…';
    btn.addEventListener('click', function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      var c = console61();
      if (!c) {
        safe(function () { window.alert('The writeback destination panel is still loading - try again in a moment.'); });
        return;
      }
      safe(function () { c.open(); });
    });
    field.appendChild(btn);

    return field;
  }

  function ensureRow() {
    return safe(function () {
      if ($(ROW_ID)) return true;            /* idempotent: only ever one row */
      var sec = findIntegrationsSection();
      if (!sec) return false;
      sec.appendChild(buildRow());
      return true;
    });
  }

  /* boot / observe ------------------------------------------------------- */
  var mo = null, guard = null, retimer = null;
  function schedule() {
    if (retimer) return;
    retimer = setTimeout(function () { retimer = null; ensureRow(); }, 300);
  }
  function boot() {
    ensureRow();
    /* Settings sections are show/hidden, not torn down, so one insert sticks;
     * the observer + interval are belt-and-suspenders against re-renders. */
    guard = setInterval(ensureRow, 4000);
    safe(function () {
      mo = new MutationObserver(schedule);
      mo.observe(document.body || document.documentElement, { childList: true, subtree: true });
    });
  }

  function revert() {
    try { if (mo) mo.disconnect(); } catch (e) {} mo = null;
    if (guard) { clearInterval(guard); guard = null; }
    if (retimer) { clearTimeout(retimer); retimer = null; }
    safe(function () {
      var nodes = document.querySelectorAll('[' + MARK + '="1"], #' + ROW_ID);
      [].slice.call(nodes).forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    });
    try { window.__mlsSettingsWb.installed = false; } catch (e) {}
  }

  window.__mlsSettingsWb = {
    installed: true, version: VERSION, asset: ASSET,
    ensureRow: ensureRow,                 /* exposed for diagnostics/testing */
    open: function () { var c = console61(); if (c) c.open(); },
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
