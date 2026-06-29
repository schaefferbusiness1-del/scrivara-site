/* feat_mls_appwidth_responsive.js   (STAGING)
 * App-wide responsive width.
 *
 * PROBLEM: the whole app sits in a centered, fixed ~1180px column
 * (.wrap{max-width:1180px} on <div id="appWrap" class="wrap">). On a big
 * monitor that leaves large empty bands left and right — wasted space.
 *
 * FIX (CSS only, additive, reversible): grow the app wrapper to
 *   max-width: min(1680px, 95vw)
 * so wide screens are used (capped at 1680px so text lines never get absurd),
 * while smaller screens fall back to ~95vw and keep the app's own existing
 * responsive breakpoints (920px .grid, 980px split panes, 600px mobile chrome)
 * that already collapse multi-column layouts to a single column. The inner
 * card grids that use repeat(auto-fill, minmax(...)) reflow to MORE columns as
 * the wrapper widens, so the extra width is genuinely used, not just stretched.
 *
 * CONFLICT-SAFE WITH THE CALENDAR WIDENER (item64 feat_mls_cal_fullwidth_providers
 * + item66 feat_mls_cal_provider_roster): those already widen #appWrap.wrap to
 * min(1680px,96vw) ONLY on the Calendar view, via the more-specific selector
 *   #appWrap.wrap:has(#calendarView[style*="block"])
 * This module deliberately EXCLUDES the Calendar view with
 *   #appWrap.wrap:not(:has(#calendarView[style*="block"]))
 * so the two rules can never match at the same time. Calendar keeps its own
 * 96vw; every other view gets 95vw. No double-apply, no fighting !important.
 *
 * Touches NO records, NO patient data, NO athenaOne. Pure stylesheet.
 *
 * Revert: window.__mlsAppWidth.revert()
 */
(function(){
  if (window.__mlsAppWidth && window.__mlsAppWidth.__on) return;

  var STYLE_ID = 'mls-appwidth-style';
  var timer = null;

  function buildCss(){
    return [
      /* ---- core: widen the app wrapper on every view EXCEPT calendar ---- */
      '#appWrap.wrap:not(:has(#calendarView[style*="block"])){',
      '  max-width:min(1680px,95vw)!important;',
      '}',

      /* ---- wide-screen reflow aids (only kick in on big viewports; smaller',
      '       screens are untouched so nothing can break/overlap there) ---- */
      '@media (min-width:1500px){',
      /* auto-fill card/library grids: give cards a slightly larger floor so the',
      '   extra width adds well-proportioned columns instead of thin ones */
      '  #appWrap .cw-lib-grid{grid-template-columns:repeat(auto-fill,minmax(240px,1fr));}',
      '}'
    ].join('\n');
  }

  function inject(){
    var s = document.getElementById(STYLE_ID);
    if(!s){
      s = document.createElement('style');
      s.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(s);
    }
    var css = buildCss();
    if(s.textContent !== css) s.textContent = css;
    /* keep it last so a re-injected base style can't quietly re-cap us */
    try{
      var head = document.head || document.documentElement;
      if(head && s.parentNode === head && head.lastChild !== s) head.appendChild(s);
    }catch(e){}
  }

  function install(){
    inject();
    /* the app re-renders views over time; re-assert the (idempotent) style
       occasionally in case another late style block re-adds the 1180 cap */
    timer = setInterval(function(){ try{ inject(); }catch(e){} }, 2000);
  }

  window.__mlsAppWidth = {
    __on: true,
    revert: function(){
      try{ var s=document.getElementById(STYLE_ID); if(s&&s.parentNode) s.parentNode.removeChild(s); }catch(e){}
      try{ if(timer) clearInterval(timer); }catch(e){}
      this.__on = false;
    }
  };

  if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', install); }
  else { install(); }
})();
