/* ============================================================
   MLS-CONNECT — connectedness feature bundle (external)
   Loaded by ScribeFlow via a cache-busted <script> loader.
   Each feature is a self-contained IIFE, progressive-enhancement,
   guarded with try/catch, never modifies existing app functions.
   ============================================================ */


/* ---- module: feat_cmdk.js ---- */

/* ===== MLS Cmd-K Command Palette — connectedness feature #1 =====
   Global searchable palette (Cmd/Ctrl-K) to find any patient, visit/note, or action and jump to it.
   Self-contained progressive enhancement: own IIFE, all external calls guarded, never modifies any
   existing app function, reads state via public globals. Keyboard: Cmd/Ctrl-K toggles, type to
   filter, Up/Down move, Enter open, Esc close. Mobile-friendly. Exposes window.__mlsCmdK. */
(function(){
  'use strict';
  if (window.__mlsCmdK) return;
  var OV='mlsCmdkOverlay', CSS='mlsCmdkCss';
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function getPatients(){ var p=safe(function(){return window.getPatients&&window.getPatients();},[]); return Array.isArray(p)?p:[]; }
  function notesFor(id){ var n=safe(function(){return window.patientNotes&&window.patientNotes(id);},[]); return Array.isArray(n)?n:[]; }
  function fmtDate(v){ if(!v) return ''; var d=new Date(v); return isNaN(d)?'' : d.toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}); }
  function go(view){ safe(function(){ window.showView && window.showView(view); }); }
  function openChart(id){ safe(function(){ if(window.setActivePtId) window.setActivePtId(id); if(window.openPatient) window.openPatient(id); else go('patients'); }); }
  function openNote(n){ safe(function(){ if(window.setActivePtId && n.patientId) window.setActivePtId(n.patientId); go('history'); setTimeout(function(){ try{ var el=document.getElementById('note-'+n.id)||document.querySelector('[data-note-id="'+n.id+'"]'); if(el&&el.scrollIntoView) el.scrollIntoView({block:'center'}); }catch(e){} }, 200); }); }
  function commands(){
    var cmds=[
      {label:'Calendar', hint:'Go to schedule', icon:'📅', run:function(){go('calendar');}},
      {label:'Patients', hint:'Patient list', icon:'👥', run:function(){go('patients');}},
      {label:'Visit', hint:'Capture a visit', icon:'🎙️', run:function(){go('visit');}},
      {label:'Orders', hint:'Orders', icon:'📋', run:function(){go('orders');}},
      {label:'Recommendations', hint:'AI recommendations', icon:'💡', run:function(){go('recs');}},
      {label:'History', hint:'Visit history', icon:'📚', run:function(){go('history');}},
      {label:'Patient timeline', hint:'Chronological thread for active patient', icon:'🕒', run:function(){ safe(function(){ window.__mlsTimeline && window.__mlsTimeline.open(); }); }},
      {label:'Activity feed', hint:'Recent practice activity', icon:'🔔', run:function(){ safe(function(){ window.__mlsActivity && window.__mlsActivity.open(); }); }},
      {label:'Recommendations from note', hint:'Auto-drawn imaging/referral/coding', icon:'🧩', run:function(){ safe(function(){ window.__mlsRecs && window.__mlsRecs.open(); }); }},
      {label:'Supervision queue', hint:'Drafts awaiting review / cosign', icon:'👥', run:function(){ safe(function(){ window.__mlsSupervision && window.__mlsSupervision.open(); }); }},
      {label:'Check Athena chart match', hint:'Is the open Athena chart this patient?', icon:'🔎', run:function(){ safe(function(){ window.__mlsAthenaMatch && window.__mlsAthenaMatch.check(); }); }},
      {label:'Flag legal / IME case', hint:'Assemble notes for a legal report', icon:'⚖️', run:function(){ safe(function(){ window.__mlsLegalChain && window.__mlsLegalChain.flagCase(); }); }},
      {label:'Legal requests', hint:'IME / legal', icon:'⚖️', run:function(){go('legalreq');}},
      {label:'Team', hint:'Team', icon:'👥', run:function(){go('team');}},
      {label:'Analysis', hint:'Trends & outcomes', icon:'📊', run:function(){go('analysis');}},
      {label:'AI Studio', hint:'Copilot & tools', icon:'✨', run:function(){go('studio');}},
      {label:'Admin', hint:'Admin panel', icon:'🛡️', run:function(){go('admin');}},
      {label:'Help', hint:'Open help', icon:'❓', run:function(){ safe(function(){ window.openMlsHelp ? window.openMlsHelp() : go('visit'); }); }},
      {label:'Ask MLS', hint:'Ask the assistant', icon:'💬', run:function(){ safe(function(){ window.askMlsHelp && window.askMlsHelp(); }); }}
    ];
    return cmds.map(function(c){ return {type:'cmd', title:c.label, sub:c.hint, icon:c.icon, run:c.run}; });
  }
  function patientItems(){
    return getPatients().map(function(p){
      var sub=[p.dob?('DOB '+p.dob):'', p.mrn?('MRN '+p.mrn):'', p.sex||''].filter(Boolean).join(' · ');
      return {type:'patient', title:p.name||'(unnamed)', sub:sub, icon:'🧑', _hay:(p.name||'')+' '+(p.mrn||'')+' '+(p.dob||''), run:function(){ openChart(p.id); }};
    });
  }
  function noteItems(){
    var out=[], pts=getPatients();
    pts.forEach(function(p){
      notesFor(p.id).forEach(function(n){
        var when=fmtDate(n.created||n.updated);
        var kind=n.kind||(n.isDraft?'Draft':'Note');
        var cc=n.cc||'';
        out.push({type:'note', title:(p.name||n.patient||'Visit')+' — '+kind, sub:[when, cc].filter(Boolean).join(' · '),
                  icon:n.signed?'✅':'📝', _hay:(p.name||'')+' '+kind+' '+cc+' '+when, run:function(){ openNote(n); }});
      });
    });
    return out;
  }
  function buildIndex(){ return { patients:patientItems(), notes:noteItems(), cmds:commands() }; }
  function score(hay, q){
    hay=hay.toLowerCase();
    if(hay.indexOf(q)>=0) return 100 - hay.indexOf(q);
    var hi=0, qi=0; while(hi<hay.length && qi<q.length){ if(hay[hi]===q[qi]) qi++; hi++; }
    return qi===q.length ? 20 : -1;
  }
  function filterGroup(items, q){
    if(!q) return items;
    return items.map(function(it){ var s=score(it._hay||it.title, q); return {it:it, s:s}; })
                .filter(function(x){ return x.s>=0; })
                .sort(function(a,b){ return b.s-a.s; })
                .map(function(x){ return x.it; });
  }
  var idx=null, flat=[], sel=0;
  function render(q){
    var groups=[];
    var P=filterGroup(idx.patients,q).slice(0,8);
    var N=filterGroup(idx.notes,q).slice(0,8);
    var C=filterGroup(idx.cmds,q).slice(0, q?8:14);
    if(P.length) groups.push({label:'Patients', items:P});
    if(N.length) groups.push({label:'Visits & notes', items:N});
    if(C.length) groups.push({label:'Actions', items:C});
    flat=[]; groups.forEach(function(g){ g.items.forEach(function(it){ flat.push(it); }); });
    if(sel>=flat.length) sel=flat.length?flat.length-1:0;
    var html='', fi=0;
    if(!groups.length){ html='<div class="mlsck-empty">No matches for “'+esc(q)+'”</div>'; }
    groups.forEach(function(g){
      html+='<div class="mlsck-group">'+esc(g.label)+'</div>';
      g.items.forEach(function(it){
        var i=fi++;
        html+='<div class="mlsck-item'+(i===sel?' sel':'')+'" data-i="'+i+'">'
            +   '<span class="mlsck-ic">'+esc(it.icon||'•')+'</span>'
            +   '<span class="mlsck-txt"><span class="mlsck-title">'+esc(it.title)+'</span>'
            +     (it.sub?'<span class="mlsck-sub">'+esc(it.sub)+'</span>':'')+'</span>'
            +   '<span class="mlsck-type">'+esc(it.type==='cmd'?'action':it.type)+'</span>'
            + '</div>';
      });
    });
    var list=document.getElementById('mlsCmdkList'); if(list){ list.innerHTML=html;
      list.querySelectorAll('.mlsck-item').forEach(function(el){
        el.addEventListener('mousemove', function(){ sel=+el.getAttribute('data-i'); markSel(); });
        el.addEventListener('click', function(){ sel=+el.getAttribute('data-i'); activate(); });
      });
    }
  }
  function markSel(){ var list=document.getElementById('mlsCmdkList'); if(!list) return;
    list.querySelectorAll('.mlsck-item').forEach(function(el){ var on=(+el.getAttribute('data-i'))===sel; el.classList.toggle('sel',on); if(on&&el.scrollIntoView) el.scrollIntoView({block:'nearest'}); }); }
  function activate(){ var it=flat[sel]; if(!it) return; close(); safe(it.run); }
  function open(){
    if(document.getElementById(OV)) return;
    injectCss();
    idx=buildIndex(); sel=0;
    var ov=document.createElement('div'); ov.id=OV;
    ov.innerHTML='<div class="mlsck-panel" role="dialog" aria-label="Command palette">'
      +'<input id="mlsCmdkInput" type="text" autocomplete="off" spellcheck="false" placeholder="Search patients, visits, actions…" />'
      +'<div id="mlsCmdkList" class="mlsck-list"></div>'
      +'<div class="mlsck-foot"><span><b>↑↓</b> navigate</span><span><b>↵</b> open</span><span><b>esc</b> close</span></div>'
      +'</div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    var inp=document.getElementById('mlsCmdkInput');
    inp.addEventListener('input', function(){ sel=0; render(inp.value.trim().toLowerCase()); });
    inp.addEventListener('keydown', function(e){
      if(e.key==='ArrowDown'){ e.preventDefault(); if(flat.length){ sel=(sel+1)%flat.length; markSel(); } }
      else if(e.key==='ArrowUp'){ e.preventDefault(); if(flat.length){ sel=(sel-1+flat.length)%flat.length; markSel(); } }
      else if(e.key==='Enter'){ e.preventDefault(); activate(); }
      else if(e.key==='Escape'){ e.preventDefault(); close(); }
    });
    render('');
    setTimeout(function(){ inp.focus(); }, 20);
  }
  function close(){ var ov=document.getElementById(OV); if(ov) ov.remove(); }
  function toggle(){ document.getElementById(OV) ? close() : open(); }
  function injectCss(){
    if(document.getElementById(CSS)) return;
    var s=document.createElement('style'); s.id=CSS;
    s.textContent=
      '#'+OV+'{position:fixed;inset:0;z-index:99999;background:rgba(15,28,46,.38);display:flex;align-items:flex-start;justify-content:center;padding:12vh 16px 16px;backdrop-filter:saturate(120%) blur(2px);}'
      +'#'+OV+' .mlsck-panel{width:100%;max-width:560px;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);overflow:hidden;display:flex;flex-direction:column;max-height:72vh;}'
      +'#mlsCmdkInput{border:0;outline:0;padding:16px 18px;font-size:16px;color:var(--ink,#15293f);background:transparent;border-bottom:1px solid var(--line,#e6e9ef);font-family:inherit;}'
      +'#mlsCmdkInput::placeholder{color:var(--muted,#92a0b3);}'
      +'.mlsck-list{overflow:auto;padding:6px;}'
      +'.mlsck-group{font-size:11px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:var(--muted,#7c8aa0);padding:10px 12px 4px;}'
      +'.mlsck-item{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:10px;cursor:pointer;}'
      +'.mlsck-item.sel{background:var(--brand,#2563c9);}'
      +'.mlsck-item.sel .mlsck-title,.mlsck-item.sel .mlsck-sub,.mlsck-item.sel .mlsck-type{color:#fff;}'
      +'.mlsck-ic{flex:0 0 auto;width:22px;text-align:center;font-size:15px;}'
      +'.mlsck-txt{display:flex;flex-direction:column;min-width:0;flex:1 1 auto;}'
      +'.mlsck-title{font-size:14px;font-weight:600;color:var(--ink,#15293f);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlsck-sub{font-size:12px;color:var(--muted,#7c8aa0);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlsck-type{flex:0 0 auto;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted,#aab4c2);border:1px solid var(--line,#e6e9ef);border-radius:6px;padding:2px 6px;}'
      +'.mlsck-item.sel .mlsck-type{border-color:rgba(255,255,255,.5);}'
      +'.mlsck-empty{padding:26px 16px;text-align:center;color:var(--muted,#7c8aa0);font-size:14px;}'
      +'.mlsck-foot{display:flex;gap:16px;padding:9px 14px;border-top:1px solid var(--line,#e6e9ef);font-size:11px;color:var(--muted,#7c8aa0);}'
      +'.mlsck-foot b{color:var(--ink,#41526a);font-weight:700;}'
      +'@media (max-width:620px){#'+OV+'{padding:8vh 8px 8px;}.mlsck-panel{max-height:84vh;}#mlsCmdkInput{font-size:16px;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  function onKey(e){
    var k=(e.key||'').toLowerCase();
    if((e.metaKey||e.ctrlKey) && k==='k'){ e.preventDefault(); e.stopPropagation(); toggle(); }
  }
  document.addEventListener('keydown', onKey, true);
  window.__mlsCmdK={ open:open, close:close, toggle:toggle };
})();


/* ---- module: feat_timeline.js ---- */

/* ===== MLS Unified Patient Timeline — connectedness feature #2 =====
   One chronological thread per patient aggregating: visits/notes, calendar appointments,
   outcomes, plus extensible hooks for legal exports, Athena sync events, and recommendations.
   Self-contained progressive enhancement: own IIFE, all reads guarded, no existing app function
   is modified. Each event is click-to-jump. Sources that have no data/accessor are silently
   omitted (graceful fallback). Entry points: window.__mlsTimeline.open(patientId), a button
   injected into the unified card (via observation, not monkey-patching), and a Cmd-K action.
   Extensible: other feature modules can register event providers via
   window.__mlsTimeline.addProvider(fn) where fn(patientId)->[{date,type,icon,title,sub,onClick}]. */
(function(){
  'use strict';
  if (window.__mlsTimeline) return;
  var OV='mlsTlOverlay', CSS='mlsTlCss';
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function parseTime(v){ if(v==null) return 0; if(typeof v==='number') return v>1e12?v:v*1000; var d=new Date(v); return isNaN(d)?0:d.getTime(); }
  function fmtDate(t){ if(!t) return ''; return new Date(t).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}); }
  function activeId(){ return safe(function(){ return window.getActivePtId && window.getActivePtId(); }, null); }
  function findPt(id){ return safe(function(){ if(window.findPatient) return window.findPatient(id); var ps=(window.getPatients&&window.getPatients())||[]; return ps.filter(function(p){return p.id===id;})[0]||null; }, null); }
  function domEmail(){ return safe(function(){ return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]; }, null); }

  /* ---------- built-in providers ---------- */
  function visitProvider(id){
    var notes=safe(function(){ return (window.patientNotes&&window.patientNotes(id))||[]; }, []);
    if(!Array.isArray(notes)) return [];
    return notes.map(function(n){
      return { date:parseTime(n.created||n.updated||n.date), type:'visit',
        icon:n.signed?'✅':(n.isDraft?'📝':'📄'),
        title:(n.kind||(n.isDraft?'Draft note':'Visit note'))+(n.signed?' · signed':''),
        sub:n.cc||(n.text?String(n.text).slice(0,60):''),
        onClick:function(){ safe(function(){ if(window.setActivePtId)window.setActivePtId(id); if(window.showView)window.showView('history'); setTimeout(function(){ try{var el=document.getElementById('note-'+n.id)||document.querySelector('[data-note-id="'+n.id+'"]'); if(el&&el.scrollIntoView) el.scrollIntoView({block:'center'});}catch(e){} },220); }); } };
    });
  }
  function apptProvider(id){
    var src=safe(function(){ return window._calAppts; }, null);
    if(!src) return [];
    var list=[];
    safe(function(){
      if(Array.isArray(src)) list=src;
      else if(typeof src==='object'){ Object.keys(src).forEach(function(k){ var v=src[k]; if(Array.isArray(v)) list=list.concat(v); else if(v&&typeof v==='object') list.push(v); }); }
    });
    var pt=findPt(id); var pname=pt?(pt.name||'').toLowerCase():'';
    return list.filter(function(a){ if(!a) return false;
        if(a.patient_external_id!=null && String(a.patient_external_id)===String(id)) return true;
        var an=(a.name||a.patient||a.patientName||'').toLowerCase(); return an && pname && an===pname;
      }).map(function(a){
        var t=parseTime(a.start_at||a.appt_date||a.date||a.start||a.when);
        var status=a.status||a.state||'';
        return { date:t, type:'appointment', icon:'📅',
          title:'Appointment'+(a.reason?(' · '+String(a.reason).slice(0,50)):''),
          sub:[fmtTimeOnly(a), status].filter(Boolean).join(' · '),
          onClick:function(){ safe(function(){ if(window.calOpenDay && a.appt_date) window.calOpenDay(a.appt_date); else if(window.showView) window.showView('calendar'); }); } };
      });
  }
  function fmtTimeOnly(a){ return safe(function(){ if(window._fmtApptTime) return window._fmtApptTime(a); var t=parseTime(a.date||a.start||a.when||a.datetime); return t?new Date(t).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):''; }, ''); }
  function outcomeProvider(id){
    var email=domEmail(); if(!email) return [];
    var raw=safe(function(){ return localStorage.getItem('sf_u::'+email+'::outcomes::'+id); }, null);
    if(!raw) return [];
    var arr=safe(function(){ return JSON.parse(raw); }, null);
    if(!Array.isArray(arr)) return [];
    return arr.map(function(o){
      var odi=(o.odi!=null?('ODI '+o.odi):''); var sat=(o.satisfaction!=null?('Satisfaction '+o.satisfaction):'');
      return { date:parseTime(o.date||o.created||o.when||o.ts), type:'outcome', icon:'📈',
        title:'Outcome recorded', sub:[odi,sat].filter(Boolean).join(' · ')||(o.label||''),
        onClick:function(){ safe(function(){ if(window.showView) window.showView('analysis'); }); } };
    });
  }
  var providers=[visitProvider, apptProvider, outcomeProvider];
  function addProvider(fn){ if(typeof fn==='function' && providers.indexOf(fn)<0) providers.push(fn); }

  function gather(id){
    var ev=[];
    providers.forEach(function(p){ var r=safe(function(){ return p(id)||[]; }, []); if(Array.isArray(r)) ev=ev.concat(r); });
    ev=ev.filter(function(e){ return e && e.title; });
    ev.sort(function(a,b){ return (b.date||0)-(a.date||0); });
    return ev;
  }

  /* ---------- UI ---------- */
  var curEvents=[], curFilter='all';
  function typeMeta(t){ return ({visit:'Visit',appointment:'Appointment',outcome:'Outcome',legal:'Legal',sync:'Athena',rec:'Recommendation'})[t]||t; }
  function render(){
    var body=document.getElementById('mlsTlBody'); if(!body) return;
    var evs=curFilter==='all'?curEvents:curEvents.filter(function(e){return e.type===curFilter;});
    if(!evs.length){ body.innerHTML='<div class="mlstl-empty">No timeline events yet for this patient.</div>'; return; }
    var html='';
    evs.forEach(function(e,i){
      html+='<button type="button" class="mlstl-ev" data-i="'+i+'">'
        +'<span class="mlstl-rail"><span class="mlstl-dot">'+esc(e.icon||'•')+'</span></span>'
        +'<span class="mlstl-main"><span class="mlstl-row1"><span class="mlstl-title">'+esc(e.title)+'</span>'
        +'<span class="mlstl-date">'+esc(fmtDate(e.date))+'</span></span>'
        +(e.sub?'<span class="mlstl-sub">'+esc(e.sub)+'</span>':'')
        +'<span class="mlstl-tag">'+esc(typeMeta(e.type))+'</span></span></button>';
    });
    body.innerHTML=html;
    body.querySelectorAll('.mlstl-ev').forEach(function(el){ el.addEventListener('click', function(){ var e=evs[+el.getAttribute('data-i')]; close(); safe(function(){ e.onClick&&e.onClick(); }); }); });
  }
  function renderChips(){
    var bar=document.getElementById('mlsTlChips'); if(!bar) return;
    var types=['all'].concat(Object.keys(curEvents.reduce(function(a,e){a[e.type]=1;return a;},{})));
    bar.innerHTML=types.map(function(t){ return '<button type="button" class="mlstl-chip'+(t===curFilter?' on':'')+'" data-t="'+esc(t)+'">'+esc(t==='all'?'All':typeMeta(t))+'</button>'; }).join('');
    bar.querySelectorAll('.mlstl-chip').forEach(function(el){ el.addEventListener('click', function(){ curFilter=el.getAttribute('data-t'); renderChips(); render(); }); });
  }
  function open(id){
    id=id||activeId(); if(!id){ safe(function(){ window.showView&&window.showView('patients'); }); return; }
    injectCss(); close();
    var pt=findPt(id); var name=pt?(pt.name||'Patient'):'Patient';
    curEvents=gather(id); curFilter='all';
    var ov=document.createElement('div'); ov.id=OV;
    ov.innerHTML='<div class="mlstl-panel" role="dialog" aria-label="Patient timeline">'
      +'<div class="mlstl-head"><span class="mlstl-h-title">Timeline — '+esc(name)+'</span>'
      +'<button type="button" id="mlsTlClose" class="mlstl-close" aria-label="Close">✕</button></div>'
      +'<div id="mlsTlChips" class="mlstl-chips"></div>'
      +'<div id="mlsTlBody" class="mlstl-body"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    document.getElementById('mlsTlClose').addEventListener('click', close);
    renderChips(); render();
  }
  function close(){ var ov=document.getElementById(OV); if(ov) ov.remove(); }

  function injectCss(){
    if(document.getElementById(CSS)) return;
    var s=document.createElement('style'); s.id=CSS;
    s.textContent=
      '#'+OV+'{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.4);display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px 16px;backdrop-filter:blur(2px);}'
      +'#'+OV+' .mlstl-panel{width:100%;max-width:580px;max-height:80vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mlstl-head{display:flex;align-items:center;justify-content:space-between;padding:15px 18px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlstl-h-title{font-weight:700;font-size:15px;color:var(--ink,#15293f);}'
      +'.mlstl-close{border:0;background:transparent;font-size:16px;cursor:pointer;color:var(--muted,#7c8aa0);line-height:1;padding:4px 6px;border-radius:8px;}'
      +'.mlstl-close:hover{background:var(--surface,#f1f4f9);color:var(--ink,#15293f);}'
      +'.mlstl-chips{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlstl-chip{font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--muted,#5b6b7c);border-radius:20px;padding:4px 12px;}'
      +'.mlstl-chip.on{background:var(--brand,#2563c9);border-color:var(--brand,#2563c9);color:#fff;}'
      +'.mlstl-body{overflow:auto;padding:6px 10px 12px;}'
      +'.mlstl-ev{display:flex;gap:0;width:100%;text-align:left;background:transparent;border:0;cursor:pointer;padding:0;font:inherit;}'
      +'.mlstl-rail{position:relative;flex:0 0 38px;display:flex;justify-content:center;}'
      +'.mlstl-rail:before{content:"";position:absolute;top:0;bottom:0;width:2px;background:var(--line,#e6e9ef);}'
      +'.mlstl-dot{position:relative;z-index:1;width:26px;height:26px;border-radius:50%;background:var(--surface,#f1f4f9);border:1px solid var(--line,#e6e9ef);display:flex;align-items:center;justify-content:center;font-size:13px;margin-top:12px;}'
      +'.mlstl-main{flex:1 1 auto;min-width:0;padding:12px 8px 12px 10px;border-radius:10px;}'
      +'.mlstl-ev:hover .mlstl-main{background:var(--surface,#f5f8fc);}'
      +'.mlstl-row1{display:flex;align-items:baseline;justify-content:space-between;gap:10px;}'
      +'.mlstl-title{font-size:14px;font-weight:600;color:var(--ink,#15293f);}'
      +'.mlstl-date{flex:0 0 auto;font-size:12px;color:var(--muted,#7c8aa0);}'
      +'.mlstl-sub{display:block;font-size:12.5px;color:var(--muted,#5b6b7c);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlstl-tag{display:inline-block;margin-top:6px;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:var(--muted,#8b97a8);border:1px solid var(--line,#e6e9ef);border-radius:6px;padding:1px 6px;}'
      +'.mlstl-empty{padding:34px 16px;text-align:center;color:var(--muted,#7c8aa0);font-size:14px;}'
      +'@media (max-width:620px){#'+OV+'{padding:4vh 8px 8px;}#'+OV+' .mlstl-panel{max-height:90vh;}}';
    (document.head||document.documentElement).appendChild(s);
  }

  /* ---------- entry points: Cmd-K action + calendar appointment peek (NOT the unified card,
     which is kept to exactly Chart/Visit/History/Schedule/Switch patient per design) ---------- */
  window.__mlsTimeline={ open:open, close:close, addProvider:addProvider, _gather:gather };
})();


/* ---- module: feat_calendar_launchpad.js ---- */

/* ===== MLS Calendar Launchpad — connectedness feature #3 =====
   ADDITIVE ONLY. Does NOT modify any existing calendar function or its click behavior.
   The app already turns an appointment into a visit via the peek popup's "Start visit"
   (calStartVisit, which resolves patient_external_id -> selectPatient + goNewVisitForPatient,
   or a prefilled unassigned visit). This feature augments the appointment peek popup with two
   extra launch actions — "Open chart" and "Timeline" — so an appointment becomes a launchpad
   into the patient's chart / visit / timeline. It reads the appointment id from the existing
   Start-visit handler in the popup (read-only parse; no wrapping/patching), looks the patient up,
   and appends buttons. If anything is missing it silently does nothing. Calendar untouched. */
(function(){
  'use strict';
  if (window.__mlsCalLaunch) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function apptById(id){ return safe(function(){ var arr=Array.isArray(window._calAppts)?window._calAppts:[]; return arr.filter(function(a){return String(a.id)===String(id);})[0]||null; }, null); }
  function findPt(extId){ if(extId==null) return null; return safe(function(){ if(window.findPatient){ var p=window.findPatient(extId); if(p) return p; } var ps=(window.getPatients&&window.getPatients())||[]; return ps.filter(function(p){return String(p.id)===String(extId);})[0]||null; }, null); }
  function mkBtn(t){ var b=document.createElement('button'); b.type='button'; b.textContent=t; b.setAttribute('data-mls-launch','1');
    b.style.cssText='background:#eef3fb;color:#1456a8;border:1px solid #cfe0f5;border-radius:8px;padding:7px 12px;font-size:12.5px;font-weight:700;cursor:pointer;'; return b; }
  function enhancePeek(peek){
    if(!peek || peek.__mlsEnhanced) return;
    // derive appt id from the existing "Start visit" handler (calStartVisit(<id>)) — read only
    var apptId=null;
    peek.querySelectorAll('[onclick]').forEach(function(el){ var m=(el.getAttribute('onclick')||'').match(/calStartVisit\((\d+)\)/); if(m) apptId=m[1]; });
    if(apptId==null) return;           // not an appointment peek we recognise — leave untouched
    peek.__mlsEnhanced=true;
    var appt=apptById(apptId); if(!appt) return;
    var pt=findPt(appt.patient_external_id);
    if(!pt) return;                    // unlinked appt: existing "Start visit" already prefills; nothing to add
    var startBtn=[].slice.call(peek.querySelectorAll('button')).filter(function(b){return /Start visit/i.test(b.textContent||'');})[0];
    var row=startBtn?startBtn.parentElement:peek;
    if(row.querySelector('[data-mls-launch]')) return;
    var bChart=mkBtn('📋 Open chart');
    bChart.onclick=function(){ safe(function(){ if(window.setActivePtId) window.setActivePtId(pt.id); if(window.openPatient) window.openPatient(pt.id); else if(window.showView) window.showView('patients'); peek.remove(); }); };
    var bTl=mkBtn('🕒 Timeline');
    bTl.onclick=function(){ safe(function(){ if(window.__mlsTimeline) window.__mlsTimeline.open(pt.id); peek.remove(); }); };
    row.appendChild(bChart); row.appendChild(bTl);
  }
  function startObserver(){
    safe(function(){
      var mo=new MutationObserver(function(){ var p=document.getElementById('calApptPeek'); if(p) enhancePeek(p); });
      mo.observe(document.body, {childList:true, subtree:true});
      var p=document.getElementById('calApptPeek'); if(p) enhancePeek(p);
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', startObserver); else startObserver();
  window.__mlsCalLaunch={ enhancePeek:enhancePeek, _findPt:findPt };
})();


/* ---- module: feat_athena_sync.js ---- */

/* ===== MLS Global Athena Sync Indicator — connectedness feature #4 =====
   Adds a compact Athena sync status chip into the unified card's existing sync slot
   (window.__mlsCard.setSyncSlot): last synced / pending / errors, with a details popover.
   HONEST + ADDITIVE: it OBSERVES the app's own Athena actions (push visit / superbill /
   history note / copy-for-EMR / pull chart) via a passive capture-phase click listener — it
   never wraps or alters those handlers — and records a per-user sync log in localStorage.
   It reflects app-initiated sends via the DOM/Assist path (Path A); it does NOT claim
   server-confirmed FHIR write-back (Path B), which is gated until athenahealth API access is
   live. Degrades to a silent no-op if the card or globals are missing. Exposes window.__mlsSync
   and registers a timeline provider so sync events also appear in the patient timeline. */
(function(){
  'use strict';
  if (window.__mlsSync) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function email(){ return safe(function(){ return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]; }, null); }
  function key(){ var e=email(); return e?('sf_u::'+e+'::mlsSyncLog'):null; }
  function getLog(){ var k=key(); if(!k) return []; return safe(function(){ var v=JSON.parse(localStorage.getItem(k)||'[]'); return Array.isArray(v)?v:[]; }, []); }
  function setLog(l){ var k=key(); if(!k) return; safe(function(){ localStorage.setItem(k, JSON.stringify(l.slice(-50))); }); }
  function activeName(){ return safe(function(){ var id=window.getActivePtId&&window.getActivePtId(); var p=id&&window.findPatient&&window.findPatient(id); return p?(p.name||''):''; }, ''); }
  function activeId(){ return safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null); }
  function mark(ev){ ev=ev||{}; ev.ts=ev.ts||Date.now(); if(!ev.patient) ev.patient=activeName(); if(ev.patientId==null) ev.patientId=activeId(); var l=getLog(); l.push(ev); setLog(l); render(); }
  function connMode(){
    return safe(function(){
      var assist = typeof window.sendToEMRviaAssist==='function' || typeof window._assistReadAthenaTab==='function';
      var be = (typeof window.backendMode==='function' && window.backendMode());
      if (assist) return 'Assist (browser)';
      if (be) return 'MLS server';
      return 'not connected';
    }, 'unknown');
  }
  function timeAgo(ts){ var s=Math.floor((Date.now()-ts)/1000); if(s<60) return 'just now'; var m=Math.floor(s/60); if(m<60) return m+'m ago'; var h=Math.floor(m/60); if(h<24) return h+'h ago'; var d=Math.floor(h/24); return d+'d ago'; }
  function fmtTime(ts){ return safe(function(){ return new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}); }, ''); }

  function state(){
    var log=getLog();
    var errors=log.filter(function(e){return e.status==='error';}).length;
    var sends=log.filter(function(e){return e.dir!=='pull';});
    var last=log.length?log[log.length-1]:null;
    return { errors:errors, count:sends.length, last:last, total:log.length };
  }
  function chipHtml(){
    var st=state();
    var cls='ok', txt;
    if(st.errors>0){ cls='err'; txt='Athena · '+st.errors+' error'+(st.errors>1?'s':''); }
    else if(st.last){ cls='ok'; txt='Athena · '+(st.last.dir==='pull'?'pulled ':'synced ')+timeAgo(st.last.ts); }
    else { cls='idle'; txt='Athena · idle'; }
    return '<span class="mls-sync mls-sync-'+cls+'" title="Athena sync status — click for details">'
      +'<span class="mls-sync-dot"></span>'+esc(txt)+'</span>';
  }
  function render(){
    if(!window.__mlsCard || typeof window.__mlsCard.setSyncSlot!=='function') return;
    safe(function(){ window.__mlsCard.setSyncSlot(chipHtml()); bindChip(); });
  }
  function bindChip(){
    var chip=document.querySelector('#mlsCardSlot .mls-sync'); if(!chip||chip.__b) return; chip.__b=1;
    chip.style.cursor='pointer';
    chip.addEventListener('click', function(e){ e.stopPropagation(); togglePop(chip); });
  }
  function togglePop(anchor){
    var ex=document.getElementById('mlsSyncPop'); if(ex){ ex.remove(); return; }
    var log=getLog().slice().reverse().slice(0,6);
    var st=state();
    var rows=log.length? log.map(function(e){
        return '<div class="mls-sp-row"><span class="mls-sp-ic">'+(e.status==='error'?'⚠':(e.dir==='pull'?'📥':'🚀'))+'</span>'
          +'<span class="mls-sp-main"><b>'+esc(e.label||e.target||'sync')+'</b>'+(e.patient?(' · '+esc(e.patient)):'')
          +'<span class="mls-sp-t">'+esc(fmtTime(e.ts))+'</span></span></div>';
      }).join('') : '<div class="mls-sp-empty">No Athena sync activity yet.</div>';
    var pop=document.createElement('div'); pop.id='mlsSyncPop';
    pop.innerHTML='<div class="mls-sp-head"><b>Athena sync</b><span class="mls-sp-mode">'+esc(connMode())+'</span></div>'
      +'<div class="mls-sp-stat"><span>'+st.count+' sent</span><span>'+(st.errors)+' error'+(st.errors===1?'':'s')+'</span>'
      +'<span>'+(st.last?('last '+timeAgo(st.last.ts)):'—')+'</span></div>'
      +'<div class="mls-sp-list">'+rows+'</div>'
      +'<div class="mls-sp-note">Reflects sends initiated in the app (DOM / MLS Assist path). Server-confirmed FHIR write-back activates once athenahealth API access is live.</div>';
    document.body.appendChild(pop);
    var r=anchor.getBoundingClientRect();
    pop.style.top=(r.bottom+6+window.scrollY)+'px';
    pop.style.left=Math.max(8,Math.min(r.left+window.scrollX, window.innerWidth-330))+'px';
    setTimeout(function(){ document.addEventListener('mousedown', function h(ev){ if(!pop.contains(ev.target)){ pop.remove(); document.removeEventListener('mousedown',h); } }); },0);
  }

  /* observe app Athena actions (passive — does not alter handlers) */
  var ACTIONS=[
    {re:/pushEntireVisitToAthena/, label:'Visit → Athena', target:'visit', dir:'push'},
    {re:/pushSuperbillToAthena/, label:'Superbill → Athena', target:'superbill', dir:'push'},
    {re:/pushHistoryNoteToAthena/, label:'Note → Athena', target:'note', dir:'push'},
    {re:/copyForEMR/, label:'Copied for EMR/Athena', target:'copy', dir:'push'},
    {re:/pushToAthena|pushSuperbill/, label:'Push → Athena', target:'push', dir:'push'},
    {re:/pullPatientChartViaAssist|pullPatientFromAthena/, label:'Pulled chart', target:'chart', dir:'pull'}
  ];
  function onClickCapture(e){
    safe(function(){
      var el=e.target; var hops=0;
      while(el && hops<5){
        var oc=el.getAttribute&&el.getAttribute('onclick');
        if(oc){ for(var i=0;i<ACTIONS.length;i++){ if(ACTIONS[i].re.test(oc)){ mark({label:ACTIONS[i].label, target:ACTIONS[i].target, dir:ACTIONS[i].dir, status:'sent'}); return; } } }
        el=el.parentElement; hops++;
      }
    });
  }
  function syncProvider(id){
    return getLog().filter(function(e){ return e.patientId!=null && String(e.patientId)===String(id); }).map(function(e){
      return { date:e.ts, type:'sync', icon:(e.status==='error'?'⚠':(e.dir==='pull'?'📥':'🚀')), title:e.label||'Athena sync', sub:connMode(), onClick:function(){} };
    });
  }
  function init(){
    document.addEventListener('click', onClickCapture, true);
    render();
    setInterval(render, 4000);
    safe(function(){ if(window.__mlsTimeline && window.__mlsTimeline.addProvider) window.__mlsTimeline.addProvider(syncProvider); });
    injectCss();
  }
  function injectCss(){
    if(document.getElementById('mlsSyncCss')) return;
    var s=document.createElement('style'); s.id='mlsSyncCss';
    s.textContent=
      '.mls-sync{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 9px;border-radius:20px;border:1px solid var(--line,#e6e9ef);background:var(--surface,#f6f8fb);color:var(--muted,#5b6b7c);white-space:nowrap;}'
      +'.mls-sync-dot{width:7px;height:7px;border-radius:50%;background:#9aa7b4;flex:0 0 auto;}'
      +'.mls-sync-ok .mls-sync-dot{background:#16a34a;} .mls-sync-ok{color:#127a55;border-color:#bfe6cf;background:#f0fbf4;}'
      +'.mls-sync-err .mls-sync-dot{background:#dc2626;} .mls-sync-err{color:#b91c1c;border-color:#f3c9c9;background:#fdf2f2;}'
      +'#mlsSyncPop{position:absolute;z-index:100000;width:320px;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:12px;box-shadow:0 16px 40px rgba(15,28,46,.22);font-size:13px;overflow:hidden;}'
      +'#mlsSyncPop .mls-sp-head{display:flex;justify-content:space-between;align-items:center;padding:11px 13px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'#mlsSyncPop .mls-sp-mode{font-size:11px;color:var(--muted,#7c8aa0);border:1px solid var(--line,#e6e9ef);border-radius:6px;padding:1px 7px;}'
      +'#mlsSyncPop .mls-sp-stat{display:flex;gap:14px;padding:8px 13px;color:var(--muted,#5b6b7c);font-size:12px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'#mlsSyncPop .mls-sp-list{max-height:200px;overflow:auto;padding:4px 0;}'
      +'#mlsSyncPop .mls-sp-row{display:flex;gap:9px;padding:7px 13px;align-items:flex-start;}'
      +'#mlsSyncPop .mls-sp-main{display:flex;flex-direction:column;min-width:0;}'
      +'#mlsSyncPop .mls-sp-t{font-size:11px;color:var(--muted,#9aa7b4);}'
      +'#mlsSyncPop .mls-sp-empty{padding:18px 13px;text-align:center;color:var(--muted,#7c8aa0);}'
      +'#mlsSyncPop .mls-sp-note{padding:9px 13px;font-size:10.5px;color:var(--muted,#8b97a8);border-top:1px solid var(--line,#e6e9ef);background:var(--surface,#f8fafc);}';
    (document.head||document.documentElement).appendChild(s);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__mlsSync={ mark:mark, getLog:getLog, state:state, render:render };
})();


/* ---- module: feat_activity_feed.js ---- */

/* ===== MLS Unified Activity Feed — connectedness feature #5 =====
   A practice-wide chronological feed of meaningful events: note signed, sent to Athena,
   follow-up / upcoming appointment, payment received, BAA awaiting signature.
   Additive overlay (opened via Cmd-K "Activity feed" or window.__mlsActivity.open()). Reads via
   public globals (getNotes, _calAppts) and window.__mlsSync; each item is click-to-jump. Sources
   with no accessible data yet (payments require Stripe Connect go-live; BAA-awaiting-signature
   requires the legal/BAA list) are shown as gated, clearly-labeled placeholders rather than fake
   data, and light up automatically once those systems expose data via registerable providers
   (window.__mlsActivity.addProvider(fn) -> [{date,type,icon,title,sub,onClick}]). */
(function(){
  'use strict';
  if (window.__mlsActivity) return;
  var OV='mlsActOverlay', CSS='mlsActCss';
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function parseTime(v){ if(v==null) return 0; if(typeof v==='number') return v>1e12?v:v*1000; var d=new Date(v); return isNaN(d)?0:d.getTime(); }
  function fmtDate(t){ if(!t) return ''; return new Date(t).toLocaleDateString([], {month:'short',day:'numeric',year:'numeric'}); }
  function ptName(id){ return safe(function(){ var p=window.findPatient&&window.findPatient(id); return p?(p.name||''):''; }, ''); }
  function jumpPatient(id, view){ safe(function(){ if(id&&window.setActivePtId) window.setActivePtId(id); if(window.showView) window.showView(view||'history'); }); }

  function signedNotesProvider(){
    var notes=safe(function(){ return window.getNotes&&window.getNotes(); }, []);
    if(!Array.isArray(notes)) return [];
    return notes.filter(function(n){ return n.signed; }).map(function(n){
      return { date:parseTime(n.updated||n.created), type:'signed', icon:'✅',
        title:'Note signed', sub:(n.patient||ptName(n.patientId)||'')+(n.cc?(' · '+n.cc):''),
        onClick:function(){ jumpPatient(n.patientId,'history'); } };
    });
  }
  function athenaProvider(){
    var log=safe(function(){ return window.__mlsSync&&window.__mlsSync.getLog(); }, []);
    if(!Array.isArray(log)) return [];
    return log.map(function(e){
      return { date:e.ts, type:'athena', icon:(e.status==='error'?'⚠':'🚀'),
        title:e.label||'Athena sync', sub:e.patient||'', onClick:function(){ jumpPatient(e.patientId,'history'); } };
    });
  }
  function followupProvider(){
    var ap=safe(function(){ return Array.isArray(window._calAppts)?window._calAppts:[]; }, []);
    var now=Date.now();
    return ap.filter(function(a){ var t=parseTime(a.start_at||a.appt_date); return t>now; })
             .map(function(a){
       var pid=a.patient_external_id;
       return { date:parseTime(a.start_at||a.appt_date), type:'followup', icon:'📅',
         title:'Upcoming appointment'+(a.reason?(' · '+String(a.reason).slice(0,40)):''),
         sub:(a.name||ptName(pid)||''), future:true,
         onClick:function(){ safe(function(){ if(window.calOpenDay&&a.appt_date) window.calOpenDay(a.appt_date); else if(window.showView) window.showView('calendar'); }); } };
     });
  }
  // gated providers: no fabricated data; show a single informational placeholder each
  function paymentProvider(){ return [{ date:0, type:'payment', icon:'💳', gated:true,
      title:'Payments — awaiting Stripe Connect go-live', sub:'Payment-received events appear here once Connect is live', onClick:function(){} }]; }
  function baaProvider(){ return [{ date:0, type:'baa', icon:'📝', gated:true,
      title:'BAA awaiting signature — connects to legal/BAA list', sub:'Lights up when a BAA-awaiting list is available', onClick:function(){ safe(function(){ window.showView&&window.showView('legalreq'); }); } }]; }

  var providers=[signedNotesProvider, athenaProvider, followupProvider, paymentProvider, baaProvider];
  function addProvider(fn){ if(typeof fn==='function' && providers.indexOf(fn)<0) providers.push(fn); }
  function gather(){
    var ev=[];
    providers.forEach(function(p){ var r=safe(function(){return p()||[];},[]); if(Array.isArray(r)) ev=ev.concat(r); });
    ev=ev.filter(function(e){ return e&&e.title; });
    // real (dated) events newest-first; gated placeholders sink to bottom
    ev.sort(function(a,b){ if((a.gated?1:0)!==(b.gated?1:0)) return (a.gated?1:0)-(b.gated?1:0); return (b.date||0)-(a.date||0); });
    return ev;
  }
  var curFilter='all';
  function typeMeta(t){ return ({signed:'Note signed',athena:'Athena',followup:'Follow-up',payment:'Payment',baa:'BAA'})[t]||t; }
  function render(){
    var body=document.getElementById('mlsActBody'); if(!body) return;
    var all=gather();
    var evs=curFilter==='all'?all:all.filter(function(e){return e.type===curFilter;});
    if(!evs.length){ body.innerHTML='<div class="mlsact-empty">No activity yet.</div>'; return; }
    body.innerHTML=evs.map(function(e,i){
      return '<button type="button" class="mlsact-row'+(e.gated?' gated':'')+'" data-i="'+i+'">'
        +'<span class="mlsact-ic">'+esc(e.icon||'•')+'</span>'
        +'<span class="mlsact-main"><span class="mlsact-r1"><span class="mlsact-t">'+esc(e.title)+'</span>'
        +'<span class="mlsact-d">'+esc(e.gated?'soon':fmtDate(e.date))+'</span></span>'
        +(e.sub?'<span class="mlsact-s">'+esc(e.sub)+'</span>':'')+'</span></button>';
    }).join('');
    body.querySelectorAll('.mlsact-row').forEach(function(el){ el.addEventListener('click', function(){ var e=evs[+el.getAttribute('data-i')]; if(e.gated){return;} close(); safe(function(){ e.onClick&&e.onClick(); }); }); });
  }
  function renderChips(){
    var bar=document.getElementById('mlsActChips'); if(!bar) return;
    var types=['all','signed','athena','followup','payment','baa'];
    bar.innerHTML=types.map(function(t){ return '<button type="button" class="mlsact-chip'+(t===curFilter?' on':'')+'" data-t="'+t+'">'+esc(t==='all'?'All':typeMeta(t))+'</button>'; }).join('');
    bar.querySelectorAll('.mlsact-chip').forEach(function(el){ el.addEventListener('click', function(){ curFilter=el.getAttribute('data-t'); renderChips(); render(); }); });
  }
  function open(){
    injectCss(); close(); curFilter='all';
    var ov=document.createElement('div'); ov.id=OV;
    ov.innerHTML='<div class="mlsact-panel" role="dialog" aria-label="Activity feed">'
      +'<div class="mlsact-head"><span class="mlsact-h">Activity feed</span><button type="button" id="mlsActClose" class="mlsact-x" aria-label="Close">✕</button></div>'
      +'<div id="mlsActChips" class="mlsact-chips"></div>'
      +'<div id="mlsActBody" class="mlsact-body"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    document.getElementById('mlsActClose').addEventListener('click', close);
    renderChips(); render();
  }
  function close(){ var ov=document.getElementById(OV); if(ov) ov.remove(); }
  function injectCss(){
    if(document.getElementById(CSS)) return;
    var s=document.createElement('style'); s.id=CSS;
    s.textContent=
      '#'+OV+'{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.4);display:flex;align-items:flex-start;justify-content:center;padding:8vh 16px 16px;backdrop-filter:blur(2px);}'
      +'#'+OV+' .mlsact-panel{width:100%;max-width:560px;max-height:80vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mlsact-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlsact-h{font-weight:700;font-size:15px;color:var(--ink,#15293f);}'
      +'.mlsact-x{border:0;background:transparent;font-size:16px;cursor:pointer;color:var(--muted,#7c8aa0);padding:4px 6px;border-radius:8px;}'
      +'.mlsact-x:hover{background:var(--surface,#f1f4f9);}'
      +'.mlsact-chips{display:flex;gap:6px;flex-wrap:wrap;padding:10px 14px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlsact-chip{font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--muted,#5b6b7c);border-radius:20px;padding:4px 11px;}'
      +'.mlsact-chip.on{background:var(--brand,#2563c9);border-color:var(--brand,#2563c9);color:#fff;}'
      +'.mlsact-body{overflow:auto;padding:6px 8px 12px;}'
      +'.mlsact-row{display:flex;gap:11px;width:100%;text-align:left;background:transparent;border:0;cursor:pointer;padding:10px 10px;border-radius:10px;font:inherit;align-items:flex-start;}'
      +'.mlsact-row:hover{background:var(--surface,#f5f8fc);}'
      +'.mlsact-row.gated{cursor:default;opacity:.72;}'
      +'.mlsact-row.gated:hover{background:transparent;}'
      +'.mlsact-ic{flex:0 0 auto;width:24px;text-align:center;font-size:15px;margin-top:1px;}'
      +'.mlsact-main{flex:1 1 auto;min-width:0;}'
      +'.mlsact-r1{display:flex;justify-content:space-between;gap:10px;align-items:baseline;}'
      +'.mlsact-t{font-size:14px;font-weight:600;color:var(--ink,#15293f);}'
      +'.mlsact-d{flex:0 0 auto;font-size:12px;color:var(--muted,#9aa7b4);}'
      +'.mlsact-s{display:block;font-size:12.5px;color:var(--muted,#5b6b7c);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlsact-empty{padding:30px;text-align:center;color:var(--muted,#7c8aa0);}'
      +'@media (max-width:620px){#'+OV+'{padding:4vh 8px 8px;}#'+OV+' .mlsact-panel{max-height:90vh;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  window.__mlsActivity={ open:open, close:close, addProvider:addProvider, _gather:gather };
})();


/* ---- module: feat_note_recs.js ---- */

/* ===== MLS Recommendations from Note — connectedness feature #6 =====
   Reads the active patient's most recent note and auto-extracts actionable recommendations —
   imaging, referrals, follow-up interval, and coding (ICD-10 / CPT / E&M) — each as a one-click
   chip. Additive overlay (Cmd-K "Recommendations from note" or window.__mlsRecs.open()). Actions
   use existing app primitives: "Schedule follow-up" -> calScheduleForPatient; codes/orders ->
   one-click Copy (the app has no add-to-orders API, so order/referral chips copy the text and can
   open the Recommendations generator). Pure parse + read; never alters app functions. */
(function(){
  'use strict';
  if (window.__mlsRecs) return;
  var OV='mlsRecOverlay', CSS='mlsRecCss';
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function activeId(){ return safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null); }
  function activeName(){ return safe(function(){ var p=window.findPatient&&window.findPatient(activeId()); return p?(p.name||''):''; }, ''); }
  function latestNoteText(id){
    return safe(function(){
      // prefer a live visit editor if it has content
      var live=document.getElementById('noteText')||document.getElementById('clinicalNote')||document.querySelector('[data-note-body]');
      if(live && (live.value||live.textContent||'').trim().length>120) return (live.value||live.textContent);
      var notes=(window.patientNotes&&window.patientNotes(id))||[];
      notes=Array.isArray(notes)?notes.slice():[];
      notes.sort(function(a,b){ return (new Date(b.updated||b.created||0))-(new Date(a.updated||a.created||0)); });
      return notes.length?(notes[0].text||''):'';
    }, '');
  }
  function uniq(a){ var s={},o=[]; a.forEach(function(x){ var k=x.toLowerCase(); if(!s[k]){s[k]=1;o.push(x);} }); return o; }

  function extract(text){
    text=String(text||''); var recs=[];
    function add(type,label,value){ recs.push({type:type,label:label,value:value}); }
    // ---- imaging ----
    var imaging=[];
    var imgRe=/\b(MRI|CT scan|CT|X-?ray|radiograph[s]?|ultrasound|EMG\/NCS|EMG|nerve conduction|bone scan|DEXA|myelogram|fluoroscop\w*)\b[^.;\n]{0,60}/gi, m;
    while((m=imgRe.exec(text))){ imaging.push(m[0].trim().replace(/\s+/g,' ')); }
    uniq(imaging).slice(0,6).forEach(function(s){ add('imaging','Imaging', s); });
    // ---- referrals ----
    var refs=[]; var refRe=/\b(refer(?:ral)?\s+to|consult(?:ation)?\s+(?:with|to)|refer to)\b[^.;\n]{0,60}/gi;
    while((m=refRe.exec(text))){ refs.push(m[0].trim().replace(/\s+/g,' ')); }
    uniq(refs).slice(0,5).forEach(function(s){ add('referral','Referral', s); });
    // ---- follow-up interval ----
    var fu=[]; var fuRe=/\b(?:follow[\s-]?up|f\/u|return to clinic|RTC|return)\b[^.;\n]{0,8}?(?:in|after)?\s*(\d{1,2})\s*(day|days|week|weeks|wk|wks|month|months|mo)\b/gi;
    while((m=fuRe.exec(text))){ fu.push({num:+m[1], unit:m[2], raw:m[0].trim().replace(/\s+/g,' ')}); }
    if(fu.length){ add('followup','Follow-up', fu[0].raw); recs[recs.length-1].fu=fu[0]; }
    // ---- ICD-10 ----
    var icd=(text.match(/\b[A-TV-Z]\d\d(?:\.\d{1,4})?\b/g)||[]).filter(function(c){ return /\.\d/.test(c) || /^[A-TV-Z]\d\d$/.test(c); });
    uniq(icd).slice(0,8).forEach(function(c){ add('icd','ICD-10', c); });
    // ---- CPT / E&M (5-digit) ----
    var cpt=uniq((text.match(/\b\d{5}\b/g)||[]).filter(function(c){ var n=+c; return (n>=10000&&n<=99499)||(n>=99201&&n<=99499); }));
    cpt.slice(0,8).forEach(function(c){ var em=/^992\d\d$/.test(c); add(em?'em':'cpt', em?'E&M':'CPT', c); });
    return recs;
  }

  function copy(txt){ safe(function(){ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt); } else { var t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } toastMini('Copied'); }); }
  function toastMini(msg){ safe(function(){ if(window.toast){ window.toast(msg,'ok'); return; } var d=document.createElement('div'); d.textContent=msg; d.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#15293f;color:#fff;padding:8px 14px;border-radius:10px;z-index:100001;font-size:13px'; document.body.appendChild(d); setTimeout(function(){d.remove();},1400); }); }
  function scheduleFollowup(){ safe(function(){ var id=activeId(); close(); if(window.calScheduleForPatient&&id){ window.calScheduleForPatient(id); } else if(window.showView){ window.showView('calendar'); } }); }

  var SECTIONS=[
    {type:'followup', title:'Follow-up interval', act:'schedule'},
    {type:'imaging', title:'Imaging', act:'copy'},
    {type:'referral', title:'Referrals', act:'copy'},
    {type:'icd', title:'Diagnosis codes (ICD-10)', act:'copy'},
    {type:'cpt', title:'Procedure codes (CPT)', act:'copy'},
    {type:'em', title:'E&M level', act:'copy'}
  ];
  function render(recs){
    var body=document.getElementById('mlsRecBody'); if(!body) return;
    if(!recs.length){ body.innerHTML='<div class="mlsrec-empty">No structured recommendations found in the latest note.<br><button type="button" id="mlsRecGen" class="mlsrec-gen">Generate recommendations →</button></div>';
      var g=document.getElementById('mlsRecGen'); if(g) g.addEventListener('click', function(){ close(); safe(function(){ if(window.generateRecommendations) window.generateRecommendations(); else if(window.showView) window.showView('recs'); }); }); return; }
    var html='';
    SECTIONS.forEach(function(sec){
      var items=recs.filter(function(r){return r.type===sec.type;});
      if(!items.length) return;
      html+='<div class="mlsrec-sec"><div class="mlsrec-sectitle">'+esc(sec.title)+'</div><div class="mlsrec-chips">';
      items.forEach(function(it,i){
        html+='<span class="mlsrec-chip" data-type="'+esc(sec.type)+'" data-i="'+i+'"><span class="mlsrec-val">'+esc(it.value)+'</span>'
          +'<button type="button" class="mlsrec-act" data-act="'+esc(sec.act)+'">'+(sec.act==='schedule'?'Schedule':'Copy')+'</button></span>';
      });
      html+='</div></div>';
    });
    html+='<div class="mlsrec-foot"><button type="button" id="mlsRecGen2" class="mlsrec-gen">Open full Recommendations →</button></div>';
    body.innerHTML=html;
    body.querySelectorAll('.mlsrec-chip').forEach(function(chip){
      var type=chip.getAttribute('data-type'), i=+chip.getAttribute('data-i');
      var it=recs.filter(function(r){return r.type===type;})[i];
      var btn=chip.querySelector('.mlsrec-act');
      btn.addEventListener('click', function(){ if(btn.getAttribute('data-act')==='schedule') scheduleFollowup(); else copy(it.value); });
    });
    var g2=document.getElementById('mlsRecGen2'); if(g2) g2.addEventListener('click', function(){ close(); safe(function(){ if(window.generateRecommendations) window.generateRecommendations(); else if(window.showView) window.showView('recs'); }); });
  }
  function open(){
    var id=activeId(); if(!id){ safe(function(){ window.showView&&window.showView('patients'); }); return; }
    injectCss(); close();
    var recs=extract(latestNoteText(id));
    var ov=document.createElement('div'); ov.id=OV;
    ov.innerHTML='<div class="mlsrec-panel" role="dialog" aria-label="Recommendations from note">'
      +'<div class="mlsrec-head"><span class="mlsrec-h">Recommendations — '+esc(activeName()||'patient')+'</span><button type="button" id="mlsRecClose" class="mlsrec-x">✕</button></div>'
      +'<div class="mlsrec-hint">Auto-drawn from the latest note. One-click to act.</div>'
      +'<div id="mlsRecBody" class="mlsrec-body"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    document.getElementById('mlsRecClose').addEventListener('click', close);
    render(recs);
  }
  function close(){ var ov=document.getElementById(OV); if(ov) ov.remove(); }
  function injectCss(){
    if(document.getElementById(CSS)) return;
    var s=document.createElement('style'); s.id=CSS;
    s.textContent=
      '#'+OV+'{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.4);display:flex;align-items:flex-start;justify-content:center;padding:9vh 16px 16px;backdrop-filter:blur(2px);}'
      +'#'+OV+' .mlsrec-panel{width:100%;max-width:560px;max-height:80vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mlsrec-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px 8px;}'
      +'.mlsrec-h{font-weight:700;font-size:15px;color:var(--ink,#15293f);}'
      +'.mlsrec-x{border:0;background:transparent;font-size:16px;cursor:pointer;color:var(--muted,#7c8aa0);padding:4px 6px;border-radius:8px;}'
      +'.mlsrec-hint{padding:0 18px 12px;color:var(--muted,#7c8aa0);font-size:12.5px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlsrec-body{overflow:auto;padding:12px 16px 16px;}'
      +'.mlsrec-sec{margin-bottom:14px;}'
      +'.mlsrec-sectitle{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:var(--muted,#7c8aa0);margin-bottom:7px;}'
      +'.mlsrec-chips{display:flex;flex-direction:column;gap:7px;}'
      +'.mlsrec-chip{display:flex;align-items:center;justify-content:space-between;gap:10px;border:1px solid var(--line,#e6e9ef);border-radius:10px;padding:8px 8px 8px 12px;background:var(--surface,#fafcff);}'
      +'.mlsrec-val{font-size:13.5px;color:var(--ink,#15293f);min-width:0;overflow:hidden;text-overflow:ellipsis;}'
      +'.mlsrec-act{flex:0 0 auto;font:inherit;font-size:12px;font-weight:700;cursor:pointer;border:1px solid var(--brand,#2563c9);color:#fff;background:var(--brand,#2563c9);border-radius:8px;padding:5px 12px;}'
      +'.mlsrec-act:hover{filter:brightness(1.07);}'
      +'.mlsrec-empty{padding:26px 12px;text-align:center;color:var(--muted,#7c8aa0);font-size:14px;}'
      +'.mlsrec-gen{margin-top:12px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--brand,#2563c9);border-radius:9px;padding:8px 14px;}'
      +'.mlsrec-foot{margin-top:6px;text-align:center;}'
      +'@media (max-width:620px){#'+OV+'{padding:4vh 8px 8px;}#'+OV+' .mlsrec-panel{max-height:90vh;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  window.__mlsRecs={ open:open, close:close, _extract:extract };
})();


/* ---- module: feat_visit_cascade.js ---- */

/* ===== MLS One Visit -> Cascade — connectedness feature #7 =====
   When a note is generated/signed/saved, the app already lands it in History and the unified card
   recomputes last-visit. This feature ADDS the connectedness cascade: a non-intrusive prompt that
   spawns the natural next steps in one click — schedule a Calendar follow-up, open note-derived
   Recommendations, and jump to History — and refreshes the card + Athena sync chip.
   ADDITIVE + passive: observes clicks on the app's own Generate/Review&Sign/Save buttons via a
   capture-phase listener (never wraps them), then shows the cascade for the active patient. */
(function(){
  'use strict';
  if (window.__mlsCascade) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function activeId(){ return safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null); }
  function activeName(){ return safe(function(){ var p=window.findPatient&&window.findPatient(activeId()); return p?(p.name||''):''; }, ''); }
  var TRIGGERS=/review\s*&\s*sign|save to history|generate note|sign\s*&\s*save|^sign$/i;
  var lastShown=0;
  function onClick(e){
    safe(function(){
      var el=e.target, hops=0, btn=null;
      while(el && hops<4){ if(el.tagName==='BUTTON'||el.getAttribute&&el.getAttribute('onclick')){ btn=el; break; } el=el.parentElement; hops++; }
      if(!btn) return;
      var txt=(btn.textContent||'').replace(/\s+/g,' ').trim();
      if(TRIGGERS.test(txt)){
        var now=Date.now(); if(now-lastShown<3000) return; lastShown=now;
        setTimeout(showCascade, 1100);
      }
    });
  }
  function showCascade(){
    var id=activeId(); if(!id) return;
    safe(function(){ if(window.__mlsCard) window.__mlsCard.refresh(); if(window.__mlsSync) window.__mlsSync.render(); });
    var ex=document.getElementById('mlsCascade'); if(ex) ex.remove();
    injectCss();
    var c=document.createElement('div'); c.id='mlsCascade';
    c.innerHTML='<div class="mlsc-top"><span class="mlsc-title">✓ Visit captured — '+esc(activeName()||'patient')+'</span>'
      +'<button type="button" class="mlsc-x" aria-label="Dismiss">✕</button></div>'
      +'<div class="mlsc-sub">Landed in History &amp; last-visit updated. Next steps:</div>'
      +'<div class="mlsc-acts">'
      +'<button type="button" data-a="followup">📅 Schedule follow-up</button>'
      +'<button type="button" data-a="recs">💡 Recommendations</button>'
      +'<button type="button" data-a="history">📚 History</button>'
      +'</div>';
    document.body.appendChild(c);
    c.querySelector('.mlsc-x').addEventListener('click', function(){ c.remove(); });
    c.querySelectorAll('[data-a]').forEach(function(b){
      b.addEventListener('click', function(){
        var a=b.getAttribute('data-a'); c.remove();
        if(a==='followup') safe(function(){ if(window.calScheduleForPatient) window.calScheduleForPatient(id); else if(window.showView) window.showView('calendar'); });
        else if(a==='recs') safe(function(){ if(window.__mlsRecs) window.__mlsRecs.open(); else if(window.showView) window.showView('recs'); });
        else if(a==='history') safe(function(){ if(window.showView) window.showView('history'); });
      });
    });
    setTimeout(function(){ var n=document.getElementById('mlsCascade'); if(n) n.classList.add('fade'); }, 14000);
    setTimeout(function(){ var n=document.getElementById('mlsCascade'); if(n) n.remove(); }, 16000);
  }
  function injectCss(){
    if(document.getElementById('mlsCascadeCss')) return;
    var s=document.createElement('style'); s.id='mlsCascadeCss';
    s.textContent=
      '#mlsCascade{position:fixed;right:18px;bottom:18px;z-index:100000;width:300px;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-left:4px solid var(--brand,#2563c9);border-radius:13px;box-shadow:0 16px 44px rgba(15,28,46,.24);padding:13px 14px;transition:opacity .8s;font-size:13px;}'
      +'#mlsCascade.fade{opacity:0;}'
      +'#mlsCascade .mlsc-top{display:flex;justify-content:space-between;align-items:center;gap:8px;}'
      +'#mlsCascade .mlsc-title{font-weight:700;color:var(--ink,#15293f);font-size:13.5px;}'
      +'#mlsCascade .mlsc-x{border:0;background:transparent;cursor:pointer;color:var(--muted,#9aa7b4);font-size:14px;}'
      +'#mlsCascade .mlsc-sub{color:var(--muted,#5b6b7c);font-size:12px;margin:4px 0 10px;}'
      +'#mlsCascade .mlsc-acts{display:flex;flex-direction:column;gap:6px;}'
      +'#mlsCascade .mlsc-acts button{font:inherit;font-size:12.5px;font-weight:600;text-align:left;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fafcff);color:var(--ink,#15293f);border-radius:9px;padding:8px 11px;}'
      +'#mlsCascade .mlsc-acts button:hover{border-color:var(--brand,#2563c9);color:var(--brand,#2563c9);}'
      +'@media (max-width:620px){#mlsCascade{right:8px;left:8px;width:auto;bottom:8px;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  function init(){ document.addEventListener('click', onClick, true); injectCss(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__mlsCascade={ show:showCascade };
})();


/* ---- module: feat_supervision.js ---- */

/* ===== MLS Supervision Queue — connectedness feature #8 =====
   A review queue: doctor drafts -> submit for review -> Head Dr reviews/cosigns -> (sent to Athena).
   Additive: the app's notes carry signed/isDraft but no supervision state, so this module keeps its
   OWN per-note status store (localStorage), surfaces a queue overlay (Cmd-K "Supervision queue"),
   lets a draft be submitted and (by a reviewer) marked cosigned, and best-effort badges note rows
   in History so status is visible across views. The final "Head Dr cosign -> auto-send to Athena"
   step is GATED on server-side roles + a live Athena path; this module records the cosign and
   exposes the hook (window.__mlsSupervision.onCosign) so it wires up when those are available. */
(function(){
  'use strict';
  if (window.__mlsSupervision) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function email(){ return safe(function(){ return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]; }, null); }
  function skey(){ var e=email(); return e?('sf_u::'+e+'::mlsSupStatus'):null; }
  function getStatus(){ var k=skey(); return k?safe(function(){return JSON.parse(localStorage.getItem(k)||'{}');},{}):{}; }
  function setStatus(o){ var k=skey(); if(k) safe(function(){ localStorage.setItem(k, JSON.stringify(o)); }); }
  function statusOf(id){ return getStatus()[id]||null; }
  function setOf(id,st){ var o=getStatus(); if(st) o[id]=st; else delete o[id]; setStatus(o); }
  function notes(){ return safe(function(){ return window.getNotes&&window.getNotes(); }, []); }
  function fmtDate(v){ if(!v) return ''; var d=new Date(v); return isNaN(d)?'':d.toLocaleDateString([], {month:'short',day:'numeric'}); }

  function queue(){
    var ns=notes(); if(!Array.isArray(ns)) return [];
    var st=getStatus();
    return ns.filter(function(n){ var s=st[n.id]; return (n.isDraft || !n.signed || s==='submitted') && s!=='cosigned'; })
      .map(function(n){ return { id:n.id, patient:n.patient||'', patientId:n.patientId, kind:n.kind||'Note', date:n.created||n.updated, status:st[n.id]||(n.isDraft?'draft':'unsigned') }; })
      .sort(function(a,b){ return new Date(b.date||0)-new Date(a.date||0); });
  }
  function badge(st){ var map={draft:['Draft','#6b7280','#eef0f3'],unsigned:['Unsigned','#b45309','#fef3c7'],submitted:['Awaiting review','#1456a8','#e0edff'],cosigned:['Cosigned','#127a55','#dcfce7']}; var m=map[st]||map.draft; return '<span class="mls-sup-badge" style="color:'+m[1]+';background:'+m[2]+'">'+m[0]+'</span>'; }

  function open(){
    injectCss(); close();
    var q=queue();
    var ov=document.createElement('div'); ov.id='mlsSupOverlay';
    var rows=q.length? q.map(function(it,i){
      var acts='<button type="button" class="mls-sup-act" data-act="open" data-i="'+i+'">Open</button>';
      if(it.status==='draft'||it.status==='unsigned') acts+='<button type="button" class="mls-sup-act primary" data-act="submit" data-i="'+i+'">Submit for review</button>';
      else if(it.status==='submitted') acts+='<button type="button" class="mls-sup-act primary" data-act="cosign" data-i="'+i+'">Mark reviewed</button>';
      return '<div class="mls-sup-row"><div class="mls-sup-main"><div class="mls-sup-t">'+esc(it.patient||'Patient')+' · '+esc(it.kind)+' '+badge(it.status)+'</div>'
        +'<div class="mls-sup-s">'+esc(fmtDate(it.date))+'</div></div><div class="mls-sup-acts">'+acts+'</div></div>';
    }).join('') : '<div class="mls-sup-empty">Nothing awaiting review. 🎉</div>';
    ov.innerHTML='<div class="mls-sup-panel" role="dialog" aria-label="Supervision queue">'
      +'<div class="mls-sup-head"><span class="mls-sup-h">Supervision queue <span class="mls-sup-count">'+q.length+'</span></span><button type="button" id="mlsSupX" class="mls-sup-x">✕</button></div>'
      +'<div class="mls-sup-note">Doctor drafts → submit → Head Dr reviews/cosigns. Cosign auto-send to Athena activates with server roles + live Athena.</div>'
      +'<div class="mls-sup-body">'+rows+'</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    document.getElementById('mlsSupX').addEventListener('click', close);
    ov.querySelectorAll('.mls-sup-act').forEach(function(b){
      b.addEventListener('click', function(){
        var it=q[+b.getAttribute('data-i')]; var a=b.getAttribute('data-act');
        if(a==='open'){ close(); safe(function(){ if(it.patientId&&window.setActivePtId) window.setActivePtId(it.patientId); if(window.showView) window.showView('history'); }); }
        else if(a==='submit'){ setOf(it.id,'submitted'); toast('Submitted for review'); open(); }
        else if(a==='cosign'){ setOf(it.id,'cosigned'); safe(function(){ if(typeof onCosign==='function') onCosign(it); }); toast('Marked reviewed / cosigned'); open(); }
      });
    });
  }
  function close(){ var o=document.getElementById('mlsSupOverlay'); if(o) o.remove(); }
  function toast(m){ safe(function(){ if(window.toast){window.toast(m,'ok');return;} var d=document.createElement('div'); d.textContent=m; d.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#15293f;color:#fff;padding:8px 14px;border-radius:10px;z-index:100001;font-size:13px'; document.body.appendChild(d); setTimeout(function(){d.remove();},1400); }); }
  var onCosign=null;
  function count(){ return queue().length; }
  // best-effort: badge note rows in History (rows have onclick openNoteFromHistory('id'))
  function badgeHistory(){
    safe(function(){
      var st=getStatus();
      document.querySelectorAll('[onclick*="openNoteFromHistory("]').forEach(function(el){
        var m=(el.getAttribute('onclick')||'').match(/openNoteFromHistory\('([^']+)'\)/); if(!m) return;
        var s=st[m[1]]; if(!s) return;
        if(el.querySelector('.mls-sup-badge')) return;
        var b=document.createElement('span'); b.className='mls-sup-badge'; b.innerHTML=badge(s).replace(/^<span[^>]*>|<\/span>$/g,''); 
        var tmp=document.createElement('div'); tmp.innerHTML=badge(s); el.appendChild(tmp.firstChild);
      });
    });
  }
  function injectCss(){
    if(document.getElementById('mlsSupCss')) return;
    var s=document.createElement('style'); s.id='mlsSupCss';
    s.textContent=
      '#mlsSupOverlay{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.4);display:flex;align-items:flex-start;justify-content:center;padding:9vh 16px 16px;backdrop-filter:blur(2px);}'
      +'#mlsSupOverlay .mls-sup-panel{width:100%;max-width:560px;max-height:80vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mls-sup-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;}'
      +'.mls-sup-h{font-weight:700;font-size:15px;color:var(--ink,#15293f);}'
      +'.mls-sup-count{display:inline-block;background:var(--brand,#2563c9);color:#fff;border-radius:20px;font-size:12px;padding:1px 9px;margin-left:6px;}'
      +'.mls-sup-x{border:0;background:transparent;font-size:16px;cursor:pointer;color:var(--muted,#7c8aa0);}'
      +'.mls-sup-note{padding:0 18px 12px;color:var(--muted,#7c8aa0);font-size:12px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mls-sup-body{overflow:auto;padding:6px 12px 14px;}'
      +'.mls-sup-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:11px 8px;border-bottom:1px solid var(--line,#f0f2f6);}'
      +'.mls-sup-t{font-size:13.5px;font-weight:600;color:var(--ink,#15293f);}'
      +'.mls-sup-s{font-size:12px;color:var(--muted,#9aa7b4);margin-top:2px;}'
      +'.mls-sup-acts{display:flex;gap:6px;flex:0 0 auto;}'
      +'.mls-sup-act{font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--ink,#15293f);border-radius:8px;padding:5px 10px;}'
      +'.mls-sup-act.primary{background:var(--brand,#2563c9);color:#fff;border-color:var(--brand,#2563c9);}'
      +'.mls-sup-badge{display:inline-block;font-size:10.5px;font-weight:700;border-radius:6px;padding:1px 7px;margin-left:6px;vertical-align:middle;}'
      +'.mls-sup-empty{padding:30px;text-align:center;color:var(--muted,#7c8aa0);}';
    (document.head||document.documentElement).appendChild(s);
  }
  function init(){ injectCss(); setInterval(badgeHistory, 1600); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__mlsSupervision={ open:open, close:close, count:count, queue:queue, setStatus:setOf, set onCosign(fn){onCosign=fn;}, get onCosign(){return onCosign;} };
})();


/* ---- module: feat_athena_match.js ---- */

/* ===== MLS Active-Patient <-> Athena Chart Match (app side) — connectedness feature #9 =====
   Builds the APP side of "is the chart open in Athena the same patient I have active in MLS?".
   It does NOT touch the extension. It uses the app's existing Assist bridge (window._assistReadChart
   / _assistReadAthenaTab) to request the open Athena chart, then compares name/DOB to the active
   MLS patient and reports: matched / mismatch / Athena-not-detected. Fully gated + safe: with no
   live Athena session or extension, it reports "not detected" and explains, never fabricating a
   match. Exposed via window.__mlsAthenaMatch.check() and a Cmd-K action. Coordinates with (does not
   modify) the extension's DOM chart-read behavior described in the project briefing. */
(function(){
  'use strict';
  if (window.__mlsAthenaMatch) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function activePt(){ return safe(function(){ var id=window.getActivePtId&&window.getActivePtId(); return id&&window.findPatient?window.findPatient(id):null; }, null); }
  function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function bridgeAvailable(){ return safe(function(){ return typeof window._assistReadChart==='function' || typeof window._assistReadAthenaTab==='function' || typeof window.sendToEMRviaAssist==='function'; }, false); }

  function compare(chart, pt){
    if(!chart||!pt) return {state:'unknown'};
    var cn=norm(chart.name||chart.patient||''), pn=norm(pt.name||'');
    var cd=norm(chart.dob||''), pd=norm(pt.dob||'');
    var nameHit = cn && pn && (cn===pn || cn.indexOf(pn)>=0 || pn.indexOf(cn)>=0);
    var dobHit = cd && pd && cd===pd;
    if(nameHit && (dobHit||!cd)) return {state:'match', detail:(chart.name||chart.patient||'')};
    if(nameHit || dobHit) return {state:'partial', detail:(chart.name||chart.patient||'')};
    return {state:'mismatch', detail:(chart.name||chart.patient||'')};
  }
  function readOpenChart(cb){
    // Best-effort, honest: attempt to read the open Athena chart via the app's Assist bridge.
    if(!bridgeAvailable()){ cb(null,'no-bridge'); return; }
    safe(function(){
      var ret = window._assistReadChart ? window._assistReadChart() : (window._assistReadAthenaTab?window._assistReadAthenaTab():null);
      if(ret && typeof ret.then==='function'){ ret.then(function(d){ cb(d,d?null:'empty'); }).catch(function(){ cb(null,'error'); }); }
      else if(ret){ cb(ret,null); }
      else cb(null,'empty');
    }) || cb(null,'error');
  }
  function check(){
    var pt=activePt();
    if(!pt){ toast('Pick an active patient first'); return; }
    panel('Checking the open Athena chart…','wait');
    readOpenChart(function(chart, err){
      if(err==='no-bridge'){ panel('Athena chart match needs MLS Assist + an open, signed-in Athena tab. Install/enable Assist and open the patient in Athena, then check again.','gate'); return; }
      if(!chart || err){ panel('No open Athena chart detected. Open the patient’s chart in your signed-in Athena tab (via MLS Assist), then check again.','gate'); return; }
      var r=compare(chart, pt);
      if(r.state==='match') panel('✓ Match — the open Athena chart is '+esc(pt.name)+'.','ok');
      else if(r.state==='partial') panel('⚠ Partial match — open chart “'+esc(r.detail)+'” vs active “'+esc(pt.name)+'”. Verify before charting.','warn');
      else panel('⚠ Mismatch — Athena shows “'+esc(r.detail)+'” but your active patient is “'+esc(pt.name)+'”. Do not chart until they match.','warn');
    });
  }
  function panel(msg, kind){
    injectCss(); var ex=document.getElementById('mlsMatchPop'); if(ex) ex.remove();
    var p=document.createElement('div'); p.id='mlsMatchPop'; p.className='mls-match-'+(kind||'ok');
    p.innerHTML='<span class="mls-match-msg">'+msg+'</span><button type="button" class="mls-match-x">✕</button>';
    document.body.appendChild(p);
    p.querySelector('.mls-match-x').addEventListener('click', function(){ p.remove(); });
    if(kind!=='wait') setTimeout(function(){ var n=document.getElementById('mlsMatchPop'); if(n) n.remove(); }, 9000);
  }
  function toast(m){ safe(function(){ if(window.toast){window.toast(m,'info');} else panel(m,'gate'); }); }
  function injectCss(){
    if(document.getElementById('mlsMatchCss')) return;
    var s=document.createElement('style'); s.id='mlsMatchCss';
    s.textContent='#mlsMatchPop{position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:100001;max-width:520px;width:calc(100% - 32px);display:flex;gap:10px;align-items:flex-start;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-left:4px solid #2563c9;border-radius:12px;box-shadow:0 16px 44px rgba(15,28,46,.22);padding:13px 14px;font-size:13px;color:var(--ink,#15293f);}'
      +'#mlsMatchPop.mls-match-ok{border-left-color:#16a34a;} #mlsMatchPop.mls-match-warn{border-left-color:#dc2626;} #mlsMatchPop.mls-match-gate{border-left-color:#b45309;} #mlsMatchPop.mls-match-wait{border-left-color:#2563c9;}'
      +'#mlsMatchPop .mls-match-msg{flex:1;line-height:1.4;} #mlsMatchPop .mls-match-x{border:0;background:transparent;cursor:pointer;color:var(--muted,#9aa7b4);font-size:14px;}';
    (document.head||document.documentElement).appendChild(s);
  }
  window.__mlsAthenaMatch={ check:check, _compare:compare, bridgeAvailable:bridgeAvailable };
})();


/* ---- module: feat_legal_chain.js ---- */

/* ===== MLS Clinical -> Legal -> Billing Chain — connectedness feature #10 =====
   Flag a patient as an IME / legal case -> open the app's Legal flow which auto-assembles that
   patient's notes into a report -> (billing) the platform 5% fee hook for when Stripe Connect is
   live. Additive: keeps a per-patient legal-flag store (localStorage), routes into the existing
   legal functions (legalOpenPatient / generateLegalReport / showView('legalreq')), registers a
   timeline provider so legal flags/exports show on the patient timeline, and exposes a fee hook
   (window.__mlsLegalFee) that computes the 5% platform fee and is ready to call Connect once live.
   The actual fee capture is GATED on Stripe Connect go-live (documented), never charged here. */
(function(){
  'use strict';
  if (window.__mlsLegalChain) return;
  var FEE_RATE=0.05;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function email(){ return safe(function(){ return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]; }, null); }
  function fkey(){ var e=email(); return e?('sf_u::'+e+'::mlsLegalFlags'):null; }
  function getFlags(){ var k=fkey(); return k?safe(function(){return JSON.parse(localStorage.getItem(k)||'{}');},{}):{}; }
  function setFlags(o){ var k=fkey(); if(k) safe(function(){ localStorage.setItem(k, JSON.stringify(o)); }); }
  function isFlagged(id){ return !!getFlags()[id]; }
  function activeId(){ return safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null); }
  function ptName(id){ return safe(function(){ var p=window.findPatient&&window.findPatient(id); return p?(p.name||''):''; }, ''); }
  function toast(m){ safe(function(){ if(window.toast){window.toast(m,'ok');return;} var d=document.createElement('div'); d.textContent=m; d.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#15293f;color:#fff;padding:8px 14px;border-radius:10px;z-index:100001;font-size:13px'; document.body.appendChild(d); setTimeout(function(){d.remove();},1600); }); }

  function flagCase(id, type){
    id=id||activeId(); if(!id){ toast('Pick an active patient first'); return; }
    var f=getFlags(); f[id]={type:type||'IME/legal', ts:Date.now()}; setFlags(f);
    toast('Flagged '+(ptName(id)||'patient')+' as '+(type||'IME/legal')+' case');
    // route into the app's legal flow which auto-assembles this patient's notes
    safe(function(){
      if(window.legalOpenPatient){ window.legalOpenPatient(id); }
      else if(window.generateLegalReport){ if(window.setActivePtId) window.setActivePtId(id); window.generateLegalReport(); }
      else if(window.showView){ window.showView('legalreq'); }
    });
  }
  function unflag(id){ var f=getFlags(); delete f[id]; setFlags(f); }

  // billing fee hook — computes the 5% platform fee; GATED until Stripe Connect is live.
  var feeHook={
    rate:FEE_RATE,
    compute:function(amountCents){ amountCents=+amountCents||0; var fee=Math.round(amountCents*FEE_RATE); return {amountCents:amountCents, feeCents:fee, netCents:amountCents-fee, rate:FEE_RATE}; },
    connectReady:function(){ return safe(function(){ return !!(window.stripeConnectReady||window.connectReady); }, false); },
    capture:function(amountCents){
      var calc=this.compute(amountCents);
      if(!this.connectReady()){ return {gated:true, reason:'Stripe Connect not live — 5% fee computed but not charged', calc:calc}; }
      // when Connect is live, the backend destination-charge/application-fee flow handles capture.
      return {gated:false, calc:calc};
    }
  };

  function legalProvider(id){
    var f=getFlags()[id]; if(!f) return [];
    return [{ date:f.ts, type:'legal', icon:'⚖️', title:'Flagged as '+(f.type||'IME/legal')+' case',
      sub:'Legal exports assemble this patient’s notes', onClick:function(){ safe(function(){ if(window.legalOpenPatient) window.legalOpenPatient(id); else if(window.showView) window.showView('legalreq'); }); } }];
  }
  function activityProvider(){
    var f=getFlags(); return Object.keys(f).map(function(id){ return { date:f[id].ts, type:'baa', icon:'⚖️', title:'IME/legal case flagged', sub:ptName(id)||'', onClick:function(){ safe(function(){ if(window.legalOpenPatient) window.legalOpenPatient(id); else if(window.showView) window.showView('legalreq'); }); } }; }); }

  function init(){
    safe(function(){ if(window.__mlsTimeline&&window.__mlsTimeline.addProvider) window.__mlsTimeline.addProvider(legalProvider); });
    safe(function(){ if(window.__mlsActivity&&window.__mlsActivity.addProvider) window.__mlsActivity.addProvider(activityProvider); });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.__mlsLegalFee=feeHook;
  window.__mlsLegalChain={ flagCase:flagCase, unflag:unflag, isFlagged:isFlagged, getFlags:getFlags, fee:feeHook };
})();

