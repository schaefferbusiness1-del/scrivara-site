/* ============================================================
   MLS-CONNECT — connectedness feature bundle (external)
   Loaded by ScribeFlow via a cache-busted <script> loader.
   Each feature is a self-contained IIFE, progressive-enhancement,
   guarded with try/catch, never modifies existing app functions.
   ============================================================ */


/* ---- module: feat_cmdk.js ---- */

/* ===== MLS Cmd-K Command Palette — connectedness feature #1 =====
   Global searchable palette (Cmd/Ctrl-K) to find any patient, visit/note, or action from anywhere
   and jump straight to it. Self-contained progressive enhancement: own IIFE, all external calls
   guarded, never modifies any existing app function, reads state through public globals
   (getPatients, patientNotes, setActivePtId, openPatient, showView). Degrades to a no-op if a
   global is missing. Keyboard: Cmd/Ctrl-K toggles, type to filter, Up/Down to move, Enter to open,
   Esc to close. Mobile-friendly. Exposes window.__mlsCmdK. */
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

  /* ----- command list (safe: navigation + confirmed globals only) ----- */
  function commands(){
    var cmds=[
      {label:'Calendar', hint:'Go to schedule', icon:'📅', run:function(){go('calendar');}},
      {label:'Patients', hint:'Patient list', icon:'👥', run:function(){go('patients');}},
      {label:'Visit', hint:'Capture a visit', icon:'🎙️', run:function(){go('visit');}},
      {label:'Orders', hint:'Orders', icon:'📋', run:function(){go('orders');}},
      {label:'Recommendations', hint:'AI recommendations', icon:'💡', run:function(){go('recs');}},
      {label:'History', hint:'Visit history', icon:'📚', run:function(){go('history');}},
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
    // newest first
    return out;
  }
  function buildIndex(){ return { patients:patientItems(), notes:noteItems(), cmds:commands() }; }

  /* ----- scoring ----- */
  function score(hay, q){
    hay=hay.toLowerCase();
    if(hay.indexOf(q)>=0) return 100 - hay.indexOf(q);
    // subsequence match
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
    var C=filterGroup(idx.cmds,q).slice(0, q?8:13);
    if(P.length) groups.push({label:'Patients', items:P});
    if(N.length) groups.push({label:'Visits & notes', items:N});
    if(C.length) groups.push({label:'Actions', items:C});
    flat=[]; groups.forEach(function(g){ g.items.forEach(function(it){ flat.push(it); }); });
    if(sel>=flat.length) sel=flat.length?flat.length-1:0;
    var html='';
    var fi=0;
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

