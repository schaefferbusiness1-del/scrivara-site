/* feat_mls_redesign.js  ->  window.__mlsRedesign  (v1.0.0)
 * =====================================================================
 *  MLSscribe 2026 visual reskin -- ONE additive, reversible theme layer.
 * =====================================================================
 * Applies the new design language (Plus Jakarta Sans + Newsreader fonts,
 * navy/blue/teal/green palette, rounded cards, gradient buttons, dark
 * top bar, teal-accent nav, restyled modals/inputs/badges/FAB/auth) by:
 *   1) injecting the Google Fonts link, and
 *   2) injecting ONE <style> that (a) overrides the host's existing CSS
 *      custom properties to the new design tokens and (b) adds the
 *      design's distinctive component polish on the host's OWN selectors.
 *
 * APPEARANCE ONLY. Touches no wiring, reimplements no handler, clicks
 * nothing, sends nothing, reads no PHI. Composes with -- never edits --
 * ScribeFlow.html and every feat_ and mls- modules (incl. topbar-unify,
 * mls-easy, view-toggle, fab-layout).
 *
 * Idempotent (window.__mlsRedesign guard). Fully reversible:
 *   window.__mlsRedesign.revert()  removes the font link, the <style>,
 *   the body/html class and the observer -> app returns to its prior look.
 *
 * Loaded by a single guarded, cache-busted, ';'-prefixed loader line
 * appended at the TRUE EOF of mls-connect.js (and its .staging.js twin),
 * AFTER every other loader so this theme is the last style in the head.
 * ASCII-only. NUL-free.
 */
;(function () {
  "use strict";
  try { if (window.__mlsRedesign && window.__mlsRedesign.installed) return; } catch (e) { return; }

  var VERSION = "1.0.0", ASSET = "feat_mls_redesign.js";
  var FONT_ID = "mlsRdFont", STYLE_ID = "mlsRdStyle", CLS = "mls-redesign";
  var FONT_HREF = "https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400&display=swap";
  var _obs = null;

  var CSS = [
"/* ===== MLSscribe 2026 reskin (feat_mls_redesign.js) ===== */",

"/* --- design tokens: override host CSS variables (light = default) --- */",
":root{",
"  --bg:#eef2f7; --card:#ffffff; --ink:#0f2540; --muted:#6b7d93;",
"  --line:#e4ebf3; --brand:#2f6bed; --brand-dk:#2257cf;",
"  --green:#1f9d6b; --green-dk:#178a5c; --amber:#c2680f;",
"  --red:#d24447; --soft:#eef3fb; --soft2:#f8fafc;",
"  --gold:#a67c12; --gold-bg:#fff7ef;",
"  --header:#0d2138; --header-line:rgba(255,255,255,.10);",
"  --surface:#ffffff; --field-bg:#f8fafc;",
"  --shadow:0 1px 2px rgba(15,37,64,.04),0 10px 28px rgba(15,37,64,.05);",
"  --r-ctl:11px;",
"}",
"/* dark mode: cohesive dark variant of the same system (no dark mockup; retoned) */",
"body.theme-dark{",
"  --bg:#0c1828; --card:#122036; --ink:#e7eef8; --muted:#9fb3cc;",
"  --line:#22344c; --brand:#4f93f2; --brand-dk:#6aa6f6;",
"  --green:#2fb986; --green-dk:#43d39c; --amber:#f0ad3c;",
"  --red:#e0606b; --soft:#16263c; --soft2:#13223a;",
"  --gold:#d9a93b; --gold-bg:#2a2415;",
"  --header:#0a1422; --header-line:rgba(255,255,255,.08);",
"  --surface:#122036; --field-bg:#0e1b2d;",
"}",

"/* --- base / fonts --- */",
"html.mls-redesign,body.mls-redesign{ background:var(--bg); color:var(--ink); }",
"body.mls-redesign{ background-image:radial-gradient(circle at 12% -10%,#e4ecf6 0,rgba(238,242,247,0) 45%); }",
"body.theme-dark.mls-redesign{ background-image:radial-gradient(circle at 12% -10%,#16263c 0,rgba(12,24,40,0) 45%); }",
"body.mls-redesign, body.mls-redesign button, body.mls-redesign input, body.mls-redesign select,",
"body.mls-redesign textarea, body.mls-redesign .sf-select, body.mls-redesign .navtab, body.mls-redesign .btn-white{",
"  font-family:'Plus Jakarta Sans',system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif !important;",
"}",
"body.mls-redesign ::placeholder{ color:#9aa8bb; }",
"body.mls-redesign ::-webkit-scrollbar{ width:10px;height:10px; }",
"body.mls-redesign ::-webkit-scrollbar-thumb{ background:#cdd8e6;border-radius:8px;border:2px solid transparent;background-clip:padding-box; }",
"body.theme-dark.mls-redesign ::-webkit-scrollbar-thumb{ background:#2b3e58; }",
"/* serif accent on hero/sign-in titles only */",
"body.mls-redesign .auth-card h1, body.mls-redesign .auth-title, body.mls-redesign [data-mls-hero-title]{",
"  font-family:'Newsreader',Georgia,serif !important; font-weight:500 !important; letter-spacing:-.015em; }",

"/* --- top bar --- */",
"body.mls-redesign #appHeader{ background:linear-gradient(180deg,#0d2138 0%,#102a48 100%) !important;",
"  border-bottom:1px solid rgba(255,255,255,.07) !important; box-shadow:0 1px 0 rgba(255,255,255,.04) !important; }",
"body.mls-redesign #appHeader .logo, body.mls-redesign #appHeader .logo *{ color:#fff !important; }",
"body.mls-redesign #appHeader .logo small{ color:#8aa4c4 !important; opacity:1 !important; font-weight:500; }",
"body.mls-redesign #appHeader .who, body.mls-redesign #whoLabel{ color:#9fb4ce !important; }",
"/* header action buttons -> translucent on navy */",
"body.mls-redesign #appHeader .btn-white, body.mls-redesign #appHeader #mlsTbMenuBtn,",
"body.mls-redesign #appHeader button.btn-white{ background:rgba(255,255,255,.06) !important; color:#dce7f5 !important;",
"  border:1px solid rgba(255,255,255,.14) !important; border-radius:10px !important; font-weight:600 !important; }",
"body.mls-redesign #appHeader .btn-white:hover, body.mls-redesign #appHeader #mlsTbMenuBtn:hover{ background:rgba(255,255,255,.12) !important; }",
"/* header search box */",
"body.mls-redesign #mlsPqsInput, body.mls-redesign #appHeader input[type=text],",
"body.mls-redesign #appHeader input[type=search]{ background:rgba(255,255,255,.06) !important; color:#fff !important;",
"  border:1px solid rgba(255,255,255,.12) !important; border-radius:11px !important; }",
"body.mls-redesign #mlsPqsInput::placeholder{ color:#8aa4c4 !important; }",

"/* --- main nav tabs: restyle the existing nav into the new tab bar (no duplicate) --- */",
"body.mls-redesign .mainnav{ background:linear-gradient(180deg,#0d2138,#102a48) !important;",
"  border:1px solid rgba(255,255,255,.08) !important; box-shadow:0 12px 30px -18px rgba(13,33,56,.55) !important;",
"  border-radius:14px !important; padding:6px !important; gap:4px !important; }",
"body.mls-redesign .navtab{ color:#adc2dd !important; background:transparent !important; border-radius:9px !important;",
"  font-weight:600 !important; }",
"body.mls-redesign .navtab:hover{ background:rgba(255,255,255,.07) !important; color:#fff !important; }",
"body.mls-redesign .navtab.on{ background:rgba(95,227,207,.16) !important; color:#7ff0de !important;",
"  font-weight:700 !important; box-shadow:none !important; }",
"body.mls-redesign .navtab .nbadge{ background:rgba(255,255,255,.12) !important; color:#9fc0ff !important; }",
"body.mls-redesign .navtab.on .nbadge{ background:#5fe3cf !important; color:#0d2138 !important; }",

"/* --- cards / panels --- */",
"body.mls-redesign .card{ background:var(--card) !important; border:1px solid var(--line) !important;",
"  border-radius:18px !important; box-shadow:0 1px 2px rgba(15,37,64,.04),0 10px 30px rgba(15,37,64,.05) !important; }",
"body.theme-dark.mls-redesign .card{ box-shadow:0 1px 2px rgba(0,0,0,.3),0 10px 30px rgba(0,0,0,.4) !important; }",
"body.mls-redesign .card>h2 .ic{ background:var(--soft) !important; border-radius:9px !important; }",

"/* --- buttons (gradient design language) --- */",
"body.mls-redesign .btn-primary{ background:linear-gradient(135deg,#2f6bed,#2257cf) !important; color:#fff !important;",
"  border:none !important; border-radius:11px !important; font-weight:700 !important;",
"  box-shadow:0 10px 22px -10px rgba(47,107,237,.6) !important; }",
"body.mls-redesign .btn-primary:hover{ filter:brightness(1.05); }",
"body.mls-redesign .btn-green{ background:linear-gradient(135deg,#1f9d6b,#178a5c) !important; color:#fff !important;",
"  border:none !important; border-radius:11px !important; font-weight:700 !important;",
"  box-shadow:0 10px 22px -10px rgba(31,157,107,.6) !important; }",
"body.mls-redesign .btn-green:hover{ filter:brightness(1.05); }",
"body.mls-redesign .btn-red{ background:linear-gradient(135deg,#e0606b,#d24447) !important; color:#fff !important;",
"  border:none !important; border-radius:11px !important; font-weight:700 !important; }",
"body.mls-redesign .btn-gold{ background:linear-gradient(135deg,#e7c48f,#d8b574) !important; color:#6b4e16 !important;",
"  border:1px solid #e6c98a !important; border-radius:11px !important; font-weight:700 !important; }",
"body.mls-redesign .btn-ghost, body.mls-redesign .btn-white{ border-radius:11px !important; }",
"body.mls-redesign .btn-ghost{ background:var(--card) !important; color:var(--brand) !important;",
"  border:1px solid var(--line) !important; font-weight:600 !important; }",
"body.mls-redesign .btn-ghost:hover{ background:var(--soft) !important; border-color:var(--brand) !important; }",

"/* --- inputs / selects / textareas --- */",
"body.mls-redesign input[type=text], body.mls-redesign input[type=password], body.mls-redesign input[type=email],",
"body.mls-redesign input[type=date], body.mls-redesign input[type=time], body.mls-redesign input[type=number],",
"body.mls-redesign input[type=search], body.mls-redesign input[type=tel], body.mls-redesign textarea,",
"body.mls-redesign select, body.mls-redesign .sf-select{ border-radius:11px !important; }",
"body.mls-redesign .sf-select:focus, body.mls-redesign input:focus, body.mls-redesign textarea:focus,",
"body.mls-redesign select:focus{ border-color:var(--brand) !important; box-shadow:0 0 0 3px rgba(47,107,237,.16) !important; outline:none !important; }",

"/* --- badges / chips / pills --- */",
"body.mls-redesign .badge{ border-radius:20px !important; }",
"body.mls-redesign .badge.draft{ background:#fff7ef !important; color:#c2680f !important; border:1px solid #ffe0c2 !important; }",
"body.mls-redesign .badge.signed{ background:#e8f7f0 !important; color:#178a5c !important; border:1px solid #c5ecd9 !important; }",
"body.theme-dark.mls-redesign .badge.draft{ background:rgba(194,104,15,.16) !important; color:#f0ad3c !important; border-color:rgba(240,173,60,.4) !important; }",
"body.theme-dark.mls-redesign .badge.signed{ background:rgba(31,157,107,.16) !important; color:#43d39c !important; border-color:rgba(47,185,134,.4) !important; }",

"/* --- active patient bar --- */",
"body.mls-redesign #patientBar{ background:var(--card) !important; border:1px solid var(--line) !important;",
"  border-radius:16px !important; box-shadow:0 1px 2px rgba(15,37,64,.04) !important; }",
"body.mls-redesign #patientBar .pname{ color:var(--brand) !important; }",

"/* --- modals (Settings, Templates, dialogs) --- */",
"body.mls-redesign .modal{ background:var(--surface) !important; border:1px solid var(--line) !important;",
"  border-radius:20px !important; box-shadow:0 40px 90px -30px rgba(0,0,0,.5) !important; }",
"body.mls-redesign #settingsModal .set-tab.on, body.mls-redesign .set-tab.on{",
"  background:linear-gradient(135deg,#2f6bed,#2257cf) !important; color:#fff !important;",
"  box-shadow:0 8px 18px -8px rgba(47,107,237,.6) !important; border-radius:11px !important; }",

"/* --- auth / sign-in --- */",
"body.mls-redesign .auth-wrap{ background:linear-gradient(135deg,#0d2138 0%,#143560 100%) !important; }",
"body.mls-redesign .auth-card{ background:#fff !important; border-radius:20px !important;",
"  box-shadow:0 40px 90px -30px rgba(0,0,0,.6) !important; border:1px solid rgba(255,255,255,.08) !important; }",
"body.mls-redesign .auth-card *{ color:inherit; }",

"/* --- fixed launchers: keep everywhere, restyle to design FAB / + button --- */",
"body.mls-redesign #mls-assist-badge{ background:linear-gradient(135deg,#2f6bed,#19b8a6) !important; color:#fff !important;",
"  border:none !important; border-radius:30px !important; font-weight:700 !important;",
"  box-shadow:0 14px 30px -10px rgba(47,107,237,.6) !important; }",
"body.mls-redesign #mlsAddPtLauncher{ background:linear-gradient(135deg,#0d2138,#15406f) !important; color:#fff !important;",
"  border:1px solid rgba(255,255,255,.12) !important; border-radius:30px !important; font-weight:700 !important;",
"  box-shadow:0 14px 30px -12px rgba(13,33,56,.6) !important; }",
"body.mls-redesign #mlsAddPtLauncher *{ color:#fff !important; }",

"/* --- toasts / tips / copilot dock accents --- */",
"body.mls-redesign #mlsTip, body.mls-redesign .mls-toast, body.mls-redesign .toast{",
"  background:#0f2540 !important; color:#fff !important; border:1px solid rgba(255,255,255,.1) !important;",
"  border-radius:14px !important; box-shadow:0 18px 40px -12px rgba(13,33,56,.55) !important; }",

"/* --- empty states / dashed placeholders --- */",
"body.mls-redesign .empty{ border:1.5px dashed #d8e1ec !important; background:#f9fbfd !important; border-radius:14px !important; }",
"body.theme-dark.mls-redesign .empty{ border-color:#22344c !important; background:#0e1b2d !important; }"
  ].join("\n");

  function injectFonts() {
    try {
      if (document.getElementById(FONT_ID)) return;
      var h = document.head || document.documentElement;
      var p1 = document.createElement("link"); p1.rel = "preconnect"; p1.href = "https://fonts.googleapis.com";
      var p2 = document.createElement("link"); p2.rel = "preconnect"; p2.href = "https://fonts.gstatic.com"; p2.crossOrigin = "anonymous";
      var l = document.createElement("link"); l.id = FONT_ID; l.rel = "stylesheet"; l.href = FONT_HREF;
      h.appendChild(p1); h.appendChild(p2); h.appendChild(l);
    } catch (e) {}
  }
  function injectCSS() {
    try {
      var s = document.getElementById(STYLE_ID);
      if (!s) { s = document.createElement("style"); s.id = STYLE_ID; (document.head || document.documentElement).appendChild(s); }
      if (s.textContent !== CSS) s.textContent = CSS;
    } catch (e) {}
  }
  function mark() {
    try { document.documentElement.classList.add(CLS); if (document.body) document.body.classList.add(CLS); } catch (e) {}
  }
  function boot() {
    injectFonts(); injectCSS(); mark();
    try {
      _obs = new MutationObserver(function () {
        if (!document.getElementById(STYLE_ID)) injectCSS();
        if (!document.getElementById(FONT_ID)) injectFonts();
        mark();
      });
      _obs.observe(document.head || document.documentElement, { childList: true });
    } catch (e) {}
  }
  function revert() {
    try { if (_obs) _obs.disconnect(); } catch (e) {}
    try { var s = document.getElementById(STYLE_ID); if (s) s.remove(); } catch (e) {}
    try { var f = document.getElementById(FONT_ID); if (f) f.remove(); } catch (e) {}
    try { document.documentElement.classList.remove(CLS); if (document.body) document.body.classList.remove(CLS); } catch (e) {}
    try { window.__mlsRedesign.installed = false; } catch (e) {}
  }

  window.__mlsRedesign = { installed: true, version: VERSION, asset: ASSET, reapply: boot, revert: revert };

  try {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
  } catch (e) { try { boot(); } catch (e2) {} }
})();
