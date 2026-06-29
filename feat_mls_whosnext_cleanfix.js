/* feat_mls_whosnext_cleanfix.js  (item 60)
 * Additive, reversible CSS-only fix for the Visit view "Who's Next" patient picker.
 *
 * Root cause: feat_mls_whosnext.js (item 55) scopes ALL of its styling to
 * "#mlsWhosNextBox .wn-*", but the chips actually render into
 * "#heroToday > .wn-grid" with no #mlsWhosNextBox wrapper present in the DOM.
 * As a result none of the intended translucent-blue styling applies: every
 * .wn-chip falls back to the browser default grey button (rgb(240,240,240)),
 * the .wn-hd header collapses ("Who's NextNN patients" with no spacing), and
 * the .wn-grid loses its flex gap (ragged rows / dark diamond gaps).
 *
 * This module re-emits the module's OWN intended styling on the bare .wn-*
 * selectors so the clean blue patient boxes, spaced header, and even grid
 * appear again. No logic, DOM-record, athenaOne, or data changes - purely a
 * stylesheet. Fully reversible via window.__mlsWhosNextCleanFix.revert().
 */
(function () {
  'use strict';
  var STYLE_ID = 'mlsWhosNextCleanFixStyle';
  var VERSION = '20260629wncf1';

  var CSS = [
    /* keep the old picker hidden, exactly as whosnext does */
    '#mlsPickComplexWrap,#mlsPickSmartWrap{display:none!important}',
    /* header row */
    '.wn-hd{display:flex;align-items:center;gap:8px;margin:2px 0 8px;flex-wrap:wrap}',
    '.wn-title{font-size:12px;font-weight:800;letter-spacing:.3px;opacity:.95;color:#fff}',
    '.wn-doc{font-size:11px;font-weight:700;background:rgba(255,255,255,.2);border:1px solid rgba(255,255,255,.35);border-radius:999px;padding:2px 9px;color:#fff}',
    '.wn-doc b{font-weight:800}',
    '.wn-clear{font-size:11px;color:#dbe7ff;background:none;border:0;cursor:pointer;text-decoration:underline;padding:0}',
    '.wn-count{font-size:11.5px;opacity:.82;margin-left:auto;color:#fff}',
    /* the patient grid + clean blue chips */
    '.wn-grid{display:flex;gap:8px;flex-wrap:wrap}',
    '.wn-chip{display:flex;flex-direction:column;align-items:flex-start;gap:1px;min-width:120px;max-width:220px;text-align:left;background:rgba(255,255,255,.16);border:1px solid rgba(255,255,255,.32);color:#fff;border-radius:11px;padding:8px 11px;cursor:pointer;font-family:inherit}',
    '.wn-chip:hover{background:rgba(255,255,255,.27)}',
    '.wn-chip .wn-nm{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}',
    '.wn-chip .wn-mt{font-size:11px;opacity:.85}',
    '.wn-empty{font-size:12px;opacity:.85;padding:8px 2px}'
  ].join('\n');

  function apply() {
    var prev = document.getElementById(STYLE_ID);
    if (prev) prev.parentNode.removeChild(prev);
    var st = document.createElement('style');
    st.id = STYLE_ID;
    st.type = 'text/css';
    st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
    return st;
  }

  function revert() {
    var el = document.getElementById(STYLE_ID);
    if (el) { el.parentNode.removeChild(el); return true; }
    return false;
  }

  try { apply(); } catch (e) { /* non-fatal: never break the page */ }

  window.__mlsWhosNextCleanFix = {
    installed: true,
    version: VERSION,
    asset: 'feat_mls_whosnext_cleanfix.js',
    reapply: apply,
    revert: revert
  };
})();
