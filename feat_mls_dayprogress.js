/* ============================================================================
 * feat_mls_dayprogress.js  —  item72 (STAGING)
 * ----------------------------------------------------------------------------
 * "Day Progress" meter pinned into the visible patient context bar.
 *
 * WHY (doctor value + connective): the app already knows today's pulled
 * schedule, who has been seen, and who is "up now" - but that truth only lives
 * down in the Visit screen's NEXT-UP picker. This surfaces the SAME single
 * source of truth into the always-visible patient context bar, so wherever the
 * doctor is they see at a glance:  "3 / 12 seen today - Next 2:40p J. Doe"
 * and can click it to load that next patient - reusing the existing
 * _heroPickPatient handler. One source of truth, one shared action.
 *
 * HONEST SOURCING (no invented numbers):
 *   total  = today's appointments with a name  (window._heroTodayList)
 *   seen   = those for which the app's own _seenToday(name) is true
 *   nextUp = the app's own _calPickNowIdx(appts) "up now / next" choice
 *   If the schedule has not been pulled the meter hides itself.
 *
 * MOUNTING: prefers the visible redesigned context bar (#mlsCtxBar); falls back
 * to the legacy #patientBar. Lets the context bar wrap (shared idempotent style)
 * so chips never overlap or get cut off. A scoped observer on the bar re-mounts
 * the chip if the bar re-renders.
 *
 * GUARDRAILS: additive & reversible (window.__mlsDayProgress.revert()).
 * Display + navigation only - never writes/edits/deletes any record, note,
 * roster entry or appointment; never touches athenaOne. Self-contained IIFE,
 * try/catch throughout.
 * ==========================================================================*/
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsDayProgress && window.__mlsDayProgress.__booted) return;

  var WRAP_ID = 'mlsDayProgress';
  var STYLE_ID = 'mlsDayProgress-style';
  var WRAP_STYLE_ID = 'mls-ctxbar-wrap-style';
  var timer = null, origRenderBar = null, obs = null, obsTarget = null;

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  function ensureWrapStyle(){
    if (document.getElementById(WRAP_STYLE_ID)) return;
    try{var s=document.createElement('style');s.id=WRAP_STYLE_ID;
      s.textContent='#mlsCtxBar{flex-wrap:wrap;row-gap:6px;}';
      document.head.appendChild(s);}catch(e){}
  }

  function injectCss(){
    if (document.getElementById(STYLE_ID)) return;
    try{
      var s=document.createElement('style');s.id=STYLE_ID;
      s.textContent=
        '#'+WRAP_ID+'{display:inline-flex;align-items:center;gap:7px;margin-left:10px;'+
        'padding:3px 10px;border-radius:999px;background:rgba(31,122,224,.12);'+
        'border:1px solid rgba(31,122,224,.32);font-size:12px;line-height:1.2;'+
        'color:#1E2B24;vertical-align:middle;}'+
        '#'+WRAP_ID+' .mdp-bar{position:relative;width:44px;height:6px;border-radius:4px;'+
        'background:rgba(12,44,77,.16);overflow:hidden;flex:0 0 auto;}'+
        '#'+WRAP_ID+' .mdp-fill{position:absolute;left:0;top:0;bottom:0;width:0;'+
        'background:linear-gradient(90deg,#2E6A4B,#27c98f);transition:width .3s ease;}'+
        '#'+WRAP_ID+' .mdp-txt{font-weight:600;white-space:nowrap;}'+
        '#'+WRAP_ID+' .mdp-next{display:inline-flex;align-items:center;gap:4px;'+
        'cursor:pointer;border:0;background:none;color:#2E6A4B;font:inherit;font-weight:600;'+
        'padding:2px 4px;border-radius:6px;white-space:nowrap;}'+
        '#'+WRAP_ID+' .mdp-next:hover{background:rgba(31,122,224,.16);text-decoration:underline;}'+
        'body.theme-dark #'+WRAP_ID+'{color:#dbe8f6;}'+
        'body.theme-dark #'+WRAP_ID+' .mdp-next{color:#C9DCD2;}';
      document.head.appendChild(s);
    }catch(e){}
  }

  function visibleBar(){
    // Returns {bar, anchor} for the visible context bar, or null.
    /* b742: the ACTIVE-PATIENT bar (#mlsCtxBar) is no longer a mount point.
       Owner 2026-07-27, on the seen/remaining + "Next 1:40 PM" line this chip
       put there: the active-patient banner carries the patient and nothing
       else. Returning null while that bar is up makes render() remove the chip
       and detach its observer rather than keep re-rendering something the
       banner's allowlist would hide anyway. The legacy no-active-patient
       #patientBar below is UNCHANGED — starting the day with no chart open,
       the day meter still shows there. */
    var pb=document.getElementById('patientBar');
    if (pb){ try{ if(pb.style.display!=='none' && pb.offsetParent!==null){
      var inner=document.getElementById('patientBarInner');
      return {bar:pb, anchor:pb.querySelector('.spacer')||(inner?inner.nextSibling:null)}; } }catch(e){} }
    return null;
  }

  function appts(){try{var a=window._heroTodayList||[];if(!Array.isArray(a))return [];
    return a.filter(function(x){if(!(x&&String(x.name||'').trim()))return false;
      /* b254: owner-marked staff (office-manager blocks) never count in the day strip */
      try{if(window.__mlsStaffMark&&window.__mlsStaffMark.isStaff(x.name))return false;}catch(eSm){}
      return true;});}catch(e){return [];}}
  function seenOf(list){var n=0;if(typeof window._seenToday!=='function')return null;
    list.forEach(function(a){try{if(window._seenToday(a.name))n++;}catch(e){}});return n;}
  function nextIdx(list){try{if(typeof window._calPickNowIdx==='function'){var i=window._calPickNowIdx(list);
    if(typeof i==='number'&&i>=0)return i;}}catch(e){}return -1;}
  function shortName(nm){var p=String(nm||'').trim().split(/\s+/);if(!p.length||!p[0])return 'patient';
    if(p.length===1)return p[0];return p[0]+' '+(p[p.length-1][0]||'')+'.';}
  /* The label must use the same practice-timezone instant as nextIdx(). Thin
     hero rows are resolved only through the site's exact identity matcher; a
     duplicate-name schedule is never resolved with a first/prefix guess. */
  function h12(hm){var m=String(hm||'').match(/(?:^|T|\s)(\d\d?):(\d\d)/);if(!m)return '';var h=+m[1],ap=h>=12?'PM':'AM';h=h%12||12;return h+':'+m[2]+' '+ap;}
  function apptTime(a){
    try{
      a=a||{};
      var day=(typeof window._acctTodayKey==='function')?window._acctTodayKey():'';
      var rows=(typeof window._apptScheduleCandidates==='function')?window._apptScheduleCandidates(a,window._calAppts||[],day):[];
      var hit=(typeof window._findCanonicalScheduleAppt==='function')?window._findCanonicalScheduleAppt(a,window._calAppts||[],day):null;
      var source=hit||a;
      if(!hit && rows.length>1 && !a.start_at && !a.start_local && !/[ap]\.?\s*\.?m/i.test(String(a.time||''))) return '';
      if(typeof window._apptDisplayTime==='function')return window._apptDisplayTime(source)||'';
      if(source.start_at&&typeof window._fmtApptTime==='function'){var z=window._fmtApptTime(source.start_at);if(z)return z;}
      if(source.start_local){var s=h12(source.start_local);if(s)return s;}
      var t=String(source.time_display||source.time||'');
      if(typeof window._fmtApptTime==='function')return window._fmtApptTime(t)||'';
      return h12(t)||t;
    }catch(e){return String((a&&a.time)||'');}
  }

  function jumpNext(){
    try{var list=appts();if(!list.length)return;var idx=nextIdx(list);if(idx<0)idx=0;
      var orig=window._heroTodayList.indexOf(list[idx]);if(orig<0)orig=idx;
      if(typeof window._heroPickPatient==='function'){window._heroPickPatient(orig);}
      else if(typeof window.showView==='function'){window.showView('visit');}
      try{if(typeof window.showView==='function'&&window.currentView!=='visit')window.showView('visit');}catch(e){}
    }catch(e){}
  }

  function render(){
    try{
      var loc=visibleBar();
      var existing=document.getElementById(WRAP_ID);
      var list=appts();
      if(!loc||!list.length){ if(existing)existing.remove(); detachObs(); return; }
      ensureWrapStyle();

      var total=list.length, seen=seenOf(list), idx=nextIdx(list), nextA=idx>=0?list[idx]:null;
      var pct=(seen!=null&&total)?Math.round((seen/total)*100):0;
      var txt=(seen!=null)?(seen+' / '+total+' seen'):(total+' today');
      var nextHtml='';
      if(nextA){var t=apptTime(nextA);
        nextHtml='<button type="button" class="mdp-next" title="Load this patient (Up now / next)">Next '+(t?(esc(t)+' '):'')+esc(shortName(nextA.name))+'</button>';}
      var html='<span class="mdp-bar"><span class="mdp-fill" style="width:'+pct+'%"></span></span>'+
        '<span class="mdp-txt" title="Today pulled schedule">'+esc(txt)+'</span>'+nextHtml;

      if(!existing){existing=document.createElement('span');existing.id=WRAP_ID;}
      if(existing.parentNode!==loc.bar){
        if(loc.anchor&&loc.anchor.parentNode===loc.bar) loc.bar.insertBefore(existing,loc.anchor);
        else loc.bar.appendChild(existing);
      }
      if(existing.innerHTML!==html) existing.innerHTML=html;
      var btn=existing.querySelector('.mdp-next');
      if(btn&&!btn.__mlsDayProgressBound){btn.__mlsDayProgressBound=true;btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();jumpNext();});}
      attachObs(loc.bar);
    }catch(e){}
  }

  function attachObs(bar){
    try{
      if(obs&&obsTarget===bar) return;
      detachObs();
      obsTarget=bar;
      obs=new MutationObserver(function(){
        try{ if(!document.getElementById(WRAP_ID)){ render(); } }catch(e){}
      });
      obs.observe(bar,{childList:true});
    }catch(e){}
  }
  function detachObs(){try{if(obs){obs.disconnect();obs=null;obsTarget=null;}}catch(e){}}

  function wrapRenderBar(){
    try{if(typeof window.renderPatientBar==='function'&&!origRenderBar){
      origRenderBar=window.renderPatientBar;
      window.renderPatientBar=function(){var r;try{r=origRenderBar.apply(this,arguments);}catch(e){}try{render();}catch(e){}return r;};
    }}catch(e){}
  }

  function boot(){injectCss();wrapRenderBar();render();if(!timer)timer=setInterval(render,15000);}

  window.__mlsDayProgress={
    __booted:true, rerender:render, _displayTime:apptTime,
    revert:function(){
      try{if(timer){clearInterval(timer);timer=null;}}catch(e){}
      try{detachObs();}catch(e){}
      try{if(origRenderBar){window.renderPatientBar=origRenderBar;origRenderBar=null;}}catch(e){}
      try{var w=document.getElementById(WRAP_ID);if(w)w.remove();}catch(e){}
      try{var s=document.getElementById(STYLE_ID);if(s)s.remove();}catch(e){}
      try{delete window.__mlsDayProgress;}catch(e){window.__mlsDayProgress=undefined;}
    }
  };

  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(boot,500);});}
  else{setTimeout(boot,500);}
})();
