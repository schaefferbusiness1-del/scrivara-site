/* feat_mls_redesign.js  ->  window.__mlsRedesign  (v3.0.0 "Editorial Calm")
 * =====================================================================
 *  MLSscribe 2026 GROUND-UP reskin v3 -- calm, premium, doctor-first.
 *  Replaces v2's dark-navy top-tab shell with the Editorial Calm shell:
 *    - LIGHT left nav rail, 236px (#mlsRdNav, paper #FBFAF7, border #E7E5DD)
 *      holding the app's REAL .mainnav tabs stacked vertically (active =
 *      #EFEDE6 wash + inset 3px #2E6A4B), logo on top, user chip pinned
 *      at the bottom (opens Settings) + Sign out.
 *    - 60px light top bar (#mlsRdTop, #FCFBF8) holding the screen title
 *      (Newsreader serif), the real Simple|Complex toggle, the real
 *      search (#mlsPqsInput) and the real Menu (#mlsTbMenuBtn).
 *  CONTRACT KEPT from v2 (other live modules depend on these):
 *    #appHeader.mlsRdHdr, #mlsRdTop, #mlsRdNav (rail) still contains the
 *    .mainnav with the app's real .navtab nodes, #mlsRdToggleSlot,
 *    #mlsRdSearchSlot (hosts #mlsPqsInput + #mlsPqsPanel), #mlsRdMenuSlot,
 *    html/body class "mls-redesign". Nothing re-wired; the real, already-
 *    wired nodes are MOVED into styled slots so every control keeps working.
 *  Typography: Newsreader (display) + Public Sans (UI), self-hosted at
 *  /fonts/fonts.css (CSP-safe, no external font host).
 *  APPEARANCE/LAYOUT ONLY. No handler reimplemented; nothing clicked, sent
 *  or read (no PHI; no network). Idempotent. Reversible:
 *  window.__mlsRedesign.revert() removes styles + restores original nodes.
 *  Loaded by mls-connect(.staging).js. ASCII-only. NUL-free.
 */
;(function () {
  "use strict";
  try { if (window.__mlsRedesign && window.__mlsRedesign.installed) return; } catch (e) { return; }
  var VERSION = "3.0.0", ASSET = "feat_mls_redesign.js";
  var FONT_ID = "mlsRdFont", STYLE_ID = "mlsRdStyle", CLS = "mls-redesign";
  var FONT_HREF = "fonts/fonts.css"; /* self-hosted Newsreader + Public Sans */
  var _obs = null, _t = null;
  function $(id){ try{return document.getElementById(id);}catch(e){return null;} }
  function mk(tag, css, html){ var e=document.createElement(tag); if(css)e.style.cssText=css; if(html!=null)e.innerHTML=html; return e; }

  /* ---------------- Editorial Calm CSS ---------------- */
  var CSS = [
"/* ===== MLSscribe Editorial Calm reskin v3 ===== */",
":root{",
"  --bg:#FBFAF7; --card:#ffffff; --ink:#1A211C; --muted:#79837C;",
"  --line:#E7E5DD; --brand:#2E6A4B; --brand-dk:#204034;",
"  --green:#2E6A4B; --green-dk:#204034; --amber:#B07636;",
"  --red:#B23B3B; --soft:#F4F2EC; --soft2:#F6FBF8;",
"  --gold:#9A7728; --gold-bg:#F4EEE1;",
"  --header:#FCFBF8; --header-line:#E7E5DD;",
"  --surface:#ffffff; --field-bg:#FCFBF8;",
"  --wash:#EAF1EE; --mint:#8FD8BE; --rec:#C2724C;",
"  --shadow:0 1px 2px rgba(20,33,28,.04),0 10px 28px rgba(20,33,28,.05); --r-ctl:10px;",
"  --rail-w:236px;",
"}",
"body.theme-dark{",
"  --bg:#141915; --card:#1C231E; --ink:#EAEFEA; --muted:#9CA89E; --line:#2B342D;",
"  --brand:#5FAF87; --brand-dk:#7CC4A0; --green:#5FAF87; --green-dk:#7CC4A0; --amber:#E0A35C;",
"  --red:#E0606B; --soft:#1F2721; --soft2:#1A211B; --surface:#1C231E; --field-bg:#151B16; --header:#181E19;",
"  --wash:#233129;",
"}",
"body.mls-redesign{ background:var(--bg) !important; color:var(--ink); }",
"body.mls-redesign, body.mls-redesign button, body.mls-redesign input, body.mls-redesign select,",
"body.mls-redesign textarea, body.mls-redesign .sf-select{ font-family:'Public Sans',system-ui,-apple-system,'Segoe UI',sans-serif !important; }",
"body.mls-redesign ::placeholder{ color:#A6AEA6; }",
"body.mls-redesign ::-webkit-scrollbar{ width:10px;height:10px; }",
"body.mls-redesign ::-webkit-scrollbar-thumb{ background:#D6D2C6;border-radius:8px;border:2px solid transparent;background-clip:padding-box; }",

"/* ---- shell geometry: content clears the fixed rail ---- */",
"body.mls-redesign.mls-rd-shell{ padding-left:var(--rail-w); }",
"body.mls-redesign.mls-rd-shell #appHeader{ position:sticky; top:0; z-index:60; }",

"/* ---- top bar ---- */",
"#appHeader.mlsRdHdr{ background:var(--header) !important; border-bottom:1px solid var(--line) !important; box-shadow:none !important; }",
"#mlsRdTop{ height:60px; display:flex; align-items:center; gap:14px; padding:0 22px; }",
"#mlsRdTitle{ flex:0 0 auto; font-family:'Newsreader',Georgia,serif; font-weight:600; font-size:19px; letter-spacing:-.01em; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:300px; }",
"#appHeader.mlsRdHdr > [data-mlsrd-hid]{ display:none !important; }",
"#mlsRdSearchSlot{ position:relative; flex:0 1 340px; min-width:120px; margin-left:auto; }",
"#mlsRdSearchSlot .mlsRdSearch{ width:100%; height:38px; border-radius:10px; border:1px solid #E4E1D8; background:var(--card); color:var(--ink); padding:0 34px 0 36px; font-size:13.5px; outline:none; transition:border-color .15s, box-shadow .15s; }",
"#mlsRdSearchSlot .mlsRdSearch:focus{ border-color:var(--brand); box-shadow:0 0 0 3px rgba(46,106,75,.12); }",
"#mlsRdKbd{ position:absolute; right:10px; top:50%; transform:translateY(-50%); color:#A6AEA6; font-size:10.5px; border:1px solid var(--line); border-radius:5px; padding:2px 6px; background:var(--field-bg); }",

"/* ---- nav rail ---- */",
"#mlsRdNav{ position:fixed; left:0; top:0; bottom:0; width:var(--rail-w); z-index:65; background:var(--bg); border-right:1px solid var(--line); display:flex; flex-direction:column; padding:14px 12px 12px; overflow:hidden; }",
"#mlsRdNav .mainnav{ display:flex !important; flex-direction:column !important; gap:2px !important; align-items:stretch !important; height:auto !important;",
"  background:transparent !important; border:0 !important; box-shadow:none !important; border-radius:0 !important; padding:0 !important; margin:0 !important;",
"  overflow-y:auto !important; overflow-x:hidden !important; flex:0 1 auto; min-height:0; position:static !important; top:auto !important; }",
"#mlsRdNav .navtab{ display:flex !important; align-items:center !important; justify-content:flex-start !important; text-align:left !important; gap:11px !important; width:100%; min-width:0 !important; height:auto !important; min-height:38px;",
"  padding:9px 11px !important; border-radius:10px !important; font-weight:600 !important; font-size:13.5px !important; line-height:1.2 !important;",
"  color:#55605A !important; background:transparent !important; border:0 !important; box-shadow:none !important;",
"  white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; transition:background .13s,color .13s; }",
"#mlsRdNav .navtab .nbadge, #mlsRdNav .navtab [class*='badge'], #mlsRdNav .navtab [class*='pill']{ margin-left:auto !important; flex:none !important; display:inline-flex !important; align-items:center !important; justify-content:center !important; min-width:22px; line-height:1 !important; }",
"body.theme-dark #mlsRdNav .navtab{ color:#9CA89E !important; }",
"#mlsRdNav .navtab:hover{ background:#F0EEE7 !important; color:var(--ink) !important; }",
"body.theme-dark #mlsRdNav .navtab:hover{ background:#1F2721 !important; }",
"#mlsRdNav .navtab.on{ background:#EFEDE6 !important; color:var(--ink) !important; font-weight:700 !important; box-shadow:inset 3px 0 0 var(--brand) !important; }",
"body.theme-dark #mlsRdNav .navtab.on{ background:#233129 !important; }",
"#mlsRdNav .navtab .nbadge{ margin-left:auto !important; background:var(--wash) !important; color:var(--brand) !important;",
"  border-radius:20px !important; font-size:10.5px !important; padding:1px 8px !important; font-weight:700 !important; }",
"#mlsRdNav .navtab.on .nbadge{ background:var(--brand) !important; color:#fff !important; }",
"#mlsRdNav .navtab:not([style*='display:none']):not([style*='display: none']):not(.nav-feat-off){ display:flex !important; }",
"#mlsRdRailLogo{ display:flex; align-items:center; gap:10px; padding:4px 8px 14px; flex:none; }",
"#mlsRdRailFoot{ margin-top:auto; flex:none; border-top:1px solid #EAE6DB; padding-top:10px; display:flex; flex-direction:column; gap:2px; }",
"body.theme-dark #mlsRdRailFoot{ border-top-color:#2B342D; }",
"#mlsRdRailFoot .mlsRdFootBtn{ display:flex; align-items:center; gap:11px; padding:9px 11px; border-radius:10px; color:#55605A; font-size:13.5px; font-weight:600; cursor:pointer; background:transparent; border:0; width:100%; text-align:left; transition:background .13s; }",
"body.theme-dark #mlsRdRailFoot .mlsRdFootBtn{ color:#9CA89E; }",
"#mlsRdRailFoot .mlsRdFootBtn:hover{ background:#F0EEE7; color:var(--ink); }",
"body.theme-dark #mlsRdRailFoot .mlsRdFootBtn:hover{ background:#1F2721; }",
"#mlsRdUserChip{ display:flex; align-items:center; gap:10px; padding:10px 10px 4px; cursor:pointer; }",
"#mlsRdUserChip .av{ width:30px; height:30px; border-radius:50%; background:var(--wash); color:var(--brand); font-weight:700; font-size:12px; display:flex; align-items:center; justify-content:center; flex:none; }",
"#mlsRdUserChip .nm{ font-size:12.5px; font-weight:700; color:var(--ink); line-height:1.15; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
"#mlsRdUserChip .sub{ font-size:11px; color:#8A8F86; }",

"/* ---- mobile: off-canvas rail ---- */",
"#mlsRdRailBtn{ display:none; width:38px; height:38px; border-radius:9px; border:1px solid #E4E1D8; background:var(--card); color:#55605A; cursor:pointer; align-items:center; justify-content:center; flex:none; }",
"#mlsRdScrim{ display:none; position:fixed; inset:0; z-index:64; background:rgba(26,33,28,.35); }",
"@media (max-width:900px){",
"  body.mls-redesign.mls-rd-shell{ padding-left:0; }",
"  #mlsRdNav{ transform:translateX(-100%); transition:transform .22s ease; box-shadow:none; }",
"  html.mls-rail-open #mlsRdNav{ transform:none; box-shadow:0 0 60px rgba(20,33,28,.25); }",
"  html.mls-rail-open #mlsRdScrim{ display:block; }",
"  #mlsRdRailBtn{ display:flex; }",
"  #mlsRdTop{ padding:0 14px; gap:10px; }",
"  #mlsRdTitle{ font-size:17px; max-width:160px; }",
"}",
"@media (prefers-reduced-motion: reduce){ #mlsRdNav{ transition:none; } }",

"/* ---- cards / panels ---- */",
"body.mls-redesign .card{ border:1px solid var(--line) !important; border-radius:16px !important; background:var(--card);",
"  box-shadow:0 1px 2px rgba(20,33,28,.04) !important; }",
"body.theme-dark.mls-redesign .card{ box-shadow:0 1px 2px rgba(0,0,0,.3) !important; }",
"body.mls-redesign .card>h2 .ic{ background:var(--wash) !important; border-radius:9px !important; }",
"body.mls-redesign .card>h2, body.mls-redesign .card>h3{ letter-spacing:-.01em; }",

"/* ---- buttons: calm, flat, no gradients ---- */",
"body.mls-redesign .btn-primary, body.mls-redesign .btn-blue{ background:var(--brand-dk) !important; color:#fff !important; border:none !important; border-radius:10px !important; font-weight:600 !important; box-shadow:0 8px 20px -8px rgba(32,64,52,.6) !important; transition:transform .12s ease, background .18s ease, box-shadow .18s ease; }",
"body.mls-redesign .btn-primary:hover, body.mls-redesign .btn-blue:hover{ background:#28503f !important; }",
"body.mls-redesign .btn-primary:active, body.mls-redesign .btn-blue:active{ transform:translateY(1px); }",
"body.mls-redesign .btn-green{ background:var(--brand) !important; color:#fff !important; border:none !important; border-radius:10px !important; font-weight:600 !important; box-shadow:0 8px 20px -8px rgba(46,106,75,.55) !important; transition:transform .12s ease, filter .18s ease; }",
"body.mls-redesign .btn-green:hover{ filter:brightness(1.06); }",
"body.mls-redesign .btn-green:active{ transform:translateY(1px); }",
"body.mls-redesign .btn-red{ background:#FBF1EF !important; color:#B23B3B !important; border:1px solid #EAD3CE !important; border-radius:10px !important; font-weight:600 !important; transition:transform .12s ease, background .18s ease; }",
"body.mls-redesign .btn-red:hover{ background:#F7E3DF !important; }",
"body.mls-redesign .btn-gold{ background:var(--gold-bg) !important; color:var(--gold) !important; border:1px solid #EFE4CE !important; border-radius:10px !important; font-weight:600 !important; }",
"body.mls-redesign .btn-ghost,body.mls-redesign .btn-white{ border-radius:10px !important; }",
"body.mls-redesign .btn-ghost{ background:var(--card) !important; color:var(--ink) !important; border:1px solid #D9D6CD !important; font-weight:600 !important; transition:transform .12s ease, border-color .15s ease, background .15s ease; }",
"body.mls-redesign .btn-ghost:hover{ background:var(--soft2) !important; border-color:var(--brand) !important; }",
"body.mls-redesign .btn-ghost:active{ transform:translateY(1px); }",

"/* ---- inputs ---- */",
"body.mls-redesign input[type=text],body.mls-redesign input[type=password],body.mls-redesign input[type=email],",
"body.mls-redesign input[type=date],body.mls-redesign input[type=time],body.mls-redesign input[type=number],",
"body.mls-redesign input[type=search],body.mls-redesign input[type=tel],body.mls-redesign textarea,",
"body.mls-redesign select,body.mls-redesign .sf-select{ border-radius:10px !important; border-color:#E4E1D8 !important; }",
"body.mls-redesign .sf-select:focus,body.mls-redesign input:focus,body.mls-redesign textarea:focus,body.mls-redesign select:focus{ border-color:var(--brand) !important; box-shadow:0 0 0 3px rgba(46,106,75,.12) !important; outline:none !important; }",

"/* ---- badges / chips ---- */",
"body.mls-redesign .badge{ border-radius:20px !important; }",
"body.mls-redesign .badge.draft{ background:#FCF8EF !important; color:#B07636 !important; border:1px solid #EFE4CE !important; }",
"body.mls-redesign .badge.signed{ background:var(--wash) !important; color:var(--brand) !important; border:1px solid #D5E5DC !important; }",
"body.mls-redesign .em-pill{ background:var(--wash) !important; color:var(--brand) !important; border:1px solid #D5E5DC !important; border-radius:7px !important; }",
"body.mls-redesign .codechip{ border-radius:7px !important; }",

"/* ---- patient context surfaces ---- */",
"body.mls-redesign #patientBar{ background:var(--card) !important; border:1px solid var(--line) !important; border-radius:14px !important; box-shadow:0 1px 2px rgba(20,33,28,.04) !important; gap:14px !important; padding:14px 18px !important; }",
"body.mls-redesign #patientBar .pname{ color:var(--ink) !important; font-weight:700 !important; }",
"body.mls-redesign #mlsCtxBar{ background:var(--card) !important; border:1px solid var(--line) !important; border-radius:0 !important; border-left:none !important; border-right:none !important; box-shadow:none !important; }",

"/* ---- legacy visit hero (#visitHero): deep-green brand band. Several",
"   satellites paint white/translucent chrome INSIDE it, so it must stay a",
"   dark-green surface for contrast; the modern Visit hero is the LIGHT #mlsEz3",
"   card. Serif headings, calm inputs. ---- */",
"body.mls-redesign #visitHero{ background:#204034 !important; color:#EAF1EC !important; border:0 !important; border-radius:16px !important; box-shadow:0 18px 44px -24px rgba(32,64,52,.5) !important; }",
"body.mls-redesign #visitHero h1,body.mls-redesign #visitHero h2{ font-family:'Newsreader',Georgia,serif !important; font-weight:600 !important; color:#fff !important; letter-spacing:-.015em; }",
"body.mls-redesign #visitHero .muted, body.mls-redesign #visitHero small{ color:#B9CEC2 !important; }",
"body.mls-redesign #visitHero input{ background:rgba(255,255,255,.96) !important; color:#1A211C !important; border:0 !important; border-radius:10px !important; }",
"body.mls-redesign #visitHero #heroRecBtn{ background:#fff !important; color:#204034 !important; border:0 !important; box-shadow:0 8px 20px -8px rgba(0,0,0,.35) !important; font-weight:700 !important; }",

"/* ---- modals ---- */",
"body.mls-redesign .modal{ background:var(--surface) !important; border:1px solid var(--line) !important; border-radius:18px !important; box-shadow:0 40px 80px -30px rgba(20,33,28,.4) !important; }",
"body.mls-redesign .modal-bg{ background:rgba(26,33,28,.45) !important; backdrop-filter:blur(3px); }",
"body.mls-redesign .set-tab.on{ background:var(--wash) !important; color:var(--brand-dk) !important; border-radius:10px !important; box-shadow:inset 0 0 0 1px #D5E5DC !important; font-weight:700 !important; }",

"/* ---- auth (base layer also styles this; keep consistent when bundle loads) ---- */",
"body.mls-redesign .auth-wrap{ background:var(--bg) !important; }",
"body.mls-redesign .auth-card{ background:var(--card) !important; border-radius:20px !important; box-shadow:0 1px 2px rgba(20,33,28,.04),0 30px 60px -30px rgba(20,33,28,.28) !important; }",

"/* ---- FABs ---- */",
"body.mls-redesign #mls-assist-badge{ background:var(--brand-dk) !important; color:#fff !important; border:none !important; border-radius:999px !important; font-weight:600 !important; box-shadow:0 14px 30px -10px rgba(32,64,52,.55) !important; }",
"body.mls-redesign #mlsAddPtLauncher{ background:var(--card) !important; color:var(--ink) !important; border:1px solid #D9D6CD !important; border-radius:999px !important; font-weight:600 !important; box-shadow:0 14px 30px -12px rgba(20,33,28,.25) !important; }",
"body.mls-redesign #mlsAddPtLauncher *{ color:var(--ink) !important; }",

"/* ---- toasts ---- */",
"body.mls-redesign #mlsTip,body.mls-redesign .mls-toast,body.mls-redesign .toast{ background:#204034 !important; color:#fff !important; border:1px solid rgba(255,255,255,.08) !important; border-radius:12px !important; box-shadow:0 18px 40px -12px rgba(20,33,28,.5) !important; }",
"body.mls-redesign .empty{ border:1.5px dashed #D6D2C6 !important; background:var(--soft2) !important; border-radius:14px !important; }",

"/* ---- calm loading primitives (used by theme polish + any module) ---- */",
"@keyframes mlsRdShimmer{ 0%{background-position:-320px 0} 100%{background-position:320px 0} }",
".mlsRdSkel{ background:linear-gradient(90deg,#F0EEE7 25%,#F7F5EF 45%,#F0EEE7 65%); background-size:640px 100%; animation:mlsRdShimmer 1.3s linear infinite; border-radius:8px; color:transparent !important; }",
"@keyframes mlsRdSpin{ to{ transform:rotate(360deg);} }",
".mlsRdSpinner{ width:15px; height:15px; border:2px solid rgba(46,106,75,.25); border-top-color:var(--brand); border-radius:50%; display:inline-block; vertical-align:-2px; animation:mlsRdSpin .7s linear infinite; }",
"@media (prefers-reduced-motion: reduce){ .mlsRdSkel,.mlsRdSpinner{ animation:none; } }",

"/* ---- misc legacy surfaces that hard-coded navy/blue ---- */",
"body.mls-redesign .navtab .nbadge{ font-weight:700 !important; }",
"body.mls-redesign .pt-gbtn.on{ background:var(--brand) !important; border-color:var(--brand) !important; }",
"body.mls-redesign a{ color:var(--brand); }"
  ].join("\n");

  /* ---------------- font + style injection ---------------- */
  function injectFonts(){ try{ if($(FONT_ID))return; var h=document.head||document.documentElement;
    var l=mk('link'); l.id=FONT_ID; l.rel='stylesheet'; l.href=FONT_HREF; h.appendChild(l);}catch(e){} }
  function injectCSS(){ try{ var s=$(STYLE_ID); if(!s){s=mk('style');s.id=STYLE_ID;(document.head||document.documentElement).appendChild(s);} if(s.textContent!==CSS)s.textContent=CSS; }catch(e){} }
  function mark(){ try{document.documentElement.classList.add(CLS); if(document.body)document.body.classList.add(CLS);}catch(e){} }

  /* ---------------- shell (light rail + 60px top bar) ---------------- */
  var LOGO_SVG='<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#8FD8BE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h4l2-6 3 11 2.4-7 1.6 3H21"/></svg>';
  var SEARCH_ICON='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#A6AEA6" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
  var MENU_ICON='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#55605A" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
  var GEAR_ICON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1"/></svg>';
  var BURGER_ICON='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';

  /* Belt-and-suspenders mobile drawer: the class-based CSS is primary, but an
     inline transform makes open/close deterministic even if a foreign rule or
     stale renderer interferes. Desktop (>900px) never gets an inline value. */
  function railSlide(open){
    try{
      var r=$('mlsRdNav'); if(!r) return;
      if(window.matchMedia && !window.matchMedia('(max-width: 900px)').matches){ r.style.transform=''; return; }
      r.style.transform = open ? 'none' : '';
    }catch(e){}
  }
  function isOnLogin(){
    try{ var a=document.querySelector('#authScreen, .auth-wrap'); if(!a) return false;
      var cs=getComputedStyle(a); if(cs.display==='none'||cs.visibility==='hidden') return false;
      return a.getBoundingClientRect().height>40; }catch(e){ return false; }
  }
  function setFab(hide){ try{ ['mls-assist-badge','mlsAddPtLauncher'].forEach(function(id){ var e=$(id); if(e) e.style.display=hide?'none':''; }); }catch(e){} }
  function hideChrome(){ try{ var t=$('mlsRdTop'),n=$('mlsRdNav'); if(t)t.style.display='none'; if(n)n.style.display='none'; if(document.body)document.body.classList.remove('mls-rd-shell'); setFab(true); }catch(e){} }

  function userInfo(){
    var initials='MS', name='Account', sub='Settings';
    try{ var nm=null;
      try{ nm=(window.__mlsProviderLabel&&window.__mlsProviderLabel())||null; }catch(e){}
      if(!nm) nm=localStorage.getItem('mls_provider_name')||localStorage.getItem('mls_name')||localStorage.getItem('providerName');
      if(!nm&&window.bkUser&&window.bkUser.name) nm=window.bkUser.name;
      if(!nm){ var w=$('whoLabel'); if(w&&w.textContent.trim()) nm=w.textContent.trim(); }
      if(nm){ name=nm; var pp=nm.trim().split(/\s+/); initials=(((pp[0]||'')[0]||'')+((pp[pp.length-1]||'')[0]||'')).toUpperCase()||'MS'; }
      try{ if(window.bkUser&&window.bkUser.email) sub=window.bkUser.email; }catch(e){}
    }catch(e){}
    if(sub&&sub.length>24) sub=sub.slice(0,23)+'…';
    return {initials:initials, name:name, sub:sub};
  }

  function navLabelOf(tab){ try{
      var t='';
      for(var i=0;i<tab.childNodes.length;i++){ var n=tab.childNodes[i]; if(n.nodeType===3) t+=n.textContent; }
      if(!t.trim()) t=(tab.textContent||'');
      t=t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}✦]/gu,'').trim();
      return t.replace(/\d+$/,'').trim();
    }catch(e){ return ''; } }
  function syncTitle(){
    try{ var el=$('mlsRdTitle'); if(!el) return;
      var on=document.querySelector('#mlsRdNav .navtab.on');
      var t=on?navLabelOf(on):'';
      if(!t) t='MLS Scribe';
      if(el.textContent!==t) el.textContent=t;
    }catch(e){}
  }

  function buildShell(){
    var hdr=$('appHeader'); if(!hdr) return false;
    if(isOnLogin()){ hideChrome(); return false; }
    hdr.classList.add('mlsRdHdr');
    hdr.style.background=''; hdr.style.borderBottom=''; hdr.style.boxShadow='';
    hdr.style.position='sticky'; hdr.style.top='0'; hdr.style.zIndex='60';

    var top=$('mlsRdTop');
    if(!top){
      /* hide original inner children (keep in DOM so handlers/hidden tool buttons survive) */
      [].slice.call(hdr.children).forEach(function(c){ if(c.id!=='mlsRdTop'&&c.id!=='mlsRdNav'){ c.setAttribute('data-mlsrd-hid','1'); c.style.display='none'; } });
      /* ---- TOP BAR ---- */
      top=mk('div'); top.id='mlsRdTop';
      var burger=mk('button','','<span style="display:flex">'+BURGER_ICON+'</span>'); burger.id='mlsRdRailBtn'; burger.type='button'; burger.title='Menu';
      burger.addEventListener('click',function(e){ try{e.stopPropagation(); var open=document.documentElement.classList.toggle('mls-rail-open'); railSlide(open); }catch(_){} });
      top.appendChild(burger);
      var title=mk('div'); title.id='mlsRdTitle'; title.textContent='MLS Scribe'; top.appendChild(title);
      var tgSlot=mk('div','display:flex;align-items:center'); tgSlot.id='mlsRdToggleSlot'; top.appendChild(tgSlot);
      var seSlot=mk('div'); seSlot.id='mlsRdSearchSlot';
      seSlot.appendChild(mk('span','position:absolute;left:12px;top:50%;transform:translateY(-50%);pointer-events:none;display:flex',SEARCH_ICON));
      top.appendChild(seSlot);
      var meSlot=mk('div','display:flex;align-items:center;gap:8px'); meSlot.id='mlsRdMenuSlot'; top.appendChild(meSlot);
      hdr.appendChild(top);

      /* ---- RAIL (still #mlsRdNav for module compatibility) ---- */
      var navWrap=mk('div'); navWrap.id='mlsRdNav';
      var logo=mk('div','', '<span style="width:32px;height:32px;border-radius:9px;background:#204034;display:flex;align-items:center;justify-content:center;flex:none">'+LOGO_SVG+'</span>'+
        '<span style="font-family:\'Newsreader\',Georgia,serif;font-weight:600;font-size:18px;letter-spacing:-.01em;color:var(--ink)">MLS Scribe</span>');
      logo.id='mlsRdRailLogo'; navWrap.appendChild(logo);
      hdr.appendChild(navWrap);

      /* rail foot: settings + user chip + sign out */
      var foot=mk('div'); foot.id='mlsRdRailFoot';
      var set=mk('button','','<span style="display:flex">'+GEAR_ICON+'</span> Settings'); set.className='mlsRdFootBtn'; set.type='button';
      set.addEventListener('click',function(){ try{ if(typeof window.openSettings==='function') window.openSettings(); }catch(e){} });
      foot.appendChild(set);
      var out=mk('button','','<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg> Sign out'); out.className='mlsRdFootBtn'; out.type='button';
      out.addEventListener('click',function(){ try{ if(typeof window.logout==='function') window.logout(); }catch(e){} });
      foot.appendChild(out);
      var u=userInfo();
      var chip=mk('div','','<span class="av">'+u.initials+'</span><span style="min-width:0"><span class="nm" style="display:block">'+u.name+'</span><span class="sub">'+u.sub+'</span></span>');
      chip.id='mlsRdUserChip'; chip.title='Account settings';
      chip.addEventListener('click',function(){ try{ if(typeof window.openSettings==='function') window.openSettings(); }catch(e){} });
      foot.appendChild(chip);
      navWrap.appendChild(foot);

      /* scrim for mobile off-canvas */
      if(!$('mlsRdScrim')){ var sc=mk('div'); sc.id='mlsRdScrim'; sc.addEventListener('click',function(){ document.documentElement.classList.remove('mls-rail-open'); railSlide(false); }); document.body.appendChild(sc); }
      /* close rail after choosing a view on mobile */
      navWrap.addEventListener('click',function(e){ try{ if(e.target&&e.target.closest&&e.target.closest('.navtab')){ document.documentElement.classList.remove('mls-rail-open'); railSlide(false); } }catch(_){} });
      /* Help = the ONE guided tour/guide (bug found live 2026-07-13: nav_help's
         openMlsHelp() produced no visible surface in the rail shell; the obt
         tour engine works — route Help to it, capture-phase so we win the
         legacy handler; fall back to the original if obt is absent). */
      navWrap.addEventListener('click',function(e){
        try{
          if(!(e.target&&e.target.closest&&e.target.closest('#nav_help'))) return;
          var t=window.__mlsOnboardingTour;
          if(t&&t.installed&&typeof t.open==='function'){ e.preventDefault(); e.stopPropagation(); t.open(); }
        }catch(_){}
      },true);
    }
    /* relocate real controls into slots (idempotent: appendChild moves) */
    var tgSlot=$('mlsRdToggleSlot'), seSlot=$('mlsRdSearchSlot'), meSlot=$('mlsRdMenuSlot'), navWrap=$('mlsRdNav');
    var vt=$('mlsViewToggle'); if(vt && tgSlot && vt.parentElement!==tgSlot){ styleToggle(vt); tgSlot.appendChild(vt); }
    var se=$('mlsPqsInput'); if(se && seSlot && se.parentElement!==seSlot){ styleSearch(se); seSlot.appendChild(se);
      if(!$('mlsRdKbd')){ var k=mk('kbd','','/'); k.id='mlsRdKbd'; seSlot.appendChild(k); } }
    var meWrap=$('mlsTbMenu'); var meBtn=$('mlsTbMenuBtn');
    if(meWrap && meSlot && meWrap.parentElement!==meSlot){ meWrap.style.position='relative'; if(meBtn) styleMenu(meBtn); meSlot.appendChild(meWrap); }
    else if(!meWrap && meBtn && meSlot && meBtn.parentElement!==meSlot){ styleMenu(meBtn); meSlot.appendChild(meBtn); }
    var nav=document.querySelector('.mainnav');
    if(nav && navWrap && nav.parentElement!==navWrap){ var foot2=$('mlsRdRailFoot'); if(foot2) navWrap.insertBefore(nav,foot2); else navWrap.appendChild(nav); }
    try{ var _t2=$('mlsRdTop'),_n=$('mlsRdNav'); if(_t2)_t2.style.display=''; if(_n)_n.style.display=''; if(document.body)document.body.classList.add('mls-rd-shell'); setFab(false); }catch(e){}
    syncTitle();
    refreshUserChip();
    return true;
  }
  /* every PREMIUM tag rendered by any module collapses to the ONE canonical
     badge (inline gradient styles at 9px rendered muddy/mismatched) */
  function normalizePremiumBadges(){
    try{
      var spans=document.querySelectorAll('#mlsRdNav .navtab span, #mlsTbMenuPanel span');
      for(var i=0;i<spans.length;i++){
        var s=spans[i];
        if(s.children.length===0 && /^premium$/i.test((s.textContent||'').trim()) && !s.classList.contains('mlsRdPrem')){
          s.className='mlsRdPrem'; s.removeAttribute('style');
        }
      }
    }catch(e){}
  }
  function refreshUserChip(){ try{ var chip=$('mlsRdUserChip'); if(!chip) return; var u=userInfo();
    var nm=chip.querySelector('.nm'), sb=chip.querySelector('.sub'), av=chip.querySelector('.av');
    if(nm&&nm.textContent!==u.name) nm.textContent=u.name;
    if(sb&&sb.textContent!==u.sub) sb.textContent=u.sub;
    if(av&&av.textContent!==u.initials) av.textContent=u.initials; }catch(e){} }
  function styleToggle(vt){ try{ vt.style.cssText='display:flex;align-items:center;background:#F0EEE7;border:1px solid #E4E1D8;border-radius:10px;padding:3px;gap:2px';
    [].slice.call(vt.children).forEach(function(b){ var on=/mlsVtOn/.test(b.className);
      b.style.cssText='display:flex;align-items:center;height:30px;padding:0 14px;border:0;border-radius:8px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;'+(on?'background:#fff;color:#1A211C;box-shadow:0 1px 3px rgba(20,33,28,.15);':'background:transparent;color:#79837C;'); }); }catch(e){} }
  function styleSearch(se){ try{ se.style.cssText=''; se.classList.add('mlsRdSearch'); try{se.placeholder='Find anything — patients, notes, codes…';}catch(e){} }catch(e){} }
  function styleMenu(me){ try{ me.style.cssText='height:38px;padding:0 16px;border-radius:10px;border:1px solid #E4E1D8;background:var(--card);color:#55605A;font-weight:600;font-size:13px;line-height:1;font-family:inherit;cursor:pointer;display:inline-flex;align-items:center;justify-content:center';
    /* text-only label: the hamburger icon pushed "Menu" right of the button's
       optical center (owner precision note) — plain centered text reads calm */
    if(me.textContent.replace(/\s+/g,'')!=='Menu'){ me.textContent='Menu'; } }catch(e){} }

  function reStyleToggleState(){ var vt=$('mlsViewToggle'); if(vt&&vt.parentElement&&vt.parentElement.id==='mlsRdToggleSlot') styleToggle(vt); }

  /* Analysis draggable/resizable dashboard (carried over from v2 unchanged behavior) */
  function anaLoad(){ try{ return JSON.parse(localStorage.getItem('mlsRdAnaLayout')||'{}'); }catch(e){ return {}; } }
  function anaSave(o){ try{ localStorage.setItem('mlsRdAnaLayout', JSON.stringify(o)); }catch(e){} }
  function makeAnalysisDashboard(){
    try{
      var v=$('analysisView'); if(!v) return;
      var navA=$('nav_analysis');
      var active = navA && (' '+navA.className+' ').indexOf(' on ')>=0;
      if(!active){ v.classList.remove('mlsRdAnaGrid'); return; }
      var cards=[].slice.call(v.querySelectorAll(':scope > .card'));
      if(!cards.length){ v.classList.remove('mlsRdAnaGrid'); return; }
      v.classList.add('mlsRdAnaGrid');
      var L=anaLoad();
      if(L.order && L.order.length){
        var cur=[].slice.call(v.querySelectorAll(':scope > .card')).map(function(c){return c.id;});
        var want=L.order.filter(function(id){ return cur.indexOf(id)>=0; });
        cur.forEach(function(id){ if(want.indexOf(id)<0) want.push(id); });
        var same = cur.length===want.length && cur.every(function(id,i){ return id===want[i]; });
        if(!same){ want.forEach(function(id){ var c=document.getElementById(id); if(c) v.appendChild(c); }); }
      }
      cards=[].slice.call(v.querySelectorAll(':scope > .card'));
      cards.forEach(function(card){
        if(card.id && L.sizes && L.sizes[card.id]){ var z=L.sizes[card.id]; card.style.gridColumn='span '+Math.min(4,Math.max(1,z.cols||1)); card.style.gridRow='span '+Math.min(5,Math.max(1,z.rows||1)); }
        if(card.__mlsRdAna) return; card.__mlsRdAna=1; card.style.position='relative';
        var grip=document.createElement('div'); grip.className='mlsRdAnaGrip'; grip.title='Drag to resize'; card.appendChild(grip);
        grip.addEventListener('pointerdown', function(e){
          e.preventDefault(); e.stopPropagation();
          var rect=v.getBoundingClientRect(), gap=18, ncol=4, rowH=212;
          var cellW=(rect.width-gap*(ncol-1))/ncol, sx=e.clientX, sy=e.clientY;
          var cur=(L.sizes&&L.sizes[card.id])||{cols:1,rows:1};
          function mv(ev){ var dc=Math.round((ev.clientX-sx)/(cellW+gap)), dr=Math.round((ev.clientY-sy)/(rowH+gap));
            var cols=Math.min(4,Math.max(1,(cur.cols||1)+dc)), rows=Math.min(5,Math.max(1,(cur.rows||1)+dr));
            card.style.gridColumn='span '+cols; card.style.gridRow='span '+rows;
            L.sizes=L.sizes||{}; L.sizes[card.id]={cols:cols,rows:rows}; }
          function up(){ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); anaSave(L); }
          window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
        });
        var hdr=card.querySelector('h2,h3');
        if(hdr){ hdr.style.cursor='move';
          hdr.addEventListener('pointerdown', function(e){
            if(e.target.closest('button,a,input,select,textarea')) return;
            e.preventDefault(); card.classList.add('mlsRdAnaDragging');
            function mv(ev){ var el=document.elementFromPoint(ev.clientX,ev.clientY); var tgt=el&&el.closest&&el.closest('#analysisView > .card');
              if(tgt&&tgt!==card){ var r=tgt.getBoundingClientRect(); var before=(ev.clientY<r.top+r.height/2)||(ev.clientX<r.left+r.width/2); v.insertBefore(card, before?tgt:tgt.nextSibling); } }
            function up(){ window.removeEventListener('pointermove',mv); window.removeEventListener('pointerup',up); card.classList.remove('mlsRdAnaDragging');
              L.order=[].slice.call(v.querySelectorAll(':scope > .card')).map(function(c){return c.id;}).filter(Boolean); anaSave(L); }
            window.addEventListener('pointermove',mv); window.addEventListener('pointerup',up);
          });
        }
      });
    }catch(e){}
  }
  function styleVisit(){
    try{
      var v=document.getElementById('visitView'); if(!v) return;
      var grid=v.querySelector(':scope > .grid'); var emr=document.getElementById('emrCard');
      if(!grid) return;
      grid.classList.add('mlsRdVisitGrid');
      if(emr && emr.parentElement!==grid){ grid.appendChild(emr); }
    }catch(e){}
  }
  /* grid CSS for analysis + visit (kept from v2, recolored) */
  CSS += ["",
"body.mls-redesign .mlsRdVisitGrid{ display:grid !important; grid-template-columns:minmax(0,1fr) minmax(0,1fr) minmax(0,400px) !important; gap:18px !important; align-items:start !important; }",
"@media (max-width:1200px){ body.mls-redesign .mlsRdVisitGrid{ grid-template-columns:minmax(0,1fr) minmax(0,1fr) !important; } body.mls-redesign .mlsRdVisitGrid #emrCard{ grid-column:1 / -1 !important; } }",
"@media (max-width:760px){ body.mls-redesign .mlsRdVisitGrid{ grid-template-columns:1fr !important; } body.mls-redesign .mlsRdVisitGrid #emrCard{ grid-column:auto !important; } }",
"body.mls-redesign #analysisView.mlsRdAnaGrid{ display:grid !important; grid-template-columns:repeat(4,minmax(0,1fr)) !important; grid-auto-rows:minmax(200px,auto) !important; gap:18px !important; align-items:start !important; grid-auto-flow:dense !important; }",
"body.mls-redesign #analysisView.mlsRdAnaGrid > .card{ position:relative !important; margin:0 !important; overflow:auto; }",
"@media (max-width:1100px){ body.mls-redesign #analysisView.mlsRdAnaGrid{ grid-template-columns:repeat(2,minmax(0,1fr)) !important; } }",
"@media (max-width:680px){ body.mls-redesign #analysisView.mlsRdAnaGrid{ grid-template-columns:1fr !important; } body.mls-redesign #analysisView.mlsRdAnaGrid > .card{ grid-column:1 / -1 !important; grid-row:auto !important; } }",
"body.mls-redesign .mlsRdAnaGrip{ position:absolute; right:5px; bottom:5px; width:16px; height:16px; cursor:nwse-resize; z-index:6; opacity:.55; background:linear-gradient(135deg,transparent 45%,#B7BBB2 45%,#B7BBB2 60%,transparent 60%,transparent 72%,#B7BBB2 72%,#B7BBB2 86%,transparent 86%); }",
"body.mls-redesign .mlsRdAnaGrip:hover{ opacity:.9; }",
"body.mls-redesign .mlsRdAnaGrid > .card > h2, body.mls-redesign .mlsRdAnaGrid > .card > h3{ cursor:move; user-select:none; }",
"body.mls-redesign .mlsRdAnaDragging{ opacity:.55 !important; outline:2px dashed #2E6A4B !important; }",
"",
"/* ---- ONE canonical premium badge everywhere (owner: badges must match) ---- */",
".mlsRdPrem, .mls-prem-pill{ background:#EFEAF8 !important; background-image:none !important; color:#7A5CC0 !important;",
"  font-size:9.5px !important; font-weight:700 !important; letter-spacing:.05em !important; text-transform:uppercase !important;",
"  padding:2px 7px !important; border-radius:5px !important; border:0 !important; line-height:1.5 !important; display:inline-block !important; vertical-align:1px; }",
"#mlsRdNav .navtab .mlsRdPrem, #mlsRdNav .navtab .mls-prem-pill{ margin-left:auto !important; flex:none !important; }",
"",
"/* ---- text-centering precision: kill the 1px-low baseline rounding on pills ---- */",
"body.mls-redesign #mlsDayHistBtn, body.mls-redesign #mlsAddPtLauncher, body.mls-redesign #mlsTabPickerChip,",
"body.mls-redesign #mlsEz3 .ez3-sm, body.mls-redesign #mlsEz3 .ez3-big, body.mls-redesign #mlsEz3 #ez3Adv{",
"  line-height:1 !important; display:inline-flex !important; align-items:center !important; justify-content:center !important; }",
"body.mls-redesign #mlsEz3 .ez3-big{ display:flex !important; flex-direction:column !important; }",
"",
"/* ---- bottom-right FAB column: one aligned, non-overlapping stack ---- */",
"body.mls-rd-shell #mlsTabPickerChip{ right:16px !important; bottom:16px !important; left:auto !important; }",
"body.mls-rd-shell #mlsAddPtLauncher{ right:16px !important; bottom:58px !important; left:auto !important; }",
"body.mls-rd-shell #mlsDayHistBtn{ right:16px !important; bottom:110px !important; left:auto !important; }",
"body.mls-rd-shell #mlsFab{ right:16px !important; bottom:152px !important; left:auto !important; }",
"",
"/* ---- fixed chrome vs the rail: left-anchored FABs sit right of the rail ---- */",
"body.mls-rd-shell #mlsAsstFab{ left:calc(var(--rail-w) + 14px) !important; }",
"body.mls-rd-shell #mlsCopVoiceBtn{ left:calc(var(--rail-w) + 14px) !important; }",
"@media (max-width:900px){",
"  body.mls-rd-shell #mlsAsstFab{ left:14px !important; }",
"  body.mls-rd-shell #mlsCopVoiceBtn{ left:14px !important; }",
"}",
"",
"/* ---- Visit hero: STRUCTURAL calm-agenda rebuild (owner: complete new UI, not a reskin).",
"   Pure CSS grid re-layout of EZ3's real children -- no DOM moves, so the EZ3",
"   renderer never fights it. Date becomes the serif headline; clock is a quiet",
"   sub-line; provider select sits top-right; the day CTA is a full-width calm",
"   primary row; secondary actions align on one row with Advanced tools at right. ---- */",
"body.mls-redesign #mlsEz3{ padding:18px 20px 14px !important; }",
"body.mls-redesign #mlsEz3Head{ display:flex !important; justify-content:flex-end !important; margin:0 0 2px !important; }",
"body.mls-redesign #ez3Wrap{ display:grid !important; grid-template-columns:minmax(0,1fr) auto !important; gap:12px 18px !important; align-items:center !important; }",
"body.mls-redesign #ez3Wrap > *{ grid-column:1 / -1; }",
"body.mls-redesign #ez3Wrap > .ez3-clockbar{ grid-column:1 !important; grid-row:1 !important; display:flex !important; flex-direction:column !important; align-items:flex-start !important; gap:1px !important; margin:0 !important; }",
"body.mls-redesign #ez3Wrap > .ez3-clockbar .ez3-date{ order:-1; font-family:'Newsreader',Georgia,serif !important; font-weight:600 !important; font-size:23px !important; letter-spacing:-.015em !important; color:#1A211C !important; }",
"body.mls-redesign #ez3Wrap > .ez3-clockbar .ez3-clock{ font-size:12.5px !important; font-weight:600 !important; color:#8A8F86 !important; }",
"body.mls-redesign #ez3Wrap > .ez3-prov{ grid-column:2 !important; grid-row:1 !important; display:flex !important; align-items:center !important; gap:9px !important; margin:0 !important; justify-self:end; }",
"body.mls-redesign #ez3Wrap > .ez3-prov label{ font-size:11px !important; font-weight:700 !important; letter-spacing:.06em !important; text-transform:uppercase !important; color:#8A8F86 !important; margin:0 !important; }",
"body.mls-redesign #ez3Wrap > #ez3AllProv{ grid-row:2 !important; min-height:50px !important; border-radius:12px !important; font-size:14.5px !important; margin:2px 0 0 !important; }",
"body.mls-redesign #ez3Wrap > .ez3fl-record{ grid-column:1 / -1 !important; grid-row:3 !important; }",
"body.mls-redesign #ez3Wrap > .ez3-row2{ grid-column:1 / -1 !important; grid-row:4 !important; display:flex !important; gap:8px !important; margin:0 !important; }",
"body.mls-redesign #ez3Wrap > .ez3-advrow{ grid-column:1 / -1 !important; grid-row:5 !important; justify-self:end; margin:-4px 0 0 !important; }",
"body.mls-redesign #ez3Wrap > #ez3HomeStatus{ grid-row:6 !important; margin:2px 0 0 !important; font-size:12.5px !important; color:#79837C !important; }",
"@media (max-width:760px){",
"  body.mls-redesign #ez3Wrap{ grid-template-columns:1fr !important; }",
"  body.mls-redesign #ez3Wrap > .ez3-prov{ grid-column:1 !important; grid-row:2 !important; justify-self:start; }",
"  body.mls-redesign #ez3Wrap > #ez3AllProv{ grid-row:3 !important; }",
"  body.mls-redesign #ez3Wrap > .ez3fl-record{ grid-column:1 !important; grid-row:4 !important; }",
"  body.mls-redesign #ez3Wrap > .ez3-row2{ grid-column:1 !important; grid-row:5 !important; flex-wrap:wrap; }",
"  body.mls-redesign #ez3Wrap > .ez3-advrow{ grid-column:1 !important; grid-row:6 !important; justify-self:start; }",
"  body.mls-redesign #ez3Wrap > #ez3HomeStatus{ grid-row:7 !important; }",
"}",
"",
"/* ---- phone-size layer (Editorial Calm mobile) ---- */",
"@media (max-width:640px){",
"  body.mls-redesign #appWrap{ padding:12px 10px !important; }",
"  body.mls-redesign .card{ border-radius:14px !important; }",
"  body.mls-redesign #patientBar{ flex-wrap:wrap !important; padding:12px 12px !important; gap:9px !important; }",
"  body.mls-redesign #mlsCtxBar{ overflow-x:auto !important; }",
"  #mlsRdTop{ height:54px; }",
"  #mlsRdSearchSlot{ flex:1 1 auto; }",
"  #mlsRdToggleSlot{ display:none; }",
"  body.mls-redesign #mlsEz3{ border-radius:14px !important; }",
"  body.mls-redesign .modal{ max-width:calc(100vw - 20px) !important; margin:10px !important; max-height:92vh !important; overflow-y:auto !important; }",
"  body.mls-redesign #mlsDayHistBtn, body.mls-redesign #mlsAddPtLauncher, body.mls-redesign #mlsTabPickerChip{ transform:scale(.92); }",
"}"
  ].join("\n");

  function applyAll(){
    try{ if(_obs) _obs.disconnect(); }catch(e){}
    try{ injectCSS(); mark(); buildShell(); styleVisit(); makeAnalysisDashboard(); reStyleToggleState(); syncTitle(); normalizePremiumBadges(); }catch(e){}
    try{ if(_obs) _obs.observe(document.documentElement,{childList:true,subtree:true}); }catch(e){}
  }
  var _schedT=null;
  function schedule(){ if(_schedT) return; _schedT=setTimeout(function(){ _schedT=null; applyAll(); },120); }
  /* the nav .on class flips without childList mutations, so the observer never
     sees a view switch — wrap showView additively (guarded) for an instant,
     always-correct title. */
  function wrapShowViewForTitle(){
    try{
      if(typeof window.showView!=='function'||window.showView.__rdTitleWrapped) return;
      var orig=window.showView;
      var w=function(){ var r; try{ r=orig.apply(this,arguments); }catch(e){}
        try{ setTimeout(syncTitle,0); }catch(e){} return r; };
      w.__rdTitleWrapped=true; w.__rdTitleOrig=orig;
      window.showView=w;
    }catch(e){}
  }
  function boot(){
    injectFonts();
    try{ _obs=new MutationObserver(function(){ schedule(); }); }catch(e){}
    wrapShowViewForTitle();
    applyAll();
    var n=0; _t=setInterval(function(){ applyAll(); wrapShowViewForTitle(); if(++n>15) clearInterval(_t); }, 700);
  }
  function revert(){ try{if(_obs)_obs.disconnect();}catch(e){} try{if(_t)clearInterval(_t);}catch(e){}
    try{ if(window.showView&&window.showView.__rdTitleWrapped&&window.showView.__rdTitleOrig) window.showView=window.showView.__rdTitleOrig; }catch(e){}
    try{var s=$(STYLE_ID);if(s)s.remove();}catch(e){} try{var f=$(FONT_ID);if(f)f.remove();}catch(e){}
    try{document.documentElement.classList.remove(CLS);document.documentElement.classList.remove('mls-rail-open');if(document.body){document.body.classList.remove(CLS);document.body.classList.remove('mls-rd-shell');}}catch(e){}
    try{var hdr=$('appHeader'); if(hdr){ hdr.classList.remove('mlsRdHdr'); hdr.style.cssText='';
      [].slice.call(hdr.querySelectorAll('[data-mlsrd-hid]')).forEach(function(c){c.style.display='';c.removeAttribute('data-mlsrd-hid');}); } }catch(e){}
    try{var sc=$('mlsRdScrim'); if(sc)sc.remove();}catch(e){}
    try{window.__mlsRedesign.installed=false;}catch(e){} }

  window.__mlsRedesign={installed:true,version:VERSION,asset:ASSET,reapply:boot,revert:revert,build:buildShell};
  try{ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot(); }catch(e){ try{boot();}catch(e2){} }
})();
