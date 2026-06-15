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

