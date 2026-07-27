/* ============================================================================
 * feat_mls_recentpts.js  —  item73 (STAGING)
 * ----------------------------------------------------------------------------
 * "Recent patients" one-click quick-switcher in the visible patient context bar.
 *
 * WHY (doctor value): across a clinic day the doctor flips between charts
 * constantly. Today that means going back to the Patients list, scrolling,
 * finding them, clicking. This keeps a small rolling list of the charts they
 * actually opened this session and puts a "Recent" chip right in the
 * always-visible bar - one click to jump straight back to any of the last few
 * patients. Meaningfully fewer clicks, every switch.
 *
 * CONNECTIVE: observes the app's own active-patient source of truth
 * (getActivePtId) and switches via the same path the rest of the app uses
 * (setActivePtId + renderProfile/renderPatients/renderPatientBar/updateNavCounts).
 *
 * MOUNTING: prefers the visible #mlsCtxBar; falls back to legacy #patientBar.
 * GUARDRAILS: additive & reversible (window.__mlsRecentPts.revert()). Navigation
 * only - never creates/edits/deletes any record, note or appointment; never
 * touches athenaOne. Recent list is a localStorage cache of IDs the doctor
 * already opened (names read live from existing records). Self-contained IIFE.
 * ==========================================================================*/
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsRecentPts && window.__mlsRecentPts.__booted) return;

  var VERSION='rp-2.1.0'; /* layout-stable + indexed/event-driven patient switching */
  var WRAP_ID='mlsRecentPts', MENU_ID='mlsRecentPtsMenu', STYLE_ID='mlsRecentPts-style';
  var WRAP_STYLE_ID='mls-ctxbar-wrap-style', LS_KEY='mls_recent_pts_v1', MAX=6;
  var backTimer=null, origRenderBar=null, lastSeenId=null, obs=null, obsTarget=null;
  var lastCommitted=null;

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function lsKey(){try{if(typeof window.uns==='function')return window.uns('recent_pts');}catch(e){}return LS_KEY;}
  function loadIds(){try{var v=JSON.parse(localStorage.getItem(lsKey())||'[]');return Array.isArray(v)?v:[];}catch(e){return [];}}
  function saveIds(ids){try{localStorage.setItem(lsKey(),JSON.stringify(ids.slice(0,MAX)));}catch(e){}}
  function patients(){try{return (typeof window.getPatients==='function'?window.getPatients():[])||[];}catch(e){return [];}}
  function patientIndex(){var rows=patients(),byId=new Map();for(var i=0;i<rows.length;i++){var p=rows[i];if(p&&p.id!=null)byId.set(String(p.id),p);}return {rows:rows,byId:byId};}
  function ptById(id,index){if(!id)return null;var idx=index||patientIndex();return idx.byId.get(String(id))||null;}
  function activeId(){try{if(typeof window.getActivePtId==='function')return window.getActivePtId()||'';}catch(e){}return '';}
  function pushRecent(id){if(!id)return;var ids=loadIds().filter(function(x){return String(x)!==String(id);});ids.unshift(String(id));saveIds(ids);}

  function ensureWrapStyle(){if(document.getElementById(WRAP_STYLE_ID))return;try{var s=document.createElement('style');s.id=WRAP_STYLE_ID;s.textContent='#mlsCtxBar{flex-wrap:wrap;row-gap:6px;}';document.head.appendChild(s);}catch(e){}}

  function switchTo(id){
    try{var index=patientIndex(),patient=ptById(id,index);if(!patient)return;
      if(typeof window.setActivePtId==='function')window.setActivePtId(id);
      try{if(typeof window.renderProfile==='function')window.renderProfile();}catch(e){}
      try{if(typeof window.renderPatients==='function')window.renderPatients();}catch(e){}
      try{if(typeof window.renderPatientBar==='function')window.renderPatientBar();}catch(e){}
      var nm=patient.name||'patient';
      try{if(typeof window.toast==='function')window.toast('Switched to '+nm+'.','');}catch(e){}
      closeMenu();
    }catch(e){}
  }
  function closeMenu(){try{var m=document.getElementById(MENU_ID);if(m)m.remove();}catch(e){}}

  function openMenu(anchor){
    closeMenu();
    var cur=activeId();
    var index=patientIndex();
    var rows=loadIds().filter(function(id){return String(id)!==String(cur)&&ptById(id,index);});
    var menu=document.createElement('div');menu.id=MENU_ID;
    if(!rows.length){menu.innerHTML='<div class="mrp-empty">No other recent charts yet.<br>Open a few patients and they will show up here.</div>';}
    else{menu.innerHTML=rows.map(function(id){var p=ptById(id,index)||{};var meta=[p.sex,p.dob].filter(Boolean).join(' · ');
      return '<button type="button" class="mrp-item" data-id="'+esc(id)+'"><span class="mrp-nm">'+esc(p.name||'Patient')+'</span>'+(meta?'<span class="mrp-meta">'+esc(meta)+'</span>':'')+'</button>';}).join('');}
    document.body.appendChild(menu);
    try{var r=anchor.getBoundingClientRect();menu.style.top=Math.round(r.bottom+6)+'px';menu.style.left=Math.round(Math.min(r.left,window.innerWidth-250))+'px';}catch(e){}
    menu.querySelectorAll('.mrp-item').forEach(function(b){b.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();switchTo(b.getAttribute('data-id'));});});
    setTimeout(function(){document.addEventListener('mousedown',onDocClick,true);},0);
  }
  function onDocClick(ev){var m=document.getElementById(MENU_ID),w=document.getElementById(WRAP_ID);
    if(m&&!m.contains(ev.target)&&w&&!w.contains(ev.target)){closeMenu();document.removeEventListener('mousedown',onDocClick,true);}}

  function injectCss(){
    if(document.getElementById(STYLE_ID))return;
    try{var s=document.createElement('style');s.id=STYLE_ID;
      s.textContent=
        '#'+WRAP_ID+'{display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;min-width:118px;justify-content:flex-end;}'+
        '#'+WRAP_ID+' .mrp-btn{cursor:pointer;border:1px solid rgba(31,122,224,.34);background:rgba(31,122,224,.10);'+
        'color:#2E6A4B;font:inherit;font-size:12px;font-weight:600;padding:3px 11px;border-radius:999px;'+
        'display:inline-flex;align-items:center;gap:5px;white-space:nowrap;min-width:112px;justify-content:center;'+
        'font-variant-numeric:tabular-nums;}'+
        '#'+WRAP_ID+' .mrp-btn:hover:not([disabled]){background:rgba(31,122,224,.20);}'+
        '#'+WRAP_ID+' .mrp-btn[disabled]{opacity:.55;cursor:default;}'+
        '#'+MENU_ID+'{position:fixed;z-index:9600;min-width:200px;max-width:260px;background:#13283d;color:#fff;'+
        'border-radius:11px;padding:7px;box-shadow:0 12px 30px rgba(0,0,0,.36);}'+
        '#'+MENU_ID+' .mrp-item{display:flex;flex-direction:column;align-items:flex-start;width:100%;text-align:left;'+
        'background:none;border:0;color:#fff;font:inherit;cursor:pointer;padding:7px 9px;border-radius:8px;gap:1px;}'+
        '#'+MENU_ID+' .mrp-item:hover{background:rgba(255,255,255,.10);}'+
        '#'+MENU_ID+' .mrp-nm{font-weight:600;font-size:13px;}'+
        '#'+MENU_ID+' .mrp-meta{font-size:11px;color:#9fb2c6;}'+
        '#'+MENU_ID+' .mrp-empty{font-size:12px;color:#cdd9e6;padding:8px 10px;line-height:1.5;}'+
        'body.theme-dark #'+WRAP_ID+' .mrp-btn{color:#C9DCD2;}';
      document.head.appendChild(s);}catch(e){}
  }

  function visibleBar(){
    var ctx=document.getElementById('mlsCtxBar');
    if(ctx){try{var cs=getComputedStyle(ctx);if(cs.display!=='none'&&ctx.offsetParent!==null)return {bar:ctx,anchor:ctx.querySelector('.mlsctx-actions')||null};}catch(e){}}
    var pb=document.getElementById('patientBar');
    if(pb){try{if(pb.style.display!=='none'&&pb.offsetParent!==null){var inner=document.getElementById('patientBarInner');return {bar:pb,anchor:pb.querySelector('.spacer')||(inner?inner.nextSibling:null)};}}catch(e){}}
    return null;
  }

  function render(){
    try{
      var loc=visibleBar();
      var existing=document.getElementById(WRAP_ID);
      if(!loc){if(existing)existing.remove();detachObs();lastCommitted=null;return;}
      ensureWrapStyle();
      if(!existing){existing=document.createElement('span');existing.id=WRAP_ID;}
      if(existing.parentNode!==loc.bar){
        if(loc.anchor&&loc.anchor.parentNode===loc.bar) loc.bar.insertBefore(existing,loc.anchor);
        else loc.bar.appendChild(existing);
      }
      var cur=activeId();
      var ids=loadIds().filter(function(id){return String(id)!==String(cur);});
      var index=patientIndex();
      var hydrated=index.rows.length>0;
      var state;
      if(!hydrated&&ids.length){
        /* Patient store still hydrating: hold the last committed label so the
           chip never flashes through empty/partial counts mid-refresh. */
        state=lastCommitted||{n:0,ready:false};
      }else{
        var others=ids.filter(function(id){return !!ptById(id,index);});
        state={n:others.length,ready:others.length>0};
        lastCommitted=state;
      }
      var html=state.ready
        ?'<button type="button" class="mrp-btn" title="Jump back to a recent chart">↻ Recent ('+state.n+') ▾</button>'
        :'<button type="button" class="mrp-btn" disabled aria-disabled="true" title="Recent charts appear here once you open a few patients">↻ Recent ▾</button>';
      if(existing.innerHTML!==html) existing.innerHTML=html;
      var btn=existing.querySelector('.mrp-btn');
      if(btn&&!btn.__mlsRecentBound){btn.__mlsRecentBound=true;btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();
        if(btn.disabled)return;
        if(document.getElementById(MENU_ID)){closeMenu();}else{openMenu(existing);}});}
      attachObs(loc.bar);
    }catch(e){}
  }

  function attachObs(bar){try{if(obs&&obsTarget===bar)return;detachObs();obsTarget=bar;
    obs=new MutationObserver(function(){try{if(!document.getElementById(WRAP_ID))render();}catch(e){}});
    obs.observe(bar,{childList:true});}catch(e){}}
  function detachObs(){try{if(obs){obs.disconnect();obs=null;obsTarget=null;}}catch(e){}}

  function onPatientChanged(ev){try{var d=ev&&ev.detail,id=(d&&d.patientId)||activeId();if(id&&id!==lastSeenId){lastSeenId=id;pushRecent(id);render();}}catch(e){}}

  function wrapRenderBar(){try{if(typeof window.renderPatientBar==='function'&&!origRenderBar){
    origRenderBar=window.renderPatientBar;
    window.renderPatientBar=function(){var r;try{r=origRenderBar.apply(this,arguments);}catch(e){}try{render();}catch(e){}return r;};}}catch(e){}}

  function boot(){injectCss();wrapRenderBar();lastSeenId=activeId();if(lastSeenId)pushRecent(lastSeenId);render();
    try{window.removeEventListener('mls:active-patient-changed',onPatientChanged);window.addEventListener('mls:active-patient-changed',onPatientChanged);}catch(e){}
    if(!backTimer)backTimer=setInterval(render,15000);}

  window.__mlsRecentPts={
    __booted:true, rerender:render, list:loadIds,
    revert:function(){
      try{if(backTimer){clearInterval(backTimer);backTimer=null;}}catch(e){}
      try{window.removeEventListener('mls:active-patient-changed',onPatientChanged);}catch(e){}
      try{detachObs();}catch(e){}
      try{document.removeEventListener('mousedown',onDocClick,true);}catch(e){}
      try{if(origRenderBar){window.renderPatientBar=origRenderBar;origRenderBar=null;}}catch(e){}
      try{closeMenu();}catch(e){}
      try{var w=document.getElementById(WRAP_ID);if(w)w.remove();}catch(e){}
      try{var s=document.getElementById(STYLE_ID);if(s)s.remove();}catch(e){}
      try{delete window.__mlsRecentPts;}catch(e){window.__mlsRecentPts=undefined;}
    }
  };

  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(boot,600);});}
  else{setTimeout(boot,600);}
})();
