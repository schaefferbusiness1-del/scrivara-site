/* Reference implementation for the live inline reader in background.js. The
 * packaged runtime remains the source of truth, but this copy intentionally
 * carries the same virtualization invariants: horizontal + vertical sweeps,
 * rendered-row-aware dedup, scroll restoration, and candidate/parsed counts. */
/* inject_dom.js — SELF-CONTAINED DOM schedule/provider reader.
 * This exact function body is inlined into MLS Assist background.js's executeScript
 * `func` so it runs INSIDE the athenaOne schedule frame. It must reference nothing
 * outside itself. Returns { appts:[{time,name,provider}], providers:[...], diag:{} }.
 * Read-only; PHI (patient names) stays in the user's browser; diag is PHI-free. */
async function mlsSchedDomInline(doc){
  var out={appts:[],providers:[],diag:{strategy:'dom',via:'',tables:0,rowsScanned:0,apptCount:0,providerCount:0,providerNames:[],credsSeen:[]}};
  try{
    var RT=/\b(\d{1,2}):(\d{2})\s*([ap]\.?\s?m\.?)?\b/i, RTG=/\b\d{1,2}:\d{2}\s*(?:[ap]\.?\s?m\.?)?\b/gi;
    var RC=/(?:^|[^A-Za-z])(MD|DO|NP|PA-?C?|APRN|FNP|DNP|AGNP|WHNP|PMHNP|RN|LPN|DPM|DDS|DMD|PHD|PSY\.?D|MBBS|CNM|CRNA|OD|LCSW|LPC)(?:[^A-Za-z]|$)/;
    var CI=/^(md|do|np|pa|pac|aprn|fnp|dnp|agnp|whnp|pmhnp|rn|lpn|dpm|dds|dmd|phd|psyd|mbbs|cnm|crna|od|lcsw|lpc)$/;
    var RA=/\bappointment/i, RN=/([A-Z][A-Za-z'’-]+)\s*,\s*([A-Z][A-Za-z'’-]+)/;
    var STOP=/^(am|pm|new|est|established|office|visit|tele|telehealth|video|phone|follow|followup|fu|consult|consultation|annual|physical|wellness|exam|sick|nurse|lab|labs|injection|inj|procedure|recheck|np|min|mins|minute|minutes|arrived|checkedin|checked|scheduled|confirmed|cancelled|canceled|noshow|no|show|room|status|reason|provider|patient|time|type|resource|rendering|department|dept|appt|appts|total|appointments)$/i;
    function cl(s){return String(s==null?'':s).replace(/\s+/g,' ').trim();}
    function ht(s){return RT.test(String(s));}
    function ft(s){var m=String(s).match(RTG);return m?cl(m[0]):'';}
    function cp(s){var t=cl(s);t=t.replace(/[•‣▪●>*\-–—]+\s*$/g,'');t=t.replace(/[-–—:|(]*\s*\d+\s*appointments?\b.*$/i,'');t=t.replace(/\b\d+\s*appointments?\b/i,'');t=t.replace(/\(\s*\d+\s*\)\s*$/,'');t=t.replace(/[\s,;:|–—-]+$/,'');t=t.replace(/\s*[Cc]lose\s*$/,'');return cl(t);}
    function pui(s){var t=cl(s).toLowerCase().replace(/[\s:|\-–—]+$/g,'').trim();return /^(?:(?:appointment|appt)\s+)?(?:date(?:\s*(?:\/|&|and)\s*time)?|time|type|status|duration|reason|patient(?:\s+(?:name|details?))?|provider(?:\s+name)?|rendering\s+provider|resource(?:\s+name)?|department(?:\s+name)?|schedule|scheduling|location|room)$/i.test(t);}
    function lh(line){var t=cl(line);if(!t||t.length>80)return false;if(ht(t))return false;var hc=RC.test(t),ha=RA.test(t),hn=RN.test(t)||/[A-Z][a-z]+[ _][A-Z][a-z]+/.test(t);if((hc&&hn)||(ha&&hn))return true;if(hc&&RN.test(t)&&t.split(/\s+/).length<=5)return true;return false;}
    function pn(line){var t=cl(line);var mc=t.match(RN);if(mc)return cl(mc[0]);var af=t.replace(RTG,' ');var ws=af.split(/\s+/).filter(function(w){return /[A-Za-z]/.test(w);});var pk=[];for(var i=0;i<ws.length&&pk.length<3;i++){var w=ws[i].replace(/[^A-Za-z'’-]/g,'');if(!w)continue;if(STOP.test(w)||CI.test(w.toLowerCase())){if(pk.length)break;else continue;}if(/^[A-Z]/.test(w))pk.push(w);else if(pk.length)break;}return pk.join(' ');}
    function tx(el){try{return cl(el.textContent);}catch(e){return '';}}
    var provSet={},provOrder=[],credSet={};
    function np(p){p=cp(p);if(pui(p))return '';if(p&&/[A-Za-z]/.test(p)&&p.length<=60&&!provSet[p.toLowerCase()]){provSet[p.toLowerCase()]=1;provOrder.push(p);}if(p){var cm=p.match(RC);if(cm&&cm[1])credSet[cm[1].toUpperCase()]=1;}return p;}
    if(!doc||!doc.querySelectorAll)return out;
    try{out.diag.scheduleStructure=!!doc.querySelector('[class*="PatientAppointment_appointment-container"], [class*="ScheduleColumn_schedule-column"], [data-testid*="schedule-grid" i], [aria-label*="schedule grid" i], [class~="appointments-container"], [class~="filled-appointment-row"]');}catch(_eSs){out.diag.scheduleStructure=false;}
    /* Athena's React grid recycles appointment nodes while scrolling. A DOM id
       alone is therefore not a patient identity. Sweep both axes, include the
       rendered time/name in the key, and restore the user's exact scroll state. */
    try{
      if(doc.querySelector('[class*="PatientAppointment_appointment-container"], [class*="ScheduleColumn_schedule-column"]')){
        function sl(ms){return new Promise(function(r){setTimeout(r,ms);});}
        function capSlot(s){var z=cl(s).toLowerCase().replace(/[\-_\/|]+/g,' ').replace(/[()[\]{}:;,]+/g,' ').replace(/\s+/g,' ').trim();var h=/^(open|available|unavailable|block(?:ed)?|hold|reserved|lunch|break|admin(?:istrative)?|meeting|closed|buffer)\b/.exec(z);if(!h)return false;var rest=z.slice(h[0].length).replace(RTG,' ').replace(/\b\d+(?:\.\d+)?\s*(?:min(?:ute)?s?|hrs?|hours?)?\b/gi,' ').replace(/\b(?:open|available|unavailable|block(?:ed)?|hold|reserved|lunch|break|admin(?:istrative)?|meeting|closed|buffer|slot|slots|time|appointment|appointments|appt|appts|capacity)\b/gi,' ').replace(/\s+/g,' ').trim();return !rest;}
        function heads(){var a=[];[].slice.call(doc.querySelectorAll('div,span,h1,h2,h3,h4,th,td')).forEach(function(e){try{var t=tx(e);if(!t||t.length>90||!lh(t)||e.children.length>6)return;var r=e.getBoundingClientRect();if(r.width>20&&r.width<520){var nm=np(cp(t));if(nm)a.push({name:nm,cx:r.left+r.width/2});}}catch(_e){}});return a;}
        var rowsByKey={},candidates={},all=[].slice.call(doc.querySelectorAll('*')),view=doc.defaultView||window,budgetEnd=Date.now()+15000;
        function collect(forcedHeads){var hs=(forcedHeads&&forcedHeads.length)?forcedHeads:heads();[].slice.call(doc.querySelectorAll('[class*="ScheduleColumn_schedule-column"]')).forEach(function(col){var r;try{r=col.getBoundingClientRect();}catch(_e){return;}if(r.width<40)return;var provider='',dist=1e9,ccx=r.left+r.width/2;hs.forEach(function(h){var d=Math.abs(ccx-h.cx);if(d<dist){dist=d;provider=h.name;}});if(dist>=r.width)provider='';[].slice.call(col.querySelectorAll('[class*="PatientAppointment_appointment-container"]')).forEach(function(b){var raw=tx(b),time=ft(raw),name=pn(raw);if(!time||capSlot(name||raw))return;var logicalKey=time+'|'+String(name||raw).toLowerCase().replace(/\s+/g,' ').trim()+'|'+String(provider||'').toLowerCase().replace(/\s+/g,' ').trim();var key=(b.id||b.getAttribute('data-appointment-id')||b.getAttribute('data-testid')||'row')+'|'+logicalKey;candidates[logicalKey]=1;if(!rowsByKey[key])rowsByKey[key]={time:time,name:name,provider:provider||''};});});}
        function axis(max,step,cap){max=Math.max(0,Number(max||0));step=Math.max(1,Number(step||1));var raw=[];for(var p=0;p<=max;p+=step)raw.push(Math.min(p,max));if(!raw.length||raw[raw.length-1]!==max)raw.push(max);var capped=raw.length>cap;if(capped)raw=raw.slice(0,cap-1).concat([max]);return{values:raw,capped:capped,max:max};}
        var hsc=null;all.forEach(function(el){try{var cs=view.getComputedStyle(el);if(/(auto|scroll)/.test(cs.overflowX)&&el.scrollWidth>el.clientWidth+50&&el.clientWidth>300&&(!hsc||el.scrollWidth>hsc.scrollWidth))hsc=el;}catch(_e){}});
        var oldLeft=hsc?(hsc.scrollLeft||0):0,hMax=hsc?Math.max(0,hsc.scrollWidth-hsc.clientWidth):0,hAxis=axis(hMax,hsc?Math.max(160,Math.round(hsc.clientWidth*.55)):1,24);
        var vcs=[],seen=[];all.forEach(function(el){try{var cs=view.getComputedStyle(el),sh=el.scrollHeight||0,ch=el.clientHeight||0,shaped=!!el.querySelector('[class*="PatientAppointment_appointment-container"]');if(shaped&&/(auto|scroll)/.test(cs.overflowY)&&sh>ch+40&&ch>100)vcs.push({el:el,score:(sh-ch)+1000000});}catch(_e){}});try{var de=doc.scrollingElement;if(de&&de.scrollHeight>de.clientHeight+40&&de.querySelector('[class*="PatientAppointment_appointment-container"]'))vcs.push({el:de,score:(de.scrollHeight-de.clientHeight)+500000});}catch(_e){}vcs.sort(function(a,b){return b.score-a.score;});vcs=vcs.filter(function(v){if(seen.indexOf(v.el)>=0)return false;seen.push(v.el);return true;});
        var vContainerCap=vcs.length>2,vwork=vcs.slice(0,2);if(!vwork.length)vwork=[{el:null,score:0}];
        var cov={complete:false,reason:'unverified',horizontalScrollable:!!hsc,horizontalMax:hMax,horizontalSteps:hAxis.values.length,verticalContainers:vcs.length,verticalContainersSwept:0,cellsPlanned:0,cellsVisited:0,axisCap:!!hAxis.capped,containerCap:vContainerCap,budgetExpired:false,boundsStable:true,restored:true};
        for(var vi=0;vi<vwork.length;vi++){var sc=vwork[vi].el,oldTop=sc?(sc.scrollTop||0):0,vmax=sc?Math.max(0,(sc.scrollHeight||0)-(sc.clientHeight||0)):0,vAxis=axis(vmax,sc?Math.max(120,Math.round((sc.clientHeight||240)*.65)):1,24);cov.axisCap=cov.axisCap||vAxis.capped;cov.cellsPlanned+=hAxis.values.length*vAxis.values.length;var finished=true;
          for(var xi=0;xi<hAxis.values.length&&finished;xi++){if(Date.now()>=budgetEnd){finished=false;break;}if(hsc){hsc.scrollLeft=hAxis.values[xi];hsc.dispatchEvent(new Event('scroll',{bubbles:true}));}var cachedHeads=null;
            for(var yi=0;yi<vAxis.values.length;yi++){if(Date.now()>=budgetEnd){finished=false;break;}if(sc){sc.scrollTop=vAxis.values[yi];sc.dispatchEvent(new Event('scroll',{bubbles:true}));}await sl(90);var liveHeads=heads();if(liveHeads.length)cachedHeads=liveHeads;collect(cachedHeads);cov.cellsVisited++;}
          }
          cov.verticalContainersSwept++;if(!finished)cov.budgetExpired=true;
          if(sc){var endMax=Math.max(0,(sc.scrollHeight||0)-(sc.clientHeight||0));if(endMax!==vmax)cov.boundsStable=false;sc.scrollTop=oldTop;sc.dispatchEvent(new Event('scroll',{bubbles:true}));if(Math.abs((sc.scrollTop||0)-oldTop)>2)cov.restored=false;}
          if(!finished)break;
        }
        if(hsc){var endH=Math.max(0,hsc.scrollWidth-hsc.clientWidth);if(endH!==hMax)cov.boundsStable=false;hsc.scrollLeft=oldLeft;hsc.dispatchEvent(new Event('scroll',{bubbles:true}));if(Math.abs((hsc.scrollLeft||0)-oldLeft)>2)cov.restored=false;}
        cov.complete=!cov.axisCap&&!cov.containerCap&&!cov.budgetExpired&&cov.boundsStable&&cov.restored&&cov.cellsVisited===cov.cellsPlanned&&cov.verticalContainersSwept===vwork.length;cov.reason=cov.complete?'complete':(cov.budgetExpired?'sweep-budget':(cov.axisCap?'axis-cap':(cov.containerCap?'container-cap':(!cov.boundsStable?'bounds-changed':(!cov.restored?'restore-failed':'incomplete-cross-product')))));out.diag.viewportCoverage=cov;
        var unnamed=0;Object.keys(rowsByKey).forEach(function(k){var a=rowsByKey[k];if(!a.name)unnamed++;out.appts.push(a);});
        if(out.appts.length){var usedS={};out.appts.forEach(function(a){if(a.provider)usedS[a.provider.toLowerCase()]=a.provider;});out.providers=Object.keys(usedS).map(function(k){return usedS[k];});out.diag.via='structure-id';out.diag.strategy='structure-id';out.diag.candidateCount=Object.keys(candidates).length;out.diag.parsedCount=out.appts.length-unnamed;out.diag.unnamedCount=unnamed;out.diag.apptCount=out.appts.length;out.diag.providerCount=out.providers.length;out.diag.providerNames=out.providers.slice(0,20);return out;}
      }
    }catch(_eStruct){out.diag.structErr=String(_eStruct&&_eStruct.message||_eStruct).slice(0,100);}
    var grids=[].slice.call(doc.querySelectorAll('table, [role="grid"], [role="table"]'));
    out.diag.tables=grids.length;
    for(var g=0;g<grids.length&&!out.appts.length;g++){
      var grid=grids[g];
      var hc=[].slice.call(grid.querySelectorAll('thead th, [role="columnheader"]'));
      var rows=[].slice.call(grid.querySelectorAll('tbody tr, [role="row"]'));
      if(!rows.length)rows=[].slice.call(grid.querySelectorAll('tr'));
      if(!hc.length&&rows.length)hc=[].slice.call(rows[0].querySelectorAll('th, td, [role="columnheader"], [role="cell"], [role="gridcell"]'));
      var pi=-1,ni=-1;
      hc.forEach(function(h,idx){var t=tx(h).toLowerCase();if(pi<0&&/(provider|rendering|resource|clinician|scheduling provider|doctor|seen by|with)/.test(t)&&!/patient/.test(t))pi=idx;if(ni<0&&/(patient|name)/.test(t))ni=idx;});
      if(pi<0)continue;
      rows.forEach(function(r){out.diag.rowsScanned++;var cells=[].slice.call(r.querySelectorAll('th, td, [role="cell"], [role="gridcell"]'));if(!cells.length)return;var rt=tx(r);if(!ht(rt))return;var prov=cells[pi]?np(tx(cells[pi])):'';var nm=ni>=0&&cells[ni]?tx(cells[ni]):pn(rt);if(nm)out.appts.push({time:ft(rt),name:cl(nm),provider:prov||''});});
      if(out.appts.length)out.diag.via='table-column';
    }
    if(!out.appts.length){
      var all=[].slice.call(doc.querySelectorAll('div,li,tr,section,article,a,span,p'));
      var seq=[];
      all.forEach(function(el){var own=tx(el);if(!own||own.length>400)return;if(own.length<=80&&lh(own)&&el.querySelectorAll('*').length<=6){seq.push({k:'p',t:own});}else if(ht(own)&&own.length<300&&pn(own)){var cb=false;for(var c=0;c<el.children.length;c++){var ct=tx(el.children[c]);if(ht(ct)&&pn(ct)){cb=true;break;}}if(!cb)seq.push({k:'a',t:own});}});
      var cur='';
      seq.forEach(function(n){out.diag.rowsScanned++;if(n.k==='p'){cur=np(n.t);}else{var inRow='';if(RC.test(n.t)){var mN=n.t.match(/([A-Z][A-Za-z'’-]+\s*,\s*[A-Z][A-Za-z'’-]+\s*(?:MD|DO|NP|PA-?C?|APRN|FNP|DNP|RN|DPM|DDS|DMD|PHD|MBBS|OD)\b)/);if(mN)inRow=np(mN[1]);}var nm2=pn(n.t);if(nm2)out.appts.push({time:ft(n.t),name:nm2,provider:inRow||cur||''});}});
      if(out.appts.length&&!out.diag.via)out.diag.via='grouped-dom';
    }
    var used={};out.appts.forEach(function(a){if(a.provider)used[a.provider.toLowerCase()]=a.provider;});
    out.providers=Object.keys(used).length?provOrder.filter(function(p){return used[p.toLowerCase()];}):provOrder;
    out.diag.apptCount=out.appts.length;out.diag.providerCount=out.providers.length;out.diag.providerNames=out.providers.slice(0,20);out.diag.credsSeen=Object.keys(credSet);
  }catch(e){out.diag.err=String(e&&e.message||e).slice(0,120);}
  return out;
}
if(typeof module!=='undefined'&&module.exports)module.exports={mlsSchedDomInline:mlsSchedDomInline};
