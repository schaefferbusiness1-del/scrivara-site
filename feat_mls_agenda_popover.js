/* ============================================================================
 * feat_mls_agenda_popover.js  —  item77 (STAGING)
 * ----------------------------------------------------------------------------
 * "Today's agenda" one-click popover in the always-visible patient context bar.
 *
 * WHY (doctor value + connective): the app already pulls today's schedule and
 * already knows, for each patient, whether they have been seen and who is "up
 * now". But to actually WALK the day - jump from one patient to the next - the
 * doctor has to dig back into the Visit screen's NEXT-UP picker. The existing
 * Day-Progress chip (item72) shows the single next patient; this gives the full
 * ordered list in one place, reachable from EVERY view. Each row shows the
 * appointment time, the patient, and an honest status (✓ seen / ● up now /
 * upcoming), and CLICKING a row loads that patient through the app's own
 * _heroPickPatient handler - the exact same switch path the rest of the app
 * uses. Fewer clicks to move through the whole clinic day, from anywhere.
 *
 * CONNECTIVE: shares ONE source of truth with Day Progress / NEXT-UP -
 *   list   = window._heroTodayList   (today's pulled appointments)
 *   seen   = window._seenToday(name)
 *   now    = window._calPickNowIdx(list)
 *   load   = window._heroPickPatient(indexInHeroTodayList)
 *   time   = window._fmtApptTime(appt.time)  (falls back to raw)
 * No invented data: if the schedule has not been pulled, the chip hides itself.
 *
 * GUARDRAILS: additive & reversible (window.__mlsAgenda.revert()). Navigation
 * + display only - never creates/edits/deletes any record, note, roster entry
 * or appointment; never touches athenaOne. Self-contained IIFE, try/catch
 * throughout. Mounts into visible #mlsCtxBar (fallback #patientBar), lets the
 * bar wrap (shared idempotent style) so chips never overlap or get cut off.
 * ==========================================================================*/
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsAgenda && window.__mlsAgenda.__booted) return;

  var CHIP_ID='mlsAgendaChip', POP_ID='mlsAgendaPop', STYLE_ID='mlsAgendaChip-style';
  var WRAP_STYLE_ID='mls-ctxbar-wrap-style';
  var LEGACY_LAYOUT_STYLE_ID='mls-patientbar-stable-layout';
  var timer=null, origRenderBar=null, lastSig='__init__', docClickBound=null;

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  function rawList(){ try{var a=window._heroTodayList; return Array.isArray(a)?a:[];}catch(e){return [];} }
  function appts(){ return rawList().filter(function(x){return x&&String(x.name||'').trim();}); }
  function isSeen(name){ try{ if(typeof window._seenToday==='function') return !!window._seenToday(name);}catch(e){} return false; }
  function nowIdx(list){ try{ if(typeof window._calPickNowIdx==='function'){var i=window._calPickNowIdx(list); return (typeof i==='number'&&i>=0)?i:-1;}}catch(e){} return -1; }
  function fmtTime(a){ try{ if(typeof window._fmtApptTime==='function'){var t=window._fmtApptTime(a.time||''); if(t)return t;}}catch(e){} return String((a&&a.time)||''); }
  function shortName(n){ n=String(n||'').trim(); return n.length>26?n.slice(0,25)+'…':n; }

  function injectCss(){
    if (document.getElementById(STYLE_ID)) return;
    try{
      var s=document.createElement('style'); s.id=STYLE_ID;
      s.textContent=
        '#'+CHIP_ID+'{display:inline-flex;align-items:center;gap:6px;margin-left:10px;'+
        'padding:3px 11px;border-radius:999px;font-size:12px;line-height:1.2;font-weight:600;'+
        'cursor:pointer;border:1px solid rgba(46,106,75,.32);background:rgba(46,106,75,.1);'+
        'color:#1E2B24;vertical-align:middle;white-space:nowrap;transition:background .15s ease;}'+
        '#'+CHIP_ID+':hover{background:rgba(46,106,75,.18);}'+
        '#'+CHIP_ID+' .ag-ico{font-size:12px;line-height:1;}'+
        '#'+POP_ID+'{position:fixed;z-index:2147483600;width:300px;max-width:92vw;max-height:64vh;'+
        'overflow:auto;overscroll-behavior:contain;background:#fff;border:1px solid #E7E5DD;border-radius:12px;'+
        'box-shadow:0 14px 40px rgba(26,33,28,.22);padding:10px 8px;font-size:13px;color:#1E2B24;display:none;}'+
        '#'+POP_ID+'.open{display:block;}'+
        '#'+POP_ID+' .ag-h{display:flex;align-items:center;justify-content:space-between;gap:8px;'+
        'font-weight:800;font-size:11px;letter-spacing:.03em;text-transform:uppercase;color:#2E6A4B;'+
        'padding:2px 8px 8px;}'+
        '#'+POP_ID+' .ag-h .ag-sub{font-weight:600;color:#A6AEA6;text-transform:none;letter-spacing:0;}'+
        '#'+POP_ID+' .ag-row{display:flex;align-items:center;gap:9px;width:100%;text-align:left;'+
        'background:none;border:0;border-radius:8px;padding:7px 8px;cursor:pointer;color:inherit;'+
        'font:inherit;}'+
        '#'+POP_ID+' .ag-row:hover{background:rgba(46,106,75,.08);}'+
        '#'+POP_ID+' .ag-row.is-now{background:rgba(39,201,143,.12);}'+
        '#'+POP_ID+' .ag-row.is-now:hover{background:rgba(39,201,143,.2);}'+
        '#'+POP_ID+' .ag-time{flex:0 0 58px;font-variant-numeric:tabular-nums;font-weight:700;'+
        'font-size:12px;color:#3D453E;}'+
        '#'+POP_ID+' .ag-name{flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'+
        'font-weight:600;}'+
        '#'+POP_ID+' .ag-badge{flex:0 0 auto;font-size:10.5px;font-weight:700;border-radius:999px;'+
        'padding:2px 7px;white-space:nowrap;}'+
        '#'+POP_ID+' .ag-badge.seen{background:rgba(22,163,74,.14);color:#15803d;}'+
        '#'+POP_ID+' .ag-badge.now{background:rgba(39,201,143,.18);color:#0a7a55;}'+
        '#'+POP_ID+' .ag-badge.next{background:rgba(46,106,75,.14);color:#2E6A4B;}'+
        '#'+POP_ID+' .ag-badge.up{background:rgba(121,131,124,.14);color:#55605A;}'+
        '#'+POP_ID+' .ag-foot{padding:8px 8px 2px;font-size:11px;color:#A6AEA6;}'+
        'body.theme-dark #'+POP_ID+'{background:#10243b;border-color:#204034;color:#dbe8f6;}'+
        'body.theme-dark #'+POP_ID+' .ag-time{color:#aebfd3;}'+
        'body.theme-dark #'+POP_ID+' .ag-row:hover{background:rgba(31,122,224,.22);}';
      document.head.appendChild(s);
    }catch(e){}
  }
  function ensureWrapStyle(){
    if (document.getElementById(WRAP_STYLE_ID)) return;
    try{var s=document.createElement('style');s.id=WRAP_STYLE_ID;
      s.textContent='#mlsCtxBar{flex-wrap:wrap;row-gap:6px;}';
      document.head.appendChild(s);}catch(e){}
  }

  /* Several independent chips share the legacy no-active-patient bar. Their
     refresh timers can legally reinsert nodes in a different DOM order, which
     used to make the bar alternate between two wrap layouts every few seconds.
     Explicit grid areas make visual placement stable regardless of insertion
     order. The active-patient #mlsCtxBar is intentionally left unchanged. */
  function ensureLegacyLayoutStyle(){
    if (document.getElementById(LEGACY_LAYOUT_STYLE_ID)) return;
    try{
      var s=document.createElement('style'); s.id=LEGACY_LAYOUT_STYLE_ID;
      s.textContent=
        '#patientBar{display:grid!important;grid-template-columns:auto minmax(140px,1fr) auto auto;'+
        'align-items:center!important;column-gap:12px!important;row-gap:8px!important;}'+
        '#patientBar>#mlsAgendaChip{grid-column:1;grid-row:1;order:0!important;margin-left:0!important;}'+
        '#patientBar>#patientBarInner{grid-column:2;grid-row:1;min-width:0;overflow:hidden;}'+
        '#patientBar>#patientBarInner .pnone{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'+
        '#patientBar>#mlsDayProgress{grid-column:1/3;grid-row:2;margin-left:0!important;min-width:0;'+
        'justify-self:start;width:max-content;max-width:min(361px,100%);overflow:hidden;}'+
        '#patientBar>#mlsDayProgress .mdp-next{min-width:0;overflow:hidden;text-overflow:ellipsis;}'+
        '#patientBar>#mlsRecentPts{grid-column:3;grid-row:2;margin-left:0!important;justify-self:start;'+
        'min-width:max-content;max-width:100%;}'+
        '#patientBar>#mlsRecentPts .mrp-btn{max-width:100%;}'+
        '#patientBar>.spacer{grid-column:4;grid-row:2;min-width:0;}'+
        '#patientBar>.btn-ghost{grid-column:3;grid-row:1;margin:0!important;white-space:nowrap;}'+
        '#patientBar>#wf2OneClick{grid-column:4;grid-row:1;margin:0!important;white-space:nowrap;}'+
        '@media(max-width:900px){#patientBar{grid-template-columns:minmax(0,1fr) auto!important;}'+
        '#patientBar>#mlsAgendaChip{grid-column:1/3;grid-row:1;}'+
        '#patientBar>#patientBarInner{grid-column:1/3;grid-row:2;}'+
        '#patientBar>#mlsDayProgress{grid-column:1/3;grid-row:3;justify-self:start;width:max-content;'+
        'max-width:min(361px,100%);overflow:hidden;}'+
        '#patientBar>#mlsRecentPts{grid-column:1;grid-row:4;justify-self:start;min-width:max-content;'+
        'max-width:100%;}'+
        '#patientBar>.spacer{display:none!important;}'+
        '#patientBar>.btn-ghost{grid-column:2;grid-row:4;}'+
        '#patientBar>#wf2OneClick{grid-column:1/3;grid-row:5;justify-self:stretch;}}';
      (document.head||document.documentElement).appendChild(s);
    }catch(e){}
  }

  function visibleBar(){
    var ctx=document.getElementById('mlsCtxBar');
    if (ctx){ try{ var cs=getComputedStyle(ctx); if(cs.display!=='none' && ctx.offsetParent!==null){
      return {bar:ctx, anchor:ctx.querySelector('.mlsctx-actions')||null}; } }catch(e){} }
    var pb=document.getElementById('patientBar');
    if (pb){ try{ if(pb.style.display!=='none' && pb.offsetParent!==null){
      var inner=document.getElementById('patientBarInner');
      return {bar:pb, anchor:pb.querySelector('.spacer')||(inner?inner.nextSibling:null)}; } }catch(e){} }
    return null;
  }

  function closePop(){ var p=document.getElementById(POP_ID); if(p) p.classList.remove('open'); }

  function positionPop(chip, pop){
    try{
      var r=chip.getBoundingClientRect();
      /* only use the measure-while-hidden trick on first open — re-hiding an
         ALREADY-open popover on every background refresh made it blink */
      if (!pop.classList.contains('open')){ pop.style.visibility='hidden'; pop.classList.add('open'); }
      var pw=pop.offsetWidth||300, ph=pop.offsetHeight||200;
      var left=Math.max(8, Math.min(r.left, window.innerWidth-pw-8));
      var top=r.bottom+6;
      if (top+ph > window.innerHeight-8) top=Math.max(8, r.top-ph-6);
      var nl=Math.round(left)+'px', nt=Math.round(top)+'px';
      if (pop.style.left!==nl) pop.style.left=nl;
      if (pop.style.top!==nt) pop.style.top=nt;
      pop.style.visibility='';
    }catch(e){}
  }

  function loadByOrigIndex(origIdx){
    try{ if(typeof window._heroPickPatient==='function'){ window._heroPickPatient(origIdx); return true; } }catch(e){}
    return false;
  }

  function buildPop(){
    var list=appts();
    var pop=document.getElementById(POP_ID);
    if(!pop){ pop=document.createElement('div'); pop.id=POP_ID; document.body.appendChild(pop); }
    var seen=0; list.forEach(function(a){ if(isSeen(a.name)) seen++; });
    var ni=nowIdx(list);
    var html='<div class="ag-h"><span>Today’s agenda</span><span class="ag-sub">'+seen+' / '+list.length+' seen</span></div>';
    var raw=rawList();
    list.forEach(function(a, i){
      var origIdx=raw.indexOf(a); if(origIdx<0) origIdx=i;
      var s=isSeen(a.name);
      var badge, cls='';
      if (s){ badge='<span class="ag-badge seen">✓ seen</span>'; }
      else if (i===ni){ badge='<span class="ag-badge now">● up now</span>'; cls=' is-now'; }
      else if (ni>=0 && i===ni+1){ badge='<span class="ag-badge next">next</span>'; }
      else { badge='<span class="ag-badge up">upcoming</span>'; }
      var t=fmtTime(a);
      html+='<button type="button" class="ag-row'+cls+'" data-oi="'+origIdx+'" title="Load '+esc(a.name)+'">'+
        '<span class="ag-time">'+esc(t||'—')+'</span>'+
        '<span class="ag-name">'+esc(shortName(a.name))+'</span>'+
        badge+
      '</button>';
    });
    html+='<div class="ag-foot">Click a patient to open their chart. Read-only schedule view.</div>';
    pop.innerHTML=html;
    pop.querySelectorAll('.ag-row').forEach(function(btn){
      btn.addEventListener('click', function(ev){
        ev.preventDefault(); ev.stopPropagation();
        var oi=parseInt(btn.getAttribute('data-oi'),10);
        if(!isNaN(oi)) loadByOrigIndex(oi);
        closePop();
      });
    });
    return pop;
  }

  function render(){
    var loc=visibleBar(); if(!loc) return;
    ensureWrapStyle(); ensureLegacyLayoutStyle(); injectCss();
    var list=appts();
    var chip=document.getElementById(CHIP_ID);

    if (!list.length){
      if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
      closePop(); lastSig='__empty__'; return;
    }

    if (!chip){
      chip=document.createElement('span'); chip.id=CHIP_ID; chip.setAttribute('role','button'); chip.tabIndex=0;
      chip.addEventListener('click', function(ev){
        ev.preventDefault(); ev.stopPropagation();
        var pop=document.getElementById(POP_ID);
        if (pop && pop.classList.contains('open')){ pop.classList.remove('open'); return; }
        pop=buildPop(); positionPop(chip, pop);
      });
    }
    if (loc.anchor && loc.anchor.parentNode===loc.bar){ if(chip.nextSibling!==loc.anchor||chip.parentNode!==loc.bar) loc.bar.insertBefore(chip, loc.anchor); }
    else if (chip.parentNode!==loc.bar){ loc.bar.appendChild(chip); }

    var seen=0; list.forEach(function(a){ if(isSeen(a.name)) seen++; });
    var sig=list.length+'|'+seen+'|'+nowIdx(list);
    if (sig!==lastSig){
      chip.innerHTML='<span class="ag-ico">🗓</span> Agenda ('+seen+'/'+list.length+')';
      chip.title='Today’s schedule — '+seen+' of '+list.length+' seen. Click to view & jump.';
      var pop=document.getElementById(POP_ID);
      if (pop && pop.classList.contains('open')){
        /* a background refresh must not yank the list back to the top while
           the doctor is scrolling it */
        var keepScroll=pop.scrollTop;
        buildPop(); positionPop(chip, pop);
        if (pop.scrollTop!==keepScroll) pop.scrollTop=keepScroll;
      }
      lastSig=sig;
    }
  }

  function boot(){
    injectCss(); ensureWrapStyle(); ensureLegacyLayoutStyle();
    try{ render(); }catch(e){}
    if (typeof window.renderPatientBar==='function' && !origRenderBar){
      origRenderBar=window.renderPatientBar;
      window.renderPatientBar=function(){ var r; try{r=origRenderBar.apply(this,arguments);}catch(e){} try{render();}catch(e){} return r; };
    }
    timer=setInterval(function(){ try{render();}catch(e){} }, 1300);
    docClickBound=function(ev){ var pop=document.getElementById(POP_ID); var chip=document.getElementById(CHIP_ID);
      if(!pop||!pop.classList.contains('open'))return;
      if (pop.contains(ev.target) || (chip&&chip.contains(ev.target))) return; closePop(); };
    document.addEventListener('click', docClickBound, true);
    window.addEventListener('resize', closePop, true);
    window.addEventListener('scroll', onPageScroll, true);
  }

  /* Close on PAGE scroll only. The capture-phase window listener also fires
     for scrolls that happen INSIDE the popover's own list — closing there
     made the agenda snap shut the instant the doctor tried to scroll it. */
  function onPageScroll(ev){
    try{
      var pop=document.getElementById(POP_ID);
      if(!pop||!pop.classList.contains('open')) return;
      var t=ev&&ev.target;
      if (t && t.nodeType===1 && (t===pop || pop.contains(t))) return;
      closePop();
    }catch(e){ closePop(); }
  }

  window.__mlsAgenda = {
    __booted:true,
    render:function(){ try{render();}catch(e){} },
    revert:function(){
      try{ if(timer){clearInterval(timer);timer=null;} }catch(e){}
      try{ if(origRenderBar){window.renderPatientBar=origRenderBar;origRenderBar=null;} }catch(e){}
      try{ if(docClickBound){document.removeEventListener('click',docClickBound,true);docClickBound=null;} }catch(e){}
      try{ window.removeEventListener('resize', closePop, true);}catch(e){}
      try{ window.removeEventListener('scroll', onPageScroll, true);}catch(e){}
      ['mlsAgendaChip','mlsAgendaPop','mlsAgendaChip-style',LEGACY_LAYOUT_STYLE_ID].forEach(function(id){var n=document.getElementById(id);if(n&&n.parentNode)n.parentNode.removeChild(n);});
      window.__mlsAgenda.__booted=false;
      return true;
    }
  };

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
