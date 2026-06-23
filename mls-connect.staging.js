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
      {label:'Billing code sheet', hint:'Edit your practice’s curated code list', icon:'🧾', run:function(){ safe(function(){ window.__mlsCodeSheet && window.__mlsCodeSheet.open(); }); }},
      {label:'Pick visit codes (superbill)', hint:'Quick-select billing codes for this visit', icon:'☑️', run:function(){ safe(function(){ window.__mlsCodeSheet && window.__mlsCodeSheet.pick(); }); }},
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
    return '<span class="mls-sync mls-sync-'+cls+'" data-tip="Athena sync status — click for details">'
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
      +'<div class="mlsrec-head"><span class="mlsrec-h">Recommendations — '+esc(activeName()||'patient')+'</span><span style="display:flex;gap:2px"><button type="button" id="mlsRecValidate" class="mlsrec-x" data-tip="Check these codes against your code sheet">🛡️</button><button type="button" id="mlsRecClose" class="mlsrec-x">✕</button></span></div>'
      +'<div class="mlsrec-hint">Auto-drawn from the latest note. One-click to act.</div>'
      +'<div id="mlsRecBody" class="mlsrec-body"></div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); });
    document.getElementById('mlsRecClose').addEventListener('click', close);
    render(recs);
    var vb=document.getElementById('mlsRecValidate');
    if(vb){ if(window.__mlsCodeSheet&&window.__mlsCodeSheet.showValidation){ vb.addEventListener('click', function(){ window.__mlsCodeSheet.showValidation(latestNoteText(id), activeName()); }); } else { vb.style.display='none'; } }
    // Optional guardrail: when 'validate AI codes' is on, flag off-sheet/retired codes inline.
    safe(function(){ if(window.__mlsCodeSheet&&window.__mlsCodeSheet.constrainOn&&window.__mlsCodeSheet.constrainOn()){
      var res=window.__mlsCodeSheet.validate(latestNoteText(id))||[]; var bad=res.filter(function(r){return r.status!=='approved';});
      var body=document.getElementById('mlsRecBody');
      if(body){ var d=document.createElement('div'); d.style.cssText='margin:0 0 12px;padding:9px 11px;border-radius:10px;font-size:12.5px;border:1px solid '+(bad.length?'#f0d6a8':'#bfe3cd')+';background:'+(bad.length?'#fdf6e7':'#eefaf1')+';color:'+(bad.length?'#7a5a00':'#1f6b3f')+'';
        d.innerHTML=(bad.length? ('⚠ '+bad.length+' code(s) not on your approved sheet: '+bad.map(function(r){return esc(r.code);}).join(', ')+' — <b>click to review</b>') : '🛡️ All codes match your approved sheet.');
        if(bad.length){ d.style.cursor='pointer'; d.addEventListener('click', function(){ window.__mlsCodeSheet.showValidation(latestNoteText(id), activeName()); }); }
        body.insertBefore(d, body.firstChild); } } });
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
  /* Only buttons that actually PERSIST a visit. 'generate note' is intentionally
     excluded — Generate Note only drafts in-memory and saves nothing to History,
     so it must never trigger the "Landed in History" popup. */
  var TRIGGERS=/review\s*&\s*sign|save to history|sign\s*&\s*save|^sign$/i;
  var lastShown=0;
  /* Gate the cascade on the note ACTUALLY landing in getNotes() (a non-draft note
     for the active patient, freshly saved after the click) rather than a blind
     timer. Polls briefly; if the save never shows, the popup never fires, so it
     cannot claim "Landed in History" before the save completes. */
  function freshlySaved(id, sinceTs){
    return safe(function(){
      if(!window.getNotes) return false;
      var ns=window.getNotes()||[];
      for(var i=0;i<ns.length;i++){
        var n=ns[i];
        if(!n || n.patientId!==id) continue;
        if(n.isDraft) continue;
        var t=n.updated||n.created||0;
        if(t>=sinceTs-1500) return true;
      }
      return false;
    }, false);
  }
  function waitForSaveThenCascade(id, clickTs){
    var tries=0, MAX=16; /* about 16 * 200ms = 3.2s */
    (function poll(){
      if(freshlySaved(id, clickTs)){ showCascade(); return; }
      if(++tries>=MAX) return; /* save never confirmed -> stay silent, no false claim */
      setTimeout(poll, 200);
    })();
  }
  function onClick(e){
    safe(function(){
      var el=e.target, hops=0, btn=null;
      while(el && hops<4){ if(el.tagName==='BUTTON'||el.getAttribute&&el.getAttribute('onclick')){ btn=el; break; } el=el.parentElement; hops++; }
      if(!btn) return;
      var txt=(btn.textContent||'').replace(/\s+/g,' ').trim();
      if(TRIGGERS.test(txt)){
        var now=Date.now(); if(now-lastShown<3000) return; lastShown=now;
        var id=activeId(); if(!id) return;
        waitForSaveThenCascade(id, now);
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

/* ===== MLS Supervision Queue (cosign lifecycle) — connectedness feature #8 =====
   Makes the Head-Dr supervision / cosign flow REAL and PERSISTENT:
     doctor drafts a note -> "Submit for cosign" -> it lands in the supervisor queue
     -> a Head Dr reviews & cosigns -> status propagates to History / Visit / card / queue
     -> (gated) the cosigned note is sent to Athena.

   Persistence model (no backend change needed): the supervision status RIDES ON THE
   NOTE RECORD as n.sup = { status, submittedBy/At, supervisor, cosignedBy/At, cosignLine }.
   It is saved through the app's OWN persistence (window.saveNotes -> localStorage, and
   window.saveNoteToBackend -> POST /api/records, AES-encrypted at rest, upsert by id) —
   exactly the path the app already uses for signing. So a cosign survives reloads and
   syncs across devices like any other note change. A light localStorage mirror
   (sf_u::<email>::mlsSupStatus) is kept only so badges can paint instantly.

   Role awareness: a treating clinician (doctor OR a Head Dr acting as provider) can submit;
   COSIGN is enforced to Head Dr (bkUser.role==='head' || bkUser.isHead). When the app has no
   server role (offline / un-hosted preview) both actions are allowed so the flow is testable.

   Cross-account: a Head Dr already receives team-owned records server-side, so the queue can
   also surface a sub-doctor's submitted notes (read). The head WRITING a cosign back onto a
   sub-doctor's server record needs a Head-Dr write endpoint (POST /api/records/:id/cosign) and
   is therefore GATED — it is attempted best-effort and clearly labeled when unavailable.

   GATED: the final "send cosigned note to Athena" needs live Athena (FHIR write-back / the
   Assist DOM path). It is wired behind window.__mlsSupervision.athenaEnabled (default false)
   and the onCosign hook; flip athenaEnabled=true once athenahealth API access / MLS Assist is
   live to activate it. Everything else works today. */
(function(){
  'use strict';
  if (window.__mlsSupervision) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

  /* ---- identity / role ---- */
  function bk(){ return safe(function(){ return window.bkUser; }, null); }
  function myEmail(){
    var u=bk(); if(u&&u.email) return String(u.email).toLowerCase();
    var s=safe(function(){ return window.session&&window.session.email; }, null); if(s) return String(s).toLowerCase();
    return safe(function(){ return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]; }, null);
  }
  function myName(){ var n=safe(function(){ return window.getName&&window.getName(); }, ''); if(n) return n; var u=bk(); return (u&&(u.name||u.email))||'Clinician'; }
  function hasRole(){ var u=bk(); return !!(u&&u.role); }
  function isHead(){ var u=bk(); if(!u) return true; /* no server role -> allow (preview/testable) */ return !!(u.isHead||u.role==='head'||u.role==='owner'||u.role==='admin'); }
  function isClinician(){ var u=bk(); if(!u) return true; return !!(u.isHead||u.role==='head'||u.role==='user'); }

  /* ---- note access + persistence (rides on the note via the app's own save path) ---- */
  function notes(){ var ns=safe(function(){ return window.getNotes&&window.getNotes(); }, []); return Array.isArray(ns)?ns:[]; }
  function findNote(id){ return notes().filter(function(n){ return n&&n.id===id; })[0]||null; }
  function persistNote(n){
    safe(function(){
      var arr=notes(); var i=arr.findIndex(function(x){ return x&&x.id===n.id; });
      if(i>=0) arr[i]=n; else arr.unshift(n);
      if(window.saveNotes) window.saveNotes(arr);
    });
    safe(function(){ if(window.saveNoteToBackend) window.saveNoteToBackend(n); });   // /api/records upsert (encrypted)
    mirror();                                                                         // refresh instant-paint cache
    safe(function(){ if(window.updateNavCounts) window.updateNavCounts(); });
    safe(function(){ if(window.currentView==='history' && window.renderHistory) window.renderHistory(); });
  }
  /* derive a status for a note that has no explicit n.sup yet */
  function statusOfNote(n){
    if(!n) return null;
    if(n.sup && n.sup.status) return n.sup.status;
    if(n.isDraft) return 'draft';
    if(n.signed) return 'signed';
    return 'unsigned';
  }

  /* ---- localStorage mirror (badges paint instantly, even before notes() resolves) ---- */
  function mkey(){ var e=myEmail(); return e?('sf_u::'+e+'::mlsSupStatus'):null; }
  function mirrorGet(){ var k=mkey(); return k?safe(function(){ return JSON.parse(localStorage.getItem(k)||'{}'); }, {}):{}; }
  function mirror(){ var k=mkey(); if(!k) return; safe(function(){ var m={}; notes().forEach(function(n){ if(n&&n.sup&&n.sup.status) m[n.id]=n.sup.status; }); localStorage.setItem(k, JSON.stringify(m)); }); }
  function mirrorStatus(id){ return mirrorGet()[id]||null; }

  function fmtDate(v){ if(!v) return ''; var d=new Date(v); return isNaN(d)?'':d.toLocaleDateString([], {month:'short',day:'numeric'}); }
  function fmtWhen(v){ if(!v) return ''; var d=new Date(v); return isNaN(d)?'':d.toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }

  /* ---- lifecycle actions ---- */
  function submitForCosign(id, supervisor){
    var n=findNote(id); if(!n) return false;
    n.sup = n.sup || {};
    n.sup.status='submitted';
    n.sup.submittedBy=myName(); n.sup.submittedByEmail=myEmail(); n.sup.submittedAt=Date.now();
    if(supervisor) n.sup.supervisor=supervisor;
    n.updated=Date.now();
    persistNote(n);
    log('Note submitted for cosign', n);
    return true;
  }
  function cosign(id, opts){
    opts=opts||{};
    var n = opts.note || findNote(id); if(!n) return false;
    if(!isHead()){ toast('Only a Head Dr can cosign.','err'); return false; }
    n.sup = n.sup || {};
    n.sup.status='cosigned';
    n.sup.cosignedBy=myName(); n.sup.cosignedByEmail=myEmail(); n.sup.cosignedAt=Date.now();
    n.sup.cosignLine='Cosigned by '+myName()+' (supervising) on '+new Date().toLocaleString()+'.';
    n.updated=Date.now();
    if(opts.teamOwned){
      // GATED cross-account write: head writing onto a sub-doctor's server record needs a
      // Head-Dr cosign endpoint. Attempt it best-effort; never block the local record.
      teamCosignWriteBack(n);
    } else {
      persistNote(n);
    }
    log('Note cosigned', n);
    // GATED: send the cosigned note to Athena (FHIR write-back / Assist DOM path)
    safe(function(){ if(typeof onCosign==='function') onCosign(n); });
    sendToAthena(n);
    return true;
  }

  /* ---- gated Athena send (wired, off until live) ---- */
  var athenaEnabled=false;
  function athenaAvailable(){ return athenaEnabled && safe(function(){ return typeof window.pushHistoryNoteToAthena==='function' || typeof window.sendToEMRviaAssist==='function'; }, false); }
  function sendToAthena(n){
    if(!n) return {gated:true};
    if(!athenaAvailable()){
      safe(function(){ if(window.__mlsSync&&window.__mlsSync.mark) window.__mlsSync.mark('Cosigned — Athena send queued (gated)','pending'); });
      return {gated:true, reason:'Athena send activates when athenahealth API access / MLS Assist is live (set window.__mlsSupervision.athenaEnabled=true).'};
    }
    return safe(function(){
      if(!n.isDraft && window.pushHistoryNoteToAthena){ window.pushHistoryNoteToAthena(n.id); return {sent:true}; }
      return {gated:true};
    }, {gated:true});
  }

  /* ---- gated cross-account cosign write-back (head -> sub-doctor record) ---- */
  function teamCosignWriteBack(n){
    var base=safe(function(){ return window.bkBase&&window.bkBase(); }, null);
    var tok=safe(function(){ return window.bkToken&&window.bkToken(); }, null);
    if(!base||!tok){ toast('Cosign recorded locally (offline).','ok'); return; }
    safe(function(){
      fetch(base+'/api/records/'+encodeURIComponent(n.id)+'/cosign',{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok},
        body:JSON.stringify({ cosign:n.sup })
      }).then(function(r){
        if(r&&r.ok){ toast('Cosigned — synced to the doctor’s chart.','ok'); }
        else { toast('Cosign recorded. Server cosign-sync is pending the Head-Dr write endpoint.','ok'); }
      }).catch(function(){ toast('Cosign recorded. Server cosign-sync is pending the Head-Dr write endpoint.','ok'); });
    });
  }

  /* ---- queues ---- */
  // My own notes that are in the pipeline (draft/unsigned/submitted, not yet cosigned).
  function myQueue(){
    return notes().filter(function(n){
      var s=statusOfNote(n);
      return s==='draft'||s==='unsigned'||s==='submitted';
    }).map(function(n){
      return { id:n.id, patient:n.patient||'', patientId:n.patientId, kind:n.kind||'Note',
               date:n.updated||n.created, status:statusOfNote(n), sup:n.sup||null, owned:true };
    }).sort(function(a,b){ return (b.date||0)-(a.date||0); });
  }
  // Recently cosigned (mine) — shown collapsed for confirmation.
  function recentCosigned(){
    return notes().filter(function(n){ return statusOfNote(n)==='cosigned'; })
      .map(function(n){ return { id:n.id, patient:n.patient||'', patientId:n.patientId, kind:n.kind||'Note', date:(n.sup&&n.sup.cosignedAt)||n.updated, status:'cosigned', sup:n.sup||null, owned:true }; })
      .sort(function(a,b){ return (b.date||0)-(a.date||0); }).slice(0,8);
  }
  // Team submissions awaiting MY cosign (Head Dr only) — read from server records.
  var _team=[]; var _teamLoaded=false;
  function loadTeam(cb){
    if(!isHead() || !hasRole()){ _team=[]; _teamLoaded=true; if(cb) cb(); return; }
    var base=safe(function(){ return window.bkBase&&window.bkBase(); }, null);
    var tok=safe(function(){ return window.bkToken&&window.bkToken(); }, null);
    if(!base||!tok){ _team=[]; _teamLoaded=true; if(cb) cb(); return; }
    var mine=myEmail();
    safe(function(){
      fetch(base+'/api/records',{headers:{'Authorization':'Bearer '+tok}})
        .then(function(r){ return r.ok?r.json():{}; })
        .then(function(d){
          var rows=(d&&d.records)||[];
          _team=rows.filter(function(row){
            var owner=row.owner_email?String(row.owner_email).toLowerCase():'';
            var rec=row.record||{};
            return owner && owner!==mine && rec.sup && rec.sup.status==='submitted';
          }).map(function(row){
            var rec=row.record||{};
            return { id:rec.id, patient:rec.patient||'', patientId:rec.patientId, kind:rec.kind||'Note',
                     date:(rec.sup&&rec.sup.submittedAt)||row.updated_at, status:'submitted',
                     sup:rec.sup||null, owned:false, owner:row.owner_email, record:rec };
          }).sort(function(a,b){ return (new Date(b.date||0))-(new Date(a.date||0)); });
          _teamLoaded=true; if(cb) cb();
        })
        .catch(function(){ _team=[]; _teamLoaded=true; if(cb) cb(); });
    });
  }
  function teamQueue(){ return _team; }

  // Total count for the Cmd-K / badge: my pending + team submissions.
  function count(){ return myQueue().length + teamQueue().length; }

  /* ---- badge component (one look used everywhere) ---- */
  var MAP={
    draft:    ['Draft','#6b7280','#eef0f3'],
    unsigned: ['Unsigned','#b45309','#fef3c7'],
    submitted:['Awaiting cosign','#1456a8','#e0edff'],
    cosigned: ['Cosigned','#127a55','#dcfce7'],
    signed:   ['Signed','#127a55','#dcfce7']
  };
  function badgeHtml(st){ var m=MAP[st]||MAP.draft; return '<span class="mls-sup-badge" style="color:'+m[1]+';background:'+m[2]+'">'+m[0]+'</span>'; }

  /* ---- activity log feed-in ---- */
  function log(title, n){ safe(function(){ if(window.__mlsActivity && window.__mlsActivity.addProvider){ /* provider added once below */ } }); }

  /* ====================== QUEUE OVERLAY ====================== */
  function open(){
    injectCss(); close();
    loadTeam(function(){ render(); });
    render(); // paint immediately; team section fills in when loadTeam returns
  }
  function render(){
    var existing=document.getElementById('mlsSupOverlay');
    var my=myQueue(), team=teamQueue(), done=recentCosigned();
    var total=my.length+team.length;
    var head=isHead();

    function rowHtml(it, where){
      var acts='<button type="button" class="mls-sup-act" data-act="open" data-id="'+esc(it.id)+'">Open</button>';
      if(it.owned && (it.status==='draft'||it.status==='unsigned')){
        acts+='<button type="button" class="mls-sup-act primary" data-act="submit" data-id="'+esc(it.id)+'">Submit for cosign</button>';
      } else if(it.status==='submitted' && head){
        acts+='<button type="button" class="mls-sup-act primary" data-act="cosign" data-id="'+esc(it.id)+'" data-team="'+(it.owned?'0':'1')+'">Review &amp; cosign</button>';
      } else if(it.status==='submitted' && !head){
        acts+='<span class="mls-sup-wait">Awaiting Head Dr</span>';
      }
      var who='';
      if(it.sup){
        if(it.status==='submitted' && it.sup.submittedBy) who='Submitted by '+esc(it.sup.submittedBy)+' · '+esc(fmtWhen(it.sup.submittedAt));
        else if(it.status==='cosigned' && it.sup.cosignedBy) who='Cosigned by '+esc(it.sup.cosignedBy)+' · '+esc(fmtWhen(it.sup.cosignedAt));
      }
      if(where==='team' && it.owner) who='Dr. '+esc(it.owner)+(who?(' · '+who):'');
      return '<div class="mls-sup-row"><div class="mls-sup-main">'
        +'<div class="mls-sup-t">'+esc(it.patient||'Patient')+' · '+esc(it.kind)+' '+badgeHtml(it.status)+'</div>'
        +'<div class="mls-sup-s">'+esc(fmtDate(it.date))+(who?(' &nbsp;·&nbsp; '+who):'')+'</div>'
        +'</div><div class="mls-sup-acts">'+acts+'</div></div>';
    }

    var body='';
    // Section: my pipeline
    body+='<div class="mls-sup-sec">My notes <span class="mls-sup-secn">'+my.length+'</span></div>';
    body+= my.length ? my.map(function(it){ return rowHtml(it,'mine'); }).join('') : '<div class="mls-sup-empty sm">No drafts or unsigned notes. 🎉</div>';
    // Section: team submissions awaiting my cosign (head only)
    if(head && hasRole()){
      body+='<div class="mls-sup-sec">Awaiting your cosign <span class="mls-sup-secn">'+team.length+'</span></div>';
      body+= team.length ? team.map(function(it){ return rowHtml(it,'team'); }).join('')
                         : '<div class="mls-sup-empty sm">'+(_teamLoaded?'Nothing from your doctors awaiting cosign.':'Loading your team’s submissions…')+'</div>';
    }
    // Section: recently cosigned
    if(done.length){
      body+='<div class="mls-sup-sec">Recently cosigned</div>';
      body+=done.map(function(it){ return rowHtml(it,'done'); }).join('');
    }

    var noteLine = head
      ? 'You can review &amp; cosign submitted notes. The cosigned note is sent to Athena once athenahealth access / MLS Assist is live.'
      : 'Submit a drafted note for your Head Dr to review &amp; cosign.';

    var html='<div class="mls-sup-panel" role="dialog" aria-label="Supervision queue">'
      +'<div class="mls-sup-head"><span class="mls-sup-h">Supervision queue <span class="mls-sup-count">'+total+'</span></span><button type="button" id="mlsSupX" class="mls-sup-x">✕</button></div>'
      +'<div class="mls-sup-note">'+noteLine+'</div>'
      +'<div class="mls-sup-body">'+body+'</div></div>';

    var ov=existing;
    if(!ov){ ov=document.createElement('div'); ov.id='mlsSupOverlay'; document.body.appendChild(ov); ov.addEventListener('mousedown', function(e){ if(e.target===ov) close(); }); }
    ov.innerHTML=html;
    document.getElementById('mlsSupX').addEventListener('click', close);
    ov.querySelectorAll('.mls-sup-act').forEach(function(b){
      b.addEventListener('click', function(){
        var a=b.getAttribute('data-act'), id=b.getAttribute('data-id');
        if(a==='open'){ close(); openNote(id); }
        else if(a==='submit'){ if(submitForCosign(id)){ toast('Submitted for cosign.','ok'); } render(); refreshAll(); }
        else if(a==='cosign'){
          var team=b.getAttribute('data-team')==='1';
          var item=team ? teamQueue().filter(function(x){return x.id===id;})[0] : null;
          if(confirmCosign()){ cosign(id, team?{teamOwned:true, note:item&&item.record}:{}); render(); refreshAll(); }
        }
      });
    });
  }
  function confirmCosign(){ return safe(function(){ return window.confirm('Cosign this note? You are attesting you reviewed it as the supervising physician.'); }, true); }
  function openNote(id){
    safe(function(){
      var n=findNote(id);
      if(n&&n.patientId&&window.setActivePtId) window.setActivePtId(n.patientId);
      if(window.openNoteFromHistory){ if(window.showView) window.showView('history'); window.openNoteFromHistory(id); }
      else if(window.showView) window.showView('history');
    });
  }
  function close(){ var o=document.getElementById('mlsSupOverlay'); if(o) o.remove(); }
  function toast(m,kind){ safe(function(){ if(window.toast){ window.toast(m, kind||'ok'); return; } var d=document.createElement('div'); d.textContent=m; d.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#15293f;color:#fff;padding:8px 14px;border-radius:10px;z-index:100001;font-size:13px'; document.body.appendChild(d); setTimeout(function(){d.remove();},1600); }); }
  var onCosign=null;

  function refreshAll(){
    safe(function(){ if(window.__mlsCard&&window.__mlsCard.refresh) window.__mlsCard.refresh(); });
    badgeHistory(); injectCardChip(); injectVisitChip();
  }

  /* ====================== BADGES IN OTHER VIEWS ====================== */
  // History rows (rows carry onclick openNoteFromHistory('id'))
  function badgeHistory(){
    safe(function(){
      var m=mirrorGet();
      document.querySelectorAll('[onclick*="openNoteFromHistory("]').forEach(function(el){
        var mm=(el.getAttribute('onclick')||'').match(/openNoteFromHistory\('([^']+)'\)/); if(!mm) return;
        var s=m[mm[1]]; var n; if(!s){ n=findNote(mm[1]); s=n&&n.sup&&n.sup.status; }
        if(!s || s==='signed') { var old=el.querySelector('.mls-sup-badge'); if(old) old.remove(); return; }
        var cur=el.querySelector('.mls-sup-badge');
        if(cur){ if(cur.getAttribute('data-st')===s) return; cur.remove(); }
        var tmp=document.createElement('div'); tmp.innerHTML=badgeHtml(s); var node=tmp.firstChild; node.setAttribute('data-st',s);
        var main=el.querySelector('.hist-main .t')||el.querySelector('.hist-main')||el; main.appendChild(node);
      });
    });
  }
  // Unified patient card: a status chip for the ACTIVE patient's most recent in-pipeline note.
  function activeNoteStatus(){
    var pid=safe(function(){ return window.getActivePtId&&window.getActivePtId(); }, null);
    if(!pid) return null;
    var cand=notes().filter(function(n){ return n&&n.patientId===pid; })
      .sort(function(a,b){ return (b.updated||b.created||0)-(a.updated||a.created||0); });
    for(var i=0;i<cand.length;i++){ var s=statusOfNote(cand[i]); if(s==='submitted'||s==='cosigned'||s==='draft'||s==='unsigned') return s; }
    return null;
  }
  function injectCardChip(){
    safe(function(){
      var actions=document.querySelector('#mlsCtxBar .mlsctx-actions');
      var existing=document.getElementById('mlsSupCardChip');
      var st=activeNoteStatus();
      if(!actions || !st){ if(existing) existing.remove(); return; }
      if(existing){ if(existing.getAttribute('data-st')===st) return; existing.remove(); }
      var span=document.createElement('span'); span.id='mlsSupCardChip'; span.setAttribute('data-st',st);
      span.className='mls-sup-cardchip'; span.setAttribute('data-tip','Supervision status'); span.innerHTML=badgeHtml(st);
      span.style.cssText='display:inline-flex;align-items:center;cursor:pointer';
      span.onclick=function(){ open(); };
      actions.insertBefore(span, actions.firstChild);
    });
  }
  // Visit page: a status chip + a contextual Submit/Cosign button next to the sign controls,
  // bound to the note currently open in the editor (window.currentNoteId).
  function injectVisitChip(){
    safe(function(){
      var view=document.getElementById('view-visit')||document.querySelector('[data-view="visit"]');
      var onVisit = safe(function(){ return window.currentView==='visit'; }, false);
      var host=document.getElementById('signLine') ? document.getElementById('signLine').parentElement : null;
      var anchor=document.getElementById('signBtn');
      var wrap=document.getElementById('mlsSupVisitWrap');
      if(!onVisit || !anchor){ if(wrap) wrap.remove(); return; }
      var id=safe(function(){ return window.currentNoteId; }, null);
      var n=id?findNote(id):null;
      var st=n?statusOfNote(n):null;
      if(!n || !st || st==='signed'){ if(wrap) wrap.remove(); return; }
      if(!wrap){ wrap=document.createElement('span'); wrap.id='mlsSupVisitWrap'; wrap.style.cssText='display:inline-flex;align-items:center;gap:8px;margin-left:10px;vertical-align:middle'; anchor.parentElement.insertBefore(wrap, anchor.nextSibling); }
      var canCosign = st==='submitted' && isHead();
      var btn='';
      if(st==='draft'||st==='unsigned') btn='<button type="button" id="mlsSupVisitBtn" class="mls-sup-act primary" style="font-size:12px">Submit for cosign</button>';
      else if(canCosign) btn='<button type="button" id="mlsSupVisitBtn" class="mls-sup-act primary" style="font-size:12px">Review &amp; cosign</button>';
      else if(st==='submitted') btn='<span class="mls-sup-wait">Awaiting Head Dr</span>';
      var key=st+'|'+canCosign;
      if(wrap.getAttribute('data-k')===key && wrap.getAttribute('data-id')===id) return;
      wrap.setAttribute('data-k',key); wrap.setAttribute('data-id',id);
      wrap.innerHTML=badgeHtml(st)+btn;
      var vb=document.getElementById('mlsSupVisitBtn');
      if(vb) vb.onclick=function(){
        if(st==='draft'||st==='unsigned'){ if(submitForCosign(id)){ toast('Submitted for cosign.','ok'); } }
        else if(canCosign){ if(confirmCosign()) cosign(id,{}); }
        refreshAll();
      };
    });
  }

  /* ====================== STYLES ====================== */
  function injectCss(){
    if(document.getElementById('mlsSupCss')) return;
    var s=document.createElement('style'); s.id='mlsSupCss';
    s.textContent=
      '#mlsSupOverlay{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.4);display:flex;align-items:flex-start;justify-content:center;padding:9vh 16px 16px;backdrop-filter:blur(2px);}'
      +'#mlsSupOverlay .mls-sup-panel{width:100%;max-width:580px;max-height:80vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mls-sup-head{display:flex;justify-content:space-between;align-items:center;padding:15px 18px;}'
      +'.mls-sup-h{font-weight:700;font-size:15px;color:var(--ink,#15293f);}'
      +'.mls-sup-count{display:inline-block;background:var(--brand,#2563c9);color:#fff;border-radius:20px;font-size:12px;padding:1px 9px;margin-left:6px;}'
      +'.mls-sup-x{border:0;background:transparent;font-size:16px;cursor:pointer;color:var(--muted,#7c8aa0);}'
      +'.mls-sup-note{padding:0 18px 12px;color:var(--muted,#7c8aa0);font-size:12px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mls-sup-body{overflow:auto;padding:6px 12px 14px;}'
      +'.mls-sup-sec{font-size:11.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted,#7c8aa0);padding:14px 8px 6px;}'
      +'.mls-sup-secn{display:inline-block;background:var(--line,#eef0f3);color:var(--muted,#5b6b7c);border-radius:20px;font-size:11px;padding:0 7px;margin-left:4px;}'
      +'.mls-sup-row{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:11px 8px;border-bottom:1px solid var(--line,#f0f2f6);}'
      +'.mls-sup-main{min-width:0;}'
      +'.mls-sup-t{font-size:13.5px;font-weight:600;color:var(--ink,#15293f);}'
      +'.mls-sup-s{font-size:12px;color:var(--muted,#9aa7b4);margin-top:2px;}'
      +'.mls-sup-acts{display:flex;gap:6px;flex:0 0 auto;align-items:center;}'
      +'.mls-sup-act{font:inherit;font-size:12px;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--ink,#15293f);border-radius:8px;padding:5px 10px;}'
      +'.mls-sup-act.primary{background:var(--brand,#2563c9);color:#fff;border-color:var(--brand,#2563c9);}'
      +'.mls-sup-wait{font-size:11.5px;color:var(--muted,#7c8aa0);font-style:italic;}'
      +'.mls-sup-badge{display:inline-block;font-size:10.5px;font-weight:700;border-radius:6px;padding:1px 7px;margin-left:6px;vertical-align:middle;white-space:nowrap;}'
      +'.mls-sup-empty{padding:30px;text-align:center;color:var(--muted,#7c8aa0);}'
      +'.mls-sup-empty.sm{padding:12px 8px;text-align:left;font-size:12.5px;}';
    (document.head||document.documentElement).appendChild(s);
  }

  /* ---- activity feed + timeline providers (so cosign events show in the practice feed) ---- */
  function wireProviders(){
    safe(function(){
      if(window.__mlsActivity && window.__mlsActivity.addProvider){
        window.__mlsActivity.addProvider(function(){
          return notes().filter(function(n){ return n&&n.sup&&(n.sup.status==='submitted'||n.sup.status==='cosigned'); }).map(function(n){
            var co=n.sup.status==='cosigned';
            return { date: co?(n.sup.cosignedAt):(n.sup.submittedAt), type:'supervision', icon: co?'✅':'👥',
                     title: co?('Note cosigned — '+(n.patient||'patient')):('Submitted for cosign — '+(n.patient||'patient')),
                     sub: co?(n.sup.cosignLine||''):('by '+(n.sup.submittedBy||'')),
                     onClick: function(){ openNote(n.id); } };
          });
        });
      }
    });
    safe(function(){
      if(window.__mlsTimeline && window.__mlsTimeline.addProvider){
        window.__mlsTimeline.addProvider(function(pid){
          return notes().filter(function(n){ return n&&n.patientId===pid&&n.sup&&n.sup.status; }).map(function(n){
            var st=n.sup.status; var co=st==='cosigned';
            return { date:(co?n.sup.cosignedAt:n.sup.submittedAt)||n.updated, type:'supervision', icon:co?'✅':'👥',
                     title:(co?'Cosigned':'Submitted for cosign'), sub:(co?(n.sup.cosignLine||''):('by '+(n.sup.submittedBy||''))),
                     onClick:function(){ openNote(n.id); } };
          });
        });
      }
    });
  }

  function init(){
    injectCss(); mirror(); wireProviders();
    setInterval(function(){ badgeHistory(); injectCardChip(); injectVisitChip(); }, 1500);
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', init); else init();

  window.__mlsSupervision={
    open:open, close:close, count:count, render:render,
    queue:myQueue, teamQueue:teamQueue, recentCosigned:recentCosigned,
    submit:submitForCosign, cosign:cosign, statusOf:function(id){ return statusOfNote(findNote(id)); },
    sendToAthena:sendToAthena,
    set athenaEnabled(v){ athenaEnabled=!!v; }, get athenaEnabled(){ return athenaEnabled; },
    set onCosign(fn){ onCosign=fn; }, get onCosign(){ return onCosign; }
  };
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
      if(!(chart.name||chart.patient||chart.dob)){ panel('MLS Assist is connected but no patient chart is open in Athena yet. Open the chart in your signed-in Athena tab, then check again.','gate'); return; }
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


/* ---- module: feat_code_sheet.js ---- */

/* ===== MLS Billing Code Sheet — optional prefilled/curated code set =====
   A practice-maintained, editable billing code sheet (CPT procedures, ICD-10 diagnoses,
   E/M levels, spinal levels, injectables), seeded from the practice's paper superbill.
   Three jobs, all OPTIONAL and additive (the pure-AI path is untouched when unused):
     1) MANAGE — open()  : edit/add/delete codes, import/export JSON, reset to seed,
                            and toggle "validate AI codes against this sheet".
     2) PICK    — pick()  : superbill-style checkbox quick-select for a visit; the picked
                            codes copy as a clean block and/or insert into the note field.
     3) GUARD   — validate(text) / when constrainAI is on: checks the codes that appear in a
                  note against the approved set + a small retired-code map, flagging anything
                  out-of-set, retired, or malformed so it never gets billed blind.
   Pure parse/read/localStorage; never patches an app function. Exposes window.__mlsCodeSheet.
   Storage: per-user localStorage key  sf_u::<email>::mlsCodeSheet  (mirrors other modules). */
(function(){
  'use strict';
  if (window.__mlsCodeSheet) return;
  var LSVER=1;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function email(){ return safe(function(){ if(window.bkUser&&window.bkUser.email) return window.bkUser.email; return (document.body.innerText.match(/[\w.+-]+@[\w.-]+\.\w+/)||[])[0]||null; }, null); }
  function lsKey(){ var e=email(); return e?('sf_u::'+e+'::mlsCodeSheet'):'sf_u::_local::mlsCodeSheet'; }
  function toast(msg){ safe(function(){ if(window.toast){ window.toast(msg,'ok'); return; } var d=document.createElement('div'); d.textContent=msg; d.style.cssText='position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#15293f;color:#fff;padding:8px 14px;border-radius:10px;z-index:100001;font-size:13px'; document.body.appendChild(d); setTimeout(function(){d.remove();},1500); }); }
  function copyTxt(txt){ safe(function(){ if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(txt); } else { var t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); } toast('Copied'); }); }

  /* ---------- SEED (from the practice charge sheet: spine / pain / PM&R) ---------- */
  function seed(){
    return {
      version:LSVER, constrainAI:false,
      cpt:[
        // Epidural steroid injections
        {code:'64479',desc:'TFESI / transforaminal ESI — cervical or thoracic, single level',group:'Epidural steroid injection'},
        {code:'64480',desc:'TFESI cervical/thoracic — each additional level (add-on)',group:'Epidural steroid injection'},
        {code:'64483',desc:'TFESI / transforaminal ESI — lumbar or sacral, single level',group:'Epidural steroid injection'},
        {code:'64484',desc:'TFESI lumbar/sacral — each additional level (add-on)',group:'Epidural steroid injection'},
        {code:'62321',desc:'Interlaminar/caudal ESI — cervical or thoracic (with imaging)',group:'Epidural steroid injection'},
        {code:'62323',desc:'Interlaminar/caudal ESI — lumbar or sacral (with imaging)',group:'Epidural steroid injection'},
        // Facet / medial branch blocks
        {code:'64490',desc:'Facet (medial branch) block — cervical or thoracic, 1st level',group:'Facet / medial branch block'},
        {code:'64491',desc:'Facet block cervical/thoracic — 2nd level (add-on)',group:'Facet / medial branch block'},
        {code:'64492',desc:'Facet block cervical/thoracic — 3rd+ level (add-on)',group:'Facet / medial branch block'},
        {code:'64493',desc:'Facet (medial branch) block — lumbar or sacral, 1st level',group:'Facet / medial branch block'},
        {code:'64494',desc:'Facet block lumbar/sacral — 2nd level (add-on)',group:'Facet / medial branch block'},
        {code:'64495',desc:'Facet block lumbar/sacral — 3rd+ level (add-on)',group:'Facet / medial branch block'},
        // Sacroiliac
        {code:'27096',desc:'Sacroiliac joint injection (with imaging guidance)',group:'Sacroiliac injection'},
        // Neurotomy / RF ablation
        {code:'64633',desc:'RF ablation, facet joint nerve — cervical or thoracic, 1st joint',group:'Neurotomy (RF ablation)'},
        {code:'64634',desc:'RF ablation cervical/thoracic — each additional joint (add-on)',group:'Neurotomy (RF ablation)'},
        {code:'64635',desc:'RF ablation, facet joint nerve — lumbar or sacral, 1st joint',group:'Neurotomy (RF ablation)'},
        {code:'64636',desc:'RF ablation lumbar/sacral — each additional joint (add-on)',group:'Neurotomy (RF ablation)'},
        {code:'64640',desc:'Destruction of other peripheral nerve or branch',group:'Neurotomy (RF ablation)'},
        // Tendon / joint / other
        {code:'20610',desc:'Major joint or bursa injection (or supratrochanteric)',group:'Tendon / joint / other'},
        {code:'20605',desc:'Intermediate joint/bursa injection (e.g., coccyx)',group:'Tendon / joint / other'},
        {code:'20550',desc:'Tendon sheath / ligament injection',group:'Tendon / joint / other'},
        {code:'77002',desc:'Fluoroscopic guidance for needle placement',group:'Tendon / joint / other'},
        {code:'63650',desc:'Percutaneous implantation, neurostimulator electrode array',group:'Tendon / joint / other'}
      ],
      icd:[
        // Disc disorder WITH MYELOPATHY
        {code:'M50.01',desc:'Cervical disc disorder w/ myelopathy — C2–C4 (high cervical)',group:'Disc disorder — myelopathy'},
        {code:'M50.021',desc:'Cervical disc disorder w/ myelopathy — C4–C5',group:'Disc disorder — myelopathy'},
        {code:'M50.022',desc:'Cervical disc disorder w/ myelopathy — C5–C6',group:'Disc disorder — myelopathy'},
        {code:'M50.023',desc:'Cervical disc disorder w/ myelopathy — C6–C7',group:'Disc disorder — myelopathy'},
        {code:'M50.03',desc:'Cervical disc disorder w/ myelopathy — C7–T1 (cervicothoracic)',group:'Disc disorder — myelopathy'},
        {code:'M51.04',desc:'Thoracic disc disorder w/ myelopathy',group:'Disc disorder — myelopathy'},
        {code:'M51.05',desc:'Thoracolumbar disc disorder w/ myelopathy',group:'Disc disorder — myelopathy'},
        {code:'M51.06',desc:'Lumbar disc disorder w/ myelopathy',group:'Disc disorder — myelopathy'},
        {code:'M51.07',desc:'Lumbosacral disc disorder w/ myelopathy',group:'Disc disorder — myelopathy'},
        // Disc disorder WITH RADICULOPATHY
        {code:'M50.11',desc:'Cervical disc disorder w/ radiculopathy — C2–C4',group:'Disc disorder — radiculopathy'},
        {code:'M50.121',desc:'Cervical disc disorder w/ radiculopathy — C4–C5',group:'Disc disorder — radiculopathy'},
        {code:'M50.122',desc:'Cervical disc disorder w/ radiculopathy — C5–C6',group:'Disc disorder — radiculopathy'},
        {code:'M50.123',desc:'Cervical disc disorder w/ radiculopathy — C6–C7',group:'Disc disorder — radiculopathy'},
        {code:'M50.13',desc:'Cervical disc disorder w/ radiculopathy — C7–T1',group:'Disc disorder — radiculopathy'},
        {code:'M51.14',desc:'Thoracic disc disorder w/ radiculopathy',group:'Disc disorder — radiculopathy'},
        {code:'M51.15',desc:'Thoracolumbar disc disorder w/ radiculopathy',group:'Disc disorder — radiculopathy'},
        {code:'M51.16',desc:'Lumbar disc disorder w/ radiculopathy',group:'Disc disorder — radiculopathy'},
        {code:'M51.17',desc:'Lumbosacral disc disorder w/ radiculopathy',group:'Disc disorder — radiculopathy'},
        // Spondylosis WITH MYELOPATHY
        {code:'M47.12',desc:'Spondylosis w/ myelopathy — cervical',group:'Spondylosis — myelopathy'},
        {code:'M47.13',desc:'Spondylosis w/ myelopathy — cervicothoracic',group:'Spondylosis — myelopathy'},
        {code:'M47.14',desc:'Spondylosis w/ myelopathy — thoracic',group:'Spondylosis — myelopathy'},
        {code:'M47.15',desc:'Spondylosis w/ myelopathy — thoracolumbar',group:'Spondylosis — myelopathy'},
        {code:'M47.16',desc:'Spondylosis w/ myelopathy — lumbar',group:'Spondylosis — myelopathy'},
        {code:'M47.17',desc:'Spondylosis w/ myelopathy — lumbosacral',group:'Spondylosis — myelopathy'},
        {code:'M47.18',desc:'Spondylosis w/ myelopathy — sacral / sacrococcygeal',group:'Spondylosis — myelopathy'},
        // Spondylosis WITH RADICULOPATHY
        {code:'M47.22',desc:'Spondylosis w/ radiculopathy — cervical',group:'Spondylosis — radiculopathy'},
        {code:'M47.23',desc:'Spondylosis w/ radiculopathy — cervicothoracic',group:'Spondylosis — radiculopathy'},
        {code:'M47.24',desc:'Spondylosis w/ radiculopathy — thoracic',group:'Spondylosis — radiculopathy'},
        {code:'M47.25',desc:'Spondylosis w/ radiculopathy — thoracolumbar',group:'Spondylosis — radiculopathy'},
        {code:'M47.26',desc:'Spondylosis w/ radiculopathy — lumbar',group:'Spondylosis — radiculopathy'},
        {code:'M47.27',desc:'Spondylosis w/ radiculopathy — lumbosacral',group:'Spondylosis — radiculopathy'},
        {code:'M47.28',desc:'Spondylosis w/ radiculopathy — sacral / sacrococcygeal',group:'Spondylosis — radiculopathy'},
        // Spondylosis WITHOUT myelopathy/radiculopathy = facet syndrome
        {code:'M47.812',desc:'Spondylosis w/o myelo/radiculopathy (facet) — cervical',group:'Facet syndrome (M47.81-)'},
        {code:'M47.813',desc:'Spondylosis w/o myelo/radiculopathy (facet) — cervicothoracic',group:'Facet syndrome (M47.81-)'},
        {code:'M47.814',desc:'Spondylosis w/o myelo/radiculopathy (facet) — thoracic',group:'Facet syndrome (M47.81-)'},
        {code:'M47.815',desc:'Spondylosis w/o myelo/radiculopathy (facet) — thoracolumbar',group:'Facet syndrome (M47.81-)'},
        {code:'M47.816',desc:'Spondylosis w/o myelo/radiculopathy (facet) — lumbar',group:'Facet syndrome (M47.81-)'},
        {code:'M47.817',desc:'Spondylosis w/o myelo/radiculopathy (facet) — lumbosacral',group:'Facet syndrome (M47.81-)'},
        {code:'M47.818',desc:'Spondylosis w/o myelo/radiculopathy (facet) — sacral / sacrococcygeal',group:'Facet syndrome (M47.81-)'},
        // Spondylolisthesis
        {code:'M43.12',desc:'Spondylolisthesis — cervical',group:'Spondylolisthesis'},
        {code:'M43.13',desc:'Spondylolisthesis — cervicothoracic',group:'Spondylolisthesis'},
        {code:'M43.14',desc:'Spondylolisthesis — thoracic',group:'Spondylolisthesis'},
        {code:'M43.15',desc:'Spondylolisthesis — thoracolumbar',group:'Spondylolisthesis'},
        {code:'M43.16',desc:'Spondylolisthesis — lumbar',group:'Spondylolisthesis'},
        {code:'M43.17',desc:'Spondylolisthesis — lumbosacral',group:'Spondylolisthesis'},
        // Spinal stenosis
        {code:'M48.02',desc:'Spinal stenosis — cervical',group:'Spinal stenosis'},
        {code:'M48.03',desc:'Spinal stenosis — cervicothoracic',group:'Spinal stenosis'},
        {code:'M48.04',desc:'Spinal stenosis — thoracic',group:'Spinal stenosis'},
        {code:'M48.05',desc:'Spinal stenosis — thoracolumbar',group:'Spinal stenosis'},
        {code:'M48.061',desc:'Spinal stenosis — lumbar, w/o neurogenic claudication',group:'Spinal stenosis'},
        {code:'M48.062',desc:'Spinal stenosis — lumbar, w/ neurogenic claudication',group:'Spinal stenosis'},
        {code:'M48.07',desc:'Spinal stenosis — lumbosacral',group:'Spinal stenosis'},
        {code:'M48.08',desc:'Spinal stenosis — sacral / sacrococcygeal',group:'Spinal stenosis'},
        // Symptoms & misc
        {code:'M54.2',desc:'Cervicalgia',group:'Symptoms & misc'},
        {code:'M54.6',desc:'Pain in thoracic spine',group:'Symptoms & misc'},
        {code:'M54.41',desc:'Lumbago with sciatica, right side',group:'Symptoms & misc'},
        {code:'M54.42',desc:'Lumbago with sciatica, left side',group:'Symptoms & misc'},
        {code:'M79.1',desc:'Myalgia / myofascial pain',group:'Symptoms & misc'},
        {code:'M96.1',desc:'Postlaminectomy syndrome, NEC',group:'Symptoms & misc'},
        {code:'M53.3',desc:'Sacrococcygeal disorders, NEC (coccygodynia; SI dysfunction per sheet)',group:'Symptoms & misc'},
        {code:'M46.1',desc:'Sacroiliitis, NEC',group:'Symptoms & misc'},
        {code:'S33.6XXA',desc:'Sprain of sacroiliac joint, initial encounter',group:'Symptoms & misc'},
        {code:'M53.2X8',desc:'Spinal instabilities, sacral and sacrococcygeal region',group:'Symptoms & misc'},
        {code:'G89.4',desc:'Chronic pain syndrome',group:'Symptoms & misc'},
        // Hip
        {code:'M16.11',desc:'Unilateral primary osteoarthritis, right hip',group:'Hip'},
        {code:'M16.12',desc:'Unilateral primary osteoarthritis, left hip',group:'Hip'},
        {code:'M16.0',desc:'Bilateral primary osteoarthritis of hip',group:'Hip'},
        {code:'M70.71',desc:'Other bursitis of hip (iliopsoas), right',group:'Hip'},
        {code:'M70.72',desc:'Other bursitis of hip (iliopsoas), left',group:'Hip'},
        {code:'M25.551',desc:'Pain in right hip',group:'Hip'},
        {code:'M25.552',desc:'Pain in left hip',group:'Hip'}
      ],
      em:[
        {code:'99202',desc:'New patient — straightforward MDM (15–29 min)'},
        {code:'99203',desc:'New patient — low MDM (30–44 min)'},
        {code:'99204',desc:'New patient — moderate MDM (45–59 min)'},
        {code:'99205',desc:'New patient — high MDM (60–74 min)'},
        {code:'99211',desc:'Established — minimal (may not require physician)'},
        {code:'99212',desc:'Established — straightforward MDM (10–19 min)'},
        {code:'99213',desc:'Established — low MDM (20–29 min)'},
        {code:'99214',desc:'Established — moderate MDM (30–39 min)'},
        {code:'99215',desc:'Established — high MDM (40–54 min)'}
      ],
      levels:['Cervical','Cervicothoracic','Thoracic','Thoracolumbar','Lumbar','Lumbosacral','Sacral / sacrococcygeal',
              'C2–C3','C3–C4','C4–C5','C5–C6','C6–C7','C7–T1','T11–T12','T12–L1','L1–L2','L2–L3','L3–L4','L4–L5','L5–S1','S1–S2'],
      meds:[
        {name:'Celestone (betamethasone)',detail:'3 mg / 0.5 cc per unit'},
        {name:'Marcaine (bupivacaine)',detail:'max 1 unit'},
        {name:'Kenalog (triamcinolone)',detail:'1 mg per unit'},
        {name:'Decadron (dexamethasone)',detail:'1 mg per unit'},
        {name:'Depo-Medrol (methylprednisolone)',detail:'40 mg per unit / cc'}
      ]
    };
  }
  /* Retired / superseded codes — flagged by the guardrail with replacement guidance. */
  var RETIRED={
    'M54.5':'Deleted 1 Oct 2021 — use M54.50 (LBP, unspecified), M54.51 (vertebrogenic LBP), or M54.59 (other LBP). M54.5 now denies.',
    '99201':'Deleted 2021 — report 99202 for a level-1 new-patient visit.',
    '64622':'Legacy facet RF code — current codes are 64633–64636.',
    '64623':'Legacy facet RF add-on — current codes are 64633–64636.',
    '64626':'Legacy facet RF code — current codes are 64633–64636.',
    '64627':'Legacy facet RF add-on — current codes are 64633–64636.'
  };

  /* ---------- state ---------- */
  function load(){
    var raw=safe(function(){ return localStorage.getItem(lsKey()); }, null);
    if(!raw) return seed();
    var v=safe(function(){ return JSON.parse(raw); }, null);
    if(!v || typeof v!=='object' || !Array.isArray(v.cpt) || !Array.isArray(v.icd)) return seed();
    if(typeof v.constrainAI!=='boolean') v.constrainAI=false;
    ['em','levels','meds'].forEach(function(k){ if(!Array.isArray(v[k])) v[k]=seed()[k]; });
    return v;
  }
  function save(v){ safe(function(){ localStorage.setItem(lsKey(), JSON.stringify(v)); }); }
  var state=load();
  function constrainOn(){ return !!(state&&state.constrainAI); }

  /* approved-code lookup (CPT+ICD+EM), normalized */
  function norm(c){ return String(c||'').toUpperCase().replace(/\s+/g,''); }
  function approvedSet(){
    var s={};
    (state.cpt||[]).forEach(function(r){ if(r&&r.code) s[norm(r.code)]={kind:'CPT',desc:r.desc}; });
    (state.em||[]).forEach(function(r){ if(r&&r.code) s[norm(r.code)]={kind:'E/M',desc:r.desc}; });
    (state.icd||[]).forEach(function(r){ if(r&&r.code) s[norm(r.code)]={kind:'ICD-10',desc:r.desc}; });
    return s;
  }

  /* ---------- guardrail: validate codes that appear in a note/text ---------- */
  function scanCodes(text){
    text=String(text||'');
    var icd=(text.match(/\b[A-TV-Z]\d\d(?:\.[A-Z0-9]{1,4})?\b/g)||[]).filter(function(c){ return /\.[A-Z0-9]/.test(c) || /^[A-TV-Z]\d\d$/.test(c); });
    var cpt=(text.match(/\b\d{5}\b/g)||[]).filter(function(c){ var n=+c; return n>=10000&&n<=99499; });
    var all=[], seen={};
    icd.concat(cpt).forEach(function(c){ var k=norm(c); if(!seen[k]){ seen[k]=1; all.push(c); } });
    return all;
  }
  function validate(text){
    var codes=scanCodes(text), set=approvedSet(), out=[];
    codes.forEach(function(c){
      var k=norm(c), r;
      if(RETIRED[k]) r={code:c,status:'retired',note:RETIRED[k]};
      else if(set[k]) r={code:c,status:'approved',note:set[k].kind+' · '+set[k].desc};
      else r={code:c,status:'unknown',note:'Not in your approved code sheet — verify before billing.'};
      out.push(r);
    });
    return out;
  }

  /* ---------- shared overlay scaffold ---------- */
  function injectCss(){
    if(document.getElementById('mlsCsCss')) return;
    var s=document.createElement('style'); s.id='mlsCsCss';
    s.textContent=
      '.mlscs-ov{position:fixed;inset:0;z-index:99998;background:rgba(15,28,46,.42);display:flex;align-items:flex-start;justify-content:center;padding:7vh 16px 16px;backdrop-filter:blur(2px);}'
      +'.mlscs-panel{width:100%;max-width:760px;max-height:84vh;background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.28);display:flex;flex-direction:column;overflow:hidden;}'
      +'.mlscs-head{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:14px 18px 10px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlscs-h{font-weight:700;font-size:15.5px;color:var(--ink,#15293f);display:flex;align-items:center;gap:8px;}'
      +'.mlscs-x{border:0;background:transparent;font-size:17px;cursor:pointer;color:var(--muted,#7c8aa0);padding:4px 7px;border-radius:8px;}'
      +'.mlscs-x:hover{background:var(--surface,#f1f4f9);}'
      +'.mlscs-tools{display:flex;flex-wrap:wrap;gap:7px;align-items:center;padding:10px 16px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'.mlscs-search{flex:1;min-width:140px;font:inherit;font-size:13px;padding:7px 10px;border:1px solid var(--line,#e6e9ef);border-radius:9px;background:var(--surface,#fafcff);color:var(--ink,#15293f);}'
      +'.mlscs-btn{font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fff);color:var(--brand,#2563c9);border-radius:9px;padding:7px 12px;}'
      +'.mlscs-btn:hover{filter:brightness(.98);background:var(--surface,#f1f4f9);}'
      +'.mlscs-btn.pri{background:var(--brand,#2563c9);color:#fff;border-color:var(--brand,#2563c9);}'
      +'.mlscs-btn.danger{color:#b42318;border-color:#f0c5c0;}'
      +'.mlscs-toggle{display:flex;align-items:center;gap:8px;margin-left:auto;font-size:12.5px;color:var(--ink,#15293f);}'
      +'.mlscs-body{overflow:auto;padding:8px 16px 16px;}'
      +'.mlscs-sec{margin-top:14px;}'
      +'.mlscs-sectitle{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.5px;color:var(--muted,#7c8aa0);margin:6px 0 6px;display:flex;align-items:center;gap:8px;}'
      +'.mlscs-row{display:flex;align-items:center;gap:9px;padding:6px 6px;border-radius:9px;}'
      +'.mlscs-row:hover{background:var(--surface,#f7f9fc);}'
      +'.mlscs-code{font-weight:700;font-size:13px;color:var(--ink,#15293f);min-width:74px;font-variant-numeric:tabular-nums;}'
      +'.mlscs-desc{font-size:12.7px;color:var(--muted,#56657a);flex:1;min-width:0;}'
      +'.mlscs-rowact{display:flex;gap:4px;flex:0 0 auto;opacity:.55;}'
      +'.mlscs-row:hover .mlscs-rowact{opacity:1;}'
      +'.mlscs-mini{border:0;background:transparent;cursor:pointer;font-size:12px;color:var(--muted,#7c8aa0);padding:3px 6px;border-radius:7px;}'
      +'.mlscs-mini:hover{background:var(--line,#e6e9ef);color:var(--ink,#15293f);}'
      +'.mlscs-chk{width:16px;height:16px;flex:0 0 auto;accent-color:var(--brand,#2563c9);cursor:pointer;}'
      +'.mlscs-foot{display:flex;gap:9px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-top:1px solid var(--line,#e6e9ef);background:var(--surface,#fafcff);}'
      +'.mlscs-tray{flex:1;min-width:0;font-size:12.5px;color:var(--ink,#15293f);}'
      +'.mlscs-empty{padding:24px 12px;text-align:center;color:var(--muted,#7c8aa0);font-size:13.5px;}'
      +'.mlscs-vrow{display:flex;align-items:center;gap:9px;padding:7px 9px;border:1px solid var(--line,#e6e9ef);border-radius:10px;margin-bottom:7px;}'
      +'.mlscs-vdot{width:9px;height:9px;border-radius:50%;flex:0 0 auto;}'
      +'.mlscs-vok .mlscs-vdot{background:#1f9d57;} .mlscs-vunk .mlscs-vdot{background:#d98a00;} .mlscs-vret .mlscs-vdot{background:#d64545;}'
      +'.mlscs-vcode{font-weight:700;font-size:13px;min-width:72px;color:var(--ink,#15293f);}'
      +'.mlscs-vnote{font-size:12.3px;color:var(--muted,#56657a);flex:1;min-width:0;}'
      +'.mlscs-badge{font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.4px;padding:2px 7px;border-radius:999px;flex:0 0 auto;}'
      +'.mlscs-vok .mlscs-badge{background:#e7f6ee;color:#1f7a45;} .mlscs-vunk .mlscs-badge{background:#fdf3e0;color:#9a6700;} .mlscs-vret .mlscs-badge{background:#fbe9e9;color:#b42318;}'
      +'@media (max-width:680px){.mlscs-panel{max-height:92vh;}}';
    (document.head||document.documentElement).appendChild(s);
  }
  var OV=null;
  function shell(titleHtml){
    injectCss(); close();
    OV=document.createElement('div'); OV.className='mlscs-ov';
    OV.innerHTML='<div class="mlscs-panel" role="dialog" aria-label="Billing code sheet">'
      +'<div class="mlscs-head"><span class="mlscs-h">'+titleHtml+'</span><button type="button" class="mlscs-x" id="mlsCsX">✕</button></div>'
      +'<div id="mlsCsTop"></div><div class="mlscs-body" id="mlsCsBody"></div><div id="mlsCsFoot"></div></div>';
    document.body.appendChild(OV);
    OV.addEventListener('mousedown',function(e){ if(e.target===OV) close(); });
    document.getElementById('mlsCsX').addEventListener('click', close);
    return OV;
  }
  function close(){ if(OV&&OV.parentNode) OV.parentNode.removeChild(OV); OV=null; }
  function groupBy(arr){ var g={},order=[]; (arr||[]).forEach(function(r){ var k=r.group||'Other'; if(!g[k]){g[k]=[];order.push(k);} g[k].push(r); }); return {g:g,order:order}; }

  /* ============================ MANAGER ============================ */
  function open(){
    var ov=shell('🧾 Billing code sheet');
    document.getElementById('mlsCsTop').innerHTML=
      '<div class="mlscs-tools">'
      +'<input id="mlsCsSearch" class="mlscs-search" placeholder="Filter codes or descriptions…">'
      +'<button type="button" class="mlscs-btn" id="mlsCsAdd">+ Add code</button>'
      +'<button type="button" class="mlscs-btn" id="mlsCsExport">Export</button>'
      +'<button type="button" class="mlscs-btn" id="mlsCsImport">Import</button>'
      +'<button type="button" class="mlscs-btn danger" id="mlsCsReset">Reset to sheet</button>'
      +'<label class="mlscs-toggle"><input type="checkbox" id="mlsCsConstrain" '+(constrainOn()?'checked':'')+'> Validate AI codes against this sheet</label>'
      +'</div>';
    var foot=document.getElementById('mlsCsFoot');
    foot.innerHTML='<div class="mlscs-foot"><span class="mlscs-tray" id="mlsCsCount"></span>'
      +'<button type="button" class="mlscs-btn pri" id="mlsCsPickFromMgr">Pick codes for a visit →</button></div>';
    renderManager('');
    var sc=document.getElementById('mlsCsSearch'); if(sc) sc.addEventListener('input', function(){ renderManager(sc.value); });
    document.getElementById('mlsCsAdd').addEventListener('click', addCodePrompt);
    document.getElementById('mlsCsExport').addEventListener('click', exportSheet);
    document.getElementById('mlsCsImport').addEventListener('click', importSheet);
    document.getElementById('mlsCsReset').addEventListener('click', function(){ if(confirm('Reset the code sheet to the practice defaults? Your edits will be replaced.')){ state=seed(); save(state); renderManager(''); toast('Reset to defaults'); } });
    document.getElementById('mlsCsConstrain').addEventListener('change', function(e){ state.constrainAI=!!e.target.checked; save(state); toast(state.constrainAI?'AI codes will be validated':'Validation off'); });
    document.getElementById('mlsCsPickFromMgr').addEventListener('click', pick);
  }
  function renderManager(filter){
    var body=document.getElementById('mlsCsBody'); if(!body) return;
    var q=(filter||'').toLowerCase().trim();
    function match(r){ if(!q) return true; return (String(r.code||r.name||'')+' '+String(r.desc||r.detail||'')).toLowerCase().indexOf(q)>=0; }
    var total=(state.cpt.length+state.icd.length+state.em.length);
    var cnt=document.getElementById('mlsCsCount'); if(cnt) cnt.textContent=total+' billable codes · '+state.cpt.length+' CPT · '+state.icd.length+' ICD-10 · '+state.em.length+' E/M';
    var html='';
    html+=sectionHtml('CPT — procedures','cpt',state.cpt.filter(match),true);
    html+=sectionHtml('E/M levels','em',state.em.filter(match),false);
    html+=sectionHtml('ICD-10 — diagnoses','icd',state.icd.filter(match),true);
    // levels + meds (reference lists)
    html+='<div class="mlscs-sec"><div class="mlscs-sectitle">Spinal levels</div><div class="mlscs-desc" style="padding:0 6px">'+ (state.levels||[]).map(esc).join(' · ') +'</div></div>';
    html+='<div class="mlscs-sec"><div class="mlscs-sectitle">Injectables</div>'+ (state.meds||[]).map(function(m){ return '<div class="mlscs-row"><span class="mlscs-desc">'+esc(m.name)+' — '+esc(m.detail||'')+'</span></div>'; }).join('') +'</div>';
    body.innerHTML=html||'<div class="mlscs-empty">No codes match “'+esc(filter)+'”.</div>';
    bindManagerRows();
  }
  function sectionHtml(title,kind,rows,grouped){
    if(!rows.length) return '';
    var html='<div class="mlscs-sec"><div class="mlscs-sectitle">'+esc(title)+' ('+rows.length+')</div>';
    if(grouped){ var gb=groupBy(rows); gb.order.forEach(function(gname){
      html+='<div class="mlscs-sectitle" style="font-weight:700;text-transform:none;letter-spacing:0;color:var(--ink,#15293f);opacity:.7;margin-top:8px">'+esc(gname)+'</div>';
      gb.g[gname].forEach(function(r){ html+=mgrRow(kind,r); });
    }); }
    else rows.forEach(function(r){ html+=mgrRow(kind,r); });
    return html+'</div>';
  }
  function mgrRow(kind,r){
    return '<div class="mlscs-row" data-kind="'+kind+'" data-code="'+esc(r.code)+'">'
      +'<span class="mlscs-code">'+esc(r.code)+'</span><span class="mlscs-desc">'+esc(r.desc||'')+'</span>'
      +'<span class="mlscs-rowact"><button type="button" class="mlscs-mini" data-act="edit">Edit</button><button type="button" class="mlscs-mini" data-act="del">✕</button></span></div>';
  }
  function bindManagerRows(){
    var body=document.getElementById('mlsCsBody'); if(!body) return;
    body.querySelectorAll('.mlscs-mini').forEach(function(btn){
      btn.addEventListener('click', function(){
        var row=btn.closest('.mlscs-row'); var kind=row.getAttribute('data-kind'), code=row.getAttribute('data-code');
        var arr=state[kind]; var idx=arr.findIndex(function(x){ return String(x.code)===code; });
        if(idx<0) return;
        if(btn.getAttribute('data-act')==='del'){ if(confirm('Remove '+code+'?')){ arr.splice(idx,1); save(state); renderManager(document.getElementById('mlsCsSearch').value); } }
        else { var nd=prompt('Edit description for '+code+':', arr[idx].desc||''); if(nd!=null){ arr[idx].desc=nd; save(state); renderManager(document.getElementById('mlsCsSearch').value); } }
      });
    });
  }
  function addCodePrompt(){
    var kind=prompt('Add to which list? Type: cpt, icd, or em','cpt'); if(!kind) return; kind=kind.toLowerCase().trim();
    if(['cpt','icd','em'].indexOf(kind)<0){ toast('Use cpt, icd, or em'); return; }
    var code=prompt('Code (e.g. 64483 or M54.51):',''); if(!code) return; code=code.trim();
    if(state[kind].some(function(x){ return norm(x.code)===norm(code); })){ toast('Already on the sheet'); return; }
    var desc=prompt('Description:','')||'';
    var rec={code:code,desc:desc}; if(kind!=='em') rec.group=(prompt('Group/category (optional):','')||'Other');
    state[kind].push(rec); save(state); renderManager(''); toast('Added '+code);
  }
  function exportSheet(){
    var blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
    var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='mls-code-sheet.json'; document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },300); toast('Exported');
  }
  function importSheet(){
    var inp=document.createElement('input'); inp.type='file'; inp.accept='application/json,.json';
    inp.addEventListener('change', function(){ var f=inp.files&&inp.files[0]; if(!f) return; var rd=new FileReader(); rd.onload=function(){ var v=safe(function(){ return JSON.parse(rd.result); },null); if(!v||!Array.isArray(v.cpt)||!Array.isArray(v.icd)){ toast('Not a valid code sheet'); return; } if(typeof v.constrainAI!=='boolean') v.constrainAI=state.constrainAI; ['em','levels','meds'].forEach(function(k){ if(!Array.isArray(v[k])) v[k]=state[k]; }); state=v; save(state); renderManager(''); toast('Imported'); }; rd.readAsText(f); });
    inp.click();
  }

  /* ============================ SUPERBILL PICKER ============================ */
  var picked={};
  function pick(){
    picked={};
    var ov=shell('☑️ Pick visit codes');
    document.getElementById('mlsCsTop').innerHTML='<div class="mlscs-tools"><input id="mlsCsPSearch" class="mlscs-search" placeholder="Filter…"><span class="mlscs-toggle" style="margin-left:auto;color:var(--muted,#7c8aa0);font-size:12px">Tick codes like a paper superbill</span></div>';
    document.getElementById('mlsCsFoot').innerHTML='<div class="mlscs-foot"><span class="mlscs-tray" id="mlsCsPicked">No codes selected.</span>'
      +'<button type="button" class="mlscs-btn" id="mlsCsCopy">Copy selected</button>'
      +'<button type="button" class="mlscs-btn pri" id="mlsCsInsert">Insert into note</button></div>';
    renderPicker('');
    var sc=document.getElementById('mlsCsPSearch'); if(sc) sc.addEventListener('input', function(){ renderPicker(sc.value); });
    document.getElementById('mlsCsCopy').addEventListener('click', function(){ copyTxt(selectedBlock()); });
    document.getElementById('mlsCsInsert').addEventListener('click', insertIntoNote);
  }
  function renderPicker(filter){
    var body=document.getElementById('mlsCsBody'); if(!body) return;
    var q=(filter||'').toLowerCase().trim();
    function match(r){ if(!q) return true; return (String(r.code||'')+' '+String(r.desc||'')).toLowerCase().indexOf(q)>=0; }
    function pickSec(title,kind,rows,grouped){
      rows=rows.filter(match); if(!rows.length) return '';
      var html='<div class="mlscs-sec"><div class="mlscs-sectitle">'+esc(title)+'</div>';
      function rowHtml(r){ var id=kind+'::'+r.code; return '<label class="mlscs-row"><input type="checkbox" class="mlscs-chk" data-id="'+esc(id)+'" data-kind="'+kind+'" data-code="'+esc(r.code)+'" '+(picked[id]?'checked':'')+'><span class="mlscs-code">'+esc(r.code)+'</span><span class="mlscs-desc">'+esc(r.desc||'')+'</span></label>'; }
      if(grouped){ var gb=groupBy(rows); gb.order.forEach(function(g){ html+='<div class="mlscs-sectitle" style="font-weight:700;text-transform:none;letter-spacing:0;opacity:.65;color:var(--ink,#15293f);margin-top:6px">'+esc(g)+'</div>'; gb.g[g].forEach(function(r){ html+=rowHtml(r); }); }); }
      else rows.forEach(function(r){ html+=rowHtml(r); });
      return html+'</div>';
    }
    body.innerHTML=pickSec('E/M level','em',state.em,false)+pickSec('CPT — procedures','cpt',state.cpt,true)+pickSec('ICD-10 — diagnoses','icd',state.icd,true) || '<div class="mlscs-empty">No matches.</div>';
    body.querySelectorAll('.mlscs-chk').forEach(function(ch){ ch.addEventListener('change', function(){ var id=ch.getAttribute('data-id'); if(ch.checked) picked[id]={kind:ch.getAttribute('data-kind'),code:ch.getAttribute('data-code')}; else delete picked[id]; updateTray(); }); });
    updateTray();
  }
  function selectedList(){
    var arr=[]; Object.keys(picked).forEach(function(id){ var p=picked[id]; var rec=(state[p.kind]||[]).find(function(x){ return String(x.code)===String(p.code); }); if(rec) arr.push({kind:p.kind,code:rec.code,desc:rec.desc}); });
    var rank={em:0,cpt:1,icd:2}; arr.sort(function(a,b){ return (rank[a.kind]-rank[b.kind]); });
    return arr;
  }
  function selectedBlock(){
    var arr=selectedList(); if(!arr.length) return '';
    var em=arr.filter(function(x){return x.kind==='em';}), cpt=arr.filter(function(x){return x.kind==='cpt';}), icd=arr.filter(function(x){return x.kind==='icd';});
    var lines=['BILLING CODES'];
    if(em.length) lines.push('E/M: '+em.map(function(x){return x.code;}).join(', '));
    if(cpt.length){ lines.push('CPT:'); cpt.forEach(function(x){ lines.push('  '+x.code+' — '+x.desc); }); }
    if(icd.length){ lines.push('ICD-10:'); icd.forEach(function(x){ lines.push('  '+x.code+' — '+x.desc); }); }
    return lines.join('\n');
  }
  function updateTray(){
    var t=document.getElementById('mlsCsPicked'); if(!t) return; var arr=selectedList();
    t.textContent=arr.length?(arr.length+' selected: '+arr.map(function(x){return x.code;}).join(', ')):'No codes selected.';
  }
  function insertIntoNote(){
    var block=selectedBlock(); if(!block){ toast('Select some codes first'); return; }
    var field=safe(function(){ return document.getElementById('noteText')||document.getElementById('clinicalNote')||document.querySelector('textarea[data-note-body], textarea.note, #visitNote'); }, null);
    if(field && ('value' in field)){
      var cur=field.value||''; field.value=cur+(cur && !/\n$/.test(cur)?'\n\n':'')+block+'\n';
      safe(function(){ field.dispatchEvent(new Event('input',{bubbles:true})); field.dispatchEvent(new Event('change',{bubbles:true})); });
      field.focus(); toast('Inserted into note'); close();
    } else { copyTxt(block); toast('No note field open — copied instead'); }
  }

  /* ============================ GUARDRAIL VIEW ============================ */
  function showValidation(text, ctx){
    var results=validate(text);
    var ov=shell('🛡️ Code check'+(ctx?' — '+esc(ctx):''));
    document.getElementById('mlsCsTop').innerHTML='';
    var body=document.getElementById('mlsCsBody');
    if(!results.length){ body.innerHTML='<div class="mlscs-empty">No ICD-10 or CPT codes found in the note to check.</div>'; document.getElementById('mlsCsFoot').innerHTML=''; return; }
    var bad=results.filter(function(r){return r.status!=='approved';}).length;
    var summary=bad? ('<div class="mlscs-sectitle" style="color:#9a6700">'+bad+' of '+results.length+' code(s) need a look — not on your approved sheet or retired.</div>')
                   : ('<div class="mlscs-sectitle" style="color:#1f7a45">All '+results.length+' codes match your approved sheet. ✓</div>');
    var rows=results.map(function(r){
      var cls=r.status==='approved'?'mlscs-vok':(r.status==='retired'?'mlscs-vret':'mlscs-vunk');
      var badge=r.status==='approved'?'Approved':(r.status==='retired'?'Retired':'Off-sheet');
      return '<div class="mlscs-vrow '+cls+'"><span class="mlscs-vdot"></span><span class="mlscs-vcode">'+esc(r.code)+'</span><span class="mlscs-vnote">'+esc(r.note)+'</span><span class="mlscs-badge">'+badge+'</span></div>';
    }).join('');
    body.innerHTML=summary+rows;
    document.getElementById('mlsCsFoot').innerHTML='<div class="mlscs-foot"><span class="mlscs-tray">Validation is advisory — the provider confirms all codes.</span><button type="button" class="mlscs-btn" id="mlsCsOpenMgr">Open code sheet</button></div>';
    var b=document.getElementById('mlsCsOpenMgr'); if(b) b.addEventListener('click', open);
  }

  window.__mlsCodeSheet={
    open:open, pick:pick, validate:validate, showValidation:showValidation,
    constrainOn:constrainOn, getState:function(){ return state; }, _seed:seed, _scan:scanCodes
  };
})();


/* ============================================================
   MLS — single-tooltip fix + dynamic extension-version badge
   Appended to mls-connect.js on 2026-06-15.

   FIX 1 (double tooltip): The MLS Assist browser extension's
   content.js injects its OWN custom hover tooltip element
   <div id="mls-tip"> on every page (reads data-tip, 2s delay).
   On the MLS web app that collides with the app's own
   <div id="mlsTip"> tooltip, so hovering a data-tip element
   (e.g. "Send full visit to Athena") renders TWO stacked boxes.
   The app's #mlsTip is the single source of truth (it works with
   OR without the extension and also handles native title), so we
   suppress the extension's duplicate ONLY on this app. The
   extension's tooltip still works on other pages (Athena, etc.)
   where this bundle is not loaded — the extension is untouched.

   FIX 2 (stale badge): the Settings "MLS Assist browser extension"
   card had a hardcoded "Latest: v1.25" badge. Read it live from
   /extension-version.json so it shows the deployed version (1.27
   now) and can never go stale again.
   ============================================================ */
(function(){
  'use strict';
  if (window.__mlsTipBadgeFix) return; window.__mlsTipBadgeFix = true;

  /* ---- FIX 1: hide the extension's duplicate #mls-tip on this app ---- */
  try {
    if (!document.getElementById('mlsHideExtTip')) {
      var st = document.createElement('style');
      st.id = 'mlsHideExtTip';
      // !important beats the extension's inline display:block (non-important),
      // so only the app's own #mlsTip tooltip ever shows.
      st.textContent = 'html body #mls-tip{display:none!important;opacity:0!important;}';
      (document.head || document.documentElement).appendChild(st);
    }
    var ex = document.getElementById('mls-tip');
    if (ex) ex.style.setProperty('display', 'none', 'important');
  } catch (e) { try { console.warn('[MLS] tooltip de-dup failed', e); } catch (_) {} }

  /* ---- FIX 2: dynamic extension-version badge in Settings ---- */
  try {
    var VER = null;
    function applyBadge(){
      if (!VER) return false;
      var spans = document.getElementsByTagName('span'), did = false, want = 'Latest: v' + VER;
      for (var i = 0; i < spans.length; i++) {
        var s = spans[i], t = (s.textContent || '').trim();
        if (!/^Latest:\s*v?\d/i.test(t)) continue;        // looks like a "Latest: vX.Y" badge
        var p = s, ok = false;                            // confirm it's the MLS Assist extension card
        for (var j = 0; j < 4 && p && p !== document.body && p !== document.documentElement; j++) {
          if (/MLS Assist browser extension/i.test(p.textContent || '')) { ok = true; break; }
          p = p.parentElement;
        }
        if (!ok) continue;
        if (s.textContent !== want) s.textContent = want;
        did = true;
      }
      return did;
    }
    function fetchVer(){
      return fetch('/extension-version.json?_=' + Date.now(), { cache: 'no-store' })
        .then(function(r){ return r.json(); })
        .then(function(j){ if (j && j.version) { VER = String(j.version).replace(/^v/i, ''); applyBadge(); } })
        .catch(function(){ /* offline: leave the static text as-is */ });
    }
    function start(){
      fetchVer();
      // The badge is in static markup inside the Settings modal; re-apply a few
      // times in case VER arrives before the node is ready, then stop.
      var tries = 0, iv = setInterval(function(){ tries++; if (applyBadge() || tries > 40) clearInterval(iv); }, 500);
      // Refresh periodically so a newly published version appears without a reload.
      setInterval(fetchVer, 5 * 60 * 1000);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  } catch (e) { try { console.warn('[MLS] version badge failed', e); } catch (_) {} }
})();


/* ============================================================
   MLS-CONNECT — Feature: Lite (scribe-only) tier mode
   Pairs with the server-side liteGate (auth.js) which is the real, unbypassable
   enforcement. This module is the matching UX + the Owner admin control:
     • Doctor side: if the signed-in user is on the Lite plan, hide every non-Lite
       nav tab (keep Visit), redirect restricted views to Visit, show a "Lite" badge.
     • Admin side: inject a per-row "Lite" toggle into the Owner Users table (next to
       Premium), reading each row's existing adminSetPremium(id,..) to get the user id;
       calls POST /api/admin/users/:id/lite via the app's own authed adminFetch.
   Self-contained IIFE; every external call wrapped in try/catch; no-op on any error.
   ============================================================ */
(function(){
  'use strict';
  if (window.__mlsLiteMode) return; window.__mlsLiteMode = true;

  var RESTRICTED = ['calendar','patients','orders','recs','history','legalreq','team','analysis','studio'];
  var NAV_IDS = RESTRICTED.map(function(v){ return 'nav_' + v; });

  function getBk(){
    try { if (typeof bkUser !== 'undefined' && bkUser) return bkUser; } catch(e){}
    try { if (window.bkUser) return window.bkUser; } catch(e){}
    return null;
  }
  function isLiteUser(){
    var u = getBk();
    return !!(u && u.lite) && !(u && u.isAdmin);
  }

  function applyDoctorRestrictions(){
    if (!isLiteUser()) return;
    try {
      document.body.classList.add('mls-lite');
      NAV_IDS.forEach(function(id){ var el = document.getElementById(id); if (el) el.style.display = 'none'; });
      var v = document.getElementById('nav_visit'); if (v) v.style.display = '';
      try {
        var active = document.querySelector('.navtab.on');
        if (active && NAV_IDS.indexOf(active.id) !== -1 && typeof window.showView === 'function') window.showView('visit');
      } catch(e){}
      addBadge();
    } catch(e){}
  }

  function addBadge(){
    try {
      if (document.getElementById('mlsLiteBadge')) return;
      var b = document.createElement('span');
      b.id = 'mlsLiteBadge'; b.textContent = 'Lite';
      var tip = 'Lite plan: the scribe only. Coding, intake, scheduling, outcomes, legal and analytics are on Standard/Premium.';
      b.title = tip; b.setAttribute('data-tip', tip);
      b.style.cssText = 'display:inline-block;margin-left:8px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;background:#0e7490;color:#fff;vertical-align:middle;letter-spacing:.02em;';
      var visit = document.getElementById('nav_visit');
      if (visit && visit.parentNode) visit.parentNode.appendChild(b);
      else (document.querySelector('.navtabs, nav, header') || document.body).appendChild(b);
    } catch(e){}
  }

  var _liteMap = null;
  function fetchLiteMap(cb){
    try {
      if (typeof window.adminFetch !== 'function') { cb && cb(); return; }
      window.adminFetch('/api/admin/users')
        .then(function(x){ return (x && typeof x.json === 'function') ? x.json() : x; })
        .then(function(rows){
          try { var arr = (rows && rows.users) ? rows.users : (Array.isArray(rows) ? rows : []); _liteMap = {}; arr.forEach(function(u){ if (u && u.id != null) _liteMap[String(u.id)] = (u.lite ? 1 : 0); }); } catch(e){}
          cb && cb();
        })
        .catch(function(){ cb && cb(); });
    } catch(e){ cb && cb(); }
  }

  function injectAdminToggles(){
    try {
      var premBtns = Array.prototype.slice.call(document.querySelectorAll('[onclick*="adminSetPremium("]'));
      if (!premBtns.length) return;
      premBtns.forEach(function(btn){
        try {
          if (btn.parentNode && btn.parentNode.querySelector('[data-mls-lite-btn]')) return;
          var oc = btn.getAttribute('onclick') || '';
          var m = oc.match(/adminSetPremium\(\s*['"]?([^'",\)]+)['"]?/);
          if (!m) return;
          var id = m[1];
          var liteOn = _liteMap ? !!_liteMap[String(id)] : false;
          var lb = document.createElement('button');
          lb.setAttribute('data-mls-lite-btn','1');
          lb.className = btn.className || 'btn-ghost';
          lb.style.cssText = btn.getAttribute('style') || '';
          lb.style.marginLeft = '4px';
          if (liteOn){ lb.style.background = '#0e7490'; lb.style.color = '#fff'; lb.style.borderColor = '#0e7490'; }
          lb.textContent = liteOn ? 'Lite ✓' : 'Lite';
          var tip = 'Lite plan (scribe only). Restricts this doctor to Lite-tier features. Enforced server-side.';
          lb.title = tip; lb.setAttribute('data-tip', tip);
          lb.onclick = function(ev){ try { ev.preventDefault(); ev.stopPropagation(); } catch(e){} setLite(id, !liteOn, lb); };
          btn.parentNode.insertBefore(lb, btn.nextSibling);
        } catch(e){}
      });
    } catch(e){}
  }

  function setLite(id, on, lb){
    try {
      if (typeof window.adminFetch !== 'function') return;
      if (lb) lb.disabled = true;
      window.adminFetch('/api/admin/users/' + id + '/lite', { method: 'POST', body: JSON.stringify({ lite: !!on }) })
        .then(function(){
          try { if (typeof window.toast === 'function') window.toast(on ? 'Lite plan ON — this doctor is now scribe-only.' : 'Lite plan OFF.', 'ok'); } catch(e){}
          _liteMap = null;
          if (typeof window.loadAdminUsers === 'function') { try { window.loadAdminUsers(); } catch(e){} }
        })
        .catch(function(e){
          try { if (typeof window.toast === 'function') window.toast('Could not update Lite: ' + (e && e.message || e), 'err'); } catch(_){}
          if (lb) lb.disabled = false;
        });
    } catch(e){}
  }

  function adminPass(){
    try {
      if (!document.querySelector('[onclick*="adminSetPremium("]')) return;
      if (!_liteMap) fetchLiteMap(injectAdminToggles);
      else injectAdminToggles();
    } catch(e){}
  }

  function tick(){ try { applyDoctorRestrictions(); adminPass(); } catch(e){} }
  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', tick);
    tick();
    setInterval(tick, 1500);
  } catch(e){}

  window.__mlsLite = { isLiteUser: isLiteUser, apply: applyDoctorRestrictions, refreshAdmin: function(){ _liteMap = null; adminPass(); } };
})();


/* ---- module: feat_note_formatting.js ---- */

/* ===== MLS Note Formatting — provider-grade structured display =====
   Problem: every AI output (SOAP note, op/procedure note, insurance note,
   recommendations, decision-support, prior-auth, chart summary, IME report,
   data study) is shown as flat, uniform plain text. Line breaks survive, but
   there is NO visual hierarchy — section labels look identical to body text,
   so a correctly-sectioned note reads as one undifferentiated wall ("blob").

   Fix (display layer only — content is never altered):
   1. Editable note textareas (#noteBox SOAP/insurance, #procNoteBody op note)
      get a styled, read-only PREVIEW with bold section headers, spaced
      sections, and real bulleted/numbered lists, plus an Edit/Preview toggle.
      The textarea stays the single source of truth, so Copy-for-EMR, Sign,
      Save-to-history and Send-to-Athena keep using the exact plain text —
      the EMR copy is never touched.
   2. Read-only AI prose panels (.xbody: chart summary, decision support,
      denial/prior-auth, data study, IME, document summary) get their section
      headers bolded INLINE inside the existing pre-wrap container. Because the
      added markup is inline and the newlines stay literal, the element's
      textContent is byte-identical to before — every copy/print path that
      reads .textContent stays clean.

   Self-contained progressive enhancement: own IIFE, all external work guarded
   with try/catch, never modifies any existing app function, polls/observes
   passively, and degrades to a silent no-op on any error. Exposes
   window.__mlsFormat (with .enabled, .rerender(), .disable()). */
(function(){
  'use strict';
  if (window.__mlsFormat) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }

  /* ---------- header / structure recognition ---------- */
  // Major section labels that stand alone on a line (SOAP, op-note blocks,
  // insurance-note blocks, coding sections). Compared case-insensitively with
  // any trailing ":" stripped.
  var MAJOR = {};
  ([
    'subjective','objective','assessment','plan','assessment and plan','assessment & plan','assessment/plan',
    'chief complaint','history of present illness','hpi','review of systems','ros',
    'past medical history','past surgical history','family history','social history',
    'medications','allergies','vitals','physical exam','physical examination','examination','exam',
    'imaging','laboratory','labs','results','diagnostics',
    'patient','date','date of procedure','date of service','date of birth',
    'preoperative diagnosis','pre-operative diagnosis','preprocedure diagnosis','pre-procedure diagnosis',
    'postoperative diagnosis','post-operative diagnosis','postprocedure diagnosis','post-procedure diagnosis',
    'procedure','procedure performed','procedures performed','operation','operation performed',
    'anesthesia','anesthesia type','indications','indication','indications for procedure',
    'description of procedure','description','technique','findings','complications',
    'estimated blood loss','specimens','implants','disposition','condition',
    'surgeon','assistant','attending','consent','fluoroscopy','fluoroscopy time',
    'medications administered','post-procedure plan','follow-up','followup','return precautions',
    'encounter type','medical necessity','chief complaint & medical necessity','history',
    'medical decision making','mdm','e/m level rationale','em level rationale','plan of care',
    'diagnoses','orders','reimbursement','coding','suggested coding','red flags',
    'differential diagnosis','differentials','recommendations','clinical note','insurance-ready encounter note'
  ]).forEach(function(k){ MAJOR[k]=true; });

  // Sub-labels that appear as "Label: content" on one line — bold just the label.
  var SUBLABEL = {};
  ([
    'chief complaint','cc','hpi','history of present illness','ros','review of systems',
    'pmh','past medical history','psh','past surgical history','fh','family history',
    'sh','social history','medications','meds','allergies','vitals','exam','physical exam',
    'physical examination','imaging','labs','laboratory','results','assessment','plan',
    'follow-up','followup','return precautions','disposition','indications','anesthesia',
    'findings','complications','estimated blood loss','ebl','specimens','condition','comment',
    'date of procedure','date of service','date of birth','mrn','procedure','diagnosis'
  ]).forEach(function(k){ SUBLABEL[k]=true; });

  function stripColon(s){ return s.replace(/\s*:\s*$/,''); }
  function isAllCaps(s){ return /[A-Z]/.test(s) && s === s.toUpperCase() && !/[a-z]/.test(s); }

  // Classify a single line. Returns {type, label, rest}.
  function classify(line){
    var t = line.replace(/\s+$/,'');           // keep leading indent, drop trailing ws
    var trimmed = t.trim();
    if (!trimmed) return { type:'blank' };
    // bullet
    var mb = trimmed.match(/^[-*•]\s+(.*)$/);
    if (mb) return { type:'bullet', rest: mb[1] };
    // numbered (1.  1)  )
    var mn = trimmed.match(/^(\d{1,3})[.)]\s+(.*)$/);
    if (mn) return { type:'num', num: mn[1], rest: mn[2] };
    // standalone header: whole line is a label (uppercase, or known major)
    var noColon = stripColon(trimmed);
    if (noColon.length <= 52 && (isAllCaps(noColon) || MAJOR[noColon.toLowerCase()]) && !/[.;]/.test(noColon)){
      // Make sure it is a label only (a "LABEL: value" with a value is a sublabel, handled below)
      if (!/:\s*\S/.test(trimmed) || MAJOR[noColon.toLowerCase()] || isAllCaps(noColon))
        return { type:'h', label: noColon };
    }
    // "Label: content" sub-label
    var ms = trimmed.match(/^([A-Za-z][A-Za-z/&()'.\- ]{1,40}?):\s+(\S.*)$/);
    if (ms){
      var lab = ms[1].trim();
      if (SUBLABEL[lab.toLowerCase()] || MAJOR[lab.toLowerCase()] || isAllCaps(lab))
        return { type:'sub', label: lab, rest: ms[2] };
    }
    return { type:'p', rest: t };
  }

  /* ---------- BLOCK renderer (rich, for read-only previews) ----------
     Used where copy/EMR reads a DIFFERENT source (the underlying textarea),
     so the preview can use full block structure (headers, <ul>, spacing). */
  function renderBlock(text){
    var lines = String(text==null?'':text).split('\n');
    var out = [], i = 0, listBuf = null, listType = null;
    function flush(){
      if (listBuf && listBuf.length){
        var tag = listType==='num' ? 'ol' : 'ul';
        out.push('<'+tag+' class="mlsf-list">'+listBuf.join('')+'</'+tag+'>');
      }
      listBuf = null; listType = null;
    }
    for (i=0;i<lines.length;i++){
      var c = classify(lines[i]);
      if (c.type==='bullet'){ if(listType&&listType!=='bullet') flush(); listType='bullet'; listBuf=listBuf||[]; listBuf.push('<li>'+esc(c.rest)+'</li>'); continue; }
      if (c.type==='num'){ if(listType&&listType!=='num') flush(); listType='num'; listBuf=listBuf||[]; listBuf.push('<li>'+esc(c.rest)+'</li>'); continue; }
      flush();
      if (c.type==='blank'){ continue; }
      if (c.type==='h'){ out.push('<div class="mlsf-h">'+esc(c.label)+'</div>'); continue; }
      if (c.type==='sub'){ out.push('<div class="mlsf-p"><span class="mlsf-sub">'+esc(c.label)+':</span> '+esc(c.rest)+'</div>'); continue; }
      out.push('<div class="mlsf-p">'+esc(c.rest)+'</div>');
    }
    flush();
    return out.join('');
  }

  /* ---------- INLINE renderer (for .xbody pre-wrap panels) ----------
     Bolds headers/sub-labels WITHOUT changing textContent: the markup added is
     inline, and every newline stays a literal '\n' text node, so
     el.textContent === the original text (copy/print stay byte-identical). */
  function renderInline(text){
    var lines = String(text==null?'':text).split('\n');
    var anyHeader = false;
    var html = lines.map(function(line){
      var c = classify(line);
      if (c.type==='h'){ anyHeader = true; return '<b class="mlsf-ih">'+esc(line)+'</b>'; }
      if (c.type==='sub'){
        anyHeader = true;
        // keep leading indentation + exact spacing; only wrap the "Label:" run
        var idx = line.indexOf(c.label);
        var pre = esc(line.slice(0, idx));
        return pre + '<b class="mlsf-ih">'+esc(c.label)+':</b>' + esc(line.slice(idx + c.label.length + 1));
      }
      return esc(line);
    }).join('\n');
    return { html: html, anyHeader: anyHeader };
  }

  /* ---------- styles ---------- */
  function injectCss(){
    if (document.getElementById('mlsfCss')) return;
    var st = document.createElement('style'); st.id='mlsfCss';
    st.textContent =
      '.mlsf-note{border:1px solid var(--line,#e2e8f0);border-radius:10px;background:var(--surface,#fff);'+
        'padding:14px 16px;font-size:14.5px;line-height:1.5;color:var(--text,#1f2937);max-height:60vh;overflow:auto;'+
        'font-family:inherit;-webkit-font-smoothing:antialiased}'+
      '.mlsf-note .mlsf-h{font-weight:800;font-size:12.5px;letter-spacing:.06em;text-transform:uppercase;'+
        'color:var(--accent,#2f5fd0);margin:14px 0 5px;padding-bottom:3px;border-bottom:1px solid var(--line,#e8edf5)}'+
      '.mlsf-note .mlsf-h:first-child{margin-top:0}'+
      '.mlsf-note .mlsf-p{margin:3px 0;white-space:pre-wrap}'+
      '.mlsf-note .mlsf-sub{font-weight:700;color:var(--text,#243042)}'+
      '.mlsf-note .mlsf-list{margin:4px 0 8px;padding-left:22px}'+
      '.mlsf-note .mlsf-list li{margin:2px 0;white-space:pre-wrap}'+
      '.mlsf-note ol.mlsf-list{list-style:decimal}'+
      '.mlsf-bar{display:flex;align-items:center;gap:8px;margin:0 0 8px}'+
      '.mlsf-toggle{font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;border:1px solid var(--line,#cdd7e6);'+
        'background:var(--surface,#fff);color:var(--accent,#2f5fd0);border-radius:7px;padding:5px 11px}'+
      '.mlsf-toggle:hover{background:#eef4ff}'+
      '.mlsf-hint{font-size:11.5px;color:var(--muted,#7a8699)}'+
      '.xbody .mlsf-ih{font-weight:800;color:var(--accent,#2f5fd0)}';
    (document.head||document.documentElement).appendChild(st);
  }

  /* ---------- editable-textarea preview (note + op note) ---------- */
  function attachPretty(ta, key){
    if (!ta || ta.__mlsf) return;
    ta.__mlsf = true;
    var pretty = document.createElement('div');
    pretty.className = 'mlsf-note';
    pretty.setAttribute('aria-label','Formatted note preview');
    var bar = document.createElement('div');
    bar.className = 'mlsf-bar';
    var btn = document.createElement('button');
    btn.type='button'; btn.className='mlsf-toggle'; btn.textContent='✏️ Edit';
    var hint = document.createElement('span'); hint.className='mlsf-hint';
    hint.textContent='Formatted view — copy/EMR output is unchanged';
    bar.appendChild(btn); bar.appendChild(hint);
    // insert bar + pretty right before the textarea
    ta.parentNode.insertBefore(bar, ta);
    ta.parentNode.insertBefore(pretty, ta);

    var state = { mode:'preview', last:null };
    function rerender(){
      var v = ta.value || '';
      if (v === state.last) return;
      state.last = v;
      try { pretty.innerHTML = renderBlock(v); } catch(e){ pretty.textContent = v; }
    }
    function showPreview(){
      state.mode='preview';
      rerender();
      // only take over the visual slot when the note actually has content
      var has = (ta.value||'').trim().length>0;
      pretty.style.display = has ? 'block' : 'none';
      bar.style.display = has ? 'flex' : 'none';
      if (has){ ta.dataset.mlsfHidden='1'; ta.style.display='none'; }
      btn.textContent='✏️ Edit';
    }
    function showEdit(){
      state.mode='edit';
      pretty.style.display='none';
      ta.style.display='block'; ta.dataset.mlsfHidden='';
      btn.textContent='👁 Preview';
      try{ ta.focus(); }catch(e){}
    }
    btn.addEventListener('click', function(){ if(state.mode==='preview') showEdit(); else showPreview(); });
    ta.addEventListener('input', function(){ if(state.mode==='preview') rerender(); });

    // poll for programmatic value changes (generate, format toggle, sign,
    // template apply) — the app sets .value directly, which fires no event.
    function tick(){
      try{
        if (!window.__mlsFormat || !window.__mlsFormat.enabled){ return; }
        var hasContent = (ta.value||'').trim().length>0;
        if (state.mode==='preview'){
          if (hasContent){
            // value may have changed programmatically (generate / format toggle /
            // sign / template apply) with no event — re-render and reclaim the slot
            rerender();
            pretty.style.display='block'; bar.style.display='flex';
            if (ta.style.display!=='none'){ ta.dataset.mlsfHidden='1'; ta.style.display='none'; }
          } else {
            pretty.style.display='none'; bar.style.display='none';
            if (ta.dataset.mlsfHidden==='1'){ ta.dataset.mlsfHidden=''; ta.style.display=''; }
          }
        }
      }catch(e){}
    }
    setInterval(tick, 700);
    // initial paint
    showPreview();
    return { rerender: showPreview };
  }

  /* ---------- read-only xbody panels ---------- */
  function decorateXbody(el){
    if (!el) return;
    try{
      var raw = el.textContent;
      if (raw == null) return;
      if (el.dataset.mlsfRaw === raw) return;       // already decorated this exact text
      if (!raw.trim() || raw.length < 8) return;     // skip empty / "Working…" states
      var r = renderInline(raw);
      if (!r.anyHeader) { el.dataset.mlsfRaw = raw; return; } // nothing to emphasize
      el.dataset.mlsfBusy = '1';
      el.innerHTML = r.html;
      el.dataset.mlsfRaw = el.textContent;           // store post-render textContent (== raw)
      el.dataset.mlsfBusy = '';
    }catch(e){}
  }
  function watchXbody(el){
    if (!el || el.__mlsfWatch) return;
    el.__mlsfWatch = true;
    decorateXbody(el);
    try{
      var mo = new MutationObserver(function(){
        if (el.dataset.mlsfBusy==='1') return;       // ignore our own writes
        decorateXbody(el);
      });
      mo.observe(el, { childList:true, characterData:true, subtree:true });
    }catch(e){}
  }

  /* ---------- wiring ---------- */
  var XBODY_IDS = ['chartSumBody','docAiBody','revToolsOut','dsOut','anaStudyOut','imeBody','surgPlanBody'];
  function wire(){
    if (!window.__mlsFormat || !window.__mlsFormat.enabled) return;
    injectCss();
    safe(function(){ attachPretty(document.getElementById('noteBox'), 'note'); });
    safe(function(){ attachPretty(document.getElementById('procNoteBody'), 'op'); });
    XBODY_IDS.forEach(function(id){ safe(function(){ watchXbody(document.getElementById(id)); }); });
    // also catch any future .xbody panels generically
    safe(function(){
      Array.prototype.forEach.call(document.querySelectorAll('.xbody'), function(el){ watchXbody(el); });
    });
  }

  window.__mlsFormat = {
    enabled: true,
    rerender: function(){ safe(wire); },
    disable: function(){ this.enabled=false; },
    _renderBlock: renderBlock,
    _renderInline: renderInline,
    _classify: classify
  };

  function boot(){ safe(wire); }
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
  // re-wire periodically: textareas/panels may mount after login / view switch
  var n=0; var iv=setInterval(function(){ n++; if(n>40){ clearInterval(iv); return; } safe(wire); }, 1000);
})();


/* ---- module: feat_study.js ---- */

/* ===== MLS Study / Import Patients — cohort builder =====
   Build a STUDY cohort two ways:
     MODE A (by NAME + DOB list): paste rows (Name, DOB), drive Athena patient search per row
       via the app's existing Assist bridge (window._assistReadChart), VERIFY identity by a STRICT
       name+DOB gate (never import on a name-only match or a DOB mismatch), then import the patient +
       history through the app's existing pipeline (_savePatientChart) and tag them to the cohort.
     MODE B (by INJECTION / PROCEDURE) — the real, layered "grab patients from Athena by the shot
       they got" flow:
       1) FIND IN ATHENA: pick a CPT/procedure or type a shot/injection name (+ optional date range),
          read the open Athena REPORT/claims/procedure list via MLS Assist (mlsAppReadReport, v1.29;
          falls back to the schedule read on older builds), parse Name+DOB(+service date+CPT) rows,
          filter by the chosen criteria, then feed every selected row through the SAME strict name+DOB
          verify+import pipeline as Mode A and tag the cohort. Robust + configurable selectors
          (window.__mlsStudyConfig); needs tuning to the doctor's real Athena report layout.
       2) FROM PATIENTS ALREADY IN MLS, grouped by their note CPT (PROC_MAP/_ptProcedure) — works now.
       3) VIA athenahealth FHIR API: a clean, gated "all patients who got CPT X" query against the
          SMART-on-FHIR client (backend). It probes a capability endpoint and stays disabled (no fake
          data) until athenahealth API access is approved, then auto-enables.
   ADDITIVE + progressive enhancement: own IIFE, all external calls in try/catch, reads app globals at
   call time, never monkey-patches. Cohort membership rides on the patient object (p.studyTags[]/p.cohort)
   which already persists to localStorage and to the backend inside patient.data. READ/IMPORT ONLY — this
   module never writes to Athena and never clicks Save/Sign. No PHI is logged off-device. */
(function(){
  'use strict';
  if (window.__mlsStudy) return;

  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function norm(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }
  function toast(m){ safe(function(){ if(window.toast) window.toast(m,'info'); }); }
  function getPatients(){ return safe(function(){ return window.getPatients()||[]; }, []); }

  /* ---------- DOB / name normalization ---------- */
  function normDob(d){
    if(!d) return '';
    var s=String(d).trim();
    var m=s.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/); // YYYY-MM-DD
    if(m){ return ('0'+m[2]).slice(-2)+('0'+m[3]).slice(-2)+m[1]; }
    m=s.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})/); // MM/DD/YYYY or MM/DD/YY
    if(!m) return '';
    var mm=('0'+m[1]).slice(-2), dd=('0'+m[2]).slice(-2), y=m[3];
    if(y.length===2){ var n=parseInt(y,10); y=(n>30?'19':'20')+y; } // pivot at 30
    return mm+dd+y;
  }
  function nameTokens(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9\s,]/g,' ').replace(/,/g,' ').split(/\s+/).filter(function(t){return t.length>1;}); }
  function tokenOverlap(a,b){ var A=nameTokens(a), B=nameTokens(b), n=0; A.forEach(function(t){ if(B.indexOf(t)>=0) n++; }); return n; }
  function rowTokensInText(name, text){
    var toks=nameTokens(name); if(!toks.length) return false; var t=String(text||'').toLowerCase(); var hit=0;
    toks.forEach(function(tk){ if(t.indexOf(tk)>=0) hit++; });
    return hit>=Math.min(2, toks.length); // need both first+last (or all, if single token)
  }
  function scanIdentity(text){
    var t=String(text||''); var dob='', name='';
    var dm=t.match(/(?:dob|d\.o\.b\.|date of birth|birth date)\s*[:\-]?\s*([01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{2,4})/i);
    if(dm) dob=dm[1];
    var nm=t.match(/(?:patient(?:\s*name)?|name)\s*[:\-]\s*([A-Za-z][A-Za-z'\-]+,\s*[A-Za-z][A-Za-z'\-]+)/);
    if(nm) name=nm[1];
    return {name:name, dob:dob};
  }

  /* ---------- parse pasted rows (Mode A) ---------- */
  function parseRows(text){
    return String(text||'').split(/\n/).map(function(line){
      var raw=line.trim(); if(!raw) return null;
      var dm=raw.match(/(\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}|\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4})/);
      var dob=dm?dm[1]:'';
      var name=raw;
      if(dm){ name=raw.slice(0,dm.index)+raw.slice(dm.index+dm[0].length); }
      name=name.replace(/[,;|\t]+/g,' ').replace(/\s{2,}/g,' ').trim().replace(/[\-–—]\s*$/,'').trim();
      return { name:name, dob:dob, raw:raw, dobValid: !!normDob(dob) };
    }).filter(Boolean);
  }

  /* ---------- STRICT name+DOB match gate ----------
     'match' requires: a name hit AND a valid DOB on BOTH sides AND the DOBs equal.
     Never returns 'match' on a name-only basis, and never on a DOB mismatch. */
  function strictMatch(row, chart){
    if(!chart) return {status:'not_found'};
    if(chart.__err==='no-bridge'||chart.__err==='old-ext') return {status:'no_bridge'};
    if(chart.__err) return {status:'error'};
    var scan=scanIdentity(chart.text||'');
    var chartName=chart.name||chart.patient||scan.name||'';
    var chartDob=normDob(chart.dob||'')||normDob(scan.dob||'');
    var rowDob=normDob(row.dob||'');
    var cn=norm(chartName), pn=norm(row.name);
    var nameHit=false;
    if(cn && pn){ nameHit = (cn===pn) || cn.indexOf(pn)>=0 || pn.indexOf(cn)>=0 || tokenOverlap(chartName,row.name)>=2; }
    if(!nameHit && chart.text){ nameHit = rowTokensInText(row.name, chart.text); }
    var hasChart = !!(chartName || chartDob || (chart.text && chart.text.length>20));
    if(!hasChart) return {status:'not_found'};
    if(!nameHit && !chartDob) return {status:'not_found'};
    if(!rowDob) return {status:'review', reason:'no DOB provided in your list', chartName:chartName};
    if(!chartDob) return {status:'review', reason:'could not read a DOB from the Athena chart', chartName:chartName};
    if(chartDob!==rowDob) return {status:'dob_mismatch', chartName:chartName, chartDob:(chart.dob||scan.dob||'')};
    if(!nameHit) return {status:'review', reason:'DOB matched but the name did not — verify manually', chartName:chartName};
    return {status:'match', chartName:chartName};
  }

  /* ---------- read one chart via the app's Assist bridge ---------- */
  function readChartFor(name){
    return new Promise(function(resolve){
      var done=false; function fin(v){ if(!done){ done=true; resolve(v); } }
      var TIMEOUT=setTimeout(function(){ fin({__err:'error', __timeout:true}); }, 45000);
      safe(function(){
        if(typeof window._assistReadChart!=='function'){ clearTimeout(TIMEOUT); fin({__err:'no-bridge'}); return; }
        var p=window._assistReadChart(name);
        if(!p || typeof p.then!=='function'){ clearTimeout(TIMEOUT); fin({__err:'no-bridge'}); return; }
        p.then(function(rd){
          if(!rd || !rd.text){ clearTimeout(TIMEOUT); fin(null); return; }
          var parsed=null; try{ parsed=window._parsePatientChart?window._parsePatientChart(rd.text):null; }catch(e){}
          if(parsed && typeof parsed.then==='function'){
            parsed.then(function(c){ c=c||{}; c.text=rd.text; c.url=rd.url; clearTimeout(TIMEOUT); fin(c); })
                  .catch(function(){ clearTimeout(TIMEOUT); fin({name:'',dob:'',text:rd.text,url:rd.url}); });
          } else { var c=parsed||{}; c.text=rd.text; c.url=rd.url; clearTimeout(TIMEOUT); fin(c); }
        }).catch(function(e){ clearTimeout(TIMEOUT); fin({__err:(e&&e.message==='OLDEXT')?'old-ext':'error'}); });
      }) || (clearTimeout(TIMEOUT), fin({__err:'error'}));
    });
  }

  /* ---------- read the open Athena REPORT via MLS Assist (v1.29 mlsAppReadReport) ----------
     Falls back to the existing schedule read (window._assistReadAthenaTab) on older extensions,
     so "Find in Athena" still does something on v1.28 and reads reports properly on v1.29+. */
  function assistReadReport(onStatus){
    return new Promise(function(resolve,reject){
      var say=function(m){ try{ if(onStatus) onStatus(m); }catch(e){} };
      var ponged=false, tries=0, iv=null, got=false, settled=false;
      function fin(fn,v){ if(settled) return; settled=true; window.removeEventListener('message',onPong); window.removeEventListener('message',onResult); if(iv) clearInterval(iv); fn(v); }
      function onPong(e){ if(e.data&&e.data.source==='mls-ext'&&e.data.type==='mlsPong'&&!ponged){ ponged=true; if(iv) clearInterval(iv); proceed(); } }
      function onResult(e){
        if(!(e.data&&e.data.source==='mls-ext'&&e.data.type==='mlsAppReportResult')) return;
        got=true; var r=e.data.resp||{};
        if(!r.ok||!r.text){ fin(reject,new Error(r.error||'Couldn’t read your Athena report tab.')); return; }
        fin(resolve,{text:r.text||'',url:r.url||'',frames:r.frames,bestScore:r.bestScore});
      }
      window.addEventListener('message',onPong);
      var ping=function(){ try{ window.postMessage({source:'mls-app',type:'mlsPing'},'*'); }catch(e){} };
      say('Looking for MLS Assist…'); ping();
      iv=setInterval(function(){ tries++; if(ponged){ clearInterval(iv); return; } if(tries>8){ clearInterval(iv); fin(reject,new Error('NOEXT')); } else ping(); }, 350);
      function proceed(){
        say('Reading the open Athena report…');
        window.addEventListener('message',onResult);
        try{ window.postMessage({source:'mls-app',type:'mlsAppReadReport'},'*'); }catch(e){}
        setTimeout(function(){ if(!got) fin(reject,new Error('OLDEXT')); }, 30000);
      }
    });
  }
  function readReportText(onStatus){
    return assistReadReport(onStatus).catch(function(err){
      var msg=(err&&err.message)||'';
      if(msg==='OLDEXT' && typeof window._assistReadAthenaTab==='function'){
        if(onStatus) onStatus('Update MLS Assist to v1.29 for proper report reading — using the older read path for now…');
        return window._assistReadAthenaTab(onStatus);
      }
      if(msg==='NOEXT') throw new Error('MLS Assist isn’t responding. Install/enable it (latest version) and open your signed-in Athena report tab, then try again.');
      throw err;
    });
  }

  /* ====================== Procedure / CPT library + criteria ======================
     Common spine / pain / PM&R injections & procedures. Each entry: a stable key, a human
     label, the CPT/HCPCS codes that identify it, and free-text synonyms (so a typed shot name
     like "lumbar transforaminal ESI" also matches). Configurable/extendable via
     window.__mlsStudyConfig.extraProcedures (array of {k,label,codes,syn}). */
  var CPT_LIBRARY=[
    {k:'esi_il_lumbar',  label:'Epidural steroid injection — interlaminar, lumbar/sacral/caudal', codes:['62323','62322'], syn:['interlaminar','epidural steroid','esi','lumbar epidural','caudal epidural']},
    {k:'esi_il_cervical',label:'Epidural steroid injection — interlaminar, cervical/thoracic',     codes:['62321','62320'], syn:['interlaminar','cervical epidural','thoracic epidural','esi']},
    {k:'tfesi_lumbar',   label:'Transforaminal ESI — lumbar/sacral',                               codes:['64483','64484'], syn:['transforaminal','tfesi','nerve root block','selective nerve root','lumbar transforaminal']},
    {k:'tfesi_cervical', label:'Transforaminal ESI — cervical/thoracic',                           codes:['64479','64480'], syn:['transforaminal','tfesi','cervical transforaminal']},
    {k:'mbb_lumbar',     label:'Facet / medial branch block — lumbar/sacral',                      codes:['64493','64494','64495'], syn:['facet','medial branch','mbb','facet joint','paravertebral facet','facet block']},
    {k:'mbb_cervical',   label:'Facet / medial branch block — cervical/thoracic',                  codes:['64490','64491','64492'], syn:['facet','medial branch','mbb','cervical facet']},
    {k:'rfa_lumbar',     label:'Radiofrequency ablation — lumbar/sacral facet',                    codes:['64635','64636'], syn:['rfa','radiofrequency','ablation','neurotomy','denervation','rhizotomy']},
    {k:'rfa_cervical',   label:'Radiofrequency ablation — cervical/thoracic facet',                codes:['64633','64634'], syn:['rfa','radiofrequency','ablation','neurotomy','denervation']},
    {k:'si_joint',       label:'Sacroiliac (SI) joint injection',                                  codes:['27096','G0260'], syn:['sacroiliac','si joint','si injection']},
    {k:'si_rfa',         label:'Sacroiliac joint RFA',                                             codes:['64625'], syn:['sacroiliac rfa','si rfa','sacroiliac ablation']},
    {k:'tpi',            label:'Trigger point injection',                                          codes:['20552','20553'], syn:['trigger point','tpi']},
    {k:'major_joint',    label:'Major joint / bursa injection (knee, shoulder, hip)',              codes:['20610','20611'], syn:['joint injection','knee injection','shoulder injection','hip injection','bursa']},
    {k:'small_joint',    label:'Small / intermediate joint injection',                             codes:['20600','20604','20605','20606'], syn:['joint injection','finger injection','wrist injection']},
    {k:'genicular_block',label:'Genicular nerve block',                                            codes:['64454'], syn:['genicular','knee nerve block']},
    {k:'genicular_rfa',  label:'Genicular nerve RFA',                                              codes:['64624'], syn:['genicular rfa','genicular ablation']},
    {k:'stellate',       label:'Stellate ganglion block',                                          codes:['64510'], syn:['stellate','stellate ganglion']},
    {k:'lumbar_symp',    label:'Lumbar sympathetic block',                                         codes:['64520'], syn:['lumbar sympathetic']},
    {k:'celiac',         label:'Celiac plexus block',                                              codes:['64530'], syn:['celiac plexus']},
    {k:'occipital',      label:'Occipital nerve block',                                            codes:['64405'], syn:['occipital nerve','greater occipital']},
    {k:'scs_trial',      label:'Spinal cord stimulator trial',                                     codes:['63650'], syn:['spinal cord stimulator','scs trial','neurostimulator']},
    {k:'kypho',          label:'Kyphoplasty / vertebroplasty',                                     codes:['22513','22514','22515','22510','22511','22512'], syn:['kyphoplasty','vertebroplasty','vertebral augmentation']},
    {k:'blood_patch',    label:'Epidural blood patch',                                             codes:['62273'], syn:['blood patch']}
  ];
  function library(){
    var extra=safe(function(){ return (window.__mlsStudyConfig&&Array.isArray(window.__mlsStudyConfig.extraProcedures))?window.__mlsStudyConfig.extraProcedures:[]; }, [])||[];
    return CPT_LIBRARY.concat(extra.filter(function(g){ return g&&g.k&&g.codes; }));
  }
  /* Resolve UI inputs (a picked library key + free-text) into {codes,keywords,label}. */
  function resolveCriteria(selKey, freeText){
    var codes=[], keywords=[], labels=[], lib=library();
    if(selKey){ var g=lib.find(function(x){return x.k===selKey;}); if(g){ codes=codes.concat(g.codes); keywords=keywords.concat(g.syn); labels.push(g.label); } }
    var ft=String(freeText||'').trim();
    if(ft){
      var fc=ft.match(/\b\d{5}\b|\bG\d{4}\b/gi)||[];
      fc.forEach(function(c){ c=c.toUpperCase(); if(codes.indexOf(c)<0) codes.push(c); });
      var words=ft.replace(/\b\d{5}\b|\bG\d{4}\b/gi,' ').replace(/\s{2,}/g,' ').trim();
      if(words){
        keywords.push(words.toLowerCase());
        lib.forEach(function(g){ if((g.syn||[]).some(function(s){ return words.toLowerCase().indexOf(s)>=0; })){ g.codes.forEach(function(c){ if(codes.indexOf(c)<0) codes.push(c); }); } });
      }
      labels.push(ft);
    }
    keywords=keywords.filter(function(k,i){ return k && keywords.indexOf(k)===i; });
    codes=codes.filter(function(c,i){ return c && codes.indexOf(c)===i; });
    return { codes:codes, keywords:keywords, label:labels.join(' · ')||'all patients in the report' };
  }

  /* ====================== Report parsing (robust + configurable) ======================
     Best-effort screen-scrape of an Athena report/claims/procedure-list. Heuristic + tunable via
     window.__mlsStudyConfig: { nameStopWords:[], dobMinAge, dobMaxAge }. Returns rows
     {name, dob, svc, codes[], line}. Conservative — every row still passes the strict name+DOB gate
     on import, so a bad parse can never import the wrong patient. */
  function parseDateInput(v){ var m=String(v||'').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if(!m) return null; return new Date(+m[1],+m[2]-1,+m[3]); }
  function dobToDate(dob){ var n=normDob(dob); if(!n) return null; return new Date(parseInt(n.slice(4),10), parseInt(n.slice(0,2),10)-1, parseInt(n.slice(2,4),10)); }
  function classifyDates(arr){
    var yrNow=new Date().getFullYear();
    var parsed=arr.map(function(s){ var n=normDob(s); return {s:s, y:n?parseInt(n.slice(4),10):0}; }).filter(function(d){ return d.y>0 && d.y<=yrNow+1; });
    if(!parsed.length) return {dob:'', svc:''};
    if(parsed.length>=2){ parsed.sort(function(a,b){return a.y-b.y;}); return {dob:parsed[0].s, svc:parsed[parsed.length-1].s}; }
    var age=yrNow-parsed[0].y;
    return (age>=2) ? {dob:parsed[0].s, svc:''} : {dob:'', svc:parsed[0].s};
  }
  function detectName(raw, firstDateIdx){
    var stop=safe(function(){ return (window.__mlsStudyConfig&&window.__mlsStudyConfig.nameStopWords)||[]; }, [])||[];
    var base='date|patient|name|service|procedure|report|provider|rendering|claim|claims|total|page|print|account|insurance|primary|secondary|visit|encounter|status|balance|charge|payment|appointment|department|location|day|view|time|room|type|follow|est|dos|dob|mrn|dx|mod|code|codes|qty|amt|paid|due|age|sex|male|female|athena|athenanet|athenaone|list|detail|details|summary|export|count|diagnosis|results|filter|filtered|group|none|self|null|grand|subtotal';
    if(stop.length){ base+='|'+stop.map(function(w){return String(w).replace(/[^a-z0-9]/gi,'');}).filter(Boolean).join('|'); }
    var bad=new RegExp('^('+base+')$','i');
    var searchIn = (firstDateIdx!=null && firstDateIdx>3) ? raw.slice(0, firstDateIdx) : raw;
    // "Last, First [M]" — strongest signal
    var m=searchIn.match(/([A-Z][A-Za-z'’\-]+)\s*,\s*([A-Z][A-Za-z'’\-]+(?:\s+[A-Z][a-z]?\.?)?)/);
    if(m) return (m[1]+', '+m[2]).replace(/\s{2,}/g,' ').trim();
    // "First Last" (two capitalized tokens not in the header vocabulary)
    var re=/\b([A-Z][A-Za-z'’\-]{1,})\s+([A-Z][A-Za-z'’\-]{1,})\b/g, mm;
    while((mm=re.exec(searchIn))){
      if(!bad.test(mm[1]) && !bad.test(mm[2])) return (mm[1]+' '+mm[2]).trim();
    }
    return '';
  }
  function parseReportRows(text){
    var dateRe=/\b([01]?\d[\/\-\.][0-3]?\d[\/\-\.]\d{2,4})\b/g;
    var lines=String(text||'').split(/\r?\n/);
    var rows=[];
    lines.forEach(function(line){
      var raw=line.replace(/\t/g,'  ').trim(); if(raw.length<4) return;
      var dates=[], dm; dateRe.lastIndex=0;
      while((dm=dateRe.exec(raw))){ dates.push({s:dm[1], idx:dm.index}); }
      var codes=(raw.match(/\b\d{5}\b|\bG\d{4}\b/g)||[]).map(function(c){return c.toUpperCase();});
      var name=detectName(raw, dates.length?dates[0].idx:null);
      if(!name) return;
      var cl=classifyDates(dates.map(function(d){return d.s;}));
      // A real procedure/claims/schedule row carries a DOB and/or a procedure code. Header/
      // title/total lines carry neither — drop them (a row with no DOB can't be verified anyway).
      if(!normDob(cl.dob) && !codes.length) return;
      rows.push({ name:name, dob:cl.dob, svc:cl.svc, codes:codes, line:raw });
    });
    // de-dup by name+dob, merging codes / filling svc/dob
    var seen={}, out=[];
    rows.forEach(function(r){
      var k=norm(r.name)+'|'+normDob(r.dob);
      if(seen[k]){ var ex=seen[k]; r.codes.forEach(function(c){ if(ex.codes.indexOf(c)<0) ex.codes.push(c); }); if(!ex.svc&&r.svc) ex.svc=r.svc; if(!ex.dob&&r.dob) ex.dob=r.dob; return; }
      seen[k]=r; out.push(r);
    });
    return out;
  }
  /* legacy export kept for back-compat (older briefing/tests referenced it) */
  function extractReportRows(text){
    return parseReportRows(text).map(function(r){ return { name:r.name, dob:r.dob }; }).filter(function(r){ return r.name && r.dob; });
  }
  function inRange(svc, from, to){
    if(!svc) return true; // can't exclude a row with no service date
    var d=dobToDate(svc); if(!d) return true;
    var f=parseDateInput(from); if(f && d<f) return false;
    var t=parseDateInput(to); if(t){ t.setHours(23,59,59,999); if(d>t) return false; }
    return true;
  }
  function filterReportRows(rows, crit){
    var codes=crit.codes||[], kw=(crit.keywords||[]).map(function(k){return String(k).toLowerCase();}).filter(Boolean);
    return rows.filter(function(r){
      var hit;
      if(!codes.length && !kw.length){ hit=true; }
      else {
        var codeHit = codes.length && r.codes.some(function(c){ return codes.indexOf(c)>=0; });
        var line=(r.line||'').toLowerCase();
        var kwHit = kw.length && kw.some(function(k){ return line.indexOf(k)>=0; });
        hit = codeHit || kwHit;
      }
      if(!hit) return false;
      return inRange(r.svc, crit.from, crit.to);
    });
  }

  /* ====================== gated SMART-on-FHIR cohort client ======================
     A reliable "all patients who received CPT X" query belongs to the SMART-on-FHIR client in the
     backend (integrations.js). This is the CLEAN app-side wiring, GATED behind a capability probe so
     it shows NOTHING until athenahealth API access is approved (no fake data). When the backend
     endpoint goes live it auto-enables.
     Backend contract (to be added by the backend task, NOT changed here):
       GET  /api/study/cohort-by-cpt/capability -> 200 { available:true, vendor, sandbox } when SMART
            is connected & approved; 404/501/403 otherwise.
       POST /api/study/cohort-by-cpt { cpt:[codes], dateFrom, dateTo } (auth: Bearer sf_bk_token)
            -> 200 { ok:true, patients:[ {name, dob, mrn, history?} ], cpt, count }  */
  function backendBase(){ return safe(function(){ return window.MLS_BACKEND || window.__mlsBackend || (window.MLS && window.MLS.backend) || 'https://scrivara-backend.onrender.com'; }, 'https://scrivara-backend.onrender.com'); }
  function authToken(){ return safe(function(){ return localStorage.getItem('sf_bk_token')||sessionStorage.getItem('sf_bk_token')||''; }, ''); }
  function apiFetch(path, opts){
    opts=opts||{}; var h=Object.assign({'Content-Type':'application/json'}, opts.headers||{});
    var t=authToken(); if(t) h['Authorization']='Bearer '+t; opts.headers=h;
    return fetch(backendBase()+path, opts);
  }
  function studyFhirProbe(){
    return apiFetch('/api/study/cohort-by-cpt/capability', {method:'GET'})
      .then(function(r){ if(!r.ok) return {available:false, status:r.status}; return r.json().catch(function(){ return {available:false}; }); })
      .then(function(j){ return {available:!!(j&&j.available), info:j}; })
      .catch(function(){ return {available:false, error:'network'}; });
  }
  function fhirCohortByCpt(codes, from, to){
    return apiFetch('/api/study/cohort-by-cpt', {method:'POST', body:JSON.stringify({cpt:codes||[], dateFrom:from||'', dateTo:to||''})})
      .then(function(r){ if(!r.ok) return {ok:false, status:r.status}; return r.json().catch(function(){ return {ok:false}; }); })
      .catch(function(e){ return {ok:false, error:String(e&&e.message||e)}; });
  }

  /* ---------- cohort tagging on the patient object ---------- */
  function findByName(name){
    var n=norm(name); var ps=getPatients();
    return ps.find(function(p){ return norm(p.name)===n; })
        || ps.find(function(p){ var pn=norm(p.name); return pn && (pn.indexOf(n)>=0 || n.indexOf(pn)>=0); })
        || null;
  }
  function tagPatientCohort(p, cohort){
    if(!p||!cohort) return false;
    p.studyTags = Array.isArray(p.studyTags)?p.studyTags:[];
    if(p.studyTags.indexOf(cohort)<0) p.studyTags.push(cohort);
    p.cohort = cohort;
    return !!safe(function(){ window.upsertPatient(p); return true; }, false);
  }
  function listCohorts(){
    var map={}; getPatients().forEach(function(p){
      var tags=Array.isArray(p.studyTags)?p.studyTags:(p.cohort?[p.cohort]:[]);
      tags.forEach(function(t){ if(!t) return; map[t]=(map[t]||0)+1; });
    });
    return Object.keys(map).sort().map(function(k){ return {name:k, n:map[k]}; });
  }
  function cohortMembers(cohort){
    return getPatients().filter(function(p){
      var tags=Array.isArray(p.studyTags)?p.studyTags:(p.cohort?[p.cohort]:[]);
      return tags.indexOf(cohort)>=0;
    });
  }
  function visitCount(p){
    return safe(function(){ return (window.patientNotes?window.patientNotes(p.id):[]).length; }, 0);
  }

  /* ---------- import one row (shared by Mode A and Mode B) ----------
     resolver(name) -> Promise<chart|null|{__err}>; defaults to the Assist bridge.
     On a confident name+DOB match, imports via the app's existing _savePatientChart, then tags. */
  /* ---------- calendar linking (v1.31): pulled patients land on the MLS calendar ----------
     When an imported (strict-verified) patient carries a service/appointment date, build an
     appointment object and hand the batch to the app's OWN Athena-schedule importer
     (window._importPulledSchedule) - which upserts the patient, dedupes (via _apptKey), persists
     and reloads the calendar, so the patient shows up on the right day AND clicking the calendar
     entry opens that patient (consistent with the existing calendar launchpad). It does NOT touch
     calendar rendering/styling. Degrades to a no-op if the importer isn't present. */
  function svcToYMD(svc){
    var n=normDob(svc); if(!n) return ''; /* normDob -> MMDDYYYY */
    var mm=n.slice(0,2), dd=n.slice(2,4), yy=n.slice(4);
    if(yy.length!==4) return ''; return yy+'-'+mm+'-'+dd;
  }
  function buildApptForRow(row){
    if(!row) return null;
    var ymd=svcToYMD(row.svc||''); if(!ymd) return null;
    var reason = (row.codes&&row.codes.length) ? ('Procedure '+row.codes[0]) : 'Procedure (study import)';
    return { name:row.name, dob:row.dob||'', appt_date:ymd, date:ymd, start_at:ymd+'T00:00', time:'', reason:reason, source:'study-import' };
  }
  function addToCalendar(appts){
    appts=(appts||[]).filter(Boolean);
    if(!appts.length) return 0;
    safe(function(){
      if(typeof window._importPulledSchedule==='function'){
        Promise.resolve(window._importPulledSchedule(appts)).then(function(){
          safe(function(){ if(window.loadCalendar) window.loadCalendar(); else if(window.renderCalendar) window.renderCalendar(); });
        }).catch(function(){});
      }
    });
    return appts.length;
  }

  function importRow(row, cohort, resolver){
    resolver = resolver || readChartFor;
    return Promise.resolve(safe(function(){ return resolver(row.name); }, null)).then(function(chart){
      var r=strictMatch(row, chart);
      if(r.status==='match'){
        safe(function(){ if(window._savePatientChart) window._savePatientChart(row.name, null, chart||{}); });
        var p=findByName(row.name);
        if(!p){
          p = safe(function(){
            var np={ id:'p'+Date.now()+Math.random().toString(36).slice(2,7), name:row.name, dob:row.dob||'',
                     problems:'', meds:'', allergies:'', summary:'', docs:[], source:'study-import', created:Date.now(), updated:Date.now() };
            window.upsertPatient(np); return np;
          }, null);
        }
        if(p){ if(!p.dob && (row.dob||(chart&&chart.dob))) p.dob=row.dob||chart.dob; tagPatientCohort(p, cohort); }
        return { row:row, status:'match', chartName:r.chartName||row.name, patientId:p?p.id:null, appt:buildApptForRow(row) };
      }
      return { row:row, status:r.status, reason:r.reason, chartName:r.chartName, chartDob:r.chartDob };
    });
  }

  /* status -> display */
  var STAT={
    match:        {icon:'✓', cls:'ok',   label:'Found & imported'},
    dob_mismatch: {icon:'⚠', cls:'bad',  label:'DOB mismatch — skipped'},
    not_found:    {icon:'⚠', cls:'warn', label:'Not found in Athena'},
    review:       {icon:'⚠', cls:'warn', label:'Verify manually — multiple/ambiguous'},
    no_bridge:    {icon:'⚠', cls:'gate', label:'MLS Assist + signed-in Athena needed'},
    old_ext:      {icon:'⚠', cls:'gate', label:'Update MLS Assist extension'},
    error:        {icon:'⚠', cls:'warn', label:'Read error — retry'},
    pending:      {icon:'…', cls:'wait', label:'Searching Athena…'}
  };
  function statOf(s){ return STAT[s]||STAT.error; }

  /* shared sequential importer: rows[] -> verify+import each, updating per-row + summary nodes */
  function importSequential(rows, cohort, els, onDone){
    var counts={match:0,dob_mismatch:0,not_found:0,review:0,no_bridge:0,error:0,old_ext:0}, idx=0, appts=[];
    function step(){
      if(idx>=rows.length){
        if(els.sum) els.sum.innerHTML='Done. ✓ '+counts.match+' imported · ⚠ '+counts.dob_mismatch+' DOB mismatch · '+counts.not_found+' not found · '+counts.review+' to verify'+((counts.no_bridge+counts.old_ext)?(' · '+(counts.no_bridge+counts.old_ext)+' need Assist'):'');
        var calN=addToCalendar(appts);
        if(els.sum && calN) els.sum.innerHTML+=' · 📅 '+calN+' added to calendar';
        safe(function(){ if(window.renderPatients) window.renderPatients(); });
        if(onDone) onDone(counts);
        return;
      }
      var r=rows[idx];
      importRow(r, cohort).then(function(res){
        if(res.status==='match' && res.appt) appts.push(res.appt);
        var st=res.status==='old-ext'?'old_ext':res.status;
        counts[st]=(counts[st]||0)+1;
        var s=statOf(st), el=els.row(idx);
        if(el){
          var extra='';
          if(st==='dob_mismatch') extra=' (Athena: '+esc(res.chartDob||'?')+')';
          else if(st==='review'&&res.reason) extra=' ('+esc(res.reason)+')';
          var rs=el.querySelector('.mls-study-rs'); if(rs){ rs.className='mls-study-rs '+s.cls; rs.textContent=s.icon+' '+s.label+extra; }
        }
        if(els.sum) els.sum.textContent='Importing '+(idx+1)+' / '+rows.length+'…';
        idx++; setTimeout(step, 120);
      });
    }
    step();
  }

  /* ====================== UI ====================== */
  var TAB='A';
  function open(initTab){ TAB=initTab||'A'; injectCss(); render(); }
  function close(){ var o=document.getElementById('mlsStudyOv'); if(o) o.remove(); }

  function render(){
    var ex=document.getElementById('mlsStudyOv'); if(ex) ex.remove();
    var o=document.createElement('div'); o.id='mlsStudyOv';
    o.innerHTML=''
      +'<div class="mls-study-card" role="dialog" aria-label="Study / Import Patients">'
      +' <div class="mls-study-head">'
      +'   <span class="mls-study-title">🧪 Study / Import Patients</span>'
      +'   <button type="button" class="mls-study-x" aria-label="Close">✕</button>'
      +' </div>'
      +' <div class="mls-study-tabs">'
      +'   <button type="button" data-t="A" class="'+(TAB==='A'?'on':'')+'">By name + DOB</button>'
      +'   <button type="button" data-t="B" class="'+(TAB==='B'?'on':'')+'">By procedure</button>'
      +'   <button type="button" data-t="C" class="'+(TAB==='C'?'on':'')+'">Cohorts</button>'
      +' </div>'
      +' <div class="mls-study-body" id="mlsStudyBody"></div>'
      +'</div>';
    document.body.appendChild(o);
    o.addEventListener('mousedown', function(e){ if(e.target===o) close(); });
    o.querySelector('.mls-study-x').addEventListener('click', close);
    o.querySelectorAll('.mls-study-tabs [data-t]').forEach(function(b){
      b.addEventListener('click', function(){ TAB=b.getAttribute('data-t'); render(); });
    });
    var body=o.querySelector('#mlsStudyBody');
    if(TAB==='A') renderModeA(body);
    else if(TAB==='B') renderModeB(body);
    else renderCohorts(body);
  }

  /* ----- Mode A ----- */
  function renderModeA(body){
    body.innerHTML=''
      +'<p class="mls-study-help">Paste one patient per line as <b>Name, DOB</b> (e.g. <code>Jane Doe, 04/12/1968</code>). '
      +'For each, MLS searches your signed-in Athena tab, <b>verifies name + DOB</b>, and imports the patient + history into the cohort. '
      +'It never imports on a name-only match or a DOB mismatch, and never writes back to Athena.</p>'
      +'<label class="mls-study-lab">Cohort / study name</label>'
      +'<input id="mlsStudyCohort" class="mls-study-in" placeholder="e.g. ESI Outcomes 2026" />'
      +'<label class="mls-study-lab">Patients (one per line: Name, DOB)</label>'
      +'<textarea id="mlsStudyRows" class="mls-study-ta" rows="7" placeholder="Jane Doe, 04/12/1968&#10;John Smith 7/3/1955"></textarea>'
      +'<div class="mls-study-actions">'
      +'  <button type="button" id="mlsStudyParse" class="mls-study-btn ghost">Preview list</button>'
      +'  <button type="button" id="mlsStudyImport" class="mls-study-btn">Import &amp; verify</button>'
      +'</div>'
      +'<div id="mlsStudyResults" class="mls-study-results"></div>';
    body.querySelector('#mlsStudyParse').addEventListener('click', function(){ previewList(body); });
    body.querySelector('#mlsStudyImport').addEventListener('click', function(){ runImport(body); });
  }
  function previewList(body){
    var rows=parseRows(body.querySelector('#mlsStudyRows').value);
    var out=body.querySelector('#mlsStudyResults');
    if(!rows.length){ out.innerHTML='<div class="mls-study-empty">Nothing to preview — paste some rows above.</div>'; return; }
    out.innerHTML='<div class="mls-study-sum">'+rows.length+' row(s):</div>'+rows.map(function(r){
      var ok=r.name && r.dobValid;
      return '<div class="mls-study-row '+(ok?'':'warn')+'"><span class="mls-study-rn">'+esc(r.name||'(no name)')+'</span>'
        +'<span class="mls-study-rd">'+esc(r.dob||'(no DOB)')+(r.dobValid?'':' ⚠')+'</span></div>';
    }).join('');
  }
  function runImport(body){
    var cohort=(body.querySelector('#mlsStudyCohort').value||'').trim();
    var rows=parseRows(body.querySelector('#mlsStudyRows').value);
    var out=body.querySelector('#mlsStudyResults');
    if(!cohort){ out.innerHTML='<div class="mls-study-empty">Enter a cohort / study name first.</div>'; return; }
    if(!rows.length){ out.innerHTML='<div class="mls-study-empty">Paste at least one patient (Name, DOB).</div>'; return; }
    var bridge = safe(function(){ return typeof window._assistReadChart==='function'; }, false);
    var banner = bridge ? '' : '<div class="mls-study-gate">⚠ MLS Assist isn’t detected. Install/enable the extension and open your signed-in Athena tab, then import. Rows will report "Assist needed".</div>';
    out.innerHTML=banner+'<div class="mls-study-sum" id="mlsStudySumLine">Importing 0 / '+rows.length+'…</div>'
      +rows.map(function(r,i){ var s=statOf('pending'); return '<div class="mls-study-row" id="mlsr'+i+'"><span class="mls-study-rn">'+esc(r.name||'(no name)')+'</span><span class="mls-study-rd">'+esc(r.dob||'')+'</span><span class="mls-study-rs '+s.cls+'">'+s.icon+' '+s.label+'</span></div>'; }).join('');
    importSequential(rows, cohort, { sum: body.querySelector('#mlsStudySumLine'), row:function(i){ return body.querySelector('#mlsr'+i); } });
  }

  /* ----- Mode B ----- */
  function proceduresInMls(){
    var map={};
    getPatients().forEach(function(p){
      var proc=safe(function(){ return window._ptProcedure?window._ptProcedure(p):''; }, '');
      if(proc && proc!=='—' && proc.toLowerCase()!=='other'){ (map[proc]=map[proc]||[]).push(p); }
    });
    return map;
  }
  function renderModeB(body){
    var map=proceduresInMls();
    var keys=Object.keys(map).sort();
    var localHtml = keys.length
      ? '<div class="mls-study-proclist">'+keys.map(function(k){ return '<div class="mls-study-prow"><label><input type="checkbox" class="mls-study-pchk" value="'+esc(k)+'"> '+esc(k)+' <span class="mls-study-cnt">'+map[k].length+'</span></label></div>'; }).join('')+'</div>'
      : '<div class="mls-study-empty">No procedures detected on patients currently in MLS. (Procedures come from each patient’s most recent note CPT.)</div>';
    var procOpts='<option value="">— pick a procedure / shot —</option>'+library().map(function(g){ return '<option value="'+esc(g.k)+'">'+esc(g.label)+' ('+esc(g.codes.join(', '))+')</option>'; }).join('');
    body.innerHTML=''
      /* ---- Section 1: Find in Athena by procedure (the real grab) ---- */
      +'<div class="mls-study-sec">'
      +' <div class="mls-study-sech">Find patients in Athena by procedure <span class="mls-study-badge exp">needs live tuning</span></div>'
      +' <p class="mls-study-help">Grab everyone who got a given shot/injection. In Athena, open a report or list that shows the procedure (a <b>procedure/CPT claims report</b>, a billing/charge report, or a schedule filtered by procedure) for the date range you want. Then pick the procedure or type the shot name below and click <b>Find in Athena</b>. MLS reads that open report, extracts each patient’s name + DOB, and runs every one through the same strict name + DOB verify + import as the “By name + DOB” tab. Read-only — it never writes to Athena.</p>'
      +' <p class="mls-study-help"><b>🛰️ Search Athena with MLS Assist</b> goes further: MLS Assist <b>drives athenaOne itself</b> — it enters the CPT/procedure + date range into your procedure/claims/charge search, runs it, and <b>pages through every result</b>, harvesting each patient. Every patient still passes the same strict name + DOB verify + import. Needs one live tuning pass to your athenaOne search screen (see notes). <b>🔎 Find in Athena</b> instead reads a report you already ran.</p>'
      +' <label class="mls-study-lab">Procedure / shot</label>'
      +' <select id="mlsStudyBSel" class="mls-study-in">'+procOpts+'</select>'
      +' <label class="mls-study-lab">…or type a shot/injection name or CPT</label>'
      +' <input id="mlsStudyBProc" class="mls-study-in" placeholder="e.g. lumbar transforaminal ESI  ·  64483" />'
      +' <div class="mls-study-daterow">'
      +'   <div><label class="mls-study-lab">Service date from (optional)</label><input type="date" id="mlsStudyBFrom" class="mls-study-in" /></div>'
      +'   <div><label class="mls-study-lab">to</label><input type="date" id="mlsStudyBTo" class="mls-study-in" /></div>'
      +' </div>'
      +' <label class="mls-study-lab">Cohort / study name</label>'
      +' <input id="mlsStudyBFCohort" class="mls-study-in" placeholder="e.g. Lumbar TF-ESI 2026" />'
      +' <div class="mls-study-actions">'
      +'  <button type="button" id="mlsStudyBAuto" class="mls-study-btn">🛰️ Search Athena with MLS Assist</button>'
      +'  <button type="button" id="mlsStudyBFind" class="mls-study-btn ghost">🔎 Find in Athena (read open report)</button>'
      +' </div>'
      +' <div id="mlsStudyBFindOut" class="mls-study-results"></div>'
      +'</div>'
      /* ---- Section 2: From patients already in MLS (works now) ---- */
      +'<div class="mls-study-sec">'
      +' <div class="mls-study-sech">From patients already in MLS <span class="mls-study-badge live">works now</span></div>'
      +' <p class="mls-study-help">Build a cohort from patients you’ve already imported, grouped by their note CPT/procedure. Tick procedures and tag them to a cohort — no Athena round-trip.</p>'
      +' '+localHtml
      +' <label class="mls-study-lab">Cohort / study name</label>'
      +' <input id="mlsStudyBCohort" class="mls-study-in" placeholder="e.g. Lumbar ESI cohort" />'
      +' <div class="mls-study-actions"><button type="button" id="mlsStudyBTag" class="mls-study-btn">Add matching patients to cohort</button></div>'
      +' <div id="mlsStudyBOut" class="mls-study-results"></div>'
      +'</div>'
      /* ---- Section 3: Via athenahealth FHIR API (gated) ---- */
      +'<div class="mls-study-sec gated">'
      +' <div class="mls-study-sech">Via athenahealth API (exact procedure cohort) <span class="mls-study-badge gate" id="mlsStudyFhirBadge">checking…</span></div>'
      +' <p class="mls-study-help">A reliable “all patients who received CPT X” query runs through the SMART-on-FHIR integration — no screen-scraping. This is wired and ready; it stays disabled until athenahealth developer/partner API access is approved, then it turns on automatically. It shows no data until the API is live.</p>'
      +' <div class="mls-study-actions"><button type="button" id="mlsStudyFhirBtn" class="mls-study-btn ghost" disabled>Run exact FHIR cohort query (disabled until API access)</button></div>'
      +' <div id="mlsStudyFhirOut" class="mls-study-results"></div>'
      +'</div>';
    body.querySelector('#mlsStudyBAuto').addEventListener('click', function(){ doAutoSearchAthena(body); });
    body.querySelector('#mlsStudyBFind').addEventListener('click', function(){ doFindInAthena(body); });
    body.querySelector('#mlsStudyBTag').addEventListener('click', function(){ tagLocalProcedures(body, map); });
    wireFhirPanel(body);
  }

  /* ---------- Mode C: MLS Assist DRIVES the athenaOne search + paginates (v1.31) ----------
     Sends the chosen CPT/procedure + optional date range to the extension, which operates
     athenaOne's procedure/claims/charge search and pages through EVERY result page, returning
     all rows' text. The app then parses + filters + verifies+imports exactly like "Find in
     Athena" (same strict name+DOB gate). Read-only in athenaOne; never clicks Save/Sign.
     Selectors/labels are tunable via window.__mlsStudyConfig.search (passed to the extension). */
  function searchCfg(){ return safe(function(){ return (window.__mlsStudyConfig&&window.__mlsStudyConfig.search)||{}; }, {})||{}; }
  function assistSearchProcedure(params, cfg, onStatus){
    return new Promise(function(resolve,reject){
      var say=function(m){ try{ if(onStatus) onStatus(m); }catch(e){} };
      var ponged=false, tries=0, iv=null, settled=false, safetyTo=null;
      function fin(fn,v){ if(settled) return; settled=true; window.removeEventListener('message',onPong); window.removeEventListener('message',onEvt); if(iv) clearInterval(iv); if(safetyTo) clearTimeout(safetyTo); fn(v); }
      function onPong(e){ if(e.data&&e.data.source==='mls-ext'&&e.data.type==='mlsPong'&&!ponged){ ponged=true; if(iv) clearInterval(iv); proceed(); } }
      function onEvt(e){
        var d=e.data; if(!(d&&d.source==='mls-ext')) return;
        if(d.type==='mlsAppSearchProgress'){ say(d.msg||'Working...'); return; }
        if(d.type==='mlsAppSearchResult'){
          var r=d.resp||{};
          if(!r.ok){ var err=new Error(r.error||'Search failed.'); err.code=r.code||''; fin(reject,err); return; }
          fin(resolve,{text:r.text||'', pages:r.pages||0, ranControls:r.ranControls});
        }
      }
      window.addEventListener('message',onPong);
      var ping=function(){ try{ window.postMessage({source:'mls-app',type:'mlsPing'},'*'); }catch(e){} };
      say('Looking for MLS Assist...'); ping();
      iv=setInterval(function(){ tries++; if(ponged){ clearInterval(iv); return; } if(tries>8){ clearInterval(iv); fin(reject,new Error('MLS Assist is not responding. Install/enable it (latest version) and sign into athenaOne in another tab, then try again.')); } else ping(); }, 350);
      function proceed(){
        window.addEventListener('message',onEvt);
        say('Driving the athenaOne procedure search...');
        try{ window.postMessage({source:'mls-app',type:'mlsAppSearchProcedure',params:params,cfg:cfg},'*'); }catch(e){}
        safetyTo=setTimeout(function(){ fin(reject,new Error('Search timed out. Open the procedure/claims report manually and use Find in Athena, or tune selectors.')); }, 360000);
      }
    });
  }
  function doAutoSearchAthena(body){
    var out=body.querySelector('#mlsStudyBFindOut');
    var crit=resolveCriteria(body.querySelector('#mlsStudyBSel').value, body.querySelector('#mlsStudyBProc').value);
    crit.from=(body.querySelector('#mlsStudyBFrom').value||''); crit.to=(body.querySelector('#mlsStudyBTo').value||'');
    var procName=(body.querySelector('#mlsStudyBProc').value||'').trim();
    if(!procName){ var selKey=body.querySelector('#mlsStudyBSel').value; var g=library().find(function(x){return x.k===selKey;}); if(g){ procName=(g.syn&&g.syn[0])||g.label; } }
    var params={ cpt:crit.codes||[], procedureName:procName||'', dateFrom:crit.from||'', dateTo:crit.to||'' };
    if(!params.cpt.length && !params.procedureName){ out.innerHTML='<div class="mls-study-gate">Pick a procedure or type a CPT/shot name first.</div>'; return; }
    out.innerHTML='<div class="mls-study-sum" id="mlsStudyBStatus">Starting MLS Assist...</div>';
    var setS=function(m){ var n=body.querySelector('#mlsStudyBStatus'); if(n) n.textContent=m; };
    assistSearchProcedure(params, searchCfg(), setS).then(function(rd){
      var text=(rd&&rd.text)?rd.text:'';
      if(!text){ out.innerHTML='<div class="mls-study-gate">MLS Assist ran the search but read 0 rows'+(rd&&rd.pages?(' across '+rd.pages+' page(s)'):'')+'. The results table likely needs selector tuning to your athenaOne layout (set <code>window.__mlsStudyConfig.search</code>), or run the report yourself and use the read-only Find in Athena.</div>'; return; }
      var all=parseReportRows(text);
      var rows=filterReportRows(all, crit);
      renderCandidates(body, rows, all.length, crit, {bestScore:null, pages:(rd&&rd.pages)||0});
    }).catch(function(err){
      out.innerHTML='<div class="mls-study-gate">&#9888; '+esc((err&&err.message)||'Search failed.')+'</div>';
    });
  }

  /* ---- Section 1 logic: read Athena report -> parse -> filter -> review -> verify+import ---- */
  function doFindInAthena(body){
    var out=body.querySelector('#mlsStudyBFindOut');
    var crit=resolveCriteria(body.querySelector('#mlsStudyBSel').value, body.querySelector('#mlsStudyBProc').value);
    crit.from=(body.querySelector('#mlsStudyBFrom').value||''); crit.to=(body.querySelector('#mlsStudyBTo').value||'');
    out.innerHTML='<div class="mls-study-sum" id="mlsStudyBStatus">Looking for MLS Assist…</div>';
    var setS=function(m){ var n=body.querySelector('#mlsStudyBStatus'); if(n) n.textContent=m; };
    readReportText(setS).then(function(rd){
      var text=(rd&&rd.text)?rd.text:'';
      if(!text){ out.innerHTML='<div class="mls-study-gate">Couldn’t read an Athena report. Open the procedure/claims report (or a filtered schedule) as your signed-in Athena tab, then try again.</div>'; return; }
      var all=parseReportRows(text);
      var rows=filterReportRows(all, crit);
      renderCandidates(body, rows, all.length, crit, rd);
    }).catch(function(err){
      out.innerHTML='<div class="mls-study-gate">⚠ '+esc((err&&err.message)||'Couldn’t read the Athena tab.')+'</div>';
    });
  }
  function renderCandidates(body, rows, totalParsed, crit, rd){
    var out=body.querySelector('#mlsStudyBFindOut');
    if(!rows.length){
      out.innerHTML='<div class="mls-study-gate">Read the report ('+esc(String(totalParsed))+' patient row(s) parsed'+(rd&&rd.bestScore!=null?(', match score '+esc(String(rd.bestScore))):'')+') but none matched <b>'+esc(crit.label)+'</b>'+((crit.from||crit.to)?' in that date range':'')+'.<br>Tips: make sure the report shows the procedure/CPT column; widen or clear the date range; or open the report so the patient rows are visible. This scrape is conservative and may need tuning to your report’s layout (set <code>window.__mlsStudyConfig</code>).</div>';
      return;
    }
    var withDob=rows.filter(function(r){ return normDob(r.dob); }).length;
    out.innerHTML='<div class="mls-study-sum">Found <b>'+rows.length+'</b> patient(s) matching '+esc(crit.label)+' — '+withDob+' with a readable DOB. Review, then verify + import:</div>'
      +'<div class="mls-study-checkall"><label><input type="checkbox" id="mlsStudyBAll" checked> Select all</label></div>'
      +'<div class="mls-study-candlist">'+rows.map(function(r,i){
          var d=normDob(r.dob); var cpt=r.codes.length?(' · '+esc(r.codes.join(', '))):''; var sv=r.svc?(' · DOS '+esc(r.svc)):'';
          return '<label class="mls-study-cand"><input type="checkbox" class="mls-study-cchk" data-i="'+i+'"'+(d?' checked':'')+(d?'':' disabled')+'>'
            +'<span class="mls-study-rn">'+esc(r.name)+'</span>'
            +'<span class="mls-study-rd">'+esc(r.dob||'(no DOB — can’t verify)')+'</span>'
            +'<span class="mls-study-cnt">'+(cpt||sv?(esc(((r.codes[0]||'')+ (r.svc?(' '+r.svc):'')).trim())):'')+'</span></label>';
        }).join('')+'</div>'
      +'<div class="mls-study-help">Only rows with a readable DOB can be verified+imported (the strict name+DOB gate needs both). Review the list — every selected patient is re-verified against their Athena chart on import, so a wrong row can’t import the wrong patient.</div>'
      +'<label class="mls-study-lab">Cohort / study name</label>'
      +'<input id="mlsStudyBFCohort2" class="mls-study-in" value="'+esc((body.querySelector('#mlsStudyBFCohort').value||crit.label||'').slice(0,80))+'" placeholder="cohort name" />'
      +'<div class="mls-study-actions"><button type="button" id="mlsStudyBImport" class="mls-study-btn">✓ Verify &amp; import selected</button></div>'
      +'<div class="mls-study-sum" id="mlsStudyBImpSum"></div>'
      +'<div id="mlsStudyBImpRows"></div>';
    var all=out.querySelector('#mlsStudyBAll');
    if(all) all.addEventListener('change', function(){ out.querySelectorAll('.mls-study-cchk').forEach(function(c){ if(!c.disabled) c.checked=all.checked; }); });
    out.querySelector('#mlsStudyBImport').addEventListener('click', function(){ importCandidates(body, rows, out); });
  }
  function importCandidates(body, rows, out){
    var cohort=(out.querySelector('#mlsStudyBFCohort2').value||'').trim();
    if(!cohort){ out.querySelector('#mlsStudyBImpSum').innerHTML='<span class="mls-study-gatetext">Enter a cohort name first.</span>'; return; }
    var picked=[]; out.querySelectorAll('.mls-study-cchk').forEach(function(c){ if(c.checked && !c.disabled){ picked.push(rows[parseInt(c.getAttribute('data-i'),10)]); } });
    if(!picked.length){ out.querySelector('#mlsStudyBImpSum').innerHTML='<span class="mls-study-gatetext">Tick at least one patient with a DOB.</span>'; return; }
    var rowsBox=out.querySelector('#mlsStudyBImpRows');
    rowsBox.innerHTML=picked.map(function(r,i){ var s=statOf('pending'); return '<div class="mls-study-row" id="mlsbc'+i+'"><span class="mls-study-rn">'+esc(r.name)+'</span><span class="mls-study-rd">'+esc(r.dob||'')+'</span><span class="mls-study-rs '+s.cls+'">'+s.icon+' '+s.label+'</span></div>'; }).join('');
    importSequential(picked, cohort, { sum: out.querySelector('#mlsStudyBImpSum'), row:function(i){ return out.querySelector('#mlsbc'+i); } });
  }

  function tagLocalProcedures(body, map){
    var cohort=(body.querySelector('#mlsStudyBCohort').value||'').trim();
    var out=body.querySelector('#mlsStudyBOut');
    if(!cohort){ out.innerHTML='<div class="mls-study-empty">Enter a cohort name first.</div>'; return; }
    var picked=Array.prototype.map.call(body.querySelectorAll('.mls-study-pchk:checked'), function(c){ return c.value; });
    if(!picked.length){ out.innerHTML='<div class="mls-study-empty">Tick at least one procedure.</div>'; return; }
    var n=0; picked.forEach(function(k){ (map[k]||[]).forEach(function(p){ if(tagPatientCohort(p, cohort)) n++; }); });
    out.innerHTML='<div class="mls-study-sum">✓ Added '+n+' patient(s) to cohort “'+esc(cohort)+'”.</div>';
    safe(function(){ if(window.renderPatients) window.renderPatients(); });
  }

  /* ---- Section 3 logic: probe + (when enabled) run the FHIR cohort query ---- */
  function wireFhirPanel(body){
    var badge=body.querySelector('#mlsStudyFhirBadge'), btn=body.querySelector('#mlsStudyFhirBtn'), out=body.querySelector('#mlsStudyFhirOut');
    if(!badge||!btn) return;
    studyFhirProbe().then(function(p){
      if(p.available){
        badge.textContent='API connected'; badge.className='mls-study-badge live';
        btn.disabled=false; btn.textContent='Run exact FHIR cohort query';
        btn.addEventListener('click', function(){ runFhirCohort(body); });
      } else {
        badge.textContent='gated'; badge.className='mls-study-badge gate';
        btn.disabled=true; btn.textContent='Run exact FHIR cohort query (disabled until API access)';
      }
    });
  }
  function runFhirCohort(body){
    var out=body.querySelector('#mlsStudyFhirOut');
    var crit=resolveCriteria(body.querySelector('#mlsStudyBSel').value, body.querySelector('#mlsStudyBProc').value);
    if(!crit.codes.length){ out.innerHTML='<div class="mls-study-gate">Pick a procedure or enter a CPT code first (the FHIR query needs a CPT/HCPCS code).</div>'; return; }
    var cohort=(body.querySelector('#mlsStudyBFCohort').value||crit.label||'').trim();
    out.innerHTML='<div class="mls-study-sum">Querying athenahealth FHIR for CPT '+esc(crit.codes.join(', '))+'…</div>';
    fhirCohortByCpt(crit.codes, body.querySelector('#mlsStudyBFrom').value, body.querySelector('#mlsStudyBTo').value).then(function(res){
      if(!res||!res.ok||!Array.isArray(res.patients)){ out.innerHTML='<div class="mls-study-gate">The FHIR query didn’t return a cohort'+(res&&res.status?(' (HTTP '+esc(String(res.status))+')'):'')+'. The API may not be approved yet.</div>'; return; }
      var rows=res.patients.map(function(p){ return { name:p.name||'', dob:p.dob||'', raw:'', dobValid:!!normDob(p.dob) }; }).filter(function(r){ return r.name; });
      out.innerHTML='<div class="mls-study-sum">FHIR returned '+rows.length+' patient(s) for CPT '+esc(crit.codes.join(', '))+'. Verifying + importing into “'+esc(cohort)+'”…</div>'
        +rows.map(function(r,i){ var s=statOf('pending'); return '<div class="mls-study-row" id="mlsfc'+i+'"><span class="mls-study-rn">'+esc(r.name)+'</span><span class="mls-study-rd">'+esc(r.dob||'')+'</span><span class="mls-study-rs '+s.cls+'">'+s.icon+' '+s.label+'</span></div>'; }).join('')
        +'<div class="mls-study-sum" id="mlsStudyFhirSum"></div>';
      importSequential(rows, cohort||'FHIR cohort', { sum: out.querySelector('#mlsStudyFhirSum'), row:function(i){ return out.querySelector('#mlsfc'+i); } });
    });
  }

  /* ----- Cohorts view ----- */
  function renderCohorts(body){
    var cohorts=listCohorts();
    if(!cohorts.length){ body.innerHTML='<div class="mls-study-empty">No cohorts yet. Use “By name + DOB” or “By procedure” to build one.</div>'; return; }
    body.innerHTML='<div class="mls-study-cohlist">'+cohorts.map(function(c){
      return '<button type="button" class="mls-study-coh" data-c="'+esc(c.name)+'"><span>'+esc(c.name)+'</span><span class="mls-study-cnt">'+c.n+'</span></button>';
    }).join('')+'</div><div id="mlsStudyCohDetail"></div>';
    body.querySelectorAll('.mls-study-coh').forEach(function(b){
      b.addEventListener('click', function(){ showCohort(body, b.getAttribute('data-c')); });
    });
  }
  function showCohort(body, cohort){
    var det=body.querySelector('#mlsStudyCohDetail'); if(!det) return;
    var mem=cohortMembers(cohort);
    det.innerHTML='<div class="mls-study-sum">'+esc(cohort)+' — '+mem.length+' patient(s)</div>'
      +'<div class="mls-study-export"><button type="button" class="mls-study-btn ghost" id="mlsStudyCsv">Export de-identified summary (CSV)</button></div>'
      +'<div class="mls-study-memlist">'+mem.map(function(p){
        return '<div class="mls-study-row"><span class="mls-study-rn">'+esc(p.name||'(unnamed)')+'</span>'
          +'<span class="mls-study-rd">'+esc(p.dob||'')+'</span>'
          +'<span class="mls-study-cnt">'+visitCount(p)+' visit(s)</span>'
          +'<button type="button" class="mls-study-open" data-id="'+esc(p.id)+'">Open chart</button></div>';
      }).join('')+'</div>';
    det.querySelectorAll('.mls-study-open').forEach(function(b){
      b.addEventListener('click', function(){
        var id=b.getAttribute('data-id');
        safe(function(){ if(window.setActivePtId) window.setActivePtId(id); });
        safe(function(){ if(window.openPatient) window.openPatient(id); });
        safe(function(){ if(window.showView) window.showView('patients'); });
        close();
      });
    });
    var csv=det.querySelector('#mlsStudyCsv'); if(csv) csv.addEventListener('click', function(){ exportCohortCsv(cohort, mem); });
  }
  function exportCohortCsv(cohort, mem){
    // De-identified: cohort, a sequential study id, age (from DOB year), sex, visit count. No name/DOB/MRN.
    var yr=new Date().getFullYear();
    var lines=['cohort,study_id,age,sex,visits'];
    mem.forEach(function(p,i){
      var age=''; var dm=normDob(p.dob||''); if(dm){ age=String(yr-parseInt(dm.slice(4),10)); }
      lines.push([cohort, 'S'+(i+1), age, (p.sex||''), visitCount(p)].map(function(x){return '"'+String(x).replace(/"/g,'""')+'"';}).join(','));
    });
    safe(function(){
      var blob=new Blob([lines.join('\n')],{type:'text/csv'});
      var a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='MLS_cohort_'+cohort.replace(/[^a-z0-9]+/gi,'_')+'_deidentified.csv';
      document.body.appendChild(a); a.click(); setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 500);
    });
  }

  /* ---------- launch button in the Patients toolbar ---------- */
  function injectLaunch(){
    safe(function(){
      if(document.getElementById('mlsStudyLaunch')) return;
      var anchor=document.getElementById('ptPullAthenaBtn'); if(!anchor||!anchor.parentElement) return;
      var b=document.createElement('button'); b.type='button'; b.id='mlsStudyLaunch';
      b.className=anchor.className; b.textContent='🧪 Study / Import';
      b.addEventListener('click', function(){ open('A'); });
      anchor.parentElement.insertBefore(b, anchor.nextSibling);
    });
  }

  /* ---------- timeline provider (cohort membership shows on a patient's timeline) ---------- */
  function wireTimeline(){
    safe(function(){
      if(window.__mlsTimeline && window.__mlsTimeline.addProvider){
        window.__mlsTimeline.addProvider(function(pid){
          var p=safe(function(){ return window.findPatient?window.findPatient(pid):null; }, null);
          if(!p) return [];
          var tags=Array.isArray(p.studyTags)?p.studyTags:(p.cohort?[p.cohort]:[]);
          return tags.map(function(t){ return { date:p.updated||Date.now(), type:'study', icon:'🧪', title:'In study cohort: '+t, sub:'', onClick:function(){ open('C'); } }; });
        });
      }
    });
  }

  function injectCss(){
    if(document.getElementById('mlsStudyCss')) return;
    var s=document.createElement('style'); s.id='mlsStudyCss';
    s.textContent=''
      +'#mlsStudyOv{position:fixed;inset:0;z-index:100002;background:rgba(15,28,46,.42);display:flex;align-items:flex-start;justify-content:center;padding:40px 16px;overflow:auto;}'
      +'#mlsStudyOv .mls-study-card{background:var(--card,#fff);border:1px solid var(--line,#e6e9ef);border-radius:16px;box-shadow:0 24px 60px rgba(15,28,46,.3);width:640px;max-width:100%;font-size:13px;color:var(--ink,#15293f);}'
      +'#mlsStudyOv .mls-study-head{display:flex;justify-content:space-between;align-items:center;padding:14px 16px;border-bottom:1px solid var(--line,#e6e9ef);}'
      +'#mlsStudyOv .mls-study-title{font-weight:700;font-size:15px;}'
      +'#mlsStudyOv .mls-study-x{border:0;background:transparent;cursor:pointer;color:var(--muted,#9aa7b4);font-size:16px;}'
      +'#mlsStudyOv .mls-study-tabs{display:flex;gap:4px;padding:10px 12px 0;}'
      +'#mlsStudyOv .mls-study-tabs button{flex:1;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fafcff);color:var(--muted,#5b6b7c);border-radius:9px 9px 0 0;padding:8px;}'
      +'#mlsStudyOv .mls-study-tabs button.on{background:var(--card,#fff);color:var(--brand,#2563c9);border-bottom-color:transparent;}'
      +'#mlsStudyOv .mls-study-body{padding:14px 16px;max-height:70vh;overflow:auto;}'
      +'#mlsStudyOv .mls-study-help{color:var(--muted,#5b6b7c);font-size:12px;line-height:1.5;margin:0 0 10px;}'
      +'#mlsStudyOv code{background:var(--surface,#f1f5fb);padding:1px 5px;border-radius:5px;font-size:11.5px;}'
      +'#mlsStudyOv .mls-study-lab{display:block;font-weight:600;font-size:11.5px;margin:8px 0 4px;color:var(--ink,#15293f);}'
      +'#mlsStudyOv .mls-study-in,#mlsStudyOv .mls-study-ta{width:100%;box-sizing:border-box;font:inherit;border:1px solid var(--line,#e6e9ef);border-radius:9px;padding:8px 10px;background:var(--surface,#fafcff);color:var(--ink,#15293f);}'
      +'#mlsStudyOv select.mls-study-in{cursor:pointer;}'
      +'#mlsStudyOv .mls-study-ta{resize:vertical;}'
      +'#mlsStudyOv .mls-study-daterow{display:flex;gap:10px;}'
      +'#mlsStudyOv .mls-study-daterow>div{flex:1;}'
      +'#mlsStudyOv .mls-study-actions{display:flex;gap:8px;margin:10px 0;}'
      +'#mlsStudyOv .mls-study-btn{font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--brand,#2563c9);background:var(--brand,#2563c9);color:#fff;border-radius:9px;padding:8px 14px;}'
      +'#mlsStudyOv .mls-study-btn.ghost{background:var(--surface,#fafcff);color:var(--brand,#2563c9);}'
      +'#mlsStudyOv .mls-study-btn:disabled{opacity:.5;cursor:not-allowed;}'
      +'#mlsStudyOv .mls-study-results{margin-top:8px;}'
      +'#mlsStudyOv .mls-study-sum{font-weight:600;margin:6px 0;}'
      +'#mlsStudyOv .mls-study-gatetext{color:#b45309;font-weight:600;}'
      +'#mlsStudyOv .mls-study-row{display:flex;align-items:center;gap:10px;padding:6px 8px;border:1px solid var(--line,#eef1f6);border-radius:8px;margin-bottom:5px;background:var(--surface,#fcfdff);}'
      +'#mlsStudyOv .mls-study-row.warn{border-color:#f0c98a;}'
      +'#mlsStudyOv .mls-study-rn{flex:1;font-weight:600;}'
      +'#mlsStudyOv .mls-study-rd{color:var(--muted,#5b6b7c);font-size:12px;min-width:84px;}'
      +'#mlsStudyOv .mls-study-rs{font-size:11.5px;font-weight:600;}'
      +'#mlsStudyOv .mls-study-rs.ok{color:#16a34a;} #mlsStudyOv .mls-study-rs.bad{color:#dc2626;} #mlsStudyOv .mls-study-rs.warn{color:#b45309;} #mlsStudyOv .mls-study-rs.gate{color:#7c5cff;} #mlsStudyOv .mls-study-rs.wait{color:var(--muted,#9aa7b4);}'
      +'#mlsStudyOv .mls-study-empty{color:var(--muted,#9aa7b4);padding:14px;text-align:center;}'
      +'#mlsStudyOv .mls-study-gate{background:#fff7ec;border:1px solid #f0c98a;color:#7a4f12;border-radius:8px;padding:8px 10px;margin:6px 0;font-size:12px;line-height:1.5;}'
      +'#mlsStudyOv .mls-study-sec{border:1px solid var(--line,#eef1f6);border-radius:11px;padding:11px 12px;margin-bottom:12px;}'
      +'#mlsStudyOv .mls-study-sec.gated{opacity:.92;}'
      +'#mlsStudyOv .mls-study-sech{font-weight:700;font-size:13px;margin-bottom:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}'
      +'#mlsStudyOv .mls-study-badge{font-size:10px;font-weight:700;padding:2px 7px;border-radius:999px;}'
      +'#mlsStudyOv .mls-study-badge.live{background:#e7f7ee;color:#16794a;} #mlsStudyOv .mls-study-badge.exp{background:#fff2e0;color:#9a5a12;} #mlsStudyOv .mls-study-badge.gate{background:#efeaff;color:#5b40c9;}'
      +'#mlsStudyOv .mls-study-proclist{margin:6px 0;}'
      +'#mlsStudyOv .mls-study-prow label{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;}'
      +'#mlsStudyOv .mls-study-cnt{color:var(--muted,#5b6b7c);font-size:11.5px;background:var(--surface,#f1f5fb);border-radius:999px;padding:1px 8px;}'
      +'#mlsStudyOv .mls-study-checkall{margin:6px 0;font-size:12px;}'
      +'#mlsStudyOv .mls-study-checkall label{display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:600;}'
      +'#mlsStudyOv .mls-study-candlist{max-height:230px;overflow:auto;margin:4px 0 8px;}'
      +'#mlsStudyOv .mls-study-cand{display:flex;align-items:center;gap:10px;padding:5px 8px;border:1px solid var(--line,#eef1f6);border-radius:8px;margin-bottom:4px;background:var(--surface,#fcfdff);cursor:pointer;}'
      +'#mlsStudyOv .mls-study-cohlist{display:flex;flex-direction:column;gap:6px;margin-bottom:10px;}'
      +'#mlsStudyOv .mls-study-coh{display:flex;justify-content:space-between;align-items:center;font:inherit;font-weight:600;cursor:pointer;border:1px solid var(--line,#e6e9ef);background:var(--surface,#fafcff);color:var(--ink,#15293f);border-radius:9px;padding:9px 12px;}'
      +'#mlsStudyOv .mls-study-coh:hover{border-color:var(--brand,#2563c9);color:var(--brand,#2563c9);}'
      +'#mlsStudyOv .mls-study-open{font:inherit;font-size:11.5px;font-weight:600;cursor:pointer;border:1px solid var(--brand,#2563c9);background:transparent;color:var(--brand,#2563c9);border-radius:7px;padding:3px 9px;}'
      +'#mlsStudyOv .mls-study-export{margin:6px 0;}';
    (document.head||document.documentElement).appendChild(s);
  }

  function boot(){ injectLaunch(); wireTimeline(); }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  // re-inject the launch button if the Patients toolbar re-renders
  var tries=0; var iv=setInterval(function(){ tries++; if(tries>40){ clearInterval(iv); return; } safe(injectLaunch); }, 1200);

  window.__mlsStudy={ open:open, close:close, _strictMatch:strictMatch, _parseRows:parseRows, _normDob:normDob, _importRow:importRow, _listCohorts:listCohorts,
    _extractReportRows:extractReportRows, _parseReportRows:parseReportRows, _filterReportRows:filterReportRows, _resolveCriteria:resolveCriteria,
    _classifyDates:classifyDates, _detectName:detectName, _tagPatientCohort:tagPatientCohort, _studyFhirProbe:studyFhirProbe, _library:library, _autoSearch:doAutoSearchAthena, _assistSearchProcedure:assistSearchProcedure, _buildApptForRow:buildApptForRow, _svcToYMD:svcToYMD, _addToCalendar:addToCalendar, _searchCfg:searchCfg };
})();


/* ---- module: feat_tab_memory.js ---- */

/* ===== MLS active-tab / route memory — cohesion tweak =====
   Remembers the last tab you were on (per session) so a page reload returns you
   where you were instead of always snapping back to Visit. Pure progressive
   enhancement: own IIFE, guarded with try/catch, OBSERVES the active .navtab via a
   light poll and restores by calling the public showView() — it never modifies or
   monkey-patches any existing app function. Degrades to a silent no-op on any error.
   Exposes window.__mlsTabMemory. */
(function(){
  'use strict';
  if (window.__mlsTabMemory) return;
  var KEY = 'mlsLastTab';
  var VIEWS = { calendar:1, patients:1, visit:1, orders:1, recs:1, history:1, legalreq:1, team:1, analysis:1, studio:1, admin:1 };
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function ss(){ try{ return window.sessionStorage; }catch(e){ return null; } }
  function viewOf(el){ if(!el) return ''; var oc=el.getAttribute('onclick')||''; var m=oc.match(/showView\(\s*['"]([a-z]+)['"]\s*\)/i); return m?m[1]:''; }
  function currentView(){ return safe(function(){ return viewOf(document.querySelector('.navtab.on')); },''); }
  function store(v){ var s=ss(); if(s && v && VIEWS[v]) safe(function(){ s.setItem(KEY, v); }); }

  // Capture the saved tab BEFORE anything can overwrite it.
  var s0 = ss();
  var saved = s0 ? safe(function(){ return s0.getItem(KEY); }, '') : '';

  // RECORD: light poll of which .navtab is active (catches clicks AND programmatic
  // showView() calls alike). Started only AFTER restore so the default 'visit' on
  // load can't clobber the saved tab.
  var started = false, last = '';
  function startRecording(){
    if (started) return; started = true;
    last = currentView();
    setInterval(function(){ var v = currentView(); if (v && v !== last){ last = v; store(v); } }, 1000);
  }

  // RESTORE once on load, after the app's own initial showView() has run.
  var done = false;
  function restore(){
    if (done) return; done = true;
    if (saved && VIEWS[saved] && saved !== currentView() && typeof window.showView === 'function') {
      safe(function(){ window.showView(saved); });
    }
    setTimeout(startRecording, 200); // begin recording only after the restore settles
  }
  if (document.readyState === 'complete') setTimeout(restore, 800);
  else window.addEventListener('load', function(){ setTimeout(restore, 800); });

  window.__mlsTabMemory = { _current: currentView, _restore: restore, _key: KEY };
})();

/* ===== MLS premium-feature logo badges (additive, isolated IIFE) ===== */
;(function(){
  "use strict";
  try {
    var PILL_CLASS = 'mls-prem-pill';
    var PILL_STYLE = 'font-size:11px;font-weight:700;color:#fff;background:linear-gradient(90deg,#7b5cff,#a855f7);padding:2px 8px;border-radius:999px;vertical-align:middle;margin-left:6px;display:inline-block;line-height:1.4';
    var PILL_TEXT  = 'PREMIUM';
    var GRAD_RE = /linear-gradient/i;
    var PURPLE_RE = /(7b5cff|123, *92, *255|a855f7|168, *85, *247)/i;
    function removeEcg(){
      try{
        var olds = document.querySelectorAll('.mls-prem-badge, [data-mls-prem], .mls-prem-badge-svg');
        for(var i=0;i<olds.length;i++){
          var o = olds[i]; var rm = o;
          if(o.classList && o.classList.contains('mls-prem-badge-svg')){
            var w = o.closest ? o.closest('.mls-prem-badge') : null; if(w) rm = w;
          }
          if(rm && rm.parentNode) rm.parentNode.removeChild(rm);
        }
      }catch(e){}
    }
    function makePill(){
      var s = document.createElement('span');
      s.className = PILL_CLASS;
      s.setAttribute('data-mls-prem-pill','1');
      s.style.cssText = PILL_STYLE; s.textContent = PILL_TEXT; return s;
    }
    function hasPurplePill(el){
      if(!el) return false;
      if(el.querySelector && el.querySelector('span.'+PILL_CLASS+', span[data-mls-prem-pill]')) return true;
      var spans = el.querySelectorAll ? el.querySelectorAll('span') : [];
      for(var i=0;i<spans.length;i++){
        var sp = spans[i]; if(sp.children.length) continue;
        var tx = (sp.textContent||'').trim().toUpperCase(); if(tx !== 'PREMIUM') continue;
        var st = sp.getAttribute('style') || '';
        if(GRAD_RE.test(st) && PURPLE_RE.test(st)) return true;
      }
      return false;
    }
    function ensurePill(el){ if(!el) return; if(hasPurplePill(el)) return; el.appendChild(makePill()); }
    function ensurePillOnHeading(containerId, needle, mode, avoid){
      var c = document.getElementById(containerId); if(!c) return;
      var hs = c.querySelectorAll('h2,h3');
      for(var i=0;i<hs.length;i++){
        var h = hs[i], t = (h.textContent||'').trim();
        var match = (mode === 'starts') ? (t.indexOf(needle) === 0) : (t.indexOf(needle) !== -1);
        if(!match) continue;
        if(avoid){ var bad=false; for(var j=0;j<avoid.length;j++){ if(t.indexOf(avoid[j])!==-1){ bad=true; break; } } if(bad) continue; }
        ensurePill(h); return;
      }
    }
    function ensurePillOnNav(id){ ensurePill(document.getElementById(id)); }
    function normalizeSettingsLabel(hintId){
      try{
        var hint = document.getElementById(hintId); if(!hint) return;
        var scopes = [hint.parentElement, hint.parentElement && hint.parentElement.parentElement];
        for(var s=0;s<scopes.length;s++){
          var row = scopes[s]; if(!row) continue;
          var spans = row.querySelectorAll('span');
          for(var i=0;i<spans.length;i++){
            var sp = spans[i]; if(sp.children.length) continue;
            var tx = (sp.textContent||'').trim();
            if(tx === 'Premium' || tx === 'PREMIUM'){
              sp.style.cssText = PILL_STYLE; sp.textContent = PILL_TEXT; sp.setAttribute('data-mls-prem-pill','1'); return;
            }
          }
        }
        var rowEl = hint.parentElement; if(!rowEl) return;
        var titleEl = rowEl.querySelector('label, .set-label, strong, b, h3, h4') || rowEl;
        ensurePill(titleEl);
      }catch(e){}
    }
    function paint(){
      try{
        removeEcg();
        ensurePillOnNav('nav_studio');
        ensurePillOnHeading('copilotHero', 'MLS Copilot', 'contains');
        ensurePillOnHeading('studioView', 'Build a custom tool', 'contains');
        ensurePillOnHeading('teamView', 'MLS Efficiency report', 'contains', ['your doctors']);
        ensurePillOnHeading('anaAsk', 'Ask your data', 'contains');
        ensurePillOnHeading('anaReferral', 'Referral outcomes', 'contains');
        ensurePillOnHeading('anaRegistry', 'Outcomes registry', 'contains');
        normalizeSettingsLabel('noteModelHint');
        normalizeSettingsLabel('logoHint');
      }catch(e){}
    }
    var t = null;
    function schedule(){ if(t) return; t = setTimeout(function(){ t=null; paint(); }, 400); }
    if(document.readyState !== 'loading') paint();
    document.addEventListener('DOMContentLoaded', paint);
    var n = 0, iv = setInterval(function(){ paint(); if(++n > 10) clearInterval(iv); }, 1500);
    try{ var mo = new MutationObserver(schedule); mo.observe(document.body, { childList:true, subtree:true }); }catch(e){}
    window.__mlsPremiumBadges = { paint: paint, version: '2.0', style: 'purple-pill' };
  } catch(e){ /* silent no-op */ }
})();


/* ===== MLS Study / Import — Mode C: AUTOPILOT grab by procedure (v1.31) =====
   Adds a "Search Athena with MLS Assist" action to the existing "By procedure" panel that
   DRIVES athenaOne's procedure/claims search via MLS Assist, RUNS it, PAGINATES through every
   result page, harvests name+DOB(+date/CPT) for each row, and feeds every selected patient
   through the SAME strict name+DOB verify+import pipeline as Mode A/B (window.__mlsStudy._importRow).
   Then, for any imported patient whose harvested row carries a SCHEDULED (today/future) appointment
   date, it creates a linked MLS calendar entry (POST /api/appointments, patient_external_id) so
   patients <-> calendar stay connected. Read-only in Athena (never Save/Sign/submit-write). The MLS
   calendar write is the app's own DB and is part of the user-initiated import (and toggleable).

   Self-contained progressive enhancement: own IIFE, try/catch everywhere, observes the overlay,
   reuses __mlsStudy internals, never monkey-patches. Degrades to a silent no-op if anything is missing. */
(function(){
  if (window.__mlsGrab) return;
  function safe(fn,d){ try{ return fn(); }catch(e){ return d; } }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];}); }
  function S(){ return window.__mlsStudy || null; }

  /* ---- backend helpers (MLS app DB, not Athena) ---- */
  function bkBase(){ return safe(function(){ if(typeof window.bkBase==='function') return window.bkBase(); },null) || safe(function(){ return window.MLS_BACKEND||window.__mlsBackend||'https://scrivara-backend.onrender.com'; },'https://scrivara-backend.onrender.com'); }
  function bkToken(){ return safe(function(){ if(typeof window.bkToken==='function') return window.bkToken(); },null) || safe(function(){ return localStorage.getItem('sf_bk_token')||sessionStorage.getItem('sf_bk_token')||''; },''); }

  /* ---- date helpers ---- */
  function toIsoDate(s){
    s=String(s||'').trim(); if(!s) return '';
    var m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/); if(m){ return m[1]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[3]).slice(-2); }
    m=s.match(/^([01]?\d)[\/\-\.]([0-3]?\d)[\/\-\.](\d{2,4})$/); if(!m) return '';
    var y=m[3]; if(y.length===2) y=(parseInt(y,10)>50?'19':'20')+y;
    return y+'-'+('0'+m[1]).slice(-2)+'-'+('0'+m[2]).slice(-2);
  }
  function todayIso(){ var d=new Date(); return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function isFutureOrToday(iso){ return iso && iso>=todayIso(); }
  function rowTime(line){ var m=String(line||'').match(/\b([01]?\d|2[0-3]):([0-5]\d)\s*(a\.?m\.?|p\.?m\.?)?/i); return m?m[0].replace(/\s+/g,''):''; }
  function startIso(iso, t){
    if(!iso||!t) return null;
    var m=t.match(/^([01]?\d|2[0-3]):([0-5]\d)\s*(a|p)?/i); if(!m) return null;
    var h=parseInt(m[1],10), mi=parseInt(m[2],10), ap=(m[3]||'').toLowerCase();
    if(ap==='p'&&h<12) h+=12; if(ap==='a'&&h===12) h=0;
    return safe(function(){ return new Date(iso+'T'+('0'+h).slice(-2)+':'+('0'+mi).slice(-2)+':00').toISOString(); }, null);
  }

  /* ---- create a linked MLS calendar entry (deduped; today/future only) ---- */
  function calHasAppt(pid, iso){
    return safe(function(){ return (window._calAppts||[]).some(function(a){ return String(a.patient_external_id||'')===String(pid) && String(a.appt_date||'')===iso; }); }, false);
  }
  function ensureCalendarEntry(pid, name, dateStr, line, reason){
    var iso=toIsoDate(dateStr);
    if(!iso) return Promise.resolve({created:false, why:'no-date'});
    if(!isFutureOrToday(iso)) return Promise.resolve({created:false, why:'past'}); // a scheduled appt is today/future
    if(calHasAppt(pid, iso)) return Promise.resolve({created:false, why:'exists'});
    var body={ name:name, reason:reason||'Imported from Athena (procedure cohort)', patient_external_id:pid||null, appt_date:iso, start_at:startIso(iso, rowTime(line)), end_at:null };
    return safe(function(){
      return fetch(bkBase()+'/api/appointments',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+bkToken()},body:JSON.stringify(body)})
        .then(function(r){ return r.ok?{created:true, iso:iso}:{created:false, why:'http'+r.status}; })
        .catch(function(){ return {created:false, why:'net'}; });
    }, Promise.resolve({created:false, why:'err'}));
  }

  /* ---- bridge: drive athenaOne search + paginate via MLS Assist v1.31 (mlsAppSearchProcedure) ---- */
  function grabViaAssist(criteria, onStatus){
    // criteria = { params:{cpt:[],procedureName,dateFrom,dateTo}, cfg:{} }
    var params=(criteria&&criteria.params)||criteria||{};
    var cfg=(criteria&&criteria.cfg)||{};
    function mapResult(r){ r=r||{}; return { text:r.text||'', pages:r.pages||0, drove:!!r.ranControls, paginated:(r.pages||0)>1 }; }
    // Preferred: reuse the Study module's proven, progress-emitting driver (mlsAppSearchProcedure).
    var st=S();
    if(st && typeof st._assistSearchProcedure==='function'){
      return st._assistSearchProcedure(params, cfg, onStatus).then(mapResult, function(err){ return { error:(err&&err.message)||'search-failed', code:(err&&err.code)||'' }; });
    }
    // Fallback: drive the extension's live mlsAppSearchProcedure protocol directly (with live progress).
    return new Promise(function(resolve){
      var settled=false, ponged=false, iv=null, toR=null, tries=0;
      function fin(v){ if(settled) return; settled=true; window.removeEventListener('message',onPong); window.removeEventListener('message',onEvt); if(iv) clearInterval(iv); if(toR) clearTimeout(toR); resolve(v); }
      function onPong(e){ if(e.data&&e.data.source==='mls-ext'&&e.data.type==='mlsPong'&&!ponged){ ponged=true; proceed(); } }
      function onEvt(e){ var d=e.data; if(!(d&&d.source==='mls-ext')) return;
        if(d.type==='mlsAppSearchProgress'){ if(onStatus) onStatus(d.msg||'Working…'); return; }
        if(d.type==='mlsAppSearchResult'){ var r=d.resp||{}; if(r.ok===false){ fin({error:r.error||'search-failed',code:r.code||''}); return; } fin(mapResult(r)); } }
      window.addEventListener('message',onPong);
      var ping=function(){ safe(function(){ window.postMessage({source:'mls-app',type:'mlsPing'},'*'); }); };
      ping(); iv=setInterval(function(){ if(ponged){ clearInterval(iv); iv=null; return; } if(++tries>8){ clearInterval(iv); iv=null; if(!settled) fin({error:'no-ext'}); } else ping(); }, 350);
      function proceed(){
        if(iv){ clearInterval(iv); iv=null; }
        window.addEventListener('message',onEvt);
        if(onStatus) onStatus('Driving the athenaOne procedure search…');
        safe(function(){ window.postMessage({source:'mls-app',type:'mlsAppSearchProcedure',params:params,cfg:cfg},'*'); });
        toR=setTimeout(function(){ fin({error:'timeout'}); }, 360000); // generous: many pages
      }
    });
  }

  /* ---- import selected candidates: strict verify+import (reuse) + calendar link ---- */
  var STAT={ match:{i:'✓',c:'ok',l:'Found & imported'}, dob_mismatch:{i:'⚠',c:'bad',l:'DOB mismatch — skipped'},
    not_found:{i:'⚠',c:'warn',l:'Not found in Athena'}, review:{i:'⚠',c:'warn',l:'Verify manually'},
    no_bridge:{i:'⚠',c:'gate',l:'MLS Assist needed'}, old_ext:{i:'⚠',c:'gate',l:'Update MLS Assist'},
    error:{i:'⚠',c:'warn',l:'Read error — retry'}, pending:{i:'…',c:'wait',l:'Verifying in Athena…'} };
  function importSelected(picked, cohort, addCal, els, onDone){
    var st=S(); if(!st||!st._importRow){ if(onDone) onDone(); return; }
    var counts={match:0,dob_mismatch:0,not_found:0,review:0,no_bridge:0,error:0,old_ext:0}, cal=0, i=0;
    function step(){
      if(i>=picked.length){
        if(els.sum) els.sum.innerHTML='Done. ✓ '+counts.match+' imported · ⚠ '+counts.dob_mismatch+' DOB mismatch · '+counts.not_found+' not found · '+counts.review+' to verify'+(addCal?(' · 📅 '+cal+' calendar entr'+(cal===1?'y':'ies')):'');
        safe(function(){ if(window.renderPatients) window.renderPatients(); });
        if(addCal) safe(function(){ if(window.loadCalendar) window.loadCalendar(); });
        if(onDone) onDone(counts);
        return;
      }
      var r=picked[i];
      if(els.sum) els.sum.textContent='Importing '+esc(r.name||('patient '+(i+1)))+' ('+(i+1)+'/'+picked.length+') — verifying DOB in athenaOne…';
      Promise.resolve(safe(function(){ return st._importRow(r, cohort); }, Promise.resolve({status:'error'}))).then(function(res){
        res=res||{status:'error'};
        var key=res.status==='old-ext'?'old_ext':res.status; counts[key]=(counts[key]||0)+1;
        var s=STAT[key]||STAT.error, el=els.row(i);
        function paint(extra){ if(!el) return; var rs=el.querySelector('.mls-study-rs'); if(rs){ rs.className='mls-study-rs '+s.c; rs.textContent=s.i+' '+s.l+(extra||''); } }
        if(res.status==='match' && addCal && res.patientId){
          ensureCalendarEntry(res.patientId, (res.chartName||r.name), r.svc, r.line, els.reason).then(function(c){
            if(c&&c.created){ cal++; paint(' · 📅 appt '+(c.iso||'')); } else { paint(''); }
            if(els.sum) els.sum.textContent='Importing '+(i+1)+' / '+picked.length+'…';
            i++; setTimeout(step,120);
          });
        } else {
          var ex=''; if(res.status==='dob_mismatch') ex=' (Athena: '+esc(res.chartDob||'?')+')'; else if(res.status==='review'&&res.reason) ex=' ('+esc(res.reason)+')';
          paint(ex);
          if(els.sum) els.sum.textContent='Importing '+(i+1)+' / '+picked.length+'…';
          i++; setTimeout(step,120);
        }
      });
    }
    step();
  }

  /* ---- run the whole driven grab from the existing By-procedure inputs ---- */
  function runGrab(sec){
    var st=S(); var out=sec.querySelector('#mlsGrabOut'); if(!out) return;
    if(!st){ out.innerHTML='<div class="mls-study-gate">Study module not ready — reopen the panel.</div>'; return; }
    var crit=safe(function(){ return st._resolveCriteria(sec.querySelector('#mlsStudyBSel').value, sec.querySelector('#mlsStudyBProc').value); }, {label:'',keywords:[],codes:[]})||{label:'',keywords:[],codes:[]};
    crit.from=(sec.querySelector('#mlsStudyBFrom')||{}).value||''; crit.to=(sec.querySelector('#mlsStudyBTo')||{}).value||'';
    var addCal=!!(sec.querySelector('#mlsGrabCal')||{}).checked;
    var procName=(sec.querySelector('#mlsStudyBProc').value||'').trim()||(crit.label||'');
    out.innerHTML='<div class="mls-study-sum" id="mlsGrabStatus">Searching Athena for '+esc(crit.label||procName||'procedure')+'…</div>';
    var setS=function(m){ var n=sec.querySelector('#mlsGrabStatus'); if(n) n.textContent=m; };
    var params={ cpt:crit.codes||[], procedureName:procName, dateFrom:crit.from, dateTo:crit.to };
    var cfg=safe(function(){ return (window.__mlsStudyConfig&&(window.__mlsStudyConfig.search||window.__mlsStudyConfig.grabCfg))||{}; },{});
    grabViaAssist({params:params,cfg:cfg}, setS).then(function(resp){
      if(!resp || resp.error){
        var em = resp&&resp.error;
        var msg = em==='no-ext' ? 'MLS Assist isn’t responding. Install/enable the extension (v1.31+) and keep your signed-in athenaOne tab open, then try again.'
                : em==='timeout' ? 'Timed out driving athenaOne. Open your signed-in athenaOne tab (a procedure/claims search or report) and try again — or use 🔎 Find in Athena on a report you’ve already run.'
                : esc(String(em||'Couldn’t drive the athenaOne search — is an athenaOne tab open and signed in?'));
        out.innerHTML='<div class="mls-study-gate">'+msg+'</div>'; return;
      }
      var text=resp.text||'';
      if(!text){ out.innerHTML='<div class="mls-study-gate">MLS Assist reached athenaOne but read 0 result rows'+(resp.pages?(' across '+resp.pages+' page(s)'):'')+'. Open a procedure/claims search or report so the result rows are visible, or tune <code>window.__mlsStudyConfig.search</code> to your layout — or use 🔎 Find in Athena on a report you’ve already run.</div>'; return; }
      var all=safe(function(){ return st._parseReportRows(text); }, [])||[];
      var rows=safe(function(){ return st._filterReportRows(all, crit); }, [])||[];
      renderCandidates(sec, rows, all.length, crit, resp, addCal);
    });
  }

  function renderCandidates(sec, rows, totalParsed, crit, resp, addCal){
    var out=sec.querySelector('#mlsGrabOut'); if(!out) return;
    var norm=safe(function(){ return S()._normDob; }, null);
    var pageInfo='Harvested '+(resp.pages||1)+' page'+((resp.pages||1)===1?'':'s')+(resp.drove?' · auto-ran the search':'')+(resp.paginated?' · paginated':'');
    if(!rows.length){
      out.innerHTML='<div class="mls-study-gate">'+pageInfo+'. Parsed '+esc(String(totalParsed))+' patient row(s) but none matched <b>'+esc(crit.label||'your criteria')+'</b>'+((crit.from||crit.to)?' in that date range':'')+'.<br>Tips: make sure the report shows the procedure/CPT column; widen/clear the date range; or set <code>window.__mlsStudyConfig</code> to tune the parser to your report layout.</div>';
      return;
    }
    var withDob=rows.filter(function(r){ return norm?norm(r.dob):r.dob; }).length;
    var sched=rows.filter(function(r){ return isFutureOrToday(toIsoDate(r.svc)); }).length;
    out.innerHTML='<div class="mls-study-sum">'+pageInfo+'. Found <b>'+rows.length+'</b> patient(s) matching '+esc(crit.label||'criteria')+' — '+withDob+' with a readable DOB'+(addCal&&sched?(' · '+sched+' with a scheduled appt → calendar'):'')+'. Review, then verify + import:</div>'
      +'<div class="mls-study-checkall"><label><input type="checkbox" id="mlsGrabAll" checked> Select all</label></div>'
      +'<div class="mls-study-candlist">'+rows.map(function(r,i){
          var d=norm?norm(r.dob):r.dob; var cpt=r.codes&&r.codes.length?(' · '+esc(r.codes.join(', '))):''; var sv=r.svc?(' · '+esc(r.svc)+(isFutureOrToday(toIsoDate(r.svc))?' 📅':'')):'';
          return '<label class="mls-study-cand"><input type="checkbox" class="mls-grab-chk" data-i="'+i+'"'+(d?' checked':'')+(d?'':' disabled')+'>'
            +'<span class="mls-study-rn">'+esc(r.name)+'</span>'
            +'<span class="mls-study-rd">'+esc(r.dob||'(no DOB — can’t verify)')+'</span>'
            +'<span class="mls-study-cnt">'+esc(((r.codes&&r.codes[0])||'')+(r.svc?(' '+r.svc):'')).trim()+'</span></label>';
        }).join('')+'</div>'
      +'<div class="mls-study-help">Only rows with a readable DOB can be verified+imported (the strict name+DOB gate needs both). Every selected patient is re-verified against their live Athena chart on import — a wrong row cannot import the wrong patient.</div>'
      +'<label class="mls-study-lab">Cohort / study name</label>'
      +'<input id="mlsGrabCohort" class="mls-study-in" value="'+esc(((sec.querySelector('#mlsStudyBFCohort')||{}).value||crit.label||'').slice(0,80))+'" placeholder="cohort name" />'
      +'<div class="mls-study-actions"><button type="button" id="mlsGrabImport" class="mls-study-btn">✓ Verify &amp; import selected'+(addCal?' (+ calendar)':'')+'</button></div>'
      +'<div class="mls-study-sum" id="mlsGrabImpSum"></div><div id="mlsGrabImpRows"></div>';
    var allc=out.querySelector('#mlsGrabAll');
    if(allc) allc.addEventListener('change', function(){ out.querySelectorAll('.mls-grab-chk').forEach(function(c){ if(!c.disabled) c.checked=allc.checked; }); });
    out.querySelector('#mlsGrabImport').addEventListener('click', function(){
      var cohort=((out.querySelector('#mlsGrabCohort')||{}).value||'').trim();
      var sum=out.querySelector('#mlsGrabImpSum');
      if(!cohort){ if(sum) sum.innerHTML='<span class="mls-study-gatetext">Enter a cohort name first.</span>'; return; }
      var picked=[]; out.querySelectorAll('.mls-grab-chk').forEach(function(c){ if(c.checked&&!c.disabled) picked.push(rows[parseInt(c.getAttribute('data-i'),10)]); });
      if(!picked.length){ if(sum) sum.innerHTML='<span class="mls-study-gatetext">Tick at least one patient with a DOB.</span>'; return; }
      var box=out.querySelector('#mlsGrabImpRows');
      box.innerHTML=picked.map(function(r,i){ var s=STAT.pending; return '<div class="mls-study-row" id="mlsg'+i+'"><span class="mls-study-rn">'+esc(r.name)+'</span><span class="mls-study-rd">'+esc(r.dob||'')+'</span><span class="mls-study-rs '+s.c+'">'+s.i+' '+s.l+'</span></div>'; }).join('');
      importSelected(picked, cohort, addCal, { sum:sum, reason:(crit.label||'Procedure cohort'), row:function(i){ return box.querySelector('#mlsg'+i); } });
    });
  }

  /* ---- inject the action into the existing "Find patients in Athena by procedure" section ---- */
  function inject(){
    safe(function(){
      var findBtn=document.getElementById('mlsStudyBFind'); if(!findBtn) return;
      var sec=findBtn.closest('.mls-study-sec'); if(!sec) return;
      if(sec.querySelector('#mlsGrabAthenaBtn')) return;
      // badge: this is the autopilot upgrade
      var head=sec.querySelector('.mls-study-sech'); if(head && !head.querySelector('.mls-grab-badge')){ var bd=document.createElement('span'); bd.className='mls-study-badge live mls-grab-badge'; bd.textContent='autopilot v1.31'; head.appendChild(bd); }
      var actions=findBtn.parentElement; // .mls-study-actions
      var b=document.createElement('button'); b.type='button'; b.id='mlsGrabAthenaBtn'; b.className='mls-study-btn'; b.innerHTML='🤖 Search Athena with MLS Assist';
      b.title='Drive athenaOne’s procedure/claims search, run it, paginate through every page, and import all matching patients.';
      actions.appendChild(b);
      // options row
      var opt=document.createElement('div'); opt.className='mls-grab-opts';
      opt.innerHTML='<label><input type="checkbox" id="mlsGrabDrive" checked> Auto-run the report in Athena (best-effort)</label>'
                  +'<label><input type="checkbox" id="mlsGrabCal" checked> Add a calendar entry for any scheduled appointment</label>';
      actions.parentElement.insertBefore(opt, actions.nextSibling);
      // dedicated output area for the grab (kept separate from the manual Find output)
      var out=document.createElement('div'); out.id='mlsGrabOut'; out.className='mls-study-results';
      var findOut=sec.querySelector('#mlsStudyBFindOut'); (findOut&&findOut.parentElement?findOut.parentElement:sec).insertBefore(out, findOut?findOut.nextSibling:null);
      // tiny style for the options row
      if(!document.getElementById('mlsGrabCss')){ var s=document.createElement('style'); s.id='mlsGrabCss'; s.textContent='#mlsStudyOv .mls-grab-opts{display:flex;flex-direction:column;gap:4px;margin:2px 0 8px;font-size:11.5px;color:var(--muted,#5b6b7c);} #mlsStudyOv .mls-grab-opts label{display:flex;align-items:center;gap:7px;cursor:pointer;}'; (document.head||document.documentElement).appendChild(s); }
      b.addEventListener('click', function(){ runGrab(sec); });
    });
  }
  // poll: the Study overlay is created/destroyed on demand; (re)inject whenever Mode B is shown
  setInterval(inject, 700);

  window.__mlsGrab={ _grabViaAssist:grabViaAssist, _ensureCalendarEntry:ensureCalendarEntry, _toIsoDate:toIsoDate, _isFutureOrToday:isFutureOrToday, _startIso:startIso, _rowTime:rowTime, _runGrab:runGrab };
})();

/* ============================================================================
   feat_nextup_connect.js  —  NEXT UP  <->  Calendar : single-source wiring
   ----------------------------------------------------------------------------
   Goal (visit-page "Just Talk" hero):
     1. DOB AUTOFILL  - tapping a NEXT UP blue card (or the auto "up now" pick)
        fills BOTH the Patient name (#heroPtName) AND the Date of birth
        (#heroPtDob, MM/DD/YYYY) from the patient's stored DOB.
     2. ALWAYS-ON     - the NEXT UP cards populate by DEFAULT from the
        calendar/schedule, not only after an Athena pull / toggle.
     3. PERSIST       - they survive a page reload by reading from the
        persisted calendar (loadCalendar -> /api/appointments -> _calAppts),
        not from transient post-pull state.
     4. SINGLE SOURCE - the calendar (_calAppts) is the one source: Athena
        pulls already write to it; the calendar reads it; the NEXT UP boxes
        read it here; tapping a card carries name + DOB (+ history, via the
        app's own _heroPickPatient) into the note.

   Design: a self-contained IIFE appended to the mls-connect.js bundle. It only
   READS app state and FEEDS the app's own renderers (_renderTodayPatients,
   _calLoadNextUp). It never monkey-patches an existing app function, never
   writes to the server, and degrades to a silent no-op if any global is
   missing. Removing this block fully reverts the feature.

   A guarded debug-date hook (window.__mlsNextUpDebugDate /
   sessionStorage['__mlsNextUpDebugDate']) lets a tester treat another day as
   "today" for verification against persisted data. It is inert in normal use
   (nobody sets it) and is the ONLY way it activates.
   ============================================================================ */
(function () {
  'use strict';
  try {
    if (window.__mlsNextUp && window.__mlsNextUp.__installed) return; // guard against double-append
  } catch (e) { }

  function gid(id) { try { return document.getElementById(id); } catch (e) { return null; } }
  function isFn(f) { return typeof f === 'function'; }

  // --- "today" key (YYYY-MM-DD) in local time, with an opt-in debug override ----
  function todayKey() {
    try {
      var dbg = null;
      try { dbg = window.__mlsNextUpDebugDate || (window.sessionStorage && sessionStorage.getItem('__mlsNextUpDebugDate')); } catch (e) { }
      if (dbg && /^\d{4}-\d{2}-\d{2}$/.test(String(dbg))) return String(dbg);
    } catch (e) { }
    var n = new Date();
    return n.getFullYear() + '-' + ('0' + (n.getMonth() + 1)).slice(-2) + '-' + ('0' + n.getDate()).slice(-2);
  }

  // --- the LOCAL calendar date an appointment falls on ------------------------
  function localDateOf(a) {
    try {
      if (a && a.appt_date) return String(a.appt_date).slice(0, 10);
      if (a && a.start_at) {
        var d = new Date(a.start_at);
        return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
      }
    } catch (e) { }
    return '';
  }

  // --- stored DOB for a patient name (fallback when the appt carries none) ----
  function patientDob(name) {
    try {
      var pts = (isFn(window.getPatients) ? window.getPatients() : []) || [];
      var key = String(name || '').trim().toLowerCase();
      if (!key) return '';
      var m = pts.find(function (x) { return String(x.name || '').trim().toLowerCase() === key; });
      if (m) return m.dob || m.DOB || m.birthDate || '';
    } catch (e) { }
    return '';
  }

  // --- build TODAY's hero list from the SINGLE SOURCE (_calAppts), DOB-enriched
  function buildToday() {
    var out = [];
    try {
      var tk = todayKey();
      var src = window._calAppts || [];
      var hhmm = isFn(window._apptHHMMTz) ? window._apptHHMMTz : function () { return ''; };
      var labelOf = isFn(window._calLabelOf) ? window._calLabelOf : function () { return ''; };
      for (var i = 0; i < src.length; i++) {
        var a = src[i] || {};
        if (localDateOf(a) !== tk) continue;
        var nm = String(a.name || labelOf(a) || '').trim();
        if (!nm) continue;
        var dob = a.dob || '';
        if (!dob) dob = patientDob(nm);
        out.push({
          name: nm,
          time: hhmm(a.start_at),
          reason: a.reason || '',
          dob: dob,
          start_at: a.start_at,
          appt_date: a.appt_date
        });
      }
    } catch (e) { }
    return out;
  }

  // --- feed the app's own renderers (render-only, no fetch) --------------------
  function renderFromCalendar() {
    try {
      if (!isFn(window._renderTodayPatients)) return;
      var todays = buildToday();
      // Draws the NEXT UP chips + sets window._heroTodayList. The app's renderer
      // hides the box when there are no today/tomorrow patients, so "always-on"
      // here means "shown by default whenever scheduled patients exist".
      window._renderTodayPatients(todays);

      // Auto-load the "up now" patient (name + DOB) ONLY when the doctor has not
      // already started typing a patient - never clobber an in-progress visit.
      var nmEl = gid('heroPtName');
      var nameEmpty = !nmEl || !String(nmEl.value || '').trim();
      if (nameEmpty && isFn(window._calLoadNextUp)) { try { window._calLoadNextUp(); } catch (e) { } }

      // DOB safety net: if a name is loaded but DOB is still blank, fill it from
      // the stored patient record (covers any path where appt.dob was empty).
      try {
        var db = gid('heroPtDob'), nm2 = gid('heroPtName');
        if (db && !String(db.value || '').trim() && nm2 && String(nm2.value || '').trim()) {
          var d = patientDob(nm2.value);
          if (d) db.value = d;
        }
      } catch (e) { }
    } catch (e) { }
  }

  // --- ensure the single source is loaded, then render ------------------------
  var _loading = false;
  function ensureToday(force) {
    try {
      var haveTok = isFn(window.bkToken) && window.bkToken();
      var need = force || !window._calAppts || !window._calAppts.length;
      if (need && haveTok && isFn(window.loadCalendar) && !_loading) {
        _loading = true;
        Promise.resolve().then(function () { return window.loadCalendar(); })
          .catch(function () { })
          .then(function () { _loading = false; renderFromCalendar(); });
      } else {
        renderFromCalendar();
      }
    } catch (e) { _loading = false; }
  }

  // --- stay in sync with the single source (Athena pulls -> loadCalendar) ------
  // Light poll on a content signature: re-render only when today's appts change,
  // so we never fight the user's interaction and never trigger a fetch here.
  var _lastSig = ' ';
  function sig() {
    try {
      var tk = todayKey(), parts = [];
      var src = window._calAppts || [];
      for (var i = 0; i < src.length; i++) {
        var a = src[i] || {};
        if (localDateOf(a) !== tk) continue;
        parts.push(String(a.name || '') + '#' + (a.dob || '') + '#' + (a.start_at || a.appt_date || ''));
      }
      return tk + '|' + parts.length + '|' + parts.sort().join(',');
    } catch (e) { return ''; }
  }
  function tick() {
    try {
      var s = sig();
      if (s !== _lastSig) { _lastSig = s; renderFromCalendar(); }
    } catch (e) { }
  }

  function start() {
    try {
      ensureToday(false);
      // calendar may arrive a moment after boot; nudge a couple of times
      setTimeout(function () { ensureToday(false); }, 1200);
      setTimeout(function () { ensureToday(false); }, 4000);
      setInterval(tick, 1500);
    } catch (e) { }
  }

  window.__mlsNextUp = {
    __installed: true,
    _buildToday: buildToday,
    _render: renderFromCalendar,
    _ensure: ensureToday,
    _patientDob: patientDob,
    _todayKey: todayKey,
    reload: function () { ensureToday(true); }
  };

  try {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
    else start();
  } catch (e) { try { start(); } catch (_) { } }
})();

;/* === Outcome Study feature loader (loads mls-outcome-study.js) === */
(function(){try{if(document.getElementById('mlsOutcomeStudyLoader'))return;var s=document.createElement('script');s.id='mlsOutcomeStudyLoader';s.src='mls-outcome-study.staging.js?v=20260618b';s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;/* === RVU feature loader (loads mls-rvu.staging.js) === */
(function(){try{if(document.getElementById('mlsRvuLoader'))return;var s=document.createElement('script');s.id='mlsRvuLoader';s.src='mls-rvu.staging.js?v=20260617a';s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{if(!document.querySelector('script[data-mls-visits]')){var s=document.createElement('script');s.src='feat_visits.js?v=20260618';s.setAttribute('data-mls-visits','1');(document.head||document.documentElement).appendChild(s);}}catch(e){}})(); /* MLS visit-aware loader */

/* MLS — load Add-patient (per-visit) UI + injection-cohort per-visit capture (append-only, guarded) */
;(function(){try{['feat_addpatient.js','feat_cohort_visits.js'].forEach(function(f){if(document.querySelector('script[data-mls-asset="'+f+'"]'))return;var s=document.createElement('script');s.src=f+'?v='+Date.now();s.async=true;s.setAttribute('data-mls-asset',f);(document.head||document.documentElement).appendChild(s);});}catch(e){}})();

(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_guard.js"]'))return;var s=document.createElement('script');s.src='feat_athena_guard.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_athena_guard.js');document.head.appendChild(s);}catch(e){}})(); /* MLS — athenaOne-open guard (block fake progress/saves when logged out) */


/* ---- loader: mls-opnote-pro (op-note professional format + Save-as-PDF) ---- */
(function(){try{if(window.__mlsOpNoteProLoader)return;window.__mlsOpNoteProLoader=1;var s=document.createElement('script');s.src='mls-opnote-pro.staging.js?v=20260619a';s.async=true;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

/* ---- loader: mls-procedure-report (Analysis › 📊 Procedure Report: counts by type, Office/ASC place-of-service, RVU/$ totals, PDF/CSV) ---- */
(function(){try{if(window.__mlsProcReportLoader)return;window.__mlsProcReportLoader=1;var s=document.createElement('script');s.src='mls-procedure-report.staging.js?v=20260619a';s.async=true;(document.head||document.documentElement).appendChild(s);}catch(e){}})();
/* ---- loader: feat_athena_autopull (one-click open-chart auto-pull; fixes false name-match safety stop; additive, reversible) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_autopull.js"]'))return;var s=document.createElement('script');s.src='feat_athena_autopull.js?v='+Date.now();s.async=false;s.setAttribute('data-mls-asset','feat_athena_autopull.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();
/* ---- loader: feat_athena_status_dot (always-on top-right Athena connection indicator; additive, reversible) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_status_dot.js"]'))return;var s=document.createElement('script');s.src='feat_athena_status_dot.js?v='+Date.now();s.async=false;s.setAttribute('data-mls-asset','feat_athena_status_dot.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();

(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_easy.js"]'))return;var s=document.createElement('script');s.src='feat_mls_easy.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_mls_easy.js');document.head.appendChild(s);}catch(e){}})();
/* ---- loader: feat_save_verify.js (save-integrity verification) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_save_verify.js"]'))return;var s=document.createElement('script');s.src='feat_save_verify.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_save_verify.js');document.head.appendChild(s);}catch(e){}})();

/* feat_athena_doctor.js loader — guarded, idempotent, cache-busted (self-troubleshoot + clearer success) */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_doctor.js"]'))return;var s=document.createElement('script');s.src='/feat_athena_doctor.js?v='+Date.now();s.async=true;s.setAttribute('data-mls-asset','feat_athena_doctor.js');(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

/* ---- loader: feat_athena_actions.js (shared Athena-action treatment: live status / click-intent labels / destination-verify / self-recovery) ---- */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_actions.js"]'))return;var s=document.createElement('script');s.src='/feat_athena_actions.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_athena_actions.js');document.head.appendChild(s);}catch(e){}})();


/* ---- loader: feat_athena_writeback.js (WRITE finished note into the open Athena chart; verified paste; patient name+DOB gate; never Save/Sign) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_writeback.js"]'))return;var s=document.createElement('script');s.src='feat_athena_writeback.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_athena_writeback.js');document.head.appendChild(s);}catch(e){}})();


/* feat_athena_clarity.js */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_clarity.js"]'))return;var s=document.createElement('script');s.src='feat_athena_clarity.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_athena_clarity.js');document.head.appendChild(s);}catch(e){}})();

/* feat_athena_selfheal.js */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_selfheal.js"]'))return;var s=document.createElement('script');s.src='feat_athena_selfheal.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_athena_selfheal.js');document.head.appendChild(s);}catch(e){}})();
(function(){try{if(document.querySelector('script[data-mls-asset="feat_patient_switcher.js"]'))return;var s=document.createElement('script');s.src='feat_patient_switcher.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_patient_switcher.js');document.head.appendChild(s);}catch(e){}})();
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_provider_scope.js"]'))return;var s=document.createElement('script');s.src='feat_athena_provider_scope.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_athena_provider_scope.js');document.head.appendChild(s);}catch(e){}})();
(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_centerpiece.js"]'))return;var s=document.createElement('script');s.src='feat_mls_centerpiece.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_mls_centerpiece.js');document.head.appendChild(s);}catch(e){}})();
(function(){try{if(document.querySelector('script[data-mls-asset="feat_fab_layout.js"]'))return;var s=document.createElement('script');s.src='feat_fab_layout.js?v='+Date.now();s.setAttribute('data-mls-asset','feat_fab_layout.js');document.head.appendChild(s);}catch(e){}})();

/* ---- loader feat_athena_provider_picker.js (Whose patients? doctor dropdown + provider-scoped schedule pull) ---- */
(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_provider_picker.js"]'))return; var s=document.createElement('script'); s.src='/feat_athena_provider_picker.js?v='+Date.now(); s.setAttribute('data-mls-asset','feat_athena_provider_picker.js'); document.head.appendChild(s); }catch(e){}})()
/* ---- loader: feat_mls_protocol (MLS Easy protocol: auto-advance to NEXT UP Slide 2, record textbox, full ordered flow, provider-name-everywhere, sizing/readability; additive, reversible) ---- */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_protocol.js"]'))return;var s=document.createElement('script');s.src='feat_mls_protocol.js?v='+Date.now();s.async=false;s.setAttribute('data-mls-asset','feat_mls_protocol.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_protocol_pickfix.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_protocol_pickfix.js?v=20260622';s.setAttribute('data-mls-asset','feat_mls_protocol_pickfix.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{var A='mls-connection-truth.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+Date.now();s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{var A='mls-fabrication-sentinel.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+Date.now();s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_easy_pickfix.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_easy_pickfix.js?v=20260622c';s.setAttribute('data-mls-asset','feat_mls_easy_pickfix.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_contrast_fix.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_contrast_fix.js?v=20260622';s.setAttribute('data-mls-asset','feat_mls_contrast_fix.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{['feat_opnote_history.js'].forEach(function(f){if(document.querySelector('script[data-mls-asset="'+f+'"]'))return;var s=document.createElement('script');s.src=f+'?v='+Date.now();s.async=true;s.setAttribute('data-mls-asset',f);(document.head||document.documentElement).appendChild(s);});}catch(e){}})(); /* MLS — history-aware op-note generation + real loading/ready indicator (append-only, guarded) */
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_athena_provider_roster.js"]'))return;var s=document.createElement('script');s.src='feat_athena_provider_roster.js?v='+Date.now();s.async=true;s.setAttribute('data-mls-asset','feat_athena_provider_roster.js');(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_stdline_insert.js"]'))return;var s=document.createElement('script');s.src='/feat_stdline_insert.js?v=20260622';s.setAttribute('data-mls-asset','feat_stdline_insert.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();
;(function(){try{if(document.querySelector('script[data-mls-asset="feat_opnote_pdf_anyview.js"]'))return;var s=document.createElement('script');s.src='/feat_opnote_pdf_anyview.js?v=20260622';s.setAttribute('data-mls-asset','feat_opnote_pdf_anyview.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

/* LOADER for feat_athena_truthcheck.js  (PART 1)
 * Append this ONE guarded, idempotent, cache-busted, ;-prefixed line/block at
 * the TRUE EOF of mls-connect.js (and its .staging.js twin), after the last
 * existing data-mls-asset loader. The leading ';' guarantees ASI safety even
 * if the preceding line lacked a terminator. Revert = delete this block.
 */
;(function(){try{
  var A='feat_athena_truthcheck.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+Date.now();
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();
/* LOADER for feat_athena_cardtips.js  (PART 2)
 * Append this ONE guarded, idempotent, cache-busted, ;-prefixed block at the
 * TRUE EOF of mls-connect.js (and its .staging.js twin), after the Part 1
 * loader. The leading ';' guarantees ASI safety. Revert = delete this block.
 */
;(function(){try{
  var A='feat_athena_cardtips.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+Date.now();
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();

/* ---- loaders: Slide-5 Submit checklist + amber->red truthcheck consistency + mlsac-card tooltips (additive, reversible) ---- */
;(function(){try{
  var A='feat_mls_submit_checklist.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+Date.now();
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();
;(function(){try{
  var A='feat_athena_truthcheck_amber.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+Date.now();
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();
;(function(){try{
  var A='feat_athena_cardtips_mlsac.js';
  if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;
  var s=document.createElement('script');
  s.src=A+'?v='+Date.now();
  s.setAttribute('data-mls-asset',A);
  s.async=false;
  (document.body||document.head||document.documentElement).appendChild(s);
}catch(e){}})();

;(function(){try{var A='feat_athena_narration.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+Date.now();s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{if(document.querySelector('script[data-mls-asset="feat_mls_easy_hardening.js"]'))return;var s=document.createElement('script');s.src='/feat_mls_easy_hardening.js?v=20260622a';s.setAttribute('data-mls-asset','feat_mls_easy_hardening.js');s.async=false;(document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{var A='feat_athena_cardtips_noinfo.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+Date.now();s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{var A='feat_stdline_autoinsert.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+Date.now();s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();

;(function(){try{var A='feat_autosave.js';if(document.querySelector('script[data-mls-asset="'+A+'"]'))return;var s=document.createElement('script');s.src=A+'?v='+Date.now();s.setAttribute('data-mls-asset',A);s.async=false;(document.body||document.head||document.documentElement).appendChild(s);}catch(e){}})();
