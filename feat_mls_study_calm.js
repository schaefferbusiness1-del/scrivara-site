/* =============================================================================
 * __mlsStudyCalm  sg2-1.0.0   (2026-07-13, owner directive: "Study thing under
 * AI Studio IS SO UGLY - redesign completely")
 * -----------------------------------------------------------------------------
 * ONE study surface instead of two stacked generations:
 *  - The advanced card (#mlsSgPro: auto-cohort + run-a-study) becomes the ONLY
 *    thing you see, restyled Editorial Calm.
 *  - The legacy strip (#mls-sg-root: named groups / manual add / CSV / pull)
 *    keeps every feature but collapses behind ONE quiet disclosure row:
 *    "Manage named groups & manual patient lists". No DOM moves, no re-wiring -
 *    just a sibling toggle + display, so all b39/b58 handlers stay intact.
 * Reversible: window.__mlsStudyCalm.revert(). ASCII-only.
 * ==========================================================================*/
(function () {
  'use strict';
  if (window.__mlsStudyCalm) return;
  var api = { version: 'sg2-1.0.0', installed: true };
  window.__mlsStudyCalm = api;
  var CSS_ID = 'mlsSg2Css', TOGGLE_ID = 'mlsSg2Toggle';

  function css() {
    if (document.getElementById(CSS_ID)) return;
    var st = document.createElement('style');
    st.id = CSS_ID;
    st.textContent = [
      /* legacy strip: hidden until asked for; its shouty label retires */
      '#mls-sg-root{display:none !important;}',
      'body.sg2-open #mls-sg-root{display:block !important;}',
      '#mls-sg-root .stp-sg-lbl{display:none !important;}',
      /* the disclosure row */
      '#' + TOGGLE_ID + '{display:flex;align-items:center;gap:8px;width:100%;margin:14px 0 0;background:transparent;',
      '  border:1px dashed #D9D6CD;border-radius:12px;color:#55605A;font-size:13px;font-weight:600;cursor:pointer;padding:11px 14px;text-align:left;}',
      '#' + TOGGLE_ID + ':hover{background:#F4F2EC;color:#1A211C;}',
      '#' + TOGGLE_ID + ' .car{transition:transform .15s ease;display:inline-block;}',
      'body.sg2-open #' + TOGGLE_ID + ' .car{transform:rotate(90deg);}',
      /* advanced card, calm */
      '#mlsSgPro{background:#fff !important;border:1px solid #E7E5DD !important;border-radius:16px !important;padding:18px 20px !important;}',
      '#mlsSgPro h4{font-family:"Newsreader",Georgia,serif !important;font-weight:600 !important;font-size:17px !important;letter-spacing:-.01em;color:#1A211C !important;margin:0 0 10px !important;}',
      '#mlsSgPro input[type=text],#mlsSgPro input:not([type]),#mlsSgPro select{background:#FCFBF8 !important;border:1px solid #E4E1D8 !important;border-radius:10px !important;color:#1A211C !important;padding:9px 12px !important;font-size:13.5px !important;}',
      '#mlsSgPro button{border-radius:10px !important;font-weight:700 !important;}',
      /* the purple by-procedure button joins the family */
      '#mlsSgPro button[style*="7c3aed"],#mlsSgPro button[style*="8b5cf6"],#mlsSgPro .sgp-build{background:#204034 !important;border-color:#204034 !important;color:#fff !important;}',
      /* legacy strip cards, calm when opened */
      '#mls-sg-root .mls-sg-wrap, #mls-sg-root{background:transparent;}',
      '#mls-sg-root [class*=card], #mls-sg-root > div > div{border-radius:14px;}',
      '#mls-sg-root input,#mls-sg-root select,#mls-sg-root textarea{background:#FCFBF8 !important;border:1px solid #E4E1D8 !important;border-radius:10px !important;color:#1A211C !important;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  function ensure() {
    css();
    var root = document.getElementById('mls-sg-root');
    if (!root) return;
    var existing = document.getElementById(TOGGLE_ID);
    if (existing) {
      /* the toggle can be born before #mlsSgPro renders - adopt it once the
         advanced card exists so it never floats as a lone grid cell */
      var pro0 = document.getElementById('mlsSgPro');
      if (pro0 && existing.parentElement !== pro0) pro0.appendChild(existing);
      return;
    }
    var t = document.createElement('button');
    t.type = 'button'; t.id = TOGGLE_ID;
    t.innerHTML = '<span class="car">&#9656;</span> Manage named groups &amp; manual patient lists <span style="color:var(--muted);font-weight:500">(add by name/DOB or import a reviewed CSV/JSON file)</span>';
    t.addEventListener('click', function () { document.body.classList.toggle('sg2-open'); });
    /* live INSIDE the advanced card - as a bare grid child the studio sx-grid
       stretched the lone toggle into a giant empty "card" cell */
    var pro = document.getElementById('mlsSgPro');
    if (pro) pro.appendChild(t);
    else root.parentElement.insertBefore(t, root);
  }

  var n = 0;
  var iv = setInterval(function () { try { ensure(); } catch (e) {} if (++n > 30) clearInterval(iv); }, 900);
  try { ensure(); } catch (e) {}

  api.revert = function () {
    try { clearInterval(iv); } catch (e) {}
    try { var s = document.getElementById(CSS_ID); if (s) s.remove(); } catch (e) {}
    try { var t = document.getElementById(TOGGLE_ID); if (t) t.remove(); } catch (e) {}
    try { document.body.classList.remove('sg2-open'); } catch (e) {}
    api.installed = false; delete window.__mlsStudyCalm;
  };
})();
