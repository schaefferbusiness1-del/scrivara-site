/* ============================================================================
 * MLS b18 QA bundle (2026-07-05) — calendar reliability, pull screen fix,
 * writeback safety gate, smart empty states, UI stability.
 * Every module is a guarded IIFE: additive, idempotent, reversible by flag.
 * ========================================================================== */

/* One lifecycle for the bundle: a single filtered MutationObserver fans relevant
 * changes out to coalesced tasks. Short-lived timers are registered here so a
 * single revert reliably leaves no background work behind. */
(function(){
  "use strict";
  if(window.__mlsB18QA && window.__mlsB18QA.installed) return;
  var timers=[], listeners=[], cleanups=[], watchers=[], mutationSubs=[];
  var tasks={}, pending={}, queued=false, observer=null;
  var Q={installed:true,v:'b18.1'};

  function drop(arr,item){ var i=arr.indexOf(item); if(i>=0) arr.splice(i,1); }
  Q.later=function(fn,ms){
    if(!Q.installed) return null;
    var id=setTimeout(function(){ drop(timers,id); if(Q.installed){ try{ fn(); }catch(e){} } },ms);
    timers.push(id); return id;
  };
  Q.cancel=function(id){ if(!id) return null; try{ clearTimeout(id); }catch(e){} drop(timers,id); return null; };
  Q.listen=function(target,type,fn,opts){
    var rec={target:target,type:type,fn:fn,opts:opts,active:false};
    try{ target.addEventListener(type,fn,opts); rec.active=true; listeners.push(rec); }catch(e){}
    return function(){
      if(!rec.active) return; rec.active=false;
      try{ rec.target.removeEventListener(rec.type,rec.fn,rec.opts); }catch(e){}
      drop(listeners,rec);
    };
  };
  Q.cleanup=function(fn){ if(typeof fn==='function') cleanups.push(fn); return fn; };
  Q.schedule=function(name,fn){
    if(!Q.installed) return;
    if(fn){ tasks[name]=fn; }
    if(!tasks[name]) return;
    pending[name]=tasks[name];
    if(queued) return; queued=true;
    Promise.resolve().then(function(){
      if(!Q.installed){ pending={}; queued=false; return; }
      var run=pending; pending={}; queued=false;
      Object.keys(run).forEach(function(k){ try{ run[k](); }catch(e){} });
    });
  };
  function element(node){ if(!node) return null; return node.nodeType===1?node:node.parentElement; }
  function nodeTouches(node,selectors){
    var el=element(node); if(!el) return false;
    for(var i=0;i<selectors.length;i++){
      var s=selectors[i];
      try{ if(el.matches(s)||el.closest(s)||el.querySelector(s)) return true; }catch(e){}
    }
    return false;
  }
  function recordTouches(r,selectors){
    if(nodeTouches(r.target,selectors)) return true;
    for(var i=0;i<r.addedNodes.length;i++) if(nodeTouches(r.addedNodes[i],selectors)) return true;
    for(var j=0;j<r.removedNodes.length;j++) if(nodeTouches(r.removedNodes[j],selectors)) return true;
    return false;
  }
  Q.watch=function(name,selectors,fn){
    if(typeof selectors==='string') selectors=[selectors];
    tasks[name]=fn; watchers.push({name:name,selectors:selectors,fn:fn});
    Q.schedule(name,fn);
  };
  Q.onMutations=function(fn){ mutationSubs.push(fn); return function(){ drop(mutationSubs,fn); }; };
  Q.trigger=function(name){ Q.schedule(name); };
  Q.revert=function(){
    if(!Q.installed) return true; Q.installed=false;
    if(observer){ try{ observer.disconnect(); }catch(e){} observer=null; }
    while(timers.length) Q.cancel(timers[timers.length-1]);
    while(listeners.length){ var l=listeners.pop(); if(l.active){ try{ l.target.removeEventListener(l.type,l.fn,l.opts); }catch(e){} l.active=false; } }
    for(var i=cleanups.length-1;i>=0;i--){ try{ cleanups[i](); }catch(e){} }
    cleanups=[]; watchers=[]; mutationSubs=[]; tasks={}; pending={}; queued=false;
    return true;
  };
  Q.stats=function(){ return {timers:timers.length,listeners:listeners.length,watchers:watchers.length,observer:!!observer}; };
  window.__mlsB18QA=Q;
  try{
    observer=new MutationObserver(function(records){
      if(!Q.installed) return;
      mutationSubs.slice().forEach(function(fn){ try{ fn(records); }catch(e){} });
      watchers.forEach(function(w){
        for(var i=0;i<records.length;i++) if(recordTouches(records[i],w.selectors)){ Q.schedule(w.name,w.fn); break; }
      });
    });
    observer.observe(document.documentElement,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['class','style']});
  }catch(e){}
})();
var __mlsB18Q=window.__mlsB18QA;

/* __mlsCalDataFix — calendar month/day render-before-data race + wipe-on-error.
 * ROOT CAUSES FIXED:
 *  (1) loadCalendar() sets _calAppts=[] when the fetch fails -> a transient
 *      network/401 blip blanks the whole month until a manual re-render.
 *  (2) Nothing re-renders the month grid when _calAppts changes after the
 *      first paint -> day cells show no badges/chips even though data is there.
 * FIX: keep-last-good on failed refresh + a light change-watcher that re-renders
 * the calendar when appointment data actually changes and the view is visible. */
(function(){
  "use strict";
  if(window.__mlsCalDataFix) return; window.__mlsCalDataFix={v:'b18',keptGood:0,rerenders:0};
  var M=window.__mlsCalDataFix;
  function visible(el){ return !!(el && el.offsetParent!==null); }
  function calView(){ return document.getElementById('calendarView'); }
  function sig(){
    var a=window._calAppts; if(!a||!a.length) return '0';
    var f=a[0]||{}, l=a[a.length-1]||{};
    return a.length+':'+(f.id||'')+':'+(l.id||'')+':'+(f.appt_date||'')+':'+(l.appt_date||'');
  }
  /* (1) resilient loadCalendar */
  var origLoad=null, wrappedLoad=null;
  function wrapLoad(){
    if(typeof window.loadCalendar!=='function' || window.loadCalendar.__mlsWrapped) return;
    var orig=window.loadCalendar;
    var wrapped=function(){
      var snap=window._calAppts, hadData=!!(snap&&snap.length);
      var p; try{ p=orig.apply(this,arguments); }catch(e){ p=null; }
      return Promise.resolve(p).then(function(r){
        try{
          var authoritativeEmpty=!!(r&&r.applied===true&&r.authoritative===true&&r.count===0);
          if(hadData && (!window._calAppts || !window._calAppts.length) && !authoritativeEmpty){
            window._calAppts=snap; M.keptGood++;
            try{ if(typeof window.renderCalendar==='function') window.renderCalendar(); }catch(e){}
            try{ if(typeof window.toast==='function') window.toast('Calendar refresh failed — showing the last good data. It will retry automatically.',''); }catch(e){}
          }
        }catch(e){}
        __mlsB18Q.schedule('cal-data-refresh',refresh);
        return r;
      });
    };
    ['__prf','__dkf','__mlsDobWrap','__mlsWrapped'].forEach(function(marker){ if(orig[marker]) wrapped[marker]=orig[marker]; });
    wrapped.__mlsWrapped=1;
    origLoad=orig; wrappedLoad=wrapped;
    window.loadCalendar=wrapped;
  }
  /* (2) change-watcher re-render */
  var last=null, mouseDown=false;
  var lastVis=false;
  function refresh(){
    try{
      wrapLoad();
      var v=visible(calView());
      var s=sig();
      var becameVisible = v && !lastVis;
      lastVis=v;
      if(!v){ last=s; return; }
      if(mouseDown) return;
      if(last===null){ last=s; return; }
      if(s!==last || becameVisible){
        last=s;
        if(typeof window.renderCalendar==='function'){ window.renderCalendar(); M.rerenders++; }
        if(typeof window.renderCalCheckin==='function'){ try{ window.renderCalCheckin(); }catch(e){} }
      }
    }catch(e){}
  }
  function onDown(){ mouseDown=true; }
  function onUp(){ mouseDown=false; __mlsB18Q.schedule('cal-data-refresh',refresh); }
  __mlsB18Q.listen(document,'mousedown',onDown,true);
  __mlsB18Q.listen(document,'mouseup',onUp,true);
  __mlsB18Q.listen(document,'change',function(e){ try{ if(e.target&&e.target.closest('#calendarView,#visitView')) __mlsB18Q.schedule('cal-data-refresh',refresh); }catch(err){} },true);
  __mlsB18Q.watch('cal-data-refresh',['#calendarView','#calDayPanel'],refresh);
  var bootTries=0, bootTimer=null;
  function bootWrap(){
    bootTimer=null; wrapLoad(); refresh();
    if(!wrappedLoad && bootTries++<40) bootTimer=__mlsB18Q.later(bootWrap,250);
  }
  bootWrap();
  __mlsB18Q.cleanup(function(){
    if(bootTimer) bootTimer=__mlsB18Q.cancel(bootTimer);
    try{ if(origLoad && window.loadCalendar===wrappedLoad) window.loadCalendar=origLoad; }catch(e){}
    window.__mlsCalDataFix=null;
  });
})();

/* __mlsPullScreenFix — the athenaOne pull loading UX.
 * PROBLEMS FIXED (reported directly by Michael):
 *  (1) The floating "Pulling from athenaOne…" pill rendered top-center OVER the
 *      app header/search box, and fought the picker modal for attention — it
 *      looked like a glitch ("loading pops up behind the pull screen").
 *  (2) The pill had no elapsed feedback, no close control, and kept spinning
 *      long after a failed pull.
 *  (3) The picker modal itself showed NO progress while a pull ran.
 * FIX: move the pill below the header (top-right), add elapsed seconds + a close
 * button + a hard idle cap; while the picker modal is open, mirror progress into
 * a proper status row INSIDE the modal and hide the floating pill. */
(function(){
  "use strict";
  if(window.__mlsPullScreenFix) return; window.__mlsPullScreenFix={v:'b18'};
  var startTs=0, pulseTimer=null;
  function pill(){ return document.getElementById('mls-pull-progress'); }
  function modal(){ var m=document.getElementById('mlsPickModal'); return (m && m.offsetParent!==null)?m:null; }
  function ensureCss(){
    if(document.getElementById('mls-pullfix-css')) return;
    var s=document.createElement('style'); s.id='mls-pullfix-css';
    s.textContent=
      '#mls-pull-progress{top:64px!important;left:auto!important;right:18px!important;transform:none!important;max-width:420px!important;border:1px solid rgba(120,160,255,.35)!important}'+
      '#mlsPullInModal{display:flex;align-items:center;gap:10px;margin:10px 0 4px;padding:10px 12px;border-radius:10px;background:#eef4ff;border:1px solid #EAF1EE;color:#204034;font:600 13px/1.4 system-ui,sans-serif}'+
      '#mlsPullInModal .mlspim-spin{width:15px;height:15px;border:3px solid #EAF1EE;border-top-color:#2E6A4B;border-radius:50%;animation:mlsppspin .8s linear infinite;flex:none}'+
      '#mlsPullInModal.done .mlspim-spin{display:none}'+
      '#mlsPullInModal .mlspim-x{margin-left:auto;cursor:pointer;color:#2E6A4B;font-weight:800;padding:0 4px}'+
      '#mls-pull-progress .mlspp-close{margin-left:6px;cursor:pointer;font-weight:800;opacity:.75;padding:0 4px}'+
      '#mls-pull-progress .mlspp-elapsed{opacity:.75;font-weight:500;margin-left:4px}';
    (document.head||document.documentElement).appendChild(s);
  }
  function inModalRow(m){
    var r=document.getElementById('mlsPullInModal');
    if(!r){
      r=document.createElement('div'); r.id='mlsPullInModal';
      r.innerHTML='<span class="mlspim-spin"></span><span class="mlspim-txt"></span><span class="mlspim-x" title="Hide">×</span>';
      r.querySelector('.mlspim-x').onclick=function(){ r.remove(); };
      var card=m.firstElementChild||m;
      var anchor=card.querySelector('.mlspk-tabs, .mlspk-head, h3, h2');
      if(anchor && anchor.parentNode){ anchor.parentNode.insertBefore(r, anchor.nextSibling); }
      else card.insertBefore(r, card.firstChild);
    }
    return r;
  }
  function update(){
    try{
      ensureCss();
      var p=pill();
      if(!p){ if(pulseTimer) pulseTimer=__mlsB18Q.cancel(pulseTimer); return; }
      var showing = p.style.display!=='none' && p.style.display!=='';
      var txtEl=p.querySelector('.mlspp-txt');
      var txt=txtEl?txtEl.textContent:'';
      var spinning = p.querySelector('.mlspp-spin') && p.querySelector('.mlspp-spin').style.display!=='none';
      /* elapsed + close on the pill */
      if(showing){
        if(!startTs) startTs=Date.now();
        if(!p.querySelector('.mlspp-close')){
          var x=document.createElement('span'); x.className='mlspp-close'; x.textContent='×'; x.title='Hide';
          x.onclick=function(){ p.style.display='none'; };
          p.appendChild(x);
        }
        if(spinning){
          var el=p.querySelector('.mlspp-elapsed');
          if(!el){ el=document.createElement('span'); el.className='mlspp-elapsed'; if(txtEl&&txtEl.parentNode) txtEl.parentNode.insertBefore(el, txtEl.nextSibling); }
          var secs=Math.round((Date.now()-startTs)/1000);
          if(el.textContent!==secs+'s') el.textContent=secs+'s';
          if(secs>45 && txtEl && !/open Calendar/i.test(txt)){ txtEl.textContent='Still pulling… if nothing happens, open Calendar → View Calendar in your athenaOne tab (the day grid), then retry.'; }
          if(secs>100){ p.style.display='none'; startTs=0; }
          else if(!pulseTimer){ pulseTimer=__mlsB18Q.later(function(){ pulseTimer=null; update(); },1000); }
        } else { startTs=0; }
      } else { startTs=0; if(pulseTimer) pulseTimer=__mlsB18Q.cancel(pulseTimer); }
      /* mirror into the picker modal */
      var m=modal();
      if(m && showing){
        if(p.style.visibility!=='hidden') p.style.visibility='hidden';
        var r=inModalRow(m);
        var t=r.querySelector('.mlspim-txt');
        var e2=Math.round((Date.now()-(startTs||Date.now()))/1000);
        var mt=(txt||'Pulling from athenaOne…')+(spinning&&e2>0?(' · '+e2+'s'):'');
        if(t && t.textContent!==mt) t.textContent=mt;
        r.classList.toggle('done', !spinning);
      } else {
        if(p && p.style.visibility) p.style.visibility='';
        if(!showing){ var r2=document.getElementById('mlsPullInModal'); if(r2 && r2.classList.contains('done')){ /* leave result visible */ } }
      }
    }catch(e){}
  }
  __mlsB18Q.watch('pull-screen',['#mls-pull-progress','#mlsPickModal'],update);
  __mlsB18Q.cleanup(function(){
    if(pulseTimer) pulseTimer=__mlsB18Q.cancel(pulseTimer);
    var p=pill();
    if(p){
      p.style.visibility='';
      var close=p.querySelector('.mlspp-close'); if(close) close.remove();
      var elapsed=p.querySelector('.mlspp-elapsed'); if(elapsed) elapsed.remove();
    }
    var row=document.getElementById('mlsPullInModal'); if(row) row.remove();
    var css=document.getElementById('mls-pullfix-css'); if(css) css.remove();
    window.__mlsPullScreenFix=null;
  });
})();
/* __mlsWbSafetyGate — LAST-LINE writeback safety gate + preview.
 * Every chart-WRITE message the app sends to the MLS Assist extension funnels
 * through window.postMessage. This module intercepts the write-capable types
 * (paste note, push visit, prep procedure template, sign&save) and shows ONE
 * consolidated confirm screen before anything leaves the app:
 *   - patient match (MLS active patient vs open Athena chart, name + DOB + id)
 *   - destination (from __mlsWbRouter) with ORDER-destination hard block
 *   - full content preview
 *   - stale-context, duplicate-write and order-language checks
 *   - optional test lock: localStorage 'mls_wb_test_lock' = a patient name ->
 *     writes to ANY other patient are hard-blocked (used for sandbox QA).
 * Read-type messages (pull schedule, search, read chart…) are untouched.
 * The gate NEVER signs, never clicks anything in Athena, and cancels cleanly. */
(function(){
  "use strict";
  if(window.__MLS_PUBLIC_PREVIEW && window.__MLS_PUBLIC_PREVIEW.enabled===true) return;
  if(window.__mlsWbSafetyGate && window.__mlsWbSafetyGate.installed) return;
  var GATED=/^mlsApp(PasteNote|PasteRequest|PushVisit|PrepProcTemplate|PrepProcTemplateRequest|SignAndSave)$/;
  var originalPost=window.postMessage;
  var origPost=originalPost.bind(window);
  var open=false, activeHost=null;
  var api={installed:true,v:'b18',intercepted:0,confirmed:0,blocked:0,cancelled:0};
  window.__mlsWbSafetyGate=api;

  function safe(f,d){ try{ return f(); }catch(e){ return d; } }
  function trim(s){ return String(s==null?'':s).trim(); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function normName(s){ return trim(s).toLowerCase().replace(/[^a-z' -]/g,'').replace(/\s+/g,' '); }
  function nameTokens(s){ return normName(s).split(' ').filter(function(x){return x.length>1;}).sort().join(' '); }
  function namesMatch(a,b){
    if(!trim(a)||!trim(b)) return false;
    if(nameTokens(a)===nameTokens(b)) return true;
    var A=normName(a).split(' ').filter(Boolean), B=normName(b).split(' ').filter(Boolean);
    var hits=0; A.forEach(function(t){ if(t.length>2 && B.indexOf(t)>=0) hits++; });
    return hits>=2;
  }
  function normDob(s){
    s=trim(s); if(!s) return '';
    var m=s.match(/(\d{4})-(\d{2})-(\d{2})/); if(m) return m[2]+'/'+m[3]+'/'+m[1];
    m=s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if(m){ var y=m[3].length===2?('19'+m[3]):m[3]; return ('0'+m[1]).slice(-2)+'/'+('0'+m[2]).slice(-2)+'/'+y; }
    return s;
  }
  function hash(s){ var h=5381,i; s=String(s||''); for(i=0;i<s.length;i++){ h=((h<<5)+h+s.charCodeAt(i))|0; } return String(h); }
  function testLock(){ return trim(safe(function(){return localStorage.getItem('mls_wb_test_lock');},'')); }
  function activePt(){
    return safe(function(){ return (typeof window.activePatient==='function' && window.activePatient()) || {}; },{})||{};
  }
  function contentOf(msg){
    return trim(msg.note||msg.text||msg.content||msg.body||(msg.payload&&(msg.payload.note||msg.payload.text))||'');
  }
  /* independent chart re-read, best effort, read-only */
  function readChart(){
    return new Promise(function(resolve){
      var ap=window.__mlsAthenaAutoPull;
      var fns=['readOpenChartIdentity','readChartIdentity','chartIdentity','readIdentity'];
      for(var i=0;i<fns.length;i++){
        if(ap && typeof ap[fns[i]]==='function'){
          try{
            var r=ap[fns[i]]();
            Promise.resolve(r).then(function(x){ resolve(x&&(x.identity||x)||null); },function(){ resolve(null); });
            return;
          }catch(e){}
        }
      }
      /* fall back: ask the extension directly (read-only chart read) */
      var done=false, off=null, to=__mlsB18Q.later(function(){ if(!done){done=true; if(off) off(); resolve(null);} },6000);
      function on(e){
        var d=e&&e.data; if(!d||d.source!=='mls-ext') return;
        if(d.type==='mlsAppChartResult'||d.type==='mlsAppCaptureResult'){
          if(done) return; done=true; to=__mlsB18Q.cancel(to);
          if(off) off();
          var idn=(d.resp&&(d.resp.identity||d.resp.patient))||d.identity||null;
          resolve(idn);
        }
      }
      try{ off=__mlsB18Q.listen(window,'message',on); origPost({source:'mls-app',type:'mlsAppReadChart'},'*'); }
      catch(e){ to=__mlsB18Q.cancel(to); if(off) off(); resolve(null); }
    });
  }
  function destFor(msg){
    var kind = msg.kind || (/(PrepProcTemplate)/.test(msg.type)?'opnote':(/SignAndSave/.test(msg.type)?'note':'note'));
    var r=window.__mlsWbRouter;
    var t=safe(function(){ return r&&typeof r.get==='function'?r.get(kind):null; },null);
    var label=(msg.sectionName||msg.section)?String(msg.sectionName||msg.section):(t?t.label:'the open chart note field');
    var section=String((t&&t.section)||msg.section||'').toLowerCase();
    var orderTarget = /order|cpt/.test(section) || /order/i.test(String(msg.sectionName||''));
    return {kind:kind,label:label,section:section,orderTarget:orderTarget};
  }
  var lastPtName=trim(activePt().name), lastPtSwitch=0;
  function notePatientSwitch(){
    try{ var n=trim(activePt().name); if(n!==lastPtName){ lastPtName=n; lastPtSwitch=Date.now(); } }catch(e){}
  }
  __mlsB18Q.watch('wb-patient-switch',['#patientBar','#heroPtName','#patientsView'],notePatientSwitch);
  __mlsB18Q.listen(document,'input',function(e){ try{ if(e.target&&e.target.id==='heroPtName') notePatientSwitch(); }catch(err){} },true);
  __mlsB18Q.listen(document,'change',function(e){ try{ if(e.target&&e.target.id==='heroPtName') notePatientSwitch(); }catch(err){} },true);

  function log(entry){
    try{
      var k='mlsWbGateLog'; var arr=JSON.parse(sessionStorage.getItem(k)||'[]');
      arr.push(entry); if(arr.length>80) arr=arr.slice(-80);
      sessionStorage.setItem(k,JSON.stringify(arr));
    }catch(e){}
  }
  api.log=function(){ return safe(function(){return JSON.parse(sessionStorage.getItem('mlsWbGateLog')||'[]');},[]); };
  api.setTestLock=function(n){ try{ localStorage.setItem('mls_wb_test_lock',String(n||'')); }catch(e){} };
  api.clearTestLock=function(){ try{ localStorage.removeItem('mls_wb_test_lock'); }catch(e){} };

  function row(state,text){
    var ic = state==='ok' ? '✓' : (state==='warn' ? '⚠' : '⛔');
    var col= state==='ok' ? '#2E6A4B' : (state==='warn' ? '#B07636' : '#B23B3B');
    return '<div style="display:flex;gap:8px;align-items:flex-start;margin:3px 0;font:500 12.5px/1.45 system-ui"><span style="color:'+col+';font-weight:800;flex:none">'+ic+'</span><span style="color:#204034">'+text+'</span></div>';
  }

  function showGate(msg,args){
    notePatientSwitch();
    open=true; api.intercepted++;
    var pt=activePt();
    var note=contentOf(msg);
    var dest=destFor(msg);
    var isSign=/SignAndSave/.test(String(msg.type));
    var lock=testLock();
    var fpr=hash(String(msg.type)+'|'+normName(pt.name)+'|'+note.slice(0,4000));
    var seen=safe(function(){ return JSON.parse(sessionStorage.getItem('mlsWbSent')||'{}'); },{});
    var dup=seen[fpr] && (Date.now()-seen[fpr]<20*60*1000);

    var host=document.createElement('div'); host.id='mlsWbGate';
    host.style.cssText='position:fixed;inset:0;z-index:2147483200;display:flex;align-items:flex-start;justify-content:center;background:rgba(26,33,28,.55);padding:4vh 14px 14px;overflow:auto;font-family:system-ui,-apple-system,\'Segoe UI\',sans-serif';
    document.body.appendChild(host); activeHost=host;

    var offOutside=null;
    function close(){ try{host.remove();}catch(e){} host.__autoT=__mlsB18Q.cancel(host.__autoT); if(offOutside){ offOutside(); offOutside=null; } if(activeHost===host) activeHost=null; open=false; }
    function cancel(reason){
      api.cancelled++; close();
      log({ts:Date.now(),type:msg.type,patient:trim(pt.name),decision:'cancelled',reason:reason||'user'});
      /* unblock the calling flow immediately instead of letting it hit its 60s timeout */
      safe(function(){ origPost({source:'mls-ext',type:'mlsAppPasteResult',resp:{error:'cancelled at the MLS confirmation screen — nothing was written'}},'*'); });
      safe(function(){ if(typeof window.toast==='function') window.toast('Cancelled — nothing was written to Athena.',''); });
    }
    /* keep the gate shorter than the writeback engine's own 60s timeout so the
       two flows can never desync into a late surprise paste */
    host.__autoT=__mlsB18Q.later(function(){ if(open){ cancel('timeout'); safe(function(){ if(typeof window.toast==='function') window.toast('The final write check waited 45 seconds with no answer — nothing was written. Click Send again and confirm the check when it appears.','err'); }); } },45000);

    readChart().then(function(chart){
      chart=chart||{};
      var chartName=trim(chart.name), chartDob=normDob(chart.dob), ptDob=normDob(pt.dob);
      var chartMrn=trim(chart.mrn||chart.id||chart.patientId||''), ptMrn=trim(pt.mrn||pt.patient_external_id||pt.athena_id||'');
      var checks=[], hard=[], needAck=[];

      /* 1-2. MLS patient + content present */
      if(trim(pt.name)) checks.push(row('ok','MLS active patient: <b>'+esc(pt.name)+'</b>'+(ptDob?(' · DOB '+esc(ptDob)):'')));
      else hard.push('No active MLS patient is selected.');
      if(note) checks.push(row('ok','Content ready ('+note.length+' characters) — preview below.'));
      else if(!/PrepProcTemplate/.test(msg.type)) hard.push('There is no content to write.');

      /* 3-5. chart identity + name/DOB/id match */
      if(chartName){
        var nOk=namesMatch(pt.name,chartName);
        var dOk=(!chartDob||!ptDob)?null:(chartDob===ptDob);
        checks.push(row(nOk?'ok':'bad','Open Athena chart: <b>'+esc(chartName)+'</b>'+(chartDob?(' · DOB '+esc(chartDob)):'')+(nOk?' — name matches':' — NAME DOES NOT MATCH')));
        if(!nOk) hard.push('The open Athena chart ('+chartName+') is not the MLS patient ('+(pt.name||'?')+').');
        if(dOk===true) checks.push(row('ok','DOB matches.'));
        else if(dOk===false){ checks.push(row('bad','DOB mismatch: MLS '+esc(ptDob)+' vs chart '+esc(chartDob)+'.')); hard.push('DOB mismatch between MLS and the open chart.'); }
        else checks.push(row('warn','DOB not available on both sides — verify visually in Athena.'));
        if(chartMrn&&ptMrn){ if(chartMrn===ptMrn) checks.push(row('ok','Patient ID matches ('+esc(chartMrn)+').')); else { checks.push(row('bad','Patient ID mismatch ('+esc(ptMrn)+' vs '+esc(chartMrn)+').')); hard.push('Patient ID mismatch.'); } }
      } else {
        checks.push(row('warn','Could not independently re-read the open chart — the writeback engine will verify name + DOB again before pasting, and blocks on mismatch.'));
      }

      /* 6. destination + order block */
      checks.push(row(dest.orderTarget?'bad':'ok','Destination: <b>'+esc(dest.label)+'</b>'));
      if(dest.orderTarget) hard.push('This destination targets an ORDERS/CPT area. MLS never writes into order-entry workflows — change the destination (e.g. to the clinical note) and try again.');
      if(isSign){ checks.push(row('warn','This action asks Athena to SAVE the note. MLS never signs; you review and sign in Athena yourself.')); needAck.push('sign'); }

      /* 7. order-language content scan */
      if(note && /\b(place (an? )?order|send (the )?(rx|prescription)|e-?prescribe|submit (an? )?order|order entry)\b/i.test(note)){
        checks.push(row('warn','The content mentions placing orders/prescriptions. MLS only writes TEXT into the note — it never creates orders. Confirm the wording is documentation, not an order request.'));
        needAck.push('orderlang');
      }
      /* 8. stale patient context */
      if(Date.now()-lastPtSwitch<8000 && lastPtSwitch>0){ checks.push(row('warn','The active patient changed seconds ago — double-check you are on the right chart.')); needAck.push('stale'); }
      /* 9. visit-day context */
      var vday=safe(function(){ var d=document.querySelector('#visitView input[type=date]'); return d&&d.value; },'');
      var today=new Date(); var tkey=today.getFullYear()+'-'+('0'+(today.getMonth()+1)).slice(-2)+'-'+('0'+today.getDate()).slice(-2);
      if(vday && vday!==tkey){ checks.push(row('warn','MLS is viewing '+esc(vday)+' (not today) — make sure this writeback belongs to that visit.')); needAck.push('day'); }
      /* 10. duplicate write */
      if(dup){ checks.push(row('warn','An identical write for this patient was already confirmed in the last 20 minutes — writing again may duplicate the note.')); needAck.push('dup'); }
      /* 11. test lock */
      if(lock){
        var lockOk = namesMatch(lock, pt.name) && (!chartName || namesMatch(lock, chartName));
        if(lockOk) checks.push(row('ok','Test lock active: writes limited to <b>'+esc(lock)+'</b> — this patient matches.'));
        else { checks.push(row('bad','TEST LOCK: writes are currently limited to <b>'+esc(lock)+'</b>. This write is to a different patient and is blocked.')); hard.push('Test lock: only '+lock+' may be written to right now.'); }
      }

      var blocked=hard.length>0;
      if(blocked) api.blocked++;
      var card=document.createElement('div');
      card.style.cssText='background:#fff;border-radius:16px;max-width:660px;width:100%;box-shadow:0 24px 70px rgba(20,33,28,.28);padding:18px 20px;border:1px solid #E7E5DD';
      card.innerHTML=
        '<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">'+
          '<span style="font-size:19px">'+(blocked?'⛔':'🛡️')+'</span>'+
          '<b style="font-size:17.5px;color:#1A211C;font-family:Newsreader,Georgia,serif;font-weight:600">'+(blocked?'Write blocked':'Final check — write to athenaOne')+'</b>'+
          '<span style="margin-left:auto;font-size:11px;font-weight:800;letter-spacing:.05em;color:#B07636;background:#FCF8EF;border:1px solid #EFE4CE;border-radius:7px;padding:2px 8px">WRITES TO CHART</span>'+
        '</div>'+
        '<div style="margin:8px 0 2px">'+checks.join('')+'</div>'+
        (blocked?('<div style="margin:10px 0;padding:10px 12px;border-radius:10px;background:#FBF1EF;border:1px solid #EAC8C3;color:#B23B3B;font:600 12.5px/1.5 system-ui">'+hard.map(esc).join('<br>')+'</div>'):'')+
        (note?('<div style="font:700 11px/1 system-ui;color:#79837C;letter-spacing:.04em;margin:10px 0 4px;letter-spacing:.04em">CONTENT PREVIEW</div>'+
        '<div style="max-height:200px;overflow:auto;border:1px solid #E7E5DD;border-radius:10px;padding:10px 12px;background:#FCFBF8;font:12.5px/1.55 ui-monospace,Consolas,monospace;white-space:pre-wrap;color:#1E2B24">'+esc(note.slice(0,6000))+(note.length>6000?'\n…':'')+'</div>'):'')+
        '<div id="mlsWbAcks" style="margin-top:10px"></div>'+
        '<div style="display:flex;gap:10px;margin-top:14px;align-items:center">'+
          '<button id="mlsWbCancel" style="cursor:pointer;border:1px solid #E7E5DD;background:#fff;color:#55605A;font:600 13px system-ui;border-radius:10px;padding:9px 16px">Cancel — write nothing</button>'+
          (blocked?'':'<button id="mlsWbGo" style="cursor:pointer;border:1px solid #204034;background:#204034;color:#fff;font:700 13px system-ui;border-radius:10px;padding:9px 16px">Confirm & write</button>')+
          '<span style="margin-left:auto;font:500 11px system-ui;color:#79837C">MLS never signs or places orders.</span>'+
        '</div>';
      host.appendChild(card);

      var ackBox=card.querySelector('#mlsWbAcks');
      if(!blocked && needAck.length){
        ackBox.innerHTML='<label style="display:flex;gap:8px;align-items:flex-start;font:600 12.5px/1.5 system-ui;color:#B07636;background:#FCF8EF;border:1px solid #EFE4CE;border-radius:10px;padding:9px 11px;cursor:pointer"><input type="checkbox" id="mlsWbAckCb" style="margin-top:2px">I read the warnings above and confirm this write is correct.</label>';
      }
      var go=card.querySelector('#mlsWbGo');
      if(go){
        function syncGo(){ var cb=card.querySelector('#mlsWbAckCb'); go.disabled=!!(cb&&!cb.checked); go.style.opacity=go.disabled?'.5':'1'; }
        syncGo();
        var cb=card.querySelector('#mlsWbAckCb'); if(cb) cb.onchange=syncGo;
        go.onclick=function(){
          if(go.disabled) return;
          api.confirmed++;
          try{ seen[fpr]=Date.now(); sessionStorage.setItem('mlsWbSent',JSON.stringify(seen)); }catch(e){}
          log({ts:Date.now(),type:msg.type,patient:trim(pt.name),chart:chartName||'(unread)',dest:dest.label,decision:'confirmed'});
          close();
          try{ msg.__mlsGateOk=1; origPost.apply(null,args); }catch(e){ try{ origPost(msg,'*'); }catch(e2){} }
        };
      }
      card.querySelector('#mlsWbCancel').onclick=function(){ cancel('user'); };
      offOutside=__mlsB18Q.listen(host,'mousedown',function(e){ if(e.target===host) cancel('outside'); });
      log({ts:Date.now(),type:msg.type,patient:trim(pt.name),chart:chartName||'(unread)',dest:dest.label,decision:blocked?'blocked':'shown',hard:hard});
    });
  }

  var wrappedPost=function(message,targetOrigin,transfer){
    try{
      if(message && typeof message==='object' && message.source==='mls-app' && GATED.test(String(message.type||'')) && !message.__mlsGateOk){
        if(open){ safe(function(){ if(typeof window.toast==='function') window.toast('A write confirmation is already open — finish that one first.','err'); }); return; }
        showGate(message,[message,targetOrigin||'*',transfer]);
        return;
      }
    }catch(e){}
    /* pass through EXACTLY what the caller passed (postMessage(msg) with no
       targetOrigin must keep its default-origin behavior) */
    return origPost.apply(null, Array.prototype.slice.call(arguments));
  };
  window.postMessage=wrappedPost;
  api.revert=__mlsB18Q.revert;
  __mlsB18Q.cleanup(function(){
    if(activeHost){ try{ activeHost.remove(); }catch(e){} activeHost=null; }
    open=false;
    try{ if(window.postMessage===wrappedPost) window.postMessage=originalPost; }catch(e){}
    window.__mlsWbSafetyGate=null;
  });
})();
/* __mlsSmartEmpty — smart empty states for empty clinic days (e.g. Sundays).
 * The old state was a bare "No patients on the Athena calendar for this day."
 * even when (a) OTHER providers do have patients that day, or (b) the next
 * clinic day is one tap away. Now the box says which of those is true and
 * offers "Show all providers" / "Jump to next clinic day". Read-only. */
(function(){
  "use strict";
  if(window.__mlsSmartEmpty) return; window.__mlsSmartEmpty={v:'b18'};
  function trim(s){ return String(s==null?'':s).trim(); }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function normProv(s){
    return trim(s).toLowerCase().replace(/[_,.\/]+/g,' ').replace(/\b(md|do|pa-?c|np|crna|aprn|dpm|dds|dmd|crnp|dr)\b/g,'').replace(/[^a-z' -]/g,'').replace(/\s+/g,' ').trim().split(' ').sort().join(' ');
  }
  function dateOf(a){ return String(a&&(a.appt_date||a.start_at)||'').slice(0,10); }
  function selDay(){
    var d=document.querySelector('#visitView input[type=date]');
    if(d&&d.value) return d.value;
    var n=new Date(); return n.getFullYear()+'-'+('0'+(n.getMonth()+1)).slice(-2)+'-'+('0'+n.getDate()).slice(-2);
  }
  function provName(){
    try{
      for(var i=0;i<localStorage.length;i++){ var k=localStorage.key(i); if(/::pullProvider$/.test(k)){ var v=localStorage.getItem(k); if(trim(v)) return v; } }
    }catch(e){}
    return 'your provider';
  }
  function pretty(ds){
    try{ return new Date(ds+'T12:00').toLocaleDateString([],{weekday:'long',month:'short',day:'numeric'}); }catch(e){ return ds; }
  }
  function build(){
    var box=document.getElementById('mlsPtfBox');
    if(!box || box.offsetParent===null) return;
    if(!/No patients on the Athena calendar/i.test(box.textContent||'') && !box.__mlsSmart) return;
    var all=window._calAppts||[];
    var day=selDay(), prov=provName(), provKey=normProv(prov);
    var dayAll=all.filter(function(a){ return dateOf(a)===day; });
    var dayMine=dayAll.filter(function(a){ return normProv(a.provider||'')===provKey; });
    var futureDays={};
    all.forEach(function(a){ var d=dateOf(a); if(d>day) futureDays[d]=(futureDays[d]||0)+1; });
    var next=Object.keys(futureDays).sort()[0];
    var sig=day+'|'+dayAll.length+'|'+dayMine.length+'|'+(next||'');
    var nativeStamp=/No patients on the Athena calendar/i.test(box.textContent||'');
    if(box.__mlsSmartSig===sig && !nativeStamp) return; /* our content is current */
    box.__mlsSmartSig=sig; box.__mlsSmart=1;
    var h;
    if(dayMine.length>0) { box.__mlsSmart=0; return; } /* not an empty state — leave native */
    if(dayAll.length>0){
      h='<div style="font:600 13px/1.5 system-ui;color:#204034">No patients for <b>'+esc(prov)+'</b> on '+esc(pretty(day))+'.</div>'+
        '<div style="font:500 12.5px/1.5 system-ui;color:#2E6A4B;margin-top:2px">'+dayAll.length+' appointment'+(dayAll.length===1?'':'s')+' exist'+(dayAll.length===1?'s':'')+' for other providers that day.</div>'+
        '<button id="mlsSeAll" style="margin-top:8px;cursor:pointer;border:1px solid #2E6A4B;background:#eef4ff;color:#2E6A4B;font:700 12.5px system-ui;border-radius:9px;padding:7px 12px">Show all providers for this day</button>';
    } else {
      h='<div style="font:600 13px/1.5 system-ui;color:#204034">Nothing on the calendar for '+esc(pretty(day))+'.</div>'+
        (next?('<button id="mlsSeNext" style="margin-top:8px;cursor:pointer;border:1px solid #2E6A4B;background:#eef4ff;color:#2E6A4B;font:700 12.5px system-ui;border-radius:9px;padding:7px 12px">Jump to next clinic day — '+esc(pretty(next))+' ('+futureDays[next]+')</button>'):('<div style="font:500 12.5px system-ui;color:#2E6A4B;margin-top:2px">Pull a day from athenaOne to fill the schedule.</div>'));
    }
    box.innerHTML=h;
    var b1=box.querySelector('#mlsSeAll');
    if(b1) b1.onclick=function(){
      var t=document.getElementById('heroToday');
      if(t){ t.scrollIntoView({behavior:'smooth',block:'center'}); t.style.transition='box-shadow .3s'; t.style.boxShadow='0 0 0 3px #C9DCD2'; __mlsB18Q.later(function(){ t.style.boxShadow=''; },1600); }
    };
    var b2=box.querySelector('#mlsSeNext');
    if(b2) b2.onclick=function(){
      var d=document.querySelector('#visitView input[type=date]');
      if(d){ d.value=next; try{ d.dispatchEvent(new Event('input',{bubbles:true})); d.dispatchEvent(new Event('change',{bubbles:true})); }catch(e){} }
    };
  }
  __mlsB18Q.watch('smart-empty',['#mlsPtfBox','#visitView'],build);
  __mlsB18Q.listen(document,'input',function(e){ try{ if(e.target&&e.target.matches('#visitView input[type=date]')) __mlsB18Q.schedule('smart-empty',build); }catch(err){} },true);
  __mlsB18Q.listen(document,'change',function(e){ try{ if(e.target&&e.target.matches('#visitView input[type=date]')) __mlsB18Q.schedule('smart-empty',build); }catch(err){} },true);
  __mlsB18Q.cleanup(function(){
    var box=document.getElementById('mlsPtfBox');
    if(box){ delete box.__mlsSmart; delete box.__mlsSmartSig; }
    window.__mlsSmartEmpty=null;
  });
})();

/* __mlsJunkNameShield — old pulls stored scrape junk as "patients" (ALL, POST,
 * EPNP, UO, PO, A, Ht…). They pollute the day panel / pick lists and look like
 * data corruption. This hides junk-named rows at RENDER level only (backend
 * rows are untouched) and shows one honest collapsed line instead. */
(function(){
  "use strict";
  if(window.__mlsJunkNameShield) return; window.__mlsJunkNameShield={v:'b18',hidden:0};
  var JUNK=/^(all|post|epnp|ep|en|np|po|uo|ht|vsc\d*|open|frozen|hold|lunch|blocked?|a|x|-{1,3})$/i;
  function isJunk(name){
    name=String(name||'').trim();
    if(!name) return true;
    if(name.length===1) return true;
    if(JUNK.test(name)) return true;
    return false;
  }
  window.__mlsJunkNameShield.isJunk=isJunk;
  function sweep(root,rowSel,nameFrom){
    var rows=root.querySelectorAll(rowSel), marker=root.querySelector('.mls-junk-note');
    for(var i=0;i<rows.length;i++){
      var r=rows[i]; if(r.__mlsJunkChecked && !r.__mlsJunkHidden) continue;
      var nm=nameFrom(r);
      r.__mlsJunkChecked=1;
      if(nm!=null && isJunk(nm)){ if(r.style.display!=='none'){ r.style.display='none'; r.__mlsJunkHidden=1; } }
    }
    var hiddenNow=root.querySelectorAll(rowSel);
    var count=0; for(var j=0;j<hiddenNow.length;j++){ if(hiddenNow[j].__mlsJunkHidden) count++; }
    if(count>0){
      if(!marker){ marker=document.createElement('div'); marker.className='mls-junk-note'; marker.style.cssText='font:500 11.5px/1.4 system-ui;color:#8195ab;padding:6px 10px;cursor:pointer'; root.appendChild(marker); }
      marker.textContent=count+' unreadable entr'+(count===1?'y':'ies')+' hidden (scrape artifacts) — click to show';
      marker.onclick=function(){
        var rs=root.querySelectorAll(rowSel);
        for(var k=0;k<rs.length;k++){ if(rs[k].__mlsJunkHidden){ rs[k].style.display=''; rs[k].__mlsJunkHidden=0; } }
        marker.remove();
      };
    } else if(marker){ marker.remove(); }
  }
  function run(){
    try{
      var dp=document.getElementById('calDayPanel');
      if(dp && dp.offsetParent!==null){
        sweep(dp,'[onclick*="calApptInfo"], [data-appt]',function(r){
          var t=(r.textContent||'').trim();
          var m=t.match(/^\s*\d{1,2}:\d{2}\s*(AM|PM)?\s*(.+?)(booked|Details|$)/i);
          return m?m[2].trim():null;
        });
      }
    }catch(e){}
  }
  __mlsB18Q.watch('junk-name-shield',['#calDayPanel'],run);
  __mlsB18Q.cleanup(function(){
    var dp=document.getElementById('calDayPanel');
    if(dp){
      var rows=dp.querySelectorAll('[onclick*="calApptInfo"], [data-appt]');
      for(var i=0;i<rows.length;i++){
        if(rows[i].__mlsJunkHidden) rows[i].style.display='';
        delete rows[i].__mlsJunkHidden; delete rows[i].__mlsJunkChecked;
      }
      var marker=dp.querySelector('.mls-junk-note'); if(marker) marker.remove();
    }
    window.__mlsJunkNameShield=null;
  });
})();

/* __mlsUpNextDayFix — the Up-Next strip said "N still ahead today" while
 * actually showing the NEXT clinic day's patients (e.g. Monday's list on a
 * Sunday). Root cause: the strip picks the next chronological appointment
 * without labelling its DAY. Fix: when the referenced appointment is not on
 * the viewed day, say the day honestly. Pure text correction at render level. */
(function(){
  "use strict";
  if(window.__mlsUpNextDayFix) return; window.__mlsUpNextDayFix={v:'b18',fixes:0};
  function todayKey(){ var n=new Date(); return n.getFullYear()+'-'+('0'+(n.getMonth()+1)).slice(-2)+'-'+('0'+n.getDate()).slice(-2); }
  function findApptByName(nm){
    nm=String(nm||'').trim().toLowerCase(); if(!nm) return null;
    var a=window._calAppts||[];
    for(var i=0;i<a.length;i++){ if(String(a[i].name||'').trim().toLowerCase()===nm) return a[i]; }
    return null;
  }
  function run(){
    try{
      var vv=document.getElementById('visitView');
      if(!vv || vv.offsetParent===null) return;
      if(!/still ahead today/i.test(vv.textContent||'')) return;
      var els=vv.querySelectorAll('div,span,section');
      for(var i=0;i<els.length;i++){
        var el=els[i];
        if(el.children.length>10) continue;
        var t=el.textContent||'';
        if(!/still ahead today/i.test(t) || t.length>220) continue;
        if(el.__mlsUpFixed===t) continue;
        var m=t.match(/UP NEXT\s+(\d{1,2}:\d{2}\s*(?:AM|PM))\s+(.+?)\s*·/i);
        var ap=m?findApptByName(m[2]):null;
        var d=ap?String(ap.appt_date||ap.start_at||'').slice(0,10):'';
        if(d && d!==todayKey()){
          var lbl; try{ lbl=new Date(d+'T12:00').toLocaleDateString([],{weekday:'short',month:'short',day:'numeric'}); }catch(e){ lbl=d; }
          var walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
          var node; while((node=walker.nextNode())){
            if(/still ahead today/i.test(node.nodeValue)){ node.nodeValue=node.nodeValue.replace(/still ahead today/i,'scheduled '+lbl); window.__mlsUpNextDayFix.fixes++; }
          }
          el.__mlsUpFixed=el.textContent;
        } else { el.__mlsUpFixed=t; }
      }
    }catch(e){}
  }
  __mlsB18Q.watch('up-next-day',['#visitView'],run);
  __mlsB18Q.cleanup(function(){ window.__mlsUpNextDayFix=null; });
})();

/* __mlsStatusTruthUnify — the tiny Athena status dot could say "not connected"
 * while the picker modal simultaneously said "athenaOne is connected" (two
 * different probes). The dot now mirrors the app's single connection-truth
 * source when it is available, so the two can no longer contradict. */
(function(){
  "use strict";
  if(window.__mlsStatusTruthUnify) return; window.__mlsStatusTruthUnify={v:'b18'};
  function truth(){
    var ct=window.__mlsConnTruth||window.__mlsUxUnify;
    if(!ct) return null;
    try{
      if(typeof ct.connected==='function') return !!ct.connected();
      if(typeof ct.connected==='boolean') return ct.connected;
      if(typeof ct.state==='string') return /connected|ok|green/i.test(ct.state);
      if(typeof ct.get==='function'){ var s=ct.get(); if(s&&typeof s.connected!=='undefined') return !!s.connected; }
    }catch(e){}
    return null;
  }
  function sync(){
    try{
      var dot=document.getElementById('mlsAthenaStatusDot');
      if(!dot) return;
      var tr=truth(); if(tr===null) return;
      var saysDown=/not connected|open a signed-in/i.test(dot.textContent||'');
      if(tr && saysDown){
        var span=dot.querySelector('span,div,b')||dot;
        span.textContent='athenaOne connected';
        dot.style.opacity='.85';
      }
    }catch(e){}
  }
  __mlsB18Q.watch('status-truth',['#mlsAthenaStatusDot','#mlsPickModal'],sync);
  __mlsB18Q.listen(window,'message',function(){ __mlsB18Q.schedule('status-truth',sync); });
  __mlsB18Q.listen(window,'focus',function(){ __mlsB18Q.schedule('status-truth',sync); });
  __mlsB18Q.listen(window,'online',function(){ __mlsB18Q.schedule('status-truth',sync); });
  __mlsB18Q.listen(window,'offline',function(){ __mlsB18Q.schedule('status-truth',sync); });
  __mlsB18Q.listen(document,'visibilitychange',function(){ if(!document.hidden) __mlsB18Q.schedule('status-truth',sync); });
  __mlsB18Q.cleanup(function(){ window.__mlsStatusTruthUnify=null; });
})();

/* __mlsFabStack — the bottom-right floating buttons (mic / Add patient /
 * MLS Agent) overlapped each other, causing missed clicks. Stack them with
 * fixed slots and consistent spacing. */
(function(){
  "use strict";
  if(window.__mlsFabStack) return; window.__mlsFabStack={v:'b18'};
  /* Share the exact coordinates owned by __mlsUiCleanupB26. The previous
     2px disagreement made the two idempotent healers rewrite each other
     forever (three style mutations every ~800ms). */
  var SLOTS=[['mlsP1AgFab',16],['mlsAddPtLauncher',70],['mlsVoiceFab',124]];
  var originals=[];
  function remember(el){
    for(var i=0;i<originals.length;i++) if(originals[i].el===el) return;
    originals.push({el:el,bottom:el.style.getPropertyValue('bottom'),bottomP:el.style.getPropertyPriority('bottom'),right:el.style.getPropertyValue('right'),rightP:el.style.getPropertyPriority('right'),left:el.style.getPropertyValue('left'),leftP:el.style.getPropertyPriority('left')});
  }
  function place(){
    try{
      for(var i=0;i<SLOTS.length;i++){
        var el=document.getElementById(SLOTS[i][0]); if(!el) continue;
        var bottom=SLOTS[i][1]+'px';
        if(el.__mlsSlot===SLOTS[i][1] && el.style.getPropertyValue('bottom')===bottom && el.style.getPropertyValue('right')==='16px' && el.style.getPropertyValue('left')==='auto') continue;
        remember(el);
        el.style.setProperty('bottom',bottom,'important');
        el.style.setProperty('right','16px','important');
        el.style.setProperty('left','auto','important');
        el.__mlsSlot=SLOTS[i][1];
      }
    }catch(e){}
  }
  __mlsB18Q.watch('fab-stack',['#mlsP1AgFab','#mlsAddPtLauncher','#mlsVoiceFab'],place);
  __mlsB18Q.cleanup(function(){
    for(var i=0;i<originals.length;i++){
      var x=originals[i], el=x.el; if(!el) continue;
      el.style.setProperty('bottom',x.bottom,x.bottomP); el.style.setProperty('right',x.right,x.rightP); el.style.setProperty('left',x.left,x.leftP); delete el.__mlsSlot;
    }
    originals=[]; window.__mlsFabStack=null;
  });
})();
/* __mlsAnalysisPolish — Analysis + AI Studio layout hygiene.
 *  (1) Two widget tiles were stuck expanded at ~670px with almost no content —
 *      giant dead whitespace. Auto-collapse a tile that is expanded but empty.
 *  (2) The Study Groups block sat in a half-width column with a dead right
 *      side — make it full-width with an internal two-column grid on desktop.
 *  (3) "Untitled" custom-tool cards get an honest label.
 * Layout only; no data or behavior changes. */
(function(){
  "use strict";
  if(window.__mlsAnalysisPolish) return; window.__mlsAnalysisPolish={v:'b18',collapsed:0};
  function ensureCss(){
    if(document.getElementById('mls-anapolish-css')) return;
    var s=document.createElement('style'); s.id='mls-anapolish-css';
    s.textContent=
      '#mls-sg-root{width:100%!important;max-width:none!important}'+
      '.ax-tile{transition:height .15s ease}'+
      '#mls-sg-root textarea{min-height:74px}';
    (document.head||document.documentElement).appendChild(s);
  }
  function tileEmpty(t){
    var clone=t.cloneNode(true);
    var kill=clone.querySelectorAll('button,.ax-head,h3,h4,[class*=head]');
    for(var i=0;i<kill.length;i++){ kill[i].remove(); }
    var txt=(clone.textContent||'').replace(/\s+/g,' ').trim();
    return txt.length<60;
  }
  function pass(){
    var _av=document.getElementById('analysisView'), _sv=document.getElementById('studioView');
    var roots=[];
    if(_av&&_av.offsetParent!==null) roots.push(_av);
    if(_sv&&_sv.offsetParent!==null) roots.push(_sv);
    if(!roots.length) return;
    ensureCss();
    var tiles=[];
    for(var r=0;r<roots.length;r++) tiles=tiles.concat([].slice.call(roots[r].querySelectorAll('.ax-tile.ax-exp')));
    for(var i=0;i<tiles.length;i++){
      var t=tiles[i];
      if(t.__mlsPolished) continue;
      if(t.offsetHeight>480 && tileEmpty(t)){
        var btn=[].slice.call(t.querySelectorAll('button,span,a')).filter(function(b){ return /collapse/i.test(b.textContent||''); })[0];
        if(btn){ try{ btn.click(); window.__mlsAnalysisPolish.collapsed++; }catch(e){} }
        t.__mlsPolished=1;
      } else if(t.offsetHeight<=480){ t.__mlsPolished=1; }
    }
    var cards=[];
    for(var q=0;q<roots.length;q++) cards=cards.concat([].slice.call(roots[q].querySelectorAll('div,section')));
    for(var j=0;j<cards.length;j++){
      var c=cards[j];
      if(c.childElementCount>0 && c.childElementCount<8){
        var tt=(c.textContent||'').trim();
        if(/^Untitled\s*Open\s*Expand/.test(tt.replace(/\s+/g,' ')) && !c.__mlsUntitledFixed){
          var lbl=[].slice.call(c.querySelectorAll('div,b,span')).filter(function(x){ return (x.textContent||'').trim()==='Untitled'; })[0];
          if(lbl){ lbl.textContent='Untitled tool (from “Build a custom tool”)'; }
          c.__mlsUntitledFixed=1;
        }
      }
    }
  }
  __mlsB18Q.watch('analysis-polish',['#analysisView','#studioView'],pass);
  __mlsB18Q.listen(document,'click',function(e){ try{ if(e.target&&e.target.closest('#nav_analysis,#nav_studio,#analysisView,#studioView')) __mlsB18Q.schedule('analysis-polish',pass); }catch(err){} },true);
  __mlsB18Q.cleanup(function(){
    var css=document.getElementById('mls-anapolish-css'); if(css) css.remove();
    window.__mlsAnalysisPolish=null;
  });
})();

/* __mlsCalmBoot — stable app loading screen.
 * On load the app visibly cycles through layouts while ~180 enhancement modules
 * apply (flash / jumping / "many configurations"). This paints a clean branded
 * veil over the FIRST paint and releases it as soon as the DOM settles
 * (mutation-rate heuristic), max 3.2s, min 450ms, 220ms fade. Login screens
 * release early so sign-in is never delayed. Purely cosmetic. */
(function(){
  "use strict";
  if(window.__mlsCalmBoot) return; window.__mlsCalmBoot={v:'b18',shownMs:0};
  try{
    if(window.__mlsCalmBootDone) return;
    var veil=document.createElement('div'); veil.id='mlsBootVeil';
    veil.style.cssText='position:fixed;inset:0;z-index:2147483602;background:linear-gradient(180deg,#0d1b33,#1E2B24);display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;transition:opacity .22s ease';
    veil.innerHTML='<div style="display:flex;align-items:center;gap:10px"><span style="width:34px;height:34px;border-radius:10px;background:#2E6A4B;display:inline-flex;align-items:center;justify-content:center;color:#fff;font:800 17px system-ui">M</span><span style="font:800 20px system-ui;color:#eaf1ff">MLS <span style="font-weight:500;color:#C9DCD2">Scribe</span></span></div>'+
      '<div style="width:150px;height:4px;border-radius:99px;background:rgba(255,255,255,.14);overflow:hidden"><div id="mlsBootBar" style="width:24%;height:100%;border-radius:99px;background:#C9DCD2;transition:width .5s ease"></div></div>'+
      '<div style="font:500 12px system-ui;color:#C9DCD2">Preparing your workspace…</div>';
    (document.body||document.documentElement).appendChild(veil);
    var t0=Date.now(), muts=0, released=false;
    var offMut=__mlsB18Q.onMutations(function(ms){ muts+=ms.length; });
    var bar=veil.querySelector('#mlsBootBar'), pct=24;
    var barTimer=null, settleTimer=null, failTimer=null, removeTimer=null, fadeTimer=null, fadeRemoveTimer=null, offError=null;
    function stepBar(){
      barTimer=null; if(released) return;
      pct=Math.min(92,pct+9); if(bar) bar.style.width=pct+'%';
      barTimer=__mlsB18Q.later(stepBar,300);
    }
    function release(){
      if(released) return; released=true;
      window.__mlsCalmBootDone=1; window.__mlsCalmBoot.shownMs=Date.now()-t0;
      settleTimer=__mlsB18Q.cancel(settleTimer); barTimer=__mlsB18Q.cancel(barTimer);
      failTimer=__mlsB18Q.cancel(failTimer); removeTimer=__mlsB18Q.cancel(removeTimer);
      if(offMut){ offMut(); offMut=null; } if(offError){ offError(); offError=null; }
      if(bar) bar.style.width='100%';
      fadeTimer=__mlsB18Q.later(function(){ veil.style.opacity='0'; fadeRemoveTimer=__mlsB18Q.later(function(){ try{ veil.remove(); }catch(e){} },260); },80);
    }
    var lastCount=0;
    function checkSettled(){
      settleTimer=null;
      var dt=Date.now()-t0;
      var delta=muts-lastCount; lastCount=muts;
      var login=false;
      try{ var lv=document.getElementById('loginView'); login=!!(lv&&lv.offsetParent!==null); }catch(e){}
      if(dt>=2600) return release();
      if(login && dt>=700) return release();
      if(dt>=450 && delta<90) return release();
      settleTimer=__mlsB18Q.later(checkSettled,220);
    }
    stepBar();
    settleTimer=__mlsB18Q.later(checkSettled,220);
    offError=__mlsB18Q.listen(window,'error',function(){ if(Date.now()-t0>1200) release(); },true);
    /* absolute failsafe: the veil can never outlive 4s no matter what breaks */
    failTimer=__mlsB18Q.later(release,4000);
    removeTimer=__mlsB18Q.later(function(){ try{ var v=document.getElementById('mlsBootVeil'); if(v) v.remove(); }catch(e){} },5200);
    __mlsB18Q.cleanup(function(){
      released=true;
      settleTimer=__mlsB18Q.cancel(settleTimer); barTimer=__mlsB18Q.cancel(barTimer);
      failTimer=__mlsB18Q.cancel(failTimer); removeTimer=__mlsB18Q.cancel(removeTimer);
      fadeTimer=__mlsB18Q.cancel(fadeTimer); fadeRemoveTimer=__mlsB18Q.cancel(fadeRemoveTimer);
      if(offMut){ offMut(); offMut=null; } if(offError){ offError(); offError=null; }
      try{ veil.remove(); }catch(e){} window.__mlsCalmBoot=null;
    });
  }catch(e){ try{ var v=document.getElementById('mlsBootVeil'); if(v) v.remove(); }catch(e2){} }
})();

/* __mlsSearchAssistHint — "Find anything" now hands hard questions to the MLS
 * Copilot: press Enter in the top search and a one-tap "Ask MLS Copilot" chip
 * appears under the box (the native screen-search keeps working unchanged). */
(function(){
  "use strict";
  if(window.__mlsSearchAssistHint) return; window.__mlsSearchAssistHint={v:'b18'};
  function findInput(){
    var cands=document.querySelectorAll('input[placeholder*="Find anything" i],input[placeholder*="patients & screens" i]');
    return cands.length?cands[0]:null;
  }
  var chip=null, askTimer=null;
  function showChip(inp){
    var q=String(inp.value||'').trim(); if(q.length<3) return;
    if(!chip){
      chip=document.createElement('button'); chip.id='mlsAskCopilotChip';
      chip.style.cssText='position:fixed;z-index:100060;cursor:pointer;border:1px solid #2E6A4B;background:#0f1b33;color:#EAF1EE;font:600 12.5px system-ui;border-radius:999px;padding:7px 14px;box-shadow:0 8px 24px rgba(10,25,60,.4)';
      document.body.appendChild(chip);
    }
    var r=inp.getBoundingClientRect();
    chip.style.left=Math.round(r.left)+'px'; chip.style.top=Math.round(r.bottom+6)+'px';
    chip.textContent='💬 Ask MLS Copilot: “'+q.slice(0,44)+(q.length>44?'…':'')+'”';
    chip.style.display='block';
    chip.onclick=function(){
      chip.style.display='none';
      try{
        /* b243: openCopilotDock is the surface that actually holds the chat nodes
           (the Assistant merge moved them; the dock-fix borrows them back).
           openCopilot alone opened a hero-only card = "empty Copilot panel". */
        if(typeof window.openCopilotDock==='function') window.openCopilotDock();
        else if(typeof window.openCopilot==='function') window.openCopilot();
        askTimer=__mlsB18Q.cancel(askTimer);
        askTimer=__mlsB18Q.later(function(){
          askTimer=null;
          var ci=document.getElementById('copilotInput');
          if(ci){ ci.value=q; try{ ci.dispatchEvent(new Event('input',{bubbles:true})); }catch(e){} }
          if(typeof window.copilotAsk==='function') window.copilotAsk();
          else { var sb=document.getElementById('copilotSendBtn'); if(sb) sb.click(); }
        },650);
      }catch(e){}
    };
    chip.__t=__mlsB18Q.cancel(chip.__t); chip.__t=__mlsB18Q.later(function(){ chip.__t=null; chip.style.display='none'; },8000);
  }
  __mlsB18Q.listen(document,'keydown',function(e){
    try{
      if(e.key!=='Enter') return;
      var inp=findInput();
      if(inp && e.target===inp) showChip(inp);
    }catch(err){}
  },true);
  __mlsB18Q.listen(document,'mousedown',function(e){ try{ if(chip && chip.style.display==='block' && e.target!==chip) chip.style.display='none'; }catch(err){} },true);
  __mlsB18Q.cleanup(function(){
    askTimer=__mlsB18Q.cancel(askTimer);
    if(chip){ chip.__t=__mlsB18Q.cancel(chip.__t); try{ chip.remove(); }catch(e){} chip=null; }
    window.__mlsSearchAssistHint=null;
  });
})();
