/*! feat_athena_truthcheck_amber.js  ->  window.__mlsAthenaTruthAmber  (v1.1.0)
 * =====================================================================
 * SECONDARY 1 — amber -> RED consistency on a confirmed phantom.
 *
 * The §truthcheck deploy left ONE inconsistency on the doctor panel
 * (div.mlsdoc-card): on a confirmed phantom (no real athenaOne tab), the
 * "A signed-in athenaOne tab is open" line is forced ✗ RED and the green
 * "ready" banner is removed, but the "Extension can read the athenaOne
 * page" line can stay AMBER ("! could not check — no athenaOne tab to
 * read"). Two non-green states, but inconsistent.
 *
 * This tiny additive COMPANION makes that last line consistent: when the
 * panel's OWN "tab is open" line is already ✗ RED (ic-fail) — i.e. there is
 * provably no signed-in, readable athenaOne tab — and the "page readable"
 * line is AMBER (ic-warn), it downgrades the amber line to ✗ RED too, and
 * rewrites its detail to the honest "no athenaOne page to read".
 *
 * SAFETY — DOWNGRADE-ONLY, never invents green/red on a real connection:
 *   - It only ever flips ic-warn -> ic-fail on the page-readable line.
 *     It never touches ic-pass (green) and never upgrades anything.
 *   - It acts ONLY when the sibling "tab is open" line is ic-fail (so on a
 *     genuine connection — where that line is ic-pass green — it does
 *     nothing) AND, when the single source of truth is present,
 *     __mlsConnTruth.isConnected() === false. (Belt and suspenders.)
 *   - It skips a panel that is still mid-check (grey ic-check icons present).
 *   - Reads no PHI: only row label text and icon CSS classes. NUL-free.
 *   - Idempotent, observer + slow-poll driven (the doctor diagnose chain can
 *     settle WITHOUT a final mutation that re-triggers the observer, so a
 *     1.2s poll guarantees the downgrade still lands), fully reversible via
 *     window.__mlsAthenaTruthAmber.revert() (restores any line it changed).
 * ===================================================================== */
(function () {
  'use strict';
  var W = (typeof window !== 'undefined') ? window : null;
  if (!W) return;
  if (W.__mlsAthenaTruthAmber && W.__mlsAthenaTruthAmber.installed) return;

  var VERSION = '1.1.0';
  var ASSET = 'feat_athena_truthcheck_amber.js';

  var PANEL_SEL = '.mlsdoc-card';
  var ROW_SEL = 'li.mlsdoc-step';
  var IC_SEL = '.mlsdoc-ic';
  var LBL_SEL = '.mlsdoc-lbl';
  var DET_SEL = '.mlsdoc-det';
  var TAB_LBL = /tab is open/i;
  var PERM_LBL = /read the athenaOne page/i;
  var X_MARK = '✗'; // ✗ heavy ballot X (same glyph family the panel uses)

  var _obs = null, _raf = 0, _pollT = null;
  var _changed = []; // {ic, det, prevClass, prevText, prevDet, hadDet} for revert

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function isConnFalse() {
    var ct = W.__mlsConnTruth;
    if (ct && typeof ct.isConnected === 'function') {
      // If a truth source exists, require it to say NOT connected. If reading it
      // throws, fall back to the within-panel rule (do not block on it).
      var v = safe(function () { return ct.isConnected(); }, 'err');
      if (v === true) return false;     // genuinely connected -> never act
      return true;                       // false or unreadable -> allow within-panel rule to decide
    }
    return true; // no truth source -> rely on the within-panel "tab open == fail" rule
  }

  function rowIcon(row) { return row.querySelector(IC_SEL); }
  function rowLabelText(row) { var l = row.querySelector(LBL_SEL); return l ? (l.textContent || '') : (row.textContent || ''); }
  function iconIs(ic, cls) { return ic && ic.classList && ic.classList.contains(cls); }

  function correctPanel(panel) {
    try {
      if (!panel) return;
      // never act while the chain is still running (grey icons present)
      if (panel.querySelector(IC_SEL + '.ic-check')) return;
      if (!isConnFalse()) return; // genuine connection -> do nothing

      var rows = panel.querySelectorAll(ROW_SEL);
      var tabFail = false, permRow = null, permIc = null;
      for (var i = 0; i < rows.length; i++) {
        var lbl = rowLabelText(rows[i]);
        var ic = rowIcon(rows[i]);
        if (TAB_LBL.test(lbl) && iconIs(ic, 'ic-fail')) tabFail = true;
        if (PERM_LBL.test(lbl)) { permRow = rows[i]; permIc = ic; }
      }
      // Only act when the panel itself proves there is no readable athena tab
      // (the "tab is open" line is RED) and the page-readable line is AMBER.
      if (!tabFail || !permRow || !permIc) return;
      if (!iconIs(permIc, 'ic-warn')) return;      // only downgrade amber; never touch green/red
      if (iconIs(permIc, 'ic-fail')) return;       // already red

      // record for revert
      var det = permRow.querySelector(DET_SEL);
      _changed.push({
        ic: permIc, det: det,
        prevClass: permIc.className,
        prevText: permIc.textContent,
        prevDet: det ? det.textContent : null,
        hadDet: !!det
      });

      // downgrade amber -> red
      permIc.classList.remove('ic-pass', 'ic-warn', 'ic-check');
      permIc.classList.add('ic-fail');
      permIc.textContent = X_MARK;
      if (!det) {
        var lblEl = permRow.querySelector(LBL_SEL) || permRow;
        det = document.createElement('span'); det.className = 'mlsdoc-det';
        (lblEl.parentNode || permRow).appendChild(det);
        _changed[_changed.length - 1].det = det;
      }
      det.textContent = 'There is no athenaOne page to read — open a signed-in athenaOne tab.';
    } catch (e) {}
  }

  function correctAll() {
    safe(function () {
      var panels = document.querySelectorAll(PANEL_SEL);
      for (var i = 0; i < panels.length; i++) correctPanel(panels[i]);
    });
  }

  function schedule() {
    if (_raf) return;
    var run = function () { _raf = 0; correctAll(); };
    _raf = (W.requestAnimationFrame ? W.requestAnimationFrame(run) : setTimeout(run, 16));
  }

  function boot() {
    correctAll();
    safe(function () {
      _obs = new MutationObserver(function () { schedule(); });
      _obs.observe(document.body || document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    });
    // Slow safety poll: the doctor panel's diagnose chain settles WITHOUT a final
    // mutation that re-triggers the observer (it can fire only mid-check, where we
    // correctly bail on grey ic-check icons). A periodic re-check guarantees the
    // amber->red downgrade still lands once the panel reaches its final state.
    _pollT = setInterval(function () { correctAll(); }, 1200);
  }

  function revert() {
    safe(function () { if (_obs) { _obs.disconnect(); _obs = null; } });
    safe(function () { if (_pollT) { clearInterval(_pollT); _pollT = null; } });
    safe(function () { if (_raf && W.cancelAnimationFrame) W.cancelAnimationFrame(_raf); });
    _raf = 0;
    _changed.forEach(function (c) {
      safe(function () {
        if (c.ic) { c.ic.className = c.prevClass; c.ic.textContent = c.prevText; }
        if (c.det) {
          if (c.hadDet) c.det.textContent = c.prevDet;
          else if (c.det.parentNode) c.det.parentNode.removeChild(c.det); // we created it
        }
      });
    });
    _changed = [];
    if (W.__mlsAthenaTruthAmber) W.__mlsAthenaTruthAmber.installed = false;
  }

  W.__mlsAthenaTruthAmber = {
    installed: true,
    version: VERSION,
    asset: ASSET,
    correctAll: correctAll,
    correctPanel: correctPanel,   // exposed for tests
    _changed: function () { return _changed; },
    revert: revert
  };

  try {
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot, { once: true });
    } else { boot(); }
  } catch (e) { try { boot(); } catch (e2) {} }
})();
