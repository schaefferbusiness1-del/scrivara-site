/* !!! STALE REFERENCE (flagged v2.9.10, per Codex E1 follow-up) !!!
 * This file has DRIFTED from the live inline reader in background.js (it lacks the
 * structural-ID + coord-scroll lanes, _reasonS, the v2.9.7 suffix strip, the v2.9.8
 * frame guard, v2.9.9 dedup, and the v2.9.10 shadow parser). It is NOT loaded at
 * runtime. Do NOT test against this copy - background.js's injected closure is the
 * single source of truth until the canonical-parser cutover regenerates this file
 * with a parity test. */
/* inject_dom.js — SELF-CONTAINED DOM schedule/provider reader.
 * This exact function body is inlined into MLS Assist background.js's executeScript
 * `func` so it runs INSIDE the athenaOne schedule frame. It must reference nothing
 * outside itself. Returns { appts:[{time,name,provider}], providers:[...], diag:{} }.
 * Read-only; PHI (patient names) stays in the user's browser; diag is PHI-free. */
function mlsSchedDomInline(doc){
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
