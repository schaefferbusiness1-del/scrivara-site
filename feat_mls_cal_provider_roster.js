/* feat_mls_cal_provider_roster.js  (item66)
 * Calendar PROVIDERS roster = the SAME real providers as the Find Doctors dropdown,
 * a real full-width month grid, click-to-scope, and an honest empty-state.
 * Additive, in-memory/CSS only, reversible. Touches no records. Builds on item63/item64.
 *
 * (a) ROSTER SHOWS ALL ~18 REAL PROVIDERS. window._calProviders already holds them, but as
 *     MIXED entries: an object {name:"Michael Schaeffer"}, a normalized string
 *     "Matthew Schaeffer, MD", and raw machine strings "Carter_Kelly_PA-C", "Benner_John_MD"...
 *     item64 only read entry.name, so the string entries were dropped (roster showed just
 *     Michael). item65 normalizes EVERY entry shape and feeds the full list into the shared
 *     window.__mlsCalProvNames, so the roster AND the #calProvFilter dropdown both show all 18.
 *
 * (b) FULL-WIDTH MONTH GRID. item63's "Viewing:" status bar got inserted INSIDE #calSplitWrap,
 *     where (when the day panel is open) it consumed a grid cell and pushed the month grid into
 *     the narrow right column — a compressed, right-aligned grid with an empty left band.
 *     item65 forces #calSplitWrap to a single full-width column so the month grid always fills
 *     the available width (day detail stacks beneath it), and reinforces the wide app wrapper.
 *
 * (c) CLICK-TO-SCOPE + HONEST EMPTY STATE. Clicking a provider filters the calendar to
 *     appointments whose stored provider matches. REALITY: every existing appointment has
 *     provider = null (and doctor_user_id = null) and patient records carry no provider, so
 *     there is no patient->doctor mapping yet. Clicking a specific doctor therefore shows an
 *     honest "no appointments tagged to <doctor> yet" note, NOT a fabricated patient list.
 *     Per-doctor lists populate after a fresh per-provider re-pull from Athena (item63 stores
 *     the provider on the pull's POST). "All providers" always shows everyone.
 *
 * Revert: window.__mlsCalProviderRoster.revert()
 */
(function(){
  if (window.__mlsCalProviderRoster && window.__mlsCalProviderRoster.__on) return;

  var STYLE_ID = 'mls65-style';
  var timer = null, obs = null;

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
  function isPlaceholder(n){ return /^Provider\s*#?\s*\d+$/i.test(String(n||'').trim()); }
  function apptProv(a){ if(!a) return ''; return normProv(a.provider || a.provider_name || a.doctor_name || a.providerName || ''); }

  /* Single source of truth: normalize EVERY _calProviders entry (object or string). */
  function providerList(){
    var out = [], seen = {};
    function add(n){ n = normProv(n); if(!n || isPlaceholder(n) || seen[n.toLowerCase()]) return; seen[n.toLowerCase()] = 1; out.push(n); }
    (window._calProviders || []).forEach(function(e){
      if(e == null) return;
      if(typeof e === 'string') add(e);
      else add(e.name || e.displayName || e.label || '');
    });
    return out;
  }
  /* Feed the shared list so the #calProvFilter dropdown (item63) and item64 both see all 18. */
  function feedNames(){
    try{
      var names = providerList();
      var cur = window.__mlsCalProvNames || [];
      if(names.length && (cur.length !== names.length || cur.join('|') !== names.join('|'))){
        window.__mlsCalProvNames = names;
      }
      return names;
    }catch(e){ return (window.__mlsCalProvNames || []); }
  }

  /* ----- scope the calendar to one provider (or All) ----- */
  function ensureOption(pf, name){
    if(!name) return;
    if(!Array.prototype.some.call(pf.options, function(o){ return o.value === name; })){
      var o = document.createElement('option'); o.value = name; o.textContent = name; pf.appendChild(o);
    }
  }
  function scopeTo(name){
    name = name || '';
    window.__mls65scope = name;
    window.__mls64Scope = name;   // keep item64 in sync so it doesn't fight the roster
    var pf = document.getElementById('calProvFilter');
    var done = false;
    if(pf){
      ensureOption(pf, name);
      pf.value = name; pf.setAttribute('data-mls-scope', name);
      if(typeof pf.onchange === 'function'){ try{ pf.onchange(); done = true; }catch(e){} }
    }
    if(!done){
      try{
        var all = (window.__mlsCalAll && window.__mlsCalAll.length) ? window.__mlsCalAll : (window._calAppts || []);
        window.__mlsCalAll = (window.__mlsCalAll && window.__mlsCalAll.length) ? window.__mlsCalAll : all.slice();
        window._calAppts = name ? window.__mlsCalAll.filter(function(a){ return apptProv(a)===name; }) : window.__mlsCalAll.slice();
        if(typeof window.renderCalendar === 'function') window.renderCalendar();
      }catch(e){}
    }
    afterScope(name);
    paint();
  }
  window.__mls65ScopeTo = scopeTo;

  /* Honest banner when a doctor is selected but no appointment is tagged to them. */
  function afterScope(name){
    try{
      var cv = document.getElementById('calendarView'); if(!cv) return;
      var master = (window.__mlsCalAll && window.__mlsCalAll.length) ? window.__mlsCalAll : (window.__mlsCalRawAppts || window._calAppts || []);
      var matches = name ? master.filter(function(a){ return apptProv(a)===name; }).length : -1;
      var grid = document.getElementById('calGrid');
      var note = document.getElementById('mls65note');
      if(name && matches === 0){
        if(!note && grid && grid.parentNode){
          note = document.createElement('div'); note.id = 'mls65note';
          note.style.cssText = 'margin:0 0 10px;padding:10px 12px;border:1px solid #f3d9a6;background:#fff8ea;border-radius:10px;color:#7a5b16;font-size:12.5px;line-height:1.4';
          grid.parentNode.insertBefore(note, grid);
        }
        if(note) note.innerHTML = 'No appointments are tagged to <b>'+esc(name)+'</b> yet. Existing appointments were stored without a provider, so there is no patient&#8594;doctor mapping to filter by. Per&#8209;doctor lists fill in after a fresh per&#8209;provider re&#8209;pull from Athena. Click <b>All providers</b> to show everyone.';
      } else if(note && note.parentNode){
        note.parentNode.removeChild(note);
      }
    }catch(e){}
  }

  /* ----- roster paint (authoritative; coexists with item64 without flicker) ----- */
  function rosterHtml(names){
    var palette = ['#2E6A4B','#3B7C5A','#9B82D4','#e8833a','#d6457f','#0ea5b7','#5b6ee8','#11a36b'];
    var active = window.__mls65scope || '';
    // hidden data-mls64root sentinel + matching item64 sig keep item64's painter from clobbering us
    var h = '<div data-mls65root="1"><span data-mls64root="1" style="display:none"></span>';
    h += '<button class="cx-prov-row'+(active===''?' cx-prov-on':'')+'" onclick="window.__mls65ScopeTo &amp;&amp; window.__mls65ScopeTo(\'\')">' +
         '<span style="width:22px;height:22px;border-radius:6px;background:#8aa0b8;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px">All</span>' +
         '<span style="flex:1;color:#42566e;font-size:13px;font-weight:600">All providers</span></button>';
    names.forEach(function(nm, i){
      var parts = nm.replace(/^Dr\.?\s+/i,'').replace(/,.*$/,'').trim().split(/\s+/);
      var ini = (((parts[0]||'')[0]||'') + ((parts[1]||'')[0]||'')).toUpperCase() || '?';
      var col = palette[i % palette.length];
      var on = (active && active===nm) ? ' cx-prov-on' : '';
      h += '<button class="cx-prov-row'+on+'" onclick="window.__mls65ScopeTo &amp;&amp; window.__mls65ScopeTo('+JSON.stringify(nm).replace(/"/g,'&quot;')+')">' +
           '<span style="width:22px;height:22px;border-radius:6px;background:'+col+';display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:10px">'+esc(ini)+'</span>' +
           '<span style="flex:1;color:#42566e;font-size:13px;font-weight:600">'+esc(nm)+'</span></button>';
    });
    h += '</div>';
    return h;
  }

  function injectCSS(){
    if(document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style'); s.id = STYLE_ID;
    s.textContent = [
      /* reinforce the wide app wrapper on the calendar view */
      '#appWrap.wrap:has(#calendarView[style*="block"]){max-width:min(1680px,96vw)!important}',
      /* FULL-WIDTH MONTH GRID: collapse the split so the month grid always fills the width;
         the clicked-day detail panel stacks beneath it instead of squeezing it into a column */
      '#calendarView #calSplitWrap{display:block!important}',
      '#calendarView #calGrid{width:100%!important;max-width:100%!important}',
      '#calendarView #calGrid>div{width:100%!important;max-width:100%!important}',
      '#calendarView #calDayPanel{width:100%!important;max-width:100%!important;margin-top:14px!important}',
      /* the "Viewing:" bar spans full width even if it lands inside the split wrap */
      '#calendarView #calSplitWrap>#mlsCalViewing{grid-column:1 / -1!important;width:100%!important}',
      /* roster rows */
      '#calendarView .cx-prov-row{display:flex;align-items:center;gap:10px;margin-bottom:9px;width:100%;border:0;background:transparent;cursor:pointer;text-align:left;padding:3px 4px;border-radius:8px;font-family:inherit}',
      '#calendarView .cx-prov-row:hover{background:#eef4fc}',
      '#calendarView .cx-prov-row.cx-prov-on{background:#e6effd;outline:1px solid #bcd4f5}',
      '#calendarView .cx-prov-list{max-height:360px;overflow:auto}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(s);
  }

  function listEl(){ var cv = document.getElementById('calendarView'); return cv ? cv.querySelector('.cx-prov-list') : null; }

  function paint(){
    try{
      var names = feedNames();
      var list = listEl(); if(!list) return;
      var sig = names.join('|') + '#' + (window.__mls65scope || '');
      if(list.querySelector('[data-mls65root]') && list.getAttribute('data-mls65sig') === sig) { syncItem64Sig(list, names); return; }
      list.innerHTML = rosterHtml(names);
      list.setAttribute('data-mls65sig', sig);
      syncItem64Sig(list, names);
      ensureObserver(list);
    }catch(e){}
  }
  /* set the attribute item64's painter checks, so it treats the roster as current and skips */
  function syncItem64Sig(list, names){
    try{
      var anyStored = (window.__mlsCalProvNames || []).length > 0;
      var sig64 = names.join('|') + '#' + (window.__mls64Scope || '') + '#' + (anyStored ? '1' : '0');
      if(list.getAttribute('data-mls64sig') !== sig64) list.setAttribute('data-mls64sig', sig64);
    }catch(e){}
  }

  function ensureObserver(list){
    try{
      if(!list || list.__mls65obs) return;
      obs = new MutationObserver(function(){ paint(); });
      obs.observe(list, { childList:true });
      list.__mls65obs = true;
    }catch(e){}
  }

  function install(){
    injectCSS();
    feedNames();
    paint();
    timer = setInterval(function(){ try{ injectCSS(); paint(); }catch(e){} }, 1200);
  }

  window.__mlsCalProviderRoster = {
    __on: true,
    names: providerList,
    revert: function(){
      try{ if(timer) clearInterval(timer); }catch(e){}
      try{ if(obs) obs.disconnect(); }catch(e){}
      try{ var s=document.getElementById(STYLE_ID); if(s&&s.parentNode) s.parentNode.removeChild(s); }catch(e){}
      try{ var n=document.getElementById('mls65note'); if(n&&n.parentNode) n.parentNode.removeChild(n); }catch(e){}
      try{ var list=listEl(); if(list){ list.removeAttribute('data-mls65sig'); list.__mls65obs=false; } }catch(e){}
      try{ window.__mls65scope=''; }catch(e){}
      this.__on = false;
    }
  };

  if(document.readyState==='loading'){ document.addEventListener('DOMContentLoaded', install); }
  else { install(); }
})();
