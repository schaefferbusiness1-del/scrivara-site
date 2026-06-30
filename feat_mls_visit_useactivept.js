/* ============================================================================
 * feat_mls_visit_useactivept.js  —  item78 (STAGING)
 * ----------------------------------------------------------------------------
 * "Use current patient" one-click autofill for the Visit / MLS-Easy hero.
 *
 * WHY (doctor value + connective): the app already has an ACTIVE patient
 * (the one in the context bar, the one every other surface agrees on). But to
 * start a visit the doctor lands on the hero with the Patient-name and
 * Date-of-birth fields EMPTY and re-types the name + DOB they already picked.
 * This adds a single "Use current patient" button right beside those fields
 * that fills them from activePatient() in one click - name, DOB, and a
 * de-identified label (initials) for the capture card - so the active patient
 * flows straight into the note-start form instead of being re-keyed. Real,
 * felt friction removed on every single visit; one shared source of truth
 * (the active patient) now drives the visit form too.
 *
 * SAFE BY DESIGN: it only POPULATES the app's own visit-start fields with the
 * app's own active-patient data when the doctor clicks the button. It NEVER
 * auto-submits, never presses Start/record, never writes/edits/deletes any
 * record, note or appointment, and never touches athenaOne. Fields stay fully
 * editable; the doctor reviews and starts as usual. Honest: if no patient is
 * active, the button disables itself rather than inventing data.
 *
 * GUARDRAILS: additive & reversible (window.__mlsUseActivePt.revert()).
 * Self-contained IIFE, try/catch throughout. Idempotent mount that re-attaches
 * if the hero re-renders; only mounts where the hero fields actually exist.
 * ==========================================================================*/
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__mlsUseActivePt && window.__mlsUseActivePt.__booted) return;

  var BTN_ID='mlsUseActivePtBtn', STYLE_ID='mlsUseActivePt-style';
  var timer=null;

  function activePt(){ try{ if(typeof window.activePatient==='function') return window.activePatient(); }catch(e){} return null; }
  function byId(id){ return document.getElementById(id); }

  // De-identified label: up to two initials from the patient name, ignoring
  // provider-suffix-ish tokens (PA-C, MD, DO, NP, etc.).
  function initialsOf(name){
    var s=String(name||'').replace(/[,]/g,' ').trim();
    if(!s) return '';
    var toks=s.split(/\s+/).filter(function(t){
      return t && !/^(pa-?c|m\.?d\.?|d\.?o\.?|n\.?p\.?|rn|aprn|phd|jr|sr|ii|iii|iv)$/i.test(t.replace(/\./g,''));
    });
    if(!toks.length) toks=s.split(/\s+/);
    var ini=toks.slice(0,2).map(function(t){return (t[0]||'').toUpperCase();}).filter(Boolean);
    return ini.join('.')+(ini.length?'.':'');
  }

  function setField(el, val){
    if(!el) return false;
    try{
      el.value=val;
      el.dispatchEvent(new Event('input',{bubbles:true}));
      el.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    }catch(e){ try{ el.value=val; }catch(_){} return false; }
  }

  function injectCss(){
    if (byId(STYLE_ID)) return;
    try{
      var s=document.createElement('style'); s.id=STYLE_ID;
      s.textContent=
        '#'+BTN_ID+'{display:inline-flex;align-items:center;gap:6px;margin-left:8px;'+
        'padding:6px 12px;border-radius:9px;border:1px solid rgba(39,201,143,.5);'+
        'background:rgba(39,201,143,.16);color:#0a7a55;font-size:12.5px;font-weight:700;'+
        'cursor:pointer;vertical-align:middle;white-space:nowrap;'+
        'transition:background .15s ease,box-shadow .15s ease;}'+
        '#'+BTN_ID+':hover{background:rgba(39,201,143,.26);box-shadow:0 1px 7px rgba(39,201,143,.25);}'+
        '#'+BTN_ID+'[disabled]{opacity:.5;cursor:not-allowed;box-shadow:none;}'+
        '#'+BTN_ID+' .ua-ico{font-size:13px;line-height:1;}'+
        'body.theme-dark #'+BTN_ID+'{color:#8ff0cb;border-color:rgba(39,201,143,.45);}';
      document.head.appendChild(s);
    }catch(e){}
  }

  function heroNameInput(){
    return byId('heroPtName') || document.querySelector('input[placeholder="First Last"]');
  }
  function heroDobInput(){
    return byId('heroPtDob') || document.querySelector('input[placeholder="MM/DD/YYYY"]');
  }
  function labelInput(){
    return byId('patientLabel') || document.querySelector('input[placeholder*="MRN-1042"]');
  }

  // Find the "From open Athena chart" button to sit beside, else the name input.
  function anchorEl(){
    var name=heroNameInput(); if(!name) return null;
    // look for sibling button referencing "Athena chart"
    var scope = name.closest('div') || name.parentNode;
    var hops=0, node=scope;
    while(node && hops<4){
      var b=Array.prototype.slice.call(node.querySelectorAll('button,a')).find(function(x){
        return /from open athena chart/i.test((x.textContent||'').trim());
      });
      if(b) return {after:b};
      node=node.parentNode; hops++;
    }
    return {after:name};
  }

  function doFill(){
    var ap=activePt();
    if(!ap) return;
    var n=ap.name||'', d=ap.dob||'';
    var filled=[];
    if(setField(heroNameInput(), n) && n) filled.push('name');
    if(d && setField(heroDobInput(), d)) filled.push('DOB');
    var li=labelInput();
    if(li && !String(li.value||'').trim()){ var ini=initialsOf(n); if(ini && setField(li, ini)) filled.push('label'); }
    try{ if(typeof window.toast==='function') window.toast(filled.length?('Filled '+filled.join(', ')+' from current patient — review, then Start.'):'No patient fields to fill.',''); }catch(e){}
    // gentle focus so the doctor can immediately verify/start
    try{ var dob=heroDobInput(); if(dob && !String(dob.value||'').trim()) dob.focus(); }catch(e){}
  }

  function render(){
    var name=heroNameInput();
    var btn=byId(BTN_ID);
    if(!name || name.offsetParent===null){
      // hero not visible — remove button if present
      if(btn && btn.parentNode) btn.parentNode.removeChild(btn);
      return;
    }
    injectCss();
    if(!btn){
      btn=document.createElement('button');
      btn.id=BTN_ID; btn.type='button';
      btn.innerHTML='<span class="ua-ico">⤵</span> Use current patient';
      btn.addEventListener('click', function(ev){ ev.preventDefault(); ev.stopPropagation(); doFill(); });
    }
    var a=anchorEl();
    if(a && a.after && a.after.parentNode){
      if(btn.previousSibling!==a.after || btn.parentNode!==a.after.parentNode){
        a.after.parentNode.insertBefore(btn, a.after.nextSibling);
      }
    } else if(name.parentNode && btn.parentNode!==name.parentNode){
      name.parentNode.appendChild(btn);
    }
    // reflect availability of an active patient
    var ap=activePt();
    if(ap && (ap.name||ap.dob)){ btn.removeAttribute('disabled'); btn.title='Fill name + DOB from '+(ap.name||'the current patient'); }
    else { btn.setAttribute('disabled','disabled'); btn.title='No active patient to fill from'; }
  }

  function boot(){
    injectCss();
    try{ render(); }catch(e){}
    timer=setInterval(function(){ try{render();}catch(e){} }, 1200);
  }

  window.__mlsUseActivePt = {
    __booted:true,
    fill:function(){ try{doFill();}catch(e){} },
    render:function(){ try{render();}catch(e){} },
    revert:function(){
      try{ if(timer){clearInterval(timer);timer=null;} }catch(e){}
      ['mlsUseActivePtBtn','mlsUseActivePt-style'].forEach(function(id){var n=document.getElementById(id);if(n&&n.parentNode)n.parentNode.removeChild(n);});
      window.__mlsUseActivePt.__booted=false;
      return true;
    }
  };

  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
