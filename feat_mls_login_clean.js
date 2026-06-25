/* ============================================================================
 * feat_mls_login_clean.js  ->  window.__mlsLoginClean   (lc-1.0.0)
 * ---------------------------------------------------------------------------
 * ITEM 7 (part B): the LOGIN PAGE must show ONLY the login UI (the #authScreen
 * card: logo + sign-in fields/buttons). The redesign + feature modules inject
 * body-level FABs/shell (Add patient, MLS Assist, Voice, assistant panel,
 * patient bars, etc.) that LEAK on top of the login screen because they are
 * appended to <body> (outside the display:none #appScreen) and most are not
 * gated on auth state.
 *
 * FIX (pure CSS, additive, reversible): when the auth screen is actually visible
 * (logged out / reset / 2FA), set html.mls-login-only. Under that class, hide
 * EVERY direct child of <body> except #authScreen (so #appScreen and every
 * injected FAB/panel/shell disappears), and force #authScreen visible. When the
 * user is logged in (#authScreen hidden), the class is removed and the app shows
 * normally. No auth logic touched, no credential read/filled. Runs on prod AND
 * staging (this must be live everywhere). Idempotent, ASCII-only.
 * Applies to the main doctor login and every variant that uses #authScreen
 * (Regular / Lite / Receptionist). Reversible: window.__mlsLoginClean.revert().
 * ==========================================================================*/
(function () {
  'use strict';
  try { if (window.__mlsLoginClean && window.__mlsLoginClean.installed) return; } catch (e) { return; }

  var VERSION = 'lc-1.0.1';
  var STYLE_ID = 'mlsLoginCleanStyle';
  var CLS = 'mls-login-only';
  var tickT = 0, obs = null;

  function safe(fn, d) { try { return fn(); } catch (e) { return d; } }
  function gid(id) { return safe(function () { return document.getElementById(id); }, null); }

  // Is the auth/login screen actually on-screen right now?
  // IMPORTANT: detect via the app's OWN inline display toggles (which this module's
  // !important CSS does NOT alter), never via computed display -- otherwise our own
  // "html.mls-login-only #authScreen{display:flex!important}" rule would make the auth
  // screen read as visible forever and stick the gate ON even after a real login.
  function isOnLogin() {
    var a = gid('authScreen') || safe(function () { return document.querySelector('.auth-wrap'); }, null);
    if (!a) return false;
    var app = gid('appScreen');
    // The app reveals #appScreen (inline display set to a truthy value) once authenticated.
    var appShown = !!(app && app.style && app.style.display && app.style.display !== 'none');
    if (appShown) return false;                 // logged in -> not on login
    // Logged out / pre-auth: the app sets #authScreen inline display to 'none' when it
    // hides the login. Anything other than an explicit inline 'none' means it is showing.
    return (a.style && a.style.display) !== 'none';
  }

  function injectCSS() {
    if (gid(STYLE_ID)) return;
    var css = [
      // Hide every top-level body element except the auth screen (and inert tags).
      'html.' + CLS + ' body > *:not(#authScreen):not(script):not(style):not(noscript):not(.mls-login-keep){display:none!important}',
      // Belt-and-suspenders: explicitly kill known injected chrome even if nested.
      'html.' + CLS + ' #appScreen,html.' + CLS + ' #mlsRdTop,html.' + CLS + ' #mlsRdNav,'
        + 'html.' + CLS + ' #mlsVoiceFab,html.' + CLS + ' #mlsAddPtLauncher,html.' + CLS + ' #mls-assist-badge,'
        + 'html.' + CLS + ' #mlsAsstFab,html.' + CLS + ' #mlsAsstPanel,html.' + CLS + ' #mlsCtxBar,'
        + 'html.' + CLS + ' #mlsChartFillBtn,html.' + CLS + ' #simBanner,html.' + CLS + ' #mlsAddPtModal,'
        + 'html.' + CLS + ' [class^="mlsaa-"],html.' + CLS + ' [class*=" mlsaa-"],html.' + CLS + ' .mlssh-toast{display:none!important}',
      // Keep the auth screen visible and centered.
      'html.' + CLS + ' #authScreen{display:flex!important}'
    ].join('\n');
    var st = document.createElement('style');
    st.id = STYLE_ID; st.type = 'text/css'; st.appendChild(document.createTextNode(css));
    (document.head || document.documentElement).appendChild(st);
  }

  function apply() {
    injectCSS();
    var on = isOnLogin();
    var html = document.documentElement;
    if (on) { if (!html.classList.contains(CLS)) html.classList.add(CLS); }
    else { if (html.classList.contains(CLS)) html.classList.remove(CLS); }
  }

  function boot() {
    injectCSS();
    apply();
    tickT = setInterval(apply, 800);
    // react instantly to auth-state DOM changes / late FAB injection
    obs = new MutationObserver(function () { apply(); });
    safe(function () { obs.observe(document.body, { childList: true, subtree: false, attributes: true, attributeFilter: ['style', 'class'] }); });
    // also observe the auth screen's own style toggling
    safe(function () { var a = gid('authScreen'); if (a) obs.observe(a, { attributes: true, attributeFilter: ['style', 'class'] }); });
  }

  function revert() {
    safe(function () { clearInterval(tickT); });
    safe(function () { if (obs) obs.disconnect(); });
    safe(function () { document.documentElement.classList.remove(CLS); });
    safe(function () { var s = gid(STYLE_ID); if (s && s.parentNode) s.parentNode.removeChild(s); });
    safe(function () { window.__mlsLoginClean.installed = false; });
  }

  window.__mlsLoginClean = {
    installed: true,
    version: VERSION,
    isOnLogin: isOnLogin,
    apply: apply,
    revert: revert
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
