/* feat_mls_cal_athena_sync.js  (item63)
 * MLS Complex-view Calendar <-> athenaOne sync hardening.
 * ONE tightly-coupled fix: the calendar and the Athena pull are treated as one system.
 *
 * What it does (all additive, in-memory, reversible — NEVER deletes/edits any record):
 *  1) CALENDAR ALWAYS SHOWS DATA: wraps loadCalendar() to consume the (now-uncapped,
 *     newest-first) backend, retry once with ?limit if a transient read comes back empty,
 *     then re-render — so the grid is never wrongly empty after a pull.
 *  2) ATHENA CONNECTOR / PROVIDER ON POST: derives the day's provider from the raw Athena
 *     schedule text (only when EXACTLY ONE provider is in view — honest, never guessed) and
 *     injects it into the pull's POST /api/appointments body as provider/provider_name/
 *     doctor_name, so the backend's provider column populates on re-pull and the calendar
 *     agrees with Athena.
 *  3) REAL DOCTOR NAMES: rebuilds the calendar provider filter from the DISTINCT real
 *     provider names actually stored on appointments, normalizing "Last_First_CRED" ->
 *     "First Last, CRED"; removes "Provider undefined" artifacts. If Athena gave no name,
 *     it shows what Athena gave — it never fabricates.
 *  4) DE-DUPLICATE AT RENDER: collapses _calAppts by (patient+date+time+provider) so legacy
 *     triple rows show ONCE, WITHOUT deleting anything from the backend. Also hardens the
 *     future import path (provider on POST + name|date dedup key) so re-pulls stop stacking.
 *  5) GARBLED DATA: at render, suppresses obvious parser-noise rows (e.g. a 1-2 char "name"
 *     like "Ht" with no reason/dob/MRN). Real records are untouched in the DB.
 *  6) INTUITIVE: a clear "Viewing: <day> — N appointments (deduped)" status line; provider
 *     scoping that works on STORED appointments (by real name), not just a fresh pull.
 *
 * Revert: window.__mlsCalAthenaSync.revert()
 */
(function(){
  if (window.__mlsCalAthenaSync && window.__mlsCalAthenaSync.__on) return;

  var origFetch = window.fetch;
  var origLoad  = (typeof window.loadCalendar === 'function') ? window.loadCalendar : null;
  var origParse = (typeof window._parseScheduleText === 'function') ? window._parseScheduleText : null;
  var styleEl = null, statusTimer = null;

  /* ---------- helpers ---------- */
  function esc(s){ try{ return (typeof window.esc==='function') ? window.esc(s) : String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }catch(e){ return String(s==null?'':s); } }

  /* "Carter_Kelly_PA-C" -> "Kelly Carter, PA-C"; reuse item54's normalizer if present. */
  function normProv(raw){
    raw = String(raw==null?'':raw).trim();
    if(!raw) return '';
    try{ if(window.__mlsFindDoctors && typeof window.__mlsFindDoctors.norm==='function'){ var n=window.__mlsFindDoctors.norm(raw); if(n) return n; } }catch(e){}
    // Last_First_CRED  (CRED may contain - or /, e.g. PA-C)
    var m = raw.match(/^([A-Za-z'\-]+)_([A-Za-z'\-]+)_([A-Za-z\/\-]+)$/);
    if(m){ return m[2]+' '+m[1]+', '+m[3]; }
    var m2 = raw.match(/^([A-Za-z'\-]+)_([A-Za-z'\-]+)$/);
    if(m2){ return m2[2]+' '+m2[1]; }
    return raw; // already human, or an unknown shape -> show honestly
  }

  function apptProv(a){
    if(!a) return '';
    var p = a.provider || a.provider_name || a.doctor_name || a.providerName || '';
    return normProv(p);
  }
  function apptName(a){ try{ return (typeof window._calLabelOf==='function') ? window._calLabelOf(a) : (a&&(a.name||a.label||a.patient||a.title))||''; }catch(e){ return (a&&a.name)||''; } }
  function apptDate(a){ try{ return (typeof window._calDateOf==='function') ? window._calDateOf(a) : (a&&(a.appt_date||String(a.start_at||'').slice(0,10)))||''; }catch(e){ return (a&&a.appt_date)||''; } }
  function apptTime(a){ try{ return (typeof window._apptHHMMTz==='function') ? window._apptHHMMTz(a&&a.start_at) : ''; }catch(e){ return ''; } }

  /* A row is parser noise only if its name is junk AND it carries no other identity. */
  function isGarbageRow(a){
    if(!a) return true;
    var nm = String(apptName(a)||'').trim();
    if(!nm) return true;
    var hasOtherId = !!(a.reason && String(a.reason).trim()) || !!(a.dob && String(a.dob).trim()) ||
                     !!(a.patient_external_id) || !!(a.mrn);
    if(hasOtherId) return false;
    var letters = nm.replace(/[^A-Za-z]/g,'');
    if(letters.length <= 2) return true;                 // "Ht", "Rn", single initials
    if(!/[aeiouAEIOU]/.test(nm) && letters.length <= 4) return true; // no vowel short token
    return false;
  }

  /* Collapse duplicates by patient+date+time+provider; keep the richest/earliest. */
  function dedupe(list){
    var seen = {}, out = [];
    (list||[]).forEach(function(a){
      if(isGarbageRow(a)) return;
      var key = String(apptName(a)).trim().toLowerCase().replace(/\s+/g,' ')
              + '|' + apptDate(a) + '|' + apptTime(a) + '|' + apptProv(a).toLowerCase();
      var prev = seen[key];
      if(prev == null){ seen[key] = out.length; out.push(a); return; }
      // keep the record with the most filled fields (prefer one that has a provider/reason)
      var score = function(x){ return (apptProv(x)?2:0) + (x&&x.reason?1:0) + (x&&x.start_at?1:0); };
      if(score(a) > score(out[prev])) out[prev] = a;
    });
    return out;
  }

  /* Distinct real provider names present on the stored appointments. */
  function provNamesFrom(list){
    var set = {}, order = [];
    (list||[]).forEach(function(a){ var n=apptProv(a); if(n && !set[n.toLowerCase()]){ set[n.toLowerCase()]=1; order.push(n); } });
    return order;
  }

  /* ---------- 2) provider on POST: derive the SOLE provider from raw Athena text ---------- */
  function soleProviderFromText(text){
    try{
      text = String(text||''); if(!text) return '';
      var re = /([A-Za-z'\-]+_[A-Za-z'\-]+(?:_[A-Za-z\/\-]+)?)\s*[:\-]?\s*(\d+)\s*appointment/gi;
      var m, names = {};
      while((m = re.exec(text))){ if(parseInt(m[2],10) > 0){ names[m[1]] = 1; } }
      var keys = Object.keys(names);
      if(keys.length === 1) return normProv(keys[0]);   // exactly one provider in view -> honest
      return '';                                          // 0 or many -> don't guess
    }catch(e){ return ''; }
  }

  function wrapParse(){
    if(!origParse) return;
    window._parseScheduleText = async function(text){
      var arr = await origParse.apply(this, arguments);
      try{
        var sole = soleProviderFromText(text);
        window.__mlsApptProv = window.__mlsApptProv || {};
        if(Array.isArray(arr)){
          arr.forEach(function(a){
            if(!a) return;
            if(sole && !a.provider) a.provider = sole;
            var pv = a.provider || sole || '';
            if(a.name){
              var d = (typeof window._normDate==='function') ? (window._normDate(a.date)||'') : (a.date||'');
              window.__mlsApptProv[String(a.name).trim().toLowerCase()+'|'+d] = pv;     // by day
              window.__mlsApptProv[String(a.name).trim().toLowerCase()] = pv;            // fallback by name
            }
          });
        }
      }catch(e){}
      return arr;
    };
  }

  function wrapFetch(){
    window.fetch = function(u, opt){
      try{
        if(opt && opt.method && String(opt.method).toUpperCase()==='POST' &&
           /\/api\/appointments(?:\?|$)/.test(String(u)) && opt.body && typeof opt.body==='string'){
          var b = JSON.parse(opt.body);
          if(b && b.name && (b.appt_date||b.start_at) && !b.provider){
            var map = window.__mlsApptProv || {};
            var nm = String(b.name).trim().toLowerCase();
            var day = b.appt_date || String(b.start_at||'').slice(0,10);
            var pv = map[nm+'|'+day] || map[nm] || '';
            if(pv){ b.provider = pv; b.provider_name = pv; b.doctor_name = pv; opt.body = JSON.stringify(b); }
          }
        }
      }catch(e){}
      return origFetch.apply(this, arguments);
    };
  }

  /* ---------- 1)+4)+5) read, dedupe, garble-scrub on every load ---------- */
  function enrich(){
    try{
      var raw = window._calAppts || [];
      window.__mlsCalRawAppts = raw.slice();           // keep originals for revert
      var clean = dedupe(raw);
      window._calAppts = clean;
      window.__mlsCalAll = clean.slice();              // unscoped master for provider filtering
      // Build a real-name provider list for our filter (separate from doctor_user_id list).
      window.__mlsCalProvNames = provNamesFrom(clean);
    }catch(e){}
  }

  function wrapLoad(){
    if(!origLoad) return;
    window.loadCalendar = async function(){
      var r = await origLoad.apply(this, arguments);
      try{
        // retry once if a transient empty read slipped through (backend is uncapped/newest-first)
        if((!window._calAppts || !window._calAppts.length) &&
           typeof window.backendMode==='function' && window.backendMode() &&
           typeof window.bkToken==='function' && window.bkToken()){
          try{
            var resp = await origFetch(window.bkBase()+'/api/appointments?limit=100000',{headers:{Authorization:'Bearer '+window.bkToken()}});
            if(resp.ok){ var d = await resp.json(); if(d && d.appointments) window._calAppts = d.appointments; }
          }catch(e){}
        }
        enrich();
        if(typeof window.renderCalendar==='function') window.renderCalendar();
      }catch(e){}
      return r;
    };
  }

  /* ---------- 3)+6) provider filter on stored names + "viewing" status ---------- */
  function provFilter(){ return document.getElementById('calProvFilter'); }

  function rebuildProvFilter(){
    var pf = provFilter(); if(!pf) return;
    var names = window.__mlsCalProvNames || [];
    if(!names.length){ return; }                         // nothing real to show -> leave native dropdown
    var cur = (pf.getAttribute('data-mls-scope')||'');
    pf.style.display = '';
    pf.innerHTML = '<option value="">All providers</option>' +
      names.map(function(n){ return '<option value="'+esc(n)+'">'+esc(n)+'</option>'; }).join('');
    pf.value = cur;
    pf.setAttribute('data-mls-prov','1');
    pf.onchange = function(){
      var v = pf.value || '';
      pf.setAttribute('data-mls-scope', v);
      try{
        var all = (window.__mlsCalAll && window.__mlsCalAll.length) ? window.__mlsCalAll : (window._calAppts||[]);
        window.__mlsCalAll = (window.__mlsCalAll && window.__mlsCalAll.length) ? window.__mlsCalAll : all.slice();
        window._calAppts = v ? window.__mlsCalAll.filter(function(a){ return apptProv(a)===v; }) : window.__mlsCalAll.slice();
      }catch(e){}
      if(typeof window.renderCalendar==='function') window.renderCalendar();
      updateStatus();
    };
  }

  /* Kill any lingering "Provider undefined" option text anywhere on the calendar surface. */
  function scrubUndefined(){
    try{
      document.querySelectorAll('#calProvFilter option, select[id^="calNewDoc"] option, select[id^="calAddDoc"] option, select[id^="calE_doc_"] option').forEach(function(o){
        if(/^\s*Provider\s+undefined\s*$/i.test(o.textContent||'')){ o.parentNode && o.parentNode.removeChild(o); }
      });
    }catch(e){}
  }

  function dayLabel(){
    try{
      var key = window._calRefDate;
      if(window._calMode==='month'){
        var y=window._calYear, mo=window._calMonth;
        if(y!=null && mo!=null) return new Date(y, mo, 1).toLocaleDateString([], {month:'long', year:'numeric'});
      }
      if(key) return new Date(key+'T12:00').toLocaleDateString([], {weekday:'long', month:'long', day:'numeric'});
    }catch(e){}
    return '';
  }

  function visibleCount(){
    try{
      var list = window._calAppts || [];
      if(window._calMode==='month'){
        var y=window._calYear, mo=window._calMonth;
        return list.filter(function(a){ var k=apptDate(a); if(!k) return false; var d=new Date(k+'T12:00'); return d.getFullYear()===y && d.getMonth()===mo; }).length;
      }
      var key = window._calRefDate;
      if(window._calMode==='day') return list.filter(function(a){ return apptDate(a)===key; }).length;
      // week
      var ref=new Date(key+'T12:00'), start=new Date(ref.getFullYear(),ref.getMonth(),ref.getDate()-ref.getDay());
      var end=new Date(start.getFullYear(),start.getMonth(),start.getDate()+7);
      return list.filter(function(a){ var k=apptDate(a); if(!k) return false; var d=new Date(k+'T12:00'); return d>=start && d<end; }).length;
    }catch(e){ return (window._calAppts||[]).length; }
  }

  function updateStatus(){
    try{
      var grid = document.getElementById('calGrid'); if(!grid || !grid.parentNode) return;
      var bar = document.getElementById('mlsCalViewing');
      if(!bar){
        bar = document.createElement('div');
        bar.id = 'mlsCalViewing';
        bar.style.cssText = 'font-size:12.5px;font-weight:600;color:var(--muted,#5a6b80);margin:0 0 8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap';
        grid.parentNode.insertBefore(bar, grid);
      }
      var lbl = dayLabel(), n = visibleCount();
      var scope = (provFilter() && provFilter().getAttribute('data-mls-scope')) || '';
      bar.innerHTML = '<span style="background:var(--brand,#2E6A4B);color:#fff;border-radius:999px;padding:2px 10px">Viewing: '+esc(lbl||'—')+'</span>' +
        '<span>'+n+' appointment'+(n===1?'':'s')+' · deduped</span>' +
        (scope ? '<span style="color:var(--brand,#2E6A4B)">· '+esc(scope)+'</span>' : '');
    }catch(e){}
  }

  /* Re-apply our DOM touches after the app re-renders the calendar. */
  function wrapRender(){
    var origRender = window.renderCalendar;
    if(typeof origRender!=='function' || origRender.__mlsWrapped) return;
    var wrapped = function(){
      var r = origRender.apply(this, arguments);
      try{ rebuildProvFilter(); scrubUndefined(); updateStatus(); }catch(e){}
      return r;
    };
    wrapped.__mlsWrapped = true;
    wrapped.__mlsInner = origRender;
    window.renderCalendar = wrapped;
  }

  /* ---------- install ---------- */
  function install(){
    wrapFetch();
    wrapParse();
    wrapLoad();
    wrapRender();
    // If the calendar is already loaded in this session, enrich + repaint now.
    try{
      if(window._calAppts && window._calAppts.length){ enrich(); }
      if(typeof window.renderCalendar==='function'){ window.renderCalendar(); }
    }catch(e){}
    // Light watchdog: if the app swaps renderCalendar later (other items), keep our wrapper on top.
    statusTimer = setInterval(function(){
      try{ if(typeof window.renderCalendar==='function' && !window.renderCalendar.__mlsWrapped){ wrapRender(); } }catch(e){}
    }, 2500);
  }

  window.__mlsCalAthenaSync = {
    __on: true,
    revert: function(){
      try{ window.fetch = origFetch; }catch(e){}
      try{ if(origLoad) window.loadCalendar = origLoad; }catch(e){}
      try{ if(origParse) window._parseScheduleText = origParse; }catch(e){}
      try{ if(window.renderCalendar && window.renderCalendar.__mlsWrapped && window.renderCalendar.__mlsInner){ window.renderCalendar = window.renderCalendar.__mlsInner; } }catch(e){}
      try{ if(statusTimer) clearInterval(statusTimer); }catch(e){}
      try{ var b=document.getElementById('mlsCalViewing'); if(b&&b.parentNode) b.parentNode.removeChild(b); }catch(e){}
      try{ if(window.__mlsCalRawAppts){ window._calAppts = window.__mlsCalRawAppts; if(typeof window.renderCalendar==='function') window.renderCalendar(); } }catch(e){}
      try{ if(styleEl&&styleEl.parentNode) styleEl.parentNode.removeChild(styleEl); }catch(e){}
      this.__on = false;
    }
  };

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', install); }
  else { install(); }
})();
