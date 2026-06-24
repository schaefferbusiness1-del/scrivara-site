/* feat_mls_redesign.js  ->  window.__mlsRedesign  (v2.0.0)
 * =====================================================================
 *  MLSscribe 2026 reskin v2 -- STRUCTURAL shell rebuild to match the
 *  exported design file exactly (dark navy top bar + flush nav row),
 *  plus the design's content styling. Additive + reversible.
 * =====================================================================
 *  HOW: builds the design's header structure (two flush rows on one dark
 *  navy bar) and RELOCATES the app's REAL controls into it -- the
 *  Simple|Complex toggle (#mlsViewToggle), the search (#mlsPqsInput), the
 *  Menu (#mlsTbMenuBtn) and the nav tabs (.navtab, which keep their
 *  onclick=showView and .on active state). Nothing is re-wired: the real,
 *  already-wired nodes are moved into design-styled slots, so every
 *  control keeps working. Content (cards, hero #visitHero, patient bar
 *  #patientBar, buttons, inputs, modals, badges, FAB) is matched via CSS.
 *
 *  APPEARANCE/LAYOUT ONLY. No handler is reimplemented; nothing is
 *  clicked, sent, or read (no PHI; no network). Idempotent. Reversible:
 *  window.__mlsRedesign.revert() removes styles + restores the original
 *  header/nav nodes to where they were.
 *
 *  Loaded last by mls-connect(.staging).js. ASCII-only. NUL-free.
 */
;(function () {
  "use strict";
  try { if (window.__mlsRedesign && window.__mlsRedesign.installed) return; } catch (e) { return; }
  var VERSION = "2.0.0", ASSET = "feat_mls_redesign.js";
  var FONT_ID = "mlsRdFont", STYLE_ID = "mlsRdStyle", CLS = "mls-redesign";
  var FONT_HREF = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap";
  var _obs = null, _t = null;
  function $(id){ try{return document.getElementById(id);}catch(e){return null;} }
  function mk(tag, css, html){ var e=document.createElement(tag); if(css)e.style.cssText=css; if(html!=null)e.innerHTML=html; return e; }

  /* ---------------- design CSS (content; shell is built inline) ---------------- */
  var CSS = [
"/* ===== MLSscribe 2026 reskin v2 ===== */",
":root{",
"  --bg:#eef2f7; --card:#ffffff; --ink:#0f2540; --muted:#6b7d93;",
"  --line:#e4ebf3; --brand:#2f6bed; --brand-dk:#2257cf;",
"  --green:#1f9d6b; --green-dk:#178a5c; --amber:#c2680f;",
"  --red:#d24447; --soft:#eef3fb; --soft2:#f8fafc;",
"  --gold:#a67c12; --gold-bg:#fff7ef;",
"  --header:#0d2138; --header-line:rgba(255,255,255,.10);",
"  --surface:#ffffff; --field-bg:#f8fafc;",
"  --shadow:0 1px 2px rgba(15,37,64,.04),0 10px 28px rgba(15,37,64,.05); --r-ctl:11px;",
"}",
"body.theme-dark{",
"  --bg:#0c1828; --card:#122036; --ink:#e7eef8; --muted:#9fb3cc; --line:#22344c;",
"  --brand:#4f93f2; --brand-dk:#6aa6f6; --green:#2fb986; --green-dk:#43d39c; --amber:#f0ad3c;",
"  --red:#e0606b; --soft:#16263c; --soft2:#13223a; --surface:#122036; --field-bg:#0e1b2d; --header:#0a1422;",
"}",
"body.mls-redesign{ background:var(--bg) !important; color:var(--ink);",
"  background-image:radial-gradient(circle at 12% -10%,#e4ecf6 0,rgba(238,242,247,0) 45%) !important; }",
"body.theme-dark.mls-redesign{ background-image:radial-gradient(circle at 12% -10%,#16263c 0,rgba(12,24,40,0) 45%) !important; }",
"body.mls-redesign, body.mls-redesign button, body.mls-redesign input, body.mls-redesign select,",
"body.mls-redesign textarea, body.mls-redesign .sf-select{ font-family:'Plus Jakarta Sans',system-ui,-apple-system,'Segoe UI',sans-serif !important; }",
"body.mls-redesign ::placeholder{ color:#9aa8bb; }",
"body.mls-redesign ::-webkit-scrollbar{ width:10px;height:10px; }",
"body.mls-redesign ::-webkit-scrollbar-thumb{ background:#cdd8e6;border-radius:8px;border:2px solid transparent;background-clip:padding-box; }",

"/* --- the original header inner bits we replace are hidden by JS; the new shell uses inline design styles --- */",
"/* nav tabs (relocated into #appHeader) styled to the design's flush dark row */",
"#appHeader.mlsRdHdr .mainnav{ display:flex !important; align-items:center !important; gap:4px !important;",
"  height:46px !important; background:transparent !important; border:0 !important; box-shadow:none !important;",
"  border-radius:0 !important; padding:0 !important; margin:0 !important; overflow:visible !important; flex-wrap:nowrap; }",
"#appHeader.mlsRdHdr .navtab{ flex:0 0 auto !important; min-width:0 !important; height:32px !important;",
"  padding:0 13px !important; border-radius:9px !important; font-weight:600 !important; font-size:13.5px !important;",
"  color:#adc2dd !important; background:transparent !important; border:0 !important; box-shadow:none !important;",
"  align-items:center !important; gap:7px !important; white-space:nowrap; transition:background .12s,color .12s; }",
"#appHeader.mlsRdHdr .navtab:not([style*='display:none']):not([style*='display: none']):not(.nav-feat-off){ display:flex !important; }",
"#appHeader.mlsRdHdr .navtab:hover{ background:rgba(255,255,255,.07) !important; color:#fff !important; }",
"#appHeader.mlsRdHdr .navtab.on{ background:rgba(95,227,207,.16) !important; color:#7ff0de !important; font-weight:700 !important; }",
"#appHeader.mlsRdHdr .navtab .nbadge{ background:rgba(255,255,255,.10) !important; color:#9fc0ff !important;",
"  border-radius:20px !important; font-size:11px !important; padding:1px 8px !important; font-weight:700 !important; }",
"#appHeader.mlsRdHdr .navtab.on .nbadge{ background:#5fe3cf !important; color:#0d2138 !important; }",
"#appHeader.mlsRdHdr #nav_studio{ margin-left:auto !important; height:30px !important;",
"  background:linear-gradient(135deg,#7c3aed,#a855f7) !important; color:#fff !important; font-weight:700 !important;",
"  border-radius:8px !important; padding:0 12px !important; }",
"#appHeader.mlsRdHdr #nav_studio .nbadge{ background:rgba(255,255,255,.25) !important; color:#fff !important; }",
"#appHeader.mlsRdHdr #nav_help{ color:#9fb4ce !important; }",
"#appHeader.mlsRdHdr #nav_help.on{ background:transparent !important; color:#fff !important; }",

"/* --- cards / panels --- */",
"body.mls-redesign .card{ border:1px solid var(--line) !important; border-radius:18px !important;",
"  box-shadow:0 1px 2px rgba(15,37,64,.04),0 10px 30px rgba(15,37,64,.05) !important; }",
"body.theme-dark.mls-redesign .card{ box-shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.4) !important; }",
"body.mls-redesign .card>h2 .ic{ background:var(--soft) !important; border-radius:9px !important; }",

"/* --- buttons --- */",
"body.mls-redesign .btn-primary{ background:linear-gradient(135deg,#2f6bed,#2257cf) !important; color:#fff !important; border:none !important; border-radius:11px !important; font-weight:700 !important; box-shadow:0 10px 22px -10px rgba(47,107,237,.6) !important; }",
"body.mls-redesign .btn-primary:hover{ filter:brightness(1.05); }",
"body.mls-redesign .btn-green{ background:linear-gradient(135deg,#1f9d6b,#178a5c) !important; color:#fff !important; border:none !important; border-radius:11px !important; font-weight:700 !important; box-shadow:0 10px 22px -10px rgba(31,157,107,.6) !important; }",
"body.mls-redesign .btn-green:hover{ filter:brightness(1.05); }",
"body.mls-redesign .btn-red{ background:linear-gradient(135deg,#e0606b,#d24447) !important; color:#fff !important; border:none !important; border-radius:11px !important; font-weight:700 !important; }",
"body.mls-redesign .btn-gold{ background:linear-gradient(135deg,#e7c48f,#d8b574) !important; color:#6b4e16 !important; border:1px solid #e6c98a !important; border-radius:11px !important; font-weight:700 !important; }",
"body.mls-redesign .btn-ghost,body.mls-redesign .btn-white{ border-radius:11px !important; }",
"body.mls-redesign .btn-ghost{ background:var(--card) !important; color:var(--brand) !important; border:1px solid var(--line) !important; font-weight:600 !important; }",
"body.mls-redesign .btn-ghost:hover{ background:var(--soft) !important; border-color:var(--brand) !important; }",

"/* --- inputs --- */",
"body.mls-redesign input[type=text],body.mls-redesign input[type=password],body.mls-redesign input[type=email],",
"body.mls-redesign input[type=date],body.mls-redesign input[type=time],body.mls-redesign input[type=number],",
"body.mls-redesign input[type=search],body.mls-redesign input[type=tel],body.mls-redesign textarea,",
"body.mls-redesign select,body.mls-redesign .sf-select{ border-radius:11px !important; }",
"body.mls-redesign .sf-select:focus,body.mls-redesign input:focus,body.mls-redesign textarea:focus,body.mls-redesign select:focus{ border-color:var(--brand) !important; box-shadow:0 0 0 3px rgba(47,107,237,.16) !important; outline:none !important; }",

"/* --- badges --- */",
"body.mls-redesign .badge{ border-radius:20px !important; }",
"body.mls-redesign .badge.draft{ background:#fff7ef !important; color:#c2680f !important; border:1px solid #ffe0c2 !important; }",
"body.mls-redesign .badge.signed{ background:#e8f7f0 !important; color:#178a5c !important; border:1px solid #c5ecd9 !important; }",

"/* --- patient context bar -> design --- */",
"body.mls-redesign #patientBar{ background:#fff !important; border:1px solid #e4ebf3 !important; border-radius:16px !important; box-shadow:0 1px 2px rgba(15,37,64,.04) !important; gap:14px !important; padding:14px 18px !important; }",
"body.mls-redesign #patientBar .pname{ color:#0f2540 !important; font-weight:700 !important; }",

"/* --- visit hero -> design dark teal --- */",
"body.mls-redesign #visitHero{ background:linear-gradient(135deg,#0d2138 0%,#143560 55%,#15406f 100%) !important; color:#fff !important; border:0 !important; border-radius:22px !important; box-shadow:0 22px 50px -22px rgba(13,33,56,.6) !important; }",
"body.mls-redesign #visitHero h1,body.mls-redesign #visitHero h2{ font-family:'Newsreader',Georgia,serif !important; font-weight:500 !important; }",
"body.mls-redesign #visitHero input{ background:rgba(255,255,255,.96) !important; color:#0f2540 !important; border:0 !important; border-radius:11px !important; }",
"body.mls-redesign #visitHero #heroRecBtn{ background:linear-gradient(135deg,#19b8a6,#13a18f) !important; color:#fff !important; border:0 !important; box-shadow:0 10px 22px -8px rgba(25,184,166,.7) !important; }",

"/* --- modals --- */",
"body.mls-redesign .modal{ background:var(--surface) !important; border:1px solid var(--line) !important; border-radius:20px !important; box-shadow:0 40px 90px -30px rgba(0,0,0,.5) !important; }",
"body.mls-redesign .set-tab.on{ background:linear-gradient(135deg,#2f6bed,#2257cf) !important; color:#fff !important; border-radius:11px !important; box-shadow:0 8px 18px -8px rgba(47,107,237,.6) !important; }",

"/* --- auth/sign-in --- */",
"body.mls-redesign .auth-wrap{ background:linear-gradient(135deg,#0d2138 0%,#143560 100%) !important; }",
"body.mls-redesign .auth-card{ background:#fff !important; border-radius:20px !important; box-shadow:0 40px 90px -30px rgba(0,0,0,.6) !important; }",

"/* --- FABs kept + restyled --- */",
"body.mls-redesign #mls-assist-badge{ background:linear-gradient(135deg,#2f6bed,#19b8a6) !important; color:#fff !important; border:none !important; border-radius:30px !important; font-weight:700 !important; box-shadow:0 14px 30px -10px rgba(47,107,237,.6) !important; }",
"body.mls-redesign #mlsAddPtLauncher{ background:linear-gradient(135deg,#0d2138,#15406f) !important; color:#fff !important; border:1px solid rgba(255,255,255,.12) !important; border-radius:30px !important; font-weight:700 !important; box-shadow:0 14px 30px -12px rgba(13,33,56,.6) !important; }",
"body.mls-redesign #mlsAddPtLauncher *{ color:#fff !important; }",

"/* --- toasts --- */",
"body.mls-redesign #mlsTip,body.mls-redesign .mls-toast,body.mls-redesign .toast{ background:#0f2540 !important; color:#fff !important; border:1px solid rgba(255,255,255,.1) !important; border-radius:14px !important; box-shadow:0 18px 40px -12px rgba(13,33,56,.55) !important; }",
"body.mls-redesign .empty{ border:1.5px dashed #d8e1ec !important; background:#f9fbfd !important; border-radius:14px !important; }"
  ].join("\n");

  /* ---------------- font + style injection ---------------- */
  function injectFonts(){ try{ if($(FONT_ID))return; var h=document.head||document.documentElement;
    var p1=mk('link'); p1.rel='preconnect'; p1.href='https://fonts.googleapis.com';
    var p2=mk('link'); p2.rel='preconnect'; p2.href='https://fonts.gstatic.com'; p2.crossOrigin='anonymous';
    var l=mk('link'); l.id=FONT_ID; l.rel='stylesheet'; l.href=FONT_HREF; h.appendChild(p1);h.appendChild(p2);h.appendChild(l);}catch(e){} }
  function injectCSS(){ try{ var s=$(STYLE_ID); if(!s){s=mk('style');s.id=STYLE_ID;(document.head||document.documentElement).appendChild(s);} if(s.textContent!==CSS)s.textContent=CSS; }catch(e){} }
  function mark(){ try{document.documentElement.classList.add(CLS); if(document.body)document.body.classList.add(CLS);}catch(e){} }

  /* ---------------- design shell (header + flush nav) ---------------- */
  var LOGO_SVG='<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h3l2.5 7L13 4l2.5 12L18 9h3"/></svg>';
  var SEARCH_ICON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8aa4c4" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
  var MENU_ICON='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#9fc0ff" stroke-width="2.2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';

  function buildShell(){
    var hdr=$('appHeader'); if(!hdr) return false;
    hdr.classList.add('mlsRdHdr');
    hdr.style.cssText='position:sticky;top:0;z-index:60;background:linear-gradient(180deg,#0d2138 0%,#102a48 100%);border-bottom:1px solid rgba(255,255,255,.07);box-shadow:0 1px 0 rgba(255,255,255,.04)';

    var top=$('mlsRdTop');
    if(!top){
      // hide original inner children (keep in DOM so handlers/hidden tool buttons survive)
      [].slice.call(hdr.children).forEach(function(c){ if(c.id!=='mlsRdTop'&&c.id!=='mlsRdNav'){ c.setAttribute('data-mlsrd-hid','1'); c.style.display='none'; } });
      // ---- ROW 1 ----
      top=mk('div','max-width:1500px;margin:0 auto;padding:0 28px;height:68px;display:flex;align-items:center;gap:22px'); top.id='mlsRdTop';
      // logo
      var logo=mk('div','display:flex;align-items:center;gap:12px',
        '<div style="width:38px;height:38px;border-radius:10px;background:linear-gradient(140deg,#19b8a6,#2f6bed);display:flex;align-items:center;justify-content:center;box-shadow:0 6px 18px rgba(47,107,237,.35)">'+LOGO_SVG+'</div>'+
        '<div style="line-height:1.05"><div style="display:flex;align-items:center;gap:8px"><span style="color:#fff;font-weight:800;font-size:19px;letter-spacing:-.01em">MLS</span><span style="color:#9fc0ff;font-size:11px;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Scribe</span></div><div style="color:#8aa4c4;font-size:11.5px;font-weight:500">Ambient AI medical scribe</div></div>');
      top.appendChild(logo);
      // toggle slot
      var tgSlot=mk('div','display:flex;align-items:center'); tgSlot.id='mlsRdToggleSlot'; top.appendChild(tgSlot);
      // search slot
      var seSlot=mk('div','flex:0 0 auto;width:min(360px,34vw);min-width:120px;margin-left:8px;position:relative'); seSlot.id='mlsRdSearchSlot';
      seSlot.appendChild(mk('span','position:absolute;left:14px;top:50%;transform:translateY(-50%);pointer-events:none;display:flex',SEARCH_ICON));
      top.appendChild(seSlot);
      top.appendChild(mk('div','flex:1'));
      // menu slot
      var meSlot=mk('div','display:flex;align-items:center'); meSlot.id='mlsRdMenuSlot'; top.appendChild(meSlot);
      // avatar
      var initials='MS'; var name='Account'; var plan='';
      try{ var w=$('whoLabel'); if(w&&w.textContent.trim()){ name=w.textContent.trim(); } }catch(e){}
      var av=mk('div','display:flex;align-items:center;gap:10px;padding-left:6px;cursor:pointer',
        '<div style="width:36px;height:36px;border-radius:50%;background:linear-gradient(140deg,#2f6bed,#19b8a6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:700;font-size:13px">'+initials+'</div>'+
        '<div style="line-height:1.15"><div style="color:#fff;font-size:13px;font-weight:600;max-width:170px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+name+'</div><div style="color:#8aa4c4;font-size:11.5px">Settings</div></div>');
      av.title='Settings'; av.addEventListener('click',function(){ try{ if(typeof window.openSettings==='function') window.openSettings(); }catch(e){} });
      top.appendChild(av);
      // ---- ROW 2 (nav) ----
      var navWrap=mk('div','max-width:1500px;margin:0 auto;padding:0 28px'); navWrap.id='mlsRdNav';
      hdr.appendChild(top); hdr.appendChild(navWrap);
    }
    // relocate real controls into slots (idempotent: appendChild moves)
    var tgSlot=$('mlsRdToggleSlot'), seSlot=$('mlsRdSearchSlot'), meSlot=$('mlsRdMenuSlot'), navWrap=$('mlsRdNav');
    var vt=$('mlsViewToggle'); if(vt && tgSlot && vt.parentElement!==tgSlot){ styleToggle(vt); tgSlot.appendChild(vt); }
    var se=$('mlsPqsInput'); if(se && seSlot && se.parentElement!==seSlot){ styleSearch(se); seSlot.appendChild(se);
      if(!$('mlsRdKbd')){ var k=mk('kbd','position:absolute;right:12px;top:50%;transform:translateY(-50%);color:#8aa4c4;font-size:11px;border:1px solid rgba(255,255,255,.16);border-radius:5px;padding:2px 7px','/'); k.id='mlsRdKbd'; seSlot.appendChild(k); } }
    var meWrap=$('mlsTbMenu'); var meBtn=$('mlsTbMenuBtn');
    if(meWrap && meSlot && meWrap.parentElement!==meSlot){ meWrap.style.position='relative'; if(meBtn) styleMenu(meBtn); meSlot.appendChild(meWrap); }
    else if(!meWrap && meBtn && meSlot && meBtn.parentElement!==meSlot){ styleMenu(meBtn); meSlot.appendChild(meBtn); }
    var nav=document.querySelector('.mainnav'); if(nav && navWrap && nav.parentElement!==navWrap){ navWrap.appendChild(nav); }
    return true;
  }
  function styleToggle(vt){ try{ vt.style.cssText='display:flex;align-items:center;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:11px;padding:3px;gap:2px';
    [].slice.call(vt.children).forEach(function(b){ var on=/mlsVtOn/.test(b.className);
      b.style.cssText='display:flex;align-items:center;height:32px;padding:0 16px;border:0;border-radius:8px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;'+(on?'background:#fff;color:#0f2540;box-shadow:0 1px 3px rgba(0,0,0,.25);':'background:transparent;color:#9fb4ce;'); }); }catch(e){} }
  function styleSearch(se){ try{ se.style.cssText='width:100%;height:42px;border-radius:11px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:#fff;padding:0 40px;font-size:13.5px;font-family:inherit;outline:none'; se.classList.add('mlsRdSearch'); try{se.placeholder='Find anything \u2014 patients, notes, codes\u2026';}catch(e){} }catch(e){} }
  function styleMenu(me){ try{ me.style.cssText='height:38px;padding:0 15px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);color:#dce7f5;font-weight:600;font-size:13px;font-family:inherit;cursor:pointer;display:flex;align-items:center;gap:8px';
    if(!/mlsRdMenuIco/.test(me.innerHTML)){ me.innerHTML='<span class="mlsRdMenuIco" style="display:flex">'+MENU_ICON+'</span>Menu'; } }catch(e){} }

  function reStyleToggleState(){ var vt=$('mlsViewToggle'); if(vt&&vt.parentElement&&vt.parentElement.id==='mlsRdToggleSlot') styleToggle(vt); }

  function boot(){
    injectFonts(); injectCSS(); mark();
    try{ buildShell(); }catch(e){}
    // re-assert against late mounts / other modules' observers
    var n=0; _t=setInterval(function(){ try{ injectCSS(); mark(); buildShell(); reStyleToggleState(); }catch(e){} if(++n>20) clearInterval(_t); }, 600);
    try{ _obs=new MutationObserver(function(){ try{ if(!$(STYLE_ID))injectCSS(); buildShell(); reStyleToggleState(); }catch(e){} });
      _obs.observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  }
  function revert(){ try{if(_obs)_obs.disconnect();}catch(e){} try{if(_t)clearInterval(_t);}catch(e){}
    try{var s=$(STYLE_ID);if(s)s.remove();}catch(e){} try{var f=$(FONT_ID);if(f)f.remove();}catch(e){}
    try{document.documentElement.classList.remove(CLS);if(document.body)document.body.classList.remove(CLS);}catch(e){}
    try{var hdr=$('appHeader'); if(hdr){ hdr.classList.remove('mlsRdHdr'); hdr.style.cssText='';
      [].slice.call(hdr.querySelectorAll('[data-mlsrd-hid]')).forEach(function(c){c.style.display='';c.removeAttribute('data-mlsrd-hid');}); } }catch(e){}
    try{window.__mlsRedesign.installed=false;}catch(e){} }

  window.__mlsRedesign={installed:true,version:VERSION,asset:ASSET,reapply:boot,revert:revert,build:buildShell};
  try{ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot(); }catch(e){ try{boot();}catch(e2){} }
})();
