/* feat_mls_redesign.js  ->  window.__mlsRedesign  (v3.2.2 "Editorial Calm")
 * =====================================================================
 *  MLSscribe 2026 GROUND-UP reskin v3 -- calm, premium, doctor-first.
 *  Replaces v2's dark-navy top-tab shell with the Editorial Calm shell:
 *    - LIGHT left nav rail, 236px (#mlsRdNav, paper #FBFAF7, border #E7E5DD)
 *      holding the app's REAL .mainnav tabs stacked vertically (active =
 *      #EFEDE6 wash + inset 3px #2E6A4B), logo on top, with account actions
 *      owned by the single Account menu in the top bar.
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
  var VERSION = "3.2.2", ASSET = "feat_mls_redesign.js";
  var _priorRedesign = null, _opaqueLegacyHistory = null;
  var _historyWrapper = null, _historyOriginal = null, _historyBeforeInstall;
  var _historyBeforeInstallCaptured = false, _historyBeforeInstallHadOwn = false;
  function rawById(id){ try{return document.getElementById(id);}catch(e){return null;} }
  function removeNode(id){ try{var node=rawById(id);if(node&&node.parentNode)node.parentNode.removeChild(node);}catch(e){} }
  function unwrapKnownRedesignOwners(fn){
    var current=fn,guard=0;
    while(typeof current==='function'&&guard++<12){
      if(current.__rdTitleWrapped&&current.__rdTitleOrig){current=current.__rdTitleOrig;continue;}
      if(current.__rdHist&&current.__rdHistOrig){current=current.__rdHistOrig;continue;}
      break;
    }
    return current;
  }
  function retirePriorInstall(){
    var prior=null;
    try{prior=window.__mlsRedesign||null;}catch(e){return false;}
    if(!(prior&&prior.installed))return false;
    if(prior.version===VERSION)return true;
    _priorRedesign=prior;
    try{if(typeof prior.revert==='function')prior.revert();}catch(e){}
    /* 3.2.1 left these live nodes behind, so its six-action New menu won the
       idempotency guard even after the new asset evaluated. */
    removeNode('mlsRdNewMenu');removeNode('mlsRdNewBtn');removeNode('mlsRdUserChip');
    try{
      var current=window.showView,unwrapped=unwrapKnownRedesignOwners(current);
      if(unwrapped!==current)window.showView=unwrapped;
      /* A shipped 3.2.1 history closure had no __rdHistOrig pointer. It cannot
         be reflectively recovered, so keep it only as an opaque forwarder;
         ensureHistoryOwner suppresses its retired stack while it delegates to
         the real host showView. Pointer-bearing wrappers are fully unwrapped. */
      if(window.showView&&window.showView.__rdHist&&!window.showView.__rdHistOrig)_opaqueLegacyHistory=window.showView;
    }catch(e){}
    return false;
  }
  try{if(retirePriorInstall())return;}catch(e){return;}
  var FONT_ID = "mlsRdFont", STYLE_ID = "mlsRdStyle", CLS = "mls-redesign";
  var FONT_HREF = "fonts/fonts.css"; /* self-hosted Newsreader + Public Sans */
  var _obs = null, _lifeObs = null, _observedRoot = null, _lifeRoot = null, _t = [], _schedT = null;
  var _surfaceInputHandler = null, _surfacePatientHandler = null, _surfaceStorageHandler = null;
  var _railKeyHandler = null, _railResizeHandler = null;
  function $(id){ try{return document.getElementById(id);}catch(e){return null;} }
  function mk(tag, css, html){ var e=document.createElement(tag); if(css)e.style.cssText=css; if(html!=null)e.innerHTML=html; return e; }

  /* ---------------- Editorial Calm CSS ---------------- */
  var CSS = [
"/* ===== MLSscribe Editorial Calm reskin v3 ===== */",
":root{",
"  --bg:#FBFAF7; --card:#ffffff; --ink:#1A211C; --muted:#636E66;",
"  --line:#E7E5DD; --brand:#2E6A4B; --brand-dk:#204034;",
"  --green:#2E6A4B; --green-dk:#204034; --amber:#985F26;",
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
"body.mls-redesign ::placeholder{ color:#68736B; }",
"body.mls-redesign #mlsEz3 .ez3-safety,body.mls-redesign #mlsEz3 .ez3-fstep,body.mls-redesign #mlsEz3 .ez3-prow .dob,body.mls-redesign #mlsEz3 .ez3-prow .tm,body.mls-redesign #mlsEz3 .ez3-qchip .qt,body.mls-redesign #mlsEz3 .ez3fl-staffLink,body.mls-redesign #mlsEz3 .ez3fl-rechint,body.mls-redesign #mlsEz3 .ez3fl-txhead span,body.mls-redesign #mlsEz3 .ez3fl-txmeta,body.mls-redesign #mlsEz3 .ez3fl-step .s{ color:#68736B !important; }",
"body.mls-redesign #mlsSmBtn{ color:#68736B !important; }",
"body.mls-redesign .ez3fl-step .s{ color:#68736B !important; }",
"body.mls-redesign ::-webkit-scrollbar{ width:10px;height:10px; }",
"body.mls-redesign ::-webkit-scrollbar-thumb{ background:#D6D2C6;border-radius:8px;border:2px solid transparent;background-clip:padding-box; }",

"/* ---- shell geometry: content clears the fixed rail ---- */",
"body.mls-redesign.mls-rd-shell{ padding-left:var(--rail-w); }",
"body.mls-redesign.mls-rd-shell #appHeader{ position:sticky; top:0; z-index:60; }",

"/* ---- top bar ---- */",
"#appHeader.mlsRdHdr{ background:var(--header) !important; border-bottom:1px solid var(--line) !important; box-shadow:none !important; }",
"#mlsRdTop{ height:60px; width:100%; min-width:0; flex:1 1 100%; box-sizing:border-box; display:flex; align-items:center; gap:14px; padding:0 22px; }",
"#mlsRdTitle{ flex:0 0 auto; font-family:'Newsreader',Georgia,serif; font-weight:600; font-size:19px; letter-spacing:-.01em; color:var(--ink); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:300px; }",
"#appHeader.mlsRdHdr > [data-mlsrd-hid]{ display:none !important; }",
"#mlsRdSearchSlot{ position:relative; flex:0 1 340px; min-width:120px; margin-left:auto; }",
"#mlsRdSearchSlot .mlsRdSearch{ width:100%; height:38px; border-radius:10px; border:1px solid #E4E1D8; background:var(--card); color:var(--ink); padding:0 34px 0 36px; font-size:13.5px; outline:none; transition:border-color .15s, box-shadow .15s; }",
"#mlsRdSearchSlot .mlsRdSearch:focus{ border-color:var(--brand); box-shadow:0 0 0 3px rgba(46,106,75,.12); }",
"#mlsRdKbd{ position:absolute; right:10px; top:50%; transform:translateY(-50%); color:#68736B; font-size:10.5px; border:1px solid var(--line); border-radius:5px; padding:2px 6px; background:var(--field-bg); }",

"/* ---- '+ New' quick actions in the top bar (v3.1.0) ---- */",
"#mlsRdNewBtn{ display:inline-flex; align-items:center; gap:7px; height:38px; padding:0 15px; border-radius:10px; border:none; background:var(--brand-dk); color:#fff; font-size:13px; font-weight:700; cursor:pointer; flex:none; box-shadow:0 8px 20px -8px rgba(32,64,52,.6); transition:background .18s ease, transform .12s ease; }",
"#mlsRdNewBtn:hover{ background:#28503f; }",
"#mlsRdNewBtn:active{ transform:translateY(1px); }",
"#mlsRdNewBtn .plus{ font-size:17px; line-height:1; font-weight:600; }",
"#mlsRdNewMenu{ position:fixed; z-index:99981; display:none; flex-direction:column; min-width:216px; background:var(--card); border:1px solid var(--line); border-radius:12px; padding:6px; box-shadow:0 1px 2px rgba(20,33,28,.04),0 16px 40px rgba(20,33,28,.14); }",
"#mlsRdNewMenu.open{ display:flex; animation:mlsRdNewIn .16s ease; }",
"@keyframes mlsRdNewIn{ from{ opacity:0; transform:translateY(-6px); } to{ opacity:1; transform:none; } }",
"@media (prefers-reduced-motion: reduce){ #mlsRdNewMenu.open{ animation:none; } }",
"#mlsRdNewMenu button{ display:flex; align-items:center; gap:10px; width:100%; text-align:left; background:transparent; border:0; border-radius:8px; padding:9px 11px; font-size:13.5px; font-weight:600; color:var(--ink); cursor:pointer; }",
"#mlsRdNewMenu button:hover{ background:#F0EEE7; }",
"#mlsRdNewMenu button:focus-visible{ outline:3px solid rgba(46,106,75,.42); outline-offset:1px; background:#F0EEE7; }",
"body.theme-dark #mlsRdNewMenu button:hover{ background:#1F2721; }",
"/* The floating '+' FAB (#mlsFab) duplicated these actions and cluttered the",
"   working area. The top-bar button is now the single owner at every width;",
"   phones reduce it to a compact plus while keeping the same accessible name. */",
"@media (min-width:761px){ body.mls-rd-shell #mlsFab, body.mls-rd-shell #mlsFabMenu{ display:none !important; } }",
"@media (max-width:760px){ #mlsRdNewBtn{ display:inline-flex !important; width:38px; padding:0 !important; justify-content:center; font-size:0; } #mlsRdNewBtn .plus{font-size:19px;} }",

"/* ---- nav rail ---- */",
"#mlsRdNav{ position:fixed; left:0; top:0; bottom:0; width:var(--rail-w); z-index:65; background:var(--bg); border-right:1px solid var(--line); display:flex; flex-direction:column; padding:14px 12px 12px; overflow:hidden; }",
"#mlsRdNav .mainnav{ display:flex !important; flex-direction:column !important; gap:2px !important; align-items:stretch !important; height:auto !important;",
"  background:transparent !important; border:0 !important; box-shadow:none !important; border-radius:0 !important; padding:0 !important; margin:0 !important;",
"  overflow-y:auto !important; overflow-x:hidden !important; flex:0 1 auto; min-height:0; position:static !important; top:auto !important; }",
"#mlsRdNav .navtab{ align-items:center !important; justify-content:flex-start !important; text-align:left !important; gap:11px !important; width:100%; min-width:0 !important; height:auto !important; min-height:38px;",
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
"body.mls-redesign #mlsRdNav .mainnav > .navtab[data-mlsrd-primary-hidden='1']{ display:none !important; }",
"#mlsRdRailLogo{ display:flex; align-items:center; gap:10px; padding:4px 8px 14px; flex:none; }",
"#mlsRdRailFoot{ margin-top:auto; flex:none; border-top:1px solid #EAE6DB; padding-top:10px; display:flex; flex-direction:column; gap:2px; }",
"body.theme-dark #mlsRdRailFoot{ border-top-color:#2B342D; }",
"#mlsRdRailFoot .mlsRdFootBtn{ display:flex; align-items:center; gap:11px; padding:9px 11px; border-radius:10px; color:#55605A; font-size:13.5px; font-weight:600; cursor:pointer; background:transparent; border:0; width:100%; text-align:left; transition:background .13s; }",
"body.theme-dark #mlsRdRailFoot .mlsRdFootBtn{ color:#9CA89E; }",
"#mlsRdRailFoot .mlsRdFootBtn:hover{ background:#F0EEE7; color:var(--ink); }",
"body.theme-dark #mlsRdRailFoot .mlsRdFootBtn:hover{ background:#1F2721; }",
"#mlsRdUserChip{ display:flex; align-items:center; gap:10px; padding:10px 10px 4px; }",
"#mlsRdUserChip .av{ width:30px; height:30px; border-radius:50%; background:var(--wash); color:var(--brand); font-weight:700; font-size:12px; display:flex; align-items:center; justify-content:center; flex:none; }",
"#mlsRdUserChip .nm{ font-size:12.5px; font-weight:700; color:var(--ink); line-height:1.15; max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
"#mlsRdUserChip .sub{ font-size:11px; color:#68736B; }",

"/* ---- mobile: off-canvas rail ---- */",
"#mlsRdRailBtn{ display:none; width:38px; height:38px; border-radius:9px; border:1px solid #E4E1D8; background:var(--card); color:#55605A; cursor:pointer; align-items:center; justify-content:center; flex:none; }",
"#mlsRdBackBtn{ display:flex; visibility:hidden; width:38px; height:38px; border-radius:9px; border:1px solid #E4E1D8; background:var(--card); color:#55605A; cursor:pointer; align-items:center; justify-content:center; flex:none; font-size:17px; line-height:1; }",
"#mlsRdBackBtn:hover, #mlsRdRailLogo:hover, #mlsRdTitle.rd-homelink:hover{ background:#F0EEE7; }",
"#mlsRdRailLogo{ cursor:pointer; border-radius:9px; }",
"#mlsRdTitle.rd-homelink{ cursor:pointer; border-radius:8px; padding:2px 8px; margin-left:-8px; }",
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
"body.mls-redesign .badge.draft{ background:#FCF8EF !important; color:#985F26 !important; border:1px solid #EFE4CE !important; }",
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
"/* One owner per action. The Visit workspace already contains the three voice",
"   tools, + New owns quick creation, and Pay Reports live in Calendar / AI",
"   Studio / Menu. Retire the persistent duplicates and idle setup/status",
"   floaters; active voice and active progress states remain visible. */",
"body.mls-redesign #mlsPrvbBtn, body.mls-redesign #mlsPhPrompt,",
"body.mls-redesign #mlsAsstFab, body.mls-redesign #mlsDaDock,",
"body.mls-redesign #mlsCopVoiceBtn:not(.mls-bl42-on){ display:none !important; }",
"html body.mls-redesign.mls-top-voice-tools #mlsAsstFab,",
"html body.mls-redesign.mls-top-voice-tools #mlsDaDock,",
"html body.mls-redesign.mls-top-voice-tools #mlsCopVoiceBtn:not(.mls-bl42-on){ display:none !important; }",
"body.mls-redesign #mlsCopVoiceBtn.mls-bl42-on{ display:inline-flex !important; }",
"body.mls-redesign #mlsPsChip.idle{ display:none !important; }",
"body.mls-redesign.mls-no-active-patient #patientBar{ display:none !important; }",
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
  function mark(){ try{
    if(!document.documentElement.classList.contains(CLS)) document.documentElement.classList.add(CLS);
    if(document.body&&!document.body.classList.contains(CLS)) document.body.classList.add(CLS);
  }catch(e){} }

  /* ---------------- shell (light rail + 60px top bar) ---------------- */
  var LOGO_SVG='<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#8FD8BE" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 13h4l2-6 3 11 2.4-7 1.6 3H21"/></svg>';
  var SEARCH_ICON='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#68736B" stroke-width="2"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>';
  var MENU_ICON='<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#55605A" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';
  var GEAR_ICON='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.4 5.4l2.1 2.1M16.5 16.5l2.1 2.1M18.6 5.4l-2.1 2.1M7.5 16.5l-2.1 2.1"/></svg>';
  var BURGER_ICON='<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>';

  /* Belt-and-suspenders mobile drawer: the class-based CSS is primary, but an
     inline transform makes open/close deterministic even if a foreign rule or
     stale renderer interferes. Desktop (>900px) never gets an inline value. */
  function railSlide(open){
    try{
      var r=$('mlsRdNav'); if(!r) return;
      var drawer=!!((window.matchMedia&&window.matchMedia('(max-width: 900px)').matches)||document.documentElement.classList.contains('mls-rail-collapsed'));
      if(!drawer) r.style.transform='';
      else r.style.transform=open?'none':'';
      var visible=!drawer||!!open;
      r.setAttribute('aria-hidden',visible?'false':'true');
      try{ r.inert=!visible; }catch(e0){}
      var b=$('mlsRdRailBtn');
      if(b) b.setAttribute('aria-expanded',drawer&&open?'true':'false');
      var sc=$('mlsRdScrim');
      if(sc) sc.setAttribute('aria-hidden',drawer&&open?'false':'true');
    }catch(e){}
  }
  function focusFirstRailItem(){
    try{
      var drawer=!!((window.matchMedia&&window.matchMedia('(max-width: 900px)').matches)||document.documentElement.classList.contains('mls-rail-collapsed'));
      if(drawer&&!document.documentElement.classList.contains('mls-rail-open')) return false;
      var rows=[].slice.call(document.querySelectorAll('#mlsRdNav .mainnav .navtab:not([hidden]):not([aria-hidden="true"])'));
      var first=rows.filter(function(el){ var s=getComputedStyle(el),r=el.getBoundingClientRect(); return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0; })[0];
      if(first){ try{first.focus({preventScroll:true});}catch(e0){first.focus();} return document.activeElement===first; }
    }catch(e){}
    return false;
  }
  function isOnLogin(){
    try{ var a=document.querySelector('#authScreen, .auth-wrap'); if(!a) return false;
      var cs=getComputedStyle(a); if(cs.display==='none'||cs.visibility==='hidden') return false;
      return a.getBoundingClientRect().height>40; }catch(e){ return false; }
  }
  function setFab(hide){ try{ ['mls-assist-badge','mlsAddPtLauncher'].forEach(function(id){ var e=$(id), next=hide?'none':''; if(e&&e.style.display!==next) e.style.display=next; }); }catch(e){} }

  /* '+ New' owns creation only. Navigation, Find, and Ask already have stable
     homes in the rail/top bar/Menu, so duplicating them here made the label
     misleading and forced doctors to remember overlapping launchers. */
  function ensureNewBtn(){
    try{
      var meSlot=$('mlsRdMenuSlot'); if(!meSlot || $('mlsRdNewBtn')) return;
      var b=mk('button','','<span class="plus">+</span> New'); b.id='mlsRdNewBtn'; b.type='button'; b.title='Quick actions';
      b.setAttribute('aria-haspopup','menu'); b.setAttribute('aria-expanded','false'); b.setAttribute('aria-controls','mlsRdNewMenu');
      meSlot.insertBefore(b, meSlot.firstChild);
      var menu=mk('div'); menu.id='mlsRdNewMenu'; menu.setAttribute('role','menu'); menu.setAttribute('aria-label','Quick actions'); document.body.appendChild(menu);
      var ACTS=[
        ['New patient', function(){ try{ if(typeof showView==='function') showView('patients'); if(typeof newPatient==='function') setTimeout(newPatient,40); }catch(e){} }],
        ['New visit', function(){ try{ if(typeof showView==='function') showView('visit'); if(typeof newVisit==='function') newVisit(); }catch(e){} }],
        ['New appointment', function(){ try{ if(typeof calScheduleForPatient==='function') calScheduleForPatient(); }catch(e){} }]
      ];
      function close(restore){
        menu.classList.remove('open'); b.setAttribute('aria-expanded','false');
        if(restore){ try{ b.focus({preventScroll:true}); }catch(e){ try{b.focus();}catch(_){} } }
      }
      function items(){ return [].slice.call(menu.querySelectorAll('button[role="menuitem"]')); }
      function focusItem(index){ var rows=items(); if(!rows.length)return; index=(index+rows.length)%rows.length; try{rows[index].focus({preventScroll:true});}catch(e){rows[index].focus();} }
      function open(){
        menu.innerHTML='';
        ACTS.forEach(function(a){ var r=document.createElement('button'); r.type='button'; r.setAttribute('role','menuitem'); r.textContent=a[0];
          r.addEventListener('click',function(ev){ ev.stopPropagation(); close(false); a[1](); });
          r.addEventListener('keydown',function(ev){ if(!ev||!/^(Enter| |Spacebar)$/.test(ev.key))return;ev.preventDefault();ev.stopPropagation();r.click(); });
          menu.appendChild(r); });
        var r=b.getBoundingClientRect();
        menu.style.top=(r.bottom+8)+'px';
        menu.style.right=Math.max(8, window.innerWidth-r.right)+'px';
        menu.classList.add('open');
        b.setAttribute('aria-expanded','true');
        setTimeout(function(){ focusItem(0); },0);
      }
      function toggleMenu(e){ try{ if(e)e.stopPropagation(); }catch(_){}
        if(menu.classList.contains('open')) close(true); else open(); }
      b.addEventListener('click',toggleMenu);
      b.addEventListener('keydown',function(e){
        if(!e||!/^(Enter| |Spacebar)$/.test(e.key)) return;
        e.preventDefault(); toggleMenu(e);
      });
      menu.addEventListener('keydown',function(e){
        try{
          var rows=items(), at=rows.indexOf(document.activeElement);
          if(e.key==='Escape'||e.key==='Esc'){ e.preventDefault(); e.stopPropagation(); close(true); }
          else if(e.key==='ArrowDown'){ e.preventDefault(); focusItem(at+1); }
          else if(e.key==='ArrowUp'){ e.preventDefault(); focusItem(at-1); }
          else if(e.key==='Home'){ e.preventDefault(); focusItem(0); }
          else if(e.key==='End'){ e.preventDefault(); focusItem(rows.length-1); }
          else if(e.key==='Tab'){
            e.preventDefault(); close(false);
            var next=e.shiftKey?b:($('mlsTbMenuBtn')||$('mlsAccountMenuBtn')||b);
            try{next.focus({preventScroll:true});}catch(e0){next.focus();}
          }
        }catch(_){}
      });
      document.addEventListener('click',function(e){ try{ if(menu.classList.contains('open') && !b.contains(e.target) && !menu.contains(e.target)) close(false); }catch(_){} }, true);
      document.addEventListener('keydown',function(e){ try{ if((e.key==='Escape'||e.key==='Esc') && menu.classList.contains('open')){ e.preventDefault(); close(true); } }catch(_){} });
      window.addEventListener('resize',function(){ close(false); });
    }catch(e){}
  }
  function hideChrome(){ try{ var t=$('mlsRdTop'),n=$('mlsRdNav'); if(t)t.style.display='none'; if(n)n.style.display='none'; if(document.body)document.body.classList.remove('mls-rd-shell'); setFab(true); }catch(e){} }

  function userInfo(){
    var initials='MS', name='Account', sub='Settings';
    try{ var nm=null;
      try{ nm=(window.__mlsProviderLabel&&window.__mlsProviderLabel())||null; }catch(e){}
      if(!nm) nm=localStorage.getItem('mls_provider_name')||localStorage.getItem('mls_name')||localStorage.getItem('providerName');
      if(!nm&&window.bkUser&&window.bkUser.name) nm=window.bkUser.name;
      if(!nm){ var w=$('whoLabel'); if(w&&w.textContent.trim()) nm=w.textContent.trim(); }
      if(nm){ name=nm;
        /* initials from the first alphanumeric of the first/last words only —
           indexing [0] on a word that starts with an emoji (e.g. a "👤 ..."
           label) splits the surrogate pair and renders a broken � glyph */
        var pp=nm.trim().split(/\s+/).map(function(w){ var m=w.match(/[A-Za-z0-9]/); return m?m[0]:''; }).filter(Boolean);
        initials=((pp[0]||'')+(pp.length>1?pp[pp.length-1]:'')).toUpperCase()||'MS';
      }
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

  /* Keep the clinician's repeat-every-visit destinations together without
     cloning or replacing a route. Orders is deliberately NOT relabelled as
     "Tasks": it is a real order workspace, not a general clinical inbox. */
  /* UI rework (owner /goal 2026-07-24 "free the doctor from all the
     buttons"): History leaves the rail. Its list stays one tap away — Today's
     "View completed notes", every patient chart, the command palette, and
     showView('history') all still open it. */
  /* Studio merge (owner 2026-07-26: "add the analysis tab to the ai studio tab
     smartly"): nav_analysis LEAVES the lead routes. Analysis is no longer a
     destination — it is AI Studio's "Practice" section — so a rail tab labelled
     Practice sitting beside a rail tab labelled Tools, both landing on the same
     screen, is two routes to one place. That is the duplication the whole
     rebuild is removing.
     It is FOLDED, not deleted: showView('analysis') still works and lands on
     the merged surface with Practice open, and the Calm Shell's Tools menu
     offers it as "Practice trends (AI Studio)". nav_studio keeps the label
     "Tools" it already had; renaming it is a separate decision. */
  var PRIMARY_NAV=[
    {id:'nav_visit',label:'Today'},
    {id:'nav_patients',label:'Patients'},
    {id:'nav_calendar',label:'Calendar'},
    {id:'nav_studio',label:'Tools'}
  ];
  var FOLDED_NAV=['nav_history','nav_analysis'];
  var SECONDARY_NAV=['nav_staffpull','mlsPtab_reviews','mlsPtab_send','nav_help'];
  function navDirectText(tab){
    try{ for(var i=0;i<tab.childNodes.length;i++) if(tab.childNodes[i].nodeType===3) return tab.childNodes[i]; }catch(e){}
    return null;
  }
  function setClinicianNavLabel(tab,label){
    try{
      var textNode=navDirectText(tab);
      if(!tab.hasAttribute('data-mlsrd-original-text')){
        tab.setAttribute('data-mlsrd-original-text',textNode?textNode.data:'');
        if(!textNode){ textNode=document.createTextNode(''); tab.insertBefore(textNode,tab.firstChild); tab.setAttribute('data-mlsrd-text-created','1'); }
      }
      if(!tab.hasAttribute('data-mlsrd-original-aria-label')) tab.setAttribute('data-mlsrd-original-aria-label',tab.hasAttribute('aria-label')?tab.getAttribute('aria-label'):'__none__');
      var original=tab.getAttribute('data-mlsrd-original-text')||'', wordAt=original.search(/[A-Za-z0-9]/);
      var iconPrefix=wordAt>0?original.slice(0,wordAt):'';
      var next=iconPrefix+label+' ';
      if(textNode.data!==next) textNode.data=next;
      tab.setAttribute('aria-label',label);
      tab.setAttribute('data-mlsrd-primary','1');
    }catch(e){}
  }
  function featureDirectoryHas(route){
    try{
      var rows=window.__mlsFeatureDirectory;
      if(!rows||!rows.length) return false;
      for(var i=0;i<rows.length;i++) if(rows[i]&&rows[i].route===route) return true;
    }catch(e){}
    return false;
  }
  function secondaryRouteAvailable(id){
    try{
      if(id==='nav_staffpull') return !!document.querySelector('#mlsTbMenuPanel .mlsTbItem[data-mls-action="staff-prep"]');
      if(id==='mlsPtab_reviews') return !!document.querySelector('#mlsTbMenuPanel .mls-menu-reviews')||featureDirectoryHas('reach:reviews');
      if(id==='mlsPtab_send') return featureDirectoryHas('reach:send');
      if(id==='nav_help') return !!($('mlsObtMenuRow')||$('mlsGtMenuRow')||$('mlsHowTo2Row'));
    }catch(e){}
    return false;
  }
  function wireNavAccessibility(tab){
    try{
      if(!tab.hasAttribute('role')){ tab.setAttribute('role','button'); tab.setAttribute('data-mlsrd-added-role','1'); }
      if(!tab.hasAttribute('tabindex')){ tab.setAttribute('tabindex','0'); tab.setAttribute('data-mlsrd-added-tabindex','1'); }
      if(!tab._mlsRdKeyHandler){
        tab._mlsRdKeyHandler=function(ev){
          try{
            if(tab.getAttribute('data-mlsrd-primary-hidden')==='1') return;
            if(ev.key==='Enter'||ev.key===' '||ev.key==='Spacebar'){
              ev.preventDefault(); if(ev.key!=='Enter') ev.stopPropagation(); tab.click();
            }
          }catch(e){}
        };
        tab.addEventListener('keydown',tab._mlsRdKeyHandler);
      }
    }catch(e){}
  }
  function restoreSecondaryRoute(tab){
    try{
      var priorTab=tab.getAttribute('data-mlsrd-prehide-tabindex');
      if(priorTab!==null){ if(priorTab==='__none__') tab.removeAttribute('tabindex'); else tab.setAttribute('tabindex',priorTab); tab.removeAttribute('data-mlsrd-prehide-tabindex'); }
      var priorAria=tab.getAttribute('data-mlsrd-prehide-aria-hidden');
      if(priorAria!==null){ if(priorAria==='__none__') tab.removeAttribute('aria-hidden'); else tab.setAttribute('aria-hidden',priorAria); tab.removeAttribute('data-mlsrd-prehide-aria-hidden'); }
      if(tab.getAttribute('data-mlsrd-added-hidden')==='1'){ tab.hidden=false; tab.removeAttribute('data-mlsrd-added-hidden'); }
      tab.removeAttribute('data-mlsrd-primary-hidden');
    }catch(e){}
  }
  function syncPrimaryNavState(){
    try{
      var nav=document.querySelector('.mainnav'); if(!nav) return;
      var tabs=nav.querySelectorAll('.navtab');
      for(var i=0;i<tabs.length;i++){
        var tab=tabs[i];
        if(tab.classList.contains('on')) tab.setAttribute('aria-current','page');
        else if(tab.getAttribute('aria-current')==='page') tab.removeAttribute('aria-current');
      }
    }catch(e){}
  }
  function organizePrimaryNavigation(){
    try{
      var nav=document.querySelector('.mainnav'); if(!nav) return false;
      nav.setAttribute('role','navigation'); nav.setAttribute('aria-label','Primary navigation');
      var tabs=[].slice.call(nav.querySelectorAll('.navtab'));
      for(var a=0;a<tabs.length;a++) wireNavAccessibility(tabs[a]);

      var desired=[];
      for(var i=0;i<PRIMARY_NAV.length;i++){
        var spec=PRIMARY_NAV[i], tab=$(spec.id);
        if(tab&&tab.parentElement===nav){ setClinicianNavLabel(tab,spec.label); desired.push(tab); }
      }
      for(var f=0;f<FOLDED_NAV.length;f++){
        try{
          var foldTab=$(FOLDED_NAV[f]);
          if(foldTab&&foldTab.getAttribute('data-mlsrd-folded')!=='1'){
            foldTab.setAttribute('data-mlsrd-folded','1');
            if(foldTab.style) foldTab.style.display='none';
          }
        }catch(eFold){}
      }
      var settled=true;
      for(var d=0;d<desired.length;d++) if(tabs[d]!==desired[d]){ settled=false; break; }
      if(!settled){
        var before=null;
        for(var b=0;b<tabs.length;b++) if(desired.indexOf(tabs[b])<0){ before=tabs[b]; break; }
        for(var m=0;m<desired.length;m++) nav.insertBefore(desired[m],before);
      }

      for(var s=0;s<SECONDARY_NAV.length;s++){
        var secondary=$(SECONDARY_NAV[s]); if(!secondary||secondary.parentElement!==nav) continue;
        var hide=secondaryRouteAvailable(SECONDARY_NAV[s]);
        if(hide){
          if(secondary.getAttribute('data-mlsrd-primary-hidden')!=='1'){
            secondary.setAttribute('data-mlsrd-prehide-tabindex',secondary.hasAttribute('tabindex')?secondary.getAttribute('tabindex'):'__none__');
            secondary.setAttribute('data-mlsrd-prehide-aria-hidden',secondary.hasAttribute('aria-hidden')?secondary.getAttribute('aria-hidden'):'__none__');
            if(!secondary.hidden) secondary.setAttribute('data-mlsrd-added-hidden','1');
          }
          secondary.setAttribute('data-mlsrd-primary-hidden','1');
          secondary.setAttribute('aria-hidden','true'); secondary.setAttribute('tabindex','-1'); secondary.hidden=true;
        }else if(secondary.getAttribute('data-mlsrd-primary-hidden')==='1'){
          restoreSecondaryRoute(secondary);
        }
      }
      syncPrimaryNavState();
      return true;
    }catch(e){ return false; }
  }
  /* Owner 2026-07-26: "add my logo to the top left and a click on it takes u
     home / to visit." The title is now [brand mark][view name], one control,
     and the whole thing keeps the existing click-home. The text lives in its
     own span so this updater can never wipe the mark. */
  function ensureTitleBrand(el){
    if(el.querySelector('.rd-brandmark')) return el.querySelector('.rd-titletext');
    el.textContent='';
    var mark=mk('span','width:26px;height:26px;border-radius:7px;background:#204034;display:inline-flex;align-items:center;justify-content:center;flex:none;margin-right:9px;vertical-align:middle',LOGO_SVG);
    mark.className='rd-brandmark';
    var txt=mk('span'); txt.className='rd-titletext';
    el.appendChild(mark); el.appendChild(txt);
    el.style.display='inline-flex'; el.style.alignItems='center';
    return txt;
  }
  function syncTitle(){
    try{ var el=$('mlsRdTitle'); if(!el) return;
      var txtEl=ensureTitleBrand(el);
      /* overlays (Reviews) mark their tab .on without clearing the view's —
         the LAST .on is the most recently activated surface */
      var ons=document.querySelectorAll('#mlsRdNav .navtab.on');
      var on=ons.length?ons[ons.length-1]:null;
      var t=on?navLabelOf(on):'';
      t=t.replace(/^[^A-Za-z0-9]+\s*/,'');   /* "⭐ Reviews" -> "Reviews" */
      if(!t) t='MLS Scribe';
      if(txtEl.textContent!==t) txtEl.textContent=t;
    }catch(e){}
  }

  /* Reserve the back control's geometry for the lifetime of the shell. Only
     its availability changes, so the title and Find field never jump left or
     right as the navigation stack fills and empties. */
  function syncBackButton(){
    try{
      var back=$('mlsRdBackBtn'); if(!back) return;
      var h=window.__mlsViewHist, available=!!(h&&h.stack&&h.stack.length);
      back.style.display='flex';
      back.style.visibility=available?'visible':'hidden';
      back.disabled=!available;
      back.tabIndex=available?0:-1;
      back.setAttribute('aria-hidden',available?'false':'true');
    }catch(e){}
  }

  function chainHasCurrentHistory(fn){
    var current=fn,guard=0;
    while(typeof current==='function'&&guard++<12){
      if(current.__rdHist&&current.__rdHistVersion===VERSION)return true;
      if(current.__rdTitleWrapped&&current.__rdTitleOrig){current=current.__rdTitleOrig;continue;}
      if(current.__rdHist&&current.__rdHistOrig){current=current.__rdHistOrig;continue;}
      break;
    }
    return false;
  }
  function ensureHistoryOwner(){
    try{
      if(typeof window.showView!=='function'||chainHasCurrentHistory(window.showView))return;
      var original=window.showView;
      /* A reversible older owner is removed instead of nested. */
      while(original&&original.__rdTitleWrapped&&original.__rdTitleOrig)original=original.__rdTitleOrig;
      while(original&&original.__rdHist&&original.__rdHistOrig)original=original.__rdHistOrig;
      if(window.showView!==original)window.showView=original;
      var opaque=!!(original&&original.__rdHist&&!original.__rdHistOrig);
      if(opaque)_opaqueLegacyHistory=original;
      if(!_historyBeforeInstallCaptured){
        _historyBeforeInstallHadOwn=Object.prototype.hasOwnProperty.call(window,'__mlsViewHist');
        _historyBeforeInstall=window.__mlsViewHist;_historyBeforeInstallCaptured=true;
      }
      var oldState=window.__mlsViewHist||{},oldStack=Array.isArray(oldState.stack)?oldState.stack.slice(-30):[];
      var state={stack:oldStack,lock:false,cur:(oldState.cur&&oldState.cur!=='__pinned')?oldState.cur:'visit',owner:VERSION};
      window.__mlsViewHist=state;
      _historyOriginal=original;
      _historyWrapper=function(v){
        var canonical=window.__mlsViewHist;
        try{
          var cur=canonical&&canonical.cur;
          if(canonical&&!canonical.lock&&cur&&cur!==v&&cur!=='__pinned'){canonical.stack.push(cur);if(canonical.stack.length>30)canonical.stack.shift();}
          if(canonical&&v&&v!=='__pinned')canonical.cur=v;
        }catch(e){}
        var out;
        try{
          /* The opaque 3.2.1 forwarder reads the global state. Give it a
             locked throwaway state so one navigation produces one history
             entry, then immediately restore the canonical 3.2.2 state. */
          if(opaque)window.__mlsViewHist={stack:[],lock:true,cur:'__pinned',owner:'retired-legacy'};
          out=original.apply(this,arguments);
        }finally{
          if(opaque)window.__mlsViewHist=canonical;
          syncBackButton();
        }
        return out;
      };
      _historyWrapper.__rdHist=true;
      _historyWrapper.__rdHistOrig=original;
      _historyWrapper.__rdHistVersion=VERSION;
      _historyWrapper.__rdOpaqueLegacy=opaque;
      window.showView=_historyWrapper;
    }catch(e){}
  }
  function ensureBackControl(top){
    try{
      if(!top)return null;
      var prior=$('mlsRdBackBtn');
      if(prior&&prior.getAttribute('data-mlsrd-back-version')===VERSION)return prior;
      var back=mk('button','','&#8592;');back.id='mlsRdBackBtn';back.type='button';back.title='Back to where you just were';
      back.setAttribute('aria-label','Back to the previous screen');back.setAttribute('data-mlsrd-back-version',VERSION);
      back.addEventListener('click',function(e){
        try{
          e.stopPropagation();var h=window.__mlsViewHist,prev=h&&h.stack&&h.stack.pop();
          if(prev){h.lock=true;try{window.showView(prev);}finally{h.lock=false;}}
          syncBackButton();
        }catch(_){}
      });
      if(prior&&prior.parentNode)prior.parentNode.replaceChild(back,prior);
      else{var title=$('mlsRdTitle');if(title&&title.parentNode===top)top.insertBefore(back,title);else top.appendChild(back);}
      syncBackButton();return back;
    }catch(e){return null;}
  }

  function buildShell(){
    var hdr=$('appHeader'); if(!hdr) return false;
    if(isOnLogin()){ hideChrome(); return false; }
    ensureHistoryOwner();
    if(!hdr.classList.contains('mlsRdHdr')) hdr.classList.add('mlsRdHdr');
    if(hdr.getAttribute('data-mlsrd-header-style')!=='1'){
      hdr.style.background=''; hdr.style.borderBottom=''; hdr.style.boxShadow='';
      hdr.style.position='sticky'; hdr.style.top='0'; hdr.style.zIndex='60';
      hdr.setAttribute('data-mlsrd-header-style','1');
    }

    var top=$('mlsRdTop');
    if(!top){
      /* hide original inner children (keep in DOM so handlers/hidden tool buttons survive) */
      [].slice.call(hdr.children).forEach(function(c){ if(c.id!=='mlsRdTop'&&c.id!=='mlsRdNav'){ c.setAttribute('data-mlsrd-hid','1'); c.style.display='none'; } });
      /* ---- TOP BAR ---- */
      top=mk('div'); top.id='mlsRdTop';
      var burger=mk('button','','<span style="display:flex" aria-hidden="true">'+BURGER_ICON+'</span>'); burger.id='mlsRdRailBtn'; burger.type='button'; burger.title='Primary navigation';
      burger.setAttribute('aria-label','Open primary navigation'); burger.setAttribute('aria-controls','mlsRdNav'); burger.setAttribute('aria-expanded','false');
      burger.addEventListener('click',function(e){
        try{
          e.stopPropagation(); var open=document.documentElement.classList.toggle('mls-rail-open'); railSlide(open);
          if(open){ focusFirstRailItem(); setTimeout(focusFirstRailItem,0); setTimeout(focusFirstRailItem,120); }
        }catch(_){}
      });
      top.appendChild(burger);
      /* Back arrow (owner request): one tap returns to the previous view. A
         tiny history stack is maintained by wrapping showView once; the
         reserved slot becomes inert when there is nowhere to go back to. */
      ensureBackControl(top);
      var title=mk('div'); title.id='mlsRdTitle'; title.textContent='MLS Scribe'; top.appendChild(title);
      /* Owner request: the wordmark/title at top-left takes you home (Visit). */
      title.classList.add('rd-homelink'); title.title='Back to the main Visit screen';
      title.addEventListener('click',function(){ try{ if(typeof window.showView==='function') window.showView('visit'); }catch(e){} });
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
      /* Owner request: clicking "MLS Scribe" in the rail returns to Visit. */
      logo.title='Back to the main Visit screen';
      logo.addEventListener('click',function(){
        try{
          if(typeof window.showView==='function') window.showView('visit');
          document.documentElement.classList.remove('mls-rail-open'); railSlide(false);
        }catch(e){}
      });
      /* one-click collapse: rail becomes an on-demand overlay (burger reopens) */
      var col=mk('button','','&#10094;'); col.id='mlsRdCollapse'; col.type='button';
      var initiallyCollapsed=document.documentElement.classList.contains('mls-rail-collapsed');
      col.title=initiallyCollapsed?'Pin the sidebar back in place':'Hide the sidebar - the menu button at top-left brings it back';
      col.setAttribute('aria-label',initiallyCollapsed?'Pin the sidebar':'Hide the sidebar');
      if(initiallyCollapsed) col.innerHTML='&#128204;';
      col.addEventListener('click',function(e){
        try{
          e.stopPropagation();
          var h=document.documentElement;
          var collapsed=h.classList.toggle('mls-rail-collapsed');
          h.classList.remove('mls-rail-open'); railSlide(false);
          col.innerHTML=collapsed?'&#128204;':'&#10094;';
          col.title=collapsed?'Pin the sidebar back in place':'Hide the sidebar - the menu button at top-left brings it back';
          col.setAttribute('aria-label',collapsed?'Pin the sidebar':'Hide the sidebar');
          try{ localStorage.setItem('mls_rail_collapsed',collapsed?'1':'0'); }catch(_){}
          if(collapsed) setTimeout(function(){ try{burger.focus({preventScroll:true});}catch(e0){burger.focus();} },0);
        }catch(_){}
      });
      logo.appendChild(col);
      hdr.appendChild(navWrap);

      /* Rail account buttons are fallback controls. The account unifier hides
         them once its single top-bar Account menu is mounted. */
      var foot=mk('div'); foot.id='mlsRdRailFoot';
      var set=mk('button','','<span style="display:flex">'+GEAR_ICON+'</span> Settings'); set.className='mlsRdFootBtn'; set.type='button';
      set.addEventListener('click',function(){ try{ if(typeof window.openSettings==='function') window.openSettings(); }catch(e){} });
      foot.appendChild(set);
      var out=mk('button','','<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/></svg> Sign out'); out.className='mlsRdFootBtn'; out.type='button';
      out.addEventListener('click',function(){ try{ if(typeof window.logout==='function') window.logout(); }catch(e){} });
      foot.appendChild(out);
      navWrap.appendChild(foot);

      /* scrim for mobile off-canvas */
      if(!$('mlsRdScrim')){ var sc=mk('div'); sc.id='mlsRdScrim'; sc.setAttribute('aria-hidden','true'); sc.addEventListener('click',function(){ document.documentElement.classList.remove('mls-rail-open'); railSlide(false); try{burger.focus({preventScroll:true});}catch(e0){burger.focus();} }); document.body.appendChild(sc); }
      /* close rail after choosing a view on mobile */
      navWrap.addEventListener('click',function(e){ try{ if(e.target&&e.target.closest&&e.target.closest('.navtab')){ var drawer=!!((window.matchMedia&&window.matchMedia('(max-width: 900px)').matches)||document.documentElement.classList.contains('mls-rail-collapsed')); document.documentElement.classList.remove('mls-rail-open'); railSlide(false); setTimeout(function(){ syncPrimaryNavState(); if(drawer)try{burger.focus({preventScroll:true});}catch(e0){burger.focus();} },0); } }catch(_){} });
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
      if(!_railKeyHandler){
        _railKeyHandler=function(e){
          try{
            if((e.key!=='Escape'&&e.key!=='Esc')||!document.documentElement.classList.contains('mls-rail-open')) return;
            e.preventDefault(); e.stopImmediatePropagation(); document.documentElement.classList.remove('mls-rail-open'); railSlide(false);
            var bb=$('mlsRdRailBtn'); if(bb)try{bb.focus({preventScroll:true});}catch(e0){bb.focus();}
          }catch(_){}
        };
        document.addEventListener('keydown',_railKeyHandler,true);
      }
      if(!_railResizeHandler){ _railResizeHandler=function(){ railSlide(document.documentElement.classList.contains('mls-rail-open')); }; window.addEventListener('resize',_railResizeHandler); }
    }
    /* Same-document upgrades reuse the existing top shell. Replace the old
       closure-bound Back button even when #mlsRdTop did not need rebuilding. */
    ensureBackControl(top);
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
    organizePrimaryNavigation();
    try{ var _t2=$('mlsRdTop'),_n=$('mlsRdNav'); if(_t2&&_t2.style.display!=='')_t2.style.display=''; if(_n&&_n.style.display!=='')_n.style.display=''; if(document.body&&!document.body.classList.contains('mls-rd-shell'))document.body.classList.add('mls-rd-shell'); setFab(false); }catch(e){}
    ensureNewBtn();
    railSlide(document.documentElement.classList.contains('mls-rail-open'));
    syncBackButton();
    syncTitle();
    refreshUserChip();
    return true;
  }
  /* every PREMIUM tag rendered by any module collapses to the ONE canonical
     badge (inline gradient styles at 9px rendered muddy/mismatched) */
  function normalizePremiumBadgeNode(s){
    try{
      if(!s||s.nodeType!==1||!s.matches||!s.matches('span,b,em,i,div')) return;
      if(s.children.length!==0||!s.isConnected) return;
      var t=(s.textContent||'').trim();
      if(!/^premium( feature)?$/i.test(t)) return;
      if(s.getAttribute('class')!=='mlsRdPrem') s.className='mlsRdPrem';
      if(s.hasAttribute('style')) s.removeAttribute('style');
      if(/feature/i.test(t)&&t!=='PREMIUM') s.textContent='PREMIUM';
    }catch(e){}
  }
  function normalizePremiumBadges(root){
    try{
      /* canonicalize EVERY premium badge, not just rail/menu — the AI Studio
         header carried a bare white-on-transparent span that read as "faded"
         (owner report 2026-07-13) */
      root=root||document;
      if(root.nodeType===1) normalizePremiumBadgeNode(root);
      if(!root.querySelectorAll) return;
      var spans=root.querySelectorAll('span,b,em,i,div');
      for(var i=0;i<spans.length;i++) normalizePremiumBadgeNode(spans[i]);
    }catch(e){}
  }
  function refreshUserChip(){ try{ var chip=$('mlsRdUserChip'); if(!chip) return; var u=userInfo();
    var nm=chip.querySelector('.nm'), sb=chip.querySelector('.sub'), av=chip.querySelector('.av');
    if(nm&&nm.textContent!==u.name) nm.textContent=u.name;
    if(sb&&sb.textContent!==u.sub) sb.textContent=u.sub;
    if(av&&av.textContent!==u.initials) av.textContent=u.initials; }catch(e){} }
  function styleToggle(vt){ try{ var mode=[].slice.call(vt.children).map(function(b){return /mlsVtOn/.test(b.className)?'1':'0';}).join('');
    if(vt.getAttribute('data-mlsrd-toggle-style')===mode) return;
    vt.style.cssText='display:flex;align-items:center;background:#F0EEE7;border:1px solid #E4E1D8;border-radius:10px;padding:3px;gap:2px';
    [].slice.call(vt.children).forEach(function(b){ var on=/mlsVtOn/.test(b.className);
      b.style.cssText='display:flex;align-items:center;height:30px;padding:0 14px;border:0;border-radius:8px;font-weight:700;font-size:13px;font-family:inherit;cursor:pointer;'+(on?'background:#fff;color:#1A211C;box-shadow:0 1px 3px rgba(20,33,28,.15);':'background:transparent;color:#68736B;'); });
    vt.setAttribute('data-mlsrd-toggle-style',mode); }catch(e){} }
  function styleSearch(se){ try{
    se.style.cssText=''; se.classList.add('mlsRdSearch');
    try{
      se.placeholder='Find patients and screens…';
      se.setAttribute('aria-label','Find patients and screens');
      se.setAttribute('title','Find patients and screens');
    }catch(e){}
  }catch(e){} }
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
      if(!grid.classList.contains('mlsRdVisitGrid')) grid.classList.add('mlsRdVisitGrid');
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
".mlsRdPrem, .mls-prem-pill{ background:#EFEAF8 !important; background-image:none !important; color:#7656B3 !important;",
"  font-size:9.5px !important; font-weight:700 !important; letter-spacing:.05em !important; text-transform:uppercase !important;",
"  padding:2px 7px !important; border-radius:5px !important; border:0 !important; line-height:1.5 !important; display:inline-block !important; vertical-align:1px; }",
"#mlsRdNav .navtab .mlsRdPrem, #mlsRdNav .navtab .mls-prem-pill{ margin-left:auto !important; flex:none !important; }",
"",
"/* ---- text-centering precision: kill the 1px-low baseline rounding on pills",
"     (day-hist/add-patient/tab-chip left this list 2026-07-13: retired or",
"     relocated by the corner cleanup - a display:inline-flex !important here",
"     was silently overriding their display:none) ---- */",
"body.mls-redesign #mlsEz3 .ez3-sm, body.mls-redesign #mlsEz3 .ez3-big, body.mls-redesign #mlsEz3 #ez3Adv{",
"  line-height:1 !important; display:inline-flex !important; align-items:center !important; justify-content:center !important; }",
"body.mls-redesign #mlsEz3 .ez3-big{ display:flex !important; flex-direction:column !important; }",
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
"body.mls-redesign #ez3Wrap > .ez3-clockbar .ez3-clock{ font-size:12.5px !important; font-weight:600 !important; color:#68736B !important; }",
"body.mls-redesign #ez3Wrap > .ez3-prov{ grid-column:2 !important; grid-row:1 !important; display:flex !important; align-items:center !important; gap:9px !important; margin:0 !important; justify-self:end; }",
"body.mls-redesign #ez3Wrap > .ez3-prov label{ font-size:11px !important; font-weight:700 !important; letter-spacing:.06em !important; text-transform:uppercase !important; color:#68736B !important; margin:0 !important; }",
"body.mls-redesign #ez3Wrap > #ez3AllProv{ grid-row:2 !important; min-height:50px !important; border-radius:12px !important; font-size:14.5px !important; margin:2px 0 0 !important; }",
"body.mls-redesign #ez3Wrap > .ez3fl-record{ grid-column:1 / -1 !important; grid-row:3 !important; }",
"body.mls-redesign #ez3Wrap > .ez3-row2{ grid-column:1 / -1 !important; grid-row:auto !important; display:flex !important; gap:8px !important; margin:0 !important; }",
"body.mls-redesign #ez3Wrap > .ez3-advrow{ grid-column:1 / -1 !important; grid-row:auto !important; justify-self:end; margin:-4px 0 0 !important; }",
"body.mls-redesign #ez3Wrap > #ez3HomeStatus{ grid-row:6 !important; margin:2px 0 0 !important; font-size:12.5px !important; color:#68736B !important; }",
"@media (max-width:760px){",
"  /* 1fr floors at min-content and let nowrap lines push the grid to ~460px",
"     (clipped by overflow-x:hidden = everything cut off at the right edge on a",
"     real phone - owner screenshot #2). minmax(0,1fr) + wrapping is the cure. */",
"  body.mls-redesign #ez3Wrap{ grid-template-columns:minmax(0,1fr) !important; }",
"  body.mls-redesign #ez3Wrap > *{ max-width:100% !important; min-width:0 !important; }",
"  #mlsEz3 button, #mlsEz3 small, #mlsEz3 .ez3-sub, #mlsEz3 .ez3-status{ white-space:normal !important; }",
"  #mlsEz3 #ez3AllProv{ height:auto !important; min-height:50px !important; }",
"  body.mls-redesign #ez3Wrap select{ width:100% !important; max-width:100% !important; }",
"  body.mls-redesign #mlsCtxBar .mdp-next{ max-width:100% !important; white-space:normal !important; text-align:left; }",
"  #mlsEz3, body.mls-redesign .card, body.mls-redesign [class*=card]{ max-width:100% !important; box-sizing:border-box !important; }",
"  #mlsEz3 .ez3fl-recbtn, #mlsEz3 .ez3fl-openws{ white-space:normal !important; word-break:break-word; }",
"  /* calendar provider strip: scrolls inside its own row, never widens the page */",
"  body.mls-redesign .t3r-rf{ max-width:100% !important; overflow-x:auto !important; flex-wrap:nowrap !important; -webkit-overflow-scrolling:touch; }",
"  body.mls-redesign .badge, body.mls-redesign [class*=badge]{ max-width:100% !important; white-space:normal !important; }",
"  body.mls-redesign #ez3Wrap > .ez3-prov{ grid-column:1 !important; grid-row:2 !important; justify-self:start; }",
"  body.mls-redesign #ez3Wrap > #ez3AllProv{ grid-row:3 !important; }",
"  body.mls-redesign #ez3Wrap > .ez3fl-record{ grid-column:1 !important; grid-row:4 !important; }",
"  body.mls-redesign #ez3Wrap > .ez3-row2{ grid-column:1 !important; grid-row:auto !important; flex-wrap:wrap; }",
"  body.mls-redesign #ez3Wrap > .ez3-advrow{ grid-column:1 !important; grid-row:auto !important; justify-self:start; }",
"  body.mls-redesign #ez3Wrap > #ez3HomeStatus{ grid-row:7 !important; }",
"}",
"",
"/* ---- collapsible rail: one click hides it; the burger brings it back as an overlay ---- */",
"#mlsRdNav{ transition:transform .22s ease; }",
"html.mls-rail-collapsed body.mls-rd-shell{ padding-left:0 !important; }",
"html.mls-rail-collapsed #mlsRdNav{ transform:translateX(-105%); }",
"html.mls-rail-collapsed.mls-rail-open #mlsRdNav{ transform:none; box-shadow:0 24px 70px -18px rgba(20,33,28,.35); }",
"html.mls-rail-collapsed #mlsRdRailBtn{ display:flex !important; }",
"html.mls-rail-collapsed.mls-rail-open #mlsRdScrim{ display:block; }",
"#mlsRdCollapse{ margin-left:auto; width:26px; height:26px; border-radius:8px; border:1px solid transparent; background:transparent; color:#68736B; cursor:pointer; display:flex; align-items:center; justify-content:center; font-size:13px; flex:none; }",
"#mlsRdCollapse:hover{ background:#F0EEE7; color:#1A211C; border-color:#E4E1D8; }",
"@media (max-width:760px){ #mlsRdCollapse{ display:none; } }",
"",
"/* ---- motion layer: calm micro-interactions everywhere ---- */",
"@media (prefers-reduced-motion: no-preference){",
"  body.mls-redesign .card{ transition:box-shadow .18s ease; }",
"  body.mls-redesign .card:hover{ box-shadow:0 2px 12px rgba(20,33,28,.07); }",
"  #mlsRdNav .navtab{ transition:background .15s ease, color .15s ease; }",
"  body.mls-redesign .modal-bg{ animation:mlsRdFade .18s ease; }",
"  body.mls-redesign .modal-bg > *{ animation:mlsRdRise .2s ease; }",
/* THE EXIT AND THE ENTRANCE ARE DIFFERENT MOVES, and this is where the
   cascade actually decides them. The page stylesheet declares the split on
   .toast (0,1,0); this rule is body.mls-redesign #toast (1,1,1) and wins on
   the live shell, so a split written only in the page was dead CSS —
   measured 0.2s/0.3s on both directions with the page rule in place.
   Arriving: a soft spring rise. Leaving: a quicker fade down, so a notice
   announces itself and then gets out of the way. */
"  body.mls-redesign #toast{ transition:opacity var(--mls-dur-1) linear, transform var(--mls-dur-2) var(--mls-ease-inout); }",
"  body.mls-redesign #toast.show{ transition:opacity var(--mls-dur-2) var(--mls-ease-out), transform var(--mls-dur-3) var(--mls-ease-spring); }",
"  body.mls-redesign button:not(.ez3fl-recbtn){ transition:background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, transform .07s ease; }",
"  #mlsFabMenu button{ animation:mlsRdRise .18s ease backwards; }",
"  #mlsTbMenuPanel.open{ animation:mlsRdRise .16s ease; }",
"  #mlsEz3 .ez3fl-daypop, .onf-fillbox select, .onf-fillbox input{ transition:border-color .15s ease, box-shadow .15s ease; }",
"}",
"@keyframes mlsRdFade{ from{ opacity:0; } }",
"@keyframes mlsRdRise{ from{ opacity:0; transform:translateY(6px); } }",
"",
"/* ---- patient banner, elevated (owner: likes the concept - push it further) ---- */",
"body.mls-redesign #mlsCtxBar{ background:#fff !important; border:1px solid #E7E5DD !important; border-radius:16px !important;",
"  box-shadow:0 1px 2px rgba(20,33,28,.05) !important; padding:12px 16px !important; gap:10px 12px !important; align-items:center !important; }",
"body.mls-redesign #mlsCtxBar .mlsctx-av{ width:40px !important; height:40px !important; border-radius:13px !important;",
"  background:#204034 !important; color:#8FD8BE !important; font-size:14.5px !important; font-weight:700 !important;",
"  display:inline-flex !important; align-items:center !important; justify-content:center !important;",
"  box-shadow:0 0 0 2px #fff, 0 0 0 3.5px #DCE5DF !important; }",
"body.mls-redesign #mlsCtxBar .mlsctx-name{ font-family:'Newsreader',Georgia,serif !important; font-weight:600 !important;",
"  font-size:19px !important; letter-spacing:-.012em !important; color:#1A211C !important; }",
"body.mls-redesign #mlsCtxBar .mlsctx-idtext > *:not(.mlsctx-name){ color:#68736B !important; font-size:12px !important; }",
"body.mls-redesign #mlsCtxBar .mls-sync, body.mls-redesign #mlsCtxBar .mrp-btn{",
"  background:#F8F7F3 !important; border:1px solid #E7E5DD !important; color:#55605A !important;",
"  border-radius:999px !important; font-size:11.5px !important; font-weight:600 !important; }",
"body.mls-redesign #mlsCtxBar .mls-sync-ok{ color:#2E6A4B !important; border-color:#DCE5DF !important; background:#F6FBF8 !important; }",
"body.mls-redesign #mlsCtxBar .mlsctx-switch{ background:#204034 !important; border:1px solid #204034 !important; color:#fff !important;",
"  border-radius:11px !important; font-weight:700 !important; padding:9px 16px !important; }",
"body.mls-redesign #mlsCtxBar .mlsctx-switch:hover{ background:#2E6A4B !important; }",
"",
"/* ---- phone-first layer (Editorial Calm mobile, rebuilt 2026-07-13 from a real",
"     iPhone screenshot: horizontal overflow, FAB pileup, double-height chrome) ---- */",
"@media (max-width:760px){",
"  /* 0) the page NEVER scrolls sideways */",
"  html, body.mls-redesign{ max-width:100vw !important; overflow-x:hidden !important; }",
"  body.mls-redesign{ scrollbar-gutter:auto !important; }",
"  body.mls-redesign #appWrap, body.mls-redesign #appScreen{ max-width:100vw !important; }",
"  body.mls-redesign #appWrap{ padding:10px 10px 110px !important; }",
"  body.mls-redesign .card{ border-radius:14px !important; }",
"",
"  /* 1) ONE compact header row: burger, title, search-as-icon, menu */",
"  #mlsRdTop{ height:52px; gap:6px; padding:0 8px; }",
"  #mlsRdTitle{ font-size:17px; flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }",
"  #mlsRdToggleSlot{ display:none !important; }",
"  #mlsRdSearchSlot{ flex:0 0 38px !important; min-width:38px !important; width:38px !important; }",
"  #mlsRdKbd{ display:none !important; }",
"  #mlsRdSearchSlot input{ width:38px !important; min-width:38px !important; padding:0 !important; padding-left:38px !important; background:transparent !important; border-color:transparent !important; }",
"  #mlsRdSearchSlot input:focus{ position:fixed !important; left:10px !important; top:7px !important; width:calc(100vw - 20px) !important; height:38px !important; z-index:400 !important; background:#fff !important; border-color:#B9C7BE !important; padding:0 12px !important; }",
"",
"  /* 2) patient banner: two calm rows, nothing cut off */",
"  body.mls-redesign #patientBar{ flex-wrap:wrap !important; padding:10px 12px !important; gap:8px !important; }",
"  body.mls-redesign #mlsCtxBar{ flex-wrap:wrap !important; overflow:visible !important; row-gap:6px !important; max-width:100% !important; padding:10px 10px !important; }",
"  body.mls-redesign #mlsCtxBar > *{ max-width:100% !important; }",
"",
"  /* 3) hero + workspace: full-width touch targets, stacked */",
"  body.mls-redesign #mlsEz3{ border-radius:14px !important; }",
"  #mlsEz3 .ez3fl-record{ flex-direction:column; align-items:stretch !important; }",
"  #mlsEz3 .ez3fl-recbtn, #mlsEz3 .ez3fl-openws{ width:100%; justify-content:center; }",
"  body.mls-redesign #ez3Wrap > .ez3-row2{ flex-direction:column !important; align-items:stretch !important; }",
"  body.mls-redesign #ez3Wrap > .ez3-row2 .ez3-sm{ width:100% !important; justify-content:center !important; }",
"  body.mls-redesign #ez3Wrap > .ez3-prov{ width:100% !important; }",
"  body.mls-redesign #ez3Wrap > .ez3-prov select{ flex:1 1 auto; min-width:0; max-width:100%; }",
"",
"  /* 4) No idle floating controls. Quick actions live in the compact top bar",
"     and field dictation stays beside the field that owns it. */",
"  #_patientFace, #mlsCopVoiceBtn, #mlsAsstFab, #mlsDaDock, #mlsTabPickerChip, #mlsAddPtLauncher,",
"  #mlsScDock, #mlsPayReportFab, .mls-askreview-chip{ display:none !important; }",
"  #mlsFab, #mlsFabMenu{ display:none !important; }",
"  /* while actually LISTENING the voice control must be visible + tappable */",
"  #mlsCopVoiceBtn.mls-bl42-on{ display:inline-flex !important; left:14px !important; right:auto !important; bottom:84px !important; z-index:99990 !important; }",
"",
"  /* 5) modals + misc */",
"  body.mls-redesign .modal{ max-width:calc(100vw - 20px) !important; margin:10px !important; max-height:92vh !important; overflow-y:auto !important; }",
"  body.mls-redesign #mlsDayHistBtn{ display:none !important; }",
"}",
"@media (max-width:420px){ #mlsRdTop{gap:4px;padding:0;} #mlsRdTitle.rd-homelink{padding:2px 0;margin-left:0;} #mlsRdMenuSlot{gap:4px !important;flex:0 0 auto;min-width:0;} #mlsTbMenuBtn{width:38px;height:38px;padding:0 !important;gap:0 !important;justify-content:center;font-size:0 !important;} #mlsTbMenuBtn>span{display:none;} #mlsTbMenuBtn::before{content:'⋯';font-size:22px;line-height:1;} }"
  ].join("\n");

  var RELEVANT='#appHeader,.mainnav,.mainnav .navtab,#mlsViewToggle,#mlsPqsInput,#mlsTbMenu,#mlsTbMenuBtn,#mlsTbMenuPanel,#mlsTbMenuPanel .mlsTbItem,#visitView,#analysisView,#emrCard,#mlsRdTop,#mlsRdNav';
  function relevantNode(node){
    if(!node||node.nodeType!==1) return false;
    try{ return (node.matches&&node.matches(RELEVANT))||!!(node.querySelector&&node.querySelector(RELEVANT)); }catch(e){ return false; }
  }
  /* The feature observer stays inside the app. A separate direct-child-only
     watcher follows the app node itself, so a session remount can replace
     #appScreen after the finite boot retries without stranding us on the
     detached tree or requiring a document-wide subtree observer/poll. */
  function observeLifecycle(){
    if(!_lifeObs) return;
    var app=$('appScreen'), root=(app&&app.parentNode)||document.body||document.documentElement;
    if(!root||root===_lifeRoot) return;
    try{ _lifeObs.disconnect(); _lifeObs.observe(root,{childList:true}); _lifeRoot=root; }catch(e){}
  }
  function observeRoot(){
    if(!_obs) return;
    var root=$('appScreen');
    try{ _obs.disconnect(); }catch(e){}
    _observedRoot=null;
    observeLifecycle();
    if(!root) return;
    try{ _obs.observe(root,{childList:true,subtree:true,characterData:true}); _observedRoot=root; }catch(e){}
  }
  function onLifecycleMutations(){
    var current=$('appScreen'), root=(current&&current.parentNode)||document.body||document.documentElement;
    var appChanged=current!==_observedRoot;
    if(!appChanged&&root===_lifeRoot) return;
    observeRoot();
    if(appChanged) schedule();
  }
  function syncClinicalSurfaceState(){
    try{
      if(!document.body) return;
      var patient=null;
      try{
        if(typeof window.activePatient==='function') patient=window.activePatient();
        else if(typeof window.activePt==='function') patient=window.activePt();
        else if(typeof activePt==='function') patient=activePt();
      }catch(e){}
      var hasPatient=!!(patient&&patient.id&&patient.name);
      var note=$('mls-note')||$('noteBox')||$('ez3flNote')||$('ez3Note');
      var noteText='';
      try{ noteText=String(note&&(note.value!=null?note.value:note.textContent)||'').trim(); }catch(e2){}
      /* This runs from a CAPTURE-phase 'input' listener on document, so it fires
         on every keystroke in the note editor - 3 classList calls per character.
         They were toggle(name, force), which is already conditional, so they did
         NOT rewrite the attribute and cost no style invalidation. (An earlier
         version of this comment claimed they did; that was wrong and unmeasured.)
         The guards below are kept because comparing is cheaper than calling on a
         per-keystroke path, not because they fix churn. */
      var wantHas=!!hasPatient, wantNone=!hasPatient, wantDraft=!!(hasPatient&&noteText);
      var bcl=document.body.classList;
      if(bcl.contains('mls-has-active-patient')!==wantHas) bcl.toggle('mls-has-active-patient',wantHas);
      if(bcl.contains('mls-no-active-patient')!==wantNone) bcl.toggle('mls-no-active-patient',wantNone);
      if(bcl.contains('mls-has-note-draft')!==wantDraft) bcl.toggle('mls-has-note-draft',wantDraft);
    }catch(e){}
  }
  function installClinicalSurfaceState(){
    if(_surfaceInputHandler) return;
    _surfaceInputHandler=function(ev){
      var id=ev&&ev.target&&ev.target.id||'';
      if(id==='mls-note'||id==='noteBox'||id==='ez3flNote'||id==='ez3Note') syncClinicalSurfaceState();
    };
    _surfacePatientHandler=function(){ syncClinicalSurfaceState(); };
    _surfaceStorageHandler=function(ev){
      var k=String(ev&&ev.key||'');
      if(!k||/activePt|patients|notes/i.test(k)) syncClinicalSurfaceState();
    };
    try{ document.addEventListener('input',_surfaceInputHandler,true); }catch(e){}
    try{ window.addEventListener('mls:active-patient-changed',_surfacePatientHandler); }catch(e2){}
    try{ window.addEventListener('mls:note-updated',_surfacePatientHandler); }catch(e3){}
    try{ window.addEventListener('storage',_surfaceStorageHandler); }catch(e4){}
  }
  function ensurePayReportMenuItem(){
    try{
      var panel=$('mlsTbMenuPanel');
      if(!panel||$('mlsPayReportMenuItem')) return;
      var btn=document.createElement('button');
      btn.id='mlsPayReportMenuItem'; btn.className='mlsTbItem'; btn.type='button';
      btn.setAttribute('data-mls-owner','editorial-calm');
      btn.textContent='💵 Pay Reports';
      btn.addEventListener('click',function(ev){
        try{ if(ev) ev.stopPropagation(); panel.classList.remove('open'); panel.style.display=''; }catch(e){}
        try{
          if(window.__mlsComp&&typeof window.__mlsComp.open==='function'){ window.__mlsComp.open(); return; }
          var legacy=$('mlsCompBtn'); if(legacy){ legacy.click(); return; }
          if(typeof window.toast==='function') window.toast('Pay Reports is still loading — try again in a moment.','err');
        }catch(e2){}
      });
      panel.appendChild(btn);
    }catch(e){}
  }
  function applyAll(){
    var built=false;
    try{ if(_obs) _obs.disconnect(); }catch(e){}
    try{ injectCSS(); mark(); built=buildShell(); styleVisit(); makeAnalysisDashboard(); reStyleToggleState(); syncTitle(); syncClinicalSurfaceState(); ensurePayReportMenuItem(); wrapShowViewForTitle(); }catch(e){}
    observeRoot();
    return built;
  }
  function onMutations(records){
    var needsApply=false;
    for(var i=0;i<records.length;i++){
      var record=records[i], target=record.target;
      if(record.type==='characterData'){
        var parent=target&&target.parentElement;
        if(parent) normalizePremiumBadgeNode(parent);
        continue;
      }
      if(relevantNode(target)) needsApply=true;
      var added=record.addedNodes||[], removed=record.removedNodes||[], textOnly=false;
      for(var j=0;j<added.length;j++){
        if(added[j]&&added[j].nodeType===1) normalizePremiumBadges(added[j]);
        else if(added[j]&&added[j].nodeType===3) textOnly=true;
        if(relevantNode(added[j])) needsApply=true;
      }
      /* textContent assignments are reported as childList records whose new
         node is text, so inspect the owning element as well as added elements. */
      if(textOnly&&target&&target.nodeType===1) normalizePremiumBadgeNode(target);
      for(var k=0;k<removed.length;k++) if(relevantNode(removed[k])) needsApply=true;
    }
    if(needsApply) schedule();
  }
  function schedule(){ if(_schedT) return; _schedT=setTimeout(function(){ _schedT=null; applyAll(); },120); }
  /* the nav .on class flips without childList mutations, so the observer never
     sees a view switch — wrap showView additively (guarded) for an instant,
     always-correct title. */
  function wrapShowViewForTitle(){
    try{
      if(typeof window.showView!=='function'||window.showView.__rdTitleWrapped) return;
      var orig=window.showView;
      var w=function(){ var r; try{ r=orig.apply(this,arguments); }catch(e){}
        try{ setTimeout(function(){ syncTitle(); syncPrimaryNavState(); syncClinicalSurfaceState(); syncBackButton(); },0); }catch(e){} return r; };
      w.__rdTitleWrapped=true; w.__rdTitleOrig=orig; w.__rdTitleVersion=VERSION;
      window.showView=w;
    }catch(e){}
  }
  function boot(){
    injectFonts();
    try{ if(localStorage.getItem('mls_rail_collapsed')==='1') document.documentElement.classList.add('mls-rail-collapsed'); }catch(e){}
    try{ if(!_obs)_obs=new MutationObserver(onMutations); if(!_lifeObs)_lifeObs=new MutationObserver(onLifecycleMutations); }catch(e){}
    installClinicalSurfaceState();
    normalizePremiumBadges(document);
    applyAll();
    wrapShowViewForTitle();
    [250,700,1600,3200].forEach(function(delay){ _t.push(setTimeout(function(){ applyAll(); wrapShowViewForTitle(); },delay)); });
    window.addEventListener('mls:ui-ready',schedule);
    window.addEventListener('mls:view-mode-changed',schedule);
  }
  function restoreShowViewOwners(){
    try{
      var current=window.showView,guard=0;
      while(typeof current==='function'&&guard++<12){
        if(current.__rdTitleWrapped&&current.__rdTitleVersion===VERSION&&current.__rdTitleOrig){current=current.__rdTitleOrig;continue;}
        if(current.__rdHist&&current.__rdHistVersion===VERSION&&current.__rdHistOrig){current=current.__rdHistOrig;continue;}
        break;
      }
      window.showView=current;
      if(_opaqueLegacyHistory&&current===_opaqueLegacyHistory){
        /* Keep the unrecoverable old forwarder inert after rollback. */
        window.__mlsViewHist={stack:[],lock:true,cur:'__pinned',owner:'retired-legacy'};
      }else if(_historyBeforeInstallCaptured){
        if(_historyBeforeInstallHadOwn)window.__mlsViewHist=_historyBeforeInstall;
        else try{delete window.__mlsViewHist;}catch(e0){window.__mlsViewHist=void 0;}
      }
      _historyWrapper=null;_historyOriginal=null;
    }catch(e){}
  }
  function revert(){ try{if(_obs)_obs.disconnect();if(_lifeObs)_lifeObs.disconnect();_observedRoot=null;_lifeRoot=null;}catch(e){} try{_t.forEach(function(timer){clearTimeout(timer);});_t=[];}catch(e){} try{if(_schedT)clearTimeout(_schedT);}catch(e){}
    try{window.removeEventListener('mls:ui-ready',schedule);window.removeEventListener('mls:view-mode-changed',schedule);}catch(e){}
    try{if(_surfaceInputHandler)document.removeEventListener('input',_surfaceInputHandler,true);}catch(e){}
    try{if(_surfacePatientHandler){window.removeEventListener('mls:active-patient-changed',_surfacePatientHandler);window.removeEventListener('mls:note-updated',_surfacePatientHandler);}}catch(e){}
    try{if(_surfaceStorageHandler)window.removeEventListener('storage',_surfaceStorageHandler);}catch(e){}
    _surfaceInputHandler=null;_surfacePatientHandler=null;_surfaceStorageHandler=null;
    try{if(_railKeyHandler)document.removeEventListener('keydown',_railKeyHandler,true);}catch(e){} try{if(_railResizeHandler)window.removeEventListener('resize',_railResizeHandler);}catch(e){}
    _railKeyHandler=null;_railResizeHandler=null;
    restoreShowViewOwners();
    removeNode('mlsRdNewMenu');removeNode('mlsRdNewBtn');removeNode('mlsRdUserChip');
    try{var pay=$('mlsPayReportMenuItem');if(pay&&pay.getAttribute('data-mls-owner')==='editorial-calm')pay.remove();}catch(e){}
    try{document.querySelectorAll('.mainnav .navtab').forEach(function(tab){
      if(tab._mlsRdKeyHandler){ tab.removeEventListener('keydown',tab._mlsRdKeyHandler); try{delete tab._mlsRdKeyHandler;}catch(_){} }
      if(tab.hasAttribute('data-mlsrd-original-text')){ var n=navDirectText(tab), old=tab.getAttribute('data-mlsrd-original-text'); if(n)n.data=old; tab.removeAttribute('data-mlsrd-original-text'); }
      if(tab.getAttribute('data-mlsrd-text-created')==='1'){ var made=navDirectText(tab); if(made)made.remove(); tab.removeAttribute('data-mlsrd-text-created'); }
      if(tab.hasAttribute('data-mlsrd-original-aria-label')){ var oldLabel=tab.getAttribute('data-mlsrd-original-aria-label'); if(oldLabel==='__none__')tab.removeAttribute('aria-label');else tab.setAttribute('aria-label',oldLabel); tab.removeAttribute('data-mlsrd-original-aria-label'); }
      restoreSecondaryRoute(tab);
      if(tab.getAttribute('data-mlsrd-added-role')==='1'){ tab.removeAttribute('role'); tab.removeAttribute('data-mlsrd-added-role'); }
      if(tab.getAttribute('data-mlsrd-added-tabindex')==='1'){ tab.removeAttribute('tabindex'); tab.removeAttribute('data-mlsrd-added-tabindex'); }
      tab.removeAttribute('data-mlsrd-primary'); tab.removeAttribute('aria-current');
    });}catch(e){}
    try{var s=$(STYLE_ID);if(s)s.remove();}catch(e){} try{var f=$(FONT_ID);if(f)f.remove();}catch(e){}
    try{document.documentElement.classList.remove(CLS);document.documentElement.classList.remove('mls-rail-open');if(document.body){document.body.classList.remove(CLS);document.body.classList.remove('mls-rd-shell');document.body.classList.remove('mls-has-active-patient','mls-no-active-patient','mls-has-note-draft');}}catch(e){}
    try{var hdr=$('appHeader'); if(hdr){ hdr.classList.remove('mlsRdHdr'); hdr.style.cssText='';
      [].slice.call(hdr.querySelectorAll('[data-mlsrd-hid]')).forEach(function(c){c.style.display='';c.removeAttribute('data-mlsrd-hid');}); } }catch(e){}
    try{var sc=$('mlsRdScrim'); if(sc)sc.remove();}catch(e){}
    try{window.__mlsRedesign.installed=false;}catch(e){} }

  window.__mlsRedesign={installed:true,version:VERSION,asset:ASSET,reapply:boot,revert:revert,build:buildShell};
  try{ if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot(); }catch(e){ try{boot();}catch(e2){} }
})();
