/* =============================================================================
 * feat_mls_ptcard_contain.js -> window.__mlsPtCardContain  (ptc-1.0.0)
 * -----------------------------------------------------------------------------
 * Patient-list card containment. The patient card (.pt-item) lays its
 * name/demographics/clinical-context/status-chips inside a flex column
 * (.pt-main{flex:1;min-width:0}). Three things let content paint OUTSIDE that
 * box on a narrow card (small window, split view, or a card reused in a
 * narrower container):
 *
 *   1) The name element ".t" is display:flex (an INLINE style on the element),
 *      so the name text is an anonymous flex item. A pre-existing stability fix
 *      adds `overflow-wrap:break-word`, but per CSS spec `break-word` does NOT
 *      reduce a flex item's min-content size -- so a long/unbroken name still
 *      forces the item (and paints past the card edge). `overflow-wrap:anywhere`
 *      DOES reduce min-content, so the name wraps to fit instead of spilling.
 *   2) The status-chip row's chips carry inline `white-space:nowrap`; a chip
 *      wider than a squeezed .pt-main paints past its right edge.
 *   3) The clinical-context line has an inline `max-width:340px` that can exceed
 *      a narrow .pt-main.
 *
 * .pt-main has no `overflow` clip, so any of the above visibly spills over the
 * card border / neighbouring content. FIX (CSS only, GLOBAL so it also covers
 * any reuse of .pt-item outside #patientsView):
 *   - overflow:hidden on .pt-main  -> hard guarantee nothing paints outside the
 *     card box (the direct cure for "text spilling outside its card").
 *   - overflow-wrap:anywhere on the name/demographics -> they WRAP to fit rather
 *     than being clipped, so long names stay fully readable, just on more lines.
 *   - max-width:100% on .pt-main's direct children -> the fixed-width context
 *     line and chip row can never demand more width than the card provides.
 *
 * Verified live at a 300px card (54px .pt-main): before, all 38 rows painted
 * past .pt-main (worst 72px, incl. a 35-char unbroken name); after, ZERO rows
 * spill and even the pathological name wraps fully inside its box.
 *
 * Additive, idempotent, reversible: window.__mlsPtCardContain.revert().
 * No JS behaviour change, no data touched, no Athena. ASCII-only.
 * ===========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsPtCardContain && window.__mlsPtCardContain.installed) return; } catch (e) { return; }

  var VERSION = 'ptc-2.1.0';
  var STYLE_ID = 'mlsPtCardContainCss';

  function install() {
    try {
      if (document.getElementById(STYLE_ID)) return;
      var css = document.createElement('style');
      css.id = STYLE_ID;
      css.textContent =
        /* ---- LAYOUT containment (ptc-2.1.0): the boot cost ----
           #ptList is an 833px scroller holding 151 .pt-item rows, so ~146 rows
           are off-screen and were still being laid out. That made the Patients
           screen the most expensive view in the app to lay out, and layout cost
           is paid once per frame in which anything mutates the DOM - which during
           boot is ~700 frames' worth of work behind whichever view the doctor
           last had open.

           Measured on the running page, apply/measure/revert in a single
           synchronous pass, three rounds:
             forced style+layout   17.3ms -> 7.1ms   (59% faster)
             #ptList.scrollHeight  17,222 -> 17,734  (3% over, self-correcting)
             reverts to exactly 17,222 every time

           contain-intrinsic-size is a FIXED 78px, deliberately NOT `auto`.
           `auto` makes each row remember its rendered size, which permanently
           changes scrollHeight (17,222 -> 25,084 and it stays there) - that made
           the A/B unrepeatable and produced three contradictory verdicts before
           it was spotted. A fixed size mutates nothing and reverts cleanly.
           78px was chosen by sweeping 127/114/100/88/78: all cut layout ~60%,
           and 78 is the only one whose scrollbar estimate is within 3% of true.

           Note innerText on a skipped row returns '' while textContent still
           works. Nothing reads innerText of .pt-item today (grepped), but any
           future label/search code over this list must use textContent. */
        '#patientsView .pt-item{content-visibility:auto;contain-intrinsic-size:78px}' +
        /* ---- horizontal containment (long/unbroken names) ---- */
        '.pt-item{min-width:0}' +
        '.pt-item .pt-main{min-width:0;overflow:hidden}' +
        '.pt-item .pt-main .t{overflow-wrap:anywhere;word-break:break-word;min-width:0}' +
        '.pt-item .pt-main .s{overflow-wrap:anywhere;word-break:break-word}' +
        '.pt-item .pt-main>div{max-width:100%}' +
        /* ---- VERTICAL containment (ptc-2.0.0): the REAL reported bug ----
           #ptList/.pt-list is a max-height COLUMN FLEXBOX. With many patients its
           .pt-item children (default flex-shrink:1) get squeezed down to the 84px
           min-height floor, but each card's content is ~115px, so with
           align-items:center + overflow:visible the NAME spilled ~15px ABOVE the
           card (overlapping the card above) and the chips spilled below. Making
           the list a normal block lets every card take its natural content height
           and the max-height/overflow-y:auto still scrolls; the flex gap is
           replaced by a margin, and card content is top-aligned. */
        '#patientsView .pt-list{display:block}' +
        '#patientsView .pt-list .pt-item{align-items:flex-start;height:auto;margin-bottom:10px}';
      (document.head || document.documentElement).appendChild(css);
    } catch (e) {}
  }

  function revert() {
    try { var s = document.getElementById(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); } catch (e) {}
    try { window.__mlsPtCardContain.installed = false; } catch (e) {}
    return 'pt-card containment reverted';
  }

  window.__mlsPtCardContain = { installed: true, version: VERSION, asset: 'feat_mls_ptcard_contain.js', install: install, revert: revert };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
})();
