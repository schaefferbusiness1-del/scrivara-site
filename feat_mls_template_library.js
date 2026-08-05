/* =============================================================================
 * MLS versioned template library  tl-1.0.0
 * Authenticated template sets are encrypted/versioned by the backend. Existing
 * local templates remain the offline fallback until a server set is explicitly
 * activated. Imports are preview-first and local edits become recoverable
 * versions with optimistic stale-device rejection.
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__mlsTemplateLibrary && window.__mlsTemplateLibrary.installed) return;

  var VERSION='tl-1.5.0', S=function(v){return v==null?'':String(v);}, isFn=function(f){return typeof f==='function';};
  var state={sets:[],activeSetId:'',selectedSetId:'',activeVersion:0,activeTemplates:[],hydrated:false,applying:false,sourceFilenames:[],pending:null,editingId:'',refreshPromise:null,snapshotTimer:0,snapshotSaving:false,snapshotQueued:false,conflict:null,status:'',statusError:false,unsupported:false};
  var originals={},uploadRuns={},activeUpload=null;
  var IMPORT_STAGES=['Validating files','Reading files','Parsing template content','Checking results','Review ready'];
  var PREVIEW_STAGES=['Validating import','Checking ownership','Comparing versions','Preparing import preview'];
  var COMMIT_STAGES=['Validating import','Checking duplicates','Writing atomic version','Verifying committed version'];

  function esc(v){return S(v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function byId(id){return document.getElementById(id);}
  function hosted(){if(state.unsupported)return false;try{return isFn(window.backendMode)&&window.backendMode()&&isFn(window.bkToken)&&!!window.bkToken();}catch(e){return false;}}
  /* The deployed backend may not serve the template-set endpoints yet. A 404 on
     any of them means "cloud library unavailable" — flip to device-only mode
     (the proven local flow) instead of surfacing dead-end errors. */
  function markUnsupported(){state.unsupported=true;var panel=byId('tlPanel');if(panel)panel.style.display='none';}
  function uid(prefix){try{if(window.crypto&&isFn(window.crypto.randomUUID))return prefix+window.crypto.randomUUID();}catch(e){}return prefix+Date.now().toString(36)+Math.random().toString(36).slice(2);}
  function setFor(id){for(var i=0;i<state.sets.length;i++)if(state.sets[i]&&state.sets[i].id===id)return state.sets[i];return null;}
  function cloneTemplates(list){try{return JSON.parse(JSON.stringify(Array.isArray(list)?list:[]));}catch(e){return [];}}
  function currentLocal(){try{return isFn(window.getTemplates)?(window.getTemplates()||[]):[];}catch(e){return [];}}
  function status(message,error){state.status=S(message);if(arguments.length>1)state.statusError=!!error;var el=byId('tlStatus');if(el){el.textContent=state.status;el.style.color=state.statusError?'#a12c2c':'#35536f';}}
  /* b834 — A VISIBLE LOADING SIGN, BECAUSE THE PLUMBING HAD NONE.
     __mlsLoadingCalm.start() returns a live handle and renders ZERO DOM on this
     surface — measured directly: starting a handle and pushing a stage added 0
     new nodes to the document. So a doctor importing 100 forms (1.2s for text,
     minutes for scanned PDFs that go through OCR) watched a motionless screen
     with no way to tell whether anything was happening. The stage events
     already carry stage, current, total and a human operation line; nothing was
     drawing them. They are now drawn into a strip beside #tplMultiStatus inside
     the upload card — and since b835 that card is the first thing on the tab,
     so the progress appears where the doctor just clicked. */
  /* THE STRIP OWNS ITS OWN NODE, and that is not tidiness — it is the fix.
     Painting into #tplMultiStatus looked right and rendered NOTHING: the app's
     own _tplMultiStatus() (ScribeFlow.html) writes `s.textContent = msg` several
     times while the import runs, so every frame this drew was wiped before the
     next one. Measured: 0 progress frames across a 2.2s / 100-file import with
     36 samples taken. A separate sibling cannot be clobbered by a writer that
     does not know it exists. */
  function progressBox(){
    var box=byId('tlUploadProgress');
    if(box)return box;
    var anchor=byId('tplMultiStatus');
    if(!anchor||!anchor.parentNode)return null;
    box=document.createElement('div');
    box.id='tlUploadProgress';
    box.setAttribute('role','status');
    box.setAttribute('aria-live','polite');
    anchor.parentNode.insertBefore(box,anchor);
    return box;
  }
  /* THE SHAPE OF THE WAIT, NOT JUST A BAR. Owner: the loading has to be
     "pretty and easy to understand and intuitive". A lone bar answers "how
     far" and nothing else; importing 100 forms runs a five-stage pipeline the
     module already declares in IMPORT_STAGES/PREVIEW_STAGES/COMMIT_STAGES, so
     the steps are drawn and the doctor can see WHICH part is slow and what is
     still to come. Done steps get a tick, the running one a pulsing dot, the
     rest stay quiet. */
  function fmtDur(ms){ var s=Math.max(0,Math.round(ms/1000)); return s>=60?(Math.floor(s/60)+'m '+(s%60)+'s'):(s+'s'); }
  /* b882 — the elapsed clock + honest per-step estimate. Always computed from
     Date.now() differences, never from tick counts: a hidden tab FREEZES
     timers outright, so a counting clock would freeze with it and resume
     wrong. The estimate only speaks for the CURRENT step (measured rate ×
     items left) — a whole-pipeline promise would be a guess dressed as one. */
  function progressTimeLine(){
    if(!state.progT0) return '';
    var now=Date.now(), line='⏱ '+fmtDur(now-state.progT0)+' elapsed';
    var ph=(state.progPhase||{})[state.progStage];
    if(ph&&ph.t){
      if(ph.c>0&&ph.c<ph.t) line+=' · about '+fmtDur((now-(state.progStageT0||now))/ph.c*(ph.t-ph.c))+' left in this step';
      else if(!ph.c) line+=' · estimating time…';
    }
    return line;
  }
  function paintProgress(stage,current,total,operation){
    try{
      var box=progressBox();if(!box)return;
      var t=Number(total)||0,c=Math.max(0,Math.min(Number(current)||0,t)),pct=t?Math.round(c/t*100):0;
      var steps=state.progStages||[],at=-1,i;
      for(i=0;i<steps.length;i++){ if(steps[i]===stage){at=i;break;} }
      /* b882 — remember each stage's own count, so a finished stage's bar can
         stay full while the next stage's bar fills from zero. */
      state.progPhase=state.progPhase||{};
      if(t) state.progPhase[stage]={c:c,t:t};
      if(stage!==state.progStage){ state.progStage=stage; state.progStageT0=Date.now(); }
      var stepsHtml='';
      if(steps.length>1){
        stepsHtml='<ol class="tl-prog-steps">';
        for(i=0;i<steps.length;i++){
          var cls=at<0?'':(i<at?'done':(i===at?'now':''));
          stepsHtml+='<li class="'+cls+'"><span class="tl-prog-dot"></span>'+esc(steps[i])+'</li>';
        }
        stepsHtml+='</ol>';
      }
      /* b882 — the import pipeline gets TWO bars (reading, then recognizing).
         One bar snapped to 100% the moment the last file was READ and then sat
         motionless through minutes of serial AI recognition — the owner's
         90-file import looked hung at "90 / 90". */
      var READ='Reading files', PARSE='Parsing template content', barsHtml;
      var ri=steps.indexOf(READ), pi=steps.indexOf(PARSE);
      if(ri>=0&&pi>=0){
        var rp=state.progPhase[READ]||{c:0,t:0}, pp=state.progPhase[PARSE]||{c:0,t:0};
        var rpct=at>ri?100:(rp.t?Math.round(rp.c/rp.t*100):0);
        var ppct=at>pi?100:(pp.t?Math.round(pp.c/pp.t*100):0);
        barsHtml=
          '<div class="tl-prog-sub"><span>1 · Reading files</span><span>'+(rp.t?(at>ri?rp.t:rp.c)+' / '+rp.t:'')+'</span></div>'+
          '<div class="tl-prog-bar"><i style="width:'+rpct+'%"></i></div>'+
          '<div class="tl-prog-sub"><span>2 · Recognizing templates</span><span>'+(pp.t?(at>pi?pp.t:pp.c)+' / '+pp.t:'')+'</span></div>'+
          '<div class="tl-prog-bar tl-prog-bar2"'+(at===pi&&!pp.t?' data-tl-indeterminate="1"':'')+'><i style="width:'+(at===pi&&!pp.t?40:ppct)+'%"></i></div>';
      } else {
        barsHtml='<div class="tl-prog-bar"'+(t?'':' data-tl-indeterminate="1"')+'><i style="width:'+(t?pct:40)+'%"></i></div>';
      }
      box.hidden=false;
      box.innerHTML=
        '<div class="tl-prog">'+
          '<div class="tl-prog-head">'+
            '<span class="tl-prog-title">'+esc(state.progLabel||stage||'Working…')+'</span>'+
            (t?'<span class="tl-prog-count">'+c+' / '+t+'</span>':'<span class="tl-prog-count">working…</span>')+
          '</div>'+
          barsHtml+
          '<div class="tl-prog-txt">'+esc(stage||'')+'</div>'+
          stepsHtml+
          (operation&&operation!==stage?'<div class="tl-prog-op">'+esc(operation)+'</div>':'')+
          '<div class="tl-prog-time" id="tlProgTime">'+esc(progressTimeLine())+'</div>'+
        '</div>';
    }catch(e){}
  }
  /* the strip is a PROGRESS indicator, so it leaves when the work does —
     otherwise a finished import reads as one still running. */
  function clearProgress(){ try{ state.progGen=(state.progGen||0)+1; state.progT0=0; state.progPhase=null; state.progStage=''; var box=byId('tlUploadProgress'); if(box){ box.innerHTML=''; box.hidden=true; } }catch(e){} }
  function progressStart(opts){
    try{
      state.progStages=(opts&&Array.isArray(opts.stages))?opts.stages.slice():[];
      state.progLabel=(opts&&opts.label)||'Working…';
      /* b882 — the clock ticks once a second into the time line ONLY (a full
         repaint per second would fight the event-driven frames). Not an
         interval: a generation-checked timeout chain that dies the moment
         clearProgress bumps the generation or progT0 drops — nothing to leak
         and nothing for the poller ceiling to carry forever. */
      state.progT0=Date.now(); state.progPhase={}; state.progStage=''; state.progStageT0=0;
      state.progGen=(state.progGen||0)+1;
      (function tickLoop(gen){ setTimeout(function(){ try{ if(gen!==state.progGen||!state.progT0) return; var el=byId('tlProgTime'); if(el) el.textContent=progressTimeLine(); tickLoop(gen); }catch(e){} },1000); })(state.progGen);
      paintProgress(state.progStages[0]||state.progLabel,0,(opts&&opts.total)||0,'');
    }catch(e){}
    var api=window.__mlsLoadingCalm,h=null;
    try{h=api&&api.installed&&isFn(api.start)?api.start(opts):null;}catch(e){h=null;}
    /* the strip must retire on EVERY exit, including the ones that throw, so
       complete() and fail() are decorated rather than trusted to be called from
       one place. A progress bar left at 100% is a lie about work still running. */
    try{
      if(h){
        var oc=h.complete,of=h.fail;
        if(isFn(oc))h.complete=function(){clearProgress();return oc.apply(h,arguments);};
        if(isFn(of))h.fail=function(){clearProgress();return of.apply(h,arguments);};
      }
    }catch(e){}
    return h;}
  function progressStage(handle,stage,current,total,operation){paintProgress(stage,current,total,operation);try{if(handle)handle.stage(stage,{current:current,total:total,operation:operation||stage});}catch(e){}}
  function progressLink(handle,response){try{var id=response&&response.headers&&response.headers.get('X-Job-ID'),api=window.__mlsLoadingCalm;if(handle&&id&&api&&isFn(api.linkServer))api.linkServer(handle.id,id);}catch(e){}}

  async function request(path,options){
    options=options||{};if(!hosted())throw Object.assign(new Error('Sign in to use the cloud template library.'),{code:'TEMPLATE_OFFLINE'});
    var requestId=options.requestId||uid('req-'),headers={'Authorization':'Bearer '+window.bkToken(),'X-Request-ID':requestId};
    if(options.body!==undefined)headers['Content-Type']='application/json';if(options.idempotencyKey)headers['Idempotency-Key']=options.idempotencyKey;
    var response=await window.fetch(window.bkBase()+path,{method:options.method||'GET',headers:headers,body:options.body===undefined?undefined:JSON.stringify(options.body),signal:options.signal});
    progressLink(options.progress,response);var data={};try{data=await response.json();}catch(e){}
    if(!response.ok){var raw=data&&data.error,err=new Error((raw&&raw.message)||data.message||('Template request failed ('+response.status+').'));err.code=(raw&&raw.code)||'TEMPLATE_REQUEST_FAILED';err.status=response.status;err.details=raw&&raw.details;if(response.status===404&&!(raw&&raw.code)){markUnsupported();err.code='TEMPLATE_UNSUPPORTED';err.message='Cloud template sync is not available on this server yet — templates stay on this device.';}else if(response.status===403&&!(raw&&raw.message)){err.message='Cloud template sets are available on clinician accounts — this account’s templates stay on this device.';}throw err;}
    return data;
  }

  function css(){
    if(byId('mlsTlCss'))return;var st=document.createElement('style');st.id='mlsTlCss';st.textContent=[
      '#tlPanel{border:1px solid #cfe0d7;background:linear-gradient(135deg,#f5faf7,#f7f9ff);border-radius:13px;padding:13px 14px;margin:0 0 14px;color:#19352a}',
      '#tlPanel h4{margin:0 0 3px;font-size:14px}#tlPanel .tl-sub{font-size:11.5px;color:#5b6d65;margin:0 0 9px}',
      '#tlPanel .tl-grid{display:grid;grid-template-columns:minmax(180px,1.5fr) minmax(130px,.8fr) minmax(130px,1fr);gap:8px;align-items:end}',
      '#tlPanel label{font-size:10.5px;font-weight:750;color:#476057}#tlPanel input,#tlPanel select{box-sizing:border-box;width:100%;margin-top:3px;border:1px solid #bfd1c7;border-radius:8px;background:#fff;padding:7px 8px;font-size:12px}',
      '#tlPanel .tl-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}#tlPanel button,.tl-import-review button{border:1px solid #bcd0c5;border-radius:8px;background:#fff;color:#204034;padding:6px 10px;font-size:11.5px;font-weight:700;cursor:pointer}',
      '#tlPanel button:hover,.tl-import-review button:hover{background:#edf6f1}.tl-active{margin-top:8px;border-radius:8px;background:#e8f5ed;padding:7px 9px;font-size:11.5px}.tl-warn{background:#fff5df!important;color:#795c19!important}',
      '#tlConflict{display:none;margin-top:8px;border:1px solid #e6bf68;background:#fff7e4;border-radius:9px;padding:8px 10px;font-size:11.5px;color:#684f17}#tlConflict button{margin:7px 5px 0 0}',
      '#tlVersions{margin-top:8px;max-height:150px;overflow:auto;font-size:11px}.tl-ver{display:flex;gap:8px;align-items:center;border-top:1px solid #dce8e1;padding:5px 0}.tl-ver span{flex:1}',
      '.tl-import-review{border:1px solid #c9dccf;background:#f7fbf8;border-radius:10px;padding:10px 12px;margin-top:8px;font-size:12px;color:#29493d}.tl-counts{display:flex;gap:6px;flex-wrap:wrap;margin:7px 0}.tl-count{border-radius:999px;background:#e8f1ec;padding:3px 8px;font-weight:750}.tl-count.bad{background:#fdeaea;color:#982c2c}',
      '@media(max-width:760px){#tlPanel .tl-grid{grid-template-columns:1fr 1fr}}@media(max-width:520px){#tlPanel .tl-grid{grid-template-columns:1fr}#tlPanel .tl-actions button{flex:1 1 45%}}',
      /* b834 — the progress strip paintProgress() draws. Unscoped on purpose:
         it must read the same in the embedded Templates tab and in the classic
         floating dialog, and neither surface owns #tplMultiStatus. */
      /* the wait, drawn so it explains itself */
      '#tlUploadProgress .tl-prog{margin:8px 0 2px;padding:13px 15px;border:1px solid #cfe0d7;border-radius:13px;background:linear-gradient(135deg,#f6fbf8,#f4f8ff);box-shadow:0 4px 16px rgba(32,64,52,.07)}',
      '#tlUploadProgress .tl-prog-head{display:flex;align-items:baseline;gap:10px;justify-content:space-between}',
      '#tlUploadProgress .tl-prog-title{font-weight:800;font-size:13.5px;color:#19352a}',
      '#tlUploadProgress .tl-prog-count{font-weight:750;font-size:12.5px;color:#2E6A4B;font-variant-numeric:tabular-nums;white-space:nowrap}',
      '#tlUploadProgress .tl-prog-bar{height:9px;border-radius:999px;background:#e4eee8;overflow:hidden;margin:9px 0 7px}',
      '#tlUploadProgress .tl-prog-bar>i{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,#2E6A4B,#4f9a72);transition:width .28s cubic-bezier(.4,0,.2,1)}',
      '#tlUploadProgress .tl-prog-bar[data-tl-indeterminate]>i{animation:tlProgSlide 1.25s ease-in-out infinite}',
      '#tlUploadProgress .tl-prog-txt{font-size:12.5px;color:#35536f;font-weight:700}',
      '#tlUploadProgress .tl-prog-steps{list-style:none;margin:9px 0 0;padding:0;display:flex;flex-wrap:wrap;gap:5px 14px}',
      '#tlUploadProgress .tl-prog-steps li{display:flex;align-items:center;gap:6px;font-size:11.5px;color:#8a9a92;transition:color .2s ease}',
      '#tlUploadProgress .tl-prog-dot{width:9px;height:9px;border-radius:50%;background:#dbe7e1;flex:none;transition:background .2s ease,box-shadow .2s ease}',
      '#tlUploadProgress .tl-prog-steps li.done{color:#2E6A4B;font-weight:700}',
      '#tlUploadProgress .tl-prog-steps li.done .tl-prog-dot{background:#2E6A4B;box-shadow:inset 0 0 0 2px #f6fbf8}',
      '#tlUploadProgress .tl-prog-steps li.now{color:#19352a;font-weight:800}',
      '#tlUploadProgress .tl-prog-steps li.now .tl-prog-dot{background:#4f9a72;animation:tlProgPulse 1.15s ease-in-out infinite}',
      '#tlUploadProgress .tl-prog-op{margin-top:7px;font-size:11.5px;color:#5b6d65;line-height:1.5}',
      /* b882 — the two-bar import layout + the elapsed/ETA line */
      '#tlUploadProgress .tl-prog-sub{display:flex;justify-content:space-between;gap:10px;margin-top:7px;font-size:11.5px;font-weight:750;color:#5b6d65;font-variant-numeric:tabular-nums}',
      '#tlUploadProgress .tl-prog-bar2>i{background:linear-gradient(90deg,#54639f,#8073c2)}',
      '#tlUploadProgress .tl-prog-time{margin-top:8px;font-size:11.5px;font-weight:700;color:#35536f;font-variant-numeric:tabular-nums}',
      '@keyframes tlProgSlide{0%{transform:translateX(-100%)}100%{transform:translateX(320%)}}',
      '@keyframes tlProgPulse{0%,100%{box-shadow:0 0 0 0 rgba(79,154,114,.55)}50%{box-shadow:0 0 0 5px rgba(79,154,114,0)}}',
      /* a clinical surface never animates at someone who asked it not to */
      '@media(prefers-reduced-motion:reduce){#tlUploadProgress .tl-prog-bar>i,#tlUploadProgress .tl-prog-dot{animation:none!important;transition:none!important}}',
      /* b834 — 100 templates made the review list 6,463px tall and left
         "Add selected to my templates" at y=7045 in a 720px viewport: the
         doctor had to scroll seven screens to finish the import he started.
         The list gets its own scroller and the commit control rides the
         bottom of it, so the action is reachable at any batch size. */
      '#tplMultiResult:not(:empty){max-height:min(52vh,440px);overflow-y:auto;overscroll-behavior:contain;position:relative;padding-right:4px}',
      '#tplMultiResult>button{position:sticky;bottom:0;z-index:2;width:100%;margin-top:9px}'
    ].join('\n');(document.head||document.documentElement).appendChild(st);
  }

  function ensurePanel(){
    css();var modal=byId('templatesModal'),anchor=byId('tplList');if(!modal||!anchor||byId('tlPanel'))return;
    var panel=document.createElement('section');panel.id='tlPanel';panel.setAttribute('aria-label','Versioned template library');panel.innerHTML=
      '<h4>☁ Versioned template library</h4><p class="tl-sub">The active set follows this signed-in account. Imports are previewed first; older versions remain recoverable.</p>'+
      '<div class="tl-grid"><label>Template set<select id="tlSetSelect"></select></label><label>Import scope<select id="tlScope"><option value="account">This account</option><option value="provider">This provider</option><option value="practice">This practice</option></select></label><label>Facility association<input id="tlFacility" placeholder="Optional facility"></label></div>'+
      '<div class="tl-grid" style="margin-top:7px"><label>Set name<input id="tlSetName" placeholder="My validated templates"></label><div></div><div></div></div>'+
      '<div class="tl-actions"><button data-tl="refresh">↻ Refresh</button><button data-tl="activate">✓ Activate selected</button><button data-tl="new">＋ New empty set</button><button data-tl="history">Version history</button><button data-tl="archive">Archive</button><button data-tl="migrate">Move device templates to cloud</button></div>'+
      '<div id="tlActive" class="tl-active"></div><div id="tlStatus" role="status" aria-live="polite"></div><div id="tlConflict"></div><div id="tlVersions"></div>';
    anchor.parentElement.insertBefore(panel,anchor);panel.addEventListener('click',panelClick);byId('tlSetSelect').addEventListener('change',function(){state.selectedSetId=this.value;renderPanel();});renderPanel();
  }

  function renderPanel(){
    ensurePanel();var select=byId('tlSetSelect');if(!select)return;
    var options='<option value="">— new set (not active) —</option>';
    state.sets.forEach(function(set){options+='<option value="'+esc(set.id)+'">'+esc(set.name)+(set.active?' · ACTIVE':'')+(set.status==='archived'?' · archived':'')+' · v'+set.version+'</option>';});
    select.innerHTML=options;if(!setFor(state.selectedSetId))state.selectedSetId=state.activeSetId||'';select.value=state.selectedSetId;
    var selected=setFor(state.selectedSetId),active=setFor(state.activeSetId),activeEl=byId('tlActive');
    if(active)activeEl.innerHTML='<b>Active now:</b> '+esc(active.name)+' · v'+active.version+' · '+active.templateCount+' template'+(active.templateCount===1?'':'s')+' · '+esc(active.scope);
    else activeEl.innerHTML='<b>No cloud set is active.</b> Device templates remain unchanged until you explicitly activate a set.';
    activeEl.className='tl-active'+(active?'':' tl-warn');
    byId('tlScope').value=selected?selected.scope:'account';byId('tlFacility').value=selected?(selected.facility||''):'';byId('tlSetName').value=selected?(selected.name||''):'';
    var activate=byId('tlPanel').querySelector('[data-tl="activate"]'),archive=byId('tlPanel').querySelector('[data-tl="archive"]');
    activate.disabled=!selected||selected.active||selected.status==='archived';archive.disabled=!selected;archive.textContent=selected&&selected.status==='archived'?'Unarchive':'Archive';
    var migrate=byId('tlPanel').querySelector('[data-tl="migrate"]');migrate.style.display=!state.activeSetId&&currentLocal().length?'':'none';
    status(state.status);renderConflict();
  }

  function renderConflict(){
    var box=byId('tlConflict');if(!box)return;if(!state.conflict){box.style.display='none';box.innerHTML='';return;}
    box.style.display='block';box.innerHTML='<b>A newer cloud version exists.</b> Your device changes were kept here and were not silently uploaded. Review the newest version or retry your changes on top of it.<br><button data-tl-conflict="retry">Retry my device changes</button><button data-tl-conflict="server">Discard device changes</button>';
    box.onclick=function(event){var b=event.target&&event.target.closest?event.target.closest('[data-tl-conflict]'):null;if(!b)return;var conflict=state.conflict,action=b.getAttribute('data-tl-conflict');if(action==='server'){state.conflict=null;if(conflict.serverSet&&conflict.serverSet.active)applySet(conflict.serverSet);if(conflict.kind==='import')state.pending=null;status('Device changes discarded; the newest cloud version remains authoritative.',false);renderPanel();}else if(action==='retry'){state.conflict=null;if(conflict.kind==='import'&&state.pending){state.pending.body.expectedVersion=Number(conflict.serverSet&&conflict.serverSet.version)||state.pending.body.expectedVersion;commitPending();}else persistSnapshot(cloneTemplates(conflict.localTemplates||(conflict.body&&conflict.body.templates)||currentLocal()));}};
  }

  /* tl-1.1.0 — WHAT ACTIVATING A SET WOULD DESTROY, BY NAME.
     applySet REPLACES the device library with the set's contents. That is
     correct for "restore version 3", and catastrophic for "I saved one
     template and the resulting one-template set became active" — which is
     exactly how the owner's library went 8 -> 1 on b833. Returns the device
     templates that the incoming set does not carry, matched on id first and
     name second (a set round-tripped through the server re-issues ids). */
  function wouldRemove(set){
    try{
      if(!set||!Array.isArray(set.templates))return [];
      var cur=(isFn(window.getTemplates)?window.getTemplates():[])||[];
      if(!cur.length)return [];
      var ids={},names={};
      set.templates.forEach(function(t){ if(!t)return; if(t.id)ids[S(t.id)]=1; if(t.name)names[S(t.name).trim().toLowerCase()]=1; });
      return cur.filter(function(t){
        if(!t)return false;
        if(t.id&&ids[S(t.id)])return false;
        if(t.name&&names[S(t.name).trim().toLowerCase()])return false;
        return true;
      }).map(function(t){ return S(t.name)||'(unnamed)'; });
    }catch(e){ return []; }
  }
  /* The doctor is told the COUNT and the first names, because "activate" does
     not read as "delete" and the loss is silent and unrecoverable once the
     device write fires syncPrefsToServer(). */
  async function confirmReplace(set){
    var lost=wouldRemove(set);
    if(!lost.length)return true;
    var shown=lost.slice(0,6).join(', ')+(lost.length>6?', and '+(lost.length-6)+' more':'');
    var msg='This set does not contain '+lost.length+' template'+(lost.length===1?'':'s')+
      ' you have on this device:\n\n'+shown+'\n\nActivating it will REMOVE them from your library on this device and from your account. Continue?';
    /* mlsConfirm is the app's non-blocking dialog (native confirm freezes the
       thread and is silently suppressed in automation, leaving a dead button —
       tests/no-native-dialogs-contract.test.js). If it is somehow absent this
       FAILS CLOSED: a destructive replace we cannot ask about is a replace we
       do not perform. Losing an activation is recoverable; losing the library
       is what this guard exists to prevent. */
    try{
      if(typeof window.mlsConfirm!=='function'){
        status('Could not confirm a change that would remove '+lost.length+' of your templates, so nothing was changed.',true);
        return false;
      }
      return !!(await window.mlsConfirm(msg));
    }catch(e){ return false; }
  }

  function applySet(set){
    if(!set||!Array.isArray(set.templates))return;state.applying=true;
    try{(originals.setTemplates||window.setTemplates)(cloneTemplates(set.templates));if(isFn(window.uns)){localStorage.setItem(window.uns('templateSetActive'),set.id);localStorage.setItem(window.uns('templateSetVersion'),S(set.version));}}
    finally{state.applying=false;}
    state.activeSetId=set.id;state.activeVersion=Number(set.version)||0;state.activeTemplates=cloneTemplates(set.templates);state.hydrated=true;
    try{if(isFn(window.renderTemplateList))window.renderTemplateList();if(isFn(window.renderTemplateActiveSelect))window.renderTemplateActiveSelect();}catch(e){}
  }

  function refresh(options){
    options=options||{};if(!hosted()){ensurePanel();status('Offline/local mode: device templates are still available.',false);return Promise.resolve(false);}
    if(state.refreshPromise)return state.refreshPromise;var handle=options.silent?null:progressStart({key:'template-library:refresh',kind:'template_library',label:'Refreshing template library',stages:['Loading template sets','Checking active set','Applying active version'],total:3,timeoutMs:45000,replace:true,cancelable:false});
    state.refreshPromise=(async function(){
      try{
        progressStage(handle,'Loading template sets',1,3,'Loading account-scoped template sets.');var data=await request('/api/template-sets?includeArchived=1',{requestId:handle&&handle.requestId,progress:handle});
        state.sets=Array.isArray(data.sets)?data.sets:[];state.activeSetId=data.activeSetId||'';if(!state.selectedSetId)state.selectedSetId=state.activeSetId;
        progressStage(handle,'Checking active set',2,3,'Checking the explicitly selected active set.');
        if(state.activeSetId&&options.applyActive!==false){var detail=await request('/api/template-sets/'+encodeURIComponent(state.activeSetId),{requestId:handle&&handle.requestId,progress:handle});progressStage(handle,'Applying active version',3,3,'Applying the newest active version to this device.');applySet(detail.set);}
        else state.hydrated=true;
        status('Template library refreshed.',false);renderPanel();if(handle)handle.complete('Template library refreshed.');return true;
      }catch(error){if(error&&error.code==='TEMPLATE_UNSUPPORTED'){state.hydrated=true;if(handle)handle.complete('Device templates ready.');return false;}status(error.message,true);if(handle)handle.fail(error);renderPanel();return false;}
      finally{state.refreshPromise=null;}
    })();return state.refreshPromise;
  }

  function importBody(custom){
    custom=custom||{};var selected=setFor(custom.targetSetId!==undefined?custom.targetSetId:state.selectedSetId),pending=custom.templates||((window._tplPendingSplit||[]).filter(function(t){return t&&t.keep!==false&&S(t.text).trim();}));if(!Array.isArray(pending))pending=[];
    return {targetSetId:selected?selected.id:null,expectedVersion:selected?Number(selected.version):0,setName:S(custom.setName||(byId('tlSetName')&&byId('tlSetName').value)||(selected&&selected.name)||state.sourceFilenames[0]||'Imported templates').replace(/\.[^.]+$/,'').slice(0,120),scope:custom.scope||(byId('tlScope')&&byId('tlScope').value)||(selected&&selected.scope)||'account',facility:custom.facility!==undefined?custom.facility:((byId('tlFacility')&&byId('tlFacility').value)||(selected&&selected.facility)||''),sourceFilenames:custom.sourceFilenames||state.sourceFilenames,templates:pending.map(function(t){return {id:t.id||'',name:t.name||'Template',text:t.text||'',keywords:t.keywords||[],procedure:t.procedure||'',providerId:t.providerId||'',facilityId:t.facilityId||'',facility:t.facility||'',requiredFields:t.requiredFields||[],optionalFields:t.optionalFields||[],prohibitedFields:t.prohibitedFields||[],validatedFacts:t.validatedFacts===true};}),removeTemplateIds:custom.removeTemplateIds||[]};
  }

  function countsHtml(counts){var keys=['added','updated','duplicated','rejected','unchanged','removed'];return '<div class="tl-counts">'+keys.map(function(key){return '<span class="tl-count '+(key==='rejected'?'bad':'')+'">'+key+': '+(Number(counts&&counts[key])||0)+'</span>';}).join('')+'</div>';}
  /* The import review must appear WHERE THE USER ACTED. The single "💾 Save
     template" form sits BELOW the multi-upload card, so rendering its preview
     into #tplMultiResult put the Commit card above the fold — the owner
     reproduced a save that visibly did nothing (2026-07-23). Form saves now
     get a result box directly under the save row; bulk uploads keep theirs. */
  function importResultBox(){
    var fromForm=!!(state.pending&&state.pending.fromForm);
    if(fromForm){
      var box=byId('tplFormResult');
      if(!box){
        var anchor=byId('tplText');
        if(anchor&&anchor.parentElement){
          box=document.createElement('div');box.id='tplFormResult';box.style.marginTop='8px';
          var row=anchor.nextElementSibling;
          if(row&&row.parentElement)row.parentElement.insertBefore(box,row.nextSibling);
          else anchor.parentElement.appendChild(box);
        }
      }
      if(box)return box;
    }
    return byId('tplMultiResult');
  }
  function flashReview(box){
    try{box.style.transition='box-shadow .25s';box.style.boxShadow='0 0 0 3px #7fb89b';setTimeout(function(){try{box.style.boxShadow='';}catch(e){}},1400);}catch(e){}
  }
  function renderImportPreview(preview){
    var box=importResultBox();if(!box)return;var rejected=(preview.detail&&preview.detail.rejected)||[];
    box.innerHTML='<div class="tl-import-review"><b>Import preview — nothing saved yet</b>'+countsHtml(preview.counts)+'<div>Resulting set: '+preview.proposedTemplateCount+' template'+(preview.proposedTemplateCount===1?'':'s')+'.</div>'+
      (rejected.length?'<div style="color:#982c2c;margin-top:5px">'+rejected.map(function(x){return esc((x.name||'Row '+(x.index+1))+': '+x.reason);}).join('<br>')+'</div>':'')+
      '<label style="display:block;margin:8px 0"><input type="checkbox" id="tlActivateAfter" style="width:auto"> Activate this set after commit'+(preview.targetSetId?' (current selection remains active if already active)':'')+'</label>'+
      '<button data-tl-import="commit" '+(preview.canCommit?'':'disabled')+'>Commit one recoverable version</button> <button data-tl-import="cancel">Cancel</button></div>';
    box.onclick=importClick;try{box.scrollIntoView({behavior:'smooth',block:'center'});}catch(e){}flashReview(box);
  }

  function previewImport(custom,providedHandle){
    if(!hosted()){if(isFn(originals.tplAddSplit))return Promise.resolve(originals.tplAddSplit());return Promise.resolve(false);}
    var body=importBody(custom),fingerprint=body.templates.map(function(t){return t.id+'|'+t.name+'|'+S(t.text).length;}).join('~');
    var handle=providedHandle||progressStart({key:'template-import-preview:'+fingerprint,kind:'template_import_preview',label:'Previewing template import',stages:PREVIEW_STAGES,total:body.templates.length,timeoutMs:120000,replace:true,cancelable:true,retry:function(next){previewImport(custom,next);}});
    return (async function(){try{
      progressStage(handle,'Validating import',0,body.templates.length,'Validating selected templates.');var data=await request('/api/template-imports/preview',{method:'POST',body:body,requestId:handle&&handle.requestId,progress:handle});
      progressStage(handle,'Comparing versions',body.templates.length,body.templates.length,'Comparing against the selected set version.');state.pending={body:body,preview:data.preview,idempotencyKey:uid('tpl-import-'),fromForm:custom&&custom.fromForm};
      progressStage(handle,'Preparing import preview',body.templates.length,body.templates.length,'Waiting for explicit commit.');renderImportPreview(data.preview);if(handle)handle.complete('Import preview ready. Nothing has been saved.');return data.preview;
    }catch(error){status(error.message,true);renderPanel();if(handle)handle.fail(error);throw error;}})();
  }

  function importClick(event){var b=event.target&&event.target.closest?event.target.closest('[data-tl-import]'):null;if(!b)return;var action=b.getAttribute('data-tl-import');if(action==='commit')commitPending();else if(action==='cancel'){state.pending=null;state.editingId='';['tplMultiResult','tplFormResult'].forEach(function(id){var box=byId(id);if(box){box.onclick=null;box.innerHTML='';}});}}
  function commitPending(providedHandle){
    if(!state.pending)return Promise.resolve(false);var pending=state.pending,body=JSON.parse(JSON.stringify(pending.body)),activate=byId('tlActivateAfter');body.activate=!!(activate&&activate.checked);
    var resultBoxId=pending.fromForm?'tplFormResult':'tplMultiResult';
    var handle=providedHandle||progressStart({key:'template-import-commit:'+pending.idempotencyKey,kind:'template_import',label:'Importing templates',stages:COMMIT_STAGES,total:body.templates.length,timeoutMs:180000,replace:true,cancelable:true,retry:function(next){commitPending(next);}});
    return (async function(){try{
      progressStage(handle,'Validating import',0,body.templates.length,'Rechecking preview ownership and version.');var data=await request('/api/template-imports/commit',{method:'POST',body:body,idempotencyKey:pending.idempotencyKey,requestId:handle&&handle.requestId,progress:handle});var result=data.result;
      progressStage(handle,'Verifying committed version',body.templates.length,body.templates.length,'Applying the committed active version when selected.');
      if(result&&result.set&&(result.set.active||result.set.id===state.activeSetId||body.activate)){if(await confirmReplace(result.set))applySet(result.set);else status('Imported. Your device templates were left alone.',false);}
      state.pending=null;window._tplPendingSplit=[];if(pending.fromForm&&isFn(window.clearTplForm))window.clearTplForm();state.editingId='';
      var box=byId(resultBoxId)||byId('tplMultiResult');if(box)box.innerHTML='<div class="tl-import-review"><b>Import '+esc(result.status)+'.</b>'+countsHtml(result.counts)+(result.set&&!result.set.active?'<button data-tl-activate="'+esc(result.set.id)+'">Activate imported set</button>':'')+'</div>';
      if(box)box.onclick=function(ev){var a=ev.target&&ev.target.closest?ev.target.closest('[data-tl-activate]'):null;if(a)activateSet(a.getAttribute('data-tl-activate'));};
      await refresh({applyActive:false,silent:true});if(handle)handle.complete(result.status==='partial'?'Import completed with rejected rows.':'Templates imported.');return result;
    }catch(error){status(error.message,true);if(error.code==='TEMPLATE_VERSION_CONFLICT'){state.conflict={kind:'import',body:body,localTemplates:cloneTemplates(body.templates)};await loadConflictVersion();status('A newer cloud version exists. Your previewed changes are still available to retry.',true);}renderPanel();if(handle)handle.fail(error);throw error;}})();
  }

  function activateSet(id){var handle=progressStart({key:'template-set:activate',kind:'template_library',label:'Activating template set',stages:['Validating selection','Loading version','Applying templates'],total:3,timeoutMs:60000,replace:true,cancelable:false});return (async function(){try{progressStage(handle,'Validating selection',1,3);var data=await request('/api/template-sets/'+encodeURIComponent(id)+'/activate',{method:'POST',body:{},requestId:handle&&handle.requestId,progress:handle});progressStage(handle,'Applying templates',3,3);if(!(await confirmReplace(data.set))){status('Set activated in the cloud. Your device templates were left alone.',false);await refresh({applyActive:false,silent:true});state.selectedSetId=id;renderPanel();if(handle)handle.complete('Device templates unchanged.');return false;}applySet(data.set);await refresh({applyActive:false,silent:true});state.selectedSetId=id;renderPanel();if(handle)handle.complete('Template set activated.');return true;}catch(error){status(error.message,true);renderPanel();if(handle)handle.fail(error);return false;}})();}
  async function archiveSelected(){var set=setFor(state.selectedSetId);if(!set)return;var verb=set.status==='archived'?'unarchive':'archive';if(verb==='archive'){var yes=true;try{yes=await ((typeof window.mlsConfirm==='function')?window.mlsConfirm('Archive "'+set.name+'"? Its versions remain recoverable.'):Promise.resolve(window.confirm('Archive "'+set.name+'"? Its versions remain recoverable.')));}catch(e){}if(!yes)return;}request('/api/template-sets/'+encodeURIComponent(set.id)+'/'+verb,{method:'POST',body:{}}).then(function(){status(verb==='archive'?'Template set archived.':'Template set restored.',false);return refresh({silent:true});}).catch(function(error){status(error.message,true);renderPanel();});}
  function showHistory(){var set=setFor(state.selectedSetId),box=byId('tlVersions');if(!set||!box)return;request('/api/template-sets/'+encodeURIComponent(set.id)+'/versions').then(function(data){box.innerHTML=(data.versions||[]).map(function(v){return '<div class="tl-ver"><span>Version '+v.version+(v.current?' · current':'')+' · '+esc(v.createdAt||'')+'</span>'+(v.current?'':'<button data-tl-restore="'+v.version+'">Restore as new version</button>')+'</div>';}).join('')||'No versions.';box.onclick=function(ev){var b=ev.target&&ev.target.closest?ev.target.closest('[data-tl-restore]'):null;if(b)restoreVersion(set.id,b.getAttribute('data-tl-restore'));};}).catch(function(error){status(error.message,true);renderPanel();});}
  async function restoreVersion(id,version){var yes=true;try{yes=await ((typeof window.mlsConfirm==='function')?window.mlsConfirm('Restore version '+version+' as a new recoverable version?'):Promise.resolve(window.confirm('Restore version '+version+' as a new recoverable version?')));}catch(e){}if(!yes)return;request('/api/template-sets/'+encodeURIComponent(id)+'/versions/'+encodeURIComponent(version)+'/restore',{method:'POST',body:{}}).then(function(data){if(data.set.active)applySet(data.set);status('Version '+version+' restored as version '+data.set.version+'.',false);return refresh({applyActive:false,silent:true});}).then(renderPanel).catch(function(error){status(error.message,true);renderPanel();});}
  function createEmpty(){request('/api/template-sets',{method:'POST',body:{name:(byId('tlSetName')&&byId('tlSetName').value)||'New template set',scope:(byId('tlScope')&&byId('tlScope').value)||'account',facility:(byId('tlFacility')&&byId('tlFacility').value)||''}}).then(function(data){state.selectedSetId=data.set.id;status('Empty set created. It is not active until you choose Activate.',false);return refresh({applyActive:false,silent:true});}).then(renderPanel).catch(function(error){status(error.message,true);renderPanel();});}

  function panelClick(event){var b=event.target&&event.target.closest?event.target.closest('[data-tl]'):null;if(!b)return;var action=b.getAttribute('data-tl');if(action==='refresh')refresh();else if(action==='activate'&&state.selectedSetId)activateSet(state.selectedSetId);else if(action==='new')createEmpty();else if(action==='history')showHistory();else if(action==='archive')archiveSelected();else if(action==='migrate'){var local=currentLocal();if(!local.length)return;state.sourceFilenames=['Legacy device template library'];previewImport({templates:local,targetSetId:null,setName:'Migrated device templates',scope:'account'}).catch(function(){});}}

  async function loadConflictVersion(){
    await refresh({applyActive:false,silent:true});if(!state.conflict)return;var targetId=(state.conflict.body&&state.conflict.body.targetSetId)||state.activeSetId;if(!targetId)return;
    try{var detail=await request('/api/template-sets/'+encodeURIComponent(targetId));if(detail&&detail.set){state.conflict.serverSet=detail.set;if(detail.set.active){state.activeVersion=Number(detail.set.version)||state.activeVersion;state.activeTemplates=cloneTemplates(detail.set.templates);}}}catch(e){}
  }

  function persistSnapshot(list,providedHandle,providedIdempotencyKey){
    if(!hosted()||!state.activeSetId||state.applying)return Promise.resolve(false);if(state.snapshotSaving){state.snapshotQueued=true;return Promise.resolve(false);}state.snapshotSaving=true;
    var local=cloneTemplates(list),localIds={};local.forEach(function(t){if(t&&t.id)localIds[t.id]=1;});var removed=state.activeTemplates.filter(function(t){return t&&t.id&&!localIds[t.id];}).map(function(t){return t.id;});
    var body={targetSetId:state.activeSetId,expectedVersion:state.activeVersion,setName:(setFor(state.activeSetId)||{}).name,templates:local,removeTemplateIds:removed};var idem=providedIdempotencyKey||uid('tpl-edit-');
    var handle=providedHandle||progressStart({key:'template-library:save',kind:'template_library',label:'Saving template changes',stages:COMMIT_STAGES,total:local.length,timeoutMs:120000,replace:true,cancelable:true,retry:function(next){persistSnapshot(local,next,idem);}});
    return request('/api/template-imports/commit',{method:'POST',body:body,idempotencyKey:idem,requestId:handle&&handle.requestId,progress:handle}).then(function(data){if(data.result&&data.result.set)applySet(data.result.set);if(handle)handle.complete('Template changes saved as version '+data.result.version+'.');status('Template changes saved as recoverable version '+data.result.version+'.',false);renderPanel();return true;}).catch(function(error){status(error.message,true);state.conflict={kind:'snapshot',body:body,localTemplates:local};if(error.code==='TEMPLATE_VERSION_CONFLICT')return loadConflictVersion().then(function(){status('A newer cloud version exists. Your unsaved device change was preserved for review and retry.',true);renderPanel();if(handle)handle.fail(error);return false;});renderPanel();if(handle)handle.fail(error);return false;}).finally(function(){state.snapshotSaving=false;if(state.snapshotQueued){state.snapshotQueued=false;scheduleSnapshot(currentLocal());}});
  }
  function scheduleSnapshot(list){clearTimeout(state.snapshotTimer);var snapshot=cloneTemplates(list);state.snapshotTimer=setTimeout(function(){persistSnapshot(snapshot);},500);}

  function wrapFunctions(){
    if(isFn(window.setTemplates)&&!window.setTemplates.__tl){originals.setTemplates=window.setTemplates;var setWrap=function(list){var out=originals.setTemplates.apply(this,arguments);if(!state.applying&&state.hydrated&&state.activeSetId)scheduleSnapshot(list);return out;};setWrap.__tl=true;window.setTemplates=setWrap;}
    if(isFn(window.openTemplates)&&!window.openTemplates.__tl){originals.openTemplates=window.openTemplates;var openWrap=function(){var out=originals.openTemplates.apply(this,arguments);ensurePanel();refresh();return out;};openWrap.__tl=true;window.openTemplates=openWrap;}
    if(isFn(window.tplAddSplit)&&!window.tplAddSplit.__tl){originals.tplAddSplit=window.tplAddSplit;var addWrap=function(){
      if(!hosted())return originals.tplAddSplit.apply(this,arguments);
      var self=this,args=arguments,btn=null;
      try{var box=byId('tplMultiResult');btn=box?box.querySelector('button[onclick*="tplAddSplit"]'):null;if(btn){btn.disabled=true;btn.textContent='⏳ Adding templates…';}}catch(e){}
      /* Cloud preview failed (endpoint missing, session expired, server error):
         nothing was saved server-side, so fall back to the proven device add —
         the user's selection must never silently vanish. */
      return previewImport().catch(function(){
        try{if(isFn(window.toast))window.toast('Cloud sync unavailable — saving templates on this device instead.','ok');}catch(e){}
        return originals.tplAddSplit.apply(self,args);
      }).finally(function(){try{if(btn&&btn.isConnected){btn.disabled=false;btn.textContent='➕ Add selected to my templates';}}catch(e){}});
    };addWrap.__tl=true;window.tplAddSplit=addWrap;}
    /* tl-1.1.0 — SAVE SAVES. THE PREVIEW ROUND-TRIP IS GONE FROM THIS PATH.
       What shipped before: this wrapper refused the device save whenever
       hosted() and ran the import-preview round-trip in form mode instead.
       Measured live on b833 in the owner's Chrome, that produced three separate
       failures on one button press:

         1. The preview panel rendered into #tplFormResult at y=3004 in a 936px
            viewport. scrollIntoView() is called on it and does not land. No
            toast, form not cleared — the doctor sees NOTHING happen.
         2. Committing reported "Import completed · added: 1" while the device
            list stayed at 8 and the template never appeared in the library.
         3. The only control that landed it, "Activate imported set", ran
            applySet() — which REPLACES the device list with the set's contents.
            The set held only the just-saved template, so the library went
            8 -> 1, and setTemplates' syncPrefsToServer() overwrote the server
            copy too. Both copies of seven templates, gone, from pressing Save.

       A preview/commit round-trip is the right shape for a BULK import the
       doctor is reviewing (tplMultiFile still uses it). It is the wrong shape
       for "I typed one template and pressed Save", and it must never be the
       only path to persistence. Save now calls the proven device save, and the
       setTemplates wrapper above still schedules the cloud snapshot when a set
       is genuinely active — so hosted users keep syncing without the round-trip
       standing between the doctor and their own template. */
    if(isFn(window.saveTemplateFromForm)&&!window.saveTemplateFromForm.__tl){originals.saveTemplateFromForm=window.saveTemplateFromForm;var saveWrap=function(){
      try{state.sourceFilenames=['Manual template entry'];window._tplPendingSplit=[];}catch(e){}
      var out=originals.saveTemplateFromForm.apply(this,arguments);
      try{state.editingId='';}catch(e){}
      return out;};saveWrap.__tl=true;window.saveTemplateFromForm=saveWrap;}
    if(isFn(window.editTemplate)&&!window.editTemplate.__tl){originals.editTemplate=window.editTemplate;var editWrap=function(id){state.editingId=id;return originals.editTemplate.apply(this,arguments);};editWrap.__tl=true;window.editTemplate=editWrap;}
    /* b882 — reads report as 'Reading files' (they used to report as 'Parsing
       template content', which lit the parse step and parked the bar at N/N
       while recognition had not even begun — the "stuck at 90/90" report). */
    if(isFn(window._tplReadAnyFile)&&!window._tplReadAnyFile.__tl){originals.readFile=window._tplReadAnyFile;var readWrap=async function(file){var out=await originals.readFile.apply(this,arguments);if(activeUpload){activeUpload.done++;progressStage(activeUpload.handle,'Reading files',activeUpload.done,activeUpload.total,'Read '+S(file&&file.name||'file')+'.');}return out;};readWrap.__tl=true;window._tplReadAnyFile=readWrap;}
    /* b882 — the recognition loops in ScribeFlow (batch per-file, pair
       per-file, splitter per-chunk) announce themselves through this hook so
       the second bar moves file by file. Outside an active upload run it
       stays a no-op: the strip has no owner to retire it then, and a bar
       nobody clears is a lie about work still running. */
    if(!window._tplPhaseTick||!window._tplPhaseTick.__tl){var phaseTick=function(kind,done,total,label,found){
      try{
        if(!activeUpload)return;
        var n=Number(found)||0,d=Number(done)||0,t=Number(total)||0;
        var suffix=' — '+n+' template'+(n===1?'':'s')+' found so far.';
        if(kind==='recognize'){activeUpload.parse={c:d,t:t};progressStage(activeUpload.handle,'Parsing template content',d,t,'Recognizing '+S(label||'file')+suffix);}
        else if(kind==='recognize-part'){var pp=activeUpload.parse||{c:0,t:0};progressStage(activeUpload.handle,'Parsing template content',pp.c,pp.t,S(label||'file')+' · part '+(d+1)+'/'+(t||1)+suffix);}
      }catch(e){}
    };phaseTick.__tl=true;window._tplPhaseTick=phaseTick;}
    if(isFn(window.tplMultiFile)&&!window.tplMultiFile.__tl){originals.tplMultiFile=window.tplMultiFile;var uploadWrap=function(ev,providedHandle){var files=Array.prototype.slice.call(ev&&ev.target&&ev.target.files||[]),fp=files.map(function(f){return [f.name,f.size,f.lastModified].join(':');}).join('|');if(uploadRuns[fp])return uploadRuns[fp];var invalid=files.filter(function(f){return Number(f.size)>20*1024*1024;});if(files.length>500||invalid.length){var er=new Error(files.length>500?'Import at most 500 files at a time.':'Each template file must be 20 MB or smaller.');if(isFn(window.toast))window.toast(er.message,'err');return Promise.reject(er);}state.sourceFilenames=files.map(function(f){return S(f.name).slice(0,180);});var handle=providedHandle||progressStart({key:'template-upload:'+fp,kind:'template_upload',label:'Reading template files',stages:IMPORT_STAGES,total:files.length,timeoutMs:Math.min(60*60*1000,5*60*1000+files.length*20*1000),replace:true,cancelable:false,retry:function(next){uploadWrap({target:{files:files,value:''}},next);}});/* b882 — the deadline is ABSOLUTE (LoadingCalm never extends it on activity), and a 90-file import with OCR or AI-split legitimately outruns a flat 10 minutes — it then read "took longer than expected and stopped" while still working. Scale with the batch: 5 min + 20 s per file, capped at the 1-hour clamp. */var run=(async function(){try{progressStage(handle,'Validating files',0,files.length,'Checking file count, size, and readable types.');activeUpload={handle:handle,total:files.length,done:0};progressStage(handle,'Reading files',0,files.length,'Reading selected files without blocking the page.');await originals.tplMultiFile.call(window,{target:{files:files,value:''}});progressStage(handle,'Checking results',files.length,files.length,'Checking parsed templates and rejected files.');var found=(window._tplPendingSplit||[]).length;if(!found)throw new Error('No readable templates were found. Review the file errors and retry.');progressStage(handle,'Review ready',files.length,files.length,found+' template'+(found===1?'':'s')+' ready for review.');if(handle)handle.complete('Template review ready.');return found;}catch(error){if(handle)handle.fail(error);throw error;}finally{activeUpload=null;delete uploadRuns[fp];}})();uploadRuns[fp]=run;return run;};uploadWrap.__tl=true;window.tplMultiFile=uploadWrap;}
  }

  function install(){wrapFunctions();ensurePanel();if(hosted())setTimeout(function(){refresh({silent:true});},0);}
  window.__mlsTemplateLibrary={installed:true,version:VERSION,state:state,refresh:refresh,previewImport:previewImport,commitPending:commitPending,activateSet:activateSet,applySet:applySet,persistSnapshot:persistSnapshot,render:renderPanel,_request:request,_importBody:importBody};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
