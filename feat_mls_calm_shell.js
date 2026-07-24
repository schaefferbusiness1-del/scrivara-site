/* MLS Calm Shell — calm-1.0.0
 *
 * UI_CHARTER_CALM_SHELL_2026-07-24.md, all five layers in one module:
 *   dock (option 9) · right-now bar (8) · stages (3) · heads-down (7) · Ask (2)
 *
 * ARCHITECTURE — read this before changing anything.
 *
 * This shell owns PRESENTATION ONLY. It never becomes a second writer:
 *   - Dock items click the real rail tab (#nav_visit etc). The rail stays the
 *     single owner of navigation; it is hidden with CSS, never removed.
 *   - Right-now actions click the real button that already exists in the view.
 *     If the real control is absent, the action is absent. Nothing is
 *     reimplemented, so nothing can drift out of sync with the app.
 *   - Ask resolves a typed phrase to a real control and clicks it.
 *   - showView() is NOT wrapped. View state is read by observing which .navtab
 *     carries .on — the rail keeps updating even while hidden. One observer.
 *
 * That is why this file can add a whole new shell without touching clinical
 * logic: every action still runs through the control the app already trusts.
 *
 * Escape hatch: ?ui=classic, or Tools -> "Classic layout". One click, no reload.
 */
(function () {
  'use strict';

  if (window.__mlsCalmShell) return;

  var VERSION = 'calm-1.0.0';

  /* Dock destinations. The coverage suite asserts this list matches
     tests/fixtures/ui-reach-map.json so the shipped dock and the reach
     contract cannot drift apart. */
  var CONTRACT = { MLS_DOCK_DEST: ['day', 'patient', 'review', 'tools', 'visit'] };

  var W = window;
  var D = document;
  var STORE_KEY = 'mlsCalmShell';
  var HEADSDOWN_KEY = 'mlsCalmHeadsDown';

  function safe(fn) { try { return fn(); } catch (e) { return undefined; } }
  function qs(sel, root) { return safe(function () { return (root || D).querySelector(sel); }); }
  function qsa(sel, root) {
    return safe(function () { return Array.prototype.slice.call((root || D).querySelectorAll(sel)); }) || [];
  }
  function visible(el) {
    if (!el) return false;
    if (el.hidden || el.disabled) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }
  function textOf(el) {
    var t = (el && (el.textContent || el.getAttribute('title') || el.getAttribute('aria-label'))) || '';
    return t.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, ' ')
      .replace(/[←-⯿☀-➿️‍＋]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* ---------------------------------------------------------------- enable */

  function enabled() {
    var q = String(location.search || '');
    if (/[?&]ui=classic/i.test(q)) { safe(function () { localStorage.setItem(STORE_KEY, '0'); }); return false; }
    if (/[?&]ui=calm/i.test(q)) { safe(function () { localStorage.setItem(STORE_KEY, '1'); }); return true; }
    var stored = safe(function () { return localStorage.getItem(STORE_KEY); });
    if (stored === '0') return false;
    return true;
  }

  /* ------------------------------------------------------------------- css */

  /* Apple's standard easing curve. Everything moves on transform/opacity only —
     no layout-animating properties, so a mid-clinic machine never janks. */
  var CSS = [
    ':root{--mls-spring:cubic-bezier(.32,.72,0,1);--mls-fast:180ms;--mls-base:260ms;--mls-slow:380ms}',
    'body.mls-calm .mainnav{display:none!important}',
    'body.mls-calm #appHeader .tools .btn-white{display:none!important}',
    'body.mls-calm #appHeader .tools .btn-white.mls-calm-keep{display:inline-flex!important}',
    'body.mls-calm{padding-bottom:96px}',

    /* dock */
    '#mlsDock{position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(0);z-index:920;',
    'display:flex;align-items:center;gap:4px;padding:6px;border-radius:22px;',
    'background:rgba(255,255,255,.72);-webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);',
    'border:1px solid rgba(0,0,0,.06);box-shadow:0 12px 34px rgba(20,35,28,.16),0 2px 6px rgba(20,35,28,.08);',
    'opacity:0;animation:mlsDockIn var(--mls-slow) var(--mls-spring) forwards}',
    '@keyframes mlsDockIn{from{opacity:0;transform:translateX(-50%) translateY(18px) scale(.96)}to{opacity:1;transform:translateX(-50%) translateY(0) scale(1)}}',
    '#mlsDock .mls-dock-pill{position:absolute;top:6px;left:6px;height:calc(100% - 12px);border-radius:16px;background:#EAF1EE;',
    'transition:transform var(--mls-base) var(--mls-spring),width var(--mls-base) var(--mls-spring);pointer-events:none;z-index:0}',
    '#mlsDock button{position:relative;z-index:1;display:flex;flex-direction:column;align-items:center;gap:2px;',
    'min-width:64px;padding:8px 12px 7px;border:0;background:transparent;border-radius:16px;cursor:pointer;',
    'font:500 11.5px/1.1 inherit;color:#5B6B62;transition:color var(--mls-fast) var(--mls-spring),transform var(--mls-fast) var(--mls-spring)}',
    '#mlsDock button:hover{color:#204034}',
    '#mlsDock button:active{transform:scale(.93)}',
    '#mlsDock button.on{color:#204034}',
    '#mlsDock button svg{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}',
    '#mlsDock .mls-dock-count{position:absolute;top:3px;right:9px;min-width:15px;height:15px;padding:0 4px;border-radius:8px;',
    'background:#2E6A4B;color:#fff;font:500 10px/15px inherit;text-align:center;transform:scale(0);',
    'transition:transform var(--mls-base) var(--mls-spring)}',
    '#mlsDock .mls-dock-count.show{transform:scale(1)}',
    '#mlsDockAskWrap{position:relative;z-index:1;display:flex;align-items:center;margin-left:4px;padding-left:8px;border-left:1px solid rgba(0,0,0,.07)}',
    '#mlsDockAsk{width:150px;height:34px;padding:0 12px;border:0;border-radius:14px;background:rgba(0,0,0,.045);',
    'font:400 13px inherit;color:#1A211C;outline:0;transition:width var(--mls-base) var(--mls-spring),background var(--mls-fast) linear}',
    '#mlsDockAsk:focus{width:250px;background:rgba(0,0,0,.075)}',
    '#mlsDockAsk::placeholder{color:#8C978F}',
    '#mlsAskResults{position:absolute;bottom:46px;right:0;width:340px;max-height:320px;overflow:auto;',
    'background:rgba(255,255,255,.92);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);border:1px solid rgba(0,0,0,.07);',
    'border-radius:16px;box-shadow:0 16px 40px rgba(20,35,28,.18);padding:6px;display:none;',
    'transform-origin:bottom right;animation:mlsPop var(--mls-base) var(--mls-spring)}',
    '@keyframes mlsPop{from{opacity:0;transform:scale(.94) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}',
    '#mlsAskResults .r{display:flex;align-items:center;gap:9px;padding:9px 11px;border-radius:11px;cursor:pointer;font-size:13.5px;color:#1A211C}',
    '#mlsAskResults .r:hover,#mlsAskResults .r.sel{background:#EAF1EE}',
    '#mlsAskResults .r small{margin-left:auto;color:#8C978F;font-size:11.5px}',
    '#mlsAskResults .r.danger{color:#A32D2D}',
    '#mlsAskResults .none{padding:12px;color:#68736B;font-size:13px}',

    /* tools menu */
    '#mlsToolsMenu{position:fixed;z-index:930;min-width:224px;padding:6px;border-radius:16px;',
    'background:rgba(255,255,255,.94);-webkit-backdrop-filter:blur(20px);backdrop-filter:blur(20px);',
    'border:1px solid rgba(0,0,0,.07);box-shadow:0 16px 40px rgba(20,35,28,.18);',
    'transform-origin:bottom left;animation:mlsPop var(--mls-base) var(--mls-spring)}',
    '#mlsToolsMenu .r{padding:9px 12px;border-radius:11px;font-size:13.5px;color:#1A211C;cursor:pointer}',
    '#mlsToolsMenu .r:hover,#mlsToolsMenu .r:focus{background:#EAF1EE;outline:0}',
    '#mlsToolsMenu .sep{height:1px;margin:5px 8px;background:rgba(0,0,0,.07)}',
    '#mlsToolsMenu .r.classic{color:#68736B}',

    /* right-now bar */
    '#mlsRightNow{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:0 0 14px;padding:10px 12px;',
    'background:rgba(255,255,255,.86);border:1px solid #E7E5DD;border-radius:16px;',
    'box-shadow:0 1px 2px rgba(20,35,28,.04)}',
    '#mlsRightNow .lbl{font:500 12px inherit;color:#8C978F;margin-right:2px}',
    '#mlsRightNow button{border:1px solid #DFE5E1;background:#fff;color:#204034;border-radius:12px;padding:9px 15px;',
    'font:500 13.5px inherit;cursor:pointer;opacity:0;transform:translateY(4px);',
    'animation:mlsRise var(--mls-base) var(--mls-spring) forwards;',
    'transition:transform var(--mls-fast) var(--mls-spring),box-shadow var(--mls-fast) linear,background var(--mls-fast) linear}',
    '#mlsRightNow button:hover{background:#F6FAF8;box-shadow:0 2px 8px rgba(20,35,28,.08)}',
    '#mlsRightNow button:active{transform:scale(.96)}',
    '#mlsRightNow button.primary{background:#2E6A4B;border-color:#2E6A4B;color:#fff}',
    '#mlsRightNow button.primary:hover{background:#357855}',
    '#mlsRightNow .tools{margin-left:auto}',
    '@keyframes mlsRise{to{opacity:1;transform:translateY(0)}}',
    '#mlsRightNow .note{font-size:12.5px;color:#8C978F}',
    '#mlsRightNow .seg{display:inline-flex;padding:3px;border-radius:12px;background:rgba(0,0,0,.045);gap:2px;margin-right:6px}',
    '#mlsRightNow .seg .segbtn{border:0;background:transparent;color:#5B6B62;border-radius:10px;padding:6px 12px;',
    'font:500 12.5px inherit;cursor:pointer;opacity:1;transform:none;animation:none}',
    '#mlsRightNow .seg .segbtn.on{background:#fff;color:#204034;box-shadow:0 1px 3px rgba(20,35,28,.10)}',
    '#mlsRightNow .seg .segbtn:hover{color:#204034;background:rgba(255,255,255,.6)}',

    /* stages */
    '#mlsStages{display:flex;align-items:center;gap:0;margin:0 0 14px;padding:2px}',
    '#mlsStages .st{display:flex;align-items:center;gap:7px;color:#9AA69E;font:500 12.5px inherit}',
    '#mlsStages .st .dot{width:15px;height:15px;border-radius:50%;border:1.6px solid #D6DED9;background:#fff;',
    'transition:transform var(--mls-base) var(--mls-spring),background var(--mls-base) linear,border-color var(--mls-base) linear}',
    '#mlsStages .st.done .dot{background:#2E6A4B;border-color:#2E6A4B;transform:scale(1.05)}',
    '#mlsStages .st.now .dot{border-color:#2E6A4B;box-shadow:0 0 0 4px rgba(46,106,75,.14);transform:scale(1.15)}',
    '#mlsStages .st.now{color:#204034}',
    '#mlsStages .st.done{color:#4A5B51}',
    '#mlsStages .bar{flex:1;height:1.6px;background:#E7E5DD;margin:0 9px;border-radius:2px;overflow:hidden}',
    '#mlsStages .bar i{display:block;height:100%;width:0;background:#2E6A4B;transition:width var(--mls-slow) var(--mls-spring)}',

    /* activity bar — honest: it shows work in flight, it never claims a result */
    '#mlsBusy{position:fixed;top:0;left:0;right:0;height:2.5px;z-index:960;pointer-events:none;opacity:0;',
    'transition:opacity var(--mls-base) linear}',
    '#mlsBusy.on{opacity:1}',
    '#mlsBusy i{display:block;height:100%;width:38%;border-radius:0 2px 2px 0;',
    'background:linear-gradient(90deg,rgba(46,106,75,0),#2E6A4B 45%,#5FAF87);animation:mlsSweep 1.15s var(--mls-spring) infinite}',
    '@keyframes mlsSweep{0%{transform:translateX(-100%)}100%{transform:translateX(365%)}}',

    /* heads-down */
    'body.mls-headsdown #mlsRightNow,body.mls-headsdown #mlsStages,body.mls-headsdown #appHeader,',
    'body.mls-headsdown #mlsDock{opacity:.12;transform:translateY(2px);transition:opacity var(--mls-slow) var(--mls-spring),transform var(--mls-slow) var(--mls-spring)}',
    'body.mls-headsdown #mlsDock{transform:translateX(-50%) translateY(6px)}',
    '#mlsHeadsDownHint{position:fixed;left:50%;bottom:86px;transform:translateX(-50%);z-index:915;',
    'padding:7px 14px;border-radius:14px;background:rgba(26,33,28,.82);color:#fff;font:400 12.5px inherit;',
    'opacity:0;pointer-events:none;transition:opacity var(--mls-base) linear}',
    'body.mls-headsdown #mlsHeadsDownHint{opacity:1}',

    /* Clearance for surfaces that were already pinned to the bottom before this
       shell existed: the b532 resumable-pull countdown (#mlsPullResumeCard) and
       the recording backup badge (#_backupBadge). Both mount bottom-left with
       inline styles, and the dock spans the full width on narrow screens, so
       they are lifted rather than left to be covered. A stylesheet !important
       beats a non-important inline style, which is how these reach over their
       own positioning without either module writing to the other. */
    'body.mls-calm #mlsPullResumeCard{bottom:104px!important}',
    'body.mls-calm #_backupBadge{bottom:172px!important}',

    /* view transition */
    'body.mls-calm .view-enter{animation:mlsViewIn var(--mls-base) var(--mls-spring)}',
    '@keyframes mlsViewIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}',

    '@media (prefers-reduced-motion: reduce){',
    '#mlsDock,#mlsRightNow button,#mlsAskResults,body.mls-calm .view-enter{animation-duration:1ms!important}',
    '#mlsBusy i{animation-duration:2s!important}',
    '*{transition-duration:1ms!important}}',

    '@media (max-width:760px){',
    '#mlsDock{left:8px;right:8px;bottom:8px;transform:none;width:auto}',
    '@keyframes mlsDockIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}',
    '#mlsDock button{min-width:0;flex:1;padding:8px 4px 7px;font-size:10.5px}',
    '#mlsDockAsk,#mlsDockAsk:focus{width:110px}',
    '#mlsAskResults{width:min(340px,86vw)}}'
  ].join('');

  function injectCss() {
    if (qs('#mlsCalmShellCss')) return;
    var s = D.createElement('style');
    s.id = 'mlsCalmShellCss';
    s.textContent = CSS;
    (D.head || D.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------------ icons */

  var ICON = {
    day: '<path d="M4 6.5A1.5 1.5 0 015.5 5h13A1.5 1.5 0 0120 6.5v12a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5z"/><path d="M4 10h16M8.5 3v4M15.5 3v4"/>',
    patient: '<circle cx="12" cy="8.5" r="3.6"/><path d="M4.8 20a7.4 7.4 0 0114.4 0"/>',
    visit: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3"/>',
    review: '<path d="M6 3.8h9L19 8v12.2H6z"/><path d="M14.6 3.8V8H19M9 12.5h7M9 16h5"/>',
    tools: '<circle cx="12" cy="12" r="2.6"/><path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4L6 18M18 18l-1.6-1.6M7.6 7.6L6 6"/>'
  };

  /* `targets` is tried in order and the first one the APP still offers wins.
     A rail tab the app gated off (inline display:none via navFeatOn, hidden,
     disabled) is never clicked — .click() fires on hidden elements, so routing
     the dock through a gated tab would quietly hand out a feature the account
     is not entitled to. A destination with nothing available hides itself. */
  var DEST = [
    { id: 'day', label: 'Day', targets: ['nav_calendar'] },
    { id: 'patient', label: 'Patient', targets: ['nav_patients', 'nav_history'], count: 'navPtCount' },
    { id: 'visit', label: 'Visit', targets: ['nav_visit'] },
    { id: 'review', label: 'Review', targets: ['nav_orders', 'nav_recs'], count: 'navOrdCount' },
    { id: 'tools', label: 'Tools', targets: ['nav_studio'], menu: true }
  ];

  /* Every target the app still offers for this destination. A destination that
     covers more than one view (Patient = chart + history, Review = orders +
     recommendations) renders them as a segmented row, because the reach map
     promises those views are reachable from the dock — and a promise the UI
     does not keep is exactly the feature loss this whole shell is guarding. */
  function destTargets(d) {
    return (d.targets || []).map(function (id) { return D.getElementById(id); })
      .filter(available);
  }

  function destTarget(d) {
    return destTargets(d)[0] || null;
  }

  /* Which rail tabs each destination covers — used to light the right dock item
     when navigation happens from somewhere else (a link, Ask, a module). */
  var DEST_TABS = {
    day: ['nav_calendar'],
    patient: ['nav_patients', 'nav_history'],
    visit: ['nav_visit'],
    review: ['nav_orders', 'nav_recs'],
    tools: ['nav_studio', 'nav_analysis', 'nav_team', 'nav_admin', 'nav_legalreq', 'nav_help', 'nav_staffpull']
  };

  /* ------------------------------------------------------------------- dock */

  var dockEl = null;

  function buildDock() {
    if (qs('#mlsDock')) return;
    var nav = D.createElement('nav');
    nav.id = 'mlsDock';
    nav.setAttribute('aria-label', 'Main');

    var pill = D.createElement('div');
    pill.className = 'mls-dock-pill';
    nav.appendChild(pill);

    DEST.forEach(function (d) {
      var b = D.createElement('button');
      b.type = 'button';
      b.setAttribute('data-dest', d.id);
      b.setAttribute('aria-label', d.label);
      b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[d.id] + '</svg><span>' + d.label + '</span>' +
        (d.count ? '<span class="mls-dock-count" data-count="' + d.count + '">0</span>' : '');
      b.addEventListener('click', function () { go(d.id); });
      nav.appendChild(b);
    });

    var askWrap = D.createElement('div');
    askWrap.id = 'mlsDockAskWrap';
    askWrap.innerHTML = '<input id="mlsDockAsk" type="text" autocomplete="off" spellcheck="false" ' +
      'placeholder="Ask or find anything" aria-label="Ask or find anything">' +
      '<div id="mlsAskResults" role="listbox" aria-label="Results"></div>';
    nav.appendChild(askWrap);

    (D.body || D.documentElement).appendChild(nav);
    dockEl = nav;
    wireAsk();
    D.body.classList.add('mls-calm');
    syncDock();
  }

  /* ------------------------------------------------------------ tools menu */

  /* The shell hides the header buttons and the overflow rail tabs. Every one of
     them reappears here, clicking the real control. Without this menu those
     controls would be reachable only by typing their name in Ask, which the
     charter (and the coverage suite) forbid. */
  var TOOLS_SOURCES = [
    { id: 'nav_studio' }, { id: 'nav_analysis' }, { id: 'nav_team' },
    { id: 'nav_legalreq' }, { id: 'nav_admin' }, { id: 'nav_staffpull' }, { id: 'nav_help' },
    { id: 'askCopilotHdrBtn' }, { id: 'intakeBtn' }, { id: 'customWidgetHdrBtn' },
    { label: /^templates$/i, within: '#appHeader' },
    { label: /^settings$/i, within: '#appHeader' },
    { label: /^log out$/i, within: '#appHeader' }
  ];

  /* Availability, not visibility: these are hidden BY THIS SHELL, so offsetWidth
     would report every one of them as gone. What matters is whether the app
     itself gated them (inline display:none, hidden, disabled). */
  function available(el) {
    if (!el) return false;
    if (el.hidden || el.disabled) return false;
    if (el.getAttribute && el.getAttribute('aria-disabled') === 'true') return false;
    if (el.style && el.style.display === 'none') return false;
    return true;
  }

  function toolsItems() {
    var out = [];
    TOOLS_SOURCES.forEach(function (spec) {
      var el = null;
      if (spec.id) {
        el = D.getElementById(spec.id);
      } else {
        var root = qs(spec.within);
        if (root) {
          qsa('button,.navtab', root).some(function (b) {
            if (!available(b) || !spec.label.test(textOf(b))) return false;
            el = b;
            return true;
          });
        }
      }
      if (available(el) && textOf(el)) out.push({ el: el, label: textOf(el) });
    });
    return out;
  }

  function openTools(anchorBtn) {
    var existing = qs('#mlsToolsMenu');
    if (existing) { existing.parentNode.removeChild(existing); return; }
    var menu = D.createElement('div');
    menu.id = 'mlsToolsMenu';
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Tools');
    var items = toolsItems();
    menu.innerHTML = items.map(function (it, i) {
      return '<div class="r" role="menuitem" tabindex="0" data-i="' + i + '">' +
        it.label.replace(/[<>&]/g, '') + '</div>';
    }).join('') + '<div class="sep"></div>' +
      '<div class="r classic" role="menuitem" tabindex="0" data-classic="1">Classic layout</div>';
    (D.body || D.documentElement).appendChild(menu);

    var rect = (anchorBtn || dockEl).getBoundingClientRect();
    menu.style.left = Math.max(10, Math.min(rect.left - 40, W.innerWidth - menu.offsetWidth - 10)) + 'px';
    menu.style.bottom = (W.innerHeight - rect.top + 10) + 'px';

    function close() { if (menu.parentNode) menu.parentNode.removeChild(menu); D.removeEventListener('click', away, true); }
    function away(e) { if (!menu.contains(e.target) && e.target !== anchorBtn) close(); }
    setTimeout(function () { D.addEventListener('click', away, true); }, 0);

    qsa('.r', menu).forEach(function (row) {
      row.addEventListener('click', function () {
        if (row.getAttribute('data-classic')) {
          safe(function () { localStorage.setItem(STORE_KEY, '0'); });
          close();
          teardown();
          return;
        }
        var it = items[parseInt(row.getAttribute('data-i'), 10)];
        close();
        if (!it) return;
        busyMaybe(it.label);
        it.el.click();
        setTimeout(function () { safe(syncDock); safe(renderRightNow); safe(renderStages); }, 260);
      });
      row.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); row.click(); }
      });
    });
  }

  /* Navigation delegates to the real rail tab. The rail is the single owner. */
  function go(destId) {
    if (destId === 'tools') {
      openTools(qs('#mlsDock button[data-dest="tools"]'));
      return;
    }
    var d = null;
    DEST.forEach(function (x) { if (x.id === destId) d = x; });
    if (!d) return;
    var tab = destTarget(d);
    if (!tab) return;
    tab.click();
    markViewEnter();
    safe(syncDock);
    safe(renderRightNow);
    safe(renderStages);
  }

  function currentTabId() {
    var on = qs('.mainnav .navtab.on');
    return on ? on.id : '';
  }

  function currentDest() {
    var tab = currentTabId();
    var found = '';
    Object.keys(DEST_TABS).forEach(function (dest) {
      if (DEST_TABS[dest].indexOf(tab) !== -1) found = dest;
    });
    return found;
  }

  function syncDock() {
    if (!dockEl) return;
    var active = currentDest();
    var pill = qs('.mls-dock-pill', dockEl);
    var activeBtn = null;
    qsa('button[data-dest]', dockEl).forEach(function (b) {
      var id = b.getAttribute('data-dest');
      var d = null;
      DEST.forEach(function (x) { if (x.id === id) d = x; });
      /* Tools is a menu over whatever is still offered, so it never disappears;
         a navigation destination disappears when the app gated its view off. */
      var offered = d && (d.menu || destTarget(d));
      b.style.display = offered ? '' : 'none';
      var on = offered && id === active;
      b.classList.toggle('on', !!on);
      b.setAttribute('aria-current', on ? 'page' : 'false');
      if (on) activeBtn = b;
    });
    if (pill && activeBtn) {
      pill.style.width = activeBtn.offsetWidth + 'px';
      pill.style.transform = 'translateX(' + (activeBtn.offsetLeft - 6) + 'px)';
      pill.style.opacity = '1';
    } else if (pill) {
      pill.style.opacity = '0';
    }
    qsa('.mls-dock-count', dockEl).forEach(function (c) {
      var src = D.getElementById(c.getAttribute('data-count'));
      var n = src ? parseInt(textOf(src), 10) : 0;
      if (!isFinite(n) || n <= 0) { c.classList.remove('show'); return; }
      c.textContent = n > 99 ? '99+' : String(n);
      c.classList.add('show');
    });
  }

  function markViewEnter() {
    var v = qsa('#appWrap > div').filter(function (el) {
      return /View$/.test(el.id || '') && visible(el);
    })[0];
    if (!v) return;
    v.classList.remove('view-enter');
    void v.offsetWidth;
    v.classList.add('view-enter');
  }

  /* -------------------------------------------------------- right-now bar */

  /* Per-destination action priority. Each entry names a real control: by id, or
     by a label pattern scoped to a container. Absent control -> absent action,
     which is the charter rule (illegal actions are absent, not disabled). */
  var ACTIONS = {
    patient: [
      { id: 'ptNewBtn', primary: true },
      { id: 'ptPullAthenaBtn' },
      { id: 'ptIntakeBtn' }
    ],
    day: [
      { label: /^(pull|refresh|import)/i, within: '#calendarView' },
      { id: 'ptBoardBtn' },
      { id: 'ptPullAthenaBtn' }
    ],
    visit: [
      { label: /^(start|record|begin)/i, within: '#visitView', primary: true },
      { label: /^(stop|end)/i, within: '#visitView', primary: true },
      { label: /^(pause|resume)/i, within: '#visitView' },
      { label: /^generate/i, within: '#visitView', primary: true },
      { label: /^(sign|save to athena|send to athena)/i, within: '#visitView', primary: true }
    ],
    review: [
      { label: /^(add|new) order/i, within: '#ordersView', primary: true },
      { label: /^(review|place)/i, within: '#ordersView' },
      { label: /^(print|pdf|save as pdf)/i, within: '#ordersView' }
    ],
    tools: [
      { label: /^(new|create)/i, within: '#studioView', primary: true }
    ]
  };

  function findControl(spec) {
    if (spec.id) {
      var el = D.getElementById(spec.id);
      return visible(el) ? el : null;
    }
    var root = spec.within ? qs(spec.within) : D;
    if (!root) return null;
    var hit = null;
    qsa('button,.btn-primary,.btn-ghost,.btn-green', root).some(function (b) {
      if (!visible(b)) return false;
      if (!spec.label.test(textOf(b))) return false;
      hit = b;
      return true;
    });
    return hit;
  }

  function ensureRightNow() {
    var bar = qs('#mlsRightNow');
    if (bar) return bar;
    var wrap = qs('#appWrap');
    if (!wrap) return null;
    bar = D.createElement('div');
    bar.id = 'mlsRightNow';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Right now');
    var anchor = qs('#patientBar') || qs('.mainnav');
    if (anchor && anchor.parentNode === wrap) wrap.insertBefore(bar, anchor.nextSibling);
    else wrap.insertBefore(bar, wrap.firstChild);
    return bar;
  }

  var lastRnSig = '';

  function renderRightNow() {
    var bar = ensureRightNow();
    if (!bar) return;
    var dest = currentDest() || 'patient';
    var specs = ACTIONS[dest] || [];
    var picked = [];
    specs.forEach(function (spec) {
      if (picked.length >= 3) return;
      var el = findControl(spec);
      if (!el) return;
      var dup = picked.some(function (p) { return p.el === el; });
      if (!dup) picked.push({ el: el, primary: !!spec.primary });
    });

    var destDef = null;
    DEST.forEach(function (x) { if (x.id === dest) destDef = x; });
    var sibs = destDef ? destTargets(destDef) : [];

    /* Re-render only when the bar would actually change. The visit view mutates
       continuously while a transcript streams in, and rebuilding on every one of
       those would restart each button's entrance animation 60 times a second —
       a flickering toolbar in front of a doctor mid-recording. */
    var sig = dest + '|' +
      sibs.map(function (t) { return t.id + (t.classList.contains('on') ? '*' : ''); }).join(',') + '|' +
      picked.map(function (p) { return textOf(p.el) + (p.primary ? '!' : ''); }).join(',');
    if (sig === lastRnSig && bar.childNodes.length) return;
    lastRnSig = sig;

    bar.innerHTML = '';

    if (sibs.length > 1) {
      var seg = D.createElement('span');
      seg.className = 'seg';
      seg.setAttribute('role', 'tablist');
      sibs.forEach(function (tab) {
        var s = D.createElement('button');
        s.type = 'button';
        s.className = 'segbtn' + (tab.classList.contains('on') ? ' on' : '');
        s.setAttribute('role', 'tab');
        s.setAttribute('aria-selected', tab.classList.contains('on') ? 'true' : 'false');
        s.textContent = textOf(tab).replace(/\s*\d+$/, '');
        s.addEventListener('click', function () {
          tab.click();
          markViewEnter();
          setTimeout(function () { safe(syncDock); safe(renderRightNow); safe(renderStages); }, 60);
        });
        seg.appendChild(s);
      });
      bar.appendChild(seg);
    }

    var lbl = D.createElement('span');
    lbl.className = 'lbl';
    lbl.textContent = 'Right now';
    bar.appendChild(lbl);

    if (!picked.length) {
      var note = D.createElement('span');
      note.className = 'note';
      note.textContent = 'Nothing to do here yet';
      bar.appendChild(note);
    }

    picked.forEach(function (p, i) {
      var b = D.createElement('button');
      b.type = 'button';
      b.textContent = textOf(p.el);
      if (p.primary && i === 0) b.className = 'primary';
      b.style.animationDelay = (i * 45) + 'ms';
      b.addEventListener('click', function () {
        busyMaybe(textOf(p.el));
        p.el.click();
        setTimeout(function () { safe(renderRightNow); safe(renderStages); }, 260);
      });
      bar.appendChild(b);
    });

    var tools = D.createElement('button');
    tools.type = 'button';
    tools.className = 'tools';
    tools.textContent = 'Tools';
    tools.addEventListener('click', function () { go('tools'); });
    bar.appendChild(tools);
  }

  /* ----------------------------------------------------------------- stages */

  var STAGES = ['Prep', 'Record', 'Review', 'Sign', 'Send'];

  /* Stage is READ from the view, never assumed. A stage never advances on a
     guess: if the app has not produced the evidence for a stage, we do not
     claim it. */
  function stageNow() {
    var visit = qs('#visitView');
    if (!visit || !visible(visit)) return -1;
    var stopping = findControl({ label: /^(stop|end)/i, within: '#visitView' });
    if (stopping) return 1;
    var signable = findControl({ label: /^(sign|save to athena|send to athena)/i, within: '#visitView' });
    var noteText = '';
    var ta = qsa('textarea,[contenteditable="true"]', visit).filter(visible)[0];
    if (ta) noteText = (ta.value || ta.textContent || '').trim();
    if (signable && noteText.length > 40) return 3;
    if (noteText.length > 40) return 2;
    return 0;
  }

  function ensureStages() {
    var visit = qs('#visitView');
    if (!visit) return null;
    var el = qs('#mlsStages');
    if (el && el.parentNode === visit) return el;
    if (!el) {
      el = D.createElement('div');
      el.id = 'mlsStages';
      el.setAttribute('role', 'group');
      el.setAttribute('aria-label', 'Visit progress');
      el.setAttribute('aria-live', 'polite');
    }
    visit.insertBefore(el, visit.firstChild);
    return el;
  }

  var lastStage = -2;

  function renderStages() {
    var visit = qs('#visitView');
    var el = qs('#mlsStages');
    if (!visit || !visible(visit)) { if (el) el.style.display = 'none'; return; }
    el = ensureStages();
    if (!el) return;
    el.style.display = 'flex';
    var now = stageNow();
    if (now === lastStage && el.childNodes.length) return;
    lastStage = now;

    var parts = [];
    STAGES.forEach(function (name, i) {
      var cls = i < now ? 'done' : (i === now ? 'now' : '');
      parts.push('<span class="st ' + cls + '"><span class="dot"></span>' + name + '</span>');
      if (i < STAGES.length - 1) {
        parts.push('<span class="bar"><i style="width:' + (i < now ? 100 : 0) + '%"></i></span>');
      }
    });
    el.innerHTML = parts.join('');
    if (now >= 0) el.setAttribute('aria-label', 'Visit progress: ' + STAGES[now]);
  }

  /* ------------------------------------------------------------- heads-down */

  var idleTimer = null;

  function headsDownOn() {
    return safe(function () { return localStorage.getItem(HEADSDOWN_KEY) !== '0'; }) !== false;
  }

  function ensureHint() {
    if (qs('#mlsHeadsDownHint')) return;
    var h = D.createElement('div');
    h.id = 'mlsHeadsDownHint';
    h.textContent = 'Recording — move the mouse or press any key to bring the controls back';
    (D.body || D.documentElement).appendChild(h);
  }

  function wake() {
    if (D.body.classList.contains('mls-headsdown')) D.body.classList.remove('mls-headsdown');
    if (idleTimer) clearTimeout(idleTimer);
    if (!headsDownOn()) return;
    if (stageNow() !== 1) return;
    idleTimer = setTimeout(function () {
      if (stageNow() === 1) { ensureHint(); D.body.classList.add('mls-headsdown'); }
    }, 3000);
  }

  /* --------------------------------------------------------------- activity */

  var busyTimer = null;

  function ensureBusy() {
    var b = qs('#mlsBusy');
    if (b) return b;
    b = D.createElement('div');
    b.id = 'mlsBusy';
    b.setAttribute('role', 'status');
    b.setAttribute('aria-live', 'polite');
    b.innerHTML = '<i></i>';
    (D.body || D.documentElement).appendChild(b);
    return b;
  }

  /* Deliberately an ACTIVITY bar, not a completion bar. We cannot observe when
     someone else's async work truly finished, so we never draw a percentage we
     would be inventing. It runs while work is plausibly in flight and fades. */
  function busy(on, ms) {
    var b = ensureBusy();
    if (busyTimer) { clearTimeout(busyTimer); busyTimer = null; }
    if (!on) { b.classList.remove('on'); return; }
    b.classList.add('on');
    busyTimer = setTimeout(function () { b.classList.remove('on'); }, ms || 9000);
  }

  function busyMaybe(label) {
    if (/pull|import|generate|sign|send|refresh|save|search/i.test(label || '')) busy(true, 12000);
  }

  /* -------------------------------------------------------------------- ask */

  /* Ask indexes the LIVE DOM rather than a build-time list, so it cannot go
     stale: whatever control is on screen is what Ask can reach. */
  function indexControls() {
    var out = [];
    var seen = [];
    qsa('button,.navtab,[onclick]').forEach(function (el) {
      if (el.closest && el.closest('#mlsDock,#mlsRightNow,#mlsAskResults')) return;
      var label = textOf(el);
      if (!label || label.length > 70) return;
      if (seen.indexOf(label.toLowerCase()) !== -1) return;
      seen.push(label.toLowerCase());
      out.push({ el: el, label: label, hidden: !visible(el) });
    });
    return out;
  }

  function score(label, q) {
    var l = label.toLowerCase();
    if (l === q) return 100;
    if (l.indexOf(q) === 0) return 80;
    if (l.indexOf(q) !== -1) return 60;
    var words = q.split(/\s+/).filter(Boolean);
    var hit = words.filter(function (w) { return l.indexOf(w) !== -1; }).length;
    return hit ? 20 + hit * 8 : 0;
  }

  var DESTRUCTIVE = /remove|delete|purge|discharge|sign|send to athena|place order|log out/i;

  function wireAsk() {
    var input = qs('#mlsDockAsk');
    var panel = qs('#mlsAskResults');
    if (!input || !panel) return;
    var results = [];
    var sel = 0;

    function close() { panel.style.display = 'none'; results = []; sel = 0; }

    function run() {
      var q = input.value.trim().toLowerCase();
      if (q.length < 2) { close(); return; }
      results = indexControls().map(function (c) {
        return { c: c, s: score(c.label, q) };
      }).filter(function (r) { return r.s > 0; })
        .sort(function (a, b) { return b.s - a.s || a.c.label.length - b.c.label.length; })
        .slice(0, 8).map(function (r) { return r.c; });

      if (!results.length) {
        panel.innerHTML = '<div class="none">Nothing matches "' + q.replace(/[<>&]/g, '') + '".</div>';
        panel.style.display = 'block';
        return;
      }
      sel = 0;
      panel.innerHTML = results.map(function (r, i) {
        var danger = DESTRUCTIVE.test(r.label);
        return '<div class="r' + (i === 0 ? ' sel' : '') + (danger ? ' danger' : '') + '" role="option" data-i="' + i + '">' +
          r.label.replace(/[<>&]/g, '') + (r.hidden ? '<small>hidden here</small>' : '') + '</div>';
      }).join('');
      panel.style.display = 'block';
      qsa('.r', panel).forEach(function (row) {
        row.addEventListener('click', function () { choose(parseInt(row.getAttribute('data-i'), 10)); });
      });
    }

    function choose(i) {
      var r = results[i];
      if (!r) return;
      close();
      input.value = '';
      input.blur();
      var proceed = function () {
        busyMaybe(r.label);
        safe(function () { r.el.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
        r.el.click();
        setTimeout(function () { safe(syncDock); safe(renderRightNow); safe(renderStages); }, 300);
      };
      /* Destructive controls keep their own gates. We add a confirmation rather
         than removing friction the app put there on purpose. Never a native
         dialog — the app owns mlsConfirm. */
      if (DESTRUCTIVE.test(r.label) && typeof W.mlsConfirm === 'function') {
        Promise.resolve(W.mlsConfirm('Run "' + r.label + '" now?')).then(function (ok) {
          if (ok) proceed();
        });
        return;
      }
      proceed();
    }

    input.addEventListener('input', run);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { close(); input.blur(); return; }
      if (!results.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        sel = (sel + (e.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length;
        qsa('.r', panel).forEach(function (row, i) { row.classList.toggle('sel', i === sel); });
        return;
      }
      if (e.key === 'Enter') { e.preventDefault(); choose(sel); }
    });
    D.addEventListener('click', function (e) {
      if (!panel.contains(e.target) && e.target !== input) close();
    }, true);
  }

  /* ----------------------------------------------------------------- toggle */

  function classicSwitch() {
    var host = qs('#appHeader .tools');
    if (!host || qs('#mlsClassicBtn')) return;
    var b = D.createElement('button');
    b.id = 'mlsClassicBtn';
    b.className = 'btn-white mls-calm-keep';
    b.type = 'button';
    b.title = 'Switch back to the classic layout — takes effect immediately, no reload';
    b.textContent = 'Classic layout';
    b.addEventListener('click', function () {
      safe(function () { localStorage.setItem(STORE_KEY, '0'); });
      teardown();
    });
    host.appendChild(b);
  }

  function teardown() {
    D.body.classList.remove('mls-calm', 'mls-headsdown');
    ['#mlsDock', '#mlsRightNow', '#mlsStages', '#mlsBusy', '#mlsHeadsDownHint', '#mlsClassicBtn'].forEach(function (s) {
      var el = qs(s);
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    if (observer) safe(function () { observer.disconnect(); });
    if (idleTimer) clearTimeout(idleTimer);
    D.removeEventListener('mousemove', wake, true);
    D.removeEventListener('keydown', onKey, true);
    var css = qs('#mlsCalmShellCss');
    if (css && css.parentNode) css.parentNode.removeChild(css);
    dockEl = null;
    observer = null;
    lastRnSig = '';
    lastStage = -2;
    W.__mlsCalmShell.active = false;
  }

  function onKey(e) {
    wake();
    if (e.key === 'Escape' && D.body.classList.contains('mls-headsdown')) {
      D.body.classList.remove('mls-headsdown');
      return;
    }
    if ((e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) {
      var d = DEST[parseInt(e.key, 10) - 1];
      if (d) { e.preventDefault(); go(d.id); }
    }
    if (e.key === '/' && D.activeElement && !/input|textarea|select/i.test(D.activeElement.tagName) &&
      !D.activeElement.isContentEditable) {
      var ask = qs('#mlsDockAsk');
      if (ask) { e.preventDefault(); ask.focus(); }
    }
  }

  /* ------------------------------------------------------------- lifecycle */

  var observer = null;
  var pending = false;

  /* One observer, scoped to the two roots that actually tell us something:
     the rail (view state) and the visit view (stage state). Coalesced into a
     single rAF so a busy render cannot turn into a feedback loop. */
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      safe(syncDock);
      safe(renderRightNow);
      safe(renderStages);
      safe(wake);
    });
  }

  function watch() {
    if (observer) return;
    observer = new MutationObserver(schedule);
    var rail = qs('.mainnav');
    var visit = qs('#visitView');
    /* class -> which view is active; style -> navFeatOn un-gating a tab mid
       session, which has to make its dock destination appear. The shell never
       writes to the rail, so watching it cannot feed back into itself. */
    if (rail) observer.observe(rail, { attributes: true, attributeFilter: ['class', 'style'], subtree: true });
    if (visit) observer.observe(visit, { childList: true, subtree: true });
  }

  function boot() {
    if (!enabled()) return;
    if (!qs('#appScreen') || !visible(qs('#appScreen'))) return false;
    /* If any part of the shell fails to come up we return the doctor to the
       classic layout rather than leaving them with a hidden rail and no dock.
       An unattended deploy has to fail back to something usable. */
    try {
      injectCss();
      buildDock();
      classicSwitch();
      renderRightNow();
      renderStages();
      watch();
      D.addEventListener('mousemove', wake, true);
      D.addEventListener('keydown', onKey, true);
      W.__mlsCalmShell.active = true;
      return true;
    } catch (e) {
      safe(function () { W.__mlsCalmShell.error = String((e && e.message) || e); });
      safe(teardown);
      return true;
    }
  }

  W.__mlsCalmShell = {
    version: VERSION,
    contract: CONTRACT,
    active: false,
    go: go,
    busy: busy,
    stage: stageNow,
    revert: teardown,
    boot: boot
  };

  /* The app screen appears after auth; poll cheaply until it does, then stop.
     One timer, self-cancelling — never a standing interval. */
  var tries = 0;
  (function waitForApp() {
    if (boot() === true) return;
    if (++tries > 120) return;
    setTimeout(waitForApp, 500);
  })();
})();
