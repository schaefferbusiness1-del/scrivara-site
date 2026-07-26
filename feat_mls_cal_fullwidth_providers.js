/* feat_mls_cal_fullwidth_providers.js  (item64)
 * Two folded fixes for the Complex-view Calendar, on top of item63.
 * Additive, in-memory/CSS only, reversible. NEVER deletes/edits any record.
 *
 *  1) FULL-WIDTH LAYOUT: the whole app sits in a 1180px-max centered column
 *     (#appWrap.wrap), which leaves a big white gap to the right of the calendar.
 *     We widen that wrapper ONLY while the Calendar view is showing (CSS :has),
 *     so the month/week/day grid fills the available width cleanly and balanced,
 *     and snaps back to 1180px for every other view. Pure CSS, no JS reflow.
 *
 *  2) ACCURATE PROVIDERS + CORRECT PATIENTS:
 *     a) Left "PROVIDERS" roster: repaints from the REAL provider names actually
 *        present (appointment.provider strings via item63's __mlsCalProvNames, plus
 *        any genuinely-named /api/providers rows). Fabricated "Provider N" placeholders
 *        are dropped; when nothing real is stored yet it says so honestly instead of
 *        showing fake names.
 *     b) Clicking a provider in the roster scopes the calendar to THAT provider's
 *        appointments (drives item63's #calProvFilter / master list) — so selecting a
 *        provider shows that provider's correct patients.
 *     c) Appointment detail/peek "Provider:" now reads the stored real provider
 *        (appointment.provider) instead of always "Unassigned".
 *
 * Real provider names depend on the backend storing a provider per appointment, which
 * for EXISTING rows only happens after a fresh schedule re-pull (older rows are
 * provider:null until re-pulled). Until then this honestly shows "appears after a
 * re-pull" rather than inventing names.
 *
 * Revert: window.__mlsCalFullwidthProviders.revert()
 */
(function(){
  if (window.__mlsCalFullwidthProviders && window.__mlsCalFullwidthProviders.__on) return;

  var STYLE_ID = 'mls64-style';
  var origDocName = (typeof window._docName === 'function') ? window._docName : null;
  var origInfo    = (typeof window.calApptInfo === 'function') ? window.calApptInfo : null;
  var origPeek    = (typeof window.calApptPeek === 'function') ? window.calApptPeek : null;
  var timer = null;

  function esc(s){ try{ return (typeof window.esc==='function') ? window.esc(s) : String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }catch(e){ return String(s==null?'':s); } }

  function normProv(raw){
    raw = String(raw==null?'':raw).trim();
    if(!raw) return '';
    var m = raw.match(/^([A-Za-z'\-]+)_([A-Za-z'\-]+)_([A-Za-z\/\-]+)$/);
    if(m){ return m[2]+' '+m[1]+', '+m[3]; }
    var m2 = raw.match(/^([A-Za-z'\-]+)_([A-Za-z'\-]+)$/);
    if(m2){ return m2[2]+' '+m2[1]; }
    return raw;
  }
  function apptProv(a){
    if(!a) return '';
    return normProv(a.provider || a.provider_name || a.doctor_name || a.providerName || '');
  }
  function isPlaceholder(n){ return /^Provider\s*#?\s*\d+$/i.test(String(n||'').trim()); }

  /* ---------- 1) full-width CSS (calendar view only) ---------- */
  function injectCSS(){
    var css =
      '#appWrap.wrap:has(#calendarView[style*="block"]){max-width:min(1680px,96vw)!important;}' +
      '#calendarView .cx-main{width:100%;}' +
      '#calendarView .cx-prov-row{display:flex;align-items:center;gap:10px;margin-bottom:9px;width:100%;border:0;background:transparent;cursor:pointer;text-align:left;padding:3px 4px;border-radius:8px;font-family:inherit}' +
      '#calendarView .cx-prov-row:hover{background:#eef4fc}' +
      '#calendarView .cx-prov-row.cx-prov-on{background:#e6effd;outline:1px solid #EAF1EE}';
    var s = document.getElementById(STYLE_ID);
    if(!s){ s = document.createElement('style'); s.id = STYLE_ID; (document.head||document.documentElement).appendChild(s); }
    if(s.textContent !== css) s.textContent = css;
  }

  /* ---------- 2a/2b) providers roster from real names + clickable scoping ---------- */
  function realNames(){
    var out = [], seen = {};
    function add(n){ n = normProv(n); if(n && !isPlaceholder(n) && !seen[n.toLowerCase()]){ seen[n.toLowerCase()] = 1; out.push(n); } }
    (window.__mlsCalProvNames || []).forEach(add);                 // appt.provider strings (item63)
    (window._calProviders || []).forEach(function(p){ if(p && p.name) add(p.name); });  // genuinely-named API rows
    return out;
  }

  function scopeTo(name){
    window.__mls64Scope = name || '';
    var pf = document.getElementById('calProvFilter');
    if(pf){
      if(name && !Array.prototype.some.call(pf.options, function(o){ return o.value===name; })){
        var o = document.createElement('option'); o.value = name; o.textContent = name; pf.appendChild(o);
      }
      pf.value = name || '';
      pf.setAttribute('data-mls-scope', name || '');
      if(typeof pf.onchange === 'function'){ try{ pf.onchange(); return; }catch(e){} }
    }
    // fallback filter (mirror of item63's onchange) if the dropdown isn't wired yet
    try{
      var all = (window.__mlsCalAll && window.__mlsCalAll.length) ? window.__mlsCalAll : (window._calAppts || []);
      window.__mlsCalAll = (window.__mlsCalAll && window.__mlsCalAll.length) ? window.__mlsCalAll : all.slice();
      window._calAppts = name ? window.__mlsCalAll.filter(function(a){ return apptProv(a)===name; }) : window.__mlsCalAll.slice();
      if(typeof window.renderCalendar === 'function') window.renderCalendar();
    }catch(e){}
  }
  window.__mls64ScopeTo = scopeTo;   // used by roster row onclick

  function rosterHtml(names){
    var palette = ['#2E6A4B','#3B7C5A','#9B82D4','#e8833a','#d6457f','#0ea5b7'];
    var active = window.__mls64Scope || '';
    var h = '<div data-mls64root="1">';
    h += '<button class="cx-prov-row'+(active===''?' cx-prov-on':'')+'" onclick="window.__mls64ScopeTo &amp;&amp; window.__mls64ScopeTo(\'\')">' +
         '<span style="width:22px;height:22px;border-radius:6px;background:#8aa0b8;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px">All</span>' +
         '<span style="flex:1;color:#42566e;font-size:13px;font-weight:600">All providers</span></button>';
    names.forEach(function(nm, i){
      var parts = nm.replace(/^Dr\.?\s+/i,'').trim().split(/\s+/);
      var ini = (((parts[0]||'')[0]||'') + ((parts[1]||'')[0]||'')).toUpperCase() || '?';
      var col = palette[i % palette.length];
      var on = (active && active===nm) ? ' cx-prov-on' : '';
      h += '<button class="cx-prov-row'+on+'" onclick="window.__mls64ScopeTo &amp;&amp; window.__mls64ScopeTo('+JSON.stringify(nm).replace(/"/g,'&quot;')+')">' +
           '<span style="width:22px;height:22px;border-radius:6px;background:'+col+';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px">'+esc(ini)+'</span>' +
           '<span style="flex:1;color:#42566e;font-size:13px;font-weight:600">'+esc(nm)+'</span></button>';
    });
    // honest note when there are no real provider names yet (rows still provider:null until a re-pull)
    var anyStoredProv = (window.__mlsCalProvNames || []).length > 0;
    if(!anyStoredProv){
      h += '<div style="color:var(--muted);font-size:11.5px;font-weight:500;line-height:1.35;margin-top:6px">'+
           'Real provider names appear after a fresh schedule re-pull from Athena.</div>';
    }
    h += '</div>';
    return h;
  }

  function paintRoster(){
    try{
      var cv = document.getElementById('calendarView');
      if(!cv || cv.style.display==='none') return;
      var list = cv.querySelector('.cx-prov-list');
      if(!list) return;
      var names = realNames();
      var sig = names.join('|') + '#' + (window.__mls64Scope||'') + '#' + ((window.__mlsCalProvNames||[]).length>0?'1':'0');
      var mine = list.querySelector('[data-mls64root]');
      if(mine && list.getAttribute('data-mls64sig') === sig) return;   // already current
      list.innerHTML = rosterHtml(names);
      list.setAttribute('data-mls64sig', sig);
      // leave the redesign's own data-cx-h untouched so its guard keeps skipping (won't clobber us)
    }catch(e){}
  }

  /* ---------- 2c) appt detail/peek provider from the stored real provider ---------- */
  function wrapDocName(){
    if(!origDocName) return;
    window._docName = function(id){
      try{ if((id==null||id==='') && window.__mls64ProvHint) return window.__mls64ProvHint; }catch(e){}
      return origDocName.apply(this, arguments);
    };
  }
  function findAppt(id){ try{ return (window._calAppts||[]).find(function(x){ return String(x.id)===String(id); }) || (window.__mlsCalAll||[]).find(function(x){ return String(x.id)===String(id); }); }catch(e){ return null; } }

  function wrapInfo(){
    if(!origInfo) return;
    window.calApptInfo = function(id){
      try{ var a = findAppt(id); window.__mls64ProvHint = a ? apptProv(a) : ''; }catch(e){ window.__mls64ProvHint=''; }
      var r = origInfo.apply(this, arguments);
      window.__mls64ProvHint = '';
      return r;
    };
  }

  function wrapPeek(){
    if(!origPeek) return;
    window.calApptPeek = function(id, ev){
      var r = origPeek.apply(this, arguments);
      try{
        var a = findAppt(id); var pv = a ? apptProv(a) : '';
        if(pv){
          var pop = document.getElementById('calApptPeek');
          if(pop && !/Provider:/i.test(pop.textContent||'')){
            var line = document.createElement('div');
            line.style.cssText = 'font-size:12.5px;margin-top:3px';
            line.innerHTML = '<span style="color:#8a98a8">Provider:</span> '+esc(pv);
            // insert just before the action button row (last child), else append
            var btns = pop.querySelector('div[style*="flex-wrap:wrap"]:last-of-type');
            if(btns && btns.parentNode===pop){ pop.insertBefore(line, btns); } else { pop.appendChild(line); }
          }
        }
      }catch(e){}
      return r;
    };
  }

  /* ---------- install ---------- */
  function install(){
    injectCSS();
    wrapDocName();
    wrapInfo();
    wrapPeek();
    paintRoster();
    timer = setInterval(function(){ try{ injectCSS(); paintRoster(); }catch(e){} }, 1500);
  }

  window.__mlsCalFullwidthProviders = {
    __on: true,
    revert: function(){
      try{ var s=document.getElementById(STYLE_ID); if(s&&s.parentNode) s.parentNode.removeChild(s); }catch(e){}
      try{ if(origDocName) window._docName = origDocName; }catch(e){}
      try{ if(origInfo) window.calApptInfo = origInfo; }catch(e){}
      try{ if(origPeek) window.calApptPeek = origPeek; }catch(e){}
      try{ if(timer) clearInterval(timer); }catch(e){}
      try{ window.__mls64Scope=''; if(typeof window.__mls64ScopeTo==='function') window.__mls64ScopeTo(''); }catch(e){}
      try{ var cv=document.getElementById('calendarView'); var list=cv&&cv.querySelector('.cx-prov-list'); if(list){ list.removeAttribute('data-mls64sig'); list.removeAttribute('data-cx-h'); } }catch(e){}
      this.__on = false;
    }
  };

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', install); }
  else { install(); }
})();
