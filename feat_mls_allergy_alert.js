/* ============================================================================
 * feat_mls_allergy_alert.js  —  item76 (STAGING)
 * ----------------------------------------------------------------------------
 * "Allergy safety" chip pinned into the always-visible patient context bar.
 *
 * WHY (doctor value + connective): the active patient already carries a
 * recorded allergy list, but today it only lives buried in the Patients ->
 * profile card. A drug allergy is the single most safety-critical fact during
 * a visit, and the doctor should never have to leave the screen they are on to
 * see it. This surfaces the SAME single source of truth (activePatient().
 * allergies) as a prominent red chip in the patient context bar, visible on
 * EVERY clinical view (Visit, Calendar, Patients, History, ...). One click
 * opens a clean popover listing each drug + reaction. When the chart truly has
 * no known allergies it shows an honest, calm "No known allergies" chip - never
 * a false "safe" when data is simply missing (then it hides).
 *
 * HONEST SOURCING (no invented data): reads ONLY the patient record's own
 * allergies string. NKDA / "no known" -> green calm chip. Empty / unknown ->
 * the chip hides itself (does not claim "no allergies" when we just don't know).
 *
 * CONNECTIVE: re-renders on every active-patient change via the app's own
 * getActivePtId() source of truth + a renderPatientBar hook, so the chip always
 * matches the patient the rest of the app considers active.
 *
 * GUARDRAILS: additive & reversible (window.__mlsAllergyAlert.revert()).
 * Display only - never writes/edits/deletes any record, note, roster entry or
 * appointment; never touches athenaOne. Self-contained IIFE, try/catch
 * throughout. Mounts into the visible #mlsCtxBar (fallback legacy #patientBar)
 * and lets the bar wrap (shared idempotent style) so chips never overlap.
 * ==========================================================================*/
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsAllergyAlert && window.__mlsAllergyAlert.__booted) return;

  var CHIP_ID   = 'mlsAllergyChip';
  var POP_ID    = 'mlsAllergyPop';
  var STYLE_ID  = 'mlsAllergyChip-style';
  var WRAP_STYLE_ID = 'mls-ctxbar-wrap-style';
  var timer = null, origRenderBar = null, lastSig = '__init__', docClickBound = null;

  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}

  function activePt(){
    try{ if(typeof window.activePatient==='function') return window.activePatient(); }catch(e){}
    return null;
  }

  // Parse a free-text allergy string into [{drug, reaction}, ...].
  // Format in records: "DRUG: reaction, DRUG2: reaction2".  We split on commas
  // that precede a new UPPERCASE drug token + colon, so multi-word reactions
  // (which may themselves contain commas) stay intact.
  function parseAllergies(raw){
    var s = String(raw==null?'':raw).trim();
    if (!s) return {known:null, list:[]};
    if (/^(nkda|nka|no known|none\b|denies|no drug allergies)/i.test(s)) return {known:false, list:[]};
    var parts;
    try { parts = s.split(/,\s*(?=[A-Z0-9][A-Z0-9 .\/\-]*\s*:)/); }
    catch(e){ parts = s.split(/,\s*/); }
    if (!parts.length) parts = [s];
    var list = [];
    parts.forEach(function(p){
      p = String(p||'').trim(); if(!p) return;
      var i = p.indexOf(':');
      if (i > -1){ list.push({drug:p.slice(0,i).trim(), reaction:p.slice(i+1).trim()}); }
      else { list.push({drug:p, reaction:''}); }
    });
    return {known:true, list:list};
  }

  function injectCss(){
    if (document.getElementById(STYLE_ID)) return;
    try{
      var s=document.createElement('style'); s.id=STYLE_ID;
      s.textContent=
        '#'+CHIP_ID+'{display:inline-flex;align-items:center;gap:6px;margin-left:10px;'+
        'padding:3px 11px;border-radius:999px;font-size:12px;line-height:1.2;font-weight:700;'+
        'cursor:pointer;border:1px solid transparent;vertical-align:middle;white-space:nowrap;'+
        'transition:background .15s ease,box-shadow .15s ease;}'+
        '#'+CHIP_ID+'.alg-danger{background:rgba(220,38,38,.13);border-color:rgba(220,38,38,.42);color:#a4161a;}'+
        '#'+CHIP_ID+'.alg-danger:hover{background:rgba(220,38,38,.2);box-shadow:0 1px 6px rgba(220,38,38,.22);}'+
        '#'+CHIP_ID+'.alg-safe{background:rgba(22,163,74,.12);border-color:rgba(22,163,74,.34);color:#15803d;font-weight:600;}'+
        '#'+CHIP_ID+'.alg-safe:hover{background:rgba(22,163,74,.18);}'+
        '#'+CHIP_ID+' .alg-ico{font-size:13px;line-height:1;}'+
        '#'+POP_ID+'{position:fixed;z-index:2147483600;min-width:248px;max-width:360px;'+
        'max-height:60vh;overflow:auto;background:#fff;border:1px solid #e2e8f0;'+
        'border-radius:12px;box-shadow:0 14px 40px rgba(2,12,27,.26);padding:12px 14px;'+
        'font-size:13px;color:#0c2c4d;display:none;}'+
        '#'+POP_ID+'.open{display:block;}'+
        '#'+POP_ID+' .alg-h{display:flex;align-items:center;gap:7px;font-weight:800;'+
        'font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:#a4161a;'+
        'margin:0 0 9px;}'+
        '#'+POP_ID+' .alg-row{display:flex;gap:9px;padding:7px 0;border-top:1px solid #F4F2EC;}'+
        '#'+POP_ID+' .alg-row:first-of-type{border-top:0;}'+
        '#'+POP_ID+' .alg-dot{flex:0 0 auto;width:7px;height:7px;border-radius:50%;'+
        'background:#dc2626;margin-top:5px;}'+
        '#'+POP_ID+' .alg-drug{font-weight:700;color:#7f1010;}'+
        '#'+POP_ID+' .alg-rx{color:#475569;font-size:12px;margin-top:1px;}'+
        '#'+POP_ID+' .alg-foot{margin-top:10px;font-size:11px;color:#94a3b8;}'+
        'body.theme-dark #'+POP_ID+'{background:#10243b;border-color:#1e3a5f;color:#dbe8f6;}'+
        'body.theme-dark #'+POP_ID+' .alg-row{border-top-color:#1c3450;}'+
        'body.theme-dark #'+POP_ID+' .alg-drug{color:#ffb4ad;}'+
        'body.theme-dark #'+POP_ID+' .alg-rx{color:#9fb6cf;}';
      document.head.appendChild(s);
    }catch(e){}
  }
  function ensureWrapStyle(){
    if (document.getElementById(WRAP_STYLE_ID)) return;
    try{var s=document.createElement('style');s.id=WRAP_STYLE_ID;
      s.textContent='#mlsCtxBar{flex-wrap:wrap;row-gap:6px;}';
      document.head.appendChild(s);}catch(e){}
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

  function closePop(){ var p=document.getElementById(POP_ID); if(p){ p.classList.remove('open'); } }

  function positionPop(chip, pop){
    try{
      var r=chip.getBoundingClientRect();
      pop.style.visibility='hidden'; pop.classList.add('open');
      var pw=pop.offsetWidth||260, ph=pop.offsetHeight||120;
      var left=Math.max(8, Math.min(r.left, window.innerWidth-pw-8));
      var top=r.bottom+6;
      if (top+ph > window.innerHeight-8) top=Math.max(8, r.top-ph-6);
      pop.style.left=Math.round(left)+'px';
      pop.style.top=Math.round(top)+'px';
      pop.style.visibility='';
    }catch(e){}
  }

  function buildPop(parsed){
    var pop=document.getElementById(POP_ID);
    if(!pop){ pop=document.createElement('div'); pop.id=POP_ID; document.body.appendChild(pop); }
    var html='<div class="alg-h"><span class="alg-ico">⚠</span> Allergies &amp; reactions</div>';
    parsed.list.forEach(function(a){
      html+='<div class="alg-row"><span class="alg-dot"></span><div>'+
        '<div class="alg-drug">'+esc(a.drug)+'</div>'+
        (a.reaction?'<div class="alg-rx">'+esc(a.reaction)+'</div>':'')+
        '</div></div>';
    });
    html+='<div class="alg-foot">From the patient record — review before prescribing.</div>';
    pop.innerHTML=html;
    return pop;
  }

  function render(){
    var loc=visibleBar(); if(!loc) return;
    ensureWrapStyle(); injectCss();
    var ap=activePt();
    var parsed = ap ? parseAllergies(ap.allergies) : {known:null,list:[]};

    // signature so we only rebuild when the meaningful state changes
    var sig = (ap&&ap.id||'') + '|' + parsed.known + '|' + parsed.list.map(function(a){return a.drug;}).join(',');

    // If no patient or unknown allergy data -> remove chip (honest: hide, don't claim safe)
    var chip=document.getElementById(CHIP_ID);
    if (!ap || parsed.known===null){
      if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
      closePop(); lastSig=sig; return;
    }

    if (!chip){
      chip=document.createElement('span'); chip.id=CHIP_ID; chip.setAttribute('role','button');
      chip.tabIndex=0;
      chip.addEventListener('click', function(ev){
        ev.preventDefault(); ev.stopPropagation();
        var cur=activePt(); var pp=cur?parseAllergies(cur.allergies):{known:null,list:[]};
        if (pp.known!==true || !pp.list.length) return; // safe chip is non-interactive
        var pop=document.getElementById(POP_ID);
        if (pop && pop.classList.contains('open')){ pop.classList.remove('open'); return; }
        pop=buildPop(pp); positionPop(chip, pop);
      });
    }
    // (re)mount in the right place
    if (loc.anchor && loc.anchor.parentNode===loc.bar){ if(chip.nextSibling!==loc.anchor||chip.parentNode!==loc.bar) loc.bar.insertBefore(chip, loc.anchor); }
    else if (chip.parentNode!==loc.bar){ loc.bar.appendChild(chip); }

    if (sig!==lastSig){
      if (parsed.known===false){
        chip.className='alg-safe';
        chip.innerHTML='<span class="alg-ico">✓</span> No known allergies';
        chip.title='Chart records no known drug allergies';
        closePop();
      } else {
        chip.className='alg-danger';
        var n=parsed.list.length;
        chip.innerHTML='<span class="alg-ico">⚠</span> Allergies ('+n+')';
        chip.title='Click to view '+n+' recorded allerg'+(n===1?'y':'ies');
        // refresh open popover if showing
        var pop=document.getElementById(POP_ID);
        if (pop && pop.classList.contains('open')){ buildPop(parsed); positionPop(chip,pop); }
      }
      lastSig=sig;
    }
  }

  function boot(){
    injectCss(); ensureWrapStyle();
    try{ render(); }catch(e){}
    // re-render on active-patient changes via the app's own render path
    if (typeof window.renderPatientBar==='function' && !origRenderBar){
      origRenderBar=window.renderPatientBar;
      window.renderPatientBar=function(){ var r; try{r=origRenderBar.apply(this,arguments);}catch(e){} try{render();}catch(e){} return r; };
    }
    // belt-and-suspenders idempotent poll (also catches DOB/allergy edits)
    timer=setInterval(function(){ try{render();}catch(e){} }, 1100);
    // close popover on outside click / scroll / resize
    docClickBound=function(ev){ var pop=document.getElementById(POP_ID); var chip=document.getElementById(CHIP_ID);
      if(!pop||!pop.classList.contains('open'))return;
      if (pop.contains(ev.target) || (chip&&chip.contains(ev.target))) return; closePop(); };
    document.addEventListener('click', docClickBound, true);
    window.addEventListener('resize', closePop, true);
    window.addEventListener('scroll', closePop, true);
  }

  window.__mlsAllergyAlert = {
    __booted:true,
    render:function(){ try{render();}catch(e){} },
    revert:function(){
      try{ if(timer){clearInterval(timer);timer=null;} }catch(e){}
      try{ if(origRenderBar){window.renderPatientBar=origRenderBar;origRenderBar=null;} }catch(e){}
      try{ if(docClickBound){document.removeEventListener('click',docClickBound,true);docClickBound=null;} }catch(e){}
      try{ window.removeEventListener('resize', closePop, true);}catch(e){}
      try{ window.removeEventListener('scroll', closePop, true);}catch(e){}
      ['mlsAllergyChip','mlsAllergyPop','mlsAllergyChip-style'].forEach(function(id){var n=document.getElementById(id);if(n&&n.parentNode)n.parentNode.removeChild(n);});
      window.__mlsAllergyAlert.__booted=false;
      return true;
    }
  };

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
