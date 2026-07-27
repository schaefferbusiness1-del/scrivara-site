/* ============================================================================
 * feat_mls_ptsnapshot.js  —  item74 (STAGING)
 * ----------------------------------------------------------------------------
 * "Patient snapshot" - a one-click at-a-glance card + quick actions reachable
 * from the visible patient context bar on every clinical view.
 *
 * WHY (doctor value + connective): the app already builds a compact quick
 * history (visit count, last seen, last pain, active problems) for the
 * bottom-left patient "face". This adds a clear "Snapshot" chip in the context
 * bar that opens that SAME quick history right where the doctor is looking, plus
 * two safe shortcut actions - "Open chart" and "Start visit" - so the most
 * common next steps for the active patient are one click away from any surface.
 *
 * CONNECTIVE: reuses the app's own _patientQuickHistory(p) builder (one
 * consistent snapshot everywhere) and activePatient() source of truth, and
 * triggers actions through existing app functions (showView, goNewVisitForPatient).
 *
 * MOUNTING: prefers the visible #mlsCtxBar; falls back to legacy #patientBar.
 * GUARDRAILS: additive & reversible (window.__mlsPtSnapshot.revert()). Read +
 * navigation only - never creates/edits/deletes any record, note or appointment;
 * never touches athenaOne. "Start visit" calls the app's own existing
 * goNewVisitForPatient (same as the chart's button). Self-contained IIFE.
 * ==========================================================================*/
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsPtSnapshot && window.__mlsPtSnapshot.__booted) return;

  var WRAP_ID='mlsPtSnap', POP_ID='mlsPtSnapPop', STYLE_ID='mlsPtSnap-style';
  var WRAP_STYLE_ID='mls-ctxbar-wrap-style';
  var backTimer=null, origRenderBar=null, obs=null, obsTarget=null;

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function ensureWrapStyle(){if(document.getElementById(WRAP_STYLE_ID))return;try{var s=document.createElement('style');s.id=WRAP_STYLE_ID;s.textContent='#mlsCtxBar{flex-wrap:wrap;row-gap:6px;}';document.head.appendChild(s);}catch(e){}}

  function activePt(){try{if(typeof window.activePatient==='function')return window.activePatient();}catch(e){}return null;}
  function snapshotHtml(p){
    try{if(typeof window._patientQuickHistory==='function')return window._patientQuickHistory(p);}catch(e){}
    var nm=(p&&p.name)||'Patient';
    var demo=[p&&p.sex,p&&p.dob,(p&&p.mrn)?('MRN '+p.mrn):''].filter(Boolean).join(' · ');
    return '<b>'+esc(nm)+'</b>'+(demo?'<br><span style="color:#9fb2c6">'+esc(demo)+'</span>':'');
  }

  function closePop(){try{var p=document.getElementById(POP_ID);if(p)p.remove();document.removeEventListener('mousedown',onDoc,true);}catch(e){}}
  function onDoc(ev){var pop=document.getElementById(POP_ID),w=document.getElementById(WRAP_ID);
    if(pop&&!pop.contains(ev.target)&&w&&!w.contains(ev.target))closePop();}
  function openChart(){try{if(typeof window.showView==='function')window.showView('patients');}catch(e){}closePop();}
  function startVisit(){try{if(typeof window.goNewVisitForPatient==='function'){window.goNewVisitForPatient();}
    else if(typeof window.showView==='function'){window.showView('visit');}}catch(e){}closePop();}

  function openPop(anchor){
    closePop();var p=activePt();if(!p)return;
    var pop=document.createElement('div');pop.id=POP_ID;
    pop.innerHTML='<div class="mps-body">'+snapshotHtml(p)+'</div>'+
      '<div class="mps-actions">'+
      '<button type="button" class="mps-act" data-a="chart">Open chart</button>'+
      '<button type="button" class="mps-act mps-primary" data-a="visit">Start visit</button>'+
      '</div>';
    document.body.appendChild(pop);
    try{var r=anchor.getBoundingClientRect();pop.style.top=Math.round(r.bottom+6)+'px';pop.style.left=Math.round(Math.min(r.left,window.innerWidth-270))+'px';}catch(e){}
    pop.querySelector('[data-a="chart"]').addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();openChart();});
    pop.querySelector('[data-a="visit"]').addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();startVisit();});
    setTimeout(function(){document.addEventListener('mousedown',onDoc,true);},0);
  }

  function injectCss(){
    if(document.getElementById(STYLE_ID))return;
    try{var s=document.createElement('style');s.id=STYLE_ID;
      s.textContent=
        '#'+WRAP_ID+'{display:inline-flex;align-items:center;margin-left:8px;vertical-align:middle;}'+
        '#'+WRAP_ID+' .mps-btn{cursor:pointer;border:1px solid rgba(31,122,224,.34);background:rgba(31,122,224,.10);'+
        'color:#2E6A4B;font:inherit;font-size:12px;font-weight:600;padding:3px 11px;border-radius:999px;'+
        'display:inline-flex;align-items:center;gap:5px;white-space:nowrap;}'+
        '#'+WRAP_ID+' .mps-btn:hover{background:rgba(31,122,224,.20);}'+
        '#'+POP_ID+'{position:fixed;z-index:9600;width:248px;background:#13283d;color:#fff;border-radius:12px;'+
        'padding:13px 14px;box-shadow:0 14px 34px rgba(0,0,0,.4);font-size:12.5px;line-height:1.55;}'+
        '#'+POP_ID+' .mps-body{margin-bottom:11px;}'+
        '#'+POP_ID+' .mps-actions{display:flex;gap:8px;}'+
        '#'+POP_ID+' .mps-act{flex:1;cursor:pointer;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.07);'+
        'color:#fff;font:inherit;font-size:12px;font-weight:600;padding:7px 6px;border-radius:8px;}'+
        '#'+POP_ID+' .mps-act:hover{background:rgba(255,255,255,.15);}'+
        '#'+POP_ID+' .mps-primary{background:#2E6A4B;border-color:#2E6A4B;}'+
        '#'+POP_ID+' .mps-primary:hover{background:#2E6A4B;}'+
        'body.theme-dark #'+WRAP_ID+' .mps-btn{color:#C9DCD2;}';
      document.head.appendChild(s);}catch(e){}
  }

  function visibleBar(){
    /* b742: not into the active-patient banner — that bar is the patient and
       nothing else now (owner 2026-07-27). The snapshot popover repeated facts
       the banner already prints and the chart holds in full. Legacy
       #patientBar path below unchanged. */
    var pb=document.getElementById('patientBar');
    if(pb){try{if(pb.style.display!=='none'&&pb.offsetParent!==null){var inner=document.getElementById('patientBarInner');return {bar:pb,anchor:pb.querySelector('.spacer')||(inner?inner.nextSibling:null)};}}catch(e){}}
    return null;
  }

  function render(){
    try{
      var loc=visibleBar();
      var existing=document.getElementById(WRAP_ID);
      var p=activePt();
      if(!loc||!p){if(existing)existing.remove();closePop();detachObs();return;}
      ensureWrapStyle();
      if(!existing){existing=document.createElement('span');existing.id=WRAP_ID;}
      if(existing.parentNode!==loc.bar){
        if(loc.anchor&&loc.anchor.parentNode===loc.bar) loc.bar.insertBefore(existing,loc.anchor);
        else loc.bar.appendChild(existing);
      }
      var html='<button type="button" class="mps-btn" title="Patient snapshot + quick actions">ⓘ Snapshot</button>';
      if(existing.innerHTML!==html) existing.innerHTML=html;
      var btn=existing.querySelector('.mps-btn');
      if(btn&&!btn.__mlsSnapshotBound){btn.__mlsSnapshotBound=true;btn.addEventListener('click',function(ev){ev.preventDefault();ev.stopPropagation();
        if(document.getElementById(POP_ID))closePop();else openPop(existing);});}
      attachObs(loc.bar);
    }catch(e){}
  }

  function attachObs(bar){try{if(obs&&obsTarget===bar)return;detachObs();obsTarget=bar;
    obs=new MutationObserver(function(){try{if(!document.getElementById(WRAP_ID))render();}catch(e){}});
    obs.observe(bar,{childList:true});}catch(e){}}
  function detachObs(){try{if(obs){obs.disconnect();obs=null;obsTarget=null;}}catch(e){}}

  function wrapRenderBar(){try{if(typeof window.renderPatientBar==='function'&&!origRenderBar){
    origRenderBar=window.renderPatientBar;
    window.renderPatientBar=function(){var r;try{r=origRenderBar.apply(this,arguments);}catch(e){}try{render();}catch(e){}return r;};}}catch(e){}}

  function boot(){injectCss();wrapRenderBar();render();if(!backTimer)backTimer=setInterval(render,15000);}

  window.__mlsPtSnapshot={
    __booted:true, rerender:render,
    revert:function(){
      try{if(backTimer){clearInterval(backTimer);backTimer=null;}}catch(e){}
      try{detachObs();}catch(e){}
      try{document.removeEventListener('mousedown',onDoc,true);}catch(e){}
      try{if(origRenderBar){window.renderPatientBar=origRenderBar;origRenderBar=null;}}catch(e){}
      try{closePop();}catch(e){}
      try{var w=document.getElementById(WRAP_ID);if(w)w.remove();}catch(e){}
      try{var s=document.getElementById(STYLE_ID);if(s)s.remove();}catch(e){}
      try{delete window.__mlsPtSnapshot;}catch(e){window.__mlsPtSnapshot=undefined;}
    }
  };

  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',function(){setTimeout(boot,650);});}
  else{setTimeout(boot,650);}
})();
