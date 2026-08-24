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
 * (getActivePtId) and switches through canonical selectPatient() when present,
 * with the original render sequence retained for older hosts.
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

  var VERSION='rp-2.4.0'; /* identity-safe chart switch + exact-event/visible-data refresh */
  var WRAP_ID='mlsRecentPts', MENU_ID='mlsRecentPtsMenu', STYLE_ID='mlsRecentPts-style';
  var WRAP_STYLE_ID='mls-ctxbar-wrap-style', LS_KEY='mls_recent_pts_v1', MAX=6;
  var renderFrame=0, renderNeedsData=false, idleRefresh=0, idleRefreshKind='', idleDataDirty=false;
  var lastSeenId=null, obs=null, obsTarget=null;
  var lastCommitted=null, lastIndex=null, listeners=[], bootTimer=null, readyListener=null;
  var started=false, stopped=false;

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function lsKey(){try{if(typeof window.uns==='function')return window.uns('recent_pts');}catch(e){}return LS_KEY;}
  function loadIds(){try{var v=JSON.parse(localStorage.getItem(lsKey())||'[]');return Array.isArray(v)?v:[];}catch(e){return [];}}
  function saveIds(ids){try{localStorage.setItem(lsKey(),JSON.stringify(ids.slice(0,MAX)));}catch(e){}}
  function patients(){try{return (typeof window.getPatients==='function'?window.getPatients():[])||[];}catch(e){return [];}}
  function patientIndex(){var rows=patients(),byId=new Map();for(var i=0;i<rows.length;i++){var p=rows[i];if(p&&p.id!=null)byId.set(String(p.id),p);}var index={rows:rows,byId:byId};if(rows.length)lastIndex=index;return index;}
  function ptById(id,index){if(!id)return null;var idx=index||patientIndex();return idx.byId.get(String(id))||null;}
  function activeId(){try{if(typeof window.getActivePtId==='function')return window.getActivePtId()||'';}catch(e){}return '';}
  function pushRecent(id){if(!id)return;var ids=loadIds().filter(function(x){return String(x)!==String(id);});ids.unshift(String(id));saveIds(ids);}
  function pageVisible(){try{if(typeof document.hidden==='boolean')return !document.hidden;if(document.visibilityState)return document.visibilityState!=='hidden';}catch(e){}return true;}
  function activeStorageKey(){try{return typeof window.uns==='function'?String(window.uns('activePt')||''):'';}catch(e){return '';}}
  function patientStorageKey(){try{return typeof window.uns==='function'?String(window.uns('patients')||''):'';}catch(e){return '';}}

  function ensureWrapStyle(){if(document.getElementById(WRAP_STYLE_ID))return;try{var s=document.createElement('style');s.id=WRAP_STYLE_ID;s.textContent='#mlsCtxBar{flex-wrap:wrap;row-gap:6px;}';document.head.appendChild(s);}catch(e){}}

  function switchTo(id){
    try{var cached=!!lastIndex,index=lastIndex||patientIndex(),patient=ptById(id,index);if(!patient&&cached){index=patientIndex();patient=ptById(id,index);}if(!patient)return;
      if(typeof window.selectPatient==='function')window.selectPatient(id);
      else{
        if(typeof window.setActivePtId==='function')window.setActivePtId(id);
        try{if(typeof window.renderProfile==='function')window.renderProfile();}catch(e){}
        try{if(typeof window.renderPatients==='function')window.renderPatients();}catch(e){}
        try{if(typeof window.renderPatientBar==='function')window.renderPatientBar();}catch(e){}
      }
      /* A Recent click means "open this chart", not "silently replace the
         patient underneath the visit currently on screen".  Staying on the
         Visit route can leave its schedule-card DOM bound to the prior
         appointment while the global patient chip already shows the newly
         selected patient.  Route to the canonical patient chart immediately
         so one screen can never display two patient identities. */
      try{if(typeof window.showView==='function')window.showView('patients');}catch(e){}
      var nm=patient.name||'patient';
      try{if(typeof window.toast==='function')window.toast('Switched to '+nm+'.','');}catch(e){}
      closeMenu();
    }catch(e){}
  }
  function closeMenu(){try{var m=document.getElementById(MENU_ID);if(m)m.remove();}catch(e){}}

  function openMenu(anchor){
    closeMenu();
    var cur=activeId();
    var index=lastIndex||patientIndex();
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

  function render(readRoster){
    try{
      if(!pageVisible()){if(readRoster)renderNeedsData=true;return;}
      var loc=visibleBar();
      var existing=document.getElementById(WRAP_ID);
      if(!loc){if(existing)existing.remove();detachObs();return;}
      ensureWrapStyle();
      if(!existing){existing=document.createElement('span');existing.id=WRAP_ID;}
      if(existing.parentNode!==loc.bar){
        if(loc.anchor&&loc.anchor.parentNode===loc.bar) loc.bar.insertBefore(existing,loc.anchor);
        else loc.bar.appendChild(existing);
      }
      var cur=activeId();
      var ids=loadIds().filter(function(id){return String(id)!==String(cur);});
      var state=lastCommitted||{n:0,ready:false};
      if(readRoster){
        cancelIdleRefresh();idleDataDirty=false;
        var index=patientIndex();
        var hydrated=index.rows.length>0;
        if(!hydrated&&ids.length){
          /* Patient store still hydrating: hold the last committed label so the
             chip never flashes through empty/partial counts mid-refresh. */
          state=lastCommitted||{n:0,ready:false};
        }else{
          var others=ids.filter(function(id){return !!ptById(id,index);});
          state={n:others.length,ready:others.length>0};
          lastCommitted=state;
        }
      }else if(lastIndex){
        /* Cross-tab active-id changes can repaint from the last known index
           without touching the invalidated patient-store codec. Idle/visible
           reconciliation below replaces this cached answer with fresh data. */
        var cachedOthers=ids.filter(function(id){return !!ptById(id,lastIndex);});
        state={n:cachedOthers.length,ready:cachedOthers.length>0};
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

  /* Exact data signals may request one roster refresh. Route/layout signals
     only remount the cached chip, so visual navigation can never cold-decode
     the patient store. Hidden tabs remember dirty data and reconcile once on
     return instead of competing with the active tab. */
  function scheduleRender(readRoster){
    if(stopped)return;
    if(readRoster)renderNeedsData=true;
    if(!pageVisible())return;
    if(renderFrame)return;
    renderFrame=-1;
    var id=setTimeout(function(){var withData=renderNeedsData;renderFrame=0;renderNeedsData=false;render(withData);},40);
    if(renderFrame===-1)renderFrame=id||1;
  }
  function cancelScheduledRender(){
    if(!renderFrame)return;
    try{if(renderFrame!==-1)clearTimeout(renderFrame);}catch(e){}
    renderFrame=0;renderNeedsData=false;
  }

  function inputPending(){
    try{return !!(window.navigator&&window.navigator.scheduling&&typeof window.navigator.scheduling.isInputPending==='function'&&window.navigator.scheduling.isInputPending());}
    catch(e){return false;}
  }
  function cancelIdleRefresh(){
    if(!idleRefresh)return;
    try{if(idleRefreshKind==='idle'&&typeof window.cancelIdleCallback==='function')window.cancelIdleCallback(idleRefresh);else clearTimeout(idleRefresh);}catch(e){}
    idleRefresh=0;idleRefreshKind='';
  }
  function scheduleIdleRefresh(){
    if(stopped)return;
    idleDataDirty=true;
    if(!pageVisible()||idleRefresh)return;
    function run(deadline){
      idleRefresh=0;idleRefreshKind='';
      if(stopped||!idleDataDirty)return;
      if(!pageVisible()||inputPending()||(deadline&&!deadline.didTimeout&&typeof deadline.timeRemaining==='function'&&deadline.timeRemaining()<4)){
        scheduleIdleRefresh();return;
      }
      idleDataDirty=false;render(true);
    }
    try{
      if(typeof window.requestIdleCallback==='function'){
        idleRefreshKind='idle';idleRefresh=window.requestIdleCallback(run);return;
      }
    }catch(e){}
    /* Older hosts get a timer only when they expose Chrome's input-pending
       signal; without either idle primitive, cached UI waits for visibility. */
    try{
      if(window.navigator&&window.navigator.scheduling&&typeof window.navigator.scheduling.isInputPending==='function'){
        idleRefreshKind='timer';idleRefresh=setTimeout(function(){run({didTimeout:true,timeRemaining:function(){return 0;}});},250);
      }
    }catch(e){}
  }

  function attachObs(bar){try{if(obs&&obsTarget===bar)return;detachObs();obsTarget=bar;
    obs=new MutationObserver(function(){try{if(!document.getElementById(WRAP_ID))scheduleRender(false);}catch(e){}});
    obs.observe(bar,{childList:true});}catch(e){}}
  function detachObs(){try{if(obs){obs.disconnect();obs=null;obsTarget=null;}}catch(e){}}

  function listen(target,name,fn){try{target.addEventListener(name,fn,false);listeners.push({target:target,name:name,fn:fn});}catch(e){}}
  function unlisten(){for(var i=0;i<listeners.length;i++){var row=listeners[i];try{row.target.removeEventListener(row.name,row.fn,false);}catch(e){}}listeners=[];}
  function exactRecord(ev){
    try{
      var d=ev&&ev.detail;if(!d)return;
      if(d.patientStoreKey&&typeof window.uns==='function'&&String(d.patientStoreKey)!==String(window.uns('patients')||''))return;
      var id=String(d.patientId||'');if(!id)return;
      var relevant=id===String(activeId()||'')||loadIds().some(function(x){return String(x)===id;});
      if(relevant)scheduleRender(true);
    }catch(e){}
  }
  function onPatientChanged(ev,deferData){try{var d=ev&&ev.detail,id=String((d&&d.patientId)||activeId()||'');if(id===String(lastSeenId||''))return;lastSeenId=id;if(id)pushRecent(id);if(deferData){scheduleRender(false);scheduleIdleRefresh();}else scheduleRender(true);}catch(e){}}
  function onViewChanged(){scheduleRender(false);}
  function onSessionBoundary(){lastSeenId=String(activeId()||'');lastCommitted=null;lastIndex=null;if(lastSeenId)pushRecent(lastSeenId);scheduleRender(false);scheduleIdleRefresh();}
  function onVisibility(){if(pageVisible()){cancelIdleRefresh();renderNeedsData=false;scheduleRender(false);scheduleIdleRefresh();}}
  function onStorage(ev){
    try{
      if(!ev)return;
      if(ev.storageArea&&window.localStorage&&ev.storageArea!==window.localStorage)return;
      var key=ev.key==null?'':String(ev.key);
      if(key&&key===activeStorageKey()){onPatientChanged({detail:{patientId:activeId()}},true);return;}
      if(key&&key===String(lsKey())){scheduleRender(false);scheduleIdleRefresh();}
      if(key&&key===patientStorageKey()){
        /* Cross-tab rename/delete has no row event in this tab. Mark cached
           metadata dirty, but reconcile only at genuine idle so the storage
           callback and first-click lane never decode the roster. */
        scheduleIdleRefresh();
      }
    }catch(e){}
  }
  function bind(){
    listen(window,'mls:active-patient-changed',onPatientChanged);
    listen(window,'mls:patient-record-updated',exactRecord);
    listen(window,'mls:view-changed',onViewChanged);
    listen(window,'mls:session-boundary',onSessionBoundary);
    listen(window,'mls:ui-ready',function(){scheduleRender(false);scheduleIdleRefresh();});
    listen(window,'mls:loader-ready',function(){scheduleRender(false);scheduleIdleRefresh();});
    listen(window,'storage',onStorage);
    listen(document,'visibilitychange',onVisibility);
  }

  function boot(){if(started||stopped)return;started=true;injectCss();bind();lastSeenId=String(activeId()||'');if(lastSeenId)pushRecent(lastSeenId);render(false);scheduleIdleRefresh();}

  window.__mlsRecentPts={
    __booted:true, rerender:function(){render(true);}, list:loadIds,
    revert:function(){
      stopped=true;
      try{if(bootTimer){clearTimeout(bootTimer);bootTimer=null;}}catch(e){}
      try{if(readyListener)document.removeEventListener('DOMContentLoaded',readyListener,false);}catch(e){}
      try{cancelScheduledRender();}catch(e){}
      try{cancelIdleRefresh();idleDataDirty=false;}catch(e){}
      try{unlisten();}catch(e){}
      try{detachObs();}catch(e){}
      try{document.removeEventListener('mousedown',onDocClick,true);}catch(e){}
      try{closeMenu();}catch(e){}
      try{var w=document.getElementById(WRAP_ID);if(w)w.remove();}catch(e){}
      try{var s=document.getElementById(STYLE_ID);if(s)s.remove();}catch(e){}
      try{delete window.__mlsRecentPts;}catch(e){window.__mlsRecentPts=undefined;}
    }
  };

  function queueBoot(){if(stopped||bootTimer)return;bootTimer=setTimeout(function(){bootTimer=null;boot();},600);}
  if(document.readyState==='loading'){readyListener=function(){readyListener=null;queueBoot();};document.addEventListener('DOMContentLoaded',readyListener,false);}
  else{queueBoot();}
})();
